import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { DynamicLevel } from '../utils/dynamics';

/**
 * Tavolozza dei SEGNI, flottante e trascinabile (stesso modello del modulo
 * percussioni e del mixer). Nasce per le dinamiche ma è pensata per ospitare in
 * seguito accenti, staccati e legature, così non se ne dovrà aprire una seconda.
 *
 * Come si usa: si seleziona una nota e si clicca il segno — il segno si piazza in
 * quel punto e vale per TUTTE le voci. Per una forcella si selezionano due note
 * (la prima e l'ultima) e si clicca *cresc.* o *dim.*
 */
interface DynamicsPalettePanelProps {
    /** Quante note sono selezionate: serve per abilitare/spiegare i comandi. */
    selectionCount: number;
    /** Segni già presenti nel punto selezionato (per il pulsante "togli"). */
    hasMarkAtSelection: boolean;
    onPlaceLevel: (level: DynamicLevel) => void;
    onPlaceAccent: (label: 'sf' | 'sfz' | 'rf') => void;
    onPlaceFp: () => void;
    onPlaceHairpin: (direction: 'cresc' | 'dim') => void;
    onRemoveAtSelection: () => void;
    onClose: () => void;
}

const LIVELLI: DynamicLevel[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

const DynamicsPalettePanel: React.FC<DynamicsPalettePanelProps> = ({
    selectionCount, hasMarkAtSelection,
    onPlaceLevel, onPlaceAccent, onPlaceFp, onPlaceHairpin, onRemoveAtSelection, onClose,
}) => {
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 200, y: 120 });
    const dragRef = useRef<{ dx: number; dy: number } | null>(null);

    const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    }, [pos]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dragRef.current.dx));
            const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragRef.current.dy));
            setPos({ x, y });
        };
        const onUp = () => { dragRef.current = null; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

    const nessunaNota = selectionCount === 0;
    const unaSola = selectionCount === 1;
    const bottone = 'h-7 px-2 text-[11px] font-bold rounded border transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
    const attivo = 'bg-slate-700 text-gray-100 border-slate-600 hover:bg-slate-600 active:bg-sky-600 active:text-white';

    return (
        <div
            style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000, width: 268 }}
            className="bg-slate-800 rounded-lg shadow-2xl border border-slate-700 select-none"
        >
            <div
                onMouseDown={onTitleMouseDown}
                className="flex items-center justify-between px-2 py-1 bg-slate-900 rounded-t-lg cursor-move"
            >
                <span className="text-[11px] font-bold text-gray-300 tracking-wide truncate">
                    𝆑 Segni — dinamiche
                </span>
                <button
                    onClick={onClose}
                    title="Chiudi la tavolozza dei segni"
                    className="w-5 h-5 text-gray-500 hover:text-gray-200 flex items-center justify-center text-xs rounded transition-colors"
                >
                    ✕
                </button>
            </div>

            <div className="p-2">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Livelli</div>
                <div className="grid grid-cols-4 gap-1">
                    {LIVELLI.map(l => (
                        <button
                            key={l}
                            disabled={!unaSola}
                            onClick={() => onPlaceLevel(l)}
                            title={unaSola ? `Metti ${l} sulla nota selezionata (vale per tutte le voci)` : 'Seleziona una nota'}
                            className={`${bottone} ${attivo} italic`}
                            style={{ fontFamily: 'serif' }}
                        >
                            {l}
                        </button>
                    ))}
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-2 mb-1">Accenti</div>
                <div className="grid grid-cols-4 gap-1">
                    {(['sf', 'sfz', 'rf'] as const).map(a => (
                        <button
                            key={a}
                            disabled={!unaSola}
                            onClick={() => onPlaceAccent(a)}
                            title={`Accento ${a} su quella sola nota`}
                            className={`${bottone} ${attivo} italic`}
                            style={{ fontFamily: 'serif' }}
                        >
                            {a}
                        </button>
                    ))}
                    <button
                        disabled={!unaSola}
                        onClick={onPlaceFp}
                        title="Forte piano: attacco forte, poi si resta piano"
                        className={`${bottone} ${attivo} italic`}
                        style={{ fontFamily: 'serif' }}
                    >
                        fp
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-2 mb-1">Forcelle</div>
                <div className="grid grid-cols-2 gap-1">
                    <button
                        disabled={selectionCount < 2}
                        onClick={() => onPlaceHairpin('cresc')}
                        title={selectionCount >= 2 ? 'Crescendo dalla prima all\'ultima nota selezionata' : 'Seleziona due note'}
                        className={`${bottone} ${attivo}`}
                    >
                        ⟨ cresc.
                    </button>
                    <button
                        disabled={selectionCount < 2}
                        onClick={() => onPlaceHairpin('dim')}
                        title={selectionCount >= 2 ? 'Diminuendo dalla prima all\'ultima nota selezionata' : 'Seleziona due note'}
                        className={`${bottone} ${attivo}`}
                    >
                        dim. ⟩
                    </button>
                </div>

                <button
                    disabled={!hasMarkAtSelection}
                    onClick={onRemoveAtSelection}
                    title="Togli i segni che stanno nel punto selezionato"
                    className={`${bottone} w-full mt-2 bg-slate-700 text-gray-300 border-slate-600 hover:bg-rose-700 hover:text-white hover:border-rose-600`}
                >
                    Togli il segno qui
                </button>

                <div className="text-[9px] text-gray-400 mt-2 leading-snug">
                    {nessunaNota
                        ? 'Seleziona una nota, poi clicca un segno. I segni valgono per tutte le voci.'
                        : unaSola
                            ? 'Clicca un livello o un accento per metterlo qui. Per una forcella seleziona due note.'
                            : `${selectionCount} note selezionate: la forcella va dalla prima all'ultima.`}
                </div>
            </div>
        </div>
    );
};

export default DynamicsPalettePanel;
