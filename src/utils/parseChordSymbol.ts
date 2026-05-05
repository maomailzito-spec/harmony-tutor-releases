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
import { getNotePropertiesFromMidi, calculateAccidentalWithMeasureContext, calculateAccidental } from './musicTheory';
import { realizeFirstChord, realizeNextChord, voicingToStaffNotes, noteNameToPc } from '../engine/choralRealization';
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
// Posizione diatonica relativa a C4=0 (uguale a getNotePosition in musicTheory)
const LETTER_TO_DPOS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/**
 * Calcola pitch, octave, position, noteIndex e explicitAccidental direttamente
 * dallo spelling del ScaleDegreeNote — senza passare per ALL_NOTE_SPELLINGS che
 * manca di E#, B#, Fb, Cb. Garantisce lo spelling corretto per accordi come C#7
 * (C#–E#–G#–B) o Fb major (Fb–Ab–Cb).
 */
function notePropsFromTone(
    midi: number,
    tone: ScaleDegreeNote,
    clef: 'treble' | 'bass',
    keySignature: KeySignature,
): { pitch: string; octave: number; position: number; midi: number; noteIndex: number; clef: string; explicitAccidental: ReturnType<typeof calculateAccidental> } {
    const letter = tone.letter;
    const acc = tone.accidental ?? '';
    const octave = Math.floor(midi / 12) - 1;
    const position = LETTER_TO_DPOS[letter] + (octave - 4) * 7;
    const noteIndex = ((midi % 12) + 12) % 12;

    const sharpNotes = ['F','C','G','D','A','E','B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes  = ['B','E','A','D','G','C','F'].slice(0, keySignature.type === 'flat'  ? keySignature.count : 0);
    const keyAccList = keySignature.type === 'sharp' ? sharpNotes.map(n => n + '#') : flatNotes.map(n => n + 'b');
    const explicitAccidental = calculateAccidental(letter + acc, keyAccList);

    return { pitch: letter, octave, position, midi, noteIndex, clef, explicitAccidental };
}

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
    activeAccidentals?: Record<string, string>,
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

    // Deriva tonicPc dalla key signature per evitare raddoppio della sensibile
    const tonicPc = noteNameToPc(keySignature.root ?? 'C');

    // PC di tutte le note dell'accordo (usato da revoice per non perdere la 7a se omessa nel voicing)
    const chordPcs = intervals.map(i => ((rootPc + i) % 12 + 12) % 12);

    // Chiama il motore corale — con voice leading se c'è un voicing precedente
    let voicing = prevVoicing
        ? realizeNextChord(tones, inversion, prevVoicing, DEFAULT_CHORAL_RULES, undefined, undefined, tonicPc)
        : realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES, undefined, undefined, tonicPc);

    // Sanity check solo per TRIADI: se una voce è triplicata manca sicuramente
    // un PC — riesegui senza prevVoicing per un voicing pulito.
    // Per i 7th chords NON lo facciamo: l'engine omette intenzionalmente la 5a
    // (es. G7 → G,B,F,G) e il check provocherebbe falsi positivi.
    if (voicing && tones.length === 3) {
        const requiredPcs = new Set(chordPcs);
        const voicingPcs = new Set([voicing.soprano, voicing.alto, voicing.tenor, voicing.bass].map(m => ((m % 12) + 12) % 12));
        const missingPcs = [...requiredPcs].filter(pc => !voicingPcs.has(pc));
        if (missingPcs.length > 0) {
            voicing = realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES, undefined, undefined, tonicPc);
        }
    }

    const makeNote = (midi: number, voice: number, clef: 'treble' | 'bass'): StaffNote => {
        const tone = findToneForMidiPc(midi, tones, rootPc);
        // Usa notePropsFromTone per rispettare lo spelling diatonico della radice
        // (es. E# per la terza di C#7, non F). Fallback a getNotePropertiesFromMidi
        // solo se il tone non è trovato (non dovrebbe mai accadere).
        const props = tone
            ? notePropsFromTone(midi, tone, clef, keySignature)
            : getNotePropertiesFromMidi(midi, keySignature, clef, preferredAccidentalFromTone(tone));
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
            chordPcs,
            chordRootName: rootName,
        } as StaffNote;
    };

    const buildResult = (rawNotes: StaffNote[]): StaffNote[] =>
        activeAccidentals
            ? applyMeasureAccidentals(rawNotes, activeAccidentals, keySignature, tones, rootPc)
            : rawNotes;

    if (voicing) {
        return buildResult([
            makeNote(voicing.soprano, 1, 'treble'),
            makeNote(voicing.alto,    2, 'treble'),
            makeNote(voicing.tenor,   3, 'treble'),
            makeNote(voicing.bass,    4, 'bass'),
        ]);
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

    return buildResult([
        makeNote(finalSop,   1, 'treble'),
        makeNote(finalAlto,  2, 'treble'),
        makeNote(finalTenor, 3, 'treble'),
        makeNote(bassMidi,   4, 'bass'),
    ]);
}

