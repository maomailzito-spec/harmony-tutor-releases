// FIX: Added missing constants for intervals, chords, and scales.
import { ScaleShape, RootType, ScaleType, Note, ChordType, Interval, BuiltInChords, NoteDuration } from './types';

// From high E (string 0) to low E (string 5)
export const GUITAR_TUNING_NAMES = ['E', 'B', 'G', 'D', 'A', 'E'];
// C-based indices for standard tuning
export const GUITAR_TUNING = [4, 11, 7, 2, 9, 4];

// The single source of truth for chromatic notes, C-based index (C=0)
export const CHROMATIC_SCALE: Note[] = [
  { sharp: 'C', flat: 'C', audioFile: 'C4' }, // 0
  { sharp: 'C#', flat: 'Db', audioFile: 'Db4' }, // 1
  { sharp: 'D', flat: 'D', audioFile: 'D4' }, // 2
  { sharp: 'D#', flat: 'Eb', audioFile: 'Eb4' }, // 3
  { sharp: 'E', flat: 'E', audioFile: 'E4' }, // 4
  { sharp: 'F', flat: 'F', audioFile: 'F4' }, // 5
  { sharp: 'F#', flat: 'Gb', audioFile: 'Gb4' }, // 6
  { sharp: 'G', flat: 'G', audioFile: 'G4' }, // 7
  { sharp: 'G#', flat: 'Ab', audioFile: 'Ab4' }, // 8
  { sharp: 'A', flat: 'A', audioFile: 'A4' }, // 9
  { sharp: 'A#', flat: 'Bb', audioFile: 'Bb4' }, // 10
  { sharp: 'B', flat: 'B', audioFile: 'B4' }, // 11
];

export const NOTE_NAMES = CHROMATIC_SCALE.map(n => n.sharp);

export const FRET_COUNT = 24;

export const DURATION_VALUES: Record<NoteDuration, number> = {
    'whole': 4,
    'half': 2,
    'quarter': 1,
    'eighth': 0.5,
    'sixteenth': 0.25,
    'thirty-second': 0.125,
    'sixty-fourth': 0.0625,
};

// High-resolution tick base: ticks per quarter note. Used for precise internal timing.
export const TICKS_PER_QUARTER = 960;

// Default layout scale: pixels per internal tick. Use a small value so
// that px-per-quarter = DEFAULT_PX_PER_TICK * TICKS_PER_QUARTER is a
// reasonable on-screen size (e.g. 0.05 * 960 = 48 px per quarter).
export const DEFAULT_PX_PER_TICK = 0.05;
// These are the root notes of keys that use flats. Note names match the 'NOTE_NAMES' array.
export const FLAT_MAJOR_ROOTS = new Set(['F', 'A#', 'D#', 'G#', 'C#']); // F, Bb, Eb, Ab, Db
export const FLAT_MINOR_ROOTS = new Set(['D', 'G', 'C', 'F', 'A#', 'D#']); // Dm, Gm, Cm, Fm, Bbm, Ebm

// --- NOTE SPELLINGS ---
export const ALL_NOTE_SPELLINGS: string[][] = [
    ['C'], ['C#', 'Db'], ['D'], ['D#', 'Eb'], ['E'], ['F'], ['F#', 'Gb'], ['G'], ['G#', 'Ab'], ['A'], ['A#', 'Bb'], ['B']
];
export const NOTE_NAMES_BY_INDEX = ALL_NOTE_SPELLINGS;

// --- INTERVALS ---
export const INTERVALS: Interval[] = [
  { name: 'Unison', shortName: 'P1', semitones: 0, color: 'text-gray-300', rgbColor: 'rgb(209, 213, 219)' },
  { name: 'Minor Second', shortName: 'm2', semitones: 1, color: 'text-red-400', rgbColor: 'rgb(248, 113, 113)' },
  { name: 'Major Second', shortName: 'M2', semitones: 2, color: 'text-orange-400', rgbColor: 'rgb(251, 146, 60)' },
  { name: 'Minor Third', shortName: 'm3', semitones: 3, color: 'text-yellow-400', rgbColor: 'rgb(250, 204, 21)' },
  { name: 'Major Third', shortName: 'M3', semitones: 4, color: 'text-lime-400', rgbColor: 'rgb(163, 230, 53)' },
  { name: 'Perfect Fourth', shortName: 'P4', semitones: 5, color: 'text-green-400', rgbColor: 'rgb(74, 222, 128)' },
  { name: 'Tritone', shortName: 'TT', semitones: 6, color: 'text-cyan-400', rgbColor: 'rgb(34, 211, 238)' },
  { name: 'Perfect Fifth', shortName: 'P5', semitones: 7, color: 'text-sky-400', rgbColor: 'rgb(56, 189, 248)' },
  { name: 'Minor Sixth', shortName: 'm6', semitones: 8, color: 'text-blue-400', rgbColor: 'rgb(96, 165, 250)' },
  { name: 'Major Sixth', shortName: 'M6', semitones: 9, color: 'text-indigo-400', rgbColor: 'rgb(129, 140, 248)' },
  { name: 'Minor Seventh', shortName: 'm7', semitones: 10, color: 'text-violet-400', rgbColor: 'rgb(167, 139, 250)' },
  { name: 'Major Seventh', shortName: 'M7', semitones: 11, color: 'text-purple-400', rgbColor: 'rgb(192, 132, 252)' },
  { name: 'Octave', shortName: 'P8', semitones: 12, color: 'text-fuchsia-400', rgbColor: 'rgb(232, 121, 249)' },
  { name: 'Minor Ninth', shortName: 'b9', semitones: 13, color: 'text-pink-400', rgbColor: 'rgb(244, 114, 182)' },
  { name: 'Major Ninth', shortName: '9', semitones: 14, color: 'text-rose-400', rgbColor: 'rgb(251, 113, 133)' },
  { name: 'Augmented Ninth', shortName: '#9', semitones: 15, color: 'text-red-500', rgbColor: 'rgb(239, 68, 68)' },
  { name: 'Major Tenth', shortName: '10', semitones: 16, color: 'text-lime-500', rgbColor: 'rgb(132, 204, 22)' },
  { name: 'Perfect Eleventh', shortName: '11', semitones: 17, color: 'text-green-500', rgbColor: 'rgb(34, 197, 94)' },
  { name: 'Augmented Eleventh', shortName: '#11', semitones: 18, color: 'text-cyan-500', rgbColor: 'rgb(6, 182, 212)' },
  { name: 'Minor Thirteenth', shortName: 'b13', semitones: 20, color: 'text-blue-500', rgbColor: 'rgb(59, 130, 246)' },
  { name: 'Major Thirteenth', shortName: '13', semitones: 21, color: 'text-indigo-500', rgbColor: 'rgb(99, 102, 241)' },
];

