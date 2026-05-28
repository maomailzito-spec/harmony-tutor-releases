import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline, identifyChordCandidates, getChordSymbol } from '../src/utils/musicTheory';
import { staffNoteToSp, spToString } from '../src/utils/spelledPitch';

const fx = JSON.parse(fs.readFileSync('./tests/Dubois n 4 p37.htp', 'utf8'));
const ts = fx.timeSignature;
const bpm = ts.numerator * (4 / ts.denominator);
const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');

const ar: any = applyHarmonyRules(
  fx.notes, ks as any, fx.keySignatureRoot, fx.isMinorMode,
  fx.analysisContexts || [], ts, fx.doubleBarlineMeasures || [],
  fx.ornamentOverrides || [], fx.harmonyOverrides || []
);
const tl = getActiveNotesTimeline(ar.analyzedNotes as any, ts as any);

for (const target of [212, 214, 216, 218, 220, 222, 224, 226, 228]) {
  const ev = tl.find((e: any) => Math.abs(e.absBeat - target) < 1e-6);
  if (!ev) { console.log(`ab=${target}: no event`); continue; }
  const sounding = (ev.notes as any[]).filter(n => n && !n.isRest).sort((a, b) => (a.midi || 0) - (b.midi || 0));
  const spelled = sounding.map((n: any) => spToString(staffNoteToSp(n)));
  const cands = identifyChordCandidates(sounding as any);
  const top: any = cands && cands[0];
  const sym = getChordSymbol(sounding as any, ks as any, fx.keySignatureRoot);
  console.log(`ab=${target} m${Math.floor(target/bpm)+1}b${(target%bpm)+1}: notes=[${spelled.join(',')}]  type=${top?.type}  root=${top?.rootSpelled ? spToString(top.rootSpelled) : top?.root?.pitch}  symbol=${sym}`);
}
