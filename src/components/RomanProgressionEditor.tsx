/**
 * RomanProgressionEditor — Pannello per generare corali SATB da Roman Numerals.
 *
 * L'utente inserisce una progressione (es. "I - IV - V7 - I"),
 * sceglie tonalità/modo/metro, configura regole, preme "Genera".
 * Il risultato (StaffNote[]) viene iniettato nel GrandStaffEditor.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { StaffNote, TimeSignature } from '../types';
import { TICKS_PER_QUARTER } from '../constants';
import {
  realizeChorale,
  parseRoman,
  resetNoteIdCounter,
  autoHarmonize,
  autoHarmonizeFromBass,
  type RomanChord,
  type ChoralConfig,
  type ChoralRules,
  type ChoralViolation,
  type SopranoConstraint,
  type ModulationContext,
} from '../engine/choralRealization';
import { suggestNextChord, type ChordSuggestion } from '../engine/progressionSuggester';
import {
  extractStyleProfile,
  mergeProfiles,
  loadStyleProfile,
  saveStyleProfile,
  clearStyleProfile,
  type StyleProfile,
} from '../engine/choralStyleProfile';
import defaultStyleProfileData from '../engine/defaultStyleProfile.json';

// ─── Props ─────────────────────────────────────────────────────────────────

export interface RomanProgressionEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyNotes: (notes: StaffNote[]) => void;
  /** Callback to apply modulation contexts (tonicizations) to the analysis engine. */
  onApplyContexts?: (contexts: Array<{
    absBeat: number;
    measureIndex: number;
    beat: number;
    newTonic: string;
    newIsMinor: boolean;
    label?: string;
    source: 'composer';
  }>) => void;
  keySignatureRoot: string;
  isMinorMode: boolean;
  timeSignature: TimeSignature;
  /** Existing notes on the staff — used to extract soprano melody for constrained harmonization. */
  existingNotes?: StaffNote[];
  /** Measure offset: generated notes will start from this measure index (playhead position). */
  playheadMeasure?: number;
}

// ─── Preset progressions ──────────────────────────────────────────────────

const PRESETS: { label: string; chords: string; minor?: boolean }[] = [
  { label: 'Cadenza autentica', chords: 'I - IV - V - I' },
  { label: 'Cadenza plagale', chords: 'I - IV - I' },
  { label: 'Progressione per quarte', chords: 'I - IV - viio - iii - vi - ii - V - I' },
  { label: 'Passamezzo antico', chords: 'i - VII - i - V - III - VII - i - V - i', minor: true },
  { label: 'Romanesca', chords: 'I - V - vi - III - IV - I - IV - V' },
  { label: 'I–IV–V7–I', chords: 'I - IV - V7 - I' },
  { label: 'ii–V–I', chords: 'ii - V7 - I' },
  { label: 'I–vi–IV–V', chords: 'I - vi - IV - V' },
  { label: 'I–V–vi–IV', chords: 'I - V - vi - IV' },
  { label: 'ii–I–vi–V', chords: 'ii - I - vi - V' },
  { label: 'IV–I–vi–V', chords: 'IV - I - vi - V' },
  { label: 'vi–IV–I–V', chords: 'vi - IV - I - V' },
  { label: 'i–iv–V–i (minore)', chords: 'i - iv - V - i', minor: true },
];

// ─── Note-value SVG icons (viewBox 0 0 20 36) ─────────────────────────────

