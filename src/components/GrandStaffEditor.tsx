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
    const playbackTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
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
    const bpmInputTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
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

    const contextMarkers = useMemo(() => {
        if (!layoutData) return [];
        const markers: { systemIndex: number, x: number, label: string }[] = [];
        analysisContexts.forEach(context => {
            for (let i = 0; i < layoutData.systemsParams.length; i++) {
                const system = layoutData.systemsParams[i];
                const measureIndexInSystem = system.measureIndices.indexOf(context.measureIndex);
                if (measureIndexInSystem !== -1) {
                    const x = system.startMeasuresX[measureIndexInSystem];
                    const keyName = context.newTonic;
                    const mode = context.newIsMinor ? "min" : "Mag";
                    markers.push({ systemIndex: i, x: x, label: `[${keyName} ${mode}]` });
                    break; 
                }
            }
        });
        return markers;
    }, [analysisContexts, layoutData]);

    const beamGroupsBySystem = useMemo(() => {
        const systems: StaffNote[][][] = [];
        if (!layoutData) return systems;
    
        const isCompound = timeSignature.denominator === 8 && timeSignature.numerator > 0 && timeSignature.numerator % 3 === 0;
        const beatUnit = isCompound ? 1.5 : 1;
    
        layoutData.systemsParams.forEach((system) => {
            const systemBeamGroups: StaffNote[][] = [];
            const systemNotes = layoutData.positionedNotes.filter(note => 
                new Set(system.measureIndices).has(note.measureIndex ?? -1)
            );
    
            const notesByVoice = new Map<Voice, StaffNote[]>();
            systemNotes.forEach(note => {
                if (note.isRest) return;
                const voice = note.voice || 1;
                if (!notesByVoice.has(voice)) notesByVoice.set(voice, []);
                notesByVoice.get(voice)!.push(note);
            });
    
            notesByVoice.forEach((voiceNotes) => {
                const notesByMeasure = new Map<number, StaffNote[]>();
                voiceNotes.forEach(note => {
                    const measure = note.measureIndex ?? 0;
                    if (!notesByMeasure.has(measure)) notesByMeasure.set(measure, []);
                    notesByMeasure.get(measure)!.push(note);
                });
    
                notesByMeasure.forEach((measureNotes) => {
                    measureNotes.sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0));
                    
                    const manuallyBeamedNotes = new Set<string>();
                    const manualGroups = new Map<string, StaffNote[]>();

                    measureNotes.forEach(note => {
                        if (note.manualBeamGroupId) {
                            if (!manualGroups.has(note.manualBeamGroupId)) {
                                manualGroups.set(note.manualBeamGroupId, []);
                            }
                            manualGroups.get(note.manualBeamGroupId)!.push(note);
                            manuallyBeamedNotes.add(note.id);
                        }
                    });

                    manualGroups.forEach(group => {
                        if (group.length > 1) {
                            systemBeamGroups.push(group.sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0)));
                        }
                    });
                    
                    const notesForAutoBeaming = measureNotes.filter(note => !manuallyBeamedNotes.has(note.id));
                    
                    let currentGroup: StaffNote[] = [];
    
                    for (let i = 0; i < notesForAutoBeaming.length; i++) {
                        const note = notesForAutoBeaming[i];
                        const noteDuration = DURATION_VALUES[note.duration || 'quarter'];
                        const canBeBeamed = noteDuration <= 0.5 && !note.isRest && !note.isTriplet;
    
                        if (canBeBeamed) {
                            if (currentGroup.length === 0) {
                                currentGroup.push(note);
                            } else {
                                const lastNoteInGroup = currentGroup[currentGroup.length - 1];
                                const lastNoteBeat = lastNoteInGroup.beat || 1;
                                const currentNoteBeat = note.beat || 1;
                                
                                const lastNoteBeatIndex = Math.floor((lastNoteBeat - 1) / beatUnit);
                                const currentNoteBeatIndex = Math.floor((currentNoteBeat - 1) / beatUnit);
    
                                if (lastNoteBeatIndex === currentNoteBeatIndex) {
                                    currentGroup.push(note);
                                } else {
                                    if (currentGroup.length > 1) systemBeamGroups.push(currentGroup);
                                    currentGroup = [note];
                                }
                            }
                        } else {
                            if (currentGroup.length > 1) systemBeamGroups.push(currentGroup);
                            currentGroup = [];
                        }
                    }
                    if (currentGroup.length > 1) systemBeamGroups.push(currentGroup);
                });
            });
            systems.push(systemBeamGroups);
        });
        return systems;
    }, [layoutData, timeSignature]);
    
    const beamedNoteIdsBySystem = useMemo(() => 
        beamGroupsBySystem.map(systemGroups => new Set(systemGroups.flat().map(note => note.id)))
    , [beamGroupsBySystem]);

    const tripletGroupsBySystem = useMemo(() => {
        const systems: { id: string, x1: number, x2: number, midX: number, bracketY: number, textY: number, curveHeight: number }[][] = [];
        if (!layoutData) return systems;
    
        layoutData.systemsParams.forEach((system, systemIndex) => {
            const systemGroups: { id: string, x1: number, x2: number, midX: number, bracketY: number, textY: number, curveHeight: number }[] = [];
            const systemNotes = layoutData.positionedNotes.filter(n => 
                new Set(system.measureIndices).has(n.measureIndex ?? -1)
            );
    
            const notesByVoice = new Map<Voice, StaffNote[]>();
            systemNotes.forEach(note => {
                if (!note.voice) return;
                if (!notesByVoice.has(note.voice)) notesByVoice.set(note.voice, []);
                notesByVoice.get(note.voice)!.push(note);
            });
    
            notesByVoice.forEach((voiceNotes) => {
                voiceNotes.sort((a,b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || (a.beat ?? 0) - (b.beat ?? 0));
    
                for (let i = 0; i < voiceNotes.length - 2; i++) {
                    const note1 = voiceNotes[i];
                    const note2 = voiceNotes[i+1];
                    const note3 = voiceNotes[i+2];
    
                    if (note1.isTriplet && note2.isTriplet && note3.isTriplet) {
                        const groupNotes = [note1, note2, note3];
    
                        const isTreble = note1.clef !== 'bass';
                        const yOffset = isTreble ? 0 : TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT;
                        const staffTop = isTreble ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP;
                        
                        const x1 = note1.xPosition!;
                        const x3 = note3.xPosition!;
                        const midX = (x1 + x3) / 2;
    
                        const noteYPositions = groupNotes.map(n => getNoteY(n.position, staffTop, n.clef || 'treble'));
                        const highestNoteHeadY = Math.min(...noteYPositions);
                        
                        const BRACKET_OFFSET_FROM_NOTE = 40;
                        const CURVE_HEIGHT = 8;
                        const TEXT_OFFSET_FROM_BRACKET = 12;

                        const bracketY = highestNoteHeadY + yOffset - BRACKET_OFFSET_FROM_NOTE;
                        const textY = bracketY + TEXT_OFFSET_FROM_BRACKET;
                        
                        systemGroups.push({
                            id: `triplet-${note1.id}`,
                            x1,
                            x2: x3,
                            midX,
                            bracketY: bracketY,
                            textY: textY,
                            curveHeight: CURVE_HEIGHT,
                        });
                        
                        i += 2;
                    }
                }
            });
            systems[systemIndex] = systemGroups;
        });
        return systems;
    }, [layoutData]);
    
    const romanAnalysisBySystem = useMemo(() => {
        if (!isAnalysisEnabled) return [];
        const analysisData: { x: number, analysis: { roman: string, figures: string[] } }[][] = [];

        if (!layoutData) return analysisData;

        layoutData.systemsParams.forEach((system, systemIndex) => {
            const systemAnalysis: { x: number, analysis: { roman: string, figures: string[] } }[] = [];
            
            const systemNotes = layoutData.positionedNotes.filter(note => 
                new Set(system.measureIndices).has(note.measureIndex ?? -1)
            );
            
            const chords = new Map<string, StaffNote[]>();
            systemNotes.forEach(note => {
                if (note.isRest) return;
                const key = (note.xPosition || 0).toFixed(3);
                if (!chords.has(key)) chords.set(key, []);
                chords.get(key)!.push(note);
            });

            chords.forEach(chord => {
                const measureIndex = chord[0]?.measureIndex ?? 0;
                const applicableContext = analysisContexts
                    .filter(c => c.measureIndex <= measureIndex)
                    .sort((a, b) => b.measureIndex - a.measureIndex)[0];
                
                const contextTonic = applicableContext ? applicableContext.newTonic : currentTonic;
                const contextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinorMode;

                let analysis: { roman: string, figures: string[] } | null = null;
                if (analysisMode === 'roman') {
                    // This function now returns an object { roman, figures }
                    analysis = getRomanAnalysis(chord, contextTonic, contextIsMinor);
                } else {
                    const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
                    const symbol = getChordSymbol(chord, contextKeySignature);
                    if (symbol) {
                        analysis = { roman: symbol, figures: [] };
                    }
                }

                if (analysis) {
                    const x = chord[0].xPosition || 0;
                    systemAnalysis.push({ x, analysis });
                }
            });

            analysisData[systemIndex] = systemAnalysis;
        });

        return analysisData;

    }, [layoutData, currentTonic, isMinorMode, analysisContexts, isAnalysisEnabled, analysisMode]);

    const notePositions = useMemo(() => {
        const map = new Map<string, { x: number; y: number }>();
        if (!layoutData) return map;

        const temporalGroups = new Map<string, StaffNote[]>();
        const rests: StaffNote[] = [];

        layoutData.positionedNotes.forEach(note => {
            if (note.isRest) {
                rests.push(note);
            } else {
                const key = note.chordId || `${note.measureIndex}-${note.beat}`;
                if (!temporalGroups.has(key)) temporalGroups.set(key, []);
                temporalGroups.get(key)!.push(note);
            }
        });

        temporalGroups.forEach(chord => {
            const trebleChord = chord.filter(n => (n.clef || 'treble') === 'treble').sort((a, b) => a.position - b.position);
            const bassChord = chord.filter(n => n.clef === 'bass').sort((a, b) => a.position - b.position);

            const processChord = (chord: StaffNote[], clef: 'treble' | 'bass', staffTop: number) => {
                const avgPos = chord.reduce((sum, n) => sum + n.position, 0) / chord.length;
                let isStemUp = avgPos < (clef === 'treble' ? 6 : -2);

                const offsets = new Map<string, number>();
                for (let i = 0; i < chord.length; i++) {
                    const note = chord[i];
                    const nextNote = chord[i + 1];

                    if (nextNote && nextNote.position - note.position === 1) {
                        // Collision detected: Adjust offsets and stem directions
                        offsets.set(note.id, isStemUp ? -NOTE_HEAD_RX_NORMAL : NOTE_HEAD_RX_NORMAL);
                        offsets.set(nextNote.id, isStemUp ? NOTE_HEAD_RX_NORMAL : -NOTE_HEAD_RX_NORMAL);

                        // Force stem directions
                        note.manualStemDirection = isStemUp ? 'up' : 'down';
                        nextNote.manualStemDirection = isStemUp ? 'down' : 'up';
                    } else {
                        offsets.set(note.id, 0);
                    }
                }

                chord.forEach(note => {
                    const x = (note.xPosition || 0) + (offsets.get(note.id) || 0);
                    const yInStaff = getNoteY(note.position, staffTop, clef);
                    const y = clef === 'bass' ? TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + yInStaff : yInStaff;
                    map.set(note.id, { x, y });
                });
            };

            processChord(trebleChord, 'treble', TOP_STAFF_TOP);
            processChord(bassChord, 'bass', BOTTOM_STAFF_TOP);
        });

        rests.forEach(rest => {
            const x = rest.xPosition || 0;
            let y: number;
            if (rest.clef === 'bass') {
                y = TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP + 2 * LINE_HEIGHT;
            } else {
                y = TOP_STAFF_TOP + 2 * LINE_HEIGHT;
            }
            map.set(rest.id, { x, y });
        });

        return map;
    }, [layoutData]);

    const tiePathsBySystem = useMemo(() => {
        const systems: React.ReactNode[][] = [];
        if (!layoutData) return systems;
    
        layoutData.systemsParams.forEach((system, systemIndex) => {
            const systemTies: React.ReactNode[] = [];
            const systemNotes = layoutData.positionedNotes.filter(note => 
                new Set(system.measureIndices).has(note.measureIndex ?? -1)
            );
    
            systemNotes.forEach(note1 => {
                if (note1.isTiedToNext) {
                    const note1Index = notes.findIndex(n => n.id === note1.id);
                    let note2: StaffNote | undefined = undefined;
                    for (let i = note1Index + 1; i < notes.length; i++) {
                        const potentialNote2 = notes[i];
                        if (potentialNote2.voice === note1.voice) {
                            note2 = potentialNote2;
                            break;
                        }
                    }
    
                    if (note2 && systemNotes.some(n => n.id === note2!.id)) {
                        const pos1 = notePositions.get(note1.id);
                        const pos2 = notePositions.get(note2.id);
    
                        if (pos1 && pos2) {
                            const isTreble = note1.clef !== 'bass';
                            const yOffset = isTreble ? 0 : TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT;

                            const groupNotes = beamGroupsBySystem[systemIndex].find(g => g.some(n => n.id === note1.id));
                            let isStemUp: boolean;
                            
                            if(groupNotes) {
                                if (groupNotes[0].manualStemDirection) {
                                    isStemUp = groupNotes[0].manualStemDirection === 'up';
                                } else {
                                    const avgPos = groupNotes.reduce((sum, n) => sum + n.position, 0) / groupNotes.length;
                                    isStemUp = avgPos < (isTreble ? 6 : -2);
                                }
                            } else {
                                if (note1.manualStemDirection) isStemUp = note1.manualStemDirection === 'up';
                                else isStemUp = note1.position < (isTreble ? 6 : -2);
                            }

                            const tieDirection = note1.manualTieDirection ? note1.manualTieDirection : isStemUp ? 'down' : 'up';
                            
                            const y1 = pos1.y + yOffset + (tieDirection === 'down' ? NOTE_HEAD_RY_NORMAL : -NOTE_HEAD_RY_NORMAL);
                            const y2 = pos2.y + yOffset + (tieDirection === 'down' ? NOTE_HEAD_RY_NORMAL : -NOTE_HEAD_RY_NORMAL);
                            
                            const controlY = ((y1 + y2) / 2) + (tieDirection === 'down' ? 12 : -12);

                            const pathData = `M ${pos1.x} ${y1} Q ${(pos1.x + pos2.x)/2} ${controlY}, ${pos2.x} ${y2}`;

                            systemTies.push(
                                <path key={`tie-${note1.id}`} d={pathData} fill="none" stroke="black" strokeWidth="1.5" />
                            );
                        }
                    }
                }
            });
            systems.push(systemTies);
        });
        return systems;
    }, [layoutData, notePositions, beamGroupsBySystem, notes]);

    const notesToHighlight = useMemo(() => {
        const uniqueIds = new Set([...selectedNoteIds, ...(hoveredViolationNotes || [])]);
        return Array.from(uniqueIds);
    }, [selectedNoteIds, hoveredViolationNotes]);


    const sortedTimeEvents = useMemo(() => {
        const timeMap = new Map<string, StaffNote[]>();
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        
        layoutData.positionedNotes.forEach(note => {
            const key = `${note.measureIndex}-${note.beat}`;
            if (!timeMap.has(key)) timeMap.set(key, []);
            timeMap.get(key)!.push(note);
        });
    
        const sortedKeys = Array.from(timeMap.keys()).sort((a, b) => {
            const [m1, b1] = a.split('-').map(Number);
            const [m2, b2] = b.split('-').map(Number);
            if (m1 !== m2) return m1 - m2;
            return b1 - b2;
        });
    
        return sortedKeys.map(key => ({
            key,
            beat: (Number(key.split('-')[0]) * beatsPerMeasure) + (Number(key.split('-')[1]) - 1),
            notes: timeMap.get(key)!
        }));
    }, [layoutData.positionedNotes, timeSignature]);

    const sendMidiNote = (note: StaffNote, output: any, durationSeconds: number) => {
        if (!output) return;
        const midiNumber = note.midi;
        const velocity = 127; // Volume massimo
        const durationMs = durationSeconds * 1000;
      
        // Messaggio NOTE ON (Canale 1: 0x90)
        output.send([0x90, midiNumber, velocity]);
        
        // Messaggio NOTE OFF (Canale 1: 0x80) con ritardo
        output.send([0x80, midiNumber, 0], window.performance.now() + durationMs);
    };

    const playNoteSound = useCallback(async (midi: number) => {
        if (!isAudioReady || !audioService.audioContext) return;
        await audioService.ensureAudioIsReady();
        const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        const soundingMidi = midi - 12;
        if (soundingMidi < 21 || soundingMidi > 108) return;
        const noteName = noteNamesWithFlats[soundingMidi % 12];
        const octave = Math.floor(soundingMidi / 12) - 1;
        await audioService.playNote(`${noteName}${octave}`, { when: audioService.audioContext.currentTime, duration: 1 });
    }, [isAudioReady, audioService]);

    const playNote = useCallback(async (note: StaffNote) => {
        if (selectedMidiOutput) {
            sendMidiNote(note, selectedMidiOutput, 1.0);
        } else {
            await playNoteSound(note.midi);
        }
    }, [selectedMidiOutput, playNoteSound]);

    const animatePlayhead = useCallback(() => {
        if (!isPlayingRef.current || !audioService.audioContext) {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            return;
        }

        const audioNow = audioService.audioContext.currentTime;
        const elapsedAudioTimeSec = audioNow - audioPlaybackStartTimeRef.current;

        if (elapsedAudioTimeSec < 0) {
            animationFrameRef.current = requestAnimationFrame(animatePlayhead);
            return;
        }

        const beatDurationSec = 60 / bpm;
        const elapsedBeats = elapsedAudioTimeSec / beatDurationSec;
        const currentAbsoluteBeat = playbackStartBeatRef.current + elapsedBeats;
    
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        let systemIndex = -1;
        let playheadX = -1;
    
        for (let i = 0; i < layoutData.systemsParams.length; i++) {
            const sys = layoutData.systemsParams[i];
            const sysStartBeat = sys.measureIndices[0] * beatsPerMeasure;
            const nextSys = layoutData.systemsParams[i + 1];
            const nextSysStartBeat = nextSys ? nextSys.measureIndices[0] * beatsPerMeasure : Infinity;
    
            if (currentAbsoluteBeat >= sysStartBeat && currentAbsoluteBeat < nextSysStartBeat) {
                systemIndex = i;
                break;
            }
        }
        
        if (systemIndex !== -1) {
            const getXFromBeat = (absoluteBeat: number, sysIdx: number): number => {
                let measureIndex = Math.floor(absoluteBeat / beatsPerMeasure);
                let beatInMeasure = absoluteBeat % beatsPerMeasure;
        
                const systemParams = layoutData.systemsParams[sysIdx];
                if (!systemParams) return -1;
        
                if (Math.abs(beatInMeasure) < 0.001 && absoluteBeat > 0) {
                    const prevMeasureIndex = measureIndex - 1;
                    if (systemParams.measureIndices.includes(prevMeasureIndex)) {
                        const measureStartX = systemParams.startMeasuresX[systemParams.measureIndices.indexOf(prevMeasureIndex)];
                        const measureWidth = layoutData.measureFinalWidths.get(prevMeasureIndex) || 0;
                        return measureStartX + measureWidth;
                    }
                }
                
                if (!systemParams.measureIndices.includes(measureIndex)) {
                    if (absoluteBeat < systemParams.measureIndices[0] * beatsPerMeasure) {
                        return systemParams.startMeasuresX[0];
                    }
                    const lastMeasureInSystem = systemParams.measureIndices[systemParams.measureIndices.length - 1];
                    if (absoluteBeat >= (lastMeasureInSystem + 1) * beatsPerMeasure) {
                        return systemParams.startMeasuresX[systemParams.measureIndices.indexOf(lastMeasureInSystem)] + (layoutData.measureFinalWidths.get(lastMeasureInSystem) || 0);
                    }
                    return -1;
                }
        
                const measureStartX = systemParams.startMeasuresX[systemParams.measureIndices.indexOf(measureIndex)];
                const measureWidth = layoutData.measureFinalWidths.get(measureIndex) || 0;
        
                const contentWidth = Math.max(0, measureWidth - (MEASURE_PADDING_X * 2));
                const fraction = beatInMeasure / beatsPerMeasure;
        
                return measureStartX + MEASURE_PADDING_X + (fraction * contentWidth);
            };

            playheadX = getXFromBeat(currentAbsoluteBeat, systemIndex);
        }
    
        if (playheadX !== -1) {
            setPlayheadPosition({ x: playheadX, systemIndex });
        }
    
        animationFrameRef.current = requestAnimationFrame(animatePlayhead);
    }, [audioService, bpm, layoutData.systemsParams, layoutData.measureFinalWidths, timeSignature]);

     const stopStandaloneMetronome = useCallback(() => {
        if (metronomeIntervalRef.current) {
            clearInterval(metronomeIntervalRef.current);
            metronomeIntervalRef.current = null;
        }
        setMetronomeFlash(null);
    }, []);

    const handlePause = useCallback(() => {
        playbackTimeoutsRef.current.forEach(clearTimeout);
        playbackTimeoutsRef.current = [];
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        audioService.stopAllSounds();
        setIsPlaying(false);
        setMetronomeFlash(null);
        stopStandaloneMetronome();
    }, [audioService, stopStandaloneMetronome]);

    const handleStop = useCallback(() => {
        handlePause();
        setPlayingNoteIds([]);
        setPlayheadPosition(null);
    }, [handlePause]);

    const handlePlay = useCallback(async () => {
        if (isPlaying || !isAudioReady) return;
        
        stopStandaloneMetronome();
    
        await audioService.ensureAudioIsReady();
        if (!audioService.audioContext) return;

        const noteIdsToSkip = new Set<string>();
        const allPlayableNotes = sortedTimeEvents.flatMap(e => e.notes);
        allPlayableNotes.forEach(note => {
             if (note.isTiedToNext) {
                 const currentIndex = allPlayableNotes.findIndex(n => n.id === note.id);
                 let nextNote: StaffNote | undefined;
                 for(let i = currentIndex + 1; i < allPlayableNotes.length; i++) {
                     if (allPlayableNotes[i].voice === note.voice) {
                         nextNote = allPlayableNotes[i];
                         break;
                     }
                 }
                 if (nextNote && !nextNote.isRest && nextNote.midi === note.midi) {
                     noteIdsToSkip.add(nextNote.id);
                 }
             }
        });

        const audioCtx = audioService.audioContext;
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const beatDurationSec = 60 / bpm;
    
        let currentStartBeat = 0;
        if (loopRangeRef.current && isLoopingRef.current) {
            currentStartBeat = loopRangeRef.current.startBeat;
        } else if (selectedNoteIds.size > 0) {
            const selectedNotesObjects = analyzedNotes.filter(n => selectedNoteIds.has(n.id));
            if(selectedNotesObjects.length > 0) {
                const firstSelectedNoteBeat = Math.min(...selectedNotesObjects.map(n => ((n.measureIndex ?? 0) * beatsPerMeasure) + ((n.beat ?? 1) - 1) ));
                currentStartBeat = firstSelectedNoteBeat;
            }
        }
    
        playbackStartBeatRef.current = currentStartBeat;
        
        const LOOKAHEAD_SEC = 0.1;
        const audioStartTime = audioCtx.currentTime + LOOKAHEAD_SEC;
        audioPlaybackStartTimeRef.current = audioStartTime;
        const performanceStartTime = performance.now() + (LOOKAHEAD_SEC * 1000);

        playbackTimeoutsRef.current.forEach(clearTimeout);
        playbackTimeoutsRef.current = [];
    
        let endBeat;
        if (isLoopingRef.current && loopRangeRef.current) {
            endBeat = loopRangeRef.current.endBeat;
        } else {
            let maxNoteMeasureIndex = -1;
            layoutData.positionedNotes.forEach(n => {
                if ((n.measureIndex ?? 0) > maxNoteMeasureIndex) maxNoteMeasureIndex = n.measureIndex ?? 0;
            });
            const totalMeasures = Math.max(minMeasureCount, maxNoteMeasureIndex + 1);
            endBeat = totalMeasures * beatsPerMeasure;
        }
    
        const eventsToPlay = sortedTimeEvents.filter(event => 
            event.beat >= currentStartBeat - 0.001 && event.beat < endBeat - 0.001
        );
        
        eventsToPlay.forEach((event, index) => {
            const { beat, notes: notesAtTime } = event;
            const audibleNotes = notesAtTime.filter(n => !n.isRest && !noteIdsToSkip.has(n.id));
            if (audibleNotes.length > 0) {
                const nextEvent = eventsToPlay[index + 1];
                const nextBeat = nextEvent ? nextEvent.beat : endBeat;
                const durationSec = (nextBeat - beat) * beatDurationSec;

                if (selectedMidiOutput) {
                    const delayMs = (beat - currentStartBeat) * beatDurationSec * 1000;
                    const playAtPerformanceTime = performanceStartTime + delayMs;

                    audibleNotes.forEach(note => {
                        const midiNumber = note.midi;
                        const velocity = 127;
                        selectedMidiOutput.send([0x90, midiNumber, velocity], playAtPerformanceTime);
                        selectedMidiOutput.send([0x80, midiNumber, 0], playAtPerformanceTime + durationSec * 1000);
                    });
                } else {
                    const playAtAudioTime = audioStartTime + (beat - currentStartBeat) * beatDurationSec;
                    const audioFiles = audibleNotes.map(n => {
                        const noteNamesWithFlats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
                        const soundingMidi = n.midi - 12; 
                        const noteName = noteNamesWithFlats[soundingMidi % 12];
                        const octave = Math.floor(soundingMidi / 12) - 1;
                        return `${noteName}${octave}`;
                    }).filter(Boolean);
                    audioService.playChord(audioFiles, { when: playAtAudioTime, duration: durationSec });
                }
            }
        });
        
        eventsToPlay.forEach((event) => {
            const { beat, notes: notesAtTime } = event;
            const delayMs = ((beat - currentStartBeat) * beatDurationSec * 1000) + (LOOKAHEAD_SEC * 1000);
            if (delayMs < 0) return;
            const timeoutId = setTimeout(() => { setPlayingNoteIds(notesAtTime.map(n => n.id)); }, delayMs);
            playbackTimeoutsRef.current.push(timeoutId);
        });

        if (isMetronomeOnRef.current) {
            const scheduler = (beat: number) => {
                if (beat >= endBeat) return;
                if (!isMetronomeOnRef.current || !isPlayingRef.current) return;

                const delayMs = ((beat - currentStartBeat) * beatDurationSec * 1000);

                const timeoutId = setTimeout(() => {
                    if (!isMetronomeOnRef.current || !isPlayingRef.current) return;

                    const isStrong = Math.abs(beat % beatsPerMeasure) < 0.001;
                    const playAtAudioTime = audioCtx.currentTime;
                    audioService.playClick(isStrong, playAtAudioTime);
                    
                    setMetronomeFlash(isStrong ? 'strong' : 'weak');
                    const flashOff = setTimeout(() => setMetronomeFlash(null), 100);
                    playbackTimeoutsRef.current.push(flashOff);

                    scheduler(beat + 1);
                }, delayMs);
                playbackTimeoutsRef.current.push(timeoutId);
            };
            scheduler(Math.ceil(currentStartBeat));
        }
    
        const totalDurationMs = ((endBeat - currentStartBeat) * beatDurationSec * 1000) + (LOOKAHEAD_SEC * 1000);
        const endTimeoutId = setTimeout(() => {
            if (isLoopingRef.current && loopRangeRef.current) {
                handlePlay();
            } else {
                handleStop();
            }
        }, totalDurationMs);
        playbackTimeoutsRef.current.push(endTimeoutId);
    
        setIsPlaying(true);
        animationFrameRef.current = requestAnimationFrame(animatePlayhead);
    
    }, [isPlaying, isAudioReady, audioService, bpm, timeSignature, sortedTimeEvents, minMeasureCount, analyzedNotes, selectedNoteIds, layoutData, animatePlayhead, handleStop, selectedMidiOutput, stopStandaloneMetronome]);

    const startStandaloneMetronome = useCallback(() => {
        stopStandaloneMetronome(); // Assicura che non ci siano duplicati
        let beatCount = 0;
        const beatsPerMeasure = timeSignature.numerator;
        const beatDurationMs = (60 / bpm) * 1000;

        metronomeIntervalRef.current = window.setInterval(() => {
            const isStrong = beatCount % beatsPerMeasure === 0;
            if (audioService.audioContext) {
                 audioService.playClick(isStrong, audioService.audioContext.currentTime);
            }
            setMetronomeFlash(isStrong ? 'strong' : 'weak');
            setTimeout(() => setMetronomeFlash(null), 100); // Non tracciare questo timeout
            beatCount = (beatCount + 1) % beatsPerMeasure;
        }, beatDurationMs);

    }, [bpm, timeSignature, audioService, stopStandaloneMetronome]);

    const toggleMetronome = useCallback(() => {
        setIsMetronomeOn(prev => {
            const newState = !prev;
            if (newState && !isPlaying) {
                startStandaloneMetronome();
            } else {
                stopStandaloneMetronome();
            }
            return newState;
        });
    }, [isPlaying, startStandaloneMetronome, stopStandaloneMetronome]);

    useEffect(() => {
        // Questa effect gestisce solo lo stop del metronomo standalone quando inizia la riproduzione.
        if (isPlaying) {
            stopStandaloneMetronome();
        }
    }, [isPlaying, stopStandaloneMetronome]);

    const togglePlayback = useCallback(() => {
        if (isPlaying) handlePause();
        else handlePlay();
    }, [isPlaying, handlePlay, handlePause]);

    const handleWindowMouseMove = useCallback((e: MouseEvent) => {
        if (!dragStartPosRef.current) return;
        
        const { clientX: startX, clientY: startY, systemIndex } = dragStartPosRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        const svg = staffContainerRef.current?.querySelectorAll('svg')[systemIndex];
        if (!svg) return;

        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgPoint = pt.matrixTransform(svg.getScreenCTM()!.inverse());
        
        if (!isActuallyDraggingRef.current && Math.sqrt(dx * dx + dy * dy) > 5) {
            isActuallyDraggingRef.current = true;
            setSelectionRect(prev => ({ ...prev, endX: svgPoint.x, endY: svgPoint.y, isVisible: true }));
        }
    
        if (isActuallyDraggingRef.current) {
            setSelectionRect(prev => ({ ...prev, endX: svgPoint.x, endY: svgPoint.y, isVisible: true }));
        }
    }, []);
    
    const handleWindowMouseUp = useCallback((e: MouseEvent) => {
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
    
        if (isActuallyDraggingRef.current) {
            justDraggedRef.current = true;
            setTimeout(() => { justDraggedRef.current = false; }, 50);
            isActuallyDraggingRef.current = false;
            
            if (dragStartPosRef.current) {
                const { svgStartX, svgStartY, systemIndex } = dragStartPosRef.current;
                
                const svg = staffContainerRef.current?.querySelectorAll('svg')[systemIndex!];
                let svgEndPoint = { x: svgStartX, y: svgStartY };
    
                if (svg) {
                    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
                    svgEndPoint = pt.matrixTransform(svg.getScreenCTM()!.inverse());
                }
    
                const rect = { x: Math.min(svgStartX, svgEndPoint.x), y: Math.min(svgStartY, svgEndPoint.y), width: Math.abs(svgStartX - svgEndPoint.x), height: Math.abs(svgStartY - svgEndPoint.y) };
                
                const getBeatFromX = (x: number, systemIndex: number): number => {
                    const systemParams = layoutData.systemsParams[systemIndex]; if (!systemParams) return 0;
                    let targetMeasureIndex = -1, startMeasureX = 0;
                    for (let i = 0; i < systemParams.measureIndices.length; i++) {
                        const mx = systemParams.startMeasuresX[i], midx = systemParams.measureIndices[i], mw = layoutData.measureFinalWidths.get(midx) || 0;
                        if (x >= mx && x <= mx + mw) { targetMeasureIndex = midx; startMeasureX = mx; break; }
                    }
                    if (targetMeasureIndex === -1) return 0;
                    const width = layoutData.measureFinalWidths.get(targetMeasureIndex) || 100, beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                    const localX = x - startMeasureX, contentWidth = width - (MEASURE_PADDING_X * 2), effectiveX = localX - MEASURE_PADDING_X;
                    let percentage = contentWidth > 0 ? Math.max(0, Math.min(1, effectiveX / contentWidth)) : 0;
                    return (targetMeasureIndex * beatsPerMeasure) + (percentage * beatsPerMeasure);
                };
    
                if (rect.width > 5 || rect.height > 5) {
                    if (isLooping) {
                        const rawStartBeat = getBeatFromX(rect.x, systemIndex!), rawEndBeat = getBeatFromX(rect.x + rect.width, systemIndex!);
                        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                        const getAbsoluteNoteTime = (n: StaffNote) => (n.measureIndex! * beatsPerMeasure) + (n.beat! - 1);
                        const getNoteDuration = (n: StaffNote) => DURATION_VALUES[n.duration || 'quarter'] * (n.isTriplet ? (2/3) : 1) * (n.isDotted ? 1.5 : 1);
                        const rangeStart = Math.min(rawStartBeat, rawEndBeat), rangeEnd = Math.max(rawStartBeat, rawEndBeat);
                        const overlappingNotes = layoutData.positionedNotes.filter(n => {
                            const start = getAbsoluteNoteTime(n), end = start + getNoteDuration(n);
                            return start < rangeEnd - 0.01 && end > rangeStart + 0.01;
                        });
                        if (overlappingNotes.length > 0) {
                            const notesStartingInRange = overlappingNotes.filter(n => getAbsoluteNoteTime(n) >= rangeStart - 0.01);
                            let finalStart = notesStartingInRange.length > 0 ? Math.min(...notesStartingInRange.map(n => getAbsoluteNoteTime(n))) : Math.min(...overlappingNotes.map(n => getAbsoluteNoteTime(n)));
                            const finalEnd = Math.max(...overlappingNotes.map(n => getAbsoluteNoteTime(n) + getNoteDuration(n)));
                            setLoopRange({ startBeat: finalStart, endBeat: finalEnd });
                        } else {
                            setLoopRange({ startBeat: rangeStart, endBeat: rangeEnd });
                        }
                    } else {
                        const selectedIdsInRect = new Set<string>();
                        const systemParams = layoutData.systemsParams[systemIndex!];
                        if(systemParams){
                            const systemNotes = layoutData.positionedNotes.filter(note =>
                                systemParams.measureIndices.includes(note.measureIndex ?? -1)
                            );

                            systemNotes.forEach(note => {
                                const notePos = notePositions.get(note.id);
                                if (notePos) {
                                    if (notePos.x >= rect.x && notePos.x <= rect.x + rect.width &&
                                        notePos.y >= rect.y && notePos.y <= rect.y + rect.height) {
                                        selectedIdsInRect.add(note.id);
                                    }
                                }
                            });
                        }
                        
                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                            setSelectedNoteIds(prev => new Set([...prev, ...selectedIdsInRect]));
                        } else {
                            setSelectedNoteIds(selectedIdsInRect);
                        }
                    }
                }
            }
        }
        
        setSelectionRect(prev => ({ ...prev, isVisible: false }));
        dragStartPosRef.current = null;
    }, [layoutData, handleWindowMouseMove, timeSignature, isLooping, setSelectedNoteIds, notePositions]);

    const handleBackgroundMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>, systemIndex: number) => {
        if (e.button !== 0) return;

        setPasteCaret(null);
        if (!isLooping && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            setSelectedNoteIds(new Set());
        }
    
        const svg = e.currentTarget;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgStartPoint = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    
        setSelectionRect({
            startX: svgStartPoint.x,
            startY: svgStartPoint.y,
            endX: svgStartPoint.x,
            endY: svgStartPoint.y,
            isVisible: false,
            systemIndex,
        });
    
        dragStartPosRef.current = { 
            clientX: e.clientX, 
            clientY: e.clientY, 
            svgStartX: svgStartPoint.x,
            svgStartY: svgStartPoint.y,
            systemIndex, 
        };
        
        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);
    }, [handleWindowMouseMove, handleWindowMouseUp, isLooping]);

    const handleBackgroundClick = useCallback(async (e: React.MouseEvent<SVGSVGElement>, systemIndex: number) => {
        e.stopPropagation();
        if (justDraggedRef.current) return;
        if (isLooping) { setLoopRange(null); return; }

        setPasteCaret(null);
        setSelectedNoteIds(new Set());

        const svg = e.currentTarget;
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const svgPoint = pt.matrixTransform(svg.getScreenCTM()!.inverse());
        const { x: positionX, y: rawY } = svgPoint;

        const systemParams = layoutData.systemsParams[systemIndex];
        if (!systemParams) return;
        let globalMeasureIndex = -1, measureStartX = 0, measureWidth = 0;
        for (let i = 0; i < systemParams.measureIndices.length; i++) {
            const startX = systemParams.startMeasuresX[i]; const mIdx = systemParams.measureIndices[i]; const width = layoutData.measureFinalWidths.get(mIdx) || 0;
            if (positionX >= startX && positionX < startX + width) { globalMeasureIndex = mIdx; measureStartX = startX; measureWidth = width; break; }
        }
        if (globalMeasureIndex === -1) return;
        
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
        const relativeX = positionX - (measureStartX + MEASURE_PADDING_X);
        const clickedBeatRaw = (Math.max(0, Math.min(1, relativeX / contentWidth)) * beatsPerMeasure) + 1;
        
        if (clipboard && clipboard.length > 0) {
            setPasteCaret({ x: positionX, systemIndex, measureIndex: globalMeasureIndex, beat: clickedBeatRaw });
            return;
        }

        const isBassStaffClick = rawY > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2);
        const targetClef: ClefType = isBassStaffClick ? 'bass' : 'treble';
        const expectedVoiceClef = selectedVoice === 3 || selectedVoice === 4 ? 'bass' : 'treble';
        if (targetClef !== expectedVoiceClef) return;

        const notesInTargetMeasureForVoice = rawNotes.filter(
            n => (n.measureIndex ?? 0) === globalMeasureIndex && (n.voice ?? 1) === selectedVoice
        );
        const currentDurationInMeasure = notesInTargetMeasureForVoice.reduce((total, note) => {
            const durationInBeats = DURATION_VALUES[note.duration || 'quarter'] * (note.isTriplet ? (2/3) : 1) * (note.isDotted ? 1.5 : 1);
            return total + durationInBeats;
        }, 0);
        const newElementDuration = DURATION_VALUES[selectedInsertion.duration] * (isTriplet ? (2/3) : 1) * (isDotted ? 1.5 : 1);
        if (currentDurationInMeasure + newElementDuration > beatsPerMeasure + 0.001) {
            console.warn(`Metric validation failed: Measure ${globalMeasureIndex} for voice ${selectedVoice} would exceed capacity.`);
            return; 
        }

        const staffTop = targetClef === 'treble' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP;
        const relativeY = targetClef === 'treble' ? rawY : rawY - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT;
        let position = targetClef === 'bass' ? ((staffTop - relativeY) / (LINE_HEIGHT / 2)) - 2 : ((staffTop + 5 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2);
        
        const diatonicProps = getNotePropertiesFromDiatonicPosition(Math.round(position), targetClef, keySignature);

        let finalBeat = clickedBeatRaw, chordIdToJoin: string | undefined = undefined;
        const SNAP_THRESHOLD_PX = 15;
        const snapTarget = layoutData.positionedNotes.find(n => n.measureIndex === globalMeasureIndex && (n.clef || 'treble') === targetClef && Math.abs((n.xPosition || 0) - positionX) < SNAP_THRESHOLD_PX && (n.voice || 1) === selectedVoice);
        if (snapTarget) { finalBeat = snapTarget.beat!; chordIdToJoin = snapTarget.chordId || snapTarget.id; }
        
        let newElement: StaffNote;

        if (selectedInsertion.type === 'note') {
            const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
            const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
            const keyAlterationAmount = (keySignature.type === 'sharp' && sharpNotes.includes(diatonicProps.pitch)) ? 1 : (keySignature.type === 'flat' && flatNotes.includes(diatonicProps.pitch)) ? -1 : 0;

            let finalNoteProps;

            if (activeAccidental) {
                const naturalMidi = diatonicProps.midi - keyAlterationAmount;
                const accidentalOffset = activeAccidental === 'sharp' ? 1
                    : activeAccidental === 'flat' ? -1
                    : activeAccidental === 'double-sharp' ? 2
                    : activeAccidental === 'double-flat' ? -2
                    : 0;
                const finalMidi = naturalMidi + accidentalOffset;

                finalNoteProps = {
                    pitch: diatonicProps.pitch,
                    octave: diatonicProps.octave,
                    position: diatonicProps.position,
                    midi: finalMidi,
                    noteIndex: finalMidi % 12,
                    clef: targetClef,
                    explicitAccidental: activeAccidental,
                    accidental: activeAccidental,
                    userAccidental: activeAccidental,
                };
            } else {
                finalNoteProps = diatonicProps;
            }

            if (snapTarget) {
                const chordId = snapTarget.chordId || snapTarget.id;
                const notesInChord = analyzedNotes.filter(n => n.measureIndex === globalMeasureIndex && ((n.chordId === chordId) || (n.id === snapTarget.id)));
                if (notesInChord.some(n => n.midi === finalNoteProps.midi)) return;
            }

            newElement = {
                id: crypto.randomUUID(),
                ...finalNoteProps,
                duration: selectedInsertion.duration,
                isRest: false,
                isTriplet,
                isDotted,
                measureIndex: globalMeasureIndex,
                beat: finalBeat,
                chordId: chordIdToJoin,
                clef: targetClef,
                voice: selectedVoice,
            };
            await playNote(newElement);
        } else {
            newElement = {
                id: crypto.randomUUID(),
                pitch: 'B',
                octave: 4,
                position: 8,
                midi: 0,
                noteIndex: 0,
                duration: selectedInsertion.duration,
                isRest: true,
                isTriplet,
                isDotted,
                measureIndex: globalMeasureIndex,
                beat: finalBeat,
                clef: targetClef,
                voice: selectedVoice,
            };
        }
        
        if (isTriplet) {
            setTupletNoteCount(prev => {
                const newCount = prev + 1;
                if (newCount >= 3) {
                    setIsTriplet(false);
                    return 0;
                }
                return newCount;
            });
        }

        setRawNotes(prev => {
            let newNotes = [...prev];
            if (snapTarget && chordIdToJoin === snapTarget.id) { const targetIndex = newNotes.findIndex(n => n.id === snapTarget.id); if (targetIndex > -1) newNotes[targetIndex] = { ...newNotes[targetIndex], chordId: chordIdToJoin }; }
            newNotes.push(newElement);
            return newNotes.sort((a, b) => { const m = (a.measureIndex ?? 0) - (b.measureIndex ?? 0); if (m !== 0) return m; const be = (a.beat ?? 1) - (b.beat ?? 1); if (be !== 0) return be; return (a.voice ?? 1) - (b.voice ?? 1); });
        });
        
        if (activeAccidental) {
            setActiveAccidental(null);
        }
    }, [playNote, selectedInsertion, isTriplet, isDotted, setRawNotes, layoutData, analyzedNotes, isLooping, selectedVoice, activeAccidental, keySignature, timeSignature, rawNotes, clipboard]);
    
    const handleNoteClick = useCallback(async (noteId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setPasteCaret(null);
        const note = analyzedNotes.find(n => n.id === noteId); 
        if (e.detail === 1) { 
            if (note && !note.isRest) await playNote(note); 
        }
        if (e.shiftKey) { 
            setSelectedNoteIds(prev => {
                const newSet = new Set(prev);
                if (newSet.has(noteId)) {
                    newSet.delete(noteId);
                } else {
                    newSet.add(noteId);
                }
                return newSet;
            });
        } else { 
            setSelectedNoteIds(prev => {
                if (prev.size === 1 && prev.has(noteId)) {
                    return new Set<string>();
                }
                return new Set([noteId]);
            });
        }
    }, [analyzedNotes, playNote]);

    const handleFlipStem = useCallback(() => {
        if (selectedNoteIds.size === 0) return;
    
        const selectedRawNotes = rawNotes.filter(n => selectedNoteIds.has(n.id));
        const isAnyTied = selectedRawNotes.some(n => n.isTiedToNext);
    
        if (isAnyTied) {
            // Flip tie direction for tied notes
            setRawNotes(prev => prev.map(note => {
                if (selectedNoteIds.has(note.id) && note.isTiedToNext) {
                    const currentDirection = note.manualTieDirection;
                    let newDirection: 'up' | 'down' | undefined;
                    if (currentDirection === undefined) newDirection = 'up';
                    else if (currentDirection === 'up') newDirection = 'down';
                    else newDirection = undefined;
                    
                    if (newDirection) {
                        return { ...note, manualTieDirection: newDirection };
                    } else {
                        const { manualTieDirection, ...rest } = note;
                        return rest;
                    }
                }
                return note;
            }));
        } else {
            // Original flip stem logic for non-tied notes
            setRawNotes(prev => prev.map(note => {
                if (selectedNoteIds.has(note.id)) {
                    const currentDirection = note.manualStemDirection;
                    let newDirection: 'up' | 'down' | undefined;
                    if (currentDirection === undefined) newDirection = 'up';
                    else if (currentDirection === 'up') newDirection = 'down';
                    else newDirection = undefined;
                    
                    if (newDirection) {
                        return { ...note, manualStemDirection: newDirection };
                    } else {
                        const { manualStemDirection, ...rest } = note;
                        return rest;
                    }
                }
                return note;
            }));
        }
    }, [selectedNoteIds, rawNotes, setRawNotes]);
    
    const handleToggleTie = useCallback(() => {
        if (selectedNoteIds.size === 0) return;
    
        const notesWithIndices = notes.map((note, index) => ({ note, index }));
    
        setRawNotes(prevRawNotes => {
            return prevRawNotes.map(rawNote => {
                if (selectedNoteIds.has(rawNote.id)) {
                    const noteInfo = notesWithIndices.find(({ note }) => note.id === rawNote.id);
                    if (!noteInfo || noteInfo.note.isRest) return rawNote;

                    const { note: currentNote, index: currentIndex } = noteInfo;

                    let nextNote: StaffNote | undefined = undefined;
                    for (let i = currentIndex + 1; i < notes.length; i++) {
                        if (notes[i].voice === currentNote.voice) {
                            nextNote = notes[i];
                            break;
                        }
                    }

                    if (nextNote && !nextNote.isRest && nextNote.midi === currentNote.midi) {
                         if (rawNote.isTiedToNext) {
                            const { isTiedToNext, ...rest } = rawNote;
                            return rest;
                        } else {
                            return { ...rawNote, isTiedToNext: true };
                        }
                    }
                }
                return rawNote;
            });
        });
    }, [selectedNoteIds, setRawNotes, notes]);

    const pasteNotes = useCallback((anchorMeasureIndex: number, anchorBeat: number) => {
        if (!clipboard || clipboard.length === 0) return;
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
    
        const firstNoteInClipboard = clipboard[0];
        const startBeatInClipboard = (firstNoteInClipboard.measureIndex ?? 0) * beatsPerMeasure + (firstNoteInClipboard.beat ?? 1);
        
        const idMap = new Map<string, string>();
        clipboard.forEach(note => idMap.set(note.id, crypto.randomUUID()));
    
        const newNotes: StaffNote[] = clipboard.map(note => {
            const newId = idMap.get(note.id)!;
    
            const absoluteBeatInClipboard = (note.measureIndex ?? 0) * beatsPerMeasure + (note.beat ?? 1);
            const beatOffset = absoluteBeatInClipboard - startBeatInClipboard;
            const targetAbsoluteBeat = (anchorMeasureIndex * beatsPerMeasure) + anchorBeat + beatOffset;
    
            const newMeasureIndex = Math.floor((targetAbsoluteBeat - 1) / beatsPerMeasure);
            const newBeat = ((targetAbsoluteBeat - 1) % beatsPerMeasure) + 1;
            
            const { xPosition, ...noteToPaste } = note;
    
            return { ...noteToPaste, id: newId, measureIndex: newMeasureIndex, beat: newBeat, };
        });
    
        newNotes.forEach(note => {
            if (note.chordId && idMap.has(note.chordId)) note.chordId = idMap.get(note.chordId);
            if (note.manualBeamGroupId && idMap.has(note.manualBeamGroupId)) note.manualBeamGroupId = idMap.get(note.manualBeamGroupId);
        });
    
        let maxBeatInClipboard = 0;
        clipboard.forEach(note => {
            const duration = DURATION_VALUES[note.duration || 'quarter'] * (note.isTriplet ? (2/3) : 1) * (note.isDotted ? 1.5 : 1);
            const noteEndBeat = (note.measureIndex ?? 0) * beatsPerMeasure + (note.beat ?? 1) + duration;
            if (noteEndBeat > maxBeatInClipboard) maxBeatInClipboard = noteEndBeat;
        });
    
        const pasteDuration = maxBeatInClipboard - startBeatInClipboard;
        const voicesInClipboard = new Set(clipboard.map(n => n.voice || 1));
        const startAbsoluteBeat = anchorMeasureIndex * beatsPerMeasure + anchorBeat;
        const endAbsoluteBeat = startAbsoluteBeat + pasteDuration;
    
        setRawNotes(prev => {
            const notesToKeep = prev.filter(note => {
                if (!voicesInClipboard.has(note.voice || 1)) return true;
                const noteAbsoluteStart = (note.measureIndex ?? 0) * beatsPerMeasure + (note.beat ?? 1);
                const duration = DURATION_VALUES[note.duration || 'quarter'] * (note.isTriplet ? (2/3) : 1) * (note.isDotted ? 1.5 : 1);
                const noteAbsoluteEnd = noteAbsoluteStart + duration;
                return !(noteAbsoluteStart < endAbsoluteBeat && noteAbsoluteEnd > startAbsoluteBeat);
            });
    
            return [...notesToKeep, ...newNotes];
        });
    }, [clipboard, timeSignature, setRawNotes]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isActive) return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || bpmControlRef.current === document.activeElement) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            setSelectedNoteIds(new Set());
            setPasteCaret(null);
            setClipboard(null);
            return;
        }
        
        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') { 
                e.preventDefault(); 
                undoNotes(); 
                return; 
            } else if (e.key.toLowerCase() === 'a') {
                e.preventDefault();
                const allNoteIds = analyzedNotes.map(n => n.id);
                setSelectedNoteIds(new Set(allNoteIds));
                return;
            } else if (e.key.toLowerCase() === 'c') {
                e.preventDefault();
                if (selectedNoteIds.size === 0) return;
                const notesToCopy = rawNotes.filter(n => selectedNoteIds.has(n.id));
                notesToCopy.sort((a,b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || (a.beat ?? 1) - (b.beat ?? 1));
                setClipboard(notesToCopy);
                setPasteCaret(null);
                return;
            } else if (e.key.toLowerCase() === 'v') {
                e.preventDefault();
                if (!clipboard || clipboard.length === 0) return;
        
                let anchor: { measureIndex: number, beat: number } | null = null;
        
                if (selectedNoteIds.size > 0) {
                    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
                    if (selectedNotes.length > 0) {
                        selectedNotes.sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || (a.beat ?? 0) - (b.beat ?? 0));
                        const firstSelectedNote = selectedNotes[0];
                        anchor = { measureIndex: firstSelectedNote.measureIndex ?? 0, beat: firstSelectedNote.beat ?? 1 };
                    }
                } else if (pasteCaret) {
                    anchor = { measureIndex: pasteCaret.measureIndex, beat: pasteCaret.beat };
                }
        
                if (anchor) {
                    pasteNotes(anchor.measureIndex, anchor.beat);
                    setSelectedNoteIds(new Set());
                    setPasteCaret(null);
                    // setClipboard(null); // This was preventing multiple pastes
                }
                return;
            }

            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();

                const notesToMoveIds = Array.from(selectedNoteIds);
                if (notesToMoveIds.length === 0) return;

                const notesToMove = rawNotes
                    .filter(n => notesToMoveIds.includes(n.id))
                    .sort((a, b) => rawNotes.indexOf(a) - rawNotes.indexOf(b));
                
                if (notesToMove.length === 0) return;

                const firstVoice = notesToMove[0].voice;
                const allSameVoice = notesToMove.every(n => n.voice === firstVoice);
                if (!allSameVoice) return;

                const firstNoteIndexInRaw = rawNotes.indexOf(notesToMove[0]);
                const isContiguous = notesToMove.every((note, i) => rawNotes.indexOf(note) === firstNoteIndexInRaw + i);
                if (!isContiguous) return;

                const newNotes = [...rawNotes];
                const blockLength = notesToMove.length;
                const blockStartIndex = firstNoteIndexInRaw;

                if (e.key === 'ArrowRight') {
                    const noteAfterIndex = blockStartIndex + blockLength;
                    const noteAfter = newNotes[noteAfterIndex];
                    
                    if (noteAfter && noteAfter.voice === firstVoice) {
                        const block = newNotes.splice(blockStartIndex, blockLength);
                        newNotes.splice(blockStartIndex + 1, 0, ...block);
                        setRawNotes(newNotes);
                    }
                } else { // ArrowLeft
                    const noteBeforeIndex = blockStartIndex - 1;
                    const noteBefore = newNotes[noteBeforeIndex];

                    if (noteBefore && noteBefore.voice === firstVoice) {
                        const block = newNotes.splice(blockStartIndex, blockLength);
                        newNotes.splice(blockStartIndex - 1, 0, ...block);
                        setRawNotes(newNotes);
                    }
                }
            }
            return; 
        }

        if (e.key.toLowerCase() === 'v') {
            e.preventDefault();
            setSelectedVoice(v => (v === 1 ? 4 : v - 1) as Voice);
            return;
        }
        
        if (e.key === '#' || e.key === 'à') {
            e.preventDefault();
            setActiveAccidental(prev => {
                if (prev === 'sharp') return 'double-sharp';
                if (prev === 'double-sharp') return null;
                return 'double-sharp';
            });
            return;
        }

        if (e.key === 'b') {
            e.preventDefault();
            setActiveAccidental(prev => {
                if (prev === 'flat') return 'double-flat';
                if (prev === 'double-flat') return null;
                return 'flat';
            });
            return;
        }

        if (e.key.toLowerCase() === 'n') {
            e.preventDefault();
            setActiveAccidental(prev => prev === 'natural' ? null : 'natural');
            return;
        }

        const durationKeyMap: { [key: string]: NoteDuration } = { '1': 'whole', '2': 'half', '3': 'quarter', '4': 'eighth', '5': 'sixteenth', '6': 'thirty-second', '7': 'sixty-fourth' };
        if (durationKeyMap[e.key] && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setSelectedInsertion(prev => ({ ...prev, duration: durationKeyMap[e.key] })); return; }
        if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
        if (e.code === 'Enter') { e.preventDefault(); handleStop(); }
        if (e.key === 'k' || e.key === 'K') { e.preventDefault(); toggleMetronome(); }
        if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setIsLooping(prev => !prev); }
        if (selectedNoteIds.size > 0) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                setRawNotes(prev => {
                    const updatedNotes = prev.map(note => {
                        if (selectedNoteIds.has(note.id)) {
                            if (!note.isRest) {
                                // Replace note with a rest
                                return {
                                    ...note,
                                    id: crypto.randomUUID(),
                                    isRest: true,
                                    pitch: 'B',
                                    octave: 4,
                                    position: 8,
                                    midi: 0,
                                    noteIndex: 0,
                                };
                            } else {
                                // Mark rest for removal
                                return null;
                            }
                        }
                        return note;
                    });

                    // Filter out null values (deleted rests)
                    return updatedNotes.filter(note => note !== null);
                });
                setSelectedNoteIds(new Set());
            } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
                e.preventDefault();
                const direction = e.key === 'ArrowUp' ? 1 : -1;
                setRawNotes(prevNotes => {
                    const newNotes = [...prevNotes];
            
                    selectedNoteIds.forEach(id => {
                        const noteIndex = newNotes.findIndex(n => n.id === id);
                        if (noteIndex === -1 || newNotes[noteIndex].isRest) return;
                        
                        const note = newNotes[noteIndex];
            
                        // Break ties involving this note
                        if (note.isTiedToNext) delete newNotes[noteIndex].isTiedToNext;
                        const fullSortedNotes = calculateNoteBeats(prevNotes, timeSignature);
                        const currentSortedIndex = fullSortedNotes.findIndex(n => n.id === id);
                        let prevNoteInVoice: StaffNote | undefined;
                        for(let i = currentSortedIndex - 1; i >= 0; i--) {
                            if(fullSortedNotes[i].voice === note.voice) {
                                prevNoteInVoice = fullSortedNotes[i];
                                break;
                            }
                        }
                        if (prevNoteInVoice) {
                            const prevNoteRawIndex = newNotes.findIndex(n => n.id === prevNoteInVoice!.id);
                            if (prevNoteRawIndex > -1 && newNotes[prevNoteRawIndex].isTiedToNext) {
                                delete newNotes[prevNoteRawIndex].isTiedToNext;
                            }
                        }
            
                        // Apply pitch change
                        const newMidi = note.midi + direction;
                        const newProps = getNotePropertiesFromMidi(newMidi, keySignature, note.clef || 'treble', null);
                        newNotes[noteIndex] = { ...note, ...newProps };
                    });
                    return newNotes;
                });
            }
        }
    }, [isActive, selectedNoteIds, setRawNotes, rawNotes, setSelectedNoteIds, keySignature, undoNotes, togglePlayback, handleStop, setSelectedInsertion, setSelectedVoice, setIsLooping, activeAccidental, timeSignature, toggleMetronome, analyzedNotes, clipboard, pasteCaret, pasteNotes, notes, setClipboard]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const durations: { duration: NoteDuration; label: string; NoteIcon: React.FC; RestIcon: React.FC; }[] = useMemo(() => [
        { duration: 'whole', label: 'Semibreve', NoteIcon: WholeNoteIcon, RestIcon: WholeRestIcon }, { duration: 'half', label: 'Minima', NoteIcon: HalfNoteIcon, RestIcon: HalfRestIcon },
        { duration: 'quarter', label: 'Semiminima', NoteIcon: QuarterNoteIcon, RestIcon: QuarterRestIcon }, { duration: 'eighth', label: 'Croma', NoteIcon: EighthNoteIcon, RestIcon: EighthRestIcon },
        { duration: 'sixteenth', label: 'Semicroma', NoteIcon: SixteenthNoteIcon, RestIcon: SixteenthRestIcon }, { duration: 'thirty-second', label: 'Biscroma', NoteIcon: ThirtySecondNoteIcon, RestIcon: ThirtySecondRestIcon },
        { duration: 'sixty-fourth', label: 'Semibiscroma', NoteIcon: SixtyFourthNoteIcon, RestIcon: SixtyFourthRestIcon },
    ], []);

    const commitBpm = (val: string) => { let finalBpm = parseInt(val, 10); if (!isNaN(finalBpm)) { setBpm(Math.max(40, Math.min(240, finalBpm))); } };
    const handleBpmKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (bpmInputTimeoutRef.current) clearTimeout(bpmInputTimeoutRef.current);
        if (e.key === 'ArrowUp') { e.preventDefault(); setBpmInputString(''); setBpm(b => Math.min(240, b + 1)); } 
        else if (e.key === 'ArrowDown') { e.preventDefault(); setBpmInputString(''); setBpm(b => Math.max(40, b - 1)); } 
        else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); if (bpmInputString) commitBpm(bpmInputString); setBpmInputString(''); bpmControlRef.current?.blur(); } 
        else if (e.key >= '0' && e.key <= '9') {
            e.preventDefault(); const newString = bpmInputString + e.key; let newNum = parseInt(newString, 10);
            if (newNum > 240) { setBpmInputString(e.key); setBpm(parseInt(e.key, 10)); } else { setBpmInputString(newString); setBpm(newNum); }
            bpmInputTimeoutRef.current = setTimeout(() => { commitBpm(newString); setBpmInputString(''); }, 1200);
        }
    };
    const handleBpmBlur = () => { setIsBpmActive(false); if (bpmInputTimeoutRef.current) clearTimeout(bpmInputTimeoutRef.current); if (bpmInputString) commitBpm(bpmInputString); setBpmInputString(''); };
    const handleDeselectOnClickOutside = (e: React.MouseEvent) => { if (justDraggedRef.current) return; if (e.target === e.currentTarget) setSelectedNoteIds(new Set()); };
    const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>, systemIndex: number) => {
        if (isActuallyDraggingRef.current) { setGhostNote(null); return; }

        const svg = e.currentTarget;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgPoint = pt.matrixTransform(svg.getScreenCTM()!.inverse());
        const { x: positionX, y: rawY } = svgPoint;

        const isBassStaffClick = rawY > (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT / 2);
        const targetClef: ClefType = isBassStaffClick ? 'bass' : 'treble';
        const expectedVoiceClef = selectedVoice === 3 || selectedVoice === 4 ? 'bass' : 'treble';
        if (targetClef !== expectedVoiceClef) { setGhostNote(null); return; }

        const staffTop = targetClef === 'treble' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP;
        const relativeY = targetClef === 'treble' ? rawY : rawY - TOP_STAFF_HEIGHT - CONNECTOR_HEIGHT;
        let position = targetClef === 'bass' ? ((staffTop - relativeY) / (LINE_HEIGHT / 2)) - 2 : ((staffTop + 5 * LINE_HEIGHT) - relativeY) / (LINE_HEIGHT / 2);
        
        const diatonicProps = getNotePropertiesFromDiatonicPosition(Math.round(position), targetClef, keySignature);

        if (selectedInsertion.type === 'rest') {
            const ghost: StaffNote & { systemIndex: number } = {
                id: 'ghost',
                pitch: 'B',
                octave: 4,
                position: 8,
                midi: 0,
                noteIndex: 0,
                duration: selectedInsertion.duration,
                isRest: true,
                isTriplet,
                isDotted,
                xPosition: positionX,
                clef: targetClef,
                voice: selectedVoice,
                systemIndex,
            };
            setGhostNote(ghost);
            return;
        }

        const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
        const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);
        const keyAlterationAmount = (keySignature.type === 'sharp' && sharpNotes.includes(diatonicProps.pitch))
        ? 1
        : (keySignature.type === 'flat' && flatNotes.includes(diatonicProps.pitch)) ? -1 : 0;

        let finalNoteProps;

        if (activeAccidental) {
            const naturalMidi = diatonicProps.midi - keyAlterationAmount;
            const accidentalOffset = activeAccidental === 'sharp' ? 1
                : activeAccidental === 'flat' ? -1
                : activeAccidental === 'double-sharp' ? 2
                : activeAccidental === 'double-flat' ? -2
                : 0;
            const finalMidi = naturalMidi + accidentalOffset;

            finalNoteProps = {
                pitch: diatonicProps.pitch,
                octave: diatonicProps.octave,
                position: diatonicProps.position,
                midi: finalMidi,
                noteIndex: finalMidi % 12,
                clef: targetClef,
                explicitAccidental: activeAccidental,
                accidental: activeAccidental,
                userAccidental: activeAccidental,
            };
        } else {
            finalNoteProps = diatonicProps;
        }

        const ghost: StaffNote & { systemIndex: number } = {
            id: 'ghost',
            ...finalNoteProps,
            duration: selectedInsertion.duration,
            isRest: false,
            isTriplet,
            isDotted,
            xPosition: positionX,
            voice: selectedVoice,
            systemIndex,
            manualStemDirection: selectedVoice === 1 || selectedVoice === 3 ? 'up' : 'down', // Updated to use manualStemDirection
        };
        setGhostNote(ghost);
    }, [selectedInsertion, isTriplet, isDotted, keySignature, activeAccidental, selectedVoice]);
    
    const handleMouseLeave = useCallback(() => { setGhostNote(null); }, []);

    const selectedNotesBeamState = useMemo(() => {
        const beamableNotes = rawNotes.filter(n => selectedNoteIds.has(n.id) && !n.isRest && DURATION_VALUES[n.duration || 'quarter'] <= 0.5);
        if (beamableNotes.length < 2) return 'unbeamable';
        const firstGroupId = beamableNotes[0].manualBeamGroupId;
        if (firstGroupId && beamableNotes.every(n => n.manualBeamGroupId === firstGroupId)) return 'beamed';
        return beamableNotes.some(n => n.manualBeamGroupId) ? 'mixed' : 'unbeamed';
    }, [selectedNoteIds, rawNotes]);

    const handleToggleBeamGroup = useCallback(() => {
        if (selectedNotesBeamState === 'unbeamable') return;
        if (selectedNotesBeamState === 'beamed') {
            setRawNotes(prev => prev.map(note => {
                if (selectedNoteIds.has(note.id)) {
                    const { manualBeamGroupId, ...rest } = note;
                    return rest;
                }
                return note;
            }));
        } else {
            const newGroupId = crypto.randomUUID();
            setRawNotes(prev => prev.map(note => 
                selectedNoteIds.has(note.id) ? { ...note, manualBeamGroupId: newGroupId } : note
            ));
        }
    }, [selectedNotesBeamState, selectedNoteIds, setRawNotes]);

    const loopHighlightRegions = useMemo(() => {
        if (!isLooping || !loopRange || !layoutData) return [];
        
        const regions: { systemIndex: number, x: number, width: number }[] = [];
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const { startBeat, endBeat } = loopRange;

        layoutData.systemsParams.forEach((system, sysIndex) => {
            if (system.measureIndices.length === 0) return;
            
            const sysStartMeasure = system.measureIndices[0];
            const sysEndMeasure = system.measureIndices[system.measureIndices.length - 1];
            
            const sysStartBeat = sysStartMeasure * beatsPerMeasure;
            const sysEndBeat = (sysEndMeasure + 1) * beatsPerMeasure;

            if (endBeat > sysStartBeat && startBeat < sysEndBeat) {
                let startX = system.startMeasuresX[0];
                const startMeasureIndex = Math.floor(Math.max(startBeat, sysStartBeat) / beatsPerMeasure);
                const startMeasureBeat = Math.max(startBeat, sysStartBeat) % beatsPerMeasure;
                
                if (system.measureIndices.includes(startMeasureIndex)) {
                    const mIndexInSys = system.measureIndices.indexOf(startMeasureIndex);
                    const mStartX = system.startMeasuresX[mIndexInSys];
                    const mWidth = layoutData.measureFinalWidths.get(startMeasureIndex) || 0;
                    const contentWidth = mWidth - (MEASURE_PADDING_X * 2);
                    startX = mStartX + MEASURE_PADDING_X + (startMeasureBeat / beatsPerMeasure) * contentWidth;
                }

                let endX = system.startMeasuresX[system.startMeasuresX.length - 1] + (layoutData.measureFinalWidths.get(sysEndMeasure) || 0);
                
                if (endBeat < sysEndBeat) {
                    // FIX: Define endMeasureIndex and endMeasureBeat, and handle edge case for barlines.
                    const endMeasureIndex = Math.floor(endBeat / beatsPerMeasure);
                    const endMeasureBeat = endBeat % beatsPerMeasure;
                    
                    if (Math.abs(endMeasureBeat) < 0.001 && endBeat > 0) {
                        const prevMeasureIndex = endMeasureIndex - 1;
                        if (system.measureIndices.includes(prevMeasureIndex)) {
                            const mIndexInSys = system.measureIndices.indexOf(prevMeasureIndex);
                            const mStartX = system.startMeasuresX[mIndexInSys];
                            const mWidth = layoutData.measureFinalWidths.get(prevMeasureIndex) || 0;
                            endX = mStartX + mWidth;
                        }
                    } else if (system.measureIndices.includes(endMeasureIndex)) {
                        const mIndexInSys = system.measureIndices.indexOf(endMeasureIndex);
                        const mStartX = system.startMeasuresX[mIndexInSys];
                        const mWidth = layoutData.measureFinalWidths.get(endMeasureIndex) || 0;
                        const contentWidth = mWidth - (MEASURE_PADDING_X * 2);
                        endX = mStartX + MEASURE_PADDING_X + (endMeasureBeat / beatsPerMeasure) * contentWidth;
                    }
                }

                regions.push({
                    systemIndex: sysIndex,
                    x: startX,
                    width: Math.max(0, endX - startX)
                });
            }
        });
        return regions;
    }, [isLooping, loopRange, layoutData, timeSignature]);

    const rectForRender = useMemo(() => {
        if (!selectionRect.isVisible) return null;
        return {
            x: Math.min(selectionRect.startX, selectionRect.endX),
            y: Math.min(selectionRect.startY, selectionRect.endY),
            width: Math.abs(selectionRect.startX - selectionRect.endX),
            height: Math.abs(selectionRect.startY - selectionRect.endY),
        };
    }, [selectionRect]);

     if (!isActive) return null;

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
                        const systemNoteIds = new Set(layoutData.positionedNotes.filter(note => new Set(system.measureIndices).has(note.measureIndex ?? -1)).map(n => n.id));
                        const systemErrorConnections = errorConnections.filter(conn => systemNoteIds.has(conn.noteId1) && systemNoteIds.has(conn.noteId2));
                        const systemNotes = layoutData.positionedNotes.filter(note => new Set(system.measureIndices).has(note.measureIndex ?? -1));
                        const barlines = layoutData.systemsBarlines[systemIndex];
                        const actualSystemWidth = system.width;
                        const primaryColor = 'black';
                        
                        const playheadTop = TOP_STAFF_TOP;
                        const playheadHeight = (TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP + STAFF_LINES_HEIGHT) - TOP_STAFF_TOP;
                        
                        const systemLoopRegions = loopHighlightRegions.filter(region => region.systemIndex === systemIndex);
                        const isViolationHovered = (connection: ErrorConnection) => hoveredViolationNotes ? hoveredViolationNotes.includes(connection.noteId1) && hoveredViolationNotes.includes(connection.noteId2) : false;

                        const currentBeamedNoteIds = beamedNoteIdsBySystem[systemIndex] || new Set();

                        return (
                            <div key={`system-${systemIndex}`} className={`relative ${viewMode === 'page' ? 'mb-8' : 'mb-0'}`} style={{ width: actualSystemWidth, height: TOTAL_SYSTEM_HEIGHT }}>
                                <GrandStaffBrace height={TOTAL_SYSTEM_HEIGHT} />
                                 {contextMarkers.filter(m => m.systemIndex === systemIndex).map((marker, idx) => (
                                    <div key={`marker-${idx}`} className="absolute text-sm font-bold text-blue-500 pointer-events-none" style={{ left: marker.x, top: TOP_STAFF_TOP - 30 }}>
                                        {marker.label}
                                    </div>
                                ))}
                                {systemLoopRegions.map((r, idx) => (
                                    <div key={`loop-region-${idx}`} className="absolute bg-green-500/20 z-0 pointer-events-none" style={{ left: r.x, width: r.width, top: 0, bottom: 0 }} />
                                ))}
                                {playheadPosition?.systemIndex === systemIndex && isPlaying && (
                                    <div className="absolute w-0.5 bg-red-500/80 pointer-events-none z-30" style={{ transform: `translateX(${playheadPosition.x}px)`, top: playheadTop, height: playheadHeight }} />
                                )}
                                {pasteCaret?.systemIndex === systemIndex && (
                                    <div 
                                        className="absolute w-0.5 bg-blue-500 pointer-events-none z-30"
                                        style={{
                                            transform: `translateX(${pasteCaret.x}px)`,
                                            top: TOP_STAFF_TOP,
                                            height: playheadHeight
                                        }}
                                    />
                                )}
                                <svg 
                                    width={actualSystemWidth} 
                                    height={TOTAL_SYSTEM_HEIGHT} 
                                    viewBox={`0 0 ${actualSystemWidth} ${TOTAL_SYSTEM_HEIGHT}`} 
                                    className={`absolute top-0 left-0 ${isLooping || clipboard ? 'cursor-crosshair' : ''}`} 
                                    onMouseDown={(e) => handleBackgroundMouseDown(e, systemIndex)} 
                                    onClick={(e) => handleBackgroundClick(e, systemIndex)}
                                    onMouseMove={(e) => handleMouseMove(e, systemIndex)}
                                    onMouseLeave={handleMouseLeave}
                                >
                                    <rect x="0" y="0" width={actualSystemWidth} height={TOTAL_SYSTEM_HEIGHT} fill="transparent" />
                                    {rectForRender && selectionRect.systemIndex === systemIndex && (
                                        <rect x={rectForRender.x} y={rectForRender.y} width={rectForRender.width} height={rectForRender.height} fill={isLooping ? 'rgb(34, 197, 94)' : 'rgb(56, 189, 248)'} fillOpacity="0.2" stroke={isLooping ? 'rgb(34, 197, 94)' : 'rgb(56, 189, 248)'} strokeWidth="1" />
                                    )}
                                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-20" preserveAspectRatio="none">
                                        {systemErrorConnections.map((conn, index) => {
                                            const pos1 = notePositions.get(conn.noteId1);
                                            const pos2 = notePositions.get(conn.noteId2);

                                            const conn_notes = [conn.noteId1, conn.noteId2];
                                            let violationForConnection = violations.find(v => {
                                                const vSet = new Set(v.noteIds);
                                                const cSet = new Set(conn_notes);
                                                if(vSet.size !== cSet.size) return false;
                                                for(const id of cSet) if(!vSet.has(id)) return false;
                                                return true;
                                            });
                                            
                                            if (!violationForConnection) {
                                                const relatedViolations = violations.filter(v => 
                                                    v.noteIds.includes(conn.noteId1) || v.noteIds.includes(conn.noteId2)
                                                );
                                                if(relatedViolations.length > 0) {
                                                    const severityOrder = { 'exception': 0, 'warning': 1, 'error': 2 };
                                                    violationForConnection = relatedViolations.reduce((max, current) => 
                                                        severityOrder[current.severity] > severityOrder[max.severity] ? current : max
                                                    );
                                                }
                                            }

                                            let strokeColor = 'rgb(239, 68, 68)';
                                            if (violationForConnection) {
                                                switch(violationForConnection.severity) {
                                                    case 'warning': strokeColor = 'rgb(251, 146, 60)'; break;
                                                    case 'exception': strokeColor = 'rgb(34, 197, 94)'; break;
                                                    case 'error':
                                                    default: strokeColor = 'rgb(239, 68, 68)'; break;
                                                }
                                            }

                                            const isHovered = isViolationHovered(conn);
                                            if (pos1 && pos2) {
                                                if (conn.type === 'vertical') {
                                                    return <line key={`error-line-${index}`} x1={pos1.x} y1={pos1.y} x2={pos2.x} y2={pos2.y} stroke={strokeColor} strokeWidth={isHovered ? 3 : 1.5} style={{ transition: 'stroke-width 0.2s' }} />;
                                                } else { // horizontal
                                                    const midX = (pos1.x + pos2.x) / 2;
                                                    const pathData = `M ${pos1.x} ${pos1.y} H ${midX} V ${pos2.y} H ${pos2.x}`;
                                                    return <path key={`error-path-${index}`} d={pathData} stroke={strokeColor} strokeWidth={isHovered ? 3 : 1.5} fill="none" strokeDasharray="4 2" style={{ transition: 'stroke-width 0.2s' }} />;
                                                }
                                            }
                                            return null;
                                        })}
                                    </svg>
                                    {tiePathsBySystem[systemIndex]}
                                    {Array.from({ length: 5 }).map((_, i) => <line key={`t-line-${i}`} x1="10" y1={TOP_STAFF_TOP + i * LINE_HEIGHT} x2={actualSystemWidth - 10} y2={TOP_STAFF_TOP + i * LINE_HEIGHT} stroke="gray" strokeWidth="1" />)}
                                    {Array.from({ length: 5 }).map((_, i) => <line key={`b-line-${i}`} x1="10" y1={TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP + i * LINE_HEIGHT} x2={actualSystemWidth - 10} y2={TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP + i * LINE_HEIGHT} stroke="gray" strokeWidth="1" />)}
                                    { (systemIndex === 0 || viewMode === 'linear') && <g> 
                                        <text x="30" y={TOP_STAFF_TOP + 4.6 * LINE_HEIGHT} fontSize="100" fontFamily="serif" fill={primaryColor} textAnchor="middle">𝄞</text> 
                                        <text x="30" y={TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP + 3.9 * LINE_HEIGHT} fontSize="80" fontFamily="serif" fill={primaryColor} textAnchor="middle">𝄢</text>
                                        <KeySignatureDisplay signature={keySignature} color={primaryColor} clef='treble' staffTop={TOP_STAFF_TOP} />
                                        <KeySignatureDisplay signature={keySignature} color={primaryColor} clef='bass' staffTop={TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP} />
                                        {timeSignature && <g>
                                            <TimeSignatureDisplay signature={timeSignature} x={START_X + (keySignature.count * 14) + 15} color={primaryColor} staffTop={TOP_STAFF_TOP} />
                                            <TimeSignatureDisplay signature={timeSignature} x={START_X + (keySignature.count * 14) + 15} color={primaryColor} staffTop={TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP} />
                                        </g>}
                                    </g> }
                                    {barlines.map(bar => {
                                        const measureIndex = parseInt(bar.id.split('-')[1]);
                                        return (
                                            <line
                                                key={bar.id}
                                                x1={bar.xPosition} y1={TOP_STAFF_TOP}
                                                x2={bar.xPosition} y2={TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP + 4 * LINE_HEIGHT}
                                                stroke="black" strokeWidth="1.5"
                                                onContextMenu={(e) => handleBarlineRightClick(e, measureIndex)}
                                                className="cursor-pointer hover:stroke-blue-500"
                                            />
                                        );
                                    })}
                                    {tripletGroupsBySystem[systemIndex]?.map(group => {
                                        return (
                                            <g key={group.id} className="pointer-events-none">
                                                <path d={`M ${group.x1},${group.bracketY} Q ${group.midX},${group.bracketY - group.curveHeight} ${group.x2},${group.bracketY}`} fill="none" stroke="black" strokeWidth="1.5" />
                                                <text x={group.midX} y={group.textY} textAnchor="middle" dominantBaseline="middle" fontSize="14" fontWeight="bold" fill="black">3</text>
                                            </g>
                                        )
                                    })}
                                    {beamGroupsBySystem[systemIndex]?.map((group, groupIndex) => {
                                        if (group.length < 2) return null;
                                        const firstNote = group[0];
                                        const lastNote = group[group.length - 1];
                                        const isTreble = firstNote.clef !== 'bass';
                                        const staffTop = isTreble ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP;
                                        const yOffset = isTreble ? 0 : TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT;
                                        
                                        let isGroupStemUp: boolean;
                                        if (firstNote.manualStemDirection) {
                                            isGroupStemUp = firstNote.manualStemDirection === 'up';
                                        } else {
                                            const firstNoteVoice = firstNote.voice;
                                            if (firstNoteVoice === 1 || firstNoteVoice === 3) {
                                                isGroupStemUp = true;
                                            } else if (firstNoteVoice === 2 || firstNoteVoice === 4) {
                                                isGroupStemUp = false;
                                            } else {
                                                const middleLinePos = isTreble ? 6 : -2;
                                                const avgPos = group.reduce((sum, n) => sum + n.position, 0) / group.length;
                                                isGroupStemUp = avgPos < middleLinePos;
                                            }
                                        }

                                        const STEM_LENGTH = 35;
                                        const BEAM_THICKNESS = 4;
                                        const getStemProps = (note: StaffNote) => {
                                            const x = note.xPosition || 0; // Ensure xPosition is defined
                                            const y = getNoteY(note.position, staffTop, note.clef || 'treble');
                                            const stemX = x + (isGroupStemUp ? NOTE_HEAD_RX_NORMAL - 1.5 : -(NOTE_HEAD_RX_NORMAL - 1.5));
                                            return { stemX, y };
                                        };

                                        const firstNoteProps = getStemProps(firstNote);
                                        const lastNoteProps = getStemProps(lastNote);
                                        const firstNoteStemEndY = isGroupStemUp ? firstNoteProps.y - STEM_LENGTH : firstNoteProps.y + STEM_LENGTH;
                                        const lastNoteStemEndY = isGroupStemUp ? lastNoteProps.y - STEM_LENGTH : lastNoteProps.y + STEM_LENGTH;
                                        const getBeamCount = (d: NoteDuration) => (d === 'eighth' ? 1 : d === 'sixteenth' ? 2 : d === 'thirty-second' ? 3 : d === 'sixty-fourth' ? 4 : 0);
                                        const maxBeams = Math.max(...group.map(n => getBeamCount(n.duration!)));
                                        return (
                                            <g key={`beam-group-${groupIndex}`} transform={`translate(0, ${yOffset})`}>
                                                {group.map(note => {
                                                    const { stemX, y } = getStemProps(note);
                                                    const ratio = (group.length > 1 && lastNoteProps.stemX !== firstNoteProps.stemX) ? (stemX - firstNoteProps.stemX) / (lastNoteProps.stemX - firstNoteProps.stemX || 1) :  0;
                                                    const stemEndY = firstNoteStemEndY + (lastNoteStemEndY - firstNoteStemEndY) * ratio;
                                                    return <line key={`stem-${note.id}`} x1={stemX} y1={y} x2={stemX} y2={stemEndY} stroke="black" strokeWidth="1.5" />;
                                                })}
                                                {Array.from({ length: maxBeams }).map((_, beamLevel) => {
                                                    const beamYDirection = isGroupStemUp ? 1 : -1;
                                                    const beamLevelOffset = beamYDirection * beamLevel * (BEAM_THICKNESS + 2);
                                                    let currentSegment: { startNote: StaffNote, endNote: StaffNote } | null = null;
                                                    const segments: React.ReactNode[] = [];
                                                    for (let i = 0; i < group.length; i++) {
                                                        const note = group[i];
                                                        if (getBeamCount(note.duration!) >= beamLevel + 1) {
                                                            if (!currentSegment) currentSegment = { startNote: note, endNote: note };
                                                            else currentSegment.endNote = note;
                                                        } else {
                                                            if (currentSegment) {
                                                                const startProps = getStemProps(currentSegment.startNote);
                                                                const endProps = getStemProps(currentSegment.endNote);
                                                                const y1 = firstNoteStemEndY + (lastNoteStemEndY - firstNoteStemEndY) * ((startProps.stemX - firstNoteProps.stemX) / (lastNoteProps.stemX - firstNoteProps.stemX || 1)) + beamLevelOffset;
                                                                const y2 = firstNoteStemEndY + (lastNoteStemEndY - firstNoteStemEndY) * ((endProps.stemX - firstNoteProps.stemX) / (lastNoteProps.stemX - firstNoteProps.stemX || 1)) + beamLevelOffset;
                                                                segments.push(<path key={`${beamLevel}-${i}`} d={`M ${startProps.stemX} ${y1} L ${endProps.stemX} ${y2} L ${endProps.stemX} ${y2 - beamYDirection * BEAM_THICKNESS} L ${startProps.stemX} ${y1 - beamYDirection * BEAM_THICKNESS} Z`} fill="black" />);
                                                            }
                                                            currentSegment = null;
                                                        }
                                                    }
                                                    if (currentSegment) {
                                                        const startProps = getStemProps(currentSegment.startNote);
                                                        const endProps = getStemProps(currentSegment.endNote);
                                                        const y1 = firstNoteStemEndY + (lastNoteStemEndY - firstNoteStemEndY) * ((startProps.stemX - firstNoteProps.stemX) / (lastNoteProps.stemX - firstNoteProps.stemX || 1)) + beamLevelOffset;
                                                        const y2 = firstNoteStemEndY + (lastNoteStemEndY - firstNoteStemEndY) * ((endProps.stemX - firstNoteProps.stemX) / (lastNoteProps.stemX - firstNoteProps.stemX || 1)) + beamLevelOffset;
                                                        segments.push(<path key={`${beamLevel}-end`} d={`M ${startProps.stemX} ${y1} L ${endProps.stemX} ${y2} L ${endProps.stemX} ${y2 - beamYDirection * BEAM_THICKNESS} L ${startProps.stemX} ${y1 - beamYDirection * BEAM_THICKNESS} Z`} fill="black" />);
                                                    }
                                                    return segments;
                                                })}
                                            </g>
                                        );
                                    })}
                                    {systemNotes.map(note => {
                                        const isTreble = note.clef !== 'bass';
                                        const staffTop = isTreble ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP;
                                        const yOffset = isTreble ? 0 : TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT;
                                        const y = getNoteY(note.position, staffTop, note.clef || 'treble');
                                        
                                        // FIX: Use calculated offsets for drawing noteheads
                                        const nominalX = note.xPosition || 0;
                                        const pos = notePositions.get(note.id);
                                        const x = pos ? pos.x : nominalX;

                                        const isHighlighted = notesToHighlight.includes(note.id);
                                        const isPlayingNow = playingNoteIds.includes(note.id);
                                        const isBeamed = currentBeamedNoteIds.has(note.id);
                                        let noteColor = 'black';
                                        if (isHighlighted) noteColor = 'rgb(56, 189, 248)';
                                        if (isPlayingNow) noteColor = 'rgb(34, 197, 94)';
                                        const duration = note.duration || 'quarter';
                                        if (note.isRest) {
                                            return (
                                                <g key={note.id} onClick={(e) => handleNoteClick(note.id, e)} className="cursor-pointer">
                                                    <Rest duration={duration} x={x} y={y + yOffset} color={noteColor} staffTop={staffTop + yOffset} />
                                                    {note.isDotted && <circle cx={x + 15} cy={staffTop + yOffset + 2.5 * LINE_HEIGHT} r="2.5" fill={noteColor} />}
                                                </g>
                                            );
                                        }
                                        
                                        const voice = note.voice;
                                        let isStemUp: boolean;
                                        if (note.manualStemDirection) {
                                            isStemUp = note.manualStemDirection === 'up';
                                        } else if (voice === 1 || voice === 3) {
                                            isStemUp = true;
                                        } else if (voice === 2 || voice === 4) {
                                            isStemUp = false;
                                        } else {
                                            isStemUp = note.position < (note.clef === 'bass' ? -2 : 6);
                                        }

                                        // FIX: Stem aligns with nominal position, not shifted notehead
                                        const stemX = nominalX + (isStemUp ? NOTE_HEAD_RX_NORMAL - 1.5 : -(NOTE_HEAD_RX_NORMAL - 1.5));
                                        const stemY1 = y, stemY2 = isStemUp ? y - 35 : y + 35;
                                        let effectiveFill = noteColor, effectiveStroke = noteColor, effectiveStrokeWidth = isHighlighted ? 2.5 : 2;
                                        if (duration === 'whole' || duration === 'half') effectiveFill = 'none';
                                        return (
                                            <g key={note.id} transform={`translate(0, ${yOffset})`} onClick={(e) => handleNoteClick(note.id, e)} className={`cursor-pointer ${isPlayingNow ? 'note-glow-strong' : ''}`}>
                                                {note.explicitAccidental && <Accidental type={note.explicitAccidental} x={x + ACCIDENTAL_OFFSET_NORMAL} y={y} color={noteColor} />}
                                                <LedgerLines 
                                                    y={y} 
                                                    noteHeadRx={NOTE_HEAD_RX_NORMAL} 
                                                    color={effectiveStroke} 
                                                    staffTop={staffTop} 
                                                    xOffset={x} 
                                                />
                                                <ellipse cx={x} cy={y} rx={NOTE_HEAD_RX_NORMAL} ry={NOTE_HEAD_RY_NORMAL} fill={effectiveFill} stroke={effectiveStroke} strokeWidth={effectiveStrokeWidth} transform={`rotate(-20 ${x} ${y})`} />
                                                {note.isDotted && <circle cx={x + NOTE_HEAD_RX_NORMAL + 5} cy={(note.position % 2 !== 0) ? y : y - LINE_HEIGHT / 2} r="2.5" fill={noteColor} />}
                                                {duration !== 'whole' && !isBeamed && ( <line x1={stemX} y1={stemY1} x2={stemX} y2={stemY2} stroke={noteColor} strokeWidth="1.5" /> )}
                                                {!isBeamed && (duration === 'eighth' || duration === 'sixteenth' || duration === 'thirty-second' || duration === 'sixty-fourth') && (() => {
                                                    const flagCount = { 'eighth': 1, 'sixteenth': 2, 'thirty-second': 3, 'sixty-fourth': 4 }[duration];
                                                    return <g stroke={noteColor} strokeWidth="2" fill="none">{Array.from({ length: flagCount }).map((_, i) => <path key={i} d={isStemUp ? `M${stemX} ${stemY2 + i * 5} q 8 5, 6 15` : `M${stemX} ${stemY2 - i * 5} q 8 -5, 6 -15`} />)}</g>;
                                                })()}
                                            </g>
                                        );
                                    })}
                                    {ghostNote && ghostNote.systemIndex === systemIndex && (
                                        <g opacity="0.5" style={{ pointerEvents: 'none' }} transform={`translate(0, ${ghostNote.clef !== 'bass' ? 0 : TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT})`}>
                                            {ghostNote.explicitAccidental && <Accidental type={ghostNote.explicitAccidental} x={(ghostNote.xPosition || 0) + ACCIDENTAL_OFFSET_NORMAL} y={getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble')} color={'black'} />}
                                            <LedgerLines 
                                                y={getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble')} 
                                                noteHeadRx={NOTE_HEAD_RX_NORMAL} 
                                                color={'black'} 
                                                staffTop={ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP} 
                                                xOffset={ghostNote.xPosition || 0} 
                                            />
                                            <ellipse 
                                                cx={ghostNote.xPosition || 0} 
                                                cy={getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble')} 
                                                rx={NOTE_HEAD_RX_NORMAL} 
                                                ry={NOTE_HEAD_RY_NORMAL} 
                                                fill={ghostNote.duration === 'whole' || ghostNote.duration === 'half' ? 'none' : 'black'} 
                                                stroke={'black'} 
                                                strokeWidth={2} 
                                                transform={`rotate(-20 ${(ghostNote.xPosition || 0)} ${getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble')})`} 
                                            />
                                            {ghostNote.duration !== 'whole' && (
                                                <line 
                                                    x1={(ghostNote.xPosition || 0) + (ghostNote.manualStemDirection === 'up' ? NOTE_HEAD_RX_NORMAL - 1.5 : -(NOTE_HEAD_RX_NORMAL - 1.5))} 
                                                    y1={getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble')} 
                                                    x2={(ghostNote.xPosition || 0) + (ghostNote.manualStemDirection === 'up' ? NOTE_HEAD_RX_NORMAL - 1.5 : -(NOTE_HEAD_RX_NORMAL - 1.5))} 
                                                    y2={ghostNote.manualStemDirection === 'up' ? getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble') - 35 : getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble') + 35} 
                                                    stroke={'black'} 
                                                    strokeWidth="1.5" 
                                                />
                                            )}
                                            {['eighth', 'sixteenth', 'thirty-second', 'sixty-fourth'].includes(ghostNote.duration || '') && (() => {
                                                const flagCount = { 'eighth': 1, 'sixteenth': 2, 'thirty-second': 3, 'sixty-fourth': 4 }[ghostNote.duration || 'eighth'];
                                                return <g stroke={'black'} strokeWidth="2" fill="none">{Array.from({ length: flagCount }).map((_, i) => <path key={i} d={ghostNote.manualStemDirection === 'up' ? `M${(ghostNote.xPosition || 0) + NOTE_HEAD_RX_NORMAL - 1.5} ${getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble') - 35 + i * 5} q 8 5, 6 15` : `M${(ghostNote.xPosition || 0) - NOTE_HEAD_RX_NORMAL + 1.5} ${getNoteY(ghostNote.position, ghostNote.clef !== 'bass' ? TOP_STAFF_TOP : BOTTOM_STAFF_TOP, ghostNote.clef || 'treble') + 35 - i * 5} q 8 -5, 6 -15`} />)}</g>;
                                            })()}
                                        </g>
                                    )}
                                    {romanAnalysisBySystem[systemIndex]?.map((analysisItem, index) => {
                                        const yPos = TOP_STAFF_HEIGHT + CONNECTOR_HEIGHT + BOTTOM_STAFF_TOP + 4 * LINE_HEIGHT + 40;
                                        const { roman, figures } = analysisItem.analysis;
                                        const xPos = analysisItem.x;
                                        
                                        if (analysisMode === 'roman') {
                                            return (
                                                <text key={`analysis-${systemIndex}-${index}`} x={xPos} y={yPos} textAnchor="middle" fontFamily="serif" fontSize="18" fontWeight="bold" fill={primaryColor}>
                                                    {roman}
                                                    {figures.map((figure, figIndex) => (
                                                        <tspan
                                                            key={figIndex}
                                                            fontSize="0.8em"
                                                            fontWeight="normal"
                                                            x={xPos + 25}
                                                            dy={figIndex === 0 ? -8 : 12}
                                                        >
                                                            {figure}
                                                        </tspan>
                                                    ))}
                                                </text>
                                            );
                                        } else { // 'symbol' mode
                                            return (
                                                <text key={`analysis-${systemIndex}-${index}`} x={xPos} y={yPos} textAnchor="middle" fontFamily="sans-serif" fontSize="16" fontWeight="bold" fill={primaryColor}>
                                                    {roman}
                                                </text>
                                            );
                                        }
                                    })}
                                </svg>
                            </div>
                        )
                    })}
                </div>
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
             {contextMenu && <ModulationContextMenu
                menuData={contextMenu}
                onClose={() => setContextMenu(null)}
                onApply={handleApplyContext}
                onRemove={handleRemoveContext}
                initialKey={existingContextForMenu ? existingContextForMenu.newTonic : keySignatureRoot}
                initialIsMinor={existingContextForMenu ? existingContextForMenu.newIsMinor : isMinorMode}
            />}
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
