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


export function getNotePropertiesFromMidi(
  midi: number,
  keySignature: KeySignature,
  clef: ClefType,
  preferredAccidental: AccidentalType | null
): Omit<StaffNote, 'id'|'duration'|'isRest'|'isTriplet'|'groupId'|'chordId'|'measureIndex'|'beat'|'xPosition'|'voice'> {
  const soundingMidi = midi - 12;
  const noteIndex = soundingMidi % 12;
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
        const noteIndex = soundingMidi % 12;
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
        const noteIndex = midi % 12;

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
        const noteIndex = soundingMidi % 12;
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
        const noteIndex = soundingMidi % 12;
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
        const rootPitch = potentialRootNote.midi % 12;
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
    
    const uniqueNotes = [...new Map(validNotes.map(n => [n.midi % 12, n])).values()];
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
  [BuiltInChords.Minor11]: 'm11',
  [BuiltInChords.Dominant11]: '11',
  [BuiltInChords.Dominant7sharp11]: '7♯11',
  [BuiltInChords.Major13]: 'maj13',
  [BuiltInChords.Minor13]: 'm13',
  [BuiltInChords.Dominant13]: '13',
  [BuiltInChords.Dominant7b13]: '7♭13',
  [BuiltInChords.Dominant9_13]: '13(add9)',
};

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
    }
    
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


function isNoteDissonantInChord(note: StaffNote, chordInfo: { root: StaffNote; type: string; intervals: Set<number> }): boolean {
    if (!chordInfo.type.includes('7') || !chordInfo.intervals) {
        return false;
    }
    const rootIndex = chordInfo.root.noteIndex;
    const seventhInterval = Math.max(...Array.from(chordInfo.intervals));

    if (seventhInterval === 9 || seventhInterval === 10 || seventhInterval === 11) {
        const seventhNoteIndex = (rootIndex + seventhInterval) % 12;
        return note.noteIndex === seventhNoteIndex;
    }
    return false;
}

