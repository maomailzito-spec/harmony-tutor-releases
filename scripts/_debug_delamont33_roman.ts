import { getRomanAnalysis, calculateRomanFromChordInfo, identifyChordCandidates } from '../src/utils/musicTheory';

const notes = [
    { pitch: 'B', accidental: 'flat', octave: 4, midi: 70, noteIndex: 10, voice: 1, isRest: false },
    { pitch: 'G', accidental: 'natural', octave: 4, midi: 67, noteIndex: 7, voice: 2, isRest: false },
    { pitch: 'C', accidental: 'natural', octave: 4, midi: 60, noteIndex: 0, voice: 3, isRest: false },
    { pitch: 'E', accidental: 'natural', octave: 3, midi: 52, noteIndex: 4, voice: 4, isRest: false },
];

const cands = identifyChordCandidates(notes as any);
const best = Array.isArray(cands) ? (cands as any[])[0] : null;
console.log('Best candidate:', JSON.stringify(best, null, 2));

const roman = calculateRomanFromChordInfo(best, 'G', true);
console.log('Roman from best:', JSON.stringify(roman));

const r2 = getRomanAnalysis(notes as any, 'G', true, {});
console.log('getRomanAnalysis G minor:', JSON.stringify(r2));
