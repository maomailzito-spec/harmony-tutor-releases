import { getRomanAnalysis } from '../src/utils/musicTheory';

// E major chord (E, G#, B) in F major context
const eNotes = [
    { pitch: 'E', octave: 3, midi: 52, noteIndex: 4, voice: 4 },
    { pitch: 'B', octave: 3, midi: 59, noteIndex: 11, voice: 3 },
    { pitch: 'E', octave: 4, midi: 64, noteIndex: 4, voice: 2 },
    { pitch: 'G', octave: 4, midi: 68, noteIndex: 8, voice: 1, accidental: 'sharp' },
];
const rF = getRomanAnalysis(eNotes as any, 'F', false);
console.log('E major in F:', JSON.stringify(rF));

// Also test Dm (D, D, F, A) in F major
const dmNotes = [
    { pitch: 'D', octave: 3, midi: 50, noteIndex: 2, voice: 4 },
    { pitch: 'D', octave: 4, midi: 62, noteIndex: 2, voice: 3 },
    { pitch: 'F', octave: 4, midi: 65, noteIndex: 5, voice: 2 },
    { pitch: 'A', octave: 4, midi: 69, noteIndex: 9, voice: 1 },
];
const rFdm = getRomanAnalysis(dmNotes as any, 'F', false);
console.log('Dm in F:', JSON.stringify(rFdm));

// Check if E could be V in any key
for (const k of ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']) {
    const r = getRomanAnalysis(eNotes as any, k, false);
    if (r && /^V/.test(r.roman)) {
        console.log(`E major is ${r.roman} in ${k} major`);
    }
    const rm = getRomanAnalysis(eNotes as any, k, true);
    if (rm && /^V/.test(rm.roman)) {
        console.log(`E major is ${rm.roman} in ${k} minor`);
    }
}
