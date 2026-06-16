
import { CHROMATIC_SCALE } from '../constants';

// Local bundled piano samples (FluidR3_GM acoustic_grand_piano).
// Falls back to the remote CDN only if the local file fails to load.
const SOUND_BASE_URL_LOCAL = './sounds/piano/';
const SOUND_BASE_URL_REMOTE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/';

/**
 * Velocity → low-pass cutoff (Hz). Approximates velocity layers with a single
 * sample: soft notes are darker/rounder, hard notes fully open/bright. Tunable.
 */
const velocityToCutoff = (velocity: number): number => {
  const v = Math.max(1, Math.min(127, velocity)) / 127;
  // Subtle roll-off only: stay mostly open so the timbre change is gentle (a
  // single filtered sample sounds artificial if pushed too far). pp ≈ 5 kHz
  // (slightly rounder), mf ≈ 11 kHz, ff ≈ 20 kHz (open).
  const MIN_HZ = 3500;
  const MAX_HZ = 20000;
  return MIN_HZ + (MAX_HZ - MIN_HZ) * Math.pow(v, 1.2);
};

/**
 * Instruments backed by per-note, per-velocity-LAYER samples (real timbral
 * dynamics, not just a gain change). Samples live in
 * `./sounds/{dir}/{NoteName}_v{layer}.ogg` (layer 0..layers-1, low→high
 * velocity), named with the same NoteName convention as midiToName (flats,
 * A0..C8). Loading falls back gracefully to the standard single-layer sample
 * if a layered file is missing, so this is inert until the assets are present
 * (see scripts/prepare-salamander.mjs).
 */
const VELOCITY_LAYERED: Record<string, { dir: string; layers: number }> = {
  acoustic_grand_piano: { dir: 'piano_salamander', layers: 6 },
};
const pickVelocityLayer = (velocity: number | undefined, layers: number): number =>
  Math.max(0, Math.min(layers - 1, Math.floor(((velocity ?? 100) / 128) * layers)));

/**
 * Sustained instruments whose samples are an ATTACK followed by a seamlessly
 * crossfaded LOOP BODY (see scripts/prepare-orchestra.mjs). For these we set
 * `source.loop` so held notes (long chords, fermatas, pedals) ring for their
 * full duration instead of cutting off when the sample ends. The loop region is
 * `[loopStartSec .. buffer.duration]` (the body that follows the attack).
 * `ext` is the local file format (FLAC for these; the historical mp3 stays the
 * default for everything else). Inert until the FLAC assets are present.
 */
// Tutti i FLAC sono il campione NATURALE lungo (fino a ~8s) con loop SOLO in coda
// (vedi prepare-orchestra.mjs): le note ≤ durata file suonano naturali, senza loop;
// loopStart è dove la nota torna quando è tenuta oltre il file. loopEnd = durata.
const SUSTAINED: Record<string, { loopStartSec: number; ext: 'flac' | 'mp3' }> = {
  string_ensemble_1: { loopStartSec: 1.0, ext: 'flac' }, // sezione violini VSCO2 (Fase 1)
  cello: { loopStartSec: 1.0, ext: 'flac' },             // sezione celli VSCO2
  violin: { loopStartSec: 1.0, ext: 'flac' },            // violino SOLO VSCO2 (sorgenti ripuliti dai cambi d'arco)
  flute: { loopStartSec: 1.0, ext: 'flac' },             // flauto VSCO2
  oboe: { loopStartSec: 1.0, ext: 'flac' },              // oboe VSCO2
  clarinet: { loopStartSec: 1.0, ext: 'flac' },          // clarinetto VSCO2
  trumpet: { loopStartSec: 1.0, ext: 'flac' },           // tromba VSCO2
  french_horn: { loopStartSec: 1.0, ext: 'flac' },       // corno VSCO2
  church_organ: { loopStartSec: 1.0, ext: 'flac' },      // organo VSCO2 CE (CC0)
};
const instrumentExt = (instrument: string): 'flac' | 'mp3' => SUSTAINED[instrument]?.ext ?? 'mp3';

