export type ParsedMidiNote = {
  tick: number;
  /** Sounding length: how long the note RINGS, i.e. extended by the sustain
   *  pedal (CC 64) up to the pedal release / re-press. Use this for playback. */
  durationTicks: number;
  /** Un-pedaled length: how long the KEY was physically held (note-on→note-off),
   *  ignoring pedal sustain. Equals durationTicks when no pedal extended the note.
   *  Use this for NOTATION so pedal resonance doesn't inflate a 16th into a held
   *  value. A genuinely long key-hold (a real independent voice) is unaffected. */
  notatedTicks: number;
  midi: number;
  velocity: number;
  channel: number;
  track: number;
};

/** Un cambio di tempo in chiave nel file, con il tick assoluto in cui entra in vigore. */
export type ParsedTimeSignature = {
  tick: number;
  numerator: number;
  denominator: number;
};

export type ParsedMidi = {
  tpq: number;
  tempoBpm: number;
  /** Il PRIMO tempo in chiave del file (retro-compatibilità). */
  timeSignature: { numerator: number; denominator: number };
  /** TUTTI i tempi in chiave, in ordine di tick. Prima se ne teneva UNO SOLO e i cambi
   *  successivi andavano persi: le note venivano poi divise in battute su un metro
   *  costante, quindi da lì in avanti finivano nella misura e sul movimento sbagliati
   *  (con pause di riempimento inventate per "completare" battute che non esistevano). */
  timeSignatureChanges: ParsedTimeSignature[];
  keySignature?: { sharps: number; isMinor: boolean };
  notes: ParsedMidiNote[];
  /** Nome di ogni traccia (meta 0x03), indicizzato per numero di traccia. Voci vuote = senza nome. */
  trackNames: string[];
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
  // Capture the INITIAL tempo/time-signature (the event at the smallest tick),
  // not the last one. A file that joins two pieces has a tempo/TS change partway
  // through; keeping the last value gave the wrong project tempo (e.g. 32 instead
  // of the opening 75) and barred the first piece against the wrong meter.
  let tempoBpm = 120;
  let tempoTick = Infinity;
  let tsNum = 4;
  let tsDen = 4;
  let tsTick = Infinity;
  // Tutti i cambi di metro incontrati (in qualunque traccia): raccolti qui e riordinati
  // alla fine. In un file multi-traccia i meta di tempo stanno di norma nella traccia 0,
  // ma non è garantito, quindi si accettano da tutte.
  const tsEvents: ParsedTimeSignature[] = [];
  let keySharps: number | null = null;
  let keyIsMinor = false;

  // keyOffTick = the tick the KEY was released (note-off), set when a note-off is
  // deferred because the sustain pedal was held. Lets us recover the un-pedaled
  // (notated) length separately from the pedal-extended sounding length.
  type ActiveEntry = { tick: number; velocity: number; track: number; keyOffTick?: number };
  const active = new Map<string, Array<ActiveEntry>>();
  const notes: ParsedMidiNote[] = [];
  const trackNames: string[] = [];

  // Sustain pedal (CC 64) state per channel. When ON, note-offs are deferred
  // so the note keeps "ringing" until the pedal releases — exactly the piano
  // sustain behaviour Logic & friends export via CC 64 rather than extending
  // raw note durations.
  const sustainOn = new Map<number, boolean>();
  // Note-offs that arrived while sustain was held, waiting for pedal release.
  // Key: `${channel}:${note}`, Value: the original note-on entry.
  const sustainPending = new Map<string, ActiveEntry>();

  /** Emit a finalized note into the notes[] array. `offTick` is the SOUNDING end
   *  (pedal release / interrupt / EOF); `on.keyOffTick`, when present, is the
   *  earlier KEY release used for the notated length. */
  const emitNote = (channel: number, note: number, on: ActiveEntry, offTick: number) => {
    const durationTicks = Math.max(1, offTick - on.tick);
    const notatedTicks = Math.max(1, (on.keyOffTick ?? offTick) - on.tick);
    notes.push({ tick: on.tick, durationTicks, notatedTicks, midi: note, velocity: on.velocity, channel, track: on.track });
  };

  const pushNoteOff = (channel: number, note: number, tick: number) => {
    const key = `${channel}:${note}`;
    const stack = active.get(key);
    if (!stack || stack.length === 0) return;
    const on = stack.pop();
    if (!on) return;
    // If sustain pedal is held, defer finalization. The note's "real" off tick
    // will be the pedal release tick (or the next note-on of the same key,
    // which interrupts the sustained sound).
    if (sustainOn.get(channel)) {
      // If there was already a pending sustained off for this exact key (rare
      // edge case: note ended → sustained → never re-played → another note
      // ended on same key without a fresh note-on), finalize the older one at
      // the current tick to avoid losing it.
      const prev = sustainPending.get(key);
      if (prev) emitNote(channel, note, prev, tick);
      // Remember when the key was actually released; the note will be finalised
      // (sounding) later at the pedal release, but its notated length stops here.
      on.keyOffTick = tick;
      sustainPending.set(key, on);
      return;
    }
    emitNote(channel, note, on, tick);
  };

  /** Releasing the pedal: finalize every pending note in this channel at the
   *  release tick. Notes from other channels are untouched. */
  const releaseSustainForChannel = (channel: number, atTick: number) => {
    const prefix = `${channel}:`;
    const toRelease: string[] = [];
    for (const key of sustainPending.keys()) {
      if (key.startsWith(prefix)) toRelease.push(key);
    }
    for (const key of toRelease) {
      const entry = sustainPending.get(key);
      if (!entry) continue;
      sustainPending.delete(key);
      const noteNum = Number(key.slice(prefix.length));
      emitNote(channel, noteNum, entry, atTick);
    }
  };

  /** Re-pressing a key while pedal is held replaces the sustained sound: the
   *  prior pending note is finalized at the new on-tick, freeing the slot for
   *  the new note-on. */
  const interruptSustainedNote = (channel: number, note: number, newOnTick: number) => {
    const key = `${channel}:${note}`;
    const prev = sustainPending.get(key);
    if (!prev) return;
    sustainPending.delete(key);
    emitNote(channel, note, prev, newOnTick);
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
          if (usPerQuarter > 0 && absTick < tempoTick) { tempoBpm = Math.round(60000000 / usPerQuarter); tempoTick = absTick; }
        } else if (metaType === 0x58 && len.value >= 2) {
          const evNum = Math.max(1, view.getUint8(pos));
          const evDen = Math.max(1, Math.pow(2, view.getUint8(pos + 1)));
          tsEvents.push({ tick: absTick, numerator: evNum, denominator: evDen });
          if (absTick < tsTick) {
            tsNum = evNum;
            tsDen = evDen;
            tsTick = absTick;
          }
        } else if (metaType === 0x59 && len.value >= 2) {
          // Key signature: sf = signed byte (-7..+7, neg=flats, pos=sharps), mi = 0 major / 1 minor
          keySharps = view.getInt8(pos);
          keyIsMinor = view.getUint8(pos + 1) === 1;
        } else if (metaType === 0x03 && len.value > 0) {
          // Track name (meta 0x03): usato per nominare le parti ACC importate. Primo per traccia.
          if (!trackNames[t]) trackNames[t] = readStr(view, pos, len.value).trim();
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
          // Re-pressing a key while pedal is held finalises the prior sustained
          // sound at the new on-tick (a fresh sound replaces the ringing one).
          if (sustainOn.get(ch)) interruptSustainedNote(ch, note, absTick);
          const key = `${ch}:${note}`;
          const stack = active.get(key) || [];
          stack.push({ tick: absTick, velocity: vel, track: t });
          active.set(key, stack);
        } else {
          pushNoteOff(ch, note, absTick);
        }
        continue;
      }

      if (hi === 0xb0) {
        // Controller change. CC 64 = sustain pedal (Hold 1).
        const cc = view.getUint8(pos++);
        const value = view.getUint8(pos++);
        if (cc === 64) {
          const wasOn = sustainOn.get(ch) || false;
          const isOn = value >= 64;
          if (wasOn && !isOn) releaseSustainForChannel(ch, absTick);
          sustainOn.set(ch, isOn);
        }
        // Other CCs are intentionally ignored (we only care about sustain).
        continue;
      }

      if (hi === 0xa0 || hi === 0xe0) {
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
      const durationTicks = Math.max(1, maxTick - on.tick);
      notes.push({
        tick: on.tick,
        durationTicks,
        notatedTicks: Math.max(1, (on.keyOffTick ?? maxTick) - on.tick),
        midi,
        velocity: on.velocity,
        channel,
        track: on.track,
      });
    }
  }

  // Pedal still held at file end: finalize any pending sustained notes at the
  // latest tick we've seen — equivalent to an implicit pedal release.
  for (const [key, entry] of sustainPending.entries()) {
    const [channelStr, midiStr] = key.split(':');
    const channel = Number(channelStr);
    const midi = Number(midiStr);
    notes.push({
      tick: entry.tick,
      durationTicks: Math.max(1, maxTick - entry.tick),
      notatedTicks: Math.max(1, (entry.keyOffTick ?? maxTick) - entry.tick),
      midi,
      velocity: entry.velocity,
      channel,
      track: entry.track,
    });
  }

  notes.sort((a, b) => (a.tick - b.tick) || (a.channel - b.channel) || (a.midi - b.midi));

  // Cambi di metro: in ordine di tick, uno solo per tick (in un file multi-traccia lo
  // stesso cambio può comparire in più tracce) e senza ripetere un metro già in vigore.
  tsEvents.sort((a, b) => a.tick - b.tick);
  const timeSignatureChanges: ParsedTimeSignature[] = [];
  for (const ev of tsEvents) {
    const last = timeSignatureChanges[timeSignatureChanges.length - 1];
    if (last && last.tick === ev.tick) continue;
    if (last && last.numerator === ev.numerator && last.denominator === ev.denominator) continue;
    timeSignatureChanges.push(ev);
  }
  // Se il file non dichiara nulla a tick 0, il 4/4 implicito parte comunque da lì.
  if (timeSignatureChanges.length === 0 || timeSignatureChanges[0].tick > 0) {
    timeSignatureChanges.unshift({ tick: 0, numerator: tsNum, denominator: tsDen });
  }

  return {
    tpq,
    tempoBpm,
    timeSignature: { numerator: tsNum, denominator: tsDen },
    timeSignatureChanges,
    ...(keySharps !== null ? { keySignature: { sharps: keySharps, isMinor: keyIsMinor } } : {}),
    notes,
    trackNames,
  };
}
