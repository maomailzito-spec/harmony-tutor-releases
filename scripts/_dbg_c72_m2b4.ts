import { getRomanAnalysis, identifyChordCandidates, applyHarmonyRules } from '../src/utils/musicTheory';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C72 3.htp', 'utf-8'));
const notes = data.notes || [];

// m2 b4 notes: Db73, Eb63, A57, F41
// But there might be held notes from previous beats
// Let's check what the chord event timeline would produce

// First show all m2 notes
console.log('=== ALL M2 notes ===');
const m2 = notes.filter((n: any) => n.measureIndex === 2);
for (const n of m2) {
    console.log(`  b=${n.beat} ${n.pitch}${n.accidental !== 'natural' ? n.accidental : ''} midi=${n.midi} v=${n.voice} dur=${n.duration}`);
}

// m2 b4 raw
const m2b4 = m2.filter((n: any) => Math.abs(n.beat - 4) < 0.01);
console.log('\n=== M2 B4 raw notes ===');
m2b4.forEach((n: any) => console.log(`  ${n.pitch}${n.accidental !== 'natural' ? n.accidental : ''} midi=${n.midi} v=${n.voice}`));

// Analysis in Bb
const r = getRomanAnalysis(m2b4 as any, 'Bb', false);
console.log('M2B4 in Bb:', r?.roman, r?.figures);

// Candidates
const cands = identifyChordCandidates(m2b4 as any);
cands.slice(0, 5).forEach((c: any) => console.log('  cand:', c.root?.pitch, c.type, 'score=' + c.score));

// m3 b1: resolution
const m3b1 = notes.filter((n: any) => n.measureIndex === 3 && Math.abs(n.beat - 1) < 0.01);
console.log('\n=== M3 B1 (resolution) ===');
m3b1.forEach((n: any) => console.log(`  ${n.pitch}${n.accidental !== 'natural' ? n.accidental : ''} midi=${n.midi} v=${n.voice}`));
const r2 = getRomanAnalysis(m3b1 as any, 'Bb', false);
console.log('M3B1 in Bb:', r2?.roman, r2?.figures);

// Check: is C held into m2 b4?
// Looking at durations to see what's sounding
console.log('\n=== Durations check for held notes at m2b4 ===');
const absBeatM2B4 = 2 * 4 + 3; // beat index = 11 (0-based)
console.log('absBeat for m2b4:', absBeatM2B4);

// Check what the FULL pipeline produces as labels
// We need to look at what the label pipeline generates
// Check: does the lookahead tonicization in useHarmonyLabels change this?
// The autoOverrideByAbsBeat should NOT have anything at absBeat 11
const result2 = applyHarmonyRules(
    notes,
    data.keySignatureRoot || 'Bb',
    data.keySignatureRoot || 'Bb',
    Boolean(data.isMinorMode),
    data.analysisContexts || [],
    data.timeSignature || { numerator: 4, denominator: 4 },
    data.doubleBarlineMeasures,
    data.ornamentOverrides,
    data.harmonyOverrides,
);
const ov = (result2 as any).autoHarmonyLabelOverrides || [];
console.log('\nautoHarmonyLabelOverrides:');
ov.forEach((o: any) => console.log(`  ab=${o.absBeat} roman=${o.roman} fig=${JSON.stringify(o.figures)}`));

// Check the chordEvents around absBeat 11
const an = (result2 as any).analyzedNotes || [];
// Show analyzed notes around m2b4
console.log('\nAnalyzed notes near m2b3-m2b4-m3b1:');
for (const n of an) {
    const mi = (n as any).measureIndex ?? -1;
    const b = (n as any).beat ?? 0;
    if ((mi === 2 && b >= 3) || (mi === 3 && b <= 1)) {
        const orn = (n as any).isPassing ? 'P' : (n as any).isNeighbor ? 'N' : (n as any).isAppoggiatura ? 'App' : '';
        console.log(`  mi=${mi} b=${b} ${(n as any).pitch} midi=${(n as any).midi} v=${(n as any).voice} ${orn}`);
    }
}
