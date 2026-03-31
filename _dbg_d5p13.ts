import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline, substituteSuspensionsForAnalysis } from './src/utils/musicTheory';
import { applyStatelessRules } from './src/utils/harmonyPostRules';
import * as fs from 'fs';

const fx = JSON.parse(fs.readFileSync('./tests/Dubois n5 p 13.json', 'utf8'));
if (!fx.keyTonic) fx.keyTonic = fx.keySignatureRoot;
const ks = getKeySignature(fx.keySignatureRoot, 'Major');
const result: any = applyHarmonyRules(
  fx.notes, ks as any, fx.keyTonic, false,
  fx.analysisContexts || [], fx.timeSignature,
  fx.doubleBarlineMeasures || [],
  fx.ornamentOverrides || [],
  fx.harmonyOverrides || [],
);

const contexts = result.inferredAnalysisContexts || [];
console.log('=== Inferred contexts near m22-m25 ===');
for (const c of contexts) {
  if (c.absBeat >= 60 && c.absBeat <= 78)
    console.log(`  ab=${c.absBeat} (m${Math.floor(c.absBeat/3)+1}) → ${c.newTonic} ${c.newIsMinor?'min':'maj'} score=${c.score}`);
}

const rawTimeline = getActiveNotesTimeline(result.analyzedNotes as any, fx.timeSignature as any);
const timeline: typeof rawTimeline = [];
for (const ev of rawTimeline) {
  const idx = timeline.findIndex(t => Math.abs(t.absBeat - ev.absBeat) < 1e-4);
  if (idx === -1) timeline.push(ev);
  else if ((ev.notes || []).length > (timeline[idx].notes || []).length) timeline[idx] = ev;
}

console.log('\n=== m21-m26 analysis ===');
for (const ev of timeline) {
  if (ev.absBeat < 60 || ev.absBeat > 78) continue;
  const m = Math.floor(ev.absBeat / 3) + 1;
  const b = (ev.absBeat % 3) + 1;
  const notes = (ev.notes || []) as any[];
  const noteStr = notes.map((n: any) => n.pitch + (n.accidental && n.accidental !== 'natural' ? '(' + n.accidental + ')' : '') + n.octave).join(' ');

  const ctx = [...(fx.analysisContexts || []), ...contexts.filter((c:any) => typeof c.score === 'number' && c.score >= 12)]
    .filter(c => (c.absBeat ?? c.startAbsBeat ?? 0) <= ev.absBeat + 1e-6)
    .sort((a: any, b: any) => ((b.absBeat ?? b.startAbsBeat ?? 0) - (a.absBeat ?? a.startAbsBeat ?? 0)))[0];
  const tonic = ctx ? ctx.newTonic : fx.keyTonic;
  const isMinor = ctx ? ctx.newIsMinor : fx.isMinorMode;

  const substNotes = substituteSuspensionsForAnalysis(notes as any, ev.absBeat);
  let lowest: any = null;
  for (const n of (substNotes || [])) {
    if (!n || n.isRest) continue;
    const midi = Number(n.midi);
    if (!Number.isFinite(midi)) continue;
    if (!lowest || midi < lowest.midi) lowest = { midi, pc: ((midi % 12) + 12) % 12 };
  }
  const stateless = applyStatelessRules({
    analysisNotesForNaming: substNotes as any, analysisNotes: substNotes as any,
    fullNotes: notes as any, contextTonic: tonic, contextIsMinor: isMinor,
    bassPc: lowest?.pc ?? null, absBeat: ev.absBeat,
    autoOverrideByAbsBeat: new Map(), overrideByAbsBeat: new Map(),
  });
  console.log(`m${m} b${b} (ab=${ev.absBeat}) ctx=${tonic}${isMinor?'m':'M'} → ${stateless.roman} | ${noteStr}`);
}
