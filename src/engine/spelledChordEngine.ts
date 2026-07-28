/**
 * spelledChordEngine.ts — Fase 2 spelling-first chord recognizer.
 *
 * Replacement for the score-based pipeline in musicTheory.ts
 * (identifyChord / identifyChordCandidates / findStandardCandidates).
 * Operates DIRECTLY on SpelledPitch — no pitch-class mod-12 in the core,
 * so enharmonic spellings produce different (and correct) readings.
 *
 * Algorithm summary (no cumulative numeric scoring):
 *   1. For each input note as candidate root:
 *      a. Compute spelledInterval(root, other) for every other note.
 *      b. Group by diatonic number (1..7) and detect intra-degree conflicts
 *         (two different qualities on the same diatonic step ⇒ unspellable
 *         pattern from this root, candidate eliminated).
 *   2. For each ChordPattern (Major triad, Dom7, °7, …):
 *      a. The pattern is matched if every degree present in the candidate's
 *         degree map has matching quality, AND the pattern's required
 *         degrees are all either present or in the "tolerable-missing" set.
 *   3. Tie-break (NO additive scores):
 *      a. Prefer patterns with FEWER missing required degrees.
 *      b. Then prefer the candidate with FEWER extra degrees (notes not in
 *         the pattern).
 *      c. Then prefer higher pattern specificity (Diminished7 over Diminished,
 *         Dominant7 over Major, …) via the priority list.
 *      d. Then prefer the candidate whose root has the SIMPLEST spelling
 *         (fewer accidentals) — letter-coherent over enharmonic.
 *   4. Confidence: (matched required degrees) / (total required degrees),
 *      clamped to [0,1].
 *
 * Coverage (Fase 2):
 *   – Triads: Major, Minor, Diminished, Augmented, Sus2, Sus4
 *   – Sevenths: Major7, Minor7, MinorMajor7, Dominant7, Diminished7, Minor7b5
 *   – Sixths: Major6, Minor6
 *   – Add9: Add9, MinorAdd9
 *
 * Out-of-scope for Fase 2 (compound intervals required — TODO with
 * spelledIntervalCompound):
 *   – 9ths/11ths/13ths (Major9, Dominant13, Minor11, …)
 *
 * Until those are added, the current pipeline (musicTheory.identifyChord)
 * still owns 9/11/13 cases. Migration in Fase 3 will route to the engine
 * only for the covered chord families.
 */

import { SpelledPitch, BuiltInChords, ChordType } from '../types';
import {
  spelledInterval,
  type SpelledInterval,
  type KeySignatureForSpelling,
} from '../utils/spelledPitch';

// ── Types ──────────────────────────────────────────────────────────────────

/** Degree (diatonic step from root): 1=unison/root, 3=third, 5=fifth, 7=seventh, 6=sixth, 2/4=sus, 9=ninth(=2+octave) */
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9;

export type DegreeSpec = {
  degree: Degree;
  quality: string; // 'P' | 'M' | 'm' | 'A' | 'd'
};

export type ChordPattern = {
  type: ChordType;
  /** Degrees that must be present for the chord to be considered. */
  required: DegreeSpec[];
  /** Degrees the chord MAY have but isn't required; if present they must match. */
  optional?: DegreeSpec[];
  /** Required degrees whose absence is tolerable (i.e. they CAN be missing
   *  without disqualifying the chord). The 5th is the canonical tolerable
   *  omission — voice-leading often drops it. */
  tolerableMissing?: Degree[];
  /** Higher = more specific. Used as final tie-break, not cumulative. */
  specificity: number;
};

export type AnalyzedChord = {
  /** The chosen root (one of the input notes' spelling). */
  root: SpelledPitch;
  /** Identified chord type (BuiltInChords value or extension string). */
  quality: ChordType;
  /** 0 = root position, 1 = first inversion (3rd in bass), 2 = second (5th in bass), 3 = third (7th in bass). null if bass info missing/ambiguous. */
  inversion: 0 | 1 | 2 | 3 | null;
  /** Degrees expected by the pattern but absent from the chord. */
  missingDegrees: Degree[];
  /** Notes (input indices) not assigned to a pattern degree. */
  extraNoteIndices: number[];
  /** [0..1] — fraction of required degrees that matched. */
  confidence: number;
};

// ── Chord pattern table (spelled-tertian) ──────────────────────────────────

const _ds = (degree: Degree, quality: string): DegreeSpec => ({ degree, quality });

/**
 * Pattern declarations. The `required` list is the canonical tertian skeleton
 * for that chord type, with the root (degree 1) implicit (it's the candidate).
 * `specificity` mirrors the existing CHORD_CHECK_ORDER intuition: richer
 * sonorities outrank poorer ones when both match.
 */
