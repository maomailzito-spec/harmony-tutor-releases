/**
 * Chorale Realization Engine
 * ─────────────────────────
 * Pure engine — zero React/UI dependencies.
 * Input:  RomanChord[] + tonic + mode + time signature + rules config
 * Output: StaffNote[] identical to GrandStaffEditor format
 *
 * Responsibilities:
 *   - Parse roman numerals → chord tones (spelling-first, diatonic)
 *   - Realize SATB voicings respecting voice ranges
 *   - Voice leading: smallest motion, contrary/oblique preferred
 *   - Rule checking: no parallel 5ths/8ves, voice crossing, spacing, doubling
 *   - Resolution: leading tone → tonic, 7ths resolve down by step
 *
 * Testable with plain `npx tsx` + unit tests (no DOM, no Electron).
 */

import type { StaffNote, Voice, TimeSignature, KeySignature } from '../types';
import { TICKS_PER_QUARTER, DURATION_VALUES } from '../constants';
import type { StyleProfile } from './choralStyleProfile';
import { getInversionBonus, getMotionBonus, getContraryMotionBonus } from './choralStyleProfile';
import { veto, confronta, type EsitoVeto } from './vetoRegole';
import { pesiDeiGradi, bonusTransizione, pesoSecondaria, costoMotoEstremi, pesiDiChiusura, costoDelRaddoppio } from './corpusProgressione';

/**
 * CONTI DI VITA DEL VETO — diagnostica, non logica.
 *
 * Servono a rispondere a «il veto sta lavorando davvero?», che è una domanda diversa da
 * «il risultato è migliore». Una fotografia istantanea direbbe quasi sempre zero; questi
 * si accumulano, e il banco di prova li stampa a fine corsa.
 *
 * `fermati` = accordi che il checker ha respinto · `risolti` = di quelli, quanti hanno
 * trovato un'alternativa pulita · `migliorati` = quanti hanno solo ridotto il danno ·
 * `perRegola` = quali regole sbarrano la strada, che è il dato da cui si capisce dove il
 * generatore sbaglia di sistema.
 */
/** I tipi di violazione che riguardano un accordo DA SOLO: non nascono dal rapporto con
 *  l'accordo precedente, quindi il veto non li rimette in discussione. */
const VERTICALI = new Set(['spacing', 'voice-crossing', 'range', 'doubling']);

export const contiVeto = {
  controllati: 0,
  fermati: 0,
  risolti: 0,
  migliorati: 0,
  /** Quante volte si è dovuto tornare indietro di un accordo per trovare l'uscita. */
  passiIndietro: 0,
  /** Quanti accordi il RIPASSO ha ridisposto guardando anche l'accordo dopo. */
  ripassati: 0,
  perRegola: {} as Record<string, number>,
};

/** Azzera i conti del veto (per misurare UN brano solo). */
export function azzeraContiVeto(): void {
  contiVeto.controllati = 0;
  contiVeto.fermati = 0;
  contiVeto.risolti = 0;
  contiVeto.migliorati = 0;
  contiVeto.passiIndietro = 0;
  contiVeto.ripassati = 0;
  contiVeto.perRegola = {};
}

// ─── Types ─────────────────────────────────────────────────────────────────

/** Roman numeral chord descriptor (engine input). */
export type RomanChord = {
  /** Roman numeral string, e.g. 'I', 'ii', 'V7', 'viio', 'IV6', 'V65' */
  roman: string;
  /** Inversion (0 = root, 1 = first, 2 = second, 3 = third for 7ths) */
  inversion?: number;
  /** Il rivolto è una PROPOSTA della macchina, non una scelta dell'utente.
   *  `autoHarmonize` lo mette sempre — lo indovina con un'euristica — e finché non si
   *  distinguevano i due casi il veto non poteva rimetterlo in discussione senza rischiare
   *  di calpestare un cifrato scritto a mano. Con questo può: se la proposta porta a quinte
   *  nascoste fra le voci estreme, si cambia rivolto invece di arrendersi. */
  inversionIsSuggestion?: boolean;
  /** Beat within the measure (1-based, can be fractional) */
  beat: number;
  /** Measure index (0-based) */
  measure: number;
  /** Explicit note duration (e.g. 'whole', 'half', 'quarter', 'eighth'). If omitted, auto-calculated. */
  duration?: string;
  /**
   * Modulation: override tonic from this chord onwards.
   * e.g. 'G' for G major, 'g' for G minor.
   * Upper-case letter = major, lower-case letter = minor.
   * Accidentals follow: 'Bb' = Bb major, 'f#' = F# minor.
   */
  modulateTo?: string;
};

/** User-configurable rules for the realization engine. */
export type ChoralRules = {
  /** Allow parallel 5ths (default: false → forbidden) */
  allowParallel5ths?: boolean;
  /** Allow parallel 8ves (default: false → forbidden) */
  allowParallel8ves?: boolean;
  /** Allow voice crossing (default: false → forbidden) */
  allowCrossing?: boolean;
  /** Allow voice overlap (default: false → forbidden) */
  allowOverlap?: boolean;
  /** Always double the root in root-position triads (default: true) */
  doubleRoot?: boolean;
};

/** Re-export StyleProfile so consumers can import it from here. */
export type { StyleProfile } from './choralStyleProfile';

/** Configuration for the realization engine. */
export type ChoralConfig = {
  tonic: string;          // e.g. 'C', 'Bb', 'F#'
  isMinor: boolean;
  timeSignature: TimeSignature;
  rules?: ChoralRules;
  /**
   * Optional soprano melody constraint.
   * When provided, the soprano voice is fixed to these MIDI values
   * and only A/T/B are generated by the engine.
   * Each entry maps to a chord in the progression by (measure, beat).
   */
  sopranoMelody?: SopranoConstraint[];
  /**
   * Optional bass melody constraint ("basso dato").
   * When provided, the bass voice is fixed to these MIDI values
   * and only S/A/T are generated by the engine.
   */
  bassMelody?: SopranoConstraint[];
  /**
   * Optional locked voices constraint.
   * Keys are voice numbers (1=S, 2=A, 3=T, 4=B).
   * Values are arrays of { midi, measure, beat } similar to SopranoConstraint.
   * When provided, the engine fixes those voices and only generates the unlocked ones.
   * Note: if sopranoMelody is also provided, voice 1 is already handled by that.
   */
  lockedVoices?: Record<number, SopranoConstraint[]>;
  /** When false, the engine will never add automatic sevenths (only explicit V7/viio7 etc.).
   *  Defaults to true. */
  autoSevenths?: boolean;
  /** Optional learned style profile for adaptive scoring. */
  styleProfile?: StyleProfile | null;
  /** IL VETO DELLE REGOLE: prima di fissare un accordo, il generatore lo sottopone al
   *  checker VERO dell'applicazione (`applyHarmonyRules`) e rifiuta quelli che infrangono
   *  una regola MECCANICA — parallele, intervalli proibiti, incroci. Vedi `vetoRegole.ts`
   *  per il perché il checker si interroghi solo su una parte delle sue regole.
   *  Attivo di default; `false` riporta al comportamento precedente. */
  vetoRegole?: boolean;
  /** L'ACCORDO CHE PRECEDE, quando si riparte da metà brano.
   *
   *  Rigenerando «dalla misura 5 in poi», il generatore partiva dal SILENZIO: sceglieva il
   *  registro come se cominciasse un brano da zero, e la giuntura non la controllava
   *  nessuno. Sul «Delachi n 12» ripartito dalla misura 3 usciva un moto parallelo di tutte
   *  e quattro le voci (`R-13`) con un salto di tredicesima al basso.
   *
   *  Qui si passano le QUATTRO NOTE dell'ultimo accordo tenuto, così com'erano scritte:
   *  servono sia alla condotta (il primo accordo nuovo si lega a quello vecchio) sia al
   *  veto, che le rimette in finestra e giudica il passaggio come un passaggio qualsiasi.
   *  Si passano le note vere, non un voicing, perché la GRAFIA cambia la risposta di
   *  `R-06` (quarta eccedente) e `R-18` (scontro cromatico). */
  notePrecedenti?: StaffNote[];
  /** IL RIPASSO: finito di scrivere, il generatore ripercorre la progressione e riprova le
   *  disposizioni di ogni accordo — questa volta conoscendo anche l'accordo DOPO, che
   *  scrivendo da sinistra a destra non poteva conoscere. Attivo di default; `false` serve
   *  al confronto. */
  ripasso?: boolean;
  /** Il PASSO INDIETRO del veto: quando nessun candidato per l'accordo in esame passa, si
   *  rimette in gioco quello prima. Attivo di default; `false` serve al confronto. */
  passoIndietro?: boolean;
  /** Initial chord voicing disposition (bottom to top: Bass=Root, then Tenor, Alto, Soprano).
   * Digits: 8=Root(octave), 3=3rd, 5=5th. e.g. 'R358' = B=Root, T=3rd, A=5th, S=8va.
   * 'auto' (default) = engine picks best voicing. Only effective for first chord in root position. */
  initialDisposition?: 'auto' | 'R358' | 'R538' | 'R835' | 'R385' | 'R583' | 'R853';
};

/** A single soprano constraint point (one note of the given melody). */
export type SopranoConstraint = {
  midi: number;
  measure: number;
  beat: number;
};

/** A single SATB voicing (MIDI values). */
export type SATBVoicing = {
  soprano: number;  // MIDI
  alto: number;
  tenor: number;
  bass: number;
};

/** Violation found during realization. */
export type ChoralViolation = {
  type: 'parallel-5th' | 'parallel-8ve' | 'voice-crossing' | 'voice-overlap'
      | 'spacing' | 'range' | 'doubling' | 'resolution';
  description: string;
  measure: number;
  beat: number;
  voices?: string[];
};

/** Engine output. */
/** Context marker emitted when the composer modulates to a new key. */
export type ModulationContext = {
  /** Absolute beat position (quarter-note beats from start). */
  absBeat: number;
  measureIndex: number;
  beat: number;
  newTonic: string;
  newIsMinor: boolean;
  label?: string;
  source: 'composer';
};

export type ChoralRealizationResult = {
  notes: StaffNote[];
  violations: ChoralViolation[];
  /** Modulation contexts for the analysis engine. */
  modulationContexts: ModulationContext[];
};

// ─── Constants ─────────────────────────────────────────────────────────────

/** SATB voice ranges (MIDI), generous but standard for chorale writing. */
const VOICE_RANGES: Record<string, { min: number; max: number }> = {
  soprano: { min: 60, max: 79 },  // C4 – G5
  alto:    { min: 55, max: 74 },  // G3 – D5
  tenor:   { min: 48, max: 67 },  // C3 – G4
  bass:    { min: 40, max: 60 },  // E2 – C4
};

/** Diatonic pitch classes (letter only) */
const DIATONIC = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** Semitone offsets for each diatonic letter from C. */
const LETTER_TO_SEMI: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * Major scale intervals in semitones from root.
 * Index = scale degree (0-based: 0=tonic, 1=supertonic, …, 6=leading tone).
 */
const MAJOR_SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/**
 * Natural minor scale intervals in semitones from root.
 */
const NATURAL_MINOR_SCALE_SEMITONES = [0, 2, 3, 5, 7, 8, 10];

/**
 * Harmonic minor scale intervals — raised 7th.
 */
const HARMONIC_MINOR_SCALE_SEMITONES = [0, 2, 3, 5, 7, 8, 11];

// ─── Pitch Utilities ───────────────────────────────────────────────────────

/** Pitch-class (0-11) from a note name string (e.g. 'Bb' → 10, 'F#' → 6). */
export function noteNameToPc(name: string): number {
  const letter = name.charAt(0).toUpperCase();
  let pc = LETTER_TO_SEMI[letter] ?? 0;
  for (let i = 1; i < name.length; i++) {
    if (name[i] === '#') pc++;
    else if (name[i] === 'b') pc--;
  }
  return ((pc % 12) + 12) % 12;
}

/** Letter index (0=C … 6=B) for a given letter. */
function letterIndex(letter: string): number {
  return DIATONIC.indexOf(letter.charAt(0).toUpperCase() as typeof DIATONIC[number]);
}

/** Diatonic position (0=C4, 1=D4, etc.) for a pitch letter + octave. */
function notePosition(pitch: string, octave: number): number {
  const li = letterIndex(pitch);
  return li + (octave - 4) * 7;
}

/** MIDI value for a given pitch letter, accidental string, and octave. */
function pitchToMidi(letter: string, accidentalStr: string, octave: number): number {
  let semi = LETTER_TO_SEMI[letter.toUpperCase()] ?? 0;
  for (const ch of accidentalStr) {
    if (ch === '#') semi++;
    else if (ch === 'b') semi--;
  }
  return (octave + 1) * 12 + ((semi % 12) + 12) % 12;
}

