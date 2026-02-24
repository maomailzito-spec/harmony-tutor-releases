/**
 * Debug: trace label pipeline for Corale 1D Bach, m8 b4 (V/V missing)
 * Uses computeHarmonyLabelsBySystem to see all labels and timeline.
 */
import fx from './Corale 1D Bach.json';
import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { filterTimelineForHarmonyLabels, structuralNotes } from '../src/utils/harmonyLabelPipeline';
import { ALL_NOTE_SPELLINGS, NOTE_NAMES } from '../src/constants';
import type { TimeSignature } from '../src/types';

function beatsPerMeasure(ts: TimeSignature): number {
  return ts.numerator * (4 / ts.denominator);
}

function analysisContextAbsBeat(ts: TimeSignature, ctx: any): number {
  const bpm = beatsPerMeasure(ts) || 4;
  const a = Number(ctx?.absBeat);
  if (Number.isFinite(a)) return a;
  const mi = Number(ctx?.measureIndex ?? 0);
  if (Number.isFinite(mi)) return mi * bpm;
  return 0;
}

function noteNameToChromaticIndex(name: string): number {
  const idxSharp = NOTE_NAMES.indexOf(name);
  if (idxSharp >= 0) return idxSharp;
  const normalized = String(name || '').replace('♯', '#').replace('♭', 'b');
  for (let i = 0; i < ALL_NOTE_SPELLINGS.length; i++) {
    if (ALL_NOTE_SPELLINGS[i].includes(normalized)) return i;
  }
  return -1;
}

function makeFakeLayoutData(ts: TimeSignature, notes: any[]) {
  const maxMI = Math.max(0, ...notes.map((n: any) => (Number.isFinite(n?.measureIndex) ? Number(n.measureIndex) : 0)));
  const bpm = beatsPerMeasure(ts) || 4;
  const measureStartAbsBeat: number[] = [];
  const measureBeatsPerMeasure: number[] = [];
  for (let m = 0; m <= maxMI + 2; m++) {
    measureStartAbsBeat[m] = m * bpm;
    measureBeatsPerMeasure[m] = bpm;
  }
  const measureIndices = Array.from({ length: maxMI + 1 }, (_, i) => i);
  const measureWidth = 120;
  const startMeasuresX = measureIndices.map((_, i) => i * measureWidth);
  const width = (measureIndices.length + 1) * measureWidth;
  return {
    positionedNotes: notes,
    measureStartAbsBeat,
    measureBeatsPerMeasure,
    systemsParams: [{ measureIndices, startMeasuresX, width }],
  };
}

