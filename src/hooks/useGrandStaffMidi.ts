import { useCallback, useRef } from 'react';
import type { AccompanimentTrack, StaffNote, TimeSignature, TimeSignatureChange, Voice } from '../types';
import { TICKS_PER_QUARTER } from '../constants';
import { getKeySignature, getNotePropertiesFromMidi } from '../utils/musicTheory';
import { buildMidiFile } from '../utils/midiWriter';
import { parseMidi, type ParsedMidiNote } from '../utils/midiParser';
import { electronBridge } from '../services/electronBridge';
import { usePreference } from '../preferences/usePreference';

export type GrandStaffMidiProject = {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  timeSignatureChanges?: TimeSignatureChange[];
  keySignatureRoot: string;
  isMinorMode: boolean;
  bpm?: number;
};

export type UseGrandStaffMidiArgs = {
  project: GrandStaffMidiProject;
  setProject: (next: Partial<GrandStaffMidiProject> & { notes: StaffNote[] }) => void;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function beatsToDurationFlags(beats: number): { duration: StaffNote['duration']; isDotted: boolean; isTriplet: boolean; isDuplet: boolean } {
  const bases: Array<{ duration: StaffNote['duration']; beats: number }> = [
    { duration: 'whole', beats: 4 },
    { duration: 'half', beats: 2 },
    { duration: 'quarter', beats: 1 },
    { duration: 'eighth', beats: 0.5 },
    { duration: 'sixteenth', beats: 0.25 },
    { duration: 'thirty-second', beats: 0.125 },
    { duration: 'sixty-fourth', beats: 0.0625 },
  ];

  // Tolerance allowed for "rounding UP" to a longer standard duration. Anything
  // beyond this gap means the actual MIDI duration is genuinely shorter than
  // the candidate — picking the longer label would silently extend the note.
  // Tolerance = ~6% of a quarter (matches the quantizer's release-lag window).
  const UP_TOLERANCE_BEATS = 0.0625; // 60 ticks at TPQ 960

  let best = { duration: 'quarter' as StaffNote['duration'], isDotted: false, isTriplet: false, isDuplet: false, diff: Infinity };
  for (const base of bases) {
    const candidates = [
      { isDotted: false, isTriplet: false, isDuplet: false, value: base.beats },
      { isDotted: true, isTriplet: false, isDuplet: false, value: base.beats * 1.5 },
      { isDotted: false, isTriplet: true, isDuplet: false, value: base.beats * (2 / 3) },
      { isDotted: false, isTriplet: false, isDuplet: true, value: base.beats * (3 / 2) },
    ];
    for (const c of candidates) {
      // Reject candidates that would auto-extend the note past its actual length
      // by more than the tolerance: prefer SHORTER standard durations when in
      // doubt. The rhythmic normaliser can always decompose a residue into
      // tied shorter notes, but a wrongly-extended note can't be recovered.
      if (c.value > beats + UP_TOLERANCE_BEATS) continue;
      const diff = Math.abs(c.value - beats);
      if (diff < best.diff) {
        best = { duration: base.duration, isDotted: c.isDotted, isTriplet: c.isTriplet, isDuplet: c.isDuplet, diff };
      }
    }
  }

  // Safety: if every candidate was rejected (e.g. beats is smaller than the
  // shortest standard duration), fall back to the original nearest-match search.
  if (best.diff === Infinity) {
    for (const base of bases) {
      const candidates = [
        { isDotted: false, isTriplet: false, isDuplet: false, value: base.beats },
        { isDotted: true, isTriplet: false, isDuplet: false, value: base.beats * 1.5 },
        { isDotted: false, isTriplet: true, isDuplet: false, value: base.beats * (2 / 3) },
        { isDotted: false, isTriplet: false, isDuplet: true, value: base.beats * (3 / 2) },
      ];
      for (const c of candidates) {
        const diff = Math.abs(c.value - beats);
        if (diff < best.diff) {
          best = { duration: base.duration, isDotted: c.isDotted, isTriplet: c.isTriplet, isDuplet: c.isDuplet, diff };
        }
      }
    }
  }

  return {
    duration: best.duration,
    isDotted: best.isDotted,
    isTriplet: best.isTriplet,
    isDuplet: best.isDuplet,
  };
}

function inferClefFromMidi(midi: number): 'treble' | 'bass' {
  return midi < 60 ? 'bass' : 'treble';
}

/** Convert one ParsedMidiNote into a StaffNote. The voice/clef strategy is supplied
 *  by the caller: SATB import passes a Voice 1..4 derived from track/channel/pitch,
 *  accompaniment import passes 0 for all notes. Pitch/duration/timing logic is identical. */
function convertParsedNoteToStaffNote(
  n: ParsedMidiNote,
  idx: number,
  tpq: number,
  beatsPerMeasure: number,
  keySig: ReturnType<typeof getKeySignature>,
  voice: number,
  clefOverride?: 'treble' | 'bass',
): StaffNote {
  const absBeats = n.tick / tpq;
  const durBeats = n.durationTicks / tpq;
  const measureIndex = Math.max(0, Math.floor(absBeats / Math.max(1, beatsPerMeasure)));
  const beat = 1 + (absBeats - (measureIndex * beatsPerMeasure));

  const clef = clefOverride ?? inferClefFromMidi(n.midi);
  const props = getNotePropertiesFromMidi(n.midi, keySig, clef, null);
  const durationInfo = beatsToDurationFlags(durBeats);

  const appStartTick = Math.max(0, Math.round(absBeats * TICKS_PER_QUARTER));
  const appDurationTicks = Math.max(1, Math.round(durBeats * TICKS_PER_QUARTER));

  return {
    id: `midi-${idx}-${appStartTick}-${n.midi}`,
    ...props,
    duration: durationInfo.duration,
    isRest: false,
    isTriplet: durationInfo.isTriplet,
    isDuplet: durationInfo.isDuplet,
    isDotted: durationInfo.isDotted,
    measureIndex,
    beat,
    startTick: appStartTick,
    durationTicks: appDurationTicks,
    voice: voice as Voice,
    velocity: n.velocity,
  };
}

/** Standard rest durations in descending tick order. Used for greedy gap-filling.
 *  Order per spec: whole, dotted-half, half, dotted-quarter, quarter,
 *  dotted-eighth, eighth, sixteenth, thirty-second. */
const REST_DURATIONS_DESC: Array<{ name: StaffNote['duration']; ticks: number; isDotted: boolean }> = [
  { name: 'whole', ticks: 4 * TICKS_PER_QUARTER, isDotted: false },      // 3840
  { name: 'half', ticks: 3 * TICKS_PER_QUARTER, isDotted: true },        // 2880 (dotted half)
  { name: 'half', ticks: 2 * TICKS_PER_QUARTER, isDotted: false },       // 1920
  { name: 'quarter', ticks: Math.round(1.5 * TICKS_PER_QUARTER), isDotted: true }, // 1440 (dotted quarter)
  { name: 'quarter', ticks: TICKS_PER_QUARTER, isDotted: false },        // 960
  { name: 'eighth', ticks: Math.round(0.75 * TICKS_PER_QUARTER), isDotted: true }, // 720 (dotted eighth)
  { name: 'eighth', ticks: Math.round(0.5 * TICKS_PER_QUARTER), isDotted: false }, // 480
  { name: 'sixteenth', ticks: Math.round(0.25 * TICKS_PER_QUARTER), isDotted: false }, // 240
  { name: 'thirty-second', ticks: Math.round(0.125 * TICKS_PER_QUARTER), isDotted: false }, // 120
];

function makeRestId(): string {
  return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `rest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a sequence of standard rests covering [gapStart, gapEnd) within one measure.
 *  Quarter-note boundary rule: a rest may only cross a quarter boundary (offset within
 *  the measure divisible by TICKS_PER_QUARTER) if it STARTS on one. This keeps rest
 *  rhythms readable without overengineering beat-strong/weak grouping. */
function buildRestsForGap(
  gapStart: number,
  gapEnd: number,
  measureIndex: number,
  measureStartTick: number,
  voice: number,
  clef: 'treble' | 'bass',
): StaffNote[] {
  const out: StaffNote[] = [];
  if (gapEnd <= gapStart) return out;

  const Q = TICKS_PER_QUARTER;
  // MIDI imports often have note durations a few ticks shy of the ideal value
  // (e.g. 472 instead of 480 due to legato/release timing). Snap the cursor
  // to the nearest 8th-note boundary when within this tolerance so off-grid
  // residues don't get filled with tiny illegitimate rests.
  const SNAP_UNIT = Math.floor(Q / 2); // 480 = eighth note
  const SNAP_TOLERANCE = Math.floor(Q / 16); // 60 ticks = ~6% of a quarter
  let cursor = gapStart;
  let safety = 0;
  while (cursor < gapEnd && safety < 128) {
    safety++;

    // Snap cursor to nearest 8th-note boundary if within tolerance.
    {
      const localOffset = cursor - measureStartTick;
      const nearest8thOffset = Math.round(localOffset / SNAP_UNIT) * SNAP_UNIT;
      const snapDelta = Math.abs(localOffset - nearest8thOffset);
      if (snapDelta > 0 && snapDelta <= SNAP_TOLERANCE) {
        const snapped = Math.min(measureStartTick + nearest8thOffset, gapEnd);
        cursor = snapped;
        if (cursor >= gapEnd) break;
      }
    }

    const remaining = gapEnd - cursor;
    const offsetInMeasure = cursor - measureStartTick;
    const onQuarter = offsetInMeasure % Q === 0;

    let cap = remaining;
    if (!onQuarter) {
      const nextQuarterOffset = (Math.floor(offsetInMeasure / Q) + 1) * Q;
      const nextQuarterTick = measureStartTick + nextQuarterOffset;
      cap = Math.min(remaining, nextQuarterTick - cursor);
    }

    const pick = REST_DURATIONS_DESC.find(d => d.ticks <= cap);
    if (!pick) break;

    const localTick = cursor - measureStartTick;
    out.push({
      id: makeRestId(),
      pitch: 'B',
      octave: clef === 'bass' ? 2 : 4,
      position: clef === 'bass' ? 4 : 8,
      midi: 0,
      noteIndex: 0,
      duration: pick.name,
      isRest: true,
      isTriplet: false,
      isDuplet: false,
      isDotted: pick.isDotted,
      measureIndex,
      beat: (localTick / Q) + 1,
      startTick: cursor,
      durationTicks: pick.ticks,
      clef,
      voice: voice as Voice,
    });
    cursor += pick.ticks;
  }
  return out;
}

/** Extend note durations to fill small staccato gaps before the rest-filler runs.
 *  When a MIDI note is played short (e.g. 472 ticks for an intended quarter = 960),
 *  this extends durationTicks to the next onset in the same (voice, clef) stream.
 *  Only applies when the remaining gap ≤ TICKS_PER_QUARTER so intentional rests
 *  longer than one beat are preserved.
 *
 *  ticksPerMeasure is used to compute the "measure end" for the last note in a group. */
export function extendNotesToNextOnset(notes: StaffNote[], ticksPerMeasure: number): StaffNote[] {
  if (notes.length === 0) return notes;

  const groups = new Map<string, number[]>();
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const key = `${n.voice ?? 0}:${n.clef ?? 'treble'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  const result = notes.map(n => ({ ...n }));

  for (const indices of groups.values()) {
    // Compute sorted list of DISTINCT onset ticks so chord tones (same startTick)
    // are treated as a unit — all get the same nextTick and the same extension.
    const tickSet = new Set(indices.map(i => notes[i].startTick ?? 0));
    const distinctTicks = [...tickSet].sort((a, b) => a - b);

    for (let ti = 0; ti < distinctTicks.length; ti++) {
      const currentTick = distinctTicks[ti];
      const nextTick = ti + 1 < distinctTicks.length
        ? distinctTicks[ti + 1]
        : (Math.floor(currentTick / ticksPerMeasure) + 1) * ticksPerMeasure;

      for (const idx of indices) {
        const note = result[idx];
        if ((note.startTick ?? 0) !== currentTick) continue;
        // Leave snapper-confirmed triplets alone: extending them would swallow the
        // intentional triplet rests and turn eighth-triplets into quarter-triplets.
        if (note.isTriplet || note.isDuplet) continue;
        const noteEnd = currentTick + (note.durationTicks ?? 0);
        const gap = nextTick - noteEnd;
        if (gap > 0 && gap <= TICKS_PER_QUARTER) {
          note.durationTicks = nextTick - currentTick;
          const dFlags = beatsToDurationFlags(note.durationTicks / TICKS_PER_QUARTER);
          note.duration = dFlags.duration;
          note.isDotted = dFlags.isDotted;
          note.isTriplet = dFlags.isTriplet;
          note.isDuplet = dFlags.isDuplet;
        }
      }
    }
  }

  return result;
}

/** Inserisce pause esplicite per coprire i gap ritmici in ogni voce/misura.
 *  Da chiamare dopo la conversione MIDI → StaffNote[]. */
function fillRestsAfterImport(
  notes: StaffNote[],
  timeSignature: { numerator: number; denominator: number },
  timeSignatureChanges: Array<{ measureIndex: number; numerator: number; denominator: number }>,
): StaffNote[] {
  if (notes.length === 0) return notes;

  // Time signature lookup: walk sorted changes, fall back to base.
  const sortedChanges = [...timeSignatureChanges].sort((a, b) => a.measureIndex - b.measureIndex);
  const tsForMeasure = (mi: number) => {
    let active = timeSignature;
    for (const c of sortedChanges) {
      if (c.measureIndex <= mi) active = { numerator: c.numerator, denominator: c.denominator };
      else break;
    }
    return active;
  };
  const ticksForMeasure = (mi: number): number => {
    const ts = tsForMeasure(mi);
    return TICKS_PER_QUARTER * ts.numerator * (4 / ts.denominator);
  };

  // Pre-compute measureStartTick for all measures up to maxMeasureIdx.
  const maxMeasureIdx = notes.reduce((mx, n) => Math.max(mx, n.measureIndex ?? 0), 0);
  const measureStartTicks: number[] = new Array(maxMeasureIdx + 2);
  let acc = 0;
  for (let m = 0; m <= maxMeasureIdx + 1; m++) {
    measureStartTicks[m] = acc;
    acc += ticksForMeasure(m);
  }

  // Group notes by (voice, clef). For SATB each voice typically has a single
  // clef so this collapses to "by voice". For ACC (voice=0) it splits the track
  // into treble and bass streams that are filled independently — otherwise
  // treble notes would "cover" bass gaps (and vice versa) when merged.
  type Stream = { voice: number; clef: 'treble' | 'bass'; notes: StaffNote[] };
  const streams = new Map<string, Stream>();
  for (const n of notes) {
    const v = (n.voice ?? 0) as number;
    const c: 'treble' | 'bass' = (n.clef === 'bass') ? 'bass' : 'treble';
    const key = `${v}:${c}`;
    let s = streams.get(key);
    if (!s) {
      s = { voice: v, clef: c, notes: [] };
      streams.set(key, s);
    }
    s.notes.push(n);
  }

  const out: StaffNote[] = [];

  for (const stream of streams.values()) {
    const { voice, clef, notes: streamNotes } = stream;

    // Group by measure inside this (voice, clef) stream.
    const byMeasure = new Map<number, StaffNote[]>();
    for (const n of streamNotes) {
      const m = n.measureIndex ?? 0;
      if (!byMeasure.has(m)) byMeasure.set(m, []);
      byMeasure.get(m)!.push(n);
    }
    const measureIdxs = [...byMeasure.keys()].sort((a, b) => a - b);
    if (measureIdxs.length === 0) continue;
    const firstMeasure = measureIdxs[0];
    const lastMeasure = measureIdxs[measureIdxs.length - 1];

    // Cursor is monotonic across measures of this stream so a note that spills
    // into the next measure doesn't trigger a spurious leading rest.
    let cursor = measureStartTicks[firstMeasure] ?? 0;

    for (let m = firstMeasure; m <= lastMeasure; m++) {
      const measureStart = measureStartTicks[m] ?? 0;
      const measureEnd = measureStart + ticksForMeasure(m);
      if (cursor < measureStart) cursor = measureStart;

      const measureNotes = (byMeasure.get(m) ?? [])
        .slice()
        .sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));

      for (const note of measureNotes) {
        const noteStart = note.startTick ?? cursor;
        const noteDur = note.durationTicks ?? 0;
        if (noteStart > cursor) {
          out.push(...buildRestsForGap(cursor, noteStart, m, measureStart, voice, clef));
        }
        out.push(note);
        cursor = Math.max(cursor, noteStart + noteDur);
      }

      if (cursor < measureEnd) {
        out.push(...buildRestsForGap(cursor, measureEnd, m, measureStart, voice, clef));
        cursor = measureEnd;
      }
    }
  }

  out.sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0) || ((a.voice ?? 0) - (b.voice ?? 0)));
  return out;
}

