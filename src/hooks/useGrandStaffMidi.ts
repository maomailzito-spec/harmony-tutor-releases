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

function beatsToDurationFlags(beats: number): { duration: StaffNote['duration']; isDotted: boolean; isTriplet: boolean; isDuplet: boolean } {
  const bases: Array<{ duration: StaffNote['duration']; beats: number }> = [
    { duration: 'whole', beats: 4 },
    { duration: 'half', beats: 2 },
    { duration: 'quarter', beats: 1 },
    { duration: 'eighth', beats: 0.5 },
    { duration: 'sixteenth', beats: 0.25 },
    { duration: 'thirty-second', beats: 0.125 },
    { duration: 'sixty-fourth', beats: 0.0625 },
  ];

  let best = { duration: 'quarter' as StaffNote['duration'], isDotted: false, isTriplet: false, isDuplet: false, diff: Infinity };
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
): StaffNote {
  const absBeats = n.tick / tpq;
  const durBeats = n.durationTicks / tpq;
  const measureIndex = Math.max(0, Math.floor(absBeats / Math.max(1, beatsPerMeasure)));
  const beat = 1 + (absBeats - (measureIndex * beatsPerMeasure));

  const clef = inferClefFromMidi(n.midi);
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
function extendNotesToNextOnset(notes: StaffNote[], ticksPerMeasure: number): StaffNote[] {
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

    // Fill rhythmic gaps in each voice/measure with explicit rests so the score
    // renders without holes and the playback timeline doesn't collapse silence.
    const notes = fillRestsAfterImport(convertedNotes, parsed.timeSignature, []);

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

    const convertedNotes: StaffNote[] = parsed.notes.map((n, idx) =>
      convertParsedNoteToStaffNote(n, idx, tpq, beatsPerMeasure, keySig, 0)
    );

    // Extend staccato notes to fill small gaps before the rest-filler runs.
    // e.g. a chord played for 472 ticks (staccato quarter = 960 intended) is extended
    // to its next onset so no spurious rest appears mid-beat.
    const ticksPerMeasure = TICKS_PER_QUARTER * parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);
    const extendedNotes = extendNotesToNextOnset(convertedNotes, ticksPerMeasure);

    // Same gap-filling as SATB — voice=0 for accompaniment. Rests are inserted
    // per measure of the track so the rhythm reads correctly on its Grand Staff.
    const notes = fillRestsAfterImport(extendedNotes, parsed.timeSignature, []);

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
