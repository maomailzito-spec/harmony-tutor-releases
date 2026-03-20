/**
 * Debug: why m3 b1 of Delamont C 33 5 shows iv instead of IV
 */
import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis, identifyChordCandidates } from '../src/utils/musicTheory';

const d = JSON.parse(fs.readFileSync('tests/Delamont C 33 5.htp', 'utf8'));
const ks = getKeySignature(d.keySignatureRoot || 'Bb', 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };

// Run analysis
const res = applyHarmonyRules(
    d.notes, ks, d.keySignatureRoot || 'Bb', !!d.isMinorMode,
    d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
    d.ornamentOverrides || []
);
const notes = ((res as any).analyzedNotes || res) as any[];

// m3 b1 notes
const m3b1 = notes.filter((n: any) => n.measureIndex === 2 && Math.abs(n.beat - 1) < 0.01);
console.log('=== m3 b1 analyzed notes ===');
for (const n of m3b1) {
    console.log(`  v${n.voice} ${n.pitch}${n.accidental || ''}${n.octave} midi=${n.midi} noteIndex=${n.noteIndex} isPassing=${n.isPassing} isEscape=${n.isEscape} isNeighbor=${n.isNeighbor}`);
}

// Try getRomanAnalysis directly
const tonic = 'G'; // Gm from Bb major
const isMinor = true;
console.log('\n=== getRomanAnalysis on m3b1 notes ===');
const roman = getRomanAnalysis(m3b1 as any, tonic, isMinor, {});
console.log('Roman:', JSON.stringify(roman, null, 2));

// identifyChordCandidates
console.log('\n=== identifyChordCandidates ===');
const cands = identifyChordCandidates(m3b1 as any);
if (Array.isArray(cands)) {
    for (const c of (cands as any[]).slice(0, 5)) {
        console.log(`  ${c.root?.pitch}${c.root?.accidental||''}${c.root?.octave} type="${c.type}" matchType=${c.matchType} bass=${c.bass?.pitch}${c.bass?.accidental||''}`);
    }
}
