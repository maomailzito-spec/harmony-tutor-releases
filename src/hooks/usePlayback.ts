/**
 * usePlayback — owns playback, metronome, BPM, and loop state.
 *
 * Step 1: pure state ownership, zero logic.
 * GrandStaffEditor destructures the return value.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { TimeSignature, TimeSignatureChange } from '../types';
import type { AudioService } from '../services/AudioService';

/* ── Types ── */
export type MetronomeUnit = 'quarter' | 'eighth' | 'dotted-quarter';

export interface PlayheadPosition {
    x: number;
    systemIndex: number;
}

export interface LoopRange {
    startBeat: number;
    endBeat: number;
}

/* ── Hook ── */
export interface UsePlaybackParams {
    /** DOM ref allo <input> BPM — per focus/blur/select. */
    bpmInputRef: React.RefObject<HTMLInputElement | null>;
    /** Audio service singleton (from props). */
    audioService: AudioService;
    /** Whether the audio context is ready. */
    isAudioReady: boolean;
    /** Current time signature. */
    timeSignature: TimeSignature;
    /** Time signature changes list. */
    timeSignatureChanges: TimeSignatureChange[];
    /** Ref to the animation frame ID (owned by GSE for cancelAnimationFrame). */
    animationFrameRef: React.MutableRefObject<number | null>;
}

