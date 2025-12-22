import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { StaffNote, KeySignature, NoteDuration, TimeSignature, Barline, ClefType, Voice, HarmonyAnalysisResult, ErrorConnection, AccidentalType, AnalysisContext } from '../types';
import { AudioService } from '../services/AudioService';
import { 
    WholeNoteIcon, HalfNoteIcon, QuarterNoteIcon, EighthNoteIcon, SixteenthNoteIcon, ThirtySecondNoteIcon, SixtyFourthNoteIcon,
    WholeRestIcon, HalfRestIcon, QuarterRestIcon, EighthRestIcon, SixteenthRestIcon, ThirtySecondRestIcon, SixtyFourthRestIcon,
    TripletIcon, SharpIcon, FlatIcon, NaturalIcon, DoubleSharpIcon, DoubleFlatIcon, TieIcon, DotIcon
} from './icons/NoteValueIcons';
import { CycleIcon } from './icons/CycleIcon';
import { useUndoableState } from '../hooks/useUndoableState';
import { applyHarmonyRules, getKeySignature, calculateNoteBeats, getRomanAnalysis, getNotePropertiesFromDiatonicPosition, getNotePropertiesFromMidi, getChordSymbol } from '../utils/musicTheory';
import HarmonyAnalysisPanel from './HarmonyAnalysisPanel';
import { NOTE_NAMES, DURATION_VALUES } from '../constants';
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

const START_X = 50; 
const STAFF_PADDING_X = 10;
const MEASURE_PADDING_X = 20;

const PlayIcon = () => <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>;
const PauseIcon = () => <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
const MetronomeIcon = () => <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3L4 21h16L12 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6" /></svg>;
const UndoIcon = () => <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 15l-3-3m0 0l3-3m-3 3h8A5 5 0 009 9" /></svg>;


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

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isEditing) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const isTopHalf = e.clientY < rect.top + rect.height / 2;
        
        if (stepFunction) {
            onChange(stepFunction(value, isTopHalf ? 'up' : 'down'));
        } else {
            const newValue = Math.max(min, Math.min(max, value + (isTopHalf ? 1 : -1)));
            onChange(newValue);
        }
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
                className="w-full h-full text-center bg-gray-900 text-white font-serif text-3xl p-0 border-0 outline-none"
            />
        );
    }

    return (
        <div 
            onDoubleClick={() => { setEditValue(value.toString()); setIsEditing(true); }}
            onClick={handleClick}
            className="w-full h-1/2 flex items-center justify-center cursor-pointer group"
        >
             <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-0 text-xs">▲</span>
             <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-0 text-xs">▼</span>
            {value}
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
        <div className="flex flex-col items-center justify-center w-12 h-16 bg-gray-700 rounded-md text-white font-serif text-3xl relative">
            <TimeSignatureControlNumber value={value.numerator} onChange={handleNumeratorChange} min={1} max={16} />
            <TimeSignatureControlNumber value={value.denominator} onChange={handleDenominatorChange} min={2} max={16} stepFunction={denominatorStepFn}/>
        </div>
    );
};

