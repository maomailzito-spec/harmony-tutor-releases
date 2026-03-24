import { applyHarmonyRules, getRomanAnalysis, identifyChordCandidates } from '../src/utils/musicTheory';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C71 1a.htp', 'utf-8'));
const result = applyHarmonyRules(
  data.notes,
  data.keySignatureRoot,           // keySignature
  data.keySignatureRoot,           // keyTonic
  Boolean(data.isMinorMode),       // isMinor
  data.analysisContexts || [],     // analysisContexts
  data.timeSignature,              // timeSignature
  data.doubleBarlineMeasures,      // doubleBarlineMeasures
  data.ornamentOverrides,          // ornamentOverrides
  data.harmonyOverrides,           // harmonyOverrides
);

const ov = result.autoHarmonyLabelOverrides || [];
console.log('=== Auto overrides (' + ov.length + ') ===');
ov.forEach((o: any) => console.log('  ab=' + o.absBeat, 'roman=' + o.roman, 'fig=' + JSON.stringify(o.figures)));

// Manually check what getRomanAnalysis produces for the relevant beats
const notes = data.notes || [];
const m0b3 = notes.filter((n: any) => n.measureIndex === 0 && n.beat === 3);
const m0b1 = notes.filter((n: any) => n.measureIndex === 0 && n.beat === 1);
const m0b4 = notes.filter((n: any) => n.measureIndex === 0 && Math.abs(n.beat - 4) < 0.1);

console.log('\n=== Manual getRomanAnalysis ===');
console.log('M0B1 notes:', m0b1.map((n: any) => n.pitch + n.midi));
console.log('M0B3 notes:', m0b3.map((n: any) => n.pitch + n.midi));
console.log('M0B1 in F:', getRomanAnalysis(m0b1 as any, 'F', false)?.roman);
console.log('M0B3 in F:', getRomanAnalysis(m0b3 as any, 'F', false)?.roman);
console.log('V_RE test on V/ii:', /^V(\/|$)/.test('V/ii'));

// Check: what do chordEvents look like?
// The timeline should have scanPoints at 0, 1, 2, 3, ... (every beat)
// absBeat=0 → m0b1, absBeat=2 → m0b3
// But wait — C is held as voice3 as a whole note (from m0b1)
// So at absBeat=2, voice 3 still has C
console.log('\nM0B3 + held C as v=3:');
const m0b3_with_c = [...m0b3, { pitch: 'C', midi: 60, noteIndex: 0, octave: 4, accidental: 'natural', voice: 3 }];
console.log('  notes:', m0b3_with_c.map((n: any) => n.pitch + n.midi));
console.log('  in F:', getRomanAnalysis(m0b3_with_c as any, 'F', false)?.roman);


// Also show the analyzed notes for first few beats
console.log('\n=== Analyzed notes (first 8 beats) ===');
const an = result.analyzedNotes || [];
for (const n of an) {
  const m = (n as any).measureIndex ?? 0;
  const b = (n as any).beat ?? 1;
  const ab = m * 4 + (b - 1);
  if (ab <= 8) {
    const r = (n as any).roman || '';
    const orn = (n as any).isPassing ? 'P' : (n as any).isNeighbor ? 'N' : (n as any).isAppoggiatura ? 'App' : '';
    console.log(`  mi=${m} b=${b} pitch=${(n as any).pitch} midi=${(n as any).midi} v=${(n as any).voice} ${orn}`);
  }
}
