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

// ── Spelled interval foundation (Fase 1 spelling-first refactor) ────────────
//
// Pure functions operating on SpelledPitch values. Replace the ad-hoc helpers
// scattered in musicTheory.ts (spelledSimpleIntervalFromRoot etc.) — those
// will be migrated in Fase 2 (new spelledChordEngine) and removed in Fase 5.

/**
 * Result of computing a written interval between two SpelledPitch values.
 * `diatonicNumber` is letter-distance based (unison=1, second=2, …, ninth=9,
 * etc.) — always positive, never wraps within an octave; for cross-octave
 * intervals it accumulates (e.g. M9 has diatonicNumber=9).
 * `semitones` is the chromatic distance from `a` to `b`, always >= 0.
 * `quality` is the interval quality string: 'P', 'M', 'm', 'A', 'AA', 'd', …
 */
export type SpelledInterval = {
  diatonicNumber: number;
  semitones: number;
  quality: string;
};

const LETTER_INDEX_MAP: Record<string, number> = {
  C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
};

/**
 * Semitone span of a major/perfect interval whose diatonic number is given.
 * Returns the canonical "ground truth" used to compute the alteration that
 * yields the quality. Supports cross-octave (e.g. P8=12, M9=14, P15=24, …).
 */
export function expectedSemitonesForMajorPerfect(diatonicNumber: number): number {
  const simple = (((diatonicNumber - 1) % 7) + 7) % 7 + 1;
  const octaves = Math.floor((diatonicNumber - 1) / 7);
  const simpleSemis: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
  return (simpleSemis[simple] ?? 0) + (12 * octaves);
}

/**
 * Map a (diatonicNumber, alteration) pair to an interval quality string.
 * alteration is `actualSemitones - majorOrPerfectSemitones`.
 *  – perfect-class (1, 4, 5, 8, …): 0='P', +n='A'..'AAAA', −n='d'..'dddd'
 *  – major-class   (2, 3, 6, 7, 9, …): 0='M', −1='m', +n='A'.., ≤−2='d'..
 */
export function qualityFromDiatonicAndAlteration(diatonicNumber: number, alteration: number): string {
  const simple = (((diatonicNumber - 1) % 7) + 7) % 7 + 1;
  const isPerfectType = simple === 1 || simple === 4 || simple === 5;

  const alt = Number.isFinite(alteration) ? Math.round(alteration) : 0;
  if (isPerfectType) {
    if (alt === 0) return 'P';
    if (alt > 0) return 'A'.repeat(Math.min(4, alt));
    return 'd'.repeat(Math.min(4, -alt));
  }
  if (alt === 0) return 'M';
  if (alt === -1) return 'm';
  if (alt > 0) return 'A'.repeat(Math.min(4, alt));
  return 'd'.repeat(Math.min(4, (-alt - 1)));
}

/**
 * Compute the written SIMPLE interval (within one octave) from `a` (root)
 * upward to `b`. Octave information on the inputs is intentionally ignored:
 *   – `diatonicNumber` is always in [1..7] (unison..7th)
 *   – `semitones` is the chromatic distance in [0..11] (ascending mod 12)
 *   – `quality` is the interval quality matching the (diatonic, semitones) pair
 *
 * Rationale: this replicates the semantics of the existing
 * `spelledSimpleIntervalFromRoot` in musicTheory.ts that the chord-recognition
 * code relies on (root + N tertian intervals, all measured as simple). A
 * compound-aware variant (M9, M10, P11, …) can be added in Fase 2 if the new
 * chord engine needs extensions (9/11/13) modeled as compound intervals
 * rather than reduced-to-simple 2/4/6.
 *
 * The function is total: every pair of valid SpelledPitch produces a
 * well-formed simple interval.
 */
export function spelledInterval(a: SpelledPitch, b: SpelledPitch): SpelledInterval {
  const aIdx = LETTER_INDEX_MAP[a.letter];
  const bIdx = LETTER_INDEX_MAP[b.letter];
  const diatonicNumber = ((bIdx - aIdx) % 7 + 7) % 7 + 1; // 1..7
  const aPc = spToPc(a);
  const bPc = spToPc(b);
  const semitones = ((bPc - aPc) % 12 + 12) % 12; // 0..11
  const expected = expectedSemitonesForMajorPerfect(diatonicNumber);
  const alteration = semitones - expected;
  const quality = qualityFromDiatonicAndAlteration(diatonicNumber, alteration);
  return { diatonicNumber, semitones, quality };
}

