/**
 * generate-snapshots.ts
 *
 * Reads every .htp file in tests/, runs the current analysis engine,
 * and writes a JSON fixture into scripts/fixtures/ with roman expectations
 * for every beat. If a fixture for a given .htp already exists, it is skipped
 * (use --force to overwrite).
 *
 * Usage:
 *   npx tsx scripts/generate-snapshots.ts            # generate missing only
 *   npx tsx scripts/generate-snapshots.ts --force     # regenerate all
 *   npx tsx scripts/generate-snapshots.ts --file "Dealmont C56 3b"  # single file
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
  applyHarmonyRules,
} from '../src/utils/musicTheory';

const testsDir = path.resolve(__dirname, '..', 'tests');
const fixturesDir = path.resolve(__dirname, 'fixtures');

const args = process.argv.slice(2);
const force = args.includes('--force');
const fileFilter = (() => {
  const idx = args.indexOf('--file');
  return idx >= 0 ? args[idx + 1] : null;
})();

const relativeMinors: Record<string, string> = {
  C: 'A', G: 'E', D: 'B', A: 'F#', E: 'C#', B: 'G#', 'F#': 'D#', 'C#': 'A#',
  F: 'D', Bb: 'G', Eb: 'C', Ab: 'F', Db: 'Bb', Gb: 'Eb', Cb: 'Ab',
};

function slugify(name: string): string {
  return name
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

let generated = 0;
let skipped = 0;
let errored = 0;

const htpFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.htp') || f.endsWith('.json'))
  .sort();

for (const filename of htpFiles) {
  const baseName = filename.replace(/\.(htp|json)$/, '');

  if (fileFilter && !baseName.includes(fileFilter)) continue;

  const slug = `snap-${slugify(baseName)}`;
  const outPath = path.join(fixturesDir, `${slug}.json`);

  if (!force && fs.existsSync(outPath)) {
    skipped++;
    continue;
  }

  const full = path.join(testsDir, filename);
  try {
    const raw = fs.readFileSync(full, 'utf8');
    const data = JSON.parse(raw);

    const notes = data.notes;
    if (!Array.isArray(notes) || notes.length === 0) {
      skipped++;
      continue;
    }

    const keySignatureRoot: string = data.keySignatureRoot || 'C';
    const isMinorMode: boolean = !!data.isMinorMode;
    const timeSignature = data.timeSignature || { numerator: 4, denominator: 4 };

    // Derive tonic same as GrandStaffEditor
    const keyTonic = isMinorMode
      ? relativeMinors[keySignatureRoot] || 'A'
      : keySignatureRoot;

    const keySig = getKeySignature(keySignatureRoot, isMinorMode ? 'Minor' : 'Major');

    // Run harmony rules to get analyzedNotes (with ornament detection, etc.)
    const res: any = applyHarmonyRules(
      notes,
      keySig as any,
      keyTonic,
      isMinorMode,
      data.analysisContexts || [],
      timeSignature,
      data.doubleBarlineMeasures || [],
      data.ornamentOverrides || [],
      data.harmonyOverrides || [],
    );

    const analyzedNotes = (res.analyzedNotes || notes) as any[];
    const timeline = getActiveNotesTimeline(analyzedNotes as any, timeSignature as any, data.timeSignatureChanges || []);

    const expects: Array<{ absBeat: number; roman: string; figuresInclude?: string[] }> = [];

    for (const ev of timeline) {
      const absBeat = Math.round(Number(ev.absBeat) * 1e6) / 1e6;
      if (!Number.isFinite(absBeat)) continue;

      // Use the EXACT same call as regression-check.ts L562:
      // getRomanAnalysis(ev.notes, keyTonic, isMinorMode) — no extras
      const ra = getRomanAnalysis(ev.notes as any, keyTonic, isMinorMode);
      const roman = ra?.roman ?? '';
      const figures = ra?.figures ?? [];

      if (!roman) continue; // skip beats with no harmonic content

      const entry: any = { absBeat, roman };
      // Include non-trivial figures (not just "5" or empty)
      if (figures.length > 0 && !(figures.length === 1 && figures[0] === '5')) {
        entry.figuresInclude = figures;
      }
      expects.push(entry);
    }

    if (expects.length === 0) {
      skipped++;
      continue;
    }

    const fixture = {
      name: `${baseName} (snapshot)`,
      keySignatureRoot,
      keyTonic,
      isMinorMode,
      timeSignature,
      analysisContexts: data.analysisContexts || [],
      notes,
      expects,
    };

    fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
    generated++;
    console.log(`OK  ${slug} (${expects.length} expects)`);
  } catch (e: any) {
    errored++;
    console.error(`ERR  ${baseName}: ${e?.message || e}`);
  }
}

console.log(`\nDone: ${generated} generated, ${skipped} skipped, ${errored} errors`);