/**
 * Per-instrument playback gain = the orchestral MIX TRIM. Samples are rendered
 * to a common loudness reference (LUFS, see prepare-orchestra.mjs); this map
 * balances each instrument against the piano (the untouched reference) and each
 * other, in ONE place, tunable by ear without re-rendering any asset. 1 = unity.
 */
const INSTRUMENT_GAIN: Record<string, number> = {
  // Tutti renderizzati a −18 LUFS; 0.32 (≈ −10 dB) pareggia l'attacco del piano.
  // Punto di partenza uniforme, da tarare a orecchio per-strumento al gate.
  string_ensemble_1: 0.32,
  cello: 0.32,
  violin: 0.32,
  flute: 0.32,
  oboe: 0.32,
  clarinet: 0.32,
  trumpet: 0.32,
  french_horn: 0.32,
  church_organ: 0.32,
};
const instrumentGain = (instrument: string): number => INSTRUMENT_GAIN[instrument] ?? 1;

/** Handle for a sustained (note-on/note-off) monitored note. */
export interface SustainHandle {
  _released: boolean;
  _source: AudioBufferSourceNode | null;
  _gain: GainNode | null;
  /** Fade the note out over `releaseSec` and stop it. */
  release: (releaseSec?: number) => void;
}

export class AudioService {
  public audioContext: AudioContext | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  // Negative cache: keys (note / instrument::note / layered key) that failed to
  // load, so we don't re-fetch the same missing sample on every play (avoids a
  // storm of repeated 404s).
  private failedLoads: Set<string> = new Set();

