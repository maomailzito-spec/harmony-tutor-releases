/**
 * usePlayback — owns playback, metronome, BPM, and loop state.
 *
 * Step 1: pure state ownership, zero logic.
 * GrandStaffEditor destructures the return value.
 */
import { useState, useRef, useEffect } from 'react';

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
export function usePlayback() {
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

    // ── Sync effects ──
    useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
    useEffect(() => { loopRangeRef.current = loopRange; }, [loopRange]);
    useEffect(() => { isMetronomeOnRef.current = isMetronomeOn; }, [isMetronomeOn]);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { isBpmActiveRef.current = isBpmActive; }, [isBpmActive]);

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
    } as const;
}

export type PlaybackState = ReturnType<typeof usePlayback>;