function getFiguredBass(notes: StaffNote[], chordInfo: { root: StaffNote; type: string; }): string[] {
  if (!chordInfo || !chordInfo.root) return [];

  const bassNote = [...notes].sort((a, b) => a.midi - b.midi)[0];
  const intervalFromRoot = (bassNote.noteIndex - chordInfo.root.noteIndex + 12) % 12;

  const isSeventhChord = chordInfo.type.includes('7') || chordInfo.type.includes('9') || chordInfo.type.includes('11') || chordInfo.type.includes('13');

  if (isSeventhChord) {
    if (intervalFromRoot === 0) { 
        if (chordInfo.type.includes('13')) return ['¹³'];
        if (chordInfo.type.includes('11')) return ['¹¹'];
        if (chordInfo.type.includes('9')) return ['⁹'];
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
    if (intervalFromRoot === 3 || intervalFromRoot === 4) {
        return ['6'];
    }
    if (intervalFromRoot >= 6 && intervalFromRoot <= 8) {
        return ['6', '4'];
    }
  }

  return [];
}

function calculateRomanNumeral(chordInfo: { root: StaffNote, type: string }, keyInfo: { tonicIndex: number, isMinor: boolean }): string {
    const { root: chordRoot, type: quality } = chordInfo;
    const chordRootIndex = chordRoot.noteIndex;
    const { tonicIndex: keyTonicIndex, isMinor: isMinorMode } = keyInfo;

    const isNeapolitanRoot = chordRootIndex === (keyTonicIndex + 1) % 12;
    if (isNeapolitanRoot && quality === BuiltInChords.Major) {
        return 'N';
    }

    // --- Inizio Riconoscimento Accordi di Interscambio Modale con 7a ---

    // Riconoscimento bIImaj7 (Variante Napoletana)
    const isFlatTwoRoot = chordRootIndex === (keyTonicIndex + 1) % 12;
    if (isFlatTwoRoot && quality === BuiltInChords.Major7) {
        return '♭IImaj7';
    }

    // Riconoscimento iv7 (in Tonalità Maggiore)
    const isFourthDegreeRoot = chordRootIndex === (keyTonicIndex + 5) % 12;
    if (!isMinorMode && isFourthDegreeRoot && quality === BuiltInChords.Minor7) {
        return 'iv7';
    }

    // Riconoscimento bVImaj7 (in Tonalità Maggiore)
    const isFlatSixthRoot = chordRootIndex === (keyTonicIndex + 8) % 12;
    if (!isMinorMode && isFlatSixthRoot && quality === BuiltInChords.Major7) {
        return '♭VImaj7';
    }

    // --- Fine Riconoscimento ---

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
                if (chordRootIndex === keyTonicIndex && !quality.startsWith('Dominant')) {
                    continue;
                }
                const targetRoman = isMinorMode ? ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'][i] : romanNumeralsMajor[i];
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
): { roman: string, figures: string[] } | null {
    if (!chord || chord.length < 2) return null;
    const keyTonicIndex = noteNameToIndex[keySignatureRoot];
    if (keyTonicIndex === undefined) return null;
    const keyInfo = { tonicIndex: keyTonicIndex, isMinor: isMinorMode };
    
    for (const definition of Object.values(CHROMATIC_CHORD_DEFINITIONS)) {
        if (definition.matcher(chord, keyInfo)) {
            return { roman: definition.symbol, figures: [] };
        }
    }

    const chordInfo = identifyChord(chord);
    if (!chordInfo || !chordInfo.root || !chordInfo.type) return null;
    
    const baseRomanSymbol = calculateRomanNumeral(chordInfo, keyInfo);
    
    let figures: string[] = [];

    if (chordInfo.type === BuiltInChords.Sus4) {
        figures = ['5', '4'];
    } else if (chordInfo.type === BuiltInChords.Sus2) {
        figures = ['5', '2'];
    } else if (chordInfo.type === BuiltInChords.Add9) {
        const triadFigures = getFiguredBass(chord, { ...chordInfo, type: BuiltInChords.Major });
        figures = [...triadFigures, '9'];
    } else {
        figures = getFiguredBass(chord, chordInfo);
    }
    
    if (chordInfo.type === BuiltInChords.Dominant7b9) {
        const nineIndex = figures.indexOf('⁹'); if (nineIndex > -1) figures[nineIndex] = '♭⁹'; else figures.push('♭⁹');
    }
    if (chordInfo.type === BuiltInChords.Dominant7sharp9) {
        const nineIndex = figures.indexOf('⁹'); if (nineIndex > -1) figures[nineIndex] = '♯⁹'; else figures.push('♯⁹');
    }
    if (chordInfo.type === BuiltInChords.Dominant7sharp11) {
        const elevenIndex = figures.indexOf('¹¹'); if (elevenIndex > -1) figures[elevenIndex] = '♯¹¹'; else figures.push('♯¹¹');
    }
    if (chordInfo.type === BuiltInChords.Dominant7b13) {
        const thirteenIndex = figures.indexOf('¹³'); if (thirteenIndex > -1) figures[thirteenIndex] = '♭¹³'; else figures.push('♭¹³');
    }

    return { roman: baseRomanSymbol, figures: figures };
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
            // Base duration in beats (quarter note = 1). Include dotted notes.
            let durationInBeats = DURATION_VALUES[note.duration || 'quarter'] * (note.isDotted ? 1.5 : 1);

            if (note.isTriplet && !tripletContext) {
                // 3 notes in the time of 2 of the same value.
                tripletContext = { notesInTriplet: 3, beatsForTriplet: durationInBeats * 2, notesProcessed: 0 };
            }

            if (tripletContext) {
                durationInBeats = tripletContext.beatsForTriplet / tripletContext.notesInTriplet;
            }

            if (durationInMeasure + durationInBeats > beatsPerMeasure + 0.001) { 
                measureIndex++;
                durationInMeasure = 0;
            }

            processedNotes.push({
                ...note,
                measureIndex: measureIndex,
                beat: durationInMeasure + 1,
            });

            durationInMeasure += durationInBeats;

            if (tripletContext) {
                tripletContext.notesProcessed++;
                if (tripletContext.notesProcessed >= tripletContext.notesInTriplet) {
                    tripletContext = null;
                }
            }
        }
    });

    return processedNotes.sort((a,b) => {
        const mDiff = (a.measureIndex ?? 0) - (b.measureIndex ?? 0);
        if (mDiff !== 0) return mDiff;
        const bDiff = (a.beat ?? 0) - (b.beat ?? 0);
        if (bDiff !== 0) return bDiff;
        return (a.voice ?? 1) - (b.voice ?? 1);
    });
}

function getIntervalQuality(diatonicSize: number, semitones: number): 'Perfect' | 'Major' | 'Minor' | 'Augmented' | 'Diminished' | null {
    const size = diatonicSize; 
    switch (size) {
        case 0:
        case 3:
        case 4:
        case 7:
            const perfectSemitones = { 0: 0, 3: 5, 4: 7, 7: 12 }[size]!;
            if (semitones === perfectSemitones) return 'Perfect';
            if (semitones === perfectSemitones + 1) return 'Augmented';
            if (semitones === perfectSemitones - 1) return 'Diminished';
            break;
        case 1:
        case 2:
        case 5:
        case 6:
            const majorSemitones = { 1: 2, 2: 4, 5: 9, 6: 11 }[size]!;
            if (semitones === majorSemitones) return 'Major';
            if (semitones === majorSemitones - 1) return 'Minor';
            if (semitones > majorSemitones) return 'Augmented';
            return 'Diminished';
    }
    return null;
}

