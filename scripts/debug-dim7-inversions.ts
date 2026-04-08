import { identifyChordCandidates } from '../src/utils/musicTheory';
import type { StaffNote } from '../src/types';

const n = (id: string, pitch: string, octave: number, midi: number, explicitAccidental: any = null): StaffNote => ({
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
  accidental: explicitAccidental ?? undefined,
  explicitAccidental: explicitAccidental,
});

// G#°7 in A minor: G#–B–D–F
const base: StaffNote[] = [
  n('g#4', 'G', 4, 68, 'sharp'),
  n('b4', 'B', 4, 71, null),
  n('d5', 'D', 5, 74, null),
  n('f5', 'F', 5, 77, null),
];

const rotations = [
  ['g#4', 'b4', 'd5', 'f5'],
  ['b4', 'd5', 'f5', 'g#4'],
  ['d5', 'f5', 'g#4', 'b4'],
  ['f5', 'g#4', 'b4', 'd5'],
];

const byId = new Map(base.map(x => [x.id, x] as const));

for (const order of rotations) {
  const chord = order.map(id => byId.get(id)!).map((x, i) => ({ ...x, voice: (i + 1) as any }));
  const cands = identifyChordCandidates(chord);
  const best = cands[0] as any;
  const root = best?.root;
  const rootName = root ? `${root.pitch}${root.explicitAccidental ?? root.accidental ?? ''}${root.octave}` : '—';
  console.log('---', order.join(' '));
  console.log('best', { type: best?.type, matchType: best?.matchType, score: best?.score, rootName, rootPc: root?.noteIndex });
}
