/**
 * batch-add-computed-labels.ts
 *
 * Reads every .htp file in tests/, computes harmony labels using the
 * same stateless pipeline as regression-check.ts, and writes back
 * the `computedLabels` field into each file.
 *
 * Usage:  npx tsx scripts/batch-add-computed-labels.ts
 *         npx tsx scripts/batch-add-computed-labels.ts --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature } from '../src/utils/musicTheory';
import { applyStatelessRules } from '../src/utils/harmonyPostRules';

const TESTS_DIR = path.join(__dirname, '..', 'tests');
const DRY_RUN = process.argv.includes('--dry-run');

function substituteSuspensionsForAnalysis(notes: any[], absBeat: number): any[] {
  return notes.map(n => {
    if (!n || n.isRest) return n;
    const s = n.isSuspension;
    if (!s || typeof s.fromAbsBeat !== 'number') return n;
    if (Math.abs(s.fromAbsBeat - absBeat) > 0.001) return n;
    if (s.resolvedMidi != null) {
      return { ...n, midi: s.resolvedMidi, noteIndex: ((s.resolvedMidi % 12) + 12) % 12 };
    }
    return n;
  });
}

const files = fs.readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.htp'))
  .sort();

let updated = 0;
let skipped = 0;
let errored = 0;

for (const fileName of files) {
  const filePath = path.join(TESTS_DIR, fileName);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const proj = JSON.parse(raw);
    const notes = proj.notes || [];
    if (notes.length === 0) { skipped++; continue; }

    const keySignatureRoot = proj.keySignatureRoot || 'C';
    const isMinorMode = !!proj.isMinorMode;
    const keyTonic = proj.keyTonic || keySignatureRoot;
    const timeSignature = proj.timeSignature || { numerator: 4, denominator: 4 };
    const keySignature = getKeySignature(keySignatureRoot, isMinorMode ? 'Minor' : 'Major');

    const result = applyHarmonyRules(
      notes as any,
      keySignature as any,
      keyTonic,
      isMinorMode,
      (proj.analysisContexts || []) as any,
      timeSignature as any,
      proj.doubleBarlineMeasures || [],
      proj.ornamentOverrides || [],
      proj.harmonyOverrides || [],
    );

    const rawTl = getActiveNotesTimeline(result.analyzedNotes as any, timeSignature as any);
    // Merge float-duplicate events
    const timeline: typeof rawTl = [];
    for (const ev of rawTl) {
      const idx = timeline.findIndex(t => Math.abs(t.absBeat - ev.absBeat) < 1e-4);
      if (idx === -1) timeline.push(ev);
      else if ((ev.notes || []).length > (timeline[idx].notes || []).length) timeline[idx] = ev;
    }

    const computedLabels: Array<{ absBeat: number; roman: string; romanDisplay: string; figures: string[] }> = [];

    for (const ev of timeline) {
      const ab = Math.round(Number(ev.absBeat) * 1e6) / 1e6;
      if (!Number.isFinite(ab)) continue;

      const substNotes = substituteSuspensionsForAnalysis(ev.notes as any, ev.absBeat);
      const bassPc = (() => {
        let lowest: any = null;
        for (const n of (substNotes || [])) {
          if (!n || n.isRest) continue;
          const m = Number(n.midi);
          if (!Number.isFinite(m)) continue;
          if (!lowest || m < lowest.midi) lowest = { midi: m, pc: ((m % 12) + 12) % 12 };
        }
        return lowest?.pc ?? null;
      })();

      const stateless = applyStatelessRules({
        analysisNotesForNaming: substNotes as any,
        analysisNotes: substNotes as any,
        fullNotes: ev.notes as any,
        contextTonic: keyTonic,
        contextIsMinor: isMinorMode,
        bassPc,
        absBeat: ab,
        autoOverrideByAbsBeat: new Map(),
        overrideByAbsBeat: new Map(),
      });

      const roman = stateless.roman;
      if (!roman) continue;
      const figures = stateless.figures || [];

      computedLabels.push({
        absBeat: ab,
        roman,
        romanDisplay: roman, // stateless pipeline doesn't produce romanDisplay separately
        figures: figures.length === 1 && figures[0] === '5' ? [] : figures,
      });
    }

    if (computedLabels.length < 2) { skipped++; continue; }

    proj.computedLabels = computedLabels;

    if (DRY_RUN) {
      console.log(`  [dry-run] ${fileName}  (${computedLabels.length} labels)`);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(proj, null, 2), 'utf-8');
      console.log(`  ✓ ${fileName}  (${computedLabels.length} labels)`);
    }
    updated++;
  } catch (err: any) {
    errored++;
    console.error(`  ✗ ${fileName}: ${err?.message || err}`);
  }
}

console.log(`\nDone: ${updated} files updated, ${skipped} skipped, ${errored} errors`);
