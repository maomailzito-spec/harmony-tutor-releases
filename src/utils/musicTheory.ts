/**
 * Restituisce una timeline di eventi armonici: per ogni punto significativo (inizio/fine nota),
 * fornisce tutte le note attive in quell'istante (considerando le note prolungate).
 * Utile per analisi armonica completa (es. Cmaj7 con C minima + E,G,B sul beat successivo).
 */
export function getActiveNotesTimeline(
    notes: StaffNote[],
    timeSignature: TimeSignature
): Array<{ absBeat: number; measureIndex: number; beat: number; notes: StaffNote[] }> {
    const beatsPerMeas = timeSignature.numerator * (4 / timeSignature.denominator);
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
        const start = (m * beatsPerMeas) + (b - 1);
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
            const start = (m * beatsPerMeas) + (b - 1);
            const dur = getDuration(n);
            return start <= absBeat && absBeat < (start + dur - 1e-6);
        });
        const measureIndex = Math.floor(absBeat / beatsPerMeas);
        const beat = (absBeat % beatsPerMeas) + 1;
        return { absBeat, measureIndex, beat, notes: activeNotes };
    });
}
import { Key, ScaleType, DisplayNote, StaffNote, KeySignature, EnharmonicMode, ScaleShape, ChordType, Voicing, AccidentalType, Voice, HarmonyAnalysisResult, ErrorConnection, RuleViolation, TimeSignature, ClefType, BuiltInChords, AnalysisContext } from '../types';
import { NOTE_NAMES, ALL_NOTE_SPELLINGS, FRET_COUNT, GUITAR_TUNING, SCALE_INTERVALS as BUILT_IN_SCALE_INTERVALS, CHORD_FORMULAS, DURATION_VALUES, TICKS_PER_QUARTER } from '../constants';

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
    timeSignature: TimeSignature
): StaffNote[] {
    // Filter notes for the target measure and voice
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

const alterationToGlyph = (alt: number): string => {
    if (!Number.isFinite(alt) || alt === 0) return '';
    if (alt > 0) return '♯'.repeat(Math.min(4, Math.round(alt)));
    return '♭'.repeat(Math.min(4, Math.round(-alt)));
};

const effectiveMidi = (n: any): number | null => {
    try {
        if (!n || n.isRest) return null;
        const octave = Number(n.octave);
        const noteIndex = Number(n.noteIndex);
        if (Number.isFinite(octave) && Number.isFinite(noteIndex)) {
            return (octave + 1) * 12 + mod12(noteIndex);
        }
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
                const candidates = (arr || []).filter(n => n && !n.isRest && Number.isFinite((n as any).midi));
                if (candidates.length === 0) return null;
                const byVoice4 = candidates.filter(n => Number((n as any).voice) === 4);
                if (byVoice4.length) return byVoice4.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                const byBassClef = candidates.filter(n => String((n as any).clef || '') === 'bass');
                if (byBassClef.length) return byBassClef.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                return candidates.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
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
            baseNums = [7];
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
            .map(n => `${alterationToGlyph(alt(n))}${n}`);

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
      const keyUsesFlats = keySignature.type === 'flat' && keySignature.count > 0;
      noteName = keyUsesFlats ? (possibleNames.find(n => n.includes('b')) || possibleNames[1]) : (possibleNames.find(n => !n.includes('b')) || possibleNames[0]);
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
    const acc: any = (anyN?.userAccidental ?? anyN?.explicitAccidental ?? anyN?.accidental ?? null);

    // Derive from spelling when possible.
    let spelledPc: number | null = null;
    try {
        // Accept pitches that already include accidentals ("C#", "DB").
        // IMPORTANT: do NOT match letter-only pitches here, otherwise we ignore explicitAccidental.
        if (/^[A-G]([#B]{1,2})$/.test(pitch)) {
            const nameDirect = pitch.replace('B', 'b'); // normalize accidental casing
            const idxDirect = (noteNameToIndex as any)[nameDirect];
            if (Number.isFinite(idxDirect)) spelledPc = mod12(idxDirect);
        } else if (/^[A-G]$/.test(pitch)) {
            const suffix =
                acc === 'sharp' || acc === '#' ? '#' :
                acc === 'flat' || acc === 'b' ? 'b' :
                acc === 'double-sharp' || acc === '##' ? '##' :
                acc === 'double-flat' || acc === 'bb' ? 'bb' :
                acc === 'natural' || acc === 'n' ? '' :
                '';
            const name = `${pitch}${suffix}`;
            const idx = (noteNameToIndex as any)[name];
            if (Number.isFinite(idx)) spelledPc = mod12(idx);
        }
    } catch { /* ignore */ }

    // If the user explicitly set an accidental, trust the spelling over MIDI.
    // This prevents common UI/edit states where the glyph (explicitAccidental) is updated
    // but MIDI lags by ±1 semitone, which would otherwise mislabel secondary dominants in inversions
    // (e.g. D/F# collapsing to ii6 if F# is treated as F).
    try {
        const hasExplicitAcc = anyN?.userAccidental != null || anyN?.explicitAccidental != null;
        if (hasExplicitAcc && spelledPc != null) return spelledPc;
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

// Important: order matters. Fr+/Ger+ are supersets of It+; we must test them first
// or they'll be swallowed by the more general It+ matcher.
// If both Ger+ and Fr+ pitch-classes are present (common with added tones), prefer Ger+.
const CHROMATIC_CHORD_DEFINITIONS: { [key: string]: { symbol: string, matcher: (chord: StaffNote[], keyInfo: { tonicIndex: number, isMinor: boolean }) => boolean } } = {
    GERMAN_AUGMENTED_SIXTH: {
        symbol: 'Ger+',
        matcher: (chord, keyInfo) => {
            // Ger+ contains ♭6–1–♭3–♯4 (e.g. in C: Ab–C–Eb–F#).
            const pcs = new Set(chord.map(pitchClassOf));
            // Allow extra pitch-classes (passing tones/doublings) without losing the core sonority.
            if (pcs.size < 4) return false;

            const b6 = (keyInfo.tonicIndex + 8) % 12;  // ♭6
            const one = keyInfo.tonicIndex % 12;       // 1
            const flat3 = (keyInfo.tonicIndex + 3) % 12; // ♭3
            const sharp4 = (keyInfo.tonicIndex + 6) % 12; // ♯4
            return pcs.has(b6) && pcs.has(one) && pcs.has(flat3) && pcs.has(sharp4);
        }
    },
    FRENCH_AUGMENTED_SIXTH: {
        symbol: 'Fr+',
        matcher: (chord, keyInfo) => {
            // Fr+ contains ♭6–1–2–♯4.
            const pcs = new Set(chord.map(pitchClassOf));
            // Allow extra pitch-classes (passing tones/doublings) without losing the core sonority.
            if (pcs.size < 4) return false;

            const b6 = (keyInfo.tonicIndex + 8) % 12;  // ♭6
            const one = keyInfo.tonicIndex % 12;       // 1
            const two = (keyInfo.tonicIndex + 2) % 12; // 2
            const sharp4 = (keyInfo.tonicIndex + 6) % 12; // ♯4

            // If ♭3 is present too, prefer labeling as Ger+.
            const flat3 = (keyInfo.tonicIndex + 3) % 12;
            if (pcs.has(flat3)) return false;

            return pcs.has(b6) && pcs.has(one) && pcs.has(two) && pcs.has(sharp4);
        }
    },
    ITALIAN_AUGMENTED_SIXTH: {
        symbol: 'It+',
        matcher: (chord, keyInfo) => {
            // It+ contains ♭6–1–♯4.
            const pcs = new Set(chord.map(pitchClassOf));
            // Allow extra pitch-classes (passing tones/doublings) without losing the core sonority.
            if (pcs.size < 3) return false;

            const b6 = (keyInfo.tonicIndex + 8) % 12;  // ♭6
            const one = keyInfo.tonicIndex % 12;       // 1
            const sharp4 = (keyInfo.tonicIndex + 6) % 12; // ♯4
            return pcs.has(b6) && pcs.has(one) && pcs.has(sharp4);
        }
    },
};
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
    BuiltInChords.Minor11, BuiltInChords.Add9, BuiltInChords.Major7,
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

        // For fully diminished 7ths, pick a deterministic root (smallest pitch class)
        // to keep the analysis stable across inversions.
        if (isSymmetricDim7) {
            const minPc = Math.min(...uniquePitches);
            if (candidate.root.noteIndex === minPc) score += 3;
        }
        candidate.score = score;
    }

    allCandidates.sort((a, b) => b.score - a.score);
    const { score, priority, matchType, ...bestMatch } = allCandidates[0];
    return bestMatch;
}

// Return detailed candidate list for debugging/inspection.
export function identifyChordCandidates(notes: StaffNote[]) {
    if (!notes || notes.length < 2) return [];
    const validNotes = notes.filter(n => !n.isRest);
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
        const isSymmetricDim7 = candidate.type === BuiltInChords.Diminished7;
        const allowBassRootBonus = !hasExactSeventhCandidate || !isSixthChord(candidate.type) || isSeventhLike(candidate.type);
        if (!isSymmetricDim7 && allowBassRootBonus && bassPc != null && candidate.root.noteIndex === bassPc) score += 5;
        if (isSymmetricDim7) {
            const minPc = Math.min(...uniquePitches);
            if (candidate.root.noteIndex === minPc) score += 3;
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
  [BuiltInChords.Dominant7]: '7',
  [BuiltInChords.Diminished7]: '°7',
  [BuiltInChords.Minor7b5]: 'm7♭5',
  [BuiltInChords.Major6]: '6',
  [BuiltInChords.Minor6]: 'm6',
  [BuiltInChords.Major9]: 'maj9',
  [BuiltInChords.Minor9]: 'm9',
  [BuiltInChords.Dominant9]: '9',
  [BuiltInChords.Add9]: 'add9',
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
            const pcs = [...new Set(valid.map(n => mod12(n.noteIndex)))];
            const leadingPc = mod12(tonicIndex - 1);
            const dominantPc = mod12(tonicIndex + 7);
            const dim7Set = new Set<number>([
                leadingPc,
                mod12(leadingPc + 3),
                mod12(leadingPc + 6),
                mod12(leadingPc + 9),
            ]);
            const subset = pcs.length >= 3 && pcs.every(pc => dim7Set.has(pc));
            if (subset) {
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
        if (isSeventhLike) {
            const allPcs = new Set<number>((chord || []).filter(n => n && !n.isRest).map(pitchClassOf).map(mod12));
            const ints = new Set<number>([...allPcs].map(pc => mod12(pc - chordRootPc)));
            const already = analysisText;

            const addIfPresent = (interval: number, token: string) => {
                if (ints.has(interval) && !already.includes(token)) {
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
    keyInfo: { tonicIndex: number; isMinor: boolean }
): string {
    const { root: chordRoot, type: quality } = chordInfo;
    // Prefer explicit pitch-class (`noteIndex`) when available. This is required for
    // virtual roots used by the label layer and heuristics.
    const chordRootIndex = (chordRoot && Number.isFinite((chordRoot as any).noteIndex))
        ? mod12((chordRoot as any).noteIndex)
        : mod12((chordRoot as any).midi);
    const { tonicIndex: keyTonicIndex, isMinor: isMinorMode } = keyInfo;

    const isNeapolitanRoot = chordRootIndex === (keyTonicIndex + 1) % 12;
    if (isNeapolitanRoot && quality === BuiltInChords.Major) return 'N';

    const isFlatTwoRoot = chordRootIndex === (keyTonicIndex + 1) % 12;
    if (isFlatTwoRoot && quality === BuiltInChords.Major7) return '♭IImaj7';

    const isFourthDegreeRoot = chordRootIndex === (keyTonicIndex + 5) % 12;
    if (!isMinorMode && isFourthDegreeRoot && quality === BuiltInChords.Minor7) return 'iv7';

    const isFlatSixthRoot = chordRootIndex === (keyTonicIndex + 8) % 12;
    if (!isMinorMode && isFlatSixthRoot && quality === BuiltInChords.Major7) return '♭VImaj7';

    const romanNumeralsMajor = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
    // In minor, the III degree is not *always* augmented; it depends on the actual chord spelling.
    // Keep the base numeral as 'III' and let quality logic append '+' only when appropriate.
    const romanNumeralsMinorHarmonic = ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°'];
    const scaleIntervalsMajor = [0, 2, 4, 5, 7, 9, 11];
    const scaleIntervalsMinorHarmonic = [0, 2, 3, 5, 7, 8, 11];
    const scaleIntervals = isMinorMode ? scaleIntervalsMinorHarmonic : scaleIntervalsMajor;
    const romanNumerals = isMinorMode ? romanNumeralsMinorHarmonic : romanNumeralsMajor;

    // Secondary dominants (V/x)
    // - Dominant-type chords: allow directly.
    // - Dominant *triads*: allow only when they contain the chromatic leading tone
    //   of the target degree (prevents false V/VI readings like III in minor).
    {
        const diatonicScaleIntervals = isMinorMode ? [0, 2, 3, 5, 7, 8, 10] : scaleIntervalsMajor;
        const diatonicPcSet = new Set<number>(diatonicScaleIntervals.map(iv => mod12(keyTonicIndex + iv)));

        const isDominantType = typeof quality === 'string' && quality.startsWith('Dominant');
        const isMajorTriad = quality === BuiltInChords.Major;
        const hasMajorThird = !!(chordInfo as any)?.intervals?.has?.(4);

        // Only consider triads when we can confirm the major third is present.
        const allowTriadSecondary = isMajorTriad && hasMajorThird;

        // For dominant-type chords, require the major 3rd. Without it, many sonorities
        // (e.g. ii6/5 = D–F–A–C) can be reinterpreted as a "dominant 7#9 without 3rd",
        // which would incorrectly produce V/x labels.
        if ((isDominantType && hasMajorThird) || allowTriadSecondary) {
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

                const targetRoman = isMinorMode
                    ? ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'][i]
                    : romanNumeralsMajor[i];
                return `V/${targetRoman}`;
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

    let roman = romanNumerals[degreeIndex];
    const effectiveQuality = (quality === BuiltInChords.Add9) ? BuiltInChords.Major : quality;

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

    if (effectiveQuality === BuiltInChords.Major && roman.toLowerCase() === roman) roman = roman.toUpperCase();
    else if (quality === BuiltInChords.Minor && roman.toUpperCase() === roman) roman = roman.toLowerCase();
    else if (quality === BuiltInChords.Diminished && !roman.includes('°')) roman += '°';
    else if (quality === BuiltInChords.Augmented && !roman.includes('+')) roman += '+';

    return roman;
}

export function getRomanAnalysis(
    chord: StaffNote[],
    keySignatureRoot: string,
    isMinorMode: boolean
): { roman: string; figures: string[] } | null {
    if (!chord || chord.length < 2) return null;

    const baseChord = (chord || []).filter(n => n && !n.isRest);
    if (baseChord.length < 2) return null;

    // For Roman numerals, we want the *underlying harmony* rather than surface dissonances.
    // If a note is marked as a suspension and is dissonant against the current bass,
    // treat it as a non-chord tone for the purpose of labeling.
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
            // Consonant intervals above the bass (mod 12): unison, 3rd, 5th, 6th.
            return !([0, 3, 4, 7, 8, 9].includes(interval));
        } catch {
            return false;
        }
    };

    // Base filtering for both L2 figures and roman: remove surface ornaments.
    const filteredChordForFigures = (chord || []).filter(n => {
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

    if (filteredChordForFigures.length < 2) return null;

    // Livello 2 (cifratura) is computed *only* from the vertical intervals,
    // independent of any roman/symbol/function interpretation.
    // IMPORTANT: keep suspensions here so 9-8 etc still show up as figures.
    const figuresL2 = computeFiguredBassFromNotes(filteredChordForFigures, FIGURED_BASS_UI_OPTIONS).figures;

    // For Roman numerals, prefer the underlying harmony: drop dissonant suspension tones.
    // (But do not affect the figured-bass output above.)
    let filteredChord = filteredChordForFigures.filter((n: any) => !(n?.isSuspension && isDissonantVsBass(n)));
    if (filteredChord.length < 2) filteredChord = filteredChordForFigures;

    const keyTonicIndex = noteNameToIndex[keySignatureRoot];
    if (keyTonicIndex === undefined) return null;
    const keyInfo = { tonicIndex: keyTonicIndex, isMinor: isMinorMode };

    // L3 policy (accademico): a 6/4 over the dominant bass is labeled as tonic 6/4 (I4/6 or i4/6),
    // not as V4/6. Functional/cadential handling stays in the rule layer, not in the label.
    try {
        const hasFigureValue = (v: number) => (figuresL2 || []).some(f => extractFigureValue(f) === v);
        const has64 = hasFigureValue(6) && hasFigureValue(4);
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

    // When we only have a dyad (2 pitch classes), chord-ID can prefer sus/pedal readings
    // that map to the wrong roman numeral (e.g. C–G -> V). If the dyad cleanly fits the
    // diatonic triad implied by the bass, prefer that roman for stability.
    const inferDiatonicRomanFromBassDyad = (): { roman: string } | null => {
        try {
            const pcs = [...new Set((filteredChord || []).map(pitchClassOf).map(mod12))];
            if (pcs.length > 2) return null;

            const bass = pickPreferredBassNote(filteredChord as any);
            if (!bass) return null;
            const bassPc = mod12(pitchClassOf(bass));

            const scaleIntervals = isMinorMode
                ? [0, 2, 3, 5, 7, 8, 10] // natural minor
                : [0, 2, 4, 5, 7, 9, 11];
            const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
            const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
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

    for (const definition of Object.values(CHROMATIC_CHORD_DEFINITIONS)) {
        if (definition.matcher(filteredChord, keyInfo)) return { roman: definition.symbol, figures: figuresL2 };
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
            const scaleIntervals = isMinorMode
                ? [0, 2, 3, 5, 7, 8, 10] // natural minor
                : [0, 2, 4, 5, 7, 9, 11];
            const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
            const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
            const romans = isMinorMode ? romanMin : romanMaj;

            let best: { score: number; i: number } | null = null;

            for (let i = 0; i < scaleIntervals.length; i++) {
                const targetPc = mod12(tonicPc + scaleIntervals[i]);
                const ltPc = mod12(targetPc - 1);
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
    // collapses a dominant-function sonority (common with V7/V resolutions), prefer the
    // unfiltered vertical *only when* it yields a dominant-type chord.
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
        }
    } catch { /* ignore */ }

    if (!chordInfo || !chordInfo.root || !chordInfo.type) return null;

    let baseRomanSymbol = calculateRomanNumeral(chordInfo, keyInfo);

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
            for (const c of candidates as any[]) {
                const roman = calculateRomanNumeral({ root: c.root, type: c.type, intervals: c.intervals }, keyInfo);
                if (!roman || !roman.startsWith('V/')) continue;
                const score = Number.isFinite(c.score) ? (c.score as number) : 0;
                if (!bestSecondary || score > bestSecondary.score) bestSecondary = { roman, score };
            }
            if (bestSecondary) {
                baseRomanSymbol = bestSecondary.roman;
            }
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

    return { roman: baseRomanSymbol, figures: figuresL2 };
}

export function calculateNoteBeats(notes: StaffNote[], timeSignature: TimeSignature): StaffNote[] {
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

    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

    const voices = new Map<Voice, StaffNote[]>();
    normalizedNotes.forEach(note => {
        const voice = note.voice || 1;
        if (!voices.has(voice)) voices.set(voice, []);
        voices.get(voice)!.push(note);
    });

    const processedNotes: StaffNote[] = [];

    voices.forEach(voiceNotes => {
        let measureIndex = 0;
        let durationInMeasure = 0;
        let tupletContext: { notesInGroup: number; beatsForGroup: number; notesProcessed: number } | null = null;

        for (const note of voiceNotes) {
            let durationInBeats = DURATION_VALUES[note.duration || 'quarter'] * (note.isDotted ? 1.5 : 1);

            if (!tupletContext) {
                if (note.isTriplet) tupletContext = { notesInGroup: 3, beatsForGroup: durationInBeats * 2, notesProcessed: 0 };
                else if (note.isDuplet) tupletContext = { notesInGroup: 2, beatsForGroup: durationInBeats * 3, notesProcessed: 0 };
            }

            if (tupletContext) durationInBeats = tupletContext.beatsForGroup / tupletContext.notesInGroup;

            if (durationInMeasure + durationInBeats > beatsPerMeasure + 0.001) {
                measureIndex++;
                durationInMeasure = 0;
            }

            processedNotes.push({
                ...note,
                measureIndex,
                beat: durationInMeasure + 1,
            });

            durationInMeasure += durationInBeats;

            if (tupletContext) {
                tupletContext.notesProcessed++;
                if (tupletContext.notesProcessed >= tupletContext.notesInGroup) tupletContext = null;
            }
        }
    });

    return processedNotes.sort((a, b) => {
        const mDiff = (a.measureIndex ?? 0) - (b.measureIndex ?? 0);
        if (mDiff !== 0) return mDiff;
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
    timeSignature?: TimeSignature
): HarmonyAnalysisResult {
    const DEBUG_ANALYSIS = false;
    const debugLog = (...args: any[]) => {
        if (!DEBUG_ANALYSIS) return;
        try { console.log(...args); } catch (_) {}
    };
    // Defensive normalization: in some saved/edited states `noteIndex` can become stale.
    // Keep spelling-related fields intact; only align pitch-class for analysis.
    const analyzedNotes = (notes || []).map((n) => {
        try {
            if (!n || (n as any).isRest) return n;
            const midi = (n as any).midi;
            if (Number.isFinite(midi)) {
                return { ...(n as any), noteIndex: mod12(midi) } as StaffNote;
            }
        } catch { /* ignore */ }
        return n;
    });
    debugLog('[ANALYSIS] applyHarmonyRules called - notes:', analyzedNotes.length, 'key:', keyTonic, 'isMinor:', isMinor);
    const violations: RuleViolation[] = [];
    const connections: ErrorConnection[] = [];

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
    const scanPointsSet = new Set<number>();
    analyzedNotes.forEach(n => {
        if (n.isRest) return;
        const m = n.measureIndex ?? 0;
        const b = n.beat ?? 1;
        const start = (m * beatsPerMeas) + (b - 1);
        const end = start + getDuration(n);
        scanPointsSet.add(start);
        scanPointsSet.add(end);
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

                // Diagnostic logging for problematic passing-note cases (match the specific B id).
                const debugTargetIds = new Set([
                    'aa7659d2-b357-4369-a706-d11ea39b0b31', // B on levare
                ]);
                if (debugTargetIds.has(cur.id)) {
                    try {
                        const prevDur = durPrev;
                        const curDur = durCur;
                        const nextDur = durNext;
                        const prevEvInfo = prevEv ? { absBeat: prevEv.absBeat, beat: prevEv.beat, measureIndex: prevEv.measureIndex, notes: prevEv.notes.map(n=>n.pitch+'('+n.midi+')') } : null;
                        const curEvInfo = curEv ? { absBeat: curEv.absBeat, beat: curEv.beat, measureIndex: curEv.measureIndex, notes: curEv.notes.map(n=>n.pitch+'('+n.midi+')') } : null;
                        const nextEvInfo = nextEv ? { absBeat: nextEv.absBeat, beat: nextEv.beat, measureIndex: nextEv.measureIndex, notes: nextEv.notes.map(n=>n.pitch+'('+n.midi+')') } : null;
                        if (DEBUG_ANALYSIS) {
                            debugLog('[DEBUG PASSING] prev:', { id: prev.id, pitch: prev.pitch, midi: prev.midi, beat: prev.beat, measure: prev.measureIndex, dur: prevDur, inChord: prevConsonant },
                                'cur:', { id: cur.id, pitch: cur.pitch, midi: cur.midi, beat: cur.beat, measure: cur.measureIndex, dur: curDur, inChord: curConsonant },
                                'next:', { id: next.id, pitch: next.pitch, midi: next.midi, beat: next.beat, measure: next.measureIndex, dur: nextDur, inChord: nextConsonant },
                                'events:', { prevEv: prevEvInfo, curEv: curEvInfo, nextEv: nextEvInfo },
                                'isShortNonHarmonic', isShortNonHarmonic, 'beatsPerMeasure', beatsPerMeasure, 'scanPointsCount', chordEvents.length
                            );
                        }
                    } catch (err) {
                        console.warn('[DEBUG PASSING] logging failed', err);
                    }
                }

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
                if (prevConsonant && nextConsonant && (((!curConsonant) && !curInPrevOrNext) || isShortNonHarmonic)) {
                    cur.isPassing = true;
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
                try {
                    const fullAtEvent = otherNotesAtEvent(ev);
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

                const others = otherNotesAtEvent(ev, note.id);

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

                    const allowConsonantNeighbor = shortNeighbor && isWeakBeat(cur, curEv) && stableOtherVoices;
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
                        (cur as any).ornamentMark = 'a';
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

                if (passesDissonanceTest && strongBeat) {
                    const inSemis = prev ? semis(prev, cur) : Infinity;
                    const leapIn = prev ? (inSemis > 2) : false;
                    const stepIn = prev ? (inSemis > 0 && inSemis <= 2) : false;
                    const prepared = prev ? (inSemis === 0) : false;
                    const unknownIn = !prev;

                    const outSemis = semis(cur, next);
                    const stepOut = outSemis > 0 && outSemis <= 2;

                    if ((unknownIn || leapIn || stepIn || prepared) && stepOut) {
                        (cur as any).isAppoggiatura = true;
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

                // Escape tone (cambiata): step into a dissonance, leap out in opposite direction.
                if (prev && prevEv && !curCon && prevCon && nextCon && isWeakBeat(cur, curEv)) {
                    const stepIn = semis(prev, cur) > 0 && semis(prev, cur) <= 2;
                    const leapOut = semis(cur, next) > 2;
                    const oppositeDir = sgn(prev, cur) !== 0 && sgn(prev, cur) === -sgn(cur, next);
                    if (stepIn && leapOut && oppositeDir) {
                        (cur as any).isEscape = true;
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
                if (prev && prevEv && !curCon && prevCon && nextCon && !isWeakBeat(cur, curEv)) {
                    const stepIn = semis(prev, cur) > 0 && semis(prev, cur) <= 2;
                    const leapOut = semis(cur, next) > 2;
                    const oppositeDir = sgn(prev, cur) !== 0 && sgn(prev, cur) === -sgn(cur, next);
                    if (stepIn && leapOut && oppositeDir) {
                        (cur as any).isEscape = true;
                        addOrnament(
                            'R-ORN-ESC',
                            'warning',
                            'Nota di sfuggita su tempo forte (sospetta)',
                            'La sfuggita è tipicamente su tempo debole; su tempo forte può comportarsi come appoggiatura/altro accento dissonante.',
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

                const prevEv = findEventForNote(prev, v);
                const curEv = findEventForNote(cur, v);
                const nextEv = findEventForNote(next, v);
                if (!prevEv || !curEv || !nextEv) continue;

                const sPrev = upperSig(prevEv);
                const sCur = upperSig(curEv);
                const sNext = upperSig(nextEv);
                if (!sPrev || !sCur || !sNext) continue;
                if (!(sPrev === sCur && sCur === sNext)) continue;

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

                if (stepOut) {
                    (cur as any).isPassing = true;
                    // No analysis-panel entry; this is a label-stability aid.
                    continue;
                }

                if (leapOut && oppositeDir) {
                    (cur as any).isEscape = true;
                    // No analysis-panel entry; this is a label-stability aid.
                    continue;
                }
            }
        } catch {
            // ignore
        }
    }

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
                if (!prep) continue; // no preparatory note found

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

                // Rule 2: S must start before or at the downbeat (tied or began before change)
                const sStart = getNoteStart(S);
                const prepEnd = getNoteEnd(prep);
                const tiedOrStartedBefore = (S.id === prep.id) || (sStart < b.absBeat - 1e-6) || (prepEnd > b.absBeat - 1e-6);
                if (!tiedOrStartedBefore) continue;

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
                            const chordInfoWithS = identifyChord(notesAtBAll);
                            const chordInfoWithoutS = identifyChord(notesAtBAll.filter(n => n && n.id !== S.id));

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
                    const chordInfoFull = identifyChord(fullForGuard);
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

                    const chordInfoB = identifyChord(chordSourceNotes);
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
                            const chordInfoRes = identifyChord(evRes.notes as any);
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
                                const chordInfoBFull2 = identifyChord((b.notes || []) as any);
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
                                : identifyChord(otherVoicesAtB as any);
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
                const suspPayload = { type: displayType || 'susp', fromAbsBeat: b.absBeat, resolvedById: resolved.id, fromNum, toNum };
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
            // If a note is explicitly marked as a suspension *starting at this scanpoint*,
            // treat it as a non-chord tone for the purpose of naming the underlying harmony.
            return notes.filter((n) => {
                try {
                    const s = n?.isSuspension;
                    if (!s || typeof s.fromAbsBeat !== 'number') return true;
                    return Math.abs((s.fromAbsBeat as number) - absBeat) > 1e-6;
                } catch {
                    return true;
                }
            });
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
            const aRoman = romanAt(a);
            const bRoman = romanAt(b);

            const aBass = getLowestNote(a);
            const bBass = getLowestNote(b);

            // Neapolitan: expect resolution to V (or V/...) soon.
            // Accept variants like N6.
            if ((aRoman || '').toUpperCase().startsWith('N')) {
                const ok = bRoman.toLowerCase().startsWith('v');
                if (!ok) {
                    addViolation({
                        ruleId: 'R-N-RES',
                        severity: 'warning',
                        description: 'Risoluzione atipica della Napolitana (N)',
                        suggestion: 'In stile corale classico, N tende a risolvere verso V (spesso in 6).',
                        noteIds: withEndpoints((a.notes || []).slice(0, 4).map(n => n.id), aBass?.id, bBass?.id),
                    });
                    addResolutionConnection(a, b, 'R-N-RES', 'warning');
                }
            }

            // Augmented sixth chords: It+/Fr+/Ger+ should resolve to V.
            if (aRoman === 'It+' || aRoman === 'Fr+' || aRoman === 'Ger+') {
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
                const bass = (a.notes || []).slice().sort((x, y) => (x.midi ?? 0) - (y.midi ?? 0))[0];
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
                const rootPc = chordInfo?.root?.noteIndex ?? null;
                const bass = getLowestNote(ev);
                const bassPc = bass ? bass.noteIndex : null;
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
                        'Marker informativo: V(7)→I con entrambi in stato fondamentale e soprano sulla tonica all’arrivo.',
                        a,
                        b
                    );
                } else {
                    markCadence(
                        'CAD-IAC',
                        'Cadenza autentica imperfetta (IAC)',
                        'Marker informativo: V(7)→I, ma manca almeno una condizione della PAC (soprano non su tonica e/o inversione).',
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
                    'Marker informativo: arrivo su V alla stanghetta (cadenza sospesa).',
                    a,
                    b
                );
                continue;
            }
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
        if (isDev) {
            const esc = (violations as any[]).filter(v => (v?.ruleId === 'ORN-ESC' || v?.ruleId === 'R-ORN-ESC'));
            if (esc.length) {
                const passMap = new Map<string, boolean>();
                for (const n of analyzedNotes as any[]) passMap.set(n.id, !!n.isPassing);
                for (const v of esc) {
                    const ids: string[] = Array.isArray(v?.noteIds) ? v.noteIds : [];
                    // eslint-disable-next-line no-console
                    console.warn('[ANALYSIS][DEV] ORN-ESC still present', {
                        ruleId: v.ruleId,
                        noteIds: ids,
                        passingFlags: ids.map(id => ({ id, isPassing: passMap.get(id) ?? null })),
                        description: v.description,
                    });
                }
            }
        }
    } catch { /* ignore */ }

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

        // Otherwise, keep existing behavior (treat every event as potentially meaningful).
        return true;
    };

    chordEvents.forEach(ev => {
        const v1 = ev.byVoice.get(1);
        const v2 = ev.byVoice.get(2);
        const v3 = ev.byVoice.get(3);
        const v4 = ev.byVoice.get(4);
        const present = [v1, v2, v3, v4].filter(Boolean) as StaffNote[];

        const isNonChordToneAtEvent = (n: StaffNote, e: ChordEvent) => {
            try {
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
                    const isDim7 = (chordInfo.type || '').toLowerCase().includes('diminished7') || (chordInfo.type || '').toLowerCase().includes('dim7');
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
        const leadingNotes = present.filter(n => (n.midi % 12) === leadingPc);
        if (leadingNotes.length >= 2) {
            addViolation({
                ruleId: 'R-10',
                severity: 'error',
                description: 'Raddoppio della sensibile',
                suggestion: 'Evita di raddoppiare il 7° grado: preferisci raddoppiare la tonica o la quinta.',
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
                            severity: 'error',
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
                        suggestion: string,
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
                    if (seventhPc !== null) {
                        const seventhNotes = harmonicPresent.filter(n => n.noteIndex === seventhPc);
                        if (seventhNotes.length >= 2) {
                            addDoublingViolation(
                                'R-10-7TH',
                                'error',
                                'Raddoppio della 7ª dell’accordo',
                                'In stile corale, la 7ª è una dissonanza che tende a risolvere: evita di raddoppiarla.',
                                seventhNotes
                            );
                        }
                    }

                    // R-10-64: in 6/4 (2nd inversion triads), prefer doubling the 5th (bass).
                    const isTriadQuality = [BuiltInChords.Major, BuiltInChords.Minor, BuiltInChords.Diminished, BuiltInChords.Augmented].includes(chordInfo.type as any);
                    if (isTriadQuality && thirdPc !== null && fifthPc !== null) {
                        const bass = harmonicPresent
                            .filter(n => Number.isFinite(n.midi as any))
                            .slice()
                            .sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
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
                                                'In un 6/4 (accordo in 2ª inversione) di norma si raddoppia la 5ª (il basso) per stabilizzare la sonorità.',
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
                                const thirdIsLeadingTone = thirdPc === leadingPc;

                                // Common-practice exception: on ii in major (supertonic triad),
                                // doubling the 3rd (scale-degree 4) is often perfectly acceptable.
                                // This preference warning is meant to be conservative, so skip ii.
                                let allowThirdDoublingHere = false;
                                try {
                                    const ctx = getContextAtAbsBeat(ev.absBeat);
                                    const tonicIndex = noteNameToIndex[ctx.tonic];
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
                                    addDoublingViolation(
                                        'R-10-3RD',
                                        'warning',
                                        'Raddoppio atipico: 3ª raddoppiata in stato fondamentale',
                                        'In una triade in stato fondamentale, di norma si preferisce raddoppiare la fondamentale (tonica se I/i) più che la 3ª.',
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

                        const bass = harmonicPresent
                            .filter(n => Number.isFinite(n.midi as any))
                            .slice()
                            .sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
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

                                    // Case A: bass is strong degree -> prefer doubling bass.
                                    if (isStrongDegree(bassDegree) && doubledPc !== bass.noteIndex) {
                                        // Skip if bass is itself leading-tone-related (rare in first inversion triads), since R-10 covers LT doubling.
                                        addViolation({
                                            ruleId: 'R-10-6',
                                            severity: 'warning',
                                            description: 'Preferenza di raddoppio in 6: basso su grado forte',
                                            suggestion: 'In un accordo in primo rivolto, se il basso (3ª dell’accordo) è un grado forte (I/IV/V; talvolta II), è spesso preferibile raddoppiare il basso.',
                                            noteIds: [bass.id, ...harmonicPresent.filter(n => n.noteIndex === doubledPc).map(n => n.id)],
                                        });
                                    }

                                    // Case B: bass is weak degree -> avoid doubling bass; prefer doubling a strong degree present.
                                    if (isWeakDegree(bassDegree) && doubledPc === bass.noteIndex) {
                                        // Only complain if there exists a strong degree in the chord to double instead.
                                        if (chordStrongPcs.length > 0) {
                                            addDoublingViolation(
                                                'R-10-6',
                                                'warning',
                                                'Preferenza di raddoppio in 6: basso su grado debole',
                                                'Se il basso (3ª dell’accordo) è un grado debole (III/VI/VII), di norma si evita di raddoppiarlo; preferisci raddoppiare un grado forte presente nell’accordo (I/IV/V; talvolta II).',
                                                harmonicPresent.filter(n => n.noteIndex === bass.noteIndex)
                                            );
                                        }
                                    } else if (isWeakDegree(bassDegree) && !doubledIsStrong && chordStrongPcs.length > 0) {
                                        // Very soft nudge: if you’re doubling a weak degree while a strong one is available, prefer the strong.
                                        const doubledNotes = harmonicPresent.filter(n => n.noteIndex === doubledPc);
                                        if (doubledNotes.length >= 2) {
                                            addDoublingViolation(
                                                'R-10-6',
                                                'warning',
                                                'Preferenza di raddoppio in 6: scegli un grado forte',
                                                'Con basso su grado debole, è spesso più stabile raddoppiare un grado forte presente nell’accordo (I/IV/V; talvolta II) invece di raddoppiare un grado debole.',
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

        // R-04 / EXC-S02: voice crossing
        if (v4 && v3 && v4.midi > v3.midi) {
            addViolation({
                ruleId: 'R-04',
                severity: 'error',
                description: 'Incrocio di voci grave (Basso sopra Tenore)',
                suggestion: 'Riordina le altezze: Basso deve restare sotto il Tenore.',
                noteIds: [v4.id, v3.id],
            });
        }
        if (v3 && v2 && v3.midi > v2.midi) {
            // tolerated case: Alto/Tenore
            addViolation({
                ruleId: 'EXC-S02',
                severity: 'warning',
                description: 'Incrocio Alto/Tenore (tollerato)',
                suggestion: 'Di norma evita l’incrocio; può essere accettabile per esigenze melodiche.',
                noteIds: [v3.id, v2.id],
            });
        }
        if (v2 && v1 && v2.midi > v1.midi) {
            addViolation({
                ruleId: 'R-04',
                severity: 'error',
                description: 'Incrocio di voci grave (Alto sopra Soprano)',
                suggestion: 'Riordina le altezze: Alto deve restare sotto il Soprano.',
                noteIds: [v2.id, v1.id],
            });
        }

        // R-08: excessive spacing (S-A, A-T > octave)
        if (v1 && v2 && (v1.midi - v2.midi) > 12) {
            addViolation({
                ruleId: 'R-08',
                severity: 'warning',
                description: 'Spaziatura eccessiva tra Soprano e Alto (> 8va)',
                suggestion: 'Avvicina Alto e Soprano entro l’ottava.',
                noteIds: [v1.id, v2.id],
            });
        }
        if (v2 && v3 && (v2.midi - v3.midi) > 12) {
            addViolation({
                ruleId: 'R-08',
                severity: 'warning',
                description: 'Spaziatura eccessiva tra Alto e Tenore (> 8va)',
                suggestion: 'Avvicina Tenore e Alto entro l’ottava.',
                noteIds: [v2.id, v3.id],
            });
        }

        // Very conservative: flag *extremely* wide Tenor–Bass spacing.
        // (TB can easily be a 12th+ in chorales; warn only for truly extreme spreads.)
        if (v3 && v4 && (v3.midi - v4.midi) > 31) {
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
    });

    // =========================================================
    // Horizontal checks (between consecutive chords)
    // =========================================================
    const isOrnamental = (n: StaffNote | undefined | null): boolean => {
        if (!n) return false;
        try {
            const anyN = n as any;
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

    for (let i = 0; i < chordEvents.length - 1; i++) {
        const a = chordEvents[i];
        const b = chordEvents[i + 1];

        const aV: Partial<Record<Voice, StaffNote>> = {
            1: a.byVoice.get(1),
            2: a.byVoice.get(2),
            3: a.byVoice.get(3),
            4: a.byVoice.get(4),
        };
        const bV: Partial<Record<Voice, StaffNote>> = {
            1: b.byVoice.get(1),
            2: b.byVoice.get(2),
            3: b.byVoice.get(3),
            4: b.byVoice.get(4),
        };

        const voices: Voice[] = [1, 2, 3, 4];

        // R-13: all voices move in same direction
        const dirs: number[] = [];
        voices.forEach(v => {
            const n1 = aV[v];
            const n2 = bV[v];
            if (!n1 || !n2) return;
            const d = dir(n1.midi, n2.midi);
            dirs.push(d);
        });
        // La regola scatta solo se tutte le voci si muovono (nessun d === 0) e tutte nella stessa direzione
        if (dirs.length === 4 && dirs.every(d => d !== 0) && dirs.every(d => d === dirs[0])) {
            const notePairs = voices.map(v => ({ a: aV[v], b: bV[v] })).filter(pair => pair.a && pair.b);
            addViolation({
                ruleId: 'R-13',
                severity: 'warning',
                description: 'Moto parallelo di tutte le voci',
                suggestion: 'Preferisci introdurre moto contrario o obliquo per dare indipendenza alle linee.',
                noteIds: notePairs.flatMap(pair => [pair.a!.id, pair.b!.id]),
            });
            // Add errorConnections for overlay rendering
            notePairs.forEach(pair => {
                connections.push({
                    type: 'horizontal',
                    noteId1: pair.a!.id,
                    noteId2: pair.b!.id,
                    severity: 'warning',
                    ruleId: 'R-13',
                });
            });
        }

        // R-14: similar motion outer voices
        const sopA = aV[1];
        const sopB = bV[1];
        const basA = aV[4];
        const basB = bV[4];
        if (sopA && sopB && basA && basB) {
            const dS = dir(sopA.midi, sopB.midi);
            const dB = dir(basA.midi, basB.midi);
            const sopranoMelodicInterval = Math.abs(sopB.midi - sopA.midi);
            if (dS !== 0 && dS === dB) {
                if (sopranoMelodicInterval <= 2) {
                    addViolation({
                        ruleId: 'EXC-Hidden-Stepwise',
                        severity: 'exception',
                        description: 'Moto retto/nascosto ammesso (Soprano per grado congiunto)',
                        suggestion: 'Eccezione classica: il Soprano si muove per grado congiunto.',
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });
                } else {
                    addViolation({
                        ruleId: 'R-14',
                        severity: 'warning',
                        description: 'Moto simile tra le voci estreme (Soprano/Basso)',
                        suggestion: 'Il moto contrario tra voci estreme è spesso più stabile.',
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });
                }
                // Add errorConnections for overlay rendering
                connections.push({
                    type: 'horizontal',
                    noteId1: sopA.id,
                    noteId2: sopB.id,
                    severity: sopranoMelodicInterval <= 2 ? 'exception' : 'warning',
                    ruleId: sopranoMelodicInterval <= 2 ? 'EXC-Hidden-Stepwise' : 'R-14',
                });
                connections.push({
                    type: 'horizontal',
                    noteId1: basA.id,
                    noteId2: basB.id,
                    severity: sopranoMelodicInterval <= 2 ? 'exception' : 'warning',
                    ruleId: sopranoMelodicInterval <= 2 ? 'EXC-Hidden-Stepwise' : 'R-14',
                });
            }
        }

        // R-09: false relation chromatic
        // Compare pitch letters with different accidentals across voices between consecutive chords.
        const notesA = a.notes.filter(n => !n.isRest);
        const notesB = b.notes.filter(n => !n.isRest);
        for (const n1 of notesA) {
            const p1 = (n1.pitch || '').toUpperCase();
            const acc1 = (n1.explicitAccidental ?? n1.accidental ?? null) as AccidentalType | null;
            if (!p1) continue;
            for (const n2 of notesB) {
                if ((n1.voice ?? 1) === (n2.voice ?? 1)) continue;
                const p2 = (n2.pitch || '').toUpperCase();
                if (p1 !== p2) continue;
                const acc2 = (n2.explicitAccidental ?? n2.accidental ?? null) as AccidentalType | null;
                const norm = (a: any) => a ?? 'natural';
                if (norm(acc1) !== norm(acc2)) {
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
            if (ok) return;

            // Guard-rail: if the *arrival harmony* (at the structural next event) does not
            // contain the tonic at all, do not flag "missing" LT resolution. This avoids
            // false positives in contexts like deceptive/redirected progressions where the
            // tonic is not harmonically available in the following sonority.
            try {
                const evB = (typeof idx2 === 'number' && chordEvents[idx2]) ? chordEvents[idx2] : b;
                const bStructural = getStructuralNotes(evB as any) || [];
                const pcsB = new Set(bStructural.filter(n => n && !n.isRest).map(n => mod12(n.noteIndex)));
                if (!pcsB.has(ctxTonicPc)) {
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
                return; // Salva il paziente ed esci
            }

            // 3. Se non è risolto e non è un'eccezione -> ERRORE/WARNING
            addViolation({
                ruleId: 'R-07',
                severity: (v === 1 || v === 4) ? 'error' : 'warning',
                description: 'Risoluzione errata della sensibile',
                suggestion: 'La sensibile tende a salire alla tonica (specie nelle voci esterne).',
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

                const intA = mod12(Math.abs(a1.midi - a2.midi));
                const intB = mod12(Math.abs(b1.midi - b2.midi));
                const d1 = dir(a1.midi, b1.midi);
                const d2 = dir(a2.midi, b2.midi);
                const similar = d1 !== 0 && d1 === d2;
                if (!similar) continue;

                // Perfect octaves/unisons
                if (isPerfectOctaveOrUnison(intA) && isPerfectOctaveOrUnison(intB)) {
                    addViolation({
                        ruleId: 'R-01',
                        severity: 'error',
                        description: 'Ottave parallele',
                        suggestion: 'Introduci moto contrario o cambia disposizione delle voci.',
                        noteIds: [a1.id, a2.id, b1.id, b2.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: 'error', ruleId: 'R-01' });
                    connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: 'error', ruleId: 'R-01' });
                    continue;
                }

                // Perfect fifths
                if (isPerfectFifth(intA) && isPerfectFifth(intB)) {
                    // Exceptions that downgrade
                    let exception: RuleViolation | null = null;

                    // EXC-M04: vi -> V in minor
                    const aRoman = (() => {
                        const c = getContextAtAbsBeat(a.absBeat);
                        return getRomanAnalysis(a.notes, c.tonic, c.isMinor)?.roman ?? '';
                    })();
                    const bRoman = (() => {
                        const c = getContextAtAbsBeat(b.absBeat);
                        return getRomanAnalysis(b.notes, c.tonic, c.isMinor)?.roman ?? '';
                    })();
                    const normRoman = (r: string) => r.replace(/\s+/g, '').toLowerCase();
                    const aR = normRoman(aRoman);
                    const bR = normRoman(bRoman);
                    const isMinorCtx = getContextAtAbsBeat(a.absBeat).isMinor;

                    const matchesViToVByRoman = isMinorCtx && aR.startsWith('vi') && bR.startsWith('v');

                    // Fallback when roman analysis is empty/ambiguous: detect by chord roots vs tonic.
                    // In minor, VI has root at tonic+8 semitones; V has root at tonic+7 semitones.
                    const matchesViToVByRoot = (() => {
                        if (!isMinorCtx) return false;
                        const ctx = getContextAtAbsBeat(a.absBeat);
                        const tonicIdx = noteNameToIndex[ctx.tonic];
                        if (!Number.isFinite(tonicIdx)) return false;
                        const infoA = identifyChord(a.notes);
                        const infoB = identifyChord(b.notes);
                        if (!infoA?.root || !infoB?.root) return false;
                        const aPc = mod12(infoA.root.midi);
                        const bPc = mod12(infoB.root.midi);
                        const tonicPc = mod12(tonicIdx);
                        const intA = mod12(aPc - tonicPc);
                        const intB = mod12(bPc - tonicPc);
                        return intA === 8 && intB === 7;
                    })();

                    if (matchesViToVByRoman || matchesViToVByRoot) {
                        exception = {
                            ruleId: 'EXC-M04',
                            severity: 'exception',
                            description: 'Quinte parallele tollerate in minore (vi → V)',
                            suggestion: 'Eccezione riconosciuta; verifica comunque la resa sonora.',
                            noteIds: [a1.id, a2.id, b1.id, b2.id],
                        };
                    }

                    // EXC-M03: "finta" quinta parallela con settima (dominant 7 chord)
                    if (!exception) {
                        const chordInfoB = identifyChord(b.notes);
                        const isDom7 = !!chordInfoB && chordInfoB.type.toLowerCase().includes('dominant');
                        if (isDom7 && chordInfoB?.root) {
                            const rootMidi = chordInfoB.root.midi;
                            const isSeventh = (n: StaffNote) => {
                                const rel = mod12(n.midi - rootMidi);
                                return rel === 10 || rel === 11;
                            };
                            if (isSeventh(b1) || isSeventh(b2)) {
                                exception = {
                                    ruleId: 'EXC-M03',
                                    severity: 'exception',
                                    description: '"Finta" quinta parallela con una settima',
                                    suggestion: 'Eccezione: la seconda intervallazione è una settima dissonante (es. V7).',
                                    noteIds: [a1.id, a2.id, b1.id, b2.id],
                                };
                            }
                        }
                    }

                    if (exception) {
                        addViolation(exception);
                    } else {
                        addViolation({
                            ruleId: 'R-02',
                            severity: 'error',
                            description: 'Quinte parallele',
                            suggestion: 'Evita il moto parallelo verso quinte perfette; usa moto contrario/obliquo.',
                            noteIds: [a1.id, a2.id, b1.id, b2.id],
                        });
                    }

                    const sev = exception ? exception.severity : 'error';
                    const rid = exception ? exception.ruleId : 'R-02';
                    connections.push({ type: 'horizontal', noteId1: a1.id, noteId2: b1.id, severity: sev, ruleId: rid });
                    connections.push({ type: 'horizontal', noteId1: a2.id, noteId2: b2.id, severity: sev, ruleId: rid });
                }
            }
        }

        // R-05: hidden/direct fifths & octaves (outer voices)
        if (sopA && sopB && basA && basB) {
            const intA = mod12(Math.abs(sopA.midi - basA.midi));
            const intB = mod12(Math.abs(sopB.midi - basB.midi));
            const dS = dir(sopA.midi, sopB.midi);
            const dB = dir(basA.midi, basB.midi);
            const similar = dS !== 0 && dS === dB;

            const sopMotion = Math.abs(sopB.midi - sopA.midi);
            const bassMotion = Math.abs(basB.midi - basA.midi);

            const sopranoLeap = sopMotion > 2;
            const sopranoSmallLeap = sopMotion <= 4; // 3rd (M/m) is often treated as milder than larger leaps
            const bassStepwise = bassMotion > 0 && bassMotion <= 2;

            const arrivalPerfect = isPerfectFifth(intB) || isPerfectOctaveOrUnison(intB);
            const departurePerfect = isPerfectFifth(intA) || isPerfectOctaveOrUnison(intA);

            // Hidden/direct perfect intervals: similar motion into a perfect 5th/8ve,
            // but the departure interval is NOT already perfect (otherwise it's a true parallel handled by R-01/R-02).
            if (similar && arrivalPerfect && !departurePerfect) {
                const isOct = isPerfectOctaveOrUnison(intB);
                if (!sopranoLeap) {
                    addViolation({
                        ruleId: 'EXC-Hidden-Stepwise',
                        severity: 'exception',
                        description: 'Moto retto/nascosto ammesso (Soprano per grado congiunto)',
                        suggestion: 'Eccezione classica: il Soprano si muove per grado congiunto.',
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
                    connections.push({ type: 'horizontal', noteId1: basA.id, noteId2: basB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
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
                    addViolation({
                        ruleId: 'R-05',
                        severity: 'warning',
                        description: isOct
                            ? 'Ottave nascoste (dirette) tra voci estreme'
                            : 'Quinte nascoste (dirette) tra voci estreme',
                        suggestion: 'Preferisci moto contrario, oppure evita il salto nella voce superiore.',
                        noteIds: [sopA.id, sopB.id, basA.id, basB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'warning', ruleId: 'R-05' });
                    connections.push({ type: 'horizontal', noteId1: basA.id, noteId2: basB.id, severity: 'warning', ruleId: 'R-05' });
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

        // R-05 (extended): hidden/direct fifths & octaves involving the soprano and Alto.
        // In many classical treatments, hidden/direct perfect intervals are emphasized in the outer voices,
        // but in practice the same issue can be relevant for Soprano–Alto when the soprano leaps.
        const altoA = aV[2];
        const altoB = bV[2];
        if (sopA && sopB && altoA && altoB) {
            const intA = mod12(Math.abs(sopA.midi - altoA.midi));
            const intB = mod12(Math.abs(sopB.midi - altoB.midi));
            const dS = dir(sopA.midi, sopB.midi);
            const dA = dir(altoA.midi, altoB.midi);
            const similar = dS !== 0 && dS === dA;

            const sopMotion = Math.abs(sopB.midi - sopA.midi);
            const sopranoLeap = sopMotion > 2;

            const arrivalPerfect = isPerfectFifth(intB) || isPerfectOctaveOrUnison(intB);
            const departurePerfect = isPerfectFifth(intA) || isPerfectOctaveOrUnison(intA);

            if (similar && arrivalPerfect && !departurePerfect) {
                const isOct = isPerfectOctaveOrUnison(intB);
                if (!sopranoLeap) {
                    addViolation({
                        ruleId: 'EXC-Hidden-Stepwise',
                        severity: 'exception',
                        description: 'Moto retto/nascosto ammesso (Soprano per grado congiunto)',
                        suggestion: 'Eccezione classica: il Soprano si muove per grado congiunto.',
                        noteIds: [sopA.id, sopB.id, altoA.id, altoB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
                    connections.push({ type: 'horizontal', noteId1: altoA.id, noteId2: altoB.id, severity: 'exception', ruleId: 'EXC-Hidden-Stepwise' });
                } else {
                    addViolation({
                        ruleId: 'R-05',
                        severity: 'warning',
                        description: isOct
                            ? 'Ottave nascoste (dirette) tra Soprano e Alto'
                            : 'Quinte nascoste (dirette) tra Soprano e Alto',
                        suggestion: 'Preferisci moto contrario, oppure evita il salto nel Soprano.',
                        noteIds: [sopA.id, sopB.id, altoA.id, altoB.id],
                    });
                    connections.push({ type: 'horizontal', noteId1: sopA.id, noteId2: sopB.id, severity: 'warning', ruleId: 'R-05' });
                    connections.push({ type: 'horizontal', noteId1: altoA.id, noteId2: altoB.id, severity: 'warning', ruleId: 'R-05' });
                }
            }
        }

        // R-12: chord seventh resolution (with EXC-7m01, updated for minor/major 7th logic)
        // NOTE: In augmented-sixth chords (It+/Fr+/Ger+), the characteristic A6 interval
        // can be enharmonically equivalent to a m7 (10 semitones). Since this analysis
        // operates on pitch classes, R-12 would produce false positives (the A6 upper
        // note resolves upward by semitone). We therefore skip R-12 on these sonorities.
        const ctxAFor7 = getContextAtAbsBeat(a.absBeat);
        const romanAFor7 = getRomanAnalysis(getStructuralNotes(a) || [], ctxAFor7.tonic, ctxAFor7.isMinor)?.roman ?? '';
        const isAug6Chord = romanAFor7 === 'It+' || romanAFor7 === 'Fr+' || romanAFor7 === 'Ger+';

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
                                    carrier.kind === 'bass'
                                        ? 'Ammesso: il basso realizza la nota di risoluzione.'
                                        : carrier.kind === 'soprano'
                                            ? 'Ammesso: il soprano realizza la nota di risoluzione.'
                                            : carrier.kind === 'lower'
                                                ? 'Ammesso: la voce immediatamente inferiore realizza la nota di risoluzione.'
                                                : 'Ammesso: un’altra voce realizza la nota di risoluzione.',
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
                            suggestion: 'Ammesso in casi rari (esigenze di completezza dell’accordo di arrivo o logica cromatica).',
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
                                        suggestion: 'Ammesso in contesti specifici quando la nuova nota è la 7a dell’accordo successivo.',
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
                            suggestion: 'Ammesso quando la nota diventa membro consonante dell’accordo successivo (es. V7→IV).',
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
                                    suggestion: 'Ammesso in casi di risoluzioni eccezionali/implicite o contesto tardo-ottocentesco.',
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
                            suggestion: 'La 7a tende a risolvere scendendo di grado (per moto congiunto).',
                            noteIds: [n7.id, nNext.id],
                        });
                    }
                });
            }
        }
    }

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

    // =========================================================
    // Melodic checks (per voice)
    // =========================================================
    (Object.keys(notesByVoice) as unknown as Voice[]).forEach(v => {
        const line = notesByVoice[v];
        for (let i = 0; i < line.length - 1; i++) {
            const n1 = line[i];
            const n2 = line[i + 1];
            const midiDiff = (n2.midi ?? 0) - (n1.midi ?? 0);
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

            // R-06: incorrect resolution of augmented/diminished melodic leaps
            // Use diatonic position difference + semitones to infer quality.
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
            const diatonicSize = Math.min(Math.abs((n2.position ?? 0) - (n1.position ?? 0)), 7);
            const quality = getIntervalQuality(diatonicSize, absSemi);
            if (quality === 'Augmented' || quality === 'Diminished') {
                const n3 = line[i + 2];
                if (n3) {
                    if (isOrnamental(n3)) {
                        continue;
                    }
                    const nextDiff = (n3.midi ?? 0) - (n2.midi ?? 0);
                    const nextAbs = Math.abs(nextDiff);
                    const resolvesByStep = nextAbs > 0 && nextAbs <= 2;
                    if (quality === 'Augmented') {
                        const shouldGoUp = nextDiff > 0;
                        if (!(resolvesByStep && shouldGoUp)) {
                            addViolation({
                                ruleId: 'R-06',
                                severity: 'error',
                                description: 'Risoluzione errata di salto melodico aumentato',
                                suggestion: 'Dopo un intervallo aumentato, risolvi salendo di grado (moto congiunto).',
                                noteIds: [n1.id, n2.id, n3.id],
                            });
                        }
                    } else {
                        const shouldGoDown = nextDiff < 0;
                        if (!(resolvesByStep && shouldGoDown)) {
                            addViolation({
                                ruleId: 'R-06',
                                severity: 'error',
                                description: 'Risoluzione errata di salto melodico diminuito',
                                suggestion: 'Dopo un intervallo diminuito, risolvi scendendo di grado (moto congiunto).',
                                noteIds: [n1.id, n2.id, n3.id],
                            });
                        }
                    }
                }
            }
        }
    });

    // Sort violations by severity (error -> warning -> exception) then by rule id for readability.
    const sevRank: Record<RuleViolation['severity'], number> = { error: 0, warning: 1, exception: 2 };
    violations.sort((a, b) => {
        const sd = sevRank[a.severity] - sevRank[b.severity];
        if (sd !== 0) return sd;
        return a.ruleId.localeCompare(b.ruleId);
    });

    return { analyzedNotes, violations, connections };
}