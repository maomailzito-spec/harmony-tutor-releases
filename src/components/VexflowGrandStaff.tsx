import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Accidental, TickContext, Beam, StaveTie, Barline as VFBarline, TimeSignature as VFTimeSignature, Articulation } from 'vexflow';
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
  engravingMode?: 'legacy' | 'enhanced';
  onNoteClick?: (noteId: string, e: MouseEvent) => void;
  onTieClick?: (fromNoteId: string, toNoteId: string, e: MouseEvent) => void;
  selectedNoteIds?: string[];
  onStaffClick?: (x: number, y: number, e: MouseEvent) => void;
  onStaffRightClick?: (x: number, y: number, e: MouseEvent) => void;
  onMouseMoveStaff?: (x: number, y: number, modKey: boolean) => void;
  onStaffMouseDown?: (e: MouseEvent, svg: SVGSVGElement) => void;
  onBarlineRightClick?: (barlineId: string, e: MouseEvent) => void;
  ghostNote?: StaffNote | null;
  onNoteHitPoints?: (points: Array<{ id: string; x: number; y: number; isGhost: boolean }>) => void;
  enableProximityPick?: boolean;
  showVoiceColors?: boolean;
  timeSignatureChanges?: Array<{ x: number; numerator: number; denominator: number; measureIndex?: number }>;
  /** Note di accompagnamento del sistema corrente, già posizionate (xPosition baked-in
   *  con lo stesso pxPerTick delle note SATB) e filtrate per le misure del sistema.
   *  Non sono interattive: vengono renderizzate senza hit-points. */
  accompanimentNotes?: StaffNote[];
  /** Mostra le pentagrammi di accompagnamento anche se le note sono assenti.
   *  Gating coerente con "almeno una traccia visible": il parent lo calcola dalla lista. */
  showAccompanimentStaves?: boolean;
  /** Modalità rendering del Grand Staff di accompagnamento:
   *  - "grandstaff": treble + bass + brace (default)
   *  - "treble_only": solo treble (le note con clef:"bass" usano ledger lines)
   *  Default: "grandstaff" se omesso. */
  accompanimentStaffMode?: 'grandstaff' | 'treble_only';
  /** Lista delle tracce di accompagnamento. Viene usata solo per ricavare il nome
   *  (track.name) della prima traccia visibile, da stampare a sinistra del Grand Staff
   *  di accompagnamento. Non influenza le note renderizzate. */
  accompanimentTracks?: Array<{ name: string; visible?: boolean }>;
}

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 280;
// SATB needs extra bottom space so very low bass notes (e.g. C below the staff)
// are not clipped by the SVG viewport.
const DEFAULT_HEIGHT_SATB = 480;
// Keep X alignment consistent with GrandStaffEditor layout (START_X = 50)
const STAFF_MARGIN = 50;
const TREBLE_Y = 40;
const BASS_Y = 170;
// SATB (chiavi antiche): soprano (C1), alto (C3), tenor (C4), bass (F4)
// Keep these in sync with GrandStaffEditor.tsx for cursor->pitch mapping and playhead overlays.
const SOPRANO_Y = 40;
const ALTO_Y = 140;
const TENOR_Y = 240;
const SATB_BASS_Y = 340;
const MEASURE_PADDING_X = 20;

// --- Accompaniment Grand Staff (rendered BELOW the SATB Grand Staff) ---
// Gap below the bottom line of the SATB bass stave.
// 100px breakdown: ~7px Roman-numeral overhang descending into the acc area,
// ~15px headroom for high acc notes with ledger lines above the treble stave,
// and the rest as visual breathing room separating the two Grand Staffs.
const ACCOMPANIMENT_STAFF_GAP = 100;
// Span between accompaniment treble and bass tops (mirrors SATB BASS_Y - TREBLE_Y = 130).
const ACCOMPANIMENT_GS_SPAN = 130;
// 5 lines * 10px per line.
const STAVE_LINES_HEIGHT = 40;
// Y of accompaniment treble in grandstaff mode: bottom of SATB bass + gap.
const ACC_TREBLE_Y_GRANDSTAFF = BASS_Y + STAVE_LINES_HEIGHT + ACCOMPANIMENT_STAFF_GAP; // 260
// Y of accompaniment treble in satb_ancient mode: bottom of SATB bass + gap.
const ACC_TREBLE_Y_SATB_ANCIENT = SATB_BASS_Y + STAVE_LINES_HEIGHT + ACCOMPANIMENT_STAFF_GAP; // 430
// Total vertical footprint added when accompaniment is shown:
// gap + treble lines + treble->bass span + bass lines.
// (Used by parent to grow systemHeightPx; mirrored constant in GrandStaffEditor.tsx.)
export const ACCOMPANIMENT_EXTRA_PX = ACCOMPANIMENT_STAFF_GAP + STAVE_LINES_HEIGHT + ACCOMPANIMENT_GS_SPAN;

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

const durationToBeats = (n: StaffNote): number => {
  const base = (() => {
    switch (n.duration) {
      case 'whole': return 4;
      case 'half': return 2;
      case 'quarter': return 1;
      case 'eighth': return 0.5;
      case 'sixteenth': return 0.25;
      case 'thirty-second': return 0.125;
      case 'sixty-fourth': return 0.0625;
      default: return 1;
    }
  })();
  let beats = base;
  if ((n as any).isDotted) beats *= 1.5;
  // Tuplet support (best-effort): three in the time of two; two in the time of three.
  if ((n as any).isTriplet) beats *= (2 / 3);
  if ((n as any).isDuplet) beats *= (3 / 2);
  return beats;
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

const pitchLetterOf = (pitch: unknown): string => {
  try {
    const s = String(pitch || '').trim();
    const m = /[A-Ga-g]/.exec(s);
    return (m ? m[0] : 'C').toUpperCase();
  } catch {
    return 'C';
  }
};

const staffNoteToVexflowKeyName = (n: StaffNote): string => {
  // Keep the VexFlow key spelling *diatonic* (letter-only). Accidentals are rendered
  // via modifiers using measure rules (and userAccidental overrides).
  return pitchLetterOf((n as any)?.pitch).toLowerCase();
};

const normalizeAccidentalType = (accidental: AccidentalType | string | null | undefined): AccidentalType | null => {
  if (!accidental) return null;
  switch (accidental) {
    case 'sharp':
    case '#':
    case '♯':
      return 'sharp';
    case 'flat':
    case 'b':
    case '♭':
      return 'flat';
    case 'natural':
    case 'n':
    case '♮':
      return 'natural';
    case 'double-sharp':
    case '##':
    case '𝄪':
      return 'double-sharp';
    case 'double-flat':
    case 'bb':
    case '𝄫':
      return 'double-flat';
    default:
      return null;
  }
};

const defaultRestLineForVoice = (voice: number, clef: ClefType): number | null => {
  if (clef === 'treble') {
    if (voice === 3) return -3; // Tenor (parti strette): below Alto, avoid overlap with Soprano
    if (voice === 2) return -1; // Alto: under upper staff (between staves)
    if (voice === 1) return 3; // Soprano: inside upper staff
  } else if (clef === 'bass') {
    if (voice === 3) return 5; // Tenor: above lower staff (between staves)
    if (voice === 4) return 1; // Bass: inside lower staff
  }
  return null;
};

const makeVfNote = (
  n: StaffNote,
  clef: ClefType,
  stemOverride?: 'up' | 'down',
  hideStem?: boolean,
  restLineOverride?: number,
) => {
  const key = `${staffNoteToVexflowKeyName(n)}/${n.octave ?? 4}`;
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
  
  // --- Rest placement (SATB) ---
  // Keep rests for different voices in distinct vertical zones.
  // This both reads better and prevents note-vs-rest collisions in the common
  // case where one voice rests while another has notes on the same staff.
  if (n.isRest) {
    const voice = (n.voice ?? 1);
    const restLine = Number.isFinite(restLineOverride)
      ? Number(restLineOverride)
      : defaultRestLineForVoice(voice, clef);
  
    if (restLine != null) {
      try {
        (note as any).setKeyLine?.(0, restLine);
      } catch {
        // ignore
      }
    }
  }

  // Stem direction:
  // - manualStemDirection overrides everything (set by the Flip Stem button)
  // - stemOverride is an automatic layout hint (used to avoid collisions in close spacing)
  // - otherwise default by voice: S(1)↑ A(2)↓ T(3)↑ B(4)↓
  if (!n.isRest) {
    const desiredStem = n.manualStemDirection
      ?? stemOverride
      ?? (n.voice ? ((Number(n.voice) === 1 || Number(n.voice) === 3) ? 'up' : 'down') : undefined);
    if (desiredStem) {
      try {
        note.setStemDirection(desiredStem === 'up' ? 1 : -1);
      } catch {
        // Ignore: some edge-case notes (or future VF changes) might reject stem updates.
      }
    }
  }

  // In close-position (parti strette) fallback rendering, we sometimes draw separate notes
  // but want a *single* visible stem (to avoid stacked stems/flags reading as shorter rhythm).
  // Override the actual draw methods so VexFlow never paints the stem/flag at all — this is
  // far more reliable than transparent styling which VexFlow can silently override.
  if (!n.isRest && hideStem) {
    try {
      (note as any).__hideStem = true;
    } catch { /* ignore */ }
    try {
      // Completely suppress stem rendering
      (note as any).drawStem = function () { /* no-op: unison secondary stem */ };
    } catch { /* ignore */ }
    try {
      // Completely suppress flag rendering (for 8ths, 16ths, etc.)
      if (typeof (note as any).drawFlag === 'function') {
        (note as any).drawFlag = function () { /* no-op: unison secondary flag */ };
      }
    } catch { /* ignore */ }
  }
  // Ghost preview: keep the exact accidental glyph on the note itself.
  // (Final notes use measure-state rules and add modifiers later.)
  if (!n.isRest && n.id === '__ghost__') {
    const accidentalToShow: AccidentalType | null =
      normalizeAccidentalType((n as any).userAccidental)
      ?? (n.explicitAccidental != null ? n.explicitAccidental : null)
      ?? (n.accidental ?? null);
    const vfAccidental = accidentalTypeToVexflow(accidentalToShow);
    if (vfAccidental) {
      try {
        note.addModifier(new Accidental(vfAccidental), 0);
      } catch {
        // ignore
      }
    }
  }
  (note as any).__staffNoteId = n.id;
  return note;
};

const DIATONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const keySignatureDefaultAccidentalForLetter = (keySignature: KeySignature, letter: string): AccidentalType => {
  const l = String(letter || '').toUpperCase();
  if (!l) return 'natural';
  if (keySignature.type === 'sharp' && keySignature.count > 0) {
    const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    return sharpOrder.slice(0, keySignature.count).includes(l) ? 'sharp' : 'natural';
  }
  if (keySignature.type === 'flat' && keySignature.count > 0) {
    const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
    return flatOrder.slice(0, keySignature.count).includes(l) ? 'flat' : 'natural';
  }
  return 'natural';
};

const accidentalFromMidiForLetter = (midi: number, letter: string, octave: number): AccidentalType => {
  const l = String(letter || '').toUpperCase();
  const base = DIATONIC_PC[l];
  if (base == null) return 'natural';
  const natMidi = (Number(octave) + 1) * 12 + base;
  const diff = Number(midi) - natMidi;
  if (diff === 1) return 'sharp';
  if (diff === -1) return 'flat';
  if (diff === 2) return 'double-sharp';
  if (diff === -2) return 'double-flat';
  return 'natural';
};

const accidentalFromPcForLetter = (pc: number, letter: string): AccidentalType => {
  const l = String(letter || '').toUpperCase();
  const base = DIATONIC_PC[l];
  if (base == null) return 'natural';
  // choose a signed diff in [-6..+6]
  const raw = ((Number(pc) % 12) + 12) % 12;
  const d = ((raw - base + 18) % 12) - 6;
  if (d === 1) return 'sharp';
  if (d === -1) return 'flat';
  if (d === 2) return 'double-sharp';
  if (d === -2) return 'double-flat';
  return 'natural';
};

const computeMeasureAccidentalGlyphs = (
  staffNotes: StaffNote[],
  timeSignature: TimeSignature,
  keySignature: KeySignature,
): Map<string, AccidentalType | null> => {
  const out = new Map<string, AccidentalType | null>();
  const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

  const startTickOf = (n: StaffNote): number => {
    const st = (n as any)?.startTick;
    if (typeof st === 'number' && Number.isFinite(st)) return st;
    const m = Number((n as any)?.measureIndex);
    const b = Number((n as any)?.beat);
    if (Number.isFinite(m) && Number.isFinite(b)) {
      const absBeat = (m * beatsPerMeasure) + (b - 1);
      return Math.round(absBeat * TICKS_PER_QUARTER);
    }
    return 0;
  };

  const groups = new Map<number, StaffNote[]>();
  for (const n of staffNotes || []) {
    if (!n || n.id === '__ghost__') continue;
    if (n.isRest) continue;
    const mi = Number((n as any).measureIndex);
    if (!Number.isFinite(mi)) continue;
    if (!groups.has(mi)) groups.set(mi, []);
    groups.get(mi)!.push(n);
  }

  const sortedMeasures = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const mi of sortedMeasures) {
    const g = (groups.get(mi) || []).slice();
    g.sort((a, b) => startTickOf(a) - startTickOf(b) || Number(a.voice ?? 1) - Number(b.voice ?? 1) || Number(a.midi ?? 0) - Number(b.midi ?? 0));

    const state = new Map<string, AccidentalType>();
    const clefOf = (n: StaffNote): ClefType => {
      const c = (n as any)?.clef as ClefType | undefined;
      if (c === 'bass' || c === 'treble') return c;
      // Fallback: voices 3/4 are typically bass.
      const v = Number((n as any)?.voice ?? 1);
      return (v === 3 || v === 4) ? 'bass' : 'treble';
    };
    const keyOf = (clef: ClefType, letter: string, octave: number) => `${clef}:${String(letter || '').toUpperCase()}/${Number(octave)}`;
    const getState = (clef: ClefType, letter: string, octave: number): AccidentalType => {
      const key = keyOf(clef, letter, octave);
      const existing = state.get(key);
      if (existing) return existing;
      const d = keySignatureDefaultAccidentalForLetter(keySignature, letter);
      state.set(key, d);
      return d;
    };
    const setState = (clef: ClefType, letter: string, octave: number, acc: AccidentalType) => {
      state.set(keyOf(clef, letter, octave), acc);
    };

    for (const n of g) {
      const letter = pitchLetterOf((n as any).pitch);
      const octave = Number((n as any).octave);
      if (!letter || !Number.isFinite(octave) || DIATONIC_PC[letter] == null) {
        out.set(n.id, null);
        continue;
      }

      const clef = clefOf(n);

      // Prefer user-entered accidental (can include double-sharp/flat) over derived MIDI.
      const userAcc = normalizeAccidentalType((n as any).userAccidental);
      const explicitAcc = normalizeAccidentalType((n as any).explicitAccidental);
      // Always derive from MIDI/noteIndex -- the legacy `accidental` field can be
      // stale ('natural' on a flat note) in older files and localStorage drafts.
      const derivedAcc: AccidentalType =
        Number.isFinite((n as any).noteIndex)
          ? accidentalFromPcForLetter(Number((n as any).noteIndex), letter)
          : Number.isFinite((n as any).midi)
            ? accidentalFromMidiForLetter(Number((n as any).midi), letter, octave)
            : 'natural';

      const actual: AccidentalType = userAcc ?? explicitAcc ?? derivedAcc;
      const prev = getState(clef, letter, octave);

      if (actual !== prev) {
        out.set(n.id, actual);
        setState(clef, letter, octave, actual);
      } else {
        // Precautionary/cautionary accidental: show even if redundant.
        if ((n as any).forceAccidental) {
          out.set(n.id, actual);
        } else {
          out.set(n.id, null);
        }
      }
    }
  }

  return out;
};

