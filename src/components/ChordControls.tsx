import React from 'react';
import { ChordType, EnharmonicPreference, BuiltInChords } from '../types';
import { useCustomData } from './useCustomTypes';

interface ChordControlsProps {
  activeChordType: ChordType;
  onChordTypeChange: (type: ChordType) => void;
  onPlayChord: () => void;
  enharmonicPreference: EnharmonicPreference;
  onEnharmonicChange: (preference: EnharmonicPreference) => void;
}

const PlayIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);


export const ChordControls: React.FC<ChordControlsProps> = ({ 
    activeChordType, 
    onChordTypeChange, 
    onPlayChord,
    enharmonicPreference,
    onEnharmonicChange
}) => {
    const { customChords } = useCustomData();
    const builtInChordTypes = Object.values(BuiltInChords);

  return (
    <div className="bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-sm flex flex-col gap-4">
        <div>
            <h2 className="text-base font-bold mb-2 border-b border-gray-600 pb-1">Note Spelling</h2>
            <div className="relative flex w-full p-1 bg-gray-700 rounded-lg mt-2">
                <div 
                    className="absolute top-1 left-1 h-[calc(100%-8px)] w-[calc(50%-4px)] bg-stone-200 rounded-md transition-transform duration-300 ease-in-out"
                    style={{ transform: `translateX(${enharmonicPreference === 'sharp' ? '0%' : '100%'}) ` }}
                ></div>
                <button 
                    onClick={() => onEnharmonicChange('sharp')}
                    className={`relative w-1/2 rounded-md py-2 text-sm font-bold transition-colors duration-300 ${enharmonicPreference === 'sharp' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}
                >
                    Sharps (♯)
                </button>
                <button 
                    onClick={() => onEnharmonicChange('flat')}
                    className={`relative w-1/2 rounded-md py-2 text-sm font-bold transition-colors duration-300 ${enharmonicPreference === 'flat' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}
                >
                    Flats (♭)
                </button>
            </div>
        </div>
        <div>
            <h2 className="text-base font-bold mb-2 border-b border-gray-600 pb-1">Chord Type</h2>
            <div className="relative mt-2">
                <select
                    value={activeChordType}
                    onChange={(e) => onChordTypeChange(e.target.value as ChordType)}
                    className="w-full px-4 py-3 text-center font-semibold rounded-lg transition-all duration-200 border-2 bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600 hover:border-gray-500 appearance-none cursor-pointer"
                >
                    <optgroup label="Accordi Predefiniti">
                        {/* FIX: Explicitly type 'type' as ChordType to prevent 'unknown' type errors. */}
                        {builtInChordTypes.map((type: ChordType) => (
                            <option key={type} value={type}>
                                {type}
                            </option>
                        ))}
                    </optgroup>
                     {customChords.length > 0 && (
                        <optgroup label="Accordi Personalizzati">
                            {customChords.map(chord => (
                                <option key={chord.name} value={chord.name}>{chord.name}</option>
                            ))}
                        </optgroup>
                    )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
            </div>
        </div>

        <button onClick={onPlayChord} className="w-full flex items-center justify-center px-6 py-4 bg-green-500 hover:bg-green-400 text-gray-900 font-bold rounded-lg transition-all duration-300 transform hover:scale-105">
            <PlayIcon />
            Play Chord
        </button>
    </div>
  );
};
