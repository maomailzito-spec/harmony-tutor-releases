import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { PlacedBox, FretboardNote, RootType, Key, ScaleShape, ScaleType, DisplayNote } from '../types';
// FIX: Replaced NOTE_NAMES_BY_INDEX with ALL_NOTE_SPELLINGS
import { FRET_COUNT, GUITAR_TUNING, GUITAR_TUNING_NAMES, ALL_NOTE_SPELLINGS } from '../constants';
import { AudioService } from '../services/AudioService';

const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40]; // High E to Low E
const STRING_THICKNESSES = [0.8, 1, 1.2, 1.5, 1.8, 2.1];

interface FretboardProps {
  placedBoxes: PlacedBox[];
  // FIX: Changed to Partial to match the type of ALL_SHAPES constant.
  allShapes: Partial<Record<ScaleType, ScaleShape[]>>;
  selectedFret: number | null;
  onSelectFret: (fret: number | null) => void;
  onPlayScaleFromNote: (boxId: string, startNote: { s: number; f: number }) => void;
  selectedKey: Key | null;
  scaleType: ScaleType;
  allNotes: DisplayNote[];
  audioService: AudioService;
  glowingNote: { writtenMidi: number; source: 'fretboard' | 'staff' } | null;
  onNoteInteraction: (note: { s: number; f: number; source: 'fretboard'}) => void;
  activeBoxId: string | null;
  playingScaleBoxId: string | null; // New prop
}

const Inlay: React.FC<{ fret: number }> = ({ fret }) => {
  if (fret === 0) return null;
  const markers = { 3: 1, 5: 1, 7: 1, 9: 1, 12: 2, 15: 1, 17: 1, 19: 1, 21: 1, 24: 2 };
  const markerCount = markers[fret as keyof typeof markers];

  if (!markerCount) return null;

  const inlayClasses = "absolute w-4 h-4 rounded-full z-0 left-1/2 -translate-x-1/2";
  const inlayStyle: React.CSSProperties = {
    background: 'radial-gradient(circle, #a8a29e, #78716c)',
    boxShadow: 'inset 0 0 4px rgba(0,0,0,0.4)',
  };

  if (markerCount === 1) {
    return <div className={inlayClasses} style={{ ...inlayStyle, top: '50%', transform: 'translate(-50%, -50%)' }} />;
  }
  
  if (markerCount === 2) {
    return (
      <>
        <div className={inlayClasses} style={{ ...inlayStyle, top: 'calc(100% / 3 * 1)', transform: 'translate(-50%, -50%)' }} />
        <div className={inlayClasses} style={{ ...inlayStyle, top: 'calc(100% / 3 * 2)', transform: 'translate(-50%, -50%)' }} />
      </>
    );
  }

  return null;
};

