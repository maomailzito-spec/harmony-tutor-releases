import React, { useState } from 'react';
import { ChordType, DisplayNote } from '../types';
// FIX: Added missing constant imports
import { CHORD_DOT_CLASSES, ROOT_NOTE_DOT_CLASSES, GUITAR_TUNING_NAMES, CHORD_RGB_COLORS, GUITAR_TUNING } from '../constants';

const FRET_COUNT = 16;
const STRING_COUNT = 6;
const FRET_MARKERS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_FRET_MARKER = [12, 24];
const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40]; // High E to Low E

const STRING_THICKNESS_PX = [0.8, 1, 1.2, 1.5, 1.8, 2.1]; 

interface ChordFretboardProps {
  voicing: number[];
  rootNoteName: string;
  activeChordType: ChordType;
  glowingNoteMidi: number | null;
  onNoteInteraction: (data: { noteIndex: number, midi: number }) => void;
  allNotes: DisplayNote[];
}

export const ChordFretboard: React.FC<ChordFretboardProps> = ({ voicing, rootNoteName, activeChordType, glowingNoteMidi, onNoteInteraction, allNotes }) => {
  const [hoveredNote, setHoveredNote] = useState<{ stringIndex: number; fret: number } | null>(null);
  const reversedVoicing = [...voicing].reverse();
  const fretsToDisplay = Array.from({ length: FRET_COUNT });
  
  const getNoteName = (stringIndex: number, fret: number): string => {
      if (fret < 0) return '';
      const noteIndex = (GUITAR_TUNING[stringIndex] + fret) % 12;
      return allNotes[noteIndex]?.name || '';
  };

  return (
     <div className="bg-gray-800 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] pt-2 pb-4 font-mono">
      <div className="w-full overflow-x-auto">
        <div className="relative px-2" style={{ width: '100%' }}>
          {/* Fret Numbers */}
          <div className="flex">
            <div style={{ width: 'calc(4rem + 8px)' }}></div> {/* Spacer for tuning names, muted indicators, and nut */}
            <div className="flex-1 flex">
              {fretsToDisplay.map((_, i) => {
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
             <div className="w-16 flex">
                <div className="w-8 flex flex-col justify-around items-center h-40 lg:h-44">
                    {GUITAR_TUNING_NAMES.map((noteName, i) => (
                        <div key={`open-string-${i}`} className="text-center text-lg text-stone-300 font-semibold">
                          {noteName}
                        </div>
                    ))}
                </div>
                <div className="w-8 flex flex-col justify-around items-center h-40 lg:h-44">
                    {reversedVoicing.map((fret, i) => {
                        if (fret === -1) {
                            return <div key={`indicator-${i}`} className="text-center text-lg text-stone-300">x</div>;
                        }
                        if (fret === 0) {
                            const openStringNoteIndex = GUITAR_TUNING[i];
                            const soundingMidi = STRING_BASE_MIDI[i];
                            const isGlowing = soundingMidi === glowingNoteMidi;
                            const isHovered = hoveredNote?.stringIndex === i && hoveredNote?.fret === 0;

                            return (
                                <div key={`indicator-${i}`} 
                                    className="w-full h-full flex items-center justify-center cursor-pointer"
                                    onMouseEnter={() => setHoveredNote({ stringIndex: i, fret: 0 })}
                                    onMouseLeave={() => setHoveredNote(null)}
                                    onClick={() => onNoteInteraction({ noteIndex: openStringNoteIndex, midi: soundingMidi })}
                                >
                                    <div className={`w-6 h-6 lg:w-7 lg:h-7 rounded-full border-2 flex items-center justify-center transition-all ${isGlowing ? 'note-glow-strong scale-125 ring-4 ring-white/80' : ''}`}
                                        style={{ borderColor: CHORD_RGB_COLORS[activeChordType] || 'white' }}
                                    >
                                        {(isHovered || isGlowing) && (
                                            <span className="text-white font-bold text-xs">{getNoteName(i, 0)}</span>
                                        )}
                                    </div>
                                </div>
                            );
                        }
                        return <div key={`indicator-${i}`} className="w-6 h-6 lg:w-7 lg:h-7" />;
                    })}
                </div>
            </div>
            
            <div style={{ width: '8px', background: '#f0e6d2' }}></div>

            <div className="relative flex-1 h-40 lg:h-44">
                {/* Frets */}
                <div className="absolute top-0 left-0 w-full h-full flex">
                    {fretsToDisplay.map((_, i) => {
                        const fret = i + 1;
                        return (
                            <div 
                                key={fret} 
                                className="relative h-full" 
                                style={{ 
                                    flex: `1 1 ${100/FRET_COUNT}%`,
                                    borderLeft: '3px solid #b0b0b0',
                                    boxShadow: 'inset 1px 0 2px rgba(0,0,0,0.5)'
                                }}
                            >
                              {FRET_MARKERS.includes(fret) && <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-3 bg-stone-500/50 rounded-full"></div>}
                              {DOUBLE_FRET_MARKER.includes(fret) && (
                                <>
                                  <div className="absolute top-1/3 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-3 bg-stone-500/50 rounded-full"></div>
                                  <div className="absolute top-2/3 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-3 bg-stone-500/50 rounded-full"></div>
                                </>
                              )}
                            </div>
                        )
                    })}
                </div>

                {/* Strings */}
                <div className="absolute top-0 left-0 w-full h-full z-[1]">
                    {Array.from({ length: STRING_COUNT }).map((_, i) => (
                        <div 
                            key={`string-${i}`} 
                            className="absolute left-0 right-0 bg-neutral-300"
                            style={{ 
                                top: `calc(${(i * (100/STRING_COUNT)) + (100/(STRING_COUNT*2))}% - ${STRING_THICKNESS_PX[i]/2}px)`,
                                height: `${STRING_THICKNESS_PX[i]}px`
                            }}
                        ></div>
                    ))}
                </div>

                {/* Note Dots */}
                <div className="absolute top-0 left-0 w-full h-full z-[2]">
                    {reversedVoicing.map((fret, stringIndex) => {
                        if (fret <= 0) return null;

                        const noteName = getNoteName(stringIndex, fret);
                        const isRoot = noteName === rootNoteName;
                        
                        const openStringNoteIndex = GUITAR_TUNING[stringIndex];
                        const noteIndex = (openStringNoteIndex + fret) % 12;
                        const soundingMidi = STRING_BASE_MIDI[stringIndex] + fret;
                        const isGlowing = soundingMidi === glowingNoteMidi;
                        const isHovered = hoveredNote?.stringIndex === stringIndex && hoveredNote?.fret === fret;
                        
                        const noteColorClasses = isRoot
                            ? ROOT_NOTE_DOT_CLASSES[activeChordType]
                            : CHORD_DOT_CLASSES[activeChordType];
                        
                        const y = `calc(${(stringIndex * (100/STRING_COUNT)) + (100/(STRING_COUNT*2))}%)`;
                        const x = `calc(${((fret - 0.5) / FRET_COUNT) * 100}%)`;
                        
                        return (
                            <div
                                key={`dot-wrapper-${stringIndex}`}
                                className="absolute h-8 lg:h-10 w-[6%] flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                                style={{ top: y, left: x }}
                                onMouseEnter={() => setHoveredNote({ stringIndex, fret })}
                                onMouseLeave={() => setHoveredNote(null)}
                                onClick={() => onNoteInteraction({ noteIndex, midi: soundingMidi })}
                            >
                                <div
                                    className={`w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center font-sans font-semibold border-2 rounded-full shadow-sm 
                                    ${noteColorClasses}
                                    ${isRoot ? 'border-4' : ''}
                                    ${isGlowing ? 'note-glow-strong scale-125 ring-4 ring-white/80' : ''}
                                    `}
                                >
                                    {(isHovered || isGlowing) && (
                                        <span className="text-white font-bold text-xs">{noteName}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};