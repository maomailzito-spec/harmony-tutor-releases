import React from 'react';
import { ScaleNoteDefinition, RootType } from '../types';

const FRET_COUNT = 18;
const GUITAR_TUNING_NAMES = ['E', 'B', 'G', 'D', 'A', 'E'];

interface EditorFretboardProps {
    notes: ScaleNoteDefinition[];
    draggedNote: ScaleNoteDefinition | null;
    onNoteClick: (s: number, f: number, e: React.MouseEvent) => void;
    onRemoveNote: (s: number, f: number) => void;
    onDragStart: (note: ScaleNoteDefinition) => void;
    onDrop: (s: number, f: number) => void;
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

const EditorFretboard: React.FC<EditorFretboardProps> = ({ 
    notes, 
    draggedNote,
    onNoteClick, 
    onRemoveNote, 
    onDragStart, 
    onDrop 
}) => {

  const noteMap = new Map<string, ScaleNoteDefinition>();
  notes.forEach(note => noteMap.set(`${note.s}-${note.f}`, note));

  return (
    <div className="bg-gray-800 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] pt-2 pb-4 font-mono">
      <div className="w-full overflow-x-auto">
        <div className="relative px-2" style={{ width: '130.66%' }}>
          {/* Fret Numbers */}
          <div className="flex">
            <div style={{ width: 'calc(4rem + 8px)' }}></div>
            <div className="flex-1 flex">
              {Array.from({ length: FRET_COUNT }).map((_, i) => (
                <div
                  key={`fret-num-${i + 1}`}
                  className="text-center text-xs text-gray-400"
                  style={{ flex: `1 1 ${100 / FRET_COUNT}%` }}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
          
          <div className="relative mt-2 flex h-60 lg:h-40" style={{ background: 'linear-gradient(90deg, #44302b, #301d1c)' }}>
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
                        const f = 0;
                        const note = noteMap.get(`${s}-${f}`);
                        const isDragged = draggedNote?.s === s && draggedNote?.f === f;

                        return (
                            <div 
                                key={`open-string-dot-${s}`}
                                className="w-full h-full flex items-center justify-center cursor-pointer"
                                onClick={(e) => onNoteClick(s, f, e)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    if (note) onRemoveNote(s, f);
                                }}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => onDrop(s, f)}
                            >
                                {note && (
                                    <div 
                                        draggable
                                        onDragStart={() => onDragStart(note)}
                                        className={`w-5 h-5 lg:w-6 lg:h-6 flex items-center justify-center text-white font-bold text-xs rounded-full border-2 transition-opacity ${isDragged ? 'opacity-30' : 'opacity-100'}`}
                                        style={{
                                            backgroundColor: note.t ? (note.t === RootType.Major ? 'rgb(239, 68, 68)' : 'rgb(250, 204, 21)') : 'rgb(59, 130, 246)',
                                            borderColor: 'white'
                                        }}
                                    >
                                        {note.t === RootType.Major ? 'R' : note.t === RootType.Minor ? 'r' : ''}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            
            <div style={{ width: '8px', background: '#f0e6d2' }}></div>

            <div className="relative flex-1 h-full">
                {/* Frets */}
                <div className="absolute top-0 left-0 w-full h-full flex">
                    {Array.from({ length: FRET_COUNT }).map((_, i) => (
                      <div 
                          key={`fret-line-${i + 1}`}
                          className="relative h-full" 
                          style={{ 
                              flex: `1 1 ${100/FRET_COUNT}%`,
                              borderLeft: '3px solid #b0b0b0',
                              boxShadow: 'inset 1px 0 2px rgba(0,0,0,0.5)'
                          }}
                      >
                        <Inlay fret={i+1} />
                      </div>
                    ))}
                </div>

                {/* Strings */}
                <div className="absolute top-0 left-0 w-full h-full z-[1]">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div 
                            key={`string-${i}`} 
                            className="absolute left-0 right-0"
                            style={{ 
                                top: `calc(${(i * (100/6)) + (100/12)}% - ${((i / 2.5) + 1.5)/2}px)`,
                                height: `${(i / 2.7) + 0.7}px`,
                                background: 'linear-gradient(to bottom, #f0f0f0, #a0a0a0)'
                            }}
                        ></div>
                    ))}
                </div>
                
                {/* Note Dots & Interaction Layer */}
                <div className="absolute top-0 left-0 w-full h-full z-[2]">
                  {Array.from({ length: 6 }).flatMap((_, s) =>
                    Array.from({ length: FRET_COUNT + 1 }).map((_, f) => {
                      if (f === 0) return null; 

                      const note = noteMap.get(`${s}-${f}`);
                      const isDragged = draggedNote?.s === s && draggedNote?.f === f;
                      
                      const y = `calc(${(s * (100/6)) + (100/12)}%)`;
                      const x = `calc(${((f - 0.5) / FRET_COUNT) * 100}%)`;

                      return (
                        <div 
                          key={`${s}-${f}`} 
                          className="absolute h-8 lg:h-10 w-[4%] flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                          style={{ top: y, left: x }}
                          onClick={(e) => onNoteClick(s, f, e)}
                          onContextMenu={(e) => {
                              e.preventDefault();
                              if (note) onRemoveNote(s, f);
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => onDrop(s, f)}
                        >
                          {note && (
                            <div 
                                draggable
                                onDragStart={() => onDragStart(note)}
                                className={`w-5 h-5 lg:w-6 lg:h-6 flex items-center justify-center text-white font-bold text-xs rounded-full border-2 transition-opacity ${isDragged ? 'opacity-30' : 'opacity-100'}`}
                                style={{
                                    backgroundColor: note.t ? (note.t === RootType.Major ? 'rgb(239, 68, 68)' : 'rgb(250, 204, 21)') : 'rgb(59, 130, 246)',
                                    borderColor: 'white'
                                }}
                            >
                               {note.t === RootType.Major ? 'R' : note.t === RootType.Minor ? 'r' : ''}
                            </div>
                          )}
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

export default EditorFretboard;