const getNoteTimeKey = (n: StaffNote): string => {
  const st = (n as any).startTick;
  const dt = (n as any).durationTicks;
  if (typeof st === 'number' && typeof dt === 'number') return `${st}|${dt}`;
  return `${n.measureIndex ?? -1}|${n.beat ?? -1}|${n.duration ?? 'q'}|${n.isDotted ? 'd' : 'n'}`;
};

/** Onset-only key (ignoring duration) — for cross-duration collision avoidance */
const getNoteOnsetKey = (n: StaffNote): string => {
  const st = (n as any).startTick;
  if (typeof st === 'number') return `${st}`;
  return `${n.measureIndex ?? -1}|${n.beat ?? -1}`;
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
  timeSignatureChanges = [],
  keySignature,
  barlines = [],
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  staffMode = 'grandstaff',
  engravingMode = 'enhanced',
  onNoteClick,
  onTieClick,
  selectedNoteIds = [],
  onStaffClick,
  onStaffRightClick,
  onMouseMoveStaff,
  onStaffMouseDown,
  onBarlineRightClick,
  ghostNote,
  onNoteHitPoints,
  enableProximityPick = true,
  showVoiceColors = false,
  accompanimentNotes,
  showAccompanimentStaves = false,
  accompanimentStaffMode = 'grandstaff',
  accompanimentTracks,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const enableEngravingEnhancements = engravingMode === 'enhanced';
  const noteHitPointsRef = useRef<Array<{ id: string; x: number; y: number; isGhost: boolean }>>([]);
  const onTieClickRef = useRef<VexflowGrandStaffProps['onTieClick']>(onTieClick);
  const lastAltPickRef = useRef<{
    x: number;
    y: number;
    ids: string[];
    index: number;
    ts: number;
  } | null>(null);

  useEffect(() => {
    onTieClickRef.current = onTieClick;
  }, [onTieClick]);
  
  const voiceColor = (v?: number): { fill: string; stroke: string } | null => {
    // BTAS/SATB: voice 1=S, 2=A, 3=T, 4=B
    switch (v) {
      case 1: return { fill: '#3b82f6', stroke: '#1d4ed8' }; // Soprano - blue
      case 2: return { fill: '#f59e0b', stroke: '#b45309' }; // Alto - amber
      case 3: return { fill: '#22c55e', stroke: '#15803d' }; // Tenor - green
      case 4: return { fill: '#ef4444', stroke: '#b91c1c' }; // Bass - red
      default: return null;
    }
  };

  const hexToRgba = (hex: string, alpha: number): string => {
    try {
      const h = (hex || '').trim();
      const m = /^#?([0-9a-fA-F]{6})$/.exec(h);
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      const a = Math.max(0, Math.min(1, alpha));
      return `rgba(${r},${g},${b},${a})`;
    } catch {
      return hex;
    }
  };

  const applyStemStyle = (vfNote: any, staffNote: StaffNote) => {
    if (!vfNote || staffNote.id === '__ghost__') return;
    // Respect our "single-stem" fallback: never recolor a stem we intentionally hid.
    try {
      if ((vfNote as any).__hideStem) return;
    } catch {
      // ignore
    }

    if (staffNote.isRest) return;
    if (!showVoiceColors) return;
    if (selectedNoteIds.includes(staffNote.id)) return;
    if ((staffNote as any).errorType) return;
    // If this is a merged chord note, avoid coloring the shared stem.
    // (It can represent multiple voices; noteheads will be colored individually.)
    try {
      const mergedIds: string[] | undefined = vfNote?.__mergedIds;
      if (Array.isArray(mergedIds) && mergedIds.length > 0) return;
    } catch {
      // ignore
    }
    const c = voiceColor(staffNote.voice);
    if (!c) return;
    try {
      // VexFlow draws stems (especially for beamed groups) using stem style.
      // Not all builds expose setStemStyle, so guard it.
      if (typeof vfNote.setStemStyle === 'function') {
        vfNote.setStemStyle({ strokeStyle: c.stroke, fillStyle: c.stroke });
      }
    } catch {
      // ignore
    }
  };

  const applyBeamStyle = (beam: any, group: Array<{ staffNote: StaffNote; vfNote: StaveNote }>) => {
    if (!showVoiceColors) return;
    if (!beam || !group || group.length === 0) return;
    // Only color the beam if the whole group is a single voice.
    const voices = new Set(group.map(g => g.staffNote.voice ?? null));
    if (voices.size !== 1) return;
    const v = Array.from(voices)[0] as any;
    const c = voiceColor(typeof v === 'number' ? v : undefined);
    if (!c) return;
    try {
      if (typeof beam.setStyle === 'function') {
        beam.setStyle({ strokeStyle: c.stroke, fillStyle: c.stroke });
      } else {
        (beam as any).render_options = (beam as any).render_options || {};
        (beam as any).render_options.stroke_style = c.stroke;
        (beam as any).render_options.fill_style = c.stroke;
      }
    } catch {
      // ignore
    }
  };

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
    downTieFrom?: string | null;
    downTieTo?: string | null;
  };
  const downRef = useRef<DownState | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    const effectiveHeight = staffMode === 'satb_ancient' ? Math.max(height, DEFAULT_HEIGHT_SATB) : height;
    renderer.resize(width, effectiveHeight);
    const context = renderer.getContext();

    // Inject CSS for a subtle pulse effect on selected notes (no circles/overlays).
    try {
      const svgEl = containerRef.current.querySelector('svg');
      if (svgEl) {
        const existing = svgEl.querySelector('#ht-selection-style');
        if (!existing) {
          const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
          styleEl.setAttribute('id', 'ht-selection-style');
          styleEl.textContent = `
            @keyframes htSelPulse {
              0%, 100% {
                filter:
                  drop-shadow(0px 0px 0.4px rgba(56, 189, 248, 0.35))
                  drop-shadow(0px 0px 1.0px rgba(250, 204, 21, 0.28));
              }
              50% {
                filter:
                  drop-shadow(0px 0px 2.4px rgba(56, 189, 248, 1.0))
                  drop-shadow(0px 0px 4.8px rgba(250, 204, 21, 1.0));
              }
            }
            g[data-selected="1"] {
              animation: htSelPulse 0.82s ease-in-out infinite;
            }
          `;
          svgEl.appendChild(styleEl);
        }
      }
    } catch {
      // ignore
    }
    const staffWidth = width - 2 * STAFF_MARGIN;

    const keyString = keySignatureToVexflowString(keySignature);

    const treble = staffMode !== 'satb_ancient' ? new Stave(STAFF_MARGIN, TREBLE_Y, staffWidth) : null;
    const bass = (staffMode === 'grandstaff') ? new Stave(STAFF_MARGIN, BASS_Y, staffWidth) : null;
    const satbSoprano = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, SOPRANO_Y, staffWidth) : null;
    const satbAlto = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, ALTO_Y, staffWidth) : null;
    const satbTenor = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, TENOR_Y, staffWidth) : null;
    const satbBass = staffMode === 'satb_ancient' ? new Stave(STAFF_MARGIN, SATB_BASS_Y, staffWidth) : null;

    // Accompaniment staves: rendered BELOW the SATB Grand Staff when requested.
    // Same X/width as the SATB staves so barlines align horizontally.
    // In "treble_only" mode only the treble stave is created (no brace).
    const accTrebleY = staffMode === 'satb_ancient' ? ACC_TREBLE_Y_SATB_ANCIENT : ACC_TREBLE_Y_GRANDSTAFF;
    const accBassY = accTrebleY + ACCOMPANIMENT_GS_SPAN;
    const accTreble = showAccompanimentStaves ? new Stave(STAFF_MARGIN, accTrebleY, staffWidth) : null;
    const accBass = (showAccompanimentStaves && accompanimentStaffMode === 'grandstaff')
      ? new Stave(STAFF_MARGIN, accBassY, staffWidth)
      : null;

    // We draw the end-of-system barline ourselves as a single connecting line,
    // so suppress per-staff right-end barlines to avoid double-thickness.
    // (Internal measure barlines are handled separately below.)
    const stavesForEndBarSuppression: Stave[] = [treble, bass, satbSoprano, satbAlto, satbTenor, satbBass, accTreble, accBass].filter(Boolean) as Stave[];
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

    // ── Accompaniment staves (below the SATB system) ──
    // Same clef/timesig/keysig as the SATB Grand Staff. In "grandstaff" mode draws
    // treble+bass + BRACE + SINGLE_LEFT connector. In "treble_only" mode draws only
    // the treble stave (single pentagram, no brace).
    if (accTreble) {
      accTreble.addClef('treble').addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      accTreble.addKeySignature(keyString);
      accTreble.setContext(context).draw();
    }
    if (accTreble && accBass) {
      accBass.addClef('bass').addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      accBass.addKeySignature(keyString);
      accBass.setContext(context).draw();

      const accBrace = new StaveConnector(accTreble, accBass);
      accBrace.setType(StaveConnector.type.BRACE);
      accBrace.setContext(context).draw();

      const accLineLeft = new StaveConnector(accTreble, accBass);
      accLineLeft.setType(StaveConnector.type.SINGLE_LEFT);
      accLineLeft.setContext(context).draw();
    }

    // Track name label: drawn to the left of the acc Grand Staff, rotated -90°.
    if (accTreble && accompanimentTracks) {
      const firstVisible = accompanimentTracks.find(t => t.visible !== false);
      if (firstVisible?.name) {
        const svgEl = containerRef.current?.querySelector('svg');
        if (svgEl) {
          const labelX = 14;
          const labelY = (accTrebleY + accBassY + STAVE_LINES_HEIGHT) / 2 + 40;
          const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          textEl.setAttribute('x', '0');
          textEl.setAttribute('y', '4');
          textEl.setAttribute('transform', `translate(${labelX}, ${labelY}) rotate(-90)`);
          textEl.setAttribute('text-anchor', 'middle');
          textEl.setAttribute('font-family', 'Arial, sans-serif');
          textEl.setAttribute('font-size', '12');
          textEl.setAttribute('fill', 'black');
          textEl.textContent = firstVisible.name;
          svgEl.appendChild(textEl);
        }
      }
    }

    // Time signature changes (draw with VexFlow glyphs to match staff style)
    try {
      const drawTimeSignatureChange = (stave: Stave | null, x: number, n: number, d: number) => {
        if (!stave) return;
        const ts = new VFTimeSignature(`${n}/${d}`);
        ts.setContext(context);
        ts.setStave(stave);
        ts.setX(x);
        ts.draw();
      };

      (timeSignatureChanges || []).forEach(change => {
        const n = Number(change?.numerator);
        const d = Number(change?.denominator);
        const x = Number(change?.x);
        if (!Number.isFinite(n) || !Number.isFinite(d) || !Number.isFinite(x)) return;

        if (staffMode === 'satb_ancient') {
          drawTimeSignatureChange(satbSoprano, x, n, d);
          drawTimeSignatureChange(satbAlto, x, n, d);
          drawTimeSignatureChange(satbTenor, x, n, d);
          drawTimeSignatureChange(satbBass, x, n, d);
        } else {
          drawTimeSignatureChange(treble, x, n, d);
          drawTimeSignatureChange(bass, x, n, d);
        }
      });
    } catch {
      // ignore
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

      // Barlines are drawn separately per Grand Staff (SATB and Accompaniment),
      // matching standard engraving where each Grand Staff has its own bridged barlines.
      // For "treble_only" accompaniment, the range collapses to a single stave (top===bottom).
      const ranges: Array<{ top: Stave; bottom: Stave }> = [{ top: topStave, bottom: bottomStave }];
      if (accTreble) ranges.push({ top: accTreble, bottom: accBass ?? accTreble });

      const ctxAny = context as any;
      ctxAny.save?.();

      for (const range of ranges) {
        const yTop = range.top.getYForLine(0);
        const yBottom = range.bottom.getYForLine(4);

        const drawSingle = (x: number, lineWidth: number) => {
          ctxAny.setLineWidth?.(lineWidth);
          ctxAny.beginPath?.();
          ctxAny.moveTo?.(x, yTop);
          ctxAny.lineTo?.(x, yBottom);
          ctxAny.stroke?.();
        };

        // Helper: draw repeat dots between staff lines 1-2 and 2-3 on each stave
        const drawDots = (dotX: number) => {
          ctxAny.setLineWidth?.(1);
          // Treble (or top) stave dots
          const td1 = range.top.getYForLine(1.5);
          const td2 = range.top.getYForLine(2.5);
          ctxAny.beginPath?.();
          ctxAny.arc?.(dotX, td1, 1.8, 0, Math.PI * 2);
          ctxAny.fill?.();
          ctxAny.beginPath?.();
          ctxAny.arc?.(dotX, td2, 1.8, 0, Math.PI * 2);
          ctxAny.fill?.();
          // Bass (or bottom) stave dots — only if different from top
          if (range.bottom !== range.top) {
            const bd1 = range.bottom.getYForLine(1.5);
            const bd2 = range.bottom.getYForLine(2.5);
            ctxAny.beginPath?.();
            ctxAny.arc?.(dotX, bd1, 1.8, 0, Math.PI * 2);
            ctxAny.fill?.();
            ctxAny.beginPath?.();
            ctxAny.arc?.(dotX, bd2, 1.8, 0, Math.PI * 2);
            ctxAny.fill?.();
          }
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
          } else if (bar.style === 'repeat-end') {
            // :|  dots + thin + thick  (dots towards the music, on the left)
            drawDots(x - 14);
            drawSingle(x - 7, 1);
            drawSingle(x - 1, 3);
          } else if (bar.style === 'repeat-begin') {
            // |:  thick + thin + dots  (dots towards the music, on the right)
            drawSingle(x + 1, 3);
            drawSingle(x + 7, 1);
            drawDots(x + 14);
          } else if (bar.style === 'repeat-both') {
            // :|:  dots + thin + thick | thick + thin + dots
            drawDots(x - 14);
            drawSingle(x - 7, 1);
            drawSingle(x - 1, 3);
            drawSingle(x + 1, 3);
            drawSingle(x + 7, 1);
            drawDots(x + 14);
          } else {
            drawSingle(x, 1);
          }
        });
      }
      ctxAny.restore?.();
    }

    // Route ghost to ACC pipeline when it belongs to an accompaniment voice (voice 0).
    const isGhostAcc = !!(ghostNote && (ghostNote as any).voice === 0);
    const allNotes = (ghostNote && !isGhostAcc) ? [...notes, { ...ghostNote, id: '__ghost__' }] : notes;
    const allAccompanimentNotes = (ghostNote && isGhostAcc)
      ? [...(accompanimentNotes || []), { ...ghostNote, id: '__ghost__' }]
      : (accompanimentNotes || []);
    const hasAccNotes = Array.isArray(allAccompanimentNotes) && allAccompanimentNotes.length > 0;
    if ((allNotes && allNotes.length > 0) || hasAccNotes) {
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

        // Group by (rounded) xPosition so notes that should align don't miss each other
        // due to sub-pixel differences.
        const byX = new Map<number, StaffNote[]>();
        const X_BUCKET_PX = 4;
        for (const n of staffNotes) {
          const absX = n.xPosition ?? (stave.getNoteStartX() + 10);
          // VexFlow layout can shift x slightly when accidentals are added/removed;
          // use a small bucket so aligned onsets stay grouped.
          const k = Math.round(absX / X_BUCKET_PX) * X_BUCKET_PX;
          if (!byX.has(k)) byX.set(k, []);
          byX.get(k)!.push(n);
        }

        // Group by musical onset (tick-space) so edits that change visual spacing do not
        // break collision-avoidance logic (e.g., accidentals overlapping after a click).
        const byTimeKeyAll = new Map<string, StaffNote[]>();
        const byOnsetKeyAll = new Map<string, StaffNote[]>();
        for (const n of staffNotes) {
          const tk = getNoteTimeKey(n);
          if (!byTimeKeyAll.has(tk)) byTimeKeyAll.set(tk, []);
          byTimeKeyAll.get(tk)!.push(n);
          const ok = getNoteOnsetKey(n);
          if (!byOnsetKeyAll.has(ok)) byOnsetKeyAll.set(ok, []);
          byOnsetKeyAll.get(ok)!.push(n);
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

        // Edge-case: seconds + accidentals in 3-voice close position can cause VF merged chords
        // to collapse/vanish. In those cases, keep separate notes but hide stems for non-primary.
        const forceSeparateButSingleStemIds = new Set<string>();

        // Merge ONLY safe cases: 2-note seconds at the same onset+duration on treble.
        // This produces a single stem (more conventional in close-position notation)
        // while preserving per-note selection via proximity hitpoints.
        const isTightTreble = clef === 'treble';
        if (isTightTreble && enableEngravingEnhancements) {
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

              // Merge clusters of 3–4 notes only. 2-note seconds are kept as separate
              // notes with explicit X-shift (offsetMap) because VexFlow's internal chord
              // displacement doesn't work reliably in our per-note TickContext pipeline.
              if (eligible.length < 3 || eligible.length > 4) continue;

              // Only merge if the cluster contains at least one second on the staff
              // (where separate-note rendering becomes visually confusing).
              // Do NOT merge just because of accidentals — stagger handles that.
              try {
                const byPos = eligible.slice().sort((a, b) => Number(a.position) - Number(b.position));
                const hasSecond = byPos.some((n, i) => i > 0 && (Number(n.position) - Number(byPos[i - 1].position)) === 1);
                if (!hasSecond) continue;
              } catch {
                continue;
              }

              // Require identical rhythmic value so a single chord glyph is correct.
              const baseDur = eligible[0].duration;
              const baseDotted = !!eligible[0].isDotted;
              if (!eligible.every(n => n.duration === baseDur && !!n.isDotted === baseDotted)) continue;

              // Problematic case reported: 3 voices with a second + accidentals (e.g. Gb–Bb–C).
              // VF merged-chord layout can collapse noteheads in this situation.
              // Instead, keep notes separate but force a single visible up-stem (handled later).
              try {
                const byPos = eligible.slice().sort((a, b) => Number(a.position) - Number(b.position));
                const anySeconds = byPos.some((n, i) => i > 0 && (Number(n.position) - Number(byPos[i - 1].position)) === 1);
                const anyAcc = eligible.some((n: any) => {
                  const acc = normalizeAccidentalType(n?.userAccidental)
                    ?? normalizeAccidentalType(n?.explicitAccidental)
                    ?? normalizeAccidentalType(n?.accidental);
                  return !!acc;
                });
                if (eligible.length === 3 && anySeconds && anyAcc) {
                  // Keep Alto as stem carrier, hide stems on Soprano+Tenor.
                  for (const nn of eligible) {
                    if (nn.voice !== 2) forceSeparateButSingleStemIds.add(nn.id);
                  }
                  continue;
                }
              } catch {
                // ignore
              }

              // IMPORTANT: If two voices are in unison (same MIDI), merging would collapse
              // them into a single notehead and make one voice appear to disappear.
              // Keep them as separate notes in that case.
              try {
                const mids = eligible.map(n => Number((n as any).midi));
                const finite = mids.filter(m => Number.isFinite(m));
                const unique = new Set(finite);
                if (unique.size !== finite.length) continue;
              } catch {
                continue;
              }

              // Also avoid merging if two notes share the same staff position (letter+octave).
              // Even if MIDI differs (chromatic unison), a merged chord would visually collapse.
              try {
                const diatonicKeys = eligible.map(n => `${pitchLetterOf((n as any).pitch)}/${Number((n as any).octave)}`);
                const unique = new Set(diatonicKeys);
                if (unique.size !== diatonicKeys.length) continue;
              } catch {
                continue;
              }

              const key = `${absX}|${tk}`;
              const sorted = eligible.slice().sort((a, b) => a.midi - b.midi);
              chordNotesByKey.set(key, sorted);
              for (const n of sorted) chordKeyByNoteId.set(n.id, key);
            }
          }
        }

        // ── Same-direction unisons: skip secondary note entirely ──────
        // When two voices at the same onset share the same MIDI, duration, and
        // stem direction (e.g. Alto↓ + Tenor↓), the standard notation shows a
        // single notehead with one stem.  We mark the higher-numbered voice for
        // skipping so only the primary voice's StaveNote is rendered.
        const sameDirectionUnisonSkipIds = new Set<string>();
        if (clef === 'treble' && enableEngravingEnhancements) {
          for (const onset of byTimeKeyAll.values()) {
            const notes = onset.filter(n => n.id !== '__ghost__' && !n.isRest && !chordKeyByNoteId.has(n.id));
            for (let i = 0; i < notes.length; i++) {
              for (let j = i + 1; j < notes.length; j++) {
                const a = notes[i], b = notes[j];
                if (Number((a as any).midi) !== Number((b as any).midi)) continue;
                if (a.duration !== b.duration || !!a.isDotted !== !!b.isDotted) continue;
                const dirA = (a.voice ?? 1) === 1 ? 1 : -1;
                const dirB = (b.voice ?? 1) === 1 ? 1 : -1;
                if (dirA !== dirB) continue; // different directions → keep both
                const secondary = (b.voice ?? 1) > (a.voice ?? 1) ? b : a;
                sameDirectionUnisonSkipIds.add(secondary.id);
              }
            }
          }
        }

        const makeVfChordNote = (notesInChord: StaffNote[]): { vf: StaveNote; primaryId: string; ids: string[] } => {
          const ids = notesInChord.map(n => n.id);
          const keys = notesInChord.map(n => `${staffNoteToVexflowKeyName(n)}/${n.octave ?? 4}`);
          const baseDur = durationToVexflow(notesInChord[0].duration);
          const vf = new StaveNote({ clef: clef as any, keys, duration: `${baseDur}` });

          // Stem direction from vertical placement (chord logic).
          const MIDDLE_LINE_POS_TREBLE = 6; // B4 relative to C4=0
          const byPos = notesInChord.slice().sort((a, b) => Number(a.position) - Number(b.position));
          const avgPos = byPos.reduce((acc, n) => acc + (Number(n.position) || 0), 0) / Math.max(1, byPos.length);
          let chordStem: 'up' | 'down' = avgPos >= MIDDLE_LINE_POS_TREBLE ? 'down' : 'up';

          // In parti strette we often have S/A/T all on the treble staff.
          // Prefer a single UP stem for the merged chord to avoid clutter and to match
          // the intended close-position engraving.
          try {
            const hasS = notesInChord.some(n => n.voice === 1);
            const hasA = notesInChord.some(n => n.voice === 2);
            const hasT = notesInChord.some(n => n.voice === 3);
            if (hasS && hasA && hasT) chordStem = 'up';
          } catch {
            // ignore
          }

          // For seconds inside a chord, prefer the stem direction that produces the
          // most natural head staggering:
          // - if the second is at the bottom (lowest two adjacent), prefer stem DOWN so the lowest head shifts right
          // - if the second is at the top (highest two adjacent), prefer stem UP
          try {
            const hasSecond = byPos.some((n, i) => i > 0 && (Number(n.position) - Number(byPos[i - 1].position)) === 1);
            if (hasSecond && byPos.length >= 2) {
              const bottomSecond = (Number(byPos[1].position) - Number(byPos[0].position)) === 1;
              const topSecond = (Number(byPos[byPos.length - 1].position) - Number(byPos[byPos.length - 2].position)) === 1;
              if (bottomSecond && !topSecond) chordStem = 'down';
              else if (topSecond && !bottomSecond) chordStem = 'up';

              // Open-position rule near a barline: when the onset is on beat 1 and we
              // have accidentals, prefer the outer/head displacement to the RIGHT so
              // accidentals don't get pushed into the barline.
              try {
                const isMeasureStart = notesInChord.some(n => {
                  const b = Number((n as any).beat);
                  if (!Number.isFinite(b)) return false;
                  return Math.abs(b - 1) <= 1e-6;
                });
                const hasAcc = notesInChord.some((n: any) => {
                  const acc = normalizeAccidentalType(n?.userAccidental)
                    ?? normalizeAccidentalType(n?.explicitAccidental)
                    ?? normalizeAccidentalType(n?.accidental);
                  return !!acc;
                });
                if (isMeasureStart && hasAcc) chordStem = 'up';
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore
          }
          try {
            vf.setStemDirection(chordStem === 'up' ? 1 : -1);
          } catch {
            // ignore
          }

          // Accidentals are added later using measure-state rules.

          (vf as any).__mergedIds = ids;

          // Use Alto as the default "beam voice" for merged SAT chords.
          const primary = notesInChord.find(n => n.voice === 2) ?? notesInChord[0];
          (primary as any).__beamVoiceOverride = 2;

          return { vf, primaryId: primary.id, ids };
        };

        // --- Close-position (parti strette) readability helpers ---
        // In "parti strette" we can end up with 3 voices on the treble staff (S/A/T).
        // Default SATB stems (S↑ A↓ T↑) often cross and clutter; we:
        // 1) unify stems for tight clusters (based on vertical placement)
        // 2) apply consistent X shifts for clusters of seconds (2nds) to avoid notehead overlap.
        const stemOverrideById = new Map<string, 'up' | 'down'>();
        const hideStemById = new Map<string, boolean>();
        const offsetMap = new Map<string, number>();

        const NOTE_HEAD_RX = 6.3; // keep consistent with editor constants
        // For seconds, a small nudge is not enough: we need ~one notehead width to prevent overlap.
        // VexFlow noteheads are roughly 2*rx wide.
        const NOTEHEAD_TOUCH_SHIFT = (NOTE_HEAD_RX * 2.0) - 0.5; // ~12.1px
        const MIDDLE_LINE_POS_TREBLE = 6; // B4 relative to C4=0

        const isTrebleStaff = clef === 'treble';
        const enableClosePositionHeuristics = isTrebleStaff && enableEngravingEnhancements;

        const getSecondClusterOffsetsById = (
          chord: StaffNote[],
          isStemUp: boolean,
          preferRight: boolean = false,
        ): Map<string, number> => {
          const offsets = new Map<string, number>();
          if (!chord || chord.length < 2) return offsets;

          // Expect chord sorted bottom->top by staff position.
          let clusterStart = 0;
          while (clusterStart < chord.length) {
            let clusterEnd = clusterStart;
            while (
              clusterEnd < chord.length - 1
              && (Number(chord[clusterEnd + 1].position) - Number(chord[clusterEnd].position)) === 1
            ) {
              clusterEnd++;
            }

            if (clusterEnd > clusterStart) {
              const effectiveStemUp = preferRight ? true : isStemUp;
              if (effectiveStemUp) {
                // Stem up => stem on right: keep the bottom head aligned, shift alternating upper heads right.
                // This matches the common engraving convention (e.g. Bb–C => C displaced right).
                for (let i = clusterStart + 1; i <= clusterEnd; i++) {
                  const distance = i - clusterStart;
                  if (distance % 2 !== 0) offsets.set(chord[i].id, NOTEHEAD_TOUCH_SHIFT);
                }
              } else {
                // Stem down => stem on left: keep the top head aligned, shift alternating lower heads left.
                for (let i = clusterEnd - 1; i >= clusterStart; i--) {
                  const distance = clusterEnd - i;
                  if (distance % 2 !== 0) offsets.set(chord[i].id, -NOTEHEAD_TOUCH_SHIFT);
                }
              }
            }

            clusterStart = clusterEnd + 1;
          }
          return offsets;
        };

        if (enableClosePositionHeuristics) {
          for (const group of byX.values()) {
            const byTime = new Map<string, StaffNote[]>();
            for (const n of group) {
              const tk = getNoteOnsetKey(n);
              if (!byTime.has(tk)) byTime.set(tk, []);
              byTime.get(tk)!.push(n);
            }

            for (const gRaw of byTime.values()) {
              const g = gRaw
                .filter(n => n.id !== '__ghost__')
                .filter(n => !n.isRest)
                .filter(n => n.voice === 1 || n.voice === 2 || n.voice === 3);

              if (g.length < 2) continue;

              const sorted = g.slice().sort((a, b) => Number(a.position) - Number(b.position));

              // Only activate when there is an actual second (adjacent staff position)
              // to avoid shifting noteheads in normal two-voice spacing.
              const anySeconds = sorted.some((n, i) => i > 0 && (Number(n.position) - Number(sorted[i - 1].position)) === 1);
              if (!anySeconds) continue;

              // If we flagged this onset as a "force separate but single-stem" case,
              // force all stems up and hide stems for non-Alto.
              try {
                const ids = sorted.map(x => x.id);
                const hasForced = ids.some(id => forceSeparateButSingleStemIds.has(id));
                if (hasForced) {
                  const s = sorted.find(n => n.voice === 1);
                  const a = sorted.find(n => n.voice === 2);
                  const t = sorted.find(n => n.voice === 3);
                  if (s) stemOverrideById.set(s.id, 'up');
                  if (a) stemOverrideById.set(a.id, 'up');
                  if (t) stemOverrideById.set(t.id, 'up');
                  if (s) hideStemById.set(s.id, true);
                  if (t) hideStemById.set(t.id, true);

                  // Since these are rendered as separate notes at the same x, we MUST
                  // apply manual x-shifts for seconds, otherwise noteheads will overlap.
                  const xShifts = getSecondClusterOffsetsById(sorted, true /* stem up */);
                  for (const [id, dx] of xShifts.entries()) {
                    const nn = sorted.find(n => n.id === id);
                    if (nn && !nn.manualStemDirection) offsetMap.set(id, dx);
                  }

                  // Done for this onset.
                  continue;
                }
              } catch {
                // ignore
              }

              const isManual = (n: StaffNote) => !!n.manualStemDirection;
              const avgPos = sorted.reduce((acc, n) => acc + (Number(n.position) || 0), 0) / sorted.length;
              const clusterDir: 'up' | 'down' = avgPos >= MIDDLE_LINE_POS_TREBLE ? 'down' : 'up';

              const minPos = Number(sorted[0]?.position ?? 0);
              const maxPos = Number(sorted[sorted.length - 1]?.position ?? 0);
              const tightCluster = (maxPos - minPos) <= 3 || anySeconds;

              if (tightCluster) {
                // Even in tight clusters, respect voice-based stem directions
                // when multiple voices are present (S↑ A↓ T=cluster).
                const s = sorted.find(n => n.voice === 1);
                const a = sorted.find(n => n.voice === 2);
                const t = sorted.find(n => n.voice === 3);
                const multiVoice = (s ? 1 : 0) + (a ? 1 : 0) + (t ? 1 : 0) >= 2;
                if (multiVoice) {
                  if (s && !isManual(s)) stemOverrideById.set(s.id, 'up');
                  if (a && !isManual(a)) stemOverrideById.set(a.id, 'down');
                  if (t && !isManual(t)) stemOverrideById.set(t.id, 'down');
                } else {
                  for (const n of sorted) {
                    if (isManual(n)) continue;
                    stemOverrideById.set(n.id, clusterDir);
                  }
                }
              } else {
                // Keep a stable visual separation when it isn't a tight cluster.
                // Soprano stays up; Alto stays down; Tenor follows the cluster direction.
                const s = sorted.find(n => n.voice === 1);
                const a = sorted.find(n => n.voice === 2);
                const t = sorted.find(n => n.voice === 3);
                if (s && !isManual(s)) stemOverrideById.set(s.id, 'up');
                if (a && !isManual(a)) stemOverrideById.set(a.id, 'down');
                if (t && !isManual(t)) stemOverrideById.set(t.id, 'down');
              }

              // Apply notehead displacements for seconds clusters.
              const dir = stemOverrideById.get(sorted[0].id) ?? clusterDir;
              const preferRightAtBarline = (() => {
                try {
                  const isMeasureStart = sorted.some(n => {
                    const b = Number((n as any).beat);
                    if (!Number.isFinite(b)) return false;
                    return Math.abs(b - 1) <= 1e-6;
                  });
                  if (!isMeasureStart) return false;
                  const hasAcc = sorted.some((n: any) => {
                    const acc = normalizeAccidentalType(n?.userAccidental)
                      ?? normalizeAccidentalType(n?.explicitAccidental)
                      ?? normalizeAccidentalType(n?.accidental);
                    return !!acc;
                  });
                  return hasAcc;
                } catch {
                  return false;
                }
              })();
              const xShifts = (() => {
                // Mixed stems (e.g. soprano ↑ + alto ↓): stem-down note always
                // goes to the RIGHT — standard SATB engraving rule.
                const hasStemUp  = sorted.some(n => stemOverrideById.get(n.id) === 'up');
                const hasStemDown = sorted.some(n => stemOverrideById.get(n.id) === 'down');
                if (hasStemUp && hasStemDown) {
                  const m = new Map<string, number>();
                  for (let i = 1; i < sorted.length; i++) {
                    const gap = Number(sorted[i].position) - Number(sorted[i - 1].position);
                    if (gap !== 1) continue;           // not a second
                    const upper = sorted[i];           // higher pitch
                    const lower = sorted[i - 1];       // lower pitch
                    const upperDown = stemOverrideById.get(upper.id) === 'down';
                    const lowerDown = stemOverrideById.get(lower.id) === 'down';
                    if (upperDown && !lowerDown) m.set(upper.id, NOTEHEAD_TOUCH_SHIFT);
                    else if (lowerDown && !upperDown) m.set(lower.id, NOTEHEAD_TOUCH_SHIFT);
                    else m.set(upper.id, NOTEHEAD_TOUCH_SHIFT); // fallback: upper right
                  }
                  return m;
                }
                return getSecondClusterOffsetsById(sorted, dir === 'up', preferRightAtBarline);
              })();
              for (const [id, dx] of xShifts.entries()) {
                // Don't override manual tweaks; user might have fixed a specific case.
                const nn = sorted.find(n => n.id === id);
                if (nn && !isManual(nn)) offsetMap.set(id, dx);
              }
            }
          }
        }
        // --- end close-position helpers ---

        // --- Bass staff: seconds + unisons collision avoidance (voices 3+4) ---
        // The close-position heuristics above only run for treble staff.
        // On the bass staff (parti late), voices 3 (tenor) and 4 (bass) can form
        // seconds or unisons that need the same X-shift treatment.
        const isBassStaff = clef === 'bass';
        if (isBassStaff && enableEngravingEnhancements) {
          for (const group of byX.values()) {
            const byTime = new Map<string, StaffNote[]>();
            for (const n of group) {
              const tk = getNoteOnsetKey(n);
              if (!byTime.has(tk)) byTime.set(tk, []);
              byTime.get(tk)!.push(n);
            }

            for (const gRaw of byTime.values()) {
              const g = gRaw
                .filter(n => n.id !== '__ghost__')
                .filter(n => !n.isRest)
                .filter(n => n.voice === 3 || n.voice === 4);



              if (g.length < 2) continue;

              const sorted = g.slice().sort((a, b) => Number(a.position) - Number(b.position));

              // Detect seconds (adjacent staff positions).
              const anySeconds = sorted.some((n, i) => i > 0 && (Number(n.position) - Number(sorted[i - 1].position)) === 1);

              // Detect unisons (same staff position, different voices).
              const anyUnisons = sorted.some((n, i) => i > 0 && Number(n.position) === Number(sorted[i - 1].position));

              if (!anySeconds && !anyUnisons) continue;

              // For seconds between tenor (voice 3, stem UP) and bass (voice 4, stem DOWN):
              // Shift the LOWER note (bass) to the RIGHT so that the stems end up
              // on the INNER side (facing each other) — standard engraving convention
              // for two voices sharing a staff.
              if (anySeconds) {
                for (let i = 1; i < sorted.length; i++) {
                  if ((Number(sorted[i].position) - Number(sorted[i - 1].position)) === 1) {
                    // sorted is bottom-to-top: sorted[i-1] is the lower note (bass).
                    const lowerNote = sorted[i - 1];
                    if (!lowerNote.manualStemDirection && !offsetMap.has(lowerNote.id)) {
                      offsetMap.set(lowerNote.id, NOTEHEAD_TOUCH_SHIFT);
                    }
                  }
                }
              }

              // For unisons: shift the lower voice (voice 4, stem down) to the right.
              if (anyUnisons) {
                for (let i = 1; i < sorted.length; i++) {
                  if (Number(sorted[i].position) === Number(sorted[i - 1].position)) {
                    // The note with stem DOWN (voice 4) gets shifted right.
                    const downVoice = sorted[i].voice === 4 ? sorted[i] : (sorted[i - 1].voice === 4 ? sorted[i - 1] : sorted[i]);
                    if (!downVoice.manualStemDirection && !offsetMap.has(downVoice.id)) {
                      offsetMap.set(downVoice.id, NOTEHEAD_TOUCH_SHIFT);
                    }
                  }
                }
              }
            }
          }
        }

        // --- Treble staff: unisons collision avoidance (voices 1+2 or 1+2+3) ---
        // When two voices on the same staff have the same pitch (unison),
        // the noteheads overlap. Apply X-shift to separate them visually.
        if (isTrebleStaff && enableEngravingEnhancements) {
          for (const group of byX.values()) {
            const byTime = new Map<string, StaffNote[]>();
            for (const n of group) {
              const tk = getNoteOnsetKey(n);
              if (!byTime.has(tk)) byTime.set(tk, []);
              byTime.get(tk)!.push(n);
            }

            for (const gRaw of byTime.values()) {
              const g = gRaw
                .filter(n => n.id !== '__ghost__')
                .filter(n => !n.isRest);

              if (g.length < 2) continue;

              const sorted = g.slice().sort((a, b) => Number(a.position) - Number(b.position));

              // Only handle unisons here; seconds are already handled above.
              for (let i = 1; i < sorted.length; i++) {
                if (Number(sorted[i].position) === Number(sorted[i - 1].position)) {
                  // Already merged into a chord? Skip.
                  if (chordKeyByNoteId.has(sorted[i].id) && chordKeyByNoteId.has(sorted[i - 1].id)
                      && chordKeyByNoteId.get(sorted[i].id) === chordKeyByNoteId.get(sorted[i - 1].id)) continue;

                  // Determine up/down note (lower-numbered voice gets offset)
                  const downNote = (sorted[i].voice ?? 1) > (sorted[i - 1].voice ?? 1) ? sorted[i] : sorted[i - 1];
                  const upNote = downNote === sorted[i] ? sorted[i - 1] : sorted[i];

                  // For same-duration unisons, always hide the secondary stem
                  // so only one stem/flag/beam is visible — regardless of whether
                  // an offset was already applied by earlier collision avoidance.
                  if (downNote.duration === upNote.duration && !!downNote.isDotted === !!upNote.isDotted) {
                    hideStemById.set(downNote.id, true);
                  }

                  // Apply X-shift if not already offset
                  if (!offsetMap.has(sorted[i].id) && !offsetMap.has(sorted[i - 1].id)) {
                    if (!downNote.manualStemDirection) {
                      // Same-direction unisons (e.g. A↓ + T↓): push secondary
                      // LEFT so the shared stem sits between the two noteheads.
                      // Different-direction unisons (S↑ + A↓): standard RIGHT shift.
                      const sameDir = (downNote.voice ?? 1) !== 1 && (upNote.voice ?? 1) !== 1;
                      offsetMap.set(downNote.id, sameDir ? -NOTEHEAD_TOUCH_SHIFT : NOTEHEAD_TOUCH_SHIFT);
                    }
                  }
                }
              }
            }
          }
        }

        // ── Accompaniment notes: merge same-onset notes into a single VexFlow chord ──
        // Acc notes (voice=0) at the same tick must be rendered as ONE chord
        // (single stem + single set of flags/beams). Without this, two separate
        // StaveNotes at the same x position produce crossing stems and spurious
        // "traversa" artifacts.
        {
          const accByOnset = new Map<string, StaffNote[]>();
          for (const n of staffNotes) {
            if ((n.voice ?? 1) !== 0 || n.isRest || n.id === '__ghost__') continue;
            const ok = getNoteOnsetKey(n);
            if (!accByOnset.has(ok)) accByOnset.set(ok, []);
            accByOnset.get(ok)!.push(n);
          }
          for (const [ok, g] of accByOnset.entries()) {
            if (g.length < 2) continue;
            // Require identical rhythmic value so a single chord glyph is correct.
            const baseDur = g[0].duration;
            const baseDotted = !!g[0].isDotted;
            if (!g.every(n => n.duration === baseDur && !!n.isDotted === baseDotted)) continue;
            const chordKey = `acc_${ok}`;
            for (const n of g) chordKeyByNoteId.set(n.id, chordKey);
            chordNotesByKey.set(chordKey, g);
          }
        }

        const accidentalGlyphById = computeMeasureAccidentalGlyphs(staffNotes, timeSignature, keySignature);

        // --- Bass staff: cross-voice accidental collision (voices 3+4) ---
        // When two notes at the same onset are a unison/second AND both have
        // accidentals, the shifted note's accidental lands on top of the
        // non-shifted note's accidental. Fix: push the non-shifted note's
        // accidental further left so the two glyphs don't overlap.
        const bassAccPushLeftById = new Map<string, number>();
        if (isBassStaff && enableEngravingEnhancements) {
          const ACC_PUSH_LEFT = 14;
          for (const group of byX.values()) {
            const byTime = new Map<string, StaffNote[]>();
            for (const n of group) {
              const tk = getNoteOnsetKey(n);
              if (!byTime.has(tk)) byTime.set(tk, []);
              byTime.get(tk)!.push(n);
            }
            for (const gRaw of byTime.values()) {
              const g = gRaw
                .filter(n => n.id !== '__ghost__' && !n.isRest)
                .filter(n => n.voice === 3 || n.voice === 4);
              if (g.length < 2) continue;
              for (let i = 0; i < g.length; i++) {
                for (let j = i + 1; j < g.length; j++) {
                  const posDiff = Math.abs(Number(g[i].position) - Number(g[j].position));
                  if (posDiff > 1) continue;
                  const gA = accidentalTypeToVexflow(accidentalGlyphById.get(g[i].id) ?? null);
                  const gB = accidentalTypeToVexflow(accidentalGlyphById.get(g[j].id) ?? null);
                  if (!gA || !gB) continue;
                  // The non-shifted note keeps its accidental pushed further left.
                  const nonShifted = offsetMap.has(g[i].id) ? g[j] : (offsetMap.has(g[j].id) ? g[i] : null);
                  if (nonShifted) {
                    bassAccPushLeftById.set(nonShifted.id, ACC_PUSH_LEFT);
                  }
                }
              }
            }
          }
        }

        // In open position ("parti late"), the default accidental layout can leave too much
        // empty space between accidentals and the nearest notehead (especially early in a bar).
        // Compute an inset (move accidentals closer to the cluster) for multi-voice onsets
        // that do NOT contain seconds (we don't want to disturb the close-position rules).
        const openPositionAccidentalInsetById = new Map<string, number>();
        const systemStartMeasureIndex = (() => {
          try {
            const indices = (staffNotes || [])
              .map(n => Number((n as any)?.measureIndex))
              .filter(n => Number.isFinite(n));
            return indices.length ? Math.min(...indices) : null;
          } catch {
            return null;
          }
        })();
        if (isTightTreble && enableEngravingEnhancements) {
          try {
            const INSET_PX = 14;
            for (const onset of byTimeKeyAll.values()) {
                const nonRest = onset
                  .filter(n => n && n.id !== '__ghost__')
                  .filter(n => !n.isRest);
                if (nonRest.length < 2) continue; // only multi-voice onsets

                // Only pull accidentals in when close to the barline (beat 1).
                // Applying this globally can cause accidentals to collide with noteheads
                // in normal spacing (e.g., stacked thirds with 3 accidentals).
                const isMeasureStart = nonRest.some(n => {
                  const b = Number((n as any).beat);
                  return Number.isFinite(b) && Math.abs(b - 1) <= 1e-6;
                });
                if (!isMeasureStart) continue;
                const onsetMeasureIndex = Number((nonRest[0] as any)?.measureIndex);
                const isSystemStartMeasure = Number.isFinite(onsetMeasureIndex)
                  && systemStartMeasureIndex != null
                  && onsetMeasureIndex === systemStartMeasureIndex;
                if (isSystemStartMeasure) continue;

                const sorted = nonRest.slice().sort((a, b) => Number(a.position) - Number(b.position));
                const hasSecond = sorted.some((n, i) => i > 0 && (Number(n.position) - Number(sorted[i - 1].position)) === 1);
                if (hasSecond) continue;

                const withAcc = sorted.filter(n => {
                  const g = accidentalTypeToVexflow(accidentalGlyphById.get(n.id) ?? null);
                  return !!g;
                });
                if (withAcc.length < 2) continue;

                for (const n of withAcc) openPositionAccidentalInsetById.set(n.id, INSET_PX);
            }
          } catch {
            // ignore
          }
        }

        // When multiple voices share the same onset in close position, VexFlow can end up
        // placing accidentals on top of each other (especially in the "separate but single stem"
        // fallback path). Pre-compute an extra stagger per note id so accidentals fan out.
        const accidentalStaggerById = new Map<string, number>();
        if (isTightTreble && enableEngravingEnhancements) {
          try {
            const BASE_STAGGER_PX = 8;
            for (const g of byOnsetKeyAll.values()) {
                const withAcc = g
                  .filter(n => n && n.id !== '__ghost__')
                  .filter(n => !n.isRest)
                  .filter(n => {
                    const glyph = accidentalGlyphById.get(n.id) ?? null;
                    return !!accidentalTypeToVexflow(glyph);
                  });
                if (withAcc.length < 2) continue;

                // Scale stagger when 3+ accidentals share the same onset
                const staggerPx = withAcc.length >= 3 ? BASE_STAGGER_PX + 4 : BASE_STAGGER_PX;
                // Sort by position DESCENDING (alto/lower note = highest position = first).
                // The HIGHER pitched note's accidental glyph extends downward and can
                // overlap the LOWER note's notehead (e.g. Cb5 flat lands on Gb4 head).
                // So the higher note (= lowest position number) gets pushed further left.
                const sorted = withAcc.slice().sort((a, b) => Number(b.position) - Number(a.position));
                for (let i = 0; i < sorted.length; i++) {
                  accidentalStaggerById.set(sorted[i].id, i * staggerPx);
                }
            }
          } catch {
            // ignore
          }
        }

        // Auto-position rests per onset so they avoid note collisions while preserving
        // SATB vertical logic between adjacent voices (S/A and T/B).
        // ── Dense-accidental cleanup ──────────────────────────────────────
        // When 3+ notes at the same onset all carry accidentals, our custom
        // offset / stagger / inset / stem / merge logic interferes with VexFlow's
        // built-in layout and causes overlaps. Revert ALL engraving overrides
        // for those notes so they render exactly like legacy mode.
        if (enableEngravingEnhancements) {
          for (const onset of byTimeKeyAll.values()) {
            const nonRest = onset.filter(n => n && n.id !== '__ghost__' && !n.isRest);
            const withAcc = nonRest.filter(n => {
              const g = accidentalGlyphById.get(n.id) ?? null;
              return !!accidentalTypeToVexflow(g);
            });
            if (withAcc.length < 3) continue;
            // Remove custom engraving overrides for every note at this onset,
            // BUT preserve / recompute seconds displacement so noteheads
            // don't collapse on top of each other.
            const onsetSecondsIds = new Set<string>();
            try {
              const sorted = nonRest.slice().sort((a, b) => Number(a.position) - Number(b.position));
              for (let si = 1; si < sorted.length; si++) {
                const diff = Number(sorted[si].position) - Number(sorted[si - 1].position);
                // Preserve offset for seconds (diff===1) AND unisons (diff===0)
                if (diff === 0 || diff === 1) {
                  onsetSecondsIds.add(sorted[si].id);
                  onsetSecondsIds.add(sorted[si - 1].id);
                }
              }
            } catch { /* ignore */ }
            for (const n of nonRest) {
              // Preserve offset for unison notes whose stem is hidden —
              // the offset places the secondary notehead on the other side of the stem.
              // Also preserve offset for notes that form a second — without it,
              // noteheads overlap and one voice disappears.
              if (!hideStemById.has(n.id) && !onsetSecondsIds.has(n.id)) offsetMap.delete(n.id);
              accidentalStaggerById.delete(n.id);
              openPositionAccidentalInsetById.delete(n.id);
              // Keep stemOverrideById and hideStemById — voice-based stem rules
              // (S↑/A↓/T↓ and unison stems) must survive accidental cleanup.
              forceSeparateButSingleStemIds.delete(n.id);
              // Un-merge: remove from chord maps so notes render individually
              const ck = chordKeyByNoteId.get(n.id);
              if (ck) {
                chordKeyByNoteId.delete(n.id);
                chordNotesByKey.delete(ck);
                chordVfByKey.delete(ck);
              }
            }
          }
        }

        const restLineOverrideById = new Map<string, number>();
        const isClosePositionTreble = staffMode === 'grandstaff' && clef === 'treble' && staffNotes.some(sn => Number(sn?.voice ?? 0) === 3);
        const linePx = (() => {
          try {
            const y0 = stave.getYForLine(0);
            const y1 = stave.getYForLine(1);
            const d = Math.abs(y1 - y0);
            return Number.isFinite(d) && d > 0 ? d : 10;
          } catch {
            return 10;
          }
        })();
        // --- Rest vs note collision avoidance (grandstaff, parti late) ---
        // Each rest avoids notes from its adjacent voice on the same staff.
        // Upper voice rests (1, 3) push UP; lower voice rests (2, 4) push DOWN.
        // When the adjacent note moves away, the rest returns to its baseline.
        const isPartiLate = staffMode === 'grandstaff' && !isClosePositionTreble;
        const isPartiStrette = staffMode === 'grandstaff' && isClosePositionTreble;

        // Ensure ALL Tenor notes get stem DOWN in parti strette,
        // even single-voice beats not covered by the multi-voice stemOverrideById logic.
        if (isClosePositionTreble) {
          for (const n of staffNotes) {
            if (Number(n.voice ?? 1) === 3 && !n.isRest && !n.manualStemDirection && !stemOverrideById.has(n.id)) {
              stemOverrideById.set(n.id, 'down');
            }
          }
        }

        // Ensure ALL Tenor notes get stem UP on the bass staff in parti late,
        // so they don't visually merge with Bass (voice 4, stem DOWN).
        // This is the mirror of the close-position rule above.
        if (isPartiLate && clef === 'bass') {
          for (const n of staffNotes) {
            if (Number(n.voice ?? 1) === 3 && !n.isRest && !n.manualStemDirection && !stemOverrideById.has(n.id)) {
              stemOverrideById.set(n.id, 'up');
            }
          }
        }

        // Adjacent voice map: which voice's notes does this rest avoid?
        // Parti late  — treble 1↔2, bass 3↔4, cross-staff 2↔3.
        // Parti strette — treble 1↔2↔3, bass 4; cross-staff 3↔4.
        const getAdjacentVoices = (voice: number, staveClef: string): number[] => {
          if (isPartiStrette) {
            // Close position: voices 1,2,3 on treble, voice 4 on bass
            if (staveClef === 'treble') {
              if (voice === 1) return [2];
              if (voice === 2) return [1, 3];
              if (voice === 3) return [2, 4]; // tenor avoids alto + bass (cross-staff)
            } else if (staveClef === 'bass') {
              if (voice === 4) return [3]; // bass avoids tenor (cross-staff on treble)
            }
            return [];
          }
          // Parti late: voices 1,2 on treble, voices 3,4 on bass
          if (staveClef === 'treble') {
            if (voice === 1) return [2];
            if (voice === 2) return [1, 3]; // alto avoids soprano AND tenor (cross-staff)
          } else if (staveClef === 'bass') {
            if (voice === 3) return [4, 2]; // tenor avoids bass AND alto (cross-staff)
            if (voice === 4) return [3];
          }
          return [];
        };

        // Is this the upper voice on its staff? Upper voices push UP, lower push DOWN.
        const isUpperVoice = (voice: number): boolean => voice === 1 || voice === 3;

        // Get the pixel-Y of a note, using the correct stave for cross-staff notes.
        const getNoteYOnStave = (sn: StaffNote): number | null => {
          if (!sn || sn.isRest) return null;
          try {
            const noteClef = String(sn.clef || clef);
            // Pick the correct stave: if note is on a different staff, use that staff's stave.
            const noteStave = (noteClef === 'bass' && bass) ? bass
              : (noteClef === 'treble' && treble) ? treble
              : stave;
            const key = `${staffNoteToVexflowKeyName(sn)}/${sn.octave ?? 4}`;
            const baseDur = durationToVexflow(sn.duration);
            const probe = new StaveNote({ clef: noteClef as any, keys: [key], duration: baseDur });
            probe.setStave(noteStave);
            const ys = (probe as any).getYs?.();
            const y = Number(Array.isArray(ys) ? ys[0] : undefined);
            if (Number.isFinite(y)) return y;
          } catch { /* ignore */ }
          return null;
        };

        // Get the pixel-Y of a rest at a given setKeyLine value.
        const getRestYAtLine = (line: number, duration: StaffNote['duration']): number | null => {
          try {
            const baseDur = durationToVexflow(duration);
            const probe = new StaveNote({ clef: clef as any, keys: ['b/4'], duration: `${baseDur}r` });
            (probe as any).setKeyLine?.(0, line);
            probe.setStave(stave);
            const ys = (probe as any).getYs?.();
            const y = Number(Array.isArray(ys) ? ys[0] : undefined);
            if (Number.isFinite(y)) return y;
          } catch { /* ignore */ }
          return null;
        };

        // Determine which direction in setKeyLine units moves the rest UP (smaller pixel Y).
        // setKeyLine convention may differ from stave.getYForLine convention.
        const restLineUpStep = (() => {
          const y5 = getRestYAtLine(5, 'quarter');
          const y6 = getRestYAtLine(6, 'quarter');
          if (y5 != null && y6 != null) {
            // If line 6 has smaller Y than line 5, then +1 = up.
            // If line 6 has larger Y than line 5, then -1 = up.
            return y6 < y5 ? 1 : -1;
          }
          return 1; // default: assume +1 moves up (matches defaultRestLineForVoice pattern)
        })();

        // Tick helpers.
        const TICKS_Q = 960;
        const restStartTickOf = (sn: StaffNote): number => {
          if (typeof sn.startTick === 'number' && Number.isFinite(sn.startTick)) return sn.startTick;
          const mi = Number(sn.measureIndex ?? 0);
          const b = Number(sn.beat ?? 1);
          return mi * 4 * TICKS_Q + (b - 1) * TICKS_Q;
        };
        const durationTicksOf = (sn: StaffNote): number => {
          if (typeof sn.durationTicks === 'number' && sn.durationTicks > 0) return sn.durationTicks;
          const map: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
          return (map[sn.duration || 'quarter'] ?? 1) * TICKS_Q;
        };

        // Collision clearance in pixels.
        const REST_BASS_CLEARANCE_PX = 20;

        for (const [, onset] of byTimeKeyAll.entries()) {
          const rests = onset.filter(sn => sn && sn.id !== '__ghost__' && !!sn.isRest);
          if (!rests.length) continue;
          for (const r of rests) {
            const voice = Number(r.voice ?? 1);
            const fallback = defaultRestLineForVoice(voice, clef);
            if (!Number.isFinite(fallback as number)) continue;
            let line = Number(fallback);

            // Close-position treble adjustment (existing logic, unchanged).
            if (isClosePositionTreble && clef === 'treble') {
              const raisePx = voice === 1 ? 13 : (voice === 2 ? 25 : (voice === 3 ? 20 : 0));
              if (raisePx > 0) {
                line += (raisePx / linePx);
              }
            }

            // --- Rest collision avoidance for all adjacent voice pairs (parti late & strette) ---
            if (isPartiLate || isPartiStrette) {
              const adjVoices = getAdjacentVoices(voice, clef);
              if (adjVoices.length > 0) {
                // Find all non-rest notes from adjacent voices that overlap in time.
                const rStart = restStartTickOf(r);
                const rEnd = rStart + durationTicksOf(r);
                const overlapping = (allNotes || staffNotes || [])
                  .filter(sn => sn && !sn.isRest && sn.id !== '__ghost__'
                    && adjVoices.includes(Number(sn.voice ?? 1)))
                  .filter(sn => {
                    const nStart = restStartTickOf(sn);
                    const nEnd = nStart + durationTicksOf(sn);
                    return nStart < rEnd && rStart < nEnd;
                  });

                // Find the closest note (by pixel distance) among all overlapping adjacent-voice notes,
                // and track WHICH adjacent voice it belongs to so we push in the right direction.
                let closestNoteY: number | null = null;
                let closestNoteVoice: number | null = null;
                const baseRestY = getRestYAtLine(line, r.duration);
                for (const sn of overlapping) {
                  const ny = getNoteYOnStave(sn);
                  if (ny == null) continue;
                  if (closestNoteY == null
                    || (baseRestY != null && Math.abs(ny - baseRestY) < Math.abs(closestNoteY - baseRestY))) {
                    closestNoteY = ny;
                    closestNoteVoice = Number(sn.voice ?? 1);
                  }
                }

                if (closestNoteY != null && baseRestY != null) {
                  // Push direction is based on the RELATIVE voice number:
                  //   - If the colliding note's voice < rest's voice → note is from a
                  //     higher-pitched voice → push rest DOWN (away from it).
                  //   - If the colliding note's voice > rest's voice → note is from a
                  //     lower-pitched voice → push rest UP (away from it).
                  // This correctly handles voice 2 (alto) which can collide with
                  // voice 1 (soprano, above) or voice 3 (tenor, below).
                  const shouldPushUp = closestNoteVoice != null && closestNoteVoice > voice;
                  const halfStep = (shouldPushUp ? restLineUpStep : -restLineUpStep) * 0.5;
                  let restY: number | null = baseRestY;
                  let guard = 0;
                  if (shouldPushUp) {
                    // Push rest UP until gap is big enough (restY at least clearance ABOVE noteY).
                    while (guard < 100 && restY != null && (closestNoteY - restY) < REST_BASS_CLEARANCE_PX) {
                      line += halfStep;
                      restY = getRestYAtLine(line, r.duration);
                      guard++;
                    }
                  } else {
                    // Push rest DOWN until gap is big enough (restY at least clearance BELOW noteY).
                    while (guard < 100 && restY != null && (restY - closestNoteY) < REST_BASS_CLEARANCE_PX) {
                      line += halfStep;
                      restY = getRestYAtLine(line, r.duration);
                      guard++;
                    }
                  }
                }
              }
            }

            restLineOverrideById.set(r.id, line);
          }
        }

        // Quick lookup for per-chord collision heuristics (seconds + multiple accidentals).
        const staffNoteById = new Map<string, StaffNote>();
        for (const sn of staffNotes) {
          if (sn && typeof sn.id === 'string') staffNoteById.set(sn.id, sn);
        }

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
              vfNote = makeVfNote(
                n,
                clef,
                stemOverrideById.get(n.id),
                hideStemById.get(n.id),
                restLineOverrideById.get(n.id),
              );
              isPrimaryRender = true;
            }

            // Add accidentals following standard measure rules (skip ghost; ghost is handled separately).
            try {
              if (!n.isRest && n.id !== '__ghost__') {
                const glyph = accidentalGlyphById.get(n.id) ?? null;
                const vfGlyph = accidentalTypeToVexflow(glyph);
                if (vfGlyph) {
                  const mergedIds: string[] | undefined = (vfNote as any)?.__mergedIds;
                  if (Array.isArray(mergedIds) && mergedIds.length > 0) {
                    const keyStr = `${staffNoteToVexflowKeyName(n)}/${n.octave ?? 4}`;
                    const keysArr: string[] = Array.isArray((vfNote as any)?.keys) ? ((vfNote as any).keys as any) : [];
                    const keyIdx = keysArr.length ? keysArr.indexOf(keyStr) : -1;
                    const idx = keyIdx >= 0 ? keyIdx : mergedIds.indexOf(n.id);
                    if (idx >= 0) {
                      const acc = new Accidental(vfGlyph);
                      (vfNote as any).addModifier(acc, idx);

                      // Only nudge accidentals when necessary (tight seconds / multiple accidentals).
                      // Empirically (SVG renderer), increasing x-shift moves the accidental left.
                      try {
                        const chordNotes = mergedIds
                          .map(id => staffNoteById.get(String(id)))
                          .filter(Boolean) as StaffNote[];
                        const sortedByPos = chordNotes.slice().sort((a, b) => Number(a.position) - Number(b.position));
                        const hasSecond = sortedByPos.some((nn, ii) => ii > 0 && (Number(nn.position) - Number(sortedByPos[ii - 1].position)) === 1);
                        const accidentalKeyIdxs = chordNotes
                          .map((sn) => {
                            const g = accidentalTypeToVexflow(accidentalGlyphById.get(String(sn.id)) ?? null);
                            if (!g) return null;
                            const ks = `${staffNoteToVexflowKeyName(sn)}/${sn.octave ?? 4}`;
                            const ki = keysArr.length ? keysArr.indexOf(ks) : -1;
                            return ki >= 0 ? ki : null;
                          })
                          .filter((x): x is number => typeof x === 'number');
                        const hasMultipleAccidentals = accidentalKeyIdxs.length >= 2;

                        const needsNudge = hasSecond || hasMultipleAccidentals;
                        // When 3+ accidentals exist in a merged chord, VexFlow's
                        // built-in column layout handles placement correctly.
                        // Our custom shift only helps for 2-accidental cases;
                        // for denser chords it causes overlaps.
                        const skipCustomShift = accidentalKeyIdxs.length >= 3;
                        if (needsNudge && enableEngravingEnhancements && !skipCustomShift) {
                          const isFlat = (vfGlyph === 'b' || vfGlyph === 'bb');
                          const base = isFlat ? 12 : 6;
                          // Use the same step used for close-position fixes.
                          // Scale up when 3+ accidentals to avoid collisions.
                          const accCount = accidentalKeyIdxs.length;
                          const STAGGER_PX = accCount >= 3 ? 10 : 8;
                          // Extra base push when many accidentals crowd together
                          const densityBonus = accCount >= 4 ? 6 : accCount >= 3 ? 3 : 0;

                          // For seconds clusters (parti strette), order by chord key index is OK.
                          // For open position (no seconds), prefer "outer" notes to stay closer
                          // and push the more "inner" accidental further left to avoid colliding
                          // with its own notehead.
                          let stagger = 0;
                          if (hasSecond) {
                            const order = accidentalKeyIdxs.indexOf(idx);
                            stagger = order >= 0 ? (order * STAGGER_PX) : 0;
                          } else if (hasMultipleAccidentals) {
                            try {
                              const infos = chordNotes
                                .map((sn) => {
                                  const g = accidentalTypeToVexflow(accidentalGlyphById.get(String(sn.id)) ?? null);
                                  if (!g) return null;
                                  const ks = `${staffNoteToVexflowKeyName(sn)}/${sn.octave ?? 4}`;
                                  const ki = keysArr.length ? keysArr.indexOf(ks) : -1;
                                  if (ki < 0) return null;
                                  const outerness = Math.abs(Number(sn.position) - MIDDLE_LINE_POS_TREBLE);
                                  return { keyIdx: ki, outerness };
                                })
                                .filter((x): x is { keyIdx: number; outerness: number } => !!x);

                              // Outer (larger distance) should get smaller shift.
                              infos.sort((a, b) => b.outerness - a.outerness);
                              const rank = infos.findIndex(x => x.keyIdx === idx);
                              stagger = rank >= 0 ? (rank * STAGGER_PX) : 0;
                            } catch {
                              // ignore
                            }
                          }

                          const extra = accidentalStaggerById.get(n.id) ?? 0;
                          const cur = (typeof (acc as any).getXShift === 'function') ? ((acc as any).getXShift() ?? 0) : 0;
                          // In open position (parti late), pull accidentals closer to the cluster.
                          // Allow a small negative delta (move right) to remove visible empty gaps.
                          const chordMeasureIndex = Number((chordNotes[0] as any)?.measureIndex);
                          const isSystemStartMeasure = Number.isFinite(chordMeasureIndex)
                            && systemStartMeasureIndex != null
                            && chordMeasureIndex === systemStartMeasureIndex;
                          const inset = (hasSecond || isSystemStartMeasure) ? 0 : (openPositionAccidentalInsetById.get(n.id) ?? 0);
                          const desiredDelta = base + densityBonus + stagger + extra - inset;
                          // Special case: beat-1 onsets with a 2-note second + multiple accidentals
                          // can end up with accidentals too far from the noteheads due to our base shift.
                          // Pull them back by ~14px (but never to the right of VF default).
                          let beat1Inset = 0;
                          try {
                            const isMeasureStart = chordNotes.some(sn => {
                              const b = Number((sn as any).beat);
                              return Number.isFinite(b) && Math.abs(b - 1) <= 1e-6;
                            });
                            if (isMeasureStart && hasSecond && hasMultipleAccidentals && !isSystemStartMeasure) beat1Inset = 14;
                          } catch {
                            // ignore
                          }

                          const delta = hasSecond
                            ? Math.max(0, desiredDelta - beat1Inset)
                            : (inset ? Math.max(-inset, desiredDelta) : desiredDelta);
                          if (typeof (acc as any).setXShift === 'function') (acc as any).setXShift(cur + delta);
                        }
                      } catch {
                        // ignore
                      }
                    }
                  } else {
                    const acc = new Accidental(vfGlyph);
                    (vfNote as any).addModifier(acc, 0);
                    // Default spacing is usually correct, but in close-position multi-voice onsets
                    // accidentals may overlap; apply a small per-note stagger when needed.
                    // Skip custom stagger when 3+ accidentals share the same onset —
                    // VexFlow's default placement handles wide intervals well, and our
                    // stagger can push accidentals into neighboring noteheads.
                    if (enableEngravingEnhancements) {
                      try {
                        const extra = accidentalStaggerById.get(n.id) ?? 0;
                        const inset = openPositionAccidentalInsetById.get(n.id) ?? 0;
                        const bassPush = bassAccPushLeftById.get(n.id) ?? 0;
                        // Count how many accidentals exist at this onset
                        const tk = getNoteOnsetKey(n);
                        const onsetNotes = byOnsetKeyAll.get(tk) ?? [];
                        const onsetAccCount = onsetNotes.filter(nn => {
                          const g = accidentalGlyphById.get(nn.id) ?? null;
                          return !!accidentalTypeToVexflow(g);
                        }).length;
                        // Apply bass cross-voice push-left unconditionally when set
                        if (bassPush && typeof (acc as any).getXShift === 'function' && typeof (acc as any).setXShift === 'function') {
                          const cur = (acc as any).getXShift() ?? 0;
                          (acc as any).setXShift(cur + bassPush);
                        }
                        // Only apply custom stagger for ≤2 accidentals; for 3+, VF default is better
                        else if (onsetAccCount <= 2 && (extra || inset) && typeof (acc as any).getXShift === 'function' && typeof (acc as any).setXShift === 'function') {
                          const cur = (acc as any).getXShift() ?? 0;
                          // When multiple accidentals share an onset, the stagger separates them —
                          // do NOT apply inset (pull-closer) which would undo the stagger and
                          // push accidentals onto neighboring noteheads (e.g. Cb5 flat onto Gb4 head).
                          const effectiveInset = onsetAccCount >= 2 ? 0 : inset;
                          // extra pushes left; inset pulls back right.
                          (acc as any).setXShift(cur + extra - effectiveInset);
                        }
                      } catch {
                        // ignore
                      }
                    }
                  }
                }
              }
            } catch {
              // ignore
            }

            // Base style: optional per-voice color (BTAS/SATB).
            // Keep this before ghost/selection so those can override.
            const voiceForColor = (() => {
              const v = Number(n.voice);
              if (Number.isFinite(v) && v >= 1 && v <= 4) return v;
              const c = String(n.clef || '').toLowerCase();
              if (c === 'soprano') return 1;
              if (c === 'alto') return 2;
              if (c === 'tenor') return 3;
              if (c === 'bass') return 4;
              return 1;
            })();
            const vc = showVoiceColors ? voiceColor(voiceForColor) : null;
            if (vc && n.id !== '__ghost__' && !selectedNoteIds.includes(n.id) && !(n as any).errorType) {
              try {
                const mergedIds: string[] | undefined = (vfNote as any)?.__mergedIds;
                if (Array.isArray(mergedIds) && mergedIds.length > 0 && typeof (vfNote as any)?.setKeyStyle === 'function') {
                  const keyStr = `${staffNoteToVexflowKeyName(n)}/${n.octave ?? 4}`;
                  const keysArr: string[] = Array.isArray((vfNote as any)?.keys) ? ((vfNote as any).keys as any) : [];
                  const keyIdx = keysArr.length ? keysArr.indexOf(keyStr) : -1;
                  const idx = keyIdx >= 0 ? keyIdx : mergedIds.indexOf(n.id);
                  if (idx >= 0) {
                    (vfNote as any).setKeyStyle(idx, { fillStyle: vc.fill, strokeStyle: vc.stroke });
                  } else {
                    vfNote.setStyle({ fillStyle: vc.fill, strokeStyle: vc.stroke });
                  }
                } else {
                  vfNote.setStyle({ fillStyle: vc.fill, strokeStyle: vc.stroke });
                  if (n.isRest && typeof (vfNote as any)?.setKeyStyle === 'function') {
                    try {
                      (vfNote as any).setKeyStyle(0, { fillStyle: vc.fill, strokeStyle: vc.stroke });
                    } catch {
                      // ignore
                    }
                  }
                  if (n.isRest) {
                    try {
                      const glyph = (vfNote as any)?.glyph;
                      if (glyph && typeof glyph.setStyle === 'function') {
                        glyph.setStyle({ fillStyle: vc.fill, strokeStyle: vc.stroke });
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch {
                // ignore
              }
            }

            // Ensure stems keep the same color (important for beamed notes).
            applyStemStyle(vfNote as any, n);

            if (n.id === '__ghost__') {
              const gvc = voiceColor(n.voice);
              if (gvc) {
                vfNote.setStyle({
                  fillStyle: hexToRgba(gvc.fill, 0.55),
                  strokeStyle: hexToRgba(gvc.stroke, 0.95),
                  shadowColor: gvc.stroke,
                  shadowBlur: 8,
                });
              } else {
                vfNote.setStyle({ fillStyle: 'rgba(56,189,248,0.85)', strokeStyle: 'rgba(14,165,233,1)', shadowColor: '#0ea5e9', shadowBlur: 8 });
              }
              // If the ghost has an accidental, keep a smaller left shift so the
              // accidental doesn't get pushed out / trigger VF layout fallback.
              const accidentalToShow: AccidentalType | null =
                normalizeAccidentalType((n as any).userAccidental)
                ?? (n.explicitAccidental != null ? n.explicitAccidental : null)
                ?? (n.accidental ?? null);
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
              // UX: In voice-color mode (or when the note is error-colored), make selected notes use the
              // standard "normal" ink color (black) so they pop out among colored noteheads.
              // In normal mode (no voice colors and no errorType), keep the classic cyan selection.
              const wantsBlackSelection = !!showVoiceColors || !!(n as any).errorType;
              // In voice/error-color modes keep the ink black, but add a clearer selection cue:
              // cyan outline + warm yellow glow.
              const fill = wantsBlackSelection ? '#111827' : '#38bdf8';
              const stroke = wantsBlackSelection ? '#38bdf8' : '#0ea5e9';
              const baseStyle: any = {
                fillStyle: fill,
                strokeStyle: stroke,
              };

              try {
                const mergedIds: string[] | undefined = (vfNote as any)?.__mergedIds;
                if (Array.isArray(mergedIds) && mergedIds.length > 0 && typeof (vfNote as any)?.setKeyStyle === 'function') {
                  const idx = mergedIds.indexOf(n.id);
                  if (idx >= 0) {
                    // Some VexFlow builds may ignore shadow* in key styles; keep it best-effort.
                    (vfNote as any).setKeyStyle(idx, baseStyle);
                  } else {
                    vfNote.setStyle(baseStyle);
                  }
                } else {
                  vfNote.setStyle(baseStyle);
                }

                // Match stem color to selection when possible.
                try {
                  if (typeof (vfNote as any)?.setStemStyle === 'function') {
                    (vfNote as any).setStemStyle({ strokeStyle: stroke, fillStyle: stroke });
                  }
                } catch {
                  // ignore
                }
              } catch {
                vfNote.setStyle(baseStyle);
              }
            }
            const dotFill = n.id === '__ghost__'
              ? (voiceColor(n.voice) ? hexToRgba(voiceColor(n.voice)!.fill, 0.4) : 'rgba(56,189,248,0.4)')
              : (selectedNoteIds.includes(n.id)
                ? ((showVoiceColors || (n as any).errorType) ? '#111827' : '#38bdf8')
                : (showVoiceColors && vc ? vc.fill : 'black'));
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
                // fallback position — no debug logging in production
              }
            } catch (e) {
              // ignore
            }
            const xRaw = absoluteX - stave.getNoteStartX();
            const x = n.id === '__ghost__' ? Math.max(0, xRaw) : xRaw;

            if (isPrimaryRender) {
              // Applica offset se necessario (stem up: solo la testa up va a destra, stem down: solo la down va a sinistra)
              const isMergedChord = Array.isArray((vfNote as any)?.__mergedIds) && ((vfNote as any).__mergedIds.length > 0);
              let xShift = isMergedChord ? 0 : (offsetMap.get(n.id) ?? 0);

              // When this note has an accidental AND there are 4+ accidentals at the
              // same onset, suppress the note-level X shift entirely. The offset
              // moves the accidental with the notehead, causing it to collide with
              // neighbouring notes. In legacy mode (no engraving enhancements)
              // offsetMap is empty so this never happens — mimic that behavior here.
              // NOTE: threshold is 4+ (not 2+) because zeroing the shift for seconds
              // causes noteheads to overlap and one voice to visually disappear.
              if (xShift !== 0 && enableEngravingEnhancements) {
                try {
                  const glyph = accidentalGlyphById.get(n.id) ?? null;
                  if (accidentalTypeToVexflow(glyph)) {
                    const tk = getNoteTimeKey(n);
                    const onsetNotes = byTimeKeyAll.get(tk) ?? [];
                    const onsetAccCount = onsetNotes.filter(nn => {
                      const g = accidentalGlyphById.get(nn.id) ?? null;
                      return !!accidentalTypeToVexflow(g);
                    }).length;
                    if (onsetAccCount >= 4) xShift = 0;
                  }
                } catch {
                  // ignore
                }
              }

              const prevXShift = (vfNote as any).x_shift ?? 0;
              vfNote.setXShift(prevXShift + xShift);

              vfNote.setStave(stave);
              vfNote.setContext(context);
              const tc = new TickContext();
              tc.addTickable(vfNote);

              // IMPORTANT (parti strette): make sure VexFlow computes chord notehead displacements
              // for seconds BEFORE formatting, otherwise close-position merged chords can collapse
              // and upper voices appear to disappear.
              try {
                const isMergedChord = Array.isArray((vfNote as any)?.__mergedIds) && ((vfNote as any).__mergedIds.length > 0);
                if (isMergedChord && typeof (vfNote as any).calcNoteDisplacements === 'function') {
                  // Ensure key props exist (depends on clef + stave).
                  try {
                    if (typeof (vfNote as any).calculateKeyProps === 'function') {
                      (vfNote as any).calculateKeyProps();
                    }
                  } catch { /* ignore */ }

                  // Set the global displaced flag so calcNoteDisplacements
                  // accounts for seconds in the glyph width calculation.
                  // VexFlow 4.x API: setNoteDisplaced(boolean) — single flag for the whole note.
                  try {
                    const mergedIds: string[] | undefined = (vfNote as any)?.__mergedIds;
                    if (Array.isArray(mergedIds) && mergedIds.length >= 2 && typeof (vfNote as any).setNoteDisplaced === 'function') {
                      const chordNotes = mergedIds
                        .map(id => staffNoteById.get(String(id)))
                        .filter(Boolean) as StaffNote[];
                      const sortedByPos = chordNotes.slice().sort((a, b) => Number(a.position) - Number(b.position));
                      const hasSecond = sortedByPos.some((n, i) => i > 0 && (Number(n.position) - Number(sortedByPos[i - 1].position)) === 1);
                      if (hasSecond) {
                        (vfNote as any).setNoteDisplaced(true);
                      }
                    }
                  } catch { /* ignore */ }

                  (vfNote as any).calcNoteDisplacements();
                }
              } catch {
                // ignore
              }

              // ── Fermata (corona) ──
              // Render an articulation glyph above (voices 1/3) or below (voices 2/4)
              // the note. For merged chords, render once on the chord's primary note
              // if any of the merged notes carry the fermata flag.
              try {
                let hasFermata = !!(n as any).isFermata;
                const mergedIds: string[] | undefined = (vfNote as any)?.__mergedIds;
                if (!hasFermata && Array.isArray(mergedIds)) {
                  for (const mid of mergedIds) {
                    const sn = staffNoteById.get(String(mid));
                    if (sn && (sn as any).isFermata) { hasFermata = true; break; }
                  }
                }
                if (hasFermata && !n.isRest && n.id !== '__ghost__') {
                  const stemUp = (n.voice ?? 1) % 2 === 1; // voices 1/3 → up → fermata above
                  const code = stemUp ? 'a@a' : 'a@u';
                  const art = new Articulation(code).setPosition(stemUp ? 3 : 4);
                  (vfNote as any).addModifier(art, 0);
                }
              } catch { /* ignore fermata render errors */ }

              tc.preFormat();
              tc.setX(x);
              vfNote.setTickContext(tc);
              (vfNote as any).preFormat?.();
              (vfNote as any).postFormat?.();

              // Re-enforce stem direction after preFormat/postFormat which may
              // recalculate it (VexFlow internals can flip stems on certain layouts).
              try {
                const stemDir = stemOverrideById.get(n.id) ?? n.manualStemDirection;
                if (stemDir && !n.isRest) {
                  vfNote.setStemDirection(stemDir === 'up' ? 1 : -1);
                }
              } catch { /* ignore */ }
            }

            prepared.push({ staffNote: n, vfNote, dotFill, x, isPrimaryRender });
          } catch {
            // If pre-formatting fails, try a minimal ghost fallback; otherwise skip.
            if (n.id === '__ghost__') {
              try {
                // Keep accidentals in the ghost fallback too; the whole point of the
                // ghost is to preview the exact insertion (pitch + accidental).
                const fallbackNote = makeVfNote(
                  { ...n } as StaffNote,
                  clef,
                  stemOverrideById.get(n.id),
                  hideStemById.get(n.id),
                  restLineOverrideById.get(n.id),
                );
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

        const isBeamable = (n: StaffNote) => {
          if (n.isRest) return false;
          const dur = durationToVexflow(n.duration);
          return dur === '8' || dur === '16' || dur === '32' || dur === '64';
        };

        const isTightTrebleForBeams = staffMode === 'grandstaff' && clef === 'treble' && staffNotes.filter(n => !n.isRest).some(n => (n.voice ?? 1) >= 2);

        // Standard 3+1 (parti strette) stem directions:
        //   Layer 1 (Soprano v1): stems ALWAYS UP
        //   Layer 2 (Alto v2 + Tenor v3): stems ALWAYS DOWN (treated as single chord layer)
        const getTightStemDir = (sn: StaffNote): number => {
          const v = (sn as any).__beamVoiceOverride ?? (sn.voice ?? 1);
          return (v === 1) ? 1 : -1;  // S↑, A↓, T↓
        };

        const prepareTightTrebleBeamedNotes = (group: Array<{ staffNote: StaffNote; vfNote: StaveNote }>) => {
          if (!isTightTrebleForBeams) return;

          // Standard parti strette: S always UP, A+T always DOWN.
          // S always UP, T always DOWN, A dynamic (UP near S, DOWN near T).
          for (const g of group) {
            if (g.staffNote.manualStemDirection) continue;
            const dir = getTightStemDir(g.staffNote);
            try {
              g.vfNote.setStemDirection(dir);
            } catch {
              // ignore
            }

            // Re-apply drawStem/drawFlag no-op for hidden-stem unison notes.
            // setStemDirection() above can recreate the stem object, losing
            // the override set during note creation.
            if ((g.vfNote as any).__hideStem) {
              try { (g.vfNote as any).drawStem = function () { /* no-op */ }; } catch { /* ignore */ }
              try { if (typeof (g.vfNote as any).drawFlag === 'function') { (g.vfNote as any).drawFlag = function () { /* no-op */ }; } } catch { /* ignore */ }
            }

            // Keep stems colored even after forcing stem direction.
            try {
              applyStemStyle(g.vfNote as any, g.staffNote);
            } catch {
              // ignore
            }
          }
        };

        const applyTightTrebleBeamHeuristics = (beam: Beam, group: Array<{ staffNote: StaffNote; vfNote: StaveNote }>) => {
          if (!isTightTrebleForBeams) return;

          // Determine the dominant stem direction of this beam group
          const stemDir = (group[0]?.vfNote as any)?.getStemDirection?.() ?? 1;

          // Force beam slope to follow the melodic contour (using notehead Y).
          const yRef = (vf: any): number | null => {
            try {
              const ys: number[] | undefined = vf?.getYs?.();
              if (ys && ys.length > 0) {
                // Stems up => beam above => follow highest notehead (min Y).
                // Stems down => beam below => follow lowest notehead (max Y).
                return stemDir === 1 ? Math.min(...ys) : Math.max(...ys);
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
          // Use a gentler slope for inner voices (alto = voice 2, tenor = voice 3)
          // to prevent beams from overlapping adjacent voices.
          const voices = new Set(group.map(g => g.staffNote.voice ?? 1));
          const isInnerVoice = voices.has(2) || voices.has(3);
          const MAX_SLOPE = isInnerVoice ? 0.10 : 0.18;
          let desiredSlope = 0;
          if (dy <= -THRESH_PX) desiredSlope = -MAX_SLOPE;
          else if (dy >= THRESH_PX) desiredSlope = MAX_SLOPE;

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
        const beamInstances: Array<{ beam: Beam; isSelected: boolean }> = [];

        // Clamp beam slope for ALL voices (global safety net).
        // The tight-treble heuristics may already set a lower slope for inner voices;
        // this function only tightens the bounds if they haven't been set or are too wide.
        const clampBeamSlope = (beam: Beam, group: Array<{ staffNote: StaffNote; vfNote: StaveNote }>) => {
          try {
            const ro = (beam as any).render_options = (beam as any).render_options || {};
            const voices = new Set(group.map(g => g.staffNote.voice ?? 1));
            const isInner = voices.has(2) || voices.has(3);
            const limit = isInner ? 0.10 : 0.18;
            // Only tighten — never widen past the limit
            if (ro.max_slope == null || ro.max_slope > limit) ro.max_slope = limit;
            if (ro.min_slope == null || ro.min_slope < -limit) ro.min_slope = -limit;
          } catch { /* ignore */ }
        };
          const tieInstances: Array<{ tie: StaveTie; fromId: string; toId: string }> = [];

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
            clampBeamSlope(b, group);
            applyBeamStyle(b as any, group);
            const isSelected = group.every(g => selectedNoteIds.includes(String(g.staffNote.id)));
            beamInstances.push({ beam: b, isSelected });
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
          .filter(p => !hideStemById.get(p.staffNote.id))
          .filter(p => isBeamable(p.staffNote))
          .filter(p => (p.staffNote.measureIndex ?? null) !== null && (p.staffNote.beat ?? null) !== null)
          .map(p => ({ staffNote: p.staffNote, vfNote: p.vfNote }));

        candidates.sort((a, b) => {
          const ma = a.staffNote.measureIndex ?? 0;
          const mb = b.staffNote.measureIndex ?? 0;
          if (ma !== mb) return ma - mb;

          // In tight-treble mode, sort by stem direction then beat (not voice)
          // so that same-direction voices are adjacent for beam grouping.
          if (isTightTrebleForBeams) {
            const da = getTightStemDir(a.staffNote);
            const db = getTightStemDir(b.staffNote);
            if (da !== db) return da - db;            // up-stem group first
          } else {
            const va = (a.staffNote as any).__beamVoiceOverride ?? (a.staffNote.voice ?? 1);
            const vb = (b.staffNote as any).__beamVoiceOverride ?? (b.staffNote.voice ?? 1);
            if (va !== vb) return va - vb;
          }

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
              // setStemDirection BEFORE attaching a Beam.
              prepareTightTrebleBeamedNotes(current);
              const b = new Beam(current.map(c => c.vfNote));
              applyTightTrebleBeamHeuristics(b, current);
              clampBeamSlope(b, current);
              applyBeamStyle(b as any, current);
              const isSelected = current.every(c => selectedNoteIds.includes(String(c.staffNote.id)));
              beamInstances.push({ beam: b, isSelected });
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

          // In tight-treble mode, group by stem direction instead of voice so
          // voices sharing the same direction produce a SINGLE beam rather than
          // stacked duplicates that make 8ths look like 16ths.
          let groupVoice: number | string = v;
          if (isTightTrebleForBeams) {
            const dir = getTightStemDir(c.staffNote);
            groupVoice = `d${dir}`;
          }

          const key = `${m}|${groupVoice}|${bucket(b)}`;
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
          const mergedIds: string[] | undefined = (vfNote as any).__mergedIds;
          const isMergedChord = !!mergedIds;

          const isSelected = (() => {
            try {
              if (Array.isArray(mergedIds) && mergedIds.length > 0) {
                return mergedIds.some(id => selectedNoteIds.includes(String(id)));
              }
              return selectedNoteIds.includes(n.id);
            } catch {
              return false;
            }
          })();

          // Wrap each note in a tagged SVG group so we can reliably detect clicks.
          const group = (context as any).openGroup?.() as SVGGElement | undefined;
          if (group) {
            if (isSelected) group.setAttribute('data-selected', '1');
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
              // VexFlow's getYs() returns Y values ordered by its internally-sorted
              // keyProps, which does NOT necessarily match the order of __mergedIds
              // (built from MIDI-sorted notes). Pairing positionally would swap the Y
              // of e.g. the soprano and the alto — making clicks on the upper note
              // select the lower one. Pair explicitly by pitch instead: highest MIDI
              // (top of the staff) ↔ smallest Y, descending.
              const idsByPitchDesc = [...mergedIds].sort((a, b) => {
                const ma = staffNoteById.get(a)?.midi ?? 0;
                const mb = staffNoteById.get(b)?.midi ?? 0;
                return mb - ma;
              });
              const ysAsc = [...ys].sort((a, b) => a - b);
              for (let i = 0; i < idsByPitchDesc.length; i++) {
                hitPoints.push({ id: idsByPitchDesc[i], x: xHit, y: ysAsc[i], isGhost: false });
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
        for (const entry of beamInstances) {
          try {
            const g = (context as any).openGroup?.() as SVGGElement | undefined;
            if (g && entry.isSelected) g.setAttribute('data-selected', '1');
            entry.beam.setContext(context as any);
            entry.beam.draw();
            (context as any).closeGroup?.();
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

          const drawPartialTiePath = (fromX: number, toX: number, y: number, dir: 1 | -1, fromId?: string, toId?: string) => {
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
              // Make ties clickable/selectable.
              // We tag the path so the global pointer handler can detect tie clicks.
              // (We intentionally don't rely on VexFlow's internal DOM structure.)
              if (fromId && toId) {
                path.setAttribute('data-tie-from', fromId);
                path.setAttribute('data-tie-to', toId);
              }
              path.style.pointerEvents = 'stroke';
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

          const effectiveMidiForTie = (n: any): number | null => {
            try {
              if (!n || n.isRest) return null;

              // Prefer spelling-derived MIDI; fall back to stored midi.
              const letter = String(n.pitch || '').charAt(0).toUpperCase();
              const octave = Number(n.octave);
              const basePc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
              if (!Object.prototype.hasOwnProperty.call(basePc, letter) || !Number.isFinite(octave)) {
                const m0 = Number(n.midi);
                return Number.isFinite(m0) ? m0 : null;
              }

              const hasExplicitAcc = (n.userAccidental != null) || (n.explicitAccidental != null);
              const accRaw = (n.userAccidental ?? n.explicitAccidental ?? n.accidental ?? null);
              const acc = String(accRaw ?? '')
                .trim()
                .replace(/♯/g, '#')
                .replace(/♭/g, 'b')
                .replace(/♮/g, 'natural')
                .replace(/𝄪/g, '##')
                .replace(/𝄫/g, 'bb')
                .replace(/^x$/i, '##');

              const offset = (() => {
                if (acc === 'sharp' || acc === '#') return 1;
                if (acc === 'flat' || acc === 'b') return -1;
                if (acc === 'double-sharp' || acc === '##') return 2;
                if (acc === 'double-flat' || acc === 'bb') return -2;
                return 0;
              })();

              // NOTE: noteIndex can be stale in some edit/enharmonic cases.
              // If the user explicitly spelled the accidental, trust the spelling.
              const noteIndexRaw = (!hasExplicitAcc && Number.isFinite(Number(n.noteIndex)))
                ? Number(n.noteIndex)
                : (basePc[letter] + offset);
              const noteIndex = ((noteIndexRaw % 12) + 12) % 12;
              let midi = (octave + 1) * 12 + noteIndex;

              const isFlatLike = acc === 'flat' || acc === 'double-flat' || acc === 'b' || acc === 'bb';
              const isSharpLike = acc === 'sharp' || acc === 'double-sharp' || acc === '#' || acc === '##';
              if (letter === 'C' && (noteIndex === 11 || noteIndex === 10) && (isFlatLike || !acc)) midi -= 12;
              if (letter === 'B' && (noteIndex === 0 || noteIndex === 1) && (isSharpLike || !acc)) midi += 12;

              return midi;
            } catch {
              const m0 = Number((n as any)?.midi);
              return Number.isFinite(m0) ? m0 : null;
            }
          };

          for (let i = 0; i < sorted.length; i++) {
            const cur = sorted[i].staffNote;
            if (!cur.isTiedToNext) continue;

            const curVoice = cur.voice ?? 1;
            let next: (typeof sorted)[number] | undefined;
            for (let j = i + 1; j < sorted.length; j++) {
              const cand = sorted[j].staffNote;
              if ((cand.voice ?? 1) !== curVoice) continue;
              if (cand.isRest) continue;
              // Ties are only between *contiguous* notes of the same voice.
              // We validate pitch via effective MIDI (spelling-aware) to support enharmonic ties.
              next = sorted[j];
              break;
            }

            // Fallback (still contiguous): if voice ids drift (common around enharmonic respellings),
            // tie to the unique matching note at the immediately-next onset time.
            if (!next) {
              try {
                const curStart = (Number.isFinite(Number((cur as any).startTick)) ? Number((cur as any).startTick) : null);

                const timeKey = (n: any): string => {
                  const st = Number(n?.startTick);
                  if (Number.isFinite(st)) return `t:${st}`;
                  const m = Number(n?.measureIndex ?? 0);
                  const b = Number(n?.beat ?? 0);
                  const x = Number(n?.xPosition ?? 0);
                  return `m:${m}|b:${b}|x:${x}`;
                };

                // Find the next onset time after cur.
                let nextKey: string | null = null;
                for (let j = i + 1; j < sorted.length; j++) {
                  const cand = sorted[j].staffNote as any;
                  if (cand?.isRest) continue;
                  if (curStart != null) {
                    const st = Number(cand?.startTick);
                    if (!Number.isFinite(st) || st <= curStart) continue;
                  }
                  const tk = timeKey(cand);
                  nextKey = tk;
                  break;
                }
                if (nextKey) {
                  const emCur = effectiveMidiForTie(cur as any);
                  if (emCur != null) {
                    const atNext = [] as Array<(typeof sorted)[number]>;
                    for (let j = i + 1; j < sorted.length; j++) {
                      const cand = sorted[j].staffNote as any;
                      if (cand?.isRest) continue;
                      if (timeKey(cand) !== nextKey) continue;
                      atNext.push(sorted[j]);
                    }
                    const matches = atNext.filter(p => effectiveMidiForTie(p.staffNote as any) === emCur);
                    if (matches.length === 1) next = matches[0];
                  }
                }
              } catch {
                // ignore fallback
              }
            }

            if (!next) {
              // Tie continues into the next system/line: draw a partial outgoing tie.
              const vf = sorted[i].vfNote as any;
              const keyIndex = getKeyIndexFor(sorted[i]);
              const fromX = getTieRightX(vf);
              if (fromX != null) {
                const y = getTieY(vf, stave, keyIndex);
                const dir = tieDirectionFor(cur, vf);
                // No concrete toId in this system, so we don't tag it as selectable.
                drawPartialTiePath(fromX, staffEndX, y, dir);
              }
              continue;
            }

            // Only tie if the sounding pitch matches (supports enharmonic respellings).
            const emCur = effectiveMidiForTie(cur as any);
            const emNext = effectiveMidiForTie(next.staffNote as any);
            if (emCur == null || emNext == null || emCur !== emNext) continue;

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

            tieInstances.push({ tie, fromId: cur.id, toId: next.staffNote.id });
          }

          for (const item of tieInstances) {
            try {
              // Wrap each tie in a tagged group so clicks can map to note IDs.
              const g = (context as any).openGroup?.() as SVGGElement | undefined;
              try {
                if (g) {
                  g.setAttribute('data-tie-from', item.fromId);
                  g.setAttribute('data-tie-to', item.toId);
                  // Prefer stroke hit-testing so we don't steal clicks from noteheads.
                  (g.style as any).pointerEvents = 'stroke';
                }
              } catch {
                // ignore
              }

              item.tie.setContext(context as any);
              item.tie.draw();

              // Tag the actual SVG elements VexFlow created so the pointer handler can
              // detect tie clicks even if the group tagging is not sufficient.
              try {
                if (g) {
                  const paths = Array.from(g.querySelectorAll('path')) as SVGPathElement[];
                  for (const p of paths) {
                    try {
                      p.setAttribute('data-tie-from', item.fromId);
                      p.setAttribute('data-tie-to', item.toId);
                      (p.style as any).pointerEvents = 'stroke';

                      // Add a wider invisible hitbox for easier selection.
                      const d = p.getAttribute('d');
                      if (d) {
                        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        hit.setAttribute('d', d);
                        hit.setAttribute('fill', 'none');
                        hit.setAttribute('stroke', 'transparent');
                        hit.setAttribute('stroke-width', '12');
                        hit.setAttribute('stroke-linecap', 'round');
                        hit.setAttribute('data-tie-from', item.fromId);
                        hit.setAttribute('data-tie-to', item.toId);
                        (hit.style as any).pointerEvents = 'stroke';
                        // Insert before the visible path so it doesn't cover visuals.
                        g.insertBefore(hit, p);
                      }
                    } catch {
                      // ignore per-path
                    }
                  }
                }
              } catch {
                // ignore
              }

              try {
                (context as any).closeGroup?.();
              } catch {
                // ignore
              }
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
              try {
                const emCand = effectiveMidiForTie(cand);
                const emCur = effectiveMidiForTie(cur);
                if (emCand != null && emCur != null && emCand === emCur && cand.isTiedToNext) {
                  hasLocalPrev = true;
                }
              } catch {
                // ignore
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
            // No concrete fromId in this system, so we don't tag it as selectable.
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

      // Accompaniment notes (including ACC ghost when voice === 0): render on the acc staves.
      if (accTreble && allAccompanimentNotes.length > 0) {
        if (accBass) {
          // grandstaff: route by clef, low notes go to bass stave.
          const accTrebleNotes = allAccompanimentNotes.filter(n => (n.clef || 'treble') === 'treble');
          const accBassNotes = allAccompanimentNotes.filter(n => n.clef === 'bass');
          if (accTrebleNotes.length > 0) drawNotesAtX(accTrebleNotes, accTreble, 'treble');
          if (accBassNotes.length > 0) drawNotesAtX(accBassNotes, accBass, 'bass');
        } else {
          // treble_only: all notes (incl. clef:"bass") go to the treble stave;
          // override clef to "treble" so VexFlow positions them by treble clef
          // (low notes will naturally use ledger lines below the stave).
          const allAccNotes = allAccompanimentNotes.map(n => ({ ...n, clef: 'treble' as ClefType }));
          drawNotesAtX(allAccNotes, accTreble, 'treble');
        }
        // ACC hit-points are preserved to enable click and marquee selection.
      }

      noteHitPointsRef.current = hitPoints;
      onNoteHitPoints?.(hitPoints);

      // No per-note DOM wiring here: we handle clicks via the global SVG handler below
    } else {
      noteHitPointsRef.current = [];
      onNoteHitPoints?.([]);
    }
  }, [notes, timeSignature, keySignature, barlines, width, height, staffMode, selectedNoteIds, ghostNote, accompanimentNotes, showAccompanimentStaves, accompanimentStaffMode, accompanimentTracks]);

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

    const getTargetTieInfo = (target: EventTarget | null) => {
      const el = target as Element | null;
      const tagged = el?.closest?.('[data-tie-from][data-tie-to]') as HTMLElement | null;
      const fromNoteId = tagged?.getAttribute?.('data-tie-from') ?? null;
      const toNoteId = tagged?.getAttribute?.('data-tie-to') ?? null;
      return { fromNoteId, toNoteId, tagged };
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
      const { fromNoteId: upTieFrom, toNoteId: upTieTo } = getTargetTieInfo(e.target);

      // Tie click has priority over proximity-pick and background clicks.
      // This prevents a tie click from accidentally selecting a nearby note.
      if (down.downTieFrom && down.downTieTo) {
        try { e.preventDefault(); } catch { /* ignore */ }
        try { e.stopPropagation(); } catch { /* ignore */ }
        onTieClickRef.current?.(down.downTieFrom, down.downTieTo, e);
        return;
      }
      if (upTieFrom && upTieTo) {
        try { e.preventDefault(); } catch { /* ignore */ }
        try { e.stopPropagation(); } catch { /* ignore */ }
        onTieClickRef.current?.(upTieFrom, upTieTo, e);
        return;
      }

      // Prefer the note we started the click on (mousedown), even if mouseup lands
      // on an untagged element (e.g., a Beam path). Fall back to the mouseup target.
      const chosenNoteId = (down.downNoteId && !down.downIsGhost)
        ? down.downNoteId
        : ((upNoteId && !upIsGhost) ? upNoteId : null);

      // Must be declared before first use (no TDZ).
      // sortByY: rank by |dy| first, then d2 — correct for pitch selection.
      const proximityPick = (radiusPx: number, yBandPx: number, sortByY = false) => {
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
        // No fallback to candidates: if nothing is within yBandPx, return empty so that
        // clicks clearly outside a notehead's vertical extent don't select any note.
        const pool = preferred;
        if (sortByY) {
          pool.sort((a, b) => {
            const diff = Math.abs(a.dy) - Math.abs(b.dy);
            if (diff !== 0) return diff;
            // When |dy| ties (click is at the midpoint between two notes a third apart),
            // prefer the note whose center is ABOVE the click (dy < 0). This prevents
            // an accidental on the lower note from winning the d2 tiebreaker when
            // the accidental formatter shifts the upper note's hitpoint rightward.
            const aAbove = a.dy < 0 ? 0 : 1;
            const bAbove = b.dy < 0 ? 0 : 1;
            if (aAbove !== bAbove) return aAbove - bAbove;
            return a.d2 - b.d2;
          });
        } else {
          pool.sort((a, b) => a.d2 - b.d2);
        }
        return pool;
      };

      if (enableProximityPick) {
        if (chosenNoteId) {
          // DOM found a note, but SVG elements (stems, accidental glyphs, ledger lines)
          // extend beyond the notehead and can capture clicks intended for adjacent notes.
          // Strategy: compute how far the DOM-picked note actually is from the cursor (domDy),
          // then search for a Y-closer note using that distance as the band width.
          // This handles accidentals that extend into the territory of the note above.
          const domHit = noteHitPointsRef.current.find(p => p.id === chosenNoteId && !p.isGhost);
          const domDy = domHit ? Math.abs(domHit.y - y) : 5;
          // yBand wide enough to catch any note that's closer in Y than the DOM pick.
          const adaptiveYBand = Math.max(5, domDy + 1);
          // When the DOM note is far in Y (stem/accidental/ledger capture), expand the X
          // radius: soprano may be displaced right by ~12 px (NOTEHEAD_TOUCH_SHIFT for
          // seconds) while the click is 12 px left on the accidental → total dx ≈ 24 px,
          // just outside the default 22 px radius.  35 px covers all practical offsets.
          const adaptiveRadius = domDy > 3 ? 35 : 22;
          const pool = proximityPick(adaptiveRadius, adaptiveYBand, true /* sortByY */);

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

          // If the click is farther than one notehead from the DOM note's center, it
          // landed on a stem/accidental/ledger — prefer the notehead actually under the
          // cursor, giving the full upper notehead area to the upper note.
          const NOTEHEAD_RADIUS_Y = 6;
          if (domDy > NOTEHEAD_RADIUS_Y) {
            const head = pool.find(c => c.id !== chosenNoteId
              && Math.abs(c.dy) <= NOTEHEAD_RADIUS_Y);
            if (head) {
              onNoteClickRef.current?.(head.id, e);
              return;
            }
          }
          // Otherwise override only when proximity finds a strictly Y-closer note.
          if (pool.length > 0 && pool[0].id !== chosenNoteId && Math.abs(pool[0].dy) < domDy) {
            onNoteClickRef.current?.(pool[0].id, e);
            return;
          }

          onNoteClickRef.current?.(chosenNoteId, e);
          return;
        }

        // DOM found nothing (beam / ledger line / background): tight proximity only.
        // No fallback to full candidates — clicks clearly outside a notehead don't select.
        const pool = proximityPick(22, 5, true /* sortByY */);

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

        if (pool.length > 0) {
          onNoteClickRef.current?.(pool[0].id, e);
          return;
        }

        if (e.altKey) return;
        onStaffClickRef.current?.(x, y, e);
        return;
      }

      if (chosenNoteId) {
        // Insert mode: the DOM matched a note, but the click may have landed on the
        // lower note's STEM or ACCIDENTAL glyph, which extend up into the upper note's
        // area. A notehead is ~6 px tall (half a line space). If the click is farther
        // than that from the DOM note's center, it did NOT land on that note's head —
        // it hit a stem/accidental/ledger. In that case prefer the notehead actually
        // under the cursor (Y-closest within one notehead), giving the full upper
        // notehead area to the upper note instead of splitting at the midpoint.
        const NOTEHEAD_RADIUS_Y = 6;
        const domHit = noteHitPointsRef.current.find(p => p.id === chosenNoteId && !p.isGhost);
        if (domHit) {
          const domDy = Math.abs(domHit.y - y);
          if (domDy > NOTEHEAD_RADIUS_Y) {
            const refinePool = proximityPick(35, Math.max(5, domDy + 1), true /* sortByY */);
            const head = refinePool.find(c => c.id !== chosenNoteId
              && Math.abs(c.dy) <= NOTEHEAD_RADIUS_Y);
            if (head) {
              onNoteClickRef.current?.(head.id, e);
              return;
            }
          }
        }
        onNoteClickRef.current?.(chosenNoteId, e);
        return;
      }

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

      // yBandPx=5: one staff step. sortByY so that for seconds/thirds the vertically
      // closer note always wins, even when notes are at different X positions.
      const pool = proximityPick(22, 5, true /* sortByY */);

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

      // If the user pressed on a tie path, keep it from starting a marquee selection.
      // We still allow mouseup to resolve the click.
      const { fromNoteId: downTieFrom, toNoteId: downTieTo } = getTargetTieInfo(e.target);
      if (downTieFrom && downTieTo) {
        downRef.current = {
          startClientX: e.clientX,
          startClientY: e.clientY,
          moved: false,
          downNoteId: null,
          downIsGhost: false,
          downTieFrom,
          downTieTo,
        };
        window.addEventListener('mouseup', onWindowMouseUp, { capture: true });
        return;
      }

      const { noteId, isGhost } = getTargetNoteInfo(e.target);
      downRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
        downNoteId: noteId,
        downIsGhost: isGhost,
        downTieFrom: null,
        downTieTo: null,
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
      moveCb(x, y, !!(e.metaKey || e.ctrlKey));
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
