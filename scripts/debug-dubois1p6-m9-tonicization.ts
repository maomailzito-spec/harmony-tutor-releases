import fs from 'node:fs';
import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

type AnyObj = Record<string, any>;

const readJson = (path: string): AnyObj => JSON.parse(fs.readFileSync(path, 'utf8'));

const proj = readJson('./tests/Dubois 1 p.6.json');
const notes = (proj.notes || []) as any[];
const timeSignature = proj.timeSignature || { numerator: 4, denominator: 4 };
const tonic = String(proj.keySignatureRoot || 'C');
const isMinor = Boolean(proj.isMinorMode);

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const res: any = applyHarmonyRules(
  notes as any,
  keySig as any,
  tonic,
  isMinor,
  (proj.analysisContexts || []) as any,
  timeSignature as any,
);

const analyzed = (res.analyzedNotes || notes) as any[];
const inferred = (res.inferredAnalysisContexts || []) as any[];

const beatsPerMeas = Number(timeSignature.numerator) * (4 / Number(timeSignature.denominator));
const ctxAbs = (c: any): number => {
  const a = Number(c?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(c?.measureIndex ?? 0);
  return (Number.isFinite(mi) ? mi : 0) * beatsPerMeas;
};

const contexts = [...inferred, ...(proj.analysisContexts || [])];
const ctxAt = (absBeat: number) => {
  const c = contexts
    .filter((x: any) => ctxAbs(x) <= absBeat + 1e-6)
    .sort((a: any, b: any) => ctxAbs(b) - ctxAbs(a))[0];
  if (!c) return { tonic, isMinor, abs: -1, score: null as any };
  return {
    tonic: String(c.newTonic),
    isMinor: Boolean(c.newIsMinor),
    abs: ctxAbs(c),
    score: (c as any).score ?? null,
  };
};

const tl = getActiveNotesTimeline(analyzed as any, timeSignature as any, proj.timeSignatureChanges || []);

// Measures 9-12 (1-based) => 0-based 8..11
const startMi = 8;
const endMi = 11;

const evs = tl.filter((ev: any) => {
  const mi = Number(ev?.measureIndex);
  return Number.isFinite(mi) && mi >= startMi && mi <= endMi;
});

const simplifyRoman = (x: any) => ({
  roman: String(x?.roman || ''),
  figures: Array.isArray(x?.figures) ? x.figures : [],
});

console.log('inferredContextsNear',
  inferred
    .map((c: any) => ({ abs: ctxAbs(c), tonic: c.newTonic, minor: Boolean(c.newIsMinor), score: (c as any).score ?? null, label: c.label || '' }))
    .filter((c: any) => c.abs >= startMi * beatsPerMeas - beatsPerMeas && c.abs <= endMi * beatsPerMeas + beatsPerMeas * 2)
    .sort((a: any, b: any) => a.abs - b.abs)
);

for (const ev of evs) {
  const absBeat = Number(ev.absBeat);
  const ctx = ctxAt(absBeat);
  const notesTxt = (ev.notes || [])
    .filter((n: any) => n && n.isRest === false)
    .map((n: any) => ({
      v: Number(n.voice ?? 0),
      p: String(n.pitch) + String(n.octave),
      acc: (n as any).explicitAccidental ?? null,
      midi: Number(n.midi),
      ni: Number(n.noteIndex),
    }))
    .sort((a: any, b: any) => a.v - b.v || a.midi - b.midi);

  const romanCtx = simplifyRoman(getRomanAnalysis(ev.notes || [], ctx.tonic, ctx.isMinor));
  const romanBm = simplifyRoman(getRomanAnalysis(ev.notes || [], 'B', true));
  const romanFSharp = simplifyRoman(getRomanAnalysis(ev.notes || [], 'F#', false));
  const romanD = simplifyRoman(getRomanAnalysis(ev.notes || [], 'D', false));

  console.log(
    JSON.stringify({
      absBeat,
      measure: Number(ev.measureIndex) + 1,
      beat: ev.beat,
      ctx,
      notes: notesTxt,
      romanCtx,
      romanBm,
      romanFSharp,
      romanD,
    }),
  );
}
