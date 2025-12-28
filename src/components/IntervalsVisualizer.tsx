import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AudioService } from '../services/AudioService';
import { EnharmonicPreference, DisplayNote, StaffNote, KeySignature, Interval, PlacedInterval } from '../types';
import { CHROMATIC_SCALE, GUITAR_TUNING, INTERVALS } from '../constants';
import { IntervalControls } from './IntervalControls';
import { IntervalFretboard } from './IntervalFretboard';
import Staff from './Staff';
import { getDyadAsStaffNotes } from '../utils/musicTheory';
import { useUndoableState } from '../hooks/useUndoableState';

const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40]; // High E to Low E
const DISPLAY_FRET_COUNT = 15;

const findAllNotePositions = (noteIndex: number): { s: number, f: number }[] => {
    const positions: { s: number, f: number }[] = [];
    for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= DISPLAY_FRET_COUNT; f++) {
            const currentNoteIndex = (GUITAR_TUNING[s] + f) % 12;
            if (currentNoteIndex === noteIndex) {
                positions.push({ s, f });
            }
        }
    }
    return positions;
};


const findClosestNextNote = (
    rootNote: { s: number; f: number; midi: number },
    targetNoteIndex: number,
    direction: 'ascending' | 'descending',
    semitones: number
): { s: number; f: number } | null => {

    const targetMidi = direction === 'ascending'
        ? rootNote.midi + semitones
        : rootNote.midi - semitones;

    const candidates: { s: number; f: number; midi: number }[] = [];

    // Find all possible locations for the target note up to DISPLAY_FRET_COUNT
    for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= DISPLAY_FRET_COUNT; f++) {
            const currentNoteIndex = (GUITAR_TUNING[s] + f) % 12;
            if (currentNoteIndex === targetNoteIndex) {
                candidates.push({ s, f, midi: STRING_BASE_MIDI[s] + f });
            }
        }
    }

    if (candidates.length === 0) {
        return null;
    }

    // Sort candidates to find the best match
    candidates.sort((a, b) => {
        // 1. Primary sort: smallest MIDI distance from the ideal target pitch (ensures correct octave)
        const midiDistA = Math.abs(a.midi - targetMidi);
        const midiDistB = Math.abs(b.midi - targetMidi);
        if (midiDistA !== midiDistB) {
            return midiDistA - midiDistB;
        }

        // 2. Tie-breaker: prefer fretted notes over open strings
        const aIsFretted = a.f > 0;
        const bIsFretted = b.f > 0;
        if (aIsFretted !== bIsFretted) {
            return bIsFretted ? -1 : 1; 
        }

        // 3. Tie-breaker: Fret distance from root
        const fretDistA = Math.abs(a.f - rootNote.f);
        const fretDistB = Math.abs(b.f - rootNote.f);
        if (fretDistA !== fretDistB) {
            return fretDistA - fretDistB;
        }

        // 4. Tie-breaker: String distance from root
        const stringDistA = Math.abs(a.s - rootNote.s);
        const stringDistB = Math.abs(b.s - rootNote.s);
        if (stringDistA !== stringDistB) {
            return stringDistA - stringDistB;
        }

        // 5. Final tie-breaker: prefer higher strings (lower string index)
        return a.s - b.s;
    });

    return candidates[0]; // The best candidate is the first one after sorting
};


interface IntervalsVisualizerProps {
    audioService: AudioService;
    isAudioReady: boolean;
    isActive: boolean;
}

