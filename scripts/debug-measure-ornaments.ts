import fs from 'node:fs';

import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const main = () => {
  const projectPath = process.argv[2];
  const measure1Based = Number(process.argv[3] || '6');
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-measure-ornaments.ts /path/to/project.json [measureNumber]');
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

  const mIdx = Math.max(0, (measure1Based || 1) - 1);

  const rows = (res.analyzedNotes || [])
    .filter((n: any) => n && !n.isRest && (n.measureIndex ?? 0) === mIdx)
    .map((n: any) => ({
      beat: n.beat,
      v: n.voice ?? 1,
      p: `${n.pitch}${n.octave}`,
      midi: n.midi,
      dur: n.duration,
      pass: !!n.isPassing,
      neigh: !!n.isNeighbor,
      app: !!n.isAppoggiatura,
      ant: !!n.isAnticipation,
      esc: !!n.isEscape,
      susp: !!n.isSuspension,
    }))
    .sort((a: any, b: any) => (a.beat - b.beat) || (a.v - b.v) || (a.midi - b.midi));

  console.log(JSON.stringify({ measure: measure1Based, count: rows.length, rows }, null, 2));
};

main();
