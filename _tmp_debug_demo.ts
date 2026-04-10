import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature } from './src/utils/musicTheory';

const proj = JSON.parse(fs.readFileSync('tests/Demo Video.htp', 'utf-8'));
const notes = proj.notes || [];
const tonic = proj.keySignatureRoot || 'C';
const isMinor = Boolean(proj.isMinorMode);
const ts = proj.timeSignature || { top: 4, bottom: 4 };
const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const contexts = proj.analysisContexts || [];
const ornOverrides = proj.ornamentOverrides || [];
const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, undefined, ornOverrides);
const analyzed: any[] = (res as any).analyzedNotes || notes;

// Check specific notes
const targets = [
  { m: 0, b: 2, v: 1, desc: 'm0 b2 D5 (should be escape: step-in C->D, leap-out D->B)' },
  { m: 2, b: 2, v: 1, desc: 'm2 b2 D5 (should be neighbor: C->D->C)' },
  { m: 4, b: 2, v: 1, desc: 'm4 b2 D5 (should be passing: C->D->E)' },
  { m: 5, b: 2, v: 4, desc: 'm5 b2 G2 (detected as passing)' },
  { m: 9, b: 2, v: 1, desc: 'm9 b2 B4' },
];

for (const t of targets) {
  const n = analyzed.find((x: any) => x.measureIndex === t.m && Math.abs(x.beat - t.b) < 0.1 && x.voice === t.v);
  if (!n) { console.log(`${t.desc}: NOT FOUND`); continue; }
  const flags: string[] = [];
  if (n.isPassing) flags.push('P');
  if (n.isNeighbor) flags.push('N');
  if (n.isEscape) flags.push('E');
  if (n.isAppoggiatura) flags.push('App');
  if (n.isSuspension) flags.push('S');
  if (n.isAnticipation) flags.push('Ant');
  console.log(`${t.desc}: ${n.pitch}${n.octave} midi=${n.midi} dur=${n.duration} flags=[${flags.join(',')}]`);
}

// Full dump of voice 1
console.log('\n--- Voice 1 line ---');
const v1 = analyzed
  .filter((n: any) => n.voice === 1 && !n.isRest)
  .sort((a: any, b: any) => a.measureIndex - b.measureIndex || a.beat - b.beat);
for (const n of v1) {
  const flags: string[] = [];
  if (n.isPassing) flags.push('P');
  if (n.isNeighbor) flags.push('N');
  if (n.isEscape) flags.push('E');
  if (n.isAppoggiatura) flags.push('App');
  if (n.isSuspension) flags.push('S');
  const f = flags.length ? ` [${flags.join(',')}]` : '';
  console.log(`  m${n.measureIndex} b${n.beat} ${n.pitch}${n.octave} midi=${n.midi} ${n.duration}${f}`);
}
