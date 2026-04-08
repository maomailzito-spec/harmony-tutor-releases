import fs from 'node:fs';
import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

type AnyObj = Record<string, any>;

const file = './tests/Dubois n3 p12.htp';
if (!fs.existsSync(file)) {
  console.log('missing file', file);
  process.exit(0);
}

const fx = JSON.parse(fs.readFileSync(file, 'utf8')) as AnyObj;
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
console.log(
  'inferredContexts',
  inferred.map((c) => ({ absBeat: c.absBeat, tonic: c.newTonic, minor: !!c.newIsMinor, score: c.score || null, label: c.label || '' })),
);

const analyzed = (res.analyzedNotes || fx.notes) as any[];
const tl = getActiveNotesTimeline(analyzed as any, fx.timeSignature, fx.timeSignatureChanges || []);

const ctxAbs = (c: any) => {
  const a = Number(c?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(c?.measureIndex ?? 0);
  return (Number.isFinite(mi) ? mi : 0) * beatsPerMeasure;
};
const ctxAt = (absBeat: number) => {
  const all = [...inferred, ...(fx.analysisContexts || [])];
  const c = all
    .filter((x) => ctxAbs(x) <= absBeat + 1e-6)
    .sort((a, b) => ctxAbs(b) - ctxAbs(a))[0];
  if (!c) return { tonic: fx.keySignatureRoot, isMinor: !!fx.isMinorMode, abs: -1 };
  return { tonic: String(c.newTonic), isMinor: !!c.newIsMinor, abs: ctxAbs(c) };
};

const target = 76;
const evs = tl.filter((ev: any) => Number.isFinite(Number(ev?.absBeat)) && ev.absBeat >= target - 6 && ev.absBeat <= target + 10);

for (const ev of evs) {
  const absBeat = Number(ev.absBeat);
  const m = Math.floor(absBeat / beatsPerMeasure) + 1;
  const beat = ev.beat;
  const ctx = ctxAt(absBeat);
  const notes = (ev.notes || [])
    .filter((n: any) => n && n.isRest === false)
    .map((n: any) => ({
      v: Number(n.voice ?? 0),
      p: String(n.pitch) + String(n.octave),
      acc: (n as any).explicitAccidental ?? null,
      midi: Number(n.midi),
      ni: Number(n.noteIndex),
    }))
    .sort((a: any, b: any) => a.v - b.v || a.midi - b.midi);

  const rCtx = getRomanAnalysis(ev.notes || [], ctx.tonic, ctx.isMinor);
  const rBb = getRomanAnalysis(ev.notes || [], 'Bb', false);
  const rGb = getRomanAnalysis(ev.notes || [], 'Gb', false);
  const rDb = getRomanAnalysis(ev.notes || [], 'Db', false);

  console.log(
    JSON.stringify({
      absBeat,
      measure: m,
      beat,
      ctx,
      notes,
      romanCtx: rCtx,
      romanBb: rBb,
      romanGb: rGb,
      romanDb: rDb,
    }),
  );
}