export function usePlayback({ bpmInputRef, audioService, isAudioReady, timeSignature, timeSignatureChanges, animationFrameRef }: UsePlaybackParams) {
    // ── Swing ──
    const [isSwing, setIsSwing] = useState(false);

    // ── MIDI ──
    const [midiOutputs, setMidiOutputs] = useState<any[]>([]);
    const [selectedMidiOutput, setSelectedMidiOutput] = useState<any | null>(null);
    const [isMidiMenuOpen, setIsMidiMenuOpen] = useState(false);

    const handleActivateMidi = useCallback(async () => {
        if (navigator.requestMIDIAccess) {
            try {
                const midiAccess = await navigator.requestMIDIAccess();
                const outputs = Array.from(midiAccess.outputs.values());
                setMidiOutputs(outputs);
                if (outputs.length > 0 && !selectedMidiOutput) {
                    setSelectedMidiOutput(outputs[0]);
                }
            } catch { /* MIDI not available */ }
        }
    }, [selectedMidiOutput]);

    // ── Playback core ──
    const [isPlaying, setIsPlaying] = useState(false);
    const [bpm, setBpm] = useState(120);
    const [isBpmActive, setIsBpmActive] = useState(false);
    const isBpmActiveRef = useRef(isBpmActive);

    const [playingNoteIds, setPlayingNoteIds] = useState<string[]>([]);
    const [playheadPosition, setPlayheadPosition] = useState<PlayheadPosition | null>(null);

    const playbackCursorAbsBeatRef = useRef<number | null>(null);
    const playbackTimeoutsRef = useRef<number[]>([]);
    const playbackStartBeatRef = useRef<number>(0);
    const audioPlaybackStartTimeRef = useRef<number>(0);

    // ── Metronome ──
    const [isMetronomeOn, setIsMetronomeOn] = useState(false);
    const [metronomeUnit, setMetronomeUnit] = useState<MetronomeUnit>('quarter');
    const [metronomeFlash, setMetronomeFlash] = useState<'strong' | 'weak' | null>(null);

    const metronomeIntervalRef = useRef<number | null>(null);
    const metronomeBeatRef = useRef(0);
    const metronomeNextWhenRef = useRef<number>(0);
    const metronomeSuppressedRef = useRef(false);
    const metronomeLinkedToPlaybackRef = useRef(false);
    const isMetronomeOnRef = useRef(isMetronomeOn);
    const isPlayingRef = useRef(isPlaying);

    // ── Loop ──
    const [isLooping, setIsLooping] = useState(false);
    const [loopRange, setLoopRange] = useState<LoopRange | null>(null);
    const isLoopingRef = useRef(isLooping);
    const loopRangeRef = useRef(loopRange);

    // ── BPM input widget ──
    const [bpmInputString, setBpmInputString] = useState('');

    // ── Metronome flash timeout refs ──
    const metronomeFlashStartTimeoutRef = useRef<number | null>(null);
    const metronomeFlashTimeoutRef = useRef<number | null>(null);

    // ── Sync effects ──
    useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
    useEffect(() => { loopRangeRef.current = loopRange; }, [loopRange]);
    useEffect(() => { isMetronomeOnRef.current = isMetronomeOn; }, [isMetronomeOn]);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { isBpmActiveRef.current = isBpmActive; }, [isBpmActive]);

    // ── stopMetronomeInternal ──
    const stopMetronomeInternal = useCallback(() => {
        if (metronomeIntervalRef.current) {
            window.clearTimeout(metronomeIntervalRef.current);
            metronomeIntervalRef.current = null;
        }
        if (metronomeFlashStartTimeoutRef.current) {
            window.clearTimeout(metronomeFlashStartTimeoutRef.current);
            metronomeFlashStartTimeoutRef.current = null;
        }
        if (metronomeFlashTimeoutRef.current) {
            window.clearTimeout(metronomeFlashTimeoutRef.current);
            metronomeFlashTimeoutRef.current = null;
        }
        setMetronomeFlash(null);
    }, []);

    // ── BPM commit helper ──
    const commitBpmFromString = useCallback((value: string) => {
        const trimmed = (value ?? '').trim();
        if (!trimmed) return;
        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed)) return;
        const clamped = Math.max(20, Math.min(300, parsed));
        setBpm(clamped);
        setBpmInputString(String(clamped));
    }, []);

    // ── activateBpmEdit ──
    const activateBpmEdit = useCallback(() => {
        isBpmActiveRef.current = true;
        setIsBpmActive(true);
        setBpmInputString(String(bpm));
        window.requestAnimationFrame(() => {
            bpmInputRef.current?.focus();
            bpmInputRef.current?.select();
        });
    }, [bpm, bpmInputRef]);

    // ── BPM handlers ──
    const handleBpmFocus = useCallback(() => {
        isBpmActiveRef.current = true;
        setIsBpmActive(true);
        setBpmInputString(prev => (prev ? prev : String(bpm)));
    }, [bpm]);

    const handleBpmKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation();
        const key = e.key;

        const applyDelta = (delta: number) => {
            const base = Number.parseInt((bpmInputString || String(bpm)).trim(), 10);
            const current = Number.isFinite(base) ? base : bpm;
            const next = Math.max(20, Math.min(300, current + delta));
            setBpm(next);
            setBpmInputString(String(next));
        };

        if (key === 'ArrowUp') { e.preventDefault(); applyDelta(e.shiftKey ? 10 : 1); return; }
        if (key === 'ArrowDown') { e.preventDefault(); applyDelta(e.shiftKey ? -10 : -1); return; }
        if (key === 'Enter') { e.preventDefault(); commitBpmFromString(bpmInputString || String(bpm)); setIsBpmActive(false); return; }
        if (key === 'Escape') { e.preventDefault(); setBpmInputString(String(bpm)); setIsBpmActive(false); return; }
        if (key === 'Backspace') { e.preventDefault(); setBpmInputString(s => (s ? s.slice(0, -1) : '')); return; }
        if (key === 'Delete') { e.preventDefault(); setBpmInputString(''); return; }
        if (/^[0-9]$/.test(key)) {
            e.preventDefault();
            setBpmInputString(s => {
                const next = `${(s ?? '').replace(/\s+/g, '')}${key}`;
                return next.slice(0, 3);
            });
            return;
        }
    }, [bpm, bpmInputString, commitBpmFromString]);

    const handleBpmInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const onlyDigits = (e.target.value ?? '').replace(/\D+/g, '').slice(0, 3);
        setBpmInputString(onlyDigits);
    }, []);

    const handleBpmInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        const applyDelta = (delta: number) => {
            const base = Number.parseInt((bpmInputString || String(bpm)).trim(), 10);
            const current = Number.isFinite(base) ? base : bpm;
            const next = Math.max(20, Math.min(300, current + delta));
            setBpm(next);
            setBpmInputString(String(next));
        };
        if (e.key === 'ArrowUp') { e.preventDefault(); applyDelta(e.shiftKey ? 10 : 1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); applyDelta(e.shiftKey ? -10 : -1); return; }
        if (e.key === 'Enter') { e.preventDefault(); commitBpmFromString(bpmInputString || String(bpm)); bpmInputRef.current?.blur(); return; }
        if (e.key === 'Escape') { e.preventDefault(); setBpmInputString(String(bpm)); bpmInputRef.current?.blur(); return; }
    }, [bpm, bpmInputString, bpmInputRef, commitBpmFromString]);

    const handleBpmBlur = useCallback(() => {
        isBpmActiveRef.current = false;
        commitBpmFromString(bpmInputString || String(bpm));
        setIsBpmActive(false);
    }, [bpm, bpmInputString, commitBpmFromString]);

    // ── toggleMetronome ──
    const toggleMetronome = useCallback(() => {
        setIsMetronomeOn(prev => {
            const next = !prev;
            if (!next) {
                metronomeSuppressedRef.current = false;
                metronomeLinkedToPlaybackRef.current = false;
            } else {
                metronomeSuppressedRef.current = false;
            }
            return next;
        });
    }, []);

    // ── startMetronomeScheduler ──
    const startMetronomeScheduler = useCallback(async (opts?: { anchorWhenSec?: number; anchorAbsBeat?: number }) => {
        if (!isMetronomeOnRef.current) return;

        stopMetronomeInternal();

        const safeBpm = Math.max(20, Math.min(300, bpm || 120));
        const getTimeSignatureAtAbsBeatLocal = (absBeat: number): TimeSignature => {
            const baseBeats = timeSignature.numerator * (4 / timeSignature.denominator);
            const toAbsBeat = (c: any) => {
                const ab = Number(c?.absBeat);
                if (Number.isFinite(ab)) return ab;
                const m = Number(c?.measureIndex) || 0;
                return m * Math.max(1, baseBeats || 4);
            };
            const sorted = (timeSignatureChanges || []).slice().sort((a, b) => toAbsBeat(a) - toAbsBeat(b));
            let active: TimeSignature = timeSignature;
            for (const c of sorted) {
                const at = toAbsBeat(c);
                if (Number.isFinite(at) && at <= absBeat + 1e-6) {
                    if (Number.isFinite(c.numerator) && Number.isFinite(c.denominator) && c.numerator > 0 && c.denominator > 0) {
                        active = { numerator: c.numerator, denominator: c.denominator };
                    }
                } else {
                    break;
                }
            }
            return active;
        };
        const beatDurationSec = 60 / safeBpm;
        const unitBeats = metronomeUnit === 'eighth' ? 0.5 : (metronomeUnit === 'dotted-quarter' ? 1.5 : 1);
        const unitDurationSec = beatDurationSec * unitBeats;

        if (isAudioReady) {
            await audioService.ensureAudioIsReady();
        }

        const audioCtx = audioService.audioContext;
        if (!audioCtx) return;

        const nowSec = audioCtx.currentTime;
        const anchorWhenSec = (opts?.anchorWhenSec ?? nowSec);
        const anchorAbsBeat = (opts?.anchorAbsBeat ?? 0);

        const unitsSinceAnchor = Math.max(0, Math.ceil((nowSec - anchorWhenSec) / Math.max(1e-9, unitDurationSec)));
        metronomeBeatRef.current = Math.round((anchorAbsBeat + unitsSinceAnchor * unitBeats) * 1e6) / 1e6;
        metronomeNextWhenRef.current = anchorWhenSec + unitsSinceAnchor * unitDurationSec;

        const isDownbeat = (absBeat: number) => {
            if (!Number.isFinite(absBeat)) return false;
            const ts = getTimeSignatureAtAbsBeatLocal(absBeat);
            const beatsPerMeasureRaw = (ts?.numerator ?? 4) * (4 / (ts?.denominator ?? 4));
            const beatsPerMeasure = Math.max(1, Number.isFinite(beatsPerMeasureRaw) ? beatsPerMeasureRaw : 4);
            const mod = ((absBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
            return (mod < 1e-6) || (Math.abs(beatsPerMeasure - mod) < 1e-6);
        };

        const scheduleNext = () => {
            if (!isMetronomeOnRef.current) return;
            const ctx = audioService.audioContext;
            if (!ctx) return;

            const absBeat = metronomeBeatRef.current;
            const when = metronomeNextWhenRef.current;
            const strong = isDownbeat(absBeat);

            void audioService.playClick(strong, when);

            const flashDelayMs = Math.max(0, (when - ctx.currentTime) * 1000);
            if (metronomeFlashStartTimeoutRef.current) window.clearTimeout(metronomeFlashStartTimeoutRef.current);
            metronomeFlashStartTimeoutRef.current = window.setTimeout(() => {
                setMetronomeFlash(strong ? 'strong' : 'weak');
                if (metronomeFlashTimeoutRef.current) window.clearTimeout(metronomeFlashTimeoutRef.current);
                metronomeFlashTimeoutRef.current = window.setTimeout(() => {
                    setMetronomeFlash(null);
                }, 90);
            }, flashDelayMs);

            metronomeBeatRef.current = Math.round((absBeat + unitBeats) * 1e6) / 1e6;
            metronomeNextWhenRef.current = when + unitDurationSec;

            const nextDelayMs = Math.max(0, (metronomeNextWhenRef.current - ctx.currentTime - 0.03) * 1000);
            metronomeIntervalRef.current = window.setTimeout(scheduleNext, nextDelayMs);
        };

        const firstDelayMs = Math.max(0, (metronomeNextWhenRef.current - nowSec - 0.03) * 1000);
        metronomeIntervalRef.current = window.setTimeout(scheduleNext, firstDelayMs);
    }, [audioService, bpm, isAudioReady, metronomeUnit, stopMetronomeInternal, timeSignature, timeSignatureChanges]);

    // ── Metronome toggle effect ──
    useEffect(() => {
        if (!isMetronomeOn) {
            metronomeSuppressedRef.current = false;
            metronomeLinkedToPlaybackRef.current = false;
            stopMetronomeInternal();
            return;
        }

        if (metronomeSuppressedRef.current) {
            stopMetronomeInternal();
            return;
        }

        if (isPlayingRef.current && audioPlaybackStartTimeRef.current > 0) {
            metronomeLinkedToPlaybackRef.current = true;
            void startMetronomeScheduler({
                anchorWhenSec: audioPlaybackStartTimeRef.current,
                anchorAbsBeat: playbackStartBeatRef.current,
            });
            return;
        }

        metronomeLinkedToPlaybackRef.current = false;
        void startMetronomeScheduler({ anchorWhenSec: audioService.audioContext?.currentTime, anchorAbsBeat: 0 });

        return () => {
            stopMetronomeInternal();
        };
    }, [audioService, isMetronomeOn, startMetronomeScheduler, stopMetronomeInternal]);

    // ── stopPlayback ──
    const stopPlayback = useCallback(() => {
        playbackTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
        playbackTimeoutsRef.current = [];
        if (animationFrameRef.current) {
            window.cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        audioService.stopAllSounds?.();
        setPlayingNoteIds([]);
        setIsPlaying(false);

        if (metronomeLinkedToPlaybackRef.current) {
            metronomeLinkedToPlaybackRef.current = false;
            metronomeSuppressedRef.current = true;
            stopMetronomeInternal();
        }
    }, [audioService, animationFrameRef, stopMetronomeInternal]);

    return {
        // swing
        isSwing, setIsSwing,
        // MIDI
        midiOutputs, setMidiOutputs,
        selectedMidiOutput, setSelectedMidiOutput,
        isMidiMenuOpen, setIsMidiMenuOpen,
        handleActivateMidi,
        // playback core
        isPlaying, setIsPlaying,
        bpm, setBpm,
        isBpmActive, setIsBpmActive, isBpmActiveRef,
        playingNoteIds, setPlayingNoteIds,
        playheadPosition, setPlayheadPosition,
        playbackCursorAbsBeatRef,
        playbackTimeoutsRef,
        playbackStartBeatRef,
        audioPlaybackStartTimeRef,
        // metronome
        isMetronomeOn, setIsMetronomeOn,
        metronomeUnit, setMetronomeUnit,
        metronomeFlash, setMetronomeFlash,
        metronomeIntervalRef,
        metronomeBeatRef,
        metronomeNextWhenRef,
        metronomeSuppressedRef,
        metronomeLinkedToPlaybackRef,
        isMetronomeOnRef,
        isPlayingRef,
        // loop
        isLooping, setIsLooping,
        loopRange, setLoopRange,
        isLoopingRef,
        loopRangeRef,
        // BPM input
        bpmInputString, setBpmInputString,
        // metronome flash refs
        metronomeFlashStartTimeoutRef,
        metronomeFlashTimeoutRef,
        // logic
        stopMetronomeInternal,
        commitBpmFromString,
        activateBpmEdit,
        handleBpmFocus,
        handleBpmKeyDown,
        handleBpmInputChange,
        handleBpmInputKeyDown,
        handleBpmBlur,
        toggleMetronome,
        startMetronomeScheduler,
        stopPlayback,
    } as const;
}

export type PlaybackState = ReturnType<typeof usePlayback>;
