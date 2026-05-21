import { useState, useRef, useCallback, useEffect } from 'react';
import type { AudioService } from '../services/AudioService';

export interface RawRecordedEvent {
  midiNote: number;
  velocity: number;
  /** Secondi dall'inizio della registrazione effettiva (DOPO il count-in). */
  timestampSec: number;
  durationSec: number;
}

export interface UseRealtimeRecordingProps {
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  audioService: AudioService;
  /** Callback per riprodurre una nota MIDI durante la registrazione (passthrough). */
  onNotePreview?: (midiNote: number, durationSec: number) => void;
}

export interface UseRealtimeRecordingReturn {
  isRecording: boolean;
  isCountingIn: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => RawRecordedEvent[];
  recordingDurationBeats: number;
  /** Beats trascorsi dall'inizio della registrazione effettiva (post count-in). Negativo durante il count-in. */
  getElapsedBeats: () => number;
}

function scheduleClick(audioContext: AudioContext, when: number, isStrong: boolean): void {
  try {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.value = isStrong ? 1000 : 700;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.4, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    osc.start(when);
    osc.stop(when + 0.07);
  } catch { /* ignore */ }
}

export function useRealtimeRecording({
  bpm,
  timeSignature,
  audioService,
  onNotePreview,
}: UseRealtimeRecordingProps): UseRealtimeRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [recordingDurationBeats, setRecordingDurationBeats] = useState(0);

  const eventsRef = useRef<RawRecordedEvent[]>([]);
  const activeNotesRef = useRef<Map<number, { timestampSec: number; velocity: number }>>(new Map());
  const countInEndTimeSec = useRef<number>(0);
  const recordingStartSec = useRef<number>(0);       // inizio count-in
  const listenerCleanupRef = useRef<(() => void) | null>(null);
  const countInTimeoutRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const metroIntervalRef = useRef<number | null>(null);    // lookahead scheduler
  const nextBeatTimeRef = useRef<number>(0);              // prossimo beat da schedulare
  const beatIndexRef = useRef<number>(0);                 // indice beat globale (0 = beat 1 misura 1)

  const bpmRef = useRef(bpm);
  const timeSignatureRef = useRef(timeSignature);
  const onNotePreviewRef = useRef(onNotePreview);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { timeSignatureRef.current = timeSignature; }, [timeSignature]);
  useEffect(() => { onNotePreviewRef.current = onNotePreview; }, [onNotePreview]);

  /** Lookahead scheduler: chiama scheduleClick su tutti i beat dentro i prossimi LOOKAHEAD secondi. */
  const runMetroScheduler = useCallback(() => {
    const ac = audioService.audioContext;
    if (!ac) return;
    const secPerBeat = 60 / bpmRef.current;
    const LOOKAHEAD = 0.5; // secondi avanti da schedulare
    while (nextBeatTimeRef.current < ac.currentTime + LOOKAHEAD) {
      const beatIdx = beatIndexRef.current;
      const ts = timeSignatureRef.current;
      const isStrong = (beatIdx % ts.numerator) === 0;
      scheduleClick(ac, nextBeatTimeRef.current, isStrong);
      nextBeatTimeRef.current += secPerBeat;
      beatIndexRef.current += 1;
    }
  }, [audioService]);

  const stopRecording = useCallback((): RawRecordedEvent[] => {
    const audioContext = audioService.audioContext;
    if (audioContext) {
      const now = audioContext.currentTime;
      for (const [note, active] of activeNotesRef.current.entries()) {
        if (now > countInEndTimeSec.current) {
          eventsRef.current.push({
            midiNote: note,
            velocity: active.velocity,
            timestampSec: Math.max(0, active.timestampSec - countInEndTimeSec.current),
            durationSec: Math.max(0.05, now - active.timestampSec),
          });
        }
      }
    }
    activeNotesRef.current.clear();

    if (listenerCleanupRef.current) { listenerCleanupRef.current(); listenerCleanupRef.current = null; }
    if (countInTimeoutRef.current !== null) { window.clearTimeout(countInTimeoutRef.current); countInTimeoutRef.current = null; }
    if (durationIntervalRef.current !== null) { window.clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
    if (metroIntervalRef.current !== null) { window.clearInterval(metroIntervalRef.current); metroIntervalRef.current = null; }

    setIsRecording(false);
    setIsCountingIn(false);
    setRecordingDurationBeats(0);
    return eventsRef.current.slice();
  }, [audioService]);

  const startRecording = useCallback(async (): Promise<void> => {
    // 1. Richiedi MIDI access PRIMA di tutto, per avere il listener pronto immediatamente
    let midiAccess: MIDIAccess | null = null;
    try {
      if (typeof navigator.requestMIDIAccess === 'function') {
        midiAccess = await navigator.requestMIDIAccess();
      }
    } catch { /* MIDI non disponibile */ }

    // 2. Inizializza AudioContext
    await audioService.ensureAudioIsReady();
    const audioContext = audioService.audioContext;
    if (!audioContext) return;

    eventsRef.current = [];
    activeNotesRef.current.clear();
    setRecordingDurationBeats(0);

    const ts = timeSignatureRef.current;
    const currentBpm = bpmRef.current;
    const secPerBeat = 60 / currentBpm;
    const countInDurationSec = secPerBeat * ts.numerator;
    const nowSec = audioContext.currentTime;

    recordingStartSec.current = nowSec;
    countInEndTimeSec.current = nowSec + countInDurationSec;

    // 3. Avvia il lookahead scheduler metronomo
    if (metroIntervalRef.current !== null) window.clearInterval(metroIntervalRef.current);
    nextBeatTimeRef.current = nowSec;
    beatIndexRef.current = 0;
    runMetroScheduler();
    metroIntervalRef.current = window.setInterval(runMetroScheduler, 100);

    // 4. Registra listener MIDI
    if (midiAccess) {
      const handleRecMessage = (e: Event) => {
        const ac = audioService.audioContext;
        if (!ac) return;
        const msg = e as MIDIMessageEvent;
        const data = msg.data;
        if (!data || data.length < 3) return;
        const [status, note, velocity] = data;
        const now = ac.currentTime;
        const GRACE_SEC = 0.25; // 250ms di grazia: note suonate leggermente prima del beat vengono accettate
        const isDuringRec = now >= (countInEndTimeSec.current - GRACE_SEC);

        if ((status & 0xf0) === 0x90 && velocity > 0) {
          // Passthrough audio: suona sempre (count-in + registrazione)
          onNotePreviewRef.current?.(note, 0.6);

          if (isDuringRec) {
            // Usa max(now, countInEndTimeSec) per evitare timestampSec negativo
            const noteOnTime = Math.max(now, countInEndTimeSec.current);
            activeNotesRef.current.set(note, { timestampSec: noteOnTime, velocity });
          }
        } else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0)) {
          if (isDuringRec) {
            const active = activeNotesRef.current.get(note);
            if (active) {
              eventsRef.current.push({
                midiNote: note,
                velocity: active.velocity,
                timestampSec: active.timestampSec - countInEndTimeSec.current,
                durationSec: Math.max(0.05, now - active.timestampSec),
              });
              activeNotesRef.current.delete(note);
            }
          }
        }
      };

      const inputs: MIDIInput[] = [];
      midiAccess.inputs.forEach(input => {
        input.addEventListener('midimessage', handleRecMessage as EventListener);
        inputs.push(input);
      });
      listenerCleanupRef.current = () => {
        inputs.forEach(input => input.removeEventListener('midimessage', handleRecMessage as EventListener));
      };
    }

    setIsCountingIn(true);
    setIsRecording(true);

    countInTimeoutRef.current = window.setTimeout(() => {
      setIsCountingIn(false);
      countInTimeoutRef.current = null;
    }, countInDurationSec * 1000);

    durationIntervalRef.current = window.setInterval(() => {
      const ac = audioService.audioContext;
      if (ac) {
        const elapsed = ac.currentTime - countInEndTimeSec.current;
        if (elapsed > 0) setRecordingDurationBeats(elapsed * bpmRef.current / 60);
      }
    }, 100);
  }, [audioService, runMetroScheduler]);

  useEffect(() => {
    return () => {
      if (listenerCleanupRef.current) listenerCleanupRef.current();
      if (countInTimeoutRef.current !== null) window.clearTimeout(countInTimeoutRef.current);
      if (durationIntervalRef.current !== null) window.clearInterval(durationIntervalRef.current);
      if (metroIntervalRef.current !== null) window.clearInterval(metroIntervalRef.current);
    };
  }, []);

  const getElapsedBeats = useCallback((): number => {
    const ac = audioService.audioContext;
    if (!ac) return 0;
    return (ac.currentTime - countInEndTimeSec.current) * bpmRef.current / 60;
  }, [audioService]);

  return { isRecording, isCountingIn, startRecording, stopRecording, recordingDurationBeats, getElapsedBeats };
}
