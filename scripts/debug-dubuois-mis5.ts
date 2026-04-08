import fs from 'node:fs';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';

const FILE = '/Users/Erminio/Desktop/Harmony Implementazioni/verifiche/Ritardi/Dubuois mis 5.json';
const fx = JSON.parse(fs.readFileSync(FILE, 'utf8')) as any;

const keySignature = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');

const res = applyHarmonyRules(
  fx.notes,
  keySignature as any,
  fx.keySignatureRoot,
  fx.isMinorMode,
  fx.analysisContexts || [],
  fx.timeSignature,
);

const susp = (res as any).analyzedNotes?.filter((n: any) => n && n.isSuspension) ?? [];
const viol = (res as any).violations ?? [];
const conns = (res as any).connections ?? [];

console.log('suspensions:', susp.map((n: any) => ({
  id: n.id,
  m: n.measureIndex,
  beat: n.beat,
  pitch: `${n.pitch}${n.octave}`,
  from: n.isSuspension?.fromAbsBeat,
  to: n.isSuspension?.toAbsBeat,
  type: n.isSuspension?.type,
})));

const nineEight = susp.find((n: any) => String(n?.isSuspension?.type) === '9-8');
if (nineEight) {
  console.log('9-8 raw:', {
    note: { id: nineEight.id, m: nineEight.measureIndex, beat: nineEight.beat, pitch: `${nineEight.pitch}${nineEight.octave}` },
    isSuspension: nineEight.isSuspension,
  });
}

console.log('violations (ritardo/res):', viol
  .filter((v: any) => {
    const rid = String(v?.ruleId || '');
    const d = String(v?.description || '').toLowerCase();
    return rid.includes('R-') || d.includes('rit') || rid.includes('SUS') || rid.includes('RES');
  })
  .map((v: any) => ({ ruleId: v.ruleId, severity: v.severity, desc: v.description, noteIds: v.noteIds }))
);

console.log('connections (susp/res):', conns
  .filter((c: any) => {
    const rid = String(c?.ruleId || '');
    return rid.includes('SUS') || rid.includes('RES') || rid.includes('R-') || rid.includes('ORN');
  })
  .slice(0, 50)
);

// Label-layer sanity check: what does getRomanAnalysis see at the suspension onset?
try {
  const timeline = getActiveNotesTimeline(fx.notes, fx.timeSignature);
  const ev8 = (timeline as any[]).find((ev: any) => Math.abs((ev?.absBeat ?? -1) - 8) < 1e-6);
  if (ev8) {
    console.log('timeline@8 notes:', (ev8.notes || []).map((n: any) => `${n.pitch}${n.octave}`).join(' '));
    console.log('roman@8:', getRomanAnalysis(ev8.notes || [], fx.keySignatureRoot, fx.isMinorMode));
  } else {
    console.log('timeline@8: not found');
  }

  const ev10 = (timeline as any[]).find((ev: any) => (ev?.notes || []).some((n: any) => n?.id === (nineEight?.isSuspension?.resolvedById)));
  if (ev10) {
    console.log('timeline@res notes:', (ev10.notes || []).map((n: any) => `${n.pitch}${n.octave}`).join(' '));
    console.log('roman@res:', getRomanAnalysis(ev10.notes || [], fx.keySignatureRoot, fx.isMinorMode));
  }
} catch (e) {
  console.log('timeline check error:', e);
}
