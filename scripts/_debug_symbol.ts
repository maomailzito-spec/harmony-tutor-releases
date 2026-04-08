import { getChordSymbol, getKeySignature } from '../src/utils/musicTheory';

const keySig = getKeySignature('C', 'Major');

// V42 notes: B4-G4-D4-F3
const v42 = [
  { pitch: 'B', octave: 4, midi: 71, noteIndex: 11, voice: 1, isRest: false, duration: 'half' },
  { pitch: 'G', octave: 4, midi: 67, noteIndex: 7, voice: 2, isRest: false, duration: 'half' },
  { pitch: 'D', octave: 4, midi: 62, noteIndex: 2, voice: 3, isRest: false, duration: 'half' },
  { pitch: 'F', octave: 3, midi: 53, noteIndex: 5, voice: 4, isRest: false, duration: 'half' },
];
console.log('V42 with noteIndex:', JSON.stringify(getChordSymbol(v42 as any, keySig, 'C')));

// Without noteIndex
const v42b = v42.map(n => ({ pitch: n.pitch, octave: n.octave, midi: n.midi, voice: n.voice, isRest: false, duration: n.duration }));
console.log('V42 without noteIndex:', JSON.stringify(getChordSymbol(v42b as any, keySig, 'C')));

// I chord: C5-E4-G4-C4
const chord_I = [
  { pitch: 'C', octave: 5, midi: 72, noteIndex: 0, voice: 1, isRest: false },
  { pitch: 'E', octave: 4, midi: 64, noteIndex: 4, voice: 2, isRest: false },
  { pitch: 'G', octave: 4, midi: 67, noteIndex: 7, voice: 3, isRest: false },
  { pitch: 'C', octave: 4, midi: 60, noteIndex: 0, voice: 4, isRest: false },
];
console.log('I chord:', JSON.stringify(getChordSymbol(chord_I as any, keySig, 'C')));

// IV chord: C5-A4-F4-F3
const chord_IV = [
  { pitch: 'C', octave: 5, midi: 72, noteIndex: 0, voice: 1, isRest: false },
  { pitch: 'A', octave: 4, midi: 69, noteIndex: 9, voice: 2, isRest: false },
  { pitch: 'F', octave: 4, midi: 65, noteIndex: 5, voice: 3, isRest: false },
  { pitch: 'F', octave: 3, midi: 53, noteIndex: 5, voice: 4, isRest: false },
];
console.log('IV chord:', JSON.stringify(getChordSymbol(chord_IV as any, keySig, 'C')));
