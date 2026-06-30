// ─────────────────────────────────────────────────────────────────────────────
// Trasformazioni melodiche su una selezione (linea melodica).
//
// Operazioni "a livello di motivo" — distinte dal transpose GLOBALE di tonalità.
// Quattro trasformazioni classiche (contrappunto/fuga/dodecafonia):
//   • trasposizione   (per gradi diatonici = TONALE, o per semitoni = REALE)
//   • inversione      (specchio attorno a un asse = prima nota)
//   • retrogrado      (ordine temporale rovesciato: note E ritmo)
//   • retrogrado-inverso (composizione delle due)
//
// Distinzione musicale chiave (sollevata dall'utente):
//   – REALE (cromatica): intervalli esatti preservati; può USCIRE dalla tonalità.
//   – TONALE (diatonica): muove per gradi di scala; RESTA in chiave, le qualità
//     degli intervalli si adattano. Non serve il tonico: basta muovere di N
//     lettere e applicare l'accidente d'armatura alla nuova lettera; le note
//     cromatiche conservano la loro deviazione rispetto al grado di scala.
//
// Le funzioni sono PURE: trasformano solo l'altezza (e, per il retrogrado, la
// disposizione temporale RELATIVA). Il posizionamento "inserisci dopo" (offset,
// nuovi id, ricalcolo di beat/misura) resta a carico del chiamante (editor).
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffNote, KeySignature, ClefType, AccidentalType } from '../types';
import { getNotePropertiesFromMidi, calculateAccidental } from './musicTheory';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_IDX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const BASE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const mod = (n: number, m: number) => ((n % m) + m) % m;

export type TransformMode = 'tonal' | 'real';

/** Accidente d'armatura (in semitoni) per una lettera. +1 diesis, −1 bemolle, 0 naturale. */
function keyAlt(letter: string, key: KeySignature): number {
    if (key.type === 'sharp') return SHARP_ORDER.slice(0, key.count).includes(letter) ? 1 : 0;
    return FLAT_ORDER.slice(0, key.count).includes(letter) ? -1 : 0;
}

/** Note alterate dall'armatura (es. ['F#','C#']) — formato per calculateAccidental. */
function keyAccidentalList(key: KeySignature): string[] {
    if (key.type === 'sharp') return SHARP_ORDER.slice(0, key.count).map(n => n + '#');
    return FLAT_ORDER.slice(0, key.count).map(n => n + 'b');
}

/** (lettera, ottava, alterazione-da-naturale) di una nota. Usa il MIDI come fonte
 *  autorevole dell'altezza (non l'accidente disegnato, che dipende dall'armatura). */
function spellOf(n: any): { letter: string; octave: number; alt: number } | null {
    const letter = String(n?.pitch || '').trim().charAt(0).toUpperCase();
    if (!(letter in BASE_PC)) return null;
    const octave = Number(n.octave);
    const midi = Number(n.midi);
    if (!Number.isFinite(octave) || !Number.isFinite(midi)) return null;
    const naturalMidi = (octave + 1) * 12 + BASE_PC[letter];
    return { letter, octave, alt: midi - naturalMidi };
}

function accSuffix(alt: number): string {
    if (alt > 0) return '#'.repeat(Math.min(alt, 4));
    if (alt < 0) return 'b'.repeat(Math.min(-alt, 4));
    return '';
}

/** Props di display per una nota compitata DIRETTAMENTE (percorso TONALE,
 *  lettera-accurata: il grado di scala determina la lettera). */
function spellDirect(letter: string, octave: number, alt: number, key: KeySignature, clef: ClefType): Partial<StaffNote> {
    const noteName = letter + accSuffix(alt);
    return {
        pitch: letter,
        octave,
        position: LETTER_IDX[letter] + (octave - 4) * 7,
        midi: (octave + 1) * 12 + BASE_PC[letter] + alt,
        noteIndex: mod((octave + 1) * 12 + BASE_PC[letter] + alt, 12),
        clef,
        explicitAccidental: calculateAccidental(noteName, keyAccidentalList(key)),
    };
}

