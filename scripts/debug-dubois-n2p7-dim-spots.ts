import proj from '../tests/Dubois N2 p.7.json';
import {
  applyHarmonyRules,
  getKeySignature,
  getRomanAnalysis,
  getRomanAnalysisDebugSnapshot,
  getPitchClassesForDebug,
  normalizeNotePitchFieldsWithKey,
} from '../src/utils/musicTheory';
import { DURATION_VALUES } from '../src/constants';
import type { AnalysisContext, StaffNote, TimeSignature, TimeSignatureChange } from '../src/types';

type Spot = { label: string; measureNumber: number; beat: number };

const spots: Spot[] = [
  { label: 'm7b1', measureNumber: 7, beat: 1 },
  { label: 'm7b3', measureNumber: 7, beat: 3 },
  { label: 'm11b1', measureNumber: 11, beat: 1 },
  { label: 'm11b3', measureNumber: 11, beat: 3 },
  { label: 'm12b1', measureNumber: 12, beat: 1 },
];

function beatsPerMeasure(ts: TimeSignature): number {
  return ts.numerator * (4 / ts.denominator);
}

function measureStartAbsBeat(
  targetMeasureIndex: number,
  timeSignature: TimeSignature,
  timeSignatureChanges?: TimeSignatureChange[],
): number {
  const base = Math.max(1, beatsPerMeasure(timeSignature) || 4);
  const changes = (timeSignatureChanges || [])
    .map((c) => {
      const absBeat = Number((c as any).absBeat);
      const m = Number.isFinite((c as any).measureIndex)
        ? Number((c as any).measureIndex)
        : (Number.isFinite(absBeat) ? Math.floor(absBeat / base) : 0);
      const numerator = Math.max(1, Math.round(Number((c as any).numerator)));
      const denominator = Math.max(1, Math.round(Number((c as any).denominator)));
      return { measureIndex: m, numerator, denominator };
    })
    .filter((c) => Number.isFinite(c.measureIndex))
    .sort((a, b) => a.measureIndex - b.measureIndex);

  const getBpmForMeasureIndex = (m: number): number => {
    let active = timeSignature;
    for (const c of changes) {
      if (c.measureIndex <= m) active = { numerator: c.numerator, denominator: c.denominator } as any;
      else break;
    }
    const bpm = active.numerator * (4 / active.denominator);
    return Math.max(1, Number.isFinite(bpm) ? bpm : base);
  };

  let acc = 0;
  for (let m = 0; m < targetMeasureIndex; m++) {
    acc += getBpmForMeasureIndex(m);
  }
  return acc;
}

function noteDurationBeats(n: StaffNote): number {
  const base = (DURATION_VALUES as any)[(n as any).duration] || 1;
  let val = base;
  if ((n as any).isDotted) val *= 1.5;
  if ((n as any).isTriplet) val *= 2 / 3;
  if ((n as any).isDuplet) val *= 3 / 2;
  return val;
}

function activeNotesAtAbsBeat(notes: StaffNote[], absBeat: number, ts: TimeSignature, tsc?: TimeSignatureChange[]): StaffNote[] {
  // Compute per-measure starts so we can map measureIndex+beat to absolute beats.
  const maxMeasureIndex = Math.max(0, ...notes.map((n) => (Number.isFinite((n as any).measureIndex) ? Number((n as any).measureIndex) : 0)));
  const starts: number[] = [];
  for (let m = 0; m <= maxMeasureIndex + 1; m++) {
    starts[m] = measureStartAbsBeat(m, ts, tsc);
  }

  return (notes || []).filter((n: any) => {
    if (!n || n.isRest) return false;
    const m = Number.isFinite(n.measureIndex) ? n.measureIndex : 0;
    const b = Number.isFinite(n.beat) ? n.beat : 1;
    const start = (starts[m] ?? 0) + (b - 1);
    const end = start + noteDurationBeats(n);
    return start <= absBeat + 1e-9 && absBeat < end - 1e-6;
  });
}

function ctxAbsBeat(c: AnalysisContext, bpm: number): number {
  const m = (c as any).measureIndex ?? 0;
  const legacyAbs = m * bpm;
  const a = (c as any).absBeat;
  return Number.isFinite(a) ? Number(a) : legacyAbs;
}

function contextAt(absBeat: number, baseTonic: string, baseIsMinor: boolean, contexts: AnalysisContext[], inferred: AnalysisContext[], bpm: number) {
  const applicable = ([...(contexts || []), ...(inferred || [])] as AnalysisContext[])
    .filter((c) => ctxAbsBeat(c, bpm) <= absBeat + 1e-6)
    .sort((a, b) => ctxAbsBeat(b, bpm) - ctxAbsBeat(a, bpm))[0];

  return {
    tonic: applicable ? (applicable as any).newTonic : baseTonic,
    isMinor: applicable ? (applicable as any).newIsMinor : baseIsMinor,
    ctx: applicable
      ? {
          absBeat: ctxAbsBeat(applicable, bpm),
          measureIndex: (applicable as any).measureIndex ?? null,
          newTonic: (applicable as any).newTonic,
          newIsMinor: (applicable as any).newIsMinor,
          label: (applicable as any).label ?? null,
        }
      : null,
  };
}

