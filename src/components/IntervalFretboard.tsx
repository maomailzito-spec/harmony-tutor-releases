import React, { useCallback, useState } from 'react';
import { DisplayNote, PlacedInterval } from '../types';
import { GUITAR_TUNING, GUITAR_TUNING_NAMES } from '../constants';

interface IntervalFretboardProps {
    placedIntervals: PlacedInterval[];
    pendingRoot: { s: number; f: number } | null;
    activeIntervalId: string | null;
    onNoteInteraction: (s: number, f: number) => void;
    onNoteRightClick: (s: number, f: number) => void;
    allNotes: DisplayNote[];
    glowingMidis: number[] | null;
}

const DISPLAY_FRET_COUNT = 15;
const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40]; // High E to Low E
const STRING_THICKNESSES = [0.8, 1, 1.2, 1.5, 1.8, 2.1];

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


export const IntervalFretboard: React.FC<IntervalFretboardProps> = ({
    placedIntervals,
    pendingRoot,
    activeIntervalId,
    onNoteInteraction,
    onNoteRightClick,
    allNotes,
    glowingMidis,
}) => {
    const [hoveredNote, setHoveredNote] = useState<{ s: number; f: number } | null>(null);

    const getNoteInfo = (s: number, f: number) => {
        const noteIndex = (GUITAR_TUNING[s] + f) % 12;
        const midi = STRING_BASE_MIDI[s] + f;
        const noteDetails = allNotes[noteIndex];

        const isPendingRoot = pendingRoot?.s === s && pendingRoot?.f === f;
        const intervalOnThisFret = placedIntervals.find(iv =>
            (iv.rootNote.s === s && iv.rootNote.f === f) ||
            (iv.targetNote.s === s && iv.targetNote.f === f)
        );

        return {
            noteIndex,
            midi,
            noteDetails,
            isPendingRoot,
            intervalOnThisFret
        };
    };

    return (
        <div className="bg-gray-800 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] pt-2 pb-4 font-mono">
          <div className="w-full overflow-x-auto">
            <div className="relative px-2" style={{ width: '166.66%' }}>
              {/* Fret Numbers */}
              <div className="flex">
                <div style={{ width: 'calc(4rem + 8px)' }}></div>
                <div className="flex-1 flex">
                  {Array.from({ length: DISPLAY_FRET_COUNT }).map((_, i) => (
                    <div key={`fret-num-${i + 1}`} className="text-center text-xs text-gray-400" style={{ flex: `1 1 ${100/DISPLAY_FRET_COUNT}%` }}>
                      {i + 1}
                    </div>
                  ))}
                </div>
              </div>
    
              {/* Fretboard Structure */}
              <div className="relative mt-2 flex h-40 lg:h-44" style={{ background: 'linear-gradient(90deg, #44302b, #301d1c)' }}>
                <div className="w-16 flex">
                    <div className="w-8 flex flex-col justify-around items-center h-full">
                        {GUITAR_TUNING_NAMES.map((noteName, i) => (
                            <div key={`open-string-${i}`} className="text-center text-lg text-stone-300 font-semibold">
                              {noteName}
                            </div>
                        ))}
                    </div>
                     <div className="w-8 flex flex-col justify-around items-center h-full">
                        {Array.from({ length: 6 }).map((_, s) => {
                           const { midi, isPendingRoot, intervalOnThisFret } = getNoteInfo(s, 0);
                           let indicatorContent = null;
                            if (isPendingRoot) {
                                indicatorContent = <div className="w-6 h-6 lg:w-7 lg:h-7 rounded-sm transform rotate-45 ring-2 ring-offset-2 ring-offset-gray-800 ring-yellow-400 animate-pulse" />;
                            } else if (intervalOnThisFret) {
                                const isRoot = intervalOnThisFret.rootNote.s === s && intervalOnThisFret.rootNote.f === 0;
                                const isActive = intervalOnThisFret.id === activeIntervalId;
                                const isGlowing = glowingMidis?.includes(midi);
                                const glowClass = isGlowing ? 'note-glow-strong' : '';
                                const activeClass = isActive ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-gray-800' : 'border-white/80';


                                if (isRoot) {
                                    indicatorContent = <div className={`w-6 h-6 lg:w-7 lg:h-7 rounded-sm transform rotate-45 flex items-center justify-center bg-blue-600 border-2 text-white font-bold text-xs ${glowClass} ${activeClass}`}><span className="transform -rotate-45">R</span></div>;
                                } else {
                                    indicatorContent = <div className={`w-6 h-6 lg:w-7 lg:h-7 rounded-full border-2 ${glowClass} ${activeClass}`} style={{ backgroundColor: intervalOnThisFret.interval.rgbColor, borderColor: isActive ? 'rgb(250 204 21)' : 'white' }} />;
                                }
                            }
                           
                            return (
                                <div 
                                    key={`indicator-wrapper-${s}`} 
                                    className="w-full h-full flex items-center justify-center cursor-pointer" 
                                    onClick={() => onNoteInteraction(s, 0)}
                                    onContextMenu={(e) => { e.preventDefault(); onNoteRightClick(s, 0); }}
                                >
                                    {indicatorContent}
                                </div>
                            );
                        })}
                    </div>
                </div>
                
                <div style={{ width: '8px', background: '#f0e6d2' }}></div>
    
                <div className="relative flex-1 h-full">
                    {/* Frets */}
                    <div className="absolute top-0 left-0 w-full h-full flex">
                        {Array.from({ length: DISPLAY_FRET_COUNT }).map((_, i) => {
                          const fret = i + 1;
                          return (
                            <div 
                                key={`fret-line-${fret}`}
                                className="relative h-full" 
                                style={{ 
                                    flex: `1 1 ${100/DISPLAY_FRET_COUNT}%`,
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
                        )})}
                    </div>
                    
                    {/* Note Dots & Interaction Layer */}
                    <div className="absolute top-0 left-0 w-full h-full z-[2]">
                      {Array.from({ length: 6 }).flatMap((_, s) =>
                        Array.from({ length: DISPLAY_FRET_COUNT + 1 }).map((_, f) => {
                          if (f === 0) return null;
                          
                          const { noteDetails, midi, isPendingRoot, intervalOnThisFret } = getNoteInfo(s, f);
                          const isHovered = hoveredNote?.s === s && hoveredNote?.f === f;
    
                          const y = `calc(${(s * (100 / 6)) + (100 / 12)}%)`;
                          const x = `calc(${((f - 0.5) / DISPLAY_FRET_COUNT) * 100}%)`;

                          let dot = null;
                            if (isPendingRoot) {
                                dot = <div className="w-6 h-6 lg:w-7 lg:h-7 rounded-sm transform rotate-45 ring-2 ring-offset-2 ring-offset-gray-800 ring-yellow-400 animate-pulse bg-yellow-400/20" />;
                            } else if (intervalOnThisFret) {
                                const isRoot = intervalOnThisFret.rootNote.s === s && intervalOnThisFret.rootNote.f === f;
                                const isActive = intervalOnThisFret.id === activeIntervalId;
                                const isGlowing = glowingMidis?.includes(midi);
                                const glowClass = isGlowing ? 'note-glow-strong' : '';
                                const activeClass = isActive ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-gray-800' : 'border-white/80';

                                if (isRoot) {
                                    dot = <div className={`w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center text-white font-bold transition-all duration-150 rounded-sm transform rotate-45 border-2 bg-blue-600 ${glowClass} ${activeClass}`} title={noteDetails.name}><span className="transform -rotate-45 text-xs">{(isHovered || isGlowing || isActive) ? noteDetails.name : 'R'}</span></div>;
                                } else {
                                     dot = <div className={`w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center text-white font-bold transition-all duration-150 rounded-full border-2 ${glowClass} ${activeClass}`} title={noteDetails.name} style={{ backgroundColor: intervalOnThisFret.interval.rgbColor, borderColor: isActive ? 'rgb(250 204 21)' : 'white' }}><span className="text-xs">{(isHovered || isGlowing || isActive) ? noteDetails.name : ''}</span></div>;
                                }
                            } else if (isHovered) {
                                dot = <div className="w-6 h-6 lg:w-7 lg:h-7 rounded-full flex items-center justify-center bg-gray-500/80 text-gray-100 text-sm font-semibold border-2 border-gray-400">{noteDetails.name}</div>;
                            }
    
                          return (
                            <div 
                              key={`${s}-${f}`} 
                              className="absolute h-8 lg:h-10 w-[4%] flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                              style={{ top: y, left: x }}
                              onMouseEnter={() => setHoveredNote({ s, f })}
                              onMouseLeave={() => setHoveredNote(null)}
                              onClick={() => onNoteInteraction(s, f)}
                              onContextMenu={(e) => { e.preventDefault(); onNoteRightClick(s, f); }}
                            >
                                {dot}
                            </div>
                          );
                        })
                      )}
                    </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
};