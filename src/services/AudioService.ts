
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
  viola: { loopStartSec: 1.0, ext: 'flac' },             // sezione viole VSCO2 (Fase 2B)
  contrabass: { loopStartSec: 1.0, ext: 'flac' },        // contrabbassi VSCO2 (Fase 2B)
  bassoon: { loopStartSec: 1.0, ext: 'flac' },           // fagotto VSCO2 (Fase 2B)
  trombone: { loopStartSec: 1.0, ext: 'flac' },          // trombone VSCO2 (Fase 2B)
  tuba: { loopStartSec: 1.0, ext: 'flac' },              // tuba VSCO2 (Fase 2B)
};
// Strumenti che DECADONO (one-shot): caricano comunque i .flac locali, ma NON sono in
// SUSTAINED → nessun loop (vedi prepare-orchestra.mjs --no-loop).
const ONESHOT_FLAC = new Set<string>([
  'pizzicato_strings', 'timpani', 'marimba', 'glockenspiel', 'xylophone', 'tubular_bells',
  // bassi pizzicato/elettrici: note che decadono → one-shot, niente loop. FLAC locali
  // renderizzati da SFZ (range del set), oltre il quale ripiegano sul GM remoto (mp3).
  'double_bass_pizz', 'electric_bass_finger', 'electric_bass_pick',
  'drums',   // kit batteria ORCHESTRALE (VSCO2): ogni "nota" = un pezzo del kit, one-shot
  'drumkit', // kit batteria ROCK (Salamander): idem, set GM standard
]);
const instrumentExt = (instrument: string): 'flac' | 'mp3' =>
  (SUSTAINED[instrument] || ONESHOT_FLAC.has(instrument)) ? 'flac' : 'mp3';

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
  // Fase 2B
  viola: 0.32,
  contrabass: 0.32,
  bassoon: 0.32,
  trombone: 0.32,
  tuba: 0.32,
  pizzicato_strings: 0.32,
  timpani: 0.32,
  marimba: 0.32,
  glockenspiel: 0.32,
  xylophone: 0.32,
  tubular_bells: 0.32,
  // bassi: FLAC one-shot normalizzati per ATTACCO uniforme (vedi _normalize_attack.py).
  // I tre hanno livelli d'attacco diversi → gain per pareggiarli tra loro e col piano.
  // STIME DI PARTENZA — da affinare a orecchio (l'attacco normalizzato non predice la
  // loudness percepita vs gli strumenti tenuti).
  double_bass_pizz: 1.00,
  electric_bass_finger: 0.40,
  electric_bass_pick: 0.50,
  drums: 0.8,    // kit batteria orchestrale; alzato (era 0.45) per pareggiare il SATB a parità di fader — da rifinire a orecchio
  drumkit: 0.8,  // kit batteria rock (Salamander, picchi a -6 dBFS); alzato (era 0.45) — da rifinire a orecchio
};
const instrumentGain = (instrument: string): number => INSTRUMENT_GAIN[instrument] ?? 1;

/**
 * Banco GM FORZATO: l'utente può scegliere, per voce/traccia, di suonare il vecchio
 * campione GM remoto invece dell'orchestrale locale. I FLAC orchestrali sono tarati a
 * 0.32; i campioni GM (gleitz) hanno un livello loro → gain dedicato. PUNTO DI PARTENZA,
 * da affinare a orecchio.
 */
const GM_GAIN = 0.5;
const gmGain = (_instrument: string): number => GM_GAIN;

/**
 * Coda di release per-strumento (s). La coda lunga di default (0.5s) su una linea
 * o arpeggio di basso si SOMMA nota dopo nota → "effetto pedale"/accavallamento.
 * Per i bassi una coda corta tronca la nota appena prima della successiva: niente
 * pile-up, ma fade morbido (no click). Vale SOLO per questi strumenti; gli altri
 * mantengono la coda lunga (legato/risonanza naturale).
 */
const SHORT_RELEASE: Record<string, number> = {
  double_bass_pizz: 0.06,
  electric_bass_finger: 0.06,
  electric_bass_pick: 0.06,
};
const instrumentRelease = (instrument: string): number => SHORT_RELEASE[instrument] ?? 0.5;