/** MIDI timing quantisation: snaps near-grid onsets and near-standard durations
 *  to clean values so the rhythmic normaliser doesn't fragment slightly-off
 *  timings (e.g. a quarter recorded as 950 ticks) into chains of tied 32nd /
 *  64th notes. Tolerance is intentionally tight (60 ticks ≈ 1/16 quarter) so
 *  legitimate 16ths (240 ticks from the nearest 8th) are never absorbed. */
const QUANTIZE_GRID_TICKS = TICKS_PER_QUARTER / 2;          // 480 = 8th note grid
const QUANTIZE_TOLERANCE_TICKS = TICKS_PER_QUARTER / 16;    // 60 ticks

/** Standard musical durations available for snap (must match STANDARD_DURATIONS
 *  in the normaliser below — duplicated here to avoid a forward reference). */
const STANDARD_DURATION_TICKS: number[] = [
  4 * TICKS_PER_QUARTER,                   // 3840 whole
  3 * TICKS_PER_QUARTER,                   // 2880 dotted half
  2 * TICKS_PER_QUARTER,                   // 1920 half
  Math.round(1.5 * TICKS_PER_QUARTER),     // 1440 dotted quarter
  TICKS_PER_QUARTER,                       // 960  quarter
  Math.round(0.75 * TICKS_PER_QUARTER),    // 720  dotted eighth
  Math.round(0.5 * TICKS_PER_QUARTER),     // 480  eighth
  Math.round(0.375 * TICKS_PER_QUARTER),   // 360  dotted sixteenth
  Math.round(0.25 * TICKS_PER_QUARTER),    // 240  sixteenth
  Math.round(0.125 * TICKS_PER_QUARTER),   // 120  thirty-second
  Math.round(0.0625 * TICKS_PER_QUARTER),  // 60   sixty-fourth
];

function snapToGrid(ticks: number, grid: number, tolerance: number): number {
  const nearest = Math.round(ticks / grid) * grid;
  return Math.abs(ticks - nearest) <= tolerance ? nearest : ticks;
}

