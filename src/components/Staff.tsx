// FIX: Replaced the entire file content with a correct implementation of the Staff component to fix the corrupted file and missing default export.
import React, { forwardRef, useMemo } from 'react';
import { StaffNote, KeySignature, AccidentalType, TimeSignature, Barline, NoteDuration, ClefType } from '../types';

interface StaffProps {
    notes: StaffNote[];
    blockChordNotes?: StaffNote[];
    blockChordColor?: string;
    keySignature: KeySignature;
    timeSignature?: TimeSignature;
    glowingNoteMidi?: number | null;
    glowingMidis?: number[] | null;
    playingNoteIds?: string[]; // New prop for playback visualization
    onNoteInteraction: (note: { midi: number; source: 'staff', noteIndex: number }) => void;
    onBackgroundClick?: (position: number, x: number, e: React.MouseEvent<SVGSVGElement>) => void;
    onBackgroundMouseDown?: (e: React.MouseEvent<SVGSVGElement>) => void;
    selectionRect?: { x: number, y: number, width: number, height: number };
    selectionColor?: string; // New prop for custom selection color
    containerClassName?: string;
    selectedNoteIds?: Set<string>;
    onNoteClick?: (noteId: string, e: React.MouseEvent) => void;
    onNoteMouseDown?: (noteId: string) => void;
    onNoteRightClick?: (noteId: string) => void;
    barlines?: Barline[];
    onBarlineRightClick?: (barlineId: string) => void;
    theme?: 'light' | 'dark';
    width: number;
    clef?: ClefType;
    height?: number;
    staffTop?: number;
    romanAnalysis?: { x: number, analysis: string }[];
}

const LINE_HEIGHT = 12;
const DEFAULT_STAFF_TOP = 50;
const START_X = 50;
const NOTE_HEAD_RX_NORMAL = 6.3;
const NOTE_HEAD_RY_NORMAL = 4.725;
const ACCIDENTAL_OFFSET_NORMAL = -20;

const KEY_SIGNATURE_POSITIONS_TREBLE: Record<'sharp' | 'flat', { pitch: string, octave: number }[]> = {
    sharp: [ { pitch: 'F', octave: 5 }, { pitch: 'C', octave: 5 }, { pitch: 'G', octave: 5 }, { pitch: 'D', octave: 5 }, { pitch: 'A', octave: 4 }, { pitch: 'E', octave: 5 }, { pitch: 'B', octave: 4 } ],
    flat: [ { pitch: 'B', octave: 4 }, { pitch: 'E', octave: 5 }, { pitch: 'A', octave: 4 }, { pitch: 'D', octave: 5 }, { pitch: 'G', octave: 4 }, { pitch: 'C', octave: 5 }, { pitch: 'F', octave: 4 } ]
};
const KEY_SIGNATURE_POSITIONS_BASS: Record<'sharp' | 'flat', { pitch: string, octave: number }[]> = {
    sharp: [ { pitch: 'F', octave: 3 }, { pitch: 'C', octave: 3 }, { pitch: 'G', octave: 3 }, { pitch: 'D', octave: 3 }, { pitch: 'A', octave: 2 }, { pitch: 'E', octave: 3 }, { pitch: 'B', octave: 2 } ],
    flat: [ { pitch: 'B', octave: 2 }, { pitch: 'E', octave: 3 }, { pitch: 'A', octave: 2 }, { pitch: 'D', octave: 3 }, { pitch: 'G', octave: 2 }, { pitch: 'C', octave: 3 }, { pitch: 'F', octave: 2 } ]
};
const NOTE_POSITIONS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

const getNoteY = (position: number, staffTop: number, clef: ClefType): number => {
    if (clef === 'bass') {
        return staffTop - (position + 2) * (LINE_HEIGHT / 2);
    }
    return staffTop + (5 * LINE_HEIGHT) - (position * (LINE_HEIGHT / 2));
};

const Accidental: React.FC<{ type: AccidentalType, x: number, y: number, color: string }> = ({ type, x, y, color }) => {
    if (type === 'sharp') {
        return <text x={x} y={y} fill={color} fontSize="30" fontFamily="serif" textAnchor="middle" dominantBaseline="central">♯</text>;
    }
    if (type === 'flat') {
        return <text x={x} y={y - 2} fill={color} fontSize="28" fontFamily="serif" textAnchor="middle" dominantBaseline="central">♭</text>;
    }
    if (type === 'natural') {
        return <text x={x} y={y} fill={color} fontSize="28" fontFamily="serif" textAnchor="middle" dominantBaseline="central">♮</text>;
    }
    return null;
};

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

