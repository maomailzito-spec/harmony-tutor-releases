import { getRomanAnalysis, getActiveNotesTimeline, calculateNoteBeats, applyHarmonyRules, getKeySignature, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS } from './src/utils/musicTheory';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('./tests/Delamont 44.htp', 'utf-8'));
const rawNotes = data.notes || data.rawNotes || [];
const keyRoot = data.keySignatureRoot || 'G';
const isMinor = !!data.isMinorMode;
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const tonic = keyRoot;
console.log('keyRoot:', keyRoot, 'isMinor:', isMinor, 'tonic:', tonic);

// Full pipeline - just notes
const notes = calculateNoteBeats(rawNotes, ts, []);
const timeline = getActiveNotesTimeline(notes, ts, []);
const bpm = ts.numerator * (4 / ts.denominator);

console.log('\n--- RAW (no ornament pipeline) ---');
for (const ev of timeline) {
    const ab = ev.absBeat;
    if (ab >= 8 && ab < 12) {
        const notesHere = (ev as any).notes || [];
        const mi = Math.floor(ab / bpm);
        const beat = (ab % bpm) + 1;
        const r = getRomanAnalysis(notesHere, tonic, isMinor);
        const figs = computeFiguredBassFromNotes(notesHere, FIGURED_BASS_UI_OPTIONS).figures;
        console.log(`  m${mi+1} b${beat} (abs=${ab}): roman=${r?.roman}  L2figs=${JSON.stringify(r?.figures)}  directFigs=${JSON.stringify(figs)}  notes=${notesHere.map((n:any)=>n.pitch+n.octave+(n.explicitAccidental?'('+n.explicitAccidental+')':'')).join(',')}`);
    }
}

console.log('\n--- WITH ornament pipeline ---');
const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const result = applyHarmonyRules(rawNotes, keySig, tonic, isMinor, [], ts, [], {}, {});
const tlNotes2 = calculateNoteBeats(result.analyzedNotes, ts, []);
const timeline2 = getActiveNotesTimeline(tlNotes2, ts, []);
for (const ev of timeline2) {
    const ab = ev.absBeat;
    if (ab >= 8 && ab < 12) {
        const notesHere = (ev as any).notes || [];
        const mi = Math.floor(ab / bpm);
        const beat = (ab % bpm) + 1;
        const r = getRomanAnalysis(notesHere, tonic, isMinor);
        console.log(`  m${mi+1} b${beat} (abs=${ab}): roman=${r?.roman}  figs=${JSON.stringify(r?.figures)}  notes=${notesHere.map((n:any)=>n.pitch+n.octave+(n.explicitAccidental?'('+n.explicitAccidental+')':'')).join(',')}`);
    }
}