function snapDurationToStandard(ticks: number, tolerance: number): number {
  let best = -1;
  let bestDist = tolerance + 1;
  for (const std of STANDARD_DURATION_TICKS) {
    const dist = Math.abs(ticks - std);
    if (dist <= tolerance && dist < bestDist) {
      best = std;
      bestDist = dist;
    }
  }
  return best !== -1 ? best : ticks;
}

/** Clean up MIDI imprecision BEFORE rhythmic normalisation:
 *    - startTick snapped to the 8th-note grid within tolerance
 *    - durationTicks snapped to the nearest standard duration within tolerance
 *  Notes far from any grid point are left alone (they'll be handled by the
 *  normaliser's tick-decomposition). After snapping, re-derive duration/dotted
 *  fields from the new durationTicks so display labels match the cleaned values. */
export function quantizeMidiTimings(notes: StaffNote[], gridTicks = QUANTIZE_GRID_TICKS, toleranceTicks = QUANTIZE_TOLERANCE_TICKS): StaffNote[] {
  if (notes.length === 0) return notes;
  return notes.map(n => {
    // Snapper-confirmed triplets are already on the triplet grid; the binary grid
    // would drag e.g. an eighth-triplet (320) onto a dotted-16th (360) and shred it.
    if (n.isTriplet || n.isDuplet) return n;
    const oldStart = n.startTick ?? 0;
    const oldDur = n.durationTicks ?? 0;
    const newStart = snapToGrid(oldStart, gridTicks, toleranceTicks);
    const newDur = snapDurationToStandard(oldDur, toleranceTicks);
    if (newStart === oldStart && newDur === oldDur) return n;
    const next = { ...n, startTick: newStart, durationTicks: newDur };
    if (newDur !== oldDur) {
      const flags = beatsToDurationFlags(newDur / TICKS_PER_QUARTER);
      next.duration = flags.duration;
      next.isDotted = flags.isDotted;
      next.isTriplet = flags.isTriplet;
      next.isDuplet = flags.isDuplet;
    }
    return next;
  });
}

/** Per-(clef, beat) triplet detection + snapping, run BEFORE the binary
 *  quantiser. The binary quantiser only knows the 8th-note grid, so a beat of
 *  eighth-note triplets that was performed slightly detached (notes released
 *  early, tiny note-off "tails") survives as off-grid 16th/64th fragments that
 *  render as an illegible cluster inside the triplet bracket.
 *
 *  For each clef+beat we compare how well the onsets fit the binary 16th grid
 *  vs the eighth-triplet grid. When the triplet grid fits clearly better (and at
 *  least one onset is genuinely off the binary grid) we snap that beat's onsets
 *  and durations to the triplet grid and drop sub-grid fragments (< half a
 *  triplet unit). Beats that read as binary are left untouched for the binary
 *  quantiser. Classification is per-clef so a binary bass line under triplet
 *  treble figuration is never disturbed. */
export function quantizeTripletBeats(
  notes: StaffNote[],
): StaffNote[] {
  if (notes.length === 0) return notes;
  // Eighth-note triplets subdivide the QUARTER-note pulse (3 per quarter),
  // independent of the meter: in 2/2 the metric beat is a half note, but the
  // triplets are still eighth-triplets of 320 ticks — so the grid is built on
  // TICKS_PER_QUARTER, NOT on the meter denominator (which previously made 2/2
  // look for quarter-triplets and miss every eighth-triplet).
  const ticksPerBeat = TICKS_PER_QUARTER;                                   // 960 — the quarter pulse
  const tripUnit = Math.round(ticksPerBeat / 3);                            // 320 — eighth-triplet
  const tripOffsets = [0, tripUnit, 2 * tripUnit];
  const binOffsets = [0, ticksPerBeat / 4, ticksPerBeat / 2, (3 * ticksPerBeat) / 4]; // 0,240,480,720

  const nearestDist = (off: number, grid: number[]) =>
    grid.reduce((m, g) => Math.min(m, Math.abs(off - g)), Infinity);
  const nearestPt = (off: number, grid: number[]) =>
    grid.reduce((best, g) => (Math.abs(off - g) < Math.abs(off - best) ? g : best), grid[0]);
  const clefOf = (n: StaffNote): 'treble' | 'bass' => (n.clef === 'bass' ? 'bass' : 'treble');
  const voiceOf = (n: StaffNote) => Number((n as any).voice ?? 0);
  const beatOf = (st: number) => Math.floor(st / ticksPerBeat);
  // Key per (voice, clef, beat): triplet-ness is decided independently per voice,
  // so a held melody (its own voice) isn't dragged onto the arpeggio's grid.
  const beatKey = (n: StaffNote) => `${voiceOf(n)}:${clefOf(n)}:${beatOf(n.startTick ?? 0)}`;

  // Classify each (voice, clef, beat).
  const tripletBeats = new Set<string>();
  const offsByKey = new Map<string, number[]>();
  for (const n of notes) {
    const st = n.startTick ?? 0;
    const key = beatKey(n);
    const off = st - beatOf(st) * ticksPerBeat;
    const arr = offsByKey.get(key);
    if (arr) arr.push(off); else offsByKey.set(key, [off]);
  }
  // Evidence-based classification (robust to off-grid fragments): an onset that
  // is clearly nearer a triplet-only point (320/640) than any binary point is
  // "triplet evidence"; one clearly nearer the binary grid is "binary evidence".
  // Fragments sit far from both and count as neither, so they can't veto a beat
  // that contains genuine triplet onsets. Margin = half the binary↔triplet gap.
  const MARGIN = Math.round(tripUnit / 8); // ~40 ticks; the 320↔{240,480} gap is 80
  for (const [key, offs] of offsByKey) {
    let tripEvidence = 0, binEvidence = 0;
    for (const o of offs) {
      const b = nearestDist(o, binOffsets);
      const t = nearestDist(o, tripOffsets);
      if (b - t >= MARGIN) tripEvidence++;
      else if (t - b >= MARGIN) binEvidence++;
    }
    if (tripEvidence >= 1 && tripEvidence >= binEvidence) tripletBeats.add(key);
  }

  // Snap onsets + durations inside triplet beats; drop sub-grid fragments and
  // merge same-pitch collisions onto the snapped slot.
  const snappedStartOf = (n: StaffNote): number => {
    const st = n.startTick ?? 0;
    const beat = beatOf(st);
    const off = st - beat * ticksPerBeat;
    return beat * ticksPerBeat + nearestPt(off, [...tripOffsets, ticksPerBeat]);
  };
  // How many triplet-beat notes land on each (clef, slot): lets us tell a lone
  // on-grid onset (a real re-articulation — keep) from a release-tail fragment
  // that piles onto an already-occupied slot (drop).
  const slotCount = new Map<string, number>();
  for (const n of notes) {
    if (!tripletBeats.has(beatKey(n))) continue;
    const slot = `${voiceOf(n)}:${clefOf(n)}:${snappedStartOf(n)}`;
    slotCount.set(slot, (slotCount.get(slot) ?? 0) + 1);
  }

  const out: StaffNote[] = [];
  const slotIndex = new Map<string, number>(); // voice:clef:startTick:midi → index in out
  for (const n of notes) {
    if (!tripletBeats.has(beatKey(n))) {
      // Not a triplet beat. Clear any spurious triplet flag that convert assigned
      // to a duration that merely happens to sit near a triplet value (e.g. a
      // 324-tick staccato bass quarter), so isTriplet downstream reliably marks a
      // snapper-confirmed triplet that extend/binary-quantise must leave alone.
      out.push((n.isTriplet || n.isDuplet) ? { ...n, isTriplet: false, isDuplet: false } : n);
      continue;
    }
    const newStart = snappedStartOf(n);
    let units = Math.round((n.durationTicks ?? 0) / tripUnit);
    if (units < 1) {
      // Tiny note. A release-tail fragment shares its snapped slot with another
      // note → drop it. A lone on-grid onset (e.g. a re-articulated downbeat whose
      // MIDI note-off was glitched short by pedal/legato) is real → keep as 1 unit.
      if ((slotCount.get(`${voiceOf(n)}:${clefOf(n)}:${newStart}`) ?? 0) > 1) continue;
      units = 1;
    }
    const newDur = units * tripUnit;
    const flags = beatsToDurationFlags(newDur / TICKS_PER_QUARTER);
    const dedupeKey = `${voiceOf(n)}:${clefOf(n)}:${newStart}:${n.midi}`;
    const existingIdx = slotIndex.get(dedupeKey);
    if (existingIdx != null) {
      // Same pitch already on this slot: keep the longer of the two.
      if ((out[existingIdx].durationTicks ?? 0) < newDur) {
        out[existingIdx] = { ...out[existingIdx], durationTicks: newDur, duration: flags.duration, isTriplet: flags.isTriplet, isDotted: flags.isDotted, isDuplet: flags.isDuplet };
      }
      continue;
    }
    slotIndex.set(dedupeKey, out.length);
    out.push({ ...n, startTick: newStart, durationTicks: newDur, duration: flags.duration, isTriplet: flags.isTriplet, isDotted: flags.isDotted, isDuplet: flags.isDuplet });
  }
  out.sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
  return out;
}

