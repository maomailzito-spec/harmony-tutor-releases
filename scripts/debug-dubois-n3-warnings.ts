import fs from 'fs';
import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
  identifyChordCandidates,
} from '../src/utils/musicTheory';

type AnyObj = Record<string, any>;

type DumpPoint = {
  uiMeasure: number; // 1-based
  beat: number; // 1-based (quarter=1)
};

function qAbs(x: number): number {
  const q = 192;
  return Math.round(Number(x) * q) / q;
}

function main(): void {
  const raw = fs.readFileSync('./tests/Dubois n3 p12.htp', 'utf8');
  const proj = JSON.parse(raw) as AnyObj;

  const notes = (proj.notes || []) as any[];
  const ts = proj.timeSignature as AnyObj;
  const tonic = String(proj.keySignatureRoot || 'C');
  const isMinor = !!proj.isMinorMode;
  const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');

  const beatsPerMeasure = Number(ts?.numerator) * (4 / Number(ts?.denominator));

  const res: any = applyHarmonyRules(
    notes as any,
    keySig as any,
    tonic,
    isMinor,
    (proj.analysisContexts || []) as any,
    ts as any,
  );

  const analyzed = (res?.analyzedNotes || notes) as any[];
  const violations = (res?.violations || []) as any[];
  const inferred = (res?.inferredAnalysisContexts || []) as any[];

  const ctxAt = (absBeat: number) =>
    inferred
      .filter((c) => Number(c?.absBeat) <= absBeat + 1e-6)
      .sort((a, b) => Number(b.absBeat) - Number(a.absBeat))[0] || null;

  const tl = getActiveNotesTimeline(analyzed as any, ts as any, (proj.timeSignatureChanges || []) as any);
  const timeline = (tl || []).filter((ev: any) => ev && Number.isFinite(Number(ev.absBeat)));

  const eventAt = (absBeat: number) => {
    let best: any = null;
    for (const ev of timeline as any[]) {
      const ab = Number(ev.absBeat);
      if (!Number.isFinite(ab)) continue;
      if (ab <= absBeat + 1e-6) best = ev;
      else break;
    }
    return best;
  };

  const dumpPoint = (p: DumpPoint) => {
    const mi0 = p.uiMeasure - 1;
    const absBeat = mi0 * beatsPerMeasure + (p.beat - 1);
    const ev = eventAt(absBeat);

    const activeRaw = ((ev?.notes || []) as any[]).filter((n) => n && !n.isRest);
    const active = activeRaw
      .map((n) => ({
        id: n.id,
        v: n.voice,
        p: `${n.pitch}${n.octave}`,
        acc: n.explicitAccidental ?? null,
        ni: n.noteIndex,
        m: n.midi,
        d: n.duration,
        pass: !!n.isPassing,
        app: !!n.isAppoggiatura,
        neigh: !!n.isNeighbor,
        ant: !!n.isAnticipation,
        esc: !!n.isEscape,
        susp: !!n.isSuspension,
        attMi: n.measureIndex,
        attBeat: n.beat,
      }))
      .sort((a, b) => (a.v ?? 0) - (b.v ?? 0) || (a.m ?? 0) - (b.m ?? 0));

    const ids = new Set(active.map((n) => String(n.id)));
    const hits = violations
      .filter((v) => Array.isArray(v?.noteIds) && (v.noteIds as any[]).some((id) => ids.has(String(id))))
      .map((v) => ({ ruleId: v.ruleId, severity: v.severity, desc: v.description, sug: v.suggestion }));

    const ctx = ctxAt(absBeat);
    const ctxTonic = ctx ? String(ctx.newTonic) : tonic;
    const ctxMinor = ctx ? !!ctx.newIsMinor : isMinor;

    const rGlobal = String(getRomanAnalysis(activeRaw as any, tonic, isMinor)?.roman || '');
    const rCtx = String(getRomanAnalysis(activeRaw as any, ctxTonic, ctxMinor)?.roman || '');

    const cands = (identifyChordCandidates(activeRaw as any) || [])
      .slice(0, 8)
      .map((c: any) => ({
        root: c?.root?.noteIndex ?? null,
        type: c?.type ?? null,
        matchType: c?.matchType ?? null,
        score: c?.score ?? null,
        intervals: c?.intervals ? Array.from(c.intervals.values()) : null,
      }));

    const pcs = (() => {
      try {
        const s = new Set<number>();
        for (const n of activeRaw) {
          const ni = Number((n as any)?.noteIndex);
          const mi = Number((n as any)?.midi);
          const pc = Number.isFinite(ni) ? (((ni % 12) + 12) % 12) : Number.isFinite(mi) ? (((mi % 12) + 12) % 12) : null;
          if (pc == null) continue;
          s.add(pc);
        }
        return Array.from(s.values()).sort((a, b) => a - b);
      } catch {
        return [] as number[];
      }
    })();

    const after = (timeline as any[])
      .filter((e: any) => Number(e.absBeat) >= absBeat - 1e-6 && Number(e.absBeat) <= absBeat + 2.5 + 1e-6)
      .map((e: any) => {
        const rawNotes = ((e?.notes || []) as any[]).filter((n) => n && !n.isRest);
        const ab = qAbs(Number(e.absBeat));
        const c = ctxAt(Number(e.absBeat));
        const t = c ? String(c.newTonic) : tonic;
        const m = c ? !!c.newIsMinor : isMinor;
        return {
          absBeat: ab,
          romanGlobal: String(getRomanAnalysis(rawNotes as any, tonic, isMinor)?.roman || ''),
          romanCtx: String(getRomanAnalysis(rawNotes as any, t, m)?.roman || ''),
        };
      });

    return {
      point: p,
      absBeat: qAbs(absBeat),
      ctx: ctx ? { absBeat: ctx.absBeat, label: ctx.label, newTonic: ctx.newTonic, newIsMinor: ctx.newIsMinor } : null,
      roman: { global: rGlobal, ctx: rCtx },
      pcs,
      active,
      candidatesTop: cands,
      violations: hits,
      after,
    };
  };

  const points: DumpPoint[] = [
    { uiMeasure: 12, beat: 3 },
    { uiMeasure: 23, beat: 1 },
  ];

  console.log(
    JSON.stringify(
      {
        meta: { tonic, isMinor, ts, beatsPerMeasure, inferredCount: inferred.length, inferredTop: inferred.slice(0, 5) },
        dumps: points.map(dumpPoint),
      },
      null,
      2,
    ),
  );
}

main();