/** Nome compitato completo di una nota (es. 'B', 'Bb', 'F#') ricavato da lettera +
 *  alterazione dal MIDI. Per il calcolo accidenti col contesto di misura. */
export function spelledNoteName(n: { pitch?: string; octave?: number; midi?: number }): string {
    const letter = String(n?.pitch || '').trim().charAt(0).toUpperCase();
    if (!(letter in BASE_PC)) return letter;
    const alt = Number(n.midi) - ((Number(n.octave) + 1) * 12 + BASE_PC[letter]);
    return letter + accSuffix(alt);
}

/** Note alterate dall'armatura (es. ['F#','C#'] / ['Bb','Eb']) — per calculateAccidental*. */
export function keyAccidentalNotes(key: KeySignature): string[] {
    return keyAccidentalList(key);
}

/** Fonde le nuove props di altezza sulla nota, azzerando gli accidenti "vecchi"
 *  (ora il rendering deve usare il fresco explicitAccidental). */
function applyProps(n: any, props: Partial<StaffNote> | null): StaffNote {
    if (!props) return n as StaffNote;
    const out: any = { ...n, ...props };
    out.accidental = undefined;
    out.userAccidental = undefined;
    return out as StaffNote;
}

/**
 * Trasposizione del motivo.
 * @param amount  REALE: semitoni (±). TONALE: passi diatonici/lettere (±1 = una seconda).
 */
export function transposeMelody(
    notes: StaffNote[],
    key: KeySignature,
    opts: { mode: TransformMode; amount: number },
): StaffNote[] {
    if (!opts.amount) return notes.map(n => ({ ...n }));
    return notes.map((n: any) => {
        if (n.isRest) return n;
        const clef = (n.clef || 'treble') as ClefType;
        if (opts.mode === 'real') {
            const newMidi = Number(n.midi) + opts.amount;
            const pref: AccidentalType | null = opts.amount > 0 ? 'sharp' : opts.amount < 0 ? 'flat' : null;
            return applyProps(n, getNotePropertiesFromMidi(newMidi, key, clef, pref));
        }
        const sp = spellOf(n);
        if (!sp) return n;
        const newAbs = (sp.octave * 7 + LETTER_IDX[sp.letter]) + opts.amount;
        const newLetter = LETTERS[mod(newAbs, 7)];
        const newOctave = Math.floor(newAbs / 7);
        const chroma = sp.alt - keyAlt(sp.letter, key);          // deviazione dal grado
        const newAlt = keyAlt(newLetter, key) + chroma;          // armatura nuovo grado + deviazione
        return applyProps(n, spellDirect(newLetter, newOctave, newAlt, key, clef));
    });
}

/** Inversione di UNA voce attorno al proprio asse (nota più grave del suo primo onset).
 *  REALE: riflessione cromatica esatta. TONALE: riflessione in spazio-gradi (in chiave). */
function invertSingleVoice(notes: any[], key: KeySignature, opts: { mode: TransformMode }): StaffNote[] {
    const pitched = notes.filter((n: any) => !n.isRest);
    if (pitched.length === 0) return notes.map(n => ({ ...n }));
    const withTick = pitched.filter((n: any) => Number.isFinite(Number(n.startTick)));
    let axisNote: any;
    if (withTick.length > 0) {
        const firstTick = Math.min(...withTick.map((n: any) => Number(n.startTick)));
        const firstSlice = withTick.filter((n: any) => Number(n.startTick) === firstTick);
        axisNote = firstSlice.reduce((lo: any, n: any) => Number(n.midi) < Number(lo.midi) ? n : lo, firstSlice[0]);
    } else {
        axisNote = pitched[0];
    }
    const axisMidi = Number(axisNote.midi);
    const axisSpell = spellOf(axisNote);
    return notes.map((n: any) => {
        if (n.isRest) return n;
        const clef = (n.clef || 'treble') as ClefType;
        if (opts.mode === 'real' || !axisSpell) {
            const newMidi = 2 * axisMidi - Number(n.midi);
            const pref: AccidentalType | null = newMidi > axisMidi ? 'sharp' : newMidi < axisMidi ? 'flat' : null;
            return applyProps(n, getNotePropertiesFromMidi(newMidi, key, clef, pref));
        }
        const sp = spellOf(n);
        if (!sp) return n;
        const noteAbs = sp.octave * 7 + LETTER_IDX[sp.letter];
        const axisAbs = axisSpell.octave * 7 + LETTER_IDX[axisSpell.letter];
        const newAbs = 2 * axisAbs - noteAbs;
        const newLetter = LETTERS[mod(newAbs, 7)];
        const newOctave = Math.floor(newAbs / 7);
        const chroma = sp.alt - keyAlt(sp.letter, key);
        const newAlt = keyAlt(newLetter, key) + chroma;
        return applyProps(n, spellDirect(newLetter, newOctave, newAlt, key, clef));
    });
}

