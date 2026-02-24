import { getRomanAnalysis } from '../src/utils/musicTheory';

// m2 b1: F3, C4, F4, A4 — should be VI in Am, but user says it shows as I
// Test in Am context
const notes = [
    { pitch: 'F', octave: 3, midi: 53, noteIndex: 5, voice: 4 },
    { pitch: 'C', octave: 4, midi: 60, noteIndex: 0, voice: 3 },
    { pitch: 'F', octave: 4, midi: 65, noteIndex: 5, voice: 2 },
    { pitch: 'A', octave: 4, midi: 69, noteIndex: 9, voice: 1 },
];

// In A minor context
const resA = getRomanAnalysis(notes as any, 'A', true);
console.log('In Am:', JSON.stringify(resA));

// In C major context (relative major)
const resC = getRomanAnalysis(notes as any, 'C', false);
console.log('In CM:', JSON.stringify(resC));

// In F major (wrong inference)
const resF = getRomanAnalysis(notes as any, 'F', false);
console.log('In FM:', JSON.stringify(resF));

// In D minor
const resD = getRomanAnalysis(notes as any, 'D', true);
console.log('In Dm:', JSON.stringify(resD));