const Fretboard: React.FC<FretboardProps> = ({ 
    placedBoxes, 
    allShapes, 
    selectedFret, 
    onSelectFret, 
    onPlayScaleFromNote, 
    selectedKey, 
    scaleType,
    allNotes,
    audioService,
    glowingNote,
    onNoteInteraction,
    activeBoxId,
    playingScaleBoxId
}) => {
  const [hoveredNote, setHoveredNote] = useState<{ string: number; fret: number } | null>(null);
  
  const fretboardLayout = useMemo(() => {
    const layout: FretboardNote[][] = Array(6).fill(null).map(() => Array(FRET_COUNT + 1).fill(null));

    // 1. Base layer of notes
    for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= FRET_COUNT; f++) {
            const openNoteIndex = GUITAR_TUNING[s];
            const noteIndex = (openNoteIndex + f) % 12;
            // FIX: Replaced NOTE_NAMES_BY_INDEX with ALL_NOTE_SPELLINGS
            const noteName = allNotes[noteIndex]?.name || ALL_NOTE_SPELLINGS[noteIndex][0];
            layout[s][f] = { noteName };
        }
    }

    // 2. Overlay shapes
    placedBoxes.forEach(({ id, shapeIndex, fretPosition, scaleType: boxScaleType }) => {
        const shape = allShapes[boxScaleType]?.[shapeIndex];
        if (!shape) return;
        
        shape.notes.forEach(noteDef => {
            const fret = noteDef.f + fretPosition;
            const stringIndex = noteDef.s;
            if (fret >= 0 && fret <= FRET_COUNT && stringIndex >= 0 && stringIndex < 6) {
                const noteInfo = layout[stringIndex][fret];
                noteInfo.pentatonicInfo = {
                    boxId: id,
                    color: shape.color,
                    type: noteDef.t,
                    isAlternate: noteDef.isAlternate,
                };
            }
        });
    });

    return layout;
}, [placedBoxes, allShapes, allNotes]);

  return (
    <div className="bg-gray-800 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] pt-2 font-mono">
      <div className="w-full overflow-x-auto">
        <div className="relative px-2" style={{ width: '166.66%' }}>
          {/* Fret Numbers */}
          <div className="flex">
            <div style={{ width: 'calc(4rem + 8px)' }}></div> {/* Spacer for tuning names and nut */}
            <div className="flex-1 flex">
              {Array.from({ length: FRET_COUNT }).map((_, i) => {
                const fret = i + 1;
                return (
                  <div
                    key={`fret-num-${fret}`}
                    className="text-center text-xs text-gray-400"
                    style={{ flex: `1 1 ${100 / FRET_COUNT}%` }}
                  >
                    {fret}
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Fretboard Structure */}
          <div className="relative mt-2 flex" style={{ background: 'linear-gradient(90deg, #44302b, #301d1c)' }}>
            <div className="w-16 flex h-40 lg:h-44">
                <div className="w-8 flex flex-col justify-around items-center h-full">
                    {GUITAR_TUNING_NAMES.map((noteName, i) => (
                        <div key={`open-string-${i}`} className="text-center text-lg text-stone-300 font-semibold">
                          {noteName}
                        </div>
                    ))}
                </div>
                <div className="w-8 flex flex-col justify-around items-center h-full">
                    {fretboardLayout.map((stringNotes, stringIndex) => {
                        const openStringNote = stringNotes[0];
                        
                        const soundingMidi = STRING_BASE_MIDI[stringIndex] + 0;
                        const writtenMidi = soundingMidi + 12;

                        const isCurrentlyGlowing = glowingNote?.writtenMidi === writtenMidi;
                        let showGlow = false;

                        if (isCurrentlyGlowing) {
                            if (playingScaleBoxId) {
                                // Scale playback mode: only glow if the open string note is part of the playing shape
                                if (openStringNote?.pentatonicInfo?.boxId === playingScaleBoxId) {
                                    showGlow = true;
                                }
                            } else {
                                // Single note mode: glow all occurrences
                                showGlow = true;
                            }
                        }
                        
                        const glowClass = showGlow ? 'note-glow-strong' : '';

                        if (openStringNote?.pentatonicInfo) {
                            const info = openStringNote.pentatonicInfo;
                            const isMinorRoot = info.type === RootType.Minor;
                            const isMajorRoot = info.type === RootType.Major;
                            const isRoot = isMinorRoot || isMajorRoot;
                            const shapeClasses = isRoot ? 'transform rotate-45 rounded-sm' : 'rounded-full';

                             const handleOpenStringClick = () => {
                                onNoteInteraction({ s: stringIndex, f: 0, source: 'fretboard' });
                                if(isMinorRoot || isMajorRoot) {
                                    onPlayScaleFromNote(info.boxId, {s: stringIndex, f: 0});
                                }
                            };

                            let dotColor = info.color;
                            if (scaleType === 'Pentatonic') {
                                if (isMinorRoot) dotColor = 'rgb(239, 68, 68)'; // red-500
                                if (isMajorRoot) dotColor = 'rgb(59, 130, 246)'; // blue-500
                            }

                            return (
                                <div
                                    key={`indicator-${stringIndex}`}
                                    className={`w-6 h-6 lg:w-7 lg:h-7 border-2 flex items-center justify-center transition-all cursor-pointer ${shapeClasses} ${glowClass ? 'scale-125 ring-4 ring-white/80' : ''} ${glowClass}`}
                                    style={{ borderColor: dotColor, backgroundColor: dotColor }}
                                    onClick={handleOpenStringClick}
                                >
                                </div>
                            );
                        }
                        if (glowClass) {
                             return (
                                <div key={`indicator-${stringIndex}`}
                                     className={`w-6 h-6 lg:w-7 lg:h-7 rounded-full bg-white/50 ${glowClass}`}>
                                </div>
                             );
                        }

                        return <div key={`indicator-${stringIndex}`} className="w-6 h-6 lg:w-7 lg:h-7" />;
                    })}
                </div>
            </div>
            
            <div style={{ width: '8px', background: '#f0e6d2' }}></div>

            <div className="relative flex-1 h-40 lg:h-44">
                {/* Frets */}
                <div className="absolute top-0 left-0 w-full h-full flex">
                    {Array.from({ length: FRET_COUNT }).map((_, i) => {
                      const fret = i + 1;
                      return (
                        <div 
                            key={`fret-line-${fret}`}
                            className="relative h-full" 
                            style={{ 
                                flex: `1 1 ${100/FRET_COUNT}%`,
                                borderLeft: '3px solid #b0b0b0',
                                boxShadow: 'inset 1px 0 2px rgba(0,0,0,0.5)'
                            }}
                        >
                          <Inlay fret={fret} />
                        </div>
                      )
                    })}
                </div>

                {/* Strings */}
                <div className="absolute top-0 left-0 w-full h-full z-[1]">
                    {Array.from({ length: 6 }).map((_, i) => {
                        const thickness = STRING_THICKNESSES[i];
                        return (
                            <div 
                                key={`string-${i}`} 
                                className="absolute left-0 right-0"
                                style={{ 
                                    top: `calc(${(i * (100 / 6)) + (100 / 12)}% - ${thickness / 2}px)`,
                                    height: `${thickness}px`,
                                    background: 'linear-gradient(to bottom, #f0f0f0, #a0a0a0)'
                                }}
                            ></div>
                        );
                    })}
                </div>
                
                {/* Note Dots */}
                <div className="absolute top-0 left-0 w-full h-full z-[2]">
                  {fretboardLayout.flatMap((stringNotes, stringIndex) =>
                    stringNotes.map((noteInfo, fret) => {
                      if (fret === 0) return null; // Don't render dots on the nut
                      
                      const isHovered = hoveredNote?.string === stringIndex && hoveredNote?.fret === fret;
                      
                      const pentatonicRootType = noteInfo.pentatonicInfo?.type;
                      const isPentatonicMinorRoot = pentatonicRootType === RootType.Minor;
                      const isPentatonicMajorRoot = pentatonicRootType === RootType.Major;
                      const isRootForPlayback = isPentatonicMinorRoot || isPentatonicMajorRoot;

                      const hasPentatonicInfo = !!noteInfo.pentatonicInfo;
                      
                      const soundingMidi = STRING_BASE_MIDI[stringIndex] + fret;
                      const writtenMidi = soundingMidi + 12;
                      
                      const isCurrentlyGlowing = glowingNote?.writtenMidi === writtenMidi;
                      let showGlow = false;

                      if (isCurrentlyGlowing) {
                          if (playingScaleBoxId) {
                              // Scale playback mode: only glow if the note belongs to the playing shape
                              if (noteInfo.pentatonicInfo?.boxId === playingScaleBoxId) {
                                  showGlow = true;
                              }
                          } else {
                              // Single note mode: glow all occurrences
                              showGlow = true;
                          }
                      }
                      
                      const glowClass = showGlow ? 'note-glow-strong' : '';
                      
                      const handleNoteClick = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        onNoteInteraction({ s: stringIndex, f: fret, source: 'fretboard' });
                        if (noteInfo.pentatonicInfo && isRootForPlayback) {
                          onPlayScaleFromNote(noteInfo.pentatonicInfo.boxId, { s: stringIndex, f: fret });
                        }
                      };

                      const y = `calc(${(stringIndex * (100 / 6)) + (100 / 12)}%)`;
                      const x = `calc(${((fret - 0.5) / FRET_COUNT) * 100}%)`;

                      return (
                        <div 
                          key={`${stringIndex}-${fret}`} 
                          className="absolute h-8 lg:h-10 w-[4%] flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2"
                          style={{ top: y, left: x }}
                          onMouseEnter={() => setHoveredNote({ string: stringIndex, fret })}
                          onMouseLeave={() => setHoveredNote(null)}
                          onClick={(e) => {
                            if (!hasPentatonicInfo && !selectedKey) {
                              onSelectFret(selectedFret === fret ? null : fret);
                            } else {
                              handleNoteClick(e);
                            }
                          }}
                        >
                          {noteInfo.pentatonicInfo ? (
                            (() => {
                                let dotColor = noteInfo.pentatonicInfo.color;
                                if (scaleType === 'Pentatonic') {
                                    if (isPentatonicMinorRoot) dotColor = 'rgb(239, 68, 68)'; // red-500
                                    if (isPentatonicMajorRoot) dotColor = 'rgb(59, 130, 246)'; // blue-500
                                }
                                const isRoot = isPentatonicMinorRoot || isPentatonicMajorRoot;
                                const shapeClasses = isRoot ? 'transform rotate-45 rounded-sm' : 'rounded-full';

                                return (
                                    <div 
                                      className={`w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center transition-all duration-150 border-2 ${shapeClasses} ${glowClass ? 'scale-125 ring-4 ring-white/80' : 'border-white/40'} ${isRootForPlayback ? 'cursor-pointer' : 'cursor-default'} ${noteInfo.pentatonicInfo.isAlternate ? 'opacity-60' : ''} ${glowClass}`}
                                      style={{ backgroundColor: dotColor }}
                                      title={noteInfo.noteName + (isPentatonicMinorRoot ? ' (Minor Root)' : isPentatonicMajorRoot ? ' (Major Root)' : '')}
                                    >
                                      {(isHovered || !!glowClass) && (
                                        <span className={`block text-white font-bold text-xs ${isRoot ? 'transform -rotate-45' : ''}`}>
                                            {noteInfo.noteName}
                                        </span>
                                      )}
                                    </div>
                                );
                            })()
                          ) : (
                             (isHovered && !selectedKey) || showGlow ? (
                              <div 
                                className={`w-6 h-6 lg:w-7 lg:h-7 rounded-full flex items-center justify-center bg-gray-500 text-gray-100 text-sm font-semibold cursor-pointer ${glowClass}`}
                                onClick={(e) => { e.stopPropagation(); onSelectFret(selectedFret === fret ? null : fret)}}
                              >
                                {noteInfo.noteName}
                              </div>
                             ) : null
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Selected Fret Highlight */}
                {selectedFret !== null && !selectedKey && (
                  <div
                    className="absolute top-0 bottom-0 bg-blue-500/20 pointer-events-none z-[1]"
                    style={{
                      left: `calc(${((selectedFret - 1) / FRET_COUNT) * 100}%)`,
                      width: `calc(100% / ${FRET_COUNT})`,
                      borderLeft: '2px solid rgb(59 130 246)',
                      borderRight: '2px solid rgb(59 130 246)',
                    }}
                  />
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Fretboard;