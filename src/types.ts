
export type ScaleType = string;

export enum RootType {
  Major = 'major',
  Minor = 'minor',
}

export type ScaleNoteDefinition = {
  s: number; // string index (0: high e, 5: low E)
  f: number; // fret offset
  t?: RootType; // type of note
  isAlternate?: boolean;
};

export type ScaleShape = {
  name: string;
  color: string;
  notes: ScaleNoteDefinition[];
};

export type PlacedBox = {
  id: string;
  shapeIndex: number;
  fretPosition: number;
  scaleType: ScaleType;
};

export type FretboardNote = {
  noteName: string;
  pentatonicInfo?: {
    boxId: string;
    color: string;
    type?: RootType;
    isAlternate?: boolean;
  }
}

export type Key = {
  note: string;
  scale: 'Major' | 'Minor';
};

export type EnharmonicMode = 'auto' | 'sharp' | 'flat';

// --- NEW TYPES FOR CHORD VISUALIZER ---

export interface Note {
  sharp: string;
  flat: string;
  audioFile: string;
}

export type ChordType = string;

export const BuiltInChords = {
  // Triads
  Major: 'Major',
  Minor: 'Minor',
  Augmented: 'Augmented',
  Diminished: 'Diminished',

  // Suspended
  Sus2: 'Sus2',
  Sus4: 'Sus4',
  
  // Sevenths
  Major7: 'Major 7',
  Minor7: 'Minor 7',
  MinorMajor7: 'Minor Maj7',
  Dominant7: 'Dominant 7',
  Diminished7: 'Diminished 7',
  Minor7b5: 'Minor 7♭5', // Half-Diminished
  
  // Sixths
  Major6: 'Major 6',
  Minor6: 'Minor 6',

  // Ninths
  Major9: 'Major 9',
  Minor9: 'Minor 9',
  Dominant9: 'Dominant 9',
  Add9: 'Add 9',
  Dominant7b9: 'Dominant 7♭9',
  Dominant7sharp9: 'Dominant 7♯9',

  // Elevenths
  Minor11: 'Minor 11',
  Dominant11: 'Dominant 11',
  Dominant7sharp11: 'Dominant 7♯11',
  
  // Thirteenths
  Major13: 'Major 13',
  Minor13: 'Minor 13',
  Dominant13: 'Dominant 13',
  Dominant7b13: 'Dominant 7♭13',
  Dominant9_13: 'Dominant 9/13',
} as const;


export type EnharmonicPreference = 'sharp' | 'flat';

export interface DisplayNote extends Note {
  name: string;
  isEnharmonic: boolean;
  originalIndex: number;
}

export type Voicing = [number, number, number, number, number, number]; // [E, A, D, G, B, e], -1 for muted

export interface CagedVoicing {
  name: string;
  voicing: Voicing;
}

// --- NEW TYPES FOR INTERVAL VISUALIZER ---

export interface Interval {
  name: string;
  shortName: string;
  semitones: number;
  color: string;
  rgbColor: string;
}

export interface PlacedInterval {
  id: string;
  rootNote: { s: number; f: number; noteIndex: number; midi: number };
  targetNote: { s: number; f: number; noteIndex: number; midi: number };
  interval: Interval;
  direction: 'ascending' | 'descending';
}

// --- NEW TYPES FOR STAFF ---

export type AccidentalType = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat';
export type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirty-second' | 'sixty-fourth';
export type ClefType = 'treble' | 'bass' | 'soprano' | 'alto' | 'tenor';
export type Voice = 1 | 2 | 3 | 4;