export function applyHarmonyRules(notes: StaffNote[], keySignature: KeySignature, keyTonic: string, isMinor: boolean, analysisContexts: AnalysisContext[]): HarmonyAnalysisResult {
    const violations: RuleViolation[] = [];
    const connections: ErrorConnection[] = [];
    const analyzedNotes = [...notes]; 

    const chordsMap = new Map<string, StaffNote[]>();
    notes.forEach(note => {
        if(note.isRest) return;
        const key = `${note.measureIndex ?? 0}-${note.beat ?? 1}`;
        if (!chordsMap.has(key)) chordsMap.set(key, []);
        chordsMap.get(key)!.push(note);
    });

    const sortedChords = Array.from(chordsMap.values()).sort((a, b) => {
        const aNote = a[0];
        const bNote = b[0];
        const measureDiff = (aNote.measureIndex ?? 0) - (bNote.measureIndex ?? 0);
        if (measureDiff !== 0) return measureDiff;
        return (aNote.beat ?? 1) - (bNote.beat ?? 1);
    });

    const chordAnalyses: (({ roman: string, figures: string[] }) | null)[] = [];
    const chordContexts: { tonic: string; isMinor: boolean }[] = [];

    for (const chord of sortedChords) {
        const measureIndex = chord[0]?.measureIndex ?? 0;
        const applicableContext = analysisContexts
            .filter(c => c.measureIndex <= measureIndex)
            .sort((a, b) => b.measureIndex - a.measureIndex)[0];
        
        const currentContextTonic = applicableContext ? applicableContext.newTonic : keyTonic;
        const currentContextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinor;

        chordContexts.push({ tonic: currentContextTonic, isMinor: currentContextIsMinor });
        chordAnalyses.push(getRomanAnalysis(chord, currentContextTonic, currentContextIsMinor));
    }


    for (let i = 0; i < sortedChords.length; i++) {
        const chord = sortedChords[i];
        const analysis = chordAnalyses[i];
        const context = chordContexts[i];
        
        const sortedChord = [...chord].sort((a,b) => a.midi - b.midi);
        const bass = sortedChord[0];
        const tenor = sortedChord.find(n => n.voice === 3);
        const alto = sortedChord.find(n => n.voice === 2);
        const soprano = sortedChord[sortedChord.length - 1];
        
        if (alto && soprano && alto.midi > soprano.midi) {
            violations.push({ ruleId: 'R-04', description: 'Voice crossing: Alto is higher than Soprano.', noteIds: [alto.id, soprano.id], severity: 'warning' });
            connections.push({ type: 'vertical', noteId1: alto.id, noteId2: soprano.id });
        }
        
        if (tenor && alto && tenor.midi > alto.midi) {
            violations.push({
                ruleId: 'EXC-S02',
                description: `Incrocio tra Alto e Tenore (tollerato).`,
                noteIds: [tenor.id, alto.id],
                severity: 'warning'
            });
            connections.push({ type: 'vertical', noteId1: tenor.id, noteId2: alto.id });
        }
        
        if (bass && tenor && bass.midi > tenor.midi) {
            violations.push({ ruleId: 'R-04', description: 'Voice crossing: Bass is higher than Tenor.', noteIds: [bass.id, tenor.id], severity: 'error' });
            connections.push({ type: 'vertical', noteId1: bass.id, noteId2: tenor.id });
        }
        
        if (soprano && alto && soprano.midi - alto.midi > 12) {
            violations.push({ ruleId: 'R-08', description: 'Distance between Soprano and Alto is greater than an octave.', noteIds: [soprano.id, alto.id], severity: 'warning' });
            connections.push({ type: 'vertical', noteId1: soprano.id, noteId2: alto.id });
        }
        if (alto && tenor && alto.midi - tenor.midi > 12) {
             violations.push({ ruleId: 'R-08', description: 'Distance between Alto and Tenor is greater than an octave.', noteIds: [alto.id, tenor.id], severity: 'warning' });
             connections.push({ type: 'vertical', noteId1: alto.id, noteId2: tenor.id });
        }

        const notesByPitch = new Map<string, StaffNote[]>();
        chord.forEach(note => {
            const pitchName = note.pitch;
            if (!notesByPitch.has(pitchName)) {
                notesByPitch.set(pitchName, []);
            }
            notesByPitch.get(pitchName)!.push(note);
        });

        notesByPitch.forEach((notesWithSamePitch, pitchName) => {
            if (notesWithSamePitch.length > 1) {
                const uniqueNoteIndices = new Set(notesWithSamePitch.map(n => n.noteIndex));
                if (uniqueNoteIndices.size > 1) {
                    const noteIds = notesWithSamePitch.map(n => n.id);
                    violations.push({
                        ruleId: 'R-09',
                        description: `Falsa relazione cromatica armonica: ${pitchName} e ${pitchName} alterato nello stesso accordo.`,
                        noteIds: noteIds,
                        severity: 'error'
                    });
                    if (noteIds.length >= 2) {
                       connections.push({ type: 'vertical', noteId1: noteIds[0], noteId2: noteIds[1] });
                    }
                }
            }
        });

        if (analysis) {
            const isDominantOrLeading = (analysis.roman.startsWith('V') && analysis.roman !== 'VI') || analysis.roman.startsWith('vii');

            if (isDominantOrLeading) {
                const chordInfo = identifyChord(chord);
                if (chordInfo && chordInfo.root) {
                    const thirdIndex = (chordInfo.root.noteIndex + 4) % 12;
                    const leadingTones = chord.filter(n => n.noteIndex === thirdIndex && !n.isRest);
                    
                    if (leadingTones.length > 1) {
                        violations.push({
                            ruleId: 'R-10',
                            description: `Doubled leading tone (third of the dominant chord).`,
                            noteIds: leadingTones.map(n => n.id),
                            severity: 'error'
                        });
                        if (leadingTones.length > 1) {
                            connections.push({ type: 'vertical', noteId1: leadingTones[0].id, noteId2: leadingTones[1].id });
                        }
                    }
                }
            }
        }
        
        if (i > 0) {
            const prevChord = sortedChords[i - 1];
            const prevAnalysis = chordAnalyses[i-1];
            const prevContext = chordContexts[i - 1];
            const voices: Voice[] = [1, 2, 3, 4];

            voices.forEach(voice => {
                const note_prev = prevChord.find(n => n.voice === voice && !n.isRest);
                const note_curr = chord.find(n => n.voice === voice && !n.isRest);

                if (note_prev && note_curr) {
                    if (voice === 1 || voice === 4) {
                        const soprano_prev_r14 = prevChord.find(n => n.voice === 1 && !n.isRest);
                        const bass_prev_r14 = prevChord.find(n => n.voice === 4 && !n.isRest);
                        const soprano_curr_r14 = chord.find(n => n.voice === 1 && !n.isRest);
                        const bass_curr_r14 = chord.find(n => n.voice === 4 && !n.isRest);

                        if (soprano_prev_r14 && bass_prev_r14 && soprano_curr_r14 && bass_curr_r14) {
                            const dir_s = getDirection(soprano_prev_r14, soprano_curr_r14);
                            const dir_b = getDirection(bass_prev_r14, bass_curr_r14);
                            if (dir_s !== 'STATIONARY' && dir_s === dir_b) {
                                const alreadyExists = violations.some(v => v.ruleId === 'R-14' && v.noteIds.includes(soprano_curr_r14.id));
                                if (!alreadyExists) {
                                    violations.push({
                                        ruleId: 'R-14',
                                        description: `Moto simile/parallelo tra le voci estreme (preferire il moto contrario).`,
                                        noteIds: [soprano_curr_r14.id, bass_curr_r14.id],
                                        severity: 'warning'
                                    });
                                    connections.push({ type: 'horizontal', noteId1: soprano_prev_r14.id, noteId2: soprano_curr_r14.id });
                                    connections.push({ type: 'horizontal', noteId1: bass_prev_r14.id, noteId2: bass_curr_r14.id });
                                }
                            }
                        }
                    }

                    if (voice === 2 || voice === 3) {
                        if (getInterval(note_prev, note_curr) > 9) {
                            violations.push({
                                ruleId: 'R-15',
                                description: `Salto melodico ampio (superiore a una sesta) nella voce interna (voce ${voice}).`,
                                noteIds: [note_prev.id, note_curr.id],
                                severity: 'warning'
                            });
                            connections.push({ type: 'horizontal', noteId1: note_prev.id, noteId2: note_curr.id });
                        }
                    }
                }
            });
            
            const voicePairs: [Voice, Voice][] = [[1, 2], [2, 3], [3, 4]];
            voicePairs.forEach(([v_sup, v_inf]) => {
                const note_sup_prev = prevChord.find(n => n.voice === v_sup && !n.isRest);
                const note_inf_prev = prevChord.find(n => n.voice === v_inf && !n.isRest);
                const note_sup_curr = chord.find(n => n.voice === v_sup && !n.isRest);
                const note_inf_curr = chord.find(n => n.voice === v_inf && !n.isRest);

                if (note_sup_prev && note_inf_prev && note_sup_curr && note_inf_curr) {
                    const dir_sup = getDirection(note_sup_prev, note_sup_curr);
                    const dir_inf = getDirection(note_inf_prev, note_inf_curr);
                    if (dir_sup !== 'STATIONARY' && dir_sup === dir_inf) {
                        if (note_inf_curr.midi > note_sup_prev.midi) {
                            violations.push({
                                ruleId: 'R-05',
                                description: `Voice overlap between voices ${v_sup} and ${v_inf}.`,
                                noteIds: [note_inf_curr.id, note_sup_prev.id],
                                severity: 'warning'
                            });
                            connections.push({ type: 'horizontal', noteId1: note_sup_prev.id, noteId2: note_inf_curr.id });
                        }
                    }
                }
            });

            const sopranoP = prevChord.find(n => n.voice === 1 && !n.isRest);
            const bassP = prevChord.find(n => n.voice === 4 && !n.isRest);
            const sopranoC = chord.find(n => n.voice === 1 && !n.isRest);
            const bassC = chord.find(n => n.voice === 4 && !n.isRest);

            if (sopranoP && bassP && sopranoC && bassC) {
              const arrivalInterval = Math.abs(sopranoC.midi - bassC.midi) % 12;
              const isOctaveOrFifth = (arrivalInterval === 0 || arrivalInterval === 7);

              if (isOctaveOrFifth) {
                const sopranoMovesUp = sopranoC.midi > sopranoP.midi;
                const bassMovesUp = bassC.midi > bassP.midi;
                const isSimilarMotion = (sopranoMovesUp === bassMovesUp) && (sopranoP.midi !== sopranoC.midi);

                if (isSimilarMotion) {
                  const sopranoInterval = Math.abs(sopranoC.midi - sopranoP.midi);
                  const sopranoLeaps = sopranoInterval > 2;

                  if (sopranoLeaps) {
                    violations.push({
                      ruleId: 'R-05',
                      description: 'Quinte/Ottave nascoste tra le voci estreme.',
                      noteIds: [sopranoC.id, bassC.id],
                      severity: 'warning'
                    });
                  }
                }
              }
            }

            const all_voices_prev = [ prevChord.find(n => n.voice === 1 && !n.isRest), prevChord.find(n => n.voice === 2 && !n.isRest), prevChord.find(n => n.voice === 3 && !n.isRest), prevChord.find(n => n.voice === 4 && !n.isRest) ];
            const all_voices_curr = [ chord.find(n => n.voice === 1 && !n.isRest), chord.find(n => n.voice === 2 && !n.isRest), chord.find(n => n.voice === 3 && !n.isRest), chord.find(n => n.voice === 4 && !n.isRest) ];

            if (all_voices_prev.every(Boolean) && all_voices_curr.every(Boolean)) {
                const directions = all_voices_prev.map((prev, index) => getDirection(prev!, all_voices_curr[index]!));
                const firstDirection = directions[0];
                if (firstDirection !== 'STATIONARY' && directions.every(d => d === firstDirection)) {
                    violations.push({
                        ruleId: 'R-13',
                        description: 'Prohibited similar motion: all voices move in the same direction.',
                        noteIds: all_voices_curr.map(n => n!.id),
                        severity: 'warning'
                    });
                    for (let v_idx = 0; v_idx < all_voices_prev.length; v_idx++) {
                        if (all_voices_prev[v_idx] && all_voices_curr[v_idx]) {
                            connections.push({ type: 'horizontal', noteId1: all_voices_prev[v_idx]!.id, noteId2: all_voices_curr[v_idx]!.id });
                        }
                    }
                }
            }

            const prevPitches = new Map<number, string>(prevChord.map(n => [n.voice!, n.pitch]));
            chord.forEach(currNote => {
                if (!currNote.voice) return;
                prevPitches.forEach((prevPitch, prevVoice) => {
                    if (currNote.voice === prevVoice) return;
                    if (currNote.pitch === prevPitch) {
                        const prevNote = prevChord.find(n => n.voice === prevVoice)!;
                        if (currNote.noteIndex !== prevNote.noteIndex) {
                            violations.push({
                                ruleId: 'R-09',
                                description: `Falsa relazione cromatica tra la voce ${prevVoice} e la voce ${currNote.voice}.`,
                                noteIds: [prevNote.id, currNote.id],
                                severity: 'error'
                            });
                            connections.push({ type: 'horizontal', noteId1: prevNote.id, noteId2: currNote.id });
                        }
                    }
                });
            });

            if (i > 1) {
                const prevPrevChord = sortedChords[i - 2];
                voices.forEach(voice => {
                    const note_prev_prev = prevPrevChord.find(n => n.voice === voice && !n.isRest);
                    const note_prev = prevChord.find(n => n.voice === voice && !n.isRest);
                    const note_curr = chord.find(n => n.voice === voice && !n.isRest);

                    if (note_prev_prev && note_prev && note_curr) {
                        const diatonicSteps = Math.abs(note_prev.position - note_prev_prev.position);
                        const semitones = Math.abs(note_prev.midi - note_prev_prev.midi);
                        const quality = getIntervalQuality(diatonicSteps, semitones);

                        if (quality === 'Augmented' || quality === 'Diminished') {
                            const directionLeap = getDirection(note_prev_prev, note_prev);
                            const directionResolution = getDirection(note_prev, note_curr);
                            const resolutionIsDiatonicStep = Math.abs(note_curr.position - note_prev.position) === 1;
                            
                            let error = false;
                            let description = '';

                            if (quality === 'Augmented' && directionLeap !== 'STATIONARY') {
                                if (directionResolution !== directionLeap || !resolutionIsDiatonicStep) {
                                    error = true;
                                    description = `Augmented melodic leap in voice ${voice} should resolve by step in the same direction.`;
                                }
                            } else if (quality === 'Diminished' && directionLeap !== 'STATIONARY') {
                                const oppositeDirection = directionLeap === 'ASCENDING' ? 'DESCENDING' : 'ASCENDING';
                                if (directionResolution !== oppositeDirection || !resolutionIsDiatonicStep) {
                                    error = true;
                                    description = `Diminished melodic leap in voice ${voice} should resolve by step in the opposite direction.`;
                                }
                            }

                            if (error) {
                                violations.push({
                                    ruleId: 'R-06',
                                    description,
                                    noteIds: [note_prev_prev.id, note_prev.id, note_curr.id],
                                    severity: 'error'
                                });
                                connections.push({ type: 'horizontal', noteId1: note_prev_prev.id, noteId2: note_prev.id });
                                connections.push({ type: 'horizontal', noteId1: note_prev.id, noteId2: note_curr.id });
                            }
                        }
                    }
                });
            }
           
            for (let v1_idx = 0; v1_idx < voices.length; v1_idx++) {
                for (let v2_idx = v1_idx + 1; v2_idx < voices.length; v2_idx++) {
                    const v1 = voices[v1_idx];
                    const v2 = voices[v2_idx];
                    
                    const note1_prev = prevChord.find(n => n.voice === v1 && !n.isRest);
                    const note2_prev = prevChord.find(n => n.voice === v2 && !n.isRest);
                    const note1_curr = chord.find(n => n.voice === v1 && !n.isRest);
                    const note2_curr = chord.find(n => n.voice === v2 && !n.isRest);

                    if (note1_prev && note2_prev && note1_curr && note2_curr) {
                        const interval_prev = Math.abs(note1_prev.midi - note2_prev.midi) % 12;
                        const interval_curr = Math.abs(note1_curr.midi - note2_curr.midi) % 12;
                        const dir1 = getDirection(note1_prev, note1_curr);
                        const dir2 = getDirection(note2_prev, note2_curr);
                        
                        if (dir1 !== 'STATIONARY' && dir1 === dir2) {
                            if ((interval_prev === 0 || interval_prev === 12) && (interval_curr === 0 || interval_curr === 12)) {
                                violations.push({ ruleId: 'R-01', description: `Parallel octaves between voices ${v1} and ${v2}.`, noteIds: [note1_curr.id, note2_curr.id], severity: 'error' });
                                connections.push({ type: 'horizontal', noteId1: note1_prev.id, noteId2: note1_curr.id });
                                connections.push({ type: 'horizontal', noteId1: note2_prev.id, noteId2: note2_curr.id });
                            }
                            if (interval_prev === 7 && interval_curr === 7) {
                                let isException = false;
                                let exceptionReason = '';
                                const infoAccordoArrivo = identifyChord(chord);

                                if (infoAccordoArrivo && infoAccordoArrivo.root && (isNoteDissonantInChord(note1_curr, infoAccordoArrivo) || isNoteDissonantInChord(note2_curr, infoAccordoArrivo))) {
                                    isException = true;
                                    exceptionReason = 'EXC-M03: La seconda quinta è una settima dissonante.';
                                }

                                if (!isException) {
                                    if (prevContext.isMinor && prevAnalysis && analysis) {
                                        const isVi = (prevAnalysis.roman.startsWith('vi') || prevAnalysis.roman.startsWith('VI'));
                                        const isV = analysis.roman.startsWith('V');
                                        if (isVi && isV) {
                                            isException = true;
                                            exceptionReason = 'EXC-M04: Quinte parallele tollerate nella progressione vi-V in minore.';
                                        }
                                    }
                                }
                                
                                if (isException) {
                                    violations.push({
                                        ruleId: 'R-02',
                                        description: exceptionReason,
                                        noteIds: [note1_curr.id, note2_curr.id],
                                        severity: 'exception'
                                    });
                                } else {
                                    violations.push({ ruleId: 'R-02', description: `Parallel fifths between voices ${v1} and ${v2}.`, noteIds: [note1_curr.id, note2_curr.id], severity: 'error' });
                                }
                                connections.push({ type: 'horizontal', noteId1: note1_prev.id, noteId2: note1_curr.id });
                                connections.push({ type: 'horizontal', noteId1: note2_prev.id, noteId2: note2_curr.id });
                            }
                        }
                    }
                }
            }
            
            const prevChordInfoFor7th = identifyChord(prevChord);
            const isAugmentedSixth = prevAnalysis && (prevAnalysis.roman.includes('It+') || prevAnalysis.roman.includes('Fr+') || prevAnalysis.roman.includes('Ger+'));
            const seventhIntervalValue = (prevChordInfoFor7th && prevChordInfoFor7th.intervals) ? [11, 10, 9].find(i => prevChordInfoFor7th.intervals!.has(i)) : undefined;

            if (prevChordInfoFor7th && prevChordInfoFor7th.root && seventhIntervalValue && !isAugmentedSixth) {
                const seventhNoteIndex = (prevChordInfoFor7th.root.noteIndex + seventhIntervalValue) % 12;
                const seventhNote = prevChord.find(n => n.noteIndex === seventhNoteIndex && !n.isRest);

                if (seventhNote) {
                    let isResolved = false;
                    let isException = false;
                    let exceptionViolation: RuleViolation | null = null;

                    const resolutionNoteInSameVoice = chord.find(n => n.voice === seventhNote.voice && !n.isRest);
                    const expectedResolutionNoteIndex1 = (seventhNote.noteIndex - 1 + 12) % 12;
                    const expectedResolutionNoteIndex2 = (seventhNote.noteIndex - 2 + 12) % 12;

                    if (resolutionNoteInSameVoice) {
                        const interval = seventhNote.midi - resolutionNoteInSameVoice.midi;
                        if (interval === 1 || interval === 2) {
                            isResolved = true;
                        }
                    }

                    if (!isResolved) {
                        const validTransferVoices: Voice[] = [1, 4];
                        if (seventhNote.voice && seventhNote.voice < 4) {
                            validTransferVoices.push((seventhNote.voice + 1) as Voice);
                        }
                        
                        const transferNote = chord.find(n => 
                            n.voice !== seventhNote.voice && 
                            validTransferVoices.includes(n.voice!) &&
                            !n.isRest && 
                            (n.noteIndex === expectedResolutionNoteIndex1 || n.noteIndex === expectedResolutionNoteIndex2)
                        );
                        
                        if (transferNote) {
                            isException = true;
                            exceptionViolation = { 
                                ruleId: 'EXC-7m01', 
                                description: `Eccezione: Risoluzione della settima trasferita alla voce ${transferNote.voice}.`, 
                                noteIds: [seventhNote.id, transferNote.id], 
                                severity: 'exception' 
                            };
                        }

                        if (!isException && resolutionNoteInSameVoice) {
                            const movementInterval = resolutionNoteInSameVoice.midi - seventhNote.midi;

                            if (movementInterval === 5) {
                                const currentChordInfo = identifyChord(chord);
                                if (currentChordInfo && currentChordInfo.intervals?.has(10)) {
                                    const isTargetNoteA7th = currentChordInfo.root && (resolutionNoteInSameVoice.noteIndex - currentChordInfo.root.noteIndex + 12) % 12 === 10;
                                    if (isTargetNoteA7th) {
                                        isException = true;
                                        exceptionViolation = { ruleId: 'EXC-7m01-Leap', description: `Eccezione: Risoluzione della 7a con salto di quarta ascendente su un'altra 7a.`, noteIds: [seventhNote.id, resolutionNoteInSameVoice.id], severity: 'exception' };
                                    }
                                }
                            } 
                            else if (movementInterval === 0) {
                                const isV = prevAnalysis && (prevAnalysis.roman.startsWith('V') && !prevAnalysis.roman.includes('/'));
                                const isI = analysis && (analysis.roman.startsWith('I') || analysis.roman.startsWith('i'));
                                if (!(isV && isI)) {
                                    isException = true;
                                    exceptionViolation = { ruleId: 'EXC-7m01-Passive', description: `Eccezione: 7a passiva che rimane stazionaria in una progressione secondaria.`, noteIds: [seventhNote.id, resolutionNoteInSameVoice.id], severity: 'exception' };
                                }
                            }
                        }
                    }
                    
                    if (isException && exceptionViolation) {
                        violations.push(exceptionViolation);
                        connections.push({ type: 'horizontal', noteId1: exceptionViolation.noteIds[0], noteId2: exceptionViolation.noteIds[1] });
                    } else if (!isResolved) {
                        const noteIds = [seventhNote.id];
                        if (resolutionNoteInSameVoice) noteIds.push(resolutionNoteInSameVoice.id);
                        violations.push({ ruleId: 'R-12', description: `Incorrect resolution of the 7th. The 7th in voice ${seventhNote.voice} should resolve down by step.`, noteIds, severity: 'error' });
                        if (resolutionNoteInSameVoice) {
                            connections.push({ type: 'horizontal', noteId1: seventhNote.id, noteId2: resolutionNoteInSameVoice.id });
                        }
                    }
                }
            }

            if (prevAnalysis) {
                const prevKeyTonicIndex = noteNameToIndex[prevContext.tonic];
                let isDominantFunction = false;
                let impliedTonicIndex: number | null = null;
                
                if ((prevAnalysis.roman.startsWith('V') && prevAnalysis.roman !== 'VI') || prevAnalysis.roman.startsWith('vii')) {
                    isDominantFunction = true;
                    impliedTonicIndex = prevKeyTonicIndex;
                } else {
                    const secondaryDominantMatch = prevAnalysis.roman.match(/^V[^/]*\/(.*)$/);
                    if (secondaryDominantMatch) {
                        isDominantFunction = true;
                        const targetRoman = secondaryDominantMatch[1].replace('°', '').replace('+', '');
                        const romanNumeralsDiatonic = prevContext.isMinor ? ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'] : ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
                        const scaleIntervals = prevContext.isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
                        const degreeIndex = romanNumeralsDiatonic.findIndex(r => r.toUpperCase() === targetRoman.toUpperCase());
                        
                        if (degreeIndex !== -1) {
                            impliedTonicIndex = (prevKeyTonicIndex + scaleIntervals[degreeIndex]) % 12;
                        }
                    }
                }
                
                if (isDominantFunction && impliedTonicIndex !== null) {
                    const leadingToneNoteIndex = (impliedTonicIndex - 1 + 12) % 12;
                    const leadingToneNote = prevChord.find(n => n.noteIndex === leadingToneNoteIndex && !n.isRest);
    
                    if (leadingToneNote) {
                        const resolutionNote = chord.find(n => n.voice === leadingToneNote.voice && !n.isRest);
                        if (resolutionNote) {
                            if (resolutionNote.noteIndex !== impliedTonicIndex) {
                                const isInnerVoice = leadingToneNote.voice === 2 || leadingToneNote.voice === 3;
                                const impliedTonicFifthIndex = (impliedTonicIndex + 7) % 12;
                                const resolvesToFifth = resolutionNote.noteIndex === impliedTonicFifthIndex;
                                const currChordInfo = identifyChord(chord);
                                const resolvesToTonicChord = currChordInfo && currChordInfo.root && currChordInfo.root.noteIndex === impliedTonicIndex;

                                if (!(isInnerVoice && resolvesToFifth && resolvesToTonicChord)) {
                                    violations.push({
                                        ruleId: 'R-07',
                                        description: `Incorrect resolution of leading tone (${(ALL_NOTE_SPELLINGS[leadingToneNote.noteIndex] || [])[0]}) in voice ${leadingToneNote.voice}. It should resolve to the tonic.`,
                                        noteIds: [leadingToneNote.id, resolutionNote.id],
                                        severity: 'error'
                                    });
                                    connections.push({ type: 'horizontal', noteId1: leadingToneNote.id, noteId2: resolutionNote.id });
                                }
                            }
                        } else if (leadingToneNote.voice) {
                            violations.push({
                                ruleId: 'R-07',
                                description: `Leading tone (${(ALL_NOTE_SPELLINGS[leadingToneNote.noteIndex] || [])[0]}) in voice ${leadingToneNote.voice} does not resolve.`,
                                noteIds: [leadingToneNote.id],
                                severity: 'error'
                            });
                        }
                    }
                }
            }
        }
    }

    return { analyzedNotes, violations, connections };
}