// --- SCALE FORMULAS ---
export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
    // Pentatonics
    'Pentatonic': [0, 3, 5, 7, 10], // Minor Pentatonic
    'Major Pentatonic': [0, 2, 4, 7, 9],
    // Major Scale Modes
    'Ionian': [0, 2, 4, 5, 7, 9, 11], // Major
    'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Phrygian': [0, 1, 3, 5, 7, 8, 10],
    'Lydian': [0, 2, 4, 6, 7, 9, 11],
    'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Aeolian': [0, 2, 3, 5, 7, 8, 10], // Natural Minor
    'Locrian': [0, 1, 3, 5, 6, 8, 10],
    // Harmonic Minor Modes
    'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
    'Locrian #6': [0, 1, 3, 5, 6, 9, 10],
    'Ionian #5': [0, 2, 4, 5, 8, 9, 11],
    'Dorian #4': [0, 2, 3, 6, 7, 9, 10],
    'Phrygian Dominant': [0, 1, 4, 5, 7, 8, 10],
    'Lydian #2': [0, 3, 4, 6, 7, 9, 11],
    'Altered Dominant bb7': [0, 1, 3, 4, 6, 8, 9],
    // Melodic Minor Modes
    'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
    'Dorian b2': [0, 1, 3, 5, 7, 9, 10],
    'Lydian Augmented': [0, 2, 4, 6, 8, 9, 11],
    'Lydian Dominant': [0, 2, 4, 6, 7, 9, 10],
    'Mixolydian b6': [0, 2, 4, 5, 7, 8, 10],
    'Locrian #2': [0, 2, 3, 5, 6, 8, 10],
    'Altered Scale': [0, 1, 3, 4, 6, 8, 10],
};

// --- CHORD FORMULAS ---
export const CHORD_FORMULAS: Partial<Record<ChordType, number[]>> = {
  // Triads
  [BuiltInChords.Major]: [0, 4, 7],
  [BuiltInChords.Minor]: [0, 3, 7],
  [BuiltInChords.Augmented]: [0, 4, 8],
  [BuiltInChords.Diminished]: [0, 3, 6],
  // Suspended
  [BuiltInChords.Sus2]: [0, 2, 7],
  [BuiltInChords.Sus4]: [0, 5, 7],
  // Sevenths
  [BuiltInChords.Major7]: [0, 4, 7, 11],
  [BuiltInChords.Minor7]: [0, 3, 7, 10],
  [BuiltInChords.Dominant7]: [0, 4, 7, 10],
  [BuiltInChords.Diminished7]: [0, 3, 6, 9],
  [BuiltInChords.Minor7b5]: [0, 3, 6, 10],
  // Sixths
  [BuiltInChords.Major6]: [0, 4, 7, 9],
  [BuiltInChords.Minor6]: [0, 3, 7, 9],
  // Ninths
  [BuiltInChords.Major9]: [0, 4, 7, 11, 2],
  [BuiltInChords.Minor9]: [0, 3, 7, 10, 2],
  [BuiltInChords.Dominant9]: [0, 4, 7, 10, 2],
  [BuiltInChords.Add9]: [0, 4, 7, 2],
  [BuiltInChords.Dominant7b9]: [0, 4, 7, 10, 1],
  [BuiltInChords.Dominant7sharp9]: [0, 4, 7, 10, 3],
  // Elevenths
  [BuiltInChords.Minor11]: [0, 3, 10, 5], // Root, m3, m7, 11
  [BuiltInChords.Dominant11]: [0, 4, 7, 10, 5],
  [BuiltInChords.Dominant7sharp11]: [0, 4, 7, 10, 6],
  // Thirteenths
  [BuiltInChords.Major13]: [0, 4, 7, 11, 9], // Root, M3, P5, M7, M13
  [BuiltInChords.Minor13]: [0, 3, 7, 10, 9], // Root, m3, P5, m7, M13
  [BuiltInChords.Dominant13]: [0, 4, 7, 10, 9], // Root, M3, P5, m7, M13
  [BuiltInChords.Dominant7b13]: [0, 4, 7, 10, 8],
  [BuiltInChords.Dominant9_13]: [0, 4, 10, 2, 9], // Root, M3, m7, 9, 13 (5 is often omitted)
};

// --- GUITAR SHAPES ---
export const IONIAN_MODE_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(249, 115, 22)', // Orange
        notes: [
            {s: 5, f: 4, t: RootType.Major},
            {s: 4, f: 1}, {s: 4, f: 3}, {s: 4, f: 4},
            {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 1, t: RootType.Major}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 2}, {s: 1, f: 4},
            {s: 0, f: 1}, {s: 0, f: 3}, {s: 0, f: 4, t: RootType.Major},
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1, t: RootType.Major}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 3, t: RootType.Major},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 3},
            {s: 0, f: 0}, {s: 0, f: 1, t: RootType.Major}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0, t: RootType.Major}, {s: 5, f: 2}, {s: 5, f: 4},
            {s: 4, f: 0}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 1}, {s: 3, f: 2, t: RootType.Major}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 4}, {s: 1, f: 5, t: RootType.Major},
            {s: 0, f: 2}, {s: 0, f: 4}, {s: 0, f: 5}
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(139, 92, 246)', // Violet
        notes: [
            {s: 4, f: 3, t: RootType.Major},
            {s: 3, f: 0}, 
            {s: 3, f: 2}, 
            {s: 3, f: 3},
            {s: 2, f: 0}, 
            {s: 2, f: 2},
            {s: 1, f: 0}, 
            {s: 1, f: 1, t: RootType.Major},
            {s: 1, f: 3},
            {s: 0, f: 0},
            {s: 0, f: 1},
            {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(219, 39, 119)', // Fuchsia
        notes: [
            {s: 4, f: 1, t: RootType.Major}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3, t: RootType.Major},
            {s: 1, f: 1}, {s: 1, f: 3}, {s: 1, f: 4},
            {s: 0, f: 1}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 6',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 4, f: 0, t: RootType.Major}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2, t: RootType.Major}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 3}, {s: 1, f: 5},
            {s: 0, f: 2}, {s: 0, f: 4}, {s: 0, f: 5, t: RootType.Major},
        ]
    }
];

