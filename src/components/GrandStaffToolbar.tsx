import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUturnLeftIcon, PauseIcon as PauseSolidIcon, PlayIcon as PlaySolidIcon } from '@heroicons/react/24/solid';
import type { AccidentalType, NoteDuration, StaffNote, Voice } from '../types';
import { activeVoicesForPartCount, type PartCount } from '../utils/voiceParts';
import { INSTRUMENTS, gmToSoundfont, soundfontToGm } from '../constants/instruments';
import { useFloatingPanel } from '../hooks/useFloatingPanel';

/**
 * COME SI CHIAMANO I GRUPPI, per chi li accende e li spegne.
 *
 * Sulla barra i gruppi non hanno un nome: si riconoscono dalle icone. In un elenco
 * di caselle le icone non ci sono, quindi il nome deve dire che cosa si perde
 * togliendolo — «Riproduzione (play, stop, registra)», non «Playback».
 */
const NOMI_GRUPPI: Record<ToolbarGroupId, { it: string; en: string }> = {
    playback:           { it: 'Riproduzione (play, stop, registra)', en: 'Playback (play, stop, record)' },
    measurePanel:       { it: 'Proprietà del punto (T)',            en: 'Properties at the cursor (T)' },
    bpm:                { it: 'Velocità e metronomo',               en: 'Tempo and metronome' },
    key:                { it: 'Tonalità',                           en: 'Key' },
    time:               { it: 'Metro',                              en: 'Time signature' },
    measures:           { it: 'Misure e impaginazione',             en: 'Measures and layout' },
    voices:             { it: 'Voci (S A T B)',                     en: 'Voices (S A T B)' },
    voiceInstrument:    { it: 'Strumento della voce',               en: 'Voice instrument' },
    mixer:              { it: 'Mixer',                              en: 'Mixer' },
    signs:              { it: 'Tavolozza dei segni',                en: 'Signs palette' },
    insert:             { it: 'Durate e inserimento',               en: 'Durations and entry' },
    chordInsert:        { it: 'Inserimento accordi',                en: 'Chord entry' },
    accidentals:        { it: 'Alterazioni',                        en: 'Accidentals' },
    notations:          { it: 'Legature e articolazioni',           en: 'Ties and articulations' },
    analysis:           { it: 'Analisi (romani, sigle, cifre)',     en: 'Analysis (Roman, symbols, figures)' },
    incompleteMeasures: { it: 'Avviso misure incomplete',           en: 'Incomplete-measure warning' },
    midi:               { it: 'MIDI',                               en: 'MIDI' },
    more:               { it: 'Menu «Altro»',                       en: '“More” menu' },
};
import {
    WholeNoteIcon,
    HalfNoteIcon,
    QuarterNoteIcon,
    EighthNoteIcon,
    SixteenthNoteIcon,
    ThirtySecondNoteIcon,
    SixtyFourthNoteIcon,
    WholeRestIcon,
    HalfRestIcon,
    QuarterRestIcon,
    EighthRestIcon,
    SixteenthRestIcon,
    ThirtySecondRestIcon,
    SixtyFourthRestIcon,
    TripletIcon,
    SharpIcon,
    FlatIcon,
    NaturalIcon,
    DoubleSharpIcon,
    DoubleFlatIcon,
    TieIcon,
    DotIcon,
} from './icons/NoteValueIcons';
import { GroupIcon } from './icons/GroupIcon';
import { UngroupIcon } from './icons/UngroupIcon';
import { FlipStemIcon } from './icons/FlipStemIcon';

const TOOLBAR_ICON_CLASS = 'h-5 w-5';

/**
 * IL METRONOMO — e non un triangolo.
 *
 * Prima era un triangolo con due tratti dentro: cioè la stessa forma dell'avviso
 * delle misure incomplete, che un triangolo lo è per convenzione universale. Due
 * comandi diversi con lo stesso segno si confondono, e uno dei due perde.
 *
 * Quello che rende riconoscibile un metronomo di Maelzel non è la forma a punta —
 * quella ce l'ha anche il triangolo d'avviso — ma tre dettagli: il corpo TRONCATO
 * in cima (un trapezio, non un triangolo), l'asta che ne esce SOPRA, e il pesetto
 * infilato sull'asta. Senza quei tre resta un triangolo con dentro una riga.
 *
 * L'asta è ferma di proposito: farla oscillare a tempo vorrebbe dire ridisegnare
 * a ogni battito, ed è esattamente il genere di ridisegno continuo che in questa
 * applicazione ha già affamato il thread audio.
 */
const MetronomeIcon = () => (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        {/* corpo troncato in cima */}
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 20.5 L9.5 5 H14.5 L18.5 20.5 Z" />
        {/* base d'appoggio, più larga del corpo */}
        <path strokeLinecap="round" d="M4 20.5 H20" />
        {/* asta, che esce sopra il corpo */}
        <path strokeLinecap="round" d="M12 19 L14.6 3.5" />
        {/* pesetto infilato sull'asta */}
        <path strokeLinecap="round" strokeWidth="2.4" d="M11.7 12.2 L14.6 11.1" />
    </svg>
);

type ActiveTab = 'editor' | 'analysis';
type StaffSystemMode = 'grandstaff' | 'treble_only' | 'satb_ancient';
type StaffLayoutMode = 'parti_late' | 'parti_strette';
type CanvasFormat = 'page' | 'landscape';
type MetronomeUnit = 'quarter' | 'eighth' | 'dotted-quarter';
type SelectedNotesBeamState = 'unbeamable' | 'beamed' | 'mixed' | 'unbeamed';
import type { ToolbarGroupId } from './GrandStaffEditor';
import { usePreference } from '../preferences/usePreference';
import { useTranslation } from 'react-i18next';

type InsertionElement = { type: 'note' | 'rest'; duration: NoteDuration; isDotted?: boolean };

type GrandStaffToolbarProps = {
    isPlaying: boolean;
    togglePlayback: () => void;
    undoNotes: () => void;
    isRecording?: boolean;
    isCountingIn?: boolean;
    isRecArmed?: boolean;
    canRecord?: boolean;
    onToggleRecording?: () => void;
    quantizeGrid?: string;
    setQuantizeGrid?: (value: string) => void;
    onQuantizeAccTrack?: () => void;

    bpm: number;
    setBpm: (value: number) => void;
    isBpmActive: boolean;
    setIsBpmActive: (value: boolean) => void;
    isBpmActiveRef: React.MutableRefObject<boolean>;
    bpmInputString: string;
    setBpmInputString: React.Dispatch<React.SetStateAction<string>>;
    bpmControlRef: React.RefObject<HTMLDivElement>;
    bpmInputRef: React.RefObject<HTMLInputElement>;
    activateBpmEdit: () => void;
    handleBpmFocus: () => void;
    handleBpmBlur: () => void;
    handleBpmKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    handleBpmInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleBpmInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;

    toggleMetronome: () => void;
    isMetronomeOn: boolean;
    metronomeFlash: 'strong' | 'weak' | null;
    metronomeUnit: MetronomeUnit;
    setMetronomeUnit: (value: MetronomeUnit) => void;

    keySignatureRoot: string;
    handleKeySignatureRootChange: (value: string) => void;
    keyChangeMode: 'none' | 'modal' | 'transpose';
    setTransposeKeyChangeEnabled: (enabled: boolean) => void;
    setKeyChangeMode: (mode: 'none' | 'modal' | 'transpose') => void;
    modalTonicOverride: string;
    setModalTonicOverride: (value: string) => void;
    modalTonicOptions: Array<{ idx: number; value: string; label: string }>;
    isMinorMode: boolean;
    setIsMinorMode: (value: boolean) => void;
    autoLeadingToneInMinor: boolean;
    setAutoLeadingToneInMinor: (value: boolean) => void;
    sharpKeyOptions: Array<{ value: string; label: string }>;
    flatKeyOptions: Array<{ value: string; label: string }>;

    timeSignatureControl: React.ReactNode;

    minMeasureCountDraft: string;
    setMinMeasureCountDraft: (value: string) => void;
    applyMinMeasureCountDraft: () => void;
    bumpMinMeasureCount: (delta: number) => void;

    measuresPerLineDraft: string;
    setMeasuresPerLineDraft: (value: string) => void;
    applyMeasuresPerLineDraft: () => void;
    bumpMeasuresPerLine: (delta: number) => void;

    /** Apre il pannello delle modifiche di misura (lo stesso del tasto T). */
    onOpenMeasurePanel?: () => void;
    selectedVoice: Voice;
    /** Numero di parti del coro: 4 (SATB), 3 (S-A-B) o 2 (S-B). */
    partCount?: PartCount;
    setPartCount?: (value: PartCount) => void;
    setSelectedVoice: (value: Voice) => void;
    // When notes are selected, clicking a voice button also moves the selection to
    // that voice (reassign), in addition to setting the insertion voice.
    hasNoteSelection?: boolean;
    onReassignSelectionToVoice?: (voice: Voice) => void;
    soloVoices?: Set<number>;
    onToggleSolo?: (voice: number) => void;
    /** Copia l'INTERA voce SATB (tutte le note nel brano). Esposto via tasto destro
     *  sui pulsanti S/A/T/B (oltre alla scorciatoia ⇧⌘C). */
    onCopyVoice?: (voice: Voice) => void;
    voiceInstruments?: Record<number, string>;
    onChangeVoiceInstrument?: (voice: number, instrument: string) => void;
    /** Traccia ACC attiva (quando activeStaffArea === 'accompaniment'): il selettore
     *  strumento della toolbar agisce su di essa invece che sulla voce SATB. */
    activeAccTrack?: { id: string; name: string; instrumentId: number; isDrum?: boolean } | null;
    onChangeAccTrackInstrument?: (trackId: string, gm: number) => void;
    voiceSoundBank?: 'orchestral' | 'gm';
    onChangeVoiceSoundBank?: (voice: number, bank: 'orchestral' | 'gm') => void;
    activeAccTrackBank?: 'orchestral' | 'gm';
    onChangeAccTrackSoundBank?: (trackId: string, bank: 'orchestral' | 'gm') => void;
    isMixerOpen?: boolean;
    onToggleMixer?: () => void;
    /** Modulo percussioni flottante: il pulsante 🥁 compare solo se esiste una batteria. */
    hasDrumTrack?: boolean;
    isDrumPanelOpen?: boolean;
    onToggleDrumPanel?: () => void;
    isDynamicsPanelOpen?: boolean;
    onToggleDynamicsPanel?: () => void;

    selectedInsertion: InsertionElement;
    setSelectedInsertion: React.Dispatch<React.SetStateAction<InsertionElement>>;
    selectedNoteIds: Set<string>;
    applyEditToSelectedNotes: (fn: (note: StaffNote) => StaffNote, options?: { rebuildTimeline?: boolean }) => void;
    computeDurationTicks: (note: StaffNote) => number;
    /** Ref tracking whether the current selection is an auto-selected just-inserted note. */
    justInsertedNoteRef: React.MutableRefObject<string | null>;
    setSelectedNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;

    isTriplet: boolean;
    setIsTriplet: (value: boolean | ((prev: boolean) => boolean)) => void;
    isDuplet: boolean;
    setIsDuplet: (value: boolean | ((prev: boolean) => boolean)) => void;
    isSwing: boolean;
    setIsSwing: (value: boolean | ((prev: boolean) => boolean)) => void;
    setDottedFromSource: (value: boolean, source: 'toolbar' | 'hotkey') => void;
    setTupletNoteCount: (value: number) => void;
    setTripletBaseDuration: (value: NoteDuration | null) => void;
    canUseDuplet: boolean;

    toggleDoubleBarlineAtPlayhead: () => void;
    insertMeasureAtPlayhead: () => void;
    playheadPosition: { x: number; systemIndex: number } | null;

    activeAccidental: AccidentalType | null;
    activeAccidentalRef: React.MutableRefObject<AccidentalType | null>;
    setActiveAccidentalAndApplyFromSource: (value: AccidentalType | null, source: 'toolbar' | 'hotkey') => void;

    selectedNotesBeamState: SelectedNotesBeamState;
    handleToggleBeamGroup: () => void;
    handleToggleTie: () => void;
    handleFlipStem: () => void;
    selectedTiePair: { fromNoteId: string; toNoteId: string } | null;

    activeTab: ActiveTab;
    setActiveTab: (value: ActiveTab | ((prev: ActiveTab) => ActiveTab)) => void;
    isAnalysisEnabled: boolean;
    setIsAnalysisEnabled: (value: boolean | ((prev: boolean) => boolean)) => void;
    showRomanAnalysis: boolean;
    setShowRomanAnalysis: (value: boolean | ((prev: boolean) => boolean)) => void;
    showSymbolAnalysis: boolean;
    showFiguredBass?: boolean;
    setShowFiguredBass?: (v: boolean | ((p: boolean) => boolean)) => void;
    setShowSymbolAnalysis: (value: boolean | ((prev: boolean) => boolean)) => void;
    analysisSubject: 'satb' | 'acc';
    setAnalysisSubject: (value: 'satb' | 'acc') => void;
    accTracksForAnalysis: Array<{ id: string; name: string }>;
    analysisAccTrackId: string | null;
    setAnalysisAccTrackId: (value: string | null) => void;

    /** Rifà il motore audio (contesto + mixer): rete di sicurezza quando il suono non
     *  esce più e non c'è modo di accorgersene da dentro. */
    onRestartAudio?: () => void;
    moreMenuRef: React.RefObject<HTMLDivElement>;
    isMoreMenuOpen: boolean;
    setIsMoreMenuOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
    staffSystemMode: StaffSystemMode;
    setStaffSystemMode: (value: StaffSystemMode) => void;
    lastNonSatbModeRef: React.MutableRefObject<StaffSystemMode>;
    staffLayoutMode: StaffLayoutMode;
    setStaffLayoutMode: (value: StaffLayoutMode | ((prev: StaffLayoutMode) => StaffLayoutMode)) => void;
    canvasFormat: CanvasFormat;
    /** Vista della partitura: pagina (righe che vanno a capo) o nastro continuo. */
    viewMode?: 'page' | 'linear';
    setViewMode?: (v: 'page' | 'linear') => void;
    /** Spaziatura proporzionale al contenuto (larghezza della misura secondo le note). */
    contentAwareSpacing?: boolean;
    /** Avviso delle misure incomplete: quante sono, e se i riquadri rossi si vedono. */
    misureIncompleteTotali?: number;
    showIncompleteMeasureWarnings?: boolean;
    setShowIncompleteMeasureWarnings?: (f: (v: boolean) => boolean) => void;
    setContentAwareSpacing?: (v: boolean) => void;
    setCanvasFormat: (value: CanvasFormat) => void;
    /** Opt-in guide: draw approximate page breaks between systems in the editor. */
    showPageBreaks?: boolean;
    onToggleShowPageBreaks?: () => void;
    isMidiMenuOpen: boolean;
    setIsMidiMenuOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
    selectedMidiOutput: any | null;
    setSelectedMidiOutput: (value: any | null) => void;
    midiOutputs: any[];
    handleActivateMidi: () => Promise<void>;

    midiStepInputEnabled: boolean;
    midiStepInputDeviceName: string | null;
    onToggleMidiStepInput: () => void;

    toolbarGroupOrder: ToolbarGroupId[];
    reorderToolbarGroups: (dragId: ToolbarGroupId, overId: ToolbarGroupId) => void;
    /** I gruppi tolti dalla barra. Elenco esplicito: vedi il commento nell'editor. */
    hiddenToolbarGroups: ToolbarGroupId[];
    onToggleToolbarGroup: (id: ToolbarGroupId) => void;
    onResetToolbarGroups: () => void;
    isToolbarCustomizeOpen: boolean;
    onCloseToolbarCustomize: () => void;
    isToolbarHidden: boolean;

    showQuickInsertBar: boolean;
    showHarmonyDebug: boolean;
    chordInsertMode: boolean;
    onToggleChordInsertMode: () => void;
    onRevoiceChord: () => void;
    revoiceDispIdx: number;
    hasSelectedNotes: boolean;
    selectedNotesHave7th: boolean;
    accPattern: 'block' | 'arpeggio_up' | 'arpeggio_down' | 'broken' | 'albertino' | 'ondulato';
    onSetAccPattern: (p: 'block' | 'arpeggio_up' | 'arpeggio_down' | 'broken' | 'albertino' | 'ondulato') => void;
    activeStaffArea: 'satb' | 'accompaniment';
    accLetRing: boolean;
    onToggleAccLetRing: () => void;
    transformMode: 'tonal' | 'real';
    onToggleTransformMode: () => void;
    onMelodicTransform: (kind: 'transpose' | 'invert' | 'retrograde' | 'retrogradeInvert', opts?: { amount?: number }) => void;
};

