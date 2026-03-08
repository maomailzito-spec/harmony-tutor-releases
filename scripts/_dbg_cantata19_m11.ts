/**
 * Debug script: trace harmonic analysis for Cantata 19 Bach around m11 b4
 * Run: npx tsx scripts/_dbg_cantata19_m11.ts
 */
import fs from 'node:fs';
import {
  getRomanAnalysis,
  getActiveNotesTimeline,
  calculateNoteBeats,
  applyHarmonyRules,
  identifyChordCandidates,
  getKeySignature,
} from '../src/utils/musicTheory';

const raw = JSON.parse(fs.readFileSync('tests/Cantata 19 bach.json', 'utf8'));
const notes = raw.notes || raw.rawNotes || [];
const tonic = raw.keySignatureRoot || raw.keyTonic || 'Bb';
const isMinor = raw.isMinorMode || false;
const ts = raw.timeSignature || { numerator: 4, denominator: 4 };
const ctxs = raw.analysisContexts || [];

console.log('=== Cantata 19 Bach ===');
console.log('Tonic:', tonic, 'Minor:', isMinor, 'TS:', ts);

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
applyHarmonyRules(notes, keySig, tonic, isMinor, ctxs, ts);
calculateNoteBeats(notes, ts);
const timeline = getActiveNotesTimeline(notes, ts);

// m10-m12: absBeat 36-47
for (const ev of timeline) {
  const ab = (ev as any).absBeat ?? (ev as any).absoluteBeat ?? 0;
  if (ab < 36 || ab > 47) continue;

  const allNotes = ev.notes || [];
  const structural = allNotes.filter(
    (n: any) => !n.isPassing && !n.isAppoggiatura && !n.isNeighbor
  );
  const pcs = [...new Set(structural.map((n: any) => n.midi % 12))].sort();
  const pitches = structural.map((n: any) => `${n.pitch || '?'}${n.octave || ''}`);

  // Analysis in Bb major (home key)
  const romanBb = getRomanAnalysis(structural, tonic, isMinor);
  // Analysis in Dm (suspected false tonicization)
  const romanDm = getRomanAnalysis(structural, 'D', true);
  // Analysis in F major (V region)
  const romanF = getRomanAnalysis(structural, 'F', false);

  // Chord candidates
  const candidates = identifyChordCandidates(structural);

  const mi = Math.floor(ab / 4) + 1;
  const beat = (ab % 4) + 1;

  console.log(
    `m${mi} b${beat} (abs=${ab.toFixed(1)})`,
    `pcs=[${pcs}]`,
    `notes=[${pitches}]`,
    `| Bb: ${romanBb?.roman || '?'}${romanBb?.figures || ''}`,
    `| Dm: ${romanDm?.roman || '?'}${romanDm?.figures || ''}`,
    `| F: ${romanF?.roman || '?'}${romanF?.figures || ''}`,
    `| cand: ${(candidates || []).map((c: any) => `${c.root}${c.type || c.quality || ''}`).join(', ') || 'none'}`
  );
}
