import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUturnLeftIcon, PauseIcon as PauseSolidIcon, PlayIcon as PlaySolidIcon } from '@heroicons/react/24/solid';
import type { AccidentalType, NoteDuration, StaffNote, Voice } from '../types';

const VOICE_INSTRUMENT_OPTIONS = [
    { value: 'acoustic_grand_piano', label: '🎹 Pianoforte' },
    { value: 'church_organ', label: '⛪ Organo' },
    { value: 'harpsichord', label: '🎵 Clavicembalo' },
    { value: 'string_ensemble_1', label: '🎻 Archi' },
    { value: 'choir_aahs', label: '🎤 Coro' },
    { value: 'flute', label: '🪈 Flauto' },
    { value: 'oboe', label: '🎼 Oboe' },
    { value: 'clarinet', label: '🎼 Clarinetto' },
    { value: 'trumpet', label: '🎺 Tromba' },
    { value: 'french_horn', label: '📯 Corno' },
    { value: 'violin', label: '🎻 Violino' },
    { value: 'cello', label: '🎻 Violoncello' },
];
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

type InsertionElement = { type: 'note' | 'rest'; duration: NoteDuration; isDotted?: boolean };

type GrandStaffToolbarProps = {
    isPlaying: boolean;
    togglePlayback: () => void;
    undoNotes: () => void;

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

    selectedVoice: Voice;
    setSelectedVoice: (value: Voice) => void;
    soloVoices?: Set<number>;
    onToggleSolo?: (voice: number) => void;
    voiceInstruments?: Record<number, string>;
    onChangeVoiceInstrument?: (voice: number, instrument: string) => void;

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

    moreMenuRef: React.RefObject<HTMLDivElement>;
    isMoreMenuOpen: boolean;
    setIsMoreMenuOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
    staffSystemMode: StaffSystemMode;
    setStaffSystemMode: (value: StaffSystemMode) => void;
    lastNonSatbModeRef: React.MutableRefObject<StaffSystemMode>;
    staffLayoutMode: StaffLayoutMode;
    setStaffLayoutMode: (value: StaffLayoutMode | ((prev: StaffLayoutMode) => StaffLayoutMode)) => void;
    canvasFormat: CanvasFormat;
    setCanvasFormat: (value: CanvasFormat) => void;
    isMidiMenuOpen: boolean;
    setIsMidiMenuOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
    selectedMidiOutput: any | null;
    setSelectedMidiOutput: (value: any | null) => void;
    midiOutputs: any[];
    handleActivateMidi: () => Promise<void>;

    toolbarGroupOrder: ToolbarGroupId[];
    reorderToolbarGroups: (dragId: ToolbarGroupId, overId: ToolbarGroupId) => void;
    isToolbarCustomizeOpen: boolean;
    isToolbarHidden: boolean;

    showQuickInsertBar: boolean;
    showHarmonyDebug: boolean;
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
        selectedVoice,
        setSelectedVoice,
        soloVoices,
        onToggleSolo,
        voiceInstruments,
        onChangeVoiceInstrument,
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
        moreMenuRef,
        isMoreMenuOpen,
        setIsMoreMenuOpen,
        staffSystemMode,
        setStaffSystemMode,
        lastNonSatbModeRef,
        staffLayoutMode,
        setStaffLayoutMode,
        canvasFormat,
        setCanvasFormat,
        isMidiMenuOpen,
        setIsMidiMenuOpen,
        selectedMidiOutput,
        setSelectedMidiOutput,
        midiOutputs,
        handleActivateMidi,
        toolbarGroupOrder,
        reorderToolbarGroups,
        isToolbarCustomizeOpen,
        isToolbarHidden,
        showQuickInsertBar,
        showHarmonyDebug,
    } = props;

    const durations: { duration: NoteDuration; label: string }[] = useMemo(() => ([
        { duration: 'whole', label: 'Semibreve' },
        { duration: 'half', label: 'Minima' },
        { duration: 'quarter', label: 'Semiminima' },
        { duration: 'eighth', label: 'Croma' },
        { duration: 'sixteenth', label: 'Semicroma' },
        { duration: 'thirty-second', label: 'Biscroma' },
        { duration: 'sixty-fourth', label: 'Semibiscroma' },
    ]), []);

    const toolbarGroups: Record<ToolbarGroupId, React.ReactNode> = {
        playback: (
            <div className="flex items-center gap-2">
                <button
                    onClick={togglePlayback}
                    className={`p-2 rounded-full transition-colors ${isPlaying ? 'text-yellow-400 hover:bg-yellow-400/20' : 'text-green-400 hover:bg-green-400/20'}`}
                    title={isPlaying ? 'Pausa (Spazio)' : 'Play (Spazio)' }
                >
                    {isPlaying ? <PauseSolidIcon className={TOOLBAR_ICON_CLASS} /> : <PlaySolidIcon className={TOOLBAR_ICON_CLASS} />}
                </button>
                <button onClick={undoNotes} className="p-2 rounded-full text-gray-300 hover:bg-gray-600 transition-colors" title="Undo (Cmd/Ctrl+Z)">
                    <ArrowUturnLeftIcon className={TOOLBAR_ICON_CLASS} />
                </button>
            </div>
        ),
        bpm: (
            <div className="flex items-center gap-2">
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
                            className="text-lg font-bold w-12 text-center bg-transparent outline-none"
                            aria-label="BPM"
                        />
                    ) : (
                        <span className="text-lg font-bold w-12 text-center">{bpm}</span>
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
                    title="Metronomo (K)"
                >
                    <MetronomeIcon />
                </button>

                <select
                    value={metronomeUnit}
                    onChange={(e) => setMetronomeUnit(e.target.value as MetronomeUnit)}
                    className="bg-gray-700 border border-gray-600 rounded-full p-0.5 text-xs w-6 h-6 appearance-none cursor-pointer focus:ring-2 focus:ring-cyan-500"
                    title="Unità del metronomo"
                    style={{ minWidth: 0, paddingRight: 0, paddingLeft: 0, textIndent: '-9999px', backgroundPosition: 'center right 2px', backgroundRepeat: 'no-repeat', backgroundSize: '1em', backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'16\' height=\'16\' fill=\'none\' stroke=\'%23ccc\' stroke-width=\'2\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")' }}
                >
                    <option value="quarter">Quarto</option>
                    <option value="eighth">Ottavo</option>
                    <option value="dotted-quarter">Quarto puntato</option>
                </select>
            </div>
        ),
        key: (
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-400">Tonalità:</span>
                <select
                    id="key-signature-select"
                    value={keySignatureRoot}
                    onChange={e => handleKeySignatureRootChange(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs w-[111px]"
                >
                    <optgroup label="Diesis (♯)">{sharpKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                    <optgroup label="Bemolli (♭)">{flatKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                </select>

                <label className="flex items-center gap-2 text-xs text-gray-300 select-none">
                    <input
                        type="checkbox"
                        checked={keyChangeMode === 'transpose'}
                        onChange={(e) => setTransposeKeyChangeEnabled(e.target.checked)}
                        className="accent-cyan-500"
                    />
                    Trasponi
                </label>

                <label className="flex items-center gap-2 text-xs text-gray-300 select-none">
                    <input
                        type="checkbox"
                        checked={keyChangeMode === 'modal'}
                        onChange={(e) => setKeyChangeMode(e.target.checked ? 'modal' : 'none')}
                        className="accent-cyan-500"
                    />
                    Modale
                </label>

                {keyChangeMode === 'modal' && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Tonica:</span>
                        <select
                            value={modalTonicOverride}
                            onChange={(e) => setModalTonicOverride(e.target.value)}
                            className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs w-24"
                            title="Tonica del modo (vuoto = prima nota inserita)"
                        >
                            <option value="">Auto (prima nota)</option>
                            {modalTonicOptions.map(opt => (
                                <option key={opt.idx} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="relative flex p-0.5 bg-gray-900/50 rounded-md">
                    <div className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform" style={{ transform: `translateX(${isMinorMode ? '100%' : '0%'})` }}></div>
                    <button onClick={() => setIsMinorMode(false)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${!isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>Mag</button>
                    <button onClick={() => setIsMinorMode(true)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>min</button>
                </div>

                <label className="flex items-center gap-2 text-xs text-gray-300 select-none" title="In tonalità minore: alza automaticamente il VII grado (minore armonica) se non scegli un accidentale manuale.">
                    <input
                        type="checkbox"
                        checked={autoLeadingToneInMinor}
                        onChange={(e) => setAutoLeadingToneInMinor(e.target.checked)}
                        className="accent-cyan-500"
                    />
                    Sensibile auto
                </label>
            </div>
        ),
        time: (
            <div className="flex items-center gap-3">
                <span className="text-sm text-slate-400">Tempo:</span>
                {timeSignatureControl}
            </div>
        ),
        measures: (
            <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Misure:</span>
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
                        aria-label="Numero misure brano"
                    />
                    <div className="flex flex-col">
                        <button
                            onClick={() => bumpMinMeasureCount(+1)}
                            className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-slate-600 rounded-tr-md text-[10px] text-gray-200 hover:bg-slate-600"
                            title="Aumenta misure"
                            aria-label="Aumenta misure"
                        >
                            ▲
                        </button>
                        <button
                            onClick={() => bumpMinMeasureCount(-1)}
                            className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-t-0 border-slate-600 rounded-br-md text-[10px] text-gray-200 hover:bg-slate-600"
                            title="Diminuisci misure"
                            aria-label="Diminuisci misure"
                        >
                            ▼
                        </button>
                    </div>
                </div>
                <div className="w-px h-6 bg-slate-600 mx-2"></div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">per riga</span>
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
                            aria-label="Misure per riga"
                            title="Misure per riga (1-12)"
                        />
                        <div className="flex flex-col">
                            <button
                                onClick={() => bumpMeasuresPerLine(+1)}
                                className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-slate-600 rounded-tr-md text-[10px] text-gray-200 hover:bg-slate-600"
                                title="Aumenta misure per riga"
                                aria-label="Aumenta misure per riga"
                            >
                                ▲
                            </button>
                            <button
                                onClick={() => bumpMeasuresPerLine(-1)}
                                className="h-[18px] w-6 flex items-center justify-center bg-slate-700 border border-l-0 border-t-0 border-slate-600 rounded-br-md text-[10px] text-gray-200 hover:bg-slate-600"
                                title="Diminuisci misure per riga"
                                aria-label="Diminuisci misure per riga"
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
                {[1, 2, 3, 4].map(v => (
                    <button
                        key={v}
                        onClick={() => setSelectedVoice(v as Voice)}
                        onDoubleClick={(e) => { e.preventDefault(); onToggleSolo?.(v); }}
                        className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${soloVoices?.has(v) ? 'ring-2 ring-yellow-400 ' : ''}${selectedVoice === v ? (v === 1 ? 'bg-blue-600 text-white' : v === 2 ? 'bg-orange-500 text-white' : v === 3 ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'text-gray-300 hover:bg-gray-600'}`}
                        title={`${v === 1 ? 'Soprano' : v === 2 ? 'Alto' : v === 3 ? 'Tenore' : 'Basso'}${soloVoices?.has(v) ? ' (SOLO)' : ''} — doppio-click per solo`}
                    >
                        {v === 1 ? 'S' : v === 2 ? 'A' : v === 3 ? 'T' : 'B'}
                    </button>
                ))}
            </div>
        ),
        voiceInstrument: onChangeVoiceInstrument ? (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md" title={`Strumento per ${selectedVoice === 1 ? 'Soprano' : selectedVoice === 2 ? 'Alto' : selectedVoice === 3 ? 'Tenore' : 'Basso'}`}>
                <select
                    className="bg-slate-800 text-gray-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 cursor-pointer"
                    value={voiceInstruments?.[selectedVoice] || 'acoustic_grand_piano'}
                    onChange={(e) => onChangeVoiceInstrument(selectedVoice, e.target.value)}
                >
                    {VOICE_INSTRUMENT_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
        ) : null,
        insert: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={() => { setSelectedInsertion(prev => ({ ...prev, type: prev.type === 'note' ? 'rest' : 'note' })); }}
                    className={`p-1 rounded-md transition-colors ${selectedInsertion.type === 'rest' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={selectedInsertion.type === 'note' ? 'Passa a Pausa (R)' : 'Modalità Pausa attiva — passa a Nota (R)'}
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
                    title="Punto di valore"
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
                    title="Terzina"
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
                    title={canUseDuplet ? 'Duina (2 ottavi nel tempo di 3) nei tempi composti' : 'Duina disponibile solo nei tempi composti (x/8 con numeratore multiplo di 3) e con durata ottavo selezionata'}
                >
                    <span className="text-sm font-bold leading-none">2</span>
                </button>
                <button
                    onClick={() => setIsSwing(s => !s)}
                    className={`p-1 rounded-md transition-colors ${isSwing ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title="Swing (ottavi terzinati) — solo playback"
                >
                    <span className="text-[10px] font-bold leading-none">Sw</span>
                </button>
                <button
                    onClick={toggleDoubleBarlineAtPlayhead}
                    disabled={!playheadPosition}
                    className="p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={playheadPosition ? 'Inserisci/Rimuovi doppia barra alla misura della playhead' : 'Imposta prima la playhead (click sullo staff)'}
                >
                    <span className="text-sm font-bold leading-none">||</span>
                </button>
                <button
                    onClick={insertMeasureAtPlayhead}
                    disabled={!playheadPosition}
                    className="p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={playheadPosition ? 'Inserisci misura alla playhead (sposta avanti le successive)' : 'Imposta prima la playhead (click sullo staff)'}
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
                    title="Diesis (♯)"
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
                    title="Doppio Diesis (𝄪)"
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
                    title="Bemolle (♭)"
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
                    title="Doppio Bemolle (♭♭)"
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
                    title="Bequadro (N)"
                >
                    <NaturalIcon className={TOOLBAR_ICON_CLASS} />
                </button>
            </div>
        ),
        notations: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={handleToggleBeamGroup}
                    disabled={selectedNotesBeamState === 'unbeamable'}
                    className="p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={selectedNotesBeamState === 'beamed' ? 'Separa note selezionate' : selectedNotesBeamState === 'unbeamable' ? 'Seleziona almeno 2 note per la travatura' : 'Unisci note selezionate'}
                >
                    {selectedNotesBeamState === 'beamed' ? <UngroupIcon /> : <GroupIcon />}
                </button>
                <button
                    onClick={handleToggleTie}
                    disabled={selectedNoteIds.size === 0}
                    className="p-1 rounded-md text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600 transition-colors"
                    title="Lega note"
                >
                    <TieIcon className={TOOLBAR_ICON_CLASS} />
                </button>
                <button
                    onClick={handleFlipStem}
                    disabled={!selectedTiePair && selectedNoteIds.size === 0}
                    className="p-1 rounded-md text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600 transition-colors"
                    title="Inverti gambo / legatura"
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
                    title={activeTab === 'analysis' ? 'Torna a Editor' : 'Apri Analisi'}
                >
                    {activeTab === 'analysis' ? 'Editor' : 'Analisi'}
                </button>
                <button
                    onClick={() => setIsAnalysisEnabled(prev => !prev)}
                    className={`ml-1 flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md transition-all ${isAnalysisEnabled ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                    title={isAnalysisEnabled ? 'Disattiva Analisi' : 'Attiva Analisi'}
                >
                    <span>Analisi {isAnalysisEnabled ? 'On' : 'Off'}</span>
                </button>
                {isAnalysisEnabled && (
                    <div className="flex items-center gap-1 p-0.5 bg-gray-900/50 rounded-md text-xs ml-2">
                        <button
                            onClick={() => setShowRomanAnalysis(prev => !prev)}
                            className={`w-10 rounded-sm py-0.5 font-bold transition-all ${showRomanAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showRomanAnalysis ? 'Nascondi Numeri Romani' : 'Mostra Numeri Romani'}
                        >
                            V7
                        </button>
                        <button
                            onClick={() => setShowSymbolAnalysis(prev => !prev)}
                            className={`w-10 rounded-sm py-0.5 font-bold transition-all ${showSymbolAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showSymbolAnalysis ? 'Nascondi Sigle' : 'Mostra Sigle'}
                        >
                            G7
                        </button>
                    </div>
                )}
            </div>
        ),
        more: (
            <div ref={moreMenuRef} className="relative flex items-center">
                <button
                    onClick={() => setIsMoreMenuOpen(o => !o)}
                    className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors ${isMoreMenuOpen ? 'bg-slate-200 text-gray-900' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}
                    title="Menu"
                >
                    ⋯
                </button>
                {isMoreMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 min-w-64 rounded-md bg-slate-800 border border-slate-700 shadow-lg p-1 z-50">
                        <button
                            onClick={() => setStaffSystemMode('grandstaff')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title="Torna al Grand Staff (2 righi) — Alt/Option+L"
                        >
                            <span>Grand Staff (2 righi)</span>
                            {staffSystemMode === 'grandstaff' && <span className="text-[11px]">✓</span>}
                        </button>
                        <button
                            onClick={() => setStaffSystemMode('treble_only')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title="Chiave di violino (1 rigo)"
                        >
                            <span>Chiave di violino (1 rigo)</span>
                            {staffSystemMode === 'treble_only' && <span className="text-[11px]">✓</span>}
                        </button>
                        <button
                            onClick={() => {
                                const isSatb = staffSystemMode === 'satb_ancient';
                                if (isSatb) setStaffSystemMode(lastNonSatbModeRef.current);
                                else setStaffSystemMode('satb_ancient');
                            }}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title="SATB antiche (4 righi) — Alt/Option+L"
                        >
                            <span>SATB antiche (4 righi)</span>
                            {staffSystemMode === 'satb_ancient' && <span className="text-[11px]">✓</span>}
                        </button>
                        <button
                            onClick={() => setStaffLayoutMode(prev => prev === 'parti_late' ? 'parti_strette' : 'parti_late')}
                            disabled={staffSystemMode === 'satb_ancient'}
                            className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${staffSystemMode === 'satb_ancient' ? 'text-gray-500 cursor-not-allowed' : 'text-gray-200 hover:bg-slate-700'}`}
                            title={staffSystemMode === 'satb_ancient' ? 'Layout non applicabile in SATB (4 righi)' : 'Parti strette'}
                        >
                            <span>Parti strette</span>
                            {staffLayoutMode === 'parti_strette' && staffSystemMode !== 'satb_ancient' && <span className="text-[11px]">✓</span>}
                        </button>
                        <div className="my-2 h-px bg-slate-700" />
                        <div className="px-2 pb-1 text-[11px] text-slate-300">Formato</div>
                        <button
                            onClick={() => setCanvasFormat('page')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title="Page"
                        >
                            <span>Page</span>
                            <span className="text-[11px]">{canvasFormat === 'page' ? '●' : '○'}</span>
                        </button>
                        <button
                            onClick={() => setCanvasFormat('landscape')}
                            className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                            title="Landscape"
                        >
                            <span>Landscape</span>
                            <span className="text-[11px]">{canvasFormat === 'landscape' ? '●' : '○'}</span>
                        </button>
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
                            title="MIDI"
                        >
                            <span>MIDI</span>
                            {(isMidiMenuOpen || !!selectedMidiOutput) && <span className="text-[11px]">✓</span>}
                        </button>
                        {isMidiMenuOpen && (
                            <div className="mt-1 rounded-md bg-slate-900/40 border border-slate-700">
                                <div className="px-2 py-1 text-[11px] text-slate-300">Seleziona uscita</div>
                                <button
                                    onClick={() => {
                                        setSelectedMidiOutput(null);
                                        setIsMidiMenuOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${selectedMidiOutput ? 'text-gray-200 hover:bg-slate-700' : 'bg-cyan-600 text-white'}`}
                                >
                                    <span>Audio Interno</span>
                                    {!selectedMidiOutput && <span className="text-[11px]">✓</span>}
                                </button>
                                {midiOutputs.length === 0 ? (
                                    <div className="px-2 py-1 text-[11px] text-gray-400">Nessun dispositivo MIDI</div>
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
                    className="sticky top-0 z-50 p-2 bg-slate-800 border-b border-slate-700 rounded-lg"
                >
                    <div className="flex flex-row items-center flex-wrap gap-x-6 gap-y-2">
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
                                            title="Trascina per riordinare"
                                        >
                                            ⋮⋮
                                        </span>
                                    )}
                                    {toolbarGroups[id]}
                                </div>
                                {idx < visibleGroupIds.length - 1 && <div className="h-6 w-px bg-slate-600"></div>}
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
                <div className="sticky top-0 z-50 p-2 bg-slate-800 border-b border-slate-700 rounded-lg">
                    <div className="flex flex-row items-center flex-wrap gap-x-6 gap-y-2">
                        <div className="flex items-center gap-3">
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
        </>
    );
};

export default GrandStaffToolbar;