/** Chromatic pitch class (noteIndex) from MIDI. */
function midiToNoteIndex(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// ─── Scale & Key Helpers ───────────────────────────────────────────────────

export type ScaleDegreeNote = {
  letter: string;       // e.g. 'B', 'E'
  accidental: string;   // e.g. '', '#', 'b', 'bb'
  semiFromRoot: number; // semitones above tonic
  degree: number;       // 0-based scale degree
};

/**
 * Build the 7 diatonic scale notes for a given tonic + mode.
 * Returns letter + accidental + semitone offset for each degree.
 *
 * Uses harmonic minor for minor keys (raised 7th on degree 6).
 */
export function buildScale(tonic: string, isMinor: boolean): ScaleDegreeNote[] {
  const tonicLetter = tonic.charAt(0).toUpperCase();
  const tonicAcc = tonic.slice(1); // '', '#', 'b'
  const tonicPc = noteNameToPc(tonic);
  const tonicLetterIndex = letterIndex(tonicLetter);

  // Choose interval template
  const template = isMinor ? HARMONIC_MINOR_SCALE_SEMITONES : MAJOR_SCALE_SEMITONES;

  const result: ScaleDegreeNote[] = [];
  for (let deg = 0; deg < 7; deg++) {
    // Diatonic letter = tonic letter + deg steps up the alphabet
    const li = (tonicLetterIndex + deg) % 7;
    const letter = DIATONIC[li];
    // Natural (un-accidentaled) semitone for this letter
    const naturalSemi = LETTER_TO_SEMI[letter];
    // Target semitone (relative to C) for this scale degree
    const targetSemi = (tonicPc + template[deg]) % 12;
    // Accidental = difference between target and natural
    let diff = targetSemi - naturalSemi;
    // Normalize to -2..+2 range
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    let accidental = '';
    if (diff > 0) accidental = '#'.repeat(diff);
    else if (diff < 0) accidental = 'b'.repeat(-diff);

    result.push({
      letter,
      accidental,
      semiFromRoot: template[deg],
      degree: deg,
    });
  }
  return result;
}

/**
 * Build the natural minor scale (without raised 7th).
 * Used for diatonic chords that don't include the leading tone.
 */
export function buildNaturalMinorScale(tonic: string): ScaleDegreeNote[] {
  const tonicLetter = tonic.charAt(0).toUpperCase();
  const tonicPc = noteNameToPc(tonic);
  const tonicLetterIndex = letterIndex(tonicLetter);
  const template = NATURAL_MINOR_SCALE_SEMITONES;
  const result: ScaleDegreeNote[] = [];
  for (let deg = 0; deg < 7; deg++) {
    const li = (tonicLetterIndex + deg) % 7;
    const letter = DIATONIC[li];
    const naturalSemi = LETTER_TO_SEMI[letter];
    const targetSemi = (tonicPc + template[deg]) % 12;
    let diff = targetSemi - naturalSemi;
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    let accidental = '';
    if (diff > 0) accidental = '#'.repeat(diff);
    else if (diff < 0) accidental = 'b'.repeat(-diff);
    result.push({ letter, accidental, semiFromRoot: template[deg], degree: deg });
  }
  return result;
}

// ─── Roman Numeral Parsing ─────────────────────────────────────────────────

/** Quality derived from roman numeral case + suffix. */
export type ChordQuality = 'major' | 'minor' | 'diminished' | 'augmented'
                         | 'dominant7' | 'major7' | 'minor7' | 'halfDim7' | 'dim7'
                         | 'aug6It' | 'aug6Fr' | 'aug6Ger';

export type ParsedRoman = {
  degree: number;         // 0-based scale degree
  quality: ChordQuality;
  inversion: number;      // 0 = root, 1 = 1st, 2 = 2nd, 3 = 3rd (7ths only)
  hasSeventh: boolean;
  /** Original text for display. */
  raw: string;
  /** Secondary target degree (0-based) for applied chords like V/V, viio/ii */
  secondaryTarget?: number;
  /** Chromatic alteration of the root: -1 = flat (bII), +1 = sharp (#IV) */
  chromaticShift?: number;
  /** Augmented sixth chord type */
  aug6Type?: 'it' | 'fr' | 'ger';
};

/**
 * Parse a roman numeral string into structured data.
 *
 * Supports: I ii III iv V vi VII (case → major/minor),
 *   '+' (augmented), 'o'/'°'/'dim' (diminished),
 *   '7' (seventh), 'ø7'/'ø' (half-diminished),
 *   figured bass inversions: 6, 64, 7, 65, 43, 42, 2,
 *   slash notation: 6/4, 6/5, 4/3, 4/2, 5/3.
 */
export function parseRoman(input: string): ParsedRoman {
  let s = input.trim();
  const raw = s;

  // ── Secondary dominant detection: V/V, viio/ii, V7/IV etc. ──
  // Must detect BEFORE figured-bass normalization, but only for roman-numeral targets
  let secondaryTarget: number | undefined;
  const secondaryMatch = s.match(/\/([IViv]+)$/);
  if (secondaryMatch) {
    const targetRoman = secondaryMatch[1];
    const romanMap2: Record<string, number> = {
      I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6,
      i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6,
    };
    // Try longest match
    const candidates2 = ['VII', 'III', 'vii', 'iii', 'IV', 'VI', 'II', 'iv', 'vi', 'ii', 'V', 'I', 'v', 'i'];
    for (const c of candidates2) {
      if (targetRoman === c) {
        secondaryTarget = romanMap2[c];
        s = s.slice(0, -(targetRoman.length + 1)); // remove /target
        break;
      }
    }
  }

  // Augmented sixth chords: It6, Fr6, Ger6 — must be detected BEFORE figured
  // bass extraction because FB regex would consume the trailing '6'.
  const aug6Match = s.match(/^(It|Fr|Ger)\+?6/i);
  if (aug6Match) {
    const t = aug6Match[1].charAt(0).toUpperCase() + aug6Match[1].slice(1).toLowerCase();
    return {
      degree: 5,
      quality: ('aug6' + t) as ChordQuality,
      inversion: 0,
      hasSeventh: false,
      raw,
      chromaticShift: -1,
      aug6Type: t.toLowerCase() as 'it' | 'fr' | 'ger',
      secondaryTarget,
    };
  }

  // Detect figured bass inversion suffix (must be parsed before removing digits)
  let figuredBass = '';

  // Normalize slash notation: 6/4→64, 6/5→65, 4/3→43, 4/2→42, 5/3→53
  s = s.replace(/6\/4/g, '64')
       .replace(/6\/5/g, '65')
       .replace(/4\/3/g, '43')
       .replace(/4\/2/g, '42')
       .replace(/5\/3/g, '53');

  // Check for figured bass patterns: 65, 64, 53, 43, 42, then single digits 6, 7, 2
  const fbMatch = s.match(/(65|64|53|43|42|6|7|2)$/);
  if (fbMatch) {
    figuredBass = fbMatch[1];
    s = s.slice(0, -figuredBass.length);
  }

  // Detect quality modifiers
  let qualMod: 'aug' | 'dim' | 'halfDim' | null = null;
  if (s.endsWith('+')) { qualMod = 'aug'; s = s.slice(0, -1); }
  else if (s.endsWith('°') || s.endsWith('o') || s.endsWith('dim')) {
    qualMod = 'dim';
    if (s.endsWith('dim')) s = s.slice(0, -3);
    else s = s.slice(0, -1);
  }
  else if (s.includes('ø') || s.includes('Ø')) {
    qualMod = 'halfDim';
    s = s.replace(/[øØ]/g, '');
  }

  // Chromatic prefix: b/♭ or #/♯ shifts the root (bII, bVII, #IV, etc.)
  let chromaticShift = 0;
  if (/^[b♭](?=[IViv])/.test(s)) { chromaticShift = -1; s = s.slice(1); }
  else if (/^[#♯](?=[IViv])/.test(s)) { chromaticShift = +1; s = s.slice(1); }

  // Map roman text → degree (0-based)
  const romanMap: Record<string, number> = {
    I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6,
    i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6,
  };

  // Try longest match first
  let degree = -1;
  let isLowerCase = false;
  const candidates = ['VII', 'III', 'vii', 'iii', 'IV', 'VI', 'II', 'iv', 'vi', 'ii', 'V', 'I', 'v', 'i'];
  for (const c of candidates) {
    if (s.startsWith(c)) {
      degree = romanMap[c];
      isLowerCase = c === c.toLowerCase();
      s = s.slice(c.length);
      break;
    }
  }
  if (degree < 0) {
    // Fallback: treat as I
    degree = 0;
    isLowerCase = false;
  }

  // Check for remaining '7' (or dom7/maj7/M7/Δ7) that wasn't part of figured bass
  let hasSeventh = false;
  let forceMaj7 = false;
  let forceDom7 = false;
  // Explicit dom7 suffix → always dominant seventh (check before maj7 and plain '7')
  if (/dom7/i.test(s)) {
    hasSeventh = true;
    forceDom7 = true;
    s = s.replace(/dom7/i, '');
  }
  // Handle case where figured bass already captured the '7' (e.g. IVdom7 → fb='7', s='dom')
  else if (/^dom$/i.test(s)) {
    forceDom7 = true;
    s = '';
  }
  // Explicit maj7/M7/Δ7 suffix → always major seventh (check before plain '7')
  else if (/maj7|M7|Δ7/.test(s)) {
    hasSeventh = true;
    forceMaj7 = true;
    s = s.replace(/maj7|M7|Δ7/, '');
  }
  // Handle case where figured bass already captured the '7' (e.g. IVmaj7 → fb='7', s='maj')
  else if (/^(maj|M|Δ)$/i.test(s)) {
    forceMaj7 = true;
    s = '';
  }
  else if (s.includes('7')) {
    hasSeventh = true;
    s = s.replace('7', '');
  }
  // Figured bass implies seventh for 7, 65, 43, 42, 2
  if (['7', '65', '43', '42', '2'].includes(figuredBass)) {
    hasSeventh = true;
  }

  // Determine quality
  let quality: ChordQuality;
  if (hasSeventh) {
    if (qualMod === 'dim') quality = 'dim7';
    else if (qualMod === 'halfDim') quality = 'halfDim7';
    else if (forceDom7) quality = 'dominant7';
    else if (forceMaj7) quality = 'major7';
    else if (isLowerCase) quality = 'minor7';
    else if (degree === 4) quality = 'dominant7';
    else quality = 'major7';
  } else {
    if (qualMod === 'aug') quality = 'augmented';
    else if (qualMod === 'dim') quality = 'diminished';
    else if (isLowerCase) quality = 'minor';
    else quality = 'major';
  }

  // Determine inversion from figured bass
  let inversion = 0;
  if (figuredBass === '6') inversion = 1;
  else if (figuredBass === '64') inversion = 2;
  else if (figuredBass === '65') inversion = 1;
  else if (figuredBass === '43') inversion = 2;
  else if (figuredBass === '42' || figuredBass === '2') inversion = 3;
  // '53' = explicit root position (no change)
  else if (figuredBass === '53') inversion = 0;
  // '7' alone = root position seventh chord
  else if (figuredBass === '7') inversion = 0;

  return { degree, quality, inversion, hasSeventh, raw, secondaryTarget, chromaticShift: chromaticShift || undefined };
}

// ─── Chord Tones from Parsed Roman ─────────────────────────────────────────

/**
 * Given a parsed roman numeral and a scale, return the chord tones
 * as pitch classes (semitones from C) + scale note info.
 *
 * Returns 3 notes (triad) or 4 notes (seventh chord), root-ordered.
 */
export function getChordTones(
  parsed: ParsedRoman,
  scale: ScaleDegreeNote[],
  tonic: string,
  isMinor: boolean
): ScaleDegreeNote[] {
  const tonicPc = noteNameToPc(tonic);
  const deg = parsed.degree;

  // ── Secondary dominant: build temporary scale from target degree ──
  if (parsed.secondaryTarget != null) {
    // Find the target note in the main scale
    const mainScale = isMinor ? buildNaturalMinorScale(tonic) : scale;
    const targetNote = mainScale[parsed.secondaryTarget];
    const targetNoteName = targetNote.letter + targetNote.accidental;
    // Build a major scale from the target note (secondary dominants are always
    // analyzed relative to a major-mode target, even in minor keys)
    const targetScale = buildScale(targetNoteName, false);
    const targetPc = noteNameToPc(targetNoteName);
    // Use getChordTones recursively without secondaryTarget
    const innerParsed: ParsedRoman = {
      ...parsed,
      secondaryTarget: undefined,
    };
    const rawTones = getChordTones(innerParsed, targetScale, targetNoteName, false);
    // Remap semiFromRoot: convert from target-relative to original-tonic-relative
    const targetOffset = ((targetPc - tonicPc) + 12) % 12;
    return rawTones.map(t => ({
      ...t,
      semiFromRoot: (t.semiFromRoot + targetOffset) % 12,
    }));
  }

  // For minor keys, use natural minor for most degrees, harmonic for V and viio
  let effectiveScale = scale;
  if (isMinor) {
    const needsHarmonic = (parsed.degree === 4 && !parsed.quality.startsWith('minor'))
                       || (parsed.degree === 6 && (parsed.quality === 'diminished' || parsed.quality === 'dim7' || parsed.quality === 'halfDim7'));
    if (!needsHarmonic) {
      // Use natural minor scale for non-dominant/non-leading-tone chords
      effectiveScale = buildNaturalMinorScale(tonic);
    }
  }

  // ── Helper: build a properly-spelled ScaleDegreeNote from absolute semitones ──
  const tonicPcLocal = noteNameToPc(tonic);
  const tonicLiLocal = letterIndex(tonic);
  /** Build a ScaleDegreeNote with correct letter/accidental spelling.
   *  @param degreeOffset  diatonic letter steps above tonic (0-6)
   *  @param semiFromRoot  semitones above tonic (0-11)
   */
  const spellNote = (degreeOffset: number, semiFromRoot: number): ScaleDegreeNote => {
    const li = (tonicLiLocal + degreeOffset) % 7;
    const letter = DIATONIC[li];
    const naturalSemi = LETTER_TO_SEMI[letter];
    const targetSemi = (tonicPcLocal + semiFromRoot) % 12;
    let diff = targetSemi - naturalSemi;
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    let accidental = '';
    if (diff > 0) accidental = '#'.repeat(diff);
    else if (diff < 0) accidental = 'b'.repeat(-diff);
    return { letter, accidental, semiFromRoot, degree: degreeOffset };
  };

  // ── Augmented sixth chords: special interval structures ──
  if (parsed.aug6Type) {
    const rootSemi = (effectiveScale[deg].semiFromRoot + (parsed.chromaticShift || 0) + 12) % 12;
    // Root on ♭6, M3 = letter+2 steps, P5/A4 = letter+4 steps, A6 = letter+5 steps (= #4)
    const tones: ScaleDegreeNote[] = [spellNote(deg, rootSemi)];
    tones.push(spellNote((deg + 2) % 7, (rootSemi + 4) % 12));   // M3
    if (parsed.aug6Type === 'fr') {
      tones.push(spellNote((deg + 3) % 7, (rootSemi + 6) % 12)); // A4 (= #2 in context)
    }
    if (parsed.aug6Type === 'ger') {
      tones.push(spellNote((deg + 4) % 7, (rootSemi + 7) % 12)); // P5
    }
    tones.push(spellNote((deg + 5) % 7, (rootSemi + 10) % 12));  // A6 (= #4 in context)
    return tones;
  }

  // ── Chromatically altered degrees (bII, bVII, #IV etc.):
  //    quality-based interval stacking with correct enharmonic spelling ──
  if (parsed.chromaticShift) {
    const rootSemi = (effectiveScale[deg].semiFromRoot + parsed.chromaticShift + 12) % 12;
    const q = parsed.quality;
    const m3 = (q === 'minor' || q === 'diminished' || q === 'minor7' || q === 'halfDim7' || q === 'dim7') ? 3 : 4;
    const p5 = (q === 'diminished' || q === 'dim7' || q === 'halfDim7') ? 6 : (q === 'augmented' ? 8 : 7);
    const chTones: ScaleDegreeNote[] = [
      spellNote(deg, rootSemi),
      spellNote((deg + 2) % 7, (rootSemi + m3) % 12),
      spellNote((deg + 4) % 7, (rootSemi + p5) % 12),
    ];
    if (parsed.hasSeventh) {
      const s7 = (q === 'dominant7' || q === 'minor7' || q === 'halfDim7') ? 10 : (q === 'dim7' ? 9 : 11);
      chTones.push(spellNote((deg + 6) % 7, (rootSemi + s7) % 12));
    }
    return chTones;
  }

  // Root, 3rd, 5th (diatonic stacking)
  const root = effectiveScale[deg];
  const third = effectiveScale[(deg + 2) % 7];
  const fifth = effectiveScale[(deg + 4) % 7];

  const tones: ScaleDegreeNote[] = [
    { ...root },
    { ...third },
    { ...fifth },
  ];

  // Adjust quality if needed (augmented 5th, diminished 5th, etc.)
  const rootPc = (tonicPc + root.semiFromRoot) % 12;
  const thirdPc = (tonicPc + third.semiFromRoot) % 12;
  const fifthPc = (tonicPc + fifth.semiFromRoot) % 12;

  const thirdInterval = ((thirdPc - rootPc) + 12) % 12;
  const fifthInterval = ((fifthPc - rootPc) + 12) % 12;

  // For augmented chords: raise the 5th by a semitone
  if (parsed.quality === 'augmented' && fifthInterval !== 8) {
    const raised = { ...tones[2] };
    raised.semiFromRoot = (raised.semiFromRoot + 1) % 12;
    // Adjust accidental
    if (raised.accidental === 'b') raised.accidental = '';
    else if (raised.accidental === '') raised.accidental = '#';
    else raised.accidental = raised.accidental + '#';
    tones[2] = raised;
  }

  // For diminished chords: the natural stacking should already produce dim 5th
  // (e.g. viio in major → B-D-F → m3 + m3 = dim5). No manual adjustment needed
  // unless the scale gives a perfect 5th unexpectedly.
  if ((parsed.quality === 'diminished' || parsed.quality === 'dim7' || parsed.quality === 'halfDim7') && fifthInterval === 7) {
    const lowered = { ...tones[2] };
    lowered.semiFromRoot = (lowered.semiFromRoot - 1 + 12) % 12;
    if (lowered.accidental === '#') lowered.accidental = '';
    else if (lowered.accidental === '') lowered.accidental = 'b';
    else lowered.accidental = lowered.accidental + 'b';
    tones[2] = lowered;
  }

  // Add seventh if needed
  if (parsed.hasSeventh) {
    const seventh = effectiveScale[(deg + 6) % 7];
    const seventhPc = (tonicPc + seventh.semiFromRoot) % 12;
    const seventhInterval = ((seventhPc - rootPc) + 12) % 12;

    const adjustedSeventh = { ...seventh };

    // dominant7 → minor 7th (10 semitones)
    if (parsed.quality === 'dominant7' && seventhInterval !== 10) {
      adjustedSeventh.semiFromRoot = (root.semiFromRoot + 10) % 12;
      // Recalculate accidental
      const targetSemi = (tonicPc + adjustedSeventh.semiFromRoot) % 12;
      const naturalSemi = LETTER_TO_SEMI[adjustedSeventh.letter];
      let diff = targetSemi - naturalSemi;
      if (diff > 6) diff -= 12;
      if (diff < -6) diff += 12;
      adjustedSeventh.accidental = diff > 0 ? '#'.repeat(diff) : diff < 0 ? 'b'.repeat(-diff) : '';
    }
    // major7 → major 7th (11 semitones)
    else if (parsed.quality === 'major7' && seventhInterval !== 11) {
      adjustedSeventh.semiFromRoot = (root.semiFromRoot + 11) % 12;
      const targetSemi = (tonicPc + adjustedSeventh.semiFromRoot) % 12;
      const naturalSemi = LETTER_TO_SEMI[adjustedSeventh.letter];
      let diff = targetSemi - naturalSemi;
      if (diff > 6) diff -= 12;
      if (diff < -6) diff += 12;
      adjustedSeventh.accidental = diff > 0 ? '#'.repeat(diff) : diff < 0 ? 'b'.repeat(-diff) : '';
    }
    // halfDim7 → minor 7th (10 semitones)
    else if (parsed.quality === 'halfDim7' && seventhInterval !== 10) {
      adjustedSeventh.semiFromRoot = (root.semiFromRoot + 10) % 12;
      const targetSemi = (tonicPc + adjustedSeventh.semiFromRoot) % 12;
      const naturalSemi = LETTER_TO_SEMI[adjustedSeventh.letter];
      let diff = targetSemi - naturalSemi;
      if (diff > 6) diff -= 12;
      if (diff < -6) diff += 12;
      adjustedSeventh.accidental = diff > 0 ? '#'.repeat(diff) : diff < 0 ? 'b'.repeat(-diff) : '';
    }
    // dim7 → diminished 7th (9 semitones)
    else if (parsed.quality === 'dim7' && seventhInterval !== 9) {
      adjustedSeventh.semiFromRoot = (root.semiFromRoot + 9) % 12;
      const targetSemi = (tonicPc + adjustedSeventh.semiFromRoot) % 12;
      const naturalSemi = LETTER_TO_SEMI[adjustedSeventh.letter];
      let diff = targetSemi - naturalSemi;
      if (diff > 6) diff -= 12;
      if (diff < -6) diff += 12;
      adjustedSeventh.accidental = diff > 0 ? '#'.repeat(diff) : diff < 0 ? 'b'.repeat(-diff) : '';
    }

    tones.push(adjustedSeventh);
  }

  return tones;
}

// ─── Voicing Realization ───────────────────────────────────────────────────

/** Pitch class (0-11) of a ScaleDegreeNote. */
function toneToMidiPc(tone: ScaleDegreeNote): number {
  return ((LETTER_TO_SEMI[tone.letter] ?? 0) +
    (tone.accidental === '#' ? 1 : tone.accidental === 'b' ? -1 :
     tone.accidental === '##' ? 2 : tone.accidental === 'bb' ? -2 : 0) + 12) % 12;
}

/** All MIDI pitches for a given chord tone within a voice range. */
function pitchesInRange(tone: ScaleDegreeNote, range: { min: number; max: number }): number[] {
  const pc = ((LETTER_TO_SEMI[tone.letter] ?? 0) + (tone.accidental === '#' ? 1 : tone.accidental === 'b' ? -1 :
    tone.accidental === '##' ? 2 : tone.accidental === 'bb' ? -2 : 0) + 12) % 12;
  const results: number[] = [];
  // Scan octaves 1-7
  for (let oct = 1; oct <= 7; oct++) {
    const midi = (oct + 1) * 12 + pc;
    if (midi >= range.min && midi <= range.max) {
      results.push(midi);
    }
  }
  return results;
}

/** Absolute distance in semitones between two MIDI notes. */
function midiDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

/** Style context passed through helper functions to scoreVoicing. */
interface StyleContext {
  styleProfile?: StyleProfile | null;
  currentDegree?: string;
  currentInversion?: number;
}

const DEGREE_NAMES_MAJ = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii\u00b0'];
const DEGREE_NAMES_MIN = ['i', 'ii\u00b0', 'III', 'iv', 'v', 'VI', 'VII'];
function degreeToRoman(degree: number, isMinor: boolean): string {
  return (isMinor ? DEGREE_NAMES_MIN : DEGREE_NAMES_MAJ)[degree % 7] || `${degree}`;
}

/**
 * ─── Unified Scoring Function ────────────────────────────────────────────────
 * Single source of truth for ALL voice-leading rules.
 * Every code path (first chord, fixed-soprano, non-fixed, beam search, retry)
 * MUST use this function to evaluate voicings.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface ScoreVoicingOpts {
  curr: SATBVoicing;
  prev?: SATBVoicing | null;
  prevPrev?: SATBVoicing | null;     // two chords ago (for 3-note melodic rules)
  rules: ChoralRules;
  tonicPc?: number | null;
  tones?: ScaleDegreeNote[];         // chord tones (for LT resolution, etc.)
  prevSeventhPc?: number | null;     // previous 7th pitch class
  /** Adaptive style profile (from user chorales). */
  styleProfile?: StyleProfile | null;
  /** Current chord's roman degree name (e.g. 'V', 'ii', 'I') for inversion bonus lookup. */
  currentDegree?: string;
  /** Current chord inversion (0-3) for inversion bonus. */
  currentInversion?: number;
}

/**
 * Compute a non-negative cost for placing `curr` after `prev`.
 * Lower = better voicing. Contributions:
 *
 * ■ VERTICAL (curr only — always checked):
 *   - Voice crossing:  +1000  (bass>tenor, tenor>alto, alto>soprano)
 *   - Spacing S-A/A-T > 8va:  +300
 *   - Unison between voices:  +40 each
 *   - Soprano doubles bass PC:  +25
 *   - Leading tone doubled:  +300
 *
 * ■ HORIZONTAL (prev→curr — only when prev is available):
 *   - Motion distance: common tone -15, step -5/-3, skip +9..12, leap +15..30+
 *   - Forbidden melodic intervals: tritone +120, 7th +150, 9th+ +200, A2 +100
 *   - Voice overlap:  +300 each
 *   - Contrary motion S+B:  -15 / parallel +5
 *   - Parallel 5ths/8ves:  +200 each
 *   - Hidden/direct 5ths/8ves (Dubois):  0..150 depending on voices & context
 *   - LT resolution:  +200 if LT doesn't resolve up to tonic
 */
function scoreVoicing(opts: ScoreVoicingOpts): number {
  const { curr, prev, prevPrev, rules, tonicPc, tones, prevSeventhPc } = opts;
  const { bass, tenor, alto, soprano } = curr;
  let cost = 0;

  // ── VERTICAL RULES (always apply) ──

  // Voice crossing
  if (!rules.allowCrossing) {
    if (bass > tenor || tenor > alto || alto > soprano) cost += 1000;
  }

  // Spacing: S-A ≤ octave, A-T ≤ octave
  if (soprano - alto > 12) cost += 300;
  if (alto - tenor > 12) cost += 300;

  // ── QUALE NOTA SI RADDOPPIA ──
  // Domanda del realizzatore, non della scelta dell'armonia: si pone quando le quattro note
  // esistono. I raddoppi sbagliati erano il primo addebito rimasto al generatore, e il
  // corpus la risposta ce l'ha — stato fondamentale: fondamentale 86%; primo rivolto: molto
  // più libero; quarta e sesta: la quinta, cioè il basso, 86%.
  if (tones && tones.length >= 3) {
    const radicePc = toneToMidiPc(tones[0]);
    const membroDi = (m: number) => ((m - radicePc) % 12 + 12) % 12;
    const rivolto = (() => {
      const b = membroDi(bass);
      return (b === 3 || b === 4) ? 1 : (b === 6 || b === 7 || b === 8) ? 2 : (b === 10 || b === 11) ? 3 : 0;
    })();
    const conto = new Map<number, number>();
    for (const m of [bass, tenor, alto, soprano]) conto.set(membroDi(m), (conto.get(membroDi(m)) ?? 0) + 1);
    for (const [membro, quante] of conto) {
      if (quante < 2) continue;
      // Che GRADO DELLA TONALITÀ è la nota raddoppiata: è quello a decidere, non il suo
      // ruolo nell'accordo. La terza di un ii si raddoppia perché è il quarto grado.
      const pcDoppia = (radicePc + membro) % 12;
      cost += costoDelRaddoppio(rivolto, membro, pcDoppia - (tonicPc ?? 0));
    }
  }

  // Unison — strongly penalized in chorale style (voices should be independent)
  const allM = [bass, tenor, alto, soprano];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (allM[i] === allM[j]) cost += 500;
    }
  }

  // Soprano doubling bass PC — penalize only for subsequent chords (not the first)
  // For the first chord (prev=null), soprano on root octave is standard.
  if (prev && ((soprano % 12) + 12) % 12 === ((bass % 12) + 12) % 12) cost += 25;

  // Leading tone doubled
  if (tonicPc != null) {
    const ltPc = (tonicPc + 11) % 12;
    const pcs = allM.map(m => ((m % 12) + 12) % 12);
    if (pcs.filter(pc => pc === ltPc).length > 1) cost += 300;
  }

  // Diminished 5th doubled — dissonant interval, should not be doubled
  if (tones && tones.length >= 3) {
    const rootMidiPc = ((tones[0]?.midi ?? 0) % 12 + 12) % 12;
    const fifthMidiPc = ((tones[2]?.midi ?? 0) % 12 + 12) % 12;
    const fifthInterval = (fifthMidiPc - rootMidiPc + 12) % 12;
    if (fifthInterval === 6) { // diminished 5th = 6 semitones
      const pcs = allM.map(m => ((m % 12) + 12) % 12);
      if (pcs.filter(pc => pc === fifthMidiPc).length > 1) cost += 250;
    }
  }

  // Incomplete voicing penalty: prefer complete chords (all chord tones present)
  // A triad with only 2 distinct PCs means the 5th is missing — significant penalty.
  // With only 2 PCs the analysis engine may misidentify the chord (e.g. F-A = ii6 vs IV).
  {
    const distinctPcs = new Set(allM.map(m => ((m % 12) + 12) % 12));
    if (distinctPcs.size <= 2) cost += 80; // incomplete: missing 5th — discourage but allow if necessary
  }

  // Doubling preference: mildly penalize doubled 5th (prefer root or 3rd doubling)
  // Exceptions: 6/4 chords SHOULD double the 5th (= bass), no penalty there.
  // Also: if the 5th is a tonal note (I, IV, V of the key), doubling is fine.
  if (tones && tones.length >= 3) {
    const fifthPc = toneToMidiPc(tones[2]);
    const pcs = allM.map(m => ((m % 12) + 12) % 12);
    const fifthCount = pcs.filter(pc => pc === fifthPc).length;
    const bassToneIdx = (opts as any).currentInversion ?? 0;
    const is64 = bassToneIdx === 2;
    const isTonalFifth = tonicPc != null && [tonicPc, (tonicPc + 5) % 12, (tonicPc + 7) % 12].includes(fifthPc);
    if (fifthCount >= 2 && !is64 && !isTonalFifth) cost += 45;
  }

  // ── HORIZONTAL RULES (only with prev) ──
  if (!prev) return cost;

  const prevArr = [prev.bass, prev.tenor, prev.alto, prev.soprano];
  const currArr = allM;

  // ── CI SONO SALTI CHE NON SI FANNO, QUALUNQUE COSA COSTINO GLI ALTRI ──
  //
  // Il costo dei movimenti qui sotto e' calcolato per GRANDEZZA: piu' e' largo il salto,
  // piu' costa. E' ragionevole per la comodita' di canto, ma non e' quello che dicono le
  // regole. Il tritono e' largo sei semitoni — quanto una quinta, che non costa niente —
  // eppure e' proibito come intervallo melodico; la settima costa 120, cioe' e' cara ma
  // resta comprabile se il resto e' peggio. Cosi' il generatore le comprava: misurate sul
  // Dubois, sei violazioni di intervallo melodico proibito, tutte nel basso.
  //
  // La proibizione e' di natura diversa dal costo, e va espressa come tale: non «largo»,
  // ma «non si fa». Con le sole altezze MIDI si riconoscono con certezza il tritono, le
  // settime e tutto cio' che supera l'ottava; la seconda eccedente non si distingue dalla
  // terza minore senza sapere come sono SCRITTE le note, e resta fuori.
  {
    const proibito = (semitoni: number): number => {
      const d = Math.abs(semitoni);
      if (d === 6) return 200;              // tritono: vietato, ma esiste il caso risolto
      if (d === 10 || d === 11) return 400; // settime
      if (d > 12) return 400;               // oltre l'ottava
      return 0;
    };
    for (let vi = 0; vi < 4; vi++) cost += proibito(currArr[vi] - prevArr[vi]);
  }

  // Bass motion cost — bass is freer than upper voices but large leaps are penalized
  {
    const bassDist = midiDistance(currArr[0], prevArr[0]);
    if (bassDist === 0) {
      // IL BASSO FERMO NON È UN PREGIO. Qui c'era `-10`, «nota comune tenuta: bene» — che è
      // la regola delle voci SUPERIORI, dove tenere la nota comune è davvero un merito. Per
      // il basso vuol dire nessuna linea, e siccome era anche l'opzione più economica il
      // generatore ci si appoggiava di continuo: segnalato all'ascolto, sei battute su
      // sedici, con la figura `I64 → V` che ha la stessa nota al basso.
      //
      // Resta un pregio quando a stare ferma è TUTTA la trama — lì è un accordo tenuto, non
      // un basso pigro. Se invece il soprano si muove è moto obliquo: legittimo (nel corpus
      // il 21%) ma il meno frequente dei tre, e non va premiato.
      cost += (soprano === prev.soprano) ? -10 : 6;
    } else if (bassDist <= 5) {
      // Up to P4 (5 semitones) — normal bass motion, no penalty
      cost += 0;
    } else if (bassDist <= 7) {
      // P5/m6 — acceptable but mild penalty
      cost += 8;
    } else if (bassDist <= 9) {
      // M6/m7 — larger leap, moderate penalty  
      cost += 60;
    } else if (bassDist <= 12) {
      // m7 to 8ve — strong penalty, pushes the optimizer to find alternatives
      cost += 120;
    } else {
      // > 8ve — prohibitive
      cost += 250 + (bassDist - 12) * 20;
    }
  }

  // Motion distance per upper voice (T, A, S)
  for (let vi = 1; vi < 4; vi++) {
    const dist = midiDistance(currArr[vi], prevArr[vi]);
    if (currArr[vi] === prevArr[vi]) {
      cost -= 15; // common tone held
    } else if (dist === 1) {
      cost -= 5;  // half step
    } else if (dist === 2) {
      cost -= 3;  // whole step
    } else if (dist <= 4) {
      cost += dist * 4;  // m3/M3 skip (was *3)
    } else if (dist <= 7) {
      cost += 25 + (dist - 4) * 10;  // P4/P5 leap (was 15 + *5)
    } else if (dist <= 12) {
      cost += 60 + (dist - 7) * 15;  // m6..P8 leap (was 30 + *8)
    } else {
      cost += 150 + (dist - 12) * 20;  // >P8 leap
    }
    // Forbidden melodic intervals
    if (dist === 6) cost += 120;  // tritone
    if (dist === 10 || dist === 11) cost += 150;  // 7th
    if (dist >= 13) cost += 200;  // 9th+
    // m6 (8 semitones) or P8 (12 semitones) descending — mild penalty (prefer ascending)
    if ((dist === 8 || dist === 12) && currArr[vi] < prevArr[vi]) cost += 10;
    // Augmented 2nd (♭6↔♮7 in minor)
    if (dist === 3 && tonicPc != null) {
      const fromPc = ((prevArr[vi] % 12) + 12) % 12;
      const toPc = ((currArr[vi] % 12) + 12) % 12;
      const deg6b = (tonicPc + 8) % 12;
      const deg7n = (tonicPc + 11) % 12;
      if ((fromPc === deg6b && toPc === deg7n) || (fromPc === deg7n && toPc === deg6b)) {
        cost += 100;
      }
    }
  }

  // Voice overlap
  if (!rules.allowOverlap) {
    if (tenor < prev.bass) cost += 300;
    if (bass > prev.tenor) cost += 300;
    if (alto < prev.tenor) cost += 300;
    if (tenor > prev.alto) cost += 300;
    if (soprano < prev.alto) cost += 300;
    if (alto > prev.soprano) cost += 300;
  }

  // Contrary motion bonus (outer voices) — only when bass moves by step/small leap
  const sopMotion = soprano - prev.soprano;
  const bassMotion = bass - prev.bass;
  if (sopMotion !== 0 && bassMotion !== 0) {
    const absBassMotion = Math.abs(bassMotion);
    if (Math.sign(sopMotion) !== Math.sign(bassMotion)) {
      // Contrary motion is good, but not if the bass leaps wildly to achieve it
      cost -= absBassMotion <= 7 ? 15 : 5;
    } else {
      cost += 5;
    }
  }

  // Parallel 5ths/8ves
  if (!rules.allowParallel5ths || !rules.allowParallel8ves) {
    cost += countParallels(prevArr, currArr, rules) * 5000;
  }

  // Hidden/direct 5ths & 8ves — ALL voice pairs, Dubois exceptions
  {
    const _voicePairs: [number, number][] = [
      [3, 0], [3, 2], [3, 1], [2, 1], [2, 0], [1, 0],
    ];
    for (const [hi, lo] of _voicePairs) {
      const hPrev = prevArr[hi], hCurr = currArr[hi];
      const lPrev = prevArr[lo], lCurr = currArr[lo];
      const hMotion = hCurr - hPrev;
      const lMotion = lCurr - lPrev;
      if (hMotion === 0 || lMotion === 0) continue;
      if (Math.sign(hMotion) !== Math.sign(lMotion)) continue;
      const arrInt = ((Math.abs(hCurr - lCurr)) % 12 + 12) % 12;
      if (arrInt !== 0 && arrInt !== 7) continue;
      const depInt = ((Math.abs(hPrev - lPrev)) % 12 + 12) % 12;
      const depPerf = depInt === 0 || depInt === 7;
      const sameType = depPerf && ((depInt === 7) === (arrInt === 7));
      if (sameType) continue; // true parallel — already penalized
      const hiStep = Math.abs(hMotion) <= 2;
      const loStep = Math.abs(lMotion) <= 2;
      const isOuter = hi === 3 && lo === 0;
      const isFifth = arrInt === 7;
      const arrPcs = [((hCurr % 12) + 12) % 12, ((lCurr % 12) + 12) % 12];
      const prevPcsH = prevArr.map(m => ((m % 12) + 12) % 12);
      const hasCommonNote = arrPcs.some(pc => prevPcsH.includes(pc));
      const bassPcH = ((currArr[0] % 12) + 12) % 12;
      const degFromTonic = tonicPc != null ? ((bassPcH - tonicPc) % 12 + 12) % 12 : -1;
      const isTonalDeg = degFromTonic === 0 || degFromTonic === 5 || degFromTonic === 7;
      const isTonicOrDom = degFromTonic === 0 || degFromTonic === 7;

      let hCost = 0;
      if (isOuter) {
        if (hiStep) {
          if (isFifth) {
            hCost = isTonicOrDom ? 0 : (Math.abs(hMotion) === 1 && hMotion < 0 ? 0 : 60);
          } else {
            hCost = (Math.abs(hMotion) === 1 && isTonalDeg) ? 0 : 60;
          }
        } else {
          hCost = 150;
        }
      } else {
        if (isFifth && hasCommonNote) {
          hCost = 0;
        } else if (hiStep) {
          hCost = 0;
        } else if (loStep) {
          hCost = isFifth ? (isTonalDeg ? 0 : 30) : (lMotion > 0 ? 15 : 60);
        } else {
          hCost = isFifth ? 60 : 120;
        }
      }
      cost += hCost;
    }
  }

  // Leading tone resolution
  if (tonicPc != null && tones) {
    const ltPc = (tonicPc + 11) % 12;
    const chordPcs = tones.map(t => ((tonicPc + t.semiFromRoot) % 12 + 12) % 12);
    const tonicInChord = chordPcs.includes(tonicPc);
    if (tonicInChord) {
      for (let vi = 0; vi < 4; vi++) {
        const prevPc = ((prevArr[vi] % 12) + 12) % 12;
        if (prevPc === ltPc) {
          const currPc = ((currArr[vi] % 12) + 12) % 12;
          if (currPc !== tonicPc) cost += 200;
        }
      }
    }
  }

  // Seventh resolution (prev 7th should resolve down by step)
  // Includes transferred resolution exception (another voice takes over the resolution)
  if (prevSeventhPc != null) {
    const target1 = (prevSeventhPc + 11) % 12; // down half step
    const target2 = (prevSeventhPc + 10) % 12; // down whole step
    // Check if ANY voice in curr resolves the 7th (transferred resolution)
    const currPcsAll = currArr.map(m => ((m % 12) + 12) % 12);
    const hasTransferredRes = currPcsAll.some(pc => pc === target1 || pc === target2);
    for (let vi = 0; vi < 4; vi++) {
      const prevPc = ((prevArr[vi] % 12) + 12) % 12;
      if (prevPc === prevSeventhPc) {
        const currPc = ((currArr[vi] % 12) + 12) % 12;
        const diff = prevArr[vi] - currArr[vi];
        if (diff >= 1 && diff <= 2) {
          cost -= 50; // proper downward step resolution — bonus
        } else if (hasTransferredRes) {
          cost += 80; // transferred resolution — tolerated but not ideal
        } else {
          cost += 250; // no resolution at all — heavy penalty
        }
      }
    }
  }

  // Seventh preparation (current chord has a 7th — it should arrive by common tone or step)
  if (tones && tones.length >= 4) {
    const seventhPc = ((toneToMidiPc(tones[3]) % 12) + 12) % 12;
    for (let vi = 0; vi < 4; vi++) {
      const currPc = ((currArr[vi] % 12) + 12) % 12;
      if (currPc === seventhPc) {
        const motion = Math.abs(currArr[vi] - prevArr[vi]);
        if (motion === 0) cost -= 15;      // common tone — ideal preparation
        else if (motion <= 2) cost -= 5;   // stepwise approach — good
        else cost += 60;                   // leap to 7th — poor preparation
      }
    }
  }

  // ── THREE-NOTE MELODIC RULES (prevPrev → prev → curr) ──
  // Only when we have two prior voicings
  if (prevPrev && prev) {
    const ppArr = [prevPrev.bass, prevPrev.tenor, prevPrev.alto, prevPrev.soprano];
    for (let vi = 0; vi < 4; vi++) {
      const m0 = ppArr[vi];
      const m1 = prevArr[vi];
      const m2 = currArr[vi];
      const d01 = m1 - m0;   // signed
      const d12 = m2 - m1;   // signed
      const a01 = Math.abs(d01);
      const a12 = Math.abs(d12);
      const totalDiff = m2 - m0;
      const absTotal = Math.abs(totalDiff);

      // Two consecutive leaps in the same direction summing to 7th or 9th
      if (a01 > 2 && a12 > 2
          && Math.sign(d01) === Math.sign(d12)
          && (absTotal === 10 || absTotal === 11 || absTotal >= 13)) {
        cost += 180;
      }

      // 7th/9th traversed in two movements without a step
      if ((absTotal === 10 || absTotal === 11 || absTotal >= 13)
          && a01 > 2 && a12 > 2) {
        cost += 100;
      }

      // Zig-zag penalty: direction reversal after a leap should be compensated
      // by a small step, not another leap in the opposite direction.
      // A leap followed by a leap in the opposite direction sounds "jerky".
      if (d01 !== 0 && d12 !== 0 && Math.sign(d01) !== Math.sign(d12)) {
        // Both are leaps (>2 semitones) in opposite directions
        if (a01 > 4 && a12 > 4) {
          cost += vi === 3 ? 40 : 20; // soprano zig-zag penalized more
        } else if (a01 > 2 && a12 > 2) {
          cost += vi === 3 ? 15 : 8;
        }
      }

      // Soprano melodic continuity bonus: continuing in the same direction by step
      if (vi === 3 && d01 !== 0 && d12 !== 0 && Math.sign(d01) === Math.sign(d12) && a12 <= 2) {
        cost -= 10; // stepwise continuation is musically smooth
      }
    }
  }

  // ── STYLE PROFILE BONUSES (adaptive, capped) ──
  // These run AFTER all structural rules so they can never override hard constraints.
  // Safety: max ±30 bonus vs structural penalties of +200..+1000.
  if (opts.styleProfile) {
    const sp = opts.styleProfile;

    // Inversion preference bonus
    if (opts.currentDegree != null && opts.currentInversion != null) {
      cost += getInversionBonus(sp, opts.currentDegree, opts.currentInversion);
    }

    // Motion preference bonus (upper voices)
    if (prev) {
      const voiceNames = ['bass', 'tenor', 'alto', 'soprano'] as const;
      const currArr = [curr.bass, curr.tenor, curr.alto, curr.soprano];
      const prevArr = [prev.bass, prev.tenor, prev.alto, prev.soprano];
      for (let vi = 0; vi < 4; vi++) {
        const dist = Math.abs(currArr[vi] - prevArr[vi]);
        let motionType: 'commonTone' | 'step' | 'skip' | 'leap';
        if (dist === 0) motionType = 'commonTone';
        else if (dist <= 2) motionType = 'step';
        else if (dist <= 4) motionType = 'skip';
        else motionType = 'leap';
        cost += getMotionBonus(sp, voiceNames[vi], motionType);
      }

      // IL MOTO FRA LE VOCI ESTREME. Soprano e basso sono il telaio: quel che sta in mezzo
      // riempie. Nel corpus il moto contrario fra le estreme è il 49% di tutto ciò che è
      // stato scritto, il retto il 28%, l'obliquo il 21% — e finora questa preferenza
      // esisteva SOLO se l'utente aveva estratto un profilo di stile suo, cioè quasi mai.
      // Qui le due note sono numeri veri, quindi la domanda «sale o scende» ha una risposta
      // sola: è il posto dove il telaio si giudica.
      const sopDir = Math.sign(soprano - prev.soprano);
      const bassDir = Math.sign(bass - prev.bass);
      const tipoMoto = (sopDir === 0 || bassDir === 0) ? 'obliquo'
        : (sopDir === bassDir ? 'retto' : 'contrario');
      cost += costoMotoEstremi(tipoMoto);
      if (sopDir !== 0 && bassDir !== 0 && sopDir !== bassDir) {
        cost += getContraryMotionBonus(sp);
      }
    }
  }

  return cost;
}

