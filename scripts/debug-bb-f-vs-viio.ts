import { getRomanAnalysis, getRomanAnalysisDebugSnapshot } from '../src/utils/musicTheory';

const chord = [
  { id: 's', pitch: 'B', octave: 4, midi: 70, noteIndex: 10, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false },
  { id: 'a', pitch: 'F', octave: 4, midi: 65, noteIndex: 5, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false },
  { id: 't', pitch: 'D', octave: 4, midi: 62, noteIndex: 2, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false },
  { id: 'b', pitch: 'F', octave: 3, midi: 53, noteIndex: 5, explicitAccidental: null, accidental: null, userAccidental: null, isRest: false },
] as any;

const tonic = process.argv[2] || 'Eb';
const isMinor = process.argv.includes('--minor');

console.log('tonic', tonic, 'minor', isMinor);
console.log('roman', getRomanAnalysis(chord, tonic, isMinor));
console.log('debug', getRomanAnalysisDebugSnapshot(chord, tonic, isMinor));