export const CHORD_PATTERNS: ChordPattern[] = [
  // ── Seventh chords (most specific) ────────────────────────────────────
  { type: BuiltInChords.Diminished7,  required: [_ds(3,'m'), _ds(5,'d'), _ds(7,'d')], tolerableMissing: [5], specificity: 90 },
  { type: BuiltInChords.Minor7b5,     required: [_ds(3,'m'), _ds(5,'d'), _ds(7,'m')], tolerableMissing: [5], specificity: 85 },
  { type: BuiltInChords.MinorMajor7,  required: [_ds(3,'m'), _ds(5,'P'), _ds(7,'M')], tolerableMissing: [5], specificity: 80 },
  { type: BuiltInChords.Major7,       required: [_ds(3,'M'), _ds(5,'P'), _ds(7,'M')], tolerableMissing: [5], specificity: 75 },
  { type: BuiltInChords.Minor7,       required: [_ds(3,'m'), _ds(5,'P'), _ds(7,'m')], tolerableMissing: [5], specificity: 75 },
  { type: BuiltInChords.Dominant7,    required: [_ds(3,'M'), _ds(5,'P'), _ds(7,'m')], tolerableMissing: [5, 3], specificity: 75 },

  // ── Sixths ────────────────────────────────────────────────────────────
  { type: BuiltInChords.Major6,       required: [_ds(3,'M'), _ds(5,'P'), _ds(6,'M')], tolerableMissing: [5], specificity: 70 },
  { type: BuiltInChords.Minor6,       required: [_ds(3,'m'), _ds(5,'P'), _ds(6,'M')], tolerableMissing: [5], specificity: 70 },

  // ── Add9 (root + triad + 2nd/9th, no 7th) ─────────────────────────────
  // Until compound intervals land, the 9th is recognized as a M2 above root.
  { type: BuiltInChords.Add9,         required: [_ds(2,'M'), _ds(3,'M'), _ds(5,'P')], tolerableMissing: [5], specificity: 65 },
  { type: BuiltInChords.MinorAdd9,    required: [_ds(2,'M'), _ds(3,'m'), _ds(5,'P')], tolerableMissing: [5], specificity: 65 },

  // ── Triads ────────────────────────────────────────────────────────────
  { type: BuiltInChords.Augmented,    required: [_ds(3,'M'), _ds(5,'A')], specificity: 50 },
  { type: BuiltInChords.Diminished,   required: [_ds(3,'m'), _ds(5,'d')], specificity: 50 },
  { type: BuiltInChords.Major,        required: [_ds(3,'M'), _ds(5,'P')], tolerableMissing: [5], specificity: 40 },
  { type: BuiltInChords.Minor,        required: [_ds(3,'m'), _ds(5,'P')], tolerableMissing: [5], specificity: 40 },

  // ── Suspended ─────────────────────────────────────────────────────────
  // Sus2 listed BEFORE Sus4: when [C,D,G] is read from C it's a Csus2,
  // from G it's a Gsus4 — without bass info, the convention is to prefer
  // the reading rooted on the BOTTOM note of the tertian stack (more
  // common in tonal usage). Sus2 wins by being earlier when specificities
  // are equal and no bass disambiguates.
  { type: BuiltInChords.Sus2,         required: [_ds(2,'M'), _ds(5,'P')], specificity: 30 },
  { type: BuiltInChords.Sus4,         required: [_ds(4,'P'), _ds(5,'P')], specificity: 30 },
];

// ── Core helpers ───────────────────────────────────────────────────────────

/** Number of accidentals (in absolute value) — used as letter-purity tie-break. */
function accidentalLoad(p: SpelledPitch): number {
  return Math.abs(p.accidental);
}

/** Two SpelledPitch values represent the same written note (ignoring octave). */
function samePitchClassSpelled(a: SpelledPitch, b: SpelledPitch): boolean {
  return a.letter === b.letter && a.accidental === b.accidental;
}

/**
 * Compute the per-degree interval map from `root` to every note in `others`.
 * Returns `null` if two notes occupy the same diatonic degree above root
 * with DIFFERENT qualities — that means the pattern is unspellable from this
 * root (e.g. both an M3 and an m3 above the same root, which can only happen
 * if the root choice is wrong).
 *
 * Notes that are the same written note as root (P1) are excluded.
 */
export function tertianAnalysisFromRoot(
  root: SpelledPitch,
  others: SpelledPitch[],
): {
  degrees: Map<number, { quality: string; sourceIndex: number }>;
  rejected: boolean;
} {
  const degrees = new Map<number, { quality: string; sourceIndex: number }>();
  for (let i = 0; i < others.length; i++) {
    const n = others[i];
    if (samePitchClassSpelled(root, n)) continue;
    const iv: SpelledInterval = spelledInterval(root, n);
    const existing = degrees.get(iv.diatonicNumber);
    if (existing && existing.quality !== iv.quality) {
      // Same letter step with two different qualities — unspellable from this root.
      return { degrees, rejected: true };
    }
    if (!existing) {
      degrees.set(iv.diatonicNumber, { quality: iv.quality, sourceIndex: i });
    }
  }
  return { degrees, rejected: false };
}