/**
 * Realize the first chord in a progression (no prior voicing to reference).
 * Strategy: place bass note from chord tones + inversion, then fill SAT
 * with closest smooth voicing in comfortable ranges, doubling the root.
 */
export function realizeFirstChord(
  tones: ScaleDegreeNote[],
  inversion: number,
  rules: ChoralRules,
  fixedSoprano?: number,
  fixedBass?: number,
  tonicPc?: number,
  disposition?: string,
  styleCtx?: StyleContext
): SATBVoicing | null {
  if (tones.length < 3) return null;

  // Determine bass pitch class based on inversion
  const bassToneIndex = inversion % tones.length;
  const bassTone = tones[bassToneIndex];

  // Find bass MIDI — prefer the lower-middle of bass range (typical chorale tessitura)
  const bassCandidates = pitchesInRange(bassTone, VOICE_RANGES.bass);
  if (bassCandidates.length === 0) return null;
  // Choose the lower candidate (index ~1/3) for a comfortable chorale bass;
  // this avoids placing the bass too high (e.g. C4 instead of C3).
  const bassIdx = Math.max(0, Math.floor(bassCandidates.length / 3));
  const bassMidi = fixedBass ?? bassCandidates[bassIdx];

  // ── Explicit disposition path ─────────────────────────────────────────
  // If a specific voicing disposition is requested (e.g. 'R358' = Bass=Root, Tenor=3rd, Alto=5th, Soprano=8va),
  // assign upper voices accordingly. Only applies in root position without fixed soprano.
  if (disposition && disposition !== 'auto' && disposition.length === 4 && inversion === 0 && fixedSoprano == null) {
    const digitToTone = (d: string): ScaleDegreeNote | null => {
      if (d === '3' && tones.length > 1) return tones[1];  // 3rd
      if (d === '5' && tones.length > 2) return tones[2];  // 5th
      if (d === '8') return tones[0];                       // root (octave doubling)
      return null;
    };
    const tenorTone = digitToTone(disposition[1]);
    const altoTone = digitToTone(disposition[2]);
    const sopranoTone = digitToTone(disposition[3]);
    if (tenorTone && altoTone && sopranoTone) {
      const pickInRange = (tone: ScaleDegreeNote, range: { min: number; max: number }, above: number): number | null => {
        const candidates = pitchesInRange(tone, range).filter(c => c > above);
        if (candidates.length === 0) {
          const all = pitchesInRange(tone, range);
          return all.length > 0 ? all[Math.floor(all.length / 2)] : null;
        }
        return candidates[0]; // lowest above threshold
      };
      const tenor = pickInRange(tenorTone, VOICE_RANGES.tenor, bassMidi);
      const alto = tenor != null ? pickInRange(altoTone, VOICE_RANGES.alto, tenor) : null;
      const soprano = alto != null ? pickInRange(sopranoTone, VOICE_RANGES.soprano, alto) : null;
      if (tenor != null && alto != null && soprano != null) {
        return { soprano, alto, tenor, bass: bassMidi };
      }
    }
    // Fallback to auto if disposition can't be satisfied
  }

  // ── Fixed soprano path ──────────────────────────────────────────────
  if (fixedSoprano != null) {
    // Validate that the fixed soprano belongs to the chord's pitch classes
    const chordPcs = new Set(tones.map(t => toneToMidiPc(t)));
    const sopPc = ((fixedSoprano % 12) + 12) % 12;
    if (!chordPcs.has(sopPc)) {
      // Non-chord tone in soprano — still accept it (passing tone, appoggiatura)
      // but we can't guarantee a clean voicing. Try anyway.
    }

    // Remaining tones to assign to alto & tenor (exclude soprano's PC and bass's PC)
    const usedPcs = [sopPc, toneToMidiPc(bassTone)];
    const remainingTones = tones.filter(t => !usedPcs.includes(toneToMidiPc(t)));

    // We need 2 inner voices. If not enough remaining tones, double the root.
    const innerTones: ScaleDegreeNote[] = [...remainingTones];
    while (innerTones.length < 2) innerTones.push(tones[0]); // double root
    if (innerTones.length > 2) innerTones.length = 2;

    const innerRanges = [VOICE_RANGES.tenor, VOICE_RANGES.alto];

    // Enumerate every tenor×alto placement and pick the best via the unified
    // scoring function (which penalizes spacing > octave, voice crossing,
    // unisons …). Mirrors realizeNextChord's fixed-soprano branch with prev=null,
    // so an ISOLATED chord gets the same spacing guarantees as a voice-led one.
    // (The old greedy "closest above bass" placement ignored spacing and could
    // leave alto-soprano well over an octave apart.)
    const innerPerms = [[0, 1], [1, 0]];
    let bestVoicing: SATBVoicing | null = null;
    let bestCost = Infinity;

    for (const perm of innerPerms) {
      const allCandidates: number[][] = [];
      let valid = true;
      for (let vi = 0; vi < 2; vi++) {
        const tone = innerTones[perm[vi]];
        const candidates = pitchesInRange(tone, innerRanges[vi]);
        if (candidates.length === 0) { valid = false; break; }
        allCandidates.push(candidates);
      }
      if (!valid || allCandidates.length < 2) continue;

      const maxCombos = 64;
      let combos = 0;
      for (const tenor of allCandidates[0]) {
        for (const alto of allCandidates[1]) {
          if (++combos > maxCombos) break;
          const cand: SATBVoicing = { soprano: fixedSoprano, alto, tenor, bass: bassMidi };
          const cost = scoreVoicing({ curr: cand, prev: null, rules, tonicPc, tones, prevSeventhPc: null, ...styleCtx });
          if (cost < bestCost) { bestCost = cost; bestVoicing = cand; }
        }
      }
    }

    if (bestVoicing) return bestVoicing;

    // Safety net: if scoring found nothing (empty ranges), fall back to the old
    // greedy "closest above bass, below soprano" placement.
    const innerMidis: number[] = [];
    let lastMidi = bassMidi;
    for (let vi = 0; vi < 2; vi++) {
      const tone = innerTones[vi];
      const candidates = pitchesInRange(tone, innerRanges[vi])
        .filter(c => c > bassMidi && c < fixedSoprano);
      if (candidates.length === 0) {
        const fallback = pitchesInRange(tone, innerRanges[vi]);
        if (fallback.length === 0) return null;
        let best = fallback[0];
        for (const c of fallback) {
          if (Math.abs(c - lastMidi) < Math.abs(best - lastMidi)) best = c;
        }
        innerMidis.push(best);
      } else {
        let best = candidates[0];
        for (const c of candidates) {
          if (c >= lastMidi && (c - lastMidi) < (best - lastMidi)) best = c;
        }
        innerMidis.push(best);
      }
      lastMidi = innerMidis[innerMidis.length - 1];
    }

    return { soprano: fixedSoprano, alto: innerMidis[1], tenor: innerMidis[0], bass: bassMidi };
  }

  // Upper voices: distribute remaining chord tones + smart doubling
  const upperTones: ScaleDegreeNote[] = [];

  // Detect chord properties for doubling decisions
  const isLeadingToneFirst = tonicPc != null &&
    ((toneToMidiPc(tones[0]) + 12) % 12) === ((tonicPc + 11) % 12);
  const isDiminishedFirst = tones.length >= 3 &&
    ((toneToMidiPc(tones[2]) - toneToMidiPc(tones[0]) + 12) % 12) === 6;

  // Tonal notes: PCs of I, IV, V — always safe to double
  const tonalPcsFirst = tonicPc != null
    ? [tonicPc, (tonicPc + 5) % 12, (tonicPc + 7) % 12]
    : [];

  function bestDoublingFirst(ts: ScaleDegreeNote[]): ScaleDegreeNote {
    for (const t of ts) {
      const pc = ((toneToMidiPc(t) + 12) % 12);
      if (tonalPcsFirst.includes(pc)) return t;
    }
    if (!isLeadingToneFirst) return ts[0];
    return ts[1];
  }

  if (tones.length === 3) {
    for (let i = 0; i < tones.length; i++) {
      if (i !== bassToneIndex) upperTones.push(tones[i]);
    }
    // Smart doubling choice
    if (inversion === 2) {
      // 6/4: double the bass (= 5th)
      upperTones.push(tones[bassToneIndex]);
    } else if (isLeadingToneFirst || (inversion === 1 && isDiminishedFirst)) {
      // Leading-tone or dim 1st inv: double best tonal note (not root)
      upperTones.push(bestDoublingFirst(tones.filter((_, i) => i !== 0)));
    } else {
      // Default: double the best tonal note
      upperTones.push(bestDoublingFirst(tones));
    }
  } else {
    // Seventh chord: all 4 tones, bass already has one
    for (let i = 0; i < tones.length; i++) {
      if (i !== bassToneIndex) upperTones.push(tones[i]);
    }
  }

  // We need exactly 3 upper voices (soprano, alto, tenor)
  // Sort tones by their natural pitch class to assign from bottom (tenor) to top (soprano)
  if (upperTones.length < 3) {
    // Shouldn't happen, but safety: double root
    while (upperTones.length < 3) upperTones.push(tones[0]);
  }
  if (upperTones.length > 3) {
    upperTones.length = 3; // truncate
  }

  // For each upper voice, find the best MIDI pitch in range above bass
  const voices: { name: string; range: { min: number; max: number } }[] = [
    { name: 'tenor', range: VOICE_RANGES.tenor },
    { name: 'alto', range: VOICE_RANGES.alto },
    { name: 'soprano', range: VOICE_RANGES.soprano },
  ];

  // Try ALL permutations of upper tones to find the best voicing
  const permsFirst = permutations3();
  let bestVoicing: SATBVoicing | null = null;
  let bestScore = Infinity;

  const bassPc = ((bassMidi % 12) + 12) % 12;
  // Tonal notes for doubling preference
  const tonalPcsFC = tonicPc != null
    ? [tonicPc, (tonicPc + 5) % 12, (tonicPc + 7) % 12]
    : [];

  for (const perm of permsFirst) {
    const midis: number[] = []; // tenor, alto, soprano
    let valid = true;

    // First chord strategy: target soprano in the upper-middle of its range
    // (around E5=76 for soprano range C4-G5), then stack tenor and alto below.
    // This gives room for the soprano to move both up and down in subsequent chords.
    const sopranoTargetMidi = Math.round((VOICE_RANGES.soprano.min + VOICE_RANGES.soprano.max * 2) / 3); // ~73 (C#5)

    for (let vi = 0; vi < 3; vi++) {
      const tone = upperTones[perm[vi]];
      const candidates = pitchesInRange(tone, voices[vi].range);
      if (candidates.length === 0) { valid = false; break; }

      let best: number;
      if (vi === 2) {
        // Soprano: pick candidate closest to the target (upper-middle of range)
        best = candidates.reduce((b, c) =>
          Math.abs(c - sopranoTargetMidi) < Math.abs(b - sopranoTargetMidi) ? c : b, candidates[0]);
      } else if (vi === 1 && midis.length > 0) {
        // Alto: pick closest pitch above tenor, aiming for ~middle of alto range
        const altoTarget = Math.round((VOICE_RANGES.alto.min + VOICE_RANGES.alto.max) / 2); // ~64
        const aboveTenor = candidates.filter(c => c >= midis[0]);
        const pool = aboveTenor.length > 0 ? aboveTenor : candidates;
        best = pool.reduce((b, c) =>
          Math.abs(c - altoTarget) < Math.abs(b - altoTarget) ? c : b, pool[0]);
      } else {
        // Tenor: pick closest pitch above bass, aiming for ~middle of tenor range
        const tenorTarget = Math.round((VOICE_RANGES.tenor.min + VOICE_RANGES.tenor.max) / 2); // ~57
        const aboveBass = candidates.filter(c => c >= bassMidi);
        const pool = aboveBass.length > 0 ? aboveBass : candidates;
        best = pool.reduce((b, c) =>
          Math.abs(c - tenorTarget) < Math.abs(b - tenorTarget) ? c : b, pool[0]);
      }
      midis.push(best);
    }

    if (!valid || midis.length < 3) continue;

    const [t, a, s] = midis;
    const cand: SATBVoicing = { soprano: s, alto: a, tenor: t, bass: bassMidi };
    // Use unified scoring (vertical only — no prev)
    let score = scoreVoicing({ curr: cand, prev: null, rules, tonicPc, ...styleCtx });

    // First chord: soprano on root octave (8va) is the standard didactic choice.
    // Remove the "soprano = bass PC" penalty for the first chord and prefer the
    // traditional R-3-5-8 stacking (root, third, fifth, octave bottom to top).
    const sopPcFC = ((s % 12) + 12) % 12;
    // Prefer soprano on tonic: gives the strongest opening
    if (tonicPc != null && sopPcFC === tonicPc) score -= 15;
    // Soprano on 3rd is second best
    if (tones.length >= 2) {
      const thirdPc = ((toneToMidiPc(tones[1]) + 12) % 12);
      if (sopPcFC === thirdPc) score -= 8;
    }
    // Prefer close position: small total span from bass to soprano
    const span = s - bassMidi;
    if (span <= 19) score -= 5;  // within ~P12 — compact voicing
    if (span > 24) score += 10;  // more than 2 octaves — too spread

    if (score < bestScore) {
      bestScore = score;
      bestVoicing = cand;
    }
  }

  if (bestVoicing) return bestVoicing;

  // Fallback: stacked close position (original logic)
  const assignments: number[] = [];
  let lastMidiFb = bassMidi;
  for (let vi = 0; vi < 3; vi++) {
    const tone = upperTones[vi];
    const candidates = pitchesInRange(tone, voices[vi].range);
    if (candidates.length === 0) return null;
    let best = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      if (c >= lastMidiFb) {
        const dist = c - lastMidiFb;
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
    }
    if (bestDist === Infinity) best = candidates[candidates.length - 1];
    assignments.push(best);
    lastMidiFb = best;
  }

  // Check spacing: S-A ≤ octave, A-T ≤ octave (standard rule)
  const [tenor, alto, soprano] = assignments;
  if (alto - tenor > 12 || soprano - alto > 12) {
    // Try to fix by adjusting — for now accept it (violations will be reported)
  }

  return { soprano, alto, tenor, bass: bassMidi };
}

/**
 * Realize subsequent chords using voice leading from previous voicing.
 * Strategy: for each voice, find the chord tone that minimizes motion,
 * respecting voice ranges and avoiding parallel 5ths/8ves.
 */
export function realizeNextChord(
  tones: ScaleDegreeNote[],
  inversion: number,
  prev: SATBVoicing,
  rules: ChoralRules,
  fixedSoprano?: number,
  fixedBass?: number,
  tonicPc?: number,
  prevSeventhPc?: number,
  isLastChord?: boolean,
  styleCtx?: StyleContext
): SATBVoicing | null {
  if (tones.length < 3) return null;

  // 1. Place bass note based on inversion
  const bassToneIndex = inversion % tones.length;
  const bassTone = tones[bassToneIndex];
  const bassCandidates = pitchesInRange(bassTone, VOICE_RANGES.bass);
  if (bassCandidates.length === 0) return null;

  // Choose bass: rank all candidates by proximity, keep top-N for outer loop
  // This lets the engine try e.g. both F3 (up a P4) and F2 (down a P5) and pick
  // the bass placement that yields the best overall voicing (e.g. contrary motion).
  const bassRanked = bassCandidates
    .map(c => {
      let score = midiDistance(c, prev.bass);
      if (c > prev.tenor) score += 500;
      if (c > prev.alto) score += 1000;
      return { midi: c, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 3); // top 3 candidates

  // Override bass with fixed value ("basso dato")
  const bassOptions = fixedBass != null ? [fixedBass] : bassRanked.map(b => b.midi);

  // ── Outer loop: try multiple bass candidates to find best overall voicing ──
  let globalBestVoicing: SATBVoicing | null = null;
  let globalBestCost = Infinity;

  for (const bassMidi of bassOptions) {

  // ── Fixed soprano path ──────────────────────────────────────────────
  if (fixedSoprano != null) {
    const sopPc = ((fixedSoprano % 12) + 12) % 12;
    const bassPc = toneToMidiPc(bassTone);

    // Remaining chord tones for alto & tenor
    const usedPcs = new Set([sopPc, bassPc]);
    const remainingTones = tones.filter(t => !usedPcs.has(toneToMidiPc(t)));

    // QUALE NOTA SI RADDOPPIA. Qui c'era `innerTones.push(tones[0])`: quando restava una
    // voce da riempire si raddoppiava SEMPRE la fondamentale, per costruzione. Il che vuol
    // dire che il raddoppio non era una scelta, e nessun punteggio poteva sceglierlo — il
    // corpus può anche sapere che in una quarta e sesta si raddoppia il basso l'86% delle
    // volte, ma se l'unica voicing costruita raddoppia la fondamentale non c'è niente da
    // ordinare. Ora si costruiscono tutte le alternative e decide `scoreVoicing`, che i
    // numeri del corpus li ha.
    // QUALE NOTA SI RADDOPPIA, di partenza.
    //
    // Qui c'era `tones[0]` fisso: si raddoppiava SEMPRE la fondamentale, per costruzione. Va
    // bene quasi sempre — ed è giusto che il raddoppio sia una preferenza morbida, decisa
    // tardi, che cede alla condotta delle voci. Ma in una QUARTA E SESTA è sbagliato di
    // partenza: lì si raddoppia il basso, che è la quinta (nel corpus l'86% delle volte), e
    // raddoppiare la fondamentale significa raddoppiare la quarta sul basso, cioè la
    // dissonanza. Risultato: ogni 4/6 nasceva sbagliato e il veto doveva rifarlo — 105
    // respinte per `R-10-64` su 75 brani, la prima causa fra i raddoppi.
    //
    // Non si riapre la scelta a tutti i gradi: provato, il generatore raddoppia la terza
    // molto di più e sono tutte terze MODALI, cioè sbagliate anche per la regola. Si offre
    // un'alternativa solo dove la preferenza dice che è MIGLIORE del valore di partenza.
    const costoDi = (t: ScaleDegreeNote) => {
      const membro = ((toneToMidiPc(t) - toneToMidiPc(tones[0])) % 12 + 12) % 12;
      return costoDelRaddoppio(inversion, membro, toneToMidiPc(t) - (tonicPc ?? 0));
    };
    const costoDellaFondamentale = costoDi(tones[0]);
    const daRaddoppiare: ScaleDegreeNote[] = remainingTones.length >= 2
      ? [tones[0]]
      : [tones[0], ...tones.filter(t => t !== tones[0] && costoDi(t) < costoDellaFondamentale)];
    const disposizioniInterne: ScaleDegreeNote[][] = [];
    for (const doppia of daRaddoppiare) {
      const it: ScaleDegreeNote[] = [...remainingTones];
      while (it.length < 2) it.push(doppia);
      if (it.length > 2) it.length = 2;
      const firma = it.map(t => toneToMidiPc(t)).join(',');
      if (!disposizioniInterne.some(d => d.map(t => toneToMidiPc(t)).join(',') === firma)) disposizioniInterne.push(it);
    }

    // Try all permutations of 2 inner tones → tenor, alto
    const innerPermsBase = [[0, 1], [1, 0]];
    const innerRanges = [VOICE_RANGES.tenor, VOICE_RANGES.alto];

    let bestVoicing: SATBVoicing | null = null;
    let bestCost = Infinity;

    for (const innerTones of disposizioniInterne) {
    const innerPerms = innerPermsBase;
    for (const perm of innerPerms) {
      // Gather ALL candidates for each inner voice (not just the closest)
      const allCandidates: number[][] = [];
      let valid = true;
      for (let vi = 0; vi < 2; vi++) {
        const tone = innerTones[perm[vi]];
        const candidates = pitchesInRange(tone, innerRanges[vi]);
        if (candidates.length === 0) { valid = false; break; }
        allCandidates.push(candidates);
      }
      if (!valid || allCandidates.length < 2) continue;

      // Evaluate all T×A combinations (capped to avoid explosion)
      const maxCombos = 64;
      let combos = 0;
      for (const tenorCand of allCandidates[0]) {
        for (const altoCand of allCandidates[1]) {
          if (++combos > maxCombos) break;
          const tenor = tenorCand;
          const alto = altoCand;
          // Use unified scoring function — single source of truth
          const cand: SATBVoicing = { soprano: fixedSoprano, alto, tenor, bass: bassMidi };
          let cost = scoreVoicing({ curr: cand, prev, rules, tonicPc, tones, prevSeventhPc: prevSeventhPc ?? null, ...styleCtx });

          if (cost < bestCost) {
            bestCost = cost;
            bestVoicing = cand;
          }
    } // end altoCand loop
    } // end tenorCand loop
    } // end perm loop
    } // end disposizioni interne (quale nota si raddoppia)

    if (bestVoicing && bestCost < globalBestCost) {
      globalBestCost = bestCost;
      globalBestVoicing = bestVoicing;
    }
    continue; // try next bass candidate
  }

  // 2. Upper voices: assign chord tones with minimal total motion
  const upperToneSets: ScaleDegreeNote[][] = [];

  // Determine smart doubling based on inversion, chord quality, and tonal notes
  const isLeadingTone = tonicPc != null &&
    ((toneToMidiPc(tones[0]) + 12) % 12) === ((tonicPc + 11) % 12);
  const isDiminished = tones.length >= 3 &&
    ((toneToMidiPc(tones[2]) - toneToMidiPc(tones[0]) + 12) % 12) === 6; // tritone root→5th

  // Tonal notes: PCs of I, IV, V in the key — always safe to double
  const tonalPcs = tonicPc != null
    ? [tonicPc, (tonicPc + 5) % 12, (tonicPc + 7) % 12]
    : [];

  // Find the best tone to double: prefer tonal notes, then root
  function bestDoubling(ts: ScaleDegreeNote[], excludeIdx: number): ScaleDegreeNote {
    // First: try to find a tonal note among the chord tones
    for (const t of ts) {
      const pc = ((toneToMidiPc(t) + 12) % 12);
      if (tonalPcs.includes(pc)) return t;
    }
    // Fallback: root (unless it's the leading tone)
    if (!isLeadingTone) return ts[0];
    return ts[1]; // double 3rd for LT chords
  }

  // Standard voicing
  const standardUpper: ScaleDegreeNote[] = [];
  if (tones.length === 3) {
    for (let i = 0; i < tones.length; i++) {
      if (i !== bassToneIndex) standardUpper.push(tones[i]);
    }
    // Smart doubling choice
    if (inversion === 2) {
      // 6/4 chord: double the bass note (= 5th of chord)
      standardUpper.push(tones[bassToneIndex]);
    } else if (isLeadingTone || (inversion === 1 && isDiminished)) {
      // Leading-tone or dim 1st inv: never double root
      standardUpper.push(bestDoubling(tones.filter((_, i) => i !== 0), bassToneIndex));
    } else {
      // Default: double the best tonal note
      standardUpper.push(bestDoubling(tones, bassToneIndex));
    }
  } else {
    for (let i = 0; i < tones.length; i++) {
      if (i !== bassToneIndex) standardUpper.push(tones[i]);
    }
  }
  while (standardUpper.length < 3) standardUpper.push(tones[0]);
  if (standardUpper.length > 3) standardUpper.length = 3;
  upperToneSets.push(standardUpper);

  // Alternative doublings: try each non-LT chord tone as a doubling candidate
  // so the cost function can pick the best for voice leading
  if (tones.length === 3 && inversion !== 2 && !isLeadingTone) {
    for (let di = 0; di < tones.length; di++) {
      const dPc = ((toneToMidiPc(tones[di]) + 12) % 12);
      // Skip if it's the leading tone PC
      if (tonicPc != null && dPc === ((tonicPc + 11) % 12)) continue;
      const altUpper: ScaleDegreeNote[] = [];
      for (let i = 0; i < tones.length; i++) {
        if (i !== bassToneIndex) altUpper.push(tones[i]);
      }
      altUpper.push(tones[di]);
      if (altUpper.length > 3) altUpper.length = 3;
      // Only add if different from standard
      const altKey = altUpper.map(t => t.letter + t.accidental).join(',');
      const stdKey = standardUpper.map(t => t.letter + t.accidental).join(',');
      if (altKey !== stdKey) upperToneSets.push(altUpper);
    }
  }

  // Incomplete voicing variant (doubled root, skip 5th: [root, root, 3rd])
  // Always available for root-position triads — the cost function will prefer
  // the complete voicing when possible, but pick incomplete to avoid parallels.
  if (tones.length === 3 && inversion === 0) {
    const incompleteUpper: ScaleDegreeNote[] = [tones[0], tones[0], tones[1]]; // root, root, 3rd (no 5th)
    const incKey = incompleteUpper.map(t => t.letter + t.accidental).join(',');
    const stdKey = standardUpper.map(t => t.letter + t.accidental).join(',');
    if (incKey !== stdKey) upperToneSets.push(incompleteUpper);
  }

  // Incomplete voicing for seventh chords: double root, omit 5th → [root, 3rd, 7th]
  // Common practice: V7 often omits the 5th and doubles the root for smoother voice leading.
  if (tones.length === 4 && inversion === 0) {
    // Upper tones: root(doubled), 3rd, 7th — skip 5th (tones[2])
    const inc7Upper: ScaleDegreeNote[] = [tones[0], tones[1], tones[3]];
    const inc7Key = inc7Upper.map(t => t.letter + t.accidental).join(',');
    const stdKey = standardUpper.map(t => t.letter + t.accidental).join(',');
    if (inc7Key !== stdKey) upperToneSets.push(inc7Upper);
  }

  // For each permutation of upper tones to voices, compute total motion
  const voiceNames = ['tenor', 'alto', 'soprano'] as const;
  const prevMidis = [prev.tenor, prev.alto, prev.soprano];
  const ranges = [VOICE_RANGES.tenor, VOICE_RANGES.alto, VOICE_RANGES.soprano];

  // Generate all permutations of upperTones indices for 3 voices
  const perms = permutations3();

  let bestVoicing: SATBVoicing | null = null;
  let bestCost = Infinity;

  for (const upperTones of upperToneSets) {
  for (const perm of perms) {
    const voiceCandidates: number[][] = [];
    let valid = true;

    for (let vi = 0; vi < 3; vi++) {
      const tone = upperTones[perm[vi]];
      const candidates = pitchesInRange(tone, ranges[vi]);
      if (candidates.length === 0) { valid = false; break; }

      voiceCandidates.push(candidates);
    }

    if (!valid || voiceCandidates.length < 3) continue;

    // Explore all combinations of candidates (capped for performance)
    const maxPerVoice = 6; // top 6 closest candidates per voice
    const sortedCands: number[][] = voiceCandidates.map((cands, vi) => {
      return [...cands].sort((a, b) => midiDistance(a, prevMidis[vi]) - midiDistance(b, prevMidis[vi])).slice(0, maxPerVoice);
    });

    for (const tenorC of sortedCands[0]) {
    for (const altoC of sortedCands[1]) {
    for (const sopC of sortedCands[2]) {
    const [tenor, alto, soprano] = [tenorC, altoC, sopC];
    // Use unified scoring function — single source of truth
    const cand: SATBVoicing = { soprano, alto, tenor, bass: bassMidi };
    const totalCost = scoreVoicing({ curr: cand, prev, rules, tonicPc, tones, prevSeventhPc: prevSeventhPc ?? null, ...styleCtx });

    if (totalCost < bestCost) {
      bestCost = totalCost;
      bestVoicing = cand;
    }
    } // end sopC loop
    } // end altoC loop
    } // end tenorC loop
  } // end perm loop
  } // end upperToneSets loop

  if (bestVoicing && bestCost < globalBestCost) {
    globalBestCost = bestCost;
    globalBestVoicing = bestVoicing;
  }

  } // end bassOptions loop

  return globalBestVoicing;
}

/** Generate all 6 permutations of [0,1,2]. */
function permutations3(): number[][] {
  return [
    [0, 1, 2], [0, 2, 1],
    [1, 0, 2], [1, 2, 0],
    [2, 0, 1], [2, 1, 0],
  ];
}

/** Count parallel 5ths and 8ves between two SATB snapshots. */
function countParallels(prevMidis: number[], currMidis: number[], rules: ChoralRules): number {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const prevInterval = ((prevMidis[j] - prevMidis[i]) % 12 + 12) % 12;
      const currInterval = ((currMidis[j] - currMidis[i]) % 12 + 12) % 12;

      // Both voices must actually move for it to be "parallel"
      if (prevMidis[i] === currMidis[i] && prevMidis[j] === currMidis[j]) continue;
      // At least one voice must move
      if (prevMidis[i] === currMidis[i] || prevMidis[j] === currMidis[j]) continue;

      const dir_i = Math.sign(currMidis[i] - prevMidis[i]);
      const dir_j = Math.sign(currMidis[j] - prevMidis[j]);

      // Unison→Octave or Octave→Unison: always forbidden (same as parallel 8ves)
      if (!rules.allowParallel8ves && prevInterval === 0 && currInterval === 0) {
        // This covers: unison→octave, octave→unison, parallel octaves, parallel unisons
        count++;
        continue;
      }

      // Consecutive P5→P5 or P8→P8 by contrary motion (R-02c / R-01c)
      if (dir_i !== dir_j) {
        if (!rules.allowParallel5ths && prevInterval === 7 && currInterval === 7) count++;
        continue;
      }

      // Same direction — parallel 5th
      if (!rules.allowParallel5ths && prevInterval === 7 && currInterval === 7) count++;
    }
  }
  return count;
}

