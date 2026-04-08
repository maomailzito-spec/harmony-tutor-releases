import { computeFiguredBassFromNotes, collectIntervalsAboveBass, getRomanAnalysis } from '../src/utils/musicTheory';

// Minimal dev-only debug helper.
// Usage examples:
//   npx tsx scripts/debug-levels.ts "C3 E3 G3" C major
//   npx tsx scripts/debug-levels.ts "C3 Eb3 Gb3 A3" C major
//   npx tsx scripts/debug-levels.ts "G2 B2 D3 F3 Ab3" C major

type Mode = 'major' | 'minor';

type StaffNote = any;

function pitchClassFromName(name: string): number {
  const m = /^([A-Ga-g])([#b]{0,2})$/.exec(name);
  if (!m) throw new Error(`Bad pitch name: ${name}`);
  const letter = m[1].toUpperCase();
  const acc = m[2] ?? '';
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[letter];
  for (const ch of acc) pc += ch === '#' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

function pcToSharpName(pc: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[((pc % 12) + 12) % 12];
}

function parseNote(token: string): StaffNote {
  // Very small parser for e.g. C#4, Eb3, F2
  const m = /^([A-Ga-g])([#b]{0,2})(-?\d+)$/.exec(token.trim());
  if (!m) throw new Error(`Bad note token: ${token}`);
  const letter = m[1].toUpperCase();
  const accidental = m[2] ?? '';
  const octave = Number(m[3]);
  const pc = pitchClassFromName(`${letter}${accidental}`);
  // MIDI convention: C4 = 60 => midi = (octave + 1) * 12 + pc
  const midi = (octave + 1) * 12 + pc;
  return {
    pitch: `${letter}${accidental}`,
    octave,
    midi,
  };
}

function formatIntervalsL1(intervalSet: any | null): string {
  if (!intervalSet) return '(no bass or no intervals)';
  const parts = (intervalSet.intervals ?? []).map((i: any) => {
    const alt = i.alteration === 0 ? '' : i.alteration > 0 ? `+${i.alteration}` : `${i.alteration}`;
    return `${i.number}${alt}`;
  });
  return parts.join(' ');
}

function main() {
  const noteList = process.argv[2];
  const tonicName = (process.argv[3] ?? 'C').trim();
  const mode = ((process.argv[4] ?? 'major').trim().toLowerCase() as Mode);

  if (!noteList) {
    console.error('Missing note list. Example: "C3 E3 G3"');
    process.exit(1);
  }

  const notes = noteList
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseNote);

  const tonicPc = pitchClassFromName(tonicName);
  const isMinor = mode === 'minor';

  const l1 = collectIntervalsAboveBass(notes as any);
  const l2 = computeFiguredBassFromNotes(notes as any, { omitFiveThree: true });
  const l3 = getRomanAnalysis(notes as any, tonicName, isMinor);

  // Demonstrate L2 invariance against changing L3 context.
  const l3Alt = getRomanAnalysis(notes as any, pcToSharpName((tonicPc + 1) % 12), isMinor);

  console.log('Notes:', noteList);
  console.log('L1 intervals:', formatIntervalsL1(l1));
  console.log('L2 figures:', (l2.figures ?? []).join(' '));
  console.log(`L3 roman (${tonicName} ${mode}):`, l3?.roman ?? '(none)');
  console.log(`L3 roman (tonic+1):`, l3Alt?.roman ?? '(none)');
  console.log('L2 unchanged:', JSON.stringify(l2.figures ?? []) === JSON.stringify(computeFiguredBassFromNotes(notes as any, { omitFiveThree: true }).figures ?? []));
}

main();