// ── normalizeToSpelled (Fase 1) ─────────────────────────────────────────────
//
// Boundary function: convert a possibly-ambiguous note input into a definite
// SpelledPitch. Three input flavors:
//   1. Has explicit letter + accidental + octave  → trust it, no work.
//   2. Has MIDI only (imported from MIDI file, no spelling decision yet)
//      → use key-signature awareness to pick the most likely spelling.
//   3. Has letter + midi but no explicit accidental → infer accidental from
//      the gap between letter's natural semitone and midi.
//
// The strategy for case 2 (MIDI-only, ambiguous chromatic pitch class) is
// stated explicitly here rather than scattered in callers — see "policy" below.

/** Key signature descriptor used by normalizeToSpelled. */
export type KeySignatureForSpelling = {
  /** Tonic letter+accidental, e.g. "C", "Bb", "F#", "Eb" */
  tonic: string;
  /** 'Major' | 'Minor' — affects raised 6th/7th in minor */
  mode: 'Major' | 'Minor';
};

const SHARP_KEYS_BY_FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const FLAT_KEYS_BY_FIFTHS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];

/**
 * Number of sharps (positive) or flats (negative) in the key signature.
 * Minor keys use their relative-major's signature: Am=0, Em=+1, Dm=-1, etc.
 */
function keySignatureFifths(ks: KeySignatureForSpelling): number {
  const tonic = (ks.tonic || 'C').trim();
  const relativeMajorTonic = ks.mode === 'Minor'
    ? relativeMajorOf(tonic)
    : tonic;
  const sharpIdx = SHARP_KEYS_BY_FIFTHS.indexOf(relativeMajorTonic);
  if (sharpIdx >= 0) return sharpIdx;
  const flatIdx = FLAT_KEYS_BY_FIFTHS.indexOf(relativeMajorTonic);
  if (flatIdx >= 0) return -(flatIdx + 1);
  return 0; // unknown → assume C
}

const MINOR_TO_RELATIVE_MAJOR: Record<string, string> = {
  A: 'C',  E: 'G',  B: 'D',   'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#', 'A#': 'C#',
  D: 'F',  G: 'Bb', C: 'Eb',  F: 'Ab',   Bb: 'Db',  Eb: 'Gb',  Ab: 'Cb',
};
function relativeMajorOf(minorTonic: string): string {
  return MINOR_TO_RELATIVE_MAJOR[minorTonic] ?? minorTonic;
}

/**
 * Sharp- vs flat-side default spelling for each pitch class (0-11).
 * Index 0 is C; index 1 is C#/Db; etc. Picks the spelling that fits a
 * sharp-side key signature (sharp) or flat-side (flat).
 */
const SHARP_SIDE_SPELLING: Array<{ letter: SpelledPitch['letter']; alt: SpelledPitch['accidental'] }> = [
  { letter: 'C', alt: 0 },  { letter: 'C', alt: 1 },  { letter: 'D', alt: 0 },  { letter: 'D', alt: 1 },
  { letter: 'E', alt: 0 },  { letter: 'F', alt: 0 },  { letter: 'F', alt: 1 },  { letter: 'G', alt: 0 },
  { letter: 'G', alt: 1 },  { letter: 'A', alt: 0 },  { letter: 'A', alt: 1 },  { letter: 'B', alt: 0 },
];
const FLAT_SIDE_SPELLING: Array<{ letter: SpelledPitch['letter']; alt: SpelledPitch['accidental'] }> = [
  { letter: 'C', alt: 0 },  { letter: 'D', alt: -1 }, { letter: 'D', alt: 0 },  { letter: 'E', alt: -1 },
  { letter: 'E', alt: 0 },  { letter: 'F', alt: 0 },  { letter: 'G', alt: -1 }, { letter: 'G', alt: 0 },
  { letter: 'A', alt: -1 }, { letter: 'A', alt: 0 },  { letter: 'B', alt: -1 }, { letter: 'B', alt: 0 },
];

