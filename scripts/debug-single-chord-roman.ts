import { getRomanAnalysis } from '../src/utils/musicTheory';

const chord = [
  { pitch: 'E', octave: 5, midi: 76, noteIndex: 4, isRest: false },
  { pitch: 'B', octave: 4, midi: 71, noteIndex: 11, isRest: false },
  { pitch: 'G', octave: 4, midi: 68, noteIndex: 8, isRest: false },
  { pitch: 'B', octave: 3, midi: 59, noteIndex: 11, isRest: false },
] as any;

const contexts: Array<{ tonic: string; minor: boolean }> = [
  { tonic: 'A', minor: false },
  { tonic: 'C#', minor: true },
  { tonic: 'C#', minor: false },
  { tonic: 'E', minor: false },
];

for (const c of contexts) {
  const r = getRomanAnalysis(chord, c.tonic, c.minor);
  console.log(`${c.tonic}${c.minor ? 'm' : ''}: roman=${r?.roman ?? '-'} type=${r?.type ?? '-'} root=${r?.root ?? '-'} figures=${(r as any)?.figures ?? '-'}`);
}
