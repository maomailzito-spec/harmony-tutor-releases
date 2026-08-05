import type { StaffNote, TimeSignature } from '../types';
import { TICKS_PER_QUARTER } from '../constants';
import { velocityAtAbsBeat, type DynamicMark } from './dynamics';
import { octaveOffsetSemitones, type OctaveSpan } from './octaveShifts';

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

/** Punto della nota sulla linea del tempo, in semiminime dall'inizio: è l'unità in cui
 *  sono ancorati i segni di dinamica. Stessa convenzione di `noteTick`, ma senza la
 *  conversione alla risoluzione del file MIDI. */
function noteAbsBeat(note: StaffNote, beatsPerMeasure: number): number {
  if (Number.isFinite(note.startTick as number)) return Math.max(0, Number(note.startTick)) / APP_TPQ;
  const measureIndex = Number.isFinite(note.measureIndex as number) ? Number(note.measureIndex) : 0;
  const beat = Number.isFinite(note.beat as number) ? Number(note.beat) : 1;
  return Math.max(0, (measureIndex * beatsPerMeasure) + (beat - 1));
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
  /** CAMBI DI METRO del brano. Vanno scritti nella traccia direttore: senza, il file
   *  dichiara un metro costante e qualunque programma che lo rilegga (il nostro import
   *  compreso) divide le battute nel posto sbagliato dal primo cambio in avanti. */
  timeSignatureChanges?: Array<{ measureIndex?: number; numerator: number; denominator: number }>;
  bpm?: number;
  /** TRACCE DI ACCOMPAGNAMENTO. Vanno esportate come le voci del coro: senza, un brano
   *  scritto su una traccia usciva in un file VUOTO (l'export riceveva solo `notes`,
   *  cioè il SATB). Ogni traccia diventa una traccia MIDI con il suo nome, il suo
   *  strumento e il suo canale. */
  accompanimentTracks?: Array<{
    name?: string;
    notes: StaffNote[];
    instrumentId?: number;
    isDrum?: boolean;
    /** Canale scelto dall'utente (1-16); assente = automatico, come nel playback. */
    midiChannel?: number;
    /** Righi traspositori (chitarra/basso 8vb): il MIDI porta l'altezza SUONATA. */
    octaveTranspose?: number;
  }>;
  /** SEGNI DI DINAMICA del brano (pp…ff, sf, fp, forcelle). Quando ce n'è almeno uno
   *  comandano loro la velocity dei note-on, con la stessa curva e le stesse forcelle
   *  che si sentono in esecuzione: senza, il file usciva tutto sullo stesso livello e
   *  le dinamiche scritte sparivano al primo export. Quando non ce n'è nessuno resta
   *  la velocity della nota (import MIDI, registrazione), che è l'unica informazione
   *  dinamica del brano. */
  dynamics?: DynamicMark[];
  /** SEGNI D'OTTAVA risolti sui tick. Il MIDI porta l'altezza SUONATA: senza questi,
   *  un passaggio scritto sotto con l'8va usciva un'ottava più in basso di come si sente. */
  octaveSpans?: OctaveSpan[];
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

  // Velocity da scrivere: comandano i segni di dinamica se ce n'è, altrimenti la
  // velocity della nota. È la STESSA precedenza dell'esecuzione — un file importato
  // con dinamiche vere non va appiattito su un mezzoforte solo perché nessuno ha
  // ancora scritto un segno.
  const segni = (project.dynamics || []).filter(Boolean);
  const tratti = (project.octaveSpans || []).filter(Boolean);
  /** Semitoni d'ottava per una nota (0 se non sta sotto nessun segno). */
  const scartoOttava = (note: StaffNote): number =>
    tratti.length === 0 ? 0 : octaveOffsetSemitones(tratti, Number((note as any).startTick ?? 0), Number((note as any).voice ?? 1));
  const velocityDaScrivere = segni.length > 0
    ? (note: StaffNote) => velocityAtAbsBeat(segni, noteAbsBeat(note, beatsPerMeasure))
    : noteVelocity;

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

  // ── Track 0: conductor (tempo + time signature + CAMBI di metro, no notes) ──
  function buildConductorTrack(): number[] {
    const events: MidiEvent[] = [];
    events.push({ tick: 0, order: 0, bytes: tempoMetaEventBpm(project.bpm ?? 120) });
    events.push({ tick: 0, order: 1, bytes: timeSignatureMetaEvent(timeSignature) });
    // Ogni cambio va al tick d'inizio della SUA battuta, calcolato accumulando la
    // lunghezza delle battute precedenti col metro in vigore volta per volta.
    const changes = (project.timeSignatureChanges || [])
      .filter(c => c && Number.isFinite(c.measureIndex as number) && c.numerator > 0 && c.denominator > 0)
      .map(c => ({ measureIndex: Number(c.measureIndex), numerator: c.numerator, denominator: c.denominator }))
      .sort((a, b) => a.measureIndex - b.measureIndex);
    // Deduplica (un progetto può portarsi dietro lo stesso cambio più volte) e salta
    // quelli che non cambiano nulla rispetto al metro già in vigore.
    let cur: TimeSignature = timeSignature;
    let tick = 0;
    let measure = 0;
    for (const ch of changes) {
      if (ch.measureIndex < measure) continue;
      while (measure < ch.measureIndex) {
        tick += Math.round(cur.numerator * (4 / cur.denominator) * DEFAULT_TPQ);
        measure++;
      }
      if (ch.numerator === cur.numerator && ch.denominator === cur.denominator) continue;
      cur = { numerator: ch.numerator, denominator: ch.denominator };
      events.push({ tick, order: 1, bytes: timeSignatureMetaEvent(cur) });
    }
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
      const midi = Math.max(0, Math.min(127, Math.round(Number(note.midi) + scartoOttava(note))));
      const velOn = velocityDaScrivere(note);
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

  // ── Tracce di accompagnamento ──
  // Canale: stessa convenzione del playback — esplicito se scelto, batteria sul 10
  // (indice 9), altrimenti dal 5 in su saltando il 10.
  const accTracks = (project.accompanimentTracks || []).filter(t => t && (t.notes || []).length > 0);
  const accChannel = (t: NonNullable<MidiWriterProject['accompanimentTracks']>[number], idx: number): number => {
    const explicit = Number(t?.midiChannel);
    if (Number.isFinite(explicit) && explicit >= 1 && explicit <= 16) return explicit - 1;
    if (t?.isDrum) return 9;
    let ch = 4 + idx;
    if (ch >= 9) ch += 1;
    return Math.min(15, ch);
  };
  const accNoteEvents = (
    t: NonNullable<MidiWriterProject['accompanimentTracks']>[number],
    ch: number,
  ): MidiEvent[] => {
    const out: MidiEvent[] = [];
    const shift = t.isDrum ? 0 : (Number(t.octaveTranspose) || 0) * 12;
    for (const note of (t.notes || [])) {
      if (!note || note.isRest || !Number.isFinite(note.midi as number)) continue;
      const tick = noteTick(note, beatsPerMeasure);
      const dur = noteDurationTicks(note);
      const midi = Math.max(0, Math.min(127, Math.round(Number(note.midi) + shift + scartoOttava(note))));
      out.push({ tick, order: 2, bytes: [0x90 | ch, midi, velocityDaScrivere(note)] });
      out.push({ tick: tick + dur, order: 1, bytes: [0x80 | ch, midi, 0] });
    }
    return out;
  };
  function buildAccTrack(t: NonNullable<MidiWriterProject['accompanimentTracks']>[number], idx: number): number[] {
    const ch = accChannel(t, idx);
    const events: MidiEvent[] = [];
    const name = String(t.name || `Traccia ${idx + 1}`);
    const nameBytes = Array.from(new TextEncoder().encode(name));
    events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...encodeVlq(nameBytes.length), ...nameBytes] });
    // La batteria sta sul canale 10 e non prende Program Change (il kit è il canale).
    if (!t.isDrum) {
      const prog = Math.max(0, Math.min(127, Math.round(Number(t.instrumentId) || 0)));
      events.push({ tick: 0, order: 1, bytes: [0xc0 | ch, prog] });
    }
    events.push(...accNoteEvents(t, ch));
    return eventsToTrackData(events);
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
      const midi = Math.max(0, Math.min(127, Math.round(Number(note.midi) + scartoOttava(note))));
      allEvents.push({ tick, order: 2, bytes: [0x90 | ch, midi, velocityDaScrivere(note)] });
      allEvents.push({ tick: tick + dur, order: 1, bytes: [0x80 | ch, midi, 0] });
    }
    accTracks.forEach((t, idx) => {
      const ch = accChannel(t, idx);
      if (!t.isDrum) {
        allEvents.push({ tick: 0, order: 1, bytes: [0xc0 | ch, Math.max(0, Math.min(127, Math.round(Number(t.instrumentId) || 0))) ] });
      }
      allEvents.push(...accNoteEvents(t, ch));
    });
    tracks = [eventsToTrackData(allEvents)];
  } else {
    // Type 1: multi-track (conductor + one per voice)
    tracks = [buildConductorTrack()];
    for (const v of voiceNums) {
      tracks.push(buildVoiceTrack(v, notesByVoice.get(v)!));
    }
    accTracks.forEach((t, idx) => tracks.push(buildAccTrack(t, idx)));
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