export const DORIAN_MODE_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(249, 115, 22)', // Orange
        notes: [
            {s: 5, f: 8, t: RootType.Minor},
            {s: 4, f: 5}, {s: 4, f: 6}, {s: 4, f: 8},
            {s: 3, f: 5}, {s: 3, f: 7}, {s: 3, f: 8},
            {s: 2, f: 5, t: RootType.Minor}, {s: 2, f: 7}, {s: 2, f: 8},
            {s: 1, f: 6}, {s: 1, f: 8},
            {s: 0, f: 5}, {s: 0, f: 6}, {s: 0, f: 8, t: RootType.Minor},
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1, t: RootType.Minor}, {s: 5, f: 3},
            {s: 4, f: -1}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 1}, {s: 3, f: 3, t: RootType.Minor},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 3},
            {s: 0, f: -1}, {s: 0, f: 1, t: RootType.Minor}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0, t: RootType.Minor}, {s: 5, f: 2}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 1}, {s: 3, f: 2, t: RootType.Minor}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 3}, {s: 1, f: 5, t: RootType.Minor},
            {s: 0, f: 2}, {s: 0, f: 3}, {s: 0, f: 5}
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(139, 92, 246)', // Violet
        notes: [
            {s: 4, f: 3, t: RootType.Minor},
            {s: 3, f: 0}, {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2},
            {s: 1, f: -1}, {s: 1, f: 1, t: RootType.Minor}, {s: 1, f: 3},
            {s: 0, f: -1}, {s: 0, f: 1}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(219, 39, 119)', // Fuchsia
        notes: [
            {s: 4, f: 1, t: RootType.Minor}, {s: 4, f: 3},
            {s: 3, f: -1}, {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3, t: RootType.Minor},
            {s: 1, f: 1}, {s: 1, f: 2}, {s: 1, f: 4},
            {s: 0, f: 1}, {s: 0, f: 2},
        ]
    },
    {
        name: 'Shape 6',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 4, f: 0, t: RootType.Minor}, {s: 4, f: 2}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2, t: RootType.Minor}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 3}, {s: 1, f: 5},
            {s: 0, f: 2}, {s: 0, f: 3}, {s: 0, f: 5, t: RootType.Minor},
        ]
    }
];

export const PHRYGIAN_MODE_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(249, 115, 22)',
        notes: [
                {
        s: 0,
        f: 4
    },
                {
        s: 0,
        f: 6
    },
                {
        s: 0,
        f: 8,
        t: RootType.Minor
    },
                {
        s: 1,
        f: 6
    },
                {
        s: 1,
        f: 8
    },
                {
        s: 2,
        f: 5,
        t: RootType.Minor
    },
                {
        s: 2,
        f: 6
    },
                {
        s: 2,
        f: 8
    },
                {
        s: 3,
        f: 5
    },
                {
        s: 3,
        f: 6
    },
                {
        s: 3,
        f: 8
    },
                {
        s: 4,
        f: 4
    },
                {
        s: 4,
        f: 6
    },
                {
        s: 4,
        f: 8
    },
                {
        s: 5,
        f: 8,
        t: RootType.Minor
    }
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1, t: RootType.Minor}, {s: 5, f: 2},
            {s: 4, f: -1}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: -1}, {s: 3, f: 1}, {s: 3, f: 3, t: RootType.Minor},
            {s: 2, f: -1}, {s: 2, f: 1}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 2},
            {s: 0, f: -1}, {s: 0, f: 1, t: RootType.Minor}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0, t: RootType.Minor}, {s: 5, f: 2}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2, t: RootType.Minor}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 3}, {s: 1, f: 5, t: RootType.Minor},
            {s: 0, f: 2}, {s: 0, f: 3}, {s: 0, f: 5}
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(139, 92, 246)', // Violet
        notes: [
            {s: 4, f: 3, t: RootType.Minor},
            {s: 3, f: -1}, {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 1},
            {s: 1, f: -1}, {s: 1, f: 1, t: RootType.Minor}, {s: 1, f: 3},
            {s: 0, f: -1}, {s: 0, f: 0}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(219, 39, 119)', // Fuchsia
        notes: [
            {s: 4, f: 1, t: RootType.Minor}, {s: 4, f: 3},
            {s: 3, f: -1}, {s: 3, f: 0}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 1}, {s: 2, f: 3, t: RootType.Minor},
            {s: 1, f: 0}, {s: 1, f: 2}, {s: 1, f: 4},
            {s: 0, f: 0}, {s: 0, f: 2},
        ]
    },
    {
        name: 'Shape 6',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 4, f: 0, t: RootType.Minor}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2, t: RootType.Minor}, {s: 2, f: 4},
            {s: 1, f: 1}, {s: 1, f: 3}, {s: 1, f: 4},
            {s: 0, f: 2}, {s: 0, f: 3}, {s: 0, f: 5, t: RootType.Minor},
        ]
    }
];

export const LYDIAN_MODE_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(249, 115, 22)', // Orange
        notes: [
            {s: 5, f: 4, t: RootType.Major},
            {s: 4, f: 1}, {s: 4, f: 3}, {s: 4, f: 5},
            {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 1, t: RootType.Major}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 3}, {s: 1, f: 4},
            {s: 0, f: 1}, {s: 0, f: 3}, {s: 0, f: 4, t: RootType.Major},
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1, t: RootType.Major}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 2}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 3, t: RootType.Major},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 4},
            {s: 1, f: 1}, {s: 1, f: 3},
            {s: 0, f: 0}, {s: 0, f: 1, t: RootType.Major}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0, t: RootType.Major}, {s: 5, f: 2}, {s: 5, f: 4},
            {s: 4, f: 0}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 1}, {s: 3, f: 2, t: RootType.Major}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 3}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 4}, {s: 1, f: 5, t: RootType.Major},
            {s: 0, f: 2}, {s: 0, f: 4}, {s: 0, f: 5}
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(139, 92, 246)', // Violet
        notes: [
            {s: 4, f: 3, t: RootType.Major},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 4},
            {s: 2, f: 0}, {s: 2, f: 2},
            {s: 1, f: 0}, {s: 1, f: 1, t: RootType.Major}, {s: 1, f: 3},
            {s: 0, f: 0}, {s: 0, f: 2}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(219, 39, 119)', // Fuchsia
        notes: [
            {s: 4, f: 1, t: RootType.Major}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3, t: RootType.Major},
            {s: 1, f: 1}, {s: 1, f: 3}, {s: 1, f: 5},
            {s: 0, f: 1}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 6',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 4, f: 0, t: RootType.Major}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2, t: RootType.Major}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 4}, {s: 1, f: 5},
            {s: 0, f: 2}, {s: 0, f: 4}, {s: 0, f: 5, t: RootType.Major},
        ]
    }
];