const IconComponent: React.FC<{ type: 'note' | 'rest'; duration: NoteDuration; className?: string }> = ({ type, duration, className }) => {
    const icons = {
        note: {
            whole: WholeNoteIcon,
            half: HalfNoteIcon,
            quarter: QuarterNoteIcon,
            eighth: EighthNoteIcon,
            sixteenth: SixteenthNoteIcon,
            'thirty-second': ThirtySecondNoteIcon,
            'sixty-fourth': SixtyFourthNoteIcon,
        },
        rest: {
            whole: WholeRestIcon,
            half: HalfRestIcon,
            quarter: QuarterRestIcon,
            eighth: EighthRestIcon,
            sixteenth: SixteenthRestIcon,
            'thirty-second': ThirtySecondRestIcon,
            'sixty-fourth': SixtyFourthRestIcon,
        },
    };
    const Comp = icons[type][duration];
    return <Comp className={className} />;
};

const GrandStaffToolbar: React.FC<GrandStaffToolbarProps> = props => {
    const {
        isPlaying,
        togglePlayback,
        undoNotes,
        isRecording = false,
        isCountingIn = false,
        isRecArmed = false,
        canRecord = false,
        onToggleRecording,
        quantizeGrid = 'eighth',
        setQuantizeGrid,
        onQuantizeAccTrack,
        bpm,
        setBpm,
        isBpmActive,
        setIsBpmActive,
        isBpmActiveRef,
        bpmInputString,
        setBpmInputString,
        bpmControlRef,
        bpmInputRef,
        activateBpmEdit,
        handleBpmFocus,
        handleBpmBlur,
        handleBpmKeyDown,
        handleBpmInputChange,
        handleBpmInputKeyDown,
        toggleMetronome,
        isMetronomeOn,
        metronomeFlash,
        metronomeUnit,
        setMetronomeUnit,
        keySignatureRoot,
        handleKeySignatureRootChange,
        keyChangeMode,
        setTransposeKeyChangeEnabled,
        setKeyChangeMode,
        modalTonicOverride,
        setModalTonicOverride,
        modalTonicOptions,
        isMinorMode,
        setIsMinorMode,
        autoLeadingToneInMinor,
        setAutoLeadingToneInMinor,
        sharpKeyOptions,
        flatKeyOptions,
        timeSignatureControl,
        minMeasureCountDraft,
        setMinMeasureCountDraft,
        applyMinMeasureCountDraft,
        bumpMinMeasureCount,
        measuresPerLineDraft,
        setMeasuresPerLineDraft,
        applyMeasuresPerLineDraft,
        bumpMeasuresPerLine,
        onOpenMeasurePanel,
        selectedVoice,
        partCount = 4,
        setPartCount,
        setSelectedVoice,
        hasNoteSelection,
        onReassignSelectionToVoice,
        soloVoices,
        onToggleSolo,
        onCopyVoice,
        voiceInstruments,
        onChangeVoiceInstrument,
        activeAccTrack,
        onChangeAccTrackInstrument,
        voiceSoundBank,
        onChangeVoiceSoundBank,
        activeAccTrackBank,
        onChangeAccTrackSoundBank,
        isMixerOpen,
        onToggleMixer,
        hasDrumTrack,
        isDrumPanelOpen,
        onToggleDrumPanel,
        isDynamicsPanelOpen,
        onToggleDynamicsPanel,
        selectedInsertion,
        setSelectedInsertion,
        selectedNoteIds,
        applyEditToSelectedNotes,
        computeDurationTicks,
        justInsertedNoteRef,
        setSelectedNoteIds,
        isTriplet,
        setIsTriplet,
        isDuplet,
        setIsDuplet,
        isSwing,
        setIsSwing,
        setDottedFromSource,
        setTupletNoteCount,
        setTripletBaseDuration,
        canUseDuplet,
        toggleDoubleBarlineAtPlayhead,
        insertMeasureAtPlayhead,
        playheadPosition,
        activeAccidental,
        activeAccidentalRef,
        setActiveAccidentalAndApplyFromSource,
        selectedNotesBeamState,
        handleToggleBeamGroup,
        handleToggleTie,
        handleFlipStem,
        selectedTiePair,
        activeTab,
        setActiveTab,
        isAnalysisEnabled,
        setIsAnalysisEnabled,
        showRomanAnalysis,
        setShowRomanAnalysis,
        showSymbolAnalysis,
        showFiguredBass = true,
        setShowFiguredBass,
        setShowSymbolAnalysis,
        analysisSubject,
        setAnalysisSubject,
        accTracksForAnalysis,
        analysisAccTrackId,
        setAnalysisAccTrackId,
        onRestartAudio,
        moreMenuRef,
        isMoreMenuOpen,
        setIsMoreMenuOpen,
        staffSystemMode,
        setStaffSystemMode,
        lastNonSatbModeRef,
        staffLayoutMode,
        setStaffLayoutMode,
        canvasFormat,
        viewMode,
        setViewMode,
        contentAwareSpacing,
        misureIncompleteTotali = 0,
        showIncompleteMeasureWarnings = true,
        setShowIncompleteMeasureWarnings,
        setContentAwareSpacing,
        setCanvasFormat,
        showPageBreaks,
        onToggleShowPageBreaks,
        isMidiMenuOpen,
        setIsMidiMenuOpen,
        selectedMidiOutput,
        setSelectedMidiOutput,
        midiOutputs,
        handleActivateMidi,
        midiStepInputEnabled,
        midiStepInputDeviceName,
        onToggleMidiStepInput,
        toolbarGroupOrder,
        reorderToolbarGroups,
        hiddenToolbarGroups,
        onToggleToolbarGroup,
        onResetToolbarGroups,
        isToolbarCustomizeOpen,
        onCloseToolbarCustomize,
        isToolbarHidden,
        showQuickInsertBar,
        showHarmonyDebug,
        chordInsertMode,
        onToggleChordInsertMode,
        onRevoiceChord,
        revoiceDispIdx,
        hasSelectedNotes,
        selectedNotesHave7th,
        accPattern,
        onSetAccPattern,
        activeStaffArea,
        accLetRing,
        onToggleAccLetRing,
        transformMode,
        onToggleTransformMode,
        onMelodicTransform,
    } = props;

    // La modulazione cromatica si governa dalle PREFERENZE (analysis.chromaticModulation).
    // Aveva anche un interruttore in barra: due comandi per la stessa cosa, e in barra
    // occupava spazio in un gruppo già affollato — vedi il commit che l'ha tolto.
    const { t } = useTranslation('ui');
    const { t: tT, i18n: i18nToolbar } = useTranslation('toolbar');
    const nomeGruppo = useCallback(
        (id: ToolbarGroupId) => (i18nToolbar.language || 'it').startsWith('en') ? NOMI_GRUPPI[id].en : NOMI_GRUPPI[id].it,
        [i18nToolbar.language],
    );

    const voiceName = useCallback((v: number): string => {
        return tT(v === 1 ? 'voice_soprano' : v === 2 ? 'voice_alto' : v === 3 ? 'voice_tenor' : 'voice_bass');
    }, [tT]);

    // Context menu (tasto destro) sui pulsanti voce S/A/T/B → "Copia intera voce".
    const [voiceCopyMenu, setVoiceCopyMenu] = useState<{ x: number; y: number; voice: Voice } | null>(null);
    useEffect(() => {
        if (!voiceCopyMenu) return;
        const close = () => setVoiceCopyMenu(null);
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVoiceCopyMenu(null); };
        window.addEventListener('mousedown', close);
        window.addEventListener('keydown', onKey);
        return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); };
    }, [voiceCopyMenu]);

    const durations: { duration: NoteDuration; label: string }[] = useMemo(() => ([
        { duration: 'whole', label: tT('duration_whole') },
        { duration: 'half', label: tT('duration_half') },
        { duration: 'quarter', label: tT('duration_quarter') },
        { duration: 'eighth', label: tT('duration_eighth') },
        { duration: 'sixteenth', label: tT('duration_sixteenth') },
        { duration: 'thirty-second', label: tT('duration_thirty_second') },
        { duration: 'sixty-fourth', label: tT('duration_sixty_fourth') },
    ]), [tT]);

    // Gruppo MIDI: stato del suo menù e formato di esportazione. Il formato è la STESSA
    // preferenza del pannello Preferenze (`midi.exportType`): qui perché è dove si decide
    // come il file esce verso gli altri programmi, non un'impostazione da cercare altrove.
    const midiGroupRef = useRef<HTMLDivElement>(null);
    const [isMidiGroupOpen, setIsMidiGroupOpen] = useState(false);
    const [midiExportType, setMidiExportType] = usePreference<string>('midi.exportType');

    useEffect(() => {
        if (!isMidiGroupOpen) return;
        const onDown = (e: MouseEvent) => {
            if (midiGroupRef.current && !midiGroupRef.current.contains(e.target as Node)) setIsMidiGroupOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [isMidiGroupOpen]);

    const toolbarGroups: Record<ToolbarGroupId, React.ReactNode> = {
        playback: (
            <div className="flex items-center gap-1">
                <button
                    onClick={togglePlayback}
                    className={`p-2 rounded-full transition-colors ${isPlaying ? 'text-yellow-400 hover:bg-yellow-400/20' : 'text-green-400 hover:bg-green-400/20'}`}
                    title={isPlaying ? tT('playback_pause') : tT('playback_play')}
                >
                    {isPlaying ? <PauseSolidIcon className={TOOLBAR_ICON_CLASS} /> : <PlaySolidIcon className={TOOLBAR_ICON_CLASS} />}
                </button>
                {onToggleRecording && (
                  /* IL TASTO DI REGISTRAZIONE si riconosce a colpo d'occhio.
                     Era un cerchietto grigio come tutti gli altri comandi: il rosso è
                     l'unico modo in cui un tasto REC si dice, su qualunque apparecchio
                     dal 1960 in qua. E i due stati che contano non si distinguono per
                     sfumatura ma per INVERSIONE — a riposo il pallino è rosso sul
                     fondo scuro, mentre si registra il fondo diventa rosso e il pallino
                     bianco: si vede con la coda dell'occhio, senza doverlo cercare.
                     Il conto alla rovescia resta arancione, perché è un'attesa e non
                     una registrazione: fermarsi lì non perde niente. */
                  <button
                    onClick={canRecord ? onToggleRecording : undefined}
                    disabled={!canRecord}
                    className={`p-2 rounded-md transition-colors ${
                      !canRecord
                        ? 'cursor-not-allowed opacity-40'
                        : isRecording
                          ? (isCountingIn ? 'bg-orange-500' : 'bg-red-600')
                          : isRecArmed
                            ? 'ring-2 ring-red-500/70 hover:bg-gray-600'
                            : 'hover:bg-gray-600'
                    }`}
                    title={
                      !canRecord
                        ? 'REC: aggiungi una traccia ACC per registrare'
                        : isRecording
                          ? 'Ferma registrazione (REC / R)'
                          : isRecArmed
                            ? 'Premi Spazio per avviare — premi ancora per disarmare'
                            : 'Arma registrazione MIDI (R / REC) — poi premi Spazio'
                    }
                  >
                    <span className={`inline-block w-4 h-4 rounded-full border-2 ${
                      !canRecord
                        ? 'bg-gray-500 border-gray-500'
                        : isRecording
                          ? 'bg-white border-white'
                          : isRecArmed
                            ? 'bg-red-500 border-red-500 animate-pulse'
                            : 'bg-red-500 border-red-500'
                    }`} />
                  </button>
                )}
                {(setQuantizeGrid || onQuantizeAccTrack) && (
                  <div className="flex items-center gap-1 ml-1">
                    {setQuantizeGrid && (
                      <select
                        value={quantizeGrid}
                        onChange={e => setQuantizeGrid(e.target.value)}
                        className="bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 cursor-pointer"
                        title="Griglia di quantizzazione (binaria o di terzina)"
                      >
                        <option value="sixteenth">1/16</option>
                        <option value="eighth">1/8</option>
                        <option value="quarter">1/4</option>
                        <option value="half">1/2</option>
                        <option value="eighth-triplet">1/8 T</option>
                        <option value="quarter-triplet">1/4 T</option>
                      </select>
                    )}
                    {onQuantizeAccTrack && (
                      <button
                        onClick={onQuantizeAccTrack}
                        className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 font-mono font-bold transition-colors"
                        title="Quantizza alla griglia scelta — note selezionate (solo quelle misure), o tutte se nessuna selezione"
                      >Q</button>
                    )}
                  </div>
                )}
                <button onClick={undoNotes} className="p-2 rounded-full text-gray-300 hover:bg-gray-600 transition-colors" title={tT('playback_undo')}>
                    <ArrowUturnLeftIcon className={TOOLBAR_ICON_CLASS} />
                </button>
            </div>
        ),
        // PROPRIETÀ del luogo in cui si trova il cursore: metro, tonalità, stanghette,
        // ritornelli, testo, modulazioni, tonicizzazioni, override d'analisi. Sono interventi
        // al volo sulla partitura, quindi il pulsante sta per conto suo — accanto ai comandi
        // del cursore — e non fra le misure, dove si confondeva con le impostazioni di pagina.
        // In musica "punto" vuol dire punto di valore o di staccato: da evitare come nome.
        signs: onToggleDynamicsPanel ? (
            <button
                onClick={onToggleDynamicsPanel}
                title="Tavolozza: durate, alterazioni, dinamiche, articolazioni, struttura, pattern e trasformazioni (apri/chiudi)"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${isDynamicsPanelOpen ? 'bg-sky-600 text-white' : 'bg-slate-700 text-gray-100 border border-slate-600 hover:bg-slate-600'}`}
            >
                <span style={{ fontFamily: 'serif', fontStyle: 'italic', fontWeight: 700, fontSize: 15, lineHeight: 1 }}>pf</span>
                <span>Tavolozza</span>
            </button>
        ) : null,
        measurePanel: onOpenMeasurePanel ? (
            <button
                onClick={onOpenMeasurePanel}
                className="px-2.5 py-1 rounded-md bg-slate-700 border border-slate-600 text-gray-100 text-xs font-semibold hover:bg-slate-600 transition-colors"
                title={tT('measure_panel_tooltip', { defaultValue: 'Proprietà: metro, tonalità, stanghette, ritornelli, testo, modulazioni e override d\u2019analisi — scorciatoia: T' })}
            >
                {tT('measure_panel_label', { defaultValue: 'Proprietà' })}
            </button>
        ) : null,
        bpm: (
            <div className="flex items-center gap-1">
                <div
                    ref={bpmControlRef}
                    tabIndex={0}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        activateBpmEdit();
                    }}
                    onFocus={handleBpmFocus}
                    onBlur={handleBpmBlur}
                    onKeyDown={handleBpmKeyDown}
                    className="relative flex items-center gap-2 p-1 rounded-md bg-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                    <span className="text-xs text-slate-400">BPM</span>
                    {isBpmActive ? (
                        <input
                            ref={bpmInputRef}
                            value={bpmInputString}
                            onChange={handleBpmInputChange}
                            onKeyDown={handleBpmInputKeyDown}
                            onBlur={handleBpmBlur}
                            inputMode="numeric"
                            className="text-sm font-bold w-10 text-center bg-transparent outline-none"
                            aria-label="BPM"
                        />
                    ) : (
                        <span className="text-sm font-bold w-10 text-center">{bpm}</span>
                    )}
                </div>
                <button
                    onMouseDown={() => {
                        if (bpmControlRef.current && document.activeElement && bpmControlRef.current.contains(document.activeElement)) {
                            bpmControlRef.current.blur();
                        }
                        isBpmActiveRef.current = false;
                        setIsBpmActive(false);
                    }}
                    onClick={toggleMetronome}
                    className={`relative p-2 rounded-full transition-colors ${isMetronomeOn ? 'text-cyan-400' : 'text-gray-300 hover:bg-gray-600'} ${metronomeFlash === 'strong' ? 'bg-cyan-400/50' : metronomeFlash === 'weak' ? 'bg-cyan-400/20' : ''}`}
                    title={tT('metronome_tooltip')}
                >
                    <MetronomeIcon />
                </button>

                <select
                    value={metronomeUnit}
                    onChange={(e) => setMetronomeUnit(e.target.value as MetronomeUnit)}
                    className="bg-gray-700 border border-gray-600 rounded-full p-0.5 text-xs w-6 h-6 appearance-none cursor-pointer focus:ring-2 focus:ring-cyan-500"
                    title={tT('metronome_unit_tooltip')}
                    style={{ minWidth: 0, paddingRight: 0, paddingLeft: 0, textIndent: '-9999px', backgroundPosition: 'center right 2px', backgroundRepeat: 'no-repeat', backgroundSize: '1em', backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'16\' height=\'16\' fill=\'none\' stroke=\'%23ccc\' stroke-width=\'2\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")' }}
                >
                    <option value="quarter">{tT('metronome_unit_quarter')}</option>
                    <option value="eighth">{tT('metronome_unit_eighth')}</option>
                    <option value="dotted-quarter">{tT('metronome_unit_dotted_quarter')}</option>
                </select>
            </div>
        ),
        key: (
            <div className="flex items-center gap-1.5 flex-nowrap whitespace-nowrap">
                <span className="text-xs text-slate-400">{tT('key_label')}</span>
                <select
                    id="key-signature-select"
                    value={keySignatureRoot}
                    onChange={e => handleKeySignatureRootChange(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs w-[90px]"
                >
                    <optgroup label={tT('key_optgroup_sharps')}>{sharpKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                    <optgroup label={tT('key_optgroup_flats')}>{flatKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                </select>

                <div className="relative flex p-0.5 bg-gray-900/50 rounded-md">
                    <div className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform" style={{ transform: `translateX(${isMinorMode ? '100%' : '0%'})` }}></div>
                    <button onClick={() => setIsMinorMode(false)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${!isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>{tT('key_major')}</button>
                    <button onClick={() => setIsMinorMode(true)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>{tT('key_minor')}</button>
                </div>

                <label className="flex items-center gap-2 text-xs text-gray-300 select-none">
                    <input
                        type="checkbox"
                        checked={keyChangeMode === 'transpose'}
                        onChange={(e) => setTransposeKeyChangeEnabled(e.target.checked)}
                        className="accent-cyan-500"
                    />
                    {tT('key_transpose')}
                </label>

                <label className="flex items-center gap-2 text-xs text-gray-300 select-none">
                    <input
                        type="checkbox"
                        checked={keyChangeMode === 'modal'}
                        onChange={(e) => setKeyChangeMode(e.target.checked ? 'modal' : 'none')}
                        className="accent-cyan-500"
                    />
                    {tT('key_modal')}
                </label>

                {keyChangeMode === 'modal' && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{tT('key_tonic_label')}</span>
                        <select
                            value={modalTonicOverride}
                            onChange={(e) => setModalTonicOverride(e.target.value)}
                            className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs w-24"
                            title={tT('key_tonic_tooltip')}
                        >
                            <option value="">{tT('key_tonic_auto')}</option>
                            {modalTonicOptions.map(opt => (
                                <option key={opt.idx} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                )}


                <label className="flex items-center gap-2 text-xs text-gray-300 select-none" title={tT('key_auto_leading_tone_tooltip')}>
                    <input
                        type="checkbox"
                        checked={autoLeadingToneInMinor}
                        onChange={(e) => setAutoLeadingToneInMinor(e.target.checked)}
                        className="accent-cyan-500"
                    />
                    {tT('key_auto_leading_tone')}
                </label>
            </div>
        ),
        time: (
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">{tT('time_label')}</span>
                {timeSignatureControl}
            </div>
        ),
        measures: (
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">{tT('measures_label')}</span>
                {/* `items-stretch`: la colonnina delle frecce prende l'altezza del campo,
                    invece di imporne una sua. Prima erano 18+18 = 36 px contro i 30 del
                    campo, e il gruppo sporgeva di sei pixel sopra e sotto tutti gli altri. */}
                <div className="flex items-stretch">
                    <input
                        value={minMeasureCountDraft}
                        onChange={e => setMinMeasureCountDraft(e.target.value)}
                        onBlur={applyMinMeasureCountDraft}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                applyMinMeasureCountDraft();
                            }
                        }}
                        inputMode="numeric"
                        className="w-14 bg-slate-700 border border-slate-600 rounded-l-md px-2 py-1 text-sm text-white"
                        aria-label={tT('measures_count_aria')}
                    />
                    <div className="flex flex-col">
                        <button
                            onClick={() => bumpMinMeasureCount(+1)}
                            className="flex-1 w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-slate-600 rounded-tr-md text-[10px] leading-none text-gray-200 hover:bg-slate-600"
                            title={tT('measures_increase')}
                            aria-label={tT('measures_increase')}
                        >
                            ▲
                        </button>
                        <button
                            onClick={() => bumpMinMeasureCount(-1)}
                            className="flex-1 w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-t-0 border-slate-600 rounded-br-md text-[10px] leading-none text-gray-200 hover:bg-slate-600"
                            title={tT('measures_decrease')}
                            aria-label={tT('measures_decrease')}
                        >
                            ▼
                        </button>
                    </div>
                </div>
                <div className="w-px h-5 bg-slate-600 mx-1"></div>
                <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">{tT('measures_per_line_label')}</span>
                    <div className="flex items-stretch">
                        <input
                            value={measuresPerLineDraft}
                            onChange={e => setMeasuresPerLineDraft(e.target.value)}
                            onBlur={applyMeasuresPerLineDraft}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    applyMeasuresPerLineDraft();
                                }
                            }}
                            inputMode="numeric"
                            className="w-12 bg-slate-700 border border-slate-600 rounded-l-md px-2 py-1 text-sm text-white"
                            aria-label={tT('measures_per_line_aria')}
                            title={tT('measures_per_line_tooltip')}
                        />
                        <div className="flex flex-col">
                            <button
                                onClick={() => bumpMeasuresPerLine(+1)}
                                className="flex-1 w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-slate-600 rounded-tr-md text-[10px] leading-none text-gray-200 hover:bg-slate-600"
                                title={tT('measures_per_line_increase')}
                                aria-label={tT('measures_per_line_increase')}
                            >
                                ▲
                            </button>
                            <button
                                onClick={() => bumpMeasuresPerLine(-1)}
                                className="flex-1 w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-t-0 border-slate-600 rounded-br-md text-[10px] leading-none text-gray-200 hover:bg-slate-600"
                                title={tT('measures_per_line_decrease')}
                                aria-label={tT('measures_per_line_decrease')}
                            >
                                ▼
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        ),
        voices: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                {activeVoicesForPartCount(partCount).map(v => (
                    <button
                        key={v}
                        onClick={() => { setSelectedVoice(v as Voice); if (hasNoteSelection) onReassignSelectionToVoice?.(v as Voice); }}
                        onDoubleClick={(e) => { e.preventDefault(); onToggleSolo?.(v); }}
                        onContextMenu={onCopyVoice ? (e) => { e.preventDefault(); setVoiceCopyMenu({ x: e.clientX, y: e.clientY, voice: v as Voice }); } : undefined}
                        className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${soloVoices?.has(v) ? 'ring-2 ring-yellow-400 ' : ''}${selectedVoice === v ? (v === 1 ? 'bg-blue-600 text-white' : v === 2 ? 'bg-orange-500 text-white' : v === 3 ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'text-gray-300 hover:bg-gray-600'}`}
                        title={`${voiceName(v)}${soloVoices?.has(v) ? tT('voice_solo_suffix') : ''}${hasNoteSelection ? tT('voice_reassign_suffix') : tT('voice_tooltip_suffix')}${onCopyVoice ? ' · tasto destro: copia intera voce' : ''}`}
                    >
                        {v === 1 ? 'S' : v === 2 ? 'A' : v === 3 ? 'T' : 'B'}
                    </button>
                ))}
            </div>
        ),
        voiceInstrument: (
            // Quando l'area attiva è una traccia ACC, il selettore agisce sullo strumento
            // della TRACCIA (per GM); altrimenti sulla voce SATB selezionata (per soundfont).
            (activeStaffArea === 'accompaniment' && activeAccTrack && onChangeAccTrackInstrument) ? (
                activeAccTrack.isDrum ? (
                    // La batteria suona un KIT (non uno strumento GM) → niente menu strumenti, una
                    // chip che chiarisce il contesto (il kit Orchestra/Rock si sceglie dal modulo 🥁).
                    <div className="flex items-center gap-1 p-1 px-2 bg-slate-700 rounded-md text-[10px] font-medium text-amber-300" title={`${activeAccTrack.name} — kit di batteria (il kit si sceglie dal modulo 🥁)`}>
                        🥁 Drum
                    </div>
                ) : (
                    <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md" title={`Strumento traccia: ${activeAccTrack.name}`}>
                        <select
                            className="bg-slate-800 text-gray-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 cursor-pointer"
                            value={gmToSoundfont(activeAccTrack.instrumentId)}
                            onChange={(e) => onChangeAccTrackInstrument(activeAccTrack.id, soundfontToGm(e.target.value))}
                        >
                            {INSTRUMENTS.map(opt => (
                                <option key={opt.soundfont} value={opt.soundfont}>{opt.emoji} {tT('instrument_' + opt.i18nKey)}</option>
                            ))}
                        </select>
                        {onChangeAccTrackSoundBank && (
                            <select
                                className="bg-slate-800 text-gray-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 cursor-pointer"
                                title="Banco timbrico: Orchestrale (campioni locali) o GM"
                                value={activeAccTrackBank ?? 'orchestral'}
                                onChange={(e) => onChangeAccTrackSoundBank(activeAccTrack.id, e.target.value as 'orchestral' | 'gm')}
                            >
                                <option value="orchestral">🎻 Orch</option>
                                <option value="gm">🎹 GM</option>
                            </select>
                        )}
                    </div>
                )
            ) : onChangeVoiceInstrument ? (
                <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md" title={tT('voice_instrument_tooltip', { voice: voiceName(selectedVoice) })}>
                    <select
                        className="bg-slate-800 text-gray-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 cursor-pointer"
                        value={voiceInstruments?.[selectedVoice] || 'acoustic_grand_piano'}
                        onChange={(e) => onChangeVoiceInstrument(selectedVoice, e.target.value)}
                    >
                        {INSTRUMENTS.map(opt => (
                            <option key={opt.soundfont} value={opt.soundfont}>{opt.emoji} {tT('instrument_' + opt.i18nKey)}</option>
                        ))}
                    </select>
                    {onChangeVoiceSoundBank && (
                        <select
                            className="bg-slate-800 text-gray-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 cursor-pointer"
                            title="Banco timbrico: Orchestrale (campioni locali) o GM"
                            value={voiceSoundBank ?? 'orchestral'}
                            onChange={(e) => onChangeVoiceSoundBank(selectedVoice, e.target.value as 'orchestral' | 'gm')}
                        >
                            <option value="orchestral">🎻 Orch</option>
                            <option value="gm">🎹 GM</option>
                        </select>
                    )}
                </div>
            ) : null
        ),
        mixer: (onToggleMixer || (hasDrumTrack && onToggleDrumPanel)) ? (
            <div className="flex items-center gap-1">
                {onToggleMixer && (
                    <button
                        onClick={onToggleMixer}
                        title="Mixer"
                        className={`flex items-center gap-1 p-1 px-2 rounded-md text-xs font-semibold transition-colors ${isMixerOpen ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-gray-300 hover:bg-gray-600'}`}
                    >
                        🎚 Mixer
                    </button>
                )}
                {hasDrumTrack && onToggleDrumPanel && (
                    <button
                        onClick={onToggleDrumPanel}
                        title="Modulo percussioni (apri/chiudi)"
                        className={`flex items-center gap-1 p-1 px-2 rounded-md text-xs font-semibold transition-colors ${isDrumPanelOpen ? 'bg-amber-600 text-white' : 'bg-slate-700 text-gray-300 hover:bg-gray-600'}`}
                    >
                        🥁
                    </button>
                )}
            </div>
        ) : null,
        insert: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={() => { setSelectedInsertion(prev => ({ ...prev, type: prev.type === 'note' ? 'rest' : 'note' })); }}
                    className={`p-1 rounded-md transition-colors ${selectedInsertion.type === 'rest' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={selectedInsertion.type === 'note' ? tT('insert_switch_to_rest') : tT('insert_rest_mode_switch_to_note')}
                >
                    {selectedInsertion.type === 'note'
                        ? <QuarterRestIcon className={TOOLBAR_ICON_CLASS} />
                        : <QuarterNoteIcon className={TOOLBAR_ICON_CLASS} />}
                </button>
                <div className="w-px h-5 bg-gray-600 mx-1"></div>
                {durations.map(({ duration, label }) => (
                    <button
                        key={duration}
                        onClick={() => {
                            setSelectedInsertion(prev => ({ ...prev, duration }));
                            // If current selection is a just-inserted note, don't
                            // retroactively change its duration — just deselect and update insertion state.
                            if (justInsertedNoteRef.current && selectedNoteIds.size === 1 && selectedNoteIds.has(justInsertedNoteRef.current)) {
                                justInsertedNoteRef.current = null;
                                setSelectedNoteIds(new Set());
                                return;
                            }
                            if (selectedNoteIds.size > 0) {
                                applyEditToSelectedNotes(n => {
                                    const updated = { ...(n as any), duration } as StaffNote;
                                    return { ...(updated as any), durationTicks: computeDurationTicks(updated) } as StaffNote;
                                }, { rebuildTimeline: true });
                            }
                        }}
                        className={`p-1 rounded-md transition-colors ${selectedInsertion.duration === duration ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                        title={label}
                    >
                        <IconComponent type={selectedInsertion.type} duration={duration} className={TOOLBAR_ICON_CLASS} />
                    </button>
                ))}
                <div className="w-px h-5 bg-gray-600 mx-1"></div>
                <button
                    onClick={() => {
                        const next = !selectedInsertion.isDotted;
                        setDottedFromSource(!!next, 'toolbar');
                    }}
                    className={`p-1 rounded-md transition-colors ${selectedInsertion.isDotted ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('insert_dotted')}
                >
                    <DotIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={() => {
                        setIsTriplet(t => {
                            const newTripletState = !t;
                            if (newTripletState) {
                                setIsDuplet(false);
                                setTupletNoteCount(0);
                                setTripletBaseDuration(selectedInsertion.duration);
                            } else {
                                setTupletNoteCount(0);
                                setTripletBaseDuration(null);
                            }
                            return newTripletState;
                        });
                    }}
                    className={`p-1 rounded-md transition-colors ${isTriplet ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('insert_triplet')}
                >
                    <TripletIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={() => {
                        if (!canUseDuplet) return;
                        setIsDuplet(d => {
                            const next = !d;
                            if (next) {
                                setIsTriplet(false);
                                setTupletNoteCount(0);
                                setTripletBaseDuration(null);
                            }
                            return next;
                        });
                    }}
                    disabled={!canUseDuplet}
                    className={`p-1 rounded-md transition-colors ${isDuplet ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={canUseDuplet ? tT('insert_duplet_available') : tT('insert_duplet_disabled')}
                >
                    <span className="text-sm font-bold leading-none">2</span>
                </button>
                <button
                    onClick={() => setIsSwing(s => !s)}
                    className={`p-1 rounded-md transition-colors ${isSwing ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('insert_swing')}
                >
                    <span className="text-[10px] font-bold leading-none">Sw</span>
                </button>
                <button
                    onClick={toggleDoubleBarlineAtPlayhead}
                    disabled={!playheadPosition}
                    className="p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={playheadPosition ? tT('insert_double_barline_active') : tT('insert_set_playhead_first')}
                >
                    <span className="text-sm font-bold leading-none">||</span>
                </button>
                <button
                    onClick={insertMeasureAtPlayhead}
                    disabled={!playheadPosition}
                    className="p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={playheadPosition ? tT('insert_measure_at_playhead') : tT('insert_set_playhead_first')}
                >
                    <span className="text-sm font-bold leading-none">+|</span>
                </button>
            </div>
        ),
        accidentals: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={() => {
                        const cur = activeAccidentalRef.current;
                        const next = (cur === 'sharp' ? 'double-sharp' : (cur === 'double-sharp' ? null : 'sharp')) as AccidentalType | null;
                        setActiveAccidentalAndApplyFromSource(next, 'toolbar');
                    }}
                    className={`p-1 rounded-md transition-colors ${activeAccidental === 'sharp' || activeAccidental === 'double-sharp' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('accidental_sharp')}
                >
                    <SharpIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={() => {
                        const cur = activeAccidentalRef.current;
                        const next = (cur === 'double-sharp' ? 'sharp' : (cur === 'sharp' ? null : 'double-sharp')) as AccidentalType | null;
                        setActiveAccidentalAndApplyFromSource(next, 'toolbar');
                    }}
                    className={`p-1 rounded-md transition-colors ${activeAccidental === 'double-sharp' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('accidental_double_sharp')}
                >
                    <DoubleSharpIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={() => {
                        const cur = activeAccidentalRef.current;
                        const next = (cur === 'flat' ? 'double-flat' : (cur === 'double-flat' ? null : 'flat')) as AccidentalType | null;
                        setActiveAccidentalAndApplyFromSource(next, 'toolbar');
                    }}
                    className={`p-1 rounded-md transition-colors ${activeAccidental === 'flat' || activeAccidental === 'double-flat' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('accidental_flat')}
                >
                    <FlatIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={() => {
                        const cur = activeAccidentalRef.current;
                        const next = (cur === 'double-flat' ? 'flat' : (cur === 'flat' ? null : 'double-flat')) as AccidentalType | null;
                        setActiveAccidentalAndApplyFromSource(next, 'toolbar');
                    }}
                    className={`p-1 rounded-md transition-colors ${activeAccidental === 'double-flat' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('accidental_double_flat')}
                >
                    <DoubleFlatIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={() => {
                        const cur = activeAccidentalRef.current;
                        const next = (cur === 'natural' ? null : 'natural') as AccidentalType | null;
                        setActiveAccidentalAndApplyFromSource(next, 'toolbar');
                    }}
                    className={`p-1 rounded-md transition-colors ${activeAccidental === 'natural' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={tT('accidental_natural')}
                >
                    <NaturalIcon className={TOOLBAR_ICON_CLASS} />
                </button>
            </div>
        ),
        chordInsert: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={onToggleChordInsertMode}
                    className={`px-2 py-1 rounded-md transition-colors text-sm font-mono ${chordInsertMode ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={chordInsertMode ? 'Esci inserimento accordo (Esc)' : 'Inserisci accordo dalla sigla — es. Cmaj7, Dm7/F'}
                >
                    A&#9833;
                </button>
                <button
                    onClick={onRevoiceChord}
                    disabled={!hasSelectedNotes}
                    className="px-2 py-1 rounded-md transition-colors text-sm font-mono text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={`Re-voice: ricalcola il voicing delle note selezionate (ciclo disposizioni)`}
                >
                    {selectedNotesHave7th
                        ? ['auto','S:7','S:3','S:5','S:R'][revoiceDispIdx % 5]
                        : ['auto','S:R','S:3','S:5'][revoiceDispIdx % 4]}
                </button>
            </div>
        ),
        incompleteMeasures: (
            <div className="flex items-center gap-1.5 flex-nowrap whitespace-nowrap">
                {/* Due significati distinti, e vanno tenuti separati:
                    · PREMUTO o no = i riquadri rossi sulle misure si vedono. Spegnerli è
                      legittimo: sono d'intralcio mentre si scrive, e una misura a metà è
                      normale finché la si sta riempiendo.
                    · ROSSO = nel brano CI SONO misure incomplete, e questo non dipende dai
                      riquadri: l'analisi di quei punti resta parziale, e qualcosa deve
                      ricordarlo anche a disegno spento. */}
                <button
                    type="button"
                    onClick={() => setShowIncompleteMeasureWarnings?.((v: boolean) => !v)}
                    aria-pressed={showIncompleteMeasureWarnings}
                    aria-label={misureIncompleteTotali > 0
                        ? `${misureIncompleteTotali} misure incomplete — ${showIncompleteMeasureWarnings ? 'nascondi' : 'mostra'} i riquadri`
                        : 'Nessuna misura incompleta'}
                    title={misureIncompleteTotali > 0
                        ? `${misureIncompleteTotali} ${misureIncompleteTotali === 1 ? 'misura incompleta' : 'misure incomplete'}: l'analisi di quei punti è parziale.\n${showIncompleteMeasureWarnings ? 'Clicca per nascondere i riquadri rossi (l\'avviso resta).' : 'Clicca per rivedere i riquadri rossi.'}`
                        : 'Nessuna misura incompleta'}
                    className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md transition-colors ${
                        misureIncompleteTotali > 0
                            ? (showIncompleteMeasureWarnings ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-red-600/40 text-red-50 hover:bg-red-600/60 ring-1 ring-red-500')
                            : 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                    }`}
                >
                    ⚠{misureIncompleteTotali > 0 ? <span className="tabular-nums">{misureIncompleteTotali}</span> : null}
                </button>
            </div>
        ),
        notations: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={handleToggleBeamGroup}
                    disabled={selectedNotesBeamState === 'unbeamable'}
                    className="p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={selectedNotesBeamState === 'beamed' ? tT('notations_unbeam') : selectedNotesBeamState === 'unbeamable' ? tT('notations_beam_select_min') : tT('notations_beam')}
                >
                    {selectedNotesBeamState === 'beamed' ? <UngroupIcon /> : <GroupIcon />}
                </button>
                <button
                    onClick={handleToggleTie}
                    disabled={selectedNoteIds.size === 0}
                    className="p-1 rounded-md text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600 transition-colors"
                    title={tT('notations_tie')}
                >
                    <TieIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={handleFlipStem}
                    disabled={!selectedTiePair && selectedNoteIds.size === 0}
                    className="p-1 rounded-md text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600 transition-colors"
                    title={tT('notations_flip_stem')}
                >
                    <FlipStemIcon className={TOOLBAR_ICON_CLASS} />
                </button>
            </div>
        ),
        analysis: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={() => setActiveTab(prev => prev === 'analysis' ? 'editor' : 'analysis')}
                    className="px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all bg-cyan-600 text-white hover:bg-cyan-500"
                    title={activeTab === 'analysis' ? t('toolbar_back_to_editor_tooltip') : t('toolbar_open_analysis_tooltip')}
                >
                    {activeTab === 'analysis' ? t('toolbar_open_editor') : t('toolbar_open_analysis')}
                </button>
                <button
                    onClick={() => setIsAnalysisEnabled(prev => !prev)}
                    className={`ml-1 flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md transition-all ${isAnalysisEnabled ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                    title={isAnalysisEnabled ? t('toolbar_disable_analysis') : t('toolbar_enable_analysis')}
                >
                    <span>{isAnalysisEnabled ? t('toolbar_analysis_on') : t('toolbar_analysis_off')}</span>
                </button>
                {/* LA BARRA NON SI MUOVE. Spegnendo l'analisi questi comandi sparivano, e
                    tutto quello che stava a destra scivolava: chi cerca un pulsante lo
                    trova dove l'ha lasciato solo se la barra sta ferma. Ora restano al
                    loro posto, spenti — si vede che ci sono e che ora non servono, invece
                    di far spostare tutto il resto.
                    `pointer-events-none` e non `disabled` sui singoli: sono una dozzina di
                    comandi, e uno solo dimenticato resterebbe cliccabile a analisi spenta. */}
                <div
                    className={`flex items-center gap-1 ml-2 text-xs transition-opacity ${isAnalysisEnabled ? '' : 'opacity-40 pointer-events-none'}`}
                    aria-hidden={!isAnalysisEnabled}
                >
                        <div className="flex items-center p-0.5 bg-gray-900/50 rounded-md">
                            <button
                                onClick={() => setAnalysisSubject('satb')}
                                aria-label="Analizza il coro (SATB)"
                                className={`px-2 rounded-sm py-0.5 font-semibold transition-all ${analysisSubject === 'satb' ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                                title="Analizza il coro SATB"
                            >SATB</button>
                            <button
                                onClick={() => setAnalysisSubject('acc')}
                                aria-label="Analizza la traccia d'accompagnamento"
                                className={`px-2 rounded-sm py-0.5 font-semibold transition-all ${analysisSubject === 'acc' ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                                title="Analizza una traccia di accompagnamento (piano/chitarra)"
                            >ACC</button>
                        </div>
                        {analysisSubject === 'acc' && accTracksForAnalysis.length > 0 && (
                            <select
                                value={analysisAccTrackId ?? ''}
                                onChange={(e) => setAnalysisAccTrackId(e.target.value || null)}
                                className="bg-gray-700 text-gray-100 rounded-sm px-1 py-0.5 text-xs border border-gray-600 max-w-[10rem]"
                                title="Traccia da analizzare"
                            >
                                {accTracksForAnalysis.map(tk => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
                            </select>
                        )}
                </div>
                {/* Stesso principio per gli interruttori dell'analisi mostrata. */}
                <div
                    className={`flex items-center gap-1 p-0.5 bg-gray-900/50 rounded-md text-xs ml-2 transition-opacity ${isAnalysisEnabled ? '' : 'opacity-40 pointer-events-none'}`}
                    aria-hidden={!isAnalysisEnabled}
                >
                        <button
                            aria-label="Mostra i settimi di dominante"
                            onClick={() => setShowRomanAnalysis(prev => !prev)}
                            className={`w-10 rounded-sm py-0.5 font-bold transition-all ${showRomanAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showRomanAnalysis ? t('toolbar_hide_roman') : t('toolbar_show_roman')}
                        >
                            V7
                        </button>
                        {/* CIFRATURA. Accanto a V7 e G7 perché sono la stessa famiglia di
                            scelte: che cosa si vede dell'analisi. Chi legge le sigle o
                            ascolta la partitura con lo screen reader può spegnerla, e la
                            pagina — e i file esportati — si alleggeriscono. */}
                        <button
                            onClick={() => setShowFiguredBass?.(prev => !prev)}
                            className={`w-10 rounded-sm py-0.5 font-bold transition-all ${showFiguredBass ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showFiguredBass ? 'Nascondi la cifratura del basso' : 'Mostra la cifratura del basso'}
                        >
                            6<span style={{ fontSize: '0.85em' }}>4</span>
                        </button>
                        <button
                            onClick={() => setShowSymbolAnalysis(prev => !prev)}
                            className={`w-10 rounded-sm py-0.5 font-bold transition-all ${showSymbolAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showSymbolAnalysis ? t('toolbar_hide_symbols') : t('toolbar_show_symbols')}
                        >
                            G7
                        </button>
                </div>
            </div>
        ),
        // MIDI: uscita esterna, tastiera in ingresso e formato di esportazione. Stava dentro
        // il menù della partitura, dove era un intruso — lì si parla di righi, parti, vista e
        // formato della pagina, non di collegamenti con altri programmi.
        midi: (
            <div ref={midiGroupRef} className="relative flex items-center">
                <button
                    onClick={() => setIsMidiGroupOpen(o => !o)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${isMidiGroupOpen || !!selectedMidiOutput || midiStepInputEnabled ? 'bg-slate-200 text-gray-900' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}
                    title={tT('midi_group_tooltip', { defaultValue: 'MIDI: uscita verso strumenti esterni, tastiera per l\u2019inserimento, formato di esportazione' })}
                >
                    {tT('midi_label')} ⌄
                </button>
                {isMidiGroupOpen && (
                    <div className="absolute right-0 top-full mt-2 min-w-64 rounded-md bg-slate-800 border border-slate-700 shadow-lg p-1 z-50">
                    <button
                        onClick={async () => {
                            const enabled = isMidiMenuOpen || !!selectedMidiOutput;
                            if (enabled) {
                                setSelectedMidiOutput(null);
                                setIsMidiMenuOpen(false);
                                return;
                            }
                            if (midiOutputs.length === 0) {
                                try { await handleActivateMidi(); } catch (_) {}
                            }
                            setIsMidiMenuOpen(true);
                        }}
                        className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                        title={tT('midi_label')}
                    >
                        <span>{tT('midi_label')}</span>
                        {(isMidiMenuOpen || !!selectedMidiOutput) && <span className="text-[11px]">✓</span>}
                    </button>
                    {isMidiMenuOpen && (
                        <div className="mt-1 rounded-md bg-slate-900/40 border border-slate-700">
                            <div className="px-2 py-1 text-[11px] text-slate-300">{tT('midi_select_output')}</div>
                            <button
                                onClick={() => {
                                    setSelectedMidiOutput(null);
                                    setIsMidiMenuOpen(false);
                                }}
                                className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${selectedMidiOutput ? 'text-gray-200 hover:bg-slate-700' : 'bg-cyan-600 text-white'}`}
                            >
                                <span>{tT('midi_internal_audio')}</span>
                                {!selectedMidiOutput && <span className="text-[11px]">✓</span>}
                            </button>
                            {midiOutputs.length === 0 ? (
                                <div className="px-2 py-1 text-[11px] text-gray-400">{tT('midi_no_devices')}</div>
                            ) : (
                                midiOutputs.map(output => {
                                    const isSelected = selectedMidiOutput?.id === output.id;
                                    return (
                                        <button
                                            key={output.id}
                                            onClick={() => {
                                                setSelectedMidiOutput(output);
                                                setIsMidiMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${isSelected ? 'bg-cyan-600 text-white' : 'text-gray-200 hover:bg-slate-700'}`}
                                            title={output.name}
                                        >
                                            <span className="truncate">{output.name}</span>
                                            {isSelected && <span className="text-[11px]">✓</span>}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    )}
                    {/* MIDI Step Input toggle */}
                    <div className="my-2 h-px bg-slate-700" />
                    <button
                        onClick={onToggleMidiStepInput}
                        className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${midiStepInputEnabled ? 'bg-emerald-600 text-white' : 'text-gray-200 hover:bg-slate-700'}`}
                        title={midiStepInputEnabled && midiStepInputDeviceName ? tT('midi_step_input_with_device', { device: midiStepInputDeviceName }) : tT('midi_step_input')}
                    >
                        <span>🎹 {tT('midi_step_input_short')}</span>
                        {midiStepInputEnabled && <span className="text-[11px]">✓</span>}
                    </button>
                    {midiStepInputEnabled && midiStepInputDeviceName && (
                        <div className="px-2 py-0.5 text-[10px] text-emerald-300 truncate">
                            {midiStepInputDeviceName}
                        </div>
                    )}
                        {/* Formato di esportazione: la stessa impostazione delle preferenze,
                            qui perché è dove si decide come esce il file per gli altri programmi. */}
                        <div className="my-2 h-px bg-slate-700" />
                        <div className="px-2 pb-1 text-[11px] text-slate-300">{tT('midi_export_format', { defaultValue: 'Formato di esportazione' })}</div>
                        {(['1', '0'] as const).map(v => (
                            <button
                                key={v}
                                onClick={() => setMidiExportType(v)}
                                className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                title={v === '1'
                                    ? tT('midi_type1_tooltip', { defaultValue: 'Una traccia per voce: lo leggono MuseScore, Finale, Sibelius' })
                                    : tT('midi_type0_tooltip', { defaultValue: 'Tutte le voci in una traccia sola: massima compatibilità' })}
                            >
                                <span>{v === '1'
                                    ? tT('midi_type1', { defaultValue: 'Type 1 — multi-traccia' })
                                    : tT('midi_type0', { defaultValue: 'Type 0 — traccia singola' })}</span>
                                <span className="text-[11px]">{midiExportType === v ? '●' : '○'}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        ),
        more: (
            <div ref={moreMenuRef} className="relative flex items-center">
                <button
                    onClick={() => setIsMoreMenuOpen(o => !o)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${isMoreMenuOpen ? 'bg-slate-200 text-gray-900' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}
                    title={tT('more_menu_tooltip', { defaultValue: 'Partitura: tipo di righi, numero di parti, vista, spaziatura, formato della pagina — scorciatoia: P' })}
                >
                    {tT('more_menu_label', { defaultValue: 'Partitura' })} ⌄
                </button>
                {isMoreMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 min-w-64 rounded-md bg-slate-800 border border-slate-700 shadow-lg p-1 z-50">
                        <button
                            onClick={() => setStaffSystemMode('grandstaff')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title={tT('more_grand_staff_tooltip')}
                        >
                            <span>{tT('more_grand_staff_label')}</span>
                            {staffSystemMode === 'grandstaff' && <span className="text-[11px]">✓</span>}
                        </button>
                        <button
                            onClick={() => setStaffSystemMode('treble_only')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title={tT('more_treble_only_tooltip')}
                        >
                            <span>{tT('more_treble_only_label')}</span>
                            {staffSystemMode === 'treble_only' && <span className="text-[11px]">✓</span>}
                        </button>
                        <button
                            onClick={() => {
                                const isSatb = staffSystemMode === 'satb_ancient';
                                if (isSatb) setStaffSystemMode(lastNonSatbModeRef.current);
                                else setStaffSystemMode('satb_ancient');
                            }}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title={tT('more_satb_ancient_tooltip')}
                        >
                            <span>{tT('more_satb_ancient_label')}</span>
                            {staffSystemMode === 'satb_ancient' && <span className="text-[11px]">✓</span>}
                        </button>
                        <button
                            onClick={() => setStaffLayoutMode(prev => prev === 'parti_late' ? 'parti_strette' : 'parti_late')}
                            disabled={staffSystemMode === 'satb_ancient'}
                            className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${staffSystemMode === 'satb_ancient' ? 'text-gray-500 cursor-not-allowed' : 'text-gray-200 hover:bg-slate-700'}`}
                            title={staffSystemMode === 'satb_ancient' ? tT('more_close_voicing_disabled_tooltip') : tT('more_close_voicing_tooltip')}
                        >
                            <span>{tT('more_close_voicing_label')}</span>
                            {staffLayoutMode === 'parti_strette' && staffSystemMode !== 'satb_ancient' && <span className="text-[11px]">✓</span>}
                        </button>
                        {setPartCount && (
                            <>
                                <div className="my-2 h-px bg-slate-700" />
                                <div className="px-2 pb-1 text-[11px] text-slate-300">{tT('more_parts_label')}</div>
                                {([4, 3, 2] as PartCount[]).map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setPartCount(n)}
                                        className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                        title={tT('more_parts_tooltip')}
                                    >
                                        <span>{tT(`more_parts_${n}`)}</span>
                                        <span className="text-[11px]">{partCount === n ? '●' : '○'}</span>
                                    </button>
                                ))}
                            </>
                        )}
                        {setViewMode && (
                            <>
                                <div className="my-2 h-px bg-slate-700" />
                                <div className="px-2 pb-1 text-[11px] text-slate-300">{tT('more_view_label')}</div>
                                <button
                                    onClick={() => setViewMode('page')}
                                    className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                    title={tT('more_view_paged_tooltip')}
                                >
                                    <span>{tT('more_view_paged')}</span>
                                    <span className="text-[11px]">{viewMode !== 'linear' ? '●' : '○'}</span>
                                </button>
                                {setContentAwareSpacing && (
                                    <button
                                        onClick={() => setContentAwareSpacing(!contentAwareSpacing)}
                                        className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                        title={tT('more_spacing_content_tooltip')}
                                    >
                                        <span>{tT('more_spacing_content')}</span>
                                        <span className="text-[11px]">{contentAwareSpacing ? '✓' : ''}</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => setViewMode('linear')}
                                    className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                    title={tT('more_view_ribbon_tooltip')}
                                >
                                    <span>{tT('more_view_ribbon')}</span>
                                    <span className="text-[11px]">{viewMode === 'linear' ? '●' : '○'}</span>
                                </button>
                            </>
                        )}
                        <div className="my-2 h-px bg-slate-700" />
                        <div className="px-2 pb-1 text-[11px] text-slate-300">{tT('more_format_label')}</div>
                        <button
                            onClick={() => setCanvasFormat('page')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title={tT('more_format_page')}
                        >
                            <span>{tT('more_format_page')}</span>
                            <span className="text-[11px]">{canvasFormat === 'page' ? '●' : '○'}</span>
                        </button>
                        <button
                            onClick={() => setCanvasFormat('landscape')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title={tT('more_format_landscape')}
                        >
                            <span>{tT('more_format_landscape')}</span>
                            <span className="text-[11px]">{canvasFormat === 'landscape' ? '●' : '○'}</span>
                        </button>
                        {onToggleShowPageBreaks && (
                            <button
                                onClick={onToggleShowPageBreaks}
                                className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                title={tT('more_format_show_page_breaks')}
                            >
                                <span>{tT('more_format_show_page_breaks')}</span>
                                <span className="text-[11px]">{showPageBreaks ? '☑' : '☐'}</span>
                            </button>
                        )}
                        {onRestartAudio && (
                            <>
                                <div className="px-2 pt-2 pb-1 text-[11px] text-slate-300">Audio</div>
                                <button
                                    onClick={() => { onRestartAudio(); setIsMoreMenuOpen(false); }}
                                    className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                    title="Se il suono non esce più — cuffie staccate, uscita cambiata, sistema audio non pronto all'avvio — questo rifà il motore senza chiudere il programma. Il lavoro non si tocca."
                                >
                                    <span>Riavvia il motore audio</span>
                                    <span className="text-[11px]">↻</span>
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        ),
    };

    // ANCHE IN PERSONALIZZAZIONE LA BARRA MOSTRA IL RISULTATO.
    //
    // Prima i gruppi spenti restavano lì sbiaditi, perché temevo che sparendo non si
    // sapesse più dove rimetterli. Era una preoccupazione infondata: rimetterli si fa
    // dal PANNELLO, che li elenca tutti con la loro casella — la barra non serve a
    // quello. E tenerli visibili aveva due costi reali, segnalati usandola: non si
    // capiva come sarebbe cambiato lo spazio, e c'erano il doppio degli elementi da
    // scansare mentre si trascina.
    const visibleGroupIds = toolbarGroupOrder.filter(id => !hiddenToolbarGroups.includes(id));
    const [draggingToolbarGroupId, setDraggingToolbarGroupId] = useState<ToolbarGroupId | null>(null);
    /** Dove finirebbe mollando adesso. Serve a MOSTRARE la destinazione invece di
     *  applicarla: riordinare a ogni movimento del mouse faceva saltare i gruppi da una
     *  riga all'altra, perché ogni riordino sposta gli elementi sotto il puntatore e
     *  quello scatena il riordino successivo — un'oscillazione, non un trascinamento. */
    const [destinazioneToolbar, setDestinazioneToolbar] = useState<ToolbarGroupId | 'fine' | null>(null);
    const rigaGruppiRef = useRef<HTMLDivElement | null>(null);

    /**
     * DOVE FINIREBBE MOLLANDO ADESSO, calcolato sull'intera riga e non sui singoli
     * gruppi.
     *
     * Prima l'ascolto stava su ogni gruppo: nei VUOTI fra l'uno e l'altro — e sulle
     * stanghette che li separano — non c'era nessun bersaglio, quindi la linea spariva
     * e il rilascio non faceva niente. Ed erano proprio i vuoti il posto in cui viene
     * naturale mollare, perché è lì che si vuole infilare il gruppo.
     *
     * Si guarda la riga in cui cade il puntatore e, dentro quella, il gruppo di cui si
     * è superata la metà: così esiste una destinazione per ogni punto della barra,
     * compreso lo spazio dopo l'ultimo gruppo.
     */
    const destinazioneDaPuntatore = useCallback((clientX: number, clientY: number): ToolbarGroupId | 'fine' | null => {
        const riga = rigaGruppiRef.current;
        if (!riga) return null;
        const celle = Array.from(riga.querySelectorAll('[data-gruppo-id]')) as HTMLElement[];
        if (celle.length === 0) return null;

        // Solo i gruppi della RIGA in cui si trova il puntatore: la barra va a capo, e
        // il gruppo più vicino in orizzontale può stare su un'altra riga.
        const stessaRiga = celle.filter(c => {
            const r = c.getBoundingClientRect();
            return clientY >= r.top - 4 && clientY <= r.bottom + 4;
        });
        const candidati = stessaRiga.length ? stessaRiga : celle;

        for (const c of candidati) {
            const r = c.getBoundingClientRect();
            if (clientX < r.left + r.width / 2) return (c.dataset.gruppoId as ToolbarGroupId);
        }
        // Oltre la metà dell'ultimo gruppo della riga: si infila dopo di lui.
        const ultimo = candidati[candidati.length - 1];
        const dopo = celle.indexOf(ultimo) + 1;
        return dopo < celle.length ? (celle[dopo].dataset.gruppoId as ToolbarGroupId) : 'fine';
    }, []);

    const forceToolbarVisible = isToolbarCustomizeOpen || isMoreMenuOpen;
    const isToolbarVisible = forceToolbarVisible || !isToolbarHidden;

    // La striscia dei comandi a toolbar nascosta si SPOSTA: la si mette dove non dà
    // fastidio e ci resta, anche dopo aver chiuso l'applicazione. Prima era inchiodata
    // in cima e spingeva la partitura più in basso — cioè si rubava lo spazio che
    // nascondere la toolbar serviva a guadagnare.
    const barraComandi = useFloatingPanel({ x: 12, y: 8 }, 'harmony-tutor.barraComandiPos.v1');
    const pannelloPersonalizza = useFloatingPanel({ x: 24, y: 120 }, 'harmony-tutor.personalizzaPos.v1');

    const toolbarHoverRef = useRef<HTMLDivElement | null>(null);
    const [toolbarHoverTip, setToolbarHoverTip] = useState<{ x: number; y: number; text: string } | null>(null);
    const handleToolbarMouseMove = useCallback((e: React.MouseEvent) => {
        try {
            const root = toolbarHoverRef.current;
            if (!root) return;

            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (!el || !root.contains(el)) {
                if (toolbarHoverTip) setToolbarHoverTip(null);
                return;
            }

            const target = (el.closest('button,[role="button"],a,span') as HTMLElement | null) || el;
            const title = (target?.getAttribute('title') || '').trim();
            if (!title) {
                if (toolbarHoverTip) setToolbarHoverTip(null);
                return;
            }

            const x = e.clientX + 12;
            const y = e.clientY + 12;

            if (!toolbarHoverTip || toolbarHoverTip.text !== title || Math.abs(toolbarHoverTip.x - x) > 2 || Math.abs(toolbarHoverTip.y - y) > 2) {
                setToolbarHoverTip({ x, y, text: title });
            }
        } catch {
            // ignore
        }
    }, [toolbarHoverTip]);

    return (
        <>
            {/* PERSONALIZZAZIONE DELLA BARRA — accendere e spegnere, oltre a riordinare.
                I gruppi si trascinavano già; quello che mancava era poterli TOGLIERE, ed
                è la richiesta di chi trova la barra troppo piena. L'elenco segue l'ordine
                della barra, così una casella e il suo gruppo si corrispondono a vista. */}
            {isToolbarCustomizeOpen && (
                <div
                    style={{ position: 'fixed', left: pannelloPersonalizza.pos.x, top: pannelloPersonalizza.pos.y, zIndex: 1100, width: 320 }}
                    className="bg-slate-800 rounded-lg shadow-2xl border border-slate-700 select-none"
                >
                    <div
                        onMouseDown={pannelloPersonalizza.prendi}
                        className="flex items-center justify-between px-2 py-1 bg-slate-900 rounded-t-lg cursor-move"
                    >
                        <span className="text-[11px] font-bold text-gray-300 tracking-wide">
                            {tT('customize_title', { defaultValue: 'Personalizza la barra' })}
                        </span>
                        <button
                            onClick={onCloseToolbarCustomize}
                            title={tT('customize_close', { defaultValue: 'Chiudi' })}
                            className="w-5 h-5 text-gray-500 hover:text-gray-200 flex items-center justify-center text-xs rounded"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="px-2 py-1 text-[11px] text-slate-400 border-b border-slate-700">
                        {tT('customize_hint', { defaultValue: 'Togli il segno di spunta per nascondere un gruppo. I gruppi si trascinano dalla maniglia ⋮⋮ per riordinarli.' })}
                    </div>

                    <div className="max-h-[52vh] overflow-y-auto py-1">
                        {toolbarGroupOrder.map(id => {
                            const acceso = !hiddenToolbarGroups.includes(id);
                            return (
                                <label
                                    key={id}
                                    className="flex items-center gap-2 px-2 py-1 text-[12px] text-slate-200 hover:bg-slate-700/50 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={acceso}
                                        onChange={() => onToggleToolbarGroup(id)}
                                        className="accent-blue-500"
                                    />
                                    <span className={acceso ? '' : 'text-slate-500 line-through'}>{nomeGruppo(id)}</span>
                                </label>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between px-2 py-1 border-t border-slate-700">
                        <button
                            onClick={onResetToolbarGroups}
                            className="text-[11px] px-2 py-1 rounded text-slate-300 hover:bg-slate-700"
                        >
                            {tT('customize_reset', { defaultValue: 'Ripristina' })}
                        </button>
                        <button
                            onClick={onCloseToolbarCustomize}
                            className="text-[11px] px-3 py-1 rounded bg-blue-600 text-white font-semibold hover:bg-blue-500"
                        >
                            {tT('customize_done', { defaultValue: 'Fatto' })}
                        </button>
                    </div>
                </div>
            )}

            {isToolbarVisible && (
                <div
                    ref={toolbarHoverRef}
                    onMouseMove={handleToolbarMouseMove}
                    onMouseLeave={() => setToolbarHoverTip(null)}
                    className="sticky top-0 z-50 px-2 py-1 bg-slate-800 border-b border-slate-700 rounded-lg"
                >
                    {/* La fila va a capo quando serve — su un 14 pollici ne servono tre,
                        ed è giusto così: meglio tre file che pulsanti nascosti. Quello che
                        conta è che l'ORDINE non cambi mai (è quello scelto dall'utente e
                        salvato), così mettendo in fondo i gruppi che si usano meno gli
                        altri si ritrovano sempre nello stesso posto relativo.
                        Ogni gruppo resta INTERO: o ci sta sulla riga, o passa tutto alla
                        successiva — vedi `flex-nowrap` sui gruppi che potrebbero spezzarsi
                        (la tonalità lo faceva: l'etichetta di qua e il menù di là). */}
                    <div
                        ref={rigaGruppiRef}
                        className="flex flex-row items-center flex-wrap gap-x-2 gap-y-1"
                        onDragOver={(e) => {
                            if (!isToolbarCustomizeOpen || !draggingToolbarGroupId) return;
                            e.preventDefault();
                            const d = destinazioneDaPuntatore(e.clientX, e.clientY);
                            if (d !== destinazioneToolbar) setDestinazioneToolbar(d);
                        }}
                        onDrop={(e) => {
                            if (!isToolbarCustomizeOpen || !draggingToolbarGroupId) return;
                            e.preventDefault();
                            const d = destinazioneToolbar ?? destinazioneDaPuntatore(e.clientX, e.clientY);
                            if (d === 'fine') {
                                const ultimo = visibleGroupIds[visibleGroupIds.length - 1];
                                if (ultimo && ultimo !== draggingToolbarGroupId) reorderToolbarGroups(draggingToolbarGroupId, ultimo);
                            } else if (d && d !== draggingToolbarGroupId) {
                                reorderToolbarGroups(draggingToolbarGroupId, d);
                            }
                            setDraggingToolbarGroupId(null);
                            setDestinazioneToolbar(null);
                        }}
                    >
                        {visibleGroupIds.map((id, idx) => (
                            <React.Fragment key={id}>
                                <div
                                    className={`relative ${draggingToolbarGroupId === id ? 'opacity-40' : ''} ${
                                        destinazioneToolbar === id && draggingToolbarGroupId && draggingToolbarGroupId !== id
                                            ? 'before:content-[""] before:absolute before:-left-1 before:top-0 before:bottom-0 before:w-0.5 before:bg-sky-400 before:rounded'
                                            : ''
                                    }`}
                                    data-gruppo-id={id}
                                >
                                    {isToolbarCustomizeOpen && (
                                        <span
                                            draggable
                                            onDragStart={(e) => {
                                                setDraggingToolbarGroupId(id);
                                                try {
                                                    e.dataTransfer.effectAllowed = 'move';
                                                    e.dataTransfer.setData('text/plain', id);
                                                } catch (_) {}
                                            }}
                                            onDragEnd={() => { setDraggingToolbarGroupId(null); setDestinazioneToolbar(null); }}
                                            /* Prima era un ⋮⋮ di pochi pixel, mezzo fuori
                                               dal gruppo: prenderlo era il passaggio più
                                               difficile di tutta l'operazione. Ora è una
                                               barretta alta quanto il gruppo, con un fondo
                                               che si vede. */
                                            className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center h-7 w-4 rounded bg-slate-600/90 hover:bg-sky-600 select-none cursor-grab text-gray-100 text-[10px] leading-none shadow"
                                            title={tT('more_drag_to_reorder')}
                                        >
                                            ⋮⋮
                                        </span>
                                    )}
                                    {toolbarGroups[id]}
                                </div>
                                {idx < visibleGroupIds.length - 1 && <div className="h-5 w-px bg-slate-600/50"></div>}
                            </React.Fragment>
                        ))}
                        {/* La destinazione «in fondo»: senza, l'ultima posizione della barra
                            era l'unica irraggiungibile. */}
                        {destinazioneToolbar === 'fine' && draggingToolbarGroupId && (
                            <div className="w-0.5 self-stretch bg-sky-400 rounded" />
                        )}
                    </div>

                    {/* ── RIGA CONTESTUALE ─────────────────────────────────────────
                        Questi comandi compaiono e spariscono da soli: i pattern quando
                        si lavora su una traccia, le trasformazioni quando c'è una
                        selezione. Finché stavano DENTRO la fila principale, apparendo
                        spingevano tutti gli altri pulsanti e mandavano la barra a capo:
                        tonalità, tempo e metro cambiavano posto sotto le dita.

                        Su una riga LORO la fila principale non si muove mai. E sta FUORI
                        dal ciclo dei gruppi — dentro si ripeteva per ognuno. */}
                    {(activeStaffArea === 'accompaniment' || hasSelectedNotes) && (
                        <div className="flex flex-row items-center flex-wrap gap-x-2 gap-y-1 mt-1 pt-1 border-t border-slate-700/60">
                        {activeStaffArea === 'accompaniment' && (
                            <>
                                <div className="w-px h-5 bg-slate-600 mx-0.5" />
                                {([
                                    { id: 'block',         label: 'Bl',   title: 'Block Chords' },
                                    { id: 'arpeggio_up',   label: 'Ar▲',  title: 'Arpeggio Up' },
                                    { id: 'arpeggio_down', label: 'Ar▼',  title: 'Arpeggio Down' },
                                    { id: 'broken',        label: 'Brk',  title: 'Broken (boom-chick)' },
                                    { id: 'albertino',     label: 'Alb',  title: 'Basso Albertino (0-2-1-2)' },
                                    { id: 'ondulato',      label: 'Ond',  title: 'Ondulato (su e giù)' },
                                ] as const).map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => onSetAccPattern(p.id)}
                                        title={p.title}
                                        className={`px-1.5 py-1 rounded-md transition-colors text-xs font-mono ${accPattern === p.id ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                                <button
                                    onClick={onToggleAccLetRing}
                                    title="Ped — le note risuonano fino al prossimo attacco (pedale/let ring). Vale anche per le note inserite a mano."
                                    className={`px-1.5 py-1 rounded-md transition-colors text-xs font-mono ${accLetRing ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                                >
                                    Ped
                                </button>
                            </>
                        )}
                        {/* Trasformazioni melodiche sulla selezione (motivo): inserite DOPO l'originale */}
                        {hasSelectedNotes && (
                            <>
                                <div className="w-px h-5 bg-slate-600 mx-0.5" />
                                <button
                                    onClick={onToggleTransformMode}
                                    title={transformMode === 'tonal'
                                        ? 'Trasformazioni TONALI (in chiave, per gradi). Clicca per passare a Reali (cromatiche).'
                                        : 'Trasformazioni REALI (cromatiche, per semitoni). ⚠ Inversione e retro-inverso reali sono cromatici (escono dalla tonalità). Clicca per tornare a Tonali.'}
                                    className={`px-1.5 py-1 rounded-md transition-colors text-xs font-mono ${transformMode === 'tonal' ? 'bg-cyan-600 text-white' : 'bg-amber-600 text-white'}`}
                                >
                                    {transformMode === 'tonal' ? 'Ton' : 'Real'}
                                </button>
                                <button
                                    onClick={() => onMelodicTransform('transpose', { amount: 1 })}
                                    title={transformMode === 'tonal' ? 'Trasponi su di un grado (in chiave)' : 'Trasponi su di un semitono'}
                                    className="px-1.5 py-1 rounded-md transition-colors text-xs font-mono text-gray-300 hover:bg-gray-600"
                                >
                                    T▲
                                </button>
                                <button
                                    onClick={() => onMelodicTransform('transpose', { amount: -1 })}
                                    title={transformMode === 'tonal' ? 'Trasponi giù di un grado (in chiave)' : 'Trasponi giù di un semitono'}
                                    className="px-1.5 py-1 rounded-md transition-colors text-xs font-mono text-gray-300 hover:bg-gray-600"
                                >
                                    T▼
                                </button>
                                <button
                                    aria-label="Inverti la melodia (rovescia i movimenti)"
                                    onClick={() => onMelodicTransform('invert')}
                                    title={transformMode === 'real'
                                        ? '⚠ Inversione REALE = cromatica: esce dalla tonalità (per contesti atonali/dodecafonici). Per un risultato in chiave passa a Ton.'
                                        : "Inversione tonale (in chiave): ogni voce si specchia attorno alla propria prima nota. Inserita dopo l'originale."}
                                    className={`px-1.5 py-1 rounded-md transition-colors text-xs font-mono ${transformMode === 'real' ? 'text-amber-300 hover:bg-amber-900/40' : 'text-gray-300 hover:bg-gray-600'}`}
                                >
                                    {transformMode === 'real' ? 'Inv⚠' : 'Inv'}
                                </button>
                                <button
                                    aria-label="Retrogrado: rovescia l'ordine nel tempo"
                                    onClick={() => onMelodicTransform('retrograde')}
                                    title="Retrogrado: ordine temporale rovesciato (note e ritmo). Inserito dopo l'originale."
                                    className="px-1.5 py-1 rounded-md transition-colors text-xs font-mono text-gray-300 hover:bg-gray-600"
                                >
                                    Retr
                                </button>
                                <button
                                    aria-label="Retrogrado inverso"
                                    onClick={() => onMelodicTransform('retrogradeInvert')}
                                    title={transformMode === 'real'
                                        ? "⚠ Retrogrado-inverso REALE: contiene l'inversione cromatica → esce dalla tonalità. Per un risultato in chiave passa a Ton."
                                        : "Retrogrado-inverso tonale (in chiave). Inserito dopo l'originale."}
                                    className={`px-1.5 py-1 rounded-md transition-colors text-xs font-mono ${transformMode === 'real' ? 'text-amber-300 hover:bg-amber-900/40' : 'text-gray-300 hover:bg-gray-600'}`}
                                >
                                    {transformMode === 'real' ? 'R+I⚠' : 'R+I'}
                                </button>
                            </>
                        )}
                        </div>
                    )}
                </div>
            )}

            {isToolbarVisible && toolbarHoverTip && (
                <div
                    className="fixed z-[9999] pointer-events-none bg-slate-900/90 text-slate-100 text-[11px] px-2 py-1 rounded shadow"
                    style={{ left: toolbarHoverTip.x, top: toolbarHoverTip.y, maxWidth: 420 }}
                >
                    {toolbarHoverTip.text}
                </div>
            )}

            {!isToolbarVisible && showQuickInsertBar && (
                <div
                    style={{ position: 'fixed', left: barraComandi.pos.x, top: barraComandi.pos.y, zIndex: 1000 }}
                    className="px-1 py-1 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl"
                >
                    <div className="flex flex-row items-center flex-wrap gap-x-2 gap-y-1">
                        {/* La MANIGLIA. Il trascinamento sta qui e non su tutta la striscia:
                            prendendola dallo sfondo, ogni pulsante diventerebbe un punto di
                            presa e smetterebbe di rispondere al clic. */}
                        <div
                            onMouseDown={barraComandi.prendi}
                            title="Trascina per spostare la barra"
                            className="px-1 self-stretch flex items-center cursor-move text-slate-500 hover:text-slate-300 select-none"
                        >
                            ⠿
                        </div>
                        <div className="flex items-center gap-2">
                            {toolbarGroups.voices}
                            {toolbarGroups.insert}
                            {toolbarGroups.accidentals}
                            {toolbarGroups.notations}
                        </div>
                    </div>
                </div>
            )}

            {/* La targhetta «Quick Insert: ON» compariva anche a TOOLBAR APERTA, dove il
                transport non si disegna affatto: si accendeva l'interruttore, non appariva
                nessuna barra e spuntava una scritta che sembrava un residuo di debug.
                Si mostra solo dove la cosa ha un effetto, cioè a toolbar chiusa. */}
            {((showQuickInsertBar && !isToolbarVisible) || showHarmonyDebug) && (
                <div className="sticky top-0 z-40 mt-2 px-2">
                    <div className="inline-flex items-center gap-2 rounded-md bg-slate-800/90 border border-slate-700 px-2 py-1 text-[11px] text-slate-200">
                        {showQuickInsertBar && !isToolbarVisible && <span className="px-1.5 py-0.5 rounded bg-slate-700">Quick Insert: ON</span>}
                        {showHarmonyDebug && <span className="px-1.5 py-0.5 rounded bg-slate-700">Harmony Debug: ON</span>}
                    </div>
                </div>
            )}

            {/* Context menu (tasto destro su S/A/T/B): copia l'intera voce. */}
            {voiceCopyMenu && onCopyVoice && (
                <div
                    style={{ position: 'fixed', left: voiceCopyMenu.x, top: voiceCopyMenu.y, zIndex: 9999 }}
                    className="bg-slate-700 border border-slate-600 rounded shadow-lg py-1"
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => { onCopyVoice(voiceCopyMenu.voice); setVoiceCopyMenu(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-100 hover:bg-slate-600 whitespace-nowrap"
                    >
                        Copia intera voce {voiceName(voiceCopyMenu.voice)}
                    </button>
                </div>
            )}
        </>
    );
};

export default GrandStaffToolbar;
