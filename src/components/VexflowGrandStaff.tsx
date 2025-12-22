import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Accidental, TickContext } from 'vexflow';
import type { AccidentalType, Barline, KeySignature, StaffNote, TimeSignature } from '../types';

interface VexflowGrandStaffProps {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  barlines?: Barline[];
  width?: number;
  height?: number;
  onNoteClick?: (noteId: string) => void;
  selectedNoteIds?: string[];
  onStaffClick?: (x: number, y: number) => void;
  onMouseMoveStaff?: (x: number, y: number) => void;
  ghostNote?: StaffNote | null;
}

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 250;
// Keep X alignment consistent with GrandStaffEditor layout (START_X = 50)
const STAFF_MARGIN = 50;
const TREBLE_Y = 40;
const BASS_Y = 140;

const durationToVexflow = (duration: StaffNote['duration']): string => {
  switch (duration) {
    case 'whole': return 'w';
    case 'half': return 'h';
    case 'quarter': return 'q';
    case 'eighth': return '8';
    case 'sixteenth': return '16';
    case 'thirty-second': return '32';
    case 'sixty-fourth': return '64';
    default: return 'q';
  }
};

const accidentalTypeToVexflow = (accidental: AccidentalType | string | null | undefined): string | null => {
  if (!accidental) return null;

  // Normalize common glyphs/legacy tokens into VexFlow accidentals.
  switch (accidental) {
    case 'sharp':
    case '#':
    case '♯':
      return '#';
    case 'flat':
    case 'b':
    case '♭':
      return 'b';
    case 'natural':
    case 'n':
    case '♮':
      return 'n';
    case 'double-sharp':
    case '##':
    case '𝄪':
      return '##';
    case 'double-flat':
    case 'bb':
    case '𝄫':
      return 'bb';
    default:
      return null;
  }
};

const makeVfNote = (n: StaffNote, clef: 'treble' | 'bass') => {
  const key = `${n.pitch?.toLowerCase?.() || 'c'}/${n.octave ?? 4}`;
  const baseDur = durationToVexflow(n.duration);
  // Keep the duration string free of dots.
  // We render the dotted glyph ourselves as an SVG circle (more reliable when drawing
  // notes one-by-one without Voice/Formatter).
  const duration = `${baseDur}${n.isRest ? 'r' : ''}`;
  const note = new StaveNote({
    clef,
    keys: [key],
    duration,
  });
  // Display rule:
  // - If `explicitAccidental` is present:
  //   - `null` means “do not show” (implied by key signature)
  //   - otherwise show that explicit accidental
  // - If `explicitAccidental` is undefined (legacy notes), fall back to `accidental`.
  const accidentalToShow: AccidentalType | null =
    n.explicitAccidental !== undefined ? n.explicitAccidental : (n.accidental ?? null);
  const vfAccidental = accidentalTypeToVexflow(accidentalToShow);
  if (vfAccidental) {
    try {
      note.addModifier(new Accidental(vfAccidental), 0);
    } catch {
      // Never crash rendering due to a bad/unknown accidental value.
      // If VexFlow rejects it, we just skip the modifier.
    }
  }
  (note as any).__staffNoteId = n.id;
  return note;
};

function keySignatureToVexflowString(keySignature: KeySignature): string {
  const sharpKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const flatKeys = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
  if (keySignature.type === 'sharp') {
    return sharpKeys[keySignature.count] || 'C';
  } else {
    return flatKeys[keySignature.count] || 'C';
  }
}

