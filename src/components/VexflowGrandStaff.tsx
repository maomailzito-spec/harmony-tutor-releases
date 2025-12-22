import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Formatter, Voice, Accidental } from 'vexflow';
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
const STAFF_MARGIN = 60;
const TREBLE_Y = 40;
const BASS_Y = 140;

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

      const vfTrebleNotes = trebleNotes.map((n) => {
        const key = `${n.pitch?.toLowerCase?.() || 'c'}/${n.octave ?? 4}`;
        const duration = n.duration ? n.duration[0] : 'q';
        const note = new StaveNote({
          clef: 'treble',
          keys: [key],
          duration,
        });
        if (n.accidental) {
          note.addModifier(new Accidental(n.accidental), 0);
        }
        if (n.id === '__ghost__') {
          note.setStyle({ fillStyle: 'rgba(56,189,248,0.4)', strokeStyle: 'rgba(14,165,233,0.7)' });
        } else if (selectedNoteIds.includes(n.id)) {
          note.setStyle({ fillStyle: '#38bdf8', strokeStyle: '#0ea5e9' });
        }
        (note as any).__staffNoteId = n.id;
        return note;
      });
      const vfBassNotes = bassNotes.map((n) => {
        const key = `${n.pitch?.toLowerCase?.() || 'c'}/${n.octave ?? 4}`;
        const duration = n.duration ? n.duration[0] : 'q';
        const note = new StaveNote({
          clef: 'bass',
          keys: [key],
          duration,
        });
        if (n.accidental) {
          note.addModifier(new Accidental(n.accidental), 0);
        }
        if (n.id === '__ghost__') {
          note.setStyle({ fillStyle: 'rgba(56,189,248,0.4)', strokeStyle: 'rgba(14,165,233,0.7)' });
        } else if (selectedNoteIds.includes(n.id)) {
          note.setStyle({ fillStyle: '#38bdf8', strokeStyle: '#0ea5e9' });
        }
        (note as any).__staffNoteId = n.id;
        return note;
      });
      if (vfTrebleNotes.length > 0) {
        const voiceTreble = new Voice({ num_beats: timeSignature.numerator, beat_value: timeSignature.denominator });
        voiceTreble.setStrict(false);
        voiceTreble.addTickables(vfTrebleNotes);
        new Formatter().joinVoices([voiceTreble]).format([voiceTreble], staffWidth - 40);
        voiceTreble.draw(context, treble);
      }
      if (vfBassNotes.length > 0) {
        const voiceBass = new Voice({ num_beats: timeSignature.numerator, beat_value: timeSignature.denominator });
        voiceBass.setStrict(false);
        voiceBass.addTickables(vfBassNotes);
        new Formatter().joinVoices([voiceBass]).format([voiceBass], staffWidth - 40);
        voiceBass.draw(context, bass);
      }
      if (onNoteClick) {
        setTimeout(() => {
          const svg = containerRef.current?.querySelector('svg');
          if (!svg) return;
          const noteheads = svg.querySelectorAll('.vf-notehead');
          const allVfNotes = [...vfTrebleNotes, ...vfBassNotes];
          noteheads.forEach((el, i) => {
            const noteObj = allVfNotes[i];
            const noteId = (noteObj as any).__staffNoteId;
            if (!noteId) return;
            el.replaceWith(el.cloneNode(true));
            const newEl = svg.querySelectorAll('.vf-notehead')[i];
            if (newEl) {
              newEl.addEventListener('click', (e: any) => {
                e.stopPropagation();
                onNoteClick(noteId);
              });
              (newEl as any).style.cursor = 'pointer';
            }
          });
        }, 0);
      }
    }
  }, [notes, timeSignature, keySignature, width, height, onNoteClick, selectedNoteIds, ghostNote]);

  useEffect(() => {
    if (!containerRef.current || !onStaffClick) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    svg.onclick = null;
    svg.addEventListener('click', (e: MouseEvent) => {
      if ((e.target as Element).closest('.vf-notehead')) return;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      onStaffClick && onStaffClick(x, y);
    });
    if (onMouseMoveStaff) {
      svg.onmousemove = (e: MouseEvent) => {
        if ((e.target as Element).closest('.vf-notehead')) return;
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        onMouseMoveStaff(x, y);
      };
    }
    return () => {
      svg.onclick = null;
      if (svg.onmousemove) svg.onmousemove = null;
    };
  }, [onStaffClick, onMouseMoveStaff, notes, timeSignature, keySignature, width, height]);

  return <div ref={containerRef} style={{ background: 'white', width, height }} />;
};

export default VexflowGrandStaff;
