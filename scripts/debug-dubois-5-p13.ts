import fs from 'node:fs';
import path from 'node:path';
import {
  applyHarmonyRules,
  getKeySignature,
  getActiveNotesTimeline,
  getRomanAnalysis,
  getChordSymbol,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
} from '../src/utils/musicTheory';
import type { StaffNote, TimeSignature, AnalysisContext, TimeSignatureChange } from '../src/types';

// Allow piping into tools that may close early (avoid noisy EPIPE crashes).
try {
  (process.stdout as any).on('error', (err: any) => {
    if (err && err.code === 'EPIPE') process.exit(0);
  });
} catch {
  // ignore
}

type ProjectJson = {
  notes: StaffNote[];
  keySignatureRoot: string;
  isMinorMode: boolean;
  timeSignature: TimeSignature;
  timeSignatureChanges?: TimeSignatureChange[];
  analysisContexts?: AnalysisContext[];
};

const qAbs = (x: number) => {
  const q = 192;
  return Math.round(Number(x) * q) / q;
};

const fmtBeat = (b: number) => (Number.isInteger(b) ? String(b) : b.toFixed(3));

const noteName = (n: any) => {
  const p = String(n?.pitch ?? '?');
  const o = Number(n?.octave);
  const a = String(n?.accidental ?? '');
  const acc = a === 'sharp' ? '#' : a === 'flat' ? 'b' : '';
  return `${p}${acc}${Number.isFinite(o) ? o : ''}`;
};

function absBeatFor(m1: number, beat1: number, ts: TimeSignature): number {
  const beatsPerMeasure = ts.numerator * (4 / ts.denominator);
  return (m1 - 1) * beatsPerMeasure + (beat1 - 1);
}

function main() {
  const defaultPath = path.resolve(process.cwd(), 'tests', 'Dubois 5 p 13.json');
  const fileArg = process.argv.find(a => a && !a.startsWith('-') && a.endsWith('.json'));
  const filePath = fileArg ? path.resolve(fileArg) : defaultPath;

  const raw = fs.readFileSync(filePath, 'utf8');
  const proj = JSON.parse(raw) as ProjectJson;

  const tonic = String(proj.keySignatureRoot || 'C');
  const isMinor = !!proj.isMinorMode;
  const ts = proj.timeSignature || { numerator: 4, denominator: 4 };
  const timeSignatureChanges = proj.timeSignatureChanges || [];
  const contexts = proj.analysisContexts || [];

  const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
  const analysis = applyHarmonyRules(proj.notes || [], keySig, tonic, isMinor, contexts, ts);
  const timeline = getActiveNotesTimeline((analysis as any).analyzedNotes || proj.notes || [], ts, timeSignatureChanges);

  const inferredContexts = ((analysis as any)?.inferredAnalysisContexts || []) as AnalysisContext[];
  const ctxAtAbsBeat = (absBeat: number) => {
    const all = ([...(contexts || []), ...(inferredContexts || [])] as AnalysisContext[])
      .filter(c => Number(c?.absBeat) <= absBeat + 1e-6)
      .sort((a, b) => Number(b.absBeat) - Number(a.absBeat));
    return all[0] || null;
  };

  const rangeIdx = process.argv.indexOf('--range');
  if (rangeIdx >= 0) {
    const from = Number(process.argv[rangeIdx + 1]);
    const to = Number(process.argv[rangeIdx + 2]);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      console.log(`\n=== Range absBeat ${from} .. ${to} ===`);
      for (const ev of timeline) {
        const a = qAbs(ev.absBeat);
        if (a < from - 1e-6 || a > to + 1e-6) continue;
        const chord = (ev.notes || []).filter(n => n && !(n as any).isRest);
        const ctx = ctxAtAbsBeat(Number(ev.absBeat));
        const ctxTonic = ctx ? String(ctx.newTonic || tonic) : tonic;
        const ctxMinor = ctx ? !!ctx.newIsMinor : isMinor;
        const roman = getRomanAnalysis(chord, ctxTonic, ctxMinor)?.roman || '';
        const l2 = computeFiguredBassFromNotes(chord as any, FIGURED_BASS_UI_OPTIONS).figures || [];
        const sym = (() => {
          try {
            return getChordSymbol(chord as any, keySig as any, tonic) || '';
          } catch {
            return '';
          }
        })();
        const ctxTag = ctx ? `${ctxTonic}${ctxMinor ? 'm' : ''}` : `${tonic}${isMinor ? 'm' : ''}`;
        console.log(`  @absBeat=${a} (m${ev.measureIndex + 1} b${fmtBeat(ev.beat)}): ctx=${ctxTag} roman=${roman || '-'} sym=${sym || '-'} L2=${l2.join('/') || '-'}`);
      }
      return;
    }
  }

  const targetM = 9;
  const targetB = 1;
  const ab = qAbs(absBeatFor(targetM, targetB, ts));
  const windowBeats = 0.51;

  console.log(`\n=== Target m${targetM} b${targetB} (absBeat≈${ab}) ===`);

  const events = timeline
    .map(ev => ({ ...ev, q: qAbs(ev.absBeat) }))
    .filter(ev => Math.abs(ev.q - ab) <= windowBeats)
    .sort((a, b) => a.absBeat - b.absBeat);

  for (const ev of events) {
    const chord = (ev.notes || []).filter(n => n && !(n as any).isRest);
    const ctx = ctxAtAbsBeat(Number(ev.absBeat));
    const ctxTonic = ctx ? String(ctx.newTonic || tonic) : tonic;
    const ctxMinor = ctx ? !!ctx.newIsMinor : isMinor;
    const roman = getRomanAnalysis(chord, ctxTonic, ctxMinor)?.roman || '';
    const romanGlobal = getRomanAnalysis(chord, tonic, isMinor)?.roman || '';
    const l2 = computeFiguredBassFromNotes(chord as any, FIGURED_BASS_UI_OPTIONS).figures || [];
    const sym = (() => {
      try {
        return getChordSymbol(chord as any, keySig as any, tonic) || '';
      } catch {
        return '';
      }
    })();

    const notesTxt = chord
      .slice()
      .sort((a: any, b: any) => (a?.midi ?? 0) - (b?.midi ?? 0))
      .map(n => `${noteName(n)}(v${(n as any).voice ?? '?'})`)
      .join(' ');

    const ctxTag = ctx ? `${ctxTonic}${ctxMinor ? 'm' : ''}` : `${tonic}${isMinor ? 'm' : ''}`;
    console.log(
      `  @absBeat=${ev.q} (m${ev.measureIndex + 1} b${fmtBeat(ev.beat)}): ctx=${ctxTag} roman=${roman || '-'} (global=${romanGlobal || '-'}) sym=${sym || '-'} L2=${l2.join('/') || '-'}\n    notes: ${notesTxt}`,
    );
  }

  console.log('\n=== Inferred contexts (engine) ===');
  console.log(JSON.stringify((analysis as any).inferredAnalysisContexts || [], null, 2));
}

main();