export const MIXOLYDIAN_MODE_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(249, 115, 22)', // Orange
        notes: [
            {s: 0, f: 5},
            {s: 0, f: 6},
            {s: 0, f: 8, t: RootType.Major},
            {s: 1, f: 5},
            {s: 1, f: 6},
            {s: 1, f: 8},
            {s: 2, f: 5, t: RootType.Major},
            {s: 2, f: 7},
            {s: 3, f: 5},
            {s: 3, f: 7},
            {s: 3, f: 8},
            {s: 4, f: 5},
            {s: 4, f: 7},
            {s: 4, f: 8},
            {s: 5, f: 8, t: RootType.Major}
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1, t: RootType.Major}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 3, t: RootType.Major},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 3},
            {s: 0, f: -1}, {s: 0, f: 1, t: RootType.Major}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0, t: RootType.Major}, {s: 5, f: 2}, {s: 5, f: 4},
            {s: 4, f: 0}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 0}, {s: 3, f: 2, t: RootType.Major}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2}, {s: 2, f: 4},
            {s: 1, f: 2},
            {s: 1, f: 3}, {s: 1, f: 5, t: RootType.Major},
            {s: 0, f: 2}, {s: 0, f: 3}, {s: 0, f: 5}
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(139, 92, 246)', // Violet
        notes: [
            {s: 4, f: 3, t: RootType.Major}, {s: 3, f: 0}, {s: 3, f: 2}, 
            {s: 3, f: 3}, {s: 2, f: 0}, {s: 2, f: 2}, 
            {s: 1, f: -1}, {s: 1, f: 1, t: RootType.Major}, {s: 1, f: 3}, {s: 0, f: 0}, 
            {s: 0, f: 1}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(219, 39, 119)', // Fuchsia
        notes: [
            {s: 4, f: 1, t: RootType.Major}, {s: 4, f: 3}, {s: 3, f: 0}, 
            {s: 3, f: 1}, {s: 3, f: 3}, {s: 2, f: 0}, 
            {s: 2, f: 1}, {s: 2, f: 3, t: RootType.Major}, {s: 1, f: 1}, {s: 1, f: 3}, 
            {s: 1, f: 4}, {s: 0, f: 1}, {s: 0, f: 2},
        ]
    },
    {
        name: 'Shape 6',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 4, f: 0, t: RootType.Major}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 4},
            {s: 2, f: 0}, {s: 2, f: 2, t: RootType.Major}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 3}, {s: 1, f: 5},
            {s: 0, f: 2},
            {s: 0, f: 3}, {s: 0, f: 5, t: RootType.Major},
        ]
    }
];

export const AEOLIAN_MODE_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(249, 115, 22)',
        notes: [
            { s: 0, f: 4 },
            { s: 0, f: 6 },
            { s: 0, f: 8, t: RootType.Minor },
            { s: 1, f: 6 },
            { s: 1, f: 8 },
            { s: 2, f: 5, t: RootType.Minor },
            { s: 2, f: 7 },
            { s: 2, f: 8 },
            { s: 3, f: 5 },
            { s: 3, f: 6 },
            { s: 3, f: 8 },
            { s: 4, f: 5 },
            { s: 4, f: 6 },
            { s: 4, f: 8 },
            { s: 5, f: 8, t: RootType.Minor }
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1, t: RootType.Minor}, {s: 5, f: 3},
            {s: 4, f: -1}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: -1}, {s: 3, f: 1}, {s: 3, f: 3, t: RootType.Minor},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 2},
            {s: 0, f: -1}, {s: 0, f: 1, t: RootType.Minor}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0, t: RootType.Minor}, {s: 5, f: 2}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 2}, {s: 4, f: 4},
            {s: 3, f: 0}, {s: 3, f: 2, t: RootType.Minor}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 3}, {s: 1, f: 5, t: RootType.Minor},
            {s: 0, f: 2}, {s: 0, f: 3}, {s: 0, f: 5}
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(139, 92, 246)', // Violet
        notes: [
            {s: 4, f: 3, t: RootType.Minor},
            {s: 3, f: 0}, {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2},
            {s: 1, f: -1}, {s: 1, f: 1, t: RootType.Minor}, {s: 1, f: 3},
            {s: 0, f: -1}, {s: 0, f: 1}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(219, 39, 119)', // Fuchsia
        notes: [
            {s: 4, f: 1, t: RootType.Minor}, {s: 4, f: 3},
            {s: 3, f: -1}, {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2}, {s: 2, f: 3, t: RootType.Minor},
            {s: 1, f: 1}, {s: 1, f: 2}, {s: 1, f: 4},
            {s: 0, f: 1}, {s: 0, f: 2},
        ]
    },
    {
        name: 'Shape 6',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 4, f: 0, t: RootType.Minor}, {s: 4, f: 2}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2}, {s: 3, f: 4},
            {s: 2, f: 1}, {s: 2, f: 2, t: RootType.Minor}, {s: 2, f: 4},
            {s: 1, f: 2}, {s: 1, f: 3}, {s: 1, f: 5},
            {s: 0, f: 2}, {s: 0, f: 3}, {s: 0, f: 5, t: RootType.Minor},
        ]
    }
];

export const LOCRIAN_MODE_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(249, 115, 22)',
        notes: [
            { s: 0, f: 4 },
            { s: 0, f: 6 },
            { s: 0, f: 8, t: RootType.Minor },
            { s: 1, f: 6 },
            { s: 1, f: 7 },
            { s: 2, f: 5, t: RootType.Minor },
            { s: 2, f: 6 },
            { s: 2, f: 8 },
            { s: 3, f: 4 },
            { s: 3, f: 6 },
            { s: 3, f: 8 },
            { s: 4, f: 4 },
            { s: 4, f: 6 },
            { s: 4, f: 8 },
            { s: 5, f: 8, t: RootType.Minor }
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1, t: RootType.Minor}, {s: 5, f: 2},
            {s: 4, f: -1}, {s: 4, f: 1}, {s: 4, f: 2},
            {s: 3, f: -1}, {s: 3, f: 1}, {s: 3, f: 3, t: RootType.Minor},
            {s: 2, f: -1}, {s: 2, f: 1}, {s: 2, f: 3},
            {s: 1, f: 0}, {s: 1, f: 2},
            {s: 0, f: -1}, {s: 0, f: 1, t: RootType.Minor}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0, t: RootType.Minor}, {s: 5, f: 1}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 2}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 2, t: RootType.Minor}, {s: 3, f: 3},
            {s: 2, f: 1}, {s: 2, f: 2}, {s: 2, f: 4},
            {s: 1, f: 1}, {s: 1, f: 3}, {s: 1, f: 5, t: RootType.Minor},
            {s: 0, f: 1}, {s: 0, f: 3}, {s: 0, f: 5}
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(139, 92, 246)', // Violet
        notes: [
            {s: 4, f: 3, t: RootType.Minor},
            {s: 3, f: -1}, {s: 3, f: 1}, {s: 3, f: 2},
            {s: 2, f: -1}, {s: 2, f: 1},
            {s: 1, f: -1}, {s: 1, f: 1, t: RootType.Minor}, {s: 1, f: 3},
            {s: 0, f: -1}, {s: 0, f: 0}, {s: 0, f: 2},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(219, 39, 119)', // Fuchsia
        notes: [
            {s: 4, f: 1, t: RootType.Minor}, {s: 4, f: 2},
            {s: 3, f: -1}, {s: 3, f: 0}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 1}, {s: 2, f: 3, t: RootType.Minor},
            {s: 1, f: 0}, {s: 1, f: 2}, {s: 1, f: 3},
            {s: 0, f: 0}, {s: 0, f: 2},
        ]
    },
    {
        name: 'Shape 6',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 4, f: 0, t: RootType.Minor}, {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 2, t: RootType.Minor}, {s: 2, f: 3},
            {s: 1, f: 1}, {s: 1, f: 3}, {s: 1, f: 4},
            {s: 0, f: 1}, {s: 0, f: 3}, {s: 0, f: 5, t: RootType.Minor},
        ]
    }
];

