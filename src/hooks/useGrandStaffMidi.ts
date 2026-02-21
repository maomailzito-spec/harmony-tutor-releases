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

    // ── Safeguard: warn & truncate if file has too many notes ──
    const MAX_IMPORT_NOTES = 5000;
    if (parsed.notes.length > MAX_IMPORT_NOTES) {
      const msg = `Il file MIDI contiene ${parsed.notes.length.toLocaleString()} note (il massimo gestibile è ~${MAX_IMPORT_NOTES.toLocaleString()}).\nVerranno importate solo le prime ${MAX_IMPORT_NOTES.toLocaleString()} note.`;
      console.warn('[MIDI import]', msg);
      try { window.alert(msg); } catch { /* ignore */ }
      parsed.notes.length = MAX_IMPORT_NOTES;
    }

    const tpq = Math.max(1, parsed.tpq);
    const beatsPerMeasure = parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);

    // Use key signature from MIDI file if available, otherwise use project key.
    let midiRoot = project.keySignatureRoot || 'C';
    let midiIsMinor = project.isMinorMode;
    if (parsed.keySignature) {
      const { sharps, isMinor } = parsed.keySignature;
      const majorRoots = ['C','G','D','A','E','B','F#','C#'];
      const flatMajorRoots = ['C','F','Bb','Eb','Ab','Db','Gb','Cb'];
      const majorRoot = sharps >= 0 ? (majorRoots[sharps] ?? 'C') : (flatMajorRoots[-sharps] ?? 'C');
      if (isMinor) {
        const minorRoots: Record<string, string> = {'C':'A','G':'E','D':'B','A':'F#','E':'C#','B':'G#','F#':'D#','C#':'A#','F':'D','Bb':'G','Eb':'C','Ab':'F','Db':'Bb','Gb':'Eb','Cb':'Ab'};
        midiRoot = minorRoots[majorRoot] ?? majorRoot;
        midiIsMinor = true;
      } else {
        midiRoot = majorRoot;
        midiIsMinor = false;
      }
    }
    const keySig = getKeySignature(midiRoot, midiIsMinor ? 'Minor' : 'Major');

    // ---------- Smart voice assignment strategy ----------
    // 1) If multiple tracks contain notes → map track → voice (SATB order)
    // 2) Else if single track but multiple channels → map channel → voice
    // 3) Fallback: pitch-based SATB distribution
    const trackSet = new Set(parsed.notes.map(n => n.track));
    const channelSet = new Set(parsed.notes.map(n => n.channel));
    const tracksWithNotes = [...trackSet].sort((a, b) => a - b);
    const channelsWithNotes = [...channelSet].sort((a, b) => a - b);

    type VoiceStrategy = 'track' | 'channel' | 'pitch';
    let strategy: VoiceStrategy;
    let voiceMap: Map<number, Voice> | null = null;

    if (tracksWithNotes.length > 1) {
      strategy = 'track';
      voiceMap = new Map<number, Voice>();
      // Map each track with notes to voices 1-4 in order; extras clamp to 4.
      tracksWithNotes.forEach((trk, idx) => {
        voiceMap!.set(trk, Math.min(idx + 1, 4) as Voice);
      });
    } else if (channelsWithNotes.length > 1) {
      strategy = 'channel';
      voiceMap = new Map<number, Voice>();
      channelsWithNotes.forEach((ch, idx) => {
        voiceMap!.set(ch, Math.min(idx + 1, 4) as Voice);
      });
    } else {
      strategy = 'pitch';
    }

    // For pitch-based strategy: collect all MIDI note numbers, then split into
    // 4 groups by quartiles (S=highest, B=lowest).
    let pitchThresholds: number[] = [];
    if (strategy === 'pitch') {
      const midiValues = parsed.notes.map(n => n.midi).sort((a, b) => a - b);
      if (midiValues.length >= 4) {
        const q1 = midiValues[Math.floor(midiValues.length * 0.25)];
        const q2 = midiValues[Math.floor(midiValues.length * 0.50)];
        const q3 = midiValues[Math.floor(midiValues.length * 0.75)];
        pitchThresholds = [q1, q2, q3]; // bass < q1, tenor < q2, alto < q3, soprano >= q3
      }
    }

    const getVoice = (n: { track: number; channel: number; midi: number }): Voice => {
      if (strategy === 'track' && voiceMap) return voiceMap.get(n.track) ?? 1 as Voice;
      if (strategy === 'channel' && voiceMap) return voiceMap.get(n.channel) ?? 1 as Voice;
      // Pitch-based
      if (pitchThresholds.length === 3) {
        if (n.midi < pitchThresholds[0]) return 4 as Voice; // Bass
        if (n.midi < pitchThresholds[1]) return 3 as Voice; // Tenor
        if (n.midi < pitchThresholds[2]) return 2 as Voice; // Alto
        return 1 as Voice; // Soprano
      }
      return 1 as Voice;
    };

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
      const voice = getVoice(n);

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

    // Note: rest generation removed — auto-generated rests from MIDI import
    // caused malformed entries (drawn but rhythmically inactive).
    // Users can add rests manually where needed.

    setProject({
      notes,
      timeSignature: parsed.timeSignature,
      timeSignatureChanges: [],
      bpm: parsed.tempoBpm,
      ...(parsed.keySignature ? { keySignatureRoot: midiRoot, isMinorMode: midiIsMinor } : {}),
    });
  }, [pickMidiFile, project.isMinorMode, project.keySignatureRoot, setProject]);

  return {
    exportMidi,
    importMidi,
  };
}