/** Standard MIDI→score voice separation for ONE staff (clef): notes that
 *  overlap in time are pushed to different voices, so a held melody note over a
 *  moving arpeggio ends up in its own monophonic voice instead of being mangled
 *  into a single rest-filled line. Greedy by start tick: a note reuses the free
 *  voice (whose previous note has ended) closest in pitch, else opens a new one.
 *  Voices are then ordered by mean pitch (highest = voice 1) and capped at
 *  `maxVoices`; any extra voice folds into the nearest kept one (residual
 *  overlaps are later trimmed/normalised). Returns notes with `voice` set to
 *  1..maxVoices. Chord tones (identical start+duration) stay in the same voice. */
export function separateVoices(notes: StaffNote[], maxVoices: number): StaffNote[] {
  if (notes.length === 0) return notes;
  if (notes.length === 1) return [{ ...notes[0], voice: 1 as Voice }];
  const sorted = [...notes].sort((a, b) =>
    ((a.startTick ?? 0) - (b.startTick ?? 0)) || ((b.midi ?? 0) - (a.midi ?? 0)));

  type V = { end: number; lastMidi: number; lastStart: number; lastDur: number; notes: StaffNote[] };
  const voices: V[] = [];
  for (const n of sorted) {
    const st = n.startTick ?? 0;
    const dur = n.durationTicks ?? 0;
    const end = st + dur;
    const midi = n.midi ?? 0;
    // A TRUE chord tone (same onset AND same duration as a voice's last note)
    // joins that voice's chord. A note merely sharing the onset but with a
    // different length (e.g. an arpeggio note under a held melody note) is NOT a
    // chord tone — it overlaps and must take a different voice.
    let chordIdx = -1;
    for (let i = 0; i < voices.length; i++) if (voices[i].lastStart === st && voices[i].lastDur === dur) { chordIdx = i; break; }
    if (chordIdx >= 0) {
      const v = voices[chordIdx];
      v.notes.push(n); v.end = Math.max(v.end, end); v.lastMidi = midi;
      continue;
    }
    // Otherwise reuse the closest free voice, else open a new one.
    let best = -1, bestD = Infinity;
    for (let i = 0; i < voices.length; i++) {
      if (voices[i].end <= st + 1) {
        const d = Math.abs(voices[i].lastMidi - midi);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best < 0) voices.push({ end, lastMidi: midi, lastStart: st, lastDur: dur, notes: [n] });
    else { const v = voices[best]; v.notes.push(n); v.end = end; v.lastMidi = midi; v.lastStart = st; v.lastDur = dur; }
  }

  // Cap to maxVoices: fold the lowest-median extra voices into the nearest kept
  // one. (The upper/lower role of the survivors is NOT decided here — it is done
  // per measure below, since a single global ordering tangles melody and
  // figuration on real piano writing.)
  const medianP = (v: V) => {
    const a = v.notes.map(x => x.midi ?? 0).sort((p, q) => p - q);
    return a[Math.floor(a.length / 2)] ?? 0;
  };
  voices.sort((a, b) => medianP(b) - medianP(a));
  while (voices.length > maxVoices) {
    const extra = voices.pop()!;
    const ep = medianP(extra);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < voices.length; i++) { const d = Math.abs(medianP(voices[i]) - ep); if (d < bestD) { bestD = d; best = i; } }
    voices[best].notes.push(...extra.notes);
  }
  // Single line: voice 1, natural position-based stems (no override) so a simple
  // monophonic import isn't regressed.
  if (voices.length < 2) {
    return voices.flatMap(v => v.notes.map(n => ({ ...n, voice: 1 as Voice })));
  }

  // Two voices: a GLOBAL ordering ("voice A is always on top") fails on real
  // piano writing — the greedy reuse-by-pitch lets the held melody and the
  // moving figuration trade voice slots mid-piece, so one global "upper voice"
  // decision puts the melody below the arpeggio for whole sections (234 stem
  // crossings on Moonlight). Decide the upper/lower role PER MEASURE instead:
  // within each bar, whichever of the two lines is higher at the moments they
  // actually overlap becomes voice 1 (stems up); the other is voice 2 (down).
  // The few residual crossings left are genuine within-bar voice crossings that
  // a human engraver would also leave. A measure where only one line sounds gets
  // voice 1 with natural (un-pinned) stems.
  const [A, B] = voices;
  const measureOf = (n: StaffNote) => (n.measureIndex ?? 0);
  const tally = (aNotes: StaffNote[], bNotes: StaffNote[]): number => {
    let score = 0;
    for (const a of aNotes) {
      const as = a.startTick ?? 0, ae = as + (a.durationTicks ?? 0);
      for (const b of bNotes) {
        const bs = b.startTick ?? 0;
        if (bs >= ae) continue;
        if (bs + (b.durationTicks ?? 0) <= as) continue;
        score += Math.sign((a.midi ?? 0) - (b.midi ?? 0));
      }
    }
    return score;
  };
  const aByM = new Map<number, StaffNote[]>();
  const bByM = new Map<number, StaffNote[]>();
  for (const n of A.notes) { const m = measureOf(n); (aByM.get(m) ?? aByM.set(m, []).get(m)!).push(n); }
  for (const n of B.notes) { const m = measureOf(n); (bByM.get(m) ?? bByM.set(m, []).get(m)!).push(n); }

  const out: StaffNote[] = [];
  const measuresSet = new Set<number>([...aByM.keys(), ...bByM.keys()]);
  for (const m of measuresSet) {
    const aN = aByM.get(m) ?? [];
    const bN = bByM.get(m) ?? [];
    if (aN.length === 0 || bN.length === 0) {
      // Only one line in this bar → single voice, natural stems.
      for (const n of [...aN, ...bN]) out.push({ ...n, voice: 1 as Voice });
      continue;
    }
    // Both lines present: upper line (tally ≥ 0 ⇒ A above B) → voice 1 / up.
    const aUpper = tally(aN, bN) >= 0;
    const upper = aUpper ? aN : bN;
    const lower = aUpper ? bN : aN;
    for (const n of upper) out.push({ ...n, voice: 1 as Voice, manualStemDirection: 'up' });
    for (const n of lower) out.push({ ...n, voice: 2 as Voice, manualStemDirection: 'down' });
  }
  out.sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
  return out;
}

/** Notes whose startTicks differ by less than ARPEGGIO_THRESHOLD (= 120 ticks,
 *  a 64th note at TPQ 960) are treated as one strummed/arpeggiated chord by
 *  the MIDI recording — collapsed to a simultaneous chord. Real arpeggio
 *  patterns the user wants to preserve should space notes ≥ a 16th note apart. */
const ARPEGGIO_THRESHOLD = 120;

/** Two-phase per-voice cleanup applied BEFORE rhythmic normalisation:
 *
 *  Phase 1 — Arpeggio detection. Consecutive notes (sorted by startTick) whose
 *  startTicks differ by < ARPEGGIO_THRESHOLD are grouped. Each group is
 *  collapsed to a single chord: all notes get the first note's startTick and
 *  the longest durationTicks in the group. This cleans up "rolled chord"
 *  artefacts from human MIDI recordings.
 *
 *  Phase 2 — Pair-wise overlap trim. After arpeggio collapse, walk consecutive
 *  notes again: if A overlaps B (A.startTick + A.durationTicks > B.startTick)
 *  truncate A to end at B.startTick. Chord tones (same startTick — including
 *  arpeggios collapsed in Phase 1) are skipped: trimming them would zero out
 *  the chord. */
export function trimOverlappingNotes(notes: StaffNote[]): StaffNote[] {
  if (notes.length === 0) return notes;

  // Group note indices by (voice, clef). Splitting by clef matters for ACC
  // (voice=0) where treble and bass clefs share one voice: without the split
  // a sustained bass note would be trimmed by a fast figure starting later
  // on the treble staff (legitimate cross-clef polyphony — must be preserved).
  const byStream = new Map<string, number[]>();
  for (let i = 0; i < notes.length; i++) {
    const v = (notes[i].voice ?? 0) as number;
    const c: 'treble' | 'bass' = (notes[i].clef === 'bass') ? 'bass' : 'treble';
    const key = `${v}:${c}`;
    if (!byStream.has(key)) byStream.set(key, []);
    byStream.get(key)!.push(i);
  }

  const result = notes.map(n => ({ ...n }));
  const applyDurationFlags = (note: StaffNote, durTicks: number) => {
    note.durationTicks = durTicks;
    const flags = beatsToDurationFlags(durTicks / TICKS_PER_QUARTER);
    note.duration = flags.duration;
    note.isDotted = flags.isDotted;
    note.isTriplet = flags.isTriplet;
    note.isDuplet = flags.isDuplet;
  };

  // ── Phase 1: arpeggio detection ──
  for (const indices of byStream.values()) {
    indices.sort((a, b) => (result[a].startTick ?? 0) - (result[b].startTick ?? 0));

    let groupStart = 0;
    while (groupStart < indices.length) {
      // Extend the group as long as each next note is within the threshold of
      // the previous note in the chain.
      let groupEnd = groupStart + 1;
      while (groupEnd < indices.length) {
        const prevTick = result[indices[groupEnd - 1]].startTick ?? 0;
        const curTick = result[indices[groupEnd]].startTick ?? 0;
        if (curTick - prevTick < ARPEGGIO_THRESHOLD) {
          groupEnd++;
        } else {
          break;
        }
      }

      // Collapse only if the group has more than one note. A single note that
      // happens to be near the threshold is left intact.
      if (groupEnd - groupStart > 1) {
        const firstStartTick = result[indices[groupStart]].startTick ?? 0;
        let maxDuration = 0;
        for (let k = groupStart; k < groupEnd; k++) {
          const dur = result[indices[k]].durationTicks ?? 0;
          if (dur > maxDuration) maxDuration = dur;
        }
        if (maxDuration > 0) {
          for (let k = groupStart; k < groupEnd; k++) {
            const note = result[indices[k]];
            note.startTick = firstStartTick;
            applyDurationFlags(note, maxDuration);
          }
        }
      }

      groupStart = groupEnd;
    }

    // Re-sort: startTicks within a collapsed group are now equal, and Phase 2
    // relies on a fresh ascending order to walk consecutive pairs correctly.
    indices.sort((a, b) => (result[a].startTick ?? 0) - (result[b].startTick ?? 0));
  }

  // ── Phase 2: pair-wise overlap trim ──
  for (const indices of byStream.values()) {
    for (let i = 0; i < indices.length - 1; i++) {
      const a = result[indices[i]];
      const b = result[indices[i + 1]];
      const aStart = a.startTick ?? 0;
      const bStart = b.startTick ?? 0;

      // Chord tones (incl. arpeggios collapsed in Phase 1) share startTick:
      // trimming would zero-out the chord. Leave A alone.
      if (aStart === bStart) continue;

      const aEnd = aStart + (a.durationTicks ?? 0);
      if (aEnd > bStart) {
        const newDur = bStart - aStart;
        if (newDur > 0) {
          // Preserve the original sustain length for playback BEFORE the trim
          // overwrites durationTicks. Only set on the first trim so chained
          // trims don't lose the truly-original value.
          if ((a as any).playbackDurationTicks == null) {
            (a as any).playbackDurationTicks = a.durationTicks;
          }
          applyDurationFlags(a, newDur);
        }
      }
    }
  }

  return result;
}

