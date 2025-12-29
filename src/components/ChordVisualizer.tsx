import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChordCircle } from './ChordCircle';
import { ChordControls } from './ChordControls';
import { CagedSystem } from './CagedSystem';
import { ChordFretboard } from './ChordFretboard';
import { AudioService } from '../services/AudioService';
import { ChordType, EnharmonicPreference, DisplayNote, CagedVoicing, Key, StaffNote, KeySignature, ScaleType, BuiltInChords, Voicing } from '../types';
// FIX: Added missing constant imports
import { CHROMATIC_SCALE, CHORD_FORMULAS as BUILT_IN_CHORD_FORMULAS, NOTE_NAMES, CHORD_RGB_COLORS, CHORD_TEXT_COLORS, SCALE_INTERVALS, ALL_NOTE_SPELLINGS } from '../constants';
import { getGuitarVoicings } from '../data/guitarVoicings';
import Staff from './Staff';
import { getKeySignature, getScaleAsNoteObjects, getVoicingAsStaffNotes, calculateAccidental } from '../utils/musicTheory';
import { useCustomData } from './useCustomTypes';

const STRING_SETS = ['6-5-4-3', '5-4-3-2', '4-3-2-1', '6-4-3-2', '5-3-2-1'];

const MINOR_LIKE_CHORDS: ChordType[] = [
    BuiltInChords.Minor,
    BuiltInChords.Minor6,
    BuiltInChords.Minor7,
    BuiltInChords.Minor9,
    BuiltInChords.Minor11,
    BuiltInChords.Minor13,
    BuiltInChords.Minor7b5,
    BuiltInChords.Diminished,
    BuiltInChords.Diminished7,
];

const transposeVoicing = (voicing: Voicing, amount: number): Voicing => {
    return voicing.map(fret => (fret === -1 ? -1 : fret + amount)) as Voicing;
};

const pickBestTransposition = (voicing: Voicing, deltaBase: number): Voicing => {
    const deltas = [deltaBase, deltaBase + 12, deltaBase - 12];
    const candidates = deltas
        .map(d => transposeVoicing(voicing, d))
        .filter(v => v.every(f => f === -1 || f >= 0));

    if (candidates.length === 0) {
        const safe = transposeVoicing(voicing, deltaBase + 12);
        return safe.map(f => (f === -1 ? -1 : Math.max(0, f))) as Voicing;
    }

    const score = (v: Voicing) => {
        const frets = v.filter(f => f !== -1) as number[];
        const maxFret = frets.length ? Math.max(...frets) : 0;
        const minFret = frets.length ? Math.min(...frets) : 0;
        return { maxFret, minFret };
    };

    return candidates
        .map(v => ({ v, s: score(v) }))
        .sort((a, b) => a.s.maxFret - b.s.maxFret || a.s.minFret - b.s.minFret)[0].v;
};

interface ChordVisualizerProps {
    audioService: AudioService;
    isAudioReady: boolean;
    isActive: boolean;
}

