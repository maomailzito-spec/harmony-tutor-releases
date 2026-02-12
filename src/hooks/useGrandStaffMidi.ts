import { useCallback, useRef } from 'react';
import type { StaffNote, TimeSignature, TimeSignatureChange, Voice } from '../types';
import { TICKS_PER_QUARTER } from '../constants';
import { getKeySignature, getNotePropertiesFromMidi } from '../utils/musicTheory';
import { buildMidiFile } from '../utils/midiWriter';
import { parseMidi } from '../utils/midiParser';
import { electronBridge } from '../services/electronBridge';

export type GrandStaffMidiProject = {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  timeSignatureChanges?: TimeSignatureChange[];
  keySignatureRoot: string;
  isMinorMode: boolean;
  bpm?: number;
};

export type UseGrandStaffMidiArgs = {
  project: GrandStaffMidiProject;
  setProject: (next: Partial<GrandStaffMidiProject> & { notes: StaffNote[] }) => void;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function beatsToDurationFlags(beats: number): { duration: StaffNote['duration']; isDotted: boolean; isTriplet: boolean; isDuplet: boolean } {
  const bases: Array<{ duration: StaffNote['duration']; beats: number }> = [
    { duration: 'whole', beats: 4 },
    { duration: 'half', beats: 2 },
    { duration: 'quarter', beats: 1 },
    { duration: 'eighth', beats: 0.5 },
    { duration: 'sixteenth', beats: 0.25 },
    { duration: 'thirty-second', beats: 0.125 },
    { duration: 'sixty-fourth', beats: 0.0625 },
  ];

  let best = { duration: 'quarter' as StaffNote['duration'], isDotted: false, isTriplet: false, isDuplet: false, diff: Infinity };
  for (const base of bases) {
    const candidates = [
      { isDotted: false, isTriplet: false, isDuplet: false, value: base.beats },
      { isDotted: true, isTriplet: false, isDuplet: false, value: base.beats * 1.5 },
      { isDotted: false, isTriplet: true, isDuplet: false, value: base.beats * (2 / 3) },
      { isDotted: false, isTriplet: false, isDuplet: true, value: base.beats * (3 / 2) },
    ];
    for (const c of candidates) {
      const diff = Math.abs(c.value - beats);
      if (diff < best.diff) {
        best = { duration: base.duration, isDotted: c.isDotted, isTriplet: c.isTriplet, isDuplet: c.isDuplet, diff };
      }
    }
  }

  return {
    duration: best.duration,
    isDotted: best.isDotted,
    isTriplet: best.isTriplet,
    isDuplet: best.isDuplet,
  };
}

function inferClefFromMidi(midi: number): 'treble' | 'bass' {
  return midi < 60 ? 'bass' : 'treble';
}

export function useGrandStaffMidi({ project, setProject }: UseGrandStaffMidiArgs) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pickMidiFile = useCallback(async (): Promise<File | null> => {
    if (typeof document === 'undefined') return null;

    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.mid,.midi,audio/midi,audio/x-midi';
      input.style.display = 'none';
      document.body.appendChild(input);
      fileInputRef.current = input;
    }

    const input = fileInputRef.current;
    return new Promise<File | null>((resolve) => {
      const onChange = () => {
        input.removeEventListener('change', onChange);
        const file = input.files && input.files.length > 0 ? input.files[0] : null;
        input.value = '';
        resolve(file);
      };
      input.addEventListener('change', onChange);
      input.click();
    });
  }, []);

  const exportMidi = useCallback(async () => {
    const midiBytes = buildMidiFile({
      notes: project.notes || [],
      timeSignature: project.timeSignature,
      bpm: project.bpm ?? 120,
    });

    const base64 = bytesToBase64(midiBytes);

    const res = await electronBridge.saveBinaryFile(base64, undefined, [{ name: 'MIDI', extensions: ['mid', 'midi'] }]);
    if (res && res.success) return;

    // Fallback browser download.
    const blobBytes = new Uint8Array(midiBytes);
    const blob = new Blob([blobBytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.mid';
    a.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const importMidi = useCallback(async (source?: File | ArrayBuffer | string) => {
    let arrayBuffer: ArrayBuffer | null = null;

    if (!source) {
      const picked = await pickMidiFile();
      if (!picked) return;
      arrayBuffer = await picked.arrayBuffer();
    } else if (source instanceof File) {
      arrayBuffer = await source.arrayBuffer();
    } else if (source instanceof ArrayBuffer) {
      arrayBuffer = source;
    } else if (typeof source === 'string') {
      arrayBuffer = base64ToArrayBuffer(source);
    }

    if (!arrayBuffer) return;

    const parsed = parseMidi(arrayBuffer);
    const tpq = Math.max(1, parsed.tpq);
    const beatsPerMeasure = parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);
    const keySig = getKeySignature(project.keySignatureRoot || 'C', project.isMinorMode ? 'Minor' : 'Major');

    const notes: StaffNote[] = parsed.notes.map((n, idx) => {
      const absBeats = n.tick / tpq;
      const durBeats = n.durationTicks / tpq;
      const measureIndex = Math.max(0, Math.floor(absBeats / Math.max(1, beatsPerMeasure)));
      const beat = 1 + (absBeats - (measureIndex * beatsPerMeasure));

      const clef = inferClefFromMidi(n.midi);
      const props = getNotePropertiesFromMidi(n.midi, keySig, clef, null);
      const durationInfo = beatsToDurationFlags(durBeats);

      const appStartTick = Math.max(0, Math.round(absBeats * TICKS_PER_QUARTER));
      const appDurationTicks = Math.max(1, Math.round(durBeats * TICKS_PER_QUARTER));
      const voice = ((n.channel % 4) + 1) as Voice;

      return {
        id: `midi-${idx}-${appStartTick}-${n.midi}`,
        ...props,
        duration: durationInfo.duration,
        isRest: false,
        isTriplet: durationInfo.isTriplet,
        isDuplet: durationInfo.isDuplet,
        isDotted: durationInfo.isDotted,
        measureIndex,
        beat,
        startTick: appStartTick,
        durationTicks: appDurationTicks,
        voice,
      };
    });

    setProject({
      notes,
      timeSignature: parsed.timeSignature,
      timeSignatureChanges: [],
      bpm: parsed.tempoBpm,
    });
  }, [pickMidiFile, project.isMinorMode, project.keySignatureRoot, setProject]);

  return {
    exportMidi,
    importMidi,
  };
}