const VexflowGrandStaff: React.FC<VexflowGrandStaffProps> = ({
  notes,
  timeSignature,
  keySignature,
  barlines = [],
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  onNoteClick,
  selectedNoteIds = [],
  onStaffClick,
  onMouseMoveStaff,
  ghostNote,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();
    const staffWidth = width - 2 * STAFF_MARGIN;

    const keyString = keySignatureToVexflowString(keySignature);

    const treble = new Stave(STAFF_MARGIN, TREBLE_Y, staffWidth);
    treble.addClef('treble').addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
    treble.addKeySignature(keyString);
    treble.setContext(context).draw();

    const bass = new Stave(STAFF_MARGIN, BASS_Y, staffWidth);
    bass.addClef('bass').addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
    bass.addKeySignature(keyString);
    bass.setContext(context).draw();

    const brace = new StaveConnector(treble, bass);
    brace.setType(StaveConnector.type.BRACE);
    brace.setContext(context).draw();

    const lineLeft = new StaveConnector(treble, bass);
    lineLeft.setType(StaveConnector.type.SINGLE_LEFT);
    lineLeft.setContext(context).draw();

    // Draw measure barlines using the actual stave metrics so the line starts/ends
    // exactly on the top/bottom staff lines (avoids pixel drift vs. a separate overlay).
    if (barlines.length > 0) {
      const yTop = treble.getYForLine(0);
      const yBottom = bass.getYForLine(4);
      const ctxAny = context as any;
      ctxAny.save?.();
      ctxAny.setLineWidth?.(1);
      barlines.forEach((bar) => {
        const x = bar.xPosition;
        ctxAny.beginPath?.();
        ctxAny.moveTo?.(x, yTop);
        ctxAny.lineTo?.(x, yBottom);
        ctxAny.stroke?.();
      });
      ctxAny.restore?.();
    }

    const allNotes = ghostNote ? [...notes, { ...ghostNote, id: '__ghost__' }] : notes;
    if (allNotes && allNotes.length > 0) {
      const trebleNotes = allNotes.filter(n => (n.clef || 'treble') === 'treble');
      const bassNotes = allNotes.filter(n => n.clef === 'bass');

      const drawNotesAtX = (staffNotes: StaffNote[], stave: Stave, clef: 'treble' | 'bass') => {
        staffNotes.forEach((n) => {
          const vfNote = makeVfNote(n, clef);
          // Wrap each note in a tagged SVG group so we can reliably detect
          // whether the user clicked a real note or the ghost note.
          const group = (context as any).openGroup?.() as SVGGElement | undefined;
          if (group) {
            group.setAttribute('data-note-id', n.id);
            if (n.id === '__ghost__') group.setAttribute('data-is-ghost', '1');
          }

          if (n.id === '__ghost__') {
            vfNote.setStyle({ fillStyle: 'rgba(56,189,248,0.4)', strokeStyle: 'rgba(14,165,233,0.7)' });
            // Tiny alignment tweak: mouse X is measured at cursor point, but VexFlow notehead center
            // can land slightly to the right when drawing without Formatter/Voice.
            // Apply only to ghost so real notes (which are beat-aligned) remain unchanged.
            vfNote.setXShift(-18);
          } else if (selectedNoteIds.includes(n.id)) {
            vfNote.setStyle({ fillStyle: '#38bdf8', strokeStyle: '#0ea5e9' });
          }

          const dotFill = n.id === '__ghost__'
            ? 'rgba(56,189,248,0.4)'
            : (selectedNoteIds.includes(n.id) ? '#38bdf8' : 'black');

          // `xPosition` arriva in coordinate SVG assolute (come il mouse).
          // Quando disegniamo senza Formatter/Voice, VexFlow interpreta la TickContext X
          // come offset relativo a `stave.getNoteStartX()`.
          const absoluteX = (n.xPosition ?? (stave.getNoteStartX() + 10));
          const x = absoluteX - stave.getNoteStartX();

          // IMPORTANT: attach to stave/context BEFORE preFormat.
          // Some modifiers (including dots from dotted durations) need stave metrics
          // during preFormat; doing it earlier can make them vanish.
          vfNote.setStave(stave);
          vfNote.setContext(context);

          const tc = new TickContext();
          tc.addTickable(vfNote);
          let didDraw = false;
          try {
            // Ensure the note is actually formatted before modifiers try to query positions.
            // In our per-note (no Voice/Formatter) rendering path, VexFlow can otherwise
            // throw: "UnformattedNote: Can't call GetModifierStartXY on an unformatted note".
            tc.preFormat();
            tc.setX(x);
            vfNote.setTickContext(tc);
            (vfNote as any).preFormat?.();
            (vfNote as any).postFormat?.();
            vfNote.draw();
            didDraw = true;
          } catch {
            // If this is the ghost note, fall back to drawing it without accidentals
            // rather than crashing the whole app.
            if (n.id === '__ghost__') {
              try {
                const fallbackNote = makeVfNote(
                  {
                    ...n,
                    explicitAccidental: null,
                    accidental: undefined,
                    userAccidental: undefined,
                  } as StaffNote,
                  clef
                );
                fallbackNote.setStave(stave);
                fallbackNote.setContext(context);
                fallbackNote.setXShift((vfNote as any).x_shift ?? 0);
                fallbackNote.setStyle({ fillStyle: 'rgba(56,189,248,0.4)', strokeStyle: 'rgba(14,165,233,0.7)' });

                const tc2 = new TickContext();
                tc2.addTickable(fallbackNote);
                tc2.preFormat();
                tc2.setX(x);
                fallbackNote.setTickContext(tc2);
                (fallbackNote as any).preFormat?.();
                (fallbackNote as any).postFormat?.();
                fallbackNote.draw();
                didDraw = true;
              } catch {
                // If even the fallback fails, skip rendering the ghost.
              }
            }
          }

          if (!didDraw) {
            (context as any).closeGroup?.();
            return;
          }

          // Dotted notes: draw the dot ourselves as an SVG circle inside the note's group.
          // This avoids VexFlow dot modifiers, which can be unstable when not using Voice/Formatter.
          if (n.isDotted && group) {
            try {
              const svgNS = 'http://www.w3.org/2000/svg';
              const ys: number[] | undefined = (vfNote as any).getYs?.();
              const dotYs = (ys && ys.length > 0 ? ys : [stave.getYForLine(2)]).map((y) => {
                const halfSpace = stave.getSpacingBetweenLines() / 2;
                const topLineY = stave.getYForLine(0);
                const middleLineY = stave.getYForLine(2);

                // Snap to the nearest half-space step to align with staff geometry.
                const step = Math.round((y - topLineY) / halfSpace);
                let snappedY = topLineY + step * halfSpace;

                // Dots should never sit on staff lines: if on a line, move into the nearest space.
                // Use a conventional rule: for notes on/above the middle line, place dot above;
                // for notes below the middle line, place dot below.
                if (step % 2 === 0) {
                  snappedY += (snappedY <= middleLineY ? -halfSpace : halfSpace);
                }
                return snappedY;
              });

              // Place the dot just to the right of the notehead (not the full glyph width).
              // `getNoteHeadEndX()` is the most reliable when available.
              const dotGap = 4.8; // +60% vs previous to avoid being too close
              const headEndX = (vfNote as any).getNoteHeadEndX?.();
              const absX = (vfNote as any).getAbsoluteX?.();
              const xShift = (vfNote as any).x_shift ?? 0;

              let dotBaseX: number;
              if (typeof headEndX === 'number') {
                dotBaseX = headEndX;
              } else if (typeof absX === 'number') {
                dotBaseX = absX + xShift;
              } else {
                dotBaseX = (stave.getNoteStartX() + x) + xShift;
              }

              const dotX = dotBaseX + dotGap;

              dotYs.forEach((dotY) => {
                const circle = document.createElementNS(svgNS, 'circle');
                circle.setAttribute('cx', String(dotX));
                circle.setAttribute('cy', String(dotY));
                circle.setAttribute('r', '1.9');
                circle.setAttribute('fill', dotFill);
                group.appendChild(circle);
              });
            } catch {
              // If anything goes wrong, skip the dot rather than crashing.
            }
          }

          (context as any).closeGroup?.();
        });
      };

      drawNotesAtX(trebleNotes, treble, 'treble');
      drawNotesAtX(bassNotes, bass, 'bass');

      // No per-note DOM wiring here: we handle clicks via the global SVG handler below
    }
  }, [notes, timeSignature, keySignature, barlines, width, height, onNoteClick, selectedNoteIds, ghostNote]);

  useEffect(() => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    svg.onclick = null;

    const onSvgClick = (e: MouseEvent) => {
      const target = e.target as Element;
      const tagged = target.closest('[data-note-id]') as HTMLElement | null;
      const noteId = tagged?.dataset?.noteId;
      const isGhost = tagged?.dataset?.isGhost === '1';

      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (noteId && !isGhost) {
        onNoteClick?.(noteId);
        return;
      }

      // If the click hit the ghost notehead, treat it as a staff click
      onStaffClick?.(x, y);
    };

    svg.addEventListener('click', onSvgClick);
    if (onMouseMoveStaff) {
      svg.onmousemove = (e: MouseEvent) => {
        const target = e.target as Element;
        const tagged = target.closest('[data-note-id]') as HTMLElement | null;
        const isGhost = tagged?.dataset?.isGhost === '1';
        // Allow moving when hovering ghost; block when hovering real note.
        if (tagged && !isGhost) return;
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        onMouseMoveStaff(x, y);
      };
    }
    return () => {
      svg.onclick = null;
      svg.removeEventListener('click', onSvgClick);
      if (svg.onmousemove) svg.onmousemove = null;
    };
  }, [onStaffClick, onMouseMoveStaff, onNoteClick, notes, timeSignature, keySignature, width, height]);

  return <div ref={containerRef} style={{ background: 'white', width, height }} />;
};

export default VexflowGrandStaff;
