import { ChordType, CagedVoicing, Voicing, BuiltInChords } from '../types';

const transpose = (voicing: Voicing, amount: number): Voicing => {
  return voicing.map(fret => (fret === -1 ? -1 : fret + amount)) as Voicing;
};

// Define the 5 CAGED shapes in their open positions for MAJOR chords.
// Voicing format is [low E, A, D, G, B, high e]
const C_MAJOR_BASE_SHAPES: { name: string; voicing: Voicing; rootNoteIndex: number }[] = [
    { name: 'E Shape', voicing: [0, 2, 2, 1, 0, 0], rootNoteIndex: 4 }, // Root E
    { name: 'D Shape', voicing: [-1, -1, 0, 2, 3, 2], rootNoteIndex: 2 }, // Root D
    { name: 'C Shape', voicing: [-1, 3, 2, 0, 1, 0], rootNoteIndex: 0 }, // Root C
    { name: 'A Shape', voicing: [-1, 0, 2, 2, 2, 0], rootNoteIndex: 9 }, // Root A
    { name: 'G Shape', voicing: [3, 2, 0, 0, 0, 3], rootNoteIndex: 7 }, // Root G
];

// Define the 5 CAGED shapes in their open positions for MINOR chords.
const C_MINOR_BASE_SHAPES: { name: string; voicing: Voicing; rootNoteIndex: number }[] = [
    { name: 'Em Shape', voicing: [0, 2, 2, 0, 0, 0], rootNoteIndex: 4 }, // Root E
    { name: 'Dm Shape', voicing: [-1, -1, 0, 2, 3, 1], rootNoteIndex: 2 }, // Root D
    { name: 'Cm Shape', voicing: [-1, 3, 1, 0, 1, -1], rootNoteIndex: 0 }, // Root C
    { name: 'Am Shape', voicing: [-1, 0, 2, 2, 1, 0], rootNoteIndex: 9 }, // Root A
    { name: 'Gm Shape', voicing: [3, 1, 0, 0, 3, 3], rootNoteIndex: 7 }, // Root G
];

