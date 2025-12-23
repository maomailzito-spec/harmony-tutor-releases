import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Fretboard from './Fretboard';
import Controls, { ShapeControls } from './Controls';
import Staff from './Staff';
import { PlacedBox, Key, RootType, ScaleShape, ScaleType, EnharmonicMode, DisplayNote, StaffNote, KeySignature, ScaleNoteDefinition } from '../types';
import { 
  NOTE_NAMES, 
  GUITAR_TUNING, 
  FRET_COUNT,
  // FIX: Replaced NOTE_NAMES_BY_INDEX with ALL_NOTE_SPELLINGS and added other missing imports
  ALL_NOTE_SPELLINGS,
  ALL_SHAPES,
  CHROMATIC_SCALE,
  SCALE_INTERVALS as BUILT_IN_SCALE_INTERVALS,
} from '../constants';
import ScaleKeySelector from './ScaleKeySelector';
import { AudioService } from '../services/AudioService';
import { getEnharmonicPreference, getKeySignature, getScaleAsNoteObjects, getFretboardNotesAsStaffNotes } from '../utils/musicTheory';
import PlaybackControls from './PlaybackControls';
import { useCustomData } from './useCustomTypes';
import { useUndoableState } from '../hooks/useUndoableState';

const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40]; // High E to Low E

const orderedScaleTypes: ScaleType[] = [
    'Pentatonic',
    // Major Scale Modes
    'Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian',
    // Harmonic Minor Modes
    'Harmonic Minor', 'Locrian #6', 'Ionian #5', 'Dorian #4', 'Phrygian Dominant', 'Lydian #2', 'Altered Dominant bb7',
    // Melodic Minor Modes
    'Melodic Minor', 'Dorian b2', 'Lydian Augmented', 'Lydian Dominant', 'Mixolydian b6', 'Locrian #2', 'Altered Scale'
];

const PENTATONIC_ROOT_STRING_MAP: { [shapeIndex: number]: number } = {
  0: 5, // Shape 1 -> Low E string (index 5)
  1: 3, // Shape 2 -> D string (index 3)
  2: 1, // Shape 3 -> B string (index 1)
  3: 4, // Shape 4 -> A string (index 4)
  4: 2, // Shape 5 -> G string (index 2)
};

interface AppState {
    placedBoxes: PlacedBox[];
    selectedKey: Key | null;
}

const MAJOR_MODES: Set<ScaleType> = new Set([
  'Ionian', 'Lydian', 'Mixolydian', 'Lydian Augmented', 'Lydian Dominant', 'Mixolydian b6', 'Ionian #5', 'Phrygian Dominant', 'Lydian #2'
]);

const getMinorRoot = (note: string): string => {
  const noteIndex = NOTE_NAMES.indexOf(note);
  const minorRootIndex = (noteIndex - 3 + 12) % 12;
  return NOTE_NAMES[minorRootIndex];
};

const calculateLowestFretPositions = (key: Key, shapes: ScaleShape[], scaleType: ScaleType): { shapeIndex: number, fretPosition: number }[] => {
    let rootToFind: string;
    let rootTypeToFind: RootType;

    if (scaleType === 'Pentatonic') {
        rootToFind = key.scale === 'Minor' ? key.note : getMinorRoot(key.note);
        rootTypeToFind = RootType.Minor;
    } else {
        rootToFind = key.note;
        if (['Ionian', 'Lydian', 'Mixolydian', 'Lydian Augmented', 'Lydian Dominant', 'Mixolydian b6', 'Ionian #5', 'Phrygian Dominant', 'Lydian #2'].includes(scaleType)) {
            rootTypeToFind = RootType.Major;
        } else { // Dorian, Phrygian, Aeolian, Locrian, etc.
            rootTypeToFind = RootType.Minor;
        }
    }
    
    const targetNoteIndex = NOTE_NAMES.indexOf(rootToFind);
    const allPositions: { shapeIndex: number, fretPosition: number }[] = [];

    shapes.forEach((shape, shapeIndex) => {
        const rootsInShape = shape.notes.filter(n => n.t === rootTypeToFind);

        if (rootsInShape.length === 0) return;

        const maxFretOffset = Math.max(...shape.notes.map(n => n.f));
        const minFretOffset = Math.min(...shape.notes.map(n => n.f));

        rootsInShape.forEach(rootDef => {
            const { s: rootString, f: rootFretOffset } = rootDef;
            const openNoteIndex = GUITAR_TUNING[rootString];
            const baseFret = (targetNoteIndex - openNoteIndex + 12) % 12;

            for (let i = 0; i < 3; i++) {
                const fret = baseFret + (i * 12) - rootFretOffset;
                if (fret + minFretOffset >= 0 && fret + maxFretOffset <= 15) {
                    allPositions.push({ shapeIndex, fretPosition: fret });
                }
            }
        });
    });

    // Remove duplicates
    const uniquePositions = Array.from(new Map(allPositions.map(p => [`${p.shapeIndex}-${p.fretPosition}`, p])).values());
    
    // Find the lowest fret position for each shape
    const lowestPositions = new Map<number, { shapeIndex: number, fretPosition: number }>();

    uniquePositions.forEach(pos => {
      const existing = lowestPositions.get(pos.shapeIndex);
      if (!existing || pos.fretPosition < existing.fretPosition) {
        lowestPositions.set(pos.shapeIndex, pos);
      }
    });

    return Array.from(lowestPositions.values());
};

