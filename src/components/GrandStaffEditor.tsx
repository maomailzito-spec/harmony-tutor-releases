// ...existing code...
// TypeScript: dichiarazione per window.electronAPI
declare global {
    interface Window {
        electronAPI?: {
            onMenuAction: (handler: (action: string, payload: any) => void) => (() => void) | void;
            saveFile: (content: string, targetPath?: string) => Promise<any>;
            addRecentFile: (filePath: string) => Promise<any>;
            onUpdateProgress?: (handler: (data: { percent: number; status: string; error?: string }) => void) => (() => void) | void;
        };
    }
}
import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, startTransition, useDeferredValue } from 'react';
import { StaffNote, KeySignature, NoteDuration, TimeSignature, Barline, ClefType, Voice, HarmonyAnalysisResult, ErrorConnection, AccidentalType, AnalysisContext, HarmonyLabelOverride, TimeSignatureChange, VoltaBracket, OrnamentOverride, OrnamentType, TonicizationHint, TempoCurve, AccompanimentTrack } from '../types';
import { AudioService, type SustainHandle } from '../services/AudioService';
import { gmToSoundfont } from '../constants/instruments';
import { CycleIcon } from './icons/CycleIcon';
import { useUndoableState } from '../hooks/useUndoableState';
import { useNoteSelection } from '../hooks/useNoteSelection';
import { usePlayback } from '../hooks/usePlayback';
import type { MetronomeUnit } from '../hooks/usePlayback';
import { useNoteEditor } from '../hooks/useNoteEditor';
import { applyHarmonyRules, getKeySignature, calculateNoteBeats, getRomanAnalysis, getRomanAnalysisDebugSnapshot, getNotePropertiesFromDiatonicPosition, getNotePropertiesFromMidi, getChordSymbol, calculateAccidental, ticksToBeats, beatsToTicks, rebuildMeasureTimelineForVoice, normalizeNotePitchFieldsWithKey, identifyChordCandidates, calculateRomanFromChordInfo, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS } from '../utils/musicTheory';
import { parseChordSymbol, buildChordSATBNotes, revoiceChordAtTick, buildMeasureAccidentals, VOICING_DISPOSITIONS, type VoicingDisposition } from '../utils/parseChordSymbol';
import HarmonyAnalysisPanel from './HarmonyAnalysisPanel';
import { NOTE_NAMES, DURATION_VALUES, ALL_NOTE_SPELLINGS, CROSS_LETTER_ENHARMONICS, CHORD_FORMULAS, TICKS_PER_QUARTER, DEFAULT_PX_PER_TICK } from '../constants';
import { importMusicXML } from '../importers/musicxml/importMusicXML';
import { exportMusicXML } from '../exporters/exportMusicXML';
import { useEditorZoom } from '../hooks/useEditorZoom';
import { useHarmonyLabels } from '../hooks/useHarmonyLabels';
import { useHarmonyExplain } from '../hooks/useHarmonyExplain';
import HarmonyLabelExplainModal from './HarmonyLabelExplainModal';
import type { MenuAction, MenuActionPayloadMap } from '../../shared/menuActionRegistry';
import { MENU_ACTIONS } from '../contracts/menuActionRuntime';
import { getMenuActionTarget } from '../contracts/menuActionTargets';
import { electronBridge } from '../services/electronBridge';
import { usePreference } from '../preferences/usePreference';
import type { HarmonyAnalysisFiltersPref } from '../preferences/preferencesRegistry';
import { useMenuStateSync } from '../controllers/useMenuStateSync';
import { CURRENT_PROJECT_SCHEMA_VERSION, extractProjectExtras, migrateProjectData, DEFAULT_ANALYSIS_LOCK_OPTIONS } from '../storage/projectSchema';
import type { AnalysisLockOptions } from '../storage/projectSchema';
import { recordAnalysedTransitions } from '../engine/progressionSuggester';
import { loadStyleProfile } from '../engine/choralStyleProfile';
import { handleGrandStaffProjectIOMenuAction, buildGrandStaffProjectSnapshot } from '../controllers/grandStaffProjectIOAdapter';
import { useGrandStaffMidi, trimOverlappingNotes, normalizeRhythm, beatsToDurationFlags, extendNotesToNextOnset } from '../hooks/useGrandStaffMidi';
import { useMidiStepInput } from '../hooks/useMidiStepInput';
import { useRealtimeRecording, RawRecordedEvent } from '../hooks/useRealtimeRecording';
import { expandMeasureOrder } from '../utils/expandMeasureOrder';
import GrandStaffToolbar from './GrandStaffToolbar';
import VexflowGrandStaff, { accompanimentExtraPxForTracks, accompanimentTrackTrebleOffsets } from './VexflowGrandStaff';
import PreferencesModal from './PreferencesModal';
import AnalysisLockModal from './AnalysisLockModal';
import TempoCurveDialog from './TempoCurveDialog';
import RomanProgressionEditor from './RomanProgressionEditor';
import TimeSignatureControl from './TimeSignatureControl';
import ModulationContextMenu from './ModulationContextMenu';
import HarmonyOverrideContextMenu from './HarmonyOverrideContextMenu';
import MixerPanel from './MixerPanel';

interface GrandStaffEditorProps {
    isActive: boolean;
    audioService: AudioService;
    isAudioReady: boolean;
    pendingMenuAction?: { action: MenuAction; payload: MenuActionPayloadMap[MenuAction]; nonce: number } | null;
    onConsumePendingMenuAction?: (nonce: number) => void;
}

type InsertionElement = { type: 'note' | 'rest', duration: NoteDuration, isDotted?: boolean };
// Must match value in VexflowGrandStaff.tsx
const STAFF_MARGIN = 50;
type Tool = 'insert';
type ViewMode = 'page' | 'linear';

type CanvasFormat = 'page' | 'landscape';
type ActiveTab = 'editor' | 'analysis';
type StaffLayoutMode = 'parti_late' | 'parti_strette';
type StaffSystemMode = 'grandstaff' | 'treble_only' | 'satb_ancient';
type EngravingMode = 'legacy' | 'enhanced';
type AccompanimentPattern = 'block' | 'arpeggio_up' | 'arpeggio_down' | 'broken' | 'albertino' | 'ondulato';

const LINE_HEIGHT = 12;

const TOP_STAFF_HEIGHT = 100;
const TOP_STAFF_TOP = 30;
const BOTTOM_STAFF_HEIGHT = 180;
const BOTTOM_STAFF_TOP = 20;
const CONNECTOR_HEIGHT = 70;
// Forward-compat: unknown fields from loaded project files.
// These are round-tripped on Save/Save As to avoid destroying future data.
const EMPTY_EXTRAS: Record<string, unknown> = {};
const TOTAL_SYSTEM_HEIGHT = TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_HEIGHT;

// VexFlow stave geometry (must match values in VexflowGrandStaff.tsx)
// Used for cursor->pitch mapping so the ghost note aligns with the pointer.
const VF_TREBLE_Y = 40;
const VF_BASS_Y = 170;
const VF_LINE_SPACING = 10;

// SATB (chiavi antiche): soprano (C1), alto (C3), tenore (C4), basso (F4)
// Must match values in VexflowGrandStaff.tsx
const VF_SATB_SOPRANO_Y = 40;
const VF_SATB_ALTO_Y = 140;
const VF_SATB_TENOR_Y = 240;
const VF_SATB_BASS_Y = 340;
// Extra bottom space in SATB mode so very low bass notes (e.g. C below the staff)
// remain fully visible and insertable. This must not affect pitch mapping.
const VF_SATB_BASS_EXTRA_BOTTOM_PX = 140;
const VF_SATB_SYSTEM_HEIGHT = VF_SATB_BASS_Y + (4 * VF_LINE_SPACING) + VF_SATB_BASS_EXTRA_BOTTOM_PX;

// Match VexFlow's grand staff span (see VexflowGrandStaff).
// Requested: move the bottom endpoint DOWN to the first/lowest line of the lower staff.
// (Top line of treble staff -> bottom line of bass staff)
const PLAYHEAD_Y_OFFSET_PX = 42;
const PLAYHEAD_Y_TOP = VF_TREBLE_Y + PLAYHEAD_Y_OFFSET_PX - 3;
const PLAYHEAD_Y_BOTTOM = (VF_BASS_Y + (4 * VF_LINE_SPACING)) + PLAYHEAD_Y_OFFSET_PX;
const PLAYHEAD_CONTEXT_HIT_PX = 10;

const START_X = 50; 
const STAFF_PADDING_X = 10;
const MEASURE_PADDING_X = 20;

// Empirical calibration: on some setups the pointer->SVG Y reported to the editor
// is offset relative to the rendered VexFlow stave by ~1 staff (≈40px).
// Adjust here to keep the ghost note under the cursor.
const VF_TREBLE_MOUSE_Y_ADJUST_PX = -40;

const relativeMinors: { [major: string]: string } = {
    'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#', 'F#': 'D#', 'C#': 'A#',
    'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb', 'Cb': 'Ab'
};

const keySignatureOptions = [
  { value: 'C', label: 'C Mag / A min (0 ♯/♭)' },
  { value: 'G', label: 'G Mag / E min (1 ♯)' },
  { value: 'D', label: 'D Mag / B min (2 ♯)' },
  { value: 'A', label: 'A Mag / F♯ min (3 ♯)' },
  { value: 'E', label: 'E Mag / C♯ min (4 ♯)' },
  { value: 'B', label: 'B Mag / G♯ min (5 ♯)' },
  { value: 'F#', label: 'F♯ Mag / D♯ min (6 ♯)' },
  { value: 'C#', label: 'C♯ Mag / A♯ min (7 ♯)' },
  { value: 'F', label: 'F Mag / D min (1 ♭)' },
  { value: 'Bb', label: 'B♭ Mag / G min (2 ♭)' },
  { value: 'Eb', label: 'E♭ Mag / C min (3 ♭)' },
  { value: 'Ab', label: 'A♭ Mag / F min (4 ♭)' },
  { value: 'Db', label: 'D♭ Mag / B♭ min (5 ♭)' },
  { value: 'Gb', label: 'G♭ Mag / E♭ min (6 ♭)' },
  { value: 'Cb', label: 'C♭ Mag / A♭ min (7 ♭)' },
];

const sharpKeyValues = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const flatKeyValues = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];

const sharpKeyOptions = keySignatureOptions.filter(k => sharpKeyValues.includes(k.value));
const flatKeyOptions = keySignatureOptions.filter(k => flatKeyValues.includes(k.value));

// Overlay tuning: align adapter-drawn connections with VexFlow noteheads
// (Empirical offsets requested by user; adjust if VexFlow layout changes.)
const OVERLAY_TREBLE_X_SHIFT_PX = 17; // ~4.5mm
// NOTE: user requested lowering the correction (dashed) connections on the upper staff.
// This shift applies only to the connection overlay logic below.
const OVERLAY_TREBLE_Y_SHIFT_PX = 48; // +40px vs previous
// Fine-tune: in common 4-part writing, parallel-connection overlays draw 2 lines on treble (S and A).
// Slightly raise the lower one (Alto / voice 2) to better match the rendered notehead center.
const OVERLAY_TREBLE_VOICE2_Y_ADJUST_PX = -5;
const OVERLAY_BASS_X_SHIFT_PX = 19;   // ~5mm
const OVERLAY_BASS_Y_SHIFT_PX = 19;   // lowered by ~2mm vs previous tweak (empirical)
const ORNAMENT_LABEL_FONT_SIZE_PX = 11;
const ORNAMENT_LABEL_LEADER_STROKE = '#94a3b8';
// Drag threshold in *client* pixels to avoid canceling clicks when the SVG is scaled.
const DRAG_THRESHOLD_CLIENT_PX = 6;

const ENABLE_MARQUEE_SELECTION = true;

type ToolbarGroupId =
    | 'playback'
    | 'bpm'
    | 'key'
    | 'time'
    | 'measures'
    | 'voices'
    | 'voiceInstrument'
    | 'mixer'
    | 'insert'
    | 'chordInsert'
    | 'accidentals'
    | 'notations'
    | 'analysis'
    | 'more';

const TOOLBAR_PREFS_KEY = 'harmony-tutor.toolbarPrefs.v1';
const STAFF_SYSTEM_MODE_KEY = 'harmony-tutor.staffSystemMode.v1';
const ENGRAVING_MODE_KEY = 'harmony-tutor.engravingMode.v1';
const DEFAULT_TOOLBAR_ORDER: ToolbarGroupId[] = [
    'playback',
    'bpm',
    'key',
    'time',
    'measures',
    'voices',
    'voiceInstrument',
    'mixer',
    'insert',
    'chordInsert',
    'accidentals',
    'notations',
    'analysis',
    'more',
];

class RenderErrorBoundary extends React.Component<
  { label: string; onReset?: () => void; children: React.ReactNode },
  { hasError: boolean; message?: string }
> {
  state = { hasError: false as boolean, message: undefined as string | undefined };

  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

    componentDidCatch(err: unknown) {
        // Removed debug log
    }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-red-50/80">
        <div className="max-w-xl rounded-lg border border-red-300 bg-white p-4 shadow">
          <div className="text-sm font-semibold text-red-700">Render error: {this.props.label}</div>
          <div className="mt-1 text-xs text-slate-700 break-words">{this.state.message}</div>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
              onClick={() => {
                this.setState({ hasError: false, message: undefined });
                this.props.onReset?.();
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function isAccompanimentNote(noteId: string, accompanimentTracks: AccompanimentTrack[]): boolean {
    return accompanimentTracks.some(track => track.notes.some(note => note.id === noteId));
}

function findAccTrackForNote(noteId: string, accompanimentTracks: AccompanimentTrack[]): {
    trackIndex: number;
    noteIndex: number;
} | null {
    for (let ti = 0; ti < accompanimentTracks.length; ti++) {
        const ni = accompanimentTracks[ti].notes.findIndex(n => n.id === noteId);
        if (ni !== -1) return { trackIndex: ti, noteIndex: ni };
    }
    return null;
}

/** Mappa la velocity MIDI (1..127) in un fattore di volume per il playback.
 *  Le note senza velocity (inserite a mano) restituiscono 1 (volume pieno),
 *  così il comportamento esistente non cambia. La curva è leggermente
 *  esponenziale (^1.6) per avvicinarsi alla risposta percettiva dei sintetizzatori
 *  e con un pavimento minimo così le note pianissimo restano udibili. */
function velocityToGain(velocity: number | undefined): number {
    if (velocity == null || !Number.isFinite(velocity)) return 1;
    const v = Math.max(0, Math.min(127, velocity)) / 127;
    // Curva realistica: i pianissimo restano UDIBILI (non spariscono) ma chiaramente
    // più piani; i fortissimi pieni. Pavimento 0.12 + esponente morbido (1.3) così la
    // gamma media non si schiaccia ma le note piano non diventano inudibili.
    // Es.: vel 18→0.16, vel 40→0.30, vel 64→0.48, vel 100→0.77, vel 127→1.0.
    // Le note senza velocity (inserite a mano) restano a 1 (gestito nel guard sopra).
    return 0.12 + 0.88 * Math.pow(v, 1.3);
}

/** Converti gli eventi raw registrati in StaffNote pronte per la traccia ACC. */
function convertRecordedEventsToNotes(
  events: RawRecordedEvent[],
  bpm: number,
  timeSignature: { numerator: number; denominator: number },
  startMeasureIndex: number,
  keySignature: import('../types').KeySignature,
): import('../types').StaffNote[] {
  const ticksPerSecond = (bpm / 60) * TICKS_PER_QUARTER;
  const ticksPerBeat = TICKS_PER_QUARTER * (4 / timeSignature.denominator);
  const ticksPerMeasure = ticksPerBeat * timeSignature.numerator;
  const measureStartTick = startMeasureIndex * ticksPerMeasure;

  return events
    .filter(ev => ev.timestampSec >= 0)
    .map(ev => {
      const startTick = Math.round(measureStartTick + ev.timestampSec * ticksPerSecond);
      const durationTicks = Math.max(
        Math.round(ev.durationSec * ticksPerSecond),
        Math.round(TICKS_PER_QUARTER / 4), // minimo: semicroma
      );
      const measureIndex = Math.floor(startTick / ticksPerMeasure);
      const beatInMeasure = ((startTick % ticksPerMeasure) / ticksPerBeat) + 1;

      const clef: import('../types').ClefType = ev.midiNote >= 60 ? 'treble' : 'bass';
      const props = getNotePropertiesFromMidi(ev.midiNote, keySignature, clef, null);
      const dFlags = beatsToDurationFlags(durationTicks / TICKS_PER_QUARTER);

      return {
        id: crypto.randomUUID(),
        ...props,
        duration: dFlags.duration,
        isDotted: dFlags.isDotted,
        isTriplet: dFlags.isTriplet,
        isDuplet: dFlags.isDuplet,
        isRest: false,
        measureIndex,
        beat: beatInMeasure,
        startTick,
        durationTicks,
        rawStartTick: startTick,       // preserva il tick raw per ri-quantizzazione
        rawDurationTicks: durationTicks,
        velocity: ev.velocity,         // dinamica suonata → playback espressivo + export MIDI
        clef,
        voice: 0 as any,
      } satisfies import('../types').StaffNote;
    });
}

/** Aggancia un gruppo di note reali alla griglia (DURA, pulita) SENZA tassellare
 *  con le pause — quel passo (normalizeRhythm) va fatto a parte sull'insieme
 *  completo. Funziona sia per griglie binarie (480 = ottavo) sia di TERZINA
 *  (320 = ottavo terzinato): beatsToDurationFlags deduce l'etichetta giusta dalla
 *  durata agganciata. */
function gridSnapAccNotes(
    notes: import('../types').StaffNote[],
    gridTicks: number,
    ticksPerMeasure: number,
): import('../types').StaffNote[] {
    // 1) Aggancia gli ONSET alla griglia e azzera i flag terzina/duina residui
    //    (assegnati dalla conversione in base alla durata suonata) così l'estensione
    //    non li salta e la griglia scelta è l'unica a decidere.
    const snapped = notes.map(n => ({
        ...n,
        startTick: Math.round((n.startTick ?? 0) / gridTicks) * gridTicks,
        isTriplet: false,
        isDuplet: false,
    }));
    // 2) ESTENDI ogni nota fino all'attacco successivo (legato): assorbe i gap di
    //    staccato (semiminima corta → semiminima piena). I gap reali > 1/4 restano pause.
    const extended = extendNotesToNextOnset(snapped, ticksPerMeasure);
    // 3) Aggancia le DURATE alla griglia e ricalcola l'etichetta (terzina/puntato/…).
    return extended.map(n => {
        const dur = Math.max(gridTicks, Math.round((n.durationTicks ?? gridTicks) / gridTicks) * gridTicks);
        const f = beatsToDurationFlags(dur / TICKS_PER_QUARTER);
        return { ...n, durationTicks: dur, duration: f.duration, isDotted: f.isDotted, isTriplet: f.isTriplet, isDuplet: f.isDuplet };
    });
}

/** Quantizzazione completa di note ACC reali a una griglia: snap + trim + pause.
 *  `notes` = solo note reali (le pause vengono rigenerate). */
function normalizeRecordedAccNotes(
    notes: import('../types').StaffNote[],
    timeSignature: { numerator: number; denominator: number },
    gridTicks: number,
): import('../types').StaffNote[] {
    if (notes.length === 0) return [];
    const ticksPerMeasure = TICKS_PER_QUARTER * timeSignature.numerator * (4 / timeSignature.denominator);
    const gridded = gridSnapAccNotes(notes, gridTicks, ticksPerMeasure);
    const trimmed = trimOverlappingNotes(gridded);
    return normalizeRhythm(trimmed, timeSignature, []);
}

const GrandStaffEditor: React.FC<GrandStaffEditorProps> = ({
    isActive,
    audioService,
    isAudioReady,
    pendingMenuAction,
    onConsumePendingMenuAction,
}) => {

    const measureGridStepRef = useRef<Map<number, number>>(new Map());

    // Unified undo/redo order tracker: records which stack ('satb' | 'acc') was
    // last modified so Cmd+Z/Cmd+Shift+Z can advance only the relevant stack.
    const undoOrderRef = useRef<Array<'satb' | 'acc'>>([]);
    const redoOrderRef = useRef<Array<'satb' | 'acc'>>([]);

    const [rawNotes, setRawNotes, undoNotes, redoNotes, satbPushCount] = useUndoableState<StaffNote[]>([]);
    const latestRawNotes = useRef(rawNotes);

    // Mantieni latestRawNotes aggiornato
    useEffect(() => {
        latestRawNotes.current = rawNotes;
    }, [rawNotes]);

    // Tracce di accompagnamento (piano, chitarra, ecc.). Separate dal SATB:
    // non sono soggette ad analisi armonica né a voice-leading checker.
    const [accompanimentTracks, setAccompanimentTracks, undoAccompanimentTracks, redoAccompanimentTracks, accPushCount] = useUndoableState<AccompanimentTrack[]>([]);
    const latestAccompanimentTracks = useRef(accompanimentTracks);
    useEffect(() => {
        latestAccompanimentTracks.current = accompanimentTracks;
    }, [accompanimentTracks]);

    // Reliable undo-order tracking via pushCount: useLayoutEffect fires
    // synchronously after React commits state, so pushCount is already the new
    // value when the effect runs. This avoids the React-18 batching bug where
    // callbacks set inside functional updaters may be called before the state
    // actually commits.
    useLayoutEffect(() => {
        if (satbPushCount === 0) return; // skip initial mount
        undoOrderRef.current.push('satb');
        redoOrderRef.current = [];
    }, [satbPushCount]); // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
        if (accPushCount === 0) return; // skip initial mount
        undoOrderRef.current.push('acc');
        redoOrderRef.current = [];
    }, [accPushCount]); // eslint-disable-line react-hooks/exhaustive-deps

    const [isMixerOpen, setIsMixerOpen] = useState(false);

    // Visibilità del rigo SATB (a 4 voci). Come per le tracce ACC, è SOLO display:
    // nasconde il pentagramma SATB (i righi ACC salgono in cima), ma l'audio
    // continua (per silenziarlo si usa il Mute nel mixer). Lo shift di clip in px
    // corrisponde all'altezza del blocco SATB sopra gli ACC (ACC treble 310 → 40).
    const [satbVisible, setSatbVisible] = useState(true);
    // Custom name for the SATB group (like ACC track names). Empty = no staff label.
    const [satbName, setSatbName] = useState('');
    const SATB_HIDE_SHIFT_PX = (VF_BASS_Y + 4 * VF_LINE_SPACING + 100) - VF_TREBLE_Y; // 270

    // Per-track gain nodes for real-time mute/volume control without restarting playback.
    // Index = position in accompanimentTracks; each gain node persists and is connected
    // to audioContext.destination. Notes from playback route THROUGH this gain node, so
    // changing .gain.value here affects all currently-playing AND future-scheduled notes.
    const accTrackGainsRef = useRef<Map<number, GainNode>>(new Map());

    // Per-channel analyser nodes feeding the mixer's signal LEDs. Created lazily
    // alongside the gain nodes (gain → analyser tap; the analyser is not connected
    // onward, so it only measures and adds no audible path). Keyed identically to
    // the gain maps (voice number / accompaniment-track index).
    const accTrackAnalysersRef = useRef<Map<number, AnalyserNode>>(new Map());
    const voiceAnalysersRef = useRef<Map<number, AnalyserNode>>(new Map());
    const meterScratchRef = useRef<Uint8Array>(new Uint8Array(256));
    // Instantaneous output peak (0..1) of an analyser, from its time-domain data.
    const readAnalyserPeak = useCallback((an: AnalyserNode | undefined): number => {
        if (!an) return 0;
        if (meterScratchRef.current.length < an.fftSize) meterScratchRef.current = new Uint8Array(an.fftSize);
        const buf = meterScratchRef.current;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < an.fftSize; i++) {
            const v = Math.abs(buf[i] - 128) / 128;
            if (v > peak) peak = v;
        }
        return peak;
    }, []);
    const getVoiceLevel = useCallback((voice: number) => readAnalyserPeak(voiceAnalysersRef.current.get(voice)), [readAnalyserPeak]);
    const getTrackLevel = useCallback((trackIndex: number) => readAnalyserPeak(accTrackAnalysersRef.current.get(trackIndex)), [readAnalyserPeak]);

    // Re-apply the correct gain to EVERY live voice/track gain node based on the
    // current mute/solo/volume state. Needed because playback pre-schedules all
    // notes upfront: per-channel handlers only touch their own gain, so toggling
    // SOLO (which silences *other* channels) wouldn't take effect mid-playback
    // without this. Reads refs only, so it sees values updated synchronously by
    // the callers below.
    const refreshAudibilityGains = useCallback(() => {
        const anySolo = soloVoicesRef.current.size > 0 || latestAccompanimentTracks.current.some(t => t.solo);
        voiceGainsRef.current.forEach((gain, v) => {
            const audible = (!anySolo || soloVoicesRef.current.has(v)) && !mutedVoicesRef.current.has(v);
            gain.gain.value = audible ? (voiceVolumesRef.current[v] ?? 1) : 0;
        });
        accTrackGainsRef.current.forEach((gain, idx) => {
            const track = latestAccompanimentTracks.current[idx];
            if (!track) return;
            const audible = (!anySolo || !!track.solo) && !track.muted;
            gain.gain.value = audible ? track.volume : 0;
        });
    }, []);

    const handleUpdateTrack = useCallback((trackId: string, updates: Partial<AccompanimentTrack>) => {
        // Track config changes (volume, mute, visibility, name, instrument) must NOT
        // go through the undo history: a single volume slider drag fires many events
        // per second, and JSON.stringify on the full state would freeze the UI and
        // disrupt audio playback. Use the silent setter to update state in place.
        setAccompanimentTracks(prev => {
            const next = prev.map(t => t.id === trackId ? { ...t, ...updates } : t);
            latestAccompanimentTracks.current = next;
            // Re-apply audibility to ALL channels so mute/solo/volume take effect in
            // real-time (solo on one track must silence the others, voices included).
            refreshAudibilityGains();
            return next;
        }, { undoable: false });
    }, [refreshAudibilityGains]);

    // Per-voice mixer update (volume / mute), twin of handleUpdateTrack.
    // Applies the change live to the voice gain node so it takes effect immediately,
    // even on notes already scheduled in the Web Audio queue.
    const handleUpdateVoice = useCallback((voice: number, updates: { volume?: number; muted?: boolean }) => {
        // Update the refs synchronously so refreshAudibilityGains() (which reads
        // refs) sees the new values immediately; the state setters keep React in sync.
        if (updates.volume !== undefined) {
            voiceVolumesRef.current = { ...voiceVolumesRef.current, [voice]: updates.volume };
            setVoiceVolumes(prev => ({ ...prev, [voice]: updates.volume! }));
        }
        if (updates.muted !== undefined) {
            const next = new Set(mutedVoicesRef.current);
            if (updates.muted) next.add(voice); else next.delete(voice);
            mutedVoicesRef.current = next;
            setMutedVoices(next);
        }
        refreshAudibilityGains();
    }, [refreshAudibilityGains]);

    // Toggle solo for a SATB voice with real-time effect during playback.
    const handleToggleVoiceSolo = useCallback((voice: number) => {
        const next = new Set(soloVoicesRef.current);
        if (next.has(voice)) next.delete(voice); else next.add(voice);
        soloVoicesRef.current = next;
        setSoloVoices(next);
        refreshAudibilityGains();
    }, [refreshAudibilityGains]);

    // Unified mute/solo audibility across SATB voices and ACC tracks.
    // If anything is soloed anywhere, only soloed channels sound; mute always silences.
    const anyChannelSoloed = useCallback(() =>
        soloVoicesRef.current.size > 0 || latestAccompanimentTracks.current.some(t => t.solo),
    []);
    const isVoiceAudible = useCallback((voice: number) =>
        (!anyChannelSoloed() || soloVoicesRef.current.has(voice)) && !mutedVoicesRef.current.has(voice),
    [anyChannelSoloed]);
    const isTrackAudible = useCallback((track: AccompanimentTrack) =>
        (!anyChannelSoloed() || !!track.solo) && !track.muted,
    [anyChannelSoloed]);

    const handleDeleteTrack = useCallback((trackId: string) => {
        setAccompanimentTracks(prev => {
            const next = prev.filter(t => t.id !== trackId);
            latestAccompanimentTracks.current = next;
            return next;
        });
    }, []);

    const handleAddEmptyTrack = useCallback(() => {
        setAccompanimentTracks(prev => {
            const index = (prev || []).length + 1;
            const newTrack: AccompanimentTrack = {
                id: crypto.randomUUID(),
                name: `Traccia ${index}`,
                instrumentId: 0, // Acoustic Grand Piano
                notes: [],
                muted: false,
                visible: true,
                volume: 0.8,
                // New tracks default to a single instrumental staff in treble clef
                // (one grandstaff/keyboard is usually enough; extra tracks are lines).
                staffMode: 'treble_only',
                clef: 'treble',
            };
            const next = [...(prev || []), newTrack];
            latestAccompanimentTracks.current = next;
            return next;
        });
    }, []);
    // ...existing code...
    // copyPasteError now owned by useNoteSelection
    const [timeSignature, setTimeSignature] = useState<TimeSignature>({ numerator: 4, denominator: 4 });
    const [timeSignatureChanges, setTimeSignatureChanges] = useState<TimeSignatureChange[]>([]);
    const {
        selectedNoteIds, setSelectedNoteIds, latestSelectedNoteIds,
        clipboard, setClipboard, latestClipboardRef,
        pasteToSelectedVoiceRef, skipPlayheadRefineOnceRef,
        copyPasteError, setCopyPasteError,
        pasteCaret, setPasteCaret, pasteMarker, setPasteMarker,
        latestPasteCaretRef, setPasteCaretImmediate,
        selectionRect, setSelectionRect,
        handleCopy,
        selectedNotesBeamState, handleToggleBeamGroup,
        handleToggleTie, handleDeselectOnClickOutside,
    } = useNoteSelection({ rawNotes, setRawNotes, timeSignature, timeSignatureChanges });
    const [keySignatureRoot, setKeySignatureRoot] = useState('C');
    const [projectTitle, setProjectTitle] = useState<string>('');
    const [titleFontSize, setTitleFontSize] = useState<number>(18);
    const [titleFontFamily, setTitleFontFamily] = useState<string>('serif');
    const [keyChangeMode, setKeyChangeMode] = useState<'none' | 'transpose' | 'modal'>('none');
    const [modalTonicOverride, setModalTonicOverride] = useState<string>('');
    const [isMinorMode, setIsMinorMode] = useState(false);
    const [autoLeadingToneInMinor, setAutoLeadingToneInMinor] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>('page');
    const [canvasFormat, setCanvasFormat] = useState<CanvasFormat>('landscape');
    const [measuresPerLine, setMeasuresPerLine] = useState<number>(4);
    const [minMeasureCount, setMinMeasureCount] = useState<number>(4);
    const [minMeasureCountDraft, setMinMeasureCountDraft] = useState<string>('4');
    // Griglia di quantizzazione: chiave di QUANTIZE_GRID_MAP (binaria o di terzina).
    const [quantizeGrid, setQuantizeGrid] = useState<string>('sixteenth');
    const [measuresPerLineDraft, setMeasuresPerLineDraft] = useState<string>('4');
    const [doubleBarlineMeasures, setDoubleBarlineMeasures] = useState<number[]>([]);
    const [ornamentOverrides, setOrnamentOverrides] = useState<OrnamentOverride[]>([]);
    const [analysisLocked, setAnalysisLocked] = useState<boolean>(false);
    const [teacherPasswordHash, setTeacherPasswordHash] = useState<string | undefined>(undefined);
    const [analysisLockOptions, setAnalysisLockOptions] = useState<AnalysisLockOptions>(DEFAULT_ANALYSIS_LOCK_OPTIONS);
    const [isAnalysisLockModalOpen, setIsAnalysisLockModalOpen] = useState<boolean>(false);
    // Session-only unlock: teacher entered password to view analysis without modifying the file.
    // Reset on every file open / new — never persisted.
    const [sessionUnlocked, setSessionUnlocked] = useState<boolean>(false);

    // Effective lock = file is locked AND not unlocked for this session.
    const lockActive = analysisLocked && !sessionUnlocked;
    const lockHides = {
        violations:    lockActive && (analysisLockOptions?.hideViolations   ?? true),
        romanLabels:   lockActive && (analysisLockOptions?.hideRomanLabels  ?? false),
        chordSymbols:  lockActive && (analysisLockOptions?.hideChordSymbols ?? false),
        ornaments:     lockActive && (analysisLockOptions?.hideOrnaments    ?? false),
        alternatives:  lockActive && (analysisLockOptions?.hideAlternatives ?? false),
        export:        lockActive && (analysisLockOptions?.disableExport    ?? true),
    };
    // Ref mirror so callbacks (handleMenuActionLegacy, keydown handlers) always
    // see the latest lock state without re-creating on every dep change.
    const lockHidesRef = useRef(lockHides);
    lockHidesRef.current = lockHides;
    const [repeatBarlines, setRepeatBarlines] = useState<Record<number, 'repeat-begin' | 'repeat-end' | 'repeat-both'>>({});
    const repeatBarlinesRef = useRef(repeatBarlines);
    repeatBarlinesRef.current = repeatBarlines;
    const [voltaBrackets, setVoltaBrackets] = useState<VoltaBracket[]>([]);
    // Rallentando / accelerando — playback-only tempo curves on selected note ranges.
    const [tempoCurves, setTempoCurves] = useState<TempoCurve[]>([]);
    const tempoCurvesRef = useRef(tempoCurves);
    tempoCurvesRef.current = tempoCurves;
    // Pending tempo-curve dialog state. When set, an inline modal appears with
    // two BPM inputs; user confirms to create the curve, or cancels to dismiss.
    const [tempoCurvePending, setTempoCurvePending] = useState<{
        startNoteId: string;
        endNoteId: string;
        defaultFromBpm: number;
        defaultToBpm: number;
    } | null>(null);
    const [tool, setTool] = useState<Tool>('insert');
    const [selectedInsertion, setSelectedInsertion] = useState<InsertionElement>({ type: 'note', duration: 'quarter', isDotted: false });
    const selectedInsertionRef = useRef(selectedInsertion);
    useEffect(() => { selectedInsertionRef.current = selectedInsertion; }, [selectedInsertion]);

    const isDotted = !!selectedInsertion.isDotted;

    // One-shot behavior knobs:
    // - If armed from HOTKEY: auto-disarm after the next insertion.
    // - If armed from TOOLBAR: persist until manually toggled off.
    const dottedOneShotRef = useRef<boolean>(false);
    const accidentalOneShotRef = useRef<boolean>(false);
    /** Tracks whether a note was just auto-selected after insertion.
     *  When true, changing duration from toolbar/hotkey will NOT retroactively
     *  modify the selected note — it only updates the insertion state. */
    const justInsertedNoteRef = useRef<string | null>(null);
    /** Maps expanded playback beats → visual (original) beats for repeat expansion. null = identity. */
    const playbackBeatToVisualBeatRef = useRef<((expandedBeat: number) => number) | null>(null);
    // Inverse of beatToTime() — maps elapsed seconds (since start) to abs beat,
    // accounting for any active tempo curves. Set inside startPlayback; null means
    // linear mapping at the current global BPM (default).
    const playbackTimeToBeatRef = useRef<((elapsedSec: number) => number) | null>(null);
    const [isTriplet, setIsTriplet] = useState(false);
    const [isDuplet, setIsDuplet] = useState(false);
    const [tupletNoteCount, setTupletNoteCount] = useState(0);
    const [tripletBaseDuration, setTripletBaseDuration] = useState<NoteDuration | null>(null);
    const [activeAccidental, setActiveAccidental] = useState<AccidentalType | null>(null);
    // Keyboard repeats / rapid double-presses can arrive before React state commits.
    // Keep an immediate ref so `bb` / `##` reliably becomes double-flat/double-sharp.
    const activeAccidentalRef = useRef<AccidentalType | null>(null);
    useEffect(() => { activeAccidentalRef.current = activeAccidental; }, [activeAccidental]);
    const [selectedVoice, setSelectedVoice] = useState<Voice>(1);
    const [soloVoices, setSoloVoices] = useState<Set<number>>(new Set());
    const [voiceInstruments, setVoiceInstruments] = useState<Record<number, string>>({
        1: 'acoustic_grand_piano', 2: 'acoustic_grand_piano',
        3: 'acoustic_grand_piano', 4: 'acoustic_grand_piano',
    });
    // Per-voice volume (0-1) and mute, mirroring the accompaniment track mixer model.
    const [voiceVolumes, setVoiceVolumes] = useState<Record<number, number>>({ 1: 1, 2: 1, 3: 1, 4: 1 });
    const [mutedVoices, setMutedVoices] = useState<Set<number>>(new Set());
    const [activeTab, setActiveTab] = useState<ActiveTab>('editor');
    const [hoveredViolationNotes, setHoveredViolationNotes] = useState<string[] | null>(null);
    const [selectedViolationIndex, setSelectedViolationIndex] = useState<number | null>(null);
    const staffContainerRef = useRef<HTMLDivElement>(null);
    const scoreScrollRef = useRef<HTMLDivElement>(null);
    const systemElementByIndexRef = useRef<Map<number, HTMLDivElement>>(new Map());
    const measureToSystemIndexRef = useRef<Map<number, number>>(new Map());
    const noteToSystemIndexRef = useRef<Map<string, number>>(new Map());
    const [containerWidth, setContainerWidth] = useState(1000);
    const bpmControlRef = useRef<HTMLDivElement>(null);
    const bpmInputRef = useRef<HTMLInputElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const {
        isPlaying, setIsPlaying, bpm, setBpm,
        isBpmActive, setIsBpmActive, isBpmActiveRef,
        playingNoteIds, setPlayingNoteIds,
        playheadPosition, setPlayheadPosition,
        playbackCursorAbsBeatRef, playbackTimeoutsRef,
        playbackStartBeatRef, audioPlaybackStartTimeRef,
        isMetronomeOn, setIsMetronomeOn,
        metronomeUnit, setMetronomeUnit,
        metronomeFlash, setMetronomeFlash,
        metronomeIntervalRef, metronomeBeatRef, metronomeNextWhenRef,
        metronomeSuppressedRef, metronomeLinkedToPlaybackRef,
        isMetronomeOnRef, isPlayingRef,
        isLooping, setIsLooping, loopRange, setLoopRange,
        isLoopingRef, loopRangeRef,
        bpmInputString, setBpmInputString,
        metronomeFlashStartTimeoutRef, metronomeFlashTimeoutRef,
        stopMetronomeInternal, commitBpmFromString, activateBpmEdit,
        handleBpmFocus, handleBpmKeyDown, handleBpmInputChange,
        handleBpmInputKeyDown, handleBpmBlur, toggleMetronome,
        startMetronomeScheduler, stopPlayback,
        isSwing, setIsSwing,
        midiOutputs, setMidiOutputs,
        selectedMidiOutput, setSelectedMidiOutput,
        isMidiMenuOpen, setIsMidiMenuOpen,
        handleActivateMidi,
    } = usePlayback({ bpmInputRef, audioService, isAudioReady, timeSignature, timeSignatureChanges, animationFrameRef });
    const playheadPositionRef = useRef<{ x: number; systemIndex: number } | null>(null);
    useEffect(() => { playheadPositionRef.current = playheadPosition; }, [playheadPosition]);
    const [ghostNote, setGhostNote] = useState<(StaffNote & { systemIndex: number }) | null>(null);

    // Chord insert mode
    const [chordInsertMode, setChordInsertMode] = useState(false);
    const chordInsertModeRef = useRef(false);
    useEffect(() => { chordInsertModeRef.current = chordInsertMode; }, [chordInsertMode]);
    const [chordInputText, setChordInputText] = useState('');
    const [chordInputError, setChordInputError] = useState(false);
    // Tracks which staff area was last clicked, to route chord insert to SATB or ACC
    const [activeStaffArea, setActiveStaffArea] = useState<'satb' | 'accompaniment'>('satb');
    const activeStaffAreaRef = useRef<'satb' | 'accompaniment'>('satb');
    useEffect(() => { activeStaffAreaRef.current = activeStaffArea; }, [activeStaffArea]);
    // Active accompaniment track: the last ACC staff clicked/edited. Used as the target
    // for paste and (future) recording, so they go to the track you're working on —
    // not always the first. Falls back to the first visible track when unset.
    const activeAccTrackIdRef = useRef<string | null>(null);
    // Resolve the ACC track to target (monitoring / recording / quantize): the one
    // you last clicked (activeAccTrackIdRef) if it's still visible, else the first
    // visible track. Returns the INDEX in the tracks array (-1 if none visible).
    const resolveActiveAccIdx = useCallback((tracks: AccompanimentTrack[]): number => {
        const id = activeAccTrackIdRef.current;
        if (id) {
            const i = tracks.findIndex(t => t.id === id && t.visible);
            if (i !== -1) return i;
        }
        return tracks.findIndex(t => t.visible);
    }, []);
    // Pattern for ACC chord insertion (ignored for SATB).
    const [accPattern, setAccPattern] = useState<AccompanimentPattern>('block');
    const accPatternRef = useRef<AccompanimentPattern>('block');
    useEffect(() => { accPatternRef.current = accPattern; }, [accPattern]);
    // accLetRing: ring automatico per i PATTERN (arpeggi) all'inserimento. Il pedale
    // manuale è ora un'azione su selezione (handleToggleAccHold), non un toggle globale.
    const [accLetRing] = useState(false);
    const accLetRingRef = useRef(false);
    useEffect(() => { accLetRingRef.current = accLetRing; }, [accLetRing]);

    // ── Pedale (let ring) SU SELEZIONE ──
    // Modello "pedale" vero: le note ACC selezionate risuonano INSIEME (sovrapposte)
    // fino al prossimo attacco DOPO la selezione, nella loro chiave (o fine misura se
    // sono le ultime). È solo-playback (playbackDurationTicks), non tocca la notazione.
    // Ri-cliccare con la stessa selezione "tenuta" rimuove il pedale.

    // True se TUTTE le note ACC reali selezionate sono attualmente "tenute" (per highlight).
    const accSelectionHeld = useMemo(() => {
        if (selectedNoteIds.size === 0) return false;
        const selReal = (accompanimentTracks || []).flatMap(t => t.notes)
            .filter(n => selectedNoteIds.has(n.id) && !n.isRest);
        if (selReal.length === 0) return false;
        // .some: l'ULTIMA nota della selezione non viene estesa (finisce già al rilascio),
        // quindi "tenuto" = almeno una nota selezionata risuona oltre la sua durata.
        return selReal.some(n => typeof (n as any).playbackDurationTicks === 'number'
            && (n as any).playbackDurationTicks > (n.durationTicks ?? 0));
    }, [selectedNoteIds, accompanimentTracks]);

    const handleToggleAccHold = useCallback(() => {
        if (selectedNoteIds.size === 0) return;
        const ticksPerMeasure = TICKS_PER_QUARTER * timeSignature.numerator * (4 / timeSignature.denominator);
        setAccompanimentTracks(prev => prev.map(track => {
            const selReal = track.notes.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
            if (selReal.length === 0) return track;
            const someHeld = selReal.some(n => typeof (n as any).playbackDurationTicks === 'number'
                && (n as any).playbackDurationTicks > (n.durationTicks ?? 0));
            if (someHeld) {
                // Toggle OFF: rimuovi il pedale dalle note selezionate.
                return { ...track, notes: track.notes.map(n => {
                    if (!selectedNoteIds.has(n.id)) return n;
                    const { playbackDurationTicks: _d, ...rest } = n as any;
                    return rest as StaffNote;
                }) };
            }
            // Toggle ON: per chiave, rilascio = primo attacco DOPO l'ultima nota
            // selezionata in quella chiave (o fine misura se non ce ne sono).
            const releaseByClef = new Map<string, number>();
            const maxSelOnsetByClef = new Map<string, number>();
            for (const n of selReal) {
                const c = (n.clef ?? 'treble') as string;
                maxSelOnsetByClef.set(c, Math.max(maxSelOnsetByClef.get(c) ?? 0, (n as any).startTick ?? 0));
            }
            for (const [c, maxOnset] of maxSelOnsetByClef) {
                let release = Infinity;
                for (const n of track.notes) {
                    if ((n.clef ?? 'treble') !== c) continue;
                    const s = (n as any).startTick ?? 0;
                    if (s > maxOnset && s < release) release = s;
                }
                if (!Number.isFinite(release)) release = (Math.floor(maxOnset / ticksPerMeasure) + 1) * ticksPerMeasure;
                releaseByClef.set(c, release);
            }
            return { ...track, notes: track.notes.map(n => {
                if (!selectedNoteIds.has(n.id) || n.isRest) return n;
                const release = releaseByClef.get((n.clef ?? 'treble') as string);
                if (release == null) return n;
                const ring = release - ((n as any).startTick ?? 0);
                return ring > (n.durationTicks ?? 0) ? { ...n, playbackDurationTicks: ring } as StaffNote : n;
            }) };
        }));
    }, [selectedNoteIds, timeSignature, setAccompanimentTracks]);


    // Stable ref to playNote — updated after playNote is defined (avoids TDZ in handleChordInsert)
    const playNoteRef = useRef<((note: StaffNote, durationSec?: number) => Promise<void>) | null>(null);

    const project = useMemo(() => ({
        notes: rawNotes,
        timeSignature,
        timeSignatureChanges,
        keySignatureRoot,
        isMinorMode,
        bpm,
    }), [rawNotes, timeSignature, timeSignatureChanges, keySignatureRoot, isMinorMode, bpm]);

    const setProject = useCallback((next: Partial<typeof project> & { notes: StaffNote[] }) => {
        setRawNotes(next.notes || []);
        if (next.timeSignature) setTimeSignature(next.timeSignature);
        if (next.timeSignatureChanges) setTimeSignatureChanges(next.timeSignatureChanges);
        if (typeof next.bpm === 'number' && Number.isFinite(next.bpm)) setBpm(Math.max(20, Math.min(300, Math.round(next.bpm))));

        try {
            const maxIdx = (next.notes || []).reduce((mx, n) => Math.max(mx, Number.isFinite(n?.measureIndex as any) ? Number(n?.measureIndex) : -1), -1);
            const measuresCount = Math.max(1, maxIdx + 1);
            setMinMeasureCount(measuresCount);
            setMinMeasureCountDraft(String(measuresCount));
        } catch {
            // ignore
        }
    }, [setRawNotes, setTimeSignature, setTimeSignatureChanges, setBpm, setMinMeasureCount, setMinMeasureCountDraft]);

    const { exportMidi, importMidi, importMidiAsAccompaniment, pickMidiFile } = useGrandStaffMidi({
        project,
        setProject,
    });

    // MIDI import destination dialog. The resolver lets the async menu handler
    // await the user's choice between SATB / Accompaniment / Cancel.
    type MidiImportChoice = 'satb' | 'accompaniment' | null;
    const [midiImportDialogOpen, setMidiImportDialogOpen] = useState(false);
    const midiImportResolverRef = useRef<((choice: MidiImportChoice) => void) | null>(null);
    const askMidiImportDestination = useCallback((): Promise<MidiImportChoice> => {
        return new Promise<MidiImportChoice>((resolve) => {
            midiImportResolverRef.current = resolve;
            setMidiImportDialogOpen(true);
        });
    }, []);
    const resolveMidiImportChoice = useCallback((choice: MidiImportChoice) => {
        const r = midiImportResolverRef.current;
        midiImportResolverRef.current = null;
        setMidiImportDialogOpen(false);
        if (r) r(choice);
    }, []);

    // ── MIDI step-input hook ──
    const insertNoteFromMidiRef = useRef<(midi: number) => void>(() => {});
    const midiStepInput = useMidiStepInput({
        onNoteOn: (midi) => insertNoteFromMidiRef.current(midi),
    });

    // ── Registrazione MIDI real-time ──────────────────────────────────────────
    const {
        isRecording,
        isCountingIn,
        startRecording,
        stopRecording,
        recordingDurationBeats,
        getElapsedBeats,
    } = useRealtimeRecording({
        bpm,
        timeSignature,
        audioService,
    });

    // ── Passthrough audio MIDI sempre attivo ─────────────────────────────────
    // Ascolta su tutti gli input MIDI e suona ogni nota premuta, indipendentemente
    // da REC o step-input. Il listener si registra una volta e si aggiorna se
    // cambiano i dispositivi.
    //
    // Comportamento:
    //   • selectedMidiOutput === null  → riproduce piano interno (Web Audio)
    //   • selectedMidiOutput !== null  → NON riproduce audio interno; l'utente
    //     monitora direttamente dalla DAW. I messaggi CC (es. sustain pedal)
    //     vengono inoltrati all'uscita MIDI per evitare note bloccate.
    const selectedMidiOutputRef = useRef(selectedMidiOutput);
    useEffect(() => { selectedMidiOutputRef.current = selectedMidiOutput; }, [selectedMidiOutput]);

    // Note tenute (note-on→note-off) attive per il monitoraggio attraverso traccia.
    const monitorHandlesRef = useRef<Map<number, SustainHandle>>(new Map());

    const playMidiPassthrough = useCallback((midi: number, velocity?: number) => {
        // Se è attivo un output MIDI esterno non suonare il piano interno
        if (selectedMidiOutputRef.current) return;
        const noteNamesWithFlats = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
        const name = `${noteNamesWithFlats[midi % 12]}${Math.floor(midi / 12) - 1}`;

        // Quando si lavora su una traccia ACC (in registrazione OPPURE con l'area
        // accompagnamento attiva), monitora con LO STESSO strumento, volume, gain
        // della traccia, inviluppo E DURATA REALE (nota tenuta: parte sul note-on,
        // si ferma sul note-off) che la nota avrà in playback → live e registrato
        // coincidono esattamente (livello e durata). I LED si accendono in INGRESSO
        // anche senza registrare.
        const accActive = isRecording || activeStaffAreaRef.current === 'accompaniment';
        if (accActive && audioService.audioContext) {
            const idx = resolveActiveAccIdx(latestAccompanimentTracks.current);
            if (idx !== -1) {
                const track = latestAccompanimentTracks.current[idx];
                let trackGain = accTrackGainsRef.current.get(idx);
                if (!trackGain) {
                    trackGain = audioService.audioContext.createGain();
                    trackGain.connect(audioService.audioContext.destination);
                    accTrackGainsRef.current.set(idx, trackGain);
                    const an = audioService.audioContext.createAnalyser();
                    an.fftSize = 256;
                    trackGain.connect(an);
                    accTrackAnalysersRef.current.set(idx, an);
                }
                trackGain.gain.value = track.muted ? 0 : track.volume;
                // Taglia velocemente QUALSIASI istanza precedente di questa nota — sia
                // tenuta sia ancora in coda di rilascio dopo il note-off — così la nuova
                // nota non si sovrappone a una copia identica del campione (comb/"scatto").
                monitorHandlesRef.current.get(midi)?.release(0.02);
                const handle = audioService.playSustainedNote(
                    gmToSoundfont(track.instrumentId), name,
                    { volume: velocityToGain(velocity), output: trackGain, velocity },
                );
                monitorHandlesRef.current.set(midi, handle);
                return;
            }
        }

        // Monitoraggio area SATB / nessuna traccia ACC: stesso piano (Salamander) e
        // stesso comportamento dell'ACC — nota tenuta con taglio anti-comb sulla
        // ri-pressione — così SATB e ACC suonano identici.
        monitorHandlesRef.current.get(midi)?.release(0.02);
        const handle = audioService.playSustainedNote('acoustic_grand_piano', name, { volume: velocityToGain(velocity), velocity });
        monitorHandlesRef.current.set(midi, handle);
    }, [audioService, isRecording, resolveActiveAccIdx]);
    const playMidiPassthroughRef = useRef(playMidiPassthrough);
    useEffect(() => { playMidiPassthroughRef.current = playMidiPassthrough; }, [playMidiPassthrough]);

    // Rilascio del monitoraggio tenuto sul note-off (rilascio naturale 0.5s).
    // NON rimuoviamo il riferimento: la nota resta in coda di rilascio per ~0.5s e,
    // se il tasto viene ripremuto in quella finestra, il note-on qui sopra la taglia
    // velocemente per evitare la sovrapposizione di due copie identiche (comb/scatto).
    // Il riferimento viene comunque sovrascritto alla pressione successiva.
    const releaseMidiPassthrough = useCallback((midi: number) => {
        monitorHandlesRef.current.get(midi)?.release();
    }, []);
    const releaseMidiPassthroughRef = useRef(releaseMidiPassthrough);
    useEffect(() => { releaseMidiPassthroughRef.current = releaseMidiPassthrough; }, [releaseMidiPassthrough]);

    useEffect(() => {
        if (!navigator.requestMIDIAccess) return;
        let midiAccess: MIDIAccess | null = null;
        let cleanup: (() => void) | null = null;

        const handleMessage = (e: Event) => {
            const msg = e as MIDIMessageEvent;
            const data = msg.data;
            if (!data || data.length < 3) return;
            const [status, note, velocity] = data;
            const currentOutput = selectedMidiOutputRef.current;
            // Quando è attivo un output MIDI, inoltra i messaggi CC (es. sustain
            // pedal CC64) in modo che il synth esterno li riceva correttamente.
            if (currentOutput && (status & 0xf0) === 0xB0) {
                try { currentOutput.send([status, note, velocity]); } catch (_) {}
                return;
            }
            if ((status & 0xf0) === 0x90 && velocity > 0) {
                playMidiPassthroughRef.current(note, velocity);
            } else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0)) {
                // note-off: rilascia la nota tenuta del monitoraggio
                releaseMidiPassthroughRef.current(note);
            }
        };

        const attachListeners = (access: MIDIAccess) => {
            const inputs: MIDIInput[] = [];
            access.inputs.forEach(input => {
                input.addEventListener('midimessage', handleMessage as EventListener);
                inputs.push(input);
            });
            return () => inputs.forEach(i => i.removeEventListener('midimessage', handleMessage as EventListener));
        };

        navigator.requestMIDIAccess().then(access => {
            midiAccess = access;
            let detachCurrent = attachListeners(access);
            const onStateChange = () => {
                detachCurrent();
                detachCurrent = attachListeners(access);
            };
            access.addEventListener('statechange', onStateChange);
            cleanup = () => {
                detachCurrent();
                access.removeEventListener('statechange', onStateChange);
            };
        }).catch(() => { /* MIDI non disponibile */ });

        return () => { cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stepInputWasEnabledRef = React.useRef(false);
    // Refs aggiornati a ogni render per evitare temporal-dead-zone nei useCallback
    const playheadMeasureForRecRef = React.useRef<number>(0);
    const keySignatureForRecRef = React.useRef<import('../types').KeySignature | null>(null);
    const recStartAbsBeatRef = React.useRef<number>(0);
    // Misura di partenza catturata UNA SOLA VOLTA al click REC (non cambia durante la registrazione)
    const recStartMeasureRef = React.useRef<number>(0);

    // (La playhead durante REC è aggiornata dopo getPlayheadPosForAbsBeat — vedi sotto)

    // true = REC button premuto, in attesa di Space per avviare
    const [isRecArmed, setIsRecArmed] = React.useState(false);

    /** Elabora gli eventi raw e li inserisce nella prima traccia ACC visibile. */
    const processAndInsertRecordedEvents = React.useCallback((rawEvents: import('../hooks/useRealtimeRecording').RawRecordedEvent[]) => {
        if (rawEvents.length > 0 && keySignatureForRecRef.current) {
            const notes = convertRecordedEventsToNotes(
                rawEvents,
                bpm,
                timeSignature,
                recStartMeasureRef.current,
                keySignatureForRecRef.current,
            );
            setAccompanimentTracks(prev => {
                const firstVisibleIdx = resolveActiveAccIdx(prev);
                if (firstVisibleIdx === -1) return prev;
                return prev.map((track, i) => {
                    if (i !== firstVisibleIdx) return track;
                    // Quantizzazione pulita di default a griglia di OTTAVO. Re-quantizza
                    // l'INTERA traccia (esistenti + nuove) insieme, ripartendo dai tick
                    // raw, così due registrazioni successive non producono flussi di
                    // pause sovrapposti. Per terzine o risoluzioni diverse si usa la Q
                    // con la griglia adatta (anche su selezione).
                    const existingReal = (track.notes ?? [])
                        .filter(n => !n.isRest)
                        .map(n => ({ ...n, startTick: n.rawStartTick ?? n.startTick, durationTicks: n.rawDurationTicks ?? n.durationTicks }));
                    const allReal = [...existingReal, ...notes]
                        .sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
                    // Interpretazione di default a SEDICESIMO: cattura ottavi, ottavi
                    // puntati e sedicesimi con i valori giusti (il 16mo è un sovrainsieme
                    // dell'ottavo, quindi gli ottavi restano ottavi), restando pulita
                    // (niente 32mi/pause spurie). Le terzine e altre risoluzioni si
                    // ottengono dopo con la Q (anche su selezione).
                    const cleaned = normalizeRecordedAccNotes(allReal, timeSignature, TICKS_PER_QUARTER / 4);
                    return { ...track, notes: cleaned };
                });
            });
        }
    }, [bpm, timeSignature, setAccompanimentTracks]);

    /** Ferma la registrazione, processa le note e disarma. */
    const stopAndProcessRecording = React.useCallback(() => {
        const rawEvents = stopRecording();
        if (stepInputWasEnabledRef.current) {
            midiStepInput.activate();
            stepInputWasEnabledRef.current = false;
        }
        setIsRecArmed(false);
        processAndInsertRecordedEvents(rawEvents);
    }, [stopRecording, midiStepInput, processAndInsertRecordedEvents]);

    /** Avvia la registrazione (chiamata da Space quando il REC è armato). */
    const doStartRecording = React.useCallback(() => {
        if (midiStepInput.enabled) {
            stepInputWasEnabledRef.current = true;
            midiStepInput.deactivate();
        }
        const beatsPerMeasureForRec = timeSignature.numerator * (4 / timeSignature.denominator);
        recStartAbsBeatRef.current = playheadMeasureForRecRef.current * beatsPerMeasureForRec;
        recStartMeasureRef.current = playheadMeasureForRecRef.current;
        void startRecording();
    }, [midiStepInput, timeSignature, startRecording]);

    /** Premi REC button o R: arma / disarma (se sta registrando, ferma subito). */
    const toggleRecording = React.useCallback(() => {
        if (isRecording) {
            stopAndProcessRecording();
        } else {
            setIsRecArmed(prev => !prev);
        }
    }, [isRecording, stopAndProcessRecording]);

    // Mappa durata → tick per il quantize
    const QUANTIZE_GRID_MAP: Record<string, number> = {
        'sixteenth':       TICKS_PER_QUARTER / 4,            // 240
        'eighth':          TICKS_PER_QUARTER / 2,            // 480
        'quarter':         TICKS_PER_QUARTER,                // 960
        'half':            TICKS_PER_QUARTER * 2,            // 1920
        'eighth-triplet':  Math.round(TICKS_PER_QUARTER / 3),       // 320 — ottavo terzinato
        'quarter-triplet': Math.round((TICKS_PER_QUARTER * 2) / 3), // 640 — quarto terzinato
    };

    const onQuantizeAccTrack = React.useCallback(() => {
        // Griglia scelta nella toolbar (binaria o di terzina). Quantizzazione dura,
        // pulita e prevedibile.
        const gridTicks = QUANTIZE_GRID_MAP[quantizeGrid] ?? (TICKS_PER_QUARTER / 2);
        const ticksPerMeasure = TICKS_PER_QUARTER * timeSignature.numerator * (4 / timeSignature.denominator);
        const fromRaw = (n: StaffNote) => ({ ...n, startTick: n.rawStartTick ?? n.startTick, durationTicks: n.rawDurationTicks ?? n.durationTicks });
        const runPipeline = (real: StaffNote[]) => normalizeRecordedAccNotes(real, timeSignature, gridTicks);
        const hasSelection = selectedNoteIds.size > 0;
        setAccompanimentTracks(prev => {
            const firstVisibleIdx = resolveActiveAccIdx(prev);
            if (firstVisibleIdx === -1) return prev;
            return prev.map((track, i) => {
                if (i !== firstVisibleIdx) return track;
                const allNotes = track.notes ?? [];
                // Traccia intera (nessuna selezione).
                if (!hasSelection) {
                    const real = allNotes.filter(n => !n.isRest).map(fromRaw);
                    return { ...track, notes: runPipeline(real) };
                }
                // SELETTIVA: riquantizza SOLO le note selezionate alla griglia scelta,
                // lasciando FERME le altre (così in una misura mista puoi quantizzare
                // una terzina a 1/8 T senza toccare i beat binari accanto). Poi ri-
                // tassella con le pause le misure toccate, attorno a entrambe.
                const selReal = allNotes.filter(n => !n.isRest && selectedNoteIds.has(n.id));
                if (selReal.length === 0) return track;
                const minM = Math.min(...selReal.map(n => n.measureIndex ?? 0));
                const maxM = Math.max(...selReal.map(n => n.measureIndex ?? 0));
                const inRange = (n: StaffNote) => (n.measureIndex ?? 0) >= minM && (n.measureIndex ?? 0) <= maxM;
                // Selezionate: aggancia alla griglia (dai tick raw). Non selezionate
                // nelle misure toccate: tenute COSÌ COME SONO (niente re-griglia).
                const snappedSel = gridSnapAccNotes(selReal.map(fromRaw), gridTicks, ticksPerMeasure);
                const unselInRange = allNotes.filter(n => !n.isRest && !selectedNoteIds.has(n.id) && inRange(n));
                const combined = [...snappedSel, ...unselInRange].sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
                const processed = normalizeRhythm(trimOverlappingNotes(combined), timeSignature, []);
                const kept = allNotes.filter(n => !inRange(n));
                return { ...track, notes: [...kept, ...processed].sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0)) };
            });
        });
    }, [quantizeGrid, timeSignature, selectedNoteIds, setAccompanimentTracks]);
    // Used to make marquee selection deterministic and independent from clef/position approximations.
    const systemNoteHitPointsRef = useRef<Record<number, Array<{ id: string; x: number; y: number; isGhost: boolean }>>>({});

    // In insert mode, clicking directly on a rest should behave like a staff click
    // (i.e., overwrite that rest). We bridge note-click -> staff-click via this ref.
    const staffClickForInsertRef = useRef<null | ((x: number, y: number, systemIndex: number, e?: MouseEvent) => void)>(null);

    // Staff system mode:
    // - grandstaff: standard treble+bass system (chorale / piano style)
    // - treble_only: single treble staff (guitar-style; written pitches sound an octave lower)
    const [staffSystemMode, setStaffSystemMode] = useState<StaffSystemMode>(() => {
        try {
            const raw = window.localStorage.getItem(STAFF_SYSTEM_MODE_KEY);
            if (raw === 'grandstaff' || raw === 'treble_only' || raw === 'satb_ancient') return raw;
        } catch (_) {}
        return 'grandstaff';
    });
    useEffect(() => {
        try { window.localStorage.setItem(STAFF_SYSTEM_MODE_KEY, staffSystemMode); } catch (_) {}
    }, [staffSystemMode]);

    // Staff layout (render-only mapping by voice):
    // - parti_late: S/A on treble, T/B on bass (current behavior)
    // - parti_strette: S/A/T on treble, B on bass
    const [staffLayoutMode, setStaffLayoutMode] = useState<StaffLayoutMode>('parti_late');

    // Per-position layout mode changes (Option+M toggle from playhead position).
    // Each entry marks "from this absBeat onward, use this mode".
    const [layoutModeChanges, setLayoutModeChanges] = useState<Array<{absBeat: number, mode: StaffLayoutMode}>>([]);

    /** Resolve the effective layout mode at a given position, considering per-beat overrides. */
    const effectiveLayoutMode = useCallback((measureIndex?: number | null, beat?: number | null): StaffLayoutMode => {
        if (layoutModeChanges.length === 0) return staffLayoutMode;
        if (measureIndex == null) return staffLayoutMode;
        // Approximate absBeat: measureIndex * beatsPerMeasure + (beat - 1).
        // Uses timeSignature for accuracy; falls back to 4 beats/measure.
        const bpm = timeSignature ? timeSignature.numerator * (4 / timeSignature.denominator) : 4;
        const noteAbsBeat = measureIndex * bpm + ((beat ?? 1) - 1);
        let effective = staffLayoutMode;
        for (const ch of layoutModeChanges) {
            if (ch.absBeat <= noteAbsBeat + 1e-6) effective = ch.mode;
        }
        return effective;
    }, [staffLayoutMode, layoutModeChanges, timeSignature]);

    const clefForVoice = useCallback((voice: number | undefined | null, clefOverride?: 'treble' | 'bass', measureIndex?: number | null, beat?: number | null): ClefType => {
        const v = voice ?? 1;
        // In ancient-clef and treble-only layouts the clef is fixed (by voice / single
        // staff): the treble/bass clefOverride only applies to the grandstaff layout,
        // so it must NOT win here — otherwise overridden soprano/alto notes get a
        // treble/bass clef that matches no ancient staff and vanish from the render.
        if (staffSystemMode === 'satb_ancient') {
            if (v === 1) return 'soprano';
            if (v === 2) return 'alto';
            if (v === 3) return 'tenor';
            return 'bass';
        }
        if (staffSystemMode === 'treble_only') return 'treble';
        if (clefOverride) return clefOverride;
        const mode = effectiveLayoutMode(measureIndex, beat);
        if (mode === 'parti_strette') return v === 4 ? 'bass' : 'treble';
        return (v === 3 || v === 4) ? 'bass' : 'treble';
    }, [effectiveLayoutMode, staffSystemMode]);

    // Move the currently-selected SATB notes to another voice (e.g. soprano→alto).
    // Triggered by the toolbar voice buttons when a selection is active. The clef
    // is recomputed from the target voice (so a cross-staff move, e.g. S→Bass,
    // follows the clef — same as paste, which also only re-sets voice+clef and
    // lets the renderer place by pitch). Collisions "merge as a chord" naturally:
    // a moved note sharing onset with an existing target-voice note becomes a
    // chord, and normalizeRhythm keeps both. Source + target voices are re-tiled
    // over the touched measure range so rests regenerate correctly.
    const reassignSelectionToVoice = useCallback((targetVoice: Voice) => {
        if (selectedNoteIds.size === 0) return;
        setRawNotes(prev => {
            const existing = prev || [];
            const selReal = existing.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
            const toMove = selReal.filter(n => Number((n as any).voice ?? 1) !== targetVoice);
            if (toMove.length === 0) return prev;
            const moveIds = new Set(toMove.map(n => n.id));
            const moved: StaffNote[] = toMove.map(n => ({
                ...n,
                voice: targetVoice,
                clef: clefForVoice(targetVoice, undefined, n.measureIndex, n.beat),
                clefOverride: undefined,
                manualStemDirection: undefined,
            } as StaffNote));
            const affectedVoices = new Set<number>([...toMove.map(n => Number((n as any).voice ?? 1)), targetVoice]);
            const measures = toMove.map(n => Number(n.measureIndex ?? 0));
            const minM = Math.min(...measures), maxM = Math.max(...measures);

            const removeIds = new Set<string>();
            const retiled: StaffNote[] = [];
            for (const v of affectedVoices) {
                const realInRange: StaffNote[] = [];
                for (const n of existing) {
                    if (Number((n as any).voice ?? -1) !== v) continue;
                    const m = Number(n.measureIndex ?? -1);
                    if (m < minM || m > maxM) continue;
                    removeIds.add(n.id);
                    if (!n.isRest && !moveIds.has(n.id)) realInRange.push(n);
                }
                const toTile = [...realInRange, ...(v === targetVoice ? moved : [])];
                if (toTile.length === 0) continue;
                retiled.push(...normalizeRhythm(toTile, timeSignature, timeSignatureChanges));
            }
            return [...existing.filter(n => !removeIds.has(n.id)), ...retiled];
        });

        // ACC voiced grand-staff: same behaviour, but its voice model is
        // (clef, voice 1/2). Map the SATB-style button to (clef, voice):
        // 1→treble-up, 2→treble-down, 3→bass-up, 4→bass-down. Only voiced
        // grand-staff tracks are affected; treble-only / single-voice (voice 0)
        // tracks are left as they are.
        const accClef: 'treble' | 'bass' = targetVoice <= 2 ? 'treble' : 'bass';
        const accVoice = (targetVoice === 1 || targetVoice === 3) ? 1 : 2;
        setAccompanimentTracks(prev => prev.map(track => {
            if ((track.staffMode ?? 'grandstaff') !== 'grandstaff' || !track.voiced) return track;
            const existing = track.notes || [];
            const selReal = existing.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
            const toMove = selReal.filter(n => !((n.clef ?? 'treble') === accClef && Number((n as any).voice ?? 1) === accVoice));
            if (toMove.length === 0) return track;
            const moveIds = new Set(toMove.map(n => n.id));
            const moved: StaffNote[] = toMove.map(n => ({
                ...n,
                clef: accClef,
                voice: accVoice as any,
                clefOverride: undefined,
                manualStemDirection: undefined,
            } as StaffNote));
            const streamKey = (c: string, v: number) => `${c}:${v}`;
            const affected = new Set<string>([streamKey(accClef, accVoice), ...toMove.map(n => streamKey((n.clef ?? 'treble'), Number((n as any).voice ?? 1)))]);
            const measures = toMove.map(n => Number(n.measureIndex ?? 0));
            const minM = Math.min(...measures), maxM = Math.max(...measures);
            const removeIds = new Set<string>();
            const retiled: StaffNote[] = [];
            for (const key of affected) {
                const [c, vStr] = key.split(':'); const v = Number(vStr);
                const realInRange: StaffNote[] = [];
                for (const n of existing) {
                    if ((n.clef ?? 'treble') !== c || Number((n as any).voice ?? 1) !== v) continue;
                    const m = Number(n.measureIndex ?? -1);
                    if (m < minM || m > maxM) continue;
                    removeIds.add(n.id);
                    if (!n.isRest && !moveIds.has(n.id)) realInRange.push(n);
                }
                const movedIn = moved.filter(mn => (mn.clef ?? 'treble') === c && Number((mn as any).voice ?? 1) === v);
                const toTile = [...realInRange, ...movedIn];
                if (toTile.length === 0) continue;
                // omitEmptyVoiceMeasures=true keeps ACC consistent with its import
                // (no phantom rests in bars where a voice is silent).
                retiled.push(...normalizeRhythm(toTile, timeSignature, timeSignatureChanges, true));
            }
            return { ...track, notes: [...existing.filter(n => !removeIds.has(n.id)), ...retiled] };
        }));
    }, [selectedNoteIds, clefForVoice, timeSignature, timeSignatureChanges, setRawNotes, setAccompanimentTracks]);

    const hasReassignableSelection = useMemo(() => {
        if (selectedNoteIds.size === 0) return false;
        if (rawNotes.some(n => selectedNoteIds.has(n.id) && !n.isRest)) return true;
        return (accompanimentTracks || []).some(t =>
            (t.staffMode ?? 'grandstaff') === 'grandstaff' && t.voiced
            && (t.notes || []).some(n => selectedNoteIds.has(n.id) && !n.isRest));
    }, [selectedNoteIds, rawNotes, accompanimentTracks]);

    const playbackTransposeSemitones = staffSystemMode === 'treble_only' ? -12 : 0;

    // Accompaniment staves are rendered below the SATB Grand Staff when at least
    // one accompaniment track is visible. Extra vertical space depends on the
    // accompaniment staff mode of the visible tracks:
    //  - "grandstaff": 140 gap + 40 (treble lines) + 130 (treble->bass span) = 310px
    //  - "treble_only": 140 gap + 70 (single staff footprint)                = 210px
    // The 140px gap matches ACCOMPANIMENT_STAFF_GAP in VexflowGrandStaff and
    // leaves room for the SATB Roman-numeral row and high acc-treble ledger lines.
    // Each visible track now draws its OWN staff block (grandstaff or single staff),
    // stacked below the SATB. Total extra height = sum of per-track footprints,
    // computed by the shared helper so it stays in sync with the renderer.
    const visibleAccompanimentTracks = (accompanimentTracks || []).filter(t => t && t.visible);
    const hasVisibleAccompaniment = visibleAccompanimentTracks.length > 0;
    const anyVisibleGrandstaff = visibleAccompanimentTracks.some(
        t => (t.staffMode ?? 'grandstaff') === 'grandstaff'
    );
    // Kept for legacy hit-testing/ghost logic that still assumes a single acc block;
    // refined to per-track mapping in a later phase.
    const effectiveAccStaffMode: 'grandstaff' | 'treble_only' = anyVisibleGrandstaff ? 'grandstaff' : 'treble_only';
    const accExtraPx = hasVisibleAccompaniment
        ? accompanimentExtraPxForTracks(visibleAccompanimentTracks)
        : 0;
    const systemHeightPx = (staffSystemMode === 'satb_ancient' ? VF_SATB_SYSTEM_HEIGHT : TOTAL_SYSTEM_HEIGHT)
        + accExtraPx;
    const playheadYTopPx = staffSystemMode === 'satb_ancient'
        ? (VF_SATB_SOPRANO_Y + PLAYHEAD_Y_OFFSET_PX - 3)
        : PLAYHEAD_Y_TOP;
    // When ACC is visible, extend the playhead down to cover the ACC staves so the
    // playback cursor spans both SATB and accompaniment systems.
    const playheadYBottomPxBase = staffSystemMode === 'satb_ancient'
        ? ((VF_SATB_BASS_Y + (4 * VF_LINE_SPACING)) + PLAYHEAD_Y_OFFSET_PX)
        : PLAYHEAD_Y_BOTTOM;
    const playheadYBottomPx = playheadYBottomPxBase + accExtraPx;

    const vfStaveTopYForClef = useCallback((clef: ClefType): number => {
        if (staffSystemMode === 'satb_ancient') {
            if (clef === 'soprano') return VF_SATB_SOPRANO_Y;
            if (clef === 'alto') return VF_SATB_ALTO_Y;
            if (clef === 'tenor') return VF_SATB_TENOR_Y;
            return VF_SATB_BASS_Y;
        }
        return clef === 'bass' ? VF_BASS_Y : VF_TREBLE_Y;
    }, [staffSystemMode]);

    const vfC4YForClef = useCallback((clef: ClefType, staveTopY: number): number => {
        // C4 (position 0) reference within the staff for each clef.
        // All values are expressed in VexFlow coordinates.
        switch (clef) {
            case 'soprano':
                // Middle C on bottom line
                return staveTopY + 4 * VF_LINE_SPACING;
            case 'alto':
                // Middle C on middle line
                return staveTopY + 2 * VF_LINE_SPACING;
            case 'tenor':
                // Middle C on 4th line (from bottom) = 2nd line from top
                return staveTopY + 1 * VF_LINE_SPACING;
            case 'bass':
                // Middle C one ledger line above
                return staveTopY - 1 * VF_LINE_SPACING;
            case 'treble':
            default:
                // Middle C one ledger line below
                return staveTopY + 5 * VF_LINE_SPACING;
        }
    }, []);

    const isSvgYWithinClefStaff = useCallback((ySvg: number, clef: ClefType): boolean => {
        if (staffSystemMode !== 'satb_ancient') {
            // Existing gating logic handles treble/bass split.
            return true;
        }
        const yAdj = ySvg + VF_TREBLE_MOUSE_Y_ADJUST_PX;
        const top = vfStaveTopYForClef(clef);
        const bottom = top + 4 * VF_LINE_SPACING;
        // Allow extra room ONLY for SATB bass so ledger lines below are reachable.
        // This is input gating/padding, not a pitch mapping change.
        const pad = clef === 'bass' ? 60 : 18;
        return yAdj >= (top - pad) && yAdj <= (bottom + pad);
    }, [staffSystemMode, vfStaveTopYForClef]);

    const diatonicPositionFromSvgY = useCallback((ySvg: number, clef: ClefType): number | null => {
        if (staffSystemMode !== 'satb_ancient') return null;
        if (!isSvgYWithinClefStaff(ySvg, clef)) return null;

        const yAdj = ySvg + VF_TREBLE_MOUSE_Y_ADJUST_PX;
        const top = vfStaveTopYForClef(clef);
        const c4Y = vfC4YForClef(clef, top);
        const halfStep = VF_LINE_SPACING / 2;
        return Math.round((c4Y - yAdj) / halfStep);
    }, [isSvgYWithinClefStaff, staffSystemMode, vfC4YForClef, vfStaveTopYForClef]);

    // Map a (calibrated) pointer Y to the accompaniment track block it falls in, plus
    // the resolved clef and diatonic position on that block's staff. Each visible track
    // draws its own stacked staff block (grandstaff or single staff with its clef), so
    // inserted notes must reference the clicked block — not always the first track.
    // `pos` is an absolute diatonic position (C4 = 0); the middle staff line per clef:
    // treble B4=6, bass D3=-6, alto C4=0, tenor A3=-2, soprano G4=4.
    const ACC_MIDDLE_LINE_POS: Record<ClefType, number> = { treble: 6, bass: -6, alto: 0, tenor: -2, soprano: 4 };
    const ACC_GS_SPAN_PX = 130; // treble→bass top span (mirrors ACCOMPANIMENT_GS_SPAN)
    const resolveAccTarget = useCallback((yCal: number, accTrebleBaseTopY: number): { trackId: string; visIdx: number; clef: ClefType; pos: number } | null => {
        const tracks = (latestAccompanimentTracks.current || []).filter(t => t && t.visible);
        if (tracks.length === 0) return null;
        const offsets = accompanimentTrackTrebleOffsets(tracks);
        const trebleTops = offsets.map(o => accTrebleBaseTopY + o);
        const blockBottom = (i: number) =>
            trebleTops[i] + (((tracks[i].staffMode ?? 'grandstaff') === 'grandstaff') ? ACC_GS_SPAN_PX + 4 * VF_LINE_SPACING : 4 * VF_LINE_SPACING);
        // Pick the block: a click belongs to block i if it's above the midpoint between
        // block i's bottom and block i+1's top; otherwise fall through to the last block.
        let bi = tracks.length - 1;
        for (let i = 0; i < tracks.length - 1; i++) {
            const boundary = (blockBottom(i) + trebleTops[i + 1]) / 2;
            if (yCal < boundary) { bi = i; break; }
        }
        const track = tracks[bi];
        const mode = (track.staffMode ?? 'grandstaff');
        const trebleTop = trebleTops[bi];
        const halfStep = VF_LINE_SPACING / 2;
        if (mode === 'grandstaff') {
            const bassTop = trebleTop + ACC_GS_SPAN_PX;
            const midSplit = (trebleTop + 2 * VF_LINE_SPACING + bassTop + 2 * VF_LINE_SPACING) / 2;
            if (yCal < midSplit) {
                const middleY = trebleTop + 2 * VF_LINE_SPACING;
                return { trackId: track.id, visIdx: bi, clef: 'treble', pos: 6 + Math.round((middleY - yCal) / halfStep) };
            }
            const middleY = bassTop + 2 * VF_LINE_SPACING;
            return { trackId: track.id, visIdx: bi, clef: 'bass', pos: -6 + Math.round((middleY - yCal) / halfStep) };
        }
        const clef = (track.clef ?? 'treble') as ClefType;
        const middleY = trebleTop + 2 * VF_LINE_SPACING;
        return { trackId: track.id, visIdx: bi, clef, pos: ACC_MIDDLE_LINE_POS[clef] + Math.round((middleY - yCal) / halfStep) };
    }, []);

    // Copy the current selection robustly: detect whether the selected notes live in the
    // accompaniment tracks or in the SATB rawNotes (instead of trusting activeStaffArea),
    // remember that source as the active area/track (so a plain paste returns to it), and
    // write both the local and system clipboard. Returns the copied notes ([] if none).
    const copySelectedToClipboard = useCallback((): StaffNote[] => {
        const sel = latestSelectedNoteIds.current;
        if (!sel || sel.size === 0) return [];
        const accSelected = latestAccompanimentTracks.current.flatMap(t => t.notes).filter(n => sel.has(n.id));
        const satbSelected = (latestRawNotes.current || []).filter(n => sel.has(n.id));
        const source = accSelected.length > 0 ? accSelected : satbSelected;
        if (source.length === 0) return [];
        if (accSelected.length > 0) {
            activeStaffAreaRef.current = 'accompaniment';
            setActiveStaffArea('accompaniment');
            const owner = latestAccompanimentTracks.current.find(t => t.notes.some(n => n.id === accSelected[0].id));
            if (owner) activeAccTrackIdRef.current = owner.id;
        } else {
            activeStaffAreaRef.current = 'satb';
            setActiveStaffArea('satb');
        }
        const copied = source.map(n => { const { xPosition, ...rest } = n as any; return rest as StaffNote; });
        setClipboard(copied);
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(JSON.stringify(copied)).catch(() => setCopyPasteError('Copia negli appunti di sistema fallita.'));
        }
        return copied;
    }, [setClipboard, setCopyPasteError]);

    const [analysisContexts, setAnalysisContexts] = useState<AnalysisContext[]>([]);
    const [harmonyOverrides, setHarmonyOverrides] = useState<HarmonyLabelOverride[]>([]);
    const [tonicizationHints, setTonicizationHints] = useState<TonicizationHint[]>([]);
    const [inferredContextSuppressions, setInferredContextSuppressions] = useState<number[]>([]);
    const latestHarmonyOverrides = useRef<HarmonyLabelOverride[]>([]);
    useEffect(() => { latestHarmonyOverrides.current = harmonyOverrides || []; }, [harmonyOverrides]);
    const latestOrnamentOverrides = useRef<OrnamentOverride[]>([]);
    useEffect(() => { latestOrnamentOverrides.current = ornamentOverrides || []; }, [ornamentOverrides]);
    const [harmonyOverrideMenu, setHarmonyOverrideMenu] = useState<{ x: number; y: number; absBeat: number; measureIndex: number; beat: number } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; absBeat: number; measureIndex: number; beat: number; inferredTonicAtBeat?: { tonic: string; isMinor: boolean } | null } | null>(null);
    const [isAnalysisEnabled, setIsAnalysisEnabled] = useState(true);
    const [isSequencesEnabled, setIsSequencesEnabled] = useState(() => {
        try {
            const raw = String(localStorage.getItem('harmony.analysis.sequencesEnabled.v1') || '').trim();
            if (raw === '0') return false;
            if (raw === '1') return true;
        } catch { /* ignore */ }
        return true;
    });
    useEffect(() => {
        try { localStorage.setItem('harmony.analysis.sequencesEnabled.v1', isSequencesEnabled ? '1' : '0'); } catch { /* ignore */ }
    }, [isSequencesEnabled]);
    const [showRomanAnalysis, setShowRomanAnalysis] = usePreference<boolean>('analysis.showRomanAnalysis');
    const [showSymbolAnalysis, setShowSymbolAnalysis] = usePreference<boolean>('analysis.showSymbolAnalysis');
    const [analysisFilters] = usePreference<HarmonyAnalysisFiltersPref>('analysis.filters');
    const [autoSaveInterval] = usePreference<number>('editor.autoSaveInterval');
    const [harmonyLabelMinSpanBeats] = usePreference<number>('analysis.harmonyLabelMinSpanBeats');
    const [useStatisticalCorrection] = usePreference<boolean>('analysis.useStatisticalCorrection');
    const [statisticalBiasThreshold] = usePreference<number>('analysis.statisticalBiasThreshold');
    const [enableInferredContexts] = usePreference<boolean>('analysis.enableInferredContexts');
    const [cadentialPatternsEnabled] = usePreference<boolean>('analysis.cadentialPatterns');
    const _styleProfile = useMemo(() => loadStyleProfile(), []);
    const [showMeasureNumbers, setShowMeasureNumbers] = useState(true);

    const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

    const [isRomanEditorOpen, setIsRomanEditorOpen] = useState(false);

    const [engravingMode, setEngravingMode] = useState<EngravingMode>(() => {
        try {
            const raw = String(window.localStorage.getItem(ENGRAVING_MODE_KEY) || '').trim();
            if (raw === 'legacy' || raw === 'enhanced') return raw;
        } catch (_) {}
        return 'enhanced';
    });
    useEffect(() => {
        try { window.localStorage.setItem(ENGRAVING_MODE_KEY, engravingMode); } catch (_) {}
    }, [engravingMode]);

    const [showVoiceColors, setShowVoiceColors] = useState(false);
    const [showIncompleteMeasureWarnings, setShowIncompleteMeasureWarnings] = useState(true);

    // Menu-driven toggles (Electron)
    const [showQuickInsertBar, setShowQuickInsertBar] = useState(false);
    const [showHarmonyDebug, setShowHarmonyDebug] = useState(
        () => { try { return localStorage.getItem('harmony-tutor.showHarmonyDebug.v1') === '1'; } catch { return false; } }
    );
    const [toolbarGroupOrder, setToolbarGroupOrder] = useState<ToolbarGroupId[]>(() => {
        // Load toolbar prefs synchronously to avoid overwriting them with defaults on first mount.
        try {
            const raw = localStorage.getItem(TOOLBAR_PREFS_KEY);
            if (!raw) return DEFAULT_TOOLBAR_ORDER;
            const parsed = JSON.parse(raw);
            const order: ToolbarGroupId[] = Array.isArray(parsed?.order) ? parsed.order : [];

            const all = new Set<ToolbarGroupId>(DEFAULT_TOOLBAR_ORDER);
            const cleanedOrder = order.filter((id: any): id is ToolbarGroupId => all.has(id));
            const fullOrder: ToolbarGroupId[] = Array.from(new Set([...cleanedOrder, ...DEFAULT_TOOLBAR_ORDER]));
            return fullOrder;
        } catch {
            return DEFAULT_TOOLBAR_ORDER;
        }
    });
    const [isToolbarCustomizeOpen, setIsToolbarCustomizeOpen] = useState(false);

    const [currentProjectFilePath, setCurrentProjectFilePath] = useState<string | null>(null);
    const currentProjectFilePathRef = useRef(currentProjectFilePath);
    currentProjectFilePathRef.current = currentProjectFilePath;
    const currentProjectFileName = useMemo(() => {
        if (!currentProjectFilePath) return null;
        const parts = currentProjectFilePath.split(/[/\\]/);
        return parts[parts.length - 1] || currentProjectFilePath;
    }, [currentProjectFilePath]);

    // midiOutputs, selectedMidiOutput, isMidiMenuOpen now in usePlayback

    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    // SATB toggle should behave as a true toggle without losing access to the previous mode.
    const lastNonSatbModeRef = useRef<StaffSystemMode>('grandstaff');
    useEffect(() => {
        if (staffSystemMode !== 'satb_ancient') lastNonSatbModeRef.current = staffSystemMode;
    }, [staffSystemMode]);
    // pasteCaret, pasteMarker, setPasteCaretImmediate now owned by useNoteSelection

    const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const measureTextWidth = useCallback((text: string, font: string) => {
        try {
            if (typeof document === 'undefined') return text.length * 8;
            const canvas = measureCanvasRef.current ?? (measureCanvasRef.current = document.createElement('canvas'));
            const ctx = canvas.getContext('2d');
            if (!ctx) return text.length * 8;
            ctx.font = font;
            const w = ctx.measureText(text).width;
            return Number.isFinite(w) ? w : text.length * 8;
        } catch {
            return text.length * 8;
        }
    }, []);

    const [vexflowNonce, setVexflowNonce] = useState(0);
    const resetVexflow = useCallback(() => {
        setVexflowNonce(n => n + 1);
    }, []);

    const runOverlapAudit = useCallback((mode: EngravingMode) => {
        try {
            setEngravingMode(mode);
            setVexflowNonce(n => n + 1);

            window.setTimeout(() => {
                try {
                    type Box = { x: number; y: number; w: number; h: number };
                    const intersects = (a: Box, b: Box) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

                    const toBox = (el: SVGGraphicsElement): Box | null => {
                        try {
                            const bb = el.getBBox();
                            if (!bb || !Number.isFinite(bb.x) || !Number.isFinite(bb.width)) return null;
                            return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
                        } catch {
                            return null;
                        }
                    };

                    const noteSelectors = ['.vf-notehead', '[class*="vf-notehead"]'].join(',');
                    const accidentalSelectors = ['.vf-accidental', '[class*="vf-accidental"]'].join(',');

                    let noteBoxes: Box[] = [];
                    let accidentalBoxes: Box[] = [];

                    for (const el of systemElementByIndexRef.current.values()) {
                        const svg = el.querySelector('svg') as SVGSVGElement | null;
                        if (!svg) continue;
                        const noteEls = Array.from(svg.querySelectorAll(noteSelectors)) as SVGGraphicsElement[];
                        const accEls = Array.from(svg.querySelectorAll(accidentalSelectors)) as SVGGraphicsElement[];
                        noteBoxes.push(...(noteEls.map(toBox).filter(Boolean) as Box[]));
                        accidentalBoxes.push(...(accEls.map(toBox).filter(Boolean) as Box[]));
                    }

                    let accVsNote = 0;
                    for (const a of accidentalBoxes) {
                        for (const n of noteBoxes) {
                            if (intersects(a, n)) accVsNote++;
                        }
                    }

                    let noteVsNote = 0;
                    for (let i = 0; i < noteBoxes.length; i++) {
                        for (let j = i + 1; j < noteBoxes.length; j++) {
                            if (intersects(noteBoxes[i], noteBoxes[j])) noteVsNote++;
                        }
                    }

                    window.alert(
                        [
                            `Audit collisioni (${mode})`,
                            `noteheads: ${noteBoxes.length}`,
                            `accidentals: ${accidentalBoxes.length}`,
                            `overlap accidental↔notehead: ${accVsNote}`,
                            `overlap notehead↔notehead: ${noteVsNote}`,
                            '',
                            'Nota: se i selettori SVG di VexFlow cambiano, il conteggio può risultare 0.',
                        ].join('\n')
                    );
                } catch {
                    try { window.alert(`Audit collisioni fallito (${mode}).`); } catch { /* ignore */ }
                }
            }, 250);
        } catch {
            // ignore
        }
    }, [setEngravingMode]);

    const dispatchMenuActionRef = useRef<((action: MenuAction, payload: any) => void) | null>(null);

    useEffect(() => {
        if (!pendingMenuAction) return;
        // When App routes a GrandStaff action while we were on another view,
        // it queues it via `pendingMenuAction`. Execute it exactly once here.
        try {
            dispatchMenuActionRef.current?.(pendingMenuAction.action, pendingMenuAction.payload);
        } catch {
            // ignore
        } finally {
            try { onConsumePendingMenuAction?.(pendingMenuAction.nonce); } catch { /* ignore */ }
        }
    }, [pendingMenuAction, onConsumePendingMenuAction]);

    // Stable layout parameters: keep `pxPerQuarter` stable across layout passes
    // to avoid global rescaling (which caused the drift). Reset when container
    // width changes so layout can adapt to a new viewport.
    const stablePxPerQuarterRef = useRef<number | null>(null);
    useEffect(() => {
        // reset stability when the container resizes
        stablePxPerQuarterRef.current = null;
    }, [containerWidth]);

    useEffect(() => {
        if (!isMoreMenuOpen) return;

        const onDocMouseDown = (ev: MouseEvent) => {
            const el = moreMenuRef.current;
            if (!el) return;
            if (el.contains(ev.target as any)) return;
            setIsMoreMenuOpen(false);
            setIsMidiMenuOpen(false);
        };

        const onDocKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                setIsMoreMenuOpen(false);
                setIsMidiMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onDocKeyDown);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onDocKeyDown);
        };
    }, [isMoreMenuOpen]);
    
    // isLoopingRef, loopRangeRef, metronome refs, isMetronomeOnRef, isPlayingRef now in usePlayback
    // metronomeFlashStartTimeoutRef, metronomeFlashTimeoutRef now in usePlayback
    const soloVoicesRef = useRef(soloVoices);
    const voiceInstrumentsRef = useRef(voiceInstruments);
    const voiceVolumesRef = useRef(voiceVolumes);
    const mutedVoicesRef = useRef(mutedVoices);
    // Per-voice gain nodes (twin of accTrackGainsRef): notes route through these so
    // mute/volume changes apply in real-time to already-scheduled playback.
    const voiceGainsRef = useRef<Map<number, GainNode>>(new Map());

    // isLooping/loopRange/isMetronomeOn sync effects now in usePlayback

    useEffect(() => {
        if (!timeSignatureChanges || timeSignatureChanges.length === 0) return;
        setRawNotes(prev => {
            if (!prev || prev.length === 0) return prev;

            const baseBeats = timeSignature.numerator * (4 / timeSignature.denominator);
            const changes = (timeSignatureChanges || [])
                .map(c => {
                    const absBeat = Number(c.absBeat);
                    const m = Number.isFinite(c.measureIndex as any)
                        ? Number(c.measureIndex)
                        : (Number.isFinite(absBeat) ? Math.floor(absBeat / Math.max(1, baseBeats || 4)) : 0);
                    return { measureIndex: m, numerator: c.numerator, denominator: c.denominator };
                })
                .filter(c => Number.isFinite(c.measureIndex))
                .sort((a, b) => a.measureIndex - b.measureIndex);

            const maxIdx = prev.reduce((mx, n) => Math.max(mx, Number.isFinite(n.measureIndex) ? (n.measureIndex as number) : 0), 0);
            const measureStartAbsBeat: number[] = [];
            let acc = 0;
            for (let m = 0; m <= maxIdx + 1; m++) {
                measureStartAbsBeat[m] = acc;
                let active = { numerator: timeSignature.numerator, denominator: timeSignature.denominator };
                for (const c of changes) {
                    if (c.measureIndex <= m) active = { numerator: c.numerator, denominator: c.denominator };
                    else break;
                }
                const bpm = active.numerator * (4 / active.denominator);
                acc += Math.max(1, Number.isFinite(bpm) ? bpm : baseBeats || 4);
            }

            return prev.map(n => {
                const m = Number.isFinite(n.measureIndex) ? (n.measureIndex as number) : 0;
                const b = Number.isFinite(n.beat) ? (n.beat as number) : 1;
                const startAbs = (measureStartAbsBeat[m] ?? (m * baseBeats)) + (b - 1);
                const startTick = Math.round(startAbs * TICKS_PER_QUARTER);
                if (!Number.isFinite(startTick)) return n;
                return { ...n, startTick } as StaffNote;
            });
        });
    }, [timeSignatureChanges, timeSignature, setRawNotes]);
    // isPlayingRef sync now in usePlayback
    useEffect(() => { soloVoicesRef.current = soloVoices; }, [soloVoices]);
    useEffect(() => { voiceInstrumentsRef.current = voiceInstruments; }, [voiceInstruments]);
    useEffect(() => { voiceVolumesRef.current = voiceVolumes; }, [voiceVolumes]);
    useEffect(() => { mutedVoicesRef.current = mutedVoices; }, [mutedVoices]);

    const canUseDuplet = useMemo(() => {
        // Duina nei tempi composti: 2 ottavi nel tempo di 3 (cioè 2:3 su un beat composto).
        // La abilitiamo su metri x/8 con numeratore multiplo di 3 (6/8, 9/8, 12/8, ...).
        // Per ora la limitiamo agli ottavi per evitare ambiguità sulle altre durate.
        const isCompound = timeSignature.denominator === 8
            && timeSignature.numerator >= 6
            && (timeSignature.numerator % 3 === 0);
        return isCompound && selectedInsertion.duration === 'eighth';
    }, [selectedInsertion.duration, timeSignature.denominator, timeSignature.numerator]);

    const tupletFactor = useMemo(() => {
        if (isTriplet) return (2 / 3);
        if (isDuplet) return (3 / 2);
        return 1;
    }, [isDuplet, isTriplet]);

    useEffect(() => {
        if (isDuplet && !canUseDuplet) setIsDuplet(false);
    }, [canUseDuplet, isDuplet]);
    // isBpmActiveRef sync now in usePlayback

    useEffect(() => {
        setMinMeasureCountDraft(String(minMeasureCount));
    }, [minMeasureCount]);

    useEffect(() => {
        setMeasuresPerLineDraft(String(measuresPerLine));
    }, [measuresPerLine]);

    useEffect(() => {
        try {
            localStorage.setItem(TOOLBAR_PREFS_KEY, JSON.stringify({ order: toolbarGroupOrder }));
        } catch {
            // ignore quota/errors
        }
    }, [toolbarGroupOrder]);

    const reorderToolbarGroups = useCallback((dragId: ToolbarGroupId, overId: ToolbarGroupId) => {
        setToolbarGroupOrder(prev => {
            if (dragId === overId) return prev;
            const from = prev.indexOf(dragId);
            const to = prev.indexOf(overId);
            if (from < 0 || to < 0) return prev;
            const next = [...prev];
            next.splice(from, 1);
            next.splice(to, 0, dragId);
            return next;
        });
    }, []);

    const applyMinMeasureCountDraft = useCallback(() => {
        const v = Math.trunc(Number(minMeasureCountDraft));
        if (!Number.isFinite(v)) return;
        setMinMeasureCount(Math.max(1, v));
    }, [minMeasureCountDraft]);

    const bumpMinMeasureCount = useCallback((delta: number) => {
        const parsed = Math.trunc(Number(minMeasureCountDraft));
        const base = Number.isFinite(parsed) ? parsed : minMeasureCount;
        const next = Math.max(1, base + delta);
        setMinMeasureCount(next);
        setMinMeasureCountDraft(String(next));
    }, [minMeasureCount, minMeasureCountDraft]);

    const applyMeasuresPerLineDraft = useCallback(() => {
        const v = Math.trunc(Number(measuresPerLineDraft));
        if (!Number.isFinite(v)) return;
        setMeasuresPerLine(Math.max(1, Math.min(12, v)));
    }, [measuresPerLineDraft]);

    const bumpMeasuresPerLine = useCallback((delta: number) => {
        const parsed = Math.trunc(Number(measuresPerLineDraft));
        const base = Number.isFinite(parsed) ? parsed : measuresPerLine;
        const next = Math.max(1, Math.min(12, base + delta));
        setMeasuresPerLine(next);
        setMeasuresPerLineDraft(String(next));
    }, [measuresPerLine, measuresPerLineDraft]);

    // stopMetronomeInternal, startMetronomeScheduler, metronome toggle effect now in usePlayback

    // handleActivateMidi now in usePlayback

    // bpmInputString now owned by usePlayback
    
    // selectionRect now owned by useNoteSelection
    const dragStartPosRef = useRef<{
        clientX: number;
        clientY: number;
        svgStartX: number;
        svgStartY: number;
        clientPerSvgX: number;
        clientPerSvgY: number;
        systemIndex: number;
        isAdditive: boolean;
        filterVoice: Voice | null;
    } | null>(null);
    const isActuallyDraggingRef = useRef(false);
    const justDraggedRef = useRef(false);

    const keySignature = useMemo(() => getKeySignature(keySignatureRoot, 'Major'), [keySignatureRoot]);
    keySignatureForRecRef.current = keySignature;

    const {
        computeDurationTicks,
        applyEditToSelectedNotes,
        applyAccidentalToSelectedNotes,
        applyDottedToSelectedNotes,
    } = useNoteEditor({
        selectedNoteIds, setSelectedNoteIds, setRawNotes,
        timeSignature, keySignature, justInsertedNoteRef,
        latestAccompanimentTracksRef: latestAccompanimentTracks,
        setAccompanimentTracks,
    });

    /** Avanza (delta>0) o retrocede (delta<0) il pasteCaret di una durata.
     * fromStartTick/fromDurTicks: tick di partenza + durata (usati per calcolo preciso).
     * Se non passati, usa pasteCaret come fallback.
     */
    const advanceChordCaret = useCallback((delta: 1 | -1 = 1, fromStartTick?: number, fromDurTicks?: number) => {
        try {
            const ld = layoutDataRef.current as any;
            let nextAbsBeat: number;
            if (fromStartTick !== undefined && fromDurTicks !== undefined) {
                // Calcolo preciso basato sui tick (identico al normale inserimento)
                const signedDur = delta > 0 ? fromDurTicks : -fromDurTicks;
                nextAbsBeat = Math.max(0, (fromStartTick + signedDur) / TICKS_PER_QUARTER);
            } else {
                // Fallback da pasteCaret (usa ref per evitare stale closure)
                const currentCaret2 = latestPasteCaretRef.current;
                const measureIndex = currentCaret2?.measureIndex ?? 0;
                const beat = currentCaret2?.beat ?? 1;
                const bpmAdv = ld?.measureBeatsPerMeasure?.[measureIndex]
                    ?? (timeSignature.numerator * (4 / timeSignature.denominator));
                const durBeats = (DURATION_VALUES as any)[selectedInsertion.duration] ?? 1;
                const currentAbsBeat = (ld?.measureStartAbsBeat?.[measureIndex] ?? (measureIndex * bpmAdv)) + (beat - 1);
                nextAbsBeat = Math.max(0, currentAbsBeat + delta * durBeats);
            }
            const nextPos = getPlayheadPosForAbsBeatRef.current?.(nextAbsBeat);
            if (nextPos) {
                // Aggiorna anche il cursor di playback per evitare che il useEffect su layoutData ripristini la posizione vecchia
                playbackCursorAbsBeatRef.current = nextAbsBeat;
                setPlayheadPosition(nextPos);
                const beatsPerMeasureAdv = timeSignature.numerator * (4 / timeSignature.denominator);
                const nextMeasure = Math.floor(nextAbsBeat / beatsPerMeasureAdv);
                const nextBeat = Math.round(((nextAbsBeat - nextMeasure * beatsPerMeasureAdv) + 1) * 1e6) / 1e6;
                // setPasteCaretImmediate aggiorna anche latestPasteCaretRef in modo sincrono
                setPasteCaretImmediate({ x: nextPos.x, systemIndex: nextPos.systemIndex, measureIndex: nextMeasure, beat: nextBeat });
            }
        } catch { /* ignora */ }
    }, [pasteCaret, timeSignature, selectedInsertion, setPlayheadPosition, setPasteCaret]);

    // Indice ciclico nella lista delle disposizioni per il re-voice
    const [revoiceDispIdx, setRevoiceDispIdx] = useState(0);
    // Reset del ciclo quando la selezione cambia (nuovo accordo selezionato → riparte da 'auto')
    const prevSelectedNoteIdsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const prev = prevSelectedNoteIdsRef.current;
        const curr = selectedNoteIds;
        const same = prev.size === curr.size && [...curr].every(id => prev.has(id));
        if (!same) {
            setRevoiceDispIdx(0);
            prevSelectedNoteIdsRef.current = new Set(curr);
        }
    }, [selectedNoteIds]);

    // Converts a tick count to the closest standard NoteDuration name (with optional dot).
    // Used by ACC pattern generators (arpeggio, broken) to assign valid durations to
    // sub-divisions of the inserted chord.
    const ticksToDurationInfo = useCallback((ticks: number): { duration: NoteDuration; isDotted: boolean } => {
        const TQ = TICKS_PER_QUARTER;
        const table: Array<{ d: NoteDuration; dot: boolean; t: number }> = [
            { d: 'whole',         dot: false, t: 4 * TQ },
            { d: 'half',          dot: true,  t: 3 * TQ },
            { d: 'half',          dot: false, t: 2 * TQ },
            { d: 'quarter',       dot: true,  t: 1.5 * TQ },
            { d: 'quarter',       dot: false, t: 1 * TQ },
            { d: 'eighth',        dot: true,  t: 0.75 * TQ },
            { d: 'eighth',        dot: false, t: 0.5 * TQ },
            { d: 'sixteenth',     dot: true,  t: 0.375 * TQ },
            { d: 'sixteenth',     dot: false, t: 0.25 * TQ },
            { d: 'thirty-second', dot: false, t: 0.125 * TQ },
            { d: 'sixty-fourth',  dot: false, t: 0.0625 * TQ },
        ];
        let best = table[0];
        let bestDiff = Math.abs(ticks - best.t);
        for (const row of table) {
            const diff = Math.abs(ticks - row.t);
            if (diff < bestDiff) { best = row; bestDiff = diff; }
        }
        return { duration: best.d, isDotted: best.dot };
    }, []);

    // Re-times a block-chord template (all notes at same startTick/durationTicks) into a
    // sequence according to the given accompaniment pattern. Returns a new note array.
    const applyAccPattern = useCallback((
        baseNotes: StaffNote[],
        startTick: number,
        durationTicks: number,
        subdivisionTicks: number,
        pattern: AccompanimentPattern,
        letRing: boolean,
    ): StaffNote[] => {
        if (pattern === 'block' || baseNotes.length === 0) return baseNotes;

        // Compact to close position: the SATB engine may spread notes over 2
        // octaves (e.g. C3–G3–E4–C5). For arpeggio patterns every note should
        // be within 1 octave of the lowest so the pattern stays in a sensible
        // register (C3–E3–G3–C4 instead of C3–G3–E4–C5).
        const rawSorted = [...baseNotes].sort((a, b) => ((a as any).midi ?? 0) - ((b as any).midi ?? 0));
        const lowestMidi = Number((rawSorted[0] as any)?.midi ?? 48);
        const sorted = rawSorted.map((n) => {
            const orig = Number((n as any).midi ?? 0);
            let m = orig;
            while (m > lowestMidi + 12) m -= 12;
            if (m === orig) return n;
            const octaveDelta = Math.round((m - orig) / 12); // negative integer
            return {
                ...n,
                midi: m,
                octave: ((n as any).octave ?? 4) + octaveDelta,
                position: ((n as any).position ?? 0) + octaveDelta * 7,
                noteName: ((n as any).noteName ?? '').replace(/\/(\d+)$/, (_: string, o: string) => `/${parseInt(o) + octaveDelta}`),
                clef: (m >= 60 ? 'treble' : 'bass') as 'treble' | 'bass',
            };
        }).sort((a, b) => ((a as any).midi ?? 0) - ((b as any).midi ?? 0));
        const slot = Math.max(60, subdivisionTicks); // minimum 1/64 note
        const info = ticksToDurationInfo(slot);
        const baseBeat = Number((sorted[0] as any)?.beat) || 1;
        const endTick = startTick + durationTicks;

        // Helper: genera note usando un pattern di indici (es. [0,2,1,2] per albertino).
        // Riusato da arpeggio_up, arpeggio_down, albertino, ondulato.
        const generateFromIndexPattern = (indexPattern: number[]): StaffNote[] => {
            const numNotes = Math.max(1, Math.floor(durationTicks / slot));
            const out: StaffNote[] = [];
            for (let i = 0; i < numNotes; i++) {
                const rawIdx = indexPattern[i % indexPattern.length];
                const src = sorted[Math.min(rawIdx, sorted.length - 1)];
                const s = startTick + i * slot;
                const writtenDt = (i === numNotes - 1) ? (endTick - s) : slot;
                // Use per-note duration info so the last note's visual duration
                // matches its actual writtenDt (matters when durationTicks is
                // not an exact multiple of slot).
                const noteInfo = writtenDt === slot ? info : ticksToDurationInfo(writtenDt);
                const note: any = {
                    ...src,
                    id: crypto.randomUUID(),
                    startTick: s,
                    durationTicks: writtenDt,
                    duration: noteInfo.duration,
                    isDotted: noteInfo.isDotted,
                    beat: baseBeat + (i * slot) / TICKS_PER_QUARTER,
                };
                if (letRing) note.playbackDurationTicks = endTick - s;
                out.push(note as StaffNote);
            }
            return out;
        };

        if (pattern === 'arpeggio_up') {
            return generateFromIndexPattern(sorted.map((_, i) => i));
        }
        if (pattern === 'arpeggio_down') {
            return generateFromIndexPattern(sorted.map((_, i) => sorted.length - 1 - i));
        }
        if (pattern === 'albertino') {
            const n = sorted.length;
            const idxPat = n < 3 ? [0, 1] : [0, 2, 1, 2];
            return generateFromIndexPattern(idxPat);
        }
        if (pattern === 'ondulato') {
            const n = sorted.length;
            if (n <= 1) return generateFromIndexPattern([0]);
            if (n === 2) return generateFromIndexPattern([0, 1]);
            const up = Array.from({ length: n }, (_, i) => i);
            const down = Array.from({ length: n - 2 }, (_, i) => n - 2 - i);
            return generateFromIndexPattern([...up, ...down]);
        }

        // broken: alternating bass / upper-chord "boom-chick"
        const bass = sorted[0];
        const upper = sorted.slice(1);
        const pairSpan = 2 * slot;
        const numPairs = Math.max(1, Math.floor(durationTicks / pairSpan));
        const out: StaffNote[] = [];
        for (let p = 0; p < numPairs; p++) {
            const pairStart = startTick + p * pairSpan;
            const boomBeat = baseBeat + (p * pairSpan) / TICKS_PER_QUARTER;
            const chickBeat = boomBeat + slot / TICKS_PER_QUARTER;
            const boomNote: any = {
                ...bass,
                id: crypto.randomUUID(),
                startTick: pairStart,
                durationTicks: slot,
                duration: info.duration,
                isDotted: info.isDotted,
                beat: boomBeat,
            };
            if (letRing) boomNote.playbackDurationTicks = endTick - pairStart;
            out.push(boomNote as StaffNote);
            for (const u of upper) {
                const chickStart = pairStart + slot;
                const chickNote: any = {
                    ...u,
                    id: crypto.randomUUID(),
                    startTick: chickStart,
                    durationTicks: slot,
                    duration: info.duration,
                    isDotted: info.isDotted,
                    beat: chickBeat,
                };
                if (letRing) chickNote.playbackDurationTicks = endTick - chickStart;
                out.push(chickNote as StaffNote);
            }
        }
        return out;
    }, [ticksToDurationInfo]);

    /** Ricalcola il voicing delle note SATB selezionate con la prossima disposizione nel ciclo. */
    const handleRevoice = useCallback(() => {
        if (selectedNoteIds.size === 0) return;

        // ── Branch ACC: le note selezionate sono sulla traccia di accompagnamento ──
        const firstSelId = [...selectedNoteIds][0];
        if (isAccompanimentNote(firstSelId, latestAccompanimentTracks.current)) {
            const accInfo = findAccTrackForNote(firstSelId, latestAccompanimentTracks.current);
            if (!accInfo) return;
            const trackIdx = accInfo.trackIndex;
            const accTrack = latestAccompanimentTracks.current[trackIdx];
            if (!accTrack) return;
            const accNotes = accTrack.notes as any[];
            const staffMode = (accTrack as any).staffMode ?? 'grandstaff';

            // Collect selected non-rest notes, then expand by chordGroupId so that even
            // a single selected note from an arpeggio/broken pattern revoices the whole chord.
            const rawSelNotes = accNotes.filter((n: any) => selectedNoteIds.has(n.id) && !n.isRest);
            if (rawSelNotes.length === 0) return;
            const selectedGroupIds = new Set<string>();
            for (const n of rawSelNotes) {
                const gid = (n as any).chordGroupId;
                if (gid) selectedGroupIds.add(String(gid));
            }
            const selNotes = selectedGroupIds.size > 0
                ? accNotes.filter((n: any) => !n.isRest && (selectedNoteIds.has(n.id) || (n.chordGroupId && selectedGroupIds.has(String(n.chordGroupId)))))
                : rawSelNotes;

            const uniqueTicks = new Set<number>(selNotes.map((n: any) => Number(n.startTick ?? 0)));

            // ── Multi-tick path: arpeggio / broken ──
            // Reuse the EXACT Block-SATB cycling logic (revoiceChordAtTick + VOICING_DISPOSITIONS):
            // 1) dedup pitches, 2) build a fake-voiced block at chordStartTick,
            // 3) loop through dispositions until one yields a voicing different from current,
            // 4) apply the current toolbar pattern to the resulting block.
            // Also enter this path when notes are all at the same tick (block chord)
            // but the current pattern is not 'block' — so switching back from block
            // to an arpeggio pattern correctly re-expands the chord.
            if (uniqueTicks.size > 1 || accPatternRef.current !== 'block') {
                const byMidi = new Map<number, any>();
                for (const n of selNotes) {
                    const m = Number(n.midi ?? 0);
                    if (!byMidi.has(m)) byMidi.set(m, n);
                }
                const sortedPitches = [...byMidi.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([, n]) => n);

                if (sortedPitches.length < 2) return;

                const chordStartTick = Math.min(...selNotes.map((n: any) => Number(n.startTick ?? 0)));
                const chordEndTick   = Math.max(...selNotes.map((n: any) => Number(n.startTick ?? 0) + Number(n.durationTicks ?? 0)));
                const totalDurTicks  = chordEndTick - chordStartTick;
                const measureIndex   = Number(selNotes[0].measureIndex ?? 0);
                const chordBeat      = Number(selNotes[0].beat ?? 1);
                const existingGroupId = (selNotes[0] as any).chordGroupId || crypto.randomUUID();

                // Fake-voiced block — SAME assignment as the single-tick (Block-SATB) path.
                const fakeVoices: (1|2|3|4)[] = [4, 3, 2, 1];
                const fakeNotes = sortedPitches.map((p: any, i: number) => ({
                    ...p,
                    voice: fakeVoices[Math.min(i, fakeVoices.length - 1)],
                    startTick: chordStartTick,
                    durationTicks: totalDurTicks,
                    measureIndex,
                    beat: chordBeat,
                }));

                // Find the next disposition that actually produces a DIFFERENT voicing.
                // (For triads, dispositions 4-6 duplicate 1-3 — looping skips those.)
                const currentKey = sortedPitches.map((p: any) => Number(p.midi)).sort((a, b) => a - b).join(',');
                const measureActiveAcc = buildMeasureAccidentals(accNotes as any, measureIndex, chordStartTick);

                let foundIdx = revoiceDispIdx;
                let foundNotes: StaffNote[] | null = null;
                for (let k = 1; k <= VOICING_DISPOSITIONS.length; k++) {
                    const tryIdx = (revoiceDispIdx + k) % VOICING_DISPOSITIONS.length;
                    const disposition = VOICING_DISPOSITIONS[tryIdx] as VoicingDisposition;
                    const candidate = revoiceChordAtTick(fakeNotes as any, chordStartTick, disposition, keySignature, null, measureActiveAcc);
                    if (!candidate || candidate.length === 0) continue;
                    const candKey = candidate.map((n: any) => Number(n.midi)).sort((a, b) => a - b).join(',');
                    if (candKey !== currentKey) {
                        foundIdx = tryIdx;
                        foundNotes = candidate;
                        break;
                    }
                }
                if (!foundNotes) return;
                setRevoiceDispIdx(foundIdx);

                // Map SATB-voiced result to voice=0 block notes for the pattern engine.
                const blockBase: StaffNote[] = foundNotes.map((n: any) => ({
                    ...n,
                    id: crypto.randomUUID(),
                    voice: 0 as any,
                    clef: (staffMode === 'treble_only' ? 'treble' : (Number(n.midi) >= 60 ? 'treble' : 'bass')) as 'treble' | 'bass',
                    startTick: chordStartTick,
                    durationTicks: totalDurTicks,
                    measureIndex,
                    beat: chordBeat,
                    chordGroupId: existingGroupId,
                }));

                const subdivTicks = ({
                    'sixteenth': TICKS_PER_QUARTER / 4,
                    'eighth':    TICKS_PER_QUARTER / 2,
                    'quarter':   TICKS_PER_QUARTER,
                    'half':      TICKS_PER_QUARTER * 2,
                } as Record<string, number>)[quantizeGrid] ?? (TICKS_PER_QUARTER / 2);

                const newAccNotes = applyAccPattern(blockBase, chordStartTick, totalDurTicks, subdivTicks, accPatternRef.current, accLetRingRef.current);

                const replaceIds = new Set(selNotes.map((n: any) => n.id));
                setAccompanimentTracks(prev => prev.map((track, i) => {
                    if (i !== trackIdx) return track;
                    const kept = track.notes.filter((n: any) => !replaceIds.has(n.id));
                    return { ...track, notes: [...kept, ...newAccNotes].sort((a: any, b: any) => (a.startTick ?? 0) - (b.startTick ?? 0)) };
                }));
                setSelectedNoteIds(new Set(newAccNotes.map((n: any) => n.id)));
                newAccNotes.forEach((n: any) => { void playNoteRef.current?.(n); });
                return;
            }

            // ── Single-tick path: block chord ─ existing revoice logic ──
            const nextIdx = (revoiceDispIdx + 1) % VOICING_DISPOSITIONS.length;
            setRevoiceDispIdx(nextIdx);
            const disposition = VOICING_DISPOSITIONS[nextIdx] as VoicingDisposition;

            const accReplacements = new Map<string, any>();
            let accPrevVoicing: { soprano: number; alto: number; tenor: number; bass: number } | null = null;

            for (const tick of Array.from(uniqueTicks).sort((a, b) => a - b)) {
                const allAtTick = accNotes.filter((n: any) => Number(n.startTick ?? 0) === tick && !n.isRest);
                if (allAtTick.length < 2) continue;

                const sorted = [...allAtTick].sort((a: any, b: any) => Number(a.midi) - Number(b.midi));
                const fakeVoices: (1|2|3|4)[] = [4, 3, 2, 1];
                const fakeNotes = sorted.map((n: any, i: number) => ({
                    ...n,
                    voice: fakeVoices[Math.min(i, fakeVoices.length - 1)],
                }));

                const tickMeasure = (allAtTick[0] as any).measureIndex ?? 0;
                const measureActiveAcc = buildMeasureAccidentals(accNotes as any, tickMeasure, tick);
                const newSATBNotes = revoiceChordAtTick(fakeNotes as any, tick, disposition, keySignature, accPrevVoicing, measureActiveAcc);
                if (!newSATBNotes) continue;

                const sop = newSATBNotes.find(n => Number(n.voice) === 1);
                const alt = newSATBNotes.find(n => Number(n.voice) === 2);
                const ten = newSATBNotes.find(n => Number(n.voice) === 3);
                const bas = newSATBNotes.find(n => Number(n.voice) === 4);
                if (sop && alt && ten && bas) {
                    accPrevVoicing = { soprano: Number((sop as any).midi), alto: Number((alt as any).midi), tenor: Number((ten as any).midi), bass: Number((bas as any).midi) };
                }

                for (const newN of newSATBNotes) {
                    const orig = fakeNotes.find((f: any) => Number(f.voice) === Number((newN as any).voice));
                    if (!orig) continue;
                    accReplacements.set(orig.id, {
                        ...newN,
                        id: orig.id,
                        voice: 0 as any,
                        clef: staffMode === 'treble_only' ? 'treble' : ((newN as any).midi >= 60 ? 'treble' : 'bass'),
                    });
                }
            }

            if (accReplacements.size === 0) return;
            setAccompanimentTracks(prev => prev.map((track, i) => {
                if (i !== trackIdx) return track;
                return { ...track, notes: track.notes.map(n => accReplacements.get((n as any).id) ?? n) };
            }));
            return;
        }

        // ── Branch SATB (percorso esistente, invariato) ──
        const allNotes = latestRawNotes.current as any[];

        // Raggruppa le note selezionate per startTick (ogni gruppo = un accordo)
        const tickGroups = new Map<number, any[]>();
        for (const n of allNotes) {
            if (!selectedNoteIds.has(n.id) || n.isRest) continue;
            const t = Number(n.startTick ?? 0);
            if (!tickGroups.has(t)) tickGroups.set(t, []);
            tickGroups.get(t)!.push(n);
        }
        if (tickGroups.size === 0) return;

        // Avanza all'indice successivo
        const nextIdx = (revoiceDispIdx + 1) % VOICING_DISPOSITIONS.length;
        setRevoiceDispIdx(nextIdx);
        const disposition = VOICING_DISPOSITIONS[nextIdx] as VoicingDisposition;

        // Ordina i tick per applicare voice leading progressivo
        const sortedTicks = Array.from(tickGroups.keys()).sort((a, b) => a - b);

        let prevVoicing: { soprano: number; alto: number; tenor: number; bass: number } | null = null;
        // Recupera voicing precedente al primo tick selezionato per voice leading
        try {
            const firstTick = sortedTicks[0];
            const prevNotes = allNotes.filter(n =>
                typeof n.startTick === 'number' && n.startTick < firstTick && !n.isRest
            );
            if (prevNotes.length >= 4) {
                const maxT = Math.max(...prevNotes.map((n: any) => Number(n.startTick)));
                const atMax = prevNotes.filter((n: any) => Number(n.startTick) === maxT);
                const byV: Record<number, number> = {};
                atMax.forEach((n: any) => { byV[Number(n.voice ?? 0)] = Number(n.midi); });
                if (byV[1] && byV[2] && byV[3] && byV[4]) {
                    prevVoicing = { soprano: byV[1], alto: byV[2], tenor: byV[3], bass: byV[4] };
                }
            }
        } catch { /* ignora */ }

        const replacements = new Map<string, any>();
        for (const tick of sortedTicks) {
            const tickNote = allNotes.find((n: any) => Number(n.startTick) === tick);
            const tickMeasure = (tickNote as any)?.measureIndex ?? 0;
            const measureActiveAcc = buildMeasureAccidentals(allNotes as any, tickMeasure, tick, selectedNoteIds);

            const newNotes = revoiceChordAtTick(allNotes as any, tick, disposition, keySignature, prevVoicing, measureActiveAcc);
            if (newNotes) {
                for (const n of newNotes) replacements.set((n as any).id, n);
                const sop = newNotes.find(n => Number(n.voice) === 1);
                const alt = newNotes.find(n => Number(n.voice) === 2);
                const ten = newNotes.find(n => Number(n.voice) === 3);
                const bas = newNotes.find(n => Number(n.voice) === 4);
                if (sop && alt && ten && bas) {
                    prevVoicing = { soprano: Number((sop as any).midi), alto: Number((alt as any).midi), tenor: Number((ten as any).midi), bass: Number((bas as any).midi) };
                }
            }
        }

        if (replacements.size === 0) return;
        setRawNotes(prev => (prev || []).map(n => replacements.get((n as any).id) ?? n));
    }, [selectedNoteIds, revoiceDispIdx, keySignature, quantizeGrid, applyAccPattern, setRawNotes, setAccompanimentTracks, setSelectedNoteIds]);

    /** Inserisce un accordo dalla sigla (es. "Cmaj7/E") alla posizione della playhead.
     * Restituisce { startTick, durTicks } per permettere al chiamante di avanzare il caret,
     * oppure null se la sigla non è valida. */
    const handleChordInsert = useCallback((symbol: string): { startTick: number; durTicks: number } | null => {
        const parsed = parseChordSymbol(symbol);
        if (!parsed) { setChordInputError(true); return null; }

        let measureIndex = 0;
        let beat = 1;
        const ld = layoutDataRef.current as any;
        const currentCaret = latestPasteCaretRef.current;
        if (currentCaret) {
            measureIndex = currentCaret.measureIndex;
            beat = currentCaret.beat;
        } else if (playheadPositionRef.current && ld?.systemsParams) {
            const sys = ld.systemsParams[playheadPositionRef.current.systemIndex];
            if (sys) {
                let bestIdx = 0;
                let bestDist = Infinity;
                (sys.startMeasuresX as number[]).forEach((x, i) => {
                    const dist = Math.abs(x - playheadPositionRef.current!.x);
                    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                });
                measureIndex = sys.measureIndices[bestIdx] ?? 0;
            }
        }

        const bpmLocal = ld?.measureBeatsPerMeasure?.[measureIndex]
            ?? (timeSignature.numerator * (4 / timeSignature.denominator));
        const measureStartAbs = ld?.measureStartAbsBeat?.[measureIndex] ?? (measureIndex * bpmLocal);
        const startTick = Math.round((measureStartAbs + (beat - 1)) * TICKS_PER_QUARTER);

        const dummyNote = { duration: selectedInsertion.duration, isDotted: selectedInsertion.isDotted ?? false, isTriplet, isDuplet } as any;
        const durTicks = computeDurationTicks(dummyNote);

        // ── ACC chord insertion (block / arpeggio_up / arpeggio_down / broken) ──
        if (activeStaffAreaRef.current === 'accompaniment') {
            const firstVisibleIdx = resolveActiveAccIdx(latestAccompanimentTracks.current);
            if (firstVisibleIdx === -1) return null;
            const firstVisibleTrack = latestAccompanimentTracks.current[firstVisibleIdx];
            const staffMode = (firstVisibleTrack as any).staffMode ?? 'grandstaff';

            const accAccidentals = buildMeasureAccidentals(firstVisibleTrack.notes as any, measureIndex, startTick);
            const satbNotes = buildChordSATBNotes(parsed, measureIndex, beat, startTick,
                selectedInsertion.duration, durTicks, keySignature, null, accAccidentals);

            // chordGroupId ties together all notes generated from one chord-insert action
            // (block, or all sequential notes of an arpeggio/broken pattern). Re-Voice uses
            // it to expand a partial selection back to the full chord.
            const chordGroupId = crypto.randomUUID();
            const blockAccNotes: StaffNote[] = satbNotes.map(n => ({
                ...n,
                id: crypto.randomUUID(),
                voice: 0 as any,
                chordGroupId,
                clef: (staffMode === 'treble_only' ? 'treble' : ((n as any).midi >= 60 ? 'treble' : 'bass')) as 'treble' | 'bass',
            }));

            const subdivisionTicks = ({
                'sixteenth': TICKS_PER_QUARTER / 4,
                'eighth':    TICKS_PER_QUARTER / 2,
                'quarter':   TICKS_PER_QUARTER,
                'half':      TICKS_PER_QUARTER * 2,
            } as Record<string, number>)[quantizeGrid] ?? TICKS_PER_QUARTER;
            const accNotes = applyAccPattern(blockAccNotes, startTick, durTicks, subdivisionTicks, accPatternRef.current, accLetRingRef.current);

            // Overwrite any pre-existing notes that fall inside the chord's time window.
            const endTick = startTick + durTicks;
            setAccompanimentTracks(prev => prev.map((track, i) => {
                if (i !== firstVisibleIdx) return track;
                const filtered = track.notes.filter(n => {
                    const s = (n as any).startTick ?? 0;
                    return s < startTick || s >= endTick;
                });
                return {
                    ...track,
                    notes: [...filtered, ...accNotes].sort((a, b) =>
                        ((a as any).startTick ?? 0) - ((b as any).startTick ?? 0)
                    ),
                };
            }));

            setChordInputText('');
            setChordInputError(false);
            setSelectedNoteIds(new Set(accNotes.map(n => n.id)));
            accNotes.forEach(n => { void playNoteRef.current?.(n); });
            return { startTick, durTicks };
        }

        // ── SATB insertion (percorso esistente, invariato) ──
        let prevVoicing: { soprano: number; alto: number; tenor: number; bass: number } | null = null;
        try {
            const allNotes = (latestRawNotes.current || []) as any[];
            const prevNotes = allNotes.filter(n =>
                typeof n.startTick === 'number' && n.startTick < startTick && !n.isRest
            );
            if (prevNotes.length >= 4) {
                const maxTick = Math.max(...prevNotes.map((n: any) => n.startTick as number));
                const atMaxTick = prevNotes.filter((n: any) => n.startTick === maxTick);
                const byVoice: Record<number, number> = {};
                atMaxTick.forEach((n: any) => { byVoice[Number(n.voice ?? 0)] = Number(n.midi); });
                if (byVoice[1] && byVoice[2] && byVoice[3] && byVoice[4]) {
                    prevVoicing = { soprano: byVoice[1], alto: byVoice[2], tenor: byVoice[3], bass: byVoice[4] };
                }
            }
        } catch { /* ignora */ }

        const activeAccidentals = buildMeasureAccidentals(latestRawNotes.current as any, measureIndex, startTick);

        const notes = buildChordSATBNotes(parsed, measureIndex, beat, startTick,
            selectedInsertion.duration, durTicks, keySignature, prevVoicing, activeAccidentals);

        setRawNotes(prev => [...(prev || []), ...notes]);
        setChordInputText('');
        setChordInputError(false);

        return { startTick, durTicks };
    }, [timeSignature, selectedInsertion, isTriplet, isDuplet, computeDurationTicks, keySignature, quantizeGrid, setRawNotes, setAccompanimentTracks, setSelectedNoteIds, applyAccPattern]);

    const mod12Local = useCallback((n: number) => ((n % 12) + 12) % 12, []);

    const makeNoteNameFromPitchAndMidi = useCallback((pitch: string, midi: number): string => {
        const baseByPitch: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const base = baseByPitch[pitch] ?? 0;
        const pc = mod12Local(midi);
        const diff = mod12Local(pc - base); // 0..11
        const suffix =
            diff === 0 ? '' :
            diff === 1 ? '#' :
            diff === 2 ? '##' :
            diff === 11 ? 'b' :
            diff === 10 ? 'bb' : '';
        return `${pitch}${suffix}`;
    }, [mod12Local]);

    const keyAccidentals = useMemo(() => {
        const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
        const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
        return keySignature.type === 'sharp' ? sharpNotes.map(n => n + '#') : flatNotes.map(n => n + 'b');
    }, [keySignature.count, keySignature.type]);

    const noteNameToChromaticIndex = useCallback((name: string): number => {
        const idxSharp = NOTE_NAMES.indexOf(name);
        if (idxSharp >= 0) return idxSharp;
        const normalized = name.replace('♯', '#').replace('♭', 'b');
        for (let i = 0; i < ALL_NOTE_SPELLINGS.length; i++) {
            if (ALL_NOTE_SPELLINGS[i].includes(normalized)) return i;
        }
        return -1;
    }, []);

    const preferFlats = useMemo(() => keySignature.type === 'flat' && keySignature.count > 0, [keySignature.count, keySignature.type]);
    const modalTonicOptions = useMemo(() => {
        return ALL_NOTE_SPELLINGS.map((names, idx) => {
            const natural = names.find(n => !n.includes('#') && !n.includes('b'));
            const sharp = names.find(n => n.includes('#') && !CROSS_LETTER_ENHARMONICS.has(n));
            const flat = names.find(n => n.includes('b') && !CROSS_LETTER_ENHARMONICS.has(n));

            const label = preferFlats
                ? (flat ?? natural ?? sharp ?? names[0])
                : (sharp ?? natural ?? flat ?? names[0]);
            return { value: label, label, idx };
        });
    }, [preferFlats]);

    const signedKeyDelta = useCallback((fromRoot: string, toRoot: string, notesForHeuristic?: any[]): number => {
        const fromIdx = noteNameToChromaticIndex(fromRoot);
        const toIdx = noteNameToChromaticIndex(toRoot);
        if (fromIdx < 0 || toIdx < 0) return 0;

        const up = ((toIdx - fromIdx) % 12 + 12) % 12;
        const down = up - 12;

        // If we don't have notes to judge by, fall back to the smallest motion.
        const notes = (notesForHeuristic || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
        if (notes.length === 0) {
            return Math.abs(down) < Math.abs(up) ? down : up;
        }

        // SATB-ish written MIDI ranges (C4=60). These are intentionally generous.
        const rangesByVoice: Record<number, { min: number; max: number }> = {
            1: { min: 60, max: 84 }, // S
            2: { min: 55, max: 79 }, // A
            3: { min: 48, max: 72 }, // T
            4: { min: 40, max: 64 }, // B
        };
        const rangeFromClef = (clef: ClefType | string | undefined) => {
            const c = (clef || 'treble') as any;
            return c === 'bass' ? { min: 40, max: 64 } : { min: 55, max: 84 };
        };

        const scoreDelta = (d: number): number => {
            let score = 0;
            for (const n of notes) {
                const v = Number((n as any).voice);
                const r = Number.isFinite(v) && rangesByVoice[v] ? rangesByVoice[v] : rangeFromClef((n as any).clef);
                const next = (n as any).midi + d;

                // Penalize register violations heavily.
                if (next < r.min) {
                    const dist = r.min - next;
                    score += 1000 * dist * dist;
                } else if (next > r.max) {
                    const dist = next - r.max;
                    score += 1000 * dist * dist;
                }
            }
            // Prefer smaller overall motion when both are in-range.
            score += notes.length * (d * d);
            return score;
        };

        const scoreUp = scoreDelta(up);
        const scoreDown = scoreDelta(down);
        return scoreDown < scoreUp ? down : up;
    }, [noteNameToChromaticIndex]);

    const modeInfo = useMemo(() => {
        if (keyChangeMode !== 'modal') return null;

        const firstNote = rawNotes.find(n => !n.isRest);
        const autoTonic = firstNote ? makeNoteNameFromPitchAndMidi(firstNote.pitch, firstNote.midi) : '';
        const tonicName = (modalTonicOverride || autoTonic || '').replace('♯', '#').replace('♭', 'b');
        if (!tonicName) return { tonicName: '', label: '' };

        const keyRootIdx = noteNameToChromaticIndex(keySignatureRoot);
        const tonicIdx = noteNameToChromaticIndex(tonicName);
        if (keyRootIdx < 0 || tonicIdx < 0) {
            return { tonicName, label: `Modo: ${tonicName} (non determinabile)` };
        }

        const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
        const scale = majorIntervals.map(i => mod12Local(keyRootIdx + i));
        const degree = scale.indexOf(tonicIdx);
        const modeNamesIt = ['Ionio', 'Dorico', 'Frigio', 'Lidio', 'Misolidio', 'Eolio', 'Locrio'];

        if (degree < 0) {
            return { tonicName, label: `Modo: ${tonicName} (fuori scala)` };
        }

        const mode = modeNamesIt[degree] ?? '—';
        return { tonicName, label: `Modo: ${tonicName} ${mode}` };
    }, [keyChangeMode, keySignatureRoot, makeNoteNameFromPitchAndMidi, modalTonicOverride, mod12Local, noteNameToChromaticIndex, rawNotes]);

    const transposeAllNotesToKey = useCallback((fromRoot: string, toRoot: string) => {
        const delta = signedKeyDelta(fromRoot, toRoot, latestRawNotes.current);
        if (!delta) return;

        const targetKeySignature = getKeySignature(toRoot, 'Major');

        setRawNotes(prev => prev.map((n) => {
            if (n.isRest) return n;

            const currentClef = (n.clef || 'treble') as ClefType;
            const a = (n.explicitAccidental ?? n.accidental ?? null) as AccidentalType | null;
            const preferredAccidental: AccidentalType | null =
                a === 'sharp' || a === 'double-sharp'
                    ? 'sharp'
                    : a === 'flat' || a === 'double-flat'
                        ? 'flat'
                        : null;

            const nextMidi = n.midi + delta;
            const recalculated = getNotePropertiesFromMidi(nextMidi, targetKeySignature, currentClef, preferredAccidental);

            return {
                ...n,
                ...recalculated,
                id: n.id,
                midi: nextMidi,
            };
        }));
    }, [setRawNotes, signedKeyDelta]);

    // Track the last key change so toggling "Trasponi" can retroactively apply/revert.
    const lastKeyChangeRef = useRef<null | { fromRoot: string; toRoot: string; transposedApplied: boolean }>(null);

    const setTransposeKeyChangeEnabled = useCallback((enabled: boolean) => {
        // If modal mode is active, keep it modal; transpose is mutually exclusive.
        if (enabled) {
            if (keyChangeMode === 'transpose') return;
            // If the last key change happened with transpose disabled, apply it now.
            const last = lastKeyChangeRef.current;
            if (last && !last.transposedApplied && last.fromRoot !== last.toRoot) {
                transposeAllNotesToKey(last.fromRoot, last.toRoot);
                lastKeyChangeRef.current = { ...last, transposedApplied: true };
            }
            setKeyChangeMode('transpose');
            return;
        }

        // Disabling: if transpose was applied for the last change, revert it.
        if (keyChangeMode !== 'transpose') {
            setKeyChangeMode('none');
            return;
        }
        const last = lastKeyChangeRef.current;
        if (last && last.transposedApplied && last.fromRoot !== last.toRoot) {
            transposeAllNotesToKey(last.toRoot, last.fromRoot);
            lastKeyChangeRef.current = { ...last, transposedApplied: false };
        }
        setKeyChangeMode('none');
    }, [keyChangeMode, setKeyChangeMode, transposeAllNotesToKey]);

    const reinterpretAllNotesModallyInKey = useCallback((toRoot: string) => {
        const targetKeySignature = getKeySignature(toRoot, 'Major');

        const keyAlterationAmountForPitch = (pitch: string) => {
            const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, targetKeySignature.type === 'sharp' ? targetKeySignature.count : 0);
            const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, targetKeySignature.type === 'flat' ? targetKeySignature.count : 0);
            return (targetKeySignature.type === 'sharp' && sharpNotes.includes(pitch)) ? 1 :
                (targetKeySignature.type === 'flat' && flatNotes.includes(pitch)) ? -1 : 0;
        };

        const accidentalOffset = (a: AccidentalType) =>
            a === 'sharp' ? 1 :
            a === 'flat' ? -1 :
            a === 'double-sharp' ? 2 :
            a === 'double-flat' ? -2 : 0;

        setRawNotes(prev => prev.map((n) => {
            if (n.isRest) return n;

            const currentClef = (n.clef || 'treble') as ClefType;
            const base = getNotePropertiesFromDiatonicPosition(n.position, currentClef, targetKeySignature);

            const userAcc = ((n as any).userAccidental ?? null) as AccidentalType | null;
            if (!userAcc) {
                return {
                    ...n,
                    ...base,
                    id: n.id,
                    explicitAccidental: null,
                    accidental: undefined,
                };
            }

            const keyAlt = keyAlterationAmountForPitch(base.pitch);
            const naturalMidi = base.midi - keyAlt;
            const finalMidi = naturalMidi + accidentalOffset(userAcc);

            return {
                ...n,
                ...base,
                id: n.id,
                midi: finalMidi,
                noteIndex: mod12Local(finalMidi),
                explicitAccidental: userAcc,
                accidental: userAcc,
            };
        }));
    }, [mod12Local, setRawNotes]);

    const handleKeySignatureRootChange = useCallback((nextRoot: string) => {
        if (nextRoot === keySignatureRoot) return;

        const fromRoot = keySignatureRoot;
        const isTranspose = keyChangeMode === 'transpose';

        if (isTranspose) {
            transposeAllNotesToKey(fromRoot, nextRoot);
        } else if (keyChangeMode === 'modal') {
            // Modal reinterpretation is a different operation; don't reuse last-key-change transpose state.
            reinterpretAllNotesModallyInKey(nextRoot);
            lastKeyChangeRef.current = null;
            setKeySignatureRoot(nextRoot);
            return;
        } else {
            // 'none' mode: re-spell notes enharmonically for the new key
            // signature without transposing (same sounding pitch, different
            // notation).  This is what the user expects when switching the
            // displayed key after a MIDI import.
            try {
                const targetKeySignature = getKeySignature(nextRoot, 'Major');
                setRawNotes(prev => prev.map((n) => {
                    try {
                        if (n.isRest || !Number.isFinite(n.midi)) return n;
                        const currentClef = (n.clef || 'treble') as ClefType;
                        // Pass null: let the function choose the best spelling
                        // based on the TARGET key signature (not the current accidental).
                        const recalculated = getNotePropertiesFromMidi(n.midi, targetKeySignature, currentClef, null);
                        return {
                            ...n,
                            ...recalculated,
                            // Sync .accidental with the new explicit accidental
                            accidental: recalculated.explicitAccidental,
                            // Clear any user override so normalizedRawNotes
                            // doesn't revert the spelling.
                            userAccidental: undefined,
                            id: n.id,
                            midi: n.midi,
                        };
                    } catch { return n; }
                }));
            } catch { /* ignore */ }
        }

        // Record last key change so the transpose checkbox can apply/revert even if toggled after.
        lastKeyChangeRef.current = { fromRoot, toRoot: nextRoot, transposedApplied: isTranspose };
        setKeySignatureRoot(nextRoot);
    }, [keyChangeMode, keySignatureRoot, reinterpretAllNotesModallyInKey, setKeySignatureRoot, setRawNotes, transposeAllNotesToKey]);

    const { currentTonic, currentQuality } = useMemo(() => {
        if (isMinorMode) {
            const minorRoot = relativeMinors[keySignatureRoot] || 'A';
            return { currentTonic: minorRoot, currentQuality: 'Minore' };
        }
        return { currentTonic: keySignatureRoot, currentQuality: 'Maggiore' };
    }, [keySignatureRoot, isMinorMode]);

    const normalizedRawNotes = useMemo(() => {
        const basePc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
        const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

        const keySigAccidentalForLetter = (letter: string): number => {
            const l = (letter || '').toUpperCase();
            if (!l || !basePc.hasOwnProperty(l)) return 0;
            if (keySignature.type === 'sharp' && keySignature.count > 0) {
                return sharpOrder.slice(0, keySignature.count).includes(l) ? 1 : 0;
            }
            if (keySignature.type === 'flat' && keySignature.count > 0) {
                return flatOrder.slice(0, keySignature.count).includes(l) ? -1 : 0;
            }
            return 0;
        };

        const accidentalToDelta = (acc: any): number => {
            switch (acc) {
                case 'sharp': return 1;
                case 'flat': return -1;
                case 'natural': return 0;
                  case 'doubleSharp':
                  case 'double-sharp':
                      return 2;
                  case 'doubleFlat':
                  case 'double-flat':
                      return -2;
                default: return 0;
            }
        };

        // Sort by measure / startTick / voice so we can propagate accidentals
        // within each measure (same voice, same pitch+octave) like in standard notation.
        const sorted = (rawNotes || []).slice().sort((a: any, b: any) => {
            const ma = Number(a?.measureIndex ?? 0);
            const mb = Number(b?.measureIndex ?? 0);
            if (ma !== mb) return ma - mb;
            const ta = Number(a?.startTick ?? 0);
            const tb = Number(b?.startTick ?? 0);
            if (ta !== tb) return ta - tb;
            return (a?.voice ?? 1) - (b?.voice ?? 1);
        });

        // Track accidental state per measure+voice+pitch+octave.
        // Key: "measure-voice-letter-octave", value: delta (from explicit accidental).
        const accState = new Map<string, number>();

        const result = sorted.map((n: any) => {
            try {
                if (!n || n.isRest) return n;
                const letter = String(n.pitch || '').charAt(0).toUpperCase();
                if (!basePc.hasOwnProperty(letter)) return n;
                const octave = Number(n.octave);
                if (!Number.isFinite(octave)) return n;

                const measureIdx = Number(n.measureIndex ?? 0);
                const voice = Number(n.voice ?? 1);
                const stateKey = `${measureIdx}-${voice}-${letter}-${octave}`;

                const explicit = (n.explicitAccidental ?? n.userAccidental ?? null) as any;
                let delta: number;
                if (explicit != null) {
                    delta = accidentalToDelta(explicit);
                    // Record this explicit accidental for subsequent notes in the same measure
                    accState.set(stateKey, delta);
                } else {
                    // Check if a previous note in the same measure/voice/pitch+octave set an accidental
                    const carried = accState.get(stateKey);
                    delta = (carried != null) ? carried : keySigAccidentalForLetter(letter);
                }

                const noteIndex = ((basePc[letter] + delta) % 12 + 12) % 12;
                const rawPc = basePc[letter] + delta;
                let octaveAdj = octave;
                if (rawPc < 0) octaveAdj -= 1;
                else if (rawPc >= 12) octaveAdj += 1;
                const midi = (octaveAdj + 1) * 12 + noteIndex;

                const curIdx = Number(n.noteIndex);
                const curMidi = Number(n.midi);
                const needsIdx = !Number.isFinite(curIdx) || (((curIdx % 12) + 12) % 12) !== noteIndex;
                const needsMidi = !Number.isFinite(curMidi) || curMidi !== midi;

                // Also heal stale `accidental` field — legacy files may have 'natural'
                // for notes that should be 'flat' or 'sharp' per the key signature,
                // or may be missing the field entirely (undefined).
                const expectedAcc: AccidentalType = delta === 0 ? 'natural' : delta === 1 ? 'sharp' : delta === -1 ? 'flat' : delta === 2 ? 'double-sharp' : delta === -2 ? 'double-flat' : 'natural';
                const curAcc = (n as any).accidental;
                const needsAcc = curAcc !== expectedAcc;

                if (!needsIdx && !needsMidi && !needsAcc) return n;
                return { ...n, noteIndex, midi, accidental: expectedAcc };
            } catch {
                return n;
            }
        });

        return result;
    }, [rawNotes, keySignature]);

    const notes = useMemo(() => {
        try {
            return calculateNoteBeats(normalizedRawNotes, timeSignature, timeSignatureChanges);
        } catch (e) {
            console.error('[GrandStaffEditor] calculateNoteBeats crashed:', e);
            return normalizedRawNotes || [];
        }
    }, [normalizedRawNotes, timeSignature, timeSignatureChanges]);

    // Editor zoom (extracted to useEditorZoom hook)
    const { editorZoom, resetEditorZoom, handleScoreMouseDownCapture, zoomSpacerRef, zoomBaseSize } = useEditorZoom(scoreScrollRef, staffContainerRef);

    const [marqueeSelectOnlyCurrentVoice, setMarqueeSelectOnlyCurrentVoice] = usePreference<boolean>('editor.selectOnlyCurrentVoice');

    const [exportIncludeTitle] = usePreference<boolean>('export.includeTitle');

    // Keep native Electron menu checkmarks in sync with renderer state.
    useMenuStateSync({
        selectOnlyCurrentVoiceEnabled: marqueeSelectOnlyCurrentVoice,
        showMeasureNumbersEnabled: showMeasureNumbers,
        showHarmonyDebugEnabled: showHarmonyDebug,
        showVoiceColorsEnabled: showVoiceColors,
        showQuickInsertBarEnabled: showQuickInsertBar,
        engravingMode,
    });


    // Mantieni latestRawNotes aggiornato
    useEffect(() => {
        latestRawNotes.current = normalizedRawNotes as any;
    }, [normalizedRawNotes]);
    // (No external paste bridge globals here)


    // Funzione robusta per gestire tutte le azioni del menu di Electron
    const buildExportHtml = useCallback((): string | null => {
        const container = staffContainerRef.current;
        if (!container) return null;
        try {
            const head = document.head.innerHTML;
            const baseHref = String(document.baseURI || window.location.href || '');

            const content = (() => {
                try {
                    const clone = container.cloneNode(true) as HTMLElement;

                    // Replace the editable title <input> with a print-friendly static title,
                    // or remove it entirely if exportIncludeTitle is OFF.
                    const titleInput = clone.querySelector('input[placeholder="Titolo"]') as HTMLInputElement | null;
                    if (titleInput) {
                        const wrapper = titleInput.closest('div');
                        const titleText = String(projectTitle || titleInput.value || '').trim();

                        if (!exportIncludeTitle || !titleText) {
                            (wrapper ?? titleInput).remove();
                        } else {
                            const titleDiv = document.createElement('div');
                            titleDiv.textContent = titleText;
                            titleDiv.style.textAlign = 'center';
                            titleDiv.style.fontWeight = '600';
                            titleDiv.style.color = '#1f2937';
                            titleDiv.style.marginBottom = '12px';
                            titleDiv.style.fontSize = `${titleFontSize}px`;
                            titleDiv.style.fontFamily = String(titleFontFamily || 'serif');
                            if (wrapper) wrapper.replaceWith(titleDiv);
                            else titleInput.replaceWith(titleDiv);
                        }
                    }

                    // Export layout: make each rendered system fluid (no fixed pixel width).
                    try {
                        const systemEls = Array.from(clone.querySelectorAll('[data-system-index]')) as HTMLElement[];
                        for (const el of systemEls) {
                            el.style.width = '100%';
                            el.style.maxWidth = '100%';
                            el.style.overflow = 'visible';
                        }
                    } catch {
                        // ignore
                    }

                    // Critical for PDF: without viewBox, shrinking width clips SVG content.
                    // Add a viewBox from the original width/height and make width fluid.
                    try {
                        const svgs = Array.from(clone.querySelectorAll('svg')) as SVGSVGElement[];
                        for (const svg of svgs) {
                            const w = Number(svg.getAttribute('width') || svg.clientWidth || 0);
                            const h = Number(svg.getAttribute('height') || svg.clientHeight || 0);
                            if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                                if (!svg.getAttribute('viewBox')) {
                                    svg.setAttribute('viewBox', `0 0 ${Math.round(w)} ${Math.round(h)}`);
                                }
                                svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
                            }
                            svg.setAttribute('width', '100%');
                            svg.style.width = '100%';
                            svg.style.maxWidth = '100%';
                            svg.style.height = 'auto';
                        }
                    } catch {
                        // ignore
                    }

                    return clone.innerHTML;
                } catch {
                    return container.innerHTML;
                }
            })();

                        return `<!doctype html><html><head><base href="${baseHref}">${head}<style>
                              @page { size: A4 ${canvasFormat === 'page' ? 'portrait' : 'landscape'}; margin: 8mm; }
                              html{overflow:visible !important;}
                              body{background:white;margin:0;padding:8px;overflow:visible !important;width:100% !important;box-sizing:border-box;}
                              .ht-staff-container{width:100% !important;max-width:100% !important;overflow:visible !important;}
                              [data-system-index]{width:100% !important;max-width:100% !important;overflow:visible !important;}
                              svg{max-width:100%;width:100%;height:auto;overflow:visible !important;}
              /* Export/print mode: hide interactive overlays and analysis layers */
              .export-exclude{display:none !important;}
              input, textarea, select{display:none !important;}
            </style></head><body>${content}</body></html>`;
        } catch {
            return null;
        }
    }, [exportIncludeTitle, projectTitle, titleFontFamily, titleFontSize, canvasFormat]);

    // Print handler (moved above menu handler to avoid temporal dead zone): opens a print window for the staff container
    const handlePrint = useCallback(() => {
        const html = buildExportHtml();
        if (!html) return;

        const printWindow = window.open('', '_blank', 'width=1200,height=800');
        if (!printWindow) return;
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();

        // Trigger print once the content is loaded, then auto-close.
        try {
            const onAfterPrint = () => {
                try { printWindow.close(); } catch { /* ignore */ }
            };
            printWindow.addEventListener('afterprint', onAfterPrint);
            printWindow.addEventListener('load', () => {
                try { printWindow.focus(); } catch { /* ignore */ }
                try { printWindow.print(); } catch { /* ignore */ }
            }, { once: true });
        } catch {
            // ignore
        }
    }, [buildExportHtml]);

    const projectExtrasRef = useRef<Record<string, unknown>>(EMPTY_EXTRAS);
    const draftArgsRef = useRef<any>(null);

    const handleMenuActionLegacy = useCallback(async (action: MenuAction, payload: any) => {
        const api = window.electronAPI;

        if (action === 'increase-title-font') {
            setTitleFontSize(s => Math.min(72, s + 1));
            return;
        }
        if (action === 'decrease-title-font') {
            setTitleFontSize(s => Math.max(8, s - 1));
            return;
        }
        if ((action === 'edit-command' && payload && payload.command) || action === 'undo' || action === 'redo') {
            // Support both 'edit-command' payloads and role-based 'undo'/'redo' actions
            const command = (action === 'undo' || action === 'redo') ? action : payload.command;

            // Block copy/cut/paste when export is disabled by teacher lock.
            // The primary gate is the keydown interceptor (which alerts); this
            // is the defensive backstop when the action arrives via the
            // Electron Edit menu accelerator. Silent here to avoid a 2nd alert.
            if (lockHidesRef.current.export && (command === 'copy' || command === 'cut' || command === 'paste')) {
                return;
            }

            const isTypingTarget = (() => {
                try {
                    const el = (document.activeElement as HTMLElement | null);
                    if (!el) return false;
                    const tag = (el.tagName || '').toLowerCase();
                    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
                } catch {
                    return false;
                }
            })();

            // If the user is editing text (title/BPM/inputs), let menu operations behave like standard app edit commands.
            if (isTypingTarget) {
                const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
                if (command === 'paste' && el) {
                    navigator.clipboard.readText().then(text => {
                        if (!text) return;
                        // Insert at cursor position (or replace selection)
                        const start = el.selectionStart ?? el.value.length;
                        const end = el.selectionEnd ?? start;
                        const before = el.value.slice(0, start);
                        const after = el.value.slice(end);
                        el.value = before + text + after;
                        const newPos = start + text.length;
                        el.setSelectionRange(newPos, newPos);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }).catch(() => { /* clipboard access denied */ });
                } else if (command === 'copy' && el) {
                    const start = el.selectionStart ?? 0;
                    const end = el.selectionEnd ?? 0;
                    if (start !== end) {
                        navigator.clipboard.writeText(el.value.slice(start, end)).catch(() => {});
                    }
                } else if (command === 'cut' && el) {
                    const start = el.selectionStart ?? 0;
                    const end = el.selectionEnd ?? 0;
                    if (start !== end) {
                        navigator.clipboard.writeText(el.value.slice(start, end)).catch(() => {});
                        const before = el.value.slice(0, start);
                        const after = el.value.slice(end);
                        el.value = before + after;
                        el.setSelectionRange(start, start);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } else if (command === 'selectAll' && el) {
                    el.setSelectionRange(0, el.value.length);
                } else {
                    try { document.execCommand(command); } catch { /* ignore */ }
                }
                return;
            }

            if (command === 'copy') {
                const currentSelected = latestSelectedNoteIds.current;
                if (!currentSelected || currentSelected.size === 0) {
                    // Keep silent: menu copy should not pop errors when nothing is selected.
                    return;
                }
                const copied = copySelectedToClipboard();
                if (copied.length === 0) return;
                // Imposta un pasteMarker basato sul contenuto appena copiato (primo evento nel blocco)
                try {
                    if (copied && copied.length > 0) {
                        const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                        const starts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
                        const absBeats = copied.map(n => ((starts && starts[n.measureIndex ?? 0] != null)
                            ? (starts[n.measureIndex ?? 0] ?? 0)
                            : ((n.measureIndex ?? 0) * beatsPerMeasureLocal)) + ((n.beat ?? 1) - 1));
                        const baseAbs = Math.min(...absBeats);
                        const { measureIndex: measureIdx, beat: beatInMeasure } = getMeasureIndexAndBeatFromAbsBeat(baseAbs);
                        let systemIndex = 0;
                        if (layoutData && layoutData.systemsParams) {
                            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                                if (layoutData.systemsParams[si].measureIndices.includes(measureIdx)) { systemIndex = si; break; }
                            }
                        }
                        const marker = { systemIndex, measureIndex: measureIdx, beat: beatInMeasure, ts: Date.now() };
                        setPasteMarker(marker);
                    }
                } catch {
                    // ignore
                }
                // Imposta un marker logico per la successiva incolla via menù
                try {
                    let marker = null as any;
                    if (pasteCaret) {
                        marker = { systemIndex: pasteCaret.systemIndex, measureIndex: pasteCaret.measureIndex, beat: pasteCaret.beat, ts: Date.now() };
                    } else if (playheadPosition && layoutData && layoutData.systemsParams) {
                        const sysParams = layoutData.systemsParams[playheadPosition.systemIndex];
                        if (sysParams && sysParams.measureIndices && sysParams.startMeasuresX) {
                            let minDist = Infinity;
                            let bestIdx = 0;
                            for (let i = 0; i < sysParams.measureIndices.length; i++) {
                                const x = sysParams.startMeasuresX[i] ?? 0;
                                const dist = Math.abs(x - playheadPosition.x);
                                if (dist < minDist) {
                                    minDist = dist;
                                    bestIdx = i;
                                }
                            }
                            marker = { systemIndex: playheadPosition.systemIndex, measureIndex: sysParams.measureIndices[bestIdx] ?? 0, beat: 1, ts: Date.now() };
                        }
                    }
                    if (marker) setPasteMarker(marker);
                } catch {
                    // ignore
                }
                return;
            }
            if (command === 'cut') {
                if (selectedNoteIds.size === 0) return;
                const selected = rawNotes.filter(n => selectedNoteIds.has(n.id));
                const copied = selected.map(n => {
                    const { xPosition, ...rest } = n as any;
                    return rest as StaffNote;
                });
                setClipboard(copied);
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(JSON.stringify(copied)).catch(() => setCopyPasteError('Copia negli appunti di sistema fallita.'));
                }
                // Cancella le note selezionate
                setRawNotes(prev => prev.filter(n => !selectedNoteIds.has(n.id)));
                setSelectedNoteIds(new Set());
                return;
            }
            if (command === 'paste') {
                // Ref per clipboard aggiornata
                // Removed debug log
                // Se clipboard locale è vuota, prova a leggere dagli appunti di sistema
                if ((!latestClipboardRef.current || latestClipboardRef.current.length === 0) && navigator.clipboard && window.isSecureContext) {
                    // Removed debug log
                    navigator.clipboard.readText().then(text => {
                        try {
                            const parsed = JSON.parse(text);
                            if (Array.isArray(parsed) && parsed[0] && parsed[0].id) {
                                // Removed debug log
                                setClipboard(parsed);
                                setCopyPasteError(null);
                            } else {
                                // Removed debug log
                                setCopyPasteError('Nessun dato valido negli appunti.');
                            }
                        } catch {
                            // Removed debug log
                            setCopyPasteError('Dati negli appunti non validi');
                        }
                    }).catch(() => {
                        // Removed debug log
                        setCopyPasteError('Impossibile leggere dagli appunti di sistema.');
                    });
                    return;
                }
                // Prefer the explicit paste caret (set by click / note selection).
                // Fall back to the playback cursor (absBeat) if available.
                let caret = latestPasteCaretRef.current || pasteCaret || null;

                if (!caret && layoutData && Number.isFinite(playbackCursorAbsBeatRef.current) && playbackCursorAbsBeatRef.current >= 0) {
                    try {
                        const absBeat = playbackCursorAbsBeatRef.current as number;

                        const getDurationTicks = (n: StaffNote): number => {
                            try {
                                const dt = (n as any).durationTicks;
                                if (typeof dt === 'number' && isFinite(dt) && dt > 0) return Math.round(dt);
                                const base = (DURATION_VALUES as any)[(n as any).duration || 'quarter'] || 1;
                                let durBeats = base;
                                if ((n as any).isDotted) durBeats *= 1.5;
                                if ((n as any).isTriplet) durBeats *= 2 / 3;
                                if ((n as any).isDuplet) durBeats *= 3 / 2;
                                return Math.max(1, Math.round(durBeats * TICKS_PER_QUARTER));
                            } catch {
                                return TICKS_PER_QUARTER;
                            }
                        };

                        // Pick a snap grid from the clipboard: smallest duration => finest reasonable placement.
                        const clip = latestClipboardRef.current;
                        let gridTicks = TICKS_PER_QUARTER;
                        if (clip && clip.length > 0) {
                            const mins = clip.map(getDurationTicks).filter(v => Number.isFinite(v) && v > 0);
                            if (mins.length > 0) gridTicks = Math.max(1, Math.min(...mins));
                        }

                        const absTicks = Math.round(absBeat * TICKS_PER_QUARTER);
                        const snappedAbsTicks = Math.floor(absTicks / gridTicks) * gridTicks;
                        const snappedAbsBeat = snappedAbsTicks / TICKS_PER_QUARTER;

                        const { measureIndex, beat } = getMeasureIndexAndBeatFromAbsBeat(snappedAbsBeat);

                        let systemIndex = 0;
                        if (layoutData.systemsParams) {
                            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                                if (layoutData.systemsParams[si].measureIndices.includes(measureIndex)) { systemIndex = si; break; }
                            }
                        }
                        caret = { x: 0, systemIndex, measureIndex, beat };
                        setPasteCaretImmediate(caret);
                    } catch {
                        // ignore
                    }
                }

                // Last resort: if we only have a playhead position, paste at the start of the nearest measure.
                if (!caret && playheadPosition && layoutData && layoutData.systemsParams) {
                    const sysParams = layoutData.systemsParams[playheadPosition.systemIndex];
                    if (sysParams && sysParams.measureIndices && sysParams.startMeasuresX) {
                        let minDist = Infinity;
                        let bestIdx = 0;
                        for (let i = 0; i < sysParams.measureIndices.length; i++) {
                            const x = sysParams.startMeasuresX[i] ?? 0;
                            const dist = Math.abs(x - playheadPosition.x);
                            if (dist < minDist) {
                                minDist = dist;
                                bestIdx = i;
                            }
                        }
                        caret = {
                            x: playheadPosition.x,
                            systemIndex: playheadPosition.systemIndex,
                            measureIndex: sysParams.measureIndices[bestIdx] ?? 0,
                            beat: 1,
                        };
                        setPasteCaretImmediate(caret);
                    }
                }
                if (!caret) {
                    caret = { x: 0, systemIndex: 0, measureIndex: 0, beat: 1 };
                    setPasteCaretImmediate(caret);
                }
                // Removed debug log
                if (caret && latestClipboardRef.current && latestClipboardRef.current.length > 0) {
                    // Removed debug log
                    pasteClipboardAt(caret.measureIndex, caret.beat);
                }
                return;
            }
            if (command === 'undo') {
                // Removed debug log
                try { undoNotes(); } catch (e) { /* Removed debug log */ }
                return;
            }
            if (command === 'redo') {
                // Removed debug log
                try { redoNotes && redoNotes(); } catch (e) { /* Removed debug log */ }
                return;
            }
            if (command === 'selectAll') {
                // Usa latestRawNotes.current per garantire che siano le note aggiornate
                const allNotes = latestRawNotes.current || [];
                const allNoteIds = allNotes.filter(n => n && n.id !== undefined).map(n => n.id);
                // Removed debug log
                setSelectedNoteIds(new Set(allNoteIds));
                return;
            }
        }
        if (action === 'print') {
            try { handlePrint(); } catch (e) { /* Removed debug log */ }
            return;
        }
        if (action === 'export-pdf') {
            try {
                const html = buildExportHtml();
                if (!html) return;
                const computeScale = () => {
                    try {
                        const container = staffContainerRef.current;
                        if (!container) return 100;
                        const maxSystemWidth = Array.isArray((layoutData as any)?.systemsParams)
                            ? (layoutData as any).systemsParams.reduce((mx: number, s: any) => {
                                const w = Number(s?.width || 0);
                                return Number.isFinite(w) ? Math.max(mx, w) : mx;
                            }, 0)
                            : 0;

                        let contentW = maxSystemWidth > 0 ? maxSystemWidth : container.getBoundingClientRect().width;
                        if (!Number.isFinite(contentW) || contentW <= 0) return 100;

                        // A4 landscape width at 96 DPI ~ 1122px. Keep margin/padding headroom.
                        const usableW = 1060;
                        const ratio = usableW / contentW;
                        const pct = Math.floor(Math.max(0.45, Math.min(1, ratio)) * 100);
                        return Math.max(45, Math.min(100, pct));
                    } catch {
                        return 100;
                    }
                };

                const res = await electronBridge.exportPdfFromHtml(html, {
                    pageSize: 'A4',
                    marginsType: 0,
                    landscape: canvasFormat !== 'page',
                    scaleFactor: computeScale(),
                });
                // On failure, main emits `menu-error` and the app shows a toast.
                void res;
            } catch (err: any) {
                // On unexpected renderer-side failures, keep silent (avoid blocking modals).
                // Main-layer failures are already surfaced via `menu-error`.
                void err;
            }
            return;
        }
        if (action === 'export-png') {
            try {
                const html = buildExportHtml();
                if (!html) return;
                const res = await electronBridge.exportPngFromHtml(html, { scaleFactor: 1, tileMaxHeightPx: 8000 });
                // On failure, main emits `menu-error` and the app shows a toast.
                void res;
            } catch (err: any) {
                // On unexpected renderer-side failures, keep silent (avoid blocking modals).
                // Main-layer failures are already surfaced via `menu-error`.
                void err;
            }
            return;
        }

        if (action === MENU_ACTIONS.IMPORT_MIDI) {
            try {
                const fromMenuBase64 = typeof payload?.base64 === 'string' ? payload.base64 : '';
                // Resolve a source first (file already provided by menu, otherwise pick a file).
                // The destination dialog appears AFTER the file is in hand, so the user
                // doesn't see an extra click if they cancel the picker.
                let source: File | string | undefined;
                if (fromMenuBase64) {
                    source = fromMenuBase64;
                } else {
                    const picked = await pickMidiFile();
                    if (!picked) return;
                    source = picked;
                }
                const choice = await askMidiImportDestination();
                if (choice === null) return; // user cancelled
                if (choice === 'satb') {
                    await importMidi(source);
                } else {
                    const result = await importMidiAsAccompaniment(source);
                    if (result) {
                        setAccompanimentTracks(prev => [...(prev || []), result.track]);
                        // Apply the file's tempo + time signature to the project (the
                        // SATB import path already does this; the ACC path previously
                        // dropped them → bpm stuck at 120 and notes mis-barred against
                        // the default 4/4).
                        if (Number.isFinite(result.bpm) && result.bpm > 0) setBpm(result.bpm);
                        if (result.timeSignature) setTimeSignature(result.timeSignature);
                    }
                }
            } catch (err: any) {
                console.error('MIDI import failed:', err);
                try { window.alert(`Errore import MIDI: ${String(err?.message || err || 'errore sconosciuto')}`); } catch { /* ignore */ }
            }
            return;
        }

        // Block all export/print actions when teacher lock has disableExport
        if (lockHidesRef.current.export && (
            action === MENU_ACTIONS.EXPORT_MIDI ||
            action === MENU_ACTIONS.EXPORT_MUSICXML ||
            action === MENU_ACTIONS.EXPORT_PDF ||
            action === MENU_ACTIONS.EXPORT_PNG ||
            action === 'print'
        )) {
            try { window.alert('Export disabilitato dal docente per questo file.'); } catch { /* ignore */ }
            return;
        }

        if (action === MENU_ACTIONS.EXPORT_MIDI) {
            try {
                await exportMidi();
            } catch {
                // ignore
            }
            return;
        }

        if (action === MENU_ACTIONS.EXPORT_MUSICXML) {
            try {
                const xml = exportMusicXML({
                    notes: latestRawNotes.current || [],
                    title: projectTitle || 'Untitled',
                    keySignature: getKeySignature(keySignatureRoot, 'Major'),
                    timeSignature,
                    timeSignatureChanges,
                    isMinorMode,
                    keySignatureRoot,
                });
                await electronBridge.exportMusicXml(xml);
            } catch {
                // ignore
            }
            return;
        }

        if (
            action === 'close-project' ||
            action === 'save' ||
            action === 'save-as' ||
            action === 'open' ||
            action === 'new'
        ) {
            await handleGrandStaffProjectIOMenuAction({
                action: action as any,
                payload,
                api,
                currentProjectFilePath: currentProjectFilePathRef.current,
                setCurrentProjectFilePath,
                snapshot: {
                    latestRawNotes,
                    latestHarmonyOverrides,
                    latestOrnamentOverrides,
                    projectExtrasRef,
                    staffSystemMode,
                    keySignatureRoot,
                    projectTitle,
                    titleFontSize,
                    titleFontFamily,
                    timeSignature,
                    timeSignatureChanges,
                    isMinorMode,
                    autoLeadingToneInMinor,
                    keyChangeMode,
                    modalTonicOverride,
                    analysisContexts,
                    tonicizationHints,
                    inferredContextSuppressions,
                    doubleBarlineMeasures,
                    repeatBarlines,
                    voltaBrackets,
                    tempoCurves,
                    toolbarGroupOrder,
                    bpm,
                    isBpmActive,
                    isMetronomeOn,
                    metronomeUnit,
                    analysisLocked,
                    teacherPasswordHash,
                    analysisLockOptions,
                    accompanimentTracks,
                    voiceInstruments,
                    voiceVolumes,
                    mutedVoices,
                },
                apply: {
                    projectExtrasRef,
                    defaultToolbarGroupOrder: DEFAULT_TOOLBAR_ORDER,
                    setRawNotes,
                    setProjectTitle,
                    setSatbName,
                    setCurrentProjectFilePath,
                    setKeySignatureRoot,
                    setIsMinorMode,
                    setTimeSignature,
                    setHarmonyOverrides,
                    setOrnamentOverrides,
                    setAnalysisContexts,
                    setTonicizationHints,
                    setInferredContextSuppressions,
                    setTimeSignatureChanges,
                    setDoubleBarlineMeasures,
                    setRepeatBarlines,
                    setVoltaBrackets,
                    setTempoCurves,
                    setKeyChangeMode,
                    setModalTonicOverride,
                    setAutoLeadingToneInMinor,
                    setMeasuresPerLine,
                    setMeasuresPerLineDraft,
                    setMinMeasureCount,
                    setMinMeasureCountDraft,
                    setBpm,
                    setIsBpmActive,
                    setIsMetronomeOn,
                    setMetronomeUnit,
                    setClipboard,
                    setSelectedNoteIds,
                    setPasteCaretImmediate,
                    setActiveAccidental,
                    setSelectedVoice,
                    setStaffSystemMode,
                    setToolbarGroupOrder,
                    setTitleFontSize,
                    setTitleFontFamily,
                    setActiveTab,
                    setSelectedInsertion,
                    setIsTriplet,
                    setIsDuplet,
                    setIsSwing,
                    setTupletNoteCount,
                    setTripletBaseDuration,
                    setHoveredViolationNotes,
                    setSelectedViolationIndex,
                    setViewMode,
                    setContextMenu,
                    setShowRomanAnalysis,
                    setShowSymbolAnalysis,
                    setShowMeasureNumbers,
                    setIsToolbarCustomizeOpen,
                    setMidiOutputs,
                    setSelectedMidiOutput,
                    setAnalysisLocked,
                    setTeacherPasswordHash,
                    setAnalysisLockOptions,
                    setSessionUnlocked,
                    setAccompanimentTracks,
                    setVoiceInstruments,
                    setVoiceVolumes,
                    setMutedVoices,
                    timeSignature,
                },
            });
            // Record harmonic transitions on save (Progression Suggester corpus)
            if (action === 'save' || action === 'save-as') {
                try {
                    const romans = (_harmonyLabelsRef.current || [])
                        .flatMap((sys: any[]) => sys.map((l: any) => l.roman))
                        .filter(Boolean);
                    if (romans.length >= 2) recordAnalysedTransitions(romans);
                } catch { /* silent */ }
            }
            return;
        } else if (action === MENU_ACTIONS.IMPORT_MUSICXML) {
            // MusicXML import: renderer-safe (no fs/path); XML is provided by main via IPC.
            try {
                const xml = String(payload?.xml || '').trim();
                if (!xml) return;

                if (latestRawNotes.current.length > 0) {
                    const confirmed = window.confirm('Importare MusicXML? Le modifiche non salvate andranno perse.');
                    if (!confirmed) return;
                }

                // Parse first: if import fails, do not clear the current project.
                const imported = importMusicXML(xml);
                const importedNotes = Array.isArray(imported?.notes) ? imported.notes : [];

                const nextKeyRoot = String(imported?.keySignatureRoot || 'C').trim() || 'C';
                const nextIsMinor = Boolean(imported?.isMinorMode);
                const nextTimeSignature = imported?.timeSignature || { numerator: 4, denominator: 4 };
                const nextTimeSignatureChanges = Array.isArray(imported?.timeSignatureChanges) ? imported.timeSignatureChanges : [];
                const nextStaffSystemMode = (
                    imported?.staffSystemMode === 'grandstaff' ||
                    imported?.staffSystemMode === 'treble_only' ||
                    imported?.staffSystemMode === 'satb_ancient'
                ) ? imported.staffSystemMode : 'grandstaff';

                const filePath = String(payload?.filePath || '').trim();
                const fallbackTitle = filePath ? filePath.split(/[/\\]/).pop() : '';
                const nextTitle = String(imported?.projectTitle || fallbackTitle || '').trim();

                // Now apply: reset to defaults so missing fields don't inherit previous project state.
                setRawNotes(importedNotes as any);
                setKeySignatureRoot(nextKeyRoot);
                setProjectTitle(nextTitle);
                setTimeSignature(nextTimeSignature);
                setTimeSignatureChanges(nextTimeSignatureChanges);
                setIsMinorMode(nextIsMinor);
                setStaffSystemMode(nextStaffSystemMode);
                setAutoLeadingToneInMinor(true);
                setKeyChangeMode('none');
                setModalTonicOverride('');
                setAnalysisContexts([]);
                setHarmonyOverrides([]);
                setTonicizationHints([]);
                setInferredContextSuppressions([]);
                setOrnamentOverrides([]);
                setClipboard(null);
                setSelectedNoteIds(new Set());
                setPasteCaretImmediate(null);
                setPasteMarker(null as any);
                setCurrentProjectFilePath(null);
                projectExtrasRef.current = EMPTY_EXTRAS;
                setBpm(120);
                setIsBpmActive(false);
                setIsMetronomeOn(false);
                setMetronomeUnit('quarter');

                try {
                    const maxIdx = importedNotes.reduce((mx, n: any) => Math.max(mx, Number.isFinite(n?.measureIndex) ? Number(n.measureIndex) : -1), -1);
                    const measuresCount = Math.max(1, maxIdx + 1);
                    setMinMeasureCount(measuresCount);
                    setMinMeasureCountDraft(String(measuresCount));
                } catch {
                    // ignore
                }
            } catch (err: any) {
                try { window.alert(`Import MusicXML fallito: ${String(err?.message || err || '')}`); } catch { /* ignore */ }
            }
        } else if (action === 'set-show-measure-numbers') {
            setShowMeasureNumbers(!!payload?.enabled);
        } else if (action === 'toggle-toolbar-customize') {
            setIsToolbarCustomizeOpen(prev => !prev);
        } else if (action === 'open-preferences') {
            setIsPreferencesOpen(true);
        } else if (action === 'set-show-voice-colors') {
            setShowVoiceColors(!!payload?.enabled);
        } else if (action === 'set-engraving-mode') {
            const m = String(payload?.mode || '').trim();
            if (m === 'legacy' || m === 'enhanced') setEngravingMode(m);
        } else if (action === 'run-overlap-audit') {
            const m = String(payload?.mode || '').trim();
            if (m === 'legacy' || m === 'enhanced') runOverlapAudit(m);
        } else if (action === 'set-quick-insert-bar') {
            setShowQuickInsertBar(!!payload?.enabled);
        } else if (action === 'set-show-harmony-debug') {
            setShowHarmonyDebug(!!payload?.enabled);
        } else if (action === 'set-title-font-family') {
            const family = String(payload?.family || '').trim();
            if (family === 'serif' || family === 'sans-serif' || family === 'monospace') setTitleFontFamily(family);
        } else if (action === 'set-select-only-voice') {
            setMarqueeSelectOnlyCurrentVoice(!!payload?.enabled);
        } else if (action === 'generate-from-roman') {
            setIsRomanEditorOpen(prev => !prev);
        } else if (action === 'toggle-analysis-lock') {
            setIsAnalysisLockModalOpen(true);
        }
    }, [setRawNotes, setKeySignatureRoot, setProjectTitle, setTimeSignature, setClipboard, setSelectedNoteIds, setActiveTab, setDoubleBarlineMeasures, setMinMeasureCount, setMeasuresPerLine, setIsMinorMode, setKeyChangeMode, setModalTonicOverride, setIsTriplet, setIsDuplet, setIsSwing, setTupletNoteCount, setTripletBaseDuration, setActiveAccidental, setSelectedVoice, setHoveredViolationNotes, setSelectedViolationIndex, setViewMode, pasteMarker, setPasteCaret, setAnalysisContexts, setHarmonyOverrides, setContextMenu, setShowRomanAnalysis, setShowSymbolAnalysis, setShowMeasureNumbers, setToolbarGroupOrder, setIsToolbarCustomizeOpen, setMidiOutputs, setSelectedMidiOutput, setBpm, setIsBpmActive, setIsMetronomeOn, setCurrentProjectFilePath, bpm, isBpmActive, isMetronomeOn, metronomeUnit, toolbarGroupOrder, keySignatureRoot, projectTitle, titleFontSize, titleFontFamily, timeSignature, analysisContexts, isMinorMode, keyChangeMode, modalTonicOverride, undoNotes, redoNotes, handlePrint, staffSystemMode, setStaffSystemMode, setMarqueeSelectOnlyCurrentVoice, importMidi, exportMidi, importMidiAsAccompaniment, pickMidiFile, askMidiImportDestination, setAccompanimentTracks]);

    // Routing: single source of truth for where actions are handled.
    const dispatchMenuAction = useCallback((action: MenuAction, payload: any) => {
        if (getMenuActionTarget(action) !== 'grandStaff') return;
        void handleMenuActionLegacy(action, payload);
    }, [handleMenuActionLegacy]);

    // Keep ref always current during render so earlier effects (like pendingMenuAction)
    // can reliably dispatch without depending on effect ordering.
    dispatchMenuActionRef.current = dispatchMenuAction;

    // Keep draft snapshot args current every render (used by backup timer + beforeunload).
    draftArgsRef.current = {
        latestRawNotes, latestHarmonyOverrides, latestOrnamentOverrides, projectExtrasRef,
        staffSystemMode, keySignatureRoot, projectTitle, titleFontSize, titleFontFamily,
        timeSignature, timeSignatureChanges, isMinorMode, autoLeadingToneInMinor,
        keyChangeMode, modalTonicOverride, analysisContexts, doubleBarlineMeasures,
        repeatBarlines, voltaBrackets, toolbarGroupOrder, bpm, isBpmActive, isMetronomeOn, metronomeUnit,
        analysisLocked, teacherPasswordHash, analysisLockOptions,
        // Campi che il salvataggio su file include e che la bozza deve preservare:
        // tracce di accompagnamento, mixer per-voce SATB e hint di tonicizzazione.
        tonicizationHints, inferredContextSuppressions,
        accompanimentTracks, voiceInstruments, voiceVolumes, mutedVoices, satbName,
    };

    // Auto-save: periodically trigger 'save' if a file path is already set.
    useEffect(() => {
        const intervalSec = Number(autoSaveInterval) || 0;
        if (intervalSec <= 0 || !currentProjectFilePath) return;
        const timer = setInterval(() => {
            try {
                dispatchMenuActionRef.current?.('save' as any, {});
            } catch {
                // ignore auto-save errors silently
            }
        }, intervalSec * 1000);
        return () => clearInterval(timer);
    }, [autoSaveInterval, currentProjectFilePath]);

    // Draft backup: periodically snapshot project to localStorage for reload recovery.
    // Also flushes on beforeunload so Cmd-R never loses more than a few seconds.
    useEffect(() => {
        const DRAFT_KEY = 'harmony-tutor.draftBackup.v1';
        const writeDraft = () => {
            try {
                const args = draftArgsRef.current;
                if (!args) return;
                const notes = args.latestRawNotes.current || [];
                // Never overwrite a richer draft with fewer notes (e.g. after
                // page refresh that loads an empty/default project).
                if (notes.length === 0) return;
                const existingRaw = localStorage.getItem(DRAFT_KEY);
                if (existingRaw) {
                    try {
                        const existing = JSON.parse(existingRaw);
                        const existingCount = existing?.snapshot?.notes?.length ?? 0;
                        if (notes.length < existingCount && notes.length < 4) return;
                    } catch { /* corrupt entry — ok to overwrite */ }
                }
                const snapshot = buildGrandStaffProjectSnapshot(args);
                localStorage.setItem(DRAFT_KEY, JSON.stringify({
                    snapshot,
                    filePath: currentProjectFilePathRef.current,
                    timestamp: Date.now(),
                }));
            } catch { /* ignore quota / serialization errors */ }
        };
        const timer = setInterval(writeDraft, 30_000);
        window.addEventListener('beforeunload', writeDraft);
        return () => {
            clearInterval(timer);
            window.removeEventListener('beforeunload', writeDraft);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Draft recovery: on mount, offer to restore unsaved backup from localStorage.
    useEffect(() => {
        const DRAFT_KEY = 'harmony-tutor.draftBackup.v1';
        const id = setTimeout(() => {
            try {
                const raw = localStorage.getItem(DRAFT_KEY);
                if (!raw) return;
                const draft = JSON.parse(raw);
                if (!draft?.snapshot?.notes?.length) {
                    localStorage.removeItem(DRAFT_KEY);
                    return;
                }
                if (Date.now() - (draft.timestamp || 0) > 48 * 3600_000) {
                    localStorage.removeItem(DRAFT_KEY);
                    return;
                }
                const name = draft.filePath
                    ? String(draft.filePath).split('/').pop()
                    : 'senza nome';
                const when = new Date(draft.timestamp).toLocaleString();
                if (!window.confirm(
                    `Trovato un backup non salvato di "${name}" (${when}).\nVuoi ripristinarlo?`
                )) {
                    localStorage.removeItem(DRAFT_KEY);
                    return;
                }
                const p = draft.snapshot;
                setRawNotes(p.notes || []);
                setKeySignatureRoot(p.keySignatureRoot || 'C');
                setIsMinorMode(!!p.isMinorMode);
                setProjectTitle(p.projectTitle || '');
                setTimeSignature(p.timeSignature || { numerator: 4, denominator: 4 });
                setTimeSignatureChanges(p.timeSignatureChanges || []);
                setHarmonyOverrides(p.harmonyOverrides || []);
                setOrnamentOverrides(p.ornamentOverrides || []);
                setAnalysisContexts(p.analysisContexts || []);
                setTonicizationHints((p as any).tonicizationHints || []);
                setInferredContextSuppressions((p as any).inferredContextSuppressions || []);
                setDoubleBarlineMeasures(p.doubleBarlineMeasures || []);
                setRepeatBarlines(p.repeatBarlines || {});
                setVoltaBrackets(p.voltaBrackets || []);
                setTempoCurves((p as any).tempoCurves || []);
                setAutoLeadingToneInMinor(p.autoLeadingToneInMinor ?? true);
                setKeyChangeMode(p.keyChangeMode || 'none');
                setModalTonicOverride(p.modalTonicOverride || '');
                setStaffSystemMode(p.staffSystemMode || 'grandstaff');
                setBpm(p.bpm ?? 120);
                setIsBpmActive(!!p.isBpmActive);
                setIsMetronomeOn(!!p.isMetronomeOn);
                setMetronomeUnit(p.metronomeUnit || 'quarter');
                if (p.titleFontSize) setTitleFontSize(p.titleFontSize);
                if (p.titleFontFamily) setTitleFontFamily(p.titleFontFamily);
                if (p.toolbarGroupOrder) setToolbarGroupOrder(p.toolbarGroupOrder);
                if (typeof p.analysisLocked === 'boolean') setAnalysisLocked(p.analysisLocked);
                if (typeof p.teacherPasswordHash === 'string') setTeacherPasswordHash(p.teacherPasswordHash);
                if (p.analysisLockOptions && typeof p.analysisLockOptions === 'object') setAnalysisLockOptions(p.analysisLockOptions);
                setSessionUnlocked(false);
                setAccompanimentTracks(Array.isArray(p.accompanimentTracks)
                    ? p.accompanimentTracks.map((t: any) => ({ ...t, staffMode: t?.staffMode ?? 'grandstaff' }))
                    : []);
                // Mixer per-voce SATB (mirror del caricamento file normale).
                if ((p as any).voiceInstruments && typeof (p as any).voiceInstruments === 'object') {
                    setVoiceInstruments((p as any).voiceInstruments);
                }
                if ((p as any).voiceVolumes && typeof (p as any).voiceVolumes === 'object') {
                    setVoiceVolumes((p as any).voiceVolumes);
                }
                if (Array.isArray((p as any).mutedVoices)) {
                    setMutedVoices(new Set((p as any).mutedVoices as number[]));
                }
                setCurrentProjectFilePath(draft.filePath || null);
                localStorage.removeItem(DRAFT_KEY);
            } catch {
                try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
            }
        }, 500);
        return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Top-priority lock interceptor: when the teacher lock disables export,
    // hard-block Cmd/Ctrl + C/X/V at the keydown capture phase. This runs
    // BEFORE the main editor keydown handler and BEFORE the OS Edit menu
    // accelerator routes back as 'edit-command' (which is unreliable as the
    // sole gate). Listener is always mounted; the lock flag is read from the
    // ref so the listener never needs to re-bind.
    useEffect(() => {
        const onLockKeyDown = (e: KeyboardEvent) => {
            if (!lockHidesRef.current.export) return;
            const isMod = e.metaKey || e.ctrlKey;
            if (!isMod) return;
            const key = (e.key || '').toLowerCase();
            if (key !== 'c' && key !== 'x' && key !== 'v') return;
            e.preventDefault();
            e.stopPropagation();
            (e as any).stopImmediatePropagation?.();
            try { window.alert('Copia/Taglia/Incolla disabilitato dal docente per questo file.'); } catch { /* ignore */ }
        };
        window.addEventListener('keydown', onLockKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onLockKeyDown, { capture: true } as any);
    }, []);

    // Listener Electron: registrazione unica e cleanup
    useEffect(() => {
        const removeListener = electronBridge.onMenuAction((action, payload) => {
            try {
                dispatchMenuAction(action, payload);
            } catch {
                // ignore
            }
        });
        return () => removeListener();
    }, [dispatchMenuAction]);

    // Listen for native copy events (keyboard) to set the paste marker as well
    useEffect(() => {
        const onNativeCopy = (ev: ClipboardEvent) => {
            if (lockHidesRef.current.export) return;
            try {
                if (activeStaffAreaRef.current === 'accompaniment') {
                    const currentSelected = latestSelectedNoteIds.current;
                    if (currentSelected && currentSelected.size > 0) {
                        const allAccNotes = latestAccompanimentTracks.current.flatMap(t => t.notes);
                        const accSelected = allAccNotes.filter(n => currentSelected.has(n.id));
                        if (accSelected.length > 0) setClipboard(accSelected.map(n => ({ ...n })));
                    }
                } else {
                    handleCopy();
                }
                let marker = null as any;
                if (pasteCaret) {
                    marker = { systemIndex: pasteCaret.systemIndex, measureIndex: pasteCaret.measureIndex, beat: pasteCaret.beat, ts: Date.now() };
                } else if (playheadPosition && layoutData && layoutData.systemsParams) {
                    const sysParams = layoutData.systemsParams[playheadPosition.systemIndex];
                    if (sysParams && sysParams.measureIndices && sysParams.startMeasuresX) {
                        let minDist = Infinity;
                        let bestIdx = 0;
                        for (let i = 0; i < sysParams.measureIndices.length; i++) {
                            const x = sysParams.startMeasuresX[i] ?? 0;
                            const dist = Math.abs(x - playheadPosition.x);
                            if (dist < minDist) {
                                minDist = dist;
                                bestIdx = i;
                            }
                        }
                        marker = { systemIndex: playheadPosition.systemIndex, measureIndex: sysParams.measureIndices[bestIdx] ?? 0, beat: 1, ts: Date.now() };
                    }
                }
                if (marker) setPasteMarker(marker);
            } catch (e) {
                // ignore
            }
        };
        window.addEventListener('copy', onNativeCopy);
        return () => window.removeEventListener('copy', onNativeCopy);
    }, [handleCopy]);

    // Auto-expire pasteMarker after 30s
    useEffect(() => {
        if (!pasteMarker) return;
        const t = window.setTimeout(() => setPasteMarker(null), 30000);
        return () => window.clearTimeout(t);
    }, [pasteMarker]);

    // (print handler moved earlier)

    

    // ...existing code...

    // Tie-orientation is controlled by selecting the two tied notes.
    // When exactly 2 notes are selected AND they form a valid tie pair, the flip button
    // operates on the tie (manualTieDirection) instead of stem direction.
    const selectedTiePair = useMemo(() => {
        if (selectedNoteIds.size !== 2) return null;
        const selected = notes.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
        if (selected.length !== 2) return null;

        const v1 = selected[0].voice ?? 1;
        const v2 = selected[1].voice ?? 1;
        if (v1 !== v2) return null;

        const voiceLine = notes.filter(n => (n.voice ?? 1) === v1);
        const i1 = voiceLine.findIndex(n => n.id === selected[0].id);
        const i2 = voiceLine.findIndex(n => n.id === selected[1].id);
        if (i1 < 0 || i2 < 0) return null;

        const fromIdx = Math.min(i1, i2);
        const toIdx = Math.max(i1, i2);
        if (toIdx !== fromIdx + 1) return null;

        const from = voiceLine[fromIdx];
        const to = voiceLine[toIdx];
        if (!(from as any).isTiedToNext) return null;
        if (to.isRest) return null;
        if (from.midi !== to.midi) return null;

        return { fromNoteId: from.id, toNoteId: to.id, voice: v1 as Voice };
    }, [notes, selectedNoteIds]);
    
    // Defer notes for analysis — during rapid editing, analysis runs at lower
    // priority so the UI stays responsive. Layout falls back to un-analyzed
    // notes while analysis catches up.
    const deferredNotes = useDeferredValue(notes);

    // Synchronous analysis — correctness over performance.
    const analysisResult = useMemo(() => {
        if (!isAnalysisEnabled) {
            return { analyzedNotes: deferredNotes, connections: [], violations: [], inferredAnalysisContexts: [] as any[] };
        }
        try {
            return applyHarmonyRules(deferredNotes, keySignature, currentTonic, isMinorMode, analysisContexts, timeSignature, doubleBarlineMeasures, ornamentOverrides, harmonyOverrides);
        } catch (e) {
            console.error('[GrandStaffEditor] applyHarmonyRules crashed:', e);
            return { analyzedNotes: deferredNotes, connections: [], violations: [], inferredAnalysisContexts: [] as any[] };
        }
    }, [deferredNotes, keySignature, currentTonic, isMinorMode, analysisContexts, isAnalysisEnabled, timeSignature, doubleBarlineMeasures, ornamentOverrides]);

    const effectiveAnalysisContexts = useMemo(() => {
        // Merge user-authored contexts with engine-inferred modulations.
        // User contexts take precedence (listed first → latest wins in sort).
        // Gate: if the "Inferisci contesti" toggle is OFF, skip inferred contexts entirely.
        const _inferEnabled = enableInferredContexts !== false;
        const _suppr = new Set((inferredContextSuppressions || []).map(b => Math.round(b * 1e6) / 1e6));
        // Helper: drop inferred contexts whose absBeat is the active inferred ctx
        // at any suppressed beat. Manual contexts are never touched.
        const applySuppression = (arr: any[]): any[] => {
            if (_suppr.size === 0) return arr;
            const inferredOnly = arr.filter(c => c.source === 'inferred')
                .sort((a, b) => (a.absBeat ?? 0) - (b.absBeat ?? 0));
            const suppressedBeats = new Set<number>();
            for (const sb of _suppr) {
                let best: any = null;
                for (const ctx of inferredOnly) {
                    if ((ctx.absBeat ?? 0) <= sb + 1e-6) best = ctx;
                    else break;
                }
                if (best) suppressedBeats.add(Math.round((best.absBeat ?? 0) * 1e6) / 1e6);
            }
            return arr.filter(c => {
                if (c.source !== 'inferred') return true;
                return !suppressedBeats.has(Math.round((c.absBeat ?? 0) * 1e6) / 1e6);
            });
        };
        if (!_inferEnabled) return applySuppression([...(analysisContexts || [])]) as any[];
        // Filter out low-confidence inferred contexts (score undefined or < 12).
        const inferred = ((analysisResult as any)?.inferredAnalysisContexts || [])
            .filter((c: any) => typeof c.score === 'number' && c.score >= 12);
        return applySuppression([...(analysisContexts || []), ...inferred]) as any[];
    }, [analysisResult, analysisContexts, inferredContextSuppressions, enableInferredContexts]);

    const { analyzedNotes, connections: errorConnections, violations } = analysisResult;

    const getNoteY = (position: number, staffTop: number, clef: ClefType): number => {
        // Legacy (non-VexFlow) approximation used only as a fallback when we don't have
        // VexFlow hit points yet. Treat C-clefs as “upper staff” for the fallback path.
        if (clef === 'bass') {
            return staffTop - (position + 2) * (LINE_HEIGHT / 2);
        }
        return staffTop + (5 * LINE_HEIGHT) - (position * (LINE_HEIGHT / 2));
    };

    const Accidental: React.FC<{ type: AccidentalType, x: number, y: number, color: string }> = ({ type, x, y, color }) => {
        switch (type) {
            case 'sharp':
                return (
                    <text x={x} y={y} fill={color} fontSize="30" fontFamily="serif" textAnchor="middle" dominantBaseline="central">
                        ♯
                    </text>
                );
            case 'flat':
                return (
                    <text x={x} y={y} fill={color} fontSize="30" fontFamily="serif" textAnchor="middle" dominantBaseline="central">
                        ♭
                    </text>
                );
            case 'natural':
                return (
                    <text x={x} y={y} fill={color} fontSize="30" fontFamily="serif" textAnchor="middle" dominantBaseline="central">
                        ♮
                    </text>
                );
            case 'double-sharp':
                return (
                    <text x={x} y={y} fill={color} fontSize="30" fontFamily="serif" textAnchor="middle" dominantBaseline="central">
                        𝄪
                    </text>
                );
            case 'double-flat':
                return (
                    <text x={x} y={y} fill={color} fontSize="30" fontFamily="serif" textAnchor="middle" dominantBaseline="central">
                        𝄫
                    </text>
                );
            default:
                return null;
        }
    };

    const analysisContextAbsBeat = useCallback((ctx: AnalysisContext) => {
        const baseBeatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const legacyAbsBeat = (ctx.measureIndex ?? 0) * baseBeatsPerMeasure;
        return Number.isFinite(ctx.absBeat as any) ? (ctx.absBeat as number) : legacyAbsBeat;
    }, [timeSignature]);

    const timeSignatureChangeAbsBeat = useCallback((tc: TimeSignatureChange) => {
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const legacyAbsBeat = (tc.measureIndex ?? 0) * beatsPerMeasure;
        return Number.isFinite(tc.absBeat as any) ? (tc.absBeat as number) : legacyAbsBeat;
    }, [timeSignature]);

    const getTimeSignatureAtAbsBeat = useCallback((absBeat: number): TimeSignature => {
        const sorted = (timeSignatureChanges || []).slice().sort((a, b) => timeSignatureChangeAbsBeat(a) - timeSignatureChangeAbsBeat(b));
        let active: TimeSignature = timeSignature;
        for (const c of sorted) {
            const at = timeSignatureChangeAbsBeat(c);
            if (Number.isFinite(at) && at <= absBeat + 1e-6) {
                if (Number.isFinite(c.numerator) && Number.isFinite(c.denominator) && c.numerator > 0 && c.denominator > 0) {
                    active = { numerator: c.numerator, denominator: c.denominator };
                }
            } else {
                break;
            }
        }
        return active;
    }, [timeSignature, timeSignatureChangeAbsBeat, timeSignatureChanges]);

    const handleApplyTonicizationHint = (absBeat: number, tonic: string, isMinor: boolean) => {
        const safe = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        setTonicizationHints(prev => {
            const next = (prev || []).filter(h => Math.abs(h.absBeat - safe) > 1e-6);
            next.push({ absBeat: safe, tonic, isMinor });
            return next.sort((a, b) => a.absBeat - b.absBeat);
        });
    };

    const handleRemoveTonicizationHint = (absBeat: number) => {
        const safe = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        setTonicizationHints(prev => (prev || []).filter(h => Math.abs(h.absBeat - safe) > 1e-6));
    };

    const handleSuppressInference = (absBeat: number) => {
        const safe = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        setInferredContextSuppressions(prev => {
            if ((prev || []).some(b => Math.abs(b - safe) < 1e-6)) return prev;
            return [...(prev || []), safe].sort((a, b) => a - b);
        });
    };

    const handleUnsuppressInference = (absBeat: number) => {
        const safe = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        setInferredContextSuppressions(prev => (prev || []).filter(b => Math.abs(b - safe) > 1e-6));
    };

    const handleApplyContext = (absBeat: number, newTonic: string, newIsMinor: boolean, label?: string) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e-6);

        setAnalysisContexts(prev => {
            const next = (prev || []).filter(c => Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) > 1e-6);
            next.push({ absBeat: safeAbsBeat, newTonic, newIsMinor, label: label?.trim() || undefined });
            return next.sort((a, b) => analysisContextAbsBeat(a) - analysisContextAbsBeat(b));
        });
        setContextMenu(null);
    };

    const handleApplyContextLabelOnly = (absBeat: number, label?: string) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        const cleanLabel = label?.trim() || undefined;

        setAnalysisContexts(prev => {
            const existing = (prev || []).find(c => Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) <= 1e-6);
            if (existing) {
                return (prev || []).map(c => (Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) <= 1e-6)
                    ? { ...c, label: cleanLabel }
                    : c
                );
            }
            const baseCtx = (prev || [])
                .filter(c => analysisContextAbsBeat(c) <= safeAbsBeat + 1e-6)
                .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];
            const baseTonic = baseCtx?.newTonic ?? currentTonic;
            const baseIsMinor = baseCtx?.newIsMinor ?? isMinorMode;
            const next = (prev || []).slice();
            next.push({ absBeat: safeAbsBeat, newTonic: baseTonic, newIsMinor: baseIsMinor, label: cleanLabel, markerMode: 'text' as const });
            return next.sort((a, b) => analysisContextAbsBeat(a) - analysisContextAbsBeat(b));
        });
        setContextMenu(null);
    };

    const handleRemoveContextLabelOnly = (absBeat: number) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        setAnalysisContexts(prev => {
            const existing = (prev || []).find(c => Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) <= 1e-6);
            if (!existing) return prev || [];
            if (!existing.label) return prev || [];
            return (prev || []).map(c => (Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) <= 1e-6)
                ? { ...c, label: undefined }
                : c
            );
        });
        setContextMenu(null);
    };

    const handleApplyTimeSignatureChange = (absBeat: number, numerator: number, denominator: number, measureIndex?: number) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        const n = Math.max(1, Math.round(Number(numerator)));
        const d = Math.max(1, Math.round(Number(denominator)));
        const mIdx = Number.isFinite(measureIndex as any) ? (measureIndex as number) : Math.floor(safeAbsBeat / Math.max(1, timeSignature.numerator * (4 / timeSignature.denominator)));

        setTimeSignatureChanges(prev => {
            const next = (prev || []).filter(c => Math.abs(timeSignatureChangeAbsBeat(c) - safeAbsBeat) > 1e-6);
            next.push({ absBeat: safeAbsBeat, measureIndex: mIdx, numerator: n, denominator: d });
            return next.sort((a, b) => timeSignatureChangeAbsBeat(a) - timeSignatureChangeAbsBeat(b));
        });
        setContextMenu(null);
    };

    const handleRemoveTimeSignatureChange = (absBeat: number) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        setTimeSignatureChanges(prev => (prev || []).filter(c => Math.abs(timeSignatureChangeAbsBeat(c) - safeAbsBeat) > 1e-6));
        setContextMenu(null);
    };

    const handleRemoveContext = (absBeat: number) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e6);
        setAnalysisContexts(prev => (prev || []).filter(c => Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) > 1e-6));
        setContextMenu(null);
    };

    const existingContextForMenu = useMemo(() => {
        if (!contextMenu) return null;
        return (analysisContexts || []).find(c => Math.abs(analysisContextAbsBeat(c) - contextMenu.absBeat) <= 1e-6) || null;
    }, [analysisContextAbsBeat, contextMenu, analysisContexts]);

    const existingTonicizationHintForMenu = useMemo(() => {
        if (!contextMenu) return null;
        return (tonicizationHints || []).find(h => Math.abs(h.absBeat - contextMenu.absBeat) <= 1e-6) || null;
    }, [contextMenu, tonicizationHints]);

    const existingSuppressionForMenu = useMemo(() => {
        if (!contextMenu) return false;
        return (inferredContextSuppressions || []).some(b => Math.abs(b - contextMenu.absBeat) < 1e-6);
    }, [contextMenu, inferredContextSuppressions]);

    const existingTimeSignatureChangeForMenu = useMemo(() => {
        if (!contextMenu) return null;
        return (timeSignatureChanges || []).find(c => Math.abs(timeSignatureChangeAbsBeat(c) - contextMenu.absBeat) <= 1e-6) || null;
    }, [contextMenu, timeSignatureChangeAbsBeat, timeSignatureChanges]);


    useEffect(() => {
        // Measure the scroll container, not the scaled content.
        // Otherwise the score will only occupy a fraction of the screen and will clamp measures-per-line.
        const el = scoreScrollRef.current;
        if (!el) return;

        const measure = () => {
            try {
                const w = el.getBoundingClientRect().width;
                const usable = Math.max(300, Math.floor(w - 32));
                if (usable > 0) setContainerWidth(usable);
            } catch {
                // ignore
            }
        };

        measure();
        const observer = new ResizeObserver(() => measure());
        observer.observe(el);
        return () => observer.disconnect();
    }, [isActive, viewMode]);

    const layoutData = useMemo(() => {
        // New deterministic tick-based layout:
        // Use immediate `notes` (not deferred analyzedNotes) so the layout
        // updates instantly when a note is inserted.
        const notesToLayout = notes;
        const keySigWidth = keySignature.count * 14;
        const timeSigWidthWithPadding = timeSignature ? 55 : 0;
        const startOffset = START_X + keySigWidth + timeSigWidthWithPadding;
        const systemRightX = containerWidth - START_X;
        const baseBeatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const normalizedTimeSigChanges = (timeSignatureChanges || [])
            .map(c => {
                const absBeat = Number(c.absBeat);
                const m = Number.isFinite(c.measureIndex as any)
                    ? Number(c.measureIndex)
                    : (Number.isFinite(absBeat) ? Math.floor(absBeat / Math.max(1, baseBeatsPerMeasure || 4)) : 0);
                return {
                    measureIndex: m,
                    numerator: Math.max(1, Math.round(Number(c.numerator))),
                    denominator: Math.max(1, Math.round(Number(c.denominator))),
                };
            })
            .filter(c => Number.isFinite(c.measureIndex))
            .sort((a, b) => a.measureIndex - b.measureIndex);
        const getBeatsPerMeasureForIndex = (m: number): number => {
            let active = timeSignature;
            for (const c of normalizedTimeSigChanges) {
                if (c.measureIndex <= m) {
                    active = { numerator: c.numerator, denominator: c.denominator };
                } else {
                    break;
                }
            }
            const bpm = active.numerator * (4 / active.denominator);
            return Math.max(1, Number.isFinite(bpm) ? bpm : (baseBeatsPerMeasure || 4));
        };

        // Build notes grouped by measure
        const notesByMeasure = new Map<number, StaffNote[]>();
        let maxMeasureIndex = -1;
        notesToLayout.forEach(note => {
            const m = note.measureIndex ?? 0;
            if (m > maxMeasureIndex) maxMeasureIndex = m;
            if (!notesByMeasure.has(m)) notesByMeasure.set(m, []);
            notesByMeasure.get(m)!.push(note);
        });

        // Accompaniment tracks live on their own staves but must still expand the
        // page: a 70-bar ACC-only import would otherwise show just minMeasureCount
        // bars. Fold their span into maxMeasureIndex (measureIndex, or derived from
        // startTick when absent).
        {
            const defTicksPerMeasure = TICKS_PER_QUARTER * timeSignature.numerator * (4 / timeSignature.denominator);
            for (const track of (accompanimentTracks || [])) {
                for (const n of (track.notes || [])) {
                    const m = Number.isFinite((n as any).measureIndex)
                        ? Number((n as any).measureIndex)
                        : Math.floor((Number((n as any).startTick) || 0) / Math.max(1, defTicksPerMeasure));
                    if (m > maxMeasureIndex) maxMeasureIndex = m;
                }
            }
        }

        const finalMeasureIndex = Math.max(0, Math.max((minMeasureCount - 1), maxMeasureIndex));
        const targetTotalMeasures = Math.max(minMeasureCount, maxMeasureIndex + 1);

        const measureBeatsPerMeasure: number[] = [];
        const measureStartAbsBeat: number[] = [];
        const measureTicks: number[] = [];
        let accBeat = 0;
        for (let m = 0; m < targetTotalMeasures; m++) {
            measureStartAbsBeat[m] = accBeat;
            const bpm = getBeatsPerMeasureForIndex(m);
            measureBeatsPerMeasure[m] = bpm;
            measureTicks[m] = bpm * TICKS_PER_QUARTER;
            accBeat += bpm;
        }

        // Compute layout using ticks per system to ensure stable px-per-beat inside each system.
        const usablePageWidth = systemRightX - startOffset - STAFF_PADDING_X;
        const MIN_PX_PER_QUARTER = 48;
        const ticksPerMeasureForIndex = (m: number) => measureTicks[m] ?? (Math.max(1, baseBeatsPerMeasure || 4) * TICKS_PER_QUARTER);

        // Build systems using the user-selected measures-per-line as the primary
        // constraint, while still splitting earlier if the line would overflow.
        const desiredMeasuresPerLine = Math.max(1, Math.min(12, measuresPerLine || 4));

        const tentativeSystems: { measureIndices: number[] }[] = [];
        let curSys: number[] = [];
        // Natural width for a measure using the deterministic default px-per-tick
        // (used only for system splitting heuristics).
        const naturalMeasureWidth = (_mIdx: number, isFirstMeasureInSystem: boolean) => {
            const measureTicks = ticksPerMeasureForIndex(_mIdx);
            const content = Math.round(measureTicks * DEFAULT_PX_PER_TICK);
            const extraLeft = isFirstMeasureInSystem ? (keySigWidth + timeSigWidthWithPadding) : 0;
            return content + (MEASURE_PADDING_X * 2) + extraLeft;
        };

        let accWidth = 0;
        for (let m = 0; m < targetTotalMeasures; m++) {
            if (curSys.length >= desiredMeasuresPerLine) {
                tentativeSystems.push({ measureIndices: curSys });
                curSys = [];
                accWidth = 0;
            }

            const isFirst = curSys.length === 0;
            const mWidth = naturalMeasureWidth(m, isFirst);
            if (!isFirst && accWidth + mWidth > usablePageWidth) {
                tentativeSystems.push({ measureIndices: curSys });
                curSys = [m];
                accWidth = naturalMeasureWidth(m, true);
            } else {
                curSys.push(m);
                accWidth += mWidth;
            }
        }
        if (curSys.length > 0) tentativeSystems.push({ measureIndices: curSys });

        // If a global default px-per-tick is configured, check whether every tentative
        // system can fit using that scale. If so, prefer the global deterministic value
        // (this prevents unexpected global reflow when inserting measures).
        const canUseDefaultPxPerTick = typeof DEFAULT_PX_PER_TICK === 'number' && isFinite(DEFAULT_PX_PER_TICK) && DEFAULT_PX_PER_TICK > 0 && tentativeSystems.every(sys => {
            const measureCount = sys.measureIndices.length;
            const totalTicks = sys.measureIndices.reduce((s, mi) => s + ticksPerMeasureForIndex(mi), 0);
            const totalPadding = measureCount * (MEASURE_PADDING_X * 2);
            const availableContentWidth = Math.max(40, usablePageWidth - totalPadding);
            const neededContentWidth = Math.round(totalTicks * DEFAULT_PX_PER_TICK);
            return neededContentWidth <= availableContentWidth;
        });

        const finalNotes: StaffNote[] = [];
        const allSystemsBarlines: Barline[][] = [];
        const measureFinalWidths = new Map<number, number>();
        const doubleSet = new Set(doubleBarlineMeasures);

        // For each tentative system compute pxPerTick from available width minus paddings
        let curXStart = startOffset;
        const systemsParams: { measureIndices: number[]; width: number; startMeasuresX: number[]; pxPerTick: number }[] = [];
        tentativeSystems.forEach((sys, sysIndex) => {
            const measureCount = sys.measureIndices.length;
            const totalPadding = measureCount * (MEASURE_PADDING_X * 2);
            const availableContentWidth = Math.max(40, usablePageWidth - totalPadding);
            const totalTicks = sys.measureIndices.reduce((s, mi) => s + ticksPerMeasureForIndex(mi), 0);

            // Allow increasing pxPerTick beyond the default when notes are very dense
            // so small subdivisions (biscrome etc.) remain legible.
            const minPxPerTick = (MIN_PX_PER_QUARTER / TICKS_PER_QUARTER);
            const MIN_PIXEL_SPACING = 8; // px between adjacent onsets

            // Compute the smallest tick delta between adjacent onsets inside the system.
            // Include ACC notes so eighth-note triplets (and other short subdivisions) in
            // accompaniment tracks force the system to reserve enough horizontal space.
            // Without this, when SATB is sparse the system uses a low pxPerTick and the
            // ACC notes/playhead end up visually overlapping.
            let minDeltaTicks = Infinity;
            sys.measureIndices.forEach(m => {
                const measureNotes = notesToLayout.filter(n => n.measureIndex === m);
                const ticks = measureNotes.map(n => (typeof (n as any).startTick === 'number')
                    ? (n as any).startTick
                    : Math.round((((measureStartAbsBeat[n.measureIndex ?? 0] ?? 0) + ((n.beat ?? 1) - 1))) * TICKS_PER_QUARTER));
                ticks.sort((a, b) => a - b);
                for (let i = 1; i < ticks.length; i++) {
                    const d = ticks[i] - ticks[i-1];
                    if (d > 0 && d < minDeltaTicks) minDeltaTicks = d;
                }
            });
            if (!isFinite(minDeltaTicks) || minDeltaTicks <= 0) minDeltaTicks = ticksPerMeasureForIndex(sys.measureIndices[0] ?? 0);

            const neededPxPerTickFromNotes = MIN_PIXEL_SPACING / Math.max(1, minDeltaTicks);
            const defaultPx = (typeof DEFAULT_PX_PER_TICK === 'number' && DEFAULT_PX_PER_TICK > 0) ? DEFAULT_PX_PER_TICK : 0;
            const pxPerTick = Math.max(minPxPerTick, defaultPx, neededPxPerTickFromNotes, (availableContentWidth / Math.max(1, totalTicks)));

            const systemBarlines: Barline[] = [];
            let curX = curXStart;
            const startMeasuresX: number[] = [];
            sys.measureIndices.forEach((m, idx) => {
                const measureTicks = ticksPerMeasureForIndex(m);
                const contentWidthForMeasure = measureTicks * pxPerTick;
                // If this is the first measure in the system, reserve space for key/time glyphs
                // so notes don't overlap the clef/time.
                const isFirstMeasureInSystem = idx === 0;
                const extraLeft = isFirstMeasureInSystem ? (keySigWidth + timeSigWidthWithPadding) : 0;
                const measureWidth = contentWidthForMeasure + (MEASURE_PADDING_X * 2) + extraLeft;
                measureFinalWidths.set(m, measureWidth);
                // store start X relative to the start of this system (local coordinates)
                startMeasuresX.push((curX - curXStart + START_X) + extraLeft);

                // position notes using ticks when available (fallback to beat field)
                const measureNotes = notesToLayout.filter(n => n.measureIndex === m);
                const measureStartTick = beatsToTicks(measureStartAbsBeat[m] ?? 0);
                measureNotes.forEach(n => {
                    // Ogni nota DEVE avere startTick
                    if (typeof (n as any).startTick !== 'number') {
                        return; // nota non valida, la saltiamo
                    }
                    const nStartTick = (n as any).startTick as number;
                    const relativeTicks = Math.max(0, nStartTick - measureStartTick);
                    const relativeX = relativeTicks * pxPerTick; // nessun round qui
                    const localX =
                        (curX - curXStart + START_X) +
                        extraLeft +
                        MEASURE_PADDING_X +
                        relativeX;
                    finalNotes.push({ ...n, xPosition: localX });
                });

                const isLastInSystem = idx === sys.measureIndices.length - 1;
                const svgStaffEnd = containerWidth - STAFF_MARGIN;
                const barStyle = repeatBarlines[m] || (m === finalMeasureIndex ? 'final' : (doubleSet.has(m) ? 'double' : 'single'));
                let barXLocal = (curX - curXStart + START_X) + measureWidth;
                if (isLastInSystem) {
                    // IMPORTANT:
                    // The last barline of the system must be placed at the actual end of the staff
                    // for this system, not at `containerWidth`.
                    // Using `containerWidth` can place it too far left when the computed system
                    // width exceeds the container (then the rightmost barline appears “missing”,
                    // especially after suppressing VexFlow's per-staff end barlines).
                    const systemWidthIfEndedHere = (curX - curXStart + START_X) + measureWidth;
                    // Place final bar slightly inside the staff end to avoid clipping.
                    barXLocal = (m === finalMeasureIndex && barStyle === 'final')
                        ? (systemWidthIfEndedHere - STAFF_MARGIN - 1)
                        : (systemWidthIfEndedHere - STAFF_MARGIN);
                }
                systemBarlines.push({ id: `bar-${m}`, xPosition: barXLocal, style: barStyle });

                curX += measureWidth;
            });

            allSystemsBarlines.push(systemBarlines);
            // Record the actual used width for the system. If the system does not
            // fill the container, give the leftover space to the last measure so
            // the barline aligns with the edge (prevents a visually short last
            // measure that breaks insertion UX). This does not change pxPerTick.
            let usedWidth = curX - curXStart + START_X;
            if (usedWidth < containerWidth) {
                const extra = containerWidth - usedWidth;
                const lastMeasureIdx = sys.measureIndices[sys.measureIndices.length - 1];
                const prev = measureFinalWidths.get(lastMeasureIdx) || 0;
                measureFinalWidths.set(lastMeasureIdx, prev + extra);
                // shift the barline for the last measure
                if (systemBarlines.length > 0) {
                    const lastBar = systemBarlines[systemBarlines.length - 1];
                    lastBar.xPosition = (lastBar.xPosition || 0) + extra;
                }
                usedWidth += extra;
            }
            const finalWidth = usedWidth;
            systemsParams.push({ measureIndices: sys.measureIndices, width: finalWidth, startMeasuresX, pxPerTick });
            // next system starts after current curX plus small gap
            curXStart = curX + 20;
        });


        try {
            const sample = finalNotes.slice(0, 12).map(n => ({ id: n.id, measureIndex: n.measureIndex, beat: n.beat, startTick: (n as any).startTick, x: n.xPosition }));
            const firstMeasureIndex = 0;
            const sampleMeasureWidth = measureFinalWidths.get(firstMeasureIndex) || 0;
            const sampleBeats = measureBeatsPerMeasure[0] ?? baseBeatsPerMeasure;
            const samplePxPerQuarter = sampleMeasureWidth > 0 ? ((sampleMeasureWidth - (MEASURE_PADDING_X * 2)) / Math.max(1, sampleBeats)) : 0;
            // Per-system diagnostics: report pxPerTick estimate and first positioned note
            systemsParams.forEach((sp, si) => {
                const sysNotes = finalNotes.filter(n => sp.measureIndices.includes(n.measureIndex ?? -1));
                const firstNote = sysNotes.length > 0 ? sysNotes[0] : null;
                //
            });
            //
        } catch (e) {
            // ignore logging errors
        }
        return { positionedNotes: finalNotes, systemsBarlines: allSystemsBarlines, systemsParams: systemsParams, measureFinalWidths, measureStartAbsBeat, measureBeatsPerMeasure };
    }, [notes, containerWidth, timeSignature, timeSignatureChanges, keySignature, measuresPerLine, viewMode, minMeasureCount, doubleBarlineMeasures, repeatBarlines, accompanimentTracks]);

    // Compute current playhead measure for choral panel insertion.
    const playheadMeasureForChoral = useMemo(() => {
        if (pasteCaret) return pasteCaret.measureIndex;
        if (!playheadPosition || !layoutData?.systemsParams) return 0;
        const sys = layoutData.systemsParams[playheadPosition.systemIndex];
        if (!sys) return 0;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < (sys.startMeasuresX || []).length; i++) {
            const dist = Math.abs((sys.startMeasuresX[i] ?? 0) - playheadPosition.x);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
        return sys.measureIndices[bestIdx] ?? 0;
    }, [pasteCaret, playheadPosition, layoutData]);
    // Aggiorna i ref usati da toggleRecording (definito prima di questi useMemo)
    playheadMeasureForRecRef.current = playheadMeasureForChoral ?? 0;

    // Keep a ref to the latest layoutData so async callbacks can read current layout
    const layoutDataRef = useRef(layoutData);
    useEffect(() => { layoutDataRef.current = layoutData; }, [layoutData]);

    // Highest measure index that currently contains any note. The per-system
    // metric-validation block uses this as the "currently being edited"
    // measure and skips it: the warning rectangle only appears once the user
    // has moved past an incomplete measure to a later one (so the banner does
    // not flicker while a measure is still being filled).
    const globalMaxMeasureWithNotes = useMemo(() => {
        let max = -1;
        for (const n of ((analyzedNotes as any[]) || [])) {
            const mi = Number(n?.measureIndex);
            if (Number.isFinite(mi) && mi > max) max = mi;
        }
        return max >= 0 ? max : null;
    }, [analyzedNotes]);

    const deleteMeasureAtIndex = useCallback((measureIndex: number) => {
        try {
            const m = Math.max(0, Math.trunc(Number(measureIndex)));
            if (!Number.isFinite(m)) return;

            const ld: any = layoutDataRef.current;
            const starts = ld?.measureStartAbsBeat as number[] | undefined;
            const beatsArr = ld?.measureBeatsPerMeasure as number[] | undefined;

            const baseBeats = timeSignature.numerator * (4 / timeSignature.denominator);
            const fallbackBeats = Math.max(1, Number.isFinite(baseBeats) && baseBeats > 0 ? baseBeats : 4);
            const startAbs = (starts && typeof starts[m] === 'number') ? Number(starts[m]) : (m * fallbackBeats);
            const beatsInMeasure = (beatsArr && typeof beatsArr[m] === 'number') ? Math.max(1, Number(beatsArr[m])) : fallbackBeats;
            const endAbs = startAbs + beatsInMeasure;
            const deltaBeats = beatsInMeasure;
            const endTick = Math.round(endAbs * TICKS_PER_QUARTER);
            const deltaTicks = Math.round(deltaBeats * TICKS_PER_QUARTER);

            const ok = (() => {
                try {
                    return window.confirm(`Cancellare davvero la misura ${m + 1}?\n\nLa misura verra' rimossa e tutto cio' che segue verra' spostato indietro di una misura.`);
                } catch {
                    return true;
                }
            })();
            if (!ok) return;

            setRawNotes(prev => {
                const arr = (prev || []) as StaffNote[];
                if (!arr.length) return arr;
                return arr
                    .filter(n => {
                        const mi = Number.isFinite(n.measureIndex) ? (n.measureIndex as number) : null;
                        if (mi == null) return true;
                        return mi !== m;
                    })
                    .map(n => {
                        const mi = Number.isFinite(n.measureIndex) ? (n.measureIndex as number) : null;
                        const next: any = { ...n };
                        if (mi != null && mi > m) next.measureIndex = mi - 1;

                        const st = Number((n as any).startTick);
                        if (Number.isFinite(st) && st >= endTick) next.startTick = st - deltaTicks;
                        return next as StaffNote;
                    });
            });

            setAnalysisContexts(prev => {
                const arr = (prev || []) as AnalysisContext[];
                return arr
                    .filter(c => {
                        const ab = Number((c as any).absBeat);
                        if (Number.isFinite(ab)) return !(ab >= startAbs - 1e-9 && ab < endAbs - 1e-9);
                        const mi = Number.isFinite((c as any).measureIndex) ? Number((c as any).measureIndex) : null;
                        return mi == null ? true : mi !== m;
                    })
                    .map(c => {
                        const next: any = { ...c };
                        const ab = Number((c as any).absBeat);
                        if (Number.isFinite(ab) && ab >= endAbs - 1e-9) next.absBeat = ab - deltaBeats;
                        const mi = Number.isFinite((c as any).measureIndex) ? Number((c as any).measureIndex) : null;
                        if (mi != null && mi > m) next.measureIndex = mi - 1;
                        return next as AnalysisContext;
                    });
            });

            setHarmonyOverrides(prev => {
                const arr = (prev || []) as HarmonyLabelOverride[];
                return arr
                    .filter(o => {
                        const ab = Number((o as any).absBeat);
                        if (!Number.isFinite(ab)) return true;
                        return !(ab >= startAbs - 1e-9 && ab < endAbs - 1e-9);
                    })
                    .map(o => {
                        const next: any = { ...o };
                        const ab = Number((o as any).absBeat);
                        if (Number.isFinite(ab) && ab >= endAbs - 1e-9) next.absBeat = ab - deltaBeats;
                        return next as HarmonyLabelOverride;
                    });
            });

            setTimeSignatureChanges(prev => {
                const arr = (prev || []) as TimeSignatureChange[];
                return arr
                    .filter(c => {
                        const ab = Number((c as any).absBeat);
                        if (Number.isFinite(ab)) {
                            return !(ab > startAbs + 1e-9 && ab < endAbs - 1e-9);
                        }
                        const mi = Number.isFinite((c as any).measureIndex) ? Number((c as any).measureIndex) : null;
                        return mi == null ? true : mi !== m;
                    })
                    .map(c => {
                        const next: any = { ...c };
                        const mi = Number.isFinite((c as any).measureIndex) ? Number((c as any).measureIndex) : null;
                        if (mi != null && mi > m) next.measureIndex = mi - 1;
                        const ab = Number((c as any).absBeat);
                        if (Number.isFinite(ab) && ab >= endAbs - 1e-9) next.absBeat = ab - deltaBeats;
                        return next as TimeSignatureChange;
                    });
            });

            setDoubleBarlineMeasures(prev => (prev || [])
                .filter(x => Number.isFinite(x) && x !== m)
                .map(x => (x > m ? x - 1 : x))
                .filter((x, i, a) => a.indexOf(x) === i)
                .sort((a, b) => a - b)
            );

            // Shift repeat barlines.
            setRepeatBarlines(prev => {
                const next: typeof prev = {};
                for (const [k, v] of Object.entries(prev)) {
                    const mi = Number(k);
                    if (mi === m) continue;
                    next[mi > m ? mi - 1 : mi] = v;
                }
                return next;
            });

            setMinMeasureCount(prev => Math.max(1, (Number.isFinite(prev) ? prev : 1) - 1));
            setMinMeasureCountDraft(prev => {
                const v = Math.trunc(Number(prev));
                const base = Number.isFinite(v) ? v : 1;
                return String(Math.max(1, base - 1));
            });

            setContextMenu(null);
            setHarmonyOverrideMenu(null);
            setSelectedNoteIds(new Set());
        } catch {
            // ignore
        }
    }, [layoutDataRef, setRawNotes, setAnalysisContexts, setHarmonyOverrides, setTimeSignatureChanges, setDoubleBarlineMeasures, setMinMeasureCount, setMinMeasureCountDraft, setContextMenu, setHarmonyOverrideMenu, setSelectedNoteIds, timeSignature]);

    const measureToSystemIndex = useMemo(() => {
        const map = new Map<number, number>();
        if (!layoutData?.systemsParams) return map;
        for (let systemIndex = 0; systemIndex < layoutData.systemsParams.length; systemIndex++) {
            const sys: any = layoutData.systemsParams[systemIndex];
            const measures: number[] = Array.isArray(sys?.measureIndices) ? sys.measureIndices : [];
            for (const measureIndex of measures) {
                if (typeof measureIndex === 'number') map.set(measureIndex, systemIndex);
            }
        }
        return map;
    }, [layoutData]);

    const noteToSystemIndex = useMemo(() => {
        const map = new Map<string, number>();
        const positioned = (layoutData as any)?.positionedNotes;
        if (!Array.isArray(positioned)) return map;
        for (const n of positioned) {
            const id = n?.id;
            const measureIndex = n?.measureIndex;
            if (typeof id !== 'string' || !id) continue;
            if (typeof measureIndex !== 'number') continue;
            const systemIndex = measureToSystemIndex.get(measureIndex);
            if (typeof systemIndex === 'number') map.set(id, systemIndex);
        }
        return map;
    }, [layoutData, measureToSystemIndex]);

    useEffect(() => {
        measureToSystemIndexRef.current = measureToSystemIndex;
        noteToSystemIndexRef.current = noteToSystemIndex;
    }, [measureToSystemIndex, noteToSystemIndex]);

    // Render helper: determine which notes are the *target* of a tie coming from a previous note
    // (possibly across a system/line break). Stored notes only mark the source with isTiedToNext.
    const tiedFromPrevNoteIds = useMemo(() => {
        const out = new Set<string>();
        try {
            const notes = (rawNotes || []).filter(n => n && !n.isRest && Number.isFinite((n as any).midi));
            const byVoice = new Map<number, StaffNote[]>();
            for (const n of notes) {
                const v = (n.voice ?? 1) as number;
                if (!byVoice.has(v)) byVoice.set(v, []);
                byVoice.get(v)!.push(n);
            }
            for (const [v, arr] of byVoice.entries()) {
                arr.sort((a, b) => {
                    const ta = (a.startTick ?? 0);
                    const tb = (b.startTick ?? 0);
                    if (ta !== tb) return ta - tb;
                    const ma = a.measureIndex ?? 0;
                    const mb = b.measureIndex ?? 0;
                    if (ma !== mb) return ma - mb;
                    return (a.beat ?? 1) - (b.beat ?? 1);
                });
                for (let i = 0; i < arr.length; i++) {
                    const cur = arr[i];
                    if (!cur?.isTiedToNext) continue;
                    const curMidi = cur.midi;
                    for (let j = i + 1; j < arr.length; j++) {
                        const next = arr[j];
                        if (!next) continue;
                        if (next.midi === curMidi) {
                            if (typeof next.id === 'string' && next.id) out.add(next.id);
                            break;
                        }
                    }
                }
            }
        } catch {
            // ignore
        }
        return out;
    }, [rawNotes]);

    const scrollScoreToViolationIndex = useCallback((index: number) => {
        const v = violations?.[index];
        if (!v || !Array.isArray(v.noteIds) || v.noteIds.length === 0) return;

        let systemIndex: number | null = null;

        for (const noteId of v.noteIds) {
            const si = noteToSystemIndexRef.current.get(noteId);
            if (typeof si === 'number') {
                systemIndex = si;
                break;
            }
        }

        if (systemIndex == null) {
            // Fallback: look up measureIndex from raw notes and map that to a system.
            const firstId = v.noteIds[0];
            const n = rawNotes.find(r => r.id === firstId);
            const mi = n?.measureIndex;
            const si = typeof mi === 'number' ? measureToSystemIndexRef.current.get(mi) : undefined;
            if (typeof si === 'number') systemIndex = si;
        }

        if (systemIndex == null) return;

        const el = systemElementByIndexRef.current.get(systemIndex);
        if (!el) return;

        // Wait one frame so selection styles apply, then scroll.
        requestAnimationFrame(() => {
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch {
                // Ignore scroll failures (e.g. element not mounted).
            }
        });
    }, [measureToSystemIndexRef, noteToSystemIndexRef, rawNotes, violations]);

    // =========================================================
    // ADAPTER LAYER (domain -> overlay data)
    // =========================================================

    // Timeline-based harmony labels per system (roman+figures and symbol)
    // ADAPTER LAYER — harmony analysis overlay data (extracted to useHarmonyLabels hook)
    const { harmonyLabelsBySystemSequenced, progressionMarkersBySystem, sequenceMarkersBySystem, sequenceModelMarkersBySystem, contextMarkersBySystem, timeSignatureMarkersBySystem, sequenceMatches } = useHarmonyLabels({
        layoutData, timeSignature, timeSignatureChanges, analysisContexts: effectiveAnalysisContexts, harmonyOverrides,
        currentTonic, isMinorMode, isAnalysisEnabled, isSequencesEnabled,
        staffSystemMode, notes, analyzedNotes, analysisContextAbsBeat, timeSignatureChangeAbsBeat,
        harmonyLabelMinSpanBeats: Number(harmonyLabelMinSpanBeats) || 0,
        useStatisticalCorrection: !!useStatisticalCorrection,
        statisticalBiasThreshold: Number(statisticalBiasThreshold) || 2,
        styleProfile: useStatisticalCorrection ? _styleProfile : null,
        ornamentOverrides,
        autoHarmonyLabelOverrides: (analysisResult as any).autoHarmonyLabelOverrides,
        tonicizationHints,
        inferredContextSuppressions,
        enableInferredContexts: enableInferredContexts !== false,
        cadentialPatternsEnabled: cadentialPatternsEnabled !== false,
        accompanimentTracks,
    });

    // Keep a ref to latest harmony labels for save-time corpus recording
    const _harmonyLabelsRef = useRef(harmonyLabelsBySystemSequenced);
    _harmonyLabelsRef.current = harmonyLabelsBySystemSequenced;

    // Chord identity card (explain modal)
    const { isExplainOpen, explainData, openExplain, closeExplain } = useHarmonyExplain({ analyzedNotes, analysisContexts, currentTonic, isMinorMode, analysisContextAbsBeat, timeSignature });

    // Violations -> noteId -> level (defensive extraction)
    const violationLevelByNoteId = useMemo(() => {
        const map = new Map<string, 'error' | 'warning' | 'exception'>();

        const getIds = (v: any): string[] => {
            if (!v) return [];
            if (Array.isArray(v.noteIds)) return v.noteIds;
            if (typeof v.noteId === 'string') return [v.noteId];
            if (Array.isArray(v.notes)) return v.notes.map((n: any) => n?.id).filter(Boolean);
            if (v.note?.id) return [v.note.id];
            return [];
        };

        const getLevel = (v: any): 'error' | 'warning' | 'exception' | 'chromatic' => {
            const s = (v?.severity || v?.level || v?.type || '').toString().toLowerCase();
            if (s.includes('chromatic')) return 'chromatic';
            if (s.includes('exception') || s.includes('green')) return 'exception';
            if (s.includes('warn') || s.includes('yellow')) return 'warning';
            return 'error';
        };

        try {
            const rank: Record<'error' | 'warning' | 'exception' | 'chromatic', number> = {
                error: 3,
                chromatic: 2,
                exception: 2,
                warning: 1,
            };

            (violations as any[]).forEach(v => {
                const level = getLevel(v);
                getIds(v).forEach((id) => {
                    const prev = map.get(id);
                    // strongest wins: error > exception > warning
                    if (!prev || rank[level] > rank[prev]) {
                        map.set(id, level);
                    }
                });
            });
        } catch (err) {
            // Removed debug log
        }

        return map;
    }, [violations]);

    // =========================================================
    // LEGACY (keep ONLY ONE)
    // =========================================================
    const romanAnalysisBySystem = useMemo(() => {
        return [];
    }, []);

    // -----------------------
    // Audio + MIDI (restore)
    // -----------------------
    const midiToName = useCallback((midi: number) => {
        const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        const n = noteNamesWithFlats[midi % 12];
        const octave = Math.floor(midi / 12) - 1; // simple lookup, no accidental context needed here
        return `${n}${octave}`;
    }, []);

    const sendMidiNote = useCallback((note: StaffNote, output: any, durationSec: number, whenMs?: number, channel = 0) => {
        if (!output || note.isRest) return;
        const midi = (note.midi ?? 0) + playbackTransposeSemitones;
        if (!Number.isFinite(midi) || midi <= 0) return;
        // Honor the captured dynamics on external MIDI output too (default 100 for
        // manually-entered notes that have no velocity).
        const noteVel = Number(note.velocity);
        const vel = (Number.isFinite(noteVel) && noteVel > 0) ? Math.max(1, Math.min(127, Math.round(noteVel))) : 100;
        const ch = Math.max(0, Math.min(15, channel)); // MIDI channel 0-15
        const t0 = (typeof whenMs === 'number' && Number.isFinite(whenMs)) ? whenMs : window.performance.now();
        // Use WebMIDI scheduling to avoid chord notes being slightly staggered.
        output.send([0x90 + ch, midi, vel], t0);
        output.send([0x80 + ch, midi, 0], t0 + durationSec * 1000);
    }, [playbackTransposeSemitones]);

    const playNoteSound = useCallback(async (note: StaffNote, durationSec = 0.8) => {
                if (!isAudioReady || !audioService.audioContext || note.isRest) return;
                await audioService.ensureAudioIsReady();
                const midi = (note.midi ?? 0) + playbackTransposeSemitones;
                if (!Number.isFinite(midi) || midi < 21 || midi > 108) return;
                // Calcola la durata in secondi usando durationTicks se presente
                let durationSecFinal = durationSec;
                if (typeof note.durationTicks === 'number' && note.durationTicks > 0) {
                    const beats = note.durationTicks / TICKS_PER_QUARTER;
                    const safeBpm = Math.max(20, Math.min(300, bpm || 120));
                    durationSecFinal = beats * (60 / safeBpm);
                } else {
                    let durBeatsBase = DURATION_VALUES[note.duration ?? 'quarter'] ?? 1;
                    if (note.isDotted) durBeatsBase *= 1.5;
                    if (note.isTriplet) durBeatsBase = durBeatsBase * 2 / 3;
                    if (note.isDuplet) durBeatsBase = durBeatsBase * 3 / 2;
                    const safeBpm = Math.max(20, Math.min(300, bpm || 120));
                    durationSecFinal = durBeatsBase * (60 / safeBpm);
                }
                await audioService.playNote(midiToName(midi), { when: audioService.audioContext.currentTime, duration: durationSecFinal });
    }, [audioService, isAudioReady, midiToName, playbackTransposeSemitones]);

    const playNote = useCallback(async (note: StaffNote, durationSec = 0.8) => {
        if (selectedMidiOutput) {
            sendMidiNote(note, selectedMidiOutput, durationSec, window.performance.now());
            return;
        }
        await playNoteSound(note, durationSec);
    }, [playNoteSound, selectedMidiOutput, sendMidiNote]);
    playNoteRef.current = playNote;

    // stopPlayback now in usePlayback

    const getPlayheadPosForAbsBeat = useCallback((absBeat: number): { x: number; systemIndex: number } | null => {
        if (!layoutData) return null;
        if (!Number.isFinite(absBeat) || absBeat < 0) return null;

        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) {
                const bpm = timeSignature.numerator * (4 / timeSignature.denominator);
                return Math.floor(ab / bpm);
            }
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };
        const measureIndex = findMeasureIndexForAbsBeat(absBeat);
        const beatsPerMeasure = (measureBeatsPerMeasure && measureBeatsPerMeasure[measureIndex])
            ? measureBeatsPerMeasure[measureIndex]
            : (timeSignature.numerator * (4 / timeSignature.denominator));
        if (!Number.isFinite(beatsPerMeasure) || beatsPerMeasure <= 0) return null;

        // IMPORTANT: keep cursor X consistent with insertion snapping.
        // Use tick-based mapping (startX + padding + localTicks * pxPerTick) instead of a
        // proportional beat-in-measure mapping.
        const ticksPerMeasure = Math.round(beatsPerMeasure * TICKS_PER_QUARTER);
        if (!Number.isFinite(ticksPerMeasure) || ticksPerMeasure <= 0) return null;

        const measureStartTick = Math.round(((measureStartAbsBeat && measureStartAbsBeat[measureIndex]) ? measureStartAbsBeat[measureIndex] : (measureIndex * beatsPerMeasure)) * TICKS_PER_QUARTER);
        const absTicks = absBeat * TICKS_PER_QUARTER;
        let localTicks = absTicks - measureStartTick;
        if (!Number.isFinite(localTicks)) localTicks = 0;
        if (localTicks < 0) localTicks = 0;
        if (localTicks > ticksPerMeasure) localTicks = ticksPerMeasure;

        for (let systemIndex = 0; systemIndex < layoutData.systemsParams.length; systemIndex++) {
            const sys = layoutData.systemsParams[systemIndex];
            const idx = sys.measureIndices.indexOf(measureIndex);
            if (idx === -1) continue;

            const startX = sys.startMeasuresX[idx];
            const endX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rawPxPerTick = (sys as any).pxPerTick;
            const pxPerTick = (typeof rawPxPerTick === 'number' && isFinite(rawPxPerTick) && rawPxPerTick > 0)
                ? rawPxPerTick
                : (contentWidth / Math.max(1, ticksPerMeasure));

            let x = startX + MEASURE_PADDING_X + (localTicks * pxPerTick);
            const minX = startX + MEASURE_PADDING_X;
            const maxX = minX + contentWidth;
            if (!Number.isFinite(x)) x = minX;
            if (x < minX) x = minX;
            if (x > maxX) x = maxX;
            return { x, systemIndex };
        }

        return null;
    }, [layoutData, timeSignature]);

    const pasteMarkerPos = useMemo(() => {
        if (!pasteMarker || !layoutData) return null;
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const absBeat = pasteMarker.measureIndex * beatsPerMeasure + (pasteMarker.beat - 1);
        const pos = getPlayheadPosForAbsBeat(absBeat);
        if (!pos) return null;
        const top = (pos.systemIndex * TOTAL_SYSTEM_HEIGHT) + PLAYHEAD_Y_TOP;
        return { x: pos.x, y: top };
    }, [pasteMarker, layoutData, timeSignature, getPlayheadPosForAbsBeat]);

    // Ref stabile per getPlayheadPosForAbsBeat — usato da advanceChordCaret
    // che è dichiarata prima (evita TDZ nella deps array)
    const getPlayheadPosForAbsBeatRef = useRef(getPlayheadPosForAbsBeat);
    useEffect(() => { getPlayheadPosForAbsBeatRef.current = getPlayheadPosForAbsBeat; }, [getPlayheadPosForAbsBeat]);

    // ── Playhead durante la registrazione ────────────────────────────────────
    const recAnimFrameRef = useRef<number | null>(null);
    useEffect(() => {
        if (!isRecording) {
            if (recAnimFrameRef.current !== null) {
                window.cancelAnimationFrame(recAnimFrameRef.current);
                recAnimFrameRef.current = null;
            }
            return;
        }
        const tick = () => {
            const elapsedBeats = getElapsedBeats();
            // Durante il count-in elapsedBeats è negativo: playhead ferma alla misura di partenza
            const absBeat = recStartAbsBeatRef.current + Math.max(0, elapsedBeats);
            playbackCursorAbsBeatRef.current = absBeat;
            const pos = getPlayheadPosForAbsBeatRef.current?.(absBeat);
            if (pos) setPlayheadPosition(pos);
            recAnimFrameRef.current = window.requestAnimationFrame(tick);
        };
        recAnimFrameRef.current = window.requestAnimationFrame(tick);
        return () => {
            if (recAnimFrameRef.current !== null) {
                window.cancelAnimationFrame(recAnimFrameRef.current);
                recAnimFrameRef.current = null;
            }
        };
    }, [isRecording, getElapsedBeats, setPlayheadPosition]);

    useEffect(() => {
        if (!isPlaying) return;
        if (!audioService.audioContext) return;

        const ctx = audioService.audioContext;
        const beatDurationSec = 60 / Math.max(20, Math.min(300, bpm || 120));

        const tick = () => {
            if (!ctx) return;
            const t0 = audioPlaybackStartTimeRef.current;
            const b0 = playbackStartBeatRef.current;
            if (!Number.isFinite(t0) || t0 <= 0) {
                animationFrameRef.current = window.requestAnimationFrame(tick);
                return;
            }

            const elapsedSec = ctx.currentTime - t0;
            // If a tempo curve is active, use its inverse mapping; else linear.
            const curAbsBeat = playbackTimeToBeatRef.current
                ? playbackTimeToBeatRef.current(elapsedSec)
                : b0 + (elapsedSec / beatDurationSec);
            const visualBeat = playbackBeatToVisualBeatRef.current
                ? playbackBeatToVisualBeatRef.current(curAbsBeat)
                : curAbsBeat;
            const pos = getPlayheadPosForAbsBeat(visualBeat);
            if (pos) setPlayheadPosition(pos);

            animationFrameRef.current = window.requestAnimationFrame(tick);
        };

        animationFrameRef.current = window.requestAnimationFrame(tick);
        return () => {
            if (animationFrameRef.current) {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [audioService.audioContext, bpm, getPlayheadPosForAbsBeat, isPlaying]);

    // When playback stops, silence the MIDI output on all channels.
    // CC 64=0 releases sustain first, then CC 123 (All Notes Off) releases held
    // notes. CC 120 (All Sound Off) is intentionally NOT used because Logic Pro
    // and many DAW instruments treat it as a permanent mute that breaks
    // subsequent playback until the channel is reset.
    // Persistent across scheduler runs: lets stopPlayback flush explicit note-offs
    // for notes whose note-on has already been handed to WebMIDI (timestamp may be
    // in the past or up to 100ms in the future, inside the lookahead window).
    const pendingMidiOffsRef = useRef<Array<{ ch: number; note: number; onMs: number; offMs: number }>>([]);

    const wasPlayingRef = useRef(false);
    useEffect(() => {
        if (!isPlaying && wasPlayingRef.current && selectedMidiOutputRef.current) {
            const output = selectedMidiOutputRef.current;
            const now = performance.now();
            // Explicit note-off for every still-active note. Required because many
            // Logic instruments (Alchemy, EXS, third-party plugins) ignore CC 123.
            // Timestamp must be >= the corresponding note-on, otherwise the DAW
            // drops the off before the on has been processed.
            for (const { ch, note, onMs } of pendingMidiOffsRef.current) {
                const ts = Math.max(now + 1, onMs + 5);
                try { output.send([0x80 + ch, note, 0], ts); } catch (_) {}
            }
            pendingMidiOffsRef.current = [];
            // No CC 123 / CC 120 broadcast: Logic Pro instruments treat those as
            // a track-level panic that puts the channel into a frozen state until
            // the user clicks the track to wake it up. The explicit note-offs
            // above already cover every still-active note.
        }
        wasPlayingRef.current = isPlaying;
    }, [isPlaying]);

    // Auto-scroll during playback so the playhead never disappears off-screen.
    const lastAutoScrollSystemRef = useRef<number | null>(null);
    useEffect(() => {
        if (!isPlaying) return;
        if (!playheadPosition) return;

        const container = scoreScrollRef.current;
        if (!container) return;

        const sysIdx = playheadPosition.systemIndex;
        // Auto-scroll ONLY when the active row (system) changes. Within a row the
        // playhead just moves horizontally, so there's no need to touch the vertical
        // scroll — this lets the user pan freely during playback without the view
        // snapping back to the playhead on every tick.
        if (lastAutoScrollSystemRef.current === sysIdx) return;

        const sysEl = systemElementByIndexRef.current.get(sysIdx);
        if (!sysEl) return;
        lastAutoScrollSystemRef.current = sysIdx;

        // Whole-system geometry (the system div's height includes the SATB staves,
        // the Roman-numeral band below, and the accompaniment staves).
        const sysTop = sysEl.offsetTop;
        const sysHeight = sysEl.offsetHeight;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;

        // Already fully on screen → don't move.
        if (sysTop >= viewTop && (sysTop + sysHeight) <= viewBottom) return;

        // Reveal the WHOLE system (so Roman numerals / ACC staves below aren't cut).
        // If it fits, leave a little headroom at the top; otherwise align the top.
        const marginTop = 28;
        const slack = container.clientHeight - sysHeight;
        const targetTopRaw = slack > 0 ? (sysTop - Math.min(marginTop, slack / 2)) : (sysTop - marginTop);

        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const clamped = Math.max(0, Math.min(maxTop, targetTopRaw));
        if (Math.abs(clamped - container.scrollTop) <= 2) return;

        container.scrollTo({ top: clamped, behavior: 'smooth' });
    }, [isPlaying, playheadPosition]);

    const startPlayback = useCallback(async () => {
        if (!isAudioReady) return;

        // Ensure audio context is resumed so we can anchor scheduling.
        await audioService.ensureAudioIsReady();
        const audioCtx = audioService.audioContext;
        if (!audioCtx) return;

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const safeBpm = Math.max(20, Math.min(300, bpm || 120));
        const beatDurationSec = 60 / safeBpm;

        // Helper: effective beats-per-measure at a given measure index,
        // accounting for timeSignatureChanges.
        const _sortedTsChanges = [...(timeSignatureChanges || [])].sort(
            (a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0),
        );
        const bpmAtMeasure = (mi: number): number => {
            let ts = timeSignature;
            for (const ch of _sortedTsChanges) {
                if ((ch.measureIndex ?? Infinity) <= mi) ts = ch;
                else break;
            }
            return ts.numerator * (4 / ts.denominator);
        };
        // Pre-compute cumulative beat offsets per measure so absStartBeat is correct.
        // We build lazily up to the needed measure index.
        const _measureStartBeatCache: number[] = [0];
        const measureStartBeat = (mi: number): number => {
            while (_measureStartBeatCache.length <= mi) {
                const prev = _measureStartBeatCache.length - 1;
                _measureStartBeatCache.push(_measureStartBeatCache[prev] + bpmAtMeasure(prev));
            }
            return _measureStartBeatCache[mi];
        };

        // Build a per-voice timeline so we can merge tied notes into a single longer note.
        type PlaybackItem = {
            note: StaffNote;
            absStartBeat: number;
            durationBeats: number;
            skip: boolean;
            accTrackIdx?: number;
        };

        const byVoice = new Map<number, StaffNote[]>();
        // Use normalizedRawNotes so MIDI values reflect the current key signature
        // and any explicit accidentals the user applied after insertion.
        (normalizedRawNotes || rawNotes).forEach(n => {
            const v = (n.voice ?? 1) as number;
            if (!byVoice.has(v)) byVoice.set(v, []);
            byVoice.get(v)!.push(n);
        });

        const allItems: PlaybackItem[] = [];

        for (const [voice, voiceNotes] of byVoice.entries()) {
            let measureIndex = 0;
            let durationInMeasureNotated = 0;
            let tupletContext: { notesInGroup: number; beatsForGroup: number; notesProcessed: number } | null = null;

            const voiceItems: PlaybackItem[] = [];
            // Chord within ONE voice (e.g. after moving a note onto a voice that
            // already has a note at that beat): notes sharing the previous note's
            // onset sound SIMULTANEOUSLY. They reuse its beat/measure and do NOT
            // advance the time cursor — otherwise the 2nd+ chord notes get
            // serialised (only one sounds; the rest shift to later beats).
            let prevChordStartTick: number | null = null;
            let prevChordPlacement: { measureIndex: number; beat: number; absStartBeatNotated: number } | null = null;

            for (const n of voiceNotes) {
                const curStartTick = typeof (n as any).startTick === 'number' ? (n as any).startTick as number : null;
                const isChordMate = !n.isRest && prevChordPlacement != null
                    && curStartTick != null && prevChordStartTick != null
                    && curStartTick === prevChordStartTick;

                let durationBeatsNotated = DURATION_VALUES[n.duration || 'quarter'] * (n.isDotted ? 1.5 : 1);

                if (!isChordMate && !tupletContext) {
                    if (n.isTriplet) tupletContext = { notesInGroup: 3, beatsForGroup: durationBeatsNotated * 2, notesProcessed: 0 };
                    else if (n.isDuplet) tupletContext = { notesInGroup: 2, beatsForGroup: durationBeatsNotated * 3, notesProcessed: 0 };
                }
                if (tupletContext && !isChordMate) durationBeatsNotated = tupletContext.beatsForGroup / tupletContext.notesInGroup;

                if (!isChordMate && durationInMeasureNotated + durationBeatsNotated > bpmAtMeasure(measureIndex) + 0.001) {
                    measureIndex++;
                    durationInMeasureNotated = 0;
                }
                if (isChordMate) measureIndex = prevChordPlacement!.measureIndex;

                const beat = isChordMate ? prevChordPlacement!.beat : (durationInMeasureNotated + 1);
                const absStartBeatNotated = isChordMate ? prevChordPlacement!.absStartBeatNotated : (measureStartBeat(measureIndex) + (beat - 1));

                // Swing (ottavi terzinati): playback-only mapping for straight eighths.
                // Notation stays in straight time; playback maps offbeats (x.5) to triplet offbeats (x + 2/3).
                let absStartBeat = absStartBeatNotated;
                let durationBeats = durationBeatsNotated;
                if (
                    isSwing
                    && (n.duration || 'quarter') === 'eighth'
                    && !n.isDotted
                    && !n.isTriplet
                    && !n.isDuplet
                ) {
                    const eps = 1e-6;
                    const frac = ((absStartBeatNotated % 1) + 1) % 1;
                    if (Math.abs(frac - 0) < eps) {
                        durationBeats = 2 / 3;
                    } else if (Math.abs(frac - 0.5) < eps) {
                        absStartBeat = Math.floor(absStartBeatNotated) + (2 / 3);
                        durationBeats = 1 / 3;
                    }
                }

                // Playback duration override: prefer the tick-based value (high
                // resolution from MIDI / editor) over the duration LABEL because:
                //  (a) trimmed MIDI notes carry their original sustain in
                //      `playbackDurationTicks` so the recording's pedal sustain
                //      is preserved even though the score shows a shorter note;
                //  (b) for non-trimmed MIDI notes the conservative label
                //      (never longer than the actual recording) can be shorter
                //      than the true duration — using durationTicks restores
                //      the real held time.
                // Skipped when swing has just rewritten durationBeats, so straight
                // eighths still get the triplet-feel mapping intact.
                const swingApplied = (
                    isSwing
                    && (n.duration || 'quarter') === 'eighth'
                    && !n.isDotted
                    && !n.isTriplet
                    && !n.isDuplet
                );
                if (!swingApplied) {
                    const pbTicks = (n as any).playbackDurationTicks;
                    const sustainTicks = (typeof pbTicks === 'number' && pbTicks > 0)
                        ? pbTicks
                        : ((typeof n.durationTicks === 'number' && n.durationTicks > 0) ? n.durationTicks : 0);
                    if (sustainTicks > 0) {
                        durationBeats = sustainTicks / TICKS_PER_QUARTER;
                    }
                }

                voiceItems.push({ note: { ...n, voice: voice as any, measureIndex, beat }, absStartBeat, durationBeats, skip: false });

                if (!isChordMate) {
                    durationInMeasureNotated += durationBeatsNotated;
                    if (tupletContext) {
                        tupletContext.notesProcessed++;
                        if (tupletContext.notesProcessed >= tupletContext.notesInGroup) tupletContext = null;
                    }
                }
                prevChordStartTick = curStartTick;
                prevChordPlacement = { measureIndex, beat, absStartBeatNotated };
            }

            // Merge tie chains: keep the first note, extend its duration, skip the tied-to notes.
            for (let i = 0; i < voiceItems.length; i++) {
                const item = voiceItems[i];
                if (item.skip) continue;
                if (item.note.isRest) continue;
                if (!(item.note as any).isTiedToNext) continue;

                let total = item.durationBeats;
                let curIdx = i;
                while ((voiceItems[curIdx].note as any).isTiedToNext) {
                    const nextIdx = curIdx + 1;
                    if (nextIdx >= voiceItems.length) break;
                    const next = voiceItems[nextIdx];
                    if (next.note.isRest) break;
                    if (next.note.midi !== voiceItems[curIdx].note.midi) break;
                    total += next.durationBeats;
                    next.skip = true;
                    curIdx = nextIdx;
                }
                item.durationBeats = total;
            }

            allItems.push(...voiceItems);
        }

        // ── Repeat expansion ──
        // If there are repeat barlines, duplicate items for repeated measures
        // with shifted absStartBeat so playback replays the correct sections.
        const curRepeatBarlines = repeatBarlinesRef.current;
        if (curRepeatBarlines && Object.keys(curRepeatBarlines).length > 0) {
            const maxMeasure = allItems.reduce((mx, it) => Math.max(mx, it.note.measureIndex ?? 0), 0);
            const measureOrder = expandMeasureOrder(maxMeasure + 1, curRepeatBarlines);

            // Only apply if the expanded order differs from linear (i.e. has actual repeats).
            if (measureOrder.length > maxMeasure + 1) {
                // Index original items by measure.
                const itemsByMeasure = new Map<number, PlaybackItem[]>();
                for (const it of allItems) {
                    const mi = it.note.measureIndex ?? 0;
                    if (!itemsByMeasure.has(mi)) itemsByMeasure.set(mi, []);
                    itemsByMeasure.get(mi)!.push(it);
                }

                // Rebuild allItems with shifted beats + build beat mapping table.
                const expandedItems: PlaybackItem[] = [];
                const beatMapSegments: Array<{ expandedStart: number; origStart: number; length: number }> = [];
                let cumulativeBeat = 0;

                for (const origMeasureIdx of measureOrder) {
                    const bpmForMeasure = bpmAtMeasure(origMeasureIdx);
                    const origMeasureStart = measureStartBeat(origMeasureIdx);

                    beatMapSegments.push({
                        expandedStart: cumulativeBeat,
                        origStart: origMeasureStart,
                        length: bpmForMeasure,
                    });

                    const items = itemsByMeasure.get(origMeasureIdx);
                    if (items) {
                        for (const it of items) {
                            const beatOffsetInMeasure = it.absStartBeat - origMeasureStart;
                            expandedItems.push({
                                ...it,
                                absStartBeat: cumulativeBeat + beatOffsetInMeasure,
                            });
                        }
                    }
                    cumulativeBeat += bpmForMeasure;
                }

                // Replace allItems content.
                allItems.length = 0;
                allItems.push(...expandedItems);

                // Build mapping function: expanded beat → visual (original) beat.
                playbackBeatToVisualBeatRef.current = (expandedBeat: number) => {
                    for (let i = beatMapSegments.length - 1; i >= 0; i--) {
                        const seg = beatMapSegments[i];
                        if (expandedBeat >= seg.expandedStart - 1e-6) {
                            const offset = expandedBeat - seg.expandedStart;
                            return seg.origStart + Math.min(offset, seg.length);
                        }
                    }
                    return expandedBeat;
                };
            } else {
                playbackBeatToVisualBeatRef.current = null;
            }
        } else {
            playbackBeatToVisualBeatRef.current = null;
        }

        // ── Accompaniment track items ──
        // Build PlaybackItems for ACC tracks and add to allItems. The fermata
        // expansion below runs AFTER this so any sustained ACC notes get the
        // correct extension/shift in sync with the SATB fermata.
        const accTracks = latestAccompanimentTracks.current || [];
        accTracks.forEach((track, trackIdx) => {
            // Note: do NOT skip muted tracks here. We still schedule the notes so the
            // user can un-mute mid-playback. Mute is enforced via per-track gain node
            // (gain=0 when muted), allowing real-time toggling without re-scheduling.
            if (!track) return;
            const trackItems: PlaybackItem[] = [];
            for (const n of (track.notes || [])) {
                if (n.isRest) continue;
                // ACC notes from MIDI import have pre-computed measureIndex, beat, durationTicks.
                // Use them directly so chord notes (same tick) share the same absStartBeat.
                const mIdx = n.measureIndex ?? 0;
                const beat = n.beat ?? 1;
                const absStartBeat = measureStartBeat(mIdx) + (beat - 1);
                // Prefer playbackDurationTicks (original sustain before any trim),
                // then durationTicks (high-resolution actual length), then fall
                // back to the duration label.
                const pbTicks = (n as any).playbackDurationTicks;
                const sustainTicks = (typeof pbTicks === 'number' && pbTicks > 0)
                    ? pbTicks
                    : ((typeof n.durationTicks === 'number' && n.durationTicks > 0) ? n.durationTicks : 0);
                const durationBeats = sustainTicks > 0
                    ? sustainTicks / TICKS_PER_QUARTER
                    : DURATION_VALUES[n.duration || 'quarter'] * (n.isDotted ? 1.5 : 1);
                trackItems.push({ note: n, absStartBeat, durationBeats, skip: false, accTrackIdx: trackIdx });
            }

            // Tie-chain merge for ACC: a note with isTiedToNext should sound as a
            // single sustained note that lasts through every consecutive same-pitch
            // tied note in the same track. Unlike SATB voices (monophonic per
            // voice), ACC tracks are polyphonic (chord tones share startTick), so
            // we can't just check the immediate next item — we have to scan
            // forward for the actual tied destination matching by midi and onset
            // tick (≈ end of the current note).
            for (let i = 0; i < trackItems.length; i++) {
                const item = trackItems[i];
                if (item.skip) continue;
                if (item.note.isRest) continue;
                if (!(item.note as any).isTiedToNext) continue;

                let total = item.durationBeats;
                let curIdx = i;
                let safety = 32;
                while (safety-- > 0) {
                    const cur = trackItems[curIdx];
                    if (!(cur.note as any).isTiedToNext) break;
                    const curStart = (cur.note.startTick ?? 0);
                    const curEnd = curStart + (cur.note.durationTicks ?? 0);
                    let nextIdx = -1;
                    for (let j = curIdx + 1; j < trackItems.length; j++) {
                        if (trackItems[j].skip) continue;
                        if (trackItems[j].note.isRest) continue;
                        if (trackItems[j].note.midi !== cur.note.midi) continue;
                        const nextStart = trackItems[j].note.startTick ?? 0;
                        // The tied destination should start at (or very near) the
                        // end of the current note.
                        if (Math.abs(nextStart - curEnd) <= 5) {
                            nextIdx = j;
                            break;
                        }
                    }
                    if (nextIdx === -1) break;
                    const next = trackItems[nextIdx];
                    total += next.durationBeats;
                    next.skip = true;
                    curIdx = nextIdx;
                }
                item.durationBeats = total;
            }

            allItems.push(...trackItems);
        });

        // ── Fermata (corona) expansion ──
        // For every onset that contains at least one note flagged isFermata,
        // double the sounding duration of all items starting at that onset
        // (the fermata "stops" the entire vertical), and shift every later item
        // forward by the same amount. The visual notation is unchanged — this
        // is a playback-only transform. Runs AFTER ACC notes have been added
        // to allItems so accompaniment sustains/onsets get the same extension
        // and shift as SATB (otherwise ACC would race ahead and desync).
        // We also record each fermata's pause window so the visual playhead
        // can FREEZE on the fermata note during the held portion.
        type FermataSeg = {
            cStart: number;       // expanded beat where the fermata onset starts
            cNaturalEnd: number;  // expanded beat where the note's natural duration ends
            cTotalEnd: number;    // expanded beat where the held pause ends
            visualFreeze: number; // pre-fermata beat the playhead should freeze at
        };
        const fermataSegs: FermataSeg[] = [];
        try {
            const fermataOnsets: number[] = [];
            const seenOnsets = new Set<string>();
            for (const it of allItems) {
                if (it.skip || it.note.isRest) continue;
                if (!(it.note as any).isFermata) continue;
                const k = it.absStartBeat.toFixed(6);
                if (seenOnsets.has(k)) continue;
                seenOnsets.add(k);
                fermataOnsets.push(it.absStartBeat);
            }
            if (fermataOnsets.length > 0) {
                fermataOnsets.sort((a, b) => a - b);
                const EPS = 1e-6;
                // Process onsets in order; shifts accumulate.
                let cumulativeShift = 0;
                for (const origOnset of fermataOnsets) {
                    const shiftedOnset = origOnset + cumulativeShift;
                    // Find the longest sounding duration among items starting at this (already-shifted) onset.
                    let maxDur = 0;
                    for (const it of allItems) {
                        if (it.skip || it.note.isRest) continue;
                        if (Math.abs(it.absStartBeat - shiftedOnset) > EPS) continue;
                        if (it.durationBeats > maxDur) maxDur = it.durationBeats;
                    }
                    if (maxDur <= 0) continue;
                    // Convention: fermata raddoppia → extra = maxDur (×2 totale).
                    const extra = maxDur;
                    // Extend all items at this onset by `extra` (full vertical pause).
                    for (const it of allItems) {
                        if (it.skip || it.note.isRest) continue;
                        if (Math.abs(it.absStartBeat - shiftedOnset) > EPS) continue;
                        it.durationBeats += extra;
                    }
                    // Also extend any item whose sustain crosses the fermata onset
                    // (e.g. a long ACC note that started earlier and is still
                    // ringing through the fermata) so it stays in sync.
                    for (const it of allItems) {
                        if (it.skip || it.note.isRest) continue;
                        const start = it.absStartBeat;
                        const end = start + it.durationBeats;
                        if (start < shiftedOnset - EPS && end > shiftedOnset + EPS) {
                            it.durationBeats += extra;
                        }
                    }
                    // Shift every later item forward by `extra`.
                    for (const it of allItems) {
                        if (it.skip) continue;
                        if (it.absStartBeat > shiftedOnset + EPS) {
                            it.absStartBeat += extra;
                        }
                    }
                    fermataSegs.push({
                        cStart: shiftedOnset,
                        cNaturalEnd: shiftedOnset + maxDur,
                        cTotalEnd: shiftedOnset + maxDur + extra,
                        visualFreeze: shiftedOnset + maxDur - cumulativeShift,
                    });
                    cumulativeShift += extra;
                }
            }
        } catch { /* ignore fermata expansion failures */ }

        // Compose fermata mapping with the existing repeat mapping (if any).
        // Goal: convert audio-current beat (in fully-expanded coords) into the
        // visual beat for getPlayheadPosForAbsBeat. During a fermata's pause
        // window, the result freezes on the fermata note's natural end.
        if (fermataSegs.length > 0) {
            const repeatMap = playbackBeatToVisualBeatRef.current;
            const fermataMap = (c: number): number => {
                let cumShift = 0;
                for (const f of fermataSegs) {
                    if (c <= f.cStart + 1e-9) break;
                    if (c <= f.cNaturalEnd + 1e-9) {
                        return c - cumShift;
                    }
                    if (c < f.cTotalEnd - 1e-9) {
                        return f.cNaturalEnd - cumShift;
                    }
                    cumShift = f.cTotalEnd - f.cNaturalEnd + cumShift;
                }
                return c - cumShift;
            };
            playbackBeatToVisualBeatRef.current = repeatMap
                ? (c: number) => repeatMap(fermataMap(c))
                : fermataMap;
        }

        // Group items by start beat (rounded to avoid float key drift with tuplets).
        const startMap = new Map<string, { absBeat: number; items: PlaybackItem[] }>();
        for (const it of allItems) {
            if (it.skip) continue;
            const k = it.absStartBeat.toFixed(6);
            const absBeat = Number(k);
            if (!startMap.has(k)) startMap.set(k, { absBeat, items: [] });
            startMap.get(k)!.items.push(it);
        }

        const events = Array.from(startMap.values()).sort((a, b) => a.absBeat - b.absBeat);

        if (events.length === 0) return;

        setIsPlaying(true);

        const lookaheadMs = 80;
        const startMs = performance.now() + lookaheadMs; // small lookahead
        const audioStartTime = audioCtx.currentTime + (lookaheadMs / 1000);
        const defaultStartAbsBeat = 0;
        const startAbsBeat = Number.isFinite(playbackCursorAbsBeatRef.current as any)
            ? Math.max(0, playbackCursorAbsBeatRef.current as number)
            : defaultStartAbsBeat;

        playbackStartBeatRef.current = startAbsBeat;
        audioPlaybackStartTimeRef.current = audioStartTime;

        // If metronome is on, re-sync it to the playback downbeat grid.
        if (isMetronomeOnRef.current) {
            metronomeSuppressedRef.current = false;
            metronomeLinkedToPlaybackRef.current = true;
            // Use the same anchor as the playback notes so click + music align.
            // We purposely do not turn it off on stop; we just re-anchor on play.
            void startMetronomeScheduler({ anchorWhenSec: audioStartTime, anchorAbsBeat: startAbsBeat });
        }

        // If playback starts from a point with no note event, move the playhead there immediately.
        const startPos = getPlayheadPosForAbsBeat(startAbsBeat);
        if (startPos) setPlayheadPosition(startPos);

        const maxEndAbsBeat = allItems
            .filter(it => !it.skip)
            .reduce((mx, it) => Math.max(mx, it.absStartBeat + it.durationBeats), startAbsBeat);

        const eventsToPlay = events.filter(ev => ev.absBeat + 1e-6 >= startAbsBeat);

        if (eventsToPlay.length === 0) {
            // No notes after the chosen cursor: just stop.
            stopPlayback();
            return;
        }

        // IMPORTANT: preload all needed samples before scheduling.
        // If a note's buffer is fetched/decoded on-demand, it may miss its intended `when`
        // and start late, causing "rolled" chords. Preloading keeps chord attacks aligned.
        if (!selectedMidiOutput && audioService.audioContext) {
            try {
                const neededByInstrument = new Map<string, Set<string>>();
                for (const ev of eventsToPlay) {
                    for (const it of ev.items) {
                        const n = it.note;
                        if (!n || n.isRest) continue;
                        // Preload samples for ALL voices/tracks regardless of mute/solo, so
                        // toggling them mid-playback (now real-time via gain nodes) works.
                        const midi = (n.midi ?? 0) + playbackTransposeSemitones;
                        if (!Number.isFinite(midi) || midi < 21 || midi > 108) continue;
                        const instr = it.accTrackIdx !== undefined
                            ? gmToSoundfont(accTracks[it.accTrackIdx]?.instrumentId)
                            : (voiceInstrumentsRef.current[(n.voice ?? 1) as number] || 'acoustic_grand_piano');
                        if (!neededByInstrument.has(instr)) neededByInstrument.set(instr, new Set());
                        neededByInstrument.get(instr)!.add(midiToName(midi));
                    }
                }
                for (const [instr, notes] of neededByInstrument) {
                    await audioService.preloadNotesForInstrument(instr, Array.from(notes));
                }
            } catch {
                // ignore preload failures; playback will still attempt on-demand load
            }
        }

        // Send MIDI Program Change for each voice channel so external synths
        // (e.g. Logic Pro) know which instrument to use per channel.
        if (selectedMidiOutput) {
            const INSTR_TO_GM: Record<string, number> = {
                acoustic_grand_piano: 0, harpsichord: 6, church_organ: 19,
                violin: 40, cello: 42, string_ensemble_1: 48,
                choir_aahs: 52, trumpet: 56, french_horn: 60,
                oboe: 68, clarinet: 71, flute: 73,
            };
            for (let v = 1; v <= 4; v++) {
                const ch = v - 1;
                const instr = voiceInstrumentsRef.current[v] || 'acoustic_grand_piano';
                const pc = INSTR_TO_GM[instr] ?? 0;
                selectedMidiOutput.send([0xC0 + ch, pc]);
            }
            // Program Change for accompaniment tracks (channels 4+)
            accTracks.forEach((track, idx) => {
                if (!track || track.muted) return;
                const ch = 4 + idx;
                if (ch > 15) return;
                selectedMidiOutput.send([0xC0 + ch, track.instrumentId & 0x7F]);
            });
        }

        // ── Tempo curves (rallentando / accelerando) — playback-only ──
        // Build a piecewise tempo profile. `beatToTime(absBeat)` returns the
        // wall-clock time (in seconds) elapsed from the playback origin (absBeat=0)
        // accounting for any active tempo curves on the resolved item ranges.
        // Linear BPM interpolation (constant Δbpm/Δbeat) means the per-beat
        // duration is 60/(bpm0 + k*(b - b0)), and integration gives a logarithmic
        // term — we use that closed form below for exactness.
        type CurveSeg = { startBeat: number; endBeat: number; fromBpm: number; toBpm: number };
        const curveSegs: CurveSeg[] = [];
        try {
            // Repeats duplicate items: a single note.id can appear multiple times in
            // allItems with different absStartBeats. We must collect every occurrence
            // (sorted) so a curve anchored to two note ids creates one CurveSeg per
            // (start, end) occurrence pair — applying the rallentando on every repeat.
            const idToAbsBeats = new Map<string, number[]>();
            for (const it of allItems) {
                if (!it.note?.id) continue;
                // Includi anche gli item con skip=true (continuazioni di legatura non
                // ribattute): per ancorare una curva di tempo serve solo la POSIZIONE
                // della nota, non se viene ribattuta. Escludendole, una curva che
                // termina su una nota legata non si risolveva (endsFound=0) → nessun
                // rallentando (succedeva sui file con legature, non su quelli nuovi).
                const arr = idToAbsBeats.get(it.note.id);
                if (arr) arr.push(it.absStartBeat);
                else idToAbsBeats.set(it.note.id, [it.absStartBeat]);
            }
            for (const c of (tempoCurvesRef.current || [])) {
                const starts = (idToAbsBeats.get(c.startNoteId) || []).slice().sort((a, b) => a - b);
                const ends = (idToAbsBeats.get(c.endNoteId) || []).slice().sort((a, b) => a - b);
                if (starts.length === 0 || ends.length === 0) continue;
                const from = Math.max(20, Math.min(300, c.fromBpm || safeBpm));
                const to = Math.max(20, Math.min(300, c.toBpm || safeBpm));
                // Pair each start with the next end strictly after it that hasn't been consumed.
                // Greedy two-pointer keeps occurrences in order and avoids cross-repeat overlaps.
                let ei = 0;
                for (const s of starts) {
                    while (ei < ends.length && ends[ei] <= s) ei++;
                    if (ei >= ends.length) break;
                    curveSegs.push({ startBeat: s, endBeat: ends[ei], fromBpm: from, toBpm: to });
                    ei++;
                }
            }
            curveSegs.sort((a, b) => a.startBeat - b.startBeat);
        } catch { /* ignore */ }

        const segDurationSec = (seg: CurveSeg, fromB: number, toB: number): number => {
            // Time required to traverse [fromB, toB] within one curve segment using
            // linear BPM interpolation. Returns Δt in seconds.
            const span = seg.endBeat - seg.startBeat;
            if (span <= 0) return 0;
            const k = (seg.toBpm - seg.fromBpm) / span;
            const bpmAt = (b: number) => seg.fromBpm + k * (b - seg.startBeat);
            if (Math.abs(k) < 1e-9) return (toB - fromB) * 60 / seg.fromBpm;
            const b0 = bpmAt(fromB), b1 = bpmAt(toB);
            // ∫ 60/bpm(b) db = 60/k * ln(bpm(b1)/bpm(b0))
            return (60 / k) * Math.log(b1 / b0);
        };

        const beatToTime = (absBeat: number): number => {
            // Walks beat 0 → absBeat, splitting at each curve boundary.
            let cursor = 0;
            let acc = 0;
            for (const seg of curveSegs) {
                if (absBeat <= cursor + 1e-9) break;
                if (seg.startBeat >= absBeat) break;
                // Pre-segment region (base BPM)
                if (cursor < seg.startBeat) {
                    const span = Math.min(seg.startBeat, absBeat) - cursor;
                    if (span > 0) acc += span * 60 / safeBpm;
                    cursor = Math.min(seg.startBeat, absBeat);
                    if (cursor >= absBeat - 1e-9) break;
                }
                // Inside-segment region
                const segEnd = Math.min(seg.endBeat, absBeat);
                if (segEnd > cursor) {
                    acc += segDurationSec(seg, cursor, segEnd);
                    cursor = segEnd;
                }
                if (cursor >= absBeat - 1e-9) break;
            }
            if (cursor < absBeat) acc += (absBeat - cursor) * 60 / safeBpm;
            return acc;
        };

        const t0Anchor = beatToTime(startAbsBeat);

        // Inverse mapping for the visual playhead: given elapsed seconds since
        // playback origin (audioStartTime), find the absBeat the audio is at.
        // Uses bisection on beatToTime since closed-form inversion is messy with
        // multiple curve segments. Cheap (≤30 iterations) and runs once per RAF.
        if (curveSegs.length > 0) {
            const lastBeat = (allItems.length > 0
                ? allItems.reduce((mx, it) => Math.max(mx, it.absStartBeat + it.durationBeats), 0)
                : startAbsBeat) + 8;
            playbackTimeToBeatRef.current = (elapsedSec: number) => {
                const target = elapsedSec + t0Anchor;
                let lo = startAbsBeat, hi = Math.max(lastBeat, startAbsBeat + 1);
                // Expand hi if needed (rare safety net).
                let guard = 0;
                while (beatToTime(hi) < target && guard++ < 8) hi *= 2;
                for (let i = 0; i < 30; i++) {
                    const mid = (lo + hi) / 2;
                    if (beatToTime(mid) < target) lo = mid; else hi = mid;
                }
                return (lo + hi) / 2;
            };
        } else {
            playbackTimeToBeatRef.current = null;
        }

        // ── Lookahead MIDI scheduler ──────────────────────────────────────────
        // Schedules note-ons AND note-offs within rolling 100ms windows.
        // Note-offs are kept in a local pending list — never sent far ahead.
        // When stopPlayback() calls clearTimeout, the scheduler closure is
        // abandoned: no stale note-offs remain in the WebMIDI queue, so
        // restarting playback never gets silenced by old messages.
        if (selectedMidiOutput) {
            const MIDI_LOOKAHEAD_MS = 100;
            const MIDI_TICK_MS = 50;
            let noteOnIdx = 0;
            // Persistent ref (survives scheduler closure GC) so stopPlayback can
            // flush explicit note-offs for any note-on already handed to WebMIDI.
            const pendingOffs = pendingMidiOffsRef.current;
            pendingOffs.length = 0;

            const tickMidi = () => {
                const out = selectedMidiOutputRef.current;
                if (!out) return;
                const now = performance.now();
                const windowEnd = now + MIDI_LOOKAHEAD_MS;

                // ── Schedule note-ons whose time has entered the window ──
                while (noteOnIdx < eventsToPlay.length) {
                    const ev = eventsToPlay[noteOnIdx];
                    const tEv = beatToTime(ev.absBeat) - t0Anchor;
                    const midiWhenMs = startMs + tEv * 1000;
                    if (midiWhenMs > windowEnd) break;

                    ev.items.forEach((it) => {
                        const n = it.note;
                        if (n.isRest) return;
                        const durBeats = it.durationBeats;
                        const durSec = (Number.isFinite(durBeats) && durBeats > 0)
                            ? Math.max(0.05, beatToTime(it.absStartBeat + durBeats) - beatToTime(it.absStartBeat))
                            : 0.5; // safe fallback
                        if (it.accTrackIdx !== undefined) {
                            const track = latestAccompanimentTracks.current[it.accTrackIdx];
                            if (!track || track.muted) return;
                            const ch = Math.max(0, Math.min(15, 4 + it.accTrackIdx));
                            const midiT = (n.midi ?? 0) + playbackTransposeSemitones;
                            if (!Number.isFinite(midiT) || midiT <= 0) return;
                            const vel = Math.round(Math.min(127, Math.max(1, track.volume * 100)));
                            try { out.send([0x90 + ch, midiT, vel], midiWhenMs); } catch (_) {}
                            pendingOffs.push({ ch, note: midiT, onMs: midiWhenMs, offMs: midiWhenMs + durSec * 1000 });
                            return;
                        }
                        if (soloVoicesRef.current.size > 0 && !soloVoicesRef.current.has((n.voice ?? 1) as number)) return;
                        const ch = Math.max(0, Math.min(15, ((n.voice ?? 1) as number) - 1));
                        const midiT = ((n.midi ?? 0) + playbackTransposeSemitones);
                        if (!Number.isFinite(midiT) || midiT <= 0) return;
                        const vel = 100;
                        try { out.send([0x90 + ch, midiT, vel], midiWhenMs); } catch (_) {}
                        pendingOffs.push({ ch, note: midiT, onMs: midiWhenMs, offMs: midiWhenMs + durSec * 1000 });
                    });
                    noteOnIdx++;
                }

                // ── Flush note-offs whose off-time has entered the window ──
                let i = 0;
                while (i < pendingOffs.length) {
                    const { ch, note, offMs } = pendingOffs[i];
                    if (offMs <= windowEnd) {
                        try { out.send([0x80 + ch, note, 0], offMs); } catch (_) {}
                        pendingOffs.splice(i, 1);
                    } else {
                        i++;
                    }
                }

                if (noteOnIdx < eventsToPlay.length || pendingOffs.length > 0) {
                    const tid = window.setTimeout(tickMidi, MIDI_TICK_MS);
                    playbackTimeoutsRef.current.push(tid);
                }
            };

            const firstTid = window.setTimeout(tickMidi, 0);
            playbackTimeoutsRef.current.push(firstTid);
        }

        eventsToPlay.forEach((ev) => {
            const tEv = beatToTime(ev.absBeat) - t0Anchor;
            const delayMs = tEv * 1000;
            const when = audioStartTime + tEv;
            // DEBUG: log first 4 events inside curve range
            try {
                if (curveSegs.length > 0) {
                    const seg = curveSegs[0];
                    if (ev.absBeat >= seg.startBeat - 0.001 && ev.absBeat <= seg.endBeat + 0.001) {
                        const ctxNow = audioService.audioContext?.currentTime ?? 0;
                    }
                }
            } catch { /* ignore */ }

            // Pre-schedule audio immediately — Web Audio handles precise timing
            // via the `when` parameter (sample-accurate, no setTimeout jitter).
            if (!selectedMidiOutput && audioService.audioContext) {
                ev.items.forEach((it) => {
                    const n = it.note;
                    if (n.isRest) return;
                    if (it.accTrackIdx !== undefined) {
                        const track = latestAccompanimentTracks.current[it.accTrackIdx];
                        if (!track) return;
                        const durSec = Math.max(0.05, beatToTime(it.absStartBeat + it.durationBeats) - beatToTime(it.absStartBeat));
                        const midiT = (n.midi ?? 0) + playbackTransposeSemitones;
                        if (!Number.isFinite(midiT) || midiT < 21 || midiT > 108) return;
                        const instr = gmToSoundfont(track.instrumentId);
                        // Get-or-create persistent per-track gain node. Routing notes through
                        // it lets us mute/change volume in real-time (sample-accurate) even
                        // while notes are already scheduled in the Web Audio queue.
                        let trackGain = accTrackGainsRef.current.get(it.accTrackIdx);
                        if (!trackGain && audioService.audioContext) {
                            trackGain = audioService.audioContext.createGain();
                            trackGain.connect(audioService.audioContext.destination);
                            accTrackGainsRef.current.set(it.accTrackIdx, trackGain);
                            const an = audioService.audioContext.createAnalyser();
                            an.fftSize = 256;
                            trackGain.connect(an); // tap for the mixer signal LEDs
                            accTrackAnalysersRef.current.set(it.accTrackIdx, an);
                        }
                        if (trackGain) {
                            trackGain.gain.value = isTrackAudible(track) ? track.volume : 0;
                        }
                        void audioService.playNoteForInstrument(instr, midiToName(midiT), { when, duration: durSec, volume: velocityToGain(n.velocity), output: trackGain, sustain: true, velocity: n.velocity });
                        return;
                    }
                    const v = (n.voice ?? 1) as number;
                    const durSec = Math.max(0.05, beatToTime(it.absStartBeat + it.durationBeats) - beatToTime(it.absStartBeat));
                    const midi = n.midi;
                    const midiT = (midi ?? 0) + playbackTransposeSemitones;
                    if (!Number.isFinite(midiT) || midiT < 21 || midiT > 108) return;
                    const instr = voiceInstrumentsRef.current[v] || 'acoustic_grand_piano';
                    // Get-or-create per-voice gain node so volume/mute apply in real-time
                    // (same model as the accompaniment tracks above).
                    let voiceGain = voiceGainsRef.current.get(v);
                    if (!voiceGain && audioService.audioContext) {
                        voiceGain = audioService.audioContext.createGain();
                        voiceGain.connect(audioService.audioContext.destination);
                        voiceGainsRef.current.set(v, voiceGain);
                        const an = audioService.audioContext.createAnalyser();
                        an.fftSize = 256;
                        voiceGain.connect(an); // tap for the mixer signal LEDs
                        voiceAnalysersRef.current.set(v, an);
                    }
                    if (voiceGain) {
                        voiceGain.gain.value = isVoiceAudible(v) ? (voiceVolumesRef.current[v] ?? 1) : 0;
                    }
                    void audioService.playNoteForInstrument(instr, midiToName(midiT), { when, duration: durSec, volume: velocityToGain(n.velocity), output: voiceGain, sustain: true, velocity: n.velocity });
                });
            }

            // Visual cursor highlighting via setTimeout (timing less critical than audio/MIDI).
            const t = window.setTimeout(() => {
                const playable = ev.items
                    .filter(it => it.accTrackIdx === undefined)
                    .map(it => it.note)
                    .filter(n => !n.isRest && (n.midi ?? 0) > 0 && (soloVoicesRef.current.size === 0 || soloVoicesRef.current.has((n.voice ?? 1) as number)));

                setPlayingNoteIds(playable.map(n => n.id));
            }, Math.max(0, (startMs - performance.now()) + delayMs));

            playbackTimeoutsRef.current.push(t);
        });

        const endMs = (beatToTime(maxEndAbsBeat) - t0Anchor) * 1000;
        playbackTimeoutsRef.current.push(window.setTimeout(() => { playbackBeatToVisualBeatRef.current = null; playbackTimeToBeatRef.current = null; stopPlayback(); }, Math.max(0, (startMs - performance.now()) + endMs + 200)));
    }, [audioService, bpm, getPlayheadPosForAbsBeat, isAudioReady, isSwing, midiToName, normalizedRawNotes, rawNotes, selectedMidiOutput, sendMidiNote, startMetronomeScheduler, stopPlayback, timeSignature, playbackTransposeSemitones]);

    const togglePlayback = useCallback(() => {
        if (isPlaying) stopPlayback();
        else void startPlayback();
    }, [isPlaying, startPlayback, stopPlayback]);

    // Tempo curve markers — conventional notation: "rall." (or "accel.") text at the
    // start note, followed by a dashed line to the end note. When the curve spans
    // multiple systems (line break), the dash continues on each affected system.
    const tempoCurveMarkersBySystem = useMemo(() => {
        type Seg = {
            curve: TempoCurve;
            index: number;
            isStart: boolean;   // show text label on this segment
            fromX: number;      // dashed-line / text origin
            toX: number;        // dashed-line end
            y: number;          // baseline Y (sopra il SATB per curve SATB, sopra il rigo ACC per curve ACC)
        };
        const out: Record<number, Seg[]> = {};
        const sysParams = (layoutData as any)?.systemsParams;
        const positioned = (layoutData as any)?.positionedNotes;
        if (!Array.isArray(sysParams) || !Array.isArray(positioned)) return out;
        const idToPositioned = new Map<string, any>();
        for (const n of positioned) {
            if (!n?.id) continue;
            if (!idToPositioned.has(n.id)) idToPositioned.set(n.id, n);
        }
        // Risolvi sistema + xPosition per un id, sia SATB (positionedNotes) sia ACC.
        // Le note ACC non sono in positionedNotes: la xPosition si ricalcola con la
        // stessa formula di accompanimentNotesForSystem (baseX misura + tick relativi).
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat ?? [];
        // Y di base del marcatore: sopra il rigo di violino per il SATB; sopra il
        // rigo della traccia ACC per le curve ACC (così non appare "sul SATB").
        const satbMarkerY = (staffSystemMode === 'satb_ancient' ? VF_SATB_SOPRANO_Y : TOP_STAFF_TOP) - 10;
        const ACC_TREBLE_TOP_Y_LOCAL = VF_BASS_Y + 4 * VF_LINE_SPACING + 100; // 310 — prima traccia ACC
        const visAccTracks = (accompanimentTracks || []).filter(t => t && t.visible);
        const accTrebleOffsets = accompanimentTrackTrebleOffsets(visAccTracks);
        const resolvePos = (noteId: string): { sys: number; x: number; y: number } | null => {
            const pn = idToPositioned.get(noteId);
            if (pn) {
                const sys = noteToSystemIndex.get(noteId);
                if (typeof sys === 'number') return { sys, x: pn.xPosition ?? 0, y: satbMarkerY };
            }
            for (const t of (accompanimentTracks || [])) {
                const an = (t.notes || []).find(nn => nn.id === noteId);
                if (!an) continue;
                const mi = an.measureIndex ?? -1;
                const sys = measureToSystemIndex.get(mi);
                if (typeof sys !== 'number') return null;
                const sp = sysParams[sys];
                if (!sp) return null;
                const idxInSys = sp.measureIndices.indexOf(mi);
                if (idxInSys < 0) return null;
                const measureStartTick = beatsToTicks(Number(measureStartAbsBeat[mi]) || 0);
                const relativeTicks = Math.max(0, ((an as any).startTick ?? 0) - measureStartTick);
                const baseX = sp.startMeasuresX?.[idxInSys] ?? 0;
                const vi = visAccTracks.findIndex(vt => vt.id === t.id);
                const accY = ACC_TREBLE_TOP_Y_LOCAL + (vi >= 0 ? (accTrebleOffsets[vi] ?? 0) : 0) - 10;
                return { sys, x: baseX + MEASURE_PADDING_X + relativeTicks * sp.pxPerTick, y: accY };
            }
            return null;
        };
        (tempoCurves || []).forEach((c, index) => {
            const startP = resolvePos(c.startNoteId);
            const endP = resolvePos(c.endNoteId);
            if (!startP || !endP) return;
            const startSys = startP.sys;
            const endSys = endP.sys;
            const startX = startP.x;
            const endX = endP.x;
            const markerY = startP.y;

            const pushSeg = (sys: number, seg: Seg) => {
                if (!out[sys]) out[sys] = [];
                out[sys].push(seg);
            };

            if (startSys === endSys) {
                pushSeg(startSys, { curve: c, index, isStart: true, fromX: startX, toX: endX, y: markerY });
                return;
            }
            // Multi-system: span across each affected system.
            const lo = Math.min(startSys, endSys);
            const hi = Math.max(startSys, endSys);
            for (let sys = lo; sys <= hi; sys++) {
                const sp = sysParams[sys];
                if (!sp) continue;
                const sysStart = (sp.startMeasuresX?.[0]) ?? 0;
                const sysEnd = sp.width ?? sysStart;
                if (sys === startSys) {
                    pushSeg(sys, { curve: c, index, isStart: true, fromX: startX, toX: sysEnd, y: markerY });
                } else if (sys === endSys) {
                    pushSeg(sys, { curve: c, index, isStart: false, fromX: sysStart, toX: endX, y: markerY });
                } else {
                    pushSeg(sys, { curve: c, index, isStart: false, fromX: sysStart, toX: sysEnd, y: markerY });
                }
            }
        });
        return out;
    }, [layoutData, tempoCurves, noteToSystemIndex, accompanimentTracks, measureToSystemIndex]);

    // -----------------------
    // Triplet groups (keep ONLY ONE)
    // -----------------------
    const tripletGroupsBySystem = useMemo(() => {
        const systems: {
            id: string;
            x1: number;
            x2: number;
            midX: number;
            bracketY: number;
            textY: number;
            curveHeight: number;
        }[][] = [];
        if (!layoutData) return systems;

        layoutData.systemsParams.forEach((system, systemIndex) => {
            const measureSet = new Set(system.measureIndices);
            const systemNotes = layoutData.positionedNotes
                .filter(n => !n.isRest && n.isTriplet && measureSet.has(n.measureIndex ?? -1))
                .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || (a.voice ?? 1) - (b.voice ?? 1) || (a.beat ?? 0) - (b.beat ?? 0));

            const groups: {
                id: string; x1: number; x2: number; midX: number; bracketY: number; textY: number; curveHeight: number;
            }[] = [];

            const TUPLET_LEFT_TRIM_PX = 20;

            // group consecutive triplet notes (simple: blocks of >=3 notes in same measure+voice)
            let run: StaffNote[] = [];
            const flush = () => {
                if (run.length < 3) { run = []; return; }

                const first = run[0];
                const last = run[run.length - 1];
                const clef = (first.clef || 'treble') as ClefType;

                const yOffset = clef === 'bass' ? TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT : 0;
                const staffTop = clef === 'bass' ? BOTTOM_STAFF_TOP : TOP_STAFF_TOP;

                const ys = run.map(n => getNoteY(n.position, staffTop, clef));
                const highestY = Math.min(...ys);

                let x1 = (first.xPosition ?? 0) - 6 + TUPLET_LEFT_TRIM_PX;
                const x2 = (last.xPosition ?? 0) + 26;
                // Keep sane ordering.
                if (x1 > x2 - 12) x1 = x2 - 12;
                const midX = (x1 + x2) / 2;

                let bracketY = (highestY + yOffset) - 34;
                // Clamp treble brackets so they don't overlap chord symbols above the staff
                if (clef === 'treble') {
                    const symbolsBottom = (staffSystemMode === 'satb_ancient' ? VF_SATB_SOPRANO_Y : TOP_STAFF_TOP) - 18 + 6 + 4;
                    if (bracketY < symbolsBottom) bracketY = symbolsBottom;
                }
                const textY = bracketY + 14;

                groups.push({
                    id: `triplet-${systemIndex}-${first.id}`,
                    x1, x2, midX,
                    bracketY, textY,
                    curveHeight: 8,
                });

                run = [];
            };

            for (const n of systemNotes) {
                if (
                    run.length === 0 ||
                    ((n.measureIndex ?? 0) === (run[0].measureIndex ?? 0) && (n.voice ?? 1) === (run[0].voice ?? 1) && (n.clef || 'treble') === (run[0].clef || 'treble'))
                ) {
                    run.push(n);
                    // IMPORTANT: keep each triplet bracket strictly on 3 notes.
                    // Otherwise consecutive triplets get merged into a single bracket.
                    if (run.length === 3) flush();
                } else {
                    flush();
                    run = [n];
                }
            }
            flush();

            // Deduplicate overlapping brackets: when multiple voices have triplets
            // at the same x-range, keep only one bracket (the highest position).
            const merged: typeof groups = [];
            for (const g of groups) {
                const overlap = merged.find(m => Math.abs(m.x1 - g.x1) < 20 && Math.abs(m.x2 - g.x2) < 20);
                if (overlap) {
                    // Keep the higher bracket (smaller Y = higher on screen)
                    if (g.bracketY < overlap.bracketY) {
                        overlap.bracketY = g.bracketY;
                        overlap.textY = g.bracketY + 14;
                        overlap.midX = (Math.min(overlap.x1, g.x1) + Math.max(overlap.x2, g.x2)) / 2;
                    }
                } else {
                    merged.push({ ...g });
                }
            }

            systems[systemIndex] = merged;
        });

        return systems;
    }, [layoutData, getNoteY, staffSystemMode]);

    // -----------------------
    // Duplet groups (2 notes per bracket)
    // -----------------------
    const dupletGroupsBySystem = useMemo(() => {
        const systems: {
            id: string;
            x1: number;
            x2: number;
            midX: number;
            bracketY: number;
            textY: number;
            curveHeight: number;
        }[][] = [];
        if (!layoutData) return systems;

        layoutData.systemsParams.forEach((system, systemIndex) => {
            const measureSet = new Set(system.measureIndices);
            const systemNotes = layoutData.positionedNotes
                .filter(n => !n.isRest && n.isDuplet && measureSet.has(n.measureIndex ?? -1))
                .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || (a.voice ?? 1) - (b.voice ?? 1) || (a.beat ?? 0) - (b.beat ?? 0));

            const groups: {
                id: string; x1: number; x2: number; midX: number; bracketY: number; textY: number; curveHeight: number;
            }[] = [];

            const TUPLET_LEFT_TRIM_PX = 20;

            // group consecutive duplet notes in same measure+voice+clef (strictly pairs)
            let run: StaffNote[] = [];
            const flush = () => {
                if (run.length < 2) { run = []; return; }

                const first = run[0];
                const last = run[run.length - 1];
                const clef = (first.clef || 'treble') as ClefType;

                const yOffset = clef === 'bass' ? TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT : 0;
                const staffTop = clef === 'bass' ? BOTTOM_STAFF_TOP : TOP_STAFF_TOP;

                const ys = run.map(n => getNoteY(n.position, staffTop, clef));
                const highestY = Math.min(...ys);

                let x1 = (first.xPosition ?? 0) - 6 + TUPLET_LEFT_TRIM_PX;
                const x2 = (last.xPosition ?? 0) + 26;
                if (x1 > x2 - 12) x1 = x2 - 12;
                const midX = (x1 + x2) / 2;

                let bracketY = (highestY + yOffset) - 34;
                // Clamp treble brackets so they don't overlap chord symbols above the staff
                if (clef === 'treble') {
                    const symbolsBottom = (staffSystemMode === 'satb_ancient' ? VF_SATB_SOPRANO_Y : TOP_STAFF_TOP) - 18 + 6 + 4;
                    if (bracketY < symbolsBottom) bracketY = symbolsBottom;
                }
                const textY = bracketY + 14;

                groups.push({
                    id: `duplet-${systemIndex}-${first.id}`,
                    x1, x2, midX,
                    bracketY, textY,
                    curveHeight: 8,
                });

                run = [];
            };

            for (const n of systemNotes) {
                if (
                    run.length === 0 ||
                    ((n.measureIndex ?? 0) === (run[0].measureIndex ?? 0) && (n.voice ?? 1) === (run[0].voice ?? 1) && (n.clef || 'treble') === (run[0].clef || 'treble'))
                ) {
                    run.push(n);
                    if (run.length === 2) flush();
                } else {
                    flush();
                    run = [n];
                }
            }
            flush();

            // Deduplicate overlapping brackets: when multiple voices have duplets
            // at the same x-range, keep only one bracket (the highest position).
            const merged: typeof groups = [];
            for (const g of groups) {
                const overlap = merged.find(m => Math.abs(m.x1 - g.x1) < 20 && Math.abs(m.x2 - g.x2) < 20);
                if (overlap) {
                    if (g.bracketY < overlap.bracketY) {
                        overlap.bracketY = g.bracketY;
                        overlap.textY = g.bracketY + 14;
                        overlap.midX = (Math.min(overlap.x1, g.x1) + Math.max(overlap.x2, g.x2)) / 2;
                    }
                } else {
                    merged.push({ ...g });
                }
            }

            systems[systemIndex] = merged;
        });

        return systems;
    }, [layoutData, getNoteY, staffSystemMode]);

    // -----------------------
    // ACC triplet & duplet brackets (separate pipeline from SATB, uses ACC stave Y)
    // -----------------------
    const accTupletGroupsBySystem = useMemo(() => {
        const systems: {
            triplets: Array<{ id: string; x1: number; x2: number; midX: number; bracketY: number; textY: number; label: string }>;
            duplets: Array<{ id: string; x1: number; x2: number; midX: number; bracketY: number; textY: number; label: string }>;
        }[] = [];
        if (!layoutData) return systems;
        if (!hasVisibleAccompaniment) return systems;

        const ACC_TREBLE_TOP_Y_LOCAL = VF_BASS_Y + 4 * VF_LINE_SPACING + 100; // 310 — first block treble top
        // Diatonic position (C4=0) of each clef's TOP staff line.
        const ACC_TOP_LINE_POS: Record<ClefType, number> = { treble: 10, bass: -2, alto: 4, tenor: 2, soprano: 8 };
        const accVis = (accompanimentTracks || []).filter(t => t && t.visible);
        const accOffsets = accompanimentTrackTrebleOffsets(accVis);

        // Y of a note on its OWN track's block (per-track vertical stacking + clef).
        const noteYForAcc = (position: number, clef: ClefType, visIdx: number) => {
            const trebleTop = ACC_TREBLE_TOP_Y_LOCAL + (accOffsets[visIdx] ?? 0);
            const mode = accVis[visIdx]?.staffMode ?? 'grandstaff';
            if (mode === 'grandstaff' && clef === 'bass') {
                const bassTop = trebleTop + 130;
                return bassTop + (ACC_TOP_LINE_POS.bass - position) * (VF_LINE_SPACING / 2);
            }
            const useClef: ClefType = mode === 'grandstaff' ? 'treble' : ((accVis[visIdx]?.clef ?? 'treble') as ClefType);
            return trebleTop + ((ACC_TOP_LINE_POS[useClef] ?? 10) - position) * (VF_LINE_SPACING / 2);
        };

        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat ?? [];

        layoutData.systemsParams.forEach((system, systemIndex) => {
            const measureToIdx = new Map<number, number>();
            system.measureIndices.forEach((m, i) => measureToIdx.set(m, i));

            // Build per-system ACC note list with xPosition (matches accompanimentNotesForSystem logic)
            type AccPositioned = StaffNote & { xPosition: number; _trackIdx: number };
            const accNotesInSys: AccPositioned[] = [];
            accVis.forEach((track, visIdx) => {
                for (const n of (track.notes || [])) {
                    if (!n.isTriplet && !n.isDuplet) continue;
                    if (n.isRest) continue;
                    const mi = n.measureIndex ?? -1;
                    const idxInSys = measureToIdx.get(mi);
                    if (idxInSys === undefined) continue;
                    const startTick = (n as any).startTick;
                    if (typeof startTick !== 'number') continue;
                    const msAbsBeat = Number(measureStartAbsBeat[mi]) || 0;
                    const measureStartTick = beatsToTicks(msAbsBeat);
                    const relativeTicks = Math.max(0, startTick - measureStartTick);
                    const relativeX = relativeTicks * system.pxPerTick;
                    const baseX = system.startMeasuresX[idxInSys] ?? 0;
                    const xPosition = baseX + MEASURE_PADDING_X + relativeX;
                    accNotesInSys.push({ ...n, xPosition, _trackIdx: visIdx });
                }
            });

            // Sort by track, measure, startTick
            accNotesInSys.sort((a, b) =>
                a._trackIdx - b._trackIdx ||
                (a.measureIndex ?? 0) - (b.measureIndex ?? 0) ||
                ((a as any).startTick ?? 0) - ((b as any).startTick ?? 0)
            );

            const triplets: typeof systems[number]['triplets'] = [];
            const duplets: typeof systems[number]['duplets'] = [];
            const TUPLET_LEFT_TRIM_PX = 20;

            const buildGroup = (run: AccPositioned[], kind: 'triplet' | 'duplet') => {
                if (run.length < (kind === 'triplet' ? 3 : 2)) return null;
                const first = run[0];
                const last = run[run.length - 1];
                const ys = run.map(n => noteYForAcc(n.position, (n.clef || 'treble') as ClefType, n._trackIdx));
                const highestY = Math.min(...ys);

                let x1 = (first.xPosition ?? 0) - 6 + TUPLET_LEFT_TRIM_PX;
                const x2 = (last.xPosition ?? 0) + 26;
                if (x1 > x2 - 12) x1 = x2 - 12;
                const midX = (x1 + x2) / 2;
                const bracketY = highestY - 34;
                const textY = bracketY + 14;

                return {
                    id: `acc-${kind}-${systemIndex}-${first.id}`,
                    x1, x2, midX, bracketY, textY,
                    label: kind === 'triplet' ? '3' : '2',
                };
            };

            // Triplets: groups of 3 consecutive isTriplet notes in same (track, measure, clef)
            {
                let run: AccPositioned[] = [];
                const flush = () => {
                    const g = buildGroup(run, 'triplet');
                    if (g) triplets.push(g);
                    run = [];
                };
                for (const n of accNotesInSys) {
                    if (!n.isTriplet) { flush(); continue; }
                    if (run.length === 0 ||
                        (run[0]._trackIdx === n._trackIdx &&
                         (run[0].measureIndex ?? 0) === (n.measureIndex ?? 0) &&
                         (run[0].clef || 'treble') === (n.clef || 'treble'))) {
                        run.push(n);
                        if (run.length === 3) flush();
                    } else {
                        flush();
                        run = [n];
                    }
                }
                flush();
            }

            // Duplets: groups of 2
            {
                let run: AccPositioned[] = [];
                const flush = () => {
                    const g = buildGroup(run, 'duplet');
                    if (g) duplets.push(g);
                    run = [];
                };
                for (const n of accNotesInSys) {
                    if (!n.isDuplet) { flush(); continue; }
                    if (run.length === 0 ||
                        (run[0]._trackIdx === n._trackIdx &&
                         (run[0].measureIndex ?? 0) === (n.measureIndex ?? 0) &&
                         (run[0].clef || 'treble') === (n.clef || 'treble'))) {
                        run.push(n);
                        if (run.length === 2) flush();
                    } else {
                        flush();
                        run = [n];
                    }
                }
                flush();
            }

            systems[systemIndex] = { triplets, duplets };
        });

        return systems;
    }, [layoutData, accompanimentTracks, hasVisibleAccompaniment, effectiveAccStaffMode]);

    // -----------------------
    // Accidentals (apply on insertion)
    // -----------------------
    const applyAutoLeadingToneInMinor = useCallback((baseProps: any) => {
        // Auto “sensibile” (scala minore armonica): in tonalità minore alza il VII grado
        // di un semitono di default, senza selezionare manualmente l’accidentale.
        // Se l’utente ha già scelto un accidentale, non intervenire.
        if (!autoLeadingToneInMinor) return baseProps;
        if (!isMinorMode) return baseProps;
        if (activeAccidental) return baseProps;

        const tonicLetter = (currentTonic || '').charAt(0);
        if (!tonicLetter) return baseProps;

        const diatonic = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const tonicIdx = diatonic.indexOf(tonicLetter);
        if (tonicIdx < 0) return baseProps;

        // Leading tone = grado diatonico immediatamente sotto la tonica.
        const leadingLetter = diatonic[(tonicIdx + 6) % 7];
        if (baseProps.pitch !== leadingLetter) return baseProps;

        const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
        const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
        const keyAlterationAmount =
            (keySignature.type === 'sharp' && sharpNotes.includes(baseProps.pitch)) ? 1 :
            (keySignature.type === 'flat' && flatNotes.includes(baseProps.pitch)) ? -1 : 0;

        // baseProps.midi includes the key signature alteration for this diatonic pitch.
        const naturalMidi = baseProps.midi - keyAlterationAmount;
        const finalMidi = baseProps.midi + 1;
        const offsetFromNatural = finalMidi - naturalMidi;

        const autoAccidental: AccidentalType | null =
            offsetFromNatural === 0 ? 'natural' :
                offsetFromNatural === 1 ? 'sharp' :
                    offsetFromNatural === 2 ? 'double-sharp' : null;

        return {
            ...baseProps,
            midi: finalMidi,
            noteIndex: ((finalMidi % 12) + 12) % 12,
            explicitAccidental: autoAccidental,
            accidental: autoAccidental ?? undefined,
        };
    }, [activeAccidental, autoLeadingToneInMinor, currentTonic, isMinorMode, keySignature]);

    const applyActiveAccidental = useCallback((baseProps: any) => {
        if (!activeAccidental) return baseProps;

        const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
        const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
        const keyAlterationAmount =
            (keySignature.type === 'sharp' && sharpNotes.includes(baseProps.pitch)) ? 1 :
            (keySignature.type === 'flat' && flatNotes.includes(baseProps.pitch)) ? -1 : 0;

        const naturalMidi = baseProps.midi - keyAlterationAmount;
        const accidentalOffset =
            activeAccidental === 'sharp' ? 1 :
            activeAccidental === 'flat' ? -1 :
            activeAccidental === 'double-sharp' ? 2 :
            activeAccidental === 'double-flat' ? -2 : 0;

        const finalMidi = naturalMidi + accidentalOffset;

        return {
            ...baseProps,
            midi: finalMidi,
            noteIndex: finalMidi % 12,
            explicitAccidental: activeAccidental,
            accidental: activeAccidental,
            userAccidental: activeAccidental,
        };
    }, [activeAccidental, keySignature]);

    // computeDurationTicks, applyEditToSelectedNotes, applyAccidentalToSelectedNotes now in useNoteEditor

    const setActiveAccidentalAndApply = useCallback((next: AccidentalType | null) => {
        activeAccidentalRef.current = next;
        setActiveAccidental(next);
        applyAccidentalToSelectedNotes(next);
    }, [applyAccidentalToSelectedNotes]);

    const setActiveAccidentalAndApplyFromSource = useCallback((next: AccidentalType | null, source: 'hotkey' | 'toolbar') => {
        // One-shot only when (re-)arming from hotkey.
        accidentalOneShotRef.current = (source === 'hotkey') && !!next;
        setActiveAccidentalAndApply(next);
    }, [setActiveAccidentalAndApply]);

    // applyDottedToSelectedNotes now in useNoteEditor

    const setDottedFromSource = useCallback((nextIsDotted: boolean, source: 'hotkey' | 'toolbar') => {
        dottedOneShotRef.current = (source === 'hotkey') && !!nextIsDotted;
        setSelectedInsertion(prev => ({ ...prev, isDotted: nextIsDotted }));
        applyDottedToSelectedNotes(nextIsDotted);
    }, [applyDottedToSelectedNotes, setSelectedInsertion]);

    // -----------------------
    // Editor interaction (restored minimal)
    // -----------------------
    // handleDeselectOnClickOutside now in useNoteSelection

    const handleNoteClick = useCallback((noteId: string, systemIndex: number, e: React.MouseEvent | MouseEvent) => {
        if (justDraggedRef.current) {
            justDraggedRef.current = false;
            return;
        }

        const nInRaw = rawNotes.find(nn => nn.id === noteId);
        const n = nInRaw ?? latestAccompanimentTracks.current.flatMap(t => t.notes).find(nn => nn.id === noteId);
        const isAccNote = nInRaw === undefined && n !== undefined;

        // Selecting an ACC note makes its track the active paste/REC target.
        if (isAccNote) {
            const accInfo = findAccTrackForNote(noteId, latestAccompanimentTracks.current);
            if (accInfo) {
                activeAccTrackIdRef.current = latestAccompanimentTracks.current[accInfo.trackIndex]?.id ?? null;
                setActiveStaffArea('accompaniment');
            }
        } else if (nInRaw) {
            setActiveStaffArea('satb');
        }

        // INSERT UX FIX: clicking a rest in insert mode should overwrite it
        // by running insertion rather than toggling selection.
        const isModifier = !!((e as any).shiftKey || (e as any).ctrlKey || (e as any).altKey);
        const isCmdHeld = !!((e as any).metaKey || (e as any).ctrlKey);
        if (tool === 'insert' && n?.isRest && !isModifier && !isCmdHeld && !isAccNote) {
            try {
                const target = (e as any).target as Element | null;
                const svg = target?.closest?.('svg') as SVGSVGElement | null;
                if (svg) {
                    e.preventDefault?.();
                    (e as any).stopPropagation?.();
                    const rect = svg.getBoundingClientRect();
                    const vb = svg.viewBox?.baseVal;
                    const svgW = (vb?.width && vb.width > 0) ? vb.width : rect.width;
                    const svgH = (vb?.height && vb.height > 0) ? vb.height : rect.height;
                    const scaleX = rect.width ? (svgW / rect.width) : 1;
                    const scaleY = rect.height ? (svgH / rect.height) : 1;
                    const x = ((e as any).clientX - rect.left) * scaleX;
                    const y = ((e as any).clientY - rect.top) * scaleY;
                    staffClickForInsertRef.current?.(x, y, systemIndex, e as any);
                    return;
                }
            } catch {
                // ignore; fall through to default selection behavior
            }
        }

        e.preventDefault?.();
        e.stopPropagation();

        // Also set a paste caret at the clicked note's time (standard UX: click target, then Cmd+V).
        // Auto-switch voice to the clicked note (requested).
        if (n && typeof (n as any).voice === 'number' && (n as any).voice !== 0) {
            setSelectedVoice((n as any).voice as Voice);
        }
        if (n && Number.isFinite(n.measureIndex) && layoutData) {
            // Trova il systemIndex corretto per la misura
            let systemIndex = 0;
            for (let i = 0; i < layoutData.systemsParams.length; i++) {
                if (layoutData.systemsParams[i].measureIndices.includes(n.measureIndex)) {
                    systemIndex = i;
                    break;
                }
            }
            // Prefer tick-accurate caret when available (prevents paste drift).
            const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
            const ticksPerMeasure = Math.round(beatsPerMeasureLocal * TICKS_PER_QUARTER);
            const measureStartTick = (n.measureIndex ?? 0) * ticksPerMeasure;

            let beat = Number.isFinite(n.beat) ? (n.beat as number) : 1;
            const st = (n as any).startTick;
            if (typeof st === 'number' && isFinite(st)) {
                const localTicks = Math.max(0, Math.min(ticksPerMeasure, st - measureStartTick));
                beat = (localTicks / TICKS_PER_QUARTER) + 1;
            }

            const quantizedBeat = Math.round(beat * 1e6) / 1e6;
            setPasteCaret({
                x: 0,
                systemIndex,
                measureIndex: n.measureIndex,
                beat: quantizedBeat,
            });
        }

        // Compute next selection synchronously so we can decide whether to play the note.
        const shiftKey = !!(e as any).shiftKey;
        const prev = selectedNoteIds;
        const next = new Set(prev);

        if (shiftKey) {
            if (next.has(noteId)) next.delete(noteId);
            else next.add(noteId);
        } else {
            if (next.size === 1 && next.has(noteId)) {
                next.clear();
            } else {
                next.clear();
                next.add(noteId);
            }
        }

        setSelectedNoteIds(next);
        // Clear justInserted flag — user is explicitly selecting/deselecting
        justInsertedNoteRef.current = null;

        // Aggiorna la violation selezionata se la nota è coinvolta in una violation
        if (!shiftKey) {
            if (next.size === 1 && next.has(noteId) && Array.isArray(violations)) {
                const idx = violations.findIndex(v => v.noteIds.includes(noteId));
                setSelectedViolationIndex(idx !== -1 ? idx : null);
            } else {
                setSelectedViolationIndex(null);
            }
        }

        // When a note becomes selected via pointer click, audition it.
        const didSelect = next.has(noteId);
        if (didSelect && n && !n.isRest) {
            // Use normalizedRawNotes for correct MIDI (handles stale fields in legacy files).
            const normalized = (normalizedRawNotes || []).find((nn: any) => nn.id === noteId) ?? n;
            void playNote(normalized, 0.6);
        }
    }, [getPlayheadPosForAbsBeat, normalizedRawNotes, playNote, rawNotes, selectedNoteIds, timeSignature, tool, violations]);

    const pasteClipboardAt = useCallback((targetMeasureIndex: number, targetBeat: number) => {
        const dataToPaste = latestClipboardRef.current;
        if (!dataToPaste || dataToPaste.length === 0) return;

        try {
            const collectSnapshot = (minMeasure: number, maxMeasure: number) => {
                const notes = (layoutDataRef.current?.positionedNotes ?? [])
                    .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= minMeasure && n.measureIndex <= maxMeasure);

                const snapshot = notes.map(n => {
                    // find measure geometry
                    let measureStartX = undefined as number | undefined;
                    let measureWidth = undefined as number | undefined;
                    if (layoutDataRef.current?.systemsParams) {
                        for (const sys of layoutDataRef.current.systemsParams) {
                            const idx = sys.measureIndices.indexOf(n.measureIndex as number);
                            if (idx !== -1) {
                                measureStartX = sys.startMeasuresX[idx];
                                const nextX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                                measureWidth = Math.max(0, (nextX - measureStartX));
                                break;
                            }
                        }
                    }

                    const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                    const pxPerQuarter = measureWidth ? (measureWidth / beatsPerMeasureLocal) : undefined;

                    let fallbackX = undefined as number | undefined;
                    try {
                        if (typeof n.xPosition === 'number') fallbackX = n.xPosition;
                        else if (typeof n.startTick === 'number' && typeof measureStartX === 'number' && typeof measureWidth === 'number') {
                            const absBeat = (n.startTick ?? 0) / TICKS_PER_QUARTER;
                            const beatInMeasure = absBeat - Math.floor(absBeat / beatsPerMeasureLocal) * beatsPerMeasureLocal;
                            fallbackX = measureStartX + (beatInMeasure / beatsPerMeasureLocal) * measureWidth;
                        }
                    } catch (e) {
                        // ignore
                    }

                    return {
                        id: n.id,
                        measureIndex: n.measureIndex,
                        beat: n.beat,
                        startTick: (n as any).startTick,
                        durationTicks: (n as any).durationTicks,
                        xPosition: n.xPosition,
                        fallbackX,
                        measureStartX,
                        measureWidth,
                        pxPerQuarter,
                    };
                });
                return snapshot;
            };

            const beforeSnap = collectSnapshot(Math.max(0, targetMeasureIndex - 1), targetMeasureIndex + 1);
            //
        } catch (e) {
            // ignore
        }

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const measureStarts = (layoutDataRef.current as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeats = (layoutDataRef.current as any)?.measureBeatsPerMeasure as number[] | undefined;

        const absBeatForNote = (n: any) => {
            const m = Number.isFinite(n?.measureIndex) ? Number(n.measureIndex) : 0;
            const b = Number.isFinite(n?.beat) ? Number(n.beat) : 1;
            const start = (measureStarts && measureStarts[m] != null)
                ? measureStarts[m]
                : (m * beatsPerMeasure);
            return start + (b - 1);
        };

        const targetAbsBeat = (measureStarts && measureStarts[targetMeasureIndex] != null)
            ? (measureStarts[targetMeasureIndex] + (targetBeat - 1))
            : ((targetMeasureIndex * beatsPerMeasure) + (targetBeat - 1));

        const srcAbsBeats = dataToPaste
            .map(n => absBeatForNote(n))
            .filter(Number.isFinite);
        const baseAbsBeat = srcAbsBeats.length ? Math.min(...srcAbsBeats) : 0;
        const delta = targetAbsBeat - baseAbsBeat;

        const findMeasureIndexForAbsBeat = (abs: number): number => {
            if (!measureStarts || measureStarts.length === 0) {
                return Math.floor(abs / beatsPerMeasure);
            }
            for (let m = measureStarts.length - 1; m >= 0; m--) {
                if (abs >= (measureStarts[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const chordIdMap = new Map<string, string>();
        const groupIdMap = new Map<string, string>();
        const beamGroupIdMap = new Map<string, string>();
        const remapId = (map: Map<string, string>, id?: string) => {
            if (!id) return undefined;
            if (!map.has(id)) map.set(id, crypto.randomUUID());
            return map.get(id)!;
        };

        const buildMeasureRestSegments = (totalBeats: number): Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> => {
            const EPS = 1e-6;
            const baseDurations: NoteDuration[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth'] as any;
            const candidates: Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> = [];
            for (const d of baseDurations) {
                const b = (DURATION_VALUES as any)[d] as number;
                if (!Number.isFinite(b) || b <= 0) continue;
                candidates.push({ duration: d, isDotted: false, beats: b });
                candidates.push({ duration: d, isDotted: true, beats: b * 1.5 });
            }
            candidates.sort((a, b) => b.beats - a.beats);

            let remaining = totalBeats;
            const out: Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> = [];
            while (remaining > EPS) {
                const pick = candidates.find(c => c.beats <= remaining + EPS);
                if (!pick) break;
                out.push(pick);
                remaining -= pick.beats;
                if (out.length > 32) break;
            }
            return out;
        };

        const forceSelectedVoice = pasteToSelectedVoiceRef.current;
        // Paste DESTINATION is decided here so material can move between tracks and
        // between SATB and orchestration. Priority: the currently SELECTED note (the
        // one the user clicked to choose where to paste) wins — it reliably reflects
        // intent — then fall back to the active staff area/track.
        let destIsAcc = activeStaffAreaRef.current === 'accompaniment';
        let destAccTrackId: string | null = activeAccTrackIdRef.current;
        {
            const selIds = latestSelectedNoteIds.current;
            const selId = selIds && selIds.size > 0 ? [...selIds][0] : null;
            if (selId) {
                const accInfo = findAccTrackForNote(selId, latestAccompanimentTracks.current);
                if (accInfo) {
                    destIsAcc = true;
                    destAccTrackId = latestAccompanimentTracks.current[accInfo.trackIndex]?.id ?? destAccTrackId;
                } else if ((latestRawNotes.current || []).some(n => n.id === selId)) {
                    destIsAcc = false;
                }
            }
        }
        // Compute visibility FRESH from the ref (the component-level
        // hasVisibleAccompaniment is captured stale in this callback's closure).
        const hasVisibleAccFresh = (latestAccompanimentTracks.current || []).some(t => t && t.visible);
        const pasteIntoAcc = destIsAcc && hasVisibleAccFresh;
        const accDestTrack = pasteIntoAcc
            ? (latestAccompanimentTracks.current.find(t => t.id === destAccTrackId && t.visible)
               ?? latestAccompanimentTracks.current.find(t => t.visible) ?? null)
            : null;
        const accDestMode = accDestTrack?.staffMode ?? 'grandstaff';
        const accDestClef: ClefType = (accDestTrack?.clef ?? 'treble') as ClefType;
        // Maps each source note id to its freshly-generated paste id, so per-note marks
        // (ornamentOverrides, e.g. Opt+H/Opt+O) can travel with the copied notes (Q5).
        const noteIdRemap = new Map<string, string>();
        const pasted: StaffNote[] = dataToPaste
            .map(n => {
                const m = n.measureIndex ?? 0;
                const b = n.beat ?? 1;
                const abs = absBeatForNote(n) + delta;
                if (!Number.isFinite(abs) || abs < 0) return null;
                const newId = crypto.randomUUID();
                if ((n as any).id) noteIdRemap.set(String((n as any).id), newId);

                const newMeasureIndex = findMeasureIndexForAbsBeat(abs);
                const bpmLocal = (measureBeats && measureBeats[newMeasureIndex])
                    ? measureBeats[newMeasureIndex]
                    : beatsPerMeasure;
                const startLocal = (measureStarts && measureStarts[newMeasureIndex] != null)
                    ? measureStarts[newMeasureIndex]
                    : (newMeasureIndex * bpmLocal);
                const inMeasure = abs - startLocal;
                const newBeat = Math.round((inMeasure + 1) * 1e6) / 1e6;

                const { xPosition, ...rest } = n as any;

                try {
                    const beatsPerMeasureLocal = (measureBeats && measureBeats[newMeasureIndex])
                        ? measureBeats[newMeasureIndex]
                        : (timeSignature.numerator * (4 / timeSignature.denominator));
                    const absBeat = ((measureStarts && measureStarts[newMeasureIndex] != null)
                        ? measureStarts[newMeasureIndex]
                        : (newMeasureIndex * beatsPerMeasureLocal)) + (newBeat - 1);
                    const startTick = Math.round(absBeat * TICKS_PER_QUARTER);
                    const base = (DURATION_VALUES as any)[(n as any).duration || 'quarter'] || 1;
                    let durBeats = base;
                    if ((n as any).isDotted) durBeats *= 1.5;
                    if ((n as any).isTriplet) durBeats *= 2 / 3;
                    if ((n as any).isDuplet) durBeats *= 3 / 2;
                    const durationTicks = Math.round(durBeats * TICKS_PER_QUARTER);

                    const srcVoice = (n as any).voice ?? selectedVoice;
                    const targetVoice = pasteIntoAcc ? 0 : ((forceSelectedVoice || srcVoice === 0) ? selectedVoice : srcVoice);
                    const targetClef = pasteIntoAcc
                        ? (accDestMode === 'grandstaff' ? ((((n as any).midi ?? 60) >= 60) ? 'treble' : 'bass') : accDestClef)
                        : clefForVoice(targetVoice as any);
                    return {
                        ...(rest as StaffNote),
                        id: newId,
                        measureIndex: newMeasureIndex,
                        beat: newBeat,
                        startTick,
                        durationTicks,
                        voice: targetVoice,
                        clef: targetClef,
                        chordId: remapId(chordIdMap, (n as any).chordId),
                        groupId: remapId(groupIdMap, (n as any).groupId),
                        manualBeamGroupId: remapId(beamGroupIdMap, (n as any).manualBeamGroupId),
                    };
                } catch (e) {
                    const srcVoice = (n as any).voice ?? selectedVoice;
                    const targetVoice = pasteIntoAcc ? 0 : ((forceSelectedVoice || srcVoice === 0) ? selectedVoice : srcVoice);
                    const targetClef = pasteIntoAcc
                        ? (accDestMode === 'grandstaff' ? ((((n as any).midi ?? 60) >= 60) ? 'treble' : 'bass') : accDestClef)
                        : clefForVoice(targetVoice as any);
                    return {
                        ...(rest as StaffNote),
                        id: newId,
                        measureIndex: newMeasureIndex,
                        beat: newBeat,
                        voice: targetVoice,
                        clef: targetClef,
                        chordId: remapId(chordIdMap, (n as any).chordId),
                        groupId: remapId(groupIdMap, (n as any).groupId),
                        manualBeamGroupId: remapId(beamGroupIdMap, (n as any).manualBeamGroupId),
                    };
                }
            })
            .filter(Boolean) as StaffNote[];

        // Q5: carry per-note marks (ornamentOverrides — Opt+H/Opt+O) onto the pasted copies,
        // so marking a note's harmonic/ornamental role survives copy between tracks.
        if (pasted.length > 0 && noteIdRemap.size > 0) {
            setOrnamentOverrides(prev => {
                const arr = prev || [];
                const haveId = new Set(arr.map(o => o.noteId));
                const additions: OrnamentOverride[] = [];
                for (const o of arr) {
                    const mappedId = noteIdRemap.get(o.noteId);
                    if (mappedId && !haveId.has(mappedId)) additions.push({ noteId: mappedId, type: o.type });
                }
                return additions.length > 0 ? [...arr, ...additions] : arr;
            });
        }

        if (pasted.length > 0) {
            if (pasteIntoAcc && accDestTrack) {
                const destId = accDestTrack.id;
                const minTick = Math.min(...pasted.map(n => (n as any).startTick ?? 0));
                const maxTick = Math.max(...pasted.map(n => ((n as any).startTick ?? 0) + ((n as any).durationTicks ?? 0)));
                setAccompanimentTracks(prev => prev.map((track) => {
                    if (track.id !== destId) return track;
                    const filtered = track.notes.filter(n => {
                        const s = (n as any).startTick ?? 0;
                        return s < minTick || s >= maxTick;
                    });
                    return { ...track, notes: [...filtered, ...pasted].sort((a, b) => ((a as any).startTick ?? 0) - ((b as any).startTick ?? 0)) };
                }));
                const lastPasted = pasted[pasted.length - 1];
                setSelectedNoteIds(lastPasted ? new Set([lastPasted.id]) : new Set());
            } else {
            // Incolla in SATB: SCARTA le pause della sorgente. Una traccia ACC è un
            // grand staff e normalizeRhythm riempie ENTRAMBI i righi (es. una pausa
            // intera di basso anche se la melodia è solo al violino). Collassando tutto
            // in UNA voce SATB quelle pause raddoppierebbero il contenuto della misura
            // → l'accumulo del playback sfora e fa scattare la misura in anticipo
            // (flam che cresce di misura in misura) e il layout esplode. Teniamo solo
            // le note reali; le pause corrette per la singola voce le rigenera il
            // gap-fill più sotto.
            const realPasted = pasted.filter(n => !n.isRest);
            const targetVoices = Array.from(new Set(realPasted.map(n => Number((n as any).voice ?? selectedVoice)))).filter(v => Number.isFinite(v));

            setRawNotes(prev => {
                const existingNotes = prev || [];
                const missingRests: StaffNote[] = [];

                const hasNoteInVoiceMeasure = (voice: number, measureIndex: number) =>
                    existingNotes.some(n => Number((n as any).voice ?? -1) === voice && Number(n.measureIndex ?? -1) === measureIndex);

                for (const v of targetVoices) {
                    for (let m = 0; m < targetMeasureIndex; m++) {
                        if (hasNoteInVoiceMeasure(v, m)) continue;
                        const beatsLocal = (measureBeats && measureBeats[m]) ? measureBeats[m] : beatsPerMeasure;
                        const startAbs = (measureStarts && measureStarts[m] != null) ? measureStarts[m] : (m * beatsLocal);
                        const startTick = Math.round(startAbs * TICKS_PER_QUARTER);
                        const segs = buildMeasureRestSegments(beatsLocal);
                        let localTicks = 0;
                        const clef = clefForVoice(v as any);
                        for (const seg of segs) {
                            const durationTicks = Math.max(1, Math.round(seg.beats * TICKS_PER_QUARTER));
                            missingRests.push({
                                id: crypto.randomUUID(),
                                pitch: 'B',
                                octave: clef === 'bass' ? 2 : 4,
                                position: clef === 'bass' ? 4 : 8,
                                midi: 0,
                                noteIndex: 0,
                                duration: seg.duration,
                                isRest: true,
                                isTriplet: false,
                                isDuplet: false,
                                isDotted: seg.isDotted,
                                measureIndex: m,
                                beat: (localTicks / TICKS_PER_QUARTER) + 1,
                                startTick: startTick + localTicks,
                                durationTicks,
                                clef,
                                voice: v as any,
                            });
                            localTicks += durationTicks;
                        }
                    }
                }

                // Tassella le misure toccate dall'incolla con LO STESSO motore dell'ACC
                // (normalizeRhythm), così il collocamento delle pause è IDENTICO tra le
                // due tracce e l'accumulo di durate del playback SATB cade esattamente
                // sulla griglia → niente flam (anche con terzine/durate non binarie).
                // Si re-tassella SOLO la voce e l'intervallo di misure toccate: le note
                // reali esistenti in quell'intervallo vengono ri-tassellate insieme alle
                // incollate (gli onset non si spostano, si rigenerano solo le pause);
                // tutto il resto (altre voci, altre misure, scritto a mano) resta intatto.
                const affectedByVoice = new Map<number, number[]>();
                for (const p of realPasted) {
                    const v = Number((p as any).voice ?? selectedVoice);
                    const m = Number(p.measureIndex ?? 0);
                    if (!affectedByVoice.has(v)) affectedByVoice.set(v, []);
                    affectedByVoice.get(v)!.push(m);
                }
                const removeIds = new Set<string>();
                const retiled: StaffNote[] = [];
                for (const [v, measures] of affectedByVoice.entries()) {
                    const minM = Math.min(...measures);
                    const maxM = Math.max(...measures);
                    // Rimuovi (e rigenera) tutte le note/pause della voce v nell'intervallo
                    // toccato, così la rimozione combacia esattamente con ciò che
                    // normalizeRhythm ri-tassella (evita doppioni nelle misure intermedie).
                    const existingRealInRange: StaffNote[] = [];
                    for (const n of existingNotes) {
                        if (Number((n as any).voice ?? -1) !== v) continue;
                        const m = Number(n.measureIndex ?? -1);
                        if (m < minM || m > maxM) continue;
                        removeIds.add(n.id);
                        if (!n.isRest) existingRealInRange.push(n);
                    }
                    const pastedV = realPasted.filter(n => Number((n as any).voice ?? selectedVoice) === v);
                    const toTile = [...existingRealInRange, ...pastedV];
                    if (toTile.length === 0) continue;
                    retiled.push(...normalizeRhythm(toTile, timeSignature, []));
                }
                const kept = existingNotes.filter(n => !removeIds.has(n.id));

                return [...kept, ...missingRests, ...retiled];
            });
            const lastPasted = realPasted[realPasted.length - 1];
            setSelectedNoteIds(lastPasted ? new Set([lastPasted.id]) : new Set());

            // After a tick, log positions to compare pre/post paste
            setTimeout(() => {
                try {
                    const collectSnapshot = (minMeasure: number, maxMeasure: number) => {
                        const notes = (layoutDataRef.current?.positionedNotes ?? [])
                            .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= minMeasure && n.measureIndex <= maxMeasure);

                        return notes.map(n => {
                            let measureStartX = undefined as number | undefined;
                            let measureWidth = undefined as number | undefined;
                            if (layoutDataRef.current?.systemsParams) {
                                for (const sys of layoutDataRef.current.systemsParams) {
                                    const idx = sys.measureIndices.indexOf(n.measureIndex as number);
                                    if (idx !== -1) {
                                        measureStartX = sys.startMeasuresX[idx];
                                        const nextX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                                        measureWidth = Math.max(0, (nextX - measureStartX));
                                        break;
                                    }
                                }
                            }

                            const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                            const pxPerQuarter = measureWidth ? (measureWidth / beatsPerMeasureLocal) : undefined;

                            let fallbackX = undefined as number | undefined;
                            try {
                                if (typeof n.xPosition === 'number') fallbackX = n.xPosition;
                                else if (typeof n.startTick === 'number' && typeof measureStartX === 'number' && typeof measureWidth === 'number') {
                                    const absBeat = (n.startTick ?? 0) / TICKS_PER_QUARTER;
                                    const beatInMeasure = absBeat - Math.floor(absBeat / beatsPerMeasureLocal) * beatsPerMeasureLocal;
                                    fallbackX = measureStartX + (beatInMeasure / beatsPerMeasureLocal) * measureWidth;
                                }
                            } catch (e) {
                                // ignore
                            }

                            return {
                                id: n.id,
                                measureIndex: n.measureIndex,
                                beat: n.beat,
                                startTick: (n as any).startTick,
                                durationTicks: (n as any).durationTicks,
                                xPosition: n.xPosition,
                                fallbackX,
                                measureStartX,
                                measureWidth,
                                pxPerQuarter,
                            };
                        });
                    };

                    const afterSnap = collectSnapshot(Math.max(0, targetMeasureIndex - 1), targetMeasureIndex + 1);
                    // compute deltas by id
                    const deltas = {} as Record<string, { before?: any; after?: any; dx?: number }>;
                    const before = (layoutDataRef.current?.positionedNotes ?? [])
                        .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= Math.max(0, targetMeasureIndex - 1) && n.measureIndex <= targetMeasureIndex + 1)
                        .map(n => ({ id: n.id, x: n.xPosition }));
                    before.forEach(b => { deltas[b.id] = { before: b }; });
                    afterSnap.forEach(a => {
                        if (!deltas[a.id]) deltas[a.id] = {} as any;
                        deltas[a.id].after = { id: a.id, x: a.xPosition, fallbackX: a.fallbackX };
                        const bx = deltas[a.id].before?.x ?? deltas[a.id].before?.x;
                        const ax = a.xPosition ?? a.fallbackX;
                        if (typeof bx === 'number' && typeof ax === 'number') deltas[a.id].dx = ax - bx;
                    });

                    // compute simple metrics for easy inspection/copy
                    const deltasList = Object.entries(deltas).map(([id, v]) => ({ id, dx: v.dx ?? 0, before: v.before, after: v.after }));
                    const maxAbsDx = deltasList.reduce((acc, v) => Math.max(acc, Math.abs(v.dx ?? 0)), 0);
                    const nonZero = deltasList.filter(d => Math.abs(d.dx ?? 0) > 1e-9).length;
                    //

                    // (layout audit saving removed)
                } catch (e) {
                    // ignore
                }
            }, 60);
            } // end else (SATB paste)
        }
        pasteToSelectedVoiceRef.current = false;
    }, [clefForVoice, selectedVoice, setRawNotes, setSelectedNoteIds, setAccompanimentTracks, timeSignature]);

    const getSystemMeasureAtX = useCallback((systemIndex: number, x: number) => {
        const sys = layoutData?.systemsParams?.[systemIndex];
        if (!sys || !layoutData) return null;

        const count = sys.measureIndices.length;
        if (count === 0) return null;

        // Use the same segment logic as the layout builder (startX -> nextX),
        // and fall back to nearest measure when x is slightly outside.
            for (let i = 0; i < count; i++) {
            const mIdx = sys.measureIndices[i];
            const startX = sys.startMeasuresX[i];
            const endX = i < count - 1 ? sys.startMeasuresX[i + 1] : (sys.width - START_X);
            const w = Math.max(0, endX - startX);
            if (x >= startX && x < endX) return { measureIndex: mIdx, measureStartX: startX, measureWidth: w, pxPerTick: sys.pxPerTick };
        }

        // Fallback: clamp x and pick closest bucket.
        const firstStart = sys.startMeasuresX[0];
        const lastStart = sys.startMeasuresX[count - 1];
        const clampedX = Math.min(Math.max(x, firstStart), sys.width - START_X - 1);
        let idx = 0;
        for (let i = 0; i < count; i++) {
            if (clampedX >= sys.startMeasuresX[i]) idx = i;
            else break;
        }
        const mIdx = sys.measureIndices[idx];
        const startX = sys.startMeasuresX[idx];
        const endX = idx < count - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
        const w = Math.max(0, endX - startX);
        return { measureIndex: mIdx, measureStartX: startX, measureWidth: w, pxPerTick: sys.pxPerTick };
    }, [layoutData]);

    const setPlaybackCursorFromMeasureBeat = useCallback((systemIndex: number, x: number, measureIndex: number, beat: number) => {
        const beatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure?.[measureIndex]
            ?? (timeSignature.numerator * (4 / timeSignature.denominator));
        const startAbs = (layoutData as any)?.measureStartAbsBeat?.[measureIndex] ?? (measureIndex * beatsPerMeasure);
        const absBeat = startAbs + (beat - 1);
        playbackCursorAbsBeatRef.current = absBeat;
        // NOTE: the deterministic tick->x mapping can be slightly left of the actual rendered notehead
        // (VexFlow applies its own glyph spacing). We keep x as a fallback and refine later when
        // note hitpoints are available.
        setPlayheadPosition({ x, systemIndex });
    }, [layoutData, timeSignature]);

    const refinePlayheadXToRenderedNoteheads = useCallback((systemIndex: number, absTicks: number, fallbackX: number): number => {
        try {
            const ld = layoutDataRef.current;
            if (!ld?.systemsParams?.[systemIndex] || !Array.isArray(ld.positionedNotes)) return fallbackX;
            const sys = ld.systemsParams[systemIndex];
            const measureSet = new Set<number>(sys.measureIndices || []);

            // Collect note IDs that start exactly at this tick within the current system.
            const ids: string[] = [];
            for (const n of (ld.positionedNotes as any[]) || []) {
                if (!n || !n.id) continue;
                if (!measureSet.has(n.measureIndex ?? -1)) continue;
                const st = (n as any).startTick;
                if (typeof st === 'number' && st === absTicks) ids.push(String(n.id));
            }
            if (!ids.length) return fallbackX;

            const hitPoints = systemNoteHitPointsRef.current?.[systemIndex] || [];
            if (!hitPoints.length) return fallbackX;
            const byId = new Map(hitPoints.filter((p: any) => p && !p.isGhost && p.id).map((p: any) => [String(p.id), p]));

            const xs: number[] = [];
            for (const id of ids) {
                const p: any = byId.get(id);
                if (p && Number.isFinite(p.x)) xs.push(Number(p.x));
            }
            if (!xs.length) return fallbackX;

            // Average (stable for chords with multiple voices).
            const x = xs.reduce((s, v) => s + v, 0) / xs.length;
            return Number.isFinite(x) ? x : fallbackX;
        } catch {
            return fallbackX;
        }
    }, []);

    // NOTE: playhead refinement effect is declared later (needs getPlayheadPosForAbsBeat).

    const estimateNoteheadOffsetPxForSystem = useCallback((systemIndex: number): number => {
        try {
            const ld = layoutDataRef.current;
            if (!ld?.systemsParams?.[systemIndex] || !Array.isArray(ld.positionedNotes)) return 0;
            const sys = ld.systemsParams[systemIndex];
            const measureSet = new Set<number>(sys.measureIndices || []);

            const hitPoints = systemNoteHitPointsRef.current?.[systemIndex] || [];
            if (!hitPoints.length) return 0;
            const byId = new Map(hitPoints.filter((p: any) => p && !p.isGhost && p.id).map((p: any) => [String(p.id), p]));

            const offsets: number[] = [];
            for (const n of (ld.positionedNotes as any[]) || []) {
                if (!n || !n.id) continue;
                if (!measureSet.has(n.measureIndex ?? -1)) continue;
                const p: any = byId.get(String(n.id));
                if (!p || !Number.isFinite(p.x) || !Number.isFinite(n.xPosition)) continue;
                const dx = Number(p.x) - Number(n.xPosition);
                if (!Number.isFinite(dx)) continue;
                // Keep only plausible glyph offsets (avoid outliers / beams).
                if (dx < -40 || dx > 40) continue;
                offsets.push(dx);
                if (offsets.length >= 40) break;
            }
            if (!offsets.length) return 0;
            offsets.sort((a, b) => a - b);
            const mid = offsets[Math.floor(offsets.length / 2)];
            return Number.isFinite(mid) ? mid : 0;
        } catch {
            return 0;
        }
    }, []);

    // After re-layout (or cursor moves), refine the playhead X:
    // - if a note exists at that tick, snap exactly to the rendered notehead
    // - otherwise, apply the system's typical notehead offset so the playhead indicates
    //   where an inserted notehead will appear (prevents the ~12px jump after insertion)
    useEffect(() => {
        if (isPlaying) return;
        if (!layoutData) return;
        // Skip refine in chord insert mode: advanceChordCaret manages position directly
        if (chordInsertModeRef.current) return;
        if (skipPlayheadRefineOnceRef.current) {
            skipPlayheadRefineOnceRef.current = false;
            return;
        }

        const absBeat = playbackCursorAbsBeatRef.current;
        if (!Number.isFinite(absBeat as any)) return;

        const basePos = getPlayheadPosForAbsBeat(absBeat as number);
        if (!basePos) return;

        const absTicks = Math.round((absBeat as number) * TICKS_PER_QUARTER);
        const snappedToNotehead = refinePlayheadXToRenderedNoteheads(basePos.systemIndex, absTicks, basePos.x);
        const hasNoteheadSnap = Number.isFinite(snappedToNotehead) && Math.abs(snappedToNotehead - basePos.x) > 0.5;

        const offset = hasNoteheadSnap ? 0 : estimateNoteheadOffsetPxForSystem(basePos.systemIndex);
        const targetX = (hasNoteheadSnap ? snappedToNotehead : (basePos.x + offset));

        const curPH = playheadPositionRef.current;
        if (!curPH || curPH.systemIndex !== basePos.systemIndex || Math.abs(curPH.x - targetX) > 0.5) {
            setPlayheadPosition({ x: targetX, systemIndex: basePos.systemIndex });
        }

        // Keep paste caret aligned to the same insertion suggestion.
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const measureIndex = Math.floor((absBeat as number) / beatsPerMeasure);
        const beat = Math.round((((absBeat as number) - (measureIndex * beatsPerMeasure)) + 1) * 1e6) / 1e6;

        const curPC = latestPasteCaretRef.current;
        if (!curPC || curPC.systemIndex !== basePos.systemIndex || Math.abs(curPC.x - targetX) > 0.5) {
            setPasteCaret({ x: targetX, systemIndex: basePos.systemIndex, measureIndex, beat });
        }
    }, [estimateNoteheadOffsetPxForSystem, getPlayheadPosForAbsBeat, isPlaying, layoutData, refinePlayheadXToRenderedNoteheads, timeSignature]);

    const getCurrentAbsBeatForPlayhead = useCallback(() => {
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        void beatsPerMeasure; // keep for clarity; absBeat is already in beats.

        const safeBpm = Math.max(20, Math.min(300, bpm || 120));
        const beatDurationSec = 60 / safeBpm;

        const ctx = audioService.audioContext;
        if (isPlayingRef.current && ctx && audioPlaybackStartTimeRef.current > 0) {
            return playbackStartBeatRef.current + ((ctx.currentTime - audioPlaybackStartTimeRef.current) / beatDurationSec);
        }

        const cur = playbackCursorAbsBeatRef.current;
        return Number.isFinite(cur as any) ? (cur as number) : 0;
    }, [audioService.audioContext, bpm, timeSignature]);

    const getMeasureIndexAndBeatFromAbsBeat = useCallback((absBeat: number) => {
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const starts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const beatsByMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;

        if (starts && starts.length > 0) {
            let m = 0;
            for (let i = starts.length - 1; i >= 0; i--) {
                if (absBeat >= (starts[i] ?? 0) - 1e-9) { m = i; break; }
            }
            const bpm = (beatsByMeasure && beatsByMeasure[m]) ? beatsByMeasure[m] : beatsPerMeasure;
            const beat = Math.round(((absBeat - (starts[m] ?? (m * bpm))) + 1) * 1e6) / 1e6;
            return { measureIndex: m, beat };
        }

        const measureIndex = Math.floor(absBeat / beatsPerMeasure);
        const beat = Math.round(((absBeat - (measureIndex * beatsPerMeasure)) + 1) * 1e6) / 1e6;
        return { measureIndex, beat };
    }, [layoutData, timeSignature]);

    const fillEmptyMeasuresWithRests = useCallback((voice: number, upToMeasureIndex: number) => {
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const measureStarts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeats = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;

        const buildMeasureRestSegments = (totalBeats: number): Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> => {
            const EPS = 1e-6;
            const baseDurations: NoteDuration[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth'] as any;
            const candidates: Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> = [];
            for (const d of baseDurations) {
                const b = (DURATION_VALUES as any)[d] as number;
                if (!Number.isFinite(b) || b <= 0) continue;
                candidates.push({ duration: d, isDotted: false, beats: b });
                candidates.push({ duration: d, isDotted: true, beats: b * 1.5 });
            }
            candidates.sort((a, b) => b.beats - a.beats);

            let remaining = totalBeats;
            const out: Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> = [];
            while (remaining > EPS) {
                const pick = candidates.find(c => c.beats <= remaining + EPS);
                if (!pick) break;
                out.push(pick);
                remaining -= pick.beats;
                if (out.length > 32) break;
            }
            return out;
        };

        setRawNotes(prev => {
            const existing = prev || [];
            const missingRests: StaffNote[] = [];
            const hasNoteInVoiceMeasure = (measureIndex: number) =>
                existing.some(n => Number((n as any).voice ?? -1) === voice && Number(n.measureIndex ?? -1) === measureIndex);

            for (let m = 0; m < upToMeasureIndex; m++) {
                if (hasNoteInVoiceMeasure(m)) continue;
                const beatsLocal = (measureBeats && measureBeats[m]) ? measureBeats[m] : beatsPerMeasure;
                const startAbs = (measureStarts && measureStarts[m] != null) ? measureStarts[m] : (m * beatsLocal);
                const startTick = Math.round(startAbs * TICKS_PER_QUARTER);
                const segs = buildMeasureRestSegments(beatsLocal);
                let localTicks = 0;
                const clef = clefForVoice(voice as any);
                for (const seg of segs) {
                    const durationTicks = Math.max(1, Math.round(seg.beats * TICKS_PER_QUARTER));
                    missingRests.push({
                        id: crypto.randomUUID(),
                        pitch: 'B',
                        octave: clef === 'bass' ? 2 : 4,
                        position: clef === 'bass' ? 4 : 8,
                        midi: 0,
                        noteIndex: 0,
                        duration: seg.duration,
                        isRest: true,
                        isTriplet: false,
                        isDuplet: false,
                        isDotted: seg.isDotted,
                        measureIndex: m,
                        beat: (localTicks / TICKS_PER_QUARTER) + 1,
                        startTick: startTick + localTicks,
                        durationTicks,
                        clef,
                        voice: voice as any,
                    });
                    localTicks += durationTicks;
                }
            }

            if (!missingRests.length) return existing;
            return [...existing, ...missingRests];
        });
    }, [clefForVoice, layoutData, setRawNotes, timeSignature]);

    // (No external-paste handler)

    const toggleDoubleBarlineAtPlayhead = useCallback(() => {
        // Requires a playhead/cursor position so the user has explicit intent.
        if (!playheadPosition) return;

        const absBeat = Math.max(0, getCurrentAbsBeatForPlayhead());
        const { measureIndex } = getMeasureIndexAndBeatFromAbsBeat(absBeat);

        setDoubleBarlineMeasures(prev => {
            const set = new Set(prev);
            if (set.has(measureIndex)) set.delete(measureIndex);
            else set.add(measureIndex);
            return Array.from(set).sort((a, b) => a - b);
        });
    }, [getCurrentAbsBeatForPlayhead, playheadPosition, timeSignature]);

    const insertMeasureAtPlayhead = useCallback(() => {
        if (!playheadPosition) return;

        const absBeat = Math.max(0, getCurrentAbsBeatForPlayhead());
        const { measureIndex: insertAtMeasureIndex } = getMeasureIndexAndBeatFromAbsBeat(absBeat);
        const beatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure?.[insertAtMeasureIndex]
            ?? (timeSignature.numerator * (4 / timeSignature.denominator));
        const ticksPerMeasure = Math.round(beatsPerMeasure * TICKS_PER_QUARTER);
        if (!Number.isFinite(beatsPerMeasure) || beatsPerMeasure <= 0) return;
        if (!Number.isFinite(ticksPerMeasure) || ticksPerMeasure <= 0) return;

        type RestSeg = { duration: NoteDuration; isDotted: boolean; beats: number };
        const buildMeasureRestSegments = (totalBeats: number): RestSeg[] => {
            const EPS = 1e-6;
            const baseDurations: NoteDuration[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth'] as any;
            const candidates: RestSeg[] = [];
            for (const d of baseDurations) {
                const b = (DURATION_VALUES as any)[d] as number;
                if (!Number.isFinite(b) || b <= 0) continue;
                candidates.push({ duration: d, isDotted: false, beats: b });
                candidates.push({ duration: d, isDotted: true, beats: b * 1.5 });
            }
            candidates.sort((a, b) => b.beats - a.beats);

            let remaining = totalBeats;
            const out: RestSeg[] = [];
            while (remaining > EPS) {
                const pick = candidates.find(c => c.beats <= remaining + EPS);
                if (!pick) break;
                out.push(pick);
                remaining -= pick.beats;
                if (out.length > 32) break;
            }
            return out;
        };

        // Shift notes and inject a full-measure rest bar for each active voice.
        setRawNotes(prev => {
            const voicesInUse = Array.from(new Set((prev || []).map(n => Number((n as any)?.voice ?? 1)).filter(v => Number.isFinite(v))))
                .filter(v => v >= 1 && v <= 4);
            const voices = voicesInUse.length ? voicesInUse : [1];

            const startAbs = (layoutData as any)?.measureStartAbsBeat?.[insertAtMeasureIndex] ?? (insertAtMeasureIndex * beatsPerMeasure);
            const measureStartTick = Math.round(startAbs * TICKS_PER_QUARTER);
            const segs = buildMeasureRestSegments(beatsPerMeasure);

            const shifted = (prev || []).map((n: any) => {
                const mi = Number(n?.measureIndex ?? 0);
                if (!Number.isFinite(mi) || mi < insertAtMeasureIndex) return n;

                const nextMeasureIndex = mi + 1;
                const st = (typeof n?.startTick === 'number' && Number.isFinite(n.startTick))
                    ? n.startTick
                    : Math.round((((layoutData as any)?.measureStartAbsBeat?.[mi] ?? (mi * beatsPerMeasure)) + ((Number(n?.beat ?? 1) - 1))) * TICKS_PER_QUARTER);
                const nextStartTick = st + ticksPerMeasure;
                return { ...n, measureIndex: nextMeasureIndex, startTick: nextStartTick };
            });

            const injectedRests: StaffNote[] = [];
            for (const v of voices) {
                const clef = clefForVoice(v);
                let localTicks = 0;
                for (const seg of segs) {
                    const durationTicks = Math.max(1, Math.round(seg.beats * TICKS_PER_QUARTER));
                    injectedRests.push({
                        id: crypto.randomUUID(),
                        pitch: 'B',
                        octave: clef === 'bass' ? 2 : 4,
                        position: clef === 'bass' ? 4 : 8,
                        midi: 0,
                        noteIndex: 0,
                        duration: seg.duration,
                        isRest: true,
                        isTriplet: false,
                        isDuplet: false,
                        isDotted: seg.isDotted,
                        measureIndex: insertAtMeasureIndex,
                        beat: (localTicks / TICKS_PER_QUARTER) + 1,
                        startTick: measureStartTick + localTicks,
                        durationTicks,
                        clef,
                        voice: v as any,
                    });
                    localTicks += durationTicks;
                }
            }

            const next = [...shifted, ...injectedRests].sort((a: any, b: any) => {
                const ma = Number(a?.measureIndex ?? 0);
                const mb = Number(b?.measureIndex ?? 0);
                if (ma !== mb) return ma - mb;
                const sa = (typeof a?.startTick === 'number' ? a.startTick : 0);
                const sb = (typeof b?.startTick === 'number' ? b.startTick : 0);
                if (sa !== sb) return sa - sb;
                const va = Number(a?.voice ?? 1);
                const vb = Number(b?.voice ?? 1);
                return va - vb;
            });
            return next;
        });

        // Shift key contexts (modulation/tonicization markers) after insertion.
        setAnalysisContexts(prev => {
            const next = (prev || []).map((c: any) => {
                const abs = (typeof c?.absBeat === 'number' && Number.isFinite(c.absBeat)) ? c.absBeat : null;
                if (abs != null) {
                    const mi = Math.floor(abs / beatsPerMeasure);
                    if (mi >= insertAtMeasureIndex) return { ...c, absBeat: abs + beatsPerMeasure };
                    return c;
                }
                const mi = Number(c?.measureIndex);
                if (Number.isFinite(mi) && mi >= insertAtMeasureIndex) return { ...c, measureIndex: mi + 1 };
                return c;
            });
            return next.sort((a: any, b: any) => {
                const aa = (typeof a?.absBeat === 'number') ? a.absBeat : ((a?.measureIndex ?? 0) * beatsPerMeasure);
                const bb = (typeof b?.absBeat === 'number') ? b.absBeat : ((b?.measureIndex ?? 0) * beatsPerMeasure);
                return aa - bb;
            });
        });

        setTimeSignatureChanges(prev => {
            const next = (prev || []).map((c: any) => {
                const abs = (typeof c?.absBeat === 'number' && Number.isFinite(c.absBeat)) ? c.absBeat : null;
                if (abs != null) {
                    const mi = Math.floor(abs / beatsPerMeasure);
                    if (mi >= insertAtMeasureIndex) return { ...c, absBeat: abs + beatsPerMeasure, measureIndex: (Number(c.measureIndex) || 0) + 1 };
                    return c;
                }
                const mi = Number(c?.measureIndex);
                if (Number.isFinite(mi) && mi >= insertAtMeasureIndex) return { ...c, measureIndex: mi + 1 };
                return c;
            });
            return next;
        });

        // Shift double barlines.
        setDoubleBarlineMeasures(prev => (prev || [])
            .map(m => (m >= insertAtMeasureIndex ? m + 1 : m))
            .sort((a, b) => a - b)
        );

        // Shift repeat barlines.
        setRepeatBarlines(prev => {
            const next: typeof prev = {};
            for (const [k, v] of Object.entries(prev)) {
                const mi = Number(k);
                next[mi >= insertAtMeasureIndex ? mi + 1 : mi] = v;
            }
            return next;
        });

        // Ensure the score length grows by one measure.
        setMinMeasureCount(prev => {
            const next = Math.max(1, (prev || 1) + 1);
            setMinMeasureCountDraft(String(next));
            return next;
        });

        // Keep playhead/caret at the start of the inserted empty bar.
        try {
            playbackCursorAbsBeatRef.current = (layoutData as any)?.measureStartAbsBeat?.[insertAtMeasureIndex] ?? (insertAtMeasureIndex * beatsPerMeasure);
        } catch { /* ignore */ }
    }, [clefForVoice, getCurrentAbsBeatForPlayhead, getMeasureIndexAndBeatFromAbsBeat, layoutData, playheadPosition, setAnalysisContexts, timeSignature]);

    const handleStaffRightClick = useCallback((x: number, y: number, systemIndex: number, e: MouseEvent) => {
        if (!layoutData) return;
        e.preventDefault();
        e.stopPropagation();

        // Option+RightClick: open harmony-override editor.
        // (Keeps the default right-click behavior for playhead/modulation menu.)
        const wantsHarmonyOverride = !!(e as any).altKey;

        // Right-click *on the playhead* opens the modulation/tonicization menu at the playhead time.
        if (playheadPosition && playheadPosition.systemIndex === systemIndex && Math.abs(x - playheadPosition.x) <= PLAYHEAD_CONTEXT_HIT_PX) {
            const absBeat = Math.max(0, Math.round(getCurrentAbsBeatForPlayhead() * 1e6) / 1e6);
            const { measureIndex, beat } = getMeasureIndexAndBeatFromAbsBeat(absBeat);

            // Deselect all notes.
            setSelectedNoteIds(new Set());

            if (wantsHarmonyOverride) {
                setHarmonyOverrideMenu({ x: e.clientX, y: e.clientY, absBeat, measureIndex, beat });
            }
            // Normal right-click on playhead: just deselect, no context menu.
            return;
        }

        const hit = getSystemMeasureAtX(systemIndex, x);
        if (!hit) return;

        const beatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure?.[hit.measureIndex]
            ?? (timeSignature.numerator * (4 / timeSignature.denominator));
        const ticksPerMeasure = Math.round(beatsPerMeasure * TICKS_PER_QUARTER);

        const contentWidth = Math.max(1, hit.measureWidth - (MEASURE_PADDING_X * 2));
        const relX = x - (hit.measureStartX + MEASURE_PADDING_X);

        // Limita il click all'interno della misura visibile
        const clampedRelX = Math.max(0, Math.min(contentWidth, relX));

        // Tick-based snapping (same philosophy as left-click insertion).
        const measureStartTick = Math.round((((layoutData as any)?.measureStartAbsBeat?.[hit.measureIndex] ?? (hit.measureIndex * beatsPerMeasure))) * TICKS_PER_QUARTER);

        const rawPxPerTick = hit.pxPerTick;
        const pxPerTick = (typeof rawPxPerTick === 'number' && isFinite(rawPxPerTick) && rawPxPerTick > 0)
            ? rawPxPerTick
            : (contentWidth / Math.max(1, ticksPerMeasure));
        let localTicksRaw = clampedRelX / Math.max(1e-9, pxPerTick);
        if (!Number.isFinite(localTicksRaw)) localTicksRaw = 0;
        if (localTicksRaw < 0) localTicksRaw = 0;
        if (localTicksRaw > ticksPerMeasure) localTicksRaw = ticksPerMeasure;

        let durBeatsBase = DURATION_VALUES[selectedInsertion.duration] ?? 1;
        if (selectedInsertion.isDotted) durBeatsBase *= 1.5;
        durBeatsBase *= tupletFactor;
        if (!isFinite(durBeatsBase) || durBeatsBase <= 0) durBeatsBase = 1;
        const durationTicks = Math.max(1, Math.round(durBeatsBase * TICKS_PER_QUARTER));
        // Cap snap at the 8th note so longer notes (quarters, halves) can start on any
        // 8th — beat OR off-beat (sul levare). Left-biased snapping keeps the beat easy.
        const snapCapTicks = Math.round(TICKS_PER_QUARTER / 2);
        // GCD ensures dotted/triplet durations (e.g. dotted-8th=720) still reach beat positions
        // that are multiples of TICKS_PER_QUARTER. Without this, floor(1920/720)*720=1440 (beat 2.5).
        const _snapGcd1 = (a: number, b: number): number => { let x = Math.abs(a); let y = Math.abs(b); while (y) { [x, y] = [y, x % y]; } return x || 1; };
        const baseSnapGridTicks = Math.max(1, _snapGcd1(Math.min(durationTicks, snapCapTicks), TICKS_PER_QUARTER));
        const snapGridTicks = e.shiftKey
            ? Math.max(1, Math.floor(baseSnapGridTicks / 2))
            : baseSnapGridTicks;

        let snappedLocalTicks = Math.floor(localTicksRaw / snapGridTicks) * snapGridTicks;
        const maxLocalStart = Math.max(0, ticksPerMeasure - durationTicks);
        if (snappedLocalTicks < 0) snappedLocalTicks = 0;
        if (snappedLocalTicks > maxLocalStart) snappedLocalTicks = maxLocalStart;

        const beat = Math.round(((snappedLocalTicks / TICKS_PER_QUARTER) + 1) * 1e6) / 1e6;

        // Use the snapped tick position for the playhead X so the cursor has a single, deterministic location.
        const snappedX = (hit.measureStartX + MEASURE_PADDING_X) + (snappedLocalTicks * pxPerTick);

        setPlaybackCursorFromMeasureBeat(systemIndex, snappedX, hit.measureIndex, beat);
        // Aggiorna sempre pasteCaret con beat quantizzato
        setPasteCaret({ x: snappedX, systemIndex, measureIndex: hit.measureIndex, beat });

        // Deselect all notes on right-click (cursor-only positioning).
        setSelectedNoteIds(new Set());

        const absBeat = Math.max(0, Math.round((((layoutData as any)?.measureStartAbsBeat?.[hit.measureIndex] ?? (hit.measureIndex * beatsPerMeasure)) + (beat - 1)) * 1e6) / 1e6);
        if (wantsHarmonyOverride) {
            setHarmonyOverrideMenu({ x: e.clientX, y: e.clientY, absBeat, measureIndex: hit.measureIndex, beat });
        }
        // Normal right-click: just position cursor, no context menu.
        // Use 'T' hotkey to open the tonicization/modulation panel instead.
    }, [getCurrentAbsBeatForPlayhead, getMeasureIndexAndBeatFromAbsBeat, getSystemMeasureAtX, layoutData, playheadPosition, selectedInsertion, selectedVoice, setPlaybackCursorFromMeasureBeat, timeSignature, tupletFactor]);

    const qAbsForOverrides = useCallback((x: number) => {
        try {
            const q = 192;
            return Math.round(Number(x) * q) / q;
        } catch {
            return Number(x) || 0;
        }
    }, []);

    const existingHarmonyOverrideForMenu = useMemo(() => {
        if (!harmonyOverrideMenu) return null;
        const a = qAbsForOverrides(harmonyOverrideMenu.absBeat);
        return (harmonyOverrides || []).find(o => qAbsForOverrides(o.absBeat) === a) || null;
    }, [harmonyOverrideMenu, harmonyOverrides, qAbsForOverrides]);

    const applyHarmonyOverride = useCallback((absBeat: number, roman: string, figures: string[], symbol: string) => {
        const a = qAbsForOverrides(absBeat);
        setHarmonyOverrides(prev => {
            const arr = (prev || []).slice();
            const idx = arr.findIndex(o => qAbsForOverrides(o.absBeat) === a);
            const cleanedRoman = String(roman || '').trim();
            const cleanedSymbol = String(symbol || '').trim();
            const cleanedFigures = (figures || []).map(x => String(x).trim()).filter(Boolean);
            const next: HarmonyLabelOverride = {
                absBeat: a,
                roman: cleanedRoman,
                symbol: cleanedSymbol,
                figures: cleanedFigures,
            };
            if (idx >= 0) arr[idx] = { ...arr[idx], ...next };
            else arr.push(next);
            return arr.sort((x, y) => qAbsForOverrides(x.absBeat) - qAbsForOverrides(y.absBeat));
        });
    }, [qAbsForOverrides]);

    const removeHarmonyOverride = useCallback((absBeat: number) => {
        const a = qAbsForOverrides(absBeat);
        setHarmonyOverrides(prev => (prev || []).filter(o => qAbsForOverrides(o.absBeat) !== a));
    }, [qAbsForOverrides]);

    /**
     * Opt+Shift+H — "Marca come accordo unico alla playhead".
     * Prende le note selezionate (anche sparse su beat diversi, es. un arpeggio), su SATB
     * e/o sulle tracce di accompagnamento (ACC), ne deduce un'unica sigla/roman dall'insieme
     * dei pitch (basso = pitch più grave) e la ancóra al beat della playhead. Gli altri onset
     * della selezione vengono soppressi con override "vuoti" (roman/symbol/figures vuoti →
     * l'evento viene saltato in useHarmonyLabels), così l'arpeggio collassa in una sola
     * etichetta. Per un accordo solo-ACC (nessuna nota SATB sotto la playhead) l'hook
     * sintetizza l'evento-etichetta sul beat dell'override.
     */
    const markSelectionAsChordAtPlayhead = useCallback(() => {
        const ids = selectedNoteIds;
        if (ids.size < 2) return;

        const ld = layoutDataRef.current as any;
        const starts = ld?.measureStartAbsBeat as number[] | undefined;
        const baseBeats = timeSignature.numerator * (4 / timeSignature.denominator);
        const absBeatFromMeasure = (n: any): number => {
            const mi = Number(n.measureIndex ?? 0);
            const ms = starts?.[mi] ?? (mi * baseBeats);
            return ms + (Number(n.beat ?? 1) - 1);
        };

        // Gather the selected notes from BOTH the SATB staff and the ACC tracks, each with
        // its absBeat (SATB: measure+beat; ACC: startTick → quarter units).
        const sel: { note: any; absBeat: number }[] = [];
        for (const n of (latestRawNotes.current || []) as StaffNote[]) {
            if (!ids.has(n.id) || n.isRest || !Number.isFinite((n as any).midi)) continue;
            sel.push({ note: n, absBeat: absBeatFromMeasure(n) });
        }
        for (const track of (latestAccompanimentTracks.current || [])) {
            for (const n of (track.notes || []) as any[]) {
                if (!ids.has(n.id) || n.isRest || !Number.isFinite(n.midi) || !n.midi) continue;
                const st = Number(n.startTick);
                const absBeat = Number.isFinite(st) ? st / TICKS_PER_QUARTER : absBeatFromMeasure(n);
                sel.push({ note: n, absBeat });
            }
        }
        if (sel.length < 2) return;

        // Distinct onset beats spanned by the selection.
        const onsetBeats = new Set<number>();
        for (const s of sel) onsetBeats.add(qAbsForOverrides(s.absBeat));

        // Resolve the playhead's absBeat (pixel→tick inverse of getPlayheadPosForAbsBeat),
        // then anchor to the selected onset closest to it. Falls back to the earliest onset.
        let playheadAbs: number | null = null;
        const ph = playheadPositionRef.current;
        const sysParams = ld?.systemsParams;
        if (ph && Array.isArray(sysParams) && sysParams[ph.systemIndex]) {
            const sys = sysParams[ph.systemIndex];
            const startsX = (sys.startMeasuresX || []) as number[];
            const mIndices = (sys.measureIndices || []) as number[];
            let pick = 0;
            for (let i = 0; i < startsX.length; i++) if (ph.x >= startsX[i] - 1e-6) pick = i;
            const measureIndex = mIndices[pick] ?? 0;
            const bpmMeas = ld?.measureBeatsPerMeasure?.[measureIndex] ?? baseBeats;
            const ticksPerMeasure = Math.max(1, Math.round(bpmMeas * TICKS_PER_QUARTER));
            const startX = startsX[pick];
            const endX = pick < startsX.length - 1 ? startsX[pick + 1] : (sys.width - START_X);
            const contentWidth = Math.max(1, (endX - startX) - (MEASURE_PADDING_X * 2));
            const rawPxPerTick = sys.pxPerTick;
            const pxPerTick = (typeof rawPxPerTick === 'number' && isFinite(rawPxPerTick) && rawPxPerTick > 0)
                ? rawPxPerTick : (contentWidth / ticksPerMeasure);
            let localTicks = (ph.x - (startX + MEASURE_PADDING_X)) / pxPerTick;
            if (!Number.isFinite(localTicks) || localTicks < 0) localTicks = 0;
            if (localTicks > ticksPerMeasure) localTicks = ticksPerMeasure;
            const measureStartAbs = ld?.measureStartAbsBeat?.[measureIndex] ?? (measureIndex * bpmMeas);
            playheadAbs = measureStartAbs + (localTicks / TICKS_PER_QUARTER);
        }

        let anchorAbs: number;
        if (playheadAbs != null) {
            anchorAbs = [...onsetBeats].reduce((best, q) =>
                Math.abs(q - playheadAbs!) < Math.abs(best - playheadAbs!) ? q : best, [...onsetBeats][0]);
        } else {
            anchorAbs = Math.min(...sel.map(s => s.absBeat));
        }
        const anchorQ = qAbsForOverrides(anchorAbs);

        // Identify the chord from the union of the selected pitches. Neutralize voice/clef so
        // the GLOBALLY lowest selected pitch is taken as the bass (drives the inversion),
        // matching the same trick used in the ACC-reconcile path of useHarmonyLabels.
        const forAnalysis = sel.map(s => ({ ...s.note, voice: 1, clef: 'treble' }));
        const candidates = identifyChordCandidates(forAnalysis as any);
        const chordInfo = candidates && candidates.length ? candidates[0] : null;
        const tonicRoot = (currentTonic || keySignatureRoot || (keySignature as any).root || 'C') as string;
        const roman = chordInfo ? (calculateRomanFromChordInfo(chordInfo as any, tonicRoot, isMinorMode) || '') : '';
        const symbol = getChordSymbol(forAnalysis as any, keySignature, tonicRoot) || '';
        let figures: string[] = [];
        try { figures = computeFiguredBassFromNotes(forAnalysis as any, FIGURED_BASS_UI_OPTIONS).figures || []; } catch { figures = []; }

        // Nothing recognizable — leave the score untouched.
        if (!roman && !symbol && figures.length === 0) return;

        // 1) Pin the full chord label at the anchor beat.
        applyHarmonyOverride(anchorQ, roman, figures, symbol);
        // 2) Blank the other onset beats so the scattered arpeggio collapses to one label.
        for (const q of onsetBeats) {
            if (Math.abs(q - anchorQ) < 1e-6) continue;
            applyHarmonyOverride(q, '', [], '');
        }
        // 3) Mark the selected notes structural (consistent with Opt+H chord-tone marking).
        const srcById = new Map<string, any>(sel.map(s => [s.note.id, s.note]));
        setOrnamentOverrides(prev => {
            const arr = (prev || []).filter(o => !ids.has(o.noteId));
            for (const noteId of ids) {
                const src = srcById.get(noteId);
                if (!src) continue;
                arr.push({
                    noteId,
                    type: 'structural' as OrnamentType,
                    midi: src?.midi != null ? Number(src.midi) : undefined,
                    measureIndex: src?.measureIndex != null ? Number(src.measureIndex) : undefined,
                    beat: src?.beat != null ? Number(src.beat) : undefined,
                });
            }
            return arr;
        });
    }, [selectedNoteIds, timeSignature, currentTonic, keySignatureRoot, keySignature, isMinorMode, qAbsForOverrides, applyHarmonyOverride, setOrnamentOverrides]);

    const handleApplyOrnamentOverride = useCallback((type: string) => {
        if (selectedNoteIds.size === 0) return;
        setOrnamentOverrides(prev => {
            const updated = (prev || []).filter(o => !selectedNoteIds.has(o.noteId));
            for (const noteId of selectedNoteIds) {
                // Store composite key fields for cross-session matching
                const src = (notes || []).find(n => n.id === noteId) as any;
                updated.push({
                    noteId,
                    type: type as OrnamentType,
                    midi: src?.midi != null ? Number(src.midi) : undefined,
                    measureIndex: src?.measureIndex != null ? Number(src.measureIndex) : undefined,
                    beat: src?.beat != null ? Number(src.beat) : undefined,
                });
            }
            return updated;
        });
        setContextMenu(null);
    }, [selectedNoteIds, notes]);

    const handleRemoveOrnamentOverride = useCallback(() => {
        if (selectedNoteIds.size === 0) return;
        setOrnamentOverrides(prev => (prev || []).filter(o => !selectedNoteIds.has(o.noteId)));
        setContextMenu(null);
    }, [selectedNoteIds]);

    const hasExistingOrnamentOverride = useMemo(() => {
        if (selectedNoteIds.size === 0) return false;
        return ornamentOverrides.some(o => selectedNoteIds.has(o.noteId));
    }, [selectedNoteIds, ornamentOverrides]);

    const handleMoveToStaff = useCallback((targetClef: 'treble' | 'bass' | null) => {
        setRawNotes(prev => prev.map(n => {
            if (!selectedNoteIds.has(n.id)) return n;
            if (targetClef === null) {
                const { clefOverride, ...rest } = n as any;
                return rest;
            }
            return { ...n, clefOverride: targetClef };
        }));
        // Route ACC notes: change clef directly (they have no clefOverride concept)
        const accTracks = latestAccompanimentTracks.current;
        const hasAccSelected = [...selectedNoteIds].some(id => isAccompanimentNote(id, accTracks));
        if (hasAccSelected) {
            setAccompanimentTracks(prev => prev.map(track => ({
                ...track,
                notes: track.notes.map(n => {
                    if (!selectedNoteIds.has(n.id)) return n;
                    const newClef = targetClef ?? 'treble';
                    return { ...n, clef: newClef as ClefType };
                }),
            })));
        }
        setContextMenu(null);
    }, [selectedNoteIds, setAccompanimentTracks]);

    const handleBackgroundClick = useCallback((x: number, y: number, systemIndex: number, e?: MouseEvent) => {
        if (!layoutData) return;

        // Prevent the container click handler from immediately clearing selection after a staff click.
        e?.stopPropagation?.();

        // ⌘/Ctrl required to insert notes — plain clicks only deselect.
        // Exception 1: chord insert mode repositions the caret without inserting.
        // Exception 2: a plain click in the ACC area picks that track as the paste
        // destination and positions the paste caret there (no note inserted), so the
        // user can choose where to paste by clicking the staff.
        // Plain clicks (no ⌘/Ctrl) never insert a note: they position the paste caret and
        // pick the paste destination (which staff area / ACC track), then return. The
        // insertion paths below are guarded by isPlainClick. Chord-insert keeps selection.
        const isPlainClick = !(e?.metaKey || e?.ctrlKey);


        const hit = getSystemMeasureAtX(systemIndex, x);
        if (!hit) return;

        // --- SNAP 100% tick-based (no beat-float snap) ---
        const measureStarts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeats = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat?.[hit.measureIndex]
            ?? (hit.measureIndex * (timeSignature.numerator * (4 / timeSignature.denominator)));
        const beatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure?.[hit.measureIndex]
            ?? (timeSignature.numerator * (4 / timeSignature.denominator));
        const ticksPerMeasure = Math.round(beatsPerMeasure * TICKS_PER_QUARTER);

        const measureStartTick = Math.round(measureStartAbsBeat * TICKS_PER_QUARTER);
        const measureEndTick = measureStartTick + ticksPerMeasure;
        void measureEndTick; // keep for clarity/debugging (clamp is local)

        // Pixel -> ticks mapping inside the visible measure content.
        const contentWidth = Math.max(1, hit.measureWidth - (MEASURE_PADDING_X * 2));
        const relX = x - (hit.measureStartX + MEASURE_PADDING_X);
        const clampedRelX = Math.max(0, Math.min(contentWidth, relX));

        const rawPxPerTick = hit.pxPerTick;
        const pxPerTick = (typeof rawPxPerTick === 'number' && isFinite(rawPxPerTick) && rawPxPerTick > 0)
            ? rawPxPerTick
            : (contentWidth / Math.max(1, ticksPerMeasure));
        let localTicksRaw = clampedRelX / Math.max(1e-9, pxPerTick);
        if (!Number.isFinite(localTicksRaw)) localTicksRaw = 0;
        if (localTicksRaw < 0) localTicksRaw = 0;
        if (localTicksRaw > ticksPerMeasure) localTicksRaw = ticksPerMeasure;

        // Compute durationTicks coherently for the current insertion.
        let durBeatsBase = DURATION_VALUES[selectedInsertion.duration] ?? 1;
        if (selectedInsertion.isDotted) durBeatsBase *= 1.5;
        durBeatsBase *= tupletFactor;
        if (!isFinite(durBeatsBase) || durBeatsBase <= 0) durBeatsBase = 1;

        const durationTicks = Math.max(1, Math.round(durBeatsBase * TICKS_PER_QUARTER));

        // Snap grid: do NOT force the onset grid to be as coarse as the duration.
        // Example: a half note (2 beats) should be placeable on any 8th, and a quarter
        // must be placeable SUL LEVARE (off-beat 8th), not only on the beat.
        // We cap the snap grid at the 8th note so longer notes can start on any 8th
        // (beat OR off-beat). Snapping is left-biased, so centering on the beat stays
        // easy. Hold Shift to halve the grid further (16th).
        const tsAtMeasureStart = getTimeSignatureAtAbsBeat(measureStartAbsBeat);
        const snapCapTicks = Math.round(TICKS_PER_QUARTER / 2);
        // GCD ensures dotted/triplet durations (e.g. dotted-8th=720) still reach beat positions
        // that are multiples of TICKS_PER_QUARTER. Without this, floor(1920/720)*720=1440 (beat 2.5).
        const _snapGcd2 = (a: number, b: number): number => { let x = Math.abs(a); let y = Math.abs(b); while (y) { [x, y] = [y, x % y]; } return x || 1; };
        const baseSnapGridTicks = Math.max(1, _snapGcd2(Math.min(durationTicks, snapCapTicks), TICKS_PER_QUARTER));
        const snapGridTicks = (e as any)?.shiftKey
            ? Math.max(1, Math.floor(baseSnapGridTicks / 2))
            : baseSnapGridTicks;

        // Quantize strictly in ticks (left-biased to avoid occasional snap-forward jitter).
        let snappedLocalTicks = Math.floor(localTicksRaw / snapGridTicks) * snapGridTicks;

        // Clamp so onset is always within the measure and fits the duration.
        // If the raw click fell at or past the measure boundary, bail out rather
        // than silently clamping back to the last beat (which would overwrite
        // the note already sitting there).
        const maxLocalStart = Math.max(0, ticksPerMeasure - durationTicks);
        if (snappedLocalTicks < 0) snappedLocalTicks = 0;
        if (snappedLocalTicks > maxLocalStart) {
            if (localTicksRaw >= ticksPerMeasure - snapGridTicks * 0.4) return;
            snappedLocalTicks = maxLocalStart;
        }

        const startTick = measureStartTick + snappedLocalTicks;

        // Derive beat only for compatibility (do not use it for snapping).
        const beatInMeasure = (snappedLocalTicks / TICKS_PER_QUARTER) + 1;

        // Tick-space overlap helper: when inserting, replace any existing events that
        // overlap the new event's [startTick, endTick) in the same measure+voice.
        const overlapEpsilonTicks = TICKS_PER_QUARTER * 0.001;
        const insertedStartTick = startTick;
        const insertedEndTick = startTick + durationTicks;
        const getTickRangeForEvent = (n: StaffNote): { start: number; end: number } | null => {
            try {
                if ((n.measureIndex ?? -1) !== hit.measureIndex) return null;
                if ((n.voice as any) !== (selectedVoice as any)) return null;

                const start = (typeof (n as any).startTick === 'number' && isFinite((n as any).startTick))
                    ? ((n as any).startTick as number)
                    : (measureStartTick + Math.round((((n.beat ?? 1) - 1)) * TICKS_PER_QUARTER));

                let durTicks = (typeof (n as any).durationTicks === 'number' && isFinite((n as any).durationTicks) && (n as any).durationTicks > 0)
                    ? ((n as any).durationTicks as number)
                    : 0;

                // Cross-check: if the duration label gives a shorter value than stored
                // durationTicks, prefer the label (guards against stale/extended ticks).
                if (durTicks > 0 && typeof (n as any).duration === 'string') {
                    const labelBase = (DURATION_VALUES as any)[(n as any).duration] || 0;
                    if (labelBase > 0) {
                        let labelTicks = Math.round(labelBase * TICKS_PER_QUARTER);
                        if ((n as any).isDotted) labelTicks = Math.round(labelTicks * 1.5);
                        if ((n as any).isTriplet) labelTicks = Math.round(labelTicks * 2 / 3);
                        if ((n as any).isDuplet) labelTicks = Math.round(labelTicks * 3 / 2);
                        if (labelTicks > 0 && labelTicks < durTicks) durTicks = labelTicks;
                    }
                }

                if (!durTicks) {
                    const base = (DURATION_VALUES as any)[(n as any).duration || 'quarter'] || 1;
                    let durBeats = base;
                    if ((n as any).isDotted) durBeats *= 1.5;
                    if ((n as any).isTriplet) durBeats *= 2 / 3;
                    if ((n as any).isDuplet) durBeats *= 3 / 2;
                    durTicks = Math.round(durBeats * TICKS_PER_QUARTER);
                }

                durTicks = Math.max(1, Math.round(durTicks));
                return { start, end: start + durTicks };
            } catch {
                return null;
            }
        };

        // Use the snapped tick position for the playhead X so the cursor has a single, deterministic location.
        const snappedX = (hit.measureStartX + MEASURE_PADDING_X) + (snappedLocalTicks * pxPerTick);

        // Set playback cursor + visible playhead at the quantized point.
        setPlaybackCursorFromMeasureBeat(systemIndex, snappedX, hit.measureIndex, beatInMeasure);
        setPasteCaret({ x: snappedX, systemIndex, measureIndex: hit.measureIndex, beat: beatInMeasure });

        // Per compatibilità con i costruttori StaffNote che usano la shorthand "beat"
        const beat = beatInMeasure;

        // ── ACC area detection ──
        // ACC treble stave: top line Y = 310, bottom line Y = 350 (grand staff mode)
        // ACC bass stave:   top line Y = 440, bottom line Y = 480
        // Threshold conservative: clicks well below SATB bass ledger lines AND
        // close enough to ACC area to be intentional.
        const ACC_TREBLE_TOP_Y = VF_BASS_Y + 4 * VF_LINE_SPACING + 100; // 310 — first acc block's treble top
        const ACC_AREA_THRESHOLD_Y = ACC_TREBLE_TOP_Y - 30;             // 280 — allows ~3 ledger lines above ACC treble
        if (hasVisibleAccompaniment && y > ACC_AREA_THRESHOLD_Y) {
            if (e?.altKey) return;
            setActiveStaffArea('accompaniment');
            // In chord insert mode, just position the caret — don't insert a single note.
            if (chordInsertModeRef.current) return;
            // Empirical calibration: the pointer Y reported to the editor is offset
            // relative to the rendered VexFlow stave by ~40px (same as SATB treble).
            const yCal = y + VF_TREBLE_MOUSE_Y_ADJUST_PX;

            // Resolve which track block (and clef/position) the click lands on, so the
            // note is inserted into the clicked track's own staff — not always the first.
            const accTarget = resolveAccTarget(yCal, ACC_TREBLE_TOP_Y);
            if (!accTarget) return;
            // Remember the clicked track as the active ACC target (for paste/REC).
            activeAccTrackIdRef.current = accTarget.trackId;

            // Plain click: just pick this track as the paste destination. The paste
            // caret was already positioned at the clicked X by the snap block above,
            // so a following paste lands here. Do not insert a note.
            if (isPlainClick) {
                setSelectedNoteIds(new Set());
                return;
            }

            const accClef: ClefType = accTarget.clef;
            const pos = accTarget.pos;

            // Grand staff "a voci": la VOCE è quella selezionata (S/A/T/B = 1-4), esattamente
            // come nello step-input; la CHIAVE viene dal rigo cliccato (treble/bass) così
            // l'altezza segue il punto del click. Voce e chiave sono indipendenti: scegli la
            // voce dal selettore, clicchi dove vuoi piazzarla. Le altre tracce → voce 0.
            const accTrackObj = (latestAccompanimentTracks.current || []).find(t => t.id === accTarget.trackId);
            const isVoicedClick = (((accTrackObj as any)?.staffMode ?? 'grandstaff') === 'grandstaff') && !!(accTrackObj as any)?.voiced;
            const accVoiceClick = isVoicedClick ? Number(selectedVoice) : 0;

            // ── Rest insertion into the clicked ACC track (mirror of the SATB rest path) ──
            if (selectedInsertion.type === 'rest') {
                const accRest: StaffNote = {
                    id: crypto.randomUUID(),
                    pitch: 'B',
                    octave: accClef === 'bass' ? 2 : 4,
                    position: accClef === 'bass' ? 4 : 8,
                    midi: 0,
                    noteIndex: 0,
                    duration: selectedInsertion.duration,
                    isRest: true,
                    isTriplet,
                    isDuplet,
                    isDotted: selectedInsertion.isDotted ?? false,
                    measureIndex: hit.measureIndex,
                    beat,
                    startTick,
                    durationTicks,
                    clef: accClef,
                    voice: accVoiceClick as any,
                };
                const targetTrackId = accTarget.trackId;
                const endTick = startTick + durationTicks;
                setAccompanimentTracks(prev => prev.map((track) => {
                    if (track.id !== targetTrackId) return track;
                    // Overwrite events overlapping this rest's tick window. Voiced: per-VOCE
                    // (una pausa della voce 1 non tocca la 2/3/4); altrimenti per-chiave.
                    const filtered = track.notes.filter(n => {
                        if (isVoicedClick) {
                            if (Number((n as any).voice ?? 0) !== accVoiceClick) return true;
                        } else if ((n.clef ?? 'treble') !== accClef) return true;
                        const s = (n as any).startTick ?? 0;
                        const d = (n as any).durationTicks ?? 0;
                        return !(s < endTick && startTick < s + d);
                    });
                    return {
                        ...track,
                        notes: [...filtered, accRest].sort((a, b) =>
                            ((a as any).startTick ?? 0) - ((b as any).startTick ?? 0)),
                    };
                }));
                setSelectedNoteIds(new Set([accRest.id]));
                justInsertedNoteRef.current = accRest.id;
                // Advance playhead to the next slot (same as ACC note insertion).
                try {
                    const nextAbsBeat = (startTick + durationTicks) / TICKS_PER_QUARTER;
                    playbackCursorAbsBeatRef.current = nextAbsBeat;
                    const nextPos = getPlayheadPosForAbsBeat(nextAbsBeat);
                    if (nextPos) {
                        setPlayheadPosition(nextPos);
                        const beatsPerMeasureAdv = timeSignature.numerator * (4 / timeSignature.denominator);
                        const measureIndexAdv = Math.floor(nextAbsBeat / beatsPerMeasureAdv);
                        const beatAdv = Math.round(((nextAbsBeat - (measureIndexAdv * beatsPerMeasureAdv)) + 1) * 1e6) / 1e6;
                        setPasteCaret({ x: nextPos.x, systemIndex: nextPos.systemIndex, measureIndex: measureIndexAdv, beat: beatAdv });
                    }
                } catch { /* ignore */ }
                return;
            }

            let accProps = getNotePropertiesFromDiatonicPosition(pos, accClef, keySignature);
            accProps = applyAutoLeadingToneInMinor(accProps);
            accProps = applyActiveAccidental(accProps);

            const accNote: StaffNote = {
                id: crypto.randomUUID(),
                ...accProps,
                duration: selectedInsertion.duration,
                isRest: false,
                isTriplet,
                isDuplet,
                isDotted: selectedInsertion.isDotted ?? false,
                measureIndex: hit.measureIndex,
                beat,
                startTick,
                durationTicks,
                clef: accClef,
                voice: accVoiceClick as any,
            };

            {
                const targetTrackId = accTarget.trackId;
                setAccompanimentTracks(prev => prev.map((track) => {
                    if (track.id !== targetTrackId) return track;
                    // Rimuovi SOLO ciò che occupa lo STESSO attacco in modo incompatibile:
                    //  - una pausa sullo stesso attacco (la nota la sostituisce);
                    //  - un duplicato di stessa altezza (re-click → sostituisce/ridurata).
                    // Si CONSERVANO: i toni d'accordo (stesso attacco, altra altezza) e la
                    // POLIFONIA (note ad attacchi DIVERSI con durate sovrapposte — es. una
                    // nota tenuta sotto crome che si muovono).
                    // Voiced: il confronto è per VOCE (le 4 voci coesistono allo stesso
                    // attacco); a voce singola è per-chiave (una nota di violino non tocca
                    // il basso allo stesso tick).
                    const filtered = track.notes.filter(n => {
                        if (isVoicedClick) {
                            if (Number((n as any).voice ?? 0) !== accVoiceClick) return true;
                        } else if ((n.clef ?? 'treble') !== accClef) return true;
                        const s = (n as any).startTick ?? 0;
                        if (s !== startTick) return true; // attacco diverso → conserva (sequenza/polifonia)
                        if (n.isRest) return false; // pausa sull'attacco → sostituita
                        return (n as any).midi !== accNote.midi; // stessa altezza → duplicato, rimuovi; altrimenti accordo
                    });
                    return {
                        ...track,
                        notes: [...filtered, accNote].sort((a, b) =>
                            ((a as any).startTick ?? 0) - ((b as any).startTick ?? 0)),
                    };
                }));
                setSelectedNoteIds(new Set([accNote.id]));
                justInsertedNoteRef.current = accNote.id;
                // Audition the inserted ACC note
                void playNote(accNote);
                // Advance playhead to the next position (same as SATB insertion)
                try {
                    const nextAbsBeat = (startTick + durationTicks) / TICKS_PER_QUARTER;
                    playbackCursorAbsBeatRef.current = nextAbsBeat;
                    const nextPos = getPlayheadPosForAbsBeat(nextAbsBeat);
                    if (nextPos) {
                        setPlayheadPosition(nextPos);
                        const beatsPerMeasureAdv = timeSignature.numerator * (4 / timeSignature.denominator);
                        const measureIndexAdv = Math.floor(nextAbsBeat / beatsPerMeasureAdv);
                        const beatAdv = Math.round(((nextAbsBeat - (measureIndexAdv * beatsPerMeasureAdv)) + 1) * 1e6) / 1e6;
                        setPasteCaret({ x: nextPos.x, systemIndex: nextPos.systemIndex, measureIndex: measureIndexAdv, beat: beatAdv });
                    }
                } catch { /* ignore */ }
                // Auto-disarm triplet after a full group (3 notes) — same as SATB
                if (isTriplet) {
                    const next = tupletNoteCount + 1;
                    if (next >= 3) {
                        setIsTriplet(false);
                        setTupletNoteCount(0);
                        setTripletBaseDuration(null);
                    } else {
                        setTupletNoteCount(next);
                    }
                }
            }
            return;
        }

        setActiveStaffArea('satb');
        // In chord insert mode, clicking SATB only repositions the caret — no single-note insertion.
        if (chordInsertModeRef.current) return;
        // Plain click: pick SATB as the paste destination (caret already positioned by the
        // snap block above) and deselect — never insert.
        if (isPlainClick) { setSelectedNoteIds(new Set()); return; }

        const targetClef: ClefType = clefForVoice(selectedVoice);

        if (staffSystemMode === 'satb_ancient') {
            if (!isSvgYWithinClefStaff(y, targetClef)) return;
        } else {
            // IMPORTANT: apply the same treble Y calibration used for pitch mapping,
            // otherwise the treble/bass gating will cut off low notes for S/A.
            const yForArea = targetClef === 'treble' ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX) : y;
            const isBassArea = (staffSystemMode === 'treble_only')
                ? false
                : (yForArea > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2));
            if ((targetClef === 'bass' && !isBassArea) || (targetClef === 'treble' && isBassArea)) return;
        }

        // Option/Alt+Click: selection-only gesture (no insertion).
        if (e?.altKey) return;

        const appendMissingRestsForVoice = (prev: StaffNote[], voice: number, upToMeasureIndex: number): StaffNote[] => {
            const buildMeasureRestSegments = (totalBeats: number): Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> => {
                const EPS = 1e-6;
                const baseDurations: NoteDuration[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth'] as any;
                const candidates: Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> = [];
                for (const d of baseDurations) {
                    const b = (DURATION_VALUES as any)[d] as number;
                    if (!Number.isFinite(b) || b <= 0) continue;
                    candidates.push({ duration: d, isDotted: false, beats: b });
                    candidates.push({ duration: d, isDotted: true, beats: b * 1.5 });
                }
                candidates.sort((a, b) => b.beats - a.beats);

                let remaining = totalBeats;
                const out: Array<{ duration: NoteDuration; isDotted: boolean; beats: number }> = [];
                while (remaining > EPS) {
                    const pick = candidates.find(c => c.beats <= remaining + EPS);
                    if (!pick) break;
                    out.push(pick);
                    remaining -= pick.beats;
                    if (out.length > 32) break;
                }
                return out;
            };

            const hasNoteInVoiceMeasure = (measureIndex: number) =>
                prev.some(n => Number((n as any).voice ?? -1) === voice && Number(n.measureIndex ?? -1) === measureIndex);

            const missingRests: StaffNote[] = [];
            for (let m = 0; m < upToMeasureIndex; m++) {
                if (hasNoteInVoiceMeasure(m)) continue;
                const beatsLocal = (measureBeats && measureBeats[m]) ? measureBeats[m] : beatsPerMeasure;
                const startAbs = (measureStarts && measureStarts[m] != null) ? measureStarts[m] : (m * beatsLocal);
                const startTick = Math.round(startAbs * TICKS_PER_QUARTER);
                const segs = buildMeasureRestSegments(beatsLocal);
                let localTicks = 0;
                const clef = clefForVoice(voice as any);
                for (const seg of segs) {
                    const durationTicks = Math.max(1, Math.round(seg.beats * TICKS_PER_QUARTER));
                    missingRests.push({
                        id: crypto.randomUUID(),
                        pitch: 'B',
                        octave: clef === 'bass' ? 2 : 4,
                        position: clef === 'bass' ? 4 : 8,
                        midi: 0,
                        noteIndex: 0,
                        duration: seg.duration,
                        isRest: true,
                        isTriplet: false,
                        isDuplet: false,
                        isDotted: seg.isDotted,
                        measureIndex: m,
                        beat: (localTicks / TICKS_PER_QUARTER) + 1,
                        startTick: startTick + localTicks,
                        durationTicks,
                        clef,
                        voice: voice as any,
                    });
                    localTicks += durationTicks;
                }
            }
            return missingRests.length ? [...prev, ...missingRests] : prev;
        };

        if (selectedInsertion.type === 'rest') {
            // Strict manual rest insertion: use same snap/duration logic as notes, replace overlapping events, rebuild timeline for slot
            const rest: StaffNote = {
                id: crypto.randomUUID(),
                pitch: 'B',
                octave: targetClef === 'bass' ? 2 : 4,
                position: targetClef === 'bass' ? 4 : 8,
                midi: 0,
                noteIndex: 0,
                duration: selectedInsertion.duration,
                isRest: true,
                isTriplet,
                isDuplet,
                isDotted: selectedInsertion.isDotted ?? false,
                measureIndex: hit.measureIndex,
                beat,
                startTick,
                durationTicks,
                clef: targetClef,
                voice: selectedVoice,
            };
            setRawNotes(prev => {
                const withRests = appendMissingRestsForVoice(prev, Number(selectedVoice), hit.measureIndex);
                // Replace anything overlapping this rest in tick-space.
                const filtered = withRests.filter(n => {
                    if (n.measureIndex !== rest.measureIndex) return true;
                    if ((n.voice as any) !== (rest.voice as any)) return true;
                    const r = getTickRangeForEvent(n);
                    if (!r) return true;
                    const overlaps = r.start < (insertedEndTick - overlapEpsilonTicks) && insertedStartTick < (r.end - overlapEpsilonTicks);
                    return !overlaps;
                });
                // Insert the new rest and sort
                const next = [...filtered, rest].sort((a, b) => {
                    if (a.measureIndex !== b.measureIndex) return a.measureIndex - b.measureIndex;
                    if ((a.beat ?? 1) !== (b.beat ?? 1)) return (a.beat ?? 1) - (b.beat ?? 1);
                    return (a.voice ?? 1) - (b.voice ?? 1);
                });
                try {
                    const collectSnapshot = (minMeasure: number, maxMeasure: number) => {
                        const notes = (layoutDataRef.current?.positionedNotes ?? [])
                            .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= minMeasure && n.measureIndex <= maxMeasure);
                        return notes.map(n => {
                            let measureStartX = undefined as number | undefined;
                            let measureWidth = undefined as number | undefined;
                            if (layoutDataRef.current?.systemsParams) {
                                for (const sys of layoutDataRef.current.systemsParams) {
                                    const idx = sys.measureIndices.indexOf(n.measureIndex);
                                    if (idx !== -1) {
                                        measureStartX = sys.startMeasuresX[idx];
                                        const nextX = idx < sys.startMeasuresX.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                                        measureWidth = Math.max(0, nextX - measureStartX);
                                        break;
                                    }
                                }
                            }
                            const pxPerQuarter = measureWidth ? (measureWidth / (timeSignature.numerator * (4 / timeSignature.denominator))) : null;
                            let fallbackX = undefined;
                            if (typeof n.beat === 'number' && typeof measureStartX === 'number' && typeof pxPerQuarter === 'number') {
                                fallbackX = measureStartX + ((n.beat - 1) * pxPerQuarter);
                            }
                            return {
                                id: n.id,
                                measureIndex: n.measureIndex,
                                beat: n.beat,
                                startTick: (n as any).startTick,
                                durationTicks: (n as any).durationTicks,
                                xPosition: n.xPosition,
                                fallbackX,
                                measureStartX,
                                measureWidth,
                                pxPerQuarter,
                            };
                        });
                    };
                    const afterSnap = collectSnapshot(Math.max(0, rest.measureIndex - 1), rest.measureIndex + 1);
                    const deltas = {} as Record<string, { before?: any; after?: any; dx?: number }>;
                    const before = (layoutDataRef.current?.positionedNotes ?? [])
                        .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= Math.max(0, rest.measureIndex - 1) && n.measureIndex <= rest.measureIndex + 1)
                        .map(n => ({ id: n.id, x: n.xPosition }));
                    before.forEach(b => { deltas[b.id] = { before: b }; });
                    afterSnap.forEach(a => {
                        if (!deltas[a.id]) deltas[a.id] = {} as any;
                        deltas[a.id].after = { id: a.id, x: a.xPosition, fallbackX: a.fallbackX };
                        const bx = deltas[a.id].before?.x ?? deltas[a.id].before?.x;
                        const ax = a.xPosition ?? a.fallbackX;
                        if (typeof bx === 'number' && typeof ax === 'number') deltas[a.id].dx = ax - bx;
                    });
                    const deltasList = Object.entries(deltas).map(([id, v]) => ({ id, dx: v.dx ?? 0, before: v.before, after: v.after }));
                    const maxAbsDx = deltasList.reduce((acc, v) => Math.max(acc, Math.abs(v.dx ?? 0)), 0);
                    const nonZero = deltasList.filter(d => Math.abs(d.dx ?? 0) > 1e-9).length;
                    // Removed debug log
                } catch (e) { /* ignore */ }
                return next;
            });
            setSelectedNoteIds(new Set([rest.id]));
            justInsertedNoteRef.current = rest.id;
            // Auto-disarm dotted only when armed via hotkey.
            try {
                if (selectedInsertion.isDotted && dottedOneShotRef.current) {
                    dottedOneShotRef.current = false;
                    setSelectedInsertion(prev => ({ ...prev, isDotted: false }));
                }
            } catch { /* ignore */ }
            return;
        }

        let pos = 0;
        if (staffSystemMode === 'satb_ancient') {
            const computed = diatonicPositionFromSvgY(y, targetClef);
            if (computed == null) return;
            pos = computed;
        } else {
            const relativeY = targetClef === 'treble'
                ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX)
                : (y - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT);

            if (targetClef === 'treble') {
                const staffTop = VF_TREBLE_Y;
                pos = ((staffTop + 5 * VF_LINE_SPACING) - relativeY) / (VF_LINE_SPACING / 2);
            } else {
                const staffTop = BOTTOM_STAFF_TOP;
                pos = ((staffTop + 2 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2);
            }

            // keep your existing empirical bass alignment
            if (targetClef === 'bass' && (selectedVoice === 3 || selectedVoice === 4)) pos -= 4;

            pos = Math.round(pos);
        }

        let props = getNotePropertiesFromDiatonicPosition(pos, targetClef, keySignature);
        props = applyAutoLeadingToneInMinor(props);
        props = applyActiveAccidental(props);

        // Measure accidental carry (standard engraving rule):
        // if an accidental was used earlier in the same measure for the same pitch (letter+octave)
        // on the same staff/clef, subsequent notes inherit that pitch even if the glyph is omitted.
        // This only applies when the user is NOT explicitly arming an accidental.
        if (!activeAccidental) {
            try {
                const DIATONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                const normalizeAcc = (a: any): AccidentalType | null => {
                    if (!a) return null;
                    if (a === 'sharp' || a === '#' || a === '♯') return 'sharp';
                    if (a === 'flat' || a === 'b' || a === '♭') return 'flat';
                    if (a === 'natural' || a === 'n' || a === '♮') return 'natural';
                    if (a === 'double-sharp' || a === '##' || a === '𝄪') return 'double-sharp';
                    if (a === 'double-flat' || a === 'bb' || a === '𝄫') return 'double-flat';
                    return null;
                };
                const pitchLetterOf = (pitch: any): string => {
                    try {
                        const s = String(pitch || '').trim();
                        const m = /[A-Ga-g]/.exec(s);
                        return (m ? m[0] : 'C').toUpperCase();
                    } catch {
                        return 'C';
                    }
                };
                const keySigDefaultAccForLetter = (letter: string): AccidentalType => {
                    const l = String(letter || '').toUpperCase();
                    if (!l) return 'natural';
                    if (keySignature.type === 'sharp' && keySignature.count > 0) {
                        const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
                        return sharpOrder.slice(0, keySignature.count).includes(l) ? 'sharp' : 'natural';
                    }
                    if (keySignature.type === 'flat' && keySignature.count > 0) {
                        const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
                        return flatOrder.slice(0, keySignature.count).includes(l) ? 'flat' : 'natural';
                    }
                    return 'natural';
                };
                const accidentalFromPcForLetter = (pc: number, letter: string): AccidentalType => {
                    const l = String(letter || '').toUpperCase();
                    const base = DIATONIC_PC[l];
                    if (base == null) return 'natural';
                    const raw = (((Number(pc) % 12) + 12) % 12);
                    const d = ((raw - base + 18) % 12) - 6;
                    if (d === 1) return 'sharp';
                    if (d === -1) return 'flat';
                    if (d === 2) return 'double-sharp';
                    if (d === -2) return 'double-flat';
                    return 'natural';
                };
                const accOffset = (acc: AccidentalType): number => {
                    switch (acc) {
                        case 'sharp': return 1;
                        case 'flat': return -1;
                        case 'double-sharp': return 2;
                        case 'double-flat': return -2;
                        default: return 0;
                    }
                };
                const startTickOf = (n: any): number => {
                    const st = Number(n?.startTick);
                    if (Number.isFinite(st)) return st;
                    const m = Number(n?.measureIndex);
                    const b = Number(n?.beat);
                    const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                    if (Number.isFinite(m) && Number.isFinite(b)) {
                        const absBeat = (m * beatsPerMeasureLocal) + (b - 1);
                        return Math.round(absBeat * TICKS_PER_QUARTER);
                    }
                    return 0;
                };

                const letter = pitchLetterOf((props as any)?.pitch);
                const octave = Number((props as any)?.octave);
                const basePc = DIATONIC_PC[letter];
                // Skip measure accidental carry when applyAutoLeadingToneInMinor
                // (or applyActiveAccidental) already set an explicit accidental —
                // the carry logic would blindly overwrite the midi/noteIndex back
                // to the key-signature default.
                if (letter && Number.isFinite(octave) && basePc != null && !(props as any).explicitAccidental) {
                    const measureIndex = Number(hit.measureIndex);
                    const beforeTick = Number(insertedStartTick);
                    const relevant = (rawNotes || [])
                        .filter((n: any) => n && !n.isRest)
                        .filter((n: any) => Number(n.measureIndex) === measureIndex)
                        .filter((n: any) => {
                            const c = ((n as any).clefOverride || n.clef || clefForVoice(n.voice)) as ClefType;
                            return c === targetClef;
                        })
                        .filter((n: any) => startTickOf(n) < beforeTick - 1e-6)
                        .slice()
                        .sort((a: any, b: any) => startTickOf(a) - startTickOf(b) || Number(a.voice ?? 1) - Number(b.voice ?? 1));

                    let stateAcc: AccidentalType = keySigDefaultAccForLetter(letter);
                    for (const n of relevant) {
                        const l2 = pitchLetterOf(n.pitch);
                        const o2 = Number(n.octave);
                        if (l2 !== letter || o2 !== octave) continue;
                        const userAcc = normalizeAcc((n as any).userAccidental);
                        const explicitAcc = normalizeAcc((n as any).explicitAccidental);
                        const autoAcc = normalizeAcc((n as any).accidental);
                        const derived = Number.isFinite(Number(n.noteIndex))
                            ? accidentalFromPcForLetter(Number(n.noteIndex), l2)
                            : 'natural';
                        stateAcc = userAcc ?? explicitAcc ?? autoAcc ?? derived;
                    }

                    // Apply the carried accidental to the new note's pitch (without forcing glyph rendering).
                    const desiredPcRaw = basePc + accOffset(stateAcc);
                    // Avoid rare edge-cases like B# that would wrap across octaves in this data model.
                    if (desiredPcRaw >= 0 && desiredPcRaw <= 11) {
                        const desiredPc = desiredPcRaw;
                        const desiredMidi = (octave + 1) * 12 + desiredPc;
                        (props as any).noteIndex = desiredPc;
                        (props as any).midi = desiredMidi;
                        (props as any).accidental = stateAcc;
                    }
                }
            } catch {
                // ignore
            }
        }

        // startTick is computed by the tick-based snap above.

        const newNote: StaffNote = {
                    id: crypto.randomUUID(),
                    ...props,
                    duration: selectedInsertion.duration,
                    isRest: false,
                    isTriplet,
                    isDuplet,
                    isDotted: selectedInsertion.isDotted ?? false,
                    measureIndex: hit.measureIndex,
                    beat,
                    startTick,
                    durationTicks,
                    clef: targetClef,
                    voice: selectedVoice,
                };

        // If an existing note occupies this exact pitch+tick+voice+measure AND has the
        // same accidental, select it instead of inserting.  When the user has armed
        // a different accidental (e.g. # on a ♮ note) we let the insertion proceed
        // so the note is effectively overwritten with the new accidental.
        const existingAtSamePos = rawNotes.find(n =>
            !n.isRest &&
            n.measureIndex === newNote.measureIndex &&
            (n.voice as any) === (newNote.voice as any) &&
            n.pitch === newNote.pitch &&
            n.octave === newNote.octave &&
            Math.abs(((n as any).startTick ?? 0) - (newNote as any).startTick) < 2
        );
        const sameAccidental = existingAtSamePos &&
            (existingAtSamePos.accidental ?? '') === (newNote.accidental ?? '');
        if (existingAtSamePos && sameAccidental) {
            if (e?.shiftKey) {
                // Shift+Click: toggle in/out of multi-selection
                setSelectedNoteIds(prev => {
                    const next = new Set(prev);
                    if (next.has(existingAtSamePos.id)) next.delete(existingAtSamePos.id);
                    else next.add(existingAtSamePos.id);
                    return next;
                });
            } else {
                setSelectedNoteIds(new Set([existingAtSamePos.id]));
            }
            return;
        }

        setRawNotes(prev => {
            // Replace anything overlapping this note in tick-space.
            const withRests = appendMissingRestsForVoice(prev, Number(selectedVoice), hit.measureIndex);
            const filtered = withRests.filter(n => {
                if (n.measureIndex !== newNote.measureIndex) return true;
                if ((n.voice as any) !== (newNote.voice as any)) return true;
                const r = getTickRangeForEvent(n);
                if (!r) return true;
                const overlaps = r.start < (insertedEndTick - overlapEpsilonTicks) && insertedStartTick < (r.end - overlapEpsilonTicks);
                return !overlaps;
            });

            // Inserisci la nuova nota (con startTick!) e ordina per measureIndex, beat, voice
            const next = [...filtered, newNote].sort((a, b) => {
                if (a.measureIndex !== b.measureIndex) return a.measureIndex - b.measureIndex;
                if ((a.beat ?? 1) !== (b.beat ?? 1)) return (a.beat ?? 1) - (b.beat ?? 1);
                return (a.voice ?? 1) - (b.voice ?? 1);
            });
            try {
                const collectSnapshot = (minMeasure: number, maxMeasure: number) => {
                    const notes = (layoutDataRef.current?.positionedNotes ?? [])
                        .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= minMeasure && n.measureIndex <= maxMeasure);

                    return notes.map(n => {
                        let measureStartX = undefined as number | undefined;
                        let measureWidth = undefined as number | undefined;
                        if (layoutDataRef.current?.systemsParams) {
                            for (const sys of layoutDataRef.current.systemsParams) {
                                const idx = sys.measureIndices.indexOf(n.measureIndex as number);
                                if (idx !== -1) {
                                    measureStartX = sys.startMeasuresX[idx];
                                    const nextX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                                    measureWidth = Math.max(0, (nextX - measureStartX));
                                    break;
                                }
                            }
                        }

                        const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                        const pxPerQuarter = measureWidth ? (measureWidth / beatsPerMeasureLocal) : undefined;

                        let fallbackX = undefined as number | undefined;
                        try {
                            if (typeof n.xPosition === 'number') fallbackX = n.xPosition;
                            else if (typeof n.startTick === 'number' && typeof measureStartX === 'number' && typeof measureWidth === 'number') {
                                const absBeat = (n.startTick ?? 0) / TICKS_PER_QUARTER;
                                const beatInMeasure = absBeat - Math.floor(absBeat / beatsPerMeasureLocal) * beatsPerMeasureLocal;
                                fallbackX = measureStartX + (beatInMeasure / beatsPerMeasureLocal) * measureWidth;
                            }
                        } catch (e) {
                            // ignore
                        }

                        return {
                            id: n.id,
                            measureIndex: n.measureIndex,
                            beat: n.beat,
                            startTick: (n as any).startTick,
                            durationTicks: (n as any).durationTicks,
                            xPosition: n.xPosition,
                            fallbackX,
                            measureStartX,
                            measureWidth,
                            pxPerQuarter,
                        };
                    });
                };

                const beforeSnap = collectSnapshot(Math.max(0, newNote.measureIndex - 1), newNote.measureIndex + 1);
                //
            } catch {
                // ignore
            }

            // Ricostruisci la timeline completa per la misura+voce della nuova nota
            const targetMeasure = newNote.measureIndex!;
            const targetVoice = newNote.voice!;

            const rebuilt = rebuildMeasureTimelineForVoice(
                next,
                targetMeasure,
                targetVoice,
                timeSignature
            );

            // Tieni tutte le altre note (altre misure o altre voci)
            const others = next.filter(
                n =>
                    n.measureIndex !== targetMeasure ||
                    n.voice !== targetVoice
            );

            // Nuovo array completo
            const combined = [...others, ...rebuilt];

            // Riordina globalmente per sicurezza
            const finalNotes = combined.sort((a, b) => {
                if ((a.measureIndex ?? 0) !== (b.measureIndex ?? 0)) {
                    return (a.measureIndex ?? 0) - (b.measureIndex ?? 0);
                }
                if ((a.beat ?? 1) !== (b.beat ?? 1)) {
                    return (a.beat ?? 1) - (b.beat ?? 1);
                }
                return (a.voice ?? 1) - (b.voice ?? 1);
            });

            return finalNotes;
        });
        setSelectedNoteIds(new Set([newNote.id]));
        justInsertedNoteRef.current = newNote.id;
        void playNote(newNote);
        // ── Advance playhead to next beat after insertion ──
        try {
            const nextAbsBeat = (startTick + durationTicks) / TICKS_PER_QUARTER;
            playbackCursorAbsBeatRef.current = nextAbsBeat;
            const nextPos = getPlayheadPosForAbsBeat(nextAbsBeat);
            if (nextPos) {
                setPlayheadPosition(nextPos);
                // Keep paste caret in sync
                const beatsPerMeasureAdv = timeSignature.numerator * (4 / timeSignature.denominator);
                const measureIndexAdv = Math.floor(nextAbsBeat / beatsPerMeasureAdv);
                const beatAdv = Math.round(((nextAbsBeat - (measureIndexAdv * beatsPerMeasureAdv)) + 1) * 1e6) / 1e6;
                setPasteCaret({ x: nextPos.x, systemIndex: nextPos.systemIndex, measureIndex: measureIndexAdv, beat: beatAdv });
            }
        } catch { /* ignore */ }
        // Auto-disarm accidental only when armed via hotkey.
        if (activeAccidental && accidentalOneShotRef.current) {
            accidentalOneShotRef.current = false;
            activeAccidentalRef.current = null;
            setActiveAccidental(null);
        }
        // Auto-disarm dotted only when armed via hotkey.
        try {
            if (selectedInsertion.isDotted && dottedOneShotRef.current) {
                dottedOneShotRef.current = false;
                setSelectedInsertion(prev => ({ ...prev, isDotted: false }));
            }
        } catch { /* ignore */ }
        // Auto-disarm triplet after a full group (3 notes).
        if (isTriplet) {
            const next = tupletNoteCount + 1;
            if (next >= 3) {
                setIsTriplet(false);
                setTupletNoteCount(0);
                setTripletBaseDuration(null);
            } else {
                setTupletNoteCount(next);
            }
        }
        // Log after a tick to capture updated positions
        setTimeout(() => {
            try {
                const collectSnapshot = (minMeasure: number, maxMeasure: number) => {
                    const notes = (layoutDataRef.current?.positionedNotes ?? [])
                        .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= minMeasure && n.measureIndex <= maxMeasure);

                    return notes.map(n => {
                        let measureStartX = undefined as number | undefined;
                        let measureWidth = undefined as number | undefined;
                        if (layoutDataRef.current?.systemsParams) {
                            for (const sys of layoutDataRef.current.systemsParams) {
                                const idx = sys.measureIndices.indexOf(n.measureIndex as number);
                                if (idx !== -1) {
                                    measureStartX = sys.startMeasuresX[idx];
                                    const nextX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                                    measureWidth = Math.max(0, (nextX - measureStartX));
                                    break;
                                }
                            }
                        }

                        const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                        const pxPerQuarter = measureWidth ? (measureWidth / beatsPerMeasureLocal) : undefined;

                        let fallbackX = undefined as number | undefined;
                        try {
                            if (typeof n.xPosition === 'number') fallbackX = n.xPosition;
                            else if (typeof n.startTick === 'number' && typeof measureStartX === 'number' && typeof measureWidth === 'number') {
                                const absBeat = (n.startTick ?? 0) / TICKS_PER_QUARTER;
                                const beatInMeasure = absBeat - Math.floor(absBeat / beatsPerMeasureLocal) * beatsPerMeasureLocal;
                                fallbackX = measureStartX + (beatInMeasure / beatsPerMeasureLocal) * measureWidth;
                            }
                        } catch (e) {
                            // ignore
                        }

                        return {
                            id: n.id,
                            measureIndex: n.measureIndex,
                            beat: n.beat,
                            startTick: (n as any).startTick,
                            durationTicks: (n as any).durationTicks,
                            xPosition: n.xPosition,
                            fallbackX,
                            measureStartX,
                            measureWidth,
                            pxPerQuarter,
                        };
                    });
                };

                const afterSnap = collectSnapshot(Math.max(0, newNote.measureIndex - 1), newNote.measureIndex + 1);
                const deltas = {} as Record<string, { before?: any; after?: any; dx?: number }>;
                const before = (layoutDataRef.current?.positionedNotes ?? [])
                    .filter(n => typeof n.measureIndex === 'number' && n.measureIndex >= Math.max(0, newNote.measureIndex - 1) && n.measureIndex <= newNote.measureIndex + 1)
                    .map(n => ({ id: n.id, x: n.xPosition }));
                before.forEach(b => { deltas[b.id] = { before: b }; });
                afterSnap.forEach(a => {
                    if (!deltas[a.id]) deltas[a.id] = {} as any;
                    deltas[a.id].after = { id: a.id, x: a.xPosition, fallbackX: a.fallbackX };
                    const bx = deltas[a.id].before?.x ?? deltas[a.id].before?.x;
                    const ax = a.xPosition ?? a.fallbackX;
                    if (typeof bx === 'number' && typeof ax === 'number') deltas[a.id].dx = ax - bx;
                });
                const deltasList = Object.entries(deltas).map(([id, v]) => ({ id, dx: v.dx ?? 0, before: v.before, after: v.after }));
                const maxAbsDx = deltasList.reduce((acc, v) => Math.max(acc, Math.abs(v.dx ?? 0)), 0);
                const nonZero = deltasList.filter(d => Math.abs(d.dx ?? 0) > 1e-9).length;
                //

                // (layout audit saving removed)
            } catch {
                // ignore
            }
        }, 60);
    }, [
        clefForVoice,
        getSystemMeasureAtX,
        isDotted,
        isDuplet,
        isTriplet,
        keySignature,
        layoutData,
        selectedInsertion,
        selectedVoice,
        setRawNotes,
        setPasteCaret,
        staffSystemMode,
        timeSignature,
        tupletFactor,
        applyAutoLeadingToneInMinor,
        applyActiveAccidental,
        playNote,
        activeAccidental,
        clipboard,
        hasVisibleAccompaniment,
        effectiveAccStaffMode,
        setAccompanimentTracks,
        setSelectedNoteIds,
        isTriplet,
        tupletNoteCount,
        setIsTriplet,
        setTupletNoteCount,
        setTripletBaseDuration,
        setPlayheadPosition,
        getPlayheadPosForAbsBeat,
    ]);

    const getPlayheadSnapGridTicks = useCallback((useFineStep: boolean): number => {
        try {
            let durBeatsBase = DURATION_VALUES[selectedInsertion.duration] ?? 1;
            if (selectedInsertion.isDotted) durBeatsBase *= 1.5;
            durBeatsBase *= tupletFactor;
            if (!isFinite(durBeatsBase) || durBeatsBase <= 0) durBeatsBase = 1;
            const durationTicks = Math.max(1, Math.round(durBeatsBase * TICKS_PER_QUARTER));
            // Cap snap at the 8th note so the playhead can land on the off-beat (levare)
            // for longer notes too; Shift uses a finer step.
            const snapCapTicks = Math.round(TICKS_PER_QUARTER / 2);
            const _snapGcd3 = (a: number, b: number): number => { let x = Math.abs(a); let y = Math.abs(b); while (y) { [x, y] = [y, x % y]; } return x || 1; };
            const baseSnapGridTicks = Math.max(1, _snapGcd3(Math.min(durationTicks, snapCapTicks), TICKS_PER_QUARTER));
            return useFineStep ? Math.max(1, Math.floor(baseSnapGridTicks / 2)) : baseSnapGridTicks;
        } catch {
            return TICKS_PER_QUARTER;
        }
    }, [selectedInsertion.duration, selectedInsertion.isDotted, timeSignature, tupletFactor]);

    const setPlayheadFromAbsBeat = useCallback((absBeat: number) => {
        try {
            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
            const safeAbs = Math.max(0, absBeat);
            playbackCursorAbsBeatRef.current = safeAbs;
            const pos = getPlayheadPosForAbsBeat(safeAbs);
            if (pos) {
                setPlayheadPosition(pos);
                const measureIndex = Math.floor(safeAbs / beatsPerMeasure);
                const beat = Math.round((((safeAbs - (measureIndex * beatsPerMeasure)) + 1)) * 1e6) / 1e6;
                setPasteCaret({ x: pos.x, systemIndex: pos.systemIndex, measureIndex, beat });
            }
        } catch {
            // ignore
        }
    }, [getPlayheadPosForAbsBeat, timeSignature]);

    // Bridge for rest-click overwrite behavior (see handleNoteClick).
    staffClickForInsertRef.current = handleBackgroundClick as any;

    // ── MIDI step-input: insert a note at the current playhead position ──
    const insertNoteFromMidi = useCallback((midiNumber: number) => {
        try {
            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
            const curAbsBeat = playbackCursorAbsBeatRef.current ?? 0;
            // Guard: if layout is not ready, skip silently.
            if (!layoutDataRef.current?.positionedNotes) return;
            const measureIndex = Math.floor(curAbsBeat / beatsPerMeasure);
            const beatInMeasure = Math.round(((curAbsBeat - measureIndex * beatsPerMeasure) + 1) * 1e6) / 1e6;
            const measureStartTick = Math.round(measureIndex * beatsPerMeasure * TICKS_PER_QUARTER);
            const startTick = Math.round(curAbsBeat * TICKS_PER_QUARTER);

            let durBeatsBase = DURATION_VALUES[selectedInsertion.duration] ?? 1;
            if (selectedInsertion.isDotted) durBeatsBase *= 1.5;
            durBeatsBase *= tupletFactor;
            const durationTicks = Math.max(1, Math.round(durBeatsBase * TICKS_PER_QUARTER));

            // ── Step-input verso la traccia ACC attiva ──
            // Se l'area attiva è "accompaniment", la nota suonata (tastiera/MIDI) entra
            // nella traccia ACC attiva invece che nel SATB. Stessa logica chord/clef-aware
            // del click manuale: gli accordi (stesso attacco) si impilano, le
            // sovrapposizioni da attacchi diversi vengono sovrascritte.
            if (activeStaffAreaRef.current === 'accompaniment') {
                const accTracks = latestAccompanimentTracks.current || [];
                const target = accTracks.find(t => t.id === activeAccTrackIdRef.current && t.visible)
                    ?? accTracks.find(t => t.visible);
                if (!target) return; // nessuna traccia ACC visibile
                const accStaffMode = (target as any).staffMode ?? 'grandstaff';
                // Grand staff "a voci": la nota entra nella VOCE selezionata (1-4) e la
                // chiave segue la voce (1-2 violino, 3-4 basso). Le altre tracce restano
                // a voce singola (voice 0) con chiave per altezza.
                const isVoicedStep = accStaffMode === 'grandstaff' && !!(target as any).voiced;
                const accVoiceStep = isVoicedStep ? Number(selectedVoice) : 0;
                const accClefStep: ClefType = isVoicedStep
                    ? ((accVoiceStep === 3 || accVoiceStep === 4) ? 'bass' : 'treble')
                    : (accStaffMode === 'grandstaff'
                        ? (midiNumber >= 60 ? 'treble' : 'bass')
                        : (((target as any).clef ?? 'treble') as ClefType));
                const accPropsStep = getNotePropertiesFromMidi(midiNumber, keySignature, accClefStep, activeAccidentalRef.current ?? null);
                if (!accPropsStep || !Number.isFinite(accPropsStep.midi)) return;
                const accNoteStep: StaffNote = {
                    id: crypto.randomUUID(),
                    ...accPropsStep,
                    duration: selectedInsertion.duration,
                    isRest: false,
                    isTriplet,
                    isDuplet,
                    isDotted: selectedInsertion.isDotted ?? false,
                    measureIndex,
                    beat: beatInMeasure,
                    startTick,
                    durationTicks,
                    clef: accClefStep,
                    voice: accVoiceStep as any,
                };
                const targetId = target.id;
                setAccompanimentTracks(prev => prev.map(track => {
                    if (track.id !== targetId) return track;
                    // Vedi note nel percorso click: rimuovi solo duplicati/pause sullo
                    // stesso attacco; conserva accordi e polifonia (attacchi diversi).
                    // Voiced: il confronto è per VOCE (così le voci coesistono); altrimenti
                    // per chiave (comportamento storico a voce singola).
                    const filtered = track.notes.filter(n => {
                        if (isVoicedStep) {
                            if (Number((n as any).voice ?? 0) !== accVoiceStep) return true;
                        } else if ((n.clef ?? 'treble') !== accClefStep) return true;
                        const s = (n as any).startTick ?? 0;
                        if (s !== startTick) return true;
                        if (n.isRest) return false;
                        return (n as any).midi !== accNoteStep.midi;
                    });
                    return { ...track, notes: [...filtered, accNoteStep].sort((a, b) => ((a as any).startTick ?? 0) - ((b as any).startTick ?? 0)) };
                }));
                setSelectedNoteIds(new Set([accNoteStep.id]));
                // Anteprima audio: la suona già il monitoraggio passthrough (con lo
                // strumento giusto della traccia). Qui suoniamo solo per inoltrare la
                // nota all'eventuale uscita MIDI esterna — altrimenti avremmo un doppio
                // attacco (passthrough soundfont + anteprima piano interno).
                if (selectedMidiOutputRef.current) void playNote(accNoteStep);
                // Avanza la playhead (come SATB)
                const nextAbsBeatAcc = accEndTickStep / TICKS_PER_QUARTER;
                playbackCursorAbsBeatRef.current = nextAbsBeatAcc;
                const nextPosAcc = getPlayheadPosForAbsBeat(nextAbsBeatAcc);
                if (nextPosAcc) {
                    setPlayheadPosition(nextPosAcc);
                    const mIdxAcc = Math.floor(nextAbsBeatAcc / beatsPerMeasure);
                    const bIdxAcc = Math.round(((nextAbsBeatAcc - mIdxAcc * beatsPerMeasure) + 1) * 1e6) / 1e6;
                    setPasteCaret({ x: nextPosAcc.x, systemIndex: nextPosAcc.systemIndex, measureIndex: mIdxAcc, beat: bIdxAcc });
                }
                // Auto-disarma accidentale one-shot e terzina (come SATB)
                if (activeAccidentalRef.current && accidentalOneShotRef.current) {
                    accidentalOneShotRef.current = false;
                    activeAccidentalRef.current = null;
                    setActiveAccidental(null);
                }
                if (isTriplet) {
                    const next = tupletNoteCount + 1;
                    if (next >= 3) { setIsTriplet(false); setTupletNoteCount(0); setTripletBaseDuration(null); }
                    else { setTupletNoteCount(next); }
                }
                return;
            }

            const targetClef = clefForVoice(selectedVoice);
            const props = getNotePropertiesFromMidi(midiNumber, keySignature, targetClef, activeAccidentalRef.current ?? null);
            if (!props || !Number.isFinite(props.midi)) return;

            const newNote: StaffNote = {
                id: crypto.randomUUID(),
                ...props,
                duration: selectedInsertion.duration,
                isRest: false,
                isTriplet,
                isDuplet,
                isDotted: selectedInsertion.isDotted ?? false,
                measureIndex,
                beat: beatInMeasure,
                startTick,
                durationTicks,
                clef: targetClef,
                voice: selectedVoice,
            };

            const overlapEps = TICKS_PER_QUARTER * 0.001;
            const endTick = startTick + durationTicks;

            setRawNotes(prev => {
                const filtered = prev.filter(n => {
                    if (n.measureIndex !== measureIndex) return true;
                    if ((n.voice as any) !== (selectedVoice as any)) return true;
                    const nStart = typeof (n as any).startTick === 'number' && isFinite((n as any).startTick)
                        ? (n as any).startTick as number
                        : (measureStartTick + Math.round(((n.beat ?? 1) - 1) * TICKS_PER_QUARTER));
                    let nDur = typeof (n as any).durationTicks === 'number' && (n as any).durationTicks > 0
                        ? (n as any).durationTicks as number
                        : Math.round((DURATION_VALUES[(n as any).duration] ?? 1) * TICKS_PER_QUARTER);
                    if (n.isDotted) nDur = Math.round(nDur * 1.5);
                    const nEnd = nStart + nDur;
                    return !(nStart < (endTick - overlapEps) && startTick < (nEnd - overlapEps));
                });
                return [...filtered, newNote].sort((a, b) => {
                    if ((a.measureIndex ?? 0) !== (b.measureIndex ?? 0)) return (a.measureIndex ?? 0) - (b.measureIndex ?? 0);
                    if ((a.beat ?? 1) !== (b.beat ?? 1)) return (a.beat ?? 1) - (b.beat ?? 1);
                    return (a.voice ?? 1) - (b.voice ?? 1);
                });
            });
            setSelectedNoteIds(new Set([newNote.id]));
            // Anteprima già fornita dal monitoraggio passthrough; qui solo per
            // l'inoltro all'uscita MIDI esterna (evita il doppio attacco).
            if (selectedMidiOutputRef.current) void playNote(newNote);

            // Advance playhead
            const nextAbsBeat = (startTick + durationTicks) / TICKS_PER_QUARTER;
            playbackCursorAbsBeatRef.current = nextAbsBeat;
            const nextPos = getPlayheadPosForAbsBeat(nextAbsBeat);
            if (nextPos) {
                setPlayheadPosition(nextPos);
                const mIdx = Math.floor(nextAbsBeat / beatsPerMeasure);
                const bIdx = Math.round(((nextAbsBeat - mIdx * beatsPerMeasure) + 1) * 1e6) / 1e6;
                setPasteCaret({ x: nextPos.x, systemIndex: nextPos.systemIndex, measureIndex: mIdx, beat: bIdx });
            }

            // Auto-disarm one-shot accidental
            if (activeAccidentalRef.current && accidentalOneShotRef.current) {
                accidentalOneShotRef.current = false;
                activeAccidentalRef.current = null;
                setActiveAccidental(null);
            }
        } catch { /* ignore */ }
    }, [
        timeSignature, selectedInsertion, selectedVoice, keySignature,
        isTriplet, isDuplet, tupletFactor, clefForVoice, playNote,
        getPlayheadPosForAbsBeat, setRawNotes, setSelectedNoteIds,
        setPlayheadPosition, setPasteCaret,
        setAccompanimentTracks, setActiveAccidental,
        tupletNoteCount, setIsTriplet, setTupletNoteCount, setTripletBaseDuration,
    ]);

    // Keep the MIDI step-input ref in sync with the latest callback.
    insertNoteFromMidiRef.current = insertNoteFromMidi;

    const handleBackgroundMouseDown = useCallback((e: MouseEvent, svg: SVGSVGElement, systemIndex: number) => {
        if (tool !== 'insert') return;

        // Robust conversion: client -> SVG coordinates.
        let x = 0;
        let y = 0;
        let clientPerSvgX = 1;
        let clientPerSvgY = 1;

        try {
            // IMPORTANT: Use the same bounding-rect based conversion used in VexflowGrandStaff.
            // getScreenCTM can yield a stable Y offset on some SVG trees.
            const rect = svg.getBoundingClientRect();
            const vb = svg.viewBox?.baseVal;
            const svgW = vb?.width && vb.width > 0 ? vb.width : rect.width;
            const svgH = vb?.height && vb.height > 0 ? vb.height : rect.height;
            const scaleX = rect.width ? (svgW / rect.width) : 1;
            const scaleY = rect.height ? (svgH / rect.height) : 1;
            x = (e.clientX - rect.left) * scaleX;
            y = (e.clientY - rect.top) * scaleY;
            clientPerSvgX = rect.width ? (rect.width / svgW) : 1;
            clientPerSvgY = rect.height ? (rect.height / svgH) : 1;
        } catch {
            const rect = svg.getBoundingClientRect();
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
            clientPerSvgX = 1;
            clientPerSvgY = 1;
        }

        dragStartPosRef.current = {
            clientX: e.clientX,
            clientY: e.clientY,
            svgStartX: x,
            svgStartY: y,
            clientPerSvgX,
            clientPerSvgY,
            systemIndex,
            isAdditive: !!(e as any).shiftKey,
            // Option/Alt+drag: select only the currently active voice.
            filterVoice: ((e as any).altKey || marqueeSelectOnlyCurrentVoice) ? selectedVoice : null,
        };
        isActuallyDraggingRef.current = false;
        justDraggedRef.current = false;

        // Don't show a rectangle until the user actually drags beyond threshold.
        setSelectionRect(prev => ({
            ...prev,
            startX: x,
            startY: y,
            endX: x,
            endY: y,
            isVisible: false,
            systemIndex,
            filterVoice: ((e as any).altKey || marqueeSelectOnlyCurrentVoice) ? selectedVoice : null,
        }));
    }, [activeTab, tool, selectedVoice, marqueeSelectOnlyCurrentVoice]);

    const handleMouseMove = useCallback((x: number, y: number, systemIndex: number, modKey: boolean) => {
        const drag = dragStartPosRef.current;
        if (drag && drag.systemIndex === systemIndex) {
            // Convert svg deltas into client pixels for thresholding.
            const dxClient = (x - drag.svgStartX) * (drag.clientPerSvgX || 1);
            const dyClient = (y - drag.svgStartY) * (drag.clientPerSvgY || 1);
            const movedClient = Math.hypot(dxClient, dyClient);
            if (movedClient >= DRAG_THRESHOLD_CLIENT_PX) {
                if (!isActuallyDraggingRef.current) {
                    isActuallyDraggingRef.current = true;
                    justDraggedRef.current = true;
                    // First time we cross threshold: show rect starting at drag origin.
                    setSelectionRect({
                        startX: drag.svgStartX,
                        startY: drag.svgStartY,
                        endX: x,
                        endY: y,
                        isVisible: true,
                        systemIndex,
                        filterVoice: drag.filterVoice,
                    });
                }
            }

            // While dragging, keep updating the rectangle end point.
            if (isActuallyDraggingRef.current) {
                setSelectionRect(prev => {
                    if (!prev.isVisible || prev.systemIndex !== systemIndex) return prev;
                    return { ...prev, endX: x, endY: y };
                });
            }
            setGhostNote(null);
            return;
        }

        // Ghost note only while the insertion modifier (Cmd/Ctrl) is held.
        if (!modKey) {
            setGhostNote(null);
            return;
        }

        if (!layoutData) return;

        // ── ACC area: show ACC ghost note (suppresses SATB ghost) ──
        const ACC_TREBLE_TOP_Y_GHOST = VF_BASS_Y + 4 * VF_LINE_SPACING + 100; // 310 — first acc block's treble top
        const ACC_AREA_THRESHOLD_Y_GHOST = ACC_TREBLE_TOP_Y_GHOST - 30;       // 280
        if (hasVisibleAccompaniment && y > ACC_AREA_THRESHOLD_Y_GHOST) {
            const hitGhost = getSystemMeasureAtX(systemIndex, x);
            if (!hitGhost) { setGhostNote(null); return; }
            const yCalGhost = y + VF_TREBLE_MOUSE_Y_ADJUST_PX;
            // Resolve the target track block so the ghost previews on the clicked staff.
            const accTargetGhost = resolveAccTarget(yCalGhost, ACC_TREBLE_TOP_Y_GHOST);
            if (!accTargetGhost) { setGhostNote(null); return; }
            const accGhostTrackIdx = accTargetGhost.visIdx;

            if (selectedInsertion.type === 'rest') {
                setGhostNote(prev => {
                    const accGhostClef: ClefType = accTargetGhost.clef;
                    const next = {
                        id: 'ghost' as const,
                        pitch: 'B',
                        octave: accGhostClef === 'bass' ? 2 : 4,
                        position: accGhostClef === 'bass' ? 4 : 8,
                        midi: 0,
                        noteIndex: 0,
                        duration: selectedInsertion.duration,
                        isRest: true as const,
                        isTriplet,
                        isDuplet,
                        isDotted,
                        xPosition: x,
                        clef: accGhostClef,
                        voice: 0 as any,
                        systemIndex,
                        _trackIdx: accGhostTrackIdx,
                    };
                    if (prev && prev.isRest && prev.xPosition === x && prev.clef === accGhostClef && prev.voice === 0 && prev.systemIndex === systemIndex && prev.duration === selectedInsertion.duration && (prev as any)._trackIdx === accGhostTrackIdx) return prev;
                    return next as any;
                });
                return;
            }

            const accGhostClef: ClefType = accTargetGhost.clef;
            const accGhostPos: number = accTargetGhost.pos;

            let accGhostProps = getNotePropertiesFromDiatonicPosition(accGhostPos, accGhostClef, keySignature);
            accGhostProps = applyAutoLeadingToneInMinor(accGhostProps);
            accGhostProps = applyActiveAccidental(accGhostProps);

            setGhostNote(prev => {
                const next = {
                    id: 'ghost' as const,
                    ...accGhostProps,
                    duration: selectedInsertion.duration,
                    isRest: false as const,
                    isTriplet,
                    isDuplet,
                    isDotted,
                    xPosition: x,
                    clef: accGhostClef,
                    voice: 0 as any,
                    systemIndex,
                    _trackIdx: accGhostTrackIdx,
                };
                if (prev && !prev.isRest && prev.xPosition === x && prev.position === next.position && prev.pitch === next.pitch && prev.octave === next.octave && prev.clef === accGhostClef && prev.voice === 0 && prev.systemIndex === systemIndex && prev.duration === selectedInsertion.duration && (prev as any)._trackIdx === accGhostTrackIdx) return prev;
                return next as any;
            });
            return;
        }

        const targetClef: ClefType = clefForVoice(selectedVoice);

        if (staffSystemMode === 'satb_ancient') {
            if (!isSvgYWithinClefStaff(y, targetClef)) {
                setGhostNote(null);
                return;
            }
        } else {
            // IMPORTANT: apply the same treble Y calibration used for pitch mapping,
            // otherwise the treble/bass gating will cut off low notes for S/A.
            const yForArea = targetClef === 'treble' ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX) : y;
            const isBassArea = (staffSystemMode === 'treble_only')
                ? false
                : (yForArea > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2));
            if ((targetClef === 'bass' && !isBassArea) || (targetClef === 'treble' && isBassArea)) {
                setGhostNote(null);
                return;
            }
        }

        const hit = getSystemMeasureAtX(systemIndex, x);
        if (!hit) { setGhostNote(null); return; }

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const contentWidth = Math.max(1, hit.measureWidth - (MEASURE_PADDING_X * 2));
        const relX = x - (hit.measureStartX + MEASURE_PADDING_X);
        const beatRaw = (Math.max(0, Math.min(1, relX / contentWidth)) * beatsPerMeasure) + 1;



        if (selectedInsertion.type === 'rest') {
            setGhostNote(prev => {
                const next = {
                    id: 'ghost' as const,
                    pitch: 'B',
                    octave: targetClef === 'bass' ? 2 : 4,
                    position: targetClef === 'bass' ? 4 : 8,
                    midi: 0,
                    noteIndex: 0,
                    duration: selectedInsertion.duration,
                    isRest: true as const,
                    isTriplet,
                    isDuplet,
                    isDotted,
                    xPosition: x,
                    clef: targetClef,
                    voice: selectedVoice,
                    systemIndex,
                };
                if (prev && prev.isRest && prev.xPosition === x && prev.clef === targetClef && prev.voice === selectedVoice && prev.systemIndex === systemIndex && prev.duration === selectedInsertion.duration) return prev;
                return next;
            });
            return;
        }

        let pos = 0;
        if (staffSystemMode === 'satb_ancient') {
            const computed = diatonicPositionFromSvgY(y, targetClef);
            if (computed == null) {
                setGhostNote(null);
                return;
            }
            pos = computed;
        } else {
            const relativeY = targetClef === 'treble'
                ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX)
                : (y - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT);

            if (targetClef === 'treble') {
                const staffTop = VF_TREBLE_Y;
                pos = ((staffTop + 5 * VF_LINE_SPACING) - relativeY) / (VF_LINE_SPACING / 2);
            } else {
                const staffTop = BOTTOM_STAFF_TOP;
                pos = ((staffTop + 2 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2);
            }

            if (targetClef === 'bass' && (selectedVoice === 3 || selectedVoice === 4)) pos -= 4;
            pos = Math.round(pos);
        }

        let props = getNotePropertiesFromDiatonicPosition(pos, targetClef, keySignature);
        props = applyAutoLeadingToneInMinor(props);
        props = applyActiveAccidental(props);

        setGhostNote(prev => {
            const next = {
                id: 'ghost' as const,
                ...props,
                duration: selectedInsertion.duration,
                isRest: false as const,
                isTriplet,
                isDuplet,
                isDotted,
                xPosition: x,
                clef: targetClef,
                voice: selectedVoice,
                systemIndex,
            };
            if (prev && !prev.isRest && prev.xPosition === x && prev.position === next.position && prev.pitch === next.pitch && prev.octave === next.octave && prev.clef === targetClef && prev.voice === selectedVoice && prev.systemIndex === systemIndex && prev.duration === selectedInsertion.duration) return prev;
            return next;
        });
    }, [applyActiveAccidental, applyAutoLeadingToneInMinor, clefForVoice, diatonicPositionFromSvgY, getNotePropertiesFromDiatonicPosition, getSystemMeasureAtX, isDotted, isDuplet, isSvgYWithinClefStaff, isTriplet, keySignature, layoutData, selectedInsertion, selectedVoice, staffSystemMode, timeSignature, tupletFactor, hasVisibleAccompaniment, effectiveAccStaffMode]);

    // Finalize marquee selection on mouse up
    useEffect(() => {
        if (!ENABLE_MARQUEE_SELECTION) return;
        if (!isActive) return;

        const onMouseUp = () => {
            const drag = dragStartPosRef.current;
            if (!drag) return;

            dragStartPosRef.current = null;

            if (!isActuallyDraggingRef.current) {
                setSelectionRect(prev => ({ ...prev, isVisible: false, systemIndex: null }));
                return;
            }

            setSelectionRect(prev => {
                if (!prev.isVisible || prev.systemIndex == null || !layoutData) {
                    return { ...prev, isVisible: false };
                }

                const sys = layoutData.systemsParams?.[prev.systemIndex];
                if (!sys) return { ...prev, isVisible: false };

                const xMin = Math.min(prev.startX, prev.endX);
                const xMax = Math.max(prev.startX, prev.endX);
                const yMin = Math.min(prev.startY, prev.endY);
                const yMax = Math.max(prev.startY, prev.endY);

                const measureSet = new Set(sys.measureIndices);
                const accNoteCandidates = latestAccompanimentTracks.current
                    .filter(t => t.visible)
                    .flatMap(t => t.notes)
                    .filter(n => typeof n.measureIndex === 'number' && measureSet.has(n.measureIndex));
                const candidatesAll = [
                    ...layoutData.positionedNotes.filter(n => measureSet.has(n.measureIndex ?? -1)),
                    ...accNoteCandidates,
                ];
                const candidates = (drag.filterVoice != null)
                    ? candidatesAll.filter(n => ((n.voice ?? 1) as Voice) === drag.filterVoice)
                    : candidatesAll;
                const idsInRect: string[] = [];
                candidates.forEach(n => {
                    // Prefer actual rendered hit points (most accurate).
                    const points = systemNoteHitPointsRef.current[prev.systemIndex] || [];
                    let px: number | null = null;
                    let py: number | null = null;
                    const hp = points.find(p => p.id === n.id);
                    if (hp && !hp.isGhost) {
                        px = hp.x;
                        py = hp.y;
                    }

                    // Fallback: approximate in VexFlow's coordinate system.
                    if (px == null || py == null) {
                        const xAbs = n.xPosition;
                        if (!Number.isFinite(xAbs as any)) return;

                        const renderClef = clefForVoice(n.voice, (n as any).clefOverride);
                        const halfStep = VF_LINE_SPACING / 2;
                        const clefTopY = renderClef === 'bass' ? VF_BASS_Y : VF_TREBLE_Y;
                        px = xAbs as number;
                        py = (clefTopY + (5 * VF_LINE_SPACING)) - (n.position * halfStep);
                    }

                    const NOTE_HALF_W = 10;
                    const NOTE_HALF_H = 10;
                    const left = (px as number) - NOTE_HALF_W;
                    const right = (px as number) + NOTE_HALF_W;
                    const top = (py as number) - NOTE_HALF_H;
                    const bottom = (py as number) + NOTE_HALF_H;

                    const intersects = !(right < xMin || left > xMax || bottom < yMin || top > yMax);
                    if (intersects) idsInRect.push(n.id);
                });

                setSelectedNoteIds(existing => {
                    if (drag.isAdditive) {
                        const next = new Set(existing);
                        idsInRect.forEach(id => next.add(id));
                        return next;
                    }
                    return new Set(idsInRect);
                });

                return { ...prev, isVisible: false };
            });
        };

        window.addEventListener('mouseup', onMouseUp, { capture: true });
        return () => window.removeEventListener('mouseup', onMouseUp, { capture: true } as any);
    }, [isActive, layoutData, clefForVoice]);

    // Safety: if mouseup is missed (e.g. release outside window), don't leave the
    // selection rectangle stuck onscreen.
    useEffect(() => {
        if (!ENABLE_MARQUEE_SELECTION) return;
        if (!isActive) return;

        const cancelIfNoButtons = (e: MouseEvent) => {
            if (!dragStartPosRef.current) return;
            if (e.buttons !== 0) return;

            dragStartPosRef.current = null;
            isActuallyDraggingRef.current = false;
            justDraggedRef.current = false;
            setSelectionRect(prev => ({ ...prev, isVisible: false, systemIndex: null }));
        };

        const cancelOnBlur = () => {
            if (!dragStartPosRef.current) return;
            dragStartPosRef.current = null;
            isActuallyDraggingRef.current = false;
            justDraggedRef.current = false;
            setSelectionRect(prev => ({ ...prev, isVisible: false, systemIndex: null }));
        };

        window.addEventListener('mousemove', cancelIfNoButtons, { capture: true });
        window.addEventListener('blur', cancelOnBlur);
        return () => {
            window.removeEventListener('mousemove', cancelIfNoButtons, { capture: true } as any);
            window.removeEventListener('blur', cancelOnBlur);
        };
    }, [isActive]);

    const rectForRender = useMemo(() => {
        if (!selectionRect?.isVisible) return null;
        return {
            x: Math.min(selectionRect.startX, selectionRect.endX),
            y: Math.min(selectionRect.startY, selectionRect.endY),
            width: Math.abs(selectionRect.startX - selectionRect.endX),
            height: Math.abs(selectionRect.startY - selectionRect.endY),
        };
    }, [selectionRect]);

    // commitBpmFromString, activateBpmEdit, handleBpmFocus/KeyDown/InputChange/InputKeyDown/Blur,
    // toggleMetronome, stopMetronomeInternal now in usePlayback

    const notePositions = useMemo(() => {
        const map = new Map<string, { x: number; y: number }>();
        if (!layoutData) return map;

        if (staffSystemMode === 'satb_ancient') {
            // SATB: use VexFlow-aligned coordinates per clef so overlays follow notes.
            const halfStep = VF_LINE_SPACING / 2;
            layoutData.positionedNotes.forEach(n => {
                const clef = (n.clef || 'soprano') as ClefType;
                const staveTopY = vfStaveTopYForClef(clef);
                const c4Y = vfC4YForClef(clef, staveTopY);
                const y = c4Y - (n.position * halfStep);
                map.set(n.id, { x: n.xPosition ?? 0, y });
            });
            return map;
        }

        // Legacy (grand staff / treble-only): keep the original approximation + empirical overlay shifts.
        layoutData.positionedNotes.forEach(n => {
            const clef = (n.clef || 'treble') as ClefType;
            const staffTop = clef === 'bass' ? BOTTOM_STAFF_TOP : TOP_STAFF_TOP;

            const yInStaff = getNoteY(n.position, staffTop, clef);
            const y = clef === 'bass' ? TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + yInStaff : yInStaff;

            map.set(n.id, { x: n.xPosition ?? 0, y });
        });

        return map;
    }, [getNoteY, layoutData, staffSystemMode, vfC4YForClef, vfStaveTopYForClef]);

    const noteClefById = useMemo(() => {
        const map = new Map<string, ClefType>();
        if (!layoutData) return map;
        layoutData.positionedNotes.forEach(n => {
            map.set(n.id, ((n.clef || 'treble') as ClefType));
        });
        return map;
    }, [layoutData]);

    // Auto-scroll during playback to keep the playhead visible.
    useEffect(() => {
        if (!isPlaying) return;
        if (!playheadPosition) return;
        const container = staffContainerRef.current;
        if (!container) return;

        const sysEl = container.querySelector(`[data-system-index="${playheadPosition.systemIndex}"]`) as HTMLElement | null;
        if (!sysEl) return;

        // Vertical: keep the current system in view.
        const contRect = container.getBoundingClientRect();
        const sysRect = sysEl.getBoundingClientRect();
        const pad = 24;

        if (sysRect.top < contRect.top + pad) {
            container.scrollTop += (sysRect.top - (contRect.top + pad));
        } else if (sysRect.bottom > contRect.bottom - pad) {
            container.scrollTop += (sysRect.bottom - (contRect.bottom - pad));
        }

        // Horizontal (linear mode): keep the x visible when container scrolls horizontally.
        const xInContainer = sysEl.offsetLeft + playheadPosition.x;
        const left = xInContainer - container.scrollLeft;
        const rightPad = 40;
        if (left < rightPad) {
            container.scrollLeft = Math.max(0, xInContainer - rightPad);
        } else if (left > container.clientWidth - rightPad) {
            container.scrollLeft = Math.max(0, xInContainer - (container.clientWidth - rightPad));
        }
    }, [isPlaying, playheadPosition]);

    const noteVoiceById = useMemo(() => {
        const map = new Map<string, Voice>();
        if (!layoutData) return map;
        layoutData.positionedNotes.forEach(n => {
            map.set(n.id, ((n.voice ?? 1) as Voice));
        });
        return map;
    }, [layoutData]);

    const noteTimeById = useMemo(() => {
        const map = new Map<string, number>();
        if (!layoutData) return map;
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        for (const n of layoutData.positionedNotes) {
            const id = n?.id;
            if (typeof id !== 'string' || !id) continue;
            const st = (n as any)?.startTick;
            if (typeof st === 'number' && Number.isFinite(st)) {
                map.set(id, st);
                continue;
            }
            const m = (n as any)?.measureIndex;
            const b = (n as any)?.beat;
            if (typeof m === 'number' && typeof b === 'number') {
                const absBeat = (m * beatsPerMeasure) + (b - 1);
                map.set(id, Math.round(absBeat * TICKS_PER_QUARTER));
            }
        }
        return map;
    }, [layoutData, timeSignature]);

    // Restore core shortcuts: deletion via Backspace/Delete.
    useEffect(() => {
        if (!isActive) return;

        const isTypingTarget = (el: EventTarget | null) => {
            const node = el as HTMLElement | null;
            if (!node) return false;
            const tag = node.tagName?.toLowerCase();
            if (!tag) return false;
            return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
        };

        const onKeyDown = (e: KeyboardEvent) => {
            // Important: this listener runs in capture phase.
            // NB: in chord-insert mode we no longer block everything here — the
            // isTypingTarget() check below already defers to the chord input while
            // it has focus, so shortcuts work again once the box is not focused
            // (the user can edit the score without leaving chord-insert mode).

            // If BPM control is focused/active, let it handle digits/arrows.
            const activeEl = document.activeElement as HTMLElement | null;
            if (
                isTypingTarget(e.target) ||
                isBpmActiveRef.current ||
                (activeEl && bpmControlRef.current && bpmControlRef.current.contains(activeEl)) ||
                (bpmControlRef.current && bpmControlRef.current.contains(e.target as any))
            ) {
                return;
            }

            const isMod = e.metaKey || e.ctrlKey;
            const key = (e.key || '').toLowerCase();

            const transposeSelectedNotesBySemitones = (delta: number) => {
                if (selectedNoteIds.size === 0) return;

                const preferFromAccidental = (n: StaffNote): AccidentalType | null => {
                    const a = (n.explicitAccidental ?? n.accidental ?? null) as AccidentalType | null;
                    if (!a) return null;
                    if (a.includes('flat')) return 'flat';
                    if (a.includes('sharp')) return 'sharp';
                    return null;
                };

                setRawNotes(prev => {
                    const updated = prev.map(n => {
                        if (!selectedNoteIds.has(n.id)) return n;
                        if (n.isRest) return n;
                        if (!Number.isFinite(n.midi)) return n;

                        const nextMidi = n.midi + delta;
                        const clef: ClefType = ((n as any).clefOverride || n.clef || clefForVoice(n.voice)) as ClefType;
                        const preferred = preferFromAccidental(n);
                        const props = getNotePropertiesFromMidi(nextMidi, keySignature, clef, preferred);

                        return {
                            ...n,
                            ...props,
                        };
                    });

                    // If a tie no longer connects equal pitches, remove the tie flag.
                    // (Rendering + playback treat ties only when the MIDI matches.)
                    const byVoice: Record<number, StaffNote[]> = {};
                    updated.forEach(n => {
                        const v = (n.voice ?? 1) as number;
                        if (!byVoice[v]) byVoice[v] = [];
                        byVoice[v].push(n);
                    });

                    const idsToUntie = new Set<string>();
                    Object.values(byVoice).forEach(list => {
                        const voiceLine = [...list].sort((a, b) => {
                            const ma = a.measureIndex ?? 0;
                            const mb = b.measureIndex ?? 0;
                            if (ma !== mb) return ma - mb;
                            return (a.beat ?? 1) - (b.beat ?? 1);
                        });
                        for (let i = 0; i < voiceLine.length - 1; i++) {
                            const from = voiceLine[i];
                            if (!(from as any).isTiedToNext) continue;
                            const to = voiceLine[i + 1];
                            if (to.isRest || from.midi !== to.midi) {
                                idsToUntie.add(from.id);
                            }
                        }
                    });

                    if (idsToUntie.size === 0) return updated;

                    return updated.map(n => {
                        if (!idsToUntie.has(n.id)) return n;
                        return { ...n, isTiedToNext: false, manualTieDirection: undefined };
                    });
                });

                // Also transpose any selected ACC notes
                const accTracks = latestAccompanimentTracks.current;
                const accIdsSelected = [...selectedNoteIds].filter(id => isAccompanimentNote(id, accTracks));
                if (accIdsSelected.length > 0) {
                    const accIdSet = new Set(accIdsSelected);
                    setAccompanimentTracks(prev => prev.map(track => ({
                        ...track,
                        notes: track.notes.map(n => {
                            if (!accIdSet.has(n.id)) return n;
                            if (n.isRest) return n;
                            if (!Number.isFinite(n.midi)) return n;
                            const nextMidi = n.midi + delta;
                            const clef: ClefType = (n.clef || 'treble') as ClefType;
                            const preferred = preferFromAccidental(n);
                            const props = getNotePropertiesFromMidi(nextMidi, keySignature, clef, preferred);
                            return { ...n, ...props };
                        }),
                    })));
                }
            };

            // ── Opt+Shift+H — collapse scattered selection into one chord at the playhead ──
            // Marks the selected notes (even across different beats, e.g. an arpeggio) as a
            // single harmony anchored under the playhead, suppressing the in-between onsets.
            if (!isMod && e.altKey && e.shiftKey && e.code === 'KeyH' && selectedNoteIds.size >= 2) {
                e.preventDefault();
                e.stopPropagation();
                markSelectionAsChordAtPlayhead();
                return;
            }

            // ── Ornament override shortcuts (⌥ + key, no Shift) ──
            // NOTE: !e.shiftKey is required so that ⌥+⇧+R (rallentando) does not
            // trigger the suspension ornament shortcut on KeyR.
            if (!isMod && e.altKey && !e.shiftKey && selectedNoteIds.size > 0) {
                const ornMap: Record<string, string> = { KeyP: 'passing', KeyA: 'appoggiatura', KeyV: 'neighbor', KeyR: 'suspension', KeyS: 'escape', KeyC: 'cambiata', KeyN: 'anticipation', KeyH: 'structural', KeyO: 'ornamental' };
                // Use e.code (physical key) as primary; fall back to e.key for macOS
                // Electron builds where ⌥ may produce a dead/composed key.
                const ornKeyCharMap: Record<string, string> = { p: 'passing', a: 'appoggiatura', v: 'neighbor', r: 'suspension', s: 'escape', c: 'cambiata', n: 'anticipation', h: 'structural', o: 'ornamental' };
                const ornType = ornMap[e.code] ?? ornKeyCharMap[(e.key || '').toLowerCase()];
                if (ornType) {
                    e.preventDefault();
                    e.stopPropagation();
                    setOrnamentOverrides(prev => {
                        const arr = prev || [];
                        // Toggle: if ALL selected notes already have this exact type, remove them
                        const allHaveType = [...selectedNoteIds].every(id => arr.some(o => o.noteId === id && o.type === ornType));
                        if (allHaveType) return arr.filter(o => !selectedNoteIds.has(o.noteId));
                        const updated = arr.filter(o => !selectedNoteIds.has(o.noteId));
                        for (const noteId of selectedNoteIds) updated.push({ noteId, type: ornType as OrnamentType });
                        return updated;
                    });
                    return;
                }
            }

            // ── Fermata (corona) shortcut: Alt+F toggles isFermata on selected notes ──
            // Playback-only effect: doubles the note's sounding duration; rendering
            // adds a fermata glyph above (voices 1/3) or below (voices 2/4).
            if (!isMod && e.altKey && e.code === 'KeyF' && selectedNoteIds.size > 0) {
                e.preventDefault();
                e.stopPropagation();
                setRawNotes(prev => {
                    const arr = prev || [];
                    // Toggle: if ALL selected notes already have isFermata, clear them
                    const allHaveFermata = arr.filter(n => selectedNoteIds.has(n.id)).every(n => !!(n as any).isFermata);
                    return arr.map(n => {
                        if (!selectedNoteIds.has(n.id)) return n;
                        if (n.isRest) return n; // pause non possono avere fermata in questa MVP
                        return { ...n, isFermata: !allHaveFermata } as StaffNote;
                    });
                });
                return;
            }

            // ── Rallentando / accelerando shortcut: Alt+Shift+R ──
            // With ≥2 notes selected: open inline modal to choose fromBpm/toBpm,
            //   then create a tempo curve from the first to the last selected note (by absBeat).
            // With exactly 1 note selected: remove any curve that includes that note.
            // With 0 notes selected: ask to clear all curves.
            // NOTE: window.prompt() is not implemented in Electron — must use a React modal.
            if (!isMod && e.altKey && e.shiftKey && e.code === 'KeyR') {
                e.preventDefault();
                e.stopPropagation();
                if (selectedNoteIds.size === 0) {
                    const count = (tempoCurves || []).length;
                    if (count === 0) return;
                    if (window.confirm(`Rimuovere tutte le curve di tempo (${count})?`)) {
                        setTempoCurves([]);
                    }
                    return;
                }
                // Cerca le note selezionate sia nel SATB sia nelle tracce ACC: la curva
                // di tempo è ancorata agli id delle note e il playback risolve le
                // posizioni da entrambi (allItems include SATB + ACC). Senza gli ACC qui,
                // una selezione su una traccia ACC darebbe arr vuoto → nessuna curva.
                const accAllForCurve = (latestAccompanimentTracks.current || []).flatMap(t => t.notes);
                const arr = [...(rawNotes || []), ...accAllForCurve].filter(n => selectedNoteIds.has(n.id) && !n.isRest);
                if (arr.length === 0) return;
                if (arr.length === 1) {
                    // Single-note: remove any tempo curve covering that note as start or end.
                    setTempoCurves(prev => (prev || []).filter(c => c.startNoteId !== arr[0].id && c.endNoteId !== arr[0].id));
                    return;
                }
                // Sort by (measureIndex, beat) to find first/last in time.
                const sorted = arr.slice().sort((a, b) => {
                    const am = (a.measureIndex ?? 0), bm = (b.measureIndex ?? 0);
                    if (am !== bm) return am - bm;
                    return (a.beat ?? 0) - (b.beat ?? 0);
                });
                const first = sorted[0];
                const last = sorted[sorted.length - 1];
                const baseBpm = bpm || 120;
                setTempoCurvePending({
                    startNoteId: first.id,
                    endNoteId: last.id,
                    defaultFromBpm: baseBpm,
                    defaultToBpm: Math.round(baseBpm / 2),
                });
                return;
            }

            // '+' : aggiunge una nuova traccia di accompagnamento (ACC) vuota, come il
            // pulsante "+ Nuova" del Mixer. Su molte tastiere '+' richiede Shift (Shift+=),
            // quindi matchiamo il CARATTERE prodotto (key === '+') senza vincolare Shift;
            // funziona anche col '+' del tastierino numerico. La guardia isTypingTarget a
            // monte impedisce che scatti mentre si digita (es. nome traccia nel Mixer).
            if (!isMod && key === '+') {
                e.preventDefault();
                e.stopPropagation();
                handleAddEmptyTrack();
                return;
            }

            // Alt/Option+L: cycle staff layout/view (view-only)
            if (!isMod && e.altKey && e.code === 'KeyL') {
                e.preventDefault();
                e.stopPropagation();

                const modes: StaffSystemMode[] = ['grandstaff', 'satb_ancient', 'treble_only'];
                const idx = Math.max(0, modes.indexOf(staffSystemMode));
                const next = modes[(idx + 1) % modes.length];
                setStaffSystemMode(next);
                return;
            }

            // Alt/Option+T: toggle toolbar visibility (stable alternative to hover-to-hide).
            if (!isMod && e.altKey && e.code === 'KeyT') {
                e.preventDefault();
                e.stopPropagation();
                setIsToolbarHidden(prev => !prev);
                return;
            }

            // Alt/Option+M: toggle parti strette/late from playhead beat onward.
            // Inserts (or removes) a layout-mode change at the current playhead position.
            if (!isMod && e.altKey && e.code === 'KeyM') {
                e.preventDefault();
                e.stopPropagation();
                // Compute absBeat from pasteCaret (beat-level) or playhead (measure-level fallback)
                const mIdx = pasteCaret?.measureIndex ?? playheadMeasureForChoral;
                const beat = pasteCaret?.beat ?? 1;
                const msa = layoutData?.measureStartAbsBeat;
                const absBeat = msa ? (msa[mIdx] ?? 0) + (beat - 1) : mIdx * 4 + (beat - 1);
                setLayoutModeChanges(prev => {
                    const existing = prev.find(c => Math.abs(c.absBeat - absBeat) < 0.01);
                    if (existing) {
                        // Remove the change at this beat (revert to previous context)
                        return prev.filter(c => Math.abs(c.absBeat - absBeat) >= 0.01);
                    }
                    // Determine the currently effective mode BEFORE this beat
                    let currentAtBeat = staffLayoutMode;
                    for (const ch of prev) {
                        if (ch.absBeat <= absBeat + 1e-6) currentAtBeat = ch.mode;
                    }
                    const toggled: StaffLayoutMode = currentAtBeat === 'parti_late' ? 'parti_strette' : 'parti_late';
                    return [...prev, { absBeat, mode: toggled }].sort((a, b) => a.absBeat - b.absBeat);
                });
                return;
            }

            // Space: avvia REC se armato, ferma REC se in corso, altrimenti toggle playback
            if (!isMod && (key === ' ' || key === 'spacebar')) {
                e.preventDefault();
                e.stopPropagation();
                if (isRecording) {
                    stopAndProcessRecording();
                } else if (isRecArmed) {
                    doStartRecording();
                } else {
                    togglePlayback();
                }
                return;
            }

            // Left/Right arrows: nudge playhead on the current snap grid.
            // - Step is derived from the currently selected duration (capped to 1 beat).
            // - Holding Shift uses a finer half-step.
            if (!isMod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                e.stopPropagation();

                const stepTicks = getPlayheadSnapGridTicks(!!e.shiftKey);
                const stepBeats = stepTicks / TICKS_PER_QUARTER;
                const curAbs = Math.max(0, getCurrentAbsBeatForPlayhead());
                const nextAbs = e.key === 'ArrowLeft'
                    ? Math.max(0, curAbs - stepBeats)
                    : (curAbs + stepBeats);

                // Quantize the result to the same grid to avoid float drift.
                const nextTicks = Math.round(nextAbs * TICKS_PER_QUARTER);
                const snappedTicks = Math.floor(nextTicks / stepTicks) * stepTicks;
                const snappedAbs = snappedTicks / TICKS_PER_QUARTER;

                setPlayheadFromAbsBeat(snappedAbs);
                return;
            }

            // Enter: jump to start without playing.
            // If currently playing, stop first.
            if (!isMod && key === 'enter') {
                e.preventDefault();
                e.stopPropagation();

                if (isPlayingRef.current) {
                    stopPlayback();
                }

                playbackCursorAbsBeatRef.current = 0;
                const pos = getPlayheadPosForAbsBeat(0);
                if (pos) setPlayheadPosition(pos);
                return;
            }

            // Cmd/Ctrl+0: reset editor zoom to 100%
            if (isMod && key === '0') {
                e.preventDefault();
                e.stopPropagation();
                resetEditorZoom();
                return;
            }

            // K: toggle metronome
            if (!isMod && key === 'k') {
                e.preventDefault();
                e.stopPropagation();
                toggleMetronome();
                return;
            }

            // Cmd/Ctrl+C: copy selected notes
            if (isMod && key === 'c') {
                if (lockHidesRef.current.export) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();

                copySelectedToClipboard();
                return;
            }

            // Cmd/Ctrl+V: arm paste mode (next click selects paste location)
            if (isMod && (key === 'v' || (e as any).code === 'KeyV')) {
                if (lockHidesRef.current.export) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                e.preventDefault();
                e.stopPropagation();

                const clip = latestClipboardRef.current || [];
                const voicesInClip = new Set(clip.map(n => (n as any).voice).filter(v => v != null));
                const isSingleVoiceClip = voicesInClip.size <= 1;
                pasteToSelectedVoiceRef.current = isSingleVoiceClip;

                // Se clipboard locale è vuota, prova a leggere dagli appunti di sistema
                if ((!clipboard || clipboard.length === 0) && navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.readText().then(text => {
                        try {
                            const parsed = JSON.parse(text);
                            if (Array.isArray(parsed) && parsed[0] && parsed[0].id) {
                                setClipboard(parsed);
                                setCopyPasteError(null);
                            } else {
                                setCopyPasteError('Nessun dato valido negli appunti.');
                            }
                        } catch {
                            setCopyPasteError('Dati negli appunti non validi.');
                        }
                    }).catch(() => setCopyPasteError('Impossibile leggere dagli appunti di sistema.'));
                    return;
                }

                // Standard UX: paste at the current paste caret.
                // Shift+Paste: force voice mapping and paste at playhead position.
                if (pasteCaret && clipboard && clipboard.length > 0) {
                    pasteClipboardAt(pasteCaret.measureIndex, pasteCaret.beat);
                }
                return;
            }
            // V: cycle voices in order 4 -> 3 -> 2 -> 1 (B, T, A, S)
            if (!isMod && key === 'v') {
                e.preventDefault();
                e.stopPropagation();
                setSelectedVoice(v => (v <= 1 ? 4 : ((v - 1) as Voice)));
                return;
            }

            // L: toggle tie (legatura) for selected notes.
            if (!isMod && key === 'l') {
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();

                // ACC routing — mirror SATB behaviour: backward-first, forward fallback.
                // For each selected ACC note, look for the previous same-clef same-pitch
                // note in the same track and toggle ITS isTiedToNext (so the tie "arrives"
                // at the just-inserted/selected note — the natural workflow).
                {
                    const accIdsForTie = [...selectedNoteIds].filter(id => isAccompanimentNote(id, latestAccompanimentTracks.current));
                    if (accIdsForTie.length > 0) {
                        const accTracksSnap = latestAccompanimentTracks.current;
                        // Per-track set of note IDs whose isTiedToNext we will toggle.
                        const toggleByTrackId = new Map<string, Set<string>>();

                        for (const accId of accIdsForTie) {
                            // Find which track contains this id
                            for (const track of accTracksSnap) {
                                const idxInTrack = track.notes.findIndex(n => n.id === accId);
                                if (idxInTrack === -1) continue;

                                const sel = track.notes[idxInTrack];
                                if (sel.isRest) break;

                                // Cerca prev/next ATTACCO DIVERSO nella stessa chiave (saltando i
                                // toni dello stesso accordo, che condividono startTick) e abbina per
                                // ALTEZZA → un intero accordo selezionato lega tono-per-tono.
                                const selStart = (sel as any).startTick ?? 0;
                                const selMidi = Number(sel.midi);
                                const sameClef = track.notes.filter(n => n.clef === sel.clef && !n.isRest);
                                const prevOnsets = sameClef.map(n => (n as any).startTick ?? 0).filter(s => s < selStart);
                                const nextOnsets = sameClef.map(n => (n as any).startTick ?? 0).filter(s => s > selStart);
                                const prevOnset = prevOnsets.length ? Math.max(...prevOnsets) : null;
                                const nextOnset = nextOnsets.length ? Math.min(...nextOnsets) : null;
                                const prevMatch = prevOnset != null
                                    ? sameClef.find(n => ((n as any).startTick ?? 0) === prevOnset && Number(n.midi) === selMidi)
                                    : undefined;
                                const nextMatch = nextOnset != null
                                    ? sameClef.find(n => ((n as any).startTick ?? 0) === nextOnset && Number(n.midi) === selMidi)
                                    : undefined;
                                // Backward-first: la legatura "arriva" alla nota selezionata.
                                if (prevMatch) {
                                    if (!toggleByTrackId.has(track.id)) toggleByTrackId.set(track.id, new Set());
                                    toggleByTrackId.get(track.id)!.add(prevMatch.id);
                                    break;
                                }
                                if (nextMatch) {
                                    if (!toggleByTrackId.has(track.id)) toggleByTrackId.set(track.id, new Set());
                                    toggleByTrackId.get(track.id)!.add(sel.id);
                                }
                                break;
                            }
                        }

                        if (toggleByTrackId.size > 0) {
                            setAccompanimentTracks(prev => prev.map(track => {
                                const toggleIds = toggleByTrackId.get(track.id);
                                if (!toggleIds || toggleIds.size === 0) return track;
                                return {
                                    ...track,
                                    notes: track.notes.map(n => {
                                        if (!toggleIds.has(n.id)) return n;
                                        if ((n as any).isTiedToNext) {
                                            const { isTiedToNext, manualTieDirection, ...rest } = n as any;
                                            return rest;
                                        }
                                        return { ...(n as any), isTiedToNext: true };
                                    }),
                                };
                            }));
                        }
                    }
                }

                try {
                    const notesWithBeats = calculateNoteBeats(rawNotes, timeSignature, timeSignatureChanges);
                    const selected = notesWithBeats.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
                    if (selected.length === 0) return;

                    // Collect IDs of notes that should get isTiedToNext toggled.
                    // Strategy: for each selected note, first try the "forward" path
                    // (selected note IS the source → tie to next same-pitch note).
                    // If that fails, try the "backward" path (selected note IS the
                    // destination → find previous same-pitch note and toggle its tie).
                    const toggleForwardIds = new Set<string>();
                    const toggleBackwardIds = new Set<string>();

                    // Spelling-aware MIDI: calculateNoteBeats can mis-derive
                    // MIDI for enharmonics (e.g. Cb5 → 83 instead of 71).
                    // Recompute from letter+accidental+octave like effectiveMidiForTie.
                    const _tieMidi = (n: any): number => {
                        try {
                            const letter = String(n.pitch || '').charAt(0).toUpperCase();
                            const bp: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                            const base = bp[letter];
                            if (base == null || !Number.isFinite(n.octave)) return Number(n.midi) || 0;
                            const acc = String(n.accidental || '');
                            const off = acc === 'flat' ? -1 : acc === 'sharp' ? 1
                                : acc === 'double-flat' ? -2 : acc === 'double-sharp' ? 2 : 0;
                            let m = (Number(n.octave) + 1) * 12 + base + off;
                            if (letter === 'C' && off < 0) m = m; // Cb5 → 71 ✓
                            if (letter === 'B' && off > 0 && base + off >= 12) m += 12;
                            return m;
                        } catch { return Number(n.midi) || 0; }
                    };

                    for (const sel of selected) {
                        const idx = notesWithBeats.findIndex(x => x.id === sel.id);
                        if (idx < 0) continue;

                        const voice = (notesWithBeats[idx] as any).voice;
                        const midi = _tieMidi(notesWithBeats[idx]);

                        // Backward first: look for previous same-voice same-pitch note.
                        // Musical convention: selecting a note and pressing L ties it
                        // to the preceding note (the tie "arrives" at the selected note).
                        let prev: StaffNote | undefined;
                        for (let i = idx - 1; i >= 0; i--) {
                            if ((notesWithBeats[i] as any).voice === voice) { prev = notesWithBeats[i]; break; }
                        }
                        if (prev && !prev.isRest && _tieMidi(prev) === midi) {
                            toggleBackwardIds.add(prev.id);
                            continue;
                        }

                        // Forward fallback: if no backward match, tie forward to next same-voice same-pitch.
                        let next: StaffNote | undefined;
                        for (let i = idx + 1; i < notesWithBeats.length; i++) {
                            if ((notesWithBeats[i] as any).voice === voice) { next = notesWithBeats[i]; break; }
                        }
                        if (next && !next.isRest && _tieMidi(next) === midi) {
                            toggleForwardIds.add(sel.id);
                        }
                    }

                    if (toggleForwardIds.size === 0 && toggleBackwardIds.size === 0) return;

                    setRawNotes(prev => prev.map(n => {
                        const id = (n as any).id;
                        if (!toggleForwardIds.has(id) && !toggleBackwardIds.has(id)) return n;

                        if ((n as any).isTiedToNext) {
                            const { isTiedToNext, manualTieDirection, ...rest } = n as any;
                            return rest;
                        }
                        return { ...(n as any), isTiedToNext: true };
                    }));
                } catch {
                    // ignore
                }
                return;
            }

            // T: open text/modulation menu at the playhead position.
            if (!isMod && key === 't') {
                e.preventDefault();
                e.stopPropagation();

                // Toggle: if the tonicization panel is already open, close it.
                if (contextMenu) {
                    setContextMenu(null);
                    return;
                }

                if (!playheadPosition) return;
                const container = staffContainerRef.current;
                if (!container) return;
                const sysEl = container.querySelector(`[data-system-index="${playheadPosition.systemIndex}"]`) as HTMLElement | null;
                if (!sysEl) return;

                const absBeat = Math.max(0, Math.round(getCurrentAbsBeatForPlayhead() * 1e6) / 1e6);
                const { measureIndex, beat } = getMeasureIndexAndBeatFromAbsBeat(absBeat);

                const sysRect = sysEl.getBoundingClientRect();
                const x = sysRect.left + playheadPosition.x;
                const y = sysRect.top + 16;

                // Calcola la tonica inferita attiva a questo beat
                // (contesti manuali + inferred dall'analisi result, ordinati per beat)
                const _ctxsSorted = [...(effectiveAnalysisContexts || [])]
                    .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
                    .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a));
                const _activeCtx = _ctxsSorted[0];
                const _activeTonic = _activeCtx ? _activeCtx.newTonic : keySignatureRoot;
                const _activeIsMinor = _activeCtx ? !!_activeCtx.newIsMinor : isMinorMode;
                const _hasInferredChange = _activeTonic !== keySignatureRoot || _activeIsMinor !== isMinorMode;

                setContextMenu({ x, y, absBeat, measureIndex, beat, inferredTonicAtBeat: _hasInferredChange ? { tonic: _activeTonic, isMinor: _activeIsMinor } : null });
                return;
            }

            // 1..7: note/rest duration shortcuts
            // 1=Semibreve, 2=Minima, 3=Semiminima, 4=Croma, 5=Semicroma, 6=Biscroma, 7=Semibiscroma
            if (!isMod && /^[1-7]$/.test(key)) {
                e.preventDefault();
                e.stopPropagation();
                const mapping: Record<string, NoteDuration> = {
                    '1': 'whole',
                    '2': 'half',
                    '3': 'quarter',
                    '4': 'eighth',
                    '5': 'sixteenth',
                    '6': 'thirty-second',
                    '7': 'sixty-fourth',
                };
                const duration = mapping[key];
                if (duration) {
                    setSelectedInsertion(prev => ({ ...prev, duration }));

                    // If the selected note was just inserted (auto-selected),
                    // don't retroactively change it — just deselect and set insertion state.
                    if (justInsertedNoteRef.current && selectedNoteIds.size === 1 && selectedNoteIds.has(justInsertedNoteRef.current)) {
                        justInsertedNoteRef.current = null;
                        setSelectedNoteIds(new Set());
                        return;
                    }

                    if (selectedNoteIds.size > 0) {
                        setRawNotes(prev => {
                            try {
                                const selected = prev.filter(n => selectedNoteIds.has(n.id));
                                if (selected.length === 0) return prev;

                                let next = prev.map(n => {
                            if (!selectedNoteIds.has(n.id)) return n;
                            let durBeats = (DURATION_VALUES as any)[duration] || 1;
                            if ((n as any).isDotted) durBeats *= 1.5;
                            if ((n as any).isTriplet) durBeats *= 2 / 3;
                            if ((n as any).isDuplet) durBeats *= 3 / 2;
                            const durationTicks = Math.max(1, Math.round(durBeats * TICKS_PER_QUARTER));
                            return { ...(n as any), duration, durationTicks } as StaffNote;
                        });

                                const affected = new Map<string, { m: number; v: Voice }>();
                                for (const n of selected) {
                                    const m = (n as any).measureIndex;
                                    const v = (n as any).voice;
                                    if (typeof m === 'number' && typeof v === 'number') affected.set(`${m}|${v}`, { m, v: v as Voice });
                                }

                                for (const { m, v } of affected.values()) {
                                    const rebuilt = rebuildMeasureTimelineForVoice(next, m, v, timeSignature);
                                    const others = next.filter(nn => nn.measureIndex !== m || nn.voice !== v);
                                    next = [...others, ...rebuilt];
                                }

                                return next.sort((a, b) => {
                                    if ((a.measureIndex ?? 0) !== (b.measureIndex ?? 0)) return (a.measureIndex ?? 0) - (b.measureIndex ?? 0);
                                    const aSt = (a as any).startTick;
                                    const bSt = (b as any).startTick;
                                    if (typeof aSt === 'number' && typeof bSt === 'number' && aSt !== bSt) return aSt - bSt;
                                    if ((a.beat ?? 1) !== (b.beat ?? 1)) return (a.beat ?? 1) - (b.beat ?? 1);
                                    return (a.voice ?? 1) - (b.voice ?? 1);
                                });
                            } catch {
                                return prev;
                            }
                        });

                        // Also update ACC notes (no timeline rebuild needed for ACC)
                        const accTracks = latestAccompanimentTracks.current;
                        const accIdsSelected = [...selectedNoteIds].filter(id => isAccompanimentNote(id, accTracks));
                        if (accIdsSelected.length > 0) {
                            const accIdSet = new Set(accIdsSelected);
                            setAccompanimentTracks(prev => prev.map(track => ({
                                ...track,
                                notes: track.notes.map(n => {
                                    if (!accIdSet.has(n.id)) return n;
                                    let durBeats = (DURATION_VALUES as any)[duration] || 1;
                                    if ((n as any).isDotted) durBeats *= 1.5;
                                    if ((n as any).isTriplet) durBeats *= 2 / 3;
                                    if ((n as any).isDuplet) durBeats *= 3 / 2;
                                    const durationTicks = Math.max(1, Math.round(durBeats * TICKS_PER_QUARTER));
                                    return { ...(n as any), duration, durationTicks } as StaffNote;
                                }),
                            })));
                        }
                    }
                }
                return;
            }

            // ⇧R: arma/disarma REC (registrazione nelle tracce ACC, se presenti)
            if (!isMod && e.shiftKey && key === 'r') {
                e.preventDefault();
                e.stopPropagation();
                if (accompanimentTracks.some(t => t.visible)) {
                    toggleRecording(); // arm / disarm / stop
                }
                return;
            }

            // R: alterna pausa/nota (coerente con SATB, anche con traccia ACC visibile)
            if (!isMod && !e.shiftKey && key === 'r') {
                e.preventDefault();
                e.stopPropagation();
                setSelectedInsertion(prev => ({ ...prev, type: prev.type === 'note' ? 'rest' : 'note' }));
                return;
            }

            // . (punto): toggle dotted rhythm
            // Some keyboard layouts may emit '>' with Shift+period; accept both.
            if (!isMod && (key === '.' || key === '>')) {
                e.preventDefault();
                e.stopPropagation();
                const next = !selectedInsertionRef.current.isDotted;
                setDottedFromSource(!!next, 'hotkey');
                return;
            }

            // Accidentals
            // b = bemolle, à/# = diesis, n = bequadro
            if (!isMod && (key === 'b' || key === 'n' || key === 'à' || key === '#')) {
                e.preventDefault();
                e.stopPropagation();

                const cur = activeAccidentalRef.current;

                if (key === 'b') {
                    const next = (cur === 'flat' ? 'double-flat' : (cur === 'double-flat' ? null : 'flat')) as AccidentalType | null;
                    setActiveAccidentalAndApplyFromSource(next, 'hotkey');
                } else if (key === 'n') {
                    const next = (cur === 'natural' ? null : 'natural') as AccidentalType | null;
                    setActiveAccidentalAndApplyFromSource(next, 'hotkey');
                } else {
                    const next = (cur === 'sharp' ? 'double-sharp' : (cur === 'double-sharp' ? null : 'sharp')) as AccidentalType | null;
                    setActiveAccidentalAndApplyFromSource(next, 'hotkey');
                }

                return;
            }

            // ⌥↑ / ⌥↓: move selected notes to treble/bass staff (clef override)
            if (!isMod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();
                handleMoveToStaff(e.key === 'ArrowUp' ? 'treble' : 'bass');
                return;
            }

            // Shift+ArrowUp / Shift+ArrowDown: transpose selected notes by octave
            if (!isMod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();
                transposeSelectedNotesBySemitones(e.key === 'ArrowUp' ? 12 : -12);
                return;
            }

            // ArrowUp / ArrowDown: transpose selected notes by semitone
            if (!isMod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();
                transposeSelectedNotesBySemitones(e.key === 'ArrowUp' ? 1 : -1);
                return;
            }

            // Cmd/Ctrl+A: select all notes (only notes/rests, not the whole page)
            if (isMod && key === 'a') {
                e.preventDefault();
                e.stopPropagation();
                const accIds = (latestAccompanimentTracks.current || [])
                    .flatMap(t => t.notes.map(n => n.id));
                setSelectedNoteIds(new Set([...rawNotes.map(n => n.id), ...accIds]));
                return;
            }

            // Cmd/Ctrl+Z: undo (Shift+Cmd/Ctrl+Z = redo)
            if (isMod && key === 'z') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    // Redo: restore the last undone action in the correct stack
                    const target = redoOrderRef.current.pop();
                    if (target === 'acc') {
                        try { redoAccompanimentTracks && redoAccompanimentTracks(); } catch { /* ignore */ }
                        undoOrderRef.current.push('acc');
                    } else {
                        // 'satb' or undefined (fallback)
                        try { redoNotes && redoNotes(); } catch { /* ignore */ }
                        undoOrderRef.current.push('satb');
                    }
                } else {
                    // Undo: step back only the stack that was last modified
                    const target = undoOrderRef.current.pop();
                    if (target === 'acc') {
                        try { undoAccompanimentTracks && undoAccompanimentTracks(); } catch { /* ignore */ }
                        redoOrderRef.current.push('acc');
                    } else {
                        // 'satb' or undefined (fallback)
                        undoNotes();
                        redoOrderRef.current.push('satb');
                    }
                    // Selection may now reference deleted notes; clear defensively.
                    setSelectedNoteIds(new Set());
                }
                return;
            }

            if (e.key === 'Backspace' || e.key === 'Delete') {
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();

                setRawNotes(prev => prev.filter(n => {
                    if (!selectedNoteIds.has(n.id)) return true;
                    // Se è una pausa, la cancello (non la tengo)
                    if (n.isRest) return false;
                    return true;
                }).map(n => {
                    // Se è selezionata ed è una nota normale, la trasformo in pausa
                    if (!selectedNoteIds.has(n.id)) return n;
                    if (n.isRest) return n;
                    return {
                        ...n,
                        isRest: true
                    };
                }));
                // Route Delete to ACC notes as well
                const accTracks = latestAccompanimentTracks.current;
                const accIdsSelected = [...selectedNoteIds].filter(id => isAccompanimentNote(id, accTracks));
                if (accIdsSelected.length > 0) {
                    const accIdSet = new Set(accIdsSelected);
                    setAccompanimentTracks(prev => prev.map(track => ({
                        ...track,
                        notes: track.notes
                            .filter(n => {
                                if (!accIdSet.has(n.id)) return true;
                                // Remove rests outright (same as SATB behaviour)
                                return !n.isRest;
                            })
                            .map(n => {
                                if (!accIdSet.has(n.id)) return n;
                                // Convert note to rest
                                return { ...n, isRest: true };
                            }),
                    })));
                }
                setSelectedNoteIds(new Set());
                return;
            }

            
        };

        const onKeyUp = (e: KeyboardEvent) => {
            // Clear ghost note when the insertion modifier is released, so the
            // preview disappears even if the mouse is idle over the staff.
            if (e.key === 'Meta' || e.key === 'Control') {
                setGhostNote(null);
            }
        };

        window.addEventListener('keydown', onKeyDown, { capture: true });
        window.addEventListener('keyup', onKeyUp, { capture: true });
        return () => {
            window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
            window.removeEventListener('keyup', onKeyUp, { capture: true } as any);
        };
    }, [
        isActive,
        activeTab,
        selectedNoteIds,
        markSelectionAsChordAtPlayhead,
        setRawNotes,
        rawNotes,
        undoNotes,
        redoNotes,
        setActiveAccidental,
        setActiveAccidentalAndApplyFromSource,
        keySignature,
        getNotePropertiesFromMidi,
        clipboard,
        pasteCaret,
        pasteClipboardAt,
        togglePlayback,
        stopPlayback,
        getPlayheadPosForAbsBeat,
        toggleMetronome,
        setSelectedInsertion,
        setDottedFromSource,
        timeSignature,
        staffSystemMode,
        setStaffSystemMode,
        contextMenu,
        tempoCurves,
        setAccompanimentTracks,
        undoAccompanimentTracks,
        redoAccompanimentTracks,
        isRecording,
        toggleRecording,
        isRecArmed,
        stopAndProcessRecording,
        doStartRecording,
    ]);

    // selectedNotesBeamState, handleToggleBeamGroup, handleToggleTie now in useNoteSelection

    const handleFlipStem = useCallback(() => {
        // If a tie pair is selected, flip ONLY the tie arc direction.
        if (selectedTiePair) {
            setRawNotes(prev => prev.map(n => {
                if (n.id !== selectedTiePair.fromNoteId) return n;

                const cur = (n as any).manualTieDirection as ('up' | 'down' | undefined);
                // Default VexFlow tie direction is opposite to stem direction.
                // If there's no manual direction yet, set it to the *stem* direction,
                // so the first click inverts the arc relative to the default.
                const stem = (n as any).manualStemDirection
                    ?? ((n.voice === 1 || n.voice === 3) ? 'up' : 'down');
                const next = cur ? (cur === 'up' ? 'down' : 'up') : stem;
                return { ...(n as any), manualTieDirection: next };
            }));
            return;
        }

        if (selectedNoteIds.size === 0) return;

        setRawNotes(prev => prev.map(n => {
            if (!selectedNoteIds.has(n.id)) return n;

            const cur = (n as any).manualStemDirection as ('up' | 'down' | undefined);
            const next = cur === undefined ? 'up' : (cur === 'up' ? 'down' : undefined);

            if (!next) {
                const { manualStemDirection, ...rest } = n as any;
                return rest;
            }
            return { ...(n as any), manualStemDirection: next };
        }));

        // ACC routing: same cycling logic
        const accTracks = latestAccompanimentTracks.current;
        const accIdsSelected = [...selectedNoteIds].filter(id => isAccompanimentNote(id, accTracks));
        if (accIdsSelected.length > 0) {
            const accIdSet = new Set(accIdsSelected);
            setAccompanimentTracks(prev => prev.map(track => ({
                ...track,
                notes: track.notes.map(n => {
                    if (!accIdSet.has(n.id)) return n;
                    const cur = (n as any).manualStemDirection as ('up' | 'down' | undefined);
                    const next = cur === undefined ? 'up' : (cur === 'up' ? 'down' : undefined);
                    if (!next) {
                        const { manualStemDirection, ...rest } = n as any;
                        return rest;
                    }
                    return { ...(n as any), manualStemDirection: next };
                }),
            })));
        }
    }, [selectedNoteIds, selectedTiePair, setRawNotes, setAccompanimentTracks]);

    // Beam state including ACC notes. The base hook only sees rawNotes, so if
    // the user selects only ACC notes, the SATB state would say 'unbeamable'.
    const beamStateWithAcc = useMemo(() => {
        if (selectedNotesBeamState !== 'unbeamable') return selectedNotesBeamState;
        const accNotes = (accompanimentTracks || []).flatMap(t => t.notes);
        const beamable = accNotes.filter(n =>
            selectedNoteIds.has(n.id) &&
            !n.isRest &&
            ((DURATION_VALUES as any)[n.duration || 'quarter'] ?? 1) <= 0.5
        );
        if (beamable.length < 2) return 'unbeamable' as const;
        const firstId = (beamable[0] as any).manualBeamGroupId;
        if (firstId && beamable.every(n => (n as any).manualBeamGroupId === firstId)) return 'beamed' as const;
        return beamable.some(n => (n as any).manualBeamGroupId) ? 'mixed' as const : 'unbeamed' as const;
    }, [selectedNotesBeamState, selectedNoteIds, accompanimentTracks]);

    // Wrapper that extends the SATB-only handleToggleBeamGroup with ACC routing.
    const handleToggleBeamGroupWithAcc = useCallback(() => {
        // Run SATB handler first
        handleToggleBeamGroup();

        const accIds = [...selectedNoteIds].filter(id => isAccompanimentNote(id, latestAccompanimentTracks.current));
        if (accIds.length === 0) return;

        const accIdSet = new Set(accIds);
        const accNotes = latestAccompanimentTracks.current.flatMap(t => t.notes);
        const isShort = (n: StaffNote) =>
            !n.isRest && ((DURATION_VALUES as any)[n.duration || 'quarter'] ?? 1) <= 0.5;
        const onsetKey = (n: StaffNote) => `${n.clef ?? 'treble'}:${(n as any).startTick ?? 0}`;

        // Espandi all'INTERO accordo: qualunque tono d'accordo selezionato include tutti
        // i toni dello stesso attacco/chiave. Così la travatura reagisce a prescindere
        // da quale nota dell'accordo è selezionata (la nota "primaria" del rendering).
        const selectedOnsets = new Set(
            accNotes.filter(n => accIdSet.has(n.id) && isShort(n)).map(onsetKey)
        );
        if (selectedOnsets.size === 0) return;
        const isBeamTarget = (n: StaffNote) => isShort(n) && selectedOnsets.has(onsetKey(n));
        const targets = accNotes.filter(isBeamTarget);
        // Una travatura collega ATTACCHI diversi: servono ≥2 attacchi distinti.
        const distinctOnsets = new Set(targets.map(onsetKey));
        if (distinctOnsets.size < 2) return;

        const firstGid = (targets[0] as any).manualBeamGroupId;
        const allBeamed = firstGid && targets.every(n => (n as any).manualBeamGroupId === firstGid);

        if (allBeamed) {
            setAccompanimentTracks(prev => prev.map(track => ({
                ...track,
                notes: track.notes.map(n => {
                    if (!isBeamTarget(n)) return n;
                    const { manualBeamGroupId, ...rest } = n as any;
                    return { ...rest, manualBeamDisabled: true };
                }),
            })));
        } else {
            const gid = crypto.randomUUID();
            setAccompanimentTracks(prev => prev.map(track => ({
                ...track,
                notes: track.notes.map(n => isBeamTarget(n)
                    ? ({ ...(n as any), manualBeamGroupId: gid, manualBeamDisabled: false })
                    : n),
            })));
        }
    }, [handleToggleBeamGroup, selectedNoteIds, setAccompanimentTracks]);

    // Tie wrapper for toolbar — uses backward-first / forward-fallback for both
    // SATB and ACC, matching the keyboard 'L' workflow. Does NOT delegate to the
    // forward-only `handleToggleTie` from useNoteSelection, because that would
    // tie the SELECTED note to the next (opposite of the expected "ties arrives
    // at the just-inserted note" convention).
    const handleToggleTieWithAcc = useCallback(() => {
        if (selectedNoteIds.size === 0) return;

        // ── SATB pass ──
        try {
            const notesWithBeats = calculateNoteBeats(rawNotes, timeSignature, timeSignatureChanges);
            const satbSelected = notesWithBeats.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
            if (satbSelected.length > 0) {
                const _tieMidi = (n: any): number => {
                    try {
                        const letter = String(n.pitch || '').charAt(0).toUpperCase();
                        const bp: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                        const base = bp[letter];
                        if (base == null || !Number.isFinite(n.octave)) return Number(n.midi) || 0;
                        const acc = String(n.accidental || '');
                        const off = acc === 'flat' ? -1 : acc === 'sharp' ? 1
                            : acc === 'double-flat' ? -2 : acc === 'double-sharp' ? 2 : 0;
                        let m = (Number(n.octave) + 1) * 12 + base + off;
                        if (letter === 'B' && off > 0 && base + off >= 12) m += 12;
                        return m;
                    } catch { return Number(n.midi) || 0; }
                };
                const toggleForwardIds = new Set<string>();
                const toggleBackwardIds = new Set<string>();
                for (const sel of satbSelected) {
                    const idx = notesWithBeats.findIndex(x => x.id === sel.id);
                    if (idx < 0) continue;
                    const voice = (notesWithBeats[idx] as any).voice;
                    const midi = _tieMidi(notesWithBeats[idx]);

                    let prev: StaffNote | undefined;
                    for (let i = idx - 1; i >= 0; i--) {
                        if ((notesWithBeats[i] as any).voice === voice) { prev = notesWithBeats[i]; break; }
                    }
                    if (prev && !prev.isRest && _tieMidi(prev) === midi) {
                        toggleBackwardIds.add(prev.id);
                        continue;
                    }

                    let nextN: StaffNote | undefined;
                    for (let i = idx + 1; i < notesWithBeats.length; i++) {
                        if ((notesWithBeats[i] as any).voice === voice) { nextN = notesWithBeats[i]; break; }
                    }
                    if (nextN && !nextN.isRest && _tieMidi(nextN) === midi) {
                        toggleForwardIds.add(sel.id);
                    }
                }
                if (toggleForwardIds.size > 0 || toggleBackwardIds.size > 0) {
                    setRawNotes(prev => prev.map(n => {
                        const id = (n as any).id;
                        if (!toggleForwardIds.has(id) && !toggleBackwardIds.has(id)) return n;
                        if ((n as any).isTiedToNext) {
                            const { isTiedToNext, manualTieDirection, ...rest } = n as any;
                            return rest;
                        }
                        return { ...(n as any), isTiedToNext: true };
                    }));
                }
            }
        } catch { /* ignore */ }

        // ── ACC pass ──
        const accIdsSelected = [...selectedNoteIds].filter(id => isAccompanimentNote(id, latestAccompanimentTracks.current));
        if (accIdsSelected.length === 0) return;

        const accTracksSnap = latestAccompanimentTracks.current;
        const toggleByTrackId = new Map<string, Set<string>>();
        for (const accId of accIdsSelected) {
            for (const track of accTracksSnap) {
                const sel = track.notes.find(n => n.id === accId);
                if (!sel) continue;
                if (sel.isRest) break;

                // Cerca il prev/next ATTACCO DIVERSO nella stessa chiave (saltando i toni
                // dello stesso accordo, che condividono startTick) e abbina per ALTEZZA.
                // Così un intero accordo selezionato lega tono-per-tono all'accordo
                // adiacente (legature multiple), non solo una nota.
                const selStart = (sel as any).startTick ?? 0;
                const selMidi = Number(sel.midi);
                const sameClef = track.notes.filter(n => n.clef === sel.clef && !n.isRest);
                const prevOnsets = sameClef.map(n => (n as any).startTick ?? 0).filter(s => s < selStart);
                const nextOnsets = sameClef.map(n => (n as any).startTick ?? 0).filter(s => s > selStart);
                const prevOnset = prevOnsets.length ? Math.max(...prevOnsets) : null;
                const nextOnset = nextOnsets.length ? Math.min(...nextOnsets) : null;
                const prevMatch = prevOnset != null
                    ? sameClef.find(n => ((n as any).startTick ?? 0) === prevOnset && Number(n.midi) === selMidi)
                    : undefined;
                const nextMatch = nextOnset != null
                    ? sameClef.find(n => ((n as any).startTick ?? 0) === nextOnset && Number(n.midi) === selMidi)
                    : undefined;
                // Backward-first: se l'accordo precedente ha la stessa altezza, la legatura
                // "arriva" alla nota selezionata; altrimenti lega in avanti.
                if (prevMatch) {
                    if (!toggleByTrackId.has(track.id)) toggleByTrackId.set(track.id, new Set());
                    toggleByTrackId.get(track.id)!.add(prevMatch.id);
                    break;
                }
                if (nextMatch) {
                    if (!toggleByTrackId.has(track.id)) toggleByTrackId.set(track.id, new Set());
                    toggleByTrackId.get(track.id)!.add(sel.id);
                }
                break;
            }
        }

        if (toggleByTrackId.size > 0) {
            setAccompanimentTracks(prev => prev.map(track => {
                const toggleIds = toggleByTrackId.get(track.id);
                if (!toggleIds || toggleIds.size === 0) return track;
                return {
                    ...track,
                    notes: track.notes.map(n => {
                        if (!toggleIds.has(n.id)) return n;
                        if ((n as any).isTiedToNext) {
                            const { isTiedToNext, manualTieDirection, ...rest } = n as any;
                            return rest;
                        }
                        return { ...(n as any), isTiedToNext: true };
                    }),
                };
            }));
        }
    }, [selectedNoteIds, setAccompanimentTracks, setRawNotes, rawNotes, timeSignature, timeSignatureChanges]);

    // =========================================================
    // RENDER
    // =========================================================

    const [isToolbarHidden, setIsToolbarHidden] = useState(false);
    const forceToolbarVisible = isToolbarCustomizeOpen || isMoreMenuOpen;
    const isToolbarVisible = forceToolbarVisible || !isToolbarHidden;

    const timeSignatureControl = (
        <TimeSignatureControl
            value={timeSignature}
            onChange={setTimeSignature}
        />
    );

    return (
        <div className={`flex-grow flex flex-col ${isToolbarVisible ? 'gap-4' : 'gap-0'} min-h-0 relative`}>
            <button
                type="button"
                onClick={() => setIsAnalysisLockModalOpen(true)}
                title={
                    analysisLocked
                        ? (sessionUnlocked
                            ? 'File bloccato (sbloccato per la sessione) — clicca per gestire'
                            : 'File bloccato dal docente — clicca per sbloccare')
                        : 'Blocca analisi per studenti'
                }
                aria-label="Blocca/Sblocca analisi"
                className={`absolute right-2 top-2 z-20 w-8 h-8 flex items-center justify-center rounded-md text-base shadow-sm transition-colors ${
                    analysisLocked && !sessionUnlocked
                        ? 'bg-amber-500 hover:bg-amber-400 text-white'
                        : analysisLocked && sessionUnlocked
                            ? 'bg-amber-200 hover:bg-amber-300 text-amber-900'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
            >
                {analysisLocked && !sessionUnlocked ? '🔒' : '🔓'}
            </button>
            <button
                type="button"
                onClick={() => setShowIncompleteMeasureWarnings(v => !v)}
                title={showIncompleteMeasureWarnings ? 'Nascondi avvisi misure incomplete' : 'Mostra avvisi misure incomplete'}
                className={`absolute right-12 top-2 z-[60] flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md shadow transition-colors ${showIncompleteMeasureWarnings ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-gray-300 text-gray-600 hover:bg-gray-400'}`}
            >
                ⚠
            </button>
            <GrandStaffToolbar
                isPlaying={isPlaying}
                togglePlayback={togglePlayback}
                undoNotes={undoNotes}
                isRecording={isRecording}
                isCountingIn={isCountingIn}
                isRecArmed={isRecArmed}
                canRecord={accompanimentTracks.length > 0}
                onToggleRecording={toggleRecording}
                quantizeGrid={quantizeGrid}
                setQuantizeGrid={setQuantizeGrid}
                onQuantizeAccTrack={accompanimentTracks.some(t => t.visible) ? onQuantizeAccTrack : undefined}
                bpm={bpm}
                setBpm={setBpm}
                isBpmActive={isBpmActive}
                setIsBpmActive={setIsBpmActive}
                isBpmActiveRef={isBpmActiveRef}
                bpmInputString={bpmInputString}
                setBpmInputString={setBpmInputString}
                bpmControlRef={bpmControlRef}
                bpmInputRef={bpmInputRef}
                activateBpmEdit={activateBpmEdit}
                handleBpmFocus={handleBpmFocus}
                handleBpmBlur={handleBpmBlur}
                handleBpmKeyDown={handleBpmKeyDown}
                handleBpmInputChange={handleBpmInputChange}
                handleBpmInputKeyDown={handleBpmInputKeyDown}
                toggleMetronome={toggleMetronome}
                isMetronomeOn={isMetronomeOn}
                metronomeFlash={metronomeFlash}
                metronomeUnit={metronomeUnit}
                setMetronomeUnit={setMetronomeUnit}
                keySignatureRoot={keySignatureRoot}
                handleKeySignatureRootChange={handleKeySignatureRootChange}
                keyChangeMode={keyChangeMode}
                setTransposeKeyChangeEnabled={setTransposeKeyChangeEnabled}
                setKeyChangeMode={setKeyChangeMode}
                modalTonicOverride={modalTonicOverride}
                setModalTonicOverride={setModalTonicOverride}
                modalTonicOptions={modalTonicOptions}
                isMinorMode={isMinorMode}
                setIsMinorMode={setIsMinorMode}
                autoLeadingToneInMinor={autoLeadingToneInMinor}
                setAutoLeadingToneInMinor={setAutoLeadingToneInMinor}
                sharpKeyOptions={sharpKeyOptions}
                flatKeyOptions={flatKeyOptions}
                timeSignatureControl={timeSignatureControl}
                minMeasureCountDraft={minMeasureCountDraft}
                setMinMeasureCountDraft={setMinMeasureCountDraft}
                applyMinMeasureCountDraft={applyMinMeasureCountDraft}
                bumpMinMeasureCount={bumpMinMeasureCount}
                measuresPerLineDraft={measuresPerLineDraft}
                setMeasuresPerLineDraft={setMeasuresPerLineDraft}
                applyMeasuresPerLineDraft={applyMeasuresPerLineDraft}
                bumpMeasuresPerLine={bumpMeasuresPerLine}
                selectedVoice={selectedVoice}
                setSelectedVoice={setSelectedVoice}
                hasNoteSelection={hasReassignableSelection}
                onReassignSelectionToVoice={reassignSelectionToVoice}
                soloVoices={soloVoices}
                onToggleSolo={handleToggleVoiceSolo}
                voiceInstruments={voiceInstruments}
                onChangeVoiceInstrument={(voice: number, instrument: string) => setVoiceInstruments(prev => ({ ...prev, [voice]: instrument }))}
                isMixerOpen={isMixerOpen}
                onToggleMixer={() => setIsMixerOpen(o => !o)}
                selectedInsertion={selectedInsertion}
                setSelectedInsertion={setSelectedInsertion}
                selectedNoteIds={selectedNoteIds}
                applyEditToSelectedNotes={applyEditToSelectedNotes}
                computeDurationTicks={computeDurationTicks}
                justInsertedNoteRef={justInsertedNoteRef}
                setSelectedNoteIds={setSelectedNoteIds}
                isTriplet={isTriplet}
                setIsTriplet={setIsTriplet}
                isDuplet={isDuplet}
                setIsDuplet={setIsDuplet}
                isSwing={isSwing}
                setIsSwing={setIsSwing}
                setDottedFromSource={setDottedFromSource}
                setTupletNoteCount={setTupletNoteCount}
                setTripletBaseDuration={setTripletBaseDuration}
                canUseDuplet={canUseDuplet}
                toggleDoubleBarlineAtPlayhead={toggleDoubleBarlineAtPlayhead}
                insertMeasureAtPlayhead={insertMeasureAtPlayhead}
                playheadPosition={playheadPosition}
                activeAccidental={activeAccidental}
                activeAccidentalRef={activeAccidentalRef}
                setActiveAccidentalAndApplyFromSource={setActiveAccidentalAndApplyFromSource}
                selectedNotesBeamState={beamStateWithAcc}
                handleToggleBeamGroup={handleToggleBeamGroupWithAcc}
                handleToggleTie={handleToggleTieWithAcc}
                handleFlipStem={handleFlipStem}
                selectedTiePair={selectedTiePair}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                isAnalysisEnabled={isAnalysisEnabled}
                setIsAnalysisEnabled={setIsAnalysisEnabled}
                showRomanAnalysis={showRomanAnalysis}
                setShowRomanAnalysis={setShowRomanAnalysis}
                showSymbolAnalysis={showSymbolAnalysis}
                setShowSymbolAnalysis={setShowSymbolAnalysis}
                moreMenuRef={moreMenuRef}
                isMoreMenuOpen={isMoreMenuOpen}
                setIsMoreMenuOpen={setIsMoreMenuOpen}
                staffSystemMode={staffSystemMode}
                setStaffSystemMode={setStaffSystemMode}
                lastNonSatbModeRef={lastNonSatbModeRef}
                staffLayoutMode={staffLayoutMode}
                setStaffLayoutMode={(v) => {
                    const next = typeof v === 'function' ? v(staffLayoutMode) : v;
                    setStaffLayoutMode(next);
                    setLayoutModeChanges([]);
                }}
                canvasFormat={canvasFormat}
                setCanvasFormat={setCanvasFormat}
                isMidiMenuOpen={isMidiMenuOpen}
                setIsMidiMenuOpen={setIsMidiMenuOpen}
                selectedMidiOutput={selectedMidiOutput}
                setSelectedMidiOutput={setSelectedMidiOutput}
                midiOutputs={midiOutputs}
                handleActivateMidi={handleActivateMidi}
                midiStepInputEnabled={midiStepInput.enabled}
                midiStepInputDeviceName={midiStepInput.deviceName}
                onToggleMidiStepInput={midiStepInput.toggle}
                toolbarGroupOrder={toolbarGroupOrder}
                reorderToolbarGroups={reorderToolbarGroups}
                isToolbarCustomizeOpen={isToolbarCustomizeOpen}
                isToolbarHidden={isToolbarHidden}
                showQuickInsertBar={showQuickInsertBar}
                showHarmonyDebug={showHarmonyDebug}
                chordInsertMode={chordInsertMode}
                onToggleChordInsertMode={() => setChordInsertMode(v => !v)}
                onRevoiceChord={handleRevoice}
                revoiceDispIdx={revoiceDispIdx}
                hasSelectedNotes={selectedNoteIds.size > 0}
                selectedNotesHave7th={(() => {
                    if (selectedNoteIds.size === 0) return false;
                    const selNotes = (latestRawNotes.current as any[]).filter(n => selectedNoteIds.has(n.id));
                    return selNotes.some(n => Array.isArray(n.chordPcs) && n.chordPcs.length >= 4);
                })()}
                accPattern={accPattern}
                onSetAccPattern={setAccPattern}
                activeStaffArea={activeStaffArea}
                accLetRing={accSelectionHeld}
                onToggleAccLetRing={handleToggleAccHold}
            />

            <PreferencesModal
                isOpen={isPreferencesOpen}
                onClose={() => {
                    setIsPreferencesOpen(false);
                    // Re-read debug prefs from localStorage after modal closes
                    try { setShowHarmonyDebug(localStorage.getItem('harmony-tutor.showHarmonyDebug.v1') === '1'); } catch { /* ignore */ }
                }}
            />

            {/* Tempo curve dialog (rallentando / accelerando) */}
            {tempoCurvePending && (
                <TempoCurveDialog
                    defaultFromBpm={tempoCurvePending.defaultFromBpm}
                    defaultToBpm={tempoCurvePending.defaultToBpm}
                    onCancel={() => setTempoCurvePending(null)}
                    onConfirm={(fromBpm, toBpm) => {
                        const startId = tempoCurvePending.startNoteId;
                        const endId = tempoCurvePending.endNoteId;
                        setTempoCurves(prev => {
                            const filtered = (prev || []).filter(c => c.startNoteId !== startId);
                            const next = [...filtered, { startNoteId: startId, endNoteId: endId, fromBpm, toBpm }];
                            return next;
                        });
                        setTempoCurvePending(null);
                    }}
                />
            )}

            <AnalysisLockModal
                isOpen={isAnalysisLockModalOpen}
                onClose={() => setIsAnalysisLockModalOpen(false)}
                analysisLocked={analysisLocked}
                teacherPasswordHash={teacherPasswordHash}
                analysisLockOptions={analysisLockOptions}
                onLock={(hash, opts) => {
                    setTeacherPasswordHash(hash);
                    setAnalysisLockOptions(opts);
                    setAnalysisLocked(true);
                    setSessionUnlocked(false);
                    // trigger save so the lock is persisted immediately
                    setTimeout(() => dispatchMenuActionRef.current?.('save' as any, {}), 50);
                }}
                onUnlock={(permanent) => {
                    if (permanent) {
                        // Permanent removal: clear lock on disk and in memory.
                        setAnalysisLocked(false);
                        setTeacherPasswordHash(undefined);
                        setSessionUnlocked(false);
                        setTimeout(() => dispatchMenuActionRef.current?.('save' as any, {}), 50);
                    } else {
                        // Session-only: file stays locked on disk; just bypass UI gates.
                        setSessionUnlocked(true);
                    }
                }}
            />

            {midiImportDialogOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) resolveMidiImportChoice(null); }}
                >
                    <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4 text-sm text-gray-100">
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-bold">Importa MIDI</h2>
                            <button
                                onClick={() => resolveMidiImportChoice(null)}
                                className="text-gray-400 hover:text-gray-200 text-lg leading-none"
                                aria-label="Annulla"
                            >✕</button>
                        </div>
                        <p className="text-xs text-gray-300">Dove vuoi importare le note?</p>
                        <div className="flex gap-2 justify-end pt-2">
                            <button
                                onClick={() => resolveMidiImportChoice(null)}
                                className="px-3 py-1.5 rounded border border-gray-600 text-gray-200 hover:bg-gray-800"
                            >Annulla</button>
                            <button
                                onClick={() => resolveMidiImportChoice('accompaniment')}
                                className="px-3 py-1.5 rounded bg-gray-700 border border-gray-600 text-gray-100 hover:bg-gray-600"
                            >Accompagnamento</button>
                            <button
                                onClick={() => resolveMidiImportChoice('satb')}
                                className="px-3 py-1.5 rounded bg-cyan-600 border border-cyan-500 text-white hover:bg-cyan-500"
                                autoFocus
                            >SATB</button>
                        </div>
                    </div>
                </div>
            )}

            <RomanProgressionEditor
                isOpen={isRomanEditorOpen}
                onClose={() => setIsRomanEditorOpen(false)}
                onApplyNotes={(notes) => {
                    const minMI = notes.length > 0 ? Math.min(...notes.map(n => (n as any).measureIndex ?? 0)) : 0;
                    if (minMI > 0 && latestRawNotes.current.length > 0) {
                        // Merge: keep existing notes before insertion point
                        const existing = latestRawNotes.current.filter(n => (n.measureIndex ?? 0) < minMI);
                        setRawNotes([...existing, ...notes] as any);
                    } else {
                        if (latestRawNotes.current.length > 0) {
                            const confirmed = window.confirm('Applicare il corale generato? Le note attuali verranno sostituite.');
                            if (!confirmed) return;
                        }
                        setRawNotes(notes as any);
                        setAnalysisContexts([]);
                        setHarmonyOverrides([]);
                        setTonicizationHints([]);
                        setInferredContextSuppressions([]);
                        setOrnamentOverrides([]);
                    }
                }}
                onApplyContexts={(contexts) => {
                    if (contexts.length > 0) {
                        setAnalysisContexts(prev => {
                            // Merge: remove existing contexts at same absBeat, then add new ones
                            const newAbsBeats = new Set(contexts.map(c => c.absBeat));
                            const filtered = (prev || []).filter(c => !newAbsBeats.has((c as any).absBeat ?? -1));
                            return [...filtered, ...contexts.map(c => ({
                                absBeat: c.absBeat,
                                measureIndex: c.measureIndex,
                                newTonic: c.newTonic,
                                newIsMinor: c.newIsMinor,
                                label: c.label,
                                source: 'manual' as const,
                                markerMode: 'both' as const,
                            }))];
                        });
                    }
                }}
                keySignatureRoot={keySignatureRoot}
                isMinorMode={isMinorMode}
                timeSignature={timeSignature}
                existingNotes={rawNotes}
                playheadMeasure={playheadMeasureForChoral}
            />


            {/* Unified mixer: floating draggable window (toggled from the toolbar). */}
            {isMixerOpen && (
                <MixerPanel
                    voiceInstruments={voiceInstruments}
                    voiceVolumes={voiceVolumes}
                    mutedVoices={mutedVoices}
                    soloVoices={soloVoices}
                    onChangeVoiceInstrument={(voice, instrument) => setVoiceInstruments(prev => ({ ...prev, [voice]: instrument }))}
                    onUpdateVoice={handleUpdateVoice}
                    onToggleSolo={handleToggleVoiceSolo}
                    satbVisible={satbVisible}
                    onToggleSatbVisible={() => setSatbVisible(v => !v)}
                    satbName={satbName}
                    onRenameSatb={(name) => setSatbName(name)}
                    accompanimentTracks={accompanimentTracks}
                    onUpdateTrack={handleUpdateTrack}
                    onAddEmptyTrack={handleAddEmptyTrack}
                    onDeleteTrack={handleDeleteTrack}
                    getVoiceLevel={getVoiceLevel}
                    getTrackLevel={getTrackLevel}
                    onClose={() => setIsMixerOpen(false)}
                />
            )}

            <div className="flex flex-row gap-1 flex-grow min-h-0">
                <div
                    ref={scoreScrollRef}
                    className={`flex-grow overflow-y-auto bg-stone-100 rounded-lg shadow-inner ${(viewMode === 'linear' || Math.abs(editorZoom - 1) > 1e-3) ? 'overflow-x-auto' : 'overflow-x-hidden'}`}
                    onMouseDownCapture={handleScoreMouseDownCapture}
                    onClick={handleDeselectOnClickOutside}
                >
                    <div style={{ position: 'relative' }}>
                        {/* Spacer: defines scrollable area (scaled size) */}
                        <div
                            ref={zoomSpacerRef}
                            data-zoom-spacer="1"
                            aria-hidden="true"
                            style={{
                                width: Math.max(1, Math.ceil(zoomBaseSize.w * editorZoom)),
                                height: Math.max(1, Math.ceil(zoomBaseSize.h * editorZoom)),
                            }}
                        />

                        {/* Content: base layout, scaled via transform (does not affect layout measurements) */}
                        <div
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                transform: `scale(${editorZoom})`,
                                transformOrigin: '0 0',
                            }}
                        >
                            <div
                                ref={staffContainerRef}
                                className="p-4 ht-staff-container"
                                style={{ width: containerWidth }}
                            >
                        <div className="w-full flex justify-center mb-3">
                            <input
                                value={projectTitle}
                                onChange={(e) => setProjectTitle(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                                placeholder="Titolo"
                                className="w-full max-w-2xl bg-transparent text-center font-semibold text-slate-800 placeholder:text-slate-400 outline-none"
                                style={{ fontSize: `${titleFontSize}px`, fontFamily: titleFontFamily }}
                            />
                        </div>
                        {/* ADD guard (avoid crash on first render if layoutData is not ready) */}
                        {!layoutData ? null : layoutData.systemsParams.map((system, systemIndex) => {
                        // PERF: avoid new Set(...) inside filter per note
                        const measureSet = new Set(system.measureIndices);
                        const systemNotes = layoutData.positionedNotes.filter(note => measureSet.has(note.measureIndex ?? -1));

                        // When the key signature changes, previously-entered notes must re-evaluate which
                        // accidentals are explicitly shown (naturals to cancel key signature, etc.).
                        // We keep the stored MIDI pitch intact and only adjust rendering-related fields.
                        const systemNotesForRender = systemNotes.map((n) => {
                            // Render-only staff mapping by voice (allows toggling layouts without mutating stored notes).
                            const mappedClef: ClefType = clefForVoice(n.voice, (n as any).clefOverride, n.measureIndex, n.beat);

                            if (n.isRest) return { ...n, clef: mappedClef };

                            const tieFromPrev = tiedFromPrevNoteIds.has(n.id);

                            // If the user explicitly chose an accidental for this note, keep it.
                            if ((n as any).userAccidental) return { ...n, clef: mappedClef, isTiedFromPrev: tieFromPrev };

                            // Otherwise, recompute the accidental needed for the *existing pitch* under the
                            // current key signature, without changing the staff position/spelling.
                            try {
                                const noteName = makeNoteNameFromPitchAndMidi(n.pitch, n.midi);
                                const nextExplicit = calculateAccidental(noteName, keyAccidentals);
                                return { ...n, clef: mappedClef, explicitAccidental: nextExplicit, isTiedFromPrev: tieFromPrev };
                            } catch {
                                return { ...n, clef: mappedClef, isTiedFromPrev: tieFromPrev };
                            }
                        });

                        const actualSystemWidth = system.width;
                        const ghost = ghostNote && ghostNote.systemIndex === systemIndex ? ghostNote : null;
                        const systemBarlines = layoutData.systemsBarlines?.[systemIndex] || [];
                        const systemDuplets = dupletGroupsBySystem[systemIndex] || [];
                        const systemTriplets = tripletGroupsBySystem[systemIndex] || [];

                        const systemHarmonyLabels = (harmonyLabelsBySystemSequenced?.[systemIndex] || []);

                        const invalidMeasureRects = (() => {
                            try {
                                const durationMap: Record<string, number> = {
                                    whole: 4, half: 2, quarter: 1, eighth: 0.5,
                                    sixteenth: 0.25, 'thirty-second': 0.125, 'sixty-fourth': 0.0625,
                                };
                                // Tick-accurate duration: prefer authoritative
                                // durationTicks (already includes dot/tuplet),
                                // fall back to the figure label only if needed.
                                const ticksOfNote = (n: StaffNote): number => {
                                    const dt = Number((n as any)?.durationTicks);
                                    if (Number.isFinite(dt) && dt > 0) return Math.round(dt);
                                    let b = durationMap[String((n as any)?.duration)] ?? 1;
                                    if ((n as any).isDotted) b *= 1.5;
                                    if ((n as any).isTriplet) b *= 2 / 3;
                                    if ((n as any).isDuplet) b *= 3 / 2;
                                    return Math.round(b * TICKS_PER_QUARTER);
                                };

                                const beatsPerMeasureForIndex = (mi: number): number => {
                                    try {
                                        let n = Number(timeSignature?.numerator ?? 4);
                                        let d = Number(timeSignature?.denominator ?? 4);
                                        const changes = (timeSignatureChanges || [])
                                            .filter(c => Number.isFinite(Number(c?.measureIndex)))
                                            .map(c => ({ mi: Number(c.measureIndex), n: Number(c.numerator), d: Number(c.denominator) }))
                                            .filter(c => Number.isFinite(c.mi) && Number.isFinite(c.n) && Number.isFinite(c.d));
                                        let bestMi = -Infinity;
                                        for (const c of changes) {
                                            if (c.mi <= mi && c.mi >= bestMi) {
                                                bestMi = c.mi;
                                                n = c.n;
                                                d = c.d;
                                            }
                                        }
                                        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 4;
                                        return n * (4 / d);
                                    } catch {
                                        return 4;
                                    }
                                };

                                const measuresInSystem = system.measureIndices || [];
                                const notesByMeasure = new Map<number, StaffNote[]>();
                                (systemNotesForRender || []).forEach(n => {
                                    const mi = n.measureIndex ?? 0;
                                    if (!notesByMeasure.has(mi)) notesByMeasure.set(mi, []);
                                    notesByMeasure.get(mi)!.push(n);
                                });

                                // Use the GLOBAL last edited measure (across all
                                // systems) so the rectangle still shows up on
                                // earlier systems once the user has moved to a
                                // later system. The per-system max was hiding
                                // incomplete measures whenever the cursor moved
                                // past a system boundary.
                                const currentMeasure = (typeof globalMaxMeasureWithNotes === 'number')
                                    ? globalMaxMeasureWithNotes
                                    : null;

                                const invalidMeasures = new Set<number>();
                                const invalidVoicesByMeasure = new Map<number, Set<number>>();

                                const validateVoiceMeasure = (mi: number, line: StaffNote[]): boolean => {
                                    const expectedTicks = Math.round(beatsPerMeasureForIndex(mi) * TICKS_PER_QUARTER);
                                    if (!Number.isFinite(expectedTicks) || expectedTicks <= 0) return true;

                                    const onsetGroups = new Map<number, StaffNote[]>();
                                    let usable = 0;
                                    for (const n of (line || [])) {
                                        const b = Number((n as any)?.beat);
                                        let rel: number | null = null;
                                        if (Number.isFinite(b)) {
                                            rel = Math.round((b - 1) * TICKS_PER_QUARTER);
                                        } else {
                                            const st = Number((n as any)?.startTick);
                                            if (Number.isFinite(st) && expectedTicks > 0) {
                                                rel = ((st % expectedTicks) + expectedTicks) % expectedTicks;
                                            }
                                        }
                                        if (rel == null) continue;
                                        usable++;
                                        if (!onsetGroups.has(rel)) onsetGroups.set(rel, []);
                                        onsetGroups.get(rel)!.push(n);
                                    }
                                    // Line has notes but no usable timing: treat as invalid.
                                    if (onsetGroups.size === 0) return usable === 0;

                                    const onsets = Array.from(onsetGroups.entries())
                                        .map(([t, ns]) => ({ t, dur: Math.max(...ns.map(ticksOfNote)) }))
                                        .filter(o => Number.isFinite(o.t) && Number.isFinite(o.dur) && o.dur > 0)
                                        .sort((a, b) => a.t - b.t);

                                    if (onsets.length === 0) return false;

                                    let cur = 0;
                                    for (const o of onsets) {
                                        if (o.t !== cur) return false;
                                        cur = o.t + o.dur;
                                        if (cur > expectedTicks) return false;
                                    }
                                    return cur === expectedTicks;
                                };

                                for (const mi of measuresInSystem) {
                                    const notesInMeasure = notesByMeasure.get(mi) || [];
                                    if (!notesInMeasure.length) continue;
                                    // Skip the measure the user is currently
                                    // filling: only warn once they move past it.
                                    if (typeof currentMeasure === 'number' && mi >= currentMeasure) continue;
                                    for (const v of [1, 2, 3, 4]) {
                                        const line = notesInMeasure.filter(n => (n.voice ?? 1) === v);
                                        if (!line.length) continue;
                                        if (!validateVoiceMeasure(mi, line)) {
                                            invalidMeasures.add(mi);
                                            if (!invalidVoicesByMeasure.has(mi)) invalidVoicesByMeasure.set(mi, new Set());
                                            invalidVoicesByMeasure.get(mi)!.add(v);
                                        }
                                    }
                                }

                                if (!invalidMeasures.size) return [] as Array<{ x: number; w: number; mi: number; voices: number[] }>;

                                const barByMeasure = new Map<number, number>();
                                (systemBarlines || []).forEach(b => {
                                    try {
                                        const m = /^bar-(\d+)$/.exec(String((b as any)?.id ?? ''));
                                        if (!m) return;
                                        const mi = Number(m[1]);
                                        if (!Number.isFinite(mi)) return;
                                        barByMeasure.set(mi, Number(b.xPosition));
                                    } catch {
                                        // ignore
                                    }
                                });

                                const rects: Array<{ x: number; w: number; mi: number; voices: number[] }> = [];
                                measuresInSystem.forEach((mi, idx) => {
                                    if (!invalidMeasures.has(mi)) return;
                                    const x1 = barByMeasure.get(mi);
                                    const x0 = (system.startMeasuresX && Number.isFinite(system.startMeasuresX[idx]))
                                        ? Number(system.startMeasuresX[idx])
                                        : (idx > 0 ? (barByMeasure.get(measuresInSystem[idx - 1]) ?? NaN) : START_X);
                                    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) return;
                                    const pad = 2;
                                    const voices = Array.from(invalidVoicesByMeasure.get(mi) ?? []).sort((a, b) => a - b);
                                    rects.push({ x: x0 + pad, w: (x1 - x0) - (2 * pad), mi, voices });
                                });

                                return rects;
                            } catch {
                                return [] as Array<{ x: number; w: number; mi: number; voices: number[] }>;
                            }
                        })();

                        // Clamp the *final* harmony hold-line to the end of the last measure
                        // that actually contains notes in this system (so it won't extend into
                        // a following empty measure).
                        const lastNonEmptyMeasureEndX = (() => {
                            try {
                                const nonRests = systemNotes.filter(n => n && !n.isRest && Number.isFinite((n as any).midi));
                                const lastMeasureIdx = nonRests.length
                                    ? Math.max(...nonRests.map(n => (n.measureIndex ?? -1)).filter(v => v >= 0))
                                    : Math.max(...(system.measureIndices || [0]));

                                const i = system.measureIndices.indexOf(lastMeasureIdx);
                                const staffEndX = (actualSystemWidth ?? 0) - STAFF_MARGIN;
                                if (i < 0) return staffEndX;
                                const endX = (i < system.measureIndices.length - 1)
                                    ? (system.startMeasuresX?.[i + 1] ?? staffEndX)
                                    : staffEndX;
                                // Stop a bit before the barline so the line doesn't look like it spills past.
                                return Math.max(0, Math.min(staffEndX, endX - 6));
                            } catch {
                                return (actualSystemWidth ?? 0) - STAFF_MARGIN;
                            }
                        })();

                        // Compute which harmony labels should be hidden because a passing note
                        // originates from that chord (i.e., the passing note's previous chord)
                        const hideLabelAbsBeats = new Set<number>();
                        try {
                            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

                            // Quantize to avoid float mismatches (e.g. 1.5 vs 1.5000000001).
                            // Beats are in quarter-note units; millibeat precision is plenty.
                            const qAbs = (a: number) => {
                                if (!Number.isFinite(a)) return a;
                                return Math.round(a * 1000) / 1000;
                            };

                            // Map absBeat -> label signature for this system.
                            // We only hide labels that are truly redundant (same as neighbor),
                            // not labels that represent a real harmony change on a short span.
                            const labelSigAtAbs = new Map<number, string>();
                            const orderedLabelAbs: number[] = [];
                            for (const l of systemHarmonyLabels as any[]) {
                                const a = qAbs(Number((l as any)?.absBeat));
                                if (!Number.isFinite(a)) continue;
                                const roman = String((l as any)?.roman ?? '');
                                const symbol = String((l as any)?.symbol ?? '');
                                const figs = Array.isArray((l as any)?.figures) ? (l as any).figures.map((x: any) => String(x)) : [];
                                const sig = `${roman}|${figs.join(',')}|${symbol}`;
                                labelSigAtAbs.set(a, sig);
                                orderedLabelAbs.push(a);
                            }
                            orderedLabelAbs.sort((a, b) => a - b);

                            const notesByVoice = new Map<number, StaffNote[]>();
                            for (const n of layoutData.positionedNotes) {
                                if (n.isRest) continue;
                                const v = n.voice || 1;
                                if (!notesByVoice.has(v)) notesByVoice.set(v, []);
                                notesByVoice.get(v)!.push(n);
                            }
                            for (const [v, arr] of Array.from(notesByVoice.entries())) {
                                arr.sort((a, b) => {
                                    const ma = a.measureIndex ?? 0;
                                    const mb = b.measureIndex ?? 0;
                                    if (ma !== mb) return ma - mb;
                                    return (a.beat ?? 1) - (b.beat ?? 1);
                                });
                                for (let i = 0; i < arr.length; i++) {
                                    const cur = arr[i] as any;
                                    // Hide labels under ALL analysis-detected ornamental notes
                                    if (!(cur.isPassing || cur.isNeighbor || cur.isAppoggiatura || cur.isAnticipation || cur.isEscape)) continue;
                                    // Appoggiaturas (manual OR auto-detected) use verticalization
                                    // that produces a correct chord label — do NOT hide it.
                                    if (cur.isAppoggiatura) continue;
                                    // Ornamental notes create spurious chord labels because the
                                    // analysis includes them before flagging them.  Always hide.
                                    const mStart = (layoutData as any)?.measureStartAbsBeat?.[cur.measureIndex ?? 0] ?? ((cur.measureIndex ?? 0) * beatsPerMeasure);
                                    const curAbs = qAbs(mStart + ((cur.beat ?? 1) - 1));
                                    hideLabelAbsBeats.add(curAbs);
                                }
                            }
                        } catch (_) {}
                        const showHarmony = isAnalysisEnabled && systemHarmonyLabels.length > 0;

                                                return (
                                                    <div
                            key={`system-${systemIndex}`}
                                                        ref={(el) => {
                                                                const map = systemElementByIndexRef.current;
                                                                if (el) map.set(systemIndex, el);
                                                                else map.delete(systemIndex);
                                                        }}
                            className={`relative ${viewMode === 'page' ? 'mb-8' : 'mb-0'} ${satbVisible ? '' : 'ht-satb-hidden'}`}
                            style={{ width: actualSystemWidth, height: satbVisible ? systemHeightPx : Math.max(0, systemHeightPx - SATB_HIDE_SHIFT_PX), overflow: satbVisible ? undefined : 'hidden' }}
                                                        data-system-index={systemIndex}
                          >
                                                        {systemIndex === 0 && keyChangeMode === 'modal' && modeInfo?.label && (
                                                                <div
                                                                        className="absolute text-xs font-semibold text-slate-700"
                                                                        style={{ left: 50, top: 0 }}
                                                                >
                                                                        {modeInfo.label}
                                                                </div>
                                                        )}
                                                        <RenderErrorBoundary label={`VexflowGrandStaff(system ${systemIndex})`} onReset={resetVexflow}>
                                                            {(() => {
                                                                const systemStartMeasureIndex = layoutData?.systemsParams?.[systemIndex]?.measureIndices?.[0] ?? 0;
                                                                const systemStartAbsBeat = (layoutData as any)?.measureStartAbsBeat?.[systemStartMeasureIndex]
                                                                    ?? (systemStartMeasureIndex * (timeSignature.numerator * (4 / timeSignature.denominator)));
                                                                const systemTimeSignature = getTimeSignatureAtAbsBeat(systemStartAbsBeat);
                                                                const systemMarkers = (timeSignatureMarkersBySystem?.[systemIndex] || [])
                                                                    .filter(m => m.measureIndex !== systemStartMeasureIndex);

                                                                // Accompaniment notes for THIS system: merge visible tracks, filter by
                                                                // measures of the system, and bake xPosition using the same per-tick
                                                                // pixel grid used for SATB so barlines/beats align automatically.
                                                                const accompanimentNotesForSystem: StaffNote[] = (() => {
                                                                    if (!hasVisibleAccompaniment) return [];
                                                                    const sysParams = layoutData?.systemsParams?.[systemIndex];
                                                                    if (!sysParams) return [];
                                                                    const measureToIdx = new Map<number, number>();
                                                                    sysParams.measureIndices.forEach((m, i) => measureToIdx.set(m, i));
                                                                    const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat ?? [];
                                                                    const out: StaffNote[] = [];
                                                                    // Iterate VISIBLE tracks in order and tag each note with its
                                                                    // visible-track index (_trackIdx) so the renderer can route it to
                                                                    // the matching staff block (same ordering as visibleAccompanimentTracks).
                                                                    visibleAccompanimentTracks.forEach((track, visIdx) => {
                                                                        for (const n of (track.notes || [])) {
                                                                            const mi = n.measureIndex ?? -1;
                                                                            const idxInSys = measureToIdx.get(mi);
                                                                            if (idxInSys === undefined) continue;
                                                                            const startTick = (n as any).startTick;
                                                                            if (typeof startTick !== 'number') continue;
                                                                            const msAbsBeat = Number(measureStartAbsBeat[mi]) || 0;
                                                                            const measureStartTick = beatsToTicks(msAbsBeat);
                                                                            const relativeTicks = Math.max(0, startTick - measureStartTick);
                                                                            const relativeX = relativeTicks * sysParams.pxPerTick;
                                                                            const baseX = sysParams.startMeasuresX[idxInSys] ?? 0;
                                                                            const localX = baseX + MEASURE_PADDING_X + relativeX;
                                                                            // Ricalcola explicitAccidental come per il SATB (vedi systemNotesForRender):
                                                                            // le note ACC altrimenti conservano un valore stale che può sopprimere o
                                                                            // mostrare in modo incostante le alterazioni. Si preserva l'accidentale
                                                                            // ESPLICITO dell'utente (userAccidental), che ha priorità.
                                                                            let accForRender = n;
                                                                            if (!n.isRest && !(n as any).userAccidental) {
                                                                                try {
                                                                                    const noteName = makeNoteNameFromPitchAndMidi(n.pitch, n.midi);
                                                                                    accForRender = { ...n, explicitAccidental: calculateAccidental(noteName, keyAccidentals) };
                                                                                } catch { /* mantieni n */ }
                                                                            }
                                                                            out.push({ ...accForRender, xPosition: localX, _trackIdx: visIdx } as StaffNote);
                                                                        }
                                                                    });
                                                                    return out;
                                                                })();
                                                                return (
                                                            <VexflowGrandStaff
                                key={`vf-${systemIndex}-${vexflowNonce}`}
                                                                notes={systemNotesForRender}
                                timeSignature={systemTimeSignature}
                                timeSignatureChanges={systemMarkers}
                                keySignature={keySignature}
                                barlines={systemBarlines}
                                width={actualSystemWidth}
                                height={systemHeightPx}
                                                                staffMode={staffSystemMode}
                                                                enableProximityPick={tool !== 'insert'}
                                selectedNoteIds={Array.from(selectedNoteIds)}
                                onNoteClick={(noteId, e) => handleNoteClick(noteId, systemIndex, e as any)}
                                                                onStaffClick={(x, y, e) => handleBackgroundClick(x, y, systemIndex, e)}
                                                                                                                                onStaffRightClick={(x, y, e) => handleStaffRightClick(x, y, systemIndex, e)}
                                                                onStaffMouseDown={ENABLE_MARQUEE_SELECTION ? ((e, svg) => handleBackgroundMouseDown(e, svg, systemIndex)) : undefined}
                                onMouseMoveStaff={(x, y, modKey) => handleMouseMove(x, y, systemIndex, modKey)}
                                                                onNoteHitPoints={(points) => {
                                                                        systemNoteHitPointsRef.current[systemIndex] = points;
                                                                }}
                                ghostNote={ghost}
                                                                engravingMode={engravingMode}
                                                                showVoiceColors={showVoiceColors}
                                                                accompanimentNotes={accompanimentNotesForSystem}
                                                                showAccompanimentStaves={hasVisibleAccompaniment}
                                                                accompanimentStaffMode={effectiveAccStaffMode}
                                                                accompanimentTracks={visibleAccompanimentTracks}
                                                                satbName={satbVisible ? satbName : ''}
                              />
                                                                                                                                );
                                                                                                                        })()}
                            </RenderErrorBoundary> {/* FIX: this closing tag was missing */}

                                                        {showIncompleteMeasureWarnings && invalidMeasureRects.length > 0 && (
                                                            <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                                                {(() => {
                                                                    const yTop = PLAYHEAD_Y_TOP;
                                                                    const yBottom = PLAYHEAD_Y_BOTTOM;
                                                                    const h = yBottom - yTop;
                                                                    return invalidMeasureRects.map((r, i) => {
                                                                        const voiceLabel = r.voices.length > 0
                                                                            ? `V. ${r.voices.join(',')} ⚠`
                                                                            : '⚠';
                                                                        return (
                                                                        <g key={`invalid-${systemIndex}-${i}`}
                                                                           style={{pointerEvents:'auto', cursor:'pointer'}}
                                                                           onClick={() => setShowIncompleteMeasureWarnings(false)}>
                                                                            <title>Misura incompleta — clicca per nascondere</title>
                                                                            <rect
                                                                                x={r.x}
                                                                                y={yTop}
                                                                                width={r.w}
                                                                                height={h}
                                                                                fill="rgba(239,68,68,0.22)"
                                                                                stroke="rgb(220,38,38)"
                                                                                strokeWidth={2}
                                                                            />
                                                                            <rect
                                                                                x={r.x + 4}
                                                                                y={yTop + 4}
                                                                                width={56}
                                                                                height={16}
                                                                                rx={3}
                                                                                fill="rgb(220,38,38)"
                                                                            />
                                                                            <text
                                                                                x={r.x + 32}
                                                                                y={yTop + 15}
                                                                                textAnchor="middle"
                                                                                fill="white"
                                                                                fontSize={11}
                                                                                fontWeight={700}
                                                                                fontFamily="system-ui, sans-serif"
                                                                            >
                                                                                {voiceLabel}
                                                                            </text>
                                                                        </g>
                                                                        );
                                                                    });
                                                                })()}
                                                            </svg>
                                                        )}

                                                        {/* Overlay: playhead */}
                                                        {playheadPosition && playheadPosition.systemIndex === systemIndex && (
                                                            <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                                                {
                                                                    (() => {
                                                                        const staffEndX = (actualSystemWidth ?? 0) - STAFF_MARGIN;
                                                                        const xClamped = Math.min(playheadPosition.x, staffEndX);
                                                                        // Overlay rosso: regione misure già registrate (da recStart a playhead)
                                                                        const recOverlay = (() => {
                                                                            if (!isRecording || isCountingIn) return null;
                                                                            const sys = layoutData?.systemsParams?.[systemIndex];
                                                                            if (!sys) return null;
                                                                            const startMeasure = recStartMeasureRef.current;
                                                                            // Trova la X di inizio della prima misura registrata in questo sistema
                                                                            const measIdx = sys.measureIndices.indexOf(startMeasure);
                                                                            const startX = measIdx >= 0
                                                                                ? (sys.startMeasuresX[measIdx] ?? 0)
                                                                                : (sys.measureIndices[0] <= startMeasure ? 0 : null);
                                                                            if (startX == null) return null;
                                                                            const width = Math.max(0, xClamped - startX);
                                                                            if (width <= 0) return null;
                                                                            return (
                                                                                <rect
                                                                                    x={startX}
                                                                                    y={playheadYTopPx}
                                                                                    width={width}
                                                                                    height={playheadYBottomPx - playheadYTopPx}
                                                                                    fill="rgba(239,68,68,0.18)"
                                                                                    stroke="none"
                                                                                />
                                                                            );
                                                                        })();
                                                                        const lineColor = isRecording
                                                                            ? (isCountingIn ? 'stroke-orange-400' : 'stroke-red-500')
                                                                            : isRecArmed
                                                                                ? 'stroke-orange-400'
                                                                                : 'stroke-cyan-500';
                                                                        return (
                                                                            <>
                                                                                {recOverlay}
                                                                                <line
                                                                                    x1={xClamped}
                                                                                    y1={playheadYTopPx}
                                                                                    x2={xClamped}
                                                                                    y2={playheadYBottomPx}
                                                                                    className={lineColor}
                                                                                    strokeWidth={isRecording ? 2.5 : 2}
                                                                                    opacity={isRecording ? 0.9 : 0.7}
                                                                                />
                                                                            </>
                                                                        );
                                                                    })()
                                                                }
                                                            </svg>
                                                        )}

                                                        {/* Overlay: chord insert input */}
                                                        {chordInsertMode && playheadPosition?.systemIndex === systemIndex && (
                                                            <div style={{ position: 'absolute', left: Math.max(4, playheadPosition.x - 2), top: VF_TREBLE_Y - 38, zIndex: 9999 }}>
                                                                <div className="flex items-center gap-1 bg-slate-800 border border-cyan-500 rounded-lg shadow-xl px-2 py-1">
                                                                    <input
                                                                        autoFocus
                                                                        type="text"
                                                                        value={chordInputText}
                                                                        onChange={e => { setChordInputText(e.target.value); setChordInputError(false); }}
                                                                        onKeyDown={e => {
                                                                            // Blocca propagazione solo per i tasti che gestiamo
                                                                            if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                                                                                e.stopPropagation();
                                                                            }
                                                                            // Normalizza enarmonie da tastiera: su layout italiano macOS
                                                                            // Option+3 genera 'à' → lo sostituiamo con '#' nell'input.
                                                                            // Funziona su tutti i layout/OS perché è solo una rimappatura del carattere.
                                                                            if (e.key === 'à' || e.key === '§') {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                const el = e.target as HTMLInputElement;
                                                                                const start = el.selectionStart ?? chordInputText.length;
                                                                                const end = el.selectionEnd ?? start;
                                                                                const newVal = chordInputText.slice(0, start) + '#' + chordInputText.slice(end);
                                                                                setChordInputText(newVal);
                                                                                setChordInputError(false);
                                                                                // Ripristina la posizione del cursore dopo il render
                                                                                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 1; });
                                                                                return;
                                                                            }
                                                                            if (e.key === 'Enter') {
                                                                                if (chordInputText.trim() === '') {
                                                                                    setChordInsertMode(false);
                                                                                    setChordInputText('');
                                                                                    setChordInputError(false);
                                                                                } else {
                                                                                    const ticks = handleChordInsert(chordInputText);
                                                                                    if (ticks) advanceChordCaret(1, ticks.startTick, ticks.durTicks);
                                                                                }
                                                                            } else if (e.key === 'Escape') {
                                                                                setChordInsertMode(false);
                                                                                setChordInputText('');
                                                                                setChordInputError(false);
                                                                            } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                                                                                e.preventDefault();
                                                                                const dir = e.key === 'ArrowRight' ? 1 : -1;
                                                                                if (chordInputText.trim()) {
                                                                                    const ticks = handleChordInsert(chordInputText);
                                                                                    if (ticks) advanceChordCaret(dir as 1 | -1, ticks.startTick, ticks.durTicks);
                                                                                } else {
                                                                                    advanceChordCaret(dir as 1 | -1);
                                                                                }
                                                                            }
                                                                        }}
                                                                        placeholder="es. Cmaj7  →inserisci  ↵fine"
                                                                        className={`bg-slate-700 text-white text-sm rounded px-2 py-0.5 w-40 outline-none border transition-colors ${chordInputError ? 'border-red-400' : 'border-slate-500 focus:border-cyan-400'}`}
                                                                    />
                                                                    <span className="text-xs text-slate-400 select-none">↵</span>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Overlay: selection rect */}
                                                        {ENABLE_MARQUEE_SELECTION && rectForRender && selectionRect.systemIndex === systemIndex && (
                                                            <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                <rect
                                  x={rectForRender.x}
                                  y={rectForRender.y}
                                  width={rectForRender.width}
                                  height={rectForRender.height}
                                  className="fill-cyan-400/10 stroke-cyan-500"
                                  strokeWidth={1.5}
                                                                    strokeDasharray={selectionRect.filterVoice != null ? '6 4' : undefined}
                                />
                              </svg>
                            )}

                            {/* Overlay: duplets */}
                            {systemDuplets.length > 0 && (
                                                            <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                {systemDuplets.map((t) => {
                                    const hook = 8;
                                    const y = t.bracketY;
                                    const x1 = t.x1;
                                    const x2 = t.x2;
                                    const midX = t.midX;

                                    return (
                                        <g key={t.id}>
                                            <path
                                                d={`M ${x1} ${y} L ${x1} ${y + hook} M ${x1} ${y} L ${x2} ${y} M ${x2} ${y} L ${x2} ${y + hook}`}
                                                fill="none"
                                                stroke="black"
                                                strokeWidth={1.5}
                                            />
                                            <text
                                                x={midX}
                                                y={t.textY}
                                                textAnchor="middle"
                                                fontSize={14}
                                                fill="black"
                                            >
                                                2
                                            </text>
                                        </g>
                                    );
                                })}
                              </svg>
                            )}

                            {/* Overlay: triplets */}
                            {systemTriplets.length > 0 && (
                                                            <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                {systemTriplets.map((t) => {
                                    const hook = 8;
                                    const y = t.bracketY;
                                    const x1 = t.x1;
                                    const x2 = t.x2;
                                    const midX = t.midX;

                                    return (
                                        <g key={t.id}>
                                            <path
                                                d={`M ${x1} ${y} L ${x1} ${y + hook} M ${x1} ${y} L ${x2} ${y} M ${x2} ${y} L ${x2} ${y + hook}`}
                                                fill="none"
                                                stroke="black"
                                                strokeWidth={1.5}
                                            />
                                            <text
                                                x={midX}
                                                y={t.textY}
                                                textAnchor="middle"
                                                fontSize={14}
                                                fill="black"
                                            >
                                                3
                                            </text>
                                        </g>
                                    );
                                })}
                              </svg>
                            )}

                            {/* Overlay: ACC triplet + duplet brackets */}
                            {(() => {
                                const accTup = accTupletGroupsBySystem[systemIndex];
                                if (!accTup || (accTup.triplets.length === 0 && accTup.duplets.length === 0)) return null;
                                const all = [...accTup.triplets, ...accTup.duplets];
                                return (
                                    <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                        {all.map((t) => {
                                            const hook = 8;
                                            const y = t.bracketY;
                                            const { x1, x2, midX } = t;
                                            return (
                                                <g key={t.id}>
                                                    <path
                                                        d={`M ${x1} ${y} L ${x1} ${y + hook} M ${x1} ${y} L ${x2} ${y} M ${x2} ${y} L ${x2} ${y + hook}`}
                                                        fill="none"
                                                        stroke="black"
                                                        strokeWidth={1.5}
                                                    />
                                                    <text
                                                        x={midX}
                                                        y={t.textY}
                                                        textAnchor="middle"
                                                        fontSize={14}
                                                        fill="black"
                                                    >
                                                        {t.label}
                                                    </text>
                                                </g>
                                            );
                                        })}
                                    </svg>
                                );
                            })()}

                            {/* Overlay: tempo curve markers (rall. ----- / accel. -----) */}
                            {(tempoCurveMarkersBySystem[systemIndex] || []).length > 0 && (
                                <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                    {tempoCurveMarkersBySystem[systemIndex].map(({ curve, index, isStart, fromX, toX, y }, segIdx) => {
                                        const isAccel = curve.toBpm > curve.fromBpm;
                                        const label = isAccel ? 'accel.' : 'rall.';
                                        // Approx text width: ~30px for "rall." / "accel." in 12px italic.
                                        const TEXT_GAP = 34;
                                        const lineX1 = isStart ? fromX + TEXT_GAP : fromX;
                                        const lineX2 = toX;
                                        const handleClick = (e: React.MouseEvent) => {
                                            e.stopPropagation();
                                            if (e.altKey) {
                                                setTempoCurves(prev => (prev || []).filter((_, i) => i !== index));
                                            } else {
                                                setTempoCurvePending({
                                                    startNoteId: curve.startNoteId,
                                                    endNoteId: curve.endNoteId,
                                                    defaultFromBpm: curve.fromBpm,
                                                    defaultToBpm: curve.toBpm,
                                                });
                                            }
                                        };
                                        return (
                                            <g key={`tc-${systemIndex}-${index}-${segIdx}`}>
                                                {isStart && (
                                                    <text
                                                        x={fromX}
                                                        y={y + 4}
                                                        textAnchor="start"
                                                        fontSize={12}
                                                        fontStyle="italic"
                                                        fontWeight={600}
                                                        fill="black"
                                                        style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                                                        onClick={handleClick}
                                                    >
                                                        <title>{`${label} ${curve.fromBpm}→${curve.toBpm} · Click: modifica · Alt+Click: elimina`}</title>
                                                        {label}
                                                    </text>
                                                )}
                                                {lineX2 > lineX1 && (
                                                    <line
                                                        x1={lineX1}
                                                        y1={y}
                                                        x2={lineX2}
                                                        y2={y}
                                                        stroke="black"
                                                        strokeWidth={1}
                                                        strokeDasharray="4 3"
                                                        style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                                                        onClick={handleClick}
                                                    >
                                                        <title>{`${label} ${curve.fromBpm}→${curve.toBpm} · Click: modifica · Alt+Click: elimina`}</title>
                                                    </line>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                            )}

                            {/* Overlay: measure numbers */}
                            {showMeasureNumbers && (
                                <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                    {(layoutData.systemsParams?.[systemIndex]?.measureIndices || []).map((mIdx, i) => {
                                        // Start numbering from measure 2 (skip the very first one).
                                        if (mIdx === 0) return null;

                                        const startX = layoutData.systemsParams[systemIndex].startMeasuresX?.[i];
                                        if (startX == null) return null;

                                        return (
                                            <text
                                                key={`mnum-${systemIndex}-${mIdx}`}
                                                x={startX}
                                                // With SATB hidden the system is shifted up by SATB_HIDE_SHIFT_PX and the
                                                // top band (where measure numbers sit) is clipped — reposition them into
                                                // the visible ACC area (compensating the shift) so they don't vanish.
                                                y={!satbVisible
                                                    ? (SATB_HIDE_SHIFT_PX + 114)
                                                    : (staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 14) : (TOP_STAFF_TOP + 44))}
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                                fontSize={11}
                                                fontWeight={700}
                                                fill="black"
                                                opacity={0.65}
                                            >
                                                {mIdx + 1}
                                            </text>
                                        );
                                    })}
                                </svg>
                            )}

                            {/* Overlay: analysis labels + violation highlights (adapter output) */}
                                                        {((isAnalysisEnabled || violationLevelByNoteId.size > 0 || analysisContexts.length > 0 || timeSignatureChanges.length > 0 || ((progressionMarkersBySystem?.[systemIndex] || []).length > 0) || ((sequenceMarkersBySystem?.[systemIndex] || []).length > 0))) && (
                              <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                                                {/* Modulation / tonicization markers */}
                                                                {(contextMarkersBySystem?.[systemIndex] || []).map((m, i) => (
                                                                    <text
                                                                        key={`ctx-${systemIndex}-${i}`}
                                                                        x={m.x}
                                                                        y={staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 4) : (TOP_STAFF_TOP + 4)}
                                                                        textAnchor="start"
                                                                        fontSize={11}
                                                                        fontWeight={600}
                                                                        fill="black"
                                                                        opacity={0.85}
                                                                    >
                                                                        {m.label}
                                                                    </text>
                                                                ))}

                                                                {/* Progression (sequenza) markers */}
                                                                {(progressionMarkersBySystem?.[systemIndex] || []).map((p) => {
                                                                    const hook = 7;
                                                                    const y = p.y;
                                                                    return (
                                                                        <g key={p.id} opacity={0.9}>
                                                                            <path
                                                                                d={`M ${p.x1} ${y} L ${p.x1} ${y + hook} M ${p.x1} ${y} L ${p.x2} ${y} M ${p.x2} ${y} L ${p.x2} ${y + hook}`}
                                                                                fill="none"
                                                                                stroke="black"
                                                                                strokeWidth={1.2}
                                                                            />
                                                                            <text
                                                                                x={p.midX}
                                                                                y={p.textY}
                                                                                textAnchor="middle"
                                                                                fontSize={11}
                                                                                fontWeight={700}
                                                                                fill="black"
                                                                            >
                                                                                {p.label}
                                                                            </text>
                                                                            {(p as any).modelX1 != null && (p as any).modelX2 != null && (p as any).modelY != null && (
                                                                                <line x1={(p as any).modelX1} y1={(p as any).modelY} x2={(p as any).modelX2} y2={(p as any).modelY}
                                                                                    stroke="#0ea5e9" strokeWidth={4} strokeLinecap="round" opacity={0.35} />
                                                                            )}
                                                                        </g>
                                                                    );
                                                                })}

                                                                {(sequenceModelMarkersBySystem?.[systemIndex] || []).map((p) => {
                                                                    return (
                                                                        <g key={p.id} opacity={0.35}>
                                                                            <line
                                                                                x1={p.x1}
                                                                                y1={p.y}
                                                                                x2={p.x2}
                                                                                y2={p.y}
                                                                                stroke="#0ea5e9"
                                                                                strokeWidth={4}
                                                                                strokeLinecap="round"
                                                                            />
                                                                        </g>
                                                                    );
                                                                })}

                                                                {(sequenceMarkersBySystem?.[systemIndex] || []).map((p) => {
                                                                    const hook = 7;
                                                                    const y = p.y;
                                                                    return (
                                                                        <g key={p.id} opacity={0.9}>
                                                                            <path
                                                                                d={`M ${p.x1} ${y} L ${p.x1} ${y + hook} M ${p.x1} ${y} L ${p.x2} ${y} M ${p.x2} ${y} L ${p.x2} ${y + hook}`}
                                                                                fill="none"
                                                                                stroke="#0f172a"
                                                                                strokeWidth={1.1}
                                                                            />
                                                                            {p.label ? (
                                                                                <text
                                                                                    x={p.midX}
                                                                                    y={p.textY}
                                                                                    textAnchor="middle"
                                                                                    fontSize={10}
                                                                                    fontWeight={700}
                                                                                    fill="#0f172a"
                                                                                >
                                                                                    {p.label}
                                                                                </text>
                                                                            ) : null}
                                                                        </g>
                                                                    );
                                                                })}


                                {/* Harmony labels (roman/symbol) + figured bass */}
                                {showHarmony && systemHarmonyLabels.map((lbl, lblIndex) => {
                                                                    const bottomStaffBottomLineY = (staffSystemMode === 'satb_ancient')
                                                                        ? (VF_SATB_BASS_Y + 4 * VF_LINE_SPACING)
                                                                        : (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + (BOTTOM_STAFF_TOP + 4 * LINE_HEIGHT));
                                                                    // Trial positioning: move roman+figures to the right of bass stems and lower.
                                                                      const RB_SHIFT_X = 25;
                                                                       const RB_SHIFT_Y = 40;
                                                                                                                                        // SATB antiche: lower the whole bass-analysis block (roman + figures)
                                                                                                                                        // with a fixed offset to avoid collisions with bass noteheads/ties.
                                                                                                                                        // No dynamic collision detection.
                                                                                                                                        const SATB_BASS_FIGURES_EXTRA_Y_PX = 32;
                                                                                                                                        const figuresExtraY = (staffSystemMode === 'satb_ancient') ? SATB_BASS_FIGURES_EXTRA_Y_PX : 0;

                                                                                                                                        const romanBelowY = bottomStaffBottomLineY + 28 + RB_SHIFT_Y + figuresExtraY;
                                                                                                                                        const figuresY0 = bottomStaffBottomLineY + 20 + RB_SHIFT_Y + figuresExtraY;

                                                                                                                                        // Chord symbols (sigle) stay above the top staff; shift down only a few pixels.
                                                                                                                                        const SYMBOL_SHIFT_Y = 6;
                                                                                                                                        // Con SATB NASCOSTO il sistema viene traslato in alto di SATB_HIDE_SHIFT_PX e la
                                                                                                                                        // fascia superiore (dove stanno le sigle, sopra il rigo di violino) viene ritagliata.
                                                                                                                                        // Riposiziona le sigle appena sopra l'area ACC visibile compensando lo shift, così
                                                                                                                                        // non spariscono (i numeri romani, sotto il basso, restano già visibili).
                                                                                                                                        const symbolsY = satbVisible
                                                                                                                                            ? ((staffSystemMode === 'satb_ancient' ? VF_SATB_SOPRANO_Y : TOP_STAFF_TOP) - 18 + SYMBOL_SHIFT_Y)
                                                                                                                                            : (SATB_HIDE_SHIFT_PX + 14);

                                                                    const isHiddenMarker = !!(lbl as any).hiddenMarker;
                                                                    const qAbs = (a: number) => {
                                                                        if (!Number.isFinite(a)) return a;
                                                                        return Math.round(a * 1000) / 1000;
                                                                    };
                                                                    const lblAbsQ = qAbs(Number((lbl as any).absBeat));
                                                                    const showRoman = !lockHides.romanLabels && showRomanAnalysis && !!lbl.roman && !isHiddenMarker && ((lbl as any).isOverride || !hideLabelAbsBeats.has(lblAbsQ));
                                                                    const showSymbol = !lockHides.chordSymbols && showSymbolAnalysis && !!(lbl as any).symbol && !isHiddenMarker && ((lbl as any).isOverride || !hideLabelAbsBeats.has(lblAbsQ));

                                                                    // Keep a consistent left edge reference for both roman and symbols.
                                                                    const romanFont = '700 14px serif';
                                                                    const refW = measureTextWidth('V', romanFont);

                                                                    // Clamp the analysis label within the current measure.
                                                                    // This avoids the previous-measure label (e.g. V near the barline)
                                                                    // overlapping and hiding the next measure's beat-1 label (e.g. I).
                                                                    const clampToMeasure = (() => {
                                                                        try {
                                                                            const absBeat = Number((lbl as any).absBeat);
                                                                            const starts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
                                                                            if (!Number.isFinite(absBeat) || !starts || starts.length === 0) return null;

                                                                            let m = 0;
                                                                            for (let i = starts.length - 1; i >= 0; i--) {
                                                                                if (absBeat >= (starts[i] ?? 0) - 1e-9) { m = i; break; }
                                                                            }
                                                                            const sys = layoutData.systemsParams?.[systemIndex];
                                                                            const idx = sys?.measureIndices?.indexOf(m);
                                                                            if (idx == null || idx < 0) return null;

                                                                            const startX = Number(sys.startMeasuresX?.[idx]);
                                                                            const endX = (idx < (sys.measureIndices.length - 1))
                                                                                ? Number(sys.startMeasuresX?.[idx + 1])
                                                                                : (Number(sys.width) - START_X);
                                                                            if (!Number.isFinite(startX) || !Number.isFinite(endX) || endX <= startX) return null;

                                                                            const romanShown = String((lbl as any).romanDisplay ?? (lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? lbl.roman ?? '');
                                                                            const romanBaseText = showHarmonyDebug
                                                                                ? romanShown
                                                                                : romanShown;
                                                                            const romanW = measureTextWidth(romanBaseText, romanFont);
                                                                            const figFont = '700 12px serif';
                                                                            const figures = (lbl.figures || []) as any[];
                                                                            const figuresW = figures.length
                                                                                ? Math.max(...figures.map(f => measureTextWidth(String(f), figFont)))
                                                                                : 0;
                                                                            const symText = String((lbl as any).symbol || '');
                                                                            const symW = symText ? measureTextWidth(symText, romanFont) : 0;

                                                                            const blockW = Math.max(symW, (romanW + (figuresW ? (6 + figuresW) : 0)));
                                                                            const pad = MEASURE_PADDING_X;
                                                                            const minX = startX + pad;
                                                                            const maxX = Math.max(minX, (endX - pad - blockW));
                                                                            return { minX, maxX };
                                                                        } catch {
                                                                            return null;
                                                                        }
                                                                    })();

                                                                    const baseX = (() => {
                                                                        const raw = lbl.x + RB_SHIFT_X - refW;
                                                                        if (!clampToMeasure) return raw;
                                                                        return Math.min(clampToMeasure.maxX, Math.max(clampToMeasure.minX, raw));
                                                                    })();

                                  return (
                                    <g key={lbl.id}>
                                                                            {/* Chord symbols (sigle) above the top staff */}
                                                                            {showSymbol ? (
                                                                                <text
                                                                                    x={baseX}
                                                                                    y={symbolsY}
                                                                                    textAnchor="start"
                                                                                    fontSize={14}
                                                                                    fontWeight={700}
                                                                                    fill="black"
                                                                                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                                                                                    onMouseDown={(e: any) => { e.stopPropagation(); openExplain(lbl); }}
                                                                                >
                                                                                    {(lbl as any).symbol}
                                                                                </text>
                                                                            ) : null}

                                                                            {/* PCS Debug: always shown when debug toggle is on, independent of showRoman */}
                                                                            {showHarmonyDebug && (() => {
                                                                                const s = String((lbl as any).pcsSig || '').trim();
                                                                                if (!s) return null;
                                                                                return (
                                                                                    <text
                                                                                        x={baseX}
                                                                                        y={romanBelowY + 12}
                                                                                        textAnchor="start"
                                                                                        fontSize={10}
                                                                                        fontWeight={600}
                                                                                        fill="magenta"
                                                                                        opacity={0.85}
                                                                                    >
                                                                                        {s}
                                                                                    </text>
                                                                                );
                                                                            })()}

                                                                            {/* Roman numerals + figured bass below the bass staff */}
                                                                            {showRoman ? (
                                                                                <g>
                                                                                    {(() => {

                                                                                        const romanBaseText = String((lbl as any).romanDisplay ?? (lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? lbl.roman ?? '');
                                                                                        const romanW = measureTextWidth(romanBaseText, romanFont);
                                                                                        const romanX = baseX;
                                                                                        const figuresX = romanX + romanW + 6;

                                                                                        const pcsDebug = (() => {
                                                                                            try {
                                                                                                if (!showHarmonyDebug) return null;
                                                                                                const s = String((lbl as any).pcsSig || '').trim();
                                                                                                return s ? s : null;
                                                                                            } catch {
                                                                                                return null;
                                                                                            }
                                                                                        })();

                                                                                        // Harmony hold-line: extend from end of this label to the next *visible* label.
                                                                                        // NOTE: we do NOT trust array order here; use x-position to find the next obstacle.
                                                                                        const nextVisible = (() => {
                                                                                            let best: any | null = null;
                                                                                            for (let j = 0; j < systemHarmonyLabels.length; j++) {
                                                                                                const candidate: any = systemHarmonyLabels[j];
                                                                                                if (!candidate || candidate === lbl) continue;
                                                                                                if (typeof candidate.x !== 'number' || typeof lbl.x !== 'number') continue;
                                                                                                if (candidate.x <= lbl.x) continue;

                                                                                                const abs = (candidate as any)?.absBeat;
                                                                                                const isHidden = !!(candidate as any)?.hiddenMarker || hideLabelAbsBeats.has(abs);
                                                                                                if (isHidden) continue;

                                                                                                const candidateShowRoman = showRomanAnalysis && !!candidate?.roman;
                                                                                                const candidateShowSymbol = showSymbolAnalysis && !!(candidate as any)?.symbol;
                                                                                                if (!(candidateShowRoman || candidateShowSymbol)) continue;

                                                                                                if (!best || candidate.x < best.x) best = candidate;
                                                                                            }
                                                                                            return best;
                                                                                        })();

                                                                                        const holdLine = (() => {
                                                                                            try {
                                                                                                const absBeat = (lbl as any).absBeat as number | undefined;

                                                                                                // Don't draw the generic harmony hold-line when this label is a suspension onset,
                                                                                                // because the suspension renderer already draws its own line + resolution number.
                                                                                                try {
                                                                                                    if (analyzedNotes && typeof absBeat === 'number') {
                                                                                                        const suspHere = (analyzedNotes as any[]).some(n => n && n.isSuspension && Math.abs(((n as any).isSuspension?.fromAbsBeat ?? -1) - absBeat) < 1e-6);
                                                                                                        if (suspHere) return null;
                                                                                                    }
                                                                                                } catch { /* ignore */ }

                                                                                                // Only draw hold-lines when we are actually suppressing at least one intermediate
                                                                                                // harmony label (e.g. because a passing note sits on a weak beat).
                                                                                                const hasHiddenBetween = (() => {
                                                                                                    try {
                                                                                                        if (typeof absBeat !== 'number') return false;
                                                                                                        const spanEndAbs = (nextVisible && typeof (nextVisible as any).absBeat === 'number')
                                                                                                            ? ((nextVisible as any).absBeat as number)
                                                                                                            : Infinity;
                                                                                                        for (let j = lblIndex + 1; j < systemHarmonyLabels.length; j++) {
                                                                                                            const cand: any = systemHarmonyLabels[j];
                                                                                                            const a = cand?.absBeat;
                                                                                                            if (typeof a !== 'number') continue;
                                                                                                            if (a <= absBeat) continue;
                                                                                                            if (a >= spanEndAbs) break;
                                                                                                            if ((cand as any)?.hiddenMarker) return true;
                                                                                                            if (hideLabelAbsBeats.has(a)) return true;
                                                                                                        }
                                                                                                        return false;
                                                                                                    } catch {
                                                                                                        return false;
                                                                                                    }
                                                                                                })();
                                                                                                if (!hasHiddenBetween) return null;

                                                                                                const figTexts = (lbl.figures || []) as string[];
                                                                                                const maxFigW = figTexts.length
                                                                                                    ? Math.max(...figTexts.map(t => measureTextWidth(String(t), '12px serif')))
                                                                                                    : 0;
                                                                                                const x1 = (figTexts.length ? (figuresX + maxFigW + 10) : (romanX + romanW + 10));

                                                                                                // End at the staff end / last non-empty measure end.
                                                                                                const staffEndX = (actualSystemWidth ?? 0) - STAFF_MARGIN;
                                                                                                let x2 = nextVisible ? staffEndX : (lastNonEmptyMeasureEndX ?? staffEndX);
                                                                                                if (nextVisible) {
                                                                                                    const nextBaseX = (nextVisible as any).x + RB_SHIFT_X - refW;
                                                                                                    // Stop a bit before the next label (roman/symbol) starts.
                                                                                                    x2 = Math.max(x1 + 8, nextBaseX - 12);
                                                                                                }
                                                                                                // Never extend beyond the staff end.
                                                                                                x2 = Math.min(x2, staffEndX);

                                                                                                // Keep hold-lines short: they are only a visual cue that the harmony is held,
                                                                                                // not a literal duration ruler.
                                                                                                const MAX_HOLD_LINE_PX = 110;
                                                                                                x2 = Math.min(x2, x1 + MAX_HOLD_LINE_PX);
                                                                                                // Avoid tiny/negative lines
                                                                                                if (!(x2 > x1 + 6)) return null;
                                                                                                const y = figuresY0 + 10;
                                                                                                return (
                                                                                                    <line
                                                                                                        x1={x1}
                                                                                                        y1={y}
                                                                                                        x2={x2}
                                                                                                        y2={y}
                                                                                                        stroke="black"
                                                                                                        strokeWidth={1}
                                                                                                        strokeLinecap="butt"
                                                                                                    />
                                                                                                );
                                                                                            } catch {
                                                                                                return null;
                                                                                            }
                                                                                        })();

                                                                                        return (
                                                                                            <>
                                                                                                <text
                                                                                                    x={romanX}
                                                                                                    y={romanBelowY}
                                                                                                    textAnchor="start"
                                                                                                    fontSize={14}
                                                                                                    fontWeight={700}
fill={(lbl as any).isChromatic ? '#8B5CF6' : 'black'}
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                    onMouseDown={(e: any) => { e.stopPropagation(); openExplain(lbl); }}
                >
                    {String((lbl as any).romanDisplay ?? (lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? lbl.roman ?? '')}
                </text>

                {/* Indicatore ambiguità ≈ — visibile quando ci sono letture alternative */}
                {!lockHides.alternatives && (lbl as any).alternatives?.length ? (
                    <text
                        x={romanX + measureTextWidth(String((lbl as any).romanDisplay ?? (lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? lbl.roman ?? ''), '700 14px serif') + 2}
                        y={romanBelowY - 6}
                        textAnchor="start"
                        fontSize={9}
                        fontWeight={700}
                        fill="#60a5fa"
                        style={{ cursor: 'pointer', pointerEvents: 'all' }}
                        onMouseDown={(e: any) => { e.stopPropagation(); openExplain(lbl); }}
                    >≈</text>
                ) : null}

                {/* Figured bass numbers */}
                {(lbl as any).figures?.length ? (
                    <g>
                        {((lbl as any).figures as string[]).map((f: string, i: number) => (
                                                                                                            <text
                                                                                                                key={`${lbl.id}-fig-${i}`}
                                                                                                                x={figuresX}
                                                                                                                y={figuresY0 + (i * 12)}
                                                                                                                textAnchor="start"
                                                                                                                fontSize={12}
                                                                                                                fill={(lbl as any).isChromatic ? '#8B5CF6' : 'black'}
                                                                                                            >
                                                                                                                {f}
                                                                                                            </text>
                                                                                                        ))}
                                                                                                    </g>
                                                                                                ) : null}

                                                                                                {/* Harmony hold-line (between labels) */}
                                                                                                {holdLine}

                                                                                                {/* Suspension hold-line + resolution number */}
                                                                                                {(() => {
                                                                                                    try {
                                                                                                        const absBeat = (lbl as any).absBeat;
                                                                                                        if (!analyzedNotes || typeof absBeat !== 'number') return null;
                                                                                                        const suspNotes = (analyzedNotes as any[]).filter(
                                                                                                            n =>
                                                                                                                n &&
                                                                                                                n.isSuspension &&
                                                                                                                Math.abs(((n as any).isSuspension?.fromAbsBeat ?? -1) - ((lbl as any).absBeat ?? -999)) < 1e-6,
                                                                                                        );
                                                                                                        if (!suspNotes.length) return null;
                                                                                                        // Deduplicate: keep only the most specific type per voice
                                                                                                        const _CLASSIC_SUSP = new Set(['4-3','6-5','7-6','7-8','8-7','9-8','2-3']);
                                                                                                        const _suspByV = new Map<number, any>();
                                                                                                        for (const _sn of suspNotes) { const _v = (_sn as any).voice ?? 0; const _ex = _suspByV.get(_v); if (!_ex) { _suspByV.set(_v, _sn); } else { if (_CLASSIC_SUSP.has(String((_sn as any).isSuspension?.type??'')) && !_CLASSIC_SUSP.has(String((_ex as any).isSuspension?.type??''))) _suspByV.set(_v, _sn); } }
                                                                                                        const dedupSuspNotes = Array.from(_suspByV.values());
                                                                                                        const suspInfos = dedupSuspNotes
                                                                                                            .map(sn => ({
                                                                                                                s: (sn as any).isSuspension,
                                                                                                                sn,
                                                                                                            }))
                                                                                                            .filter(({ s }) => s && s.resolvedById);
                                                                                                        if (!suspInfos.length) return null;

                                                                                                        // compute total figures width
                                                                                                        const figTexts = (lbl.figures || []);
                                                                                                        const hasSuspFigure = figTexts.some(ft => /^\d+-\d+/.test((ft||'').toString()));
                                                                                                        let figsW = 0;
                                                                                                        for (let i = 0; i < figTexts.length; i++) {
                                                                                                            figsW += measureTextWidth(figTexts[i], '12px serif') + 6;
                                                                                                        }
                                                                                                        const figuresEnd = figuresX + Math.max(0, figsW);

                                                                                                        // minimum line end beyond figures
                                                                                                        const minLineEnd = figuresEnd + 12;

                                                                                                        // find resolved notes and map to X/Y (prefer precise notePositions mapping)
                                                                                                        let resX = minLineEnd;
                                                                                                        let resolvedY: number | null = null;
                                                                                                        const resolvedNotesById = new Map<string, any>();
                                                                                                        for (const { s } of suspInfos) {
                                                                                                            const rid = String((s as any).resolvedById);
                                                                                                            const resolvedNote = (analyzedNotes as any[]).find(n => n && n.id === rid);
                                                                                                            if (resolvedNote) {
                                                                                                                resolvedNotesById.set(rid, resolvedNote);
                                                                                                                const pos = notePositions.get(resolvedNote.id);
                                                                                                                if (pos && typeof pos.x === 'number') {
                                                                                                                    resX = Math.max(resX, Math.max(minLineEnd, pos.x));
                                                                                                                }
                                                                                                                if (resolvedY == null && pos && typeof pos.y === 'number') {
                                                                                                                    resolvedY = pos.y;
                                                                                                                }
                                                                                                            }
                                                                                                        }

                                                                                                        // extend line by 10px to left and right
                                                                                                        const lineStart = Math.max(figuresX, figuresEnd + 4 - 10);
                                                                                                        const RESOLUTION_X_SHIFT_PX = -20;

                                                                                                        // Stop before the next visible harmony label (roman OR symbol), so the suspension
                                                                                                        // hold-line doesn't run underneath the next cifratura.
                                                                                                        const nextObstacleX = (() => {
                                                                                                            try {
                                                                                                                if (!nextVisible) return null;
                                                                                                                const nextBaseX = (nextVisible as any).x + RB_SHIFT_X - refW;
                                                                                                                if (!Number.isFinite(nextBaseX as any)) return null;
                                                                                                                return (nextBaseX as number) - 12;
                                                                                                            } catch {
                                                                                                                return null;
                                                                                                            }
                                                                                                        })();

                                                                                                        let lineEnd = resX + 10 + RESOLUTION_X_SHIFT_PX;
                                                                                                        if (typeof nextObstacleX === 'number') {
                                                                                                            lineEnd = Math.min(lineEnd, nextObstacleX);
                                                                                                        }
                                                                                                        // original: figuresY0 - 6; lower by 16px as requested
                                                                                                        const lineY = figuresY0 + 10;
                                                                                                        // Place number below the figures (original behaviour)
                                                                                                        const numberY = figuresY0 + 14;

                                                                                                        // (intentionally no debug log here; this render path is hot)
                                                                                                        // Avoid tiny/negative lines if the next label is immediately after.
                                                                                                        if (!(lineEnd > lineStart + 6)) return null;

                                                                                                        // Keep text anchor consistent with the truncated line.
                                                                                                        const textX = Math.min(resX, (lineEnd - 16 - RESOLUTION_X_SHIFT_PX));

                                                                                                        return (
                                                                                                            <>
                                                                                                                <line
                                                                                                                    x1={lineStart}
                                                                                                                    x2={lineEnd}

                                                                                                                    y1={lineY}
                                                                                                                    y2={lineY}
                                                                                                                    stroke="black"
                                                                                                                    strokeWidth={1}
                                                                                                                    strokeLinecap="butt"
                                                                                                                />

                                                                                                                {pcsDebug && (
                                                                                                                    <text
                                                                                                                        x={romanX}
                                                                                                                        y={romanBelowY + 12}
                                                                                                                        textAnchor="start"
                                                                                                                        fontSize={10}
                                                                                                                        fontWeight={600}
                                                                                                                        fill="black"
                                                                                                                        opacity={0.6}
                                                                                                                    >
                                                                                                                        {pcsDebug}
                                                                                                                    </text>
                                                                                                                )}
                                                                                                                {(() => {
                                                                                                                    if (hasSuspFigure) return null;

                                                                                                                    const CLASSIC_TYPES = new Set(['4-3', '6-5', '7-6', '7-8', '8-7', '9-8', '2-3']);
                                                                                                                    const resolutionTextFor = (susp: any, resolvedNote: any) => {
                                                                                                                        const suspType = (typeof susp?.type === 'string') ? String(susp.type) : '';
                                                                                                                        // Classic suspensions: show ONLY the resolution number at the end.
                                                                                                                        if (suspType && CLASSIC_TYPES.has(suspType)) {
                                                                                                                            if (suspType === '4-3') return '3';
                                                                                                                            if (suspType === '6-5') return '5';
                                                                                                                            if (suspType === '7-6') return '6';
                                                                                                                            if (suspType === '7-8') return '8';
                                                                                                                            if (suspType === '2-3') return '3';
                                                                                                                            if (suspType === '8-7') {
                                                                                                                                try {
                                                                                                                                    const acc = (resolvedNote as any)?.userAccidental ?? (resolvedNote as any)?.explicitAccidental ?? (resolvedNote as any)?.accidental ?? null;
                                                                                                                                    const prefix = acc === 'flat' ? '♭' : (acc === 'sharp' ? '♯' : (acc === 'natural' ? '♮' : ''));
                                                                                                                                    return `${prefix}7`;
                                                                                                                                } catch {
                                                                                                                                    return '7';
                                                                                                                                }
                                                                                                                        }
                                                                                                                        if (suspType === '9-8') return '8';
                                                                                                                    }
                                                                                                                    try {
                                                                                                                            const n = Math.round(Number((susp as any).toNum));
                                                                                                                            if (!Number.isFinite(n) || n <= 0) return null;
                                                                                                                            // Keep 8/9 as-is; reduce larger compound figures to 1..7.
                                                                                                                            if (n === 8 || n === 9) return String(n);
                                                                                                                            if (n > 9) return String((((n - 1) % 7 + 7) % 7) + 1);
                                                                                                                            return String(n);
                                                                                                                    } catch {
                                                                                                                            return null;
                                                                                                                    }
                                                                                                                };

                                                                                                                    const partsRaw = suspInfos
                                                                                                                        .map(({ s }) => {
                                                                                                                            const resolvedNote = resolvedNotesById.get(String((s as any).resolvedById));
                                                                                                                            return resolutionTextFor(s, resolvedNote);
                                                                                                                        })
                                                                                                                        .filter((t): t is string => typeof t === 'string' && t.length > 0);
                                                                                                                    if (!partsRaw.length) return null;

                                                                                                                    // In double suspensions, order the stacked resolution numbers by the
                                                                                                                    // corresponding suspension-from figure (9 above 4 => 8 above 3), so the
                                                                                                                    // visual pairing is unambiguous.
                                                                                                                    const getFromWanted = (susp: any): number | null => {
                                                                                                                        try {
                                                                                                                            const suspType = String(susp?.type ?? '');
                                                                                                                            if (suspType === '4-3') return 4;
                                                                                                                            if (suspType === '6-5') return 6;
                                                                                                                            if (suspType === '7-6') return 7;
                                                                                                                                if (suspType === '7-8') return 7;
                                                                                                                            if (suspType === '8-7') return 8;
                                                                                                                            if (suspType === '9-8') return 9;
                                                                                                                            const n = Math.round(Number((susp as any)?.fromNum));
                                                                                                                            if (!Number.isFinite(n) || n <= 0) return null;
                                                                                                                            return (((n - 1) % 7 + 7) % 7) + 1;
                                                                                                                    } catch {
                                                                                                                            return null;
                                                                                                                    }
                                                                                                                };

                                                                                                                    const pairs = suspInfos
                                                                                                                        .map(({ s }) => {
                                                                                                                            const resolvedNote = resolvedNotesById.get(String((s as any).resolvedById));
                                                                                                                            return { from: getFromWanted(s), text: resolutionTextFor(s, resolvedNote) };
                                                                                                                        })
                                                                                                                        .filter((p: any) => typeof p.text === 'string' && p.text.length > 0);

                                                                                                                    // Deduplicate by text, but keep the highest from if duplicated.
                                                                                                                    const byText = new Map<string, { from: number; text: string }>();
                                                                                                                    for (const p of pairs) {
                                                                                                                            const f = (p.from == null || !Number.isFinite(p.from)) ? -Infinity : Number(p.from);
                                                                                                                            const existing = byText.get(p.text);
                                                                                                                            if (!existing || f > existing.from) byText.set(p.text, { from: f, text: p.text });
                                                                                                                        }

                                                                                                                    const parts = Array.from(byText.values())
                                                                                                                        .sort((a, b) => b.from - a.from)
                                                                                                                        .map((x) => x.text);

																					if (!parts.length) return null;

                                                                                    // Double suspensions: stack the resolution numbers vertically (8 above 3).
                                                                                    // Align to the same figure baseline as the onset stack (9 above 4) to avoid
                                                                                    // the impression of "crossing".
                                                                                    if (parts.length > 1) {
                                                                                            const baseY = figuresY0;
                                                                                            return (
                                                                                                <>
                                                                                                    {parts.map((t, i) => (
                                                                                                        <text
                                                                                                            key={`res-${i}-${t}`}
                                                                                                            x={textX + 16 + RESOLUTION_X_SHIFT_PX}
                                                                                                            y={baseY + (i * 12)}
                                                                                                            textAnchor="start"
                                                                                                            fontSize={12}
                                                                                                            fill="black"
                                                                                                            fontWeight={700}
                                                                                                        >
                                                                                                            {t}
                                                                                                        </text>
                                                                                                    ))}
                                                                                                </>
                                                                                            );
                                                                                    }

                                                                                    // Single suspension: keep existing placement (below the figures).
                                                                                    return (
                                                                                        <text
                                                                                            x={textX + 16 + RESOLUTION_X_SHIFT_PX}
                                                                                            y={numberY}
                                                                                        textAnchor="start"
                                                                                        fontSize={12}
                                                                                        fill="black"
                                                                                        fontWeight={700}
                                                                                    >
                                                                                        {parts[0]}
                                                                                    </text>
                                                                                    );
                                                                                                                })()}
                                                                                                            </>
                                                                                                        );
                                                                                                    } catch (e) {
                                                                                                        return null;
                                                                                                    }
                                                                                                })()}
                                                                                            </>
                                                                                        );
                                                                                    })()}
                                                                                </g>
                                                                            ) : null}
                                    </g>
                                  );
                                })}

                                                                {/* Violation connections (aligned to note positions) */}
                                                                {(() => {
                                                                    const systemNoteIdSet = new Set(systemNotes.map(n => n.id));
                                                                    const hitPoints = systemNoteHitPointsRef.current[systemIndex] || [];
                                                                    const hitPointById = new Map(hitPoints.filter(p => !p.isGhost).map(p => [p.id, { x: p.x, y: p.y }]));
                                                                    // Only render connections that belong to this system AND that correspond
                                                                    // to an actual violation entry. This prevents drawing ad-hoc connections
                                                                    // (e.g., suspension-only connections without panel entries) as dashed lines.
                                                                    const systemConnections = lockHides.violations ? [] : (errorConnections || []).filter(c => {
                                                                        // Allow cross-system connections: if exactly one endpoint is in this system,
                                                                        // we will render a split segment to the system edge.
                                                                        const inThis1 = systemNoteIdSet.has(c.noteId1);
                                                                        const inThis2 = systemNoteIdSet.has(c.noteId2);
                                                                        if (!inThis1 && !inThis2) return false;
                                                                        // Do not render suspension-only connections (S-). We draw the
                                                                        // hold-line next to the Roman/figures instead — rendering the
                                                                        // S- connection here produced unwanted green dashed lines.
                                                                        if (c.ruleId && typeof c.ruleId === 'string' && c.ruleId.startsWith('S-')) return false;
                                                                        const match = (violations || []).find(v => {
                                                                            if (!v || !v.ruleId || v.ruleId !== c.ruleId) return false;
                                                                            const ids = Array.isArray(v.noteIds) ? v.noteIds : [];
                                                                            return ids.includes(c.noteId1) && ids.includes(c.noteId2);
                                                                        });
                                                                        if (!match) {
                                                                            // debug removed: skipping-connection-no-violation
                                                                            return false;
                                                                        }
                                                                        // Respect analysis panel filters: hide connections whose
                                                                        // severity category is toggled off or whose ruleId is disabled.
                                                                        if (analysisFilters) {
                                                                            const sev = (match as any).severity as string | undefined;
                                                                            const sevLower = (sev || 'error').toLowerCase();
                                                                            if (sevLower.includes('warning') && !analysisFilters.showWarning) return false;
                                                                            if ((sevLower.includes('exception') || sevLower.includes('green')) && !analysisFilters.showException) return false;
                                                                            if (sevLower.includes('chromatic') && analysisFilters.showChromatic === false) return false;
                                                                            if (sevLower.includes('error') && !analysisFilters.showError) return false;
                                                                            // Also check per-rule disable.
                                                                            const rid = String(c.ruleId || '');
                                                                            if (rid && analysisFilters.disabledRuleIds && analysisFilters.disabledRuleIds[rid]) return false;
                                                                        }
                                                                        return true;
                                                                    });

                                                                    const rank: Record<'error' | 'warning' | 'exception', number> = { error: 3, exception: 2, warning: 1 };
                                                                    const bestOf = (a?: 'error' | 'warning' | 'exception', b?: 'error' | 'warning' | 'exception') => {
                                                                        if (!a) return b;
                                                                        if (!b) return a;
                                                                        return rank[a] >= rank[b] ? a : b;
                                                                    };

                                                                    const connectionLevel = (c: ErrorConnection): 'error' | 'warning' | 'exception' => {
                                                                        if (c.severity) return c.severity;
                                                                        // Prefer a violation that explicitly contains both endpoints.
                                                                        let level: 'error' | 'warning' | 'exception' | undefined;
                                                                        for (const v of (violations as any[])) {
                                                                            const ids: string[] = Array.isArray((v as any)?.noteIds) ? (v as any).noteIds : [];
                                                                            if (ids.includes(c.noteId1) && ids.includes(c.noteId2)) {
                                                                                level = bestOf(level, (v as any).severity as any);
                                                                            }
                                                                        }
                                                                        if (level) return level;

                                                                        // Fallback: derive from endpoints.
                                                                        const a = violationLevelByNoteId.get(c.noteId1);
                                                                        const b = violationLevelByNoteId.get(c.noteId2);
                                                                        return bestOf(a, b) || 'error';
                                                                    };

                                                                    const connectionStroke = (level: 'error' | 'warning' | 'exception' | 'chromatic') =>
                                                                        level === 'warning' ? '#f59e0b' : level === 'exception' ? '#22c55e' : level === 'chromatic' ? '#8B5CF6' : '#ef4444';

                                                                    return systemConnections.map((c, idx) => {
                                                                        const hp1 = hitPointById.get(c.noteId1);
                                                                        const hp2 = hitPointById.get(c.noteId2);

                                                                        const clef1 = noteClefById.get(c.noteId1) || 'treble';
                                                                        const clef2 = noteClefById.get(c.noteId2) || 'treble';

                                                                        const applyOverlayShift = (p: { x: number; y: number }, clef: ClefType, voice: Voice) => {
                                                                            if (staffSystemMode === 'satb_ancient') return p;
                                                                            if (clef === 'bass') {
                                                                                return {
                                                                                    x: p.x + OVERLAY_BASS_X_SHIFT_PX,
                                                                                    y: p.y + OVERLAY_BASS_Y_SHIFT_PX,
                                                                                };
                                                                            }
                                                                            return {
                                                                                x: p.x + OVERLAY_TREBLE_X_SHIFT_PX,
                                                                                y: p.y + OVERLAY_TREBLE_Y_SHIFT_PX + (voice === 2 ? OVERLAY_TREBLE_VOICE2_Y_ADJUST_PX : 0),
                                                                            };
                                                                        };

                                                                        const v1 = noteVoiceById.get(c.noteId1) || 1;
                                                                        const v2 = noteVoiceById.get(c.noteId2) || 1;

                                                                        // Prefer actual VexFlow hit points (already aligned).
                                                                        // Fallback to the legacy approximation + overlay shift.
                                                                        const q1 = hp1 ? hp1 : (() => {
                                                                            const p = notePositions.get(c.noteId1);
                                                                            return p ? applyOverlayShift(p, clef1, v1) : null;
                                                                        })();
                                                                        const q2 = hp2 ? hp2 : (() => {
                                                                            const p = notePositions.get(c.noteId2);
                                                                            return p ? applyOverlayShift(p, clef2, v2) : null;
                                                                        })();
                                                                        // For cross-system connections, we only require the in-system endpoint.
                                                                        const sys1 = noteToSystemIndexRef.current.get(c.noteId1);
                                                                        const sys2 = noteToSystemIndexRef.current.get(c.noteId2);
                                                                        const inThis1 = (sys1 === systemIndex) || systemNoteIdSet.has(c.noteId1);
                                                                        const inThis2 = (sys2 === systemIndex) || systemNoteIdSet.has(c.noteId2);

                                                                        const staffEndX = lastNonEmptyMeasureEndX ?? ((actualSystemWidth ?? 0) - STAFF_MARGIN);
                                                                        const staffStartX = Math.max(0, (system.startMeasuresX?.[0] ?? START_X) + 2);

                                                                        const isHovered = !!hoveredViolationNotes && (hoveredViolationNotes.includes(c.noteId1) || hoveredViolationNotes.includes(c.noteId2));
                                                                        const lvl = connectionLevel(c);

                                                                        // Same-system: draw the full connection.
                                                                        if (inThis1 && inThis2) {
                                                                            if (!q1 || !q2) return null;

                                                                            const x1 = c.type === 'vertical' ? (q1.x + q2.x) / 2 : q1.x;
                                                                            const x2 = c.type === 'vertical' ? (q1.x + q2.x) / 2 : q2.x;

                                                                            return (
                                                                                <line
                                                                                    key={`conn-${systemIndex}-${idx}-${c.noteId1}-${c.noteId2}`}
                                                                                    x1={x1}
                                                                                    y1={q1.y}
                                                                                    x2={x2}
                                                                                    y2={q2.y}
                                                                                    stroke={connectionStroke(lvl)}
                                                                                    strokeWidth={isHovered ? 3 : 2}
                                                                                    strokeLinecap="round"
                                                                                    strokeDasharray="5 4"
                                                                                    opacity={0.9}
                                                                                />
                                                                            );
                                                                        }

                                                                        // Cross-system: draw a split segment to the nearest system edge.
                                                                        const thisPoint = inThis1 ? q1 : (inThis2 ? q2 : null);
                                                                        if (!thisPoint) return null;
                                                                        const thisId = inThis1 ? c.noteId1 : c.noteId2;
                                                                        const otherId = inThis1 ? c.noteId2 : c.noteId1;

                                                                        const tThis = noteTimeById.get(thisId);
                                                                        const tOther = noteTimeById.get(otherId);
                                                                        let forward = true;
                                                                        if (typeof tThis === 'number' && typeof tOther === 'number') {
                                                                            forward = tThis <= tOther;
                                                                        } else {
                                                                            const otherSys = inThis1 ? sys2 : sys1;
                                                                            forward = (typeof otherSys === 'number') ? (otherSys > systemIndex) : true;
                                                                        }
                                                                        const toX = forward ? staffEndX : staffStartX;

                                                                        return (
                                                                            <line
                                                                                key={`conn-split-${systemIndex}-${idx}-${c.noteId1}-${c.noteId2}`}
                                                                                x1={thisPoint.x}
                                                                                y1={thisPoint.y}
                                                                                x2={toX}
                                                                                y2={thisPoint.y}
                                                                                stroke={connectionStroke(lvl)}
                                                                                strokeWidth={isHovered ? 3 : 2}
                                                                                strokeLinecap="round"
                                                                                strokeDasharray="5 4"
                                                                                opacity={0.9}
                                                                            />
                                                                        );
                                                                    });
                                                                })()}

                                                                    {/* Passing-note overlays: horizontal line from previous chord to passing note + 'p' label */}
                                                                    {/* Ornament overlays: compact marker for nota di volta (neighbor) */}
                                                                    {(() => {
                                                                        if (!isAnalysisEnabled) return null;
                                                                        if (!analyzedNotes || analyzedNotes.length === 0) return null;
                                                                        const systemNoteIdSet = new Set(systemNotes.map(n => n.id));

                                                                        const hitPoints = systemNoteHitPointsRef.current[systemIndex] || [];
                                                                        const hitPointById = new Map(hitPoints.filter(p => !p.isGhost).map(p => [p.id, { x: p.x, y: p.y }]));

                                                                        const applyOverlayShift = (p: { x: number; y: number }, clef: ClefType, voice: Voice) => {
                                                                            if (staffSystemMode === 'satb_ancient') return p;
                                                                            if (clef === 'bass') {
                                                                                return {
                                                                                    x: p.x + OVERLAY_BASS_X_SHIFT_PX,
                                                                                    y: p.y + OVERLAY_BASS_Y_SHIFT_PX,
                                                                                };
                                                                            }
                                                                            return {
                                                                                x: p.x + OVERLAY_TREBLE_X_SHIFT_PX,
                                                                                y: p.y + OVERLAY_TREBLE_Y_SHIFT_PX + (voice === 2 ? OVERLAY_TREBLE_VOICE2_Y_ADJUST_PX : 0),
                                                                            };
                                                                        };

                                                                        const results: JSX.Element[] = [];
                                                                        const displayOrnamentText = (n: any): string | null => {
                                                                            const noteAbsBeat = (() => {
                                                                                try {
                                                                                    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                                                                                    return ((n?.measureIndex ?? 0) * beatsPerMeasure) + (((n?.beat ?? 1) - 1));
                                                                                } catch {
                                                                                    return null;
                                                                                }
                                                                            })();
                                                                            const susp = n?.isSuspension;
                                                                            const isTrueSuspensionOnset = !!(
                                                                                susp &&
                                                                                String(susp.type || '') !== 'app' &&
                                                                                !susp.continuation &&
                                                                                typeof susp.fromAbsBeat === 'number' &&
                                                                                typeof noteAbsBeat === 'number' &&
                                                                                Math.abs(susp.fromAbsBeat - noteAbsBeat) < 1e-6
                                                                            );
                                                                            if (isTrueSuspensionOnset || n?.ornamentOverride === 'suspension') return 'R';
                                                                            if (n?.isCambiata || n?.ornamentOverride === 'cambiata') return 'C';
                                                                            if (n?.isAppoggiatura || n?.ornamentOverride === 'appoggiatura') return 'A';
                                                                            if (n?.isAnticipation || n?.ornamentOverride === 'anticipation') return 'Ant';
                                                                            if (n?.isEscape || n?.ornamentOverride === 'escape') return 'S';
                                                                            if (n?.isPassing || n?.ornamentOverride === 'passing') return 'P';
                                                                            if (n?.isNeighbor || n?.ornamentOverride === 'neighbor') return 'V';
                                                                            const mark = String(n?.ornamentMark || '').trim();
                                                                            if (!mark) return null;
                                                                            if (mark === 'r') return 'R';
                                                                            if (mark === 'a') return 'A';
                                                                            if (mark === 's') return 'S';
                                                                            if (mark === 'v') return 'V';
                                                                            if (mark === 'ant') return 'Ant';
                                                                            return mark;
                                                                        };
                                                                        const getOrnamentLabelPosition = (anchor: { x: number; y: number }, clef: ClefType, voice: Voice, text: string) => {
                                                                            const textWidth = Math.max(12, measureTextWidth(text, `700 ${ORNAMENT_LABEL_FONT_SIZE_PX}px serif`));
                                                                            const voiceDir = voice === 2 || voice === 4 ? -1 : 1;
                                                                            const xOffset = (Math.max(10, Math.min(18, textWidth * 0.45)) + (text.length > 1 ? 4 : 0)) * voiceDir;
                                                                            const yOffset = clef === 'bass' ? -20 : -18;

                                                                            return {
                                                                                x: anchor.x + xOffset,
                                                                                y: anchor.y + yOffset,
                                                                                lineX: anchor.x,
                                                                                lineY: anchor.y,
                                                                            };
                                                                        };
                                                                        for (const n of analyzedNotes as any[]) {
                                                                            if (!n || !n.id) continue;
                                                                            if (!systemNoteIdSet.has(n.id)) continue;
                                                                            if (lockHides.ornaments) continue;
                                                                            const text = displayOrnamentText(n);
                                                                            if (!text) continue;

                                                                            const hp = hitPointById.get(n.id);
                                                                            const pPos = notePositions.get(n.id);
                                                                            if (!hp && !pPos) continue;
                                                                            const clef = (noteClefById.get(n.id) || 'treble') as ClefType;
                                                                            const voiceNum = (noteVoiceById.get(n.id) || 1) as Voice;
                                                                            // Always keep the original note position for the leader line
                                                                            const notePos = hp ? hp : { x: (pPos as any).x, y: (pPos as any).y };
                                                                            let markerPos = { ...notePos };
                                                                            // Apply per-voice offset in both grandstaff and satb_ancient, with different strengths
                                                                            if (staffSystemMode === 'satb_ancient') {
                                                                                if (voiceNum === 1) { markerPos = { x: notePos.x - 5, y: notePos.y + 5 }; }
                                                                                else if (voiceNum === 2) { markerPos = { x: notePos.x + 4, y: notePos.y + 5 }; }
                                                                                else if (voiceNum === 3) { markerPos = { x: notePos.x - 5, y: notePos.y + 5 }; }
                                                                                else if (voiceNum === 4) { markerPos = { x: notePos.x + 4, y: notePos.y - 4 }; }
                                                                            } else if (staffSystemMode === 'grandstaff') {
                                                                                if (voiceNum === 1) { markerPos = { x: notePos.x - 10, y: notePos.y + 6 }; }
                                                                                else if (voiceNum === 2) { markerPos = { x: notePos.x + 10, y: notePos.y + 6 }; }
                                                                                else if (voiceNum === 3) { markerPos = { x: notePos.x - 10, y: notePos.y + 6 }; }
                                                                                else if (voiceNum === 4) { markerPos = { x: notePos.x + 10, y: notePos.y - 6 }; }
                                                                            }
                                                                            const labelPos = getOrnamentLabelPosition(markerPos, clef, voiceNum, text);

                                                                            results.push(
                                                                                <g key={`orn-${n.id}`}>
                                                                                    <line
                                                                                        x1={notePos.x}
                                                                                        y1={notePos.y}
                                                                                        x2={labelPos.x}
                                                                                        y2={labelPos.y}
                                                                                        stroke={ORNAMENT_LABEL_LEADER_STROKE}
                                                                                        strokeWidth={0.75}
                                                                                        strokeLinecap="round"
                                                                                        opacity={0.9}
                                                                                    />
                                                                                    <text
                                                                                        x={labelPos.x}
                                                                                        y={labelPos.y}
                                                                                        textAnchor="middle"
                                                                                        dominantBaseline="middle"
                                                                                        fontSize={ORNAMENT_LABEL_FONT_SIZE_PX}
                                                                                        fontStyle="italic"
                                                                                        fontWeight={400}
                                                                                        fill="#1e40af"
                                                                                        stroke="#ffffff"
                                                                                        strokeWidth={3}
                                                                                        paintOrder="stroke"
                                                                                        opacity={0.96}
                                                                                    >
                                                                                        {text}
                                                                                    </text>
                                                                                </g>
                                                                            );
                                                                        }

                                                                        return results;
                                                                    })()}
                                                                    {(() => {
                                                                        if (!analyzedNotes || analyzedNotes.length === 0) return null;
                                                                        const systemNoteIdSet = new Set(systemNotes.map(n => n.id));

                                                                        const hitPoints = systemNoteHitPointsRef.current[systemIndex] || [];
                                                                        const hitPointById = new Map(hitPoints.filter(p => !p.isGhost).map(p => [p.id, { x: p.x, y: p.y }]));
                                                                        const getOverlayX = (noteId: string): number | null => {
                                                                            const hp = hitPointById.get(noteId);
                                                                            if (hp) return hp.x;
                                                                            const p = notePositions.get(noteId);
                                                                            return p ? p.x : null;
                                                                        };
                                                                        const byVoice = new Map<number, typeof analyzedNotes>();
                                                                        for (const n of analyzedNotes) {
                                                                            const v = n.voice || 1;
                                                                            if (!byVoice.has(v)) byVoice.set(v, [] as any);
                                                                            byVoice.get(v)!.push(n);
                                                                        }

                                                                        // Sort each voice by measureIndex then beat (fallback to 0)
                                                                        for (const [v, arr] of Array.from(byVoice.entries())) {
                                                                            arr.sort((a: any, b: any) => {
                                                                                const ma = (a.measureIndex ?? 0) * 1000 + (a.beat ?? 0);
                                                                                const mb = (b.measureIndex ?? 0) * 1000 + (b.beat ?? 0);
                                                                                return ma - mb;
                                                                            });
                                                                        }

                                                                        const results: JSX.Element[] = [];

                                                                        const applyOverlayShift = (p: { x: number; y: number }, clef: ClefType, voice: Voice) => {
                                                                            if (staffSystemMode === 'satb_ancient') return p;
                                                                            if (clef === 'bass') {
                                                                                return {
                                                                                    x: p.x + OVERLAY_BASS_X_SHIFT_PX,
                                                                                    y: p.y + OVERLAY_BASS_Y_SHIFT_PX,
                                                                                };
                                                                            }
                                                                            return {
                                                                                x: p.x + OVERLAY_TREBLE_X_SHIFT_PX,
                                                                                y: p.y + OVERLAY_TREBLE_Y_SHIFT_PX + (voice === 2 ? OVERLAY_TREBLE_VOICE2_Y_ADJUST_PX : 0),
                                                                            };
                                                                        };

                                                                        for (const [v, arr] of Array.from(byVoice.entries())) {
                                                                            for (let i = 0; i < arr.length; i++) {
                                                                                const cur = arr[i] as any;
                                                                                // Render passing overlay only if the passing note is part of this system
                                                                                if (!systemNoteIdSet.has(cur.id)) continue;
                                                                                if (!cur.isPassing) continue;
                                                                                const prev = arr[i - 1] as any | undefined;
                                                                                if (!prev) continue;

                                                                                const hpCur = hitPointById.get(cur.id);
                                                                                const pPos = notePositions.get(cur.id);
                                                                                if (!hpCur && !pPos) continue;

                                                                                // Compute previous chord center X. Prefer chordId grouping if present.
                                                                                let prevCenterX: number | null = null;
                                                                                if (prev.chordId) {
                                                                                    const chordNotes = analyzedNotes.filter(n => n.chordId === prev.chordId);
                                                                                    const xs: number[] = chordNotes.map(n => getOverlayX(n.id)).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
                                                                                    if (xs.length) prevCenterX = xs.reduce((a, b) => a + b, 0) / xs.length;
                                                                                }
                                                                                if (prevCenterX === null) {
                                                                                    // Fallback: same measureIndex/beat
                                                                                    const sameBeat = analyzedNotes.filter(n => (n.measureIndex === prev.measureIndex) && (n.beat === prev.beat));
                                                                                    const xs = sameBeat.map(n => getOverlayX(n.id)).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
                                                                                    if (xs.length) prevCenterX = xs.reduce((a, b) => a + b, 0) / xs.length;
                                                                                }
                                                                                if (prevCenterX === null) {
                                                                                    const xPrev = getOverlayX(prev.id);
                                                                                    if (xPrev != null) prevCenterX = xPrev;
                                                                                }

                                                                                // More robust: compute previous chord center by matching positionedNotes' start time
                                                                                try {
                                                                                    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                                                                                    const prevStart = (prev.measureIndex ?? 0) * beatsPerMeasure + ((prev.beat ?? 1) - 1);
                                                                                    const sameStartNotes = (layoutData.positionedNotes || []).filter(n => {
                                                                                        if (n.isRest) return false;
                                                                                        const nStart = (n.measureIndex ?? 0) * beatsPerMeasure + ((n.beat ?? 1) - 1);
                                                                                        return Math.abs(nStart - prevStart) < 1e-6;
                                                                                    });
                                                                                    if (sameStartNotes.length) {
                                                                                        const xs = sameStartNotes.map(n => n.xPosition ?? 0).filter(x => Number.isFinite(x));
                                                                                        if (xs.length) {
                                                                                            const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
                                                                                            prevCenterX = avg;
                                                                                        }
                                                                                    }
                                                                                } catch (_) {}
                                                                                if (prevCenterX === null) continue;

                                                                                const clef = noteClefById.get(cur.id) || 'treble';
                                                                                const voiceNum = noteVoiceById.get(cur.id) || 1;
                                                                                const q = hpCur ? hpCur : applyOverlayShift(pPos as any, clef, voiceNum as Voice);
                                                                                    // Ensure the passing-line does not overlap the roman/figures area
                                                                                    // Prefer anchoring the start of the passing line to the right edge
                                                                                    // of the roman/figures area (if present). Fall back to prev chord center.
                                                                                    let startX: number | null = null;
                                                                                    try {
                                                                                        const labels = systemHarmonyLabels || [];
                                                                                        if (labels.length) {
                                                                                            // find the label closest to prevCenterX
                                                                                            let best: any = null;
                                                                                            let bestDist = Infinity;
                                                                                            for (const lbl of labels) {
                                                                                                const dx = Math.abs((lbl as any).x - (prevCenterX as number));
                                                                                                if (dx < bestDist) {
                                                                                                    bestDist = dx;
                                                                                                    best = lbl;
                                                                                                }
                                                                                            }
                                                                                            if (best && bestDist <= 60) {
                                                                                                const RB_SHIFT_X = 25;
                                                                                                const romanFont = '700 14px serif';
                                                                                                const refW = measureTextWidth('V', romanFont);
                                                                                                const paddingAfterRoman = 8;
                                                                                                const romanText = (best as any).roman || '';
                                                                                                const romanW = measureTextWidth(romanText, romanFont);
                                                                                                const baseX = (best as any).x + RB_SHIFT_X - refW;
                                                                                                startX = baseX + romanW + 6 + paddingAfterRoman;
                                                                                            }
                                                                                        }
                                                                                    } catch (_) { startX = null; }

                                                                                    if (startX === null) startX = prevCenterX;

                                                                                    // Position passing line below the lower staff (under the bass)
                                                                                    const bassBottomLineY = (staffSystemMode === 'satb_ancient')
                                                                                        ? (VF_SATB_BASS_Y + 4 * VF_LINE_SPACING)
                                                                                        : (VF_BASS_Y + 4 * VF_LINE_SPACING);
                                                                                    const PASS_LINE_OFFSET_PX = 52; // distance below the bottom staff (moved down ~40px)
                                                                                    const lineY = bassBottomLineY + PASS_LINE_OFFSET_PX;

                                                                                    results.push(
                                                                                        <g key={`passing-${cur.id}`}>
                                                                                            <line
                                                                                                x1={startX}
                                                                                                y1={lineY}
                                                                                                x2={q.x - 7}
                                                                                                y2={lineY}
                                                                                                stroke="#111827"
                                                                                                strokeWidth={1}
                                                                                                strokeLinecap="butt"
                                                                                            />
                                                                                            <text
                                                                                                x={q.x} // end of line (x2)
                                                                                                y={lineY}
                                                                                                textAnchor="middle"
                                                                                                dominantBaseline="middle"
                                                                                                fontSize={10}
                                                                                                fontWeight={500}
                                                                                                fill="black"
                                                                                                opacity={0.7}
                                                                                            >
                                                                                                P
                                                                                            </text>
                                                                                        </g>
                                                                                    );
                                                                            }
                                                                        }

                                                                        return results;
                                                                    })()}
                              </svg>
                            )}
                          </div>
                        );
                        })}
                    </div>
                </div>

                </div>
            </div>

                {/* Restore analysis panel */}
                {activeTab === 'analysis' && (
                    <div className="w-full max-w-sm flex-shrink-0 h-full min-h-0">
                        {lockHides.violations ? (
                            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-2 p-6">
                                <span className="text-4xl">🔒</span>
                                <p className="font-semibold text-sm">Analisi bloccata dal docente</p>
                                <p className="text-xs">Sblocca tramite File → Sblocca analisi…</p>
                            </div>
                        ) : isAnalysisEnabled ? (
                            <HarmonyAnalysisPanel
                                violations={violations}
                                sequenceMatches={sequenceMatches}
                                sequencesEnabled={isSequencesEnabled}
                                onToggleSequences={() => setIsSequencesEnabled(prev => !prev)}
                                onHoverViolation={setHoveredViolationNotes}
                                selectedViolationIndex={selectedViolationIndex}
                                onSelectViolation={index => {
                                    setSelectedViolationIndex(prev => {
                                        if (prev === index) {
                                            // Second click on same violation → collapse / deselect
                                            setSelectedNoteIds(new Set());
                                            return null;
                                        }
                                        if (index != null && violations[index]) {
                                            setSelectedNoteIds(new Set(violations[index].noteIds));
                                        }
                                        if (typeof index === 'number') scrollScoreToViolationIndex(index);
                                        return index;
                                    });
                                }}
                            />
                        ) : (
                            <div className="bg-gray-800/50 rounded-lg p-3 h-full min-h-0 overflow-y-auto flex items-center justify-center text-center text-gray-400">
                                <div>
                                    <p className="font-semibold">L'analisi armonica è disattivata.</p>
                                    <p className="text-sm mt-1">Attivala per vedere gli errori.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <HarmonyLabelExplainModal
                isOpen={isExplainOpen}
                onClose={closeExplain}
                data={explainData}
                onApplyAlternative={(alt, absBeat) => {
                    handleApplyTonicizationHint(absBeat, alt.impliedTonic, alt.isMinor);
                }}
            />

            {contextMenu && (
                <ModulationContextMenu
                    menuData={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onApply={handleApplyContext}
                    onApplyTextMarker={handleApplyContextLabelOnly}
                    onRemove={handleRemoveContext}
                    onDeleteMeasure={deleteMeasureAtIndex}
                    onToggleRepeatBarline={(measureIndex, type) => {
                        setRepeatBarlines(prev => {
                            const next = { ...prev };
                            // repeat-begin: the barline appears at the LEFT edge of the target
                            // measure, which is the RIGHT edge of (measureIndex - 1).
                            // repeat-end: barline at the RIGHT edge of the target measure.
                            // repeat-both: barline at the RIGHT edge (ends here, begins next).
                            const targetM = type === 'repeat-begin' ? Math.max(0, measureIndex - 1) : measureIndex;
                            if (next[targetM] === type) delete next[targetM];
                            else next[targetM] = type;
                            return next;
                        });
                    }}
                    onApplyTimeSignature={handleApplyTimeSignatureChange}
                    onRemoveTimeSignature={handleRemoveTimeSignatureChange}
                    existingHarmonyOverride={existingHarmonyOverrideForMenu}
                    onApplyHarmonyOverride={applyHarmonyOverride}
                    onRemoveHarmonyOverride={removeHarmonyOverride}
                    existingTonicizationHint={existingTonicizationHintForMenu}
                    onRemoveTonicizationHint={handleRemoveTonicizationHint}
                    inferredTonicAtBeat={contextMenu.inferredTonicAtBeat}
                    hasSuppressedInference={existingSuppressionForMenu}
                    onSuppressInference={handleSuppressInference}
                    onUnsuppressInference={handleUnsuppressInference}
                    initialKey={(() => {
                        if (!existingContextForMenu) return keySignatureRoot;
                        if (!existingContextForMenu.newIsMinor) return existingContextForMenu.newTonic;
                        // Invert relativeMinors to get the major key signature root.
                        const inverse = Object.entries(relativeMinors).reduce<Record<string, string>>((acc, [maj, min]) => {
                            acc[min] = maj;
                            return acc;
                        }, {});
                        return inverse[existingContextForMenu.newTonic] || existingContextForMenu.newTonic;
                    })()}
                    initialIsMinor={existingContextForMenu ? existingContextForMenu.newIsMinor : isMinorMode}
                    initialLabel={existingContextForMenu?.label || ''}
                    initialTimeSignature={existingTimeSignatureChangeForMenu ? { numerator: existingTimeSignatureChangeForMenu.numerator, denominator: existingTimeSignatureChangeForMenu.denominator } : timeSignature}
                    selectedNoteCount={selectedNoteIds.size}
                    onApplyOrnamentOverride={handleApplyOrnamentOverride}
                    onRemoveOrnamentOverride={handleRemoveOrnamentOverride}
                    hasExistingOrnamentOverride={hasExistingOrnamentOverride}
                    onMoveToTreble={() => handleMoveToStaff('treble')}
                    onMoveToBass={() => handleMoveToStaff('bass')}
                    onResetStaff={() => handleMoveToStaff(null)}
                />
            )}

            {harmonyOverrideMenu && (
                <HarmonyOverrideContextMenu
                    menuData={harmonyOverrideMenu}
                    existing={existingHarmonyOverrideForMenu}
                    onClose={() => setHarmonyOverrideMenu(null)}
                    onApply={(absBeat, roman, figures, symbol) => {
                        applyHarmonyOverride(absBeat, roman, figures, symbol);
                        setHarmonyOverrideMenu(null);
                    }}
                    onRemove={(absBeat) => {
                        removeHarmonyOverride(absBeat);
                        setHarmonyOverrideMenu(null);
                    }}
                />
            )}
            {pasteMarkerPos && (
                <div style={{ position: 'absolute', left: pasteMarkerPos.x - 8, top: pasteMarkerPos.y - 14, pointerEvents: 'none', zIndex: 9999 }}>
                    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 0 L16 12 L0 12 Z" fill="#06b6d4" opacity="0.95" />
                    </svg>
                </div>
            )}

            {copyPasteError && (
                <div style={{ position: 'fixed', bottom: 16, right: 16, background: '#c00', color: '#fff', padding: '8px 16px', borderRadius: 8, zIndex: 9999 }}>
                    {copyPasteError}
                    <button style={{ marginLeft: 8 }} onClick={() => setCopyPasteError(null)}>Chiudi</button>
                </div>
            )}
        </div>
    );
};
export default GrandStaffEditor;