const LedgerLines: React.FC<{ y: number, noteHeadRx: number, color: string, xOffset?: number, staffTop: number }> = ({ y, noteHeadRx, color, xOffset = 0, staffTop }) => {
    const lines = [];
    const topLineY = staffTop;
    if (y < topLineY) {
        for (let lineY = topLineY - LINE_HEIGHT; lineY >= y - 1; lineY -= LINE_HEIGHT) {
            lines.push(<line key={`ledger-above-${lineY}`} x1={xOffset - noteHeadRx - 2} y1={lineY} x2={xOffset + noteHeadRx + 2} y2={lineY} stroke={color} strokeWidth="1" />);
        }
    }
    const bottomLineY = staffTop + 4 * LINE_HEIGHT;
    if (y > bottomLineY) {
        for (let lineY = bottomLineY + LINE_HEIGHT; lineY <= y + 1; lineY += LINE_HEIGHT) {
            lines.push(<line key={`ledger-below-${lineY}`} x1={xOffset - noteHeadRx - 2} y1={lineY} x2={xOffset + noteHeadRx + 2} y2={lineY} stroke={color} strokeWidth="1" />);
        }
    }
    return <g>{lines}</g>;
};

const Staff = forwardRef<SVGSVGElement, StaffProps>(({
    notes, blockChordNotes, blockChordColor, keySignature, timeSignature, glowingNoteMidi, glowingMidis, playingNoteIds,
    onNoteInteraction, onBackgroundClick, onBackgroundMouseDown, selectionRect, selectionColor, containerClassName, selectedNoteIds,
    onNoteClick, onNoteMouseDown, onNoteRightClick, barlines, onBarlineRightClick, theme = 'dark', width, clef = 'treble',
    height, staffTop = DEFAULT_STAFF_TOP, romanAnalysis
}, ref) => {
    
    const primaryColor = theme === 'light' ? 'black' : 'white';

    const getNoteYForRender = (position: number) => getNoteY(position, staffTop, clef);

    const handleBgClick = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!onBackgroundClick) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const x = e.clientX - rect.left;
        
        let position: number;
        if (clef === 'bass') {
            position = ((staffTop - y) / (LINE_HEIGHT / 2)) - 2;
        } else {
            position = ((staffTop + 5 * LINE_HEIGHT) - y) / (LINE_HEIGHT / 2);
        }
        onBackgroundClick(position, x, e);
    };

    const blockChordStemDirections = useMemo(() => {
        const directions = new Map<string, 'up' | 'down'>();
        if (!blockChordNotes || blockChordNotes.length < 2) {
            return directions;
        }

        const sortedNotes = [...blockChordNotes].sort((a, b) => a.midi - b.midi);
        const midIndex = Math.floor(sortedNotes.length / 2);

        sortedNotes.forEach((note, index) => {
            if (index < midIndex) {
                directions.set(note.id, 'down');
            } else {
                directions.set(note.id, 'up');
            }
        });

        return directions;
    }, [blockChordNotes]);

    const allNotes = useMemo(() => {
        const blockNotes = (blockChordNotes || []).map(note => ({
            ...note,
            color: note.color || blockChordColor || primaryColor
        }));

        const scaleNotes = notes || [];
        
        return [...blockNotes, ...scaleNotes];
    }, [notes, blockChordNotes, blockChordColor, primaryColor]);

    return (
        <div className={containerClassName} style={{ height }}>
            <svg ref={ref} width={width} height={height} onMouseDown={onBackgroundMouseDown} onClick={handleBgClick}>
                <rect width="100%" height="100%" fill="transparent" />
                {selectionRect && (
                    <rect
                        x={selectionRect.x}
                        y={selectionRect.y}
                        width={selectionRect.width}
                        height={selectionRect.height}
                        fill={selectionColor || 'rgba(56, 189, 248, 0.2)'}
                        stroke={selectionColor || 'rgb(56, 189, 248)'}
                        strokeWidth="1"
                    />
                )}

                {Array.from({ length: 5 }).map((_, i) => (
                    <line key={`line-${i}`} x1="10" y1={staffTop + i * LINE_HEIGHT} x2={width - 10} y2={staffTop + i * LINE_HEIGHT} stroke={theme === 'light' ? 'gray' : 'rgba(255,255,255,0.3)'} strokeWidth="1" />
                ))}

                <g>
                    { clef === 'treble' && <text x="30" y={staffTop + 2.6 * LINE_HEIGHT - 7} fontSize="92" fontFamily="serif" fill={primaryColor} textAnchor="middle" dominantBaseline="central">𝄞</text> }
                    { clef === 'bass' && <text x="30" y={staffTop + 1.9 * LINE_HEIGHT} fontSize="48" fontFamily="serif" fill={primaryColor} textAnchor="middle" dominantBaseline="central">𝄢</text> }
                    {keySignature && <KeySignatureDisplay signature={keySignature} color={primaryColor} clef={clef} staffTop={staffTop} />}
                    {timeSignature && <TimeSignatureDisplay signature={timeSignature} x={START_X + (keySignature.count * 14) + 15} color={primaryColor} staffTop={staffTop} />}
                </g>

                {barlines?.map(bar => (
                    <line key={bar.id} x1={bar.xPosition} y1={staffTop} x2={bar.xPosition} y2={staffTop + 4 * LINE_HEIGHT} stroke={primaryColor} strokeWidth="1.5" onContextMenu={() => onBarlineRightClick?.(bar.id)} />
                ))}

                {allNotes.map(note => {
                    const duration = note.duration || 'quarter';
                    const y = getNoteYForRender(note.position);
                    const x = note.xPosition || 0;
                    const noteColor = note.color || primaryColor;

                    if (note.isRest) {
                        return (
                            <g key={note.id} onClick={(e) => onNoteClick?.(note.id, e)} onMouseDown={() => onNoteMouseDown?.(note.id)} onContextMenu={() => onNoteRightClick?.(note.id)} className="cursor-pointer">
                                <Rest duration={duration} x={x} y={y} color={noteColor} staffTop={staffTop} />
                            </g>
                        );
                    }

                    const isGlowing = glowingNoteMidi === note.midi || glowingMidis?.includes(note.midi);
                    const isPlaying = playingNoteIds?.includes(note.id);
                    const isSelected = selectedNoteIds?.has(note.id);
                    
                    let effectiveFill = noteColor;
                    let effectiveStroke = noteColor;
                    let effectiveStrokeWidth = isSelected ? 2 : 1.5;

                    if (duration === 'whole' || duration === 'half') {
                        effectiveFill = 'none';
                    }
                    if (isPlaying) effectiveStroke = 'rgb(34, 197, 94)';
                    if (isGlowing) effectiveStroke = 'rgb(34, 211, 238)';
                    if (isPlaying || isGlowing) effectiveStrokeWidth = 2.5;

                    const explicitStemDirection = blockChordStemDirections.get(note.id);
                    let isStemUp: boolean;

                    if (explicitStemDirection) {
                        isStemUp = explicitStemDirection === 'up';
                    } else {
                        const noteClef = note.clef || clef;
                        isStemUp = noteClef === 'bass' ? note.position < -6 : note.position < 6;
                    }

                    return (
                        <g key={note.id} onClick={(e) => onNoteClick?.(note.id, e)} onMouseDown={() => onNoteMouseDown?.(note.id)} onContextMenu={() => onNoteRightClick?.(note.id)}>
                             {note.explicitAccidental && <Accidental type={note.explicitAccidental} x={x + ACCIDENTAL_OFFSET_NORMAL} y={y} color={noteColor} />}
                             <LedgerLines y={y} noteHeadRx={NOTE_HEAD_RX_NORMAL} color={noteColor} staffTop={staffTop} xOffset={x}/>
                             <ellipse cx={x} cy={y} rx={NOTE_HEAD_RX_NORMAL} ry={NOTE_HEAD_RY_NORMAL} fill={effectiveFill} stroke={effectiveStroke} strokeWidth={effectiveStrokeWidth} transform={`rotate(-20 ${x} ${y})`} />
                             { duration !== 'whole' && <line x1={x + (isStemUp ? NOTE_HEAD_RX_NORMAL - 1.5 : -(NOTE_HEAD_RX_NORMAL-1.5))} y1={y} x2={x + (isStemUp ? NOTE_HEAD_RX_NORMAL - 1.5 : -(NOTE_HEAD_RX_NORMAL-1.5))} y2={y + (isStemUp ? -35 : 35)} stroke={noteColor} strokeWidth="1.5" />}
                        </g>
                    );
                })}

                {romanAnalysis?.map((analysisItem, index) => {
                    const yPos = staffTop + 4 * LINE_HEIGHT + 30;
                    const [ , roman, figures] = analysisItem.analysis.match(/([ivIV°+ø]+)(.*)/) || ['', analysisItem.analysis, ''];
                    return (
                        <text
                            key={`analysis-${index}`}
                            x={analysisItem.x}
                            y={yPos}
                            textAnchor="middle"
                            fontFamily="serif"
                            fontSize="18"
                            fontWeight="bold"
                            fill={primaryColor}
                        >
                            {roman}
                            <tspan fontSize="14" dy="-0.4em" fontWeight="normal">{figures}</tspan>
                        </text>
                    );
                })}

            </svg>
        </div>
    );
});

export default Staff;