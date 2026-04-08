import fs from 'fs';
import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
  normalizeNotePitchFieldsWithKey,
} from '../src/utils/musicTheory';

type AnyObj = Record<string, any>;

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function main(): void {
  const raw = fs.readFileSync('./tests/Dubois n3 p12.htp', 'utf8');
  const proj = JSON.parse(raw) as AnyObj;

  const notes = (proj.notes || []) as any[];
  const ts = proj.timeSignature as any;
  const tonic = String(proj.keySignatureRoot || 'C');
  const isMinor = !!proj.isMinorMode;
  const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');

  const res: any = applyHarmonyRules(
    notes as any,
    keySig as any,
    tonic,
    isMinor,
    (proj.analysisContexts || []) as any,
    ts as any,
  );

  const analyzed = (res.analyzedNotes || notes) as any[];
  const inferred = (res.inferredAnalysisContexts || []) as any[];

  const timeline = getActiveNotesTimeline(
    analyzed as any,
    ts as any,
    (proj.timeSignatureChanges || []) as any,
  ) as any[];

  const beatsPerMeasure = Number(ts?.numerator) * (4 / Number(ts?.denominator));
  const absBeatOf = (measureIndex: number, beat: number) => measureIndex * beatsPerMeasure + (beat - 1);

  const ctxAt = (absBeat: number) => {
    const applicable = [...(proj.analysisContexts || []), ...(inferred || [])]
      .filter((c: any) => Number(c?.absBeat ?? (Number(c?.measureIndex ?? 0) * beatsPerMeasure)) <= absBeat + 1e-6)
      .sort((a: any, b: any) => Number(b?.absBeat ?? (Number(b?.measureIndex ?? 0) * beatsPerMeasure)) - Number(a?.absBeat ?? (Number(a?.measureIndex ?? 0) * beatsPerMeasure)))[0];
    return {
      tonic: applicable ? String(applicable.newTonic) : tonic,
      isMinor: applicable ? !!applicable.newIsMinor : isMinor,
      ctx: applicable || null,
    };
  };

  const getNotesAtAbsBeat = (absBeat: number) => {
    let best: any = null;
    for (const ev of timeline || []) {
      if (!ev || typeof ev.absBeat !== 'number') continue;
      if (ev.absBeat <= absBeat + 1e-6) best = ev;
      else break;
    }
    return ((best?.notes || []) as any[]).filter((n) => n && n.isRest === false);
  };

  const dumpAt = (label: string, measureIndex: number, beat: number) => {
    const abs = absBeatOf(measureIndex, beat);
    const { tonic: t, isMinor: m, ctx } = ctxAt(abs);
    const ksLocal = getKeySignature(t, m ? 'Minor' : 'Major');
    const c = getNotesAtAbsBeat(abs)
      .map((n) => normalizeNotePitchFieldsWithKey(n, ksLocal as any))
      .sort((a, b) => (a.voice ?? 1) - (b.voice ?? 1) || (a.midi ?? 0) - (b.midi ?? 0));
    const r = getRomanAnalysis(c as any, t, m);

    console.log('\n===', label, { measureIndex, beat, abs, ctx: ctx ? { absBeat: ctx.absBeat, newTonic: ctx.newTonic, newIsMinor: ctx.newIsMinor, source: ctx.source, label: ctx.label } : null });
    console.log('roman', { tonic: t, isMinor: m, roman: r?.roman, figures: r?.figures, symbol: (r as any)?.symbol });
    console.log('notes', c.map((n: any) => ({
      v: n.voice,
      p: `${n.pitch}${n.octave}`,
      midi: n.midi,
      ni: n.noteIndex,
      acc: n.explicitAccidental ?? null,
      dur: n.duration,
      pass: !!n.isPassing,
      neigh: !!n.isNeighbor,
      app: !!n.isAppoggiatura,
      susp: !!n.isSuspension,
    })));

    const r04 = (res.violations || []).filter((v: any) => String(v?.ruleId) === 'R-04' && Array.isArray(v?.noteIds) && v.noteIds.some((id: string) => c.some((n: any) => n.id === id)));
    if (r04.length) {
      console.log('R-04 here', r04.map((v: any) => ({ description: v.description, noteIds: v.noteIds })));
    }
  };

  // User refs (1-based measures):
  // m2 b3 -> measureIndex 1 beat 3
  // m23 b1..2 -> measureIndex 22 beat 1..2
  // m24 (sequence) -> measureIndex 23 (beats tbd)
  // m28 b1 -> measureIndex 27 beat 1
  dumpAt('m2 b3', 1, 3);
  for (const beat of [1, 2, 3, 4]) dumpAt(`m23 b${beat}`, 22, beat);
  for (const beat of [1, 2, 3, 4]) dumpAt(`m24 b${beat}`, 23, beat);
  for (const beat of [1, 2, 3, 4]) dumpAt(`m25 b${beat}`, 24, beat);
  for (const beat of [1, 2, 3, 4]) dumpAt(`m26 b${beat}`, 25, beat);
  dumpAt('m28 b1', 27, 1);
}

main();
