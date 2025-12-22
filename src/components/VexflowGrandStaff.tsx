import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Accidental, TickContext, Beam } from 'vexflow';
import type { AccidentalType, Barline, KeySignature, StaffNote, TimeSignature } from '../types';

interface VexflowGrandStaffProps {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  barlines?: Barline[];
  width?: number;
  height?: number;
  onNoteClick?: (noteId: string, e: MouseEvent) => void;
  selectedNoteIds?: string[];
  onStaffClick?: (x: number, y: number) => void;
  onMouseMoveStaff?: (x: number, y: number) => void;
  onStaffMouseDown?: (e: MouseEvent, svg: SVGSVGElement) => void;
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

  // Stem direction:
  // - manualStemDirection overrides everything (set by the Flip Stem button)
  // - otherwise default by voice: S(1)↑ A(2)↓ T(3)↑ B(4)↓
  if (!n.isRest) {
    const desiredStem = n.manualStemDirection
      ?? (n.voice ? ((n.voice === 1 || n.voice === 3) ? 'up' : 'down') : undefined);
    if (desiredStem) {
      try {
        note.setStemDirection(desiredStem === 'up' ? 1 : -1);
      } catch {
        // Ignore: some edge-case notes (or future VF changes) might reject stem updates.
      }
    }
  }
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
  onStaffMouseDown,
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

