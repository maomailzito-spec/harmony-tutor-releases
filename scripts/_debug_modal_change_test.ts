/**
 * Debug: Modal change test.htp — full pipeline analysis
 *
 * Usage: npx tsx scripts/_debug_modal_change_test.ts
 */
import { getRomanAnalysis, getActiveNotesTimeline, calculateNoteBeats, identifyChordCandidates } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('./tests/Modal change test.htp', 'utf-8'));
const rawNotes = data.notes || data.rawNotes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const keyRoot = data.keySignatureRoot || 'C';
const isMinor = data.isMinorMode || false;
const tonic = keyRoot; // in major, keySignatureRoot IS the tonic

console.log(`keyRoot: ${keyRoot}  isMinor: ${isMinor}  tonic: ${tonic}\n`);

const notes = calculateNoteBeats(rawNotes, ts, []);
const timeline = getActiveNotesTimeline(notes, ts, []);
const bpm = ts.numerator * (4 / ts.denominator);

console.log('── RAW getRomanAnalysis (no ornament pipeline) ──');
for (const ev of timeline) {
  const ab = (ev as any).absBeat;
  const notesHere = (ev as any).notes || [];
  if (!notesHere.length) continue;
  const mi = Math.floor(ab / bpm);
  const beat = (ab % bpm) + 1;
  
  const r = getRomanAnalysis(notesHere as any, tonic, isMinor);
  const cands = identifyChordCandidates(notesHere as any);
  const top = cands?.[0];
  
  console.log(
    `  m${mi+1} b${beat} (abs=${ab}): roman=${r?.roman || '??'}  ` +
    `figs=[${(r?.figures || []).join(',')}]  ` +
    `chordType="${top?.type || '??'}"  ` +
    `notes=${notesHere.map((n:any)=>n.pitch+n.octave+(n.explicitAccidental?'('+n.explicitAccidental+')':'')).join(',')}`
  );
}
