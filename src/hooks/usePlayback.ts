/**
 * usePlayback — owns playback, metronome, BPM, and loop state.
 *
 * Step 1: pure state ownership, zero logic.
 * GrandStaffEditor destructures the return value.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

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
}

export function usePlayback({ bpmInputRef }: UsePlaybackParams) {
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

    return {
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
    } as const;
}

export type PlaybackState = ReturnType<typeof usePlayback>;
