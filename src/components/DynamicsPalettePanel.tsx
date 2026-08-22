import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
// Le icone delle durate sono quelle della toolbar, non glifi Unicode: i caratteri
// musicali composti (nota + bandierina) li disegna il font di sistema, e le bandierine
// di sedicesimi e trentaduesimi uscivano rovesciate. Un'icona disegnata da noi si vede
// com'è, ovunque — e il set ha già le pause e i sessantaquattresimi.
import {
    WholeNoteIcon, HalfNoteIcon, QuarterNoteIcon, EighthNoteIcon,
    SixteenthNoteIcon, ThirtySecondNoteIcon, SixtyFourthNoteIcon,
    QuarterRestIcon,
    // Anche le alterazioni sono icone disegnate: il doppio diesis come CARATTERE (𝄪) a
    // quattordici pixel è una macchia indistinguibile dal doppio bemolle, e ingrandire
    // il carattere non basta perché il disegno del font resta minuto dentro il suo
    // quadrato. L'icona invece riempie lo spazio che le dai.
    SharpIcon, FlatIcon, NaturalIcon, DoubleSharpIcon, DoubleFlatIcon,
} from './icons/NoteValueIcons';
import type { DynamicLevel } from '../utils/dynamics';
import type { SignDragPayload } from '../hooks/useSignDrag';
import type { ArticulationMark } from '../types';
import { ARTICULATIONS, ARTICULATION_UI } from '../utils/articulations';
import { useHoverTip } from '../hooks/useHoverTip';
import { KEY_SIGNATURE_OPTIONS, tonicName } from '../utils/keySignatureOptions';

/**
 * FORCELLA — disegnata, non scritta.
 *
 * `<` e `>` sono segni di MAGGIORE e MINORE: corti, spessi, con l'angolo aperto — a
 * fianco delle articolazioni sembrano accenti, che è esattamente come li leggeva
 * l'occhio. Una forcella d'incisione è tutt'altro: lunga, sottile, con l'apertura
 * schiacciata, perché deve stendersi sotto più note.
 *
 * E non è un carattere per una ragione di fondo: in Bravura — il font che VexFlow usa
 * per la partitura — LE FORCELLE NON ESISTONO come glifo. Nell'incisione si tracciano
 * come due linee che convergono, e la loro lunghezza dipende dal passaggio che coprono.
 * Quindi qui si disegnano, com'è giusto.
 */
const Forcella: React.FC<{ verso: 'cresc' | 'dim'; className?: string }> = ({ verso, className }) => (
    <svg viewBox="0 0 40 12" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        {verso === 'cresc'
            ? <><path d="M2 6 L38 1.5" /><path d="M2 6 L38 10.5" /></>
            : <><path d="M38 6 L2 1.5" /><path d="M38 6 L2 10.5" /></>}
    </svg>
);

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
    /** Lo STESSO segno, posato dove sta la linea di lettura. È l'alternativa al
     *  trascinamento per i segni che valgono su una battuta e non su una nota: chi sa
     *  già dove va il segno non deve mirare. */
    onPosaAlCursore?: (payload: SignDragPayload) => void;
}

