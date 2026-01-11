import fs from 'node:fs';
import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
} from '../src/utils/musicTheory';

const FILE = '/Users/Erminio/Desktop/Harmony Implementazioni/verifiche/Ritardi/Dubuois mis 5.json';
const fx = JSON.parse(fs.readFileSync(FILE, 'utf8')) as any;

const keySignature = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
const result = applyHarmonyRules(
  fx.notes,
  keySignature as any,
  fx.keySignatureRoot,
  fx.isMinorMode,
  fx.analysisContexts || [],
  fx.timeSignature,
);

const analyzedNotes = (result as any).analyzedNotes as any[];
const timeline = getActiveNotesTimeline(analyzedNotes as any, fx.timeSignature);

const absBeat = 8; // suspension onset in the fixture
const ev = timeline.find((e) => Math.abs((e as any).absBeat - absBeat) < 1e-6);
if (!ev) {
  console.log('No event at absBeat=8');
  process.exit(1);
}

const suspHere = analyzedNotes.filter((n) => n?.isSuspension && Math.abs((n.isSuspension?.fromAbsBeat ?? -999) - absBeat) < 1e-6);
console.log('suspHere:', suspHere.map((n) => ({ id: n.id, voice: n.voice, pitch: `${n.pitch}${n.octave}`, susp: n.isSuspension })));

// What the label engine would compute from notes at this event
const ra = getRomanAnalysis(ev.notes as any, fx.keySignatureRoot, fx.isMinorMode);
const figures = computeFiguredBassFromNotes(ev.notes as any, FIGURED_BASS_UI_OPTIONS).figures;
console.log('romanAnalysis@8:', ra);
console.log('figuredBass@8:', figures);

// Show whether any note has fromAbsBeat=8 but is not in ev.notes (possible if timeline differs)
const evIds = new Set((ev.notes || []).map((n: any) => n.id));
const missing = suspHere.filter((n) => !evIds.has(n.id));
console.log('susp notes missing from timeline@8:', missing.map((n) => n.id));
