import fs from 'node:fs';

import {
  applyHarmonyRules,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

type Point = { measure: number; eighth?: number; beat?: number; label: string };

const beatsPerMeasureOf = (ts: any) => ts.numerator * (4 / ts.denominator);

const beatFromEighth = (eighth: number) => 1 + (eighth - 1) * 0.5;

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const main = () => {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-project-points.ts /path/to/project.json');
    process.exit(1);
  }

  const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const ts = proj.timeSignature;
  const bpm = beatsPerMeasureOf(ts);

  const tonic = proj.keyTonic || proj.keySignatureRoot;
  const mode = proj.isMinorMode ? 'Minor' : 'Major';
  const keySig = getKeySignature(proj.keySignatureRoot, mode);

  const res = applyHarmonyRules(
    proj.notes,
    keySig,
    tonic,
    !!proj.isMinorMode,
    proj.analysisContexts || [],
    proj.timeSignature,
  );

  const points: Point[] = [
    { measure: 2, eighth: 3, label: 'm2 3rd eighth' },
    { measure: 3, eighth: 6, label: 'm3 6th eighth' },
    { measure: 5, eighth: 1, label: 'm5 downbeat' },
    { measure: 5, eighth: 3, label: 'm5 3rd eighth' },
    { measure: 6, eighth: 5, label: 'm6 after 4th eighth (5th eighth)' },
    { measure: 7, eighth: 1, label: 'm7 downbeat' },
    { measure: 7, eighth: 4, label: 'm7 4th eighth' },
  ];

  const snapshots = points.map((p) => {
    const beat = p.beat ?? (p.eighth ? beatFromEighth(p.eighth) : 1);
    const absBeat = (p.measure - 1) * bpm + (beat - 1);

    // pick closest event in analyzedNotes scanpoints by matching start beats
    const ev = (res as any).chordEvents
      ? (res as any).chordEvents.find((e: any) => approxEq(e.absBeat, absBeat))
      : null;

    // fallback: use active notes at this absBeat from analyzed notes directly
    const active = (res.analyzedNotes || []).filter((n: any) => {
      if (!n || n.isRest) return false;
      const start = (n.measureIndex ?? 0) * bpm + ((n.beat ?? 1) - 1);
      const base = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25, 'thirty-second': 0.125, 'sixty-fourth': 0.0625 } as any)[n.duration || 'quarter'] || 1;
      let len = base;
      if (n.isDotted) len *= 1.5;
      if (n.isTriplet) len *= 2 / 3;
      if (n.isDuplet) len *= 3 / 2;
      return start <= absBeat + 1e-6 && absBeat < (start + len - 1e-6);
    });

    const notes = ev?.notes || active;
    const filtered = (notes || []).filter((n: any) => {
      if (!n || n.isRest) return false;
      const anyN = n as any;
      return !(
        anyN.isPassing ||
        anyN.isNeighbor ||
        anyN.isAnticipation ||
        anyN.isAppoggiatura ||
        anyN.isEscape
      );
    });

    const roman = getRomanAnalysis(filtered as any, tonic, !!proj.isMinorMode)?.roman ?? '';
    const figures = computeFiguredBassFromNotes(filtered as any, FIGURED_BASS_UI_OPTIONS).figures || [];

    const brief = (notes || [])
      .slice()
      .filter((n: any) => n && !n.isRest)
      .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))
      .map((n: any) => ({
        v: n.voice ?? 1,
        p: `${n.pitch}${n.octave}`,
        midi: n.midi,
        pass: !!n.isPassing,
        neigh: !!n.isNeighbor,
        app: !!n.isAppoggiatura,
        ant: !!n.isAnticipation,
        esc: !!n.isEscape,
      }));

    return {
      label: p.label,
      measure: p.measure,
      beat,
      absBeat,
      notes: brief,
      filteredCount: filtered.length,
      roman,
      figures,
    };
  });

  console.log(JSON.stringify({ tonic, mode, timeSignature: ts, snapshots }, null, 2));
};

main();
