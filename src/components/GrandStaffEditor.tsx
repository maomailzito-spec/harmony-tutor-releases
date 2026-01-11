// ...existing code...
// TypeScript: dichiarazione per window.electronAPI
declare global {
    interface Window {
        electronAPI?: {
            onMenuAction: (handler: (action: string, payload: any) => void) => (() => void) | void;
            saveFile: (content: string, targetPath?: string) => Promise<any>;
            addRecentFile: (filePath: string) => Promise<any>;
        };
    }
}
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ArrowUturnLeftIcon, PauseIcon as PauseSolidIcon, PlayIcon as PlaySolidIcon } from '@heroicons/react/24/solid';
import { StaffNote, KeySignature, NoteDuration, TimeSignature, Barline, ClefType, Voice, HarmonyAnalysisResult, ErrorConnection, AccidentalType, AnalysisContext } from '../types';
import { AudioService } from '../services/AudioService';
import { 
    WholeNoteIcon, HalfNoteIcon, QuarterNoteIcon, EighthNoteIcon, SixteenthNoteIcon, ThirtySecondNoteIcon, SixtyFourthNoteIcon,
    WholeRestIcon, HalfRestIcon, QuarterRestIcon, EighthRestIcon, SixteenthRestIcon, ThirtySecondRestIcon, SixtyFourthRestIcon,
    TripletIcon, SharpIcon, FlatIcon, NaturalIcon, DoubleSharpIcon, DoubleFlatIcon, TieIcon, DotIcon
} from './icons/NoteValueIcons';
import { CycleIcon } from './icons/CycleIcon';
import { useUndoableState } from '../hooks/useUndoableState';
import { applyHarmonyRules, getKeySignature, calculateNoteBeats, getRomanAnalysis, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS, getNotePropertiesFromDiatonicPosition, getNotePropertiesFromMidi, getChordSymbol, calculateAccidental, getActiveNotesTimeline, identifyChordCandidates, calculateRomanFromChordInfo, ticksToBeats, beatsToTicks, rebuildMeasureTimelineForVoice } from '../utils/musicTheory';
import HarmonyAnalysisPanel from './HarmonyAnalysisPanel';
import { NOTE_NAMES, DURATION_VALUES, ALL_NOTE_SPELLINGS, CHORD_FORMULAS, TICKS_PER_QUARTER, DEFAULT_PX_PER_TICK } from '../constants';
import { GroupIcon } from './icons/GroupIcon';
import { UngroupIcon } from './icons/UngroupIcon';
import { FlipStemIcon } from './icons/FlipStemIcon';
import VexflowGrandStaff from './VexflowGrandStaff';

interface GrandStaffEditorProps {
    isActive: boolean;
    audioService: AudioService;
    isAudioReady: boolean;
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

const TOOLBAR_PREFS_KEY = 'harmony-tutor.toolbarPrefs.v1';
const STAFF_SYSTEM_MODE_KEY = 'harmony-tutor.staffSystemMode.v1';
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
    
