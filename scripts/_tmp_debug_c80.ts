import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline, getRomanAnalysis, substituteSuspensionsForAnalysis, getChordSymbol } from '../src/utils/musicTheory';
import { TICKS_PER_QUARTER } from '../src/constants';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('tests/Delamont C 80 2c.htp', 'utf8'));
const notes = data.notes || data.rawNotes || [];
const keySignature = getKeySignature(data.keySignatureRoot, data.isMinorMode ? 'Minor' : 'Major');

const result = applyHarmonyRules(
  notes as any,
  keySignature as any,
  data.keySignatureRoot,
  data.isMinorMode,
  data.analysisContexts || [],
  data.timeSignature,
  [],
  data.ornamentOverrides || [],
  data.harmonyOverrides || [],
);

const timeline = getActiveNotesTimeline(result.analyzedNotes as any, data.timeSignature);

console.log('Key:', data.keySignatureRoot, 'Minor:', data.isMinorMode);
console.log('\nTimeline beats around m2b1 (absBeat 4-5):');

for (const ev of timeline) {
  if (ev.absBeat < 3 || ev.absBeat > 6) continue;
  const substNotes = substituteSuspensionsForAnalysis(ev.notes as any, ev.absBeat);
  const ra = getRomanAnalysis(substNotes as any, data.keySignatureRoot, data.isMinorMode);
  const sym = getChordSymbol(ev.notes as any, keySignature, data.keySignatureRoot);
  const pcs = [...new Set((ev.notes as any[]).filter((n:any)=>n&&!n.isRest&&Number.isFinite(n.midi)).map((n:any)=>n.midi%12))];
  const substPcs = [...new Set((substNotes as any[]).filter((n:any)=>n&&!n.isRest&&Number.isFinite(n.midi)).map((n:any)=>n.midi%12))];
  console.log(`  beat=${ev.absBeat} roman=${ra?.roman} figs=${JSON.stringify(ra?.figures)} sym=${sym} pcs=[${pcs}] substPcs=[${substPcs}]`);
  // Show individual notes
  (ev.notes as any[]).filter((n:any)=>n&&!n.isRest).forEach((n:any) => {
    const tag = (substNotes as any[]).find((s:any)=>s?.id===n.id) ? '' : ' [EXCLUDED]';
    console.log(`    midi=${n.midi} pc=${n.midi%12} pitch=${n.pitch}${n.octave} v=${n.voice}${tag}`);
  });
}
