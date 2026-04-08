import React from 'react';

interface PlaybackControlsProps {
  playbackDirection: 'ascending' | 'descending';
  onPlaybackDirectionChange: (direction: 'ascending' | 'descending') => void;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({ playbackDirection, onPlaybackDirectionChange }) => {
  return (
    <div className="bg-gray-800 rounded-lg shadow-xl p-2 flex flex-col sm:flex-row items-center gap-2 w-full max-w-sm">
        <h2 className="text-sm font-bold text-gray-300 flex-shrink-0">Direzione Playback</h2>
        <div className="relative flex w-full p-1 bg-gray-700 rounded-lg">
            <div 
                className="absolute top-1 left-1 h-[calc(100%-8px)] w-[calc(50%-4px)] bg-stone-200 rounded-md transition-transform duration-300 ease-in-out"
                style={{ transform: `translateX(${playbackDirection === 'ascending' ? '0%' : '100%'})` }}
            ></div>
            <button onClick={() => onPlaybackDirectionChange('ascending')} className={`relative w-1/2 rounded-md py-2 text-sm font-bold transition-colors duration-300 ${playbackDirection === 'ascending' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}>Ascendente</button>
            <button onClick={() => onPlaybackDirectionChange('descending')} className={`relative w-1/2 rounded-md py-2 text-sm font-bold transition-colors duration-300 ${playbackDirection === 'descending' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}>Discendente</button>
        </div>
    </div>
  );
};

export default PlaybackControls;