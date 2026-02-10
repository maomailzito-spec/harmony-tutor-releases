import fs from 'node:fs';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getPitchClassesForDebug,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

const file = './tests/Dubois n3 p12.htp';
const fx = JSON.parse(fs.readFileSync(file, 'utf8')) as any;

const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);

const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
const res: any = applyHarmonyRules(
  fx.notes,
  ks as any,
  fx.keySignatureRoot,
  fx.isMinorMode,
  fx.analysisContexts || [],
  fx.timeSignature,
);

const inferred = (res.inferredAnalysisContexts || []) as any[];
const analyzed = (res.analyzedNotes || fx.notes) as any[];
const timeline = getActiveNotesTimeline(analyzed as any, fx.timeSignature, fx.timeSignatureChanges || []);

const ctxAbs = (c: any) => {
  const a = Number(c?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(c?.measureIndex ?? 0);
  return (Number.isFinite(mi) ? mi : 0) * beatsPerMeasure;
};

const ctxAt = (absBeat: number) => {
  const applicable = ([...(fx.analysisContexts || []), ...(inferred || [])] as any[])
    .filter((c) => ctxAbs(c) <= absBeat + 1e-6)
    .sort((a, b) => ctxAbs(b) - ctxAbs(a))[0];
  return applicable
    ? { tonic: String(applicable.newTonic), isMinor: !!applicable.newIsMinor, absBeat: ctxAbs(applicable) }
    : { tonic: String(fx.keySignatureRoot), isMinor: !!fx.isMinorMode, absBeat: -1 };
};

const evAt = (absBeat: number) => timeline.find((e: any) => Math.abs(Number(e?.absBeat) - absBeat) < 1e-6);
const evsIn = (a: number, b: number) => timeline.filter((e: any) => Number(e?.absBeat) >= a - 1e-6 && Number(e?.absBeat) <= b + 1e-6);

const summarizeEv = (ev: any) => {
  const absBeat = Number(ev?.absBeat);
  const ctx = ctxAt(absBeat);
  const pcs = getPitchClassesForDebug(ev?.notes || []);
  const romanCtx = getRomanAnalysis(ev?.notes || [], ctx.tonic, ctx.isMinor)?.roman || '';
  return {
    absBeat,
    m: Math.floor(absBeat / beatsPerMeasure) + 1,
    beat: Number(ev?.beat),
    ctx,
    pcs,
    romanCtx,
  };
};

console.log('timeSignature', fx.timeSignature, 'beatsPerMeasure', beatsPerMeasure);
console.log('inferredContexts', inferred.map((c) => ({ absBeat: c.absBeat, tonic: c.newTonic, minor: !!c.newIsMinor, score: (c as any).score ?? null })));

const focusStarts = new Set<number>([86, 102, 112]);

for (const c of inferred) {
  const ab = Number(c.absBeat);
  if (!focusStarts.has(ab)) continue;
  const tonic = String(c.newTonic);
  const isMinor = !!c.newIsMinor;
  const winA = ab - 4;
  const winB = ab + 4;
  console.log('\n=== context start', { absBeat: ab, tonic, isMinor, score: (c as any).score ?? null }, '===');
  for (const ev of evsIn(winA, winB)) {
    const s = summarizeEv(ev);
    const romanInThisKey = getRomanAnalysis((ev as any).notes || [], tonic, isMinor)?.roman || '';
    console.log({ ...s, romanInNewKey: romanInThisKey });
  }
}

// Also show the event exactly at expected return 108.
try {
  for (const target of [108, 110, 112]) {
    const ev = evAt(target);
    if (ev) {
      const ctx = ctxAt(target);
      console.log(`\n@absBeat=${target}`, {
        ctx,
        pcs: getPitchClassesForDebug(ev.notes || []),
        romanCtx: getRomanAnalysis(ev.notes || [], ctx.tonic, ctx.isMinor)?.roman || '',
        romanBb: getRomanAnalysis(ev.notes || [], 'Bb', false)?.roman || '',
        romanGb: getRomanAnalysis(ev.notes || [], 'Gb', false)?.roman || '',
      });
    } else {
      console.log(`\n@absBeat=${target}`, 'NO EVENT');
    }
  }
} catch {
  // ignore
}
