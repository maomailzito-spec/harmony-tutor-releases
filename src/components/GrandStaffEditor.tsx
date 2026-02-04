import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowUturnLeftIcon, PauseIcon as PauseSolidIcon, PlayIcon as PlaySolidIcon } from '@heroicons/react/24/solid';
import { StaffNote, KeySignature, NoteDuration, TimeSignature, Barline, ClefType, Voice, HarmonyAnalysisResult, ErrorConnection, AccidentalType, AnalysisContext, HarmonyLabelOverride, TimeSignatureChange } from '../types';
import { AudioService } from '../services/AudioService';
import { 
    WholeNoteIcon, HalfNoteIcon, QuarterNoteIcon, EighthNoteIcon, SixteenthNoteIcon, ThirtySecondNoteIcon, SixtyFourthNoteIcon,
    WholeRestIcon, HalfRestIcon, QuarterRestIcon, EighthRestIcon, SixteenthRestIcon, ThirtySecondRestIcon, SixtyFourthRestIcon,
    TripletIcon, SharpIcon, FlatIcon, NaturalIcon, DoubleSharpIcon, DoubleFlatIcon, TieIcon, DotIcon
} from './icons/NoteValueIcons';
import { CycleIcon } from './icons/CycleIcon';
import { useUndoableState } from '../hooks/useUndoableState';
import { applyHarmonyRules, getKeySignature, calculateNoteBeats, getRomanAnalysis, getRomanAnalysisDebugSnapshot, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS, getNotePropertiesFromDiatonicPosition, getNotePropertiesFromMidi, getChordSymbol, calculateAccidental, getActiveNotesTimeline, identifyChordCandidates, calculateRomanFromChordInfo, ticksToBeats, beatsToTicks, rebuildMeasureTimelineForVoice, normalizeNotePitchFieldsWithKey } from '../utils/musicTheory';
import { detectVoiceLeadingSequences } from '../utils/sequenceDetector';
import { computeHarmonyLabelsBySystem } from '../utils/computeHarmonyLabelsBySystem';
import HarmonyAnalysisPanel from './HarmonyAnalysisPanel';
import { NOTE_NAMES, DURATION_VALUES, ALL_NOTE_SPELLINGS, CHORD_FORMULAS, TICKS_PER_QUARTER, DEFAULT_PX_PER_TICK } from '../constants';
import { GroupIcon } from './icons/GroupIcon';
import { UngroupIcon } from './icons/UngroupIcon';
import { FlipStemIcon } from './icons/FlipStemIcon';
import VexflowGrandStaff from './VexflowGrandStaff';
import PreferencesModal from './PreferencesModal';
import HarmonyLabelExplainModal, { type HarmonyExplainData } from './HarmonyLabelExplainModal';

import type { MenuAction, MenuActionPayloadMap } from '../../shared/menuActionRegistry';
import { MENU_ACTIONS } from '../contracts/menuActionRuntime';
import { getMenuActionTarget } from '../contracts/menuActionTargets';
import { usePreference } from '../preferences/usePreference';
import { useMenuStateSync } from '../controllers/useMenuStateSync';

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

const LINE_HEIGHT = 12;
const STAFF_LINES_HEIGHT = 4 * LINE_HEIGHT;

const TOP_STAFF_HEIGHT = 100;
const TOP_STAFF_TOP = 30;
const BOTTOM_STAFF_HEIGHT = 180;
const BOTTOM_STAFF_TOP = 20;
const CONNECTOR_HEIGHT = 40;
const TOTAL_SYSTEM_HEIGHT = TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_HEIGHT;

// VexFlow stave geometry (must match values in VexflowGrandStaff.tsx)
// Used for cursor->pitch mapping so the ghost note aligns with the pointer.
const VF_TREBLE_Y = 40;
const VF_BASS_Y = 140;
const VF_LINE_SPACING = 10;

// SATB (chiavi antiche): soprano (C1), alto (C3), tenore (C4), basso (F4)
// Must match values in VexflowGrandStaff.tsx
const VF_SATB_SOPRANO_Y = 40;
const VF_SATB_ALTO_Y = 140;
const VF_SATB_TENOR_Y = 240;
const VF_SATB_BASS_Y = 340;
// Extra bottom space in SATB mode so very low bass notes (e.g. C below the staff)
// remain fully visible and insertable. This must not affect pitch mapping.
const VF_SATB_BASS_EXTRA_BOTTOM_PX = 100;
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

const MetronomeIcon = () => <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3L4 21h16L12 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6" /></svg>;
const TOOLBAR_ICON_CLASS = 'h-5 w-5';


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

const NOTE_HEAD_RX_NORMAL = 6.3;
const NOTE_HEAD_RY_NORMAL = 4.725;
const ACCIDENTAL_OFFSET_NORMAL = -20;

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
    | 'insert'
    | 'accidentals'
    | 'notations'
    | 'analysis'
    | 'more';

const DEFAULT_TOOLBAR_ORDER: ToolbarGroupId[] = [
    'playback',
    'bpm',
    'key',
    'time',
    'measures',
    'voices',
    'insert',
    'accidentals',
    'notations',
    'analysis',
    'more',
];
const DEFAULT_TOOLBAR_VISIBILITY: Record<ToolbarGroupId, boolean> = {
    playback: true,
    bpm: true,
    key: true,
    time: true,
    measures: true,
    voices: true,
    insert: true,
    accidentals: true,
    notations: true,
    analysis: true,
    more: true,
};
const TOOLBAR_GROUP_LABEL: Record<ToolbarGroupId, string> = {
    playback: 'Play',
    bpm: 'BPM',
    key: 'Tonalità',
    time: 'Tempo',
    measures: 'Misure',
    voices: 'Voci',
    insert: 'Inserimento',
    accidentals: 'Accidenti',
    notations: 'Notazione',
    analysis: 'Analisi',
    more: 'Menu',
};

const getChordNoteheadOffsetsById = (chord: StaffNote[], noteHeadRx: number, isStemUp: boolean): Map<string, number> => {
    const offsets = new Map<string, number>();
    if (chord.length < 2) return offsets;

    // Shift exactly one note-width to have them touching
    const shift = noteHeadRx * 2.0;

    let clusterStart = 0;
    while (clusterStart < chord.length) {
        // Find end of current cluster of seconds
        let clusterEnd = clusterStart;
        while (clusterEnd < chord.length - 1 && chord[clusterEnd+1].position - chord[clusterEnd].position === 1) {
            clusterEnd++;
        }

        // Process cluster
        if (clusterEnd > clusterStart) {
            if (isStemUp) {
                // STEM UP: Stem is on Right. Highest note (clusterEnd) should be aligned with stem (offset 0).
                // Lower notes alternate left.
                for (let i = clusterEnd; i >= clusterStart; i--) {
                    const distance = clusterEnd - i;
                    // If distance is odd (1st below top, 3rd below top...), move Left
                    if (distance % 2 !== 0) {
                        offsets.set(chord[i].id, -shift);
                    }
                    // Else stays at 0 (Right)
                }
            } else {
                // STEM DOWN: Stem is on Left. Lowest note (clusterStart) should be aligned with stem (offset 0).
                // Higher notes alternate right.
                for (let i = clusterStart; i <= clusterEnd; i++) {
                    const distance = i - clusterStart;
                    // If distance is odd (1st above bottom, 3rd above bottom...), move Right
                    if (distance % 2 !== 0) {
                        offsets.set(chord[i].id, shift);
                    }
                    // Else stays at 0 (Left)
                }
            }
        }
        clusterStart = clusterEnd + 1;
    }
    return offsets;
};

const GrandStaffBrace: React.FC<{ height: number }> = ({ height }) => (
    <svg width="20" height={height} viewBox={`0 0 20 ${height}`} preserveAspectRatio="none" className="absolute left-0 top-0 z-10" style={{ pointerEvents: 'none' }}>
        <path d="M15 25 Q 0 25, 5 45 L 5 114 Q 5 119, 0 119 Q 5 119, 5 124 L 5 193 Q 0 213, 15 213" fill="none" stroke="black" strokeWidth="2" />
    </svg>
);


// Professional Engraved Style Rests
const Rest: React.FC<{ duration: NoteDuration, y: number, color: string, x: number, staffTop: number }> = ({ duration, y, color, x, staffTop }) => {
    const spaceHeight = LINE_HEIGHT;
    const halfSpace = LINE_HEIGHT / 2;
    const baseTransform = `translate(${x}, ${staffTop + 2 * spaceHeight}) scale(1.1)`;

    switch (duration) {
        case 'whole': 
            return <rect x={x - (halfSpace + 2)} y={staffTop + spaceHeight} width={spaceHeight + 4} height={halfSpace} fill={color} />;
        
        case 'half': 
            return <rect x={x - (halfSpace + 2)} y={staffTop + (2 * spaceHeight) - halfSpace} width={spaceHeight + 4} height={halfSpace} fill={color} />;
        
        case 'quarter': 
            return (
                <g transform={`translate(${x}, ${staffTop + 2 * spaceHeight}) scale(1.1)`}>
                    <path 
                        d="M-2.5,-9.5 C-4,-7.5 -4.5,-5.5 -3.5,-3.5 C-2.5,-1.5 -1,-1 0.5,0.5 L1.5,1.5 C2.5,2.5 3,3.5 2.5,5 C2,6.5 0.5,8 -1,9 L-1.5,9.5 C-2.5,10.5 -2.5,12 -1.5,13 C-0.5,14 1,14 2,13 C3,12 3.5,10.5 3,9 C2.5,8 2,7.5 1.5,7 C1,6.5 0.5,6 0.5,5.5 C0.5,5 1,4.5 2,3.5 C3,2.5 4,1 4,-1 C4,-3 3,-5 1,-6.5 L-0.5,-7.5 C-1.5,-8.5 -1.5,-9 -1,-9.5 L2,-13 L1,-14 L-2.5,-9.5 Z"
                        fill={color} 
                        stroke="none"
                    />
                </g>
            );
        
        case 'sixteenth': {
            const head1 = "M-7,-8 C-11,-8 -12,-5 -10,-2 C-8,1 -4,2 -2,0 C0,-2 0,-5 -3,-7 Z";
            const head2 = "M-7,-1 C-11,-1 -12,2 -10,5 C-8,8 -4,9 -2,7 C0,5 0,2 -3,0 Z";
            const stem = "M-2,-9 L10,26 L8,26 L-4,-9 Z";
            return (
                <g transform={baseTransform}>
                    <path d={`${stem} ${head1} ${head2}`} fill={color} />
                </g>
            );
        }
        
        case 'thirty-second': {
            const head1 = "M-7,-12 C-11,-12 -12,-9 -10,-6 C-8,-3 -4,-2 -2,-4 C0,-6 0,-9 -3,-11 Z";
            const head2 = "M-7,-5 C-11,-5 -12,-2 -10,1 C-8,4 -4,5 -2,3 C0,1 0,-2 -3,-4 Z";
            const head3 = "M-7,2 C-11,2 -12,5 -10,8 C-8,11 -4,12 -2,10 C0,8 0,5 -3,3 Z";
            const stem = "M-2,-13 L10,30 L8,30 L-4,-13 Z";
            return (
                <g transform={baseTransform}>
                    <path d={`${stem} ${head1} ${head2} ${head3}`} fill={color} />
                </g>
            );
        }

        case 'sixty-fourth': {
            const head1 = "M-7,-16 C-11,-16 -12,-13 -10,-10 C-8,-7 -4,-6 -2,-8 C0,-10 0,-13 -3,-15 Z";
            const head2 = "M-7,-9 C-11,-9 -12,-6 -10,-3 C-8,0 -4,1 -2,-1 C0,-3 0,-6 -3,-8 Z";
            const head3 = "M-7,-2 C-11,-2 -12,1 -10,4 C-8,7 -4,8 -2,6 C0,4 0,1 -3,-1 Z";
            const head4 = "M-7,5 C-11,5 -12,8 -10,11 C-8,14 -4,15 -2,13 C0,11 0,8 -3,6 Z";
            const stem = "M-2,-17 L10,34 L8,34 L-4,-17 Z";
             return (
                <g transform={baseTransform}>
                    <path d={`${stem} ${head1} ${head2} ${head3} ${head4}`} fill={color} />
                </g>
            );
        }
            
        default: return null;
    }
};

const LedgerLines: React.FC<{ y: number, noteHeadRx: number, color: string, xOffset?: number, staffTop: number }> = ({ y, noteHeadRx, color, xOffset = 0, staffTop }) => {
    const lines = [];
    const topLineY = staffTop;
    if (y < topLineY) {
        for (let lineY = topLineY - LINE_HEIGHT; lineY >= y; lineY -= LINE_HEIGHT) {
            lines.push(<line key={`ledger-above-${lineY}`} x1={xOffset - noteHeadRx - 2} y1={lineY} x2={xOffset + noteHeadRx + 2} y2={lineY} stroke={color} strokeWidth="1" />);
        }
    }
    const bottomLineY = staffTop + 4 * LINE_HEIGHT;
    if (y > bottomLineY) {
        for (let lineY = bottomLineY + LINE_HEIGHT; lineY <= y; lineY += LINE_HEIGHT) {
            lines.push(<line key={`ledger-below-${lineY}`} x1={xOffset - noteHeadRx - 2} y1={lineY} x2={xOffset + noteHeadRx + 2} y2={lineY} stroke={color} strokeWidth="1" />);
        }
    }
    return <g>{lines}</g>;
};

const KEY_SIGNATURE_POSITIONS_TREBLE: Record<'sharp' | 'flat', { pitch: string, octave: number }[]> = {
    sharp: [ { pitch: 'F', octave: 5 }, { pitch: 'C', octave: 5 }, { pitch: 'G', octave: 5 }, { pitch: 'D', octave: 5 }, { pitch: 'A', octave: 4 }, { pitch: 'E', octave: 5 }, { pitch: 'B', octave: 4 } ],
    flat: [ { pitch: 'B', octave: 4 }, { pitch: 'E', octave: 5 }, { pitch: 'A', octave: 4 }, { pitch: 'D', octave: 5 }, { pitch: 'G', octave: 4 }, { pitch: 'C', octave: 5 }, { pitch: 'F', octave: 4 } ]
};
const KEY_SIGNATURE_POSITIONS_BASS: Record<'sharp' | 'flat', { pitch: string, octave: number }[]> = {
    sharp: [ { pitch: 'F', octave: 3 }, { pitch: 'C', octave: 3 }, { pitch: 'G', octave: 3 }, { pitch: 'D', octave: 3 }, { pitch: 'A', octave: 2 }, { pitch: 'E', octave: 3 }, { pitch: 'B', octave: 2 } ],
    flat: [ { pitch: 'B', octave: 2 }, { pitch: 'E', octave: 3 }, { pitch: 'A', octave: 2 }, { pitch: 'D', octave: 3 }, { pitch: 'G', octave: 2 }, { pitch: 'C', octave: 3 }, { pitch: 'F', octave: 2 } ]
};
const NOTE_POSITIONS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const VALID_DENOMINATORS = [2, 4, 8, 16];
const denominatorStepFn = (current: number, direction: 'up' | 'down') => {
    const currentIndex = VALID_DENOMINATORS.indexOf(current);
    if (direction === 'up') {
        return VALID_DENOMINATORS[Math.min(VALID_DENOMINATORS.length - 1, currentIndex + 1)];
    }
    return VALID_DENOMINATORS[Math.max(0, currentIndex - 1)];
};

const TimeSignatureControlNumber: React.FC<{
    value: number;
    onChange: (newValue: number) => void;
    min: number;
    max: number;
    stepFunction?: (current: number, direction: 'up' | 'down') => number;
}> = ({ value, onChange, min, max, stepFunction }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value.toString());
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const commitChange = (valStr: string) => {
        let val = parseInt(valStr, 10);
        if (!isNaN(val)) {
            val = Math.max(min, Math.min(max, val));
            onChange(val);
        }
        setIsEditing(false);
    };

    const step = (direction: 'up' | 'down') => {
        if (isEditing) return;
        if (stepFunction) {
            onChange(stepFunction(value, direction));
            return;
        }
        const delta = direction === 'up' ? 1 : -1;
        onChange(Math.max(min, Math.min(max, value + delta)));
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => commitChange(editValue)}
                onKeyDown={e => { if (e.key === 'Enter') commitChange(editValue); if (e.key === 'Escape') setIsEditing(false); }}
                className="w-full h-full text-center bg-gray-900 text-white font-serif text-xl p-0 border-0 outline-none"
            />
        );
    }

    return (
        <div className="w-full h-1/2 flex items-stretch">
            <button
                type="button"
                className="flex-1 flex items-center justify-center font-serif text-xl text-white"
                onClick={() => { setEditValue(value.toString()); setIsEditing(true); }}
            >
                {value}
            </button>

            <div className="w-5 flex flex-col border-l border-gray-600">
                <button
                    type="button"
                    className="h-1/2 text-[10px] leading-none text-white/80 hover:text-white"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); step('up'); }}
                    aria-label="Increment"
                >
                    ▲
                </button>
                <button
                    type="button"
                    className="h-1/2 text-[10px] leading-none text-white/80 hover:text-white"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); step('down'); }}
                    aria-label="Decrement"
                >
                    ▼
                </button>
            </div>
        </div>
    );
};

const TimeSignatureControl: React.FC<{ value: TimeSignature; onChange: (newValue: TimeSignature) => void; }> = ({ value, onChange }) => {
    const handleNumeratorChange = (newNum: number) => onChange({ ...value, numerator: newNum });
    const handleDenominatorChange = (newDenom: number) => onChange({ ...value, denominator: newDenom });
    
    return (
        <div className="flex flex-col items-center justify-center w-10 h-14 bg-gray-700 rounded-md text-white font-serif relative overflow-hidden divide-y divide-gray-600">
            <TimeSignatureControlNumber value={value.numerator} onChange={handleNumeratorChange} min={1} max={16} />
            <TimeSignatureControlNumber value={value.denominator} onChange={handleDenominatorChange} min={2} max={16} stepFunction={denominatorStepFn}/>
        </div>
    );
};

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