interface ScalesVisualizerProps {
    audioService: AudioService;
    isAudioReady: boolean;
    isActive: boolean;
}

const ScalesVisualizer: React.FC<ScalesVisualizerProps> = ({ audioService, isAudioReady, isActive }) => {
    const { customScales } = useCustomData();
    const [scaleType, setScaleType] = useState<ScaleType>('Pentatonic');
    const [appState, setAppState, undoAppState] = useUndoableState<AppState>({
        placedBoxes: [],
        selectedKey: null,
    });
    const { placedBoxes, selectedKey } = appState;
    const [enharmonicMode, setEnharmonicMode] = useState<EnharmonicMode>('auto');
    const [playbackDirection, setPlaybackDirection] = useState<'ascending' | 'descending'>('ascending');
    
    const [selectedFret, setSelectedFret] = useState<number | null>(null);
    const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
    const [playingScale, setPlayingScale] = useState<{boxId: string, notes: {s: number, f: number}[]} | null>(null);
    const [glowingNote, setGlowingNote] = useState<{ writtenMidi: number; source: 'fretboard' | 'staff' } | null>(null);
    const glowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const playbackTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    // FIX: Add ref and state for measuring staff width.
    const staffContainerRef = useRef<HTMLDivElement>(null);
    const [staffWidth, setStaffWidth] = useState(1000);

    const allScaleIntervals = useMemo(() => {
        const customIntervals = Object.fromEntries(customScales.map(s => [s.name, s.intervals]));
        return { ...BUILT_IN_SCALE_INTERVALS, ...customIntervals };
    }, [customScales]);

    // --- STAFF STATE ---
    const [staffNotes, setStaffNotes] = useState<StaffNote[]>([]);
    const [keySignature, setKeySignature] = useState<KeySignature>({ type: 'sharp', count: 0 });
    
    const availableShapes = useMemo((): ScaleShape[] => {
        return ALL_SHAPES[scaleType] || [];
    }, [scaleType]);

    // FIX: Add useEffect to measure staff container width.
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

    const scaleNoteIndices = useMemo((): number[] => {
        if (!selectedKey) return [];
        const rootNoteIndex = NOTE_NAMES.indexOf(selectedKey.note);
        if (rootNoteIndex === -1) return [];

        let intervals: number[] | undefined;
        if (scaleType === 'Pentatonic') {
            intervals = selectedKey.scale === 'Major' ? allScaleIntervals['Major Pentatonic'] : allScaleIntervals['Pentatonic'];
        } else {
            intervals = allScaleIntervals[scaleType];
        }

        if (!intervals) return [];
        return intervals.map(i => (rootNoteIndex + i) % 12);
    }, [selectedKey, scaleType, allScaleIntervals]);
    
    const allNotes = useMemo((): DisplayNote[] => {
        const noteMap = new Map<number, string>();

        if (enharmonicMode === 'auto' && selectedKey) {
            const rootNoteIndex = NOTE_NAMES.indexOf(selectedKey.note);
            const useFlats = getEnharmonicPreference(selectedKey.note, scaleType, selectedKey.scale);
            
            for (let i = 0; i < 12; i++) {
                const names = ALL_NOTE_SPELLINGS[i];
                if (names.length > 1) {
                     if (useFlats) {
                        noteMap.set(i, names.find(n => n.includes('b')) || names[0]);
                    } else {
                        const sharpName = names.find(n => n.includes('#'));
                        const naturalName = names.find(n => !n.includes('#') && !n.includes('b'));
                        if (naturalName) {
                            noteMap.set(i, naturalName);
                        } else {
                            noteMap.set(i, sharpName || names[0]);
                        }
                    }
                }
            }

            const intervals = scaleType === 'Pentatonic'
                ? (selectedKey.scale === 'Major' ? allScaleIntervals['Major Pentatonic'] : allScaleIntervals['Pentatonic'])
                : allScaleIntervals[scaleType];

            if (intervals && intervals.length > 5) { // Apply theoretical spelling for heptatonic/etc scales
                const rootLetter = selectedKey.note.charAt(0);
                const letterNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
                const rootLetterIdx = letterNames.indexOf(rootLetter);
                const sortedLetters = [...letterNames.slice(rootLetterIdx), ...letterNames.slice(0, rootLetterIdx)];

                intervals.forEach((interval, i) => {
                    if (i >= sortedLetters.length) return;
                    const noteIndex = (rootNoteIndex + interval) % 12;
                    const degreeLetter = sortedLetters[i];
                    
                    const possibleNames = ALL_NOTE_SPELLINGS[noteIndex];
                    const noteName = possibleNames.find(name => name.charAt(0) === degreeLetter) || noteMap.get(noteIndex) || possibleNames[0];
                    noteMap.set(noteIndex, noteName);
                });
            }
        }

        return CHROMATIC_SCALE.map((note, index) => {
            const isEnharmonic = note.sharp !== note.flat;
            let name: string;
            
            if (noteMap.has(index)) {
                name = noteMap.get(index)!;
            } else {
                name = enharmonicMode === 'flat' ? note.flat : note.sharp;
            }

            return { ...note, name, isEnharmonic, originalIndex: index };
        });
    }, [enharmonicMode, selectedKey, scaleType, allScaleIntervals]);
    
    const displayScaleName = useMemo(() => {
        if (!selectedKey) return '';
        const rootNoteName = allNotes[NOTE_NAMES.indexOf(selectedKey.note)]?.name || selectedKey.note;
        if (scaleType === 'Pentatonic') {
            return `${rootNoteName} ${selectedKey.scale} Pentatonic`;
        }
        let scaleDisplayName: string = scaleType;
        if (scaleType === 'Ionian') scaleDisplayName = 'Ionian (Major)';
        if (scaleType === 'Aeolian') scaleDisplayName = 'Aeolian (Natural Minor)';
        return `${rootNoteName} ${scaleDisplayName}`;
    }, [selectedKey, scaleType, allNotes]);

    const handleNoteInteraction = useCallback(async (note: { s?: number; f?: number; midi?: number; source: 'fretboard' | 'staff' }) => {
        if (glowTimeoutRef.current) clearTimeout(glowTimeoutRef.current);
        
        await audioService.ensureAudioIsReady();

        const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        let writtenMidi: number;
        let soundingMidi: number;
        
        if (note.source === 'fretboard' && typeof note.s === 'number' && typeof note.f === 'number') {
            soundingMidi = STRING_BASE_MIDI[note.s] + note.f;
            writtenMidi = soundingMidi + 12;
        } else if (note.source === 'staff' && typeof note.midi === 'number') {
            writtenMidi = note.midi;
            soundingMidi = writtenMidi - 12;
        } else {
            return;
        }
        
        if (isAudioReady) {
            const octave = Math.floor(soundingMidi / 12) - 1;
            const noteName = noteNamesWithFlats[soundingMidi % 12];
            const audioFile = `${noteName}${octave}`;
            await audioService.playNote(audioFile, { duration: 1.5 });
        }

        setGlowingNote({ 
            writtenMidi: writtenMidi,
            source: note.source 
        });
        
        glowTimeoutRef.current = setTimeout(() => {
            setGlowingNote(null);
        }, 1500);

    }, [isAudioReady, audioService]);


    useEffect(() => {
        let notesForStaff: StaffNote[] = [];
        const newKeySignature: KeySignature = selectedKey ? getKeySignature(selectedKey.note, selectedKey.scale) : { type: 'sharp', count: 0 };
        setKeySignature(newKeySignature);

        const activeBox = placedBoxes.find(b => b.id === activeBoxId);
        
        if (activeBox) {
            const shape = ALL_SHAPES[activeBox.scaleType]?.[activeBox.shapeIndex];
            if (shape) {
                const shapeStaffNotes = getFretboardNotesAsStaffNotes(shape, activeBox.fretPosition, newKeySignature, allNotes);
                
                notesForStaff = shapeStaffNotes.map(note => ({
                    ...note,
                    color: shape.color
                }));
            }
        }
        
        // Spacing the notes horizontally, dynamically adjusting for key signature width
        const clefWidth = 60; // Approximate width for the clef area
        const keySignatureWidth = newKeySignature.count * 15; // 15px per accidental for spacing
        const padding = 40; // Space between key signature and first note
        const startX = clefWidth + keySignatureWidth + padding;

        const spacedNotes = notesForStaff.map((note, index) => ({
            ...note,
            xPosition: startX + index * 35
        }));
        
        setStaffNotes(spacedNotes);
        
    }, [selectedKey, scaleType, enharmonicMode, activeBoxId, placedBoxes, allNotes]);


    const handleKeyChange = (newKey: Key | null) => {
        if (newKey === null) {
            setAppState({
                selectedKey: null,
                placedBoxes: [],
            });
            setSelectedFret(null);
            return;
        }

        setAppState(currentAppState => {
            let adjustedKey = { ...newKey };
            if (scaleType !== 'Pentatonic' && !customScales.find(s => s.name === scaleType)) {
                const requiredQuality = MAJOR_MODES.has(scaleType) ? 'Major' : 'Minor';
                if (adjustedKey.scale !== requiredQuality) {
                    adjustedKey.scale = requiredQuality;
                }
            }
        
            const shapesForScale = ALL_SHAPES[scaleType] || [];
            if (shapesForScale.length > 0) {
                 const allPositions = calculateLowestFretPositions(adjustedKey, shapesForScale, scaleType);
                const firstShapePosition = allPositions.find(p => p.shapeIndex === 0);

                const newBoxes = firstShapePosition ? [{
                    id: crypto.randomUUID(),
                    shapeIndex: firstShapePosition.shapeIndex,
                    fretPosition: firstShapePosition.fretPosition,
                    scaleType: scaleType,
                }] : [];

                 return {
                    ...currentAppState,
                    selectedKey: adjustedKey,
                    placedBoxes: newBoxes,
                };
            }
           
            return {
                ...currentAppState,
                selectedKey: adjustedKey,
                placedBoxes: [],
            };
        });

        setSelectedFret(null);
    };
    
    const handleScaleTypeChange = useCallback((newScaleType: ScaleType) => {
        setScaleType(newScaleType);

        setAppState(current => {
            if (!current.selectedKey) {
                if (activeBoxId) {
                    const updatedBoxes = current.placedBoxes.map(box => {
                        if (box.id === activeBoxId) {
                            if (ALL_SHAPES[newScaleType]?.[box.shapeIndex]) {
                               return { ...box, scaleType: newScaleType };
                            }
                        }
                        return box;
                    });
                    return { ...current, placedBoxes: updatedBoxes };
                }
                return current;
            }

            let newQuality = current.selectedKey.scale;
            if (newScaleType !== 'Pentatonic' && !customScales.find(s => s.name === newScaleType)) {
                newQuality = MAJOR_MODES.has(newScaleType) ? 'Major' : 'Minor';
            }
           
            const updatedKey = current.selectedKey.scale !== newQuality
                ? { ...current.selectedKey, scale: newQuality }
                : current.selectedKey;

            const shapesForScale = ALL_SHAPES[newScaleType] || [];
            if (shapesForScale.length > 0) {
                const allPositions = calculateLowestFretPositions(updatedKey, shapesForScale, newScaleType);
                const firstShapePosition = allPositions.find(p => p.shapeIndex === 0);

                const newBoxes = firstShapePosition ? [{
                    id: crypto.randomUUID(),
                    shapeIndex: firstShapePosition.shapeIndex,
                    fretPosition: firstShapePosition.fretPosition,
                    scaleType: newScaleType,
                }] : [];
                 return {
                    selectedKey: updatedKey,
                    placedBoxes: newBoxes,
                };
            }

            return {
                selectedKey: updatedKey,
                placedBoxes: [],
            };
        });
    }, [setAppState, activeBoxId, customScales]);

    const addBox = (shapeIndex: number, fretPosition: number) => {
        if (shapeIndex < 0 || shapeIndex >= availableShapes.length) return;

        const newBox: PlacedBox = {
            id: crypto.randomUUID(),
            shapeIndex,
            fretPosition,
            scaleType: scaleType,
        };
        setAppState({
            ...appState,
            placedBoxes: [...placedBoxes, newBox],
        });
        setActiveBoxId(newBox.id);
    };

    const removeBox = useCallback((boxId: string) => {
        setAppState(currentAppState => ({
            ...currentAppState,
            placedBoxes: currentAppState.placedBoxes.filter(box => box.id !== boxId),
        }));
        if (activeBoxId === boxId) {
            setActiveBoxId(null);
        }
    }, [activeBoxId, setAppState]);

    const updateShapePosition = useCallback((boxId: string, fretPosition: number) => {
        setAppState(currentAppState => ({
            ...currentAppState,
            placedBoxes: currentAppState.placedBoxes.map(box =>
                box.id === boxId ? { ...box, fretPosition } : box
            ),
        }));
    }, [setAppState]);

    const updateBoxShape = useCallback((boxId: string, newShapeIndex: number) => {
        setAppState(currentAppState => {
            const oldBox = currentAppState.placedBoxes.find(b => b.id === boxId);
            if (!oldBox) return currentAppState;

            const shapesForScale = ALL_SHAPES[oldBox.scaleType];
            if (!shapesForScale || newShapeIndex < 0 || newShapeIndex >= shapesForScale.length) {
                return currentAppState;
            }

            const oldShape = shapesForScale[oldBox.shapeIndex];
            const newShape = shapesForScale[newShapeIndex];

            if (!oldShape || !newShape) return currentAppState;

            const isMajorMode = MAJOR_MODES.has(oldBox.scaleType);
            const rootType = oldBox.scaleType === 'Pentatonic' ? RootType.Minor : (isMajorMode ? RootType.Major : RootType.Minor);

            const getRootDef = (shape: ScaleShape, shapeIdx: number): ScaleNoteDefinition | null => {
                const roots = shape.notes.filter(n => n.t === rootType);
                if (roots.length === 0) return null;

                if (oldBox.scaleType === 'Pentatonic') {
                    const targetString = PENTATONIC_ROOT_STRING_MAP[shapeIdx as keyof typeof PENTATONIC_ROOT_STRING_MAP];
                    const specificRoot = roots.find(r => r.s === targetString);
                    return specificRoot || roots[0];
                } else {
                    return roots.sort((a, b) => b.s - a.s || a.f - b.f)[0];
                }
            };

            const oldRootDef = getRootDef(oldShape, oldBox.shapeIndex);
            const newRootDef = getRootDef(newShape, newShapeIndex);

            let newFretPosition = oldBox.fretPosition;

            if (oldRootDef && newRootDef) {
                const oldRootFret = oldBox.fretPosition + oldRootDef.f;
                newFretPosition = oldRootFret - newRootDef.f;
            }
            
            return {
                ...currentAppState,
                placedBoxes: currentAppState.placedBoxes.map(box =>
                    box.id === boxId ? { ...box, shapeIndex: newShapeIndex, fretPosition: newFretPosition } : box
                ),
            };
        });
    }, [setAppState]);

    const setShapeInKey = useCallback((shapeIndex: number) => {
        if (!selectedKey || shapeIndex < 0 || shapeIndex >= availableShapes.length) return;
        
        const allPositions = calculateLowestFretPositions(selectedKey, availableShapes, scaleType);
        const positionForShape = allPositions.find(p => p.shapeIndex === shapeIndex);
        
        if (positionForShape) {
            const newBox: PlacedBox = {
                id: crypto.randomUUID(),
                shapeIndex: positionForShape.shapeIndex,
                fretPosition: positionForShape.fretPosition,
                scaleType: scaleType,
            };
            
            setAppState(current => ({
                ...current,
                placedBoxes: [newBox]
            }));
        }
    }, [selectedKey, availableShapes, scaleType, setAppState]);

    const addShapeInKey = (shapeIndex: number) => {
        setShapeInKey(shapeIndex);
    }
    
    const getScaleNotesInOrder = useCallback((boxId: string, startNote: { s: number; f: number }, direction: 'ascending' | 'descending') => {
        const box = placedBoxes.find(b => b.id === boxId);
        if (!box) return null;

        const shape = ALL_SHAPES[box.scaleType]?.[box.shapeIndex];
        if (!shape) return null;
        
        const allNotes = shape.notes
            .filter(n => !n.isAlternate)
            .map(n => ({ s: n.s, f: n.f + box.fretPosition }));
        
        if (direction === 'ascending') {
            allNotes.sort((a, b) => {
                if (a.s !== b.s) return b.s - a.s;
                return a.f - b.f;
            });
        } else {
            allNotes.sort((a, b) => {
                if (a.s !== b.s) return a.s - b.s;
                return b.f - a.f;
            });
        }

        const startIndex = allNotes.findIndex(n => n.s === startNote.s && n.f === startNote.f);
        if (startIndex === -1) return null;

        const orderedScale = [
            ...allNotes.slice(startIndex),
            ...allNotes.slice(0, startIndex),
            allNotes[startIndex]
        ];

        return orderedScale;
    }, [placedBoxes]);

    const handlePlayScaleFromNote = useCallback(async (boxId: string, startNote: { s: number; f: number }) => {
        if (playingScale) return;
        await audioService.ensureAudioIsReady();
        const notesToPlay = getScaleNotesInOrder(boxId, startNote, playbackDirection);
        if (notesToPlay) {
            setPlayingScale({ boxId, notes: notesToPlay });
        }
    }, [getScaleNotesInOrder, playingScale, playbackDirection, audioService]);

    const handlePlaybackComplete = useCallback(() => {
        setPlayingScale(null);
    }, []);

    const getAudioFileForNote = useCallback((stringIndex: number, fret: number): string | null => {
        const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        const midiNote = STRING_BASE_MIDI[stringIndex] + fret;
        if (midiNote < 21 || midiNote > 108) return null;
        const noteName = noteNamesWithFlats[midiNote % 12];
        const octave = Math.floor(midiNote / 12) - 1;
        return `${noteName}${octave}`;
    }, []);

    useEffect(() => {
        const clearTimeouts = () => {
            playbackTimeoutsRef.current.forEach(clearTimeout);
            playbackTimeoutsRef.current = [];
        };

        if (!playingScale || !isAudioReady) {
            clearTimeouts();
            return;
        }

        const startPlayback = async () => {
            const { notes } = playingScale;
            const audioFilesToLoad = notes
                .map(note => getAudioFileForNote(note.s, note.f))
                .filter((file): file is string => !!file);
            
            await audioService.preloadNotes(audioFilesToLoad);
            
            const noteIntervalMs = 250;
            const flashDurationMs = 200;

            notes.forEach((note, index) => {
                const playDelay = index * noteIntervalMs;
                
                const playTimeout = setTimeout(() => {
                    const audioFile = getAudioFileForNote(note.s, note.f);
                    if (audioFile) {
                        audioService.playNote(audioFile, { duration: noteIntervalMs / 1000 });
                    }
                    
                    const soundingMidi = STRING_BASE_MIDI[note.s] + note.f;
                    const writtenMidi = soundingMidi + 12;
                    setGlowingNote({ writtenMidi, source: 'fretboard' });

                    const flashOffTimeout = setTimeout(() => {
                        setGlowingNote(current => (current?.writtenMidi === writtenMidi) ? null : current);
                    }, flashDurationMs);
                    playbackTimeoutsRef.current.push(flashOffTimeout);

                }, playDelay);
                playbackTimeoutsRef.current.push(playTimeout);
            });

            const totalDuration = notes.length * noteIntervalMs;
            const finalCleanupTimeout = setTimeout(() => {
                handlePlaybackComplete();
            }, totalDuration);
            playbackTimeoutsRef.current.push(finalCleanupTimeout);
        };

        startPlayback();

        return () => {
            clearTimeouts();
            audioService.stopAllSounds();
            setGlowingNote(null);
        };
    }, [playingScale, isAudioReady, audioService, handlePlaybackComplete, getAudioFileForNote]);


    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                if(e.key === 'z') {
                    e.preventDefault();
                    undoAppState();
                }
                return;
            }

            if (e.key === 'Backspace' || e.key === 'Delete') {
                if (activeBoxId) {
                    e.preventDefault();
                    removeBox(activeBoxId);
                }
                return;
            }
            
            switch (e.key) {
                case 'ArrowUp':
                case 'ArrowDown': {
                    e.preventDefault();
                    const allScaleTypes = [...orderedScaleTypes, ...customScales.map(s => s.name)];
                    const currentIndex = allScaleTypes.indexOf(scaleType);
                    if (currentIndex === -1) return;

                    const nextIndex = e.key === 'ArrowDown'
                        ? (currentIndex + 1) % allScaleTypes.length
                        : (currentIndex - 1 + allScaleTypes.length) % allScaleTypes.length;
                    
                    handleScaleTypeChange(allScaleTypes[nextIndex]);
                    return;
                }
                case 'ArrowLeft':
                case 'ArrowRight': {
                    e.preventDefault();
                    const currentActiveBoxId = activeBoxId;
                    if (!currentActiveBoxId) return;
                    
                    const activeBox = placedBoxes.find(b => b.id === currentActiveBoxId);
                    if (!activeBox) return;

                    if (!selectedKey) {
                        const newFretPosition = activeBox.fretPosition + (e.key === 'ArrowRight' ? 1 : -1);
                        updateShapePosition(currentActiveBoxId, newFretPosition);
                    } else {
                        if (availableShapes.length < 2 || placedBoxes.length === 0) return;

                        const currentBox = placedBoxes[0];
                        const currentShapeIndex = currentBox.shapeIndex;

                        const direction = e.key === 'ArrowRight' ? 1 : -1;
                        const nextShapeIndex = (currentShapeIndex + direction + availableShapes.length) % availableShapes.length;
                        
                        const allLowestPositions = calculateLowestFretPositions(selectedKey, availableShapes, scaleType);
                        const nextShapePosition = allLowestPositions.find(p => p.shapeIndex === nextShapeIndex);

                        if (nextShapePosition) {
                            const updatedBox: PlacedBox = {
                                ...currentBox,
                                shapeIndex: nextShapePosition.shapeIndex,
                                fretPosition: nextShapePosition.fretPosition,
                            };

                            setAppState(current => ({
                                ...current,
                                placedBoxes: [updatedBox]
                            }));
                        }
                    }
                    return;
                }
            }
            
            const keyNum = parseInt(e.key, 10);
            if (!isNaN(keyNum) && keyNum > 0 && keyNum <= availableShapes.length) {
                const shapeIndex = keyNum - 1;

                if (!selectedKey && activeBoxId) {
                    updateBoxShape(activeBoxId, shapeIndex);
                } else if (selectedKey) {
                    setShapeInKey(shapeIndex);
                } else if (selectedFret !== null) {
                    const shape = availableShapes[shapeIndex];
                    if (!shape) return;

                    let rootDef: ScaleNoteDefinition | undefined;

                    if (scaleType === 'Pentatonic') {
                        const targetStringIndex = PENTATONIC_ROOT_STRING_MAP[shapeIndex as keyof typeof PENTATONIC_ROOT_STRING_MAP];
                        if (targetStringIndex !== undefined) {
                            rootDef = shape.notes.find(n => n.s === targetStringIndex && n.t === RootType.Minor);
                        }
                        if (!rootDef) {
                            const minorRoots = shape.notes.filter(n => n.t === RootType.Minor);
                            if (minorRoots.length > 0) {
                                rootDef = minorRoots.sort((a, b) => a.f - b.f)[0];
                            }
                        }
                    } else {
                        const isMajorMode = MAJOR_MODES.has(scaleType);
                        const rootType = isMajorMode ? RootType.Major : RootType.Minor;
                        const roots = shape.notes.filter(n => n.t === rootType);
                        if (roots.length > 0) {
                            rootDef = roots.sort((a, b) => b.s - a.s || a.f - b.f)[0];
                        }
                    }
                    
                    const fretPosition = rootDef ? selectedFret - rootDef.f : selectedFret;
                    
                    addBox(shapeIndex, fretPosition);
                    setSelectedFret(null);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, selectedFret, availableShapes, selectedKey, placedBoxes, activeBoxId, undoAppState, updateShapePosition, updateBoxShape, scaleType, setAppState, removeBox, handleScaleTypeChange, setShapeInKey, customScales]);

    useEffect(() => {
        const activeBoxExists = activeBoxId && placedBoxes.some(box => box.id === activeBoxId);

        if (!activeBoxId && placedBoxes.length > 0) {
            setActiveBoxId(placedBoxes[0].id);
        } 
        else if (activeBoxId && !activeBoxExists) {
            setActiveBoxId(placedBoxes.length > 0 ? placedBoxes[0].id : null);
        }
    }, [placedBoxes, activeBoxId]);

    const activeBoxRef = useRef(activeBoxId);
    activeBoxRef.current = activeBoxId;

    useEffect(() => {
      const deselectBox = (e: MouseEvent) => {
        const clickedInsideInteractive = (e.target as HTMLElement).closest('.interactive-selection');
        if (!clickedInsideInteractive) {
            setActiveBoxId(null);
        }
      };
      
      document.addEventListener('click', deselectBox);
      return () => document.removeEventListener('click', deselectBox);
    }, []);
    
    const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <div onClick={stopPropagation} className="flex-grow flex flex-col interactive-selection pb-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                 <div className="lg:flex lg:justify-end w-full">
                    <Controls
                        scaleType={scaleType}
                        onScaleTypeChange={handleScaleTypeChange}
                        selectedKey={selectedKey}
                        onKeyChange={handleKeyChange}
                        isModeLocked={scaleType !== 'Pentatonic' && !customScales.find(s => s.name === scaleType)}
                        enharmonicMode={enharmonicMode}
                        onEnharmonicModeChange={setEnharmonicMode}
                    />
                </div>
                <div className="w-full flex justify-center">
                    <ScaleKeySelector 
                        selectedKey={selectedKey} 
                        onKeyChange={handleKeyChange}
                        scaleNoteIndices={scaleNoteIndices}
                        scaleType={scaleType}
                        allNotes={allNotes}
                    />
                </div>
                 <div className="lg:flex lg:justify-start w-full">
                    <ShapeControls
                        placedBoxes={placedBoxes}
                        availableShapes={availableShapes}
                        allShapes={ALL_SHAPES}
                        selectedKey={selectedKey}
                        onRemoveBox={removeBox}
                        onUpdateShapePosition={updateShapePosition}
                        activeBoxId={activeBoxId}
                        onSelectBox={setActiveBoxId}
                        onAddShapeInKey={addShapeInKey}
                        scaleType={scaleType}
                    />
                </div>
            </div>

            <div className="flex justify-center mt-1">
                <PlaybackControls 
                    playbackDirection={playbackDirection}
                    onPlaybackDirectionChange={setPlaybackDirection}
                />
            </div>

            <div ref={staffContainerRef} className="w-full">
                <Staff 
                    notes={staffNotes}
                    keySignature={keySignature}
                    glowingNoteMidi={glowingNote?.writtenMidi ?? null}
                    onNoteInteraction={(noteData) => handleNoteInteraction({ ...noteData, source: 'staff' })}
                    // FIX: Pass the measured width to the Staff component.
                    width={staffWidth}
                />
                
                {selectedKey && (
                    <div className="text-center mb-1">
                        <h2 className="text-xl font-semibold text-gray-300 tracking-wide">{displayScaleName}</h2>
                    </div>
                )}

                 <div>
                    <Fretboard 
                        placedBoxes={placedBoxes}
                        allShapes={ALL_SHAPES}
                        selectedFret={selectedFret} 
                        onSelectFret={setSelectedFret}
                        onPlayScaleFromNote={handlePlayScaleFromNote}
                        selectedKey={selectedKey}
                        scaleType={scaleType}
                        allNotes={allNotes}
                        audioService={audioService}
                        glowingNote={glowingNote}
                        onNoteInteraction={(noteData) => handleNoteInteraction({ ...noteData, source: 'fretboard' })}
                        activeBoxId={activeBoxId}
                        playingScaleBoxId={playingScale?.boxId ?? null}
                    />
                </div>
            </div>
        </div>
    );
};

export default ScalesVisualizer;