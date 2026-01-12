import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Accidental, TickContext, Beam, StaveTie, Barline as VFBarline } from 'vexflow';
import type { AccidentalType, Barline, ClefType, KeySignature, StaffNote, TimeSignature } from '../types';
import { TICKS_PER_QUARTER } from '../constants';

interface VexflowGrandStaffProps {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  barlines?: Barline[];
  width?: number;
  height?: number;
  staffMode?: 'grandstaff' | 'treble_only' | 'satb_ancient';
  onNoteClick?: (noteId: string, e: MouseEvent) => void;
  selectedNoteIds?: string[];
  onStaffClick?: (x: number, y: number, e: MouseEvent) => void;
  onStaffRightClick?: (x: number, y: number, e: MouseEvent) => void;
  onMouseMoveStaff?: (x: number, y: number) => void;
  onStaffMouseDown?: (e: MouseEvent, svg: SVGSVGElement) => void;
  onBarlineRightClick?: (barlineId: string, e: MouseEvent) => void;
  ghostNote?: StaffNote | null;
  onNoteHitPoints?: (points: Array<{ id: string; x: number; y: number; isGhost: boolean }>) => void;
  enableProximityPick?: boolean;
}

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 250;
// SATB needs extra bottom space so very low bass notes (e.g. C below the staff)
// are not clipped by the SVG viewport.
const DEFAULT_HEIGHT_SATB = 480;
// Keep X alignment consistent with GrandStaffEditor layout (START_X = 50)
const STAFF_MARGIN = 50;
const TREBLE_Y = 40;
const BASS_Y = 140;
// SATB (chiavi antiche): soprano (C1), alto (C3), tenor (C4), bass (F4)
// Keep these in sync with GrandStaffEditor.tsx for cursor->pitch mapping and playhead overlays.
const SOPRANO_Y = 40;
const ALTO_Y = 140;
const TENOR_Y = 240;
const SATB_BASS_Y = 340;
const MEASURE_PADDING_X = 20;

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

const makeVfNote = (n: StaffNote, clef: ClefType, stemOverride?: 'up' | 'down') => {
  const key = `${n.pitch?.toLowerCase?.() || 'c'}/${n.octave ?? 4}`;
  const baseDur = durationToVexflow(n.duration);
  // Keep the duration string free of dots.
  // We render the dotted glyph ourselves as an SVG circle (more reliable when drawing
  // notes one-by-one without Voice/Formatter).
  const duration = `${baseDur}${n.isRest ? 'r' : ''}`;
  const note = new StaveNote({
    clef: clef as any,
    keys: [key],
    duration,
  });

  // Stem direction:
  // - manualStemDirection overrides everything (set by the Flip Stem button)
  // - stemOverride is an automatic layout hint (used to avoid collisions in close spacing)
  // - otherwise default by voice: S(1)↑ A(2)↓ T(3)↑ B(4)↓
  if (!n.isRest) {
    const desiredStem = n.manualStemDirection
      ?? stemOverride
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
  if (!n.isRest) {
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
  }
  (note as any).__staffNoteId = n.id;
  return note;
};

const getNoteTimeKey = (n: StaffNote): string => {
  const st = (n as any).startTick;
  const dt = (n as any).durationTicks;
  if (typeof st === 'number' && typeof dt === 'number') return `${st}|${dt}`;
  return `${n.measureIndex ?? -1}|${n.beat ?? -1}|${n.duration ?? 'q'}|${n.isDotted ? 'd' : 'n'}`;
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
  staffMode = 'grandstaff',
  onNoteClick,
  selectedNoteIds = [],
  onStaffClick,
  onStaffRightClick,
  onMouseMoveStaff,
  onStaffMouseDown,
  onBarlineRightClick,
  ghostNote,
  onNoteHitPoints,
  enableProximityPick = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const noteHitPointsRef = useRef<Array<{ id: string; x: number; y: number; isGhost: boolean }>>([]);
  const lastAltPickRef = useRef<{
    x: number;
    y: number;
    ids: string[];
    index: number;
    ts: number;
  } | null>(null);

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
    const effectiveHeight = staffMode === 'satb_ancient' ? Math.max(height, DEFAULT_HEIGHT_SATB) : height;
    renderer.resize(width, effectiveHeight);
    const context = renderer.getContext();
    const staffWidth = width - 2 * STAFF_MARGIN;

    const keyString = keySignatureToVexflowString(keySignature);

    const treble = staffMode !== 'satb_ancient' ? new Stave(STAFF_MARGIN, TREBLE_Y, staffWidth) : null;
    const bass = (staffMode === 'grandstaff') ? new Stave(STAFF_MARGIN, BASS_Y, staffWidth) : null;
    const satbSoprano = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, SOPRANO_Y, staffWidth) : null;
    const satbAlto = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, ALTO_Y, staffWidth) : null;
    const satbTenor = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, TENOR_Y, staffWidth) : null;
    const satbBass = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, SATB_BASS_Y, staffWidth) : null;

    // We draw the end-of-system barline ourselves as a single connecting line,
    // so suppress per-staff right-end barlines to avoid double-thickness.
    // (Internal measure barlines are handled separately below.)
    const stavesForEndBarSuppression: Stave[] = [treble, bass, satbSoprano, satbAlto, satbTenor, satbBass].filter(Boolean) as Stave[];
    for (const s of stavesForEndBarSuppression) {
      try {
        s.setEndBarType(VFBarline.type.NONE);
      } catch {
        // Ignore: future VexFlow changes shouldn't crash rendering.
      }
    }

    if (treble) {
      treble.addClef('treble').addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      treble.addKeySignature(keyString);
      treble.setContext(context).draw();
    }

    if (bass && treble) {
      bass.addClef('bass').addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      bass.addKeySignature(keyString);
      bass.setContext(context).draw();

      const brace = new StaveConnector(treble, bass);
      brace.setType(StaveConnector.type.BRACE);
      brace.setContext(context).draw();

      const lineLeft = new StaveConnector(treble, bass);
      lineLeft.setType(StaveConnector.type.SINGLE_LEFT);
      lineLeft.setContext(context).draw();
    }

    if (satbSoprano && satbAlto && satbTenor && satbBass) {
      satbSoprano.addClef('soprano' as any).addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      satbSoprano.addKeySignature(keyString);
      satbSoprano.setContext(context).draw();

      satbAlto.addClef('alto' as any).addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      satbAlto.addKeySignature(keyString);
      satbAlto.setContext(context).draw();

      satbTenor.addClef('tenor' as any).addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      satbTenor.addKeySignature(keyString);
      satbTenor.setContext(context).draw();

      satbBass.addClef('bass' as any).addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      satbBass.addKeySignature(keyString);
      satbBass.setContext(context).draw();

      const brace = new StaveConnector(satbSoprano, satbBass);
      brace.setType(StaveConnector.type.BRACE);
      brace.setContext(context).draw();

      const lineLeft = new StaveConnector(satbSoprano, satbBass);
      lineLeft.setType(StaveConnector.type.SINGLE_LEFT);
      lineLeft.setContext(context).draw();
    }

    // Draw barlines using the actual stave metrics so the line starts/ends
    // exactly on the top/bottom staff lines.
    // IMPORTANT: barlines are drawn as a single connecting line for the whole system
    // (including internal measure barlines), to match the existing engraving style.
    if (barlines.length > 0) {
      const topStave = (staffMode === 'satb_ancient' && satbSoprano)
        ? satbSoprano
        : (treble as Stave);
      const bottomStave = (staffMode === 'satb_ancient' && satbBass)
        ? satbBass
        : (bass ? bass : (treble as Stave));

      const yTop = topStave.getYForLine(0);
      const yBottom = bottomStave.getYForLine(4);
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
          drawSingle(x - 6, 1);
          drawSingle(x - 2, 3);
        } else if (bar.style === 'double') {
          // Simple double barline (section): thin + thin.
          drawSingle(x + 1, 1);
          drawSingle(x + 5, 1);
        } else {
          drawSingle(x, 1);
        }
      });
      ctxAny.restore?.();
    }

    const allNotes = ghostNote ? [...notes, { ...ghostNote, id: '__ghost__' }] : notes;
    if (allNotes && allNotes.length > 0) {
      const trebleNotes = (staffMode === 'treble_only')
        ? allNotes
        : allNotes.filter(n => (n.clef || 'treble') === 'treble');
      const bassNotes = (staffMode === 'treble_only')
        ? []
        : allNotes.filter(n => n.clef === 'bass');

      const sopranoNotes = staffMode === 'satb_ancient' ? allNotes.filter(n => n.clef === 'soprano') : [];
      const altoNotes = staffMode === 'satb_ancient' ? allNotes.filter(n => n.clef === 'alto') : [];
      const tenorNotes = staffMode === 'satb_ancient' ? allNotes.filter(n => n.clef === 'tenor') : [];
      const satbBassNotes = staffMode === 'satb_ancient' ? allNotes.filter(n => n.clef === 'bass') : [];

      const hitPoints: Array<{ id: string; x: number; y: number; isGhost: boolean }> = [];

      const drawNotesAtX = (
        staffNotes: StaffNote[],
        stave: Stave,
        clef: ClefType
      ) => {
        const prepared: Array<{
          staffNote: StaffNote;
          vfNote: StaveNote;
          dotFill: string;
          x: number;
          isPrimaryRender: boolean;
        }> = [];

        // --- PATCH: Affiancamento teste tra voci adiacenti a distanza di seconda ---
        // Raggruppa per xPosition (battuta/beat) e ordina per posizione verticale
        const byX = new Map<number, StaffNote[]>();
        for (const n of staffNotes) {
          const absX = n.xPosition ?? (stave.getNoteStartX() + 10);
          if (!byX.has(absX)) byX.set(absX, []);
          byX.get(absX)!.push(n);
        }

        // --- NEW: Merge aligned SAT notes into a single chord (parti strette) ---
        // When multiple voices share the same onset+duration on the same staff, drawing
        // them as separate notes creates stacked stems/flags/beams, which can look like
        // a shorter rhythm (e.g. 8ths visually reading as 16ths). For tight textures,
        // we render a single chord with one stem/beam and rely on proximity hitpoints
        // so each notehead remains selectable.
        const chordKeyByNoteId = new Map<string, string>();
        const chordNotesByKey = new Map<string, StaffNote[]>();
        const chordVfByKey = new Map<string, { vf: StaveNote; primaryId: string; ids: string[] }>();

        const isTightTreble = clef === 'treble' && staffNotes.some(n => n.voice === 2) && staffNotes.some(n => n.voice === 3);
        if (isTightTreble) {
          for (const [absX, group] of byX.entries()) {
            const byTime = new Map<string, StaffNote[]>();
            for (const n of group) {
              const tk = getNoteTimeKey(n);
              if (!byTime.has(tk)) byTime.set(tk, []);
              byTime.get(tk)!.push(n);
            }

            for (const [tk, g] of byTime.entries()) {
              const eligible = g
                .filter(n => n.id !== '__ghost__')
                .filter(n => !n.isRest)
                .filter(n => n.voice === 1 || n.voice === 2 || n.voice === 3)
                .filter(n => !n.manualStemDirection);

              if (eligible.length < 2) continue;

              // Require identical rhythmic value so a single chord glyph is correct.
              const baseDur = eligible[0].duration;
              const baseDotted = !!eligible[0].isDotted;
              if (!eligible.every(n => n.duration === baseDur && !!n.isDotted === baseDotted)) continue;

              const key = `${absX}|${tk}`;
              const sorted = eligible.slice().sort((a, b) => a.midi - b.midi);
              chordNotesByKey.set(key, sorted);
              for (const n of sorted) chordKeyByNoteId.set(n.id, key);
            }
          }
        }

        const makeVfChordNote = (notesInChord: StaffNote[]): { vf: StaveNote; primaryId: string; ids: string[] } => {
          const ids = notesInChord.map(n => n.id);
          const keys = notesInChord.map(n => `${n.pitch?.toLowerCase?.() || 'c'}/${n.octave ?? 4}`);
          const baseDur = durationToVexflow(notesInChord[0].duration);
          const vf = new StaveNote({ clef: clef as any, keys, duration: `${baseDur}` });

          // Stem direction from vertical placement (chord logic).
          const MIDDLE_LINE_POS_TREBLE = 6; // B4 relative to C4=0
          const avgPos = notesInChord.reduce((acc, n) => acc + (Number(n.position) || 0), 0) / Math.max(1, notesInChord.length);
          const chordStem: 'up' | 'down' = avgPos >= MIDDLE_LINE_POS_TREBLE ? 'down' : 'up';
          try {
            vf.setStemDirection(chordStem === 'up' ? 1 : -1);
          } catch {
            // ignore
          }

          // Accidentals per key index.
          for (let i = 0; i < notesInChord.length; i++) {
            const n = notesInChord[i];
            const accidentalToShow: AccidentalType | null =
              n.explicitAccidental !== undefined ? n.explicitAccidental : (n.accidental ?? null);
            const vfAcc = accidentalTypeToVexflow(accidentalToShow);
            if (!vfAcc) continue;
            try {
              vf.addModifier(new Accidental(vfAcc), i);
            } catch {
              // ignore
            }
          }

          (vf as any).__mergedIds = ids;

          // Use Alto as the default "beam voice" for merged SAT chords.
          const primary = notesInChord.find(n => n.voice === 2) ?? notesInChord[0];
          (primary as any).__beamVoiceOverride = 2;

          return { vf, primaryId: primary.id, ids };
        };

        // --- Auto stem resolution (parti strette / tight textures) ---
        // When voices 2 and 3 share the treble staff, the conventional SATB stem defaults
        // can produce crossing stems in close spacing. We unify stem directions for close
        // S/A or A/T at the same x-position to reduce clutter.
        const stemOverrideById = new Map<string, 'up' | 'down'>();
        // NOTE: stem collision avoidance is now handled primarily by chord-merging.
        // Keep individual voices on conventional stem directions when rhythms differ.
        const isTrebleTightTexture = false;
        if (isTrebleTightTexture) {
          const CLOSE_STEPS = 2; // within a third
          const MIDDLE_LINE_POS_TREBLE = 6; // B4 relative to C4=0

          for (const group of byX.values()) {
            const g = group.filter(n => !n.isRest && n.id !== '__ghost__');
            if (g.length < 2) continue;

            const v1 = g.find(n => n.voice === 1);
            const v2 = g.find(n => n.voice === 2);
            const v3 = g.find(n => n.voice === 3);

            const isManual = (n?: StaffNote) => !!n?.manualStemDirection;

            const avgPos = g.reduce((acc, n) => acc + (Number(n.position) || 0), 0) / g.length;
            const clusterDir: 'up' | 'down' = avgPos >= MIDDLE_LINE_POS_TREBLE ? 'down' : 'up';

            const saClose = !!(v1 && v2 && Math.abs(v1.position - v2.position) <= CLOSE_STEPS);
            const atClose = !!(v2 && v3 && Math.abs(v2.position - v3.position) <= CLOSE_STEPS);

            const minPos = Math.min(...g.map(n => n.position));
            const maxPos = Math.max(...g.map(n => n.position));
            const tightCluster = (maxPos - minPos) <= (CLOSE_STEPS * 2);

            if (tightCluster) {
              for (const n of g) {
                if (isManual(n)) continue;
                if (n.voice === 1 || n.voice === 2 || n.voice === 3) stemOverrideById.set(n.id, clusterDir);
              }
              continue;
            }

            if (saClose) {
              if (v1 && !isManual(v1)) stemOverrideById.set(v1.id, 'up');
              if (v2 && !isManual(v2)) stemOverrideById.set(v2.id, 'up');
            } else if (atClose) {
              if (v2 && !isManual(v2)) stemOverrideById.set(v2.id, 'down');
              if (v3 && !isManual(v3)) stemOverrideById.set(v3.id, 'down');
            }
          }
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
              // A/T (2/3): Tenore (3, up) a sinistra, Alto (2, down) a destra (quando condividono lo stesso rigo)
              // T/B (3/4): Tenore (3, up) a sinistra, Basso (4, down) a destra
              if ((n1.voice === 1 && n2.voice === 2) || (n1.voice === 2 && n2.voice === 3) || (n1.voice === 3 && n2.voice === 4)) {
                // n1 (up) a sinistra, n2 (down) a destra
                offsetMap.set(n1.id, -offset);
                offsetMap.set(n2.id, offset);
              } else if ((n1.voice === 2 && n2.voice === 1) || (n1.voice === 3 && n2.voice === 2) || (n1.voice === 4 && n2.voice === 3)) {
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
          let isPrimaryRender = true;
          try {
            const chordKey = chordKeyByNoteId.get(n.id);
            if (chordKey) {
              let chord = chordVfByKey.get(chordKey);
              if (!chord) {
                const chordNotes = chordNotesByKey.get(chordKey) ?? [n];
                chord = makeVfChordNote(chordNotes);
                chordVfByKey.set(chordKey, chord);
              }
              vfNote = chord.vf;
              isPrimaryRender = chord.primaryId === n.id;
            } else {
              vfNote = makeVfNote(n, clef, stemOverrideById.get(n.id));
              isPrimaryRender = true;
            }
            if (n.id === '__ghost__') {
              vfNote.setStyle({ fillStyle: 'rgba(56,189,248,0.85)', strokeStyle: 'rgba(14,165,233,1)', shadowColor: '#0ea5e9', shadowBlur: 8 });
              // If the ghost has an accidental, keep a smaller left shift so the
              // accidental doesn't get pushed out / trigger VF layout fallback.
              const accidentalToShow: AccidentalType | null =
                n.explicitAccidental !== undefined ? n.explicitAccidental : (n.accidental ?? null);
              const hasAccidental = !!accidentalTypeToVexflow(accidentalToShow);
              vfNote.setXShift(hasAccidental ? -6 : -18);

              // Nudge the ghost accidental further left so it doesn't overlap the notehead.
              // (Only affects the preview, not the final inserted note.)
              if (hasAccidental) {
                try {
                  const mods: any[] =
                    (vfNote as any).getModifiers?.() ??
                    (vfNote as any).modifiers ??
                    [];
                  for (const m of mods) {
                    const isAcc =
                      (m && typeof m.getCategory === 'function' && m.getCategory() === 'accidentals') ||
                      (m instanceof (Accidental as any));
                    if (!isAcc) continue;
                    try {
                      const cur = typeof m.getXShift === 'function' ? (m.getXShift() ?? 0) : 0;
                      // Note: VF's modifier x-shift direction can be counterintuitive across
                      // renderers; empirically, adding shift here moves the accidental left.
                      if (typeof m.setXShift === 'function') m.setXShift(cur + 10);
                    } catch {
                      // ignore
                    }
                  }
                } catch {
                  // ignore
                }
              }
            } else if (selectedNoteIds.includes(n.id)) {
              vfNote.setStyle({ fillStyle: '#38bdf8', strokeStyle: '#0ea5e9' });
            }
            const dotFill = n.id === '__ghost__'
              ? 'rgba(56,189,248,0.4)'
              : (selectedNoteIds.includes(n.id) ? '#38bdf8' : 'black');
            // Prefer explicit layout xPosition; if missing, try to compute from ticks (fallback)
            let absoluteX: number;
            if (typeof n.xPosition === 'number') {
              absoluteX = n.xPosition;
            } else if (typeof (n as any).startTick === 'number' && timeSignature) {
              try {
                const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
                const absBeat = (n as any).startTick / TICKS_PER_QUARTER;
                const beatInMeasure = (absBeat - Math.floor(absBeat / beatsPerMeasureLocal) * beatsPerMeasureLocal) + 1;
                const startNoteX = stave.getNoteStartX();
                    const contentWidth = Math.max(1, staffWidth - (MEASURE_PADDING_X * 2));
                const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / beatsPerMeasureLocal));
                absoluteX = startNoteX + MEASURE_PADDING_X + (rel * contentWidth);
              } catch {
                absoluteX = stave.getNoteStartX() + 10;
              }
            } else {
              absoluteX = stave.getNoteStartX() + 10;
            }

            try {
              // Clamp absoluteX to stave content area so ghost notes or computed X
              // can't escape the visible stave (fixes ghost/playhead overflow).
              const staveStart = stave.getNoteStartX();
              const contentWidth = Math.max(1, staffWidth - (MEASURE_PADDING_X * 2));
              const maxAbs = staveStart + MEASURE_PADDING_X + contentWidth - 4;
              if (typeof absoluteX === 'number' && absoluteX > maxAbs) absoluteX = maxAbs;
            } catch {
              // ignore clamp failures
            }

            try {
              if (typeof n.xPosition !== 'number') {
                // eslint-disable-next-line no-console
                console.log('[Vexflow] fallbackX', { id: n.id, startTick: (n as any).startTick, absBeat: (typeof (n as any).startTick === 'number' ? ((n as any).startTick / TICKS_PER_QUARTER) : undefined), absoluteX });
              }
            } catch (e) {
              // ignore
            }
            const xRaw = absoluteX - stave.getNoteStartX();
            const x = n.id === '__ghost__' ? Math.max(0, xRaw) : xRaw;

            if (isPrimaryRender) {
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
            }

            prepared.push({ staffNote: n, vfNote, dotFill, x, isPrimaryRender });
          } catch {
            // If pre-formatting fails, try a minimal ghost fallback; otherwise skip.
            if (n.id === '__ghost__') {
              try {
                // Keep accidentals in the ghost fallback too; the whole point of the
                // ghost is to preview the exact insertion (pitch + accidental).
                const fallbackNote = makeVfNote({ ...n } as StaffNote, clef, stemOverrideById.get(n.id));
                fallbackNote.setStave(stave);
                fallbackNote.setContext(context);
                fallbackNote.setStyle({ fillStyle: 'rgba(56,189,248,0.4)', strokeStyle: 'rgba(14,165,233,0.7)' });

                const absoluteX = (n.xPosition ?? (stave.getNoteStartX() + 10));
                const x = Math.max(0, absoluteX - stave.getNoteStartX());
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
                  isPrimaryRender: true,
                });
              } catch {
                // skip
              }

            }
            vfNote = null;
          }
        }

        if (prepared.length === 0) return;

        try {
          const firstNonGhost = prepared.find(p => p.staffNote.id !== '__ghost__') || prepared[0];
          const firstVfAbs = firstNonGhost && (firstNonGhost.vfNote as any).getAbsoluteX?.();
          // eslint-disable-next-line no-console
          console.log('[layoutData-renderer-system]', {
            staveStartX: stave.getNoteStartX(),
            firstPreparedX_rel: prepared[0] ? prepared[0].x : null,
            firstVfNoteAbsoluteX: typeof firstVfAbs === 'number' ? firstVfAbs : null,
            sampleMeasureIndex: prepared[0]?.staffNote?.measureIndex ?? null,
          });
        } catch {
          // ignore logging failures
        }
        const isBeamable = (n: StaffNote) => {
          if (n.isRest) return false;
          const dur = durationToVexflow(n.duration);
          return dur === '8' || dur === '16' || dur === '32' || dur === '64';
        };

        const isTightTrebleForBeams = clef === 'treble' && staffNotes.some(n => n.voice === 2) && staffNotes.some(n => n.voice === 3);
        const prepareTightTrebleBeamedNotes = (group: Array<{ staffNote: StaffNote; vfNote: StaveNote }>) => {
          if (!isTightTrebleForBeams) return;

          // Prefer a single clear beaming direction (opposite the bass): stems up.
          for (const g of group) {
            if (g.staffNote.manualStemDirection) continue;
            try {
              g.vfNote.setStemDirection(1);
            } catch {
              // ignore
            }
          }
        };

        const applyTightTrebleBeamHeuristics = (beam: Beam, group: Array<{ staffNote: StaffNote; vfNote: StaveNote }>) => {
          if (!isTightTrebleForBeams) return;

          // Force beam slope to follow the melodic contour (using notehead Y).
          const yRef = (vf: any): number | null => {
            try {
              const ys: number[] | undefined = vf?.getYs?.();
              if (ys && ys.length > 0) {
                // Stems up => beam is above => follow the highest notehead.
                return Math.min(...ys);
              }
              const topY = vf?.getStemExtents?.()?.topY;
              return (typeof topY === 'number' && Number.isFinite(topY)) ? topY : null;
            } catch {
              return null;
            }
          };

          const first = group[0]?.vfNote as any;
          const last = group[group.length - 1]?.vfNote as any;
          const firstY = yRef(first);
          const lastY = yRef(last);
          if (firstY == null || lastY == null) return;

          const dy = lastY - firstY;
          const THRESH_PX = 2;
          let desiredSlope = 0;
          if (dy <= -THRESH_PX) desiredSlope = -0.22;
          else if (dy >= THRESH_PX) desiredSlope = 0.22;

          try {
            // IMPORTANT: VexFlow's Beam.calculateSlope iterates `for (slope = min; slope <= max; slope += increment)`.
            // If min === max then increment=0 and the loop becomes infinite.
            // So we keep a tiny range around the target slope.
            const EPS = 0.0005;
            (beam as any).render_options = (beam as any).render_options || {};
            (beam as any).render_options.min_slope = desiredSlope - EPS;
            (beam as any).render_options.max_slope = desiredSlope + EPS;
          } catch {
            // ignore
          }
        };

        // Build Beam instances BEFORE drawing notes, so VexFlow suppresses flags/stems on beamed notes.
        const beamInstances: Beam[] = [];
        const tieInstances: StaveTie[] = [];

        // Manual beam groups (set by the editor button).
        const manualGroups = new Map<string, Array<{ staffNote: StaffNote; vfNote: StaveNote }>>();
        for (const p of prepared.filter(p => p.isPrimaryRender)) {
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
            // IMPORTANT: setStemDirection must happen BEFORE attaching a Beam.
            // In VexFlow, setStemDirection() clears note.beam, which would re-enable flags.
            prepareTightTrebleBeamedNotes(group);
            const b = new Beam(group.map(g => g.vfNote));
            applyTightTrebleBeamHeuristics(b, group);
            beamInstances.push(b);
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
          .filter(p => p.isPrimaryRender)
          .filter(p => p.staffNote.id !== '__ghost__')
          .filter(p => !manualOrDisabledIds.has(p.staffNote.id))
          .filter(p => isBeamable(p.staffNote))
          .filter(p => (p.staffNote.measureIndex ?? null) !== null && (p.staffNote.beat ?? null) !== null)
          .map(p => ({ staffNote: p.staffNote, vfNote: p.vfNote }));

        candidates.sort((a, b) => {
          const ma = a.staffNote.measureIndex ?? 0;
          const mb = b.staffNote.measureIndex ?? 0;
          if (ma !== mb) return ma - mb;
          const va = (a.staffNote as any).__beamVoiceOverride ?? (a.staffNote.voice ?? 1);
          const vb = (b.staffNote as any).__beamVoiceOverride ?? (b.staffNote.voice ?? 1);
          if (va !== vb) return va - vb;
          const ba = a.staffNote.beat ?? 1;
          const bb = b.staffNote.beat ?? 1;
          if (ba !== bb) return ba - bb;
          return (a.staffNote.xPosition ?? 0) - (b.staffNote.xPosition ?? 0);
        });

        const isCompound = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
        // `beat` is expressed in quarter-note units (1 = measure start).
        // In 6/8 (compound), the natural beam group is 3 eighths = dotted-quarter = 1.5 quarter units.
        const bucketSize = isCompound ? 1.5 : 1;
        const bucket = (beat: number) => Math.floor((beat - 1) / bucketSize);
        let current: Array<{ staffNote: StaffNote; vfNote: StaveNote }> = [];
        let currentKey: string | null = null;
        const flush = () => {
          if (current.length >= 2) {
            try {
              // Same rule as above: setStemDirection BEFORE attaching a Beam.
              prepareTightTrebleBeamedNotes(current);
              const b = new Beam(current.map(c => c.vfNote));
              applyTightTrebleBeamHeuristics(b, current);
              beamInstances.push(b);
            } catch {
              // ignore
            }
          }
          current = [];
          currentKey = null;
        };

        for (const c of candidates) {
          const m = c.staffNote.measureIndex ?? 0;
          const v = (c.staffNote as any).__beamVoiceOverride ?? (c.staffNote.voice ?? 1);
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
        const drawn = new Set<StaveNote>();
        for (const p of prepared.filter(p => p.isPrimaryRender)) {
          const n = p.staffNote;
          const vfNote = p.vfNote;
          const isMergedChord = !!(vfNote as any).__mergedIds;

          // Wrap each note in a tagged SVG group so we can reliably detect clicks.
          const group = (context as any).openGroup?.() as SVGGElement | undefined;
          if (group) {
            // For merged chords, don't tag a single id; rely on proximity hitpoints
            // so individual noteheads remain selectable.
            if (!isMergedChord) {
              group.setAttribute('data-note-id', n.id);
              if (n.id === '__ghost__') group.setAttribute('data-is-ghost', '1');
            }
          }

          let didDraw = false;
          try {
            if (!drawn.has(vfNote)) {
              vfNote.draw();
              drawn.add(vfNote);
            }
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
                  clef,
                  stemOverrideById.get(n.id)
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

          // Store hit point for proximity selection.
          // Use vfNote Y coordinates when available; otherwise fall back to mid-line.
          try {
            const ys: number[] | undefined = (vfNote as any).getYs?.();

            // Prefer VexFlow's rendered X when available; this stays correct even when
            // noteheads are shifted due to multi-voice spacing / modifiers.
            const vfAbsX = (vfNote as any).getAbsoluteX?.();
            const xHit = (typeof vfAbsX === 'number' && Number.isFinite(vfAbsX))
              ? vfAbsX
              : ((n.xPosition ?? (stave.getNoteStartX() + 10)) + (((vfNote as any).x_shift ?? 0) as number));

            const mergedIds: string[] | undefined = (vfNote as any).__mergedIds;
            if (mergedIds && ys && ys.length >= mergedIds.length) {
              for (let i = 0; i < mergedIds.length; i++) {
                hitPoints.push({ id: mergedIds[i], x: xHit, y: ys[i], isGhost: false });
              }
            } else {
              const yHit = (ys && ys.length > 0)
                ? (ys.reduce((a, b) => a + b, 0) / ys.length)
                : stave.getYForLine(2);
              hitPoints.push({ id: n.id, x: xHit, y: yHit, isGhost: n.id === '__ghost__' });
            }
          } catch {
            // ignore
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
          const tieGroup = (context as any).openGroup?.() as SVGGElement | undefined;
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

          const tieDirectionFor = (staffNote: StaffNote, vfNote: any): 1 | -1 => {
            const manualDir = (staffNote as any).manualTieDirection as ('up' | 'down' | undefined);
            if (manualDir === 'up') return 1;
            if (manualDir === 'down') return -1;
            const stemDir = vfNote?.getStemDirection?.();
            if (stemDir === 1) return -1;
            if (stemDir === -1) return 1;
            return 1;
          };

          const drawPartialTiePath = (fromX: number, toX: number, y: number, dir: 1 | -1) => {
            try {
              if (!tieGroup) return;
              const svgNS = 'http://www.w3.org/2000/svg';
              const dx = Math.max(10, toX - fromX);
              const arch = 10;
              const y0 = y + (dir === 1 ? -6 : 6);
              const cy = y0 + (dir === 1 ? -arch : arch);
              const c1x = fromX + dx * 0.25;
              const c2x = fromX + dx * 0.75;
              const path = document.createElementNS(svgNS, 'path');
              path.setAttribute('d', `M ${fromX} ${y0} C ${c1x} ${cy} ${c2x} ${cy} ${toX} ${y0}`);
              path.setAttribute('fill', 'none');
              path.setAttribute('stroke', 'black');
              path.setAttribute('stroke-width', '1.6');
              path.setAttribute('stroke-linecap', 'round');
              tieGroup.appendChild(path);
            } catch {
              // ignore
            }
          };

          const getKeyIndexFor = (p: { staffNote: StaffNote; vfNote: StaveNote }): number => {
            const mergedIds: string[] | undefined = (p.vfNote as any)?.__mergedIds;
            if (mergedIds && mergedIds.length > 0) {
              const idx = mergedIds.indexOf(p.staffNote.id);
              return idx >= 0 ? idx : 0;
            }
            return 0;
          };

          const getTieY = (vfNote: any, fallbackStave: any, keyIndex: number): number => {
            const ys: number[] | undefined = vfNote?.getYs?.();
            if (ys && ys.length > 0) {
              const i = Math.max(0, Math.min(keyIndex, ys.length - 1));
              const y = ys[i];
              if (Number.isFinite(y as any)) return y;
            }
            return fallbackStave.getYForLine(2);
          };

          const getTieRightX = (vfNote: any): number | null => {
            const x = vfNote?.getTieRightX?.();
            if (Number.isFinite(x as any)) return x;
            const headEndX = vfNote?.getNoteHeadEndX?.();
            if (Number.isFinite(headEndX as any)) return headEndX;
            const absX = vfNote?.getAbsoluteX?.();
            if (Number.isFinite(absX as any)) return absX;
            return null;
          };

          const getTieLeftX = (vfNote: any): number | null => {
            const x = vfNote?.getTieLeftX?.();
            if (Number.isFinite(x as any)) return x;
            const absX = vfNote?.getAbsoluteX?.();
            if (Number.isFinite(absX as any)) return absX;
            return null;
          };

          const staffEndX = (() => {
            const right = stave.getX() + stave.getWidth();
            return right - 10;
          })();
          const staffStartX = (() => {
            const start = stave.getNoteStartX?.();
            if (Number.isFinite(start as any)) return (start as number) - 10;
            return stave.getX() + 10;
          })();

          for (let i = 0; i < sorted.length; i++) {
            const cur = sorted[i].staffNote;
            if (!cur.isTiedToNext) continue;

            const curVoice = cur.voice ?? 1;
            let next: (typeof sorted)[number] | undefined;
            for (let j = i + 1; j < sorted.length; j++) {
              const cand = sorted[j].staffNote;
              if ((cand.voice ?? 1) === curVoice) { next = sorted[j]; break; }
            }

            if (!next) {
              // Tie continues into the next system/line: draw a partial outgoing tie.
              const vf = sorted[i].vfNote as any;
              const keyIndex = getKeyIndexFor(sorted[i]);
              const fromX = getTieRightX(vf);
              if (fromX != null) {
                const y = getTieY(vf, stave, keyIndex);
                const dir = tieDirectionFor(cur, vf);
                drawPartialTiePath(fromX, staffEndX, y, dir);
              }
              continue;
            }
            if (next.staffNote.isRest) continue;
            if (next.staffNote.midi !== cur.midi) continue;

            const firstIndex = getKeyIndexFor(sorted[i]);
            const lastIndex = getKeyIndexFor(next);
            const tie = new StaveTie({
              first_note: sorted[i].vfNote,
              last_note: next.vfNote,
              first_indices: [firstIndex],
              last_indices: [lastIndex],
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

          // Incoming ties from previous system/line (the source note is not present in this system).
          // We draw a partial tie from the left margin to the notehead.
          for (let i = 0; i < sorted.length; i++) {
            const cur = sorted[i].staffNote as any;
            if (!cur?.isTiedFromPrev) continue;

            // If a previous note in the *same system* exists for this voice and pitch, we already
            // draw a full tie above, so skip.
            const curVoice = (cur.voice ?? 1) as number;
            let hasLocalPrev = false;
            for (let j = i - 1; j >= 0; j--) {
              const cand = sorted[j].staffNote as any;
              if ((cand.voice ?? 1) !== curVoice) continue;
              if ((cand.midi ?? null) === (cur.midi ?? null) && cand.isTiedToNext) {
                hasLocalPrev = true;
              }
              break;
            }
            if (hasLocalPrev) continue;

            const vf = sorted[i].vfNote as any;
            const toX = getTieLeftX(vf);
            if (toX == null) continue;
            const keyIndex = getKeyIndexFor(sorted[i]);
            const y = getTieY(vf, stave, keyIndex);
            const dir = tieDirectionFor(cur, vf);
            drawPartialTiePath(staffStartX, toX, y, dir);
          }

          try {
            (context as any).closeGroup?.();
          } catch {
            // ignore
          }
        } catch {
          // ignore
        }
      };

      // Draw (and collect hit points) for the active system.
      if (staffMode === 'satb_ancient' && satbSoprano && satbAlto && satbTenor && satbBass) {
        drawNotesAtX(sopranoNotes, satbSoprano, 'soprano');
        drawNotesAtX(altoNotes, satbAlto, 'alto');
        drawNotesAtX(tenorNotes, satbTenor, 'tenor');
        drawNotesAtX(satbBassNotes, satbBass, 'bass');
      } else {
        if (treble) drawNotesAtX(trebleNotes, treble, 'treble');
        if (bass) drawNotesAtX(bassNotes, bass, 'bass');
      }

      noteHitPointsRef.current = hitPoints;
      onNoteHitPoints?.(hitPoints);

      // No per-note DOM wiring here: we handle clicks via the global SVG handler below
    } else {
      noteHitPointsRef.current = [];
      onNoteHitPoints?.([]);
    }
  }, [notes, timeSignature, keySignature, barlines, width, height, staffMode, selectedNoteIds, ghostNote]);

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

      // Prefer the note we started the click on (mousedown), even if mouseup lands
      // on an untagged element (e.g., a Beam path). Fall back to the mouseup target.
      const chosenNoteId = (down.downNoteId && !down.downIsGhost)
        ? down.downNoteId
        : ((upNoteId && !upIsGhost) ? upNoteId : null);

      if (chosenNoteId) {
        onNoteClickRef.current?.(chosenNoteId, e);
        return;
      }

      const proximityPick = (radiusPx: number, yBandPx: number) => {
        const candidates: Array<{ id: string; d2: number; dx: number; dy: number }> = [];
        for (const p of noteHitPointsRef.current) {
          if (p.isGhost) continue;
          const dx = p.x - x;
          const dy = p.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= radiusPx * radiusPx) {
            candidates.push({ id: p.id, d2, dx, dy });
          }
        }

        const preferred = candidates.filter(c => Math.abs(c.dy) <= yBandPx);
        const pool = preferred.length > 0 ? preferred : candidates;
        pool.sort((a, b) => a.d2 - b.d2);
        return pool;
      };

      // If the DOM target wasn't a note (beams/ledger lines/background), try a proximity pick.
      // This makes selection easier when notes overlap or are hard to click precisely.
      // IMPORTANT: In insertion mode we disable proximity-pick so clicks near adjacent voices
      // still place new notes instead of accidentally selecting the nearby voice.
      // Option/Alt still enables proximity-pick for selection-only gestures.
      if (!enableProximityPick && !e.altKey) {
        // In insertion mode, we still want a plain click on an existing note to select it.
        // Use a proximity pick only when the click is clearly near an existing note;
        // otherwise allow background clicks to fall through to insertion.
        const nearPool = proximityPick(20, 999);
        if (nearPool.length > 0) {
          const best = nearPool[0];

          // Only treat it as a note click if we're essentially on the notehead.
          // This avoids stealing clicks meant to insert a nearby 2nd/3rd.
          const ON_NOTE_DY_PX = 6;
          const ON_NOTE_DX_PX = 14;
          if (Math.abs(best.dy) <= ON_NOTE_DY_PX && Math.abs(best.dx) <= ON_NOTE_DX_PX) {
            onNoteClickRef.current?.(best.id, e);
            return;
          }
        }

        onStaffClickRef.current?.(x, y, e);
        return;
      }

      const pool = proximityPick(22, 10);

      if (pool.length > 0) {
        // Option/Alt+Click cycles through overlapping candidates.
        if (e.altKey && pool.length > 1) {
          const now = Date.now();
          const prev = lastAltPickRef.current;
          const sameSpot = !!prev && Math.hypot(prev.x - x, prev.y - y) <= 8 && (now - prev.ts) <= 2000;

          const ids = pool.map(c => c.id);
          let index = 0;
          if (sameSpot && prev && prev.ids.join('|') === ids.join('|')) {
            index = (prev.index + 1) % ids.length;
          }

          lastAltPickRef.current = { x, y, ids, index, ts: now };
          onNoteClickRef.current?.(ids[index], e);
          return;
        }

        // Default: pick the closest candidate.
        onNoteClickRef.current?.(pool[0].id, e);
        return;
      }

      // Option/Alt+Click: selection-only gesture (do not trigger insertion).
      if (e.altKey) return;
      onStaffClickRef.current?.(x, y, e);
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
      // Allow moving when hovering ghost.
      // When *not* dragging, block when hovering a real note (prevents ghost placement jitter).
      // When dragging (marquee selection), keep updating the rectangle even over notes.
      if (tagged && !isGhost && !(down && down.moved)) return;

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
