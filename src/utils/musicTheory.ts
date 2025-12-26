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
import { NOTE_NAMES, ALL_NOTE_SPELLINGS, FRET_COUNT, GUITAR_TUNING, SCALE_INTERVALS as BUILT_IN_SCALE_INTERVALS, CHORD_FORMULAS, DURATION_VALUES } from '../constants';

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
    return NOTE_PITCH_TO_POSITION[pitch] + (octave - 4) * 7;
};

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
        noteIndex = (noteIndex - 1 + 12) % 12;
        finalMidi = cBaseMidi + noteIndex;
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

const CHROMATIC_CHORD_DEFINITIONS: { [key: string]: { symbol: string, matcher: (chord: StaffNote[], keyInfo: { tonicIndex: number, isMinor: boolean }) => boolean } } = {
    ITALIAN_AUGMENTED_SIXTH: {
        symbol: 'It+',
        matcher: (chord, keyInfo) => {
            const uniquePitches = new Set(chord.map(n => n.noteIndex));
            if (uniquePitches.size !== 3) return false;

            const b6_pitch = (keyInfo.tonicIndex + 8) % 12; // Le (b6)
            const bassNote = chord.find(n => n.noteIndex === b6_pitch);
            if (!bassNote) return false;
            const intervals = new Set(chord.map(n => (n.noteIndex - bassNote.noteIndex + 12) % 12));
            return intervals.has(0) && intervals.has(4) && intervals.has(10); // R, M3, Aug6
        }
    },
    FRENCH_AUGMENTED_SIXTH: {
        symbol: 'Fr+',
        matcher: (chord, keyInfo) => {
            const uniquePitches = new Set(chord.map(n => n.noteIndex));
            if (uniquePitches.size !== 4) return false;

            const b6_pitch = (keyInfo.tonicIndex + 8) % 12; // Le (b6)
            const bassNote = chord.find(n => n.noteIndex === b6_pitch);
            if (!bassNote) return false;
            const intervals = new Set(chord.map(n => (n.noteIndex - bassNote.noteIndex + 12) % 12));
            return intervals.has(0) && intervals.has(4) && intervals.has(6) && intervals.has(10); // R, M3, Aug4, Aug6
        }
    },
    GERMAN_AUGMENTED_SIXTH: {
        symbol: 'Ger+',
        matcher: (chord, keyInfo) => {
            const uniquePitches = new Set(chord.map(n => n.noteIndex));
            if (uniquePitches.size !== 4) return false;

            const b6_pitch = (keyInfo.tonicIndex + 8) % 12; // Le (b6)
            const bassNote = chord.find(n => n.noteIndex === b6_pitch);
            if (!bassNote) return false;
            const intervals = new Set(chord.map(n => (n.noteIndex - bassNote.noteIndex + 12) % 12));
            return intervals.has(0) && intervals.has(4) && intervals.has(7) && intervals.has(10); // R, M3, P5, Aug6
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

type MatchType = 'exact' | 'no_fifth' | null;

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

function identifyChord(notes: StaffNote[]): { root: StaffNote; type: string; intervals: Set<number> } | null {
    if (!notes || notes.length < 2) return null;
    const validNotes = notes.filter(n => !n.isRest);
    if (validNotes.length < 2) return null;
    
    const uniqueNotes = [...new Map(validNotes.map(n => [n.noteIndex, n])).values()];
    const uniquePitches = uniqueNotes.map(n => n.noteIndex);
    const bassNote = [...validNotes].sort((a, b) => a.midi - b.midi)[0];

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

    for (const candidate of allCandidates) {
        let score = 0;
        
        if (candidate.matchType === 'exact') {
            score += 20; 
        } else if (candidate.matchType === 'no_fifth') {
            score += 10;
        }

        score += (CHORD_CHECK_ORDER.length - candidate.priority);
        
        if (candidate.root.noteIndex === bassNote.noteIndex) score += 0.5;
        candidate.score = score;
    }

    allCandidates.sort((a, b) => b.score - a.score);
    const { score, priority, matchType, ...bestMatch } = allCandidates[0];
    return bestMatch;
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
    keySignature: KeySignature
): string | null {
    if (!chord || chord.length < 2) return null;

    const chordInfo = identifyChord(chord);
    if (!chordInfo) return null;

    const { root: chordRoot, type: quality } = chordInfo;
    if (!chordRoot || !quality) return null;

    const keyUsesFlats = keySignature.type === 'flat' && keySignature.count > 0;
    const getNoteName = (noteIndex: number): string => {
        const possibleNames = ALL_NOTE_SPELLINGS[noteIndex];
        if (possibleNames.length > 1) {
            return keyUsesFlats
                ? (possibleNames.find(n => n.includes('b')) || possibleNames[1])
                : (possibleNames.find(n => !n.includes('b')) || possibleNames[0]);
        }
        return possibleNames[0];
    };

    const rootName = getNoteName(chordRoot.noteIndex);
    const symbol = CHORD_TYPE_TO_SYMBOL[quality] ?? '';

    let analysisText = `${rootName}${symbol}`;

    const bassNote = [...chord].sort((a, b) => a.midi - b.midi)[0];
    if (bassNote.noteIndex !== chordRoot.noteIndex) {
        const bassName = getNoteName(bassNote.noteIndex);
        analysisText += `/${bassName}`;
    }

    return analysisText;
}

function isNoteDissonantInChord(
    note: StaffNote,
    chordInfo: { root: StaffNote; type: string; intervals: Set<number> }
): boolean {
    if (!chordInfo.type.includes('7') || !chordInfo.intervals) return false;

    const rootIndex = chordInfo.root.noteIndex;
    const seventhInterval = Math.max(...Array.from(chordInfo.intervals));

    if (seventhInterval === 9 || seventhInterval === 10 || seventhInterval === 11) {
        const seventhNoteIndex = (rootIndex + seventhInterval) % 12;
        return note.noteIndex === seventhNoteIndex;
    }
    return false;
}

function getFiguredBass(
    notes: StaffNote[],
    chordInfo: { root: StaffNote; type: string }
): string[] {
    if (!chordInfo || !chordInfo.root) return [];

    const bassNote = [...notes].sort((a, b) => a.midi - b.midi)[0];
    const intervalFromRoot = (bassNote.noteIndex - chordInfo.root.noteIndex + 12) % 12;

    const isSeventhChord =
        chordInfo.type.includes('7') ||
        chordInfo.type.includes('9') ||
        chordInfo.type.includes('11') ||
        chordInfo.type.includes('13');

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

function calculateRomanNumeral(
    chordInfo: { root: StaffNote; type: string },
    keyInfo: { tonicIndex: number; isMinor: boolean }
): string {
    const { root: chordRoot, type: quality } = chordInfo;
    const chordRootIndex = chordRoot.noteIndex;
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
    const romanNumeralsMinorHarmonic = ['i', 'ii°', 'III+', 'iv', 'V', 'VI', 'vii°'];
    const scaleIntervalsMajor = [0, 2, 4, 5, 7, 9, 11];
    const scaleIntervalsMinorHarmonic = [0, 2, 3, 5, 7, 8, 11];
    const scaleIntervals = isMinorMode ? scaleIntervalsMinorHarmonic : scaleIntervalsMajor;
    const romanNumerals = isMinorMode ? romanNumeralsMinorHarmonic : romanNumeralsMajor;

    if (quality === BuiltInChords.Major || quality.startsWith('Dominant')) {
        const diatonicScaleIntervals = isMinorMode ? [0, 2, 3, 5, 7, 8, 10] : scaleIntervalsMajor;
        for (let i = 1; i < diatonicScaleIntervals.length; i++) {
            const diatonicDegreeRootIndex = (keyTonicIndex + diatonicScaleIntervals[i]) % 12;
            const isDominantOfDegree = (chordRootIndex - diatonicDegreeRootIndex + 12) % 12 === 7;
            if (isDominantOfDegree) {
                if (chordRootIndex === keyTonicIndex && !quality.startsWith('Dominant')) continue;
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
    if (quality === BuiltInChords.Major && roman.toLowerCase() === roman) roman = roman.toUpperCase();
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

    const keyTonicIndex = noteNameToIndex[keySignatureRoot];
    if (keyTonicIndex === undefined) return null;
    const keyInfo = { tonicIndex: keyTonicIndex, isMinor: isMinorMode };

    for (const definition of Object.values(CHROMATIC_CHORD_DEFINITIONS)) {
        if (definition.matcher(chord, keyInfo)) return { roman: definition.symbol, figures: [] };
    }

    const chordInfo = identifyChord(chord);
    if (!chordInfo || !chordInfo.root || !chordInfo.type) return null;

    const baseRomanSymbol = calculateRomanNumeral(chordInfo, keyInfo);

    let figures: string[] = [];
    if (chordInfo.type === BuiltInChords.Sus4) figures = ['5', '4'];
    else if (chordInfo.type === BuiltInChords.Sus2) figures = ['5', '2'];
    else if (chordInfo.type === BuiltInChords.Add9) {
        const triadFigures = getFiguredBass(chord, { ...chordInfo, type: BuiltInChords.Major });
        figures = [...triadFigures, '9'];
    } else {
        figures = getFiguredBass(chord, chordInfo);
    }

    if (chordInfo.type === BuiltInChords.Dominant7b9) {
        const idx = findFigureIndexByValue(figures, 9);
        if (idx > -1) figures[idx] = '♭9';
        else figures.push('♭9');
    }
    if (chordInfo.type === BuiltInChords.Dominant7sharp9) {
        const idx = findFigureIndexByValue(figures, 9);
        if (idx > -1) figures[idx] = '♯9';
        else figures.push('♯9');
    }
    if (chordInfo.type === BuiltInChords.Dominant7sharp11) {
        const idx = findFigureIndexByValue(figures, 11);
        if (idx > -1) figures[idx] = '♯11';
        else figures.push('♯11');
    }
    if (chordInfo.type === BuiltInChords.Dominant7b13) {
        const idx = findFigureIndexByValue(figures, 13);
        if (idx > -1) figures[idx] = '♭13';
        else figures.push('♭13');
    }

    figures = normalizeFiguresVertical(figures);
    return { roman: baseRomanSymbol, figures };
}

export function calculateNoteBeats(notes: StaffNote[], timeSignature: TimeSignature): StaffNote[] {
    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

    const voices = new Map<Voice, StaffNote[]>();
    notes.forEach(note => {
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
    const analyzedNotes = [...notes];
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

    // =========================================================
    // Vertical checks (within a chord)
    // =========================================================
    chordEvents.forEach(ev => {
        const v1 = ev.byVoice.get(1);
        const v2 = ev.byVoice.get(2);
        const v3 = ev.byVoice.get(3);
        const v4 = ev.byVoice.get(4);
        const present = [v1, v2, v3, v4].filter(Boolean) as StaffNote[];

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
        }

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
    });

    // =========================================================
    // Horizontal checks (between consecutive chords)
    // =========================================================
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
        const chordInfoA_R07 = identifyChord(a.notes);
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
            const n2 = bV[v];
            if (!n1 || !n2) return;
            if ((n1.midi % 12) !== ctxLeadingPc) return;

            // Applica la regola SOLO se l'accordo è V o vii°
            if (!isVorViidim) return;

            // 1. PRIMA controlliamo se risolve regolarmente (salendo alla tonica)
            // Se lo fa, è perfetto: usciamo subito senza segnare nulla.
            const ok = stepUpToTonic(n1.midi, n2.midi, ctxTonicPc);
            if (ok) return;

            // 2. SE NON RISOLVE, controlliamo se è un'eccezione ammessa (Dubois §19)
            // Voce interna (Alto/Tenore) e Soprano canta la tonica
            const isInternalVoice = v === 2 || v === 3;
            const sopranoNext = bV[1];
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
            const intB = mod12(Math.abs(sopB.midi - basB.midi));
            const dS = dir(sopA.midi, sopB.midi);
            const dB = dir(basA.midi, basB.midi);
            const similar = dS !== 0 && dS === dB;
            const sopranoLeap = Math.abs(sopB.midi - sopA.midi) > 2;
            if (similar && (isPerfectFifth(intB) || isPerfectOctaveOrUnison(intB))) {
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
        }

        // R-12: chord seventh resolution (with EXC-7m01, updated for minor/major 7th logic)
        const chordInfoA = identifyChord(a.notes);
        if (chordInfoA?.root) {
            const rootMidi = chordInfoA.root.midi;
            const seventhNotes = a.notes
                .filter(n => !n.isRest)
                .map(n => {
                    const rel = mod12(n.midi - rootMidi);
                    return { n, rel };
                })
                .filter(({ rel }) => rel === 10 || rel === 11);

            if (seventhNotes.length) {
                seventhNotes.forEach(({ n: n7, rel }) => {
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
                    const nNext = bV[v];
                    const sameVoiceResolves = !!nNext && stepDown(n7.midi, nNext.midi);
                    if (sameVoiceResolves) return;

                    // EXC-7m01 transferred resolution: resolution note appears in another voice.
                    // (Or the original voice is silent/absent, but another voice contains the resolution.)
                    const resolutionMidiCandidates = [n7.midi - 1, n7.midi - 2];
                    const transferredResolution = (() => {
                        // Prefer -1 semitone, then -2.
                        // Accept the resolution even if it appears in another octave (pitch-class match).
                        const candidates = (b.notes || []).filter(n => !n.isRest) as StaffNote[];

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

                    // No transferred resolution note exists; if the voice continues, flag the error.
                    if (!nNext) return;

                    addViolation({
                        ruleId: 'R-12',
                        severity: 'error',
                        description: 'Risoluzione errata della settima dell’accordo',
                        suggestion: 'La 7a tende a risolvere scendendo di grado (per moto congiunto).',
                        noteIds: [n7.id, nNext.id],
                    });
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
    for (let m = 0; m < lastMeasureIndex; m++) {
        // 4/4 assumed by this editor's harmony engine currently.
        const prevWeak = chordAt(m, 4);
        const nextDownbeat = chordAt(m + 1, 1);
        if (!prevWeak || !nextDownbeat) continue;

        const idWeak = chordIdentity(prevWeak);
        const idNext = chordIdentity(nextDownbeat);
        if (!idWeak || !idNext || idWeak !== idNext) continue;

        // If the same chord already appeared on a strong beat in the previous bar (1 or 3), do not flag.
        const prevStrong1 = chordAt(m, 1);
        const prevStrong3 = chordAt(m, 3);
        const sameOnStrong = [prevStrong1, prevStrong3]
            .filter(Boolean)
            .some(ch => chordIdentity(ch as StaffNote[]) === idWeak);
        if (sameOnStrong) continue;

        const sopWeak = pickOuterVoice(prevWeak, 1);
        const basWeak = pickOuterVoice(prevWeak, 4);
        const sopNext = pickOuterVoice(nextDownbeat, 1);
        const basNext = pickOuterVoice(nextDownbeat, 4);

        const noteIds = [sopWeak?.id, sopNext?.id, basWeak?.id, basNext?.id].filter(Boolean) as string[];
        if (noteIds.length < 2) continue;

        addViolation({
            ruleId: 'R-16',
            severity: 'warning',
            description: 'Sincope armonica (accordo sul debole che “entra” sul battere successivo)',
            suggestion: 'Secondo la “regola della stanghetta” (Piston), in stile corale/classico è preferibile che il cambio armonico cada sul 1°. Nota: in musica moderna/jazz può essere una scelta ritmica intenzionale e tollerata.',
            noteIds,
        });

        // Explicit connections so the editor shows orange dashed lines across the barline.
        if (sopWeak && sopNext) connections.push({ type: 'horizontal', noteId1: sopWeak.id, noteId2: sopNext.id, severity: 'warning', ruleId: 'R-16' });
        if (basWeak && basNext) connections.push({ type: 'horizontal', noteId1: basWeak.id, noteId2: basNext.id, severity: 'warning', ruleId: 'R-16' });
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
            const diatonicSize = Math.min(Math.abs((n2.position ?? 0) - (n1.position ?? 0)), 7);
            const quality = getIntervalQuality(diatonicSize, absSemi);
            if (quality === 'Augmented' || quality === 'Diminished') {
                const n3 = line[i + 2];
                if (n3) {
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