import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { noteNameToPc } from '../src/utils/spelledPitch';
import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';

const fx = JSON.parse(fs.readFileSync('./tests/Dubois n 4 p37.htp', 'utf8'));
const ts = fx.timeSignature;
const bpm = ts.numerator * (4 / ts.denominator);
const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
const currentTonic = fx.keySignatureRoot;
const isMinorMode = !!fx.isMinorMode;

const analysisResult: any = applyHarmonyRules(
  fx.notes, ks as any, currentTonic, isMinorMode,
  fx.analysisContexts || [], ts, fx.doubleBarlineMeasures || [],
  fx.ornamentOverrides || [], fx.harmonyOverrides || []
);

const inferred = (analysisResult.inferredAnalysisContexts || [])
  .filter((c: any) => typeof c.score === 'number' && c.score >= 12);
const effectiveAnalysisContexts = [...(fx.analysisContexts || []), ...inferred];

const noteNameToChromaticIndex = (name: string): number => noteNameToPc(name);

const analysisContextAbsBeat = (ctx: any) => {
  const legacy = (ctx.measureIndex ?? 0) * bpm;
  return Number.isFinite(ctx.absBeat) ? ctx.absBeat : legacy;
};

const NUM_MEASURES = 200;
const layoutData = {
  positionedNotes: analysisResult.analyzedNotes,
  systemsParams: [{
    measureIndices: Array.from({ length: NUM_MEASURES }, (_, i) => i),
    startMeasuresX: Array.from({ length: NUM_MEASURES }, (_, i) => i * 100),
    width: NUM_MEASURES * 100,
  }],
};

const labels = computeHarmonyLabelsBySystem({
  isAnalysisEnabled: true,
  layoutData: layoutData as any,
  timeSignature: ts,
  timeSignatureChanges: fx.timeSignatureChanges || [],
  effectiveAnalysisContexts,
  analysisContextAbsBeat,
  currentTonic,
  isMinorMode,
  minorScaleMode: 'harmonic',
  harmonyOverrides: fx.harmonyOverrides || [],
  analysisResult,
  analyzedNotes: analysisResult.analyzedNotes,
  noteNameToChromaticIndex,
  startX: 0,
  measurePaddingX: 0,
});

console.log('\nLabels near m58 (absBeat 228):');
const flat = (labels || []).flat();
for (const lbl of flat) {
  const ab = (lbl as any).absBeat;
  if (ab >= 224 - 0.1 && ab <= 240 + 0.1) {
    console.log(`  ab=${ab}  m=${Math.floor(ab/bpm)+1}  roman=${JSON.stringify((lbl as any).roman)}  romanDisplay=${JSON.stringify((lbl as any).romanDisplay)}  symbol=${JSON.stringify((lbl as any).symbol)}  figures=${JSON.stringify((lbl as any).figures)}`);
  }
}