function main() {
  const notes = (fx as any).notes || [];
  const ts = ((fx as any).timeSignature || { numerator: 4, denominator: 4 }) as TimeSignature;
  const keyTonic = String((fx as any).keySignatureRoot || 'C');
  const isMinor = Boolean((fx as any).isMinorMode);
  const ks = getKeySignature(keyTonic, isMinor ? 'Minor' : 'Major');

  const res: any = applyHarmonyRules(notes as any, ks as any, keyTonic, isMinor,
    ((fx as any).analysisContexts || []) as any, ts as any,
    (fx as any).doubleBarlineMeasures || [],
    (fx as any).ornamentOverrides || []);

  const analyzedNotes = (res?.analyzedNotes || notes) as any[];
  const inferred = (res?.inferredAnalysisContexts || []) as any[];
  const effectiveCtx = [...((fx as any).analysisContexts || []), ...(inferred || [])]
    .sort((a: any, b: any) => analysisContextAbsBeat(ts, a) - analysisContextAbsBeat(ts, b));

  console.log('Tonic:', keyTonic, '| Minor:', isMinor, '| BPM:', beatsPerMeasure(ts));
  console.log('Inferred contexts:', inferred.length);

  // === Step 1: Check the raw timeline ===
  const rawTimeline = getActiveNotesTimeline(analyzedNotes, ts, []);
  const bpm = beatsPerMeasure(ts) || 4;
  console.log('\n=== Raw timeline events for m8 (absBeat 28-32) ===');
  for (const ev of rawTimeline) {
    const ab = Number(ev?.absBeat);
    if (ab >= 28 - 0.01 && ab < 32 + 0.01) {
      const notes_ = (ev?.notes || []) as any[];
      const pitches = notes_.map((n: any) => {
        const acc = n.explicitAccidental === 'sharp' ? '#' : n.explicitAccidental === 'flat' ? 'b' : '';
        return `${n.pitch}${acc}${n.octave}`;
      });
      const ncts = notes_.filter((n: any) => n.isPassing || n.isNeighbor || n.isAppoggiatura || n.isEscape || n.isAnticipation);
      console.log(`  absBeat=${ab.toFixed(2)}: ${pitches.join(' ')} | NCTs: ${ncts.length}`);
    }
  }

  // === Step 2: Check filtered timeline ===
  const filteredTimeline = filterTimelineForHarmonyLabels(rawTimeline, ts, 0);
  console.log('\n=== Filtered timeline events for m8 ===');
  for (const ev of filteredTimeline) {
    const ab = Number(ev?.absBeat);
    if (ab >= 28 - 0.01 && ab < 32 + 0.01) {
      const notes_ = (ev?.notes || []) as any[];
      const pitches = notes_.map((n: any) => `${n.pitch}${n.explicitAccidental === 'sharp' ? '#' : ''}${n.octave}`);
      console.log(`  absBeat=${ab.toFixed(2)}: ${pitches.join(' ')}`);
    }
  }

  // === Step 3: Get labels from computeHarmonyLabelsBySystem ===
  const layoutData = makeFakeLayoutData(ts, analyzedNotes);
  const labelsBySystem = computeHarmonyLabelsBySystem({
    isAnalysisEnabled: true,
    layoutData,
    timeSignature: ts,
    timeSignatureChanges: (fx as any).timeSignatureChanges || [],
    effectiveAnalysisContexts: effectiveCtx,
    analysisContextAbsBeat: (c: any) => analysisContextAbsBeat(ts, c),
    currentTonic: keyTonic,
    isMinorMode: isMinor,
    harmonyOverrides: (fx as any).harmonyOverrides || [],
    analysisResult: res,
    analyzedNotes,
    noteNameToChromaticIndex,
    startX: 0,
    measurePaddingX: 10,
    harmonyLabelMinSpanBeats: 0,
    useStatisticalCorrection: false,
  });

  console.log('\n=== Labels for m8 (absBeat 28-32) ===');
  for (const sys of labelsBySystem) {
    for (const lbl of sys || []) {
      const ab = Number((lbl as any)?.absBeat);
      if (ab >= 28 - 0.01 && ab < 32 + 0.01) {
        console.log(`  absBeat=${ab.toFixed(2)}: roman="${lbl.roman}" hidden=${!!(lbl as any).hiddenMarker} figures=${JSON.stringify(lbl.figures)}`);
      }
    }
  }

  // === Step 4: Check ALL labels for m7-m9 (measure indices 6-8) ===
  console.log('\n=== ALL labels m7-m9 (absBeat 24-36) ===');
  for (const sys of labelsBySystem) {
    for (const lbl of sys || []) {
      const ab = Number((lbl as any)?.absBeat);
      if (ab >= 24 - 0.01 && ab < 36 + 0.01) {
        const mi = Math.floor(ab / bpm) + 1;
        const beat = (ab % bpm) + 1;
        console.log(`  m${mi} b${beat.toFixed(1)}: roman="${lbl.roman}" hidden=${!!(lbl as any).hiddenMarker} figures=${JSON.stringify(lbl.figures)} display=${(lbl as any).romanDisplay || ''}`);
      }
    }
  }

  // === Step 5: Direct Roman analysis for m8 b4 structural notes ===
  console.log('\n=== Direct getRomanAnalysis for m8 b4 ===');
  const m8b4 = analyzedNotes.filter((n: any) =>
    n && !n.isRest && n.measureIndex === 7 && Math.abs(Number(n.beat) - 4) < 0.05
  );
  const structural = m8b4.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isSuspension);
  const directResult = getRomanAnalysis(structural as any, keyTonic, isMinor);
  console.log(`Structural: ${structural.map((n: any) => `${n.pitch}${n.explicitAccidental || ''}${n.octave}`).join(' ')}`);
  console.log(`Roman: ${JSON.stringify(directResult)}`);
}

main();
