/**
 * Complete tonicization scan: check ALL pairs (not just adjacent) within 2 measures
 */
import { getRomanAnalysis } from '../src/utils/musicTheory';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C72 3.htp', 'utf-8'));
const notes = data.notes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const bpm = ts.numerator * (4 / ts.denominator);
const tonic = data.keySignatureRoot || 'Bb';

type Note = typeof notes[number];
const absBeatOf = (n: Note) => n.measureIndex * bpm + (n.beat - 1);
const beatMap = new Map<number, Note[]>();
for (const n of notes) {
    const ab = absBeatOf(n);
    if (!beatMap.has(ab)) beatMap.set(ab, []);
    beatMap.get(ab)!.push(n);
}
const sortedBeats = [...beatMap.keys()].sort((a, b) => a - b);

const base = sortedBeats.map(ab => {
    const evNotes = beatMap.get(ab)!;
    return { absBeat: ab, notes: evNotes, mi: evNotes[0].measureIndex, beat: evNotes[0].beat };
});

const allKeys = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const noteNameToPc: Record<string, number> = { 'C':0,'Db':1,'D':2,'Eb':3,'E':4,'F':5,'Gb':6,'G':7,'Ab':8,'A':9,'Bb':10,'B':11 };

// For each pair within 2 measures, check all keys + both modes
for (let j = 1; j < base.length; j++) {
    const bj = base[j];
    for (const K of allKeys) {
        if (K === tonic) continue;
        for (const isMin of [false, true]) {
            const rJ = getRomanAnalysis(bj.notes as any, K, isMin);
            if (!rJ || rJ.roman !== 'I') continue;

            // Found I in K — look back for V/vii° in K
            for (let p = j - 1; p >= 0; p--) {
                if ((bj.absBeat - base[p].absBeat) > bpm * 2 + 0.01) break;
                const rP = getRomanAnalysis(base[p].notes as any, K, isMin);
                const prevR = String(rP?.roman || '');
                if (!/^(V|vii[°o])/.test(prevR)) continue;

                const interval = ((noteNameToPc[K] - noteNameToPc[tonic]) + 12) % 12;
                const labels: Record<number, string> = {0:'I',1:'♭II',2:'II',3:'♭III',4:'III',5:'IV',6:'♭V',7:'V',8:'♭VI',9:'VI',10:'♭VII',11:'VII'};
                const deg = labels[interval];

                // This pair would label base[p] as prevR/deg
                console.log(`PAIR: prev=m${base[p].mi}b${base[p].beat}(ab=${base[p].absBeat}) j=m${bj.mi}b${bj.beat}(ab=${bj.absBeat}) K=${K}${isMin?'m':''} prevInK="${prevR}" jInK="I" → would set display "${prevR}/${deg}"`);
                // Show which notes are in the window between p and j
                console.log(`   Window: ${base.slice(p, j + 1).map(b => `m${b.mi}b${b.beat}`).join(' → ')}`);
            }
        }
    }
}
