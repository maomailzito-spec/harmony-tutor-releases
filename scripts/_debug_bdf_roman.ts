/**
 * Debug: what does getRomanAnalysis return for B-D-F in C major / Am / E major?
 */
import { getRomanAnalysis } from '../src/utils/musicTheory';

// B-D-F chord (B diminished triad)
const bdf: any[] = [
    { id: 'b3', pitch: 'B', octave: 3, position: -1, midi: 59, noteIndex: 11, clef: 'bass', accidental: 'natural', duration: 'half', isRest: false, voice: 4 },
    { id: 'd4', pitch: 'D', octave: 4, position: 1, midi: 62, noteIndex: 2, clef: 'bass', accidental: 'natural', duration: 'half', isRest: false, voice: 3 },
    { id: 'b4', pitch: 'B', octave: 4, position: 6, midi: 71, noteIndex: 11, clef: 'treble', accidental: 'natural', duration: 'half', isRest: false, voice: 2 },
    { id: 'f5', pitch: 'F', octave: 5, position: 10, midi: 77, noteIndex: 5, clef: 'treble', accidental: 'natural', duration: 'half', isRest: false, voice: 1 },
];

// E-G#-E-E chord (E major)
const egse: any[] = [
    { id: 'e3', pitch: 'E', octave: 3, position: -5, midi: 52, noteIndex: 4, clef: 'bass', accidental: 'natural', duration: 'half', isRest: false, voice: 4 },
    { id: 'e4', pitch: 'E', octave: 4, position: 2, midi: 64, noteIndex: 4, clef: 'bass', accidental: 'natural', duration: 'half', isRest: false, voice: 3 },
    { id: 'g#4', pitch: 'G', octave: 4, position: 4, midi: 68, noteIndex: 8, clef: 'treble', accidental: 'sharp', explicitAccidental: 'sharp', userAccidental: 'sharp', duration: 'half', isRest: false, voice: 2 },
    { id: 'e5', pitch: 'E', octave: 5, position: 9, midi: 76, noteIndex: 4, clef: 'treble', accidental: 'natural', duration: 'half', isRest: false, voice: 1 },
];

const contexts = [
    { key: 'C', minor: false, label: 'C major' },
    { key: 'A', minor: true, label: 'A minor' },
    { key: 'E', minor: false, label: 'E major' },
    { key: 'E', minor: true, label: 'E minor' },
];

console.log('=== B-D-F chord ===');
for (const ctx of contexts) {
    const r = getRomanAnalysis(bdf, ctx.key, ctx.minor);
    console.log(`  ${ctx.label}: ${JSON.stringify(r)}`);
}

console.log('\n=== E-G#-E-E chord ===');
for (const ctx of contexts) {
    const r = getRomanAnalysis(egse, ctx.key, ctx.minor);
    console.log(`  ${ctx.label}: ${JSON.stringify(r)}`);
}
