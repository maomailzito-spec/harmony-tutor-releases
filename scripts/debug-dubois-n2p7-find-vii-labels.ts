import fx from '../tests/Dubois N2 p.7.json';
import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis, getRomanAnalysisDebugSnapshot, normalizeNotePitchFieldsWithKey } from '../src/utils/musicTheory';
import { ALL_NOTE_SPELLINGS, NOTE_NAMES } from '../src/constants';
import type { AnalysisContext, TimeSignature } from '../src/types';

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function beatsPerMeasure(ts: TimeSignature): number {
  return ts.numerator * (4 / ts.denominator);
}

function analysisContextAbsBeat(ts: TimeSignature, ctx: any): number {
  const bpm = beatsPerMeasure(ts) || 4;
  const a = Number(ctx?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(ctx?.measureIndex ?? 0);
  if (Number.isFinite(mi)) return mi * bpm;
  return 0;
}

function noteNameToChromaticIndex(name: string): number {
  const idxSharp = NOTE_NAMES.indexOf(name);
  if (idxSharp >= 0) return idxSharp;
  const normalized = String(name || '').replace('♯', '#').replace('♭', 'b');
  for (let i = 0; i < ALL_NOTE_SPELLINGS.length; i++) {
    if (ALL_NOTE_SPELLINGS[i].includes(normalized)) return i;
  }
  return -1;
}

function makeFakeLayoutData(ts: TimeSignature, notes: any[]) {
  const maxMeasureIndex = Math.max(0, ...notes.map((n: any) => (Number.isFinite(n?.measureIndex) ? Number(n.measureIndex) : 0)));
  const bpm = beatsPerMeasure(ts) || 4;
  const measureStartAbsBeat: number[] = [];
  const measureBeatsPerMeasure: number[] = [];
  for (let m = 0; m <= maxMeasureIndex + 2; m++) {
    measureStartAbsBeat[m] = m * bpm;
    measureBeatsPerMeasure[m] = bpm;
  }

  const measureIndices = Array.from({ length: maxMeasureIndex + 1 }, (_, i) => i);
  const measureWidth = 120;
  const startMeasuresX = measureIndices.map((_, i) => i * measureWidth);
  const width = (measureIndices.length + 1) * measureWidth;

  return {
    positionedNotes: notes,
    measureStartAbsBeat,
    measureBeatsPerMeasure,
    systemsParams: [
      {
        measureIndices,
        startMeasuresX,
        width,
      },
    ],
  };
}

function ctxAtAbsBeat(effectiveContexts: any[], ts: TimeSignature, absBeat: number) {
  const a = Number(absBeat);
  const applicable = (effectiveContexts || [])
    .filter((c: any) => analysisContextAbsBeat(ts, c) <= a + 1e-6)
    .sort((x: any, y: any) => analysisContextAbsBeat(ts, y) - analysisContextAbsBeat(ts, x))[0];
  return applicable || null;
}

function main() {
  const notes = (fx as any).notes || [];
  const ts = ((fx as any).timeSignature || { numerator: 4, denominator: 4 }) as TimeSignature;
  const keyTonic = String((fx as any).keySignatureRoot || 'C');
  const isMinor = Boolean((fx as any).isMinorMode);

  const ks = getKeySignature(keyTonic, isMinor ? 'Minor' : 'Major');
  const res: any = applyHarmonyRules(
    notes as any,
    ks as any,
    keyTonic,
    isMinor,
    ((fx as any).analysisContexts || []) as any,
    ts as any,
  );

  const analyzedNotes = (res?.analyzedNotes || notes) as any[];
  const inferred = (res?.inferredAnalysisContexts || []) as AnalysisContext[];
  const effectiveAnalysisContexts = ([...((fx as any).analysisContexts || []), ...(inferred || [])] as any[])
    .slice()
    .sort((a: any, b: any) => analysisContextAbsBeat(ts, a) - analysisContextAbsBeat(ts, b));

  const layoutData = makeFakeLayoutData(ts, analyzedNotes);

  const labelsBySystem = computeHarmonyLabelsBySystem({
    isAnalysisEnabled: true,
    layoutData,
    timeSignature: ts,
    timeSignatureChanges: (fx as any).timeSignatureChanges || [],
    effectiveAnalysisContexts,
    analysisContextAbsBeat: (c: any) => analysisContextAbsBeat(ts, c),
    currentTonic: keyTonic,
    isMinorMode: isMinor,
    harmonyOverrides: (fx as any).harmonyOverrides || [],
    analysisResult: res,
    analyzedNotes,
    noteNameToChromaticIndex,
    startX: 0,
    measurePaddingX: 10,
    harmonyLabelMinSpanBeats: 0,
  });

  const bpm = beatsPerMeasure(ts) || 4;
  const hits: any[] = [];
  for (const sys of labelsBySystem) {
    for (const lbl of sys || []) {
      const roman = String((lbl as any)?.roman || '').trim();
      if (!roman) continue;
      const isVii = roman.toLowerCase().startsWith('vii') && roman.includes('°');
      if (!isVii) continue;
      const ab = Number((lbl as any).absBeat);
      const mi = Math.floor(ab / bpm);
      const beat = (ab - mi * bpm) + 1;
      const ctx = ctxAtAbsBeat(effectiveAnalysisContexts, ts, ab);

      // Compute what getRomanAnalysis sees on the full verticality (normalized like the label pipeline).
      let romanFull = '';
      let fullDbg: any = null;
      let fullNotesMini: any[] = [];
      try {
        const ev = getActiveNotesTimeline(analyzedNotes as any, ts as any, (fx as any).timeSignatureChanges || [])
          .find((e: any) => approxEq(Number(e?.absBeat), ab, 1e-9));
        const fullNotes = (ev?.notes || []) as any[];
        const ctxTonic = ctx ? String((ctx as any).newTonic || '') : keyTonic;
        const ctxIsMinor = ctx ? !!(ctx as any).newIsMinor : isMinor;
        const ctxKs = getKeySignature(ctxTonic, ctxIsMinor ? 'Minor' : 'Major');
        const normalized = (fullNotes || []).map((n: any) => normalizeNotePitchFieldsWithKey(n, ctxKs as any));
        romanFull = String(getRomanAnalysis(normalized as any, ctxTonic, ctxIsMinor)?.roman || '').trim();
        fullDbg = getRomanAnalysisDebugSnapshot(normalized as any, ctxTonic, ctxIsMinor);
        fullNotesMini = (normalized || [])
          .filter((n: any) => n && !n.isRest)
          .map((n: any) => ({
            v: n.voice ?? null,
            p: String(n.pitch || '') + String(n.octave ?? ''),
            midi: n.midi ?? null,
            ni: n.noteIndex ?? null,
            exp: n.explicitAccidental ?? null,
            usr: (n as any).userAccidental ?? null,
            susp: (n as any).isSuspension ? { from: (n as any).isSuspension.fromAbsBeat, type: (n as any).isSuspension.type } : null,
          }))
          .sort((a: any, b: any) => (a.v ?? 0) - (b.v ?? 0) || (a.midi ?? 0) - (b.midi ?? 0));
      } catch {
        // ignore
      }

      hits.push({
        absBeat: ab,
        measureNumber: mi + 1,
        beat: Math.round(beat * 1000) / 1000,
        roman,
        romanFull,
        context: ctx ? { absBeat: analysisContextAbsBeat(ts, ctx), tonic: (ctx as any).newTonic, isMinor: !!(ctx as any).newIsMinor, label: (ctx as any).label ?? null } : null,
        fullNotes: fullNotesMini,
        fullDbg,
      });
    }
  }

  // de-dupe by absBeat+roman
  const seen = new Set<string>();
  const out = hits
    .filter((h) => {
      const k = `${h.absBeat}::${h.roman}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.absBeat - b.absBeat);

  console.log(JSON.stringify({ meta: { keyTonic, isMinor, viiCount: out.length }, viiLabels: out }, null, 2));
}

main();
