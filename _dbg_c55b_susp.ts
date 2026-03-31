import { applyHarmonyRules, getKeySignature, calculateNoteBeats, getActiveNotesTimeline } from './src/utils/musicTheory';
import { TICKS_PER_QUARTER } from './src/constants';
import * as fs from 'fs';

const d = JSON.parse(fs.readFileSync('tests/Delamont C55 b.htp', 'utf8'));
const root = d.keySignatureRoot || 'G';
const tonic = d.keyTonic || root;
const minor = d.isMinorMode || false;
const ks = getKeySignature(root, minor ? 'Minor' : 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const bpm = ts.numerator * (4 / ts.denominator);
const notes = calculateNoteBeats(d.notes, ts, d.timeSignatureChanges || []);
const result = applyHarmonyRules(notes, ks, tonic, minor, d.analysisContexts || [], ts, [], [], []);
const analyzed = result.analyzedNotes || [];

// Show suspension payloads for m1
const m1notes = analyzed.filter((n: any) => n.measureIndex === 0 && !n.isRest);
for (const n of m1notes) {
    if (n.isSuspension || n.isAppoggiatura) {
        console.log(`${n.pitch}${n.octave} v${n.voice} b${n.beat} susp=${JSON.stringify(n.isSuspension)} app=${n.isAppoggiatura}`);
    }
}

console.log('\n--- Timeline beat-by-beat for m1 ---');
const timeline = getActiveNotesTimeline(analyzed, ts, d.timeSignatureChanges || []);
for (const ev of timeline) {
    const ab = Number(ev.absBeat);
    if (ab < 0 || ab >= bpm) continue; // m1 only
    const noteList = (ev.notes || []).map((n: any) => {
        const flags: string[] = [];
        if (n.isPassing) flags.push('P');
        if (n.isNeighbor) flags.push('N');
        if (n.isSuspension) flags.push('S');
        if (n.isAppoggiatura) flags.push('App');
        return `${n.pitch}${n.accidental || ''}${n.octave}v${n.voice}${flags.length ? '[' + flags.join(',') + ']' : ''}`;
    }).join(' ');
    console.log(`ab=${ab} beat=${(ab % bpm) + 1} notes=[${noteList}]`);
}
