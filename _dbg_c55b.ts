import { applyHarmonyRules, getKeySignature, calculateNoteBeats, getRomanAnalysis, formatFiguredBass } from './src/utils/musicTheory';
import * as fs from 'fs';

const d = JSON.parse(fs.readFileSync('tests/Delamont C55 b.htp', 'utf8'));
const root = d.keySignatureRoot || 'C';
const tonic = d.keyTonic || root;
const minor = d.isMinorMode || false;
const ks = getKeySignature(root, minor ? 'Minor' : 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const notes = calculateNoteBeats(d.notes, ts, d.timeSignatureChanges || []);
const result = applyHarmonyRules(notes, ks, tonic, minor, d.analysisContexts || [], ts, [], [], []);
const analyzed = result.analyzedNotes || [];

for (let mi = 0; mi < 6; mi++) {
    const mN = analyzed.filter((n: any) => n.measureIndex === mi && !n.isRest);
    const beats = [...new Set(mN.map((n: any) => n.beat))].sort((a: number, b: number) => a - b);
    for (const b of beats) {
        const bn = mN.filter((n: any) => Math.abs(n.beat - b) < 0.1);
        const pitches = bn.map((n: any) => {
            const flags: string[] = [];
            if (n.isPassing) flags.push('P');
            if (n.isNeighbor) flags.push('N');
            if (n.isSuspension) flags.push('S');
            if (n.isAppoggiatura) flags.push('App');
            if (n.isAnticipation) flags.push('Ant');
            return `${n.pitch}${n.octave}v${n.voice}${flags.length ? '[' + flags.join(',') + ']' : ''}`;
        }).join(' ');
        const structural = bn.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape);
        const r = getRomanAnalysis(structural, tonic, minor);
        console.log(`m${mi + 1} b${b}  ${pitches}  roman=${r?.roman || '?'}  fig=${JSON.stringify(r?.figures || [])}`);
    }
    console.log('---');
}
