import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline, getRomanAnalysis } from '../src/utils/musicTheory';
import { detectVoiceLeadingSequences } from '../src/utils/sequenceDetector';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import { TICKS_PER_QUARTER } from '../src/constants';

const fx = JSON.parse(fs.readFileSync('./tests/Dubois n 4 p37.htp', 'utf8'));
const ts = fx.timeSignature;
const bpm = ts.numerator * (4 / ts.denominator);
const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
const currentTonic = fx.keySignatureRoot;
const isMinorMode = !!fx.isMinorMode;

const ar: any = applyHarmonyRules(
  fx.notes, ks as any, currentTonic, isMinorMode,
  fx.analysisContexts || [], ts, fx.doubleBarlineMeasures || [],
  fx.ornamentOverrides || [], fx.harmonyOverrides || []
);

const tl = getActiveNotesTimeline(ar.analyzedNotes as any, ts as any);

const labelPoints = tl
  .filter((ev: any) => ev?.notes?.length)
  .map((ev: any) => {
    const r = getRomanAnalysis(structuralNotes(ev.notes, new Map()) as any, currentTonic, isMinorMode);
    return {
      absBeat: ev.absBeat,
      tick: Math.round(ev.absBeat * TICKS_PER_QUARTER),
      roman: r?.roman,
      figures: Array.isArray(r?.figures) ? r.figures.map(String) : undefined,
    };
  });

const seqs = detectVoiceLeadingSequences(
  ar.analyzedNotes as any, ts, fx.timeSignatureChanges || [], labelPoints as any, undefined,
  { keySignatureRoot: currentTonic, isMinorMode },
);

console.log(`Sequences found: ${seqs.length}`);
for (const s of (seqs as any[])) {
  const slots = s.slotTicks || [];
  const startTick = slots[s.startSlotIdx ?? 0];
  const startAbsBeat = startTick / TICKS_PER_QUARTER;
  const L = s.lengthSteps ?? 0;
  const reps = s.repeatsCount ?? 2;
  const endTick = slots[(s.startSlotIdx ?? 0) + L * reps] ?? slots[slots.length - 1];
  const endAbsBeat = (endTick ?? 0) / TICKS_PER_QUARTER;
  const covers228 = (startAbsBeat <= 228 + 0.01) && (endAbsBeat >= 228 - 0.01);
  if (!covers228) continue;
  console.log(`\n--- seq covering m58 b1 ---`);
  console.log(`  startAbsBeat=${startAbsBeat} endAbsBeat=${endAbsBeat} L=${L} reps=${reps} isModulating=${s.isModulating} transp=${s.transpositionSemitones}`);
  console.log(`  slots: ${JSON.stringify(slots.map((t: number) => t/TICKS_PER_QUARTER))}`);
  // Print template labels for k=0..L
  console.log(`  TEMPLATE labels:`);
  for (let k = 0; k <= L; k++) {
    const slot = slots[(s.startSlotIdx ?? 0) + k];
    const ab = slot / TICKS_PER_QUARTER;
    const lp = labelPoints.find(p => Math.abs(p.absBeat - ab) < 0.01);
    console.log(`    k=${k} ab=${ab}  roman=${JSON.stringify(lp?.roman)}  figs=${JSON.stringify(lp?.figures)}`);
  }
  for (let r = 1; r < reps; r++) {
    console.log(`  REPEAT r=${r} labels:`);
    for (let k = 0; k <= L; k++) {
      const slot = slots[(s.startSlotIdx ?? 0) + r * L + k];
      const ab = slot / TICKS_PER_QUARTER;
      const lp = labelPoints.find(p => Math.abs(p.absBeat - ab) < 0.01);
      console.log(`    r=${r} k=${k} ab=${ab}  roman=${JSON.stringify(lp?.roman)}  figs=${JSON.stringify(lp?.figures)}`);
    }
  }
}