/** Ciclo ordinato delle disposizioni disponibili (auto escluso: usato solo al primo accordo). */
// ─── Utility condivise per accidentali di misura ─────────────────────────────

/**
 * Costruisce la mappa degli accidentali attivi in una misura fino a un certo tick.
 * Chiave: `${clef}-${pitch}` (es. "treble-B", "bass-G") per isolare i pentagrammi.
 * Da usare sia nell'inserimento che nel revoice.
 */
export function buildMeasureAccidentals(
    notes: StaffNote[],
    measureIndex: number,
    beforeTick: number,
    excludeIds?: Set<string>,
): Record<string, string> {
    const accToStr = (acc: string | null | undefined): string => {
        if (acc === 'sharp') return '#'; if (acc === 'flat') return 'b';
        if (acc === 'double-sharp') return '##'; if (acc === 'double-flat') return 'bb';
        return '';
    };
    const result: Record<string, string> = {};
    for (const n of notes) {
        if ((n as any).measureIndex !== measureIndex) continue;
        if ((n as any).isRest) continue;
        if (typeof (n as any).startTick !== 'number') continue;
        if ((n as any).startTick >= beforeTick) continue;
        if (excludeIds?.has((n as any).id)) continue;
        if (!n.pitch) continue;
        const clef = (n.clef ?? ((Number((n as any).voice) <= 2) ? 'treble' : 'bass'));
        result[`${clef}-${n.pitch}`] = accToStr(n.accidental ?? n.explicitAccidental);
    }
    return result;
}

/**
 * Applica la correzione degli accidentali di misura a un array di StaffNote,
 * restituendo nuove note con `explicitAccidental` aggiornato.
 * Unica implementazione usata sia da buildChordSATBNotes che da revoiceChordAtTick.
 */
