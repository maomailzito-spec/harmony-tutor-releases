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
};

export function buildMidiFile(project: MidiWriterProject): Uint8Array {
  const notes = (project.notes || []).filter(n => n && !n.isRest && Number.isFinite(n.midi));
  const timeSignature = project.timeSignature || { numerator: 4, denominator: 4 };
  const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

  const events: MidiEvent[] = [];

  events.push({ tick: 0, order: 0, bytes: tempoMetaEventBpm(project.bpm ?? 120) });
  events.push({ tick: 0, order: 1, bytes: timeSignatureMetaEvent(timeSignature) });

  for (const note of notes) {
    const tick = noteTick(note, beatsPerMeasure);
    const dur = noteDurationTicks(note);
    const ch = Math.max(0, Math.min(15, ((note.voice ?? 1) - 1)));
    const midi = Math.max(0, Math.min(127, Math.round(Number(note.midi))));
    const velOn = 88;
    events.push({ tick, order: 2, bytes: [0x90 | ch, midi, velOn] });
    events.push({ tick: tick + dur, order: 1, bytes: [0x80 | ch, midi, 0] });
  }

  events.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));

  const trackData: number[] = [];
  let lastTick = 0;
  for (const ev of events) {
    const delta = ev.tick - lastTick;
    trackData.push(...encodeVlq(delta));
    trackData.push(...ev.bytes);
    lastTick = ev.tick;
  }

  trackData.push(0x00, 0xff, 0x2f, 0x00);

  const bytes: number[] = [];
  bytes.push(...[0x4d, 0x54, 0x68, 0x64]);
  bytes.push(...writeU32(6));
  bytes.push(...writeU16(0));
  bytes.push(...writeU16(1));
  bytes.push(...writeU16(DEFAULT_TPQ));

  bytes.push(...[0x4d, 0x54, 0x72, 0x6b]);
  bytes.push(...writeU32(trackData.length));
  bytes.push(...trackData);

  return new Uint8Array(bytes);
}
