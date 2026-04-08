
import React from 'react';
import { ScaleNoteDefinition } from '../../types';

interface ShapeIconProps {
  notes: ScaleNoteDefinition[];
  color: string;
}

const ShapeIcon: React.FC<ShapeIconProps> = ({ notes, color }) => {
  if (notes.length === 0) {
    return (
        <svg 
            viewBox="0 0 42 38" 
            className="w-6 h-4"
            aria-hidden="true"
        />
    );
  }
  // Find the fret range to display
  const fretOffsets = notes.map(n => n.f);
  const minFret = Math.min(...fretOffsets);
  const maxFret = Math.max(...fretOffsets);
  const fretSpan = maxFret - minFret + 1;

  // SVG dimensions
  const viewboxWidth = fretSpan * 10 + 2;
  const viewboxHeight = 5 * 8 + 6;
  const stringSpacing = 8;
  const fretSpacing = 10;
  const xOffset = 1;
  const yOffset = 3;

  return (
    <svg 
        viewBox={`0 0 ${viewboxWidth} ${viewboxHeight}`} 
        className="w-6 h-4"
        aria-hidden="true"
    >
      {/* Strings */}
      {Array.from({ length: 6 }).map((_, i) => (
        <line
          key={`string-${i}`}
          x1={xOffset}
          y1={yOffset + i * stringSpacing}
          x2={viewboxWidth - xOffset}
          y2={yOffset + i * stringSpacing}
          stroke="#6b7280" // gray-500
          strokeWidth="0.75"
        />
      ))}
      
      {/* Notes */}
      {notes.map((note, i) => {
        const cx = xOffset + (note.f - minFret) * fretSpacing;
        const cy = yOffset + note.s * stringSpacing;
        return (
          <circle
            key={`note-${i}`}
            cx={cx}
            cy={cy}
            r="3"
            fill={color.replace('0.75', '1')}
            stroke="white"
            strokeWidth="0.5"
          />
        );
      })}
    </svg>
  );
};

export default ShapeIcon;