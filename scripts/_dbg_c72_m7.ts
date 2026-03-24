import { applyHarmonyRules, getRomanAnalysis } from '../src/utils/musicTheory';
import fs from 'node:fs';

const file = 'tests/Delamont C72 3.htp';
const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
const notes = data.notes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const bpm = ts.numerator * (4 / ts.denominator);

console.log('Key:', data.keySignatureRoot, 'Minor:', data.isMinorMode);
console.log('TimeSignature:', JSON.stringify(ts), 'beatsPerMeasure:', bpm);

// Measure 7 = measureIndex 6 (0-based) or 7 depending on convention
// Check both
for (const mi of [6, 7]) {
    const mNotes = notes.filter((n: any) => n.measureIndex === mi);
    const beats = [...new Set(mNotes.map((n: any) => n.beat))].sort((a: number, b: number) => a - b);
    console.log(`\n=== Measure ${mi} (beats: ${beats.join(', ')}) ===`);
    for (const b of beats) {
        const bNotes = mNotes.filter((n: any) => Math.abs(n.beat - b) < 0.01);
        console.log(`  Beat ${b}: ${bNotes.map((n: any) => n.pitch + (n.accidental && n.accidental !== 'natural' ? n.accidental : '') + n.midi + 'v' + n.voice).join(', ')}`);
        const roman = getRomanAnalysis(bNotes as any, data.keySignatureRoot || 'Bb', Boolean(data.isMinorMode));
        console.log(`    => roman="${roman?.roman}" figures=${JSON.stringify(roman?.figures)}`);
    }
}

// Run full analysis to see what the pipeline produces
const result = applyHarmonyRules(
    notes,
    data.keySignatureRoot || 'Bb',
    data.keySignatureRoot || 'Bb',
    Boolean(data.isMinorMode),
    data.analysisContexts || [],
    ts,
    data.doubleBarlineMeasures,
    data.ornamentOverrides,
    data.harmonyOverrides,
);

// Check analysis contexts
console.log('\n=== Analysis Contexts ===');
for (const ctx of (data.analysisContexts || [])) {
    console.log(`  m=${ctx.measureIndex} b=${ctx.beat} tonic=${ctx.tonic} minor=${ctx.isMinor}`);
}

// Check autoHarmonyLabelOverrides
const ov = (result as any).autoHarmonyLabelOverrides || [];
console.log('\n=== Auto overrides ===');
for (const o of ov) {
    console.log(`  ab=${o.absBeat} roman=${o.roman} fig=${JSON.stringify(o.figures)}`);
}

// Check inferred contexts
const inf = (result as any).inferredAnalysisContexts || [];
console.log('\n=== Inferred contexts ===');
for (const ctx of inf) {
    console.log(`  m=${ctx.measureIndex} b=${ctx.beat} tonic=${ctx.tonic} minor=${ctx.isMinor}`);
}
