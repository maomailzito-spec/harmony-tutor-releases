import React, { useMemo } from 'react';
import { DisplayNote, ScaleType } from '../types';

interface ScaleCircleProps {
  rootNoteIndex: number | null;
  scaleNoteIndices: number[];
  allNotes: DisplayNote[];
  onNoteClick: (noteIndex: number) => void;
  scaleType: ScaleType;
}

const getCoordinatesForAnglePercent = (angle: number, rPercent: number) => {
  const x = 50 + rPercent * Math.cos(angle - Math.PI / 2);
  const y = 50 + rPercent * Math.sin(angle - Math.PI / 2);
  return { x, y };
};

export const ScaleCircle: React.FC<ScaleCircleProps> = ({ 
  rootNoteIndex, 
  scaleNoteIndices, 
  allNotes, 
  onNoteClick,
  scaleType
}) => {
  
  const scaleColorSet = useMemo(() => {
    const HARMONIC_MINOR_FAMILY: ScaleType[] = ['Harmonic Minor', 'Locrian #6', 'Ionian #5', 'Dorian #4', 'Phrygian Dominant', 'Lydian #2', 'Altered Dominant bb7'];
    const MELODIC_MINOR_FAMILY: ScaleType[] = ['Melodic Minor', 'Dorian b2', 'Lydian Augmented', 'Lydian Dominant', 'Mixolydian b6', 'Locrian #2', 'Altered Scale'];
    const MAJOR_MODES: ScaleType[] = ['Ionian', 'Lydian', 'Mixolydian'];
    
    let color = 'sky'; // Default for minor modes of major scale
    if (scaleType === 'Pentatonic') color = 'orange';
    else if (MAJOR_MODES.includes(scaleType)) color = 'yellow';
    else if (HARMONIC_MINOR_FAMILY.includes(scaleType)) color = 'purple';
    else if (MELODIC_MINOR_FAMILY.includes(scaleType)) color = 'green';

    const textColor = ['yellow', 'orange', 'green'].includes(color) ? 'text-gray-900' : 'text-white';
    
    return {
        fill: `fill-${color}-400/20`,
        stroke: `stroke-${color}-400`,
        dotBg: `bg-${color}-400`,
        dotBorder: `border-${color}-600`,
        rootDotBorder: `border-stone-200`,
        textColor: textColor
    };
  }, [scaleType]);

  const scaleNoteIndicesSet = useMemo(() => new Set(scaleNoteIndices), [scaleNoteIndices]);

  const shapePoints = useMemo(() => {
    if (scaleNoteIndices.length < 2) return '';
    
    const sortedIndices = [...scaleNoteIndices].sort((a,b) => a-b);

    return sortedIndices.map(noteIndex => {
      const angle = (noteIndex / 12) * 2 * Math.PI;
      const { x, y } = getCoordinatesForAnglePercent(angle, 39); // 37% radius for polygon
      return `${x},${y}`;
    }).join(' ');
  }, [scaleNoteIndices]);

  return (
    <div className="w-full max-w-sm aspect-square relative">
      <div
        className="absolute inset-0 [container-type:inline-size]"
      >
        <div className="absolute w-full h-full rounded-full bg-gray-800 border-2 border-gray-700"></div>

        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          className="absolute"
        >
          <polygon
            points={shapePoints}
            className={`${scaleColorSet.fill} ${scaleColorSet.stroke} stroke transition-all duration-500 ease-in-out`}
            strokeWidth="0.5"
          />
        </svg>
        
        {allNotes.map((note) => {
          const angle = (note.originalIndex / 12) * 2 * Math.PI;
          const { x, y } = getCoordinatesForAnglePercent(angle, 42); // 40% radius for dots

          const isRoot = note.originalIndex === rootNoteIndex;
          const isScaleNote = scaleNoteIndicesSet.has(note.originalIndex);
          
          const getNoteStyleClasses = () => {
              if (isRoot) {
                  return `${scaleColorSet.dotBg} ${scaleColorSet.textColor} ${scaleColorSet.rootDotBorder} shadow-lg z-10 border-4`;
              }
              if (isScaleNote) {
                  return `${scaleColorSet.dotBg} ${scaleColorSet.textColor} ${scaleColorSet.dotBorder}`;
              }
              return 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600 hover:border-gray-500';
          };

          const noteClasses = `absolute flex items-center justify-center cursor-pointer transition-all duration-300 border-2 rounded-full transform -translate-x-1/2 -translate-y-1/2 ${getNoteStyleClasses()}`;
          
          const primaryName = note.name;
          let secondaryName = '';
          if (note.isEnharmonic) {
              secondaryName = primaryName === note.sharp ? note.flat : note.sharp;
          }

          return (
            <div
              key={note.audioFile}
              className={noteClasses}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: '15%',
                height: '15%',
              }}
              onClick={() => onNoteClick(note.originalIndex)}
            >
              <div 
                className="flex flex-col items-center justify-center leading-tight"
                style={{ fontSize: 'clamp(0.7rem, 4cqw, 1rem)'}}
              >
                  <span className="font-semibold">{primaryName}</span>
                  {secondaryName && (
                    <span className="opacity-70" style={{ fontSize: 'clamp(0.6rem, 3.2cqw, 0.8rem)'}}>{secondaryName}</span>
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};