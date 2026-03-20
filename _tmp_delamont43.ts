import { getRomanAnalysis, getActiveNotesTimeline, calculateNoteBeats } from './src/utils/musicTheory';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('./tests/Delamont 43.htp', 'utf-8'));
const rawNotes = data.notes || data.rawNotes || [];
const keyRoot = data.keySignatureRoot || 'C';
const isMinor = !!data.isMinorMode;
const ts = data.timeSignature || { numerator: 4, denominator: 4 };

// Resolve actual tonic (same as GrandStaffEditor)
const relativeMinors: Record<string, string> = {
    'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#',
    'F#': 'D#', 'Gb': 'Eb', 'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F',
    'Db': 'Bb', 'Cb': 'Ab',
};
const tonic = isMinor ? (relativeMinors[keyRoot] || 'A') : keyRoot;
console.log('keyRoot:', keyRoot, 'isMinor:', isMinor, 'actualTonic:', tonic);

const notes = calculateNoteBeats(rawNotes, ts, []);
const timeline = getActiveNotesTimeline(notes, ts, []);
const bpm = ts.numerator * (4 / ts.denominator);

for (const ev of timeline) {
    const ab = ev.absBeat;
    if (Math.abs(ab - 2) < 0.01 || Math.abs(ab - 7) < 0.01) {
        const notesHere = (ev as any).notes || [];
        const mi = Math.floor(ab / bpm);
        const beat = (ab % bpm) + 1;
        console.log(`\n=== m${mi+1} b${beat} (absBeat=${ab}) ===`);
        for (const n of notesHere) {
            const a = n as any;
            console.log(`  v=${a.voice} ${a.pitch}${a.octave} acc=${a.accidental} expl=${a.explicitAccidental} midi=${a.midi}`);
        }
        const r = getRomanAnalysis(notesHere, tonic, isMinor);
        console.log(`  => ${JSON.stringify(r)}`);
    }
}