/**
 * Dissolvenza di rilascio ESPONENZIALE.
 *
 * Con una rampa LINEARE d'ampiezza l'orecchio — che è logaritmico — sente il livello
 * quasi immutato per quasi tutta la coda, e poi un crollo negli ultimi millisecondi: su
 * uno strumento che NON decade da solo (archi, fiati, organo) la nota sembra tenere, o
 * addirittura crescere se il campione in quel punto gonfia, e poi essere tagliata di
 * netto. È l'artefatto segnalato come "un crescendo poi tagliato".
 * Una rampa esponenziale toglie una quantità costante di dB al secondo: è quello che fa
 * un suono che si spegne, e la fine non si sente più come un taglio.
 * `exponentialRampToValueAtTime` non può arrivare a zero: si scende a −60 dB, che è
 * silenzio a tutti gli effetti, e lì la sorgente viene fermata senza che si senta.
 */
const RELEASE_FLOOR = 0.001; // −60 dB
const rampDownTo = (gain: AudioParam, from: number, startTime: number, endTime: number): void => {
  const safeFrom = Math.max(RELEASE_FLOOR, from);
  gain.setValueAtTime(safeFrom, startTime);
  if (endTime > startTime) gain.exponentialRampToValueAtTime(RELEASE_FLOOR, endTime);
  else gain.setValueAtTime(RELEASE_FLOOR, startTime);
};

/**
 * Strumenti SOLO-LOCALI: nessun fallback GM remoto. Sono i bassi custom (FLAC
 * renderizzati da SFZ): oltre il range renderizzato la nota resta muta, invece di
 * passare a un campione GM con timbro/livello diversi (il "calo" al confine).
 */
const LOCAL_ONLY = new Set<string>(['double_bass_pizz', 'electric_bass_finger', 'electric_bass_pick']);

/** Handle for a sustained (note-on/note-off) monitored note. */
export interface SustainHandle {
  _released: boolean;
  _source: AudioBufferSourceNode | null;
  _gain: GainNode | null;
  /** Fade the note out over `releaseSec` and stop it. */
  release: (releaseSec?: number) => void;
}

export class AudioService {
  /**
   * DIAGNOSTICA DEL SINCRONISMO — quante note vengono consegnate in ritardo.
   *
   * Ogni nota viene programmata con un istante (`when`); se quando la si consegna quel
   * momento è già passato, Web Audio la fa partire SUBITO. Poche note in ritardo si
   * sentono come un'esecuzione che "zoppica". Qui si contano senza toccare l'audio.
   * In console: `window.__htAudioLate()` per il riepilogo, `window.__htAudioLate(true)`
   * per azzerare e ricominciare la misura.
   */
  private static lateStats = { total: 0, late: 0, sumLateMs: 0, maxLateMs: 0, firstLateAt: null as number | null, lastLateAt: null as number | null };
  public static recordLateness(lateMs: number, whenSec: number): void {
    const s = AudioService.lateStats;
    s.total++;
    if (lateMs > 1) {
      s.late++;
      s.sumLateMs += lateMs;
      if (lateMs > s.maxLateMs) s.maxLateMs = lateMs;
      if (s.firstLateAt == null) s.firstLateAt = whenSec;
      s.lastLateAt = whenSec;
    }
  }
  public static readLateness(reset = false) {
    const s = AudioService.lateStats;
    const out = {
      note_totali: s.total,
      note_in_ritardo: s.late,
      ritardo_medio_ms: s.late ? Math.round((s.sumLateMs / s.late) * 10) / 10 : 0,
      ritardo_massimo_ms: Math.round(s.maxLateMs * 10) / 10,
      primo_ritardo_a_sec: s.firstLateAt,
      ultimo_ritardo_a_sec: s.lastLateAt,
    };
    if (reset) AudioService.lateStats = { total: 0, late: 0, sumLateMs: 0, maxLateMs: 0, firstLateAt: null, lastLateAt: null };
    return out;
  }

