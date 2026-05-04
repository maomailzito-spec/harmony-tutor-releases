/**
 * parseChordSymbol.ts
 *
 * Parser di sigle accordali assolute (es. "Dbm7/F") → note SATB prodotte dal
 * motore del generatore di corali (realizeFirstChord), con rispetto dei range
 * vocali, raddoppi corretti e regole armoniche di base.
 *
 * Uso:
 *   const parsed = parseChordSymbol("Dbm7/F");
 *   if (parsed) {
 *     const notes = buildChordSATBNotes(parsed, measureIndex, beat, startTick, duration, durationTicks, keySignature);
 *     setRawNotes(prev => [...prev, ...notes]);
 *   }
 */

import { CHORD_FORMULAS } from '../constants';
import { BuiltInChords } from '../types';
import type { StaffNote, KeySignature, NoteDuration } from '../types';
import { getNotePropertiesFromMidi } from './musicTheory';
import { realizeFirstChord, realizeNextChord } from '../engine/choralRealization';
import type { ScaleDegreeNote, ChoralRules, SATBVoicing } from '../engine/choralRealization';

/** Trova il tone nell'array che corrisponde alla pitch class del MIDI dato. */
function findToneForMidiPc(midi: number, tones: ScaleDegreeNote[], rootPc: number): ScaleDegreeNote | null {
    const pc = ((midi % 12) + 12) % 12;
    return tones.find(t => ((rootPc + t.semiFromRoot) % 12 + 12) % 12 === pc) ?? null;
}

/** Preferenza enarmonica corretta da un ScaleDegreeNote.
 * Gestisce anche doppi accidentali (bb → flat, ## → sharp). */
function preferredAccidentalFromTone(tone: ScaleDegreeNote | null): 'flat' | 'sharp' | null {
    if (!tone) return null;
    if (tone.accidental.length > 0 && tone.accidental[0] === 'b') return 'flat';
    if (tone.accidental.length > 0 && tone.accidental[0] === '#') return 'sharp';
    return null;
}

export interface ParsedChordSymbol {
    rootPc: number;        // 0-11
    rootName: string;      // es. "Db"
    intervals: number[];   // da CHORD_FORMULAS, es. [0,3,7,10]
    chordType: string;     // es. "Minor 7"
    bassPc: number | null; // null = root position
    bassName: string | null;
    label: string;         // input originale es. "Dbm7/F"
}

// Mappa nome nota → pitch class (standard: C4=60, pc=midi%12)
const NOTE_TO_PC: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4,
    'F': 5, 'E#': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11, 'Cb': 11, 'B#': 0,
};

// Mappa qualità (notazione reale) → ChordType interno
const QUALITY_MAP: Record<string, string> = {
    // Triadi
    '':      BuiltInChords.Major,
    'maj':   BuiltInChords.Major,
    'M':     BuiltInChords.Major,
    'm':     BuiltInChords.Minor,
    'min':   BuiltInChords.Minor,
    '-':     BuiltInChords.Minor,
    'aug':   BuiltInChords.Augmented,
    '+':     BuiltInChords.Augmented,
    'dim':   BuiltInChords.Diminished,
    '°':     BuiltInChords.Diminished,
    // Accordi di 7a
    '7':     BuiltInChords.Dominant7,
    'dom7':  BuiltInChords.Dominant7,
    'maj7':  BuiltInChords.Major7,
    'M7':    BuiltInChords.Major7,
    'Δ7':    BuiltInChords.Major7,
    'Δ':     BuiltInChords.Major7,
    'ma7':   BuiltInChords.Major7,
    'm7':    BuiltInChords.Minor7,
    'min7':  BuiltInChords.Minor7,
    '-7':    BuiltInChords.Minor7,
    'mMaj7': BuiltInChords.MinorMajor7,
    'mmaj7': BuiltInChords.MinorMajor7,
    'mM7':   BuiltInChords.MinorMajor7,
    'dim7':  BuiltInChords.Diminished7,
    '°7':    BuiltInChords.Diminished7,
    'm7b5':  BuiltInChords.Minor7b5,
    'm7♭5':  BuiltInChords.Minor7b5,
    'ø7':    BuiltInChords.Minor7b5,
    'ø':     BuiltInChords.Minor7b5,
    // Sus
    'sus2':  BuiltInChords.Sus2,
    'sus4':  BuiltInChords.Sus4,
    'sus':   BuiltInChords.Sus4,
    // 6e
    '6':     BuiltInChords.Major6,
    'maj6':  BuiltInChords.Major6,
    'm6':    BuiltInChords.Minor6,
    // 9e
    '9':     BuiltInChords.Dominant9,
    'maj9':  BuiltInChords.Major9,
    'm9':    BuiltInChords.Minor9,
    'add9':  BuiltInChords.Add9,
    'add2':  BuiltInChords.Add9,
    'madd9': BuiltInChords.MinorAdd9,
    // Alterazioni
    '7b9':   BuiltInChords.Dominant7b9,
    '7♭9':   BuiltInChords.Dominant7b9,
    '7#9':   BuiltInChords.Dominant7sharp9,
    '7♯9':   BuiltInChords.Dominant7sharp9,
    // 11e / 13e
    '11':    BuiltInChords.Dominant11,
    'm11':   BuiltInChords.Minor11,
    '7#11':  BuiltInChords.Dominant7sharp11,
    '7♯11':  BuiltInChords.Dominant7sharp11,
    '13':    BuiltInChords.Dominant13,
    'm13':   BuiltInChords.Minor13,
    'maj13': BuiltInChords.Major13,
    '7b13':  BuiltInChords.Dominant7b13,
    '7♭13':  BuiltInChords.Dominant7b13,
};

