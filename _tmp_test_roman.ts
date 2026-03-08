import { getRomanAnalysis, identifyChordCandidates, getPitchClassesForDebug } from './src/utils/musicTheory';
import type { StaffNote } from './src/types';

// Recreate the exact 4 notes from beat 115 of Cantata 17
const notes: StaffNote[] = [
  {
    id: 'test-v1', pitch: 'A', octave: 4, midi: 69, noteIndex: 9,
    accidental: 'natural' as any, explicitAccidental: null,
    position: 5, duration: 'half' as any, voice: 1 as any,
  },
  {
    id: 'test-v3', pitch: 'A', octave: 3, midi: 57, noteIndex: 9,
    accidental: 'natural' as any, explicitAccidental: null,
    position: -2, duration: 'half' as any, voice: 3 as any,
  },
  {
    id: 'test-v4', pitch: 'F', octave: 3, midi: 54, noteIndex: 6,
    accidental: 'sharp' as any, explicitAccidental: null,
    position: -4, duration: 'half' as any, voice: 4 as any,
  },
  {
    id: 'test-v2', pitch: 'D', octave: 4, midi: 63, noteIndex: 3,
    accidental: undefined, explicitAccidental: 'sharp' as any,
    position: 1, duration: 'quarter' as any, voice: 2 as any,
  },
];

console.log('=== Pitch classes (debug) ===');
const pcs = getPitchClassesForDebug(notes);
console.log('PCs:', pcs, '→', pcs.map(pc => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][pc]));

console.log('\n=== identifyChordCandidates ===');
try {
  const candidates = identifyChordCandidates(notes);
  console.log('Candidates:', JSON.stringify(candidates?.slice(0, 5), null, 2));
} catch (e: any) {
  console.log('Error:', e.message);
}

console.log('\n=== getRomanAnalysis (A major) ===');
const resultMaj = getRomanAnalysis(notes, 'A', false);
console.log('Result (Major):', JSON.stringify(resultMaj));

console.log('\n=== getRomanAnalysis (A minor) ===');
const resultMin = getRomanAnalysis(notes, 'A', true);
console.log('Result (Minor):', JSON.stringify(resultMin));

// Also test with pitch='D#' instead of pitch='D' + explicitAccidental='sharp'
const notesAlt = notes.map(n => n.id === 'test-v2' ? { ...n, pitch: 'D#' } : n);
console.log('\n=== getRomanAnalysis (A major, pitch="D#") ===');
const resultAlt = getRomanAnalysis(notesAlt as any, 'A', false);
console.log('Result (Major, D#):', JSON.stringify(resultAlt));
