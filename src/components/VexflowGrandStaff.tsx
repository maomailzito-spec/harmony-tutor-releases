import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Accidental, TickContext, Beam, StaveTie } from 'vexflow';
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
  onStaffClick?: (x: number, y: number, e: MouseEvent) => void;
  onStaffRightClick?: (x: number, y: number, e: MouseEvent) => void;
  onMouseMoveStaff?: (x: number, y: number) => void;
  onStaffMouseDown?: (e: MouseEvent, svg: SVGSVGElement) => void;
  onBarlineRightClick?: (barlineId: string, e: MouseEvent) => void;
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
  onStaffRightClick,
  onMouseMoveStaff,
  onStaffMouseDown,
  onBarlineRightClick,
  ghostNote,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep latest callbacks in refs so DOM listeners don't get torn down
  // on every React re-render (important for mousedown->mouseup gestures).
  const onNoteClickRef = useRef<typeof onNoteClick>(onNoteClick);
  const onStaffClickRef = useRef<typeof onStaffClick>(onStaffClick);
  const onStaffRightClickRef = useRef<typeof onStaffRightClick>(onStaffRightClick);
  const onMouseMoveStaffRef = useRef<typeof onMouseMoveStaff>(onMouseMoveStaff);
  const onStaffMouseDownRef = useRef<typeof onStaffMouseDown>(onStaffMouseDown);

  useEffect(() => { onNoteClickRef.current = onNoteClick; }, [onNoteClick]);
  useEffect(() => { onStaffClickRef.current = onStaffClick; }, [onStaffClick]);
  useEffect(() => { onStaffRightClickRef.current = onStaffRightClick; }, [onStaffRightClick]);
  useEffect(() => { onMouseMoveStaffRef.current = onMouseMoveStaff; }, [onMouseMoveStaff]);
  useEffect(() => { onStaffMouseDownRef.current = onStaffMouseDown; }, [onStaffMouseDown]);

  // Right-click on a measure barline (context menu)
  const onBarlineRightClickRef = useRef<typeof onBarlineRightClick>(onBarlineRightClick);
  useEffect(() => { onBarlineRightClickRef.current = onBarlineRightClick; }, [onBarlineRightClick]);

  const barlinesRef = useRef<Barline[]>(barlines);
  useEffect(() => { barlinesRef.current = barlines; }, [barlines]);

  type DownState = {
    startClientX: number;
    startClientY: number;
    moved: boolean;
    downNoteId: string | null;
    downIsGhost: boolean;
  };
  const downRef = useRef<DownState | null>(null);

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

    // Draw barlines using the actual stave metrics so the line starts/ends
    // exactly on the top/bottom staff lines (avoids pixel drift vs. a separate overlay).
    if (barlines.length > 0) {
      const yTop = treble.getYForLine(0);
      const yBottom = bass.getYForLine(4);
      const ctxAny = context as any;
      ctxAny.save?.();

      const drawSingle = (x: number, lineWidth: number) => {
        ctxAny.setLineWidth?.(lineWidth);
        ctxAny.beginPath?.();
        ctxAny.moveTo?.(x, yTop);
        ctxAny.lineTo?.(x, yBottom);
        ctxAny.stroke?.();
      };

      barlines.forEach((bar) => {
        const x = bar.xPosition;
        if (bar.style === 'final') {
          // Standard final barline: thin + thick.
          // Keep both slightly inside the staff end so it doesn't clip.
          drawSingle(x - 6, 1);
          drawSingle(x - 2, 3);
        } else if (bar.style === 'double') {
          // Simple double barline (section): thin + thin.
          drawSingle(x - 2, 1);
          drawSingle(x + 2, 1);
        } else {
          drawSingle(x, 1);
        }
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

        // --- PATCH: Affiancamento teste tra voci adiacenti a distanza di seconda ---
        // Raggruppa per xPosition (battuta/beat) e ordina per posizione verticale
        const byX = new Map<number, StaffNote[]>();
        for (const n of staffNotes) {
          const absX = n.xPosition ?? (stave.getNoteStartX() + 10);
          if (!byX.has(absX)) byX.set(absX, []);
          byX.get(absX)!.push(n);
        }
        // Applica offset alle teste di note di voci adiacenti a distanza di seconda
        const NOTE_HEAD_RX = 6.3; // come NOTE_HEAD_RX_NORMAL
        const offset = NOTE_HEAD_RX * 1.0 - 1; // offset ancora più stretto (~5.3px)
        const offsetMap = new Map<string, number>();
        for (const group of byX.values()) {
          // Ordina per posizione verticale (dal basso verso l'alto)
          const sorted = group.slice().sort((a, b) => a.position - b.position);
          for (let i = 0; i < sorted.length - 1; i++) {
            const n1 = sorted[i];
            const n2 = sorted[i + 1];
            // Solo se voci adiacenti e distanza di seconda
            if (Math.abs((n1.voice ?? 0) - (n2.voice ?? 0)) === 1 && Math.abs(n1.position - n2.position) === 1) {
              // S/A (1/2): Soprano (1, up) a sinistra, Alto (2, down) a destra
              // T/B (3/4): Tenore (3, up) a sinistra, Basso (4, down) a destra
              if ((n1.voice === 1 && n2.voice === 2) || (n1.voice === 3 && n2.voice === 4)) {
                // n1 (up) a sinistra, n2 (down) a destra
                offsetMap.set(n1.id, -offset);
                offsetMap.set(n2.id, offset);
              } else if ((n1.voice === 2 && n2.voice === 1) || (n1.voice === 4 && n2.voice === 3)) {
                // n2 (up) a sinistra, n1 (down) a destra
                offsetMap.set(n2.id, -offset);
                offsetMap.set(n1.id, offset);
              }
            }
          }
        }
        // --- FINE PATCH ---
        for (const n of staffNotes) {
          let vfNote: StaveNote | null = null;
          try {
            vfNote = makeVfNote(n, clef);
            if (n.id === '__ghost__') {
              vfNote.setStyle({ fillStyle: 'rgba(56,189,248,0.4)', strokeStyle: 'rgba(14,165,233,0.7)' });
              vfNote.setXShift(-18);
            } else if (selectedNoteIds.includes(n.id)) {
              vfNote.setStyle({ fillStyle: '#38bdf8', strokeStyle: '#0ea5e9' });
            }
            const dotFill = n.id === '__ghost__'
              ? 'rgba(56,189,248,0.4)'
              : (selectedNoteIds.includes(n.id) ? '#38bdf8' : 'black');
            const absoluteX = (n.xPosition ?? (stave.getNoteStartX() + 10));
            const x = absoluteX - stave.getNoteStartX();
            // Applica offset se necessario (stem up: solo la testa up va a destra, stem down: solo la down va a sinistra)
            const xShift = offsetMap.get(n.id) ?? 0;
            const prevXShift = (vfNote as any).x_shift ?? 0;
            vfNote.setXShift(prevXShift + xShift);
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
        const tieInstances: StaveTie[] = [];

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

        // Draw ties last so they appear above noteheads/beams.
        // We build ties only within this stave/clef group.
        try {
          const realPrepared = prepared
            .filter(p => p.staffNote.id !== '__ghost__')
            .filter(p => !p.staffNote.isRest);

          const sorted = [...realPrepared].sort((a, b) => {
            const ma = a.staffNote.measureIndex ?? 0;
            const mb = b.staffNote.measureIndex ?? 0;
            if (ma !== mb) return ma - mb;
            const ba = a.staffNote.beat ?? 0;
            const bb = b.staffNote.beat ?? 0;
            if (ba !== bb) return ba - bb;
            return (a.staffNote.xPosition ?? 0) - (b.staffNote.xPosition ?? 0);
          });

          for (let i = 0; i < sorted.length; i++) {
            const cur = sorted[i].staffNote;
            if (!cur.isTiedToNext) continue;

            const curVoice = cur.voice ?? 1;
            let next: (typeof sorted)[number] | undefined;
            for (let j = i + 1; j < sorted.length; j++) {
              const cand = sorted[j].staffNote;
              if ((cand.voice ?? 1) === curVoice) { next = sorted[j]; break; }
            }

            if (!next) continue;
            if (next.staffNote.isRest) continue;
            if (next.staffNote.midi !== cur.midi) continue;

            const tie = new StaveTie({
              first_note: sorted[i].vfNote,
              last_note: next.vfNote,
              first_indices: [0],
              last_indices: [0],
            });

            const manualDir = (cur as any).manualTieDirection as ('up' | 'down' | undefined);
            if (manualDir === 'up' || manualDir === 'down') {
              tie.setDirection(manualDir === 'up' ? 1 : -1);
            } else {
              // Default: tie opposite the stem direction when available.
              const stemDir = (sorted[i].vfNote as any).getStemDirection?.();
              if (stemDir === 1) tie.setDirection(-1);
              else if (stemDir === -1) tie.setDirection(1);
            }

            tieInstances.push(tie);
          }

          for (const tie of tieInstances) {
            try {
              tie.setContext(context as any);
              tie.draw();
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      };

      drawNotesAtX(trebleNotes, treble, 'treble');
      drawNotesAtX(bassNotes, bass, 'bass');

      // No per-note DOM wiring here: we handle clicks via the global SVG handler below
    }
  }, [notes, timeSignature, keySignature, barlines, width, height, selectedNoteIds, ghostNote]);

  // Attach pointer handlers ONCE to the persistent container. The SVG is frequently
  // re-created (ghost note updates), so attaching listeners to the SVG would
  // drop mousedown->mouseup gesture state.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const CLICK_MOVE_THRESHOLD_PX = 12;

    const getCurrentSvg = () => container.querySelector('svg') as SVGSVGElement | null;

    const clientToSvgCoords = (svg: SVGSVGElement, e: MouseEvent) => {
      // NOTE: We intentionally prefer a bounding-rect based conversion here.
      // On some browsers / SVG trees produced by VexFlow, getScreenCTM can yield
      // a stable Y offset (e.g. ~TREBLE_Y), which makes the ghost note appear
      // on the wrong staff line under the cursor.
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox?.baseVal;
      const svgW = vb?.width && vb.width > 0 ? vb.width : rect.width;
      const svgH = vb?.height && vb.height > 0 ? vb.height : rect.height;
      const scaleX = rect.width ? (svgW / rect.width) : 1;
      const scaleY = rect.height ? (svgH / rect.height) : 1;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const onContextMenu = (e: MouseEvent) => {
      const svg = getCurrentSvg();
      if (!svg) return;
      if (!(e.target instanceof Element) || !svg.contains(e.target)) return;

      // Always suppress the browser context menu on the staff.
      // Right-click is reserved for editor-specific actions (e.g. barline menu).
      e.preventDefault();

      const cb = onBarlineRightClickRef.current;
      const staffCb = onStaffRightClickRef.current;
      const bars = barlinesRef.current;
      const { x, y } = clientToSvgCoords(svg, e);

      // If we have no barlines (or no barline handler), treat it as a staff right-click.
      if (!cb || !bars || bars.length === 0) {
        if (staffCb) {
          e.stopPropagation();
          staffCb(x, y, e);
        }
        return;
      }

      let best: { id: string; dx: number } | null = null;
      for (const b of bars) {
        const dx = Math.abs((b.xPosition ?? 0) - x);
        if (!best || dx < best.dx) best = { id: b.id, dx };
      }

      // Make barlines easier to target than a 1px stroke.
      const HIT_PX = 12;
      if (best && best.dx <= HIT_PX) {
        e.stopPropagation();
        cb(best.id, e);
        return;
      }

      // Otherwise, right-click on the staff background.
      if (staffCb) {
        e.stopPropagation();
        staffCb(x, y, e);
      }
    };

    const getTargetNoteInfo = (target: EventTarget | null) => {
      const el = target as Element | null;
      const tagged = el?.closest?.('[data-note-id]') as HTMLElement | null;
      const noteId = tagged?.dataset?.noteId ?? null;
      const isGhost = tagged?.dataset?.isGhost === '1';
      return { noteId, isGhost, tagged };
    };


    const onWindowMouseUp = (e: MouseEvent) => {
      const down = downRef.current;
      if (!down) return;
      downRef.current = null;

      // Only treat left button as a click that can insert/select.
      // Right-click should be reserved for context menus.
      if (e.button !== 0) return;

      // If it was a drag, do not emit a staff click.
      if (down.moved) return;

      const svg = getCurrentSvg();
      if (!svg) return;

      const { x, y } = clientToSvgCoords(svg, e);
      const { noteId: upNoteId, isGhost: upIsGhost } = getTargetNoteInfo(e.target);

      if (down.downNoteId && down.downNoteId === upNoteId && !down.downIsGhost && !upIsGhost) {
        onNoteClickRef.current?.(down.downNoteId, e);
      } else {
        onStaffClickRef.current?.(x, y, e);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const svg = getCurrentSvg();
      if (!svg) return;

      // Only left button participates in click/drag gestures.
      // Right-click is handled by the `contextmenu` listener.
      if (e.button !== 0) return;

      // Only handle events that originate inside the SVG.
      if (!(e.target instanceof Element) || !svg.contains(e.target)) return;

      const { noteId, isGhost } = getTargetNoteInfo(e.target);
      downRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
        downNoteId: noteId,
        downIsGhost: isGhost,
      };

      // Start rectangle selection only on background (or on ghost), not on real notes.
      const staffMouseDown = onStaffMouseDownRef.current;
      if (staffMouseDown) {
        if (!(noteId && !isGhost)) {
          staffMouseDown(e, svg);
        }
      }

      // Capture mouseup even if pointer leaves the SVG/container.
      window.addEventListener('mouseup', onWindowMouseUp, { capture: true });
    };

    const onMouseMove = (e: MouseEvent) => {
      const svg = getCurrentSvg();
      if (!svg) return;
      if (!(e.target instanceof Element) || !svg.contains(e.target)) return;

      const down = downRef.current;
      if (down && !down.moved) {
        const dx = e.clientX - down.startClientX;
        const dy = e.clientY - down.startClientY;
        if (Math.hypot(dx, dy) >= CLICK_MOVE_THRESHOLD_PX) {
          down.moved = true;
        }
      }

      const moveCb = onMouseMoveStaffRef.current;
      if (!moveCb) return;

      const { tagged, isGhost } = getTargetNoteInfo(e.target);
      // Allow moving when hovering ghost; block when hovering real note.
      if (tagged && !isGhost) return;

      const { x, y } = clientToSvgCoords(svg, e);
      moveCb(x, y);
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('contextmenu', onContextMenu);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mouseup', onWindowMouseUp, { capture: true } as any);
    };
  }, []);

  return <div ref={containerRef} style={{ background: 'white', width, height }} />;
};

export default VexflowGrandStaff;
