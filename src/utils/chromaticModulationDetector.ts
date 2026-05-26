/**
 * Chromatic Window Modulation Detector
 *
 * Detects modulations that lack traditional cadential preparation (V→I)
 * by analysing the pitch-class content of consecutive measures against
 * all 24 major/minor scales.
 *
 * If a non-home key explains ≥ 92% of the pitch-classes for ≥ 3 consecutive
 * measures while the home key explains ≤ 72%, a modulation is inferred.
 */

import type { StaffNote, AnalysisContext, TimeSignature, TimeSignatureChange } from '../services/types';
import { noteNameToPc, getScalePcs } from './cadentialPatterns';

// ── helpers ──────────────────────────────────────────────────────────

const PC_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PC_NAMES_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

/** Extended scale set: for minor keys includes harmonic 7th and melodic 6th+7th */
function getExtendedScalePcs(tonicPc: number, isMinor: boolean): Set<number> {
  const nat = getScalePcs(tonicPc, isMinor);
  if (!isMinor) return new Set(nat);
  const harm7 = ((tonicPc + 11) % 12 + 12) % 12;
  const mel6  = ((tonicPc + 9 ) % 12 + 12) % 12;
  return new Set([...nat, harm7, mel6]);
}

/** All 24 key candidates (12 maj + 12 min) with their diatonic pc sets. */
function allKeyCandidates(): { name: string; pc: number; isMinor: boolean; pcs: Set<number> }[] {
  const results: { name: string; pc: number; isMinor: boolean; pcs: Set<number> }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    results.push({
      name: `${PC_NAMES_FLAT[pc]}`,
      pc,
      isMinor: false,
      pcs: new Set(getScalePcs(pc, false)),
    });
    results.push({
      name: `${PC_NAMES_FLAT[pc]}`,
      pc,
      isMinor: true,
      pcs: getExtendedScalePcs(pc, true),
    });
  }
  return results;
}

// ── thresholds ───────────────────────────────────────────────────────

const MIN_WINDOW_MEASURES = 3;
const FIT_THRESHOLD = 0.92;
const HOME_GAP = 0.15;

// ── main ─────────────────────────────────────────────────────────────

export interface ChromaticModulationResult {
  startMeasure: number;   // 0-indexed
  endMeasure: number;     // 0-indexed inclusive
  newTonicPc: number;
  newTonicName: string;
  newIsMinor: boolean;
  fitPercent: number;
  homeFitPercent: number;
}

/**
 * Detect modulations by chromatic window analysis.
 * Returns inferred modulation regions that can be converted to AnalysisContexts.
 */
