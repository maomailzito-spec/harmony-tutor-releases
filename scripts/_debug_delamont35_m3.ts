import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis, identifyChordCandidates } from '../src/utils/musicTheory';

const d = JSON.parse(fs.readFileSync('tests/Delamont C 35 4 .htp', 'utf8'));
console.log('Key:', d.keySignatureRoot, 'minor:', d.isMinorMode);

// Notes at m3 b2
const m3b2 = (d.notes || []).filter((n: any) => n.measureIndex === 2 && Math.abs(n.beat - 2) < 0.01);
console.log('\nm3 b2 raw notes:');
for (const n of m3b2) {
    console.log(`  v${n.voice} ${n.pitch}${n.accidental || ''}${n.octave} midi=${n.midi} dur=${n.duration}`);
}

// All m3 notes for context
const m3 = (d.notes || []).filter((n: any) => n.measureIndex === 2);
console.log('\nm3 all notes:');
for (const n of m3.sort((a: any, b: any) => a.beat - b.beat || a.voice - b.voice)) {
    console.log(`  b${n.beat} v${n.voice} ${n.pitch}${n.accidental || ''}${n.octave} midi=${n.midi} dur=${n.duration}`);
}

// Run analysis
const ks = getKeySignature(d.keySignatureRoot || 'F', 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const res = applyHarmonyRules(
    d.notes, ks, d.keySignatureRoot || 'F', !!d.isMinorMode,
    d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
    d.ornamentOverrides || []
);
const analyzed = ((res as any).analyzedNotes || res) as any[];

// m3 b2 analyzed
const m3b2a = analyzed.filter((n: any) => n.measureIndex === 2 && Math.abs(n.beat - 2) < 0.01);
console.log('\nm3 b2 analyzed:');
for (const n of m3b2a) {
    const marks = [n.isPassing && 'P', n.isNeighbor && 'N', n.isAppoggiatura && 'App', n.isEscape && 'Esc', n.isAnticipation && 'Ant', n.isSuspension && 'Sus'].filter(Boolean).join(',');
    console.log(`  v${n.voice} ${n.pitch}${n.accidental || ''}${n.octave} midi=${n.midi} ${marks || 'structural'}`);
}

// Determine tonic for Dm
const tonic = d.isMinorMode ? 'D' : d.keySignatureRoot;
const isMinor = !!d.isMinorMode;

// identifyChordCandidates on structural notes at m3b2
const structural = m3b2a.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isEscape && !n.isAnticipation && !n.isSuspension && !n.isRest);
console.log('\nm3 b2 structural for chord ID:');
for (const n of structural) {
    console.log(`  v${n.voice} ${n.pitch}${n.accidental || ''}${n.octave} midi=${n.midi}`);
}

const cands = identifyChordCandidates(structural as any);
console.log('\nChord candidates:');
if (Array.isArray(cands)) {
    for (const c of (cands as any[]).slice(0, 5)) {
        console.log(`  root=${c.root?.pitch}${c.root?.accidental || ''}${c.root?.octave} type="${c.type}" match=${c.matchType} score=${c.score}`);
    }
}

// getRomanAnalysis
const roman = getRomanAnalysis(structural as any, tonic, isMinor, {});
console.log('\ngetRomanAnalysis:', JSON.stringify(roman));

// m3 b1 analyzed — B2 should now be structural
const m3b1a = analyzed.filter((n: any) => n.measureIndex === 2 && Math.abs(n.beat - 1) < 0.01);
console.log('\nm3 b1 analyzed:');
for (const n of m3b1a) {
    const marks = [n.isPassing && 'P', n.isNeighbor && 'N', n.isAppoggiatura && 'App', n.isEscape && 'Esc', n.isAnticipation && 'Ant', n.isSuspension && 'Sus'].filter(Boolean).join(',');
    console.log(`  v${n.voice} ${n.pitch}${n.accidental || ''}${n.octave} midi=${n.midi} noteIndex=${n.noteIndex} ${marks || 'structural'}`);
}

const structB1 = m3b1a.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isEscape && !n.isAnticipation && !n.isSuspension && !n.isRest);
console.log('\nStructural for chord ID:', structB1.map((n: any) => `${n.pitch}${n.accidental || ''}${n.octave}(midi=${n.midi})`).join(', '));

const candsB1 = identifyChordCandidates(structB1 as any);
console.log('\nb1 chord candidates:');
if (Array.isArray(candsB1)) {
    for (const c of (candsB1 as any[]).slice(0, 5)) {
        const ints = c.intervals ? `ints=[${[...c.intervals].join(',')}]` : '';
        console.log(`  root=${c.root?.pitch}${c.root?.accidental || ''}${c.root?.octave}(midi=${c.root?.midi}) type="${c.type}" match=${c.matchType} score=${c.score} ${ints}`);
    }
}

// Roman in D minor (Dm = relative minor of F)
const romanB1 = getRomanAnalysis(structB1 as any, 'D', true, {});
console.log('\ngetRomanAnalysis in Dm:', JSON.stringify(romanB1));

