import { getRomanAnalysis, identifyChordCandidates } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';

// m2b4 full set  (Db=suspension flagged)
const full = [
    { pitch: 'D', accidental: 'flat', midi: 73, voice: 1, isPassing: false, isNeighbor: false, isAppoggiatura: false, isSuspension: true },
    { pitch: 'E', accidental: 'flat', midi: 63, voice: 2, isPassing: false, isNeighbor: false, isAppoggiatura: false, isSuspension: false },
    { pitch: 'A', accidental: 'natural', midi: 57, voice: 3, isPassing: false, isNeighbor: false, isAppoggiatura: false, isSuspension: false },
    { pitch: 'F', accidental: 'natural', midi: 41, voice: 4, isPassing: false, isNeighbor: false, isAppoggiatura: false, isSuspension: false },
];

const structural = structuralNotes(full as any);
console.log('Structural notes:', structural.map((n: any) => n.pitch + (n.accidental !== 'natural' ? n.accidental : '') + n.midi));

console.log('\n=== With all 4 notes (including Db suspension) ===');
const r1 = getRomanAnalysis(full as any, 'Bb', false);
console.log('Roman:', r1?.roman, 'figures:', r1?.figures);
const c1 = identifyChordCandidates(full as any);
c1.slice(0, 3).forEach((c: any) => console.log('  cand:', c.root?.pitch, c.type, 'score=' + c.score));

console.log('\n=== With structural only (no Db) ===');
const r2 = getRomanAnalysis(structural as any, 'Bb', false);
console.log('Roman:', r2?.roman, 'figures:', r2?.figures);
const c2 = identifyChordCandidates(structural as any);
c2.slice(0, 3).forEach((c: any) => console.log('  cand:', c.root?.pitch, c.type, 'score=' + c.score));

console.log('\n=== Without Db, explicit 3 notes ===');
const noDb = full.filter(n => n.midi !== 73);
const r3 = getRomanAnalysis(noDb as any, 'Bb', false);
console.log('Roman:', r3?.roman, 'figures:', r3?.figures);
const c3 = identifyChordCandidates(noDb as any);
c3.slice(0, 3).forEach((c: any) => console.log('  cand:', c.root?.pitch, c.type, 'score=' + c.score));
