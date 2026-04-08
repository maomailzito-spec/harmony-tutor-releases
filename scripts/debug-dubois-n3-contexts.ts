import fs from 'fs';
import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
  identifyChordCandidates,
} from '../src/utils/musicTheory';
import { computeLookaheadTonicizationOverrides } from '../src/utils/harmonyLabelPipeline';

type AnyObj = Record<string, any>;

function main(): void {
  const raw = fs.readFileSync('./tests/Dubois n3 p12.htp', 'utf8');
  const proj = JSON.parse(raw) as AnyObj;

  const notes = (proj.notes || []) as any[];
  const ts = proj.timeSignature as AnyObj;
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

  const inferred = (res?.inferredAnalysisContexts || []) as any[];

  console.log('global', { tonic, isMinor, ts, inferredCount: inferred.length });
  console.log('inferredTop', inferred.slice(0, 10));

  const beatsPerMeasure = Number(ts?.numerator) * (4 / Number(ts?.denominator));
  const absBeatOf = (measureIndex: number, beat: number) => measureIndex * beatsPerMeasure + (beat - 1);

  const qAbs = (x: number) => {
    const q = 192;
    return Math.round(Number(x) * q) / q;
  };

  const ctxAt = (absBeat: number) =>
    inferred
      .filter((c) => Number(c?.absBeat) <= absBeat + 1e-6)
      .sort((a, b) => Number(b.absBeat) - Number(a.absBeat))[0] || null;

  const noteNameToChromaticIndex = (name: string): number => {
    const map: Record<string, number> = {
      C: 0,
      'C#': 1,
      Db: 1,
      D: 2,
      Eb: 3,
      E: 4,
      F: 5,
      'F#': 6,
      Gb: 6,
      G: 7,
      Ab: 8,
      A: 9,
      Bb: 10,
      B: 11,
    };
    const k = String(name || '')
      .trim()
      .replace(/♭/g, 'b')
      .replace(/♯/g, '#');
    return map[k] ?? -1;
  };

  const pcSetFromNotes = (notesHere: any[]): Set<number> | null => {
    try {
      const pcs = new Set<number>();
      for (const n of notesHere || []) {
        if (!n || n.isRest) continue;
        const ni = Number(n.noteIndex);
        const mi = Number(n.midi);
        const pc = Number.isFinite(ni) ? (((ni % 12) + 12) % 12) : Number.isFinite(mi) ? (((mi % 12) + 12) % 12) : null;
        if (pc == null) continue;
        pcs.add(pc);
      }
      return pcs;
    } catch {
      return null;
    }
  };

  // --- Verify lookahead tonicization (explicit + implicit) ---
  const timeline = getActiveNotesTimeline((res.analyzedNotes || notes) as any, ts as any, (proj.timeSignatureChanges || []) as any);
  const timelineForLabels = (timeline || []).filter((ev: any) => ev && Number.isFinite(Number(ev.absBeat)));

  const overrideByAbsBeat = new Map<number, any>();
  for (const o of (proj.harmonyOverrides || []) as any[]) {
    const a = Number(o?.absBeat);
    if (!Number.isFinite(a)) continue;
    overrideByAbsBeat.set(qAbs(a), o);
  }

  const look = computeLookaheadTonicizationOverrides({
    timelineForLabels,
    beatsPerMeasure,
    currentTonic: tonic,
    isMinorMode: isMinor,
    minorScaleMode: undefined,
    ctxAtAbsBeat: (ab: number) => ctxAt(ab),
    noteNameToChromaticIndex,
    getRomanAnalysis: (ns: any[], t: string, im: boolean) => getRomanAnalysis(ns as any, t, im),
    identifyChordCandidates: (ns: any[]) => identifyChordCandidates(ns as any) as any,
    pcSetFromNotes: (ns: any[]) => pcSetFromNotes(ns),
    overrideByAbsBeat,
  });

  const rangeA = process.env.RANGE_A ? Number(process.env.RANGE_A) : 90;
  const rangeB = process.env.RANGE_B ? Number(process.env.RANGE_B) : 112;
  const verifyRows: any[] = [];
  for (const ev of timelineForLabels as any[]) {
    const ab0 = Number(ev.absBeat);
    if (!(ab0 >= rangeA && ab0 <= rangeB)) continue;
    const ab = qAbs(ab0);
    const ctx = ctxAt(ab0);
    const ctxTonic = ctx ? String(ctx.newTonic) : tonic;
    const ctxMinor = ctx ? !!ctx.newIsMinor : isMinor;
    const baseRoman = String(getRomanAnalysis((ev.notes || []) as any, ctxTonic, ctxMinor)?.roman || '');
    const auto = look.autoOverrideByAbsBeat.get(ab);
    const disp = look.autoRomanDisplayByAbsBeat.get(ab);
    if (!baseRoman && !auto && !disp) continue;
    verifyRows.push({
      absBeat: ab,
      ctx: ctx ? String(ctx.label || '') : null,
      base: baseRoman || null,
      autoRoman: auto?.roman ?? null,
      romanDisplay: disp ?? null,
    });
  }
  verifyRows.sort((a, b) => a.absBeat - b.absBeat);
  console.log('--- lookahead verify (absBeat 90..112) ---');
  console.log(JSON.stringify(verifyRows, null, 2));
  console.log('lookahead sizes', {
    autoOverrides: look.autoOverrideByAbsBeat.size,
    autoDisplays: look.autoRomanDisplayByAbsBeat.size,
    protectedAbsBeats: look.protectedAbsBeats.size,
  });

  try {
    const ovs = Array.from(look.autoOverrideByAbsBeat.entries())
      .map(([ab, o]) => ({ absBeat: ab, roman: o?.roman ?? null, note: o?.note ?? null }))
      .sort((a, b) => a.absBeat - b.absBeat);
    console.log('autoOverride entries', JSON.stringify(ovs, null, 2));
  } catch {
    // ignore
  }

  if (process.env.LOOKAHEAD_ONLY === '1') return;

  const dumpAt = (measureIndex: number, beat: number) => {
    const abs = absBeatOf(measureIndex, beat);
    const chord = ((res.analyzedNotes || notes) as any[]).filter(
      (n) => n && n.isRest === false && n.measureIndex === measureIndex && Math.abs(Number(n.beat) - beat) < 1e-6,
    );

    const rBb = getRomanAnalysis(chord as any, 'Bb', false);
    const rGb = getRomanAnalysis(chord as any, 'Gb', false);

    const ctx = ctxAt(abs);
    const ctxTonic = ctx ? String(ctx.newTonic) : 'Bb';
    const ctxMinor = ctx ? !!ctx.newIsMinor : false;
    const rCtx = getRomanAnalysis(chord as any, ctxTonic, ctxMinor);

    console.log({
      measureIndex,
      beat,
      abs,
      n: chord.length,
      ctx: ctx
        ? {
            absBeat: ctx.absBeat,
            newTonic: ctx.newTonic,
            newIsMinor: ctx.newIsMinor,
            label: ctx.label,
          }
        : null,
      rBb: rBb?.roman,
      rGb: rGb?.roman,
      rCtx: rCtx?.roman,
    });
  };

  for (const measureIndex of [18, 19, 20, 21, 22, 27]) {
    for (const beat of [1, 2, 3, 4]) dumpAt(measureIndex, beat);
  }
}

main();
