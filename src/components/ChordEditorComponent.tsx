import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Voicing, ChordType, ScaleNoteDefinition, CagedVoicing, BuiltInChords, RootType } from '../types';
import EditorFretboard from './EditorFretboard';
import { getGuitarVoicings } from '../data/guitarVoicings';
import { CHROMATIC_SCALE } from '../constants';
import { useCustomData } from './useCustomTypes';
import { TrashIcon } from './icons/TrashIcon';

const STRING_BASE_MIDI = [64, 59, 55, 50, 45, 40]; // High E to Low E

const COLORS = [
    'rgb(239, 68, 68)',   // red-500
    'rgb(249, 115, 22)',  // orange-500
    'rgb(250, 204, 21)',  // yellow-400
    'rgb(34, 197, 94)',   // green-500
    'rgb(59, 130, 246)',  // blue-500
    'rgb(139, 92, 246)', // violet-500
    'rgb(219, 39, 119)', // fuchsia-500
];

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

const ChordEditorComponent: React.FC = () => {
    const { customChords, addCustomChord, deleteCustomChord, customVoicings, addCustomVoicing, deleteCustomVoicing } = useCustomData();
    const [currentVoicing, setCurrentVoicing] = useState<Voicing>([-1, -1, -1, -1, -1, -1]);
    const [voicingName, setVoicingName] = useState('New Voicing');
    const [rootNoteIndex, setRootNoteIndex] = useState(0); // C
    const [chordType, setChordType] = useState<ChordType>(BuiltInChords.Major);
    const [selectedVoicingKey, setSelectedVoicingKey] = useState<string>('new');
    const [copySuccess, setCopySuccess] = useState(false);
    const [rootPosition, setRootPosition] = useState<{s: number, f: number} | null>(null);
    const [voicingSaveMessage, setVoicingSaveMessage] = useState<string>('');

    // Form state for new chord types
    const [newChordName, setNewChordName] = useState('');
    const [chordTypeError, setChordTypeError] = useState('');
    const [newChordColor, setNewChordColor] = useState<string>(COLORS[2]);

    const availableVoicings = useMemo(() => {
        const builtIn = getGuitarVoicings(rootNoteIndex, chordType) || [];
        const saved = customVoicings
            .filter(v => v.chordType === chordType && v.rootNoteIndex === rootNoteIndex)
            .map(v => ({ name: v.name, voicing: v.voicing }));
        return [...builtIn, ...saved];
    }, [rootNoteIndex, chordType, customVoicings]);

    useEffect(() => {
        setRootPosition(null);
        if (selectedVoicingKey === 'new') {
            setCurrentVoicing([-1, -1, -1, -1, -1, -1]);
            const rootNoteName = CHROMATIC_SCALE[rootNoteIndex].sharp;
            setVoicingName(`${rootNoteName} ${chordType} - Custom`);
        } else if (selectedVoicingKey === 'custom') {
            // Do nothing, keep manual edits
        } else if (selectedVoicingKey.startsWith('saved|')) {
            const id = selectedVoicingKey.slice('saved|'.length);
            const saved = customVoicings.find(v => v.id === id);
            if (saved) {
                setCurrentVoicing(saved.voicing);
                setVoicingName(saved.name);
            }
        }
        else {
            const [indexStr, name] = selectedVoicingKey.split('|');
            const index = parseInt(indexStr, 10);
            if (availableVoicings && index < availableVoicings.length) {
                const selected = availableVoicings[index];
                setCurrentVoicing(selected.voicing);
                setVoicingName(selected.name);
            }
        }
    }, [selectedVoicingKey, availableVoicings, rootNoteIndex, chordType, customVoicings]);
    
    const notesForFretboard = useMemo((): ScaleNoteDefinition[] => {
        return currentVoicing
            .map((fret, index) => {
                const s = 5 - index;
                const f = fret;
                const isRoot = rootPosition?.s === s && rootPosition?.f === f;
                // Use Major type just for visual distinction as a generic root
                return ({ s, f, t: isRoot ? RootType.Major : undefined });
            })
            .filter(note => note.f > -1);
    }, [currentVoicing, rootPosition]);

    const handleNoteClick = useCallback((s: number, f: number, e: React.MouseEvent) => {
        e.preventDefault();

        if (e.ctrlKey || e.metaKey) {
            const voicingIndex = 5 - s;
            const noteIsOnFretboard = currentVoicing[voicingIndex] === f;
            if (noteIsOnFretboard) {
                setRootPosition(prev => (prev && prev.s === s && prev.f === f) ? null : { s, f });
            }
        } else {
            setCurrentVoicing(prev => {
                const newVoicing = [...prev] as Voicing;
                const voicingIndex = 5 - s;
                const noteExists = newVoicing[voicingIndex] === f;
                newVoicing[voicingIndex] = noteExists ? -1 : f;

                if (noteExists && rootPosition?.s === s && rootPosition?.f === f) {
                    setRootPosition(null);
                }
                return newVoicing;
            });
        }
        setSelectedVoicingKey('custom');
    }, [currentVoicing, rootPosition]);


    const handleRemoveNote = useCallback((s: number, f: number) => {
        setCurrentVoicing(prev => {
            const newVoicing = [...prev] as Voicing;
            const voicingIndex = 5 - s;
            if (newVoicing[voicingIndex] === f) {
                newVoicing[voicingIndex] = -1;
                 if (rootPosition?.s === s && rootPosition?.f === f) {
                    setRootPosition(null);
                }
            }
            return newVoicing;
        });
        setSelectedVoicingKey('custom');
    }, [rootPosition]);

    const handleClear = () => {
        setCurrentVoicing([-1, -1, -1, -1, -1, -1]);
        setRootPosition(null);
        setSelectedVoicingKey('new');
    };

    const handleSaveVoicingToApp = () => {
        setVoicingSaveMessage('');
        if (!voicingName.trim()) {
            setVoicingSaveMessage('Dai un nome al voicing.');
            return;
        }
        const hasAnyNote = currentVoicing.some(f => f > -1);
        if (!hasAnyNote) {
            setVoicingSaveMessage('Aggiungi almeno una nota prima di salvare.');
            return;
        }
        addCustomVoicing(chordType, rootNoteIndex, voicingName, currentVoicing);
        setVoicingSaveMessage('Voicing salvato.');
        setTimeout(() => setVoicingSaveMessage(''), 1500);
    };
    
    const generatedCode = useMemo(() => {
        const instruction = `// Aggiungi questo oggetto all'array per l'accordo '${chordType}' in data/guitarVoicings.ts\n`;
        const voicingString = `[${currentVoicing.join(', ')}]`;
        const code = `{\n  name: '${voicingName}',\n  voicing: ${voicingString}\n}`;
        return instruction + code;
    }, [currentVoicing, voicingName, chordType]);

    const handleCopyToClipboard = () => {
        navigator.clipboard.writeText(generatedCode).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    };

    const handleNewChordTypeSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setChordTypeError('');
        if (!newChordName.trim()) {
            setChordTypeError('Il nome dell\'accordo è obbligatorio.');
            return;
        }

        if (!rootPosition) {
            setChordTypeError('Per favore, imposta una tonica sulla tastiera (Ctrl/Cmd+Click).');
            return;
        }

        const rootMidi = STRING_BASE_MIDI[rootPosition.s] + rootPosition.f;

        const formulaSet = new Set<number>();
        notesForFretboard.forEach(note => {
            const noteMidi = STRING_BASE_MIDI[note.s] + note.f;
            const interval = (noteMidi - rootMidi + 1200) % 12;
            formulaSet.add(interval);
        });
        const formula = Array.from(formulaSet).sort((a,b) => a-b);
        
        addCustomChord(newChordName, formula, newChordColor);
        setNewChordName('');
    };

    return (
        <div className="flex-grow flex flex-col lg:flex-row gap-4 p-4">
            <div className="flex-grow">
                <EditorFretboard 
                    notes={notesForFretboard}
                    draggedNote={null}
                    onNoteClick={handleNoteClick}
                    onRemoveNote={handleRemoveNote}
                    onDragStart={() => {}}
                    onDrop={() => {}}
                />
            </div>
            <div className="w-full lg:w-96 flex-shrink-0 flex flex-col gap-4">
                <div className="bg-gray-800/50 rounded-lg p-4 text-gray-300 text-sm">
                    <h3 className="font-bold text-lg mb-2 text-white border-b border-gray-600 pb-2"><InfoIcon />Istruzioni</h3>
                    <ul className="list-disc list-inside space-y-2">
                        <li><span className="font-semibold text-white">Aggiungi/Rimuovi Nota:</span> Click su un tasto.</li>
                        <li><span className="font-semibold text-white">Imposta Tonica:</span> Ctrl/Cmd + Click su una nota esistente.</li>
                        <li><span className="font-semibold text-white">Crea Tipo di Accordo:</span> Disegna una forma con tonica, dai un nome e salva.</li>
                    </ul>
                </div>
                
                <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-4">
                    <h3 className="font-bold text-lg text-white border-b border-gray-600 pb-2">Controlli Editor</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="root-note" className="block text-sm font-medium text-gray-300 mb-1">Tonica</label>
                            <select
                                id="root-note"
                                value={rootNoteIndex}
                                onChange={(e) => {
                                    setRootNoteIndex(Number(e.target.value));
                                    setSelectedVoicingKey('new');
                                }}
                                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {CHROMATIC_SCALE.map((note, index) => (
                                    <option key={index} value={index}>{note.sharp}{note.sharp !== note.flat ? ` / ${note.flat}` : ''}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="chord-type" className="block text-sm font-medium text-gray-300 mb-1">Tipo di Accordo</label>
                            <select
                                id="chord-type"
                                value={chordType}
                                onChange={(e) => {
                                    setChordType(e.target.value as ChordType);
                                    setSelectedVoicingKey('new');
                                }}
                                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <optgroup label="Accordi Predefiniti">
                                    {Object.values(BuiltInChords).map(type => (
                                        <option key={type} value={type}>{type}</option>
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
                        </div>
                    </div>
                     <div>
                        <label htmlFor="voicing-select" className="block text-sm font-medium text-gray-300 mb-1">Voicing da Modificare</label>
                        <select
                            id="voicing-select"
                            value={selectedVoicingKey}
                            onChange={(e) => setSelectedVoicingKey(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="new">+ Crea Nuovo Voicing</option>
                            {selectedVoicingKey === 'custom' && <option value="custom">-- Custom --</option>}
                            <optgroup label="Voicings Disponibili">
                                {(getGuitarVoicings(rootNoteIndex, chordType) || []).map((voicing, index) => (
                                    <option key={`built|${index}|${voicing.name}`} value={`${index}|${voicing.name}`}>{voicing.name}</option>
                                ))}
                            </optgroup>
                            {customVoicings.filter(v => v.chordType === chordType && v.rootNoteIndex === rootNoteIndex).length > 0 && (
                                <optgroup label="Voicings Salvati">
                                    {customVoicings
                                        .filter(v => v.chordType === chordType && v.rootNoteIndex === rootNoteIndex)
                                        .map(v => (
                                            <option key={v.id} value={`saved|${v.id}`}>{v.name}</option>
                                        ))
                                    }
                                </optgroup>
                            )}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="voicing-name" className="block text-sm font-medium text-gray-300 mb-1">Nome Voicing</label>
                        <input 
                            type="text" 
                            id="voicing-name"
                            value={voicingName}
                            onChange={(e) => setVoicingName(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                     <div className='border-t border-gray-600 pt-4'>
                        <div className="text-xs text-gray-400 mb-3 p-2 bg-gray-900/50 rounded-md">
                            <p className="font-bold text-gray-300">Come Salvare un Nuovo *Tipo* di Accordo:</p>
                            <p>Usa questo modulo per definire una nuova formula di accordo (es. "Min7b5"). Crea la forma, imposta la tonica (Ctrl+Click), dai un nome e salva. Apparirà nel menu a tendina "Tipo di Accordo".</p>
                        </div>
                        <form onSubmit={handleNewChordTypeSubmit} className="space-y-3">
                            <input 
                                type="text"
                                value={newChordName}
                                onChange={e => setNewChordName(e.target.value)}
                                placeholder="Nome Nuovo Tipo di Accordo"
                                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2"
                            />

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Colore Accordo</label>
                                <div className="flex flex-wrap gap-2">
                                    {COLORS.map(color => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => setNewChordColor(color)}
                                            className={`w-8 h-8 rounded-full transition-transform transform hover:scale-110 ${newChordColor === color ? 'ring-2 ring-offset-2 ring-offset-gray-800 ring-white' : ''}`}
                                            style={{ backgroundColor: color }}
                                            aria-label={`Select color ${color}`}
                                        />
                                    ))}
                                </div>
                            </div>
                            {chordTypeError && <p className="text-red-400 text-sm">{chordTypeError}</p>}
                             <div className="flex gap-2">
                                <button type="submit" className="flex-1 p-2 rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors">
                                    Salva Tipo Accordo
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    className="p-2 rounded-md text-white font-semibold transition-all duration-200 bg-red-600 hover:bg-red-500"
                                >
                                    Pulisci
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-2">
                    <h3 className="font-bold text-lg text-white border-b border-gray-600 pb-2">Voicings Salvati</h3>
                    <div className="flex gap-2 pt-2">
                        <button
                            type="button"
                            onClick={handleSaveVoicingToApp}
                            className="flex-1 p-2 rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors"
                        >
                            Salva Voicing
                        </button>
                    </div>
                    {voicingSaveMessage && <p className="text-sm text-gray-300">{voicingSaveMessage}</p>}
                    <ul className="space-y-1 pt-2 max-h-28 overflow-y-auto">
                        {customVoicings
                            .filter(v => v.chordType === chordType && v.rootNoteIndex === rootNoteIndex)
                            .map(v => (
                                <li key={v.id} className="flex justify-between items-center bg-gray-700 p-1.5 rounded-md text-sm">
                                    <span>{v.name}</span>
                                    <button
                                        onClick={() => deleteCustomVoicing(v.id)}
                                        className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-gray-600"
                                        title="Elimina voicing"
                                    >
                                        <TrashIcon />
                                    </button>
                                </li>
                            ))}
                    </ul>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-2">
                    <h3 className="font-bold text-lg text-white border-b border-gray-600 pb-2">Tipi di Accordi Salvati</h3>
                    <ul className="space-y-1 pt-2 max-h-24 overflow-y-auto">
                        {customChords.map(chord => (
                            <li key={chord.name} className="flex justify-between items-center bg-gray-700 p-1.5 rounded-md text-sm">
                                <span>{chord.name}</span>
                                <button onClick={() => deleteCustomChord(chord.name)} className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-gray-600">
                                    <TrashIcon />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-2">
                    <h3 className="font-bold text-lg text-white border-b border-gray-600 pb-2">Codice Generato</h3>
                    <div className="text-xs text-gray-400 mt-[-4px] mb-2 p-2 bg-gray-900/50 rounded-md">
                        <p className="font-bold text-gray-300">Come Salvare una Nuova *Diteggiatura* (Voicing):</p>
                        <p>Questo editor non salva automaticamente le diteggiature. Copia il codice generato qui sotto, che include le istruzioni su dove incollarlo nel file `data/guitarVoicings.ts`.</p>
                    </div>
                    <div className="relative">
                        <textarea
                            readOnly
                            value={generatedCode}
                            className="w-full h-32 bg-gray-900 text-cyan-300 font-mono text-xs p-2 border border-gray-600 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
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

export default ChordEditorComponent;