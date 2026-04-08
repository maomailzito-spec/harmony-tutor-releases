/**
 * Extract harmonic progression statistics from test compositions.
 * Produces bigram frequencies (chord A → chord B) and trigram frequencies.
 *
 * Usage: npx tsx scripts/extract-progression-stats.ts
 * Output: src/data/progressionStats.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';

// Files known to hang in applyHarmonyRules — skip them.
const SKIP_FILES = new Set<string>();

// ── Collect all test files ──────────────────────────────────────────────
const TESTS_DIR = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.json') || f.endsWith('.htp'))
  .map(f => path.join(TESTS_DIR, f));

console.log(`Found ${files.length} test files`);

type BigramMap = Record<string, Record<string, number>>;
type TrigramMap = Record<string, Record<string, number>>;

const bigrams: BigramMap = {};       // with inversions (full label)
const trigrams: TrigramMap = {};     // with inversions
const bigramsBase: BigramMap = {};   // without inversions (root only)
const trigramsBase: TrigramMap = {}; // without inversions
const unigramCounts: Record<string, number> = {};
const unigramCountsBase: Record<string, number> = {};
let totalTransitions = 0;

/** Strip figured-bass digits from roman label to get the base chord.
 *  e.g. "V65" → "V", "vii°6" → "vii°", "V/vi6" → "V/vi", "I64" → "I" */
function stripFigures(label: string): string {
  // Remove trailing digits (but preserve secondary target like /vi)
  return label.replace(/[0-9♭♯]+$/g, '');
}

