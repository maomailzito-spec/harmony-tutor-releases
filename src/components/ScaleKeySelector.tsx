import React, { useMemo, useCallback } from 'react';
import { Key, DisplayNote, ScaleType, EnharmonicMode } from '../types';
import { CHROMATIC_SCALE } from '../constants';
import { ScaleCircle } from './ScaleCircle';
import { getKeySignature } from '../utils/musicTheory';

interface ScaleKeySelectorProps {
  selectedKey: Key | null;
  onKeyChange: (key: Key | null) => void;
  scaleNoteIndices: number[];
  scaleType: ScaleType;
  allNotes: DisplayNote[];
    enharmonicMode: EnharmonicMode;
    keyQuality: 'Major' | 'Minor';
}

const ScaleKeySelector: React.FC<ScaleKeySelectorProps> = ({ selectedKey, onKeyChange, scaleNoteIndices, scaleType, allNotes, enharmonicMode, keyQuality }) => {

    const handleNoteClick = useCallback((noteIndex: number) => {
        const clickedNote = allNotes.find(n => n.originalIndex === noteIndex);
        if (!clickedNote) return;

        const sharpName = CHROMATIC_SCALE[noteIndex].sharp;
        const flatName = CHROMATIC_SCALE[noteIndex].flat;

        // Pick the tonic spelling based on user preference. We also avoid theoretical
        // major keys that this app can't represent with the current key-signature model.
        const avoidTheoreticalSharpMajors = new Set(['A#', 'D#', 'G#']);
        const quality: 'Major' | 'Minor' = keyQuality;

        // If the user clicks again on the currently-selected pitch-class, toggle
        // the enharmonic spelling (sharp <-> flat) ONLY when in Auto.
        // This keeps ♯/♭ buttons fully binding.
        if (selectedKey) {
            const selectedIndex = CHROMATIC_SCALE.findIndex(n => n.sharp === selectedKey.note || n.flat === selectedKey.note);
            if (selectedIndex === noteIndex && sharpName !== flatName) {
                if (enharmonicMode !== 'auto') return;
                let toggled = (selectedKey.note === sharpName) ? flatName : sharpName;
                // Keep the guard against theoretical sharp major keys.
                if (keyQuality === 'Major' && avoidTheoreticalSharpMajors.has(toggled)) {
                    toggled = flatName;
                }
                onKeyChange({ ...selectedKey, note: toggled });
                return;
            }
        }

        let keyNoteName = sharpName;
        if (enharmonicMode === 'flat') {
            keyNoteName = flatName;
        } else if (enharmonicMode === 'sharp') {
            keyNoteName = (quality === 'Major' && avoidTheoreticalSharpMajors.has(sharpName)) ? flatName : sharpName;
        } else {
            // auto
            if (sharpName === flatName) {
                keyNoteName = sharpName;
            } else if (quality === 'Major' && avoidTheoreticalSharpMajors.has(sharpName)) {
                keyNoteName = flatName;
            } else {
                // Choose the spelling that yields fewer accidentals in the key signature.
                const ksSharp = getKeySignature(sharpName, quality);
                const ksFlat = getKeySignature(flatName, quality);
                if (ksFlat.count < ksSharp.count) keyNoteName = flatName;
                else if (ksSharp.count < ksFlat.count) keyNoteName = sharpName;
                else keyNoteName = (ksSharp.type === 'sharp') ? sharpName : flatName;
            }
        }

        const newKey: Key = {
            note: keyNoteName,
            scale: selectedKey?.scale || keyQuality, // Default to the effective quality for this scale type
        };

        onKeyChange(newKey);
    }, [selectedKey, onKeyChange, allNotes, enharmonicMode, keyQuality]);

    const rootNoteIndexForCircle = useMemo(() => {
        if (!selectedKey) return null;
        const index = CHROMATIC_SCALE.findIndex(n => n.sharp === selectedKey.note || n.flat === selectedKey.note);
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