export const HARMONIC_MINOR_MODE_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 1 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 2, f: 0 }, { s: 2, f: 1, t: RootType.Minor }, { s: 2, f: 3 }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 0 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Minor } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 3 }, { s: 4, f: -1 }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 2 }, { s: 3, f: 3, t: RootType.Minor }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 0, f: 0 }, { s: 0, f: 1, t: RootType.Minor }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 2 }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 1 }, { s: 3, f: 2, t: RootType.Minor }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 4 }, { s: 1, f: 5, t: RootType.Minor }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Minor }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 1, f: 0 }, { s: 1, f: 1, t: RootType.Minor }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 2 }, { s: 2, f: 3, t: RootType.Minor }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 2 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 1 }, { s: 2, f: 2, t: RootType.Minor }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 1 }, { s: 0, f: 4 }, { s: 0, f: 5, t: RootType.Minor } ] }
];
export const LOCRIAN_6_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Minor }, { s: 2, f: 2 }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 0, f: 1 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Minor } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 2 }, { s: 4, f: -1 }, { s: 4, f: 1 }, { s: 4, f: 2 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3, t: RootType.Minor }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 0 }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 1, t: RootType.Minor }, { s: 0, f: 2 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 1 }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 1 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2, t: RootType.Minor }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5, t: RootType.Minor }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Minor }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 2 }, { s: 1, f: -1 }, { s: 1, f: 1, t: RootType.Minor }, { s: 1, f: 2 }, { s: 0, f: -1 }, { s: 0, f: 1 }, { s: 0, f: 2 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 2 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3, t: RootType.Minor }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 0 }, { s: 0, f: 3 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2, t: RootType.Minor }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5, t: RootType.Minor } ] }
];
export const IONIAN_5_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Major }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 4, f: 4 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1, t: RootType.Major }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 5 }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Major } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Major }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 1 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3, t: RootType.Major }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1, t: RootType.Major }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Major }, { s: 5, f: 2 }, { s: 5, f: 4 }, { s: 4, f: 0 }, { s: 4, f: 3 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 2, t: RootType.Major }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 2, f: 5 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 1, f: 5, t: RootType.Major }, { s: 0, f: 2 }, { s: 0, f: 4 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Major }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 1, f: 0 }, { s: 1, f: 1, t: RootType.Major }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1 }, { s: 0, f: 4 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Major }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3, t: RootType.Major }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 4 }, { s: 0, f: 2 }, { s: 0, f: 3 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Major }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 3 }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 2, t: RootType.Major }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 6 }, { s: 0, f: 2 }, { s: 0, f: 4 }, { s: 0, f: 5, t: RootType.Major } ] }
];
export const DORIAN_4_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 1 }, { s: 4, f: 2 }, { s: 4, f: 5 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Minor }, { s: 2, f: 3 }, { s: 1, f: 0 }, { s: 1, f: 3 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Minor } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 3 }, { s: 4, f: -1 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3, t: RootType.Minor }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 1, t: RootType.Minor }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 2 }, { s: 5, f: 3 }, { s: 4, f: 1 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 2, t: RootType.Minor }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 3 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5, t: RootType.Minor }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 6 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Minor }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 1, f: -1 }, { s: 1, f: 1, t: RootType.Minor }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 2 }, { s: 0, f: 3 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3, t: RootType.Minor }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 5 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2, t: RootType.Minor }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 4 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5, t: RootType.Minor } ] }
];
export const PHRYGIAN_DOMINANT_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Major }, { s: 4, f: 0 }, { s: 4, f: 3 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Major }, { s: 2, f: 2 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Major } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Major }, { s: 5, f: 2 }, { s: 4, f: 0 }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3, t: RootType.Major }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 1, t: RootType.Major }, { s: 0, f: 2 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Major }, { s: 5, f: 2 }, { s: 5, f: 4 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2, t: RootType.Major }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5, t: RootType.Major }, { s: 0, f: 2 }, { s: 0, f: 4 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Major }, { s: 3, f: -1 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 1, f: -1 }, { s: 1, f: 1, t: RootType.Major }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Major }, { s: 4, f: 2 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3, t: RootType.Major }, { s: 1, f: 0 }, { s: 1, f: 3 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Major }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2, t: RootType.Major }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5, t: RootType.Major } ] }
];
export const LYDIAN_2_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Major }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 4, f: 5 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1, t: RootType.Major }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Major } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Major }, { s: 5, f: 4 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3, t: RootType.Major }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1, t: RootType.Major }, { s: 0, f: 4 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Major }, { s: 5, f: 3 }, { s: 5, f: 4 }, { s: 4, f: 1 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 2, t: RootType.Major }, { s: 3, f: 5 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 1, f: 5, t: RootType.Major }, { s: 0, f: 3 }, { s: 0, f: 4 }, { s: 0, f: 6 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Major }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 1, f: 0 }, { s: 1, f: 1, t: RootType.Major }, { s: 1, f: 4 }, { s: 0, f: 0 }, { s: 0, f: 2 }, { s: 0, f: 3 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Major }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3, t: RootType.Major }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Major }, { s: 4, f: 3 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 2, t: RootType.Major }, { s: 2, f: 5 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 4 }, { s: 0, f: 5, t: RootType.Major } ] }
];
export const ALTERED_DOMINANT_BB7_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 3, f: -1 }, { s: 3, f: 2 }, { s: 2, f: -2 }, { s: 2, f: 1, t: RootType.Minor }, { s: 1, f: 0 }, { s: 0, f: 0 }, { s: 0, f: 1 } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 2 }, { s: 4, f: -1 }, { s: 4, f: 1 }, { s: 3, f: -1 }, { s: 3, f: 0 }, { s: 3, f: 3, t: RootType.Minor }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 1, f: -1 }, { s: 1, f: 2 }, { s: 0, f: -2 }, { s: 0, f: 1, t: RootType.Minor } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 1 }, { s: 5, f: 3 }, { s: 4, f: -2 }, { s: 4, f: 0 }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 2, t: RootType.Minor }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 5, t: RootType.Minor }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Minor }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 2, f: -2 }, { s: 2, f: 1 }, { s: 1, f: -2 }, { s: 1, f: 1, t: RootType.Minor }, { s: 1, f: 2 }, { s: 0, f: -1 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 2 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 2, f: -1 }, { s: 2, f: 0 }, { s: 2, f: 3, t: RootType.Minor }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 0, f: -1 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: -2 }, { s: 3, f: 0 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 2, t: RootType.Minor }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: 1 }, { s: 0, f: 2 }, { s: 0, f: 5, t: RootType.Minor } ] }
];

