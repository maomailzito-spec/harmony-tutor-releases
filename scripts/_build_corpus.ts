/**
 * _build_corpus.ts
 *
 * Reads ALL .json and .htp files from tests/ directory, runs the same analysis
 * pipeline as regression-check.ts, extracts Roman numeral labels for each
 * timeline event, and accumulates unigram/bigram/trigram statistics.
 *
 * Output is written to src/data/progressionStats.json in the exact format
 * consumed by progressionSuggester.ts.
 *
 * Usage:  npx tsx scripts/_build_corpus.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

// ── Strip figured-bass suffixes (same regex as progressionSuggester.ts) ──────

function stripFigures(label: string): string {
  return label.replace(/[0-9♭♯]+$/g, '');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

interface AnalysisCtx {
  absBeat: number;
  newTonic: string;
  newIsMinor: boolean;
}

/**
 * Given the global key, user-supplied analysisContexts, and inferred modulation
 * contexts, determine the local tonic and mode at a given absBeat.
 */
function getLocalKey(
  absBeat: number,
  globalTonic: string,
  globalIsMinor: boolean,
  userContexts: AnalysisCtx[],
  inferredContexts: AnalysisCtx[],
): { tonic: string; isMinor: boolean } {
  // Merge user + inferred, sorted by absBeat ascending
  const all = [...(userContexts || []), ...(inferredContexts || [])]
    .filter(c => c && typeof c.absBeat === 'number' && Number.isFinite(c.absBeat))
    .sort((a, b) => a.absBeat - b.absBeat);

  let tonic = globalTonic;
  let isMinor = globalIsMinor;

  for (const ctx of all) {
    if (ctx.absBeat <= absBeat + 1e-9) {
      tonic = ctx.newTonic || tonic;
      isMinor = !!ctx.newIsMinor;
    } else {
      break;
    }
  }

  return { tonic, isMinor };
}

/**
 * Filter out ornamental (non-structural) notes from the event note list.
 * After applyHarmonyRules, analyzed notes carry flags like isPassing, isNeighbor,
 * isAnticipation, isAppoggiatura, isEscape, isSuspension.
 */
