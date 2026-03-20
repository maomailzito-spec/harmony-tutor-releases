import { getRomanAnalysis, getActiveNotesTimeline, calculateNoteBeats, applyHarmonyRules, getKeySignature } from './src/utils/musicTheory';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('./tests/Delamont 44.htp', 'utf-8'));
const rawNotes = data.notes || data.rawNotes || [];
const keyRoot = data.keySignatureRoot || 'G';
const isMinor = !!data.isMinorMode;
const ts = data.timeSignature || { numerator: 4, denominator: 4 };

const tonic = isMinor ? 'E' : keyRoot; // G major → tonic G
console.log('keyRoot:', keyRoot, 'isMinor:', isMinor, 'tonic:', tonic);

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const result = applyHarmonyRules(rawNotes, keySig, tonic, isMinor, [], ts, [], {}, {});
const tlNotes = calculateNoteBeats(result.analyzedNotes, ts, []);
const timeline = getActiveNotesTimeline(tlNotes, ts, []);
const bpm = ts.numerator * (4 / ts.denominator);

// m3 = measureIndex 2, beats 1-4 → absBeat 8..11
for (const ev of timeline) {
    const ab = ev.absBeat;
    if (ab >= 8 && ab < 12) {
        const notes = (ev as any).notes || [];
        const mi = Math.floor(ab / bpm);
        const beat = (ab % bpm) + 1;
        console.log(`\n=== m${mi+1} b${beat} (absBeat=${ab}) ===`);
        for (const n of notes) {
            const a = n as any;
            console.log(`  v=${a.voice} ${a.pitch}${a.octave} acc=${a.accidental} expl=${a.explicitAccidental} midi=${a.midi} isApp=${!!a.isAppoggiatura} isPass=${!!a.isPassing}`);
        }
        const r = getRomanAnalysis(notes, tonic, isMinor);
        console.log(`  roman=${r?.roman}  figures=${JSON.stringify(r?.figures)}`);
    }
}