export const MELODIC_MINOR_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 1 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1, t: RootType.Minor }, { s: 2, f: 3 }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Minor } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3, t: RootType.Minor }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1, t: RootType.Minor }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 2 }, { s: 5, f: 4 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 4, t: RootType.Minor }, { s: 0, f: 2 }, { s: 0, f: 4 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 2, t: RootType.Minor }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 1, f: 0, t: RootType.Minor }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 2, t: RootType.Minor }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Minor } ] }
];

export const DORIAN_B2_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Minor }, { s: 2, f: 2 }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Minor } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 3 }, { s: 4, f: -1 }, { s: 4, f: 0 }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 3, t: RootType.Minor }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 1, t: RootType.Minor }, { s: 0, f: 2 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 2 }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 4, t: RootType.Minor }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 2, t: RootType.Minor }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 2 }, { s: 1, f: -1 }, { s: 1, f: 0, t: RootType.Minor }, { s: 1, f: 2 }, { s: 0, f: -1 }, { s: 0, f: 0 }, { s: 0, f: 2 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 0 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 2, f: 2, t: RootType.Minor }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 2 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Minor } ] }
];

export const LYDIAN_AUGMENTED_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Major }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 4, f: 5 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1, t: RootType.Major }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Major } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Major }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 4, t: RootType.Major }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1, t: RootType.Major }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Major }, { s: 5, f: 2 }, { s: 5, f: 4 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 5 }, { s: 3, f: 1 }, { s: 3, f: 2, t: RootType.Major }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 1, f: 6, t: RootType.Major }, { s: 0, f: 2 }, { s: 0, f: 4 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Major }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 1, f: 0 }, { s: 1, f: 1, t: RootType.Major }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 2 }, { s: 0, f: 4 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Major }, { s: 4, f: 3 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3, t: RootType.Major }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Major }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 5 }, { s: 2, f: 1 }, { s: 2, f: 2, t: RootType.Major }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 4 }, { s: 0, f: 6, t: RootType.Major } ] }
];

export const LYDIAN_DOMINANT_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Major }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 4, f: 5 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Major }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Major } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Major }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3, t: RootType.Major }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: -1 }, { s: 0, f: 1, t: RootType.Major }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Major }, { s: 5, f: 2 }, { s: 5, f: 4 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 5 }, { s: 3, f: 0 }, { s: 3, f: 2, t: RootType.Major }, { s: 3, f: 4 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5, t: RootType.Major }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Major }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 1, f: -1 }, { s: 1, f: 1, t: RootType.Major }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 2 }, { s: 0, f: 3 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Major }, { s: 4, f: 3 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3, t: RootType.Major }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 1 }, { s: 0, f: 2 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Major }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 5 }, { s: 2, f: 0 }, { s: 2, f: 2, t: RootType.Major }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5, t: RootType.Major } ] }
];

export const MIXOLYDIAN_B6_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Major }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 4, f: 4 }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Major }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 0 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Major } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Major }, { s: 5, f: 3 }, { s: 4, f: 0 }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 3, t: RootType.Major }, { s: 2, f: 0 }, { s: 2, f: 2 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 0, f: -1 }, { s: 0, f: 1, t: RootType.Major }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Major }, { s: 5, f: 2 }, { s: 5, f: 4 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2, t: RootType.Major }, { s: 3, f: 3 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5, t: RootType.Major }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 3, t: RootType.Major }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: -1 }, { s: 2, f: 2 }, { s: 1, f: -1 }, { s: 1, f: 1, t: RootType.Major }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1 }, { s: 0, f: 3 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Major }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3, t: RootType.Major }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 0, f: 1 }, { s: 0, f: 2 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Major }, { s: 4, f: 2 }, { s: 4, f: 4 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 3, f: 4 }, { s: 2, f: 0 }, { s: 2, f: 2, t: RootType.Major }, { s: 2, f: 3 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5, t: RootType.Major } ] }
];

export const LOCRIAN_2_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 1 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Minor }, { s: 2, f: 3 }, { s: 1, f: 0 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 2 }, { s: 0, f: 4, t: RootType.Minor } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 3 }, { s: 4, f: -1 }, { s: 4, f: 0 }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 3, t: RootType.Minor }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 0, f: -1 }, { s: 0, f: 1, t: RootType.Minor }, { s: 0, f: 3 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 2 }, { s: 5, f: 3 }, { s: 4, f: -1 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 2, f: 4 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 4, t: RootType.Minor }, { s: 0, f: 2 }, { s: 0, f: 3 }, { s: 0, f: 5 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 2, t: RootType.Minor }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 1, f: -1 }, { s: 1, f: 0, t: RootType.Minor }, { s: 1, f: 2 }, { s: 0, f: -1 }, { s: 0, f: 0 }, { s: 0, f: 2 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 2, f: 2, t: RootType.Minor }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 0, f: 1 }, { s: 0, f: 2 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 2 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 5 }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Minor } ] }
];

