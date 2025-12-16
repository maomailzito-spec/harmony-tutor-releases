import React, { useMemo, useCallback } from 'react';
import { Key, DisplayNote, ScaleType } from '../types';
import { CHROMATIC_SCALE } from '../constants';
import { ScaleCircle } from './ScaleCircle';

interface ScaleKeySelectorProps {
  selectedKey: Key | null;
  onKeyChange: (key: Key | null) => void;
  scaleNoteIndices: number[];
  scaleType: ScaleType;
  allNotes: DisplayNote[];
}

const ScaleKeySelector: React.FC<ScaleKeySelectorProps> = ({ selectedKey, onKeyChange, scaleNoteIndices, scaleType, allNotes }) => {

    const handleNoteClick = useCallback((noteIndex: number) => {
        const clickedNote = allNotes.find(n => n.originalIndex === noteIndex);
        if (!clickedNote) return;

        // Use the sharp name as the canonical key name internally
        const keyNoteName = CHROMATIC_SCALE[noteIndex].sharp;

        const newKey: Key = {
            note: keyNoteName,
            scale: selectedKey?.scale || 'Minor', // Default to Minor if no key is set yet
        };

        onKeyChange(newKey);
    }, [selectedKey, onKeyChange, allNotes]);

    const rootNoteIndexForCircle = useMemo(() => {
        if (!selectedKey) return null;
        const index = CHROMATIC_SCALE.findIndex(n => n.sharp === selectedKey.note);
        return index !== -1 ? index : null;
    }, [selectedKey]);

    return (
        <div className="flex flex-col items-center gap-4 w-full">
            <ScaleCircle 
                allNotes={allNotes}
                rootNoteIndex={rootNoteIndexForCircle}
                scaleNoteIndices={scaleNoteIndices}
                onNoteClick={handleNoteClick}
                scaleType={scaleType}
            />
        </div>
    );
};

export default ScaleKeySelector;