/**
 * Analizza una sigla accordale e ritorna i dati strutturati, oppure null se
 * la sigla non è riconoscibile.
 *
 * Formato: [Radice][Qualità][/Basso]
 * Esempi: "C", "Cm", "Cmaj7", "Db7", "F#m7b5", "Bb/D"
 */
export function parseChordSymbol(input: string): ParsedChordSymbol | null {
    const s = input.trim();
    if (!s) return null;

    // Normalizza accidentali unicode
    const normalized = s.replace(/♭/g, 'b').replace(/♯/g, '#');

    // Estrai radice: lettera A-G seguita opzionalmente da # o b
    const rootMatch = normalized.match(/^([A-G][#b]?)/);
    if (!rootMatch) return null;

    const rootName = rootMatch[1];
    const rootPc = NOTE_TO_PC[rootName];
    if (rootPc === undefined) return null;

    let rest = normalized.slice(rootMatch[0].length);

    // Estrai nota basso dopo / (es. /F, /Eb)
    let bassPc: number | null = null;
    let bassName: string | null = null;
    const slashIdx = rest.lastIndexOf('/');
    if (slashIdx !== -1) {
        const bassStr = rest.slice(slashIdx + 1).trim();
        const bassMatch = bassStr.match(/^([A-G][#b]?)/);
        if (bassMatch) {
            const bn = bassMatch[1];
            const bpc = NOTE_TO_PC[bn];
            if (bpc !== undefined) {
                bassName = bn;
                bassPc = bpc;
                rest = rest.slice(0, slashIdx);
            }
        }
    }

    const quality = rest.trim();

    // Cerca corrispondenza esatta nella mappa
    let chordType = QUALITY_MAP[quality];

    // Fallback: confronto case-insensitive
    if (chordType === undefined) {
        const lq = quality.toLowerCase();
        for (const [k, v] of Object.entries(QUALITY_MAP)) {
            if (k.toLowerCase() === lq) {
                chordType = v;
                break;
            }
        }
    }

    if (chordType === undefined) return null;

    const formula = (CHORD_FORMULAS as any)[chordType] as number[] | undefined;
    if (!formula || formula.length === 0) return null;

    return {
        rootPc,
        rootName,
        intervals: formula,
        chordType,
        bassPc,
        bassName,
        label: s,
    };
}

/**
 * Trova il MIDI più vicino a `target` per la pitch class `pc`.
 */
function nearestMidi(pc: number, target: number): number {
    const norm = ((pc % 12) + 12) % 12;
    let candidate = norm;
    while (candidate < 36) candidate += 12;
    let best = candidate;
    let bestDist = Math.abs(candidate - target);
    while (candidate <= 96) {
        const dist = Math.abs(candidate - target);
        if (dist < bestDist) { bestDist = dist; best = candidate; }
        candidate += 12;
    }
    return best;
}

// Mappa diatonica semitoni da C
const LETTER_TO_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DIATONIC = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Ritorna il grado diatonico corretto per un intervallo, considerando
 * il contesto degli altri intervalli (necessario per risolvere ambiguità):
 *  - semi=1: sempre grado 1 (b9/b2 = Db, mai #1 nelle formule accordali)
 *  - semi=6: grado 3 (A4 = F#, se P5 presente) o grado 4 (d5 = Gb, altrimenti)
 *  - semi=8: grado 5 (b13 = Ab, se P5 presente) o grado 4 (A5 = G#, altrimenti)
 */
function semiToDegree(semi: number, allSemis: number[]): number {
    const n = ((semi % 12) + 12) % 12;
    const hasP5 = allSemis.some(s => ((s % 12) + 12) % 12 === 7);
    switch (n) {
        case 0:  return 0; // R
        case 1:  return 1; // b9/b2 = Db (mai #1 in accordi)
        case 2:  return 1; // 9/M2 = D
        case 3:  return 2; // m3
        case 4:  return 2; // M3
        case 5:  return 3; // P4/11
        case 6:  return hasP5 ? 3 : 4; // #11(F#) se c'è P5, altrimenti d5(Gb)
        case 7:  return 4; // P5
        case 8:  return hasP5 ? 5 : 4; // b13(Ab) se c'è P5, altrimenti #5(G#)
        case 9:  return 5; // M6/13
        case 10: return 6; // m7
        case 11: return 6; // M7
        default: return 0;
    }
}

/**
 * Costruisce un array di ScaleDegreeNote dagli intervals del parser.
 * Per ogni semitono di intervallo sceglie la lettera/accidentale più naturale
 * nel contesto della radice e degli altri intervalli presenti.
 */
function buildScaleDegreeNotes(rootName: string, intervals: number[]): ScaleDegreeNote[] {
    const rootLetter = rootName.charAt(0).toUpperCase();
    const rootAccidental = rootName.slice(1);
    const rootLetterSemi = LETTER_TO_SEMI[rootLetter] ?? 0;
    const accShift = rootAccidental.split('').reduce((a, c) => a + (c === '#' ? 1 : c === 'b' ? -1 : 0), 0);
    const rootPc = ((rootLetterSemi + accShift) % 12 + 12) % 12;
    const rootLetterIdx = DIATONIC.indexOf(rootLetter);

    return intervals.map(semi => {
        const normSemi = ((semi % 12) + 12) % 12;
        const degreeOffset = semiToDegree(normSemi, intervals);

        const li = (rootLetterIdx + degreeOffset) % 7;
        const letter = DIATONIC[li];
        const naturalSemi = LETTER_TO_SEMI[letter] ?? 0;
        const targetPc = (rootPc + normSemi) % 12;
        let diff = (targetPc - naturalSemi + 12) % 12;
        if (diff > 6) diff -= 12;
        let accidental = '';
        if (diff === 1) accidental = '#';
        else if (diff === 2) accidental = '##';
        else if (diff === -1) accidental = 'b';
        else if (diff === -2) accidental = 'bb';

        return { letter, accidental, semiFromRoot: semi, degree: degreeOffset };
    });
}

/**
 * Riduce un array di tones a 4, omettendo le note meno importanti secondo le
 * convenzioni armoniche standard per la scrittura a 4 parti:
 * - Accordi con 7a + estensione (9a, 13a): ometti la quinta (semiFromRoot=7)
 * - Accordi di 11a: ometti la quinta; se ancora 5+, ometti la terza
 * - Accordi di 3 note o meno: raddoppia la fondamentale
 */
function reduceTo4Tones(tones: ScaleDegreeNote[]): ScaleDegreeNote[] {
    if (tones.length <= 4) return tones;
    // Ometti la quinta giusta (semiFromRoot=7) — la meno importante nelle estensioni.
    // NON omettere semi=8 (b13 o #5) perché è la nota caratteristica di quegli accordi.
    let reduced = tones.filter(t => t.semiFromRoot !== 7);
    if (reduced.length > 4) {
        // Se ancora troppi (es. 11a con R,3,5,7,9,11): ometti anche la terza
        reduced = reduced.filter(t => t.semiFromRoot !== 3 && t.semiFromRoot !== 4);
    }
    if (reduced.length > 4) reduced = reduced.slice(0, 4);
    if (reduced.length < 3) return tones.slice(0, 4);
    if (reduced.length === 3) reduced = [reduced[0], ...reduced];
    return reduced;
}

const DEFAULT_CHORAL_RULES: ChoralRules = {
    allowParallel5ths: false,
    allowParallel8ves: false,
    allowCrossing: false,
    allowOverlap: false,
    doubleRoot: true,
};

/**
 * Costruisce 4 StaffNote in disposizione SATB usando il motore del generatore
 * di corali (realizeFirstChord), che rispetta:
 * - range vocali canonici (S: C4–G5, A: G3–D5, T: C3–G4, B: E2–C4)
 * - raddoppio della fondamentale nei triadi
 * - nessun incrocio di voci
 * - spaziatura corretta
 *
 * Se realizeFirstChord non trova un voicing valido, cade back alla
 * distribuzione semplice precedente.
 */
export function buildChordSATBNotes(
    parsed: ParsedChordSymbol,
    measureIndex: number,
    beat: number,
    startTick: number,
    duration: NoteDuration,
    durationTicks: number,
    keySignature: KeySignature,
    prevVoicing?: SATBVoicing | null,
): StaffNote[] {
    const { rootPc, rootName, intervals, bassPc } = parsed;

    // Costruisce le ScaleDegreeNote per il motore corale
    const tonesAll = buildScaleDegreeNotes(rootName, intervals);
    // Riduce a 4 voci con omissioni armonicamente corrette (omette la quinta per 9e/13e)
    const tones = reduceTo4Tones(tonesAll);

    // Determina l'inversion dal bassPc (slash chord)
    let inversion = 0;
    if (bassPc !== null) {
        const pcs = intervals.map(i => ((rootPc + i) % 12 + 12) % 12);
        const bassIdx = pcs.findIndex(pc => pc === bassPc);
        if (bassIdx > 0) inversion = bassIdx;
    }

    // Chiama il motore corale — con voice leading se c'è un voicing precedente
    const voicing = prevVoicing
        ? realizeNextChord(tones, inversion, prevVoicing, DEFAULT_CHORAL_RULES)
        : realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES);

    const makeNote = (midi: number, voice: number, clef: 'treble' | 'bass'): StaffNote => {
        const tone = findToneForMidiPc(midi, tones, rootPc);
        const preferred = preferredAccidentalFromTone(tone);
        const props = getNotePropertiesFromMidi(midi, keySignature, clef, preferred);
        return {
            id: crypto.randomUUID(),
            ...props,
            duration,
            durationTicks,
            isRest: false,
            isTriplet: false,
            isDuplet: false,
            measureIndex,
            beat,
            startTick,
            voice: voice as any,
            clef,
        } as StaffNote;
    };

    if (voicing) {
        return [
            makeNote(voicing.soprano, 1, 'treble'),
            makeNote(voicing.alto,    2, 'treble'),
            makeNote(voicing.tenor,   3, 'treble'),
            makeNote(voicing.bass,    4, 'bass'),
        ];
    }

    // Fallback: distribuzione semplice se il motore non trova voicing
    const pcs = Array.from(new Set(intervals.map(i => ((rootPc + i) % 12 + 12) % 12)));
    const len = pcs.length;
    const bassNotePc = bassPc !== null ? bassPc : pcs[0];
    const bassMidi  = nearestMidi(bassNotePc, 48);
    const tenorMidi = nearestMidi(pcs[2 % len], bassMidi + 7);
    const altoMidi  = nearestMidi(pcs[1 % len], bassMidi + 16);
    const sopMidi   = nearestMidi(pcs[(len >= 4 ? 3 : 0)], bassMidi + 24);
    const finalTenor = Math.max(bassMidi + 2, tenorMidi);
    const finalAlto  = Math.max(finalTenor + 1, altoMidi);
    const finalSop   = Math.max(finalAlto + 1, sopMidi);

    return [
        makeNote(finalSop,   1, 'treble'),
        makeNote(finalAlto,  2, 'treble'),
        makeNote(finalTenor, 3, 'treble'),
        makeNote(bassMidi,   4, 'bass'),
    ];
}
