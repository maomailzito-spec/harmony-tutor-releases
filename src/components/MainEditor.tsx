import React, { useState } from 'react';
import ScaleEditorComponent from './ScaleEditorComponent';
import ChordEditorComponent from './ChordEditorComponent';

const MainEditor: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const [editorMode, setEditorMode] = useState<'scales' | 'chords'>('scales');

    if (!isActive) return null;

    return (
        <div className="flex-grow flex flex-col">
            <div className="flex justify-center mb-4 border-b border-gray-700">
                <button
                    onClick={() => setEditorMode('scales')}
                    className={`px-6 py-3 text-base font-semibold transition-colors duration-200 focus:outline-none ${editorMode === 'scales' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-400 hover:text-white'}`}
                >
                    Editor Forme Scala
                </button>
                <button
                    onClick={() => setEditorMode('chords')}
                    className={`px-6 py-3 text-base font-semibold transition-colors duration-200 focus:outline-none ${editorMode === 'chords' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-400 hover:text-white'}`}
                >
                    Editor Forme Accordi
                </button>
            </div>
            
            <div className="flex-grow flex flex-col">
                {editorMode === 'scales' && <ScaleEditorComponent />}
                {editorMode === 'chords' && <ChordEditorComponent />}
            </div>
        </div>
    );
};

export default MainEditor;