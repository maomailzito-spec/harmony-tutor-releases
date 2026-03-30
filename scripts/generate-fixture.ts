/**
 * Generate a gold-standard fixture from a verified .htp file.
 * Usage: npx tsx scripts/generate-fixture.ts "tests/Dubois n2 p75.htp"
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  applyHarmonyRules,
  getKeySignature,
  getActiveNotesTimeline,
  substituteSuspensionsForAnalysis,
  formatFiguredBass,
} from '../src/utils/musicTheory';
import { applyStatelessRules } from '../src/utils/harmonyPostRules';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx tsx scripts/generate-fixture.ts <path-to-htp>');
  process.exit(1);
}

const fx = JSON.parse(fs.readFileSync(filePath, 'utf8'));
if (!fx.keyTonic) fx.keyTonic = fx.keySignatureRoot;
const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');

const result: any = applyHarmonyRules(
  fx.notes, ks as any, fx.keyTonic, fx.isMinorMode,
  fx.analysisContexts || [], fx.timeSignature,
  fx.doubleBarlineMeasures || [],
  fx.ornamentOverrides || [],
  fx.harmonyOverrides || [],
);

const rawTimeline = getActiveNotesTimeline(result.analyzedNotes as any, fx.timeSignature as any);
// Merge float-duplicate events
const timeline: typeof rawTimeline = [];
for (const ev of rawTimeline) {
  const idx = timeline.findIndex(t => Math.abs(t.absBeat - ev.absBeat) < 1e-4);
  if (idx === -1) timeline.push(ev);
  else if ((ev.notes || []).length > (timeline[idx].notes || []).length) timeline[idx] = ev;
}

const expects: any[] = [];
for (const ev of timeline) {
  const ab = Math.round(Number(ev.absBeat) * 1e6) / 1e6;
  if (!Number.isFinite(ab)) continue;
  const substNotes = substituteSuspensionsForAnalysis(ev.notes as any, ev.absBeat);
  let lowest: any = null;
  for (const n of (substNotes || [])) {
    if (!n || n.isRest) continue;
    const m = Number(n.midi);
    if (!Number.isFinite(m)) continue;
    if (!lowest || m < lowest.midi) lowest = { midi: m, pc: ((m % 12) + 12) % 12 };
  }
  const stateless = applyStatelessRules({
    analysisNotesForNaming: substNotes as any,
    analysisNotes: substNotes as any,
    fullNotes: ev.notes as any,
    contextTonic: fx.keyTonic,
    contextIsMinor: fx.isMinorMode,
    bassPc: lowest?.pc ?? null,
    absBeat: ev.absBeat,
    autoOverrideByAbsBeat: new Map(),
    overrideByAbsBeat: new Map(),
  });
  const roman = stateless.roman;
  if (!roman) continue;
  const figures = stateless.figures.filter((f: string) => f && f.trim());
  const entry: any = { absBeat: ab, roman };
  if (figures.length > 0 && !(figures.length === 1 && figures[0] === '5')) {
    entry.figuresInclude = figures;
  }
  expects.push(entry);
}

// Deduplicate by absBeat within epsilon
const deduped: typeof expects = [];
for (const e of expects) {
  const idx = deduped.findIndex(d => Math.abs(d.absBeat - e.absBeat) < 1e-4);
  if (idx === -1) {
    deduped.push(e);
  } else {
    const prev = deduped[idx];
    const prevScore = (prev.roman ? 1 : 0) + (prev.figuresInclude || []).length;
    const eScore = (e.roman ? 1 : 0) + (e.figuresInclude || []).length;
    if (eScore > prevScore) deduped[idx] = e;
  }
}

const baseName = path.basename(filePath, path.extname(filePath))
  .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
const outName = `gold-${baseName}.json`;
const outPath = path.join(__dirname, 'fixtures', outName);

const fixture = {
  name: `${fx.projectTitle || baseName} (gold)`,
  keySignatureRoot: fx.keySignatureRoot,
  keyTonic: fx.keyTonic,
  isMinorMode: fx.isMinorMode,
  timeSignature: fx.timeSignature,
  analysisContexts: fx.analysisContexts || [],
  notes: fx.notes,
  harmonyOverrides: fx.harmonyOverrides || [],
  ornamentOverrides: fx.ornamentOverrides || [],
  doubleBarlineMeasures: fx.doubleBarlineMeasures || [],
  expects: deduped,
};

fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
console.log(`Generated ${outPath} with ${deduped.length} expects`);
