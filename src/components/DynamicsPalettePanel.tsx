import React, { useState, useRef, useEffect, useCallback } from 'react';
// Le icone delle durate sono quelle della toolbar, non glifi Unicode: i caratteri
// musicali composti (nota + bandierina) li disegna il font di sistema, e le bandierine
// di sedicesimi e trentaduesimi uscivano rovesciate. Un'icona disegnata da noi si vede
// com'è, ovunque — e il set ha già le pause e i sessantaquattresimi.
import {
    WholeNoteIcon, HalfNoteIcon, QuarterNoteIcon, EighthNoteIcon,
    SixteenthNoteIcon, ThirtySecondNoteIcon, SixtyFourthNoteIcon,
    QuarterRestIcon,
} from './icons/NoteValueIcons';
import type { DynamicLevel } from '../utils/dynamics';
import type { SignDragPayload } from '../hooks/useSignDrag';
import type { ArticulationMark } from '../types';
import { ARTICULATIONS, ARTICULATION_UI } from '../utils/articulations';

/**
 * Tavolozza dei SEGNI, flottante e trascinabile (stesso modello del modulo percussioni
 * e del mixer). Undici famiglie di segni raccolte in TRE gruppi a fisarmonica, secondo
 * che cosa il segno riguardi: l'intensità (dinamiche), il modo di attaccare e collegare
 * i suoni (articolazioni ed espressione), l'impianto della pagina (struttura). Gli accenti
 * compaiono in due gruppi perché sono due cose diverse: sf/sfz/rf sono accenti DINAMICI,
 * > e ^ accenti d'ARTICOLAZIONE.
 *
 * A fisarmonica e NON a tendina: una tendina si chiude al primo movimento del mouse, e
 * qui il gesto principale è trascinare il segno sulla partitura — si chiuderebbe sempre
 * a metà strada. Un gruppo aperto per volta, così la tavolozza resta corta.
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
    /** Legatura di portamento: fra le due note selezionate (o trascinata su una nota,
     *  e allora arriva alla successiva). Rifarla sulla stessa coppia la toglie. */
    onPlaceSlur: () => void;
    /** Segno d'ottava sopra (8va) o sotto (8vb) per le note selezionate. */
    onPlaceOctave: (direction: 'up' | 'down') => void;
    /** Armatura d'impianto del brano: i selettori partono da lì. */
    currentKeyRoot: string;
    currentKeyIsMinor: boolean;
    /** Toglie il cambio d'armatura nella misura dov'è il cursore. */
    onRemoveKeySignatureAtPlayhead: () => void;
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

/** Le armature come si susseguono per quinte, dai bemolli ai diesis. */
const TONALITA = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

/** Unità di battito di un segno di metronomo, col suo glifo. */
type UnitaBattito = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';
const UNITA_GLIFO: Record<UnitaBattito, string> = {
    whole: '\u{1D15D}',
    half: '\u{1D15E}',
    quarter: '♩',
    eighth: '♪',
    sixteenth: '\u{1D161}',
};

