import * as fs from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline, getRomanAnalysis } from '../src/utils/musicTheory';
import { detectVoiceLeadingSequences } from '../src/utils/sequenceDetector';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import { TICKS_PER_QUARTER } from '../src/constants';

const dir = './tests';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.htp') || f.endsWith('.json'));
const out: any[] = [];

for (const f of files) {
  let fx: any;
  try { fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!fx?.notes?.length || !fx?.timeSignature) continue;
  const ts = fx.timeSignature;
  const bpm = ts.numerator * (4 / ts.denominator);
  const tonic = fx.keySignatureRoot || fx.keyTonic || 'C';
  const isMinor = !!fx.isMinorMode;
  const ks = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
  let ar: any;
  try {
    ar = applyHarmonyRules(fx.notes, ks as any, tonic, isMinor, fx.analysisContexts || [], ts, fx.doubleBarlineMeasures || [], fx.ornamentOverrides || [], fx.harmonyOverrides || []);
  } catch { continue; }
  const tl = getActiveNotesTimeline(ar.analyzedNotes as any, ts as any);
  const lps = tl.filter((ev: any) => ev?.notes?.length).map((ev: any) => {
    const r = getRomanAnalysis(structuralNotes(ev.notes, new Map()) as any, tonic, isMinor);
    return { absBeat: ev.absBeat, tick: Math.round(ev.absBeat * TICKS_PER_QUARTER), roman: r?.roman };
  });
  let seqs: any[] = [];
  try { seqs = detectVoiceLeadingSequences(ar.analyzedNotes as any, ts, fx.timeSignatureChanges || [], lps as any, undefined, { keySignatureRoot: tonic, isMinorMode: isMinor }) as any; } catch { continue; }
  for (const s of seqs) {
    const slots = s.slotTicks || [];
    const startAbs = (slots[s.startSlotIdx] ?? 0) / TICKS_PER_QUARTER;
    const endAbs = (slots[s.endSlotIdx] ?? 0) / TICKS_PER_QUARTER;
    out.push({ file: f, startAbs, endAbs, L: s.lengthSteps, reps: s.repeatsCount, isMod: !!s.isModulating, transp: s.transpositionSemitones });
  }
}

out.sort((a, b) => a.file.localeCompare(b.file) || a.startAbs - b.startAbs);
for (const r of out) {
  console.log(`${r.file}\tab=${r.startAbs}-${r.endAbs}\tL=${r.L}\treps=${r.reps}\tisMod=${r.isMod}\ttransp=${r.transp}`);
}
console.log(`# total sequences: ${out.length} from ${files.length} files`);