// =============================================================================
// RHYTHMIC NORMALIZER — beat-boundary aware split + tie generation
// =============================================================================
// Splits notes that cross strong beat boundaries (e.g. beat 3 in 4/4) into
// shorter tied notes; splits rests on every beat boundary; decomposes non-
// standard durations into chains of standard tied notes. Output preserves the
// exact tick positions (no playback drift) but renders idiomatically.

type BeatBoundary = { tick: number; isStrong: boolean };

/** Beat boundaries within a single measure for a given time signature.
 *  Tick offsets are RELATIVE to the measure start.
 *  - "Strong" = mid-measure division (rests and most notes shouldn't cross it).
 *  - Normal beats are returned but only used for rest splitting. */
function getBeatBoundaries(
  ts: { numerator: number; denominator: number },
): BeatBoundary[] {
  const ticksPerBeat = TICKS_PER_QUARTER * (4 / ts.denominator);
  const boundaries: BeatBoundary[] = [];
  for (let i = 1; i < ts.numerator; i++) {
    boundaries.push({ tick: i * ticksPerBeat, isStrong: false });
  }

  // Mark the "strong" mid-measure division per convention.
  if (ts.numerator === 4 && ts.denominator === 4) {
    // 4/4: beat 3 is strong (mid-measure)
    const t = 2 * ticksPerBeat;
    const b = boundaries.find(x => x.tick === t);
    if (b) b.isStrong = true;
  } else if (ts.numerator === 2) {
    // 2/4, 2/2: beat 2 is strong
    const t = ticksPerBeat;
    const b = boundaries.find(x => x.tick === t);
    if (b) b.isStrong = true;
  } else if (ts.numerator === 6 && ts.denominator === 8) {
    // 6/8: split between the two ternary groups (after 3 eighths)
    const mid = 3 * ticksPerBeat;
    const b = boundaries.find(x => x.tick === mid);
    if (b) b.isStrong = true;
  } else if (ts.numerator === 3) {
    // 3/4, 3/8: no truly strong inner boundary; use beat 2 as semi-strong
    // so dotted-half from beat 1 stays whole but a half from beat 2 gets split.
    const t = ticksPerBeat;
    const b = boundaries.find(x => x.tick === t);
    if (b) b.isStrong = true;
  } else if (ts.numerator === 9 && ts.denominator === 8) {
    // 9/8: split between the three ternary groups; the major one at 3/9.
    const mid = 3 * ticksPerBeat;
    const b = boundaries.find(x => x.tick === mid);
    if (b) b.isStrong = true;
  } else if (ts.numerator === 12 && ts.denominator === 8) {
    // 12/8: strong split at mid-measure (after 6 eighths)
    const mid = 6 * ticksPerBeat;
    const b = boundaries.find(x => x.tick === mid);
    if (b) b.isStrong = true;
  } else {
    // Generic: treat mid-measure (if it lands on a beat) as strong.
    const midTicks = (ts.numerator * ticksPerBeat) / 2;
    const b = boundaries.find(x => Math.abs(x.tick - midTicks) < 1);
    if (b) b.isStrong = true;
  }

  boundaries.sort((a, b) => a.tick - b.tick);
  return boundaries;
}

/** Standard musical durations from longest to shortest, used as the alphabet
 *  for decomposing a non-standard tick run into a chain of tied standard notes. */
const STANDARD_DURATIONS: Array<{ name: StaffNote['duration']; ticks: number; isDotted: boolean }> = [
  { name: 'whole', ticks: 4 * TICKS_PER_QUARTER, isDotted: false },                 // 3840
  { name: 'half', ticks: 3 * TICKS_PER_QUARTER, isDotted: true },                   // 2880
  { name: 'half', ticks: 2 * TICKS_PER_QUARTER, isDotted: false },                  // 1920
  { name: 'quarter', ticks: Math.round(1.5 * TICKS_PER_QUARTER), isDotted: true },  // 1440
  { name: 'quarter', ticks: TICKS_PER_QUARTER, isDotted: false },                   // 960
  { name: 'eighth', ticks: Math.round(0.75 * TICKS_PER_QUARTER), isDotted: true },  // 720
  { name: 'eighth', ticks: Math.round(0.5 * TICKS_PER_QUARTER), isDotted: false },  // 480
  { name: 'sixteenth', ticks: Math.round(0.375 * TICKS_PER_QUARTER), isDotted: true }, // 360
  { name: 'sixteenth', ticks: Math.round(0.25 * TICKS_PER_QUARTER), isDotted: false }, // 240
  { name: 'thirty-second', ticks: Math.round(0.125 * TICKS_PER_QUARTER), isDotted: false }, // 120
  { name: 'sixty-fourth', ticks: Math.round(0.0625 * TICKS_PER_QUARTER), isDotted: false }, // 60
];

/** Greedy decompose `ticks` into a sequence of standard durations.
 *  Used when a contiguous segment between two boundaries isn't itself a
 *  representable standard duration. Returns at least one element. */
function decomposeToStandardDurations(
  ticks: number,
): Array<{ name: StaffNote['duration']; ticks: number; isDotted: boolean }> {
  const out: Array<{ name: StaffNote['duration']; ticks: number; isDotted: boolean }> = [];
  let remaining = ticks;
  let safety = 32;
  while (remaining > 0 && safety-- > 0) {
    const pick = STANDARD_DURATIONS.find(d => d.ticks <= remaining);
    if (!pick) break;
    out.push(pick);
    remaining -= pick.ticks;
  }
  // If we couldn't represent it at all (e.g. < 60 ticks), fall back to the
  // shortest standard duration so we don't emit a zero-length note.
  if (out.length === 0) out.push(STANDARD_DURATIONS[STANDARD_DURATIONS.length - 1]);
  return out;
}

/** True if `ticks` is exactly one standard duration (so it can be a single note). */
function isStandardDuration(ticks: number): boolean {
  return STANDARD_DURATIONS.some(d => d.ticks === ticks);
}

/** Return the standard duration matching `ticks` exactly, or null if non-standard. */
function exactStandardDuration(ticks: number): { name: StaffNote['duration']; isDotted: boolean } | null {
  const hit = STANDARD_DURATIONS.find(d => d.ticks === ticks);
  return hit ? { name: hit.name, isDotted: hit.isDotted } : null;
}

/** Triplet (3:2) tick lengths for the common base values. Used to recognise
 *  tuplet RESTS (which carry no isTriplet flag from the MIDI source) so a gap
 *  between triplet notes is emitted as a single triplet rest instead of being
 *  shredded into tied binary fragments (16th+64th). A small tolerance absorbs
 *  MIDI drift; it stays well below the ~80-tick gap to the nearest binary value
 *  so a 16th/8th rest is never mistaken for a triplet. */
const TRIPLET_DURATION_TICKS: Array<{ name: StaffNote['duration']; ticks: number }> = [
  { name: 'half',          ticks: Math.round((2 / 3) * 2 * TICKS_PER_QUARTER) },     // 1280
  { name: 'quarter',       ticks: Math.round((2 / 3) * 1 * TICKS_PER_QUARTER) },     // 640
  { name: 'eighth',        ticks: Math.round((2 / 3) * 0.5 * TICKS_PER_QUARTER) },   // 320
  { name: 'sixteenth',     ticks: Math.round((2 / 3) * 0.25 * TICKS_PER_QUARTER) },  // 160
  { name: 'thirty-second', ticks: Math.round((2 / 3) * 0.125 * TICKS_PER_QUARTER) }, // 80
];
const TRIPLET_SNAP_TOLERANCE = Math.round(TICKS_PER_QUARTER / 48); // ~20 ticks @ TPQ 960

/** Return the triplet duration matching `ticks` within tolerance, or null. */
function exactTripletDuration(ticks: number): { name: StaffNote['duration'] } | null {
  let best: { name: StaffNote['duration'] } | null = null;
  let bestDist = TRIPLET_SNAP_TOLERANCE + 1;
  for (const d of TRIPLET_DURATION_TICKS) {
    const dist = Math.abs(ticks - d.ticks);
    if (dist <= TRIPLET_SNAP_TOLERANCE && dist < bestDist) { best = { name: d.name }; bestDist = dist; }
  }
  return best;
}

