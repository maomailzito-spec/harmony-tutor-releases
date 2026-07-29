import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUturnLeftIcon, PauseIcon as PauseSolidIcon, PlayIcon as PlaySolidIcon } from '@heroicons/react/24/solid';
import type { AccidentalType, NoteDuration, StaffNote, Voice } from '../types';
import { activeVoicesForPartCount, type PartCount } from '../utils/voiceParts';
import { INSTRUMENTS, gmToSoundfont, soundfontToGm } from '../constants/instruments';
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

const MetronomeIcon = () => (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3L4 21h16L12 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6" />
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
    setShowSymbolAnalysis: (value: boolean | ((prev: boolean) => boolean)) => void;
    analysisSubject: 'satb' | 'acc';
    setAnalysisSubject: (value: 'satb' | 'acc') => void;
    accTracksForAnalysis: Array<{ id: string; name: string }>;
    analysisAccTrackId: string | null;
    setAnalysisAccTrackId: (value: string | null) => void;

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
    isToolbarCustomizeOpen: boolean;
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
        setShowSymbolAnalysis,
        analysisSubject,
        setAnalysisSubject,
        accTracksForAnalysis,
        analysisAccTrackId,
        setAnalysisAccTrackId,
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
        isToolbarCustomizeOpen,
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

    const [chromaticModulationEnabled, setChromaticModulationEnabled] = usePreference<boolean>('analysis.chromaticModulation');
    const { t } = useTranslation('ui');
    const { t: tT } = useTranslation('toolbar');

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
                  <button
                    onClick={canRecord ? onToggleRecording : undefined}
                    disabled={!canRecord}
                    className={`p-2 rounded-full transition-colors ${
                      !canRecord
                        ? 'text-gray-600 cursor-not-allowed opacity-40'
                        : isRecording
                          ? isCountingIn
                            ? 'text-orange-400 animate-pulse'
                            : 'text-red-500 animate-pulse'
                          : isRecArmed
                            ? 'text-red-400 animate-pulse'
                            : 'text-gray-300 hover:bg-gray-600'
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
                      isRecording ? 'bg-red-500 border-red-500' : 'border-current'
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
            <div className="flex items-center gap-1.5 flex-wrap">
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

                <div className="relative flex p-0.5 bg-gray-900/50 rounded-md">
                    <div className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform" style={{ transform: `translateX(${isMinorMode ? '100%' : '0%'})` }}></div>
                    <button onClick={() => setIsMinorMode(false)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${!isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>{tT('key_major')}</button>
                    <button onClick={() => setIsMinorMode(true)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>{tT('key_minor')}</button>
                </div>

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
                <div className="flex items-center">
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
                            className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-slate-600 rounded-tr-md text-[10px] text-gray-200 hover:bg-slate-600"
                            title={tT('measures_increase')}
                            aria-label={tT('measures_increase')}
                        >
                            ▲
                        </button>
                        <button
                            onClick={() => bumpMinMeasureCount(-1)}
                            className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-t-0 border-slate-600 rounded-br-md text-[10px] text-gray-200 hover:bg-slate-600"
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
                    <div className="flex items-center">
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
                                className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-slate-600 rounded-tr-md text-[10px] text-gray-200 hover:bg-slate-600"
                                title={tT('measures_per_line_increase')}
                                aria-label={tT('measures_per_line_increase')}
                            >
                                ▲
                            </button>
                            <button
                                onClick={() => bumpMeasuresPerLine(-1)}
                                className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-t-0 border-slate-600 rounded-br-md text-[10px] text-gray-200 hover:bg-slate-600"
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
                            onClick={() => onMelodicTransform('invert')}
                            title={transformMode === 'real'
                                ? '⚠ Inversione REALE = cromatica: esce dalla tonalità (per contesti atonali/dodecafonici). Per un risultato in chiave passa a Ton.'
                                : "Inversione tonale (in chiave): ogni voce si specchia attorno alla propria prima nota. Inserita dopo l'originale."}
                            className={`px-1.5 py-1 rounded-md transition-colors text-xs font-mono ${transformMode === 'real' ? 'text-amber-300 hover:bg-amber-900/40' : 'text-gray-300 hover:bg-gray-600'}`}
                        >
                            {transformMode === 'real' ? 'Inv⚠' : 'Inv'}
                        </button>
                        <button
                            onClick={() => onMelodicTransform('retrograde')}
                            title="Retrogrado: ordine temporale rovesciato (note e ritmo). Inserito dopo l'originale."
                            className="px-1.5 py-1 rounded-md transition-colors text-xs font-mono text-gray-300 hover:bg-gray-600"
                        >
                            Retr
                        </button>
                        <button
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
                {isAnalysisEnabled && (
                    <div className="flex items-center gap-1 ml-2 text-xs">
                        <div className="flex items-center p-0.5 bg-gray-900/50 rounded-md">
                            <button
                                onClick={() => setAnalysisSubject('satb')}
                                className={`px-2 rounded-sm py-0.5 font-semibold transition-all ${analysisSubject === 'satb' ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                                title="Analizza il coro SATB"
                            >SATB</button>
                            <button
                                onClick={() => setAnalysisSubject('acc')}
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
                )}
                {isAnalysisEnabled && (
                    <div className="flex items-center gap-1 p-0.5 bg-gray-900/50 rounded-md text-xs ml-2">
                        <button
                            onClick={() => setShowRomanAnalysis(prev => !prev)}
                            className={`w-10 rounded-sm py-0.5 font-bold transition-all ${showRomanAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showRomanAnalysis ? t('toolbar_hide_roman') : t('toolbar_show_roman')}
                        >
                            V7
                        </button>
                        <button
                            onClick={() => setShowSymbolAnalysis(prev => !prev)}
                            className={`w-10 rounded-sm py-0.5 font-bold transition-all ${showSymbolAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showSymbolAnalysis ? t('toolbar_hide_symbols') : t('toolbar_show_symbols')}
                        >
                            G7
                        </button>
                        <button
                            onClick={() => setChromaticModulationEnabled(!chromaticModulationEnabled)}
                            className={`px-1.5 rounded-sm py-0.5 font-bold transition-all ${chromaticModulationEnabled ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={t('toolbar_chromatic_tooltip')}
                        >
                            {tT('analysis_chromatic_label')}
                        </button>
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
                        <div className="my-2 h-px bg-slate-700" />
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
                    </div>
                )}
            </div>
        ),
    };

    const visibleGroupIds = toolbarGroupOrder;
    const [draggingToolbarGroupId, setDraggingToolbarGroupId] = useState<ToolbarGroupId | null>(null);

    const forceToolbarVisible = isToolbarCustomizeOpen || isMoreMenuOpen;
    const isToolbarVisible = forceToolbarVisible || !isToolbarHidden;

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
            {isToolbarVisible && (
                <div
                    ref={toolbarHoverRef}
                    onMouseMove={handleToolbarMouseMove}
                    onMouseLeave={() => setToolbarHoverTip(null)}
                    className="sticky top-0 z-50 px-2 py-1 bg-slate-800 border-b border-slate-700 rounded-lg"
                >
                    <div className="flex flex-row items-center flex-wrap gap-x-2 gap-y-1">
                        {visibleGroupIds.map((id, idx) => (
                            <React.Fragment key={id}>
                                <div
                                    className="relative"
                                    onDragOver={(e) => {
                                        if (!isToolbarCustomizeOpen) return;
                                        if (!draggingToolbarGroupId) return;
                                        e.preventDefault();
                                        if (draggingToolbarGroupId === id) return;
                                        reorderToolbarGroups(draggingToolbarGroupId, id);
                                    }}
                                    onDrop={(e) => {
                                        if (!isToolbarCustomizeOpen) return;
                                        e.preventDefault();
                                        setDraggingToolbarGroupId(null);
                                    }}
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
                                            onDragEnd={() => setDraggingToolbarGroupId(null)}
                                            className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none cursor-grab px-1 text-gray-300"
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
                    </div>
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
                <div className="sticky top-0 z-50 px-2 py-1 bg-slate-800 border-b border-slate-700 rounded-lg">
                    <div className="flex flex-row items-center flex-wrap gap-x-2 gap-y-1">
                        <div className="flex items-center gap-2">
                            {toolbarGroups.voices}
                            {toolbarGroups.insert}
                            {toolbarGroups.accidentals}
                            {toolbarGroups.notations}
                        </div>
                    </div>
                </div>
            )}

            {(showQuickInsertBar || showHarmonyDebug) && (
                <div className="sticky top-0 z-40 mt-2 px-2">
                    <div className="inline-flex items-center gap-2 rounded-md bg-slate-800/90 border border-slate-700 px-2 py-1 text-[11px] text-slate-200">
                        {showQuickInsertBar && <span className="px-1.5 py-0.5 rounded bg-slate-700">Quick Insert: ON</span>}
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
