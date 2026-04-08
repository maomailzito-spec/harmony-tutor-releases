import fs from 'node:fs';

import {
  applyHarmonyRules,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
  getActiveNotesTimeline,
  getChordSymbol,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

const beatsPerMeasureOf = (ts: any) => ts.numerator * (4 / ts.denominator);

const pc = (midi: number) => ((midi % 12) + 12) % 12;

const isCompound = (ts: any) => ts.denominator === 8 && (ts.numerator % 3 === 0) && ts.numerator > 3;

const isStrongPulseInMeasure = (inMeasureBeats0: number, ts: any) => {
  const EPS = 1e-3;
  if (!Number.isFinite(inMeasureBeats0)) return false;
  if (isCompound(ts)) {
    const pulse = 1.5;
    const r = ((inMeasureBeats0 % pulse) + pulse) % pulse;
    return Math.abs(r) < EPS || Math.abs(pulse - r) < EPS;
  }
  const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
  if (!nearInt(inMeasureBeats0)) return false;
  const beat0 = Math.round(inMeasureBeats0);
  return beat0 === 0 || (ts.numerator >= 4 && beat0 === 2);
};

const main = () => {
  const projectPath = process.argv[2];
  const measure1Based = Number(process.argv[3] || '5');
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-measure-events.ts /path/to/project.json [measureNumber]');
    process.exit(1);
  }

  const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const ts = proj.timeSignature;
  const bpm = beatsPerMeasureOf(ts);

  const tonic = proj.keyTonic || proj.keySignatureRoot;
  const keySig = getKeySignature(proj.keySignatureRoot, proj.isMinorMode ? 'Minor' : 'Major');

  const res = applyHarmonyRules(
    proj.notes,
    keySig,
    tonic,
    !!proj.isMinorMode,
    proj.analysisContexts || [],
    proj.timeSignature,
  );

  const mIdx = Math.max(0, (measure1Based || 1) - 1);
  const tl = getActiveNotesTimeline(res.analyzedNotes, ts);

  const events = (tl || []).filter((ev) => (ev.measureIndex ?? 0) === mIdx);

  const rows = events.map((ev) => {
    const notes = (ev.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
    const bass = notes.slice().sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
    const inMeasure0 = (Number(ev.absBeat) - mIdx * bpm);
    const strong = isStrongPulseInMeasure(inMeasure0, ts);

    const roman = getRomanAnalysis(notes as any, tonic, !!proj.isMinorMode)?.roman || '';
    const figures = computeFiguredBassFromNotes(notes as any, FIGURED_BASS_UI_OPTIONS).figures || [];
    const symbol = getChordSymbol(notes as any, keySig, tonic) || '';

    return {
      absBeat: ev.absBeat,
      beat: ev.beat,
      inMeasure0,
      strongPulse: strong,
      bass: bass ? { midi: bass.midi, pc: pc(bass.midi), pitch: `${bass.pitch}${bass.octave}` } : null,
      roman,
      figures,
      symbol,
      pcs: [...new Set(notes.map((n: any) => pc(n.midi ?? 0)))].sort((a, b) => a - b),
    };
  });

  console.log(JSON.stringify({ measure: measure1Based, bpm, timeSignature: ts, rows }, null, 2));
};

main();
