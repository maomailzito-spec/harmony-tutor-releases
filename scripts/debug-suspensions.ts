import fs from 'node:fs';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getChordSymbol,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const main = () => {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-suspensions.ts <project.json>');
    process.exitCode = 2;
    return;
  }

  const raw = fs.readFileSync(projectPath, 'utf8');
  const proj = JSON.parse(raw);

  const keySignatureRoot = proj.keySignatureRoot || 'C';
  const isMinorMode = !!proj.isMinorMode;
  const timeSignature = proj.timeSignature || { numerator: 4, denominator: 4 };
  const keySig = getKeySignature(keySignatureRoot, isMinorMode ? 'Minor' : 'Major');

  const res = applyHarmonyRules(
    proj.notes,
    keySig as any,
    keySignatureRoot,
    isMinorMode,
    proj.analysisContexts || [],
    timeSignature,
  );

  const timeline = getActiveNotesTimeline(res.analyzedNotes as any, timeSignature as any);

  const susp = (res.analyzedNotes as any[])
    .filter((n) => n && n.isSuspension)
    .map((n) => ({
      id: n.id,
      voice: n.voice,
      pitch: `${n.pitch}${n.octave}`,
      midi: n.midi,
      fromAbsBeat: n.isSuspension?.fromAbsBeat,
      type: n.isSuspension?.type,
      resolvedById: n.isSuspension?.resolvedById,
    }));

  console.log('Key:', keySignatureRoot, isMinorMode ? 'minor' : 'major');
  console.log('Suspensions:', JSON.stringify(susp, null, 2));

  // Print events around the start of the piece and the barline into m.2
  const pick = (abs: number) => timeline.find((ev) => approxEq(ev.absBeat, abs));
  for (const abs of [0, 1, 2, 3, 4, 5, 6]) {
    const ev = pick(abs);
    if (!ev) continue;
    const ra = getRomanAnalysis((ev.notes || []) as any, keySignatureRoot, isMinorMode);
    const symbol = getChordSymbol((ev.notes || []) as any, keySig as any, keySignatureRoot);
    const notes = (ev.notes || [])
      .filter((n: any) => n && !n.isRest)
      .map((n: any) => ({
        id: n.id,
        v: n.voice,
        p: `${n.pitch}${n.octave}`,
        midi: n.midi,
        noteIndex: n.noteIndex,
        beat: n.beat,
        susFrom: n.isSuspension?.fromAbsBeat ?? null,
        pass: !!n.isPassing,
        neigh: !!n.isNeighbor,
        ant: !!n.isAnticipation,
        app: !!n.isAppoggiatura,
        esc: !!n.isEscape,
      }));
    console.log(
      JSON.stringify(
        {
          absBeat: ev.absBeat,
          beat: ev.beat,
          roman: ra?.roman ?? null,
          figures: ra?.figures ?? [],
          symbol: symbol ?? null,
          notes,
        },
        null,
        0,
      ),
    );
  }
};

main();
