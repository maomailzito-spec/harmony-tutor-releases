import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { DynamicLevel } from '../utils/dynamics';
import type { SignDragPayload } from '../hooks/useSignDrag';
import type { ArticulationMark } from '../types';
import { ARTICULATIONS, ARTICULATION_UI } from '../utils/articulations';

/**
 * Tavolozza dei SEGNI, flottante e trascinabile (stesso modello del modulo
 * percussioni e del mixer). Nata per le dinamiche, ospita ora anche le articolazioni;
 * quando si affollerà andrà divisa in sotto-menù per argomento.
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
    /** Articolazioni: stanno sulla NOTA, quindi valgono per tutte quelle selezionate
     *  (e trascinandole si posano su quella sotto il puntatore). Rimettere lo stesso
     *  segno lo toglie. */
    onPlaceArticulation: (a: ArticulationMark) => void;
    onRemoveAtSelection: () => void;
    onClose: () => void;
    /** Battute: comandi che non sono "segni da posare" ma azioni su una misura. */
    onAddMeasure: () => void;
    onDeleteMeasureAtPlayhead: () => void;
    /** Metro corrente del brano: i contatori della tavolozza partono da lì. */
    currentTimeSignature: { numerator: number; denominator: number };
    /** Toglie il cambio di metro nella misura dov'è il cursore. */
    onRemoveTimeSignatureAtPlayhead: () => void;
    /** Prendi-e-posa: si afferra il pulsante e si molla il segno sulla partitura.
     *  Il clic semplice continua a funzionare (mette il segno sulla nota selezionata). */
    onStartDrag: (payload: SignDragPayload, e: React.MouseEvent) => void;
}

