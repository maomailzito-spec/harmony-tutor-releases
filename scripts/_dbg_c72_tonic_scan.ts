/**
 * Debug: simulate what useHarmonyLabels tonicization detector does
 * for Delamont C72 3.htp to find who sets V/IV at m2b4
 */
import { getRomanAnalysis, identifyChordCandidates, applyHarmonyRules } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C72 3.htp', 'utf-8'));
const notes = data.notes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const bpm = ts.numerator * (4 / ts.denominator);
const tonic = data.keySignatureRoot || 'Bb';
const isMinor = Boolean(data.isMinorMode);

// Build chord events (simplified — group notes by absBeat)
type Note = typeof notes[number];
const absBeatOf = (n: Note) => n.measureIndex * bpm + (n.beat - 1);
const beatMap = new Map<number, Note[]>();
for (const n of notes) {
    const ab = absBeatOf(n);
    if (!beatMap.has(ab)) beatMap.set(ab, []);
    beatMap.get(ab)!.push(n);
}
const sortedBeats = [...beatMap.keys()].sort((a, b) => a - b);

console.log('=== Base events ===');
const base: Array<{absBeat: number; notes: Note[]; roman: string; mi: number; beat: number}> = [];
for (const ab of sortedBeats) {
    const evNotes = beatMap.get(ab)!;
    const mi = evNotes[0].measureIndex;
    const beat = evNotes[0].beat;
    const r = getRomanAnalysis(evNotes as any, tonic, isMinor);
    const roman = String(r?.roman || '');
    base.push({ absBeat: ab, notes: evNotes, roman, mi, beat });
    console.log(`  ab=${ab} m${mi}b${beat} roman="${roman}" notes=[${evNotes.map(n => n.pitch + (n.accidental !== 'natural' ? n.accidental : '') + n.midi).join(',')}]`);
}

console.log('\n=== Tonicization scan (simulating useHarmonyLabels) ===');
const allKeys = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

for (let j = 1; j < base.length; j++) {
    const bj = base[j];
    const bPrev = base[j - 1];
    
    for (const K of allKeys) {
        if (K === tonic) continue;
        const rJ = getRomanAnalysis(bj.notes as any, K, false);
        if (!rJ || rJ.roman !== 'I') continue;
        
        // Check if prev is V in K
        const rPrev = getRomanAnalysis(bPrev.notes as any, K, false);
        const prevRoman = String(rPrev?.roman || '');
        if (!/^(V|vii[°o])/.test(prevRoman)) continue;
        
        console.log(`MATCH: K=${K} j=${j}(m${bj.mi}b${bj.beat}) I_in_${K}="${rJ.roman}" prev=${j-1}(m${bPrev.mi}b${bPrev.beat}) "${prevRoman}" in ${K}`);
        console.log(`  → This would label prev as "${prevRoman}/${computeDegreeLabel(K, tonic)}"`);
    }
}

function computeDegreeLabel(K: string, globalTonic: string): string {
    // Simple degree computation
    const noteNameToPc: Record<string, number> = { 'C':0,'Db':1,'D':2,'Eb':3,'E':4,'F':5,'Gb':6,'G':7,'Ab':8,'A':9,'Bb':10,'B':11 };
    const pc = noteNameToPc[K] ?? 0;
    const tonicPc = noteNameToPc[globalTonic] ?? 0;
    const interval = ((pc - tonicPc) + 12) % 12;
    const labels: Record<number, string> = {0:'I',1:'♭II',2:'II',3:'♭III',4:'III',5:'IV',6:'♭V',7:'V',8:'♭VI',9:'VI',10:'♭VII',11:'VII'};
    return labels[interval] || '?';
}
