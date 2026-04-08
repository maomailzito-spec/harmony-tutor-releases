import fs from 'node:fs';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getPitchClassesForDebug,
  getRomanAnalysis,
  identifyChordCandidates,
  normalizeNotePitchFieldsWithKey,
} from '../src/utils/musicTheory';

const fx = JSON.parse(fs.readFileSync('./tests/Dubois N2 p.7.json', 'utf8')) as any;
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

const ctxAbs = (x: any) => {
  const a = Number(x?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(x?.measureIndex ?? 0);
  return (Number.isFinite(mi) ? mi : 0) * beatsPerMeasure;
};

const ctxAt = (ab: number) => {
  const all = [...(fx.analysisContexts || []), ...(inferred || [])];
  const c = all
    .filter((x: any) => ctxAbs(x) <= ab + 1e-6)
    .sort((a: any, b: any) => ctxAbs(b) - ctxAbs(a))[0];
  return c
    ? { tonic: String(c.newTonic), isMinor: Boolean(c.newIsMinor), absBeat: ctxAbs(c) }
    : { tonic: String(fx.keySignatureRoot), isMinor: Boolean(fx.isMinorMode), absBeat: -1 };
};

const evAt = (ab: number) => timeline.find((e: any) => Math.abs(Number(e?.absBeat) - ab) < 1e-6);

const describeNotes = (notes: any[]) => {
  const active = (notes || []).filter((n) => n && n.isRest === false);
  return active
    .map((n) => ({
      id: String(n.id ?? ''),
      v: n.voice,
      p: String(n.pitch) + String(n.octave),
      midi: n.midi,
      midiPc: Number.isFinite(Number(n.midi)) ? (Number(n.midi) % 12 + 12) % 12 : null,
      noteIndex: n.noteIndex,
      noteIndexPc: Number.isFinite(Number(n.noteIndex)) ? (Number(n.noteIndex) % 12 + 12) % 12 : null,
      acc: n.explicitAccidental ?? null,
      ua: (n as any).userAccidental ?? null,
      a: (n as any).accidental ?? null,
      pass: !!(n as any).isPassing,
      neigh: !!(n as any).isNeighbor,
      ant: !!(n as any).isAnticipation,
      app: !!(n as any).isAppoggiatura,
      esc: !!(n as any).isEscape,
      susp: !!(n as any).isSuspension,
    }))
    .sort((a, b) => (a.v ?? 0) - (b.v ?? 0) || (a.midi ?? 0) - (b.midi ?? 0));
};

const romanIn = (notes: any[], tonic: string, isMinor: boolean) => {
  try {
    const r = getRomanAnalysis(notes as any, tonic, isMinor);
    return { roman: String(r?.roman || ''), figures: (r?.figures || []) as string[] };
  } catch {
    return { roman: '', figures: [] as string[] };
  }
};

const cands = (notes: any[]) => {
  try {
    const cc = identifyChordCandidates(notes as any) as any[];
    const best = Array.isArray(cc) && cc.length ? cc[0] : null;
    return best
      ? {
          rootPc: best?.root?.noteIndex ?? null,
          rootName: best?.root?.name ?? null,
          type: best?.type ?? null,
          matchType: best?.matchType ?? null,
        }
      : null;
  } catch {
    return null;
  }
};

const testKeys: Array<{ tonic: string; isMinor: boolean; label: string }> = [
  { tonic: 'Eb', isMinor: false, label: 'Eb Maj' },
  { tonic: 'G', isMinor: true, label: 'G min' },
  { tonic: 'B', isMinor: true, label: 'B min' },
  { tonic: 'G', isMinor: false, label: 'G Maj' },
];

const show = (uiMeasure: number, beat: number) => {
  const ab = (uiMeasure - 1) * beatsPerMeasure + (beat - 1);
  const ev = evAt(ab);
  if (!ev) {
    console.log('NO_EVENT', { uiMeasure, beat, absBeat: ab });
    return;
  }
  const ctx = ctxAt(ab);
  const pcs = getPitchClassesForDebug(ev.notes || []);
  console.log('\n===', { uiMeasure, beat, absBeat: ab, ctx, pcs }, '===');
  console.log('notes', describeNotes(ev.notes || []));
  console.log('bestCand', cands(ev.notes || []));
  for (const k of testKeys) {
    const r = romanIn(ev.notes || [], k.tonic, k.isMinor);
    console.log(k.label, r);
  }
};

console.log('global', { key: fx.keySignatureRoot, isMinor: fx.isMinorMode, ts: fx.timeSignature });
console.log('inferred', inferred.map((c) => ({ absBeat: c.absBeat, tonic: c.newTonic, minor: Boolean(c.newIsMinor), score: (c as any).score ?? null })));

// Around the spot: m6 b1, m6 b3, m7 b1.
show(6, 1);
show(6, 3);
show(7, 1);

// Report other diminished-confusion spots mentioned: m7 b3, m11 b1.
show(7, 3);
show(11, 1);

// Also show the normalized spelling in the current key signature for reference.
try {
  const ab = (6 - 1) * beatsPerMeasure + (1 - 1);
  const ev = evAt(ab);
  if (ev) {
    const key = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
    const norm = (ev.notes || []).filter((n: any) => n && !n.isRest).map((n: any) => normalizeNotePitchFieldsWithKey(n, key as any));
    console.log('\nnormalized@m6b1', norm.map((n: any) => ({ p: n.pitch, acc: n.explicitAccidental ?? null, midi: n.midi, noteIndex: n.noteIndex })));
  }
} catch {
  // ignore
}
