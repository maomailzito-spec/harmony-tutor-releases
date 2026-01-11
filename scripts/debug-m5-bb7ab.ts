import fs from 'node:fs';

import {
  applyHarmonyRules,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
  getActiveNotesTimeline,
  getChordSymbol,
  getKeySignature,
  getRomanAnalysis,
  identifyChordCandidates,
} from '../src/utils/musicTheory';

const pc = (midi: number) => ((midi % 12) + 12) % 12;

const main = () => {
  const projectPath = process.argv[2];
  const targetBeat = Number(process.argv[3] || '1');
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-m5-bb7ab.ts /path/to/project.json');
    process.exit(1);
  }

  const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
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

  const tl = getActiveNotesTimeline(res.analyzedNotes, proj.timeSignature);

  const pick = (tl || []).find((ev: any) => {
    if ((ev.measureIndex ?? 0) !== 4) return false; // measure 5
    if (Math.abs((ev.beat ?? 0) - targetBeat) > 1e-6) return false;

    const notes = (ev.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
    return notes.length >= 2;
  });

  if (!pick) {
    console.log('No match found at measure 5 beat 1.');
    process.exit(0);
  }

  const notes = (pick.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
  const bass = notes.slice().sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
  const roman = getRomanAnalysis(notes as any, tonic, !!proj.isMinorMode)?.roman || '';
  const figs = computeFiguredBassFromNotes(notes as any, FIGURED_BASS_UI_OPTIONS).figures || [];
  const symbol = getChordSymbol(notes as any, keySig, tonic);

  const top = (identifyChordCandidates(notes as any) as any[])
    .slice(0, 8)
    .map((c) => ({ type: c.type, matchType: c.matchType, score: c.score, rootPc: c.root?.noteIndex ?? null }));

  console.log(
    JSON.stringify(
      {
        at: { measure: 5, beat: targetBeat },
        bass: { midi: bass?.midi, pc: bass ? pc(bass.midi) : null, pitch: `${bass.pitch}${bass.octave}`, explicitAccidental: (bass as any).explicitAccidental ?? null },
        pcs: [...new Set(notes.map((n: any) => pc(n.midi ?? 0)))].sort((a, b) => a - b),
        roman,
        figures: figs,
        symbol,
        topCandidates: top,
        notes: notes
          .slice()
          .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))
          .map((n: any) => ({
            v: n.voice ?? 1,
            midi: n.midi,
            pitch: `${n.pitch}${n.octave}`,
            explicitAccidental: (n as any).explicitAccidental ?? null,
            userAccidental: (n as any).userAccidental ?? null,
            accidental: (n as any).accidental ?? null,
            noteIndex: (n as any).noteIndex,
          })),
      },
      null,
      2,
    ),
  );
};

main();
