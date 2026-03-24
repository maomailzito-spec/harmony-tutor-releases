/**
 * Quick check: all labels for C72 3 after the dom7-resolution fix
 */
import { applyHarmonyRules, getRomanAnalysis } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C72 3.htp', 'utf-8'));
const notes = data.notes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const bpm = ts.numerator * (4 / ts.denominator);
const tonic = data.keySignatureRoot || 'Bb';

type Note = typeof notes[number];
const absBeatOf = (n: Note) => n.measureIndex * bpm + (n.beat - 1);
const beatMap = new Map<number, Note[]>();
for (const n of notes) {
    const ab = absBeatOf(n);
    if (!beatMap.has(ab)) beatMap.set(ab, []);
    beatMap.get(ab)!.push(n);
}
const sortedBeats = [...beatMap.keys()].sort((a, b) => a - b);

console.log('=== Raw analysis (getRomanAnalysis in Bb) ===');
for (const ab of sortedBeats) {
    const evNotes = beatMap.get(ab)!;
    if (evNotes.length < 2) continue;
    const mi = evNotes[0].measureIndex;
    const beat = evNotes[0].beat;
    const r = getRomanAnalysis(evNotes as any, tonic, false);
    const roman = String(r?.roman || '');
    const fig = r?.figures || [];
    const pitches = evNotes.map(n => n.pitch + (n.accidental !== 'natural' ? n.accidental : '') + n.midi).join(', ');
    console.log(`  m${mi+1}b${beat} (ab=${ab}) ${roman.padEnd(8)} fig=[${fig.join(',')}]  ${pitches}`);
}

// Also show autoHarmonyLabelOverrides (from predominant pass)
const result = applyHarmonyRules(
    notes, tonic, tonic, false,
    data.analysisContexts || [], ts,
    data.doubleBarlineMeasures, data.ornamentOverrides, data.harmonyOverrides,
);
const ov = (result as any).autoHarmonyLabelOverrides || [];
if (ov.length) {
    console.log('\n=== Auto overrides (predominant pass) ===');
    ov.forEach((o: any) => console.log(`  ab=${o.absBeat} roman=${o.roman} fig=${JSON.stringify(o.figures)}`));
}
