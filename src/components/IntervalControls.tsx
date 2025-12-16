import React from 'react';
import { INTERVALS } from '../constants';
import { EnharmonicPreference, Interval } from '../types';
import { CycleIcon } from './icons/CycleIcon';

interface IntervalControlsProps {
  onIntervalSelect: (interval: Interval) => void;
  onClearAll: () => void;
  onPlayAll: () => void;
  isAnyIntervalPlaced: boolean;
  isPendingRootSelected: boolean;
  enharmonicPreference: EnharmonicPreference;
  onEnharmonicChange: (preference: EnharmonicPreference) => void;
  intervalDirection: 'ascending' | 'descending';
  onIntervalDirectionChange: (direction: 'ascending' | 'descending') => void;
  onCyclePosition: () => void;
  activeIntervalId: string | null;
}

const ArrowUpIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
);

const ArrowDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
);

const PlayAllIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
    </svg>
);


export const IntervalControls: React.FC<IntervalControlsProps> = ({
  onIntervalSelect,
  onClearAll,
  onPlayAll,
  isAnyIntervalPlaced,
  isPendingRootSelected,
  enharmonicPreference,
  onEnharmonicChange,
  intervalDirection,
  onIntervalDirectionChange,
  onCyclePosition,
  activeIntervalId
}) => {
  return (
    <div className="w-full max-w-5xl bg-gray-800 rounded-lg shadow-xl p-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 items-center">
            <div className="relative flex w-full p-1 bg-gray-700 rounded-lg col-span-2 md:col-span-1">
                <div 
                    className="absolute top-1 left-1 h-[calc(100%-8px)] w-[calc(50%-4px)] bg-stone-200 rounded-md transition-transform duration-300 ease-in-out"
                    style={{ transform: `translateX(${enharmonicPreference === 'sharp' ? '0%' : '100%'}) ` }}
                ></div>
                <button 
                    onClick={() => onEnharmonicChange('sharp')}
                    className={`relative w-1/2 rounded-md py-2 px-4 text-sm font-bold transition-colors duration-300 ${enharmonicPreference === 'sharp' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}
                >
                    Diesis (♯)
                </button>
                <button 
                    onClick={() => onEnharmonicChange('flat')}
                    className={`relative w-1/2 rounded-md py-2 px-4 text-sm font-bold transition-colors duration-300 ${enharmonicPreference === 'flat' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}
                >
                    Bemolle (♭)
                </button>
            </div>
             <div className="flex items-center justify-center gap-1 p-1 bg-gray-700 rounded-lg h-[42px]">
                <button 
                    onClick={() => onIntervalDirectionChange('ascending')}
                    className={`p-2 rounded-md transition-colors duration-200 ${intervalDirection === 'ascending' ? 'bg-stone-200 text-gray-900' : 'text-gray-400 hover:bg-gray-600 hover:text-white'}`}
                    aria-label="Intervallo ascendente"
                >
                    <ArrowUpIcon />
                </button>
                <button 
                    onClick={() => onIntervalDirectionChange('descending')}
                     className={`p-2 rounded-md transition-colors duration-200 ${intervalDirection === 'descending' ? 'bg-stone-200 text-gray-900' : 'text-gray-400 hover:bg-gray-600 hover:text-white'}`}
                     aria-label="Intervallo discendente"
                >
                    <ArrowDownIcon />
                </button>
            </div>
            <button
                onClick={onCyclePosition}
                disabled={!activeIntervalId}
                className="w-full p-2 h-[42px] rounded-md text-white font-semibold transition-all duration-200 flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500"
                title="Sposta in posizione alternativa"
            >
                <CycleIcon />
            </button>
             <button
                onClick={onPlayAll}
                disabled={!isAnyIntervalPlaced}
                className="w-full p-2 h-[42px] rounded-md text-white font-semibold transition-all duration-200 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500"
                title="Suona Tutto"
            >
                <PlayAllIcon />
            </button>
            <button
                onClick={onClearAll}
                className="w-full p-2 h-[42px] rounded-md text-white font-semibold transition-all duration-200 bg-gray-600 hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500"
            >
                Pulisci Tutto
            </button>
        </div>

        <div className={`grid grid-cols-7 gap-2 transition-opacity duration-300 ${isPendingRootSelected || activeIntervalId ? 'opacity-100' : 'opacity-40'}`}>
            {INTERVALS.map(interval => (
                <button
                    key={interval.semitones}
                    onClick={() => onIntervalSelect(interval)}
                    disabled={!isPendingRootSelected}
                    style={{ backgroundColor: interval.rgbColor }}
                    className={`py-1.5 px-1 text-center rounded-md font-semibold text-sm transition-colors disabled:cursor-not-allowed text-black hover:opacity-80`}
                >
                    {interval.shortName}
                </button>
            ))}
        </div>
        {!isPendingRootSelected && !activeIntervalId && (
            <div className="text-center text-sm text-gray-400 py-2">
                Seleziona una nota sulla tastiera per iniziare.
            </div>
        )}
    </div>
  );
};