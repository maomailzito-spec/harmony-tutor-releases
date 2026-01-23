import React, { useRef, useEffect } from 'react';
import { Renderer, Stave, StaveConnector, StaveNote, Accidental, TickContext, Beam, StaveTie, Barline as VFBarline, TimeSignature as VFTimeSignature } from 'vexflow';
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
  onMouseMoveStaff?: (x: number, y: number) => void;
  onStaffMouseDown?: (e: MouseEvent, svg: SVGSVGElement) => void;
  onBarlineRightClick?: (barlineId: string, e: MouseEvent) => void;
  ghostNote?: StaffNote | null;
  onNoteHitPoints?: (points: Array<{ id: string; x: number; y: number; isGhost: boolean }>) => void;
  enableProximityPick?: boolean;
  showVoiceColors?: boolean;
  timeSignatureChanges?: Array<{ x: number; numerator: number; denominator: number }>;
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

const makeVfNote = (n: StaffNote, clef: ClefType, stemOverride?: 'up' | 'down', hideStem?: boolean) => {
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

  // In close-position (parti strette) fallback rendering, we sometimes draw separate notes
  // but want a *single* visible stem (to avoid stacked stems/flags reading as shorter rhythm).
  if (!n.isRest && hideStem) {
    try {
      (note as any).__hideStem = true;
    } catch { /* ignore */ }
    try {
      if (typeof (note as any).setStemStyle === 'function') {
        (note as any).setStemStyle({ strokeStyle: 'rgba(0,0,0,0)', fillStyle: 'rgba(0,0,0,0)' });
      }
    } catch { /* ignore */ }
    try {
      if (typeof (note as any).setFlagStyle === 'function') {
        (note as any).setFlagStyle({ strokeStyle: 'rgba(0,0,0,0)', fillStyle: 'rgba(0,0,0,0)' });
      }
    } catch { /* ignore */ }
    try {
      const stem = (note as any).getStem?.();
      if (stem && typeof stem.setStyle === 'function') {
        stem.setStyle({ strokeStyle: 'rgba(0,0,0,0)', fillStyle: 'rgba(0,0,0,0)' });
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
    const getState = (letter: string, octave: number): AccidentalType => {
      const key = `${String(letter || '').toUpperCase()}/${Number(octave)}`;
      const existing = state.get(key);
      if (existing) return existing;
      const d = keySignatureDefaultAccidentalForLetter(keySignature, letter);
      state.set(key, d);
      return d;
    };
    const setState = (letter: string, octave: number, acc: AccidentalType) => {
      const key = `${String(letter || '').toUpperCase()}/${Number(octave)}`;
      state.set(key, acc);
    };

    for (const n of g) {
      const letter = pitchLetterOf((n as any).pitch);
      const octave = Number((n as any).octave);
      if (!letter || !Number.isFinite(octave) || DIATONIC_PC[letter] == null) {
        out.set(n.id, null);
        continue;
      }

      // Prefer user-entered accidental (can include double-sharp/flat) over derived MIDI.
      const userAcc = normalizeAccidentalType((n as any).userAccidental);
      const explicitAcc = normalizeAccidentalType((n as any).explicitAccidental);
      const autoAcc = normalizeAccidentalType((n as any).accidental);

      const actual: AccidentalType =
        userAcc
        ?? explicitAcc
        ?? autoAcc
        ?? (Number.isFinite((n as any).noteIndex)
          ? accidentalFromPcForLetter(Number((n as any).noteIndex), letter)
          : accidentalFromMidiForLetter(Number((n as any).midi), letter, octave));
      const prev = getState(letter, octave);
      // If the user explicitly picked an accidental, always render it.
      if (userAcc) {
        out.set(n.id, userAcc);
        setState(letter, octave, userAcc);
        continue;
      }

      if (actual !== prev) {
        out.set(n.id, actual);
        setState(letter, octave, actual);
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
    if (!showVoiceColors) return;
    if (!vfNote || staffNote.id === '__ghost__' || staffNote.isRest) return;
    // Respect our "single-stem" fallback: never recolor a stem we intentionally hid.
    try {
      if ((vfNote as any).__hideStem) return;
    } catch {
      // ignore
    }
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
        for (const n of staffNotes) {
          const tk = getNoteTimeKey(n);
          if (!byTimeKeyAll.has(tk)) byTimeKeyAll.set(tk, []);
          byTimeKeyAll.get(tk)!.push(n);
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

              // Only merge small clusters (2 or 3 notes). This covers the common
              // close-position case (e.g. G-A-C) without stepping into more complex
              // edge-cases that previously caused VF glitches.
              if (eligible.length < 2 || eligible.length > 3) continue;

              // Only merge if the cluster contains at least one second on the staff.
              // (That's where separate-note rendering becomes visually confusing.)
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
              const tk = getNoteTimeKey(n);
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
                for (const n of sorted) {
                  if (isManual(n)) continue;
                  stemOverrideById.set(n.id, clusterDir);
                }
              } else {
                // Keep a stable visual separation when it isn't a tight cluster.
                // Soprano stays up; Alto stays down; Tenor follows the cluster direction.
                const s = sorted.find(n => n.voice === 1);
                const a = sorted.find(n => n.voice === 2);
                const t = sorted.find(n => n.voice === 3);
                if (s && !isManual(s)) stemOverrideById.set(s.id, 'up');
                if (a && !isManual(a)) stemOverrideById.set(a.id, 'down');
                if (t && !isManual(t)) stemOverrideById.set(t.id, clusterDir);
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
              const xShifts = getSecondClusterOffsetsById(sorted, dir === 'up', preferRightAtBarline);
              for (const [id, dx] of xShifts.entries()) {
                // Don't override manual tweaks; user might have fixed a specific case.
                const nn = sorted.find(n => n.id === id);
                if (nn && !isManual(nn)) offsetMap.set(id, dx);
              }
            }
          }
        }
        // --- end close-position helpers ---
        const accidentalGlyphById = computeMeasureAccidentalGlyphs(staffNotes, timeSignature, keySignature);

        // In open position ("parti late"), the default accidental layout can leave too much
        // empty space between accidentals and the nearest notehead (especially early in a bar).
        // Compute an inset (move accidentals closer to the cluster) for multi-voice onsets
        // that do NOT contain seconds (we don't want to disturb the close-position rules).
        const openPositionAccidentalInsetById = new Map<string, number>();
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
            const STAGGER_PX = 8;
            for (const g of byTimeKeyAll.values()) {
                const withAcc = g
                  .filter(n => n && n.id !== '__ghost__')
                  .filter(n => !n.isRest)
                  .filter(n => {
                    const glyph = accidentalGlyphById.get(n.id) ?? null;
                    return !!accidentalTypeToVexflow(glyph);
                  });
                if (withAcc.length < 2) continue;

                const sorted = withAcc.slice().sort((a, b) => Number(a.position) - Number(b.position));
                for (let i = 0; i < sorted.length; i++) {
                  accidentalStaggerById.set(sorted[i].id, i * STAGGER_PX);
                }
            }
          } catch {
            // ignore
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
              vfNote = makeVfNote(n, clef, stemOverrideById.get(n.id), hideStemById.get(n.id));
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
                        if (needsNudge && enableEngravingEnhancements) {
                          const isFlat = (vfGlyph === 'b' || vfGlyph === 'bb');
                          const base = isFlat ? 12 : 6;
                          // Use the same step used for close-position fixes.
                          const STAGGER_PX = 8;

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
                          const inset = (hasSecond ? 0 : (openPositionAccidentalInsetById.get(n.id) ?? 0));
                          const desiredDelta = base + stagger + extra - inset;
                          // Special case: beat-1 onsets with a 2-note second + multiple accidentals
                          // can end up with accidentals too far from the noteheads due to our base shift.
                          // Pull them back by ~14px (but never to the right of VF default).
                          let beat1Inset = 0;
                          try {
                            const isMeasureStart = chordNotes.some(sn => {
                              const b = Number((sn as any).beat);
                              return Number.isFinite(b) && Math.abs(b - 1) <= 1e-6;
                            });
                            if (isMeasureStart && hasSecond && hasMultipleAccidentals) beat1Inset = 14;
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
                    if (enableEngravingEnhancements) {
                      try {
                        const extra = accidentalStaggerById.get(n.id) ?? 0;
                        const inset = openPositionAccidentalInsetById.get(n.id) ?? 0;
                        if ((extra || inset) && typeof (acc as any).getXShift === 'function' && typeof (acc as any).setXShift === 'function') {
                          const cur = (acc as any).getXShift() ?? 0;
                          // extra pushes left; inset pulls back right.
                          (acc as any).setXShift(cur + extra - inset);
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
            const vc = showVoiceColors ? voiceColor(n.voice) : null;
            if (vc && n.id !== '__ghost__' && !n.isRest && !selectedNoteIds.includes(n.id) && !(n as any).errorType) {
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
              const isMergedChord = Array.isArray((vfNote as any)?.__mergedIds) && ((vfNote as any).__mergedIds.length > 0);
              const xShift = isMergedChord ? 0 : (offsetMap.get(n.id) ?? 0);
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

                  // Force displacement hints for explicit seconds (e.g. Bb–C).
                  // Stem up => displace the upper notehead; stem down => displace the lower.
                  try {
                    const mergedIds: string[] | undefined = (vfNote as any)?.__mergedIds;
                    if (Array.isArray(mergedIds) && mergedIds.length >= 2 && typeof (vfNote as any).setNoteDisplaced === 'function') {
                      const keysArr: string[] = Array.isArray((vfNote as any)?.keys) ? ((vfNote as any).keys as any) : [];
                      const chordNotes = mergedIds
                        .map(id => staffNoteById.get(String(id)))
                        .filter(Boolean) as StaffNote[];
                      const sortedByPos = chordNotes.slice().sort((a, b) => Number(a.position) - Number(b.position));
                      const stemDir = (typeof (vfNote as any).getStemDirection === 'function') ? (Number((vfNote as any).getStemDirection()) || 0) : 0;
                      for (let k = 1; k < sortedByPos.length; k++) {
                        const low = sortedByPos[k - 1];
                        const high = sortedByPos[k];
                        if ((Number(high.position) - Number(low.position)) !== 1) continue;
                        const displaceId = (stemDir >= 0) ? high.id : low.id;
                        const sn = chordNotes.find(x => x.id === displaceId) as any;
                        const keyStr = sn ? `${staffNoteToVexflowKeyName(sn)}/${sn.octave ?? 4}` : '';
                        const keyIdx = keyStr && keysArr.length ? keysArr.indexOf(keyStr) : -1;
                        const idx = keyIdx >= 0 ? keyIdx : mergedIds.indexOf(displaceId);
                        if (idx >= 0) (vfNote as any).setNoteDisplaced(idx, true);
                      }
                    }
                  } catch { /* ignore */ }

                  (vfNote as any).calcNoteDisplacements();
                }
              } catch {
                // ignore
              }

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
                const fallbackNote = makeVfNote({ ...n } as StaffNote, clef, stemOverrideById.get(n.id), hideStemById.get(n.id));
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
        const beamInstances: Array<{ beam: Beam; isSelected: boolean }> = [];
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
            applyBeamStyle(b as any, group);
            const isSelected = group.some(g => selectedNoteIds.includes(String(g.staffNote.id)));
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
              applyBeamStyle(b as any, current);
              const isSelected = current.some(c => selectedNoteIds.includes(String(c.staffNote.id)));
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