export function detectChromaticModulations(
  notes: StaffNote[],
  currentTonic: string,
  isMinorMode: boolean,
  _timeSignature?: TimeSignature,
  _timeSignatureChanges?: TimeSignatureChange[],
  existingContexts?: AnalysisContext[],
): ChromaticModulationResult[] {
  const real = notes.filter(n => n && !n.isRest);
  if (real.length < 12) return [];

  const tonicPc = noteNameToPc(currentTonic);
  // Use NATURAL scale (7 pcs) for homeFit — the extended scale (10 pcs for minor)
  // is too permissive and masks parallel major/minor modulations.
  const homePcs = new Set(getScalePcs(tonicPc, isMinorMode));
  const keys = allKeyCandidates();

  // Group pitch-classes by measure
  const byMeasure = new Map<number, Set<number>>();
  for (const n of real) {
    const m = (n as any).measureIndex as number;
    if (m == null) continue;
    if (!byMeasure.has(m)) byMeasure.set(m, new Set());
    byMeasure.get(m)!.add(n.midi % 12);
  }

  const measures = [...byMeasure.keys()].sort((a, b) => a - b);

  // Measures already covered by existing (manual/cadential) contexts
  const coveredMeasures = new Set<number>();
  if (existingContexts) {
    for (const ctx of existingContexts) {
      if (ctx.measureIndex != null) coveredMeasures.add(ctx.measureIndex);
    }
  }

  // Per-measure scoring
  interface MScore {
    measure: number;
    bestKeyPc: number;
    bestKeyMinor: boolean;
    bestKeyName: string;
    bestFit: number;
    homeFit: number;
  }

  const scores: MScore[] = [];
  for (const m of measures) {
    const pcs = byMeasure.get(m)!;
    const pcArr = [...pcs];
    const pcCount = pcArr.length;
    if (pcCount < 2) {
      scores.push({ measure: m, bestKeyPc: -1, bestKeyMinor: false, bestKeyName: '', bestFit: 0, homeFit: 1 });
      continue;
    }

    const homeFit = pcArr.filter(pc => homePcs.has(pc)).length / pcCount;

    let bestKeyPc = -1;
    let bestKeyMinor = false;
    let bestKeyName = '';
    let bestFit = 0;
    for (const k of keys) {
      if (k.pc === tonicPc && k.isMinor === isMinorMode) continue;
      const fit = pcArr.filter(pc => k.pcs.has(pc)).length / pcCount;
      if (fit > bestFit || (fit === bestFit && k.pc === tonicPc)) {
        // When fit is tied, prefer parallel major/minor (same tonic pc)
        bestFit = fit;
        bestKeyPc = k.pc;
        bestKeyMinor = k.isMinor;
        bestKeyName = k.name;
      }
    }
    scores.push({ measure: m, bestKeyPc, bestKeyMinor, bestKeyName, bestFit, homeFit });
  }

  // Find consecutive runs dominated by a single non-home key
  const results: ChromaticModulationResult[] = [];
  let runStart = -1;
  let runKeyPc = -1;
  let runKeyMinor = false;
  let runKeyName = '';
  let runFitSum = 0;
  let runHomeFitSum = 0;
  let runLen = 0;

  const flushRun = () => {
    if (runLen >= MIN_WINDOW_MEASURES) {
      const avgFit = runFitSum / runLen;
      const avgHomeFit = runHomeFitSum / runLen;
      if (avgFit >= FIT_THRESHOLD && (avgFit - avgHomeFit) >= HOME_GAP) {
        // Don't duplicate contexts that already exist
        const alreadyCovered = coveredMeasures.has(runStart);
        if (!alreadyCovered) {
          // Spelling-aware naming. The previous heuristic
          // `currentTonic.includes('b') || isMinorMode` was wrong because many
          // minor keys are sharp-side (E minor, B minor, F# minor, C# minor).
          // For Because (E minor), a tonicization to pc=1 must read "C#m"
          // (sharp side, matching the home key signature), not "Dbm".
          //
          // Resolution: use the home key signature side as the spelling guide.
          //   – explicit 'b' / '#' in tonic name wins
          //   – natural-letter tonic: F is the only flat-side major; the
          //     flat-side minors are D, G, C, F (3+ flats in their relative
          //     major), the others are sharp/neutral.
          const usesFlats = (() => {
            if (currentTonic.includes('b')) return true;
            if (currentTonic.includes('#')) return false;
            if (isMinorMode) return ['D','G','C','F'].includes(currentTonic);
            return currentTonic === 'F';
          })();
          const name = usesFlats ? PC_NAMES_FLAT[runKeyPc] : PC_NAMES_SHARP[runKeyPc];
          results.push({
            startMeasure: runStart,
            endMeasure: runStart + runLen - 1,
            newTonicPc: runKeyPc,
            newTonicName: name,
            newIsMinor: runKeyMinor,
            fitPercent: Math.round(avgFit * 100),
            homeFitPercent: Math.round(avgHomeFit * 100),
          });
        }
      }
    }
    runStart = -1;
    runKeyPc = -1;
    runKeyMinor = false;
    runKeyName = '';
    runFitSum = 0;
    runHomeFitSum = 0;
    runLen = 0;
  };

  for (const ms of scores) {
    const dominated = ms.bestFit >= FIT_THRESHOLD && (ms.bestFit - ms.homeFit) >= HOME_GAP * 0.5;
    if (dominated && (runKeyPc === -1 || (runKeyPc === ms.bestKeyPc && runKeyMinor === ms.bestKeyMinor))) {
      if (runStart < 0) runStart = ms.measure;
      runKeyPc = ms.bestKeyPc;
      runKeyMinor = ms.bestKeyMinor;
      runKeyName = ms.bestKeyName;
      runFitSum += ms.bestFit;
      runHomeFitSum += ms.homeFit;
      runLen++;
    } else {
      flushRun();
      if (dominated) {
        runStart = ms.measure;
        runKeyPc = ms.bestKeyPc;
        runKeyMinor = ms.bestKeyMinor;
        runKeyName = ms.bestKeyName;
        runFitSum = ms.bestFit;
        runHomeFitSum = ms.homeFit;
        runLen = 1;
      }
    }
  }
  flushRun();

  return results;
}

/**
 * Convert detector results to AnalysisContext entries.
 * Each modulation creates a context at the start measure and
 * a "return home" context at the measure after the end.
 */
export function chromaticModulationsToContexts(
  results: ChromaticModulationResult[],
  homeTonic: string,
  homeIsMinor: boolean,
  analysisContextAbsBeat: (ctx: AnalysisContext) => number,
  existingContexts: AnalysisContext[],
): AnalysisContext[] {
  const out: AnalysisContext[] = [];
  for (const r of results) {
    // Start of modulation
    out.push({
      measureIndex: r.startMeasure,
      absBeat: undefined as any,
      newTonic: r.newTonicName,
      newIsMinor: r.newIsMinor,
      source: 'inferred',
    });
    // Return to home key after the modulation ends
    // (only if no existing context already covers the return)
    const returnMeasure = r.endMeasure + 1;
    const returnAlready = existingContexts.some(ctx =>
      ctx.measureIndex === returnMeasure ||
      (ctx.measureIndex != null && Math.abs(ctx.measureIndex - returnMeasure) <= 1
        && ctx.newTonic === homeTonic && ctx.newIsMinor === homeIsMinor)
    );
    if (!returnAlready) {
      out.push({
        measureIndex: returnMeasure,
        absBeat: undefined as any,
        newTonic: homeTonic,
        newIsMinor: homeIsMinor,
        source: 'inferred',
      });
    }
  }
  return out;
}
