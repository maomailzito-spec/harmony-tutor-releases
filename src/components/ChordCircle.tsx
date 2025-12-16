import React, { useMemo } from 'react';
// FIX: Replaced `ChordType` with `BuiltInChords` for value access.
import { ChordType, DisplayNote, EnharmonicPreference, BuiltInChords } from '../types';
// FIX: Imported missing styling constants.
import { CHORD_COLORS, CHORD_DOT_CLASSES, ROOT_NOTE_DOT_CLASSES, CHORD_TEXT_COLORS } from '../constants';

interface ChordCircleProps {
  rootNote: DisplayNote;
  chordNotes: DisplayNote[];
  allNotes: DisplayNote[];
  onNoteClick: (noteIndex: number) => void;
  activeChordType: ChordType;
  enharmonicPreference: EnharmonicPreference;
  glowingNoteIndex: number | null;
}

const getCoordinatesForAnglePercent = (angle: number, rPercent: number) => {
  const x = 50 + rPercent * Math.cos(angle - Math.PI / 2);
  const y = 50 + rPercent * Math.sin(angle - Math.PI / 2);
  return { x, y };
};

const shadowColors: Partial<Record<ChordType, string>> = Object.fromEntries(
    Object.entries(CHORD_TEXT_COLORS).map(([key, value]) => [
        key,
        // FIX: Added explicit type cast to string to fix 'unknown' type error before imports were fixed.
        `${(value as string).replace('text-', 'shadow-')}/30`
    ])
) as Record<ChordType, string>;

export const ChordCircle: React.FC<ChordCircleProps> = ({ 
  rootNote, 
  chordNotes, 
  allNotes, 
  onNoteClick, 
  activeChordType,
  enharmonicPreference,
  glowingNoteIndex
}) => {
  
  const chordNoteIndices = useMemo(() => new Set(chordNotes.map(n => n.originalIndex)), [chordNotes]);

  const shapePoints = useMemo(() => {
    return chordNotes.map(note => {
      const noteIndex = note.originalIndex;
      const angle = (noteIndex / 12) * 2 * Math.PI;
      const { x, y } = getCoordinatesForAnglePercent(angle, 40); // 40% radius
      return `${x},${y}`;
    }).join(' ');
  }, [chordNotes]);

  return (
    <div className="w-full max-w-sm aspect-square relative">
      <div
        className="absolute inset-0 [container-type:inline-size]"
      >
        <div className="absolute w-full h-full rounded-full bg-gray-800 border-4 border-gray-700"></div>

        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          className="absolute"
        >
          <polygon
            points={shapePoints}
            className={`${CHORD_COLORS[activeChordType]} stroke transition-all duration-500 ease-in-out`}
            strokeWidth="0.5"
          />
        </svg>
        
        {allNotes.map((note) => {
          const angle = (note.originalIndex / 12) * 2 * Math.PI;
          const { x, y } = getCoordinatesForAnglePercent(angle, 42); // 42% radius

          const isRoot = note.originalIndex === rootNote.originalIndex;
          const isChordNote = chordNoteIndices.has(note.originalIndex);
          const isGlowing = note.originalIndex === glowingNoteIndex;

          const getNoteStyleClasses = () => {
              if (isRoot) {
                  return `${ROOT_NOTE_DOT_CLASSES[activeChordType]} shadow-lg ${shadowColors[activeChordType]} z-10 border-4`;
              }
              if (isChordNote) {
                  return CHORD_DOT_CLASSES[activeChordType];
              }
              return 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600 hover:border-gray-500';
          };

          const noteClasses = `absolute flex items-center justify-center cursor-pointer transition-all duration-300 border-2 rounded-full transform -translate-x-1/2 -translate-y-1/2 ${getNoteStyleClasses()} ${isGlowing ? 'ring-4 ring-offset-gray-800 ring-cyan-400' : ''}`;
          
          const getSubtextColor = () => {
              if (isChordNote) {
                  // FIX: Used BuiltInChords for value instead of ChordType type.
                  return activeChordType === BuiltInChords.Major ? 'text-gray-700' : 'text-gray-400';
              }
              return 'text-gray-400';
          }

          return (
            <div
              key={note.audioFile}
              className={noteClasses}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: '13%',
                height: '13%',
              }}
              onClick={() => onNoteClick(note.originalIndex)}
            >
              <div 
                className="flex flex-col items-center justify-center leading-tight"
                style={{ fontSize: 'clamp(0.7rem, 3.5cqw, 1.1rem)'}}
              >
                {note.isEnharmonic ? (
                    enharmonicPreference === 'sharp' ? (
                        <>
                            <span className="font-semibold">{note.sharp}</span>
                            <span className="opacity-70" style={{ fontSize: 'clamp(0.55rem, 2.8cqw, 0.85rem)'}}>{note.flat}</span>
                        </>
                    ) : (
                        <>
                            <span className="font-semibold">{note.flat}</span>
                            <span className="opacity-70" style={{ fontSize: 'clamp(0.55rem, 2.8cqw, 0.85rem)'}}>{note.sharp}</span>
                        </>
                    )
                ) : (
                  <span className="font-semibold">{note.name}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};