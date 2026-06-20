import type { StaffNote, TimeSignature } from '../types';
import { TICKS_PER_QUARTER } from '../constants';

const DEFAULT_TPQ = 480;
const APP_TPQ = Math.max(1, Number(TICKS_PER_QUARTER) || 480);

const DURATION_BEATS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  'thirty-second': 0.125,
  'sixty-fourth': 0.0625,
};

type MidiEvent = {
  tick: number;
  order: number;
  bytes: number[];
};

function encodeVlq(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function writeU16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function writeU32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function durationBeats(note: StaffNote): number {
  const base = DURATION_BEATS[String(note.duration || 'quarter')] ?? 1;
  let beats = base;
  if (note.isDotted) beats *= 1.5;
  if (note.isTriplet) beats *= 2 / 3;
  if (note.isDuplet) beats *= 3 / 2;
  return beats;
}

function noteTick(note: StaffNote, beatsPerMeasure: number): number {
  if (Number.isFinite(note.startTick as number)) {
    const appTicks = Math.max(0, Math.round(Number(note.startTick)));
    return Math.max(0, Math.round((appTicks * DEFAULT_TPQ) / APP_TPQ));
  }
  const measureIndex = Number.isFinite(note.measureIndex as number) ? Number(note.measureIndex) : 0;
  const beat = Number.isFinite(note.beat as number) ? Number(note.beat) : 1;
  const absBeats = (measureIndex * beatsPerMeasure) + (beat - 1);
  return Math.max(0, Math.round(absBeats * DEFAULT_TPQ));
}

/** Velocity da scrivere nel note-on. Usa la velocity catturata (import/registrazione)
 *  se presente, altrimenti il default storico 88 per le note inserite a mano. */
function noteVelocity(note: StaffNote): number {
  const v = Number(note.velocity);
  if (Number.isFinite(v) && v > 0) return Math.max(1, Math.min(127, Math.round(v)));
  return 88;
}

function noteDurationTicks(note: StaffNote): number {
  if (Number.isFinite(note.durationTicks as number) && Number(note.durationTicks) > 0) {
    const appTicks = Math.max(1, Math.round(Number(note.durationTicks)));
    return Math.max(1, Math.round((appTicks * DEFAULT_TPQ) / APP_TPQ));
  }
  return Math.max(1, Math.round(durationBeats(note) * DEFAULT_TPQ));
}

function tempoMetaEventBpm(bpm: number): number[] {
  const safeBpm = Math.max(20, Math.min(300, Math.round(Number(bpm) || 120)));
  const microsPerQuarter = Math.round(60000000 / safeBpm);
  return [0xff, 0x51, 0x03, (microsPerQuarter >> 16) & 0xff, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff];
}

function timeSignatureMetaEvent(ts: TimeSignature): number[] {
  const n = Math.max(1, Math.round(Number(ts?.numerator) || 4));
  const d = Math.max(1, Math.round(Number(ts?.denominator) || 4));
  const dd = Math.log2(d);
  const ddPow = Number.isFinite(dd) ? Math.max(0, Math.min(7, Math.round(dd))) : 2;
  return [0xff, 0x58, 0x04, n & 0xff, ddPow & 0xff, 24, 8];
}

export type MidiWriterProject = {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  bpm?: number;
  /** 0 = single track (all voices merged), 1 = multi-track (one per voice). Default: 1 */
  midiType?: 0 | 1;
  /** General-MIDI program (0-127) per SATB voice (1-4). When present, a Program
   *  Change is written at the start of each voice's channel so a DAW/synth loads
   *  the assigned instrument. Absent voices default to program 0 (piano). */
  voicePrograms?: Record<number, number>;
};

/** GM program for a voice (0-127), clamped; defaults to 0 (acoustic grand piano). */
function voiceProgram(voicePrograms: Record<number, number> | undefined, voiceNum: number): number {
  const p = voicePrograms?.[voiceNum];
  return Number.isFinite(p) ? Math.max(0, Math.min(127, Math.round(p as number))) : 0;
}

export function buildMidiFile(project: MidiWriterProject): Uint8Array {
  const midiType = project.midiType ?? 1;
  const notes = (project.notes || []).filter(n => n && !n.isRest && Number.isFinite(n.midi));
  const timeSignature = project.timeSignature || { numerator: 4, denominator: 4 };
  const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

  // ── Group notes by voice ──
  const voiceNames = ['Soprano', 'Alto', 'Tenore', 'Basso'];
  const notesByVoice = new Map<number, StaffNote[]>();
  for (const note of notes) {
    const v = note.voice ?? 1;
    if (!notesByVoice.has(v)) notesByVoice.set(v, []);
    notesByVoice.get(v)!.push(note);
  }

  // Sorted voice numbers (1-based) for deterministic track order
  const voiceNums = Array.from(notesByVoice.keys()).sort((a, b) => a - b);

  // ── Track 0: conductor (tempo + time signature, no notes) ──
  function buildConductorTrack(): number[] {
    const events: MidiEvent[] = [];
    events.push({ tick: 0, order: 0, bytes: tempoMetaEventBpm(project.bpm ?? 120) });
    events.push({ tick: 0, order: 1, bytes: timeSignatureMetaEvent(timeSignature) });
    return eventsToTrackData(events);
  }

  // ── Track N: one per voice ──
  function buildVoiceTrack(voiceNum: number, voiceNotes: StaffNote[]): number[] {
    const ch = Math.max(0, Math.min(15, voiceNum - 1));
    const events: MidiEvent[] = [];

    // Track name meta event
    const name = voiceNames[voiceNum - 1] ?? `Voice ${voiceNum}`;
    const nameBytes = Array.from(new TextEncoder().encode(name));
    events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...encodeVlq(nameBytes.length), ...nameBytes] });

    // Program Change: load the voice's assigned instrument on its channel.
    events.push({ tick: 0, order: 1, bytes: [0xc0 | ch, voiceProgram(project.voicePrograms, voiceNum)] });

    for (const note of voiceNotes) {
      const tick = noteTick(note, beatsPerMeasure);
      const dur = noteDurationTicks(note);
      const midi = Math.max(0, Math.min(127, Math.round(Number(note.midi))));
      const velOn = noteVelocity(note);
      events.push({ tick, order: 2, bytes: [0x90 | ch, midi, velOn] });
      events.push({ tick: tick + dur, order: 1, bytes: [0x80 | ch, midi, 0] });
    }

    return eventsToTrackData(events);
  }

  function eventsToTrackData(events: MidiEvent[]): number[] {
    events.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
    const data: number[] = [];
    let lastTick = 0;
    for (const ev of events) {
      const delta = ev.tick - lastTick;
      data.push(...encodeVlq(delta));
      data.push(...ev.bytes);
      lastTick = ev.tick;
    }
    data.push(0x00, 0xff, 0x2f, 0x00); // End of track
    return data;
  }

  // ── Assemble MIDI ──
  let tracks: number[][];

  if (midiType === 0) {
    // Type 0: single track, all voices merged
    const allEvents: MidiEvent[] = [];
    allEvents.push({ tick: 0, order: 0, bytes: tempoMetaEventBpm(project.bpm ?? 120) });
    allEvents.push({ tick: 0, order: 1, bytes: timeSignatureMetaEvent(timeSignature) });
    // Program Change per voice channel so each voice loads its assigned instrument.
    for (const v of voiceNums) {
      const vch = Math.max(0, Math.min(15, v - 1));
      allEvents.push({ tick: 0, order: 1, bytes: [0xc0 | vch, voiceProgram(project.voicePrograms, v)] });
    }
    for (const note of notes) {
      const tick = noteTick(note, beatsPerMeasure);
      const dur = noteDurationTicks(note);
      const ch = Math.max(0, Math.min(15, (note.voice ?? 1) - 1));
      const midi = Math.max(0, Math.min(127, Math.round(Number(note.midi))));
      allEvents.push({ tick, order: 2, bytes: [0x90 | ch, midi, noteVelocity(note)] });
      allEvents.push({ tick: tick + dur, order: 1, bytes: [0x80 | ch, midi, 0] });
    }
    tracks = [eventsToTrackData(allEvents)];
  } else {
    // Type 1: multi-track (conductor + one per voice)
    tracks = [buildConductorTrack()];
    for (const v of voiceNums) {
      tracks.push(buildVoiceTrack(v, notesByVoice.get(v)!));
    }
  }

  const bytes: number[] = [];
  // MThd
  bytes.push(...[0x4d, 0x54, 0x68, 0x64]); // "MThd"
  bytes.push(...writeU32(6));
  bytes.push(...writeU16(midiType));         // Type 0 or 1
  bytes.push(...writeU16(tracks.length));    // Number of tracks
  bytes.push(...writeU16(DEFAULT_TPQ));

  for (const trackData of tracks) {
    bytes.push(...[0x4d, 0x54, 0x72, 0x6b]); // "MTrk"
    bytes.push(...writeU32(trackData.length));
    bytes.push(...trackData);
  }

  return new Uint8Array(bytes);
}
