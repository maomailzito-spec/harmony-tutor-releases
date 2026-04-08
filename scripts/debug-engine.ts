import fs from 'fs';

import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';
import {
  applyHarmonyRules,
  getKeySignature,
  getRomanAnalysis,
  getRomanAnalysisDebugSnapshot,
  normalizeNotePitchFieldsWithKey,
} from '../src/utils/musicTheory';
import { ALL_NOTE_SPELLINGS, DURATION_VALUES, NOTE_NAMES } from '../src/constants';
import type { AnalysisContext, StaffNote, TimeSignature, TimeSignatureChange } from '../src/types';

type Args = {
  file: string;
  findVii: boolean;
  findChordComplete: boolean;
  spots: string[];
  measures: number[];
  verbose: boolean;
  json: boolean;
};

type SpotParsed = { raw: string; measureNumber: number; beat: number };

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function parseArgs(argv: string[]): Args {
  const out: Args = { file: '', findVii: false, findChordComplete: false, spots: [], measures: [], verbose: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') out.file = String(argv[++i] || '');
    else if (a === '--find-vii') out.findVii = true;
    else if (a === '--find-chord-complete' || a === '--find-chord-incomplete') out.findChordComplete = true;
    else if (a === '--spot' || a === '--spots') out.spots.push(String(argv[++i] || ''));
    else if (a === '--measures' || a === '--measure') {
      const raw = String(argv[++i] || '');
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        const n = Number(p);
        if (Number.isFinite(n) && n > 0) out.measures.push(Math.round(n));
      }
    }
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--json') out.json = true;
  }
  if (!out.file) {
    throw new Error('Missing --file. Example: npx tsx scripts/debug-engine.ts --file tests/Dubois\ N2\ p.7.json --find-vii');
  }
  return out;
}