  public audioContext: AudioContext | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  // Negative cache: keys (note / instrument::note / layered key) that failed to
  // load, so we don't re-fetch the same missing sample on every play (avoids a
  // storm of repeated 404s).
  private failedLoads: Set<string> = new Set();
  // Per-piece drum gain (mixer batteria): chiave = `${instrument}:${audioFile}` (es.
  // 'drums:C2'), valore = moltiplicatore lineare. Settato dal componente quando cambiano
  // i pieceVolumes della traccia; applicato in playNoteForInstrument così copre TUTTI i
  // percorsi di playback (schedulato, audition, palette). Strumenti non-batteria non sono
  // mai nella mappa → moltiplicatore 1.
  private drumPieceGains: Record<string, number> = {};
  public setDrumPieceGains(m: Record<string, number> | null | undefined): void {
    this.drumPieceGains = m || {};
  }
  private drumPieceGain(instrument: string, audioFile: string): number {
    const g = this.drumPieceGains[`${instrument}:${audioFile}`];
    return Number.isFinite(g) ? (g as number) : 1;
  }

  public async init(): Promise<void> {
    if (this.audioContext) return;

    return new Promise(async (resolve, reject) => {
        try {
            // `latencyHint` = quanto audio il motore tiene pronto in avanti. Senza
            // indicazione il browser sceglie 'interactive', cioè il buffer più PICCOLO
            // possibile (pochi millisecondi): ottimo per la reattività, ma basta un
            // singolo scatto del thread principale — e in questa app disegnare la
            // partitura mentre scorre ne produce — perché il motore audio non faccia in
            // tempo a riempire il buffer: il buco si sente come un raschio. Con ~50 ms di
            // margine il suono attraversa indenne gli scatti di lavoro grafico; sul clic
            // di ascolto di una nota il ritardo resta impercettibile.
            const AudioCtor = (window.AudioContext || (window as any).webkitAudioContext);
            try {
                this.audioContext = new AudioCtor({ latencyHint: 0.05 });
            } catch {
                this.audioContext = new AudioCtor();
            }
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
      rampDownTo(gainNode.gain, options?.volume ?? 1, noteEndTime, noteEndTime + releaseDurationInSeconds);

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
        rampDownTo(gainNode.gain, 1, noteEndTime, noteEndTime + releaseDurationInSeconds);

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
    // then fall back to remote CDN (mp3 only). Per gli strumenti LOCAL_ONLY (i bassi
    // custom) NIENTE fallback GM: oltre il range renderizzato la nota resta muta invece
    // di passare a un timbro/livello GM diverso (era il "calo" percepito al confine).
    const localUrl = `./sounds/${instrument}/${audioFile}.${instrumentExt(instrument)}`;
    const remoteUrl = `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/${instrument}-mp3/${audioFile}.mp3`;
    const urls = LOCAL_ONLY.has(instrument) ? [localUrl] : [localUrl, remoteUrl];

    for (const url of urls) {
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

  /** Carica SOLO il campione GM remoto (banco forzato), cache separata `gm::inst::nota`
   *  così non collide col buffer orchestrale locale dello stesso strumento/nota. */
  private async _loadGmFile(instrument: string, audioFile: string): Promise<void> {
    if (!this.audioContext) return;
    const key = `gm::${instrument}::${audioFile}`;
    if (this.audioBuffers.has(key) || this.failedLoads.has(key)) return;
    const url = `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/${instrument}-mp3/${audioFile}.mp3`;
    try {
      const response = await fetch(url);
      if (!response.ok) { this.failedLoads.add(key); return; }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength < 100) { this.failedLoads.add(key); return; }
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.audioBuffers.set(key, audioBuffer);
    } catch {
      this.failedLoads.add(key);
    }
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
  private async _getBufferFor(instrument: string, audioFile: string, velocity?: number, forceGm?: boolean): Promise<{ buffer: AudioBuffer | undefined; layered: boolean }> {
    if (forceGm) {
      const gkey = `gm::${instrument}::${audioFile}`;
      if (!this.audioBuffers.has(gkey)) await this._loadGmFile(instrument, audioFile);
      return { buffer: this.audioBuffers.get(gkey), layered: false };
    }
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

  public async playNoteForInstrument(instrument: string, audioFile: string, options?: { duration?: number, when?: number, volume?: number, output?: AudioNode, sustain?: boolean, velocity?: number, applyDrumPieceGain?: boolean, slotSec?: number, bank?: 'orchestral' | 'gm' }) {
    if (!this.audioContext) return;
    const forceGm = options?.bank === 'gm';
    const { buffer: audioBuffer, layered } = await this._getBufferFor(instrument, audioFile, options?.velocity, forceGm);
    if (!audioBuffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    // Sustained instruments: loop the body so a held note doesn't cut off when
    // the sample ends. Loop region = [loopStartSec .. end] (body after attack).
    // Banco GM: niente loop sostenuto (è il vecchio campione GM, decade naturale).
    const sus = forceGm ? undefined : SUSTAINED[instrument];
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
    if (options?.velocity != null && !layered && !ONESHOT_FLAC.has(instrument)) {
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
    // DIAGNOSTICA (costo ~zero): quante note arrivano al motore audio DOPO l'istante in
    // cui dovevano suonare. Web Audio, se l'istante è già passato, le fa partire SUBITO:
    // è così che un'esecuzione "zoppica". Riepilogo in console: window.__htAudioLate().
    AudioService.recordLateness((this.audioContext.currentTime - startTime) * 1000, startTime);
    const noteDurationInSeconds = options?.duration ?? audioBuffer.duration;
    // Coda di rilascio. Per gli strumenti SOSTENUTI (archi/fiati: corpo loopato, non
    // decadono) la coda fissa di 0.5s OLTRE la fine si accavalla con la nota successiva
    // della stessa linea → suona come "due esecutori" (bug violino/basso). Se lo scheduler
    // passa `slotSec` (tempo dall'attacco di questa nota al PROSSIMO attacco della stessa
    // voce/traccia) e la nota è SEQUENZIALE (il prossimo attacco arriva dopo la fine del
    // corpo), cappa la coda così corpo+coda finiscono entro lo slot. Se invece la nota si
    // sovrappone al prossimo attacco (accordo/pad tenuto, slotSec < durata) NON cappare:
    // è polifonia voluta. Gli strumenti che decadono (piano, pizz, mallet, batteria) non
    // sono SUSTAINED → coda naturale invariata.
    let releaseDurationInSeconds = instrumentRelease(instrument);
    if (!forceGm && SUSTAINED[instrument] && options?.slotSec != null) {
      const maxRelease = options.slotSec - noteDurationInSeconds;
      if (maxRelease >= 0) {
        // Minimo 0,12 s: sotto quella soglia il rilascio non è più una coda ma un taglio
        // (e a 0,05 s si sentiva come un clic). Una sovrapposizione così breve con la nota
        // dopo non si percepisce come "due esecutori", che era il difetto da evitare.
        releaseDurationInSeconds = Math.max(0.12, Math.min(releaseDurationInSeconds, maxRelease));
      }
    }
    const noteEndTime = startTime + noteDurationInSeconds;
    // applyDrumPieceGain:false → il per-pezzo è già gestito a valle da un nodo gain
    // persistente (playback batteria real-time); qui NON ri-applicarlo (evita il doppio).
    const vol = (options?.volume ?? 1) * instrumentGain(instrument) * (options?.applyDrumPieceGain === false ? 1 : this.drumPieceGain(instrument, audioFile));
    if (options?.sustain) {
      // Natural envelope: INSTANT attack (the sample starts from silence, so no
      // click — keeps the percussive transient and lets it scale with velocity),
      // HOLD at full until the note ends, then a release ring. Keeps notes (esp.
      // sustained soundfonts) full and even in level regardless of length — so a
      // short note isn't quieter than a long one (fixes the live-vs-recorded
      // loudness gap), and the held body matches the live monitor.
      gainNode.gain.setValueAtTime(vol, startTime);
      rampDownTo(gainNode.gain, vol, noteEndTime, noteEndTime + releaseDurationInSeconds);
    } else {
      // Anche gli strumenti che decadono da soli (pianoforte, pizzicati, percussioni)
      // TENGONO il livello per tutta la nota e si spengono solo dopo: al decadimento ci
      // pensa il campione. Prima la discesa partiva dall'attacco, e passando da lineare a
      // esponenziale è diventata una sordina — a metà nota il guadagno era già sceso di
      // 18 dB e il pianoforte si spegneva mentre stava ancora suonando, soprattutto sui
      // bassi, che vivono di coda.
      gainNode.gain.setValueAtTime(vol, startTime);
      rampDownTo(gainNode.gain, vol, noteEndTime, noteEndTime + releaseDurationInSeconds);
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
    options?: { volume?: number; output?: AudioNode; velocity?: number; applyDrumPieceGain?: boolean; bank?: 'orchestral' | 'gm' },
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
          rampDownTo(handle._gain.gain, handle._gain.gain.value, now, now + releaseSec);
        } catch { /* ignore */ }
        try { handle._source.stop(now + releaseSec + 0.05); } catch { /* ignore */ }
      },
    };

    void (async () => {
      if (!this.audioContext) return;
      const forceGm = options?.bank === 'gm';
      const { buffer: audioBuffer, layered } = await this._getBufferFor(instrument, audioFile, options?.velocity, forceGm);
      if (!audioBuffer || handle._released || !this.audioContext) return;

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      // Sustained instruments: loop the body so a long held key keeps ringing
      // (matches the played-back behaviour). Loop region = [loopStartSec .. end].
      const sus = forceGm ? undefined : SUSTAINED[instrument];
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
      if (options?.velocity != null && !layered && !ONESHOT_FLAC.has(instrument)) {
        filterNode = this.audioContext.createBiquadFilter();
        filterNode.type = 'lowpass';
        filterNode.frequency.value = velocityToCutoff(options.velocity);
        filterNode.Q.value = 0.7;
        filterNode.connect(gainNode);
        source.connect(filterNode);
      } else {
        source.connect(gainNode);
      }
      const vol = (options?.volume ?? 1) * (forceGm ? gmGain(instrument) : instrumentGain(instrument)) * (options?.applyDrumPieceGain === false ? 1 : this.drumPieceGain(instrument, audioFile));
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

  /**
   * Precarica ESATTAMENTE i campioni che serviranno, velocity compresa.
   *
   * Gli strumenti a strati di velocity (il pianoforte Salamander: 6 strati per nota)
   * risolvono il buffer come `{dir}/{nota}_v{strato}.mp3`, mentre `preloadNotesForInstrument`
   * carica solo il campione a strato singolo: lo strato giusto finiva quindi per essere
   * scaricato e decodificato DURANTE l'esecuzione, e la nota arrivava dopo il suo istante
   * programmato — l'esecuzione "zoppicava" al primo passaggio e si puliva dal secondo o
   * terzo in poi, quando ormai tutto era in cache.
   *
   * Si caricano le coppie (nota, strato) davvero usate: non il prodotto nota × strati.
   */
  public async preloadSamplesForInstrument(
    instrument: string,
    notes: Array<{ name: string; velocity?: number }>,
    forceGm?: boolean,
  ): Promise<void> {
    if (!this.audioContext) return;
    const names = [...new Set(notes.map(n => n.name))];
    if (forceGm) {
      // Banco GM: i buffer stanno sotto una chiave diversa (`gm::…`), quindi il
      // precaricamento "locale" non li coprirebbe.
      const missing = names.filter(f => !this.audioBuffers.has(`gm::${instrument}::${f}`) && !this.failedLoads.has(`gm::${instrument}::${f}`));
      if (missing.length > 0) await Promise.all(missing.map(f => this._loadGmFile(instrument, f)));
      return;
    }
    const cfg = VELOCITY_LAYERED[instrument];
    if (!cfg) return this.preloadNotesForInstrument(instrument, names);

    const wanted = new Map<string, { name: string; layer: number }>();
    for (const n of notes) {
      const layer = pickVelocityLayer(n.velocity, cfg.layers);
      const key = `${cfg.dir}::${n.name}::v${layer}`;
      if (this.audioBuffers.has(key) || this.failedLoads.has(key)) continue;
      wanted.set(key, { name: n.name, layer });
    }
    if (wanted.size > 0) {
      await Promise.all([...wanted.entries()].map(([key, w]) => this._loadLayeredSample(cfg.dir, w.name, w.layer, key)));
    }
    // Note il cui strato manca sul disco: al momento di suonare ripiegano sul campione
    // standard, che a questo punto va precaricato anche lui (altrimenti si torna al
    // caricamento in corsa proprio per quelle).
    const fellBack = names.filter(name =>
      notes.some(n => n.name === name
        && this.failedLoads.has(`${cfg.dir}::${name}::v${pickVelocityLayer(n.velocity, cfg.layers)}`)));
    if (fellBack.length > 0) await this.preloadNotesForInstrument(instrument, fellBack);
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