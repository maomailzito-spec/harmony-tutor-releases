/**
 * spelledPitch.ts — Utility functions for spelled (enharmonic-aware) pitches.
 * Central source of truth for NOTE_TO_PC and octave calculation.
 */
import { SpelledPitch } from '../types';

// ── Canonical NOTE_TO_PC ────────────────────────────────────────────────────
// Single source of truth — imported by cadentialPatterns, parseChordSymbol, musicTheory.
export const NOTE_TO_PC: Record<string, number> = {
  'C': 0, 'B#': 0,
  'C#': 1, 'Db': 1,
  'D': 2,
  'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'F': 5, 'E#': 5,
  'F#': 6, 'Gb': 6,
  'G': 7,
  'G#': 8, 'Ab': 8,
  'A': 9,
  'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
};

/** Convert a note name to a pitch-class (0-11). Returns 0 on failure. */
export function noteNameToPc(name: string): number {
  return NOTE_TO_PC[name?.trim()] ?? 0;
}

// ── SpelledPitch utilities ──────────────────────────────────────────────────

const LETTER_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
};
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** SpelledPitch → MIDI number */
export function spToMidi(p: SpelledPitch): number {
  return (p.octave + 1) * 12 + LETTER_TO_SEMITONE[p.letter] + p.accidental;
}

/** SpelledPitch → pitch class (0-11) */
export function spToPc(p: SpelledPitch): number {
  return ((LETTER_TO_SEMITONE[p.letter] + p.accidental) % 12 + 12) % 12;
}

/** Diatonic index of a letter (C=0, D=1, …, B=6) */
export function letterIndex(letter: string): number {
  return LETTERS.indexOf(letter as typeof LETTERS[number]);
}

/**
 * Build a SpelledPitch by stepping `diatonicSteps` letter steps and
 * `semitones` chromatic semitones from `root`.
 */
export function spellInterval(
  root: SpelledPitch,
  semitones: number,
  diatonicSteps: number,
): SpelledPitch {
  const rootLetterIdx = letterIndex(root.letter);
  const targetLetterIdx = (rootLetterIdx + diatonicSteps) % 7;
  const targetLetter = LETTERS[targetLetterIdx];
  const octaveOffset = Math.floor((rootLetterIdx + diatonicSteps) / 7);
  const targetOctave = root.octave + octaveOffset;
  const naturalSemitones = LETTER_TO_SEMITONE[targetLetter];
  const rootMidi = LETTER_TO_SEMITONE[root.letter] + root.accidental;
  const expectedMidi = rootMidi + semitones;
  const accidental = ((expectedMidi - naturalSemitones - octaveOffset * 12) % 12 + 12) % 12;
  const normalizedAcc = accidental > 6 ? accidental - 12 : accidental;
  return {
    letter: targetLetter,
    accidental: normalizedAcc as SpelledPitch['accidental'],
    octave: targetOctave,
  };
}

/** Convert a StaffNote-like object to SpelledPitch */
export function staffNoteToSp(note: { pitch: string; accidental?: string | null; octave: number }): SpelledPitch {
  const letter = note.pitch.toUpperCase() as SpelledPitch['letter'];
  let acc: SpelledPitch['accidental'] = 0;
  if (note.accidental === 'sharp' || note.accidental === '#') acc = 1;
  else if (note.accidental === 'flat' || note.accidental === 'b') acc = -1;
  else if (note.accidental === 'dblsharp' || note.accidental === '##') acc = 2;
  else if (note.accidental === 'dblflat' || note.accidental === 'bb') acc = -2;
  return { letter, accidental: acc, octave: note.octave };
}

/** SpelledPitch → human-readable string ("C#4", "Eb3", "F##5") */
export function spToString(p: SpelledPitch): string {
  const accStr = p.accidental === 0 ? ''
    : p.accidental === 1 ? '#'
    : p.accidental === -1 ? 'b'
    : p.accidental === 2 ? '##'
    : 'bb';
  return `${p.letter}${accStr}${p.octave}`;
}

// ── Octave calculation ──────────────────────────────────────────────────────

/**
 * Compute the correct octave from a MIDI number and the accidental offset.
 *
 * Without accidentalSemitones the naïve formula `floor(midi/12)-1` gives the
 * wrong octave for enharmonic spellings like Cb5 (midi=71, accSemi=-1):
 *   naïve:   floor(71/12)-1 = 4   ✗
 *   correct: floor((71-(-1))/12)-1 = 5  ✓
 */
export function midiToOctave(midi: number, accidentalSemitones = 0): number {
  return Math.floor((midi - accidentalSemitones) / 12) - 1;
}