/** Decide whether a note should be split at strong boundaries.
 *  Exceptions: a note exactly covering the whole measure from beat 1 is
 *  allowed to "cross" the strong boundary, as is any single standard
 *  duration that lines up with a strong boundary at one end. */
function shouldSplitNoteAtStrong(
  noteOffset: number,        // start within the measure (0-based ticks)
  noteEnd: number,           // end within the measure
  boundaries: BeatBoundary[],
  ticksPerMeasure: number,
): boolean {
  const crossedStrong = boundaries.filter(b => b.isStrong && b.tick > noteOffset && b.tick < noteEnd);
  if (crossedStrong.length === 0) return false;

  // Exception 1: whole-measure note starting on beat 1 (e.g. semibreve in 4/4).
  if (noteOffset === 0 && noteEnd === ticksPerMeasure && isStandardDuration(ticksPerMeasure)) {
    return false;
  }
  return true;
}

/** Split a single note on the strong beat boundaries it crosses, emitting
 *  tied notes. Each resulting segment is further decomposed into standard
 *  durations if not itself a standard length (also tied). */
function splitNoteAtBoundaries(
  note: StaffNote,
  measureStartTick: number,
  boundaries: BeatBoundary[],
  ticksPerMeasure: number,
): StaffNote[] {
  if (note.isRest) return [note];
  const noteOffset = (note.startTick ?? 0) - measureStartTick;
  const noteEnd = noteOffset + (note.durationTicks ?? 0);

  // Tuplet notes (triplets/duplets) are not representable in the binary
  // STANDARD_DURATIONS alphabet: running them through decomposeToStandardDurations
  // shreds an eighth-triplet (320 ticks @ TPQ 960) into tied 16th+64th fragments
  // and leaves a stray isTriplet flag on the pieces — the "triplets piled up with
  // 16ths/32nds" symptom on MIDI import. beatsToDurationFlags has already tagged
  // the correct base value + isTriplet, so as long as the tuplet note doesn't span
  // a strong boundary we re-emit it intact instead of decomposing.
  if ((note.isTriplet || note.isDuplet) &&
      !shouldSplitNoteAtStrong(noteOffset, noteEnd, boundaries, ticksPerMeasure)) {
    return [{
      ...note,
      startTick: measureStartTick + noteOffset,
      beat: (noteOffset / TICKS_PER_QUARTER) + 1,
      isTiedToNext: (note as any).isTiedToNext ?? false,
    }];
  }

  // Determine cut points: strong boundaries only.
  let cuts: number[];
  if (shouldSplitNoteAtStrong(noteOffset, noteEnd, boundaries, ticksPerMeasure)) {
    const strong = boundaries.filter(b => b.isStrong && b.tick > noteOffset && b.tick < noteEnd).map(b => b.tick);
    cuts = [noteOffset, ...strong, noteEnd];
  } else {
    cuts = [noteOffset, noteEnd];
  }

  // For each segment, also decompose into standard durations so we never emit
  // a non-standard length (e.g. 1000 ticks → quarter + 16th tied).
  const segments: Array<{ offset: number; ticks: number; durName: StaffNote['duration']; isDotted: boolean }> = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const segOffset = cuts[i];
    const segTicks = cuts[i + 1] - cuts[i];
    if (segTicks <= 0) continue;
    const exact = exactStandardDuration(segTicks);
    if (exact) {
      segments.push({ offset: segOffset, ticks: segTicks, durName: exact.name, isDotted: exact.isDotted });
    } else {
      let local = segOffset;
      for (const piece of decomposeToStandardDurations(segTicks)) {
        segments.push({ offset: local, ticks: piece.ticks, durName: piece.name, isDotted: piece.isDotted });
        local += piece.ticks;
      }
    }
  }

  if (segments.length <= 1) {
    // Even if no boundary was crossed and the duration is standard, re-emit
    // with normalised duration/isDotted so output is consistent.
    if (segments.length === 1) {
      const s = segments[0];
      return [{
        ...note,
        duration: s.durName,
        isDotted: s.isDotted,
        durationTicks: s.ticks,
        startTick: measureStartTick + s.offset,
        beat: (s.offset / TICKS_PER_QUARTER) + 1,
        isTiedToNext: (note as any).isTiedToNext ?? false,
      }];
    }
    return [note];
  }

  const wasTied = !!(note as any).isTiedToNext;
  const ticksPerBeat = TICKS_PER_QUARTER * (4 / 4); // default; recompute per beat field is not crucial
  void ticksPerBeat;
  return segments.map((s, i) => ({
    ...note,
    id: i === 0 ? note.id : makeRestId(),
    duration: s.durName,
    isDotted: s.isDotted,
    durationTicks: s.ticks,
    startTick: measureStartTick + s.offset,
    beat: (s.offset / TICKS_PER_QUARTER) + 1,
    // Every segment ties to the next, except the last (which keeps original tie state).
    isTiedToNext: i < segments.length - 1 ? true : wasTied,
  }));
}

/** Split a rest on EVERY beat boundary it crosses (and decompose non-standard
 *  resulting segments). Rests are never tied. */
function splitRestAtBoundaries(
  rest: StaffNote,
  measureStartTick: number,
  boundaries: BeatBoundary[],
): StaffNote[] {
  const restOffset = (rest.startTick ?? 0) - measureStartTick;
  const restEnd = restOffset + (rest.durationTicks ?? 0);
  const crossedAll = boundaries.filter(b => b.tick > restOffset && b.tick < restEnd).map(b => b.tick);

  const cuts: number[] = [restOffset, ...crossedAll, restEnd];
  const segments: Array<{ offset: number; ticks: number; durName: StaffNote['duration']; isDotted: boolean; isTriplet?: boolean }> = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const segOffset = cuts[i];
    const segTicks = cuts[i + 1] - cuts[i];
    if (segTicks <= 0) continue;
    const exact = exactStandardDuration(segTicks);
    if (exact) {
      segments.push({ offset: segOffset, ticks: segTicks, durName: exact.name, isDotted: exact.isDotted });
    } else {
      // Prefer a single triplet rest over a binary decomposition: a gap between
      // triplet notes (e.g. 320 ticks) is one eighth-triplet rest, not 16th+64th.
      const trip = exactTripletDuration(segTicks);
      if (trip) {
        segments.push({ offset: segOffset, ticks: segTicks, durName: trip.name, isDotted: false, isTriplet: true });
      } else {
        let local = segOffset;
        for (const piece of decomposeToStandardDurations(segTicks)) {
          segments.push({ offset: local, ticks: piece.ticks, durName: piece.name, isDotted: piece.isDotted });
          local += piece.ticks;
        }
      }
    }
  }

  if (segments.length === 0) return [rest];

  return segments.map((s, i) => ({
    ...rest,
    id: i === 0 ? rest.id : makeRestId(),
    duration: s.durName,
    isDotted: s.isDotted,
    isTriplet: !!s.isTriplet,
    durationTicks: s.ticks,
    startTick: measureStartTick + s.offset,
    beat: (s.offset / TICKS_PER_QUARTER) + 1,
  }));
}

/** Main entry point. Replaces fillRestsAfterImport with a boundary-aware
 *  pipeline:
 *    1. group by (voice, clef)
 *    2. per measure: clamp note durations to measure end, split notes at
 *       strong boundaries, fill gaps with rests, split rests at all boundaries.
 *  Output is sorted by startTick. */
