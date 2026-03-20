import { getRomanAnalysis, applyHarmonyRules, getActiveNotesTimeline, calculateNoteBeats, getKeySignature } from './src/utils/musicTheory';
import * as fs from 'fs';

const fx = JSON.parse(fs.readFileSync('./scripts/fixtures/appoggiature-b-on-4.json', 'utf-8'));
const keyTonic = fx.keyTonic || 'C';
const isMinor = !!fx.isMinor;
const ts = fx.timeSignature || { numerator: 4, denominator: 4 };
const keySig = getKeySignature(keyTonic, isMinor ? 'Minor' : 'Major');
const result = applyHarmonyRules(fx.notes, keySig, keyTonic, isMinor, [], ts, [], {}, {});
const tlNotes = calculateNoteBeats(result.analyzedNotes, ts, []);
const timeline = getActiveNotesTimeline(tlNotes, ts, []);
for (const ev of timeline) {
    if (Math.abs(ev.absBeat - 3) < 0.01) {
        const notes = (ev as any).notes || [];
        console.log('Notes at absBeat=3:');
        for (const n of notes) {
            const a = n as any;
            console.log(`  v=${a.voice} ${a.pitch}${a.octave} midi=${a.midi} isApp=${!!a.isAppoggiatura} isPass=${!!a.isPassing} isNeigh=${!!a.isNeighbor}`);
        }
        const r = getRomanAnalysis(notes, keyTonic, isMinor);
        console.log('Roman:', JSON.stringify(r));
    }
}