export function applyMeasureAccidentals(
    notes: StaffNote[],
    measureAccidentals: Record<string, string>,
    keySignature: KeySignature,
    tones: ReturnType<typeof buildScaleDegreeNotesPublic>,
    rootPc: number,
): StaffNote[] {
    const sharpNotes = ['F','C','G','D','A','E','B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes  = ['B','E','A','D','G','C','F'].slice(0, keySignature.type === 'flat'  ? keySignature.count : 0);
    const keyAccList = keySignature.type === 'sharp' ? sharpNotes.map(n => n + '#') : flatNotes.map(n => n + 'b');

    return notes.map(note => {
        const clef = (note.clef ?? ((Number((note as any).voice) <= 2) ? 'treble' : 'bass'));
        // Filtra solo gli accidentali dello stesso pentagramma
        const clefAcc: Record<string, string> = {};
        for (const [k, v] of Object.entries(measureAccidentals)) {
            if (k.startsWith(clef + '-')) clefAcc[k.slice(clef.length + 1)] = v;
        }
        // Ricava il nome completo della nota dallo spelling del tono
        const noteMidi = (note as any).midi as number;
        const notePc = ((noteMidi % 12) + 12) % 12;
        const tone = tones.find(t => ((rootPc + t.semiFromRoot) % 12 + 12) % 12 === notePc);
        const fullName = tone ? (tone.letter + (tone.accidental ?? '')) : note.pitch;
        const explicitAccidental = calculateAccidentalWithMeasureContext(fullName, keyAccList, clefAcc);
        return { ...note, explicitAccidental };
    });
}

/** Espone buildScaleDegreeNotes per applyMeasureAccidentals (alias pubblico). */
export function buildScaleDegreeNotesPublic(rootName: string, intervals: number[]) {
    return buildScaleDegreeNotes(rootName, intervals);
}

// ─────────────────────────────────────────────────────────────────────────────

export const VOICING_DISPOSITIONS = ['auto', 'R358', 'R538', 'R835', 'R385', 'R583', 'R853'] as const;
export type VoicingDisposition = typeof VOICING_DISPOSITIONS[number];

/**
 * Ricalcola il voicing di 4 note SATB già presenti nello spartito con una nuova disposizione.
 * Prende le note alle voci 1-4 al dato startTick, identifica l'accordo, e produce
 * nuove StaffNote con il voicing richiesto mantenendo tick/durata originali.
 *
 * @param notes - tutte le rawNotes correnti
 * @param startTick - tick di inizio dell'accordo da revoice
 * @param disposition - nuova disposizione (es. 'R358', 'R538', ...)
 * @param keySignature - armatura di chiave corrente
 * @param prevVoicing - voicing precedente per voice leading (opzionale)
 * @returns array di 4 nuove StaffNote, o null se impossibile
 */
export function revoiceChordAtTick(
    notes: StaffNote[],
    startTick: number,
    disposition: VoicingDisposition,
    keySignature: KeySignature,
    prevVoicing?: { soprano: number; alto: number; tenor: number; bass: number } | null,
    activeAccidentals?: Record<string, string>,
): StaffNote[] | null {
    // Recupera le 4 voci all'esatto startTick
    const chordNotes = (notes as any[]).filter(
        n => n.startTick === startTick && !n.isRest && [1,2,3,4].includes(Number(n.voice))
    );
    if (chordNotes.length < 2) return null;

    const bassNote = chordNotes.find((n: any) => Number(n.voice) === 4);
    if (!bassNote) return null;

    // Usa chordPcs salvato al momento dell'inserimento (se disponibile) per non
    // perdere note omesse nel voicing (es. 5a in G7 raddoppiato con radice).
    const savedPcs: number[] | undefined = (chordNotes[0] as any).chordPcs;
    const bassMidi = Number(bassNote.midi);
    const basePc = (bassMidi % 12 + 12) % 12;

    let intervals: number[];
    if (savedPcs && savedPcs.length >= 3) {
        intervals = savedPcs.map(pc => ((pc - basePc) + 12) % 12).sort((a, b) => a - b);
    } else {
        // Fallback: ricostruisce dai midi presenti (può perdere note omesse)
        const pcs = Array.from(new Set(
            chordNotes.map((n: any) => ((Number(n.midi) % 12) + 12) % 12)
        )) as number[];
        intervals = pcs.map(pc => ((pc - basePc) + 12) % 12).sort((a, b) => a - b);
    }

    // Usa chordRootName salvato per lo spelling corretto (es. C per C7/E, non E)
    const savedRootName: string | undefined = (chordNotes[0] as any).chordRootName;
    const rootName = savedRootName ||
        (bassNote as any).noteName?.replace(/\d/, '') ||
        ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][basePc];

    // Se abbiamo il rootName reale, ricostruiamo gli intervalli dalla radice
    // (non dal basso) per preservare lo spelling corretto
    let tones: ReturnType<typeof buildScaleDegreeNotes>;
    let inversion: number;
    if (savedRootName && savedPcs) {
        const realRootPc = noteNameToPc(savedRootName);
        const rootIntervals = savedPcs
            .map(pc => ((pc - realRootPc) + 12) % 12)
            .sort((a, b) => a - b);
        tones = buildScaleDegreeNotes(savedRootName, rootIntervals);
        // Calcola inversion: quale tono dell'accordo è al basso
        inversion = tones.findIndex(t => {
            const tonePc = ((realRootPc + t.semiFromRoot) % 12 + 12) % 12;
            return tonePc === basePc;
        });
        if (inversion < 0) inversion = 0;
    } else {
        tones = buildScaleDegreeNotes(rootName, intervals);
        inversion = 0;
    }
    const tonicPc = noteNameToPc(keySignature.root ?? 'C');
    // Preserva chordPcs originali (o ricalcola dagli intervals)
    const chordPcs: number[] = savedPcs ?? intervals.map(i => ((basePc + i) % 12 + 12) % 12);

    const duration = (chordNotes[0] as any).duration ?? 'quarter';
    const beatsPerMeasure = 4;
    const measureIndex = (chordNotes[0] as any).measureIndex ?? 0;
    const beat = (chordNotes[0] as any).beat ?? 1;

    const is7thChord = tones.length >= 4;
    let voicing: SATBVoicing | null = null;

    if (is7thChord) {
        // Per 7th chords: ciclo soprano in ordine auto → 7a → 3a → 5a → radice
        // (priorità alla 7a che è la più caratteristica dell'accordo)
        const SEVENTH_SOPRANO_ORDER = [3, 1, 2, 0]; // indici in tones: 7a, 3a, 5a, radice
        const dispIdx = VOICING_DISPOSITIONS.indexOf(disposition);
        const sopranoNoteIdx = dispIdx > 0
            ? SEVENTH_SOPRANO_ORDER[(dispIdx - 1) % SEVENTH_SOPRANO_ORDER.length]
            : -1;

        if (sopranoNoteIdx >= 0 && sopranoNoteIdx < tones.length) {
            const targetPc = ((basePc + intervals[sopranoNoteIdx]) % 12 + 12) % 12;
            // Preferisce la metà alta del range soprano (G4=67 – G5=79) per evitare
            // posizioni troppo basse; prova prima lì, poi allarga verso il basso
            const sopCandidates: number[] = [];
            for (let midi = 67; midi <= 79; midi++) {
                if (((midi % 12) + 12) % 12 === targetPc) sopCandidates.push(midi);
            }
            // Fallback range completo soprano
            if (sopCandidates.length === 0) {
                for (let midi = 60; midi <= 81; midi++) {
                    if (((midi % 12) + 12) % 12 === targetPc) sopCandidates.push(midi);
                }
            }
            for (const sop of sopCandidates) {
                const v = prevVoicing
                    ? realizeNextChord(tones, inversion, prevVoicing, DEFAULT_CHORAL_RULES, sop, undefined, tonicPc)
                    : realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES, sop, undefined, tonicPc);
                if (v) { voicing = v; break; }
            }
        }
        // Fallback auto
        if (!voicing) {
            voicing = prevVoicing
                ? realizeNextChord(tones, inversion, prevVoicing, DEFAULT_CHORAL_RULES, undefined, undefined, tonicPc)
                : realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES, undefined, undefined, tonicPc);
        }

        // Verifica che la 7a sia presente nel voicing risultante.
        // Regola pratica: nei 7th chords NON si raddoppia mai la 3a; se manca
        // una nota si omette la 5a mantenendo il tritono (radice + 3a + 7a).
        if (voicing) {
            // IMPORTANTE: usa la radice reale (non il basso) per identificare 3a e 7a.
            // Per inversioni come C7/E il basso è E ma la 7a è Bb (10 semitoni da C, non da E).
            const realRootPcForCheck = savedRootName ? noteNameToPc(savedRootName) : basePc;
            // intervals dal punto di vista della radice reale (da chordPcs)
            const rootIntervals = chordPcs
                .map(pc => ((pc - realRootPcForCheck) + 12) % 12)
                .sort((a, b) => a - b);
            // 3a = secondo intervallo dalla radice (index 1), 7a = quarto (index 3)
            const thirdPc   = ((realRootPcForCheck + rootIntervals[1]) % 12 + 12) % 12;
            const seventhPc = ((realRootPcForCheck + rootIntervals[3]) % 12 + 12) % 12;
            const voicingMidis = [voicing.soprano, voicing.alto, voicing.tenor, voicing.bass];
            const has7th  = voicingMidis.some(m => ((m % 12) + 12) % 12 === seventhPc);
            const countThird = voicingMidis.filter(m => ((m % 12) + 12) % 12 === thirdPc).length;

            if (!has7th || countThird >= 2) {
                // Prova prima fixedSoprano sulla 7a (range medio-alto)
                let fixed: SATBVoicing | null = null;
                for (let midi = 67; midi <= 81 && !fixed; midi++) {
                    if (((midi % 12) + 12) % 12 === seventhPc) {
                        fixed = prevVoicing
                            ? realizeNextChord(tones, inversion, prevVoicing, DEFAULT_CHORAL_RULES, midi, undefined, tonicPc)
                            : realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES, midi, undefined, tonicPc);
                    }
                }
                // Se il motore insiste nel raddoppiare la 3a, sostituiamo manualmente
                // la voce raddoppiata (escludendo basso) con la 7a nell'ottava più vicina
                if (!fixed || [fixed.soprano, fixed.alto, fixed.tenor, fixed.bass]
                        .filter(m => ((m % 12) + 12) % 12 === thirdPc).length >= 2) {
                    const base = fixed ?? voicing;
                    const upperVoices: Array<'soprano' | 'alto' | 'tenor'> = ['soprano', 'alto', 'tenor'];
                    // Trova la voce da sostituire: quella che raddoppia la 3a (non il basso)
                    const toReplace = upperVoices.find(v => {
                        const pc = ((base[v] % 12) + 12) % 12;
                        return pc === thirdPc && upperVoices.filter(w => ((base[w] % 12) + 12) % 12 === thirdPc).length >= 2;
                    }) ?? (has7th ? null : 'soprano');
                    if (toReplace) {
                        // Trova il midi 7a più vicino alla voce da sostituire
                        const target = base[toReplace];
                        let bestMidi = -1, bestDist = 999;
                        for (let m = 48; m <= 84; m++) {
                            if (((m % 12) + 12) % 12 === seventhPc) {
                                // Deve stare entro i range vocali e rispettare ordine voci
                                const dist = Math.abs(m - target);
                                if (dist < bestDist) { bestDist = dist; bestMidi = m; }
                            }
                        }
                        if (bestMidi >= 0) voicing = { ...base, [toReplace]: bestMidi };
                        else if (fixed) voicing = fixed;
                    } else if (fixed) {
                        voicing = fixed;
                    }
                } else if (fixed) {
                    voicing = fixed;
                }
            }
        }
    } else {
        // Triadi: ciclo soprano su radice(ottava), 3a, 5a — come per i 7th chords.
        // realizeNextChord non accetta disposition, quindi usiamo fixedSoprano
        // per forzare la posizione anche in presenza di voice-leading.
        const TRIAD_SOPRANO_ORDER = [0, 1, 2]; // radice, 3a, 5a (indici in tones)
        const dispIdx = VOICING_DISPOSITIONS.indexOf(disposition);
        const sopranoNoteIdx = dispIdx > 0 ? TRIAD_SOPRANO_ORDER[(dispIdx - 1) % TRIAD_SOPRANO_ORDER.length] : -1;

        if (sopranoNoteIdx >= 0 && sopranoNoteIdx < tones.length) {
            const targetPc = ((basePc + intervals[sopranoNoteIdx]) % 12 + 12) % 12;
            const sopCandidates: number[] = [];
            for (let midi = 67; midi <= 81; midi++) {
                if (((midi % 12) + 12) % 12 === targetPc) sopCandidates.push(midi);
            }
            if (sopCandidates.length === 0) {
                for (let midi = 60; midi <= 81; midi++) {
                    if (((midi % 12) + 12) % 12 === targetPc) sopCandidates.push(midi);
                }
            }
            for (const sop of sopCandidates) {
                const v = prevVoicing
                    ? realizeNextChord(tones, inversion, prevVoicing, DEFAULT_CHORAL_RULES, sop, undefined, tonicPc)
                    : realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES, sop, undefined, tonicPc);
                if (v) { voicing = v; break; }
            }
        }
        // auto o fallback
        if (!voicing) {
            if (prevVoicing) {
                voicing = realizeNextChord(tones, inversion, prevVoicing, DEFAULT_CHORAL_RULES, undefined, undefined, tonicPc);
            }
            if (!voicing) {
                voicing = realizeFirstChord(tones, inversion, DEFAULT_CHORAL_RULES, undefined, undefined, tonicPc);
            }
        }
    }

    if (!voicing) return null;

    const rawNewNotes = voicingToStaffNotes(voicing, measureIndex, beat, duration, tones, inversion, keySignature, beatsPerMeasure);
    const newNotes = activeAccidentals
        ? applyMeasureAccidentals(rawNewNotes, activeAccidentals, keySignature, tones, noteNameToPc(savedRootName ?? rootName))
        : rawNewNotes;

    const voiceOrder: (1|2|3|4)[] = [1, 2, 3, 4];
    return voiceOrder.map(v => {
        const orig = chordNotes.find((n: any) => Number(n.voice) === v);
        const newN = newNotes.find(n => Number(n.voice) === v);
        if (!orig || !newN) return orig ?? newN;
        return {
            ...newN,
            id: (orig as any).id,
            startTick: (orig as any).startTick,
            durationTicks: (orig as any).durationTicks,
            chordPcs,
            chordRootName: savedRootName ?? rootName,
        } as StaffNote;
    }).filter(Boolean) as StaffNote[];
}
