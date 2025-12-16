import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ScaleNoteDefinition, RootType, ScaleType } from '../types';
import EditorFretboard from './EditorFretboard';
// FIX: Added missing import for ALL_SHAPES
import { ALL_SHAPES } from '../constants';
import { useCustomData } from './useCustomTypes';
import { TrashIcon } from './icons/TrashIcon';

const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40]; // High E to Low E

const InfoIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 inline-block mr-2" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
);

const CopyIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const BUILT_IN_SCALE_TYPES = Object.keys(ALL_SHAPES) as ScaleType[];

const scaleTypeToConstantName: Record<ScaleType, string> = {
    'Pentatonic': 'MINOR_PENTATONIC_SHAPES',
    'Ionian': 'IONIAN_MODE_SHAPES',
    'Dorian': 'DORIAN_MODE_SHAPES',
    'Phrygian': 'PHRYGIAN_MODE_SHAPES',
    'Lydian': 'LYDIAN_MODE_SHAPES',
    'Mixolydian': 'MIXOLYDIAN_MODE_SHAPES',
    'Aeolian': 'AEOLIAN_MODE_SHAPES',
    'Locrian': 'LOCRIAN_MODE_SHAPES',
    'Harmonic Minor': 'HARMONIC_MINOR_MODE_SHAPES',
    'Locrian #6': 'LOCRIAN_6_SHAPES',
    'Ionian #5': 'IONIAN_5_SHAPES',
    'Dorian #4': 'DORIAN_4_SHAPES',
    'Phrygian Dominant': 'PHRYGIAN_DOMINANT_SHAPES',
    'Lydian #2': 'LYDIAN_2_SHAPES',
    'Altered Dominant bb7': 'ALTERED_DOMINANT_BB7_SHAPES',
    'Melodic Minor': 'MELODIC_MINOR_SHAPES',
    'Dorian b2': 'DORIAN_B2_SHAPES',
    'Lydian Augmented': 'LYDIAN_AUGMENTED_SHAPES',
    'Lydian Dominant': 'LYDIAN_DOMINANT_SHAPES',
    'Mixolydian b6': 'MIXOLYDIAN_B6_SHAPES',
    'Locrian #2': 'LOCRIAN_2_SHAPES',
    'Altered Scale': 'ALTERED_SCALE_SHAPES',
};

