/**
 * Restituisce una timeline di eventi armonici: per ogni punto significativo (inizio/fine nota),
 * fornisce tutte le note attive in quell'istante (considerando le note prolungate).
 * Utile per analisi armonica completa (es. Cmaj7 con C minima + E,G,B sul beat successivo).
 */
export function getActiveNotesTimeline(
    notes: StaffNote[],
    timeSignature: TimeSignature,
    timeSignatureChanges?: TimeSignatureChange[]
): Array<{ absBeat: number; measureIndex: number; beat: number; notes: StaffNote[] }> {
    const baseBeatsPerMeas = timeSignature.numerator * (4 / timeSignature.denominator);
    const normalizeChanges = (): { measureIndex: number; numerator: number; denominator: number }[] => {
        const base = Math.max(1, Number.isFinite(baseBeatsPerMeas) ? baseBeatsPerMeas : 4);
        return (timeSignatureChanges || [])
            .map(c => {
                const absBeat = Number(c.absBeat);
                const m = Number.isFinite(c.measureIndex as any)
                    ? Number(c.measureIndex)
                    : (Number.isFinite(absBeat) ? Math.floor(absBeat / base) : 0);
                const n = Math.max(1, Math.round(Number(c.numerator)));
                const d = Math.max(1, Math.round(Number(c.denominator)));
                return { measureIndex: m, numerator: n, denominator: d };
            })
            .filter(c => Number.isFinite(c.measureIndex))
            .sort((a, b) => a.measureIndex - b.measureIndex);
    };

    const changes = normalizeChanges();
    const getBeatsPerMeasureForIndex = (m: number): number => {
        let active = timeSignature;
        for (const c of changes) {
            if (c.measureIndex <= m) {
                active = { numerator: c.numerator, denominator: c.denominator };
            } else {
                break;
            }
        }
        const bpm = active.numerator * (4 / active.denominator);
        return Math.max(1, Number.isFinite(bpm) ? bpm : baseBeatsPerMeas || 4);
    };

    const maxMeasureIndex = Math.max(0, ...notes.map(n => Number.isFinite(n.measureIndex) ? (n.measureIndex as number) : 0));
    const measureStartAbsBeat: number[] = [];
    let acc = 0;
    for (let m = 0; m <= maxMeasureIndex + 1; m++) {
        measureStartAbsBeat[m] = acc;
        acc += getBeatsPerMeasureForIndex(m);
    }

    const findMeasureIndexForAbsBeat = (absBeat: number): number => {
        for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
            if (absBeat >= measureStartAbsBeat[m] - 1e-9) return m;
        }
        return 0;
    };
    // Helper per durata
    const getDuration = (n: StaffNote): number => {
        const base = (DURATION_VALUES as any)[n.duration] || 1;
        let val = base;
        if (n.isDotted) val *= 1.5;
        if (n.isTriplet) val *= 2 / 3;
        if (n.isDuplet) val *= 3 / 2;
        return val;
    };
    // Trova tutti i punti temporali in cui succede qualcosa (INIZIO o FINE nota)
    const scanPointsSet = new Set<number>();
        notes.forEach(n => { 
        if (n.isRest) return;
        const m = n.measureIndex ?? 0;
        const b = n.beat ?? 1;
        const start = (measureStartAbsBeat[m] ?? 0) + (b - 1);
        const end = start + getDuration(n);
        scanPointsSet.add(start);
        scanPointsSet.add(end);
    });
    const scanPoints = Array.from(scanPointsSet).sort((a, b) => a - b);
    // Per ogni punto, trova le note attive
    return scanPoints.map(absBeat => {
        const activeNotes = notes.filter(n => {
            if (n.isRest) return false;
            const m = n.measureIndex ?? 0;
            const b = n.beat ?? 1;
            const start = (measureStartAbsBeat[m] ?? 0) + (b - 1);
            const dur = getDuration(n);
            return start <= absBeat && absBeat < (start + dur - 1e-6);
        });
        const measureIndex = findMeasureIndexForAbsBeat(absBeat);
        const beat = (absBeat - (measureStartAbsBeat[measureIndex] ?? 0)) + 1;
        return { absBeat, measureIndex, beat, notes: activeNotes };
    });
}
import { Key, ScaleType, DisplayNote, StaffNote, KeySignature, EnharmonicMode, ScaleShape, ChordType, Voicing, AccidentalType, Voice, HarmonyAnalysisResult, HarmonyLabelOverride, ErrorConnection, RuleViolation, TimeSignature, ClefType, BuiltInChords, AnalysisContext, TimeSignatureChange, OrnamentOverride } from '../types';
import { NOTE_NAMES, ALL_NOTE_SPELLINGS, FRET_COUNT, GUITAR_TUNING, SCALE_INTERVALS as BUILT_IN_SCALE_INTERVALS, CHORD_FORMULAS, DURATION_VALUES, TICKS_PER_QUARTER } from '../constants';
import { ENABLE_LEARNED_ORNAMENTS_KEY } from '../storage/storageKeys';
import { getString } from '../storage/localStorage';
import { detectVoiceLeadingSequences } from './sequenceDetector';
import { getRuleText } from './ruleTexts';
import { ORNAMENT_LEARNED_PATTERNS } from '../data/ornamentPatterns';

/** Ornament learning — duration bucket */
function ornDurationCategory(dur: string): string {
    switch (dur) {
        case 'sixty-fourth': case 'thirty-second': case 'sixteenth': return 'very-short';
        case 'eighth': return 'short';
        case 'quarter': return 'medium';
        case 'half': case 'whole': return 'long';
        default: return 'medium';
    }
}
/** Ornament learning — beat strength */
function ornBeatStrength(beat: number, ts: { numerator: number; denominator: number }): string {
    if (beat !== Math.floor(beat)) return 'weak';
    if (beat === 1) return 'strong';
    if (ts.numerator === 4 && ts.denominator === 4 && beat === 3) return 'strong';
    if (ts.numerator === 4 && ts.denominator === 4) return 'moderate';
    if (ts.numerator === 3 && ts.denominator === 4) return 'weak';
    if (ts.numerator === 6 && ts.denominator === 8 && (beat === 1 || beat === 4)) return 'strong';
    return 'weak';
}
/** Ornament learning — interval bucket */
function ornIntervalBucket(semitones: number): string {
    if (semitones === 0) return 'unison';
    const abs = Math.abs(semitones);
    const dir = semitones > 0 ? 'up' : 'down';
    if (abs <= 2) return `step-${dir}`;
    if (abs <= 4) return `skip-${dir}`;
    return `leap-${dir}`;
}

const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40];
const GUITAR_TUNING_INDICES = GUITAR_TUNING;
const FLAT_MAJOR_ROOTS = new Set(['F', 'A#', 'D#', 'G#', 'C#', 'F#']);

const SHARP_KEY_COUNTS: Record<string, number> = { 'C#': 7, 'F#': 6, 'B': 5, 'E': 4, 'A': 3, 'D': 2, 'G': 1, 'C': 0 };
const FLAT_KEY_COUNTS: Record<string, number> = { 'Cb': 7, 'Gb': 6, 'Db': 5, 'Ab': 4, 'Eb': 3, 'Bb': 2, 'F': 1, 'C': 0 };

const noteNameToIndex: { [key: string]: number } = {};
ALL_NOTE_SPELLINGS.forEach((names, index) => {
    names.forEach(name => {
        noteNameToIndex[name] = index;
    });
});
const flatMinorKeyRoots = new Set(['G', 'D', 'C', 'F', 'Bb', 'Eb', 'Ab']);


const mod = (n: number, m: number) => ((n % m) + m) % m;
const mod12 = (n: number) => mod(n, 12);

const SEVENTH_EXCEPTIONAL_RESOLUTION_HELP =
    'Nelle situazioni in cui la settima non può risolvere regolarmente (ovvero scendendo di grado), i manuali indicano diverse eccezioni e licenze tecniche:\n'
    + '• Progressioni Imitate: nello svolgimento di una sequenza, la necessità di mantenere la simmetria del disegno prevale sulla condotta delle voci. In questi passaggi, la settima può non risolvere correttamente per permettere l’imitazione esatta del modello.\n'
    + '• Scambio di Parti: la settima può non risolvere nella voce in cui si trova se la sua nota di risoluzione viene “presa” da un’altra parte nell’accordo successivo. Questo meccanismo è considerato una forma di risoluzione tollerata.\n'
    + '• Parti Interne: nelle voci centrali, la settima può talvolta saltare verso un’altra nota del secondo accordo (come la quinta) per permettere la completa realizzazione dell’armonia, specialmente se questo evita l’omissione di componenti fondamentali.\n'
    + '• Risoluzione Passiva: in contesti moderni o di arrangiamento, una settima può essere mantenuta come nota comune se l’accordo successivo la trasforma in una consonanza o in una diversa dissonanza, posticipando o annullando l’obbligo di discesa.\n'
    + '• Sesta Eccedente: nella forma “francese” dell’accordo di sesta eccedente, la quarta (che ha funzione di settima rispetto alla fondamentale) è considerata libera di saltare.';

const HIDDEN_OCTAVE_LICENSE_IN_SEQUENCE_HELP =
    'ℹ️ Info: Licenza in Progressione Imitata\n'
    + 'L\'ottava nascosta è tollerata nel passaggio tra modello e imitazione per preservare la simmetria del disegno.\n\n'
    + '• ✅ Eccezione: Cambio di Posizione\n'
    + 'Ammessa se avviene all\'interno dello stesso accordo, poiché l\'orecchio non percepisce un mutamento nella purezza del collegamento.\n'
    + 'Nota sulla Disposizione: Posizione Stretta vs Lata\n'
    + '    ◦ In posizione stretta (Soprano, Alto e Tenore entro un’ottava), le ottave nascoste sono più facilmente tollerate perché il tessuto armonico è più compatto.\n'
    + '    ◦ In posizione lata (Soprano, Alto e Tenore superano l\'ottava), le ottave nascoste tra le parti estreme (Soprano-Basso) sono molto più esposte e vanno evitate, a meno che il soprano non proceda per grado congiunto.\n'
    + '• ⚠️ Avviso: Cadenza Finale (V-I)\n'
    + 'Tra le parti estreme, l\'ottava nascosta è accettabile solo se la sensibile è in una parte interna e risolve regolarmente.';

const HIDDEN_FIFTH_LICENSE_IN_SEQUENCE_HELP =
    'Licenza nelle progressioni:\n'
    + 'Nel passaggio tra il modello e la sua ripetizione sono tollerati errori armonici di quinte, ottave o unisoni, siano essi paralleli o diretti, per non rompere la simmetria del disegno.\n'
    + '• Grado congiunto al soprano: il movimento per grado della voce superiore giustifica e rende corretta la formazione di una quinta nascosta tra le parti estreme.\n'
    + '• Cambi di posizione: le quinte raggiunte per moto simile all\'interno dello stesso accordo sono considerate accettabili, poiché l\'orecchio non percepisce un mutamento nella purezza del collegamento armonico.\n'
    + '• Parti interne: la tolleranza verso le quinte nascoste aumenta notevolmente quando l\'intervallo coinvolge almeno una parte interna, specialmente in posizione stretta.\n'
    + 'In sintesi, per il tuo sistema di warning, puoi applicare la stessa logica di “licenza” e “attenuazione” a entrambe le tipologie.';

// Figured-bass helpers: ensure vertical stacking order (top number first).
/** Converts ticks to beats (assuming TICKS_PER_QUARTER = 1 beat) */
export function ticksToBeats(ticks: number): number {
    return ticks / TICKS_PER_QUARTER;
}

/** Converts beats to ticks (assuming TICKS_PER_QUARTER = 1 beat) */
export function beatsToTicks(beats: number): number {
    return Math.round(beats * TICKS_PER_QUARTER);
}

/** Rebuilds the timeline for a given measure and voice, clamping rests and removing overlaps */
export function rebuildMeasureTimelineForVoice(
    notes: StaffNote[],
    measureIndex: number,
    voice: Voice,
    timeSignature: TimeSignature,
): StaffNote[] {
    const filtered = notes.filter(n => n.measureIndex === measureIndex && n.voice === voice);
    // Sort by beat
    filtered.sort((a, b) => (a.beat ?? 1) - (b.beat ?? 1));
        // Clamp rests and remove overlaps
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        // Helper: get closest duration label for a given beat value
        function getDurationFromBeats(beats: number): keyof typeof DURATION_VALUES {
            // Find the closest duration label
            let closest: keyof typeof DURATION_VALUES = 'quarter';
            let minDiff = Infinity;
            for (const key in DURATION_VALUES) {
                const val = DURATION_VALUES[key as keyof typeof DURATION_VALUES];
                const diff = Math.abs(val - beats);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = key as keyof typeof DURATION_VALUES;
                }
            }
            return closest;
        }

        function buildRestsBetween(startTick: number, endTick: number): StaffNote[] {
            const gapTicks = endTick - startTick;
            const epsilonTicks = TICKS_PER_QUARTER * 0.001;

            // se lo spazio è trascurabile, non creare nulla
            if (gapTicks <= epsilonTicks) return [];

            // durata reale in beat (solo per scegliere la "faccia" grafica)
            const beats = gapTicks / TICKS_PER_QUARTER;
            const approxDuration = getDurationFromBeats(beats);

            // beat locale nella misura (1..beatsPerMeasure)
            const absBeat = ticksToBeats(startTick);
            const beatInMeasure = (absBeat % beatsPerMeasure) + 1;

            return [{
                id: crypto.randomUUID(),
                measureIndex,
                voice,
                isRest: true,
                isTriplet: false,
                isDuplet: false,
                isDotted: false,
                startTick,
                // IMPORTANT: la durata REALE è esattamente il gap
                durationTicks: gapTicks,
                // label grafica approssimata (non influenza i calcoli)
                duration: approxDuration,
                beat: beatInMeasure,
                pitch: 'B',
                octave: 4,
                position: 0,
                midi: 0,
                noteIndex: 0,
            } as StaffNote];
        }
        // ...rest of rebuildMeasureTimelineForVoice remains unchanged...
        // TODO: Implement the rest of the timeline logic here
        // For now, return filtered (notes only) for type safety
        return filtered;
}
const SUPERSCRIPT_TO_DIGIT: Record<string, string> = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

const extractFigureValue = (fig: string): number => {
    const normalized = fig
        .split('')
        .map(ch => SUPERSCRIPT_TO_DIGIT[ch] ?? ch)
        .join('');
    const digits = normalized.replace(/[^0-9]/g, '');
    const n = digits ? parseInt(digits, 10) : Number.NaN;
    return Number.isFinite(n) ? n : -Infinity;
};

const normalizeFiguresVertical = (figures: string[]): string[] => {
    return figures
        .map((f, idx) => ({ f, idx, v: extractFigureValue(f) }))
        .sort((a, b) => (b.v - a.v) || (a.idx - b.idx))
        .map(x => x.f);
};

// NEW: UI helper -> render figured bass vertically ("6\n5") or horizontally ("6/5").
export function formatFiguredBass(figures: string[], layout: 'vertical' | 'horizontal' = 'vertical'): string {
    const ordered = normalizeFiguresVertical(figures ?? []);
    if (ordered.length === 0) return '';
    return layout === 'vertical' ? ordered.join('\n') : ordered.join('/');
}

const findFigureIndexByValue = (figures: string[], value: number): number =>
    (figures ?? []).findIndex(f => extractFigureValue(f) === value);

/** Calcola l'accidentale necessario per una nota in base alla tonalità */
export function calculateAccidental(noteName: string, keySignatureNotes: string[]): AccidentalType | null {
    const noteLetter = noteName.charAt(0);
    const noteAccidental = noteName.slice(1); // es. "#", "b", ""
    let keySignatureAccidental = ''; // Inizializza come stringa vuota
    for (const keyNote of keySignatureNotes) {
        if (keyNote.charAt(0) === noteLetter) {
            keySignatureAccidental = keyNote.slice(1);
            break;
        }
    }
    if (noteAccidental === keySignatureAccidental) {
        return null; // Nessun accidentale necessario
    } else if (noteAccidental === '' && keySignatureAccidental !== '') {
        return 'natural'; // BEQUADRO
    } else {
        return noteAccidental === '#' ? 'sharp' : (noteAccidental === 'b' ? 'flat' : null);
    }
}


/** Restituisce la preferenza enharmonica per una nota radice, tipo scala e qualità della chiave */
export function getEnharmonicPreference(rootNote: string, scaleType: ScaleType, keyQuality: 'Major' | 'Minor'): boolean {
    if (scaleType === 'Pentatonic') {
        const FLAT_MINOR_ROOTS = new Set(['D', 'G', 'C', 'F', 'A#', 'D#']);
        return keyQuality === 'Major' ? FLAT_MAJOR_ROOTS.has(rootNote) : FLAT_MINOR_ROOTS.has(rootNote);
    }
    
    const rootNoteIndex = NOTE_NAMES.indexOf(rootNote);
    if (rootNoteIndex === -1) return false;

    let parentMajorRootIndex: number;
    
    switch (scaleType) {
        case 'Ionian': parentMajorRootIndex = rootNoteIndex; break;
        case 'Dorian': parentMajorRootIndex = (rootNoteIndex - 2 + 12) % 12; break;
        case 'Phrygian': parentMajorRootIndex = (rootNoteIndex - 4 + 12) % 12; break;
        case 'Lydian': parentMajorRootIndex = (rootNoteIndex - 5 + 12) % 12; break;
        case 'Mixolydian': parentMajorRootIndex = (rootNoteIndex - 7 + 12) % 12; break;
        case 'Aeolian': parentMajorRootIndex = (rootNoteIndex - 9 + 12) % 12; break;
        case 'Locrian': parentMajorRootIndex = (rootNoteIndex - 11 + 12) % 12; break;
        default: return FLAT_MAJOR_ROOTS.has(rootNote);
    }

    const parentMajorRootNote = NOTE_NAMES[parentMajorRootIndex];
    
    return parentMajorRootNote === 'F' || parentMajorRootNote.includes('#');
}

/** Restituisce la tonalità in base alla nota radice e alla qualità */
export function getKeySignature(rootNote: string, quality: 'Major' | 'Minor'): KeySignature {
    let keyForSignature = rootNote;
    if (quality === 'Minor') {
        const rootIndex = noteNameToIndex[rootNote];
        if (rootIndex === undefined) return { type: 'sharp', count: 0 };

        const relativeMajorIndex = (rootIndex + 3) % 12;
        
        const possibleNames = ALL_NOTE_SPELLINGS[relativeMajorIndex];
        
        if (flatMinorKeyRoots.has(rootNote)) {
            keyForSignature = possibleNames.find(n => n.includes('b')) || possibleNames.find(n => !n.includes('#')) || possibleNames[0];
        } else {
            keyForSignature = possibleNames.find(n => !n.includes('b')) || possibleNames[0];
        }
    }

    if (FLAT_KEY_COUNTS.hasOwnProperty(keyForSignature)) {
        return { type: 'flat', count: FLAT_KEY_COUNTS[keyForSignature] };
    }

    // Handle enharmonic spellings not explicitly present in the maps (e.g. D# vs Eb).
    // Pick the closest known spelling for signature purposes.
    try {
        const pc = noteNameToIndex[keyForSignature];
        if (Number.isFinite(pc)) {
            const names = ALL_NOTE_SPELLINGS[pc] || [];
            const flatName = names.find(n => FLAT_KEY_COUNTS.hasOwnProperty(n));
            if (flatName) return { type: 'flat', count: FLAT_KEY_COUNTS[flatName] };
            const sharpName = names.find(n => SHARP_KEY_COUNTS.hasOwnProperty(n));
            if (sharpName) return { type: 'sharp', count: SHARP_KEY_COUNTS[sharpName] ?? 0 };
        }
    } catch {
        // ignore
    }
    
    return { type: 'sharp', count: SHARP_KEY_COUNTS[keyForSignature] ?? 0 };
}


const NOTE_PITCH_TO_POSITION: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

const getNotePosition = (pitch: string, octave: number): number => {
    const letter = (pitch || '').charAt(0).toUpperCase();
    return NOTE_PITCH_TO_POSITION[letter] + (octave - 4) * 7;
};

// =========================================================
// Livello 1 — Struttura intervallare (oggettiva)
// =========================================================

export type BassInterval = {
    /** Diatonic interval number above the bass (1.., compound allowed). */
    number: number;
    /** Chromatic semitone distance above the bass (>= 0). */
    semitones: number;
    /** Alteration relative to major/perfect form of this diatonic interval (e.g. -1 => ♭). */
    alteration: number;
};

export type IntervalSet = {
    bass: StaffNote;
    intervals: BassInterval[];
};

const expectedSemitonesForMajorPerfect = (diatonicNumber: number): number => {
    // Major/perfect simple intervals: 1,2,3,4,5,6,7
    const simple = (((diatonicNumber - 1) % 7) + 7) % 7 + 1;
    const octaves = Math.floor((diatonicNumber - 1) / 7);
    const simpleSemis: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
    return (simpleSemis[simple] ?? 0) + (12 * octaves);
};

export type SpelledInterval = {
    diatonicNumber: number;
    quality: string; // e.g. 'P', 'M', 'm', 'A', 'AA', 'd', 'dd'
};

const accidentalToAlteration = (acc: any): number => {
    const s = String(acc ?? '').trim();
    if (!s) return 0;
    // Accept both internal AccidentalType strings and common glyphs.
    if (s === 'natural' || s === '♮' || s === 'n') return 0;
    if (s === 'sharp' || s === '#'
        || s === '♯') return 1;
    if (s === 'flat' || s === 'b'
        || s === '♭') return -1;
    if (s === 'double-sharp' || s === '##' || s === '𝄪' || s.toLowerCase() === 'x') return 2;
    if (s === 'double-flat' || s === 'bb' || s === '𝄫') return -2;
    // Some states might store raw suffixes.
    if (/^#{1,4}$/.test(s)) return Math.min(4, s.length);
    if (/^b{1,4}$/.test(s)) return -Math.min(4, s.length);
    return 0;
};

const hasExplicitSpelling = (n: any): boolean => {
    try {
        if (!n || n.isRest) return false;
        const p = String(n.pitch || '').trim();
        if (/^[A-Ga-g]([#b]{1,4})$/.test(p)) return true;
        // Explicit accidental fields (user-entered or persisted).
        if (n.userAccidental != null) return true;
        if (n.explicitAccidental != null) return true;
        if (n.accidental != null) return true;
        return false;
    } catch {
        return false;
    }
};

const spelledPitchClassFromSpelling = (n: any): number | null => {
    try {
        if (!n || n.isRest) return null;
        const pitchRaw = String(n.pitch || '').trim();
        const m = pitchRaw.match(/^([A-Ga-g])([#b]{1,4})?$/);
        if (!m) return null;
        const letter = String(m[1] || '').toUpperCase();
        const suffixFromPitch = String(m[2] || '');
        const basePcByLetter: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const basePc = basePcByLetter[letter];
        if (!Number.isFinite(basePc)) return null;

        const alt = suffixFromPitch
            ? (suffixFromPitch.startsWith('#') ? suffixFromPitch.length : -suffixFromPitch.length)
            : accidentalToAlteration(n.userAccidental ?? n.explicitAccidental ?? n.accidental ?? null);
        return mod12(basePc + alt);
    } catch {
        return null;
    }
};

const spelledSimpleIntervalFromRoot = (root: any, other: any): { diatonicNumber: number; semitones: number; quality: string } | null => {
    try {
        if (!root || !other || root.isRest || other.isRest) return null;

        const rPitch = String(root.pitch || '').trim().toUpperCase();
        const oPitch = String(other.pitch || '').trim().toUpperCase();
        const rLetter = rPitch.charAt(0);
        const oLetter = oPitch.charAt(0);
        if (!/^[A-G]$/.test(rLetter) || !/^[A-G]$/.test(oLetter)) return null;

        const letterIndex: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
        const rIdx = letterIndex[rLetter];
        const oIdx = letterIndex[oLetter];
        if (!Number.isFinite(rIdx) || !Number.isFinite(oIdx)) return null;

        const diatonicNumber = ((oIdx - rIdx + 7) % 7) + 1;
        const rPc = spelledPitchClassFromSpelling(root);
        const oPc = spelledPitchClassFromSpelling(other);
        if (rPc == null || oPc == null) return null;

        const semitones = mod12(oPc - rPc);
        const expected = expectedSemitonesForMajorPerfect(diatonicNumber);
        const alteration = semitones - expected;
        const quality = qualityFromDiatonicAndAlteration(diatonicNumber, alteration);
        return { diatonicNumber, semitones, quality };
    } catch {
        return null;
    }
};

const dim7SpellingRootBonus = (root: StaffNote, chordNotes: StaffNote[]): number | null => {
    try {
        const notes = (chordNotes || []).filter(n => n && !n.isRest);
        if (notes.length < 4) return null;

        // Expected °7 tertian structure above the root: m3, d5, d7.
        const expected = [
            { diatonicNumber: 3, semitones: 3, quality: 'm' },
            { diatonicNumber: 5, semitones: 6, quality: 'd' },
            { diatonicNumber: 7, semitones: 9, quality: 'd' },
        ];

        const found = new Set<number>();
        let mismatches = 0;
        for (const other of notes) {
            if (!other || other === root) continue;
            const it = spelledSimpleIntervalFromRoot(root as any, other as any);
            if (!it) continue;

            const idx = expected.findIndex(e => e.diatonicNumber === it.diatonicNumber && e.semitones === it.semitones && e.quality === it.quality);
            if (idx >= 0) {
                found.add(idx);
            } else {
                // If the diatonic number collides with expected but semitones don't, it's a strong sign of wrong enharmonic spelling.
                const collides = expected.some(e => e.diatonicNumber === it.diatonicNumber);
                if (collides) mismatches += 1;
            }
        }

        if (found.size === 0 && mismatches === 0) return null;

        let score = 0;
        score += found.size * 7;
        if (found.size === 3) score += 25;
        score -= mismatches * 3;
        return score;
    } catch {
        return null;
    }
};

const spelledMidiFromPitchAccidentalOctave = (n: any): number | null => {
    try {
        if (!n || n.isRest) return null;
        const octave = Number(n.octave);
        if (!Number.isFinite(octave)) return null;

        const pitchRaw = String(n.pitch || '').trim();
        const m = pitchRaw.match(/^([A-Ga-g])([#b]{1,4})?$/);
        if (!m) return null;
        const letter = String(m[1] || '').toUpperCase();
        const suffix = String(m[2] || '');

        const basePcByLetter: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const basePc = basePcByLetter[letter];
        if (!Number.isFinite(basePc)) return null;

        // Prefer pitch suffix if present; otherwise use accidental fields.
        const alt = suffix
            ? (suffix.startsWith('#') ? suffix.length : -suffix.length)
            : accidentalToAlteration(n.userAccidental ?? n.explicitAccidental ?? n.accidental ?? null);

        // MIDI number derived from spelling (ignores the stored MIDI field).
        return ((octave + 1) * 12) + basePc + alt;
    } catch {
        return null;
    }
};

const qualityFromDiatonicAndAlteration = (diatonicNumber: number, alteration: number): string => {
    const simple = (((diatonicNumber - 1) % 7) + 7) % 7 + 1;
    const isPerfectType = simple === 1 || simple === 4 || simple === 5;

    const alt = Number.isFinite(alteration) ? Math.round(alteration) : 0;
    if (isPerfectType) {
        if (alt === 0) return 'P';
        if (alt > 0) return 'A'.repeat(Math.min(4, alt));
        return 'd'.repeat(Math.min(4, -alt));
    }

    // Major-type intervals: 2,3,6,7
    if (alt === 0) return 'M';
    if (alt === -1) return 'm';
    if (alt > 0) return 'A'.repeat(Math.min(4, alt));
    // alt <= -2 => diminished degrees below minor
    return 'd'.repeat(Math.min(4, (-alt - 1)));
};

const intervalNameFromSemitones = (semitones: number): string => {
    try {
        if (!Number.isFinite(semitones)) return '';
        const s = Math.max(0, Math.round(semitones));
        const oct = Math.floor(s / 12);
        const rem = s % 12;

        // Canonical simple mapping (MIDI-only cannot disambiguate enharmonics like A4 vs d5).
        const simple: Record<number, { q: string; n: number }> = {
            0: { q: 'P', n: 1 },
            1: { q: 'm', n: 2 },
            2: { q: 'M', n: 2 },
            3: { q: 'm', n: 3 },
            4: { q: 'M', n: 3 },
            5: { q: 'P', n: 4 },
            6: { q: 'A4/d5', n: 0 },
            7: { q: 'P', n: 5 },
            8: { q: 'm', n: 6 },
            9: { q: 'M', n: 6 },
            10: { q: 'm', n: 7 },
            11: { q: 'M', n: 7 },
        };

        const base = simple[rem];
        if (!base) return '';
        if (rem === 6) {
            // Tritone: show ambiguity; if compound, still ambiguous.
            return oct > 0 ? `A11/d12` : 'A4/d5';
        }
        const num = base.n + (oct * 7);
        return `${base.q}${num}`;
    } catch {
        return '';
    }
};

const noteSpellingLabel = (n: any): string => {
    try {
        if (!n) return '';
        const pitchRaw = String(n.pitch || '').trim();
        const octave = Number(n.octave);
        const m = pitchRaw.match(/^([A-Ga-g])([#b]{1,4})?$/);
        if (!m) return pitchRaw;
        const letter = String(m[1] || '').toUpperCase();
        const suffixFromPitch = String(m[2] || '');
        const suffix = suffixFromPitch || (() => {
            const alt = accidentalToAlteration(n.userAccidental ?? n.explicitAccidental ?? n.accidental ?? null);
            if (alt > 0) return '#'.repeat(Math.min(4, alt));
            if (alt < 0) return 'b'.repeat(Math.min(4, -alt));
            return '';
        })();
        const oct = Number.isFinite(octave) ? String(octave) : '';
        return `${letter}${suffix}${oct}`;
    } catch {
        return '';
    }
};

/**
 * Spelling-based interval (Two-Track Analysis helper).
 * Computes diatonic number + quality from written spelling (pitch + accidental + octave), ignoring MIDI.
 * Example: C–F# => { diatonicNumber: 4, quality: 'A' } (Augmented 4th)
 */
export function spelledInterval(noteA: StaffNote, noteB: StaffNote): SpelledInterval | null {
    try {
        if (!noteA || !noteB) return null;
        if ((noteA as any).isRest || (noteB as any).isRest) return null;

        const aMidi = spelledMidiFromPitchAccidentalOctave(noteA as any);
        const bMidi = spelledMidiFromPitchAccidentalOctave(noteB as any);
        if (!Number.isFinite(aMidi as any) || !Number.isFinite(bMidi as any)) return null;

        const aPitch = String((noteA as any).pitch || '').charAt(0).toUpperCase();
        const bPitch = String((noteB as any).pitch || '').charAt(0).toUpperCase();
        const aOct = Number((noteA as any).octave);
        const bOct = Number((noteB as any).octave);
        if (!aPitch || !bPitch || !Number.isFinite(aOct) || !Number.isFinite(bOct)) return null;

        // Choose direction by spelled MIDI so semitones are non-negative.
        const low = (aMidi as number) <= (bMidi as number) ? noteA : noteB;
        const high = (aMidi as number) <= (bMidi as number) ? noteB : noteA;
        const lowMidi = Math.min(aMidi as number, bMidi as number);
        const highMidi = Math.max(aMidi as number, bMidi as number);

        const lowPos = getNotePosition(String((low as any).pitch || ''), Number((low as any).octave));
        const highPos = getNotePosition(String((high as any).pitch || ''), Number((high as any).octave));
        let diatonicNumber = (highPos - lowPos) + 1;
        while (diatonicNumber <= 0) diatonicNumber += 7;

        const semitones = Math.max(0, highMidi - lowMidi);
        const expected = expectedSemitonesForMajorPerfect(diatonicNumber);
        const alteration = semitones - expected;
        const quality = qualityFromDiatonicAndAlteration(diatonicNumber, alteration);

        return { diatonicNumber, quality };
    } catch {
        return null;
    }
}

const alterationToGlyph = (alt: number): string => {
    if (!Number.isFinite(alt) || alt === 0) return '';
    if (alt > 0) {
        const n = Math.min(4, Math.round(alt));
        if (n === 2) return '×';        // double-sharp: multiplication sign (U+00D7)
        return '♯'.repeat(n);
    }
    const n = Math.min(4, Math.round(-alt));
    if (n === 2) return '♭♭';          // double-flat: two flat signs
    return '♭'.repeat(n);
};

const midiFromSpelling = (n: any): number | null => {
    try {
        if (!n || n.isRest) return null;
        const octave = Number(n.octave);
        const noteIndexRaw = Number(n.noteIndex);
        if (!Number.isFinite(octave) || !Number.isFinite(noteIndexRaw)) return null;

        const noteIndex = mod12(noteIndexRaw);
        let midi = (octave + 1) * 12 + noteIndex;

        // Handle octave-wrapping enharmonics when pitch letter is preserved but noteIndex is altered.
        // Example: C♭5 is enharmonic to B4. With stored fields { pitch:'C', octave:5, noteIndex:11 },
        // naive MIDI would become B5 (one octave too high). Correct by shifting one octave.
        const letter = String(n.pitch || '').charAt(0).toUpperCase();
        const acc = (n.explicitAccidental ?? n.accidental ?? (n as any).userAccidental) as string | null | undefined;

        const isFlatLike = acc === 'flat' || acc === 'double-flat';
        const isSharpLike = acc === 'sharp' || acc === 'double-sharp';

        // If the letter is C but chromatic index is B/Bb, we crossed the octave boundary downward.
        if (letter === 'C' && (noteIndex === 11 || noteIndex === 10) && (isFlatLike || acc == null)) {
            midi -= 12;
        }
        // If the letter is B but chromatic index is C/C#, we crossed the octave boundary upward.
        if (letter === 'B' && (noteIndex === 0 || noteIndex === 1) && (isSharpLike || acc == null)) {
            midi += 12;
        }

        return midi;
    } catch {
        return null;
    }
};

const effectiveMidi = (n: any): number | null => {
    try {
        if (!n || n.isRest) return null;
        const spelled = midiFromSpelling(n);
        if (Number.isFinite(spelled as any)) return spelled;
        const midi = Number(n.midi);
        return Number.isFinite(midi) ? midi : null;
    } catch {
        return null;
    }
};

/**
 * Livello 1: given simultaneous notes, return the real bass and the set of intervals above it.
 * NOTE: this function does not use key/tonality/roman/symbol.
 */
export function collectIntervalsAboveBass(notes: StaffNote[]): IntervalSet | null {
    try {
        const sounding = (notes || []).filter(n => n && !n.isRest && Number.isFinite(effectiveMidi(n as any)));
        if (sounding.length < 2) return null;

        const pickPreferredBass = (arr: StaffNote[]): StaffNote | null => {
            try {
                const candidates = (arr || []).filter(n => n && !n.isRest && Number.isFinite(effectiveMidi(n as any)));
                if (candidates.length === 0) return null;
                const byVoice4 = candidates.filter(n => Number((n as any).voice) === 4);
                if (byVoice4.length) return byVoice4.slice().sort((a, b) => (effectiveMidi(a as any) ?? 0) - (effectiveMidi(b as any) ?? 0))[0];
                const byBassClef = candidates.filter(n => String((n as any).clef || '') === 'bass');
                if (byBassClef.length) return byBassClef.slice().sort((a, b) => (effectiveMidi(a as any) ?? 0) - (effectiveMidi(b as any) ?? 0))[0];
                return candidates.slice().sort((a, b) => (effectiveMidi(a as any) ?? 0) - (effectiveMidi(b as any) ?? 0))[0];
            } catch {
                return null;
            }
        };

        const bass = pickPreferredBass(sounding);
        if (!bass || !Number.isFinite(effectiveMidi(bass as any))) return null;
        if (typeof bass.pitch !== 'string' || typeof bass.octave !== 'number') return null;

        const bassMidi = effectiveMidi(bass as any) as number;
        const bassPos = getNotePosition(bass.pitch, bass.octave);

        const out: BassInterval[] = [];
        const seen = new Set<string>();

        for (const n of sounding) {
            if (!n) continue;
            if (n === bass) continue;
            const nId = (n as any).id;
            const bassId = (bass as any).id;
            if (nId != null && bassId != null && nId === bassId) continue;
            if (typeof n.pitch !== 'string' || typeof n.octave !== 'number') continue;
            if (!Number.isFinite(effectiveMidi(n as any))) continue;

            const pos = getNotePosition(n.pitch, n.octave);
            let diatonicNumber = (pos - bassPos) + 1;
            while (diatonicNumber <= 0) diatonicNumber += 7;

            const semis = Math.max(0, (effectiveMidi(n as any) as number) - bassMidi);
            const expected = expectedSemitonesForMajorPerfect(diatonicNumber);

            // For figured-bass accidentals, follow the written accidental policy:
            // if a note has no explicit accidental, treat it as unaltered (implied by key signature).
            // This keeps L2 independent from functional interpretation while matching notation conventions.
            const anyN = n as any;
            const hasExplicitAccidental = anyN.explicitAccidental != null;
            const alteration = hasExplicitAccidental ? (semis - expected) : 0;

            const key = `${diatonicNumber}:${alteration}`;
            if (seen.has(key)) continue;
            seen.add(key);

            out.push({ number: diatonicNumber, semitones: semis, alteration });
        }

        return { bass, intervals: out };
    } catch {
        return null;
    }
}

// =========================================================
// Livello 2 — Cifratura del basso (convenzione)
// =========================================================

export type FigureResult = {
    figures: string[];
};

export type FiguredBassOptions = {
    /** Standard convention: omit 5/3 when present. Default: true. */
    omitFiveThree?: boolean;
    /** App display convention: show root-position triads as '5'. Default: false. */
    showRootPositionTriadAs5?: boolean;
    /** If true, allow showing 9/11/13 as extensions when present. Default: false (prefer conventional 2/4/6). */
    showExtensions?: boolean;

    /** If true, show a root-position added 9th as '9' (and omit the implied 3/5). Default: false. */
    showAdd9As9?: boolean;
};

// Single source of truth for how the app *displays* figured bass (L2) in the UI.
// This does not affect the L2 purity (still derived only from L1 intervals), only which
// conventional figures are shown/omitted.
export const FIGURED_BASS_UI_OPTIONS: Readonly<FiguredBassOptions> = Object.freeze({
    omitFiveThree: true,
    showRootPositionTriadAs5: true,
    // Keep academic convention by default (avoid 11/13 just because of spacing),
    // but do show an actual added 9th as '9' for pedagogy.
    showExtensions: false,
    showAdd9As9: true,
});

const normalizeIntervalNumberForFigures = (n: number): number => {
    if (!Number.isFinite(n)) return n;
    let num = Math.round(n);
    while (num > 13) num -= 7;
    while (num <= 0) num += 7;

    // Common simplifications: 10th -> 3rd, 12th -> 5th.
    if (num === 10) return 3;
    if (num === 12) return 5;
    return num;
};

/**
 * Livello 2: compute figured-bass from a set of bass-intervals.
 * PURE: does not depend on key, roman numerals, or chord symbols.
 */
export function computeFiguredBassFromIntervals(intervals: BassInterval[], options: FiguredBassOptions = {}): FigureResult {
    const omitFiveThree = options.omitFiveThree !== false;
    const showRootPositionTriadAs5 = options.showRootPositionTriadAs5 === true;
    const showExtensions = options.showExtensions === true;
    const showAdd9As9 = options.showAdd9As9 === true;

    try {
        if (!intervals || intervals.length === 0) return { figures: [] };

        const reduceToSimpleFigureNumber = (n: number): number => {
            if (!Number.isFinite(n)) return n;
            let num = Math.round(n);
            while (num > 7) num -= 7;
            while (num <= 0) num += 7;
            return num;
        };

        // Two maps:
        // - altBySimple: conventional figured bass (2/4/6 instead of 9/11/13)
        // - altByRaw: keep 9/11/13 availability if the caller explicitly wants extensions
        const altBySimple = new Map<number, number>();
        const altByRaw = new Map<number, number>();

        for (const it of intervals) {
            const raw = normalizeIntervalNumberForFigures(it.number);
            if (!Number.isFinite(raw)) continue;
            if (raw === 1 || raw === 8) continue;
            if (!altByRaw.has(raw)) altByRaw.set(raw, Math.round(it.alteration));

            const simple = reduceToSimpleFigureNumber(raw);
            if (simple === 1) continue;
            if (!altBySimple.has(simple)) altBySimple.set(simple, Math.round(it.alteration));
        }

        const altByNum = altBySimple;

        const has = (n: number) => altByNum.has(n);
        const alt = (n: number) => altByNum.get(n) ?? 0;
        const isAltered = (n: number) => (alt(n) ?? 0) !== 0;

        // Determine the canonical “inversion shorthand” from the raw interval content.
        // This depends only on which interval numbers are present.
        let baseNums: number[] = [];

        // Seventh-chord inversions are identified by their *figured-bass interval sets* above the bass,
        // not by the presence of a 7th above the bass (e.g. Cmaj7/E is 6/5 with 3,5,6 above E).
        if (has(2) && has(4) && has(6)) {
            baseNums = [4, 2];
        } else if (has(3) && has(4) && has(6)) {
            baseNums = [4, 3];
        } else if (has(3) && has(5) && has(6)) {
            baseNums = [6, 5];
        } else if (has(7)) {
            // ── Ninth chords (root position): 7th + 9th present ──
            // V9, V7♭9, etc.: the 9th (raw interval 9, reduced to 2) is above
            // a root-position 7th chord.  Display as 9/7 (or ♭9/7).
            const hasRaw9Root = altByRaw.has(9);
            if (hasRaw9Root && has(2)) {
                baseNums = [9, 7];
            } else {
                // Root-position seventh: show 5/7 when the UI convention shows triads as '5',
                // so the student can see the seventh is added to the triad.
                baseNums = (showRootPositionTriadAs5 && has(5)) ? [5, 7] : [7];
            }
        } else if (has(6) && has(4)) {
            baseNums = [6, 4];
        } else if (has(6)) {
            baseNums = [6];
        } else {
            // Triads / dyads / other sonorities
            if (omitFiveThree && has(3) && has(5) && !isAltered(3) && !isAltered(5)) {
                // Only treat this as a plain 5/3 triad if the sonority contains *only* 3 and 5.
                // If there are extra tones (e.g. added 9th -> simple '2'), do not force a lone '5'.
                const keys = Array.from(altByNum.keys()).filter(n => n !== 1 && n !== 8);
                const isPureTriad = keys.length === 2 && keys.includes(3) && keys.includes(5);
                if (isPureTriad) {
                    baseNums = showRootPositionTriadAs5 ? [5] : [];
                } else {
                    baseNums = keys.sort((a, b) => a - b);
                }
            } else {
                // Keep the interval content as-is (useful for dyads/sus/altered triads/extensions).
                baseNums = Array.from(altByNum.keys()).filter(n => n !== 1 && n !== 8).sort((a, b) => a - b);
            }
        }

        // Special-case (still pure L2): if this verticality is a plain root-position triad
        // with an added 9th, display it as '9' rather than reducing to '2' or forcing '5'.
        // This is a display convention; it does not depend on key/roman/symbol.
        try {
            if (showAdd9As9) {
                const hasRaw9 = altByRaw.has(9);
                const looksLikeAdd9 = hasRaw9 && has(2) && has(3) && has(5) && !has(4) && !has(6) && !has(7);
                if (looksLikeAdd9) {
                    baseNums = [9];
                }
            }
        } catch { /* ignore */ }

        // Optional: show extensions (9/11/13) only when explicitly requested.
        // Default is conventional figured bass (2/4/6) even if the voicing creates compound intervals.
        if (showExtensions) {
            const hasRaw = (n: number) => altByRaw.has(n);
            const extensions = [13, 11, 9].filter(hasRaw);
            for (const n of extensions) if (!baseNums.includes(n)) baseNums.push(n);

            // Prefer the compound figure when explicitly showing extensions.
            // Avoid showing both 2 and 9 (or 4 and 11, 6 and 13).
            if (hasRaw(9)) baseNums = baseNums.filter(n => n !== 2);
            if (hasRaw(11)) baseNums = baseNums.filter(n => n !== 4);
            if (hasRaw(13)) baseNums = baseNums.filter(n => n !== 6);

            // If this is fundamentally a root-position triad (3+5) with added extensions,
            // do not also print the implied 3 and 5.
            // Example: C–E–G–D should show '9', not '9 5 3'.
            try {
                const hasAnyExtension = hasRaw(9) || hasRaw(11) || hasRaw(13);
                const hasTriadCore = baseNums.includes(3) && baseNums.includes(5) && !isAltered(3) && !isAltered(5);
                const hasInversionShorthand = baseNums.some(n => n === 6 || n === 4 || n === 2 || n === 7);
                if (hasAnyExtension && hasTriadCore && !hasInversionShorthand) {
                    baseNums = baseNums.filter(n => n !== 3 && n !== 5);
                }
            } catch { /* ignore */ }

            // Simplification policy (minimal): if 9 or 13 are present, omit 7.
            if ((hasRaw(9) || hasRaw(13)) && baseNums.includes(7)) baseNums = baseNums.filter(n => n !== 7);
        }

        // Apply accidentals to shown figures; if 3/5 are altered, show them even if omitted.
        const shown = new Set<number>(baseNums);
        for (const n of [3, 5]) {
            if (isAltered(n)) shown.add(n);
        }

        const figures = Array.from(shown)
            .filter(n => n !== 1 && n !== 8)
            .sort((a, b) => a - b)
            .map(n => {
                // For compound intervals (9, 11, 13), get alteration from altByRaw
                const a = (n >= 9 ? altByRaw.get(n) : alt(n)) ?? 0;
                return `${alterationToGlyph(a)}${n}`;
            });

        return { figures: normalizeFiguresVertical(figures) };
    } catch {
        return { figures: [] };
    }
}

/** Convenience: Livello 1 -> Livello 2 */
export function computeFiguredBassFromNotes(notes: StaffNote[], options: FiguredBassOptions = {}): FigureResult {
    const l1 = collectIntervalsAboveBass(notes);
    if (!l1) return { figures: [] };
    return computeFiguredBassFromIntervals(l1.intervals, options);
}

/** Restituisce le proprietà di una nota in base alla sua posizione diatonica */
export function getNotePropertiesFromDiatonicPosition(
    position: number,
    clef: ClefType,
    keySignature: KeySignature
): Omit<StaffNote, 'id'| 'duration' | 'isRest' | 'isTriplet' | 'groupId' | 'chordId' | 'measureIndex' | 'beat' | 'xPosition'> {
    const diatonicScale = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

    let baseOctave = 4;
    let basePosition = 0;
    
    const totalDiatonicIndex = basePosition + position;
    const pitchIndex = ((totalDiatonicIndex % 7) + 7) % 7;
    const pitch = diatonicScale[pitchIndex];
    const octaveShift = Math.floor(totalDiatonicIndex / 7);
    const octave = baseOctave + octaveShift;

    const diatonicToChromaticOffset: { [key: string]: number } = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let noteIndex = diatonicToChromaticOffset[pitch as keyof typeof diatonicToChromaticOffset];
    
    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);

    let finalMidi: number;
    const cBaseMidi = (octave + 1) * 12;

    if (keySignature.type === 'sharp' && sharpNotes.includes(pitch)) {
        noteIndex = (noteIndex + 1) % 12;
        finalMidi = cBaseMidi + noteIndex;
    } else if (keySignature.type === 'flat' && flatNotes.includes(pitch)) {
        // Key signatures with 6♭/7♭ (Gb/Cb) include C♭. When deriving MIDI for a diatonic "C",
        // subtracting one semitone wraps 0→11; we must also shift the octave down.
        const nextIndex = (noteIndex - 1 + 12) % 12;
        const needsOctaveCorrection = pitch === 'C' && noteIndex === 0 && nextIndex === 11 && keySignature.count >= 6;
        noteIndex = nextIndex;
        finalMidi = (needsOctaveCorrection ? (cBaseMidi - 12) : cBaseMidi) + noteIndex;
    } else {
        finalMidi = cBaseMidi + noteIndex;
    }
    
    return {
        pitch,
        octave,
        position,
        midi: finalMidi,
        noteIndex,
        clef,
        explicitAccidental: null,
    };
}


/** Restituisce le proprietà di una nota in base al suo valore MIDI */
export function getNotePropertiesFromMidi(
  midi: number,
  keySignature: KeySignature,
  clef: ClefType,
  preferredAccidental: AccidentalType | null
): Omit<StaffNote, 'id'|'duration'|'isRest'|'isTriplet'|'groupId'|'chordId'|'measureIndex'|'beat'|'xPosition'|'voice'> {
  const soundingMidi = midi - 12;
  const noteIndex = mod12(soundingMidi);
  const octave = Math.floor(midi / 12) - 1;

  const possibleNames = ALL_NOTE_SPELLINGS[noteIndex];
  let noteName = possibleNames[0];

  if (possibleNames.length > 1) {
    if (preferredAccidental === 'sharp') {
      noteName = possibleNames.find(n => n.includes('#')) || possibleNames[0];
    } else if (preferredAccidental === 'flat') {
      noteName = possibleNames.find(n => n.includes('b')) || possibleNames[0];
    } else {
      // Smart enharmonic: pick the spelling that matches a key-signature accidental
      // when available; otherwise prefer sharps for raised notes in flat keys
      // (e.g. F# not Gb in Dm) and flats for lowered notes in sharp keys.
      const keySharps = ['F','C','G','D','A','E','B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
      const keyFlats  = ['B','E','A','D','G','C','F'].slice(0, keySignature.type === 'flat'  ? keySignature.count : 0);
      const flatSpelling  = possibleNames.find(n => n.includes('b'));
      const sharpSpelling = possibleNames.find(n => n.includes('#'));
      // Does either spelling match a key-signature note? (e.g. Bb in Dm)
      const flatInKey  = flatSpelling  && keyFlats.includes(flatSpelling.charAt(0));
      const sharpInKey = sharpSpelling && keySharps.includes(sharpSpelling.charAt(0));
      if (flatInKey)       noteName = flatSpelling!;
      else if (sharpInKey) noteName = sharpSpelling!;
      else if (keySignature.type === 'flat' && keySignature.count > 0)
        // Flat key → prefer flat spelling for chromatic tones too
        noteName = flatSpelling || possibleNames[0];
      else
        // Sharp key or C major → prefer non-flat spelling
        noteName = possibleNames.find(n => !n.includes('b')) || possibleNames[0];
    }
  }

  const pitch = noteName.charAt(0);
  const position = getNotePosition(pitch, octave);

  const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
  const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
  const keyAccidentals = keySignature.type === 'sharp'
      ? sharpNotes.map(n => n + '#')
      : flatNotes.map(n => n + 'b');
  
  const explicitAccidental = calculateAccidental(noteName, keyAccidentals);

  return {
    pitch,
    octave,
    position,
    midi,
    noteIndex,
    clef,
    explicitAccidental,
  };
}


/** Restituisce le note del personale per un accordo dato come voicing */
export function getVoicingAsStaffNotes(voicing: Voicing, keySignature: KeySignature, allNotes: DisplayNote[]): StaffNote[] {
    const staffNotes: StaffNote[] = [];
    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
    const keyAccidentals = keySignature.type === 'sharp' ? sharpNotes.map(n => n + '#') : flatNotes.map(n => n + 'b');
    
    const stringMidiBasesReversed = [...STRING_BASE_MIDI].reverse(); 

    voicing.forEach((fret, stringIndex) => {
        if (fret === -1) return;

        const baseMidi = stringMidiBasesReversed[stringIndex];
        const soundingMidi = baseMidi + fret;
        const writtenMidi = soundingMidi + 12;
        const noteIndex = mod12(soundingMidi);
        const noteName = allNotes[noteIndex]?.name || ALL_NOTE_SPELLINGS[noteIndex][0];
        const pitch = noteName.charAt(0);
        const octave = Math.floor(writtenMidi / 12) - 1;
        
        staffNotes.push({
            id: `v-${stringIndex}-${fret}`,
            pitch,
            octave,
            position: getNotePosition(pitch, octave),
            midi: writtenMidi,
            noteIndex: noteIndex,
            explicitAccidental: calculateAccidental(noteName, keyAccidentals),
        });
    });
    return staffNotes;
}

/** Restituisce gli oggetti nota per una scala data */
export function getScaleAsNoteObjects(
   keyNote: string,
   keyQuality: 'Major' | 'Minor',
   scaleType: ScaleType,
   keySignature: KeySignature,
   activeShapeInfo: { shape: ScaleShape; fretPosition: number } | null,
   allScaleIntervals: Record<string, number[]> | null,
   highestVoicingMidi?: number,
   lowestSoundingVoicingMidi?: number
): StaffNote[] {
    const intervalsSource = allScaleIntervals || BUILT_IN_SCALE_INTERVALS;
    let intervals = intervalsSource[scaleType];
    if (scaleType === 'Pentatonic') {
        intervals = keyQuality === 'Major' ? intervalsSource['Major Pentatonic'] : intervalsSource['Pentatonic'];
    }

    if (!intervals) return [];

    const rootNoteIndex = NOTE_NAMES.indexOf(keyNote);
    if (rootNoteIndex === -1) return [];

    const staffNotes: StaffNote[] = [];

    const startMidi = lowestSoundingVoicingMidi ?? 40;
    const endMidi = highestVoicingMidi ? highestVoicingMidi - 12 : 76;

    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
    const keyAccidentals = keySignature.type === 'sharp' ? sharpNotes.map(n => n + '#') : flatNotes.map(n => n + 'b');

    const diatonicLetters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const rootLetter = keyNote.charAt(0);
    const rootLetterIndex = diatonicLetters.indexOf(rootLetter);
    const scaleLetters = [...diatonicLetters.slice(rootLetterIndex), ...diatonicLetters.slice(0, rootLetterIndex)];
    
    const noteNameMap = new Map<number, string>();
    intervals.forEach((interval, i) => {
        const noteIndex = (rootNoteIndex + interval) % 12;
        const degreeLetter = scaleLetters[i % scaleLetters.length];
        const possibleNames = ALL_NOTE_SPELLINGS[noteIndex];
        const noteName = possibleNames.find(name => name.startsWith(degreeLetter)) || possibleNames[0];
        if (!noteNameMap.has(noteIndex)) {
            noteNameMap.set(noteIndex, noteName);
        }
    });

    for (let midi = startMidi; midi <= endMidi; midi++) {
        const writtenMidi = midi + 12;
        const noteIndex = mod12(midi); // was: midi % 12

        if (intervals.includes((noteIndex - rootNoteIndex + 12) % 12)) {
            const noteName = noteNameMap.get(noteIndex) || ALL_NOTE_SPELLINGS[noteIndex][0];
            const pitch = noteName.charAt(0);
            const octave = Math.floor(writtenMidi / 12) - 1;

            const note: StaffNote = {
                id: `scale-${noteIndex}-${octave}`,
                pitch,
                octave,
                position: getNotePosition(pitch, octave),
                midi: writtenMidi,
                noteIndex,
                explicitAccidental: calculateAccidental(noteName, keyAccidentals),
                isPentatonicNote: !!activeShapeInfo
            };
            staffNotes.push(note);
        }
    }
    
    return staffNotes;
}

/** Restituisce le note del personale per il manico della chitarra */
export function getFretboardNotesAsStaffNotes(
    shape: ScaleShape,
    fretPosition: number,
    keySignature: KeySignature,
    allNotes: DisplayNote[]
): StaffNote[] {
    const staffNotes: StaffNote[] = [];
    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
    const keyAccidentals = keySignature.type === 'sharp' ? sharpNotes.map(n => n + '#') : flatNotes.map(n => n + 'b');

    shape.notes.forEach(noteDef => {
        const fret = noteDef.f + fretPosition;
        if (fret < 0 || fret > FRET_COUNT) return;

        const soundingMidi = STRING_BASE_MIDI[noteDef.s] + fret;
        const writtenMidi = soundingMidi + 12;
        const noteIndex = mod12(soundingMidi);
        const noteName = allNotes[noteIndex]?.name || ALL_NOTE_SPELLINGS[noteIndex][0];

        const pitch = noteName.charAt(0);
        const octave = Math.floor(writtenMidi / 12) - 1;
        
        staffNotes.push({
            id: `fret-${noteDef.s}-${fret}`,
            pitch,
            octave,
            position: getNotePosition(pitch, octave),
            midi: writtenMidi,
            noteIndex,
            explicitAccidental: calculateAccidental(noteName, keyAccidentals),
            isPentatonicNote: true,
        });
    });

    return staffNotes.sort((a, b) => a.midi - b.midi);
}

/** Restituisce un dyad come note del personale */
export function getDyadAsStaffNotes(
    rootNotePos: {s: number, f: number},
    semitones: number,
    direction: 'ascending' | 'descending',
    keySignature: KeySignature,
    allNotes: DisplayNote[]
): StaffNote[] {
    const rootSoundingMidi = STRING_BASE_MIDI[rootNotePos.s] + rootNotePos.f;
    const targetSoundingMidi = direction === 'ascending' ? rootSoundingMidi + semitones : rootSoundingMidi - semitones;
    
    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
    const keyAccidentals = keySignature.type === 'sharp' ? sharpNotes.map(n => n + '#') : flatNotes.map(n => n + 'b');

    const createStaffNote = (soundingMidi: number, id: string): StaffNote => {
        const writtenMidi = soundingMidi + 12;
        const noteIndex = mod12(soundingMidi);
        const noteName = allNotes[noteIndex]?.name || ALL_NOTE_SPELLINGS[noteIndex][0];
        const pitch = noteName.charAt(0);
        const octave = Math.floor(writtenMidi / 12) - 1;
        return {
            id,
            pitch,
            octave,
            position: getNotePosition(pitch, octave),
            midi: writtenMidi,
            noteIndex,
            explicitAccidental: calculateAccidental(noteName, keyAccidentals),
        };
    }

    const rootStaffNote = createStaffNote(rootSoundingMidi, 'dyad-root');
    const targetStaffNote = createStaffNote(targetSoundingMidi, 'dyad-target');

    return [rootStaffNote, targetStaffNote].sort((a,b) => a.midi - b.midi);
}

const getInterval = (note1: StaffNote, note2: StaffNote): number => {
    return Math.abs(note1.midi - note2.midi);
};

// Pitch-class extraction must be consistent across the engine.
// In some saved/edited states `noteIndex` can be stale, while `midi` remains reliable.
const pitchClassOf = (n: StaffNote): number => {
    const anyN: any = n as any;

    const midiSrc = (n && Number.isFinite(anyN?.midi)) ? (anyN.midi as number) : null;
    const noteIndexSrc = Number.isFinite(anyN?.noteIndex) ? (anyN.noteIndex as number) : null;

    const pitch = typeof anyN?.pitch === 'string' ? String(anyN.pitch).toUpperCase() : '';
    const accRaw: any = (anyN?.userAccidental ?? anyN?.explicitAccidental ?? anyN?.accidental ?? null);
    const acc = (() => {
        const s = String(accRaw ?? '').trim();
        if (!s) return null;
        // Accept common glyphs the UI may store.
        // - ♯, ♭, ♮
        // - 𝄪, 𝄫
        // - x (double-sharp)
        return s
            .replace(/♯/g, '#')
            .replace(/♭/g, 'b')
            .replace(/♮/g, 'natural')
            .replace(/𝄪/g, '##')
            .replace(/𝄫/g, 'bb')
            .replace(/^x$/i, '##');
    })();

    // Derive pitch-class from spelling when possible.
    // IMPORTANT: do not rely on ALL_NOTE_SPELLINGS for double accidentals (Bbb, Dbb, etc.).
    let spelledPc: number | null = null;
    try {
        spelledPc = spelledPitchClassFromSpelling(anyN);
    } catch { /* ignore */ }

    // If the user explicitly set an accidental, trust the spelling over MIDI.
    // This prevents common UI/edit states where the glyph (explicitAccidental) is updated
    // but MIDI lags by ±1 semitone, which would otherwise mislabel secondary dominants in inversions
    // (e.g. D/F# collapsing to ii6 if F# is treated as F).
    try {
        const hasExplicitAcc = anyN?.userAccidental != null || anyN?.explicitAccidental != null || anyN?.accidental != null || /^[A-G]([#B]{1,4})$/i.test(pitch);
        if (hasExplicitAcc && spelledPc != null) return spelledPc;
    } catch { /* ignore */ }

    // If there is no explicit accidental and noteIndex is set, prefer noteIndex
    // (common when key signature implies a flat/sharp).
    try {
        const hasExplicitAcc = anyN?.userAccidental != null || anyN?.explicitAccidental != null;
        if (!hasExplicitAcc && noteIndexSrc != null) return mod12(noteIndexSrc);
    } catch { /* ignore */ }

    // Prefer MIDI when available (it already encodes key-signature-implied spellings like Bb shown as 'B'),
    // but detect obviously stale MIDI values after edits. If the spelled pitch-class differs by >= 3 semitones,
    // trust the spelling.
    if (midiSrc != null) {
        const midiPc = mod12(midiSrc);
        if (spelledPc != null) {
            const d = Math.abs(midiPc - spelledPc);
            const circ = Math.min(d, 12 - d);
            if (circ >= 3) return spelledPc;
        }
        return midiPc;
    }

    if (spelledPc != null) return spelledPc;
    if (noteIndexSrc != null) return mod12(noteIndexSrc);
    return 0;
};

// Debug helper: returns the unique pitch-classes of a vertical sonority using the same
// pitch-class extraction rules as the harmony engine (accidentals + MIDI fallback).
export function getPitchClassesForDebug(notes: StaffNote[]): number[] {
    try {
        const pcs = (notes || [])
            .filter(n => n && !(n as any).isRest)
            .map(n => mod12(pitchClassOf(n)))
            .filter((x): x is number => Number.isFinite(x));
        return [...new Set(pcs)].sort((a, b) => a - b);
    } catch {
        return [];
    }
}

export function getRomanAnalysisDebugSnapshot(
    chord: StaffNote[],
    keySignatureRoot: string,
    isMinorMode: boolean,
): {
    pcsBase: number[];
    pcsFigures: number[];
    pcsRoman: number[];
    removedForFigures: string[];
    removedForRoman: string[];
} {
    const empty = { pcsBase: [], pcsFigures: [], pcsRoman: [], removedForFigures: [], removedForRoman: [] };
    try {
        if (!chord || chord.length < 2) return empty;

        const uniquePcCount = (notes: StaffNote[]): number => {
            try {
                const pcs = new Set<number>();
                for (const n of (notes || [])) {
                    if (!n || (n as any).isRest) continue;
                    pcs.add(mod12(pitchClassOf(n)));
                }
                return pcs.size;
            } catch {
                return 0;
            }
        };

        const baseChord = (chord || []).filter(n => n && !(n as any).isRest);
        const pcsBase = getPitchClassesForDebug(baseChord);

        // Same base filtering as getRomanAnalysis (remove surface ornaments).
        const filteredForFigures = (chord || []).filter(n => {
            if (!n || (n as any).isRest) return false;
            const anyN = n as any;
            return !(
                anyN.isPassing ||
                anyN.isNeighbor ||
                anyN.isAnticipation ||
                anyN.isAppoggiatura ||
                anyN.isEscape
            );
        });
        let effectiveFigures = filteredForFigures.length >= 2 ? filteredForFigures : baseChord;
        // Mirror getRomanAnalysis: if the ornament filter collapses a clear triad to a dyad, keep the full sonority.
        // Do NOT restore explicit appoggiature (they should not affect Roman labels).
        try {
            const baseCount = uniquePcCount(baseChord);
            const effCount = uniquePcCount(effectiveFigures as any);
            const hasAppoggiatura = baseChord.some((n: any) => !!n?.isAppoggiatura);
            if (!hasAppoggiatura && effectiveFigures.length >= 2 && effCount > 0 && effCount < 3 && baseCount >= 3) {
                effectiveFigures = baseChord;
            }
        } catch { /* ignore */ }
        const pcsFigures = getPitchClassesForDebug(effectiveFigures);

        // Same suspension dissonance filter as getRomanAnalysis.
        const bassForDissonance = (() => {
            try {
                return pickPreferredBassNote((chord || []) as any) as any;
            } catch {
                return null;
            }
        })();
        const isDissonantVsBass = (n: any): boolean => {
            try {
                if (!bassForDissonance || !Number.isFinite(bassForDissonance.midi) || !Number.isFinite(n?.midi)) return false;
                const interval = (((n.midi - bassForDissonance.midi) % 12) + 12) % 12;
                return !([0, 3, 4, 7, 8, 9].includes(interval));
            } catch {
                return false;
            }
        };

        let filteredForRoman = (effectiveFigures || []).filter((n: any) => !(n?.isSuspension && isDissonantVsBass(n)));
        if (filteredForRoman.length < 2) filteredForRoman = effectiveFigures;
        const pcsRoman = getPitchClassesForDebug(filteredForRoman);

        const removedForFigures = baseChord
            .filter(n => !effectiveFigures.some(m => m && m.id === n.id))
            .map(n => String(n.id));

        const removedForRoman = effectiveFigures
            .filter(n => !filteredForRoman.some(m => m && m.id === n.id))
            .map(n => String(n.id));

        // Touch keySignatureRoot/isMinorMode to keep this helper semantically tied to the same context,
        // even though the filtering itself doesn't depend on the key.
        void keySignatureRoot;
        void isMinorMode;

        return { pcsBase, pcsFigures, pcsRoman, removedForFigures, removedForRoman };
    } catch {
        return empty;
    }
}

// ── Augmented-sixth chord detection ──
// Interval-based, spelling-first approach.
// Each pattern is defined as a set of {diatonicNumber, semitones} intervals
// measured FROM THE BASS note. The characteristic augmented 6th interval
// (diatonic 6, semitones 10) is what distinguishes these from enharmonic
// dominants (which would have diatonic 7, semitones 10).
// Order matters: Sw+/Ger+/Fr+ (4-note) must be tested before It+ (3-note).
const AUG6_INTERVAL_PATTERNS: { symbol: string; required: { d: number; s: number }[]; minNotes: number }[] = [
    // ── Standard Aug6 ──
    // Sw+ (Swiss): ♭6–1–#2–#4 → 3M(4st), 4++(7st), 6A(10st)
    { symbol: 'Sw+', required: [{ d: 3, s: 4 }, { d: 4, s: 7 }, { d: 6, s: 10 }], minNotes: 4 },
    // Ger+ (German): ♭6–1–♭3–#4 → 3M(4st), 5P(7st), 6A(10st)
    { symbol: 'Ger+', required: [{ d: 3, s: 4 }, { d: 5, s: 7 }, { d: 6, s: 10 }], minNotes: 4 },
    // Fr+ (French): ♭6–1–2–#4 → 3M(4st), 4A(6st), 6A(10st)
    { symbol: 'Fr+', required: [{ d: 3, s: 4 }, { d: 4, s: 6 }, { d: 6, s: 10 }], minNotes: 4 },

    // ── Variants with 8x (ottava più che eccedente, no 3rd) ──
    // Ger+8x: ♭6–♭3–#4–#8 → 1A(2st), 5P(7st), 6A(10st)
    { symbol: 'Ger+', required: [{ d: 1, s: 2 }, { d: 5, s: 7 }, { d: 6, s: 10 }], minNotes: 4 },
    // Fr+8x: ♭6–2–#4–#8 → 1A(2st), 4A(6st), 6A(10st)
    { symbol: 'Fr+', required: [{ d: 1, s: 2 }, { d: 4, s: 6 }, { d: 6, s: 10 }], minNotes: 4 },

    // ── Variants with 3+ (terza eccedente, replaces 3M) ──
    // Ger+3+: ♭6–F#–♭3–#4 → 3+(5st), 5P(7st), 6A(10st)
    { symbol: 'Ger+', required: [{ d: 3, s: 5 }, { d: 5, s: 7 }, { d: 6, s: 10 }], minNotes: 4 },
    // Fr+3+: ♭6–F#–2–#4 → 3+(5st), 4A(6st), 6A(10st)
    { symbol: 'Fr+', required: [{ d: 3, s: 5 }, { d: 4, s: 6 }, { d: 6, s: 10 }], minNotes: 4 },

    // ── Variants with 5x (quinta più che eccedente, replaces 5P) ──
    // Ger+5x: ♭6–1–A#–#4 → 3M(4st), 5x(9st), 6A(10st)
    { symbol: 'Ger+', required: [{ d: 3, s: 4 }, { d: 5, s: 9 }, { d: 6, s: 10 }], minNotes: 4 },

    // ── Variants with 3+ + 8x (no 5P) ──
    // Ger+3+8x: ♭6–F#–#4–#8 → 1A(2st), 3+(5st), 6A(10st)
    { symbol: 'Ger+', required: [{ d: 1, s: 2 }, { d: 3, s: 5 }, { d: 6, s: 10 }], minNotes: 4 },

    // ── Variants with 5x + 8x (no 3M) ──
    // Ger+5x8x: ♭6–A#–#4–#8 → 1A(2st), 5x(9st), 6A(10st)
    { symbol: 'Ger+', required: [{ d: 1, s: 2 }, { d: 5, s: 9 }, { d: 6, s: 10 }], minNotes: 4 },

    // ── Variants with 3+ + 5x ──
    // Ger+3+5x: ♭6–F#–A#–#4 → 3+(5st), 5x(9st), 6A(10st)
    { symbol: 'Ger+', required: [{ d: 3, s: 5 }, { d: 5, s: 9 }, { d: 6, s: 10 }], minNotes: 4 },

    // ── It+ (Italian, last — fewest required) ──
    // It+: ♭6–1–#4 → 3M(4st), 6A(10st)
    { symbol: 'It+', required: [{ d: 3, s: 4 }, { d: 6, s: 10 }], minNotes: 3 },
    // It+ with 3+: ♭6–F#–#4 → 3+(5st), 6A(10st)
    { symbol: 'It+', required: [{ d: 3, s: 5 }, { d: 6, s: 10 }], minNotes: 3 },
];

const CHROMATIC_CHORD_DEFINITIONS: { [key: string]: { symbol: string, matcher: (chord: StaffNote[], keyInfo: { tonicIndex: number, isMinor: boolean }) => boolean } } = {};

// Group patterns by symbol so multiple patterns map to one entry.
const _aug6BySymbol = new Map<string, typeof AUG6_INTERVAL_PATTERNS>();
for (const p of AUG6_INTERVAL_PATTERNS) {
    if (!_aug6BySymbol.has(p.symbol)) _aug6BySymbol.set(p.symbol, []);
    _aug6BySymbol.get(p.symbol)!.push(p);
}
// Preserve order: use the position of the first pattern for each symbol.
const _aug6Symbols: string[] = [];
for (const p of AUG6_INTERVAL_PATTERNS) {
    if (!_aug6Symbols.includes(p.symbol)) _aug6Symbols.push(p.symbol);
}

for (const sym of _aug6Symbols) {
    const patterns = _aug6BySymbol.get(sym)!;
    CHROMATIC_CHORD_DEFINITIONS[sym] = {
        symbol: sym,
        matcher: (chord, keyInfo) => {
            const validNotes = chord.filter(n => n && !(n as any).isRest);

            // Require at least one chromatic note (not in the home scale).
            const homeScale = new Set(
                (keyInfo.isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11])
                    .map(iv => (keyInfo.tonicIndex + iv) % 12));
            const pcs = validNotes.map(pitchClassOf);
            if (!pcs.some(pc => !homeScale.has(pc))) return false;

            // Try each note as potential root (fondamentale).
            // In root position the root is the bass, but in inversions any
            // note could be the root; the defining intervals are the same.
            for (const root of validNotes) {
                const intervals: { d: number; s: number }[] = [];
                for (const n of validNotes) {
                    if (n === root) continue;
                    const iv = spelledSimpleIntervalFromRoot(root as any, n as any);
                    if (iv) intervals.push({ d: iv.diatonicNumber, s: iv.semitones });
                }

                const matched = patterns.some(pattern => {
                    if (validNotes.length < pattern.minNotes) return false;
                    return pattern.required.every(req =>
                        intervals.some(iv => iv.d === req.d && iv.s === req.s));
                });
                if (matched) return true;
            }
            return false;
        },
    };
}
Object.freeze(CHROMATIC_CHORD_DEFINITIONS);

const getDirection = (notePrev: StaffNote, noteCurr: StaffNote): 'ASCENDING' | 'DESCENDING' | 'STATIONARY' => {
    if (noteCurr.midi > notePrev.midi) return 'ASCENDING';
    if (noteCurr.midi < notePrev.midi) return 'DESCENDING';
    return 'STATIONARY';
};

const isLeap = (notePrev: StaffNote, noteCurr: StaffNote): boolean => {
    return getInterval(notePrev, noteCurr) > 2;
};

const VOICE_RANGES: Record<Voice, { minMidi: number, maxMidi: number, name: string }> = {
    1: { minMidi: 60, maxMidi: 81, name: 'Soprano' }, // C4 to A5
    2: { minMidi: 55, maxMidi: 74, name: 'Alto' },    // G3 to D5
    3: { minMidi: 48, maxMidi: 67, name: 'Tenore' },   // C3 to G4
    4: { minMidi: 40, maxMidi: 60, name: 'Basso' },    // E2 to C4
};

const CHORD_CHECK_ORDER: ChordType[] = [
    BuiltInChords.Dominant9_13, BuiltInChords.Major13, BuiltInChords.Minor13,
    BuiltInChords.Dominant13, BuiltInChords.Dominant7b13, BuiltInChords.Dominant11,
    BuiltInChords.Dominant7sharp11, BuiltInChords.Major9, BuiltInChords.Minor9,
    BuiltInChords.Dominant9, BuiltInChords.Dominant7b9, BuiltInChords.Dominant7sharp9,
    BuiltInChords.Minor11, BuiltInChords.Add9, BuiltInChords.MinorAdd9, BuiltInChords.Major7,
    BuiltInChords.MinorMajor7,
    BuiltInChords.Minor7, BuiltInChords.Dominant7, BuiltInChords.Diminished7,
    BuiltInChords.Minor7b5, BuiltInChords.Major6, BuiltInChords.Minor6,
    BuiltInChords.Sus2, BuiltInChords.Sus4, BuiltInChords.Major,
    BuiltInChords.Minor, BuiltInChords.Diminished, BuiltInChords.Augmented,
];

type MatchType = 'exact' | 'no_fifth' | 'no_third' | null;

function checkChordMatch(
    intervals: Set<number>,
    formula: number[],
    chordType: ChordType
): MatchType {
    const formulaSet = new Set(formula);
    if (intervals.size > formulaSet.size) return null;

    for (const interval of intervals) {
        if (!formulaSet.has(interval)) {
            return null;
        }
    }

    if (intervals.size === formulaSet.size) {
        return 'exact';
    }

    const fifth = [7, 6, 8].find(f => formulaSet.has(f));
    if (fifth !== undefined && intervals.size === formulaSet.size - 1 && !intervals.has(fifth)) {
        return 'no_fifth';
    }

    // Allow dominant chords without the 3rd when the 7th is present.
    // This rescues common tonal "shell" voicings (root + 5th + 7th) used in voice-leading,
    // enabling correct secondary dominants like V7/V.
    try {
        if (typeof chordType === 'string' && chordType.startsWith('Dominant')) {
            const third = 4; // dominant quality uses a major 3rd
            const seventh = 10; // minor 7th for dominant-type chords
            if (formulaSet.has(third) && formulaSet.has(seventh)) {
                if (intervals.size === formulaSet.size - 1 && !intervals.has(third) && intervals.has(seventh)) {
                    return 'no_third';
                }
            }
        }
    } catch {
        // ignore
    }

    return null;
}


function findStandardCandidates(
    uniqueNotes: StaffNote[],
    uniquePitches: number[]
): { root: StaffNote; type: string; intervals: Set<number>, priority: number, matchType: MatchType }[] {
    const candidates: { root: StaffNote; type: string; intervals: Set<number>, priority: number, matchType: MatchType }[] = [];

    for (const potentialRootNote of uniqueNotes) {
        const rootPitch = potentialRootNote.noteIndex; // was: potentialRootNote.midi % 12
        const intervals = new Set(uniquePitches.map(p => (p - rootPitch + 12) % 12));

        for (const chordType of CHORD_CHECK_ORDER) {
            const formula = CHORD_FORMULAS[chordType as keyof typeof CHORD_FORMULAS];
            if (!formula) continue;

            const matchType = checkChordMatch(intervals, formula, chordType);
            if (matchType) {
                candidates.push({ root: potentialRootNote, type: chordType, intervals, priority: CHORD_CHECK_ORDER.indexOf(chordType), matchType });
            }
        }
    }
    return candidates;
}

function pickPreferredBassNote(notes: StaffNote[]): StaffNote | null {
    try {
        const candidates = (notes || []).filter(n => n && !n.isRest && Number.isFinite(effectiveMidi(n as any)));
        if (candidates.length === 0) return null;
        const byVoice4 = candidates.filter(n => Number((n as any).voice) === 4);
        if (byVoice4.length) return byVoice4.slice().sort((a, b) => (effectiveMidi(a as any) ?? 0) - (effectiveMidi(b as any) ?? 0))[0];
        const byBassClef = candidates.filter(n => String((n as any).clef || '') === 'bass');
        if (byBassClef.length) return byBassClef.slice().sort((a, b) => (effectiveMidi(a as any) ?? 0) - (effectiveMidi(b as any) ?? 0))[0];
        return candidates.slice().sort((a, b) => (effectiveMidi(a as any) ?? 0) - (effectiveMidi(b as any) ?? 0))[0];
    } catch {
        return null;
    }
}

function identifyChord(notes: StaffNote[]): { root: StaffNote; type: string; intervals: Set<number> } | null {
    if (!notes || notes.length < 2) return null;
    const validNotes = notes.filter(n => !n.isRest);
    if (validNotes.length < 2) return null;

    const pcToNote = new Map<number, StaffNote>();
    for (const n of validNotes) {
        const pc = pitchClassOf(n);
        if (!pcToNote.has(pc)) {
            pcToNote.set(pc, { ...n, noteIndex: pc });
        }
    }
    const uniqueNotes = [...pcToNote.values()];
    const uniquePitches = uniqueNotes.map(n => n.noteIndex);
    const bassNote = pickPreferredBassNote(validNotes) || validNotes[0];
    const bassPc = bassNote ? pitchClassOf(bassNote) : null;

    const allCandidates: { 
        root: StaffNote; 
        type: string; 
        intervals: Set<number>; 
        priority: number;
        matchType: MatchType;
        score: number; 
    }[] = [];

    const standardCandidates = findStandardCandidates(uniqueNotes, uniquePitches);
    standardCandidates.forEach(c => allCandidates.push({ ...c, score: 0 }));

    if (allCandidates.length === 0) return null;

    const isSeventhLike = (t: string): boolean => {
        const s = String(t || '');
        return s.includes('7') || s.includes('9') || s.includes('11') || s.includes('13');
    };
    const isSixthChord = (t: string): boolean => {
        const s = String(t || '');
        // Treat added-sixth chords as '6' chords; exclude 13ths (they include '13').
        return s.includes('6') && !s.includes('13');
    };
    const hasExactSeventhCandidate = allCandidates.some(c => c.matchType === 'exact' && isSeventhLike(c.type));

    for (const candidate of allCandidates) {
        let score = 0;
        
        if (candidate.matchType === 'exact') {
            score += 20; 
        } else if (candidate.matchType === 'no_fifth') {
            score += 10;
        } else if (candidate.matchType === 'no_third') {
            score += 9;
        }

        score += (CHORD_CHECK_ORDER.length - candidate.priority);

        // Prefer exact tertian 7th chords (especially ø7/°7) even when inverted.
        if (candidate.matchType === 'exact' && (candidate.type === BuiltInChords.Minor7b5 || candidate.type === BuiltInChords.Diminished7)) {
            score += 30;
        }

        // Spelling-first guardrail:
        // When the 5th is missing (no_fifth), a simple dyad (root+3rd) can match BOTH Minor and Diminished.
        // Do not invent a diminished quality unless the diminished 5th is actually present.
        // This prevents wrong labels like vii° on non-diminished sonorities.
        try {
            const isDimFamily = candidate.type === BuiltInChords.Diminished || candidate.type === BuiltInChords.Minor7b5;
            if (isDimFamily && candidate.matchType === 'no_fifth') {
                score -= 40;
            }
        } catch { /* ignore */ }

        // Guardrail: do not classify a sonority as a dominant-type chord unless it actually
        // contains the dominant 7th (minor 7th above the root). This prevents false V/x
        // labels caused by added 9ths/13ths without a tritone-bearing core.
        try {
            if (typeof candidate.type === 'string' && candidate.type.startsWith('Dominant')) {
                const hasDom7th = candidate.intervals?.has(10);
                if (!hasDom7th) score -= 1000;
            }
        } catch { /* ignore */ }
        
        // Prefer candidates where the detected root matches the actual bass note
        // (helps identify inversions/sus chords). However, avoid this bias for symmetric
        // sonorities like fully diminished 7ths: in those cases "root=bass" is arbitrary
        // and leads to unstable/unnatural functional readings.
        const isSymmetricDim7 = candidate.type === BuiltInChords.Diminished7;
        // Important: if an exact 7th-chord interpretation exists (e.g. Dm7/F),
        // do not let an added-sixth chord (e.g. F6) win just because its root equals the bass.
        const allowBassRootBonus = !hasExactSeventhCandidate || !isSixthChord(candidate.type) || isSeventhLike(candidate.type);
        if (!isSymmetricDim7 && allowBassRootBonus && bassPc != null && candidate.root.noteIndex === bassPc) score += 5;

        // For fully diminished 7ths, prefer a spelling-consistent root (chain of thirds)
        // when the user provided explicit spelling; otherwise fall back to a deterministic root.
        if (isSymmetricDim7) {
            const bonus = dim7SpellingRootBonus(candidate.root, uniqueNotes);
            if (bonus != null) {
                score += bonus;
            } else {
                const minPc = Math.min(...uniquePitches);
                if (candidate.root.noteIndex === minPc) score += 3;
            }
        }
        candidate.score = score;
    }

    // ── Spelling-first filter: penalise candidates with enharmonic mismatches ──
    // Applied only as a tiebreaker: when two candidates have similar base scores,
    // prefer the one whose root spelling matches the written notes.
    const SPELLING_WEIGHT = 8;
    const _LETTER_IDX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
    const _IDX2LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const _BASE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const _ITV2STEP: Record<number, number> = { 0:0, 1:1, 2:1, 3:2, 4:2, 5:3, 6:3, 7:4, 8:4, 9:5, 10:6, 11:6 };
    const _letterOf = (n: any): string | null => {
        const p = String(n?.pitch || '').trim().toUpperCase();
        const m = p.match(/^([A-G])/);
        return m ? m[1] : null;
    };
    const _accAlt = (n: any): number => {
        const p = String(n?.pitch || '').trim();
        const m2 = p.match(/^[A-Ga-g]([#b]+)$/);
        if (m2) return m2[1][0] === '#' ? m2[1].length : -m2[1].length;
        const acc = n?.userAccidental ?? n?.explicitAccidental ?? n?.accidental ?? null;
        if (!acc) return 0;
        const a = String(acc).trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/♮/g, '');
        if (a.startsWith('#')) return a.length;
        if (a.startsWith('b')) return -a.length;
        return 0;
    };
    const _spCost = (candidate: any): number => {
        try {
            const rl = _letterOf(candidate.root);
            if (!rl) return 0;
            const rIdx = _LETTER_IDX[rl];
            const rPc = ((_BASE_PC[rl] + _accAlt(candidate.root)) % 12 + 12) % 12;
            const expected = new Map<number, string>();
            for (const itv of candidate.intervals) {
                const pc = ((rPc + itv) % 12 + 12) % 12;
                const step = _ITV2STEP[itv] ?? 0;
                expected.set(pc, _IDX2LET[(rIdx + step) % 7]);
            }
            if (expected.size === 0) return 0;
            let cost = 0;
            const seen = new Set<number>();
            for (const n of uniqueNotes) {
                if (!n || (n as any).isRest) continue;
                const nl = _letterOf(n);
                if (!nl) continue;
                const midi = Number((n as any).midi ?? n.noteIndex);
                if (!Number.isFinite(midi)) continue;
                const pc = ((midi % 12) + 12) % 12;
                if (seen.has(pc)) continue;
                seen.add(pc);
                const exp = expected.get(pc);
                if (exp && exp !== nl) cost += 1;
            }
            return cost;
        } catch { return 0; }
    };
    // Sort first by base score, then apply spelling as tiebreaker
    // between candidates whose base scores are within a narrow band.
    allCandidates.sort((a, b) => b.score - a.score);
    if (allCandidates.length >= 2) {
        const topScore = allCandidates[0].score;
        // Gather candidates with exactly the same score (pure tiebreaker)
        const tieband = allCandidates.filter(c => c.score === topScore);
        if (tieband.length >= 2) {
            for (const c of tieband) {
                (c as any)._spCost = _spCost(c);
            }
            tieband.sort((a, b) => {
                const da = (a as any)._spCost * SPELLING_WEIGHT;
                const db = (b as any)._spCost * SPELLING_WEIGHT;
                return (b.score - db) - (a.score - da);
            });
            // Replace the head of allCandidates with the tieband result
            const rest = allCandidates.filter(c => topScore - c.score > 5);
            allCandidates.length = 0;
            allCandidates.push(...tieband, ...rest);
        }
    }
    const { score, priority, matchType, ...bestMatch } = allCandidates[0];
    return bestMatch;
}

// Return detailed candidate list for debugging/inspection.
export function identifyChordCandidates(notes: StaffNote[], ornamentOverrides?: Record<string, string>) {
    if (!notes || notes.length < 2) return [];
    // ── Filter out manually overridden ornamental notes ──
    const effectiveNotes = ornamentOverrides
        ? notes.filter(n => {
            if (!n) return true;
            const a = n as any;
            const t1 = ornamentOverrides[a.id];
            if (t1 && t1 !== 'structural') return false;
            const midi = Number(a.midi);
            if (Number.isFinite(midi)) {
                const t2 = ornamentOverrides[`${midi}-${a.measureIndex ?? -1}-${a.beat ?? -1}`];
                if (t2 && t2 !== 'structural') return false;
            }
            return true;
        })
        : notes;
    if (effectiveNotes.length < 2) return [];
    const validNotes = effectiveNotes.filter(n => !n.isRest);
    if (validNotes.length < 2) return [];

    const pcToNote = new Map<number, StaffNote>();
    for (const n of validNotes) {
        const pc = pitchClassOf(n);
        if (!pcToNote.has(pc)) {
            pcToNote.set(pc, { ...n, noteIndex: pc });
        }
    }
    const uniqueNotes = [...pcToNote.values()];
    const uniquePitches = uniqueNotes.map(n => n.noteIndex);
    const bassNote = pickPreferredBassNote(validNotes) || validNotes[0];
    const bassPc = bassNote ? pitchClassOf(bassNote) : null;

    const allCandidates: { 
        root: StaffNote; 
        type: string; 
        intervals: Set<number>; 
        priority: number;
        matchType: MatchType;
        score: number; 
    }[] = [];

    const standardCandidates = findStandardCandidates(uniqueNotes, uniquePitches);
    standardCandidates.forEach(c => allCandidates.push({ ...c, score: 0 }));

    const isSeventhLike = (t: string): boolean => {
        const s = String(t || '');
        return s.includes('7') || s.includes('9') || s.includes('11') || s.includes('13');
    };
    const isSixthChord = (t: string): boolean => {
        const s = String(t || '');
        return s.includes('6') && !s.includes('13');
    };
    const hasExactSeventhCandidate = allCandidates.some(c => c.matchType === 'exact' && isSeventhLike(c.type));

    for (const candidate of allCandidates) {
        let score = 0;
        if (candidate.matchType === 'exact') score += 20;
        else if (candidate.matchType === 'no_fifth') score += 10;
        else if (candidate.matchType === 'no_third') score += 9;
        score += (CHORD_CHECK_ORDER.length - candidate.priority);
        if (candidate.matchType === 'exact' && (candidate.type === BuiltInChords.Minor7b5 || candidate.type === BuiltInChords.Diminished7)) {
            score += 30;
        }

        // Spelling-first guardrail (see identifyChord): avoid diminished-family guesses when 5th is missing.
        try {
            const isDimFamily = candidate.type === BuiltInChords.Diminished || candidate.type === BuiltInChords.Minor7b5;
            if (isDimFamily && candidate.matchType === 'no_fifth') {
                score -= 40;
            }
        } catch { /* ignore */ }
        const isSymmetricDim7 = candidate.type === BuiltInChords.Diminished7;
        const allowBassRootBonus = !hasExactSeventhCandidate || !isSixthChord(candidate.type) || isSeventhLike(candidate.type);
        if (!isSymmetricDim7 && allowBassRootBonus && bassPc != null && candidate.root.noteIndex === bassPc) score += 5;
        if (isSymmetricDim7) {
            const bonus = dim7SpellingRootBonus(candidate.root, uniqueNotes);
            if (bonus != null) {
                score += bonus;
            } else {
                const minPc = Math.min(...uniquePitches);
                if (candidate.root.noteIndex === minPc) score += 3;
            }
        }
        candidate.score = score;
    }

    allCandidates.sort((a, b) => b.score - a.score);
    return allCandidates;
}

export function calculateRomanFromChordInfo(
    chordInfo: { root: StaffNote; type: string; intervals?: Set<number> },
    keySignatureRoot: string,
    isMinorMode: boolean
): string | null {
    try {
        const keyTonicIndex = noteNameToIndex[keySignatureRoot];
        if (keyTonicIndex === undefined) return null;
        const keyInfo = { tonicIndex: keyTonicIndex, isMinor: isMinorMode };
        return calculateRomanNumeral(chordInfo, keyInfo);
    } catch (_) { return null; }
}



const CHORD_TYPE_TO_SYMBOL: Partial<Record<ChordType, string>> = {
  [BuiltInChords.Major]: '',
  [BuiltInChords.Minor]: 'm',
  [BuiltInChords.Augmented]: 'aug',
  [BuiltInChords.Diminished]: '°',
  [BuiltInChords.Sus2]: 'sus2',
  [BuiltInChords.Sus4]: 'sus4',
  [BuiltInChords.Major7]: 'maj7',
  [BuiltInChords.Minor7]: 'm7',
    [BuiltInChords.MinorMajor7]: 'm(maj7)',
  [BuiltInChords.Dominant7]: '7',
  [BuiltInChords.Diminished7]: '°7',
  [BuiltInChords.Minor7b5]: 'm7♭5',
  [BuiltInChords.Major6]: '6',
  [BuiltInChords.Minor6]: 'm6',
  [BuiltInChords.Major9]: 'maj9',
  [BuiltInChords.Minor9]: 'm9',
  [BuiltInChords.Dominant9]: '9',
  [BuiltInChords.Add9]: 'add9',
  [BuiltInChords.MinorAdd9]: 'm(add9)',
  [BuiltInChords.Dominant7b9]: '7♭9',
  [BuiltInChords.Dominant7sharp9]: '7♯9',

  // FIX: this entry (and the rest) was truncated, causing "Expected ]".
  [BuiltInChords.Minor11]: 'm11',
  [BuiltInChords.Dominant11]: '11',
  [BuiltInChords.Dominant7sharp11]: '7♯11',
  [BuiltInChords.Major13]: 'maj13',
  [BuiltInChords.Minor13]: 'm13',
  [BuiltInChords.Dominant13]: '13',
  [BuiltInChords.Dominant7b13]: '7♭13',
  [BuiltInChords.Dominant9_13]: '13(add9)',
};

// --- RESTORE: exports expected by GrandStaffEditor.tsx ---

export function getChordSymbol(
    chord: StaffNote[],
    keySignature: KeySignature,
    contextTonic?: string
): string | null {
    if (!chord || chord.length < 2) return null;

    const uniquePcCount = (notes: StaffNote[]): number => {
        try {
            const pcs = new Set<number>();
            for (const n of (notes || [])) {
                if (!n || (n as any).isRest) continue;
                pcs.add(mod12(pitchClassOf(n)));
            }
            return pcs.size;
        } catch {
            return 0;
        }
    };

    // Display symbols should represent the underlying harmony, not surface dissonances.
    // Filter common non-chord tones + suspension/ritardo notes that would otherwise
    // distort the detected chord into misleading sus/slash readings.
    let filteredChord = (chord || []).filter(n => {
        if (!n || n.isRest) return false;
        const anyN = n as any;
        return !(
            anyN.isPassing ||
            anyN.isNeighbor ||
            anyN.isAnticipation ||
            anyN.isAppoggiatura ||
            anyN.isEscape
        );
    });

    // If NCT filtering collapses a clear triad to a dyad, keep the full sonority for symbol detection.
    try {
        const base = (chord || []).filter(n => n && !(n as any).isRest);
        const baseCount = uniquePcCount(base as any);
        const filteredCount = uniquePcCount(filteredChord as any);
        if (filteredChord.length >= 2 && filteredCount > 0 && filteredCount < 3 && baseCount >= 3) {
            filteredChord = base as any;
        }
    } catch { /* ignore */ }

    if (filteredChord.length < 2) {
        const fallback = (chord || []).filter(n => n && !n.isRest);
        if (fallback.length < 2) return null;
        filteredChord = fallback;
    }

    const keyUsesFlats = keySignature.type === 'flat' && keySignature.count > 0;
    const tonicIndex = (contextTonic && noteNameToIndex[contextTonic] !== undefined)
        ? noteNameToIndex[contextTonic]
        : undefined;

    const pickFromSpellings = (noteIndex: number, prefer: 'flat' | 'sharp' | 'auto'): string => {
        const possibleNames = ALL_NOTE_SPELLINGS[noteIndex];
        if (possibleNames.length <= 1) return possibleNames[0];

        if (prefer === 'flat') return possibleNames.find(n => n.includes('b')) || possibleNames[1] || possibleNames[0];
        if (prefer === 'sharp') return possibleNames.find(n => n.includes('#')) || possibleNames[0];

        return keyUsesFlats
            ? (possibleNames.find(n => n.includes('b')) || possibleNames[1] || possibleNames[0])
            : (possibleNames.find(n => !n.includes('b')) || possibleNames[0]);
    };

    const preferAccidentalForIndex = (noteIndex: number): 'flat' | 'sharp' | 'auto' => {
        // If we know the tonic, prefer conventional chromatic-degree spellings:
        // ♭2, ♭3, ♭6, ♭7 -> flats; ♯4 -> sharps. (Keeps Ab instead of G# in C.)
        if (tonicIndex !== undefined) {
            const rel = (noteIndex - tonicIndex + 12) % 12;
            if (rel === 1 || rel === 3 || rel === 8 || rel === 10) return 'flat';
            if (rel === 6) return 'sharp';
        }
        return 'auto';
    };
    const getNoteName = (noteIndex: number): string => pickFromSpellings(noteIndex, preferAccidentalForIndex(noteIndex));

    // Rootless V7(♭9) heuristic (see getRomanAnalysis): if the chord's pitch-classes
    // are a subset of the leading-tone fully diminished 7th, represent it as V7♭9
    // even if the root is missing.
    try {
        if (tonicIndex !== undefined) {
            const valid = (filteredChord || []).filter(n => n && !n.isRest);
            const pcs = [...new Set(valid.map(pitchClassOf).map(mod12))];
            const leadingPc = mod12(tonicIndex - 1);
            const dominantPc = mod12(tonicIndex + 7);
            const dim7Set = new Set<number>([
                leadingPc,
                mod12(leadingPc + 3),
                mod12(leadingPc + 6),
                mod12(leadingPc + 9),
            ]);
            // IMPORTANT: be strict. Subsets like {F#,A,C} occur constantly in real voice-leading
            // and should NOT be reinterpreted as a missing-root/missing-3rd V7♭9.
            // Only interpret as rootless V7♭9 when the full dim7 collection is present and
            // includes the leading tone.
            const subset = pcs.length >= 4 && pcs.every(pc => dim7Set.has(pc));
            const hasLeading = pcs.includes(leadingPc);
            if (subset && hasLeading) {
                const rootName = getNoteName(dominantPc);
                let analysisText = `${rootName}${CHORD_TYPE_TO_SYMBOL[BuiltInChords.Dominant7b9] ?? '7♭9'}`;

                const bassNote = pickPreferredBassNote(valid) || valid[0];
                if (bassNote && mod12(bassNote.noteIndex) !== dominantPc) {
                    analysisText += `/${getNoteName(mod12(bassNote.noteIndex))}`;
                }
                return analysisText;
            }
        }
    } catch { /* ignore */ }

    const fullChord = (chord || []).filter(n => n && !n.isRest);
    const chordInfo = identifyChord(filteredChord) || identifyChord(fullChord);

    // Dominant-7 rescue: sometimes voice-leading / suspension markers can cause the generic
    // chord-ID to mis-root a clear dominant sonority (e.g. Bb7/Ab becoming Fm/Ab).
    // If the pitch-class set contains the dominant core (M3 + m7), prefer that as the symbol root.
    try {
        const allPcs = new Set<number>(fullChord.map(pitchClassOf).map(mod12));
        const pcsArr = [...allPcs];

        const findDominantRoot = (): number | null => {
            for (const r of pcsArr) {
                if (allPcs.has(mod12(r + 4)) && allPcs.has(mod12(r + 10))) return r;
            }
            return null;
        };

        const domRootPc = findDominantRoot();
        if (domRootPc != null) {
            const chordIsDominant = (() => {
                const t = String((chordInfo as any)?.type || '');
                return t.startsWith('Dominant') || t === BuiltInChords.Dominant7 || t === BuiltInChords.Dominant7b9;
            })();
            const chordRootPc = chordInfo?.root ? pitchClassOf(chordInfo.root) : null;

            if (!chordIsDominant || chordRootPc == null || mod12(chordRootPc) !== mod12(domRootPc)) {
                const rootName = getNoteName(domRootPc);
                let analysisText = `${rootName}${CHORD_TYPE_TO_SYMBOL[BuiltInChords.Dominant7] ?? '7'}`;

                // Append tensions from the full pitch-class set.
                const ints = new Set<number>([...allPcs].map(pc => mod12(pc - domRootPc)));
                const addIfPresent = (interval: number, token: string) => {
                    if (ints.has(interval) && !analysisText.includes(token)) analysisText += token;
                };
                addIfPresent(1, '♭9');
                addIfPresent(3, '♯9');
                addIfPresent(5, '11');
                addIfPresent(6, '♯11');
                addIfPresent(8, '♭13');
                addIfPresent(9, '13');

                const bassNote = pickPreferredBassNote(fullChord) || fullChord[0];
                const bassPc = bassNote ? pitchClassOf(bassNote) : domRootPc;
                if (bassPc !== domRootPc) analysisText += `/${getNoteName(bassPc)}`;
                return analysisText;
            }
        }
    } catch { /* ignore */ }

    // If the sonority contains a dominant core (M3 + m7) but multiple altered tensions
    // prevent a strict chord-type match, still show a dominant-7 symbol and append tensions.
    if (!chordInfo) {
        const allPcs = new Set<number>(fullChord.map(pitchClassOf).map(mod12));
        const pcsArr = [...allPcs];

        const findDominantRoot = (): number | null => {
            for (const r of pcsArr) {
                if (allPcs.has(mod12(r + 4)) && allPcs.has(mod12(r + 10))) return r;
            }
            return null;
        };

        const rootPc = findDominantRoot();
        if (rootPc == null) return null;

        const rootName = getNoteName(rootPc);
        let analysisText = `${rootName}${CHORD_TYPE_TO_SYMBOL[BuiltInChords.Dominant7] ?? '7'}`;

        // Append tensions from the full pitch-class set.
        const ints = new Set<number>([...allPcs].map(pc => mod12(pc - rootPc)));
        const addIfPresent = (interval: number, token: string) => {
            if (ints.has(interval) && !analysisText.includes(token)) analysisText += token;
        };
        addIfPresent(1, '♭9');
        addIfPresent(3, '♯9');
        addIfPresent(5, '11');
        addIfPresent(6, '♯11');
        addIfPresent(8, '♭13');
        addIfPresent(9, '13');

        const bassNote = pickPreferredBassNote(fullChord) || fullChord[0];
        const bassPc = bassNote ? pitchClassOf(bassNote) : rootPc;
        if (bassPc !== rootPc) analysisText += `/${getNoteName(bassPc)}`;

        return analysisText;
    }

    const { root: chordRoot, type: quality } = chordInfo;
    if (!chordRoot || !quality) return null;

    // Tonal ambiguity heuristic (common-practice): ii6 (minor triad in 1st inversion)
    // is pitch-class-identical to a IV chord with added 6 (e.g. Ab–C–F can be read as Ab6 or Fm/Ab in Eb).
    // Prefer the diatonic ii6 reading for symbols.
    try {
        if (tonicIndex !== undefined && contextTonic) {
            const pcs = [...new Set(fullChord.map(pitchClassOf).map(mod12))];
            if (pcs.length === 3) {
                const tonicPc = mod12(tonicIndex);
                const iiRootPc = mod12(tonicPc + 2);
                const iiThirdPc = mod12(iiRootPc + 3);
                const iiSet = new Set<number>([iiRootPc, iiThirdPc, mod12(iiRootPc + 7)]);
                const isIiTriad = pcs.every(pc => iiSet.has(pc));

                const bassNote = pickPreferredBassNote(fullChord) || fullChord[0];
                const bassPc = bassNote ? pitchClassOf(bassNote) : null;

                if (isIiTriad && bassPc != null && mod12(bassPc) === iiThirdPc) {
                    const rootName = getNoteName(iiRootPc);
                    const bassName = getNoteName(mod12(bassPc));
                    return `${rootName}m/${bassName}`;
                }
            }
        }
    } catch { /* ignore */ }

    const chordRootPc = pitchClassOf(chordRoot);
    const rootName = getNoteName(chordRootPc);
    const symbol = CHORD_TYPE_TO_SYMBOL[quality] ?? '';

    let analysisText = `${rootName}${symbol}`;

    // If the detected chord is a 7th/dominant-like sonority, append altered tensions
    // based on the actual pitch-class content (without changing the detected chord type).
    try {
        const q = String(quality || '');
        const isSeventhLike = q.includes('7') || q.startsWith('Dominant');
        if (isSeventhLike && quality !== BuiltInChords.MinorMajor7 && quality !== BuiltInChords.Diminished7 && quality !== BuiltInChords.Minor7b5) {
            const allPcs = new Set<number>((chord || []).filter(n => n && !n.isRest).map(pitchClassOf).map(mod12));
            const ints = new Set<number>([...allPcs].map(pc => mod12(pc - chordRootPc)));
            const already = analysisText;

            // Get the chord's own formula intervals so we don't re-label
            // chord tones as tensions (e.g. minor 3rd in Am7 ≠ ♯9).
            const formulaIntervals = new Set<number>(
                ((CHORD_FORMULAS as any)?.[quality] as number[] | undefined) || []
            );

            const addIfPresent = (interval: number, token: string) => {
                if (ints.has(interval) && !already.includes(token) && !formulaIntervals.has(interval)) {
                    analysisText += token;
                }
            };

            // semitone-intervals above root -> conventional tension labels
            addIfPresent(1, '♭9');
            addIfPresent(3, '♯9');
            addIfPresent(5, '11');
            addIfPresent(6, '♯11');
            addIfPresent(8, '♭13');
            addIfPresent(9, '13');
        }
    } catch { /* ignore */ }

    const bassNote = pickPreferredBassNote(filteredChord) || filteredChord[0];
    const bassPc = bassNote ? pitchClassOf(bassNote) : chordRootPc;
    if (bassPc !== chordRootPc) {
        const bassName = getNoteName(bassPc);
        analysisText += `/${bassName}`;
    }

    return analysisText;
}

function isNoteDissonantInChord(
    note: StaffNote,
    chordInfo: { root: StaffNote; type: string; intervals: Set<number> }
): boolean {
    if (!chordInfo.type.includes('7') || !chordInfo.intervals) return false;

    const rootIndex = pitchClassOf(chordInfo.root);
    const seventhInterval = Math.max(...Array.from(chordInfo.intervals));

    if (seventhInterval === 9 || seventhInterval === 10 || seventhInterval === 11) {
        const seventhNoteIndex = (rootIndex + seventhInterval) % 12;
        return pitchClassOf(note) === seventhNoteIndex;
    }
    return false;
}

function getFiguredBass(
    notes: StaffNote[],
    chordInfo: { root: StaffNote; type: string }
): string[] {
    if (!chordInfo || !chordInfo.root) return [];

    const bassNote = [...notes].filter(n => Number.isFinite(n.midi)).sort((a, b) => a.midi - b.midi)[0] || notes[0];
    const bassPc = bassNote ? pitchClassOf(bassNote) : pitchClassOf(chordInfo.root);
    const rootPc = pitchClassOf(chordInfo.root);
    const intervalFromRoot = (bassPc - rootPc + 12) % 12;

    // NOTE: avoid treating Add9 as a "9th chord" (it doesn't imply a 7th).
    const isSeventhChord =
        chordInfo.type.includes('7') ||
        chordInfo.type.includes('11') ||
        chordInfo.type.includes('13') ||
        (chordInfo.type.includes('9') && chordInfo.type !== BuiltInChords.Add9);

    if (isSeventhChord) {
        if (intervalFromRoot === 0) {
            if (chordInfo.type.includes('13')) return ['13'];
            if (chordInfo.type.includes('11')) return ['11'];
            if (chordInfo.type.includes('9')) return ['9'];
            return ['7'];
        }
        if (intervalFromRoot === 3 || intervalFromRoot === 4) return ['6', '5'];
        if (intervalFromRoot === 6 || intervalFromRoot === 7) return ['4', '3'];
        if (intervalFromRoot >= 9 && intervalFromRoot <= 11) return ['4', '2'];
    } else {
        if (intervalFromRoot === 0) {
            if (chordInfo.type.includes('6')) return ['6'];
            return [];
        }
        if (intervalFromRoot === 3 || intervalFromRoot === 4) return ['6'];
        if (intervalFromRoot >= 6 && intervalFromRoot <= 8) return ['6', '4'];
    }

    return [];
}

function getVerticalFiguresFromNotes(notes: StaffNote[]): string[] {
    try {
        const sounding = (notes || []).filter(n => {
            if (!n || n.isRest || typeof n.pitch !== 'string' || typeof n.octave !== 'number') return false;
            const anyN = n as any;
            return !(
                anyN.isPassing ||
                anyN.isNeighbor ||
                anyN.isAnticipation ||
                anyN.isAppoggiatura ||
                anyN.isEscape
            );
        });
        if (sounding.length < 2) return [];

        const bass = [...sounding].sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
        if (!bass || typeof bass.pitch !== 'string' || typeof bass.octave !== 'number') return [];
        const bassPos = getNotePosition(bass.pitch, bass.octave);

        const figures = new Set<number>();
        for (const n of sounding) {
            if (n.id === bass.id) continue;
            const pos = getNotePosition(n.pitch, n.octave);
            let num = (pos - bassPos) + 1;
            while (num <= 0) num += 7;
            while (num > 13) num -= 7;
            if (num === 1 || num === 8) continue;
            // Avoid compound figures that are rarely used in this app's pedagogy/UI.
            // 12th/13th are typically shown as their simple equivalents (5th/6th).
            if (num === 12) num = 5;
            if (num === 13) num = 6;
            figures.add(num);
        }

        return [...figures].sort((a, b) => a - b).map(String);
    } catch {
        return [];
    }
}

function calculateRomanNumeral(
    chordInfo: { root: StaffNote; type: string; intervals?: Set<number> },
    keyInfo: { tonicIndex: number; isMinor: boolean; minorScaleMode?: 'off' | 'natural' | 'harmonic' }
): string {
    const { root: chordRoot, type: quality } = chordInfo;
    // Prefer explicit pitch-class (`noteIndex`) when available. This is required for
    // virtual roots used by the label layer and heuristics.
    const chordRootIndex = (chordRoot && Number.isFinite((chordRoot as any).noteIndex))
        ? mod12((chordRoot as any).noteIndex)
        : mod12((chordRoot as any).midi);
    const { tonicIndex: keyTonicIndex, isMinor: isMinorMode } = keyInfo;

    // Neutral behavior in minor: decide natural vs harmonic *per chord*.
    // This is mostly about the 7th degree (♭VII vs leading-tone vii°), and keeps room
    // for future heuristics as the analysis improves.
    if (isMinorMode && keyInfo.minorScaleMode === 'off') {
        const intervalFromTonic = mod12(chordRootIndex - keyTonicIndex);
        const isDimQuality = quality === BuiltInChords.Diminished || /°|dim/i.test(String(quality || '')) || /b5/i.test(String(quality || ''));

        const naturalRoman = calculateRomanNumeral(chordInfo, { ...keyInfo, minorScaleMode: 'natural' });
        const harmonicRoman = calculateRomanNumeral(chordInfo, { ...keyInfo, minorScaleMode: 'harmonic' });

        // Subtonic root (♭VII) -> natural minor by default.
        if (intervalFromTonic === 10) return naturalRoman;
        // Leading-tone root (#7) -> harmonic if it's diminished-like, otherwise keep neutral/chromatic.
        if (intervalFromTonic === 11) return isDimQuality ? harmonicRoman : naturalRoman;

        // Default: prefer harmonic (tonal default) when the choice doesn't affect diatonic degree.
        return harmonicRoman;
    }

    const isNeapolitanRoot = chordRootIndex === (keyTonicIndex + 1) % 12;
    if (isNeapolitanRoot && quality === BuiltInChords.Major) return 'N';

    const isFlatTwoRoot = chordRootIndex === (keyTonicIndex + 1) % 12;
    if (isFlatTwoRoot && quality === BuiltInChords.Major7) return '♭II';

    const isFourthDegreeRoot = chordRootIndex === (keyTonicIndex + 5) % 12;
    if (!isMinorMode && isFourthDegreeRoot && quality === BuiltInChords.Minor7) return 'iv';
    if (!isMinorMode && isFourthDegreeRoot && (quality === BuiltInChords.Minor || String(quality || '').startsWith('m'))) return 'iv';

    const isFifthDegreeRoot = chordRootIndex === (keyTonicIndex + 7) % 12;
    if (!isMinorMode && isFifthDegreeRoot && (quality === BuiltInChords.Minor || String(quality || '').startsWith('m'))) return 'v';

    const isFlatSixthRoot = chordRootIndex === (keyTonicIndex + 8) % 12;
    if (!isMinorMode && isFlatSixthRoot && quality === BuiltInChords.Major7) return '♭VI';

    const romanNumeralsMajor = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
    // In minor, the III degree is not *always* augmented; it depends on the actual chord spelling.
    // Keep the base numeral as 'III' and let quality logic append '+' only when appropriate.
    const romanNumeralsMinorNatural = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
    const romanNumeralsMinorHarmonic = ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°'];
    const scaleIntervalsMajor = [0, 2, 4, 5, 7, 9, 11];
    const scaleIntervalsMinorNatural = [0, 2, 3, 5, 7, 8, 10];
    const scaleIntervalsMinorHarmonic = [0, 2, 3, 5, 7, 8, 11];
    // Back-compat: when unspecified, default to harmonic minor (previous engine behavior).
    const minorMode: 'natural' | 'harmonic' = keyInfo.minorScaleMode === 'natural' ? 'natural' : 'harmonic';
    const scaleIntervals = isMinorMode
        ? (minorMode === 'harmonic' ? scaleIntervalsMinorHarmonic : scaleIntervalsMinorNatural)
        : scaleIntervalsMajor;
    const romanNumerals = isMinorMode
        ? (minorMode === 'harmonic' ? romanNumeralsMinorHarmonic : romanNumeralsMinorNatural)
        : romanNumeralsMajor;

    const hasExplicitSpellingToken = (n: any): boolean => {
        try {
            if (!n) return false;
            if ((n as any).userAccidental != null) return true;
            if ((n as any).explicitAccidental != null) return true;
            // Check separate accidental field (e.g. MusicXML import: pitch='D', accidental='#')
            const acc = (n as any).accidental;
            if (acc != null && acc !== '' && acc !== 'natural') return true;
            const p = String((n as any).pitch || '');
            if (p.includes('b') || p.includes('#')) return true;
            // Infer from midi: if midi%12 ≠ natural pitch class → implicit accidental
            const midi = (n as any).midi;
            if (typeof midi === 'number' && p.length === 1) {
                const nat: Record<string,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
                const natPc = nat[p.toUpperCase()];
                if (natPc !== undefined && (midi % 12) !== natPc) return true;
            }
            return false;
        } catch {
            return false;
        }
    };

    // Secondary leading-tone diminished chords (vii°/x)
    // Common tonicization device: a diminished triad/7th a semitone below the target degree.
    // Example in Bb major: B°/D => vii°/ii (to Cm).
    {
        const qualityStr = String(quality || '');
        const typeStr = String((chordInfo as any)?.type || '');
        const isDimQuality = quality === BuiltInChords.Diminished || /°|dim/i.test(qualityStr) || /[b♭]5/i.test(qualityStr) || /[b♭]5/i.test(typeStr);
        const ints: Set<number> | undefined = (chordInfo as any)?.intervals;
        const hasMinorThird = !!ints?.has?.(3);
        const hasDimFifth = !!ints?.has?.(6);

        // If the chord is already a *diatonic* diminished degree (e.g., ii° in minor),
        // do NOT reinterpret it as a secondary leading-tone diminished chord.
        try {
            const degreeIndexPre = scaleIntervals.indexOf((chordRootIndex - keyTonicIndex + 12) % 12);
            const diatonicRomanPre = degreeIndexPre >= 0 ? romanNumerals[degreeIndexPre] : null;
            const isDiatonicDim = !!diatonicRomanPre && diatonicRomanPre.includes('°') && isDimQuality && hasMinorThird && hasDimFifth;
            if (isDiatonicDim) {
                // Skip secondary leading-tone logic; let the diatonic mapping handle it.
            } else {

        // Seventh detection: dim7 uses 9, half-dim uses 10, maj7 uses 11.
        const hasSeventh = !!ints?.has?.(9) || !!ints?.has?.(10) || !!ints?.has?.(11) || /\b7\b/.test(typeStr) || /7/.test(typeStr);
        const isHalfDim = /Minor\s*7\s*♭?5/i.test(typeStr) || /m7\s*♭?5/i.test(typeStr) || /half\s*-?\s*diminished/i.test(typeStr) || (hasMinorThird && hasDimFifth && !!ints?.has?.(10));
        const isDiminishedTriadLike = isDimQuality && hasMinorThird && hasDimFifth;
        if (isDiminishedTriadLike) {
            // Use diatonic degrees for targets (avoid producing vii°/I; keep that as plain vii°).
            const diatonicScaleIntervals = isMinorMode ? scaleIntervals : scaleIntervalsMajor;
            for (let i = 1; i < diatonicScaleIntervals.length; i++) {
                const targetRootIndex = mod12(keyTonicIndex + diatonicScaleIntervals[i]);
                const isLeadingToneToTarget = mod12(targetRootIndex - chordRootIndex) === 1;
                if (!isLeadingToneToTarget) continue;

                // Spelling-first guardrail:
                // If we are about to interpret this diminished as a *chromatic* leading-tone chord
                // (vii°/x) under the current key context, require spelling evidence for that chromaticism.
                // This prevents overly-permissive vii°/x readings that depend on silent respellings.
                try {
                    const diatonicPcSet = new Set<number>(diatonicScaleIntervals.map(iv => mod12(keyTonicIndex + iv)));
                    const ltPc = mod12(chordRootIndex);
                    const ltIsDiatonic = diatonicPcSet.has(ltPc);
                    if (!ltIsDiatonic && !hasExplicitSpellingToken(chordRoot as any)) {
                        continue;
                    }
                } catch { /* ignore */ }

                const targetRoman = romanNumerals[i];

                // Project convention: keep Roman numerals compact and let figured-bass
                // carry inversion/7th information. Avoid 'ø' and explicit '7' here.
                return `vii°/${targetRoman}`;
            }
        }
            }
        } catch { /* ignore */ }
    }

    // Secondary dominants (V/x)
    // - Dominant-type chords: allow directly.
    // - Dominant *triads*: allow only when they contain the chromatic leading tone
    //   of the target degree (prevents false V/VI readings like III in minor).
    {
        const diatonicScaleIntervals = isMinorMode ? scaleIntervals : scaleIntervalsMajor;
        const diatonicPcSet = new Set<number>(diatonicScaleIntervals.map(iv => mod12(keyTonicIndex + iv)));

        const isDominantType = typeof quality === 'string' && quality.startsWith('Dominant');
        const isMajorTriad = quality === BuiltInChords.Major;
        const hasMajorThird = !!(chordInfo as any)?.intervals?.has?.(4);

        // Under suspensions the 3rd can be delayed, so a real dominant 7th can appear as a
        // "no_third" match. Allow secondary-dominant detection when we still have a strong
        // dominant shell (P5 + m7) to avoid labeling it as a diatonic triad degree.
        const hasDominantShell = (() => {
            try {
                const ints = (chordInfo as any)?.intervals;
                return !!(ints?.has?.(7) && ints?.has?.(10));
            } catch {
                return false;
            }
        })();

        // Only consider triads when we can confirm the major third is present.
        const allowTriadSecondary = isMajorTriad && hasMajorThird;

        // For dominant-type chords, we usually require the major 3rd. Without it, many sonorities
        // (e.g. ii6/5 = D–F–A–C) can be reinterpreted as a "dominant 7#9 without 3rd".
        // However, in suspension contexts the 3rd may be delayed; in that case, accept a
        // dominant shell (P5+m7) as sufficient evidence.
        if ((isDominantType && (hasMajorThird || hasDominantShell)) || allowTriadSecondary) {
            for (let i = 1; i < diatonicScaleIntervals.length; i++) {
                const targetRootIndex = mod12(keyTonicIndex + diatonicScaleIntervals[i]);
                const isDominantOfDegree = mod12(chordRootIndex - targetRootIndex) === 7;
                if (!isDominantOfDegree) continue;

                // For triads, require the chromatic leading tone of the target degree.
                // Example in F major: D major => V/ii because it contains F# (LT to G).
                if (allowTriadSecondary) {
                    const targetLeadingTonePc = mod12(targetRootIndex - 1);
                    const isChromaticLt = !diatonicPcSet.has(targetLeadingTonePc);
                    if (!isChromaticLt) continue;
                }

                const targetRoman = romanNumerals[i];
                return `V/${targetRoman}`;
            }
        }
    }

    // Secondary dominants targeting borrowed (chromatic) degrees: ♭II, ♭III, ♭VI, ♭VII.
    // These are common in major keys (e.g. V7/♭VI, V7/♭VII) but the diatonic
    // loop above misses them because the target root is not in the diatonic scale.
    if (!isMinorMode) {
        const isDominantType = typeof quality === 'string' && quality.startsWith('Dominant');
        const hasMajorThird = !!(chordInfo as any)?.intervals?.has?.(4);
        const hasDominantShell = (() => {
            try {
                const ints = (chordInfo as any)?.intervals;
                return !!(ints?.has?.(7) && ints?.has?.(10));
            } catch { return false; }
        })();
        const isMajorTriad = quality === BuiltInChords.Major;
        if ((isDominantType && (hasMajorThird || hasDominantShell)) || (isMajorTriad && hasMajorThird)) {
            const borrowedTargets: Array<{ semitones: number; roman: string }> = [
                { semitones: 1, roman: '♭II' },
                { semitones: 3, roman: '♭III' },
                { semitones: 8, roman: '♭VI' },
                { semitones: 10, roman: '♭VII' },
            ];
            for (const bt of borrowedTargets) {
                const targetRootIndex = mod12(keyTonicIndex + bt.semitones);
                if (mod12(chordRootIndex - targetRootIndex) !== 7) continue;
                // For triads, require a chromatic leading tone of the target.
                if (isMajorTriad && !isDominantType) {
                    const diatonicPcSet = new Set<number>(scaleIntervalsMajor.map(iv => mod12(keyTonicIndex + iv)));
                    const targetLt = mod12(targetRootIndex - 1);
                    if (!diatonicPcSet.has(targetLt) === false) continue;
                }
                return `V/${bt.roman}`;
            }
        }
    }

    const degreeIndex = scaleIntervals.indexOf((chordRootIndex - keyTonicIndex + 12) % 12);
    if (degreeIndex === -1) {
        const allRoman = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
        const intervalFromTonic = (chordRootIndex - keyTonicIndex + 12) % 12;
        let roman = allRoman[intervalFromTonic];
        if (quality === BuiltInChords.Minor || quality.startsWith('m')) roman = roman.toLowerCase();
        if (quality === BuiltInChords.Diminished || quality.includes('°') || quality.includes('b5')) roman += '°';
        if (quality === BuiltInChords.Augmented) roman += '+';
        return roman;
    }

    if (isMinorMode && degreeIndex === 0 && quality === BuiltInChords.MinorMajor7) {
        return 'I';
    }

    let roman = romanNumerals[degreeIndex];
    const effectiveQuality = (quality === BuiltInChords.Add9) ? BuiltInChords.Major : quality;

    // IMPORTANT: `romanNumerals` encodes the *diatonic* quality (e.g. vii° in major).
    // For chromatically altered chords that still land on a diatonic root (same scale degree),
    // we must not force that diatonic marker. Example: in Bb major, A–C–E is a minor triad
    // on degree 7 (non-diatonic), and should not be labeled as vii°.
    try {
        if (typeof roman === 'string' && roman && !roman.includes('/')) {
            roman = roman.replace(/[°+]/g, '');
        }
    } catch { /* ignore */ }

    // Functional preference: in tonal contexts, a major triad built on scale-degree II is
    // overwhelmingly used as V/V (dominant of the dominant). If secondary-dominant detection
    // above fails for any reason (e.g. candidate/root heuristics), prefer the functional label.
    try {
        // Apply only to a plain major triad. Do not coerce add/extension sonorities (e.g. II(add9))
        // into secondary dominants; those are intentionally treated as chromatic II in this app.
        const isPlainMajorTriad = quality === BuiltInChords.Major;
        const hasMajorThird = !!(chordInfo as any)?.intervals?.has?.(4);
        const hasFifth = !!(chordInfo as any)?.intervals?.has?.(7);
        if (degreeIndex === 1 && isPlainMajorTriad && hasMajorThird && hasFifth) {
            const targetRoman = romanNumerals[4] || 'V';
            return `V/${targetRoman}`;
        }
    } catch { /* ignore */ }

    // Dominant-family types (Dominant 7, Dominant 9, etc.) always have a major 3rd → uppercase roman.
    const isDominantFamily = typeof quality === 'string' && /^Dominant/i.test(quality);

    if ((effectiveQuality === BuiltInChords.Major || isDominantFamily) && roman.toLowerCase() === roman) roman = roman.toUpperCase();
    else if ((quality === BuiltInChords.Minor || quality === BuiltInChords.MinorMajor7) && roman.toUpperCase() === roman) roman = roman.toLowerCase();
    else if ((quality === BuiltInChords.Diminished || /[b♭]5/i.test(String(quality || '')) || /°|dim/i.test(String(quality || ''))) && !roman.includes('°')) roman += '°';
    else if (quality === BuiltInChords.Augmented && !roman.includes('+')) roman += '+';

    return roman;
}

export function getRomanAnalysis(
    chord: StaffNote[],
    keySignatureRoot: string,
    isMinorMode: boolean,
    opts?: { minorScaleMode?: 'off' | 'natural' | 'harmonic'; ornamentOverrides?: Record<string, string> }
): { roman: string; figures: string[]; aug6Variants?: string[] } | null {
    if (!chord || chord.length < 2) return null;

    // ── Filter out manually overridden ornamental notes ──
    const ornOv = opts?.ornamentOverrides;
    const chordInput = ornOv
        ? (chord || []).filter(n => {
            if (!n) return true;
            const a = n as any;
            // Check by direct note ID
            const t1 = ornOv[a.id];
            if (t1 && t1 !== 'structural') return false;
            // Check by composite key (midi-measureIndex-beat) for cross-graph matching
            const midi = Number(a.midi);
            if (Number.isFinite(midi)) {
                const t2 = ornOv[`${midi}-${a.measureIndex ?? -1}-${a.beat ?? -1}`];
                if (t2 && t2 !== 'structural') return false;
            }
            return true;
        })
        : chord;

    const baseChord = (chordInput || []).filter(n => n && !n.isRest);
    if (baseChord.length < 2) return null;

    const uniquePcCount = (notes: StaffNote[]): number => {
        try {
            const pcs = new Set<number>();
            for (const n of (notes || [])) {
                if (!n || (n as any).isRest) continue;
                pcs.add(mod12(pitchClassOf(n)));
            }
            return pcs.size;
        } catch {
            return 0;
        }
    };

    const keyTonicIndex = noteNameToIndex[keySignatureRoot];
    if (keyTonicIndex === undefined) return null;

    // Key-aware pitch-class for Roman analysis (uses key signature defaults when no explicit accidental).
    const keySig = getKeySignature(keySignatureRoot, isMinorMode ? 'Minor' : 'Major');
    const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
    const defaultAccForLetter = (letter: string): string => {
        if (!letter) return '';
        if (keySig.type === 'sharp') {
            return SHARP_ORDER.slice(0, keySig.count).includes(letter) ? '#' : '';
        }
        return FLAT_ORDER.slice(0, keySig.count).includes(letter) ? 'b' : '';
    };
    const pitchClassForRoman = (n: StaffNote): number => {
        try {
            const anyN: any = n as any;
            const hasExplicit = anyN?.userAccidental != null || anyN?.explicitAccidental != null || anyN?.accidental != null;
            // If MIDI is available and the note has no explicit accidental, treat MIDI as the
            // source of truth. Otherwise we'd incorrectly reinterpret the note under the
            // *candidate* key signature defaults during Roman analysis / key inference.
            const midi = Number(anyN?.midi);
            if (!hasExplicit && Number.isFinite(midi)) return mod12(midi);

            if (hasExplicit) return mod12(pitchClassOf(n));
            const letter = String(anyN?.pitch || '').toUpperCase().charAt(0);
            if (!letter) return mod12(pitchClassOf(n));
            const acc = defaultAccForLetter(letter);
            const name = `${letter}${acc}`;
            const idx = (noteNameToIndex as any)[name];
            if (Number.isFinite(idx)) return mod12(idx as number);
        } catch { /* ignore */ }
        return mod12(pitchClassOf(n));
    };

    // For Roman numerals, we want the *underlying harmony* rather than surface dissonances.
    // If a note is marked as a suspension and is dissonant against the current bass,
    // treat it as a non-chord tone for the purpose of labeling.
    // IMPORTANT: use key-aware pitch classes (not raw MIDI) so default key-signature flats/sharps
    // are respected when explicit accidentals are absent.
    const bassForDissonance = (() => {
        try {
            return pickPreferredBassNote((chord || []) as any) as any;
        } catch {
            return null;
        }
    })();
    const isDissonantVsBass = (n: any): boolean => {
        try {
            if (!bassForDissonance || !n) return false;
            const bassPc = pitchClassForRoman(bassForDissonance as any);
            const notePc = pitchClassForRoman(n as any);
            const interval = mod12(notePc - bassPc);
            // Consonant intervals above the bass (mod 12): unison, 3rd, 5th, 6th.
            return !([0, 3, 4, 7, 8, 9].includes(interval));
        } catch {
            return false;
        }
    };

    // Guard for inversions: chord tones can be dissonant vs the bass (e.g. 4/2 inversions).
    // If the engine tagged a chord tone as a suspension, do NOT drop it from the Roman snapshot
    // when it belongs to a confident chord candidate for the current verticality.
    const isChordToneOfConfidentCandidate = (note: any, notesHere: StaffNote[]): boolean => {
        try {
            if (!note || (note as any).isRest) return false;
            const baseNotes = (notesHere || []).filter(n => n && !(n as any).isRest);
            if (baseNotes.length < 3) return false;

            // If we're evaluating a suspension tone, do NOT let it justify itself as a chord tone.
            // Infer the chord from the other notes first, then check whether this note would
            // belong to that inferred sonority.
            const isSusp = !!(note as any)?.isSuspension;
            const notes = isSusp
                ? baseNotes.filter(n => (n as any)?.id == null || (note as any)?.id == null ? n !== (note as any) : (n as any).id !== (note as any).id)
                : baseNotes;
            if (notes.length < 3) return false;
            const cands = identifyChordCandidates(notes as any);
            const best = (cands && cands.length) ? (cands as any[])[0] : null;
            const matchType = (best as any)?.matchType;
            const chordType = String(best?.type || '');
            const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
            const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
            if (!confident || isSusLike || !best?.root || !best?.type) return false;

            const rootPc = Number.isFinite((best.root as any).noteIndex)
                ? mod12((best.root as any).noteIndex)
                : (Number.isFinite((best.root as any).midi) ? mod12((best.root as any).midi) : null);
            const notePc = Number.isFinite((note as any)?.midi)
                ? mod12((note as any).midi)
                : (typeof (note as any).noteIndex === 'number' ? mod12((note as any).noteIndex) : null);
            if (rootPc == null || notePc == null) return false;

            const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
            if (!Array.isArray(formula) || !formula.length) return false;
            const intervalFromRoot = mod12(notePc - rootPc);
            return formula.includes(intervalFromRoot);
        } catch {
            return false;
        }
    };

    // Base filtering for both L2 figures and roman: remove surface ornaments.
    // NOTE: some real chord tones can be mis-flagged as passing/escape in tight textures.
    // If filtering becomes too aggressive (<2 notes), fall back to the raw verticality.
    let filteredChordForFigures = (chord || []).filter(n => {
        if (!n || n.isRest) return false;
        const anyN = n as any;
        return !(
            anyN.isPassing ||
            anyN.isNeighbor ||
            anyN.isAnticipation ||
            anyN.isAppoggiatura ||
            anyN.isEscape
        );
    });

    // If the ornament filter collapses a clear triad to a dyad, keep the full sonority.
    // This addresses common false tags where a chord tone is marked as neighbor/passing.
    // However, do not re-introduce explicit appoggiature: they should not affect Roman labels.
    try {
        const baseCount = uniquePcCount(baseChord);
        const filteredCount = uniquePcCount(filteredChordForFigures as any);
        const hasAppoggiatura = baseChord.some((n: any) => !!n?.isAppoggiatura);
        if (!hasAppoggiatura && filteredChordForFigures.length >= 2 && filteredCount > 0 && filteredCount < 3 && baseCount >= 3) {
            filteredChordForFigures = baseChord;
        }
    } catch { /* ignore */ }

    if (filteredChordForFigures.length < 2) {
        filteredChordForFigures = (chord || []).filter(n => n && !n.isRest);
    }
    if (filteredChordForFigures.length < 2) return null;

    // Livello 2 (cifratura) is computed *only* from the vertical intervals,
    // independent of any roman/symbol/function interpretation.
    // IMPORTANT: keep suspensions here so 9-8 etc still show up as figures.
    const figuresL2 = computeFiguredBassFromNotes(filteredChordForFigures, FIGURED_BASS_UI_OPTIONS).figures;

    const minorScaleMode = (opts as any)?.minorScaleMode;
    const keyInfo = { tonicIndex: keyTonicIndex, isMinor: isMinorMode, minorScaleMode };

    // Special case: cadential 6/4 over the dominant bass.
    // If we remove dissonant suspension tones for Roman analysis, the 4th above the bass
    // (which is the tonic pitch-class in a cadential I6/4) can disappear, collapsing the sonority
    // to a dyad and producing wrong labels like iii6/4.
    const hasFigureValue = (v: number) => (figuresL2 || []).some(f => extractFigureValue(f) === v);
    const has64 = hasFigureValue(6) && hasFigureValue(4);

    // Suspension-removal guardrail for inversions:
    // In inverted triads (especially 6/4), a chord tone can be dissonant vs the bass (e.g. 4th).
    // If the verticality is already a clear triad by pitch-class set, do NOT drop tones tagged
    // as suspensions — otherwise the sonority can collapse to a dominant shell and mislabel.
    const triadPcSetForSuspensionGuard = (() => {
        try {
            const pcs = new Set<number>([...new Set((filteredChordForFigures || []).map(pitchClassOf).map(mod12))]);
            if (pcs.size !== 3) return null;
            const TRIADS: Array<{ third: number; fifth: number }> = [
                { third: 4, fifth: 7 }, // major
                { third: 3, fifth: 7 }, // minor
                { third: 3, fifth: 6 }, // diminished
                { third: 4, fifth: 8 }, // augmented
            ];
            for (const rootPc of pcs) {
                for (const t of TRIADS) {
                    const triadSet = new Set<number>([rootPc, mod12(rootPc + t.third), mod12(rootPc + t.fifth)]);
                    const matches = [...pcs].every(x => triadSet.has(x));
                    if (matches) return triadSet;
                }
            }
            return null;
        } catch {
            return null;
        }
    })();

    // For Roman numerals, prefer the underlying harmony: drop dissonant suspension tones.
    // Resolution substitution happens upstream in the labeling pipeline
    // (harmonyLabelPipeline.ts) where the structural snapshot is built.
    // (But do not affect the figured-bass output above.)
    let filteredChord = filteredChordForFigures;
    try {
        const suspFilter = (n: any) => {
            if (!(n as any)?.isSuspension) return true;
            if (triadPcSetForSuspensionGuard) return true;
            if (!isDissonantVsBass(n)) return true;
            if (isChordToneOfConfidentCandidate(n, filteredChordForFigures as any)) return true;
            return false;
        };
        if (has64) {
            const bass = pickPreferredBassNote(filteredChordForFigures as any);
            if (bass) {
                const bassPc = mod12(pitchClassOf(bass));
                const dominantBassPc = mod12(keyTonicIndex + 7);
                if (bassPc !== dominantBassPc) {
                    filteredChord = filteredChordForFigures.filter(suspFilter);
                }
            } else {
                filteredChord = filteredChordForFigures.filter(suspFilter);
            }
        } else {
            filteredChord = filteredChordForFigures.filter(suspFilter);
        }
    } catch {
        filteredChord = filteredChordForFigures.filter((n: any) => {
            if (!(n as any)?.isSuspension) return true;
            if (triadPcSetForSuspensionGuard) return true;
            if (!isDissonantVsBass(n)) return true;
            if (isChordToneOfConfidentCandidate(n, filteredChordForFigures as any)) return true;
            return false;
        });
    }
    if (filteredChord.length < 2) filteredChord = filteredChordForFigures;


    // Unfiltered dominant-triad short-circuit (Bb–D–F in Eb should always be V).
    try {
        const pcsBase = new Set<number>([...new Set((chord || []).filter((n: any) => n && !n.isRest).map(pitchClassOf).map(mod12))]);
        if (pcsBase.size === 3) {
            const domPc = mod12(keyTonicIndex + 7);
            const domTriad = new Set<number>([domPc, mod12(domPc + 4), mod12(domPc + 7)]);
            const matchesDom = [...pcsBase].every(pc => domTriad.has(pc));
            if (matchesDom) {
                return { roman: 'V', figures: figuresL2 };
            }
        }
    } catch { /* ignore */ }

    // If the verticality clearly spells the dominant major triad, label it as V
    // even when inversion/root heuristics are confused by the bass.
    try {
        const pcs = new Set<number>([...new Set((filteredChord || []).map(pitchClassOf).map(mod12))]);
        if (pcs.size === 3) {
            const domPc = mod12(keyTonicIndex + 7);
            const domTriad = new Set<number>([domPc, mod12(domPc + 4), mod12(domPc + 7)]);
            const matchesDom = [...pcs].every(pc => domTriad.has(pc));
            if (matchesDom) {
                return { roman: 'V', figures: figuresL2 };
            }
        }
    } catch { /* ignore */ }

    // L3 policy (accademico): a 6/4 over the dominant bass is labeled as tonic 6/4 (I4/6 or i4/6),
    // not as V4/6. Functional/cadential handling stays in the rule layer, not in the label.
    try {
        if (has64) {
            const bass = pickPreferredBassNote(filteredChord as any);
            if (bass) {
                const bassPc = mod12(pitchClassOf(bass));
                const tonicPc = mod12(keyTonicIndex);
                const dominantBassPc = mod12(keyTonicIndex + 7);

                if (bassPc === dominantBassPc) {
                    const pcs = new Set<number>([...new Set((filteredChord || []).map(pitchClassOf).map(mod12))]);

                    // Decide case by the *actual* third present (Picardy third supported).
                    const tonicMajThird = mod12(tonicPc + 4);
                    const tonicMinThird = mod12(tonicPc + 3);
                    const hasTonic = pcs.has(tonicPc);
                    const hasThird = pcs.has(tonicMajThird) || pcs.has(tonicMinThird);

                    if (hasTonic && hasThird) {
                        const roman = pcs.has(tonicMajThird) ? 'I' : 'i';
                        return { roman, figures: figuresL2 };
                    }
                }
            }
        }
    } catch { /* ignore */ }

    // If the verticality is a clear triad (3 distinct pcs), short-circuit the Roman label
    // to that triad to avoid later heuristics (e.g. rootless dominants) overriding a stable
    // diatonic reading.
    try {
        const pcs = new Set<number>([...new Set((filteredChord || []).map(pitchClassOf).map(mod12))]);
        if (pcs.size === 3) {
            const TRIADS: Array<{ type: ChordType; third: number; fifth: number }> = [
                { type: BuiltInChords.Major, third: 4, fifth: 7 },
                { type: BuiltInChords.Minor, third: 3, fifth: 7 },
                { type: BuiltInChords.Diminished, third: 3, fifth: 6 },
                { type: BuiltInChords.Augmented, third: 4, fifth: 8 },
            ];

            let triadRootPc: number | null = null;
            let triadType: ChordType | null = null;

            outer: for (const rootPc of pcs) {
                for (const t of TRIADS) {
                    const triadSet = new Set<number>([rootPc, mod12(rootPc + t.third), mod12(rootPc + t.fifth)]);
                    const matches = [...pcs].every(x => triadSet.has(x));
                    if (matches) {
                        triadRootPc = rootPc;
                        triadType = t.type;
                        break outer;
                    }
                }
            }

            if (triadRootPc != null && triadType) {
                const rootNote = (filteredChord || []).find(n => mod12(pitchClassOf(n)) === triadRootPc) || (filteredChord || [])[0];
                const triadInfo = {
                    root: { ...(rootNote as any), noteIndex: triadRootPc } as StaffNote,
                    type: triadType,
                    intervals: new Set<number>([0,
                        triadType === BuiltInChords.Minor || triadType === BuiltInChords.Diminished ? 3 : 4,
                        triadType === BuiltInChords.Augmented ? 8 : (triadType === BuiltInChords.Diminished ? 6 : 7),
                    ]),
                };
                const roman = calculateRomanNumeral(triadInfo as any, keyInfo);
                if (roman) return { roman, figures: figuresL2 };
            }
        }
    } catch { /* ignore */ }

    // Prefer clear leading-tone 7th when the full tertian set is present.
    try {
        const pcs = [...new Set((baseChord || []).map(pitchClassOf).map(mod12))];
        if (pcs.length >= 4) {
            const leadingPc = mod12(keyInfo.tonicIndex - 1);
            const halfDimSet = new Set<number>([
                leadingPc,
                mod12(leadingPc + 3),
                mod12(leadingPc + 6),
                mod12(leadingPc + 10),
            ]);
            const hasAll = [...halfDimSet].every(pc => pcs.includes(pc));
            if (hasAll) {
                // Convention: label as vii°; figures carry the 7th information.
                return { roman: 'vii°', figures: figuresL2 };
            }
        }
    } catch { /* ignore */ }

    // When we only have a dyad (2 pitch classes), chord-ID can prefer sus/pedal readings
    // that map to the wrong roman numeral (e.g. C–G -> V). If the dyad cleanly fits the
    // diatonic triad implied by the bass, prefer that roman for stability.
    const inferDiatonicRomanFromBassDyad = (): { roman: string } | null => {
        try {
            const pcs = [...new Set((filteredChord || []).map(pitchClassForRoman).map(mod12))];
            if (pcs.length > 2) return null;

            const bass = pickPreferredBassNote(filteredChord as any);
            if (!bass) return null;
            const bassPc = mod12(pitchClassForRoman(bass));

            // Default back-compat: harmonic when unspecified.
            // Neutral/off: use natural diatonic degrees (no forced leading tone).
            const minorMode = (minorScaleMode === 'natural') ? 'natural' : (minorScaleMode === 'off' ? 'natural' : 'harmonic');
            const scaleIntervals = isMinorMode
                ? (minorMode === 'harmonic'
                    ? [0, 2, 3, 5, 7, 8, 11]
                    : [0, 2, 3, 5, 7, 8, 10])
                : [0, 2, 4, 5, 7, 9, 11];
            const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
            const romanMin = (minorMode === 'harmonic')
                ? ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°']
                : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
            const romans = isMinorMode ? romanMin : romanMaj;

            let degree = -1;
            for (let i = 0; i < scaleIntervals.length; i++) {
                const pc = mod12(keyTonicIndex + scaleIntervals[i]);
                if (pc === bassPc) {
                    degree = i;
                    break;
                }
            }
            if (degree < 0) return null;

            const roman = romans[degree];
            const rootPc = mod12(keyTonicIndex + scaleIntervals[degree]);
            const isDim = roman.includes('°');
            const isMinTriad = !isDim && roman === roman.toLowerCase();
            const isAug = roman.includes('+');
            const thirdInt = isMinTriad || isDim ? 3 : 4;
            const fifthInt = isAug ? 8 : (isDim ? 6 : 7);

            const triadSet = new Set<number>([
                rootPc,
                mod12(rootPc + thirdInt),
                mod12(rootPc + fifthInt),
            ]);
            if (!pcs.every(p => triadSet.has(p))) return null;

            return { roman };
        } catch {
            return null;
        }
    };

    // If ornament filtering collapses the sonority to a stable dyad shell (e.g. C–G),
    // infer the most likely diatonic Roman numeral from the bass before chord-ID.
    // This prevents appoggiature/ornaments from making Roman analysis disappear (null).
    try {
        const pcs = new Set<number>([...new Set((filteredChord || []).map(pitchClassForRoman).map(mod12))]);
        if (pcs.size <= 2) {
            const inferred = inferDiatonicRomanFromBassDyad();
            if (inferred?.roman) return { roman: inferred.roman, figures: figuresL2 };
        }
    } catch { /* ignore */ }

    for (const definition of Object.values(CHROMATIC_CHORD_DEFINITIONS)) {
        if (definition.matcher(filteredChord, keyInfo)) {
            // ── Aug6 chromatic variant detection (Delamont bII+6 variants) ──
            // Post-processing: detect augmented/doubly-augmented intervals from
            // the ROOT (fondamentale = bII), NOT the bass note. This ensures
            // correct detection in ALL inversions.
            // Notation: + = eccedente (+1st), x = più che eccedente (+2st)
            let enrichedFigures = [...figuresL2];
            const aug6Variants: string[] = [];
            try {
                const validNotes = filteredChord.filter(n => n && !(n as any).isRest);

                // Find the Aug6 root: the note that has an augmented 6th (d:6, s:10)
                // interval with another note. That note is the fondamentale (bII).
                let root: any = null;
                for (const candidate of validNotes) {
                    for (const other of validNotes) {
                        if (candidate === other) continue;
                        const iv = spelledSimpleIntervalFromRoot(candidate as any, other as any);
                        if (iv && iv.diatonicNumber === 6 && iv.semitones === 10) {
                            root = candidate;
                            break;
                        }
                    }
                    if (root) break;
                }
                // Fallback to bass if no aug6 interval found (shouldn't happen)
                if (!root) {
                    root = validNotes[0];
                    for (const n of validNotes) {
                        if ((n as any).midi < (root as any).midi) root = n;
                    }
                }

                // Compute intervals FROM ROOT using both mod-12 and spelled approaches.
                const pcFromRoot = new Set<number>();
                let has8xSpelling = false;
                for (const n of validNotes) {
                    if (n === root) continue;
                    const dist = ((n as any).midi - (root as any).midi + 1200) % 12;
                    pcFromRoot.add(dist);
                    // Check spelled interval for 8x: same letter name, doubly-augmented unison
                    const iv = spelledSimpleIntervalFromRoot(root as any, n as any);
                    if (iv && iv.diatonicNumber === 1 && iv.semitones >= 2) has8xSpelling = true;
                }

                const hasPc = (st: number) => pcFromRoot.has(st);

                // 8x — ottava più che eccedente (spelled: same letter, +2st from root)
                if (has8xSpelling) {
                    aug6Variants.push('8x');
                    enrichedFigures = enrichedFigures.filter(f => !/[×𝄪]8|♯♯8/.test(f));
                    enrichedFigures.push('8x');
                }

                // 5x — quinta più che eccedente (9st from root) — non-conflict: no 5P (7st)
                if (hasPc(9) && !hasPc(7)) {
                    aug6Variants.push('5x');
                    const idx5 = enrichedFigures.findIndex(f => /^[♯♭×]*5$/.test(f));
                    if (idx5 >= 0) enrichedFigures[idx5] = '5x';
                    else enrichedFigures.push('5x');
                }

                // 3+ — terza eccedente (5st from root) — non-conflict: no 3M (4st)
                if (hasPc(5) && !hasPc(4)) {
                    aug6Variants.push('3+');
                    const idx3 = enrichedFigures.findIndex(f => /^[♯♭×]*3$/.test(f));
                    if (idx3 >= 0) enrichedFigures[idx3] = '3+';
                    else enrichedFigures.push('3+');
                }
            } catch { /* ignore */ }

            return {
                roman: definition.symbol,
                figures: enrichedFigures,
                ...(aug6Variants.length > 0 ? { aug6Variants } : {}),
            };
        }
    }

    // Secondary leading-tone diminished 7th (and rootless V7♭9) heuristic:
    // A fully diminished 7th built on the leading tone of a *target* diatonic degree
    // is extremely common (e.g. B–D–F–Ab in Eb major = vii°7/vi, i.e. G7♭9 without G).
    // Treat it as vii°/X to avoid unstable I7/I labels in arpeggiations.
    try {
        const valid = filteredChord;
        const pcs = [...new Set(valid.map(pitchClassOf).map(mod12))];
        const isSeventhish = (() => {
            try {
                if (pcs.length >= 4) return true;
                const hasFig = (v: number) => (figuresL2 || []).some(f => extractFigureValue(String(f)) === v);
                // Any explicit 7th-chord figure set.
                return hasFig(7) || (hasFig(6) && hasFig(5)) || (hasFig(4) && hasFig(3)) || (hasFig(4) && hasFig(2));
            } catch {
                return pcs.length >= 4;
            }
        })();

        if (isSeventhish && pcs.length >= 3) {
            const bassPc = (() => {
                try {
                    const bass = (valid || [])
                        .filter(n => n && !(n as any).isRest && Number.isFinite((n as any).midi))
                        .slice()
                        .sort((a, b) => ((a as any).midi ?? 0) - ((b as any).midi ?? 0))[0] as any;
                    return bass ? mod12(pitchClassOf(bass)) : null;
                } catch {
                    return null;
                }
            })();

            const tonicPc = mod12(keyInfo.tonicIndex);
            // Default back-compat: harmonic when unspecified.
            // Neutral/off: use natural diatonic degrees.
            const minorMode = (minorScaleMode === 'natural') ? 'natural' : (minorScaleMode === 'off' ? 'natural' : 'harmonic');
            const scaleIntervals = isMinorMode
                ? (minorMode === 'harmonic'
                    ? [0, 2, 3, 5, 7, 8, 11]
                    : [0, 2, 3, 5, 7, 8, 10])
                : [0, 2, 4, 5, 7, 9, 11];
            const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
            const romanMin = (minorMode === 'harmonic')
                ? ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°']
                : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
            const romans = isMinorMode ? romanMin : romanMaj;

            let best: { score: number; i: number } | null = null;

            const hasExplicitSpellingToken = (n: any): boolean => {
                try {
                    if (!n) return false;
                    if ((n as any).userAccidental != null) return true;
                    if ((n as any).explicitAccidental != null) return true;
                    // Check separate accidental field (e.g. MusicXML import: pitch='D', accidental='#')
                    const acc = (n as any).accidental;
                    if (acc != null && acc !== '' && acc !== 'natural') return true;
                    const p = String((n as any).pitch || '');
                    if (p.includes('b') || p.includes('#')) return true;
                    // Infer from midi: if midi%12 ≠ natural pitch class → implicit accidental
                    const midi = (n as any).midi;
                    if (typeof midi === 'number' && p.length === 1) {
                        const nat: Record<string,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
                        const natPc = nat[p.toUpperCase()];
                        if (natPc !== undefined && (midi % 12) !== natPc) return true;
                    }
                    return false;
                } catch {
                    return false;
                }
            };
            const diatonicPcSet = new Set<number>(scaleIntervals.map(iv => mod12(tonicPc + iv)));

            // Guard: if the pitch classes form a complete diatonic diminished degree
            // (e.g. ii° in minor = B-D-F-A in A minor), skip secondary vii°/x
            // interpretation. The simpler diatonic reading is always preferred.
            const _skipDiatonicDim = (() => {
                try {
                    for (let d = 0; d < scaleIntervals.length; d++) {
                        if (!romans[d].includes('°')) continue;
                        const degPc = mod12(tonicPc + scaleIntervals[d]);
                        const triad = new Set([degPc, mod12(degPc + 3), mod12(degPc + 6)]);
                        const halfDim = new Set([...triad, mod12(degPc + 10)]);
                        const fullDim = new Set([...triad, mod12(degPc + 9)]);
                        if ((pcs.every(pc => halfDim.has(pc)) || pcs.every(pc => fullDim.has(pc)) || pcs.every(pc => triad.has(pc)))
                            && pcs.includes(degPc)) return true;
                    }
                    return false;
                } catch { return false; }
            })();

            if (!_skipDiatonicDim)
            for (let i = 0; i < scaleIntervals.length; i++) {
                const targetPc = mod12(tonicPc + scaleIntervals[i]);
                const ltPc = mod12(targetPc - 1);

                // Spelling-first guardrail: if the leading tone is chromatic under the current
                // key context, require an explicit accidental spelling for it in the verticality.
                try {
                    const ltIsDiatonic = diatonicPcSet.has(ltPc);
                    if (!ltIsDiatonic) {
                        const hasLtExplicit = (valid || []).some((n: any) => {
                            if (!n || (n as any).isRest) return false;
                            if (mod12(pitchClassOf(n as any)) !== ltPc) return false;
                            return hasExplicitSpellingToken(n);
                        });
                        if (!hasLtExplicit) continue;
                    }
                } catch { /* ignore */ }

                const fullDim7 = new Set<number>([
                    ltPc,
                    mod12(ltPc + 3),
                    mod12(ltPc + 6),
                    mod12(ltPc + 9),
                ]);
                const halfDim7 = new Set<number>([
                    ltPc,
                    mod12(ltPc + 3),
                    mod12(ltPc + 6),
                    mod12(ltPc + 10),
                ]);
                const subset = pcs.every(pc => fullDim7.has(pc)) || pcs.every(pc => halfDim7.has(pc));
                if (!subset) continue;
                if (!pcs.includes(ltPc)) continue;

                // For tonic-leading-tone in minor we keep the existing behavior below.
                if (i === 0 && isMinorMode) break;

                // Score matches:
                // - prefer the spelling that places the leading tone in the bass (common as root)
                // - otherwise prefer secondary interpretations over tonic to avoid unstable I/I7 labels
                let score = 0;
                if (bassPc != null && bassPc === ltPc) score += 2;
                if (i !== 0) score += 1;

                if (!best || score > best.score) best = { score, i };
            }

            if (best) {
                const targetRoman = romans[best.i];
                const roman = best.i === 0 ? 'vii°' : `vii°/${targetRoman}`;
                return { roman, figures: figuresL2 };
            }
        }
    } catch { /* ignore */ }

    // Leading-tone fully diminished 7th in minor:
    // In minor, the set {#7, 2, 4, ♭6} equals the leading-tone fully-diminished 7th.
    // It can be interpreted as a rootless V7(♭9), but for Roman numerals we prefer
    // labeling it directly as vii° (user-facing figured-bass doesn't encode the
    // missing dominant root).
    // Example in Am: {G#, B, D, F} => vii°7 (also equals E7♭9 without E).
    try {
        if (isMinorMode) {
            const valid = filteredChord;
            const pcs = [...new Set(valid.map(pitchClassOf))];
            if (pcs.length >= 3) {
                const tonicPc = keyInfo.tonicIndex;
                const leadingPc = mod12(tonicPc - 1);
                const dominantPc = mod12(tonicPc + 7);
                const dim7Set = new Set<number>([
                    leadingPc,
                    mod12(leadingPc + 3),
                    mod12(leadingPc + 6),
                    mod12(leadingPc + 9),
                ]);
                const subset = pcs.every(pc => dim7Set.has(pc));
                if (subset && pcs.includes(leadingPc)) {
                    return { roman: 'vii°', figures: figuresL2 };
                }
            }
        }
    } catch { /* ignore */ }

    let chordInfo = identifyChord(filteredChord);

    // Rescue: if filtering ornaments accidentally removes an essential chord tone and
    // collapses a 7th-chord sonority, prefer the unfiltered vertical when it yields a
    // clear tertian 7th (including ø7).
    try {
        const isDominantType = (t: any) => typeof t === 'string' && t.startsWith('Dominant');
        const allInfo = identifyChord(baseChord);
        if (allInfo) {
            const filteredIsDominant = chordInfo && isDominantType(chordInfo.type);
            const allIsDominant = isDominantType(allInfo.type);

            // Do NOT promote a dominant reading that depends on a dissonant suspension tone.
            // Example: in Eb major, Ab–C–F with a suspended Bb can look like Bb9/Ab,
            // but the underlying harmony is ii6 (Fm/Ab).
            const hasDissonantSuspensionTone = (() => {
                try {
                    return (baseChord || []).some((n: any) => !!n?.isSuspension && isDissonantVsBass(n));
                } catch {
                    return false;
                }
            })();

            // Case 1: dominant-type rescue (existing behavior)
            if (!hasDissonantSuspensionTone && allIsDominant && !filteredIsDominant) {
                chordInfo = allInfo;
            }

            // Case 2: secondary-dominant triads in inversions:
            // filtering can remove the chromatic LT (e.g. F#) and collapse V/V into II6.
            // Prefer the unfiltered vertical ONLY when it yields a V/x label under the current key.
            try {
                const allRoman = calculateRomanNumeral(allInfo, keyInfo);
                const filteredRoman = chordInfo ? calculateRomanNumeral(chordInfo, keyInfo) : '';
                if (typeof allRoman === 'string' && allRoman.startsWith('V/') && !(String(filteredRoman || '').startsWith('V/'))) {
                    chordInfo = allInfo;
                }
            } catch { /* ignore */ }

            // Case 3: exact 7th-chord rescue (e.g. Bø7 over F should not collapse to ii).
            try {
                const isSeventhLike = (t: string) => {
                    const s = String(t || '');
                    return s.includes('7') || s.includes('9') || s.includes('11') || s.includes('13');
                };
                const filteredIsSeventh = chordInfo && isSeventhLike(chordInfo.type);
                if (!hasDissonantSuspensionTone && !filteredIsSeventh) {
                    const fullCandidates = identifyChordCandidates(baseChord);
                    const bestExactSeventh = (fullCandidates || []).find(c => c.matchType === 'exact' && isSeventhLike(c.type));
                    if (bestExactSeventh) {
                        chordInfo = { root: bestExactSeventh.root, type: bestExactSeventh.type, intervals: bestExactSeventh.intervals };
                    }
                }
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }

    if (!chordInfo || !chordInfo.root || !chordInfo.type) return null;

    // If the pitch-class set is an unambiguous major triad, prefer that root/type for Roman analysis.
    try {
        const pcs = new Set<number>([...new Set((filteredChord || []).map(pitchClassOf).map(mod12))]);
        if (pcs.size === 3) {
            let majorRootPc: number | null = null;
            for (const pc of pcs) {
                const triad = new Set<number>([pc, mod12(pc + 4), mod12(pc + 7)]);
                const matches = [...pcs].every(x => triad.has(x));
                if (matches) { majorRootPc = pc; break; }
            }
            if (majorRootPc != null) {
                const rootNote = (filteredChord || []).find(n => mod12(pitchClassOf(n)) === majorRootPc) || chordInfo.root;
                chordInfo = { root: { ...(rootNote as any), noteIndex: majorRootPc } as StaffNote, type: BuiltInChords.Major, intervals: new Set([0, 4, 7]) };
            }
        }
    } catch { /* ignore */ }

    let baseRomanSymbol = calculateRomanNumeral(chordInfo, keyInfo);

    // If the verticality is an exact diatonic triad (by pitch-class set),
    // prefer that diatonic label even if root-identification picked a different inversion.
    try {
        if (typeof baseRomanSymbol === 'string' && baseRomanSymbol && !baseRomanSymbol.includes('/')) {
            const pcs = new Set<number>([...new Set((filteredChord || []).map(pitchClassOf).map(mod12))]);
            if (pcs.size === 3) {
                const scaleIntervals = keyInfo.isMinor
                    ? [0, 2, 3, 5, 7, 8, 10] // natural minor diatonic triads
                    : [0, 2, 4, 5, 7, 9, 11];
                const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
                const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
                const romans = keyInfo.isMinor ? romanMin : romanMaj;

                const triadForRoman = (roman: string, rootPc: number) => {
                    const isDim = roman.includes('°');
                    const isAug = roman.includes('+');
                    const isMin = !isDim && !isAug && roman === roman.toLowerCase();
                    const third = isMin || isDim ? 3 : 4;
                    const fifth = isAug ? 8 : (isDim ? 6 : 7);
                    return new Set<number>([rootPc, mod12(rootPc + third), mod12(rootPc + fifth)]);
                };

                for (let i = 0; i < scaleIntervals.length; i++) {
                    const rootPc = mod12(keyInfo.tonicIndex + scaleIntervals[i]);
                    const roman = romans[i];
                    const triadSet = triadForRoman(roman, rootPc);
                    const matches = [...pcs].every(pc => triadSet.has(pc));
                    if (matches) {
                        baseRomanSymbol = roman;
                        break;
                    }
                }
            }
        }
    } catch { /* ignore */ }

    // Secondary dominants in inversions:
    // In 1st/2nd inversion, root-identification can prefer the bass (e.g. D/F# may be read as F#m).
    // That makes the Roman numeral lose the V/x label and only the Arabic figures remain.
    // Fix: if any high-confidence candidate yields a V/x under the current key context,
    // prefer that V/x label over a non-secondary diatonic reading.
    try {
        const pcs = [...new Set(baseChord.map(pitchClassOf))];
        if (pcs.length >= 3 && typeof baseRomanSymbol === 'string' && baseRomanSymbol && !baseRomanSymbol.includes('/')) {
            const candidates = identifyChordCandidates(filteredChord.length >= 2 ? filteredChord : baseChord);
            let bestSecondary: { roman: string; score: number } | null = null;
            let baseScore = Number.NEGATIVE_INFINITY;
            try {
                for (const c of candidates as any[]) {
                    if (!c) continue;
                    const sameType = c.type === (chordInfo as any)?.type;
                    const rootA = (c.root as any)?.noteIndex;
                    const rootB = (chordInfo as any)?.root?.noteIndex;
                    const sameRoot = (rootA != null && rootB != null) ? (mod12(rootA) === mod12(rootB)) : false;
                    if (sameType && sameRoot) {
                        baseScore = Number.isFinite(c.score) ? (c.score as number) : baseScore;
                        break;
                    }
                }
            } catch { /* ignore */ }
            for (const c of candidates as any[]) {
                const roman = calculateRomanNumeral({ root: c.root, type: c.type, intervals: c.intervals }, keyInfo);
                if (!roman || !roman.startsWith('V/')) continue;
                const score = Number.isFinite(c.score) ? (c.score as number) : 0;
                if (!bestSecondary || score > bestSecondary.score) bestSecondary = { roman, score };
            }
            if (bestSecondary) {
                const threshold = Number.isFinite(baseScore) ? (baseScore + 2) : 0;
                if (bestSecondary.score > threshold) {
                baseRomanSymbol = bestSecondary.roman;
                }
            }
        }
    } catch { /* ignore */ }

    // Secondary leading-tone diminished chords (vii°/x) in inversions:
    // Just like V/x, root-identification can incorrectly prefer the bass on diminished triads
    // (e.g. B°/D can be mis-read as Dm6 -> iii6 in Bb). If a strong candidate yields a
    // secondary leading-tone label, prefer it over a plain diatonic reading.
    // BUT: if the current label is already a diatonic diminished degree (ii° in minor,
    // vii° in major), do NOT override it — the simpler diatonic reading is correct.
    try {
        const pcs = [...new Set(baseChord.map(pitchClassOf).map(mod12))];
        if (pcs.length >= 3 && typeof baseRomanSymbol === 'string' && baseRomanSymbol && !baseRomanSymbol.includes('/')) {
            // Guard: skip reinterpretation when the current label is a diatonic diminished degree.
            const _isAlreadyDiatonicDim = (() => {
                try {
                    const r = String(baseRomanSymbol || '');
                    return r.includes('°') && !r.includes('/');
                } catch { return false; }
            })();
            if (!_isAlreadyDiatonicDim) {
            const candidates = identifyChordCandidates(filteredChord.length >= 2 ? filteredChord : baseChord);
            let bestSecondaryLt: { roman: string; score: number } | null = null;
            for (const c of candidates as any[]) {
                const roman = calculateRomanNumeral({ root: c.root, type: c.type, intervals: c.intervals }, keyInfo);
                if (!roman) continue;
                const rr = String(roman);
                if (!rr.includes('/')) continue;
                if (!rr.startsWith('vii')) continue;
                const score = Number.isFinite(c.score) ? (c.score as number) : 0;
                if (!bestSecondaryLt || score > bestSecondaryLt.score) bestSecondaryLt = { roman: rr, score };
            }
            if (bestSecondaryLt) {
                baseRomanSymbol = bestSecondaryLt.roman;
            }
            } // end: if (!_isAlreadyDiatonicDim)
        }
    } catch { /* ignore */ }

    // Prefer bass-dyad diatonic inference for non-secondary romans.
    try {
        // Ambiguity heuristic (common-practice): ii6 (minor triad in 1st inversion)
        // is pitch-class-identical to IV(add6). Prefer ii when the set matches the diatonic ii triad.
        try {
            if (!keyInfo.isMinor && typeof baseRomanSymbol === 'string' && baseRomanSymbol === 'IV' && !baseRomanSymbol.includes('/')) {
                const pcs = new Set<number>([...new Set(baseChord.map(pitchClassOf).map(mod12))]);
                if (pcs.size === 3) {
                    const tonicPc = mod12(keyInfo.tonicIndex);
                    const iiRootPc = mod12(tonicPc + 2);
                    const iiSet = new Set<number>([iiRootPc, mod12(iiRootPc + 3), mod12(iiRootPc + 7)]);
                    const isIiTriad = [...pcs].every(pc => iiSet.has(pc));
                    if (isIiTriad) {
                        baseRomanSymbol = 'ii';
                    }
                }
            }
        } catch { /* ignore */ }

        if (typeof baseRomanSymbol === 'string' && baseRomanSymbol && !baseRomanSymbol.includes('/')) {
            const inferred = inferDiatonicRomanFromBassDyad();
            if (inferred) return { roman: inferred.roman, figures: figuresL2 };
        }
    } catch { /* ignore */ }

    // Sanity-check for diminished-family Romans (spelling-first):
    // If we ended up with a leading-tone diminished label (vii° or vii°/x), verify that the
    // *full harmonic verticality* (including suspensions, but excluding surface ornaments)
    // supports a diminished reading. This prevents false vii° labels caused by suspension
    // filtering that temporarily removes an essential chord tone.
    try {
        if (typeof baseRomanSymbol === 'string') {
            const r0 = baseRomanSymbol.replace(/\s+/g, '');
            const low = r0.toLowerCase();
            const looksDimLt = low.startsWith('vii') && r0.includes('°');
            if (looksDimLt) {
                const fullInfo = identifyChord(filteredChordForFigures as any);
                if (fullInfo && (fullInfo as any).root && (fullInfo as any).type) {
                    const fullRoman = calculateRomanNumeral(fullInfo as any, keyInfo);
                    const fullR = String(fullRoman || '').replace(/\s+/g, '');
                    const fullLow = fullR.toLowerCase();
                    const fullLooksDimLt = fullLow.startsWith('vii') && fullR.includes('°');

                    // If the full sonority does not justify a diminished leading-tone label,
                    // prefer the full-sonority interpretation (or at least drop the diminished).
                    if (!fullLooksDimLt) {
                        if (fullR) {
                            baseRomanSymbol = fullR;
                        } else {
                            baseRomanSymbol = r0.replace('°', '');
                        }
                    }
                }
            }
        }
    } catch { /* ignore */ }

    // ── V9 / Dominant-ninth figured bass from ROOT (not bass) ──
    // When the chord is a dominant 9th type, compute figures based on which
    // chord member is in the bass, using conventional Dubois shorthand.
    try {
        const chType = String((chordInfo as any)?.type || '');
        const isDom9Type = chType === BuiltInChords.Dominant9
            || chType === BuiltInChords.Dominant7b9
            || chType === BuiltInChords.Dominant7sharp9;
        if (isDom9Type && chordInfo?.root && filteredChord?.length >= 3) {
            const rootMidi = effectiveMidi(chordInfo.root as any);
            if (Number.isFinite(rootMidi)) {
                // Find the actual bass note (lowest midi)
                let bassMidi = Infinity;
                for (const n of filteredChord) {
                    if (n?.isRest) continue;
                    const m = effectiveMidi(n as any);
                    if (Number.isFinite(m) && m! < bassMidi) bassMidi = m!;
                }
                if (Number.isFinite(bassMidi) && bassMidi < Infinity) {
                    const bassIntervalPc = mod12(bassMidi - rootMidi!);
                    // Determine inversion from interval between root and bass
                    // 0 = root pos, 4 = 1st inv (M3 = sensibile), 7 = 2nd inv (P5),
                    // 10 = 3rd inv (m7), 2/1/3 = 4th inv (9th)
                    let v9figs: string[] | null = null;

                    // Determine alteration prefix for the 9th
                    const ninthAlt = (() => {
                        for (const n of filteredChord) {
                            if (n?.isRest) continue;
                            const iv = spelledSimpleIntervalFromRoot(chordInfo!.root as any, n as any);
                            if (iv && iv.diatonicNumber === 2) {
                                const expected9 = expectedSemitonesForMajorPerfect(2); // M2 = 2 semitones
                                const alt9 = iv.semitones - expected9;
                                return alt9 < 0 ? '♭' : alt9 > 0 ? '♯' : '';
                            }
                        }
                        return '';
                    })();

                    if (bassIntervalPc === 0) {
                        // Root position: 9/7
                        v9figs = [`${ninthAlt}9`, '7'];
                    } else if (bassIntervalPc === 4 || bassIntervalPc === 3) {
                        // 1st inversion (sensibile/3rd at bass): ♭5/3 or just 6/5
                        // Dubois: cifra = 7/5 (derivato da 6/9)
                        v9figs = ['7', '5'];
                    } else if (bassIntervalPc === 7) {
                        // 2nd inversion (5th at bass): Dubois cifra = 6/4/3
                        v9figs = ['6', '4', '3'];
                    } else if (bassIntervalPc === 10) {
                        // 3rd inversion (7th at bass): Dubois cifra = 4/2
                        v9figs = ['4', '2'];
                    } else if (bassIntervalPc === 2 || bassIntervalPc === 1 || bassIntervalPc === 3) {
                        // 4th inversion (9th at bass): Dubois cifra = 6/4/3
                        // Only if 9th is truly the bass (check diatonic)
                        const bassIv = spelledSimpleIntervalFromRoot(chordInfo!.root as any,
                            filteredChord.reduce((lo, n) => {
                                if (n?.isRest) return lo;
                                const m = effectiveMidi(n as any);
                                return (Number.isFinite(m) && m! < (effectiveMidi(lo as any) ?? Infinity)) ? n : lo;
                            }, filteredChord[0]) as any);
                        if (bassIv && bassIv.diatonicNumber === 2) {
                            v9figs = ['6', '4', '3'];
                        }
                    }
                    if (v9figs) {
                        return { roman: baseRomanSymbol, figures: v9figs };
                    }
                }
            }
        }
    } catch { /* ignore */ }

    return { roman: baseRomanSymbol, figures: figuresL2 };
}

export function normalizeNotePitchFieldsWithKey(note: any, keySignature: any): any {
    try {
        if (!note || typeof note !== 'object') return note;
        if (note.isRest) {
            return {
                ...note,
                midi: Number.isFinite(note.midi) ? note.midi : 0,
                noteIndex: 0,
            };
        }

        const mod12Local = (n: number) => ((n % 12) + 12) % 12;

        // If MIDI is present, treat it as the source of truth for pitch class.
        const midi = Number(note.midi);
        if (Number.isFinite(midi)) {
            return {
                ...note,
                midi,
                noteIndex: mod12Local(midi),
            };
        }

        // Otherwise, try to derive pitch class from spelling under the current key.
        const letter = String(note.pitch || '').toUpperCase().charAt(0);
        const accFromType = (t: any): string => {
            switch (t) {
                case 'sharp':
                case '#':
                case '♯':
                    return '#';
                case 'flat':
                case 'b':
                case '♭':
                    return 'b';
                case 'natural':
                case 'n':
                case '♮':
                    return '';
                case 'double-sharp':
                case '##':
                case '𝄪':
                    return '##';
                case 'double-flat':
                case 'bb':
                case '𝄫':
                    return 'bb';
                default:
                    return '';
            }
        };
        const explicitAcc = accFromType(note.userAccidental) || accFromType(note.explicitAccidental) || accFromType(note.accidental);

        const defaultAccForLetter = (l: string): string => {
            try {
                if (!l) return '';
                const ks = keySignature;
                const type = String(ks?.type || 'natural');
                const count = Number(ks?.count || 0);
                const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
                const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
                if (type === 'sharp' && count > 0) return SHARP_ORDER.slice(0, count).includes(l) ? '#' : '';
                if (type === 'flat' && count > 0) return FLAT_ORDER.slice(0, count).includes(l) ? 'b' : '';
                return '';
            } catch {
                return '';
            }
        };

        if (letter) {
            const name = `${letter}${explicitAcc || defaultAccForLetter(letter)}`.replace('♯', '#').replace('♭', 'b');
            const idx = (noteNameToIndex as any)[name];
            if (Number.isFinite(idx)) {
                return {
                    ...note,
                    noteIndex: mod12Local(Number(idx)),
                };
            }
        }

        // Last resort: keep whatever noteIndex exists, but normalize it.
        const ni = Number(note.noteIndex);
        if (Number.isFinite(ni)) {
            return { ...note, noteIndex: mod12Local(ni) };
        }
        return note;
    } catch {
        return note;
    }
}

export function calculateNoteBeats(notes: StaffNote[], timeSignature: TimeSignature, timeSignatureChanges?: TimeSignatureChange[]): StaffNote[] {
    // Self-heal stale/corrupt MIDI: many analysis and playback paths rely on `midi`.
    // If an editor operation updates octave/spelling but leaves `midi` stale (or missing),
    // labels can change "depending on context" (e.g. inversion appears correct only after
    // forcing the bass down an octave). Normalize midi from (octave, noteIndex) when possible.
    const normalizedNotes = (notes || []).map((n: any) => {
        try {
            if (!n || n.isRest) return n;
            const octave = Number(n.octave);
            const noteIndex = Number(n.noteIndex);
            if (!Number.isFinite(octave) || !Number.isFinite(noteIndex)) return n;
            const computed = (octave + 1) * 12 + mod12(noteIndex);
            const cur = Number(n.midi);
            if (!Number.isFinite(cur) || cur !== computed) {
                return { ...n, midi: computed };
            }
            return n;
        } catch {
            return n;
        }
    });

    const baseBeatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
    const normalizeChanges = (): { measureIndex: number; numerator: number; denominator: number }[] => {
        const base = Math.max(1, Number.isFinite(baseBeatsPerMeasure) ? baseBeatsPerMeasure : 4);
        return (timeSignatureChanges || [])
            .map(c => {
                const absBeat = Number(c.absBeat);
                const m = Number.isFinite(c.measureIndex as any)
                    ? Number(c.measureIndex)
                    : (Number.isFinite(absBeat) ? Math.floor(absBeat / base) : 0);
                const n = Math.max(1, Math.round(Number(c.numerator)));
                const d = Math.max(1, Math.round(Number(c.denominator)));
                return { measureIndex: m, numerator: n, denominator: d };
            })
            .filter(c => Number.isFinite(c.measureIndex))
            .sort((a, b) => a.measureIndex - b.measureIndex);
    };
    const changes = normalizeChanges();
    const getBeatsPerMeasureForIndex = (m: number): number => {
        let active = timeSignature;
        for (const c of changes) {
            if (c.measureIndex <= m) {
                active = { numerator: c.numerator, denominator: c.denominator };
            } else {
                break;
            }
        }
        const bpm = active.numerator * (4 / active.denominator);
        return Math.max(1, Number.isFinite(bpm) ? bpm : baseBeatsPerMeasure || 4);
    };

    // IMPORTANT:
    // The editor uses tick-based timing (`startTick`) as the canonical timeline.
    // The previous implementation recomputed measureIndex/beat by *packing* notes
    // in array order (and even ignored existing startTick), which collapses empty
    // measures and causes later material to "slide back" when a bar is cleared.
    // That breaks copy/paste into earlier bars.

    const voices = new Map<Voice, StaffNote[]>();
    normalizedNotes.forEach(note => {
        const voice = (note as any).voice || 1;
        if (!voices.has(voice)) voices.set(voice, []);
        voices.get(voice)!.push(note);
    });

    // Build measure start positions in absBeat space up to the maximum time we need.
    const estimateAbsBeat = (n: any): number => {
        try {
            const st = n?.startTick;
            if (typeof st === 'number' && Number.isFinite(st)) return Math.max(0, st / TICKS_PER_QUARTER);
            const mi = Number.isFinite(n?.measureIndex) ? Math.max(0, Math.trunc(Number(n.measureIndex))) : 0;
            const b = Number.isFinite(n?.beat) ? Number(n.beat) : 1;
            const base = Math.max(1, Number.isFinite(baseBeatsPerMeasure) ? baseBeatsPerMeasure : 4);
            return (mi * base) + (Math.max(1, b) - 1);
        } catch {
            return 0;
        }
    };

    const maxAbsBeat = (normalizedNotes || []).reduce((mx, n: any) => Math.max(mx, estimateAbsBeat(n)), 0);
    const measureStartAbsBeat: number[] = [];
    let acc = 0;
    let m = 0;
    const maxNeeded = Math.max(0, maxAbsBeat) + (Math.max(1, Number.isFinite(baseBeatsPerMeasure) ? baseBeatsPerMeasure : 4) * 2);
    while (acc <= maxNeeded || m < 4) {
        measureStartAbsBeat[m] = acc;
        acc += getBeatsPerMeasureForIndex(m);
        m++;
        if (m > 10000) break; // hard safety
    }

    const findMeasureIndexForAbsBeat = (absBeat: number): number => {
        const t = Math.max(0, Number(absBeat) || 0);
        if (!measureStartAbsBeat.length) return 0;
        // binary search: last index with start <= t
        let lo = 0;
        let hi = measureStartAbsBeat.length - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            if ((measureStartAbsBeat[mid] ?? 0) <= t + 1e-9) lo = mid;
            else hi = mid - 1;
        }
        return Math.max(0, lo);
    };

    const processedNotes: StaffNote[] = [];

    voices.forEach(voiceNotes => {
        for (const note of voiceNotes) {
            const absBeat = estimateAbsBeat(note as any);
            const measureIndex = findMeasureIndexForAbsBeat(absBeat);
            const beat = (absBeat - (measureStartAbsBeat[measureIndex] ?? 0)) + 1;

            const next: any = {
                ...note,
                measureIndex,
                beat: Math.round(Number(beat) * 1e6) / 1e6,
            };

            // If startTick is missing, backfill it from absBeat.
            if (typeof (next as any).startTick !== 'number' || !Number.isFinite((next as any).startTick)) {
                (next as any).startTick = Math.round(absBeat * TICKS_PER_QUARTER);
            }

            processedNotes.push(next as StaffNote);
        }
    });

    return processedNotes.sort((a, b) => {
        const mDiff = (a.measureIndex ?? 0) - (b.measureIndex ?? 0);
        if (mDiff !== 0) return mDiff;
        const aSt = Number((a as any).startTick);
        const bSt = Number((b as any).startTick);
        if (Number.isFinite(aSt) && Number.isFinite(bSt) && aSt !== bSt) return aSt - bSt;
        const bDiff = (a.beat ?? 0) - (b.beat ?? 0);
        if (bDiff !== 0) return bDiff;
        return (a.voice ?? 1) - (b.voice ?? 1);
    });
}

function getIntervalQuality(
    diatonicSize: number,
    semitones: number
): 'Perfect' | 'Major' | 'Minor' | 'Augmented' | 'Diminished' | null {
    const size = diatonicSize;
    switch (size) {
        case 0:
        case 3:
        case 4:
        case 7: {
            const perfectSemitones = { 0: 0, 3: 5, 4: 7, 7: 12 }[size]!;
            if (semitones === perfectSemitones) return 'Perfect';
            if (semitones === perfectSemitones + 1) return 'Augmented';
            if (semitones === perfectSemitones - 1) return 'Diminished';
            break;
        }
        case 1:
        case 2:
        case 5:
        case 6: {
            const majorSemitones = { 1: 2, 2: 4, 5: 9, 6: 11 }[size]!;
            if (semitones === majorSemitones) return 'Major';
            if (semitones === majorSemitones - 1) return 'Minor';
            if (semitones > majorSemitones) return 'Augmented';
            return 'Diminished';
        }
    }
    return null;
}

// NOTE: per supportare rosso/arancio/verde + linee di connessione,
// assicurati che applyHarmonyRules produca `connections` con campi tipo:
// - fromNoteId/toNoteId (oppure noteIds)
// - severity: 'error' | 'warning' | 'exception' (o equivalente coerente)

// NOTE: this is the full rules engine entrypoint expected by the editor.
// It relies on helpers already defined above in this file (getDirection, getInterval, identifyChord, etc.).
export function applyHarmonyRules(
    notes: StaffNote[],
    keySignature: KeySignature,
    keyTonic: string,
    isMinor: boolean,
    analysisContexts: AnalysisContext[],
    timeSignature?: TimeSignature,
    doubleBarlineMeasures?: number[],
    ornamentOverrides?: OrnamentOverride[],
    harmonyOverrides?: HarmonyLabelOverride[]
): HarmonyAnalysisResult {
    const DEBUG_ANALYSIS = (() => {
        try {
            return String(((import.meta as any)?.env?.VITE_ANALYSIS_DEBUG ?? '')).trim() === '1';
        } catch {
            return false;
        }
    })();
    const ENABLE_ENHARMONIC_WARNINGS = (() => {
        try {
            return String(((import.meta as any)?.env?.VITE_ENHARMONIC_WARNINGS ?? '')).trim() === '1';
        } catch {
            return false;
        }
    })();
    const ENABLE_DEV_ANALYSIS_WARNINGS = (() => {
        try {
            // Opt-in only: dev-only analysis warnings are useful for debugging but can spam.
            return String(((import.meta as any)?.env?.VITE_ANALYSIS_DEV_WARNINGS ?? '')).trim() === '1';
        } catch {
            return false;
        }
    })();
    const debugLog = (...args: any[]) => {
        if (!DEBUG_ANALYSIS) return;
        try { console.log(...args); } catch (_) {}
    };

    // ── Profiling helper (zero-cost when inactive) ──
    const _profiling = typeof globalThis !== 'undefined' && (globalThis as any).__HARMONY_PROFILE;
    const _pTimings: Record<string, number> = {};
    let _pLast = _profiling ? performance.now() : 0;
    const _pmark = _profiling
        ? (label: string) => { const now = performance.now(); _pTimings[label] = now - _pLast; _pLast = now; }
        : (_label: string) => {};

    // ── User harmony-override beat set ──
    // At beats with explicit user chord overrides, skip automatic ornament
    // marking so every note at that beat is treated as structural.
    const _harmonyOverrideBeats = new Set<number>();
    try {
        if (harmonyOverrides?.length) {
            const q = 192;
            for (const ov of harmonyOverrides) {
                const a = Number(ov?.absBeat);
                if (Number.isFinite(a)) _harmonyOverrideBeats.add(Math.round(a * q) / q);
            }
        }
    } catch { /* ignore */ }
    const _bpmForHO = (timeSignature?.numerator ?? 4) * (4 / (timeSignature?.denominator ?? 4));
    const _isHarmOverrideBeat = (n: any): boolean => {
        if (!_harmonyOverrideBeats.size || !n) return false;
        try {
            const ab = ((n.measureIndex ?? 0) * _bpmForHO) + ((n.beat ?? 1) - 1);
            return _harmonyOverrideBeats.has(Math.round(ab * 192) / 192);
        } catch { return false; }
    };

    // ── Cached getRomanAnalysis for modulation-detection hot path ──
    // Avoids redundant chord-recognition in O(n²×k) nested loops.
    const _romanCache = new Map<string, { roman: string; figures: string[] } | null>();
    const _gRA = (chord: StaffNote[], keyRoot: string, minor: boolean): { roman: string; figures: string[] } | null => {
        if (!chord || chord.length < 2) return null;
        // Filter out notes with manual ornament override (appoggiatura, etc.)
        const filtered = chord.filter((n: any) => !(n?.ornamentOverride && n.ornamentOverride !== 'structural'));
        if (filtered.length < 2) return null;
        const k = filtered.map(n => `${n.midi ?? 0}:${n.pitch ?? ''}${n.explicitAccidental || ''}`).sort().join(',') + '|' + keyRoot + (minor ? 'm' : 'M');
        if (_romanCache.has(k)) return _romanCache.get(k)!;
        const r = getRomanAnalysis(filtered, keyRoot, minor);
        _romanCache.set(k, r);
        return r;
    };

    // Cached identifyChord for suspension / modulation hot paths
    const _chordCache = new Map<string, ReturnType<typeof identifyChord>>();
    const _iC = (notes: StaffNote[]): ReturnType<typeof identifyChord> => {
        if (!notes || notes.length < 2) return identifyChord(notes);
        const filtered = notes.filter((n: any) => !(n?.ornamentOverride && n.ornamentOverride !== 'structural'));
        if (filtered.length < 2) return identifyChord(filtered);
        const k = filtered.map(n => n.midi ?? 0).sort((a, b) => a - b).join(',');
        if (_chordCache.has(k)) return _chordCache.get(k)!;
        const r = identifyChord(filtered);
        _chordCache.set(k, r);
        return r;
    };

    // Sequence matches (imitated progressions) for rule attenuation.
    // Computed once per analysis run to avoid per-event recomputation.
    const getSequenceMatchesForRules = (() => {
        let cached: any[] | null | undefined = undefined;
        return () => {
            if (cached !== undefined) return cached || [];
            try {
                const ts = timeSignature || { numerator: 4, denominator: 4 };
                cached = detectVoiceLeadingSequences((notes || []) as any, ts as any, undefined, undefined, {
                    minSteps: 2,
                    maxSteps: 8,
                    minConfidence: 0.7,
                    maxMatches: 200,
                }, {
                    keySignatureRoot: String(keyTonic || 'C'),
                    isMinorMode: !!isMinor,
                }) as any;
            } catch {
                cached = [];
            }
            return cached || [];
        };
    })();

    const isTickInsideImitatedSequence = (tick: number | null | undefined): boolean => {
        if (tick == null || !Number.isFinite(tick as number)) return false;
        const t = Number(tick);
        const seq = getSequenceMatchesForRules();
        if (!seq.length) return false;
        const EPS = 1;
        return seq.some((s: any) => Number.isFinite(s?.startTick as any)
            && Number.isFinite(s?.endTick as any)
            && t >= (Number(s.startTick) - EPS)
            && t <= (Number(s.endTick) + EPS));
    };

    const ENABLE_INFERRED_ANALYSIS_CONTEXTS = (() => {
        try {
            // Default ON (feature requested for long modulations).
            // Can be disabled explicitly via VITE_ENABLE_INFERRED_CONTEXTS=0/false.
            const raw = (import.meta as any)?.env?.VITE_ENABLE_INFERRED_CONTEXTS;
            const v = String(raw ?? '').trim().toLowerCase();
            if (v === '0' || v === 'false' || v === 'off') return false;
            if (v === '1' || v === 'true' || v === 'on') return true;
            return true;
        } catch {
            return true;
        }
    })();

    const ENABLE_AUTO_CADENCE_LABEL_OVERRIDES = (() => {
        try {
            const v = String(((import.meta as any)?.env?.VITE_ENABLE_AUTO_CADENCE_OVERRIDES ?? '')).trim();
            return v === '1' || v.toLowerCase() === 'true';
        } catch {
            return false;
        }
    })();

    const absBeatToMeasureBeat = (absBeat: number) => {
        try {
            const bpm = (timeSignature ? (timeSignature.numerator * (4 / timeSignature.denominator)) : 4) || 4;
            const m = Math.floor(absBeat / bpm);
            const b0 = absBeat - m * bpm;
            return { measureIndex: m, beat: b0 + 1 };
        } catch {
            return { measureIndex: null, beat: null };
        }
    };
    // Defensive normalization: in some saved/edited states `noteIndex` can become stale.
    // Keep spelling-related fields intact; only align pitch-class for analysis.
    const analyzedNotes = (notes || []).map((n) => {
        try {
            if (!n || (n as any).isRest) return n;
            const pc = pitchClassOf(n as any);
            if (Number.isFinite(pc)) {
                return { ...(n as any), noteIndex: mod12(pc as number) } as StaffNote;
            }
        } catch { /* ignore */ }
        return n;
    });
    debugLog('[ANALYSIS] applyHarmonyRules called - notes:', analyzedNotes.length, 'key:', keyTonic, 'isMinor:', isMinor);

    // ── Tag manual ornament overrides early (marker only, no detection flags). ──
    // We only set `ornamentOverride` so that `notesForRomanAt` can exclude these notes
    // from Roman / figured-bass labelling.  The actual detection flags (isPassing,
    // isNeighbor …) are applied at the END of the pipeline to avoid interfering
    // with auto-detection of passing / neighbor / appoggiatura notes.
    try {
        if (ornamentOverrides?.length) {
            // Direct ID match
            const ovByIdEarly = new Map<string, string>();
            for (const o of ornamentOverrides) {
                if (o?.noteId && o?.type) ovByIdEarly.set(o.noteId, o.type);
            }
            // Composite key match for orphaned IDs (midi-measureIndex-beat)
            const ovByCkEarly = new Map<string, string>();
            const noteIdSet = new Set(analyzedNotes.map(n => n.id));
            for (const o of ornamentOverrides) {
                if (!o?.type) continue;
                if (o.noteId && noteIdSet.has(o.noteId)) continue; // will be matched by ID
                if (o.midi != null && o.measureIndex != null && o.beat != null) {
                    ovByCkEarly.set(`${o.midi}-${o.measureIndex}-${o.beat}`, o.type);
                }
            }
            for (const n of analyzedNotes) {
                let ov = ovByIdEarly.get(n.id);
                if (!ov && ovByCkEarly.size > 0) {
                    const midi = Number((n as any).midi);
                    if (Number.isFinite(midi)) {
                        ov = ovByCkEarly.get(`${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`);
                    }
                }
                if (!ov) continue;
                (n as any).ornamentOverride = ov;
            }
        }
    } catch { /* ignore */ }

    let violations: RuleViolation[] = [];
    const connections: ErrorConnection[] = [];
    const inferredAnalysisContexts: AnalysisContext[] = [];
    const autoHarmonyLabelOverrides: HarmonyLabelOverride[] = [];

    const preferFlatsForAuto = (() => {
        try {
            return String(keyTonic || '').includes('b') || (FLAT_KEY_COUNTS as any)[String(keyTonic || '')] != null;
        } catch {
            return true;
        }
    })();

    const pcToKeyNameAuto = (pc: number): string => {
        const names = (ALL_NOTE_SPELLINGS as any)[mod12(pc)] as string[] | undefined;
        if (!Array.isArray(names) || names.length === 0) return 'C';
        if (preferFlatsForAuto) {
            const flat = names.find(n => String(n).includes('b'));
            if (flat) {
                if (flat === 'Cb') return 'B';
                if (flat === 'Fb') return 'E';
                return flat;
            }
        } else {
            const sharp = names.find(n => String(n).includes('#'));
            if (sharp) {
                if (sharp === 'B#') return 'C';
                if (sharp === 'E#') return 'F';
                return sharp;
            }
        }
        const natural = names.find(n => !String(n).includes('b') && !String(n).includes('#'));
        return natural || names[0];
    };

    const safeBeatsPerMeasure = (ts?: TimeSignature) => {
        if (!ts) return 4;
        return ts.numerator * (4 / ts.denominator);
    };

    const beatsPerMeasure = safeBeatsPerMeasure(timeSignature);

    const ctxAbsBeat = (c: AnalysisContext) => {
        const m = c.measureIndex ?? 0;
        const legacyAbs = m * beatsPerMeasure;
        const a = c.absBeat;
        return Number.isFinite(a as any) ? (a as number) : legacyAbs;
    };

    // Resolve applicable context at a given absolute beat.
    const getContextAtAbsBeat = (absBeat: number) => {
        const applicable = (analysisContexts || [])
            .filter(c => ctxAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => ctxAbsBeat(b) - ctxAbsBeat(a))[0];
        return {
            tonic: applicable ? applicable.newTonic : keyTonic,
            isMinor: applicable ? applicable.newIsMinor : isMinor,
        };
    };

    const tonicPc = (() => {
        const idx = noteNameToIndex[keyTonic];
        return Number.isFinite(idx) ? idx : 0;
    })();

    const leadingPc = mod12(tonicPc - 1);

    const isPerfectOctaveOrUnison = (semitonesMod12: number) => semitonesMod12 === 0;
    const isPerfectFifth = (semitonesMod12: number) => semitonesMod12 === 7;

    const stepDown = (fromMidi: number, toMidi: number) => (toMidi === fromMidi - 1) || (toMidi === fromMidi - 2);
    const stepUpToTonic = (fromMidi: number, toMidi: number, tonicPitchClass: number) =>
        (toMidi % 12) === tonicPitchClass && (toMidi > fromMidi) && (toMidi - fromMidi <= 2);

    const dir = (a: number, b: number) => {
        const d = b - a;
        return d === 0 ? 0 : d > 0 ? 1 : -1;
    };

    const addViolation = (v: RuleViolation) => {
        if (!v.noteIds || v.noteIds.length === 0) return;
        // Auto-enrich from ruleTexts registry (centralised educational texts).
        const _rt = getRuleText(v.ruleId);
        if (_rt.body && !v.description.includes('\n')) {
            v = { ...v, description: v.description + '\n' + _rt.body };
        }
        if (_rt.suggestion && !v.suggestion) {
            v = { ...v, suggestion: _rt.suggestion };
        }
        // de-dupe by (ruleId + same set of noteIds at least)
        const key = `${v.ruleId}::${[...new Set(v.noteIds)].sort().join(',')}`;
        if ((addViolation as any)._seen?.has(key)) return;
        (addViolation as any)._seen = (addViolation as any)._seen || new Set<string>();
        (addViolation as any)._seen.add(key);
        violations.push({ ...v, noteIds: [...new Set(v.noteIds)] });
    };

    // --- Helpers for passing-note detection ---
    const getIntervalSemitones = (m1: number, m2: number) => Math.abs((m1 ?? 0) - (m2 ?? 0));

    type ChordEvent = { absBeat: number; measureIndex: number; beat: number; notes: StaffNote[]; byVoice: Map<number, StaffNote> };

    const isNoteInChord = (note: StaffNote | undefined | null, ev: ChordEvent | undefined | null) => {
        if (!note || !ev || !ev.notes) return false;
        try {
            const pcs = ev.notes.filter(n => n && !n.isRest).map(n => mod12(n.midi));
            return pcs.includes(mod12(note.midi));
        } catch {
            return false;
        }
    };

    // ---- Build chord timeline (SCAN-LINE: Include ALL note changes, including sustained and short values) ----

    // 1. Helper per calcolare la durata in beat (se non esiste già)
    const getDuration = (n: StaffNote): number => {
        const base = (DURATION_VALUES as any)[n.duration] || 1;
        let val = base;
        if (n.isDotted) val *= 1.5;
        if (n.isTriplet) val *= 2 / 3;
        if (n.isDuplet) val *= 3 / 2;
        return val;
    };

    const beatsPerMeas = timeSignature.numerator * (4 / timeSignature.denominator);

    // 2. Trova tutti i punti temporali in cui succede qualcosa (INIZIO o FINE nota)
    //    Keep track of onsets separately so chord-completeness warnings can ignore
    //    “pure release” instants that create artificial sparse verticalities.
    const scanPointsSet = new Set<number>();
    const onsetPointsSet = new Set<number>();
    analyzedNotes.forEach(n => {
        if (n.isRest) return;
        const m = n.measureIndex ?? 0;
        const b = n.beat ?? 1;
        const start = (m * beatsPerMeas) + (b - 1);
        const end = start + getDuration(n);
        scanPointsSet.add(start);
        scanPointsSet.add(end);
        onsetPointsSet.add(start);
    });
    const scanPoints = Array.from(scanPointsSet).sort((a, b) => a - b);

    // 3. Costruisci gli eventi: per ogni punto, chi sta suonando?
    const chordEvents = scanPoints.map(absBeat => {
        // Filtra note attive: Iniziate prima o ora, e che finiscono nel futuro
        const activeNotes = analyzedNotes.filter(n => {
            if (n.isRest) return false;
            const m = n.measureIndex ?? 0;
            const b = n.beat ?? 1;
            const start = (m * beatsPerMeas) + (b - 1);
            const dur = getDuration(n);
            // È attiva se start <= absBeat < end
            return start <= absBeat && absBeat < (start + dur - 1e-6);
        });

        // Raggruppa per voce (vince la nota più recente per ogni voce)
        const byVoice = new Map<number, StaffNote>();
        activeNotes.forEach(n => {
            const v = n.voice ?? 1;
            const m = n.measureIndex ?? 0;
            const b = n.beat ?? 1;
            const start = (m * beatsPerMeas) + (b - 1);
            const prev = byVoice.get(v);
            if (!prev) {
                byVoice.set(v, n);
            } else {
                const prevM = prev.measureIndex ?? 0;
                const prevB = prev.beat ?? 1;
                const prevStart = (prevM * beatsPerMeas) + (prevB - 1);
                if (start > prevStart) byVoice.set(v, n);
            }
        });

        // Calcola info descrittive per l'evento
        const measureIndex = Math.floor(absBeat / beatsPerMeas);
        const beat = (absBeat % beatsPerMeas) + 1;

        return {
            absBeat,
            measureIndex,
            beat,
            notes: Array.from(byVoice.values()),
            byVoice
        };
    });

    _pmark('01-setup+chordTimeline');
    // =========================================================
    // Two-Track Analysis: Enharmonic sanity check (verify-only)
    // =========================================================
    try {
        if (!ENABLE_ENHARMONIC_WARNINGS) {
            // Opt-in only: this check is useful for diagnosing inconsistent MIDI vs spelling
            // but can be noisy (especially in suspension-heavy textures).
            throw new Error('enharmonic-warnings-disabled');
        }
        // Emit at most one warning per note id to avoid spamming in suspension-heavy textures
        // where the same held note appears across many chordEvents.
        const warnedNoteIds = new Set<string>();
        const ruleId = 'R-ENHARMONIC';
        const suggestion = 'Correggi la grafia (pitch/alterazione) o il MIDI della nota per rendere coerente lo spelling con ciò che si ascolta.';

        for (const ev of chordEvents) {
            const sounding = (ev?.notes || []).filter(n => n && !n.isRest && Number.isFinite((n as any).midi));
            if (sounding.length < 2) continue;

            // Choose bass by actual MIDI (stable track).
            const bass = sounding.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
            if (!bass?.id) continue;
            const bassSpelledMidi = spelledMidiFromPitchAccidentalOctave(bass as any);

            for (const n of sounding) {
                if (!n || n === bass) continue;
                if (!n.id) continue;

                if (warnedNoteIds.has(n.id)) continue;

                // Only run this check when at least one side has explicit spelling.
                if (!(hasExplicitSpelling(bass as any) || hasExplicitSpelling(n as any))) continue;

                const nSpelledMidi = spelledMidiFromPitchAccidentalOctave(n as any);
                if (!Number.isFinite(bassSpelledMidi as any) || !Number.isFinite(nSpelledMidi as any)) continue;

                const midiSemis = Math.abs(Number((n as any).midi) - Number((bass as any).midi));
                const spelledSemis = Math.abs((nSpelledMidi as number) - (bassSpelledMidi as number));
                if (!Number.isFinite(midiSemis) || !Number.isFinite(spelledSemis)) continue;

                if (midiSemis !== spelledSemis) {
                    const spelled = spelledInterval(bass as any, n as any);
                    const spelledName = spelled ? `${spelled.quality}${spelled.diatonicNumber}` : '';
                    const heardName = intervalNameFromSemitones(midiSemis);
                    const bassLbl = noteSpellingLabel(bass as any);
                    const noteLbl = noteSpellingLabel(n as any);
                    const pairLbl = (bassLbl || noteLbl) ? ` [${bassLbl || 'bass'}→${noteLbl || 'note'}]` : '';
                    const bassMidi = Number((bass as any).midi);
                    const nMidi = Number((n as any).midi);
                    const bassSp = spelledMidiFromPitchAccidentalOctave(bass as any);
                    const nSp = spelledMidiFromPitchAccidentalOctave(n as any);
                    const dBass = (Number.isFinite(bassMidi) && Number.isFinite(bassSp as any)) ? (bassMidi - (bassSp as number)) : null;
                    const dNote = (Number.isFinite(nMidi) && Number.isFinite(nSp as any)) ? (nMidi - (nSp as number)) : null;
                    const extra = `bass[midi=${Number.isFinite(bassMidi) ? bassMidi : '?'} sp=${Number.isFinite(bassSp as any) ? bassSp : '?'} Δ=${dBass == null ? '?' : (dBass >= 0 ? `+${dBass}` : `${dBass}`)}] `
                        + `note[midi=${Number.isFinite(nMidi) ? nMidi : '?'} sp=${Number.isFinite(nSp as any) ? nSp : '?'} Δ=${dNote == null ? '?' : (dNote >= 0 ? `+${dNote}` : `${dNote}`)}]`;
                    const description = `Incoerenza enarmonica${pairLbl}. Intervallo udito: ${heardName || `${midiSemis} st`} (${midiSemis} st), ma scritto come: ${spelledName || `${spelledSemis} st`} (${spelledSemis} st). ${extra}`;

                    warnedNoteIds.add(n.id);
                    addViolation({
                        ruleId,
                        severity: 'warning' as any,
                        description,
                        suggestion,
                        noteIds: [bass.id, n.id],
                    } as any);
                }
            }
        }
    } catch { /* ignore sanity-check errors */ }

    _pmark('02-enharmonicSanity');
    // =========================================================
    // Auto cadence label overrides: IV–V–I and ii–V–I (label-only)
    // =========================================================
    // Goal: recognize clear predominant→dominant→tonic cadences even when the global key
    // would label them as ♭VII–I–IV, etc. This does NOT change key contexts; it only emits
    // display/label overrides at specific absBeats.
    try {
        if (!ENABLE_AUTO_CADENCE_LABEL_OVERRIDES) throw new Error('auto-cadence-overrides-disabled');
        const qAbs = (x: number) => {
            try {
                const q = 192;
                return Math.round(Number(x) * q) / q;
            } catch {
                return Number(x) || 0;
            }
        };

        const getRootPc = (ev: ChordEvent): number | null => {
            try {
                const cands = identifyChordCandidates(ev.notes || []);
                const best = Array.isArray(cands) ? cands[0] : null;
                const pc = Number((best as any)?.root?.noteIndex);
                return Number.isFinite(pc) ? mod12(pc) : null;
            } catch {
                return null;
            }
        };

        const isStrongBeat = (ev: ChordEvent): boolean => {
            try {
                const b = Number(ev.beat);
                if (!Number.isFinite(b)) return false;
                const EPS = 1e-3;
                const nearInt = Math.abs(b - Math.round(b)) < EPS;
                if (!nearInt) return false;
                const beat1 = Math.round(b);
                return beat1 === 1 || (timeSignature && timeSignature.numerator >= 4 && beat1 === 3);
            } catch {
                return false;
            }
        };

        // De-dupe: keep last override per absBeat.
        const setOverride = (absBeat: number, ov: Partial<HarmonyLabelOverride>) => {
            const a = qAbs(absBeat);
            const existingIdx = autoHarmonyLabelOverrides.findIndex(x => Math.abs(qAbs(x.absBeat) - a) < 1e-9);
            const next: HarmonyLabelOverride = {
                absBeat,
                roman: ov.roman,
                romanDisplay: ov.romanDisplay,
                figures: ov.figures,
                symbol: ov.symbol,
                note: ov.note,
            };
            if (existingIdx >= 0) autoHarmonyLabelOverrides[existingIdx] = next;
            else autoHarmonyLabelOverrides.push(next);
        };

        for (let i = 0; i < (chordEvents || []).length; i++) {
            const c = chordEvents[i];
            if (!c) continue;
            if (!isStrongBeat(c)) continue;

            const cRoot = getRootPc(c);
            if (cRoot == null) continue;

            const localTonicPc = cRoot;
            const localTonic = pcToKeyNameAuto(localTonicPc);

            // Determine local mode by whether the arrival reads as I or i.
            const cMaj = String(getRomanAnalysis(c.notes || [], localTonic, false)?.roman || '');
            const cMin = String(getRomanAnalysis(c.notes || [], localTonic, true)?.roman || '');
            const localIsMinor = cMin === 'i';
            const localI = localIsMinor ? 'i' : 'I';
            if (!(cMaj === 'I' || cMin === 'i')) continue;

            const wantV = mod12(localTonicPc + 7);
            const wantIV = mod12(localTonicPc + 5);
            const wantII = mod12(localTonicPc + 2);

            // Find a recent V (allow inversion): any chord whose ROOT is V.
            let bIdx = -1;
            for (let j = i - 1; j >= 0; j--) {
                const b = chordEvents[j];
                if (!b) continue;
                if ((c.absBeat - b.absBeat) > 2.01) break;
                const bRoot = getRootPc(b);
                if (bRoot == null) continue;
                if (bRoot === wantV) { bIdx = j; break; }
            }
            if (bIdx < 0) continue;

            // Find a recent IV or ii before that.
            let aIdx = -1;
            let aKind: 'IV' | 'ii' | null = null;
            for (let j = bIdx - 1; j >= 0; j--) {
                const a = chordEvents[j];
                if (!a) continue;
                if ((chordEvents[bIdx].absBeat - a.absBeat) > 2.01) break;
                const aRoot = getRootPc(a);
                if (aRoot == null) continue;
                if (aRoot === wantIV) { aIdx = j; aKind = 'IV'; break; }
                if (aRoot === wantII) { aIdx = j; aKind = 'ii'; break; }
            }
            if (aIdx < 0 || !aKind) continue;

            const aEv = chordEvents[aIdx];
            const bEv = chordEvents[bIdx];

            // Emit overrides.
            const aRoman = (() => {
                try {
                    const rr = String(getRomanAnalysis(aEv.notes || [], localTonic, localIsMinor)?.roman || '').trim();
                    if (rr) return rr;
                } catch { /* ignore */ }
                if (aKind === 'IV') return localIsMinor ? 'iv' : 'IV';
                // ii in minor is often diminished; keep it simple as ii°.
                return localIsMinor ? 'ii°' : 'ii';
            })();

            setOverride(aEv.absBeat, { roman: aRoman });
            setOverride(bEv.absBeat, { roman: 'V' });
            setOverride(c.absBeat, { roman: localI });
        }

        // Sort for deterministic consumers.
        autoHarmonyLabelOverrides.sort((a, b) => qAbs(a.absBeat) - qAbs(b.absBeat));
    } catch { /* ignore */ }

    // =========================================================
    // Predominant disambiguation: prefer ii/ii°/iv/IV before V
    // =========================================================
    // Independent of ENABLE_AUTO_CADENCE_LABEL_OVERRIDES.
    // When a chord immediately precedes a clear dominant (V or V/x) and its
    // current roman label is an exotic secondary function (e.g. vii°/IV),
    // re-analyse it in the target key of the dominant.  If the result is a
    // natural predominant (ii, ii°, iv, IV), override the label.
    try {
        const PREDOM_RE = /^(ii[°⁰o]?|iv|IV)$/i;
        const V_RE = /^V(\/|$)/;
        const _pushOverride = (absBeat: number, roman: string, figures?: string[]) => {
            const existing = autoHarmonyLabelOverrides.findIndex(
                x => Math.abs(x.absBeat - absBeat) < 1e-9
            );
            const entry: HarmonyLabelOverride = { absBeat, roman, figures } as any;
            if (existing >= 0) autoHarmonyLabelOverrides[existing] = entry;
            else autoHarmonyLabelOverrides.push(entry);
        };
        const _getRootPc = (ev: ChordEvent): number | null => {
            try {
                const cands = identifyChordCandidates(ev.notes || []);
                const best = Array.isArray(cands) ? cands[0] : null;
                const pc = Number((best as any)?.root?.noteIndex);
                return Number.isFinite(pc) ? mod12(pc) : null;
            } catch { return null; }
        };

        for (let pi = 1; pi < (chordEvents || []).length; pi++) {
            const curr = chordEvents[pi];
            const prev = chordEvents[pi - 1];
            if (!curr || !prev) continue;
            if ((curr.absBeat - prev.absBeat) > 2.01) continue;

            const currCtx = getContextAtAbsBeat(curr.absBeat);
            const currRoman = String(getRomanAnalysis(
                curr.notes || [], currCtx.tonic, currCtx.isMinor
            )?.roman || '').replace(/\s+/g, '');

            if (!V_RE.test(currRoman)) continue;

            // Determine target key
            let targetPc: number;
            let targetIsMinor: boolean;
            if (currRoman === 'V' || (currRoman.startsWith('V') && !currRoman.includes('/'))) {
                const tonicName = String(currCtx.tonic || '').trim();
                const tonicBaseIdx = NOTE_NAMES.indexOf(tonicName.replace(/[#b♯♭]/g, '').toUpperCase());
                if (tonicBaseIdx < 0) continue;
                const tonicAcc = tonicName.replace(/^[A-G]/i, '');
                const accVal = tonicAcc.split('').reduce((s, ch) => s + (ch === '#' || ch === '♯' ? 1 : ch === 'b' || ch === '♭' ? -1 : 0), 0);
                targetPc = mod12(tonicBaseIdx + accVal);
                targetIsMinor = currCtx.isMinor;
            } else {
                const rPc = _getRootPc(curr);
                if (rPc == null) continue;
                targetPc = mod12(rPc - 7);
                const afterSlash = currRoman.split('/')[1] || '';
                targetIsMinor = afterSlash === afterSlash.toLowerCase();
            }

            const targetKey = pcToKeyNameAuto(targetPc);

            // Get the current roman of the previous chord in its OWN context
            const prevCtx = getContextAtAbsBeat(prev.absBeat);
            const prevRomanOwn = String(getRomanAnalysis(
                prev.notes || [], prevCtx.tonic, prevCtx.isMinor
            )?.roman || '').replace(/\s+/g, '');

            // Skip if already a clean predominant
            if (PREDOM_RE.test(prevRomanOwn)) continue;
            // Skip if already a plain diatonic function (not exotic)
            if (!prevRomanOwn.includes('/') && /^(I|i|V|vi|VI|iii|III)$/i.test(prevRomanOwn)) continue;

            // Re-analyse the previous chord in the TARGET key (both modes)
            const prevRomanMaj = String(getRomanAnalysis(
                prev.notes || [], targetKey, false
            )?.roman || '').replace(/\s+/g, '');
            const prevRomanMin = String(getRomanAnalysis(
                prev.notes || [], targetKey, true
            )?.roman || '').replace(/\s+/g, '');

            let bestPredom: string | null = null;
            if (PREDOM_RE.test(prevRomanMin)) bestPredom = prevRomanMin;
            else if (PREDOM_RE.test(prevRomanMaj)) bestPredom = prevRomanMaj;

            if (bestPredom) {
                const useMinor = PREDOM_RE.test(prevRomanMin);
                const figResult = getRomanAnalysis(prev.notes || [], targetKey, useMinor);
                // Append tonicization target: V/ii → ii°/ii
                const slashIdx = currRoman.indexOf('/');
                const tonicSuffix = slashIdx >= 0 ? currRoman.slice(slashIdx) : '';
                _pushOverride(prev.absBeat, bestPredom + tonicSuffix, figResult?.figures);
            }
        }
    } catch { /* ignore */ }

    _pmark('03-autoCadenceLabels');
    // ---- Sounding harmony per beat (duration-aware) ----
    // Needed for rules that depend on harmonic rhythm (e.g., harmonic syncopation).
    const durationToBeats = (d?: StaffNote['duration']) => {
        switch (d || 'quarter') {
            case 'whole': return 4;
            case 'half': return 2;
            case 'quarter': return 1;
            case 'eighth': return 0.5;
            case 'sixteenth': return 0.25;
            case 'thirty-second': return 0.125;
            case 'sixty-fourth': return 0.0625;
            default: return 1;
        }
    };

    const noteSpan = analyzedNotes
        .filter(n => !n.isRest)
        .map(n => {
            const m = n.measureIndex ?? 0;
            const b = n.beat ?? 1;
            const start = (m * beatsPerMeasure) + (b - 1);
            const baseLen = durationToBeats(n.duration);
            const dotted = n.isDotted ? 1.5 : 1;
            const tuplet = n.isTriplet ? (2 / 3) : (n.isDuplet ? (3 / 2) : 1);
            const len = baseLen * dotted * tuplet;
            return { note: n, startAbsBeat: start, endAbsBeat: start + Math.max(len, 0.0001) };
        });

    const maxAbsBeat = noteSpan.reduce((mx, s) => Math.max(mx, Math.ceil(s.endAbsBeat)), 0);

    const soundingNotesAt = (absBeat: number): StaffNote[] =>
        noteSpan
            .filter(s => absBeat >= s.startAbsBeat && absBeat < s.endAbsBeat)
            .map(s => s.note);

    const chordSignature = (sounding: StaffNote[]): string => {
        const pcs = [...new Set(sounding.filter(n => !n.isRest).map(n => mod12(n.midi)))].sort((a, b) => a - b);
        return pcs.join('-');
    };

    const pickOuterVoice = (sounding: StaffNote[], voice: Voice): StaffNote | undefined => {
        const byV = sounding.filter(n => (n.voice ?? 1) === voice);
        if (byV.length) return byV[0];
        // Fallback if voice info missing: use extremes (soprano highest, bass lowest).
        const sorted = sounding.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0));
        if (!sorted.length) return undefined;
        return voice === 1 ? sorted[sorted.length - 1] : voice === 4 ? sorted[0] : undefined;
    };

    _pmark('04-soundingHarmony');
    // ---- Per-voice melodic lines (sorted by time) ----
    const notesByVoice: Record<Voice, StaffNote[]> = { 1: [], 2: [], 3: [], 4: [] };
    analyzedNotes
        .filter(n => !n.isRest)
        .forEach(n => {
            const v = (n.voice ?? 1) as Voice;
            notesByVoice[v].push(n);
        });
    (Object.keys(notesByVoice) as unknown as Voice[]).forEach(v => {
        notesByVoice[v].sort((a, b) => {
            const ma = a.measureIndex ?? 0;
            const mb = b.measureIndex ?? 0;
            if (ma !== mb) return ma - mb;
            return (a.beat ?? 1) - (b.beat ?? 1);
        });
    });

    _pmark('05-perVoiceMelodicLines');
    // -----------------------
    // Passing-note detector
    // -----------------------
    function detectPassingNotes(notesByVoice: Record<Voice, StaffNote[]>, chordEvents: ChordEvent[], beatsPerMeasure: number): void {
        const voices: Voice[] = [1, 2, 3, 4];

        const isCompound = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
        const isStrongPulseBeat = (beat: number) => {
            // `beat` is in quarter units with 1-based indexing.
            const b0 = beat - 1;
            if (!Number.isFinite(b0 as any)) return false;
            if (!isCompound) return Math.abs(b0 - Math.round(b0)) < 1e-6;
            const pulse = 1.5;
            const r = ((b0 % pulse) + pulse) % pulse;
            return Math.abs(r) < 1e-6;
        };

        debugLog('[ANALYSIS] detectPassingNotes start - voices counts:', Object.fromEntries((Object.keys(notesByVoice) as unknown as Voice[]).map(v=>[v, notesByVoice[v].length])));

        const findEventForNote = (note: StaffNote, voice: Voice) => {
            for (const ev of chordEvents) {
                try {
                    const vNote = ev.byVoice.get(voice);
                    if (vNote && vNote.id === note.id) return ev;
                    if (ev.notes && ev.notes.find(n => n.id === note.id)) return ev;
                    // Fallback: match by measureIndex + beat in case short passing notes
                    const evMeasure = ev.measureIndex ?? 0;
                    const evBeat = ev.beat ?? 1;
                    const noteMeasure = note.measureIndex ?? 0;
                    const noteBeat = note.beat ?? 1;
                    if (evMeasure === noteMeasure && Math.abs(evBeat - noteBeat) < 1e-6) return ev;
                } catch (_) { /* ignore */ }
            }
            return undefined as ChordEvent | undefined;
        };

        // With scan-point chordEvents that include *all* note changes (including very short notes),
        // a naive pitch-class membership check against `ev.notes` will almost always consider the
        // current note "in chord" (because it is literally present in the vertical set).
        // For passing notes we approximate the underlying harmony using only "structural" notes:
        // - bass voice always counts
        // - on-beat notes (integer beat) count
        // - longer notes (>= 1 beat) count
        const isIntegerBeat = (beat: number) => Math.abs(beat - Math.round(beat)) < 1e-6;
        const isStructuralBeat = (beat: number) => isStrongPulseBeat(beat);
        const structuralPitchClasses = (ev: ChordEvent): number[] => {
            try {
                const pcs: number[] = [];
                for (const [voiceNum, n] of ev.byVoice.entries()) {
                    if (!n || (n as any).isRest) continue;
                    if (!Number.isFinite((n as any).midi)) continue;
                    const b = (n.beat ?? ev.beat ?? 1) as number;
                    const dur = getDuration(n);
                    const structural = (voiceNum === 4) || isStructuralBeat(b) || dur >= 1.0;
                    if (!structural) continue;
                    pcs.push(mod12(n.midi));
                }
                return pcs;
            } catch {
                return [];
            }
        };
        const isNoteInStructuralHarmony = (note: StaffNote, ev: ChordEvent, unknownReturnsTrue = true): boolean => {
            const pcs = structuralPitchClasses(ev);
            if (!pcs.length) return unknownReturnsTrue; // sparse/unknown
            return pcs.includes(mod12(note.midi));
        };

        voices.forEach(v => {
            const line = notesByVoice[v] || [];
            for (let j = 1; j < line.length - 1; j++) {
                const prev = line[j - 1];
                const cur = line[j];
                const next = line[j + 1];
                if (!prev || !cur || !next) continue;
                // Skip ornament detection if user has a harmony override at this beat
                if (_isHarmOverrideBeat(cur)) continue;
                // If already classified as another ornament (neighbor/appoggiatura/etc.),
                // do not override with a generic passing-note label.
                if ((cur as any).isNeighbor || (cur as any).isAnticipation || (cur as any).isAppoggiatura || (cur as any).isEscape) continue;
                // If any of the triplet notes participate in a suspension, skip passing detection here
                if ((prev as any).isSuspension || (cur as any).isSuspension || (next as any).isSuspension) continue;

                const s1 = getIntervalSemitones(prev.midi, cur.midi);
                const s2 = getIntervalSemitones(cur.midi, next.midi);
                // stepwise motion (<= 2 semitones) and same direction
                const dir1 = Math.sign(cur.midi - prev.midi);
                const dir2 = Math.sign(next.midi - cur.midi);
                if (!(s1 <= 2 && s2 <= 2 && dir1 !== 0 && dir1 === dir2)) continue;

                const prevEv = findEventForNote(prev, v);
                const curEv = findEventForNote(cur, v);
                const nextEv = findEventForNote(next, v);
                if (!prevEv || !curEv || !nextEv) continue;

                // For passing notes (esp. with 8ths/16ths), the typical case is an off-beat note.
                // Use "not on an integer beat" as a robust proxy across meters.
                const noteBeat = (cur.beat ?? (curEv ? curEv.beat : 1)) as number;
                if (isStructuralBeat(noteBeat)) continue;

                // harmonic membership: prev and next consonant, cur dissonant
                const prevConsonant = isNoteInStructuralHarmony(prev, prevEv);
                const nextConsonant = isNoteInStructuralHarmony(next, nextEv);
                const curConsonant = isNoteInStructuralHarmony(cur, curEv);
                // Additionally consider whether the current note is part of the surrounding harmony
                // NOTE: if surrounding events are too sparse (no structural pcs), do NOT treat that as evidence
                // that the current note belongs to the surrounding harmony.
                const curInPrevOrNext = isNoteInStructuralHarmony(cur, prevEv, false) || isNoteInStructuralHarmony(cur, nextEv, false);

                // If the current note is a chord tone of the verticality at its own event,
                // do NOT allow the "short note" heuristic to classify it as passing.
                // This is critical for secondary dominants like D7 (V7/V): the altered 3rd (F#)
                // may be short and resolve by step, but it is still essential harmony.
                const curIsChordToneOfOwnEvent = (() => {
                    try {
                        const evNotes = (curEv?.notes || []) as StaffNote[];
                        const info = identifyChord(evNotes);
                        if (!info || !info.root || !info.intervals) return false;
                        const rootPc = pitchClassOf(info.root);
                        const curPc = pitchClassOf(cur);
                        const interval = mod12(curPc - rootPc);
                        return info.intervals.has(interval);
                    } catch {
                        return false;
                    }
                })();

                // Treat very short notes (e.g., eighths) as passing even if they incidentally form
                // a seventh with sustained voices (i.e., are present in the vertical pitch set).
                const durPrev = getDuration(prev);
                const durCur = getDuration(cur);
                const durNext = getDuration(next);
                const isShortNonHarmonic =
                    !curIsChordToneOfOwnEvent &&
                    durCur < Math.min(durPrev, durNext) &&
                    durCur <= 0.5;

                // (targeted debug logging removed)

                // Optional: verbose per-triplet logging (disabled by default)
                if (DEBUG_ANALYSIS) {
                    try {
                        const info = {
                            voice: v,
                            prev: { id: prev.id, pitch: prev.pitch, midi: prev.midi, beat: prev.beat, dur: getDuration(prev) },
                            cur: { id: cur.id, pitch: cur.pitch, midi: cur.midi, beat: cur.beat, dur: getDuration(cur) },
                            next: { id: next.id, pitch: next.pitch, midi: next.midi, beat: next.beat, dur: getDuration(next) },
                            prevConsonant, curConsonant, nextConsonant, isShortNonHarmonic,
                            prevEv: prevEv ? { absBeat: prevEv.absBeat, beat: prevEv.beat, measureIndex: prevEv.measureIndex, pcs: prevEv.notes.map(n=>mod12(n.midi)) } : null,
                            curEv: curEv ? { absBeat: curEv.absBeat, beat: curEv.beat, measureIndex: curEv.measureIndex, pcs: curEv.notes.map(n=>mod12(n.midi)) } : null,
                            nextEv: nextEv ? { absBeat: nextEv.absBeat, beat: nextEv.beat, measureIndex: nextEv.measureIndex, pcs: nextEv.notes.map(n=>mod12(n.midi)) } : null,
                            chordEventsLength: chordEvents.length
                        };
                        debugLog('[ANALYSIS] passing-eval-json', JSON.stringify(info));
                    } catch (err) {
                        console.warn('[ANALYSIS] passing-eval logging failed', err);
                    }
                }

                // Mark as passing only when the *current* note is non-harmonic (dissonant) in its
                // own harmony, and it is not part of the surrounding harmonies (or is a short
                // interpolating note).
                // This avoids false positives like I–V7–I with soprano C–D–E: D is a chord tone of V7.
                // Also skip if the note is a recognized chord tone of its own vertical event —
                // even when the structural-PCs heuristic (which excludes weak-beat upper voices)
                // reports it as non-consonant.  This prevents marking real chord tones (e.g. 5th
                // of a triad on an off-beat) as passing.
                if (curIsChordToneOfOwnEvent && !isShortNonHarmonic) continue;
                if (prevConsonant && nextConsonant && (((!curConsonant) && !curInPrevOrNext) || isShortNonHarmonic)) {
                    cur.isPassing = true;
                    (cur as any).ornamentMark = 'P';
                    // Passing-note classification should dominate over ornament heuristics.
                    // Clear any ornament flags and remove ORN-* panel entries that reference this note.
                    try {
                        const anyCur: any = cur as any;
                        if (anyCur.isNeighbor) anyCur.isNeighbor = false;
                        if (anyCur.isAnticipation) anyCur.isAnticipation = false;
                        if (anyCur.isAppoggiatura) anyCur.isAppoggiatura = false;
                        if (anyCur.isEscape) anyCur.isEscape = false;
                        if (anyCur.ornamentMark) delete anyCur.ornamentMark;

                        for (let vi = violations.length - 1; vi >= 0; vi--) {
                            const vv: any = violations[vi];
                            const rid = (vv?.ruleId || '') as string;
                            if (!(rid.startsWith('ORN-') || rid.startsWith('R-ORN-'))) continue;
                            const ids: string[] = Array.isArray(vv?.noteIds) ? vv.noteIds : [];
                            if (ids.includes(cur.id)) {
                                violations.splice(vi, 1);
                            }
                        }
                    } catch { /* ignore */ }
                    debugLog('[ANALYSIS] mark-passing', { id: cur.id, pitch: cur.pitch, midi: cur.midi, beat: cur.beat, measure: cur.measureIndex, curConsonant, curInPrevOrNext, isShortNonHarmonic });
                }
            }
        });
    }

    _pmark('06-passingNoteDetector');
    // -----------------------
    // Other non-harmonic tones (classical ornaments)
    // -----------------------
    function detectOrnaments(notesByVoice: Record<Voice, StaffNote[]>, chordEvents: ChordEvent[], beatsPerMeasure: number): void {
        const strongBeats = (beat: number) => {
            // Use meter-aware strong pulses.
            const b0 = (beat ?? 1) - 1;
            if (!Number.isFinite(b0 as any)) return false;
            const isCompound = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
            if (isCompound) {
                const pulse = 1.5;
                const r = ((b0 % pulse) + pulse) % pulse;
                return Math.abs(r) < 1e-6;
            }
            // Conservative: in 4/4 treat 1 and 3 as strong; otherwise only 1.
            if (Math.abs(beat - 1) < 1e-6) return true;
            if (Math.abs(beatsPerMeasure - 4) < 1e-6 && Math.abs(beat - 3) < 1e-6) return true;
            return false;
        };

        const findEventForNote = (note: StaffNote, voice: Voice) => {
            for (const ev of chordEvents) {
                try {
                    const vNote = ev.byVoice.get(voice);
                    if (vNote && vNote.id === note.id) return ev;
                    if (ev.notes && ev.notes.find(n => n.id === note.id)) return ev;
                    const evMeasure = ev.measureIndex ?? 0;
                    const evBeat = ev.beat ?? 1;
                    const noteMeasure = note.measureIndex ?? 0;
                    const noteBeat = note.beat ?? 1;
                    if (evMeasure === noteMeasure && Math.abs(evBeat - noteBeat) < 1e-6) return ev;
                } catch { /* ignore */ }
            }
            return undefined as ChordEvent | undefined;
        };

        // For some off-beat notes (e.g. beat=2.5), the scan-point `chordEvents` can be sparse
        // depending on how the timeline is quantized. When we need to know whether the *other*
        // voices are stable across prev/cur/next, compute that from note spans directly.
        const absBeatOf = (n: StaffNote) => ((n.measureIndex ?? 0) * beatsPerMeasure) + ((n.beat ?? 1) - 1);
        const noteSpan = (n: StaffNote) => {
            const s = absBeatOf(n);
            return { start: s, end: s + Math.max(getDuration(n), 1e-6) };
        };

        const otherVoicesSignatureAtAbsBeat = (absBeat: number, excludeVoice: Voice): string => {
            try {
                const pcs: number[] = [];
                for (const vv of [1, 2, 3, 4] as Voice[]) {
                    if (vv === excludeVoice) continue;
                    const line = notesByVoice[vv] || [];
                    const active = line.find(nn => {
                        if (!nn || (nn as any).isRest) return false;
                        if (!Number.isFinite((nn as any).midi)) return false;
                        const sp = noteSpan(nn);
                        return sp.start <= absBeat + 1e-6 && sp.end > absBeat + 1e-6;
                    });
                    if (!active) continue;
                    pcs.push(mod12(active.midi ?? 0));
                }
                const uniq = [...new Set(pcs)].sort((a, b) => a - b);
                return uniq.join('-');
            } catch {
                return '';
            }
        };

        const semis = (a: StaffNote, b: StaffNote) => Math.abs((a.midi ?? 0) - (b.midi ?? 0));
        const sgn = (a: StaffNote, b: StaffNote) => Math.sign((b.midi ?? 0) - (a.midi ?? 0));
        const isWeakBeat = (note: StaffNote, ev?: ChordEvent) => {
            const beat = note.beat ?? ev?.beat ?? 1;
            return !strongBeats(beat);
        };

        const otherVoicesPcSignature = (ev: ChordEvent, excludeVoice: Voice): string => {
            try {
                const pcs: number[] = [];
                if (ev.byVoice && typeof (ev.byVoice as any).entries === 'function') {
                    for (const [voiceNum, n] of ev.byVoice.entries()) {
                        if ((voiceNum as any) === excludeVoice) continue;
                        if (!n || (n as any).isRest) continue;
                        if (!Number.isFinite((n as any).midi)) continue;
                        pcs.push(mod12(n.midi ?? 0));
                    }
                } else if (ev.notes) {
                    for (const n of ev.notes) {
                        const vn = (n.voice ?? 1) as Voice;
                        if (vn === excludeVoice) continue;
                        if (!n || (n as any).isRest) continue;
                        if (!Number.isFinite((n as any).midi)) continue;
                        pcs.push(mod12(n.midi ?? 0));
                    }
                }
                const uniq = [...new Set(pcs)].sort((a, b) => a - b);
                return uniq.join('-');
            } catch {
                return '';
            }
        };

        // IMPORTANT: `isNoteInChord` (membership in the event's full vertical pitch-class set)
        // includes the candidate note itself, so it cannot tell us whether the candidate is
        // dissonant (a non-chord tone) vs chordal.
        //
        // For ornaments, infer the harmony from the event *excluding the candidate note*, and
        // then check whether the candidate pitch-class is a chord tone of any plausible chord
        // interpretation of that remaining sonority.
        //
        // This avoids false appoggiature in sparse textures (e.g., F# in D7) that were causing
        // secondary dominants (V7/V) to collapse into C-based sus/add readings after adding the
        // resolving note on the next beat.
        const otherNotesAtEvent = (ev: ChordEvent, excludeId?: string) => {
            try {
                const out: StaffNote[] = [];
                if (ev.byVoice && typeof (ev.byVoice as any).entries === 'function') {
                    for (const [, n] of ev.byVoice.entries()) {
                        if (!n || (n as any).isRest) continue;
                        if (excludeId && n.id === excludeId) continue;
                        out.push(n);
                    }
                }
                if (!out.length && ev.notes) {
                    for (const n of ev.notes) {
                        if (!n || (n as any).isRest) continue;
                        if (excludeId && n.id === excludeId) continue;
                        out.push(n);
                    }
                }
                return out;
            } catch {
                return [] as StaffNote[];
            }
        };

        const chordTonePcs = (rootPc: number, chordType: string): Set<number> => {
            try {
                const formula = (CHORD_FORMULAS as any)?.[chordType] as number[] | undefined;
                if (!formula || !Array.isArray(formula) || !formula.length) {
                    return new Set<number>([mod12(rootPc)]);
                }
                return new Set<number>(formula.map(i => mod12(rootPc + i)));
            } catch {
                return new Set<number>([mod12(rootPc)]);
            }
        };

        const isConsonantToHarmony = (note: StaffNote, ev: ChordEvent, _voice: Voice) => {
            try {
                const notePc = pitchClassOf(note);

                // If the *full* sonority at this event is a confident, non-sus chord and this note
                // is a chord member (including chordal 7ths), treat it as consonant.
                // This avoids misclassifying essential tones (e.g. the 7th of V7) as appoggiature
                // just because the other voices happen to form a triad shell.
                // Filter out notes already tagged as ornamental — they can pollute the chord ID
                // and cause real chord tones to look dissonant (e.g. appoggiatura G on a Dm event
                // makes identifyChord see G-D-F → "G7" instead of D-F-A → "Dm").
                const _isOrn = (n: any) => !!(n?.isPassing || n?.isNeighbor || n?.isAnticipation || n?.isAppoggiatura || n?.isEscape || (n?.ornamentOverride && n?.ornamentOverride !== 'structural'));
                try {
                    const fullAtEvent = (otherNotesAtEvent(ev) || []).filter(n => !_isOrn(n));
                    const uniqueFullPcs = [...new Set((fullAtEvent || [])
                        .filter(n => n && !(n as any).isRest)
                        .filter(n => Number.isFinite((n as any).midi))
                        .map(n => mod12(pitchClassOf(n)))
                    )];

                    const chordInfoFull = identifyChord(fullAtEvent);
                    if (chordInfoFull && chordInfoFull.root && chordInfoFull.type && !String(chordInfoFull.type).includes('Sus')) {
                        const formulaFull = (CHORD_FORMULAS as any)?.[chordInfoFull.type] as number[] | undefined;
                        const rootPcFull = mod12((chordInfoFull.root as any).noteIndex ?? mod12((chordInfoFull.root as any).midi ?? 0));
                        const intervalFromRootFull = mod12(mod12(notePc) - rootPcFull);
                        const confident = uniqueFullPcs.length >= 3;
                        if (confident && formulaFull && Array.isArray(formulaFull) && formulaFull.includes(intervalFromRootFull)) {
                            return true;
                        }
                    }
                } catch { /* ignore */ }

                const others = (otherNotesAtEvent(ev, note.id) || []).filter(n => !_isOrn(n));

                const uniqueOtherPcs = [...new Set((others || []).map(n => pitchClassOf(n)))];

                // Dyads and single tones can be ambiguous. However, some dyads are stable chord shells
                // (5th, 3rd, 6th, 4th) where a chromatic pitch should still count as dissonant.
                // We keep the previous "ambiguous dyad => consonant" behavior only for *unstable*
                // dyads (e.g. M2) to prevent the V7/V regression (D7 shell collapsing to Csus2/D).
                if (uniqueOtherPcs.length < 3) {
                    if (uniqueOtherPcs.length < 2) return true;

                    // Compute a concrete dyad interval from MIDI (more reliable than PC-only).
                    const otherMidis = (others || [])
                        .filter(n => n && !n.isRest && Number.isFinite((n as any).midi))
                        .map(n => (n.midi ?? 0));
                    const minMidi = otherMidis.length ? Math.min(...otherMidis) : null;
                    const maxMidi = otherMidis.length ? Math.max(...otherMidis) : null;
                    const dyadInt = (minMidi != null && maxMidi != null)
                        ? mod12(maxMidi - minMidi)
                        : mod12(uniqueOtherPcs[1] - uniqueOtherPcs[0]);

                    // Stable shells (treat as meaningful harmony frame).
                    const isStableShell = dyadInt === 0 || dyadInt === 3 || dyadInt === 4 || dyadInt === 5 || dyadInt === 7 || dyadInt === 8 || dyadInt === 9;
                    if (!isStableShell) {
                        // Unstable/ambiguous dyad: default to consonant/unknown.
                        return true;
                    }

                    const nPc = mod12(notePc);
                    const otherSet = new Set<number>(uniqueOtherPcs.map(p => mod12(p)));
                    if (otherSet.has(nPc)) return true;

                    // If the note completes a standard triad with the dyad, treat it as consonant.
                    const triadFits = (() => {
                        const pcs = [...otherSet, nPc];
                        if (pcs.length < 3) return false;
                        const triads = [
                            new Set([0, 3, 7]), // minor
                            new Set([0, 4, 7]), // major
                            new Set([0, 3, 6]), // dim
                            new Set([0, 4, 8]), // aug
                        ];
                        for (const root of pcs) {
                            const rel = new Set(pcs.map(p => mod12(p - root)));
                            for (const t of triads) {
                                if (rel.size === t.size && [...t].every(x => rel.has(x))) return true;
                            }
                        }
                        return false;
                    })();

                    return triadFits;
                }

                const cands = identifyChordCandidates(others).filter(c => Boolean((c as any).matchType));
                if (!cands.length) return true;

                // Check a handful of top candidates; if any plausible chord includes the note,
                // treat it as consonant (chord tone) for ornament purposes.
                for (const cand of cands.slice(0, 8)) {
                    const rootPc = (cand.root as any)?.noteIndex;
                    if (!Number.isFinite(rootPc)) continue;
                    const tones = chordTonePcs(mod12(rootPc), cand.type);
                    if (tones.has(mod12(notePc))) return true;
                }

                return false;
            } catch {
                // Sparse/unknown fallback: treat as consonant/unknown.
                return true;
            }
        };

        const addOrnament = (
            ruleId: string,
            severity: 'warning' | 'exception',
            description: string,
            suggestion: string,
            prev: StaffNote,
            cur: StaffNote,
            next: StaffNote
        ) => {
            if (!prev?.id || !cur?.id || !next?.id) return;
            // Panel noise reduction: recognized anticipations are common and can spam the analysis panel.
            // Keep the visual marker on the staff (via `isAnticipation`/`ornamentMark`) but do not add a panel entry.
            if (ruleId === 'ORN-ANT' && severity === 'exception') return;
            // Appoggiature: per UX non servono nel pannello; l'importante è che siano trattate
            // come note estranee così non falsano la numerazione/identificazione degli accordi.
            if (ruleId === 'ORN-APP' || ruleId === 'R-ORN-APP') return;
            addViolation({
                ruleId,
                severity,
                description,
                suggestion,
                noteIds: [prev.id, cur.id, next.id],
            });
        };

        // Ornaments are primarily a melodic phenomenon in the upper voices.
        // Applying these heuristics to the bass often yields false positives in
        // incomplete voicings (e.g., the bass root not duplicated in upper voices).
        const voices: Voice[] = [1, 2, 3];
        voices.forEach(v => {
            const line = notesByVoice[v] || [];
            for (let j = 0; j < line.length - 1; j++) {
                const prev = j > 0 ? line[j - 1] : null;
                const cur = line[j];
                const next = line[j + 1];
                if (!cur || !next) continue;
                if ((cur as any).isSuspension || (next as any).isSuspension) continue;
                if (prev && (prev as any).isSuspension) continue;

                const curEv = findEventForNote(cur, v);
                const nextEv = findEventForNote(next, v);
                if (!curEv) continue;

                const prevEv = prev ? findEventForNote(prev, v) : null;

                const prevCon = (prev && prevEv) ? isConsonantToHarmony(prev, prevEv, v) : true;
                const curCon = isConsonantToHarmony(cur, curEv, v);
                // If `nextEv` is missing (sparse scanpoints), treat it as consonant-by-default.
                // For neighbor detection we additionally require returnsSame + stable other voices.
                const nextCon = nextEv ? isConsonantToHarmony(next, nextEv, v) : true;

                const isRootOfAnyConfidentCandidate = (note: StaffNote, ev: ChordEvent | null): boolean => {
                    try {
                        if (!note || !ev || !ev.notes) return false;
                        const notesHere = (ev.notes || []).filter(n => n && !n.isRest) as any[];
                        if (notesHere.length < 3) return false;
                        const cands = identifyChordCandidates(notesHere as any) as any[];
                        if (!cands || cands.length === 0) return false;

                        const notePc = mod12((note as any)?.noteIndex ?? mod12((note as any)?.midi ?? 0));

                        for (const cand of cands) {
                            const matchType = String((cand as any)?.matchType || '');
                            const chordType = String((cand as any)?.type || '');
                            const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                            const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                            if (!confident || isSusLike) continue;
                            if (!cand?.root || !cand?.type) continue;

                            const rootPc = mod12((cand.root as any)?.noteIndex ?? mod12((cand.root as any)?.midi ?? 0));
                            // Only treat as "definitely structural" when the note is a plausible root.
                            if (notePc === rootPc) return true;
                        }
                        return false;
                    } catch {
                        return false;
                    }
                };

                const isChordToneOfConfidentCandidate = (note: StaffNote, ev: ChordEvent | null): boolean => {
                    try {
                        if (!note || !ev || !ev.notes) return false;
                        const notesHere = (ev.notes || []).filter(n => n && !n.isRest) as any[];
                        if (notesHere.length < 3) return false;
                        const cands = identifyChordCandidates(notesHere as any);
                        const best = (cands && cands.length) ? (cands as any[])[0] : null;
                        const matchType = (best as any)?.matchType;
                        const chordType = String(best?.type || '');
                        const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                        const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                        if (!confident || isSusLike || !best?.root || !best?.type) return false;

                        const rootPc = mod12((best.root as any)?.noteIndex ?? mod12((best.root as any)?.midi ?? 0));
                        const notePc = mod12((note as any)?.noteIndex ?? mod12((note as any)?.midi ?? 0));
                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                        if (!Array.isArray(formula) || !formula.length) return false;
                        const rel = mod12(notePc - rootPc);
                        return rel === 0 || formula.includes(rel);
                    } catch {
                        return false;
                    }
                };

                const isChordToneOfConfidentCandidateExcludingSelf = (note: StaffNote, ev: ChordEvent | null): boolean => {
                    try {
                        if (!note || !ev || !ev.notes) return false;
                        const notesHere = (ev.notes || []).filter(n => n && !n.isRest && n.id !== note.id) as any[];
                        if (notesHere.length < 3) return false;
                        const cands = identifyChordCandidates(notesHere as any);
                        const best = (cands && (cands as any[]).length) ? (cands as any[])[0] : null;
                        const matchType = (best as any)?.matchType;
                        const chordType = String(best?.type || '');
                        const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                        const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                        if (!confident || isSusLike || !best?.root || !best?.type) return false;

                        const rootPc = mod12((best.root as any)?.noteIndex ?? mod12((best.root as any)?.midi ?? 0));
                        const notePc = mod12((note as any)?.noteIndex ?? mod12((note as any)?.midi ?? 0));
                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                        if (!Array.isArray(formula) || !formula.length) return false;
                        const rel = mod12(notePc - rootPc);
                        return rel === 0 || formula.includes(rel);
                    } catch {
                        return false;
                    }
                };

                const hasConfidentHarmonyCandidate = (ev: ChordEvent | null): boolean => {
                    try {
                        if (!ev || !ev.notes) return false;
                        // Exclude suspensions/ornaments to avoid confusing chord-ID.
                        const notesHere = (ev.notes || [])
                            .filter(n => n && !n.isRest)
                            .filter(n => !(n as any).isSuspension && !(n as any).isPassing && !(n as any).isNeighbor && !(n as any).isAnticipation && !(n as any).isAppoggiatura && !(n as any).isEscape) as any[];
                        if (notesHere.length < 3) return false;
                        const cands = identifyChordCandidates(notesHere as any);
                        const best = (cands && (cands as any[]).length) ? (cands as any[])[0] : null;
                        const matchType = (best as any)?.matchType;
                        const chordType = String(best?.type || '');
                        const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                        const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                        return Boolean(confident && !isSusLike && best?.root && best?.type);
                    } catch {
                        return false;
                    }
                };

                // Neighbor tone: consonant -> dissonant step -> consonant, returning to same pitch.
                if (prev && prevEv && prevCon && nextCon) {
                    const returnsSame = (prev.midi ?? 0) === (next.midi ?? 0);
                    const stepIn = semis(prev, cur) <= 2 && semis(cur, next) <= 2;
                    const oppositeDir = sgn(prev, cur) !== 0 && sgn(prev, cur) === -sgn(cur, next);
                    // Require the ornament itself to be short; otherwise long chord tones (often unique
                    // in sparse textures) can be misread as neighbors.
                    const shortNeighbor = getDuration(cur) <= 0.5;

                    // In some suspension contexts a short return-to-same note can be a melodic neighbor
                    // even if it is technically consonant in the instantaneous verticality.
                    // Only allow that override when the *other voices* are stable across prev/cur/next.
                    const stableOtherVoices = (() => {
                        try {
                            const aPrev = absBeatOf(prev);
                            const aCur = absBeatOf(cur);
                            const aNext = absBeatOf(next);
                            const sPrev = otherVoicesSignatureAtAbsBeat(aPrev, v);
                            const sCur = otherVoicesSignatureAtAbsBeat(aCur, v);
                            const sNext = otherVoicesSignatureAtAbsBeat(aNext, v);
                            if (!sPrev || !sCur || !sNext) return false;
                            return sPrev === sCur && sCur === sNext;
                        } catch {
                            return false;
                        }
                    })();

                    // Consonant-neighbor override is only safe when the note is NOT clearly a chord tone
                    // of a confident harmonic candidate at this event. Otherwise we can end up tagging
                    // real harmonic tones (e.g. delayed 3rds in dominants) as ornaments, distorting Roman.
                    const allowConsonantNeighbor =
                        shortNeighbor &&
                        isWeakBeat(cur, curEv) &&
                        stableOtherVoices &&
                        !isChordToneOfConfidentCandidate(cur, curEv);
                    const treatAsNeighbor = (!curCon) || allowConsonantNeighbor;

                    if (treatAsNeighbor && returnsSame && stepIn && oppositeDir && shortNeighbor) {
                        (cur as any).isNeighbor = true;
                        // Compact visual marker handled by renderer overlay (no dashed connections).
                        (cur as any).ornamentMark = 'v';
                        if (isWeakBeat(cur, curEv)) {
                            addOrnament(
                                'ORN-NEIGH',
                                'exception',
                                'Nota di volta (neighbor) riconosciuta',
                                'Marker informativo: dissonanza su tempo debole, per grado congiunto, ritorno alla nota di partenza.',
                                prev,
                                cur,
                                next
                            );
                        } else {
                            addOrnament(
                                'R-ORN-NEIGH',
                                'warning',
                                'Nota di volta “accentata”/sospetta',
                                'La nota di volta classica è tipicamente su tempo debole; valuta se è appoggiatura/altro ornamento.',
                                prev,
                                cur,
                                next
                            );
                        }
                        continue;
                    }
                }

                // Anticipation: a short note before the change that matches the next harmony.
                // Heuristic: weak beat, not consonant now, but consonant in the *next* event,
                // and the next note in the voice repeats the same pitch.
                if (prev && prevEv && !curCon) {
                    if (!nextEv) continue;
                    const repeats = (next.midi ?? 0) === (cur.midi ?? 0);
                    const short = getDuration(cur) <= 0.5;

                    const isChordToneInEvent = (note: StaffNote, ev: ChordEvent, excludeNoteId?: string): boolean => {
                        try {
                            const pool = (ev.notes || []).filter(n => n && !n.isRest && (!excludeNoteId || n.id !== excludeNoteId));
                            const info = identifyChord(pool);
                            if (!info?.root || !info?.intervals) return false;
                            const rootPc = mod12(info.root.noteIndex);
                            const notePc = mod12(note.noteIndex);
                            if (notePc === rootPc) return true;
                            const rel = mod12(notePc - rootPc);
                            return info.intervals.has(rel);
                        } catch {
                            return false;
                        }
                    };

                    // Current harmony: exclude the candidate note to avoid tautological "it's in the chord"
                    // when the chord-ID is influenced by the note we're trying to classify.
                    const curInNow = isChordToneInEvent(cur, curEv, cur.id) || isConsonantToHarmony(cur, curEv, v);
                    // Next harmony: chord-tone membership may be unique (not doubled), so allow full-event chord-ID.
                    const curInNext = isChordToneInEvent(cur, nextEv) || isConsonantToHarmony(cur, nextEv, v);

                    if (repeats && short && isWeakBeat(cur, curEv) && curInNext && !curInNow) {
                        (cur as any).isAnticipation = true;
                        // Compact marker for anticipations (reserve 'v' for note di volta).
                        (cur as any).ornamentMark = 'ant';
                        if (short) {
                            addOrnament(
                                'ORN-ANT',
                                'exception',
                                'Anticipazione riconosciuta',
                                'Marker informativo: nota breve su tempo debole che appartiene all’accordo successivo e viene ripetuta al cambio.',
                                prev,
                                cur,
                                next
                            );
                        } else {
                            addOrnament(
                                'R-ORN-ANT',
                                'warning',
                                'Anticipazione “lunga” o su tempo forte',
                                'Di norma l’anticipazione è breve e su tempo debole; valuta se è nota accordale anticipata per scelta di ritmo armonico.',
                                prev,
                                cur,
                                next
                            );
                        }
                        continue;
                    }
                }

                // Appoggiatura: accented dissonance approached by leap, resolved by step.
                // Heuristic (Piston-aligned, conservative):
                // - strong beat
                // - cur dissonant, next consonant
                // - cur resolves by step
                // - approach can be by leap, step, or prepared (same pitch)
                const isDissonantAgainstBass = (note: StaffNote, ev: ChordEvent): boolean => {
                    try {
                        if (!note || note.isRest) return false;
                        const pool = (ev?.notes || []).filter(nn => nn && !nn.isRest && Number.isFinite(nn.midi));
                        if (!pool.length) return false;
                        const bass = pool.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                        if (!bass || bass.id === note.id) return false;
                        const interval = mod12((note.midi ?? 0) - (bass.midi ?? 0));
                        // Treat 2nds, 4ths, tritone, 7ths as dissonant vs bass.
                        return interval === 1 || interval === 2 || interval === 5 || interval === 6 || interval === 10 || interval === 11;
                    } catch {
                        return false;
                    }
                };

                const strongBeat = strongBeats(cur.beat ?? curEv.beat ?? 1);
                const curDissBass = isDissonantAgainstBass(cur, curEv);
                const nextDissBass = isDissonantAgainstBass(next, nextEv);
                const passesDissonanceTest = (!curCon && nextCon) || (curDissBass && !nextDissBass);

                // Secondary path: last beat of the measure (e.g. beat 4 in 4/4)
                // but not metrically "strong". Appoggiaturas on the last beat
                // resolving within the same beat are common in tonal music.
                // Very strict evidence required to avoid false positives:
                //   a) it IS the last integer beat of the bar
                //   b) dissonant vs bass now, consonant vs bass next
                //   c) strictly shorter than ALL other voices at this event
                //   d) resolution note forms a TRIAD consonance (P1/m3/M3/P5)
                //      with the bass
                const curBeatVal = cur.beat ?? curEv.beat ?? 1;
                const isLastBeat = Math.abs(curBeatVal - beatsPerMeasure) < 1e-6;
                let weakBeatAppogg = false;
                if (!strongBeat && isLastBeat && curDissBass && !nextDissBass && next) {
                    const _durCur = DURATION_VALUES[cur.duration as keyof typeof DURATION_VALUES] ?? 1;
                    const _otherDurs = (curEv?.notes || [])
                        .filter((n: any) => n && !n.isRest && n.id !== cur.id && Number.isFinite(n.midi))
                        .map((n: any) => DURATION_VALUES[n.duration as keyof typeof DURATION_VALUES] ?? 1);
                    const _minOther = _otherDurs.length ? Math.min(..._otherDurs) : _durCur;
                    if (_durCur < _minOther - 1e-6) {
                        const _bassPool = (curEv?.notes || []).filter(
                            (nn: any) => nn && !nn.isRest && Number.isFinite(nn.midi) && nn.id !== cur.id);
                        const _bass = _bassPool.length
                            ? _bassPool.reduce((lo: any, nn: any) => (nn.midi < lo.midi ? nn : lo), _bassPool[0])
                            : null;
                        if (_bass) {
                            const _resIntv = ((((next.midi ?? 0) - (_bass.midi ?? 0)) % 12) + 12) % 12;
                            // 3=m3, 4=M3, 7=P5: triad consonances above
                            // bass. Exclude P1 (0) — landing on the same
                            // pitch-class as the bass is ambiguous: it may
                            // just be a doubling, not evidence of a better
                            // chord.
                            if (_resIntv === 3 || _resIntv === 4 || _resIntv === 7) {
                                weakBeatAppogg = true;
                            }
                        }
                    }
                }

                if (passesDissonanceTest && (strongBeat || weakBeatAppogg)) {
                    // Guardrail: if the note is a chord tone of a confident harmonic candidate at this event
                    // AND it has a duration at least as long as the other chord members,
                    // do NOT treat it as appoggiatura. Otherwise we can filter
                    // out real chord tones and distort Roman/figured bass labels.
                    // However, if the chord tone is significantly shorter than the others,
                    // it may still be ornamental (e.g. passing through a chord tone).
                    const chordToneAny = isChordToneOfConfidentCandidate(cur, curEv);
                    const curDurBeats = DURATION_VALUES[cur.duration as keyof typeof DURATION_VALUES] ?? 1;
                    const otherDurs = (curEv?.notes || [])
                        .filter((n: any) => n && !n.isRest && n.id !== cur.id && Number.isFinite(n.midi))
                        .map((n: any) => DURATION_VALUES[n.duration as keyof typeof DURATION_VALUES] ?? 1);
                    const minOtherDur = otherDurs.length ? Math.min(...otherDurs) : curDurBeats;
                    const isSameDuration = curDurBeats >= minOtherDur - 1e-6;
                    if (chordToneAny && isSameDuration) {
                        // Chord tone with same duration as peers → definitely structural, not appoggiatura.
                    } else {
                    const inSemis = prev ? semis(prev, cur) : Infinity;
                    const leapIn = prev ? (inSemis > 2) : false;
                    const stepIn = prev ? (inSemis > 0 && inSemis <= 2) : false;
                    const prepared = prev ? (inSemis === 0) : false;
                    const unknownIn = !prev;

                    const outSemis = semis(cur, next);
                    const stepOut = outSemis > 0 && outSemis <= 2;

                    // Guard: stepwise passing 7th — when a note enters AND exits
                    // by step (classic passing-tone profile) and it forms a 7th
                    // (major or minor) above the bass, treat it as a passing
                    // tone, not appoggiatura.  Lightweight check: use bass midi
                    // directly instead of calling identifyChordCandidates
                    // (which is too expensive inside the per-note ornament loop).
                    let _passing7th = false;
                    if (stepIn && stepOut) {
                        const _otherNotes = (curEv?.notes || []).filter(
                            (nn: any) => nn && !nn.isRest && nn.id !== cur.id && Number.isFinite(nn.midi));
                        if (_otherNotes.length >= 2) {
                            // Use lowest note as proxy for root
                            const bass = _otherNotes.reduce((lo: any, nn: any) =>
                                (nn.midi < lo.midi ? nn : lo), _otherNotes[0]);
                            const _interval = ((((cur.midi ?? 0) - bass.midi) % 12) + 12) % 12;
                            // 10 = minor 7th, 11 = major 7th
                            if (_interval === 10 || _interval === 11) {
                                _passing7th = true;
                                (cur as any).isPassing = true;
                                (cur as any).ornamentMark = 'P';
                            }
                        }
                    }

                    if (!_passing7th && (unknownIn || leapIn || stepIn || prepared) && stepOut) {
                        (cur as any).isAppoggiatura = true;
                        // Store resolution note info so downstream chord-ID can
                        // substitute the ornament with its resolution pitch.
                        if (next && Number.isFinite(next.midi)) {
                            (cur as any)._appoggResolution = {
                                midi: next.midi, pitch: (next as any).pitch,
                                octave: (next as any).octave, voice: (cur as any).voice,
                            };
                        }
                        const oppositeDir = prev ? (sgn(prev, cur) !== 0 && sgn(prev, cur) === -sgn(cur, next)) : true;

                        // Only apply the stricter “opposite direction” expectation when the approach is by leap.
                        // For prepared/step-in appoggiature, keep it informational (we still want them filtered out
                        // from chord-ID/figures regardless).
                        if (unknownIn || !leapIn || oppositeDir) {
                            addOrnament(
                                'ORN-APP',
                                'exception',
                                'Appoggiatura riconosciuta',
                                'Dissonanza accentata (tempo forte) che risolve per grado; può essere preparata, per grado o per salto.',
                                (prev as any) ?? cur,
                                cur,
                                next
                            );
                        } else {
                            addOrnament(
                                'R-ORN-APP',
                                'warning',
                                'Appoggiatura sospetta (direzione risoluzione atipica)',
                                'Quando l’appoggiatura entra per salto, spesso risolve per grado in direzione opposta; verifica la condotta.',
                                (prev as any) ?? cur,
                                cur,
                                next
                            );
                        }
                        continue;
                    }
                    }
                }

                // Escape tone (cambiata): step into a dissonance, leap out in opposite direction.
                // Also catches "consonant 9ths/extensions" that melodically behave as escape tones:
                // a short weak-beat note that is step-in + leap-out-opposite is an escape
                // even if the chord identifier labels the full vertical as an add9/add11.
                const curConForEscape = (() => {
                    if (!curCon) return false; // already dissonant → standard path
                    // curCon is true but the note might be an extension (9th/11th/13th)
                    // treated as consonant by identifyChord. Check if it's a triad tone.
                    try {
                        const others = (otherNotesAtEvent(curEv, cur.id) || []).filter((n: any) =>
                            n && !n.isRest && !(n as any).isPassing && !(n as any).isNeighbor &&
                            !(n as any).isAppoggiatura && !(n as any).isAnticipation && !(n as any).isEscape);
                        const chordInfo = identifyChord(others as any);
                        if (chordInfo && chordInfo.root) {
                            const rootPc = mod12((chordInfo.root as any).noteIndex ?? mod12((chordInfo.root as any).midi ?? 0));
                            const intv = mod12(mod12(pitchClassOf(cur)) - rootPc);
                            // Triad tones: unison(0), m3(3), M3(4), P5(7), m6/aug5(8)
                            if (intv === 0 || intv === 3 || intv === 4 || intv === 7 || intv === 8) return true;
                            // It's an extension (2/9, 4/11, 6/13) — NOT a core triad tone
                            return false;
                        }
                    } catch { /* ignore */ }
                    return true;
                })();
                if (prev && prevEv && (!curCon || !curConForEscape) && prevCon && nextCon && isWeakBeat(cur, curEv)) {
                    // Guardrail: if the note is actually a chord tone of a confident harmony candidate
                    // (even when excluding itself from chord-ID), do not classify it as an escape.
                    const _ctGuard = isChordToneOfConfidentCandidateExcludingSelf(cur, curEv);
                    if (_ctGuard) {
                        continue;
                    }
                    // A true escape tone is typically a short-value melodic ornament.
                    // Avoid classifying long notes (e.g., minime) as "sfuggite".
                    const shortEscape = getDuration(cur) <= 0.5;
                    if (!shortEscape) continue;
                    const stepIn = semis(prev, cur) > 0 && semis(prev, cur) <= 2;
                    const leapOut = semis(cur, next) > 2;
                    const oppositeDir = sgn(prev, cur) !== 0 && sgn(prev, cur) === -sgn(cur, next);
                    if (stepIn && leapOut && oppositeDir) {
                        (cur as any).isEscape = true;
                        (cur as any).ornamentMark = 's';
                        addOrnament(
                            'ORN-ESC',
                            'exception',
                            'Nota di sfuggita (escape) riconosciuta',
                            'Marker informativo: ingresso per grado congiunto su tempo debole e uscita per salto in direzione opposta.',
                            prev,
                            cur,
                            next
                        );
                        continue;
                    }
                }

                // Escape-like on strong beat: flag as suspicious (often reads as accented dissonance).
                if (prev && prevEv && (!curCon || !curConForEscape) && prevCon && nextCon && !isWeakBeat(cur, curEv)) {
                    // Guardrail: avoid false positives when the downbeat note is a real chord tone.
                    if (isChordToneOfConfidentCandidateExcludingSelf(cur, curEv)) {
                        continue;
                    }
                    // Even when flagged on a strong beat, a "sfuggita"-like figure should be short.
                    const shortEscape = getDuration(cur) <= 0.5;
                    if (!shortEscape) continue;
                    const stepIn = semis(prev, cur) > 0 && semis(prev, cur) <= 2;
                    const leapOut = semis(cur, next) > 2;
                    const oppositeDir = sgn(prev, cur) !== 0 && sgn(prev, cur) === -sgn(cur, next);
                    if (stepIn && leapOut && oppositeDir) {
                        (cur as any).isEscape = true;
                        (cur as any).ornamentMark = 's';
                        const tick = Number((cur as any).startTick);
                        const inSeq = isTickInsideImitatedSequence(Number.isFinite(tick) ? tick : null);
                        const harmonyUnclear = !hasConfidentHarmonyCandidate(curEv);
                        const attenuate = inSeq || harmonyUnclear;
                        addOrnament(
                            'R-ORN-ESC',
                            attenuate ? 'exception' : 'warning',
                            inSeq
                                ? 'Nota di sfuggita su tempo forte (licenza in progressione imitata)'
                                : (harmonyUnclear
                                    ? 'Nota di sfuggita su tempo forte (contesto armonico incerto)'
                                    : 'Nota di sfuggita su tempo forte (sospetta)'),
                            inSeq
                                ? 'In progressioni imitative/sequenze, alcune licenze melodiche sono tollerate per preservare la simmetria del disegno. Verifica comunque la resa sonora e il contesto armonico.'
                                : (harmonyUnclear
                                    ? 'Marker informativo: in un contesto armonico poco “stabile” o difficile da identificare, questa figura può essere percepita come scelta melodica/armonico-ritmica. Verifica la resa sonora.'
                                    : 'La sfuggita è tipicamente su tempo debole; su tempo forte può comportarsi come appoggiatura/altro accento dissonante.'),
                            prev,
                            cur,
                            next
                        );
                        continue;
                    }
                }
            }
        });

        // Bass-only (very conservative): detect short interpolations in the bass line that should
        // not drive harmony labels (e.g., "nota di volta" / passing bass with elisione).
        // Criteria:
        // - upper voices (1-3) pitch-class set stays stable across prev/cur/next events
        // - bass middle note is short and on a weak beat
        // - bass moves stepwise into the middle note and then either stepwise (passing) or leaps
        //   out in opposite direction (escape-like)
        try {
            const upperSig = (ev: ChordEvent | null): string => {
                try {
                    if (!ev) return '';
                    const ups = otherNotesAtEvent(ev).filter(n => (n.voice ?? 1) !== 4);
                    const pcs = [...new Set((ups || [])
                        .filter(n => n && !(n as any).isRest)
                        .filter(n => Number.isFinite((n as any).midi))
                        .map(n => mod12(pitchClassOf(n)))
                    )].sort((a, b) => a - b);
                    return pcs.join('-');
                } catch {
                    return '';
                }
            };

            const v: Voice = 4;
            const line = notesByVoice[v] || [];
            for (let j = 1; j < line.length - 1; j++) {
                const prev = line[j - 1];
                const cur = line[j];
                const next = line[j + 1];
                if (!prev || !cur || !next) continue;
                if ((cur as any).isSuspension || (next as any).isSuspension) continue;
                if ((cur as any).isPassing || (cur as any).isNeighbor || (cur as any).isEscape || (cur as any).isAnticipation || (cur as any).isAppoggiatura) continue;

                // Choose a previous "anchor" bass note that is not itself ornamental.
                // This avoids using an already-marked passing/neighbor note as the harmonic reference,
                // which can cause the return-to-chord-tone to be mislabeled as passing.
                let anchorPrev: any = prev as any;
                for (let k = j - 1; k >= 0; k--) {
                    const cand: any = line[k] as any;
                    if (!cand || cand.isRest) continue;
                    if (cand.isPassing || cand.isNeighbor || cand.isEscape || cand.isAnticipation || cand.isAppoggiatura) continue;
                    anchorPrev = cand;
                    break;
                }

                const prevEv = findEventForNote(anchorPrev, v);
                const curEv = findEventForNote(cur, v);
                const nextEv = findEventForNote(next, v);
                if (!prevEv || !curEv || !nextEv) continue;

                // Only apply this heuristic when the *upper voices* are stable from the anchor
                // event to the current event (i.e., bass motion under a held chord).
                const sPrev = upperSig(prevEv);
                const sCur = upperSig(curEv);
                if (!sPrev || !sCur) continue;
                if (sPrev !== sCur) continue;

                const short = getDuration(cur) <= 1.01;
                if (!short) continue;
                if (!isWeakBeat(cur, curEv)) continue;

                const inSemis = semis(prev, cur);
                const outSemis = semis(cur, next);
                const stepIn = inSemis > 0 && inSemis <= 2;
                if (!stepIn) continue;

                const oppositeDir = sgn(prev, cur) !== 0 && sgn(prev, cur) === -sgn(cur, next);
                const stepOut = outSemis > 0 && outSemis <= 2;
                const leapOut = outSemis > 2;

                // Harmonic membership test against the anchored harmony (prevEv).
                // If we can't identify a confident chord, stay conservative and do not tag.
                const isChordToneAgainstAnchor = (() => {
                    try {
                        const chordNotes = (prevEv.notes || []).filter((n: any) => n && !n.isRest);
                        if (chordNotes.length < 3) return true;
                        const cands = identifyChordCandidates(chordNotes as any);
                        const best: any = (cands && cands.length) ? cands[0] : null;
                        const matchType = String(best?.matchType || '');
                        const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                        if (!confident || !best?.root || !best?.type) return true;

                        const rootPc = Number.isFinite((best.root as any).noteIndex)
                            ? mod12((best.root as any).noteIndex)
                            : mod12((best.root as any).midi ?? 0);
                        const notePc = mod12((cur as any).noteIndex ?? mod12((cur as any).midi ?? 0));
                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                        if (!Array.isArray(formula) || !formula.length) return true;
                        const rel = mod12(notePc - rootPc);
                        return rel === 0 || formula.includes(rel);
                    } catch {
                        return true;
                    }
                })();

                if (stepOut) {
                    // Opposite-direction stepwise motion under a held upper chord -> neighbor (nota di volta)
                    if (oppositeDir) {
                        if (!isChordToneAgainstAnchor) {
                            (cur as any).isNeighbor = true;
                            (cur as any).ornamentMark = 'v';
                        }
                        continue;
                    }

                    // Same-direction stepwise motion under a held upper chord -> passing (bass)
                    if (!isChordToneAgainstAnchor) {
                        (cur as any).isPassing = true;
                        (cur as any).ornamentMark = 'P';
                    }
                    // No analysis-panel entry; this is a label-stability aid.
                    continue;
                }

                if (leapOut && oppositeDir) {
                    (cur as any).isEscape = true;
                    (cur as any).ornamentMark = 's';
                    // No analysis-panel entry; this is a label-stability aid.
                    continue;
                }
            }
        } catch {
            // ignore
        }
    }

    _pmark('07-ornaments');
    // -----------------------
    // Suspension (ritardo) detector
    // -----------------------
    function detectSuspensions(notesByVoice: Record<Voice, StaffNote[]>, chordEvents: ChordEvent[], beatsPerMeasure: number) {
        debugLog('[ANALYSIS] detectSuspensions start');


        // Build note start/end map (absolute beats)
        const noteSpanMap = new Map<string, { start: number; end: number }>();
        analyzedNotes.forEach(n => {
            const m = n.measureIndex ?? 0;
            const b = n.beat ?? 1;
            const start = (m * beatsPerMeasure) + (b - 1);
            const dur = getDuration(n);
            noteSpanMap.set(n.id, { start, end: start + Math.max(dur, 1e-6) });
        });

        const getNoteStart = (note: StaffNote) => noteSpanMap.get(note.id)?.start ?? (((note.measureIndex ?? 0) * beatsPerMeasure) + ((note.beat ?? 1) - 1));
        const getNoteEnd = (note: StaffNote) => noteSpanMap.get(note.id)?.end ?? (((note.measureIndex ?? 0) * beatsPerMeasure) + ((note.beat ?? 1) - 1) + getDuration(note));

        const pcSignature = (notes: StaffNote[]) => {
            try {
                const pcs = [...new Set((notes || [])
                    .filter(n => n && !(n as any).isRest)
                    .filter(n => Number.isFinite((n as any).midi))
                    .map(n => mod12((n.midi ?? 0) - 12))
                )].sort((x, y) => x - y);
                return pcs.join('-');
            } catch {
                return '';
            }
        };

        const isOrnamentalLike = (n: StaffNote | null | undefined): boolean => {
            try {
                if (!n) return false;
                const anyN: any = n as any;
                return !!(anyN.isPassing || anyN.isNeighbor || anyN.isAnticipation || anyN.isAppoggiatura || anyN.isEscape);
            } catch {
                return false;
            }
        };

        const hasHarmonyChangeUnderHeldNote = (a: ChordEvent, b: ChordEvent, suspendedVoice: Voice): boolean => {
            try {
                const otherVoices = ([1, 2, 3, 4] as Voice[]).filter(v => v !== suspendedVoice);

                const getEvNote = (ev: ChordEvent, v: Voice): StaffNote | null => {
                    try {
                        const n = ev.byVoice?.get(v);
                        if (n && !(n as any).isRest && Number.isFinite((n as any).midi) && !isOrnamentalLike(n)) return n;
                        const fallback = (ev.notes || []).find(nn => (nn.voice ?? 1) === v);
                        if (fallback && !(fallback as any).isRest && Number.isFinite((fallback as any).midi) && !isOrnamentalLike(fallback)) return fallback;
                        return null;
                    } catch {
                        return null;
                    }
                };

                const otherNotesA = otherVoices.map(v => getEvNote(a, v)).filter(Boolean) as StaffNote[];
                const otherNotesB = otherVoices.map(v => getEvNote(b, v)).filter(Boolean) as StaffNote[];

                const sigOtherA = pcSignature(otherNotesA);
                const sigOtherB = pcSignature(otherNotesB);
                if (sigOtherA && sigOtherB && sigOtherA === sigOtherB) return false;

                // If we have a sufficiently complete texture, avoid treating a single upper-voice
                // change as a harmony change when it is likely ornamental (short duration).
                // This prevents passing/appoggiatura notes in the preparation bar from creating
                // false suspensions at the following beat.
                if (otherNotesA.length >= 3 && otherNotesB.length >= 3) {
                    const bassPcA = mod12(otherNotesA.slice().sort((x, y) => (x.midi ?? 0) - (y.midi ?? 0))[0].midi ?? 0);
                    const bassPcB = mod12(otherNotesB.slice().sort((x, y) => (x.midi ?? 0) - (y.midi ?? 0))[0].midi ?? 0);
                    const bassStable = bassPcA === bassPcB;

                    if (bassStable) {
                        const changedVoices: Voice[] = [];
                        for (const ov of otherVoices) {
                            const na = getEvNote(a, ov);
                            const nb = getEvNote(b, ov);
                            if (!na || !nb) continue;
                            if (mod12(na.midi ?? 0) !== mod12(nb.midi ?? 0)) changedVoices.push(ov);
                        }

                        if (changedVoices.length === 1) {
                            const ov = changedVoices[0];
                            const na = getEvNote(a, ov);
                            const nb = getEvNote(b, ov);
                            if (na && nb) {
                                const durA = (getNoteEnd(na) - getNoteStart(na));
                                const durB = (getNoteEnd(nb) - getNoteStart(nb));
                                const likelyOrnamental = Math.min(durA, durB) <= ORNAMENT_DUR + 1e-6;
                                if (likelyOrnamental) return false;
                            }
                        }
                    }
                }

                // Fallback: signatures differ (or sparse/unknown) => treat as a change.
                return true;
            } catch {
                return true;
            }
        };

        const MIN_SUSP_DURATION = 1.0; // beats: S should last at least one beat
        const MAX_RESOLUTION_WINDOW = 4.0; // beats: search for resolution within this window
        const ORNAMENT_DUR = 0.5; // notes shorter than this may be ornaments

        for (let i = 0; i < chordEvents.length - 1; i++) {
            const a = chordEvents[i];
            const b = chordEvents[i + 1];

            // ROTTURA DIDATTICA: Se c'è una doppia barline tra l'accordo A e l'accordo B,
            // interrompi qualsiasi validazione orizzontale (regole di moto) tra i due.
            if (doubleBarlineMeasures && doubleBarlineMeasures.length > 0) {
                // b.measureIndex è la misura in cui inizia il secondo evento.
                // Se la misura di b è X, e c'è una doppia barline ALLA FINE della misura X-1,
                // allora la transizione è "rotta".
                // In VexFlow UI, doubleBarline @ N significa "alla fine della misura N (1-based nel UI, ma 0-based logica)".
                // Controlliamo quindi se b.measureIndex (0-based) è stato "chiuso" da una barline nell'evento precedente.
                // O più semplicemente: se a.measureIndex != b.measureIndex, verifichiamo se a.measureIndex è nell'elenco.
                if (a.measureIndex !== b.measureIndex) {
                    const barlineAtEnd = doubleBarlineMeasures.includes(a.measureIndex);
                    if (barlineAtEnd) continue;
                }
            }

            // context tonic/leading for this downbeat
            const ctx = getContextAtAbsBeat(b.absBeat);
            const ctxTonicPc = noteNameToIndex[ctx.tonic] ?? tonicPc;
            const ctxLeadingPc = mod12(ctxTonicPc - 1);

            for (const v of [1,2,3,4] as Voice[]) {
                // Preparation note: do NOT assume it started on the bar downbeat.
                // In real counterpoint/chorale writing (and in your Dubuois example), the
                // preparation can begin mid-measure, often as the resolution of a previous
                // suspension. What matters is that a note of the same pitch is *held into*
                // the harmony change at b.absBeat.
                const epsBefore = 1e-4;
                const heldBefore = (() => {
                    try {
                        const candidates = analyzedNotes
                            .filter(n => (n.voice ?? 1) === v)
                            .filter(n => {
                                const s = getNoteStart(n);
                                const e = getNoteEnd(n);
                                return s < b.absBeat - 1e-6 && e > (b.absBeat - epsBefore);
                            })
                            .sort((x, y) => getNoteStart(y) - getNoteStart(x));
                        return candidates[0] || null;
                    } catch {
                        return null;
                    }
                })();

                const prep = heldBefore || a.byVoice.get(v) || null;
                if (!prep) continue;

                // find the sounding note at the downbeat in this voice (S)
                const sounders = analyzedNotes.filter(n => (n.voice ?? 1) === v).filter(n => {
                    const s = getNoteStart(n);
                    const e = getNoteEnd(n);
                    return s <= b.absBeat + 1e-6 && e > b.absBeat + 1e-6;
                });
                if (!sounders.length) continue;
                const S = sounders[0];

                // Rule 1: Preparation - there must be a note in previous chord equal in pitch to S
                if ((prep.midi ?? 0) !== (S.midi ?? 0)) {
                    debugLog('[ANALYSIS] detectSuspensions skip-prep-mismatch', { voice: v, prepId: prep.id, prepMidi: prep.midi, sId: S.id, sMidi: S.midi, aAbs: a.absBeat, bAbs: b.absBeat });
                    continue;
                }

                // Preparation consonance:
                // allow the preparation to start on any beat; require that within the span
                // from prep start up to the harmony change, the note is consonant in at least
                // one chord event (typically right after it begins, or after resolving a
                // previous suspension).
                const prepStartAbs = getNoteStart(prep);
                const prepConsonantSomewhere = (() => {
                    try {
                        for (let j = i; j >= 0; j--) {
                            const ev = chordEvents[j];
                            if (!ev) continue;
                            if (ev.absBeat < prepStartAbs - 1e-6) break;
                            if (ev.absBeat >= b.absBeat - 1e-6) continue;
                            if (isNoteInChord(prep, ev)) return true;
                        }
                        return false;
                    } catch {
                        return false;
                    }
                })();
                if (!prepConsonantSomewhere) {
                    debugLog('[ANALYSIS] detectSuspensions skip-prep-not-consonant', { prepId: prep.id, aAbs: a.absBeat, prepStartAbs, bAbs: b.absBeat });
                    continue;
                }

                // Rule 2: S must be truly *held into* the harmony change.
                // A re-attack on the downbeat (same pitch, new note) is NOT a suspension.
                const sStart = getNoteStart(S);
                const prepEnd = getNoteEnd(prep);
                const HOLD_EPS = 1e-3;
                const isSameNoteObject = (S.id === prep.id);
                const startedBeforeChange = (sStart < b.absBeat - HOLD_EPS);

                // True tie across the harmony change can be represented either as a single long note
                // (same id) OR as two adjacent note IDs where the first is marked isTiedToNext.
                const hasExplicitTie = !!((prep as any)?.isTiedToNext) || !!((S as any)?.isTiedFromPrev);
                const samePitch = Number.isFinite((prep as any)?.midi) && Number.isFinite((S as any)?.midi) && (prep.midi === S.midi);
                const prepEndsAtChange = Math.abs(prepEnd - b.absBeat) <= HOLD_EPS;
                const tiedAcrossChange = hasExplicitTie && samePitch && prepEndsAtChange;

                // Without an explicit tie, require a real overlap (avoid re-attack false positives).
                const prepOverlapsChange = (prepEnd > b.absBeat + HOLD_EPS);

                const tiedOrStartedBefore = isSameNoteObject || startedBeforeChange || prepOverlapsChange || tiedAcrossChange;
                // Allow a same-pitch re-attack exactly at the change (common notationally
                // when ties are omitted in exercises), as long as the prep ends at the change.
                const reattackSamePitchAtChange = !tiedOrStartedBefore && prepEndsAtChange && samePitch && Math.abs(sStart - b.absBeat) <= HOLD_EPS;
                if (!tiedOrStartedBefore && !reattackSamePitchAtChange) continue;

                // S must be dissonant with the new chord at the downbeat.
                // Use an interval-to-bass test rather than chord-identification membership,
                // because chord ID can be unstable with missing tones / tied notes and may
                // cause false suspensions one chord too early.
                // Important: a true suspension happens when the harmony changes *under* a held note.
                // Checking only note *attacks* at b.absBeat misses cases where the change happens
                // via note endings / ties, so compare pitch-class signatures across events.
                if (!hasHarmonyChangeUnderHeldNote(a, b, v)) {
                    debugLog('[ANALYSIS] detectSuspensions skip-no-harmony-change-under-held-note', { voice: v, bAbs: b.absBeat, sId: S.id });
                    continue;
                }
                // Determine bass-at-B excluding S (if possible)
                const notesAtB = (b.notes || []) as StaffNote[];
                const otherAtB = notesAtB.filter(n => n.id !== S.id);
                const bassAtB = (otherAtB.length ? otherAtB : notesAtB)
                    .slice()
                    .sort((x, y) => (x.midi ?? 0) - (y.midi ?? 0))[0];
                if (!bassAtB || typeof bassAtB.midi !== 'number' || typeof S.midi !== 'number') {
                    continue;
                }

                // Special case: bass-voice suspensions/ritardi.
                // The interval-to-bass test is meaningless if the suspended voice is itself the bass,
                // because excluding S makes "bassAtB" jump to an upper voice.
                // Instead, infer the new harmony from the other voices and require that S is *not*
                // a chord member at B, then let the usual resolution checks confirm the pattern.
                if (v === 4) {
                    try {
                        const notesAtBAll = (b.notes || []) as StaffNote[];
                        // Prefer a candidate-based chord inference (more robust on incomplete sonorities)
                        // using *other voices* at B (the bass is the delayed tone).
                        const chordSourceNotes = notesAtBAll.filter(n => n.id !== S.id && (n.voice ?? 1) !== v);
                        const uniquePcs = [...new Set(chordSourceNotes
                            .filter(n => n && !(n as any).isRest)
                            .filter(n => Number.isFinite((n as any).midi))
                            .map(n => mod12((n.midi ?? 0) - 12))
                        )];

                        const cands = identifyChordCandidates(chordSourceNotes);
                        const best = (cands && cands.length) ? cands[0] : null;
                        if (best && best.root && best.type) {
                            const formula = (CHORD_FORMULAS as any)[best.type] as number[] | undefined;
                            if (formula && Array.isArray(formula)) {
                                const rootPc = mod12((best.root as any).noteIndex ?? mod12((best.root as any).midi ?? 0));
                                const sPc = mod12((typeof (S as any).noteIndex === 'number') ? (S as any).noteIndex : mod12(S.midi ?? 0));
                                const intervalFromRoot = mod12(sPc - rootPc);
                                const isMember = formula.includes(intervalFromRoot);

                                // Guard: cadential V7(4/2) with the 7th in the bass.
                                // If the upper voices form a confident major triad (e.g. Bb–D–F)
                                // and the held bass note is its minor 7th (e.g. Ab), then the full
                                // verticality is a dominant seventh chord in 4/2, not a bass suspension.
                                // Without this, prepared dominants can be mis-tagged as "susp" and the
                                // UI may show the resolution Roman (I4/2) instead of V4/2.
                                try {
                                    const matchType = (best as any).matchType;
                                    const confidentTriad = (uniquePcs.length >= 3) && (matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third');
                                    const triadIsMajor = String(best.type) === 'Major' || String(best.type).toLowerCase() === 'major';
                                    if (confidentTriad && triadIsMajor && intervalFromRoot === 10) {
                                        const fullCands = identifyChordCandidates(notesAtBAll);
                                        const bestFull = (fullCands && fullCands.length) ? fullCands[0] : null;
                                        const mtFull = (bestFull as any)?.matchType;
                                        const confidentFull = mtFull === 'exact' || mtFull === 'no_fifth' || mtFull === 'no_third';
                                        const fullType = String(bestFull?.type || '');
                                        const isDominant7 = /dominant\s*7/i.test(fullType);
                                        const fullRootPc = bestFull?.root ? mod12((bestFull.root as any).noteIndex ?? mod12((bestFull.root as any).midi ?? 0)) : null;
                                        if (confidentFull && isDominant7 && fullRootPc != null && fullRootPc === rootPc) {
                                            debugLog('[ANALYSIS] detectSuspensions skip-bass-held-7th-of-dominant-42', { voice: v, sId: S.id, bAbs: b.absBeat, rootPc, intervalFromRoot, fullType });
                                            continue;
                                        }
                                    }
                                } catch { /* ignore */ }

                                // Only skip if we're confident the upper-voice chord is identified.
                                // Otherwise, treat it as potentially dissonant and let the resolution
                                // checks decide.
                                const matchType = (best as any).matchType;
                                const confident = (uniquePcs.length >= 3) && (matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third');
                                if (confident && isMember) {
                                    debugLog('[ANALYSIS] detectSuspensions skip-bass-s-is-chord-member-at-B', { voice: v, sId: S.id, bAbs: b.absBeat, chordType: best.type, intervalFromRoot, matchType });
                                    continue;
                                }
                            }
                        }
                    } catch (_) { /* ignore */ }
                }

                const intervalMod12 = mod12((S.midi ?? 0) - (bassAtB.midi ?? 0));
                // Treat 2nd, 4th, 7th as dissonant against the bass in this context.
                // NOTE: 6-5 suspensions are common but the 6th is consonant vs the bass,
                // so we allow 6ths *only* if later checks confirm a true 6-5 resolution.
                // Bass-voice suspensions are handled separately above; do not apply this heuristic.
                const isConsonantToBass = (v === 4)
                    ? false
                    : (intervalMod12 === 0 || intervalMod12 === 3 || intervalMod12 === 4 || intervalMod12 === 7 || intervalMod12 === 8 || intervalMod12 === 9);

                // ── 6/4 chord guard ──
                // A perfect 4th above the bass is normally dissonant, but in a
                // legitimate second-inversion triad (6/4 chord) the 4th is a
                // chord tone of the parent triad, not a suspension.
                // Example: D bass with G-B-D above → G major 6/4 (V6/4 in C).
                // The G (a 4th above D) is the chord root, not a suspension.
                let is64ChordTone = false;
                if (v !== 4 && intervalMod12 === 5) {
                    try {
                        const notesAtBAll = (b.notes || []) as StaffNote[];
                        // Use all sounding notes (including S) to identify the chord
                        const fullCands = identifyChordCandidates(notesAtBAll);
                        if (fullCands && fullCands.length) {
                            const bestFull = fullCands[0];
                            const fullType = String(bestFull?.type || '');
                            // Only accept major/minor triads (not sus chords which are ambiguous)
                            const isTriad = /^(Major|Minor)$/i.test(fullType);
                            if (isTriad && bestFull?.root) {
                                const rootPcFull = mod12((bestFull.root as any).noteIndex ?? mod12((bestFull.root as any).midi ?? 0));
                                const bassPcB = mod12(bassAtB.midi ?? 0);
                                // Second inversion: bass = 5th of the chord (interval 7 from root)
                                const bassIntervalFromRoot = mod12(bassPcB - rootPcFull);
                                if (bassIntervalFromRoot === 7) {
                                    // S is a 4th above bass → check if S is the chord root
                                    const sPcCheck = mod12(S.midi ?? 0);
                                    const sIntervalFromRoot = mod12(sPcCheck - rootPcFull);
                                    if (sIntervalFromRoot === 0) {
                                        // S is the root of a 6/4 chord → definitely a chord tone
                                        is64ChordTone = true;
                                        debugLog('[ANALYSIS] detectSuspensions skip-64-chord-tone', { voice: v, sId: S.id, bAbs: b.absBeat, chordType: fullType, rootPc: rootPcFull });
                                    }
                                }
                            }
                        }
                    } catch { /* ignore */ }
                }
                if (is64ChordTone) continue;

                const isPotentialSixthSusp = (v === 4)
                    ? false
                    : (intervalMod12 === 8 || intervalMod12 === 9);

                // Some ritardi resolve to the *fundamental* of the next harmony while the bass is inverted/pedalled.
                // In these cases, the held note may look consonant against the bass (e.g. 5-4 or 3-2 above the bass),
                // but is still a true accented dissonance as a chordal 7th against the harmony root at B.
                let chordalSeventhHeldAtB = false;
                let chordMemberAtB = false;
                let seventhRootPcAtB: number | null = null;

                // Guard: don't treat chord members as suspensions.
                // Example: in C major, C held into D7 is a chordal 7th (not a suspension).
                // We must be careful: if we identify harmony from *all* sounding notes, true
                // suspensions can look like sus/add chords; but if we identify from attacked
                // notes only, chordal 7ths that are held (not attacked) can look like triads.
                // Strategy:
                // 1) If the full verticality is recognized as a 7th-chord sonority and the held
                //    tone is a member (esp. the 7th), do NOT mark a suspension.
                // 2) Otherwise, fall back to an attacked-notes chord-member check (excluding the
                //    suspended voice when possible) to avoid suppressing true suspensions.
                // NOTE: do not apply these chord-member guards to the bass voice.
                // Bass ritardi are precisely cases where the *bass* is delayed, and the
                // resulting verticality at B can be mis-identified as a legitimate 7th chord
                // (e.g. Ebmaj7) even though the intended harmony is something else (e.g. ii).
                // Bass cases are handled by the dedicated logic below.
                if (v !== 4) try {
                    const notesAtBAll = (b.notes || []) as StaffNote[];
                    const sPc = mod12((typeof (S as any).noteIndex === 'number') ? (S as any).noteIndex : mod12(S.midi ?? 0));

                    const looksSeventhType = (t: string): boolean => {
                        const s = String(t || '');
                        return s.includes('7') || s.includes('9') || s.includes('11') || s.includes('13') || s.includes('dim7') || s.includes('ø7');
                    };

                    // Extra guard: if the full verticality *with* S forms a clear 7th-chord sonority
                    // and S is the chordal 7th of that same-root chord (vs the chord inferred without S),
                    // then this is a chordal seventh resolution, not a suspension/ritardo.
                    // This is especially important when S is held (not attacked) so attacked-only
                    // inference may miss the 7th.
                    try {
                        const heldIntoB = (getNoteStart(S) < b.absBeat - 1e-6) || (getNoteEnd(prep) > b.absBeat - 1e-6);
                        if (heldIntoB) {
                                const chordInfoWithS = _iC(notesAtBAll);
                                const chordInfoWithoutS = _iC(notesAtBAll.filter(n => n && n.id !== S.id));
                            if (
                                chordInfoWithS && chordInfoWithS.root && chordInfoWithS.type &&
                                chordInfoWithoutS && chordInfoWithoutS.root && chordInfoWithoutS.type &&
                                !String(chordInfoWithS.type).includes('Sus')
                            ) {
                                const tWith = String(chordInfoWithS.type);
                                const tWithout = String(chordInfoWithoutS.type);

                                const rootPcWith = mod12((chordInfoWithS.root as any).noteIndex ?? mod12((chordInfoWithS.root as any).midi ?? 0));
                                const rootPcWithout = mod12((chordInfoWithoutS.root as any).noteIndex ?? mod12((chordInfoWithoutS.root as any).midi ?? 0));

                                const sameRoot = rootPcWith === rootPcWithout;
                                const withoutAlreadySeventh = looksSeventhType(tWithout);
                                const withIsSeventh = looksSeventhType(tWith);

                                if (sameRoot && withIsSeventh && !withoutAlreadySeventh) {
                                    const formulaWith = (CHORD_FORMULAS as any)[chordInfoWithS.type] as number[] | undefined;
                                    const intervalFromRootWith = mod12(sPc - rootPcWith);
                                    const isChordMemberWith = !!(formulaWith && Array.isArray(formulaWith) && formulaWith.includes(intervalFromRootWith));
                                    const isSeventhLike = intervalFromRootWith === 9 || intervalFromRootWith === 10 || intervalFromRootWith === 11;

                                    if (isChordMemberWith && isSeventhLike) {
                                        chordalSeventhHeldAtB = true;
                                        seventhRootPcAtB = rootPcWith;
                                    }
                                }
                            }
                        }
                    } catch { /* ignore */ }

                    // (1) Full-verticality check for real 7th chords (dominant/maj7/min7/ø7/°7).
                    // IMPORTANT: when the note is held into B (tie-like), exclude it from the
                    // inferred sonority so it cannot "explain itself" as a chord member.
                    const heldIntoB = (getNoteStart(S) < b.absBeat - 1e-6) || (getNoteEnd(prep) > b.absBeat - 1e-6);
                    const fullForGuard = heldIntoB ? notesAtBAll.filter(n => n && n.id !== S.id) : notesAtBAll;
                    const chordInfoFull = _iC(fullForGuard);
                    if (chordInfoFull && chordInfoFull.root && chordInfoFull.type && !String(chordInfoFull.type).includes('Sus')) {
                        const t = String(chordInfoFull.type);
                        const looksSeventh = looksSeventhType(t);
                        if (looksSeventh) {
                            const formulaFull = (CHORD_FORMULAS as any)[chordInfoFull.type] as number[] | undefined;
                            const rootPcFull = mod12((chordInfoFull.root as any).noteIndex ?? mod12((chordInfoFull.root as any).midi ?? 0));
                            const intervalFromRootFull = mod12(sPc - rootPcFull);
                            const isChordMember = !!(formulaFull && Array.isArray(formulaFull) && formulaFull.includes(intervalFromRootFull));
                            const isSeventhLike = intervalFromRootFull === 9 || intervalFromRootFull === 10 || intervalFromRootFull === 11;
                            if (heldIntoB && isChordMember && isSeventhLike) {
                                chordalSeventhHeldAtB = true;
                                seventhRootPcAtB = rootPcFull;
                            }
                        }
                    }

                    // (2) Attacked-notes chord-member check.
                    const attackedAtB = notesAtBAll.filter(n => Math.abs(getNoteStart(n) - b.absBeat) < 1e-6);
                    const attackedOtherVoicesAtB = attackedAtB.filter(n => (n.voice ?? 1) !== v);
                    const chordSourceNotes = (attackedOtherVoicesAtB.length
                        ? attackedOtherVoicesAtB
                        : (attackedAtB.length ? attackedAtB : notesAtBAll.filter(n => n.id !== S.id))
                    );

                    const chordInfoB = _iC(chordSourceNotes);
                    const formula = chordInfoB ? (CHORD_FORMULAS as any)[chordInfoB.type] as number[] | undefined : undefined;
                    const rootPc = chordInfoB ? mod12((chordInfoB.root as any).noteIndex ?? mod12((chordInfoB.root as any).midi ?? 0)) : -1;
                    const intervalFromRoot = mod12(sPc - rootPc);
                    if (formula && Array.isArray(formula) && formula.includes(intervalFromRoot)) {
                        chordMemberAtB = true;
                    }
                } catch (_) { /* ignore */ }

                // Duration: S should last at least MIN_SUSP_DURATION after the downbeat
                const sEnd = getNoteEnd(S);
                if ((sEnd - b.absBeat) < MIN_SUSP_DURATION - 1e-6) {
                    debugLog('[ANALYSIS] detectSuspensions skip-short-duration', { sId: S.id, durAfterB: (sEnd - b.absBeat) });
                    continue;
                }

                // Find resolution R: first subsequent note in same voice that is consonant
                const line = notesByVoice[v] || [];
                const idxAfter = line.findIndex(n => getNoteStart(n) > b.absBeat + 1e-6);
                if (idxAfter === -1) {
                    debugLog('[ANALYSIS] detectSuspensions skip-no-candidates-after', { voice: v, bAbs: b.absBeat });
                    continue;
                }

                let resolved: StaffNote | null = null;
                let resolvedIdx = -1;
                for (let k = idxAfter; k < line.length; k++) {
                    const cand = line[k];
                    const candStart = getNoteStart(cand);
                    if (candStart - b.absBeat > MAX_RESOLUTION_WINDOW) break;

                    // allow ornamentals (short notes) between S and a true resolution
                    const candDur = getNoteEnd(cand) - candStart;
                    const candConsonant = isNoteInChord(cand, chordEvents.find(e => Math.abs(e.absBeat - candStart) < 1e-6) || null);

                    if (candConsonant) {
                        // Guard: a short consonant note can appear as a neighbor (nota di volta)
                        // before the true resolution (e.g. F held, then a short G, then back to F,
                        // then resolves). Do not treat that consonant neighbor as the resolution.
                        try {
                            if (candDur <= ORNAMENT_DUR + 1e-6) {
                                const nextCand = line[k + 1];
                                if (nextCand && Number.isFinite((nextCand as any).midi) && Number.isFinite((S as any).midi)) {
                                    const nextStart = getNoteStart(nextCand);
                                    const candEnd = getNoteEnd(cand);
                                    const returnsImmediately = nextStart <= candEnd + 1e-6 && (nextCand.midi ?? 0) === (S.midi ?? 0);
                                    if (returnsImmediately) {
                                        continue;
                                    }
                                }
                            }
                        } catch {
                            // ignore
                        }

                        // IMPORTANT: a consonant intermediate note (e.g. nota di volta) can appear
                        // before the true suspension resolution. Only accept a candidate resolution
                        // if it also resolves stepwise in an allowed direction.
                        const sMidiAtDown = S.midi ?? 0;
                        const rMidi = cand.midi ?? 0;
                        const delta = rMidi - sMidiAtDown;
                        const isStep = Math.abs(delta) <= 2;
                        const isLeading = (sMidiAtDown % 12) === ctxLeadingPc;
                        const allowedDesc = delta < 0 && isStep;

                        // Ascending ritardi are rarer and we must be careful with false positives.
                        // Allow stepwise upward resolution when:
                        // - the held tone is the leading tone (classic 7-8 over a dominant bass), OR
                        // - the suspension forms a clear 7-8 or 2-3 pattern *against the bass at B*.
                        const allowedAsc = (() => {
                            try {
                                if (!(delta > 0 && isStep)) return false;
                                if (isLeading) return true;
                                if (!bassAtB) return false;

                                const bassPos = getDiatonicPosition(bassAtB);
                                const sPos = getDiatonicPosition(S);
                                const rPos = getDiatonicPosition(cand);
                                const fromNum = (sPos - bassPos) + 1;
                                const toNum = (rPos - bassPos) + 1;
                                const fn = ((fromNum - 1) % 7) + 1;
                                const tn = ((toNum - 1) % 7) + 1;

                                // 7->8 (tn wraps to 1 when toNum is an octave)
                                if (fn === 7 && tn === 1 && (toNum - fromNum) === 1) return true;
                                // 2->3 (often appears as compound 9->10 but should display as 2->3)
                                if (fn === 2 && tn === 3 && (toNum - fromNum) === 1) return true;

                                return false;
                            } catch {
                                return false;
                            }
                        })();

                        if (allowedAsc || allowedDesc) {
                            resolved = cand;
                            resolvedIdx = k;
                            break;
                        }

                        // Otherwise keep scanning for a later consonant that is a true resolution.
                        continue;
                    }

                    // otherwise skip ornaments (short) and continue
                    if (candDur <= ORNAMENT_DUR) continue;
                }
                if (!resolved) {
                    debugLog('[ANALYSIS] detectSuspensions skip-no-resolution', { prepId: prep.id, sId: S.id, searchFrom: b.absBeat, window: MAX_RESOLUTION_WINDOW });
                    continue;
                }

                // Direction & stepwise checks: already enforced during candidate selection above.

                // Compute a display type (4-3,7-6,9-8) when possible
                function getDiatonicPosition(n: StaffNote) {
                    try {
                        return getNotePosition(n.pitch, n.octave);
                    } catch {
                        return 0;
                    }
                }
                const suspendedNote = prep;
                const suspendedPos = getDiatonicPosition(suspendedNote);
                const bass = (b.notes || []).slice().sort((x,y) => (x.midi ?? 0) - (y.midi ?? 0))[0];
                let displayType: string | null = null;
                let fromNum = 0; let toNum = 0;
                if (bass) {
                    const bassPos = getDiatonicPosition(bass);
                    fromNum = (suspendedPos - bassPos) + 1;
                    const resolvedPos = getDiatonicPosition(resolved);
                    toNum = (resolvedPos - bassPos) + 1;
                    const fn = ((fromNum - 1) % 7) + 1;
                    const tn = ((toNum - 1) % 7) + 1;
                    if (fn === 4 && tn === 3) displayType = '4-3';
                    else if (fn === 6 && tn === 5) displayType = '6-5';
                    else if (fn === 7 && tn === 6) displayType = '7-6';
                    // Seventh-to-octave (7-8): the held note is a 7th above the bass and resolves
                    // stepwise UP into the octave (e.g. B over C -> C over C).
                    // Without this, the semitone fallback would misclassify B-over-C as 7-6.
                    else if (fn === 7 && tn === 1 && (toNum - fromNum) === 1) displayType = '7-8';
                    // Octave-to-seventh suspension: the held note and bass share the same
                    // diatonic letter (fn===1), then resolve to a 7th (tn===7). This can
                    // otherwise be misclassified by the semitone fallback as 7-6 (e.g. C over C♯).
                    else if (fn === 1 && tn === 7 && fromNum > 7) displayType = '8-7';
                    else if (fn === 2 && tn === 1 && fromNum > 7) displayType = '9-8';
                    else if (fn === 2 && tn === 3 && (toNum - fromNum) === 1) displayType = '2-3';
                    else if (fn === 5 && tn === 4) displayType = '5-4';
                    else if (fn === 3 && tn === 2) displayType = '3-2';
                    if (!displayType) {
                        const rawInterval = Math.abs(((suspendedNote.midi ?? 0) - (bass.midi ?? 0)));
                        const mod12Int = rawInterval % 12;
                        if (mod12Int === 5) displayType = '4-3';
                        else if (mod12Int === 8 || mod12Int === 9) displayType = '6-5';
                        else if (mod12Int === 10 || mod12Int === 11) displayType = '7-6';
                        else if (mod12Int === 2 && rawInterval > 12) displayType = '9-8';
                    }
                }

                // Normalize display numbers: for labels we generally want simple figures (3/2, 5/4, ...)
                // rather than compound (10/9, 12/11, ...). Keep 9-8 explicitly as 9/8.
                if (displayType === '4-3') { fromNum = 4; toNum = 3; }
                else if (displayType === '6-5') { fromNum = 6; toNum = 5; }
                else if (displayType === '7-6') { fromNum = 7; toNum = 6; }
                else if (displayType === '7-8') { fromNum = 7; toNum = 8; }
                else if (displayType === '8-7') { fromNum = 8; toNum = 7; }
                else if (displayType === '9-8') { fromNum = 9; toNum = 8; }
                else if (displayType === '2-3') { fromNum = 2; toNum = 3; }
                else if (displayType === '5-4') { fromNum = 5; toNum = 4; }
                else if (displayType === '3-2') { fromNum = 3; toNum = 2; }

                // Strictly recognize the "ritardo sulla fondamentale" subtype:
                // - S is a held chordal 7th (against the harmony root at B)
                // - resolution is stepwise into the *root* of the resolution chord
                // - bass pitch-class is stable from B to resolution
                let isFundamentalDelay = false;
                try {
                    const resStart = getNoteStart(resolved);
                    const evRes = chordEvents.find(e => Math.abs(e.absBeat - resStart) < 1e-6);
                    if (evRes && evRes.notes && evRes.notes.length) {
                        const bassAtRes = evRes.notes.slice().sort((x, y) => (x.midi ?? 0) - (y.midi ?? 0))[0];
                        const bassStable = bassAtRes && typeof bassAtRes.midi === 'number' && mod12(bassAtRes.midi) === mod12(bassAtB.midi ?? 0);

                        // Root at resolution
                        let rootPcRes: number | null = null;
                        try {
                            const chordInfoRes = _iC(evRes.notes as any);
                            if (chordInfoRes && chordInfoRes.root) {
                                rootPcRes = mod12((chordInfoRes.root as any).noteIndex ?? mod12((chordInfoRes.root as any).midi ?? 0));
                            } else {
                                const cands = identifyChordCandidates(evRes.notes as any);
                                const best = (cands && cands.length) ? cands[0] : null;
                                if (best && best.root) rootPcRes = mod12((best.root as any).noteIndex ?? mod12((best.root as any).midi ?? 0));
                            }
                        } catch { /* ignore */ }

                        const resolvedPc = mod12(resolved.midi ?? 0);
                        const resolvesToRoot = rootPcRes != null && resolvedPc === rootPcRes;

                        // Root at B (prefer the 7th-chord root when we detected it)
                        let rootPcB: number | null = seventhRootPcAtB;
                        if (rootPcB == null) {
                            try {
                                const chordInfoBFull2 = _iC((b.notes || []) as any);
                                if (chordInfoBFull2 && chordInfoBFull2.root) {
                                    rootPcB = mod12((chordInfoBFull2.root as any).noteIndex ?? mod12((chordInfoBFull2.root as any).midi ?? 0));
                                } else {
                                    const candsB = identifyChordCandidates((b.notes || []) as any);
                                    const bestB = (candsB && candsB.length) ? candsB[0] : null;
                                    if (bestB && bestB.root) rootPcB = mod12((bestB.root as any).noteIndex ?? mod12((bestB.root as any).midi ?? 0));
                                }
                            } catch { /* ignore */ }
                        }

                        const sPc = mod12(S.midi ?? 0);
                        const seventhLikeAtB = rootPcB != null && [9, 10, 11].includes(mod12(sPc - rootPcB));
                        isFundamentalDelay = bassStable && resolvesToRoot && seventhLikeAtB;
                    }
                } catch { /* ignore */ }

                // Core suspension sanity check (upper voices): the bass should be stable from the
                // suspension onset (B) to the resolution event.
                // Otherwise we can misread ordinary revoicings/inversions (root -> 1st inv, etc.)
                // as a "5-4" or similar pattern computed against the *old* bass at B.
                if (v !== 4) {
                    try {
                        const resStart = getNoteStart(resolved);
                        const evRes = chordEvents.find(e => Math.abs(e.absBeat - resStart) < 1e-6);
                        if (evRes && evRes.notes && evRes.notes.length) {
                            const bassAtRes = evRes.notes.slice().sort((x, y) => (x.midi ?? 0) - (y.midi ?? 0))[0];
                            if (bassAtRes && typeof bassAtRes.midi === 'number') {
                                const bassStable = mod12(bassAtRes.midi) === mod12(bassAtB.midi);
                                if (!bassStable && !isFundamentalDelay) {
                                    debugLog('[ANALYSIS] detectSuspensions skip-bass-changed-between-B-and-resolution', {
                                        voice: v,
                                        sId: S.id,
                                        bAbs: b.absBeat,
                                        resAbs: evRes.absBeat,
                                        bassB: mod12(bassAtB.midi),
                                        bassRes: mod12(bassAtRes.midi),
                                        displayType,
                                    });
                                    continue;
                                }
                            }
                        }
                    } catch { /* ignore */ }
                }

                // If the note is a chord member at B, only allow it when it matches the
                // strict "fundamental-delay" subtype above.
                if ((chordMemberAtB || chordalSeventhHeldAtB) && !isFundamentalDelay) {
                    debugLog('[ANALYSIS] detectSuspensions skip-chord-member-at-B', { voice: v, sId: S.id, bAbs: b.absBeat, chordMemberAtB, chordalSeventhHeldAtB });
                    continue;
                }

                // If the note is consonant vs bass at B, only accept it as a suspension
                // when it matches a true 6-5 pattern and the bass is stable.
                if (isConsonantToBass) {
                    // Also allow 5-4 in 3rd-inversion 7th chords (V4/2-like): the suspended 5th is
                    // consonant to the bass (a perfect 5th), but dissonant vs the underlying chord.
                    const allow54InThirdInversionSeventh = (() => {
                        try {
                            if (displayType !== '5-4') return false;

                            const otherVoicesAtB = (b.notes || [])
                                .filter(n => n && !n.isRest && Number.isFinite((n as any).midi))
                                .filter(n => (n.voice ?? 1) !== v && n.id !== S.id);
                            if (!otherVoicesAtB.length) return false;

                            // Infer the underlying harmony at B from the other voices (excluding the suspended voice).
                            const cands = identifyChordCandidates(otherVoicesAtB as any);
                            const best = (cands && cands.length) ? cands[0] : null;
                            const chordInfoB = (best && best.root && best.type)
                                ? { root: best.root as any, type: best.type as any }
                                : _iC(otherVoicesAtB as any);
                            if (!chordInfoB || !chordInfoB.root || !chordInfoB.type) return false;
                            if (String(chordInfoB.type).includes('Sus')) return false;

                            const formula = (CHORD_FORMULAS as any)[chordInfoB.type] as number[] | undefined;
                            if (!formula || !Array.isArray(formula) || !formula.length) return false;

                            const rootPc = mod12((chordInfoB.root as any).noteIndex ?? mod12((chordInfoB.root as any).midi ?? 0));
                            const bassPc = mod12(bassAtB.midi ?? 0);
                            const intervalRootToBass = mod12(bassPc - rootPc);
                            const bassIsSeventh = intervalRootToBass === 9 || intervalRootToBass === 10 || intervalRootToBass === 11;
                            const seventhLike = formula.includes(9) || formula.includes(10) || formula.includes(11) || String(chordInfoB.type).includes('7');
                            if (!(bassIsSeventh && seventhLike)) return false;

                            const resolvedPc = mod12(resolved.midi ?? 0);
                            const resolvedInterval = mod12(resolvedPc - rootPc);
                            const resolvesToChordTone = formula.includes(resolvedInterval);
                            return resolvesToChordTone;
                        } catch {
                            return false;
                        }
                    })();

                    if (!isFundamentalDelay && !(isPotentialSixthSusp && displayType === '6-5') && !allow54InThirdInversionSeventh) {
                        debugLog('[ANALYSIS] detectSuspensions skip-s-consonant-at-B', { sId: S.id, bAbs: b.absBeat, bassId: bassAtB.id, intervalMod12 });
                        continue;
                    }

                    // Extra guard for 6-5: require that the bass at the resolution event
                    // is the same pitch class as the bass at B (avoid misclassifying
                    // ordinary 6ths in first-inversion chords).
                    try {
                        const resStart = getNoteStart(resolved);
                        const evRes = chordEvents.find(e => Math.abs(e.absBeat - resStart) < 1e-6);
                        if (evRes && evRes.notes && evRes.notes.length) {
                            const bassAtRes = evRes.notes.slice().sort((x, y) => (x.midi ?? 0) - (y.midi ?? 0))[0];
                            if (bassAtRes && typeof bassAtRes.midi === 'number') {
                                if (mod12(bassAtRes.midi) !== mod12(bassAtB.midi)) {
                                    debugLog('[ANALYSIS] detectSuspensions skip-6-5-bass-changed', { sId: S.id, bAbs: b.absBeat, resAbs: evRes.absBeat, bassB: mod12(bassAtB.midi), bassRes: mod12(bassAtRes.midi) });
                                    continue;
                                }
                            }
                        }
                    } catch (_) {}
                }

                // All checks passed: mark suspension on the preparatory note (prep)
                // Find the timeline event that actually contains the preparatory
                // note and use its absBeat as the canonical "from" for the
                // suspension display. This ensures the label is placed next to
                // the preparatory chord event (e.g., beat 3) rather than an
                // earlier unrelated event. Fall back to `a.absBeat` or the
                // note start if necessary.
                let originStart = a.absBeat;
                try {
                    const noteStart = getNoteStart(prep);
                    if (Number.isFinite(noteStart)) {
                        // 1) Prefer the most recent chordEvent before the downbeat
                        //    where this voice explicitly references the preparatory
                        //    note id. This ensures we anchor to the chord that
                        //    contains the prep (e.g., beat 3) even if the note
                        //    started earlier and was sustained.
                        const eventsBeforeB = (chordEvents || []).filter(e => typeof e.absBeat === 'number' && e.absBeat < b.absBeat - 1e-6);
                        if (DEBUG_ANALYSIS) {
                            try {
                                debugLog('[ANALYSIS] detectSuspensions debug eventsBeforeB', { bAbs: b.absBeat, aAbs: a.absBeat, noteStart, events: eventsBeforeB.map(e => ({ absBeat: e.absBeat })) });
                                eventsBeforeB.forEach(ev => {
                                    try {
                                        const ids: any = {};
                                        [1,2,3,4].forEach(vn => { const n = ev.byVoice.get(vn as Voice); if (n) ids[vn] = n.id; });
                                        debugLog('[ANALYSIS] detectSuspensions debug eventByVoice', { evAbs: ev.absBeat, ids });
                                    } catch(_) {}
                                });
                            } catch(_) {}
                        }
                        const matches = eventsBeforeB.filter(ev => {
                            try {
                                const v = ev.byVoice.get(prep.voice || 1);
                                return v && v.id === prep.id;
                            } catch (_) { return false; }
                        });
                        debugLog('[ANALYSIS] detectSuspensions debug matches', { prepId: prep.id, prepVoice: prep.voice, matchAbs: matches.map(m=>m.absBeat) });
                        if (matches.length) {
                            const chosen = matches.reduce((A, B) => (A.absBeat! > B.absBeat! ? A : B));
                            originStart = chosen.absBeat!;
                        } else {
                            // Prefer the nearest prior chordEvent to the downbeat B
                            // (i.e., the latest event with absBeat < b.absBeat). This
                            // tends to place the suspension label on the most recent
                            // preparatory chord (e.g., beat 3) even when the prep
                            // note began earlier.
                            const priorEvents = (chordEvents || []).filter(e => typeof e.absBeat === 'number' && e.absBeat < b.absBeat - 1e-6);
                            if (priorEvents.length) {
                                const nearest = priorEvents.reduce((A, B) => (A.absBeat! > B.absBeat! ? A : B));
                                originStart = nearest.absBeat!;
                            } else {
                                // Fallback to signature-based heuristic
                                const targetSig = chordSignature(b.notes || []);
                                const idxB = chordEvents.findIndex(e => Math.abs(e.absBeat - b.absBeat) < 1e-6);
                                if (idxB >= 0) {
                                    for (let k = idxB - 1; k >= 0; k--) {
                                        const ev = chordEvents[k];
                                        const sig = chordSignature(ev.notes || []);
                                        if (sig !== targetSig) { originStart = ev.absBeat; break; }
                                    }
                                }
                                // final fallback: last event <= noteStart
                                if (originStart === a.absBeat) {
                                    const candidates = (chordEvents || []).filter(e => typeof e.absBeat === 'number' && e.absBeat <= noteStart + 1e-6);
                                    if (candidates.length) {
                                        const chosen = candidates.reduce((A, B) => (A.absBeat! > B.absBeat! ? A : B));
                                        originStart = chosen.absBeat!;
                                    }
                                }
                            }
                        }
                    }
                } catch (_) {}
                // Display anchor: place the suspension at the onset of the dissonance
                // (event `b`), not at the earlier preparation chord. This keeps the
                // Roman-numeral interpretation aligned with where the suspension
                // actually happens.
                //
                // IMPORTANT: when the held note is represented as two different note IDs
                // across the barline (prep is tied-to-next, and S is the new note at b),
                // also mark the downbeat note `S` so renderers can correctly filter and
                // highlight the suspension at its actual onset.
                // Pedagogical/robustness policy: treat non-classic tags like 5-4 / 3-2 as NCTs
                // (typically appoggiatura/accented passing) rather than true suspensions.
                // These can be musically ambiguous and often generate confusing overlays and
                // unwanted interaction with harmony labeling.
                // NOTE: 5-4 and 3-2 are valid suspension types (ritardi) in this project.
                // Do not coerce them into appoggiature here; fixtures and pedagogy expect
                // them to be stored as suspensions and to participate in span logic.

                // ── Chord-tone guard ────────────────────────────────────
                // If the "suspended" note is actually a chord tone of the triad
                // formed by the OTHER voices at beat b, it is not a suspension
                // but a structural member of the new harmony.  Skip it.
                {
                    const otherAtB = (b.notes || []).filter(
                        (nn: any) => nn && !nn.isRest && nn.id !== prep.id && (S ? nn.id !== S.id : true) && Number.isFinite(nn.midi));
                    if (otherAtB.length >= 2) {
                        const otherPCs = otherAtB.map((nn: any) => ((nn.midi % 12) + 12) % 12);
                        const prepPC = ((prep.midi ?? 0) % 12 + 12) % 12;
                        // Check whether prep PC fits a standard triad or seventh chord built on
                        // any of the other pitch-classes (Major, minor, dim, aug, dom7, m7, etc.).
                        // Strategy: only use 7th-chord templates when prepPC is the ROOT
                        // (a root that forms a 7th chord with the others is clearly structural).
                        // For otherPCs as root, use triads only (to avoid blocking real suspensions
                        // that happen to form a 7th with the new chord, e.g. 4-3 over C = CMaj7).
                        const triadTemplates = [[0,4,7],[0,3,7],[0,3,6],[0,4,8]];
                        const seventhTemplates = [
                            [0,4,7,10],[0,3,7,10],[0,3,6,10],[0,3,6,9], // dom7, m7, m7b5, dim7
                            [0,4,7,11],[0,3,7,11],                      // maj7, mMaj7
                        ];
                        let isChordMember = false;
                        // (A) Try otherPCs as root — triads only
                        for (const rootPC of otherPCs) {
                            for (const tmpl of triadTemplates) {
                                const members = tmpl.map(iv => (rootPC + iv) % 12);
                                if (members.includes(prepPC) && otherPCs.every(pc => members.includes(pc))) {
                                    isChordMember = true; break;
                                }
                            }
                            if (isChordMember) break;
                        }
                        // (B) Try prepPC as root — triads + 7ths
                        if (!isChordMember) {
                            const allTemplates = [...triadTemplates, ...seventhTemplates];
                            for (const tmpl of allTemplates) {
                                const members = tmpl.map(iv => (prepPC + iv) % 12);
                                if (otherPCs.every(pc => members.includes(pc))) {
                                    isChordMember = true; break;
                                }
                            }
                        }
                        if (isChordMember) continue; // not a suspension — skip
                    }
                }

                const suspPayload = {
                    type: displayType || 'susp', fromAbsBeat: b.absBeat,
                    resolvedById: resolved.id, fromNum, toNum,
                    resolvedMidi: resolved.midi,
                    resolvedPitch: (resolved as any).pitch,
                    resolvedOctave: (resolved as any).octave,
                    resolvedAccidental: (resolved as any).accidental ?? '',
                };
                (prep as any).isSuspension = suspPayload;
                try {
                    if (S && S.id && prep.id && S.id !== prep.id) {
                        (S as any).isSuspension = suspPayload;
                    }
                } catch { /* ignore */ }
                // Clear any passing/ornament flags on involved notes
                if ((prep as any).isPassing) (prep as any).isPassing = false;
                if ((S as any).isPassing) (S as any).isPassing = false;
                if ((resolved as any).isPassing) (resolved as any).isPassing = false;
                const isChordToneAtAbsBeat = (note: any, abs: number): boolean => {
                    try {
                        if (!note || note.isRest) return false;
                        const evHere = (chordEvents || []).find((e: any) => typeof e?.absBeat === 'number' && Math.abs(e.absBeat - abs) < 1e-6);
                        const notesHere = (evHere?.notes || []).filter((nn: any) => nn && !nn.isRest) as any[];
                        if (notesHere.length < 3) return false;
                        const cands = identifyChordCandidates(notesHere as any);
                        const best = (cands && cands.length) ? (cands as any[])[0] : null;
                        const matchType = (best as any)?.matchType;
                        const chordType = String(best?.type || '');
                        const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                        const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                        if (!confident || isSusLike || !best?.root || !best?.type) return false;

                        const rootPc = mod12((best.root as any)?.noteIndex ?? mod12((best.root as any)?.midi ?? 0));
                        const notePc = mod12((note as any)?.noteIndex ?? mod12((note as any)?.midi ?? 0));
                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                        if (!Array.isArray(formula) || !formula.length) return false;
                        const rel = mod12(notePc - rootPc);
                        return rel === 0 || formula.includes(rel);
                    } catch {
                        return false;
                    }
                };

                try {
                    const clearOrn = (n: any) => {
                        if (!n) return;
                        if (n.isNeighbor) n.isNeighbor = false;
                        if (n.isAnticipation) n.isAnticipation = false;
                        if (n.isAppoggiatura) n.isAppoggiatura = false;
                        if (n.isEscape) n.isEscape = false;
                        if (n.ornamentMark) delete n.ornamentMark;
                    };
                    clearOrn(prep as any);
                    clearOrn(S as any);
                    clearOrn(resolved as any);
                } catch { /* ignore */ }

                // If the suspended pitch is re-articulated between the suspension onset and the
                // resolution (common with repeated 8ths/16ths), treat those notes as part of the
                // suspension so they don't get misclassified as passing notes and draw extra lines.
                try {
                    const clearOrn = (n: any) => {
                        if (!n) return;
                        if (n.isNeighbor) n.isNeighbor = false;
                        if (n.isAnticipation) n.isAnticipation = false;
                        if (n.isAppoggiatura) n.isAppoggiatura = false;
                        if (n.isEscape) n.isEscape = false;
                        if (n.ornamentMark) delete n.ornamentMark;
                    };

                    const suspensionPc = mod12(prep.midi ?? 0);
                    const resolutionPc = mod12(resolved.midi ?? 0);
                    const resolvedStart = getNoteStart(resolved);
                    const vLine = notesByVoice[v] || [];
                    const isWeakBeatNumber = (beat: number) => {
                        try {
                            // Conservative: in 4/4 treat beats 1 and 3 as strong; otherwise only 1.
                            if (Math.abs(beat - 1) < 1e-6) return false;
                            if (Math.abs(beatsPerMeasure - 4) < 1e-6 && Math.abs(beat - 3) < 1e-6) return false;
                            return true;
                        } catch {
                            return true;
                        }
                    };

                    for (let idx = 0; idx < vLine.length; idx++) {
                        const n = vLine[idx];
                        const ns = getNoteStart(n);
                        if (!(ns > b.absBeat + 1e-6 && ns < resolvedStart - 1e-6)) continue;
                        if (!Number.isFinite((n as any).midi)) continue;
                        const ndur = getNoteEnd(n) - ns;

                        const nPc = mod12(n.midi ?? 0);
                        const prevN = idx > 0 ? vLine[idx - 1] : null;
                        const nextN = idx + 1 < vLine.length ? vLine[idx + 1] : null;

                        // (A) Re-articulation of the suspended pitch: treat as suspension continuation.
                        if (nPc === suspensionPc && ndur <= 1.01) {
                            (n as any).isSuspension = { type: displayType || 'susp', fromAbsBeat: b.absBeat, resolvedById: resolved.id, fromNum, toNum, continuation: true };
                            if ((n as any).isPassing) (n as any).isPassing = false;
                            clearOrn(n as any);
                            continue;
                        }

                        // (B) Short note between two occurrences of the suspended pitch (e.g. F–G–F)
                        // within the suspension span: treat as an ornament so it doesn't spawn
                        // a harmony label (like I6 at beat 2) or add a passing-line overlay.
                        if (ndur <= ORNAMENT_DUR + 1e-6 && prevN && nextN) {
                            const prevPc = Number.isFinite((prevN as any).midi) ? mod12(prevN.midi ?? 0) : null;
                            const nextPc = Number.isFinite((nextN as any).midi) ? mod12(nextN.midi ?? 0) : null;
                            if (prevPc === suspensionPc && nextPc === suspensionPc) {
                                const stepIn = Math.abs((n.midi ?? 0) - (prevN.midi ?? 0)) <= 2;
                                const stepOut = Math.abs((nextN.midi ?? 0) - (n.midi ?? 0)) <= 2;
                                const weak = isWeakBeatNumber((n.beat ?? 1) as number);
                                if (stepIn && stepOut && weak) {
                                    if (_isHarmOverrideBeat(n)) continue;
                                    (n as any).isNeighbor = true;
                                    (n as any).ornamentMark = 'v';
                                    if ((n as any).isPassing) (n as any).isPassing = false;
                                }
                            }
                        }

                        // (C) Weak-beat ornament just before the resolution (e.g. F (susp) -> D (orn) -> E (res)).
                        // This shows up as a "nota di volta inferiore" / lower appoggiatura-like figure
                        // that can be consonant in the verticality (so generic ornament detectors may skip it),
                        // but pedagogically we want it treated as ornamental inside the suspension span.
                        if (prevN && nextN) {
                            const nextStart = getNoteStart(nextN);
                            const nextPc = Number.isFinite((nextN as any).midi) ? mod12(nextN.midi ?? 0) : null;
                            const prevPc = Number.isFinite((prevN as any).midi) ? mod12(prevN.midi ?? 0) : null;

                            const weak = isWeakBeatNumber((n.beat ?? 1) as number);
                            const shortish = ndur <= 1.01;
                            const resolvesToR = Math.abs(nextStart - resolvedStart) < 1e-6 && nextPc === resolutionPc;
                            const stepOut = resolvesToR && Math.abs((nextN.midi ?? 0) - (n.midi ?? 0)) <= 2;
                            const leapInFromSusp = (prevPc === suspensionPc) && (Math.abs((n.midi ?? 0) - (prevN.midi ?? 0)) > 2);

                            if (weak && shortish && stepOut && leapInFromSusp) {
                                // If this note is actually a chord tone at its onset (e.g., delayed chord member),
                                // keep it harmonic (don't tag as neighbor inside the suspension span).
                                if (isChordToneAtAbsBeat(n as any, ns)) {
                                    continue;
                                }
                                if (_isHarmOverrideBeat(n)) continue;
                                (n as any).isNeighbor = true;
                                (n as any).ornamentMark = 'v';
                                if ((n as any).isPassing) (n as any).isPassing = false;
                            }
                        }
                    }
                } catch { /* ignore */ }

                debugLog('[ANALYSIS] mark-suspension (strict)', { prepId: prep.id, sId: S.id, resolvedId: resolved.id, originStart, bAbs: b.absBeat });

                connections.push({ type: 'horizontal', noteId1: prep.id, noteId2: resolved.id, severity: 'exception', ruleId: `S-strict` });
            }
        }
    }

    // First classify common ornaments (neighbor/appoggiatura/etc.) so suspension detection can
    // ignore ornamental notes when determining whether harmony changed under a held note.
    try {
        detectOrnaments(notesByVoice, chordEvents as ChordEvent[], beatsPerMeas);
    } catch (err) {
        console.warn('[ANALYSIS] detectOrnaments failed', err);
    }

    // Then detect suspensions (ritardi). Passing-note detection runs after and should not override suspensions.
    try {
        detectSuspensions(notesByVoice, chordEvents as ChordEvent[], beatsPerMeas);
    } catch (err) {
        console.warn('[ANALYSIS] detectSuspensions failed', err);
    }

    try {
        detectPassingNotes(notesByVoice, chordEvents as ChordEvent[], beatsPerMeas);
    } catch (err) {
        console.warn('[ANALYSIS] detectPassingNotes failed', err);
    }

    _pmark('08-suspensionDetector');
    // =========================================================
    // Chord-function rules for classical chorale context
    // =========================================================
    try {
        const getLowestNote = (ev: ChordEvent): StaffNote | null => {
            try {
                const sorted = (ev.notes || [])
                    .filter(n => n && !(n as any).isRest)
                    .filter(n => Number.isFinite((n as any).midi))
                    .slice(0, 4)
                    .slice()
                    .sort((a, b) => ((a as any).midi ?? 0) - ((b as any).midi ?? 0));
                return sorted.length ? (sorted[0] as any) : null;
            } catch {
                return null;
            }
        };

        const addResolutionConnection = (
            a: ChordEvent,
            b: ChordEvent,
            ruleId: string,
            severity: 'error' | 'warning' | 'exception'
        ) => {
            const aBass = getLowestNote(a);
            const bBass = getLowestNote(b);
            if (!aBass?.id || !bBass?.id || aBass.id === bBass.id) return;

            const already = connections.some(c =>
                c.ruleId === ruleId &&
                c.type === 'horizontal' &&
                c.noteId1 === aBass.id &&
                c.noteId2 === bBass.id
            );
            if (already) return;

            connections.push({
                type: 'horizontal',
                noteId1: aBass.id,
                noteId2: bBass.id,
                severity,
                ruleId,
            });
        };

        const withEndpoints = (ids: string[], aId?: string | null, bId?: string | null) => {
            const out: string[] = [];
            const push = (x?: string | null) => {
                if (!x) return;
                if (!out.includes(x)) out.push(x);
            };
            push(aId);
            push(bId);
            for (const id of (ids || [])) push(id);
            return out;
        };

        const notesForRomanAt = (ev: ChordEvent) => {
            const absBeat = Number(ev?.absBeat);
            const notes = (ev?.notes || []) as any[];
            if (!Number.isFinite(absBeat) || notes.length === 0) return notes;
            const resolutionSubs: any[] = [];
            const filtered = notes.filter((n) => {
                try {
                    // Exclude notes with manual ornament override (non-structural)
                    // so they don't distort Roman numeral / figured bass labels.
                    if (n?.ornamentOverride && n.ornamentOverride !== 'structural') return false;
                    // Exclude auto-detected ornamental notes (passing, neighbor, etc.)
                    // For appoggiaturas, look up the resolution (next note in the
                    // same voice) and include it as a substitute so that the
                    // chord-ID sees the correct pitch.
                    if (n?.isPassing || n?.isNeighbor || n?.isAppoggiatura || n?.isAnticipation || n?.isEscape) {
                        if (n.isAppoggiatura && n.voice) {
                            const vLine = notesByVoice[n.voice as Voice] || [];
                            const idx = vLine.indexOf(n);
                            if (idx >= 0 && idx < vLine.length - 1) {
                                const nxt = vLine[idx + 1] as any;
                                if (nxt && !nxt.isRest && Number.isFinite(nxt.midi)) {
                                    resolutionSubs.push(nxt);
                                }
                            }
                        }
                        return false;
                    }
                    // If a note is explicitly marked as a suspension *starting at this scanpoint*,
                    // treat it as a non-chord tone for the purpose of naming the underlying harmony.
                    const s = n?.isSuspension;
                    if (!s || typeof s.fromAbsBeat !== 'number') return true;
                    return Math.abs((s.fromAbsBeat as number) - absBeat) > 1e-6;
                } catch {
                    return true;
                }
            });
            // Append resolution substitutes (avoid duplicates if the resolution
            // is already present in the filtered set).
            if (resolutionSubs.length > 0) {
                const existingIds = new Set(filtered.map((n: any) => n?.id));
                for (const sub of resolutionSubs) {
                    if (!existingIds.has(sub.id)) {
                        filtered.push(sub);
                        existingIds.add(sub.id);
                    }
                }
            }
            // When all notes at a beat are ornamental, let the chord shrink below 2
            // so getRomanAnalysis returns null and no spurious Roman label appears.
            return filtered;
        };

        // Helper: roman at an event under the active context.
        const romanAt = (ev: ChordEvent) => {
            const c = getContextAtAbsBeat(ev.absBeat);
            return getRomanAnalysis(notesForRomanAt(ev), c.tonic, c.isMinor)?.roman ?? '';
        };

        // Helper: figured bass at an event.
        const figuresAt = (ev: ChordEvent) => {
            return computeFiguredBassFromNotes(notesForRomanAt(ev), FIGURED_BASS_UI_OPTIONS).figures;
        };

        // Suspensions are stored on the preparation note object (`isSuspension.fromAbsBeat` is
        // the onset of the dissonance). Because chordEvents collapse to 1 note per voice, the
        // suspended note might not be present in `ev.notes` even though it exists in analyzedNotes.
        const hasSuspensionStartAt = (absBeat: number): boolean => {
            try {
                return (analyzedNotes || []).some((n: any) => {
                    const s = n?.isSuspension;
                    return s && typeof s.fromAbsBeat === 'number' && Math.abs((s.fromAbsBeat as number) - absBeat) < 1e-3;
                });
            } catch {
                return false;
            }
        };

        for (let i = 0; i < chordEvents.length - 1; i++) {
            const a = chordEvents[i];
            const b = chordEvents[i + 1];

            // ROTTURA DIDATTICA
            if (doubleBarlineMeasures && doubleBarlineMeasures.length > 0) {
                if (a.measureIndex !== b.measureIndex && doubleBarlineMeasures.includes(a.measureIndex)) continue;
            }

            const aRoman = romanAt(a);
            const bRoman = romanAt(b);

            const aBass = getLowestNote(a);
            const bBass = getLowestNote(b);

            // Neapolitan resolution check (R-N-RES) is performed later, after inferred contexts
            // are materialized, so it can use the best available context (manual + inferred).

            // Augmented sixth chords: It+/Fr+/Ger+ should resolve to V.
            if (aRoman === 'It+' || aRoman === 'Fr+' || aRoman === 'Ger+' || aRoman === 'Sw+') {
                const ok = bRoman.toLowerCase().startsWith('v');
                if (!ok) {
                    addViolation({
                        ruleId: 'R-AUG6-RES',
                        severity: 'warning',
                        description: `Risoluzione atipica di ${aRoman}`,
                        suggestion: 'Le seste aumentate tendono a risolvere verso l’accordo di dominante (V).',
                        noteIds: withEndpoints((a.notes || []).slice(0, 4).map(n => n.id), aBass?.id, bBass?.id),
                    });
                    addResolutionConnection(a, b, 'R-AUG6-RES', 'warning');
                }
            }

            // ── CHROM-AUG6-VAR: chromatic leading-tone variants of Aug6 ──
            if (aRoman === 'It+' || aRoman === 'Fr+' || aRoman === 'Ger+' || aRoman === 'Sw+') {
                try {
                    const ctx = getContextAtAbsBeat(a.absBeat);
                    const rFull = getRomanAnalysis(notesForRomanAt(a), ctx.tonic, ctx.isMinor);
                    if (rFull?.aug6Variants?.length) {
                        const varLabels: Record<string, string> = {
                            '8x': 'ottava più che eccedente (8x)',
                            '5x': 'quinta più che eccedente (5x)',
                            '3+': 'terza eccedente (3+)',
                        };
                        const desc = rFull.aug6Variants.map(v => varLabels[v] || v).join(', ');
                        const varDetailLines: string[] = [];
                        if (rFull.aug6Variants.includes('8x')) varDetailLines.push('— 8x (ottava più che eccedente): risolve sulla 3a maggiore dell\'accordo di arrivo. Disponibile solo in tonalità maggiore.');
                        if (rFull.aug6Variants.includes('5x')) varDetailLines.push('— 5x (quinta più che eccedente): risolve sulla 7a maggiore dell\'accordo di arrivo. Posizione preferita: soprano.');
                        if (rFull.aug6Variants.includes('3+')) varDetailLines.push('— 3+ (terza eccedente): risolve sulla 5a dell\'accordo di arrivo.');
                        addViolation({
                            ruleId: 'CHROM-AUG6-VAR',
                            severity: 'chromatic',
                            description: `♭II ${aRoman} — Sesta aumentata con ${desc}\n`
                                + `Rilevato accordo di sesta aumentata contenente note con intervallo eccedente o più che eccedente rispetto alla fondamentale. `
                                + `Queste note non appartengono alla struttura tradizionale delle seste aumentate (Italiana, Francese, Tedesca) ma svolgono una funzione cromatica precisa: ciascuna agisce come sensibile individuale, tendendo a risolvere per semitono ascendente su una nota specifica dell'accordo di destinazione.\n\n`
                                + `ℹ️ Funzione armonico-cromatica: L'accordo che ne risulta è un aggregato di attrazioni semitonali convergenti — ogni nota alterata "punta" per moto cromatico alla nota corrispondente dell'accordo successivo. Questo meccanismo amplia la forza risolutiva della sesta aumentata ben oltre la coppia tradizionale basso/sesta, trasformando l'intero accordo in un fascio di tensioni direzionali. L'effetto è una risoluzione particolarmente intensa e cromaticamente ricca, tipica dell'armonia tardo-romantica e dell'armonia moderna.\n\n`
                                + `Alterazioni rilevate:\n`
                                + varDetailLines.join('\n')
                                + `\n\nQueste alterazioni possono comparire singolarmente o in combinazione. Con quattro voci a disposizione, l'inclusione di ciascuna alterazione richiede l'omissione di un'altra nota dell'accordo base.`,
                            suggestion: '⚠️ Nota Tecnica: Il riconoscimento avviene come post-processing su un accordo già classificato come sesta aumentata. Il motore verifica la presenza di intervalli a 14 semitoni (8x), 9 semitoni (5x) o 5 semitoni (3+) dal basso, con controllo di non-conflitto. La label e le figure vengono renderizzate in colore viola per distinguere l\'accordo dagli accordi tradizionali. L\'accordo non genera warning né errori — è un riconoscimento informativo di armonia cromatica funzionale.',
                            noteIds: (a.notes || []).slice(0, 4).map(n => n.id),
                        });
                    }
                } catch { /* ignore */ }
            }

            // Cadential 6/4 heuristic: I(6/4) over V bass should resolve to V.
            // (We detect this by figures containing 6 and 4, and bass at dominant pitch-class.)
            const figsA = figuresAt(a);
            if (figsA.includes('6') && figsA.includes('4')) {
                // If the apparent 6/4 is created by a suspension (e.g., a 4-3 over V),
                // the Roman/figures can look like 6/4 even though the intended analysis
                // is a suspension. In that case, don't apply the cadential-6/4 resolution rule.
                if (hasSuspensionStartAt(a.absBeat)) {
                    continue;
                }

                const ctx = getContextAtAbsBeat(a.absBeat);
                const tonicIdx = noteNameToIndex[ctx.tonic];
                const tonicPcLocal = Number.isFinite(tonicIdx) ? tonicIdx : tonicPc;
                const dominantPc = mod12(tonicPcLocal + 7);
                const bass = pickPreferredBassNote((a.notes || []) as any) || (a.notes || [])[0];
                const bassPc = bass ? mod12(bass.midi) : null;
                // Cadential 6/4 is (tonic 6/4) over the dominant bass.
                // Don't treat generic 6/4 sonorities over V-bass (incl. suspensions) as cadential.
                const looksCad64 = bassPc === dominantPc && aRoman.toLowerCase().startsWith('i');
                if (looksCad64) {
                    const ok = bRoman.toLowerCase().startsWith('v');
                    if (!ok) {
                        addViolation({
                            ruleId: 'R-CAD64',
                            severity: 'warning',
                            description: '6/4 cadenziale non risolto su V',
                            suggestion: 'Il 6/4 “cadenziale” (sopra il basso di dominante) tende a risolvere su V.',
                            noteIds: withEndpoints((a.notes || []).slice(0, 4).map(n => n.id), aBass?.id, bBass?.id),
                        });
                        addResolutionConnection(a, b, 'R-CAD64', 'warning');
                    }
                }
            }
        }

    _pmark('09a-chordFuncRules');
        // ---------------------------------------------------------
        // Cadence markers (informative)
        // ---------------------------------------------------------
        // These are emitted as `exception` so they act as neutral/positive markers
        // in the panel and as dashed overlays (bass→bass) on the staff.
        const isCadenceBoundary = (a: ChordEvent, b: ChordEvent) => {
            // Chord events are built from note start/end scan points, so the "last"
            // harmonic event of a measure does not necessarily land exactly on the last beat.
            // We key off the measure transition instead: consecutive events where `b` is the
            // first event of the next measure (downbeat).
            const downbeat = Math.abs(b.beat - 1) <= 1e-3;
            const nextMeasure = b.measureIndex === (a.measureIndex + 1);
            return nextMeasure && downbeat && b.absBeat > a.absBeat;
        };

        const chordRootPcAndBassPc = (ev: ChordEvent): { rootPc: number | null; bassPc: number | null; isRootPosition: boolean } => {
            try {
                const chordInfo = identifyChord(ev.notes || []);
                const rootPc = chordInfo?.root ? mod12(pitchClassOf(chordInfo.root as any)) : null;
                const bass = getLowestNote(ev);
                const bassPc = bass ? mod12(pitchClassOf(bass as any)) : null;
                const isRootPosition = rootPc !== null && bassPc !== null && rootPc === bassPc;
                return { rootPc, bassPc, isRootPosition };
            } catch {
                return { rootPc: null, bassPc: null, isRootPosition: false };
            }
        };

        const markCadence = (ruleId: string, description: string, suggestion: string, a: ChordEvent, b: ChordEvent) => {
            const aBass = getLowestNote(a);
            const bBass = getLowestNote(b);
            if (!aBass?.id || !bBass?.id) return;

            const aS = a.byVoice.get(1);
            const bS = b.byVoice.get(1);
            addViolation({
                ruleId,
                severity: 'exception',
                description,
                suggestion,
                noteIds: withEndpoints([aS?.id, bS?.id].filter(Boolean) as string[], aBass.id, bBass.id),
            });
            addResolutionConnection(a, b, ruleId, 'exception');
        };

        const isVLike = (roman: string) => (roman || '').toLowerCase().startsWith('v');
        // IMPORTANT: do not treat "IV" as "I" ("iv" starts with "i").
        // `romanAt(...)` returns the numeral (figures are separate), so exact match is safe.
        const isILike = (roman: string) => (roman || '').toLowerCase() === 'i';
        const isIVLike = (roman: string) => (roman || '').toLowerCase() === 'iv';

        for (let i = 0; i < chordEvents.length - 1; i++) {
            const a = chordEvents[i];
            const b = chordEvents[i + 1];

            // ROTTURA DIDATTICA
            if (doubleBarlineMeasures && doubleBarlineMeasures.length > 0) {
                if (a.measureIndex !== b.measureIndex && doubleBarlineMeasures.includes(a.measureIndex)) continue;
            }

            if (!isCadenceBoundary(a, b)) continue;

            const aRoman = romanAt(a);
            const bRoman = romanAt(b);
            if (!aRoman || !bRoman) continue;

            const ctx = getContextAtAbsBeat(b.absBeat);
            const tonicIdx = noteNameToIndex[ctx.tonic];
            const tonicPcLocal = Number.isFinite(tonicIdx) ? tonicIdx : tonicPc;
            const dominantPcLocal = mod12(tonicPcLocal + 7);

            // PAC / IAC: V -> I at a barline.
            if (isVLike(aRoman) && isILike(bRoman)) {
                const aInfo = chordRootPcAndBassPc(a);
                const bInfo = chordRootPcAndBassPc(b);
                const bS = b.byVoice.get(1);
                const sopranoOnTonic = bS ? (mod12(bS.midi) === tonicPcLocal) : false;

                const vRootPos = aInfo.isRootPosition && aInfo.rootPc === dominantPcLocal;
                const iRootPos = bInfo.isRootPosition && bInfo.rootPc === tonicPcLocal;

                if (vRootPos && iRootPos && sopranoOnTonic) {
                    markCadence(
                        'CAD-PAC',
                        'Cadenza autentica perfetta (PAC)',
                        'Cadenze\n'
                        + '• Cadenza Perfetta (V-I): Si realizza quando entrambi gli accordi sono in stato fondamentale. Per ottenere il massimo senso di conclusione, la tonica deve trovarsi al soprano.\n'
                        + '\n'
                        + 'Rilevamento: V(7)→I con entrambi in stato fondamentale e soprano sulla tonica all’arrivo.',
                        a,
                        b
                    );
                } else {
                    markCadence(
                        'CAD-IAC',
                        'Cadenza autentica imperfetta (IAC)',
                        'Cadenze\n'
                        + '• Cadenza Imperfetta: È un collegamento V-I dove uno o entrambi gli accordi si presentano in stato di rivolto. Offre un senso di riposo solo parziale, adatto a collegare frasi interne.\n'
                        + '\n'
                        + 'Rilevamento: V(7)→I, ma manca almeno una condizione della PAC (soprano non su tonica e/o inversione).',
                        a,
                        b
                    );
                }
                continue;
            }

            // Plagal: IV -> I at a barline.
            if (isIVLike(aRoman) && isILike(bRoman)) {
                markCadence(
                    'CAD-PLAG',
                    'Cadenza plagale (Plagal)',
                    'Marker informativo: IV→I.',
                    a,
                    b
                );
                continue;
            }

            // Half cadence: anything -> V at a barline.
            if (isVLike(bRoman) && !isVLike(aRoman)) {
                const bBass = getLowestNote(b);
                const bBassIsDominant = bBass ? (bBass.noteIndex === dominantPcLocal) : false;
                if (!bBassIsDominant) continue;
                markCadence(
                    'CAD-HC',
                    'Semicadenza (HC)',
                    'Cadenze\n'
                    + '• Semicadenza: La frase si arresta sull\'accordo di dominante (V grado). Funziona come un punto di sospensione che genera l\'aspettativa di una prosecuzione.\n'
                    + '\n'
                    + 'Rilevamento: arrivo su V alla stanghetta (cadenza sospesa).',
                    a,
                    b
                );
                continue;
            }
        }

        // ── Picardy third (Terza Piccarda) ──
        // If the piece is in minor mode and the very last chord event is a major
        // triad on the tonic, mark it as CAD-PIC.  The Picardy third often
        // co-occurs with a PAC/IAC/PLAG cadence, so this marker is additive.
        if (isMinor && chordEvents.length >= 2) {
            // Find the last chordEvent that actually has notes.
            let lastEvIdx = chordEvents.length - 1;
            while (lastEvIdx >= 1 && chordEvents[lastEvIdx].byVoice.size === 0) lastEvIdx--;
            if (lastEvIdx >= 1) {
                const lastEv = chordEvents[lastEvIdx];
                const prevEv = chordEvents[lastEvIdx - 1];
                try {
                    const lastPcs = new Set<number>();
                    let lastBassMidi = Infinity;
                    let lastBassPc = -1;
                    for (const [, n] of lastEv.byVoice) {
                        if (!n) continue;
                        const pc = mod12(n.midi);
                        lastPcs.add(pc);
                        if (n.midi < lastBassMidi) { lastBassMidi = n.midi; lastBassPc = pc; }
                    }
                    if (lastBassPc === tonicPc && lastPcs.size >= 3
                        && lastPcs.has(tonicPc)
                        && lastPcs.has(mod12(tonicPc + 4))
                        && lastPcs.has(mod12(tonicPc + 7))) {
                        markCadence(
                            'CAD-PIC',
                            'Terza Piccarda: conclusione su I maggiore in tonalità minore',
                            'Cadenze\n'
                            + '• Terza Piccarda: L\'ultimo accordo del brano in minore presenta la terza alzata, '
                            + 'trasformando il i minore in I maggiore. Pratica comune nel Barocco e Classico (es. Bach).\n'
                            + '\n'
                            + 'Rilevamento: ultimo accordo = triade maggiore sulla tonica in tonalità minore.',
                            prevEv,
                            lastEv
                        );
                    }
                } catch { /* ignore */ }
            }
        }

    _pmark('09b-cadenceMarkers');
        // ---------------------------------------------------------
        // Auto key-context inference (tonicization/modulation)
        // ---------------------------------------------------------
    _pmark('09c-start-keyContextInference');
        // Goal: infer a local tonic at a barline when we see a strong dominant→tonic root motion,
        // and the following measure is more diatonic under that candidate than under the current context.
        if (ENABLE_INFERRED_ANALYSIS_CONTEXTS) try {
            const beatsPerMeasLocal = safeBeatsPerMeasure(timeSignature);
            const preferFlats = (() => {
                try {
                    return String(keyTonic || '').includes('b') || (FLAT_KEY_COUNTS as any)[String(keyTonic || '')] != null;
                } catch {
                    return true;
                }
            })();

            const pcToKeyName = (pc: number): string => {
                const names = (ALL_NOTE_SPELLINGS as any)[mod12(pc)] as string[] | undefined;
                if (!Array.isArray(names) || names.length === 0) return 'C';
                if (preferFlats) {
                    const flat = names.find(n => String(n).includes('b'));
                    if (flat) {
                        return flat;
                    }
                } else {
                    const sharp = names.find(n => String(n).includes('#'));
                    if (sharp) {
                        // Avoid theoretical extreme key spellings as inferred tonal centers.
                        if (sharp === 'B#') return 'C';
                        if (sharp === 'E#') return 'F';
                        return sharp;
                    }
                }
                const natural = names.find(n => !String(n).includes('b') && !String(n).includes('#'));
                return natural || names[0];
            };

            const diatonicSetForKey = (tonicName: string, minorMode: boolean): Set<number> => {
                const idx = noteNameToIndex[String(tonicName || '')];
                const tonicPcX = Number.isFinite(idx) ? mod12(idx) : 0;
                // For inference we want a *tonal* notion of minor: allow the raised leading tone.
                // Using pure natural minor here makes V (with #7) look “chromatic” and can cause
                // false positives where the scanner flips to the dominant key (e.g. Bm → Gb/F#).
                // We therefore allow both ♭7 and ♮7 as diatonic for fit-scoring.
                const ivs = minorMode
                    ? [0, 2, 3, 5, 7, 8, 10, 11] // natural + harmonic leading tone
                    : [0, 2, 4, 5, 7, 9, 11];
                return new Set(ivs.map(v => mod12(tonicPcX + v)));
            };

            const countNonDiatonicPcsInEvents = (events: ChordEvent[], tonicName: string, minorMode: boolean): number => {
                try {
                    const diatonic = diatonicSetForKey(tonicName, minorMode);
                    if (!diatonic.size) return Number.POSITIVE_INFINITY;
                    const pcs = new Set<number>();
                    for (const ev of events || []) {
                        for (const n of (ev?.notes || []) as any[]) {
                            if (!n || (n as any).isRest) continue;
                            // Skip ornamental notes (manual override + auto-detected)
                            if ((n as any).ornamentOverride && (n as any).ornamentOverride !== 'structural') continue;
                            if ((n as any).isPassing || (n as any).isNeighbor || (n as any).isAppoggiatura || (n as any).isAnticipation || (n as any).isEscape) continue;
                            pcs.add(mod12(pitchClassOf(n as any)));
                        }
                    }
                    let out = 0;
                    for (const pc of pcs) if (!diatonic.has(pc)) out++;
                    return out;
                } catch {
                    return Number.POSITIVE_INFINITY;
                }
            };

            // Spelling-aware penalty: count how many *user-spelled* accidentals contradict
            // the candidate key signature. This helps prevent enharmonic key flips driven
            // by pitch-class-only fits (especially with diminished chords).
            const countSpellingMismatchesInEvents = (events: ChordEvent[], tonicName: string, minorMode: boolean): number => {
                try {
                    const ks = getKeySignature(tonicName, minorMode ? 'Minor' : 'Major');
                    if (!ks || typeof ks.type !== 'string' || !Number.isFinite(Number((ks as any).count))) return 0;
                    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, ks.type === 'sharp' ? ks.count : 0);
                    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, ks.type === 'flat' ? ks.count : 0);
                    const keyAccidentals = ks.type === 'sharp'
                        ? sharpNotes.map(n => n + '#')
                        : flatNotes.map(n => n + 'b');

                    const accToSym = (acc: any): string => {
                        const a = String(acc || '');
                        if (a === 'sharp' || a === '#') return '#';
                        if (a === 'flat' || a === 'b') return 'b';
                        if (a === 'natural') return '';
                        return '';
                    };

                    const hasExplicitSpelling = (n: any): boolean => {
                        if (!n) return false;
                        if ((n as any).userAccidental != null) return true;
                        if ((n as any).explicitAccidental != null) return true;
                        const p = String((n as any).pitch || '');
                        return p.includes('b') || p.includes('#');
                    };

                    const spelledName = (n: any): string | null => {
                        try {
                            const p0 = String((n as any).pitch || '').trim();
                            if (!p0) return null;
                            const letter = p0.charAt(0).toUpperCase();
                            const accRaw = (n as any).userAccidental ?? (n as any).explicitAccidental ?? (n as any).accidental ?? null;
                            const sym = accToSym(accRaw);
                            // If pitch string already includes an accidental and the explicit acc is missing,
                            // keep the pitch spelling.
                            if (!sym && (p0.includes('b') || p0.includes('#'))) {
                                return p0;
                            }
                            return `${letter}${sym}`;
                        } catch {
                            return null;
                        }
                    };

                    let mismatches = 0;
                    for (const ev of events || []) {
                        for (const n of (ev?.notes || []) as any[]) {
                            if (!n || (n as any).isRest) continue;

                            // Spelling-first guardrail (implicit naturals):
                            // If the candidate key signature alters a letter (e.g. A# in B major)
                            // but the note appears as the *natural* pitch-class for that letter
                            // with no explicit accidental, then accepting the candidate would
                            // require an unmarked natural sign. Penalize it to prevent spurious
                            // sharp/flat key flips driven by pitch-class-only fits.
                            try {
                                if (!hasExplicitSpelling(n)) {
                                    const p0 = String((n as any).pitch || '').trim();
                                    const letter = p0 ? p0.charAt(0).toUpperCase() : '';
                                    if (letter && /^[A-G]$/.test(letter)) {
                                        const expectedAcc = ks.type === 'sharp'
                                            ? (sharpNotes.includes(letter) ? '#' : '')
                                            : (flatNotes.includes(letter) ? 'b' : '');
                                        if (expectedAcc) {
                                            const expectedName = `${letter}${expectedAcc}`;
                                            const expectedIdx = (noteNameToIndex as any)[expectedName];
                                            const expectedPc = Number.isFinite(expectedIdx) ? mod12(Number(expectedIdx)) : null;
                                            const actualPc = mod12(pitchClassOf(n as any));
                                            if (expectedPc != null && expectedPc !== actualPc) {
                                                // Strong evidence *against* the candidate: it would
                                                // require an unmarked natural sign in the score.
                                                mismatches += 2;
                                            }
                                        }
                                    }
                                }
                            } catch { /* ignore */ }

                            if (!hasExplicitSpelling(n)) continue;
                            const name = spelledName(n);
                            if (!name) continue;
                            const needed = calculateAccidental(name, keyAccidentals);
                            if (needed != null) mismatches++;
                        }
                    }
                    return mismatches;
                } catch {
                    return 0;
                }
            };

            const keySignaturePenalty = (tonicName: string, minorMode: boolean): number => {
                try {
                    const ks = getKeySignature(tonicName, minorMode ? 'Minor' : 'Major') as any;
                    if (!ks || typeof ks.type !== 'string' || !Number.isFinite(Number(ks.count))) return 0;
                    const cnt = Math.max(0, Math.round(Number(ks.count)));
                    // Hard-avoid theoretical extremes (7 accidentals) as inferred contexts.
                    // These tend to appear via enharmonic spelling quirks and create noise
                    // in regression cases (e.g. Cb->B mapping). Gb (6 flats) is still allowed.
                    if (cnt >= 7) return 999;
                    if (preferFlats && ks.type === 'sharp' && cnt >= 3) return 1;
                    if (!preferFlats && ks.type === 'flat' && cnt >= 3) return 1;
                    return 0;
                } catch {
                    return 0;
                }
            };

            const qAbs = (x: number) => {
                try {
                    const q = 192;
                    return Math.round(Number(x) * q) / q;
                } catch {
                    return Number(x) || 0;
                }
            };

            type InferredCand = {
                absBeat: number;
                newTonic: string;
                newIsMinor: boolean;
                label: string;
                // Higher is better.
                score: number;
            };

            // Keep only the best inferred context per absBeat (barline can generate multiple chordEvents
            // with the same absBeat due to note-off/on scanpoints; we must avoid contradictory contexts).
            const bestByAbsBeat = new Map<number, InferredCand>();

            const inferredSoFar = (): AnalysisContext[] => {
                try {
                    const raw = Array.from(bestByAbsBeat.values())
                        .sort((a, b) => qAbs(a.absBeat) - qAbs(b.absBeat))
                        .map(x => {
                            let absBeat = x.absBeat;
                            try {
                                // If we are returning to the global key, prefer starting the context at the
                                // measure downbeat instead of a mid-measure scanpoint. This avoids having the
                                // downbeat harmony of the return measure labeled under the previous inferred key.
                                const isReturnToGlobal = String(x?.newTonic || '') === String(keyTonic || '')
                                    && !!x?.newIsMinor === !!isMinor;
                                if (isReturnToGlobal && Number.isFinite(absBeat)) {
                                    const m = Math.floor(absBeat / beatsPerMeasLocal);
                                    const downbeat = m * beatsPerMeasLocal;
                                    // Always snap return-to-global to the measure downbeat.
                                    // This avoids mixed labeling in the return measure and matches
                                    // the regression expectation (e.g. Bb@absBeat=108 in 3/2).
                                    absBeat = downbeat;
                                }

                                // Symmetric stabilization for *entering* a new inferred key at a barline:
                                // if the previous strong beat already spells a clear tonic (I/i) under the
                                // inferred key, start the context there to avoid showing bIII/bVI/etc. in the
                                // global key for what is effectively a tonic arrival.
                                if (!isReturnToGlobal && Number.isFinite(absBeat)) {
                                    const m = Math.floor(absBeat / beatsPerMeasLocal);
                                    const downbeat = m * beatsPerMeasLocal;
                                    const beat1 = (absBeat - downbeat) + 1;
                                    const isDownbeat = Number.isFinite(beat1) && Math.abs(beat1 - 1) <= 1e-3;
                                    if (isDownbeat) {
                                        const MAX_BACK = 2.01;
                                        const strongBeat = (b: number): boolean => {
                                            try {
                                                if (!Number.isFinite(b as any)) return false;
                                                const bb = Number(b);
                                                if (Math.abs(bb - 1) <= 1e-3) return true;
                                                const ts = timeSignature;
                                                if (!ts) return false;
                                                if (ts.denominator === 4 && ts.numerator === 4) return Math.abs(bb - 3) <= 1e-3;
                                                if (ts.denominator === 8 && ts.numerator === 6) return Math.abs(bb - 4) <= 1e-3;
                                                return false;
                                            } catch {
                                                return false;
                                            }
                                        };

                                        const hasOtherInferredNearby = Array.from(bestByAbsBeat.values()).some((y) => {
                                            if (!y || y === x) return false;
                                            const a = Number(y.absBeat);
                                            if (!Number.isFinite(a)) return false;
                                            return (a > (absBeat - MAX_BACK + 1e-6)) && (a < (absBeat - 1e-6));
                                        });

                                        if (!hasOtherInferredNearby) {
                                            let bestEarlier: { absBeat: number; beat: number; notes: any[] } | null = null;
                                            for (const ev of (chordEvents || []) as any[]) {
                                                const a = Number(ev?.absBeat);
                                                if (!Number.isFinite(a)) continue;
                                                if (!(a < absBeat - 1e-6)) continue;
                                                if (a < (absBeat - MAX_BACK - 1e-6)) continue;
                                                const b = Number(ev?.beat);
                                                if (!strongBeat(b)) continue;
                                                if (!bestEarlier || a > bestEarlier.absBeat) bestEarlier = { absBeat: a, beat: b, notes: (ev?.notes || []) as any[] };
                                            }

                                            if (bestEarlier && Number.isFinite(bestEarlier.absBeat)) {
                                                const r = String(_gRA(bestEarlier.notes || [], x.newTonic, x.newIsMinor)?.roman || '').replace(/\s+/g, '');
                                                const want = x.newIsMinor ? 'i' : 'I';
                                                if (r === want) absBeat = bestEarlier.absBeat;
                                            }
                                        }
                                    }
                                }
                            } catch {
                                // ignore
                            }
                            return {
                            absBeat,
                            newTonic: x.newTonic,
                            newIsMinor: x.newIsMinor,
                            label: x.label,
                            score: x.score,
                            source: 'inferred' as const,
                        };
                        });

                    // Post-filter: drop weak or overly-frequent inferred contexts.
                    // This reduces “spray” tonicizations on diatonic stretches.
                    const MIN_SCORE = 8;
                    const MIN_GAP = Math.max(1, beatsPerMeasLocal * 0.9);
                    const out: AnalysisContext[] = [];
                    for (const c of raw as any[]) {
                        const sc = Number(c?.score);
                        const isReturnToGlobal = String(c?.newTonic || '') === String(keyTonic || '');
                        const minScoreHere = isReturnToGlobal ? 6 : MIN_SCORE;
                        if (Number.isFinite(sc) && sc < minScoreHere) continue;
                        const prev = out.length ? out[out.length - 1] : null;
                        if (prev) {
                            const sameKey = String(prev.newTonic) === String(c.newTonic) && !!prev.newIsMinor === !!c.newIsMinor;
                            if (sameKey) continue;
                            const dt = Number(c.absBeat) - Number(prev.absBeat);
                            if (Number.isFinite(dt) && dt < MIN_GAP) {
                                // If a much stronger context appears shortly after a weaker one,
                                // prefer the stronger and drop the weaker (common at modulation pivots).
                                const prevSc = Number((prev as any)?.score);
                                if (Number.isFinite(prevSc) && Number.isFinite(sc) && sc >= (prevSc + 3)) {
                                    out[out.length - 1] = c;
                                    continue;
                                }
                                continue;
                            }
                        }
                        out.push(c);
                    }
                    return out;
                } catch {
                    return [];
                }
            };

            // During inference, treat already-inferred contexts as active so we don't
            // emit contradictory midstream key changes.
            const getContextAtAbsBeatInferred = (absBeat: number) => {
                const applicable = ([...(analysisContexts || []), ...(inferredSoFar() || [])] as AnalysisContext[])
                    .filter(c => ctxAbsBeat(c) <= absBeat + 1e-6)
                    .sort((a, b) => ctxAbsBeat(b) - ctxAbsBeat(a))[0];
                return {
                    tonic: applicable ? applicable.newTonic : keyTonic,
                    isMinor: applicable ? applicable.newIsMinor : isMinor,
                };
            };

            const isStrongBeatForInference = (beat: number): boolean => {
                // Be conservative: only allow mid-measure inference on strong beats.
                // - 4/4: beats 1 and 3
                // - 6/8: beats 1 and 4 (if the beat counter is in eighths)
                // Fallback: beat 1.
                try {
                    if (!Number.isFinite(beat as any)) return false;
                    const b = Number(beat);
                    if (Math.abs(b - 1) <= 1e-3) return true;
                    const ts = timeSignature;
                    if (!ts) return false;
                    if (ts.denominator === 4 && ts.numerator === 4) return Math.abs(b - 3) <= 1e-3;
                    if (ts.denominator === 8 && ts.numerator === 6) return Math.abs(b - 4) <= 1e-3;
                    return false;
                } catch {
                    return false;
                }
            };

            const isReturnHomeCadenceBoundary = (a: ChordEvent, b: ChordEvent): boolean => {
                try {
                    if (!b || !a) return false;
                    if (!(b.absBeat > a.absBeat)) return false;
                    if (!isStrongBeatForInference(b.beat)) return false;

                    // Only used to detect a return to the *global* key.
                    const ctxAtB = getContextAtAbsBeatInferred(b.absBeat);
                    if (String(ctxAtB.tonic || '') === String(keyTonic || '')) return false;

                    // Require a tight cadence window.
                    if ((b.absBeat - a.absBeat) > 2.01) return false;

                    // Check functional pattern under the global key.
                    const bRomanGlobal = String(_gRA(b.notes || [], keyTonic, isMinor)?.roman || '').replace(/\s+/g, '');
                    if (!(bRomanGlobal === (isMinor ? 'i' : 'I'))) return false;

                    const aRomanGlobal = String(_gRA(a.notes || [], keyTonic, isMinor)?.roman || '').replace(/\s+/g, '');
                    const aLow = aRomanGlobal.toLowerCase();
                    if (!(aLow.startsWith('v') || aLow.startsWith('vii'))) return false;

                    return true;
                } catch {
                    return false;
                }
            };

            // Minor tonicization detector: ii°6 → i (on a strong beat), followed soon by V.
            // This catches very common local-minor regions that do NOT enter on a barline tonic.
            // Example (global C): C#°6 → Bm → F#  should infer B minor at the ii°6.
            try {
                const getEventPcs = (ev: ChordEvent): number[] => {
                    try {
                        const pcs = new Set<number>();
                        for (const n of (ev?.notes || []) as any[]) {
                            if (!n || (n as any).isRest) continue;
                            pcs.add(mod12(pitchClassOf(n as any)));
                        }
                        return Array.from(pcs);
                    } catch {
                        return [] as number[];
                    }
                };

                const getPrevInWindow = (idx: number, absBeat: number, maxWin: number): ChordEvent | null => {
                    try {
                        for (let k = idx - 1; k >= 0; k--) {
                            const ev = chordEvents[k];
                            if (!ev || !Number.isFinite(ev.absBeat)) continue;
                            const dt = absBeat - Number(ev.absBeat);
                            if (dt < -1e-6) continue;
                            if (dt > maxWin + 1e-6) break;
                            return ev;
                        }
                        return null;
                    } catch {
                        return null;
                    }
                };

                const getNextInWindow = (idx: number, absBeat: number, maxWin: number): ChordEvent | null => {
                    try {
                        for (let k = idx + 1; k < chordEvents.length; k++) {
                            const ev = chordEvents[k];
                            if (!ev || !Number.isFinite(ev.absBeat)) continue;
                            const dt = Number(ev.absBeat) - absBeat;
                            if (dt < -1e-6) continue;
                            if (dt > maxWin + 1e-6) break;
                            return ev;
                        }
                        return null;
                    } catch {
                        return null;
                    }
                };

                for (let j = 0; j < chordEvents.length; j++) {
                    const b = chordEvents[j];
                    if (!b || !Number.isFinite(b.absBeat) || !isStrongBeatForInference(b.beat)) continue;

                    const pcs = getEventPcs(b);
                    if (!pcs.length) continue;

                    for (const tonicPc of pcs) {
                        const tonic = pcToKeyName(tonicPc);
                        const bRom = String(_gRA(b.notes || [], tonic, true)?.roman || '').replace(/\s+/g, '');
                        if (bRom !== 'i') continue;

                        const a = getPrevInWindow(j, Number(b.absBeat), 2.01);
                        if (!a) continue;
                        const aRes = _gRA(a.notes || [], tonic, true);
                        const aRom = String(aRes?.roman || '').replace(/\s+/g, '');
                        const aLow = aRom.toLowerCase();
                        const aLooksIio6 = aLow.startsWith('ii') && aRom.includes('°') && Array.isArray(aRes?.figures) && (aRes as any).figures.some((f: any) => extractFigureValue(String(f)) === 6);
                        if (!aLooksIio6) continue;

                        const c = getNextInWindow(j, Number(b.absBeat), 2.01);
                        if (!c) continue;
                        const cRom = String(_gRA(c.notes || [], tonic, true)?.roman || '').replace(/\s+/g, '');
                        const cLow = cRom.toLowerCase();
                        const cLooksV = cLow.startsWith('v');
                        if (!cLooksV) continue;

                        const ctxAtB0 = getContextAtAbsBeatInferred(Number(a.absBeat));
                        const windowLen = beatsPerMeasLocal;
                        const window = (chordEvents || []).filter(ev => ev.absBeat >= Number(a.absBeat) - 1e-6 && ev.absBeat < (Number(a.absBeat) + windowLen - 1e-6));
                        const currentOut = countNonDiatonicPcsInEvents(window as any, ctxAtB0.tonic, ctxAtB0.isMinor);
                        const candidateOut = countNonDiatonicPcsInEvents(window as any, tonic, true);
                        const improvement = (Number.isFinite(currentOut) && Number.isFinite(candidateOut)) ? (currentOut - candidateOut) : 0;
                        if (!(Number.isFinite(candidateOut) && candidateOut <= 1 && Number.isFinite(improvement) && improvement >= 2)) continue;

                        const score = 12 + Math.max(0, improvement) + 2; // +2 for explicit V confirmation.
                        const absKey = qAbs(Number(a.absBeat));
                        const cand: InferredCand = {
                            absBeat: Number(a.absBeat),
                            newTonic: tonic,
                            newIsMinor: true,
                            label: `[ ${tonic} min ]`,
                            score,
                        };
                        const prev = bestByAbsBeat.get(absKey);
                        if (!prev || cand.score > prev.score) bestByAbsBeat.set(absKey, cand);
                    }
                }
            } catch {
                // ignore
            }

            for (let i = 0; i < chordEvents.length - 1; i++) {
                const a = chordEvents[i];
                const b = chordEvents[i + 1];

                // ROTTURA DIDATTICA
                if (doubleBarlineMeasures && doubleBarlineMeasures.length > 0) {
                    if (a.measureIndex !== b.measureIndex && doubleBarlineMeasures.includes(a.measureIndex)) continue; 
                }

                // Default: barline-only inference. Special case: allow a strong mid-measure
                // cadence back to the global key to avoid getting stuck in a tonicized context.
                const isStrictCadenceBoundary = isCadenceBoundary(a, b);
                const isBarlineBeat = (() => {
                    try {
                        return Number.isFinite(Number(b?.beat)) && Math.abs(Number(b.beat) - 1) <= 1e-3;
                    } catch {
                        return false;
                    }
                })();

                // IMPORTANT: only infer new contexts on barlines (beat 1).
                // Mid-measure inference is allowed ONLY for returning to the global key.
                if ((!isStrictCadenceBoundary || !isBarlineBeat) && !isReturnHomeCadenceBoundary(a, b)) continue;

                const aInfo = chordRootPcAndBassPc(a);
                const bInfo = chordRootPcAndBassPc(b);
                // NOTE: do not require the *immediately previous* scanpoint to have an identifiable root.
                // Barline scanpoints can be sparse (note-offs), so we may still be able to infer a
                // cadence using a short lookback window in the candidate key.

                // Choose the best candidate tonic among the arrival chord tones.
                // This makes inference robust to occasional mis-rooting by identifyChord at sparse scanpoints.
                const bPcs = (() => {
                    try {
                        const pcs = new Set<number>();
                        if (bInfo.rootPc != null) pcs.add(mod12(bInfo.rootPc));
                        if (bInfo.bassPc != null) pcs.add(mod12(bInfo.bassPc));
                        for (const n of (b.notes || []) as any[]) {
                            if (!n || (n as any).isRest) continue;
                            pcs.add(mod12(pitchClassOf(n as any)));
                        }
                        return Array.from(pcs);
                    } catch {
                        return [] as number[];
                    }
                })();

                // Lookahead window: allow inferring a key that enters on V (or vii°) at the boundary
                // and resolves to I/i shortly after (common: V on downbeat, I on beat 3).
                // This also allows the tonic pitch-class to come from the resolution chord instead
                // of being present in the boundary chord.
                const lookaheadEvents = (() => {
                    try {
                        const out: ChordEvent[] = [];
                        const MAX = 2.01;
                        for (let t = i + 1; t < chordEvents.length; t++) {
                            const ev = chordEvents[t];
                            if (!ev || !Number.isFinite(ev.absBeat)) continue;
                            const dt = Number(ev.absBeat) - Number(b.absBeat);
                            if (dt < -1e-6) continue;
                            if (dt > MAX + 1e-6) break;
                            out.push(ev);
                        }
                        return out;
                    } catch {
                        return [] as ChordEvent[];
                    }
                })();

                const lookaheadPcs = (() => {
                    try {
                        const pcs = new Set<number>();
                        for (const ev of lookaheadEvents) {
                            for (const n of (ev?.notes || []) as any[]) {
                                if (!n || (n as any).isRest) continue;
                                pcs.add(mod12(pitchClassOf(n as any)));
                            }
                        }
                        return Array.from(pcs);
                    } catch {
                        return [] as number[];
                    }
                })();

                const candTonicPcs = Array.from(new Set<number>([...bPcs, ...lookaheadPcs]));

                const ctxAtB0 = getContextAtAbsBeatInferred(b.absBeat);
                const currentCtxIsGlobal = String(ctxAtB0.tonic || '') === String(keyTonic || '');

                type TonicCand = {
                    tonicPc: number;
                    tonic: string;
                    isMinor: boolean;
                    bRoman: string;
                    bLooksLikeTonic: boolean;
                    bIsTonicRootPos: boolean;
                    tonicIsDiatonicInCurrent: boolean;
                    aRoman: string;
                    aLooksFunctionalToTonic: boolean;
                    rootMotionIsDomToTonic: boolean;
                    requireStricter: boolean;
                    windowLen: number;
                    currentOut: number;
                    candidateOut: number;
                    score: number;
                };

                let bestCand: TonicCand | null = null;

                for (const tonicPc of candTonicPcs) {
                    const tonic = pcToKeyName(tonicPc);

                    // Determine minor/major by whether we see I/i at the boundary OR very soon after.
                    const bRomanMaj = String(_gRA(b.notes || [], tonic, false)?.roman || '').replace(/\s+/g, '');
                    const bRomanMin = String(_gRA(b.notes || [], tonic, true)?.roman || '').replace(/\s+/g, '');
                    const hasTonicSoonMaj = lookaheadEvents.some(ev => String(_gRA(ev.notes || [], tonic, false)?.roman || '').replace(/\s+/g, '') === 'I');
                    const hasTonicSoonMin = lookaheadEvents.some(ev => String(_gRA(ev.notes || [], tonic, true)?.roman || '').replace(/\s+/g, '') === 'i');

                    const pickMinor = (bRomanMin === 'i') || hasTonicSoonMin;
                    const pickMajor = (bRomanMaj === 'I') || hasTonicSoonMaj;
                    if (!pickMinor && !pickMajor) continue;

                    const isMinorCand = (() => {
                        try {
                            if (pickMinor && pickMajor) {
                                // Disambiguate by chord spelling: major vs minor third above tonic.
                                const pcs = new Set<number>();
                                for (const n of (b.notes || []) as any[]) {
                                    if (!n || (n as any).isRest) continue;
                                    pcs.add(mod12(pitchClassOf(n as any)));
                                }
                                const hasMaj3 = pcs.has(mod12(tonicPc + 4));
                                const hasMin3 = pcs.has(mod12(tonicPc + 3));
                                if (hasMaj3 && !hasMin3) return false;
                                if (hasMin3 && !hasMaj3) return true;
                                // If ambiguous, default to major (less surprising for a major triad tonic).
                                return false;
                            }
                            if (pickMinor && !pickMajor) return true;
                            if (pickMajor && !pickMinor) return false;
                            // If we only inferred via lookahead tonic hits, default to major unless
                            // minor is the only supported option.
                            if (hasTonicSoonMin && !hasTonicSoonMaj) return true;
                            if (hasTonicSoonMaj && !hasTonicSoonMin) return false;
                            return false;
                        } catch {
                            return pickMinor;
                        }
                    })();

                    const bRoman = isMinorCand ? bRomanMin : bRomanMaj;
                    const tonicTarget = isMinorCand ? 'i' : 'I';
                    const bLooksLikeTonic = bRoman === tonicTarget;

                    // If b is not I/i, still allow inference when b is dominant-function and
                    // we see a clear I/i in the lookahead window.
                    const bLow = String(bRoman || '').toLowerCase();
                    const bIsDomLike = bLow.startsWith('v') || bLow.startsWith('vii');
                    const hasTonicSoon = isMinorCand ? hasTonicSoonMin : hasTonicSoonMaj;
                    const hasTonicAfterB = (() => {
                        try {
                            return lookaheadEvents.some(ev => Number(ev?.absBeat) > Number(b.absBeat) + 1e-6
                                && String(_gRA(ev.notes || [], tonic, isMinorCand)?.roman || '').replace(/\s+/g, '') === tonicTarget);
                        } catch {
                            return false;
                        }
                    })();
                    if (!bLooksLikeTonic && !(bIsDomLike && hasTonicSoon)) continue;

                    // At barlines there can be multiple chordEvents at nearly the same time due to
                    // note-offs / re-attacks. The immediately previous event can be a sparse snapshot
                    // that mis-roots the harmony. To keep inference stable, look back a short window
                    // for the strongest functional pre-boundary harmony under the candidate key.
                    const pickPrevForCand = (() => {
                        try {
                            const MAX_WIN = 2.01;
                            let best: { ev: ChordEvent; info: { rootPc: number | null; bassPc: number | null }; roman: string; score: number } | null = null;
                            for (let k = i; k >= 0; k--) {
                                const ev = chordEvents[k];
                                if (!ev || !Number.isFinite(ev.absBeat)) continue;
                                const dt = Number(b.absBeat) - Number(ev.absBeat);
                                if (dt < -1e-6) continue;
                                if (dt > MAX_WIN + 1e-6) break;
                                const info = chordRootPcAndBassPc(ev);
                                if (info.rootPc == null) continue;
                                const roman = String(_gRA(ev.notes || [], tonic, isMinorCand)?.roman || '');
                                const r0 = String(roman || '').replace(/\s+/g, '').toLowerCase();
                                const functional = r0.startsWith('v') || r0.startsWith('vii');
                                const domToTonic = mod12(Number(info.rootPc) - tonicPc) === 7;
                                const score = (domToTonic ? 3 : 0) + (functional ? 2 : 0) + (roman.includes('/') ? 1 : 0);
                                if (!best || score > best.score) best = { ev, info, roman, score };
                            }
                            return best;
                        } catch {
                            return null;
                        }
                    })();

                    const aRoman = String((pickPrevForCand?.roman ?? _gRA(a.notes || [], tonic, isMinorCand)?.roman) || '');
                    const aLooksFunctionalToTonic = (() => {
                        const r = String(aRoman || '').replace(/\s+/g, '').toLowerCase();
                        // For inferring an actual context change, require a strong dominant pull.
                        // Predominants like ii/iv are too permissive and create false positives.
                        return r.startsWith('v') || r.startsWith('vii');
                    })();

                    const rootMotionIsDomToTonic = (() => {
                        try {
                            const srcRoot = (pickPrevForCand?.info?.rootPc != null)
                                ? Number(pickPrevForCand.info.rootPc)
                                : (aInfo.rootPc != null ? Number(aInfo.rootPc) : Number.NaN);
                            return Number.isFinite(srcRoot) && mod12(srcRoot - tonicPc) === 7;
                        } catch {
                            return false;
                        }
                    })();

                    // Trigger A (strong): dominant→tonic root motion at the barline.
                    // Trigger B (weaker): downbeat looks like tonic AND previous looks functional toward it.
                    if (!(rootMotionIsDomToTonic || aLooksFunctionalToTonic)) continue;

                    // Window length + strictness knobs.
                    // - When inferring away from the *global* key, be conservative to avoid
                    //   relabeling diatonic sequences as "modulations" (the user typically expects
                    //   secondary dominants, not context flips).
                    // - Still allow inference when the diatonic-fit improvement is strong and persistent.
                    let windowLen = currentCtxIsGlobal ? (beatsPerMeasLocal * 2) : beatsPerMeasLocal;
                    let requireStricter = false;
                    const requireVeryStrong = currentCtxIsGlobal;
                    try {
                        const ctxIdx = noteNameToIndex[String(ctxAtB0.tonic || '')];
                        const ctxPc = Number.isFinite(ctxIdx) ? mod12(ctxIdx) : null;
                        if (ctxPc != null) {
                            const domPc = mod12(ctxPc + 7);
                            if (mod12(tonicPc) === domPc && String(ctxAtB0.tonic || '') !== String(keyTonic || '')) {
                                requireStricter = true;
                                windowLen = beatsPerMeasLocal * 2;
                            }
                        }
                    } catch { /* ignore */ }

                    const window = (chordEvents || []).filter(ev => ev.absBeat >= b.absBeat - 1e-6 && ev.absBeat < (b.absBeat + windowLen - 1e-6));
                    const currentOut = countNonDiatonicPcsInEvents(window as any, ctxAtB0.tonic, ctxAtB0.isMinor);
                    const candidateOut = countNonDiatonicPcsInEvents(window as any, tonic, isMinorCand);

                    const currentSpell = countSpellingMismatchesInEvents(window as any, ctxAtB0.tonic, ctxAtB0.isMinor);
                    const candidateSpell = countSpellingMismatchesInEvents(window as any, tonic, isMinorCand);

                    // Penalize candidates that imply a key signature direction mismatch.
                    const SPELL_W = 2;
                    const currentOutAdj = currentOut
                        + keySignaturePenalty(ctxAtB0.tonic, ctxAtB0.isMinor)
                        + (Number.isFinite(currentSpell) ? (currentSpell * SPELL_W) : 0);
                    const candidateOutAdj = candidateOut
                        + keySignaturePenalty(tonic, isMinorCand)
                        + (Number.isFinite(candidateSpell) ? (candidateSpell * SPELL_W) : 0);

                    const improvement = (Number.isFinite(currentOutAdj) && Number.isFinite(candidateOutAdj)) ? (currentOutAdj - candidateOutAdj) : 0;
                    const rawImprovement = (Number.isFinite(currentOut) && Number.isFinite(candidateOut)) ? (currentOut - candidateOut) : 0;

                    // In very short excerpts, the diatonic-fit improvement can legitimately cap at 2
                    // even for an obvious cadence into a remote key (e.g. V7->i in B♭m while global is C).
                    // Allow a slightly weaker improvement when:
                    // - the cadence is strong in the candidate key (V/vii° -> I/i),
                    // - the candidate tonic is NOT diatonic in the current context,
                    // - and the candidate window is very clean (candidateOut <= 1).
                    const tonicIsDiatonicInCurrent = (() => {
                        try {
                            return diatonicSetForKey(ctxAtB0.tonic, ctxAtB0.isMinor).has(mod12(tonicPc));
                        } catch {
                            return true;
                        }
                    })();
                    const allowShortStrongCadence = !tonicIsDiatonicInCurrent
                        && aLooksFunctionalToTonic
                        && bLooksLikeTonic
                        && candidateOut <= 1
                        && currentOut >= 2;

                    const bIsTonicRootPos = (() => {
                        try {
                            const tonicMatch = (bRoman === (isMinorCand ? 'i' : 'I'))
                                && (bInfo.rootPc != null)
                                && (bInfo.bassPc != null)
                                && (mod12(bInfo.rootPc) === mod12(tonicPc))
                                && (mod12(bInfo.bassPc) === mod12(tonicPc));
                            return !!tonicMatch;
                        } catch {
                            return false;
                        }
                    })();

                    // Barline cadence into a remote key with a clean root-position tonic can be decisive
                    // even when the short lookahead window contains one extra chromatic pitch.
                    const allowRemoteRootPosCadence = isStrictCadenceBoundary
                        && !tonicIsDiatonicInCurrent
                        && bIsTonicRootPos
                        && aLooksFunctionalToTonic
                        && candidateOut <= 2
                        && (b.absBeat - a.absBeat) <= 2.01;

                    // Some excerpts contain a clear V→I cadence into a remote key but also include
                    // a single chromatic tone in the lookahead window (e.g. applied leading tones).
                    // In that case diatonic-fit improvement can be only 1 even though the cadence is decisive.
                    // Allow it, but only when the candidate window is very clean and the tonic is non-diatonic
                    // in the current context (prevents spurious relabeling on diatonic material).
                    const allowMixedStrongCadence = isStrictCadenceBoundary
                        && !tonicIsDiatonicInCurrent
                        && (rootMotionIsDomToTonic || aLooksFunctionalToTonic)
                        && bLooksLikeTonic
                        && candidateOut <= 1
                        && currentOut >= 2
                        && rawImprovement >= 1;

                    // Barline entry on V (or vii°) with an immediate I/i confirmation soon after.
                    // Example: global Bb, boundary chord is Db (V in Gb), then Gb (I) on beat 3.
                    // This should infer the new key at the barline to avoid labels like ♭III / ♭VI.
                    const allowBoundaryDomToTonicSoon = isStrictCadenceBoundary
                        && !tonicIsDiatonicInCurrent
                        && bIsDomLike
                        && hasTonicAfterB
                        && candidateOut <= 1
                        && currentOut >= 2
                        && rawImprovement >= 1;

                    // Intra-modulation barline cadence (non-global context):
                    // When we're already in an inferred remote key, the short-window diatonic-fit
                    // improvement between two plausible flat keys can be ~0 (both explain the window),
                    // yet a clean V→I in root position at the barline is strong evidence of a local
                    // tonic shift the user expects to see as a context change (exercise-model style).
                    // Keep this conservative to avoid "spray":
                    // - only when current context is non-global,
                    // - only at a strict barline boundary,
                    // - only with dominant→tonic root motion AND root-position tonic,
                    // - only when candidate window is very clean,
                    // - only when key-signature distance meaningfully changes.
                    const allowIntraContextBarlineCadence = (() => {
                        try {
                            if (currentCtxIsGlobal) return false;
                            if (!isStrictCadenceBoundary) return false;
                            if (!rootMotionIsDomToTonic) return false;
                            if (!bIsTonicRootPos) return false;
                            if (candidateOut > 1) return false;
                            if (!Number.isFinite(currentOut) || currentOut < candidateOut) return false;

                            const ksCur = getKeySignature(ctxAtB0.tonic, ctxAtB0.isMinor ? 'Minor' : 'Major') as any;
                            const ksCand = getKeySignature(tonic, isMinorCand ? 'Minor' : 'Major') as any;
                            const curType = String(ksCur?.type || 'natural');
                            const candType = String(ksCand?.type || 'natural');
                            const curCnt = Math.max(0, Math.round(Number(ksCur?.count || 0)));
                            const candCnt = Math.max(0, Math.round(Number(ksCand?.count || 0)));

                            // Must not flip accidentals direction; must be a meaningful distance change.
                            if (curType !== 'natural' && candType !== 'natural' && curType !== candType) return false;
                            if (Math.abs(curCnt - candCnt) < 2) return false;

                            // Prefer staying within the global accidental direction preference.
                            if (preferFlats && candType === 'sharp') return false;
                            if (!preferFlats && candType === 'flat') return false;

                            return true;
                        } catch {
                            return false;
                        }
                    })();

                    // Special case: return to the *global* key.
                    // When a sequence/tonicization temporarily made another key diatonic (e.g. C# minor)
                    // and we later cadence V→I back to the project tonic (e.g. E→A), the diatonic-fit
                    // improvement can be 0 (both keys are diatonic over a short window). Still, musically,
                    // the cadence is strong evidence of returning home.
                    const isReturnToGlobalKey = String(tonic || '') === String(keyTonic || '')
                        && String(ctxAtB0.tonic || '') !== String(keyTonic || '');
                    const okReturnHome = isReturnToGlobalKey
                        && (rootMotionIsDomToTonic || aLooksFunctionalToTonic)
                        && candidateOut <= 2;

                    // Key-change inference must *improve* diatonic fit, otherwise it becomes a
                    // re-labeling machine on fully diatonic material (e.g. I6 read as V6/IV).
                    // Allow weaker improvements only when there's an explicit dominant pull.
                    const ok = requireStricter
                        ? (candidateOut <= 1 && improvement > 2)
                        : (
                            requireVeryStrong
                                ? (
                                    // Standard strict rule.
                                    (rootMotionIsDomToTonic && candidateOut <= 1 && improvement >= 3)
                                    // Short-excerpt fallback for strong, remote cadences.
                                    || (allowShortStrongCadence && (rootMotionIsDomToTonic || aLooksFunctionalToTonic) && improvement >= 2)
                                                                        // Mixed-window fallback for explicit barline cadences.
                                                                        || allowMixedStrongCadence
                                                                        // Remote root-position tonic cadence.
                                                                        || allowRemoteRootPosCadence
                                                                        // Entry on V with immediate I/i confirmation.
                                                                        || allowBoundaryDomToTonicSoon
                                  )
                                              : (improvement >= 2 || allowIntraContextBarlineCadence)
                          );
                    if (!ok && !okReturnHome) continue;
                    const scoreCadenceBoost = (() => {
                        try {
                            if (!(allowShortStrongCadence || allowMixedStrongCadence)) return 0;
                            // Only boost when the arrival is a clear tonic in root position at a barline.
                            // This avoids turning ordinary tonicizations into inferred modulations.
                            const bIsTonic = (bRoman === (isMinorCand ? 'i' : 'I'))
                                && (bInfo.rootPc != null)
                                && (bInfo.bassPc != null)
                                && (mod12(bInfo.rootPc) === mod12(tonicPc))
                                && (mod12(bInfo.bassPc) === mod12(tonicPc));
                            if (!isStrictCadenceBoundary || !bIsTonic) return 0;
                            return 2;
                        } catch {
                            return 0;
                        }
                    })();
                    // Cadence-confirmation bonus:
                    // prefer candidates that actually show I/i shortly AFTER the boundary.
                    // This helps detect modulations that enter on V and resolve to I within the bar.
                    const scoreCadenceConfirm = (hasTonicAfterB ? 4 : 0) + ((bIsDomLike && hasTonicAfterB) ? 2 : 0);

                    const score =
                        5 +
                        (rootMotionIsDomToTonic ? 3 : 0) +
                        (aLooksFunctionalToTonic ? 2 : 0) +
                        scoreCadenceConfirm +
                        Math.max(0, improvement) -
                        (requireStricter ? 2 : 0) +
                        scoreCadenceBoost;

                    // Boost score for an explicit cadence back to the *global* tonic.
                    // This prevents the return-home context from being filtered out when the
                    // diatonic-fit improvement is ~0 and root-motion detection is unreliable.
                    const scoreBoostReturnHome = (String(tonic || '') === String(keyTonic || '')
                        && String(ctxAtB0.tonic || '') !== String(keyTonic || '')
                        && (rootMotionIsDomToTonic || aLooksFunctionalToTonic))
                        ? 2
                        : 0;

                    const cand: TonicCand = {
                        tonicPc,
                        tonic,
                        isMinor: isMinorCand,
                        bRoman,
                        bLooksLikeTonic,
                        bIsTonicRootPos,
                        tonicIsDiatonicInCurrent,
                        aRoman,
                        aLooksFunctionalToTonic,
                        rootMotionIsDomToTonic,
                        requireStricter,
                        windowLen,
                        currentOut,
                        candidateOut,
                        score: score + scoreBoostReturnHome,
                    };

                    if (!bestCand || cand.score > bestCand.score) bestCand = cand;
                }

                if (!bestCand) continue;

                const inferredTonic = bestCand.tonic;
                const inferredIsMinor = bestCand.isMinor;
                const bLooksLikeTonic = bestCand.bLooksLikeTonic;
                const aLooksFunctionalToTonic = bestCand.aLooksFunctionalToTonic;
                const rootMotionIsDomToTonic = bestCand.rootMotionIsDomToTonic;
                const requireStricter = bestCand.requireStricter;
                const tonicIsDiatonicInCurrent = bestCand.tonicIsDiatonicInCurrent;
                const bIsTonicRootPos = bestCand.bIsTonicRootPos;

                // Stability guard: avoid flipping to an opposite-accidental-direction key
                // when the global key clearly prefers flats (or sharps). This blocks common
                // enharmonic/cadential false positives like inferring B major inside a flat
                // region (where the same pitch-classes are better explained as Cb/IV etc.).
                try {
                    const isReturnToGlobal = String(inferredTonic || '') === String(keyTonic || '')
                        && !!inferredIsMinor === !!isMinor;
                    if (!isReturnToGlobal) {
                        const ksCand = getKeySignature(inferredTonic, inferredIsMinor ? 'Minor' : 'Major') as any;
                        const cnt = Math.max(0, Math.round(Number(ksCand?.count || 0)));
                        const type = String(ksCand?.type || 'natural');
                        // Strongly discourage 4+ accidentals in the opposite direction.
                        if (preferFlats && type === 'sharp' && cnt >= 4) continue;
                        if (!preferFlats && type === 'flat' && cnt >= 4) continue;
                    }
                } catch { /* ignore */ }

                // Skip if a user context already starts here.
                const hasManualCtxHere = (analysisContexts || []).some(c => Math.abs(ctxAbsBeat(c) - b.absBeat) < 1e-6);
                if (hasManualCtxHere) continue;

                // (Diatonic-fit checks already performed in bestCand selection)

                // Optional back-propagation: if we inferred a tonic on the downbeat, and the immediately
                // previous harmony cleanly functions as predominant/dominant in that key, start the context
                // at the previous event so that chord is labeled in the new key too.
                let startAbsBeat = b.absBeat;
                try {
                    const backPropOk = !requireStricter && bLooksLikeTonic && aLooksFunctionalToTonic && (b.absBeat - a.absBeat) <= 2.01;
                    if (backPropOk) startAbsBeat = a.absBeat;

                    // If we inferred a *remote* key by a strict barline cadence with a clear tonic in root position,
                    // start at the downbeat of the cadence measure to avoid mixed labeling inside that measure.
                    // (Common pattern: ♭VI/♭III in global key -> V in new key -> I at barline.)
                    if (backPropOk && isStrictCadenceBoundary && !tonicIsDiatonicInCurrent && bIsTonicRootPos) {
                        const downbeat = Number(a.measureIndex) * beatsPerMeasLocal;
                        const dt = Number(a.absBeat) - Number(downbeat);
                        if (Number.isFinite(dt) && dt >= -1e-6 && dt <= 2.01) {
                            startAbsBeat = downbeat;
                        }
                    }

                    // One-step extra back-prop: if we already moved to the previous event (typically V→I),
                    // also include the immediately previous inversion/neighbor event if it still functions
                    // as V or vii° in the inferred key (common for V7 in 4/2 or arpeggiations).
                    if (backPropOk && Math.abs(startAbsBeat - a.absBeat) < 1e-6) {
                        const p = (i - 1) >= 0 ? chordEvents[i - 1] : null;
                        if (p && Number.isFinite(p.absBeat) && (a.absBeat - p.absBeat) <= 1.01) {
                            const pr = String(_gRA(p.notes || [], inferredTonic, inferredIsMinor)?.roman || '').replace(/\s+/g, '');
                            const prLow = pr.toLowerCase();
                            const ok = prLow.startsWith('v') || prLow.startsWith('vii');
                            if (ok) startAbsBeat = p.absBeat;
                        }
                    }
                } catch { /* ignore */ }

                // If a manual context starts at the chosen start, don't override it.
                const hasManualAtStart = (analysisContexts || []).some(c => Math.abs(ctxAbsBeat(c) - startAbsBeat) < 1e-6);
                if (hasManualAtStart) continue;

                const score = Number(bestCand.score) || 0;

                const absKey = qAbs(startAbsBeat);
                const cand: InferredCand = {
                    absBeat: startAbsBeat,
                    newTonic: inferredTonic,
                    newIsMinor: inferredIsMinor,
                    label: `[ ${inferredTonic} ${inferredIsMinor ? 'min' : 'maj'} ]`,
                    score,
                };
                const prev = bestByAbsBeat.get(absKey);
                if (!prev || cand.score > prev.score) bestByAbsBeat.set(absKey, cand);
            }

            // ---------------------------------------------------------
            // Return-to-global preparation (conservative)
            // ---------------------------------------------------------
            // When we're inside a non-global inferred context, we can start a re-transition
            // back to the global key *before* the actual I arrives (e.g. V/V -> V -> I).
            // This improves labeling in the return measure and matches the regression
            // expectation (Bb@absBeat=108 in Dubois n3 p12).
            try {
                const MAX_LOOKAHEAD = Math.min(beatsPerMeasLocal, 4.01);
                for (let j = 0; j < chordEvents.length; j++) {
                    const b = chordEvents[j];
                    if (!b || !Number.isFinite(b.absBeat) || !Number.isFinite(b.beat)) continue;
                    if (Math.abs(Number(b.beat) - 1) > 1e-3) continue; // downbeats only

                    const ctxAtB = getContextAtAbsBeatInferred(Number(b.absBeat));
                    const inNonGlobal = String(ctxAtB.tonic || '') !== String(keyTonic || '');
                    if (!inNonGlobal) continue;

                    // Do not override a manual context at this downbeat.
                    const hasManualCtxHere = (analysisContexts || []).some(c => Math.abs(ctxAbsBeat(c) - Number(b.absBeat)) < 1e-6);
                    if (hasManualCtxHere) continue;

                    const rB = String(_gRA(b.notes || [], keyTonic, isMinor)?.roman || '').replace(/\s+/g, '');
                    const rBLow = rB.toLowerCase();
                    const bLooksFunctional = rBLow.startsWith('v') || rBLow.startsWith('vii');
                    if (!bLooksFunctional) continue;

                    let foundTonic = false;
                    for (let t = j + 1; t < chordEvents.length; t++) {
                        const ev = chordEvents[t];
                        if (!ev || !Number.isFinite(ev.absBeat)) continue;
                        const dt = Number(ev.absBeat) - Number(b.absBeat);
                        if (dt > MAX_LOOKAHEAD + 1e-6) break;
                        if (!isStrongBeatForInference(Number(ev.beat))) continue;
                        const r = String(_gRA(ev.notes || [], keyTonic, isMinor)?.roman || '').replace(/\s+/g, '');
                        if (r === (isMinor ? 'i' : 'I')) { foundTonic = true; break; }
                    }
                    if (!foundTonic) continue;

                    const absKey = qAbs(Number(b.absBeat));
                    const cand: InferredCand = {
                        absBeat: Number(b.absBeat),
                        newTonic: String(keyTonic),
                        newIsMinor: !!isMinor,
                        label: `[ ${String(keyTonic)} ${isMinor ? 'min' : 'maj'} ]`,
                        score: 12,
                    };
                    const prev = bestByAbsBeat.get(absKey);
                    if (!prev || cand.score > prev.score) bestByAbsBeat.set(absKey, cand);
                }
            } catch {
                // ignore
            }

            // ---------------------------------------------------------
            // Secondary inference: window-based key-fit scanning (modulation detector)
            // ---------------------------------------------------------
            // Purpose: detect longer key regions even when they don't enter on I/i
            // (e.g. Bb major -> Gb major via IV=C♭), and avoid "spray" tonicizations.
            try {
                const downbeats = Array.from(new Set(
                    (chordEvents || [])
                        .filter(ev => ev && Number.isFinite(ev.absBeat) && Number.isFinite(ev.beat) && Math.abs(Number(ev.beat) - 1) <= 1e-3)
                        .map(ev => qAbs(Number(ev.absBeat)))
                )).sort((a, b) => a - b);

                const uniquePcsCountInEvents = (events: ChordEvent[]): number => {
                    try {
                        const pcs = new Set<number>();
                        for (const ev of events || []) {
                            for (const n of (ev?.notes || []) as any[]) {
                                if (!n || (n as any).isRest) continue;
                                pcs.add(mod12(pitchClassOf(n as any)));
                            }
                        }
                        return pcs.size;
                    } catch {
                        return 0;
                    }
                };

                type WindowBest = {
                    tonic: string;
                    isMinor: boolean;
                    out: number;
                    outAdj: number;
                    improvement: number;
                    pcsCount: number;
                    currentOut: number;
                    tonicHits: number;
                    supportHits: number;
                };

                const bestKeyForWindow = (startAbsBeat: number, windowLen: number): WindowBest | null => {
                    const window = (chordEvents || []).filter(ev => ev.absBeat >= startAbsBeat - 1e-6 && ev.absBeat < (startAbsBeat + windowLen - 1e-6));
                    const pcsCount = uniquePcsCountInEvents(window as any);
                    if (pcsCount < 5) return null; // too little evidence

                    // Compare against the currently active context (manual + inferred so far).
                    // This avoids the scanner overriding a good inferred tonicization with a spurious
                    // enharmonic key that happens to fit one chord (e.g. F# major read as Gb I).
                    const ctx = getContextAtAbsBeatInferred(startAbsBeat);
                    const currentOut = countNonDiatonicPcsInEvents(window as any, ctx.tonic, ctx.isMinor);
                    const currentSpell = countSpellingMismatchesInEvents(window as any, ctx.tonic, ctx.isMinor);

                    let best: WindowBest | null = null;
                    for (let pc = 0; pc < 12; pc++) {
                        const tonic = pcToKeyName(pc);
                        for (const isMinorCand of [false, true]) {
                            const out = countNonDiatonicPcsInEvents(window as any, tonic, isMinorCand);
                            const spell = countSpellingMismatchesInEvents(window as any, tonic, isMinorCand);
                            const outAdj = out + keySignaturePenalty(tonic, isMinorCand) + (spell * 2);
                            const improvement = (Number.isFinite(currentOut) && Number.isFinite(out)) ? (currentOut - out) : 0;
                            const tonicTarget = isMinorCand ? 'i' : 'I';
                            const tonicHits = (() => {
                                try {
                                    let hits = 0;
                                    for (const ev of window as any[]) {
                                        const r = String(_gRA(ev?.notes || [], tonic, isMinorCand)?.roman || '').replace(/\s+/g, '');
                                        if (r === tonicTarget) hits++;
                                    }
                                    return hits;
                                } catch {
                                    return 0;
                                }
                            })();

                            const supportHits = (() => {
                                try {
                                    let hits = 0;
                                    for (const ev of window as any[]) {
                                        const r = String(_gRA(ev?.notes || [], tonic, isMinorCand)?.roman || '').replace(/\s+/g, '');
                                        const low = r.toLowerCase();
                                        if (low.startsWith('v') || low.startsWith('vii')) hits++;
                                    }
                                    return hits;
                                } catch {
                                    return 0;
                                }
                            })();

                            // Require at least one tonic hit, and some functional support (V/vii),
                            // or multiple tonic confirmations. This prevents spurious keys picked
                            // just because a single chord matches I enharmonically.
                            if (tonicHits <= 0) continue;
                            if (supportHits <= 0 && tonicHits < 2) continue;

                            const cand: WindowBest = { tonic, isMinor: isMinorCand, out, outAdj, improvement, pcsCount, currentOut, tonicHits, supportHits };
                            if (!best) {
                                best = cand;
                                continue;
                            }

                            if (cand.outAdj < best.outAdj) { best = cand; continue; }
                            if (cand.outAdj > best.outAdj) continue;

                            // Tie-breakers: prefer more tonic evidence, then more functional support,
                            // then higher improvement.
                            if (cand.tonicHits > best.tonicHits) { best = cand; continue; }
                            if (cand.tonicHits < best.tonicHits) continue;

                            if (cand.supportHits > best.supportHits) { best = cand; continue; }
                            if (cand.supportHits < best.supportHits) continue;

                            if (cand.improvement > best.improvement) { best = cand; continue; }
                        }
                    }
                    return best;
                };

                const windowLen = beatsPerMeasLocal * 2;
                for (const sAbs of downbeats) {
                    // Do not override a manual context.
                    const hasManual = (analysisContexts || []).some(c => Math.abs(ctxAbsBeat(c) - sAbs) < 1e-6);
                    if (hasManual) continue;

                    const best0 = bestKeyForWindow(sAbs, windowLen);
                    const best1 = bestKeyForWindow(sAbs + beatsPerMeasLocal, windowLen);
                    if (!best0 || !best1) continue;
                    const stableSameKey = String(best0.tonic) === String(best1.tonic) && !!best0.isMinor === !!best1.isMinor;
                    if (!stableSameKey) continue;

                    const ctx = (() => {
                        try {
                            const applicable = ([...(analysisContexts || [])] as AnalysisContext[])
                                .filter(c => ctxAbsBeat(c) <= sAbs + 1e-6)
                                .sort((a, b) => ctxAbsBeat(b) - ctxAbsBeat(a))[0];
                            return {
                                tonic: applicable ? applicable.newTonic : keyTonic,
                                isMinor: applicable ? applicable.newIsMinor : isMinor,
                            };
                        } catch {
                            return { tonic: keyTonic, isMinor };
                        }
                    })();
                    const sameAsCurrent = String(best0.tonic) === String(ctx.tonic) && !!best0.isMinor === !!ctx.isMinor;
                    if (sameAsCurrent) continue;

                    // Do not infer a new *context* whose tonic is diatonic in the current context.
                    // These are typically relative/secondary readings (Eb/F in Bb, etc.) and create
                    // noisy key-flips in regressions.
                    try {
                        const ctxIsGlobal = String(ctx.tonic || '') === String(keyTonic || '') && !!ctx.isMinor === !!isMinor;
                        if (!ctxIsGlobal) {
                            // Inside a non-global inferred region (e.g. Gb), allow diatonic sub-keys
                            // to be inferred if the window fit strongly prefers them.
                        } else {
                        const idx = (noteNameToIndex as any)[String(best0.tonic || '')];
                        const tonicPc = Number.isFinite(idx) ? mod12(Number(idx)) : null;
                        if (tonicPc != null) {
                            const dia = diatonicSetForKey(ctx.tonic, ctx.isMinor);
                            if (dia && dia.has(tonicPc)) continue;
                        }
                        }
                    } catch { /* ignore */ }

                    // Require a clear and musically meaningful improvement.
                    const improvement = best0.improvement;
                    const bestOut = best0.out;
                    const allowStrongFunctionalTonicization = Number(best0.supportHits) >= 1
                        && Number(best0.tonicHits) >= 1
                        && Number.isFinite(bestOut)
                        && bestOut <= 1
                        && Number.isFinite(improvement)
                        && improvement >= 2;
                    if (!(Number.isFinite(improvement) && (improvement >= 3 || allowStrongFunctionalTonicization))) continue;
                    if (!(Number.isFinite(bestOut) && (bestOut <= 2 || allowStrongFunctionalTonicization))) continue;

                    const score = 10 + Math.max(0, improvement) + Math.max(0, best0.pcsCount - 5) + Math.max(0, Number(best0.supportHits) || 0);
                    const absKey = qAbs(sAbs);
                    const cand: InferredCand = {
                        absBeat: sAbs,
                        newTonic: best0.tonic,
                        newIsMinor: best0.isMinor,
                        label: `[ ${best0.tonic} ${best0.isMinor ? 'min' : 'maj'} ]`,
                        score,
                    };
                    const prev = bestByAbsBeat.get(absKey);
                    if (!prev || cand.score > prev.score) bestByAbsBeat.set(absKey, cand);
                }
            } catch {
                // ignore
            }

            // Materialize final inferred contexts (sorted).
            try {
                inferredAnalysisContexts.push(...inferredSoFar());
            } catch { /* ignore */ }

            // ── Modulating-sequence inferred contexts ──
            // When the sequence detector found modulating sequences, inject
            // local-tonic contexts for each repetition link.  This lets the
            // downstream display/tooltip show the correct Roman numeral in
            // the transposed key.
            //
            // The detector's `modulationTonics` are computed from the global
            // key signature root, which is often wrong when the sequence sits
            // inside a modulation.  We recompute the model's local tonic by
            // looking at the **active context** at the sequence's start beat
            // and using the notes of the model to refine it.
            try {
                const _bpm = (timeSignature?.numerator ?? 4) * (4 / (timeSignature?.denominator ?? 4));
                // Gather all known contexts so far (user + inferred)
                const allCtx = [
                    ...(analysisContexts || []),
                    ...(inferredAnalysisContexts || []),
                ].sort((a, b) => ctxAbsBeat(a) - ctxAbsBeat(b));

                const getActiveTonicAt = (absBeat: number): string => {
                    let tonic = String(keyTonic || 'C');
                    for (const c of allCtx) {
                        if (ctxAbsBeat(c) <= absBeat + 0.01) tonic = c.newTonic || tonic;
                    }
                    return tonic;
                };

                for (const _sq of getSequenceMatchesForRules()) {
                    const sq = _sq as SequenceMatch;
                    if (!sq.isModulating || !sq.modulationTonics?.length) continue;
                    const L = sq.lengthSteps;
                    const transpo = sq.transpositionSemitones ?? 0;
                    if (transpo === 0) continue;
                    const slots = sq.slotTicks || [];
                    const startTick = slots[sq.startSlotIdx];
                    if (startTick == null) continue;
                    const startAbsBeat = startTick / TICKS_PER_QUARTER;

                    // --- Determine the model's local tonic ---
                    // Strategy: look at the bass note (lowest MIDI) at the model's
                    // "resolution" slot (middle of the model, where the I chord
                    // typically lands) and use its pitch class as a tonic candidate.
                    // Verified against the active context to prefer it when reasonable.
                    const activeTonicName = getActiveTonicAt(startAbsBeat);
                    const _npc: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11 };
                    const activeTonicPC = _npc[activeTonicName] ?? 0;

                    // Find the bass PC at the model's resolution slot (L/2 or slot 1)
                    // by looking at the notes directly.
                    let modelTonicPC = activeTonicPC; // fallback
                    let lowestNoteSpelling: { pitch?: string; accidental?: string } | null = null;
                    const nearNotes: Array<{ pitch?: string; accidental?: string }> = [];
                    const resTick = slots[sq.startSlotIdx + Math.floor(L / 2)];
                    if (resTick != null && Number.isFinite(resTick)) {
                        const resAbsBeat = resTick / TICKS_PER_QUARTER;
                        // Find the lowest-MIDI note at or very near this beat
                        let lowestMidi = Infinity;
                        for (const n of (notes || []) as any[]) {
                            if (n.isRest) continue;
                            const nAbs = typeof n.absoluteBeat === 'number' ? n.absoluteBeat
                                : (typeof n.absBeat === 'number' ? n.absBeat
                                    : (n.measureIndex ?? 0) * _bpm + ((n.beat ?? 1) - 1));
                            if (Math.abs(nAbs - resAbsBeat) < 0.25) {
                                const midi = n.midi ?? n.midiNote ?? 0;
                                nearNotes.push({ pitch: n.pitch, accidental: n.accidental });
                                if (midi > 0 && midi < lowestMidi) {
                                    lowestMidi = midi;
                                    lowestNoteSpelling = { pitch: n.pitch, accidental: n.accidental };
                                }
                            }
                        }
                        if (Number.isFinite(lowestMidi)) {
                            modelTonicPC = ((lowestMidi % 12) + 12) % 12;
                        }
                    }

                    // Determine preferFlats from the actual spelling of notes at this beat,
                    // falling back to the active context tonic when no spelling info is available.
                    const spellingHasFlat = lowestNoteSpelling?.accidental === 'flat' ||
                        nearNotes.some(n => n.accidental === 'flat');
                    const preferFlats = spellingHasFlat ||
                        activeTonicName.includes('b') ||
                        ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'].includes(activeTonicName);
                    const FLAT_NAMES: Record<number, string> = { 0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F', 6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B' };
                    const SHARP_NAMES: Record<number, string> = { 0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'G#', 9: 'A', 10: 'A#', 11: 'B' };
                    const toName = (pc: number) => preferFlats ? FLAT_NAMES[((pc % 12) + 12) % 12] : SHARP_NAMES[((pc % 12) + 12) % 12];

                    for (let rep = 0; rep < (sq.repeatsCount ?? 2); rep++) {
                        const localPC = ((modelTonicPC + transpo * rep) % 12 + 12) % 12;
                        let tonicName = toName(localPC);
                        if (!tonicName) continue;
                        // When preferring flats, re-spell sharp-side tonics that are
                        // enharmonic equivalents in the flat world (e.g. B → Cb, F# → Gb).
                        if (preferFlats) {
                            const enharmonicFlat: Record<string, string> = {
                                'B': 'Cb', 'F#': 'Gb', 'C#': 'Db', 'G#': 'Ab', 'D#': 'Eb', 'A#': 'Bb',
                            };
                            if (enharmonicFlat[tonicName]) tonicName = enharmonicFlat[tonicName];
                        }
                        // Skip when tonic matches the globally active tonic
                        if (rep === 0 && tonicName === activeTonicName) continue;
                        const slotIdx = sq.startSlotIdx + rep * L;
                        const tick = slots[slotIdx];
                        if (tick == null || !Number.isFinite(tick)) continue;
                        const absBeat = tick / TICKS_PER_QUARTER;
                        // Don't duplicate an existing context at the same beat
                        const isDup = inferredAnalysisContexts.some(c =>
                            Math.abs(c.absBeat - absBeat) < 0.01 && c.newTonic === tonicName);
                        if (isDup) continue;
                        inferredAnalysisContexts.push({
                            absBeat,
                            newTonic: tonicName,
                            newIsMinor: false,
                        } as AnalysisContext);
                    }
                }
            } catch { /* ignore */ }

            // ---------------------------------------------------------
            // Neapolitan: expect resolution to V (or V/...) soon.
            // Accept variants like N6.
            // Run AFTER inference so we don't misread IV in an inferred key as N in the global key.
            // ---------------------------------------------------------
            try {
                const getContextAtAbsBeatForWarnings = (absBeat: number) => {
                    const applicable = ([...(analysisContexts || []), ...(inferredAnalysisContexts || [])] as AnalysisContext[])
                        .filter(c => ctxAbsBeat(c) <= absBeat + 1e-6)
                        .sort((a, b) => ctxAbsBeat(b) - ctxAbsBeat(a))[0];
                    return {
                        tonic: applicable ? applicable.newTonic : keyTonic,
                        isMinor: applicable ? applicable.newIsMinor : isMinor,
                    };
                };

                const romanAtWithInferredCtx = (ev: ChordEvent) => {
                    const c = getContextAtAbsBeatForWarnings(ev.absBeat);
                    return _gRA(notesForRomanAt(ev), c.tonic, c.isMinor)?.roman ?? '';
                };

                const maxLookaheadBeats = 2.01;
                for (let i = 0; i < chordEvents.length - 1; i++) {
                    const a = chordEvents[i];

                    // ROTTURA DIDATTICA
                    // La risoluzione della napoletana può richiedere misure successive.
                    // Se c'è una barline, non possiamo validare la risoluzione.
                    if (doubleBarlineMeasures && doubleBarlineMeasures.length > 0) {
                        const b = chordEvents[i + 1];
                        if (a.measureIndex !== b.measureIndex && doubleBarlineMeasures.includes(a.measureIndex)) continue;
                    }

                    const aRoman = String(romanAtWithInferredCtx(a) || '');
                    if (!aRoman.toUpperCase().startsWith('N')) continue;

                    let ok = false;
                    for (let j = i + 1; j < chordEvents.length; j++) {
                        const b = chordEvents[j];
                        if ((b.absBeat - a.absBeat) > maxLookaheadBeats + 1e-6) break;
                        const bRoman = String(romanAtWithInferredCtx(b) || '').trim().toLowerCase();
                        if (bRoman.startsWith('v')) {
                            ok = true;
                            break;
                        }
                    }

                    if (!ok) {
                        const b0 = chordEvents[i + 1];
                        const aBass = getLowestNote(a);
                        const bBass = getLowestNote(b0);
                        addViolation({
                            ruleId: 'R-N-RES',
                            severity: 'warning',
                            description: 'Risoluzione atipica della Napolitana (N)',
                            suggestion: 'In stile corale classico, N tende a risolvere verso V (spesso in 6).',
                            noteIds: withEndpoints((a.notes || []).slice(0, 4).map(n => n.id), aBass?.id, bBass?.id),
                        });
                        addResolutionConnection(a, b0, 'R-N-RES', 'warning');
                    }
                }
            } catch {
                // ignore
            }
        } catch {
            // ignore inference failures
        }
    } catch (err) {
        console.warn('[ANALYSIS] chord-function rules failed', err);
    }

    try {
        const cnt = analyzedNotes.filter(n => (n as any).isPassing).length;
        debugLog('[ANALYSIS] detectPassingNotes result - passing count:', cnt, 'ids:', analyzedNotes.filter(n=> (n as any).isPassing).map(n=>n.id));
    } catch (_) { }

    // If a note is classified as a passing note, it should not be simultaneously reported
    // as an ornament (e.g. escape tone) in the analysis panel. Passing notes are rendered
    // via the dedicated overlay; ORN-* entries here would be misleading noise.
    try {
        const passingIds = new Set(
            analyzedNotes.filter(n => (n as any).isPassing).map(n => n.id)
        );
        if (passingIds.size) {
            // Clear ornament flags on passing notes (renderer-level markers).
            for (const n of analyzedNotes as any[]) {
                if (!n || !passingIds.has(n.id)) continue;
                if (n.isNeighbor) n.isNeighbor = false;
                if (n.isAnticipation) n.isAnticipation = false;
                if (n.isAppoggiatura) n.isAppoggiatura = false;
                if (n.isEscape) n.isEscape = false;
                if (n.ornamentMark) delete n.ornamentMark;
            }

            // Remove ornament violations that touch a passing note.
            for (let i = violations.length - 1; i >= 0; i--) {
                const v: any = violations[i];
                const rid = (v?.ruleId || '') as string;
                if (!(rid.startsWith('ORN-') || rid.startsWith('R-ORN-'))) continue;
                const ids: string[] = Array.isArray(v?.noteIds) ? v.noteIds : [];
                if (ids.some(id => passingIds.has(id))) {
                    violations.splice(i, 1);
                }
            }
        }
    } catch (_) { }

    // DEV DIAGNOSTICS: if an ORN-ESC still survives, log its noteIds and whether they are passing.
    // This helps catch cases where the panel entry isn't actually tied to the rendered passing note.
    try {
        const isDev = typeof import.meta !== 'undefined' && !!(import.meta as any).env?.DEV;
        if (isDev && ENABLE_DEV_ANALYSIS_WARNINGS) {
            const esc = (violations as any[]).filter(v => (v?.ruleId === 'ORN-ESC' || v?.ruleId === 'R-ORN-ESC'));
            if (esc.length) {
                const passMap = new Map<string, boolean>();
                for (const n of analyzedNotes as any[]) passMap.set(n.id, !!n.isPassing);

            }
        }
    } catch { /* ignore */ }

    _pmark('09-chordFuncRules+cadence+keyContext+modulation+neapolitan');
    // =========================================================
    // Vertical checks (within a chord)
    // =========================================================
    const isCompoundMeter = (ts: TimeSignature) =>
        ts.denominator === 8 && (ts.numerator % 3 === 0) && ts.numerator > 3;

    const isStrongPulseBeatInMeasure = (beat: number, ts: TimeSignature): boolean => {
        // `beat` is in quarter-note units with 1-based indexing.
        const b0 = beat - 1;
        if (!Number.isFinite(b0 as any)) return false;

        // In compound meters, strong pulses are dotted-quarter units: 3 eighths = 1.5 quarter.
        if (isCompoundMeter(ts)) {
            const pulse = 1.5;
            const r = b0 % pulse;
            return Math.abs(r - 0) < 1e-6;
        }

        // In simple meters, chord-completeness is pedagogically useful only on strong beats.
        // Weak beats frequently host passing/ornamental motion or voice exchanges which can
        // create legitimate sparse verticalities (and noisy false warnings).
        const isIntegerBeat = Math.abs(beat - Math.round(beat)) < 1e-6;
        if (!isIntegerBeat) return false;
        const bInt = Math.round(beat);

        // Common simple meters.
        if (ts.denominator === 4) {
            if (ts.numerator === 4) return bInt === 1 || bInt === 3;
            if (ts.numerator === 3) return bInt === 1;
            if (ts.numerator === 2) return bInt === 1;
            if (ts.numerator === 6) return bInt === 1 || bInt === 4; // 6/4 (simple)
            return bInt === 1;
        }

        // Conservative fallback: downbeat only.
        return bInt === 1;
    };

    // ── EXC-S02: Voice crossing duration tracker ──
    // Track consecutive beats where each voice pair is crossed.
    // Key: "hi-lo" (e.g. "3-2" for T above A), Value: number of consecutive events.
    const _crossDurTracker = new Map<string, number>();
    let _crossPrevAbsBeat: number | null = null;

    chordEvents.forEach(ev => {
        const v1 = ev.byVoice.get(1);
        const v2 = ev.byVoice.get(2);
        const v3 = ev.byVoice.get(3);
        const v4 = ev.byVoice.get(4);
        const present = [v1, v2, v3, v4].filter(Boolean) as StaffNote[];

        const isNonChordToneAtEvent = (n: StaffNote, e: ChordEvent) => {
            try {
                // Some ornaments are carried only as a UI marker; treat them as non-chord tones
                // for chord-completeness to avoid noisy/false warnings.
                if ((n as any).ornamentMark) return true;
                if ((n as any).isPassing) return true;
                if ((n as any).isNeighbor) return true;
                if ((n as any).isAnticipation) return true;
                if ((n as any).isAppoggiatura) return true;
                if ((n as any).isEscape) return true;
                // Suspensions: treat as non-chord *at the dissonance onset* only.
                const s = (n as any).isSuspension;
                if (s && typeof s.fromAbsBeat === 'number' && Math.abs((s.fromAbsBeat as number) - (e.absBeat as number)) < 1e-6) return true;
            } catch { /* ignore */ }
            return false;
        };

        // Chord completeness (classical chorale): prefer complete sonorities.
        // - Triads should contain at least root + 3rd.
        // - Seventh chords should contain at least root + 3rd + 7th (5th may be omitted).
        try {
            // Ignore scan points that are only note endings (no attacks). These instants are
            // frequent with ornaments/ties and tend to create misleading “incomplete chord” warnings.
            if (!onsetPointsSet.has(ev.absBeat)) return;

            // In 6/8-like meters, many textures are written as arpeggiations/passing notes on the
            // internal 8th subdivisions; a strict vertical snapshot becomes noisy.
            // Evaluate completeness only on the strong dotted-quarter pulses.
            if (!isStrongPulseBeatInMeasure(ev.beat ?? 1, timeSignature)) return;

            // If any voice is currently ornamenting (suspension/passing/neighbor/etc.),
            // chord-completeness warnings become very noisy and often misleading.
            // In those cases, skip this check.
            // Treat any suspension/ritardo as an exemption for chord-completeness warnings.
            // Suspensions are often notated as tied notes whose *note onset* precedes the
            // dissonance onset; in that case `fromAbsBeat` may not equal the current event.
            // For the pedagogy/UI, we prefer to skip completeness warnings whenever a
            // suspension is active in the verticality.
            const hasSuspension = present.some(n => !!(n as any).isSuspension);
            const hasNonChordTone = hasSuspension || present.some(n => isNonChordToneAtEvent(n, ev));
            if (hasNonChordTone) return;

            // Special-case: in minor, the pitch-class set of a leading-tone fully diminished 7th
            // is often used as a *rootless* V7(♭9). When we intentionally interpret that sonority
            // as V7♭9 without its root, the “missing 7th” completeness warning becomes misleading
            // (especially in sparse textures where one chord member may be omitted).
            let isRootlessV7b9Subset = false;
            try {
                const ctx = getContextAtAbsBeat(ev.absBeat);
                const ctxTonicIndex = noteNameToIndex[ctx.tonic];
                if (ctx.isMinor && Number.isFinite(ctxTonicIndex as any)) {
                    const pcs = [...new Set(present.map(n => mod12(n.noteIndex)))];
                    if (pcs.length >= 3) {
                        const tonicPcCtx = mod12(ctxTonicIndex as number);
                        const leadingPcCtx = mod12(tonicPcCtx - 1);
                        const dim7Set = new Set<number>([
                            leadingPcCtx,
                            mod12(leadingPcCtx + 3),
                            mod12(leadingPcCtx + 6),
                            mod12(leadingPcCtx + 9),
                        ]);
                        isRootlessV7b9Subset = pcs.every(pc => dim7Set.has(pc));
                    }
                }
            } catch { /* ignore */ }

            if (present.length >= 2) {
                // The staff overlay renderer can only draw dashed highlights when it has a
                // 2-note connection whose endpoints are also present in the corresponding
                // violation's noteIds. For chord-level issues like “missing 3rd”, we
                // synthesize a single vertical connection spanning the chord (lowest↔highest).
                const addChordSpanConnection = (severity: 'error' | 'warning' | 'exception') => {
                    const withMidi = present
                        .filter(n => Number.isFinite(n.midi as any))
                        .slice()
                        .sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0));
                    if (withMidi.length < 2) return;
                    const low = withMidi[0];
                    const high = withMidi[withMidi.length - 1];
                    if (!low?.id || !high?.id || low.id === high.id) return;
                    const already = connections.some(c =>
                        c.ruleId === 'R-CHORD-COMPLETE' &&
                        c.type === 'vertical' &&
                        ((c.noteId1 === low.id && c.noteId2 === high.id) || (c.noteId1 === high.id && c.noteId2 === low.id))
                    );
                    if (already) return;
                    connections.push({
                        type: 'vertical',
                        noteId1: low.id,
                        noteId2: high.id,
                        severity,
                        ruleId: 'R-CHORD-COMPLETE',
                    });
                };

                const chordInfo = identifyChord(present);

                // Primary path: chord type recognized.
                if (chordInfo?.root && chordInfo.intervals) {
                    const intervals = chordInfo.intervals;
                    // NOTE: Add9 is not a 9th-chord (no implied 7th).
                    const isSeventhish =
                        chordInfo.type.includes('7') ||
                        chordInfo.type.includes('11') ||
                        chordInfo.type.includes('13') ||
                        (chordInfo.type.includes('9') && chordInfo.type !== BuiltInChords.Add9);
                    const hasThird = intervals.has(3) || intervals.has(4);
                    const isDim7 = /diminished\s*7|dim\s*7/i.test(String(chordInfo.type || ''));
                    const hasSeventh = intervals.has(10) || intervals.has(11) || (isDim7 && intervals.has(9));

                    if (!hasThird) {
                        addViolation({
                            ruleId: 'R-CHORD-COMPLETE',
                            severity: 'warning',
                            description: 'Accordo incompleto (manca la 3ª)',
                            suggestion: 'In stile corale, la 3ª definisce la modalità; evita accordi “senza terza” salvo casi sospesi intenzionali.',
                            noteIds: present.map(n => n.id),
                        });
                        addChordSpanConnection('warning');
                    }

                    // Important: we ONLY warn about “missing 7th” when a 7th-chord was
                    // recognized from the notes. If the 7th is absent, it may simply be a triad.
                    if (isSeventhish && !hasSeventh && !isRootlessV7b9Subset) {
                        addViolation({
                            ruleId: 'R-CHORD-COMPLETE',
                            severity: 'warning',
                            description: 'Accordo di 7ª incompleto (manca la 7ª)',
                            suggestion: 'Se l’accordo è di 7ª, includi la 7ª; se vuoi una triade, evita l’interpretazione di 7ª.',
                            noteIds: present.map(n => n.id),
                        });
                        addChordSpanConnection('warning');
                    }
                } else {
                    // Fallback (heuristic): handle common “shell” sonorities where identifyChord
                    // returns null, e.g. root+5th+7th without the 3rd (G–D–F).
                    const uniquePcs = [...new Set(present.map(n => n.noteIndex))];
                    if (uniquePcs.length >= 2) {
                        const intervalsForRoot = (rootPc: number) => new Set(uniquePcs.map(pc => (pc - rootPc + 12) % 12));
                        const hasThird = (ints: Set<number>) => ints.has(3) || ints.has(4);
                        const hasFifthLike = (ints: Set<number>) => ints.has(7) || ints.has(6) || ints.has(8);
                        const hasSeventhLike = (ints: Set<number>) => ints.has(10) || ints.has(11);
                        const looksSus = (ints: Set<number>) => !hasThird(ints) && (ints.has(2) || ints.has(5));

                        let missingThird = false;

                        for (const rootPc of uniquePcs) {
                            const ints = intervalsForRoot(rootPc);
                            if (!ints.has(0)) continue;

                            // Shell 7th chord without third (root + 5th + 7th): warn missing 3rd.
                            if (hasFifthLike(ints) && hasSeventhLike(ints) && !hasThird(ints)) {
                                missingThird = true;
                                break;
                            }

                            // Triad-ish without third (power chord): warn unless it's a sus chord.
                            if (hasFifthLike(ints) && !hasThird(ints) && !looksSus(ints) && uniquePcs.length >= 2) {
                                // Keep this conservative: require at least 3 different pcs
                                // (otherwise root+5 alone would be too noisy).
                                if (uniquePcs.length >= 3) {
                                    missingThird = true;
                                    break;
                                }
                            }
                        }

                        if (missingThird) {
                            addViolation({
                                ruleId: 'R-CHORD-COMPLETE',
                                severity: 'warning',
                                description: 'Accordo incompleto/ambiguo (manca la 3ª)',
                                suggestion: 'Se intendevi una triade o una 7ª “classica”, aggiungi la 3ª; altrimenti considera che la funzione/modo può risultare ambiguo.',
                                noteIds: present.map(n => n.id),
                            });
                            addChordSpanConnection('warning');
                        }
                    }
                }
            }
        } catch { /* ignore */ }

        // Vocal range (soft warnings): extremely conservative SATB ranges.
        // These are warnings only; they help spotting register issues.
        try {
            const inRange = (voice: Voice, midi: number) => {
                // Approximate comfortable ranges (can be refined later).
                if (voice === 1) return midi >= 60 && midi <= 84; // S: C4..C6
                if (voice === 2) return midi >= 55 && midi <= 77; // A: G3..F5
                if (voice === 3) return midi >= 48 && midi <= 72; // T: C3..C5
                if (voice === 4) return midi >= 40 && midi <= 67; // B: E2..G4
                return true;
            };
            for (const n of present) {
                const v = (n.voice ?? 1) as Voice;
                const m = n.midi ?? 0;
                if (!Number.isFinite(m)) continue;
                if (!inRange(v, m)) {
                    addViolation({
                        ruleId: 'R-RANGE',
                        severity: 'warning',
                        description: 'Nota fuori dal registro tipico della voce',
                        suggestion: 'Controlla l’ambitus SATB: potrebbe risultare scomodo o poco realistico per cantori.',
                        noteIds: [n.id],
                    });
                }
            }
        } catch { /* ignore */ }

        // R-10: Doubling leading tone
        // Important: evaluate "leading tone" relative to the active context (tonicization/modulation),
        // otherwise accidentals like F# can be incorrectly treated as the global leading tone.
        const leadingPcAtEvent = (() => {
            try {
                const ctx = getContextAtAbsBeat(ev.absBeat);
                const idx = noteNameToIndex[ctx.tonic];
                if (Number.isFinite(idx as any)) return mod12((idx as number) - 1);
            } catch { /* ignore */ }
            return leadingPc;
        })();

        const isOrnamentalR10 = (n: StaffNote) =>
            Boolean((n as any).isPassing || (n as any).isNeighbor || (n as any).isAnticipation || (n as any).isAppoggiatura || (n as any).isEscape || (n as any).isSuspension);

        const leadingNotes = present.filter(n => !isOrnamentalR10(n) && (n.midi % 12) === leadingPcAtEvent);
        if (leadingNotes.length >= 2) {
            // Apply R-10 only when the *harmony* is dominant-function (V or vii°) in the active context.
            // This prevents tonicization chords (where the pitch-class might be a local tonic/chord tone)
            // from being misinterpreted as a doubled global leading tone.
            try {
                const ctx = getContextAtAbsBeat(ev.absBeat);
                const tonicIdx = noteNameToIndex[ctx.tonic];
                const ctxTonicPc = Number.isFinite(tonicIdx as any) ? mod12(tonicIdx as number) : tonicPc;
                const chordInfo = identifyChord(present.filter(n => !isOrnamentalR10(n)));
                let isVorViidimR10 = false;
                if (chordInfo?.root) {
                    const rootPc = mod12(chordInfo.root.midi);
                    const intervalFromTonic = mod12(rootPc - ctxTonicPc);
                    if (intervalFromTonic === 7) {
                        isVorViidimR10 = true;
                    } else if (intervalFromTonic === 11 && (chordInfo.type || '').toLowerCase().includes('diminished')) {
                        isVorViidimR10 = true;
                    }
                }
                if (!isVorViidimR10) {
                    return;
                }
            } catch { /* ignore */ }

            // Attenuation inside imitated progressions (sequences): in many pedagogical contexts,
            // the model/repetition symmetry can justify otherwise “rigid” doubling constraints.
            let isInsideSequence = false;
            try {
                const tick = (() => {
                    const t = leadingNotes
                        .map(n => Number((n as any).startTick))
                        .filter(x => Number.isFinite(x));
                    return t.length ? Math.min(...t) : null;
                })();

                isInsideSequence = isTickInsideImitatedSequence(tick);
            } catch { /* ignore */ }

            // Helpful context for debugging remaining cases.
            let ctxInfo = '';
            try {
                const ctx = getContextAtAbsBeat(ev.absBeat);
                const romanHere = String(getRomanAnalysis(present, ctx.tonic, ctx.isMinor)?.roman || '').trim();
                ctxInfo = romanHere ? ` (ctx ${ctx.tonic}${ctx.isMinor ? ' min' : ' maj'}: ${romanHere})` : ` (ctx ${ctx.tonic}${ctx.isMinor ? ' min' : ' maj'})`;
            } catch { /* ignore */ }

            addViolation({
                ruleId: 'R-10',
                severity: isInsideSequence ? 'exception' : 'error',
                description: isInsideSequence
                    ? 'Raddoppio della sensibile (tollerato in sequenza/imitazione)'
                    : 'Raddoppio della sensibile',
                suggestion: isInsideSequence
                    ? (
                        'Nelle progressioni imitate (sequenze), la necessità di mantenere la simmetria del disegno del modello prevale sulla rigidità delle regole armoniche ordinarie. In particolare:\n'
                        + '• Tolleranza degli errori: nel passaggio tra il modello e la sua ripetizione, sono ammessi unisoni, quinte o ottave parallele (che possono essere conseguenza naturale del raddoppio di una nota obbligata come la sensibile).\n'
                        + '• Illusione di simmetria: l’orecchio accetta queste imperfezioni perché la coerenza del disegno sequenziale compensa la mancanza di purezza nel collegamento.\n'
                        + '• Eccezione nel modo minore: spesso, per evitare il problema, durante lo svolgimento della progressione si utilizza il 7° grado naturale (sottotono), reintroducendo la sensibile solo nella cadenza finale.\n'
                        + 'In sintesi, il raddoppio è permesso per non rompere l’uguaglianza dei passaggi.'
                        + ctxInfo
                    )
                    : (`Evita di raddoppiare il 7° grado: preferisci raddoppiare la tonica o la quinta.${ctxInfo}`),
                noteIds: leadingNotes.map(n => n.id),
            });

            // Optional visual aid: connect the doubled tendency tone.
            try {
                const sorted = leadingNotes
                    .filter(n => Number.isFinite(n.midi as any))
                    .slice()
                    .sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0));
                if (sorted.length >= 2) {
                    const low = sorted[0];
                    const high = sorted[sorted.length - 1];
                    const already = connections.some(c =>
                        c.ruleId === 'R-10' &&
                        c.type === 'vertical' &&
                        ((c.noteId1 === low.id && c.noteId2 === high.id) || (c.noteId1 === high.id && c.noteId2 === low.id))
                    );
                    if (!already) {
                        connections.push({
                            type: 'vertical',
                            noteId1: low.id,
                            noteId2: high.id,
                            severity: isInsideSequence ? 'exception' : 'error',
                            ruleId: 'R-10',
                        });
                    }
                }
            } catch { /* ignore */ }
        }

        // Additional doubling checks (classical SATB): avoid doubled chordal 7th,
        // and in 6/4 (2nd inversion triads) prefer doubling the 5th (bass).
        try {
            const isOrnamental = (n: StaffNote) =>
                Boolean((n as any).isPassing || (n as any).isNeighbor || (n as any).isAnticipation || (n as any).isAppoggiatura || (n as any).isEscape || (n as any).isSuspension);
            const harmonicPresent = present.filter(n => !isOrnamental(n));
            if (harmonicPresent.length >= 2) {
                const chordInfo = identifyChord(harmonicPresent);
                if (chordInfo?.root && chordInfo.intervals && chordInfo.intervals.size > 0) {
                    const rootPc = chordInfo.root.noteIndex;
                    const intervals = chordInfo.intervals;

                    const thirdInterval = intervals.has(4) ? 4 : (intervals.has(3) ? 3 : null);
                    const fifthInterval = intervals.has(7) ? 7 : (intervals.has(6) ? 6 : (intervals.has(8) ? 8 : null));
                    const seventhInterval = intervals.has(11) ? 11 : (intervals.has(10) ? 10 : (intervals.has(9) ? 9 : null));

                    const thirdPc = thirdInterval !== null ? mod12(rootPc + thirdInterval) : null;
                    const fifthPc = fifthInterval !== null ? mod12(rootPc + fifthInterval) : null;
                    const seventhPc = seventhInterval !== null ? mod12(rootPc + seventhInterval) : null;

                    const addDoublingViolation = (
                        ruleId: string,
                        severity: 'error' | 'warning' | 'exception',
                        description: string,
                        suggestion: string | undefined,
                        doubledNotes: StaffNote[]
                    ) => {
                        if (!doubledNotes || doubledNotes.length < 2) return;
                        addViolation({
                            ruleId,
                            severity,
                            description,
                            suggestion,
                            noteIds: doubledNotes.map(n => n.id),
                        });

                        // Make it visible on the staff overlay.
                        const sorted = doubledNotes
                            .filter(n => Number.isFinite(n.midi as any))
                            .slice()
                            .sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0));
                        if (sorted.length < 2) return;
                        const low = sorted[0];
                        const high = sorted[sorted.length - 1];
                        if (!low?.id || !high?.id || low.id === high.id) return;
                        const already = connections.some(c =>
                            c.ruleId === ruleId &&
                            c.type === 'vertical' &&
                            ((c.noteId1 === low.id && c.noteId2 === high.id) || (c.noteId1 === high.id && c.noteId2 === low.id))
                        );
                        if (already) return;
                        connections.push({
                            type: 'vertical',
                            noteId1: low.id,
                            noteId2: high.id,
                            severity,
                            ruleId,
                        });
                    };

                    // R-10-7TH: doubled chordal 7th (avoid in classical harmony).
                    // Guard: skip if the detected "7th" is actually the leading tone
                    // (already caught by R-10 above — avoids double-flagging when
                    // identifyChord picks a different root, e.g. C for {A,C,Eb}).
                    // Check both local (leadingPcAtEvent) and global (leadingPc)
                    // leading tone, because inferred modulation contexts may shift
                    // the local tonic beyond the sequence boundary.
                    if (seventhPc !== null && seventhPc !== leadingPcAtEvent && seventhPc !== leadingPc) {
                        const seventhNotes = harmonicPresent.filter(n => n.noteIndex === seventhPc);
                        if (seventhNotes.length >= 2) {
                            addDoublingViolation(
                                'R-10-7TH',
                                'error',
                                'Raddoppio della 7ª dell’accordo',
                                undefined,
                                seventhNotes
                            );
                        }
                    }

                    // R-10-DIM5: doubled diminished 5th (avoid — dissonant interval that must resolve).
                    // Applies to diminished triads (vii°) and half-diminished/diminished 7ths.
                    if (fifthPc !== null) {
                        const isDimFamily = [BuiltInChords.Diminished, BuiltInChords.Minor7b5, BuiltInChords.Diminished7].includes(chordInfo.type as any);
                        if (isDimFamily) {
                            const dim5Notes = harmonicPresent.filter(n => n.noteIndex === fifthPc);
                            if (dim5Notes.length >= 2) {
                                addDoublingViolation(
                                    'R-10-DIM5',
                                    'error',
                                    'Raddoppio della 5ª diminuita',
                                    undefined,
                                    dim5Notes
                                );
                            }
                        }
                    }

                    // R-10-64: in 6/4 (2nd inversion triads), prefer doubling the 5th (bass).
                    const isTriadQuality = [BuiltInChords.Major, BuiltInChords.Minor, BuiltInChords.Diminished, BuiltInChords.Augmented].includes(chordInfo.type as any);
                    if (isTriadQuality && thirdPc !== null && fifthPc !== null) {
                        const bass = pickPreferredBassNote(harmonicPresent) || harmonicPresent[0];
                        const bassIntervalFromRoot = bass ? mod12(bass.noteIndex - rootPc) : null;
                        const isSecondInversion = bassIntervalFromRoot !== null && (bassIntervalFromRoot === 7 || bassIntervalFromRoot === 6 || bassIntervalFromRoot === 8);

                        if (isSecondInversion) {
                            // Keep conservative to avoid noise: only when all voices are chord tones
                            // and exactly one chord member is doubled (typical 4-voice triad).
                            if (harmonicPresent.length === 4) {
                                const chordPcs = new Set<number>([rootPc, thirdPc, fifthPc]);
                                const pcsPresent = new Set<number>(harmonicPresent.map(n => n.noteIndex));
                                const allChordTones = [...pcsPresent].every(pc => chordPcs.has(pc));

                                if (allChordTones && pcsPresent.size === 3) {
                                    const rootNotes = harmonicPresent.filter(n => n.noteIndex === rootPc);
                                    const thirdNotes = harmonicPresent.filter(n => n.noteIndex === thirdPc);
                                    const fifthNotes = harmonicPresent.filter(n => n.noteIndex === fifthPc);

                                    if (fifthNotes.length < 2) {
                                        const doubled = (rootNotes.length >= 2) ? rootNotes : (thirdNotes.length >= 2 ? thirdNotes : []);
                                        if (doubled.length >= 2) {
                                            addDoublingViolation(
                                                'R-10-64',
                                                'warning',
                                                'Raddoppio atipico in 6/4 (2ª inversione)',
                                                undefined,
                                                doubled
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // R-10-3RD: preference rule — in root-position major/minor triads, avoid doubling the 3rd.
                    // (Conservative: only when all voices are chord tones and the voicing is a plain 4-voice triad.)
                    const isMajorOrMinorTriad = [BuiltInChords.Major, BuiltInChords.Minor].includes(chordInfo.type as any);
                    if (isMajorOrMinorTriad && thirdPc !== null && fifthPc !== null) {
                        const bass = harmonicPresent
                            .filter(n => Number.isFinite(n.midi as any))
                            .slice()
                            .sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                        const bassIntervalFromRoot = bass ? mod12(bass.noteIndex - rootPc) : null;
                        const isRootPosition = bassIntervalFromRoot === 0;

                        if (isRootPosition && harmonicPresent.length === 4) {
                            const chordPcs = new Set<number>([rootPc, thirdPc, fifthPc]);
                            const pcsPresent = new Set<number>(harmonicPresent.map(n => n.noteIndex));
                            const allChordTones = [...pcsPresent].every(pc => chordPcs.has(pc));

                            if (allChordTones && pcsPresent.size === 3) {
                                const rootNotes = harmonicPresent.filter(n => n.noteIndex === rootPc);
                                const thirdNotes = harmonicPresent.filter(n => n.noteIndex === thirdPc);
                                // Avoid duplicating the stronger leading-tone rule.
                                const thirdIsLeadingTone = thirdPc === leadingPcAtEvent;

                                // Common-practice exception: on ii in major (supertonic triad),
                                // doubling the 3rd (scale-degree 4) is often perfectly acceptable.
                                // This preference warning is meant to be conservative, so skip ii.
                                let allowThirdDoublingHere = false;
                                try {
                                    const ctx = getContextAtAbsBeat(ev.absBeat);
                                    const tonicIndex = noteNameToIndex[ctx.tonic];
                                    const tonicPcCtx = Number.isFinite(tonicIndex as any) ? mod12(tonicIndex as number) : null;
                                    // User rule: if the doubled note is a strong tonal degree (I/IV/V)
                                    // in the active context, allow it even if it's the chordal 3rd.
                                    if (tonicPcCtx !== null) {
                                        const strongTonal = new Set<number>([
                                            tonicPcCtx, // I
                                            mod12(tonicPcCtx + 5), // IV
                                            mod12(tonicPcCtx + 7), // V
                                        ]);
                                        if (strongTonal.has(thirdPc)) {
                                            allowThirdDoublingHere = true;
                                        }
                                    }
                                    const scaleIntervals = ctx.isMinor ? [0, 2, 3, 5, 7, 8, 11] : [0, 2, 4, 5, 7, 9, 11];
                                    const degreeOfPc = (pc: number): number | null => {
                                        if (!Number.isFinite(tonicIndex)) return null;
                                        const rel = mod12(pc - tonicIndex);
                                        const idx = scaleIntervals.indexOf(rel);
                                        return idx >= 0 ? (idx + 1) : null;
                                    };
                                    const rootDegree = degreeOfPc(rootPc);
                                    // Only relax in major; in minor, ii is diminished and this block doesn't apply.
                                    if (!ctx.isMinor && rootDegree === 2) {
                                        allowThirdDoublingHere = true;
                                    }
                                } catch { /* ignore */ }

                                if (!allowThirdDoublingHere && !thirdIsLeadingTone && thirdNotes.length >= 2 && rootNotes.length === 1) {
                                    // Attenuation inside imitated progressions (sequences): prefer the melodic symmetry.
                                    let isInsideSequence = false;
                                    try {
                                        const tick = (() => {
                                            const t = thirdNotes
                                                .map(n => Number((n as any).startTick))
                                                .filter(x => Number.isFinite(x));
                                            return t.length ? Math.min(...t) : null;
                                        })();
                                        isInsideSequence = isTickInsideImitatedSequence(tick);
                                    } catch { /* ignore */ }

                                    const generic =
                                        'Raddoppio della Terza\n'
                                        + 'Rilevato raddoppio della terza in un accordo in stato fondamentale.\n'
                                        + 'Regola: Prediligere il raddoppio della fondamentale (o della quinta) per garantire stabilità, specialmente se la terza è maggiore.\n'
                                        + '• ℹ️ Info: Licenza in Progressione Imitata\n'
                                        + 'Raddoppio della terza rilevato all\'interno di una sequenza. L\'errore è tollerato poiché la necessità di mantenere la simmetria del disegno melodico tra modello e imitazione prevale sulla purezza del raddoppio.\n'
                                        + '• ✅ Eccezione: Cadenza d\'Inganno (V-VI)\n'
                                        + 'Il raddoppio della terza nell\'accordo di VI grado (che corrisponde alla tonica) è raccomandato per favorire una corretta condotta delle voci ed evitare ottave parallele.\n'
                                        + '• ✅ Eccezione: Accordo Napoletano (bII)\n'
                                        + 'In questo contesto, il raddoppio della terza (IV grado della scala) è la scelta preferibile per sottolineare la funzione tonale dell\'accordo.\n'
                                        + '• ✅ Attenuazione: Primo Rivolto (Accordo di Sesta)\n'
                                        + 'Il raddoppio della terza (nota al basso) è accettabile se tale nota è un grado forte della scala (I, IV o V), altrimenti è preferibile raddoppiare la fondamentale o la quinta.\n'
                                        + '• ℹ️ Nota di Stile: Accordi Minori\n'
                                        + 'La gravità del warning è ridotta se l\'accordo è minore; il raddoppio della terza minore è considerato molto più accettabile rispetto a quello della terza maggiore.';

                                    addDoublingViolation(
                                        'R-10-3RD',
                                        isInsideSequence ? 'exception' : 'warning',
                                        isInsideSequence
                                            ? 'Raddoppio atipico: 3ª raddoppiata in stato fondamentale (tollerato in sequenza/imitazione)'
                                            : 'Raddoppio atipico: 3ª raddoppiata in stato fondamentale',
                                        generic,
                                        thirdNotes
                                    );
                                }
                            }
                        }
                    }

                    // R-10-6: first inversion (6) doubling preference based on strong/weak scale degrees.
                    // - If the bass (which is the chord 3rd) is a strong degree (I/IV/V; sometimes II), doubling it is acceptable/preferable.
                    // - If the bass is a weak degree (III/VI/VII), avoid doubling it; prefer doubling a strong degree present in the chord.
                    if (isMajorOrMinorTriad && thirdPc !== null && fifthPc !== null) {
                        // In compound meters, skip this preference on internal 8th subdivisions:
                        // arpeggiated bass figures will otherwise be misread as the chord-bass choice.
                        if (!isStrongPulseBeatInMeasure(ev.beat ?? 1, timeSignature)) {
                            // keep other rules active; this is just a preference heuristic.
                            // eslint-disable-next-line no-useless-return
                            return;
                        }

                        const bass = pickPreferredBassNote(harmonicPresent) || harmonicPresent[0];
                        const bassIntervalFromRoot = bass ? mod12(bass.noteIndex - rootPc) : null;
                        const isFirstInversion = bassIntervalFromRoot !== null && (bassIntervalFromRoot === 3 || bassIntervalFromRoot === 4);

                        if (isFirstInversion && harmonicPresent.length === 4) {
                            const chordPcs = new Set<number>([rootPc, thirdPc, fifthPc]);
                            const pcsPresent = new Set<number>(harmonicPresent.map(n => n.noteIndex));
                            const allChordTones = [...pcsPresent].every(pc => chordPcs.has(pc));

                            if (allChordTones && pcsPresent.size === 3 && bass) {
                                const rootNotes = harmonicPresent.filter(n => n.noteIndex === rootPc);
                                const thirdNotes = harmonicPresent.filter(n => n.noteIndex === thirdPc);
                                const fifthNotes = harmonicPresent.filter(n => n.noteIndex === fifthPc);

                                const doubledPc = (rootNotes.length >= 2) ? rootPc : (thirdNotes.length >= 2 ? thirdPc : (fifthNotes.length >= 2 ? fifthPc : null));
                                if (doubledPc !== null) {
                                    const ctx = getContextAtAbsBeat(ev.absBeat);
                                    const tonicIndex = noteNameToIndex[ctx.tonic];
                                    const scaleIntervals = ctx.isMinor ? [0, 2, 3, 5, 7, 8, 11] : [0, 2, 4, 5, 7, 9, 11];
                                    const degreeOfPc = (pc: number): number | null => {
                                        if (!Number.isFinite(tonicIndex)) return null;
                                        const rel = mod12(pc - tonicIndex);
                                        const idx = scaleIntervals.indexOf(rel);
                                        return idx >= 0 ? (idx + 1) : null;
                                    };

                                    const bassDegree = degreeOfPc(bass.noteIndex);
                                    const strongDegreesPrimary = new Set<number>([1, 4, 5]);
                                    const strongDegreesSecondary = new Set<number>([2]); // “talvolta II”
                                    const isStrongDegree = (deg: number | null) => (deg !== null) && (strongDegreesPrimary.has(deg) || strongDegreesSecondary.has(deg));
                                    const isWeakDegree = (deg: number | null) => (deg !== null) && !isStrongDegree(deg);

                                    const chordStrongPcs = [rootPc, thirdPc, fifthPc].filter(pc => isStrongDegree(degreeOfPc(pc)));
                                    const doubledIsStrong = isStrongDegree(degreeOfPc(doubledPc));

                                    // Case A: bass is strong degree -> doubling the bass is often good,
                                    // but doubling the fundamental is also perfectly acceptable/preferable.
                                    // Warn only when neither bass nor root is doubled.
                                    // Attenuation inside imitated progressions (sequences): prefer melodic symmetry.
                                    let isInsideSequence = false;
                                    try {
                                        const tick = Number((bass as any)?.startTick);
                                        isInsideSequence = isTickInsideImitatedSequence(Number.isFinite(tick) ? tick : null);
                                    } catch { /* ignore */ }

                                    const generic =
                                        'Raddoppio della Terza\n'
                                        + 'Rilevato raddoppio della terza (o scelta di raddoppio non ottimale) in un accordo.\n'
                                        + 'Regola: Prediligere il raddoppio della fondamentale (o della quinta) per garantire stabilità, specialmente se la terza è maggiore.\n'
                                        + '• ℹ️ Info: Licenza in Progressione Imitata\n'
                                        + 'Raddoppio della terza rilevato all\'interno di una sequenza. L\'errore è tollerato poiché la necessità di mantenere la simmetria del disegno melodico tra modello e imitazione prevale sulla purezza del raddoppio.\n'
                                        + '• ✅ Eccezione: Cadenza d\'Inganno (V-VI)\n'
                                        + 'Il raddoppio della terza nell\'accordo di VI grado (che corrisponde alla tonica) è raccomandato per favorire una corretta condotta delle voci ed evitare ottave parallele.\n'
                                        + '• ✅ Eccezione: Accordo Napoletano (bII)\n'
                                        + 'In questo contesto, il raddoppio della terza (IV grado della scala) è la scelta preferibile per sottolineare la funzione tonale dell\'accordo.\n'
                                        + '• ✅ Attenuazione: Primo Rivolto (Accordo di Sesta)\n'
                                        + 'Il raddoppio della terza (nota al basso) è accettabile se tale nota è un grado forte della scala (I, IV o V), altrimenti è preferibile raddoppiare la fondamentale o la quinta.\n'
                                        + '• ℹ️ Nota di Stile: Accordi Minori\n'
                                        + 'La gravità del warning è ridotta se l\'accordo è minore; il raddoppio della terza minore è considerato molto più accettabile rispetto a quello della terza maggiore.';

                                    if (isStrongDegree(bassDegree) && doubledPc !== bass.noteIndex && doubledPc !== rootPc) {
                                        addViolation({
                                            ruleId: 'R-10-6',
                                            severity: isInsideSequence ? 'exception' : 'warning',
                                            description: isInsideSequence
                                                ? 'Preferenza di raddoppio in 6: basso su grado forte (tollerato in sequenza/imitazione)'
                                                : 'Preferenza di raddoppio in 6: basso su grado forte',
                                            suggestion: generic + '\n\n' + 'Dettaglio caso: In un accordo in primo rivolto, se il basso (3ª dell’accordo) è un grado forte (I/IV/V; talvolta II), è spesso preferibile raddoppiare il basso (oppure la fondamentale) invece della 5ª.',
                                            noteIds: [bass.id, ...harmonicPresent.filter(n => n.noteIndex === doubledPc).map(n => n.id)],
                                        });
                                        // Make it visible on the staff overlay.
                                        const doubledArr = harmonicPresent.filter(n => n.noteIndex === doubledPc);
                                        const allRelevant = [bass, ...doubledArr].filter(n => Number.isFinite(n.midi as any)).sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0));
                                        if (allRelevant.length >= 2) {
                                            const lo = allRelevant[0], hi = allRelevant[allRelevant.length - 1];
                                            if (lo.id !== hi.id && !connections.some(c => c.ruleId === 'R-10-6' && c.type === 'vertical' && ((c.noteId1 === lo.id && c.noteId2 === hi.id) || (c.noteId1 === hi.id && c.noteId2 === lo.id)))) {
                                                connections.push({ type: 'vertical', noteId1: lo.id, noteId2: hi.id, severity: isInsideSequence ? 'exception' : 'warning', ruleId: 'R-10-6' });
                                            }
                                        }
                                    }

                                    // Case B: bass is weak degree -> avoid doubling bass; prefer doubling a strong degree present.
                                    if (isWeakDegree(bassDegree) && doubledPc === bass.noteIndex) {
                                        // Only complain if there exists a strong degree in the chord to double instead.
                                        if (chordStrongPcs.length > 0) {
                                            addDoublingViolation(
                                                'R-10-6',
                                                isInsideSequence ? 'exception' : 'warning',
                                                isInsideSequence
                                                    ? 'Preferenza di raddoppio in 6: basso su grado debole (tollerato in sequenza/imitazione)'
                                                    : 'Preferenza di raddoppio in 6: basso su grado debole',
                                                generic + '\n\n' + 'Dettaglio caso: Se il basso (3ª dell’accordo) è un grado debole (III/VI/VII), di norma si evita di raddoppiarlo; preferisci raddoppiare un grado forte presente nell’accordo (I/IV/V; talvolta II).',
                                                harmonicPresent.filter(n => n.noteIndex === bass.noteIndex)
                                            );
                                        }
                                    } else if (isWeakDegree(bassDegree) && !doubledIsStrong && chordStrongPcs.length > 0) {
                                        // Very soft nudge: if you’re doubling a weak degree while a strong one is available, prefer the strong.
                                        const doubledNotes = harmonicPresent.filter(n => n.noteIndex === doubledPc);
                                        if (doubledNotes.length >= 2) {
                                            addDoublingViolation(
                                                'R-10-6',
                                                isInsideSequence ? 'exception' : 'warning',
                                                isInsideSequence
                                                    ? 'Preferenza di raddoppio in 6: scegli un grado forte (tollerato in sequenza/imitazione)'
                                                    : 'Preferenza di raddoppio in 6: scegli un grado forte',
                                                generic + '\n\n' + 'Dettaglio caso: Con basso su grado debole, è spesso più stabile raddoppiare un grado forte presente nell’accordo (I/IV/V; talvolta II) invece di raddoppiare un grado debole.',
                                                doubledNotes
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch { /* ignore */ }

        // R-04 / EXC-S02: voice crossing (spelling-first MIDI)
        if (v4 && v3 && Number.isFinite(effectiveMidi(v4 as any) as any) && Number.isFinite(effectiveMidi(v3 as any) as any)
            && (effectiveMidi(v4 as any) as number) > (effectiveMidi(v3 as any) as number)) {
            addViolation({
                ruleId: 'R-04',
                severity: 'error',
                description: 'Incrocio di voci grave (Basso sopra Tenore)',
                suggestion: 'Riordina le altezze: Basso deve restare sotto il Tenore.',
                noteIds: [v4.id, v3.id],
            });
        }
        if (v3 && v2 && Number.isFinite(effectiveMidi(v3 as any) as any) && Number.isFinite(effectiveMidi(v2 as any) as any)
            && (effectiveMidi(v3 as any) as number) > (effectiveMidi(v2 as any) as number)) {
            // tolerated case: Alto/Tenore
            addViolation({
                ruleId: 'EXC-S02',
                severity: 'warning',
                description: 'Incrocio Alto/Tenore (tollerato)',
                suggestion: 'Di norma evita l’incrocio; può essere accettabile per esigenze melodiche.',
                noteIds: [v3.id, v2.id],
            });
            connections.push({ type: 'vertical', noteId1: v3.id, noteId2: v2.id, severity: 'warning', ruleId: 'EXC-S02' });
        }
        if (v2 && v1 && Number.isFinite(effectiveMidi(v2 as any) as any) && Number.isFinite(effectiveMidi(v1 as any) as any)
            && (effectiveMidi(v2 as any) as number) > (effectiveMidi(v1 as any) as number)) {
            addViolation({
                ruleId: 'R-04',
                severity: 'error',
                description: 'Incrocio di voci grave (Alto sopra Soprano)',
                suggestion: 'Riordina le altezze: Alto deve restare sotto il Soprano.',
                noteIds: [v2.id, v1.id],
            });
        }

        // R-08: excessive spacing (S-A, A-T > octave)
        if (v1 && v2) {
            const m1 = effectiveMidi(v1 as any);
            const m2 = effectiveMidi(v2 as any);
            if (Number.isFinite(m1 as any) && Number.isFinite(m2 as any) && ((m1 as number) - (m2 as number)) > 12) {
            addViolation({
                ruleId: 'R-08',
                severity: 'warning',
                description: 'Spaziatura eccessiva tra Soprano e Alto (> 8va)',
                suggestion: 'Avvicina Alto e Soprano entro l’ottava.',
                noteIds: [v1.id, v2.id],
            });
            connections.push({ type: 'vertical', noteId1: v1.id, noteId2: v2.id, severity: 'warning', ruleId: 'R-08' });
            }
        }
        if (v2 && v3) {
            const m2 = effectiveMidi(v2 as any);
            const m3 = effectiveMidi(v3 as any);
            if (Number.isFinite(m2 as any) && Number.isFinite(m3 as any) && ((m2 as number) - (m3 as number)) > 12) {
            addViolation({
                ruleId: 'R-08',
                severity: 'warning',
                description: 'Spaziatura eccessiva tra Alto e Tenore (> 8va)',
                suggestion: 'Avvicina Tenore e Alto entro l’ottava.',
                noteIds: [v2.id, v3.id],
            });
            connections.push({ type: 'vertical', noteId1: v2.id, noteId2: v3.id, severity: 'warning', ruleId: 'R-08' });
            }
        }

        // Very conservative: flag *extremely* wide Tenor–Bass spacing.
        // (TB can easily be a 12th+ in chorales; warn only for truly extreme spreads.)
        if (v3 && v4) {
            const m3 = effectiveMidi(v3 as any);
            const m4 = effectiveMidi(v4 as any);
            if (Number.isFinite(m3 as any) && Number.isFinite(m4 as any) && ((m3 as number) - (m4 as number)) > 31) {
            addViolation({
                ruleId: 'R-SPACING-TB',
                severity: 'warning',
                description: 'Spaziatura eccessiva tra Tenore e Basso (> 2 ottave + 5a)',
                suggestion: 'Valuta di avvicinare Tenore e Basso per una tessitura più compatta.',
                noteIds: [v3.id, v4.id],
            });

            // Make it visible on the staff overlay as a vertical dashed line.
            const already = connections.some(c =>
                c.ruleId === 'R-SPACING-TB' &&
                c.type === 'vertical' &&
                ((c.noteId1 === v3.id && c.noteId2 === v4.id) || (c.noteId1 === v4.id && c.noteId2 === v3.id))
            );
            if (!already) {
                connections.push({
                    type: 'vertical',
                    noteId1: v3.id,
                    noteId2: v4.id,
                    severity: 'warning',
                    ruleId: 'R-SPACING-TB',
                });
            }
            }
        }
    });

    _pmark('09d-end-modulation+neapolitan');

    // ── R-18: Simultaneous chromatic clash ──────────────────────────
    // Two notes with the same letter name but different accidentals sounding
    // at the same time (e.g. B natural + Bb in the same chord).
    const accSymbol = (n: StaffNote): string => {
        const a = String((n as any).explicitAccidental ?? (n as any).accidental ?? '').toLowerCase();
        if (a === 'sharp') return '♯';
        if (a === 'flat') return '♭';
        if (a === 'double-sharp') return '𝄪';
        if (a === 'double-flat') return '𝄫';
        if (a === 'natural') return '♮';
        return '';
    };
    try {
        for (const ev of chordEvents) {
            const present = ev.notes.filter(n => n && !(n as any).isRest) as StaffNote[];
            if (present.length < 2) continue;
            // Group by letter name (A–G)
            const byLetter = new Map<string, StaffNote[]>();
            for (const n of present) {
                const letter = String((n as any).pitch || '').toUpperCase();
                if (!letter) continue;
                const arr = byLetter.get(letter) || [];
                arr.push(n);
                byLetter.set(letter, arr);
            }
            for (const [, group] of byLetter) {
                if (group.length < 2) continue;
                // Collect distinct pitch classes (midi % 12) within same letter
                const pcNotes = new Map<number, StaffNote>();
                for (const n of group) {
                    const pc = ((Number((n as any).midi) % 12) + 12) % 12;
                    if (!pcNotes.has(pc)) pcNotes.set(pc, n);
                }
                if (pcNotes.size < 2) continue;
                // Same letter, different accidentals → clash
                const entries = [...pcNotes.values()];
                for (let i = 0; i < entries.length - 1; i++) {
                    for (let j = i + 1; j < entries.length; j++) {
                        const n1 = entries[i], n2 = entries[j];
                        const msg = `Scontro cromatico: ${(n1 as any).pitch}${accSymbol(n1)} e ${(n2 as any).pitch}${accSymbol(n2)} suonano contemporaneamente.`;
                        addViolation({
                            ruleId: 'R-18',
                            description: msg,
                            noteIds: [(n1 as any).id, (n2 as any).id],
                            severity: 'error',
                        });
                        corrections.push({
                            message: msg,
                            type: 'vertical',
                            noteId1: (n1 as any).id,
                            noteId2: (n2 as any).id,
                            severity: 'error',
                            ruleId: 'R-18',
                        });
                    }
                }
            }
        }
    } catch { /* ignore */ }

    _pmark('10-verticalChecks');
    // =========================================================
    // Horizontal checks (between consecutive chords)
    // =========================================================
    // Pre-compute last measure index for cadence exception detection
    const lastMI = analyzedNotes.reduce((mx, n) => Math.max(mx, n.measureIndex ?? 0), 0);
    const isOrnamental = (n: StaffNote | undefined | null): boolean => {
        if (!n) return false;
        try {
            const anyN = n as any;
            if (anyN.ornamentOverride && anyN.ornamentOverride !== 'structural') return true;
            return Boolean(anyN.isPassing || anyN.isNeighbor || anyN.isAnticipation || anyN.isAppoggiatura || anyN.isEscape || anyN.isSuspension);
        } catch {
            return false;
        }
    };

    const getStructuralNotes = (ev: ChordEvent): StaffNote[] => {
        const sounding = (ev.notes || []).filter(n => n && !n.isRest);
        const harmonic = sounding.filter(n => !isOrnamental(n));
        // Fallback: if filtering removes everything (e.g. sparse textures), keep sounding notes.
        return harmonic.length >= 2 ? harmonic : sounding;
    };

    const findNextStructuralVoiceNote = (
        fromIndex: number,
        voice: Voice,
        currentNoteId: string | undefined
    ): { note: StaffNote; index: number } | null => {
        for (let j = fromIndex + 1; j < chordEvents.length; j++) {
            const n = chordEvents[j].byVoice.get(voice);
            if (!n || n.isRest) continue;
            if (currentNoteId && n.id === currentNoteId) continue;
            if (isOrnamental(n)) continue;
            return { note: n, index: j };
        }
        return null;
    };

    // If a leading-tone note (same noteId) has already been validated as resolved or covered by an
    // explicit exception, don't re-flag it in subsequent chord-to-chord checks.
    const handledLeadingToneIds = new Set<string>();

    for (let i = 0; i < chordEvents.length - 1; i++) {
        const a = chordEvents[i];
        const b = chordEvents[i + 1];

        // ROTTURA DIDATTICA
        if (doubleBarlineMeasures && doubleBarlineMeasures.length > 0) {
            if (a.measureIndex !== b.measureIndex && doubleBarlineMeasures.includes(a.measureIndex)) continue;
        }

        // Use structural notes (ignore ornaments) and spelling-first MIDI for motion rules.
        // This avoids false positives on passing/neighbor notes and on stale MIDI fields.
        const byVoiceStructural = (ev: ChordEvent): Partial<Record<Voice, StaffNote>> => {
            const out: Partial<Record<Voice, StaffNote>> = {};
            for (const n of getStructuralNotes(ev)) {
                const v = (n.voice ?? 1) as Voice;
                if (v === 1 || v === 2 || v === 3 || v === 4) out[v] = n;
            }
            return out;
        };

        const aV = byVoiceStructural(a);
        const bV = byVoiceStructural(b);

        const voices: Voice[] = [1, 2, 3, 4];

        // R-13: all voices move in same direction
        // Skip on pure revoicing/inversion where the harmony (pitch-class set) stays the same.
        // These situations often involve all voices shifting but are not the kind of
        // “parallel motion problem” this warning is meant to highlight.
        const sameHarmonyPcSet = (() => {
            try {
                const pcsA = new Set<number>(getStructuralNotes(a).map(n => mod12(pitchClassOf(n as any))));
                const pcsB = new Set<number>(getStructuralNotes(b).map(n => mod12(pitchClassOf(n as any))));
                if (pcsA.size < 2 || pcsB.size < 2) return false;
                if (pcsA.size !== pcsB.size) return false;
                for (const pc of pcsA) if (!pcsB.has(pc)) return false;
                return true;
            } catch {
                return false;
            }
        })();

        const dirs: number[] = [];
        voices.forEach(v => {
            const n1 = aV[v];
            const n2 = bV[v];
            if (!n1 || !n2) return;
            const m1 = effectiveMidi(n1 as any);
            const m2 = effectiveMidi(n2 as any);
            if (!Number.isFinite(m1 as any) || !Number.isFinite(m2 as any)) return;
            const d = dir(m1 as number, m2 as number);
            dirs.push(d);
        });
        // La regola scatta solo se tutte le voci si muovono (nessun d === 0) e tutte nella stessa direzione
        if (!sameHarmonyPcSet && dirs.length === 4 && dirs.every(d => d !== 0) && dirs.every(d => d === dirs[0])) {
            const notePairs = voices.map(v => ({ a: aV[v], b: bV[v] })).filter(pair => pair.a && pair.b);

            // Attenuation inside imitated progressions (sequences): the model/repetition symmetry
            // often implies the same-direction motion across parts.
            let isInsideSequence = false;
            try {
                const tick = (() => {
                    const t = notePairs
                        .map(p => Number((p.b as any)?.startTick))
                        .filter(x => Number.isFinite(x));
                    return t.length ? Math.min(...t) : null;
                })();
                isInsideSequence = isTickInsideImitatedSequence(tick);
            } catch { /* ignore */ }

            const sopranoStepwise = (() => {
                try {
                    const sA = aV[1];
                    const sB = bV[1];
                    if (!sA || !sB) return false;
                    const mA = effectiveMidi(sA as any);
                    const mB = effectiveMidi(sB as any);
                    if (!Number.isFinite(mA as any) || !Number.isFinite(mB as any)) return false;
                    return Math.abs((mB as number) - (mA as number)) <= 2;
                } catch {
                    return false;
                }
            })();

            const severity: RuleViolation['severity'] = (isInsideSequence || sopranoStepwise) ? 'exception' : 'warning';
            addViolation({
                ruleId: 'R-13',
                severity,
                description: sopranoStepwise
                    ? 'Moto parallelo di tutte le voci (attenuato: Soprano per grado congiunto)'
                    : (isInsideSequence
                        ? 'Moto parallelo di tutte le voci (tollerato in sequenza/imitazione)'
                        : 'Moto parallelo di tutte le voci'),
                suggestion: sopranoStepwise
                    ? 'Tutte le voci si muovono nella stessa direzione. Sebbene il movimento per grado congiunto del Soprano attenui l’effetto, si consiglia un moto contrario in almeno una parte (es. salto d’ottava al Basso) per preservare l’indipendenza.'
                    : (isInsideSequence
                        ? 'Nelle progressioni imitate (sequenze), la simmetria tra modello e imitazione può rendere naturale il moto nella stessa direzione. L’avviso è tollerato per non penalizzare la coerenza del disegno sequenziale; se vuoi “pulire” lo stile, prova a introdurre moto contrario o obliquo in almeno una parte.'
                        : 'Preferisci introdurre moto contrario o obliquo per dare indipendenza alle linee.'),
                noteIds: notePairs.flatMap(pair => [pair.a!.id, pair.b!.id]),
            });
            // Add errorConnections for overlay rendering
            notePairs.forEach(pair => {
                connections.push({
                    type: 'horizontal',
                    noteId1: pair.a!.id,
                    noteId2: pair.b!.id,
                    severity,
                    ruleId: 'R-13',
                });
            });
        }

        // R-14: hidden/direct 5ths/8ves in outer voices (similar motion into a perfect interval)
        const sopA = aV[1];
        const sopB = bV[1];
        const basA = aV[4];
        const basB = bV[4];
        if (sopA && sopB && basA && basB) {
            const sA = effectiveMidi(sopA as any);
            const sB = effectiveMidi(sopB as any);
            const bA = effectiveMidi(basA as any);
            const bB = effectiveMidi(basB as any);
            if (!Number.isFinite(sA as any) || !Number.isFinite(sB as any) || !Number.isFinite(bA as any) || !Number.isFinite(bB as any)) {
                // skip
            } else {
                const dS = dir(sA as number, sB as number);
                const dB = dir(bA as number, bB as number);
                const sopranoMelodicInterval = Math.abs((sB as number) - (sA as number));

                  const intA = mod12(Math.abs((sA as number) - (bA as number)));
                const intB = mod12(Math.abs((sB as number) - (bB as number)));
                const approachesPerfect = isPerfectOctaveOrUnison(intB) || isPerfectFifth(intB);
                  const departurePerfect = isPerfectOctaveOrUnison(intA) || isPerfectFifth(intA);
                  // Skip only true parallels (same interval type: P5→P5 or P8→P8), handled by R-01/R-02.
                  // Cross-type (P8→P5, P5→P8) must still be detected as hidden/direct.
                  const sameTypePerfect14 = departurePerfect && (isPerfectFifth(intA) === isPerfectFifth(intB));
                  if (approachesPerfect && !sameTypePerfect14 && dS !== 0 && dS === dB) {
                    // Hidden 8ves: only tolerate if soprano moves by semitone (m2 = 1 semitone)
                    // Hidden 5ths: tolerate if soprano moves by step (m2 or M2 ≤ 2 semitones)
                    const isHiddenOctave = isPerfectOctaveOrUnison(intB);
                    const tolerateStep = isHiddenOctave
                      ? sopranoMelodicInterval === 1   // only semitone excuses hidden 8ve
                      : sopranoMelodicInterval <= 2;   // m2 or M2 excuses hidden 5th
                    const ruleId = tolerateStep ? 'EXC-Hidden-Stepwise' : 'R-14';
                    const severity = tolerateStep ? 'exception' : 'warning';

                    addViolation({
                        ruleId,
                        severity,
                        description: severity === 'exception'
                            ? 'Moto retto/nascosto ammesso (Soprano per grado congiunto)'
                            : isHiddenOctave && sopranoMelodicInterval <= 2
                            ? 'Ottave nascoste tra voci estreme: il Soprano procede per 2ª maggiore (non per semitono)'
                            : 'Quinte/ottave nascoste tra voci estreme (moto simile)',
                        suggestion: severity === 'exception'
                            ? 'Eccezione classica: il Soprano si muove per grado congiunto.'
                            : isHiddenOctave && sopranoMelodicInterval <= 2
                            ? 'Le ottave nascoste sono tollerate solo se il Soprano procede per semitono (2ª minore). Con 2ª maggiore, preferisci moto contrario.'
                            : 'Evita il moto simile verso 5a/8va tra Soprano e Basso; preferisci moto contrario o riduci il salto del Soprano.',
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });

                    // Add errorConnections for overlay rendering
                    connections.push({
                        type: 'horizontal',
                        noteId1: sopA.id,
                        noteId2: sopB.id,
                        severity,
                        ruleId,
                    });
                    connections.push({
                        type: 'horizontal',
                        noteId1: basA.id,
                        noteId2: basB.id,
                        severity,
                        ruleId,
                    });
                }
            }
        }

        // R-09: false relation chromatic
        // Compare pitch letters with different accidentals across voices between consecutive chords.
        const notesA = a.notes.filter(n => !n.isRest);
        const notesB = b.notes.filter(n => !n.isRest);
        const normAcc = (a: any) => (a ?? 'natural');
        for (const n1 of notesA) {
            const p1 = (n1.pitch || '').toUpperCase();
            const acc1 = (n1.explicitAccidental ?? n1.accidental ?? null) as AccidentalType | null;
            if (!p1) continue;
            for (const n2 of notesB) {
                if ((n1.voice ?? 1) === (n2.voice ?? 1)) continue;
                const p2 = (n2.pitch || '').toUpperCase();
                if (p1 !== p2) continue;
                // Guard: if noteIndex (spelled pitch class) is the same, no false relation.
                // Generated notes may omit 'accidental' but noteIndex encodes the correct PC.
                const ni1 = (n1 as any).noteIndex;
                const ni2 = (n2 as any).noteIndex;
                if (ni1 != null && ni2 != null && ((ni1 % 12 + 12) % 12) === ((ni2 % 12 + 12) % 12)) continue;
                const acc2 = (n2.explicitAccidental ?? n2.accidental ?? null) as AccidentalType | null;
                if (normAcc(acc1) !== normAcc(acc2)) {
                    // Exception: if the pitch letter that would create the false relation does NOT
                    // persist across the change in its own voice (i.e. that voice moves away),
                    // do not flag R-09. This prevents over-reporting when both voices move.
                    // However, ONLY skip when n2's voice already had that same letter in chord A
                    // (i.e. the chromatic alteration is a continuation, not a fresh introduction).
                    try {
                        const v1 = (n1.voice ?? 1) as Voice;
                        const nextSameVoice = bV[v1] as StaffNote | undefined;
                        if (!nextSameVoice) {
                            continue;
                        }
                        const pNext = (nextSameVoice.pitch || '').toUpperCase();
                        if (pNext !== p1) {
                            // n1's voice moved away — only skip if n2's voice
                            // already had the same pitch letter in chord A
                            // (continuing / modifying an existing note, not
                            // introducing a fresh chromatic clash).
                            const prevInN2Voice = aV[(n2.voice ?? 1) as Voice] as StaffNote | undefined;
                            const pPrevN2 = (prevInN2Voice?.pitch || '').toUpperCase();
                            if (pPrevN2 === p2) {
                                continue;
                            }
                            // else: n2 introduces the pitch letter fresh → real false relation
                        }
                        // Symmetric attenuation: chromatic motion in the *same voice* of n1.
                        const accNext = (nextSameVoice.explicitAccidental ?? nextSameVoice.accidental ?? null) as AccidentalType | null;
                        if (normAcc(accNext) !== normAcc(acc1)) {
                            continue;
                        }
                    } catch {
                        // ignore
                    }

                    // Exception: chromatic motion in the *same voice* attenuates the false relation.
                    // If the voice of n2 already had the same letter in chord A with a different accidental,
                    // we skip the R-09 violation.
                    try {
                        const prevSameVoice = aV[(n2.voice ?? 1) as Voice] as StaffNote | undefined;
                        if (prevSameVoice) {
                            const pPrev = (prevSameVoice.pitch || '').toUpperCase();
                            const accPrev = (prevSameVoice.explicitAccidental ?? prevSameVoice.accidental ?? null) as AccidentalType | null;
                            if (pPrev === p2 && normAcc(accPrev) !== normAcc(acc2)) {
                                continue;
                            }
                        }
                    } catch {
                        // ignore
                    }
                    addViolation({
                        ruleId: 'R-09',
                        severity: 'error',
                        description: 'Falsa relazione cromatica',
                        suggestion: 'Evita che una voce presenti una nota e un’altra la sua alterazione cromatica nel passaggio successivo.',
                        noteIds: [n1.id, n2.id],
                    });
                }
            }
        }

        // R-07: leading tone resolution (obbligo solo su V e vii°)
        const ctx = getContextAtAbsBeat(a.absBeat);
        const ctxTonicPc = (() => {
            const idx = noteNameToIndex[ctx.tonic];
            return Number.isFinite(idx) ? idx : tonicPc;
        })();
        const ctxLeadingPc = mod12(ctxTonicPc - 1);

        // Identifica il grado dell'accordo corrente
        const chordInfoA_R07 = identifyChord(getStructuralNotes(a));
        let isVorViidim = false;
        if (chordInfoA_R07 && chordInfoA_R07.root) {
            const rootPc = mod12(chordInfoA_R07.root.midi);
            const intervalFromTonic = mod12(rootPc - ctxTonicPc);
            // V grado: intervallo 7, vii°: intervallo 11 e tipo diminuito
            if (intervalFromTonic === 7) {
                isVorViidim = true;
            } else if (intervalFromTonic === 11 && chordInfoA_R07.type && chordInfoA_R07.type.toLowerCase().includes('diminished')) {
                isVorViidim = true;
            }
        }

        voices.forEach(v => {
            const n1 = aV[v];
            if (!n1) return;

            if (handledLeadingToneIds.has(n1.id)) return;

            // Look ahead to the next *structural* note change in this voice.
            // This avoids false positives when the next chord-event doesn't yet contain the resolution
            // (micro-events from anticipations/suspensions, held notes, etc.).
            const next = findNextStructuralVoiceNote(i, v, n1.id) ?? { note: bV[v] as StaffNote, index: i + 1 };
            const n2 = next?.note;
            const idx2 = next?.index;
            if (!n2) return;

            // Do not enforce leading-tone resolution on non-chord tones/ornaments.
            if (isOrnamental(n1) || isOrnamental(n2)) return;

            if ((n1.midi % 12) !== ctxLeadingPc) return;

            // Applica la regola SOLO se l'accordo è V o vii°
            if (!isVorViidim) return;

            // 1. PRIMA controlliamo se risolve regolarmente (salendo alla tonica)
            // Se lo fa, è perfetto: usciamo subito senza segnare nulla.
            const ok = stepUpToTonic(n1.midi, n2.midi, ctxTonicPc);
            if (ok) {
                handledLeadingToneIds.add(n1.id);
                return;
            }

            // Exception: delayed LT resolution through chromatic/stepwise passing motion.
            // If the next structural note after n2 reaches the tonic, and the whole motion is stepwise,
            // don't flag R-07 on the intermediate event.
            try {
                const next2 = (typeof idx2 === 'number') ? findNextStructuralVoiceNote(idx2, v, n2.id) : null;
                const n3 = next2?.note;
                if (n3) {
                    const step12 = (x: number, y: number) => {
                        const d = Math.abs((y ?? 0) - (x ?? 0));
                        return d > 0 && d <= 2;
                    };
                    const reachesTonic = (n3.midi % 12) === ctxTonicPc;
                    if (reachesTonic && step12(n1.midi, n2.midi) && step12(n2.midi, n3.midi)) {
                        handledLeadingToneIds.add(n1.id);
                        return;
                    }
                }
            } catch { /* ignore */ }

            // Guard-rail: if the *arrival harmony* (at the structural next event) does not
            // contain the tonic at all, do not flag "missing" LT resolution. This avoids
            // false positives in contexts like deceptive/redirected progressions where the
            // tonic is not harmonically available in the following sonority.
            try {
                const evB = (typeof idx2 === 'number' && chordEvents[idx2]) ? chordEvents[idx2] : b;
                const bStructural = getStructuralNotes(evB as any) || [];
                const pcsB = new Set(bStructural.filter(n => n && !n.isRest).map(n => mod12(n.noteIndex)));
                if (!pcsB.has(ctxTonicPc)) {
                    // The arrival chord does not contain the tonic — the LT cannot resolve
                    // to it regardless of voice. Skip R-07 entirely.
                    return;
                }
            } catch { /* ignore */ }

            // 2. SE NON RISOLVE, controlliamo se è un'eccezione ammessa (Dubois §19)
            // Voce interna (Alto/Tenore) e Soprano canta la tonica
            const isInternalVoice = v === 2 || v === 3;
            const sopranoAtIdx = (typeof idx2 === 'number') ? chordEvents[idx2]?.byVoice.get(1) : bV[1];
            const sopranoNext = sopranoAtIdx ?? bV[1];
            if (
                isInternalVoice &&
                sopranoNext &&
                (sopranoNext.midi % 12) === ctxTonicPc
            ) {
                addViolation({
                    ruleId: 'EXC-LT-Transfer',
                    severity: 'exception', // VERDE
                    description: 'Risoluzione trasferita della sensibile ',
                    suggestion: 'Ammesso perché la tonica è presa dal Soprano.',
                    noteIds: [n1.id, sopranoNext.id],
                });
                handledLeadingToneIds.add(n1.id);
                return; // Salva il paziente ed esci
            }

            // ── EXC-LT-FREE: Risoluzione libera della sensibile ────────
            // L'obbligo di risoluzione è sospeso quando l'accordo di arrivo
            // non è I né vi (contesti non cadenzali).  In questi casi la
            // sensibile è considerata melodicamente mobile e può scendere
            // per grado congiunto o saltare alla quinta dell'accordo
            // successivo per linearità o completezza armonica.
            // Condizioni:
            //   (a) accordo di destinazione ≠ I e ≠ vi, OPPURE
            //   (b) movimento congiunto discendente verso chord-tone di arrivo,
            //       con accordo di destinazione ≠ I.
            try {
                const evB2 = (typeof idx2 === 'number' && chordEvents[idx2]) ? chordEvents[idx2] : b;
                const arrStructural = getStructuralNotes(evB2 as any) || [];
                if (arrStructural.length >= 2) {
                    const arrChord = identifyChord(arrStructural);
                    if (arrChord && arrChord.root) {
                        const arrRootPc = mod12(arrChord.root.midi);
                        const arrInterval = mod12(arrRootPc - ctxTonicPc);
                        // arrInterval: 0 = I, 9 = vi (major), 8 = vi (minor)
                        const isTonicChord = arrInterval === 0;
                        const isVI = ctx.isMinor ? arrInterval === 8 : arrInterval === 9;
                        if (!isTonicChord && !isVI) {
                            // Non-cadential destination: leading tone is free
                            const stepDown = (n1.midi ?? 0) - (n2.midi ?? 0);
                            const descr = (stepDown >= 1 && stepDown <= 2)
                                ? 'Risoluzione libera della sensibile (discesa per grado congiunto)'
                                : 'Risoluzione libera della sensibile';
                            addViolation({
                                ruleId: 'EXC-LT-FREE',
                                severity: 'exception',
                                description: descr,
                                suggestion: 'L\'accordo di destinazione non è I né vi: la sensibile è melodicamente libera in contesto non cadenzale.',
                                noteIds: [n1.id, n2.id],
                            });
                            handledLeadingToneIds.add(n1.id);
                            return;
                        }
                    }
                }
            } catch { /* ignore */ }

            // 3. Se non è risolto e non è un'eccezione -> ERRORE/WARNING
            // Additional attenuation: inner-voice chromatic semitone motion is very common in
            // linear chromatic voice-leading; keep it visible but do not spam warnings.
            try {
                const absStep = Math.abs((n2.midi ?? 0) - (n1.midi ?? 0));
                const isInner = v === 2 || v === 3;
                if (isInner && absStep === 1) {
                    addViolation({
                        ruleId: 'EXC-LT-Chromatic-Line',
                        severity: 'exception',
                        description: 'Sensibile in linea cromatica (eccezione)',
                        suggestion: 'Eccezione: in una linea cromatica di voce interna la sensibile può non risolvere subito alla tonica.',
                        noteIds: [n1.id, n2.id],
                    });
                    handledLeadingToneIds.add(n1.id);
                    return;
                }
            } catch { /* ignore */ }
            addViolation({
                ruleId: 'R-07',
                severity: (() => {
                    // Attenuation inside imitated progressions (sequences): the symmetry of the
                    // model/repetition can justify “non-standard” leading-tone handling.
                    let isInsideSequence = false;
                    try {
                        const tickRaw = Number((n1 as any).startTick);
                        const tick = Number.isFinite(tickRaw) ? tickRaw : null;
                        isInsideSequence = isTickInsideImitatedSequence(tick);
                    } catch { /* ignore */ }
                    if (isInsideSequence) return 'exception';
                    return (v === 1 || v === 4) ? 'error' : 'warning';
                })(),
                description: (() => {
                    let isInsideSequence = false;
                    try {
                        const tickRaw = Number((n1 as any).startTick);
                        const tick = Number.isFinite(tickRaw) ? tickRaw : null;
                        isInsideSequence = isTickInsideImitatedSequence(tick);
                    } catch { /* ignore */ }
                    return isInsideSequence
                        ? 'Risoluzione della sensibile (tollerata in sequenza/imitazione)'
                        : 'Risoluzione errata della sensibile';
                })(),
                suggestion: (() => {
                    let isInsideSequence = false;
                    try {
                        const tickRaw = Number((n1 as any).startTick);
                        const tick = Number.isFinite(tickRaw) ? tickRaw : null;
                        isInsideSequence = isTickInsideImitatedSequence(tick);
                    } catch { /* ignore */ }
                    return isInsideSequence
                        ? 'Eccezione: in una progressione imitativa (sequenza), la simmetria del disegno può giustificare una risoluzione non immediata della sensibile.'
                        : 'La sensibile tende a salire alla tonica (specie nelle voci esterne).';
                })(),
                noteIds: [n1.id, n2.id],
            });
        });

        // R-01 / R-02: parallel octaves and fifths
        for (let vi = 0; vi < voices.length; vi++) {
            for (let vj = vi + 1; vj < voices.length; vj++) {
                const vA = voices[vi];
                const vB = voices[vj];
                const a1 = aV[vA];
                const a2 = aV[vB];
                const b1 = bV[vA];
                const b2 = bV[vB];
                if (!a1 || !a2 || !b1 || !b2) continue;

                const a1m = effectiveMidi(a1 as any);
                const a2m = effectiveMidi(a2 as any);
                const b1m = effectiveMidi(b1 as any);
                const b2m = effectiveMidi(b2 as any);
                if (!Number.isFinite(a1m as any) || !Number.isFinite(a2m as any) || !Number.isFinite(b1m as any) || !Number.isFinite(b2m as any)) continue;

                const intA = mod12(Math.abs((a1m as number) - (a2m as number)));
                const intB = mod12(Math.abs((b1m as number) - (b2m as number)));
                const d1 = dir(a1m as number, b1m as number);
                const d2 = dir(a2m as number, b2m as number);
                const similar = d1 !== 0 && d1 === d2;
                const contrary = d1 !== 0 && d2 !== 0 && d1 !== d2;

                // R-01: Parallel octaves (similar motion)
                if (similar && isPerfectOctaveOrUnison(intA) && isPerfectOctaveOrUnison(intB)) {
                    addViolation({ ruleId: 'R-01', severity: 'error', description: 'Ottave parallele', noteIds: [a1.id, a2.id, b1.id, b2.id] });
                    connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: 'error', ruleId: 'R-01' });
                    connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: 'error', ruleId: 'R-01' });
                    continue;
                }
                // R-02: Parallel fifths (similar motion)
                if (similar && isPerfectFifth(intA) && isPerfectFifth(intB)) {
                    // ── EXC-STYLE-5: Quinte di stile (Mozart / orchestrali) ──
                    // Tolerate parallel fifths between lower voices (tenor + bass,
                    // voices 3 & 4) when both move by chromatic semitone.
                    const _r02VoicesLower = Math.min(vA, vB) >= 3;
                    const _r02Chromatic = Math.abs((b1m as number) - (a1m as number)) === 1
                        && Math.abs((b2m as number) - (a2m as number)) === 1;
                    if (_r02VoicesLower && _r02Chromatic) {
                        addViolation({ ruleId: 'EXC-STYLE-5', severity: 'warning', description: 'Quinte di stile (orchestrali)', noteIds: [a1.id, a2.id, b1.id, b2.id] });
                        connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: 'warning', ruleId: 'EXC-STYLE-5' });
                        connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: 'warning', ruleId: 'EXC-STYLE-5' });
                        continue;
                    }
                    addViolation({ ruleId: 'R-02', severity: 'error', description: 'Quinte parallele', noteIds: [a1.id, a2.id, b1.id, b2.id] });
                    connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: 'error', ruleId: 'R-02' });
                    connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: 'error', ruleId: 'R-02' });
                    continue;
                }
                // R-01c: Consecutive octaves by contrary motion
                if (contrary && isPerfectOctaveOrUnison(intA) && isPerfectOctaveOrUnison(intB)) {
                    const bMeasure = (b2 as any)?.measureIndex ?? -1;
                    const isFinalCadence = bMeasure === lastMI;
                    const rid = isFinalCadence ? 'EXC-ContrOct' : 'R-01c';
                    const sev: 'error' | 'exception' = isFinalCadence ? 'exception' : 'error';
                    addViolation({ ruleId: rid, severity: sev,
                        description: 'Ottave consecutive per moto contrario\n'
                            + (isFinalCadence
                                ? '• ℹ️ Info: Licenza in Conclusione (Cadenza)\n'
                                  + 'Il movimento è permesso esclusivamente se avviene nella conclusione di una frase o di un periodo '
                                  + '(es. cadenza perfetta V-I) tra le parti estreme. In questo caso, la forza della risoluzione tonale '
                                  + 'prevale sulla regola dell\'indipendenza delle parti.\n'
                                : '• ⚠️ Errore: Ottave Consecutive (Moto Contrario)\n'
                                  + 'Se il passaggio avviene all\'interno della frase (non in chiusura), è considerato un errore di stile. '
                                  + 'Anche se il moto è contrario, l\'orecchio percepisce la perdita di individualità delle voci, '
                                  + 'che sembrano fondersi in una sola linea raddoppiata.\n'
                                  + '• 💡 Consiglio Tecnico\n'
                                  + 'Poiché entrambe le voci saltano, l\'effetto è molto marcato. '
                                  + 'Se non sei in una cadenza finale, per rendere il tessuto armonico più elegante '
                                  + 'dovresti muovere almeno una delle due voci per grado congiunto '
                                  + 'o cercare un moto obliquo mantenendo una nota comune.\n'),
                        suggestion: isFinalCadence
                            ? 'Licenza accettata: ottave per moto contrario in cadenza finale.'
                            : 'Evita ottave consecutive anche per moto contrario; muovi almeno una voce per grado congiunto o usa moto obliquo.',
                        noteIds: [a1.id, a2.id, b1.id, b2.id] });
                    connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: sev, ruleId: rid });
                    connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: sev, ruleId: rid });
                    continue;
                }
                // R-02c: Consecutive fifths by contrary motion
                if (contrary && isPerfectFifth(intA) && isPerfectFifth(intB)) {
                    addViolation({ ruleId: 'R-02c', severity: 'error', description: 'Quinte consecutive per moto contrario', suggestion: 'Due quinte perfette consecutive sono vietate anche per moto contrario.', noteIds: [a1.id, a2.id, b1.id, b2.id] });
                    connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: 'error', ruleId: 'R-02c' });
                    connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: 'error', ruleId: 'R-02c' });
                }

                // R-03: Arrival at unison (two voices converge to the same pitch)
                // Flag when the arrival is a TRUE unison (same MIDI pitch, not octave)
                // but departure was NOT unison/octave (otherwise R-01/R-01c handles it).
                // Skip if both voices are stationary (oblique with no movement = tied notes).
                if ((b1m as number) === (b2m as number) && !isPerfectOctaveOrUnison(intA) && (d1 !== 0 || d2 !== 0)) {
                    const oblique = d1 === 0 || d2 === 0;
                    const isContraryOrOblique = contrary || oblique;

                    const b1Midi = b1m as number;
                    const b2Midi = b2m as number;
                    const a1Midi = a1m as number;
                    const a2Midi = a2m as number;
                    const motion1 = Math.abs(b1Midi - a1Midi);  // voice vA motion in semitones
                    const motion2 = Math.abs(b2Midi - a2Midi);  // voice vB motion in semitones
                    const stepInAtLeastOne = motion1 <= 2 || motion2 <= 2;

                    const isLowerPair = (vA === 3 && vB === 4) || (vA === 4 && vB === 3); // Tenore+Basso
                    const isSopAlto = (vA === 1 && vB === 2) || (vA === 2 && vB === 1);   // Soprano+Alto

                    // Exception 1: lower voices (T+B) by contrary/oblique → tolerated
                    if (isLowerPair && isContraryOrOblique) {
                        addViolation({
                            ruleId: 'EXC-Unison-Lower',
                            severity: 'exception',
                            description: 'Unisono raggiunto per moto contrario/obliquo nelle voci basse (tollerato)',
                            suggestion: 'Eccezione: l\'unisono raggiunto per moto contrario o obliquo tra Tenore e Basso è ammesso.',
                            noteIds: [a1.id, a2.id, b1.id, b2.id],
                        });
                    }
                    // Exception 2: other parts by contrary/oblique with step in at least one voice
                    else if (!isLowerPair && isContraryOrOblique && stepInAtLeastOne) {
                        addViolation({
                            ruleId: 'EXC-Unison-Step',
                            severity: 'exception',
                            description: 'Unisono raggiunto per moto contrario/obliquo con grado congiunto (tollerato)',
                            suggestion: 'Eccezione: l\'unisono per moto contrario o obliquo è ammesso se almeno una voce procede per grado congiunto.',
                            noteIds: [a1.id, a2.id, b1.id, b2.id],
                        });
                    }
                    // Exception 3: S+A on tonic in cadence from leading tone + 2nd degree
                    else if (isSopAlto) {
                        let isCadentialLT = false;
                        try {
                            const _ctxU = getContextAtAbsBeat(b.absBeat);
                            const _tPcMapU: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11 };
                            const _tPcU = _tPcMapU[_ctxU.tonic] ?? _tPcMapU[keyTonic] ?? 0;
                            const arrPc = mod12(b1Midi);
                            const ltPc = (_tPcU + 11) % 12;   // leading tone = tonic - 1 semitone
                            const deg2 = (_tPcU + 2) % 12;    // 2nd degree = tonic + 2 semitones
                            // Both arrive at tonic, one was LT, other was 2nd degree
                            if (arrPc === _tPcU) {
                                const pc_a1 = mod12(a1Midi);
                                const pc_a2 = mod12(a2Midi);
                                if ((pc_a1 === ltPc && pc_a2 === deg2) || (pc_a1 === deg2 && pc_a2 === ltPc)) {
                                    isCadentialLT = true;
                                }
                            }
                        } catch { /* ignore */ }

                        if (isCadentialLT) {
                            addViolation({
                                ruleId: 'EXC-Unison-Cadence',
                                severity: 'exception',
                                description: 'Unisono S+A sulla tonica in cadenza (sensibile + 2° grado → tonica)',
                                suggestion: 'Eccezione classica: Soprano e Contralto convergono sulla tonica dalla sensibile e dal 2° grado in cadenza.',
                                noteIds: [a1.id, a2.id, b1.id, b2.id],
                            });
                        } else {
                            addViolation({
                                ruleId: 'R-03',
                                severity: 'warning',
                                description: 'Arrivo all\'unisono — le voci perdono indipendenza',
                                suggestion: 'Evita l\'arrivo all\'unisono; mantieni le voci su pitch diversi per garantire l\'indipendenza delle parti.',
                                noteIds: [a1.id, a2.id, b1.id, b2.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: 'warning', ruleId: 'R-03' });
                            connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: 'warning', ruleId: 'R-03' });
                        }
                    }
                    // Default: flag as warning
                    else {
                        addViolation({
                            ruleId: 'R-03',
                            severity: 'warning',
                            description: 'Arrivo all\'unisono — le voci perdono indipendenza',
                            suggestion: 'Evita l\'arrivo all\'unisono; mantieni le voci su pitch diversi per garantire l\'indipendenza delle parti.',
                            noteIds: [a1.id, a2.id, b1.id, b2.id],
                        });
                        connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: 'warning', ruleId: 'R-03' });
                        connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: 'warning', ruleId: 'R-03' });
                    }
                }
            }
        }

        // R-04 (overlap) / EXC-S02: Voice overlap — multi-level severity
        // Voice overlap: a voice crosses where the adjacent voice was in the previous chord.
        // Duration-aware: brief notes (eighth or less) get suppressed or downgraded.
        {
            const adjacentPairsOv: [number, number][] = [[1, 2], [2, 3], [3, 4]];
            const ovNames: Record<number, string> = { 1: 'Soprano', 2: 'Alto', 3: 'Tenore', 4: 'Basso' };
            const _durBeats = (n: any): number => {
                if (!n) return 4;
                const d = String(n.duration || '').toLowerCase();
                if (d === 'sixteenth' || d === '16th') return 0.25;
                if (d === 'eighth' || d === '8th') return 0.5;
                if (d === 'quarter') return 1;
                if (d === 'half') return 2;
                if (d === 'whole') return 4;
                if (d.includes('dotted')) {
                    if (d.includes('eighth')) return 0.75;
                    if (d.includes('quarter')) return 1.5;
                    if (d.includes('half')) return 3;
                }
                return 1;
            };
            for (const [hi, lo] of adjacentPairsOv) {
                const aHi = aV[hi as Voice], aLo = aV[lo as Voice], bHi = bV[hi as Voice], bLo = bV[lo as Voice];
                if (!aHi || !aLo || !bHi || !bLo) continue;
                const aHiM = effectiveMidi(aHi as any) as number;
                const aLoM = effectiveMidi(aLo as any) as number;
                const bHiM = effectiveMidi(bHi as any) as number;
                const bLoM = effectiveMidi(bLo as any) as number;
                if (!Number.isFinite(aHiM) || !Number.isFinite(aLoM) || !Number.isFinite(bHiM) || !Number.isFinite(bLoM)) continue;
                const isInternalPair = (hi === 2 && lo === 3);

                const emitOverlap = (noteA: any, noteB: any, desc: string) => {
                    const shortA = _durBeats(noteA) <= 0.5;
                    const shortB = _durBeats(noteB) <= 0.5;
                    const anyShort = shortA || shortB;
                    // Internal pair + any short note -> suppress entirely
                    if (isInternalPair && anyShort) return;
                    // Any pair + both notes short -> suppress
                    if (shortA && shortB) return;
                    // Any pair + one short note -> warning
                    const sev = anyShort || isInternalPair ? 'warning' : 'error';
                    const rid = sev === 'warning' ? 'EXC-S02' : 'R-04';
                    addViolation({ ruleId: rid, severity: sev as any,
                        description: desc,
                        suggestion: sev === 'warning'
                            ? 'Sovrapposizione momentanea: tollerata se di breve durata.'
                            : 'Una voce non deve superare la posizione che la voce adiacente occupava nel beat precedente.',
                        noteIds: [noteA.id, noteB.id] });
                    connections.push({ type: 'horizontal', noteId1: noteA.id, noteId2: noteB.id, severity: sev, ruleId: rid });
                };

                // Lower voice goes above where higher voice was
                if (bLoM > aHiM) {
                    emitOverlap(aHi, bLo, `Sovrapposizione di voci: ${ovNames[lo]} supera la posizione precedente del ${ovNames[hi]}`);
                }
                // Higher voice goes below where lower voice was
                if (bHiM < aLoM) {
                    emitOverlap(aLo, bHi, `Sovrapposizione di voci: ${ovNames[hi]} scende sotto la posizione precedente del ${ovNames[lo]}`);
                }
            }
        }

        // R-05: hidden/direct fifths & octaves (outer voices)
        if (sopA && sopB && basA && basB) {
            const sA = effectiveMidi(sopA as any);
            const sB = effectiveMidi(sopB as any);
            const bA = effectiveMidi(basA as any);
            const bB = effectiveMidi(basB as any);
            if (!Number.isFinite(sA as any) || !Number.isFinite(sB as any) || !Number.isFinite(bA as any) || !Number.isFinite(bB as any)) {
                // skip
            } else {

            const intA = mod12(Math.abs((sA as number) - (bA as number)));
            const intB = mod12(Math.abs((sB as number) - (bB as number)));
            const dS = dir(sA as number, sB as number);
            const dB = dir(bA as number, bB as number);
            const similar = dS !== 0 && dS === dB;

            const sopMotion = Math.abs((sB as number) - (sA as number));
            const bassMotion = Math.abs((bB as number) - (bA as number));

            const sopranoLeap = sopMotion > 2;
            const sopranoSmallLeap = sopMotion <= 4; // 3rd (M/m) is often treated as milder than larger leaps
            const bassStepwise = bassMotion > 0 && bassMotion <= 2;

            const arrivalPerfect = isPerfectFifth(intB) || isPerfectOctaveOrUnison(intB);
            const departurePerfect = isPerfectFifth(intA) || isPerfectOctaveOrUnison(intA);

            // Hidden/direct perfect intervals: similar motion into a perfect 5th/8ve.
            // Skip only true parallels (same interval type: P5→P5, P8→P8) — handled by R-01/R-02.
            // Cross-type transitions (P8→P5, P5→P8) must still be caught as hidden/direct.
            const sameTypePerfect = departurePerfect && (isPerfectFifth(intA) === isPerfectFifth(intB));
            if (similar && arrivalPerfect && !sameTypePerfect) {
                const isOct = isPerfectOctaveOrUnison(intB);
                const isFifth = !isOct;
                const sameSonority = (() => {
                    try {
                        return chordSignature(getStructuralNotes(a) || []) === chordSignature(getStructuralNotes(b) || []);
                    } catch {
                        return false;
                    }
                })();

                const tickA = Number((sopA as any).startTick);
                const tickB = Number((sopB as any).startTick);
                const inSequence = (isTickInsideImitatedSequence(tickA) || isTickInsideImitatedSequence(tickB));

                if (!sopranoLeap) {
                    // Dubois degree-aware rules for hidden perfect intervals (outer voices)
                    const sopDir = Number(sopB.midi) - Number(sopA.midi);
                    const sopSemi = Math.abs(sopDir);
                    const bassPc = ((Number(basB.midi) % 12) + 12) % 12;
                    const _tonicPcMap: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11 };
                    // Use local tonic (respects tonicizations) instead of global keyTonic
                    const _localCtx = getContextAtAbsBeat(b.absBeat);
                    const _tonicPc = _tonicPcMap[_localCtx.tonic] ?? _tonicPcMap[keyTonic] ?? 0;
                    const _degreeFromTonic = ((bassPc - _tonicPc) % 12 + 12) % 12;
                    const _isTonicOrDom = _degreeFromTonic === 0 || _degreeFromTonic === 7; // I or V
                    const _isTonalDeg = _degreeFromTonic === 0 || _degreeFromTonic === 5 || _degreeFromTonic === 7; // I, IV, V

                    let _dubSev: 'exception' | 'warning' = 'exception';
                    let _dubDesc = '';
                    let _dubSugg = '';

                    if (isFifth) {
                        // Quinta nascosta S+B — Dubois:
                        // Ammessa verso I/V con Soprano per grado congiunto
                        // Sugli altri gradi: solo con Soprano per 2ª min. discendente
                        if (_isTonicOrDom) {
                            _dubSev = 'exception';
                            _dubDesc = 'Quinta nascosta verso I/V con Soprano per grado congiunto (ammessa — Dubois)';
                            _dubSugg = 'Eccezione classica (Dubois): quinta nascosta ammessa sul I e V grado quando il Soprano procede per grado congiunto.';
                        } else if (sopDir < 0 && sopSemi === 1) {
                            _dubSev = 'exception';
                            _dubDesc = 'Quinta nascosta con Soprano per 2ª min. discendente (ammessa — Dubois)';
                            _dubSugg = 'Dubois: sugli altri gradi, la quinta nascosta tra parti estreme è ammessa se il Soprano scende di seconda minore.';
                        } else {
                            _dubSev = 'warning';
                            _dubDesc = 'Quinta nascosta tra voci estreme — Soprano per grado ma non verso I/V grado';
                            _dubSugg = 'Dubois: la quinta nascosta tra parti estreme con Soprano per grado congiunto è ammessa solo verso il I e il V grado; sugli altri gradi solo con Soprano per 2ª min. discendente.';
                        }
                    } else {
                        // Ottava nascosta S+B — Dubois:
                        // Ammessa con Soprano per 2ª min. (asc/disc) verso gradi tonali
                        // Tollerata con riserva con Soprano per 2ª magg. disc. verso gradi tonali
                        if (sopSemi === 1 && _isTonalDeg) {
                            _dubSev = 'exception';
                            _dubDesc = 'Ottava nascosta con Soprano per 2ª min. verso grado tonale (ammessa — Dubois)';
                            _dubSugg = 'Dubois: l\'ottava nascosta tra parti estreme è ammessa quando il Soprano procede per seconda minore verso un grado tonale (I, IV, V).';
                        } else if (sopDir < 0 && sopSemi === 2 && _isTonalDeg) {
                            _dubSev = 'warning';
                            _dubDesc = 'Ottava nascosta con Soprano per 2ª magg. disc. verso grado tonale (tollerata con riserva — Dubois)';
                            _dubSugg = 'Dubois: l\'ottava nascosta con Soprano per 2ª maggiore discendente è tollerata con riserva sui gradi tonali, particolarmente in conclusione di frase.';
                        } else if (sopSemi === 2 && _isTonalDeg) {
                            _dubSev = 'warning';
                            _dubDesc = 'Ottava nascosta con Soprano per 2ª magg. verso grado tonale (non ammessa)';
                            _dubSugg = 'L\'ottava nascosta è ammessa solo con Soprano per semitono (2ª minore). Con 2ª maggiore, preferisci moto contrario.';
                        } else {
                            _dubSev = 'warning';
                            _dubDesc = 'Ottava nascosta tra voci estreme — non verso grado tonale';
                            _dubSugg = 'Dubois: l\'ottava nascosta tra parti estreme è ammessa solo verso i gradi tonali (I, IV, V) con il Soprano per seconda minore.';
                        }
                    }

                    const _dubRuleId = _dubSev === 'exception' ? 'EXC-Hidden-Stepwise' : 'R-05';
                    addViolation({
                        ruleId: _dubRuleId,
                        severity: _dubSev,
                        description: _dubDesc,
                        suggestion: _dubSugg,
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: _dubSev, ruleId: _dubRuleId });
                    connections.push({ type: 'horizontal', noteId1: basA.id, noteId2: basB.id, severity: _dubSev, ruleId: _dubRuleId });
                } else if (bassStepwise && sopranoSmallLeap) {
                    addViolation({
                        ruleId: 'EXC-Hidden-BassStep',
                        severity: 'exception',
                        description: isOct
                            ? 'Ottava diretta attenuata (Basso per grado; salto piccolo al Soprano)'
                            : 'Quinta diretta attenuata (Basso per grado; salto piccolo al Soprano)',
                        suggestion: 'Marker attenuante: spesso considerato meno grave quando il Basso va per grado e il salto del Soprano è contenuto (es. 3ª).',
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'exception', ruleId: 'EXC-Hidden-BassStep' });
                    connections.push({ type: 'horizontal', noteId1: basA.id, noteId2: basB.id, severity: 'exception', ruleId: 'EXC-Hidden-BassStep' });
                } else {
                    const isException = (inSequence || sameSonority);
                    const sev = isException ? 'exception' : 'warning';
                    addViolation({
                        ruleId: 'R-05',
                        severity: sev,
                        description: isOct
                            ? (inSequence
                                ? 'Ottave nascoste (dirette) in progressione imitata (tollerate)'
                                : (sameSonority
                                    ? 'Ottave nascoste (dirette) in cambio di posizione (stessa sonorità)'
                                    : 'Ottave nascoste (dirette) tra voci estreme'))
                            : (inSequence
                                ? 'Quinte nascoste (dirette) in progressione imitata (tollerate)'
                                : (sameSonority
                                    ? 'Quinte nascoste (dirette) in cambio di posizione (stessa sonorità)'
                                    : 'Quinte nascoste (dirette) tra voci estreme')),
                        suggestion: isOct
                            ? (isException
                                ? HIDDEN_OCTAVE_LICENSE_IN_SEQUENCE_HELP
                                : (HIDDEN_OCTAVE_LICENSE_IN_SEQUENCE_HELP + '\n\n(Nota: qui l\'analisi non ha riconosciuto una sequenza/cambio di posizione sufficientemente chiaro; tratta quindi il caso come warning.)'))
                            : (isFifth
                                ? (isException
                                    ? HIDDEN_FIFTH_LICENSE_IN_SEQUENCE_HELP
                                    : (HIDDEN_FIFTH_LICENSE_IN_SEQUENCE_HELP + '\n\n(Nota: qui l\'analisi non ha riconosciuto una sequenza/cambio di posizione sufficientemente chiaro; tratta quindi il caso come warning.)'))
                                : 'Preferisci moto contrario, oppure evita il salto nella voce superiore.'),
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: sev, ruleId: 'R-05' });
                    connections.push({ type: 'horizontal', noteId1: basA.id, noteId2: basB.id, severity: sev, ruleId: 'R-05' });
                }
            }

            // "Cambio di posizione" / moto obliquo: successive perfect intervals where one outer voice holds
            // and the other moves (not a true parallel, but often worth flagging distinctly).
            const oblique = ((dS === 0 && dB !== 0) || (dB === 0 && dS !== 0));
            if (arrivalPerfect && departurePerfect && oblique) {
                const isOct = isPerfectOctaveOrUnison(intB);
                addViolation({
                    ruleId: 'EXC-OBL-PERF',
                    severity: 'exception',
                    description: isOct
                        ? 'Ottava successiva con moto obliquo (una voce ferma)'
                        : 'Quinta successiva con moto obliquo (una voce ferma)',
                    suggestion: 'Marker informativo: non è una parallela “vera” (moto obliquo), ma verifica l’indipendenza delle linee.',
                    noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                });

                // Show at least one visible overlay even when one note is sustained (same id across events).
                if (sopA.id !== sopB.id) {
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'exception', ruleId: 'EXC-OBL-PERF' });
                }
                if (basA.id !== basB.id) {
                    connections.push({ type: 'horizontal', noteId1: basA.id, noteId2: basB.id, severity: 'exception', ruleId: 'EXC-OBL-PERF' });
                }
                connections.push({ type: 'vertical', noteId1: sopB.id, noteId2: basB.id, severity: 'exception', ruleId: 'EXC-OBL-PERF' });
            }

            }
        }

        // R-05 (extended): hidden/direct fifths & octaves involving the soprano and Alto.
        // In many classical treatments, hidden/direct perfect intervals are emphasized in the outer voices,
        // but in practice the same issue can be relevant for Soprano–Alto when the soprano leaps.
        const altoA = aV[2];
        const altoB = bV[2];
        if (sopA && sopB && altoA && altoB) {
            const sA = effectiveMidi(sopA as any);
            const sB = effectiveMidi(sopB as any);
            const aA = effectiveMidi(altoA as any);
            const aB = effectiveMidi(altoB as any);
            if (!Number.isFinite(sA as any) || !Number.isFinite(sB as any) || !Number.isFinite(aA as any) || !Number.isFinite(aB as any)) {
                // skip
                // (don't early-return; other rules still apply)
            } else {
            const intA = mod12(Math.abs((sA as number) - (aA as number)));
            const intB = mod12(Math.abs((sB as number) - (aB as number)));
            const dS = dir(sA as number, sB as number);
            const dA = dir(aA as number, aB as number);
            const similar = dS !== 0 && dS === dA;

            const sopMotion = Math.abs((sB as number) - (sA as number));
            const sopranoLeap = sopMotion > 2;

            const arrivalPerfect = isPerfectFifth(intB) || isPerfectOctaveOrUnison(intB);
            const departurePerfect = isPerfectFifth(intA) || isPerfectOctaveOrUnison(intA);

            // Skip only true parallels (P5→P5, P8→P8) — cross-type (P8→P5, P5→P8) detected here.
            const sameTypePerfectSA = departurePerfect && (isPerfectFifth(intA) === isPerfectFifth(intB));
            if (similar && arrivalPerfect && !sameTypePerfectSA) {
                const isOct = isPerfectOctaveOrUnison(intB);
                const isFifth = !isOct;
                const sameSonority = (() => {
                    try {
                        return chordSignature(getStructuralNotes(a) || []) === chordSignature(getStructuralNotes(b) || []);
                    } catch {
                        return false;
                    }
                })();

                const tickA = Number((sopA as any).startTick);
                const tickB = Number((sopB as any).startTick);
                const inSequence = (isTickInsideImitatedSequence(tickA) || isTickInsideImitatedSequence(tickB));

                // Dubois inner-voice rules for S+A hidden perfect intervals
                const _altoMotion = Math.abs((aB as number) - (aA as number));
                const _altoStep = _altoMotion <= 2;
                const _altoDir = dir(aA as number, aB as number);
                const _bassPcSA = ((Number((bV[4] ?? basB ?? sopB as any).midi ?? 0) % 12) + 12) % 12;
                const _tpcMapSA: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11 };
                // Use local tonic (respects tonicizations)
                const _localCtxSA = getContextAtAbsBeat(b.absBeat);
                const _tpcSA = _tpcMapSA[_localCtxSA.tonic] ?? _tpcMapSA[keyTonic] ?? 0;
                const _degSA = ((_bassPcSA - _tpcSA) % 12 + 12) % 12;
                const _isTonalSA = _degSA === 0 || _degSA === 5 || _degSA === 7;

                // Common note (pitch class): one of the two notes forming the arriving 5th was in the previous chord
                const _commonNoteSA = (() => {
                    try {
                        const prev = (getStructuralNotes(a) || []).map(n => ((Number(n.midi) % 12) + 12) % 12);
                        return prev.includes(((Number(sopB.midi) % 12) + 12) % 12) || prev.includes(((Number(altoB.midi) % 12) + 12) % 12);
                    } catch { return false; }
                })();

                // Dubois rule 3: common note overrides all conditions for 5ths (inner voices)
                if (isFifth && _commonNoteSA) {
                    addViolation({
                        ruleId: 'EXC-Hidden-Stepwise',
                        severity: 'exception',
                        description: 'Quinta nascosta S\u2013A con nota comune ai due accordi (ammessa \u2014 Dubois)',
                        suggestion: 'Dubois: la quinta nascosta tra parti interne \u00E8 ammessa su tutti i gradi, anche per salto, se una delle due note che formano la 5\u00AA \u00E8 comune ai due accordi.',
                        noteIds: [sopA.id, sopB.id, altoA.id, altoB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
                    connections.push({ type: 'horizontal', noteId1: altoA.id, noteId2: altoB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
                } else if (!sopranoLeap) {
                    // Dubois: voce più acuta (Soprano) per grado → ammessa su tutti i gradi
                    addViolation({
                        ruleId: 'EXC-Hidden-Stepwise',
                        severity: 'exception',
                        description: isOct
                            ? 'Ottava nascosta S–A con Soprano per grado congiunto (ammessa — Dubois)'
                            : 'Quinta nascosta S–A con Soprano per grado congiunto (ammessa — Dubois)',
                        suggestion: 'Dubois: tra parti interne, la quinta/ottava nascosta è ammessa su tutti i gradi se la voce più acuta procede per grado congiunto.',
                        noteIds: [sopA.id, sopB.id, altoA.id, altoB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
                    connections.push({ type: 'horizontal', noteId1: altoA.id, noteId2: altoB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
                } else if (_altoStep) {
                    // Dubois: voce inferiore (Alto) per grado
                    if (isFifth) {
                        // 5ths: ammessa solo su gradi tonali
                        const _sevSA = _isTonalSA ? 'exception' as const : 'warning' as const;
                        addViolation({
                            ruleId: _sevSA === 'exception' ? 'EXC-Hidden-Stepwise' : 'R-05',
                            severity: _sevSA,
                            description: _isTonalSA
                                ? 'Quinta nascosta S–A con Alto per grado, su grado tonale (ammessa — Dubois)'
                                : 'Quinta nascosta S–A con Alto per grado ma non su grado tonale',
                            suggestion: 'Dubois: la quinta nascosta con la voce inferiore per grado è ammessa solo sui gradi tonali (I, IV, V).',
                            noteIds: [sopA.id, sopB.id, altoA.id, altoB.id],
                        });
                        connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: _sevSA, ruleId: _sevSA === 'exception' ? 'EXC-Hidden-Stepwise' : 'R-05' });
                        connections.push({ type: 'horizontal', noteId1: altoA.id, noteId2: altoB.id, severity: _sevSA, ruleId: _sevSA === 'exception' ? 'EXC-Hidden-Stepwise' : 'R-05' });
                    } else {
                        // 8ves: tollerata con riserva solo salendo
                        const _sevSA = _altoDir > 0 ? 'warning' as const : 'error' as const;
                        addViolation({
                            ruleId: 'R-05',
                            severity: _sevSA,
                            description: _altoDir > 0
                                ? 'Ottava nascosta S–A con Alto per grado ascendente (tollerata con riserva — Dubois)'
                                : 'Ottava nascosta S–A con Alto per grado discendente (non ammessa — Dubois)',
                            suggestion: 'Dubois: l\'ottava nascosta con la voce inferiore per grado è tollerata con riserva solo salendo.',
                            noteIds: [sopA.id, sopB.id, altoA.id, altoB.id],
                        });
                        connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: _sevSA, ruleId: 'R-05' });
                        connections.push({ type: 'horizontal', noteId1: altoA.id, noteId2: altoB.id, severity: _sevSA, ruleId: 'R-05' });
                    }
                } else {
                    // Both leap
                    {
                        const _seqSon = (inSequence || sameSonority);
                        const _sevSA = isOct ? 'error' as const : (_seqSon ? 'exception' as const : 'warning' as const);
                        addViolation({
                            ruleId: 'R-05',
                            severity: _sevSA,
                            description: isOct
                                ? (inSequence ? 'Ottave nascoste S–A in progressione imitata' : 'Ottava nascosta S–A per salto in entrambe le voci (proibita — Dubois)')
                                : (inSequence ? 'Quinte nascoste S–A in progressione imitata' : 'Quinta nascosta S–A per salto senza nota comune'),
                            suggestion: isOct
                                ? 'Dubois: l\'ottava nascosta è proibita quando entrambe le voci procedono per salto.'
                                : 'Dubois: la quinta nascosta per salto è ammessa solo se una delle note è comune ai due accordi.',
                            noteIds: [sopA.id, sopB.id, altoA.id, altoB.id],
                        });
                        connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: _sevSA, ruleId: 'R-05' });
                        connections.push({ type: 'horizontal', noteId1: altoA.id, noteId2: altoB.id, severity: _sevSA, ruleId: 'R-05' });
                    }
                }
            }
            }
        }

        // R-05 (inner-voice pairs): hidden/direct 5ths & 8ves between any pair involving at least one inner voice.
        // Dubois rules for inner voices differ from outer voices:
        //   - Allowed on all degrees if the HIGHER voice moves by step
        //   - Only tonal degrees (5ths) / ascending only (8ves) if LOWER voice moves by step
        //   - 5ths allowed even by leap if one note of the 5th is common to both chords
        //   - 8ves forbidden if both voices leap
        {
            const _tpcMapInner: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11 };
            // Use local tonic (respects tonicizations) — computed per pair below
            const _localCtxInner = getContextAtAbsBeat(b.absBeat);
            const _tpcInner = _tpcMapInner[_localCtxInner.tonic] ?? _tpcMapInner[keyTonic] ?? 0;

            const _innerPairs: Array<{ nameHi: string; nameLo: string; hi: [any, any]; lo: [any, any] }> = [];
            const _sopN = sopA && sopB ? [sopA, sopB] : null;
            const _altN = (aV[2] && bV[2]) ? [aV[2], bV[2]] : null;
            const _tenN = (aV[3] && bV[3]) ? [aV[3], bV[3]] : null;
            const _basN = (aV[4] && bV[4]) ? [aV[4], bV[4]] : null;

            // Pairs involving at least one inner voice (S+A already handled above):
            if (_sopN && _tenN) _innerPairs.push({ nameHi: 'S', nameLo: 'T', hi: _sopN as any, lo: _tenN as any });
            if (_altN && _tenN) _innerPairs.push({ nameHi: 'A', nameLo: 'T', hi: _altN as any, lo: _tenN as any });
            if (_altN && _basN) _innerPairs.push({ nameHi: 'A', nameLo: 'B', hi: _altN as any, lo: _basN as any });
            if (_tenN && _basN) _innerPairs.push({ nameHi: 'T', nameLo: 'B', hi: _tenN as any, lo: _basN as any });

            for (const pair of _innerPairs) {
                const hiA = pair.hi[0]; const hiB = pair.hi[1];
                const loA = pair.lo[0]; const loB = pair.lo[1];
                const hA = effectiveMidi(hiA as any); const hB = effectiveMidi(hiB as any);
                const lA = effectiveMidi(loA as any); const lB = effectiveMidi(loB as any);
                if (!Number.isFinite(hA as any) || !Number.isFinite(hB as any) || !Number.isFinite(lA as any) || !Number.isFinite(lB as any)) continue;
                const _intA = mod12(Math.abs((hA as number) - (lA as number)));
                const _intB = mod12(Math.abs((hB as number) - (lB as number)));
                const _dH = dir(hA as number, hB as number);
                const _dL = dir(lA as number, lB as number);
                const _sim = _dH !== 0 && _dH === _dL;
                const _arrPerf = isPerfectFifth(_intB) || isPerfectOctaveOrUnison(_intB);
                const _depPerf = isPerfectFifth(_intA) || isPerfectOctaveOrUnison(_intA);
                // Skip only true parallels (same type: P5→P5, P8→P8). Cross-type (P8→P5, P5→P8) still detected.
                const _sameTypePerf = _depPerf && (isPerfectFifth(_intA) === isPerfectFifth(_intB));
                if (!_sim || !_arrPerf || _sameTypePerf) continue;
                const _is8 = isPerfectOctaveOrUnison(_intB);
                const _is5 = !_is8;
                const _hiMotion = Math.abs((hB as number) - (hA as number));
                const _loMotion = Math.abs((lB as number) - (lA as number));
                const _hiStep = _hiMotion <= 2;
                const _loStep = _loMotion <= 2;
                const _loDir = _dL;
                const _bPc = ((Number(loB.midi ?? 0) % 12) + 12) % 12;
                const _deg = ((_bPc - _tpcInner) % 12 + 12) % 12;
                const _isTonal = _deg === 0 || _deg === 5 || _deg === 7;
                const _pairLabel = `${pair.nameHi}–${pair.nameLo}`;

                // Common note (pitch class): one of the two notes forming the arriving 5th was in the previous chord
                const _commonNote = (() => {
                    try {
                        const prev = (getStructuralNotes(a) || []).map(n => ((Number(n.midi) % 12) + 12) % 12);
                        return prev.includes(((Number(hiB.midi) % 12) + 12) % 12) || prev.includes(((Number(loB.midi) % 12) + 12) % 12);
                    } catch { return false; }
                })();

                const _tickA = Number((hiA as any).startTick);
                const _tickB = Number((hiB as any).startTick);
                const _inSeq = isTickInsideImitatedSequence(_tickA) || isTickInsideImitatedSequence(_tickB);

                let _sev: 'exception' | 'warning' | 'error' = 'warning';
                let _desc = '';
                let _sugg = '';

                if (_is5 && _commonNote) {
                    // Dubois rule 3: common note overrides all conditions for 5ths (inner voices)
                    _sev = 'exception';
                    _desc = `Quinta nascosta ${_pairLabel} con nota comune ai due accordi (ammessa \u2014 Dubois)`;
                    _sugg = 'Dubois: la quinta nascosta tra parti interne \u00E8 ammessa su tutti i gradi, anche per salto, se una delle note che formano la 5\u00AA \u00E8 comune ai due accordi.';
                } else if (_hiStep) {
                    // Dubois: voce più acuta per grado → ammessa su tutti i gradi
                    _sev = 'exception';
                    _desc = _is8
                        ? `Ottava nascosta ${_pairLabel} con ${pair.nameHi} per grado congiunto (ammessa — Dubois)`
                        : `Quinta nascosta ${_pairLabel} con ${pair.nameHi} per grado congiunto (ammessa — Dubois)`;
                    _sugg = 'Dubois: tra parti interne, ammessa su tutti i gradi se la voce più acuta procede per grado congiunto.';
                } else if (_loStep) {
                    if (_is5) {
                        _sev = _isTonal ? 'exception' : 'warning';
                        _desc = _isTonal
                            ? `Quinta nascosta ${_pairLabel} con ${pair.nameLo} per grado, su grado tonale (ammessa — Dubois)`
                            : `Quinta nascosta ${_pairLabel} con ${pair.nameLo} per grado ma non su grado tonale`;
                        _sugg = 'Dubois: con la voce inferiore per grado, la quinta nascosta è ammessa solo sui gradi tonali (I, IV, V).';
                    } else {
                        _sev = 'warning';
                        _desc = _loDir > 0
                            ? `Ottava nascosta ${_pairLabel} con ${pair.nameLo} per grado ascendente (tollerata con riserva — Dubois)`
                            : `Ottava nascosta ${_pairLabel} con ${pair.nameLo} per grado discendente (evitare — tra parti interne tollerata, cfr. Piston)`;
                        _sugg = 'Tra parti interne, l\'ottava nascosta con la voce inferiore per grado è tollerata con più libertà (Piston, Bach).';
                    }
                } else {
                    // Both leap
                    if (_is8) {
                        _sev = _inSeq ? 'exception' : 'warning';
                        _desc = _inSeq
                            ? `Ottava nascosta ${_pairLabel} per salto in progressione imitata (tollerata)`
                            : `Ottava nascosta ${_pairLabel} per salto in entrambe le voci (evitare — tra parti interne tollerata, cfr. Piston/Bach)`;
                        _sugg = 'Tra parti interne, l\'ottava nascosta per salto è più tollerata che tra voci estreme (Piston, Bach).';
                    } else {
                        _sev = _inSeq ? 'exception' : 'warning';
                        _desc = _inSeq
                            ? `Quinta nascosta ${_pairLabel} in progressione imitata (tollerata)`
                            : `Quinta nascosta ${_pairLabel} per salto senza nota comune`;
                        _sugg = 'Dubois: la quinta nascosta per salto è ammessa solo se una delle note è comune ai due accordi.';
                    }
                }

                const _rId = _sev === 'exception' ? 'EXC-Hidden-Stepwise' : 'R-05';
                addViolation({
                    ruleId: _rId,
                    severity: _sev,
                    description: _desc,
                    suggestion: _sugg,
                    noteIds: [hiA.id, hiB.id, loA.id, loB.id],
                });
                connections.push({ type: 'horizontal', noteId1: hiA.id, noteId2: hiB.id, severity: _sev, ruleId: _rId });
                connections.push({ type: 'horizontal', noteId1: loA.id, noteId2: loB.id, severity: _sev, ruleId: _rId });
            }
        }

        // R-12: chord seventh resolution (with EXC-7m01, updated for minor/major 7th logic)
        // NOTE: In augmented-sixth chords (It+/Fr+/Ger+), the characteristic A6 interval
        // can be enharmonically equivalent to a m7 (10 semitones). Since this analysis
        // operates on pitch classes, R-12 would produce false positives (the A6 upper
        // note resolves upward by semitone). We therefore skip R-12 on these sonorities.
        const ctxAFor7 = getContextAtAbsBeat(a.absBeat);
        const romanAFor7 = getRomanAnalysis(getStructuralNotes(a) || [], ctxAFor7.tonic, ctxAFor7.isMinor)?.roman ?? '';
        const isAug6Chord = romanAFor7 === 'It+' || romanAFor7 === 'Fr+' || romanAFor7 === 'Ger+' || romanAFor7 === 'Sw+';

        const structuralFor7 = getStructuralNotes(a);
        // Be conservative: if the sonority has > 4 distinct pitch-classes, it likely includes
        // added tones/anticipations/suspensions. Enforcing strict chord-7th resolution on such
        // textures tends to create false positives.
        const pcsFor7 = new Set(structuralFor7.map(n => mod12(n.noteIndex)));
        // Still try to identify the chord even when the texture is "dirty" so that we can
        // detect/report green exceptions (transfers/delays/free notes). However, only emit
        // hard R-12 errors in the clean (<=4 pcs) case.
        const strictR12 = (!isAug6Chord && pcsFor7.size <= 4);
        const chordInfoA = (!isAug6Chord) ? identifyChord(structuralFor7) : null;
        if (chordInfoA?.root) {
            let rootMidi = chordInfoA.root.midi;
            let rootInferredForR12 = false;

            let seventhNotes = getStructuralNotes(a)
                .filter(n => !n.isRest)
                .map(n => {
                    const rel = mod12(n.midi - rootMidi);
                    return { n, rel };
                })
                .filter(({ rel }) => rel === 10 || rel === 11);

            // If no 7th is detected, try inferring a rootless dominant-7 shell.
            // This supports cases like {B,D,F} in C: it can function as G7 without the root.
            // We use this only to enable green exceptions (transference/delay/etc.), not to
            // emit hard R-12 errors.
            if (!seventhNotes.length) {
                try {
                    const pcs = [...new Set((structuralFor7 || []).filter(n => n && !n.isRest).map(n => mod12(n.noteIndex)))];
                    if (pcs.length >= 3 && pcs.length <= 4) {
                        let best: { rootPc: number; score: number } | null = null;
                        for (let r = 0; r < 12; r++) {
                            const set = new Set<number>([r, mod12(r + 4), mod12(r + 7), mod12(r + 10)]);
                            if (!pcs.every(pc => set.has(pc))) continue;
                            // Require 3rd + 7th present; otherwise we'd over-infer.
                            if (!pcs.includes(mod12(r + 4)) || !pcs.includes(mod12(r + 10))) continue;
                            // Prefer missing-root cases.
                            const missingRootBonus = pcs.includes(r) ? 0 : 2;
                            const hasFifthBonus = pcs.includes(mod12(r + 7)) ? 1 : 0;
                            const score = missingRootBonus + hasFifthBonus;
                            if (!best || score > best.score) best = { rootPc: r, score };
                        }
                        if (best) {
                            rootMidi = 60 + best.rootPc;
                            rootInferredForR12 = true;
                            seventhNotes = getStructuralNotes(a)
                                .filter(n => !n.isRest)
                                .map(n => ({ n, rel: mod12(n.midi - rootMidi) }))
                                .filter(({ rel }) => rel === 10 || rel === 11);
                        }
                    }
                } catch { /* ignore */ }
            }

            if (seventhNotes.length) {
                seventhNotes.forEach(({ n: n7, rel }) => {
                    // If this note is an ornament/non-chord tone (esp. anticipation),
                    // don't enforce chord-7th resolution on it.
                    try {
                        const any7 = n7 as any;
                        if (any7.isPassing || any7.isNeighbor || any7.isAnticipation || any7.isAppoggiatura || any7.isEscape || any7.isSuspension) {
                            return;
                        }
                    } catch { /* ignore */ }

                    // Minor seventh (10): must resolve down
                    // Major seventh (11): must resolve down ONLY if below the root
                    let mustResolveDown = false;
                    if (rel === 10) {
                        mustResolveDown = true;
                    } else if (rel === 11) {
                        if (n7.midi < rootMidi) {
                            mustResolveDown = true;
                        }
                    }

                    if (!mustResolveDown) return; // No error if not required to resolve down

                    const v = (n7.voice ?? 1) as Voice;
                    const next = findNextStructuralVoiceNote(i, v, n7.id) ?? { note: bV[v] as StaffNote, index: i + 1 };
                    const nNext = next?.note;
                    const sameVoiceResolves = !!nNext && stepDown(n7.midi, nNext.midi);
                    if (sameVoiceResolves) return;

                    // ================================
                    // Exceptions for minor-7th resolution (rel === 10)
                    // ================================
                    const idxB = (typeof next?.index === 'number') ? (next.index as number) : (i + 1);
                    const evBFor7 = (Number.isFinite(idxB) && chordEvents[idxB]) ? chordEvents[idxB] : b;
                    const bStructuralFor7 = (() => {
                        try { return getStructuralNotes(evBFor7 as any) || []; } catch { return []; }
                    })();
                    const pcsBFor7 = new Set(bStructuralFor7.filter(n => n && !n.isRest).map(n => mod12(n.noteIndex)));

                    const stepUp = (fromMidi: number, toMidi: number) => (toMidi === fromMidi + 1) || (toMidi === fromMidi + 2);
                    const isPerfectFourthUp = (fromMidi: number, toMidi: number) => (toMidi - fromMidi) === 5;

                    const resolutionPcsFor7 = new Set([mod12(n7.midi - 1), mod12(n7.midi - 2)]);

                    const findResolutionCarrierAtB = (): { note: StaffNote; kind: 'bass' | 'soprano' | 'lower' | 'other' } | null => {
                        try {
                            const byVoice = (evBFor7 as any)?.byVoice as Map<number, StaffNote> | undefined;
                            const getV = (vv: number) => (byVoice?.get?.(vv) ?? null) as any;

                            const bass = getV(4);
                            if (bass && resolutionPcsFor7.has(mod12(bass.midi))) return { note: bass, kind: 'bass' };

                            const sopr = getV(1);
                            if (sopr && resolutionPcsFor7.has(mod12(sopr.midi))) return { note: sopr, kind: 'soprano' };

                            if (v > 1) {
                                const lower = getV(v - 1);
                                if (lower && resolutionPcsFor7.has(mod12(lower.midi))) return { note: lower, kind: 'lower' };
                            }

                            const any = bStructuralFor7
                                .filter(n => n && !n.isRest)
                                .find(n => (n.voice ?? 1) !== v && resolutionPcsFor7.has(mod12(n.midi))) as StaffNote | undefined;
                            return any ? { note: any, kind: 'other' } : null;
                        } catch {
                            return null;
                        }
                    };

                    // Helper: treat only simple chord members (triad members) as consonant targets.
                    const isConsonantChordMemberAtB = (note: StaffNote | null | undefined): boolean => {
                        if (!note || note.isRest) return false;
                        try {
                            const infoB = identifyChord(bStructuralFor7);
                            if (!infoB?.root) return false;
                            const relB = mod12(note.midi - infoB.root.midi);
                            // Root / 3rd / 5th (triad members)
                            return relB === 0 || relB === 3 || relB === 4 || relB === 7;
                        } catch {
                            return false;
                        }
                    };

                    // (1) Upward resolution (rare): allow the 7th to rise by step to a consonant member
                    // of the arrival chord when this avoids an incomplete resolution harmony.
                    // (2) Delamont "Transference": allow the 7th to rise by step when the expected
                    // resolution tone is realized by another voice in the arrival sonority.
                    if (rel === 10 && nNext && stepUp(n7.midi, nNext.midi)) {
                        const carrier = findResolutionCarrierAtB();
                        if (carrier) {
                            addViolation({
                                ruleId: 'EXC-7-TRANSFERRED-RES',
                                severity: 'exception',
                                description: 'Eccezione: risoluzione della 7a “presa in carico” da un’altra voce (transference)',
                                suggestion:
                                    (
                                        carrier.kind === 'bass'
                                            ? 'Scambio di parti: il basso realizza la nota di risoluzione.\n\n'
                                            : carrier.kind === 'soprano'
                                                ? 'Scambio di parti: il soprano realizza la nota di risoluzione.\n\n'
                                                : carrier.kind === 'lower'
                                                    ? 'Scambio di parti: la voce immediatamente inferiore realizza la nota di risoluzione.\n\n'
                                                    : 'Scambio di parti: un’altra voce realizza la nota di risoluzione.\n\n'
                                    )
                                    + SEVENTH_EXCEPTIONAL_RESOLUTION_HELP,
                                // 2 noteIds so we can render a green connection.
                                noteIds: [n7.id, carrier.note.id],
                            });
                            return;
                        }
                    }

                    if (rel === 10 && nNext && stepUp(n7.midi, nNext.midi) && isConsonantChordMemberAtB(nNext)) {
                        addViolation({
                            ruleId: 'EXC-7-UP',
                            severity: 'exception',
                            description: 'Eccezione: la 7a risolve per moto ascendente',
                            suggestion:
                                'Parte interna/licenza: la 7a sale di grado verso un membro consonante dell’accordo di arrivo (spesso per completezza dell’armonia o logica melodica).\n\n'
                                + SEVENTH_EXCEPTIONAL_RESOLUTION_HELP,
                            noteIds: [n7.id, nNext.id],
                        });
                        return;
                    }

                    // (3) Delamont: upward perfect 4th to another minor seventh.
                    // Accept when the arrival note is itself the chordal minor seventh of the arrival harmony.
                    if (rel === 10 && nNext && isPerfectFourthUp(n7.midi, nNext.midi)) {
                        try {
                            const infoB = identifyChord(bStructuralFor7);
                            if (infoB?.root) {
                                const relToBRoot = mod12(nNext.midi - infoB.root.midi);
                                if (relToBRoot === 10) {
                                    addViolation({
                                        ruleId: 'EXC-7-P4-TO7',
                                        severity: 'exception',
                                        description: 'Eccezione: salto di 4ª perfetta verso un’altra 7a minore',
                                        suggestion:
                                            'Parte interna/licenza: salto ammesso in contesti specifici quando la nuova nota è la 7a dell’accordo successivo.\n\n'
                                            + SEVENTH_EXCEPTIONAL_RESOLUTION_HELP,
                                        noteIds: [n7.id, nNext.id],
                                    });
                                    return;
                                }
                            }
                        } catch { /* ignore */ }
                    }

                    // (3) Stationary / reinterpreted: the 7th can be held if it becomes a consonant member
                    // of the arrival harmony (e.g., V7 -> IV where the 7th becomes the root of IV).
                    if (rel === 10 && nNext && (nNext.midi === n7.midi) && isConsonantChordMemberAtB(nNext)) {
                        addViolation({
                            ruleId: 'EXC-7-STATIC',
                            severity: 'exception',
                            description: 'Eccezione: permanenza della 7a (reinterpretata come nota consonante)',
                            suggestion:
                                'Risoluzione passiva: la 7a resta come nota comune perché l’accordo successivo la reinterpreta come consonanza (o come diversa dissonanza), attenuando l’obbligo di discesa.\n\n'
                                + SEVENTH_EXCEPTIONAL_RESOLUTION_HELP,
                            noteIds: [n7.id, nNext.id],
                        });
                        return;
                    }

                    // (6) Delayed/ornamental resolution: allow a delayed step-down within the same voice
                    // over the next structural event(s).
                    if (rel === 10) {
                        try {
                            let curIdx = idxB;
                            let curNote: StaffNote | null = nNext || null;
                            let hops = 0;
                            while (curNote && hops < 2) {
                                const nxt = findNextStructuralVoiceNote(curIdx, v, curNote.id);
                                if (!nxt?.note) break;
                                const cand = nxt.note as StaffNote;
                                if (stepDown(n7.midi, cand.midi)) {
                                    addViolation({
                                        ruleId: 'EXC-7-DELAYED',
                                        severity: 'exception',
                                        description: 'Eccezione: risoluzione della 7a ritardata/ornamentale',
                                        suggestion: 'Ammesso quando la 7a risolve per grado congiunto dopo un breve ritardo.',
                                        noteIds: [n7.id, cand.id],
                                    });
                                    return;
                                }
                                curIdx = (typeof nxt.index === 'number') ? nxt.index : (curIdx + 1);
                                curNote = cand;
                                hops++;
                            }
                        } catch { /* ignore */ }
                    }

                    // EXC-7m01 transferred resolution: resolution note appears in another voice.
                    // (Or the original voice is silent/absent, but another voice contains the resolution.)
                    const resolutionMidiCandidates = [n7.midi - 1, n7.midi - 2];
                    const transferredResolution = (() => {
                        // Prefer -1 semitone, then -2.
                        // Accept the resolution even if it appears in another octave (pitch-class match).
                        // Use the *structural arrival event* (not just the immediate next scanpoint),
                        // otherwise micro-events can hide the resolution note.
                        const candidates = ((evBFor7 as any)?.notes || b.notes || []).filter((n: any) => n && !n.isRest) as StaffNote[];

                        // 1) Exact MIDI match first.
                        for (const targetMidi of resolutionMidiCandidates) {
                            const hit = candidates
                                .slice()
                                .sort((a, b) => (a.voice ?? 1) - (b.voice ?? 1))
                                .find(n => n.midi === targetMidi);
                            if (hit) return hit;
                        }

                        // 2) Pitch-class match (different octave).
                        const targets = resolutionMidiCandidates.map(m => ({ midi: m, pc: mod12(m) }));
                        let best: { note: StaffNote; score: number } | null = null;
                        for (const cand of candidates) {
                            const pc = mod12(cand.midi);
                            for (const t of targets) {
                                if (pc !== t.pc) continue;
                                // Score: prefer closer register to the expected resolution MIDI.
                                const score = Math.abs(cand.midi - t.midi);
                                if (!best || score < best.score) best = { note: cand, score };
                            }
                        }
                        return best?.note ?? null;
                    })();

                    if (transferredResolution) {
                        addViolation({
                            ruleId: 'EXC-7m01',
                            severity: 'exception',
                            description: 'Risoluzione della settima trasferita',
                            suggestion: 'Eccezione: la nota di risoluzione compare in un’altra voce.',
                            // Keep it to 2 noteIds so the editor can render the green connection line.
                            noteIds: [n7.id, transferredResolution.id],
                        });
                        return;
                    }

                    // (2) Voice exchange / transferred 7th BEFORE resolution: the 7th can move to another
                    // voice (same pitch-class) and then resolve there.
                    if (rel === 10) {
                        try {
                            const pc7 = mod12(n7.midi);
                            const other = bStructuralFor7
                                .filter(n => n && !n.isRest)
                                .find(n => (n.voice ?? 1) !== v && mod12(n.midi) === pc7) as StaffNote | undefined;

                            if (other) {
                                const nextOther = findNextStructuralVoiceNote(idxB, (other.voice ?? 1) as Voice, other.id);
                                const otherRes = nextOther?.note as StaffNote | undefined;
                                if (otherRes && stepDown(other.midi, otherRes.midi)) {
                                    addViolation({
                                        ruleId: 'EXC-7-TRANSFER',
                                        severity: 'exception',
                                        description: 'Eccezione: la 7a è trasferita ad altra voce prima della risoluzione',
                                        suggestion: 'Ammesso tramite cambio di posizione delle voci superiori.',
                                        noteIds: [n7.id, other.id],
                                    });
                                    return;
                                }
                            }
                        } catch { /* ignore */ }
                    }

                    // (6) "Free" seventh / not harmonically available: if the arrival sonority contains
                    // no plausible resolution pitch-class at all, do not flag as an error.
                    if (rel === 10) {
                        try {
                            const targetPcs = new Set([mod12(n7.midi - 1), mod12(n7.midi - 2)]);
                            const hasAnyResolutionTone = [...targetPcs].some(pc => pcsBFor7.has(pc));
                            if (!hasAnyResolutionTone) {
                                addViolation({
                                    ruleId: 'EXC-7-FREE',
                                    severity: 'exception',
                                    description: 'Eccezione: la 7a non ha una risoluzione disponibile nella sonorità di arrivo',
                                    suggestion:
                                        'Risoluzione non disponibile: nella sonorità di arrivo non è presente alcuna nota di risoluzione plausibile (per grado discendente). In questi casi la risoluzione può essere implicita, trasferita o reinterpretata dal contesto.\n\n'
                                        + SEVENTH_EXCEPTIONAL_RESOLUTION_HELP,
                                    noteIds: [n7.id, (nNext?.id ?? n7.id)],
                                });
                                return;
                            }
                        } catch { /* ignore */ }
                    }

                    // No transferred resolution note exists; if the voice continues, flag the error.
                    if (!nNext) return;

                    if (strictR12 && !rootInferredForR12) {
                        addViolation({
                            ruleId: 'R-12',
                            severity: 'error',
                            description: 'Risoluzione errata della settima dell’accordo',
                            noteIds: [n7.id, nNext.id],
                        });
                    }
                });
            }
        }
    }

    _pmark('11-horizontalChecks');
    // =========================================================
    // Harmonic rhythm checks
    // =========================================================
    // R-16: Sincope armonica (a cavallo della battuta)
    // Piston "regola della stanghetta": un accordo sul tempo debole (es. 4°) che si ripresenta
    // sul battere (1°) della misura successiva produce un accento armonico "spostato".
    // Non è un errore se lo stesso accordo era già presente su un tempo forte nella misura precedente.
    // (Gli accordi vanno considerati equivalenti anche in caso di rivolto / cambio voci.)
    const chordIdentity = (chordNotes: StaffNote[]): string => {
        // For the "barline rule" we only care whether the *set of pitch classes* is the same,
        // regardless of inversion/doublings/voice exchange.
        return `pcs:${chordSignature(chordNotes)}`;
    };

    const chordAt = (measureIndex: number, beat: number): StaffNote[] | null => {
        // Cerca tra gli eventi della timeline
        const absBeat = (measureIndex * beatsPerMeas) + (beat - 1);
        const ev = chordEvents.find(e => Math.abs(e.absBeat - absBeat) < 1e-6);
        return ev ? ev.notes : null;
    };

    const lastMeasureIndex = analyzedNotes.reduce((mx, n) => Math.max(mx, n.measureIndex ?? 0), 0);
    const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

    const isStrongBeatInMeasure = (beat: number, ts: TimeSignature): boolean => {
        // `beat` is in quarter-note units with 1-based indexing (1.0 = bar start).
        const b0 = beat - 1;
        if (!Number.isFinite(b0)) return false;

        // Compound meters: strong pulses are dotted-quarter units (3 eighths) => 1.5 quarter units.
        if (isCompoundMeter(ts)) {
            const pulse = 1.5;
            const r = b0 % pulse;
            return approxEq(r, 0, 1e-6) || approxEq(r, pulse, 1e-6);
        }

        // Simple common-time heuristics.
        if (ts.denominator === 4) {
            if (ts.numerator === 4) return approxEq(b0, 0) || approxEq(b0, 2);
            return approxEq(b0, 0);
        }

        // Fallback: only the downbeat is strong.
        return approxEq(b0, 0);
    };

    for (let m = 0; m < lastMeasureIndex; m++) {
        const barStartAbs = m * beatsPerMeas;
        const nextBarStartAbs = (m + 1) * beatsPerMeas;

        // Find the harmony event at the next bar downbeat.
        const nextDownbeatEv = chordEvents.find(e => approxEq(e.absBeat, nextBarStartAbs))
            ?? chordEvents
                .filter(e => e.absBeat >= nextBarStartAbs - 1e-6)
                .sort((a, b) => a.absBeat - b.absBeat)[0];
        if (!nextDownbeatEv) continue;

        // Find the last harmony event strictly before the barline within the previous bar.
        const prevEv = chordEvents
            .filter(e => e.absBeat >= barStartAbs - 1e-6 && e.absBeat < nextBarStartAbs - 1e-6)
            .sort((a, b) => b.absBeat - a.absBeat)[0];
        if (!prevEv) continue;

        const idPrev = chordIdentity(prevEv.notes);
        const idNext = chordIdentity(nextDownbeatEv.notes);
        if (!idPrev || !idNext || idPrev !== idNext) continue;

        // Only flag if the "carry-over" chord enters the barline from a weak position.
        const prevBeat = (prevEv.absBeat - barStartAbs) + 1;
        if (isStrongBeatInMeasure(prevBeat, timeSignature)) continue;

        // Exception: if the same chord already appeared on any strong beat in the previous bar, do not flag.
        const sameOnStrong = chordEvents
            .filter(e => e.absBeat >= barStartAbs - 1e-6 && e.absBeat < nextBarStartAbs - 1e-6)
            .some(e => {
                const beat = (e.absBeat - barStartAbs) + 1;
                return isStrongBeatInMeasure(beat, timeSignature) && chordIdentity(e.notes) === idPrev;
            });
        if (sameOnStrong) continue;

        const sopPrev = pickOuterVoice(prevEv.notes, 1);
        const basPrev = pickOuterVoice(prevEv.notes, 4);
        const sopNext = pickOuterVoice(nextDownbeatEv.notes, 1);
        const basNext = pickOuterVoice(nextDownbeatEv.notes, 4);

        const noteIds = [sopPrev?.id, sopNext?.id, basPrev?.id, basNext?.id].filter(Boolean) as string[];
        if (noteIds.length < 2) continue;

        addViolation({
            ruleId: 'R-16',
            severity: 'warning',
            description: 'Sincope armonica (accordo sul debole che “entra” sul battere successivo)',
            suggestion: 'Secondo la “regola della stanghetta” (Piston), in stile corale/classico è preferibile che il cambio armonico cada sul 1°. Nota: in musica moderna/jazz può essere una scelta ritmica intenzionale e tollerata.',
            noteIds,
        });

        // Explicit connections so the editor shows orange dashed lines across the barline.
        if (sopPrev && sopNext) connections.push({ type: 'horizontal', noteId1: sopPrev.id, noteId2: sopNext.id, severity: 'warning', ruleId: 'R-16' });
        if (basPrev && basNext) connections.push({ type: 'horizontal', noteId1: basPrev.id, noteId2: basNext.id, severity: 'warning', ruleId: 'R-16' });
    }

    _pmark('12-harmonicRhythm');
    // =========================================================
    // Connection synthesis (editor overlay)
    // =========================================================
    // Many rules are expressed as 2-note violations (e.g., voice crossing, spacing, leading-tone resolution).
    // To keep the dashed "correction lines" consistently visible, synthesize connections for those
    // violations when the rule did not explicitly push a connection.
    const noteById = new Map<string, StaffNote>();
    analyzedNotes.forEach(n => {
        noteById.set(n.id, n);
    });

    const hasConnection = (a: string, b: string) => {
        for (const c of connections) {
            if ((c.noteId1 === a && c.noteId2 === b) || (c.noteId1 === b && c.noteId2 === a)) return true;
        }
        return false;
    };

    for (const v of violations) {
        const ids = [...new Set((v.noteIds || []).filter((id) => typeof id === 'string'))];
        if (ids.length !== 2) continue;

        const [id1, id2] = ids;
        const n1 = noteById.get(id1);
        const n2 = noteById.get(id2);
        if (!n1 || !n2) continue;
        if (hasConnection(id1, id2)) continue;

        const sameMoment = (n1.measureIndex ?? 0) === (n2.measureIndex ?? 0) && (n1.beat ?? 1) === (n2.beat ?? 1);
        connections.push({
            type: sameMoment ? 'vertical' : 'horizontal',
            noteId1: id1,
            noteId2: id2,
            severity: v.severity,
            ruleId: v.ruleId,
        });
    }

    _pmark('13-connectionSynthesis');
    // =========================================================
    // Melodic checks (per voice)
    // =========================================================
    (Object.keys(notesByVoice) as unknown as Voice[]).forEach(v => {
        const line = notesByVoice[v];
        for (let i = 0; i < line.length - 1; i++) {
            const n1 = line[i];
            const n2 = line[i + 1];

            // ROTTURA DIDATTICA – skip pairs crossing a double barline boundary
            if (doubleBarlineMeasures && doubleBarlineMeasures.length > 0) {
                if ((n1.measureIndex ?? 0) !== (n2.measureIndex ?? 0)
                    && doubleBarlineMeasures.includes(n1.measureIndex ?? 0)) continue;
            }

            // Recompute MIDI from pitch+octave+accidental to handle
            // stale values (e.g. Cb4 stored as midi 71 instead of 59).
            const _safeMidi = (n: typeof n1): number => {
                // Prefer the stored midi value — it is always correct.
                // Only fall back to pitch+accidental when midi is missing.
                const storedMidi = Number(n.midi);
                if (Number.isFinite(storedMidi) && storedMidi > 0) return storedMidi;
                if (n.pitch == null || (n as any).octave == null) return 0;
                const _bp: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                const base = _bp[String(n.pitch)[0]] ?? 0;
                let acc = 0;
                const a = (n as any).accidental || (n as any).explicitAccidental || '';
                if (a === 'sharp' || a === '#') acc = 1;
                else if (a === 'flat' || a === 'b') acc = -1;
                else if (a === 'double-sharp' || a === '##') acc = 2;
                else if (a === 'double-flat' || a === 'bb') acc = -2;
                return ((n as any).octave + 1) * 12 + base + acc;
            };
            const midiDiff = _safeMidi(n2) - _safeMidi(n1);
            const absSemi = Math.abs(midiDiff);

            // R-15: large leaps in inner voices (Alto/Tenore > 6th)
            if ((v === 2 || v === 3) && absSemi > 9) {
                addViolation({
                    ruleId: 'R-15',
                    severity: 'warning',
                    description: 'Salto melodico ampio nelle voci interne (> 6a)',
                    suggestion: 'Preferisci moto congiunto o spezza il salto con note di passaggio.',
                    noteIds: [n1.id, n2.id],
                });
            }

            // ── R-16: Forbidden melodic intervals ──────────────────────────
            // Skip ornamental notes (passing, neighbor, appoggiatura, etc.)
            const n1Orn = !!(n1 as any).ornamentType;
            const n2Orn = !!(n2 as any).ornamentType;
            if (!n1Orn && !n2Orn) {
                // 7th (m7=10, M7=11 semitones)
                if (absSemi === 10 || absSemi === 11) {
                    addViolation({
                        ruleId: 'R-16',
                        severity: 'error',
                        description: `Salto melodico di 7ª (${absSemi === 10 ? 'minore' : 'maggiore'}) — proibito`,
                        suggestion: 'Evita il salto di settima; preferisci moto congiunto o spezza il salto.',
                        noteIds: [n1.id, n2.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: n1.id, noteId2: n2.id, severity: 'error', ruleId: 'R-16' });
                }
                // 9th+ (≥ 13 semitones, i.e. > octave)
                if (absSemi >= 13) {
                    addViolation({
                        ruleId: 'R-16',
                        severity: 'error',
                        description: `Salto melodico di 9ª o superiore (${absSemi} semitoni) — proibito`,
                        suggestion: 'Evita salti superiori all\'ottava; preferisci moto congiunto.',
                        noteIds: [n1.id, n2.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: n1.id, noteId2: n2.id, severity: 'error', ruleId: 'R-16' });
                }
                // Tritone (6 semitones = 4ª eccedente / 5ª diminuita)
                if (absSemi === 6) {
                    addViolation({
                        ruleId: 'R-16',
                        severity: 'warning',
                        description: 'Salto melodico di tritono (4ª eccedente / 5ª diminuita)',
                        suggestion: 'Il tritono melodico è permesso solo in formulae cadenzali; altrimenti evita o risolvi per grado congiunto.',
                        noteIds: [n1.id, n2.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: n1.id, noteId2: n2.id, severity: 'warning', ruleId: 'R-16' });
                }
                // Augmented 2nd (3 semitones between ♭6 ↔ ♮7 in minor)
                // Must also verify SPELLING: an augmented 2nd is 1 letter-name step,
                // a minor 3rd is 2 letter-name steps. Both are 3 semitones.
                if (absSemi === 3) {
                    const _letterIdx: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
                    const _l1 = _letterIdx[String((n1 as any).pitch || '')[0]] ?? -1;
                    const _l2 = _letterIdx[String((n2 as any).pitch || '')[0]] ?? -1;
                    const _letterDist = (_l1 >= 0 && _l2 >= 0)
                        ? Math.min((_l2 - _l1 + 7) % 7, (_l1 - _l2 + 7) % 7)
                        : -1;
                    // Only flag as augmented 2nd if the letter distance is 1 (a 2nd)
                    // If letter distance is 2 (a 3rd) or unknown, skip — it's a minor 3rd.
                    if (_letterDist === 1) {
                    try {
                        const _localCtx16 = getContextAtAbsBeat(n1.beat + (n1.measureIndex ?? 0) * beatsPerMeasure);
                        const _tPcMap16: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11 };
                        const _tPc16 = _tPcMap16[_localCtx16.tonic] ?? _tPcMap16[keyTonic] ?? 0;
                        const pc1 = mod12(_safeMidi(n1));
                        const pc2 = mod12(_safeMidi(n2));
                        const deg6b = (_tPc16 + 8) % 12;  // ♭6
                        const deg7n = (_tPc16 + 11) % 12;  // ♮7
                        if ((pc1 === deg6b && pc2 === deg7n) || (pc1 === deg7n && pc2 === deg6b)) {
                            // Exception: if the aug 2nd arrives on the leading tone (♮7) and
                            // the next note resolves to the tonic, tolerate it.
                            const tonicPc16 = _tPc16;
                            const landsOnLT = pc2 === deg7n;
                            let ltResolvesToTonic = false;
                            if (landsOnLT && i + 2 < line.length) {
                                const nNext = line[i + 2];
                                const nNextPc = mod12(_safeMidi(nNext));
                                if (nNextPc === tonicPc16 && Math.abs(_safeMidi(nNext) - _safeMidi(n2)) <= 2) {
                                    ltResolvesToTonic = true;
                                }
                            }
                            const aug2Sev = ltResolvesToTonic ? 'exception' as const : 'error' as const;
                            addViolation({
                                ruleId: ltResolvesToTonic ? 'EXC-Aug2-LT' : 'R-16',
                                severity: aug2Sev,
                                description: ltResolvesToTonic
                                    ? 'Seconda eccedente verso la sensibile che risolve alla tonica (tollerata)'
                                    : 'Seconda eccedente (♭6 ↔ ♮7 nel modo minore) — proibita',
                                suggestion: ltResolvesToTonic
                                    ? 'Eccezione: la seconda eccedente è tollerata quando la nota di arrivo è la sensibile e risolve immediatamente alla tonica.'
                                    : 'Evita la seconda eccedente tra ♭VI e ♮VII grado nel modo minore; usa la scala melodica per correggere.',
                                noteIds: [n1.id, n2.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: n1.id, noteId2: n2.id, severity: aug2Sev, ruleId: ltResolvesToTonic ? 'EXC-Aug2-LT' : 'R-16' });
                        }
                    } catch { /* ignore */ }
                    }
                }
                // Chromatic semitone (same letter, different accidental → same direction)
                if (absSemi === 1) {
                    const p1 = (String(n1.pitch || '').match(/[A-G]/i)?.[0] || '').toUpperCase();
                    const p2 = (String(n2.pitch || '').match(/[A-G]/i)?.[0] || '').toUpperCase();
                    if (p1 && p2 && p1 === p2) {
                        // Exception: tonicization — if the tonal context changes between
                        // n1 and n2, or one of the notes is chromatic to the local scale,
                        // the semitone is structural (leading-tone motion) → skip.
                        let isTonicization = false;
                        try {
                            const abs1 = (n1.beat ?? 1) + (n1.measureIndex ?? 0) * beatsPerMeasure;
                            const abs2 = (n2.beat ?? 1) + (n2.measureIndex ?? 0) * beatsPerMeasure;
                            const ctx1 = getContextAtAbsBeat(abs1);
                            const ctx2 = getContextAtAbsBeat(abs2);
                            if (ctx1.tonic !== ctx2.tonic) {
                                isTonicization = true;
                            } else {
                                // Check if either note is chromatic to the local diatonic scale
                                const _tPcMap: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11 };
                                const tPc = _tPcMap[ctx1.tonic] ?? _tPcMap[keyTonic] ?? 0;
                                const isMin = ctx1.isMinor;
                                const majorScale = [0, 2, 4, 5, 7, 9, 11];
                                const minorScale = [0, 2, 3, 5, 7, 8, 10]; // natural minor
                                const scale = (isMin ? minorScale : majorScale).map(s => (s + tPc) % 12);
                                // In minor, also accept raised 6th and 7th (melodic minor)
                                if (isMin) { scale.push((tPc + 9) % 12); scale.push((tPc + 11) % 12); }
                                const scaleSet = new Set(scale);
                                const pc1 = mod12(_safeMidi(n1));
                                const pc2 = mod12(_safeMidi(n2));
                                if (!scaleSet.has(pc1) || !scaleSet.has(pc2)) {
                                    isTonicization = true;
                                }
                            }
                        } catch { /* ignore */ }
                        if (!isTonicization) {
                            // Same pitch letter, different MIDI → chromatic semitone
                            addViolation({
                                ruleId: 'R-16',
                                severity: 'warning',
                                description: 'Semitono cromatico — da evitare nella scrittura diatonica',
                                suggestion: 'Il semitono cromatico (stessa lettera, alterazione diversa) è generalmente da evitare; preferisci movimenti diatonici.',
                                noteIds: [n1.id, n2.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: n1.id, noteId2: n2.id, severity: 'warning', ruleId: 'R-16' });
                        }
                    }
                }
                // m6 or P8 descending — permitted but not ideal, mild warning
                if ((absSemi === 8 || absSemi === 12) && midiDiff < 0) {
                    addViolation({
                        ruleId: 'R-16',
                        severity: 'exception',
                        description: absSemi === 8
                            ? 'Sesta minore discendente — preferibilmente ascendente'
                            : 'Ottava discendente — preferibilmente ascendente',
                        suggestion: 'La sesta minore e l\'ottava sono preferibilmente ascendenti; la forma discendente è tollerata ma meno fluida.',
                        noteIds: [n1.id, n2.id],
                    });
                }
            }

            // ── R-17: Three-note melodic rules ─────────────────────────────
            // These rules examine three consecutive notes in the same voice:
            //   n0 = line[i-1], n1 = line[i], n2 = line[i+1]
            // They require i >= 1 so that n0 exists.
            if (i >= 1 && !n1Orn && !n2Orn) {
                const n0 = line[i - 1];
                const n0Orn = !!(n0 as any).ornamentType;

                // Guard: skip if n0→n1 crosses a double barline
                const n0CrossesBarline = doubleBarlineMeasures && doubleBarlineMeasures.length > 0
                    && (n0.measureIndex ?? 0) !== (n1.measureIndex ?? 0)
                    && doubleBarlineMeasures.includes(n0.measureIndex ?? 0);

                if (!n0Orn && !n0CrossesBarline) {
                    const midi0 = _safeMidi(n0);
                    const midi1 = _safeMidi(n1);
                    const midi2 = _safeMidi(n2);
                    const diff01 = midi1 - midi0;  // signed
                    const diff12 = midi2 - midi1;  // signed
                    const abs01 = Math.abs(diff01);
                    const abs12 = Math.abs(diff12);
                    const totalDiff = midi2 - midi0;  // signed total across 3 notes
                    const absTotal = Math.abs(totalDiff);

                    // R-17a: Sum of two consecutive leaps in the same direction
                    // If both intervals are leaps (> 2 semitones) in the same direction
                    // and their sum produces a forbidden interval (7th or 9th+), flag it.
                    // Exception: if the middle note (n1) is longer than n0, the compound leap is tolerated.
                    if (abs01 > 2 && abs12 > 2
                        && Math.sign(diff01) === Math.sign(diff12)
                        && (absTotal === 10 || absTotal === 11 || absTotal >= 13)) {
                        const dur0 = (n0 as any).durationTicks ?? 960;
                        const dur1 = (n1 as any).durationTicks ?? 960;
                        if (dur1 > dur0) {
                            // Exception: middle note longer → tolerated
                            addViolation({
                                ruleId: 'EXC-R17-Duration',
                                severity: 'exception',
                                description: `Due salti consecutivi sommano ${absTotal >= 13 ? 'una 9ª' : 'una 7ª'} — tollerato (nota intermedia più lunga)`,
                                suggestion: 'Ammesso perché la nota intermedia è più lunga della precedente.',
                                noteIds: [n0.id, n1.id, n2.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: n0.id, noteId2: n2.id, severity: 'exception', ruleId: 'EXC-R17-Duration' });
                        } else {
                            // ── R-17a: Due salti stessa direzione sommano 7ª/9ª ──
                            // Gravità: error (proibito nello stile scolastico).
                            // Condizione di sblocco: solo se nota intermedia più lunga → EXC-R17-Duration.
                            addViolation({
                                ruleId: 'R-17a',
                                severity: 'error',
                                description: `Due salti consecutivi nella stessa direzione sommano ${absTotal >= 13 ? 'una 9ª' : 'una 7ª'} (proibito)`,
                                noteIds: [n0.id, n1.id, n2.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: n0.id, noteId2: n2.id, severity: 'error', ruleId: 'R-17a' });
                        }
                    }

                    // R-17b: 7th or 9th traversed in two movements (opposite/oblique direction) — one must be a 2nd
                    // Only fires when the two sub-leaps are NOT in the same direction (otherwise R-17a handles it).
                    if ((absTotal === 10 || absTotal === 11 || absTotal >= 13)
                        && abs01 > 2 && abs12 > 2
                        && Math.sign(diff01) !== Math.sign(diff12)) {
                        // Check exception: middle note longer than previous
                        const dur0 = (n0 as any).durationTicks ?? 960;
                        const dur1 = (n1 as any).durationTicks ?? 960;
                        if (dur1 <= dur0) {
                            // ── R-17b: Intervallo di 7ª/9ª in due salti entrambi > 2ª ──
                            // Gravità: warning (meno grave di R-17a perché le direzioni
                            // possono non essere identiche, ma nessun salto è congiunto).
                            // Condizione di sblocco: se la nota intermedia è più lunga
                            // della prima, il controllo non scatta.
                            addViolation({
                                ruleId: 'R-17b',
                                severity: 'warning',
                                description: `Intervallo di ${absTotal >= 13 ? '9ª' : '7ª'} percorso in due movimenti senza grado congiunto`,
                                noteIds: [n0.id, n1.id, n2.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: n0.id, noteId2: n2.id, severity: 'warning', ruleId: 'R-17b' });
                        }
                    }

                    // ──────────────────────────────────────────────────────────
                    // R-17c — Successione di Tritono (4ª eccedente)
                    // ──────────────────────────────────────────────────────────
                    // Logica: segnala due o più movimenti consecutivi nella STESSA
                    // direzione la cui somma produce un tritono (6 semitoni).
                    //
                    // Filtro "Cambio Direzione": se la nota intermedia inverte il
                    // moto (es. F→F#↑ poi F#→B↓), la tensione è annullata e il
                    // warning resta inattivo.  → Math.sign(diff01) === Math.sign(diff12)
                    //
                    // Gerarchia di gravità:
                    //   Alta  (severity 'error')   — valori brevi (crome/semicrome ≤ 480 ticks)
                    //   Media (severity 'warning')  — valori lunghi (semiminime+, > 480 ticks)
                    //   La durata attenua la durezza della successione.
                    //
                    // Condizione di sblocco: il movimento è tollerato solo se
                    // l'ultima nota risolve immediatamente per grado congiunto
                    // in senso opposto al salto (≤ 2 semitoni, direzione inversa).
                    // ──────────────────────────────────────────────────────────
                    if (absTotal === 6 && Math.sign(diff01) === Math.sign(diff12) && i + 2 < line.length) {
                        const n3 = line[i + 2];
                        const n3Orn = !!(n3 as any).ornamentType;
                        // Guard: skip if n2→n3 crosses a double barline
                        const n3CrossesBarline = doubleBarlineMeasures && doubleBarlineMeasures.length > 0
                            && (n2.measureIndex ?? 0) !== (n3.measureIndex ?? 0)
                            && doubleBarlineMeasures.includes(n2.measureIndex ?? 0);
                        if (!n3Orn && !n3CrossesBarline) {
                            const midi3 = _safeMidi(n3);
                            const diff23 = midi3 - midi2;
                            const abs23 = Math.abs(diff23);
                            const ascending = totalDiff > 0;

                            // Condizione di sblocco: risoluzione per grado congiunto
                            // in senso opposto al salto (≤ 2 semitoni).
                            let resolved = false;
                            if (ascending && diff23 < 0 && abs23 <= 2) resolved = true;   // tritono asc → risolve scendendo
                            if (!ascending && diff23 > 0 && abs23 <= 2) resolved = true;   // tritono disc → risolve salendo

                            if (!resolved) {
                                // Gerarchia di gravità basata sulla durata
                                const _durTrit0 = (n0 as any).durationTicks ?? 960;
                                const _durTrit1 = (n1 as any).durationTicks ?? 960;
                                const _isShortTrit = _durTrit0 <= 480 || _durTrit1 <= 480;  // croma = 480 ticks
                                const _tritSev: HarmonyViolation['severity'] = _isShortTrit ? 'error' : 'warning';

                                addViolation({
                                    ruleId: 'R-17c',
                                    severity: _tritSev,
                                    description: `Successione di tritono (4ª eccedente) delineata in due movimenti senza risoluzione${_isShortTrit ? ' — valori brevi, gravità alta' : ''}`,
                                    suggestion: ascending
                                        ? 'Dopo un tritono ascendente, l\'ultima nota deve risolvere discendendo di semitono o tono.'
                                        : 'Dopo un tritono discendente, l\'ultima nota deve risolvere ascendendo di semitono o tono.',
                                    noteIds: [n0.id, n1.id, n2.id, n3.id],
                                });
                                connections.push({ type: 'horizontal', noteId1: n0.id, noteId2: n2.id, severity: _tritSev, ruleId: 'R-17c' });
                            }
                        }
                    }
                }
            }

            // R-06: incorrect resolution of augmented/diminished melodic leaps
            // IMPORTANT: the interval quality must be computed from spelling (pitch letter + octave),
            // not from the global key. Otherwise chromatic lines get misclassified.

            // Recompute MIDI from pitch+octave+accidental to handle stale values (e.g. Cb4=71→59)
            // But prefer stored midi when accidental is missing (generated notes).
            const _safeMidi06 = (n: StaffNote): number => {
                const hasSpelling = n.pitch != null && (n as any).octave != null;
                const hasAcc = !!(n as any).accidental || !!(n as any).explicitAccidental;
                // If no spelling info or no accidental info, trust stored midi
                if (!hasSpelling || !hasAcc) {
                    const stored = Number(n.midi);
                    if (Number.isFinite(stored) && stored > 0) return stored;
                    if (!hasSpelling) return 0;
                }
                const _bp: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                const base = _bp[String(n.pitch)[0]] ?? 0;
                let acc = 0;
                const a = (n as any).accidental || (n as any).explicitAccidental || '';
                if (a === 'sharp' || a === '#') acc = 1;
                else if (a === 'flat' || a === 'b') acc = -1;
                else if (a === 'double-sharp' || a === '##') acc = 2;
                else if (a === 'double-flat' || a === 'bb') acc = -2;
                return ((n as any).octave + 1) * 12 + base + acc;
            };

            const spellingPc = (n: StaffNote): number | null => {
                try {
                    const letter = (String(n.pitch || '').match(/[A-G]/i)?.[0] || '').toUpperCase();
                    if (!letter) return null;
                    const baseIdx = noteNameToIndex[letter];
                    if (!Number.isFinite(baseIdx as any)) return null;

                    const acc = (n.explicitAccidental ?? n.accidental ?? null) as any;
                    let delta = 0;
                    if (acc === 'sharp') delta = 1;
                    else if (acc === 'flat') delta = -1;
                    else if (acc === 'double-sharp') delta = 2;
                    else if (acc === 'double-flat') delta = -2;
                    else if (acc === 'natural') delta = 0;
                    else {
                        // If accidentals aren't set, try to infer from pitch string (e.g. "C#").
                        const s = String(n.pitch || '');
                        if (s.includes('#')) delta = 1;
                        else if (s.toLowerCase().includes('b')) delta = -1;
                    }

                    return mod12((baseIdx as number) + delta);
                } catch {
                    return null;
                }
            };
            const isOrnamental = (n: StaffNote | undefined) => {
                if (!n) return false;
                const anyN = n as any;
                return Boolean(anyN.isPassing || anyN.isNeighbor || anyN.isAnticipation || anyN.isAppoggiatura || anyN.isEscape || anyN.isSuspension);
            };

            // If the melodic segment includes an ornament/anticipation, the strict
            // augmented/diminished-resolution rule is often not meaningful.
            if (isOrnamental(n1) || isOrnamental(n2)) {
                continue;
            }

            // If the stored spelling (pitch+accidental) does not match the MIDI pitch-class,
            // interval-quality inference becomes unreliable (especially after key changes).
            // In that case, skip R-06 for this segment rather than producing false "dim/aug".
            try {
                const pc1 = spellingPc(n1);
                const pc2 = spellingPc(n2);
                const mpc1 = mod12(_safeMidi06(n1));
                const mpc2 = mod12(_safeMidi06(n2));
                if (pc1 != null && pc1 !== mpc1) continue;
                if (pc2 != null && pc2 !== mpc2) continue;
            } catch { /* ignore */ }
            const diatonicSize = (() => {
                const letterIndex: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
                const p1 = (String(n1.pitch || '').match(/[A-G]/i)?.[0] || '').toUpperCase();
                const p2 = (String(n2.pitch || '').match(/[A-G]/i)?.[0] || '').toUpperCase();
                const i1 = letterIndex[p1];
                const i2 = letterIndex[p2];
                if (!Number.isFinite(i1 as any) || !Number.isFinite(i2 as any)) {
                    // Fallback to staff position if pitch spelling is missing.
                    return Math.min(Math.abs((n2.position ?? 0) - (n1.position ?? 0)), 7);
                }
                const octFromMidi = (m: number | undefined) => {
                    const mm = Number(m);
                    return Number.isFinite(mm) ? (Math.floor(mm / 12) - 1) : NaN;
                };
                const o1 = Number.isFinite(octFromMidi(n1.midi)) ? octFromMidi(n1.midi) : Number(n1.octave);
                const o2 = Number.isFinite(octFromMidi(n2.midi)) ? octFromMidi(n2.midi) : Number(n2.octave);
                const d1 = (Number(o1) * 7) + (i1 as number);
                const d2 = (Number(o2) * 7) + (i2 as number);
                // Use the SIMPLE interval class, but preserve melodic direction.
                // Absolute diatonic distance is wrong for descending motion:
                // e.g. C# -> A# is a descending 3rd, not a 6th.
                const diatonicSteps = midiDiff >= 0 ? (d2 - d1) : (d1 - d2);
                return Math.abs(diatonicSteps) % 7;
            })();

            // Definition-level guard: R-06 is about augmented/diminished *leaps*.
            // Do not treat unisons/seconds (often chromatic inflections) as "leaps" here.
            if (diatonicSize <= 1) {
                continue;
            }
            const simpleSemi = absSemi % 12;
            const quality = getIntervalQuality(diatonicSize, simpleSemi);
            if (quality === 'Augmented' || quality === 'Diminished') {

                const n3 = line[i + 2];
                if (n3) {
                    if (isOrnamental(n3)) {
                        continue;
                    }
                    const nextDiff = _safeMidi06(n3) - _safeMidi06(n2);
                    const nextAbs = Math.abs(nextDiff);
                    const resolvesByStep = nextAbs > 0 && nextAbs <= 2;
                    // Classical rule: after an augmented/diminished leap, resolve by step
                    // ("inward" = contract the interval). Direction depends on which note
                    // is the altered one, so we accept step resolution in either direction.
                    // E.g. A→D# (dim 5th down) resolving D#→E (up by semitone) is valid
                    // because D# is the leading-tone resolving to the tonic of V.
                    if (quality === 'Augmented') {
                        if (!resolvesByStep) {
                            addViolation({
                                ruleId: 'R-06',
                                severity: 'error',
                                description: 'Risoluzione errata di salto melodico aumentato',
                                suggestion: 'Dopo un intervallo aumentato, risolvi per grado congiunto (moto congiunto).',
                                noteIds: [n1.id, n2.id, n3.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: n1.id, noteId2: n2.id, severity: 'error', ruleId: 'R-06' });
                            connections.push({ type: 'horizontal', noteId1: n2.id, noteId2: n3.id, severity: 'error', ruleId: 'R-06' });
                        }
                    } else {
                        if (!resolvesByStep) {
                            addViolation({
                                ruleId: 'R-06',
                                severity: 'error',
                                description: 'Risoluzione errata di salto melodico diminuito',
                                suggestion: 'Dopo un intervallo diminuito, risolvi per grado congiunto (moto congiunto).',
                                noteIds: [n1.id, n2.id, n3.id],
                            });
                            connections.push({ type: 'horizontal', noteId1: n1.id, noteId2: n2.id, severity: 'error', ruleId: 'R-06' });
                            connections.push({ type: 'horizontal', noteId1: n2.id, noteId2: n3.id, severity: 'error', ruleId: 'R-06' });
                        }
                    }
                }
            }
        }
    });

    _pmark('14-melodicChecks');
    // =========================================================
    // Post-processing: de-duplicate LT errors vs LT exceptions
    // =========================================================
    // If a leading-tone situation is explicitly marked as an exception (green),
    // do not also show an R-07 error/warning for the same note-pair.
    try {
        const exceptionPairs = new Set<string>();
        for (const v of (violations || [])) {
            if (!v || v.severity !== 'exception') continue;
            const ids = Array.isArray(v.noteIds) ? v.noteIds : [];
            const norm = ids.filter(Boolean).map(x => String(x));
            if (norm.length < 2) continue;
            // record all unordered pairs among the first few ids (exceptions are usually 2-note)
            for (let i = 0; i < Math.min(norm.length, 4); i++) {
                for (let j = i + 1; j < Math.min(norm.length, 4); j++) {
                    const a = norm[i];
                    const b = norm[j];
                    if (!a || !b) continue;
                    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                    exceptionPairs.add(key);
                }
            }
        }
        if (exceptionPairs.size > 0) {
            violations = (violations || []).filter(v => {
                if (!v) return false;
                if (v.ruleId !== 'R-07') return true;
                const ids = Array.isArray(v.noteIds) ? v.noteIds : [];
                const norm = ids.filter(Boolean).map(x => String(x));
                if (norm.length < 2) return true;
                const a = norm[0];
                const b = norm[1];
                const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                if (exceptionPairs.has(key)) return false;
                return true;
            });
        }
    } catch { /* ignore */ }

    // Sort violations by severity (error -> warning -> exception) then by rule id for readability.
    const sevRank: Record<RuleViolation['severity'], number> = { error: 0, warning: 1, exception: 2 };
    violations.sort((a, b) => {
        const sd = sevRank[a.severity] - sevRank[b.severity];
        if (sd !== 0) return sd;
        return a.ruleId.localeCompare(b.ruleId);
    });

    // ── Learned ornament patterns (supplement auto-detection) ──
    try {
        const _lrnEnabled = getString(ENABLE_LEARNED_ORNAMENTS_KEY) !== '0';
        if (_lrnEnabled && ORNAMENT_LEARNED_PATTERNS && typeof ORNAMENT_LEARNED_PATTERNS === 'object') {
            const _LRN_MIN_PROB = 0.9;
            const _LRN_MIN_SAMPLES = 2;
            const _lrnVoiceChains = new Map<number, any[]>();
            for (const n of analyzedNotes) {
                if (!n || (n as any).isRest) continue;
                const v = (n as any).voice ?? 1;
                if (!_lrnVoiceChains.has(v)) _lrnVoiceChains.set(v, []);
                _lrnVoiceChains.get(v)!.push(n);
            }
            for (const ch of _lrnVoiceChains.values()) ch.sort((a: any, b: any) => (a.startTick ?? 0) - (b.startTick ?? 0));
            const _lrnTs = timeSignature || { numerator: 4, denominator: 4 };
            for (const n of analyzedNotes) {
                if (!n || (n as any).isRest) continue;
                const an = n as any;
                if (an.isPassing || an.isNeighbor || an.isAppoggiatura || an.isAnticipation || an.isEscape || an.isSuspension || an.ornamentOverride) continue;
                const v = an.voice ?? 1;
                const ch = _lrnVoiceChains.get(v) || [];
                const idx = ch.indexOf(n);
                const prev = idx > 0 ? ch[idx - 1] : null;
                const next = idx >= 0 && idx < ch.length - 1 ? ch[idx + 1] : null;
                const ei = prev ? (an.midi - (prev as any).midi) : null;
                const xi = next ? ((next as any).midi - an.midi) : null;
                const pk = `${ornDurationCategory(an.duration || 'quarter')}_${ornBeatStrength(Number(an.beat) || 1, _lrnTs)}_${ei != null ? ornIntervalBucket(ei) : 'none'}_${xi != null ? ornIntervalBucket(xi) : 'none'}`;
                const pat = ORNAMENT_LEARNED_PATTERNS[pk];
                if (!pat) continue;
                if ((pat._total ?? 0) < _LRN_MIN_SAMPLES || (pat._probability ?? 0) < _LRN_MIN_PROB) continue;
                const dom = pat._dominant;
                if (dom === 'suspension') continue; // suspensions need richer context
                // ── Guardrail: skip chord tones on/off beat ──
                // A note with ≥2 (on-beat) or ≥3 (off-beat) other structural
                // notes *sounding* at the same moment (including held notes) is
                // very likely a chord tone, not an ornament (e.g. E in C-G-C-E,
                // or G in a cadential I6/4→V where the upper voices are held).
                {
                    const _beat = Number(an.beat) || 1;
                    const _meas = an.measureIndex ?? 0;
                    const _isOnBeat = Math.abs(_beat - Math.round(_beat)) < 0.01;
                    const _soundingAtBeat = analyzedNotes.filter((bn: any) => {
                        if (!bn || bn.isRest || bn.id === an.id) return false;
                        if ((bn.measureIndex ?? 0) !== _meas) return false;
                        if (bn.isPassing || bn.isNeighbor || bn.isAppoggiatura ||
                            bn.isAnticipation || bn.isEscape || bn.isSuspension) return false;
                        const bnBeat = Number(bn.beat) || 1;
                        if (bnBeat > _beat + 0.01) return false;
                        const bnDur = (DURATION_VALUES as any)[bn.duration] || 1;
                        const bnDurAdj = bn.isDotted ? bnDur * 1.5 : bnDur;
                        return (bnBeat + bnDurAdj) > _beat + 0.01;
                    });
                    // On-beat: ≥2 other sounding structural notes → chord tone
                    // Off-beat: ≥3 other sounding structural notes → very likely chord tone
                    const _threshold = _isOnBeat ? 2 : 3;
                    if (_soundingAtBeat.length >= _threshold) continue;
                }
                if (dom === 'passing') { an.isPassing = true; an.ornamentMark = 'P'; }
                else if (dom === 'neighbor') { an.isNeighbor = true; an.ornamentMark = 'v'; }
                else if (dom === 'appoggiatura') { an.isAppoggiatura = true; an.ornamentMark = 'a'; }
                else if (dom === 'anticipation') { an.isAnticipation = true; an.ornamentMark = 'ant'; }
                else if (dom === 'escape') { an.isEscape = true; an.ornamentMark = 's'; }
                else continue;
                an.learnedOrnament = true;
            }
        }
    } catch { /* ignore learned ornament errors */ }

    // ── Apply manual ornament overrides (always win over auto-detection) ──
    try {
        if (ornamentOverrides?.length) {
            // Direct ID match
            const ovByIdLate = new Map<string, string>();
            for (const o of ornamentOverrides) {
                if (o?.noteId && o?.type) ovByIdLate.set(o.noteId, o.type);
            }
            // Composite key match for orphaned IDs
            const ovByCkLate = new Map<string, string>();
            const noteIdSetLate = new Set(analyzedNotes.map(n => n.id));
            for (const o of ornamentOverrides) {
                if (!o?.type) continue;
                if (o.noteId && noteIdSetLate.has(o.noteId)) continue;
                if (o.midi != null && o.measureIndex != null && o.beat != null) {
                    ovByCkLate.set(`${o.midi}-${o.measureIndex}-${o.beat}`, o.type);
                }
            }
            for (const n of analyzedNotes) {
                let ov = ovByIdLate.get(n.id);
                if (!ov && ovByCkLate.size > 0) {
                    const midi = Number((n as any).midi);
                    if (Number.isFinite(midi)) {
                        ov = ovByCkLate.get(`${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`);
                    }
                }
                if (!ov) continue;
                const anyN = n as any;
                anyN.isPassing = false;
                anyN.isNeighbor = false;
                anyN.isAppoggiatura = false;
                anyN.isAnticipation = false;
                anyN.isEscape = false;
                anyN.isCambiata = false;
                anyN.isSuspension = undefined;
                anyN.ornamentMark = undefined;
                if (ov === 'passing') { anyN.isPassing = true; anyN.ornamentMark = 'P'; }
                else if (ov === 'neighbor') { anyN.isNeighbor = true; anyN.ornamentMark = 'v'; }
                else if (ov === 'appoggiatura') { anyN.isAppoggiatura = true; anyN.isSuspension = { type: 'app', manual: true }; anyN.ornamentMark = 'a'; }
                else if (ov === 'anticipation') { anyN.isAnticipation = true; anyN.ornamentMark = 'ant'; }
                else if (ov === 'escape') { anyN.isEscape = true; anyN.ornamentMark = 's'; }
                else if (ov === 'cambiata') { anyN.isCambiata = true; anyN.ornamentMark = 'C'; }
                else if (ov === 'suspension') { anyN.isSuspension = { type: 'susp', manual: true }; anyN.ornamentMark = 'r'; }
                else if (ov === 'ornamental') { /* no flags, no mark — ornamentOverride alone excludes from analysis */ }
                anyN.ornamentOverride = ov;

                // ── For manual appoggiatura / suspension, populate resolution data
                // so the label pipeline can substitute the ornament note with
                // its resolution and identify the correct chord. ──
                if (ov === 'appoggiatura' || ov === 'suspension') {
                    const voice = (n as any).voice ?? 1;
                    const beatsPerMeas = timeSignature.numerator * (4 / timeSignature.denominator);
                    const nAbsBeat = ((n as any).measureIndex ?? 0) * beatsPerMeas + (((n as any).beat ?? 1) - 1);
                    // Find next note in same voice after this one
                    let bestNext: any = null;
                    let bestDist = Infinity;
                    for (const cand of analyzedNotes) {
                        if ((cand as any).voice !== voice) continue;
                        if (cand === n) continue;
                        const cAbsBeat = ((cand as any).measureIndex ?? 0) * beatsPerMeas + (((cand as any).beat ?? 1) - 1);
                        const dist = cAbsBeat - nAbsBeat;
                        if (dist > 1e-6 && dist < bestDist) {
                            bestDist = dist;
                            bestNext = cand;
                        }
                    }
                    if (bestNext) {
                        const s = anyN.isSuspension || {};
                        s.fromAbsBeat = nAbsBeat;
                        s.resolvedMidi = (bestNext as any).midi;
                        s.resolvedPitch = (bestNext as any).pitch;
                        s.resolvedOctave = (bestNext as any).octave;
                        s.resolvedAccidental = (bestNext as any).accidental ?? '';
                        s.resolvedById = (bestNext as any).id;

                        // ── Compute classic suspension type (e.g. "4-3") from intervals ──
                        // Find the bass note at the same onset to measure intervals.
                        try {
                            const beatsPerMeas2 = timeSignature.numerator * (4 / timeSignature.denominator);
                            const suspMidi = Number((n as any).midi);
                            const resMidi = Number((bestNext as any).midi);
                            let bassMidi: number | null = null;
                            for (const bn of analyzedNotes) {
                                if ((bn as any).voice !== 4 && (bn as any).voice !== 3) continue;
                                const bAbs = ((bn as any).measureIndex ?? 0) * beatsPerMeas2 + (((bn as any).beat ?? 1) - 1);
                                if (Math.abs(bAbs - nAbsBeat) > 1e-6) continue;
                                const bm = Number((bn as any).midi);
                                if (!Number.isFinite(bm)) continue;
                                if (bassMidi === null || bm < bassMidi) bassMidi = bm;
                            }
                            if (bassMidi !== null && Number.isFinite(suspMidi) && Number.isFinite(resMidi)) {
                                const diatonicInterval = (interval: number): number => {
                                    // Simple diatonic interval number from semitone distance
                                    const semis = Math.abs(interval);
                                    const table = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7, 8];
                                    return semis <= 12 ? table[semis] : (((semis - 1) % 12) + 1);
                                };
                                const fromNum = diatonicInterval(suspMidi - bassMidi);
                                const toNum = diatonicInterval(resMidi - bassMidi);
                                if (fromNum > 0 && toNum > 0) {
                                    s.fromNum = fromNum;
                                    s.toNum = toNum;
                                    const classicTypes: Record<string, string> = {
                                        '4-3': '4-3', '6-5': '6-5', '7-6': '7-6',
                                        '7-8': '7-8', '8-7': '8-7', '9-8': '9-8', '2-3': '2-3',
                                    };
                                    const typeKey = `${fromNum}-${toNum}`;
                                    if (classicTypes[typeKey]) {
                                        s.type = classicTypes[typeKey];
                                    }
                                }
                            }
                        } catch { /* ignore */ }

                        anyN.isSuspension = s;
                    }
                }
            }
        }
    } catch { /* ignore */ }

    _pmark('15-postProcessing');
    if (_profiling) { (globalThis as any).__HARMONY_TIMINGS = _pTimings; }
    return { analyzedNotes, violations, connections, inferredAnalysisContexts, autoHarmonyLabelOverrides };
}

/**
 * Pure function: substitute suspension/appoggiatura notes with their resolution
 * counterparts in a set of event notes. This mirrors the substitution logic in
 * useHarmonyLabels so that headless callers (e.g. regression-check) can obtain
 * the same analysisNotes used for getRomanAnalysis in the live UI.
 *
 * @param eventNotes  - notes sounding at one beat (e.g. from getActiveNotesTimeline)
 * @param absBeat     - the absolute beat of this event
 * @returns notes with suspensions replaced by their resolutions
 */
export function substituteSuspensionsForAnalysis(eventNotes: any[], absBeat: number): any[] {
    const SUSP_EPS = 1e-3;
    const suspResolutions: any[] = [];
    for (const n of eventNotes) {
        if (!n || n.isRest) continue;
        const s = n?.isSuspension;
        if (!s || typeof s.fromAbsBeat !== 'number') continue;
        // Mirror useHarmonyLabels: auto-detected suspensions only substitute bass (voice 4).
        // Manual overrides substitute any voice.
        if (!s.manual && ((n as any).voice ?? 1) !== 4) continue;
        if (Math.abs(s.fromAbsBeat - absBeat) >= SUSP_EPS) continue;
        if (typeof s.resolvedMidi === 'number') {
            suspResolutions.push({
                ...n,
                midi: s.resolvedMidi,
                pitch: s.resolvedPitch ?? n.pitch,
                octave: s.resolvedOctave ?? n.octave,
                accidental: s.resolvedAccidental != null ? s.resolvedAccidental : (n.accidental ?? ''),
                isSuspension: undefined,
                _isSuspensionResolutionSubstitute: true,
            });
        }
    }
    if (!suspResolutions.length) return eventNotes;

    const suspSubstVoices = new Set(suspResolutions.map((n: any) => n.voice ?? 1));
    const filtered = eventNotes.filter((n: any) => {
        if (!n || n.isRest) return true;
        if (suspSubstVoices.has(n.voice ?? 1)) return false;
        const s = n?.isSuspension;
        if (!s || typeof s.fromAbsBeat !== 'number') return true;
        return Math.abs(s.fromAbsBeat - absBeat) >= SUSP_EPS;
    });
    filtered.push(...suspResolutions);
    return filtered.length >= 2 ? filtered : eventNotes;
}