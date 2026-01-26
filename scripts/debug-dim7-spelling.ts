import { identifyChordCandidates } from '../src/utils/musicTheory';
import type { StaffNote } from '../src/types';

const n = (id: string, pitch: string, octave: number, midi: number, accidental: any): StaffNote => ({
  id,
  pitch,
  octave,
  midi,
  noteIndex: midi % 12,
  position: 0,
  duration: 'quarter',
  beat: 1,
  measureIndex: 0,
  voice: 1,
  accidental,
  explicitAccidental: accidental,
});

// Eb°7 written as Eb–Gb–Bbb–Dbb.
// Pitch-classes: Eb=3, Gb=6, Bbb(A)=9, Dbb(C)=0.
const chord: StaffNote[] = [
  n('eb4', 'E', 4, 63, 'flat'),
  n('gb4', 'G', 4, 66, 'flat'),
  n('bbb4', 'B', 4, 69, 'double-flat'),
  n('dbb5', 'D', 5, 72, 'double-flat'),
];

const cands = identifyChordCandidates(chord);

console.log('Input spellings:', chord.map(x => `${x.pitch}${x.accidental ?? ''}${x.octave} midi=${x.midi}`));
console.log('Candidates (top 6):');
for (const c of cands.slice(0, 6) as any[]) {
  const root = c.root;
  const rootName = `${root.pitch}${root.explicitAccidental ?? root.accidental ?? ''}${root.octave}`;
  console.log({ type: c.type, matchType: c.matchType, score: c.score, rootName, rootPc: root.noteIndex });
}

const best = cands[0] as any;
if (best) {
  const root = best.root;
  const rootName = `${root.pitch}${root.explicitAccidental ?? root.accidental ?? ''}${root.octave}`;
  console.log('BEST:', { type: best.type, rootName, rootPc: root.noteIndex });
}
