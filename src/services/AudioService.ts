
import { CHROMATIC_SCALE } from '../constants';

// Local bundled piano samples (FluidR3_GM acoustic_grand_piano).
// Falls back to the remote CDN only if the local file fails to load.
const SOUND_BASE_URL_LOCAL = './sounds/piano/';
const SOUND_BASE_URL_REMOTE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/';

export class AudioService {
  public audioContext: AudioContext | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private activeSources: Set<AudioBufferSourceNode> = new Set();

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
    if (this.audioBuffers.has(audioFile)) return;

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
    // Both sources failed — silently skip this note.
  }

  private async loadInitialSounds(): Promise<void> {
    const soundPromises = CHROMATIC_SCALE.map(note => this.loadAudioFile(note.audioFile));
    await Promise.all(soundPromises);
  }

  public async playNote(audioFile: string, options?: { duration?: number, when?: number }) {
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

      gainNode.gain.setValueAtTime(1, startTime);
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
    if (this.audioBuffers.has(key)) return;

    // Try local bundled file first, then fall back to remote CDN.
    const localUrl = `./sounds/${instrument}/${audioFile}.mp3`;
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
    // Both sources failed — silently skip this note.
  }

  public async playNoteForInstrument(instrument: string, audioFile: string, options?: { duration?: number, when?: number, volume?: number, output?: AudioNode }) {
    if (!this.audioContext) return;
    // For piano use existing (possibly local) buffer; for others use instrument::key
    const key = instrument === 'acoustic_grand_piano' ? audioFile : `${instrument}::${audioFile}`;
    if (!this.audioBuffers.has(key)) {
      if (instrument === 'acoustic_grand_piano') {
        await this.loadAudioFile(audioFile);
      } else {
        await this._loadInstrumentFile(instrument, audioFile);
      }
    }
    const audioBuffer = this.audioBuffers.get(key);
    if (!audioBuffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    const gainNode = this.audioContext.createGain();
    // If a custom output node is provided (e.g. per-track gain), route through it
    // so the user can mute/change volume in real-time by modulating that node.
    gainNode.connect(options?.output ?? this.audioContext.destination);
    source.connect(gainNode);
    const startTime = options?.when ?? this.audioContext.currentTime;
    const noteDurationInSeconds = options?.duration ?? audioBuffer.duration;
    const releaseDurationInSeconds = 0.5;
    const noteEndTime = startTime + noteDurationInSeconds;
    gainNode.gain.setValueAtTime(options?.volume ?? 1, startTime);
    gainNode.gain.linearRampToValueAtTime(0.0001, noteEndTime + releaseDurationInSeconds);
    source.start(startTime);
    source.stop(noteEndTime + releaseDurationInSeconds);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try { gainNode.disconnect(); source.disconnect(); } catch (e) {}
    };
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