export const ALTERED_SCALE_SHAPES: ScaleShape[] = [
    { name: 'Shape 1', color: 'rgb(249, 115, 22)', notes: [ { s: 5, f: 4, t: RootType.Minor }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 2, f: -1 }, { s: 2, f: 1, t: RootType.Minor }, { s: 2, f: 2 }, { s: 1, f: 0 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 2 }, { s: 0, f: 3, t: RootType.Minor } ] },
    { name: 'Shape 2', color: 'rgb(250, 204, 21)', notes: [ { s: 5, f: 1, t: RootType.Minor }, { s: 5, f: 2 }, { s: 4, f: -1 }, { s: 4, f: 0 }, { s: 4, f: 2 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 2, t: RootType.Minor }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 2, f: 2 }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 0, f: -1 }, { s: 0, f: 0, t: RootType.Minor }, { s: 0, f: 2 } ] },
    { name: 'Shape 3', color: 'rgb(34, 197, 94)', notes: [ { s: 5, f: 0, t: RootType.Minor }, { s: 5, f: 1 }, { s: 5, f: 3 }, { s: 4, f: -1 }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: 0 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 3 }, { s: 1, f: 4, t: RootType.Minor }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 4 } ] },
    { name: 'Shape 4', color: 'rgb(139, 92, 246)', notes: [ { s: 4, f: 2, t: RootType.Minor }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 2 }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 1, f: -1 }, { s: 1, f: 0, t: RootType.Minor }, { s: 1, f: 2 }, { s: 0, f: -1 }, { s: 0, f: 0 }, { s: 0, f: 1 } ] },
    { name: 'Shape 5', color: 'rgb(219, 39, 119)', notes: [ { s: 4, f: 1, t: RootType.Minor }, { s: 4, f: 2 }, { s: 3, f: -1 }, { s: 3, f: 0 }, { s: 3, f: 2 }, { s: 2, f: -1 }, { s: 2, f: 1 }, { s: 2, f: 2, t: RootType.Minor }, { s: 1, f: 0 }, { s: 1, f: 2 }, { s: 1, f: 3 }, { s: 0, f: 0 }, { s: 0, f: 1 } ] },
    { name: 'Shape 6', color: 'rgb(59, 130, 246)', notes: [ { s: 4, f: 0, t: RootType.Minor }, { s: 4, f: 1 }, { s: 4, f: 3 }, { s: 3, f: -1 }, { s: 3, f: 1 }, { s: 3, f: 3 }, { s: 2, f: 0 }, { s: 2, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 1 }, { s: 1, f: 2 }, { s: 1, f: 4 }, { s: 0, f: 1 }, { s: 0, f: 3 }, { s: 0, f: 4, t: RootType.Minor } ] }
];