// ─── Violation Detection ───────────────────────────────────────────────────

/**
 * Detect voice-leading violations between two adjacent voicings.
 */
export function detectViolations(
  prev: SATBVoicing,
  curr: SATBVoicing,
  measure: number,
  beat: number,
  rules: ChoralRules
): ChoralViolation[] {
  const violations: ChoralViolation[] = [];
  const voiceLabels = ['bass', 'tenor', 'alto', 'soprano'];
  const prevArr = [prev.bass, prev.tenor, prev.alto, prev.soprano];
  const currArr = [curr.bass, curr.tenor, curr.alto, curr.soprano];

  // Voice crossing
  // Voice crossing — now checked in the main loop for ALL chords (including first)
  // (removed from here to avoid duplicates)

  // Voice overlap
  if (!rules.allowOverlap) {
    if (curr.tenor < prev.bass) violations.push({ type: 'voice-overlap', description: 'Tenor goes below previous bass', measure, beat, voices: ['tenor', 'bass'] });
    if (curr.bass > prev.tenor) violations.push({ type: 'voice-overlap', description: 'Bass goes above previous tenor', measure, beat, voices: ['bass', 'tenor'] });
    if (curr.alto < prev.tenor) violations.push({ type: 'voice-overlap', description: 'Alto goes below previous tenor', measure, beat, voices: ['alto', 'tenor'] });
    if (curr.tenor > prev.alto) violations.push({ type: 'voice-overlap', description: 'Tenor goes above previous alto', measure, beat, voices: ['tenor', 'alto'] });
    if (curr.soprano < prev.alto) violations.push({ type: 'voice-overlap', description: 'Soprano goes below previous alto', measure, beat, voices: ['soprano', 'alto'] });
    if (curr.alto > prev.soprano) violations.push({ type: 'voice-overlap', description: 'Alto goes above previous soprano', measure, beat, voices: ['alto', 'soprano'] });
  }

  // Spacing & Range — now checked in the main loop for ALL chords (including first)
  // (removed from here to avoid duplicates)

  // Parallel 5ths / 8ves
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const prevInterval = ((prevArr[j] - prevArr[i]) % 12 + 12) % 12;
      const currInterval = ((currArr[j] - currArr[i]) % 12 + 12) % 12;

      if (prevArr[i] === currArr[i] && prevArr[j] === currArr[j]) continue;
      if (prevArr[i] === currArr[i] || prevArr[j] === currArr[j]) continue;

      const dir_i = Math.sign(currArr[i] - prevArr[i]);
      const dir_j = Math.sign(currArr[j] - prevArr[j]);

      // Unison→Octave or Octave→Unison: always a violation (consecutive 8ves)
      if (!rules.allowParallel8ves && prevInterval === 0 && currInterval === 0) {
        const isUnison = prevArr[i] === prevArr[j] || currArr[i] === currArr[j];
        violations.push({ type: 'parallel-8ve', description: isUnison
          ? `Unison↔Octave: ${voiceLabels[i]}-${voiceLabels[j]}`
          : `Parallel 8ves: ${voiceLabels[i]}-${voiceLabels[j]}`,
          measure, beat, voices: [voiceLabels[i], voiceLabels[j]] });
        continue;
      }

      // Consecutive P5→P5 by contrary motion (R-02c)
      if (dir_i !== dir_j) {
        if (!rules.allowParallel5ths && prevInterval === 7 && currInterval === 7) {
          violations.push({ type: 'parallel-5th', description: `Consecutive 5ths by contrary motion: ${voiceLabels[i]}-${voiceLabels[j]}`, measure, beat, voices: [voiceLabels[i], voiceLabels[j]] });
        }
        continue;
      }

      if (!rules.allowParallel5ths && prevInterval === 7 && currInterval === 7) {
        violations.push({ type: 'parallel-5th', description: `Parallel 5ths: ${voiceLabels[i]}-${voiceLabels[j]}`, measure, beat, voices: [voiceLabels[i], voiceLabels[j]] });
      }
    }
  }

  // Hidden/direct 5ths & 8ves (similar motion arriving at P5 or P8, not parallel)
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const dir_i = currArr[i] - prevArr[i];
      const dir_j = currArr[j] - prevArr[j];
      if (dir_i === 0 || dir_j === 0) continue; // oblique
      if (Math.sign(dir_i) !== Math.sign(dir_j)) continue; // contrary
      const arrInt = ((currArr[j] - currArr[i]) % 12 + 12) % 12;
      if (arrInt !== 0 && arrInt !== 7) continue; // not P5 or P8
      const depInt = ((prevArr[j] - prevArr[i]) % 12 + 12) % 12;
      if ((depInt === 7 && arrInt === 7) || (depInt === 0 && arrInt === 0)) continue; // true parallel already caught
      const isOuter = i === 0 && j === 3; // bass=0, soprano=3
      const hiStep = Math.abs(dir_j) <= 2;
      const loStep = Math.abs(dir_i) <= 2;
      // Outer voices: only exception if soprano (j=3) moves by step
      if (isOuter && !hiStep) {
        violations.push({
          type: 'parallel-5th',
          description: `Hidden ${arrInt === 7 ? '5th' : '8ve'} (S+B): both leap to ${arrInt === 7 ? 'P5' : 'P8'}`,
          measure, beat, voices: [voiceLabels[i], voiceLabels[j]],
        });
      }
      // Inner voices: both leap and no common note → violation
      if (!isOuter && !hiStep && !loStep) {
        const arrPcs = [((currArr[i] % 12) + 12) % 12, ((currArr[j] % 12) + 12) % 12];
        const prevPcs = prevArr.map(m => ((m % 12) + 12) % 12);
        const hasCommon = arrPcs.some(pc => prevPcs.includes(pc));
        if (!hasCommon) {
          violations.push({
            type: 'parallel-5th',
            description: `Hidden ${arrInt === 7 ? '5th' : '8ve'} (${voiceLabels[i]}-${voiceLabels[j]}): both leap`,
            measure, beat, voices: [voiceLabels[i], voiceLabels[j]],
          });
        }
      }
    }
  }

  return violations;
}

let noteIdCounter = 0;
let noteIdPrefix = Date.now().toString(36);

/** Reset the ID counter (useful for testing). */
export function resetNoteIdCounter(): void {
  noteIdCounter = 0;
  noteIdPrefix = Date.now().toString(36);
}

/** Generate a unique note ID. */
function nextNoteId(): string {
  return `ch_${noteIdPrefix}_${++noteIdCounter}`;
}

/**
 * Convert an SATB voicing at a specific beat/measure into StaffNote[].
 * Produces 4 notes (one per voice) compatible with GrandStaffEditor.
 */
export function voicingToStaffNotes(
  voicing: SATBVoicing,
  measure: number,
  beat: number,
  duration: string,
  tones: ScaleDegreeNote[],
  inversion: number,
  keySignature: KeySignature,
  beatsPerMeasure: number = 4
): StaffNote[] {
  const voiceMap: { midi: number; voice: Voice; clef: 'treble' | 'bass'; tonePick: ScaleDegreeNote }[] = [
    { midi: voicing.soprano, voice: 1, clef: 'treble', tonePick: findToneForMidi(voicing.soprano, tones) },
    { midi: voicing.alto,    voice: 2, clef: 'treble', tonePick: findToneForMidi(voicing.alto, tones) },
    { midi: voicing.tenor,   voice: 3, clef: 'bass',   tonePick: findToneForMidi(voicing.tenor, tones) },
    { midi: voicing.bass,    voice: 4, clef: 'bass',   tonePick: findToneForMidi(voicing.bass, tones) },
  ];

  const notes: StaffNote[] = [];

  for (const v of voiceMap) {
    const { letter, accidental } = v.tonePick;
    // L'ottava segue la LETTERA, non il suono. Cb5 = C5 abbassato (midi 71),
    // non B4. Calcoliamo l'ottava dal midi naturale (senza accidentale).
    const accSemi = accidental === '#' ? 1 : accidental === 'b' ? -1 : accidental === '##' ? 2 : accidental === 'bb' ? -2 : 0;
    const naturalMidi = v.midi - accSemi;
    const octave = Math.floor(naturalMidi / 12) - 1;
    const noteIndex = midiToNoteIndex(v.midi);
    const position = notePosition(letter, octave);

    // Calculate explicit accidental relative to key signature
    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);

    let explicitAccidental: string | null = null;
    if (keySignature.type === 'sharp') {
      const isInKeySig = sharpNotes.includes(letter);
      if (accidental === '#' && !isInKeySig) explicitAccidental = 'sharp';
      else if (accidental === '' && isInKeySig) explicitAccidental = 'natural';
      else if (accidental === 'b') explicitAccidental = 'flat';
      else if (accidental === '##') explicitAccidental = 'double-sharp';
      else if (accidental === 'bb') explicitAccidental = 'double-flat';
    } else {
      const isInKeySig = flatNotes.includes(letter);
      if (accidental === 'b' && !isInKeySig) explicitAccidental = 'flat';
      else if (accidental === '' && isInKeySig) explicitAccidental = 'natural';
      else if (accidental === '#') explicitAccidental = 'sharp';
      else if (accidental === '##') explicitAccidental = 'double-sharp';
      else if (accidental === 'bb') explicitAccidental = 'double-flat';
    }

    // Compute tick position
    const beatsPerQuarter = 1; // quarter-note base
    const durationBeats = DURATION_VALUES[duration as keyof typeof DURATION_VALUES] ?? 1;
    const startTick = ((measure * beatsPerMeasure) + (beat - 1)) * TICKS_PER_QUARTER;
    const durationTicks = durationBeats * TICKS_PER_QUARTER;

    const note: StaffNote = {
      id: nextNoteId(),
      pitch: letter,
      octave,
      position,
      midi: v.midi,
      noteIndex,
      clef: v.clef,
      // accidental: the effective accidental of the note (including key sig)
      accidental: (accidental === '#' ? 'sharp'
        : accidental === 'b' ? 'flat'
        : accidental === '##' ? 'double-sharp'
        : accidental === 'bb' ? 'double-flat'
        : 'natural') as any,
      explicitAccidental: explicitAccidental as any,
      duration: duration as any,
      isRest: false,
      isTriplet: false,
      isDuplet: false,
      isDotted: false,
      measureIndex: measure,
      beat,
      voice: v.voice,
      startTick,
      durationTicks,
    };

    notes.push(note);
  }

  return notes;
}

/** Find the ScaleDegreeNote whose pitch class matches a MIDI value. */
function findToneForMidi(midi: number, tones: ScaleDegreeNote[]): ScaleDegreeNote {
  const pc = midiToNoteIndex(midi);
  for (const t of tones) {
    const tPc = ((LETTER_TO_SEMI[t.letter] ?? 0) +
      (t.accidental === '#' ? 1 : t.accidental === 'b' ? -1 :
       t.accidental === '##' ? 2 : t.accidental === 'bb' ? -2 : 0) + 12) % 12;
    if (tPc === pc) return t;
  }
  // Fallback: return first tone
  return tones[0];
}

/** Un accordo candidato: le quattro voci e il rivolto con cui è stato costruito (la grafia
 *  dipende dal rivolto, quindi va portato appresso). */
export type Proposta = { v: SATBVoicing; inv: number };

/**
 * TUTTI I MODI RAGIONEVOLI DI SCRIVERE QUESTO ACCORDO dopo quello precedente.
 *
 * Serve a chi deve rimettere in discussione una scelta: il veto quando respinge l'accordo in
 * carica, e il passo indietro quando la colpa è dell'accordo PRIMA. Le due domande sono la
 * stessa, poste su accordi diversi, e prima stavano scritte due volte.
 *
 * I vincoli sono quelli che rendono un candidato un accordo VALIDO e non un'altra armonia:
 * solo note dell'accordo richiesto, basso preteso dal rivolto, voci in ordine e in ambito, e
 * la melodia data intoccabile. Dentro quei limiti si prova a muovere le voci interne, a
 * spostare basso e soprano di un'ottava, e — quando il rivolto è una proposta della macchina
 * e non una scelta dell'utente — a cambiare rivolto: le quinte nascoste fra soprano e basso
 * non si curano in nessun altro modo, perché quelle due voci sono le uniche inchiodate.
 */