const DynamicsPalettePanel: React.FC<DynamicsPalettePanelProps & {
    /** Agganciata a sinistra: occupa il margine che la riga dello spartito le lascia. */
    agganciata?: boolean;
    /** Dov'è la riga dello spartito, misurata dall'editor: la tavolozza agganciata ci si
     *  appoggia esattamente, invece di indovinare dove cominci il contenuto. */
    ancoraggio?: { left: number; top: number; height: number } | null;
    onToggleAggancio?: () => void;
    /** Apre la casella di testo SULLA PARTITURA, dov'è il cursore di lettura. */
    onScriviTestoAlCursore?: () => void;

    // ── Le tre sezioni arrivate dalla toolbar ──
    durata?: { type: 'note' | 'rest'; duration: string; isDotted?: boolean };
    onSetDurata?: (d: string) => void;
    onTogglePausa?: () => void;
    onTogglePunto?: () => void;
    /** Pattern d'accompagnamento: si mostrano quando si sta lavorando SU una traccia,
     *  non solo quando ne esiste una. È la stessa condizione della toolbar. */
    accPattern?: string;
    onSetAccPattern?: (id: any) => void;
    accLetRing?: boolean;
    onToggleAccLetRing?: () => void;
    suTracciaAcc?: boolean;
    /** Trasformazioni melodiche: agiscono sulla selezione. */
    transformMode?: 'tonal' | 'real';
    onToggleTransformMode?: () => void;
    onMelodicTransform?: (kind: 'transpose' | 'invert' | 'retrograde' | 'retrogradeInvert', opts?: { amount?: number }) => void;
}> = ({
    agganciata: agganciataProp, ancoraggio, onToggleAggancio, onScriviTestoAlCursore,
    durata, onSetDurata, onTogglePausa, onTogglePunto,
    accPattern, onSetAccPattern, accLetRing, onToggleAccLetRing, suTracciaAcc,
    transformMode, onToggleTransformMode, onMelodicTransform,
    selectionCount, hasMarkAtSelection,
    onPlaceLevel, onPlaceAccent, onPlaceFp, onPlaceHairpin, onPlaceArticulation, onPlaceSlur, onPlaceOctave, currentKeyRoot, currentKeyIsMinor, onRemoveKeySignatureAtPlayhead, onRemoveAtSelection, onClose, onStartDrag, onAddMeasure, onDeleteMeasureAtPlayhead, currentTimeSignature, onRemoveTimeSignatureAtPlayhead,
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
    // Segno di metronomo da posare. L'unità è quella che si vuole STAMPARE: «𝅗𝅥 = 70»
    // e «♩ = 140» sono la stessa velocità ma non la stessa indicazione, e in partitura
    // si scrive quella che si legge meglio col metro che c'è.
    const [tempoBpm, setTempoBpm] = useState<number>(80);
    const [tempoUnita, setTempoUnita] = useState<UnitaBattito>('quarter');
    const [tempoPunto, setTempoPunto] = useState<boolean>(false);
    // Armatura da posare: si sceglie qui e si trascina sulla misura da cui vale, come il
    // metro. Le tonalità sono elencate come si scrivono in partitura (per quinte).
    const [tonalita, setTonalita] = useState<string>(currentKeyRoot || 'C');
    const [tonalitaMinore, setTonalitaMinore] = useState<boolean>(!!currentKeyIsMinor);
    /**
     * QUALI GRUPPI SONO APERTI — più d'uno, e la scelta si ricorda.
     *
     * Resta un accordion e non un menù a tendina, per la ragione di sempre: il gesto
     * principale è TRASCINARE il segno sulla partitura, e una tendina si chiuderebbe al
     * primo movimento del mouse. Ma l'esclusività — uno alla volta — serviva a tenere
     * corta la tavolozza, e quel vincolo non c'è: la tavolozza GALLEGGIA, non è un
     * popover appeso alla toolbar, quindi l'altezza non è imposta da nessuno. Chi usa
     * sempre dinamica e articolazione se li tiene aperti e non riapre più niente.
     */
    const [aperti, setAperti] = useState<Set<string>>(() => {
        try {
            const salvati = JSON.parse(localStorage.getItem('harmony-tutor.tavolozzaAperti.v1') || 'null');
            if (Array.isArray(salvati)) return new Set(salvati.filter((x: any) => typeof x === 'string'));
        } catch { /* niente di salvato: si parte dalle dinamiche */ }
        return new Set(['dinamica']);
    });
    const alterna = useCallback((id: string) => {
        setAperti(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            try { localStorage.setItem('harmony-tutor.tavolozzaAperti.v1', JSON.stringify([...next])); } catch { /* ignora */ }
            return next;
        });
    }, []);

    /**
     * RICERCA. Non riorganizza niente: apre il gruppo che contiene quello che cerchi.
     *
     * È il pezzo che rende inoffensiva una tassonomia imperfetta, e nessuna tassonomia
     * è perfetta — «rall.» può stare sotto espressione, agogica o tempo a seconda di chi
     * la cerca. Scrivendo `rall` il gruppo giusto si apre da sé, e non serve indovinare
     * la categoria mentale di chi usa il programma.
     */
    const [ricerca, setRicerca] = useState('');
    const PAROLE: Record<string, string> = {
        dinamica: 'dinamica dinamiche piano forte pianissimo fortissimo pp p mp mf f ff fff sf sfz rf fp accento accenti forcella forcelle crescendo diminuendo cresc dim livelli',
        articolazione: 'articolazione articolazioni staccato staccatissimo tenuto marcato accento legatura legature portamento slur tempo rallentando accelerando rall accel curva testo scritta parole dolce fine cvii posizione',
        durate: 'durata durate valore valori nota note pausa pause semibreve minima semiminima croma semicroma biscroma punto puntata terzina',
        pattern: 'pattern arpeggio arpeggi accompagnamento albertino ondulato spezzato blocco pedale risonanza let ring',
        trasformazioni: 'trasformazione trasformazioni motivo motivi melodico trasposizione trasponi inversione inverti retrogrado retrogrado-inverso tonale reale',
        struttura: 'struttura armatura tonalità chiave metro tempo misura misure battuta battute barra doppia ritornello ritornelli volta ottava 8va 8vb andamento metronomo bpm velocità corona fermata',
    };
    const q = ricerca.trim().toLowerCase();
    const combacia = useCallback((id: string) => !q || (PAROLE[id] || '').includes(q), [q]);
    /** Cercando, i gruppi che combaciano si aprono da soli; senza ricerca vale la scelta. */
    const apertoOra = useCallback((id: string) => (q ? combacia(id) : aperti.has(id)), [q, combacia, aperti]);
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
    const agganciata = !!agganciataProp;
    // DENSITÀ. Erano 28 px d'altezza e 8 di margine per lato, per contenere un glifo da
    // 11: sessanta pixel di pulsante per undici di contenuto, cinque volte e mezzo. Il
    // margine largo serviva alla simmetria del modulo, e il modulo era largo perché i
    // pulsanti lo erano — un cerchio che si autoalimenta. Rotto dal lato dei pulsanti.
    const bottone = 'h-6 px-1 text-[11px] font-bold rounded border transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
    const attivo = 'bg-slate-700 text-gray-100 border-slate-600 hover:bg-slate-600 active:bg-sky-600 active:text-white';

    return (
        /* AGGANCIATA o GALLEGGIANTE.
         *
         * Da agganciata è un elemento della riga flex che contiene lo spartito: lo
         * spartito si stringe da sé e si reimpagina, perché la sua larghezza la misura
         * un ResizeObserver sul contenitore. È il modello Guitar Pro — la pagina fa
         * posto invece di finirci sotto.
         *
         * Da galleggiante copre lo spartito ma si mette dove si vuole. Le due cose
         * servono a momenti diversi: agganciata mentre si scrive, galleggiante quando
         * serve solo un segno e non si vuole rimpaginare tutto. */
        <div
            style={(agganciata && ancoraggio)
                ? {
                    position: 'fixed', left: ancoraggio.left, top: ancoraggio.top,
                    height: ancoraggio.height, width: 208, zIndex: 900,
                    display: 'flex', flexDirection: 'column',
                }
                : {
                    position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000, width: 208,
                    maxHeight: 'calc(100vh - 96px)', display: 'flex', flexDirection: 'column',
                }}
            className={`bg-slate-800 border border-slate-700 select-none ${agganciata ? 'rounded-lg' : 'rounded-lg shadow-2xl'}`}
        >
            <div
                onMouseDown={agganciata ? undefined : onTitleMouseDown}
                className={`flex items-center justify-between px-2 py-1 bg-slate-900 rounded-t-lg shrink-0 ${agganciata ? '' : 'cursor-move'}`}
            >
                <span className="text-[11px] font-bold text-gray-300 tracking-wide truncate">
                    {agganciata ? '𝆑 Segni' : '⠿ 𝆑 Segni'}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                    {onToggleAggancio && (
                        <button
                            onClick={onToggleAggancio}
                            title={agganciata
                                ? 'Sgancia: torna a galleggiare sopra la partitura, e si sposta dove vuoi'
                                : 'Aggancia a sinistra: la partitura si stringe e le fa posto'}
                            className="w-5 h-5 text-gray-500 hover:text-gray-200 flex items-center justify-center text-[11px] rounded"
                        >
                            {agganciata ? '⇥' : '⇤'}
                        </button>
                    )}
                </div>
                <button
                    onClick={onClose}
                    title="Chiudi la tavolozza dei segni"
                    className="w-5 h-5 text-gray-500 hover:text-gray-200 flex items-center justify-center text-xs rounded transition-colors"
                >
                    ✕
                </button>
            </div>

            {/* IL CORPO SCORRE. Con tutti i gruppi aperti l'ultimo finiva tagliato fuori
                dal pannello: un pannello che non scorre ha un'altezza massima anche se
                nessuno gliel'ha detta, ed è quella dello schermo. */}
            <div className="p-2 overflow-y-auto min-h-0">
                {/* RICERCA — apre il gruppo che contiene quello che cerchi. Non filtra i
                    singoli pulsanti: quelli si trascinano, e un elenco che si accorcia
                    sotto il puntatore mentre stai per afferrare un segno è peggio del
                    problema che risolve. */}
                <div className="flex items-center gap-1.5 rounded-md bg-slate-900/70 border border-slate-600 px-2 py-1 mb-1">
                    <span className="text-[11px] text-slate-500">⌕</span>
                    <input
                        value={ricerca}
                        onChange={(e) => setRicerca(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();   // le lettere non devono scrivere note
                            if (e.key === 'Escape') { e.preventDefault(); setRicerca(''); }
                        }}
                        placeholder="cerca un segno…"
                        aria-label="Cerca un segno nella tavolozza"
                        className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-100 placeholder:text-slate-500 outline-none"
                    />
                    {ricerca && (
                        <button
                            onClick={() => setRicerca('')}
                            title="Annulla la ricerca"
                            className="text-[11px] text-slate-500 hover:text-slate-200"
                        >
                            ✕
                        </button>
                    )}
                </div>
                {q && !['dinamica', 'articolazione', 'struttura', 'durate', 'pattern', 'trasformazioni'].some(combacia) && (
                    <div className="px-1 pb-1 text-[10px] text-amber-400">
                        Nessun segno con «{ricerca}».
                    </div>
                )}

                {/* ── Durate ── PRIMA di tutto: è quello che si tocca a ogni nota. */}
                <button
                    onClick={() => alterna('durate')}
                    className="w-full flex items-center justify-between rounded-md px-2 py-0.5 mt-0.5 first:mt-0 text-left text-[11px] font-bold text-gray-200 bg-slate-700/60 hover:bg-slate-700 transition-colors"
                >
                    <span>Durate</span>
                    <span className="text-[10px] text-gray-400">{apertoOra('durate') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('durate') && (
                    <div className="px-0.5 pb-0.5">
                        <div className="grid grid-cols-7 gap-1 mt-1">
                            {([
                                ['whole', WholeNoteIcon, 'Semibreve'],
                                ['half', HalfNoteIcon, 'Minima'],
                                ['quarter', QuarterNoteIcon, 'Semiminima'],
                                ['eighth', EighthNoteIcon, 'Croma'],
                                ['sixteenth', SixteenthNoteIcon, 'Semicroma'],
                                ['thirty-second', ThirtySecondNoteIcon, 'Biscroma'],
                                ['sixty-fourth', SixtyFourthNoteIcon, 'Semibiscroma'],
                            ] as const).map(([d, Icona, nome]) => (
                                <button
                                    key={d}
                                    onClick={() => onSetDurata?.(d)}
                                    title={nome}
                                    aria-label={nome}
                                    className={`${bottone} px-0 flex items-center justify-center ${durata?.duration === d ? 'bg-cyan-600 text-white border-cyan-500' : attivo}`}
                                >
                                    <Icona className="h-4 w-4" />
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                            {/* L'interruttore mostra la PAUSA, non lo stato: un pulsante che
                                dice «nota» mentre stai già inserendo note non dice niente.
                                Acceso = si stanno inserendo pause. */}
                            <button
                                onClick={onTogglePausa}
                                title={durata?.type === 'rest' ? 'Stai inserendo PAUSE — clicca per tornare alle note (R)' : 'Inserisci pause (R)'}
                                aria-label="Alterna nota e pausa"
                                className={`${bottone} px-0 flex items-center justify-center ${durata?.type === 'rest' ? 'bg-cyan-600 text-white border-cyan-500' : attivo}`}
                            >
                                <QuarterRestIcon className="h-4 w-4" />
                            </button>
                            <button
                                onClick={onTogglePunto}
                                title="Punto di valore (.)"
                                className={`${bottone} ${durata?.isDotted ? 'bg-cyan-600 text-white border-cyan-500' : attivo}`}
                            >
                                ♩.
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Pattern ── contestuale: senza tracce ACC non ha nulla su cui agire. */}
                {suTracciaAcc && (
                    <>
                        <button
                            onClick={() => alterna('pattern')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-0.5 mt-0.5 text-left text-[11px] font-bold text-gray-200 bg-slate-700/60 hover:bg-slate-700 transition-colors"
                        >
                            <span>Pattern</span>
                            <span className="text-[10px] text-gray-400">{apertoOra('pattern') ? '▾' : '▸'}</span>
                        </button>
                        {apertoOra('pattern') && (
                            <div className="px-0.5 pb-0.5">
                                <div className="grid grid-cols-3 gap-1 mt-1">
                                    {([
                                        ['block', 'Bl', 'Accordi a blocco'],
                                        ['arpeggio_up', 'Ar▲', 'Arpeggio ascendente'],
                                        ['arpeggio_down', 'Ar▼', 'Arpeggio discendente'],
                                        ['broken', 'Brk', 'Spezzato (boom-chick)'],
                                        ['albertino', 'Alb', 'Basso albertino (0-2-1-2)'],
                                        ['ondulato', 'Ond', 'Ondulato (su e giù)'],
                                    ] as const).map(([id, lab, tit]) => (
                                        <button
                                            key={id}
                                            onClick={() => onSetAccPattern?.(id)}
                                            title={tit}
                                            className={`${bottone} font-mono ${accPattern === id ? 'bg-cyan-600 text-white border-cyan-500' : attivo}`}
                                        >
                                            {lab}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={onToggleAccLetRing}
                                    title="Pedale: le note del pattern restano a risuonare"
                                    className={`${bottone} w-full mt-1 font-mono ${accLetRing ? 'bg-cyan-600 text-white border-cyan-500' : attivo}`}
                                >
                                    Ped
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* ── Trasformazioni ── agiscono sulla SELEZIONE, non sul cursore. */}
                <button
                    onClick={() => alterna('trasformazioni')}
                    className="w-full flex items-center justify-between rounded-md px-2 py-0.5 mt-0.5 text-left text-[11px] font-bold text-gray-200 bg-slate-700/60 hover:bg-slate-700 transition-colors"
                >
                    <span>Trasformazioni</span>
                    <span className="text-[10px] text-gray-400">{apertoOra('trasformazioni') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('trasformazioni') && (
                    <div className="px-0.5 pb-0.5">
                        {/* Il modo sta SOPRA e da solo: è un modificatore che vale per
                            tutte e cinque le operazioni sotto, non una sesta operazione.
                            In toolbar l'ambiguità passava, in colonna no. */}
                        <button
                            onClick={onToggleTransformMode}
                            title={transformMode === 'tonal'
                                ? 'Trasformazioni TONALI (in chiave, per gradi). Clicca per passare a reali.'
                                : 'Trasformazioni REALI (cromatiche). Inversione e retro-inverso escono dalla tonalità.'}
                            className={`${bottone} w-full mt-1 font-mono ${transformMode === 'tonal' ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-amber-600 text-white border-amber-500'}`}
                        >
                            {transformMode === 'tonal' ? 'Tonali' : 'Reali'}
                        </button>
                        <div className="grid grid-cols-3 gap-1 mt-1">
                            <button onClick={() => onMelodicTransform?.('transpose', { amount: 1 })} disabled={!selectionCount} title="Trasponi su" className={`${bottone} ${attivo} font-mono`}>T▲</button>
                            <button onClick={() => onMelodicTransform?.('transpose', { amount: -1 })} disabled={!selectionCount} title="Trasponi giù" className={`${bottone} ${attivo} font-mono`}>T▼</button>
                            <button onClick={() => onMelodicTransform?.('invert')} disabled={!selectionCount} title="Inversione" className={`${bottone} ${attivo} font-mono`}>Inv</button>
                            <button onClick={() => onMelodicTransform?.('retrograde')} disabled={!selectionCount} title="Retrogrado" className={`${bottone} ${attivo} font-mono`}>Retr</button>
                            <button onClick={() => onMelodicTransform?.('retrogradeInvert')} disabled={!selectionCount} title="Retrogrado-inverso" className={`${bottone} ${attivo} font-mono`}>R+I</button>
                        </div>
                    </div>
                )}

                {/* ── Dinamiche ── */}
                <button
                    onClick={() => alterna('dinamica')}
                    className="w-full flex items-center justify-between rounded-md px-2 py-0.5 mt-0.5 first:mt-0 text-left text-[11px] font-bold text-gray-200 bg-slate-700/60 hover:bg-slate-700 transition-colors"
                >
                    <span>Dinamiche</span>
                    <span className="text-[10px] text-gray-400">{apertoOra('dinamica') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('dinamica') && (
                    <div className="px-0.5 pb-0.5">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Livelli</div>
                <div className="grid grid-cols-6 gap-1">
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

                {/* Gli accenti stanno CON le dinamiche: sf, sfz, rf sono dinamiche
                    improvvise, non un'altra famiglia. Erano separati per abitudine di
                    catalogo, e la separazione costava un'intestazione e uno stacco. */}
                <div className="grid grid-cols-6 gap-1 mt-1">
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

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Forcelle</div>
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

                    </div>
                )}
                {/* ── Articolazioni ed espressione ── */}
                <button
                    onClick={() => alterna('articolazione')}
                    className="w-full flex items-center justify-between rounded-md px-2 py-0.5 mt-0.5 first:mt-0 text-left text-[11px] font-bold text-gray-200 bg-slate-700/60 hover:bg-slate-700 transition-colors"
                >
                    <span>Articolazioni ed espressione</span>
                    <span className="text-[10px] text-gray-400">{apertoOra('articolazione') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('articolazione') && (
                    <div className="px-0.5 pb-0.5">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Articolazioni</div>
                <div className="grid grid-cols-6 gap-1">
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

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Legature</div>
                <div className="grid grid-cols-4 gap-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'slur', label: '⌒' }, e)}
                        onClick={() => { if (selectionCount >= 2) onPlaceSlur(); }}
                        title="Legatura di portamento: seleziona due note e clicca, oppure trascinala su una nota (arriva alla successiva). Poi tira i capi della curva per allungarla; tasto destro per toglierla."
                        className={`${bottone} ${attivo} px-1`}
                        style={{ fontFamily: 'serif', lineHeight: 1 }}
                    >
                        ⌒
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Tempo</div>
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

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Testo</div>
                <div className="flex items-center gap-1">
                    <button
                        /* SI SCRIVE SULLA PAGINA. Il clic apre la casella dov'è il cursore
                           di lettura: il punto è già deciso, resta solo da scrivere. Prima
                           bisognava scrivere QUI e poi trascinare la T sul punto — due gesti
                           in due posti, e il punto lo si azzeccava a occhio.
                           Il trascinamento resta per chi ha già scritto nel campo accanto:
                           serve a posare la stessa scritta in più punti. */
                        onClick={() => { if (!testo.trim()) onScriviTestoAlCursore?.(); }}
                        onMouseDown={(e) => { if (testo.trim()) onStartDrag({ kind: 'text-marker', data: testo.trim(), label: testo.trim() }, e); }}
                        title={testo.trim()
                            ? `Trascina "${testo.trim()}" sul punto della partitura`
                            : 'Scrivi una scritta dov\'è il cursore di lettura'}
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

                    </div>
                )}
                {/* ── Struttura ── */}
                <button
                    onClick={() => alterna('struttura')}
                    className="w-full flex items-center justify-between rounded-md px-2 py-0.5 mt-0.5 first:mt-0 text-left text-[11px] font-bold text-gray-200 bg-slate-700/60 hover:bg-slate-700 transition-colors"
                >
                    <span>Struttura</span>
                    <span className="text-[10px] text-gray-400">{apertoOra('struttura') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('struttura') && (
                    <div className="px-0.5 pb-0.5">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Armatura</div>
                <div className="flex items-center gap-1">
                    <select
                        value={tonalita}
                        onChange={(e) => setTonalita(e.target.value)}
                        title="Armatura da posare (la fondamentale maggiore: il minore ha la stessa armatura)"
                        className="h-7 flex-1 min-w-0 bg-slate-700 text-gray-100 text-[11px] rounded border border-slate-600 px-1"
                    >
                        {TONALITA.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button
                        onClick={() => setTonalitaMinore(v => !v)}
                        title={tonalitaMinore ? 'Modo minore (stessa armatura del relativo maggiore)' : 'Modo maggiore'}
                        className={`${bottone} ${attivo} px-1.5`}
                    >
                        {tonalitaMinore ? 'min' : 'Mag'}
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'key-sig', data: { root: tonalita, isMinor: tonalitaMinore }, label: tonalita + (tonalitaMinore ? 'm' : '') }, e)}
                        title={`Cambio d'armatura in ${tonalita}${tonalitaMinore ? ' minore' : ' maggiore'}: trascinalo sulla misura da cui vale. Da lì cambia anche la lettura dell'analisi.`}
                        className={`${bottone} ${attivo} px-1.5`}
                        style={{ fontFamily: 'serif' }}
                    >
                        ♯♭
                    </button>
                    {/* TOGLIERE è la stessa cosa che mettere, al contrario: stesso segno
                        con una croce sopra, accanto al pulsante che lo posa. Erano due
                        pulsanti a tutta larghezza con la frase per esteso — due righe
                        intere per un'azione che si fa di rado. */}
                    <button
                        onClick={onRemoveKeySignatureAtPlayhead}
                        title="Toglie il cambio d'armatura nella misura dov'è il cursore"
                        className={`${bottone} ${attivo} px-1 relative`}
                        style={{ fontFamily: 'serif' }}
                    >
                        <span className="opacity-50">♯♭</span>
                        <span className="absolute inset-0 flex items-center justify-center text-red-500 font-black text-[13px] leading-none pointer-events-none">✕</span>
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Metro</div>
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
                    {/* Stesso principio dell'armatura: il segno con la croce, in riga. */}
                    <button
                        onClick={onRemoveTimeSignatureAtPlayhead}
                        title="Togli il cambio di metro dalla misura in cui si trova il cursore"
                        className={`${bottone} ${attivo} px-1 relative`}
                    >
                        <span className="opacity-50 text-[10px]">4/4</span>
                        <span className="absolute inset-0 flex items-center justify-center text-red-500 font-black text-[13px] leading-none pointer-events-none">✕</span>
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Andamento</div>
                <div className="flex items-center gap-1">
                    <button
                        onMouseDown={(e) => onStartDrag({
                            kind: 'tempo-mark',
                            data: { bpm: tempoBpm, beatUnit: tempoUnita, dotted: tempoPunto },
                            label: `${UNITA_GLIFO[tempoUnita]}${tempoPunto ? '.' : ''} = ${tempoBpm}`,
                        }, e)}
                        title={`Segno di metronomo: trascinalo sulla misura da cui vale. A differenza di un rallentando, dice il NUMERO — chi legge sa a che velocità andare.`}
                        className={`${bottone} ${attivo} px-2`}
                        style={{ fontFamily: 'serif', fontSize: 13 }}
                    >
                        {UNITA_GLIFO[tempoUnita]}{tempoPunto ? '.' : ''} = {tempoBpm}
                    </button>
                    <select
                        value={tempoUnita}
                        onChange={(e) => setTempoUnita(e.target.value as UnitaBattito)}
                        title="Unità di battito: la nota a cui si riferisce il numero"
                        className="h-7 text-[13px] bg-slate-700 text-gray-100 border border-slate-600 rounded px-1"
                        style={{ fontFamily: 'serif' }}
                    >
                        {(Object.keys(UNITA_GLIFO) as UnitaBattito[]).map(u => (
                            <option key={u} value={u}>{UNITA_GLIFO[u]}</option>
                        ))}
                    </select>
                    <button
                        onClick={() => setTempoPunto(v => !v)}
                        title={tempoPunto ? 'Unità col punto di valore (vale una volta e mezza)' : 'Unità semplice'}
                        className={`${bottone} ${attivo} px-1.5`}
                    >
                        {tempoPunto ? '•' : '○'}
                    </button>
                </div>
                <div className="flex items-center gap-1 mt-1">
                    <button onClick={() => setTempoBpm(v => Math.max(20, v - 5))} className={`${bottone} ${attivo} px-1.5`} title="Più lento">−</button>
                    <input
                        type="range"
                        min={20}
                        max={240}
                        value={tempoBpm}
                        onChange={(e) => setTempoBpm(Number(e.target.value))}
                        className="flex-1 min-w-0 accent-sky-500"
                        aria-label="Battiti al minuto del segno da posare"
                    />
                    <button onClick={() => setTempoBpm(v => Math.min(300, v + 5))} className={`${bottone} ${attivo} px-1.5`} title="Più veloce">+</button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Battute</div>
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
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">Ottava</div>
                <div className="grid grid-cols-6 gap-1">
                    {([['up', '8va'], ['down', '8vb']] as const).map(([dir, etichetta]) => (
                        <button
                            key={dir}
                            onMouseDown={(e) => onStartDrag({ kind: 'octave', data: dir, label: etichetta }, e)}
                            onClick={() => { if (selectionCount > 0) onPlaceOctave(dir); }}
                            title={dir === 'up'
                                ? 'Suona un\'ottava SOPRA il scritto: seleziona il passaggio e clicca, oppure trascinalo su una nota (copre la misura). Le note NON si spostano — scrivile dove vanno lette.'
                                : 'Suona un\'ottava SOTTO il scritto: seleziona il passaggio e clicca, oppure trascinalo su una nota (copre la misura). Le note NON si spostano — scrivile dove vanno lette.'}
                            className={`${bottone} ${attivo} px-1 italic`}
                            style={{ fontFamily: 'serif' }}
                        >
                            {etichetta}
                        </button>
                    ))}
                </div>

                    </div>
                )}
                <button
                    disabled={!hasMarkAtSelection}
                    onClick={onRemoveAtSelection}
                    title="Togli i segni che stanno nel punto selezionato"
                    className={`${bottone} w-full mt-2 bg-slate-700 text-gray-300 border-slate-600 hover:bg-rose-700 hover:text-white hover:border-rose-600`}
                >
                    Togli il segno qui
                </button>

                <div className="text-[9px] text-gray-400 mt-2 leading-snug">
                    Apri un gruppo e trascina un segno dove vuoi sulla partitura: il gruppo
                    resta aperto per tutto il tempo. Oppure: seleziona una nota e clicca il
                    segno (due note per una forcella). Sul rigo i segni si spostano
                    trascinandoli e si tolgono col tasto destro.
                </div>
            </div>
        </div>
    );
};

export default DynamicsPalettePanel;