    const validDenominators = [2, 4, 8, 16];
    const denominatorStepFn = (current: number, direction: 'up' | 'down') => {
        const currentIndex = validDenominators.indexOf(current);
        if (direction === 'up') {
            return validDenominators[Math.min(validDenominators.length - 1, currentIndex + 1)];
        } else {
            return validDenominators[Math.max(0, currentIndex - 1)];
        }
    };

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

const GrandStaffEditor: React.FC<GrandStaffEditorProps> = ({ isActive, audioService, isAudioReady }) => {
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
    const [isTriplet, setIsTriplet] = useState(false);
    const [isDuplet, setIsDuplet] = useState(false);
    const [isSwing, setIsSwing] = useState(false);
    const [tupletNoteCount, setTupletNoteCount] = useState(0);
    const [tripletBaseDuration, setTripletBaseDuration] = useState<NoteDuration | null>(null);
    const [activeAccidental, setActiveAccidental] = useState<AccidentalType | null>(null);
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
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; absBeat: number; measureIndex: number; beat: number } | null>(null);
    const [isAnalysisEnabled, setIsAnalysisEnabled] = useState(true);
    const [showRomanAnalysis, setShowRomanAnalysis] = useState(true);
    const [showSymbolAnalysis, setShowSymbolAnalysis] = useState(false);
    const [showMeasureNumbers, setShowMeasureNumbers] = useState(true);
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
        const beatDurationSec = 60 / safeBpm; // quarter note = 1 beat
        const unitBeats = metronomeUnit === 'eighth' ? 0.5 : (metronomeUnit === 'dotted-quarter' ? 1.5 : 1);
        const unitDurationSec = beatDurationSec * unitBeats;
        const beatsPerMeasureRaw = (timeSignature?.numerator ?? 4) * (4 / (timeSignature?.denominator ?? 4));
        const beatsPerMeasure = Math.max(1, Number.isFinite(beatsPerMeasureRaw) ? beatsPerMeasureRaw : 4);

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
            if (!Number.isFinite(absBeat) || !Number.isFinite(beatsPerMeasure)) return false;
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
    }, [audioService, bpm, isAudioReady, metronomeUnit, stopMetronomeInternal, timeSignature?.denominator, timeSignature?.numerator]);

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

    const notes = useMemo(() => calculateNoteBeats(rawNotes, timeSignature), [rawNotes, timeSignature]);

    const [marqueeSelectOnlyCurrentVoice, setMarqueeSelectOnlyCurrentVoice] = useState(false);


    // Mantieni latestRawNotes aggiornato
    useEffect(() => {
        latestRawNotes.current = rawNotes;
    }, [rawNotes]);
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

    const handleMenuAction = useCallback(async (action: string, payload: any) => {
        const api = (window as any).electronAPI;

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
                        const absBeats = copied.map(n => ((n.measureIndex ?? 0) * beatsPerMeasureLocal) + ((n.beat ?? 1) - 1));
                        const baseAbs = Math.min(...absBeats);
                        const measureIdx = Math.max(0, Math.floor(baseAbs / beatsPerMeasureLocal));
                        const beatInMeasure = Math.round(((baseAbs - (measureIdx * beatsPerMeasureLocal)) + 1) * 1e6) / 1e6;
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
                        const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
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

                        const measureIndex = Math.floor(snappedAbsBeat / beatsPerMeasureLocal);
                        const beat = Math.round(((snappedAbsBeat - (measureIndex * beatsPerMeasureLocal)) + 1) * 1e6) / 1e6;

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
            const projectData = JSON.stringify({
                notes: latestRawNotes.current,
                staffSystemMode,
                // Project-level settings
                keySignatureRoot,
                projectTitle,
                titleFontSize,
                titleFontFamily,
                timeSignature,
                isMinorMode,
                autoLeadingToneInMinor,
                keyChangeMode,
                modalTonicOverride,
                analysisContexts,
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
            setIsMinorMode(false);
            setAutoLeadingToneInMinor(true);
            setKeyChangeMode('none');
            setModalTonicOverride('');
            setAnalysisContexts([]);
            setBpm(120);
            setIsBpmActive(false);
            setIsMetronomeOn(false);
            setMetronomeUnit('quarter');
            try {
                const data = payload?.data;
                if (!data) throw new Error("Nessun dato fornito per l'apertura.");
                const loadedProject = JSON.parse(data);
                if (loadedProject && Array.isArray(loadedProject.notes)) {
                    // Self-heal older/saved projects: keep spelling fields as-is, but
                    // ensure pitch-class fields are consistent for analysis.
                    const normalizedNotes = (loadedProject.notes as any[]).map((n: any) => {
                        try {
                            if (!n || typeof n !== 'object') return n;
                            if (n.isRest) {
                                return {
                                    ...n,
                                    midi: Number.isFinite(n.midi) ? n.midi : 0,
                                    noteIndex: 0,
                                };
                            }

                            const midi = Number(n.midi);
                            if (Number.isFinite(midi)) {
                                return {
                                    ...n,
                                    midi,
                                    noteIndex: mod12Local(midi),
                                };
                            }

                            const ni = typeof n.noteIndex === 'number' ? n.noteIndex : 0;
                            return { ...n, noteIndex: mod12Local(ni) };
                        } catch {
                            return n;
                        }
                    });

                    // Convert legacy beat/measure floats to high-resolution ticks for stability.
                    try {
                        const ts = (loadedProject.timeSignature && typeof loadedProject.timeSignature === 'object') ? loadedProject.timeSignature : { numerator: 4, denominator: 4 };
                        const beatsPerMeasure = ts.numerator * (4 / ts.denominator);
                        const ticksPerBeat = TICKS_PER_QUARTER; // quarter = 1 beat
                        const withTicks = (normalizedNotes as any[]).map(n => {
                            try {
                                const m = Number.isFinite(n.measureIndex) ? n.measureIndex : 0;
                                const b = Number.isFinite(n.beat) ? n.beat : 1;
                                const absBeat = (m * beatsPerMeasure) + (b - 1);
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
            }
        } else if (action === 'set-show-measure-numbers') {
            setShowMeasureNumbers(!!payload?.enabled);
        } else if (action === 'toggle-toolbar-customize') {
            setIsToolbarCustomizeOpen(prev => !prev);
        }
    }, [setRawNotes, setKeySignatureRoot, setProjectTitle, setTimeSignature, setClipboard, setSelectedNoteIds, setActiveTab, setDoubleBarlineMeasures, setMinMeasureCount, setMeasuresPerLine, setIsMinorMode, setKeyChangeMode, setModalTonicOverride, setIsTriplet, setIsDuplet, setIsSwing, setTupletNoteCount, setTripletBaseDuration, setActiveAccidental, setSelectedVoice, setHoveredViolationNotes, setSelectedViolationIndex, setViewMode, pasteMarker, setPasteCaret, setAnalysisContexts, setContextMenu, setShowRomanAnalysis, setShowSymbolAnalysis, setShowMeasureNumbers, setToolbarGroupOrder, setIsToolbarCustomizeOpen, setMidiOutputs, setSelectedMidiOutput, setBpm, setIsBpmActive, setIsMetronomeOn, setCurrentProjectFilePath, bpm, isBpmActive, isMetronomeOn, metronomeUnit, toolbarGroupOrder, keySignatureRoot, projectTitle, titleFontSize, titleFontFamily, timeSignature, analysisContexts, isMinorMode, keyChangeMode, modalTonicOverride, undoNotes, redoNotes, handlePrint, staffSystemMode, setStaffSystemMode]);

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
            handleMenuAction(action, payload);
        });
        return () => {
            if (removeListener) removeListener();
        };
    }, [handleMenuAction]);

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
            return { analyzedNotes: notes, connections: [], violations: [] };
        }
        return applyHarmonyRules(notes, keySignature, currentTonic, isMinorMode, analysisContexts, timeSignature);
    }, [notes, keySignature, currentTonic, isMinorMode, analysisContexts, isAnalysisEnabled, timeSignature]);
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
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const legacyAbsBeat = (ctx.measureIndex ?? 0) * beatsPerMeasure;
        return Number.isFinite(ctx.absBeat as any) ? (ctx.absBeat as number) : legacyAbsBeat;
    }, [timeSignature]);

    const handleApplyContext = (absBeat: number, newTonic: string, newIsMinor: boolean) => {
        const safeAbsBeat = Math.max(0, Math.round(absBeat * 1e6) / 1e6);

        setAnalysisContexts(prev => {
            const next = (prev || []).filter(c => Math.abs(analysisContextAbsBeat(c) - safeAbsBeat) > 1e-6);
            next.push({ absBeat: safeAbsBeat, newTonic, newIsMinor });
            return next.sort((a, b) => analysisContextAbsBeat(a) - analysisContextAbsBeat(b));
        });
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
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

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

        // Compute layout using ticks per system to ensure stable px-per-beat inside each system.
        const usablePageWidth = systemRightX - startOffset - STAFF_PADDING_X;
        const MIN_PX_PER_QUARTER = 48;
        const ticksPerMeasure = beatsPerMeasure * TICKS_PER_QUARTER;

        // Build systems using the user-selected measures-per-line as the primary
        // constraint, while still splitting earlier if the line would overflow.
        const desiredMeasuresPerLine = Math.max(1, Math.min(12, measuresPerLine || 4));

        const tentativeSystems: { measureIndices: number[] }[] = [];
        let curSys: number[] = [];
        // Natural width for a measure using the deterministic default px-per-tick
        // (used only for system splitting heuristics).
        const naturalMeasureWidth = (_mIdx: number, isFirstMeasureInSystem: boolean) => {
            const measureTicks = ticksPerMeasure;
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
            const totalTicks = measureCount * ticksPerMeasure;
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
            const totalTicks = sys.measureIndices.reduce((s, mi) => s + ticksPerMeasure, 0);

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
                    : Math.round((((n.measureIndex ?? 0) * beatsPerMeasure) + ((n.beat ?? 1) - 1)) * TICKS_PER_QUARTER));
                ticks.sort((a, b) => a - b);
                for (let i = 1; i < ticks.length; i++) {
                    const d = ticks[i] - ticks[i-1];
                    if (d > 0 && d < minDeltaTicks) minDeltaTicks = d;
                }
            });
            if (!isFinite(minDeltaTicks) || minDeltaTicks <= 0) minDeltaTicks = ticksPerMeasure;

            const neededPxPerTickFromNotes = MIN_PIXEL_SPACING / Math.max(1, minDeltaTicks);
            const defaultPx = (typeof DEFAULT_PX_PER_TICK === 'number' && DEFAULT_PX_PER_TICK > 0) ? DEFAULT_PX_PER_TICK : 0;
            const pxPerTick = Math.max(minPxPerTick, defaultPx, neededPxPerTickFromNotes, (availableContentWidth / Math.max(1, totalTicks)));

            const systemBarlines: Barline[] = [];
            let curX = curXStart;
            const startMeasuresX: number[] = [];
            sys.measureIndices.forEach((m, idx) => {
                const measureTicks = ticksPerMeasure;
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
                                const measureStartTick = beatsToTicks(m * beatsPerMeasure);
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
            const samplePxPerQuarter = sampleMeasureWidth > 0 ? ((sampleMeasureWidth - (MEASURE_PADDING_X * 2)) / Math.max(1, beatsPerMeasure)) : 0;
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
        return { positionedNotes: finalNotes, systemsBarlines: allSystemsBarlines, systemsParams: systemsParams, measureFinalWidths };
    }, [analyzedNotes, containerWidth, timeSignature, keySignature, measuresPerLine, viewMode, minMeasureCount, doubleBarlineMeasures]);

    // Keep a ref to the latest layoutData so async callbacks can read current layout
    const layoutDataRef = useRef(layoutData);
    useEffect(() => { layoutDataRef.current = layoutData; }, [layoutData]);

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
        if (!isAnalysisEnabled || !layoutData) return [];

        // Use the timeline of all active notes at each event (start/end of any note)
        const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature);

        // Labels should follow *structural onsets* rather than every scanpoint.
        // Note-off-only scanpoints can temporarily reduce the verticality (e.g. 2 notes)
        // and cause spurious chord identification (like #IV° ...) even when the harmony
        // is conceptually being held.
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

                const nearInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
                if (!nearInt(inMeasure)) return false;
                const beat0 = Math.round(inMeasure);

                // Strong beats: 1 (beat0=0) and, when applicable, 3 (beat0=2) in common meters.
                const isStrong = beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
                return isStrong;
            } catch {
                return false;
            }
        });
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const ctxAtAbsBeat = (absBeat: number) => (analysisContexts || [])
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

        // For each system, collect all timeline events that fall within its measures
        const labelsBySystem: { id: string; x: number; roman: string; figures: string[]; symbol: string; absBeat?: number; hiddenMarker?: boolean }[][] = layoutData.systemsParams.map(() => []);


        // Helper: compute xPosition for a given absBeat in a system
        function getXForAbsBeat(absBeat: number, system: any) {
            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
            const measureIndex = Math.floor(absBeat / beatsPerMeasure);
            const beatInMeasure = (absBeat - (measureIndex * beatsPerMeasure)) + 1;
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
                            const nearInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
                            if (!nearInt(inMeasure)) return false;
                            const beat0 = Math.round(inMeasure);
                            const isStrong = beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
                            return !isStrong;
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
                    const hasNctFlag = !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura);
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
                            const nearInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
                            if (nearInt(inMeasure)) {
                                const beat0 = Math.round(inMeasure);
                                const isStrong = beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
                                if (isStrong) return false;
                            }
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
                if (isNonChordToneAtLabelEvent(n, event.absBeat)) {
                    continue;
                }
                lastStructural.set(v, n);
            }

            const harmonicNotes = Array.from(lastStructural.values()).filter(Boolean);
            const fallbackHarmonicNotes = (harmonicNotes.length >= 2)
                ? harmonicNotes
                : (fullNotes || []).filter((n: any) => n && !n.isRest);

            // If a suspension originates at this event, the held tone is a non-chord tone
            // against the new harmony. Exclude it from the chord-analysis snapshot so we
            // don't accidentally label the verticality as a sus/add sonority (e.g. V7/6).
            const harmonicNotesNoSuspAtThisBeat = fallbackHarmonicNotes.filter((n: any) => {
                const s = n?.isSuspension;
                if (!s || typeof s.fromAbsBeat !== 'number') return true;
                return Math.abs(s.fromAbsBeat - event.absBeat) >= 1e-6;
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
                    const nearInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
                    const isStrong = (() => {
                        if (!nearInt(inMeasure)) return false;
                        const beat0 = Math.round(inMeasure);
                        return beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
                    })();

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
                        const isSuspStartHere = isSusp && Math.abs((s.fromAbsBeat as number) - absBeat) < 1e-6;
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
            const harmonicSig = signatureFromNotes(fallbackHarmonicNotes);
            if (!harmonicSig || fallbackHarmonicNotes.length < 2) {
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

            if (!hasSuspensionOnsetHere && ((prevSig === harmonicSig && prevCtx === ctxKey) || shouldSuppressAsCompletion)) {
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
            lastSigBySystem.set(systemIndex, harmonicSig);
            lastCtxBySystem.set(systemIndex, ctxKey);
            lastBassPcBySystem.set(systemIndex, bassPc);

            // L2: figures depend only on the actual vertical intervals above the real bass.
            // Never derive/overwrite them from roman/symbol/quality.
            let figures: string[] = computeFiguredBassFromNotes(analysisNotes as any, FIGURED_BASS_UI_OPTIONS).figures;

            let roman = '';
            let symbol = '';
            let isAug6Roman = false;

            const prevRoman = lastRomanBySystem.get(systemIndex) || '';
            const prevRootPc = lastChordRootPcBySystem.get(systemIndex);
            const prevType = lastChordTypeBySystem.get(systemIndex);

            try {
                const r = getRomanAnalysis(analysisNotesForNaming as any, contextTonic, contextIsMinor);
                if (r) {
                    roman = r.roman;
                    isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
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
                const s = getChordSymbol(analysisNotesForNaming as any, contextKeySignature, contextTonic);
                if (s) symbol = s;

                // If the chord symbol explicitly indicates a slash (e.g. D7/F#),
                // prefer roman derived from the *symbol root*.
                // Under suspensions/ties, identifyChordCandidates can mis-root and collapse
                // into misleading labels like I4/7.
                try {
                    // IMPORTANT: do not clobber diminished leading-tone analyses (e.g. vii°7)
                    // with a dominant-from-symbol-root label like V7.
                    const romanIsDiminished = (() => {
                        const r = String(roman || '');
                        return r.includes('°') || r.includes('ø');
                    })();

                    if (!isAug6Roman && symbol && (symbol.indexOf('/') >= 0) && !romanIsDiminished) {
                        const symRaw = String(symbol || '').replace('♯', '#').replace('♭', 'b');
                        const rootMatch = symRaw.match(/^([A-G])([#b]?)/);
                        const rootName = rootMatch ? `${rootMatch[1]}${rootMatch[2] || ''}` : '';
                        const rootPc = rootName ? noteNameToChromaticIndex(rootName) : -1;

                        const inferredType = (() => {
                            const s = symRaw;
                            if (/maj7/i.test(s)) return 'Major 7';
                            if (/m7/i.test(s)) return 'Minor 7';
                            if (s.includes('°') || /dim7/i.test(s)) return 'Diminished 7';
                            if (s.includes('7')) return 'Dominant 7';
                            if (/\bm\b/i.test(s) || /m(?!aj)/i.test(s)) return 'Minor';
                            return 'Major';
                        })();

                        if (rootPc != null && rootPc >= 0) {
                            const virtualRootMidi = 60 + (((rootPc % 12) + 12) % 12);
                            const virtualRoot = ({ id: 'virtual-root', pitch: 'C', octave: 4, position: 0, midi: virtualRootMidi, noteIndex: rootPc } as any);

                            // IMPORTANT: include real pitch-class intervals so secondary dominants (V/x)
                            // can be detected even when we're forcing the root from a slash symbol.
                            const intervals = (() => {
                                try {
                                    const pcs = new Set<number>();
                                    for (const n of (analysisNotesForNaming as any[]) || []) {
                                        if (!n || n.isRest) continue;
                                        const ni = (n as any).noteIndex;
                                        const midi = (n as any).midi;
                                        const pc = Number.isFinite(ni) ? ni : (Number.isFinite(midi) ? (midi % 12) : null);
                                        if (pc == null) continue;
                                        pcs.add(((pc % 12) + 12) % 12);
                                    }
                                    const out = new Set<number>();
                                    for (const pc of pcs) out.add((((pc - rootPc) % 12) + 12) % 12);
                                    return out;
                                } catch {
                                    return undefined;
                                }
                            })();

                            const forced = calculateRomanFromChordInfo({ root: virtualRoot, type: inferredType, intervals }, contextTonic, contextIsMinor);
                            if (forced) {
                                roman = forced;
                            }
                        }
                    }
                } catch (_) {}
            } catch (err) {
                // Removed debug log
                return;
            }

            // If the current verticality is *exactly* a diatonic triad with the bass as its root,
            // prefer the diatonic degree inferred from the bass. This is a robust guard against
            // occasional mis-rooting under ties/suspensions and ensures stable labels like I5
            // for plain tonic triads (e.g. Bb–D–F over Bb in Bb major).
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                if (!isAug6Roman && !isSecondaryOrSlashRoman && bassPc != null) {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        const pcs = pcSetFromNotes(analysisNotes as any);
                        if (pcs.size === 3 && bassPc === inferred.triad.root) {
                            const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
                            const ok = Array.from(pcs).every(p => triadSet.has(p));
                            if (ok) {
                                roman = inferred.roman;
                            }
                        }
                    }
                }
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

                    if (resolvedRoman) {
                        // Don't overwrite secondary dominants (V/x) at suspension onset.
                        // In your cadence case, adding the resolution chord should not make V7/V disappear.
                        if (!String(roman || '').includes('/')) {
                            roman = resolvedRoman;
                        }
                    } else {
                        // Fallback: underlying harmony at suspension onset (already
                        // excluding the suspended note at this beat via `labelNotes`).
                        const rHere = getRomanAnalysis(analysisNotes as any, contextTonic, contextIsMinor);
                        if (rHere) roman = rHere.roman || roman;
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
                            const preferred = (bassPc == null)
                                ? candidates[0]
                                : (candidates.find(c => (c?.root?.noteIndex ?? null) === bassPc) || candidates[0]);
                            const forced = preferred
                                ? calculateRomanFromChordInfo({ root: preferred.root, type: preferred.type }, tonicHere, isMinorHere)
                                : null;
                            if (forced) roman = forced;
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
                        roman = '';
                        figures = [];
                        symbol = '';
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
            } catch { /* ignore */ }

            if (!roman && !symbol) return;

            // Anchor label to the current timeline event's beat (not just the note's attack)
            const x = getXForAbsBeat(event.absBeat, system);

            labelsBySystem[systemIndex].push({
                id: `hlabel-${systemIndex}-${event.absBeat}`,
                x,
                roman,
                figures,
                symbol,
                absBeat: event.absBeat,
            });
        });

        // Sort labels in each system by x
        labelsBySystem.forEach(systemLabels => systemLabels.sort((a, b) => a.x - b.x));
        return labelsBySystem;
    }, [analysisContextAbsBeat, analysisContexts, currentTonic, isAnalysisEnabled, isMinorMode, layoutData, timeSignature]);

    // Modulation / tonicization markers per system (from analysisContexts)
    const contextMarkersBySystem = useMemo(() => {
        if (!layoutData || analysisContexts.length === 0) return [] as { x: number; label: string }[][];

        const formatLabel = (ctx: AnalysisContext) => {
            const quality = ctx.newIsMinor ? 'min' : 'Maj';
            return `[ ${ctx.newTonic} ${quality} ]`;
        };

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const markersBySystem: { x: number; label: string }[][] = layoutData.systemsParams.map(() => []);

        for (const ctx of analysisContexts) {
            const absBeat = analysisContextAbsBeat(ctx);
            if (!Number.isFinite(absBeat) || absBeat < 0) continue;

            const measureIndex = Math.floor(absBeat / beatsPerMeasure);
            const beatInMeasure = (absBeat - (measureIndex * beatsPerMeasure)) + 1;

            for (let systemIndex = 0; systemIndex < layoutData.systemsParams.length; systemIndex++) {
                const sys = layoutData.systemsParams[systemIndex];
                const idx = sys.measureIndices.indexOf(measureIndex);
                if (idx < 0) continue;

                const startX = sys.startMeasuresX[idx];
                const endX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                const measureWidth = Math.max(1, endX - startX);
                const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
                const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / beatsPerMeasure));
                const x = startX + MEASURE_PADDING_X + (rel * contentWidth);

                markersBySystem[systemIndex].push({ x: x + 10, label: formatLabel(ctx) });
                break;
            }
        }

        markersBySystem.forEach(ms => ms.sort((a, b) => a.x - b.x));
        return markersBySystem;
    }, [analysisContextAbsBeat, analysisContexts, layoutData, timeSignature]);

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

    const sendMidiNote = useCallback((note: StaffNote, output: any, durationSec: number) => {
        if (!output || note.isRest) return;
        const midi = (note.midi ?? 0) + playbackTransposeSemitones;
        if (!Number.isFinite(midi) || midi <= 0) return;
        const vel = 100;
        output.send([0x90, midi, vel]);
        output.send([0x80, midi, 0], window.performance.now() + durationSec * 1000);
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
            sendMidiNote(note, selectedMidiOutput, durationSec);
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

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        if (!Number.isFinite(beatsPerMeasure) || beatsPerMeasure <= 0) return null;

        const measureIndex = Math.floor(absBeat / beatsPerMeasure);
        const beatInMeasure = (absBeat - (measureIndex * beatsPerMeasure)) + 1;

        for (let systemIndex = 0; systemIndex < layoutData.systemsParams.length; systemIndex++) {
            const sys = layoutData.systemsParams[systemIndex];
            const idx = sys.measureIndices.indexOf(measureIndex);
            if (idx === -1) continue;

            const startX = sys.startMeasuresX[idx];
            const endX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / beatsPerMeasure));
            const x = startX + MEASURE_PADDING_X + (rel * contentWidth);
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

        eventsToPlay.forEach((ev) => {
            const delayMs = (ev.absBeat - startAbsBeat) * beatDurationSec * 1000;
            const when = audioStartTime + (delayMs / 1000);
            const t = window.setTimeout(async () => {
                const playable = ev.items
                    .map(x => x.note)
                    .filter(n => !n.isRest && (n.midi ?? 0) > 0);

                setPlayingNoteIds(playable.map(n => n.id));

                if (selectedMidiOutput) {
                    ev.items.forEach((it) => {
                        const n = it.note;
                        if (n.isRest) return;
                        const durSec = Math.max(0.05, it.durationBeats * beatDurationSec);
                        sendMidiNote(n, selectedMidiOutput, durSec);
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

                const x1 = (first.xPosition ?? 0) - 6;
                const x2 = (last.xPosition ?? 0) + 26;
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

                const x1 = (first.xPosition ?? 0) - 6;
                const x2 = (last.xPosition ?? 0) + 26;
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
                const idx = violations.findIndex(v => v.noteIds.includes(noteId));
                setSelectedViolationIndex(idx !== -1 ? idx : null);
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
        const targetAbsBeat = (targetMeasureIndex * beatsPerMeasure) + (targetBeat - 1);

        const srcAbsBeats = dataToPaste
            .map(n => {
                const m = n.measureIndex ?? 0;
                const b = n.beat ?? 1;
                return (m * beatsPerMeasure) + (b - 1);
            })
            .filter(Number.isFinite);
        const baseAbsBeat = srcAbsBeats.length ? Math.min(...srcAbsBeats) : 0;
        const delta = targetAbsBeat - baseAbsBeat;

        const chordIdMap = new Map<string, string>();
        const groupIdMap = new Map<string, string>();
        const beamGroupIdMap = new Map<string, string>();
        const remapId = (map: Map<string, string>, id?: string) => {
            if (!id) return undefined;
            if (!map.has(id)) map.set(id, crypto.randomUUID());
            return map.get(id)!;
        };

        const pasted: StaffNote[] = dataToPaste
            .map(n => {
                const m = n.measureIndex ?? 0;
                const b = n.beat ?? 1;
                const abs = (m * beatsPerMeasure) + (b - 1) + delta;
                if (!Number.isFinite(abs) || abs < 0) return null;

                const newMeasureIndex = Math.floor(abs / beatsPerMeasure);
                const inMeasure = abs - (newMeasureIndex * beatsPerMeasure);
                const newBeat = Math.round((inMeasure + 1) * 1e6) / 1e6;

                const { xPosition, ...rest } = n as any;

                try {
                    const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                    const absBeat = (newMeasureIndex * beatsPerMeasureLocal) + (newBeat - 1);
                    const startTick = Math.round(absBeat * TICKS_PER_QUARTER);
                    const base = (DURATION_VALUES as any)[(n as any).duration || 'quarter'] || 1;
                    let durBeats = base;
                    if ((n as any).isDotted) durBeats *= 1.5;
                    if ((n as any).isTriplet) durBeats *= 2 / 3;
                    if ((n as any).isDuplet) durBeats *= 3 / 2;
                    const durationTicks = Math.round(durBeats * TICKS_PER_QUARTER);

                    return {
                        ...(rest as StaffNote),
                        id: crypto.randomUUID(),
                        measureIndex: newMeasureIndex,
                        beat: newBeat,
                        startTick,
                        durationTicks,
                        chordId: remapId(chordIdMap, (n as any).chordId),
                        groupId: remapId(groupIdMap, (n as any).groupId),
                        manualBeamGroupId: remapId(beamGroupIdMap, (n as any).manualBeamGroupId),
                    };
                } catch (e) {
                    return {
                        ...(rest as StaffNote),
                        id: crypto.randomUUID(),
                        measureIndex: newMeasureIndex,
                        beat: newBeat,
                        chordId: remapId(chordIdMap, (n as any).chordId),
                        groupId: remapId(groupIdMap, (n as any).groupId),
                        manualBeamGroupId: remapId(beamGroupIdMap, (n as any).manualBeamGroupId),
                    };
                }
            })
            .filter(Boolean) as StaffNote[];

        if (pasted.length > 0) {
            setRawNotes(prev => [...prev, ...pasted]);
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
    }, [setRawNotes, setSelectedNoteIds, timeSignature]);

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
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const absBeat = (measureIndex * beatsPerMeasure) + (beat - 1);
        playbackCursorAbsBeatRef.current = absBeat;
        setPlayheadPosition({ x, systemIndex });
    }, [timeSignature]);

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

    // (No external-paste handler)

    const toggleDoubleBarlineAtPlayhead = useCallback(() => {
        // Requires a playhead/cursor position so the user has explicit intent.
        if (!playheadPosition) return;

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const absBeat = Math.max(0, getCurrentAbsBeatForPlayhead());
        const measureIndex = Math.max(0, Math.floor(absBeat / beatsPerMeasure));

        setDoubleBarlineMeasures(prev => {
            const set = new Set(prev);
            if (set.has(measureIndex)) set.delete(measureIndex);
            else set.add(measureIndex);
            return Array.from(set).sort((a, b) => a - b);
        });
    }, [getCurrentAbsBeatForPlayhead, playheadPosition, timeSignature]);

    const handleStaffRightClick = useCallback((x: number, y: number, systemIndex: number, e: MouseEvent) => {
        if (!layoutData) return;
        e.preventDefault();
        e.stopPropagation();

        // Right-click *on the playhead* opens the modulation/tonicization menu at the playhead time.
        if (playheadPosition && playheadPosition.systemIndex === systemIndex && Math.abs(x - playheadPosition.x) <= PLAYHEAD_CONTEXT_HIT_PX) {
            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
            const absBeat = Math.max(0, Math.round(getCurrentAbsBeatForPlayhead() * 1e6) / 1e6);
            const measureIndex = Math.floor(absBeat / beatsPerMeasure);
            const beat = Math.round((((absBeat - (measureIndex * beatsPerMeasure)) + 1)) * 1e6) / 1e6;

            setContextMenu({ x: e.clientX, y: e.clientY, absBeat, measureIndex, beat });
            return;
        }

        const hit = getSystemMeasureAtX(systemIndex, x);
        if (!hit) return;

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const ticksPerMeasure = Math.round(beatsPerMeasure * TICKS_PER_QUARTER);

        const contentWidth = Math.max(1, hit.measureWidth - (MEASURE_PADDING_X * 2));
        const relX = x - (hit.measureStartX + MEASURE_PADDING_X);

        // Limita il click all'interno della misura visibile
        const clampedRelX = Math.max(0, Math.min(contentWidth, relX));

        // Tick-based snapping (same philosophy as left-click insertion).
        const measureStartTick = hit.measureIndex * ticksPerMeasure;

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
        const baseSnapGridTicks = Math.max(1, Math.min(durationTicks, TICKS_PER_QUARTER));
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
    }, [getCurrentAbsBeatForPlayhead, getSystemMeasureAtX, layoutData, playheadPosition, selectedInsertion, setPlaybackCursorFromMeasureBeat, timeSignature, tupletFactor]);

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
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const ticksPerMeasure = Math.round(beatsPerMeasure * TICKS_PER_QUARTER);

        const measureStartTick = hit.measureIndex * ticksPerMeasure;
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
        const baseSnapGridTicks = Math.max(1, Math.min(durationTicks, TICKS_PER_QUARTER));
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
                // Replace anything overlapping this rest in tick-space.
                const filtered = prev.filter(n => {
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
            const filtered = prev.filter(n => {
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
        if (activeAccidental) setActiveAccidental(null);
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
            const baseSnapGridTicks = Math.max(1, Math.min(durationTicks, TICKS_PER_QUARTER));
            return useFineStep ? Math.max(1, Math.floor(baseSnapGridTicks / 2)) : baseSnapGridTicks;
        } catch {
            return TICKS_PER_QUARTER;
        }
    }, [selectedInsertion.duration, selectedInsertion.isDotted, tupletFactor]);

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
            if (isMod && key === 'v') {
                e.preventDefault();
                e.stopPropagation();

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
                if (duration) setSelectedInsertion(prev => ({ ...prev, duration }));
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
                setSelectedInsertion(prev => ({ ...prev, isDotted: !prev.isDotted }));
                return;
            }

            // Accidentals
            // b = bemolle, à/# = diesis, n = bequadro
            if (!isMod && (key === 'b' || key === 'n' || key === 'à' || key === '#')) {
                e.preventDefault();
                e.stopPropagation();

                if (key === 'b') {
                    setActiveAccidental(p => (p === 'flat' ? 'double-flat' : (p === 'double-flat' ? null : 'flat')));
                } else if (key === 'n') {
                    setActiveAccidental(p => (p === 'natural' ? null : 'natural'));
                } else {
                    setActiveAccidental(p => (p === 'sharp' ? 'double-sharp' : (p === 'double-sharp' ? null : 'sharp')));
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

        const notesWithBeats = calculateNoteBeats(rawNotes, timeSignature);
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
                        className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${selectedVoice === v ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
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
                    <button key={duration} onClick={() => { setSelectedInsertion(prev => ({ ...prev, duration })); }} className={`p-1 rounded-md transition-colors ${selectedInsertion.duration === duration ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title={label}>
                        <IconComponent type={selectedInsertion.type} duration={duration} className={TOOLBAR_ICON_CLASS} />
                    </button>
                ))}
                <div className="w-px h-5 bg-gray-600 mx-1"></div>
                                <button
                                    onClick={() =>
                                        setSelectedInsertion(prev => ({
                                            ...prev,
                                            isDotted: !prev.isDotted
                                        }))
                                    }
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
            </div>
        ),
        accidentals: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button onClick={() => setActiveAccidental(p => p === 'sharp' ? 'double-sharp' : (p === 'double-sharp' ? null : 'sharp'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'sharp' || activeAccidental === 'double-sharp' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Diesis (♯)"><SharpIcon className={TOOLBAR_ICON_CLASS} /></button>
                <button onClick={() => setActiveAccidental(p => p === 'double-sharp' ? 'sharp' : (p === 'sharp' ? null : 'double-sharp'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'double-sharp' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Doppio Diesis (𝄪)"><DoubleSharpIcon className={TOOLBAR_ICON_CLASS} /></button>
                <button onClick={() => setActiveAccidental(p => p === 'flat' ? 'double-flat' : (p === 'double-flat' ? null : 'flat'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'flat' || activeAccidental === 'double-flat' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Bemolle (♭)"><FlatIcon className={TOOLBAR_ICON_CLASS} /></button>
                <button onClick={() => setActiveAccidental(p => p === 'double-flat' ? 'flat' : (p === 'flat' ? null : 'double-flat'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'double-flat' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Doppio Bemolle (♭♭)"><DoubleFlatIcon className={TOOLBAR_ICON_CLASS} /></button>
                <button onClick={() => setActiveAccidental(p => p === 'natural' ? null : 'natural')} className={`p-1 rounded-md transition-colors ${activeAccidental === 'natural' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Bequadro (N)"><NaturalIcon className={TOOLBAR_ICON_CLASS} /></button>
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
                        {staffSystemMode !== 'grandstaff' && (
                            <button
                                onClick={() => setStaffSystemMode('grandstaff')}
                                className="w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors text-gray-200 hover:bg-slate-700"
                                title="Torna al Grand Staff (2 righi) — Alt/Option+L"
                            >
                                <span>Grand Staff (2 righi)</span>
                            </button>
                        )}

                        {/* Toggles */}
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
                    </div>
                )}
            </div>
        ),
    };

    const visibleGroupIds = toolbarGroupOrder;

    const [draggingToolbarGroupId, setDraggingToolbarGroupId] = useState<ToolbarGroupId | null>(null);

    return (
        <div className="flex-grow flex flex-col gap-4 min-h-0">
            <div className="sticky top-0 z-50 p-2 bg-slate-800 border-b border-slate-700 rounded-lg">
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

                        const systemHarmonyLabels = (harmonyLabelsBySystem?.[systemIndex] || []);

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
                                    const curAbs = (cur.measureIndex ?? 0) * beatsPerMeasure + ((cur.beat ?? 1) - 1);
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
                                                            <VexflowGrandStaff
                                key={`vf-${systemIndex}-${vexflowNonce}`}
                                                                notes={systemNotesForRender}
                                timeSignature={timeSignature}
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
                              />
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
                                                        {(isAnalysisEnabled || violationLevelByNoteId.size > 0 || analysisContexts.length > 0) && (
                              <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={systemHeightPx}>
                                                                {/* Modulation / tonicization markers */}
                                                                {(contextMarkersBySystem?.[systemIndex] || []).map((m, i) => (
                                                                    <text
                                                                        key={`ctx-${systemIndex}-${i}`}
                                                                        x={m.x}
                                                                        y={staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y - 12) : (TOP_STAFF_TOP - 12)}
                                                                        textAnchor="start"
                                                                        fontSize={11}
                                                                        fontWeight={600}
                                                                        fill="black"
                                                                        opacity={0.85}
                                                                    >
                                                                        {m.label}
                                                                    </text>
                                                                ))}

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
                                                                    const showRoman = showRomanAnalysis && !!lbl.roman && !isHiddenMarker && !(hideLabelAbsBeats.has((lbl as any).absBeat));
                                                                    const showSymbol = showSymbolAnalysis && !!(lbl as any).symbol && !isHiddenMarker && !(hideLabelAbsBeats.has((lbl as any).absBeat));

                                                                    // Keep a consistent left edge reference for both roman and symbols.
                                                                    const romanFont = '700 14px serif';
                                                                    const refW = measureTextWidth('V', romanFont);
                                                                    const baseX = lbl.x + RB_SHIFT_X - refW;

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
                                                                                                const base = String(lbl.roman || '');
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

                                                                                        const romanText = (lbl.roman || '') + (needsDim7Suffix ? '7' : '');
                                                                                        const romanW = measureTextWidth(romanText, romanFont);
                                                                                        const romanX = baseX;
                                                                                        const figuresX = romanX + romanW + 6;

                                                                                        // Harmony hold-line: extend from end of this label to the next label.
                                                                                        const nextVisible = (() => {
                                                                                            for (let j = lblIndex + 1; j < systemHarmonyLabels.length; j++) {
                                                                                                const candidate: any = systemHarmonyLabels[j];
                                                                                                const abs = (candidate as any)?.absBeat;
                                                                                                const candidateShow = showRomanAnalysis && !!candidate?.roman && !(candidate as any)?.hiddenMarker && !(hideLabelAbsBeats.has(abs));
                                                                                                if (candidateShow) return candidate;
                                                                                            }
                                                                                            return null;
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
                                                                                                    const nextRomanText = (nextVisible as any).roman || '';
                                                                                                    const nextRomanW = measureTextWidth(String(nextRomanText), romanFont);
                                                                                                    const nextBaseX = (nextVisible as any).x + RB_SHIFT_X - refW;
                                                                                                    // stop a bit before the next roman starts
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
                                                                                                >
                                                                                                    {lbl.roman}
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
                                                                                                        const lineEnd = resX + 10 + RESOLUTION_X_SHIFT_PX;
                                                                                                        // original: figuresY0 - 6; lower by 16px as requested
                                                                                                        const lineY = figuresY0 + 10;
                                                                                                        // Place number below the figures (original behaviour)
                                                                                                        const numberY = figuresY0 + 14;

                                                                                                        // (intentionally no debug log here; this render path is hot)
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
                                                                                                            x={resX + 16 + RESOLUTION_X_SHIFT_PX}
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
                                                                                            x={resX + 16 + RESOLUTION_X_SHIFT_PX}
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

                {/* Restore analysis panel */}
                {activeTab === 'analysis' && (
                    <div className="w-full max-w-sm flex-shrink-0 h-full min-h-0">
                        {isAnalysisEnabled ? (
                            <HarmonyAnalysisPanel
                                violations={violations}
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
    onApply: (absBeat: number, newTonic: string, newIsMinor: boolean) => void;
    onRemove: (absBeat: number) => void;
    initialKey: string;
    initialIsMinor: boolean;
}> = ({ menuData, onClose, onApply, onRemove, initialKey, initialIsMinor }) => {
    const [tempKey, setTempKey] = useState(initialKey);
    const [tempIsMinor, setTempIsMinor] = useState(initialIsMinor);
    const menuRef = useRef<HTMLDivElement>(null);

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
        onApply(menuData.absBeat, tonicToApply, tempIsMinor);
    };

    return (
        <div
            ref={menuRef}
            style={{ top: menuData.y, left: menuData.x }}
            className="fixed z-50 bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-600 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
        >
            <h3 className="text-white font-bold text-sm">Modulazione / tonicizzazione (Misura {menuData.measureIndex + 1}, beat {Number.isInteger(menuData.beat) ? menuData.beat : menuData.beat.toFixed(3)})</h3>
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
            <div className="flex gap-2 mt-2">
                <button onClick={handleApplyClick} className="flex-1 px-3 py-1 text-sm rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors">Applica</button>
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
