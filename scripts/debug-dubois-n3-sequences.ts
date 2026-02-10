import fs from 'fs';
import { getActiveNotesTimeline, getKeySignature, getRomanAnalysis, normalizeNotePitchFieldsWithKey } from '../src/utils/musicTheory';
import { detectVoiceLeadingSequences } from '../src/utils/sequenceDetector';
import type { HarmonyLabelOverride } from '../src/types';
import { applyHarmonyRules } from '../src/utils/musicTheory';

type AnyObj = Record<string, any>;

const qAbs = (x: number) => {
  try {
    const q = 192;
    return Math.round(Number(x) * q) / q;
  } catch {
    return Number(x) || 0;
  }
};

function main(): void {
  const raw = fs.readFileSync('./tests/Dubois n3 p12.htp', 'utf8');
  const proj = JSON.parse(raw) as AnyObj;
  const notes = (proj.notes || []) as any[];
  const ts = proj.timeSignature as any;
  const tonic = String(proj.keySignatureRoot || 'C');
  const isMinor = !!proj.isMinorMode;
  const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');

  const res: any = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, (proj.analysisContexts || []) as any, ts as any);
  const analyzed = (res.analyzedNotes || notes) as any[];
  const inferred = (res.inferredAnalysisContexts || []) as any[];

  const beatsPerMeasure = Number(ts?.numerator) * (4 / Number(ts?.denominator));
  const ctxAbs = (c: any) => {
    const a = Number(c?.absBeat);
    if (Number.isFinite(a)) return a;
    const mi = Number(c?.measureIndex ?? 0);
    return (Number.isFinite(mi) ? mi : 0) * beatsPerMeasure;
  };

  const contexts = [...(proj.analysisContexts || []), ...(inferred || [])];
  const ctxAtAbsBeat = (absBeat: number) =>
    (contexts || [])
      .filter((c: any) => ctxAbs(c) <= absBeat + 1e-6)
      .sort((a: any, b: any) => ctxAbs(b) - ctxAbs(a))[0];

  const timeline = getActiveNotesTimeline(analyzed as any, ts as any, (proj.timeSignatureChanges || []) as any);

  const overrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
  try {
    (proj.harmonyOverrides || []).forEach((o: any) => {
      const a = Number(o?.absBeat);
      if (!Number.isFinite(a)) return;
      overrideByAbsBeat.set(qAbs(a), {
        absBeat: a,
        roman: typeof o?.roman === 'string' ? o.roman : undefined,
        symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
        figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
        note: typeof o?.note === 'string' ? o.note : undefined,
        romanDisplay: typeof o?.romanDisplay === 'string' ? o.romanDisplay : undefined,
      });
    });
  } catch {
    // ignore
  }

  // Build labelPoints like GrandStaffEditor does for sequence detection.
  const labelPoints = (timeline || [])
    .map((ev: any) => {
      const absBeat = Number(ev?.absBeat);
      if (!Number.isFinite(absBeat)) return null;
      const ctx = ctxAtAbsBeat(absBeat);
      const t = ctx ? String(ctx.newTonic || '') : tonic;
      const m = ctx ? !!ctx.newIsMinor : isMinor;

      const notesHere = ((ev?.notes || []) as any[]).filter((n) => n && !n.isRest).map((n) => normalizeNotePitchFieldsWithKey(n, keySig));
      let roman = '';
      let figures: string[] | undefined;
      try {
        const r = getRomanAnalysis(notesHere as any, t, m);
        roman = String(r?.roman || '');
        figures = Array.isArray(r?.figures) ? r.figures.map((x: any) => String(x)) : undefined;
      } catch {
        // ignore
      }

      const ov = overrideByAbsBeat.get(qAbs(absBeat));
      if (ov) {
        if (ov.roman != null) roman = String(ov.roman);
        if (ov.figures != null) figures = ov.figures;
      }

      return { absBeat, roman: roman || undefined, figures };
    })
    .filter(Boolean) as Array<{ absBeat: number; roman?: string; figures?: string[] }>;

  const seqs = detectVoiceLeadingSequences(analyzed as any, ts as any, (proj.timeSignatureChanges || []) as any, labelPoints as any);
  console.log('inferredContexts', inferred.map((c: any) => ({ absBeat: c.absBeat, tonic: c.newTonic, src: c.source, score: c.score })));
  console.log('sequences', seqs.length);
  for (const s of seqs) {
    console.log({
      startMeasure: s.startMeasure,
      endMeasure: s.endMeasure,
      lengthSteps: s.lengthSteps,
      repeatsCount: s.repeatsCount,
      transpositionSemitones: s.transpositionSemitones,
      confidence: s.confidence,
      label: s.label,
    });
  }
}

main();