const NOTE_ICON_PATHS: Record<string, React.ReactNode> = {
  whole: (
    <ellipse cx="10" cy="20" rx="7" ry="4.5" fill="none" stroke="currentColor" strokeWidth="1.8"
      transform="rotate(-15 10 20)" />
  ),
  half: (<>
    <ellipse cx="9" cy="23" rx="6" ry="4" fill="none" stroke="currentColor" strokeWidth="1.8"
      transform="rotate(-20 9 23)" />
    <line x1="15" y1="23" x2="15" y2="4" stroke="currentColor" strokeWidth="1.5" />
  </>),
  quarter: (<>
    <ellipse cx="9" cy="23" rx="6" ry="4" fill="currentColor"
      transform="rotate(-20 9 23)" />
    <line x1="15" y1="23" x2="15" y2="4" stroke="currentColor" strokeWidth="1.5" />
  </>),
  eighth: (<>
    <ellipse cx="9" cy="23" rx="6" ry="4" fill="currentColor"
      transform="rotate(-20 9 23)" />
    <line x1="15" y1="23" x2="15" y2="4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M15 4 Q19 8 17 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </>),
  sixteenth: (<>
    <ellipse cx="9" cy="23" rx="6" ry="4" fill="currentColor"
      transform="rotate(-20 9 23)" />
    <line x1="15" y1="23" x2="15" y2="4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M15 4 Q19 8 17 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <path d="M15 9 Q19 13 17 19" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </>),
  auto: (
    <text x="10" y="24" textAnchor="middle" fill="currentColor" fontSize="16" fontWeight="bold">A</text>
  ),
};

// ─── Duration mapping ──────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { value: 'whole',     label: '𝅝 Semibreve',    beats: 4    },
  { value: 'half',      label: '𝅗𝅥 Minima',       beats: 2    },
  { value: 'quarter',   label: '♩ Semiminima',   beats: 1    },
  { value: 'eighth',    label: '♪ Croma',        beats: 0.5  },
  { value: 'sixteenth', label: '𝅘𝅥𝅯 Semicroma',   beats: 0.25 },
  { value: 'auto',      label: '⏐ Auto (riempi misura)', beats: 0 },
] as const;

const INLINE_DURATION_SUFFIXES: Record<string, string> = {
  ':w': 'whole',
  ':h': 'half',
  ':q': 'quarter',
  ':e': 'eighth',
  ':s': 'sixteenth',
};

const DURATION_BEATS: Record<string, number> = {
  'whole': 4, 'half': 2, 'quarter': 1, 'eighth': 0.5, 'sixteenth': 0.25,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a progression string like "I - IV - V7 - I"
 * into an array of RomanChord[] with automatic beat/measure assignment.
 *
 * Supports:
 *  - Global defaultDuration: all chords use this value (e.g. 'half')
 *  - Per-chord inline suffix: "I:h" = half, "V7:w" = whole, "ii:e" = eighth
 *  - Barlines with "|" to force measure boundaries
 *  - 'auto' duration = fill to next chord (original behavior)
 */
function parseProgressionString(
  input: string,
  timeSignature: TimeSignature,
  defaultDuration: string = 'auto'
): RomanChord[] {
  // Split on whitespace, dashes, commas — but keep | as a token
  const rawTokens = input
    .split(/[-–—,\s]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (rawTokens.length === 0) return [];

  const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
  const result: RomanChord[] = [];
  let measure = 0;
  let currentBeat = 1;
  let pendingModulation: string | null = null;

  for (const raw of rawTokens) {
    // Barline
    if (raw === '|') {
      measure++;
      currentBeat = 1;
      continue;
    }

    // ── Modulation token: →G: or >G: or →g: etc. ──
    // Formats: →Bb: , >f#: , →G , >g  (colon optional)
    const modMatch = raw.match(/^[→>]([A-Ga-g][b#]{0,2}):?$/);
    if (modMatch) {
      // Store modulation target — will be applied to the NEXT chord
      pendingModulation = modMatch[1];
      continue;
    }

    // Check inline duration suffix (e.g. "V7:h")
    let roman = raw;
    let chordDuration = defaultDuration === 'auto' ? undefined : defaultDuration;
    for (const [suffix, dur] of Object.entries(INLINE_DURATION_SUFFIXES)) {
      if (raw.endsWith(suffix)) {
        roman = raw.slice(0, -suffix.length);
        chordDuration = dur;
        break;
      }
    }

    // Calculate beat step for this chord
    const durationBeats = chordDuration ? (DURATION_BEATS[chordDuration] ?? 1) : 1;

    // Wrap to next measure if we exceed capacity
    if (currentBeat + durationBeats - 1 > beatsPerMeasure + 0.001) {
      measure++;
      currentBeat = 1;
    }

    result.push({
      roman,
      beat: currentBeat,
      measure,
      ...(chordDuration ? { duration: chordDuration } : {}),
      ...(pendingModulation ? { modulateTo: pendingModulation } : {}),
    });

    // Clear pending modulation after applying to this chord
    if (pendingModulation) pendingModulation = null;

    currentBeat += durationBeats;

    // Auto-advance measure when full
    if (currentBeat > beatsPerMeasure + 0.001) {
      measure++;
      currentBeat = 1;
    }
  }

  return result;
}

/** Format violations for display. */
function formatViolation(v: ChoralViolation): string {
  const loc = `m${v.measure + 1} b${v.beat}`;
  return `${loc}: ${v.description}`;
}

// ─── Draggable Panel Wrapper ───────────────────────────────────────────────

const DraggablePanel: React.FC<{
  onClose: () => void;
  children: React.ReactNode;
}> = ({ onClose, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Center on mount
  useEffect(() => {
    setPos({ x: Math.max(0, (window.innerWidth - 720) / 2), y: Math.max(20, window.innerHeight * 0.08) });
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const cur = pos ?? { x: 0, y: 0 };
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: cur.x, origY: cur.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pos]);

  if (!pos) return null;

  return (
    <div
      ref={panelRef}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[11000] w-[720px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]
        overflow-auto rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl"
      role="dialog"
      aria-modal="false"
    >
      {/* Draggable header bar */}
      <div
        className="flex items-center justify-between px-6 pt-4 pb-2 cursor-move select-none border-b border-slate-700/60"
        onMouseDown={onDragStart}
      >
        <h2 className="text-white font-bold text-lg pointer-events-none">Genera Corale da Roman Numerals</h2>
        <button
          onClick={onClose}
          onMouseDown={e => e.stopPropagation()}
          className="text-slate-400 hover:text-white text-xl leading-none px-2"
          aria-label="Chiudi"
        >×</button>
      </div>
      <div className="p-6 pt-4">
        {children}
      </div>
    </div>
  );
};

// ─── Component ─────────────────────────────────────────────────────────────

const RomanProgressionEditor: React.FC<RomanProgressionEditorProps> = ({
  isOpen,
  onClose,
  onApplyNotes,
  onApplyContexts,
  keySignatureRoot,
  isMinorMode,
  timeSignature,
  existingNotes,
  playheadMeasure,
}) => {
  const [progressionText, setProgressionText] = useState('I - IV - V7 - I');
  const [localTonic, setLocalTonic] = useState(keySignatureRoot);
  const [localMinor, setLocalMinor] = useState(isMinorMode);
  const [localTs, setLocalTs] = useState<TimeSignature>(timeSignature);
  const [selectedDuration, setSelectedDuration] = useState('quarter');
  const [initialDisposition, setInitialDisposition] = useState<string>('auto');

  // Rules
  const [allowParallel5ths, setAllowParallel5ths] = useState(false);
  const [allowParallel8ves, setAllowParallel8ves] = useState(false);
  const [allowCrossing, setAllowCrossing] = useState(false);
  const [doubleRoot, setDoubleRoot] = useState(true);
  const [autoSevenths, setAutoSevenths] = useState(true);

  // Style profile (adaptive learning)
  const [useStyleProfile, setUseStyleProfile] = useState(false);
  const [styleProfile, setStyleProfile] = useState<StyleProfile | null>(() => loadStyleProfile());
  const [learnFeedback, setLearnFeedback] = useState<string | null>(null);

  // Melody constraint mode
  const [useMelody, setUseMelody] = useState(false);
  /** Harmonic rhythm: 0 = per note, 1 = per quarter, 2 = per half, 4 = per whole */
  const [harmonicRhythmBeats, setHarmonicRhythmBeats] = useState(0);

  // Extract soprano notes (voice 1) from existing notes
  const sopranoFromScore = useMemo(() => {
    if (!existingNotes?.length) return [];
    return existingNotes
      .filter(n => n && !n.isRest && (n.voice === 1 || n.voice === undefined))
      .sort((a, b) => {
        const ma = a.measureIndex ?? 0, mb = b.measureIndex ?? 0;
        if (ma !== mb) return ma - mb;
        return (a.beat ?? 1) - (b.beat ?? 1);
      });
  }, [existingNotes]);

  // Bass constraint mode ("basso dato")
  const [useBass, setUseBass] = useState(false);
  // Extract bass notes (voice 4) from existing notes
  const bassFromScore = useMemo(() => {
    if (!existingNotes?.length) return [];
    return existingNotes
      .filter(n => n && !n.isRest && (n as any).voice === 4)
      .sort((a, b) => {
        const ma = a.measureIndex ?? 0, mb = b.measureIndex ?? 0;
        if (ma !== mb) return ma - mb;
        return (a.beat ?? 1) - (b.beat ?? 1);
      });
  }, [existingNotes]);

  // Voice locking: set of voice numbers (1=S, 2=A, 3=T, 4=B) to keep fixed on re-generate
  const [enabledVoices, setEnabledVoices] = useState<Set<number>>(new Set([1, 2, 3, 4]));
  const [insertMeasure, setInsertMeasure] = useState(0);
  // Sync insertMeasure from prop only when panel first opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) setInsertMeasure(playheadMeasure ?? 0);
    prevOpenRef.current = isOpen;
  }, [isOpen, playheadMeasure]);
  const toggleEnable = useCallback((v: number) => {
    setEnabledVoices(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }, []);

  // Generation result
  const [generatedNotes, setGeneratedNotes] = useState<StaffNote[] | null>(null);
  const [modulationContexts, setModulationContexts] = useState<ModulationContext[]>([]);
  const [violations, setViolations] = useState<ChoralViolation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Custom user-saved progressions (persisted in localStorage)
  const CUSTOM_PROGS_KEY = 'harmony-tutor:custom-progressions';
  const [customPresets, setCustomPresets] = useState<{ label: string; chords: string; minor?: boolean }[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_PROGS_KEY);
      if (raw) setCustomPresets(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  const saveCustomPreset = useCallback(() => {
    const chords = progressionText.trim();
    if (!chords) return;
    const label = chords.replace(/\s*-\s*/g, '–');
    const exists = customPresets.some(p => p.chords === chords);
    if (exists) return;
    const next = [...customPresets, { label, chords, minor: localMinor ? true : undefined }];
    setCustomPresets(next);
    try { localStorage.setItem(CUSTOM_PROGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [progressionText, localMinor, customPresets]);
  const deleteCustomPreset = useCallback((idx: number) => {
    const next = customPresets.filter((_, i) => i !== idx);
    setCustomPresets(next);
    try { localStorage.setItem(CUSTOM_PROGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [customPresets]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from parent when panel opens
  useEffect(() => {
    if (isOpen) {
      setLocalTonic(keySignatureRoot);
      setLocalMinor(isMinorMode);
      setLocalTs(timeSignature);
      setGeneratedNotes(null);
      setViolations([]);
      setError(null);
    }
  }, [isOpen, keySignatureRoot, isMinorMode, timeSignature]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Parsed preview
  const parsedPreview = useMemo(() => {
    try {
      const chords = parseProgressionString(progressionText, localTs, selectedDuration);
      return chords.map(c => {
        const p = parseRoman(c.roman);
        return { roman: c.roman, quality: p.quality, degree: p.degree, inv: p.inversion, m: c.measure, b: c.beat, dur: c.duration || 'auto' };
      });
    } catch {
      return [];
    }
  }, [progressionText, localTs, selectedDuration]);

  // Generate chorale
  const handleGenerate = useCallback(() => {
    try {
      setError(null);
      let progression = parseProgressionString(progressionText, localTs, selectedDuration);
      // Auto-harmonize when melody mode is active and no progression text
      if (progression.length === 0 && ((useMelody && sopranoFromScore.length > 0) || (useBass && bassFromScore.length > 0))) {
        const beatsPerMeasure = localTs.numerator * (4 / localTs.denominator);
        if (useBass && bassFromScore.length > 0 && !(useMelody && sopranoFromScore.length > 0)) {
          // Bass-only: use bass-specific auto-harmonize
          const constraints: SopranoConstraint[] = bassFromScore.map(n => ({
            midi: n.midi,
            measure: n.measureIndex ?? 0,
            beat: n.beat ?? 1,
          }));
          progression = autoHarmonizeFromBass(constraints, localTonic, localMinor, harmonicRhythmBeats, beatsPerMeasure);
        } else {
          // Soprano (or both): use soprano auto-harmonize
          const constraints: SopranoConstraint[] = sopranoFromScore.map(n => ({
            midi: n.midi,
            measure: n.measureIndex ?? 0,
            beat: n.beat ?? 1,
          }));
          progression = autoHarmonize(constraints, localTonic, localMinor, harmonicRhythmBeats, beatsPerMeasure);
        }
        setProgressionText(progression.map(c => c.roman).join(' - '));
      }
      if (progression.length === 0) {
        setError('Inserisci almeno un accordo.');
        return;
      }

      const config: ChoralConfig = {
        tonic: localTonic,
        isMinor: localMinor,
        timeSignature: localTs,
        rules: {
          allowParallel5ths,
          allowParallel8ves,
          allowCrossing,
          allowOverlap: false,
          doubleRoot,
        },
        autoSevenths,
        initialDisposition: initialDisposition as any,
        styleProfile: useStyleProfile ? styleProfile : null,
      };

      // Melody constraint: fix soprano from existing voice 1 notes
      if (useMelody && sopranoFromScore.length > 0) {
        const sopranoMelody: SopranoConstraint[] = sopranoFromScore.map(n => ({
          midi: n.midi,
          measure: n.measureIndex ?? 0,
          beat: n.beat ?? 1,
        }));
        config.sopranoMelody = sopranoMelody;
      }

      // Bass constraint ("basso dato")
      if (useBass && bassFromScore.length > 0) {
        config.bassMelody = bassFromScore.map(n => ({
          midi: n.midi,
          measure: n.measureIndex ?? 0,
          beat: n.beat ?? 1,
        }));
      }

      resetNoteIdCounter();
      const result = realizeChorale(progression, config);

      setGeneratedNotes(result.notes);
      setViolations(result.violations);
      setModulationContexts(result.modulationContexts ?? []);
    } catch (err: any) {
      setError(err?.message || 'Errore durante la generazione.');
      setGeneratedNotes(null);
      setViolations([]);
    }
  }, [progressionText, localTonic, localMinor, localTs, selectedDuration, allowParallel5ths, allowParallel8ves, allowCrossing, doubleRoot, autoSevenths, useMelody, sopranoFromScore, useBass, bassFromScore, harmonicRhythmBeats, initialDisposition]);

  // Apply to editor
  const handleApply = useCallback(() => {
    if (!generatedNotes || generatedNotes.length === 0) return;
    const offset = insertMeasure;
    // Filter by enabled voices
    const voiceFiltered = enabledVoices.size < 4
      ? generatedNotes.filter(n => enabledVoices.has(n.voice ?? 1))
      : generatedNotes;
    // Offset both measureIndex AND startTick so calculateNoteBeats doesn't reset them
    const beatsPerMeasure = localTs.numerator * (4 / localTs.denominator);
    const ticksPerMeasure = beatsPerMeasure * TICKS_PER_QUARTER;
    const applyOffset = (notes: StaffNote[]) =>
      offset > 0 ? notes.map(n => ({
        ...n,
        measureIndex: (n.measureIndex ?? 0) + offset,
        startTick: ((n as any).startTick ?? 0) + offset * ticksPerMeasure,
      })) : notes;
    const lockedVoices: number[] = [];
    if (useMelody && sopranoFromScore.length > 0) lockedVoices.push(1);
    if (useBass && bassFromScore.length > 0) lockedVoices.push(4);
    if (lockedVoices.length > 0) {
      const originals = (existingNotes || []).filter(n => n && lockedVoices.includes((n as any).voice ?? 1));
      const generatedInner = voiceFiltered.filter(n => !lockedVoices.includes(n.voice ?? 1));
      onApplyNotes([...originals, ...applyOffset(generatedInner)]);
    } else {
      onApplyNotes(applyOffset(voiceFiltered));
    }
    // Apply modulation contexts (offset absBeat if needed)
    if (onApplyContexts && modulationContexts.length > 0) {
      const beatsPerMeasure = localTs.numerator * (4 / localTs.denominator);
      const offsetBeats = offset * beatsPerMeasure;
      onApplyContexts(modulationContexts.map(c => ({
        ...c,
        absBeat: c.absBeat + offsetBeats,
        measureIndex: c.measureIndex + offset,
      })));
    }
    onClose();
  }, [generatedNotes, onApplyNotes, onApplyContexts, onClose, useMelody, sopranoFromScore, useBass, bassFromScore, existingNotes, insertMeasure, enabledVoices, localTs, modulationContexts]);

  // Load preset
  const handlePreset = useCallback((preset: typeof PRESETS[number]) => {
    setProgressionText(preset.chords);
    if (preset.minor !== undefined) {
      setLocalMinor(preset.minor);
    }
    setGeneratedNotes(null);
    setViolations([]);
    setError(null);
  }, []);

  // Auto-harmonize: generate roman progression from soprano melody
  const handleAutoHarmonize = useCallback(() => {
    if (sopranoFromScore.length === 0) return;
    try {
      const constraints: SopranoConstraint[] = sopranoFromScore.map(n => ({
        midi: n.midi,
        measure: n.measureIndex ?? 0,
        beat: n.beat ?? 1,
      }));
      const beatsPerMeasure = localTs.numerator * (4 / localTs.denominator);
      const autoProgression = autoHarmonize(constraints, localTonic, localMinor, harmonicRhythmBeats, beatsPerMeasure);
      // Build text representation
      const text = autoProgression.map(c => c.roman).join(' - ');
      setProgressionText(text);
      setGeneratedNotes(null);
      setViolations([]);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Errore nell\'armonizzazione automatica.');
    }
  }, [sopranoFromScore, localTonic, localMinor, harmonicRhythmBeats, localTs]);

  if (!isOpen) return null;

  const TONICS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

  return (
    <DraggablePanel onClose={onClose}>

          {/* Progression input */}
          <div className="mb-4">
            <label className="block text-xs text-gray-300 mb-1">Progressione (separata da spazi, trattini o virgole)</label>
            <input
              ref={inputRef}
              type="text"
              value={progressionText}
              onChange={e => { setProgressionText(e.target.value); setGeneratedNotes(null); setViolations([]); setError(null); }}
              placeholder="I - IV - V7 - I"
              className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white font-mono
                focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); }}
            />

            {/* ── Degree quick-insert buttons ── */}
            {(() => {
              const DEGREES_MAJ = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viio'];
              const DEGREES_MIN = ['i', 'iio', 'III', 'iv', 'V', 'VI', 'VII'];
              const degrees = localMinor ? DEGREES_MIN : DEGREES_MAJ;
              const INVERSIONS_TRIAD = ['6', '6/4'];
              const INVERSIONS_7TH = ['6/5', '4/3', '4/2'];

              // Flip quality: IV→iv, ii→II, etc.
              const flipCase = (deg: string): string => {
                const core = deg.replace(/[o+]$/g, ''); // strip trailing ° or +
                const suffix = deg.slice(core.length);
                const isUpper = core === core.toUpperCase();
                return (isUpper ? core.toLowerCase() : core.toUpperCase()) + suffix;
              };

              const appendChord = (deg: string) => {
                setProgressionText(prev => {
                  const t = prev.trim();
                  // If last token ends with '/', append as secondary target (V/V, viio/ii)
                  if (t && t.endsWith('/')) {
                    const parts = t.split(/\s*[-,]\s*/);
                    parts[parts.length - 1] = parts[parts.length - 1] + deg;
                    return parts.join(' - ');
                  }
                  return t ? t + ' - ' + deg : deg;
                });
                setGeneratedNotes(null); setViolations([]); setError(null);
              };

              const appendSuffix = (suffix: string) => {
                setProgressionText(prev => {
                  const t = prev.trim();
                  if (!t) return t;
                  // Remove trailing separator if any, then append suffix to last token
                  const parts = t.split(/\s*[-,]\s*/);
                  const last = parts[parts.length - 1];
                  parts[parts.length - 1] = last + suffix;
                  return parts.join(' - ');
                });
                setGeneratedNotes(null); setViolations([]); setError(null);
              };

              const removeLast = () => {
                setProgressionText(prev => {
                  const parts = prev.trim().split(/\s*[-,]\s*/).filter(Boolean);
                  parts.pop();
                  return parts.join(' - ');
                });
                setGeneratedNotes(null); setViolations([]); setError(null);
              };

              const btnCls = 'px-1.5 py-0.5 text-[11px] rounded font-bold transition-colors bg-slate-700 text-gray-300 hover:bg-slate-600 hover:text-white';
              const sepCls = 'w-px h-5 bg-gray-600 mx-0.5';

              return (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {degrees.map((deg, i) => (
                    <button key={i}
                      onClick={(e) => appendChord(e.altKey || e.shiftKey ? flipCase(deg) : deg)}
                      className={btnCls}
                      title={`${deg} (Shift/Alt+click → ${flipCase(deg)})`}>{deg}</button>
                  ))}
                  <div className={sepCls} />
                  <button onClick={() => appendSuffix('7')} className={btnCls} title="Aggiungi 7ª">7</button>
                  <button onClick={() => appendSuffix('o')} className={btnCls} title="Diminuito (°)">°</button>
                  <button onClick={() => appendSuffix('+')} className={btnCls} title="Aumentato (+)">+</button>
                  <button onClick={() => appendSuffix('/')} className={btnCls + ' text-yellow-400'} title="Dominante secondaria (/ poi click grado)">/ →</button>
                  <div className={sepCls} />
                  {INVERSIONS_TRIAD.map(inv => (
                    <button key={inv} onClick={() => appendSuffix(inv)} className={btnCls}
                      title={`Rivolto ${inv}`}>{inv}</button>
                  ))}
                  <div className={sepCls} />
                  {INVERSIONS_7TH.map(inv => (
                    <button key={inv} onClick={() => appendSuffix(inv)} className={btnCls}
                      title={`Rivolto 7ª: ${inv}`}>{inv}</button>
                  ))}
                  <div className={sepCls} />
                  <button onClick={() => {
                    setProgressionText(prev => {
                      const t = prev.trim();
                      return t ? t + ' - →' : '→';
                    });
                    setGeneratedNotes(null); setViolations([]); setError(null);
                  }} className={btnCls + ' text-cyan-400 hover:text-cyan-300'}
                    title="Modulazione — inserisce →, poi digita la tonalità (es. G: Bb: f#:)">→ mod</button>
                  <div className={sepCls} />
                  <button onClick={removeLast} className={btnCls + ' text-red-400 hover:text-red-300'}
                    title="Rimuovi ultimo accordo">⌫</button>
                </div>
              );
            })()}

            {/* ── Chord suggestions based on corpus statistics ── */}
            {(() => {
              const tokens = progressionText.trim().split(/\s*[-,]\s*/).filter(Boolean);
              if (tokens.length === 0) return null;
              const recent = tokens.slice(-2);
              const suggestions: ChordSuggestion[] = suggestNextChord(recent, 6);
              if (suggestions.length === 0) return null;
              return (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-gray-500 mr-1" title="Suggerimenti basati sul corpus di composizioni analizzate">💡</span>
                  {suggestions.map((s, i) => (
                    <button key={i}
                      onClick={() => {
                        setProgressionText(prev => {
                          const t = prev.trim();
                          return t ? t + ' - ' + s.chord : s.chord;
                        });
                        setGeneratedNotes(null); setViolations([]); setError(null);
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded font-mono transition-colors
                        bg-cyan-900/40 text-cyan-300 hover:bg-cyan-800/60 hover:text-cyan-100
                        border border-cyan-700/30"
                      title={`${s.chord} (${Math.round(s.probability * 100)}%)`}
                    >
                      {s.chord} <span className="text-[8px] text-cyan-500 ml-0.5">{Math.round(s.probability * 100)}%</span>
                    </button>
                  ))}
                </div>
              );
            })()}

            <details className="mt-1">
              <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-300 select-none">Guida sintassi</summary>
              <div className="mt-1 p-2 bg-slate-800 rounded border border-slate-700 text-[10px] text-gray-400 leading-relaxed grid grid-cols-2 gap-x-4 gap-y-0.5">
                <div><span className="text-white font-mono">I ii IV V vi viio</span> — grado (maiuscolo=Magg, minuscolo=min)</div>
                <div><span className="text-white font-mono">V7 ii7</span> — settima</div>
                <div><span className="text-white font-mono">I6 I6/4 I64</span> — inversioni (1°, 2°)</div>
                <div><span className="text-white font-mono">V6/5 V4/3 V4/2</span> — inversioni settime</div>
                <div><span className="text-white font-mono">viio vii°</span> — diminuito</div>
                <div><span className="text-white font-mono">III+</span> — aumentato</div>
                <div><span className="text-white font-mono">iiø7</span> — semidiminuito</div>
                <div><span className="text-white font-mono">V/V V7/IV viio/ii</span> — dominanti secondarie</div>
                <div><span className="text-white font-mono">bII bVII #IV</span> — gradi cromatici (♭/♯ sulla fondamentale)</div>
                <div><span className="text-white font-mono">It6 Fr6 Ger6</span> — seste eccedenti (It., Fr., Ted.)</div>
                <div><span className="text-white font-mono">Vdom7 IVmaj7</span> — 7ᵃ dom. / 7ᵃ magg. esplicita</div>
                <div><span className="text-white font-mono">→G: →Bb: →f#:</span> — modulazione (maiusc=Magg, minusc=min)</div>
                <div><span className="text-white font-mono">|</span> — stanghetta (forza nuova misura)</div>
                <div className="col-span-2 mt-1 border-t border-slate-700 pt-1">
                  <span className="text-gray-300">Valori inline:</span>{' '}
                  <span className="text-white font-mono">I:w</span>=semibreve{' '}
                  <span className="text-white font-mono">IV:h</span>=minima{' '}
                  <span className="text-white font-mono">V7:q</span>=semiminima{' '}
                  <span className="text-white font-mono">ii:e</span>=croma{' '}
                  <span className="text-white font-mono">viio:s</span>=semicroma
                </div>
              </div>
            </details>
          </div>

          {/* Presets (dropdown) */}
          <div className="mb-4">
            <label className="block text-xs text-gray-300 mb-1">Progressioni</label>
            <div className="flex items-center gap-2">
              <select
                value=""
                onChange={e => {
                  const val = e.target.value;
                  if (!val) return;
                  // Format: "builtin:INDEX" or "custom:INDEX"
                  const [type, idxStr] = val.split(':');
                  const idx = Number(idxStr);
                  const list = type === 'custom' ? customPresets : PRESETS;
                  const preset = list[idx];
                  if (preset) handlePreset(preset);
                }}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
              >
                <option value="">Seleziona progressione…</option>
                <optgroup label="Cadenze e progressioni">
                  {PRESETS.map((p, i) => (
                    <option key={`b-${i}`} value={`builtin:${i}`}>{p.label}</option>
                  ))}
                </optgroup>
                {customPresets.length > 0 && (
                  <optgroup label="Le mie progressioni">
                    {customPresets.map((p, i) => (
                      <option key={`c-${i}`} value={`custom:${i}`}>{p.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                onClick={saveCustomPreset}
                disabled={!progressionText.trim()}
                className="px-2 py-2 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white
                  disabled:opacity-40 disabled:cursor-not-allowed"
                title="Salva la progressione corrente nei preferiti"
              >💾</button>
              {customPresets.length > 0 && (
                <button
                  onClick={() => {
                    const idx = customPresets.findIndex(p => p.chords === progressionText.trim());
                    if (idx >= 0) deleteCustomPreset(idx);
                  }}
                  disabled={!customPresets.some(p => p.chords === progressionText.trim())}
                  className="px-2 py-2 text-xs rounded bg-red-800 hover:bg-red-700 text-white
                    disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Elimina questa progressione dai preferiti"
                >🗑</button>
              )}
            </div>
          </div>

          {/* Config row: Tonica, Modo, Metro, Valore */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-300 mb-1">Tonica</label>
              <select
                value={localTonic}
                onChange={e => { setLocalTonic(e.target.value); setGeneratedNotes(null); }}
                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
              >
                {TONICS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">Modo</label>
              <select
                value={localMinor ? 'minor' : 'major'}
                onChange={e => { setLocalMinor(e.target.value === 'minor'); setGeneratedNotes(null); }}
                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
              >
                <option value="major">Maggiore</option>
                <option value="minor">Minore</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">Metro</label>
              <div className="flex gap-1">
                <select
                  value={localTs.numerator}
                  onChange={e => { setLocalTs(ts => ({ ...ts, numerator: Number(e.target.value) })); setGeneratedNotes(null); }}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                >
                  {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-gray-400 self-center">/</span>
                <select
                  value={localTs.denominator}
                  onChange={e => { setLocalTs(ts => ({ ...ts, denominator: Number(e.target.value) })); setGeneratedNotes(null); }}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                >
                  {[2, 4, 8].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">Valore nota</label>
              <div className="flex gap-1">
                {DURATION_OPTIONS.map(d => (
                  <button
                    key={d.value}
                    title={d.label}
                    onClick={() => { setSelectedDuration(d.value); setGeneratedNotes(null); }}
                    className={`flex-1 flex items-center justify-center p-1.5 rounded border transition-colors ${
                      selectedDuration === d.value
                        ? 'bg-blue-600 border-blue-400 text-white'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    <svg width="16" height="28" viewBox="0 0 20 36" className="shrink-0">
                      {NOTE_ICON_PATHS[d.value]}
                    </svg>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">Disposiz. 1° acc.</label>
              <select
                value={initialDisposition}
                onChange={e => { setInitialDisposition(e.target.value); setGeneratedNotes(null); }}
                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
              >
                <option value="auto">Auto</option>
                <option value="R358">R-3-5-8</option>
                <option value="R538">R-5-3-8</option>
                <option value="R835">R-8-3-5</option>
                <option value="R385">R-3-8-5</option>
                <option value="R583">R-5-8-3</option>
                <option value="R853">R-8-5-3</option>
              </select>
            </div>
          </div>

          {/* Rules */}
          <div className="mb-4">
            <label className="block text-xs text-gray-300 mb-1">Regole di voce</label>
            <div className="flex flex-wrap gap-4 text-xs text-slate-200">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={doubleRoot} onChange={() => setDoubleRoot(v => !v)} className="accent-cyan-500" />
                Raddoppia fondamentale
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={allowParallel5ths} onChange={() => setAllowParallel5ths(v => !v)} className="accent-cyan-500" />
                Permetti 5e parallele
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={allowParallel8ves} onChange={() => setAllowParallel8ves(v => !v)} className="accent-cyan-500" />
                Permetti 8e parallele
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={allowCrossing} onChange={() => setAllowCrossing(v => !v)} className="accent-cyan-500" />
                Permetti voice crossing
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={autoSevenths} onChange={() => setAutoSevenths(v => !v)} className="accent-cyan-500" />
                Auto 7ª
              </label>
            </div>
          </div>

          {/* Melody constraint toggle */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-200">
              <input
                type="checkbox"
                checked={useMelody}
                onChange={() => { setUseMelody(v => !v); setGeneratedNotes(null); }}
                className="accent-amber-500"
                disabled={sopranoFromScore.length === 0}
              />
              <span className={sopranoFromScore.length === 0 ? 'text-gray-500' : ''}>
                Armonizza melodia esistente (soprano)
              </span>
            </label>
            {useMelody && sopranoFromScore.length > 0 && (
              <div className="mt-1 p-2 bg-slate-800 rounded border border-slate-700 text-[10px] text-gray-400">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-amber-300 font-semibold">{sopranoFromScore.length}</span> note soprano trovate
                    {' — '}il motore genererà solo Alto, Tenore e Basso.
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <label className="text-[10px] text-gray-400 whitespace-nowrap">Ritmo arm.:</label>
                    <select
                      value={harmonicRhythmBeats}
                      onChange={e => { setHarmonicRhythmBeats(Number(e.target.value)); setGeneratedNotes(null); }}
                      className="bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-[10px] text-white"
                    >
                      <option value={0}>Per nota</option>
                      <option value={0.5}>♪ Croma</option>
                      <option value={1}>♩ Semiminima</option>
                      <option value={2}>𝅗𝅥 Minima</option>
                      <option value={4}>𝅝 Semibreve</option>
                    </select>
                    <button
                      onClick={handleAutoHarmonize}
                      className="px-2 py-1 text-[10px] rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold whitespace-nowrap"
                      title="Genera automaticamente la progressione di roman numerals dalla melodia"
                    >
                      ✨ Auto-armonizza
                    </button>
                  </div>
                </div>
                <div className="mt-0.5 text-gray-500">
                  Melodia: {sopranoFromScore.slice(0, 12).map(n => `${n.pitch ?? '?'}${n.octave ?? ''}`).join(' ')}{sopranoFromScore.length > 12 ? ' \u2026' : ''}
                </div>
              </div>
            )}
            {sopranoFromScore.length === 0 && (
              <div className="mt-1 text-[10px] text-gray-500">
                Nessuna nota voice 1 trovata sullo staff. Inserisci prima la melodia.
              </div>
            )}
          </div>

          {/* Bass constraint toggle ("basso dato") */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-200">
              <input
                type="checkbox"
                checked={useBass}
                onChange={() => { setUseBass(v => !v); setGeneratedNotes(null); }}
                className="accent-amber-500"
                disabled={bassFromScore.length === 0}
              />
              <span className={bassFromScore.length === 0 ? 'text-gray-500' : ''}>
                Armonizza basso dato (bass)
              </span>
            </label>
            {useBass && bassFromScore.length > 0 && (
              <div className="mt-1 p-2 bg-slate-800 rounded border border-slate-700 text-[10px] text-gray-400">
                <div>
                  <span className="text-amber-300 font-semibold">{bassFromScore.length}</span> note basso trovate
                  {' — '}il motore genererà solo Soprano, Alto e Tenore.
                </div>
                <div className="mt-0.5 text-gray-500">
                  Basso: {bassFromScore.slice(0, 12).map(n => `${n.pitch ?? '?'}${n.octave ?? ''}`).join(' ')}{bassFromScore.length > 12 ? ' …' : ''}
                </div>
              </div>
            )}
            {bassFromScore.length === 0 && (
              <div className="mt-1 text-[10px] text-gray-500">
                Nessuna nota voice 4 trovata sullo staff.
              </div>
            )}
          </div>

          {/* Parsed preview */}
          {parsedPreview.length > 0 && (
            <div className="mb-4 p-2 bg-slate-800 rounded-md border border-slate-700">
              <label className="block text-xs text-gray-400 mb-1">Anteprima ({parsedPreview.length} accordi)</label>
              <div className="flex flex-wrap gap-2 text-sm font-mono text-white">
                {parsedPreview.map((p, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-700 rounded" title={`${p.quality}, inv ${p.inv}, m${p.m + 1} b${p.b}, ${p.dur}`}>
                    {p.roman}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-3 p-2 bg-red-900/50 border border-red-700 rounded-md text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Violations */}
          {violations.length > 0 && (
            <div className="mb-3 p-2 bg-amber-900/30 border border-amber-700 rounded-md text-amber-300 text-xs max-h-[120px] overflow-y-auto">
              <div className="font-bold mb-1">⚠ {violations.length} violazion{violations.length === 1 ? 'e' : 'i'}</div>
              {violations.map((v, i) => (
                <div key={i} className="ml-2">{formatViolation(v)}</div>
              ))}
            </div>
          )}

          {/* Generation result summary */}
          {generatedNotes && (
            <div className="mb-3 p-2 bg-emerald-900/30 border border-emerald-700 rounded-md text-emerald-300 text-xs">
              ✓ Generati {generatedNotes.length} note ({generatedNotes.length / 4} accordi SATB)
              {violations.length === 0 && ' — nessuna violazione'}
            </div>
          )}

          {/* Voice enable toggles — shown after first generation */}
          {generatedNotes && generatedNotes.length > 0 && (
            <div className="flex items-center gap-3 p-2 bg-slate-800 rounded border border-slate-700">
              <span className="text-[10px] text-gray-400 mr-1">🎵 Genera voci:</span>
              {([
                { v: 1, label: 'S', enabledCls: 'bg-cyan-600 text-white ring-1 ring-cyan-400' },
                { v: 2, label: 'A', enabledCls: 'bg-green-600 text-white ring-1 ring-green-400' },
                { v: 3, label: 'T', enabledCls: 'bg-amber-600 text-white ring-1 ring-amber-400' },
                { v: 4, label: 'B', enabledCls: 'bg-red-600 text-white ring-1 ring-red-400' },
              ] as const).map(({ v, label, enabledCls }) => (
                <button
                  key={v}
                  onClick={() => toggleEnable(v)}
                  disabled={v === 1 && useMelody}
                  className={`px-2 py-0.5 text-[11px] rounded font-bold transition-colors
                    ${v === 1 && useMelody
                      ? 'bg-slate-800 text-gray-600 cursor-not-allowed'
                      : enabledVoices.has(v)
                        ? enabledCls
                        : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}`}
                  title={v === 1 && useMelody
                    ? 'Soprano vincolato dalla melodia'
                    : enabledVoices.has(v)
                      ? `${label} abilitato — verrà rigenerato`
                      : `${label} disabilitato — mantenuto dalla generazione precedente`}
                >
                  {enabledVoices.has(v) ? '✓' : '✗'} {label}
                </button>
              ))}
              {enabledVoices.size < 4 && (
                <span className="text-[9px] text-amber-300 ml-1">
                  Rigenera: solo le voci abilitate cambieranno
                </span>
              )}
            </div>
          )}

          {/* Inserisci dalla misura (1-indexed for UI, 0-indexed internally) */}
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-gray-300">Inserisci dalla misura:</label>
            <input
              type="number"
              min={1}
              value={insertMeasure + 1}
              onChange={e => setInsertMeasure(Math.max(0, (Number(e.target.value) || 1) - 1))}
              className="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white text-center"
            />
            {insertMeasure > 0 && (
              <span className="text-[9px] text-cyan-300">Le note precedenti (mis. 1–{insertMeasure}) verranno mantenute</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 justify-end">

          {/* ── Style Profile (Adaptive Learning) ── */}
          <div className="mb-4 p-3 rounded-lg border border-slate-700 bg-slate-800/60">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-200 mb-2">
              <input
                type="checkbox"
                checked={useStyleProfile}
                onChange={() => setUseStyleProfile(v => !v)}
                className="accent-violet-500"
                disabled={!styleProfile}
              />
              <span className={!styleProfile ? 'text-gray-500' : ''}>
                Adatta allo stile dei miei brani
              </span>
            </label>

            {styleProfile && (
              <div className="text-[10px] text-gray-400 mb-2">
                Profilo: <span className="text-violet-300 font-semibold">{styleProfile.filesAnalyzed}</span> bran{styleProfile.filesAnalyzed === 1 ? 'o' : 'i'} analizzat{styleProfile.filesAnalyzed === 1 ? 'o' : 'i'}
                {styleProfile.lastUpdated && (
                  <span> — agg. {new Date(styleProfile.lastUpdated).toLocaleDateString('it-IT')}</span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!existingNotes || existingNotes.length < 8) {
                    setLearnFeedback('Servono almeno 8 note sullo staff per apprendere.');
                    setTimeout(() => setLearnFeedback(null), 3000);
                    return;
                  }
                  try {
                    const newProfile = extractStyleProfile(existingNotes, localTonic, localMinor, localTs);
                    const merged = mergeProfiles(styleProfile, newProfile);
                    setStyleProfile(merged);
                    saveStyleProfile(merged);
                    setUseStyleProfile(true);
                    setLearnFeedback(`Appreso! Profilo aggiornato (${merged.filesAnalyzed} brani).`);
                    setTimeout(() => setLearnFeedback(null), 4000);
                  } catch (err: any) {
                    setLearnFeedback('Errore: ' + (err?.message || 'estrazione fallita'));
                    setTimeout(() => setLearnFeedback(null), 4000);
                  }
                }}
                className="px-2 py-1 text-[10px] rounded bg-violet-700 hover:bg-violet-600 text-white font-semibold whitespace-nowrap
                  disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!existingNotes || existingNotes.length < 8}
                title="Analizza le note attualmente sullo staff e aggiorna il profilo stilistico"
              >
                🎓 Apprendi da questo file
              </button>

              {styleProfile && (
                <button
                  onClick={() => {
                    clearStyleProfile();
                    setStyleProfile(null);
                    setUseStyleProfile(false);
                    setLearnFeedback('Profilo cancellato.');
                    setTimeout(() => setLearnFeedback(null), 3000);
                  }}
                  className="px-2 py-1 text-[10px] rounded bg-red-900/60 hover:bg-red-800/80 text-red-300 whitespace-nowrap"
                  title="Cancella il profilo stilistico salvato"
                >
                  ✕ Resetta
                </button>
              )}

              <button
                onClick={() => {
                  try {
                    const imported = defaultStyleProfileData as unknown as StyleProfile;
                    const merged = mergeProfiles(styleProfile, imported);
                    setStyleProfile(merged);
                    saveStyleProfile(merged);
                    setUseStyleProfile(true);
                    setLearnFeedback(`Repertorio caricato! ${imported.filesAnalyzed} brani (${merged.filesAnalyzed} totali nel profilo).`);
                    setTimeout(() => setLearnFeedback(null), 4000);
                  } catch (err: any) {
                    setLearnFeedback('Errore: ' + (err?.message || 'caricamento fallito'));
                    setTimeout(() => setLearnFeedback(null), 4000);
                  }
                }}
                className="px-2 py-1 text-[10px] rounded bg-indigo-700 hover:bg-indigo-600 text-white font-semibold whitespace-nowrap"
                title="Carica il profilo stilistico pre-calcolato da 46 brani di repertorio (Bach, Dubois, ecc.)"
              >
                📚 Carica da repertorio ({(defaultStyleProfileData as any).filesAnalyzed} brani)
              </button>
            </div>

            {learnFeedback && (
              <div className="mt-1.5 text-[10px] text-amber-300 animate-pulse">{learnFeedback}</div>
            )}
          </div>
            <button
              onClick={handleGenerate}
              className="px-4 py-2 text-sm rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-semibold
                disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={progressionText.trim().length === 0 && !((useMelody && sopranoFromScore.length > 0) || (useBass && bassFromScore.length > 0))}
            >
              Genera
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-2 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold
                disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!generatedNotes || generatedNotes.length === 0}
            >
              Applica al Grand Staff
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md bg-slate-600 hover:bg-slate-500 text-white font-semibold"
            >
              Annulla
            </button>
          </div>
    </DraggablePanel>
  );
};

export default RomanProgressionEditor;
