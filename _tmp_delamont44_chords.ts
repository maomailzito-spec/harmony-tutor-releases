import { identifyChordCandidates, getActiveNotesTimeline, calculateNoteBeats } from './src/utils/musicTheory';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('./tests/Delamont 44.htp', 'utf-8'));
const rawNotes = data.notes || data.rawNotes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const notes = calculateNoteBeats(rawNotes, ts, []);
const timeline = getActiveNotesTimeline(notes, ts, []);
const bpm = ts.numerator * (4 / ts.denominator);

for (const ev of timeline) {
    const ab = ev.absBeat;
    if (ab >= 9 && ab < 12) {
        const notesHere = (ev as any).notes || [];
        const mi = Math.floor(ab / bpm);
        const beat = (ab % bpm) + 1;
        const cands = identifyChordCandidates(notesHere);
        const top = cands?.[0];
        console.log(`m${mi+1} b${beat} (abs=${ab}): top.root=${top?.root?.pitch ?? top?.root} top.type="${top?.type}" notes=${notesHere.map((n:any)=>n.pitch+n.octave+(n.explicitAccidental?'('+n.explicitAccidental+')':'')).join(',')}`);
        if (cands?.length > 1) {
            for (let i = 1; i < Math.min(3, cands.length); i++) {
                console.log(`  alt${i}: root=${cands[i]?.root?.pitch ?? cands[i]?.root} type="${cands[i]?.type}"`);
            }
        }
    }
}