function filterStructural(notes: any[]): any[] {
  return (notes || []).filter((n: any) => {
    if (!n || n.isRest) return false;
    if (n.isPassing || n.isNeighbor || n.isAnticipation ||
        n.isAppoggiatura || n.isEscape) return false;
    // Keep suspensions as they represent the harmonic context
    return true;
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const testsDir = path.resolve(__dirname, '..', 'tests');
  const outPath = path.resolve(__dirname, '..', 'src', 'data', 'progressionStats.json');

  const allFiles = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.json') || f.endsWith('.htp'))
    .sort();

  console.log(`Found ${allFiles.length} files in tests/\n`);

  // Accumulators — raw (with figures)
  const unigrams: Record<string, number> = {};
  const bigrams: Record<string, Record<string, number>> = {};
  const trigrams: Record<string, Record<string, number>> = {};

  // Accumulators — base (stripped)
  const unigramsBase: Record<string, number> = {};
  const bigramsBase: Record<string, Record<string, number>> = {};
  const trigramsBase: Record<string, Record<string, number>> = {};

  let filesAnalyzed = 0;
  let totalTransitions = 0;
  let filesSkipped = 0;
  let filesErrored = 0;

  for (const fileName of allFiles) {
    const filePath = path.join(testsDir, fileName);

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);

      // Validate: must have a notes array with at least some entries
      const notes = data.notes;
      if (!Array.isArray(notes) || notes.length === 0) {
        filesSkipped++;
        continue;
      }

      // Must have at least 2 non-rest notes for any meaningful harmony
      const realNotes = notes.filter((n: any) => n && !n.isRest);
      if (realNotes.length < 2) {
        filesSkipped++;
        continue;
      }

      // Extract key info
      const keySignatureRoot: string = data.keySignatureRoot || data.keyTonic || 'C';
      const isMinorMode: boolean = !!data.isMinorMode;
      const timeSignature = data.timeSignature || { numerator: 4, denominator: 4 };
      const analysisContexts = data.analysisContexts || [];
      const timeSignatureChanges = data.timeSignatureChanges || [];
      const harmonyOverrides = data.harmonyOverrides || [];

      // Determine keyTonic (same fallback as regression-check.ts)
      const keyTonic: string = data.keyTonic || keySignatureRoot;

      // Build key signature
      const keySignature = getKeySignature(keySignatureRoot, 'Major');

      // Run the full analysis pipeline
      const result: any = applyHarmonyRules(
        notes,
        keySignature as any,
        keyTonic,
        isMinorMode,
        analysisContexts,
        timeSignature,
        undefined, // doubleBarlineMeasures
        undefined, // ornamentOverrides
        harmonyOverrides.length > 0 ? harmonyOverrides : undefined,
      );

      const analyzedNotes = (result.analyzedNotes || notes) as any[];
      const inferredContexts: AnalysisCtx[] = (result.inferredAnalysisContexts || []).map((c: any) => ({
        absBeat: Number(c?.absBeat ?? 0),
        newTonic: String(c?.newTonic || keyTonic),
        newIsMinor: !!c?.newIsMinor,
      }));

      // Build the timeline from analyzed notes
      const timeline = getActiveNotesTimeline(
        analyzedNotes as any,
        timeSignature,
        timeSignatureChanges,
      );

      if (!timeline || timeline.length === 0) {
        filesSkipped++;
        continue;
      }

      // Extract Roman labels for each timeline event
      const rawLabels: string[] = [];   // with figures (e.g. "V7", "I64")
      const baseLabels: string[] = [];  // stripped (e.g. "V", "I")

      for (const ev of timeline) {
        // Filter to structural notes only
        const structural = filterStructural(ev.notes as any[]);
        if (structural.length < 2) continue;

        // Determine local key at this beat (accounts for modulations)
        const { tonic: localTonic, isMinor: localIsMinor } = getLocalKey(
          ev.absBeat,
          keyTonic,
          isMinorMode,
          analysisContexts,
          inferredContexts,
        );

        const ra = getRomanAnalysis(
          structural as any,
          localTonic,
          localIsMinor,
        );

        if (!ra || !ra.roman) continue;

        const roman = ra.roman.replace(/\s+/g, '');
        if (!roman) continue;

        // Build the raw label: roman + joined figures
        const figures = ra.figures || [];
        const rawLabel = roman + figures.join('');
        const baseLabel = stripFigures(rawLabel);

        if (rawLabel) rawLabels.push(rawLabel);
        if (baseLabel) baseLabels.push(baseLabel);
      }

      if (rawLabels.length < 2) {
        filesSkipped++;
        continue;
      }

      filesAnalyzed++;

      // ── Accumulate raw (with figures) ──────────────────────────────────

      for (const ch of rawLabels) {
        unigrams[ch] = (unigrams[ch] || 0) + 1;
      }

      for (let i = 0; i < rawLabels.length - 1; i++) {
        const from = rawLabels[i];
        const to = rawLabels[i + 1];
        if (!bigrams[from]) bigrams[from] = {};
        bigrams[from][to] = (bigrams[from][to] || 0) + 1;
        totalTransitions++;
      }

      for (let i = 0; i < rawLabels.length - 2; i++) {
        const key = `${rawLabels[i]}|${rawLabels[i + 1]}`;
        const to = rawLabels[i + 2];
        if (!trigrams[key]) trigrams[key] = {};
        trigrams[key][to] = (trigrams[key][to] || 0) + 1;
      }

      // ── Accumulate base (stripped) ─────────────────────────────────────

      for (const ch of baseLabels) {
        unigramsBase[ch] = (unigramsBase[ch] || 0) + 1;
      }

      for (let i = 0; i < baseLabels.length - 1; i++) {
        const from = baseLabels[i];
        const to = baseLabels[i + 1];
        if (!bigramsBase[from]) bigramsBase[from] = {};
        bigramsBase[from][to] = (bigramsBase[from][to] || 0) + 1;
      }

      for (let i = 0; i < baseLabels.length - 2; i++) {
        const key = `${baseLabels[i]}|${baseLabels[i + 1]}`;
        const to = baseLabels[i + 2];
        if (!trigramsBase[key]) trigramsBase[key] = {};
        trigramsBase[key][to] = (trigramsBase[key][to] || 0) + 1;
      }

      console.log(`  ✓ ${fileName}  (${rawLabels.length} events, ${rawLabels.length - 1} transitions)`);

    } catch (err: any) {
      filesErrored++;
      console.error(`  ✗ ${fileName}  ERROR: ${err?.message || err}`);
    }
  }

  // ── Sort keys for deterministic output ─────────────────────────────────────

  const sortObj = (obj: Record<string, number>): Record<string, number> => {
    const sorted: Record<string, number> = {};
    for (const k of Object.keys(obj).sort((a, b) => obj[b] - obj[a])) {
      sorted[k] = obj[k];
    }
    return sorted;
  };

  const sortBigrams = (obj: Record<string, Record<string, number>>): Record<string, Record<string, number>> => {
    const sorted: Record<string, Record<string, number>> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortObj(obj[k]);
    }
    return sorted;
  };

  // ── Build output ───────────────────────────────────────────────────────────

  const output = {
    meta: {
      filesAnalyzed,
      totalTransitions,
      extractedAt: new Date().toISOString(),
    },
    unigrams:     sortObj(unigrams),
    unigramsBase: sortObj(unigramsBase),
    bigrams:      sortBigrams(bigrams),
    bigramsBase:  sortBigrams(bigramsBase),
    trigrams:     sortBigrams(trigrams),
    trigramsBase: sortBigrams(trigramsBase),
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log(`  Files found:      ${allFiles.length}`);
  console.log(`  Files analyzed:   ${filesAnalyzed}`);
  console.log(`  Files skipped:    ${filesSkipped}`);
  console.log(`  Files errored:    ${filesErrored}`);
  console.log(`  Total transitions (raw):  ${totalTransitions}`);
  console.log(`  Unique labels (raw):      ${Object.keys(unigrams).length}`);
  console.log(`  Unique labels (base):     ${Object.keys(unigramsBase).length}`);
  console.log(`  Bigram keys (raw):        ${Object.keys(bigrams).length}`);
  console.log(`  Bigram keys (base):       ${Object.keys(bigramsBase).length}`);
  console.log(`  Trigram keys (raw):       ${Object.keys(trigrams).length}`);
  console.log(`  Trigram keys (base):      ${Object.keys(trigramsBase).length}`);
  console.log('═'.repeat(60));
  console.log(`\n  Output written to: ${path.relative(process.cwd(), outPath)}\n`);
}

main();