/**
 * Test whether `pattern` matches the per-degree map produced by
 * tertianAnalysisFromRoot. Returns the match details (degrees matched,
 * degrees missing-but-tolerable, extra notes) or null if the pattern fails.
 *
 * Failure modes:
 *  – any required degree present in `degrees` with WRONG quality → fail
 *  – any required NON-tolerable degree absent → fail
 *  – any optional degree present with WRONG quality → fail
 *  – more than ONE tolerable-missing degree absent → fail
 *    (a pattern is allowed at most one elided chord tone; Dom7 with only
 *    a m7 and no 3rd+5th would otherwise eat any bare m7 in the input)
 *
 * `rootIndex` is the index of the root candidate within the source notes
 * array — required so the root itself is never counted as an "extra".
 */
function matchPattern(
  pattern: ChordPattern,
  degrees: Map<number, { quality: string; sourceIndex: number }>,
  totalNoteCount: number,
  rootIndex: number,
): {
  matchedDegrees: Degree[];
  missingDegrees: Degree[];
  extraNoteIndices: number[];
  confidence: number;
} | null {
  const requiredMap = new Map(pattern.required.map(r => [r.degree, r.quality]));
  const optionalMap = new Map((pattern.optional ?? []).map(o => [o.degree, o.quality]));
  const tolerable = new Set(pattern.tolerableMissing ?? []);

  const matched: Degree[] = [];
  const missing: Degree[] = [];
  const usedIndices = new Set<number>();

  for (const [degree, expectedQuality] of requiredMap) {
    const present = degrees.get(degree);
    if (present) {
      if (present.quality !== expectedQuality) return null;
      matched.push(degree as Degree);
      usedIndices.add(present.sourceIndex);
    } else {
      if (!tolerable.has(degree)) return null;
      missing.push(degree as Degree);
    }
  }
  if (missing.length > 1) return null; // at most one tolerable elision

  for (const [degree, expectedQuality] of optionalMap) {
    const present = degrees.get(degree);
    if (present) {
      if (present.quality !== expectedQuality) return null;
      matched.push(degree as Degree);
      usedIndices.add(present.sourceIndex);
    }
  }

  // Any note that is neither the root nor used by a pattern degree is "extra".
  const extraIndices: number[] = [];
  for (let i = 0; i < totalNoteCount; i++) {
    if (i === rootIndex) continue;
    if (!usedIndices.has(i)) extraIndices.push(i);
  }

  const totalRequired = requiredMap.size;
  const confidence = totalRequired === 0 ? 0 : matched.length / totalRequired;
  return { matchedDegrees: matched, missingDegrees: missing, extraNoteIndices: extraIndices, confidence };
}

// ── Inversion ───────────────────────────────────────────────────────────────

/** Map the bass note to a chord degree (1=root, 3, 5, 6, 7), returning the
 *  inversion number expected by Roman analysis. null if bass doesn't match
 *  any chord tone. */
function inversionFromBass(
  root: SpelledPitch,
  matchedDegrees: Degree[],
  bass: SpelledPitch | null | undefined,
): 0 | 1 | 2 | 3 | null {
  if (!bass) return null;
  if (samePitchClassSpelled(root, bass)) return 0;
  const iv = spelledInterval(root, bass);
  // Inversion mapping: deg 3 → 1st, deg 5 → 2nd, deg 7 (or 6) → 3rd.
  if (iv.diatonicNumber === 3 && matchedDegrees.includes(3)) return 1;
  if (iv.diatonicNumber === 5 && matchedDegrees.includes(5)) return 2;
  if (iv.diatonicNumber === 7 && matchedDegrees.includes(7)) return 3;
  if (iv.diatonicNumber === 6 && matchedDegrees.includes(6)) return 3; // 6th chord in 3rd-ish inversion
  return null;
}

// ── Main entry point ────────────────────────────────────────────────────────

export type AnalyzeOptions = {
  bass?: SpelledPitch | null;
  /** Reserved for future key-aware tie-breaks (e.g. prefer ii° over vii°/♭III). */
  keySignature?: KeySignatureForSpelling;
};