export const MINOR_PENTATONIC_SHAPES: ScaleShape[] = [
    {
        name: 'Shape 1',
        color: 'rgb(239, 68, 68)', // Red
        notes: [
            {s: 5, f: 0, t: RootType.Minor}, {s: 5, f: 3, t: RootType.Major},
            {s: 4, f: 0}, {s: 4, f: 2},
            {s: 3, f: 0}, {s: 3, f: 2, t: RootType.Minor},
            {s: 2, f: 0, t: RootType.Major}, {s: 2, f: 2},
            {s: 1, f: 0}, {s: 1, f: 3},
            {s: 0, f: 0, t: RootType.Minor}, {s: 0, f: 3, t: RootType.Major},
        ]
    },
    {
        name: 'Shape 2',
        color: 'rgb(249, 115, 22)', // Orange
        notes: [
            {s: 5, f: 1, t: RootType.Major}, {s: 5, f: 3},
            {s: 4, f: 0}, {s: 4, f: 3},
            {s: 3, f: 0, t: RootType.Minor}, {s: 3, f: 3, t: RootType.Major},
            {s: 2, f: 0}, {s: 2, f: 2},
            {s: 1, f: 1}, {s: 1, f: 3, t: RootType.Minor},
            {s: 0, f: 1, t: RootType.Major}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 3',
        color: 'rgb(250, 204, 21)', // Yellow
        notes: [
            {s: 5, f: 1}, {s: 5, f: 3},
            {s: 4, f: 1, t: RootType.Major}, {s: 4, f: 3, t: RootType.Minor},
            {s: 3, f: 1}, {s: 3, f: 3},
            {s: 2, f: 0}, {s: 2, f: 3},
            {s: 1, f: 1, t: RootType.Minor}, {s: 1, f: 4, t: RootType.Major},
            {s: 0, f: 1}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 4',
        color: 'rgb(34, 197, 94)', // Green
        notes: [
            {s: 5, f: 0}, {s: 5, f: 3},
            {s: 4, f: 0, t: RootType.Minor}, {s: 4, f: 3, t: RootType.Major},
            {s: 3, f: 0}, {s: 3, f: 2},
            {s: 2, f: 0}, {s: 2, f: 2, t: RootType.Minor},
            {s: 1, f: 1, t: RootType.Major}, {s: 1, f: 3},
            {s: 0, f: 0}, {s: 0, f: 3},
        ]
    },
    {
        name: 'Shape 5',
        color: 'rgb(59, 130, 246)', // Blue
        notes: [
            {s: 5, f: 1}, {s: 5, f: 3, t: RootType.Minor},
            {s: 4, f: 1}, {s: 4, f: 3},
            {s: 3, f: 0}, {s: 3, f: 3},
            {s: 2, f: 0, t: RootType.Minor}, {s: 2, f: 3, t: RootType.Major},
            {s: 1, f: 1}, {s: 1, f: 3},
            {s: 0, f: 1}, {s: 0, f: 3, t: RootType.Minor},
        ]
    }
];

export const ALL_SHAPES: Record<ScaleType, ScaleShape[]> = {
    'Pentatonic': MINOR_PENTATONIC_SHAPES,
    'Ionian': IONIAN_MODE_SHAPES,
    'Dorian': DORIAN_MODE_SHAPES,
    'Phrygian': PHRYGIAN_MODE_SHAPES,
    'Lydian': LYDIAN_MODE_SHAPES,
    'Mixolydian': MIXOLYDIAN_MODE_SHAPES,
    'Aeolian': AEOLIAN_MODE_SHAPES,
    'Locrian': LOCRIAN_MODE_SHAPES,
    'Harmonic Minor': HARMONIC_MINOR_MODE_SHAPES,
    'Locrian #6': LOCRIAN_6_SHAPES,
    'Ionian #5': IONIAN_5_SHAPES,
    'Dorian #4': DORIAN_4_SHAPES,
    'Phrygian Dominant': PHRYGIAN_DOMINANT_SHAPES,
    'Lydian #2': LYDIAN_2_SHAPES,
    'Altered Dominant bb7': ALTERED_DOMINANT_BB7_SHAPES,
    'Melodic Minor': MELODIC_MINOR_SHAPES,
    'Dorian b2': DORIAN_B2_SHAPES,
    'Lydian Augmented': LYDIAN_AUGMENTED_SHAPES,
    'Lydian Dominant': LYDIAN_DOMINANT_SHAPES,
    'Mixolydian b6': MIXOLYDIAN_B6_SHAPES,
    'Locrian #2': LOCRIAN_2_SHAPES,
    'Altered Scale': ALTERED_SCALE_SHAPES,
};

// --- CHORD STYLING ---
const chordStyling = {
    [BuiltInChords.Major]: { rgb: 'rgb(250, 204, 21)', text: 'text-yellow-400', fill: 'fill-yellow-400/20 stroke-yellow-400', dot: 'bg-yellow-400 text-gray-900 border-yellow-600', rootDot: 'bg-yellow-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Minor]: { rgb: 'rgb(96, 165, 250)', text: 'text-blue-400', fill: 'fill-blue-400/20 stroke-blue-400', dot: 'bg-blue-400 text-white border-blue-600', rootDot: 'bg-blue-400 text-white border-stone-200' },
    [BuiltInChords.Diminished]: { rgb: 'rgb(167, 139, 250)', text: 'text-violet-400', fill: 'fill-violet-400/20 stroke-violet-400', dot: 'bg-violet-400 text-white border-violet-600', rootDot: 'bg-violet-400 text-white border-stone-200' },
    [BuiltInChords.Augmented]: { rgb: 'rgb(248, 113, 113)', text: 'text-red-400', fill: 'fill-red-400/20 stroke-red-400', dot: 'bg-red-400 text-white border-red-600', rootDot: 'bg-red-400 text-white border-stone-200' },
    [BuiltInChords.Sus2]: { rgb: 'rgb(74, 222, 128)', text: 'text-green-400', fill: 'fill-green-400/20 stroke-green-400', dot: 'bg-green-400 text-gray-900 border-green-600', rootDot: 'bg-green-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Sus4]: { rgb: 'rgb(163, 230, 53)', text: 'text-lime-400', fill: 'fill-lime-400/20 stroke-lime-400', dot: 'bg-lime-400 text-gray-900 border-lime-600', rootDot: 'bg-lime-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Major7]: { rgb: 'rgb(250, 204, 21)', text: 'text-yellow-400', fill: 'fill-yellow-400/20 stroke-yellow-400', dot: 'bg-yellow-400 text-gray-900 border-yellow-600', rootDot: 'bg-yellow-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Minor7]: { rgb: 'rgb(96, 165, 250)', text: 'text-blue-400', fill: 'fill-blue-400/20 stroke-blue-400', dot: 'bg-blue-400 text-white border-blue-600', rootDot: 'bg-blue-400 text-white border-stone-200' },
    [BuiltInChords.Dominant7]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Diminished7]: { rgb: 'rgb(167, 139, 250)', text: 'text-violet-400', fill: 'fill-violet-400/20 stroke-violet-400', dot: 'bg-violet-400 text-white border-violet-600', rootDot: 'bg-violet-400 text-white border-stone-200' },
    [BuiltInChords.Minor7b5]: { rgb: 'rgb(192, 132, 252)', text: 'text-purple-400', fill: 'fill-purple-400/20 stroke-purple-400', dot: 'bg-purple-400 text-white border-purple-600', rootDot: 'bg-purple-400 text-white border-stone-200' },
    [BuiltInChords.Major6]: { rgb: 'rgb(250, 204, 21)', text: 'text-yellow-400', fill: 'fill-yellow-400/20 stroke-yellow-400', dot: 'bg-yellow-400 text-gray-900 border-yellow-600', rootDot: 'bg-yellow-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Minor6]: { rgb: 'rgb(96, 165, 250)', text: 'text-blue-400', fill: 'fill-blue-400/20 stroke-blue-400', dot: 'bg-blue-400 text-white border-blue-600', rootDot: 'bg-blue-400 text-white border-stone-200' },
    [BuiltInChords.Major9]: { rgb: 'rgb(250, 204, 21)', text: 'text-yellow-400', fill: 'fill-yellow-400/20 stroke-yellow-400', dot: 'bg-yellow-400 text-gray-900 border-yellow-600', rootDot: 'bg-yellow-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Minor9]: { rgb: 'rgb(96, 165, 250)', text: 'text-blue-400', fill: 'fill-blue-400/20 stroke-blue-400', dot: 'bg-blue-400 text-white border-blue-600', rootDot: 'bg-blue-400 text-white border-stone-200' },
    [BuiltInChords.Dominant9]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Add9]: { rgb: 'rgb(250, 204, 21)', text: 'text-yellow-400', fill: 'fill-yellow-400/20 stroke-yellow-400', dot: 'bg-yellow-400 text-gray-900 border-yellow-600', rootDot: 'bg-yellow-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Dominant7b9]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Dominant7sharp9]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Minor11]: { rgb: 'rgb(96, 165, 250)', text: 'text-blue-400', fill: 'fill-blue-400/20 stroke-blue-400', dot: 'bg-blue-400 text-white border-blue-600', rootDot: 'bg-blue-400 text-white border-stone-200' },
    [BuiltInChords.Dominant11]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Dominant7sharp11]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Major13]: { rgb: 'rgb(250, 204, 21)', text: 'text-yellow-400', fill: 'fill-yellow-400/20 stroke-yellow-400', dot: 'bg-yellow-400 text-gray-900 border-yellow-600', rootDot: 'bg-yellow-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Minor13]: { rgb: 'rgb(96, 165, 250)', text: 'text-blue-400', fill: 'fill-blue-400/20 stroke-blue-400', dot: 'bg-blue-400 text-white border-blue-600', rootDot: 'bg-blue-400 text-white border-stone-200' },
    [BuiltInChords.Dominant13]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Dominant7b13]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
    [BuiltInChords.Dominant9_13]: { rgb: 'rgb(56, 189, 248)', text: 'text-sky-400', fill: 'fill-sky-400/20 stroke-sky-400', dot: 'bg-sky-400 text-gray-900 border-sky-600', rootDot: 'bg-sky-400 text-gray-900 border-stone-200' },
};

const createStyleRecord = (key: 'rgb' | 'text' | 'fill' | 'dot' | 'rootDot') => 
    Object.fromEntries(Object.entries(chordStyling).map(([chordType, styles]) => [chordType, styles[key]])) as Record<ChordType, string>;

export const CHORD_RGB_COLORS: Record<ChordType, string> = createStyleRecord('rgb');
export const CHORD_TEXT_COLORS: Record<ChordType, string> = createStyleRecord('text');
export const CHORD_COLORS: Record<ChordType, string> = createStyleRecord('fill');
export const CHORD_DOT_CLASSES: Record<ChordType, string> = createStyleRecord('dot');
export const ROOT_NOTE_DOT_CLASSES: Record<ChordType, string> = createStyleRecord('rootDot');