export function normalizeRhythm(
  notes: StaffNote[],
  timeSignature: { numerator: number; denominator: number },
  timeSignatureChanges: Array<{ measureIndex: number; numerator: number; denominator: number }>,
): StaffNote[] {
  if (notes.length === 0) return notes;

  const sortedChanges = [...timeSignatureChanges].sort((a, b) => a.measureIndex - b.measureIndex);
  const tsForMeasure = (mi: number) => {
    let active = timeSignature;
    for (const c of sortedChanges) {
      if (c.measureIndex <= mi) active = { numerator: c.numerator, denominator: c.denominator };
      else break;
    }
    return active;
  };
  const ticksForMeasure = (mi: number): number => {
    const ts = tsForMeasure(mi);
    return TICKS_PER_QUARTER * ts.numerator * (4 / ts.denominator);
  };

  const maxMeasureIdx = notes.reduce((mx, n) => Math.max(mx, n.measureIndex ?? 0), 0);
  const measureStartTicks: number[] = new Array(maxMeasureIdx + 2);
  let acc = 0;
  for (let m = 0; m <= maxMeasureIdx + 1; m++) {
    measureStartTicks[m] = acc;
    acc += ticksForMeasure(m);
  }

  type Stream = { voice: number; clef: 'treble' | 'bass'; notes: StaffNote[] };
  const streams = new Map<string, Stream>();
  for (const n of notes) {
    const v = (n.voice ?? 0) as number;
    const c: 'treble' | 'bass' = (n.clef === 'bass') ? 'bass' : 'treble';
    const key = `${v}:${c}`;
    let s = streams.get(key);
    if (!s) { s = { voice: v, clef: c, notes: [] }; streams.set(key, s); }
    s.notes.push(n);
  }

  const out: StaffNote[] = [];

  for (const stream of streams.values()) {
    const { voice, clef, notes: streamNotes } = stream;
    const measureForTick = (tick: number): number => {
      let mm = 0;
      while (mm + 1 < measureStartTicks.length && (measureStartTicks[mm + 1] ?? Infinity) <= tick) mm++;
      return mm;
    };
    const measureEndTick = (mm: number): number =>
      (measureStartTicks[mm + 1] ?? ((measureStartTicks[mm] ?? 0) + ticksForMeasure(mm)));

    const byMeasure = new Map<number, StaffNote[]>();
    const pushTo = (mm: number, nn: StaffNote) => {
      if (!byMeasure.has(mm)) byMeasure.set(mm, []);
      byMeasure.get(mm)!.push(nn);
    };
    for (const n of streamNotes) {
      const start = n.startTick ?? (measureStartTicks[n.measureIndex ?? 0] ?? 0);
      const end = start + (n.durationTicks ?? 0);
      const startM = n.measureIndex ?? measureForTick(start);
      // Notes that stay inside their measure (and all rests) pass through unchanged.
      if (n.isRest || end <= measureEndTick(startM)) {
        pushTo(startM, n);
        continue;
      }
      // A note that spills past its barline is split into tied per-measure pieces so
      // the continuation survives in the next measure instead of being clamped away
      // (e.g. a melody note held across the bar line in a MIDI import).
      let segStart = start;
      let first = true;
      let guard = 0;
      while (segStart < end && guard++ < 64) {
        const m = measureForTick(segStart);
        const segEnd = Math.min(end, measureEndTick(m));
        const segDur = segEnd - segStart;
        if (segDur <= 0) break;
        const df = beatsToDurationFlags(segDur / TICKS_PER_QUARTER);
        pushTo(m, {
          ...n,
          id: first ? n.id : makeRestId(),
          startTick: segStart,
          durationTicks: segDur,
          duration: df.duration,
          isDotted: df.isDotted,
          isTriplet: df.isTriplet,
          isDuplet: df.isDuplet,
          measureIndex: m,
          isTiedToNext: segEnd < end ? true : ((n as any).isTiedToNext ?? false),
        });
        segStart = segEnd;
        first = false;
      }
    }
    const measureIdxs = [...byMeasure.keys()].sort((a, b) => a - b);
    if (measureIdxs.length === 0) continue;
    const firstMeasure = measureIdxs[0];
    const lastMeasure = measureIdxs[measureIdxs.length - 1];

    let cursor = measureStartTicks[firstMeasure] ?? 0;

    for (let m = firstMeasure; m <= lastMeasure; m++) {
      const ts = tsForMeasure(m);
      const ticksPerMeasure = ticksForMeasure(m);
      const measureStart = measureStartTicks[m] ?? 0;
      const measureEnd = measureStart + ticksPerMeasure;
      const boundaries = getBeatBoundaries(ts);
      if (cursor < measureStart) cursor = measureStart;

      const measureNotes = (byMeasure.get(m) ?? [])
        .slice()
        .sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));

      // Pass 1: clamp note durations so they don't spill past measureEnd,
      // then split each note at strong boundaries.
      const splitNotes: StaffNote[] = [];
      for (const note of measureNotes) {
        const noteStart = note.startTick ?? measureStart;
        const noteDur = note.durationTicks ?? 0;
        const noteEnd = Math.min(noteStart + noteDur, measureEnd);
        const clampedDur = noteEnd - noteStart;
        const clamped = clampedDur !== noteDur
          ? { ...note, durationTicks: clampedDur }
          : note;
        splitNotes.push(...splitNoteAtBoundaries(clamped, measureStart, boundaries, ticksPerMeasure));
      }

      // Pass 2: walk the measure, fill gaps with boundary-aware rests.
      for (const note of splitNotes) {
        const noteStart = note.startTick ?? cursor;
        if (noteStart > cursor) {
          const gapRest: StaffNote = {
            id: makeRestId(),
            pitch: 'B',
            octave: clef === 'bass' ? 2 : 4,
            position: clef === 'bass' ? 4 : 8,
            midi: 0,
            noteIndex: 0,
            duration: 'quarter',
            isRest: true,
            isTriplet: false,
            isDuplet: false,
            isDotted: false,
            measureIndex: m,
            beat: ((cursor - measureStart) / TICKS_PER_QUARTER) + 1,
            startTick: cursor,
            durationTicks: noteStart - cursor,
            clef,
            voice: voice as Voice,
          };
          out.push(...splitRestAtBoundaries(gapRest, measureStart, boundaries));
        }
        out.push(note);
        cursor = Math.max(cursor, noteStart + (note.durationTicks ?? 0));
      }

      // Trailing rest to fill any remaining tail of the measure.
      if (cursor < measureEnd) {
        const tailRest: StaffNote = {
          id: makeRestId(),
          pitch: 'B',
          octave: clef === 'bass' ? 2 : 4,
          position: clef === 'bass' ? 4 : 8,
          midi: 0,
          noteIndex: 0,
          duration: 'quarter',
          isRest: true,
          isTriplet: false,
          isDuplet: false,
          isDotted: false,
          measureIndex: m,
          beat: ((cursor - measureStart) / TICKS_PER_QUARTER) + 1,
          startTick: cursor,
          durationTicks: measureEnd - cursor,
          clef,
          voice: voice as Voice,
        };
        out.push(...splitRestAtBoundaries(tailRest, measureStart, boundaries));
        cursor = measureEnd;
      }
    }
  }

  out.sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0) || ((a.voice ?? 0) - (b.voice ?? 0)));
  return out;
}

/** Resolve a heterogenous source (File / ArrayBuffer / base64 string / undefined)
 *  into an ArrayBuffer. Returns null if the source was a falsy/cancelled pick. */
async function resolveMidiSource(
  source: File | ArrayBuffer | string | undefined,
  pickFn: () => Promise<File | null>,
): Promise<ArrayBuffer | null> {
  if (!source) {
    const picked = await pickFn();
    if (!picked) return null;
    return await picked.arrayBuffer();
  }
  if (source instanceof File) return await source.arrayBuffer();
  if (source instanceof ArrayBuffer) return source;
  if (typeof source === 'string') return base64ToArrayBuffer(source);
  return null;
}