const LIVELLI: DynamicLevel[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

const DynamicsPalettePanel: React.FC<DynamicsPalettePanelProps> = ({
    selectionCount, hasMarkAtSelection,
    onPlaceLevel, onPlaceAccent, onPlaceFp, onPlaceHairpin, onPlaceArticulation, onRemoveAtSelection, onClose, onStartDrag, onAddMeasure, onDeleteMeasureAtPlayhead, currentTimeSignature, onRemoveTimeSignatureAtPlayhead,
}) => {
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 200, y: 120 });
    // Valori del metro da posare: partono da quello del brano e si regolano qui,
    // così il cambio si trascina già pronto senza passare da un altro pannello.
    const [metroN, setMetroN] = useState<number>(currentTimeSignature?.numerator ?? 4);
    const [metroD, setMetroD] = useState<number>(currentTimeSignature?.denominator ?? 4);
    const DENOMINATORI = [1, 2, 4, 8, 16];
    // Testo da posare: si scrive qui e poi si trascina la T dove serve, come per il
    // metro. Così il segno arriva sulla partitura già pronto.
    const [testo, setTesto] = useState<string>('');
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
                    𝆑 Segni
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
                            onMouseDown={(e) => onStartDrag({ kind: 'dyn-level', data: l, label: l }, e)}
                            onClick={() => { if (unaSola) onPlaceLevel(l); }}
                            title={`Trascina ${l} sulla partitura, oppure seleziona una nota e clicca`}
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
                            onMouseDown={(e) => onStartDrag({ kind: 'dyn-accent', data: a, label: a }, e)}
                            onClick={() => { if (unaSola) onPlaceAccent(a); }}
                            title={`Trascina ${a} sulla partitura, oppure seleziona una nota e clicca`}
                            className={`${bottone} ${attivo} italic`}
                            style={{ fontFamily: 'serif' }}
                        >
                            {a}
                        </button>
                    ))}
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'dyn-fp', label: 'fp' }, e)}
                        onClick={() => { if (unaSola) onPlaceFp(); }}
                        title="Forte piano: trascinalo sulla partitura, oppure seleziona una nota e clicca"
                        className={`${bottone} ${attivo} italic`}
                        style={{ fontFamily: 'serif' }}
                    >
                        fp
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-2 mb-1">Forcelle</div>
                <div className="grid grid-cols-2 gap-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'dyn-hairpin', data: 'cresc', label: '⟨ cresc.' }, e)}
                        onClick={() => { if (selectionCount >= 2) onPlaceHairpin('cresc'); }}
                        title="Trascina il crescendo sulla partitura (poi allungalo dai capi), oppure seleziona due note e clicca"
                        className={`${bottone} ${attivo}`}
                    >
                        ⟨ cresc.
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'dyn-hairpin', data: 'dim', label: 'dim. ⟩' }, e)}
                        onClick={() => { if (selectionCount >= 2) onPlaceHairpin('dim'); }}
                        title="Trascina il diminuendo sulla partitura (poi accorcialo dai capi), oppure seleziona due note e clicca"
                        className={`${bottone} ${attivo}`}
                    >
                        dim. ⟩
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-3 mb-1">Articolazioni</div>
                <div className="grid grid-cols-5 gap-1">
                    {ARTICULATIONS.map(a => (
                        <button
                            key={a}
                            onMouseDown={(e) => onStartDrag({ kind: 'articulation', data: a, label: ARTICULATION_UI[a].simbolo }, e)}
                            onClick={() => { if (selectionCount > 0) onPlaceArticulation(a); }}
                            title={`${ARTICULATION_UI[a].nome}: trascinalo su una nota, oppure seleziona le note e clicca. Rimettendolo si toglie.`}
                            className={`${bottone} ${attivo} px-1`}
                            style={{ fontFamily: 'serif', lineHeight: 1 }}
                        >
                            {ARTICULATION_UI[a].simbolo}
                        </button>
                    ))}
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-3 mb-1">Tempo</div>
                <div className="grid grid-cols-2 gap-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'tempo-curve', data: 'rall', label: 'rall.' }, e)}
                        title="Rallentando: trascinalo dove comincia (copre due misure, poi si chiedono i valori)"
                        className={`${bottone} ${attivo} italic`}
                        style={{ fontFamily: 'serif' }}
                    >
                        rall.
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'tempo-curve', data: 'accel', label: 'accel.' }, e)}
                        title="Accelerando: trascinalo dove comincia (copre due misure, poi si chiedono i valori)"
                        className={`${bottone} ${attivo} italic`}
                        style={{ fontFamily: 'serif' }}
                    >
                        accel.
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-3 mb-1">Metro</div>
                <div className="flex items-center gap-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'time-sig', data: { n: metroN, d: metroD }, label: `${metroN}/${metroD}` }, e)}
                        title={`Cambio di metro ${metroN}/${metroD}: trascinalo sulla misura da cui vale`}
                        className={`${bottone} ${attivo} px-3`}
                        style={{ fontFamily: 'serif', fontSize: 13 }}
                    >
                        {metroN}/{metroD}
                    </button>
                    <div className="flex items-center gap-0.5">
                        <button onClick={() => setMetroN(v => Math.max(1, v - 1))} className={`${bottone} ${attivo} px-1.5`} title="Meno movimenti">−</button>
                        <span className="text-[10px] text-gray-400 w-4 text-center">{metroN}</span>
                        <button onClick={() => setMetroN(v => Math.min(32, v + 1))} className={`${bottone} ${attivo} px-1.5`} title="Più movimenti">+</button>
                    </div>
                    <select
                        value={metroD}
                        onChange={(e) => setMetroD(Number(e.target.value))}
                        title="Valore del movimento"
                        className="h-7 text-[11px] bg-slate-700 text-gray-100 border border-slate-600 rounded px-1"
                    >
                        {DENOMINATORI.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
                <button
                    onClick={onRemoveTimeSignatureAtPlayhead}
                    title="Togli il cambio di metro dalla misura in cui si trova il cursore"
                    className={`${bottone} w-full mt-1 bg-slate-700 text-gray-300 border-slate-600 hover:bg-rose-700 hover:text-white hover:border-rose-600`}
                >
                    Togli il cambio di metro
                </button>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-3 mb-1">Testo</div>
                <div className="flex items-center gap-1">
                    <button
                        onMouseDown={(e) => { if (testo.trim()) onStartDrag({ kind: 'text-marker', data: testo.trim(), label: testo.trim() }, e); }}
                        disabled={!testo.trim()}
                        title={testo.trim() ? `Trascina "${testo.trim()}" sul punto della partitura` : 'Scrivi prima il testo qui accanto'}
                        className={`${bottone} ${attivo} px-3`}
                        style={{ fontFamily: 'serif', fontSize: 15 }}
                    >
                        T
                    </button>
                    <input
                        value={testo}
                        onChange={(e) => setTesto(e.target.value)}
                        placeholder="dolce, poco rit., Fine…"
                        className="flex-1 h-7 text-[11px] bg-slate-700 text-gray-100 border border-slate-600 rounded px-2 placeholder-gray-500"
                    />
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-3 mb-1">Battute</div>
                <div className="grid grid-cols-4 gap-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'bar-double', label: '𝄀𝄀' }, e)}
                        title="Doppia barra: trascinala sulla misura dove deve comparire"
                        className={`${bottone} ${attivo}`}
                    >
                        𝄀𝄀
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'bar-repeat', data: 'repeat-begin', label: '𝄆' }, e)}
                        title="Inizio ritornello: trascinalo sulla misura da cui si riprende"
                        className={`${bottone} ${attivo}`}
                    >
                        𝄆
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'bar-repeat', data: 'repeat-end', label: '𝄇' }, e)}
                        title="Fine ritornello: trascinalo sulla misura dove si torna indietro"
                        className={`${bottone} ${attivo}`}
                    >
                        𝄇
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'bar-repeat', data: 'repeat-both', label: '𝄆𝄇' }, e)}
                        title="Ritornello doppio: finisce qui e ricomincia"
                        className={`${bottone} ${attivo}`}
                    >
                        𝄆𝄇
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'measure-add', label: '+ misura' }, e)}
                        onClick={onAddMeasure}
                        title="Trascinalo sulla misura davanti a cui inserire una misura vuota (clic: al cursore)"
                        className={`${bottone} ${attivo}`}
                    >
                        + misura
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'measure-del', label: '− misura' }, e)}
                        onClick={onDeleteMeasureAtPlayhead}
                        title="Trascinalo sulla misura da togliere (clic: quella del cursore)"
                        className={`${bottone} bg-slate-700 text-gray-300 border-slate-600 hover:bg-rose-700 hover:text-white hover:border-rose-600`}
                    >
                        − misura
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
                    Trascina un segno dove vuoi sulla partitura. Oppure: seleziona una nota e
                    clicca il segno (due note per una forcella). Sul rigo i segni si spostano
                    trascinandoli e si tolgono col tasto destro. Valgono per tutte le voci.
                </div>
            </div>
        </div>
    );
};

export default DynamicsPalettePanel;
