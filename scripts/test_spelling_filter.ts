/**
 * test_spelling_filter.ts
 *
 * Non-destructive test: measures the impact of an enharmonic spelling filter
 * on chord identification across the entire test corpus.
 *
 * Usage:  npx tsx scripts/test_spelling_filter.ts
 * Output: scripts/spelling_filter_impact.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
  applyHarmonyRules,
  identifyChordCandidates,
  calculateRomanFromChordInfo,
  computeFiguredBassFromNotes,
} from '../src/utils/musicTheory';

// ── Helpers ──

const mod12 = (n: number) => ((n % 12) + 12) % 12;

const BASE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const INDEX_TO_LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Extract the letter-name from a note's written spelling. */
function letterOf(n: any): string | null {
  if (!n) return null;
  const p = String(n.pitch || '').trim().toUpperCase();
  const m = p.match(/^([A-G])/);
  return m ? m[1] : null;
}

/** Extract the full accidental alteration as semitones from the note. */
function accidentalAlt(n: any): number {
  const p = String(n?.pitch || '').trim();
  const m = p.match(/^[A-Ga-g]([#b]+)$/);
  if (m) {
    const s = m[1];
    return s[0] === '#' ? s.length : -s.length;
  }
  const acc = n?.userAccidental ?? n?.explicitAccidental ?? n?.accidental ?? null;
  if (!acc) return 0;
  const a = String(acc).trim()
    .replace(/♯/g, '#').replace(/♭/g, 'b').replace(/♮/g, '').replace(/𝄪/g, '##').replace(/𝄫/g, 'bb').replace(/^x$/i, '##');
  if (a.startsWith('#')) return a.length;
  if (a.startsWith('b')) return -a.length;
  return 0;
}

/** Given a root (pc) and chord intervals, determine which letter-name the chord
 *  "expects" for each pitch class. This uses standard tertian stacking from the
 *  root's letter. */
function expectedLettersForChord(rootNote: any, intervals: Set<number>): Map<number, string> {
  const rootLetter = letterOf(rootNote);
  if (!rootLetter) return new Map();
  const rootLetterIdx = LETTER_INDEX[rootLetter];
  const rootAlt = accidentalAlt(rootNote);
  const rootPc = mod12(BASE_PC[rootLetter] + rootAlt);

  const result = new Map<number, string>();
  // Map intervals to diatonic stacking (thirds)
  // interval 0 = root, 3/4 = 3rd (2 letters up), 6/7 = 5th (4 letters up),
  // 9/10/11 = 7th (6 letters up), 1/2 = 9th (1 letter up), etc.
  const intervalToLetterStep: Record<number, number> = {
    0: 0,    // root
    1: 1,    // b9 / b2
    2: 1,    // 9 / 2
    3: 2,    // m3
    4: 2,    // M3
    5: 3,    // P4 / 11
    6: 3,    // #4 / b5
    7: 4,    // P5
    8: 4,    // #5 / b6
    9: 5,    // M6 / dim7
    10: 6,   // m7
    11: 6,   // M7
  };

  for (const interval of intervals) {
    const pc = mod12(rootPc + interval);
    const step = intervalToLetterStep[interval] ?? 0;
    const expectedIdx = (rootLetterIdx + step) % 7;
    result.set(pc, INDEX_TO_LETTER[expectedIdx]);
  }
  return result;
}

/** Compute spelling cost: how many notes need enharmonic renaming. */
function spellingCost(candidate: any, originalNotes: any[]): number {
  const expectedLetters = expectedLettersForChord(candidate.root, candidate.intervals);
  if (expectedLetters.size === 0) return 0;

  let cost = 0;
  const seen = new Set<number>(); // avoid counting same pc twice
  for (const n of originalNotes) {
    if (!n || n.isRest) continue;
    const noteLetter = letterOf(n);
    if (!noteLetter) continue;
    const midi = Number(n.midi);
    if (!Number.isFinite(midi)) continue;
    const pc = mod12(midi);
    if (seen.has(pc)) continue;
    seen.add(pc);

    const expected = expectedLetters.get(pc);
    if (expected && expected !== noteLetter) {
      cost += 1;
    }
  }
  return cost;
}

// ── Relative minors for key derivation ──
const RELATIVE_MINORS: Record<string, string> = {
  C: 'A', G: 'E', D: 'B', A: 'F#', E: 'C#', B: 'G#', 'F#': 'D#', 'C#': 'A#',
  F: 'D', Bb: 'G', Eb: 'C', Ab: 'F', Db: 'Bb', Gb: 'Eb', Cb: 'Ab',
};

// ── Main ──

const testsDir = path.resolve(__dirname, '..', 'tests');

type Diff = {
  file: string;
  absBeat: number;
  measure: number;
  beat: number;
  noteNames: string;
  key: string;
  beforeRoman: string;
  afterRoman: string;
  costBefore: number;
  costAfter: number;
};

const diffs: Diff[] = [];
let totalEvents = 0;
let filesAnalyzed = 0;
let filesWithDiffs = 0;

const allFiles = fs.readdirSync(testsDir)
  .filter(f => f.endsWith('.htp') || f.endsWith('.json'))
  .sort();

for (const filename of allFiles) {
  const full = path.join(testsDir, filename);
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch { continue; }

  const notes = data.notes;
  if (!Array.isArray(notes) || notes.length < 2) continue;

  const keySignatureRoot: string = data.keySignatureRoot || 'C';
  const isMinorMode: boolean = !!data.isMinorMode;
  const timeSignature = data.timeSignature || { numerator: 4, denominator: 4 };
  const keyTonic = isMinorMode
    ? RELATIVE_MINORS[keySignatureRoot] || 'A'
    : keySignatureRoot;
  const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

  const keySig = getKeySignature(keySignatureRoot, isMinorMode ? 'Minor' : 'Major');

  let result: any;
  try {
    result = applyHarmonyRules(
      notes, keySig as any, keyTonic, isMinorMode,
      data.analysisContexts || [], timeSignature,
      data.doubleBarlineMeasures || [],
      data.ornamentOverrides || [],
      data.harmonyOverrides || [],
    );
  } catch { continue; }

  const analyzedNotes = (result.analyzedNotes || notes) as any[];
  let timeline: any[];
  try {
    timeline = getActiveNotesTimeline(analyzedNotes as any, timeSignature as any, data.timeSignatureChanges || []);
  } catch { continue; }

  filesAnalyzed++;
  let fileDiffs = 0;

  for (const ev of timeline) {
    const ab = Number(ev.absBeat);
    if (!Number.isFinite(ab)) continue;
    const evNotes = (ev.notes || []).filter((n: any) => n && !n.isRest);
    if (evNotes.length < 2) continue;
    totalEvents++;

    // ── BEFORE: current engine ──
    const raBefore = getRomanAnalysis(evNotes as any, keyTonic, isMinorMode);
    const romanBefore = raBefore?.roman ?? '';
    if (!romanBefore) continue;

    // ── Get all candidates ──
    const candidates = identifyChordCandidates(evNotes as any);
    if (!candidates || candidates.length === 0) continue;

    // ── AFTER: apply spelling filter ──
    // Reorder candidates by: original score - spellingCost * weight
    const SPELLING_WEIGHT = 8; // Each enharmonic mismatch costs 8 score points
    const reranked = candidates.map((c: any) => ({
      ...c,
      spellingCost: spellingCost(c, evNotes),
      adjustedScore: c.score - spellingCost(c, evNotes) * SPELLING_WEIGHT,
    }));
    reranked.sort((a: any, b: any) => b.adjustedScore - a.adjustedScore);

    const bestAfter = reranked[0];
    const bestBefore = candidates[0]; // original best (highest score)

    // Compute roman for the new best
    let romanAfter = '';
    try {
      romanAfter = calculateRomanFromChordInfo(
        { root: bestAfter.root, type: bestAfter.type, intervals: bestAfter.intervals },
        keyTonic, isMinorMode
      ) || '';
    } catch { continue; }

    if (romanAfter === romanBefore) continue;

    // Record the diff
    const costBefore = spellingCost(bestBefore, evNotes);
    const costAfter = bestAfter.spellingCost;
    const measure = Math.floor(ab / beatsPerMeasure) + 1;
    const beat = (ab % beatsPerMeasure) + 1;
    const noteNames = evNotes.map((n: any) =>
      `${n.pitch || '?'}${n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : n.accidental === 'doubleSharp' ? '##' : n.accidental === 'doubleFlat' ? 'bb' : ''}${n.octave ?? ''}`
    ).join(', ');

    diffs.push({
      file: filename,
      absBeat: ab,
      measure,
      beat: Math.round(beat * 100) / 100,
      noteNames,
      key: `${keyTonic}${isMinorMode ? 'm' : ''}`,
      beforeRoman: romanBefore,
      afterRoman: romanAfter,
      costBefore,
      costAfter,
    });
    fileDiffs++;
  }

  if (fileDiffs > 0) filesWithDiffs++;
}

// ── Classify diffs ──
const improvements = diffs.filter(d => d.costAfter < d.costBefore);
const regressions = diffs.filter(d => d.costAfter > d.costBefore);
const neutral = diffs.filter(d => d.costAfter === d.costBefore);

// ── Write report ──
const lines: string[] = [];
lines.push('=== SPELLING FILTER IMPACT REPORT ===');
lines.push('');
lines.push(`Spelling weight used: ${8} score points per enharmonic mismatch`);
lines.push(`Files analyzed: ${filesAnalyzed}`);
lines.push(`Files with differences: ${filesWithDiffs}`);
lines.push(`Total chord events compared: ${totalEvents}`);
lines.push(`Events with different labels: ${diffs.length} (${totalEvents > 0 ? (diffs.length / totalEvents * 100).toFixed(1) : 0}%)`);
lines.push('');
lines.push(`Improvements (spelling cost reduced): ${improvements.length}`);
lines.push(`Regressions (spelling cost increased): ${regressions.length}`);
lines.push(`Neutral (cost same, label changed): ${neutral.length}`);
lines.push('');

if (improvements.length > 0) {
  lines.push('--- IMPROVEMENTS (spelling cost reduced) ---');
  lines.push('');
  for (const d of improvements) {
    lines.push(`[${d.file}] m${d.measure} b${d.beat} (absBeat=${d.absBeat}):`);
    lines.push(`  BEFORE: ${d.beforeRoman}  (spelling cost: ${d.costBefore})`);
    lines.push(`  AFTER:  ${d.afterRoman}  (spelling cost: ${d.costAfter})`);
    lines.push(`  Notes:  ${d.noteNames}`);
    lines.push(`  Key:    ${d.key}`);
    lines.push('');
  }
}

if (regressions.length > 0) {
  lines.push('--- REGRESSIONS (spelling cost increased) ---');
  lines.push('');
  for (const d of regressions) {
    lines.push(`[${d.file}] m${d.measure} b${d.beat} (absBeat=${d.absBeat}):`);
    lines.push(`  BEFORE: ${d.beforeRoman}  (spelling cost: ${d.costBefore})`);
    lines.push(`  AFTER:  ${d.afterRoman}  (spelling cost: ${d.costAfter})`);
    lines.push(`  Notes:  ${d.noteNames}`);
    lines.push(`  Key:    ${d.key}`);
    lines.push('');
  }
}

if (neutral.length > 0) {
  lines.push('--- NEUTRAL (same cost, different label) ---');
  lines.push('');
  for (const d of neutral) {
    lines.push(`[${d.file}] m${d.measure} b${d.beat} (absBeat=${d.absBeat}):`);
    lines.push(`  BEFORE: ${d.beforeRoman}  (spelling cost: ${d.costBefore})`);
    lines.push(`  AFTER:  ${d.afterRoman}  (spelling cost: ${d.costAfter})`);
    lines.push(`  Notes:  ${d.noteNames}`);
    lines.push(`  Key:    ${d.key}`);
    lines.push('');
  }
}

const reportPath = path.resolve(__dirname, 'spelling_filter_impact.txt');
fs.writeFileSync(reportPath, lines.join('\n'));
console.log(`Report written to ${reportPath}`);
console.log(`  ${diffs.length} differences found across ${filesAnalyzed} files`);
console.log(`  Improvements: ${improvements.length}, Regressions: ${regressions.length}, Neutral: ${neutral.length}`);