const ChordVisualizer: React.FC<ChordVisualizerProps> = ({ audioService, isAudioReady, isActive }) => {
    const { customVoicings, customChords } = useCustomData();
    const [rootNoteIndex, setRootNoteIndex] = useState(0); // C
    const [activeChordType, setActiveChordType] = useState<ChordType>(BuiltInChords.Major);
    const [enharmonicPreference, setEnharmonicPreference] = useState<EnharmonicPreference>('sharp');

    const allChordFormulas = useMemo(() => {
        const customFormulas = Object.fromEntries(customChords.map(c => [c.name, c.formula]));
        return { ...BUILT_IN_CHORD_FORMULAS, ...customFormulas };
    }, [customChords]);

    // --- STAFF STATE ---
    const [contextKey, setContextKey] = useState<Key>({ note: 'C', scale: 'Major' });
    const [isKeySignatureActive, setIsKeySignatureActive] = useState(true);
    const [glowingNote, setGlowingNote] = useState<{ noteIndex: number; writtenMidi?: number } | null>(null);
    const glowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // FIX: Add ref and state for measuring staff width.
    const staffContainerRef = useRef<HTMLDivElement>(null);
    const [staffWidth, setStaffWidth] = useState(1000);

    // --- CAGED System State ---
    const [currentShapeIndex, setCurrentShapeIndex] = useState(0);
    const [selectedStringSet, setSelectedStringSet] = useState(STRING_SETS[0]);
    const [isVoicingPlaying, setIsVoicingPlaying] = useState(false);

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

    const allNotes = useMemo((): DisplayNote[] => {
        if (isKeySignatureActive && contextKey) {
            const noteMap = new Map<string, string>();
            const rootNoteIndex = NOTE_NAMES.indexOf(contextKey.note);
            
            const scaleForSpelling: ScaleType = contextKey.scale === 'Major' ? 'Ionian' : 'Aeolian';
            const intervals = SCALE_INTERVALS[scaleForSpelling];
    
            if (intervals && rootNoteIndex !== -1) {
                const rootLetter = contextKey.note.charAt(0);
                const letterNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
                const rootLetterIdx = letterNames.indexOf(rootLetter);
                const sortedLetters = [...letterNames.slice(rootLetterIdx), ...letterNames.slice(0, rootLetterIdx)];
    
                intervals.forEach((interval, i) => {
                    const noteIndex = (rootNoteIndex + interval) % 12;
                    const degreeLetter = sortedLetters[i % sortedLetters.length];
                    const possibleNames = ALL_NOTE_SPELLINGS[noteIndex];
                    const noteName = possibleNames.find(name => name.charAt(0) === degreeLetter) || possibleNames[0];
                    noteMap.set(noteIndex.toString(), noteName);
                });
            }
            
            const useFlatsForChromatics = enharmonicPreference === 'flat';
            
            return CHROMATIC_SCALE.map((note, index) => {
                const isEnharmonic = note.sharp !== note.flat;
                let name: string;
                
                if (noteMap.has(index.toString())) {
                    name = noteMap.get(index.toString())!;
                } else {
                    name = useFlatsForChromatics ? note.flat : note.sharp;
                }
    
                return { ...note, name, isEnharmonic, originalIndex: index };
            });
        }
    
        return CHROMATIC_SCALE.map((note, index) => {
            const isEnharmonic = note.sharp !== note.flat;
            const name = enharmonicPreference === 'sharp' ? note.sharp : note.flat;
            return { ...note, name, isEnharmonic, originalIndex: index };
        });
    }, [enharmonicPreference, contextKey, isKeySignatureActive]);
    
    const rootNote = useMemo(() => allNotes[rootNoteIndex], [allNotes, rootNoteIndex]);
    
    const chordNotes = useMemo((): DisplayNote[] => {
        const formula = allChordFormulas[activeChordType];
        if (!formula) return [];
        return formula.map(interval => {
            const noteIndex = (rootNoteIndex + interval) % 12;
            return allNotes[noteIndex];
        });
    }, [rootNoteIndex, activeChordType, allNotes, allChordFormulas]);

        const activeChordColor = useMemo(() => {
            return customChords.find(c => c.name === activeChordType)?.color || CHORD_RGB_COLORS[activeChordType] || 'rgb(250, 204, 21)';
        }, [customChords, activeChordType]);

     const chordNoteIndices = useMemo(() => new Set(chordNotes.map(n => n.originalIndex)), [chordNotes]);

    const allVoicings = useMemo(() => {
        const builtIn = getGuitarVoicings(rootNote.originalIndex, activeChordType) || [];
        const saved = customVoicings
            .filter(v => v.chordType === activeChordType)
            .map(v => {
                const deltaBase = rootNote.originalIndex - v.rootNoteIndex;
                return {
                    name: v.name,
                    voicing: pickBestTransposition(v.voicing, deltaBase),
                };
            });
        const merged = [...builtIn, ...saved];
        return merged.length > 0 ? merged : null;
    }, [rootNote, activeChordType, customVoicings]);

    const hasStringSets = useMemo(() => {
        if (!allVoicings) return false;
        return allVoicings.some(v => STRING_SETS.some(set => v.name.includes(`(${set})`)));
    }, [allVoicings]);

    const filteredVoicings = useMemo(() => {
        if (!allVoicings) return [];
        if (!hasStringSets) return allVoicings;
        return allVoicings.filter(v => v.name.includes(`(${selectedStringSet})`));
    }, [allVoicings, selectedStringSet, hasStringSets]);

    const currentVoicing: CagedVoicing | null = useMemo(() => {
        if (!filteredVoicings || filteredVoicings.length === 0 || currentShapeIndex >= filteredVoicings.length) {
            return null;
        }
        return filteredVoicings[currentShapeIndex];
    }, [filteredVoicings, currentShapeIndex]);

    const { staffNotesForScale, blockChordStaffNotes, keySignature, blockChordColor } = useMemo(() => {
        const contextScaleForStaff: ScaleType = contextKey.scale === 'Major' ? 'Ionian' : 'Aeolian';
    
        const displayKeySignature: KeySignature = isKeySignatureActive
            ? getKeySignature(contextKey.note, contextKey.scale)
            : { type: 'sharp', count: 0 };
    
            const chordColor = activeChordColor;
        const harmonyNoteColor = 'white';
        const scaleOnlyNoteColor = 'rgb(107, 114, 128)';
    
        const blockNotes = currentVoicing ? getVoicingAsStaffNotes(currentVoicing.voicing, displayKeySignature, allNotes) : [];
        const highestVoicingMidi = blockNotes.length > 0 ? Math.max(...blockNotes.map(n => n.midi)) : 0;
        
        const lowestWrittenVoicingMidi = blockNotes.length > 0 ? Math.min(...blockNotes.map(n => n.midi)) : undefined;
        const lowestSoundingVoicingMidi = lowestWrittenVoicingMidi ? lowestWrittenVoicingMidi - 12 : undefined;
    
        const baseScaleNotes = getScaleAsNoteObjects(contextKey.note, contextKey.scale, contextScaleForStaff, displayKeySignature, null, undefined, highestVoicingMidi, lowestSoundingVoicingMidi);
        const baseScaleNoteIndices = new Set(baseScaleNotes.map(n => n.noteIndex));
    
        const alterationMap = new Map<number, DisplayNote>();
        chordNotes.forEach(chordNote => {
            if (baseScaleNoteIndices.has(chordNote.originalIndex)) return;
            let closestNote: StaffNote | null = null;
            let minDistance = 12;
            for (const scaleNote of baseScaleNotes) {
                const distance = Math.abs(scaleNote.noteIndex - chordNote.originalIndex);
                const circularDistance = Math.min(distance, 12 - distance);
                if (circularDistance < minDistance) {
                    minDistance = circularDistance;
                    closestNote = scaleNote;
                }
            }
            if (closestNote) {
                alterationMap.set(closestNote.noteIndex, chordNote);
            }
        });
    
        const getNotePosition = (pitch: string, octave: number): number => {
            const NOTE_PITCH_TO_POSITION: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
            return NOTE_PITCH_TO_POSITION[pitch] + (octave - 4) * 7;
        };
    
        const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, displayKeySignature.type === 'sharp' ? displayKeySignature.count : 0);
        const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, displayKeySignature.type === 'flat' ? displayKeySignature.count : 0);
        const keyAccidentals = displayKeySignature.type === 'sharp'
            ? sharpNotes.map(n => n + '#')
            : flatNotes.map(n => n + 'b');
    
        const alteredScaleStaffNotes = baseScaleNotes.map(originalScaleNote => {
            if (!alterationMap.has(originalScaleNote.noteIndex)) {
                return originalScaleNote;
            }
    
            const alteredNoteInfo = alterationMap.get(originalScaleNote.noteIndex)!;
            
            const semitoneDiff = (alteredNoteInfo.originalIndex - originalScaleNote.noteIndex + 12) % 12;
            const newWrittenMidi = originalScaleNote.midi + (semitoneDiff > 6 ? semitoneDiff - 12 : semitoneDiff);

            const newNoteName = alteredNoteInfo.name;
            const newPitch = newNoteName.charAt(0);
            const newOctave = Math.floor(newWrittenMidi / 12) - 1;
            const newPosition = getNotePosition(newPitch, newOctave);
    
            const explicitAccidental = calculateAccidental(newNoteName, keyAccidentals);
    
            return {
                id: originalScaleNote.id,
                pitch: newPitch,
                octave: newOctave,
                position: newPosition,
                midi: newWrittenMidi,
                noteIndex: alteredNoteInfo.originalIndex,
                explicitAccidental: explicitAccidental,
            };
        });
    
        const voicingNoteMidiSet = new Set(blockNotes.map(note => note.midi));
    
        const coloredAlteredScaleNotes = alteredScaleStaffNotes.map(note => {
            let color: string | undefined = scaleOnlyNoteColor;
            if (voicingNoteMidiSet.has(note.midi)) {
                color = chordColor;
            } else if (chordNoteIndices.has(note.noteIndex)) {
                color = harmonyNoteColor;
            }
            return { ...note, color };
        });

        const clefWidth = 60;
        const keySignatureWidth = displayKeySignature.count * 15;
        const padding = 40;
        const chordStartX = clefWidth + keySignatureWidth + padding;
        const scaleStartX = chordStartX + 60;

        const blockChordNotesWithPosition = blockNotes.map(note => ({
            ...note,
            xPosition: chordStartX,
        }));

        const scaleNotesWithPosition = coloredAlteredScaleNotes.map((note, index) => ({
            ...note,
            xPosition: scaleStartX + index * 35,
        }));
    
        return {
            staffNotesForScale: scaleNotesWithPosition,
            blockChordStaffNotes: blockChordNotesWithPosition,
            keySignature: displayKeySignature,
            blockChordColor: chordColor
        };
    }, [contextKey, chordNotes, chordNoteIndices, allNotes, currentVoicing, activeChordType, isKeySignatureActive]);


    const handleInteraction = useCallback(async (data: {
        noteIndex: number,
        midi?: number,
        source: 'circle' | 'fretboard' | 'staff'
    }) => {
        if (glowTimeoutRef.current) clearTimeout(glowTimeoutRef.current);
        
        await audioService.ensureAudioIsReady();

        let writtenMidi: number | undefined;
        let soundingMidi: number | undefined;

        if (data.source === 'staff' && data.midi) {
            writtenMidi = data.midi;
            soundingMidi = writtenMidi - 12;
        } else if (data.source === 'fretboard' && data.midi) {
            soundingMidi = data.midi;
            writtenMidi = soundingMidi + 12;
        }

        setGlowingNote({ noteIndex: data.noteIndex, writtenMidi });

        if (isAudioReady) {
            let audioFile: string | null = null;
            if (soundingMidi !== undefined) {
                 const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
                 const octave = Math.floor(soundingMidi / 12) - 1;
                 const noteName = noteNamesWithFlats[soundingMidi % 12];
                 audioFile = `${noteName}${octave}`;
            } else {
                audioFile = CHROMATIC_SCALE[data.noteIndex].audioFile;
            }

            if(audioFile) {
               await audioService.playNote(audioFile, { duration: 1.5 });
            }
        }
        
        glowTimeoutRef.current = setTimeout(() => {
            setGlowingNote(null);
        }, 1500);
    }, [isAudioReady, audioService]);


    useEffect(() => {
        setCurrentShapeIndex(0);
        if (hasStringSets && allVoicings && allVoicings.length > 0) {
            const currentSetHasVoicings = allVoicings.some(v => v.name.includes(`(${selectedStringSet})`));
            if (!currentSetHasVoicings) {
                const firstAvailableSet = STRING_SETS.find(set => 
                    allVoicings.some(v => v.name.includes(`(${set})`))
                );
                if (firstAvailableSet) {
                    setSelectedStringSet(firstAvailableSet);
                }
            }
        }
    }, [rootNote, activeChordType, allVoicings, hasStringSets, selectedStringSet]);

    const handleNextVoicing = useCallback(() => {
        if (!filteredVoicings || filteredVoicings.length === 0) return;
        setCurrentShapeIndex((prev) => (prev + 1) % filteredVoicings.length);
    }, [filteredVoicings]);

    const handlePrevVoicing = useCallback(() => {
        if (!filteredVoicings || filteredVoicings.length === 0) return;
        setCurrentShapeIndex((prev) => (prev - 1 + filteredVoicings.length) % filteredVoicings.length);
    }, [filteredVoicings]);

    const handlePlayVoicing = useCallback(async () => {
        if (!currentVoicing || !isAudioReady || isVoicingPlaying) return;
        setIsVoicingPlaying(true);
        try {
            await audioService.ensureAudioIsReady();
            const openStringMidiNotes = [40, 45, 50, 55, 59, 64];
            const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
            const voicing = currentVoicing.voicing;
            const noteAudioFiles = voicing
                .map((fret, stringIndex) => {
                    if (fret === -1) return null;
                    const midiNote = openStringMidiNotes[stringIndex] + fret;
                    if (midiNote < 21 || midiNote > 108) return null;
                    const noteName = noteNames[midiNote % 12];
                    const octave = Math.floor(midiNote / 12) - 1;
                    return `${noteName}${octave}`;
                })
                .filter((file): file is string => file !== null);
            await audioService.playGuitarVoicing(noteAudioFiles);
        } catch (error) {
            // errore silenziato
        } finally {
            setIsVoicingPlaying(false);
        }
    }, [currentVoicing, isAudioReady, isVoicingPlaying, audioService]);

    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
          if(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
          switch (e.key) {
            case 'ArrowRight': e.preventDefault(); handleNextVoicing(); break;
            case 'ArrowLeft': e.preventDefault(); handlePrevVoicing(); break;
            case 'ArrowDown':
              if (hasStringSets) {
                e.preventDefault();
                const currentIndex = STRING_SETS.indexOf(selectedStringSet);
                const nextIndex = (currentIndex + 1) % STRING_SETS.length;
                setSelectedStringSet(STRING_SETS[nextIndex]);
              }
              break;
            case 'ArrowUp':
              if (hasStringSets) {
                e.preventDefault();
                const currentIndex = STRING_SETS.indexOf(selectedStringSet);
                const prevIndex = (currentIndex - 1 + STRING_SETS.length) % STRING_SETS.length;
                setSelectedStringSet(STRING_SETS[prevIndex]);
              }
              break;
            default: break;
          }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isActive, selectedStringSet, handleNextVoicing, handlePrevVoicing, hasStringSets]);


    const handleRootNoteSelect = useCallback(async (noteIndex: number) => {
        setRootNoteIndex(noteIndex);
        await handleInteraction({ noteIndex, source: 'circle' });
    }, [handleInteraction]);

    const handlePlayChord = useCallback(async () => {
        if (isAudioReady) {
            await audioService.ensureAudioIsReady();
            if (!audioService.audioContext) return;
            const audioFiles = chordNotes.map(note => note.audioFile);
            await audioService.playChord(audioFiles, { when: audioService.audioContext.currentTime, duration: 1.5 });
        }
    }, [isAudioReady, chordNotes, audioService]);
    
    const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <div className="w-full flex flex-col gap-4 interactive-selection pb-4" onClick={stopPropagation}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                <div className="lg:flex lg:justify-end w-full">
                    <ChordControls
                        activeChordType={activeChordType}
                        onChordTypeChange={setActiveChordType}
                        onPlayChord={handlePlayChord}
                        enharmonicPreference={enharmonicPreference}
                        onEnharmonicChange={setEnharmonicPreference}
                    />
                </div>
                <div className="w-full flex justify-center">
                    <ChordCircle
                        rootNote={rootNote}
                        chordNotes={chordNotes}
                        allNotes={allNotes}
                        onNoteClick={handleRootNoteSelect}
                        activeChordType={activeChordType}
                        activeChordColor={activeChordColor}
                        enharmonicPreference={enharmonicPreference}
                        glowingNoteIndex={glowingNote?.noteIndex ?? null}
                    />
                </div>
                <div className="lg:flex lg:justify-start w-full">
                    <CagedSystem
                        rootNote={rootNote}
                        activeChordType={activeChordType}
                        allVoicings={allVoicings}
                        filteredVoicings={filteredVoicings}
                        hasStringSets={hasStringSets}
                        selectedStringSet={selectedStringSet}
                        onSetSelectedStringSet={setSelectedStringSet}
                        currentShapeIndex={currentShapeIndex}
                        onNext={handleNextVoicing}
                        onPrev={handlePrevVoicing}
                        onPlayVoicing={handlePlayVoicing}
                        isVoicingPlaying={isVoicingPlaying}
                    />
                </div>
            </div>
            
            {/* FIX: Add ref to measure container width */}
            <div ref={staffContainerRef} className="w-full mt-1">
                 <div className="bg-gray-800/50 rounded-t-lg py-1 px-2">
                    <div className="flex flex-wrap gap-x-2 gap-y-1 justify-center items-center">
                        <h3 className="text-sm font-bold text-center">Pentagramma:</h3>
                         <div className="flex gap-2 items-center">
                            <button
                                onClick={() => setIsKeySignatureActive(prev => !prev)}
                                className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-all duration-200 ${isKeySignatureActive ? 'bg-blue-500 text-white shadow' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                                aria-pressed={isKeySignatureActive}
                            >
                                Tonalità
                            </button>
                             <div className={`flex gap-2 items-center transition-opacity ${!isKeySignatureActive ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <select
                                    id="context-key-note"
                                    value={contextKey.note}
                                    onChange={e => setContextKey(k => ({ ...k, note: e.target.value }))}
                                    className="bg-gray-700 border border-gray-600 rounded-md p-0.5 text-xs disabled:bg-gray-700/50"
                                    disabled={!isKeySignatureActive}
                                    aria-label="Nota Tonalità"
                                >
                                    {NOTE_NAMES.map(note => <option key={note} value={note}>{allNotes[NOTE_NAMES.indexOf(note)].name}</option>)}
                                </select>
                                <select
                                    id="context-key-scale"
                                    value={contextKey.scale}
                                    onChange={e => setContextKey(k => ({ ...k, scale: e.target.value as 'Major' | 'Minor' }))}
                                    className="bg-gray-700 border border-gray-600 rounded-md p-0.5 text-xs disabled:bg-gray-700/50"
                                    disabled={!isKeySignatureActive}
                                    aria-label="Qualità Tonalità"
                                >
                                    <option value="Major">Maggiore</option>
                                    <option value="Minor">Minore</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <Staff
                    notes={staffNotesForScale}
                    blockChordNotes={blockChordStaffNotes}
                    blockChordColor={blockChordColor}
                    keySignature={keySignature}
                    glowingNoteMidi={glowingNote?.writtenMidi ?? null}
                    onNoteInteraction={(noteData) => handleInteraction({ ...noteData, source: 'staff', noteIndex: noteData.noteIndex })}
                    containerClassName="bg-gray-800/50 rounded-b-lg px-4 w-full overflow-hidden min-h-[160px]"
                    // FIX: Pass the measured width to the Staff component.
                    width={staffWidth}
                />
            </div>
            
             <div className="text-center my-1">
                <h2 className={`text-xl font-semibold tracking-wide ${CHORD_TEXT_COLORS[activeChordType] || 'text-yellow-400'}`}>
                    {rootNote.name} {activeChordType}
                </h2>
            </div>

            <div className="w-full">
                {currentVoicing ? (
                    <ChordFretboard
                        voicing={currentVoicing.voicing}
                        rootNoteName={rootNote.name}
                        activeChordType={activeChordType}
                        activeChordColor={activeChordColor}
                        glowingNoteMidi={glowingNote?.writtenMidi ? glowingNote.writtenMidi - 12 : null}
                        onNoteInteraction={(data) => handleInteraction({ ...data, source: 'fretboard' })}
                        allNotes={allNotes}
                    />
                ) : (
                    <div className="text-center p-8 bg-gray-800/50 rounded-lg min-h-[250px] flex items-center justify-center">
                        <p className="text-gray-400">Nessun voicing disponibile per questo tipo di accordo o set di corde.</p>
                    </div>
                )}
            </div>

        </div>
    );
};

export default ChordVisualizer;