export type StaffNote = {
  id: string;
  pitch: string; // e.g., 'C', 'F'
  octave: number;
  accidental?: AccidentalType;
  explicitAccidental?: AccidentalType | null;
  position: number; // 0=C4, 1=D4, etc. relative to C4
  midi: number;
  color?: string;
  noteIndex: number;
  isPentatonicNote?: boolean;
  isPassing?: boolean;
  timestep?: number;
  xPosition?: number;
  duration?: NoteDuration;
  isRest?: boolean;
  isTriplet?: boolean;
  isDuplet?: boolean;
  isDotted?: boolean;
  isTiedToNext?: boolean;
  // Render hint: this note continues a tie from the previous system/line.
  // (Computed in the editor; stored notes only need isTiedToNext on the source note.)
  isTiedFromPrev?: boolean;
  groupId?: string;
  chordId?: string; // New property to group notes vertically in the same chord
  measureIndex?: number;
  beat?: number;
  // Tick-based timeline (high resolution). Optional for legacy compatibility.
  startTick?: number;
  durationTicks?: number;
  clef?: ClefType;
  errorType?: 'error' | 'warning' | 'exception' | null;
  voice?: Voice;
  manualBeamGroupId?: string;
  manualBeamDisabled?: boolean;
  manualStemDirection?: 'up' | 'down';
  manualTieDirection?: 'up' | 'down';
};

// FIX: Added Barline type for use in Staff.tsx
export type Barline = {
  id: string;
  xPosition: number;
  style?: 'single' | 'double' | 'final';
};

export type KeySignature = {
  type: 'sharp' | 'flat';
  count: number;
};

export type TimeSignature = {
  numerator: number;
  denominator: number;
};

export type TimeSignatureChange = {
  // Timeline position in quarter-note units from start (can be fractional).
  absBeat?: number;
  // Legacy support (older state): measure boundary context.
  measureIndex?: number;
  numerator: number;
  denominator: number;
};

// --- HARMONY ANALYSIS ---
export type ErrorConnection = {
  type: 'vertical' | 'horizontal';
  noteId1: string;
  noteId2: string;
  // Optional metadata to keep connection coloring tied to the originating rule.
  // If absent, the editor may derive severity from violations/endpoints.
  severity?: 'error' | 'warning' | 'exception';
  ruleId?: string;
};

export type RuleViolation = {
    ruleId: string;
    description: string;
    suggestion?: string;
    noteIds: string[];
    severity: 'error' | 'warning' | 'exception';
};

export type AnalysisContext = {
  // New: position in the score timeline (quarter-note beats from start, can be fractional).
  // This enables mid-measure key contexts (tonicizations/modulations) aligned to the playhead.
  absBeat?: number;
  // Legacy support (older state): measure boundary context.
  measureIndex?: number;
    newTonic: string;
    newIsMinor: boolean;
    // Optional custom label shown above the staff for this context.
    label?: string;
    // Optional: inference confidence score (used only for engine-inferred contexts).
    score?: number;
    // Optional: source tag for UI/debug.
    source?: 'manual' | 'inferred';
};

export interface HarmonyAnalysisResult {
    analyzedNotes: StaffNote[];
    connections: ErrorConnection[];
    violations: RuleViolation[];
  // Optional: contexts inferred by the engine (tonicizations/modulations).
  // The editor can merge these with user-provided `analysisContexts`.
  inferredAnalysisContexts?: AnalysisContext[];
  // Optional: label overrides inferred by the engine (e.g. local cadences IV–V–I / ii–V–I).
  // The editor may apply these as display-only overrides (user overrides should still win).
  autoHarmonyLabelOverrides?: HarmonyLabelOverride[];
}

export type SequenceMatch = {
  startSlotIdx: number;
  endSlotIdx: number;
  lengthSteps: number;
  confidence: number;
  repeatsCount?: number;
  startTick: number;
  endTick: number;
  startMeasure: number;
  endMeasure: number;
  modelStartMeasure?: number;
  modelEndMeasure?: number;
  repeatStartMeasure?: number;
  repeatEndMeasure?: number;
  slotTicks?: number[];
  transpositionSemitones?: number | null;
  label?: string;
};

export type HarmonyLabelOverride = {
  // Timeline position in quarter-note units from start (can be fractional).
  absBeat: number;
  roman?: string;
  // Optional display-only roman (e.g. I=VI). If set, it should be preferred for rendering.
  romanDisplay?: string;
  figures?: string[];
  symbol?: string;
  note?: string;
};