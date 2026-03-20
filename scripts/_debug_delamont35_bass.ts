import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const d = JSON.parse(fs.readFileSync('tests/Delamont C 35 4 .htp', 'utf8'));
const ks = getKeySignature(d.keySignatureRoot || 'F', 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const res = applyHarmonyRules(
    d.notes, ks, d.keySignatureRoot, !!d.isMinorMode,
    d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
    d.ornamentOverrides || []
);
const notes = ((res as any).analyzedNotes || res) as any[];

// Show m2 and m3 ALL voices
console.log('=== m2 + m3 all voices ===');
const m23 = notes.filter((n: any) => n.measureIndex === 1 || n.measureIndex === 2);
for (const n of m23.sort((a: any, b: any) => (a.measureIndex * 10 + a.beat) - (b.measureIndex * 10 + b.beat) || a.voice - b.voice)) {
    const marks = [
        n.isPassing && 'P', n.isNeighbor && 'N', n.isAppoggiatura && 'App',
        n.isEscape && 'Esc', n.isSuspension && 'Sus', n.isAnticipation && 'Ant'
    ].filter(Boolean).join(',');
    console.log(
        `  m${n.measureIndex + 1} b${n.beat} v${n.voice} ` +
        `${n.pitch}${n.accidental || ''}${n.octave} midi=${n.midi} ` +
        `dur=${n.duration} ${marks || 'structural'}`
    );
}
