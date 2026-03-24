/**
 * Debug: dump chordEvents for C72 around m2b4
 */
import { applyHarmonyRules } from '../src/utils/musicTheory';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C72 3.htp', 'utf-8'));
const notes = data.notes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const bpm = ts.numerator * (4 / ts.denominator);

const result = applyHarmonyRules(
    notes,
    data.keySignatureRoot || 'Bb',
    data.keySignatureRoot || 'Bb',
    Boolean(data.isMinorMode),
    data.analysisContexts || [],
    ts,
    data.doubleBarlineMeasures,
    data.ornamentOverrides,
    data.harmonyOverrides,
);

// Show analyzed notes around m2
const an = (result as any).analyzedNotes || [];
console.log('=== Analyzed notes m1-m3 ===');
for (const n of an) {
    if (n.measureIndex >= 1 && n.measureIndex <= 3) {
        const flags: string[] = [];
        if (n.isPassing) flags.push('P');
        if (n.isNeighbor) flags.push('N');
        if (n.isAppoggiatura) flags.push('App');
        if (n.isSuspension) flags.push('Sus');
        const ab = n.measureIndex * bpm + (n.beat - 1);
        console.log(`  m${n.measureIndex}b${n.beat} (ab=${ab}) ${n.pitch}${n.accidental !== 'natural' ? n.accidental : ''} midi=${n.midi} v=${n.voice} ${flags.join(',') || 'chord'} dur=${n.duration}`);
    }
}