function summarizeNote(n: any) {
  return {
    id: n.id ?? null,
    v: n.voice ?? null,
    p: `${String(n.pitch ?? '')}${String(n.octave ?? '')}`,
    midi: Number.isFinite(n.midi) ? n.midi : null,
    noteIndex: Number.isFinite(n.noteIndex) ? n.noteIndex : null,
    userAccidental: n.userAccidental ?? null,
    explicitAccidental: n.explicitAccidental ?? null,
    dur: n.duration ?? null,
    beat: n.beat ?? null,
    m: n.measureIndex ?? null,
  };
}

function romanInKey(notes: StaffNote[], tonic: string, isMinor: boolean) {
  const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
  const norm = notes.map((n: any) => normalizeNotePitchFieldsWithKey(n, keySig));
  const res = getRomanAnalysis(norm as any, tonic, isMinor);
  return {
    roman: res?.roman ?? '',
    figures: res?.figures ?? [],
    dbg: getRomanAnalysisDebugSnapshot(norm as any, tonic, isMinor),
  };
}

function main() {
  const notes = ((proj as any).notes || []) as StaffNote[];
  const ts = ((proj as any).timeSignature || { numerator: 4, denominator: 4 }) as TimeSignature;
  const tsc = ((proj as any).timeSignatureChanges || []) as TimeSignatureChange[];
  const baseTonic = String((proj as any).keySignatureRoot || 'C');
  const baseIsMinor = Boolean((proj as any).isMinorMode);
  const keySig = getKeySignature(baseTonic, baseIsMinor ? 'Minor' : 'Major');

  const res: any = applyHarmonyRules(
    notes as any,
    keySig as any,
    baseTonic,
    baseIsMinor,
    ((proj as any).analysisContexts || []) as any
  );

  const analyzed: StaffNote[] = (res?.analyzedNotes || notes) as any;
  const inferred: AnalysisContext[] = (res?.inferredAnalysisContexts || []) as any;
  const contexts: AnalysisContext[] = ((proj as any).analysisContexts || []) as any;

  const bpm = beatsPerMeasure(ts);

  const out: any = {
    meta: {
      baseTonic,
      baseIsMinor,
      ts,
      inferredCount: inferred.length,
      contextsCount: contexts.length,
    },
    inferredContextsNear: inferred
      .filter((c) => {
        const a = ctxAbsBeat(c, bpm);
        return a >= 0 && a <= 9999;
      })
      .map((c) => ({ absBeat: ctxAbsBeat(c, bpm), newTonic: (c as any).newTonic, newIsMinor: (c as any).newIsMinor, label: (c as any).label ?? null }))
      .sort((a, b) => a.absBeat - b.absBeat),
    spots: [],
  };

  for (const s of spots) {
    const measureIndex = s.measureNumber - 1;
    const mStart = measureStartAbsBeat(measureIndex, ts, tsc);
    const absBeat = mStart + (s.beat - 1);

    const active = activeNotesAtAbsBeat(analyzed, absBeat, ts, tsc)
      .filter((n: any) => n && !n.isRest)
      .sort((a: any, b: any) => (a.voice ?? 0) - (b.voice ?? 0) || (a.midi ?? 0) - (b.midi ?? 0));

    const ctx = contextAt(absBeat, baseTonic, baseIsMinor, contexts, inferred, bpm);

    const activeRoman = romanInKey(active, ctx.tonic, ctx.isMinor);

    const candidates = [
      { tonic: 'Eb', isMinor: false },
      { tonic: 'D#', isMinor: false },
      { tonic: 'G', isMinor: false },
      { tonic: 'G', isMinor: true },
      { tonic: 'Bb', isMinor: false },
      { tonic: 'C', isMinor: true },
      { tonic: 'F', isMinor: false },
    ];

    const romanCandidates: any = {};
    for (const c of candidates) {
      romanCandidates[`${c.tonic}${c.isMinor ? 'm' : ''}`] = romanInKey(active, c.tonic, c.isMinor);
    }

    out.spots.push({
      label: s.label,
      measureNumber: s.measureNumber,
      measureIndex,
      beat: s.beat,
      absBeat,
      context: { tonic: ctx.tonic, isMinor: ctx.isMinor, ctx: ctx.ctx },
      activeNotes: active.map(summarizeNote),
      pcs: getPitchClassesForDebug(active as any),
      romanActive: activeRoman,
      romanCandidates,
    });
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