export function generaCandidati(args: {
  tones: ScaleDegreeNote[];
  inv: number;
  rivoltiDaProvare: number[];
  prevVoicing: SATBVoicing;
  inCarica: SATBVoicing | null;
  rules: ChoralRules;
  fixedSoprano?: number;
  fixedBass?: number;
  /** Voce INTERNA data: contralto e/o tenore inchiodati, come già si fa per soprano e basso. */
  fixedAlto?: number;
  fixedTenor?: number;
  tonicPc: number;
  prevSeventhPc?: number;
  isLast: boolean;
  styleCtx: StyleContext;
}): Proposta[] {
  const { tones, inv, rivoltiDaProvare, prevVoicing, inCarica, rules, fixedSoprano, fixedBass, fixedAlto, fixedTenor, tonicPc, prevSeventhPc, isLast, styleCtx } = args;
  const pcDellAccordo = new Set(tones.map(t => toneToMidiPc(t)));
  const eNotaDellAccordo = (midi: number) => pcDellAccordo.has(((midi % 12) + 12) % 12);
  const ammissibile = (c: SATBVoicing, rv: number): boolean => {
    if (c.bass > c.tenor || c.tenor > c.alto || c.alto > c.soprano) return false;
    if (c.soprano < VOICE_RANGES.soprano.min || c.soprano > VOICE_RANGES.soprano.max) return false;
    if (c.alto < VOICE_RANGES.alto.min || c.alto > VOICE_RANGES.alto.max) return false;
    if (c.tenor < VOICE_RANGES.tenor.min || c.tenor > VOICE_RANGES.tenor.max) return false;
    if (c.bass < VOICE_RANGES.bass.min || c.bass > VOICE_RANGES.bass.max) return false;
    if (!eNotaDellAccordo(c.bass) || !eNotaDellAccordo(c.tenor) || !eNotaDellAccordo(c.alto) || !eNotaDellAccordo(c.soprano)) return false;
    if (((c.bass % 12) + 12) % 12 !== toneToMidiPc(tones[rv % tones.length])) return false;
    if (fixedSoprano != null && c.soprano !== fixedSoprano) return false;
    if (fixedBass != null && c.bass !== fixedBass) return false;
    if (fixedAlto != null && c.alto !== fixedAlto) return false;
    if (fixedTenor != null && c.tenor !== fixedTenor) return false;
    return true;
  };

  const fuori: Proposta[] = [];
  const gia = new Set<string>();
  if (inCarica) gia.add(`${inv}|${inCarica.bass},${inCarica.tenor},${inCarica.alto},${inCarica.soprano}`);
  const proponi = (c: SATBVoicing, rv: number) => {
    if (!ammissibile(c, rv)) return;
    const k = `${rv}|${c.bass},${c.tenor},${c.alto},${c.soprano}`;
    if (gia.has(k)) return;
    gia.add(k);
    fuori.push({ v: c, inv: rv });
  };

  /**
   * CON UNA VOCE INTERNA DATA SI ENUMERA, non si perturba.
   *
   * Le proposte nascono da `realizeNextChord`, che di quel vincolo non sa niente: partono
   * quasi sempre con il contralto o il tenore sbagliati, e le perturbazioni potrebbero non
   * arrivare mai a quello giusto — anzi, `ammissibile` le scarterebbe tutte e il generatore
   * si troverebbe senza candidati. Quando la voce data c'è, le disposizioni si contano: sono
   * poche, perché due voci su quattro sono già decise.
   */
  const enumera = (rv: number) => {
    const pcOf = (m: number) => ((m % 12) + 12) % 12;
    const bassoPc = toneToMidiPc(tones[rv % tones.length]);
    const opzioni = (amb: { min: number; max: number }, fisso?: number, soloPc?: number) => {
      if (fisso != null) return [fisso];
      const out: number[] = [];
      for (let m = amb.min; m <= amb.max; m++) {
        const p = pcOf(m);
        if (soloPc != null ? p === soloPc : pcDellAccordo.has(p)) out.push(m);
      }
      return out;
    };
    const bs = opzioni(VOICE_RANGES.bass, fixedBass, bassoPc);
    const ts = opzioni(VOICE_RANGES.tenor, fixedTenor);
    const as = opzioni(VOICE_RANGES.alto, fixedAlto);
    const ss = opzioni(VOICE_RANGES.soprano, fixedSoprano);
    // CON UN TETTO. Enumerare senza limite produce centinaia di disposizioni per accordo, e
    // ognuna viene poi pesata da `scoreVoicing`: sul banco dei 74 brani non finiva in otto
    // minuti. Si ordinano con un conto CHE NON COSTA NIENTE — quanto si spostano le voci
    // rispetto a dov'erano — e si passano avanti solo le più vicine. Il punteggio vero, che
    // è caro, lavora su quelle.
    const grezzi: SATBVoicing[] = [];
    for (const b of bs) for (const t of ts) {
      if (t < b || t - b > 24) continue;
      for (const a of as) {
        if (a < t || a - t > 12) continue;
        for (const sp of ss) {
          if (sp < a || sp - a > 12) continue;
          grezzi.push({ soprano: sp, alto: a, tenor: t, bass: b });
        }
      }
    }
    const distanza = (c: SATBVoicing) =>
      Math.abs(c.soprano - prevVoicing.soprano) + Math.abs(c.alto - prevVoicing.alto)
      + Math.abs(c.tenor - prevVoicing.tenor) + Math.abs(c.bass - prevVoicing.bass);
    grezzi.sort((x, y) => distanza(x) - distanza(y));
    for (const c of grezzi.slice(0, 24)) proponi(c, rv);
  };

  for (const rv of rivoltiDaProvare) {
    if (fixedAlto != null || fixedTenor != null) { enumera(rv); continue; }
    const base = (rv === inv && inCarica) ? inCarica
      : realizeNextChord(tones, rv, prevVoicing, rules, fixedSoprano, fixedBass, tonicPc, prevSeventhPc, isLast, styleCtx);
    if (!base) continue;
    proponi(base, rv);
    for (const d of [-12, 12, -7, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 7]) {
      proponi({ ...base, tenor: base.tenor + d }, rv);
      proponi({ ...base, alto: base.alto + d }, rv);
      if (d === -12 || d === 12) {
        proponi({ ...base, bass: base.bass + d }, rv);
        if (fixedSoprano == null) proponi({ ...base, soprano: base.soprano + d }, rv);
      }
    }
    // Le due voci interne insieme. Il giro dei salti arriva alla QUINTA (±7) e comprende la
    // terza (±4): mancavano, e con loro mancava una soluzione ovvia. Su un 4/6 uscito col
    // Do raddoppiato al posto del basso, la cura era portare il contralto al Sol e il tenore
    // al Mi — un salto di terza al tenore — e quel candidato non veniva nemmeno costruito.
    // Nelle voci interne un salto è ammissibile: costa qualcosa nel punteggio, ma è una
    // moneta con cui si compra volentieri un raddoppio giusto.
    for (const dt of [-12, 12, -5, -3, -2, -1, 1, 2, 3, 5]) {
      for (const da of [-12, 12, -3, -2, -1, 1, 2, 3]) {
        proponi({ ...base, tenor: base.tenor + dt, alto: base.alto + da }, rv);
      }
    }
    // E le realizzazioni che nascono da un accordo precedente immaginato diverso: a volte
    // l'unica uscita è un accordo interamente diverso, non uno spostamento.
    for (const d of [-2, -1, 1, 2]) {
      for (const chi of ['tenor', 'alto'] as const) {
        const finto = { ...prevVoicing, [chi]: (prevVoicing as any)[chi] + d } as SATBVoicing;
        const alt = realizeNextChord(tones, rv, finto, rules, fixedSoprano, fixedBass, tonicPc, prevSeventhPc, isLast, styleCtx);
        if (alt) proponi(alt, rv);
      }
    }
  }
  return fuori;
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

/**
 * Realize a chorale from a roman numeral progression.
 *
 * @param progression - Array of RomanChord descriptors
 * @param config - Tonic, mode, time signature, rules
 * @returns StaffNote[] for GrandStaffEditor + violations list
 */
/**
 * Parse a modulation token like 'G', 'g', 'Bb', 'f#' → { tonic, isMinor }.
 * Upper-case first letter = major, lower-case = minor.
 * Returns null if the token is not a valid modulation.
 */
export function parseModulationToken(token: string): { tonic: string; isMinor: boolean } | null {
  if (!token || token.length === 0) return null;
  const m = token.match(/^([A-Ga-g])(b{1,2}|#{1,2})?$/);
  if (!m) return null;
  const letter = m[1];
  const acc = m[2] ?? '';
  const isMinor = letter === letter.toLowerCase();
  const tonic = letter.toUpperCase() + acc;
  return { tonic, isMinor };
}

/** Un accordo come è stato scritto: serve al RIPASSO, che li ripercorre tutti alla fine. */
type Passo = {
  chord: RomanChord;
  voicing: SATBVoicing;
  inv: number;
  tones: ScaleDegreeNote[];
  durationName: string;
  fixedSoprano?: number;
  fixedBass?: number;
  fixedAlto?: number;
  fixedTenor?: number;
  isLast: boolean;
  degree: number;
  /** Dove cominciano le sue note dentro `allNotes`. */
  noteStart: number;
};

export function realizeChorale(
  progression: RomanChord[],
  config: ChoralConfig
): ChoralRealizationResult {
  const { tonic: initialTonic, isMinor: initialIsMinor, timeSignature } = config;
  const rules: ChoralRules = {
    allowParallel5ths: false,
    allowParallel8ves: false,
    allowCrossing: false,
    allowOverlap: false,
    doubleRoot: true,
    ...config.rules,
  };

  resetNoteIdCounter();

  // Current tonality — may change via modulation tokens
  let tonic = initialTonic;
  let isMinor = initialIsMinor;
  let scale = buildScale(tonic, isMinor);
  let keySignature = buildKeySignature(tonic, isMinor);
  let tonicPcVal = noteNameToPc(tonic);

  // The display key signature never changes — the staff always shows the original
  // armature. Accidentals are computed relative to this.
  const displayKeySignature = buildKeySignature(initialTonic, initialIsMinor);

  const allNotes: StaffNote[] = [];
  /** Ogni accordo come è stato scritto, per il RIPASSO in fondo. */
  const passi: Passo[] = [];
  const allViolations: ChoralViolation[] = [];
  const modulationContexts: ModulationContext[] = [];
  // IL SEME DELLA RIPARTENZA: se si riparte da metà brano, il primo accordo nuovo non
  // nasce dal silenzio ma dall'ultimo accordo tenuto. `prevNoteDate` conserva le note
  // VERE (grafia compresa) finché non c'è un `prevTones` da cui ricostruirle.
  const dellaVoce = (nn: StaffNote[], v: number): number | null => {
    const t = nn.find(n => Number((n as any).voice) === v && !(n as any).isRest);
    return t ? Number((t as any).midi) : null;
  };
  let prevNoteDate: StaffNote[] | null = null;
  let prevVoicing: SATBVoicing | null = null;
  if (config.notePrecedenti && config.notePrecedenti.length >= 4) {
    const s1 = dellaVoce(config.notePrecedenti, 1), a1 = dellaVoce(config.notePrecedenti, 2);
    const t1 = dellaVoce(config.notePrecedenti, 3), b1 = dellaVoce(config.notePrecedenti, 4);
    if (s1 != null && a1 != null && t1 != null && b1 != null) {
      prevVoicing = { soprano: s1, alto: a1, tenor: t1, bass: b1 };
      prevNoteDate = config.notePrecedenti;
    }
  }
  let prevPrevVoicing: SATBVoicing | null = null;
  let prevSeventhPc: number | null = null;
  // Note dell'accordo precedente COM'È STATO SCRITTO: al veto serve la grafia vera, e la
  // grafia dipende dai gradi (`tones`) e dal rivolto effettivamente usato, non dal cifrato.
  let prevTones: ScaleDegreeNote[] | null = null;
  let prevInvUsed = 0;
  let prevPrevTones: ScaleDegreeNote[] | null = null;
  let prevPrevInvUsed = 0;
  let prevChordNoteStart = -1; // index in allNotes where the previous chord's notes start

  // Build soprano constraint lookup map: "measure:beat" → MIDI
  const sopranoMap = new Map<string, number>();
  if (config.sopranoMelody) {
    for (const sc of config.sopranoMelody) {
      sopranoMap.set(`${sc.measure}:${sc.beat}`, sc.midi);
    }
  }

  // Build bass constraint lookup map: "measure:beat" → MIDI ("basso dato")
  /**
   * LE VOCI INTERNE DATE. `lockedVoices` era dichiarato dal 15/02/2026 con la descrizione
   * «il motore fissa quelle e genera solo le libere» e non è mai stato letto da nessuna riga:
   * era una promessa scritta nei tipi. Qui viene mantenuta. Soprano e basso continuano ad
   * avere le loro strade (`sopranoMelody`, `bassMelody`), che sanno anche dedurre l'armonia.
   */
  const altoMap = new Map<string, number>();
  const tenorMap = new Map<string, number>();
  for (const [v, vincoli] of Object.entries(config.lockedVoices ?? {})) {
    const dove = Number(v) === 2 ? altoMap : Number(v) === 3 ? tenorMap : null;
    if (!dove) continue;
    for (const c of vincoli ?? []) dove.set(`${c.measure}:${c.beat}`, c.midi);
  }

  const bassMap = new Map<string, number>();
  if (config.bassMelody) {
    for (const bc of config.bassMelody) {
      bassMap.set(`${bc.measure}:${bc.beat}`, bc.midi);
    }
  }

  // Compute beat duration for each chord (fill to next chord or end of measure)
  const sortedProg = [...progression].sort((a, b) =>
    a.measure !== b.measure ? a.measure - b.measure : a.beat - b.beat
  );

  for (let i = 0; i < sortedProg.length; i++) {
    const chord = sortedProg[i];

    // ── Modulation: switch tonality if this chord has a modulateTo marker ──
    if (chord.modulateTo) {
      const mod = parseModulationToken(chord.modulateTo);
      if (mod) {
        tonic = mod.tonic;
        isMinor = mod.isMinor;
        scale = buildScale(tonic, isMinor);
        keySignature = buildKeySignature(tonic, isMinor);
        tonicPcVal = noteNameToPc(tonic);
        // Emit a modulation context for the analysis engine
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const absBeat = chord.measure * beatsPerMeasure + (chord.beat - 1);
        modulationContexts.push({
          absBeat,
          measureIndex: chord.measure,
          beat: chord.beat,
          newTonic: tonic,
          newIsMinor: isMinor,
          label: `→ ${tonic} ${isMinor ? 'min' : 'Maj'}`,
          source: 'composer',
        });
      }
    }

    const parsed = parseRoman(chord.roman);
    let inv = chord.inversion ?? parsed.inversion;
    // ── Smart inversion defaults (when user/parser didn't specify) ──
    if (chord.inversion == null && parsed.inversion === 0) {
      // vii° → always 1st inversion (vii°6) — dim triad unstable in root position
      if (parsed.degree === 6 && !parsed.hasSeventh) inv = 1;
      // ii → prefer 1st inversion (ii6) when preceding V
      if (parsed.degree === 1 && i + 1 < sortedProg.length) {
        const nextParsed = parseRoman(sortedProg[i + 1].roman);
        if (nextParsed.degree === 4) inv = 1;
      }
      // I6/4 cadenzale: I before V → 2nd inversion (cadential 6/4)
      // Only for diatonic V (not secondary dominants), and never on the first chord.
      if (parsed.degree === 0 && i > 0 && i + 1 < sortedProg.length) {
        const nextParsed = parseRoman(sortedProg[i + 1].roman);
        if (nextParsed.degree === 4 && nextParsed.secondaryTarget == null) inv = 2;
      }

      // ── Bass-line smoothness: auto-select inversion using corpus stats + proximity ──
      // Uses two signals:
      // 1) Style profile: if the corpus shows 1st inversion is common for this degree (≥20%)
      // 2) Bass proximity: if 1st inversion gives a closer bass note to the previous bass
      // Skip: 7th chords, secondary dominants, I/V on beat 1 (tonal pillars).
      if (inv === 0 && prevVoicing && i > 0 && !parsed.hasSeventh && parsed.secondaryTarget == null) {
        const isStrongBeat = chord.beat === 1;
        const isTonicOrDom = parsed.degree === 0 || parsed.degree === 4;
        if (!(isStrongBeat && isTonicOrDom)) {
          const currTones = getChordTones(parsed, scale, tonic, isMinor);
          if (currTones.length >= 2) {
            const rootCands = pitchesInRange(currTones[0], VOICE_RANGES.bass);
            const firstCands = pitchesInRange(currTones[1], VOICE_RANGES.bass);
            if (rootCands.length > 0 && firstCands.length > 0) {
              const closestTo = (cands: number[], target: number) =>
                cands.reduce((best, c) => Math.abs(c - target) < Math.abs(best - target) ? c : best, cands[0]);
              const bestRoot = closestTo(rootCands, prevVoicing.bass);
              const bestFirst = closestTo(firstCands, prevVoicing.bass);
              const distRoot = Math.abs(bestRoot - prevVoicing.bass);
              const distFirst = Math.abs(bestFirst - prevVoicing.bass);

              // Corpus inversion rate for this degree
              const degreeLabel = degreeToRoman(parsed.degree, isMinor);
              const sp = config.styleProfile;
              const invStats = sp?.inversionByDegree?.[degreeLabel];
              const firstInvRate = invStats && invStats.total > 5
                ? (invStats.counts[1] || 0) / invStats.total
                : 0;

              // Decision: combine proximity and corpus probability
              // Strong signal: corpus says ≥20% first inversion AND it's closer
              if (firstInvRate >= 0.20 && distFirst < distRoot) {
                inv = 1;
              }
              // Moderate signal: corpus says ≥15% AND proximity saves ≥3 semitones
              else if (firstInvRate >= 0.15 && distRoot >= 4 && distFirst < distRoot - 2) {
                inv = 1;
              }
              // Pure proximity: no corpus data but root leaps a lot and 1st inv is much closer
              else if (distRoot >= 5 && distFirst <= 2) {
                inv = 1;
              }
            }
          }
        }
      }
    }
    const tones = getChordTones(parsed, scale, tonic, isMinor);

    // Style context for adaptive scoring (passed to scoreVoicing via helpers)
    const styleCtx: StyleContext = config.styleProfile
      ? { styleProfile: config.styleProfile, currentDegree: degreeToRoman(parsed.degree, isMinor), currentInversion: inv }
      : {};

    // Determine duration: explicit > fill to next chord > end of measure
    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
    let durationName: string;
    if (chord.duration) {
      durationName = chord.duration;
    } else {
      let durationBeats: number;
      if (i + 1 < sortedProg.length && sortedProg[i + 1].measure === chord.measure) {
        durationBeats = sortedProg[i + 1].beat - chord.beat;
      } else if (i + 1 < sortedProg.length) {
        durationBeats = (beatsPerMeasure - chord.beat + 1);
      } else {
        durationBeats = beatsPerMeasure - chord.beat + 1;
      }
      durationName = beatsToDuration(durationBeats);
    }

    // Soprano constraint for this chord position
    let fixedSoprano = sopranoMap.get(`${chord.measure}:${chord.beat}`);
    const fixedBass = bassMap.get(`${chord.measure}:${chord.beat}`);
    const fixedAlto = altoMap.get(`${chord.measure}:${chord.beat}`);
    const fixedTenor = tenorMap.get(`${chord.measure}:${chord.beat}`);

    // ── Cadence enforcement ──
    const isLast = (i === sortedProg.length - 1);
    // Last chord: force root position unless user explicitly specified an inversion.
    // A final chord in inversion sounds unstable and is non-standard in chorale style.
    if (isLast && chord.inversion == null) {
      inv = 0;
    }
    // PAC: last chord is I in root position → soprano should be on tonic.
    //
    // MA NON SE IL SOPRANO PORTA LA SETTIMA. Una cadenza perfetta è una preferenza; una
    // settima che non risolve è un difetto, e fra i due vince l'obbligo. Inchiodando il
    // soprano sulla tonica, la settima che sta lì non può più scendere di grado: sulla
    // progressione `I – IV – V7 – I` provata con tutte e sette le disposizioni iniziali, è
    // esattamente il caso che restava sbagliato — la settima al soprano andava a Do invece
    // che a Mi. La soluzione giusta la scrive l'utente a mano: `V65` col Fa al soprano che
    // scende sul Mi, e la cadenza resta perfetta lo stesso perché la tonica ce l'ha il basso.
    const settimaAlSoprano = prevVoicing != null && prevSeventhPc != null
      && ((prevVoicing.soprano % 12) + 12) % 12 === prevSeventhPc;
    if (isLast && parsed.degree === 0 && inv === 0 && fixedSoprano == null && !settimaAlSoprano) {
      // Find tonic MIDI in soprano range closest to previous soprano
      const tonicCandidates = pitchesInRange(tones[0], VOICE_RANGES.soprano);
      if (tonicCandidates.length > 0 && prevVoicing) {
        let bestTonic = tonicCandidates[0];
        let bestDist = Infinity;
        for (const c of tonicCandidates) {
          const d = midiDistance(c, prevVoicing.soprano);
          if (d < bestDist) { bestDist = d; bestTonic = c; }
        }
        fixedSoprano = bestTonic;
      }
    }

    // Realize voicing — with lookahead beam search
    let voicing: SATBVoicing | null;
    if (!prevVoicing) {
      // ── Multi-start: try several soprano starting pitches and pick the one
      //    that produces the lowest cost over the first 2 chords (3-step lookahead).
      const dispositions: (string | undefined)[] = [config.initialDisposition];
      // Add alternative dispositions only if not explicitly specified by user
      if (!config.initialDisposition || config.initialDisposition === 'auto') {
        dispositions.length = 0;
        dispositions.push('auto', 'R358', 'R538', 'R835', 'R385');
      }
      let bestFirstVoicing: SATBVoicing | null = null;
      let bestFirstScore = Infinity;
      for (const disp of dispositions) {
        const candFirst = realizeFirstChord(tones, inv, rules, fixedSoprano, fixedBass, tonicPcVal, disp, styleCtx);
        if (!candFirst) continue;
        // Score: vertical cost of first chord + cost of next 1-2 chords
        let totalScore = scoreVoicing({ curr: candFirst, prev: null, rules, tonicPc: tonicPcVal, tones, ...styleCtx });
        let prevC = candFirst;
        for (let look = 1; look <= Math.min(2, sortedProg.length - i - 1); look++) {
          const nextCh = sortedProg[i + look];
          const nextP = parseRoman(nextCh.roman);
          const nextInvL = nextCh.inversion ?? nextP.inversion;
          const nextTonesL = getChordTones(nextP, scale, tonic, isMinor);
          const nextFixSop = sopranoMap.get(`${nextCh.measure}:${nextCh.beat}`);
          const nextFixBas = bassMap.get(`${nextCh.measure}:${nextCh.beat}`);
          const sevenPc = nextTonesL.length >= 4 ? toneToMidiPc(nextTonesL[3]) : null;
          const nextV = realizeNextChord(nextTonesL, nextInvL, prevC, rules, nextFixSop, nextFixBas, tonicPcVal, sevenPc ?? undefined, false, styleCtx);
          if (!nextV) { totalScore += 5000; break; }
          totalScore += scoreVoicing({ curr: nextV, prev: prevC, rules, tonicPc: tonicPcVal, tones: nextTonesL, ...styleCtx });
          prevC = nextV;
        }
        if (totalScore < bestFirstScore) {
          bestFirstScore = totalScore;
          bestFirstVoicing = candFirst;
        }
      }
      voicing = bestFirstVoicing;
    } else {
      // ── Beam search with 1-step lookahead ──
      // Generate multiple candidate voicings by trying slight perturbations,
      // then pick the one whose (current_violations + next_chord_violations) is lowest.
      const greedyVoicing = realizeNextChord(tones, inv, prevVoicing, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, i === sortedProg.length - 1, styleCtx);
      voicing = greedyVoicing;

      if (greedyVoicing && i + 1 < sortedProg.length) {
        // Prepare next chord info for lookahead
        const nextChord = sortedProg[i + 1];
        const nextParsed = parseRoman(nextChord.roman);
        const nextInv = nextChord.inversion ?? nextParsed.inversion;
        const nextTones = getChordTones(nextParsed, scale, tonic, isMinor);
        const nextFixedSop = sopranoMap.get(`${nextChord.measure}:${nextChord.beat}`);
        const nextFixedBas = bassMap.get(`${nextChord.measure}:${nextChord.beat}`);
        const currSeventhPc = tones.length >= 4 ? toneToMidiPc(tones[3]) : null;
        const nextIsLast = (i + 1 === sortedProg.length - 1);

        // Score a candidate voicing using unified scoreVoicing with 1-step lookahead
        const scoreCandidate = (cand: SATBVoicing): number => {
          // Current step: prev→cand
          const s1 = scoreVoicing({ curr: cand, prev: prevVoicing!, prevPrev: prevPrevVoicing, rules, tonicPc: tonicPcVal, tones, ...styleCtx });
          // Lookahead: cand→next
          const nextVoicing = realizeNextChord(nextTones, nextInv, cand, rules, nextFixedSop, nextFixedBas, tonicPcVal, currSeventhPc ?? undefined, nextIsLast, styleCtx);
          const s2 = nextVoicing ? scoreVoicing({ curr: nextVoicing, prev: cand, rules, tonicPc: tonicPcVal, tones: nextTones, ...styleCtx }) : 0;
          // Weight: current full, next at 80%
          return s1 + s2 * 0.8;
        };

        const greedyScore = scoreCandidate(greedyVoicing);
        if (greedyScore > 0) {
          // Try alternative voicings by perturbing each inner voice ±1 octave
          let bestScore = greedyScore;
          let bestCand = greedyVoicing;
          // Chord-tone PCs for the current chord — perturbations must stay on these
          const chordPcSet = new Set(tones.map(t => toneToMidiPc(t)));
          const isChordTone = (midi: number) => chordPcSet.has(((midi % 12) + 12) % 12);
          // Required bass pitch class (from inversion)
          const reqBassPc = toneToMidiPc(tones[inv % tones.length]);
          const tryCandidate = (cand: SATBVoicing) => {
            // Basic validity: within SATB ranges and ordering
            if (cand.bass > cand.tenor || cand.tenor > cand.alto || cand.alto > cand.soprano) return;
            if (cand.soprano < VOICE_RANGES.soprano.min || cand.soprano > VOICE_RANGES.soprano.max) return;
            if (cand.alto < VOICE_RANGES.alto.min || cand.alto > VOICE_RANGES.alto.max) return;
            if (cand.tenor < VOICE_RANGES.tenor.min || cand.tenor > VOICE_RANGES.tenor.max) return;
            if (cand.bass < VOICE_RANGES.bass.min || cand.bass > VOICE_RANGES.bass.max) return;
            // All voices must be chord tones
            if (!isChordTone(cand.bass) || !isChordTone(cand.tenor) || !isChordTone(cand.alto) || !isChordTone(cand.soprano)) return;
            // Bass must match the inversion's required pitch class
            if (((cand.bass % 12) + 12) % 12 !== reqBassPc) return;
            const s = scoreCandidate(cand);
            if (s < bestScore) { bestScore = s; bestCand = cand; }
          };
          const g = greedyVoicing;
          // Perturbations: shift tenor or alto ±12 (octave), ±1–5 (steps/skips)
          for (const dt of [-12, 12, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5]) {
            tryCandidate({ ...g, tenor: g.tenor + dt });
            tryCandidate({ ...g, alto: g.alto + dt });
            tryCandidate({ ...g, bass: g.bass + dt });
          }
          // Swap alto and tenor pitch classes
          if (g.alto !== g.tenor) {
            const aDiff = g.alto - g.tenor;
            tryCandidate({ ...g, tenor: g.tenor + aDiff, alto: g.alto - aDiff });
          }
          // Combined perturbations: move two voices at once
          for (const dt of [-12, 12, -2, -1, 1, 2]) {
            for (const da of [-12, 12, -2, -1, 1, 2]) {
              tryCandidate({ ...g, tenor: g.tenor + dt, alto: g.alto + da });
            }
          }
          // Try re-running realizeNextChord with a slightly perturbed prevVoicing
          for (const dt of [-1, 1, -2, 2]) {
            const pertPrev = { ...prevVoicing!, tenor: prevVoicing!.tenor + dt };
            const alt = realizeNextChord(tones, inv, pertPrev, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, i === sortedProg.length - 1, styleCtx);
            if (alt) tryCandidate(alt);
          }
          for (const dt of [-1, 1, -2, 2]) {
            const pertPrev = { ...prevVoicing!, alto: prevVoicing!.alto + dt };
            const alt = realizeNextChord(tones, inv, pertPrev, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, i === sortedProg.length - 1, styleCtx);
            if (alt) tryCandidate(alt);
          }
          voicing = bestCand;
        }
      }

      // ── Auto-inversion optimization: if user didn't specify inversion and
      //    the current voicing has a high cost, try alternative inversions.
      //    E.g. IV root with awkward leaps → try IV6 for smoother lines.
      if (voicing && chord.inversion == null && !isLast && prevVoicing) {
        const currCost = scoreVoicing({ curr: voicing, prev: prevVoicing, prevPrev: prevPrevVoicing, rules, tonicPc: tonicPcVal, tones, ...styleCtx });
        const inversionsToTry = tones.length === 3 ? [0, 1] : [0, 1, 2];
        for (const altInv of inversionsToTry) {
          if (altInv === inv) continue;
          const altV = realizeNextChord(tones, altInv, prevVoicing, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, false, styleCtx);
          if (!altV) continue;
          const altCost = scoreVoicing({ curr: altV, prev: prevVoicing, prevPrev: prevPrevVoicing, rules, tonicPc: tonicPcVal, tones, ...styleCtx });
          // Only switch if the alternative is meaningfully better (threshold avoids trivial swaps)
          if (altCost < currCost - 30) {
            voicing = altV;
            inv = altInv;
          }
        }
      }
    }

    if (!voicing) continue;

    // ── Hard crossing guard: reject voicing with voice crossing ──
    // If the generated voicing has crossing, try to fix by swapping upper voices
    // but preserve the bass note (it must match the requested inversion).
    if (voicing.bass > voicing.tenor || voicing.tenor > voicing.alto || voicing.alto > voicing.soprano) {
      const requiredBassMidi = voicing.bass;
      const upper = [voicing.tenor, voicing.alto, voicing.soprano].sort((a, b) => a - b);
      // Only fix if all upper voices are above or equal to bass after sorting
      if (upper[0] >= requiredBassMidi) {
        voicing = { bass: requiredBassMidi, tenor: upper[0], alto: upper[1], soprano: upper[2] };
      } else {
        // Cannot fix crossing without breaking inversion — skip this voicing
        continue;
      }
    }

    // ── Last-chord retry: if the final chord has violations, try alternatives ──
    if (prevVoicing && i === sortedProg.length - 1) {
      const baseScore = scoreVoicing({ curr: voicing, prev: prevVoicing, prevPrev: prevPrevVoicing, rules, tonicPc: tonicPcVal, tones, ...styleCtx });
      if (baseScore > 0) {
        let bestV = voicing;
        let bestS = baseScore;
        // Chord-tone PCs for last chord — perturbations must stay on these
        const lastChordPcSet = new Set(tones.map(t => toneToMidiPc(t)));
        const isLastChordTone = (midi: number) => lastChordPcSet.has(((midi % 12) + 12) % 12);
        // Required bass pitch class (from inversion)
        const requiredBassPc = toneToMidiPc(tones[inv % tones.length]);
        const tryLast = (cand: SATBVoicing) => {
          if (cand.bass > cand.tenor || cand.tenor > cand.alto || cand.alto > cand.soprano) return;
          if (cand.soprano < VOICE_RANGES.soprano.min || cand.soprano > VOICE_RANGES.soprano.max) return;
          if (cand.alto < VOICE_RANGES.alto.min || cand.alto > VOICE_RANGES.alto.max) return;
          if (cand.tenor < VOICE_RANGES.tenor.min || cand.tenor > VOICE_RANGES.tenor.max) return;
          if (cand.bass < VOICE_RANGES.bass.min || cand.bass > VOICE_RANGES.bass.max) return;
          // All voices must be chord tones
          if (!isLastChordTone(cand.bass) || !isLastChordTone(cand.tenor) || !isLastChordTone(cand.alto) || !isLastChordTone(cand.soprano)) return;
          // Bass must match the inversion's required pitch class
          if (((cand.bass % 12) + 12) % 12 !== requiredBassPc) return;
          // Hard filter: reject candidates that introduce hard violations
          const candViols = detectViolations(prevVoicing!, cand, chord.measure, chord.beat, rules);
          const hardViols = candViols.filter(v => v.type === 'parallel-5th' || v.type === 'parallel-8ve');
          const s = scoreVoicing({ curr: cand, prev: prevVoicing!, prevPrev: prevPrevVoicing, rules, tonicPc: tonicPcVal, tones, ...styleCtx })
            + hardViols.length * 10000; // massive penalty for any hard violation
          if (s < bestS) { bestS = s; bestV = cand; }
        };
        // Try perturbations of inner voices
        for (const dt of [-12, 12, -7, 7, -5, 5, -4, 4, -3, 3, -2, 2, -1, 1]) {
          tryLast({ ...voicing, tenor: voicing.tenor + dt });
          tryLast({ ...voicing, alto: voicing.alto + dt });
          tryLast({ ...voicing, soprano: voicing.soprano + dt });
          // Bass octave shift (maintains pitch class)
          if (dt === -12 || dt === 12) tryLast({ ...voicing, bass: voicing.bass + dt });
        }
        // Try multi-voice perturbations: shift two voices at once
        for (const dt of [-12, 12, -7, 7, -5, 5, -4, 4, -3, 3]) {
          for (const dt2 of [-12, 12, -7, 7, -5, 5, -4, 4, -3, 3]) {
            tryLast({ ...voicing, tenor: voicing.tenor + dt, alto: voicing.alto + dt2 });
          }
        }
        // Try different soprano tonic candidates (if cadence-forced)
        if (isLast && parsed.degree === 0) {
          const tonicCands = pitchesInRange(tones[0], VOICE_RANGES.soprano);
          for (const sc of tonicCands) {
            const alt = realizeNextChord(tones, inv, prevVoicing, rules, sc, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, true, styleCtx);
            if (alt) tryLast(alt);
          }
        }
        // Re-run with perturbed prev
        for (const dt of [-1, 1, -2, 2, -3, 3, -5, 5, -7, 7]) {
          const pp = { ...prevVoicing, tenor: prevVoicing.tenor + dt };
          const alt = realizeNextChord(tones, inv, pp, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, true, styleCtx);
          if (alt) tryLast(alt);
        }
        for (const dt of [-1, 1, -2, 2, -3, 3, -5, 5, -7, 7]) {
          const pp = { ...prevVoicing, alto: prevVoicing.alto + dt };
          const alt = realizeNextChord(tones, inv, pp, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, true, styleCtx);
          if (alt) tryLast(alt);
        }
        voicing = bestV;
      }
    }

    // Detect violations (horizontal: between consecutive chords)
    if (prevVoicing) {
      const violations = detectViolations(prevVoicing, voicing, chord.measure, chord.beat, rules);

      // ── Backtracking: if this chord has hard violations (P5/P8/hidden),
      //    try perturbing the PREVIOUS chord's voicing and re-generating this one.
      //    This mimics a human going "hmm, I'll change the previous chord a bit".
      // NOTA. Questo blocco riscrive anche l'accordo PRECEDENTE, cioè uno che il veto ha
      // già approvato, e lo giudica con la copia semplificata delle regole: sembrava il
      // colpevole di due salti di settima al basso rimasti dopo il veto. Spegnendolo si è
      // visto che non c'entrava (i numeri non si sono mossi di una virgola) e che anzi con
      // il veto acceso lavora bene — meno avvisi su due brani su sette. Resta.
      const hasHardViolation = violations.some(v =>
        v.type === 'parallel-5th' || v.type === 'parallel-8ve' || v.type === 'hidden-5th' || v.type === 'hidden-8ve'
      );
      if (hasHardViolation) {
        let bestBackV = voicing;
        let bestBackPrevV = prevVoicing;
        let bestBackViols = violations.length;
        let bestBackUsedDiffInv = false;

        // ── Strategy 1: try current chord with different inversion ──
        // If the inversion was auto-selected (not user-specified), try root pos and 1st inv
        // Never change inversion of the last chord (must stay in root position)
        const userSpecifiedInv = chord.inversion != null;
        if (!userSpecifiedInv && !isLast) {
          const inversionsToTry = [0, 1];
          for (const altInv of inversionsToTry) {
            if (altInv === inv) continue; // skip current inversion
            const altTones = getChordTones(parsed, scale, tonic, isMinor);
            const altCurr = realizeNextChord(altTones, altInv, prevVoicing, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, i === sortedProg.length - 1, styleCtx);
            if (!altCurr) continue;
            const altViols = detectViolations(prevVoicing, altCurr, chord.measure, chord.beat, rules);
            if (altViols.length < bestBackViols) {
              bestBackViols = altViols.length;
              bestBackV = altCurr;
              bestBackPrevV = prevVoicing;
              bestBackUsedDiffInv = true;
            }
            if (bestBackViols === 0) break;
          }
        }

        // ── Strategy 2: try previous chord with different inversion ──
        if (bestBackViols > 0 && i >= 1) {
          const prevChordEntry = sortedProg[i - 1];
          const prevUserInv = prevChordEntry.inversion != null;
          if (!prevUserInv) {
            const prevParsedBT = parseRoman(prevChordEntry.roman);
            const prevTonesBT = getChordTones(prevParsedBT, scale, tonic, isMinor);
            const prevFixSopBT = sopranoMap.get(`${prevChordEntry.measure}:${prevChordEntry.beat}`);
            const prevFixBasBT = bassMap.get(`${prevChordEntry.measure}:${prevChordEntry.beat}`);
            const ppSeventhPc = prevTonesBT.length >= 4 ? toneToMidiPc(prevTonesBT[3]) : null;
            const prevSource = prevPrevVoicing ?? prevVoicing; // best available
            for (const altPrevInv of [0, 1]) {
              const altPrev = prevPrevVoicing
                ? realizeNextChord(prevTonesBT, altPrevInv, prevPrevVoicing, rules, prevFixSopBT, prevFixBasBT, tonicPcVal, ppSeventhPc ?? undefined, false, styleCtx)
                : realizeFirstChord(prevTonesBT, altPrevInv, rules, prevFixSopBT, prevFixBasBT, tonicPcVal, undefined, styleCtx);
              if (!altPrev) continue;
              const altCurr = realizeNextChord(tones, inv, altPrev, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, i === sortedProg.length - 1, styleCtx);
              if (!altCurr) continue;
              const viols1 = prevPrevVoicing ? detectViolations(prevPrevVoicing, altPrev, prevChordEntry.measure, prevChordEntry.beat, rules) : [];
              const viols2 = detectViolations(altPrev, altCurr, chord.measure, chord.beat, rules);
              const totalViols = viols1.length + viols2.length;
              if (totalViols < bestBackViols) {
                bestBackViols = totalViols;
                bestBackPrevV = altPrev;
                bestBackV = altCurr;
                bestBackUsedDiffInv = false; // we changed prev, not just curr inv
              }
              if (totalViols === 0) break;
            }
          }
        }

        // ── Strategy 3: perturb prevPrev voices → re-gen prev → re-gen curr ──
        if (bestBackViols > 0 && prevPrevVoicing && i >= 2) {
          const prevChordEntry = sortedProg[i - 1];
          const prevParsedBT = parseRoman(prevChordEntry.roman);
          const prevInvBT = prevChordEntry.inversion ?? prevParsedBT.inversion;
          const prevTonesBT = getChordTones(prevParsedBT, scale, tonic, isMinor);
          const prevFixSopBT = sopranoMap.get(`${prevChordEntry.measure}:${prevChordEntry.beat}`);
          const prevFixBasBT = bassMap.get(`${prevChordEntry.measure}:${prevChordEntry.beat}`);
          const ppSeventhPc = prevTonesBT.length >= 4 ? toneToMidiPc(prevTonesBT[3]) : null;

          const perturbations = [-1, 1, -2, 2, -3, 3, -12, 12];
          for (const voice of ['tenor', 'alto', 'soprano'] as const) {
            for (const dt of perturbations) {
              const ppPerturbed = { ...prevPrevVoicing, [voice]: prevPrevVoicing[voice] + dt };
              if (ppPerturbed[voice] < VOICE_RANGES[voice].min || ppPerturbed[voice] > VOICE_RANGES[voice].max) continue;
              if (ppPerturbed.bass > ppPerturbed.tenor || ppPerturbed.tenor > ppPerturbed.alto || ppPerturbed.alto > ppPerturbed.soprano) continue;

              const altPrev = realizeNextChord(prevTonesBT, prevInvBT, ppPerturbed, rules, prevFixSopBT, prevFixBasBT, tonicPcVal, ppSeventhPc ?? undefined, false, styleCtx);
              if (!altPrev) continue;

              const altCurr = realizeNextChord(tones, inv, altPrev, rules, fixedSoprano, fixedBass, tonicPcVal, prevSeventhPc ?? undefined, i === sortedProg.length - 1, styleCtx);
              if (!altCurr) continue;

              const viols1 = detectViolations(ppPerturbed, altPrev, prevChordEntry.measure, prevChordEntry.beat, rules);
              const viols2 = detectViolations(altPrev, altCurr, chord.measure, chord.beat, rules);
              const totalViols = viols1.length + viols2.length;

              if (totalViols < bestBackViols) {
                bestBackViols = totalViols;
                bestBackPrevV = altPrev;
                bestBackV = altCurr;
              }
              if (totalViols === 0) break;
            }
            if (bestBackViols === 0) break;
          }
        }

        if (bestBackViols < violations.length) {
          // Strategy 1 only changes the current chord — no need to touch allNotes
          if (bestBackPrevV === prevVoicing) {
            voicing = bestBackV;
          } else {
            // Strategies 2 & 3 changed the previous chord too.
            // SAFETY CHECK: verify the new prevVoicing doesn't introduce violations
            // with the chord before it (prevPrevVoicing).
            if (prevPrevVoicing) {
              const prevChordEntry = sortedProg[i - 1];
              const retroViols = detectViolations(prevPrevVoicing, bestBackPrevV, prevChordEntry.measure, prevChordEntry.beat, rules);
              const hadRetroViols = allViolations.filter(v =>
                v.measure === prevChordEntry.measure && v.beat === prevChordEntry.beat
              ).length;
              if (retroViols.length > hadRetroViols) {
                // Backtracking would introduce MORE violations upstream — reject it
                // Fall through: keep original voicing and violations
              } else {
                // Safe to apply
                if (prevChordNoteStart >= 0) {
                  allNotes.length = prevChordNoteStart;
                }
                // Remove old violations for prev chord
                for (let vi = allViolations.length - 1; vi >= 0; vi--) {
                  const v = allViolations[vi];
                  if (v.measure === prevChordEntry.measure && v.beat === prevChordEntry.beat) {
                    allViolations.splice(vi, 1);
                  }
                }
                // Re-add with upstream violations
                allViolations.push(...retroViols);
                // Re-add previous chord's notes
                const prevParsedBT = parseRoman(prevChordEntry.roman);
                const prevInvBT = prevChordEntry.inversion ?? prevParsedBT.inversion;
                const prevTonesBT = getChordTones(prevParsedBT, scale, tonic, isMinor);
                const prevDurName = beatsToDuration(
                  chord.beat > prevChordEntry.beat && chord.measure === prevChordEntry.measure
                    ? chord.beat - prevChordEntry.beat
                    : beatsPerMeasure - prevChordEntry.beat + 1
                );
                const prevNotes = voicingToStaffNotes(bestBackPrevV, prevChordEntry.measure, prevChordEntry.beat, prevDurName, prevTonesBT, prevInvBT, displayKeySignature, beatsPerMeasure);
                allNotes.push(...prevNotes);
                prevVoicing = bestBackPrevV;
                voicing = bestBackV;
              }
            } else {
              // No prevPrev — safe to apply strategy 2
              if (prevChordNoteStart >= 0) {
                allNotes.length = prevChordNoteStart;
              }
              const prevChordEntry = sortedProg[i - 1];
              for (let vi = allViolations.length - 1; vi >= 0; vi--) {
                const v = allViolations[vi];
                if (v.measure === prevChordEntry.measure && v.beat === prevChordEntry.beat) {
                  allViolations.splice(vi, 1);
                }
              }
              const prevParsedBT = parseRoman(prevChordEntry.roman);
              const prevInvBT = prevChordEntry.inversion ?? prevParsedBT.inversion;
              const prevTonesBT = getChordTones(prevParsedBT, scale, tonic, isMinor);
              const prevDurName = beatsToDuration(
                chord.beat > prevChordEntry.beat && chord.measure === prevChordEntry.measure
                  ? chord.beat - prevChordEntry.beat
                  : beatsPerMeasure - prevChordEntry.beat + 1
              );
              const prevNotes = voicingToStaffNotes(bestBackPrevV, prevChordEntry.measure, prevChordEntry.beat, prevDurName, prevTonesBT, prevInvBT, displayKeySignature, beatsPerMeasure);
              allNotes.push(...prevNotes);
              prevVoicing = bestBackPrevV;
              voicing = bestBackV;
            }
          }
        }
      }

      // Now push the (possibly updated) violations
      const finalViolations = detectViolations(prevVoicing, voicing, chord.measure, chord.beat, rules);
      allViolations.push(...finalViolations);
    }

    // ── IL VETO DELLE REGOLE, E IL PASSO INDIETRO ──────────────────────────
    // Fin qui l'accordo è stato scelto dal punteggio interno del generatore, che delle
    // regole ha una copia SEMPLIFICATA (`detectViolations`, `countParallels`). Prima di
    // fissarlo lo si sottopone al checker vero dell'applicazione, ma solo sulle regole
    // meccaniche — vedi `vetoRegole.ts` per la linea di taglio e il perché.
    //
    // E QUANDO NON C'È USCITA, SI TORNA INDIETRO. Il veto sa vedere il difetto ma non sempre
    // sa curarlo muovendo l'accordo in esame: su «Corale n 5c» respingeva due sovrapposizioni
    // di voce (il contralto dell'accordo prima che finisce sopra il soprano di questo) e non
    // trovava niente, perché il soprano è la melodia data e la cura stava nell'accordo
    // PRECEDENTE. È l'obiezione dell'utente, e ha ragione: «a volte arrivati lì non c'è
    // soluzione se non tornando indietro e modificando i due accordi precedenti».
    //
    // Il passo indietro rimette in gioco l'accordo prima — a patto che la sua sostituta regga
    // a sua volta il veto contro quello ancora prima, altrimenti si sposterebbe il guasto di
    // una casella invece di toglierlo. Le note già scritte si riscrivono con la stessa
    // macchina che usa il backtracking interno (`prevChordNoteStart`).
    //
    // COSTO: l'accordo in carica si controlla SEMPRE (un controllo, ~1,5 ms); le alternative
    // si pagano solo quando il veto scatta, e il passo indietro solo quando le alternative
    // non bastano — cioè di rado.
    // UNA VOCE INTERNA DATA NON È UNA PREFERENZA. La proposta di sopra nasce da
    // `realizeNextChord`, che di quel vincolo non sa niente: se c'è, si rifà la scelta fra le
    // sole disposizioni che lo rispettano. Se non ne esiste nessuna — la nota data non è una
    // nota di quell'accordo — si tiene quella libera invece di fallire: il vincolo cade dove
    // è impossibile, e il resto del brano continua a rispettarlo.
    if (voicing && (fixedAlto != null || fixedTenor != null)) {
      const conVincolo = generaCandidati({
        tones, inv, rivoltiDaProvare: [inv], prevVoicing: prevVoicing ?? voicing, inCarica: null,
        rules, fixedSoprano, fixedBass, fixedAlto, fixedTenor, tonicPc: tonicPcVal,
        prevSeventhPc: prevSeventhPc ?? undefined, isLast, styleCtx,
      });
      if (conVincolo.length > 0) {
        let meglio = conVincolo[0], punteggio = Infinity;
        for (const c of conVincolo) {
          const p = scoreVoicing({
            curr: c.v, prev: prevVoicing ?? c.v, prevPrev: prevPrevVoicing,
            rules, tonicPc: tonicPcVal, tones, ...styleCtx,
          });
          if (p < punteggio) { punteggio = p; meglio = c; }
        }
        voicing = meglio.v;
        inv = meglio.inv;
      }
    }

    const vociPrimaDelVeto = voicing;
    if (voicing && prevVoicing && (prevTones || prevNoteDate) && config.vetoRegole !== false) {
      // La finestra è di tre accordi quando ci sono — `R-06` e `R-17a` parlano di un salto
      // E della sua risoluzione, che in due accordi non si vede. I posti sono movimenti
      // forti consecutivi (b1, b3 della prima battuta, b1 della seconda) così che nessuna
      // regola legata al tempo forte cambi risposta per colpa della collocazione.
      const noteDi = (v: SATBVoicing, tn: ScaleDegreeNote[], rv: number, m: number, b: number) =>
        voicingToStaffNotes(v, m, b, 'half', tn, rv, keySignature, 4);
      // Le note TENUTE di una ripartenza non hanno `tones` da cui ricostruirle: si
      // rimettono in scena così come sono scritte, cambiando solo dove cadono. È anche più
      // fedele che ricostruirle, perché la grafia resta quella vera del brano.
      const riposiziona = (nn: StaffNote[], m: number, b: number): StaffNote[] =>
        nn.map(n => ({
          ...n, id: nextNoteId(), measureIndex: m, beat: b, duration: 'half' as any,
          startTick: ((m * 4) + (b - 1)) * TICKS_PER_QUARTER,
          durationTicks: 2 * TICKS_PER_QUARTER,
        }));
      const notePrec = (v: SATBVoicing, tn: ScaleDegreeNote[] | null, rv: number, m: number, b: number) =>
        tn ? noteDi(v, tn, rv, m, b) : riposiziona(prevNoteDate!, m, b);
      const finestra = (prevPrev: SATBVoicing | null, prev: SATBVoicing, prevTn: ScaleDegreeNote[] | null, prevRv: number) => {
        const passato: StaffNote[][] = [];
        if (prevPrev && prevPrevTones) {
          passato.push(noteDi(prevPrev, prevPrevTones, prevPrevInvUsed, 0, 1));
          passato.push(notePrec(prev, prevTn, prevRv, 0, 3));
          return { passato, m: 1, b: 1 };
        }
        passato.push(notePrec(prev, prevTn, prevRv, 0, 1));
        return { passato, m: 0, b: 3 };
      };

      const f = finestra(prevPrevVoicing, prevVoicing, prevTones, prevInvUsed);
      const giudica = (cand: SATBVoicing, rivolto: number, dentro = f) =>
        veto(dentro.passato, noteDi(cand, tones, rivolto, dentro.m, dentro.b), keySignature, tonic, isMinor);

      contiVeto.controllati++;
      const esitoInCarica = giudica(voicing, inv);

      if (esitoInCarica.quante > 0) {
        contiVeto.fermati++;
        for (const r of esitoInCarica.regole) contiVeto.perRegola[r] = (contiVeto.perRegola[r] ?? 0) + 1;

        const rivoltiDi = (c: RomanChord, rivolto: number, tn: ScaleDegreeNote[], ultimo: boolean): number[] => {
          const out = [rivolto];
          if ((c.inversion == null || c.inversionIsSuggestion) && !ultimo) {
            for (let k = 0; k < Math.min(tn.length, 4); k++) if (k !== rivolto) out.push(k);
          }
          return out;
        };

        const gusto = (p: Proposta, prev: SATBVoicing, prevPrev: SATBVoicing | null, tn: ScaleDegreeNote[], deg: number) =>
          scoreVoicing({
            curr: p.v, prev, prevPrev, rules, tonicPc: tonicPcVal, tones: tn,
            ...(config.styleProfile
              ? { styleProfile: config.styleProfile, currentDegree: degreeToRoman(deg, isMinor), currentInversion: p.inv }
              : {}),
          });

        // ── Primo tentativo: cambiare SOLO questo accordo ──
        const alternative = generaCandidati({
          tones, inv, rivoltiDaProvare: rivoltiDi(chord, inv, tones, isLast),
          prevVoicing, inCarica: voicing, rules, fixedSoprano, fixedBass, fixedAlto, fixedTenor,
          tonicPc: tonicPcVal, prevSeventhPc: prevSeventhPc ?? undefined, isLast, styleCtx,
        });
        // Si provano in ordine di GUSTO: il punteggio stilistico (che il corpus alimenta)
        // decide la fila, il checker decide chi passa. Il primo che non infrange niente
        // vince — è il candidato più bello fra quelli leciti.
        const punti = new Map<Proposta, number>();
        for (const c of alternative) punti.set(c, gusto(c, prevVoicing, prevPrevVoicing, tones, parsed.degree));
        alternative.sort((a, b) => (punti.get(a) ?? 0) - (punti.get(b) ?? 0));

        let menoPeggio: Proposta = { v: voicing, inv };
        let menoPeggioEsito: EsitoVeto = esitoInCarica;
        const TETTO = 40; // ~60 ms nel caso peggiore, e solo sugli accordi che sbagliano
        // DIAGNOSI (spenta): `globalThis.__HT_RIP = 1` fa raccontare alla riparazione quante
        // alternative ha e quante ne sono pulite. Serve a distinguere «non c'era altra
        // strada» da «c'erano cinque strade e ha scelto male» — due situazioni che dal
        // risultato si confondono, e che chiedono interventi opposti.
        if ((globalThis as any).__HT_RIP) {
          let pulite = 0;
          for (const cand of alternative.slice(0, TETTO)) if (giudica(cand.v, cand.inv).quante === 0) pulite++;
          // eslint-disable-next-line no-console
          console.log(`  RIP b${chord.measure + 1}.${chord.beat}: ${alternative.length} alternative, ${pulite} pulite  [${esitoInCarica.regole.join(' ')}]`);
        }
        for (const cand of alternative.slice(0, TETTO)) {
          const e = giudica(cand.v, cand.inv);
          // «Pulita» vuol dire anche SENZA LICENZE: un'eccezione è ammessa, ma se c'è una
          // strada che non ne ha bisogno è quella la strada.
          if (e.quante === 0 && e.licenze === 0) { menoPeggio = cand; menoPeggioEsito = e; break; }
          // `confronta` mette gli errori prima degli avvisi: un'alternativa non si prende
          // solo perché ha MENO violazioni, se quelle poche sono più gravi.
          if (confronta(e, menoPeggioEsito) < 0) { menoPeggio = cand; menoPeggioEsito = e; }
        }

        // ── Secondo tentativo: IL PASSO INDIETRO ──
        // Solo se il primo non ha trovato una strada pulita, e solo se c'è un accordo prima
        // da rimettere in discussione (non la prima coppia, e non con basso dato: lì il basso
        // è scritto e cambiarlo vorrebbe dire riscrivere l'esercizio).
        const chordPrima = i >= 1 ? sortedProg[i - 1] : null;
        // `prevTones` serve a riscrivere l'accordo precedente. Se manca, quell'accordo è uno
        // di quelli TENUTI da una ripartenza: non è nostro da riscrivere, e il passo
        // indietro si ferma prima della giuntura invece di scavalcarla.
        if (config.passoIndietro !== false && menoPeggioEsito.quante > 0 && chordPrima && prevTones && prevPrevVoicing && prevPrevTones && prevChordNoteStart >= 0) {
          const fixedSopPrima = sopranoMap.get(`${chordPrima.measure}:${chordPrima.beat}`);
          const fixedBasPrima = bassMap.get(`${chordPrima.measure}:${chordPrima.beat}`);
          const fPrima = finestra(prevPrevVoicing, prevPrevVoicing, prevPrevTones, prevPrevInvUsed);
          // Le sostitute dell'accordo PRECEDENTE, in ordine di gusto.
          const altPrima = generaCandidati({
            tones: prevTones, inv: prevInvUsed,
            rivoltiDaProvare: rivoltiDi(chordPrima, prevInvUsed, prevTones, false),
            prevVoicing: prevPrevVoicing, inCarica: prevVoicing, rules,
            fixedSoprano: fixedSopPrima, fixedBass: fixedBasPrima,
            tonicPc: tonicPcVal, isLast: false, styleCtx,
          });
          const puntiPrima = new Map<Proposta, number>();
          for (const c of altPrima) puntiPrima.set(c, gusto(c, prevPrevVoicing, null, prevTones, parseRoman(chordPrima.roman).degree));
          altPrima.sort((a, b) => (puntiPrima.get(a) ?? 0) - (puntiPrima.get(b) ?? 0));

          const TETTO_INDIETRO = 12;  // sostitute dell'accordo prima
          const TETTO_AVANTI = 10;    // candidati di questo, per ciascuna
          let trovato: { prima: Proposta; ora: Proposta } | null = null;
          for (const prima of altPrima.slice(0, TETTO_INDIETRO)) {
            // La sostituta deve reggere il veto contro l'accordo ANCORA prima: altrimenti si
            // sposta il guasto indietro di una casella invece di toglierlo.
            const nuoveNotePrima = noteDi(prima.v, prevTones, prima.inv, fPrima.m, fPrima.b);
            const esitoPrima = veto(fPrima.passato, nuoveNotePrima, keySignature, tonic, isMinor);
            if (esitoPrima.quante > 0 || esitoPrima.licenze > 0) continue;
            // Con lei davanti, questo accordo si riscrive da capo.
            const fOra = finestra(prevPrevVoicing, prima.v, prevTones, prima.inv);
            const oraCand = generaCandidati({
              tones, inv, rivoltiDaProvare: rivoltiDi(chord, inv, tones, isLast),
              prevVoicing: prima.v, inCarica: null, rules, fixedSoprano, fixedBass, fixedAlto, fixedTenor,
              tonicPc: tonicPcVal, prevSeventhPc: prevSeventhPc ?? undefined, isLast, styleCtx,
            });
            const puntiOra = new Map<Proposta, number>();
            for (const c of oraCand) puntiOra.set(c, gusto(c, prima.v, prevPrevVoicing, tones, parsed.degree));
            oraCand.sort((a, b) => (puntiOra.get(a) ?? 0) - (puntiOra.get(b) ?? 0));
            for (const ora of oraCand.slice(0, TETTO_AVANTI)) {
              const eOra = giudica(ora.v, ora.inv, fOra);
              if (eOra.quante === 0 && eOra.licenze === 0) { trovato = { prima, ora }; break; }
            }
            if (trovato) break;
          }

          if (trovato) {
            // Si riscrive l'accordo precedente: note e violazioni. La macchina è la stessa
            // del backtracking interno — `prevChordNoteStart` dice dove ricominciare.
            allNotes.length = prevChordNoteStart;
            for (let vi = allViolations.length - 1; vi >= 0; vi--) {
              const v = allViolations[vi];
              if (v.measure === chordPrima.measure && v.beat === chordPrima.beat) allViolations.splice(vi, 1);
            }
            const durataPrima = beatsToDuration(
              chord.beat > chordPrima.beat && chord.measure === chordPrima.measure
                ? chord.beat - chordPrima.beat
                : beatsPerMeasure - chordPrima.beat + 1
            );
            allNotes.push(...voicingToStaffNotes(trovato.prima.v, chordPrima.measure, chordPrima.beat, durataPrima, prevTones, trovato.prima.inv, displayKeySignature, beatsPerMeasure));
            allViolations.push(...detectViolations(prevPrevVoicing, trovato.prima.v, chordPrima.measure, chordPrima.beat, rules));
            prevVoicing = trovato.prima.v;
            prevInvUsed = trovato.prima.inv;
            menoPeggio = trovato.ora;
            menoPeggioEsito = { quante: 0, errori: 0, avvisi: 0, licenze: 0, regole: [] };
            contiVeto.passiIndietro++;
          }
        }

        if (menoPeggio.v !== voicing || menoPeggio.inv !== inv) {
          voicing = menoPeggio.v;
          inv = menoPeggio.inv;
          if (menoPeggioEsito.quante === 0) contiVeto.risolti++;
          else contiVeto.migliorati++;
        }
      }
    }

    // Il veto ha cambiato l'accordo: le violazioni orizzontali registrate poco fa parlavano
    // di un accordo che non esiste più.
    if (prevVoicing && voicing !== vociPrimaDelVeto) {
      for (let vi = allViolations.length - 1; vi >= 0; vi--) {
        const v = allViolations[vi];
        if (v.measure === chord.measure && v.beat === chord.beat && !VERTICALI.has(v.type)) allViolations.splice(vi, 1);
      }
      allViolations.push(...detectViolations(prevVoicing, voicing, chord.measure, chord.beat, rules));
    }

    // Detect vertical violations (spacing, crossing, range) for EVERY chord including the first
    if (voicing.soprano - voicing.alto > 12) {
      allViolations.push({ type: 'spacing', description: 'Soprano-Alto exceeds an octave', measure: chord.measure, beat: chord.beat, voices: ['soprano', 'alto'] });
    }
    if (voicing.alto - voicing.tenor > 12) {
      allViolations.push({ type: 'spacing', description: 'Alto-Tenor exceeds an octave', measure: chord.measure, beat: chord.beat, voices: ['alto', 'tenor'] });
    }
    if (!rules.allowCrossing) {
      if (voicing.bass > voicing.tenor) allViolations.push({ type: 'voice-crossing', description: 'Bass crosses above tenor', measure: chord.measure, beat: chord.beat, voices: ['bass', 'tenor'] });
      if (voicing.tenor > voicing.alto) allViolations.push({ type: 'voice-crossing', description: 'Tenor crosses above alto', measure: chord.measure, beat: chord.beat, voices: ['tenor', 'alto'] });
      if (voicing.alto > voicing.soprano) allViolations.push({ type: 'voice-crossing', description: 'Alto crosses above soprano', measure: chord.measure, beat: chord.beat, voices: ['alto', 'soprano'] });
    }

    // Generate StaffNotes
    const noteStartIdx = allNotes.length; // track where this chord's notes begin
    const notes = voicingToStaffNotes(voicing, chord.measure, chord.beat, durationName, tones, inv, displayKeySignature, beatsPerMeasure);
    allNotes.push(...notes);

    // Il passo precedente può essere stato RISCRITTO dai due backtracking di sopra: quello
    // che vale è `prevVoicing`, non quello che si era registrato allora.
    if (passi.length > 0 && prevVoicing) {
      passi[passi.length - 1].voicing = prevVoicing;
      passi[passi.length - 1].inv = prevInvUsed;
    }
    passi.push({
      chord, voicing, inv, tones, durationName, fixedSoprano, fixedBass, fixedAlto, fixedTenor, isLast,
      degree: parsed.degree, noteStart: noteStartIdx,
    });

    prevPrevVoicing = prevVoicing;
    prevVoicing = voicing;
    prevChordNoteStart = noteStartIdx; // remember for next iteration's backtracking
    // Track seventh PC for next chord's resolution check
    prevSeventhPc = tones.length >= 4 ? toneToMidiPc(tones[3]) : null;
    prevPrevTones = prevTones;
    prevPrevInvUsed = prevInvUsed;
    prevTones = tones;
    prevInvUsed = inv;
  }

  // ── IL RIPASSO DELLE DISPOSIZIONI ───────────────────────────────────────────
  //
  // Il generatore scrive da sinistra a destra: quando sceglie come disporre un accordo,
  // quello DOPO non esiste ancora. Il veto ha una finestra di tre accordi, ma tutti e tre
  // già scritti — guarda indietro, mai avanti. Così una disposizione che era la migliore
  // rispetto a ciò che la precedeva può risultare la peggiore rispetto a ciò che la segue,
  // e nessuno se ne accorge più.
  //
  // Il ripasso ripercorre la progressione FINITA e per ogni accordo riprova le disposizioni,
  // giudicandole nelle DUE direzioni: l'accordo nuovo contro quello prima, e quello dopo
  // contro l'accordo nuovo. È l'idea che l'utente usa a mano nell'arpeggiatore — ciclare le
  // disposizioni su una progressione già scritta e tenere quella che suona meglio — con il
  // checker al posto dell'orecchio.
  //
  // Non cambia MAI l'armonia: gradi, rivolti ammessi, melodia data e basso dato restano
  // quelli. Cambia solo come le quattro voci si distribuiscono, e solo se il conto delle
  // violazioni MIGLIORA davvero (`confronta` stretto): a parità, non si tocca niente.
  if (config.ripasso !== false && config.vetoRegole !== false && passi.length >= 2) {
    // Gli stessi posti che usa il veto dentro il ciclo: movimenti forti consecutivi, così
    // che nessuna regola legata al tempo cambi risposta per colpa della collocazione.
    const battutePerMisura = timeSignature.numerator * (4 / timeSignature.denominator);
    const POSTI: [number, number][] = [[0, 1], [0, 3], [1, 1]];
    type Anello = { v: SATBVoicing; tn: ScaleDegreeNote[]; rv: number };

    /** Dispone una catena di al più tre accordi e giudica l'ULTIMO contro quelli prima. */
    const giudicaCatena = (catena: Anello[]): EsitoVeto => {
      const n = catena.length;
      if (n < 2) return { quante: 0, errori: 0, avvisi: 0, licenze: 0, regole: [] };
      const off = 3 - n;
      const gruppi = catena.map((g, k) =>
        voicingToStaffNotes(g.v, POSTI[off + k][0], POSTI[off + k][1], 'half', g.tn, g.rv, keySignature, 4));
      return veto(gruppi.slice(0, n - 1), gruppi[n - 1], keySignature, tonic, isMinor);
    };

    const somma = (a: EsitoVeto, b: EsitoVeto): EsitoVeto => ({
      quante: a.quante + b.quante,
      errori: a.errori + b.errori,
      avvisi: a.avvisi + b.avvisi,
      licenze: a.licenze + b.licenze,
      regole: [...a.regole, ...b.regole],
    });

    const anello = (p: Passo): Anello => ({ v: p.voicing, tn: p.tones, rv: p.inv });

    /** Il costo di scrivere l'accordo `i` come (v, rv): indietro E avanti. */
    const costo = (i: number, v: SATBVoicing, rv: number): EsitoVeto => {
      const qui: Anello = { v, tn: passi[i].tones, rv };
      const indietro: Anello[] = [];
      if (i >= 2) indietro.push(anello(passi[i - 2]));
      if (i >= 1) indietro.push(anello(passi[i - 1]));
      indietro.push(qui);
      const avanti: Anello[] = [];
      if (i + 1 < passi.length) {
        if (i >= 1) avanti.push(anello(passi[i - 1]));
        avanti.push(qui);
        avanti.push(anello(passi[i + 1]));
      }
      return somma(giudicaCatena(indietro), avanti.length > 0 ? giudicaCatena(avanti) : giudicaCatena([]));
    };

    for (let i = 0; i < passi.length; i++) {
      const p = passi[i];
      // L'ultimo accordo non ha un «dopo»: per lui il ripasso non saprebbe niente di nuovo.
      if (i === passi.length - 1) continue;
      // Con soprano E basso dati non c'è disposizione da scegliere: le voci interne sole
      // non fanno una ridisposizione, e ci pensa già il veto.
      if (p.fixedSoprano != null && p.fixedBass != null) continue;

      // SI RIPASSA SOLO DOVE C'È UN ERRORE VERO. Non basta che ci sia «qualcosa»: una
      // licenza già concessa, in un testo finito e sano, non è un guasto da riparare. Provato
      // a innescare anche sulle licenze e sugli avvisi: «Cantata 7» passava da ZERO errori a
      // SEI — il ripasso rimetteva mano a musica pulita e la rompeva.
      const attuale = costo(i, p.voicing, p.inv);
      if (attuale.errori === 0) continue;

      // I rivolti da riprovare sono quelli che il generatore stesso si sarebbe concessi:
      // se il rivolto è dell'utente resta suo.
      const rivolti = [p.inv];
      if (p.chord.inversion == null || p.chord.inversionIsSuggestion) {
        for (let k = 0; k < Math.min(p.tones.length, 4); k++) if (k !== p.inv) rivolti.push(k);
      }
      const prevP = i >= 1 ? passi[i - 1] : null;
      const prevSet = prevP ? prevP.voicing : p.voicing;
      const prev7 = prevP && prevP.tones.length >= 4 ? toneToMidiPc(prevP.tones[3]) : undefined;

      const alternative = generaCandidati({
        tones: p.tones, inv: p.inv, rivoltiDaProvare: rivolti,
        prevVoicing: prevSet, inCarica: p.voicing, rules,
        fixedSoprano: p.fixedSoprano, fixedBass: p.fixedBass,
        fixedAlto: p.fixedAlto, fixedTenor: p.fixedTenor,
        tonicPc: tonicPcVal, prevSeventhPc: prev7, isLast: p.isLast,
        styleCtx: config.styleProfile
          ? { styleProfile: config.styleProfile, currentDegree: degreeToRoman(p.degree, isMinor), currentInversion: p.inv }
          : {},
      });
      if (alternative.length === 0) continue;

      // In ordine di GUSTO, come nel veto: il punteggio stilistico fa la fila, il checker
      // dice chi passa. Ma qui il gusto si misura anche sull'accordo DOPO.
      const punti = new Map<Proposta, number>();
      for (const c of alternative) {
        punti.set(c, scoreVoicing({
          curr: c.v, prev: prevSet, prevPrev: i >= 2 ? passi[i - 2].voicing : null,
          rules, tonicPc: tonicPcVal, tones: p.tones,
          ...(config.styleProfile
            ? { styleProfile: config.styleProfile, currentDegree: degreeToRoman(p.degree, isMinor), currentInversion: c.inv }
            : {}),
        }));
      }
      alternative.sort((a, b) => (punti.get(a) ?? 0) - (punti.get(b) ?? 0));

      // E si cambia solo per TOGLIERE UN ERRORE. La finestra del ripasso è di tre accordi
      // messi in posti convenzionali: sugli errori (parallele, intervalli, incroci) la sua
      // risposta è la stessa che darà il brano intero, sugli avvisi no. Barattare un errore
      // con due avvisi qui vorrebbe dire fidarsi di una misura che in questa cornice non
      // regge.
      let meglio: Proposta | null = null;
      let meglioEsito = attuale;
      for (const cand of alternative.slice(0, 40)) {
        if (cand.v.soprano === p.voicing.soprano && cand.v.alto === p.voicing.alto
          && cand.v.tenor === p.voicing.tenor && cand.v.bass === p.voicing.bass) continue;
        const e = costo(i, cand.v, cand.inv);
        // Per SCOMODARE la scrittura serve un errore in meno. Ma una volta deciso di
        // cambiare, fra due strade che tolgono lo stesso errore si prende la più pulita:
        // lì `confronta` (errori, poi avvisi, poi licenze) è al suo posto.
        const megliora = meglio == null
          ? (e.errori < meglioEsito.errori && e.avvisi <= attuale.avvisi)
          : confronta(e, meglioEsito) < 0;
        if (megliora) { meglio = cand; meglioEsito = e; }
        if (meglioEsito.quante === 0 && meglioEsito.licenze === 0) break;
      }
      if (!meglio) continue;

      // Si riscrive: le note dell'accordo, e le violazioni orizzontali che lo riguardano.
      p.voicing = meglio.v;
      p.inv = meglio.inv;
      contiVeto.ripassati++;
    }

    // Le note si riscrivono in blocco alla fine: ogni accordo occupa un tratto contiguo di
    // `allNotes`, e `noteStart` dice dove comincia.
    if (contiVeto.ripassati > 0) {
      for (let i = passi.length - 1; i >= 0; i--) {
        const p = passi[i];
        const fine = i + 1 < passi.length ? passi[i + 1].noteStart : allNotes.length;
        const nuove = voicingToStaffNotes(p.voicing, p.chord.measure, p.chord.beat, p.durationName, p.tones, p.inv, displayKeySignature, battutePerMisura);
        allNotes.splice(p.noteStart, fine - p.noteStart, ...nuove);
      }
      // E le violazioni si rifanno da capo sui voicing definitivi — anche le VERTICALI,
      // che di un accordo ridisposto parlano di una disposizione che non esiste più.
      allViolations.length = 0;
      for (let i = 0; i < passi.length; i++) {
        const q = passi[i];
        if (i >= 1) allViolations.push(...detectViolations(passi[i - 1].voicing, q.voicing, q.chord.measure, q.chord.beat, rules));
        const v = q.voicing;
        if (v.soprano - v.alto > 12) allViolations.push({ type: 'spacing', description: 'Soprano-Alto exceeds an octave', measure: q.chord.measure, beat: q.chord.beat, voices: ['soprano', 'alto'] });
        if (v.alto - v.tenor > 12) allViolations.push({ type: 'spacing', description: 'Alto-Tenor exceeds an octave', measure: q.chord.measure, beat: q.chord.beat, voices: ['alto', 'tenor'] });
        if (!rules.allowCrossing) {
          if (v.bass > v.tenor) allViolations.push({ type: 'voice-crossing', description: 'Bass crosses above tenor', measure: q.chord.measure, beat: q.chord.beat, voices: ['bass', 'tenor'] });
          if (v.tenor > v.alto) allViolations.push({ type: 'voice-crossing', description: 'Tenor crosses above alto', measure: q.chord.measure, beat: q.chord.beat, voices: ['tenor', 'alto'] });
          if (v.alto > v.soprano) allViolations.push({ type: 'voice-crossing', description: 'Alto crosses above soprano', measure: q.chord.measure, beat: q.chord.beat, voices: ['alto', 'soprano'] });
        }
      }
    }
  }

  return { notes: allNotes, violations: allViolations, modulationContexts };
}

// ─── LA SCELTA SU TUTTA LA FRASE ─────────────────────────────────────────

/**
 * ARMONIZZARE UNA MELODIA È SCEGLIERE UN PERCORSO, NON UNA SEQUENZA DI MOSSE.
 *
 * Il generatore sceglieva un accordo per volta, guardando solo quello prima e sbirciando di
 * un passo. Una scelta golosa non può sapere che l'accordo comodo di adesso costringe a una
 * goffaggine fra tre note — e non può tornare indietro a disfarla. Ne uscivano progressioni
 * senza errori e senza vita: il quinto grado ribattuto per quattro battute, retrocessioni
 * `V → ii` messe lì perché in quel punto sembravano il meno peggio.
 *
 * Qui si sceglie il PERCORSO. Ogni nota della melodia ha i suoi accordi possibili, ciascuno
 * col suo basso; ogni coppia di accordi consecutivi ha il suo costo; e si tiene il cammino
 * di costo minimo su tutta la frase. «Cosa viene prima e cosa viene dopo» smette di essere
 * una sbirciatina e diventa la sostanza della decisione, perché il cammino è valutato
 * intero: un accordo scomodo adesso viene accettato se apre una strada migliore dopo, e uno
 * comodo viene scartato se porta in un vicolo cieco.
 *
 * Il conto è quello classico dei cammini minimi su una griglia (Viterbi): per ogni nota si
 * tiene, per ciascun accordo possibile, il costo del miglior cammino che ci arriva. Costa
 * quanto il numero di note per il quadrato degli accordi possibili — su un corale, qualche
 * centinaio di migliaia di somme, cioè niente.
 *
 * ── LE DUE VOCI DEL COSTO ─────────────────────────────────────────────────────────────
 *
 * **Quanto quell'accordo REGGE quella nota** (`costoDiPosa`): quante note del gruppo copre,
 * quanto quel grado è usato nel corpus, se il rivolto è di quelli che si scrivono liberamente
 * o di quelli che vogliono un'occasione — un 4/6 non è un rivolto come gli altri.
 *
 * **Quanto quel passaggio è MUSICA** (`costoDiPassaggio`): quanto è idiomatico andare da un
 * grado all'altro secondo il corpus, quanto si muove il basso, se una tonicizzazione mantiene
 * la promessa di risolvere sul proprio bersaglio.
 *
 * Le due si sommano lungo il cammino, e il cammino migliore è la progressione.
 */

/** Un accordo candidato per una nota: quale accordo e con che basso. */
type Posa = { acc: number; inv: number };

/** Quanto costa un rivolto in sé. La posizione fondamentale è la norma, il primo rivolto è
 *  di uso corrente, la quarta e sesta è un accordo che vuole un'occasione — e se la trova se
 *  la fa perdonare dal contesto (`scontoDellaQuartaSesta`). */
const COSTO_RIVOLTO = [0, 1.5, 6, 3];

/**
 * QUANTO È FORTE UN MOVIMENTO, da 0 a 1.
 *
 * Non è un dettaglio di contorno: metà delle regole dell'armonia parlano di tempo forte e
 * tempo debole, e finora il generatore non sapeva in che punto della battuta stesse
 * scrivendo. Il primo movimento porta la stanghetta ed è sempre forte; in un metro pari il
 * movimento di mezzo è forte a sua volta, ma meno; il resto è debole, e ciò che cade fra un
 * movimento e l'altro è più debole ancora.
 */
function forzaMetrica(beat: number, movPerBattuta: number): number {
  if (Math.abs(beat - Math.round(beat)) > 0.01) return 0.1;   // fra un movimento e l'altro
  const b = Math.round(beat);
  if (b === 1) return 1;
  if (movPerBattuta % 2 === 0 && b === movPerBattuta / 2 + 1) return 0.6;  // il mezzo, nei metri pari
  return 0.3;
}

/**
 * LO SCONTO CHE UN 4/6 SI GUADAGNA DAL CONTESTO.
 *
 * La quarta e sesta è l'accordo che più di ogni altro dipende da dove sta e da cosa lo segue.
 * Sono tre accordi diversi che si scrivono uguale:
 *
 *   CADENZALE     sul tempo forte, seguito dalla dominante: è la formula della cadenza,
 *                 e lì non solo è ammesso, è la scelta giusta;
 *   DI PASSAGGIO  sul tempo debole, col basso che ci entra e ne esce per grado: è una nota
 *                 di passaggio al basso vestita da accordo;
 *   NÉ L'UNO NÉ L'ALTRO  un accordo debole messo dove capita, che è quello che il
 *                 generatore scriveva prima di sapere che ora è.
 */
function scontoDellaQuartaSesta(forzaQui: number, gradoQui: number, gradoDopo: number, saltoDelBasso: number): number {
  // Cadenzale: sul BATTERE — non su un movimento mezzo forte, altrimenti diventa una
  // scappatoia buona sempre — e seguita dalla dominante.
  if (forzaQui >= 0.9 && gradoQui === 0 && gradoDopo === 4) return 6;
  // Di passaggio: sul tempo debole, col basso che ne esce per grado.
  if (forzaQui < 0.5 && saltoDelBasso > 0 && saltoDelBasso <= 2) return 4;
  return 0;
}

/** Un gruppo di melodia da armonizzare: le classi d'altezza che ci suonano sopra, e dove sta. */
type GruppoMelodia = {
  pcs: number[]; measure: number; beat: number; sopranoMidi?: number;
  /** La classe d'altezza del BASSO DATO su questo tempo, se c'è. Non è un'altra nota da
   *  coprire: è un vincolo duro, perché il basso dice anche il RIVOLTO. */
  bassoPc?: number;
};

/** Che cosa serve sapere di un accordo candidato, indipendentemente da dove si trova. */
type SchedaAccordo = {
  /** Le classi d'altezza dell'accordo (con la settima in coda, se ce l'ha). */
  pcs: number[];
  /** Quanto quel grado è usato nel corpus, nella scala 0…10 — sul tempo forte e sul debole,
   *  che sono due cose diverse: la dominante spinge dal debole, la tonica atterra sul forte. */
  peso: number;
  pesoForte: number;
  pesoDebole: number;
  /** Rivolti ammessi. */
  rivolti: number[];
  /** Se è una tonicizzazione, il grado su cui ha promesso di risolvere; altrimenti −1. */
  bersaglio: number;
  /** L'indice del grado diatonico (0…6), o −1 per le tonicizzazioni: serve alle transizioni,
   *  che il corpus conosce solo fra gradi diatonici. */
  gradoDiatonico: number;
};

const INFINITO = 1e9;

/**
 * Sceglie la progressione migliore per l'intera melodia.
 *
 * @returns per ogni gruppo, l'accordo e il rivolto scelti.
 */
function scegliProgressioneDellaFrase(args: {
  gruppi: GruppoMelodia[];
  schede: SchedaAccordo[];
  /** Quanto è forte il movimento su cui cade ciascun gruppo (0…1). */
  forze: number[];
  /** Per i gruppi che CHIUDONO una frase: i pesi dei gradi in quella chiusura. `null` per
   *  tutti gli altri. Antecedente e conseguente chiudono diversamente. */
  chiusure: (Record<number, number> | null)[];
  curaLaCondotta: boolean;
  /** Il costo scritto a mano fra due gradi, per quando il corpus è spento. */
  transizione: (da: number, a: number, forteArrivo: boolean) => number;
}): Posa[] {
  const { gruppi, schede, forze, chiusure, transizione, curaLaCondotta } = args;
  const n = gruppi.length;
  if (n === 0) return [];

  const bassoDi = (p: Posa) => 48 + schede[p.acc].pcs[p.inv % schede[p.acc].pcs.length];
  const chiusures = (i: number) => chiusure[i] ?? null;

  // ── Le pose possibili per ciascuna nota ──
  const posePerGruppo: Posa[][] = [];
  for (let i = 0; i < n; i++) {
    const pcs = gruppi[i].pcs;
    const pose: Posa[] = [];
    const bassoPc = gruppi[i].bassoPc;
    for (let a = 0; a < schede.length; a++) {
      const sc = schede[a];
      if (!pcs.some(pc => sc.pcs.includes(pc))) continue;
      // Una tonicizzazione non apre un brano e non lo chiude: è un accordo che PROMETTE.
      if (sc.bersaglio >= 0 && (i === 0 || i === n - 1)) continue;
      for (const inv of sc.rivolti) {
        // IL BASSO DATO NON È UNA PREFERENZA. Se c'è, l'accordo deve contenerlo E averlo
        // proprio al basso: il rivolto è già la scelta di quale nota ci va. Senza questo
        // filtro il basso veniva ignorato nella scelta dell'armonia e poi imposto nella
        // scrittura, e uscivano accordi con un basso che non gli appartiene — sul «Dubois
        // n5», con soprano e basso dati, un Fa-La-Do sopra un Mi al basso.
        if (bassoPc != null && sc.pcs[inv % sc.pcs.length] !== bassoPc) continue;
        pose.push({ acc: a, inv });
      }
    }
    // Se il basso dato non sta in nessun accordo diatonico (nota di passaggio al basso, o
    // cromatismo), il vincolo CADE per quel tempo invece di far fallire tutto: si riprovano
    // le pose senza di lui.
    if (pose.length === 0 && bassoPc != null) {
      for (let a = 0; a < schede.length; a++) {
        const sc = schede[a];
        if (!pcs.some(pc => sc.pcs.includes(pc))) continue;
        if (sc.bersaglio >= 0 && (i === 0 || i === n - 1)) continue;
        for (const inv of sc.rivolti) pose.push({ acc: a, inv });
      }
    }
    // Se nessun accordo copre la nota, resta la tonica: è il ripiego di sempre, e la vera
    // cura sta altrove (riconoscere che quella nota può NON essere nota d'accordo).
    posePerGruppo.push(pose.length ? pose : [{ acc: 0, inv: 0 }]);
  }

  /** QUANTO QUELL'ACCORDO REGGE QUELLA NOTA. Più basso, meglio è. */
  const costoDiPosa = (i: number, p: Posa): number => {
    const sc = schede[p.acc];
    const pcs = gruppi[i].pcs;
    const coperte = pcs.filter(pc => sc.pcs.includes(pc)).length;
    // Il peso del grado DOVE SI TROVA. Su una chiusura di frase comanda il modo in cui si
    // chiude — l'antecedente propone e sospende, il conseguente risponde e conclude —
    // altrove comanda il tempo forte o debole.
    const chiusura = chiusures(i);
    let c = chiusura && sc.gradoDiatonico >= 0
      ? -(chiusura[sc.gradoDiatonico] ?? 1)
      : -(forze[i] >= 0.5 ? sc.pesoForte : sc.pesoDebole);
    c -= (coperte / Math.max(1, pcs.length)) * 5;       // e quello che regge più note
    if (coperte === pcs.length) c -= 3;
    c += COSTO_RIVOLTO[p.inv] ?? 4;
    // Una cadenza vuole il tempo forte: chiudere su un movimento debole non è una chiusura.
    if (i === n - 1) c += (1 - forze[i]) * 6;
    // ── Cadenze: la frase deve chiudere ──
    if (i === n - 1) {
      // L'ultimo accordo è la tonica in posizione fondamentale, o non è una chiusura.
      c += sc.gradoDiatonico === 0 ? 0 : 20;
      c += p.inv === 0 ? 0 : 12;
    }
    if (i === n - 2) {
      // Il penultimo prepara: dominante, o sottodominante per la plagale.
      if (sc.gradoDiatonico === 4) c -= 6;
      else if (sc.gradoDiatonico === 3) c -= 2;
    }
    if (i === 0) {
      c += sc.gradoDiatonico === 0 ? -5 : 0;
    }
    return c;
  };

  /** QUANTO QUEL PASSAGGIO È MUSICA. Più basso, meglio è. */
  const costoDiPassaggio = (i: number, da: Posa, a: Posa): number => {
    const sda = schede[da.acc], sa = schede[a.acc];
    // Una tonicizzazione DEVE risolvere sul proprio bersaglio: è la promessa che fa.
    if (sda.bersaglio >= 0 && sa.gradoDiatonico !== sda.bersaglio) return INFINITO;
    let c = 0;
    if (sda.gradoDiatonico >= 0 && sa.gradoDiatonico >= 0) {
      c -= transizione(sda.gradoDiatonico, sa.gradoDiatonico, forze[i] >= 0.5);
    }
    // Ripetere lo stesso accordo: sciatto, SALVO quando a ripetersi è la melodia — lì
    // restare (cambiando semmai rivolto) è la soluzione naturale, e cambiare per forza
    // costringe a movimenti che non ci sono.
    if (da.acc === a.acc) {
      const primaPcs = gruppi[i - 1].pcs, oraPcs = gruppi[i].pcs;
      const melodiaFerma = curaLaCondotta && primaPcs.length === oraPcs.length
        && oraPcs.every(pc => primaPcs.includes(pc));
      if (!melodiaFerma) c += 4;
      else if (da.inv !== a.inv) c -= 1;   // sulla nota tenuta, muovere il basso è vita
    }
    // Il basso è una linea, non una successione di fondamentali: i salti si pagano.
    const salto = Math.abs(bassoDi(a) - bassoDi(da));
    const passo = Math.min(salto, 12 - (salto % 12));
    c += passo * 0.25;

    // IL 4/6 SI GIUDICA DA QUI, perché per sapere che accordo è bisogna vedere cosa lo
    // segue: il costo salato che ha preso nella posa gli viene restituito se è cadenzale
    // (tempo forte, seguito dalla dominante) o di passaggio (tempo debole, basso per grado).
    if (da.inv === 2 && sda.gradoDiatonico >= 0 && sa.gradoDiatonico >= 0) {
      c -= scontoDellaQuartaSesta(forze[i - 1], sda.gradoDiatonico, sa.gradoDiatonico, passo);
    }
    // NOTA. Qui starebbe la regola «sul tempo forte ci si aspetta un'armonia nuova, sul
    // debole l'armonia prosegue». È stata scritta e TOLTA dopo averla misurata: presuppone
    // che il ritmo armonico sia una SCELTA, e oggi non lo è — c'è un accordo per ogni nota
    // di melodia, quindi il generatore è obbligato a cambiare (o a ripetere) su ogni
    // movimento, forte o debole che sia. La regola finiva per combattere contro un vincolo
    // invece che guidare una scelta. Torna quando il ritmo armonico sarà libero, cioè quando
    // una nota potrà non essere nota d'accordo.
    return c;
  };

  // ── Cammini minimi ──
  const costo: number[][] = [];
  const daDove: number[][] = [];
  costo.push(posePerGruppo[0].map(p => costoDiPosa(0, p)));
  daDove.push(posePerGruppo[0].map(() => -1));
  for (let i = 1; i < n; i++) {
    const pose = posePerGruppo[i];
    const prima = posePerGruppo[i - 1];
    const riga: number[] = new Array(pose.length).fill(INFINITO);
    const via: number[] = new Array(pose.length).fill(0);
    for (let k = 0; k < pose.length; k++) {
      const posa = costoDiPosa(i, pose[k]);
      for (let j = 0; j < prima.length; j++) {
        const prec = costo[i - 1][j];
        if (prec >= INFINITO) continue;
        const t = costoDiPassaggio(i, prima[j], pose[k]);
        if (t >= INFINITO) continue;
        const tot = prec + t + posa;
        if (tot < riga[k]) { riga[k] = tot; via[k] = j; }
      }
    }
    costo.push(riga);
    daDove.push(via);
  }

  // ── Si ripercorre a ritroso il cammino migliore ──
  let k = 0;
  for (let j = 1; j < costo[n - 1].length; j++) if (costo[n - 1][j] < costo[n - 1][k]) k = j;
  const fuori: Posa[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    fuori[i] = posePerGruppo[i][k];
    k = daDove[i][k];
    if (k < 0 && i > 0) k = 0;
  }
  return fuori;
}

// ─── Auto-Harmonization ────────────────────────────────────────────────────

/**
 * Diatonic roman numerals for each degree in major and minor keys.
 * Used both for display and for chord-tone PC sets.
 */
const DIATONIC_ROMANS_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viio'] as const;
const DIATONIC_ROMANS_MINOR = ['i', 'iio', 'III', 'iv', 'V', 'VI', 'viio'] as const;

/**
 * Choose the best inversion for a chord to create a smooth bass line.
 *
 * Strategy:
 * - First and last chords: prefer root position (stable cadence points).
 * - Middle chords: pick the inversion whose bass PC is closest (by semitone distance)
 *   to the previous bass, preferring root position on ties.
 */
function chooseBestInversion(
  deg: number,
  triadPcSets: number[][],
  tonicPc: number,
  prevBassMidi: number,
  isFirst: boolean,
  isLast: boolean,
  // ── LE DUE VOCI ESTREME SI DECIDONO INSIEME ──
  //
  // Scegliere il rivolto vuol dire scegliere il BASSO. E il basso, insieme al soprano che
  // la melodia ha gia' fissato, forma la cornice del corale: e' fra quelle due voci che si
  // fanno le ottave e le quinte parallele, ed e' li' che si sentono.
  //
  // Questa funzione il soprano non lo guardava: sceglieva il basso piu' comodo da
  // raggiungere e basta. Il guaio e' che quando si arriva a mettere le voci interne il
  // danno e' fatto — soprano e basso sono entrambi gia' scritti, e le uniche due voci
  // ancora libere non c'entrano niente. Il punteggio le parallele le punisce (5000 punti
  // a testa, in `scoreVoicing`) ma non ha piu' nessuno da spostare: misurato sul Dubois,
  // dieci parallele su venti errori, TUTTE fra soprano e basso.
  //
  // Sapendo dove sta il soprano, adesso e prima, il basso si sceglie in modo che la
  // cornice regga. Senza questi due numeri si torna al comportamento di prima.
  sopranoPc: number = -1,
  prevSopranoPc: number = -1,
  sensibilePc: number = -1
): number {
  const pcs = triadPcSets[deg]; // [root, 3rd, 5th]

  // First/last chord → root position for stability
  if (isFirst || isLast || prevBassMidi < 0) return 0;

  // Try inversions 0, 1, 2 and pick the one with smoothest bass motion
  let bestInv = 0;
  let bestDist = Infinity;
  const prevPc = ((prevBassMidi % 12) + 12) % 12;

  /** Distanza in semitoni sul cerchio delle altezze. */
  const giro = (a: number, b: number) => { const d = Math.abs(a - b) % 12; return d > 6 ? 12 - d : d; };

  for (let inv = 0; inv < pcs.length; inv++) {
    const bassPc = pcs[inv];
    // Semitone distance (circular)
    let dist = Math.abs(bassPc - prevPc);
    if (dist > 6) dist = 12 - dist;

    // ── IL BASSO NON E' UNA MELODIA ──
    //
    // Qui comandava la «morbidezza»: si sceglieva il basso piu' vicino al precedente,
    // contando i semitoni. Ma il basso e' la fondazione dell'armonia, non una linea che
    // deve procedere per gradi: da Sol a Do ci sono cinque semitoni e da Sol a Mi tre,
    // quindi V→I in posizione fondamentale «costava» piu' di V→I6 — e usciva un brano di
    // primi rivolti, con la cadenza che scivola invece di appoggiare.
    //
    // Nella scrittura accademica la posizione fondamentale e' la norma; il rivolto si usa
    // per una RAGIONE — ammorbidire il basso dove serve, evitare un raddoppio storto, non
    // fare parallele. Quindi la fondamentale parte avvantaggiata, e la vicinanza pesa la
    // meta': resta un argomento, smette di essere l'unico.
    const costoRivolto = inv === 0 ? 0 : 2.5;
    const adjustedDist = dist * 0.5 + costoRivolto;

    // Il 6/4 e' un accordo DEBOLE: in scrittura accademica si usa in pochi casi precisi
    // (cadenzale, di passaggio, di volta), non come ripiego. La penalita' vale un paio di
    // semitoni di scomodita' del basso, ma deve restare molto sotto quella delle parallele
    // — se no, chiudendo le altre strade, il 6/4 diventa l'uscita di servizio e ci si
    // ritrova dieci secondi rivolti dove prima c'erano dieci parallele. E' successo: prima
    // taratura di questa funzione, avvisi da 10 a 27.
    const penalty64 = inv === 2 ? 10 : 0;

    // ── E ORA LA CORNICE ──
    let cornice = 0;
    if (sopranoPc >= 0) {
      // 1) Basso e soprano sulla stessa nota: dipende da QUALE nota.
      //
      //    Raddoppiare la FONDAMENTALE fra le due voci estreme e' il raddoppio normale
      //    dell'armonia a quattro parti — spesso e' proprio quello che si vuole. Punirlo
      //    e' stato il mio errore alla prima stesura: con la melodia sul Do, la posizione
      //    fondamentale del I costava piu' del primo rivolto, e usciva un brano con TUTTI
      //    i gradi di tonica in 6. Il banco non se n'era accorto perche' non e' una
      //    violazione: e' una bruttura, e le brutture non hanno un codice di regola.
      //
      //    Il divieto riguarda la SENSIBILE, che raddoppiata non ha piu' via d'uscita
      //    (deve salire in tutt'e due le voci, e non puo'). Raddoppiare la TERZA e' un
      //    ripiego che si accetta ma non si cerca.
      if (bassPc === sopranoPc) {
        if (bassPc === sensibilePc) cornice += 40;   // proibito
        else if (inv === 1) cornice += 5;            // terza raddoppiata: sconsigliato
        // fondamentale o quinta: nessuna penalita', e' scrittura normale
      }

      // 2) PARALLELE fra le voci estreme. Se l'intervallo fra basso e soprano era una
      //    quinta o un'ottava e resta lo stesso mentre tutt'e due si muovono, sono
      //    parallele: l'errore piu' grossolano dell'armonia a quattro parti, e quello che
      //    a valle nessuno puo' piu' correggere.
      if (prevSopranoPc >= 0 && prevPc >= 0) {
        const primaSop = prevSopranoPc !== sopranoPc;
        const primaBas = prevPc !== bassPc;
        if (primaSop && primaBas) {
          const prima = giro(prevSopranoPc, prevPc);
          const dopo = giro(sopranoPc, bassPc);
          if ((prima === 0 && dopo === 0) || (prima === 7 && dopo === 7) || (prima === 5 && dopo === 5)) {
            cornice += 60;
          }
        }
      }

      // 3) La sensibile al basso e' una scelta forte, non un ripiego: la si lascia
      //    disponibile, ma non la si prende per comodita' di movimento.
      if (bassPc === sensibilePc) cornice += 6;
    }

    if (adjustedDist + penalty64 + cornice < bestDist) {
      bestDist = adjustedDist + penalty64 + cornice;
      bestInv = inv;
    }
  }
  return bestInv;
}

/**
 * Get a representative bass MIDI pitch class for a given degree + inversion.
 * Returns a MIDI value in the bass range (octave 2-3) for distance comparisons.
 */
function bassMidiForInversion(
  _deg: number,
  inv: number,
  triadPcSets: number[][],
  _tonicPc: number
): number {
  const pcs = triadPcSets[_deg];
  const bassPc = pcs[inv % pcs.length];
  // Put it in octave 3 (MIDI 48-59) for consistent distance calculations
  return 48 + bassPc;
}

/**
 * Return the figured bass suffix for a given inversion (triads only).
 * @param inv  - 0=root, 1=first, 2=second
 * @param isSeventh - true for seventh chords (future use)
 */
function inversionSuffix(inv: number, isSeventh: boolean): string {
  if (isSeventh) {
    switch (inv) {
      case 0: return '7';
      case 1: return '6/5';
      case 2: return '4/3';
      case 3: return '4/2';
      default: return '7';
    }
  }
  switch (inv) {
    case 0: return '';
    case 1: return '6';
    case 2: return '6/4';
    default: return '';
  }
}

/**
 * Decide whether to add a seventh to a chord based on idiomatic tonal rules.
 *
 * @param deg - Scale degree (0-based: 0=I, 1=ii, etc.)
 * @param groupPcs - Soprano pitch classes in this harmonic slot.
 * @param seventhPc - The diatonic 7th PC for this degree.
 * @param isFirst - true if this is the first chord.
 * @param isLast - true if this is the last chord.
 * @param nextDeg - The degree of the next chord (-1 if unknown/last).
 * @param isMinor - true for minor key.
 * @returns true if a seventh should be added.
 */
function shouldUseSeventh(
  deg: number,
  groupPcs: number[],
  seventhPc: number,
  rootPc: number,
  isFirst: boolean,
  isLast: boolean,
  nextDeg: number,
  isMinor: boolean
): boolean {
  // Last chord: never add seventh (needs stability)
  if (isLast) return false;
  // First chord: only add seventh on V (dominant preparation rare but okay)
  if (isFirst && deg !== 4) return false;

  // V → always use seventh (V7 is the most idiomatic seventh chord)
  if (deg === 4) return true;

  // viio → use seventh (viio7 / viiø7) when not last
  if (deg === 6) return true;

  // ─── Primary motion rule ──────────────────────────────────────────
  // The 7th resolves naturally when the root moves by:
  //   • UP a 2nd  (interval +1 mod 7, e.g. IV→V, I→ii)
  //   • DOWN a 3rd (interval -2 mod 7 = +5, e.g. I→vi, V→iii)
  //   • UP a 4th  (interval +3 mod 7, e.g. ii→V, vi→ii, I→IV)
  // BUT only when the natural seventh is MINOR (10 semitones) or DIMINISHED (9).
  // Major sevenths (11 semi, e.g. Imaj7, IVmaj7) are not idiomatic in chorale style.
  if (nextDeg >= 0) {
    const interval = ((nextDeg - deg) % 7 + 7) % 7; // 0-6
    const isPrimaryMotion = interval === 1    // up a 2nd
                         || interval === 5    // down a 3rd (= up a 5th inv.)
                         || interval === 3;   // up a 4th
    if (isPrimaryMotion) {
      // Check the seventh's quality: minor=10, diminished=9, major=11
      const seventhInterval = ((seventhPc - rootPc) % 12 + 12) % 12;
      if (seventhInterval <= 10) return true; // minor (10) or diminished (9)
      // Major seventh (11) → skip
    }
  }

  // Specific named cases (kept for clarity, though mostly covered above):
  // ii → V (up 4th, already covered)
  // vi → ii or IV (up 3rd / down 3rd, already covered)

  // I, iii → NO automatic sevenths unless primary motion applies.
  // Imaj7, iiimaj7 are not idiomatic in chorale style.
  return false;
}

/**
 * Automatically choose a roman numeral progression that fits a given soprano melody.
 *
 * Algorithm:
 * 1. Build diatonic triad PC sets for all 7 degrees.
 * 2. For each melody note, find which degrees contain its PC.
 * 3. Score candidates using tonal preferences (I/IV/V bias, cadence patterns,
 *    avoidance of consecutive repetition, etc.).
 * 4. Return the best-scoring progression.
 *
 * @param melody  - Array of { midi, measure, beat } soprano constraint points.
 * @param tonic   - Key tonic (e.g. 'C', 'Bb').
 * @param isMinor - true for minor key.
 * @param harmonicRhythmBeats - Optional: how many beats each chord lasts.
 *        0 or undefined = one chord per melody note (default).
 *        e.g. 2 = one chord per half note, 4 = one per whole note.
 * @param beatsPerMeasure - Beats per measure (needed when harmonicRhythmBeats > 0). Default 4.
 * @returns Array of RomanChord entries matching the harmonic rhythm positions.
 */
export function autoHarmonize(
  melody: SopranoConstraint[],
  tonic: string,
  isMinor: boolean,
  harmonicRhythmBeats: number = 0,
  beatsPerMeasure: number = 4,
  /** `corpus: false` torna ai pesi scritti a mano; `condotta: false` toglie il trattamento
   *  della nota tenuta; `frase: false` torna alla scelta golosa, un accordo per volta.
   *  Servono al confronto. */
  opts?: {
    corpus?: boolean; condotta?: boolean; frase?: boolean;
    /** IL BASSO DATO, quando c'è ANCHE la melodia. Prima, con tutte e due le voci date,
     *  l'armonia si sceglieva dal solo soprano e il basso veniva imposto dopo: uscivano
     *  accordi con un basso estraneo. Il basso non è una nota in più da coprire — dice anche
     *  il RIVOLTO — quindi entra come vincolo duro sulle pose possibili. */
    bassoDato?: SopranoConstraint[];
  }
): RomanChord[] {
  if (melody.length === 0) return [];

  const tonicPc = noteNameToPc(tonic);
  const scale = buildScale(tonic, isMinor);
  const naturalScale = isMinor ? buildNaturalMinorScale(tonic) : scale;
  const romanLabels = isMinor ? DIATONIC_ROMANS_MINOR : DIATONIC_ROMANS_MAJOR;

  // Build PC sets for each diatonic triad (using natural minor for III, VI, iv in minor)
  const triadPcSets: number[][] = [];
  // Also build seventh PCs for each degree
  const seventhPcs: number[] = [];
  for (let deg = 0; deg < 7; deg++) {
    const useScale = isMinor && (deg !== 4 && deg !== 6) ? naturalScale : scale;
    const root = useScale[deg];
    const third = useScale[(deg + 2) % 7];
    const fifth = useScale[(deg + 4) % 7];
    const seventh = useScale[(deg + 6) % 7];
    triadPcSets.push([
      (tonicPc + root.semiFromRoot) % 12,
      (tonicPc + third.semiFromRoot) % 12,
      (tonicPc + fifth.semiFromRoot) % 12,
    ]);
    seventhPcs.push((tonicPc + seventh.semiFromRoot) % 12);
  }

  // QUANTO PESA CIASCUN GRADO. Prima era una tabella scritta a mano — I 10, V 9, IV 8,
  // vi 6 — che metteva le triadi primarie davanti a tutto. Il corpus del programma (380
  // armonizzazioni già analizzate, divise per modo) dice un'altra cosa: in maggiore `vi` e
  // `ii` valgono quanto `IV`, e in minore il quarto grado sta subito dietro la dominante.
  // Vedi `corpusProgressione.ts`, anche per come i due si mescolano quando il campione è
  // scarso. Il resto del punteggio — copertura, cadenze, monotonia — non cambia, e la scala
  // dei valori è la stessa di prima perché quei termini conservino il loro peso.
  const usaCorpus = opts?.corpus !== false;
  const curaLaCondotta = opts?.condotta !== false;
  const baseWeight: Record<number, number> = usaCorpus
    ? pesiDeiGradi(isMinor)
    : { 0: 10, 1: 5, 2: 2, 3: 8, 4: 9, 5: 6, 6: 3 };
  /** Quanto è consueto andare da un grado all'altro. Prima erano quattro casi scritti a
   *  mano (V→I, IV→V, ii→V, vi→ii/IV); ora sono tutte le coppie, col loro peso vero. */
  const transizione = (da: number, a: number, forteArrivo?: boolean): number =>
    usaCorpus ? bonusTransizione(isMinor, da, a, forteArrivo)
      : (da === 4 && a === 0 ? 5 : da === 3 && a === 4 ? 3 : da === 1 && a === 4 ? 3
        : da === 5 && (a === 1 || a === 3) ? 2 : 0);


  // ── GLI ACCORDI DI TONICIZZAZIONE ───────────────────────────────────
  // Fin qui il generatore conosceva sette triadi diatoniche e basta. Una nota di melodia
  // fuori scala non era coperta da nessun grado e finiva nel ramo di ripiego «nessun
  // candidato → metti I»: l'accordo di tonica sotto una nota cromatica, cioè il modo più
  // diretto di scrivere uno scontro. Misurato su 75 brani, era il primo addebito del
  // generatore, e tutto il suo passivo stava sulle melodie cromatiche.
  //
  // Nel corpus questi accordi valgono il 12% del totale in maggiore e il 9,6% in minore.
  // Il realizzatore li sa già scrivere (`parseRoman` legge `V/V`, `getChordTones` costruisce
  // la scala provvisoria del bersaglio, la grafia esce giusta): mancava solo che qualcuno
  // glieli PROPONESSE.
  //
  // Si accodano ai sette diatonici, così che tutto il resto — rivolti, basso, punteggio —
  // continui a lavorare per indice senza sapere che sono cambiati di numero.
  type Extra = { label: string; corpus: string; target: number; hasSeventh: boolean };
  const extra: Extra[] = [];
  /** Come si scrive il bersaglio dentro l'etichetta: `parseRoman` legge solo lettere romane,
   *  quindi niente `°` né `o` (un `V/iio` non verrebbe riconosciuto). */
  const BERSAGLIO_MAG = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
  const BERSAGLIO_MIN = ['i', 'ii', 'III', 'iv', 'V', 'VI', 'VII'];
  const nomeBersaglio = isMinor ? BERSAGLIO_MIN : BERSAGLIO_MAG;
  /** Come il corpus lo chiama, che è un'altra cosa (là il ° c'è). */
  const CORPUS_MAG = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
  const CORPUS_MIN = ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'VII'];
  const nomeCorpus = isMinor ? CORPUS_MIN : CORPUS_MAG;
  if (usaCorpus) {
    // Non si tonicizza la tonica (sarebbe la dominante di casa) né il settimo grado, che
    // essendo una triade diminuita non è una meta.
    for (const t of [1, 2, 3, 4, 5]) {
      const radiceBersaglio = triadPcSets[t][0];
      const radiceDom = (radiceBersaglio + 7) % 12;
      const triade = [radiceDom, (radiceDom + 4) % 12, (radiceDom + 7) % 12];
      const settima = (radiceDom + 10) % 12;
      // La versione senza e con settima sono due candidati distinti: coprono note diverse
      // della melodia, e la settima è spesso proprio la nota cromatica che serve.
      triadPcSets.push(triade);
      seventhPcs.push(settima);
      extra.push({ label: `V/${nomeBersaglio[t]}`, corpus: `V/${nomeCorpus[t]}`, target: t, hasSeventh: false });
      triadPcSets.push([...triade, settima]);
      seventhPcs.push(settima);
      extra.push({ label: `V7/${nomeBersaglio[t]}`, corpus: `V/${nomeCorpus[t]}`, target: t, hasSeventh: true });
    }
  }
  const PRIMO_EXTRA = 7;
  const datiExtra = (deg: number): Extra | null => (deg >= PRIMO_EXTRA ? extra[deg - PRIMO_EXTRA] ?? null : null);

  const n = melody.length;
  const result: RomanChord[] = [];
  let prevDeg = -1;

  // ── Group melody notes by harmonic rhythm slots ─────────────────────
  type MelodyGroup = {
    pcs: number[]; measure: number; beat: number; sopranoMidi?: number;
    /** Il basso DATO su questo tempo, se c'è: vincolo duro, non nota da coprire. */
    bassoPc?: number;
  };
  let groups: MelodyGroup[];

  if (harmonicRhythmBeats > 0) {
    // Convert each melody point to an absolute beat position
    const absBeat = (m: SopranoConstraint) => m.measure * beatsPerMeasure + (m.beat - 1);

    // Build groups: each covers `harmonicRhythmBeats` beats
    const groupMap = new Map<number, MelodyGroup>();
    for (const m of melody) {
      const ab = absBeat(m);
      const slotIndex = Math.floor(ab / harmonicRhythmBeats);
      if (!groupMap.has(slotIndex)) {
        const slotAbsBeat = slotIndex * harmonicRhythmBeats;
        const slotMeasure = Math.floor(slotAbsBeat / beatsPerMeasure);
        const slotBeat = (slotAbsBeat % beatsPerMeasure) + 1;
        groupMap.set(slotIndex, { pcs: [], measure: slotMeasure, beat: slotBeat });
      }
      const gr = groupMap.get(slotIndex)!;
      gr.pcs.push(((m.midi % 12) + 12) % 12);
      if (gr.sopranoMidi == null) gr.sopranoMidi = m.midi;
    }
    groups = [...groupMap.values()];
  } else {
    // One group per melody note (original behavior)
    groups = melody.map(m => ({
      pcs: [((m.midi % 12) + 12) % 12],
      measure: m.measure,
      beat: m.beat,
      // La nota VERA del soprano, non solo la sua classe: al moto fra le voci estreme serve
      // sapere se sale o scende, e una classe d'altezza non lo dice.
      sopranoMidi: m.midi,
    }));
  }

  // Il basso dato si appende ai gruppi: la DP lo legge come vincolo duro (accordo che lo
  // contiene E che ce l'ha al basso).
  if (opts?.bassoDato?.length) {
    const perTempo = new Map<string, number>();
    for (const b of opts.bassoDato) perTempo.set(`${b.measure}:${b.beat}`, ((b.midi % 12) + 12) % 12);
    for (const g of groups) {
      const pc = perTempo.get(`${g.measure}:${g.beat}`);
      if (pc != null) g.bassoPc = pc;
    }
  }

  const totalGroups = groups.length;

  // ── LA SCELTA SU TUTTA LA FRASE ─────────────────────────────────────
  // Invece di scegliere un accordo per volta si sceglie il PERCORSO migliore sull'intera
  // melodia: così «cosa viene prima e cosa viene dopo» decide davvero, invece di essere una
  // sbirciatina di un passo che non può far cambiare idea sul passato.
  if (opts?.frase !== false) {
    const pesiForte = usaCorpus ? pesiDeiGradi(isMinor, true) : baseWeight;
    const pesiDebole = usaCorpus ? pesiDeiGradi(isMinor, false) : baseWeight;
    const schede: SchedaAccordo[] = [];
    for (let deg = 0; deg < 7; deg++) {
      schede.push({
        pcs: triadPcSets[deg],
        peso: baseWeight[deg] ?? 1,
        pesoForte: pesiForte[deg] ?? 1,
        pesoDebole: pesiDebole[deg] ?? 1,
        rivolti: [0, 1, 2],
        bersaglio: -1,
        gradoDiatonico: deg,
      });
    }
    for (let e = 0; e < extra.length; e++) {
      const ex = extra[e];
      const ps = pesoSecondaria(isMinor, ex.corpus);
      schede.push({
        pcs: triadPcSets[PRIMO_EXTRA + e],
        peso: ps, pesoForte: ps, pesoDebole: ps,
        rivolti: ex.hasSeventh ? [0, 1, 2, 3] : [0, 1, 2],
        bersaglio: ex.target,
        gradoDiatonico: -1,
      });
    }
    // `beatsPerMeasure` è già i movimenti da un quarto per battuta.
    const movPerBattuta = beatsPerMeasure;
    const forze = groups.map(g => forzaMetrica(g.beat, movPerBattuta));

    // ── DOVE FINISCONO LE FRASI ──
    //
    // NON in gruppi fissi di quattro battute. L'analisi formale del corpus
    // (`scripts/analisi-formale.ts`, 167 esercizi accademici) dice che gli esercizi si
    // dividono in DUE METÀ: quelli di otto battute cadenzano a b4 e b8, quelli di sedici a
    // b8 e b16 — non a 4, 8, 12, 16. È il periodo, antecedente e conseguente, e la frase è
    // lunga la metà del brano, non quattro battute sempre. Con la griglia fissa il
    // generatore sbagliava la segmentazione su ogni brano di sedici battute, e su tutti
    // quelli di lunghezza non multipla di quattro — che sono la metà del corpus.
    //
    // Sotto le sei battute non c'è periodo: c'è una cadenza sola, quella finale, che ha già
    // la sua regola.
    const chiusureDeiGruppi: (Record<number, number> | null)[] = groups.map(() => null);
    const ultimaBattuta = groups.length ? Math.max(...groups.map(g => g.measure)) : 0;
    if (usaCorpus && ultimaBattuta + 1 >= 6) {
      const mezzo = (ultimaBattuta + 1) / 2;
      let finePrima = -1;
      for (let k = 0; k < groups.length; k++) if (groups[k].measure < mezzo) finePrima = k;
      // La fine della PRIMA metà è il punto che il generatore non sapeva riconoscere: lì il
      // corpus sospende (V al 20%) e concede i gradi deboli — il `vi` all'11%, che è dove
      // vive la cadenza d'inganno. La seconda metà conclude sulla tonica (72%), e per
      // l'ultimo accordo c'è già la regola della cadenza qui sotto.
      if (finePrima > 0 && finePrima < groups.length - 1) {
        chiusureDeiGruppi[finePrima] = pesiDiChiusura(isMinor, 'prima');
      }
    }

    const scelte = scegliProgressioneDellaFrase({
      gruppi: groups, schede, forze, chiusure: chiusureDeiGruppi, curaLaCondotta, transizione,
    });
    for (let i = 0; i < totalGroups; i++) {
      const { acc, inv } = scelte[i];
      const ex = datiExtra(acc);
      // La settima dei gradi diatonici resta una decisione a parte: dipende dalla nota di
      // melodia e da dove si va, non dal cammino.
      const useSeventh = ex ? ex.hasSeventh : shouldUseSeventh(
        acc, groups[i].pcs, seventhPcs[acc], triadPcSets[acc][0],
        i === 0, i === totalGroups - 1,
        i + 1 < totalGroups ? (datiExtra(scelte[i + 1].acc) ? -1 : scelte[i + 1].acc) : -1,
        isMinor,
      );
      const invUsato = Math.min(inv, useSeventh ? 3 : 2);
      result.push({
        roman: ex ? ex.label + inversionSuffix(invUsato, false)
          : romanLabels[acc] + inversionSuffix(invUsato, useSeventh),
        measure: groups[i].measure,
        beat: groups[i].beat,
        inversion: invUsato,
        inversionIsSuggestion: true,
      });
    }
    return result;
  }

  let prevBassMidi = -1;
  /** Se l'accordo precedente era una tonicizzazione, il grado che ha promesso. */
  let bersaglioAtteso = -1;
  // Track previous bass for smooth voice leading

  for (let i = 0; i < totalGroups; i++) {
    const group = groups[i];
    const groupPcs = group.pcs;

    // Find candidate degrees whose triad covers the group's PCs
    const candidates: { deg: number; score: number; coverage: number }[] = [];
    for (let deg = 0; deg < triadPcSets.length; deg++) {
      const pcs = triadPcSets[deg];
      // Count how many of the group's PCs are in this triad
      const covered = groupPcs.filter(pc => pcs.includes(pc)).length;
      if (covered === 0) continue;

      const ex = datiExtra(deg);
      if (ex) {
        // UNA TONICIZZAZIONE DEVE RISOLVERE. Un `V/V` che non è seguito dal V non è una
        // tonicizzazione, è una nota sbagliata con un nome altisonante: si propone solo se
        // il gruppo di melodia SUCCESSIVO può stare sopra il suo bersaglio.
        if (i + 1 >= totalGroups) continue;
        const pcsBersaglio = triadPcSets[ex.target];
        if (!groups[i + 1].pcs.some(pc => pcsBersaglio.includes(pc))) continue;
        // E non si apre un brano tonicizzando.
        if (i === 0) continue;
      }

      let score = ex ? pesoSecondaria(isMinor, ex.corpus) : (baseWeight[deg] ?? 1);

      // Coverage bonus: more melody notes covered = better fit
      score += (covered / groupPcs.length) * 5;

      // Bonus: if every melody PC in this group belongs to the chord
      if (covered === groupPcs.length) score += 3;

      // Penalty: same degree as previous chord → monotonous.
      //
      // MA NON QUANDO A RIPETERSI È LA MELODIA. Su una nota di soprano tenuta o ribattuta,
      // restare sullo stesso grado (cambiando semmai rivolto) è la soluzione naturale, e
      // punirla costringe a inventare un movimento che non c'è: sul Delachi n.12 il soprano
      // ribatte il Si sopra un V, e il generatore — non potendo restare — scendeva sul ii,
      // cioè una retrocessione. La ripetizione lì è della melodia, non sua.
      const melodiaFerma = curaLaCondotta && i > 0 && groups[i - 1].pcs.length === groupPcs.length
        && groupPcs.every(pc => groups[i - 1].pcs.includes(pc));
      if (deg === prevDeg && !melodiaFerma) score -= 4;
      // Chi arriva DOPO una tonicizzazione e ne è il bersaglio è la sua risoluzione: è
      // l'accordo che quella tonicizzazione ha promesso, e va mantenuta la promessa.
      if (bersaglioAtteso >= 0 && deg === bersaglioAtteso) score += 8;

      // ─── Cadential patterns ───────────────────────────────────────
      // Last chord should be I (or i)
      if (i === totalGroups - 1 && deg === 0) score += 8;
      if (i === totalGroups - 1 && deg !== 0) score -= 5;

      // Penultimate → prefer V (authentic cadence) or IV (plagal)
      if (i === totalGroups - 2 && deg === 4) score += 6;
      if (i === totalGroups - 2 && deg === 3) score += 3;

      // Quanto è consueto arrivare qui DA DOVE si viene. Con la melodia ferma sullo stesso
      // grado il conto non si applica: il corpus non ha ripetizioni (sono state tolte in
      // raccolta), quindi darebbe la penalità piena a una scelta che è invece corretta.
      if (prevDeg >= 0 && !(melodiaFerma && deg === prevDeg)) score += transizione(prevDeg, deg);

      // First chord → prefer I strongly
      if (i === 0 && deg === 0) score += 5;

      candidates.push({ deg, score, coverage: covered });
    }

    // If no candidate found (non-diatonic soprano?), default to I
    if (candidates.length === 0) {
      const invSopPc = groups[i].pcs.length ? groups[i].pcs[0] : -1;
      const invSopPrima = i > 0 && groups[i - 1].pcs.length ? groups[i - 1].pcs[0] : -1;
      const inv = chooseBestInversion(0, triadPcSets, tonicPc, prevBassMidi, i === 0, i === totalGroups - 1,
        invSopPc, invSopPrima, (tonicPc + 11) % 12);
      result.push({
        roman: romanLabels[0] + inversionSuffix(inv, false),
        measure: group.measure,
        beat: group.beat,
        inversion: inv,
        inversionIsSuggestion: true,
      });
      prevBassMidi = bassMidiForInversion(0, inv, triadPcSets, tonicPc);
      prevDeg = 0;
      continue;
    }

    // Pick highest score (break ties by coverage)
    candidates.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
    const best = candidates[0];

    // ─── Seventh decision ─────────────────────────────────────────────
    // Quick lookahead: peek at the next group to estimate next degree
    let nextDeg = -1;
    if (i + 1 < totalGroups) {
      const nextGroupPcs = groups[i + 1].pcs;
      let bestNextScore = -Infinity;
      for (let d = 0; d < 7; d++) {
        const pcs = triadPcSets[d];
        const cov = nextGroupPcs.filter(pc => pcs.includes(pc)).length;
        if (cov === 0) continue;
        let sc = (baseWeight[d] ?? 1) + (cov / nextGroupPcs.length) * 5;
        if (d === best.deg) sc -= 4; // penalize same as current
        if (i + 1 === totalGroups - 1 && d === 0) sc += 8; // last chord = I
        if (sc > bestNextScore) { bestNextScore = sc; nextDeg = d; }
      }
    }

    const exBest = datiExtra(best.deg);
    const useSeventh = exBest ? exBest.hasSeventh : shouldUseSeventh(
      best.deg, groupPcs, seventhPcs[best.deg], triadPcSets[best.deg][0],
      i === 0, i === totalGroups - 1, nextDeg, isMinor
    );

    const maxInv = useSeventh ? 3 : 2;
    // La nota del soprano su cui cade l'accordo: e' la prima del gruppo, cioe' quella che
    // suona insieme al basso che stiamo per scegliere. La sensibile e' il settimo grado
    // alzato — in minore vale comunque quella della scala armonica.
    const sopranoPc = groupPcs.length ? groupPcs[0] : -1;
    const sopranoPrimaPc = i > 0 && groups[i - 1].pcs.length ? groups[i - 1].pcs[0] : -1;
    const sensibilePc = (tonicPc + 11) % 12;
    const inv = chooseBestInversion(best.deg, triadPcSets, tonicPc, prevBassMidi, i === 0, i === totalGroups - 1,
      sopranoPc, sopranoPrimaPc, sensibilePc);
    // Clamp inversion to valid range for the chord type
    const clampedInv = Math.min(inv, maxInv);

    // L'etichetta di una tonicizzazione porta già la settima nel nome (`V7/vi`): il cifrato
    // che si aggiunge è solo quello del rivolto.
    result.push({
      roman: exBest ? exBest.label + inversionSuffix(clampedInv, false)
        : romanLabels[best.deg] + inversionSuffix(clampedInv, useSeventh),
      measure: group.measure,
      beat: group.beat,
      inversion: clampedInv,
      inversionIsSuggestion: true,
    });
    prevBassMidi = bassMidiForInversion(best.deg, clampedInv, triadPcSets, tonicPc);
    prevDeg = best.deg;
    bersaglioAtteso = exBest ? exBest.target : -1;
  }

  return result;
}

// ─── Auto-Harmonize From Bass ("Basso Dato") ──────────────────────────────

/**
 * Given a bass line (MIDI notes at specific measure/beat positions),
 * infer the most likely diatonic chord + inversion for each bass note.
 * Unlike autoHarmonize (which matches PCs against triads in general),
 * this function determines the chord based on the bass note's position
 * within each diatonic triad: root = inv 0, 3rd = inv 1, 5th = inv 2.
 */
export function autoHarmonizeFromBass(
  bassLine: SopranoConstraint[],
  tonic: string,
  isMinor: boolean,
  harmonicRhythmBeats: number = 0,
  beatsPerMeasure: number = 4
): RomanChord[] {
  if (bassLine.length === 0) return [];

  const tonicPc = noteNameToPc(tonic);
  const scale = buildScale(tonic, isMinor);
  const naturalScale = isMinor ? buildNaturalMinorScale(tonic) : scale;
  const romanLabels = isMinor ? DIATONIC_ROMANS_MINOR : DIATONIC_ROMANS_MAJOR;

  // Build PC sets for each diatonic triad
  const triadPcSets: number[][] = [];
  for (let deg = 0; deg < 7; deg++) {
    const useScale = isMinor && (deg !== 4 && deg !== 6) ? naturalScale : scale;
    const root = useScale[deg];
    const third = useScale[(deg + 2) % 7];
    const fifth = useScale[(deg + 4) % 7];
    triadPcSets.push([
      (tonicPc + root.semiFromRoot) % 12,
      (tonicPc + third.semiFromRoot) % 12,
      (tonicPc + fifth.semiFromRoot) % 12,
    ]);
  }

  // Tonal weights: prefer I, V, IV
  const baseWeight: Record<number, number> = {
    0: 10, 1: 5, 2: 2, 3: 8, 4: 9, 5: 6, 6: 3,
  };

  // Inversion preference: root position strongly preferred, 6/4 penalized
  const invWeight = [10, 6, -5]; // [root, 1st inv, 2nd inv (6/4)]

  // Group bass notes by harmonic rhythm
  type BassGroup = { pcs: number[]; measure: number; beat: number };
  let groups: BassGroup[];

  if (harmonicRhythmBeats > 0) {
    const absBeat = (m: SopranoConstraint) => m.measure * beatsPerMeasure + (m.beat - 1);
    const groupMap = new Map<number, BassGroup>();
    for (const m of bassLine) {
      const ab = absBeat(m);
      const slotIndex = Math.floor(ab / harmonicRhythmBeats);
      if (!groupMap.has(slotIndex)) {
        const slotAbsBeat = slotIndex * harmonicRhythmBeats;
        const slotMeasure = Math.floor(slotAbsBeat / beatsPerMeasure);
        const slotBeat = (slotAbsBeat % beatsPerMeasure) + 1;
        groupMap.set(slotIndex, { pcs: [], measure: slotMeasure, beat: slotBeat });
      }
      groupMap.get(slotIndex)!.pcs.push(m.midi % 12);
    }
    groups = [...groupMap.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  } else {
    groups = bassLine.map(m => ({ pcs: [m.midi % 12], measure: m.measure, beat: m.beat }));
  }

  const result: RomanChord[] = [];
  let prevDeg = -1;
  const totalGroups = groups.length;

  for (let i = 0; i < totalGroups; i++) {
    const group = groups[i];
    // Use first (or most common) PC as the bass pitch class
    const bassPc = group.pcs[0];

    // Find all candidates: which degree has this PC as root/3rd/5th?
    type Candidate = { deg: number; inv: number; score: number };
    const candidates: Candidate[] = [];

    for (let deg = 0; deg < 7; deg++) {
      const pcs = triadPcSets[deg];
      let inv = -1;
      if (pcs[0] === bassPc) inv = 0; // root position
      else if (pcs[1] === bassPc) inv = 1; // 1st inversion
      else if (pcs[2] === bassPc) inv = 2; // 2nd inversion
      if (inv < 0) continue;

      let score = (baseWeight[deg] ?? 1) + (invWeight[inv] ?? 0);

      // Penalize repeating same degree
      if (deg === prevDeg) score -= 3;

      // Cadential bonuses
      if (i === totalGroups - 1 && deg === 0) score += 12; // end on I
      if (i === totalGroups - 2 && deg === 4) score += 8; // penultimate V
      // Penalize 6/4 except cadential I6/4 before V
      if (inv === 2) {
        if (deg === 0 && i + 1 < totalGroups) {
          // Check if next bass is V (dominant) — then cadential I6/4 is OK
          const nextPc = groups[i + 1].pcs[0];
          const dominantRoot = triadPcSets[4][0];
          if (nextPc === dominantRoot) score += 8; // cadential 6/4 bonus
        }
      }

      candidates.push({ deg, inv, score });
    }

    if (candidates.length === 0) {
      // Fallback: I root position
      result.push({ roman: romanLabels[0], measure: group.measure, beat: group.beat, inversion: 0, inversionIsSuggestion: true });
      prevDeg = 0;
      continue;
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    result.push({
      roman: romanLabels[best.deg] + inversionSuffix(best.inv, false),
      measure: group.measure,
      beat: group.beat,
      inversion: best.inv,
      inversionIsSuggestion: true,
    });
    prevDeg = best.deg;
  }

  return result;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Convert beat duration to a NoteDuration name. */
function beatsToDuration(beats: number): string {
  if (beats >= 4) return 'whole';
  if (beats >= 2) return 'half';
  if (beats >= 1) return 'quarter';
  if (beats >= 0.5) return 'eighth';
  if (beats >= 0.25) return 'sixteenth';
  return 'quarter';
}

/** Build a KeySignature from tonic + mode (mirrors getKeySignature from musicTheory). */
function buildKeySignature(tonic: string, isMinor: boolean): KeySignature {
  // Sharp keys: C G D A E B F#/Gb (count of sharps)
  const SHARP_KEYS: Record<string, number> = {
    C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  };
  // Flat keys: F Bb Eb Ab Db Gb Cb (count of flats)
  const FLAT_KEYS: Record<string, number> = {
    F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7,
  };

  // Minor → find relative major
  let majorKey = tonic;
  if (isMinor) {
    const minorPc = noteNameToPc(tonic);
    const relMajorPc = (minorPc + 3) % 12;
    // Find the standard spelling
    const majorNames: Record<number, string> = {
      0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
      6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
    };
    // Some minor keys use sharp majors
    const sharpMajors = new Set(['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#']);
    if (sharpMajors.has(tonic)) {
      const sharpNames: Record<number, string> = {
        0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F',
        6: 'F#', 7: 'G', 8: 'G#', 9: 'A', 10: 'A#', 11: 'B',
      };
      majorKey = sharpNames[relMajorPc] ?? majorNames[relMajorPc] ?? 'C';
    } else {
      majorKey = majorNames[relMajorPc] ?? 'C';
    }
  }

  if (SHARP_KEYS[majorKey] !== undefined) {
    return { type: 'sharp', count: SHARP_KEYS[majorKey] };
  }
  if (FLAT_KEYS[majorKey] !== undefined) {
    return { type: 'flat', count: FLAT_KEYS[majorKey] };
  }

  // Fallback: no accidentals
  return { type: 'sharp', count: 0 };
}
