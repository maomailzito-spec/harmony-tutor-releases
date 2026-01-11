import fs from 'node:fs';

import {
  applyHarmonyRules,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

const pc = (midi: number) => ((midi % 12) + 12) % 12;

const hasFigValue = (figs: string[], v: number) =>
  (figs || []).some((f) => String(f).includes(String(v)));

const main = () => {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-find-pedron-spots.ts /path/to/project.json');
    process.exit(1);
  }

  const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const ts = proj.timeSignature;

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

  const tl = getActiveNotesTimeline(res.analyzedNotes, ts);

  const matches: any[] = [];

  for (const ev of tl) {
    const notes = (ev.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
    if (notes.length < 2) continue;

    const bass = notes.slice().sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
    const bassPc = pc(bass.midi ?? 0);

    const roman = getRomanAnalysis(notes as any, tonic, !!proj.isMinorMode)?.roman || '';
    const figures = computeFiguredBassFromNotes(notes as any, FIGURED_BASS_UI_OPTIONS).figures || [];
    const pcs = [...new Set(notes.map((n: any) => pc(n.midi ?? 0)))].sort((a, b) => a - b);

    // Spot A: Bb7/Ab (V 4/2 in Eb): bass Ab (pc=8) and figures contain 4 & 2.
    const isAb42 = bassPc === 8 && hasFigValue(figures, 4) && hasFigValue(figures, 2);

    // Spot B: B°7-like set {B,D,F,Ab} => pcs == [2,5,8,11]
    const isBDFA = pcs.length === 4 && pcs.join(',') === '2,5,8,11';

    if (isAb42 || isBDFA) {
      matches.push({
        tag: isAb42 ? 'Ab-bass 4/2' : 'B-D-F-Ab set',
        measure: (ev.measureIndex ?? 0) + 1,
        beat: ev.beat,
        roman,
        figures,
        bassMidi: bass.midi,
        pcs,
        notes: notes
          .slice()
          .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))
          .map((n: any) => ({ v: n.voice ?? 1, midi: n.midi, p: `${n.pitch}${n.octave}` })),
      });
    }
  }

  console.log(JSON.stringify({ tonic, timeSignature: ts, count: matches.length, matches: matches.slice(0, 50) }, null, 2));
};

main();