/**
 * Inversione (specchio). Opera PER VOCE: ogni voce si specchia attorno al proprio asse
 * (nota più grave del suo primo onset), così in SATB ciascuna voce resta nel proprio
 * registro invece di precipitare sotto il basso. Una linea monofonica = una sola voce.
 * Su un singolo accordo (1 nota per voce) ogni voce è il proprio asse → nessun cambio:
 * l'inversione melodica richiede una LINEA, non una singola simultaneità.
 */
export function invertMelody(
    notes: StaffNote[],
    key: KeySignature,
    opts: { mode: TransformMode },
): StaffNote[] {
    const byVoice = new Map<number, any[]>();
    for (const n of notes) {
        const v = Number((n as any).voice ?? 0);
        if (!byVoice.has(v)) byVoice.set(v, []);
        byVoice.get(v)!.push(n);
    }
    const result = new Map<string, StaffNote>();
    for (const group of byVoice.values()) {
        for (const n of invertSingleVoice(group, key, opts)) result.set((n as any).id, n as StaffNote);
    }
    return notes.map((n: any) => result.get(n.id) ?? n);
}

/**
 * Retrogrado: rovescia l'ordine temporale degli ONSET (note + pause), riassegnando gli
 * onset dai valori ritmici invertiti, a partire dall'inizio della selezione.
 *
 * Lavora per "fette" raggruppate per startTick: ogni accordo è una fetta che resta
 * verticale (niente serializzazione); ogni nota conserva la sua durata. Il valore
 * ritmico di una fetta = distanza dall'onset successivo (per l'ultima = durata max
 * delle sue note). Per una linea monofonica equivale al retrogrado nota-per-nota.
 *
 * Cambia il timing (startTick) → il chiamante deve ricalcolare beat/misura.
 */
export function retrogradeMelody(notes: StaffNote[]): StaffNote[] {
    const timed = notes.filter((n: any) => Number.isFinite(Number(n.startTick)));
    if (timed.length <= 1) return notes.map(n => ({ ...n }));

    const byTick = new Map<number, any[]>();
    for (const n of timed) {
        const t = Number((n as any).startTick);
        if (!byTick.has(t)) byTick.set(t, []);
        byTick.get(t)!.push(n);
    }
    const ticks = [...byTick.keys()].sort((a, b) => a - b);
    if (ticks.length <= 1) return notes.map(n => ({ ...n })); // un solo onset (accordo unico): invariato

    // Valore ritmico (slot) di ogni fetta: gap all'onset seguente; l'ultima usa la sua durata.
    const slotOf = (i: number): number => {
        if (i < ticks.length - 1) return ticks[i + 1] - ticks[i];
        const slice = byTick.get(ticks[i])!;
        return Math.max(0, ...slice.map((n: any) => Number(n.durationTicks ?? 0)));
    };

    let cursor = ticks[0];
    const out: StaffNote[] = [];
    for (let i = ticks.length - 1; i >= 0; i--) {
        for (const src of byTick.get(ticks[i])!) {
            out.push({ ...src, startTick: cursor } as StaffNote);
        }
        cursor += slotOf(i);
    }
    return out;
}

/** Retrogrado-inverso: inversione seguita da retrogrado. */
export function retrogradeInvertMelody(
    notes: StaffNote[],
    key: KeySignature,
    opts: { mode: TransformMode },
): StaffNote[] {
    return retrogradeMelody(invertMelody(notes, key, opts));
}
