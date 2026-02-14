/**
 * RomanProgressionEditor — Pannello per generare corali SATB da Roman Numerals.
 *
 * L'utente inserisce una progressione (es. "I - IV - V7 - I"),
 * sceglie tonalità/modo/metro, configura regole, preme "Genera".
 * Il risultato (StaffNote[]) viene iniettato nel GrandStaffEditor.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { StaffNote, TimeSignature } from '../types';
import {
  realizeChorale,
  parseRoman,
  resetNoteIdCounter,
  autoHarmonize,
  type RomanChord,
  type ChoralConfig,
  type ChoralRules,
  type ChoralViolation,
  type SopranoConstraint,
} from '../engine/choralRealization';

// ─── Props ─────────────────────────────────────────────────────────────────

export interface RomanProgressionEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyNotes: (notes: StaffNote[]) => void;
  keySignatureRoot: string;
  isMinorMode: boolean;
  timeSignature: TimeSignature;
  /** Existing notes on the staff — used to extract soprano melody for constrained harmonization. */
  existingNotes?: StaffNote[];
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
  { label: 'i–iv–V–i (minore)', chords: 'i - iv - V - i', minor: true },
];

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

  for (const raw of rawTokens) {
    // Barline
    if (raw === '|') {
      measure++;
      currentBeat = 1;
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
    });

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
  keySignatureRoot,
  isMinorMode,
  timeSignature,
  existingNotes,
}) => {
  const [progressionText, setProgressionText] = useState('I - IV - V7 - I');
  const [localTonic, setLocalTonic] = useState(keySignatureRoot);
  const [localMinor, setLocalMinor] = useState(isMinorMode);
  const [localTs, setLocalTs] = useState<TimeSignature>(timeSignature);
  const [selectedDuration, setSelectedDuration] = useState('quarter');

  // Rules
  const [allowParallel5ths, setAllowParallel5ths] = useState(false);
  const [allowParallel8ves, setAllowParallel8ves] = useState(false);
  const [allowCrossing, setAllowCrossing] = useState(false);
  const [doubleRoot, setDoubleRoot] = useState(true);

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

  // Voice locking: set of voice numbers (1=S, 2=A, 3=T, 4=B) to keep fixed on re-generate
  const [lockedVoices, setLockedVoices] = useState<Set<number>>(new Set());
  const toggleLock = useCallback((v: number) => {
    setLockedVoices(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }, []);

  // Generation result
  const [generatedNotes, setGeneratedNotes] = useState<StaffNote[] | null>(null);
  const [violations, setViolations] = useState<ChoralViolation[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      const progression = parseProgressionString(progressionText, localTs, selectedDuration);
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

      resetNoteIdCounter();
      const result = realizeChorale(progression, config);

      // If there are locked voices and a previous generation, overlay locked voice notes
      let finalNotes = result.notes;
      if (lockedVoices.size > 0 && generatedNotes && generatedNotes.length > 0) {
        const unlocked = result.notes.filter(n => !lockedVoices.has(n.voice ?? 1));
        const locked = generatedNotes.filter(n => lockedVoices.has(n.voice ?? 1));
        finalNotes = [...locked, ...unlocked];
      }

      setGeneratedNotes(finalNotes);
      setViolations(result.violations);
    } catch (err: any) {
      setError(err?.message || 'Errore durante la generazione.');
      setGeneratedNotes(null);
      setViolations([]);
    }
  }, [progressionText, localTonic, localMinor, localTs, selectedDuration, allowParallel5ths, allowParallel8ves, allowCrossing, doubleRoot, useMelody, sopranoFromScore, lockedVoices, generatedNotes]);

  // Apply to editor
  const handleApply = useCallback(() => {
    if (!generatedNotes || generatedNotes.length === 0) return;
    if (useMelody && sopranoFromScore.length > 0) {
      // In melody mode: only replace inner voices (A/T/B = voices 2,3,4),
      // keep the original soprano (voice 1) from existingNotes.
      const sopranoOriginals = (existingNotes || []).filter(n => n && (n.voice === 1 || n.voice === undefined));
      const generatedInner = generatedNotes.filter(n => n.voice !== 1);
      onApplyNotes([...sopranoOriginals, ...generatedInner]);
    } else {
      onApplyNotes(generatedNotes);
    }
    onClose();
  }, [generatedNotes, onApplyNotes, onClose, useMelody, sopranoFromScore, existingNotes]);

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

          {/* Presets */}
          <div className="mb-4">
            <label className="block text-xs text-gray-300 mb-1">Preset</label>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handlePreset(p)}
                  className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600"
                >
                  {p.label}
                </button>
              ))}
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
              <select
                value={selectedDuration}
                onChange={e => { setSelectedDuration(e.target.value); setGeneratedNotes(null); }}
                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
              >
                {DURATION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
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
                    {' \u2014 '}il motore generer\u00e0 solo Alto, Tenore e Basso.
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

          {/* Voice lock toggles — shown after first generation */}
          {generatedNotes && generatedNotes.length > 0 && (
            <div className="flex items-center gap-3 p-2 bg-slate-800 rounded border border-slate-700">
              <span className="text-[10px] text-gray-400 mr-1">🔒 Blocca voci:</span>
              {([
                { v: 1, label: 'S', lockedCls: 'bg-cyan-600 text-white ring-1 ring-cyan-400' },
                { v: 2, label: 'A', lockedCls: 'bg-green-600 text-white ring-1 ring-green-400' },
                { v: 3, label: 'T', lockedCls: 'bg-amber-600 text-white ring-1 ring-amber-400' },
                { v: 4, label: 'B', lockedCls: 'bg-red-600 text-white ring-1 ring-red-400' },
              ] as const).map(({ v, label, lockedCls }) => (
                <button
                  key={v}
                  onClick={() => toggleLock(v)}
                  className={`px-2 py-0.5 text-[11px] rounded font-bold transition-colors
                    ${lockedVoices.has(v)
                      ? lockedCls
                      : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}`}
                  title={lockedVoices.has(v)
                    ? `${label} bloccato — verrà mantenuto alla rigenerazione`
                    : `Blocca ${label} — mantieni questa voce e rigenera le altre`}
                >
                  {lockedVoices.has(v) ? '🔒' : '🔓'} {label}
                </button>
              ))}
              {lockedVoices.size > 0 && (
                <span className="text-[9px] text-amber-300 ml-1">
                  Rigenera: solo le voci sbloccate cambieranno
                </span>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleGenerate}
              className="px-4 py-2 text-sm rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-semibold
                disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={progressionText.trim().length === 0}
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
