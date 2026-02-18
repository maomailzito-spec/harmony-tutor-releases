export type ParsedMidiNote = {
  tick: number;
  durationTicks: number;
  midi: number;
  velocity: number;
  channel: number;
  track: number;
};

export type ParsedMidi = {
  tpq: number;
  tempoBpm: number;
  timeSignature: { numerator: number; denominator: number };
  keySignature?: { sharps: number; isMinor: boolean };
  notes: ParsedMidiNote[];
};

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function readStr(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function readVlq(view: DataView, start: number): { value: number; next: number } {
  let value = 0;
  let pos = start;
  for (let i = 0; i < 4; i++) {
    const byte = view.getUint8(pos++);
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return { value, next: pos };
}

export function parseMidi(buffer: ArrayBuffer): ParsedMidi {
  const view = new DataView(buffer);
  let pos = 0;

  if (readStr(view, pos, 4) !== 'MThd') {
    throw new Error('File MIDI non valido (header MThd mancante).');
  }
  pos += 4;

  const headerLen = readU32(view, pos); pos += 4;
  const format = readU16(view, pos); pos += 2;
  const tracksCount = readU16(view, pos); pos += 2;
  const division = readU16(view, pos); pos += 2;

  if (headerLen > 6) pos += (headerLen - 6);
  if ((division & 0x8000) !== 0) {
    throw new Error('MIDI SMPTE non supportato in questa build.');
  }

  const tpq = Math.max(1, division);
  let tempoBpm = 120;
  let tsNum = 4;
  let tsDen = 4;
  let keySharps: number | null = null;
  let keyIsMinor = false;

  const active = new Map<string, Array<{ tick: number; velocity: number; track: number }>>();
  const notes: ParsedMidiNote[] = [];

  const pushNoteOff = (channel: number, note: number, tick: number) => {
    const key = `${channel}:${note}`;
    const stack = active.get(key);
    if (!stack || stack.length === 0) return;
    const on = stack.pop();
    if (!on) return;
    const durationTicks = Math.max(1, tick - on.tick);
    notes.push({ tick: on.tick, durationTicks, midi: note, velocity: on.velocity, channel, track: on.track });
  };

  for (let t = 0; t < tracksCount; t++) {
    if (readStr(view, pos, 4) !== 'MTrk') {
      throw new Error('Chunk track MIDI non valido (MTrk mancante).');
    }
    pos += 4;
    const trackLen = readU32(view, pos); pos += 4;
    const trackEnd = pos + trackLen;

    let absTick = 0;
    let runningStatus = 0;

    while (pos < trackEnd) {
      const delta = readVlq(view, pos);
      absTick += delta.value;
      pos = delta.next;

      let status = view.getUint8(pos);
      if ((status & 0x80) !== 0) {
        pos += 1;
        runningStatus = status;
      } else {
        status = runningStatus;
      }

      if (status === 0xff) {
        const metaType = view.getUint8(pos++);
        const len = readVlq(view, pos);
        pos = len.next;

        if (metaType === 0x51 && len.value === 3) {
          const usPerQuarter = (view.getUint8(pos) << 16) | (view.getUint8(pos + 1) << 8) | view.getUint8(pos + 2);
          if (usPerQuarter > 0) tempoBpm = Math.round(60000000 / usPerQuarter);
        } else if (metaType === 0x58 && len.value >= 2) {
          tsNum = Math.max(1, view.getUint8(pos));
          const dd = view.getUint8(pos + 1);
          tsDen = Math.max(1, Math.pow(2, dd));
        } else if (metaType === 0x59 && len.value >= 2) {
          // Key signature: sf = signed byte (-7..+7, neg=flats, pos=sharps), mi = 0 major / 1 minor
          keySharps = view.getInt8(pos);
          keyIsMinor = view.getUint8(pos + 1) === 1;
        }

        pos += len.value;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const len = readVlq(view, pos);
        pos = len.next + len.value;
        continue;
      }

      const hi = status & 0xf0;
      const ch = status & 0x0f;

      if (hi === 0x80 || hi === 0x90) {
        const note = view.getUint8(pos++);
        const vel = view.getUint8(pos++);
        if (hi === 0x90 && vel > 0) {
          const key = `${ch}:${note}`;
          const stack = active.get(key) || [];
          stack.push({ tick: absTick, velocity: vel, track: t });
          active.set(key, stack);
        } else {
          pushNoteOff(ch, note, absTick);
        }
        continue;
      }

      if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        pos += 2;
        continue;
      }
      if (hi === 0xc0 || hi === 0xd0) {
        pos += 1;
        continue;
      }

      // Unknown status: stop this track safely.
      break;
    }

    pos = trackEnd;
  }

  // Close hanging notes at the latest tick found.
  const maxTick = notes.reduce((mx, n) => Math.max(mx, n.tick + n.durationTicks), 0);
  for (const [key, stack] of active.entries()) {
    const [channelStr, midiStr] = key.split(':');
    const channel = Number(channelStr);
    const midi = Number(midiStr);
    for (const on of stack) {
      notes.push({
        tick: on.tick,
        durationTicks: Math.max(1, maxTick - on.tick),
        midi,
        velocity: on.velocity,
        channel,
        track: on.track,
      });
    }
  }

  notes.sort((a, b) => (a.tick - b.tick) || (a.channel - b.channel) || (a.midi - b.midi));

  return {
    tpq,
    tempoBpm,
    timeSignature: { numerator: tsNum, denominator: tsDen },
    ...(keySharps !== null ? { keySignature: { sharps: keySharps, isMinor: keyIsMinor } } : {}),
    notes,
  };
}
