import { getRomanAnalysis } from './src/utils/musicTheory';

function makeNote(midi: number, voice: number, clef: string): any {
  const pitchNames = ['C','C','D','D','E','F','F','G','G','A','A','B'];
  const accidentals = ['','sharp','','sharp','','','sharp','','sharp','','sharp',''];
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return {
    id: `note-${midi}-${voice}`,
    pitch: pitchNames[pc],
    accidental: accidentals[pc] || undefined,
    octave,
    midi,
    voice,
    clef,
    position: 0,
    duration: 'quarter',
    measureIndex: 2,
    beat: 4,
  };
}

// D major. Beat 4 resolved: A2(45)-C4(60)-F4(65)-Eb5(75)
// F-A-C-Eb = F7 = V7/bVI in D major
// But A is in the bass, so it's V7/bVI in 3rd inversion
const notes1 = [
  { ...makeNote(45, 4, 'bass'), pitch: 'A', accidental: undefined, octave: 2 },
  { ...makeNote(60, 3, 'bass'), pitch: 'C', accidental: undefined, octave: 4 },
  { ...makeNote(65, 2, 'treble'), pitch: 'F', accidental: undefined, octave: 4 },
  { ...makeNote(75, 1, 'treble'), pitch: 'E', accidental: 'flat', octave: 5 },
];
const r1 = getRomanAnalysis(notes1, 'D', false);
console.log('A2-C4-F4-Eb5 →', JSON.stringify(r1));

// Beat 3: A2(45)-B3(59)-F4(65)-F5(77) (with suspensions)
const notes2 = [
  { ...makeNote(45, 4, 'bass'), pitch: 'A', accidental: undefined, octave: 2 },
  { ...makeNote(59, 3, 'bass'), pitch: 'B', accidental: undefined, octave: 3 },
  { ...makeNote(65, 2, 'treble'), pitch: 'F', accidental: undefined, octave: 4 },
  { ...makeNote(77, 1, 'treble'), pitch: 'F', accidental: undefined, octave: 5 },
];
const r2 = getRomanAnalysis(notes2, 'D', false);
console.log('A2-B3-F4-F5 →', JSON.stringify(r2));

// Try root position F7: F3-A3-C4-Eb4
const notes3 = [
  { ...makeNote(53, 4, 'bass'), pitch: 'F', accidental: undefined, octave: 3 },
  { ...makeNote(57, 3, 'bass'), pitch: 'A', accidental: undefined, octave: 3 },
  { ...makeNote(60, 2, 'treble'), pitch: 'C', accidental: undefined, octave: 4 },
  { ...makeNote(63, 1, 'treble'), pitch: 'E', accidental: 'flat', octave: 4 },
];
const r3 = getRomanAnalysis(notes3, 'D', false);
console.log('F3-A3-C4-Eb4 →', JSON.stringify(r3));
