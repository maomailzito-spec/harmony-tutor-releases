import React from 'react';
import { DisplayNote, ChordType, CagedVoicing } from '../types';

interface CagedSystemProps {
  rootNote: DisplayNote;
  activeChordType: ChordType;
  allVoicings: CagedVoicing[] | null;
  filteredVoicings: CagedVoicing[];
  hasStringSets: boolean;
  selectedStringSet: string;
  onSetSelectedStringSet: (set: string) => void;
  currentShapeIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onPlayVoicing: () => void;
  isVoicingPlaying: boolean;
}

const STRING_SETS = ['6-5-4-3', '5-4-3-2', '4-3-2-1', '6-4-3-2', '5-3-2-1'];

const PlayVoicingIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.828 2.828a1 1 0 011.414 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.414-1.414A3.986 3.986 0 0013 10a3.986 3.986 0 00-1.172-2.828 1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);

const NavButton: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean }> = ({ onClick, children, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="px-3 py-1 bg-gray-600 text-gray-200 rounded-md hover:bg-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
  >
    {children}
  </button>
);

export const CagedSystem: React.FC<CagedSystemProps> = ({ 
    rootNote, 
    activeChordType, 
    allVoicings,
    filteredVoicings,
    hasStringSets,
    selectedStringSet,
    onSetSelectedStringSet,
    currentShapeIndex,
    onNext,
    onPrev,
    onPlayVoicing,
    isVoicingPlaying
}) => {

  if (!allVoicings || allVoicings.length === 0) {
    return (
        <div className="bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-sm">
            <h2 className="text-base font-bold mb-2 border-b border-gray-600 pb-1">Guitar Voicings</h2>
            <div className="text-center p-4 rounded-lg min-h-[150px] flex items-center justify-center">
                <p className="text-gray-400">No guitar voicings available for this chord type yet.</p>
            </div>
        </div>
    );
  }
  
  const currentVoicing = filteredVoicings[currentShapeIndex];

  return (
    <div className="bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-sm flex flex-col gap-4">
      <h2 className="text-base font-bold border-b border-gray-600 pb-1">Guitar Voicings</h2>
      
      {hasStringSets && (
        <div className="w-full">
            <div className="flex flex-wrap justify-center gap-2 p-1 bg-gray-700 rounded-lg">
                {STRING_SETS.map(set => (
                    <button
                        key={set}
                        onClick={() => onSetSelectedStringSet(set)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${selectedStringSet === set ? 'bg-stone-200 text-gray-900 shadow' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                    >
                        {set}
                    </button>
                ))}
            </div>
        </div>
      )}
      
      <div className="flex items-center justify-between w-full">
        <NavButton onClick={onPrev} disabled={filteredVoicings.length < 2}>&lt;</NavButton>
        <div className="text-center min-h-[40px]">
          {currentVoicing ? (
            <>
                <div className="flex items-center justify-center gap-2">
                    <p className="font-bold text-stone-200">
                        {hasStringSets 
                            ? currentVoicing.name.replace(`Drop 2 (${selectedStringSet}) - `, '') 
                            : currentVoicing.name
                        }
                    </p>
                    <button 
                        onClick={onPlayVoicing}
                        disabled={isVoicingPlaying}
                        className="p-1.5 bg-gray-600/80 text-gray-200 rounded-full hover:bg-gray-500 disabled:opacity-50 disabled:cursor-wait transition-all"
                        aria-label="Play guitar voicing"
                    >
                        <PlayVoicingIcon />
                    </button>
                </div>
                <p className="text-xs text-gray-400">Voicing {currentShapeIndex + 1} of {filteredVoicings.length}</p>
            </>
          ) : <p className="text-gray-400">No voicings for this set.</p>}
        </div>
        <NavButton onClick={onNext} disabled={filteredVoicings.length < 2}>&gt;</NavButton>
      </div>
    </div>
  );
};