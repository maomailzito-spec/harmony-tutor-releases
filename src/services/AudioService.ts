
import { CHROMATIC_SCALE } from '../constants';

const SOUND_BASE_URL = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/';

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
            console.error("Error initializing AudioContext:", error);
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
              console.error("Could not resume audio context:", e);
          }
      }
  }

  private async loadAudioFile(audioFile: string): Promise<void> {
    if (!this.audioContext) throw new Error('AudioContext not initialized.');
    if (this.audioBuffers.has(audioFile)) return;

    try {
      const response = await fetch(`${SOUND_BASE_URL}${audioFile}.mp3`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.audioBuffers.set(audioFile, audioBuffer);
    } catch (error) {
      console.error(`Failed to load sound for ${audioFile}:`, error);
    }
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