for (const filePath of files) {
  try {
    const idx = files.indexOf(filePath) + 1;
    const basename = path.basename(filePath);
    if (SKIP_FILES.has(basename)) {
      process.stderr.write(`  [${idx}/${files.length}] ${basename} — SKIPPED (known hang)\n`);
      continue;
    }
    process.stderr.write(`  [${idx}/${files.length}] ${basename}...\n`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const proj = JSON.parse(raw);
    const notes = proj.notes || [];
    if (notes.length === 0) continue;

    const tonic = String(proj.keySignatureRoot || 'C');
    const isMinor = Boolean(proj.isMinorMode);
    const ts = proj.timeSignature || { top: 4, bottom: 4 };
    const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
    const contexts = proj.analysisContexts || [];
    const ornamentOverrides = proj.ornamentOverrides || [];
    const harmonyOverrides: any[] = proj.harmonyOverrides || [];
    const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, undefined, ornamentOverrides);
    const analyzed: any[] = (res as any).analyzedNotes || notes;

    // Group notes by measure:beat → chord events
    const beatMap = new Map<string, any[]>();
    for (const n of analyzed) {
      if (!n || n.isRest) continue;
      const key = `${n.measureIndex}:${n.beat}`;
      if (!beatMap.has(key)) beatMap.set(key, []);
      beatMap.get(key)!.push(n);
    }

    // Sort beat events chronologically
    const sortedKeys = [...beatMap.keys()].sort((a, b) => {
      const [am, ab] = a.split(':').map(Number);
      const [bm, bb] = b.split(':').map(Number);
      return am !== bm ? am - bm : ab - bb;
    });

    // ── Filter: only strong metric beats (skip ornamental sub-beats) ──
    // Sub-beats (1.5, 2.5, etc.) often contain passing tones, appoggiaturas
    // and bass ornaments that create phantom inversions / phantom chords.
    const denom = Number(ts.denominator || ts.bottom || 4);
    const beatsPerMeasure = Number(ts.numerator || ts.top || 4) * (4 / denom);
    const filteredKeys: string[] = [];
    let lastAbsBeat = -Infinity;
    for (const key of sortedKeys) {
      const [mi, bt] = key.split(':').map(Number);
      // Skip sub-beats (non-integer beat positions like 1.5, 2.5)
      if (Math.abs(bt - Math.round(bt)) > 0.01) continue;
      // MinSpan: skip events closer than 1 beat to the last accepted
      const absBeat = mi * beatsPerMeasure + bt;
      if (absBeat - lastAbsBeat < 0.99) continue;
      lastAbsBeat = absBeat;
      filteredKeys.push(key);
    }

    // Extract roman numeral for each chord event
    const progression: string[] = [];
    for (const key of filteredKeys) {
      const chordNotes = beatMap.get(key)!;
      // Filter out ornamental tones
      const structural = chordNotes.filter((n: any) =>
        !n.isPassing && !n.isNeighbor && !n.isAppoggiatura &&
        !n.isAnticipation && !n.isEscape && !n.isSuspension
      );
      if (structural.length < 2) continue;

      // Use getRomanAnalysis to get the roman numeral
      try {
        const result = getRomanAnalysis(structural as any, tonic, isMinor);
        if (result && result.roman && result.roman.length > 0 && result.roman !== '?') {
          // Combine roman + figures for full label (e.g. "V" + ["6","5"] → "V65")
          let label = result.roman;
          if (result.figures && result.figures.length > 0) {
            label += result.figures.join('');
          }
          // Apply user harmony overrides (prefer manual corrections over analysis)
          const [_mi, _bt] = key.split(':').map(Number);
          const absBeat = _mi * beatsPerMeasure + (_bt - 1);
          const hOverride = harmonyOverrides.find((o: any) =>
            Math.abs(Number(o?.absBeat) - absBeat) < 0.05 && typeof o?.roman === 'string' && o.roman.length > 0
          );
          if (hOverride) {
            label = hOverride.roman;
            if (Array.isArray(hOverride.figures) && hOverride.figures.length > 0) {
              label += hOverride.figures.join('');
            }
          }
          progression.push(label);
        }
      } catch {
        // skip
      }
    }

    // Deduplicate consecutive repeats (held chords across beats)
    const deduped: string[] = [];
    for (const chord of progression) {
      if (deduped.length === 0 || deduped[deduped.length - 1] !== chord) {
        deduped.push(chord);
      }
    }

    console.log(`  ${path.basename(filePath)}: ${deduped.length} chords → ${deduped.slice(0, 8).join(' → ')}…`);

    // Count unigrams
    for (const chord of deduped) {
      unigramCounts[chord] = (unigramCounts[chord] || 0) + 1;
      const base = stripFigures(chord);
      unigramCountsBase[base] = (unigramCountsBase[base] || 0) + 1;
    }

    // Count bigrams (full + base)
    for (let i = 0; i < deduped.length - 1; i++) {
      const from = deduped[i];
      const to = deduped[i + 1];
      if (!bigrams[from]) bigrams[from] = {};
      bigrams[from][to] = (bigrams[from][to] || 0) + 1;
      const fromB = stripFigures(from);
      const toB = stripFigures(to);
      if (!bigramsBase[fromB]) bigramsBase[fromB] = {};
      bigramsBase[fromB][toB] = (bigramsBase[fromB][toB] || 0) + 1;
      totalTransitions++;
    }

    // Count trigrams (full + base)
    for (let i = 0; i < deduped.length - 2; i++) {
      const ctx = `${deduped[i]}|${deduped[i + 1]}`;
      const to = deduped[i + 2];
      if (!trigrams[ctx]) trigrams[ctx] = {};
      trigrams[ctx][to] = (trigrams[ctx][to] || 0) + 1;
      const ctxB = `${stripFigures(deduped[i])}|${stripFigures(deduped[i + 1])}`;
      const toB = stripFigures(to);
      if (!trigramsBase[ctxB]) trigramsBase[ctxB] = {};
      trigramsBase[ctxB][toB] = (trigramsBase[ctxB][toB] || 0) + 1;
    }

  } catch (err: any) {
    console.error(`  ERROR processing ${path.basename(filePath)}: ${err.message}`);
  }
}

// ── Output statistics ──────────────────────────────────────────────────
const stats = {
  meta: {
    filesAnalyzed: files.length,
    totalTransitions,
    extractedAt: new Date().toISOString(),
  },
  unigrams: unigramCounts,
  unigramsBase: unigramCountsBase,
  bigrams,
  bigramsBase,
  trigrams,
  trigramsBase,
};

const outDir = path.join(__dirname, '..', 'src', 'data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'progressionStats.json');
fs.writeFileSync(outPath, JSON.stringify(stats, null, 2));

console.log(`\nDone: ${totalTransitions} bigrams, ${Object.keys(trigrams).length} trigram contexts`);
console.log(`Saved to ${outPath}`);

// Print top bigrams
const allBigrams: { from: string; to: string; count: number }[] = [];
for (const [from, targets] of Object.entries(bigrams)) {
  for (const [to, count] of Object.entries(targets)) {
    allBigrams.push({ from, to, count });
  }
}
allBigrams.sort((a, b) => b.count - a.count);
console.log('\nTop 15 bigrams:');
for (const { from, to, count } of allBigrams.slice(0, 15)) {
  console.log(`  ${from} → ${to}: ${count}`);
}