const GrandStaffEditor: React.FC<GrandStaffEditorProps> = ({ isActive, audioService, isAudioReady }) => {
    const [rawNotes, setRawNotes, undoNotes] = useUndoableState<StaffNote[]>([]);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    const [clipboard, setClipboard] = useState<StaffNote[] | null>(null);
    const [timeSignature, setTimeSignature] = useState<TimeSignature>({ numerator: 4, denominator: 4 });
    const [keySignatureRoot, setKeySignatureRoot] = useState('C');
    const [isMinorMode, setIsMinorMode] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('page');
    const [measuresPerLine, setMeasuresPerLine] = useState<number>(4);
    const [minMeasureCount, setMinMeasureCount] = useState<number>(4);
    const [tool, setTool] = useState<Tool>('insert');
    const [selectedInsertion, setSelectedInsertion] = useState<InsertionElement>({ type: 'note', duration: 'quarter' });
    const [isDotted, setIsDotted] = useState(false);
    const [isTriplet, setIsTriplet] = useState(false);
    const [tupletNoteCount, setTupletNoteCount] = useState(0);
    const [tripletBaseDuration, setTripletBaseDuration] = useState<NoteDuration | null>(null);
    const [activeAccidental, setActiveAccidental] = useState<AccidentalType | null>(null);
    const [selectedVoice, setSelectedVoice] = useState<Voice>(1);
    const [activeTab, setActiveTab] = useState<ActiveTab>('editor');
    const [hoveredViolationNotes, setHoveredViolationNotes] = useState<string[] | null>(null);
    const staffContainerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(1000);
    const [isPlaying, setIsPlaying] = useState(false);
    const [bpm, setBpm] = useState(120);
    const [isBpmActive, setIsBpmActive] = useState(false);
    const bpmControlRef = useRef<HTMLDivElement>(null);
    const [playingNoteIds, setPlayingNoteIds] = useState<string[]>([]);
    const [playheadPosition, setPlayheadPosition] = useState<{ x: number, systemIndex: number } | null>(null);
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
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; measureIndex: number; } | null>(null);
    const [isAnalysisEnabled, setIsAnalysisEnabled] = useState(true);
    const [analysisMode, setAnalysisMode] = useState<'roman' | 'symbol'>('roman');
    const [midiOutputs, setMidiOutputs] = useState<any[]>([]);
    const [selectedMidiOutput, setSelectedMidiOutput] = useState<any | null>(null);
    const [pasteCaret, setPasteCaret] = useState<{ x: number; systemIndex: number; measureIndex: number; beat: number; } | null>(null);
    
    const isLoopingRef = useRef(isLooping);
    const loopRangeRef = useRef(loopRange);
    const metronomeIntervalRef = useRef<number | null>(null);
    const isMetronomeOnRef = useRef(isMetronomeOn);
    const isPlayingRef = useRef(isPlaying);

    useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
    useEffect(() => { loopRangeRef.current = loopRange; }, [loopRange]);
    useEffect(() => { isMetronomeOnRef.current = isMetronomeOn; }, [isMetronomeOn]);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);


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
    const dragStartPosRef = useRef<{ clientX: number, clientY: number, svgStartX: number, svgStartY: number, systemIndex: number } | null>(null);
    const isActuallyDraggingRef = useRef(false);
    const justDraggedRef = useRef(false);

    const keySignature = useMemo(() => getKeySignature(keySignatureRoot, 'Major'), [keySignatureRoot]);

    const { currentTonic, currentQuality } = useMemo(() => {
        if (isMinorMode) {
            const minorRoot = relativeMinors[keySignatureRoot] || 'A';
            return { currentTonic: minorRoot, currentQuality: 'Minore' };
        }
        return { currentTonic: keySignatureRoot, currentQuality: 'Maggiore' };
    }, [keySignatureRoot, isMinorMode]);

    const notes = useMemo(() => calculateNoteBeats(rawNotes, timeSignature), [rawNotes, timeSignature]);
    
    const analysisResult = useMemo(() => {
        if (!isAnalysisEnabled) {
            return { analyzedNotes: notes, connections: [], violations: [] };
        }
        return applyHarmonyRules(notes, keySignature, currentTonic, isMinorMode, analysisContexts);
    }, [notes, keySignature, currentTonic, isMinorMode, analysisContexts, isAnalysisEnabled]);
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
                return <text x={x} y={y} fill={color} fontSize="30" fontFamily="serif" textAnchor="middle" dominantBaseline="central">♯</text>;
            case 'flat':
                return <text x={x} y={y - 2} fill={color} fontSize="28" fontFamily="serif" textAnchor="middle" dominantBaseline="central">♭</text>;
            case 'natural':
                return <text x={x} y={y} fill={color} fontSize="28" fontFamily="serif" textAnchor="middle" dominantBaseline="central">♮</text>;
            case 'double-sharp':
                return <text x={x} y={y} fill={color} fontSize="24" fontFamily="serif" textAnchor="middle" dominantBaseline="central">𝄪</text>;
            case 'double-flat':
                return <text x={x} y={y - 2} fill={color} fontSize="28" fontFamily="serif" textAnchor="middle" dominantBaseline="central">♭♭</text>;
            default:
                return null;
        }
    };

    const KeySignatureDisplay: React.FC<{ signature: KeySignature, color: string, clef: ClefType, staffTop: number }> = ({ signature, color, clef, staffTop }) => {
        if (signature.count === 0) return null;
        const positionsMap = clef === 'bass' ? KEY_SIGNATURE_POSITIONS_BASS : KEY_SIGNATURE_POSITIONS_TREBLE;
        const accidentals = positionsMap[signature.type].slice(0, signature.count);
        return (
            <g>
                {accidentals.map((acc, index) => {
                    const position = NOTE_POSITIONS[acc.pitch] + (acc.octave - 4) * 7;
                    const y = getNoteY(position, staffTop, clef);
                    const x = START_X + index * 14;
                    return <Accidental key={index} type={signature.type} x={x} y={y} color={color}/>;
                })}
            </g>
        );
    };

    const TimeSignatureDisplay: React.FC<{ signature: TimeSignature; x: number, color: string, staffTop: number }> = ({ signature, x, color, staffTop }) => {
        const yTop = staffTop + LINE_HEIGHT;
        const yBottom = staffTop + 3 * LINE_HEIGHT;
        return (
            <g transform={`translate(${x}, 0)`}>
                <text x="0" y={yTop} fill={color} fontSize="32" fontFamily="serif" textAnchor="middle" dominantBaseline="central">
                    {signature.numerator}
                </text>
                <text x="0" y={yBottom} fill={color} fontSize="32" fontFamily="serif" textAnchor="middle" dominantBaseline="central">
                    {signature.denominator}
                </text>
            </g>
        );
    };

    const handleBarlineRightClick = (e: React.MouseEvent, measureIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, measureIndex });
    };

    const handleApplyContext = (measureIndex: number, newTonic: string, newIsMinor: boolean) => {
        setAnalysisContexts(prev => {
            const newContexts = prev.filter(c => c.measureIndex !== measureIndex);
            newContexts.push({ measureIndex, newTonic, newIsMinor });
            return newContexts.sort((a, b) => a.measureIndex - b.measureIndex);
        });
        setContextMenu(null);
    };

    const handleRemoveContext = (measureIndex: number) => {
        setAnalysisContexts(prev => prev.filter(c => c.measureIndex !== measureIndex));
        setContextMenu(null);
    };

    const existingContextForMenu = useMemo(() => {
        if (!contextMenu) return null;
        return analysisContexts.find(c => c.measureIndex === contextMenu.measureIndex);
    }, [contextMenu, analysisContexts]);


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
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const notesByMeasure = new Map<number, StaffNote[]>();
        let maxMeasureIndex = -1;
        notesToLayout.forEach(note => {
            const m = note.measureIndex ?? 0;
            if (m > maxMeasureIndex) maxMeasureIndex = m;
            if (!notesByMeasure.has(m)) notesByMeasure.set(m, []);
            notesByMeasure.get(m)!.push(note);
        });
        let targetTotalMeasures = Math.max(minMeasureCount, maxMeasureIndex + 3);
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
        const usablePageWidth = containerWidth - startOffset - STAFF_PADDING_X;
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
        systems.forEach(sys => {
            const systemBarlines: Barline[] = [];
            sys.measureIndices.forEach((m, idx) => {
                const startX = sys.startMeasuresX[idx];
                const nextX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : sys.width - STAFF_PADDING_X;
                const measureWidth = nextX - startX;
                measureFinalWidths.set(m, measureWidth);
                const measureNotes = notesToLayout.filter(n => n.measureIndex === m);
                const contentWidth = measureWidth - (MEASURE_PADDING_X * 2);
                measureNotes.forEach(n => {
                    const startTime = (n.beat || 1) - 1;
                    const relativeX = (startTime / beatsPerMeasure) * contentWidth;
                    finalNotes.push({ ...n, xPosition: startX + MEASURE_PADDING_X + relativeX });
                });
                systemBarlines.push({ id: `bar-${m}`, xPosition: startX + measureWidth });
            });
            allSystemsBarlines.push(systemBarlines);
        });
        return { positionedNotes: finalNotes, systemsBarlines: allSystemsBarlines, systemsParams: systems, measureFinalWidths };
    }, [analyzedNotes, containerWidth, timeSignature, keySignature, measuresPerLine, viewMode, minMeasureCount]);

    // =========================================================
    // ADAPTER LAYER (domain -> overlay data)
    // =========================================================

    // Stable harmony labels per system (roman/symbol + figured bass)
    const harmonyLabelsBySystem = useMemo(() => {
        if (!isAnalysisEnabled || !layoutData) return [];

        const labelsBySystem: { id: string; x: number; roman: string; figures: string[] }[][] = [];

        layoutData.systemsParams.forEach((system, systemIndex) => {
            const measureSet = new Set(system.measureIndices);
            const systemNotes = layoutData.positionedNotes.filter(n => !n.isRest && measureSet.has(n.measureIndex ?? -1));

            // Group by chordId (preferred) else measure-beat (stable); NOT by xPosition
            const chords = new Map<string, StaffNote[]>();
            systemNotes.forEach(n => {
                const key = n.chordId || `${n.measureIndex ?? 0}-${n.beat ?? 1}`;
                if (!chords.has(key)) chords.set(key, []);
                chords.get(key)!.push(n);
            });

            const systemLabels: { id: string; x: number; roman: string; figures: string[] }[] = [];

            chords.forEach((chordNotes, chordKey) => {
                const measureIndex = chordNotes[0]?.measureIndex ?? 0;

                const applicableContext = analysisContexts
                    .filter(c => c.measureIndex <= measureIndex)
                    .sort((a, b) => b.measureIndex - a.measureIndex)[0];

                const contextTonic = applicableContext ? applicableContext.newTonic : currentTonic;
                const contextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinorMode;

                let roman = '';
                let figures: string[] = [];

                try {
                    if (analysisMode === 'roman') {
                        const r = getRomanAnalysis(chordNotes, contextTonic, contextIsMinor);
                        if (r) {
                            roman = r.roman;
                            figures = r.figures || [];
                        }
                    } else {
                        const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
                        const symbol = getChordSymbol(chordNotes, contextKeySignature);
                        if (symbol) roman = symbol;
                    }
                } catch (err) {
                    // Prevent hard-crash from analysis edge cases while we wire everything.
                    console.warn('Harmony label compute failed', err);
                    return;
                }

                if (!roman) return;

                const xs = chordNotes.map(n => n.xPosition ?? 0).filter(Number.isFinite);
                const x = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : (chordNotes[0]?.xPosition ?? 0);

                systemLabels.push({
                    id: `hlabel-${systemIndex}-${chordKey}`,
                    x,
                    roman,
                    figures,
                });
            });

            systemLabels.sort((a, b) => a.x - b.x);
            labelsBySystem[systemIndex] = systemLabels;
        });

        return labelsBySystem;
    }, [isAnalysisEnabled, layoutData, analysisContexts, currentTonic, isMinorMode, analysisMode]);

    // Violations -> noteId -> level (defensive extraction)
    const violationLevelByNoteId = useMemo(() => {
        const map = new Map<string, 'error' | 'warning'>();

        const getIds = (v: any): string[] => {
            if (!v) return [];
            if (Array.isArray(v.noteIds)) return v.noteIds;
            if (typeof v.noteId === 'string') return [v.noteId];
            if (Array.isArray(v.notes)) return v.notes.map((n: any) => n?.id).filter(Boolean);
            if (v.note?.id) return [v.note.id];
            return [];
        };

        const getLevel = (v: any): 'error' | 'warning' => {
            const s = (v?.severity || v?.level || v?.type || '').toString().toLowerCase();
            return s.includes('warn') || s.includes('yellow') ? 'warning' : 'error';
        };

        try {
            (violations as any[]).forEach(v => {
                const level = getLevel(v);
                getIds(v).forEach((id) => {
                    const prev = map.get(id);
                    if (!prev || (prev === 'warning' && level === 'error')) map.set(id, level);
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
        audioService.stopAllSounds?.();
        setPlayingNoteIds([]);
        setPlayheadPosition(null);
        setIsPlaying(false);
    }, [audioService]);

    const startPlayback = useCallback(async () => {
        if (!isAudioReady) return;

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const beatDurationSec = 60 / bpm;

        const timeMap = new Map<string, StaffNote[]>();
        analyzedNotes.forEach(n => {
            const key = `${n.measureIndex ?? 0}-${n.beat ?? 1}`;
            if (!timeMap.has(key)) timeMap.set(key, []);
            timeMap.get(key)!.push(n);
        });

        const events = Array.from(timeMap.entries())
            .map(([key, notes]) => {
                const [m, b] = key.split('-').map(Number);
                const absBeat = (m * beatsPerMeasure) + (b - 1);
                return { absBeat, notes };
            })
            .sort((a, b) => a.absBeat - b.absBeat);

        if (events.length === 0) return;

        setIsPlaying(true);

        const startMs = performance.now() + 80; // small lookahead
        events.forEach((ev, idx) => {
            const next = events[idx + 1];
            const durBeats = (next ? next.absBeat : (ev.absBeat + 1)) - ev.absBeat;
            const durSec = Math.max(0.05, durBeats * beatDurationSec);

            const delayMs = (ev.absBeat - events[0].absBeat) * beatDurationSec * 1000;
            const t = window.setTimeout(async () => {
                const playable = ev.notes.filter(n => !n.isRest && (n.midi ?? 0) > 0);
                setPlayingNoteIds(ev.notes.map(n => n.id));

                if (selectedMidiOutput) {
                    playable.forEach(n => sendMidiNote(n, selectedMidiOutput, durSec));
                } else if (audioService.audioContext) {
                    const names = playable.map(n => midiToName(n.midi));
                    if (names.length) audioService.playChord(names, { when: audioService.audioContext.currentTime, duration: durSec });
                }
            }, Math.max(0, (startMs - performance.now()) + delayMs));

            playbackTimeoutsRef.current.push(t);
        });

        const endMs = (events[events.length - 1].absBeat - events[0].absBeat + 1) * beatDurationSec * 1000;
        playbackTimeoutsRef.current.push(window.setTimeout(() => stopPlayback(), endMs + 200));
    }, [analyzedNotes, audioService, bpm, isAudioReady, midiToName, selectedMidiOutput, sendMidiNote, stopPlayback, timeSignature]);

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
        if (e.target === e.currentTarget) setSelectedNoteIds(new Set());
    }, []);

    const handleNoteClick = useCallback((noteId: string, e: React.MouseEvent | MouseEvent) => {
        e.stopPropagation();
        setSelectedNoteIds(prev => {
            const next = new Set(prev);
            if ((e as any).shiftKey) {
                if (next.has(noteId)) next.delete(noteId);
                else next.add(noteId);
                return next;
            }
            if (next.size === 1 && next.has(noteId)) return new Set();
            return new Set([noteId]);
        });
    }, []);

    const getSystemMeasureAtX = useCallback((systemIndex: number, x: number) => {
        const sys = layoutData?.systemsParams?.[systemIndex];
        if (!sys || !layoutData) return null;

        for (let i = 0; i < sys.measureIndices.length; i++) {
            const mIdx = sys.measureIndices[i];
            const startX = sys.startMeasuresX[i];
            const w = layoutData.measureFinalWidths.get(mIdx) || 0;
            if (x >= startX && x < startX + w) return { measureIndex: mIdx, measureStartX: startX, measureWidth: w };
        }
        return null;
    }, [layoutData]);

    const handleBackgroundClick = useCallback((x: number, y: number, systemIndex: number) => {
        if (!layoutData) return;

        const hit = getSystemMeasureAtX(systemIndex, x);
        if (!hit) return;

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const contentWidth = Math.max(1, hit.measureWidth - (MEASURE_PADDING_X * 2));
        const relX = x - (hit.measureStartX + MEASURE_PADDING_X);
        const beatRaw = (Math.max(0, Math.min(1, relX / contentWidth)) * beatsPerMeasure) + 1;

        const gridStep = DURATION_VALUES[selectedInsertion.duration] * (isTriplet ? (2 / 3) : 1);
        const step = Math.max(1e-6, gridStep);
        const beat = Math.round((1 + Math.round((beatRaw - 1) / step) * step) * 1e6) / 1e6;

        const targetClef: ClefType = (selectedVoice === 3 || selectedVoice === 4) ? 'bass' : 'treble';
        const isBassArea = y > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2);
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
                isDotted,
                measureIndex: hit.measureIndex,
                beat,
                clef: targetClef,
                voice: selectedVoice,
            };
            setRawNotes(prev => [...prev, rest]);
            return;
        }

        const staffTop = targetClef === 'treble' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP;
        const relativeY = targetClef === 'treble' ? y : (y - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT);

        let pos = targetClef === 'treble'
            ? ((staffTop + 5 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2)
            : ((staffTop + 2 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2);

        // keep your existing empirical bass alignment
        if (targetClef === 'bass' && (selectedVoice === 3 || selectedVoice === 4)) pos -= 4;

        pos = Math.round(pos);

        let props = getNotePropertiesFromDiatonicPosition(pos, targetClef, keySignature);
        if (selectedVoice === 1 || selectedVoice === 2) { props = { ...props, octave: props.octave + 1, midi: props.midi + 12 }; }
        props = applyActiveAccidental(props);

        const newNote: StaffNote = {
            id: crypto.randomUUID(),
            ...props,
            duration: selectedInsertion.duration,
            isRest: false,
            isTriplet,
            isDotted,
            measureIndex: hit.measureIndex,
            beat,
            clef: targetClef,
            voice: selectedVoice,
        };

        setRawNotes(prev => [...prev, newNote]);
        void playNote(newNote);
        if (activeAccidental) setActiveAccidental(null);
    }, [
        getSystemMeasureAtX,
        isDotted,
        isTriplet,
        keySignature,
        layoutData,
        selectedInsertion,
        selectedVoice,
        setRawNotes,
        timeSignature,
        applyActiveAccidental,
        playNote,
        activeAccidental,
    ]);

    const handleBackgroundMouseDown = useCallback((_e: MouseEvent, _svg: SVGSVGElement, _systemIndex: number) => {
        // keep empty for now (your full rectangle selection can be reintroduced after stabilization)
    }, []);

    const handleMouseMove = useCallback((x: number, y: number, systemIndex: number) => {
        if (!layoutData) return;

        const targetClef: ClefType = (selectedVoice === 3 || selectedVoice === 4) ? 'bass' : 'treble';
        const isBassArea = y > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2);
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

        const gridStep = DURATION_VALUES[selectedInsertion.duration] * (isTriplet ? (2 / 3) : 1);
        const step = Math.max(1e-6, gridStep);
        const beat = Math.round((1 + Math.round((beatRaw - 1) / step) * step) * 1e6) / 1e6;

        const snappedRelX = ((beat - 1) / beatsPerMeasure) * contentWidth;
        const xPos = hit.measureStartX + MEASURE_PADDING_X + snappedRelX;

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
                isDotted,
                xPosition: xPos,
                clef: targetClef,
                voice: selectedVoice,
                systemIndex,
            });
            return;
        }

        const staffTop = targetClef === 'treble' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP;
        const relativeY = targetClef === 'treble' ? y : (y - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT);

        let pos = targetClef === 'treble'
            ? ((staffTop + 5 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2)
            : ((staffTop + 2 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2);

        if (targetClef === 'bass' && (selectedVoice === 3 || selectedVoice === 4)) pos -= 4;
        pos = Math.round(pos);

        let props = getNotePropertiesFromDiatonicPosition(pos, targetClef, keySignature);
        if (selectedVoice === 1 || selectedVoice === 2) props = { ...props, octave: props.octave + 1, midi: props.midi + 12 };

        setGhostNote({
            id: 'ghost',
            ...props,
            duration: selectedInsertion.duration,
            isRest: false,
            isTriplet,
            isDotted,
            xPosition: xPos,
            clef: targetClef,
            voice: selectedVoice,
            systemIndex,
        });
    }, [getNotePropertiesFromDiatonicPosition, getSystemMeasureAtX, isDotted, isTriplet, keySignature, layoutData, selectedInsertion, selectedVoice, timeSignature]);

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
    const handleBpmKeyDown = useCallback((_e: React.KeyboardEvent<HTMLDivElement>) => {
        // minimal: keep stable (you can re-add numeric editing later)
    }, []);

    const handleBpmBlur = useCallback(() => {
        setIsBpmActive(false);
    }, []);

    const toggleMetronome = useCallback(() => {
        setIsMetronomeOn(p => !p);
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
    }, [selectedNoteIds, setRawNotes]);

    // =========================================================
    // RENDER
    // =========================================================
    return (
        <div className="flex-grow flex flex-col gap-4">
            <div className="flex flex-row items-center flex-wrap gap-x-6 gap-y-2 p-2 bg-slate-800 border-b border-slate-700 rounded-lg">
                <div className="flex items-center gap-2">
                    <button onClick={togglePlayback} className={`p-2 rounded-full transition-colors ${isPlaying ? 'text-yellow-400 hover:bg-yellow-400/20' : 'text-green-400 hover:bg-green-400/20'}`} title={isPlaying ? "Pausa (Spazio)" : "Play (Spazio)"}>{isPlaying ? <PauseIcon /> : <PlayIcon />}</button>
                    <button onClick={undoNotes} className="p-2 rounded-full text-gray-300 hover:bg-gray-600 transition-colors" title="Undo (Cmd/Ctrl+Z)"><UndoIcon /></button>
                </div>
                <div className="h-6 w-px bg-slate-600"></div>
                 <div className="flex items-center gap-2">
                    <div 
                        ref={bpmControlRef}
                        tabIndex={0}
                        onFocus={() => setIsBpmActive(true)}
                        onBlur={handleBpmBlur}
                        onKeyDown={handleBpmKeyDown}
                        className="relative flex items-center gap-2 p-1 rounded-md bg-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                        <span className="text-xs text-slate-400">BPM</span>
                        <span className="text-lg font-bold w-12 text-center">
                            {isBpmActive && bpmInputString ? bpmInputString : bpm}
                        </span>
                    </div>
                    <button 
                        onClick={toggleMetronome} 
                        className={`relative p-2 rounded-full transition-colors ${isMetronomeOn ? 'text-cyan-400' : 'text-gray-300 hover:bg-gray-600'} ${metronomeFlash === 'strong' ? 'bg-cyan-400/50' : metronomeFlash === 'weak' ? 'bg-cyan-400/20' : ''}`}
                        title="Metronomo (K)"
                    >
                        <MetronomeIcon />
                    </button>
                </div>
                <div className="h-6 w-px bg-slate-600"></div>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-400">Tonalità:</span>
                    <select
                        id="key-signature-select"
                        value={keySignatureRoot}
                        onChange={e => setKeySignatureRoot(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs"
                    >
                        <optgroup label="Diesis (♯)">{sharpKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                        <optgroup label="Bemolli (♭)">{flatKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                    </select>
                    <div className="relative flex p-0.5 bg-gray-900/50 rounded-md">
                        <div className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform" style={{ transform: `translateX(${isMinorMode ? '100%' : '0%'}) ` }}></div>
                        <button onClick={() => setIsMinorMode(false)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${!isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>Mag</button>
                        <button onClick={() => setIsMinorMode(true)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${isMinorMode ? 'text-gray-900' : 'text-gray-300'}`}>min</button>
                    </div>
                </div>
                 <div className="h-6 w-px bg-slate-600"></div>
                 <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-400">Tempo:</span>
                    <TimeSignatureControl value={timeSignature} onChange={setTimeSignature} />
                 </div>
                <div className="h-6 w-px bg-slate-600"></div>
                <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                    {[1, 2, 3, 4].map(v => (
                        <button key={v} onClick={() => setSelectedVoice(v as Voice)} className={`px-2.5 py-0.5 text-xs font-semibold rounded-sm transition-all ${selectedVoice === v ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>V{v}</button>
                    ))}
                </div>
                <div className="h-6 w-px bg-slate-600"></div>
                <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                    <button onClick={() => { setSelectedInsertion(prev => ({ ...prev, type: prev.type === 'note' ? 'rest' : 'note' })); }} className="p-1 rounded-md text-gray-300 hover:bg-gray-600 transition-colors" title={selectedInsertion.type === 'note' ? "Nota" : "Pausa"}>
                        {selectedInsertion.type === 'note' ? <QuarterNoteIcon /> : <QuarterRestIcon />}
                    </button>
                    <div className="w-px h-5 bg-gray-600 mx-1"></div>
                    {durations.map(({ duration, label, NoteIcon, RestIcon }) => (
                        <button key={duration} onClick={() => { setSelectedInsertion(prev => ({ ...prev, duration })); }} className={`p-1 rounded-md transition-colors ${selectedInsertion.duration === duration ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title={label}><IconComponent type={selectedInsertion.type} duration={duration} /></button>
                    ))}
                     <div className="w-px h-5 bg-gray-600 mx-1"></div>
                      <button onClick={() => setIsDotted(d => !d)} className={`p-1 rounded-md transition-colors ${isDotted ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Punto di valore"><DotIcon /></button>
                     <button onClick={() => {
                        setIsTriplet(t => {
                            const newTripletState = !t;
                            if (newTripletState) {
                                setTupletNoteCount(0);
                                setTripletBaseDuration(selectedInsertion.duration);
                            } else {
                                setTupletNoteCount(0);
                                setTripletBaseDuration(null);
                            }
                            return newTripletState;
                        });
                    }} className={`p-1 rounded-md transition-colors ${isTriplet ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Terzina"><TripletIcon /></button>
                </div>
                 <div className="h-6 w-px bg-slate-600"></div>
                <div className="flex items-center gap-1 p-1 bg-slate-700 rounded-md">
                    <button onClick={() => setActiveAccidental(p => p === 'sharp' ? 'double-sharp' : (p === 'double-sharp' ? null : 'sharp'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'sharp' || activeAccidental === 'double-sharp' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Diesis (♯)"><SharpIcon /></button>
                    <button onClick={() => setActiveAccidental(p => p === 'double-sharp' ? 'sharp' : (p === 'sharp' ? null : 'double-sharp'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'double-sharp' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Doppio Diesis (𝄪)"><DoubleSharpIcon /></button>
                    <button onClick={() => setActiveAccidental(p => p === 'flat' ? 'double-flat' : (p === 'double-flat' ? null : 'flat'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'flat' || activeAccidental === 'double-flat' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Bemolle (♭)"><FlatIcon /></button>
                    <button onClick={() => setActiveAccidental(p => p === 'double-flat' ? 'flat' : (p === 'flat' ? null : 'double-flat'))} className={`p-1 rounded-md transition-colors ${activeAccidental === 'double-flat' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Doppio Bemolle (♭♭)"><DoubleFlatIcon /></button>
                    <button onClick={() => setActiveAccidental(p => p === 'natural' ? null : 'natural')} className={`p-1 rounded-md transition-colors ${activeAccidental === 'natural' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`} title="Bequadro (N)"><NaturalIcon /></button>
                </div>
                <div className="h-6 w-px bg-slate-600"></div>
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
                        <TieIcon />
                    </button>
                    <button
                        onClick={handleFlipStem}
                        disabled={selectedNoteIds.size === 0}
                        className="p-1 rounded-md text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-600 transition-colors"
                        title="Inverti gambo / legatura"
                    >
                        <FlipStemIcon />
                    </button>
                </div>
                <div className="h-6 w-px bg-slate-600"></div>
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
                        <div className="relative flex p-0.5 bg-gray-900/50 rounded-md text-xs ml-2">
                            <div 
                                className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform duration-300 ease-in-out" 
                                style={{ transform: `translateX(${analysisMode === 'roman' ? '0%' : '100%'})` }}
                            ></div>
                            <button onClick={() => setAnalysisMode('roman')} className={`relative w-24 rounded-sm py-0.5 font-bold transition-colors ${analysisMode === 'roman' ? 'text-gray-900' : 'text-gray-300'}`}>Numeri Romani</button>
                            <button onClick={() => setAnalysisMode('symbol')} className={`relative w-24 rounded-sm py-0.5 font-bold transition-colors ${analysisMode === 'symbol' ? 'text-gray-900' : 'text-gray-300'}`}>Sigle</button>
                        </div>
                    )}
                </div>
                <div className="h-6 w-px bg-slate-600"></div>
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
            </div>
            
            <div className="flex flex-row gap-4 flex-grow min-h-0">
                <div
                    ref={staffContainerRef}
                    className={`flex-grow overflow-y-auto bg-stone-100 rounded-lg p-4 shadow-inner ${viewMode === 'linear' ? 'overflow-x-auto' : 'overflow-x-hidden'}`}
                    onClick={handleDeselectOnClickOutside}
                >
                    {layoutData.systemsParams.map((system, systemIndex) => {
                        // PERF: avoid new Set(...) inside filter per note
                        const measureSet = new Set(system.measureIndices);
                        const systemNotes = layoutData.positionedNotes.filter(note => measureSet.has(note.measureIndex ?? -1));

                        const actualSystemWidth = system.width;
                        const ghost = ghostNote && ghostNote.systemIndex === systemIndex ? ghostNote : null;
                        const systemBarlines = layoutData.systemsBarlines?.[systemIndex] || [];
                        const systemTriplets = tripletGroupsBySystem[systemIndex] || [];

                        const systemHarmonyLabels = (harmonyLabelsBySystem?.[systemIndex] || []);
                        const showHarmony = isAnalysisEnabled && systemHarmonyLabels.length > 0;

                        return (
                          <div
                            key={`system-${systemIndex}`}
                            className={`relative ${viewMode === 'page' ? 'mb-8' : 'mb-0'}`}
                            style={{ width: actualSystemWidth, height: TOTAL_SYSTEM_HEIGHT }}
                          >
                            <VexflowGrandStaff
                              notes={systemNotes}
                              timeSignature={timeSignature}
                              keySignature={keySignature}
                              barlines={systemBarlines}
                              width={actualSystemWidth}
                              height={TOTAL_SYSTEM_HEIGHT}
                              selectedNoteIds={Array.from(selectedNoteIds)}
                              onNoteClick={(noteId, e) => handleNoteClick(noteId, e as any)}
                              onStaffClick={(x, y) => handleBackgroundClick(x, y, systemIndex)}
                              onStaffMouseDown={(e, svg) => handleBackgroundMouseDown(e, svg, systemIndex)}
                              onMouseMoveStaff={(x, y) => handleMouseMove(x, y, systemIndex)}
                              ghostNote={ghost}
                            />

                            {/* Overlay: selection rect */}
                            {rectForRender && selectionRect.systemIndex === systemIndex && (
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

                            {/* Overlay: analysis labels + violation highlights (adapter output) */}
                            {(isAnalysisEnabled || violationLevelByNoteId.size > 0) && (
                              <svg className="absolute inset-0 pointer-events-none" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT}>
                                {/* Harmony labels (roman/symbol) + figured bass */}
                                {showHarmony && systemHarmonyLabels.map(lbl => {
                                  const romanY = TOP_STAFF_TOP - 14; // above treble staff
                                  const bassBaseY = TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + (BOTTOM_STAFF_TOP + 4 * LINE_HEIGHT);
                                  const figuresY0 = bassBaseY + 22;

                                  return (
                                    <g key={lbl.id}>
                                      <text x={lbl.x} y={romanY} textAnchor="middle" fontSize={14} fontWeight={700} fill="black">
                                        {lbl.roman}
                                      </text>

                                      {lbl.figures?.length ? (
                                        <g>
                                          {lbl.figures.map((f, i) => (
                                            <text
                                              key={`${lbl.id}-fig-${i}`}
                                              x={lbl.x}
                                              y={figuresY0 + (i * 12)}
                                              textAnchor="middle"
                                              fontSize={12}
                                              fill="black"
                                            >
                                              {f}
                                            </text>
                                          ))}
                                        </g>
                                      ) : null}
                                    </g>
                                  );
                                })}

                                {/* Violation halos around notes (uses notePositions + noteId mapping) */}
                                {Array.from(violationLevelByNoteId.entries()).map(([noteId, level]) => {
                                  const pos = notePositions.get(noteId);
                                  if (!pos) return null;

                                  const isHovered = hoveredViolationNotes?.includes(noteId);
                                  const stroke = level === 'warning' ? '#f59e0b' : '#ef4444'; // amber/red
                                  const r = isHovered ? 11 : 9;

                                  return (
                                    <circle
                                      key={`vio-${noteId}`}
                                      cx={pos.x}
                                      cy={pos.y}
                                      r={r}
                                      fill="none"
                                      stroke={stroke}
                                      strokeWidth={isHovered ? 3 : 2}
                                      opacity={0.9}
                                    />
                                  );
                                })}
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
                            <HarmonyAnalysisPanel violations={violations} onHoverViolation={setHoveredViolationNotes} />
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

            {/* ...existing context menu code... */}
        </div>
    );
};

const ModulationContextMenu: React.FC<{
    menuData: { x: number; y: number; measureIndex: number; };
    onClose: () => void;
    onApply: (measureIndex: number, newTonic: string, newIsMinor: boolean) => void;
    onRemove: (measureIndex: number) => void;
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
        onApply(menuData.measureIndex, tonicToApply, tempIsMinor);
    };

    return (
        <div
            ref={menuRef}
            style={{ top: menuData.y, left: menuData.x }}
            className="absolute z-50 bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-600 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
        >
            <h3 className="text-white font-bold text-sm">Contesto Analisi (Misura {menuData.measureIndex + 1})</h3>
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
                <button onClick={() => onRemove(menuData.measureIndex)} className="px-3 py-1 text-sm rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors">Rimuovi</button>
                <button onClick={onClose} className="px-3 py-1 text-sm rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors">Annulla</button>
            </div>
        </div>
    );
};


const IconComponent: React.FC<{type: 'note' | 'rest', duration: NoteDuration}> = ({ type, duration }) => {
    const icons = {
        note: { whole: WholeNoteIcon, half: HalfNoteIcon, quarter: QuarterNoteIcon, eighth: EighthNoteIcon, sixteenth: SixteenthNoteIcon, 'thirty-second': ThirtySecondNoteIcon, 'sixty-fourth': SixtyFourthNoteIcon },
        rest: { whole: WholeRestIcon, half: HalfRestIcon, quarter: QuarterRestIcon, eighth: EighthRestIcon, sixteenth: SixteenthRestIcon, 'thirty-second': ThirtySecondRestIcon, 'sixty-fourth': SixtyFourthRestIcon }
    };
    const Comp = icons[type][duration];
    return <Comp />;
};

export default GrandStaffEditor;