  public async init(): Promise<void> {
    if (this.audioContext) return;

    return new Promise(async (resolve, reject) => {
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            await this.loadInitialSounds();
            resolve();
        } catch (error) {
            reject(error);
        }
    });
  }

  public async ensureAudioIsReady(): Promise<void> {
      if (!this.audioContext) {
          await this.init();
      }
      if (this.audioContext && this.audioContext.state === 'suspended') {
          try {
              await this.audioContext.resume();
          } catch (e) {
              // errore silenziato
          }
      }
  }

  private async loadAudioFile(audioFile: string): Promise<void> {
    if (!this.audioContext) throw new Error('AudioContext not initialized.');
    if (this.audioBuffers.has(audioFile) || this.failedLoads.has(audioFile)) return;

    // Try local bundled file first, then fall back to remote CDN.
    for (const base of [SOUND_BASE_URL_LOCAL, SOUND_BASE_URL_REMOTE]) {
      try {
        const response = await fetch(`${base}${audioFile}.mp3`);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength < 100) continue; // empty / error page
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.audioBuffers.set(audioFile, audioBuffer);
        return;
      } catch {
        // try next source
      }
    }
    // Both sources failed — remember it so we don't re-fetch every play.
    this.failedLoads.add(audioFile);
  }

  private async loadInitialSounds(): Promise<void> {
    const soundPromises = CHROMATIC_SCALE.map(note => this.loadAudioFile(note.audioFile));
    await Promise.all(soundPromises);
  }

  public async playNote(audioFile: string, options?: { duration?: number, when?: number, volume?: number }) {
    if (!this.audioContext) return;

    if (!this.audioBuffers.has(audioFile)) {
        await this.loadAudioFile(audioFile);
    }

    const audioBuffer = this.audioBuffers.get(audioFile);
    if (audioBuffer) {
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = this.audioContext.createGain();
      gainNode.connect(this.audioContext.destination);
      source.connect(gainNode);

      const startTime = options?.when ?? this.audioContext.currentTime;
      const noteDurationInSeconds = options?.duration ?? audioBuffer.duration;
      const releaseDurationInSeconds = 0.5; // Fade-out duration
      const noteEndTime = startTime + noteDurationInSeconds;

      gainNode.gain.setValueAtTime(options?.volume ?? 1, startTime);
      gainNode.gain.linearRampToValueAtTime(0.0001, noteEndTime + releaseDurationInSeconds);

      source.start(startTime);
      source.stop(noteEndTime + releaseDurationInSeconds);

      this.activeSources.add(source);
      source.onended = () => {
        this.activeSources.delete(source);
        try {
            gainNode.disconnect();
            source.disconnect();
        } catch(e) {
            // Node may already be disconnected
        }
      };
    }
  }

  public stopAllSounds() {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    this.activeSources.forEach(source => {
        try {
            source.stop(now);
        } catch (e) {
            // Ignore errors if the source was already stopped or never started
        }
    });
    this.activeSources.clear();
  }


  public async playChord(audioFiles: string[], options: { when: number, duration: number }) {
    if (!this.audioContext) return;
    
    const { when: startTime, duration: noteDurationInSeconds } = options;
    
    await this.preloadNotes(audioFiles);
    
    audioFiles.forEach((audioFile) => {
      const audioBuffer = this.audioBuffers.get(audioFile);

      if (audioBuffer) {
        const source = this.audioContext!.createBufferSource();
        source.buffer = audioBuffer;
        
        const gainNode = this.audioContext!.createGain();
        gainNode.connect(this.audioContext!.destination);
        source.connect(gainNode);

        const releaseDurationInSeconds = 0.5; // Fade-out duration
        const noteEndTime = startTime + noteDurationInSeconds;

        gainNode.gain.setValueAtTime(1, startTime);
        gainNode.gain.linearRampToValueAtTime(0.0001, noteEndTime + releaseDurationInSeconds);

        source.start(startTime);
        source.stop(noteEndTime + releaseDurationInSeconds);

        this.activeSources.add(source);
        source.onended = () => {
          this.activeSources.delete(source);
          try { gainNode.disconnect(); source.disconnect(); } catch (e) {}
        };
      }
    });
  }

  public async preloadNotes(audioFiles: string[]): Promise<void> {
    if (!this.audioContext) return;
    
    const uniqueFilesToLoad = [...new Set(audioFiles.filter(file => !this.audioBuffers.has(file)))];
    
    if (uniqueFilesToLoad.length > 0) {
        await Promise.all(uniqueFilesToLoad.map(file => this.loadAudioFile(file)));
    }
  }

  // ── Per-voice instrument support ──────────────────────────────

  private async _loadInstrumentFile(instrument: string, audioFile: string): Promise<void> {
    if (!this.audioContext) return;
    const key = `${instrument}::${audioFile}`;
    if (this.audioBuffers.has(key) || this.failedLoads.has(key)) return;

    // Try local bundled file first (FLAC for sustained instruments, else mp3),
    // then fall back to remote CDN (mp3 only).
    const localUrl = `./sounds/${instrument}/${audioFile}.${instrumentExt(instrument)}`;
    const remoteUrl = `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/${instrument}-mp3/${audioFile}.mp3`;

    for (const url of [localUrl, remoteUrl]) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength < 100) continue; // empty / error page
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.audioBuffers.set(key, audioBuffer);
        return;
      } catch {
        // try next source
      }
    }
    // Both sources failed — remember it so we don't re-fetch every play.
    this.failedLoads.add(key);
  }

  /** Load one velocity-layer sample (`./sounds/{dir}/{note}_v{layer}.mp3`). */
  private async _loadLayeredSample(dir: string, note: string, layer: number, cacheKey: string): Promise<void> {
    if (!this.audioContext || this.audioBuffers.has(cacheKey) || this.failedLoads.has(cacheKey)) return;
    try {
      const response = await fetch(`./sounds/${dir}/${note}_v${layer}.mp3`);
      if (!response.ok) { this.failedLoads.add(cacheKey); return; }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength < 100) { this.failedLoads.add(cacheKey); return; }
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.audioBuffers.set(cacheKey, audioBuffer);
    } catch {
      this.failedLoads.add(cacheKey); // missing/failed → caller falls back per-note
    }
  }

  /**
   * Resolve the AudioBuffer for a note: prefer a velocity-LAYER sample when the
   * instrument is registered and that note's layer exists; otherwise fall back
   * (per-note) to the standard single-layer sample. Misses are negative-cached,
   * so a missing note doesn't disable layers for the others nor re-fetch. The
   * `layered` flag tells the caller to skip the velocity→timbre filter (real
   * layers already carry the timbral dynamics).
   */
  private async _getBufferFor(instrument: string, audioFile: string, velocity?: number): Promise<{ buffer: AudioBuffer | undefined; layered: boolean }> {
    const cfg = VELOCITY_LAYERED[instrument];
    if (cfg) {
      const layer = pickVelocityLayer(velocity, cfg.layers);
      const lkey = `${cfg.dir}::${audioFile}::v${layer}`;
      if (!this.audioBuffers.has(lkey)) await this._loadLayeredSample(cfg.dir, audioFile, layer, lkey);
      const lbuf = this.audioBuffers.get(lkey);
      if (lbuf) return { buffer: lbuf, layered: true };
      // this note's layer is missing → fall back to the standard sample for THIS
      // note only (negative-cached, so no repeated fetch; other notes still use layers)
    }
    const key = instrument === 'acoustic_grand_piano' ? audioFile : `${instrument}::${audioFile}`;
    if (!this.audioBuffers.has(key)) {
      if (instrument === 'acoustic_grand_piano') await this.loadAudioFile(audioFile);
      else await this._loadInstrumentFile(instrument, audioFile);
    }
    return { buffer: this.audioBuffers.get(key), layered: false };
  }

  public async playNoteForInstrument(instrument: string, audioFile: string, options?: { duration?: number, when?: number, volume?: number, output?: AudioNode, sustain?: boolean, velocity?: number }) {
    if (!this.audioContext) return;
    const { buffer: audioBuffer, layered } = await this._getBufferFor(instrument, audioFile, options?.velocity);
    if (!audioBuffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    // Sustained instruments: loop the body so a held note doesn't cut off when
    // the sample ends. Loop region = [loopStartSec .. end] (body after attack).
    const sus = SUSTAINED[instrument];
    if (sus && audioBuffer.duration > sus.loopStartSec + 0.05) {
      source.loop = true;
      source.loopStart = sus.loopStartSec;
      source.loopEnd = audioBuffer.duration;
    }
    const gainNode = this.audioContext.createGain();
    // If a custom output node is provided (e.g. per-track gain), route through it
    // so the user can mute/change volume in real-time by modulating that node.
    gainNode.connect(options?.output ?? this.audioContext.destination);
    // Optional velocity→timbre low-pass (only for SINGLE-layer samples): darker at
    // low velocity, open at high. Skipped for real velocity-layered samples.
    let filterNode: BiquadFilterNode | null = null;
    if (options?.velocity != null && !layered) {
      filterNode = this.audioContext.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = velocityToCutoff(options.velocity);
      filterNode.Q.value = 0.7;
      filterNode.connect(gainNode);
      source.connect(filterNode);
    } else {
      source.connect(gainNode);
    }
    const startTime = options?.when ?? this.audioContext.currentTime;
    const noteDurationInSeconds = options?.duration ?? audioBuffer.duration;
    const releaseDurationInSeconds = 0.5;
    const noteEndTime = startTime + noteDurationInSeconds;
    const vol = (options?.volume ?? 1) * instrumentGain(instrument);
    if (options?.sustain) {
      // Natural envelope: INSTANT attack (the sample starts from silence, so no
      // click — keeps the percussive transient and lets it scale with velocity),
      // HOLD at full until the note ends, then a release ring. Keeps notes (esp.
      // sustained soundfonts) full and even in level regardless of length — so a
      // short note isn't quieter than a long one (fixes the live-vs-recorded
      // loudness gap), and the held body matches the live monitor.
      gainNode.gain.setValueAtTime(vol, startTime);
      gainNode.gain.setValueAtTime(vol, noteEndTime);
      gainNode.gain.linearRampToValueAtTime(0.0001, noteEndTime + releaseDurationInSeconds);
    } else {
      gainNode.gain.setValueAtTime(vol, startTime);
      gainNode.gain.linearRampToValueAtTime(0.0001, noteEndTime + releaseDurationInSeconds);
    }
    source.start(startTime);
    source.stop(noteEndTime + releaseDurationInSeconds);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try { gainNode.disconnect(); filterNode?.disconnect(); source.disconnect(); } catch (e) {}
    };
  }

  /**
   * Play a note that SUSTAINS until released (note-on / note-off) with the SAME
   * shape as a played-back note: soft anti-click attack, HOLD at full while held,
   * then a natural release ring on `release()`. Used for live MIDI monitoring so
   * what you hear matches exactly what gets recorded (same instrument, gain and
   * envelope) — no louder/duller/staccato mismatch. Loading is async; releasing
   * before the buffer is ready cancels the start so no stuck note is left.
   */
  public playSustainedNote(
    instrument: string,
    audioFile: string,
    options?: { volume?: number; output?: AudioNode; velocity?: number },
  ): SustainHandle {
    const handle: SustainHandle = {
      _released: false,
      _source: null,
      _gain: null,
      release: (releaseSec = 0.5) => {
        handle._released = true;
        const ac = this.audioContext;
        if (!ac || !handle._gain || !handle._source) return;
        const now = ac.currentTime;
        try {
          handle._gain.gain.cancelScheduledValues(now);
          handle._gain.gain.setValueAtTime(Math.max(0.0001, handle._gain.gain.value), now);
          handle._gain.gain.linearRampToValueAtTime(0.0001, now + releaseSec);
        } catch { /* ignore */ }
        try { handle._source.stop(now + releaseSec + 0.05); } catch { /* ignore */ }
      },
    };

    void (async () => {
      if (!this.audioContext) return;
      const { buffer: audioBuffer, layered } = await this._getBufferFor(instrument, audioFile, options?.velocity);
      if (!audioBuffer || handle._released || !this.audioContext) return;

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      // Sustained instruments: loop the body so a long held key keeps ringing
      // (matches the played-back behaviour). Loop region = [loopStartSec .. end].
      const sus = SUSTAINED[instrument];
      if (sus && audioBuffer.duration > sus.loopStartSec + 0.05) {
        source.loop = true;
        source.loopStart = sus.loopStartSec;
        source.loopEnd = audioBuffer.duration;
      }
      const gainNode = this.audioContext.createGain();
      gainNode.connect(options?.output ?? this.audioContext.destination);
      // Optional velocity→timbre low-pass (single-layer only; skipped for real
      // velocity-layered samples which already carry the timbral dynamics).
      let filterNode: BiquadFilterNode | null = null;
      if (options?.velocity != null && !layered) {
        filterNode = this.audioContext.createBiquadFilter();
        filterNode.type = 'lowpass';
        filterNode.frequency.value = velocityToCutoff(options.velocity);
        filterNode.Q.value = 0.7;
        filterNode.connect(gainNode);
        source.connect(filterNode);
      } else {
        source.connect(gainNode);
      }
      const vol = (options?.volume ?? 1) * instrumentGain(instrument);
      const now = this.audioContext.currentTime;
      // Instant attack (the sample already starts from silence, so no click): keeps
      // the natural percussive transient and lets the attack scale with velocity.
      gainNode.gain.setValueAtTime(vol, now);

      source.start();
      handle._source = source;
      handle._gain = gainNode;
      this.activeSources.add(source);
      source.onended = () => {
        this.activeSources.delete(source);
        try { gainNode.disconnect(); filterNode?.disconnect(); source.disconnect(); } catch { /* ignore */ }
      };
    })();

    return handle;
  }

  public async preloadNotesForInstrument(instrument: string, audioFiles: string[]): Promise<void> {
    if (!this.audioContext) return;
    if (instrument === 'acoustic_grand_piano') return this.preloadNotes(audioFiles);
    const unique = [...new Set(audioFiles.filter(f => !this.audioBuffers.has(`${instrument}::${f}`)))];
    if (unique.length > 0) {
      await Promise.all(unique.map(f => this._loadInstrumentFile(instrument, f)));
    }
  }

  public async playGuitarVoicing(audioFiles: string[]): Promise<void> {
    if (!this.audioContext) return;
    
    const now = this.audioContext.currentTime;
    await this.playChord(audioFiles, { when: now, duration: 1.5 });
  }

  public async playClick(strong: boolean, when: number) {
    if (!this.audioContext) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(strong ? 1000 : 800, when);
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(strong ? 0.5 : 0.3, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    
    osc.start(when);
    osc.stop(when + 0.05);
  }
}