export function useGrandStaffMidi({ project, setProject }: UseGrandStaffMidiArgs) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [midiExportType] = usePreference<string>('midi.exportType');

  const pickMidiFile = useCallback(async (): Promise<File | null> => {
    if (typeof document === 'undefined') return null;

    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.mid,.midi,audio/midi,audio/x-midi';
      input.style.display = 'none';
      document.body.appendChild(input);
      fileInputRef.current = input;
    }

    const input = fileInputRef.current;
    return new Promise<File | null>((resolve) => {
      const onChange = () => {
        input.removeEventListener('change', onChange);
        const file = input.files && input.files.length > 0 ? input.files[0] : null;
        input.value = '';
        resolve(file);
      };
      input.addEventListener('change', onChange);
      input.click();
    });
  }, []);

  const exportMidi = useCallback(async () => {
    const midiBytes = buildMidiFile({
      notes: project.notes || [],
      timeSignature: project.timeSignature,
      bpm: project.bpm ?? 120,
      midiType: (midiExportType === '0' ? 0 : 1) as 0 | 1,
    });

    const base64 = bytesToBase64(midiBytes);

    const res = await electronBridge.saveBinaryFile(base64, undefined, [{ name: 'MIDI', extensions: ['mid', 'midi'] }]);
    if (res && res.success) return;

    // Fallback browser download.
    const blobBytes = new Uint8Array(midiBytes);
    const blob = new Blob([blobBytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.mid';
    a.click();
    URL.revokeObjectURL(url);
  }, [project, midiExportType]);

  const importMidi = useCallback(async (source?: File | ArrayBuffer | string) => {
    const arrayBuffer = await resolveMidiSource(source, pickMidiFile);
    if (!arrayBuffer) return;

    const parsed = parseMidi(arrayBuffer);

    // ── Safeguard: warn & truncate if file has too many notes ──
    const MAX_IMPORT_NOTES = 5000;
    if (parsed.notes.length > MAX_IMPORT_NOTES) {
      const msg = `Il file MIDI contiene ${parsed.notes.length.toLocaleString()} note (il massimo gestibile è ~${MAX_IMPORT_NOTES.toLocaleString()}).\nVerranno importate solo le prime ${MAX_IMPORT_NOTES.toLocaleString()} note.`;
      console.warn('[MIDI import]', msg);
      try { window.alert(msg); } catch { /* ignore */ }
      parsed.notes.length = MAX_IMPORT_NOTES;
    }

    const tpq = Math.max(1, parsed.tpq);
    const beatsPerMeasure = parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);

    // Use key signature from MIDI file if available, otherwise use project key.
    let midiRoot = project.keySignatureRoot || 'C';
    let midiIsMinor = project.isMinorMode;
    if (parsed.keySignature) {
      const { sharps, isMinor } = parsed.keySignature;
      const majorRoots = ['C','G','D','A','E','B','F#','C#'];
      const flatMajorRoots = ['C','F','Bb','Eb','Ab','Db','Gb','Cb'];
      const majorRoot = sharps >= 0 ? (majorRoots[sharps] ?? 'C') : (flatMajorRoots[-sharps] ?? 'C');
      if (isMinor) {
        const minorRoots: Record<string, string> = {'C':'A','G':'E','D':'B','A':'F#','E':'C#','B':'G#','F#':'D#','C#':'A#','F':'D','Bb':'G','Eb':'C','Ab':'F','Db':'Bb','Gb':'Eb','Cb':'Ab'};
        midiRoot = minorRoots[majorRoot] ?? majorRoot;
        midiIsMinor = true;
      } else {
        midiRoot = majorRoot;
        midiIsMinor = false;
      }
    }
    const keySig = getKeySignature(midiRoot, midiIsMinor ? 'Minor' : 'Major');

    // ---------- Smart voice assignment strategy ----------
    // 1) If multiple tracks contain notes → map track → voice (SATB order)
    // 2) Else if single track but multiple channels → map channel → voice
    // 3) Fallback: pitch-based SATB distribution
    const trackSet = new Set(parsed.notes.map(n => n.track));
    const channelSet = new Set(parsed.notes.map(n => n.channel));
    const tracksWithNotes = [...trackSet].sort((a, b) => a - b);
    const channelsWithNotes = [...channelSet].sort((a, b) => a - b);

    type VoiceStrategy = 'track' | 'channel' | 'pitch';
    let strategy: VoiceStrategy;
    let voiceMap: Map<number, Voice> | null = null;

    if (tracksWithNotes.length > 1) {
      strategy = 'track';
      voiceMap = new Map<number, Voice>();
      // Map each track with notes to voices 1-4 in order; extras clamp to 4.
      tracksWithNotes.forEach((trk, idx) => {
        voiceMap!.set(trk, Math.min(idx + 1, 4) as Voice);
      });
    } else if (channelsWithNotes.length > 1) {
      strategy = 'channel';
      voiceMap = new Map<number, Voice>();
      channelsWithNotes.forEach((ch, idx) => {
        voiceMap!.set(ch, Math.min(idx + 1, 4) as Voice);
      });
    } else {
      strategy = 'pitch';
    }

    // For pitch-based strategy: collect all MIDI note numbers, then split into
    // 4 groups by quartiles (S=highest, B=lowest).
    let pitchThresholds: number[] = [];
    if (strategy === 'pitch') {
      const midiValues = parsed.notes.map(n => n.midi).sort((a, b) => a - b);
      if (midiValues.length >= 4) {
        const q1 = midiValues[Math.floor(midiValues.length * 0.25)];
        const q2 = midiValues[Math.floor(midiValues.length * 0.50)];
        const q3 = midiValues[Math.floor(midiValues.length * 0.75)];
        pitchThresholds = [q1, q2, q3]; // bass < q1, tenor < q2, alto < q3, soprano >= q3
      }
    }

    const getVoice = (n: { track: number; channel: number; midi: number }): Voice => {
      if (strategy === 'track' && voiceMap) return voiceMap.get(n.track) ?? 1 as Voice;
      if (strategy === 'channel' && voiceMap) return voiceMap.get(n.channel) ?? 1 as Voice;
      // Pitch-based
      if (pitchThresholds.length === 3) {
        if (n.midi < pitchThresholds[0]) return 4 as Voice; // Bass
        if (n.midi < pitchThresholds[1]) return 3 as Voice; // Tenor
        if (n.midi < pitchThresholds[2]) return 2 as Voice; // Alto
        return 1 as Voice; // Soprano
      }
      return 1 as Voice;
    };

    const convertedNotes: StaffNote[] = parsed.notes.map((n, idx) =>
      convertParsedNoteToStaffNote(n, idx, tpq, beatsPerMeasure, keySig, getVoice(n))
    );

    // Quantise MIDI timings: snap near-grid onsets and near-standard durations
    // so the normaliser doesn't fragment 950-tick "quarters" into chains of
    // tied 32nds / 64ths. Tight tolerance preserves legitimate 16ths.
    const quantizedNotes = quantizeMidiTimings(convertedNotes);

    // Trim overlapping notes per (voice, clef) — chord tones (same startTick)
    // kept; cross-clef polyphony preserved. Cleans ghost overlaps from sloppy
    // MIDI recordings before the normaliser splits on beat boundaries.
    const trimmedNotes = trimOverlappingNotes(quantizedNotes);

    // Normalize rhythm: split notes/rests on beat boundaries, fill gaps with
    // boundary-aware rests, decompose non-standard durations into chains of
    // tied standard notes. Preserves tick positions so playback is unchanged.
    const notes = normalizeRhythm(trimmedNotes, parsed.timeSignature, []);

    setProject({
      notes,
      timeSignature: parsed.timeSignature,
      timeSignatureChanges: [],
      bpm: parsed.tempoBpm,
      ...(parsed.keySignature ? { keySignatureRoot: midiRoot, isMinorMode: midiIsMinor } : {}),
    });
  }, [pickMidiFile, project.isMinorMode, project.keySignatureRoot, setProject]);

  /** Import a MIDI file into a fresh AccompanimentTrack. Bypasses the SATB voice
   *  assignment (all notes get voice=0). Returns the built track; the caller is
   *  responsible for pushing it into state. Returns null if the source resolves
   *  to nothing (e.g. user cancelled the file picker). */
  const importMidiAsAccompaniment = useCallback(async (
    source?: File | ArrayBuffer | string,
  ): Promise<AccompanimentTrack | null> => {
    const arrayBuffer = await resolveMidiSource(source, pickMidiFile);
    if (!arrayBuffer) return null;

    const parsed = parseMidi(arrayBuffer);

    const MAX_IMPORT_NOTES = 5000;
    if (parsed.notes.length > MAX_IMPORT_NOTES) {
      const msg = `Il file MIDI contiene ${parsed.notes.length.toLocaleString()} note (il massimo gestibile è ~${MAX_IMPORT_NOTES.toLocaleString()}).\nVerranno importate solo le prime ${MAX_IMPORT_NOTES.toLocaleString()} note.`;
      console.warn('[MIDI import accompaniment]', msg);
      try { window.alert(msg); } catch { /* ignore */ }
      parsed.notes.length = MAX_IMPORT_NOTES;
    }

    const tpq = Math.max(1, parsed.tpq);
    const beatsPerMeasure = parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);

    // The accompaniment track is not analysed; key signature for spelling defaults
    // to the project's current key so accidentals look reasonable on the staff.
    const keySig = getKeySignature(project.keySignatureRoot || 'C', project.isMinorMode ? 'Minor' : 'Major');

    // Staff (clef) assignment: when the MIDI has ≥2 tracks (typically L/R hands),
    // route each track to a staff by its mean pitch (low track → bass staff) so a
    // low right-hand note doesn't fall onto the bass staff. Single-track MIDI keeps
    // the per-note pitch heuristic.
    const trackPitch = new Map<number, { sum: number; n: number }>();
    for (const n of parsed.notes) {
      const e = trackPitch.get(n.track) ?? { sum: 0, n: 0 };
      e.sum += n.midi; e.n += 1; trackPitch.set(n.track, e);
    }
    const multiTrack = trackPitch.size >= 2;
    const clefForTrack = (track: number): 'treble' | 'bass' | undefined => {
      if (!multiTrack) return undefined;
      const e = trackPitch.get(track);
      return (e && e.n > 0 && e.sum / e.n < 60) ? 'bass' : 'treble';
    };

    const convertedNotes: StaffNote[] = parsed.notes.map((n, idx) =>
      convertParsedNoteToStaffNote(n, idx, tpq, beatsPerMeasure, keySig, 0, clefForTrack(n.track))
    );

    // Voice separation per staff: notes overlapping in time go to separate voices,
    // so a held melody over a moving arpeggio is no longer flattened into one
    // rest-filled line. Up to 2 voices per staff (piano convention).
    const MAX_VOICES_PER_STAFF = 2;
    const voicedNotes: StaffNote[] = [
      ...separateVoices(convertedNotes.filter(n => (n.clef ?? 'treble') === 'treble'), MAX_VOICES_PER_STAFF),
      ...separateVoices(convertedNotes.filter(n => n.clef === 'bass'), MAX_VOICES_PER_STAFF),
    ];

    // Per-beat triplet detection FIRST: snaps triplet beats to the triplet grid
    // and drops sub-grid fragments, so detached/imprecise triplets don't survive
    // as 16th/64th clusters. Binary beats pass through untouched.
    const tripletSnapped = quantizeTripletBeats(voicedNotes);

    // Extend staccato notes to fill small gaps before the rest-filler runs.
    // e.g. a chord played for 472 ticks (staccato quarter = 960 intended) is extended
    // to its next onset so no spurious rest appears mid-beat.
    const ticksPerMeasure = TICKS_PER_QUARTER * parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);
    const extendedNotes = extendNotesToNextOnset(tripletSnapped, ticksPerMeasure);

    // Quantise MIDI timings before trim/normalise (see importMidi for rationale).
    const quantizedNotes = quantizeMidiTimings(extendedNotes);

    // Trim overlapping notes per (voice, clef). For voice=0 ACC this preserves
    // cross-clef polyphony (a sustained bass note + a fast treble figure remain
    // independent) and skips chord tones (same startTick).
    const trimmedNotes = trimOverlappingNotes(quantizedNotes);

    // Normalize rhythm (same as SATB import) — voice=0 stream for accompaniment.
    // Splits notes/rests on beat boundaries and decomposes non-standard durations.
    const notes = normalizeRhythm(trimmedNotes, parsed.timeSignature, []);

    const newId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `acc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      id: newId,
      name: 'Piano',
      instrumentId: 0,
      notes,
      muted: false,
      visible: true,
      volume: 1,
      staffMode: 'grandstaff',
    };
  }, [pickMidiFile, project.keySignatureRoot, project.isMinorMode]);

  return {
    exportMidi,
    importMidi,
    importMidiAsAccompaniment,
    pickMidiFile,
  };
}