const GrandStaffEditor: React.FC<GrandStaffEditorProps> = ({
    isActive,
    audioService,
    isAudioReady,
    pendingMenuAction,
    onConsumePendingMenuAction,
}) => {
        const measureGridStepRef = useRef<Map<number, number>>(new Map());
    const [rawNotes, setRawNotes, undoNotes, redoNotes] = useUndoableState<StaffNote[]>([]);
    // Ref per avere sempre il valore aggiornato di rawNotes
    const latestRawNotes = useRef(rawNotes);

    // Mantieni latestRawNotes aggiornato
    useEffect(() => {
        latestRawNotes.current = rawNotes;
    }, [rawNotes]);
    // ...existing code...
    // Wrapper per il comando di copia
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    const [clipboard, setClipboard] = useState<StaffNote[] | null>(null);
    // Ref per clipboard aggiornata
    const latestClipboardRef = useRef<StaffNote[] | null>(clipboard);
    const pasteToSelectedVoiceRef = useRef(false);
    const skipPlayheadRefineOnceRef = useRef(false);
    useEffect(() => {
        latestClipboardRef.current = clipboard;
    }, [clipboard]);
    // Ref per avere sempre il valore aggiornato di selectedNoteIds
    const latestSelectedNoteIds = useRef(selectedNoteIds);
    useEffect(() => {
        latestSelectedNoteIds.current = selectedNoteIds;
    }, [selectedNoteIds]);
    // Wrapper per il comando di copia
    const handleCopy = useCallback(() => {
        const currentSelected = latestSelectedNoteIds.current;
        if (!currentSelected || currentSelected.size === 0) return;
        const selected = rawNotes.filter(n => currentSelected.has(n.id));
        // Copia profonda delle note selezionate
        const copied = selected.map(n => ({ ...n }));
        setClipboard(copied);
    }, [rawNotes, setClipboard]);
    
    
    const [copyPasteError, setCopyPasteError] = useState<string | null>(null);
    const [timeSignature, setTimeSignature] = useState<TimeSignature>({ numerator: 4, denominator: 4 });
    const [timeSignatureChanges, setTimeSignatureChanges] = useState<TimeSignatureChange[]>([]);
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
    const [measuresPerLineDraft, setMeasuresPerLineDraft] = useState<string>('4');
    const [doubleBarlineMeasures, setDoubleBarlineMeasures] = useState<number[]>([]);
    const [tool, setTool] = useState<Tool>('insert');
    const [selectedInsertion, setSelectedInsertion] = useState<InsertionElement>({ type: 'note', duration: 'quarter', isDotted: false });
    const isDotted = !!selectedInsertion.isDotted;

    // One-shot behavior knobs:
    // - If armed from HOTKEY: auto-disarm after the next insertion.
    // - If armed from TOOLBAR: persist until manually toggled off.
    const dottedOneShotRef = useRef<boolean>(false);
    const accidentalOneShotRef = useRef<boolean>(false);
    const [isTriplet, setIsTriplet] = useState(false);
    const [isDuplet, setIsDuplet] = useState(false);
    const [isSwing, setIsSwing] = useState(false);
    const [tupletNoteCount, setTupletNoteCount] = useState(0);
    const [tripletBaseDuration, setTripletBaseDuration] = useState<NoteDuration | null>(null);
    const [activeAccidental, setActiveAccidental] = useState<AccidentalType | null>(null);
    // Keyboard repeats / rapid double-presses can arrive before React state commits.
    // Keep an immediate ref so `bb` / `##` reliably becomes double-flat/double-sharp.
    const activeAccidentalRef = useRef<AccidentalType | null>(null);
    useEffect(() => { activeAccidentalRef.current = activeAccidental; }, [activeAccidental]);
    const [selectedVoice, setSelectedVoice] = useState<Voice>(1);
    const [activeTab, setActiveTab] = useState<ActiveTab>('editor');
    const [hoveredViolationNotes, setHoveredViolationNotes] = useState<string[] | null>(null);
    const [selectedViolationIndex, setSelectedViolationIndex] = useState<number | null>(null);
    const staffContainerRef = useRef<HTMLDivElement>(null);
    const scoreScrollRef = useRef<HTMLDivElement>(null);
    const systemElementByIndexRef = useRef<Map<number, HTMLDivElement>>(new Map());
    const measureToSystemIndexRef = useRef<Map<number, number>>(new Map());
    const noteToSystemIndexRef = useRef<Map<string, number>>(new Map());
    const [containerWidth, setContainerWidth] = useState(1000);
    const [isPlaying, setIsPlaying] = useState(false);
    const [bpm, setBpm] = useState(120);
    const [isBpmActive, setIsBpmActive] = useState(false);
    const isBpmActiveRef = useRef(isBpmActive);
    const bpmControlRef = useRef<HTMLDivElement>(null);
    const bpmInputRef = useRef<HTMLInputElement>(null);
    const [playingNoteIds, setPlayingNoteIds] = useState<string[]>([]);
    const [playheadPosition, setPlayheadPosition] = useState<{ x: number, systemIndex: number } | null>(null);
    const playbackCursorAbsBeatRef = useRef<number | null>(null);
    const playbackTimeoutsRef = useRef<number[]>([]);
    const playbackStartBeatRef = useRef<number>(0);
    const audioPlaybackStartTimeRef = useRef<number>(0);
    const animationFrameRef = useRef<number | null>(null);
    const [isMetronomeOn, setIsMetronomeOn] = useState(false);
    type MetronomeUnit = 'quarter' | 'eighth' | 'dotted-quarter';
    const [metronomeUnit, setMetronomeUnit] = useState<MetronomeUnit>('quarter');
    const [metronomeFlash, setMetronomeFlash] = useState<'strong' | 'weak' | null>(null);
    const [isLooping, setIsLooping] = useState(false);
    const [loopRange, setLoopRange] = useState<{ startBeat: number, endBeat: number } | null>(null);
    const [ghostNote, setGhostNote] = useState<(StaffNote & { systemIndex: number }) | null>(null);

    // Render-time note hit points from VexFlow, per system.
    // Used to make marquee selection deterministic and independent from clef/position approximations.
    const systemNoteHitPointsRef = useRef<Record<number, Array<{ id: string; x: number; y: number; isGhost: boolean }>>>({});

    // In insert mode, clicking directly on a rest should behave like a staff click
    // (i.e., overwrite that rest). We bridge note-click -> staff-click via this ref.
    const staffClickForInsertRef = useRef<null | ((x: number, y: number, systemIndex: number, e?: MouseEvent) => void)>(null);

    // Staff system mode:
    // - grandstaff: standard treble+bass system (chorale / piano style)
    // - treble_only: single treble staff (guitar-style; written pitches sound an octave lower)
    const [staffSystemMode, setStaffSystemMode] = usePreference<StaffSystemMode>('editor.staffSystemMode');

    // Staff layout (render-only mapping by voice):
    // - parti_late: S/A on treble, T/B on bass (current behavior)
    // - parti_strette: S/A/T on treble, B on bass
    const [staffLayoutMode, setStaffLayoutMode] = useState<StaffLayoutMode>('parti_late');

    const clefForVoice = useCallback((voice: number | undefined | null): ClefType => {
        if (staffSystemMode === 'treble_only') return 'treble';
        const v = voice ?? 1;
        if (staffSystemMode === 'satb_ancient') {
            if (v === 1) return 'soprano';
            if (v === 2) return 'alto';
            if (v === 3) return 'tenor';
            return 'bass';
        }
        if (staffLayoutMode === 'parti_strette') return v === 4 ? 'bass' : 'treble';
        return (v === 3 || v === 4) ? 'bass' : 'treble';
    }, [staffLayoutMode, staffSystemMode]);

    const playbackTransposeSemitones = staffSystemMode === 'treble_only' ? -12 : 0;

    const systemHeightPx = staffSystemMode === 'satb_ancient' ? VF_SATB_SYSTEM_HEIGHT : TOTAL_SYSTEM_HEIGHT;
    const playheadYTopPx = staffSystemMode === 'satb_ancient'
        ? (VF_SATB_SOPRANO_Y + PLAYHEAD_Y_OFFSET_PX - 3)
        : PLAYHEAD_Y_TOP;
    const playheadYBottomPx = staffSystemMode === 'satb_ancient'
        ? ((VF_SATB_BASS_Y + (4 * VF_LINE_SPACING)) + PLAYHEAD_Y_OFFSET_PX)
        : PLAYHEAD_Y_BOTTOM;

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
    const [analysisContexts, setAnalysisContexts] = useState<AnalysisContext[]>([]);
    const [harmonyOverrides, setHarmonyOverrides] = useState<HarmonyLabelOverride[]>([]);
    const latestHarmonyOverrides = useRef<HarmonyLabelOverride[]>([]);
    useEffect(() => { latestHarmonyOverrides.current = harmonyOverrides || []; }, [harmonyOverrides]);
    const [harmonyOverrideMenu, setHarmonyOverrideMenu] = useState<{ x: number; y: number; absBeat: number; measureIndex: number; beat: number } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; absBeat: number; measureIndex: number; beat: number } | null>(null);
    const [isAnalysisEnabled, setIsAnalysisEnabled] = useState(true);
    const [isSequencesEnabled, setIsSequencesEnabled] = usePreference<boolean>('analysis.sequencesEnabled');
    const [showRomanAnalysis, setShowRomanAnalysis] = usePreference<boolean>('analysis.showRomanAnalysis');
    const [showSymbolAnalysis, setShowSymbolAnalysis] = usePreference<boolean>('analysis.showSymbolAnalysis');
    const [showMeasureNumbers, setShowMeasureNumbers] = usePreference<boolean>('editor.showMeasureNumbers');

    const [isHarmonyExplainOpen, setIsHarmonyExplainOpen] = useState(false);
    const [harmonyExplainData, setHarmonyExplainData] = useState<HarmonyExplainData | null>(null);

    const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

    const [engravingMode, setEngravingMode] = usePreference<EngravingMode>('render.engravingMode');

    const [showVoiceColors, setShowVoiceColors] = usePreference<boolean>('editor.showVoiceColors');

    // Menu-driven toggles (Electron)
    const [showQuickInsertBar, setShowQuickInsertBar] = usePreference<boolean>('editor.showQuickInsertBar');
    const [showHarmonyDebug, setShowHarmonyDebug] = usePreference<boolean>('debug.showHarmonyDebug');
    const [toolbarPrefs, setToolbarPrefs] = usePreference<{ order: string[] }>('editor.toolbarPrefs');
    const toolbarGroupOrder = useMemo<ToolbarGroupId[]>(() => {
        try {
            const orderRaw: any[] = Array.isArray(toolbarPrefs?.order) ? toolbarPrefs.order : [];
            const all = new Set<ToolbarGroupId>(DEFAULT_TOOLBAR_ORDER);
            const cleanedOrder = orderRaw.filter((id: any): id is ToolbarGroupId => all.has(id));
            const fullOrder: ToolbarGroupId[] = Array.from(new Set([...cleanedOrder, ...DEFAULT_TOOLBAR_ORDER]));
            return fullOrder;
        } catch {
            return DEFAULT_TOOLBAR_ORDER;
        }
    }, [toolbarPrefs]);
    const setToolbarGroupOrder = useCallback((next: ToolbarGroupId[] | ((prev: ToolbarGroupId[]) => ToolbarGroupId[])) => {
        setToolbarPrefs(prev => {
            const prevRaw: any[] = Array.isArray(prev?.order) ? prev.order : [];
            const all = new Set<ToolbarGroupId>(DEFAULT_TOOLBAR_ORDER);
            const cleanedPrev = prevRaw.filter((id: any): id is ToolbarGroupId => all.has(id));
            const prevOrder: ToolbarGroupId[] = Array.from(new Set([...cleanedPrev, ...DEFAULT_TOOLBAR_ORDER]));
            const computed = (typeof next === 'function') ? (next as any)(prevOrder) : next;
            return { ...(prev || {}), order: computed };
        });
    }, [setToolbarPrefs]);
    const [isToolbarCustomizeOpen, setIsToolbarCustomizeOpen] = useState(false);

    const [currentProjectFilePath, setCurrentProjectFilePath] = useState<string | null>(null);
    const currentProjectFileName = useMemo(() => {
        if (!currentProjectFilePath) return null;
        const parts = currentProjectFilePath.split(/[/\\]/);
        return parts[parts.length - 1] || currentProjectFilePath;
    }, [currentProjectFilePath]);

    const [midiOutputs, setMidiOutputs] = useState<any[]>([]);
    const [selectedMidiOutput, setSelectedMidiOutput] = useState<any | null>(null);
    const [isMidiMenuOpen, setIsMidiMenuOpen] = useState(false);

    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    // SATB toggle should behave as a true toggle without losing access to the previous mode.
    const lastNonSatbModeRef = useRef<StaffSystemMode>('grandstaff');
    useEffect(() => {
        if (staffSystemMode !== 'satb_ancient') lastNonSatbModeRef.current = staffSystemMode;
    }, [staffSystemMode]);

    const [pasteCaret, setPasteCaret] = useState<{ x: number; systemIndex: number; measureIndex: number; beat: number; } | null>(null);
    const [pasteMarker, setPasteMarker] = useState<{ systemIndex: number; measureIndex: number; beat: number; ts: number } | null>(null);

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

    useEffect(() => {
        if (!pendingMenuAction) return;
        try {
            onConsumePendingMenuAction?.(pendingMenuAction.nonce);
        } catch {
            // ignore
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
    
    const isLoopingRef = useRef(isLooping);
    const loopRangeRef = useRef(loopRange);
    const metronomeIntervalRef = useRef<number | null>(null);
    const metronomeFlashStartTimeoutRef = useRef<number | null>(null);
    const metronomeFlashTimeoutRef = useRef<number | null>(null);
    const metronomeBeatRef = useRef(0);
    const metronomeNextWhenRef = useRef<number>(0);
    const metronomeSuppressedRef = useRef(false);
    const metronomeLinkedToPlaybackRef = useRef(false);
    const isMetronomeOnRef = useRef(isMetronomeOn);
    const isPlayingRef = useRef(isPlaying);

    useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
    useEffect(() => { loopRangeRef.current = loopRange; }, [loopRange]);
    useEffect(() => { isMetronomeOnRef.current = isMetronomeOn; }, [isMetronomeOn]);

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
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

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
    useEffect(() => { isBpmActiveRef.current = isBpmActive; }, [isBpmActive]);

    useEffect(() => {
        setMinMeasureCountDraft(String(minMeasureCount));
    }, [minMeasureCount]);

    useEffect(() => {
        setMeasuresPerLineDraft(String(measuresPerLine));
    }, [measuresPerLine]);

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

    const stopMetronomeInternal = useCallback(() => {
        if (metronomeIntervalRef.current) {
            window.clearTimeout(metronomeIntervalRef.current);
            metronomeIntervalRef.current = null;
        }
        if (metronomeFlashStartTimeoutRef.current) {
            window.clearTimeout(metronomeFlashStartTimeoutRef.current);
            metronomeFlashStartTimeoutRef.current = null;
        }
        if (metronomeFlashTimeoutRef.current) {
            window.clearTimeout(metronomeFlashTimeoutRef.current);
            metronomeFlashTimeoutRef.current = null;
        }
        setMetronomeFlash(null);
    }, []);

    const startMetronomeScheduler = useCallback(async (opts?: { anchorWhenSec?: number; anchorAbsBeat?: number }) => {
        if (!isMetronomeOnRef.current) return;

        // Restart cleanly whenever we (re)start.
        stopMetronomeInternal();

        const safeBpm = Math.max(20, Math.min(300, bpm || 120));
        const getTimeSignatureAtAbsBeatLocal = (absBeat: number): TimeSignature => {
            const baseBeats = timeSignature.numerator * (4 / timeSignature.denominator);
            const toAbsBeat = (c: any) => {
                const ab = Number(c?.absBeat);
                if (Number.isFinite(ab)) return ab;
                const m = Number(c?.measureIndex) || 0;
                return m * Math.max(1, baseBeats || 4);
            };
            const sorted = (timeSignatureChanges || []).slice().sort((a, b) => toAbsBeat(a) - toAbsBeat(b));
            let active: TimeSignature = timeSignature;
            for (const c of sorted) {
                const at = toAbsBeat(c);
                if (Number.isFinite(at) && at <= absBeat + 1e-6) {
                    if (Number.isFinite(c.numerator) && Number.isFinite(c.denominator) && c.numerator > 0 && c.denominator > 0) {
                        active = { numerator: c.numerator, denominator: c.denominator };
                    }
                } else {
                    break;
                }
            }
            return active;
        };
        const beatDurationSec = 60 / safeBpm; // quarter note = 1 beat
        const unitBeats = metronomeUnit === 'eighth' ? 0.5 : (metronomeUnit === 'dotted-quarter' ? 1.5 : 1);
        const unitDurationSec = beatDurationSec * unitBeats;

        if (isAudioReady) {
            await audioService.ensureAudioIsReady();
        }

        const audioCtx = audioService.audioContext;
        if (!audioCtx) return;

        const nowSec = audioCtx.currentTime;
        const anchorWhenSec = (opts?.anchorWhenSec ?? nowSec);
        const anchorAbsBeat = (opts?.anchorAbsBeat ?? 0);

        // If we are already past the anchor, jump to the next metronome-unit boundary.
        const unitsSinceAnchor = Math.max(0, Math.ceil((nowSec - anchorWhenSec) / Math.max(1e-9, unitDurationSec)));
        metronomeBeatRef.current = Math.round((anchorAbsBeat + unitsSinceAnchor * unitBeats) * 1e6) / 1e6;
        metronomeNextWhenRef.current = anchorWhenSec + unitsSinceAnchor * unitDurationSec;

        const isDownbeat = (absBeat: number) => {
            if (!Number.isFinite(absBeat)) return false;
            const ts = getTimeSignatureAtAbsBeatLocal(absBeat);
            const beatsPerMeasureRaw = (ts?.numerator ?? 4) * (4 / (ts?.denominator ?? 4));
            const beatsPerMeasure = Math.max(1, Number.isFinite(beatsPerMeasureRaw) ? beatsPerMeasureRaw : 4);
            const mod = ((absBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
            return (mod < 1e-6) || (Math.abs(beatsPerMeasure - mod) < 1e-6);
        };

        const scheduleNext = () => {
            if (!isMetronomeOnRef.current) return;
            const ctx = audioService.audioContext;
            if (!ctx) return;

            const absBeat = metronomeBeatRef.current;
            const when = metronomeNextWhenRef.current;
            const strong = isDownbeat(absBeat);

            // Click sound
            void audioService.playClick(strong, when);

            // UI flash (as close as we can to the audio click)
            const flashDelayMs = Math.max(0, (when - ctx.currentTime) * 1000);
            if (metronomeFlashStartTimeoutRef.current) window.clearTimeout(metronomeFlashStartTimeoutRef.current);
            metronomeFlashStartTimeoutRef.current = window.setTimeout(() => {
                setMetronomeFlash(strong ? 'strong' : 'weak');
                if (metronomeFlashTimeoutRef.current) window.clearTimeout(metronomeFlashTimeoutRef.current);
                metronomeFlashTimeoutRef.current = window.setTimeout(() => {
                    setMetronomeFlash(null);
                }, 90);
            }, flashDelayMs);

            metronomeBeatRef.current = Math.round((absBeat + unitBeats) * 1e6) / 1e6;
            metronomeNextWhenRef.current = when + unitDurationSec;

            const nextDelayMs = Math.max(0, (metronomeNextWhenRef.current - ctx.currentTime - 0.03) * 1000);
            metronomeIntervalRef.current = window.setTimeout(scheduleNext, nextDelayMs);
        };

        // Start scheduling a bit ahead so the first click lands exactly on anchor.
        const firstDelayMs = Math.max(0, (metronomeNextWhenRef.current - nowSec - 0.03) * 1000);
        metronomeIntervalRef.current = window.setTimeout(scheduleNext, firstDelayMs);
    }, [audioService, bpm, isAudioReady, metronomeUnit, stopMetronomeInternal, timeSignature, timeSignatureChanges]);

    useEffect(() => {
        if (!isMetronomeOn) {
            metronomeSuppressedRef.current = false;
            metronomeLinkedToPlaybackRef.current = false;
            stopMetronomeInternal();
            return;
        }

        // If we stopped a play-synced metronome at end/stop playback, keep it silent
        // until the next Play (or until user toggles it off/on).
        if (metronomeSuppressedRef.current) {
            stopMetronomeInternal();
            return;
        }

        // If playback is running, keep metronome locked to the playback grid.
        if (isPlayingRef.current && audioPlaybackStartTimeRef.current > 0) {
            metronomeLinkedToPlaybackRef.current = true;
            void startMetronomeScheduler({
                anchorWhenSec: audioPlaybackStartTimeRef.current,
                anchorAbsBeat: playbackStartBeatRef.current,
            });
            return;
        }

        metronomeLinkedToPlaybackRef.current = false;

        // Start free-running metronome (anchor = now).
        void startMetronomeScheduler({ anchorWhenSec: audioService.audioContext?.currentTime, anchorAbsBeat: 0 });

        return () => {
            stopMetronomeInternal();
        };
    }, [audioService, isMetronomeOn, startMetronomeScheduler, stopMetronomeInternal]);


    const handleActivateMidi = async () => {
        if (navigator.requestMIDIAccess) {
          try {
            const midiAccess = await navigator.requestMIDIAccess();
            const outputs = Array.from(midiAccess.outputs.values());
            setMidiOutputs(outputs);
            if (outputs.length > 0 && !selectedMidiOutput) {
              setSelectedMidiOutput(outputs[0]);
            }
          } catch (error) {
            // Removed debug log
          }
        } else {
          // Removed debug log
        }
      };

    const [bpmInputString, setBpmInputString] = useState('');
    
    const [selectionRect, setSelectionRect] = useState<{ startX: number; startY: number; endX: number; endY: number; isVisible: boolean; systemIndex: number | null; filterVoice: Voice | null;}>({ startX: 0, startY: 0, endX: 0, endY: 0, isVisible: false, systemIndex: null, filterVoice: null });
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
            const sharp = names.find(n => n.includes('#'));
            const flat = names.find(n => n.includes('b'));

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
        }

        // Record last key change so the transpose checkbox can apply/revert even if toggled after.
        lastKeyChangeRef.current = { fromRoot, toRoot: nextRoot, transposedApplied: isTranspose };
        setKeySignatureRoot(nextRoot);
    }, [keyChangeMode, keySignatureRoot, reinterpretAllNotesModallyInKey, setKeySignatureRoot, transposeAllNotesToKey]);

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
                case 'doubleSharp': return 2;
                case 'doubleFlat': return -2;
                default: return 0;
            }
        };

        return (rawNotes || []).map((n: any) => {
            try {
                if (!n || n.isRest) return n;
                const letter = String(n.pitch || '').charAt(0).toUpperCase();
                if (!basePc.hasOwnProperty(letter)) return n;
                const octave = Number(n.octave);
                if (!Number.isFinite(octave)) return n;

                const explicit = (n.explicitAccidental ?? n.userAccidental ?? null) as any;
                const delta = (explicit != null) ? accidentalToDelta(explicit) : keySigAccidentalForLetter(letter);

                const noteIndex = ((basePc[letter] + delta) % 12 + 12) % 12;
                const midi = (octave + 1) * 12 + noteIndex;

                const curIdx = Number(n.noteIndex);
                const curMidi = Number(n.midi);
                const needsIdx = !Number.isFinite(curIdx) || (((curIdx % 12) + 12) % 12) !== noteIndex;
                const needsMidi = !Number.isFinite(curMidi) || curMidi !== midi;

                if (!needsIdx && !needsMidi) return n;
                return { ...n, noteIndex, midi };
            } catch {
                return n;
            }
        });
    }, [rawNotes, keySignature]);

    const notes = useMemo(() => calculateNoteBeats(normalizedRawNotes, timeSignature, timeSignatureChanges), [normalizedRawNotes, timeSignature, timeSignatureChanges]);

    const [marqueeSelectOnlyCurrentVoice, setMarqueeSelectOnlyCurrentVoice] = usePreference<boolean>('editor.selectOnlyCurrentVoice');

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
    // Print handler (moved above menu handler to avoid temporal dead zone): opens a print window for the staff container
    const handlePrint = useCallback(() => {
        const container = staffContainerRef.current;
        if (!container) {
            // Removed debug log
            return;
        }
        const printWindow = window.open('', '_blank', 'width=1200,height=800');
        if (!printWindow) {
            // Removed debug log
            return;
        }
        const head = document.head.innerHTML;
        const content = container.innerHTML;
        printWindow.document.open();
        printWindow.document.write(`<!doctype html><html><head>${head}<style>body{background:white;margin:0;padding:20px}svg{max-width:100%;height:auto}</style></head><body>${content}</body></html>`);
        printWindow.document.close();
        printWindow.focus();
    }, []);

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
                try {
                    // Note: 'redo' in execCommand is typically 'redo', not 'repeat'.
                    document.execCommand(command);
                } catch {
                    // ignore
                }
                return;
            }

            if (command === 'copy') {
                const currentSelected = latestSelectedNoteIds.current;
                const selected = (latestRawNotes.current || []).filter(n => currentSelected && currentSelected.has(n.id));
                if (!currentSelected || currentSelected.size === 0) {
                    // Keep silent: menu copy should not pop errors when nothing is selected.
                    return;
                }
                const copied = selected.map(n => {
                    const { xPosition, ...rest } = n as any;
                    return rest as StaffNote;
                });
                setClipboard(copied);
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(JSON.stringify(copied)).catch(() => setCopyPasteError('Copia negli appunti di sistema fallita.'));
                }
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
                let caret = pasteCaret || null;

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
                        setPasteCaret(caret);
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
                        setPasteCaret(caret);
                    }
                }
                if (!caret) {
                    caret = { x: 0, systemIndex: 0, measureIndex: 0, beat: 1 };
                    setPasteCaret(caret);
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
        if (action === 'close-project') {
            // Removed debug log
            const confirmed = window.confirm("Vuoi chiudere il progetto corrente? Le modifiche non salvate andranno perse.");
            if (confirmed) {
                // Reset rawNotes to initial state
                setRawNotes([]);
                setKeySignatureRoot('C');
                setProjectTitle('');
                setTimeSignature({ numerator: 4, denominator: 4 });
                setTimeSignatureChanges([]);
                setClipboard(null);
                setSelectedNoteIds(new Set());
                setActiveTab('editor');
                setDoubleBarlineMeasures([]);
                setMinMeasureCount(4);
                setMeasuresPerLine(4);
                setIsMinorMode(false);
                setKeyChangeMode('none');
                setModalTonicOverride('');
                setSelectedInsertion({ type: 'note', duration: 'quarter', isDotted: false });
                setIsTriplet(false);
                setIsDuplet(false);
                setIsSwing(false);
                setTupletNoteCount(0);
                setTripletBaseDuration(null);
                setActiveAccidental(null);
                setSelectedVoice(1);
                setAutoLeadingToneInMinor(true);
                setHoveredViolationNotes(null);
                setSelectedViolationIndex(null);
                setViewMode('page');
                setPasteCaret(null);
                setAnalysisContexts([]);
                setHarmonyOverrides([]);
                setContextMenu(null);
                setShowRomanAnalysis(true);
                setShowSymbolAnalysis(false);
                setShowMeasureNumbers(true);
                setIsToolbarCustomizeOpen(false);
                setMidiOutputs([]);
                setSelectedMidiOutput(null);
                setCurrentProjectFilePath(null);
            }
        } else if (action === 'save' || action === 'save-as') {
            // Removed debug log
            if (latestRawNotes.current.length === 0 && !window.confirm("Il progetto è vuoto. Salvare comunque?")) return;
            const saveKeySig = getKeySignature(keySignatureRoot || 'C', isMinorMode ? 'Minor' : 'Major');
            const projectData = JSON.stringify({
                notes: (latestRawNotes.current || []).map((n: any) => normalizeNotePitchFieldsWithKey(n as any, saveKeySig)),
                staffSystemMode,
                // Project-level settings
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
                doubleBarlineMeasures,
                harmonyOverrides: latestHarmonyOverrides.current,
                bpm,
                isBpmActive,
                isMetronomeOn,
                metronomeUnit,
                toolbarGroupOrder,
            }, null, 2);
            try {
                if (!api?.saveFile) return;
                const targetPath = (action === 'save' && currentProjectFilePath) ? currentProjectFilePath : undefined;
                const result = await api.saveFile(projectData, targetPath);
                if (result && result.success && result.filePath) {
                    if (api?.addRecentFile) api.addRecentFile(result.filePath);
                    setCurrentProjectFilePath(result.filePath);
                }
            } catch (err) {
                // Removed debug log
            }
        } else if (action === 'open') {
            // Removed debug log
            setRawNotes([]);
            // Reset to defaults first so older projects (missing fields) don't
            // inherit settings from the previously opened project.
            setKeySignatureRoot('C');
            setProjectTitle('');
            setTimeSignature({ numerator: 4, denominator: 4 });
            setTimeSignatureChanges([]);
            setIsMinorMode(false);
            setAutoLeadingToneInMinor(true);
            setKeyChangeMode('none');
            setModalTonicOverride('');
            setAnalysisContexts([]);
            setHarmonyOverrides([]);
            setBpm(120);
            setIsBpmActive(false);
            setIsMetronomeOn(false);
            setMetronomeUnit('quarter');
            try {
                const data = payload?.data;
                if (!data) throw new Error("Nessun dato fornito per l'apertura.");
                const loadedProject = JSON.parse(data);
                if (loadedProject && Array.isArray(loadedProject.notes)) {
                    const loadKeyRoot = (typeof loadedProject.keySignatureRoot === 'string' && loadedProject.keySignatureRoot)
                        ? loadedProject.keySignatureRoot
                        : 'C';
                    const loadMinor = typeof loadedProject.isMinorMode === 'boolean' ? loadedProject.isMinorMode : false;
                    const loadKeySig = getKeySignature(loadKeyRoot, loadMinor ? 'Minor' : 'Major');

                    // Self-heal older/saved projects: keep spelling fields as-is, but
                    // ensure numeric fields follow the written spelling.
                    const normalizedNotes = (loadedProject.notes as any[]).map((n: any) => normalizeNotePitchFieldsWithKey(n, loadKeySig));

                    // Convert legacy beat/measure floats to high-resolution ticks for stability.
                    try {
                        const ts = (loadedProject.timeSignature && typeof loadedProject.timeSignature === 'object') ? loadedProject.timeSignature : { numerator: 4, denominator: 4 };
                        const baseBeats = ts.numerator * (4 / ts.denominator);
                        const ticksPerBeat = TICKS_PER_QUARTER; // quarter = 1 beat

                        const changesRaw = Array.isArray(loadedProject.timeSignatureChanges) ? loadedProject.timeSignatureChanges : [];
                        const changes = changesRaw
                            .map((c: any) => {
                                const absBeat = Number(c?.absBeat);
                                const m = Number.isFinite(c?.measureIndex)
                                    ? Number(c.measureIndex)
                                    : (Number.isFinite(absBeat) ? Math.floor(absBeat / Math.max(1, baseBeats || 4)) : 0);
                                return {
                                    measureIndex: m,
                                    numerator: Math.max(1, Math.round(Number(c?.numerator) || 4)),
                                    denominator: Math.max(1, Math.round(Number(c?.denominator) || 4)),
                                };
                            })
                            .filter((c: any) => Number.isFinite(c.measureIndex))
                            .sort((a: any, b: any) => a.measureIndex - b.measureIndex);

                        const maxIdx = (normalizedNotes as any[]).reduce((mx, n) => Math.max(mx, Number.isFinite(n.measureIndex) ? n.measureIndex : 0), 0);
                        const measureStartAbsBeat: number[] = [];
                        let acc = 0;
                        for (let m = 0; m <= maxIdx + 1; m++) {
                            measureStartAbsBeat[m] = acc;
                            let active = ts as any;
                            for (const c of changes) {
                                if (c.measureIndex <= m) active = c;
                                else break;
                            }
                            const bpm = active.numerator * (4 / active.denominator);
                            acc += Math.max(1, Number.isFinite(bpm) ? bpm : baseBeats || 4);
                        }

                        const withTicks = (normalizedNotes as any[]).map(n => {
                            try {
                                const m = Number.isFinite(n.measureIndex) ? n.measureIndex : 0;
                                const b = Number.isFinite(n.beat) ? n.beat : 1;
                                const absBeat = (measureStartAbsBeat[m] ?? (m * baseBeats)) + (b - 1);
                                const startTick = Math.round(absBeat * ticksPerBeat);

                                // duration -> beats
                                const base = (DURATION_VALUES as any)[n.duration || 'quarter'] || 1;
                                let durBeats = base;
                                if (n.isDotted) durBeats *= 1.5;
                                if (n.isTriplet) durBeats *= 2 / 3;
                                if (n.isDuplet) durBeats *= 3 / 2;
                                const durationTicks = Math.round(durBeats * ticksPerBeat);

                                return { ...n, startTick, durationTicks };
                            } catch (e) { return n; }
                        });
                        setRawNotes(withTicks as any);
                        try {
                            const maxIdx = (withTicks as any[]).reduce((mx, n) => Math.max(mx, Number.isFinite(n.measureIndex) ? n.measureIndex : 0), -1);
                            const measuresCount = Math.max(1, maxIdx + 1);
                            setMinMeasureCount(measuresCount);
                            setMinMeasureCountDraft(String(measuresCount));
                        } catch (_) {}
                    } catch (e) {
                        setRawNotes(normalizedNotes as any);
                    }
                    if (loadedProject.staffSystemMode === 'grandstaff' || loadedProject.staffSystemMode === 'treble_only' || loadedProject.staffSystemMode === 'satb_ancient') {
                        setStaffSystemMode(loadedProject.staffSystemMode);
                    }

                    // Restore project-level settings when present.
                                        if (Array.isArray(loadedProject.toolbarGroupOrder)) {
                                            const all = new Set(DEFAULT_TOOLBAR_ORDER);
                                            const cleanedOrder = loadedProject.toolbarGroupOrder.filter((id: any): id is ToolbarGroupId => all.has(id));
                                            const fullOrder: ToolbarGroupId[] = Array.from(new Set([...cleanedOrder, ...DEFAULT_TOOLBAR_ORDER]));
                                            setToolbarGroupOrder(fullOrder);
                                        }
                    if (typeof loadedProject.keySignatureRoot === 'string' && loadedProject.keySignatureRoot) {
                        setKeySignatureRoot(loadedProject.keySignatureRoot);
                    }
                    if (typeof loadedProject.projectTitle === 'string') {
                        setProjectTitle(loadedProject.projectTitle);
                    }
                    if (typeof loadedProject.titleFontSize === 'number' && Number.isFinite(loadedProject.titleFontSize)) {
                        setTitleFontSize(Math.max(12, Math.min(72, loadedProject.titleFontSize)));
                    }
                    if (typeof loadedProject.titleFontFamily === 'string' && loadedProject.titleFontFamily) {
                        setTitleFontFamily(loadedProject.titleFontFamily);
                    }
                    if (loadedProject.timeSignature && typeof loadedProject.timeSignature === 'object') {
                        const n = Number((loadedProject.timeSignature as any).numerator);
                        const d = Number((loadedProject.timeSignature as any).denominator);
                        if (Number.isFinite(n) && Number.isFinite(d) && n > 0 && d > 0) {
                            setTimeSignature({ numerator: n, denominator: d });
                        }
                    }
                    if (Array.isArray(loadedProject.timeSignatureChanges)) {
                        const baseBeats = (loadedProject.timeSignature && typeof loadedProject.timeSignature === 'object')
                            ? ((Number((loadedProject.timeSignature as any).numerator) || 4) * (4 / (Number((loadedProject.timeSignature as any).denominator) || 4)))
                            : (timeSignature.numerator * (4 / timeSignature.denominator));
                        const normalized = loadedProject.timeSignatureChanges.map((c: any) => {
                            const absBeat = Number(c?.absBeat);
                            const m = Number.isFinite(c?.measureIndex)
                                ? Number(c.measureIndex)
                                : (Number.isFinite(absBeat) ? Math.floor(absBeat / Math.max(1, baseBeats || 4)) : 0);
                            return {
                                absBeat: Number.isFinite(absBeat) ? absBeat : undefined,
                                measureIndex: m,
                                numerator: Math.max(1, Math.round(Number(c?.numerator) || 4)),
                                denominator: Math.max(1, Math.round(Number(c?.denominator) || 4)),
                            } as TimeSignatureChange;
                        });
                        setTimeSignatureChanges(normalized);
                    }
                    if (typeof loadedProject.isMinorMode === 'boolean') {
                        setIsMinorMode(loadedProject.isMinorMode);
                    }
                    if (typeof loadedProject.autoLeadingToneInMinor === 'boolean') {
                        setAutoLeadingToneInMinor(loadedProject.autoLeadingToneInMinor);
                    }
                    if (loadedProject.keyChangeMode === 'none' || loadedProject.keyChangeMode === 'transpose' || loadedProject.keyChangeMode === 'modal') {
                        setKeyChangeMode(loadedProject.keyChangeMode);
                    }
                    if (typeof loadedProject.modalTonicOverride === 'string') {
                        setModalTonicOverride(loadedProject.modalTonicOverride);
                    }
                    if (Array.isArray(loadedProject.analysisContexts)) {
                        setAnalysisContexts(loadedProject.analysisContexts);
                    }
                    if (Array.isArray(loadedProject.doubleBarlineMeasures)) {
                        const cleaned = loadedProject.doubleBarlineMeasures
                            .map((m: any) => Number(m))
                            .filter((m: any) => Number.isFinite(m) && m >= 0)
                            .sort((a: number, b: number) => a - b);
                        setDoubleBarlineMeasures(cleaned);
                    }
                    if (Array.isArray(loadedProject.harmonyOverrides)) {
                        setHarmonyOverrides(loadedProject.harmonyOverrides);
                    }
                    if (typeof loadedProject.bpm === 'number' && Number.isFinite(loadedProject.bpm) && loadedProject.bpm > 0) {
                        setBpm(loadedProject.bpm);
                    }
                    if (typeof loadedProject.isBpmActive === 'boolean') {
                        setIsBpmActive(loadedProject.isBpmActive);
                    }
                    if (typeof loadedProject.isMetronomeOn === 'boolean') {
                        setIsMetronomeOn(loadedProject.isMetronomeOn);
                    }
                    if (loadedProject.metronomeUnit === 'quarter' || loadedProject.metronomeUnit === 'eighth' || loadedProject.metronomeUnit === 'dotted-quarter') {
                        setMetronomeUnit(loadedProject.metronomeUnit);
                    }

                    if (payload && payload.filePath) {
                        if (api?.addRecentFile) api.addRecentFile(payload.filePath);
                        setCurrentProjectFilePath(payload.filePath);
                    } else {
                        setCurrentProjectFilePath(null);
                    }
                } else {
                    throw new Error("Formato dati non valido.");
                }
            } catch (err) {
                // Removed debug log
            }
        } else if (action === 'new') {
            // Removed debug log
            const confirmed = window.confirm("Vuoi davvero creare un nuovo progetto? I dati non salvati andranno persi.");
            if (confirmed) {
                setRawNotes([]);
                setProjectTitle('');
                setCurrentProjectFilePath(null);
                setKeySignatureRoot('C');
                setIsMinorMode(false);
                setTimeSignature({ numerator: 4, denominator: 4 });
                setHarmonyOverrides([]);
                setAnalysisContexts([]);
                setTimeSignatureChanges([]);
                setDoubleBarlineMeasures([]);
                setKeyChangeMode('none');
                setModalTonicOverride('');
                setAutoLeadingToneInMinor(true);
                setMeasuresPerLine(4);
                setMeasuresPerLineDraft('4');
                setMinMeasureCount(4);
                setMinMeasureCountDraft('4');
                setBpm(120);
                setIsBpmActive(false);
                setIsMetronomeOn(false);
                setMetronomeUnit('quarter');
                setClipboard(null);
                setSelectedNoteIds(new Set());
                setPasteCaret(null);
                setActiveAccidental(null);
                setSelectedVoice(1);
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
        }
    }, [setRawNotes, setKeySignatureRoot, setProjectTitle, setTimeSignature, setClipboard, setSelectedNoteIds, setActiveTab, setDoubleBarlineMeasures, setMinMeasureCount, setMeasuresPerLine, setIsMinorMode, setKeyChangeMode, setModalTonicOverride, setIsTriplet, setIsDuplet, setIsSwing, setTupletNoteCount, setTripletBaseDuration, setActiveAccidental, setSelectedVoice, setHoveredViolationNotes, setSelectedViolationIndex, setViewMode, pasteMarker, setPasteCaret, setAnalysisContexts, setHarmonyOverrides, setContextMenu, setShowRomanAnalysis, setShowSymbolAnalysis, setShowMeasureNumbers, setToolbarGroupOrder, setIsToolbarCustomizeOpen, setMidiOutputs, setSelectedMidiOutput, setBpm, setIsBpmActive, setIsMetronomeOn, setCurrentProjectFilePath, bpm, isBpmActive, isMetronomeOn, metronomeUnit, toolbarGroupOrder, keySignatureRoot, projectTitle, titleFontSize, titleFontFamily, timeSignature, analysisContexts, isMinorMode, keyChangeMode, modalTonicOverride, undoNotes, redoNotes, handlePrint, staffSystemMode, setStaffSystemMode, setMarqueeSelectOnlyCurrentVoice]);

    // Routing: single source of truth for where actions are handled.
    const dispatchMenuAction = useCallback((action: MenuAction, payload: any) => {
        if (getMenuActionTarget(action) !== 'grandStaff') return;
        void handleMenuActionLegacy(action, payload);
    }, [handleMenuActionLegacy]);

    // Listener Electron: registrazione unica e cleanup
    useEffect(() => {
        const api = (window).electronAPI;
        //
        if (!api) {
            // Removed debug log
            return;
        }
        //
        const removeListener = api.onMenuAction((action, payload) => {
            try {
                dispatchMenuAction(action, payload);
            } catch {
                // ignore
            }
        });
        return () => {
            if (removeListener) removeListener();
        };
    }, [dispatchMenuAction]);

    // Listen for native copy events (keyboard) to set the paste marker as well
    useEffect(() => {
        const onNativeCopy = (ev: ClipboardEvent) => {
            try {
                handleCopy();
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
    
    const analysisResult = useMemo(() => {
        if (!isAnalysisEnabled) {
            return { analyzedNotes: notes, connections: [], violations: [], inferredAnalysisContexts: [] as any[] };
        }
        return applyHarmonyRules(notes, keySignature, currentTonic, isMinorMode, analysisContexts, timeSignature);
    }, [notes, keySignature, currentTonic, isMinorMode, analysisContexts, isAnalysisEnabled, timeSignature]);

    const [enableInferredContexts, setEnableInferredContexts] = usePreference<boolean>('analysis.enableInferredContexts');
    const [harmonyLabelMinSpanBeats, setHarmonyLabelMinSpanBeats] = usePreference<number>('analysis.harmonyLabelMinSpanBeats');

    const effectiveAnalysisContexts = useMemo(() => {
        // NOTE: inferred contexts can be helpful for experimentation, but they can also
        // mis-fire on short tonicizations (e.g. V/iii) and distort Roman labels.
        // For stability/pedagogy, only apply user-authored contexts here.
        const manual = (analysisContexts || []) as any[];
        if (!enableInferredContexts) return manual;

        const inferred = ((analysisResult as any)?.inferredAnalysisContexts || []) as any[];
        const inferredArr = Array.isArray(inferred) ? inferred : [];
        if (!inferredArr.length) return manual;

        // If the user has manual contexts, do not override them.
        // However, allow inferred contexts to continue *after* the last manual context,
        // so the analysis can return to the global key later without forcing the user
        // to add a second manual marker.
        if (manual.length) {
            let lastManualAbs = -Infinity;
            try {
                for (const c of manual) {
                    const a = analysisContextAbsBeat(c as any);
                    if (Number.isFinite(a) && a > lastManualAbs) lastManualAbs = a;
                }
            } catch { /* ignore */ }

            const after = inferredArr.filter((c: any) => {
                try {
                    const a = analysisContextAbsBeat(c);
                    return Number.isFinite(a) && a > (lastManualAbs + 1e-6);
                } catch {
                    return false;
                }
            });
            return [...manual, ...after];
        }

        return inferredArr;
    }, [analysisResult, analysisContexts, enableInferredContexts]);

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

    const handleApplyContext = (absBeat: number, newTonic: string, newIsMinor: boolean, label?: string) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e6);

        setAnalysisContexts(prev => {
            const next = (prev || []).filter(c => Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) > 1e-6);
            next.push({ absBeat: safeAbsBeat, newTonic, newIsMinor, label: label?.trim() || undefined });
            return next.sort((a, b) => analysisContextAbsBeat(a) - analysisContextAbsBeat(b));
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

    const existingHarmonyOverrideForContextMenu = useMemo(() => {
        try {
            if (!contextMenu) return null;
            const q = (x: number) => Math.round(Number(x) * 192) / 192;
            const a = q(contextMenu.absBeat);
            return (harmonyOverrides || []).find(o => q(Number(o?.absBeat)) === a) || null;
        } catch {
            return null;
        }
    }, [contextMenu, harmonyOverrides]);

    const existingTimeSignatureChangeForMenu = useMemo(() => {
        if (!contextMenu) return null;
        return (timeSignatureChanges || []).find(c => Math.abs(timeSignatureChangeAbsBeat(c) - contextMenu.absBeat) <= 1e-6) || null;
    }, [contextMenu, timeSignatureChangeAbsBeat, timeSignatureChanges]);


    useEffect(() => {
        const container = staffContainerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(entries => {
            if (entries[0]) {
                const width = entries[0].contentRect.width;
                if (width > 0) setContainerWidth(width);
            }
        });
        observer.observe(container);
        const initialWidth = container.getBoundingClientRect().width;
        if (initialWidth > 0) setContainerWidth(initialWidth);
        return () => observer.disconnect();
    }, [isActive, viewMode]);

    const layoutData = useMemo(() => {
        // New deterministic tick-based layout:
        const notesToLayout = analyzedNotes;
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

            // Compute the smallest tick delta between adjacent onsets inside the system
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
                const barStyle = m === finalMeasureIndex ? 'final' : (doubleSet.has(m) ? 'double' : 'single');
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
    }, [analyzedNotes, containerWidth, timeSignature, timeSignatureChanges, keySignature, measuresPerLine, viewMode, minMeasureCount, doubleBarlineMeasures]);

    // Keep a ref to the latest layoutData so async callbacks can read current layout
    const layoutDataRef = useRef(layoutData);
    useEffect(() => { layoutDataRef.current = layoutData; }, [layoutData]);

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
                    return window.confirm(`Cancellare davvero la misura ${m + 1}?\n\nLa misura verrà rimossa e tutto ciò che segue verrà spostato indietro di una misura.`);
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
    const harmonyLabelsBySystem = useMemo(() => {
        return computeHarmonyLabelsBySystem({
            isAnalysisEnabled,
            layoutData,
            timeSignature,
            timeSignatureChanges,
            effectiveAnalysisContexts,
            analysisContextAbsBeat,
            currentTonic,
            isMinorMode,
            harmonyOverrides,
            analysisResult,
            analyzedNotes,
            noteNameToChromaticIndex,
            startX: START_X,
            measurePaddingX: MEASURE_PADDING_X,
            harmonyLabelMinSpanBeats,
        });

        if (!isAnalysisEnabled || !layoutData) return [];

        // Use the timeline of all active notes at each event (start/end of any note)
        const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges);

        // Labels should follow *structural onsets* rather than every scanpoint.
        // Note-off-only scanpoints can temporarily reduce the verticality (e.g. 2 notes)
        // and cause spurious chord identification (like #IV° ...) even when the harmony
        // is conceptually being held.
        const isCompoundMeter = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
        const isStrongPulseInMeasure = (inMeasureBeats0: number) => {
            try {
                if (!Number.isFinite(inMeasureBeats0)) return false;
                const EPS = 1e-3;
                if (isCompoundMeter) {
                    // dotted-quarter pulse: 3 eighths = 1.5 beats (quarter units)
                    const pulse = 1.5;
                    const r = ((inMeasureBeats0 % pulse) + pulse) % pulse;
                    return Math.abs(r) < EPS || Math.abs(pulse - r) < EPS;
                }
                const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
                if (!nearInt(inMeasureBeats0)) return false;
                const beat0 = Math.round(inMeasureBeats0);
                return beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
            } catch {
                return false;
            }
        };

        const isBeatBoundaryInMeasure = (inMeasureBeats0: number) => {
            try {
                if (!Number.isFinite(inMeasureBeats0)) return false;
                const EPS = 1e-3;
                if (isCompoundMeter) return isStrongPulseInMeasure(inMeasureBeats0);
                return Math.abs(inMeasureBeats0 - Math.round(inMeasureBeats0)) < EPS;
            } catch {
                return false;
            }
        };

        const timelineForLabels = (timeline || []).filter((ev: any, idx: number) => {
            if (!ev) return false;
            if (idx === 0) return true;

            const prev = timeline[idx - 1] as any;
            const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
            const curNotes = (ev?.notes || []) as any[];

            // 1) Keep onset events (at least one new active note).
            const hasOnset = curNotes.some(n => {
                const id = String(n?.id ?? '');
                return id && !prevIds.has(id);
            });
            if (hasOnset) return true;

            // 2) Also keep note-off-only events on strong beats / barlines.
            // Otherwise, a harmony change caused by a release at the barline
            // gets shifted to the next onset (user reported beat-1 label moving to beat-2).
            try {
                const curIds = new Set<string>(curNotes.map(n => String(n?.id ?? '')).filter(Boolean));
                const removed = Array.from(prevIds).some(id => id && !curIds.has(id));
                if (!removed) return false;

                const absBeat = Number(ev?.absBeat);
                if (!Number.isFinite(absBeat)) return false;
                const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                // In simple meters (4/4, 3/4, ...), real harmony changes often happen on weak beats
                // via note releases/ties (e.g. beat 4 leading to beat 1). Keep beat-boundary releases.
                return isBeatBoundaryInMeasure(inMeasure);
            } catch {
                return false;
            }
        });
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const ctxAtAbsBeat = (absBeat: number) => (effectiveAnalysisContexts || [])
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

        const qAbs = (x: number) => {
            try {
                // Quantize to 1/192 of a beat to avoid float drift and to align with timeline events.
                const q = 192;
                return Math.round(Number(x) * q) / q;
            } catch {
                return Number(x) || 0;
            }
        };

        const getNear = <T,>(m: Map<number, T>, a0: number): T | undefined => {
            try {
                const a = Number(a0);
                if (!Number.isFinite(a)) return undefined;
                const direct = m.get(a);
                if (direct !== undefined) return direct;
                // Tolerate tiny float drift between different absBeat sources.
                const EPS = (1 / 192) + 1e-6;
                for (const [k, v] of m.entries()) {
                    if (Math.abs(Number(k) - a) <= EPS) return v;
                }
                return undefined;
            } catch {
                return undefined;
            }
        };

        const overrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        try {
            (harmonyOverrides || []).forEach((o: any) => {
                const a = Number(o?.absBeat);
                if (!Number.isFinite(a)) return;
                overrideByAbsBeat.set(qAbs(a), {
                    absBeat: a,
                    roman: typeof o?.roman === 'string' ? o.roman : undefined,
                    romanDisplay: typeof o?.romanDisplay === 'string' ? o.romanDisplay : undefined,
                    symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                    figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                    note: typeof o?.note === 'string' ? o.note : undefined,
                });
            });
        } catch { /* ignore */ }

        // Engine-provided label-only cadence overrides (IV–V–I / ii–V–I).
        // These are lower priority than user overrides.
        const engineOverrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        try {
            const arr = (analysisResult as any)?.autoHarmonyLabelOverrides;
            if (Array.isArray(arr)) {
                for (const o of arr) {
                    const a = Number(o?.absBeat);
                    if (!Number.isFinite(a)) continue;
                    engineOverrideByAbsBeat.set(qAbs(a), {
                        absBeat: a,
                        roman: typeof o?.roman === 'string' ? o.roman : undefined,
                        romanDisplay: typeof o?.romanDisplay === 'string' ? o.romanDisplay : undefined,
                        symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                        figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                        note: typeof o?.note === 'string' ? o.note : undefined,
                    });
                }
            }
        } catch { /* ignore */ }

        // ---------------------------------------------------------
        // 2-measure lookahead tonicization (label-only)
        // ---------------------------------------------------------
        // Goal: allow a short, "provisional" functional reading of a few events without
        // emitting a key-context change. Example in C: Gm before V/ii → ii can be shown as iv/ii.
        // This pass only creates display overrides and never beats a user override.
        const autoOverrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        const autoRomanDisplayByAbsBeat = new Map<number, string>();
        const protectedAbsBeats = new Set<number>();
        try {
            const preferFlats = (() => {
                try {
                    return String(currentTonic || '').includes('b');
                } catch {
                    return true;
                }
            })();

            const pcToName = (pc: number): string => {
                const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
                const idx = (((Number(pc) % 12) + 12) % 12);
                return preferFlats ? flat[idx] : sharp[idx];
            };

            const degreeIndexFromRoman = (r: string): number | null => {
                const s0 = String(r || '').trim();
                if (!s0) return null;
                const s = s0
                    .replace(/\s+/g, '')
                    .replace(/[^ivIV]/g, '')
                    .toLowerCase();
                if (s === 'i') return 0;
                if (s === 'ii') return 1;
                if (s === 'iii') return 2;
                if (s === 'iv') return 3;
                if (s === 'v') return 4;
                if (s === 'vi') return 5;
                if (s === 'vii') return 6;
                return null;
            };

            const scaleIntervalsForContext = (isMinor: boolean): number[] => (
                isMinor
                    ? [0, 2, 3, 5, 7, 8, 10] // natural minor
                    : [0, 2, 4, 5, 7, 9, 11]
            );

            // Precompute base Roman labels for the label timeline under the *current* active context.
            const base = (timelineForLabels || []).map((ev: any) => {
                const absBeat = Number(ev?.absBeat);
                const ctx = ctxAtAbsBeat(absBeat);
                const ctxTonic = ctx ? String(ctx.newTonic || '') : String(currentTonic || 'C');
                const ctxIsMinor = ctx ? !!ctx.newIsMinor : !!isMinorMode;
                const r = getRomanAnalysis((ev?.notes || []) as any, ctxTonic, ctxIsMinor);
                const rootPc = (() => {
                    try {
                        // Prefer a pitch-class-inferred triad root when available.
                        // This avoids odd roman labels (e.g. "V♭6") caused by mis-rooting.
                        const pcs = pcSetFromNotes((ev?.notes || []) as any);
                        if (pcs && pcs.size === 3) {
                            const arr = Array.from(pcs.values());
                            for (const pc of arr) {
                                const maj = new Set<number>([pc, (pc + 4) % 12, (pc + 7) % 12]);
                                const min = new Set<number>([pc, (pc + 3) % 12, (pc + 7) % 12]);
                                const dim = new Set<number>([pc, (pc + 3) % 12, (pc + 6) % 12]);
                                const aug = new Set<number>([pc, (pc + 4) % 12, (pc + 8) % 12]);
                                const matches = (s: Set<number>) => arr.every(x => s.has(x));
                                if (matches(maj) || matches(min) || matches(dim) || matches(aug)) {
                                    return pc;
                                }
                            }
                        }
                        // Fallback to candidate root.
                        const cands = identifyChordCandidates((ev?.notes || []) as any);
                        const best = Array.isArray(cands) ? cands[0] : null;
                        const pc = Number(best?.root?.noteIndex);
                        return Number.isFinite(pc) ? (((pc % 12) + 12) % 12) : null;
                    } catch {
                        return null;
                    }
                })();
                return {
                    ev,
                    absBeat,
                    q: qAbs(absBeat),
                    ctxTonic,
                    ctxIsMinor,
                    roman: String(r?.roman || ''),
                    rootPc,
                };
            }).filter(x => Number.isFinite(x.absBeat));

            const maxLookaheadBeats = beatsPerMeasure * 2;
            for (let j = 0; j < base.length; j++) {
                const bj = base[j];
                const rj = String(bj.roman || '');
                const m = rj.match(/^([Vv])\/(.+)$/);
                if (!m) continue;
                const targetRoman = String(m[2] || '').trim();
                if (!targetRoman) continue;

                // Find an arrival chord labeled exactly as the target within 2 measures.
                let k = -1;
                for (let t = j + 1; t < base.length; t++) {
                    if ((base[t].absBeat - bj.absBeat) > maxLookaheadBeats + 1e-6) break;
                    if (String(base[t].roman || '') === targetRoman) {
                        k = t;
                        break;
                    }
                }
                if (k < 0) continue;

                // Protect the resolution chord from being reinterpreted by later tonicizations.
                // This avoids confusing cases like: iv/ii - V/ii - (resolution) being later
                // relabeled as iv/vi just because a V/vi appears afterwards.
                try {
                    const bk = base[k];
                    if (bk && Number.isFinite(bk.q)) protectedAbsBeats.add(bk.q);
                } catch { /* ignore */ }

                // Determine the tonicized key root (pitch name) for the target degree in the CURRENT context.
                const tonicPc = noteNameToChromaticIndex(String(bj.ctxTonic || 'C'));
                if (tonicPc == null || tonicPc < 0) continue;
                const degIdx = degreeIndexFromRoman(targetRoman);
                if (degIdx == null) continue;
                const ints = scaleIntervalsForContext(!!bj.ctxIsMinor);
                const tonicizedPc = (((tonicPc + (ints[degIdx] ?? 0)) % 12) + 12) % 12;
                const tonicizedTonic = pcToName(tonicizedPc);

                // Heuristic: if the target degree is a lowercase roman, treat the tonicized key as minor.
                const tonicizedIsMinor = targetRoman === targetRoman.toLowerCase();

                // Add a display-only pivot on the resolution chord: i=ii, I=V, etc.
                // This makes it clear the cadence closed in the tonicized key without
                // asserting a persistent key change.
                try {
                    const bk = base[k];
                    if (bk && Number.isFinite(bk.q) && !overrideByAbsBeat.has(bk.q)) {
                        const localTonicRoman = tonicizedIsMinor ? 'i' : 'I';
                        // Only show when the global roman differs (otherwise it's noisy).
                        if (String(bk.roman || '') && String(bk.roman || '') !== localTonicRoman) {
                            autoRomanDisplayByAbsBeat.set(bk.q, `${localTonicRoman}=${targetRoman}`);
                        }
                    }
                } catch { /* ignore */ }

                // Look BACK within 2 measures for a chord that is iv in the tonicized key.
                // If found, display it as a pivot: globalRoman=iv/target.
                for (let i = j - 1; i >= 0; i--) {
                    const bi = base[i];
                    if ((bj.absBeat - bi.absBeat) > maxLookaheadBeats + 1e-6) break;
                    if (overrideByAbsBeat.has(bi.q)) continue; // user override always wins
                    if (autoOverrideByAbsBeat.has(bi.q)) continue;
                    if (protectedAbsBeats.has(bi.q)) continue;

                    const rr = getRomanAnalysis((bi.ev?.notes || []) as any, tonicizedTonic, tonicizedIsMinor);
                    const localRoman = String(rr?.roman || '');

                    // Also support the common pre-dominant pattern in tonicized minor:
                    // ii° – V – i (e.g., in G: C#° – F# – Bm = ii°/iii – V/iii – i=iii).
                    // This is often more musically informative than reading the diminished chord
                    // as vii°/V when it does not actually resolve to V.
                    if (localRoman && /^ii/i.test(localRoman) && (localRoman.includes('°') || localRoman.includes('ø'))) {
                        autoOverrideByAbsBeat.set(bi.q, {
                            absBeat: bi.absBeat,
                            roman: `${localRoman}/${targetRoman}`,
                        });
                        continue;
                    }

                    // Only reinterpret a *minor* subdominant as iv/target (e.g. Gm -> iv/ii in C).
                    // Do not relabel a major IV in the tonicized key (often a mixture/pivot sonority).
                    if (localRoman !== 'iv') continue;

                    // Pivot display (keep base roman stable, but show that this chord is a pivot):
                    // Example in C: Am (vi) before V/iii→iii becomes vi=iv.
                    // Keep it short to reduce overlap; the target (/iii) is typically evident
                    // from nearby V/target and i=target labels.
                    const globalRomanHere = String(bi.roman || '').trim();
                    if (globalRomanHere) {
                        autoRomanDisplayByAbsBeat.set(bi.q, `${globalRomanHere}=${localRoman}`);
                    } else {
                        autoRomanDisplayByAbsBeat.set(bi.q, `${localRoman}/${targetRoman}`);
                    }
                }
            }

            // Cadence detection now lives in the analysis engine (applyHarmonyRules)
            // and arrives via analysisResult.autoHarmonyLabelOverrides.
        } catch { /* ignore */ }

        // For each system, collect all timeline events that fall within its measures
        const labelsBySystem: { id: string; x: number; roman: string; romanDisplay?: string; sequenceRoman?: string; sequenceRomanFunctional?: string; sequenceRomanSource?: string; figures: string[]; symbol: string; absBeat?: number; hiddenMarker?: boolean; isOverride?: boolean; pcsSig?: string }[][] = layoutData.systemsParams.map(() => []);


        // Helper: compute xPosition for a given absBeat in a system
        function getXForAbsBeat(absBeat: number, system: any) {
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
            const beatInMeasure = (absBeat - ((measureStartAbsBeat && measureStartAbsBeat[measureIndex]) ? measureStartAbsBeat[measureIndex] : (measureIndex * beatsPerMeasure))) + 1;
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return 0;
            const startX = system.startMeasuresX[idx];
            const endX = idx < system.measureIndices.length - 1 ? system.startMeasuresX[idx + 1] : (system.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / beatsPerMeasure));
            return startX + MEASURE_PADDING_X + (rel * contentWidth);
        }

        const lastSigBySystem = new Map<number, string>();
        const lastCtxBySystem = new Map<number, string>();
        const lastStructuralByVoiceBySystem = new Map<number, Map<number, any>>();
        const lastBassPcBySystem = new Map<number, number | null>();
        const lastRomanBySystem = new Map<number, string>();
        const lastFiguresBySystem = new Map<number, string[]>();
        const lastChordRootPcBySystem = new Map<number, number | null>();
        const lastChordTypeBySystem = new Map<number, string | null>();

        const indexByAbsBeat = new Map<number, number>();
        for (let i = 0; i < (timeline || []).length; i++) {
            const ev = (timeline as any[])[i];
            if (ev && typeof ev.absBeat === 'number') indexByAbsBeat.set(ev.absBeat, i);
        }

        const isDissonantIntervalAgainstBass = (note: any, notes: any[]): boolean => {
            try {
                if (!note || note.isRest || !Number.isFinite(note.midi)) return false;
                const pool = (notes || []).filter(n => n && !n.isRest && Number.isFinite(n.midi));
                if (pool.length < 2) return false;
                const bass = pool.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                if (!bass || bass.id === note.id) return false;
                const interval = (((note.midi - bass.midi) % 12) + 12) % 12;
                return interval === 1 || interval === 2 || interval === 5 || interval === 6 || interval === 10 || interval === 11;
            } catch {
                return false;
            }
        };

        const findNextOnsetForVoice = (fromFullIndex: number, voice: number, maxDeltaBeats = 1.01): { note: any; ev: any } | null => {
            try {
                if (fromFullIndex < 0 || fromFullIndex >= (timeline || []).length) return null;
                const fromEv: any = (timeline as any[])[fromFullIndex];
                const fromAbs = fromEv?.absBeat ?? 0;
                const prevIds = new Set<string>(((fromEv?.notes || []) as any[])
                    .filter(n => (n?.voice ?? 1) === voice)
                    .map(n => String(n?.id ?? '')));
                for (let j = fromFullIndex + 1; j < (timeline || []).length; j++) {
                    const ev: any = (timeline as any[])[j];
                    if (!ev || typeof ev.absBeat !== 'number') continue;
                    if ((ev.absBeat - fromAbs) > maxDeltaBeats) break;
                    const candidates = ((ev.notes || []) as any[]).filter(n => (n?.voice ?? 1) === voice);
                    for (const n of candidates) {
                        const id = String(n?.id ?? '');
                        if (!id) continue;
                        if (!prevIds.has(id)) return { note: n, ev };
                    }
                }
            } catch { /* ignore */ }
            return null;
        };

        const isResolvingDissonanceForLabels = (n: any, evAbsBeat: number): boolean => {
            try {
                if (!n || n.isRest) return false;
                const v = (n?.voice ?? 1) as number;
                if (v === 4) return false; // never treat bass as non-chord tone for labels
                const fullIndex = indexByAbsBeat.get(evAbsBeat);
                if (fullIndex == null) return false;
                const curEv: any = (timeline as any[])[fullIndex];

                const isChordToneOfConfidentCandidate = (note: any, notesHere: any[]): boolean => {
                    try {
                        if (!note || note.isRest) return false;
                        const notes = (notesHere || []) as any[];
                        if (notes.length < 3) return false;
                        const cands = identifyChordCandidates(notes as any);
                        const best = (cands && cands.length) ? cands[0] : null;
                        const matchType = (best as any)?.matchType;
                        const chordType = String(best?.type || '');
                        const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                        const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                        if (!confident || isSusLike || !best?.root || !best?.type) return false;

                        const rootPc = Number.isFinite((best.root as any).noteIndex)
                            ? (((best.root as any).noteIndex % 12) + 12) % 12
                            : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                        const notePc = Number.isFinite(note?.midi)
                            ? (((note.midi % 12) + 12) % 12)
                            : (typeof note.noteIndex === 'number' ? (((note.noteIndex % 12) + 12) % 12) : null);
                        if (rootPc == null || notePc == null) return false;

                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                        if (!Array.isArray(formula) || !formula.length) return false;
                        const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                        return formula.includes(intervalFromRoot);
                    } catch {
                        return false;
                    }
                };

                // Only treat *onsets* as potential resolving dissonances/appoggiature.
                // If this note was already sounding in the previous event, it's a held tone.
                try {
                    const prevEv: any = fullIndex > 0 ? (timeline as any[])[fullIndex - 1] : null;
                    if (prevEv?.notes) {
                        const alreadySounding = ((prevEv.notes || []) as any[]).some(p => (p?.voice ?? 1) === v && String(p?.id ?? '') && String(p?.id ?? '') === String(n?.id ?? ''));
                        if (alreadySounding) return false;
                    }
                } catch { /* ignore */ }

                // Critical guard: in inversions, chord tones can be dissonant vs the *bass* (e.g. the 3rd of V7 in 4/2).
                // Do not classify a note as a "resolving dissonance" if it is a chord tone of a confident, non-sus chord
                // interpretation of the current verticality. This prevents secondary dominants (e.g. D7/C = V7/V 4/2)
                // from collapsing into I4/7 after adding the next-beat resolution.
                try {
                    const notesHere = (curEv?.notes || []) as any[];
                    if (isChordToneOfConfidentCandidate(n, notesHere)) {
                        // Still allow the special 7-6/7-8 style resolution logic below to run
                        // for non-dominant major/minor seventh chords when dropping the 7th yields
                        // a stable triad (handled in the next block).
                        // Default: chord tones are NOT treated as resolving dissonances.
                        const cands = identifyChordCandidates(notesHere as any);
                        const best = (cands && cands.length) ? cands[0] : null;
                        const chordType = String(best?.type || '');
                        const rootPc = Number.isFinite((best?.root as any)?.noteIndex)
                            ? (((best.root as any).noteIndex % 12) + 12) % 12
                            : (Number.isFinite((best?.root as any)?.midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                        const notePc = Number.isFinite(n?.midi)
                            ? (((n.midi % 12) + 12) % 12)
                            : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                        if (rootPc != null && notePc != null) {
                            const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                            // Exception: allow a resolving 7th (common 7-6 retardation/appoggiatura)
                            // to be treated as a non-chord tone *even if* the best chord candidate
                            // is a 7th chord, when dropping this note yields a triadic interpretation.
                            // This is intentionally conservative: do NOT do this for dominant 7ths,
                            // to avoid breaking V7/V and cadential dominant behavior.
                            try {
                                const isSeventh = intervalFromRoot === 10 || intervalFromRoot === 11;
                                const isMajor7Like = /Major\s*7/i.test(chordType) || /Minor\s*7/i.test(chordType);
                                const isDominant7 = /Dominant\s*7/i.test(chordType) || (/7/.test(chordType) && /Dominant/i.test(chordType));
                                if (isSeventh && isMajor7Like && !isDominant7) {
                                    const remaining = notesHere.filter(nn => String(nn?.id ?? '') !== String(n?.id ?? ''));
                                    if (remaining.length >= 2) {
                                        const c2 = identifyChordCandidates(remaining as any);
                                        const b2 = (c2 && c2.length) ? c2[0] : null;
                                        const mt2 = (b2 as any)?.matchType;
                                        const confident2 = mt2 === 'exact' || mt2 === 'no_fifth' || mt2 === 'no_third';
                                        const t2 = String(b2?.type || '');
                                        const isTriad2 = !/7|9|11|13/i.test(t2) && !/Major\s*7|Minor\s*7|Dominant\s*7/i.test(t2);
                                        if (confident2 && isTriad2) {
                                            // Do NOT short-circuit; allow the resolution tests below.
                                        } else {
                                            return false;
                                        }
                                    } else {
                                        return false;
                                    }
                                } else {
                                    return false;
                                }
                            } catch {
                                return false;
                            }
                        } else {
                            return false;
                        }
                    }
                } catch { /* ignore */ }

                if (!isDissonantIntervalAgainstBass(n, curEv?.notes || [])) return false;

                // Appoggiature can last longer than a single beat; allow a slightly wider window.
                const next = findNextOnsetForVoice(fullIndex, v, 2.01);
                if (!next?.note || !Number.isFinite(n.midi) || !Number.isFinite(next.note.midi)) return false;
                const step = Math.abs((next.note.midi ?? 0) - (n.midi ?? 0));
                if (!(step > 0 && step <= 2)) return false;
                // Resolution should remove the vertical dissonance vs the (new) bass.
                if (isDissonantIntervalAgainstBass(next.note, next.ev?.notes || [])) return false;
                return true;
            } catch {
                return false;
            }
        };

        const isNonChordToneAtLabelEvent = (n: any, absBeat: number) => {
            try {
                if (!n) return true;
                if (n.isRest) return true;
                const v = (n?.voice ?? 1) as number;
                if (v === 4) {
                    // By default keep the bass in the structural snapshot (it stabilizes labels).
                    // Exception: when the engine explicitly flags a short weak-beat bass note as an
                    // ornament (passing/escape/neighbor/etc.), ignore it so it doesn't create a
                    // spurious harmony label (e.g. V4 from a bass "nota di volta").
                    const isBassOrnFlag = !!(n.isPassing || n.isEscape || n.isNeighbor || n.isAnticipation || n.isAppoggiatura);
                    if (!isBassOrnFlag) return false;

                    const dur = (() => {
                        try {
                            const base = (DURATION_VALUES as any)[n.duration || 'quarter'] || 1;
                            let val = base;
                            if (n.isDotted) val *= 1.5;
                            if (n.isTriplet) val *= 2 / 3;
                            if (n.isDuplet) val *= 3 / 2;
                            return val;
                        } catch {
                            return 999;
                        }
                    })();

                    const weak = (() => {
                        try {
                            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                            return !isStrongPulseInMeasure(inMeasure);
                        } catch {
                            return false;
                        }
                    })();

                    if (weak && dur <= 1.01) return true;
                    return false;
                }

                // Mis-tag guard (critical for inversions): chord tones can be dissonant vs the bass.
                // If the engine tagged a chord tone as neighbor/anticipation/appoggiatura, keep it
                // in the structural snapshot when it belongs to a confident chord candidate.
                try {
                    const isStrongBeat = (() => {
                        try {
                            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                            return isStrongPulseInMeasure(inMeasure);
                        } catch {
                            return false;
                        }
                    })();

                    // IMPORTANT: do not "rescue" weak-beat neighbors as chord tones.
                    // Otherwise a short note di volta can form a plausible triad (e.g. D–F–A)
                    // and incorrectly flip the harmony/figured bass at that scanpoint.
                    const hasNctFlag = !!(n.isAnticipation || n.isAppoggiatura || (n.isNeighbor && isStrongBeat));
                    if (hasNctFlag) {
                        const fullIndex = indexByAbsBeat.get(absBeat);
                        const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                        const notesHere = (curEv?.notes || []) as any[];
                        if (notesHere.length >= 3) {
                            const cands = identifyChordCandidates(notesHere as any);
                            const best = (cands && cands.length) ? cands[0] : null;
                            const matchType = (best as any)?.matchType;
                            const chordType = String(best?.type || '');
                            const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                            const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                            if (confident && !isSusLike && best?.root && best?.type) {
                                const rootPc = Number.isFinite((best.root as any).noteIndex)
                                    ? (((best.root as any).noteIndex % 12) + 12) % 12
                                    : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                                const notePc = Number.isFinite(n?.midi)
                                    ? (((n.midi % 12) + 12) % 12)
                                    : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                                if (rootPc != null && notePc != null) {
                                    const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                                    if (Array.isArray(formula) && formula.length) {
                                        const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                                        if (formula.includes(intervalFromRoot)) {
                                            return false;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }

                // Passing notes are usually non-structural, but in compound meters the 4th eighth is a
                // strong pulse and real harmony changes can happen there. If the engine mis-tags a
                // chord tone as passing/escape, keep it when it fits a confident chord candidate.
                try {
                    if (n.isPassing || n.isEscape) {
                        const isBeatBoundary = (() => {
                            try {
                                const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                                const isCompoundMeter = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
                                const EPS = 1e-3;
                                if (isCompoundMeter) return isStrongPulseInMeasure(inMeasure);
                                return Math.abs(inMeasure - Math.round(inMeasure)) < EPS;
                            } catch {
                                return false;
                            }
                        })();

                        // Mis-tag guard on beat boundaries: derive chord from other (non-ornamental)
                        // notes excluding the current one, then keep this note if it fits that chord.
                        // This prevents real changes on weak beats (e.g. beat 4) from disappearing.
                        if (isBeatBoundary) {
                            const fullIndex = indexByAbsBeat.get(absBeat);
                            const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                            const notesHereAll = (curEv?.notes || []) as any[];
                            const supportNotes = (notesHereAll || []).filter((x: any) => {
                                if (!x || x.isRest) return false;
                                if (String(x?.id ?? '') === String(n?.id ?? '')) return false;
                                // exclude other ornaments so we don't "learn" the harmony from them
                                if (x.isPassing || x.isEscape || x.isNeighbor || x.isAnticipation || x.isAppoggiatura) return false;
                                return true;
                            });
                            if (supportNotes.length >= 3) {
                                const cands = identifyChordCandidates(supportNotes as any);
                                const best = (cands && cands.length) ? cands[0] : null;
                                const matchType = (best as any)?.matchType;
                                const chordType = String(best?.type || '');
                                const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                                const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                                if (confident && !isSusLike && best?.root && best?.type) {
                                    const rootPc = Number.isFinite((best.root as any).noteIndex)
                                        ? (((best.root as any).noteIndex % 12) + 12) % 12
                                        : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                                    const notePc = Number.isFinite(n?.midi)
                                        ? (((n.midi % 12) + 12) % 12)
                                        : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                                    if (rootPc != null && notePc != null) {
                                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                                        if (Array.isArray(formula) && formula.length) {
                                            const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                                            if (formula.includes(intervalFromRoot)) {
                                                return false;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        return true;
                    }
                } catch { /* ignore */ }

                if (n.isPassing || n.isEscape) return true;

                // If a note is tagged as appoggiatura but it's actually consonant against the
                // current bass, treat it as a chord tone (mis-tag guard).
                if (n.isAppoggiatura) {
                    const fullIndex = indexByAbsBeat.get(absBeat);
                    const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                    if (curEv?.notes && isDissonantIntervalAgainstBass(n, curEv.notes || [])) return true;
                    return false;
                }

                // Anticipations are tricky: they can be either true NCTs (dissonant against the
                // current bass) or simply early chord tones that belong to the underlying harmony.
                // If an "anticipation" is consonant against the bass at this scanpoint, keep it
                // in the structural snapshot to avoid collapsing triads to dyads (e.g. Bb/D -> iii5).
                if (n.isAnticipation) {
                    const fullIndex = indexByAbsBeat.get(absBeat);
                    const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                    if (curEv?.notes && isDissonantIntervalAgainstBass(n, curEv.notes || [])) return true;
                    return false;
                }

                // Same idea for neighbors: if the engine tagged a chord tone as a neighbor, but it's
                // consonant against the current bass on a strong beat, keep it so inversions like I6
                // don't collapse into dyad-inferred labels.
                if (n.isNeighbor) {
                    const fullIndex = indexByAbsBeat.get(absBeat);
                    const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                    if (curEv?.notes && !isDissonantIntervalAgainstBass(n, curEv.notes || [])) {
                        try {
                            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                            if (isStrongPulseInMeasure(inMeasure)) return false;
                        } catch { /* ignore */ }
                    }
                    return true;
                }
                const s = n.isSuspension;
                if (s && typeof s.fromAbsBeat === 'number' && Math.abs(s.fromAbsBeat - absBeat) < 1e-6) return true;
                if (isResolvingDissonanceForLabels(n, absBeat)) return true;
            } catch (_) { /* ignore */ }
            return false;
        };

        const inferDiatonicRomanFromBass = (bassPc: number | null, tonic: string, isMinor: boolean): { roman: string; triad: { root: number; third: number; fifth: number } } | null => {
            try {
                if (bassPc == null) return null;
                const tIdx = noteNameToChromaticIndex(String(tonic ?? ''));
                if (tIdx == null || tIdx < 0 || !Number.isFinite(tIdx)) return null;

                const scaleIntervals = isMinor
                    ? [0, 2, 3, 5, 7, 8, 10] // natural minor for diatonic triads
                    : [0, 2, 4, 5, 7, 9, 11];
                const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
                const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
                const romans = isMinor ? romanMin : romanMaj;

                let degree = -1;
                for (let i = 0; i < scaleIntervals.length; i++) {
                    const pc = (((tIdx + scaleIntervals[i]) % 12) + 12) % 12;
                    if (pc === bassPc) { degree = i; break; }
                }
                if (degree < 0) return null;
                const roman = romans[degree];

                const rootPc = (((tIdx + scaleIntervals[degree]) % 12) + 12) % 12;
                const isDim = roman.includes('°');
                const isMinTriad = !isDim && roman === roman.toLowerCase();
                const isAug = roman.includes('+');
                const thirdInt = isMinTriad || isDim ? 3 : 4;
                const fifthInt = isAug ? 8 : (isDim ? 6 : 7);
                return {
                    roman,
                    triad: {
                        root: rootPc,
                        third: (rootPc + thirdInt) % 12,
                        fifth: (rootPc + fifthInt) % 12,
                    }
                };
            } catch {
                return null;
            }
        };

        const inferDiatonicTriadFromRoman = (roman: string, tonic: string, isMinor: boolean): { root: number; third: number; fifth: number } | null => {
            try {
                const r = String(roman || '').trim();
                if (!r) return null;
                const tIdx = noteNameToChromaticIndex(String(tonic ?? ''));
                if (tIdx == null || tIdx < 0 || !Number.isFinite(tIdx)) return null;
                const scaleIntervals = isMinor
                    ? [0, 2, 3, 5, 7, 8, 10]
                    : [0, 2, 4, 5, 7, 9, 11];
                const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
                const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
                const romans = isMinor ? romanMin : romanMaj;
                const degree = romans.indexOf(r);
                if (degree < 0) return null;
                const rootPc = (((tIdx + scaleIntervals[degree]) % 12) + 12) % 12;
                const isDim = r.includes('°');
                const isMinTriad = !isDim && r === r.toLowerCase();
                const isAug = r.includes('+');
                const thirdInt = isMinTriad || isDim ? 3 : 4;
                const fifthInt = isAug ? 8 : (isDim ? 6 : 7);
                return {
                    root: rootPc,
                    third: (rootPc + thirdInt) % 12,
                    fifth: (rootPc + fifthInt) % 12,
                };
            } catch {
                return null;
            }
        };

        const signatureFromNotes = (notes: any[]) => {
            try {
                // Use pitch-class signature only. This avoids re-labeling just because
                // a voice re-articulates the same harmony in another octave/register.
                const pcs = [...new Set((notes || []).filter(Boolean)
                    .map((n: any) => {
                        if (Number.isFinite(n?.midi)) return (((n.midi % 12) + 12) % 12);
                        if (typeof n?.noteIndex === 'number') return (((n.noteIndex % 12) + 12) % 12);
                        return null;
                    })
                    .filter((v: any) => v != null && Number.isFinite(v)))].sort((a, b) => a - b);
                return pcs.join('-');
            } catch {
                return '';
            }
        };

        const pcSetFromNotes = (notes: any[]): Set<number> => {
            const s = new Set<number>();
            for (const n of notes || []) {
                if (!n || n.isRest) continue;
                const pc = Number.isFinite(n?.midi)
                    ? (((n.midi % 12) + 12) % 12)
                    : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                if (pc == null || !Number.isFinite(pc)) continue;
                s.add(pc);
            }
            return s;
        };

        const triadPcsFromRootAndType = (rootPc: number, chordType: string): { root: number; third: number; fifth: number } | null => {
            try {
                if (rootPc == null || !Number.isFinite(rootPc)) return null;
                const t = String(chordType || '');
                const isDim = t.includes('dim') || t.includes('°') || t.includes('b5');
                const isAug = t.includes('aug') || t.includes('+') || t.includes('#5');
                const isMinor = !isDim && !isAug && (t.startsWith('m') || t.includes('Minor'));
                const thirdInt = isMinor || isDim ? 3 : 4;
                const fifthInt = isAug ? 8 : (isDim ? 6 : 7);
                const root = (((rootPc % 12) + 12) % 12);
                return {
                    root,
                    third: (root + thirdInt) % 12,
                    fifth: (root + fifthInt) % 12,
                };
            } catch {
                return null;
            }
        };

        const isSubset = (a: Set<number>, b: Set<number>): boolean => {
            for (const x of a) if (!b.has(x)) return false;
            return true;
        };

        timelineForLabels.forEach((event, eventIndex) => {
            // Find which system this event belongs to
            const measureIndex = event.measureIndex;
            let systemIndex = -1;
            for (let i = 0; i < layoutData.systemsParams.length; i++) {
                if (layoutData.systemsParams[i].measureIndices.includes(measureIndex)) {
                    systemIndex = i;
                    break;
                }
            }
            if (systemIndex === -1) return;
            const system = layoutData.systemsParams[systemIndex];

            // Structural harmony: ignore ornaments/anticipations so they don't create
            // micro-harmony labels on every scan-point.
            const fullNotes = (event.notes || []);

            // Build a stable structural snapshot by voice: if a voice is currently on an ornament
            // (anticipation/neighbor/etc.), keep the last non-ornamental active note for that voice.
            // This prevents spurious label changes when a chord tone is temporarily replaced by an ornament.
            const voiceSet = new Set<number>();
            for (const n of fullNotes) {
                const v = (n?.voice ?? 1) as number;
                if (!n || n.isRest) continue;
                voiceSet.add(v);
            }

            if (!lastStructuralByVoiceBySystem.has(systemIndex)) {
                lastStructuralByVoiceBySystem.set(systemIndex, new Map<number, any>());
            }
            const lastStructural = lastStructuralByVoiceBySystem.get(systemIndex)!;

            // Clear voices that are no longer active at this event.
            for (const v of Array.from(lastStructural.keys())) {
                if (!voiceSet.has(v)) lastStructural.delete(v);
            }

            // Update with any currently-active non-ornamental notes.
            for (const n of fullNotes) {
                if (!n || n.isRest) continue;
                const v = (n?.voice ?? 1) as number;

                // In compound meters (6/8, 9/8, 12/8), bass lines are often written as
                // arpeggiations on the internal 8th/16th grid. Those short bass notes should
                // not flip the harmony label/figures on weak subdivisions.
                try {
                    if (v === 4 && isCompoundMeter) {
                        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                        const absBeat = Number(event.absBeat);
                        const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                        const strongPulse = isStrongPulseInMeasure(inMeasure);
                        const base = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25, 'thirty-second': 0.125, 'sixty-fourth': 0.0625 } as any)[n.duration || 'quarter'] || 1;
                        let dur = base;
                        if (n.isDotted) dur *= 1.5;
                        if (n.isTriplet) dur *= 2 / 3;
                        if (n.isDuplet) dur *= 3 / 2;
                        if (!strongPulse && dur <= 0.51) {
                            // treat as non-structural bass motion (arpeggio/passing)
                            continue;
                        }
                    }
                } catch { /* ignore */ }

                if (isNonChordToneAtLabelEvent(n, event.absBeat)) {
                    // If the current active note for this voice is a suspension onset,
                    // do not keep any structural note for this voice at this scanpoint.
                    // For other ornaments (passing/neighbor/etc.), keep the previous structural note.
                    try {
                        const s = (n as any)?.isSuspension;
                        if (s && typeof s.fromAbsBeat === 'number' && Math.abs((s.fromAbsBeat as number) - Number(event.absBeat)) < 1e-3) {
                            lastStructural.delete(v);
                        }
                    } catch { /* ignore */ }
                    continue;
                }
                lastStructural.set(v, n);
            }

            const harmonicNotes = Array.from(lastStructural.values()).filter(Boolean);
            const fallbackHarmonicNotes = (harmonicNotes.length >= 2)
                ? harmonicNotes
                : (fullNotes || []).filter((n: any) => n && !n.isRest);
            const baseHarmonicNotes = (fallbackHarmonicNotes.length >= 2)
                ? fallbackHarmonicNotes
                : (fullNotes || []).filter((n: any) => n && !n.isRest);

            // If a suspension originates at this event, the held tone is a non-chord tone
            // against the new harmony. Exclude it from the chord-analysis snapshot so we
            // don't accidentally label the verticality as a sus/add sonority (e.g. V7/6).
            const SUSP_EPS = 1e-3;
            const harmonicNotesNoSuspAtThisBeat = fallbackHarmonicNotes.filter((n: any) => {
                const s = n?.isSuspension;
                if (!s || typeof s.fromAbsBeat !== 'number') return true;
                return Math.abs(s.fromAbsBeat - event.absBeat) >= SUSP_EPS;
            });
            const analysisNotes = (harmonicNotesNoSuspAtThisBeat.length >= 2)
                ? harmonicNotesNoSuspAtThisBeat
                : harmonicNotes;

            // For naming (roman + chord symbol), treat consonant "neighbor/anticipation" notes on
            // strong beats as chord tones. This avoids cases where a true chord tone gets tagged as
            // NCT and then removed inside getRomanAnalysis/getChordSymbol, collapsing a triad to a dyad
            // (e.g. Bb/D -> iii5 and missing chord symbol).
            const analysisNotesForNaming = (() => {
                try {
                    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                    const absBeat = Number(event.absBeat);
                    const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                    const isStrong = isStrongPulseInMeasure(inMeasure);

                    if (!isStrong) return analysisNotes;

                    return (analysisNotes || []).map((n: any) => {
                        if (!n || n.isRest) return n;
                        const s = n.isSuspension;
                        const isSusp = !!s && typeof s.fromAbsBeat === 'number';
                        const isNctFlag = !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura);

                        if (!isNctFlag && !isSusp) return n;

                        // Use fullNotes so consonance is evaluated against the real bass.
                        const dissonantVsBass = isDissonantIntervalAgainstBass(n, fullNotes || []);

                        // Only drop/keep suspension behavior at its actual onset. During preparation,
                        // a note can be marked as isSuspension but should still count as chord tone.
                        const isSuspStartHere = isSusp && Math.abs((s.fromAbsBeat as number) - absBeat) < SUSP_EPS;
                        if (isSusp && isSuspStartHere) return n;

                        if (dissonantVsBass) return n;

                        return {
                            ...n,
                            isNeighbor: false,
                            isAnticipation: false,
                            isAppoggiatura: false,
                            isSuspension: isSusp ? undefined : n.isSuspension,
                        };
                    });
                } catch {
                    return analysisNotes;
                }
            })();

            // Bass-driven stability: avoid re-labeling on every upper-voice onset.
            // If the bass pitch-class is unchanged, keep the previous label (unless this is the first label).
            const bassNote = (analysisNotes || [])
                .filter((n: any) => n && !n.isRest && Number.isFinite(n.midi))
                .slice()
                .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
            const bassPc = bassNote && Number.isFinite(bassNote.midi) ? (((bassNote.midi % 12) + 12) % 12) : null;

            // If the harmonic content doesn't change (only ornaments changed), skip.
            const harmonicSig = signatureFromNotes(baseHarmonicNotes);
            const fullSig = signatureFromNotes(fullNotes || []);
            if (!harmonicSig || baseHarmonicNotes.length < 2) {
                return;
            }

            const applicableContext = ctxAtAbsBeat(event.absBeat);
            const contextTonic = applicableContext ? applicableContext.newTonic : currentTonic;
            const contextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinorMode;

            const ctxKey = `${contextTonic}::${contextIsMinor ? 'm' : 'M'}`;
            const prevSig = lastSigBySystem.get(systemIndex);
            const prevCtx = lastCtxBySystem.get(systemIndex);
            const prevBassPc = lastBassPcBySystem.get(systemIndex);

            const hasOrnamentOnsetAtThisBeat = (() => {
                try {
                    // Only true "ornaments" should create hidden markers for the generic harmony hold-line.
                    // Passing notes already have their own connection/line, so don't double-draw.
                    return (fullNotes || []).some((n: any) => {
                        if (!n || n.isRest) return false;
                        return !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura || n.isEscape);
                    });
                } catch {
                    return false;
                }
            })();

            const shouldSuppressAsCompletion = (() => {
                try {
                    if (!prevSig || prevCtx !== ctxKey) return false;
                    if (prevBassPc == null || bassPc == null) return false;
                    if (prevBassPc !== bassPc) return false;

                    const prevPcs = new Set(prevSig.split('-').filter(Boolean).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)));
                    const curPcs = new Set(harmonicSig.split('-').filter(Boolean).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)));
                    if (prevPcs.size !== 2) return false;
                    if (curPcs.size !== 3) return false;
                    for (const p of prevPcs) if (!curPcs.has(p)) return false;

                    // Case A: completion to the diatonic triad implied by the bass.
                    {
                        const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                        if (inferred) {
                            const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
                            const ok = Array.from(curPcs).every(p => triadSet.has(p));
                            if (ok) return true;
                        }
                    }

                    // Case B: completion to the previous *diatonic* triad (shell -> full triad)
                    // e.g. vi6 shell (C–E over C) -> vi6 (A–C–E over C).
                    {
                        const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                        if (prevRoman && !String(prevRoman).includes('/')) {
                            const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                            if (prevTriad) {
                                const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                                const okPrev = Array.from(prevPcs).every(p => triadSet.has(p));
                                const okCur = Array.from(curPcs).every(p => triadSet.has(p));
                                if (okPrev && okCur) return true;
                            }
                        }
                    }

                    return false;
                } catch {
                    return false;
                }
            })();

            const hasSuspensionOnsetHere = (() => {
                try {
                    return (analyzedNotes as any[] || []).some((n: any) =>
                        n &&
                        n.isSuspension &&
                        typeof (n as any).isSuspension?.fromAbsBeat === 'number' &&
                        Math.abs(((n as any).isSuspension.fromAbsBeat as number) - event.absBeat) < 1e-6,
                    );
                } catch {
                    return false;
                }
            })();

            const previewRoman = (() => {
                try {
                    const r = getRomanAnalysis((analysisNotesForNaming || []) as any, contextTonic, contextIsMinor);
                    if (r?.roman) return String(r.roman);
                    const rFull = getRomanAnalysis((fullNotes || []) as any, contextTonic, contextIsMinor);
                    return rFull?.roman ? String(rFull.roman) : '';
                } catch {
                    return '';
                }
            })();

            // Compound-meter noise guard:
            // If we're on an internal 8th subdivision (non-strong pulse) and the bass hasn't changed,
            // don't emit a new harmony label/figures just because upper voices arpeggiate/passage.
            // Keep the previous label alive via a hidden marker so the hold-line renderer can show continuity.
            try {
                if (!hasSuspensionOnsetHere && isCompoundMeter) {
                    const absBeat = Number(event.absBeat);
                    const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                    const strongPulse = isStrongPulseInMeasure(inMeasure);

                    if (!strongPulse && prevCtx === ctxKey && prevBassPc != null && bassPc != null && prevBassPc === bassPc) {
                        const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                        if (prevRoman2) {
                            const x = getXForAbsBeat(event.absBeat, system);
                            labelsBySystem[systemIndex].push({
                                id: `hlabel-hidden-compound-${systemIndex}-${event.absBeat}`,
                                x,
                                roman: prevRoman2,
                                figures: lastFiguresBySystem.get(systemIndex) || [],
                                symbol: '',
                                absBeat: event.absBeat,
                                hiddenMarker: true,
                            });
                        }
                        return;
                    }
                }
            } catch { /* ignore */ }

            const hasHiddenChange = !!(fullSig && prevSig && fullSig !== prevSig);
            if (!hasSuspensionOnsetHere && !hasHiddenChange && ((prevSig === harmonicSig && prevCtx === ctxKey) || shouldSuppressAsCompletion)) {
                const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                if (previewRoman && prevRoman && previewRoman !== prevRoman) {
                    // Real harmonic change -> do not suppress.
                } else {
                // Keep the label stable, but record that *something happened* here (ornament/appoggiatura)
                // so the renderer can draw a short hold-line across hidden beats.
                if (hasOrnamentOnsetAtThisBeat || shouldSuppressAsCompletion) {
                    const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman) {
                        const x = getXForAbsBeat(event.absBeat, system);
                        labelsBySystem[systemIndex].push({
                            id: `hlabel-hidden-${systemIndex}-${event.absBeat}`,
                            x,
                            roman: prevRoman,
                            figures: lastFiguresBySystem.get(systemIndex) || [],
                            symbol: '',
                            absBeat: event.absBeat,
                            hiddenMarker: true,
                        });
                    }
                }
                return;
                }
            }
            lastSigBySystem.set(systemIndex, harmonicSig);
            lastCtxBySystem.set(systemIndex, ctxKey);
            lastBassPcBySystem.set(systemIndex, bassPc);

            // L2: figures depend only on the actual vertical intervals above the real bass.
            // Never derive/overwrite them from roman/symbol/quality.
            let figures: string[] = computeFiguredBassFromNotes(analysisNotes as any, FIGURED_BASS_UI_OPTIONS).figures;

            let roman = '';
            let symbol = '';
            let isAug6Roman = false;

            // Display-only roman (e.g. I=VI). Must be declared before any override blocks.
            let romanDisplay: string | undefined = undefined;

            const prevRoman = lastRomanBySystem.get(systemIndex) || '';
            const prevRootPc = lastChordRootPcBySystem.get(systemIndex);
            const prevType = lastChordTypeBySystem.get(systemIndex);

            try {
                const r = getRomanAnalysis(analysisNotesForNaming as any, contextTonic, contextIsMinor);
                if (r) {
                    roman = r.roman;
                    isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                }

                // Rescue: if naming-filter collapses a triad to a dyad, vii° can be a false positive.
                // Prefer the analysis of the fuller verticality when it yields a plausible dominant/tonic label.
                try {
                    const rr0 = String(roman || '');
                    const pcCount = (arr: any[]): number => {
                        try {
                            const set = new Set<number>();
                            for (const n of (arr || [])) {
                                if (!n || n.isRest) continue;
                                const ni = Number(n.noteIndex);
                                const mi = Number(n.midi);
                                const pc = Number.isFinite(ni) ? ((ni % 12) + 12) % 12 : Number.isFinite(mi) ? ((mi % 12) + 12) % 12 : null;
                                if (pc == null) continue;
                                set.add(pc);
                            }
                            return set.size;
                        } catch {
                            return 0;
                        }
                    };
                    const pcsNaming = pcCount(analysisNotesForNaming as any);
                    const pcsAnalysis = pcCount(analysisNotes as any);
                    const pcsFull = pcCount((fullNotes || []) as any);

                    // Common failure mode: a dominant 7th loses its root (often filtered as NCT/held noise),
                    // leaving the leading-tone diminished shell (e.g. B–D–F) -> vii°.
                    // If the *full* verticality contains extra pitch-classes beyond the naming snapshot,
                    // re-run the roman on fuller sets and prefer V/Vx labels.
                    const hasMoreInfoInFull = pcsFull > pcsNaming && pcsFull >= 4;
                    if (rr0.startsWith('vii') && ((pcsNaming > 0 && pcsNaming < 3 && (pcsAnalysis >= 3 || pcsFull >= 3)) || hasMoreInfoInFull)) {
                        const alt1 = getRomanAnalysis(analysisNotes as any, contextTonic, contextIsMinor);
                        const alt2 = getRomanAnalysis((fullNotes || []) as any, contextTonic, contextIsMinor);
                        const isPlausible = (s: string) => {
                            const t = String(s || '').trim();
                            return t === 'V' || t === 'I' || t === 'v' || t === 'i' || t.startsWith('V/') || t.startsWith('I/') || t.startsWith('v/') || t.startsWith('i/');
                        };
                        const pick = [alt1, alt2].find(x => x?.roman && isPlausible(String(x.roman)));
                        if (pick?.roman) {
                            roman = String(pick.roman);
                            isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                        }
                    }
                } catch {
                    // ignore
                }

                // Rescue: if a local context makes a clear global dominant look like III.
                // Example (reported): in A major, E/B (V6/4) can be displayed as III6/4 when the
                // active context is (wrongly) treated as C# minor. If the chord resolves to I (A)
                // shortly after, prefer the global dominant reading.
                try {
                    const rrHere = String(roman || '').trim();
                    if (rrHere === 'III' || rrHere === 'iii') {
                        const g = getRomanAnalysis(analysisNotesForNaming as any, currentTonic, isMinorMode);
                        const gRoman = String(g?.roman || '').trim();
                        const isGlobalDominant = gRoman === 'V' || gRoman === 'v' || gRoman.startsWith('V/') || gRoman.startsWith('v/');
                        if (isGlobalDominant) {
                            const maxAhead = (beatsPerMeasure * 2) + 1e-6;
                            let resolvesToGlobalI = false;
                            for (let t = eventIndex + 1; t < timelineForLabels.length; t++) {
                                const ev2: any = timelineForLabels[t];
                                if (!ev2) continue;
                                const dt = Number(ev2.absBeat) - Number(event.absBeat);
                                if (!Number.isFinite(dt) || dt < -1e-6) continue;
                                if (dt > maxAhead) break;
                                const r2 = getRomanAnalysis((ev2?.notes || []) as any, currentTonic, isMinorMode);
                                const rr2 = String(r2?.roman || '').trim();
                                if (rr2 === (isMinorMode ? 'i' : 'I')) {
                                    resolvesToGlobalI = true;
                                    break;
                                }
                            }
                            if (resolvesToGlobalI) {
                                roman = gRoman;
                                isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                            }
                        }
                    }
                } catch {
                    // ignore
                }

                // Rescue: secondary dominants (V/x) should stay visible even in inversions.
                // In some sparse/incomplete verticalities (common when voices are tied or filtered as NCT),
                // getRomanAnalysis can return null/empty, leaving only Arabic figures (6, 6/5, ...).
                // If chord candidates yield a confident V/x under the current context, prefer that label.
                try {
                    if (!roman) {
                        const candidates = identifyChordCandidates(analysisNotesForNaming as any);
                        let bestSecondary: { roman: string; score: number } | null = null;
                        for (const c of (candidates as any[]) || []) {
                            const rr = calculateRomanFromChordInfo({ root: c.root, type: c.type, intervals: c.intervals }, contextTonic, contextIsMinor);
                            if (!rr || !String(rr).startsWith('V/')) continue;
                            const score = Number.isFinite((c as any).score) ? Number((c as any).score) : 0;
                            if (!bestSecondary || score > bestSecondary.score) bestSecondary = { roman: rr, score };
                        }
                        if (bestSecondary) roman = bestSecondary.roman;
                    }
                } catch { /* ignore */ }

                const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
                // Symbols should reflect the actual verticality (including altered tones),
                // while roman/figures follow the structural snapshot.
                const s = getChordSymbol((fullNotes || []) as any, contextKeySignature, contextTonic);
                if (s) symbol = s;

                // Rescue: slash chords + stuck context.
                // If the symbol root is clear (e.g. E/B) and that root is the dominant of the GLOBAL key,
                // but the current context yields III/iii (common when a local context gets "stuck"),
                // prefer the global dominant roman derived from the symbol root.
                try {
                    const rrHere = String(roman || '').trim();
                    if (symbol && (rrHere === 'III' || rrHere === 'iii')) {
                        const symRaw = String(symbol || '');
                        const symNorm = symRaw.replace('♯', '#').replace('♭', 'b');
                        const symForFunction = (symNorm.split('/')[0] || symNorm).trim();
                        const m = symForFunction.match(/^([A-G])([#b]?)/);
                        if (m) {
                            const rootName = `${m[1]}${m[2] || ''}`;
                            const rootPc = noteNameToChromaticIndex(rootName);
                            const tonicPc = noteNameToChromaticIndex(String(currentTonic || 'C'));
                            const domOfGlobal = (rootPc != null && tonicPc != null) && ((((rootPc - tonicPc) % 12) + 12) % 12) === 7;

                            const looksMajorish = (() => {
                                if (!symForFunction) return false;
                                if (/maj7/i.test(symForFunction)) return false;
                                if (/m7/i.test(symForFunction)) return false;
                                if (/\bm(?!aj)/i.test(symForFunction)) return false;
                                if (symForFunction.includes('°') || /dim/i.test(symForFunction)) return false;
                                if (/sus/i.test(symForFunction) || /add/i.test(symForFunction)) return false;
                                return true;
                            })();

                            if (domOfGlobal && looksMajorish) {
                                const virtualRootMidi = 60 + ((((rootPc as number) % 12) + 12) % 12);
                                const virtualRoot = ({ id: 'virtual-root', pitch: 'C', octave: 4, position: 0, midi: virtualRootMidi, noteIndex: rootPc } as any);
                                const has7 = /7|9|11|13/.test(symForFunction);
                                const forcedGlobal = calculateRomanFromChordInfo({ root: virtualRoot, type: has7 ? 'Dominant 7' : 'Major' }, currentTonic, isMinorMode);
                                if (forcedGlobal && (String(forcedGlobal).startsWith('V') || String(forcedGlobal).startsWith('v'))) {
                                    roman = String(forcedGlobal);
                                    isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }

                // Fallback for tonic minor-maj7: if symbol matches and roman is still empty, show I7.
                try {
                    if (!roman && symbol && contextIsMinor) {
                        const sym = String(symbol || '').replace('♯', '#').replace('♭', 'b');
                        if (/m\(maj7\)|mmaj7|minmaj7/i.test(sym)) {
                            const rootMatch = sym.match(/^([A-G])([#b]?)/);
                            const rootName = rootMatch ? `${rootMatch[1]}${rootMatch[2] || ''}` : '';
                            const rootPc = rootName ? noteNameToChromaticIndex(rootName) : null;
                            const tonicPc = contextTonic ? noteNameToChromaticIndex(contextTonic) : null;
                            if (rootPc != null && tonicPc != null && rootPc === tonicPc) {
                                roman = 'I7';
                            }
                        }
                    }
                } catch { /* ignore */ }

                // If the chord symbol explicitly indicates a slash (e.g. D7/F#),
                // prefer roman derived from the *symbol root*.
                // Under suspensions/ties, identifyChordCandidates can mis-root and collapse
                // into misleading labels like I4/7.
                try {
                    // (slash-root roman override removed)
                } catch { /* ignore */ }

            // If we only have a dyad (2 pitch classes), roman labeling is inherently ambiguous.
            // Prefer a diatonic bass-inferred label to avoid V/III misreads on power-chord shells
            // (e.g. C–G should read as I in C, A–E as vi).
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                const pcs = pcSetFromNotes(analysisNotes as any);
                if (!isSecondaryOrSlashRoman && bassPc != null && pcs.size <= 2) {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        roman = inferred.roman;
                    }
                }
            } catch { /* ignore */ }

            // --- Shell continuation (appoggiature / sparse textures) ---
            // If the previous label is a diatonic triad (e.g. vi) and the current vertical
            // is just a sparse subset of that triad (often 2 PCs, because one chord tone is
            // momentarily missing), keep the previous Roman numeral and reflect the inversion
            // from the bass.
            // This prevents weak-beat shells like C–E over C from collapsing to I when the
            // intended harmony is still vi6 (A–C–E with A omitted).
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                const pcs = pcSetFromNotes(analysisNotes as any);
                if (!isSecondaryOrSlashRoman && prevRoman && bassPc != null && pcs.size > 0 && pcs.size <= 2) {
                    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                    if (prevTriad) {
                        const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                        }
                    }
                }
            } catch { /* ignore */ }

            // --- Diatonic shell/rootless inference (your "due accordi" policy) ---
            // This is a *fallback* only: use the bass to infer a diatonic triad when we
            // cannot confidently label the harmony. Do NOT override an existing roman label,
            // otherwise inversions start looking like "root=bass".
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                if (!isSecondaryOrSlashRoman && bassPc != null && !roman) {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        const pcs = pcSetFromNotes(analysisNotes as any);
                        const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
                        const pcsSubset = isSubset(pcs, triadSet);
                        // Allow very sparse sets (2 pcs) to still count as the triad.
                        if (pcsSubset && pcs.size > 0 && pcs.size <= 3) {
                            roman = inferred.roman;
                        }
                    }
                }
            } catch { /* ignore */ }

            // --- Post-processing: infer inversions from the previous harmony when the bass moves
            // to a chord tone.
            try {
                const pcs = pcSetFromNotes(analysisNotes as any);
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                if (prevRoman && prevRootPc != null && prevType && bassPc != null && roman && roman !== prevRoman && !String(roman).includes('/')) {
                    const triad = triadPcsFromRootAndType(prevRootPc, prevType);
                    if (triad) {
                        const triadSet = new Set<number>([triad.root, triad.third, triad.fifth]);
                        // Current vertical may be rootless; allow subset of the triad.
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                        }
                    }
                }

                // If the previous chord is a *diatonic triad label* (I/ii/iii/IV/V/vi/vii° etc.)
                // keep that roman when the current vertical is a subset of its triad, even if the
                // bass alone would imply a different diatonic root (e.g. Am/C shell -> vi6, not I).
                if (prevRoman && bassPc != null && roman && roman !== prevRoman && !String(roman).includes('/')) {
                    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                    if (prevTriad) {
                        const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                        }
                    }
                }
            } catch (_) {
                // ignore
            }

            } catch (_) {
                // ignore
            }

            // Capture the most likely chord root/type for inversion inference on the next label.
            try {
                const candidates = identifyChordCandidates(analysisNotesForNaming || []);
                if (candidates && candidates.length) {
                    const chosen = candidates[0];
                    const rootPc = (chosen?.root?.noteIndex ?? null);
                    if (rootPc != null && Number.isFinite(rootPc)) lastChordRootPcBySystem.set(systemIndex, (((rootPc % 12) + 12) % 12));
                    if (chosen?.type) lastChordTypeBySystem.set(systemIndex, String(chosen.type));
                }
            } catch (_) {}

            if (roman) {
                lastRomanBySystem.set(systemIndex, roman);
                lastFiguresBySystem.set(systemIndex, (figures || []).slice());
            }

            // If a suspension originates at this event, prefer showing the resolution's Roman
            // at the suspension onset and include the suspension type as figured label.
            try {
                // Determine if this event is the suspension onset using the explicit
                // `fromAbsBeat` field (connections are ambiguous with tied notes).
                const suspNotes = (analyzedNotes as any[] || []).filter((n: any) => {
                    const s = n?.isSuspension;
                    if (!s || typeof s.fromAbsBeat !== 'number') return false;
                    return Math.abs(s.fromAbsBeat - event.absBeat) < 1e-6;
                });

                if (suspNotes.length) {
                    const suspInfos = suspNotes
                        .map((sn: any) => ({
                            sn,
                            s: (sn as any)?.isSuspension,
                            type: String((sn as any)?.isSuspension?.type ?? ''),
                        }))
                        .filter((x: any) => !!x.s);
                    if (!suspInfos.length) return;

                    // Use one suspension as the Roman-resolution driver. For double suspensions,
                    // the resolution harmony should be the same.
                    const sForRoman = (suspInfos.find((x: any) => typeof x?.s?.resolvedById === 'string' && x.s.resolvedById) || suspInfos[0]).s;

                    const normalizeSuspNum = (num: number): number | null => {
                        try {
                            if (!Number.isFinite(num)) return null;
                            const n = Math.round(num);
                            if (n <= 0) return null;
                            return (((n - 1) % 7 + 7) % 7) + 1;
                        } catch {
                            return null;
                        }
                    };
                    const normalizeFigureString = (fig: string): string => {
                        const s = String(fig ?? '').trim();
                        if (!s) return s;
                        // Preserve special cases we intentionally show as compound figures.
                        // (9-8 suspensions are shown with a 9 at the onset, not 2.)
                        const m = s.match(/(\d+)/);
                        if (!m) return s;
                        const n = parseInt(m[1], 10);
                        if (!Number.isFinite(n) || n <= 0) return s;
                        if (n === 8 || n === 9) return s;
                        if (n > 9) {
                            const simple = (((n - 1) % 7 + 7) % 7) + 1;
                            return s.replace(m[1], String(simple));
                        }
                        return s;
                    };
                    const CLASSIC_TYPES = new Set(['4-3', '6-5', '7-6', '7-8', '8-7', '9-8', '2-3']);
                    const classicSuspInfos = suspInfos.filter((x: any) => CLASSIC_TYPES.has(String(x.type)));
                    const allSuspensionsClassic = classicSuspInfos.length > 0 && classicSuspInfos.length === suspInfos.length;
                    const hasNineEight = classicSuspInfos.some((x: any) => String(x.type) === '9-8');
                    const hasTwoThree = classicSuspInfos.some((x: any) => String(x.type) === '2-3');
                    // Prefer showing the Roman numeral of the *resolution harmony*.
                    // This matches traditional analysis where the dissonance is a
                    // non-chord tone against the new chord, and aligns with how we
                    // label other suspensions/ritardi.
                    let resolvedRoman: string | null = null;
                    let resEvForSusp: any | null = null;
                    try {
                        if (sForRoman && typeof sForRoman.resolvedById === 'string' && sForRoman.resolvedById) {
                            const resEv = (timeline || [])
                                .filter((ev: any) => typeof ev?.absBeat === 'number' && ev.absBeat >= event.absBeat - 1e-6)
                                .find((ev: any) => (ev?.notes || []).some((nn: any) => nn?.id === sForRoman.resolvedById));
                            if (resEv) {
                                resEvForSusp = resEv;
                                const ctxRes = ctxAtAbsBeat(resEv.absBeat);
                                const tonicRes = ctxRes ? ctxRes.newTonic : contextTonic;
                                const isMinorRes = ctxRes ? ctxRes.newIsMinor : contextIsMinor;
                                const rRes = getRomanAnalysis(resEv.notes || [], tonicRes, isMinorRes);
                                if (rRes?.roman) resolvedRoman = rRes.roman;
                            }
                        }
                    } catch (_) {}

                    // IMPORTANT: `analysisNotes` already excludes the suspended note at this beat,
                    // so `roman` computed earlier is typically the correct *resolution harmony*.
                    // However, in some double-suspension / incomplete voicings the onset can be
                    // mis-read as a diatonic triad (e.g. iii) even though the resolution harmony
                    // is a clear dominant/secondary dominant (e.g. V/vi). In that case, prefer
                    // the resolution-event Roman at the suspension onset.
                    {
                        const onsetRoman = String(roman || '').trim();
                        const resRoman = String(resolvedRoman || '').trim();
                        const isDominantish = (r: string) => r === 'V' || r.startsWith('V/');
                        const isPlainDiatonic = (r: string) => !!r && !r.includes('/') && !r.includes('It+') && !r.includes('Fr+') && !r.includes('Ger+');

                        if ((!onsetRoman && resRoman) || (isPlainDiatonic(onsetRoman) && isDominantish(resRoman) && resRoman !== onsetRoman)) {
                            roman = resRoman;
                        }
                        if (!roman) {
                            // Fallback: underlying harmony at suspension onset.
                            const rHere = getRomanAnalysis(analysisNotes as any, contextTonic, contextIsMinor);
                            if (rHere) roman = rHere.roman || roman;
                        }
                    }

                    // In very sparse textures (e.g. G–E with the suspension filtered out),
                    // the chord-ID can flip to iii even though the intended harmony is V.
                    // Stabilize by preferring a resolution-event chord candidate that matches
                    // the bass pitch-class, and as a last resort force V over dominant bass.
                    try {
                        // Don't clobber secondary dominants (V/x) with sparse-texture heuristics.
                        if (String(roman).includes('/')) {
                            // keep as-is
                        } else {
                        const evForRoman = (resEvForSusp || event) as any;
                        const evNotes = (evForRoman?.notes || []) as any[];
                        const bassNote = evNotes.slice().sort((x, y) => (x?.midi ?? 0) - (y?.midi ?? 0))[0];
                        const bassPc = (bassNote && Number.isFinite(bassNote.midi)) ? ((bassNote.midi % 12) + 12) % 12 : null;
                        const ctxHere = ctxAtAbsBeat(evForRoman?.absBeat ?? event.absBeat);
                        const tonicHere = ctxHere ? ctxHere.newTonic : contextTonic;
                        const isMinorHere = ctxHere ? ctxHere.newIsMinor : contextIsMinor;

                        const candidates = identifyChordCandidates(evNotes);
                        if (candidates && candidates.length) {
                            // If we already have a Roman label, prefer the chord candidate that
                            // agrees with it (important for inversions like ii6 over Ab bass).
                            let preferred: any = candidates[0];
                            try {
                                const curRoman = String(roman || '').trim();
                                if (curRoman) {
                                    const matching = (candidates as any[]).find((c: any) => {
                                        const rr = calculateRomanFromChordInfo({ root: c.root, type: c.type, intervals: c.intervals }, tonicHere, isMinorHere);
                                        return rr === curRoman;
                                    });
                                    if (matching) preferred = matching;
                                } else if (bassPc != null) {
                                    preferred = (candidates as any[]).find(c => (c?.root?.noteIndex ?? null) === bassPc) || candidates[0];
                                }
                            } catch { /* ignore */ }

                            const forced = preferred
                                ? calculateRomanFromChordInfo({ root: preferred.root, type: preferred.type, intervals: preferred.intervals }, tonicHere, isMinorHere)
                                : null;
                            if (forced && !roman) roman = forced;
                        }
                        }
                    } catch (_) {}

                    // Figures policy:
                    // - Classic suspensions (4-3/6-5/7-6/9-8): show the suspension figure(s) next to the Roman
                    //   (e.g. V4/5, V6), and show only the resolution number at the end of the hold-line.
                    // - Non-classic ritardi (e.g. bass retardation): prefer vertical figures computed on the
                    //   full sounding set at the onset.
                    if (allSuspensionsClassic) {
                        try {
                            // Compute onset figures from the *structural* notes at this event (including the held tone),
                            // otherwise we risk getting a sanitized chord that hides the suspension.
                            const onsetFigures = (computeFiguredBassFromNotes((harmonicNotes || []) as any, FIGURED_BASS_UI_OPTIONS).figures || figures || [])
                                .map(normalizeFigureString);

                            // Ensure the suspension-from figure(s) are present (double suspensions => multiple)
                            const fromWanteds = classicSuspInfos
                                .map((x: any) => {
                                    const suspType = String(x.type ?? '');
                                    if (suspType === '4-3') return 4;
                                    if (suspType === '6-5') return 6;
                                    if (suspType === '7-6') return 7;
                                    if (suspType === '7-8') return 7;
                                    if (suspType === '8-7') return 8;
                                    if (suspType === '9-8') return 9;
                                    if (suspType === '2-3') return 2;
                                    return normalizeSuspNum(Number((x.s as any)?.fromNum));
                                })
                                .filter((n: any) => n != null);

                            const out: string[] = [];
                            const push = (x: string) => { if (x && !out.includes(x)) out.push(x); };
                            // Keep any onset figures (e.g., the 5 in a 4-3 over V)
                            onsetFigures.forEach(push);
                            fromWanteds.forEach((n: any) => push(String(n)));

                            // Special case: double suspension 9-8 + 4-3.
                            // For didactic alignment, drop the plain '5' (otherwise the onset figures
                            // can look visually "crossed" relative to the 8/3 resolution stack).
                            const isDoubleNineFour =
                                classicSuspInfos.length === 2 &&
                                hasNineEight &&
                                classicSuspInfos.some((x: any) => String(x.type) === '4-3');
                            if (isDoubleNineFour) {
                                for (let i = out.length - 1; i >= 0; i--) {
                                    if (out[i] === '5') out.splice(i, 1);
                                }
                            }
                            // Pedagogical convention: if a 9-8 suspension is present, prefer 9 over 2.
                            // (2 is the simple form of 9, but here we explicitly want 9 because it resolves to 8.)
                            if (hasNineEight && out.includes('9')) {
                                for (let i = out.length - 1; i >= 0; i--) {
                                    if (out[i] === '2') out.splice(i, 1);
                                }
                            }

                            // Conversely, for a 2-3 ascending ritardo, prefer 2 over 9.
                            // (We only prefer 9 in the specific 9-8 suspension convention.)
                            if (hasTwoThree && out.includes('2')) {
                                for (let i = out.length - 1; i >= 0; i--) {
                                    if (out[i] === '9') out.splice(i, 1);
                                }
                            }
                            // In double suspensions, order figures so the higher suspension-from figure
                            // appears above the lower one (avoids visual crossing like 9__3 / 4__8).
                            if (classicSuspInfos.length > 1) {
                                const extractNum = (t: string) => {
                                    const m = String(t || '').match(/(\d+)/);
                                    const n = m ? Number(m[1]) : Number.NaN;
                                    return Number.isFinite(n) ? n : Number.NaN;
                                };
                                figures = out.slice().sort((a, b) => {
                                    const an = extractNum(a);
                                    const bn = extractNum(b);
                                    const aa = Number.isFinite(an) ? an : -Infinity;
                                    const bb = Number.isFinite(bn) ? bn : -Infinity;
                                    return bb - aa;
                                });
                            } else {
                                figures = out;
                            }
                        } catch (_) {
                            figures = (figures || []).map(normalizeFigureString);
                        }
                    } else {
                        try {
                            const fullFigures = computeFiguredBassFromNotes((fullNotes || []) as any, FIGURED_BASS_UI_OPTIONS).figures;
                            if (fullFigures?.length) figures = fullFigures;
                            figures = (figures || []).map(normalizeFigureString);
                        } catch (_) {
                            figures = (figures || []).map(normalizeFigureString);
                        }
                    }
                }
            } catch (_) {}

            // If this event is the resolution target of a *classic* suspension (4-3/7-6/9-8),
            // suppress the harmony label here to avoid duplicate Roman numerals colliding with
            // the resolution-number glyph we draw near the resolved note.
            //
            // IMPORTANT: keep the Roman numeral at the resolution for non-classic cases
            // (e.g., the 2/4 ritardo we labeled with a resolving chord like ii).
            try {
                const CLASSIC_TYPES = new Set(['4-3', '6-5', '7-6', '7-8', '8-7', '9-8', '2-3']);

                const isSuspensionOnsetHere = (analyzedNotes as any[] || []).some((n: any) => {
                    const s = n?.isSuspension;
                    if (!s || typeof s.fromAbsBeat !== 'number') return false;
                    return Math.abs(s.fromAbsBeat - event.absBeat) < 1e-6;
                });
                const resolvingSuspensions = (analyzedNotes || [])
                    .map(n => (n as any)?.isSuspension)
                    .filter((s: any) => s && typeof s.resolvedById === 'string' && s.resolvedById)
                    .filter((s: any) => !!(event.notes && event.notes.find((nn: any) => nn.id === s.resolvedById)));

                if (resolvingSuspensions.length) {
                    const hasClassic = resolvingSuspensions.some((s: any) => CLASSIC_TYPES.has(String(s.type)));
                    const hasNonClassic = resolvingSuspensions.some((s: any) => !CLASSIC_TYPES.has(String(s.type)));
                    if (!isSuspensionOnsetHere && hasClassic && !hasNonClassic) {
                        // Only suppress if the harmony is unchanged (avoid hiding a real change).
                        const prevRomanForCompare = prevRoman || '';
                        const isMinorMajor7 = (() => {
                            const sym = String(symbol || '').replace('♯', '#').replace('♭', 'b');
                            return /m\(maj7\)|mmaj7|minmaj7/i.test(sym);
                        })();
                        if ((!roman || roman === prevRomanForCompare) && !isMinorMajor7) {
                            roman = '';
                            figures = [];
                            symbol = '';
                        }
                    }
                }
            } catch (_) {}

            // --- Rescue: secondary dominants from explicit chord symbol ---
            // In some cases (especially when ties/suspensions make the vertical set "dirty"),
            // the chord-ID can collapse into something like I with odd figures (e.g. 4 + 7),
            // even though the chord symbol is clearly a dominant seventh (e.g. D7 => V7/V in C).
            // Prefer the dominant-based roman when the symbol is unambiguous.
            try {
                const symRaw = String(symbol || '');
                const sym = symRaw.replace('♯', '#').replace('♭', 'b');
                // For functional inference we only care about the chord's root/quality;
                // if the symbol includes a slash bass (inversion), keep only the part before '/'.
                const symForFunction = sym.split('/')[0] || sym;

                const isDominantSymbol = (() => {
                    if (!symForFunction) return false;
                    if (/maj7/i.test(symForFunction)) return false;
                    if (/m7/i.test(symForFunction)) return false;
                    if (symForFunction.includes('°') || /dim7/i.test(symForFunction)) return false;
                    // IMPORTANT: do not treat "add9"/"sus" sonorities as dominants.
                    // Otherwise a plain tonic add9 like C–E–G–D becomes C7 => V/IV.
                    if (/add/i.test(symForFunction)) return false;
                    if (/sus/i.test(symForFunction)) return false;

                    // Dominant-type spellings in this app: "7", "7b9", "7#9", "11", "13", etc.
                    // - If it explicitly contains '7' (and isn't maj7/m7/dim7), treat as dominant.
                    // - If it contains 9/11/13 without 'maj' or 'm', treat as dominant shorthand (e.g. "C9").
                    if (/7/.test(symForFunction)) return true;
                    if (/(9|11|13)/.test(symForFunction) && !/maj/i.test(symForFunction) && !/\bm\b/i.test(symForFunction) && !/m(?!aj)/i.test(symForFunction)) {
                        return true;
                    }
                    return false;
                })();

                const looksLikeI47 = (() => {
                    const figs = (figures || []).map(f => String(f));
                    return String(roman || '') === 'I' && figs.includes('4') && figs.includes('7');
                })();

                if (isDominantSymbol && !String(roman || '').includes('/') && (looksLikeI47 || String(roman || '') === 'I')) {
                    const m = symForFunction.match(/^([A-G])([#b]?)/);
                    if (m) {
                        const rootName = `${m[1]}${m[2] || ''}`;
                        const rootPc = noteNameToChromaticIndex(rootName);
                        if (rootPc != null && rootPc >= 0) {
                            const virtualRootMidi = 60 + (((rootPc % 12) + 12) % 12);
                            const virtualRoot = ({ id: 'virtual-root', pitch: 'C', octave: 4, position: 0, midi: virtualRootMidi, noteIndex: rootPc } as any);
                            const forced = calculateRomanFromChordInfo({ root: virtualRoot, type: 'Dominant 7' }, contextTonic, contextIsMinor);
                            if (forced && String(forced).includes('/')) {
                                roman = forced;
                            }
                        }
                    }
                }

                // Rescue: diminished roman from missing/filtered dominant root.
                // If the symbol indicates a dominant-type chord (e.g. G7) but the roman analysis
                // landed on vii°/viiø7, prefer the dominant-function roman derived from the symbol root.
                // This specifically targets cases where the root was present in the full verticality
                // but got filtered out of the structural snapshot (ties/suspensions/NCT guards).
                if (isDominantSymbol && /^vii/i.test(String(roman || '').trim())) {
                    const m = symForFunction.match(/^([A-G])([#b]?)/);
                    if (m) {
                        const rootName = `${m[1]}${m[2] || ''}`;
                        const rootPc = noteNameToChromaticIndex(rootName);
                        if (rootPc != null && rootPc >= 0) {
                            const virtualRootMidi = 60 + (((rootPc % 12) + 12) % 12);
                            const virtualRoot = ({ id: 'virtual-root', pitch: 'C', octave: 4, position: 0, midi: virtualRootMidi, noteIndex: rootPc } as any);
                            const forced = calculateRomanFromChordInfo({ root: virtualRoot, type: 'Dominant 7' }, contextTonic, contextIsMinor);
                            if (forced && (String(forced).startsWith('V') || String(forced).startsWith('v'))) {
                                roman = forced;
                            }
                        }
                    }
                }
            } catch { /* ignore */ }

            // Auto (analysis) overrides: label-only tonicization. Never beats a user override.
            let isAutoOverrideHere = false;
            try {
                const a = qAbs(event.absBeat);
                if (!overrideByAbsBeat.has(a)) {
                    // 1) Engine-provided cadence overrides
                    const eng = getNear(engineOverrideByAbsBeat, a);
                    if (eng) {
                        if (eng.roman !== undefined) roman = eng.roman;
                        if (eng.symbol !== undefined) symbol = eng.symbol;
                        if (eng.figures !== undefined) figures = eng.figures;
                        if (eng.romanDisplay !== undefined) romanDisplay = eng.romanDisplay;
                        isAutoOverrideHere = true;
                    }

                    // 2) Editor-local overrides (legacy)
                    const auto = getNear(autoOverrideByAbsBeat, a);
                    if (auto) {
                        if (auto.roman !== undefined) roman = auto.roman;
                        if (auto.symbol !== undefined) symbol = auto.symbol;
                        if (auto.figures !== undefined) figures = auto.figures;
                        isAutoOverrideHere = true;
                    }
                }
            } catch { /* ignore */ }

            // User overrides: allow forcing Roman/figures/symbol at this absBeat.
            try {
                const ov = overrideByAbsBeat.get(qAbs(event.absBeat));
                if (ov) {
                    if (ov.roman !== undefined) roman = ov.roman;
                    if (ov.romanDisplay !== undefined) romanDisplay = ov.romanDisplay;
                    if (ov.symbol !== undefined) symbol = ov.symbol;
                    if (ov.figures !== undefined) figures = ov.figures;
                }
            } catch { /* ignore */ }

            // Final rescue: if we still ended up with vii° but the *unfiltered* verticality spells the
            // dominant major triad in the current key, prefer V.
            try {
                const rr = String(roman || '');
                if (rr.startsWith('vii')) {
                    const tonicPc = noteNameToChromaticIndex(contextTonic);
                    if (tonicPc != null && tonicPc >= 0) {
                        const domPc = (((tonicPc + 7) % 12) + 12) % 12;
                        const domTriad = new Set<number>([domPc, (domPc + 4) % 12, (domPc + 7) % 12]);
                        const pcs = new Set<number>();
                        for (const n of (fullNotes || []) as any[]) {
                            if (!n || n.isRest) continue;
                            const ni = Number((n as any).noteIndex);
                            const mi = Number((n as any).midi);
                            const pc = Number.isFinite(ni) ? (((ni % 12) + 12) % 12) : Number.isFinite(mi) ? (((mi % 12) + 12) % 12) : null;
                            if (pc == null) continue;
                            pcs.add(pc);
                        }
                        const matchesDom = pcs.size >= 3 && [...domTriad].every(x => pcs.has(x));
                        // Do not override a confident tonic label (I/i) to V.
                        // This prevents cadential barlines (e.g. Db→Gb in Gb major) from being displayed as V
                        // just because dominant chord tones may still be present in the full verticality.
                        if (matchesDom && !(roman === 'I' || roman === 'i')) roman = 'V';
                    }
                }
            } catch { /* ignore */ }

            // Display-only: when we are in a tonicization/modulation context, show pivot tonics as `I=V`.
            // This keeps the analysis context in the new key (so following chords aren't distorted),
            // while still showing the functional relation to the global key.

            // Display-only (label-only tonicization): show resolution pivot as i=ii, I=V, etc.
            try {
                const a = qAbs(event.absBeat);
                if (!overrideByAbsBeat.has(a) && !romanDisplay) {
                    const autoDisp = getNear(autoRomanDisplayByAbsBeat, a);
                    if (autoDisp) {
                        // If the override is a pure slash-function label (e.g. ii°/iii),
                        // apply it directly so the user doesn't still see the base label.
                        // Keep '=' pivots as display-only.
                        const s = String(autoDisp || '');
                        if (s.includes('/') && !s.includes('=')) {
                            roman = s;
                            romanDisplay = undefined;
                        } else {
                            romanDisplay = s;
                        }
                    }
                }
            } catch { /* ignore */ }

            // If an auto override changed the roman label, make it win in rendering.
            // Otherwise sequence functional relabeling can still be displayed on top.
            try {
                if (isAutoOverrideHere && roman && !romanDisplay) {
                    romanDisplay = String(roman);
                }
            } catch { /* ignore */ }
            try {
                const inNonGlobalContext = !!(applicableContext && (contextTonic !== currentTonic || contextIsMinor !== isMinorMode));
                const localRoman = String(roman || '');
                const localIsTonic = localRoman === 'I' || localRoman === 'i';
                if (inNonGlobalContext && localIsTonic) {
                    const global = getRomanAnalysis((analysisNotesForNaming || []) as any, currentTonic, isMinorMode);
                    const globalRoman = String(global?.roman || '');
                    const ctxLabelRaw = String((applicableContext as any)?.label || '').trim();
                    const ctxLabel = (() => {
                        // Keep it compact: take the first token (so "IV (subdom)" works).
                        const t = ctxLabelRaw.split(/\s+/g)[0] || '';
                        return t
                            .replace(/♭/g, 'b')
                            .replace(/♯/g, '#')
                            .replace(/𝄫/g, 'bb')
                            .replace(/𝄪/g, '##');
                    })();
                    const labelLooksRoman = (() => {
                        if (!ctxLabel) return false;
                        // Allow things like IV, ii, V/vi, bVII, #iv°, etc.
                        return /^([#b]*)(vii[°+ø]?|vi|iv|v|iii|ii|i)(\d+)?(\/(vii[°+ø]?|vi|iv|v|iii|ii|i))?$/i.test(ctxLabel);
                    })();

                    // Prefer explicit user label when provided.
                    if (!romanDisplay && labelLooksRoman) {
                        romanDisplay = `${localRoman}=${ctxLabel}`;
                    }

                    // Fallback: common/pedagogical I=V on dominant-key pivot.
                    if (!romanDisplay && globalRoman && globalRoman !== localRoman) {
                        if (globalRoman === 'V' || globalRoman.startsWith('V/')) {
                            romanDisplay = `${localRoman}=${globalRoman}`;
                        }
                    }
                }
            } catch { /* ignore */ }

            if (!roman && !symbol && !(figures && figures.length)) return;


            // Anchor label to the current timeline event's beat (not just the note's attack)
            const x = getXForAbsBeat(event.absBeat, system);

            labelsBySystem[systemIndex].push({
                id: `hlabel-${systemIndex}-${event.absBeat}`,
                x,
                roman,
                romanDisplay,
                figures,
                symbol,
                absBeat: event.absBeat,
                isOverride: overrideByAbsBeat.has(qAbs(event.absBeat)) || isAutoOverrideHere,
                pcsSig: signatureFromNotes((fullNotes || []) as any),
            });
        });

        // Sort labels in each system by x
        labelsBySystem.forEach(systemLabels => systemLabels.sort((a, b) => a.x - b.x));
        return labelsBySystem;
    }, [analysisContextAbsBeat, analysisContexts, analysisResult, analyzedNotes, currentTonic, effectiveAnalysisContexts, harmonyOverrides, isAnalysisEnabled, isMinorMode, layoutData, noteNameToChromaticIndex, timeSignature, timeSignatureChanges, enableInferredContexts, harmonyLabelMinSpanBeats]);

    // Detect simple harmonic progressions (sequenze) where a 2-measure motif repeats.
    // This is intentionally conservative: it looks for repeated *functional shapes* rather than
    // exact roman equality (e.g. I…V/ii repeating as ii…V/bIII).
    const progressionMarkersBySystem = useMemo(() => {
        if (!layoutData) return [] as Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>>;

        const beatsPerMeasureBase = timeSignature.numerator * (4 / timeSignature.denominator);
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!Number.isFinite(ab)) return 0;
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) {
                return Math.floor(ab / beatsPerMeasureBase);
            }
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const parseRoman = (r0: string): { main: string; secondary: string | null; trailing: string } => {
            // Robust Roman parser for formats like:
            // - V6, I64
            // - V/ii
            // - V6/ii, V65/ii
            // - V/ii6
            // We normalize accidentals (b/#) so matching is stable.
            const raw = String(r0 || '').trim();
            const normalizeGlyphs = (s: string) => s
                .replace(/♭/g, 'b')
                .replace(/♯/g, '#')
                .replace(/𝄫/g, 'bb')
                .replace(/𝄪/g, '##');
            const r = normalizeGlyphs(raw);

            const parts = r.split('/');
            const left = String(parts[0] || '').trim();
            const right = parts.length > 1 ? String(parts[1] || '').trim() : '';

            const splitRomanAndDigits = (seg: string): { roman: string; digits: string; rest: string } => {
                const m = seg.match(/^([ivIV°+ø#b]+)(\d*)(.*)$/);
                if (!m) return { roman: seg, digits: '', rest: '' };
                return { roman: String(m[1] || ''), digits: String(m[2] || ''), rest: String(m[3] || '') };
            };

            const l = splitRomanAndDigits(left);
            const r2 = right ? splitRomanAndDigits(right) : { roman: '', digits: '', rest: '' };

            // Anything after the roman+digits on either side is treated as trailing too.
            const trailing = `${l.digits || ''}${r2.digits || ''}${l.rest || ''}${r2.rest || ''}`.trim();
            const main = String(l.roman || '').trim();
            const secondary = r2.roman ? String(r2.roman).trim() : null;
            return { main, secondary: secondary || null, trailing };
        };
        const normFigures = (figs: any): string => {
            try {
                if (!Array.isArray(figs)) return '';
                return figs.map((x: any) => String(x)).filter(Boolean).join('');
            } catch {
                return '';
            }
        };

        type HarmonyEv = { absBeat: number; measureIndex: number; roman: string; figuresKey: string };
        const events: HarmonyEv[] = [];
        if (isAnalysisEnabled) {
            try {
                (harmonyLabelsBySystem || []).forEach((arr: any[]) => {
                    (arr || []).forEach((lbl: any) => {
                        const absBeat = Number(lbl?.absBeat);
                        const roman = String(lbl?.roman ?? '');
                        if (!Number.isFinite(absBeat) || !roman) return;
                        if (lbl?.hiddenMarker) return;
                        events.push({
                            absBeat,
                            measureIndex: findMeasureIndexForAbsBeat(absBeat),
                            roman,
                            figuresKey: normFigures(lbl?.figures),
                        });
                    });
                });
            } catch { /* ignore */ }
        }

        // Fallback: if the label pipeline produced zero harmony labels (events=0) but analysis is enabled,
        // compute a minimal roman timeline by sampling 3 structural points per measure.
        // This avoids false negatives caused by label-suppression heuristics.
        let usedFallback = false;
        if (isAnalysisEnabled && events.length === 0) {
            try {
                const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges);
                const ctxAtAbsBeatLocal = (absBeat: number) => (effectiveAnalysisContexts || [])
                    .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
                    .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

                const measuresInScore = (() => {
                    const s = new Set<number>();
                    (layoutData.positionedNotes || []).forEach((n: any) => {
                        const mi = Number(n?.measureIndex);
                        if (Number.isFinite(mi)) s.add(mi);
                    });
                    return Array.from(s).sort((a, b) => a - b);
                })();

                // Walk timeline once; for each sample absBeat, pick last event <= sample.
                const getNotesAt = (absBeat: number): any[] => {
                    try {
                        let best: any = null;
                        for (const ev of (timeline || [])) {
                            if (!ev || typeof ev.absBeat !== 'number') continue;
                            if (ev.absBeat <= absBeat + 1e-6) best = ev;
                            else break;
                        }
                        return (best?.notes || []) as any[];
                    } catch {
                        return [];
                    }
                };

                for (const m of measuresInScore) {
                    const start = (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number')
                        ? (measureStartAbsBeat[m] as number)
                        : (m * beatsPerMeasureBase);
                    const bpm = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number')
                        ? Math.max(1, Number(measureBeatsPerMeasure[m]))
                        : Math.max(1, beatsPerMeasureBase);

                    const sampleAbs = [0, 1 / 3, 2 / 3].map(fr => start + fr * bpm);
                    for (const a of sampleAbs) {
                        const notesHere = getNotesAt(a);
                        if (!notesHere || notesHere.length < 2) continue;
                        const ctx = ctxAtAbsBeatLocal(a);
                        const tonic = (ctx?.newTonic || currentTonic) as any;
                        const isMinor = typeof ctx?.newIsMinor === 'boolean' ? ctx.newIsMinor : isMinorMode;
                        const r = getRomanAnalysis(notesHere as any, tonic, isMinor);
                        const roman = String(r?.roman || '').trim();
                        if (!roman) continue;
                        events.push({ absBeat: a, measureIndex: m, roman, figuresKey: Array.isArray(r?.figures) ? r!.figures.join('') : '' });
                        usedFallback = true;
                    }
                }
            } catch { /* ignore */ }
        }

        const byMeasure = new Map<number, HarmonyEv[]>();
        if (events.length) {
            for (const ev of events) {
                if (!byMeasure.has(ev.measureIndex)) byMeasure.set(ev.measureIndex, []);
                byMeasure.get(ev.measureIndex)!.push(ev);
            }
            for (const [m, arr] of byMeasure.entries()) {
                arr.sort((a, b) => a.absBeat - b.absBeat);
                byMeasure.set(m, arr);
            }
        }

        const maxMeasureIndex = (() => {
            try {
                const xs = (layoutData?.systemsParams || []).flatMap((s: any) => Array.isArray(s?.measureIndices) ? s.measureIndices : []);
                const maxFromSystems = xs.length ? Math.max(...xs) : 0;
                const maxFromNotes = Math.max(0, ...((layoutData?.positionedNotes || []) as any[])
                    .map(n => Number(n?.measureIndex))
                    .filter(v => Number.isFinite(v)) as number[]);
                return Math.max(maxFromSystems, maxFromNotes);
            } catch {
                return 0;
            }
        })();

        const measureIndices = Array.from({ length: Math.max(0, maxMeasureIndex) + 1 }, (_, i) => i);

        const measureTokenSeq = (m: number): Array<{ main: string; secondary: string | null; fig: string }> => {
            const arr = (byMeasure.get(m) || []).slice();
            if (!arr.length) return [];

            // Normalize within a measure: many pieces have 3 functional snapshots per bar,
            // but the analyzer may emit extra labels (ornaments, releases on strong points, etc.).
            // Bucket events into beat-aligned slots for simple meters.
            // A fixed 3-slice scheme can miss patterns like IV6–V6–I–vi in 4/4 where changes fall on beat 4 and beat 2.
            const start = (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number')
                ? (measureStartAbsBeat[m] as number)
                : (m * beatsPerMeasureBase);
            const bpm = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number')
                ? Math.max(1, Number(measureBeatsPerMeasure[m]))
                : Math.max(1, beatsPerMeasureBase);

            const isCompoundMeter = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
            const slotCount = (() => {
                if (isCompoundMeter) return 3;
                const n = Math.round(bpm);
                // Keep it bounded; typical cases are 2..6.
                return Math.max(2, Math.min(8, Number.isFinite(n) ? n : 3));
            })();

            arr.sort((a, b) => a.absBeat - b.absBeat);

            // Bucket to a fixed number of slots per measure. Fill gaps with nearest previous/next so
            // the signature length stays stable across blocks.
            const bucketEv: Array<HarmonyEv | null> = Array.from({ length: slotCount }, () => null);
            for (const ev of arr) {
                const rel = (ev.absBeat - start) / bpm;
                const bucket = Math.max(0, Math.min(slotCount - 1, Math.floor(rel * slotCount)));
                if (!bucketEv[bucket]) bucketEv[bucket] = ev;
            }

            // Fill forward from previous
            for (let i = 0; i < slotCount; i++) {
                if (!bucketEv[i] && i > 0) bucketEv[i] = bucketEv[i - 1];
            }
            // Fill backward from next
            for (let i = slotCount - 1; i >= 0; i--) {
                if (!bucketEv[i] && i < (slotCount - 1)) bucketEv[i] = bucketEv[i + 1];
            }
            // If still empty (shouldn't), bail.
            if (bucketEv.every(x => !x)) return [];

            const tokens = bucketEv
                .filter(Boolean)
                .map((ev) => {
                    const p = parseRoman((ev as HarmonyEv).roman);
                    const fig = `${(ev as HarmonyEv).figuresKey || ''}${p.trailing || ''}`;
                    return { main: p.main, secondary: p.secondary, fig };
                });

            // Keep 3 slots, but collapse exact duplicates to avoid "T,T,T" noise.
            const out: Array<{ main: string; secondary: string | null; fig: string }> = [];
            for (const t of tokens) {
                const prev = out[out.length - 1];
                if (prev && prev.main === t.main && prev.secondary === t.secondary) continue;
                out.push(t);
            }
            return out;
        };

        const isDominantFunction = (t: { main: string; secondary: string | null; fig: string }): boolean => {
            try {
                const main = String(t?.main || '').trim();
                if (!main) return false;
                // Treat V and vii° (and common ascii variants like "viio") as dominant-function.
                if (main === 'V' || main === 'v') return true;
                if (/^vii/i.test(main)) return true;
            } catch { /* ignore */ }
            return false;
        };

        const measureRoleSeq = (m: number): string[] => {
            const toks = measureTokenSeq(m);
            if (!toks.length) return [];

            // Convert 3-slot-ish tokens to roles for matching. We want to recognize
            // the Dubois consonant progression shape X–D–X even when X changes (I, ii, iii...).
            const roles: string[] = toks.map(t => {
                if (isDominantFunction(t)) return 'D';
                if (t.secondary && String(t.main || '').toUpperCase() === 'V') return 'Dsec';
                return `${t.main}${t.secondary ? '/' + t.secondary : ''}`;
            });

            // If first and last are the same non-dominant harmony, collapse to X ... X.
            // This makes I–V–I and ii–V–ii comparable.
            if (roles.length >= 3) {
                const first = roles[0];
                const last = roles[roles.length - 1];
                if (first === last && first !== 'D' && first !== 'Dsec') {
                    roles[0] = 'X';
                    roles[roles.length - 1] = 'X';
                }
                // Also collapse any remaining non-dominant degrees to X if we have X endpoints.
                // This avoids mismatches like X,D,IV for ornaments.
                if (roles[0] === 'X' && roles[roles.length - 1] === 'X') {
                    for (let i = 1; i < roles.length - 1; i++) {
                        if (roles[i] !== 'D' && roles[i] !== 'Dsec') roles[i] = 'Xmid';
                    }
                }
            }
            return roles;
        };

        const blockSignature = (mStart: number): string => {
            const a0 = measureRoleSeq(mStart);
            const a1 = measureRoleSeq(mStart + 1);
            if (!a0.length || !a1.length) return '';
            return `${a0.join(',')}|${a1.join(',')}`;
        };

        const spans: Array<{ startMeasure: number; endMeasure: number; repeats?: number; source: 'auto' | 'annotated' | 'note' }> = [];

        // ---------------------------------------------------------
        // NOTE-MOTION detector (voice-leading pattern repetition)
        // ---------------------------------------------------------
        // Detect a 2-measure "motif" repeating in the next 2 measures by comparing
        // interval patterns on the bass and soprano lines (and their vertical interval).
        // This is designed to work even when Roman labels are unstable.
        try {
            const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges);
            const absBeats = (timeline || []).map(ev => Number(ev?.absBeat)).filter(Number.isFinite) as number[];

            const getNotesAtAbsBeat = (absBeat: number): any[] => {
                try {
                    if (!timeline?.length) return [];
                    // binary search: last event <= absBeat
                    let lo = 0;
                    let hi = absBeats.length - 1;
                    let best = 0;
                    while (lo <= hi) {
                        const mid = (lo + hi) >> 1;
                        const v = absBeats[mid];
                        if (v <= absBeat + 1e-6) {
                            best = mid;
                            lo = mid + 1;
                        } else {
                            hi = mid - 1;
                        }
                    }
                    const ev: any = (timeline as any[])[best];
                    return (ev?.notes || []) as any[];
                } catch {
                    return [];
                }
            };

            const midiForVoice = (notesHere: any[], voice: number): number | null => {
                try {
                    const pool = (notesHere || [])
                        .filter(n => n && !n.isRest && Number.isFinite(n.midi) && (n.voice ?? 1) === voice)
                        .map(n => Number(n.midi));
                    if (!pool.length) return null;
                    // In SATB each voice is monophonic; still, be safe.
                    if (voice === 4) return Math.min(...pool);
                    if (voice === 1) return Math.max(...pool);
                    // inner voices: pick median-ish
                    const sorted = pool.slice().sort((a, b) => a - b);
                    return sorted[Math.floor(sorted.length / 2)] ?? null;
                } catch {
                    return null;
                }
            };

            const beatsPerMeasureAt = (m: number): number => {
                const bpm = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number')
                    ? Number(measureBeatsPerMeasure[m])
                    : beatsPerMeasureBase;
                return Math.max(1, Number.isFinite(bpm) ? bpm : beatsPerMeasureBase);
            };

            const startAbsBeatOfMeasure = (m: number): number => {
                if (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number') return Number(measureStartAbsBeat[m]);
                return m * beatsPerMeasureBase;
            };

            const sampleAbsBeatsForMeasure = (m: number): number[] => {
                const start = startAbsBeatOfMeasure(m);
                const bpm = beatsPerMeasureAt(m);
                return [0, 1 / 3, 2 / 3].map(fr => start + fr * bpm);
            };

            const noteAbsBeat = (n: any): number => {
                const m = Number(n?.measureIndex ?? 0);
                const b = Number(n?.beat ?? 1);
                const start = startAbsBeatOfMeasure(m);
                return start + (b - 1);
            };

            const voiceOnsetSeqInWindow = (voice: number, startAbs: number, endAbs: number): { mids: number[]; timesQ: number[] } => {
                try {
                    const raw = ((layoutData.positionedNotes || []) as any[])
                        .filter(n => n && !n.isRest && Number.isFinite(n.midi) && (n.voice ?? 1) === voice)
                        .map(n => ({ abs: noteAbsBeat(n), midi: Number(n.midi) }))
                        .filter(x => Number.isFinite(x.abs) && x.abs >= startAbs - 1e-6 && x.abs < endAbs - 1e-6)
                        .sort((a, b) => a.abs - b.abs);

                    if (!raw.length) return { mids: [], timesQ: [] };

                    const mids: number[] = [];
                    const timesQ: number[] = [];
                    const span = Math.max(1e-6, endAbs - startAbs);
                    for (const x of raw) {
                        const last = mids[mids.length - 1];
                        if (last != null && x.midi === last) continue;
                        mids.push(x.midi);
                        // quantize normalized time to reduce jitter (1/48 of the block)
                        const t = (x.abs - startAbs) / span;
                        const tq = Math.round(t * 48) / 48;
                        timesQ.push(tq);
                    }
                    return { mids, timesQ };
                } catch {
                    return { mids: [], timesQ: [] };
                }
            };

            const eqDelta = (d1: number, d2: number): boolean => {
                if (!Number.isFinite(d1) || !Number.isFinite(d2)) return false;
                if (d1 === d2) return true;
                // Allow octave-equivalence with preserved direction.
                const s1 = Math.sign(d1);
                const s2 = Math.sign(d2);
                if (s1 !== 0 && s2 !== 0 && s1 !== s2) return false;
                const diff = d1 - d2;
                return Math.abs(diff % 12) < 1e-6;
            };

            const mod12 = (x: number): number => {
                const v = ((x % 12) + 12) % 12;
                return v;
            };

            type NoteSig = {
                bassD: number[];
                sopD: number[];
                vert12: number[];
                bassSeq: Array<number | null>;
                sopSeq: Array<number | null>;
            };

            type OnsetSig = {
                bassD: number[];
                sopD: number[];
                bassTimes: number[];
                sopTimes: number[];
            };

            const sigForTwoMeasures = (mStart: number): NoteSig | null => {
                try {
                    const points = [...sampleAbsBeatsForMeasure(mStart), ...sampleAbsBeatsForMeasure(mStart + 1)];
                    const bassSeq: Array<number | null> = [];
                    const sopSeq: Array<number | null> = [];
                    for (const a of points) {
                        const notesHere = getNotesAtAbsBeat(a);
                        bassSeq.push(midiForVoice(notesHere, 4));
                        sopSeq.push(midiForVoice(notesHere, 1));
                    }

                    const bassD: number[] = [];
                    const sopD: number[] = [];
                    const vert12: number[] = [];

                    for (let i = 0; i < points.length - 1; i++) {
                        const b0 = bassSeq[i];
                        const b1 = bassSeq[i + 1];
                        if (b0 != null && b1 != null) bassD.push(b1 - b0);
                    }
                    for (let i = 0; i < points.length - 1; i++) {
                        const s0 = sopSeq[i];
                        const s1 = sopSeq[i + 1];
                        if (s0 != null && s1 != null) sopD.push(s1 - s0);
                    }
                    for (let i = 0; i < points.length; i++) {
                        const b = bassSeq[i];
                        const s = sopSeq[i];
                        if (b != null && s != null) vert12.push(mod12(s - b));
                    }

                    // Require some data; otherwise skip.
                    if (bassD.length < 2 || vert12.length < 3) return null;
                    return { bassD, sopD, vert12, bassSeq, sopSeq };
                } catch {
                    return null;
                }
            };

            const noteMatch = (a: NoteSig, b: NoteSig): boolean => {
                // Compare bass deltas (strong signal)
                const nBass = Math.min(a.bassD.length, b.bassD.length);
                let bassOK = 0;
                for (let i = 0; i < nBass; i++) if (eqDelta(a.bassD[i], b.bassD[i])) bassOK++;
                if (nBass < 2 || bassOK !== nBass) return false;

                // Compare vertical intervals (mod 12) at sampled points.
                const nVert = Math.min(a.vert12.length, b.vert12.length);
                let vertOK = 0;
                for (let i = 0; i < nVert; i++) if (a.vert12[i] === b.vert12[i]) vertOK++;
                if (nVert < 3 || vertOK < nVert - 1) return false; // allow 1 mismatch

                // Soprano deltas: optional, but if we have enough, require a decent match.
                const nS = Math.min(a.sopD.length, b.sopD.length);
                if (nS >= 2) {
                    let sopOK = 0;
                    for (let i = 0; i < nS; i++) if (eqDelta(a.sopD[i], b.sopD[i])) sopOK++;
                    if (sopOK < nS - 1) return false;
                }
                return true;
            };

            const onsetSigForTwoMeasures = (mStart: number): OnsetSig | null => {
                try {
                    const startAbs = startAbsBeatOfMeasure(mStart);
                    const endAbs = startAbsBeatOfMeasure(mStart + 2);
                    const bass = voiceOnsetSeqInWindow(4, startAbs, endAbs);
                    const sop = voiceOnsetSeqInWindow(1, startAbs, endAbs);

                    const deltas = (mids: number[]) => {
                        const out: number[] = [];
                        for (let i = 0; i < mids.length - 1; i++) out.push(mids[i + 1] - mids[i]);
                        return out;
                    };

                    const bassD = deltas(bass.mids);
                    const sopD = deltas(sop.mids);
                    if (bassD.length < 2) return null;
                    return { bassD, sopD, bassTimes: bass.timesQ, sopTimes: sop.timesQ };
                } catch {
                    return null;
                }
            };

            const onsetMatch = (a: OnsetSig, b: OnsetSig): boolean => {
                const nBass = Math.min(a.bassD.length, b.bassD.length);
                if (nBass < 2) return false;
                for (let i = 0; i < nBass; i++) {
                    if (!eqDelta(a.bassD[i], b.bassD[i])) return false;
                }

                // Compare (quantized) onset timing patterns for bass.
                const nT = Math.min(a.bassTimes.length, b.bassTimes.length);
                if (nT >= 3) {
                    let ok = 0;
                    for (let i = 0; i < nT; i++) if (a.bassTimes[i] === b.bassTimes[i]) ok++;
                    if (ok < nT - 1) return false;
                }

                // Soprano optional: if both have enough deltas, require approximate match.
                const nS = Math.min(a.sopD.length, b.sopD.length);
                if (nS >= 2) {
                    let ok = 0;
                    for (let i = 0; i < nS; i++) if (eqDelta(a.sopD[i], b.sopD[i])) ok++;
                    if (ok < nS - 1) return false;
                }
                return true;
            };

            const maxM = Math.max(0, maxMeasureIndex);
            for (let m0 = 0; m0 <= maxM - 3; m0++) {
                const oa = onsetSigForTwoMeasures(m0);
                const ob = onsetSigForTwoMeasures(m0 + 2);
                const a = sigForTwoMeasures(m0);
                const b = sigForTwoMeasures(m0 + 2);
                const onsetOK = !!oa && !!ob && onsetMatch(oa, ob);
                const sampleOK = !!a && !!b && noteMatch(a, b);
                if (onsetOK || sampleOK) {
                    spans.push({ startMeasure: m0, endMeasure: m0 + 3, repeats: 2, source: 'note' });
                    m0 += 3;
                }
            }

            // (debug logging removed)
        } catch {
            // ignore
        }
        if (measureIndices.length >= 4) {
            for (let m0 = 0; m0 <= measureIndices.length - 4; m0++) {

                const sigA = blockSignature(m0);
                const sigB = blockSignature(m0 + 2);
                if (!sigA || !sigB) continue;

                if (sigA && sigA === sigB) {
                    spans.push({ startMeasure: m0, endMeasure: m0 + 3, repeats: 2, source: 'auto' });
                    m0 += 3;
                }
            }
        }

        // Also support explicit annotations inside `analysisContexts`.
        // You can mark a progression span with labels like "inizio progressione" and "fine progressione".
        try {
            const starts = (analysisContexts || [])
                .filter((c: any) => typeof c?.label === 'string' && /inizio\s+progressione/i.test(String(c.label)))
                .map((c: any) => Number(c.absBeat))
                .filter((a: number) => Number.isFinite(a))
                .sort((a: number, b: number) => a - b);
            const ends = (analysisContexts || [])
                .filter((c: any) => typeof c?.label === 'string' && /fine\s+progressione/i.test(String(c.label)))
                .map((c: any) => Number(c.absBeat))
                .filter((a: number) => Number.isFinite(a))
                .sort((a: number, b: number) => a - b);

            // Pair each start with the next end after it.
            let endIdx = 0;
            for (const s of starts) {
                while (endIdx < ends.length && ends[endIdx] <= s + 1e-6) endIdx++;
                if (endIdx >= ends.length) break;
                const e = ends[endIdx];
                endIdx++;

                const sm = findMeasureIndexForAbsBeat(s);
                const em = findMeasureIndexForAbsBeat(Math.max(s, e - 1e-6));
                if (Number.isFinite(sm) && Number.isFinite(em) && em >= sm) {
                    spans.push({ startMeasure: sm, endMeasure: em, source: 'annotated' });
                }
            }
        } catch {
            // ignore
        }

        // De-dupe spans (prefer note > auto > annotated when identical).
        const uniq = new Map<string, { startMeasure: number; endMeasure: number; repeats?: number; source: 'auto' | 'annotated' | 'note' }>();
        for (const sp of spans) {
            const key = `${sp.startMeasure}-${sp.endMeasure}`;
            const existing = uniq.get(key);
            if (!existing) {
                uniq.set(key, sp);
                continue;
            }
            const prio = (s: any) => (s === 'note' ? 3 : (s === 'auto' ? 2 : 1));
            if (prio(sp.source) > prio(existing.source)) uniq.set(key, sp);
        }
        const spansFinal = Array.from(uniq.values()).sort((a, b) => a.startMeasure - b.startMeasure || a.endMeasure - b.endMeasure);

        // (debug logging removed)

        if (!spansFinal.length) return layoutData.systemsParams.map(() => []);

        const markersBySystem: Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>> = layoutData.systemsParams.map(() => []);

        const staffTopY = staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 18) : (TOP_STAFF_TOP + 18);
        const textY = staffTopY - 6;

        const measureStartXInSystem = (system: any, measureIndex: number): number | null => {
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return null;
            return Number(system.startMeasuresX?.[idx] ?? 0);
        };
        const measureEndXInSystem = (system: any, measureIndex: number): number | null => {
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return null;
            const staffEndX = (system.width ?? 0) - STAFF_MARGIN;
            const nextX = (idx < system.measureIndices.length - 1) ? Number(system.startMeasuresX?.[idx + 1] ?? staffEndX) : staffEndX;
            return nextX;
        };

        spansFinal.forEach((sp, k) => {
            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                const system = layoutData.systemsParams[si];
                const sysMeasures = system.measureIndices || [];
                const sysMin = sysMeasures.length ? Math.min(...sysMeasures) : null;
                const sysMax = sysMeasures.length ? Math.max(...sysMeasures) : null;
                if (sysMin == null || sysMax == null) continue;
                if (sp.endMeasure < sysMin || sp.startMeasure > sysMax) continue;

                const localStart = Math.max(sp.startMeasure, sysMin);
                const localEnd = Math.min(sp.endMeasure, sysMax);
                const x1 = measureStartXInSystem(system, localStart);
                const x2 = measureEndXInSystem(system, localEnd);
                if (x1 == null || x2 == null) continue;

                const pad = 6;
                const xx1 = x1 + pad;
                const xx2 = x2 - pad;
                const midX = (xx1 + xx2) / 2;
                markersBySystem[si].push({
                    id: `prog-${sp.startMeasure}-${sp.endMeasure}-${k}-${si}`,
                    x1: xx1,
                    x2: xx2,
                    midX,
                    y: staffTopY,
                    textY,
                    label: sp.source === 'auto'
                        ? `Prog. (${sp.repeats ?? 2}×2 mis.)`
                        : (sp.source === 'note' ? 'Prog. (note)' : 'Prog. (annotata)'),
                });
            }
        });

        return markersBySystem;
    }, [analysisContexts, harmonyLabelsBySystem, isAnalysisEnabled, layoutData, staffSystemMode, timeSignature]);

    const sequenceMatches = useMemo(() => {
        // IMPORTANT: sequences are a theoretical feature and affect functional labeling.
        // The UI toggle should only affect rendering (markers/highlights), not the analysis itself.
        if (!isAnalysisEnabled) return [];

        // IMPORTANT: build labelPoints from a global timeline so results are stable
        // even when layout changes (e.g. measures-per-line causes different system breaks).
        // The per-system harmony label suppression logic resets at system boundaries;
        // using it for sequence detection makes matches jump around.
        const timeline = getActiveNotesTimeline((analyzedNotes || notes) as any, timeSignature, timeSignatureChanges);
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const isCompoundMeter = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
        const isStrongPulseInMeasure = (inMeasureBeats0: number) => {
            try {
                if (!Number.isFinite(inMeasureBeats0)) return false;
                const EPS = 1e-3;
                if (isCompoundMeter) {
                    const pulse = 1.5;
                    const r = ((inMeasureBeats0 % pulse) + pulse) % pulse;
                    return Math.abs(r) < EPS || Math.abs(pulse - r) < EPS;
                }
                const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
                if (!nearInt(inMeasureBeats0)) return false;
                const beat0 = Math.round(inMeasureBeats0);
                return beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
            } catch {
                return false;
            }
        };

        const isBeatBoundaryInMeasure = (inMeasureBeats0: number) => {
            try {
                if (!Number.isFinite(inMeasureBeats0)) return false;
                const EPS = 1e-3;
                if (isCompoundMeter) return isStrongPulseInMeasure(inMeasureBeats0);
                return Math.abs(inMeasureBeats0 - Math.round(inMeasureBeats0)) < EPS;
            } catch {
                return false;
            }
        };

        const timelineForLabels = (timeline || []).filter((ev: any, idx: number) => {
            if (!ev) return false;
            if (idx === 0) return true;
            const prev = timeline[idx - 1] as any;
            const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
            const curNotes = (ev?.notes || []) as any[];
            const hasOnset = curNotes.some(n => {
                const id = String(n?.id ?? '');
                return id && !prevIds.has(id);
            });
            if (hasOnset) return true;
            try {
                const curIds = new Set<string>(curNotes.map(n => String(n?.id ?? '')).filter(Boolean));
                const removed = Array.from(prevIds).some(id => id && !curIds.has(id));
                if (!removed) return false;
                const absBeat = Number(ev?.absBeat);
                if (!Number.isFinite(absBeat)) return false;
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                return isBeatBoundaryInMeasure(inMeasure);
            } catch {
                return false;
            }
        });

        const ctxAtAbsBeat = (absBeat: number) => (effectiveAnalysisContexts || [])
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

        const qAbs = (x: number) => {
            try {
                const q = 192;
                return Math.round(Number(x) * q) / q;
            } catch {
                return Number(x) || 0;
            }
        };

        const overrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        try {
            (harmonyOverrides || []).forEach((o: any) => {
                const a = Number(o?.absBeat);
                if (!Number.isFinite(a)) return;
                overrideByAbsBeat.set(qAbs(a), {
                    absBeat: a,
                    roman: typeof o?.roman === 'string' ? o.roman : undefined,
                    symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                    figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                    note: typeof o?.note === 'string' ? o.note : undefined,
                });
            });
        } catch { /* ignore */ }

        const labelPoints = (timelineForLabels || []).map((ev: any) => {
            const absBeat = Number(ev?.absBeat);
            if (!Number.isFinite(absBeat)) return null;
            const a = qAbs(absBeat);

            // Compute under current analysis context.
            const ctx = ctxAtAbsBeat(absBeat);
            const tonic = ctx ? String(ctx.newTonic || '') : String(currentTonic || 'C');
            const isMinor = ctx ? !!ctx.newIsMinor : !!isMinorMode;

            let roman = '';
            let symbol: string | undefined = undefined;
            let figures: string[] | undefined = undefined;
            try {
                const r = getRomanAnalysis((ev?.notes || []) as any, tonic, isMinor);
                roman = String(r?.roman || '');
                figures = Array.isArray(r?.figures) ? r!.figures.map((x: any) => String(x)) : undefined;
            } catch { /* ignore */ }

            // Apply user override if present (wins).
            try {
                const ov = overrideByAbsBeat.get(a);
                if (ov) {
                    if (ov.roman != null) roman = String(ov.roman);
                    if (ov.symbol != null) symbol = String(ov.symbol);
                    if (ov.figures != null) figures = ov.figures;
                }
            } catch { /* ignore */ }

            return {
                absBeat,
                roman: roman || undefined,
                symbol,
                figures,
            };
        }).filter(Boolean) as Array<{ absBeat: number; roman?: string; symbol?: string; figures?: string[] }>;

        return detectVoiceLeadingSequences(notes, timeSignature, timeSignatureChanges, labelPoints);
    }, [analyzedNotes, currentTonic, effectiveAnalysisContexts, harmonyOverrides, isAnalysisEnabled, isMinorMode, notes, timeSignature, timeSignatureChanges]);

    const harmonyLabelsBySystemSequenced = useMemo(() => {
        if (!harmonyLabelsBySystem?.length || !sequenceMatches.length) return harmonyLabelsBySystem || [];

        const labelsBySystem = (harmonyLabelsBySystem || []).map(arr => arr.map(lbl => ({ ...lbl })));
        const flat = labelsBySystem.flatMap((arr, systemIndex) =>
            arr.map((lbl, labelIndex) => ({
                systemIndex,
                labelIndex,
                label: lbl,
                tick: Number.isFinite(lbl?.absBeat as number) ? beatsToTicks(Number(lbl.absBeat)) : Number.NaN,
            }))
        ).filter(x => Number.isFinite(x.tick));

        flat.sort((a, b) => a.tick - b.tick);

        const findNearestLabelIndex = (tick: number) => {
            if (!flat.length) return null;
            let lo = 0;
            let hi = flat.length - 1;
            while (lo < hi) {
                const mid = Math.floor((lo + hi) / 2);
                if (flat[mid].tick < tick) lo = mid + 1;
                else hi = mid;
            }
            const candidates = [flat[lo], flat[lo - 1]].filter(Boolean) as typeof flat;
            let best: (typeof flat)[number] | null = null;
            let bestDist = Infinity;
            for (const c of candidates) {
                const dist = Math.abs(c.tick - tick);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = c;
                }
            }
            const TOL_TICKS = 12;
            if (!best || bestDist > TOL_TICKS) return null;
            return best;
        };

        // If a sequence slot falls on a beat with no nearby rendered harmony label,
        // fall back to computing the roman at that tick by sampling the global note timeline.
        // This keeps sequence imitation stable even when the harmony-label pipeline suppresses
        // some events (e.g., no onset on weak beats).
        const timelineForRoman = getActiveNotesTimeline((analyzedNotes || notes) as any, timeSignature, timeSignatureChanges);
        const getNotesAtAbsBeat = (absBeat: number): any[] => {
            try {
                let best: any = null;
                for (const ev of (timelineForRoman || [])) {
                    if (!ev || typeof ev.absBeat !== 'number') continue;
                    if (ev.absBeat <= absBeat + 1e-6) best = ev;
                    else break;
                }
                return (best?.notes || []) as any[];
            } catch {
                return [];
            }
        };

        const qAbs = (x: number) => {
            try {
                const q = 192;
                return Math.round(Number(x) * q) / q;
            } catch {
                return Number(x) || 0;
            }
        };

        const overrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        try {
            (harmonyOverrides || []).forEach((o: any) => {
                const a = Number(o?.absBeat);
                if (!Number.isFinite(a)) return;
                overrideByAbsBeat.set(qAbs(a), {
                    absBeat: a,
                    roman: typeof o?.roman === 'string' ? o.roman : undefined,
                    symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                    figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                    note: typeof o?.note === 'string' ? o.note : undefined,
                    romanDisplay: typeof o?.romanDisplay === 'string' ? o.romanDisplay : undefined,
                });
            });
        } catch { /* ignore */ }

        const computeRomanAtTick = (tick: number): string => {
            try {
                if (!Number.isFinite(tick)) return '';
                const absBeat = tick / TICKS_PER_QUARTER;
                const ctx = ctxAtAbsBeat(absBeat);
                const tonic = ctx ? String(ctx.newTonic || '') : String(currentTonic || 'C');
                const isMinor = ctx ? !!ctx.newIsMinor : !!isMinorMode;
                const r = getRomanAnalysis(getNotesAtAbsBeat(absBeat) as any, tonic, isMinor);
                let roman = String(r?.roman || '');

                // Apply user override if present.
                const ov = overrideByAbsBeat.get(qAbs(absBeat));
                if (ov && ov.roman != null) roman = String(ov.roman);
                return roman;
            } catch {
                return '';
            }
        };

        const ctxAtAbsBeat = (absBeat: number) => (effectiveAnalysisContexts || [])
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

        const mod7 = (n: number) => ((n % 7) + 7) % 7;
        const mod12Local = (n: number) => ((n % 12) + 12) % 12;

        // --- Sequence-only trigger: chromatic evidence inside the imitation ---
        // We only want to "freeze" the model's Roman pattern across repetitions when the sequence
        // actually behaves tonicizing/modulating (in the broad pedagogical sense).
        // A reliable, simple signal is: notes outside the current scale (per active context) within
        // the imitation window. This does NOT change base harmony analysis; it only gates copying.
        const hasOutOfScalePcAt = (absBeat: number): boolean => {
            try {
                const ctx = ctxAtAbsBeat(absBeat);
                const tonic = ctx ? String(ctx.newTonic || '') : String(currentTonic || 'C');
                const isMinor = ctx ? !!ctx.newIsMinor : !!isMinorMode;
                const tonicPc = noteNameToChromaticIndex(tonic);
                if (!(tonicPc >= 0)) return false;

                const majorInts = [0, 2, 4, 5, 7, 9, 11];
                // Minor: allow both natural (b7) and raised leading tone (7) to avoid false alarms.
                const minorInts = [0, 2, 3, 5, 7, 8, 10, 11];
                const ints = isMinor ? minorInts : majorInts;
                const allowed = new Set<number>(ints.map(iv => mod12Local(tonicPc + iv)));

                const notesHere = getNotesAtAbsBeat(absBeat);
                const usable = (notesHere || [])
                    .filter((n: any) => n && !n.isRest)
                    // Prefer harmonic skeleton when available.
                    .filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isSuspension)
                    .filter((n: any) => Number.isFinite((n as any).noteIndex) || Number.isFinite((n as any).midi));
                for (const n of usable) {
                    const ni = Number((n as any).noteIndex);
                    const pc = Number.isFinite(ni) ? mod12Local(ni) : mod12Local(Number((n as any).midi));
                    if (!allowed.has(pc)) return true;
                }
                return false;
            } catch {
                return false;
            }
        };

        const sequenceHasChromaticEvidenceInImitation = (seq: any): boolean => {
            try {
                const slots = seq?.slotTicks || [];
                const L = Number(seq?.lengthSteps ?? 0);
                const repeats = Math.max(2, Number(seq?.repeatsCount ?? 2));
                if (!slots.length || L <= 0 || repeats < 2) return false;

                // Only look at repetitions beyond the model (r>=1), as requested.
                for (let r = 1; r < repeats; r += 1) {
                    for (let k = 0; k <= L; k += 1) {
                        const tick = slots[seq.startSlotIdx + r * L + k];
                        if (!Number.isFinite(tick)) continue;
                        const absBeat = tick / TICKS_PER_QUARTER;

                        // Strongest signal: actual out-of-scale pitch classes.
                        if (hasOutOfScalePcAt(absBeat)) return true;

                        // Secondary signals (cheap): the roman label itself indicates chromaticism.
                        const rr = String(computeRomanAtTick(tick) || '').trim();
                        if (rr.includes('/')) return true;
                        if (hasAccidentalPrefix(rr)) return true;
                    }
                }
                return false;
            } catch {
                return false;
            }
        };

        const degreeIndexFromRomanLoose = (romanRaw: string): number | null => {
            try {
                const raw0 = String(romanRaw || '').trim();
                if (!raw0) return null;
                const raw = raw0
                    .replace(/♭/g, 'b')
                    .replace(/♯/g, '#')
                    .replace(/𝄫/g, 'bb')
                    .replace(/𝄪/g, '##');
                const left = raw.split('/')[0];
                const m = left.match(/^([#b]*)(vii|vi|iv|v|iii|ii|i)/i);
                if (!m) return null;
                const core = String(m[2] || '').toLowerCase();
                if (core === 'i') return 0;
                if (core === 'ii') return 1;
                if (core === 'iii') return 2;
                if (core === 'iv') return 3;
                if (core === 'v') return 4;
                if (core === 'vi') return 5;
                if (core === 'vii') return 6;
                return null;
            } catch {
                return null;
            }
        };

        const stripSecondary = (roman: string) => {
            const raw = String(roman || '').trim();
            if (!raw) return raw;
            const parts = raw.split('/');
            return String(parts[0] || '').trim();
        };

        const normalizeFunctionalRomanInSequence = (
            romanRaw: string,
            localTonicDegreeIdx: number | null,
            localTonicIsMinor: boolean | null,
        ): string => {
            const raw = String(romanRaw || '').trim();
            if (!raw) return raw;

            // Do not touch special/aug6/borrowed tags.
            if (/^(It\+|Fr\+|Ger\+|N6)\b/.test(raw)) return raw;

            const qualitySuffix = (s0: string): { qual: string; tail: string } => {
                try {
                    const s = String(s0 || '').trim();
                    // Keep ° / ø / + and any trailing figures like 7.
                    const qual = s.includes('ø') ? 'ø' : s.includes('°') ? '°' : s.includes('+') ? '+' : '';
                    const m = s.match(/(\d+)$/);
                    const tail = m ? String(m[1]) : '';
                    return { qual, tail };
                } catch {
                    return { qual: '', tail: '' };
                }
            };

            const degreeToUpper = (degreeIdx: number, qual: string, tail: string): string => {
                const base = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][mod7(degreeIdx)] ?? '';
                return `${base}${qual}${tail}`;
            };

            // If it's a secondary (x/y), the head (x) is already the *function in the tonicized key*.
            // We want a pure functional read, so: i/iii -> I, ii°/iii -> II°, V/iii -> V, etc.
            if (raw.includes('/')) {
                const head = stripSecondary(raw);
                const d = degreeIndexFromRomanLoose(head);
                if (d == null) return head;
                const { qual, tail } = qualitySuffix(head);
                return degreeToUpper(d, qual, tail);
            }

            // Otherwise (diatonic/global roman), map it into the inferred local tonic context.
            if (localTonicDegreeIdx == null || localTonicIsMinor == null) return raw;
            const d = degreeIndexFromRomanLoose(raw);
            if (d == null) return raw;
            const rel = mod7(d - localTonicDegreeIdx);
            const { qual, tail } = qualitySuffix(raw);
            return degreeToUpper(rel, qual, tail);
        };

        const inferLocalTonicFromTemplate = (templateRomans: string[]) => {
            try {
                // 1) Strongest signal: an explicit tonic label I/x or i/x.
                // This is exactly the pedagogical case "i/iii" you mentioned.
                for (let i = 0; i < templateRomans.length; i++) {
                    const r0 = String(templateRomans[i] || '').trim();
                    if (!r0 || !r0.includes('/')) continue;
                    const [head0, target0] = r0.split('/');
                    const head = String(head0 || '').trim();
                    const target = String(target0 || '').trim();
                    if (!target) continue;
                    const isTonicHead = /^i(?!i)|^I(?!I)/.test(head); // i or I (not ii / II)
                    if (!isTonicHead) continue;
                    const degreeIdx = degreeIndexFromRomanLoose(target);
                    if (degreeIdx == null) continue;
                    const isMinor = head === head.toLowerCase();
                    return { degreeIdx, isMinor };
                }

                let bestTarget: string | null = null;
                for (let i = 0; i < templateRomans.length; i++) {
                    const r = String(templateRomans[i] || '').trim();
                    const m = r.match(/^(?:V|v|vii[°+ø]?)[^/]*\/(.+)$/);
                    if (!m) continue;
                    const target = String(m[1] || '').trim();
                    if (!target) continue;
                    // Only consider it a tonicization if the target actually appears later in the template.
                    const appears = templateRomans.slice(i + 1).some(x => String(x || '').trim() === target);
                    if (appears) bestTarget = target;
                }
                // IMPORTANT: if we have no explicit tonicization evidence, do NOT force a local tonic.
                // Otherwise plain diatonic progressions (e.g. IV–V–I–vi) get re-labeled as I–II–V–III.
                if (!bestTarget) return { degreeIdx: null as number | null, isMinor: null as boolean | null };
                const degreeIdx = degreeIndexFromRomanLoose(bestTarget);
                if (degreeIdx == null) return { degreeIdx: null as number | null, isMinor: null as boolean | null };
                const isMinor = bestTarget === bestTarget.toLowerCase();
                return { degreeIdx, isMinor };
            } catch {
                return { degreeIdx: null as number | null, isMinor: null as boolean | null };
            }
        };

        const normalizeRomanDegree = (romanRaw: string) => {
            const raw = String(romanRaw || '').trim();
            if (!raw) return '';
            const r = raw
                .replace(/♭/g, 'b')
                .replace(/♯/g, '#')
                .replace(/𝄫/g, 'bb')
                .replace(/𝄪/g, '##');
            const left = r.split('/')[0];
            const m = left.match(/^([#b]*)(vii[°+ø]?|[ivIV]+)/);
            return m ? `${m[1] || ''}${m[2] || ''}` : left.replace(/\d+/g, '');
        };

        const hasAccidentalPrefix = (romanRaw: string) => {
            const r = String(romanRaw || '')
                .trim()
                .replace(/♭/g, 'b')
                .replace(/♯/g, '#')
                .replace(/𝄫/g, 'bb')
                .replace(/𝄪/g, '##');
            return /^([#b]+)/.test(r);
        };

        for (const seq of sequenceMatches) {
            if (Number.isFinite(seq.transpositionSemitones as number) && Number(seq.transpositionSemitones) === 0) continue;

            // Only apply sequence-based Roman copying when the imitation shows chromatic/tonicizing evidence.
            // This prevents diatonic sequences from being mislabeled as modulant.
            const chromaticImitation = sequenceHasChromaticEvidenceInImitation(seq);
            if (!chromaticImitation) continue;

            const slots = seq.slotTicks || [];
            if (!slots.length) continue;
            const L = seq.lengthSteps;
            const repeats = Math.max(2, Number(seq.repeatsCount ?? 2));

            // Build a stable mapping from TEMPLATE slot k -> functional roman.
            // This avoids recomputing (and potentially changing) the inferred local tonic
            // for each copied label.
            const templateByK: Array<{ lab: typeof flat[number] | null; src: string; stripped: string; functional: string }> = [];
            const tmplRomans: string[] = [];
            // IMPORTANT: lengthSteps (L) is the motif length in slots.
            // Slots are indexed [0..L-1] for the template; slot L is the *start of the imitation*.
            // Using <= L leaks the sequence functional label one slot beyond the sequence end.
            for (let kk = 0; kk < L; kk += 1) {
                const slot = slots[seq.startSlotIdx + kk];
                const lab = Number.isFinite(slot) ? findNearestLabelIndex(slot) : null;
                let src = String(lab?.label?.roman ?? '').trim();
                if (!src && Number.isFinite(slot)) {
                    // No nearby rendered label for this slot: compute directly at slot tick.
                    src = String(computeRomanAtTick(slot)).trim();
                }
                if (src) tmplRomans.push(src);
                templateByK.push({ lab, src, stripped: stripSecondary(src), functional: src });
            }
            const inferred0 = inferLocalTonicFromTemplate(tmplRomans);
            const inferred = (() => {
                try {
                    // A) Treat auto pivot displays like `i=iii` as explicit tonicization evidence.
                    // This fixes cases where the engine labels the local tonic as `iii` globally,
                    // while the UI also computes a pedagogical pivot display.
                    for (const row of templateByK) {
                        const disp = String((row as any)?.lab?.label?.romanDisplay ?? '').trim();
                        if (!disp || !disp.includes('=')) continue;
                        const [left0, right0] = disp.split('=');
                        const left = String(left0 || '').trim();
                        const right = String(right0 || '').trim();
                        if (!right) continue;
                        const isTonicLeft = /^i(?!i)|^I(?!I)/.test(left);
                        if (!isTonicLeft) continue;
                        const d = degreeIndexFromRomanLoose(right);
                        if (d == null) continue;
                        // `normalizeFunctionalRomanInSequence` currently only needs a non-null boolean.
                        const isMinor = left === left.toLowerCase();
                        return { degreeIdx: d, isMinor };
                    }

                    if (inferred0.degreeIdx != null && inferred0.isMinor != null) return inferred0;

                    // B) Safe fallback for tonic–dominant motifs, ONLY when the sequence is chromatic/tonicizing.
                    // This avoids diatonic false positives (e.g. plain IV–V–I–vi sequences).
                    if (!chromaticImitation) return inferred0;

                    const first = String(templateByK[0]?.src || '').trim();
                    const second = String(templateByK[1]?.src || '').trim();
                    const d0 = degreeIndexFromRomanLoose(first);
                    if (d0 == null) return inferred0;
                    if (!(d0 === 0 || d0 === 2 || d0 === 5)) return inferred0;
                    const isVLike = (r: string) => {
                        const s = String(r || '').trim();
                        if (!s) return false;
                        const head = stripSecondary(s);
                        return /^V(?!I)/i.test(head) || /^vii/i.test(head);
                    };
                    if (!isVLike(second)) return inferred0;

                    return { degreeIdx: d0, isMinor: false };
                } catch {
                    return inferred0;
                }
            })();
            for (let kk = 0; kk < templateByK.length; kk += 1) {
                const row = templateByK[kk];
                const functional = (row.src && inferred.degreeIdx != null && inferred.isMinor != null)
                    ? normalizeFunctionalRomanInSequence(row.src, inferred.degreeIdx, inferred.isMinor)
                    : '';
                templateByK[kk] = { ...row, functional };
            }

            // Annotate the TEMPLATE occurrence itself, so the whole sequence reads consistently.
            try {
                for (let kk = 0; kk < L; kk += 1) {
                    const row = templateByK[kk];
                    if (!row?.lab) continue;
                    const lbl = labelsBySystem[row.lab.systemIndex]?.[row.lab.labelIndex];
                    if (!lbl) continue;
                    if (row.src) {
                        (lbl as any).sequenceRoman = row.stripped;
                        if (row.functional) {
                            (lbl as any).sequenceRomanFunctional = row.functional;
                            (lbl as any).sequenceRomanSource = row.src;
                        }
                    }
                }
            } catch {
                // ignore
            }

            for (let r = 1; r < repeats; r += 1) {
                for (let k = 0; k < L; k += 1) {
                    const slotB = slots[seq.startSlotIdx + r * L + k];
                    const labB = findNearestLabelIndex(slotB);
                    if (!Number.isFinite(slotB) || !labB) continue;

                    const row = templateByK[k];
                    const templateRoman = String(row?.src ?? '').trim();
                    if (!templateRoman) continue;
                    const target = labelsBySystem[labB.systemIndex]?.[labB.labelIndex];
                    if (!target) continue;
                    (target as any).sequenceRoman = row.stripped;
                    if (row.functional) {
                        (target as any).sequenceRomanFunctional = row.functional;
                        (target as any).sequenceRomanSource = templateRoman;
                    }
                }
            }
        }

        return labelsBySystem;
    }, [analysisContextAbsBeat, analyzedNotes, currentTonic, effectiveAnalysisContexts, harmonyLabelsBySystem, harmonyOverrides, isMinorMode, notes, sequenceMatches, timeSignature, timeSignatureChanges]);

    const sequenceMarkersBySystem = useMemo(() => {
        if (!isSequencesEnabled) return [] as Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>>;
        if (!layoutData || !sequenceMatches.length) return [] as Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>>;

        const markersBySystem: Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>> = layoutData.systemsParams.map(() => []);
        const staffTopY = staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 36) : (TOP_STAFF_TOP + 36);
        const textY = staffTopY - 6;

        // Option B: anchor to absBeat boundaries rather than measure boundaries.
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const beatsFallback = timeSignature.numerator * (4 / timeSignature.denominator);

        const beatsInMeasure = (m: number): number => {
            const b = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number') ? Number(measureBeatsPerMeasure[m]) : beatsFallback;
            return Number.isFinite(b) && b > 0 ? b : beatsFallback;
        };
        const startAbsForMeasure = (m: number): number => {
            if (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number') return Number(measureStartAbsBeat[m]);
            return m * beatsFallback;
        };

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) return Math.floor(ab / beatsFallback);
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const getXForAbsBeat = (absBeat: number, system: any) => {
            // Prefer a system-local lookup to avoid rendering glitches when rounding causes
            // findMeasureIndexForAbsBeat() to pick a measure not present in this system.
            const findMeasureIdxInSystem = () => {
                try {
                    const measures = system.measureIndices || [];
                    if (!measures.length) return null;
                    const EPS = 1e-6;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const end = start + beatsInMeasure(m);
                        if (absBeat >= start - EPS && absBeat < end - EPS) return { m, idx: i };
                    }
                    // Clamp to closest bucket.
                    let bestIdx = 0;
                    let bestDist = Infinity;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const dist = Math.abs(absBeat - start);
                        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                    }
                    return { m: measures[bestIdx], idx: bestIdx };
                } catch {
                    return null;
                }
            };

            const local = findMeasureIdxInSystem();
            const measureIndex = local ? local.m : findMeasureIndexForAbsBeat(absBeat);
            const bpm = beatsInMeasure(measureIndex);
            const startAbs = startAbsForMeasure(measureIndex);
            const beatInMeasure = (absBeat - startAbs) + 1;

            const idx = local ? local.idx : system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return system.startMeasuresX?.[0] ?? 0;
            const startX = system.startMeasuresX[idx];
            const endX = idx < system.measureIndices.length - 1 ? system.startMeasuresX[idx + 1] : (system.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / bpm));
            return startX + MEASURE_PADDING_X + (rel * contentWidth);
        };

        const formatAbsBeatPos = (absBeat: number): string => {
            try {
                const m = findMeasureIndexForAbsBeat(absBeat);
                const bpm = beatsInMeasure(m);
                const startAbs = startAbsForMeasure(m);
                const beat = (absBeat - startAbs) + 1;
                const nearInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-3;
                const beatLabel = nearInt(beat) ? String(Math.round(beat)) : String(Math.round(beat * 4) / 4);
                return `m${m + 1}b${beatLabel}`;
            } catch {
                return '';
            }
        };

        sequenceMatches.forEach((seq, k) => {
            // Full sequence span: from model start to end of last repetition.
            const startTick = Number(seq.startTick);
            const endTickExcl = Number(seq.endTick);
            if (!Number.isFinite(startTick) || !Number.isFinite(endTickExcl)) return;

            const absStart = startTick / TICKS_PER_QUARTER;
            // Use inclusive end (endTickExclusive-1) to keep the bracket inside the last measure
            // when the sequence ends exactly at a barline.
            const endTickIncl = Math.max(startTick, endTickExcl - 1);
            const absEnd = endTickIncl / TICKS_PER_QUARTER;
            if (!Number.isFinite(absStart) || !Number.isFinite(absEnd) || !(absEnd > absStart + 1e-9)) return;

            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                const system = layoutData.systemsParams[si];
                const sysMeasures = system.measureIndices || [];
                const sysMin = sysMeasures.length ? Math.min(...sysMeasures) : null;
                const sysMax = sysMeasures.length ? Math.max(...sysMeasures) : null;
                if (sysMin == null || sysMax == null) continue;

                const sysAbsStart = startAbsForMeasure(sysMin);
                const sysAbsEnd = startAbsForMeasure(sysMax) + beatsInMeasure(sysMax);

                const oStart = Math.max(absStart, sysAbsStart);
                const oEnd = Math.min(absEnd, sysAbsEnd);
                if (!(oEnd > oStart + 1e-6)) continue;

                let x1 = getXForAbsBeat(oStart, system);
                let x2 = getXForAbsBeat(oEnd, system);
                if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
                if (x2 < x1) [x1, x2] = [x2, x1];

                const pad = 6;
                const xx1 = x1 + pad;
                const xx2 = x2 - pad;
                if (!(xx2 > xx1 + 2)) continue;
                const midX = (xx1 + xx2) / 2;
                const conf = Math.round(seq.confidence * 100);
                const modelRange = (seq.modelStartMeasure != null && seq.modelEndMeasure != null)
                    ? (seq.modelStartMeasure === seq.modelEndMeasure
                        ? `m${seq.modelStartMeasure + 1}`
                        : `m${seq.modelStartMeasure + 1}-${seq.modelEndMeasure + 1}`)
                    : '';
                const repeatRange = (seq.repeatStartMeasure != null && seq.repeatEndMeasure != null)
                    ? (seq.repeatStartMeasure === seq.repeatEndMeasure
                        ? `m${seq.repeatStartMeasure + 1}`
                        : `m${seq.repeatStartMeasure + 1}-${seq.repeatEndMeasure + 1}`)
                    : '';
                const isFirstFragment = absStart >= sysAbsStart - 1e-6 && absStart <= sysAbsEnd + 1e-6;
                markersBySystem[si].push({
                    id: `seq-${seq.startMeasure}-${seq.endMeasure}-${k}-${si}`,
                    x1: xx1,
                    x2: xx2,
                    midX,
                    y: staffTopY,
                    textY,
                    // If the detected sequence starts/ends mid-measure, include beat offsets
                    // so the bracket geometry matches the label and feels less ambiguous.
                    label: (() => {
                        if (!isFirstFragment) return '';
                        const posA = formatAbsBeatPos(absStart);
                        const posB = formatAbsBeatPos(absEnd);
                        const hasPos = !!(posA && posB);
                        return hasPos
                            ? `Seq. ${posA}→${posB}`
                            : `Seq. ${modelRange}→${repeatRange}`;
                    })(),
                });
            }
        });

        return markersBySystem;
    }, [isSequencesEnabled, layoutData, sequenceMatches, staffSystemMode]);

    // Subtle highlight for the *model* range of each sequence (discreet visual cue).
    const sequenceModelMarkersBySystem = useMemo(() => {
        if (!isSequencesEnabled) return [] as Array<Array<{ id: string; x1: number; x2: number; y: number }>>;
        if (!layoutData || !sequenceMatches.length) return [] as Array<Array<{ id: string; x1: number; x2: number; y: number }>>;

        const markersBySystem: Array<Array<{ id: string; x1: number; x2: number; y: number }>> = layoutData.systemsParams.map(() => []);
        const staffTopY = staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 36) : (TOP_STAFF_TOP + 36);

        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const beatsFallback = timeSignature.numerator * (4 / timeSignature.denominator);

        const beatsInMeasure = (m: number): number => {
            const b = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number') ? Number(measureBeatsPerMeasure[m]) : beatsFallback;
            return Number.isFinite(b) && b > 0 ? b : beatsFallback;
        };
        const startAbsForMeasure = (m: number): number => {
            if (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number') return Number(measureStartAbsBeat[m]);
            return m * beatsFallback;
        };

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) return Math.floor(ab / beatsFallback);
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const getXForAbsBeat = (absBeat: number, system: any) => {
            // Robust system-local mapping: avoid x=0 when rounding picks a measure not in this system.
            const findMeasureIdxInSystem = () => {
                try {
                    const measures = system.measureIndices || [];
                    if (!measures.length) return null;
                    const EPS = 1e-6;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const end = start + beatsInMeasure(m);
                        if (absBeat >= start - EPS && absBeat < end - EPS) return { m, idx: i };
                    }
                    let bestIdx = 0;
                    let bestDist = Infinity;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const dist = Math.abs(absBeat - start);
                        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                    }
                    return { m: measures[bestIdx], idx: bestIdx };
                } catch {
                    return null;
                }
            };

            const local = findMeasureIdxInSystem();
            const measureIndex = local ? local.m : findMeasureIndexForAbsBeat(absBeat);
            const bpm = beatsInMeasure(measureIndex);
            const startAbs = startAbsForMeasure(measureIndex);
            const beatInMeasure = (absBeat - startAbs) + 1;
            const idx = local ? local.idx : system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return system.startMeasuresX?.[0] ?? 0;
            const startX = system.startMeasuresX[idx];
            const endX = idx < system.measureIndices.length - 1 ? system.startMeasuresX[idx + 1] : (system.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / bpm));
            return startX + MEASURE_PADDING_X + (rel * contentWidth);
        };

        sequenceMatches.forEach((seq, k) => {
            const slots = seq.slotTicks || [];
            const L = seq.lengthSteps;
            const modelStartTick = Number(seq.startTick);
            const repeatStartTick = Number(slots[seq.startSlotIdx + L]);
            if (!Number.isFinite(modelStartTick) || !Number.isFinite(repeatStartTick)) return;

            const absStart = modelStartTick / TICKS_PER_QUARTER;
            const absEnd = repeatStartTick / TICKS_PER_QUARTER;
            if (!Number.isFinite(absStart) || !Number.isFinite(absEnd) || absEnd <= absStart) return;

            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                const system = layoutData.systemsParams[si];
                const sysMeasures = system.measureIndices || [];
                if (!sysMeasures.length) continue;
                const sysMin = Math.min(...sysMeasures);
                const sysMax = Math.max(...sysMeasures);
                const sysAbsStart = startAbsForMeasure(sysMin);
                const sysAbsEnd = startAbsForMeasure(sysMax) + beatsInMeasure(sysMax);

                const oStart = Math.max(absStart, sysAbsStart);
                const oEnd = Math.min(absEnd, sysAbsEnd);
                if (!(oEnd > oStart + 1e-6)) continue;

                let x1 = getXForAbsBeat(oStart, system);
                let x2 = getXForAbsBeat(oEnd, system);
                if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
                if (x2 < x1) [x1, x2] = [x2, x1];

                const pad = 6;
                markersBySystem[si].push({
                    id: `seq-model-${seq.startSlotIdx}-${k}-${si}`,
                    x1: x1 + pad,
                    x2: x2 - pad,
                    y: staffTopY + 3,
                });
            }
        });

        return markersBySystem;
    }, [isSequencesEnabled, layoutData, sequenceMatches, staffSystemMode]);

    // Modulation / tonicization markers per system (from analysisContexts)
    const contextMarkersBySystem = useMemo(() => {
        if (!layoutData || analysisContexts.length === 0) return [] as { x: number; label: string }[][];

        const formatLabel = (ctx: AnalysisContext) => {
            const quality = ctx.newIsMinor ? 'min' : 'Maj';
            const tonicLabel = `[ ${ctx.newTonic} ${quality} ]`;
            const custom = ctx.label && String(ctx.label).trim() ? String(ctx.label).trim() : '';
            return custom ? `${custom} ${tonicLabel}` : tonicLabel;
        };

        const markersBySystem: { x: number; label: string }[][] = layoutData.systemsParams.map(() => []);
        const measureStarts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeats = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStarts || measureStarts.length === 0) {
                const bpm = timeSignature.numerator * (4 / timeSignature.denominator);
                return Math.floor(ab / bpm);
            }
            for (let m = measureStarts.length - 1; m >= 0; m--) {
                if (ab >= (measureStarts[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        for (const ctx of analysisContexts) {
            const absBeat = analysisContextAbsBeat(ctx);
            if (!Number.isFinite(absBeat) || absBeat < 0) continue;

            const measureIndex = findMeasureIndexForAbsBeat(absBeat);
            const bpm = (measureBeats && measureBeats[measureIndex])
                ? measureBeats[measureIndex]
                : (timeSignature.numerator * (4 / timeSignature.denominator));
            const beatInMeasure = (absBeat - ((measureStarts && measureStarts[measureIndex] != null) ? measureStarts[measureIndex] : (measureIndex * bpm))) + 1;

            for (let systemIndex = 0; systemIndex < layoutData.systemsParams.length; systemIndex++) {
                const sys = layoutData.systemsParams[systemIndex];
                const idx = sys.measureIndices.indexOf(measureIndex);
                if (idx < 0) continue;

                const startX = sys.startMeasuresX[idx];
                const endX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                const measureWidth = Math.max(1, endX - startX);
                const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
                const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / bpm));
                const x = startX + MEASURE_PADDING_X + (rel * contentWidth);

                markersBySystem[systemIndex].push({ x: x + 10, label: formatLabel(ctx) });
                break;
            }
        }

        markersBySystem.forEach(ms => ms.sort((a, b) => a.x - b.x));
        return markersBySystem;
    }, [analysisContextAbsBeat, analysisContexts, layoutData, timeSignature]);

    const timeSignatureMarkersBySystem = useMemo(() => {
        if (!layoutData || timeSignatureChanges.length === 0) return [] as { x: number; numerator: number; denominator: number; measureIndex: number }[][];

        const markersBySystem: { x: number; numerator: number; denominator: number; measureIndex: number }[][] = layoutData.systemsParams.map(() => []);
        const measureStarts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeats = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStarts || measureStarts.length === 0) {
                const bpm = timeSignature.numerator * (4 / timeSignature.denominator);
                return Math.floor(ab / bpm);
            }
            for (let m = measureStarts.length - 1; m >= 0; m--) {
                if (ab >= (measureStarts[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };
        const getXForMeasureStart = (system: any, measureIndex: number) => {
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return 0;
            return system.startMeasuresX[idx] + 6;
        };

        for (const tc of timeSignatureChanges) {
            const absBeat = timeSignatureChangeAbsBeat(tc);
            if (!Number.isFinite(absBeat)) continue;
            const measureIndex = Number.isFinite(tc.measureIndex as any)
                ? Number(tc.measureIndex)
                : findMeasureIndexForAbsBeat(absBeat);
            const sysIndex = layoutData.systemsParams.findIndex(sp => (sp.measureIndices || []).includes(measureIndex));
            if (sysIndex < 0) continue;
            const system = layoutData.systemsParams[sysIndex];
            const x = getXForMeasureStart(system, measureIndex);
            markersBySystem[sysIndex].push({ x, numerator: tc.numerator, denominator: tc.denominator, measureIndex });
        }

        markersBySystem.forEach(ms => ms.sort((a, b) => a.x - b.x));
        return markersBySystem;
    }, [layoutData, timeSignature, timeSignatureChangeAbsBeat, timeSignatureChanges]);

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

        const getLevel = (v: any): 'error' | 'warning' | 'exception' => {
            const s = (v?.severity || v?.level || v?.type || '').toString().toLowerCase();
            if (s.includes('exception') || s.includes('green')) return 'exception';
            if (s.includes('warn') || s.includes('yellow')) return 'warning';
            return 'error';
        };

        try {
            const rank: Record<'error' | 'warning' | 'exception', number> = {
                error: 3,
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
        const octave = Math.floor(midi / 12) - 1;
        return `${n}${octave}`;
    }, []);

    const sendMidiNote = useCallback((note: StaffNote, output: any, durationSec: number, whenMs?: number) => {
        if (!output || note.isRest) return;
        const midi = (note.midi ?? 0) + playbackTransposeSemitones;
        if (!Number.isFinite(midi) || midi <= 0) return;
        const vel = 100;
        const t0 = (typeof whenMs === 'number' && Number.isFinite(whenMs)) ? whenMs : window.performance.now();
        // Use WebMIDI scheduling to avoid chord notes being slightly staggered.
        output.send([0x90, midi, vel], t0);
        output.send([0x80, midi, 0], t0 + durationSec * 1000);
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

    const stopPlayback = useCallback(() => {
        playbackTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
        playbackTimeoutsRef.current = [];
        if (animationFrameRef.current) {
            window.cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        audioService.stopAllSounds?.();
        setPlayingNoteIds([]);
        setIsPlaying(false);

        // If the metronome was started as part of playback, stop it at end/stop.
        // Keep the toggle ON but suppress clicks until next Play.
        if (metronomeLinkedToPlaybackRef.current) {
            metronomeLinkedToPlaybackRef.current = false;
            metronomeSuppressedRef.current = true;
            stopMetronomeInternal();
        }
    }, [audioService, stopMetronomeInternal]);

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

            const curAbsBeat = b0 + ((ctx.currentTime - t0) / beatDurationSec);
            const pos = getPlayheadPosForAbsBeat(curAbsBeat);
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

    // Auto-scroll during playback so the playhead never disappears off-screen.
    const lastAutoScrollAtRef = useRef<number>(0);
    const lastAutoScrollSystemRef = useRef<number | null>(null);
    useEffect(() => {
        if (!isPlaying) return;
        if (!playheadPosition) return;

        const container = scoreScrollRef.current;
        if (!container) return;

        const sysEl = systemElementByIndexRef.current.get(playheadPosition.systemIndex);
        if (!sysEl) return;

        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
        const sameSystem = lastAutoScrollSystemRef.current === playheadPosition.systemIndex;
        if (sameSystem && (now - lastAutoScrollAtRef.current) < 60) return;

        // Use DOM geometry rather than assuming constant top padding.
        const playheadYLocal = (playheadYTopPx + playheadYBottomPx) / 2;
        const playheadYAbs = sysEl.offsetTop + playheadYLocal;

        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;

        const marginTop = 60;
        const marginBottom = 140;

        let targetTop: number | null = null;
        if (playheadYAbs < (viewTop + marginTop)) {
            targetTop = playheadYAbs - marginTop;
        } else if (playheadYAbs > (viewBottom - marginBottom)) {
            targetTop = playheadYAbs - (container.clientHeight - marginBottom);
        }

        if (targetTop == null) return;

        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const clamped = Math.max(0, Math.min(maxTop, targetTop));
        if (Math.abs(clamped - container.scrollTop) <= 2) return;

        // Immediate scroll keeps playback visually in sync.
        container.scrollTo({ top: clamped, behavior: 'auto' });
        lastAutoScrollAtRef.current = now;
        lastAutoScrollSystemRef.current = playheadPosition.systemIndex;
    }, [isPlaying, playheadPosition, playheadYBottomPx, playheadYTopPx]);

    const startPlayback = useCallback(async () => {
        if (!isAudioReady) return;

        // Ensure audio context is resumed so we can anchor scheduling.
        await audioService.ensureAudioIsReady();
        const audioCtx = audioService.audioContext;
        if (!audioCtx) return;

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const safeBpm = Math.max(20, Math.min(300, bpm || 120));
        const beatDurationSec = 60 / safeBpm;

        // Build a per-voice timeline so we can merge tied notes into a single longer note.
        type PlaybackItem = {
            note: StaffNote;
            absStartBeat: number;
            durationBeats: number;
            skip: boolean;
        };

        const byVoice = new Map<number, StaffNote[]>();
        rawNotes.forEach(n => {
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

            for (const n of voiceNotes) {
                let durationBeatsNotated = DURATION_VALUES[n.duration || 'quarter'] * (n.isDotted ? 1.5 : 1);

                if (!tupletContext) {
                    if (n.isTriplet) tupletContext = { notesInGroup: 3, beatsForGroup: durationBeatsNotated * 2, notesProcessed: 0 };
                    else if (n.isDuplet) tupletContext = { notesInGroup: 2, beatsForGroup: durationBeatsNotated * 3, notesProcessed: 0 };
                }
                if (tupletContext) durationBeatsNotated = tupletContext.beatsForGroup / tupletContext.notesInGroup;

                if (durationInMeasureNotated + durationBeatsNotated > beatsPerMeasure + 0.001) {
                    measureIndex++;
                    durationInMeasureNotated = 0;
                }

                const beat = durationInMeasureNotated + 1;
                const absStartBeatNotated = (measureIndex * beatsPerMeasure) + (beat - 1);

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

                voiceItems.push({ note: { ...n, voice: voice as any, measureIndex, beat }, absStartBeat, durationBeats, skip: false });

                durationInMeasureNotated += durationBeatsNotated;
                if (tupletContext) {
                    tupletContext.notesProcessed++;
                    if (tupletContext.notesProcessed >= tupletContext.notesInGroup) tupletContext = null;
                }
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
        const defaultStartAbsBeat = events[0].absBeat;
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
                const needed = new Set<string>();
                for (const ev of eventsToPlay) {
                    for (const it of ev.items) {
                        const n = it.note;
                        if (!n || n.isRest) continue;
                        const midi = (n.midi ?? 0) + playbackTransposeSemitones;
                        if (!Number.isFinite(midi) || midi < 21 || midi > 108) continue;
                        needed.add(midiToName(midi));
                    }
                }
                await audioService.preloadNotes(Array.from(needed));
            } catch {
                // ignore preload failures; playback will still attempt on-demand load
            }
        }

        eventsToPlay.forEach((ev) => {
            const delayMs = (ev.absBeat - startAbsBeat) * beatDurationSec * 1000;
            const when = audioStartTime + (delayMs / 1000);
            const t = window.setTimeout(async () => {
                const playable = ev.items
                    .map(x => x.note)
                    .filter(n => !n.isRest && (n.midi ?? 0) > 0);

                setPlayingNoteIds(playable.map(n => n.id));

                if (selectedMidiOutput) {
                    const midiWhenMs = startMs + delayMs;
                    ev.items.forEach((it) => {
                        const n = it.note;
                        if (n.isRest) return;
                        const durSec = Math.max(0.05, it.durationBeats * beatDurationSec);
                        sendMidiNote(n, selectedMidiOutput, durSec, midiWhenMs);
                    });
                } else if (audioService.audioContext) {
                    ev.items.forEach((it) => {
                        const n = it.note;
                        if (n.isRest) return;
                        const durSec = Math.max(0.05, it.durationBeats * beatDurationSec);
                        const midi = n.midi;
                        const midiT = (midi ?? 0) + playbackTransposeSemitones;
                        if (!Number.isFinite(midiT) || midiT < 21 || midiT > 108) return;
                        void audioService.playNote(midiToName(midiT), { when, duration: durSec });
                    });
                }
            }, Math.max(0, (startMs - performance.now()) + delayMs));

            playbackTimeoutsRef.current.push(t);
        });

        const endMs = (maxEndAbsBeat - startAbsBeat) * beatDurationSec * 1000;
        playbackTimeoutsRef.current.push(window.setTimeout(() => stopPlayback(), Math.max(0, (startMs - performance.now()) + endMs + 200)));
    }, [audioService, bpm, getPlayheadPosForAbsBeat, isAudioReady, isSwing, midiToName, rawNotes, selectedMidiOutput, sendMidiNote, startMetronomeScheduler, stopPlayback, timeSignature, playbackTransposeSemitones]);

    const togglePlayback = useCallback(() => {
        if (isPlaying) stopPlayback();
        else void startPlayback();
    }, [isPlaying, startPlayback, stopPlayback]);

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
                .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || (a.beat ?? 0) - (b.beat ?? 0));

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

                const bracketY = (highestY + yOffset) - 34;
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

            systems[systemIndex] = groups;
        });

        return systems;
    }, [layoutData, getNoteY]);

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
                .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || (a.beat ?? 0) - (b.beat ?? 0));

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

                const bracketY = (highestY + yOffset) - 34;
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

            systems[systemIndex] = groups;
        });

        return systems;
    }, [layoutData, getNoteY]);

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

    const computeDurationTicks = useCallback((n: StaffNote) => {
        try {
            const base = (DURATION_VALUES as any)[(n as any).duration || 'quarter'] || 1;
            let durBeats = base;
            if ((n as any).isDotted) durBeats *= 1.5;
            if ((n as any).isTriplet) durBeats *= 2 / 3;
            if ((n as any).isDuplet) durBeats *= 3 / 2;
            return Math.round(durBeats * TICKS_PER_QUARTER);
        } catch {
            return (n as any).durationTicks;
        }
    }, []);

    const applyEditToSelectedNotes = useCallback((
        updateFn: (n: StaffNote) => StaffNote,
        opts?: { rebuildTimeline?: boolean },
    ) => {
        if (!selectedNoteIds || selectedNoteIds.size === 0) return;

        setRawNotes(prev => {
            try {
                const selected = prev.filter(n => selectedNoteIds.has(n.id));
                if (selected.length === 0) return prev;

                let next = prev.map(n => selectedNoteIds.has(n.id) ? updateFn(n) : n);

                if (opts?.rebuildTimeline) {
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
    }, [selectedNoteIds, setRawNotes, timeSignature]);

    const applyAccidentalToSelectedNotes = useCallback((acc: AccidentalType | null) => {
        if (!selectedNoteIds || selectedNoteIds.size === 0) return;
        applyEditToSelectedNotes((n) => {
            if (n.isRest) return n;
            if (!acc) {
                const { userAccidental, explicitAccidental, accidental, ...rest } = n as any;
                return { ...(rest as StaffNote) };
            }
            return {
                ...(n as any),
                userAccidental: acc,
                explicitAccidental: acc,
                accidental: acc,
            } as StaffNote;
        });
    }, [applyEditToSelectedNotes, selectedNoteIds]);

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

    const applyDottedToSelectedNotes = useCallback((nextIsDotted: boolean) => {
        if (!selectedNoteIds || selectedNoteIds.size === 0) return;
        applyEditToSelectedNotes((n) => {
            if (n.isRest) return n;
            const updated = { ...(n as any), isDotted: nextIsDotted } as StaffNote;
            return { ...(updated as any), durationTicks: computeDurationTicks(updated) } as StaffNote;
        }, { rebuildTimeline: true });
    }, [applyEditToSelectedNotes, computeDurationTicks, selectedNoteIds]);

    const setDottedFromSource = useCallback((nextIsDotted: boolean, source: 'hotkey' | 'toolbar') => {
        dottedOneShotRef.current = (source === 'hotkey') && !!nextIsDotted;
        setSelectedInsertion(prev => ({ ...prev, isDotted: nextIsDotted }));
        applyDottedToSelectedNotes(nextIsDotted);
    }, [applyDottedToSelectedNotes, setSelectedInsertion]);

    // -----------------------
    // Editor interaction (restored minimal)
    // -----------------------
    const handleDeselectOnClickOutside = useCallback((e: React.MouseEvent) => {
        // If the click wasn't handled/stopped by a note/staff handler, treat it as
        // a background click and clear selection.
        setSelectedNoteIds(new Set());
    }, [setSelectedNoteIds]);

    const handleNoteClick = useCallback((noteId: string, systemIndex: number, e: React.MouseEvent | MouseEvent) => {
        if (justDraggedRef.current) {
            justDraggedRef.current = false;
            return;
        }

        const n = rawNotes.find(nn => nn.id === noteId);

        // INSERT UX FIX: clicking a rest should overwrite it (run insertion) rather than select it.
        // This avoids the "pause blocks insertion" annoyance.
        const isModifier = !!((e as any).shiftKey || (e as any).metaKey || (e as any).ctrlKey || (e as any).altKey);
        if (tool === 'insert' && n?.isRest && !isModifier) {
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
        if (n && typeof (n as any).voice === 'number') {
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

        // Aggiorna la violation selezionata se la nota è coinvolta in una violation
        if (!shiftKey) {
            if (next.size === 1 && next.has(noteId) && Array.isArray(violations)) {
                const candidates = (violations as any[])
                    .map((v, idx) => ({ v, idx }))
                    .filter(x => x.v && Array.isArray(x.v.noteIds) && x.v.noteIds.includes(noteId));

                if (candidates.length > 0) {
                    const sevRank: Record<string, number> = { error: 0, warning: 1, exception: 2 };
                    candidates.sort((a, b) => {
                        const la = Array.isArray(a.v.noteIds) ? a.v.noteIds.length : 99;
                        const lb = Array.isArray(b.v.noteIds) ? b.v.noteIds.length : 99;
                        if (la !== lb) return la - lb; // prefer tighter (e.g. 2-note) violations
                        const sa = sevRank[String(a.v.severity)] ?? 99;
                        const sb = sevRank[String(b.v.severity)] ?? 99;
                        if (sa !== sb) return sa - sb;
                        return a.idx - b.idx;
                    });
                    setSelectedViolationIndex(candidates[0].idx);
                } else {
                    setSelectedViolationIndex(null);
                }
            } else {
                setSelectedViolationIndex(null);
            }
        }

        // When a note becomes selected via pointer click, audition it.
        const didSelect = next.has(noteId);
        if (didSelect && n && !n.isRest) {
            void playNote(n, 0.6);
        }
    }, [getPlayheadPosForAbsBeat, playNote, rawNotes, selectedNoteIds, timeSignature, tool, violations]);

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
        const pasted: StaffNote[] = dataToPaste
            .map(n => {
                const m = n.measureIndex ?? 0;
                const b = n.beat ?? 1;
                const abs = absBeatForNote(n) + delta;
                if (!Number.isFinite(abs) || abs < 0) return null;

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

                    const targetVoice = forceSelectedVoice ? selectedVoice : ((n as any).voice ?? selectedVoice);
                    return {
                        ...(rest as StaffNote),
                        id: crypto.randomUUID(),
                        measureIndex: newMeasureIndex,
                        beat: newBeat,
                        startTick,
                        durationTicks,
                        voice: targetVoice,
                        clef: clefForVoice(targetVoice as any),
                        chordId: remapId(chordIdMap, (n as any).chordId),
                        groupId: remapId(groupIdMap, (n as any).groupId),
                        manualBeamGroupId: remapId(beamGroupIdMap, (n as any).manualBeamGroupId),
                    };
                } catch (e) {
                    const targetVoice = forceSelectedVoice ? selectedVoice : ((n as any).voice ?? selectedVoice);
                    return {
                        ...(rest as StaffNote),
                        id: crypto.randomUUID(),
                        measureIndex: newMeasureIndex,
                        beat: newBeat,
                        voice: targetVoice,
                        clef: clefForVoice(targetVoice as any),
                        chordId: remapId(chordIdMap, (n as any).chordId),
                        groupId: remapId(groupIdMap, (n as any).groupId),
                        manualBeamGroupId: remapId(beamGroupIdMap, (n as any).manualBeamGroupId),
                    };
                }
            })
            .filter(Boolean) as StaffNote[];

        if (pasted.length > 0) {
            const targetVoices = Array.from(new Set(pasted.map(n => Number((n as any).voice ?? selectedVoice)))).filter(v => Number.isFinite(v));

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

                return [...existingNotes, ...missingRests, ...pasted];
            });
            setSelectedNoteIds(new Set(pasted.map(n => n.id)));

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
        }
        pasteToSelectedVoiceRef.current = false;
    }, [clefForVoice, selectedVoice, setRawNotes, setSelectedNoteIds, timeSignature]);

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

        if (!playheadPosition || playheadPosition.systemIndex !== basePos.systemIndex || Math.abs(playheadPosition.x - targetX) > 0.5) {
            setPlayheadPosition({ x: targetX, systemIndex: basePos.systemIndex });
        }

        // Keep paste caret aligned to the same insertion suggestion.
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const measureIndex = Math.floor((absBeat as number) / beatsPerMeasure);
        const beat = Math.round((((absBeat as number) - (measureIndex * beatsPerMeasure)) + 1) * 1e6) / 1e6;

        if (!pasteCaret || pasteCaret.systemIndex !== basePos.systemIndex || Math.abs(pasteCaret.x - targetX) > 0.5) {
            setPasteCaret({ x: targetX, systemIndex: basePos.systemIndex, measureIndex, beat });
        }
    }, [estimateNoteheadOffsetPxForSystem, getPlayheadPosForAbsBeat, isPlaying, layoutData, pasteCaret, playheadPosition, refinePlayheadXToRenderedNoteheads, timeSignature]);

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

    const harmonyExplainTimeline = useMemo(() => {
        try {
            return getActiveNotesTimeline((analyzedNotes || notes) as any, timeSignature, timeSignatureChanges);
        } catch {
            return [] as any[];
        }
    }, [analyzedNotes, notes, timeSignature, timeSignatureChanges]);

    const ctxAtAbsBeatForExplain = useCallback((absBeat: number) => {
        try {
            return (effectiveAnalysisContexts || [])
                .filter(c => analysisContextAbsBeat(c as any) <= absBeat + 1e-6)
                .sort((a, b) => analysisContextAbsBeat(b as any) - analysisContextAbsBeat(a as any))[0];
        } catch {
            return null;
        }
    }, [analysisContextAbsBeat, effectiveAnalysisContexts]);

    const getNotesAtAbsBeatForExplain = useCallback((absBeat: number): any[] => {
        try {
            const tl = harmonyExplainTimeline as any[];
            let best: any = null;
            for (const ev of tl || []) {
                if (!ev || typeof ev.absBeat !== 'number') continue;
                if (ev.absBeat <= absBeat + 1e-6) best = ev;
                else break;
            }
            return (best?.notes || []) as any[];
        } catch {
            return [];
        }
    }, [harmonyExplainTimeline]);

    const openHarmonyExplainForLabel = useCallback((lbl: any) => {
        try {
            const absBeat = Number(lbl?.absBeat);
            if (!Number.isFinite(absBeat)) return;

            const ctx = ctxAtAbsBeatForExplain(absBeat);
            const tonic = ctx ? String((ctx as any).newTonic || '') : String(currentTonic || 'C');
            const isMinor = ctx ? !!(ctx as any).newIsMinor : !!isMinorMode;

            const notesHere = getNotesAtAbsBeatForExplain(absBeat) as StaffNote[];
            const debugSnapshot = getRomanAnalysisDebugSnapshot(notesHere as any, tonic, isMinor);

            const candidatesRaw = (() => {
                try { return identifyChordCandidates(notesHere as any) as any[]; } catch { return []; }
            })();
            const candidates = (candidatesRaw || []).slice(0, 10).map((c: any) => {
                const rootPc = (() => {
                    try {
                        const ni = c?.root?.noteIndex;
                        if (Number.isFinite(ni)) return (((Number(ni) % 12) + 12) % 12);
                        const m = c?.root?.midi;
                        if (Number.isFinite(m)) return (((Number(m) % 12) + 12) % 12);
                        return null;
                    } catch {
                        return null;
                    }
                })();
                return {
                    rootPc,
                    type: String(c?.type || ''),
                    matchType: String(c?.matchType || ''),
                    score: Number.isFinite(c?.score) ? Number(c.score) : 0,
                };
            });

            const { measureIndex, beat } = getMeasureIndexAndBeatFromAbsBeat(absBeat);
            const preferFlats = (() => {
                const t = String(tonic || '');
                if (t.includes('b') || t.includes('♭')) return true;
                return flatKeyValues.includes(t);
            })();

            const uniqPcCount = (() => {
                try {
                    const pcs = new Set<number>();
                    (notesHere || []).forEach((n: any) => {
                        if (!n || n.isRest) return;
                        const m = Number(n?.midi);
                        if (Number.isFinite(m)) pcs.add((((m % 12) + 12) % 12));
                        else if (Number.isFinite(n?.noteIndex)) pcs.add((((Number(n.noteIndex) % 12) + 12) % 12));
                    });
                    return pcs.size;
                } catch {
                    return 0;
                }
            })();

            const confidence = (() => {
                const reasons: string[] = [];
                const isOverride = !!lbl?.isOverride;
                if (isOverride) reasons.push('Override: etichetta impostata manualmente/da engine.');
                reasons.push(`Note considerate: ${Array.isArray(notesHere) ? notesHere.filter((n: any) => n && !n.isRest).length : 0}`);
                reasons.push(`Pitch classes: ${uniqPcCount}`);

                let level: 'high' | 'medium' | 'low' = 'low';
                if (isOverride) level = 'high';
                else if (uniqPcCount >= 3) level = 'high';
                else if (uniqPcCount === 2) level = 'medium';
                else level = 'low';

                return { level, reasons };
            })();

            const data: HarmonyExplainData = {
                absBeat,
                ui: {
                    measureIndex,
                    beatInMeasure: beat,
                    preferFlats,
                },
                context: { tonic, isMinor },
                label: {
                    roman: typeof lbl?.roman === 'string' ? lbl.roman : undefined,
                    romanDisplay: typeof lbl?.romanDisplay === 'string' ? lbl.romanDisplay : undefined,
                    symbol: typeof lbl?.symbol === 'string' ? lbl.symbol : undefined,
                    figures: Array.isArray(lbl?.figures) ? lbl.figures.map((x: any) => String(x)) : undefined,
                    pcsSig: typeof lbl?.pcsSig === 'string' ? lbl.pcsSig : undefined,
                    isOverride: !!lbl?.isOverride,
                },
                notes: (notesHere || []) as any,
                debugSnapshot,
                candidates,
                confidence,
            };

            setHarmonyExplainData(data);
            setIsHarmonyExplainOpen(true);
        } catch {
            // ignore
        }
    }, [ctxAtAbsBeatForExplain, currentTonic, getMeasureIndexAndBeatFromAbsBeat, getNotesAtAbsBeatForExplain, isMinorMode]);

    const openModulationMenuAtPlayhead = useCallback(() => {
        const container = staffContainerRef.current;

        const absBeat = Math.max(0, Math.round(getCurrentAbsBeatForPlayhead() * 1e6) / 1e6);
        const { measureIndex, beat } = getMeasureIndexAndBeatFromAbsBeat(absBeat);

        if (!container) {
            setContextMenu({ x: 120, y: 120, absBeat, measureIndex, beat });
            return;
        }

        // If the playhead isn't explicitly placed yet, derive it from the current absBeat.
        let pos = playheadPosition;
        if (!pos) {
            const derived = getPlayheadPosForAbsBeat(absBeat);
            if (derived) {
                setPlayheadPosition(derived);
                pos = derived;
            }
        }
        if (!pos) {
            setContextMenu({ x: 120, y: 120, absBeat, measureIndex, beat });
            return;
        }

        const safeX = Number.isFinite(pos.x as any) ? (pos.x as number) : 40;

        // Prefer the ref-map (more reliable than querying large DOMs repeatedly).
        let sysEl = systemElementByIndexRef.current.get(pos.systemIndex) as HTMLElement | null;
        if (!sysEl) sysEl = container.querySelector(`[data-system-index="${pos.systemIndex}"]`) as HTMLElement | null;
        if (!sysEl) sysEl = container.querySelector('[data-system-index]') as HTMLElement | null;

        if (sysEl) {
            const sysRect = sysEl.getBoundingClientRect();
            const x = sysRect.left + safeX;
            const y = sysRect.top + 16;
            setContextMenu({ x, y, absBeat, measureIndex, beat });
            return;
        }

        // Last-resort fallback: anchor to the score container.
        try {
            const r = container.getBoundingClientRect();
            setContextMenu({ x: r.left + 120, y: r.top + 60, absBeat, measureIndex, beat });
        } catch {
            setContextMenu({ x: 120, y: 120, absBeat, measureIndex, beat });
        }
    }, [getCurrentAbsBeatForPlayhead, getMeasureIndexAndBeatFromAbsBeat, getPlayheadPosForAbsBeat, playheadPosition]);

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

            if (wantsHarmonyOverride) {
                setHarmonyOverrideMenu({ x: e.clientX, y: e.clientY, absBeat, measureIndex, beat });
            } else {
                setContextMenu({ x: e.clientX, y: e.clientY, absBeat, measureIndex, beat });
            }
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
        // In compound meters (e.g. 6/8), allow placing longer notes on the 8th grid.
        // Otherwise a quarter note at the 4th 8th would snap left to the previous quarter.
        const isCompound = (timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3);
        const snapCapTicks = isCompound ? Math.round(TICKS_PER_QUARTER / 2) : TICKS_PER_QUARTER;
        const baseSnapGridTicks = Math.max(1, Math.min(durationTicks, snapCapTicks));
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

        if (wantsHarmonyOverride) {
            const absBeat = Math.max(0, Math.round((((layoutData as any)?.measureStartAbsBeat?.[hit.measureIndex] ?? (hit.measureIndex * beatsPerMeasure)) + (beat - 1)) * 1e6) / 1e6);
            setHarmonyOverrideMenu({ x: e.clientX, y: e.clientY, absBeat, measureIndex: hit.measureIndex, beat });
        }
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

    const handleBackgroundClick = useCallback((x: number, y: number, systemIndex: number, e?: MouseEvent) => {
        if (!layoutData) return;

        // Prevent the container click handler from immediately clearing selection after a staff click.
        e?.stopPropagation?.();

        // Click on empty staff clears current selection.
        // Do not clear on Cmd/Ctrl (used for paste-caret placement).
        if (!(e?.metaKey || e?.ctrlKey || e?.altKey)) {
            setSelectedNoteIds(new Set());
        }


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
        // Example (6/4): a half note (2 beats) should be placeable at beat 4, not only at beats 1/3/5.
        // We cap the snap grid to 1 beat (quarter) so longer notes can still start on any beat.
        // In compound meters (e.g. 6/8), cap at the 8th grid so quarters can start on any 8th.
        const tsAtMeasureStart = getTimeSignatureAtAbsBeat(measureStartAbsBeat);
        const isCompound = tsAtMeasureStart.denominator === 8 && (tsAtMeasureStart.numerator % 3 === 0) && tsAtMeasureStart.numerator > 3;
        const snapCapTicks = isCompound ? Math.round(TICKS_PER_QUARTER / 2) : TICKS_PER_QUARTER;
        const baseSnapGridTicks = Math.max(1, Math.min(durationTicks, snapCapTicks));
        const snapGridTicks = (e as any)?.shiftKey
            ? Math.max(1, Math.floor(baseSnapGridTicks / 2))
            : baseSnapGridTicks;

        // Quantize strictly in ticks (left-biased to avoid occasional snap-forward jitter).
        let snappedLocalTicks = Math.floor(localTicksRaw / snapGridTicks) * snapGridTicks;

        // Clamp so onset is always within the measure and fits the duration.
        const maxLocalStart = Math.max(0, ticksPerMeasure - durationTicks);
        if (snappedLocalTicks < 0) snappedLocalTicks = 0;
        if (snappedLocalTicks > maxLocalStart) snappedLocalTicks = maxLocalStart;

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
                if (letter && Number.isFinite(octave) && basePc != null) {
                    const measureIndex = Number(hit.measureIndex);
                    const beforeTick = Number(insertedStartTick);
                    const relevant = (rawNotes || [])
                        .filter((n: any) => n && !n.isRest)
                        .filter((n: any) => Number(n.measureIndex) === measureIndex)
                        .filter((n: any) => {
                            const c = (n.clef || ((n.voice === 3 || n.voice === 4) ? 'bass' : 'treble')) as ClefType;
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
        void playNote(newNote);
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
    ]);

    const getPlayheadSnapGridTicks = useCallback((useFineStep: boolean): number => {
        try {
            let durBeatsBase = DURATION_VALUES[selectedInsertion.duration] ?? 1;
            if (selectedInsertion.isDotted) durBeatsBase *= 1.5;
            durBeatsBase *= tupletFactor;
            if (!isFinite(durBeatsBase) || durBeatsBase <= 0) durBeatsBase = 1;
            const durationTicks = Math.max(1, Math.round(durBeatsBase * TICKS_PER_QUARTER));
            const isCompound = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
            const snapCapTicks = isCompound ? Math.round(TICKS_PER_QUARTER / 2) : TICKS_PER_QUARTER;
            const baseSnapGridTicks = Math.max(1, Math.min(durationTicks, snapCapTicks));
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

    const handleMouseMove = useCallback((x: number, y: number, systemIndex: number) => {
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

        if (!layoutData) return;

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
            setGhostNote({
                id: 'ghost',
                pitch: 'B',
                octave: targetClef === 'bass' ? 2 : 4,
                position: targetClef === 'bass' ? 4 : 8,
                midi: 0,
                noteIndex: 0,
                duration: selectedInsertion.duration,
                isRest: true,
                isTriplet,
                isDuplet,
                isDotted,
                xPosition: x, // Coincide esattamente con il mouse
                clef: targetClef,
                voice: selectedVoice,
                systemIndex,
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

        setGhostNote({
            id: 'ghost',
            ...props,
            duration: selectedInsertion.duration,
            isRest: false,
            isTriplet,
            isDuplet,
            isDotted,
            xPosition: x, // Coincide esattamente con il mouse
            clef: targetClef,
            voice: selectedVoice,
            systemIndex,
        });
    }, [applyActiveAccidental, applyAutoLeadingToneInMinor, clefForVoice, diatonicPositionFromSvgY, getNotePropertiesFromDiatonicPosition, getSystemMeasureAtX, isDotted, isDuplet, isSvgYWithinClefStaff, isTriplet, keySignature, layoutData, selectedInsertion, selectedVoice, staffSystemMode, timeSignature, tupletFactor]);

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
                const candidatesAll = layoutData.positionedNotes.filter(n => measureSet.has(n.measureIndex ?? -1));
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

                        const renderClef = clefForVoice(n.voice);
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

    // ------------------------------------------------------------------
    // FIX: symbols referenced by JSX must exist (prevents white screen)
    // ------------------------------------------------------------------
    const commitBpmFromString = useCallback((value: string) => {
        const trimmed = (value ?? '').trim();
        if (!trimmed) return;

        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed)) return;

        const clamped = Math.max(20, Math.min(300, parsed));
        setBpm(clamped);
        setBpmInputString(String(clamped));
    }, []);

    const activateBpmEdit = useCallback(() => {
        isBpmActiveRef.current = true;
        setIsBpmActive(true);
        setBpmInputString(String(bpm));
        // Focus the real input on next paint.
        window.requestAnimationFrame(() => {
            bpmInputRef.current?.focus();
            bpmInputRef.current?.select();
        });
    }, [bpm]);

    const handleBpmFocus = useCallback(() => {
        isBpmActiveRef.current = true;
        setIsBpmActive(true);
        setBpmInputString(prev => (prev ? prev : String(bpm)));
    }, [bpm]);

    const handleBpmKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        // While editing BPM, prevent global shortcuts from firing.
        e.stopPropagation();

        const key = e.key;

        const applyDelta = (delta: number) => {
            const base = Number.parseInt((bpmInputString || String(bpm)).trim(), 10);
            const current = Number.isFinite(base) ? base : bpm;
            const next = Math.max(20, Math.min(300, current + delta));
            setBpm(next);
            setBpmInputString(String(next));
        };

        if (key === 'ArrowUp') {
            e.preventDefault();
            applyDelta(e.shiftKey ? 10 : 1);
            return;
        }

        if (key === 'ArrowDown') {
            e.preventDefault();
            applyDelta(e.shiftKey ? -10 : -1);
            return;
        }

        if (key === 'Enter') {
            e.preventDefault();
            commitBpmFromString(bpmInputString || String(bpm));
            setIsBpmActive(false);
            return;
        }

        if (key === 'Escape') {
            e.preventDefault();
            setBpmInputString(String(bpm));
            setIsBpmActive(false);
            return;
        }

        if (key === 'Backspace') {
            e.preventDefault();
            setBpmInputString(s => (s ? s.slice(0, -1) : ''));
            return;
        }

        if (key === 'Delete') {
            e.preventDefault();
            setBpmInputString('');
            return;
        }

        // Digits: append
        if (/^[0-9]$/.test(key)) {
            e.preventDefault();
            setBpmInputString(s => {
                const next = `${(s ?? '').replace(/\s+/g, '')}${key}`;
                // keep it readable/bounded
                return next.slice(0, 3);
            });
            return;
        }
    }, [bpm, bpmInputString, commitBpmFromString]);

    const handleBpmInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const onlyDigits = (e.target.value ?? '').replace(/\D+/g, '').slice(0, 3);
        setBpmInputString(onlyDigits);
    }, []);

    const handleBpmInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        // Stop global shortcuts.
        e.stopPropagation();

        const applyDelta = (delta: number) => {
            const base = Number.parseInt((bpmInputString || String(bpm)).trim(), 10);
            const current = Number.isFinite(base) ? base : bpm;
            const next = Math.max(20, Math.min(300, current + delta));
            setBpm(next);
            setBpmInputString(String(next));
        };

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            applyDelta(e.shiftKey ? 10 : 1);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            applyDelta(e.shiftKey ? -10 : -1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            commitBpmFromString(bpmInputString || String(bpm));
            bpmInputRef.current?.blur();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            setBpmInputString(String(bpm));
            bpmInputRef.current?.blur();
            return;
        }
    }, [bpm, bpmInputString, commitBpmFromString]);

    const handleBpmBlur = useCallback(() => {
        isBpmActiveRef.current = false;
        commitBpmFromString(bpmInputString || String(bpm));
        setIsBpmActive(false);
    }, [bpm, bpmInputString, commitBpmFromString]);

    const toggleMetronome = useCallback(() => {
        setIsMetronomeOn(prev => {
            const next = !prev;
            if (!next) {
                metronomeSuppressedRef.current = false;
                metronomeLinkedToPlaybackRef.current = false;
            } else {
                // Allow it to start again (free-run or playback-linked).
                metronomeSuppressedRef.current = false;
            }
            return next;
        });
    }, []);

    const durations: { duration: NoteDuration; label: string; NoteIcon: React.FC; RestIcon: React.FC }[] = useMemo(() => ([
        { duration: 'whole', label: 'Semibreve', NoteIcon: WholeNoteIcon, RestIcon: WholeRestIcon },
        { duration: 'half', label: 'Minima', NoteIcon: HalfNoteIcon, RestIcon: HalfRestIcon },
        { duration: 'quarter', label: 'Semiminima', NoteIcon: QuarterNoteIcon, RestIcon: QuarterRestIcon },
        { duration: 'eighth', label: 'Croma', NoteIcon: EighthNoteIcon, RestIcon: EighthRestIcon },
        { duration: 'sixteenth', label: 'Semicroma', NoteIcon: SixteenthNoteIcon, RestIcon: SixteenthRestIcon },
        { duration: 'thirty-second', label: 'Biscroma', NoteIcon: ThirtySecondNoteIcon, RestIcon: ThirtySecondRestIcon },
        { duration: 'sixty-fourth', label: 'Semibiscroma', NoteIcon: SixtyFourthNoteIcon, RestIcon: SixtyFourthRestIcon },
    ]), []);

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
                        const clef: ClefType = (n.clef || ((n.voice === 3 || n.voice === 4) ? 'bass' : 'treble')) as ClefType;
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
            };

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

            // Space: always toggle playback (avoid requiring focus on the Play button)
            if (!isMod && (key === ' ' || key === 'spacebar')) {
                e.preventDefault();
                e.stopPropagation();
                togglePlayback();
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

            // K: toggle metronome
            if (!isMod && key === 'k') {
                e.preventDefault();
                e.stopPropagation();
                toggleMetronome();
                return;
            }

            // Cmd/Ctrl+C: copy selected notes
            if (isMod && key === 'c') {
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();

                const selected = rawNotes.filter(n => selectedNoteIds.has(n.id));
                const copied = selected.map(n => {
                    const { xPosition, ...rest } = n as any;
                    return rest as StaffNote;
                });
                setClipboard(copied);
                // Prova anche a copiare come testo JSON negli appunti di sistema
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(JSON.stringify(copied)).catch(() => setCopyPasteError('Copia negli appunti di sistema fallita.'));
                }
                return;
            }

            // Cmd/Ctrl+V: arm paste mode (next click selects paste location)
            if (isMod && (key === 'v' || (e as any).code === 'KeyV')) {
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

                try {
                    const notesWithBeats = calculateNoteBeats(rawNotes, timeSignature, timeSignatureChanges);
                    const selected = notesWithBeats.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
                    if (selected.length === 0) return;

                    setRawNotes(prev => prev.map(n => {
                        if (!selectedNoteIds.has(n.id)) return n;

                        const idx = notesWithBeats.findIndex(x => x.id === n.id);
                        if (idx < 0) return n;

                        const voice = (notesWithBeats[idx] as any).voice;
                        let next: StaffNote | undefined;
                        for (let i = idx + 1; i < notesWithBeats.length; i++) {
                            if ((notesWithBeats[i] as any).voice === voice) { next = notesWithBeats[i]; break; }
                        }
                        if (!next || next.isRest || next.midi !== (notesWithBeats[idx] as any).midi) return n;

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

                openModulationMenuAtPlayhead();
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

                    if (selectedNoteIds.size > 0) {
                        setRawNotes(prev => {
                            try {
                                const selected = prev.filter(n => selectedNoteIds.has(n.id));
                                if (selected.length === 0) return prev;

                                let next = prev.map(n => selectedNoteIds.has(n.id) ? ({ ...(n as any), duration } as StaffNote) : n);

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
                    }
                }
                return;
            }

            // R: toggle rest insertion mode (preserves duration / dotted / tuplets)
            if (!isMod && key === 'r') {
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
                const next = !selectedInsertion.isDotted;
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
                setSelectedNoteIds(new Set(rawNotes.map(n => n.id)));
                return;
            }

            // Cmd/Ctrl+Z: undo (Shift+Cmd/Ctrl+Z = redo)
            if (isMod && key === 'z') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    try { redoNotes && redoNotes(); } catch (err) { /* Removed debug log */ }
                } else {
                    undoNotes();
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
                setSelectedNoteIds(new Set());
                return;
            }

            
        };

        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
    }, [
        isActive,
        activeTab,
        selectedNoteIds,
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
    ]);

    const selectedNotesBeamState = useMemo(() => {
        const beamable = rawNotes.filter(n =>
            selectedNoteIds.has(n.id) &&
            !n.isRest &&
            DURATION_VALUES[n.duration || 'quarter'] <= 0.5
        );
        if (beamable.length < 2) return 'unbeamable' as const;

        const firstId = (beamable[0] as any).manualBeamGroupId;
        if (firstId && beamable.every(n => (n as any).manualBeamGroupId === firstId)) return 'beamed' as const;

        return beamable.some(n => (n as any).manualBeamGroupId) ? 'mixed' as const : 'unbeamed' as const;
    }, [rawNotes, selectedNoteIds]);

    const handleToggleBeamGroup = useCallback(() => {
        if (selectedNotesBeamState === 'unbeamable') return;

        const isBeamableSelected = (n: StaffNote) =>
            selectedNoteIds.has(n.id) && !n.isRest && DURATION_VALUES[n.duration || 'quarter'] <= 0.5;

        if (selectedNotesBeamState === 'beamed') {
            setRawNotes(prev => prev.map(n => {
                if (!isBeamableSelected(n)) return n;
                const { manualBeamGroupId, ...rest } = n as any;
                return { ...rest, manualBeamDisabled: true };
            }));
        } else {
            const gid = crypto.randomUUID();
            setRawNotes(prev => prev.map(n => isBeamableSelected(n) ? ({ ...(n as any), manualBeamGroupId: gid, manualBeamDisabled: false }) : n));
        }
    }, [selectedNotesBeamState, selectedNoteIds, setRawNotes]);

    const handleToggleTie = useCallback(() => {
        if (selectedNoteIds.size === 0) return;

        const notesWithBeats = calculateNoteBeats(rawNotes, timeSignature, timeSignatureChanges);
        const selected = notesWithBeats.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
        if (selected.length === 0) return;

        setRawNotes(prev => prev.map(n => {
            if (!selectedNoteIds.has(n.id)) return n;

            const idx = notesWithBeats.findIndex(x => x.id === n.id);
            if (idx < 0) return n;

            const voice = notesWithBeats[idx].voice;
            let next: StaffNote | undefined;
            for (let i = idx + 1; i < notesWithBeats.length; i++) {
                if (notesWithBeats[i].voice === voice) { next = notesWithBeats[i]; break; }
            }
            if (!next || next.isRest || next.midi !== notesWithBeats[idx].midi) return n;

            if ((n as any).isTiedToNext) {
                const { isTiedToNext, ...rest } = n as any;
                return rest;
            }
            return { ...(n as any), isTiedToNext: true };
        }));
    }, [rawNotes, selectedNoteIds, setRawNotes, timeSignature]);

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
    }, [selectedNoteIds, selectedTiePair, setRawNotes]);

    // =========================================================
    // RENDER
    // =========================================================

    const toolbarGroups: Record<ToolbarGroupId, React.ReactNode> = {
        playback: (
            <div className="flex items-center gap-2">
                <button
                    onClick={togglePlayback}
                    className={`p-2 rounded-full transition-colors ${isPlaying ? 'text-yellow-400 hover:bg-yellow-400/20' : 'text-green-400 hover:bg-green-400/20'}`}
                    title={isPlaying ? "Pausa (Spazio)" : "Play (Spazio)"}
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
                    onChange={(e) => setMetronomeUnit(e.target.value as any)}
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
                    <div className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform" style={{ transform: `translateX(${isMinorMode ? '100%' : '0%'}) ` }}></div>
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
                <TimeSignatureControl value={timeSignature} onChange={setTimeSignature} />
            </div>
        ),
        measures: (
            <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Misure:</span>
                <div className="flex items-center">
                    <input
                        value={minMeasureCountDraft}
                        onChange={(e) => setMinMeasureCountDraft(e.target.value)}
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
                            onChange={(e) => setMeasuresPerLineDraft(e.target.value)}
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
                            title="Misure per riga (1–12)"
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
                        className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${selectedVoice === v ? (v === 1 ? 'bg-blue-600 text-white' : v === 2 ? 'bg-orange-500 text-white' : v === 3 ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'text-gray-300 hover:bg-gray-600'}`}
                        title={v === 1 ? 'Soprano' : v === 2 ? 'Alto' : v === 3 ? 'Tenore' : 'Basso'}
                    >
                        {v === 1 ? 'S' : v === 2 ? 'A' : v === 3 ? 'T' : 'B'}
                    </button>
                ))}
            </div>
        ),
        insert: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button
                    onClick={() => { setSelectedInsertion(prev => ({ ...prev, type: prev.type === 'note' ? 'rest' : 'note' })); }}
                    className={`p-1 rounded-md transition-colors ${selectedInsertion.type === 'rest' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    title={
                        selectedInsertion.type === 'note'
                            ? 'Passa a Pausa (R)'
                            : 'Modalità Pausa attiva — passa a Nota (R)'
                    }
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
                            if (selectedNoteIds.size > 0) {
                                applyEditToSelectedNotes((n) => {
                                    if (n.isRest) return n;
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
                                    className={`p-1 rounded-md transition-colors ${
                                        selectedInsertion.isDotted
                                            ? 'bg-cyan-600 text-white'
                                            : 'text-gray-300 hover:bg-gray-600'
                                    }`}
                                    title="Punto di valore"
                                >
                                    <DotIcon className={TOOLBAR_ICON_CLASS} />
                                </button>
                <button onClick={() => {
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
                }} className={`p-1 rounded-md transition-colors ${isTriplet ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Terzina"><TripletIcon className={TOOLBAR_ICON_CLASS} /></button>

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
                    title={playheadPosition ? "Inserisci/Rimuovi doppia barra alla misura della playhead" : "Imposta prima la playhead (click sullo staff)"}
                >
                    <span className="text-sm font-bold leading-none">||</span>
                </button>
                <button
                    onClick={insertMeasureAtPlayhead}
                    disabled={!playheadPosition}
                    className="p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600"
                    title={playheadPosition ? "Inserisci misura alla playhead (sposta avanti le successive)" : "Imposta prima la playhead (click sullo staff)"}
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
                    className={`p-1 rounded-md transition-colors text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600`}
                    title={
                        selectedNotesBeamState === 'beamed' ? "Separa note selezionate" :
                            selectedNotesBeamState === 'unbeamable' ? "Seleziona almeno 2 note per la travatura" :
                                "Unisci note selezionate"
                    }
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
                    title={isAnalysisEnabled ? "Disattiva Analisi" : "Attiva Analisi"}
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
                        {/* Staff system mode */}
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

                        {/* Formato (radio) */}
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

                        {/* MIDI (moved to bottom) */}
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

                        {/* MIDI outputs (keeps existing behavior, nested under the MIDI toggle) */}
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

    // Toolbar visibility: stable toggle via shortcut.
    const [isToolbarHidden, setIsToolbarHidden] = usePreference<boolean>('editor.toolbarHidden');
    const forceToolbarVisible = isToolbarCustomizeOpen || isMoreMenuOpen;
    const isToolbarVisible = forceToolbarVisible || !isToolbarHidden;

    // Transport bar (draggable overlay shown when toolbar is hidden).
    const [transportPos, setTransportPos] = useState<{ x: number; y: number } | null>(null);
    const [isDraggingTransport, setIsDraggingTransport] = useState(false);
    const [transportDrag, setTransportDrag] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

    useEffect(() => {
        if (!isDraggingTransport || !transportDrag) return;
        const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

        const onMove = (e: MouseEvent) => {
            try {
                e.preventDefault();
                const dx = e.clientX - transportDrag.startX;
                const dy = e.clientY - transportDrag.startY;
                const nextX = transportDrag.originX + dx;
                const nextY = transportDrag.originY + dy;
                const margin = 8;
                const maxX = Math.max(margin, window.innerWidth - margin - 240);
                const maxY = Math.max(margin, window.innerHeight - margin - 80);
                setTransportPos({ x: clamp(nextX, margin, maxX), y: clamp(nextY, margin, maxY) });
            } catch {
                // ignore
            }
        };

        const onUp = () => {
            setIsDraggingTransport(false);
            setTransportDrag(null);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [isDraggingTransport, transportDrag]);

    // Toolbar hover tooltip (shows even for disabled buttons).
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
        <div className={`relative flex-grow flex flex-col ${isToolbarVisible ? 'gap-4' : 'gap-0'} min-h-0`}>
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

            <PreferencesModal
                isOpen={isPreferencesOpen}
                onClose={() => setIsPreferencesOpen(false)}
            />

            <HarmonyLabelExplainModal
                isOpen={isHarmonyExplainOpen}
                onClose={() => { setIsHarmonyExplainOpen(false); setHarmonyExplainData(null); }}
                data={harmonyExplainData}
            />

            {!isToolbarVisible && showQuickInsertBar && (
                <div className="absolute z-50" style={transportPos ? { left: transportPos.x, top: transportPos.y } : { left: 12, top: 12 }}>
                    <div className="pointer-events-auto rounded-lg bg-slate-800/95 border border-slate-700 shadow-lg overflow-hidden">
                        <div
                            className="flex items-center justify-between gap-2 px-2 py-1 border-b border-slate-700 cursor-move"
                            onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                e.preventDefault();
                                e.stopPropagation();
                                const cur = transportPos ?? { x: 12, y: 12 };
                                setIsDraggingTransport(true);
                                setTransportDrag({ startX: e.clientX, startY: e.clientY, originX: cur.x, originY: cur.y });
                            }}
                            title="Transport (trascina per spostare)"
                        >
                            <div className="text-[11px] font-semibold text-slate-200">Transport</div>
                            <button
                                className="px-2 py-0.5 text-[11px] font-semibold rounded bg-slate-700/60 border border-slate-600 text-slate-100 hover:bg-slate-700"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => setShowQuickInsertBar(false)}
                                title="Chiudi transport"
                                type="button"
                            >
                                ×
                            </button>
                        </div>

                        <div className="p-2">
                            <div className="flex flex-row items-center flex-wrap gap-x-3 gap-y-2">
                                {toolbarGroups.voices}
                                {toolbarGroups.insert}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showHarmonyDebug && (
                <div className="absolute top-2 right-2 z-40 pointer-events-none">
                    <div className="inline-flex items-center gap-2 rounded-md bg-slate-800/90 border border-slate-700 px-2 py-1 text-[11px] text-slate-200 shadow">
                        {showHarmonyDebug && <span className="px-1.5 py-0.5 rounded bg-slate-700">Harmony Debug: ON</span>}
                    </div>
                </div>
            )}
            
            <div className="flex flex-row gap-4 flex-grow min-h-0">
                <div
                    ref={scoreScrollRef}
                    className={`flex-grow overflow-y-auto bg-stone-100 rounded-lg shadow-inner ${viewMode === 'linear' ? 'overflow-x-auto' : 'overflow-x-hidden'}`}
                    onClick={handleDeselectOnClickOutside}
                >
                    <div
                        ref={staffContainerRef}
                        className={`${canvasFormat === 'page' ? 'max-w-screen-lg mx-auto' : 'w-full'} p-4`}
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
                            if (n.isRest) return n;

                            // Render-only staff mapping by voice (allows toggling layouts without mutating stored notes).
                            const mappedClef: ClefType = clefForVoice(n.voice);

                            const tieFromPrev = tiedFromPrevNoteIds.has(n.id);

                            // If the user explicitly chose an accidental for this note, keep it.
                            if ((n as any).userAccidental) return { ...n, clef: mappedClef, isTiedFromPrev: tieFromPrev };

                            // Otherwise, recompute the accidental needed for the *existing pitch* under the
                            // current key signature, without changing the staff position/spelling.
                            const noteName = makeNoteNameFromPitchAndMidi(n.pitch, n.midi);
                            const nextExplicit = calculateAccidental(noteName, keyAccidentals);
                            return { ...n, clef: mappedClef, explicitAccidental: nextExplicit, isTiedFromPrev: tieFromPrev };
                        });

                        const actualSystemWidth = system.width;
                        const ghost = ghostNote && ghostNote.systemIndex === systemIndex ? ghostNote : null;
                        const systemBarlines = layoutData.systemsBarlines?.[systemIndex] || [];
                        const systemDuplets = dupletGroupsBySystem[systemIndex] || [];
                        const systemTriplets = tripletGroupsBySystem[systemIndex] || [];

                        const systemHarmonyLabels = (harmonyLabelsBySystemSequenced?.[systemIndex] || []);

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
                                    if (!cur.isPassing) continue;
                                    // hide the label corresponding to the weak-beat event where the passing note sits
                                    const curAbs = qAbs((cur.measureIndex ?? 0) * beatsPerMeasure + ((cur.beat ?? 1) - 1));

                                    // If there's no label here, nothing to hide.
                                    const sigHere = labelSigAtAbs.get(curAbs);
                                    if (!sigHere) {
                                        hideLabelAbsBeats.add(curAbs);
                                        continue;
                                    }

                                    // Find neighboring label signatures.
                                    let prevSig: string | null = null;
                                    let nextSig: string | null = null;
                                    for (let k = 0; k < orderedLabelAbs.length; k++) {
                                        const a = orderedLabelAbs[k];
                                        if (a < curAbs) prevSig = labelSigAtAbs.get(a) ?? prevSig;
                                        if (a > curAbs) { nextSig = labelSigAtAbs.get(a) ?? null; break; }
                                    }

                                    // Hide only if this label is redundant (same as previous or next).
                                    // If it differs from BOTH neighbors, keep it (real short harmony change).
                                    const sameAsPrev = !!prevSig && prevSig === sigHere;
                                    const sameAsNext = !!nextSig && nextSig === sigHere;
                                    if (sameAsPrev || sameAsNext) hideLabelAbsBeats.add(curAbs);
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
                            className={`relative ${viewMode === 'page' ? 'mb-8' : 'mb-0'}`}
                            style={{ width: actualSystemWidth, height: systemHeightPx }}
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
                                onMouseMoveStaff={(x, y) => handleMouseMove(x, y, systemIndex)}
                                                                onNoteHitPoints={(points) => {
                                                                        systemNoteHitPointsRef.current[systemIndex] = points;
                                                                }}
                                ghostNote={ghost}
                                                                engravingMode={engravingMode}
                                                                showVoiceColors={showVoiceColors}
                              />
                                                                                                                                );
                                                                                                                        })()}
                            </RenderErrorBoundary> {/* FIX: this closing tag was missing */}

                                                        {/* Overlay: playhead */}
                                                        {playheadPosition && playheadPosition.systemIndex === systemIndex && (
                                                            <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                                                {
                                                                    (() => {
                                                                        const staffEndX = (actualSystemWidth ?? 0) - STAFF_MARGIN;
                                                                        const xClamped = Math.min(playheadPosition.x, staffEndX);
                                                                        return (
                                                                            <line
                                                                                x1={xClamped}
                                                                                y1={playheadYTopPx}
                                                                                x2={xClamped}
                                                                                y2={playheadYBottomPx}
                                                                                className="stroke-cyan-500"
                                                                                strokeWidth={2}
                                                                                opacity={0.7}
                                                                            />
                                                                        );
                                                                    })()
                                                                }
                                                            </svg>
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
                                                y={staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 14) : (TOP_STAFF_TOP + 44)}
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
                                                                      const RB_SHIFT_Y = 30;

                                                                                                                                        // SATB antiche: lower the whole bass-analysis block (roman + figures)
                                                                                                                                        // with a fixed offset to avoid collisions with bass noteheads/ties.
                                                                                                                                        // No dynamic collision detection.
                                                                                                                                        const SATB_BASS_FIGURES_EXTRA_Y_PX = 32;
                                                                                                                                        const figuresExtraY = (staffSystemMode === 'satb_ancient') ? SATB_BASS_FIGURES_EXTRA_Y_PX : 0;

                                                                                                                                        const romanBelowY = bottomStaffBottomLineY + 28 + RB_SHIFT_Y + figuresExtraY;
                                                                                                                                        const figuresY0 = bottomStaffBottomLineY + 20 + RB_SHIFT_Y + figuresExtraY;

                                                                                                                                        // Chord symbols (sigle) stay above the top staff; shift down only a few pixels.
                                                                                                                                        const SYMBOL_SHIFT_Y = 6;
                                                                                                                                        const symbolsY = (staffSystemMode === 'satb_ancient' ? VF_SATB_SOPRANO_Y : TOP_STAFF_TOP) - 18 + SYMBOL_SHIFT_Y;

                                                                    const isHiddenMarker = !!(lbl as any).hiddenMarker;
                                                                    const qAbs = (a: number) => {
                                                                        if (!Number.isFinite(a)) return a;
                                                                        return Math.round(a * 1000) / 1000;
                                                                    };
                                                                    const lblAbsQ = qAbs(Number((lbl as any).absBeat));
                                                                    const showRoman = showRomanAnalysis && !!lbl.roman && !isHiddenMarker && !(hideLabelAbsBeats.has(lblAbsQ));
                                                                    const showSymbol = showSymbolAnalysis && !!(lbl as any).symbol && !isHiddenMarker && !(hideLabelAbsBeats.has(lblAbsQ));

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

                                                                            const romanShown = String(
                                                                                (lbl as any).isOverride
                                                                                    ? ((lbl as any).romanDisplay ?? (lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? lbl.roman ?? '')
                                                                                    : ((lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? (lbl as any).romanDisplay ?? lbl.roman ?? '')
                                                                            );
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
                                                                                    pointerEvents="all"
                                                                                    style={{ cursor: 'pointer' }}
                                                                                    onMouseDown={(e) => {
                                                                                        try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
                                                                                        openHarmonyExplainForLabel(lbl as any);
                                                                                    }}
                                                                                >
                                                                                    {(lbl as any).symbol}
                                                                                </text>
                                                                            ) : null}

                                                                            {/* Roman numerals + figured bass below the bass staff */}
                                                                            {showRoman ? (
                                                                                <g>
                                                                                    {(() => {
                                                                                        // Display-only suffix: show vii°7 for diminished seventh chords
                                                                                        // without changing the underlying roman used for stability heuristics.
                                                                                        const needsDim7Suffix = (() => {
                                                                                            try {
                                                                                                const base = String(
                                                                                                    (lbl as any).isOverride
                                                                                                        ? ((lbl as any).romanDisplay ?? (lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? lbl.roman ?? '')
                                                                                                        : ((lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? (lbl as any).romanDisplay ?? lbl.roman ?? '')
                                                                                                );
                                                                                                if (!(base.includes('°') || base.includes('ø'))) return false;
                                                                                                const figTexts = (lbl.figures || []) as string[];
                                                                                                const has7th = figTexts.some(t => String(t).includes('7'));
                                                                                                if (has7th) return true;
                                                                                                const sym = String((lbl as any).symbol || '');
                                                                                                return /dim7/i.test(sym) || (sym.includes('°') && /7/.test(sym));
                                                                                            } catch {
                                                                                                return false;
                                                                                            }
                                                                                        })();

                                                                                        const romanBaseText = String(
                                                                                            (lbl as any).isOverride
                                                                                                ? ((lbl as any).romanDisplay ?? (lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? lbl.roman ?? '')
                                                                                                : ((lbl as any).sequenceRomanFunctional ?? (lbl as any).sequenceRoman ?? (lbl as any).romanDisplay ?? lbl.roman ?? '')
                                                                                        );
                                                                                        const romanText = romanBaseText + (needsDim7Suffix ? '7' : '');
                                                                                        const romanW = measureTextWidth(romanText, romanFont);
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
                                                                                                        strokeWidth={2}
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
                                                                                                    fill="black"
                                                                                                    pointerEvents="all"
                                                                                                    style={{ cursor: 'pointer' }}
                                                                                                    onMouseDown={(e) => {
                                                                                                        try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
                                                                                                        openHarmonyExplainForLabel(lbl as any);
                                                                                                    }}
                                                                                                >
                                                                                                    {romanText}
                                                                                                </text>

                                                                                                {lbl.figures?.length ? (
                                                                                                    <g>
                                                                                                        {lbl.figures.map((f, i) => (
                                                                                                            <text
                                                                                                                key={`${lbl.id}-fig-${i}`}
                                                                                                                x={figuresX}
                                                                                                                y={figuresY0 + (i * 12)}
                                                                                                                textAnchor="start"
                                                                                                                fontSize={12}
                                                                                                                fill="black"
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
                                                                                                        const suspInfos = suspNotes
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
                                                                                                                    strokeWidth={2}
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
                                                                    const systemConnections = (errorConnections || []).filter(c => {
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
                                                                            try { console.log('[RENDER] skipping-connection-no-violation', { noteId1: c.noteId1, noteId2: c.noteId2, ruleId: c.ruleId }); } catch(_) {}
                                                                            return false;
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

                                                                    const connectionStroke = (level: 'error' | 'warning' | 'exception') =>
                                                                        level === 'warning' ? '#f59e0b' : level === 'exception' ? '#22c55e' : '#ef4444';

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
                                                                        for (const n of analyzedNotes as any[]) {
                                                                            if (!n || !n.id) continue;
                                                                            if (!systemNoteIdSet.has(n.id)) continue;
                                                                            const mark = (n as any).ornamentMark;
                                                                            const isNeighbor = !!(n as any).isNeighbor;
                                                                            if (!mark && !isNeighbor) continue;
                                                                            // Currently only neighbor-tone uses the 'v' mark.
                                                                            const text = (mark as string) || 'v';

                                                                            const hp = hitPointById.get(n.id);
                                                                            const pPos = notePositions.get(n.id);
                                                                            if (!hp && !pPos) continue;
                                                                            const clef = (noteClefById.get(n.id) || 'treble') as ClefType;
                                                                            const voiceNum = (noteVoiceById.get(n.id) || 1) as Voice;
                                                                            const q = hp ? hp : applyOverlayShift(pPos as any, clef, voiceNum);

                                                                            // Place slightly above-left to avoid the stem.
                                                                            // Fine-tune: nudge 3px to the right for better alignment.
                                                                            const x = q.x - 5;
                                                                            const y = q.y - 12;

                                                                            results.push(
                                                                                <text
                                                                                    key={`orn-${n.id}`}
                                                                                    x={x}
                                                                                    y={y}
                                                                                    textAnchor="middle"
                                                                                    dominantBaseline="middle"
                                                                                    fontSize={12}
                                                                                    fontWeight={700}
                                                                                    fill="black"
                                                                                    opacity={0.9}
                                                                                >
                                                                                    {text}
                                                                                </text>
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
                                                                                                strokeWidth={2}
                                                                                                strokeLinecap="butt"
                                                                                            />
                                                                                            <text
                                                                                                x={q.x} // end of line (x2)
                                                                                                y={lineY}
                                                                                                textAnchor="middle"
                                                                                                dominantBaseline="middle"
                                                                                                fontSize={12}
                                                                                                fontWeight={700}
                                                                                                fill="black"
                                                                                            >
                                                                                                p
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

                {activeTab === 'analysis' && (
                    <div className="w-full max-w-sm flex-shrink-0 h-full min-h-0">
                        {isAnalysisEnabled ? (
                            <div className="h-full min-h-0">
                                <HarmonyAnalysisPanel
                                    violations={violations}
                                    sequenceMatches={sequenceMatches}
                                    sequencesEnabled={isSequencesEnabled}
                                    onToggleSequences={() => setIsSequencesEnabled(!isSequencesEnabled)}
                                    onHoverViolation={setHoveredViolationNotes}
                                    selectedViolationIndex={selectedViolationIndex}
                                    onSelectViolation={index => {
                                        setSelectedViolationIndex(index);
                                        if (index != null && violations[index]) {
                                            setSelectedNoteIds(new Set(violations[index].noteIds));
                                        }
                                        if (typeof index === 'number') scrollScoreToViolationIndex(index);
                                    }}
                                />
                            </div>
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

            {contextMenu && (
                <ModulationContextMenu
                    menuData={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onApply={handleApplyContext}
                    onRemove={handleRemoveContext}
                    onDeleteMeasure={(measureIndex) => {
                        deleteMeasureAtIndex(measureIndex);
                    }}
                    onApplyTimeSignature={handleApplyTimeSignatureChange}
                    onRemoveTimeSignature={handleRemoveTimeSignatureChange}
                    existingHarmonyOverride={existingHarmonyOverrideForContextMenu}
                    onApplyHarmonyOverride={applyHarmonyOverride}
                    onRemoveHarmonyOverride={removeHarmonyOverride}
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

const ModulationContextMenu: React.FC<{
    menuData: { x: number; y: number; absBeat: number; measureIndex: number; beat: number };
    onClose: () => void;
    onApply: (absBeat: number, newTonic: string, newIsMinor: boolean, label?: string) => void;
    onRemove: (absBeat: number) => void;
    onDeleteMeasure: (measureIndex: number) => void;
    onApplyTimeSignature: (absBeat: number, numerator: number, denominator: number, measureIndex?: number) => void;
    onRemoveTimeSignature: (absBeat: number) => void;
    existingHarmonyOverride: HarmonyLabelOverride | null;
    onApplyHarmonyOverride: (absBeat: number, roman: string, figures: string[], symbol: string) => void;
    onRemoveHarmonyOverride: (absBeat: number) => void;
    initialKey: string;
    initialIsMinor: boolean;
    initialLabel?: string;
    initialTimeSignature: TimeSignature;
}> = ({ menuData, onClose, onApply, onRemove, onDeleteMeasure, onApplyTimeSignature, onRemoveTimeSignature, existingHarmonyOverride, onApplyHarmonyOverride, onRemoveHarmonyOverride, initialKey, initialIsMinor, initialLabel, initialTimeSignature }) => {
    const [tempKey, setTempKey] = useState(initialKey);
    const [tempIsMinor, setTempIsMinor] = useState(initialIsMinor);
    const [tempLabel, setTempLabel] = useState(initialLabel || '');
    const [tempNumerator, setTempNumerator] = useState<number>(initialTimeSignature.numerator);
    const [tempDenominator, setTempDenominator] = useState<number>(initialTimeSignature.denominator);
    const menuRef = useRef<HTMLDivElement>(null);

    const [floatingPos, setFloatingPos] = useState<{ top: number; left: number }>({ top: menuData.y, left: menuData.x });
    const menuSizeRef = useRef<{ w: number; h: number }>({ w: 360, h: 420 });
    const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; baseTop: number; baseLeft: number }>({ dragging: false, startX: 0, startY: 0, baseTop: 0, baseLeft: 0 });

    const clampPos = useCallback((top0: number, left0: number) => {
        try {
            const pad = 12;
            const vw = window.innerWidth || 0;
            const vh = window.innerHeight || 0;
            const w = menuSizeRef.current.w || 0;
            const h = menuSizeRef.current.h || 0;

            let top = Number(top0);
            let left = Number(left0);
            if (!Number.isFinite(top)) top = pad;
            if (!Number.isFinite(left)) left = pad;

            if (left + w > vw - pad) left = Math.max(pad, vw - pad - w);
            if (top + h > vh - pad) top = Math.max(pad, vh - pad - h);
            if (left < pad) left = pad;
            if (top < pad) top = pad;
            return { top, left };
        } catch {
            return { top: top0, left: left0 };
        }
    }, []);

    const [roman, setRoman] = useState<string>(existingHarmonyOverride?.roman || '');
    const [symbol, setSymbol] = useState<string>(existingHarmonyOverride?.symbol || '');
    const [figuresRaw, setFiguresRaw] = useState<string>(() => {
        try {
            const figs = (existingHarmonyOverride?.figures || []).map(f => String(f));
            return figs.join('/');
        } catch {
            return '';
        }
    });

    useEffect(() => {
        setTempLabel(initialLabel || '');
        setTempNumerator(initialTimeSignature.numerator);
        setTempDenominator(initialTimeSignature.denominator);
    }, [initialLabel, initialTimeSignature.denominator, initialTimeSignature.numerator, menuData.absBeat]);

    useLayoutEffect(() => {
        try {
            const el = menuRef.current;
            if (!el) return;

            // Clamp inside viewport so the menu is always reachable.
            const pad = 12;
            window.requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect();
                if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
                    menuSizeRef.current = { w: rect.width, h: rect.height };
                }
                const vw = window.innerWidth || 0;
                const vh = window.innerHeight || 0;

                let top = Number(menuData.y);
                let left = Number(menuData.x);
                if (!Number.isFinite(top)) top = pad;
                if (!Number.isFinite(left)) left = pad;

                if (left + rect.width > vw - pad) left = Math.max(pad, vw - pad - rect.width);
                if (top + rect.height > vh - pad) top = Math.max(pad, vh - pad - rect.height);
                if (left < pad) left = pad;
                if (top < pad) top = pad;

                setFloatingPos(clampPos(top, left));
            });
        } catch {
            // ignore
        }
    }, [clampPos, menuData.x, menuData.y, menuData.absBeat]);

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            try {
                if (!dragRef.current.dragging) return;
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                setFloatingPos(clampPos(dragRef.current.baseTop + dy, dragRef.current.baseLeft + dx));
            } catch {
                // ignore
            }
        };
        const handleUp = () => {
            dragRef.current.dragging = false;
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [clampPos]);

    const beginDrag = (e: React.MouseEvent) => {
        try {
            if ((e as any).button != null && (e as any).button !== 0) return;
            dragRef.current.dragging = true;
            dragRef.current.startX = e.clientX;
            dragRef.current.startY = e.clientY;
            dragRef.current.baseTop = floatingPos.top;
            dragRef.current.baseLeft = floatingPos.left;
            e.preventDefault();
            e.stopPropagation();
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        setRoman(existingHarmonyOverride?.roman || '');
        setSymbol(existingHarmonyOverride?.symbol || '');
        try {
            const figs = (existingHarmonyOverride?.figures || []).map(f => String(f));
            setFiguresRaw(figs.join('/'));
        } catch {
            setFiguresRaw('');
        }
    }, [existingHarmonyOverride, menuData.absBeat]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    const handleApplyClick = () => {
        const tonicToApply = tempIsMinor ? (relativeMinors[tempKey] || tempKey) : tempKey;
        onApply(menuData.absBeat, tonicToApply, tempIsMinor, tempLabel);
    };

    const parseFigures = (raw: string): string[] => {
        const s = String(raw || '').trim();
        if (!s) return [];
        return s
            .split(/[\/\s,]+/g)
            .map(x => x.trim())
            .filter(Boolean);
    };

    const handleApplyHarmonyOverride = () => {
        onApplyHarmonyOverride(menuData.absBeat, roman, parseFigures(figuresRaw), symbol);
    };

    return (
        <div
            ref={menuRef}
            style={{ top: floatingPos.top, left: floatingPos.left }}
            className="fixed z-50 bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-600 flex flex-col gap-3 w-[360px] max-w-[90vw] max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
        >
            <div className="flex items-center justify-between gap-2">
                <h3
                    className="text-white font-bold text-sm cursor-move select-none"
                    title="Trascina per spostare"
                    onMouseDown={beginDrag}
                >
                    Modulazione / tonicizzazione (Misura {menuData.measureIndex + 1}, beat {Number.isInteger(menuData.beat) ? menuData.beat : menuData.beat.toFixed(3)})
                </h3>
                <button
                    onClick={onClose}
                    className="px-2 py-0.5 text-[11px] rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors flex-shrink-0"
                    title="Chiudi"
                >
                    ✕
                </button>
            </div>
            <div className="flex items-center gap-2">
                 <select value={tempKey} onChange={e => setTempKey(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs w-full">
                    <optgroup label="Diesis (♯)">{sharpKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                    <optgroup label="Bemolli (♭)">{flatKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                </select>
                <div className="relative flex p-0.5 bg-gray-900/50 rounded-md flex-shrink-0">
                    <div className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform" style={{ transform: `translateX(${tempIsMinor ? '100%' : '0%'}) ` }}></div>
                    <button onClick={() => setTempIsMinor(false)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${!tempIsMinor ? 'text-gray-900' : 'text-gray-300'}`}>Mag</button>
                    <button onClick={() => setTempIsMinor(true)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${tempIsMinor ? 'text-gray-900' : 'text-gray-300'}`}>min</button>
                </div>
            </div>
            <div className="flex gap-2">
                <button onClick={handleApplyClick} className="px-2 py-1 text-[11px] rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors">Applica contesto</button>
                <button onClick={() => onRemove(menuData.absBeat)} className="px-2 py-1 text-[11px] rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors">Rimuovi</button>
            </div>
            <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-300">Misura</label>
                <button
                    onClick={() => onDeleteMeasure(menuData.measureIndex)}
                    className="px-2 py-1 text-[11px] rounded-md bg-red-800 hover:bg-red-700 font-semibold transition-colors"
                >
                    Cancella misura
                </button>
                <div className="text-[10px] text-gray-400">Elimina la misura e sposta indietro tutto ciò che segue.</div>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-300">Cambio di tempo (opzionale)</label>
                <div className="flex items-center gap-2">
                    <TimeSignatureControlNumber value={tempNumerator} onChange={setTempNumerator} min={1} max={16} />
                    <TimeSignatureControlNumber value={tempDenominator} onChange={setTempDenominator} min={2} max={16} stepFunction={denominatorStepFn} />
                    <button
                        onClick={() => onApplyTimeSignature(menuData.absBeat, tempNumerator, tempDenominator, menuData.measureIndex)}
                        className="px-2 py-1 text-[11px] rounded-md bg-cyan-700 hover:bg-cyan-600 font-semibold transition-colors"
                    >
                        Applica
                    </button>
                    <button
                        onClick={() => onRemoveTimeSignature(menuData.absBeat)}
                        className="px-2 py-1 text-[11px] rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors"
                    >
                        Rimuovi
                    </button>
                </div>
            </div>
            <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-300">Testo (opzionale)</label>
                <input
                    value={tempLabel}
                    onChange={e => setTempLabel(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder="Es. Modulazione a Do Maggiore"
                />
            </div>

            <div className="h-px bg-slate-600/60" />

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-300">Override armonia (funzionale)</label>
                    <span className="text-[10px] text-gray-400">sostituisce Roman/figure/sigla</span>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300">Roman</label>
                    <input
                        value={roman}
                        onChange={e => setRoman(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                        placeholder="es. I, V/vi, Ger+"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300">Figure (separate da / o spazio)</label>
                    <input
                        value={figuresRaw}
                        onChange={e => setFiguresRaw(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                        placeholder="es. 6/5"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300">Simbolo accordo (opzionale)</label>
                    <input
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                        placeholder="es. D7/F#"
                    />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleApplyHarmonyOverride}
                        className="px-2 py-1 text-[11px] rounded-md bg-cyan-700 hover:bg-cyan-600 font-semibold transition-colors"
                        title="Applica override armonico a questo beat"
                    >
                        Applica override
                    </button>
                    <button
                        onClick={() => onRemoveHarmonyOverride(menuData.absBeat)}
                        className="px-2 py-1 text-[11px] rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors"
                        title="Rimuove l'override armonico a questo beat"
                    >
                        Rimuovi override
                    </button>
                </div>
            </div>
        </div>
    );
};


const HarmonyOverrideContextMenu: React.FC<{
    menuData: { x: number; y: number; absBeat: number; measureIndex: number; beat: number };
    existing: HarmonyLabelOverride | null;
    onClose: () => void;
    onApply: (absBeat: number, roman: string, figures: string[], symbol: string) => void;
    onRemove: (absBeat: number) => void;
}> = ({ menuData, existing, onClose, onApply, onRemove }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [floatingPos, setFloatingPos] = useState<{ top: number; left: number }>({ top: menuData.y, left: menuData.x });
    const menuSizeRef = useRef<{ w: number; h: number }>({ w: 320, h: 260 });
    const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; baseTop: number; baseLeft: number }>({ dragging: false, startX: 0, startY: 0, baseTop: 0, baseLeft: 0 });
    const [roman, setRoman] = useState<string>(existing?.roman || '');
    const [symbol, setSymbol] = useState<string>(existing?.symbol || '');
    const [figuresRaw, setFiguresRaw] = useState<string>(() => {
        try {
            const figs = (existing?.figures || []).map(f => String(f));
            return figs.join('/');
        } catch {
            return '';
        }
    });

    useEffect(() => {
        setRoman(existing?.roman || '');
        setSymbol(existing?.symbol || '');
        try {
            const figs = (existing?.figures || []).map(f => String(f));
            setFiguresRaw(figs.join('/'));
        } catch {
            setFiguresRaw('');
        }
    }, [existing]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    useLayoutEffect(() => {
        try {
            const el = menuRef.current;
            if (!el) return;

            window.requestAnimationFrame(() => {
                const pad = 12;
                const rect = el.getBoundingClientRect();
                if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
                    menuSizeRef.current = { w: rect.width, h: rect.height };
                }
                const vw = window.innerWidth || 0;
                const vh = window.innerHeight || 0;

                let top = Number(menuData.y);
                let left = Number(menuData.x);
                if (!Number.isFinite(top)) top = pad;
                if (!Number.isFinite(left)) left = pad;

                if (left + rect.width > vw - pad) left = Math.max(pad, vw - pad - rect.width);
                if (top + rect.height > vh - pad) top = Math.max(pad, vh - pad - rect.height);
                if (left < pad) left = pad;
                if (top < pad) top = pad;

                setFloatingPos({ top, left });
            });
        } catch {
            // ignore
        }
    }, [menuData.x, menuData.y, menuData.absBeat]);

    const clampPos = useCallback((top0: number, left0: number) => {
        try {
            const pad = 12;
            const vw = window.innerWidth || 0;
            const vh = window.innerHeight || 0;
            const w = menuSizeRef.current.w || 0;
            const h = menuSizeRef.current.h || 0;

            let top = Number(top0);
            let left = Number(left0);
            if (!Number.isFinite(top)) top = pad;
            if (!Number.isFinite(left)) left = pad;

            if (left + w > vw - pad) left = Math.max(pad, vw - pad - w);
            if (top + h > vh - pad) top = Math.max(pad, vh - pad - h);
            if (left < pad) left = pad;
            if (top < pad) top = pad;
            return { top, left };
        } catch {
            return { top: top0, left: left0 };
        }
    }, []);

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            try {
                if (!dragRef.current.dragging) return;
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                setFloatingPos(clampPos(dragRef.current.baseTop + dy, dragRef.current.baseLeft + dx));
            } catch {
                // ignore
            }
        };
        const handleUp = () => {
            dragRef.current.dragging = false;
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [clampPos]);

    const beginDrag = (e: React.MouseEvent) => {
        try {
            if ((e as any).button != null && (e as any).button !== 0) return;
            dragRef.current.dragging = true;
            dragRef.current.startX = e.clientX;
            dragRef.current.startY = e.clientY;
            dragRef.current.baseTop = floatingPos.top;
            dragRef.current.baseLeft = floatingPos.left;
            e.preventDefault();
            e.stopPropagation();
        } catch {
            // ignore
        }
    };

    const parseFigures = (raw: string): string[] => {
        const s = String(raw || '').trim();
        if (!s) return [];
        return s
            .split(/[\/\s,]+/g)
            .map(x => x.trim())
            .filter(Boolean);
    };

    const handleApply = () => {
        onApply(menuData.absBeat, roman, parseFigures(figuresRaw), symbol);
    };

    return (
        <div
            ref={menuRef}
            style={{ top: floatingPos.top, left: floatingPos.left }}
            className="fixed z-50 bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-600 flex flex-col gap-3 w-[320px] max-w-[90vw] max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
        >
            <div className="flex items-center justify-between gap-2">
                <h3
                    className="text-white font-bold text-sm cursor-move select-none"
                    title="Trascina per spostare"
                    onMouseDown={beginDrag}
                >
                    Override analisi (Misura {menuData.measureIndex + 1}, beat {Number.isInteger(menuData.beat) ? menuData.beat : menuData.beat.toFixed(3)})
                </h3>
                <button
                    onClick={onClose}
                    className="px-2 py-0.5 text-[11px] rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors flex-shrink-0"
                    title="Chiudi"
                >
                    ✕
                </button>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-300">Roman</label>
                <input
                    value={roman}
                    onChange={e => setRoman(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder="es. V/vi"
                />
                <label className="text-xs text-gray-300">Figure (separate da / o spazio)</label>
                <input
                    value={figuresRaw}
                    onChange={e => setFiguresRaw(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder="es. 4/5/9"
                />
                <label className="text-xs text-gray-300">Simbolo accordo (opzionale)</label>
                <input
                    value={symbol}
                    onChange={e => setSymbol(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder="es. G7(b9)/F"
                />
                <p className="text-[11px] text-gray-400">Suggerimento: apri questo menu con Option+click destro.</p>
            </div>
            <div className="flex gap-2 mt-2">
                <button onClick={handleApply} className="flex-1 px-3 py-1 text-sm rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors">Applica</button>
                <button onClick={() => onRemove(menuData.absBeat)} className="px-3 py-1 text-sm rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors">Rimuovi</button>
                <button onClick={onClose} className="px-3 py-1 text-sm rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors">Annulla</button>
            </div>
        </div>
    );
};


const IconComponent: React.FC<{ type: 'note' | 'rest'; duration: NoteDuration; className?: string }> = ({ type, duration, className }) => {
    const icons = {
        note: { whole: WholeNoteIcon, half: HalfNoteIcon, quarter: QuarterNoteIcon, eighth: EighthNoteIcon, sixteenth: SixteenthNoteIcon, 'thirty-second': ThirtySecondNoteIcon, 'sixty-fourth': SixtyFourthNoteIcon },
        rest: { whole: WholeRestIcon, half: HalfRestIcon, quarter: QuarterRestIcon, eighth: EighthRestIcon, sixteenth: SixteenthRestIcon, 'thirty-second': ThirtySecondRestIcon, 'sixty-fourth': SixtyFourthRestIcon }
    };
    const Comp = icons[type][duration];
    return <Comp className={className} />;
};

// KEEP ONLY ONE export default (at the very end)
export default GrandStaffEditor;
