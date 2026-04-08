import fs from 'fs';
import {
  applyHarmonyRules,
  calculateNoteBeats,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

const filePath = 'tests/Dubois 2 p.11.json';
const fx = JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;

const timeSignature = fx.timeSignature || { numerator: 4, denominator: 4 };
const timeSignatureChanges = Array.isArray(fx.timeSignatureChanges) ? fx.timeSignatureChanges : [];
const keyTonic = String(fx.keySignatureRoot || 'C');
const isMinor = !!fx.isMinorMode;

const notes = calculateNoteBeats(Array.isArray(fx.notes) ? fx.notes : [], timeSignature, timeSignatureChanges);
const keySig = getKeySignature(keyTonic, isMinor ? 'Minor' : 'Major');

const analysis = applyHarmonyRules(
  notes as any,
  keySig as any,
  keyTonic,
  isMinor,
  Array.isArray(fx.analysisContexts) ? fx.analysisContexts : [],
  timeSignature
);

const timeline = getActiveNotesTimeline(notes as any, timeSignature, timeSignatureChanges);

const chordAt = (absBeat: number) => {
  let best: any = null;
  for (const ev of (timeline || [])) {
    if (!ev || typeof ev.absBeat !== 'number') continue;
    if (ev.absBeat <= absBeat + 1e-6) best = ev;
    else break;
  }
  return (best?.notes || []) as any[];
};

const pcSig = (chord: any[]) => {
  const pcs = chord
    .filter(n => n && !n.isRest && Number.isFinite(n.midi))
    .map(n => ((Number(n.midi) % 12) + 12) % 12);
  return Array.from(new Set(pcs)).sort((a, b) => a - b).join(',');
};

console.log({ filePath, keyTonic, isMinor, timeSignature });
console.log('autoHarmonyLabelOverrides:', (analysis as any)?.autoHarmonyLabelOverrides?.length ?? 0);
console.log('inferredAnalysisContexts:', (analysis as any)?.inferredAnalysisContexts?.length ?? 0);

const overrides = Array.isArray((analysis as any)?.autoHarmonyLabelOverrides)
  ? ((analysis as any).autoHarmonyLabelOverrides as any[])
  : [];

for (const ov of overrides) {
  const abs = Number(ov?.absBeat);
  if (!Number.isFinite(abs)) continue;
  const chord = chordAt(abs);
  const base = getRomanAnalysis(chord as any, keyTonic, isMinor);
  console.log(`\n@abs=${abs} pcs=${pcSig(chord)}`);
  console.log(' base', { roman: base?.roman, figures: base?.figures });
  console.log(' ov  ', { roman: ov?.roman, romanDisplay: ov?.romanDisplay, figures: ov?.figures, symbol: ov?.symbol });
}
