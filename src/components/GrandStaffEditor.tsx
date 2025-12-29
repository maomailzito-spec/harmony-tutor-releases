// ...existing code...
// TypeScript: dichiarazione per window.electronAPI
declare global {
    interface Window {
        electronAPI?: {
            onMenuAction: (handler: (action: string, payload: any) => void) => (() => void) | void;
            saveFile: (content: string) => Promise<any>;
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
import { applyHarmonyRules, getKeySignature, calculateNoteBeats, getRomanAnalysis, getNotePropertiesFromDiatonicPosition, getNotePropertiesFromMidi, getChordSymbol, calculateAccidental, getActiveNotesTimeline } from '../utils/musicTheory';
import HarmonyAnalysisPanel from './HarmonyAnalysisPanel';
import { NOTE_NAMES, DURATION_VALUES, ALL_NOTE_SPELLINGS } from '../constants';
import { GroupIcon } from './icons/GroupIcon';
import { UngroupIcon } from './icons/UngroupIcon';
import { FlipStemIcon } from './icons/FlipStemIcon';
import VexflowGrandStaff from './VexflowGrandStaff';

interface GrandStaffEditorProps {
    isActive: boolean;
    audioService: AudioService;
    isAudioReady: boolean;
}

type InsertionElement = { type: 'note' | 'rest', duration: NoteDuration };

// Must match value in VexflowGrandStaff.tsx
const STAFF_MARGIN = 50;
type Tool = 'insert';
type ViewMode = 'page' | 'linear';
type ActiveTab = 'editor' | 'analysis';

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
    | 'midi';

const TOOLBAR_PREFS_KEY = 'harmony-tutor.toolbarPrefs.v1';
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
    'midi',
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
    midi: true,
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
    midi: 'MIDI',
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
        
        case 'eighth': {
            const head = "M-7,-3 C-11,-3 -12,0 -10,3 C-8,6 -4,7 -2,5 C0,3 0,0 -3,-2 Z";
            const stem = "M-2,-4 L10,22 L8,22 L-4,-4 Z";
             return (
                <g transform={baseTransform}>
                    <path d={`${stem} ${head}`} fill={color} />
                </g>
            );
        }
        
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
    console.error(`[RenderErrorBoundary:${this.props.label}]`, err);
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
    const [rawNotes, setRawNotes, undoNotes] = useUndoableState<StaffNote[]>([]);
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
    const [keyChangeMode, setKeyChangeMode] = useState<'none' | 'transpose' | 'modal'>('none');
    const [modalTonicOverride, setModalTonicOverride] = useState<string>('');
    const [isMinorMode, setIsMinorMode] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('page');
    const [measuresPerLine, setMeasuresPerLine] = useState<number>(4);
    const [minMeasureCount, setMinMeasureCount] = useState<number>(4);
    const [minMeasureCountDraft, setMinMeasureCountDraft] = useState<string>('4');
    const [doubleBarlineMeasures, setDoubleBarlineMeasures] = useState<number[]>([]);
    const [tool, setTool] = useState<Tool>('insert');
    const [selectedInsertion, setSelectedInsertion] = useState<InsertionElement>({ type: 'note', duration: 'quarter' });
    const [isDotted, setIsDotted] = useState(false);
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
    const [metronomeFlash, setMetronomeFlash] = useState<'strong' | 'weak' | null>(null);
    const [isLooping, setIsLooping] = useState(false);
    const [loopRange, setLoopRange] = useState<{ startBeat: number, endBeat: number } | null>(null);
    const [ghostNote, setGhostNote] = useState<(StaffNote & { systemIndex: number }) | null>(null);
    const [analysisContexts, setAnalysisContexts] = useState<AnalysisContext[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; absBeat: number; measureIndex: number; beat: number } | null>(null);
    const [isAnalysisEnabled, setIsAnalysisEnabled] = useState(true);
    const [showRomanAnalysis, setShowRomanAnalysis] = useState(true);
    const [showSymbolAnalysis, setShowSymbolAnalysis] = useState(false);
    const [showMeasureNumbers, setShowMeasureNumbers] = useState(true);
    const [toolbarGroupOrder, setToolbarGroupOrder] = useState<ToolbarGroupId[]>(DEFAULT_TOOLBAR_ORDER);
    const [toolbarGroupVisibility, setToolbarGroupVisibility] = useState<Record<ToolbarGroupId, boolean>>(DEFAULT_TOOLBAR_VISIBILITY);
    const [isToolbarCustomizeOpen, setIsToolbarCustomizeOpen] = useState(false);
    const [selectedToolbarGroupId, setSelectedToolbarGroupId] = useState<ToolbarGroupId | null>(null);
    const [midiOutputs, setMidiOutputs] = useState<any[]>([]);
    const [selectedMidiOutput, setSelectedMidiOutput] = useState<any | null>(null);
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
        // Load toolbar prefs from localStorage (per-browser, per-user).
        try {
            const raw = localStorage.getItem(TOOLBAR_PREFS_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const order: ToolbarGroupId[] = Array.isArray(parsed?.order) ? parsed.order : [];
            const visible: Partial<Record<ToolbarGroupId, boolean>> = (parsed?.visible && typeof parsed.visible === 'object') ? parsed.visible : {};

            const all = new Set<ToolbarGroupId>(DEFAULT_TOOLBAR_ORDER);
            const cleanedOrder = order.filter((id: any): id is ToolbarGroupId => all.has(id));
            const fullOrder: ToolbarGroupId[] = Array.from(new Set([...cleanedOrder, ...DEFAULT_TOOLBAR_ORDER]));

            const nextVisible: Record<ToolbarGroupId, boolean> = { ...DEFAULT_TOOLBAR_VISIBILITY };
            (Object.keys(DEFAULT_TOOLBAR_VISIBILITY) as ToolbarGroupId[]).forEach((k) => {
                const v = (visible as any)[k];
                if (typeof v === 'boolean') nextVisible[k] = v;
            });

            setToolbarGroupOrder(fullOrder);
            setToolbarGroupVisibility(nextVisible);
        } catch {
            // ignore malformed prefs
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(TOOLBAR_PREFS_KEY, JSON.stringify({ order: toolbarGroupOrder, visible: toolbarGroupVisibility }));
        } catch {
            // ignore quota/errors
        }
    }, [toolbarGroupOrder, toolbarGroupVisibility]);

    const moveToolbarGroup = useCallback((id: ToolbarGroupId, dir: -1 | 1) => {
        setToolbarGroupOrder(prev => {
            const idx = prev.indexOf(id);
            if (idx < 0) return prev;
            const nextIdx = idx + dir;
            if (nextIdx < 0 || nextIdx >= prev.length) return prev;
            const next = [...prev];
            const tmp = next[nextIdx];
            next[nextIdx] = next[idx];
            next[idx] = tmp;
            return next;
        });
    }, []);

    const toggleToolbarGroupVisibility = useCallback((id: ToolbarGroupId) => {
        setToolbarGroupVisibility(prev => ({ ...prev, [id]: !prev[id] }));
    }, []);

    const resetToolbarPrefs = useCallback(() => {
        setToolbarGroupOrder(DEFAULT_TOOLBAR_ORDER);
        setToolbarGroupVisibility(DEFAULT_TOOLBAR_VISIBILITY);
        setSelectedToolbarGroupId('playback');
    }, []);

    const applyMinMeasureCountDraft = useCallback(() => {
        const v = Math.trunc(Number(minMeasureCountDraft));
        if (!Number.isFinite(v)) return;
        setMinMeasureCount(Math.max(1, v));
    }, [minMeasureCountDraft]);

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
        const beatDurationSec = 60 / safeBpm;
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

        // If we are already past the anchor, jump to the next beat boundary.
        const beatsSinceAnchor = Math.max(0, Math.ceil((nowSec - anchorWhenSec) / beatDurationSec));
        metronomeBeatRef.current = anchorAbsBeat + beatsSinceAnchor;
        metronomeNextWhenRef.current = anchorWhenSec + beatsSinceAnchor * beatDurationSec;

        const isDownbeat = (absBeat: number) => {
            if (!Number.isFinite(absBeat) || !Number.isFinite(beatsPerMeasure)) return false;
            const k = absBeat / beatsPerMeasure;
            return Math.abs(k - Math.round(k)) < 1e-6;
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

            metronomeBeatRef.current = absBeat + 1;
            metronomeNextWhenRef.current = when + beatDurationSec;

            const nextDelayMs = Math.max(0, (metronomeNextWhenRef.current - ctx.currentTime - 0.03) * 1000);
            metronomeIntervalRef.current = window.setTimeout(scheduleNext, nextDelayMs);
        };

        // Start scheduling a bit ahead so the first click lands exactly on anchor.
        const firstDelayMs = Math.max(0, (metronomeNextWhenRef.current - nowSec - 0.03) * 1000);
        metronomeIntervalRef.current = window.setTimeout(scheduleNext, firstDelayMs);
    }, [audioService, bpm, isAudioReady, stopMetronomeInternal, timeSignature?.denominator, timeSignature?.numerator]);

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
            console.error("Accesso MIDI fallito:", error);
          }
        } else {
          console.warn("Web MIDI API non supportata da questo browser.");
        }
      };

    const [bpmInputString, setBpmInputString] = useState('');
    
    const [selectionRect, setSelectionRect] = useState<{ startX: number; startY: number; endX: number; endY: number; isVisible: boolean; systemIndex: number | null;}>({ startX: 0, startY: 0, endX: 0, endY: 0, isVisible: false, systemIndex: null });
    const dragStartPosRef = useRef<{
        clientX: number;
        clientY: number;
        svgStartX: number;
        svgStartY: number;
        clientPerSvgX: number;
        clientPerSvgY: number;
        systemIndex: number;
        isAdditive: boolean;
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

    const signedKeyDelta = useCallback((fromRoot: string, toRoot: string): number => {
        const fromIdx = noteNameToChromaticIndex(fromRoot);
        const toIdx = noteNameToChromaticIndex(toRoot);
        if (fromIdx < 0 || toIdx < 0) return 0;
        const up = ((toIdx - fromIdx) % 12 + 12) % 12;
        const down = up - 12;
        return Math.abs(down) < Math.abs(up) ? down : up;
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
        const delta = signedKeyDelta(fromRoot, toRoot);
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
        if (keyChangeMode === 'transpose') {
            transposeAllNotesToKey(keySignatureRoot, nextRoot);
        } else if (keyChangeMode === 'modal') {
            reinterpretAllNotesModallyInKey(nextRoot);
        }
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


    // Mantieni latestRawNotes aggiornato
    useEffect(() => {
        latestRawNotes.current = rawNotes;
    }, [rawNotes]);
    // (No external paste bridge globals here)


    // Funzione robusta per gestire tutte le azioni del menu di Electron
    const handleMenuAction = useCallback(async (action, payload) => {
        const api = (window).electronAPI;
        if (!api) return;
        // console.log('[HANDLE_MENU_ACTION] action:', action, 'payload:', payload); // decommentare solo per debug
        if (action === 'edit-command' && payload && payload.command) {
            const command = payload.command;
            // console.log(`[HANDLE_MENU_ACTION] Comando ricevuto: ${command}`); // decommentare solo per debug
            if (command === 'copy') {
                const currentSelected = latestSelectedNoteIds.current;
                const selected = (latestRawNotes.current || []).filter(n => currentSelected && currentSelected.has(n.id));
                if (!currentSelected || currentSelected.size === 0) {
                    setCopyPasteError('Nessuna nota selezionata da copiare.');
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
                        console.log('[PASTE MARKER] set from copied notes:', marker);
                        setPasteMarker(marker);
                    }
                } catch (e) {
                    console.warn('[PASTE MARKER] failed to set from copied notes', e);
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
                    if (marker) {
                        console.log('[PASTE MARKER] set:', marker);
                        setPasteMarker(marker);
                    }
                } catch (e) {
                    // non critico
                }
                return;
            }
            if (command === 'cut') {
                // console.log('[HANDLE_MENU_ACTION] selectedNoteIds:', selectedNoteIds); // decommentare solo per debug
                if (selectedNoteIds.size === 0) {
                    // console.log('[HANDLE_MENU_ACTION] Nessuna nota selezionata per taglia');
                    return;
                }
                const selected = rawNotes.filter(n => selectedNoteIds.has(n.id));
                // console.log('[HANDLE_MENU_ACTION] Note selezionate per taglia:', selected);
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
                console.log('[DEBUG][MENU PASTE] Chiamato. clipboardRef:', latestClipboardRef.current, 'pasteCaret:', pasteCaret);
                // Se è presente un pasteMarker recente, usalo e consumalo (30s timeout)
                try {
                    if (pasteMarker && (Date.now() - pasteMarker.ts) < 30000) {
                        const pm = pasteMarker;
                        console.log('[PASTE MARKER] consumed for paste:', pm);
                        setPasteMarker(null);
                        const caretFromMarker = { x: 0, systemIndex: pm.systemIndex, measureIndex: pm.measureIndex, beat: pm.beat };
                        // Keep internal pasteCaret in sync so other logic sees it
                        setPasteCaret(caretFromMarker);
                        if (latestClipboardRef.current && latestClipboardRef.current.length > 0) {
                            pasteClipboardAt(caretFromMarker.measureIndex, caretFromMarker.beat);
                        } else {
                            console.log('[PASTE MARKER] No clipboard data available to paste');
                        }
                        return;
                    }
                } catch (err) {
                    console.warn('[PASTE MARKER] error consuming marker', err);
                }
                // Se clipboard locale è vuota, prova a leggere dagli appunti di sistema
                if ((!latestClipboardRef.current || latestClipboardRef.current.length === 0) && navigator.clipboard && window.isSecureContext) {
                    console.log('[DEBUG][MENU PASTE] Clipboard locale vuota, provo a leggere dagli appunti di sistema...');
                    navigator.clipboard.readText().then(text => {
                        try {
                            const parsed = JSON.parse(text);
                            if (Array.isArray(parsed) && parsed[0] && parsed[0].id) {
                                console.log('[DEBUG][MENU PASTE] Dati validi trovati negli appunti di sistema:', parsed);
                                setClipboard(parsed);
                                setCopyPasteError(null);
                            } else {
                                console.log('[DEBUG][MENU PASTE] Nessun dato valido negli appunti di sistema:', text);
                                setCopyPasteError('Nessun dato valido negli appunti.');
                            }
                        } catch {
                            console.log('[DEBUG][MENU PASTE] Dati negli appunti non validi:', text);
                            setCopyPasteError('Dati negli appunti non validi');
                        }
                    }).catch(() => {
                        console.log('[DEBUG][MENU PASTE] Errore nella lettura dagli appunti di sistema');
                        setCopyPasteError('Impossibile leggere dagli appunti di sistema.');
                    });
                    return;
                }
                // Se esiste una posizione playhead, incolla lì; altrimenti caret, altrimenti in testa
                let caret = null;
                if (playheadPosition && layoutData && layoutData.systemsParams) {
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
                            beat: 1
                        };
                    }
                }
                if (!caret && pasteCaret) {
                    caret = pasteCaret;
                }
                if (!caret) {
                    caret = { x: 0, systemIndex: 0, measureIndex: 0, beat: 1 };
                    setPasteCaret(caret);
                }
                console.log('[DEBUG][MENU PASTE] caret finale:', caret, 'clipboardRef:', latestClipboardRef.current);
                if (caret && latestClipboardRef.current && latestClipboardRef.current.length > 0) {
                    console.log('[DEBUG][MENU PASTE] Chiamo pasteClipboardAt con', caret.measureIndex, caret.beat);
                    pasteClipboardAt(caret.measureIndex, caret.beat);
                }
                return;
            }
            if (command === 'selectAll') {
                // Usa latestRawNotes.current per garantire che siano le note aggiornate
                const allNotes = latestRawNotes.current || [];
                const allNoteIds = allNotes.filter(n => n && n.id !== undefined).map(n => n.id);
                console.log('[HANDLE_MENU_ACTION] Seleziona tutte le note:', allNoteIds);
                setSelectedNoteIds(new Set(allNoteIds));
                return;
            }
        }
        if (action === 'close-project') {
            console.log("Comando chiudi progetto ricevuto.");
            const confirmed = window.confirm("Vuoi chiudere il progetto corrente? Le modifiche non salvate andranno perse.");
            if (confirmed) {
                // Reset rawNotes to initial state
                setRawNotes([]);
                setKeySignatureRoot('C');
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
                setIsDotted(false);
                setIsTriplet(false);
                setIsDuplet(false);
                setIsSwing(false);
                setTupletNoteCount(0);
                setTripletBaseDuration(null);
                setActiveAccidental(null);
                setSelectedVoice(1);
                setHoveredViolationNotes(null);
                setSelectedViolationIndex(null);
                setViewMode('page');
                setPasteCaret(null);
                setAnalysisContexts([]);
                setContextMenu(null);
                setShowRomanAnalysis(true);
                setShowSymbolAnalysis(false);
                setShowMeasureNumbers(true);
                setToolbarGroupOrder(DEFAULT_TOOLBAR_ORDER);
                setToolbarGroupVisibility(DEFAULT_TOOLBAR_VISIBILITY);
                setIsToolbarCustomizeOpen(false);
                setSelectedToolbarGroupId(null);
                setMidiOutputs([]);
                setSelectedMidiOutput(null);
            }
        } else if (action === 'save' || action === 'save-as') {
            console.log("Comando di salvataggio ricevuto:", action);
            if (latestRawNotes.current.length === 0 && !window.confirm("Il progetto è vuoto. Salvare comunque?")) return;
            const projectData = JSON.stringify({ notes: latestRawNotes.current }, null, 2);
            try {
                const result = await api.saveFile(projectData);
                if (result && result.success && result.filePath) {
                    api.addRecentFile(result.filePath);
                }
            } catch (err) {
                console.error("Errore durante il salvataggio:", err);
            }
        } else if (action === 'open') {
            console.log("Comando di apertura ricevuto.");
            setRawNotes([]);
            try {
                const data = payload?.data;
                if (!data) throw new Error("Nessun dato fornito per l'apertura.");
                const loadedProject = JSON.parse(data);
                if (loadedProject && Array.isArray(loadedProject.notes)) {
                    setRawNotes(loadedProject.notes);
                    if (payload && payload.filePath) {
                        api.addRecentFile(payload.filePath);
                    }
                } else {
                    throw new Error("Formato dati non valido.");
                }
            } catch (err) {
                console.error("Errore durante l'apertura del file:", err);
            }
        } else if (action === 'new') {
            console.log("Comando nuovo progetto ricevuto.");
            const confirmed = window.confirm("Vuoi davvero creare un nuovo progetto? I dati non salvati andranno persi.");
            if (confirmed) {
                setRawNotes([]);
            }
        }
    }, [setRawNotes, setKeySignatureRoot, setTimeSignature, setClipboard, setSelectedNoteIds, setActiveTab, setDoubleBarlineMeasures, setMinMeasureCount, setMeasuresPerLine, setIsMinorMode, setKeyChangeMode, setModalTonicOverride, setIsDotted, setIsTriplet, setIsDuplet, setIsSwing, setTupletNoteCount, setTripletBaseDuration, setActiveAccidental, setSelectedVoice, setHoveredViolationNotes, setSelectedViolationIndex, setViewMode, pasteMarker, setPasteCaret, setAnalysisContexts, setContextMenu, setShowRomanAnalysis, setShowSymbolAnalysis, setShowMeasureNumbers, setToolbarGroupOrder, setToolbarGroupVisibility, setIsToolbarCustomizeOpen, setSelectedToolbarGroupId, setMidiOutputs, setSelectedMidiOutput]);

    // Listener Electron: registrazione unica e cleanup
    useEffect(() => {
        const api = (window).electronAPI;
        // console.log('[RENDERER] window.electronAPI:', api); // decommentare solo per debug
        if (!api) {
            console.warn("Electron API non disponibile.");
            return;
        }
        // console.log("[RENDERER] Listener Unico Registrato."); // decommentare solo per debug
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
        const notesToLayout = analyzedNotes;
        const keySigWidth = keySignature.count * 14;
        const timeSigWidthWithPadding = timeSignature ? 55 : 0;
        const startOffset = START_X + keySigWidth + timeSigWidthWithPadding;
        // Keep the same right margin as the VexFlow renderer (see VexflowGrandStaff: STAFF_MARGIN = 50).
        // Using a smaller margin here makes the last barline drift away from the staff.
        const systemRightX = containerWidth - START_X;
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const notesByMeasure = new Map<number, StaffNote[]>();
        let maxMeasureIndex = -1;
        notesToLayout.forEach(note => {
            const m = note.measureIndex ?? 0;
            if (m > maxMeasureIndex) maxMeasureIndex = m;
            if (!notesByMeasure.has(m)) notesByMeasure.set(m, []);
            notesByMeasure.get(m)!.push(note);
        });

        // Where the "piece" ends (for the final double barline):
        // - at least the minimum measure count
        // - but never before the last measure that contains notes
        const finalMeasureIndex = Math.max(0, Math.max((minMeasureCount - 1), maxMeasureIndex));
        // Total measures rendered:
        // - enough to include the user-defined piece length
        // - never fewer than the last measure containing notes
        // Avoid adding extra trailing measures automatically (prevents the "cesura" from drifting).
        let targetTotalMeasures = Math.max(minMeasureCount, maxMeasureIndex + 1);
        const measureMinInfo: { minWidth: number, notes: StaffNote[] }[] = [];
        for (let m = 0; m < targetTotalMeasures; m++) {
            const measureNotes = notesByMeasure.get(m) || [];
            let minDurationValue = measureNotes.length > 0 ? measureNotes.reduce((min, n) => Math.min(min, DURATION_VALUES[n.duration || 'quarter']), 1) : 1;
            let pxPerBeat = 60;
            if (minDurationValue <= 0.0625) pxPerBeat = 280; else if (minDurationValue <= 0.125) pxPerBeat = 180; else if (minDurationValue <= 0.25) pxPerBeat = 120; else if (minDurationValue <= 0.5) pxPerBeat = 100;
            measureMinInfo[m] = { minWidth: (beatsPerMeasure * pxPerBeat) + (MEASURE_PADDING_X * 2), notes: measureNotes };
        }
        const systems: { measureIndices: number[], width: number, startMeasuresX: number[] }[] = [];
        let currentSystemMeasures: number[] = [], currentSystemMinContentWidth = 0;
        // IMPORTANT: distribute measures within the actual staff drawable width.
        // If we use the full container width here, the last measure can overshoot the staff end,
        // making the end-of-line barline ("cesura") disappear or drift.
        const usablePageWidth = systemRightX - startOffset - STAFF_PADDING_X;
        const finalizeSystem = (indices: number[], contentWidthSum: number) => {
            if (indices.length === 0) return;
            const extraSpace = Math.max(0, usablePageWidth - contentWidthSum);
            const extraPerMeasure = extraSpace / indices.length;
            const systemStartMeasuresX: number[] = [];
            let currentX = startOffset;
            indices.forEach(m => { systemStartMeasuresX.push(currentX); currentX += measureMinInfo[m].minWidth + extraPerMeasure; });
            systems.push({ measureIndices: indices, width: containerWidth, startMeasuresX: systemStartMeasuresX });
        };
        for (let m = 0; m < targetTotalMeasures; m++) {
            const measureW = measureMinInfo[m].minWidth;
            if ((currentSystemMeasures.length >= measuresPerLine || currentSystemMinContentWidth + measureW > usablePageWidth) && currentSystemMeasures.length > 0) {
                finalizeSystem(currentSystemMeasures, currentSystemMinContentWidth);
                currentSystemMeasures = [m]; currentSystemMinContentWidth = measureW;
            } else { currentSystemMeasures.push(m); currentSystemMinContentWidth += measureW; }
        }
        if (currentSystemMeasures.length > 0) finalizeSystem(currentSystemMeasures, currentSystemMinContentWidth);
        const finalNotes: StaffNote[] = []; const allSystemsBarlines: Barline[][] = []; const measureFinalWidths = new Map<number, number>();
        const doubleSet = new Set(doubleBarlineMeasures);
        systems.forEach(sys => {
            const systemBarlines: Barline[] = [];
            sys.measureIndices.forEach((m, idx) => {
                const startX = sys.startMeasuresX[idx];
                const nextX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : systemRightX;
                const measureWidth = nextX - startX;
                measureFinalWidths.set(m, measureWidth);
                const measureNotes = notesToLayout.filter(n => n.measureIndex === m);
                const contentWidth = measureWidth - (MEASURE_PADDING_X * 2);
                measureNotes.forEach(n => {
                    const startTime = (n.beat || 1) - 1;
                    const relativeX = (startTime / beatsPerMeasure) * contentWidth;
                    finalNotes.push({ ...n, xPosition: startX + MEASURE_PADDING_X + relativeX });
                });
                // Se è l'ultima misura del sistema, la barline va allineata a width - STAFF_MARGIN
                const isLastInSystem = idx === sys.measureIndices.length - 1;
                const svgStaffEnd = containerWidth - STAFF_MARGIN;
                                const barStyle = m === finalMeasureIndex ? 'final' : (doubleSet.has(m) ? 'double' : 'single');
                                let barX = startX + measureWidth;
                                if (isLastInSystem) {
                                    // Sposta solo la barline finale dell'ultimo sistema
                                    barX = (m === finalMeasureIndex && barStyle === 'final') ? (svgStaffEnd + 3) : svgStaffEnd;
                                }
                                systemBarlines.push({
                                        id: `bar-${m}`,
                                        xPosition: barX,
                                        style: barStyle,
                                });
            });
            allSystemsBarlines.push(systemBarlines);
        });
        return { positionedNotes: finalNotes, systemsBarlines: allSystemsBarlines, systemsParams: systems, measureFinalWidths };
    }, [analyzedNotes, containerWidth, timeSignature, keySignature, measuresPerLine, viewMode, minMeasureCount, doubleBarlineMeasures]);

    // =========================================================
    // ADAPTER LAYER (domain -> overlay data)
    // =========================================================

    // Timeline-based harmony labels per system (roman+figures and symbol)
    const harmonyLabelsBySystem = useMemo(() => {
        if (!isAnalysisEnabled || !layoutData) return [];

        // Use the timeline of all active notes at each event (start/end of any note)
        const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature);
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const ctxAtAbsBeat = (absBeat: number) => (analysisContexts || [])
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

        // For each system, collect all timeline events that fall within its measures
        const labelsBySystem: { id: string; x: number; roman: string; figures: string[]; symbol: string }[][] = layoutData.systemsParams.map(() => []);


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

        timeline.forEach(event => {
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

            // Only show labels for events with at least 2 notes
            if (!event.notes || event.notes.length < 2) return;

            const applicableContext = ctxAtAbsBeat(event.absBeat);
            const contextTonic = applicableContext ? applicableContext.newTonic : currentTonic;
            const contextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinorMode;

            let roman = '';
            let figures: string[] = [];
            let symbol = '';

            try {
                const r = getRomanAnalysis(event.notes, contextTonic, contextIsMinor);
                if (r) {
                    roman = r.roman;
                    figures = r.figures || [];
                }
                const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
                const s = getChordSymbol(event.notes, contextKeySignature);
                if (s) symbol = s;
            } catch (err) {
                console.warn('Harmony label compute failed', err);
                return;
            }

            if (!roman && !symbol) return;

            // Anchor label to the current timeline event's beat (not just the note's attack)
            const x = getXForAbsBeat(event.absBeat, system);

            labelsBySystem[systemIndex].push({
                id: `hlabel-${systemIndex}-${event.absBeat}`,
                x,
                roman,
                figures,
                symbol,
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
            console.warn('Violation mapping failed', err);
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
        const midi = note.midi;
        if (!Number.isFinite(midi) || midi <= 0) return;
        const vel = 100;
        output.send([0x90, midi, vel]);
        output.send([0x80, midi, 0], window.performance.now() + durationSec * 1000);
    }, []);

    const playNoteSound = useCallback(async (note: StaffNote, durationSec = 0.8) => {
        if (!isAudioReady || !audioService.audioContext || note.isRest) return;
        await audioService.ensureAudioIsReady();
        const midi = note.midi;
        if (!Number.isFinite(midi) || midi < 21 || midi > 108) return;
        await audioService.playNote(midiToName(midi), { when: audioService.audioContext.currentTime, duration: durationSec });
    }, [audioService, isAudioReady, midiToName]);

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
                        if (!Number.isFinite(midi) || midi < 21 || midi > 108) return;
                        void audioService.playNote(midiToName(midi), { when, duration: durSec });
                    });
                }
            }, Math.max(0, (startMs - performance.now()) + delayMs));

            playbackTimeoutsRef.current.push(t);
        });

        const endMs = (maxEndAbsBeat - startAbsBeat) * beatDurationSec * 1000;
        playbackTimeoutsRef.current.push(window.setTimeout(() => stopPlayback(), Math.max(0, (startMs - performance.now()) + endMs + 200)));
    }, [audioService, bpm, getPlayheadPosForAbsBeat, isAudioReady, isSwing, midiToName, rawNotes, selectedMidiOutput, sendMidiNote, startMetronomeScheduler, stopPlayback, timeSignature]);

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

    const handleNoteClick = useCallback((noteId: string, e: React.MouseEvent | MouseEvent) => {
        if (justDraggedRef.current) {
            justDraggedRef.current = false;
            return;
        }
        e.stopPropagation();

        // Also set a paste caret at the clicked note's time (standard UX: click target, then Cmd+V).
        const n = rawNotes.find(nn => nn.id === noteId);
        if (n && Number.isFinite(n.measureIndex) && Number.isFinite(n.beat) && layoutData) {
            // Trova il systemIndex corretto per la misura
            let systemIndex = 0;
            for (let i = 0; i < layoutData.systemsParams.length; i++) {
                if (layoutData.systemsParams[i].measureIndices.includes(n.measureIndex)) {
                    systemIndex = i;
                    break;
                }
            }
            // Quantizza il beat alla griglia attuale
            const gridStep = DURATION_VALUES[selectedInsertion.duration] * tupletFactor;
            const step = Math.max(1e-6, gridStep);
            const quantizedBeat = Math.round((1 + Math.round((n.beat - 1) / step) * step) * 1e6) / 1e6;
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
    }, [getPlayheadPosForAbsBeat, playNote, rawNotes, selectedNoteIds, timeSignature, violations]);

    const pasteClipboardAt = useCallback((targetMeasureIndex: number, targetBeat: number) => {
        const dataToPaste = latestClipboardRef.current;
        if (!dataToPaste || dataToPaste.length === 0) return;

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

                return {
                    ...(rest as StaffNote),
                    id: crypto.randomUUID(),
                    measureIndex: newMeasureIndex,
                    beat: newBeat,
                    chordId: remapId(chordIdMap, (n as any).chordId),
                    groupId: remapId(groupIdMap, (n as any).groupId),
                    manualBeamGroupId: remapId(beamGroupIdMap, (n as any).manualBeamGroupId),
                };
            })
            .filter(Boolean) as StaffNote[];

        if (pasted.length > 0) {
            setRawNotes(prev => [...prev, ...pasted]);
            setSelectedNoteIds(new Set(pasted.map(n => n.id)));
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
            if (x >= startX && x < endX) return { measureIndex: mIdx, measureStartX: startX, measureWidth: w };
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
        return { measureIndex: mIdx, measureStartX: startX, measureWidth: w };
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
        const contentWidth = Math.max(1, hit.measureWidth - (MEASURE_PADDING_X * 2));
        const relX = x - (hit.measureStartX + MEASURE_PADDING_X);
        const beatRaw = (Math.max(0, Math.min(1, relX / contentWidth)) * beatsPerMeasure) + 1;

        // Quantize to the current grid (same as left-click insertion).
        const gridStep = DURATION_VALUES[selectedInsertion.duration] * tupletFactor;
        const step = Math.max(1e-6, gridStep);
        const beat = Math.round((1 + Math.round((beatRaw - 1) / step) * step) * 1e6) / 1e6;

        setPlaybackCursorFromMeasureBeat(systemIndex, x, hit.measureIndex, beat);
        // Aggiorna sempre pasteCaret con beat quantizzato
        setPasteCaret({ x, systemIndex, measureIndex: hit.measureIndex, beat });
    }, [getCurrentAbsBeatForPlayhead, getSystemMeasureAtX, layoutData, playheadPosition, selectedInsertion.duration, setPlaybackCursorFromMeasureBeat, timeSignature, tupletFactor]);

    const handleBackgroundClick = useCallback((x: number, y: number, systemIndex: number, e?: MouseEvent) => {
        if (!layoutData) return;

        // Prevent the container click handler from immediately clearing selection after a staff click.
        e?.stopPropagation?.();

        // Click on empty staff clears current selection.
        // Do not clear on Cmd/Ctrl (used for paste-caret placement).
        if (!(e?.metaKey || e?.ctrlKey)) {
            setSelectedNoteIds(new Set());
        }

        const hit = getSystemMeasureAtX(systemIndex, x);
        if (!hit) return;

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const contentWidth = Math.max(1, hit.measureWidth - (MEASURE_PADDING_X * 2));
        const relX = x - (hit.measureStartX + MEASURE_PADDING_X);
        const beatRaw = (Math.max(0, Math.min(1, relX / contentWidth)) * beatsPerMeasure) + 1;

        const gridStep = DURATION_VALUES[selectedInsertion.duration] * tupletFactor;
        const step = Math.max(1e-6, gridStep);
        const quantizedBeat = Math.round((1 + Math.round((beatRaw - 1) / step) * step) * 1e6) / 1e6;

        // Set playback cursor + visible playhead at the clicked point.
        setPlaybackCursorFromMeasureBeat(systemIndex, x, hit.measureIndex, quantizedBeat);

        // Aggiorna sempre pasteCaret con beat quantizzato
        setPasteCaret({ x, systemIndex, measureIndex: hit.measureIndex, beat: quantizedBeat });

        // Per compatibilità con i costruttori StaffNote che usano la shorthand "beat"
        const beat = quantizedBeat;

        const targetClef: ClefType = (selectedVoice === 3 || selectedVoice === 4) ? 'bass' : 'treble';
        // IMPORTANT: apply the same treble Y calibration used for pitch mapping,
        // otherwise the treble/bass gating will cut off low notes for S/A.
        const yForArea = targetClef === 'treble' ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX) : y;
        const isBassArea = yForArea > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2);
        if ((targetClef === 'bass' && !isBassArea) || (targetClef === 'treble' && isBassArea)) return;

        if (selectedInsertion.type === 'rest') {
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
                isDotted,
                measureIndex: hit.measureIndex,
                beat,
                clef: targetClef,
                voice: selectedVoice,
            };
            setRawNotes(prev => [...prev, rest]);
            return;
        }

        const relativeY = targetClef === 'treble'
            ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX)
            : (y - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT);

        let pos = 0;
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

        let props = getNotePropertiesFromDiatonicPosition(pos, targetClef, keySignature);
        props = applyActiveAccidental(props);

        const newNote: StaffNote = {
            id: crypto.randomUUID(),
            ...props,
            duration: selectedInsertion.duration,
            isRest: false,
            isTriplet,
            isDuplet,
            isDotted,
            measureIndex: hit.measureIndex,
            beat,
            clef: targetClef,
            voice: selectedVoice,
        };

        setRawNotes(prev => {
            // Rimuovi eventuale nota/pausa sovrapposta
            const filtered = prev.filter(
                n =>
                    n.measureIndex !== newNote.measureIndex ||
                    n.voice !== newNote.voice ||
                    Math.abs((n.beat ?? 1) - (newNote.beat ?? 1)) > 1e-6
            );
            // Inserisci la nuova nota e ordina per measureIndex, beat, voice
            const next = [...filtered, newNote].sort((a, b) => {
                if (a.measureIndex !== b.measureIndex) return a.measureIndex - b.measureIndex;
                if ((a.beat ?? 1) !== (b.beat ?? 1)) return (a.beat ?? 1) - (b.beat ?? 1);
                return (a.voice ?? 1) - (b.voice ?? 1);
            });
            return next;
        });
        void playNote(newNote);
        if (activeAccidental) setActiveAccidental(null);
    }, [
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
        timeSignature,
        tupletFactor,
        applyActiveAccidental,
        playNote,
        activeAccidental,
        clipboard,
    ]);

    const handleBackgroundMouseDown = useCallback((e: MouseEvent, svg: SVGSVGElement, systemIndex: number) => {
        if (tool !== 'insert') return;

        // Robust conversion: client -> SVG coordinates.
        let x = 0;
        let y = 0;
        let clientPerSvgX = 1;
        let clientPerSvgY = 1;

        try {
            const ctm = svg.getScreenCTM?.();
            if (ctm) {
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const sp = pt.matrixTransform(ctm.inverse());
                x = sp.x;
                y = sp.y;
                // ctm maps SVG -> client; its a/d are scale factors in most common cases.
                clientPerSvgX = Math.abs(ctm.a) || 1;
                clientPerSvgY = Math.abs(ctm.d) || 1;
            } else {
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
            }
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
        }));
    }, [activeTab, tool]);

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

        const targetClef: ClefType = (selectedVoice === 3 || selectedVoice === 4) ? 'bass' : 'treble';
        // IMPORTANT: apply the same treble Y calibration used for pitch mapping,
        // otherwise the treble/bass gating will cut off low notes for S/A.
        const yForArea = targetClef === 'treble' ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX) : y;
        const isBassArea = yForArea > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2);
        if ((targetClef === 'bass' && !isBassArea) || (targetClef === 'treble' && isBassArea)) {
            setGhostNote(null);
            return;
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

        const relativeY = targetClef === 'treble'
            ? (y + VF_TREBLE_MOUSE_Y_ADJUST_PX)
            : (y - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT);

        let pos = 0;
        if (targetClef === 'treble') {
            const staffTop = VF_TREBLE_Y;
            pos = ((staffTop + 5 * VF_LINE_SPACING) - relativeY) / (VF_LINE_SPACING / 2);
        } else {
            const staffTop = BOTTOM_STAFF_TOP;
            pos = ((staffTop + 2 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2);
        }

        if (targetClef === 'bass' && (selectedVoice === 3 || selectedVoice === 4)) pos -= 4;
        pos = Math.round(pos);

        let props = getNotePropertiesFromDiatonicPosition(pos, targetClef, keySignature);

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
    }, [getNotePropertiesFromDiatonicPosition, getSystemMeasureAtX, isDotted, isDuplet, isTriplet, keySignature, layoutData, selectedInsertion, selectedVoice, timeSignature, tupletFactor]);

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
                const candidates = layoutData.positionedNotes.filter(n => measureSet.has(n.measureIndex ?? -1));
                const idsInRect: string[] = [];
                candidates.forEach(n => {
                    const clef = (n.clef || 'treble') as ClefType;
                    const staffTop = clef === 'bass' ? BOTTOM_STAFF_TOP : TOP_STAFF_TOP;
                    const yInStaff = getNoteY(n.position, staffTop, clef);
                    const yAbs = clef === 'bass' ? TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + yInStaff : yInStaff;
                    const xAbs = n.xPosition ?? 0;

                    const TOLERANCE = 2;
                    if (
                        xAbs >= xMin - TOLERANCE && xAbs <= xMax + TOLERANCE &&
                        yAbs >= yMin - TOLERANCE && yAbs <= yMax + TOLERANCE
                    ) {
                        idsInRect.push(n.id);
                    }
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
    }, [isActive, layoutData, getNoteY]);

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

        layoutData.positionedNotes.forEach(n => {
            const clef = (n.clef || 'treble') as ClefType;
            const staffTop = clef === 'bass' ? BOTTOM_STAFF_TOP : TOP_STAFF_TOP;

            const yInStaff = getNoteY(n.position, staffTop, clef);
            const y = clef === 'bass' ? TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + yInStaff : yInStaff;

            map.set(n.id, { x: n.xPosition ?? 0, y });
        });

        return map;
    }, [layoutData, getNoteY]);

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

            // Space: always toggle playback (avoid requiring focus on the Play button)
            if (!isMod && (key === ' ' || key === 'spacebar')) {
                e.preventDefault();
                e.stopPropagation();
                togglePlayback();
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
    {/* Feedback errori copia/incolla */}
    {copyPasteError && (
        <div style={{position:'fixed',bottom:16,right:16,background:'#c00',color:'#fff',padding:'8px 16px',borderRadius:8,zIndex:9999}}>
            {copyPasteError}
            <button style={{marginLeft:8}} onClick={()=>setCopyPasteError(null)}>Chiudi</button>
        </div>
    )}

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

            // . (punto): toggle dotted rhythm
            // Some keyboard layouts may emit '>' with Shift+period; accept both.
            if (!isMod && (key === '.' || key === '>')) {
                e.preventDefault();
                e.stopPropagation();
                setIsDotted(d => !d);
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

            // ArrowUp / ArrowDown: transpose selected notes by semitone
            if (!isMod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                if (selectedNoteIds.size === 0) return;
                e.preventDefault();
                e.stopPropagation();

                const delta = e.key === 'ArrowUp' ? 1 : -1;

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

                return;
            }

            // Cmd/Ctrl+A: select all notes (only notes/rests, not the whole page)
            if (isMod && key === 'a') {
                e.preventDefault();
                e.stopPropagation();
                setSelectedNoteIds(new Set(rawNotes.map(n => n.id)));
                return;
            }

            // Cmd/Ctrl+Z: undo
            if (isMod && key === 'z') {
                e.preventDefault();
                e.stopPropagation();
                undoNotes();
                // Selection may now reference deleted notes; clear defensively.
                setSelectedNoteIds(new Set());
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
            </div>
        ),
        key: (
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-400">Tonalità:</span>
                <select
                    id="key-signature-select"
                    value={keySignatureRoot}
                    onChange={e => handleKeySignatureRootChange(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs"
                >
                    <optgroup label="Diesis (♯)">{sharpKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                    <optgroup label="Bemolli (♭)">{flatKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                </select>

                <label className="flex items-center gap-2 text-xs text-gray-300 select-none">
                    <input
                        type="checkbox"
                        checked={keyChangeMode === 'transpose'}
                        onChange={(e) => setKeyChangeMode(e.target.checked ? 'transpose' : 'none')}
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
                            className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs"
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
                <input
                    value={minMeasureCountDraft}
                    onChange={(e) => setMinMeasureCountDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            applyMinMeasureCountDraft();
                        }
                    }}
                    inputMode="numeric"
                    className="w-16 bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm text-white"
                    aria-label="Numero misure brano"
                />
                <button
                    onClick={applyMinMeasureCountDraft}
                    className="px-2 py-1 rounded-md bg-slate-700 text-gray-200 text-xs font-semibold hover:bg-slate-600 transition-colors"
                    title="Crea/Imposta numero di misure del brano (fissa la cesura finale)"
                >
                    Crea
                </button>
            </div>
        ),
        voices: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                {[1, 2, 3, 4].map(v => (
                    <button key={v} onClick={() => setSelectedVoice(v as Voice)} className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${selectedVoice === v ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>V{v}</button>
                ))}
            </div>
        ),
        insert: (
            <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                <button onClick={() => { setSelectedInsertion(prev => ({ ...prev, type: prev.type === 'note' ? 'rest' : 'note' })); }} className="p-1 rounded-md text-gray-300 hover:bg-gray-600 transition-colors" title={selectedInsertion.type === 'note' ? "Nota" : "Pausa"}>
                    {selectedInsertion.type === 'note' ? <QuarterNoteIcon className={TOOLBAR_ICON_CLASS} /> : <QuarterRestIcon className={TOOLBAR_ICON_CLASS} />}
                </button>
                <div className="w-px h-5 bg-gray-600 mx-1"></div>
                {durations.map(({ duration, label }) => (
                    <button key={duration} onClick={() => { setSelectedInsertion(prev => ({ ...prev, duration })); }} className={`p-1 rounded-md transition-colors ${selectedInsertion.duration === duration ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title={label}>
                        <IconComponent type={selectedInsertion.type} duration={duration} className={TOOLBAR_ICON_CLASS} />
                    </button>
                ))}
                <div className="w-px h-5 bg-gray-600 mx-1"></div>
                <button onClick={() => setIsDotted(d => !d)} className={`p-1 rounded-md transition-colors ${isDotted ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Punto di valore"><DotIcon className={TOOLBAR_ICON_CLASS} /></button>
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
                <button onClick={() => setActiveTab('editor')} className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${activeTab === 'editor' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Editor</button>
                <button onClick={() => setActiveTab('analysis')} className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${activeTab === 'analysis' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Analisi</button>
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
                            className={`w-24 rounded-sm py-0.5 font-bold transition-all ${showRomanAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showRomanAnalysis ? 'Nascondi Numeri Romani' : 'Mostra Numeri Romani'}
                        >
                            Numeri Romani
                        </button>
                        <button
                            onClick={() => setShowSymbolAnalysis(prev => !prev)}
                            className={`w-24 rounded-sm py-0.5 font-bold transition-all ${showSymbolAnalysis ? 'bg-stone-200 text-gray-900' : 'text-gray-300 hover:bg-gray-600'}`}
                            title={showSymbolAnalysis ? 'Nascondi Sigle' : 'Mostra Sigle'}
                        >
                            Sigle
                        </button>
                    </div>
                )}
                <button
                    onClick={() => setShowMeasureNumbers(prev => !prev)}
                    className={`ml-2 flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md transition-all ${showMeasureNumbers ? 'bg-slate-200 text-gray-900' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                    title={showMeasureNumbers ? 'Nascondi Numeri Misure' : 'Mostra Numeri Misure'}
                >
                    <span>Numeri misure</span>
                </button>
            </div>
        ),
        midi: (
            <div className="flex items-center gap-2">
                <button onClick={handleActivateMidi} className="p-2 rounded-md bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 transition-colors">
                    Attiva MIDI
                </button>
                <label htmlFor="midi-output" className="text-sm text-slate-400">MIDI Out:</label>
                <select
                    id="midi-output"
                    value={selectedMidiOutput?.id || ''}
                    onChange={e => {
                        const outputId = e.target.value;
                        const output = midiOutputs.find(o => o.id === outputId) || null;
                        setSelectedMidiOutput(output);
                    }}
                    className="bg-slate-700 text-white rounded p-1 text-sm"
                    disabled={midiOutputs.length === 0}
                >
                    <option value="">Audio Interno</option>
                    {midiOutputs.map(output => (
                        <option key={output.id} value={output.id}>
                            {output.name}
                        </option>
                    ))}
                </select>
            </div>
        ),
    };

    const visibleGroupIds = toolbarGroupOrder.filter(id => toolbarGroupVisibility[id]);

    const selectedGroupIndex = selectedToolbarGroupId ? toolbarGroupOrder.indexOf(selectedToolbarGroupId) : -1;
    const canMoveSelectedLeft = selectedGroupIndex > 0;
    const canMoveSelectedRight = selectedGroupIndex >= 0 && selectedGroupIndex < toolbarGroupOrder.length - 1;

    useEffect(() => {
        if (!isToolbarCustomizeOpen) return;
        // When opening: ensure we have a stable selection.
        setSelectedToolbarGroupId(prev => {
            if (prev && toolbarGroupOrder.includes(prev)) return prev;
            return toolbarGroupOrder[0] ?? 'playback';
        });
    }, [isToolbarCustomizeOpen, toolbarGroupOrder]);

    return (
        <div className="flex-grow flex flex-col gap-4">
            <div className="sticky top-12 z-50 p-2 bg-slate-800 border-b border-slate-700 rounded-lg">
                <div className="flex flex-row items-center flex-wrap gap-x-6 gap-y-2">
                    {visibleGroupIds.map((id, idx) => (
                        <React.Fragment key={id}>
                            {toolbarGroups[id]}
                            {idx < visibleGroupIds.length - 1 && <div className="h-6 w-px bg-slate-600"></div>}
                        </React.Fragment>
                    ))}

                    <div className="ml-auto flex items-center gap-2">
                        <button
                            onClick={() => setIsToolbarCustomizeOpen(o => !o)}
                            className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors ${isToolbarCustomizeOpen ? 'bg-slate-200 text-gray-900' : 'bg-slate-700 text-gray-200 hover:bg-slate-600'}`}
                            title={isToolbarCustomizeOpen ? 'Chiudi personalizzazione toolbar' : 'Personalizza toolbar'}
                        >
                            Personalizza
                        </button>
                    </div>
                </div>

                {isToolbarCustomizeOpen && (
                    <div className="mt-2 rounded-md bg-slate-700 p-2 text-xs text-gray-200">
                        <div className="flex items-center justify-between">
                            <div className="font-semibold text-slate-100">Toolbar</div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        if (!selectedToolbarGroupId) return;
                                        moveToolbarGroup(selectedToolbarGroupId, -1);
                                    }}
                                    disabled={!selectedToolbarGroupId || !canMoveSelectedLeft}
                                    className="px-2 py-1 rounded-md bg-slate-600 hover:bg-slate-500 transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Sposta a sinistra"
                                >
                                    ←
                                </button>
                                <button
                                    onClick={() => {
                                        if (!selectedToolbarGroupId) return;
                                        moveToolbarGroup(selectedToolbarGroupId, 1);
                                    }}
                                    disabled={!selectedToolbarGroupId || !canMoveSelectedRight}
                                    className="px-2 py-1 rounded-md bg-slate-600 hover:bg-slate-500 transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Sposta a destra"
                                >
                                    →
                                </button>
                                <button
                                    onClick={() => {
                                        if (!selectedToolbarGroupId) return;
                                        toggleToolbarGroupVisibility(selectedToolbarGroupId);
                                    }}
                                    disabled={!selectedToolbarGroupId}
                                    className="px-2 py-1 rounded-md bg-slate-600 hover:bg-slate-500 transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Mostra/Nascondi gruppo selezionato"
                                >
                                    {selectedToolbarGroupId && toolbarGroupVisibility[selectedToolbarGroupId] ? 'Nascondi' : 'Mostra'}
                                </button>
                                <button
                                    onClick={resetToolbarPrefs}
                                    className="px-2 py-1 rounded-md bg-slate-600 hover:bg-slate-500 transition-colors text-xs font-semibold"
                                    title="Ripristina toolbar predefinita"
                                >
                                    Ripristina
                                </button>
                            </div>
                        </div>

                        <div className="mt-2 grid gap-1">
                            {toolbarGroupOrder.map((id) => {
                                const isSelected = id === selectedToolbarGroupId;
                                const isVisible = !!toolbarGroupVisibility[id];
                                return (
                                    <button
                                        key={`tbopt-${id}`}
                                        onClick={() => setSelectedToolbarGroupId(id)}
                                        className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left transition-colors ${isSelected ? 'bg-cyan-600 text-white' : 'bg-slate-800/60 text-gray-200 hover:bg-slate-700/70'}`}
                                        title="Seleziona gruppo"
                                    >
                                        <span className="font-semibold">{TOOLBAR_GROUP_LABEL[id]}</span>
                                        <span className={`text-[11px] ${isSelected ? 'text-white/90' : (isVisible ? 'text-gray-300' : 'text-gray-400')}`}>{isVisible ? 'Mostrato' : 'Nascosto'}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
            
            <div className="flex flex-row gap-4 flex-grow min-h-0">
                <div
                    ref={staffContainerRef}
                    className={`flex-grow overflow-y-auto bg-stone-100 rounded-lg p-4 shadow-inner ${viewMode === 'linear' ? 'overflow-x-auto' : 'overflow-x-hidden'}`}
                    onClick={handleDeselectOnClickOutside}
                >
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

                            // If the user explicitly chose an accidental for this note, keep it.
                            if ((n as any).userAccidental) return n;

                            // Otherwise, recompute the accidental needed for the *existing pitch* under the
                            // current key signature, without changing the staff position/spelling.
                            const noteName = makeNoteNameFromPitchAndMidi(n.pitch, n.midi);
                            const nextExplicit = calculateAccidental(noteName, keyAccidentals);
                            return { ...n, explicitAccidental: nextExplicit };
                        });

                        const actualSystemWidth = system.width;
                        const ghost = ghostNote && ghostNote.systemIndex === systemIndex ? ghostNote : null;
                        const systemBarlines = layoutData.systemsBarlines?.[systemIndex] || [];
                        const systemDuplets = dupletGroupsBySystem[systemIndex] || [];
                        const systemTriplets = tripletGroupsBySystem[systemIndex] || [];

                        const systemHarmonyLabels = (harmonyLabelsBySystem?.[systemIndex] || []);
                        const showHarmony = isAnalysisEnabled && systemHarmonyLabels.length > 0;

                        return (
                          <div
                            key={`system-${systemIndex}`}
                            className={`relative ${viewMode === 'page' ? 'mb-8' : 'mb-0'}`}
                            style={{ width: actualSystemWidth, height: TOTAL_SYSTEM_HEIGHT }}
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
                                height={TOTAL_SYSTEM_HEIGHT}
                                selectedNoteIds={Array.from(selectedNoteIds)}
                                onNoteClick={(noteId, e) => handleNoteClick(noteId, e as any)}
                                                                onStaffClick={(x, y, e) => handleBackgroundClick(x, y, systemIndex, e)}
                                                                                                                                onStaffRightClick={(x, y, e) => handleStaffRightClick(x, y, systemIndex, e)}
                                                                onStaffMouseDown={ENABLE_MARQUEE_SELECTION ? ((e, svg) => handleBackgroundMouseDown(e, svg, systemIndex)) : undefined}
                                onMouseMoveStaff={(x, y) => handleMouseMove(x, y, systemIndex)}
                                ghostNote={ghost}
                              />
                            </RenderErrorBoundary> {/* FIX: this closing tag was missing */}

                                                        {/* Overlay: playhead */}
                                                        {playheadPosition && playheadPosition.systemIndex === systemIndex && (
                                                            <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT}>
                                                                <line
                                                                    x1={playheadPosition.x}
                                                                    y1={PLAYHEAD_Y_TOP}
                                                                    x2={playheadPosition.x}
                                                                    y2={PLAYHEAD_Y_BOTTOM}
                                                                    className="stroke-cyan-500"
                                                                    strokeWidth={2}
                                                                    opacity={0.7}
                                                                />
                                                            </svg>
                                                        )}

                                                        {/* Overlay: selection rect */}
                                                        {ENABLE_MARQUEE_SELECTION && rectForRender && selectionRect.systemIndex === systemIndex && (
                              <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT}>
                                <rect
                                  x={rectForRender.x}
                                  y={rectForRender.y}
                                  width={rectForRender.width}
                                  height={rectForRender.height}
                                  className="fill-cyan-400/10 stroke-cyan-500"
                                  strokeWidth={1.5}
                                />
                              </svg>
                            )}

                            {/* Overlay: duplets */}
                            {systemDuplets.length > 0 && (
                              <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT}>
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
                              <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT}>
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
                                <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT}>
                                    {(layoutData.systemsParams?.[systemIndex]?.measureIndices || []).map((mIdx, i) => {
                                        // Start numbering from measure 2 (skip the very first one).
                                        if (mIdx === 0) return null;

                                        const startX = layoutData.systemsParams[systemIndex].startMeasuresX?.[i];
                                        if (startX == null) return null;

                                        return (
                                            <text
                                                key={`mnum-${systemIndex}-${mIdx}`}
                                                x={startX}
                                                y={TOP_STAFF_TOP + 44}
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
                              <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT}>
                                                                {/* Modulation / tonicization markers */}
                                                                {(contextMarkersBySystem?.[systemIndex] || []).map((m, i) => (
                                                                    <text
                                                                        key={`ctx-${systemIndex}-${i}`}
                                                                        x={m.x}
                                                                        y={TOP_STAFF_TOP - 12}
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
                                {showHarmony && systemHarmonyLabels.map(lbl => {
                                                                    const bassBottomLineY = TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + (BOTTOM_STAFF_TOP + 4 * LINE_HEIGHT);
                                                                    // Trial positioning: move roman+figures to the right of bass stems and lower.
                                                                      const RB_SHIFT_X = 25;
                                                                      const RB_SHIFT_Y = 30;
                                                                    const romanBelowY = bassBottomLineY + 28 + RB_SHIFT_Y;
                                                                    const figuresY0 = bassBottomLineY + 20 + RB_SHIFT_Y;

                                                                                                                                        // Chord symbols (sigle) stay above the top staff; shift down only a few pixels.
                                                                                                                                        const SYMBOL_SHIFT_Y = 6;
                                                                                                                                        const symbolsY = TOP_STAFF_TOP - 18 + SYMBOL_SHIFT_Y;

                                                                    const showRoman = showRomanAnalysis && !!lbl.roman;
                                                                    const showSymbol = showSymbolAnalysis && !!(lbl as any).symbol;

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
                                                                                        const romanText = lbl.roman || '';
                                                                                        const romanW = measureTextWidth(romanText, romanFont);
                                                                                        const romanX = baseX;
                                                                                        const figuresX = romanX + romanW + 6;

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
                                                                    const systemConnections = (errorConnections || []).filter(c =>
                                                                        systemNoteIdSet.has(c.noteId1) && systemNoteIdSet.has(c.noteId2)
                                                                    );

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
                                                                        const p1 = notePositions.get(c.noteId1);
                                                                        const p2 = notePositions.get(c.noteId2);
                                                                        if (!p1 || !p2) return null;

                                                                        const clef1 = noteClefById.get(c.noteId1) || 'treble';
                                                                        const clef2 = noteClefById.get(c.noteId2) || 'treble';

                                                                        const applyOverlayShift = (p: { x: number; y: number }, clef: ClefType, voice: Voice) => {
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

                                                                        const q1 = applyOverlayShift(p1, clef1, v1);
                                                                        const q2 = applyOverlayShift(p2, clef2, v2);

                                                                        const isHovered = !!hoveredViolationNotes && (hoveredViolationNotes.includes(c.noteId1) || hoveredViolationNotes.includes(c.noteId2));
                                                                        const lvl = connectionLevel(c);

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
                                                                    });
                                                                })()}
                              </svg>
                            )}
                          </div>
                        );
                    })}
                </div>

                {/* Restore analysis panel */}
                {activeTab === 'analysis' && (
                    <div className="w-full max-w-sm flex-shrink-0">
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
                                }}
                            />
                        ) : (
                            <div className="bg-gray-800/50 rounded-lg p-3 h-full max-h-96 overflow-y-auto flex items-center justify-center text-center text-gray-400">
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
