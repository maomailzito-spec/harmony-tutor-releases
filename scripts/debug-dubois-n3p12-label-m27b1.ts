import fs from 'node:fs';

import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';

const file = './tests/Dubois n3 p12.htp';
const fx = JSON.parse(fs.readFileSync(file, 'utf8')) as any;

const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
const res: any = applyHarmonyRules(
  fx.notes,
  ks as any,
  fx.keySignatureRoot,
  fx.isMinorMode,
  fx.analysisContexts || [],
  fx.timeSignature,
);

const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
const absBeatOf = (uiMeasure: number, beat: number) => (uiMeasure - 1) * beatsPerMeasure + (beat - 1);

const inferred = (res.inferredAnalysisContexts || []) as any[];
const manual = (fx.analysisContexts || []) as any[];
const effective = [...manual, ...inferred];
const analysisContextAbsBeat = (ctx: any) => {
  const a = Number(ctx?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(ctx?.measureIndex ?? 0);
  return (Number.isFinite(mi) ? mi : 0) * beatsPerMeasure;
};

// Minimal layoutData: computeHarmonyLabelsBySystem expects systemsParams with
// { measureIndices, startMeasuresX, width } and (optionally) measureStartAbsBeat.
const maxMeasureIndex = (() => {
  try {
    const notes = (res.analyzedNotes || fx.notes) as any[];
    let m = 0;
    for (const n of notes) m = Math.max(m, Number(n?.measureIndex ?? 0) || 0);
    return m;
  } catch {
    return 0;
  }
})();
const measureIndices = Array.from({ length: maxMeasureIndex + 1 }, (_, i) => i);
const startMeasuresX = measureIndices.map((i) => i * 120);
const width = (maxMeasureIndex + 2) * 120;
const layoutData: any = {
  systemsParams: [
    {
      measureIndices,
      startMeasuresX,
      width,
      startX: 0,
    },
  ],
  // Provide measure start absBeats for correctness.
  measureStartAbsBeat: measureIndices.map((i) => i * beatsPerMeasure),
  measureBeatsPerMeasure: measureIndices.map(() => beatsPerMeasure),
};

const labelsBySystem = computeHarmonyLabelsBySystem({
  isAnalysisEnabled: true,
  layoutData,
  timeSignature: fx.timeSignature,
  timeSignatureChanges: fx.timeSignatureChanges || [],
  effectiveAnalysisContexts: effective,
  analysisContextAbsBeat,
  currentTonic: fx.keySignatureRoot,
  isMinorMode: !!fx.isMinorMode,
  minorScaleMode: (fx as any).minorScaleMode,
  harmonyOverrides: fx.harmonyOverrides || [],
  analysisResult: res,
  analyzedNotes: (res.analyzedNotes || fx.notes) as any[],
  noteNameToChromaticIndex: (name: string) => {
    // reuse engine mapping via key signature helper: keep it simple for debug
    const map: Record<string, number> = {
      C: 0,
      'C#': 1,
      Db: 1,
      D: 2,
      'D#': 3,
      Eb: 3,
      E: 4,
      F: 5,
      'F#': 6,
      Gb: 6,
      G: 7,
      'G#': 8,
      Ab: 8,
      A: 9,
      'A#': 10,
      Bb: 10,
      B: 11,
      Cb: 11,
      Fb: 4,
    };
    return map[String(name)] ?? 0;
  },
  startX: 0,
  measurePaddingX: 0,
  harmonyLabelMinSpanBeats: 0,
});

const flat = labelsBySystem.flat();

const targetAbs = absBeatOf(27, 1);

console.log('target', { uiMeasure: 27, beat: 1, absBeat: targetAbs });
console.log('inferredContexts', inferred.map((c) => ({ absBeat: c.absBeat, tonic: c.newTonic, minor: !!c.newIsMinor })));

const near = flat
  .filter((p) => Number.isFinite(Number(p.absBeat)) && Math.abs(Number(p.absBeat) - targetAbs) <= 4.001)
  .sort((a, b) => Number(a.absBeat) - Number(b.absBeat));

console.log('labelsNear');
for (const p of near) {
  console.log({
    absBeat: p.absBeat,
    roman: p.roman,
    romanDisplay: (p as any).romanDisplay ?? null,
    seq: (p as any).sequenceRomanFunctional ?? (p as any).sequenceRoman ?? null,
    figures: p.figures,
    isOverride: !!p.isOverride,
  });
}

const exact = flat.find((p) => Number(p.absBeat) === targetAbs);
console.log('exact', exact ? {
  absBeat: exact.absBeat,
  roman: exact.roman,
  romanDisplay: (exact as any).romanDisplay ?? null,
  seq: (exact as any).sequenceRomanFunctional ?? (exact as any).sequenceRoman ?? null,
  figures: exact.figures,
  isOverride: !!exact.isOverride,
} : null);
