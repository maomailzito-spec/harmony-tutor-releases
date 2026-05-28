import fs from 'node:fs';
import {
  getActiveNotesTimeline, identifyChordCandidates,
  calculateRomanFromChordInfo, getChordSymbol, getKeySignature,
  applyHarmonyRules,
} from '../src/utils/musicTheory';
import { staffNoteToSp, spToString } from '../src/utils/spelledPitch';

const fx = JSON.parse(fs.readFileSync('./tests/Dubois n 4 p37.htp', 'utf8'));
const ts = fx.timeSignature;
const bpm = ts.numerator * (4 / ts.denominator);
const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');

console.log(`Key: ${fx.keySignatureRoot} ${fx.isMinorMode ? 'minor' : 'major'}  beatsPerMeasure=${bpm}`);

const res: any = applyHarmonyRules(fx.notes, ks as any, fx.keySignatureRoot, fx.isMinorMode, fx.analysisContexts || [], ts, fx.doubleBarlineMeasures || [], fx.ornamentOverrides || [], fx.harmonyOverrides || []);
const tl = getActiveNotesTimeline(res.analyzedNotes as any, ts as any);

for (const m of [57, 58, 59, 60]) {
  const target = (m - 1) * bpm;
  console.log(`\n--- m${m} b1 (absBeat ${target}) ---`);
  const ev = tl.find((e: any) => Math.abs(e.absBeat - target) < 1e-6);
  if (!ev) { console.log('  (no event)'); continue; }
  const sounding = (ev.notes as any[]).filter(n => n && !n.isRest).sort((a, b) => (a.midi || 0) - (b.midi || 0));
  for (const n of sounding) {
    const sp = staffNoteToSp(n);
    console.log(`  voice ${n.voice}: spelled=${spToString(sp)}  midi=${n.midi}`);
  }
  const cands = identifyChordCandidates(sounding as any);
  const top: any = cands && cands[0];
  if (top) {
    console.log(`  TOP: root=${top.rootSpelled ? spToString(top.rootSpelled) : top.root?.pitch}  type=${top.type}  rootSpelled=${top.rootSpelled ? 'yes' : 'no'}`);
    const roman = calculateRomanFromChordInfo({ root: top.root, type: top.type, intervals: top.intervals, rootSpelled: top.rootSpelled }, fx.keySignatureRoot, fx.isMinorMode);
    console.log(`  roman (isolated, ${fx.keySignatureRoot} maj): ${roman}`);
    console.log(`  symbol: ${getChordSymbol(sounding as any, ks as any, fx.keySignatureRoot)}`);
  }
}

console.log(`\ninferredAnalysisContexts (all):`);
for (const ctx of (res.inferredAnalysisContexts || [])) {
  if (ctx.absBeat >= 56*bpm && ctx.absBeat <= 62*bpm) {
    console.log(`  absBeat=${ctx.absBeat}  m${Math.floor(ctx.absBeat/bpm)+1}  newTonic=${ctx.newTonic} newIsMinor=${ctx.newIsMinor}  score=${ctx.score}  source=${ctx.source}`);
  }
}
console.log(`autoHarmonyLabelOverrides near m58-60:`);
for (const ov of (res.autoHarmonyLabelOverrides || [])) {
  const ab = ov.absBeat ?? 0;
  if (ab >= 56*bpm && ab <= 62*bpm) {
    console.log(`  ${JSON.stringify(ov)}`);
  }
}