const LIVELLI: DynamicLevel[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

/** Le armature come si susseguono per quinte, dai bemolli ai diesis. Ognuna porta
 *  con sé TUTT'E DUE le tonalità che la usano (vedi keySignatureOptions). */
const TONALITA = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
    .map(v => KEY_SIGNATURE_OPTIONS.find(k => k.value === v)!)
    .filter(Boolean);

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
    /** Suddivisione dell'arpeggio: quanto dura ogni nota della figura. È SEPARATA dalla
     *  griglia di quantizzazione in barra, che serve al tasto Q su ciò che è registrato o
     *  importato: si può voler arpeggiare in sedicesimi e quantizzare in ottavi. Niente
     *  terzine, che i pattern non sanno ancora scrivere. */
    arpeggioGrid?: string;
    onSetArpeggioGrid?: (g: string) => void;
    /** Disposizione del voicing: il ciclo auto → S:R → S:3 → S:5 sull'accordo selezionato. */
    onRevoiceChord?: () => void;
    revoiceDispIdx?: number;
    hasSelectedNotes?: boolean;
    selectedNotesHave7th?: boolean;
    suTracciaAcc?: boolean;
    /** Trasformazioni melodiche: agiscono sulla selezione. */
    transformMode?: 'tonal' | 'real';
    onToggleTransformMode?: () => void;
    onMelodicTransform?: (kind: 'transpose' | 'invert' | 'retrograde' | 'retrogradeInvert', opts?: { amount?: number }) => void;
    // Modifiche alla NOTA: stanno con le durate perché si usano nello stesso momento.
    onToggleTie?: () => void;
    onToggleBeam?: () => void;
    onFlipStem?: () => void;
    alterazione?: string | null;
    onSetAlterazione?: (a: any) => void;
    onToggleCorona?: () => void;
    /** I tre modificatori che accompagnano la tonalità: come si comporta un CAMBIO
     *  d'armatura (trasporta o reinterpreta) e se in minore la sensibile si alza da sé. */
    modoCambioTonalita?: 'none' | 'modal' | 'transpose';
    onSetModoCambioTonalita?: (m: 'none' | 'modal' | 'transpose') => void;
    sensibileAutomatica?: boolean;
    onSetSensibileAutomatica?: (v: boolean) => void;
}> = ({
    agganciata: agganciataProp, ancoraggio, onToggleAggancio, onScriviTestoAlCursore,
    durata, onSetDurata, onTogglePausa, onTogglePunto,
    accPattern, onSetAccPattern, accLetRing, onToggleAccLetRing, suTracciaAcc,
    arpeggioGrid, onSetArpeggioGrid, onRevoiceChord, revoiceDispIdx, hasSelectedNotes, selectedNotesHave7th,
    transformMode, onToggleTransformMode, onMelodicTransform,
    onToggleTie, onToggleBeam, onFlipStem, alterazione, onSetAlterazione, onToggleCorona,
    modoCambioTonalita, onSetModoCambioTonalita, sensibileAutomatica, onSetSensibileAutomatica,
    selectionCount, hasMarkAtSelection,
    onPlaceLevel, onPlaceAccent, onPlaceFp, onPlaceHairpin, onPlaceArticulation, onPlaceSlur, onPlaceOctave, currentKeyRoot, currentKeyIsMinor, onRemoveKeySignatureAtPlayhead, onRemoveAtSelection, onClose, onStartDrag, onPosaAlCursore, onAddMeasure, onDeleteMeasureAtPlayhead, currentTimeSignature, onRemoveTimeSignatureAtPlayhead,
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
    const { t } = useTranslation('ui');
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
        dinamica: t('pal_words_dynamics'),
        articolazione: t('pal_words_articulations'),
        durate: t('pal_words_durations'),
        pattern: t('pal_words_patterns'),
        trasformazioni: t('pal_words_transforms'),
        struttura: t('pal_words_structure'),
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

    /** Un carico solo, DUE GESTI: si trascina dove serve, oppure si clicca e il segno
     *  va dove sta la linea di lettura. Scritti insieme per non farli divergere. */
    const gesti = useCallback((payload: SignDragPayload) => ({
        onMouseDown: (e: React.MouseEvent) => onStartDrag(payload, e),
        onClick: () => onPosaAlCursore?.(payload),
    }), [onStartDrag, onPosaAlCursore]);

    const unaSola = selectionCount === 1;
    // I `title` nativi qui non compaiono: la toolbar si era già costruita il suo
    // riquadro, la tavolozza no — e tutti i suoi suggerimenti, tasti compresi, erano
    // scritti e invisibili.
    const suggerimento = useHoverTip();
    const agganciata = !!agganciataProp;
    // DENSITÀ. Erano 28 px d'altezza e 8 di margine per lato, per contenere un glifo da
    // 11: sessanta pixel di pulsante per undici di contenuto, cinque volte e mezzo. Il
    // margine largo serviva alla simmetria del modulo, e il modulo era largo perché i
    // pulsanti lo erano — un cerchio che si autoalimenta. Rotto dal lato dei pulsanti.
    const bottone = 'h-6 px-1 text-[11px] font-bold rounded border transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
    /**
     * SENZA SCATOLA — prova sulle durate.
     *
     * A riposo resta solo il glifo: sette riquadri in fila fanno contare i contenitori
     * invece di leggere i segni, e sei di quei sette sono sempre spenti. Il bordo resta
     * TRASPARENTE e non tolto, così passando da spento ad acceso il pulsante non cambia
     * dimensione e la riga non si muove sotto il dito.
     *
     * Al passaggio del mouse un fondo appena accennato: un glifo nudo non dice di essere
     * cliccabile, e chi apre l'applicazione la prima volta non ha modo di saperlo.
     *
     * Acceso, il riquadro pieno torna: qui gli interruttori sono la maggioranza — durata,
     * pausa, punto, pattern, tonali/reali — e lo stato acceso è l'unica informazione che
     * quel riquadro porta. Toglierlo anche lì vorrebbe dire inventare un secondo modo di
     * dire «questo è quello attivo», più debole di un blocco pieno.
     */
    const nudo = 'bg-transparent border-transparent text-gray-200 hover:bg-slate-700/70';
    const nudoAcceso = 'bg-cyan-600 text-white border-cyan-500';
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
            ref={suggerimento.radice}
            onMouseMove={suggerimento.suMovimento}
            onMouseLeave={suggerimento.nascondi}
        >
            {suggerimento.tip && (
                <div
                    className="fixed z-[9999] pointer-events-none bg-slate-900/95 text-slate-100 text-[11px] px-2 py-1 rounded shadow-lg border border-slate-700"
                    style={{ left: suggerimento.tip.x, top: suggerimento.tip.y, maxWidth: 320 }}
                >
                    {suggerimento.tip.text}
                </div>
            )}
            <div
                onMouseDown={agganciata ? undefined : onTitleMouseDown}
                className={`flex items-center justify-between px-2 py-1 bg-slate-900 rounded-t-lg shrink-0 ${agganciata ? '' : 'cursor-move'}`}
            >
                <span className="text-[11px] font-bold text-gray-300 tracking-wide truncate">
                    {(agganciata ? '𝆑 ' : '⠿ 𝆑 ') + t('pal_title')}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                    {onToggleAggancio && (
                        <button
                            onClick={onToggleAggancio}
                            title={agganciata
                                ? t('pal_undock')
                                : t('pal_dock')}
                            className="w-5 h-5 text-gray-500 hover:text-gray-200 flex items-center justify-center text-[11px] rounded"
                        >
                            {agganciata ? '⇥' : '⇤'}
                        </button>
                    )}
                </div>
                <button
                    onClick={onClose}
                    title={t('pal_close')}
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
                        placeholder={t('pal_search_placeholder')}
                        aria-label={t('pal_search_aria')}
                        className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-100 placeholder:text-slate-500 outline-none"
                    />
                    {ricerca && (
                        <button
                            onClick={() => setRicerca('')}
                            title={t('pal_search_clear')}
                            className="text-[11px] text-slate-500 hover:text-slate-200"
                        >
                            ✕
                        </button>
                    )}
                </div>
                {q && !['dinamica', 'articolazione', 'struttura', 'durate', 'pattern', 'trasformazioni'].some(combacia) && (
                    <div className="px-1 pb-1 text-[10px] text-amber-400">
                        {t('pal_search_none', { q: ricerca })}
                    </div>
                )}

                {/* ── Durate ── PRIMA di tutto: è quello che si tocca a ogni nota. */}
                <button
                    onClick={() => alterna('durate')}
                    className={`w-full flex items-center justify-between px-2 py-1 mt-1 first:mt-0 text-left text-[11px] font-bold transition-colors ${apertoOra('durate') ? 'bg-sky-800 text-sky-50 border border-sky-600 border-b-0 rounded-t-md' : 'bg-slate-700/60 text-gray-200 hover:bg-slate-700 rounded-md'}`}
                >
                    <span>{t('pal_group_notes')}</span>
                    <span className="text-[10px] opacity-70">{apertoOra('durate') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('durate') && (
                    <div className="px-1.5 pt-1 pb-1.5 bg-sky-950/60 border border-sky-600 border-t-0 rounded-b-md">
                        <div className="grid grid-cols-7 gap-1 mt-1">
                            {([
                                ['whole', WholeNoteIcon, t('pal_dur_whole'), '1'],
                                ['half', HalfNoteIcon, t('pal_dur_half'), '2'],
                                ['quarter', QuarterNoteIcon, t('pal_dur_quarter'), '3'],
                                ['eighth', EighthNoteIcon, t('pal_dur_eighth'), '4'],
                                ['sixteenth', SixteenthNoteIcon, t('pal_dur_16th'), '5'],
                                ['thirty-second', ThirtySecondNoteIcon, t('pal_dur_32nd'), '6'],
                                ['sixty-fourth', SixtyFourthNoteIcon, t('pal_dur_64th'), '7'],
                            ] as const).map(([d, Icona, nome, tasto]) => (
                                <button
                                    key={d}
                                    onClick={() => onSetDurata?.(d)}
                                    /* La scorciatoia nel suggerimento: chi usa la tavolozza
                                       col mouse impara i tasti senza cercarli altrove, e
                                       smette di usare la tavolozza per quelli che ricorda. */
                                    title={`${nome}  ·  ${tasto}`}
                                    aria-label={nome}
                                    className={`${bottone} h-8 px-0 flex items-center justify-center ${durata?.duration === d ? nudoAcceso : nudo}`}
                                >
                                    <Icona className="h-6 w-6" />
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                            {/* L'interruttore mostra la PAUSA, non lo stato: un pulsante che
                                dice «nota» mentre stai già inserendo note non dice niente.
                                Acceso = si stanno inserendo pause. */}
                            <button
                                onClick={onTogglePausa}
                                title={durata?.type === 'rest' ? t('pal_rest_on') : t('pal_rest_off')}
                                aria-label={t('pal_rest_aria')}
                                className={`${bottone} h-8 px-0 flex items-center justify-center ${durata?.type === 'rest' ? nudoAcceso : nudo}`}
                            >
                                <QuarterRestIcon className="h-6 w-6" />
                            </button>
                            <button
                                onClick={onTogglePunto}
                                title={t('pal_dot')}
                                className={`${bottone} h-8 ${durata?.isDotted ? nudoAcceso : nudo}`}
                            >
                                ♩.
                            </button>
                        </div>

                        {/* ALTERAZIONI. Stanno con le durate perché si scelgono nello stesso
                            momento — prima di posare la nota, non dopo. Erano nella toolbar,
                            cioè lontane dal punto in cui si guarda mentre si scrive. */}
                        <div className="grid grid-cols-5 gap-1 mt-1">
                            {([
                                ['flat', FlatIcon, t('pal_acc_flat'), 'b'],
                                ['natural', NaturalIcon, t('pal_acc_natural'), 'n'],
                                ['sharp', SharpIcon, t('pal_acc_sharp'), '#'],
                                ['doubleFlat', DoubleFlatIcon, t('pal_acc_dflat'), ''],
                                ['doubleSharp', DoubleSharpIcon, t('pal_acc_dsharp'), ''],
                            ] as const).map(([id, Icona, nome, tasto]) => (
                                <button
                                    key={id}
                                    onClick={() => onSetAlterazione?.(alterazione === id ? null : id)}
                                    title={tasto ? `${nome}  ·  ${tasto}` : nome}
                                    aria-label={nome}
                                    /* Misura della toolbar (h-5): un'alterazione è larga
                                       quanto alta, quindi a 24 px pesa il doppio di una
                                       nota, che di larghezza ne occupa sei. */
                                    className={`${bottone} h-7 px-0 flex items-center justify-center ${alterazione === id ? nudoAcceso : nudo}`}
                                >
                                    <Icona className="h-5 w-5" />
                                </button>
                            ))}
                        </div>

                        {/* MODIFICHE alla nota già scritta: legatura di valore, traversa,
                            verso del gambo. Si usano subito dopo aver inserito, guardando
                            lo stesso punto della partitura. */}
                        <div className="grid grid-cols-7 gap-1 mt-1">
                            <button
                                onClick={onToggleTie}
                                title={t('pal_tie')}
                                className={`${bottone} px-0 ${nudo}`}
                                style={{ fontFamily: 'serif', lineHeight: 1 }}
                            >
                                ⌣
                            </button>
                            <button
                                onClick={onToggleBeam}
                                title={t('pal_beam')}
                                className={`${bottone} px-0 ${nudo}`}
                                style={{ fontFamily: 'serif', lineHeight: 1 }}
                            >
                                ♫
                            </button>
                            <button
                                onClick={onFlipStem}
                                title={t('pal_stem')}
                                className={`${bottone} px-0 ${nudo}`}
                                style={{ fontFamily: 'serif', lineHeight: 1 }}
                            >
                                ↕
                            </button>
                            <button
                                onMouseDown={(e) => onStartDrag({ kind: 'slur', label: '⌒' }, e)}
                                onClick={() => { if (selectionCount >= 2) onPlaceSlur(); }}
                                title={t('pal_slur')}
                                className={`${bottone} px-0 ${nudo}`}
                                style={{ fontFamily: 'serif', lineHeight: 1 }}
                            >
                                ⌒
                            </button>
                            <button
                                onClick={onToggleCorona}
                                disabled={!selectionCount}
                                title={t('pal_fermata')}
                                className={`${bottone} px-0 ${nudo}`}
                                style={{ fontFamily: 'serif', lineHeight: 1, fontSize: 15 }}
                            >
                                𝄐
                            </button>
                            <button
                                {...gesti({ kind: 'tempo-curve', data: 'rall', label: 'rall.' })}
                                title={t('pal_rit')}
                                className={`${bottone} px-0 italic ${nudo}`}
                                style={{ fontFamily: 'serif', fontSize: 10 }}
                            >
                                rall.
                            </button>
                            {/* accel. sta con rall.: sono la stessa famiglia — l'agogica —
                                e stavano in due gruppi diversi, con rall. per giunta
                                DUPLICATO qui e sotto «Articolazioni ed espressione». */}
                            <button
                                {...gesti({ kind: 'tempo-curve', data: 'accel', label: 'accel.' })}
                                title={t('pal_accel')}
                                className={`${bottone} px-0 italic ${nudo}`}
                                style={{ fontFamily: 'serif', fontSize: 10 }}
                            >
                                accel.
                            </button>
                        </div>
                    </div>
                )}

                {/* ── ARPEGGIATORE ──
                    Le quattro decisioni sull'arpeggio stavano in quattro posti diversi
                    (figura nella tavolozza, suddivisione nella griglia in barra,
                    disposizione in barra) e sono aspetti di UNA decisione sola: qui stanno
                    insieme, e i controlli sono SPOSTATI, non duplicati — due posti che
                    dicono la stessa cosa sono il prossimo disaccordo.

                    Il gruppo non e' tutto contestuale: le FIGURE hanno senso solo su una
                    traccia, ma la DISPOSIZIONE vale per qualunque accordo selezionato,
                    coro compreso. Nascondendo tutto senza tracce ACC si sarebbe perso il
                    ciclo delle disposizioni su un corale. */}
                <>
                    <button
                        onClick={() => alterna('pattern')}
                            className={`w-full flex items-center justify-between px-2 py-1 mt-1 first:mt-0 text-left text-[11px] font-bold transition-colors ${apertoOra('pattern') ? 'bg-sky-800 text-sky-50 border border-sky-600 border-b-0 rounded-t-md' : 'bg-slate-700/60 text-gray-200 hover:bg-slate-700 rounded-md'}`}
                        >
                            <span>{t('pal_group_patterns')}</span>
                            <span className="text-[10px] opacity-70">{apertoOra('pattern') ? '▾' : '▸'}</span>
                        </button>
                        {apertoOra('pattern') && (
                            <div className="px-1.5 pt-1 pb-1.5 bg-sky-950/60 border border-sky-600 border-t-0 rounded-b-md">
                                {/* La DISPOSIZIONE dice come è distanziato l'accordo; vale
                                    per qualunque accordo selezionato, anche nel coro. */}
                                {/* Un COMANDO, non uno stato. Prima il pulsante mostrava solo
                                    «auto», che dice come sta l'accordo e non cosa succede a
                                    premere: sembrava un modo acceso, non un giro da fare.
                                    Ora dice il mestiere a sinistra e la posizione attuale a
                                    destra, come il pedale qui sopra. */}
                                <button
                                    onClick={onRevoiceChord}
                                    disabled={!hasSelectedNotes}
                                    title={t('pal_arp_voicing_tip', { defaultValue: 'Cambia la disposizione dell’accordo selezionato: a ogni pressione la posizione successiva. S:3 = terza al soprano, S:5 = quinta, S:R = fondamentale; «auto» è la disposizione decisa dal motore.' })}
                                    className={`${bottone} w-full flex items-center justify-between ${nudo}`}
                                >
                                    <span>{t('pal_arp_voicing', { defaultValue: 'Disposizione' })}</span>
                                    <span className="font-mono opacity-80">
                                        ⟳ {(selectedNotesHave7th
                                            ? ['auto', 'S:7', 'S:3', 'S:5', 'S:R']
                                            : ['auto', 'S:R', 'S:3', 'S:5'])[(revoiceDispIdx ?? 0) % (selectedNotesHave7th ? 5 : 4)]}
                                    </span>
                                </button>
                                {suTracciaAcc && (<>
                                <div className="grid grid-cols-3 gap-1 mt-1">
                                    {([
                                        ['block', 'Bl', t('pal_pat_block')],
                                        ['arpeggio_up', 'Ar▲', t('pal_pat_arp_up')],
                                        ['arpeggio_down', 'Ar▼', t('pal_pat_arp_down')],
                                        ['broken', 'Brk', t('pal_pat_broken')],
                                        ['albertino', 'Alb', t('pal_pat_alberti')],
                                        ['ondulato', 'Ond', t('pal_pat_wave')],
                                    ] as const).map(([id, lab, tit]) => (
                                        <button
                                            key={id}
                                            onClick={() => onSetAccPattern?.(id)}
                                            title={tit}
                                            className={`${bottone} font-mono ${accPattern === id ? nudoAcceso : nudo}`}
                                        >
                                            {lab}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={onToggleAccLetRing}
                                    title={t('pal_pat_pedal')}
                                    className={`${bottone} w-full mt-1 font-mono ${accLetRing ? nudoAcceso : nudo}`}
                                >
                                    Ped
                                </button>

                                <div className="flex items-center justify-between gap-1 mt-1">
                                    <span className="text-[10px] text-sky-300/80 select-none">{t('pal_arp_subdiv', { defaultValue: 'Suddivisione' })}</span>
                                    <select
                                        value={arpeggioGrid ?? 'sixteenth'}
                                        onChange={(e) => onSetArpeggioGrid?.(e.target.value)}
                                        title={t('pal_arp_subdiv_tip', { defaultValue: 'Quanto dura ogni nota dell’arpeggio. È separata dalla griglia di quantizzazione in barra.' })}
                                        className="h-6 bg-slate-800 text-gray-200 text-[11px] rounded px-1 border border-slate-600 cursor-pointer"
                                    >
                                        <option value="sixteenth">1/16</option>
                                        <option value="eighth">1/8</option>
                                        <option value="quarter">1/4</option>
                                        <option value="half">1/2</option>
                                    </select>
                                </div>
                                </>)}
                            </div>
                        )}
                </>

                {/* ── Trasformazioni ── agiscono sulla SELEZIONE, non sul cursore. */}
                <button
                    onClick={() => alterna('trasformazioni')}
                    className={`w-full flex items-center justify-between px-2 py-1 mt-1 first:mt-0 text-left text-[11px] font-bold transition-colors ${apertoOra('trasformazioni') ? 'bg-sky-800 text-sky-50 border border-sky-600 border-b-0 rounded-t-md' : 'bg-slate-700/60 text-gray-200 hover:bg-slate-700 rounded-md'}`}
                >
                    <span>{t('pal_group_transforms')}</span>
                    <span className="text-[10px] opacity-70">{apertoOra('trasformazioni') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('trasformazioni') && (
                    <div className="px-1.5 pt-1 pb-1.5 bg-sky-950/60 border border-sky-600 border-t-0 rounded-b-md">
                        {/* Il modo sta SOPRA e da solo: è un modificatore che vale per
                            tutte e cinque le operazioni sotto, non una sesta operazione.
                            In toolbar l'ambiguità passava, in colonna no. */}
                        <button
                            onClick={onToggleTransformMode}
                            title={transformMode === 'tonal'
                                ? t('pal_tr_tonal_tip')
                                : t('pal_tr_real_tip')}
                            className={`${bottone} w-full mt-1 font-mono ${transformMode === 'tonal' ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-amber-600 text-white border-amber-500'}`}
                        >
                            {transformMode === 'tonal' ? t('pal_tr_tonal') : t('pal_tr_real')}
                        </button>
                        <div className="grid grid-cols-3 gap-1 mt-1">
                            <button onClick={() => onMelodicTransform?.('transpose', { amount: 1 })} disabled={!selectionCount} title={t('pal_tr_up')} className={`${bottone} ${nudo} font-mono`}>T▲</button>
                            <button onClick={() => onMelodicTransform?.('transpose', { amount: -1 })} disabled={!selectionCount} title={t('pal_tr_down')} className={`${bottone} ${nudo} font-mono`}>T▼</button>
                            <button onClick={() => onMelodicTransform?.('invert')} disabled={!selectionCount} title={t('pal_tr_inv')} className={`${bottone} ${nudo} font-mono`}>Inv</button>
                            <button onClick={() => onMelodicTransform?.('retrograde')} disabled={!selectionCount} title={t('pal_tr_retro')} className={`${bottone} ${nudo} font-mono`}>Retr</button>
                            <button onClick={() => onMelodicTransform?.('retrogradeInvert')} disabled={!selectionCount} title={t('pal_tr_retroinv')} className={`${bottone} ${nudo} font-mono`}>R+I</button>
                        </div>
                    </div>
                )}

                {/* ── Dinamiche ── */}
                <button
                    onClick={() => alterna('dinamica')}
                    className={`w-full flex items-center justify-between px-2 py-1 mt-1 first:mt-0 text-left text-[11px] font-bold transition-colors ${apertoOra('dinamica') ? 'bg-sky-800 text-sky-50 border border-sky-600 border-b-0 rounded-t-md' : 'bg-slate-700/60 text-gray-200 hover:bg-slate-700 rounded-md'}`}
                >
                    <span>{t('pal_group_dynamics')}</span>
                    <span className="text-[10px] opacity-70">{apertoOra('dinamica') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('dinamica') && (
                    <div className="px-1.5 pt-1 pb-1.5 bg-sky-950/60 border border-sky-600 border-t-0 rounded-b-md">
                {/* DINAMICHE E ACCENTI IN UN BLOCCO SOLO.
                    sf, sfz, rf e fp sono dinamiche improvvise: separarle in una seconda
                    griglia costava un'intestazione, uno stacco e — soprattutto — le faceva
                    leggere come un'altra famiglia. Dodici segni in due file continue si
                    leggono come una cosa sola, che è quello che sono.
                    Senza scatola, come le durate: a riposo il rumore sparisce, e i segni
                    diventano un blocco riconoscibile invece di dodici unità separate. */}
                <div className="grid grid-cols-6 gap-1">
                    {LIVELLI.map(l => (
                        <button
                            key={l}
                            onMouseDown={(e) => onStartDrag({ kind: 'dyn-level', data: l, label: l }, e)}
                            onClick={() => { if (unaSola) onPlaceLevel(l); }}
                            title={t('pal_dyn_drag', { s: l })}
                            className={`${bottone} ${nudo} italic`}
                            style={{ fontFamily: 'serif' }}
                        >
                            {l}
                        </button>
                    ))}
                    {(['sf', 'sfz', 'rf'] as const).map(a => (
                        <button
                            key={a}
                            onMouseDown={(e) => onStartDrag({ kind: 'dyn-accent', data: a, label: a }, e)}
                            onClick={() => { if (unaSola) onPlaceAccent(a); }}
                            title={t('pal_dyn_drag', { s: a })}
                            className={`${bottone} ${nudo} italic`}
                            style={{ fontFamily: 'serif' }}
                        >
                            {a}
                        </button>
                    ))}
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'dyn-fp', label: 'fp' }, e)}
                        onClick={() => { if (unaSola) onPlaceFp(); }}
                        title={t('pal_fp')}
                        className={`${bottone} ${nudo} italic`}
                        style={{ fontFamily: 'serif' }}
                    >
                        fp
                    </button>
                </div>

                {/* Nessuna intestazione: una forcella si riconosce dalla forma, e la
                    parola «Forcelle» costava una riga per dire quello che il segno dice
                    da sé. Niente scatola, come gli altri segni disegnati. */}
                <div className="grid grid-cols-2 gap-1 mt-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'dyn-hairpin', data: 'cresc', label: '⟨ cresc.' }, e)}
                        onClick={() => { if (selectionCount >= 2) onPlaceHairpin('cresc'); }}
                        title={t('pal_cresc')}
                        className={`${bottone} ${nudo} px-0`}
                    >
                        <Forcella verso="cresc" className="w-full h-3" />
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'dyn-hairpin', data: 'dim', label: 'dim. ⟩' }, e)}
                        onClick={() => { if (selectionCount >= 2) onPlaceHairpin('dim'); }}
                        title={t('pal_dim')}
                        className={`${bottone} ${nudo} px-0`}
                    >
                        <Forcella verso="dim" className="w-full h-3" />
                    </button>
                </div>

                    </div>
                )}
                {/* ── Articolazioni ed espressione ── */}
                <button
                    onClick={() => alterna('articolazione')}
                    className={`w-full flex items-center justify-between px-2 py-1 mt-1 first:mt-0 text-left text-[11px] font-bold transition-colors ${apertoOra('articolazione') ? 'bg-sky-800 text-sky-50 border border-sky-600 border-b-0 rounded-t-md' : 'bg-slate-700/60 text-gray-200 hover:bg-slate-700 rounded-md'}`}
                >
                    <span>{t('pal_group_articulations')}</span>
                    <span className="text-[10px] opacity-70">{apertoOra('articolazione') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('articolazione') && (
                    <div className="px-1.5 pt-1 pb-1.5 bg-sky-950/60 border border-sky-600 border-t-0 rounded-b-md">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{t('pal_articulations_label')}</div>
                <div className="grid grid-cols-6 gap-1">
                    {ARTICULATIONS.map(a => (
                        <button
                            key={a}
                            onMouseDown={(e) => onStartDrag({ kind: 'articulation', data: a, label: ARTICULATION_UI[a].simbolo }, e)}
                            onClick={() => { if (selectionCount > 0) onPlaceArticulation(a); }}
                            title={t('pal_artic_drag', { s: ARTICULATION_UI[a].nome })}
                            className={`${bottone} h-7 ${nudo} px-1`}
                            style={{ fontFamily: 'serif', lineHeight: 1, fontSize: 15 }}
                        >
                            {ARTICULATION_UI[a].simbolo}
                        </button>
                    ))}
                </div>

                
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
                            ? t('pal_text_drag', { s: testo.trim() })
                            : t('pal_text_write')}
                        className={`${bottone} ${attivo} px-3`}
                        style={{ fontFamily: 'serif', fontSize: 15 }}
                    >
                        T
                    </button>
                    <input
                        value={testo}
                        onChange={(e) => setTesto(e.target.value)}
                        placeholder={t('pal_text_placeholder')}
                        className="flex-1 h-7 text-[11px] bg-slate-700 text-gray-100 border border-slate-600 rounded px-2 placeholder-gray-500"
                    />
                </div>

                    </div>
                )}
                {/* ── Struttura ── */}
                <button
                    onClick={() => alterna('struttura')}
                    className={`w-full flex items-center justify-between px-2 py-1 mt-1 first:mt-0 text-left text-[11px] font-bold transition-colors ${apertoOra('struttura') ? 'bg-sky-800 text-sky-50 border border-sky-600 border-b-0 rounded-t-md' : 'bg-slate-700/60 text-gray-200 hover:bg-slate-700 rounded-md'}`}
                >
                    <span>{t('pal_group_structure')}</span>
                    <span className="text-[10px] opacity-70">{apertoOra('struttura') ? '▾' : '▸'}</span>
                </button>
                {apertoOra('struttura') && (
                    <div className="px-1.5 pt-1 pb-1.5 bg-sky-950/60 border border-sky-600 border-t-0 rounded-b-md">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{t('pal_key_label')}</div>
                <div className="flex items-center gap-1">
                    <select
                        value={tonalita}
                        onChange={(e) => setTonalita(e.target.value)}
                        title={t('pal_key_pick')}
                        className="h-7 flex-1 min-w-0 bg-slate-700 text-gray-100 text-[11px] rounded border border-slate-600 px-1"
                    >
                        {TONALITA.map(k => <option key={k.value} value={k.value}>{k.labelShort}</option>)}
                    </select>
                    <button
                        onClick={() => setTonalitaMinore(v => !v)}
                        title={tonalitaMinore ? t('pal_key_minor') : t('pal_key_major')}
                        className={`${bottone} ${attivo} px-1.5`}
                    >
                        {tonalitaMinore ? t('pal_key_minor_abbr') : t('pal_key_major_abbr')}
                    </button>
                    <button
                        {...gesti({ kind: 'key-sig', data: { root: tonalita, isMinor: tonalitaMinore }, label: tonicName(tonalita, tonalitaMinore) + (tonalitaMinore ? 'm' : '') })}
                        title={t('pal_key_drag', { k: `${tonicName(tonalita, tonalitaMinore)} ${tonalitaMinore ? t('pal_key_minor_word') : t('pal_key_major_word')}` })}
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
                        title={t('pal_key_remove')}
                        className={`${bottone} ${attivo} px-1 relative`}
                        style={{ fontFamily: 'serif' }}
                    >
                        <span className="opacity-50">♯♭</span>
                        <span className="absolute inset-0 flex items-center justify-center text-red-500 font-black text-[13px] leading-none pointer-events-none">✕</span>
                    </button>
                </div>

                {/* COME SI COMPORTA UN CAMBIO D'ARMATURA — stanno qui perché è qui che
                    l'armatura si posa: erano in toolbar, cioè lontani dalla cosa che
                    modificano, e si potevano cambiare senza vedere su cosa agivano. */}
                <div className="flex flex-col gap-0.5 mt-1">
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-300 cursor-pointer" title={t('pal_key_transpose_tip')}>
                        <input
                            type="checkbox"
                            checked={modoCambioTonalita === 'transpose'}
                            onChange={(e) => onSetModoCambioTonalita?.(e.target.checked ? 'transpose' : 'none')}
                            className="accent-sky-500"
                        />
                        {t('pal_key_transpose')}
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-300 cursor-pointer" title={t('pal_key_modal_tip')}>
                        <input
                            type="checkbox"
                            checked={modoCambioTonalita === 'modal'}
                            onChange={(e) => onSetModoCambioTonalita?.(e.target.checked ? 'modal' : 'none')}
                            className="accent-sky-500"
                        />
                        {t('pal_key_modal')}
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-300 cursor-pointer" title={t('pal_key_leading_tip')}>
                        <input
                            type="checkbox"
                            checked={!!sensibileAutomatica}
                            onChange={(e) => onSetSensibileAutomatica?.(e.target.checked)}
                            className="accent-sky-500"
                        />
                        {t('pal_key_leading')}
                    </label>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">{t('pal_time_label')}</div>
                {/* DUE NUMERI, non più/meno e un menù a tendina. Il metro si legge come si
                    scrive — 6 sopra 8 — e ogni cifra si sceglie cliccandola. La fila
                    precedente aveva un meno, un numero, un più e una tendina: quattro
                    comandi per dire «6/8», e nessuno dei quattro somigliava a un metro. */}
                <div className="flex items-center gap-1">
                    <div className="flex items-center gap-0.5 bg-slate-700 border border-slate-600 rounded px-1 h-7">
                        <select
                            value={metroN}
                            onChange={(e) => setMetroN(Number(e.target.value))}
                            title={t('pal_time_num')}
                            className="bg-transparent text-gray-100 text-[13px] outline-none appearance-none text-center cursor-pointer"
                            style={{ fontFamily: 'serif' }}
                        >
                            {Array.from({ length: 32 }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n} className="bg-slate-800">{n}</option>
                            ))}
                        </select>
                        <span className="text-slate-500 text-[13px]">/</span>
                        <select
                            value={metroD}
                            onChange={(e) => setMetroD(Number(e.target.value))}
                            title={t('pal_time_den')}
                            className="bg-transparent text-gray-100 text-[13px] outline-none appearance-none text-center cursor-pointer"
                            style={{ fontFamily: 'serif' }}
                        >
                            {DENOMINATORI.map(d => <option key={d} value={d} className="bg-slate-800">{d}</option>)}
                        </select>
                    </div>
                    <button
                        {...gesti({ kind: 'time-sig', data: { n: metroN, d: metroD }, label: `${metroN}/${metroD}` })}
                        title={t('pal_time_place', { s: `${metroN}/${metroD}` })}
                        className={`${bottone} ${attivo} flex-1`}
                        style={{ fontFamily: 'serif', fontSize: 13 }}
                    >
                        {metroN}/{metroD}
                    </button>
                    <button
                        onClick={onRemoveTimeSignatureAtPlayhead}
                        title={t('pal_time_remove')}
                        className={`${bottone} ${attivo} px-1 relative`}
                    >
                        <span className="opacity-50 text-[10px]">4/4</span>
                        <span className="absolute inset-0 flex items-center justify-center text-red-500 font-black text-[13px] leading-none pointer-events-none">✕</span>
                    </button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">{t('pal_tempo_label')}</div>
                <div className="flex items-center gap-1">
                    <button
                        {...gesti({
                            kind: 'tempo-mark',
                            data: { bpm: tempoBpm, beatUnit: tempoUnita, dotted: tempoPunto },
                            label: `${UNITA_GLIFO[tempoUnita]}${tempoPunto ? '.' : ''} = ${tempoBpm}`,
                        })}
                        title={t('pal_tempo_place')}
                        className={`${bottone} ${attivo} px-2`}
                        style={{ fontFamily: 'serif', fontSize: 13 }}
                    >
                        {UNITA_GLIFO[tempoUnita]}{tempoPunto ? '.' : ''} = {tempoBpm}
                    </button>
                    <select
                        value={tempoUnita}
                        onChange={(e) => setTempoUnita(e.target.value as UnitaBattito)}
                        title={t('pal_tempo_unit')}
                        className="h-7 text-[13px] bg-slate-700 text-gray-100 border border-slate-600 rounded px-1"
                        style={{ fontFamily: 'serif' }}
                    >
                        {(Object.keys(UNITA_GLIFO) as UnitaBattito[]).map(u => (
                            <option key={u} value={u}>{UNITA_GLIFO[u]}</option>
                        ))}
                    </select>
                    <button
                        onClick={() => setTempoPunto(v => !v)}
                        title={tempoPunto ? t('pal_tempo_dotted') : t('pal_tempo_plain')}
                        className={`${bottone} ${tempoPunto ? nudoAcceso : attivo} px-1.5`}
                    >
                        {/* Il segno dice DI COSA si parla: una nota col punto, non un
                            pallino pieno o vuoto che non somiglia a niente di musicale. */}
                        <span style={{ fontFamily: 'serif', fontSize: 13 }}>
                            {UNITA_GLIFO[tempoUnita]}.
                        </span>
                    </button>
                </div>
                <div className="flex items-center gap-1 mt-1">
                    <button onClick={() => setTempoBpm(v => Math.max(20, v - 5))} className={`${bottone} ${attivo} px-1.5`} title={t('pal_tempo_slower')}>−</button>
                    <input
                        type="range"
                        min={20}
                        max={240}
                        value={tempoBpm}
                        onChange={(e) => setTempoBpm(Number(e.target.value))}
                        className="flex-1 min-w-0 accent-sky-500"
                        aria-label={t('pal_tempo_bpm_aria')}
                    />
                    <button onClick={() => setTempoBpm(v => Math.min(300, v + 5))} className={`${bottone} ${attivo} px-1.5`} title={t('pal_tempo_faster')}>+</button>
                </div>

                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">{t('pal_bars_label')}</div>
                <div className="grid grid-cols-4 gap-1">
                    <button
                        {...gesti({ kind: 'bar-double', label: '𝄀𝄀' })}
                        title={t('pal_bar_double')}
                        className={`${bottone} ${attivo}`}
                    >
                        𝄀𝄀
                    </button>
                    <button
                        {...gesti({ kind: 'bar-repeat', data: 'repeat-begin', label: '𝄆' })}
                        title={t('pal_bar_repeat_start')}
                        className={`${bottone} ${nudo}`}
                    >
                        𝄆
                    </button>
                    <button
                        {...gesti({ kind: 'bar-repeat', data: 'repeat-end', label: '𝄇' })}
                        title={t('pal_bar_repeat_end')}
                        className={`${bottone} ${nudo}`}
                    >
                        𝄇
                    </button>
                    <button
                        {...gesti({ kind: 'bar-repeat', data: 'repeat-both', label: '𝄆𝄇' })}
                        title={t('pal_bar_repeat_both')}
                        className={`${bottone} ${nudo}`}
                    >
                        𝄆𝄇
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'measure-add', label: t('pal_measure_add_btn') }, e)}
                        onClick={onAddMeasure}
                        title={t('pal_measure_add')}
                        className={`${bottone} ${attivo}`}
                    >
                        + misura
                    </button>
                    <button
                        onMouseDown={(e) => onStartDrag({ kind: 'measure-del', label: t('pal_measure_del_btn') }, e)}
                        onClick={onDeleteMeasureAtPlayhead}
                        title={t('pal_measure_del')}
                        className={`${bottone} bg-slate-700 text-gray-300 border-slate-600 hover:bg-rose-700 hover:text-white hover:border-rose-600`}
                    >
                        − misura
                    </button>
                </div>
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1.5 mb-0.5">{t('pal_octave_label')}</div>
                <div className="grid grid-cols-6 gap-1">
                    {([['up', '8va'], ['down', '8vb']] as const).map(([dir, etichetta]) => (
                        <button
                            key={dir}
                            onMouseDown={(e) => onStartDrag({ kind: 'octave', data: dir, label: etichetta }, e)}
                            onClick={() => { if (selectionCount > 0) onPlaceOctave(dir); }}
                            title={dir === 'up'
                                ? t('pal_octave_up')
                                : t('pal_octave_down')}
                            className={`${bottone} ${nudo} px-1 italic`}
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
                    title={t('pal_remove_here')}
                    className={`${bottone} w-full mt-2 bg-slate-700 text-gray-300 border-slate-600 hover:bg-rose-700 hover:text-white hover:border-rose-600`}
                >
                    {t('pal_remove_here_btn')}
                </button>

                <div className="text-[9px] text-gray-400 mt-2 leading-snug">
                    {t('pal_footer')}
                </div>
            </div>
        </div>
    );
};

export default DynamicsPalettePanel;