export function analyzeChord(notes: SpelledPitch[], options?: AnalyzeOptions): AnalyzedChord | null {
  if (!notes || notes.length < 2) return null;

  // Deduplicate by written spelling (letter+accidental, ignore octave).
  // Keep the first occurrence's octave; downstream cares only about pc-spelling.
  const uniqueByWritten: SpelledPitch[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    const key = `${n.letter}${n.accidental}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueByWritten.push(n);
    }
  }
  if (uniqueByWritten.length < 2) return null;

  type Candidate = {
    root: SpelledPitch;
    pattern: ChordPattern;
    matchedDegrees: Degree[];
    missingDegrees: Degree[];
    extraNoteIndices: number[];
    confidence: number;
  };
  const candidates: Candidate[] = [];

  for (let rootIdx = 0; rootIdx < uniqueByWritten.length; rootIdx++) {
    const root = uniqueByWritten[rootIdx];
    const { degrees, rejected } = tertianAnalysisFromRoot(root, uniqueByWritten);
    if (rejected) continue;
    for (const pattern of CHORD_PATTERNS) {
      const m = matchPattern(pattern, degrees, uniqueByWritten.length, rootIdx);
      if (!m) continue;
      candidates.push({ root, pattern, ...m });
    }
  }

  if (candidates.length === 0) return null;

  // Tie-break order (no cumulative scoring):
  //   1. fewer missing required degrees (more complete match)
  //   2. fewer extra notes (pattern explains the whole chord)
  //   3. higher specificity (richer pattern beats poorer pattern)
  //      Rationale: tonal convention reads {F,A,C,D} with F-in-bass as
  //      ii6/5 (Dm7/F) — the more-specific m7 outranks the Maj6 reading
  //      even when the bass coincides with the Maj6 root.
  //   4. ROOT == BASS preferred (only when specificity ties, e.g. Sus2/Sus4
  //      both at specificity 30 → bass disambiguates Csus2 vs Gsus4).
  //   5. simpler root spelling (fewer accidentals on the root)
  //   6. pattern declaration order (stable, breaks remaining ties)
  //
  // Implicit bass: if no bass is supplied, fall back to the note with the
  // lowest octave (then lowest pitch-class within the octave). This matches
  // the engraving convention where chord voicings are written bottom-up.
  const explicitBass = options?.bass ?? null;
  const implicitBass = explicitBass ?? notes.slice().sort((a, b) => {
    if (a.octave !== b.octave) return a.octave - b.octave;
    // Within the same octave, compare by semitone-from-C (letter+accidental).
    const aSemi = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[a.letter] + a.accidental;
    const bSemi = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[b.letter] + b.accidental;
    return aSemi - bSemi;
  })[0];
  const bass = implicitBass;
  /**
   * Un modello che SOTTINTENDE proprio il grado alterato da cui prende il nome sta
   * dichiarando un'alterazione che non è scritta da nessuna parte. Una settima minore
   * senza quinta è una m7, non una m7♭5: la quinta assente si presume giusta, non
   * diminuita. Vale solo come confronto FRA candidati — se il modello alterato è
   * l'unico che spiega le note (una °7 scritta senza quinta) resta lui a vincere.
   */
  const elidesItsOwnAlteredDegree = (c: Candidate): boolean => {
    if (c.missingDegrees.length === 0) return false;
    const required = new Map(c.pattern.required.map(d => [d.degree, d.quality]));
    return c.missingDegrees.some(deg => {
      const q = required.get(deg);
      return q === 'd' || q === 'A';
    });
  };

  candidates.sort((a, b) => {
    const dMiss = a.missingDegrees.length - b.missingDegrees.length;
    if (dMiss !== 0) return dMiss;
    const dExtra = a.extraNoteIndices.length - b.extraNoteIndices.length;
    if (dExtra !== 0) return dExtra;
    const aGuess = elidesItsOwnAlteredDegree(a) ? 1 : 0;
    const bGuess = elidesItsOwnAlteredDegree(b) ? 1 : 0;
    if (aGuess !== bGuess) return aGuess - bGuess;
    const dSpec = b.pattern.specificity - a.pattern.specificity;
    if (dSpec !== 0) return dSpec;
    if (bass) {
      const aBassRoot = samePitchClassSpelled(a.root, bass) ? 0 : 1;
      const bBassRoot = samePitchClassSpelled(b.root, bass) ? 0 : 1;
      if (aBassRoot !== bBassRoot) return aBassRoot - bBassRoot;
    }
    const dAcc = accidentalLoad(a.root) - accidentalLoad(b.root);
    if (dAcc !== 0) return dAcc;
    return CHORD_PATTERNS.indexOf(a.pattern) - CHORD_PATTERNS.indexOf(b.pattern);
  });

  const winner = candidates[0];
  // For the inversion field we use the EXPLICIT bass only — implicit bass is
  // a tie-breaker for root choice, not a claim about voicing.
  const inversion = inversionFromBass(winner.root, winner.matchedDegrees, explicitBass);

  return {
    root: winner.root,
    quality: winner.pattern.type,
    inversion,
    missingDegrees: winner.missingDegrees,
    extraNoteIndices: winner.extraNoteIndices,
    confidence: winner.confidence,
  };
}
