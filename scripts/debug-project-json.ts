import fs from 'node:fs';

import {
  applyHarmonyRules,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const main = () => {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error('Usage: tsx scripts/debug-project-json.ts /path/to/project.json');
    process.exit(1);
  }

  const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
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

  const tl = getActiveNotesTimeline(res.analyzedNotes, proj.timeSignature);
  const beatsPerMeasure = proj.timeSignature.numerator * (4 / proj.timeSignature.denominator);

  const rows = (tl || []).filter((ev: any) => ev && Array.isArray(ev.notes) && ev.notes.length);

  for (const ev of rows) {
    const m = Math.floor(ev.absBeat / beatsPerMeasure);
    const beat = (ev.absBeat - m * beatsPerMeasure) + 1;

    const fullNotes = (ev.notes || []) as any[];

    const notesBrief = fullNotes
      .slice()
      .sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))
      .map((n) => {
        const susp = (n as any).isSuspension;
        const fromAbs = susp && typeof susp.fromAbsBeat === 'number' ? susp.fromAbsBeat : null;
        return {
          id: n.id,
          v: n.voice ?? 1,
          p: `${n.pitch}${n.octave}`,
          midi: n.midi,
          susp: !!susp,
          fromAbs,
          type: susp?.type ?? null,
        };
      });

    const analysisNotes = fullNotes.filter((n: any) => {
      const s = n?.isSuspension;
      if (!s || typeof s.fromAbsBeat !== 'number') return true;
      return Math.abs(s.fromAbsBeat - ev.absBeat) >= 1e-6;
    });

    const bassFull = fullNotes.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
    const bassAnalysis = analysisNotes.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];

    const figsFull = computeFiguredBassFromNotes(fullNotes as any, FIGURED_BASS_UI_OPTIONS).figures;
    const figsAnalysis = computeFiguredBassFromNotes(analysisNotes as any, FIGURED_BASS_UI_OPTIONS).figures;

    const romanFull = getRomanAnalysis(fullNotes as any, tonic, !!proj.isMinorMode)?.roman ?? '';
    const romanAnalysis = getRomanAnalysis(analysisNotes as any, tonic, !!proj.isMinorMode)?.roman ?? '';

    console.log(
      JSON.stringify(
        {
          absBeat: ev.absBeat,
          measure: m + 1,
          beat,
          bassFull: bassFull ? `${bassFull.pitch}${bassFull.octave}` : null,
          bassAnalysis: bassAnalysis ? `${bassAnalysis.pitch}${bassAnalysis.octave}` : null,
          romanFull,
          romanAnalysis,
          figsFull,
          figsAnalysis,
          notes: notesBrief,
        },
        null,
        2,
      ),
    );
  }

  // quick check: any places where analysis figs collapse to just ['6']?
  const suspicious = rows.filter((ev: any) => {
    const analysisNotes = (ev.notes || []).filter((n: any) => {
      const s = n?.isSuspension;
      if (!s || typeof s.fromAbsBeat !== 'number') return true;
      return !approxEq(s.fromAbsBeat, ev.absBeat);
    });
    const figs = computeFiguredBassFromNotes(analysisNotes as any, FIGURED_BASS_UI_OPTIONS).figures || [];
    return figs.length === 1 && String(figs[0]) === '6';
  });
  if (suspicious.length) {
    console.log('Found events with figsAnalysis == ["6"] at absBeats:', suspicious.map((e: any) => e.absBeat));
  }
};

main();
