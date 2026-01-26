import { getRomanAnalysis } from '../src/utils/musicTheory';

const chord = [
  { id: 's', pitch: 'B', octave: 4, midi: 70, noteIndex: 10, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false, isNeighbor: true },
  { id: 'a', pitch: 'F', octave: 4, midi: 65, noteIndex: 5, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false },
  { id: 't', pitch: 'D', octave: 4, midi: 62, noteIndex: 2, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false },
  { id: 'b', pitch: 'F', octave: 3, midi: 53, noteIndex: 5, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false },
] as any;

console.log(getRomanAnalysis(chord, 'Eb', false));