function beatsPerMeasure(ts: TimeSignature): number {
  return ts.numerator * (4 / ts.denominator);
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

function parseSpot(raw: string): SpotParsed | null {
  const s = String(raw || '').trim();
  if (!s) return null;

  // Formats:
  // - m7b3
  // - 7:3
  // - 7,3
  const m = s.match(/^m?(\d+)\s*[b:,(]\s*(\d+(?:\.\d+)?)$/i);
  if (m) {
    const measureNumber = Math.max(1, Math.round(Number(m[1])));
    const beat = Number(m[2]);
    if (!Number.isFinite(beat) || beat <= 0) return null;
    return { raw: s, measureNumber, beat };
  }
  return null;
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
  for (let m = 0; m < targetMeasureIndex; m++) acc += getBpmForMeasureIndex(m);
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
  const maxMeasureIndex = Math.max(0, ...notes.map((n) => (Number.isFinite((n as any).measureIndex) ? Number((n as any).measureIndex) : 0)));
  const starts: number[] = [];
  for (let m = 0; m <= maxMeasureIndex + 1; m++) starts[m] = measureStartAbsBeat(m, ts, tsc);

  return (notes || []).filter((n: any) => {
    if (!n || n.isRest) return false;
    const mi = Number.isFinite(n.measureIndex) ? Number(n.measureIndex) : 0;
    const b = Number.isFinite(n.beat) ? Number(n.beat) : 1;
    const start = (starts[mi] ?? 0) + (b - 1);
    const end = start + noteDurationBeats(n);
    return start <= absBeat + 1e-9 && absBeat < end - 1e-6;
  });
}

function ctxAbsBeat(ts: TimeSignature, c: any): number {
  const bpm = beatsPerMeasure(ts) || 4;
  const a = Number(c?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(c?.measureIndex ?? 0);
  if (Number.isFinite(mi)) return mi * bpm;
  return 0;
}

function ctxAtAbsBeat(effectiveContexts: any[], ts: TimeSignature, absBeat: number): any | null {
  const a = Number(absBeat);
  const applicable = (effectiveContexts || [])
    .filter((c: any) => ctxAbsBeat(ts, c) <= a + 1e-6)
    .sort((x: any, y: any) => ctxAbsBeat(ts, y) - ctxAbsBeat(ts, x))[0];
  return applicable || null;
}

function makeFakeLayoutData(ts: TimeSignature, notes: any[]) {
  const maxMeasureIndex = Math.max(0, ...notes.map((n: any) => (Number.isFinite(n?.measureIndex) ? Number(n.measureIndex) : 0)));
  const bpm = beatsPerMeasure(ts) || 4;
  const measureStartAbsBeatArr: number[] = [];
  const measureBeatsPerMeasure: number[] = [];
  for (let m = 0; m <= maxMeasureIndex + 2; m++) {
    measureStartAbsBeatArr[m] = m * bpm;
    measureBeatsPerMeasure[m] = bpm;
  }

  const measureIndices = Array.from({ length: maxMeasureIndex + 1 }, (_, i) => i);
  const measureWidth = 120;
  const startMeasuresX = measureIndices.map((_, i) => i * measureWidth);
  const width = (measureIndices.length + 1) * measureWidth;

  return {
    positionedNotes: notes,
    measureStartAbsBeat: measureStartAbsBeatArr,
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

function main() {
  const args = parseArgs(process.argv.slice(2));

  const fx = JSON.parse(fs.readFileSync(args.file, 'utf8')) as any;
  const notes = (fx as any).notes || [];
  const ts = ((fx as any).timeSignature || { numerator: 4, denominator: 4 }) as TimeSignature;
  const tsc = ((fx as any).timeSignatureChanges || []) as TimeSignatureChange[];
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
    .sort((a: any, b: any) => ctxAbsBeat(ts, a) - ctxAbsBeat(ts, b));

  const layoutData = makeFakeLayoutData(ts, analyzedNotes);
  const labelsBySystem = computeHarmonyLabelsBySystem({
    isAnalysisEnabled: true,
    layoutData,
    timeSignature: ts,
    timeSignatureChanges: tsc as any,
    effectiveAnalysisContexts,
    analysisContextAbsBeat: (c: any) => ctxAbsBeat(ts, c),
    currentTonic: keyTonic,
    isMinorMode: isMinor,
    harmonyOverrides: (fx as any).harmonyOverrides || [],
    analysisResult: res,
    analyzedNotes,
    noteNameToChromaticIndex,
    startX: 0,
    measurePaddingX: 10,
    harmonyLabelMinSpanBeats: 0,
    useStatisticalCorrection: false,
    minorScaleMode: 'natural',
  });

  const bpm = beatsPerMeasure(ts) || 4;

  if (args.findChordComplete) {
    const filterMeasures = new Set<number>((args.measures || []).filter((m) => Number.isFinite(m) && m > 0));
    const analyzed = analyzedNotes as any[];
    const idToMB = new Map<string, { measureNumber: number; beat: number; voice: number | null }>();
    for (const n of analyzed) {
      if (!n || (n as any).isRest || !(n as any).id) continue;
      const mi = Number((n as any).measureIndex);
      const bt = Number((n as any).beat);
      const v = (n as any).voice;
      if (!Number.isFinite(mi) || !Number.isFinite(bt)) continue;
      idToMB.set(String((n as any).id), { measureNumber: mi + 1, beat: bt, voice: Number.isFinite(v) ? Number(v) : null });
    }

    const violations = ((res as any)?.violations || []) as any[];
    const hits = (violations || []).filter((v) => String(v?.ruleId) === 'R-CHORD-COMPLETE');

    const outHits: any[] = [];
    for (const v of hits) {
      const ids = Array.isArray(v?.noteIds) ? (v.noteIds as any[]) : [];
      let loc: { measureNumber: number; beat: number; voice: number | null } | null = null;
      for (const id of ids) {
        const mb = idToMB.get(String(id));
        if (mb) {
          loc = mb;
          break;
        }
      }
      if (!loc) continue;
      if (filterMeasures.size > 0 && !filterMeasures.has(loc.measureNumber)) continue;
      outHits.push({
        measureNumber: loc.measureNumber,
        beat: loc.beat,
        voice: loc.voice,
        description: String(v?.description || ''),
      });
    }

    outHits.sort((a, b) => a.measureNumber - b.measureNumber || a.beat - b.beat || (a.voice ?? 0) - (b.voice ?? 0));

    const payload = { meta: { file: args.file, keyTonic, isMinor, count: outHits.length, measures: Array.from(filterMeasures).sort((a, b) => a - b) }, hits: outHits };
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`file=${args.file}`);
      console.log(`key=${keyTonic}${isMinor ? 'm' : ''}  R-CHORD-COMPLETE hits=${outHits.length}`);
      for (const h of outHits.slice(0, 30)) {
        const v = h.voice != null ? ` v${h.voice}` : '';
        console.log(`m${h.measureNumber} b${h.beat}${v}  ${h.description}`);
      }
      if (outHits.length > 30) console.log(`… (${outHits.length - 30} more)`);
    }
    return;
  }

  if (args.findVii) {
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
        hits.push({
          absBeat: ab,
          measureNumber: mi + 1,
          beat: Math.round(beat * 1000) / 1000,
          roman,
          context: ctx ? { absBeat: ctxAbsBeat(ts, ctx), tonic: (ctx as any).newTonic, isMinor: !!(ctx as any).newIsMinor, label: (ctx as any).label ?? null } : null,
        });
      }
    }

    const seen = new Set<string>();
    const out = hits
      .filter((h) => {
        const k = `${h.absBeat}::${h.roman}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.absBeat - b.absBeat);

    const payload = { meta: { file: args.file, keyTonic, isMinor, viiCount: out.length }, viiLabels: out };
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`file=${args.file}`);
      console.log(`key=${keyTonic}${isMinor ? 'm' : ''}  viiCount=${out.length}`);
      for (const h of out) {
        const ctx = h.context ? `${h.context.tonic}${h.context.isMinor ? 'm' : ''}` : '∅';
        console.log(`m${h.measureNumber} b${h.beat} @abs=${h.absBeat}  ${h.roman}  ctx=${ctx}`);
      }
    }
    return;
  }

  const parsedSpots: SpotParsed[] = [];
  for (const raw of args.spots || []) {
    const parts = String(raw).split(',').map(x => x.trim()).filter(Boolean);
    // allow --spot "m7b3,m11b1" as well as multiple --spot
    for (const p of parts) {
      const sp = parseSpot(p);
      if (sp) parsedSpots.push(sp);
    }
  }

  if (!parsedSpots.length) {
    console.log('No --spot provided. Use --find-vii or --spot m7b3 (or 7:3).');
    return;
  }

  const out: any[] = [];
  for (const sp of parsedSpots) {
    const measureIndex = sp.measureNumber - 1;
    const absBeat = measureStartAbsBeat(measureIndex, ts, tsc) + (sp.beat - 1);

    const ctx = ctxAtAbsBeat(effectiveAnalysisContexts, ts, absBeat);
    const ctxTonic = ctx ? String((ctx as any).newTonic || '') : keyTonic;
    const ctxIsMinor = ctx ? !!(ctx as any).newIsMinor : isMinor;
    const ctxKs = getKeySignature(ctxTonic, ctxIsMinor ? 'Minor' : 'Major');

    const fullNotes = activeNotesAtAbsBeat(analyzedNotes as any, absBeat, ts, tsc);
    const normalized = (fullNotes || []).map((n: any) => normalizeNotePitchFieldsWithKey(n, ctxKs as any));
    const romanFull = String(getRomanAnalysis(normalized as any, ctxTonic, ctxIsMinor)?.roman || '').trim();

    // Find the nearest UI label around this absBeat (within a small epsilon)
    let uiRoman = '';
    let uiFigures: any[] = [];
    let uiSymbol = '';
    let uiAbsBeat: number | null = null;
    try {
      const allLabels = labelsBySystem.flat();
      let best: any = null;
      for (const l of allLabels) {
        const a = Number((l as any).absBeat);
        if (!Number.isFinite(a)) continue;
        const d = Math.abs(a - absBeat);
        if (!best || d < best.d) best = { d, l };
      }
      if (best && best.d <= 1e-3) {
        uiAbsBeat = Number((best.l as any).absBeat);
        uiRoman = String((best.l as any).roman || '').trim();
        uiFigures = Array.isArray((best.l as any).figures) ? (best.l as any).figures : [];
        uiSymbol = String((best.l as any).symbol || '');
      }
    } catch {
      // ignore
    }

    const item: any = {
      spot: sp.raw,
      absBeat,
      context: { tonic: ctxTonic, isMinor: ctxIsMinor, absBeat: ctx ? ctxAbsBeat(ts, ctx) : null },
      ui: { absBeat: uiAbsBeat, roman: uiRoman || null, figures: uiFigures, symbol: uiSymbol || null },
      full: { roman: romanFull || null },
    };

    if (args.verbose) {
      item.full.notes = (normalized || []).filter((n: any) => n && !n.isRest).map((n: any) => ({
        id: n.id ?? null,
        v: n.voice ?? null,
        p: String(n.pitch || '') + String(n.octave ?? ''),
        midi: n.midi ?? null,
        ni: n.noteIndex ?? null,
        exp: n.explicitAccidental ?? null,
        usr: (n as any).userAccidental ?? null,
        susp: (n as any).isSuspension ? { from: (n as any).isSuspension.fromAbsBeat, type: (n as any).isSuspension.type } : null,
      }));
      item.full.dbg = getRomanAnalysisDebugSnapshot(normalized as any, ctxTonic, ctxIsMinor);
    }

    out.push(item);
  }

  if (args.json) {
    console.log(JSON.stringify({ meta: { file: args.file, keyTonic, isMinor }, spots: out }, null, 2));
  } else {
    console.log(`file=${args.file}`);
    for (const it of out) {
      const c = it.context;
      const ctxStr = `${c.tonic}${c.isMinor ? 'm' : ''}`;
      const ui = it.ui.roman ? `${it.ui.roman}${(it.ui.figures?.length ? ' ' + it.ui.figures.join('/') : '')}` : '∅';
      const full = it.full.roman || '∅';
      console.log(`${it.spot} @abs=${it.absBeat}  ctx=${ctxStr}  ui=${ui}  full=${full}`);
    }
  }
}

main();