const C_MAJOR7_VOICINGS: CagedVoicing[] = [
    { name: 'Drop 2 (6-5-4-3) - 2nd Inversion (5th in Bass)', voicing: [3, 3, 2, 4, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 3rd Inversion (7th in Bass)', voicing: [7, 7, 5, 5, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - Root Position (Root in Bass)', voicing: [8, 10, 9, 9, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 1st Inversion (3rd in Bass)', voicing: [12, 14, 10, 12, -1, -1] },
    { name: 'Drop 2 (5-4-3-2) - Root Position (Root in Bass)', voicing: [-1, 3, 5, 4, 5, -1] },
    { name: 'Drop 2 (5-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [-1, 7, 9, 5, 8, -1] },
    { name: 'Drop 2 (5-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [-1, 10, 10, 9, 12, -1] },
    { name: 'Drop 2 (5-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [-1, 14, 14, 12, 13, -1] },
    { name: 'Drop 2 (4-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, -1, 5, 5, 5, 7] },
    { name: 'Drop 2 (4-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, -1, 9, 9, 8, 8] },
    { name: 'Drop 2 (4-3-2-1) - Root Position (Root in Bass)', voicing: [-1, -1, 10, 12, 12, 12] },
    { name: 'Drop 2 (4-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, -1, 2, 4, 1, 3] },
    { name: 'Drop 2 (6-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [3, -1, 2, 4, 1, -1] },
    { name: 'Drop 2 (6-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [7, -1, 5, 5, 5, -1] },
    { name: 'Drop 2 (6-4-3-2) - Root Position (Root in Bass)', voicing: [8, -1, 9, 9, 8, -1] },
    { name: 'Drop 2 (6-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [12, -1, 10, 12, 12, -1] },
    { name: 'Drop 2 (5-3-2-1) - Root Position (Root in Bass)', voicing: [-1, 3, -1, 4, 5, 3] },
    { name: 'Drop 2 (5-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, 7, -1, 5, 8, 7] },
    { name: 'Drop 2 (5-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, 10, -1, 9, 12, 8] },
    { name: 'Drop 2 (5-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, 14, -1, 12, 13, 12] },
];

const C_DOMINANT7_VOICINGS: CagedVoicing[] = [
    { name: 'Drop 2 (6-5-4-3) - 2nd Inversion (5th in Bass)', voicing: [3, 3, 2, 3, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 3rd Inversion (7th in Bass)', voicing: [6, 7, 5, 5, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - Root Position (Root in Bass)', voicing: [8, 10, 8, 9, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 1st Inversion (3rd in Bass)', voicing: [12, 13, 10, 12, -1, -1] },
    { name: 'Drop 2 (5-4-3-2) - Root Position (Root in Bass)', voicing: [-1, 3, 5, 3, 5, -1] },
    { name: 'Drop 2 (5-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [-1, 7, 8, 5, 8, -1] },
    { name: 'Drop 2 (5-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [-1, 10, 10, 9, 11, -1] },
    { name: 'Drop 2 (5-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [-1, 13, 14, 12, 13, -1] },
    { name: 'Drop 2 (4-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, -1, 5, 5, 5, 6] },
    { name: 'Drop 2 (4-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, -1, 8, 9, 8, 8] },
    { name: 'Drop 2 (4-3-2-1) - Root Position (Root in Bass)', voicing: [-1, -1, 10, 12, 11, 12] },
    { name: 'Drop 2 (4-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, -1, 2, 3, 1, 3] },
    { name: 'Drop 2 (6-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [3, -1, 2, 3, 1, -1] },
    { name: 'Drop 2 (6-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [6, -1, 5, 5, 5, -1] },
    { name: 'Drop 2 (6-4-3-2) - Root Position (Root in Bass)', voicing: [8, -1, 8, 9, 8, -1] },
    { name: 'Drop 2 (6-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [12, -1, 10, 12, 11, -1] },
    { name: 'Drop 2 (5-3-2-1) - Root Position (Root in Bass)', voicing: [-1, 3, -1, 3, 5, 3] },
    { name: 'Drop 2 (5-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, 7, -1, 5, 8, 6] },
    { name: 'Drop 2 (5-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, 10, -1, 9, 11, 8] },
    { name: 'Drop 2 (5-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, 13, -1, 12, 13, 12] },
];

const C_MINOR7_VOICINGS: CagedVoicing[] = [
    { name: 'Drop 2 (6-5-4-3) - 2nd Inversion (5th in Bass)', voicing: [3, 3, 1, 3, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 3rd Inversion (7th in Bass)', voicing: [6, 6, 5, 5, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - Root Position (Root in Bass)', voicing: [8, 10, 8, 8, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 1st Inversion (3rd in Bass)', voicing: [11, 13, 10, 12, -1, -1] },
    { name: 'Drop 2 (5-4-3-2) - Root Position (Root in Bass)', voicing: [-1, 3, 5, 3, 4, -1] },
    { name: 'Drop 2 (5-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [-1, 6, 8, 5, 8, -1] },
    { name: 'Drop 2 (5-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [-1, 10, 10, 8, 11, -1] },
    { name: 'Drop 2 (5-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [-1, 13, 13, 12, 13, -1] },
    { name: 'Drop 2 (4-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, -1, 5, 5, 4, 6] },
    { name: 'Drop 2 (4-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, -1, 8, 8, 8, 8] },
    { name: 'Drop 2 (4-3-2-1) - Root Position (Root in Bass)', voicing: [-1, -1, 10, 12, 11, 11] },
    { name: 'Drop 2 (4-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, -1, 1, 3, 1, 3] },
    { name: 'Drop 2 (6-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [3, -1, 1, 3, 1, -1] },
    { name: 'Drop 2 (6-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [6, -1, 5, 5, 4, -1] },
    { name: 'Drop 2 (6-4-3-2) - Root Position (Root in Bass)', voicing: [8, -1, 8, 8, 8, -1] },
    { name: 'Drop 2 (6-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [11, -1, 10, 12, 11, -1] },
    { name: 'Drop 2 (5-3-2-1) - Root Position (Root in Bass)', voicing: [-1, 3, -1, 3, 4, 3] },
    { name: 'Drop 2 (5-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, 6, -1, 5, 8, 6] },
    { name: 'Drop 2 (5-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, 10, -1, 8, 11, 8] },
    { name: 'Drop 2 (5-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, 13, -1, 12, 13, 11] },
];

const C_MINOR7B5_VOICINGS: CagedVoicing[] = [
    { name: 'Drop 2 (6-5-4-3) - 2nd Inversion (5th in Bass)', voicing: [2, 3, 1, 3, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 3rd Inversion (7th in Bass)', voicing: [6, 6, 4, 5, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - Root Position (Root in Bass)', voicing: [8, 9, 8, 8, -1, -1] },
    { name: 'Drop 2 (6-5-4-3) - 1st Inversion (3rd in Bass)', voicing: [11, 13, 10, 11, -1, -1] },
    { name: 'Drop 2 (5-4-3-2) - Root Position (Root in Bass)', voicing: [-1, 3, 4, 3, 4, -1] },
    { name: 'Drop 2 (5-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [-1, 6, 8, 5, 7, -1] },
    { name: 'Drop 2 (5-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [-1, 9, 10, 8, 11, -1] },
    { name: 'Drop 2 (5-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [-1, 13, 13, 11, 13, -1] },
    { name: 'Drop 2 (4-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, -1, 4, 5, 4, 6] },
    { name: 'Drop 2 (4-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, -1, 8, 8, 7, 8] },
    { name: 'Drop 2 (4-3-2-1) - Root Position (Root in Bass)', voicing: [-1, -1, 10, 11, 11, 11] },
    { name: 'Drop 2 (4-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, -1, 1, 3, 1, 2] },
    { name: 'Drop 2 (6-4-3-2) - 2nd Inversion (5th in Bass)', voicing: [2, -1, 1, 3, 1, -1] },
    { name: 'Drop 2 (6-4-3-2) - 3rd Inversion (7th in Bass)', voicing: [6, -1, 4, 5, 4, -1] },
    { name: 'Drop 2 (6-4-3-2) - Root Position (Root in Bass)', voicing: [8, -1, 8, 8, 7, -1] },
    { name: 'Drop 2 (6-4-3-2) - 1st Inversion (3rd in Bass)', voicing: [11, -1, 10, 11, 11, -1] },
    { name: 'Drop 2 (5-3-2-1) - Root Position (Root in Bass)', voicing: [-1, 3, -1, 3, 4, 2] },
    { name: 'Drop 2 (5-3-2-1) - 1st Inversion (3rd in Bass)', voicing: [-1, 6, -1, 5, 7, 6] },
    { name: 'Drop 2 (5-3-2-1) - 2nd Inversion (5th in Bass)', voicing: [-1, 9, -1, 8, 11, 8] },
    { name: 'Drop 2 (5-3-2-1) - 3rd Inversion (7th in Bass)', voicing: [-1, 13, 13, 11, 13, -1] },
];

const C_DOMINANT9_13_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1', voicing: [8, -1, 8, 9, 10, 10] },
    { name: 'Voicing 2', voicing: [8, -1, 8, 7, 5, 5] },
    { name: 'Voicing 3', voicing: [-1, 3, 2, 3, 5, 5] },
];

const C_DOMINANT13_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1', voicing: [8, -1, 8, 9, 10, -1] },
    { name: 'Voicing 2', voicing: [-1, -1, 8, 9, 10, 8] },
];

const C_AUGMENTED_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1', voicing: [8, 7, 6, 5, -1, -1] },
    { name: 'Voicing 2', voicing: [-1, 3, 2, 1, 1, -1] },
    { name: 'Voicing 3', voicing: [-1, -1, 10, 9, 9, 8] }
];

const C_DIMINISHED_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 4, 2, 4, -1] },
    { name: 'Voicing 2 (Root on D)', voicing: [-1, -1, 1, 2, 1, 2] },
    { name: 'Voicing 3 (Root on E)', voicing: [8, 9, 7, 8, -1, -1] },
];

const C_SUS2_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 5, 5, 3, -1] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, 10, 10, 9, 8, 8] },
    { name: 'Voicing 3 (Root on D)', voicing: [-1, -1, 5, 7, 8, 5] },
];

const C_SUS4_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 5, 5, 6, -1] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, 10, 10, 10, 8, 8] },
    { name: 'Voicing 3 (Root on D)', voicing: [-1, -1, 5, 7, 8, 6] },
];

const C_DIMINISHED7_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 4, 2, 4, 2] },
    { name: 'Voicing 2 (Root on D)', voicing: [-1, -1, 4, 5, 4, 5] },
    { name: 'Voicing 3 (Root on E)', voicing: [8, 9, 7, 8, 7, -1] },
];

const C_MAJOR6_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 5, 5, 5, 5] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, -1, 9, 9, 8, -1] },
    { name: 'Voicing 3 (Root on D)', voicing: [-1, -1, 5, 7, 5, 5] },
];

const C_MINOR6_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 5, 5, 4, 5] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, -1, 7, 8, 8, -1] },
    { name: 'Voicing 3 (Root on D)', voicing: [-1, 10, 12, 12, 13, 12] },
];

const C_MAJOR9_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 2, 4, 3, -1] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, 7, 9, 7, 8, -1] },
];

const C_MINOR9_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 1, 3, 3, -1] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, 10, 8, 8, 8, -1] },
];

const C_DOMINANT9_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 2, 3, 3, -1] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, 7, 8, 7, 8, -1] },
];

const C_ADD9_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 5, 7, 5, -1] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, 10, 12, 9, 8, 8] },
];

const C_DOMINANT7B9_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on A)', voicing: [-1, 3, 2, 3, 2, 2] },
    { name: 'Voicing 2 (Root on E)', voicing: [8, -1, 8, 7, 8, 7] },
];

const C_MINOR11_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (Root on E)', voicing: [8, -1, 8, 8, 6, 6] },
    { name: 'Voicing 2 (Rootless)', voicing: [-1, 3, 3, 3, 4, -1] },
];

const C_MAJOR13_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (R, 7, 3, 13)', voicing: [8, -1, 9, 9, 10, -1] },
    { name: 'Voicing 2 (R, 5, 7, 3, 13)', voicing: [-1, 3, 5, 4, 5, 5] },
];

const C_MINOR13_VOICINGS: CagedVoicing[] = [
    { name: 'Voicing 1 (R, m7, m3, 13)', voicing: [8, -1, 8, 8, 10, -1] },
    { name: 'Voicing 2 (R, 5, m7, m3, 13)', voicing: [-1, 3, 5, 3, 4, 5] },
];

const ALL_VOICINGS: Partial<Record<ChordType, CagedVoicing[] | { name: string; voicing: Voicing; rootNoteIndex: number }[]>> = {
    // Triads
    [BuiltInChords.Major]: C_MAJOR_BASE_SHAPES,
    [BuiltInChords.Minor]: C_MINOR_BASE_SHAPES,
    [BuiltInChords.Augmented]: C_AUGMENTED_VOICINGS,
    [BuiltInChords.Diminished]: C_DIMINISHED_VOICINGS,
    // Suspended
    [BuiltInChords.Sus2]: C_SUS2_VOICINGS,
    [BuiltInChords.Sus4]: C_SUS4_VOICINGS,
    // Sevenths
    [BuiltInChords.Major7]: C_MAJOR7_VOICINGS,
    [BuiltInChords.Minor7]: C_MINOR7_VOICINGS,
    [BuiltInChords.Dominant7]: C_DOMINANT7_VOICINGS,
    [BuiltInChords.Diminished7]: C_DIMINISHED7_VOICINGS,
    [BuiltInChords.Minor7b5]: C_MINOR7B5_VOICINGS,
    // Sixths
    [BuiltInChords.Major6]: C_MAJOR6_VOICINGS,
    [BuiltInChords.Minor6]: C_MINOR6_VOICINGS,
    // Ninths
    [BuiltInChords.Major9]: C_MAJOR9_VOICINGS,
    [BuiltInChords.Minor9]: C_MINOR9_VOICINGS,
    [BuiltInChords.Dominant9]: C_DOMINANT9_VOICINGS,
    [BuiltInChords.Add9]: C_ADD9_VOICINGS,
    [BuiltInChords.Dominant7b9]: C_DOMINANT7B9_VOICINGS,
    // Elevenths
    [BuiltInChords.Minor11]: C_MINOR11_VOICINGS,
    // Thirteenths
    [BuiltInChords.Major13]: C_MAJOR13_VOICINGS,
    [BuiltInChords.Minor13]: C_MINOR13_VOICINGS,
    [BuiltInChords.Dominant13]: C_DOMINANT13_VOICINGS,
    [BuiltInChords.Dominant9_13]: C_DOMINANT9_13_VOICINGS,
};


export const getGuitarVoicings = (rootNoteIndex: number, chordType: ChordType): CagedVoicing[] | null => {
    const voicingsForType = ALL_VOICINGS[chordType];
    if (!voicingsForType) return null;

    if (chordType === BuiltInChords.Major || chordType === BuiltInChords.Minor) {
        const c_base_shapes = voicingsForType as { name: string; voicing: Voicing; rootNoteIndex: number }[];
        return c_base_shapes.map(shape => {
            const transposeAmount = (rootNoteIndex - shape.rootNoteIndex + 12) % 12;
            return {
                name: shape.name,
                voicing: transpose(shape.voicing, transposeAmount)
            };
        });
    } else {
        const c_voicings = voicingsForType as CagedVoicing[];
        const transposeAmount = rootNoteIndex;
        const CHORDS_WITHOUT_OPEN_STRINGS: ChordType[] = [
            BuiltInChords.Major7,
            BuiltInChords.Minor7,
            BuiltInChords.Dominant7,
            BuiltInChords.Minor7b5,
            BuiltInChords.Diminished,
            BuiltInChords.Diminished7,
            BuiltInChords.Major6,
            BuiltInChords.Minor6,
            BuiltInChords.Major9,
            BuiltInChords.Minor9,
            BuiltInChords.Dominant9,
            BuiltInChords.Add9,
            BuiltInChords.Dominant7b9,
            BuiltInChords.Minor11,
            BuiltInChords.Major13,
            BuiltInChords.Minor13,
            BuiltInChords.Dominant13,
        ];
        const preventOpenStrings = CHORDS_WITHOUT_OPEN_STRINGS.includes(chordType);

        return c_voicings.map(voicing => {
            const originalTransposed = transpose(voicing.voicing, transposeAmount);

            // Create a candidate voicing by shifting down one octave (12 frets)
            const candidateVoicing = transpose(originalTransposed, -12);
            
            // A candidate is valid if all its fretted notes (originally > -1) are on fret 0 or higher.
            const isPhysicallyPlayable = candidateVoicing.every((fret, index) => {
                if (voicing.voicing[index] === -1) { // if original was muted, it should still be muted
                    return fret === -1;
                }
                // if original was fretted, it must now be on fret 0 or higher.
                return fret >= 0;
            });

            if (!isPhysicallyPlayable) {
                return { ...voicing, voicing: originalTransposed };
            }

            const hasOpenStrings = candidateVoicing.some(fret => fret === 0);

            if (preventOpenStrings && hasOpenStrings) {
                return { ...voicing, voicing: originalTransposed };
            }
            
            return {
                ...voicing,
                voicing: candidateVoicing
            };
        });
    }
};