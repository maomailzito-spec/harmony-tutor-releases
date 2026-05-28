/**
 * Debug: traccia esattamente cosa fa il backend su m54 b1 di Dubois n4 p37.
 * Verifica: analyzeChord ritorna F# come root? Phase 5 wrapper engages?
 * calculateRomanFromChordInfo produce vii°/V o vii°/iii?
 */
import fs from 'node:fs';
import {
  getActiveNotesTimeline, identifyChordCandidates,
  calculateRomanFromChordInfo, getChordSymbol, getKeySignature,
  applyHarmonyRules,
} from '../src/utils/musicTheory';
import { analyzeChord } from '../src/engine/spelledChordEngine';
import { staffNoteToSp, spToString } from '../src/utils/spelledPitch';

const fx = JSON.parse(fs.readFileSync('./tests/Dubois n 4 p37.htp', 'utf8'));
const ts = fx.timeSignature;
const bpm = ts.numerator * (4 / ts.denominator);
const target = (54 - 1) * bpm; // m54 b1 = absBeat 53*4 = 212 in 4/4
const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');

console.log(`File: ${fx.name || 'Dubois n 4 p37'}`);
console.log(`Key: ${fx.keySignatureRoot} ${fx.isMinorMode ? 'minor' : 'major'}`);
console.log(`Time: ${ts.numerator}/${ts.denominator}  beatsPerMeasure=${bpm}`);
console.log(`Target: m54 b1 = absBeat ${target}`);

const timeline = getActiveNotesTimeline(fx.notes as any, ts as any);
const ev = timeline.find((e: any) => Math.abs(e.absBeat - target) < 1e-6);
if (!ev) {
  console.log('NO EVENT at that beat. Available beats near:');
  for (const e of timeline) {
    if (Math.abs(e.absBeat - target) < 4) console.log(`  absBeat ${e.absBeat}`);
  }
  process.exit(1);
}

const sounding = (ev.notes as any[]).filter(n => n && !n.isRest).sort((a, b) => (a.midi || 0) - (b.midi || 0));
console.log('\nNotes sounding (low to high):');
for (const n of sounding) {
  const sp = staffNoteToSp(n);
  const accStr = n.userAccidental || n.explicitAccidental || n.accidental || '';
  console.log(`  voice ${n.voice}: pitch=${n.pitch}${accStr === 'natural' ? '♮' : accStr} oct=${n.octave} midi=${n.midi}  (spelled: ${spToString(sp)})`);
}

console.log('\n=== analyzeChord (new engine) ===');
const spelled = sounding.map(n => staffNoteToSp(n));
const bassSp = staffNoteToSp(sounding[0]);
const analyzed = analyzeChord(spelled, { bass: bassSp });
if (analyzed) {
  console.log(`  root: ${spToString(analyzed.root)}`);
  console.log(`  quality: ${analyzed.quality}`);
  console.log(`  missing: ${JSON.stringify(analyzed.missingDegrees)}`);
  console.log(`  extras: ${JSON.stringify(analyzed.extraNoteIndices)}`);
  console.log(`  confidence: ${analyzed.confidence}`);
} else {
  console.log('  null');
}

console.log('\n=== identifyChordCandidates top (Phase 5 wrapper) ===');
const cands = identifyChordCandidates(sounding as any);
const top: any = cands && cands[0];
if (top) {
  console.log(`  root=${top.root?.pitch}${top.root?.explicitAccidental || ''}${top.root?.octave}  midi=${top.root?.midi}`);
  console.log(`  type=${top.type}  matchType=${top.matchType}  score=${top.score}`);
  console.log(`  rootSpelled=${top.rootSpelled ? spToString(top.rootSpelled) : 'NONE'}`);
} else { console.log('  null'); }

console.log('\n=== calculateRomanFromChordInfo (isolated, C major) ===');
if (top) {
  const roman = calculateRomanFromChordInfo({ root: top.root, type: top.type, intervals: top.intervals, rootSpelled: top.rootSpelled }, fx.keySignatureRoot, fx.isMinorMode);
  console.log(`  roman: ${roman}`);
}

console.log('\n=== getChordSymbol (isolated) ===');
console.log(`  symbol: ${getChordSymbol(sounding as any, ks as any, fx.keySignatureRoot)}`);

console.log('\n=== FULL PIPELINE: applyHarmonyRules ===');
const res: any = applyHarmonyRules(fx.notes, ks as any, fx.keySignatureRoot, fx.isMinorMode, fx.analysisContexts || [], ts, fx.doubleBarlineMeasures || [], fx.ornamentOverrides || [], fx.harmonyOverrides || []);
const tl = getActiveNotesTimeline(res.analyzedNotes as any, ts as any);
const evFull = tl.find((e: any) => Math.abs(e.absBeat - target) < 1e-6);
if (evFull) {
  console.log(`  found event at beat ${target}`);
  // The roman comes from harmonyPostRules.ts via applyStatelessRules. Search the labels.
}
console.log(`  inferredAnalysisContexts active near beat ${target}:`);
for (const ctx of (res.inferredAnalysisContexts || [])) {
  if (ctx.absBeat <= target + 0.01) {
    console.log(`    absBeat=${ctx.absBeat}  newTonic=${ctx.newTonic} newIsMinor=${ctx.newIsMinor}  score=${ctx.score}  source=${ctx.source}`);
  }
}
console.log(`  autoHarmonyLabelOverrides near beat ${target}:`);
for (const ov of (res.autoHarmonyLabelOverrides || [])) {
  if (Math.abs((ov.absBeat ?? 0) - target) < 0.5) {
    console.log(`    ${JSON.stringify(ov)}`);
  }
}