      const drawNotesAtX = (
        staffNotes: StaffNote[],
        stave: Stave,
        clef: 'treble' | 'bass'
      ) => {
        const prepared: Array<{
          staffNote: StaffNote;
          vfNote: StaveNote;
          dotFill: string;
          x: number;
        }> = [];

        for (const n of staffNotes) {
          let vfNote: StaveNote | null = null;
          try {
            vfNote = makeVfNote(n, clef);

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
            vfNote.setStave(stave);
            vfNote.setContext(context);

            const tc = new TickContext();
            tc.addTickable(vfNote);
            tc.preFormat();
            tc.setX(x);
            vfNote.setTickContext(tc);
            (vfNote as any).preFormat?.();
            (vfNote as any).postFormat?.();

            prepared.push({ staffNote: n, vfNote, dotFill, x });
          } catch {
            // If pre-formatting fails, try a minimal ghost fallback; otherwise skip.
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
                fallbackNote.setStyle({ fillStyle: 'rgba(56,189,248,0.4)', strokeStyle: 'rgba(14,165,233,0.7)' });

                const absoluteX = (n.xPosition ?? (stave.getNoteStartX() + 10));
                const x = absoluteX - stave.getNoteStartX();
                const tc2 = new TickContext();
                tc2.addTickable(fallbackNote);
                tc2.preFormat();
                tc2.setX(x);
                fallbackNote.setTickContext(tc2);
                (fallbackNote as any).preFormat?.();
                (fallbackNote as any).postFormat?.();

                prepared.push({
                  staffNote: n,
                  vfNote: fallbackNote,
                  dotFill: 'rgba(56,189,248,0.4)',
                  x,
                });
              } catch {
                // skip
              }
            }
            vfNote = null;
          }
        }

        if (prepared.length === 0) return;

        const isBeamable = (n: StaffNote) => {
          if (n.isRest) return false;
          const dur = durationToVexflow(n.duration);
          return dur === '8' || dur === '16' || dur === '32' || dur === '64';
        };

        // Build Beam instances BEFORE drawing notes, so VexFlow suppresses flags/stems on beamed notes.
        const beamInstances: Beam[] = [];

        // Manual beam groups (set by the editor button).
        const manualGroups = new Map<string, Array<{ staffNote: StaffNote; vfNote: StaveNote }>>();
        for (const p of prepared) {
          if (p.staffNote.id === '__ghost__') continue;
          if (!isBeamable(p.staffNote)) continue;
          if (p.staffNote.manualBeamDisabled) continue;
          const gid = p.staffNote.manualBeamGroupId;
          if (!gid) continue;
          if (!manualGroups.has(gid)) manualGroups.set(gid, []);
          manualGroups.get(gid)!.push({ staffNote: p.staffNote, vfNote: p.vfNote });
        }

        for (const group of manualGroups.values()) {
          if (group.length < 2) continue;
          group.sort((a, b) => (a.staffNote.xPosition ?? 0) - (b.staffNote.xPosition ?? 0));
          try {
            beamInstances.push(new Beam(group.map(g => g.vfNote)));
          } catch {
            // Skip invalid beam groups.
          }
        }

        // Auto beams for non-manual notes (unless explicitly disabled): group consecutive beamable notes
        // within the same (measure, voice, beat bucket).
        const manualOrDisabledIds = new Set(
          prepared
            .filter(p => p.staffNote.id !== '__ghost__' && (!!p.staffNote.manualBeamGroupId || !!p.staffNote.manualBeamDisabled))
            .map(p => p.staffNote.id)
        );

        const candidates = prepared
          .filter(p => p.staffNote.id !== '__ghost__')
          .filter(p => !manualOrDisabledIds.has(p.staffNote.id))
          .filter(p => isBeamable(p.staffNote))
          .filter(p => (p.staffNote.measureIndex ?? null) !== null && (p.staffNote.beat ?? null) !== null)
          .map(p => ({ staffNote: p.staffNote, vfNote: p.vfNote }));

        candidates.sort((a, b) => {
          const ma = a.staffNote.measureIndex ?? 0;
          const mb = b.staffNote.measureIndex ?? 0;
          if (ma !== mb) return ma - mb;
          const va = a.staffNote.voice ?? 1;
          const vb = b.staffNote.voice ?? 1;
          if (va !== vb) return va - vb;
          const ba = a.staffNote.beat ?? 1;
          const bb = b.staffNote.beat ?? 1;
          if (ba !== bb) return ba - bb;
          return (a.staffNote.xPosition ?? 0) - (b.staffNote.xPosition ?? 0);
        });

        const bucket = (beat: number) => Math.floor((beat - 1) / 1);
        let current: Array<{ staffNote: StaffNote; vfNote: StaveNote }> = [];
        let currentKey: string | null = null;
        const flush = () => {
          if (current.length >= 2) {
            try {
              beamInstances.push(new Beam(current.map(c => c.vfNote)));
            } catch {
              // ignore
            }
          }
          current = [];
          currentKey = null;
        };

        for (const c of candidates) {
          const m = c.staffNote.measureIndex ?? 0;
          const v = c.staffNote.voice ?? 1;
          const b = c.staffNote.beat ?? 1;
          const key = `${m}|${v}|${bucket(b)}`;
          if (currentKey === null || key === currentKey) {
            currentKey = key;
            current.push(c);
          } else {
            flush();
            currentKey = key;
            current.push(c);
          }
        }
        flush();

        // Draw notes (noteheads, ledger lines, etc.). Beamed notes will not draw stems/flags.
        for (const p of prepared) {
          const n = p.staffNote;
          const vfNote = p.vfNote;

          // Wrap each note in a tagged SVG group so we can reliably detect clicks.
          const group = (context as any).openGroup?.() as SVGGElement | undefined;
          if (group) {
            group.setAttribute('data-note-id', n.id);
            if (n.id === '__ghost__') group.setAttribute('data-is-ghost', '1');
          }

          let didDraw = false;
          try {
            vfNote.draw();
            didDraw = true;
          } catch {
            // If this is the ghost note, fall back to drawing it without accidentals.
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
                tc2.setX(p.x);
                fallbackNote.setTickContext(tc2);
                (fallbackNote as any).preFormat?.();
                (fallbackNote as any).postFormat?.();
                fallbackNote.draw();
                didDraw = true;
              } catch {
                // skip
              }
            }
          }

          if (didDraw && n.isDotted && group) {
            try {
              const svgNS = 'http://www.w3.org/2000/svg';
              const ys: number[] | undefined = (vfNote as any).getYs?.();
              const dotYs = (ys && ys.length > 0 ? ys : [stave.getYForLine(2)]).map((y) => {
                const halfSpace = stave.getSpacingBetweenLines() / 2;
                const topLineY = stave.getYForLine(0);
                const middleLineY = stave.getYForLine(2);

                const step = Math.round((y - topLineY) / halfSpace);
                let snappedY = topLineY + step * halfSpace;
                if (step % 2 === 0) {
                  snappedY += (snappedY <= middleLineY ? -halfSpace : halfSpace);
                }
                return snappedY;
              });

              const dotGap = 4.8;
              const headEndX = (vfNote as any).getNoteHeadEndX?.();
              const absX = (vfNote as any).getAbsoluteX?.();
              const xShift = (vfNote as any).x_shift ?? 0;

              let dotBaseX: number;
              if (typeof headEndX === 'number') {
                dotBaseX = headEndX;
              } else if (typeof absX === 'number') {
                dotBaseX = absX + xShift;
              } else {
                dotBaseX = (stave.getNoteStartX() + p.x) + xShift;
              }

              const dotX = dotBaseX + dotGap;
              dotYs.forEach((dotY) => {
                const circle = document.createElementNS(svgNS, 'circle');
                circle.setAttribute('cx', String(dotX));
                circle.setAttribute('cy', String(dotY));
                circle.setAttribute('r', '1.9');
                circle.setAttribute('fill', p.dotFill);
                group.appendChild(circle);
              });
            } catch {
              // ignore
            }
          }

          (context as any).closeGroup?.();
        }

        // Draw beams last (this also draws stems for beamed notes).
        for (const beam of beamInstances) {
          try {
            beam.setContext(context as any);
            beam.draw();
          } catch {
            // ignore
          }
        }
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
        onNoteClick?.(noteId, e);
        return;
      }

      // If the click hit the ghost notehead, treat it as a staff click
      onStaffClick?.(x, y);
    };

    const onSvgMouseDown = (e: MouseEvent) => {
      if (!onStaffMouseDown) return;
      const target = e.target as Element;
      const tagged = target.closest('[data-note-id]') as HTMLElement | null;
      const noteId = tagged?.dataset?.noteId;
      const isGhost = tagged?.dataset?.isGhost === '1';

      // Start rectangle selection only on background (or on ghost), not on real notes.
      if (noteId && !isGhost) return;
      onStaffMouseDown(e, svg as SVGSVGElement);
    };

    svg.addEventListener('click', onSvgClick);
    svg.addEventListener('mousedown', onSvgMouseDown);
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
      svg.removeEventListener('mousedown', onSvgMouseDown);
      if (svg.onmousemove) svg.onmousemove = null;
    };
  }, [onStaffClick, onMouseMoveStaff, onNoteClick, onStaffMouseDown, notes, timeSignature, keySignature, width, height]);

  return <div ref={containerRef} style={{ background: 'white', width, height }} />;
};

export default VexflowGrandStaff;