/**
 * Input accepted by normalizeToSpelled:
 *   – letter (optional): A-G, case-insensitive
 *   – accidental (optional): SpelledPitch.accidental OR string ('sharp'|'flat'|'natural'|'double-sharp'|'double-flat'|'#'|'b'|'##'|'bb'|null)
 *   – octave (optional): if missing, computed from midi
 *   – midi (optional): MIDI number 0-127
 *
 * Policy when only MIDI is given (no letter, no accidental):
 *   – pick SHARP_SIDE_SPELLING if keySignatureFifths(ks) >= 0
 *   – pick FLAT_SIDE_SPELLING  if keySignatureFifths(ks) <  0
 *   – octave from midiToOctave(midi, altSemitones)
 *
 * Policy when letter+midi given but no accidental:
 *   – accidental = midi - naturalLetterSemitones (mod 12, normalized to [-2..2])
 *
 * Policy when letter+accidental given:
 *   – trusted; midi/octave inferred if missing.
 */
export type NormalizeInput = {
  letter?: string | null;
  accidental?: SpelledPitch['accidental'] | string | null;
  octave?: number | null;
  midi?: number | null;
};

function parseAccidentalToAlt(acc: SpelledPitch['accidental'] | string | null | undefined): SpelledPitch['accidental'] {
  if (acc === null || acc === undefined) return 0;
  if (typeof acc === 'number') {
    const n = Math.round(acc);
    if (n <= -2) return -2;
    if (n >= 2) return 2;
    return n as SpelledPitch['accidental'];
  }
  const s = String(acc).trim();
  if (!s || s === 'natural' || s === '♮' || s === 'n') return 0;
  if (s === 'sharp' || s === '#' || s === '♯') return 1;
  if (s === 'flat' || s === 'b' || s === '♭') return -1;
  if (s === 'double-sharp' || s === '##' || s === '𝄪' || s.toLowerCase() === 'x') return 2;
  if (s === 'double-flat' || s === 'bb' || s === '𝄫') return -2;
  return 0;
}

export function normalizeToSpelled(input: NormalizeInput, ks: KeySignatureForSpelling): SpelledPitch {
  const midi = (typeof input.midi === 'number' && Number.isFinite(input.midi)) ? input.midi : null;

  // Case 1: letter + accidental + octave all present → trust.
  if (input.letter && input.octave != null) {
    const letter = String(input.letter).toUpperCase() as SpelledPitch['letter'];
    const alt = parseAccidentalToAlt(input.accidental);
    return { letter, accidental: alt, octave: input.octave };
  }

  // Case 2: letter present + midi (no octave or no accidental) → infer.
  if (input.letter && midi !== null) {
    const letter = String(input.letter).toUpperCase() as SpelledPitch['letter'];
    const naturalSemi = LETTER_TO_SEMITONE[letter];
    const provided = input.accidental != null ? parseAccidentalToAlt(input.accidental) : null;
    let alt: SpelledPitch['accidental'];
    if (provided !== null) {
      alt = provided;
    } else {
      // Infer accidental from gap between midi pc and letter's natural pc.
      const midiPc = ((midi % 12) + 12) % 12;
      let gap = ((midiPc - naturalSemi) % 12 + 12) % 12;
      if (gap > 6) gap -= 12;
      const clamped = Math.max(-2, Math.min(2, gap));
      alt = clamped as SpelledPitch['accidental'];
    }
    const octave = input.octave != null ? input.octave : midiToOctave(midi, alt);
    return { letter, accidental: alt, octave };
  }

  // Case 3: MIDI only — apply key-aware spelling policy.
  if (midi !== null) {
    const pc = ((midi % 12) + 12) % 12;
    const useFlats = keySignatureFifths(ks) < 0;
    const table = useFlats ? FLAT_SIDE_SPELLING : SHARP_SIDE_SPELLING;
    const choice = table[pc];
    const octave = midiToOctave(midi, choice.alt);
    return { letter: choice.letter, accidental: choice.alt, octave };
  }

  // Degenerate case: no useful data. Default to C4 — caller error.
  return { letter: 'C', accidental: 0, octave: 4 };
}
