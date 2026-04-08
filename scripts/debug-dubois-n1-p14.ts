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
  try {
    const p = String(n?.pitch ?? '?');
    const o = Number(n?.octave);
    const a = String(n?.accidental ?? '');
    const acc = a === 'sharp' ? '#' : a === 'flat' ? 'b' : '';
    return `${p}${acc}${Number.isFinite(o) ? o : ''}`;
  } catch {
    return '?';
  }
};

function absBeatFor(m1: number, beat1: number, ts: TimeSignature): number {
  const bpm = ts.numerator * (4 / ts.denominator);
  return (m1 - 1) * bpm + (beat1 - 1);
}

function main() {
  const defaultPath = path.resolve(process.cwd(), 'tests', 'Dubois n 1 p 14.json');
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
  const timeline = getActiveNotesTimeline(analysis.analyzedNotes || [], ts, timeSignatureChanges);

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

  const targets = [
    { label: 'm5 b2', m: 5, b: 2 },
    { label: 'm6 b1', m: 6, b: 1 },
    { label: 'm6 b2', m: 6, b: 2 },
    { label: 'm8 b4', m: 8, b: 4 },
    { label: 'm9 b2', m: 9, b: 2 },
    { label: 'm10 b3', m: 10, b: 3 },
    { label: 'm10 b4', m: 10, b: 4 },
  ];

  const windowBeats = 0.51;

  for (const t of targets) {
    const ab = absBeatFor(t.m, t.b, ts);
    const abq = qAbs(ab);
    console.log(`\n=== ${t.label} (absBeat≈${abq}) ===`);

    const events = timeline
      .map(ev => ({ ...ev, q: qAbs(ev.absBeat) }))
      .filter(ev => Math.abs(ev.q - abq) <= windowBeats)
      .sort((a, b) => a.absBeat - b.absBeat);

    if (events.length === 0) {
      console.log('  (no scan events near this beat)');
      continue;
    }

    for (const ev of events) {
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

      const notesTxt = chord
        .slice()
        .sort((a: any, b: any) => (a?.midi ?? 0) - (b?.midi ?? 0))
        .map(n => `${noteName(n)}(v${(n as any).voice ?? '?'})${(n as any).isSuspension ? '[S]' : ''}${(n as any).isPassing ? '[P]' : ''}${(n as any).isNeighbor ? '[N]' : ''}${(n as any).isAnticipation ? '[A]' : ''}`)
        .join(' ');

      const ctxTag = ctx ? `${ctxTonic}${ctxMinor ? 'm' : ''}` : `${tonic}${isMinor ? 'm' : ''}`;
      console.log(`  @absBeat=${ev.q} (m${ev.measureIndex + 1} b${fmtBeat(ev.beat)}): ctx=${ctxTag} roman=${roman || '-'}  sym=${sym || '-'}  L2=${l2.join('/') || '-'}\n    notes: ${notesTxt}`);
    }
  }

  console.log('\n=== Inferred contexts (engine) ===');
  console.log(JSON.stringify((analysis as any).inferredAnalysisContexts || [], null, 2));

  console.log('\n=== Auto label overrides (engine) ===');
  console.log(JSON.stringify((analysis as any).autoHarmonyLabelOverrides || [], null, 2));
}

main();