const ScaleEditorComponent: React.FC = () => {
    const { customScales, addCustomScale, deleteCustomScale } = useCustomData();
    const [notes, setNotes] = useState<ScaleNoteDefinition[]>([]);
    const [shapeName, setShapeName] = useState('Shape 1');
    const [shapeColor, setShapeColor] = useState('rgb(59, 130, 246)');
    const [scaleCategory, setScaleCategory] = useState<ScaleType>('Ionian');
    const [shapeIndex, setShapeIndex] = useState<number>(0);
    const [draggedNote, setDraggedNote] = useState<ScaleNoteDefinition | null>(null);
    const [copySuccess, setCopySuccess] = useState(false);

    // Form state for new scale types
    const [newScaleName, setNewScaleName] = useState('');
    const [scaleTypeError, setScaleTypeError] = useState('');

    const shapeOptions = useMemo(() => {
        const shapes = ALL_SHAPES[scaleCategory] || [];
        return shapes.map((shape, index) => ({
            label: shape.name,
            value: index,
        }));
    }, [scaleCategory]);

    useEffect(() => {
        const shapes = ALL_SHAPES[scaleCategory];
        if (shapes && shapeIndex < shapes.length) { // Load existing shape
            const shapeToEdit = shapes[shapeIndex];
            setNotes(shapeToEdit.notes);
            setShapeName(shapeToEdit.name);
            setShapeColor(shapeToEdit.color);
        } else { // "Create new" selected or invalid index
            setNotes([]);
            setShapeName(`Shape ${shapes ? shapes.length + 1 : 1}`);
            setShapeColor('rgb(59, 130, 246)');
        }
    }, [scaleCategory, shapeIndex]);


    const handleNoteClick = useCallback((s: number, f: number, e: React.MouseEvent) => {
        setNotes(prevNotes => {
            const existingNoteIndex = prevNotes.findIndex(n => n.s === s && n.f === f);
            if (existingNoteIndex !== -1) {
                // Cycle through types if note exists
                const newNotes = [...prevNotes];
                const existingNote = newNotes[existingNoteIndex];
                if (e.shiftKey) {
                    existingNote.t = existingNote.t === RootType.Major ? undefined : RootType.Major;
                } else if (e.ctrlKey || e.metaKey) {
                    existingNote.t = existingNote.t === RootType.Minor ? undefined : RootType.Minor;
                } else {
                     if (existingNote.t === undefined) existingNote.t = RootType.Major;
                     else if (existingNote.t === RootType.Major) existingNote.t = RootType.Minor;
                     else existingNote.t = undefined;
                }
                return newNotes;
            } else {
                // Add new note
                let type: RootType | undefined = undefined;
                if (e.shiftKey) type = RootType.Major;
                else if (e.ctrlKey || e.metaKey) type = RootType.Minor;
                return [...prevNotes, { s, f, t: type }];
            }
        });
    }, []);

    const handleRemoveNote = useCallback((s: number, f: number) => {
        setNotes(prevNotes => prevNotes.filter(n => n.s !== s || n.f !== f));
    }, []);
    
    const handleDragStart = (note: ScaleNoteDefinition) => {
        setDraggedNote(note);
    };
    
    const handleDrop = (s: number, f: number) => {
        if (!draggedNote) return;
        
        if (notes.some(n => n.s === s && n.f === f)) {
            setDraggedNote(null);
            return;
        }

        setNotes(prevNotes => {
            const newNotes = prevNotes.filter(n => n.s !== draggedNote.s || n.f !== draggedNote.f);
            newNotes.push({ ...draggedNote, s, f });
            return newNotes;
        });
        setDraggedNote(null);
    };

    const handleClear = () => {
        setNotes([]);
    };

    const generatedCode = useMemo(() => {
        const targetArrayName = scaleTypeToConstantName[scaleCategory];
        const shapes = ALL_SHAPES[scaleCategory];
        
        let instructionComment: string;
        if (!targetArrayName) {
             instructionComment = `// Non è possibile generare codice per tipi di scale personalizzati in questo modo.\n`;
        } else if (shapes && shapeIndex < shapes.length) {
            const shapeToEditName = shapes[shapeIndex].name;
            instructionComment = `// Sostituisci '${shapeToEditName}' nell'array ${targetArrayName} nel file 'constants.ts' con questo codice:\n`;
        } else {
            instructionComment = `// Aggiungi questo nuovo shape all'array ${targetArrayName} nel file 'constants.ts':\n`;
        }

        if (notes.length === 0) {
            return "// Add notes to the fretboard to generate code...";
        }

        const sortedNotes = [...notes].sort((a, b) => {
            if (a.s !== b.s) return a.s - b.s;
            return a.f - b.f;
        });

        const minFret = Math.min(...sortedNotes.map(n => n.f), 0);

        const notesString = sortedNotes.map(note => {
            const noteObject = { s: note.s, f: note.f - minFret, ...(note.t && { t: `RootType.${note.t}` }) };
            let jsonString = JSON.stringify(noteObject, null, 4).replace(/"/g, '');
            jsonString = jsonString.replace('t:RootType.major', 't: RootType.Major');
            jsonString = jsonString.replace('t:RootType.minor', 't: RootType.Minor');
            return `            ${jsonString}`;
        }).join(',\n');

        const shapeCode = `{
    name: '${shapeName}',
    color: '${shapeColor}',
    notes: [
${notesString}
    ]
}`;
        return instructionComment + shapeCode;
    }, [notes, shapeName, shapeColor, scaleCategory, shapeIndex]);
    
    const handleCopyToClipboard = () => {
        navigator.clipboard.writeText(generatedCode).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    };

     const handleNewScaleTypeSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setScaleTypeError('');
        if (!newScaleName.trim()) {
            setScaleTypeError('Il nome della scala è obbligatorio.');
            return;
        }

        const rootNotes = notes.filter(n => n.t === RootType.Major || n.t === RootType.Minor);
        if (rootNotes.length === 0) {
            setScaleTypeError('Per favore, imposta almeno una tonica sulla tastiera (Shift+Click o Ctrl+Click).');
            return;
        }

        const rootNote = rootNotes.sort((a,b) => (a.s - b.s) || (a.f - b.f))[0];
        const rootMidi = STRING_BASE_MIDI[rootNote.s] + rootNote.f;

        const intervalSet = new Set<number>();
        notes.forEach(note => {
            const noteMidi = STRING_BASE_MIDI[note.s] + note.f;
            const interval = (noteMidi - rootMidi + 1200) % 12;
            intervalSet.add(interval);
        });
        const intervals = Array.from(intervalSet).sort((a, b) => a - b);
        
        addCustomScale(newScaleName, intervals);
        setNewScaleName('');
    };

    const COLORS = [
        'rgb(239, 68, 68)',   // red-500
        'rgb(249, 115, 22)',  // orange-500
        'rgb(250, 204, 21)',  // yellow-400
        'rgb(34, 197, 94)',   // green-500
        'rgb(59, 130, 246)',  // blue-500
        'rgb(139, 92, 246)', // violet-500
        'rgb(219, 39, 119)', // fuchsia-500
    ];

    return (
        <div className="flex-grow flex flex-col lg:flex-row gap-4 p-4">
            <div className="flex-grow">
                <EditorFretboard 
                    notes={notes}
                    draggedNote={draggedNote}
                    onNoteClick={handleNoteClick}
                    onRemoveNote={handleRemoveNote}
                    onDragStart={handleDragStart}
                    onDrop={handleDrop}
                />
            </div>
            <div className="w-full lg:w-96 flex-shrink-0 flex flex-col gap-4">
                 <div className="bg-gray-800/50 rounded-lg p-4 text-gray-300 text-sm">
                    <h3 className="font-bold text-lg mb-2 text-white border-b border-gray-600 pb-2"><InfoIcon />Istruzioni</h3>
                    <ul className="list-disc list-inside space-y-2">
                        <li><span className="font-semibold text-white">Aggiungi/Cicla Nota:</span> Click su un tasto.</li>
                        <li><span className="font-semibold text-white">Rimuovi Nota:</span> Click destro su una nota.</li>
                        <li><span className="font-semibold text-white">Sposta Nota:</span> Trascina una nota.</li>
                        <li><span className="font-semibold text-white">Imposta Tonica Maggiore:</span> Shift + Click su una nota.</li>
                        <li><span className="font-semibold text-white">Imposta Tonica Minore:</span> Ctrl/Cmd + Click su una nota.</li>
                        <li><span className="font-semibold text-white">Crea Tipo di Scala:</span> Disegna una forma con tonica, dai un nome e salva.</li>
                    </ul>
                </div>
                
                <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-4">
                    <h3 className="font-bold text-lg text-white border-b border-gray-600 pb-2">Controlli Editor</h3>
                    <div>
                        <label htmlFor="scale-category" className="block text-sm font-medium text-gray-300 mb-1">Tipo di Scala</label>
                        <select
                            id="scale-category"
                            value={scaleCategory}
                            onChange={(e) => {
                                setScaleCategory(e.target.value as ScaleType);
                                setShapeIndex(0);
                            }}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <optgroup label="Scale Predefinite">
                                {BUILT_IN_SCALE_TYPES.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </optgroup>
                            {customScales.length > 0 && (
                                <optgroup label="Scale Personalizzate">
                                    {customScales.map(scale => (
                                        <option key={scale.name} value={scale.name}>{scale.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </div>
                     <div>
                        <label htmlFor="shape-index" className="block text-sm font-medium text-gray-300 mb-1">Shape da Modificare</label>
                        <select
                            id="shape-index"
                            value={shapeIndex}
                            onChange={(e) => setShapeIndex(Number(e.target.value))}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            disabled={!BUILT_IN_SCALE_TYPES.includes(scaleCategory)}
                        >
                            {shapeOptions.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                            <option value={shapeOptions.length}>+ Crea Nuova Shape</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="shape-name" className="block text-sm font-medium text-gray-300 mb-1">Nome Forma</label>
                        <input 
                            type="text" 
                            id="shape-name"
                            value={shapeName}
                            onChange={(e) => setShapeName(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Colore Forma</label>
                        <div className="flex flex-wrap gap-2">
                            {COLORS.map(color => (
                                <button 
                                    key={color}
                                    onClick={() => setShapeColor(color)}
                                    className={`w-8 h-8 rounded-full transition-transform transform hover:scale-110 ${shapeColor === color ? 'ring-2 ring-offset-2 ring-offset-gray-800 ring-white' : ''}`}
                                    style={{ backgroundColor: color }}
                                    aria-label={`Select color ${color}`}
                                />
                            ))}
                        </div>
                    </div>
                     <div className='border-t border-gray-600 pt-4'>
                        <form onSubmit={handleNewScaleTypeSubmit} className="space-y-3">
                            <input 
                                type="text"
                                value={newScaleName}
                                onChange={e => setNewScaleName(e.target.value)}
                                placeholder="Nome Nuovo Tipo di Scala"
                                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2"
                            />
                            {scaleTypeError && <p className="text-red-400 text-sm">{scaleTypeError}</p>}
                            <div className="flex gap-2">
                                <button type="submit" className="flex-1 p-2 rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors">
                                    Salva Tipo Scala
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    className="p-2 rounded-md text-white font-semibold transition-all duration-200 bg-red-600 hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-red-500"
                                >
                                    Pulisci
                                </button>
                            </div>
                        </form>
                     </div>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-2">
                    <h3 className="font-bold text-lg text-white border-b border-gray-600 pb-2">Tipi di Scale Salvate</h3>
                    <ul className="space-y-1 pt-2 max-h-24 overflow-y-auto">
                        {customScales.map(scale => (
                            <li key={scale.name} className="flex justify-between items-center bg-gray-700 p-1.5 rounded-md text-sm">
                                <span>{scale.name}</span>
                                <button onClick={() => deleteCustomScale(scale.name)} className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-gray-600">
                                    <TrashIcon />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
                 <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-2">
                    <h3 className="font-bold text-lg text-white border-b border-gray-600 pb-2">Codice Generato</h3>
                    <div className="relative">
                        <textarea
                            readOnly
                            value={generatedCode}
                            className="w-full h-48 bg-gray-900 text-cyan-300 font-mono text-xs p-2 border border-gray-600 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                         <button 
                            onClick={handleCopyToClipboard}
                            className="absolute top-2 right-2 p-1.5 bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 hover:text-white transition-colors"
                            title="Copia negli appunti"
                        >
                            {copySuccess ? 'Copiato!' : <CopyIcon />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScaleEditorComponent;