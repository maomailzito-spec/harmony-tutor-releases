import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Accidental, TickContext, Dot } from 'vexflow';
import type { StaffNote, TimeSignature, KeySignature } from '../types';

interface VexflowGrandStaffProps {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  keySignature: KeySignature;
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

const makeVfNote = (n: StaffNote, clef: 'treble' | 'bass') => {
  const key = `${n.pitch?.toLowerCase?.() || 'c'}/${n.octave ?? 4}`;
  const baseDur = durationToVexflow(n.duration);
  const duration = n.isRest ? `${baseDur}r` : baseDur;
  const note = new StaveNote({
    clef,
    keys: [key],
    duration,
  });
  if (n.isDotted) {
    Dot.buildAndAttach([note], { all: true });
  }
  if (n.accidental) {
    note.addModifier(new Accidental(n.accidental), 0);
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

          // `xPosition` arriva in coordinate SVG assolute (come il mouse).
          // Quando disegniamo senza Formatter/Voice, VexFlow interpreta la TickContext X
          // come offset relativo a `stave.getNoteStartX()`.
          const absoluteX = (n.xPosition ?? (stave.getNoteStartX() + 10));
          const x = absoluteX - stave.getNoteStartX();
          const tc = new TickContext();
          tc.addTickable(vfNote);
          tc.preFormat().setX(x);

          vfNote.setStave(stave);
          vfNote.setContext(context);
          vfNote.setTickContext(tc);
          vfNote.draw();

          (context as any).closeGroup?.();
        });
      };

      drawNotesAtX(trebleNotes, treble, 'treble');
      drawNotesAtX(bassNotes, bass, 'bass');

      // No per-note DOM wiring here: we handle clicks via the global SVG handler below
    }
  }, [notes, timeSignature, keySignature, width, height, onNoteClick, selectedNoteIds, ghostNote]);

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
