import React, { useState, useEffect, useRef } from 'react';
import { AudioService } from './services/AudioService';
import ScalesVisualizer from './components/ScalesVisualizer';
import ChordVisualizer from './components/ChordVisualizer';
import IntervalsVisualizer from './components/IntervalsVisualizer';
import MainEditor from './components/MainEditor';
import GrandStaffEditor from './components/GrandStaffEditor';

const App: React.FC = () => {
    const [mode, setMode] = useState<'scales' | 'chords' | 'intervals' | 'editor' | 'grandStaff'>('scales');
    
    // --- AUDIO STATE ---
    const audioServiceRef = useRef(new AudioService());
    const [isAudioReady, setIsAudioReady] = useState(false);

    useEffect(() => {
        const audioService = audioServiceRef.current;
        audioService.init().then(() => {
            setIsAudioReady(true);
        }).catch(err => {
            console.error("Failed to initialize audio", err);
        });
    }, []);
    
    return (
        <div className="min-h-screen flex flex-col bg-gray-900 font-sans text-gray-100">
            <div className="w-full max-w-screen-2xl mx-auto px-4 pt-1 lg:px-8 flex flex-col flex-grow">
                 <div className="flex justify-center mb-1 border-b border-gray-700">
                    <button
                        onClick={() => setMode('scales')}
                        className={`px-6 py-3 text-lg font-semibold transition-colors duration-200 focus:outline-none ${mode === 'scales' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        Scale
                    </button>
                    <button
                        onClick={() => setMode('chords')}
                        className={`px-6 py-3 text-lg font-semibold transition-colors duration-200 focus:outline-none ${mode === 'chords' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        Accordi
                    </button>
                    <button
                        onClick={() => setMode('intervals')}
                        className={`px-6 py-3 text-lg font-semibold transition-colors duration-200 focus:outline-none ${mode === 'intervals' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        Intervalli
                    </button>
                    <button
                        onClick={() => setMode('editor')}
                        className={`px-6 py-3 text-lg font-semibold transition-colors duration-200 focus:outline-none ${mode === 'editor' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        Editor
                    </button>
                     <button
                        onClick={() => setMode('grandStaff')}
                        className={`px-6 py-3 text-lg font-semibold transition-colors duration-200 focus:outline-none ${mode === 'grandStaff' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        Grand Staff
                    </button>
                </div>

                <div className={mode === 'scales' ? 'flex flex-col flex-grow' : 'hidden'}>
                    <ScalesVisualizer 
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                        isActive={mode === 'scales'}
                    />
                </div>
                <div className={mode === 'chords' ? 'flex flex-col flex-grow' : 'hidden'}>
                    <ChordVisualizer 
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                        isActive={mode === 'chords'}
                    />
                </div>
                <div className={mode === 'intervals' ? 'flex flex-col flex-grow' : 'hidden'}>
                    <IntervalsVisualizer
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                        isActive={mode === 'intervals'}
                    />
                </div>
                <div className={mode === 'editor' ? 'flex flex-col flex-grow' : 'hidden'}>
                    <MainEditor
                        isActive={mode === 'editor'}
                    />
                </div>
                <div className={mode === 'grandStaff' ? 'flex flex-col flex-grow' : 'hidden'}>
                    <GrandStaffEditor
                        isActive={mode === 'grandStaff'}
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                    />
                </div>
            </div>
        </div>
    );
};

export default App;