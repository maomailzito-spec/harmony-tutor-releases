import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline } from '../src/utils/musicTheory';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C 80 2c.htp', 'utf8'));
const notes = data.notes || data.rawNotes || [];

// The app uses relativeMinors: Bb -> G for minor mode
const currentTonic = 'G';
const isMinorMode = true;

const ks = getKeySignature(data.keySignatureRoot, 'Minor');
const result = applyHarmonyRules(
  notes as any, ks as any, currentTonic, isMinorMode,
  data.analysisContexts || [], data.timeSignature, [],
  data.ornamentOverrides || [], data.harmonyOverrides || [],
);
const tl = getActiveNotesTimeline(result.analyzedNotes as any, data.timeSignature);

// Check beats 10-11 (m3b3-b4)
for (const ev of tl) {
  if (ev.absBeat < 9.5 || ev.absBeat > 11.5) continue;
  console.log(`\n=== beat ${ev.absBeat} ===`);
  for (const n of ev.notes as any[]) {
    if (!n || n.isRest) continue;
    const susp = (n as any).isSuspension;
    const suspInfo = susp
      ? ` SUSP from=${susp.fromAbsBeat} resMidi=${susp.resolvedMidi}`
      : '';
    const flags = [
      n.isNeighbor ? 'neighbor' : '',
      n.isAnticipation ? 'anticipation' : '',
      n.isAppoggiatura ? 'appoggiatura' : '',
      n.isPassingTone ? 'passing' : '',
      n.isPassing ? 'passing' : '',
      n.isEscape ? 'escape' : '',
    ].filter(Boolean).join(',');
    console.log(`  midi=${n.midi} pc=${n.midi % 12} pitch=${n.pitch}${n.octave} v=${n.voice} dur=${n.duration}${suspInfo}${flags ? ' FLAGS=' + flags : ''}`);
  }
}
