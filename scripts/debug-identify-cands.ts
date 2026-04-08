import fs from 'node:fs';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  identifyChordCandidates,
} from '../src/utils/musicTheory';

const pc = (midi: number) => ((midi % 12) + 12) % 12;

const main = () => {
  const projectPath = process.argv[2];
  const measure1Based = Number(process.argv[3] || '5');
  const targetBeat = Number(process.argv[4] || '1');
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-identify-cands.ts /path/to/project.json [measure] [beat]');
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
  const mIdx = Math.max(0, measure1Based - 1);

  const ev = (tl || []).find((e: any) => (e.measureIndex ?? 0) === mIdx && Math.abs((e.beat ?? 0) - targetBeat) < 1e-6);
  if (!ev) {
    console.log('No event found');
    return;
  }

  const notes = (ev.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
  const pcs = [...new Set(notes.map((n: any) => pc(n.midi ?? 0)))].sort((a, b) => a - b);

  const cands = identifyChordCandidates(notes as any);
  const top = (cands as any[])
    .slice(0, 12)
    .map((c) => ({
      type: c.type,
      matchType: c.matchType,
      score: c.score,
      rootPc: Number.isFinite(c.root?.noteIndex) ? c.root.noteIndex : null,
      rootMidi: c.root?.midi ?? null,
    }));

  console.log(
    JSON.stringify(
      {
        at: { measure: measure1Based, beat: targetBeat },
        pcs,
        notes: notes
          .slice()
          .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))
          .map((n: any) => ({ v: n.voice ?? 1, midi: n.midi, pitch: `${n.pitch}${n.octave}`, noteIndex: n.noteIndex })),
        top,
      },
      null,
      2,
    ),
  );
};

main();