const IntervalsVisualizer: React.FC<IntervalsVisualizerProps> = ({ audioService, isAudioReady, isActive }) => {
    const [placedIntervals, setPlacedIntervals, undoPlacedIntervals] = useUndoableState<PlacedInterval[]>([]);
    const [pendingRoot, setPendingRoot] = useState<{ s: number, f: number, noteIndex: number, midi: number } | null>(null);
    const [activeIntervalId, setActiveIntervalId] = useState<string | null>(null);

    const [enharmonicPreference, setEnharmonicPreference] = useState<EnharmonicPreference>('sharp');
    const [intervalDirection, setIntervalDirection] = useState<'ascending' | 'descending'>('ascending');

    // --- STAFF & GLOW STATE ---
    const [keySignature, setKeySignature] = useState<KeySignature>({ type: 'sharp', count: 0 }); // Neutral key signature
    const [glowingMidis, setGlowingMidis] = useState<number[] | null>(null);
    const glowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const staffContainerRef = useRef<HTMLDivElement>(null);
    const [staffWidth, setStaffWidth] = useState(1000);

    useEffect(() => {
        if (!isActive) return;
        const container = staffContainerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(entries => {
            if (entries[0]) {
                const width = entries[0].contentRect.width;
                if (width > 0) {
                    setStaffWidth(width);
                }
            }
        });
        
        observer.observe(container);
        
        const initialWidth = container.getBoundingClientRect().width;
        if (initialWidth > 0) {
            setStaffWidth(initialWidth);
        }

        return () => observer.disconnect();
    }, [isActive]);

    const allNotes = useMemo((): DisplayNote[] => {
        return CHROMATIC_SCALE.map((note, index) => {
            const isEnharmonic = note.sharp !== note.flat;
            const name = enharmonicPreference === 'sharp' ? note.sharp : note.flat;
            return { ...note, name, isEnharmonic, originalIndex: index };
        });
    }, [enharmonicPreference]);
    
    const triggerGlow = useCallback((midis: number[]) => {
        if (glowTimeoutRef.current) clearTimeout(glowTimeoutRef.current);
        setGlowingMidis(midis);
        glowTimeoutRef.current = setTimeout(() => setGlowingMidis(null), 1500);
    }, []);

    const playIntervalSound = useCallback(async (rootMidi: number, targetMidi: number) => {
        if (!isAudioReady) return;
        
        await audioService.ensureAudioIsReady();

        const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        
        const playNoteByMidi = async (midiNote: number) => {
            if (midiNote < 21 || midiNote > 108) return; // Standard piano range
            const noteName = noteNamesWithFlats[midiNote % 12];
            const octave = Math.floor(midiNote / 12) - 1;
            const audioFile = `${noteName}${octave}`;
            await audioService.playNote(audioFile, { duration: 1.5 });
        };
        
        await playNoteByMidi(rootMidi);
        await new Promise(resolve => setTimeout(resolve, 200));
        await playNoteByMidi(targetMidi);

        triggerGlow([rootMidi, targetMidi]);

    }, [isAudioReady, audioService, triggerGlow]);

    const handleFretboardInteraction = useCallback(async (s: number, f: number) => {
        const existingInterval = placedIntervals.find(iv =>
            (iv.rootNote.s === s && iv.rootNote.f === f) ||
            (iv.targetNote.s === s && iv.targetNote.f === f)
        );

        if (existingInterval) {
            setActiveIntervalId(currentId => currentId === existingInterval.id ? null : existingInterval.id);
            setPendingRoot(null);
            triggerGlow([existingInterval.rootNote.midi, existingInterval.targetNote.midi]);
            return;
        }

        const noteIndex = (GUITAR_TUNING[s] + f) % 12;
        const midi = STRING_BASE_MIDI[s] + f;
        
        setActiveIntervalId(null);
        setPendingRoot({ s, f, noteIndex, midi });

        if (isAudioReady) {
            await audioService.ensureAudioIsReady();
            const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
            const soundingMidi = midi;
            if (soundingMidi >= 21 && soundingMidi <= 108) {
                const noteName = noteNamesWithFlats[soundingMidi % 12];
                const octave = Math.floor(soundingMidi / 12) - 1;
                await audioService.playNote(`${noteName}${octave}`, { duration: 1.5 });
            }
        }
        triggerGlow([midi]);
    }, [placedIntervals, isAudioReady, audioService, triggerGlow]);


    const handleNoteRightClick = useCallback((s: number, f: number) => {
        // Is the clicked note a root note for any placed interval?
        const isRootForAny = placedIntervals.some(iv => iv.rootNote.s === s && iv.rootNote.f === f);
    
        if (isRootForAny) {
            // It's a root note. Remove all intervals associated with it.
            setPlacedIntervals(prev => prev.filter(iv => !(iv.rootNote.s === s && iv.rootNote.f === f)));
            
            // If this was the pending root, clear it
            if (pendingRoot && pendingRoot.s === s && pendingRoot.f === f) {
                setPendingRoot(null);
            }
            // A root might have been part of the active interval, so clear that too
            const wasActiveRoot = placedIntervals.find(iv => iv.id === activeIntervalId)?.rootNote;
            if (wasActiveRoot && wasActiveRoot.s === s && wasActiveRoot.f === f) {
                 setActiveIntervalId(null);
            }
        } else {
            // Otherwise, it must be a target note. Find the (last placed) interval it belongs to.
            const reversedIntervals = [...placedIntervals].reverse();
            const intervalToRemove = reversedIntervals.find(iv => iv.targetNote.s === s && iv.targetNote.f === f);
    
            if (intervalToRemove) {
                // Remove just that interval
                setPlacedIntervals(prev => prev.filter(iv => iv.id !== intervalToRemove.id));
                // And set its root as the new pending root
                setPendingRoot(intervalToRemove.rootNote);
                // Deactivate if it was the active one
                if (activeIntervalId === intervalToRemove.id) {
                    setActiveIntervalId(null);
                }
            }
        }
    }, [placedIntervals, setPlacedIntervals, pendingRoot, activeIntervalId]);

    const handleIntervalSelect = useCallback(async (interval: Interval) => {
        if (!pendingRoot) return;

        const targetNoteIndex = intervalDirection === 'ascending'
            ? (pendingRoot.noteIndex + interval.semitones) % 12
            : (pendingRoot.noteIndex - interval.semitones + 12) % 12;
        
        const targetPosition = findClosestNextNote(
            pendingRoot,
            targetNoteIndex,
            intervalDirection,
            interval.semitones
        );

        if (!targetPosition) {
            console.error("Could not place the target note on the fretboard.");
            return;
        }

        const newInterval: PlacedInterval = {
            id: crypto.randomUUID(),
            rootNote: pendingRoot,
            targetNote: {
                ...targetPosition,
                noteIndex: targetNoteIndex,
                midi: STRING_BASE_MIDI[targetPosition.s] + targetPosition.f,
            },
            interval,
            direction: intervalDirection,
        };

        setPlacedIntervals(prev => [...prev, newInterval]);
        await playIntervalSound(newInterval.rootNote.midi, newInterval.targetNote.midi);
        // Do NOT clear pendingRoot to allow cumulative interval additions
        setActiveIntervalId(newInterval.id);

    }, [pendingRoot, intervalDirection, playIntervalSound, setPlacedIntervals]);

    const handleClearAll = useCallback(() => {
        setPlacedIntervals([]);
        setPendingRoot(null);
        setActiveIntervalId(null);
        setGlowingMidis(null);
        if (glowTimeoutRef.current) clearTimeout(glowTimeoutRef.current);
    }, [setPlacedIntervals]);

    const handlePlayAllHarmonically = useCallback(async () => {
        if (!isAudioReady || placedIntervals.length === 0) return;
        await audioService.ensureAudioIsReady();
        if (!audioService.audioContext) return;

        const uniqueMidiNotes = new Set<number>();
        placedIntervals.forEach(iv => {
            uniqueMidiNotes.add(iv.rootNote.midi);
            uniqueMidiNotes.add(iv.targetNote.midi);
        });

        const midiNotes = Array.from(uniqueMidiNotes);
        const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        const audioFiles = midiNotes
            .map(midi => {
                if (midi < 21 || midi > 108) return null;
                const noteName = noteNamesWithFlats[midi % 12];
                const octave = Math.floor(midi / 12) - 1;
                return `${noteName}${octave}`;
            })
            .filter((file): file is string => file !== null);
        
        await audioService.playChord(audioFiles, { when: audioService.audioContext.currentTime, duration: 2.0 });
        
        triggerGlow(midiNotes);

    }, [isAudioReady, placedIntervals, audioService, triggerGlow]);

    const handleCycleNotePosition = useCallback(() => {
        if (!activeIntervalId) return;

        const activeIntervalIndex = placedIntervals.findIndex(iv => iv.id === activeIntervalId);
        if (activeIntervalIndex === -1) return;

        const activeInterval = placedIntervals[activeIntervalIndex];
        const { rootNote, targetNote, interval, direction } = activeInterval;

        const idealTargetMidi = direction === 'ascending'
            ? rootNote.midi + interval.semitones
            : rootNote.midi - interval.semitones;

        const allPossiblePositions = findAllNotePositions(targetNote.noteIndex);
        if (allPossiblePositions.length <= 1) return;

        const allCandidates = allPossiblePositions.map(p => ({
            s: p.s,
            f: p.f,
            midi: STRING_BASE_MIDI[p.s] + p.f
        }));

        const occupiedByOthers = new Set<string>();
        placedIntervals.forEach(iv => {
            occupiedByOthers.add(`${iv.rootNote.s}-${iv.rootNote.f}`);
            if (iv.id !== activeIntervalId) {
                occupiedByOthers.add(`${iv.targetNote.s}-${iv.targetNote.f}`);
            }
        });

        const availableCandidates = allCandidates.filter(p => !occupiedByOthers.has(`${p.s}-${p.f}`));
        if (availableCandidates.length <= 1) return;

        // Corrected hierarchical sort
        availableCandidates.sort((a, b) => {
            // Priority 1: Correct Octave (closest to ideal MIDI pitch)
            const midiDistA = Math.abs(a.midi - idealTargetMidi);
            const midiDistB = Math.abs(b.midi - idealTargetMidi);
            if (midiDistA !== midiDistB) return midiDistA - midiDistB;

            // Priority 2: Fretted notes over open strings
            const aIsFretted = a.f > 0;
            const bIsFretted = b.f > 0;
            if (aIsFretted !== bIsFretted) return bIsFretted ? -1 : 1;

            // Priority 3: Fret distance from root
            const fretDistA = Math.abs(a.f - rootNote.f);
            const fretDistB = Math.abs(b.f - rootNote.f);
            if (fretDistA !== fretDistB) return fretDistA - fretDistB;

            // Priority 4: String distance from root
            const stringDistA = Math.abs(a.s - rootNote.s);
            const stringDistB = Math.abs(b.s - rootNote.s);
            if (stringDistA !== stringDistB) return stringDistA - stringDistB;

            // Final deterministic tie-breakers
            if (a.s !== b.s) return a.s - b.s;
            return a.f - b.f;
        });

        const currentPositionIndex = availableCandidates.findIndex(p => p.s === targetNote.s && p.f === targetNote.f);
        const nextPositionIndex = currentPositionIndex !== -1 ? (currentPositionIndex + 1) % availableCandidates.length : 0;
        const nextPosition = availableCandidates[nextPositionIndex];

        if (!nextPosition) return;

        const newTargetNote = {
            s: nextPosition.s,
            f: nextPosition.f,
            noteIndex: targetNote.noteIndex,
            midi: nextPosition.midi
        };

        const newInterval: PlacedInterval = {
            ...activeInterval,
            targetNote: newTargetNote
        };

        setPlacedIntervals(prev => {
            const newPlacedIntervals = [...prev];
            newPlacedIntervals[activeIntervalIndex] = newInterval;
            return newPlacedIntervals;
        });

    }, [activeIntervalId, placedIntervals, setPlacedIntervals]);

    useEffect(() => {
        if (!isActive) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undoPlacedIntervals();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isActive, undoPlacedIntervals]);

    const allStaffNotes = useMemo(() => {
        const uniqueNotes = new Map<number, StaffNote>();

        placedIntervals.forEach(iv => {
            const dyad = getDyadAsStaffNotes(
                { s: iv.rootNote.s, f: iv.rootNote.f },
                iv.interval.semitones,
                iv.direction,
                keySignature,
                allNotes
            );

            const rootIsLower = iv.rootNote.midi < iv.targetNote.midi;
            const rootStaffNote = rootIsLower ? dyad[0] : dyad[1];
            const targetStaffNote = rootIsLower ? dyad[1] : dyad[0];

            if (!uniqueNotes.has(rootStaffNote.midi)) {
                uniqueNotes.set(rootStaffNote.midi, {
                    ...rootStaffNote,
                    color: 'rgb(209, 213, 219)' // Gray for root
                });
            }

            if (!uniqueNotes.has(targetStaffNote.midi)) {
                 uniqueNotes.set(targetStaffNote.midi, {
                    ...targetStaffNote,
                    color: iv.interval.rgbColor
                });
            }
        });

        const notesArray = Array.from(uniqueNotes.values()).sort((a,b) => a.midi - b.midi);
        
        const startX = 100;
        return notesArray.map((note, index) => ({
            ...note,
            xPosition: startX + index * 40
        }));
    }, [placedIntervals, allNotes, keySignature]);


    const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <div className="w-full flex flex-col gap-4 interactive-selection" onClick={stopPropagation}>
            <div className="w-full flex flex-col items-center">
                <IntervalControls 
                    onIntervalSelect={handleIntervalSelect}
                    onClearAll={handleClearAll}
                    onPlayAll={handlePlayAllHarmonically}
                    isAnyIntervalPlaced={placedIntervals.length > 0}
                    isPendingRootSelected={!!pendingRoot}
                    enharmonicPreference={enharmonicPreference}
                    onEnharmonicChange={setEnharmonicPreference}
                    intervalDirection={intervalDirection}
                    onIntervalDirectionChange={setIntervalDirection}
                    onCyclePosition={handleCycleNotePosition}
                    activeIntervalId={activeIntervalId}
                />
            </div>

            <div ref={staffContainerRef} className="w-full mt-2 space-y-2">
                <Staff
                    notes={[]}
                    blockChordNotes={allStaffNotes}
                    keySignature={keySignature}
                    glowingMidis={glowingMidis}
                    onNoteInteraction={() => {}}
                    width={staffWidth}
                />
                <IntervalFretboard
                    placedIntervals={placedIntervals}
                    pendingRoot={pendingRoot ? { s: pendingRoot.s, f: pendingRoot.f } : null}
                    activeIntervalId={activeIntervalId}
                    onNoteInteraction={handleFretboardInteraction}
                    onNoteRightClick={handleNoteRightClick}
                    allNotes={allNotes}
                    glowingMidis={glowingMidis}
                />
            </div>
        </div>
    );
};

export default IntervalsVisualizer;