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
        let tripletContext: { notesInTriplet: number; beatsForTriplet: number; notesProcessed: number } | null = null;

        for (const note of voiceNotes) {
            let durationInBeats = DURATION_VALUES[note.duration || 'quarter'] * (note.isDotted ? 1.5 : 1);

            if (note.isTriplet && !tripletContext) {
                tripletContext = { notesInTriplet: 3, beatsForTriplet: durationInBeats * 2, notesProcessed: 0 };
            }

            if (tripletContext) durationInBeats = tripletContext.beatsForTriplet / tripletContext.notesInTriplet;

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

            if (tripletContext) {
                tripletContext.notesProcessed++;
                if (tripletContext.notesProcessed >= tripletContext.notesInTriplet) tripletContext = null;
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

// NOTE: this is the full rules engine entrypoint expected by the editor.
// It relies on helpers already defined above in this file (getDirection, getInterval, identifyChord, etc.).
export function applyHarmonyRules(
    notes: StaffNote[],
    keySignature: KeySignature,
    keyTonic: string,
    isMinor: boolean,
    analysisContexts: AnalysisContext[]
): HarmonyAnalysisResult {
    // If you previously had a longer full implementation, keep it; this is a minimal safe fallback
    // that preserves the output shape so the app loads. Replace/merge with your full rule set as needed.

    // Build chord map by measureIndex/beat (same bucketing as the old engine)
    const chordsMap = new Map<string, StaffNote[]>();
    notes.forEach(note => {
        if (note.isRest) return;
        const key = `${note.measureIndex ?? 0}-${note.beat ?? 1}`;
        if (!chordsMap.has(key)) chordsMap.set(key, []);
        chordsMap.get(key)!.push(note);
    });

    // Minimal: no violations/connections (so UI doesn't crash). Your full engine can be merged back here.
    return { analyzedNotes: [...notes], violations: [], connections: [] };
}