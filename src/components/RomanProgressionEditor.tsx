/**
 * RomanProgressionEditor — Pannello per generare corali SATB da Roman Numerals.
 *
 * L'utente inserisce una progressione (es. "I - IV - V7 - I"),
 * sceglie tonalità/modo/metro, configura regole, preme "Genera".
 * Il risultato (StaffNote[]) viene iniettato nel GrandStaffEditor.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  WholeNoteIcon, HalfNoteIcon, QuarterNoteIcon, EighthNoteIcon, SixteenthNoteIcon, DotIcon,
} from './icons/NoteValueIcons';
import { tonicaReale } from '../utils/relativeMinors';

// ─── Props ─────────────────────────────────────────────────────────────────

export interface RomanProgressionEditorProps {
  isOpen: boolean;
  onClose: () => void;
  /** @param vociScritte le voci che questa generazione ha davvero scritto: le altre non
   *  vanno toccate. Il selettore «voci» promette che una voce spenta resta com'è, e senza
   *  questo dato chi riceve le note non ha modo di mantenerla. */
  onApplyNotes: (notes: StaffNote[], vociScritte?: Set<number>) => void;
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

const PRESETS: { labelKey: string; chords: string; minor?: boolean }[] = [
  { labelKey: 'chorale_preset_authentic', chords: 'I - IV - V - I' },
  { labelKey: 'chorale_preset_plagal', chords: 'I - IV - I' },
  { labelKey: 'chorale_preset_fourth_prog', chords: 'I - IV - viio - iii - vi - ii - V - I' },
  { labelKey: 'chorale_preset_passamezzo', chords: 'i - VII - i - V - III - VII - i - V - i', minor: true },
  { labelKey: 'chorale_preset_romanesca', chords: 'I - V - vi - III - IV - I - IV - V' },
  { labelKey: 'I–IV–V7–I', chords: 'I - IV - V7 - I' },
  { labelKey: 'ii–V–I', chords: 'ii - V7 - I' },
  { labelKey: 'I–vi–IV–V', chords: 'I - vi - IV - V' },
  { labelKey: 'I–V–vi–IV', chords: 'I - V - vi - IV' },
  { labelKey: 'ii–I–vi–V', chords: 'ii - I - vi - V' },
  { labelKey: 'IV–I–vi–V', chords: 'IV - I - vi - V' },
  { labelKey: 'vi–IV–I–V', chords: 'vi - IV - I - V' },
  { labelKey: 'chorale_preset_i_iv_v_i', chords: 'i - iv - V - i', minor: true },
];

// ─── Note-value SVG icons (viewBox 0 0 20 36) ─────────────────────────────

/**
 * LE FIGURE, DALLA STESSA FONTE DEL RESTO DELL'APP.
 *
 * Qui c'era un secondo insieme di icone disegnato a mano (viewBox 20×36) mentre
 * `icons/NoteValueIcons` esiste da sempre ed e' quello che usano la toolbar e
 * la tavolozza delle dinamiche. Due disegni della stessa semibreve divergono
 * appena uno dei due si ritocca — e chi guarda il pannello si chiede perche'
 * le note del generatore non siano le note dell'editor.
 *
 * Il PUNTO e' la `DotIcon` condivisa, non un cerchietto scritto a mano. Nella
 * toolbar il punto e' un pulsante a parte, perche' li' si costruisce una nota;
 * qui e' fuso nella voce dell'elenco, perche' si sceglie una durata da una
 * lista, e «minima puntata» e' una voce sola.
 */
const ICONA_DI_DURATA: Record<string, React.FC<{ className?: string }>> = {
  whole: WholeNoteIcon,
  half: HalfNoteIcon,
  quarter: QuarterNoteIcon,
  eighth: EighthNoteIcon,
  sixteenth: SixteenthNoteIcon,
};

/** Una figura, col punto se le serve. `auto` non e' una durata: e' «a ogni
 *  evento», e non ha una figura che la rappresenti. */
const FiguraDurata: React.FC<{ base: string; punto?: boolean; className?: string }> =
  ({ base, punto, className }) => {
    if (base === 'auto') {
      return <span className={`inline-flex items-center justify-center font-bold ${className ?? ''}`}>A</span>;
    }
    const Icona = ICONA_DI_DURATA[base];
    if (!Icona) return null;
    // Allineati in BASSO, non al centro: la testa della nota sta nella parte
    // inferiore del riquadro (cy 24 su 32) mentre il punto della `DotIcon` sta
    // in mezzo (cy 16). Centrandoli, il punto galleggerebbe sopra la testa.
    return (
      <span className="inline-flex items-end">
        <Icona className={className} />
        {punto && <DotIcon className="h-3 w-3 -ml-1 shrink-0" />}
      </span>
    );
  };

// ─── Duration mapping ──────────────────────────────────────────────────────

/**
 * QUANTO DURA UN'ARMONIA — un comando solo.
 *
 * Erano tre modi di dire la stessa cosa: «Valore nota» per i gradi scritti,
 * «Ritmo armonico» per la melodia, e i suffissi inline nel testo. E i valori
 * coincidevano gia': 0,5 · 1 · 2 · 4 movimenti SONO croma, semiminima, minima,
 * semibreve. Ora la scelta e' una e vale per tutti e due i casi —
 *
 *   coi gradi scritti :  ogni accordo dura quel valore
 *   con una melodia   :  l'armonia cambia ogni quel valore
 *
 * — e «ad ogni nota» e' lo stesso principio all'estremo: l'armonia cambia a
 * ogni evento (ogni nota della melodia; ogni grado che si scrive).
 *
 * I suffissi inline restano, e non sono ridondanti: quelli sono l'ECCEZIONE su
 * un singolo accordo, questo e' la regola. Ora parlano la stessa lingua.
 */
const DURATION_OPTIONS = [
  { value: 'whole',          label: '𝅝 Semibreve',            beats: 4,    base: 'whole',   punto: false },
  { value: 'dotted-half',    label: '𝅗𝅥. Minima puntata',      beats: 3,    base: 'half',    punto: true  },
  { value: 'half',           label: '𝅗𝅥 Minima',               beats: 2,    base: 'half',    punto: false },
  { value: 'dotted-quarter', label: '♩. Semiminima puntata',  beats: 1.5,  base: 'quarter', punto: true  },
  { value: 'quarter',        label: '♩ Semiminima',           beats: 1,    base: 'quarter', punto: false },
  { value: 'eighth',         label: '♪ Croma',                beats: 0.5,  base: 'eighth',  punto: false },
  { value: 'sixteenth',      label: '𝅘𝅥𝅯 Semicroma',            beats: 0.25, base: 'sixteenth', punto: false },
  { value: 'auto',           label: '⏐ Ad ogni nota',         beats: 0,    base: 'auto',    punto: false },
] as const;

/** I movimenti che vale ciascuna scelta, per il ritmo armonico. */
const DURATA_IN_MOVIMENTI: Record<string, number> =
  Object.fromEntries(DURATION_OPTIONS.map(d => [d.value, d.beats]));

const INLINE_DURATION_SUFFIXES: Record<string, string> = {
  ':w': 'whole',
  ':dh': 'dotted-half',
  ':h': 'half',
  ':dq': 'dotted-quarter',
  ':q': 'quarter',
  ':e': 'eighth',
  ':s': 'sixteenth',
};

/** Dal nome della durata al suffisso che si scrive nel testo (`V7:h`): serve a
 *  far dire ai PULSANTI esattamente cio' che si scriverebbe a mano. */
const SUFFISSO_DI_DURATA: Record<string, string> =
  Object.fromEntries(Object.entries(INLINE_DURATION_SUFFIXES).map(([s, d]) => [d, s]));

const DURATION_BEATS: Record<string, number> = {
  'whole': 4, 'dotted-half': 3, 'half': 2, 'dotted-quarter': 1.5, 'quarter': 1, 'eighth': 0.5, 'sixteenth': 0.25,
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

    // Parse the roman numeral to extract inversion info.
    // If the user typed an explicit inversion (e.g. "V6", "ii6/5", "I64"),
    // preserve it in the chord entry so the generator respects it.
    // Special: trailing "5" (e.g. "V5", "I5") = explicit root position.
    const parsedForInv = parseRoman(roman);
    // Detect explicit root-position marker: trailing "5" or "53" after the numeral
    // (but not "65" which is 1st-inv 7th, not "6/5" either — those are handled by parser)
    const explicitRootPos = /^(#?b?[IViv]+[°oø+]?(?:7|maj7|M7)?)5(?:3)?$/.test(roman);
    const hasExplicitInversion = parsedForInv.inversion !== 0 || explicitRootPos;

    result.push({
      roman: explicitRootPos ? roman.replace(/5(?:3)?$/, '') : roman,
      beat: currentBeat,
      measure,
      ...(hasExplicitInversion ? { inversion: parsedForInv.inversion } : {}),
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
  title: string;
  children: React.ReactNode;
}> = ({ onClose, title, children }) => {
  const { t } = useTranslation('ui');
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
        <h2 className="text-white font-bold text-lg pointer-events-none">{title}</h2>
        <button
          onClick={onClose}
          onMouseDown={e => e.stopPropagation()}
          className="text-slate-400 hover:text-white text-xl leading-none px-2"
          aria-label={t('close')}
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
  const { t } = useTranslation('ui');

  /**
   * VUOTO all'apertura, deciso dall'utente il 29/08/2026.
   *
   * Nasceva con `I - IV - V7 - I` dentro, e quel testo ha la PRECEDENZA su tutto: chi
   * apriva il pannello con una melodia sul rigo e spuntava «armonizza melodia esistente»
   * si trovava la melodia ignorata, senza che niente lo dicesse. Un valore di comodo che
   * zittisce il resto non è un valore di comodo. L'esempio resta come segnaposto grigio
   * nel campo, che si vede ma non conta.
   */
  const [progressionText, setProgressionText] = useState('');
  /** I gradi nel riquadro li ha scritti IL GENERATORE (dopo un'armonizzazione)
   *  e non l'utente. Serve a non farglieli rileggere alla pressione dopo: erano
   *  la RISPOSTA di prima, non una richiesta, e riusarli buttava via il ritmo
   *  della melodia distendendo gli accordi su una griglia uniforme. I gradi
   *  scritti a mano invece contano, anche insieme a una melodia data. */
  const [gradiDelGeneratore, setGradiDelGeneratore] = useState(false);
  // `keySignatureRoot` è la fondamentale MAGGIORE relativa, non la tonica: su un brano in
  // Mi minore vale 'G'. Passandolo tale e quale, il pannello proponeva «Sol minore» e il
  // generatore armonizzava in una tonalità dove i Mi e i Si naturali del brano sono
  // estranei. Vedi `utils/relativeMinors.ts`.
  const [localTonic, setLocalTonic] = useState(() => tonicaReale(keySignatureRoot, isMinorMode));
  const [localMinor, setLocalMinor] = useState(isMinorMode);
  const [localTs, setLocalTs] = useState<TimeSignature>(timeSignature);
  /** LA DURATA DELL'ARMONIA, unica. Il valore predefinito e' «ad ogni nota»:
   *  e' quello che il ritmo armonico aveva gia' (una nota, un accordo), e coi
   *  gradi scritti da' lo stesso risultato della semiminima di prima, salvo
   *  l'ultimo accordo, che riempie la misura invece di restare corto. */
  const [durataArmonia, setDurataArmonia] = useState('auto');
  /** I due nomi di prima, ora ricavati: un solo comando, due letture. */
  const selectedDuration = durataArmonia;
  const harmonicRhythmBeats = DURATA_IN_MOVIMENTI[durataArmonia] ?? 0;
  const [initialDisposition, setInitialDisposition] = useState<string>('auto');

  // Rules
  const [allowParallel5ths, setAllowParallel5ths] = useState(false);
  const [allowParallel8ves, setAllowParallel8ves] = useState(false);
  const [allowCrossing, setAllowCrossing] = useState(false);
  const [doubleRoot, setDoubleRoot] = useState(true);
  const [autoSevenths, setAutoSevenths] = useState(true);

  // Style profile (adaptive learning)
  const [useStyleProfile, setUseStyleProfile] = useState(true);
  // Come lavora il generatore. Accesi di default: spegnerli serve a confrontare a orecchio
  // cosa aggiunge ciascuno dei tre stadi.
  const [vetoRegole, setVetoRegole] = useState(true);
  const [passoIndietro, setPassoIndietro] = useState(true);
  const [ripasso, setRipasso] = useState(true);
  const [styleProfile, setStyleProfile] = useState<StyleProfile | null>(() => loadStyleProfile());
  const [learnFeedback, setLearnFeedback] = useState<string | null>(null);

  // Melody constraint mode
  const [useMelody, setUseMelody] = useState(false);
  /** Harmonic rhythm: 0 = per note, 1 = per quarter, 2 = per half, 4 = per whole */


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

  /**
   * PERCHÉ la spunta «armonizza melodia esistente» è spenta.
   *
   * Diceva sempre «Inserisci prima la melodia», anche quando la melodia c'era ed era sotto
   * gli occhi — solo su un'altra voce. L'utente l'ha letto come un guasto e ha riavviato tre
   * volte: il messaggio gli chiedeva di fare una cosa che aveva già fatto. Ora si guarda cosa
   * c'è davvero sul rigo e si dice quello.
   */
  const perchePuntaSpenta = useMemo(() => {
    if (sopranoFromScore.length > 0) return null;
    const tutte = existingNotes ?? [];
    const vive = tutte.filter(n => n && !(n as any).isRest);
    if (vive.length === 0) return { caso: 'vuoto' as const };
    // Le note ci sono: su quale voce stanno?
    const perVoce = new Map<number, number>();
    for (const n of vive) {
      const v = Number((n as any).voice ?? 1);
      perVoce.set(v, (perVoce.get(v) ?? 0) + 1);
    }
    let voceMax = 0, quante = 0;
    for (const [v, q] of perVoce) if (q > quante) { voceMax = v; quante = q; }
    if (voceMax === 1 || quante === 0) {
      // Voce 1 presente ma tutte pause: cancellare lascia l'id e toglie il suono.
      const pause = tutte.filter(n => n && (n as any).isRest && Number((n as any).voice ?? 1) === 1).length;
      return { caso: 'pause' as const, quante: pause };
    }
    const nome = { 2: 'voice_alto', 3: 'voice_tenor', 4: 'voice_bass' }[voceMax] ?? 'voice_soprano';
    return { caso: 'altraVoce' as const, quante, voce: nome };
  }, [sopranoFromScore, existingNotes]);

  /**
   * VOCE INTERNA DATA. Il campo `lockedVoices` del motore lo prometteva dal 15/02/2026 e non
   * era mai stato letto. MISURATO sui 73 brani del banco: armonizzando a partire dal
   * contralto e tenendolo fermo, il 95,8% delle note date viene rispettato con 217 errori —
   * la stessa qualità del caso classico dal soprano (215). Dal tenore, 95,4% e 169 errori.
   * Il resto sono note che l'accordo scelto non contiene: lì il vincolo cade da solo.
   */
  const [useInner, setUseInner] = useState(false);
  const [innerVoice, setInnerVoice] = useState<2 | 3>(2);
  const innerFromScore = useMemo(() => {
    if (!existingNotes?.length) return [];
    return existingNotes
      .filter(n => n && !(n as any).isRest && Number((n as any).voice) === innerVoice)
      .sort((a, b) => {
        const ma = a.measureIndex ?? 0, mb = b.measureIndex ?? 0;
        if (ma !== mb) return ma - mb;
        return (a.beat ?? 1) - (b.beat ?? 1);
      });
  }, [existingNotes, innerVoice]);

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
      setLocalTonic(tonicaReale(keySignatureRoot, isMinorMode));
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
        // Show "5" suffix in preview when user explicitly locked root position
        const displayRoman = (c.inversion === 0 && p.inversion === 0) ? c.roman + '5' : c.roman;
        return { roman: displayRoman, quality: p.quality, degree: p.degree, inv: c.inversion ?? p.inversion, m: c.measure, b: c.beat, dur: c.duration || 'auto' };
      });
    } catch {
      return [];
    }
  }, [progressionText, localTs, selectedDuration]);

  /**
   * `__htGeneratore()` — che cosa sta per usare davvero il pannello.
   *
   * Serve al caso «ho cambiato il motore e il risultato non cambia», che quasi sempre non è
   * il motore: il riquadro dei gradi NASCE PIENO (`I - IV - V7 - I`) e ha la precedenza su
   * tutto, e dopo ogni generazione il pannello ci riscrive dentro il risultato. Da lì in poi
   * si rigenera sempre quella progressione, melodia e basso non vengono nemmeno letti.
   */
  useEffect(() => {
    (window as any).__htGeneratore = () => {
      const daTesto = progressionText.trim().length > 0;
      // eslint-disable-next-line no-console
      console.log({
        'riquadro dei gradi': progressionText.trim() || '(vuoto)',
        'CHI SCEGLIE L\'ARMONIA': daTesto
          ? 'IL RIQUADRO — melodia e basso NON vengono letti. Svuotalo per farli contare.'
          : (useInner && innerFromScore.length > 0) ? `la voce interna (${innerVoice === 2 ? 'contralto' : 'tenore'})`
          : (useBass && bassFromScore.length > 0 && !(useMelody && sopranoFromScore.length > 0)) ? 'il basso'
          : (useMelody && sopranoFromScore.length > 0) ? (useBass && bassFromScore.length > 0 ? 'soprano E basso insieme' : 'il soprano')
          : 'nessuno: manca sia il testo sia una voce data',
        'melodia (spunta)': useMelody, 'note di soprano': sopranoFromScore.length,
        'basso dato (spunta)': useBass, 'note di basso': bassFromScore.length,
        'voce interna (spunta)': useInner, 'note': innerFromScore.length,
        'dalla misura': insertMeasure + 1,
        'tonalita usata': `${localTonic}${localMinor ? ' minore' : ' maggiore'}`,
      });
    };
  }, [progressionText, useMelody, sopranoFromScore, useBass, bassFromScore, useInner, innerVoice, innerFromScore, insertMeasure, localTonic, localMinor]);

  /** C'e' una voce presa dallo spartito che detta l'armonia? Se si', gli accordi
   *  li colloca la MUSICA — dove attaccano le note — e «Valore nota» non ha
   *  niente da dire: le durate escono dalla distanza fra un accordo e il
   *  successivo. */
  const vociDalloSpartito = (useMelody && sopranoFromScore.length > 0)
                         || (useBass && bassFromScore.length > 0)
                         || (useInner && innerFromScore.length > 0);

  // Generate chorale
  const handleGenerate = useCallback(() => {
    try {
      setError(null);
      // UNA VOCE PRESA DALLO SPARTITO COMANDA sui gradi che il generatore stesso
      // ha scritto nel riquadro. Senza questo, la seconda pressione di «Genera»
      // rileggeva la propria risposta di prima e distendeva gli accordi su una
      // griglia uniforme di «Valore nota»: la melodia perdeva il suo ritmo, e il
      // soprano dato — che si cerca per `misura:movimento` esatti — su quella
      // griglia spesso non si trovava piu', cosi' veniva riscritto anche lui.
      // I gradi scritti A MANO restano validi, anche insieme a una melodia.
      const testoDaLeggere = (gradiDelGeneratore && vociDalloSpartito) ? '' : progressionText;
      let progression = parseProgressionString(testoDaLeggere, localTs, selectedDuration);
      // Auto-harmonize when melody mode is active and no progression text
      // La voce INTERNA data ha la precedenza sull'armonizzazione automatica: se c'è, è lei
      // a scegliere l'armonia, esattamente come farebbe il soprano.
      if (progression.length === 0 && useInner && innerFromScore.length > 0) {
        const beatsPerMeasure = localTs.numerator * (4 / localTs.denominator);
        const vincoliInterni: SopranoConstraint[] = innerFromScore
          .filter(n => (n.measureIndex ?? 0) >= insertMeasure)
          .map(n => ({ midi: n.midi, measure: (n.measureIndex ?? 0) - insertMeasure, beat: n.beat ?? 1 }));
        progression = autoHarmonize(vincoliInterni, localTonic, localMinor, harmonicRhythmBeats, beatsPerMeasure);
      }
      if (progression.length === 0 && ((useMelody && sopranoFromScore.length > 0) || (useBass && bassFromScore.length > 0))) {
        const beatsPerMeasure = localTs.numerator * (4 / localTs.denominator);
        // When continuing from a later measure, keep only notes >= insertMeasure
        // and rebase their measureIndex so the generator sees them starting at 0.
        const rebaseSop = sopranoFromScore
          .filter(n => (n.measureIndex ?? 0) >= insertMeasure)
          .map(n => ({ ...n, measureIndex: (n.measureIndex ?? 0) - insertMeasure }));
        const rebaseBass = bassFromScore
          .filter(n => (n.measureIndex ?? 0) >= insertMeasure)
          .map(n => ({ ...n, measureIndex: (n.measureIndex ?? 0) - insertMeasure }));
        if (useBass && rebaseBass.length > 0 && !(useMelody && rebaseSop.length > 0)) {
          // Bass-only: use bass-specific auto-harmonize
          const constraints: SopranoConstraint[] = rebaseBass.map(n => ({
            midi: n.midi,
            measure: n.measureIndex ?? 0,
            beat: n.beat ?? 1,
          }));
          progression = autoHarmonizeFromBass(constraints, localTonic, localMinor, harmonicRhythmBeats, beatsPerMeasure);
        } else {
          // Soprano (or both): use soprano auto-harmonize
          const constraints: SopranoConstraint[] = rebaseSop.map(n => ({
            midi: n.midi,
            measure: n.measureIndex ?? 0,
            beat: n.beat ?? 1,
          }));
          // Se c'è ANCHE il basso, entra nella SCELTA dell'armonia e non solo nella
          // scrittura: è la voce che dice pure il rivolto.
          progression = autoHarmonize(constraints, localTonic, localMinor, harmonicRhythmBeats, beatsPerMeasure,
            (useBass && rebaseBass.length > 0)
              ? { bassoDato: rebaseBass.map(n => ({ midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1 })) }
              : undefined);
        }
        setProgressionText(progression.map(c => c.roman).join(' - '));
        setGradiDelGeneratore(true);
      }
      if (progression.length === 0) {
        // Ora si arriva qui premendo Invio col riquadro vuoto, che dalla 29/08/2026 è lo
        // stato d'apertura: il messaggio deve dire tutte e due le strade, non solo i gradi.
        setError(t('chorale_nothing_to_do'));
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
        vetoRegole,
        passoIndietro,
        ripasso,
        initialDisposition: initialDisposition as any,
        styleProfile: useStyleProfile ? styleProfile : null,
      };

      // Melody constraint: fix soprano from existing voice 1 notes
      // Rebase to 0 when continuing from a later measure.
      if (useMelody && sopranoFromScore.length > 0) {
        const sopranoMelody: SopranoConstraint[] = sopranoFromScore
          .filter(n => (n.measureIndex ?? 0) >= insertMeasure)
          .map(n => ({
            midi: n.midi,
            measure: (n.measureIndex ?? 0) - insertMeasure,
            beat: n.beat ?? 1,
          }));
        config.sopranoMelody = sopranoMelody;
      }

      // Bass constraint ("basso dato") — also rebased.
      if (useBass && bassFromScore.length > 0) {
        config.bassMelody = bassFromScore
          .filter(n => (n.measureIndex ?? 0) >= insertMeasure)
          .map(n => ({
            midi: n.midi,
            measure: (n.measureIndex ?? 0) - insertMeasure,
            beat: n.beat ?? 1,
          }));
      }

      if (useInner && innerFromScore.length > 0) {
        config.lockedVoices = {
          [innerVoice]: innerFromScore
            .filter(n => (n.measureIndex ?? 0) >= insertMeasure)
            .map(n => ({ midi: n.midi, measure: (n.measureIndex ?? 0) - insertMeasure, beat: n.beat ?? 1 })),
        };
      }

      // L'ACCORDO CHE PRECEDE, quando si riparte da metà brano. Senza, il generatore
      // sceglieva il registro come se cominciasse da zero e la giuntura non la controllava
      // nessuno: sul «Delachi n 12» ripartito dalla misura 3 usciva un moto parallelo di
      // tutte e quattro le voci con un salto di tredicesima al basso.
      if (insertMeasure > 0 && existingNotes && existingNotes.length > 0) {
        const primaDelTaglio = existingNotes.filter(n =>
          n && !(n as any).isRest && ((n as any).measureIndex ?? 0) < insertMeasure);
        if (primaDelTaglio.length > 0) {
          const ultimoTick = Math.max(...primaDelTaglio.map(n => (n as any).startTick ?? 0));
          const ultimo = primaDelTaglio.filter(n => ((n as any).startTick ?? 0) === ultimoTick);
          // Solo se l'accordo tenuto ha davvero tutte e quattro le voci: con meno, il
          // seme direbbe una cosa falsa sulla condotta.
          const voci = new Set(ultimo.map(n => (n as any).voice ?? 1));
          if (voci.size === 4) config.notePrecedenti = ultimo;
        }
      }

      resetNoteIdCounter();
      const result = realizeChorale(progression, config);

      setGeneratedNotes(result.notes);
      setViolations(result.violations);
      setModulationContexts(result.modulationContexts ?? []);
    } catch (err: any) {
      setError(err?.message || t('chorale_error_generation'));
      setGeneratedNotes(null);
      setViolations([]);
    }
  }, [progressionText, gradiDelGeneratore, vociDalloSpartito, localTonic, localMinor, localTs, selectedDuration, allowParallel5ths, allowParallel8ves, allowCrossing, doubleRoot, autoSevenths, vetoRegole, passoIndietro, ripasso, useInner, innerVoice, innerFromScore, useMelody, sopranoFromScore, useBass, bassFromScore, harmonicRhythmBeats, initialDisposition, insertMeasure, existingNotes]);

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
    if (useInner && innerFromScore.length > 0) lockedVoices.push(innerVoice);
    if (lockedVoices.length > 0) {
      // Keep only locked-voice notes from the insertion range (>= insertMeasure).
      // Notes from earlier measures are preserved by the merge logic in the parent handler.
      const originals = (existingNotes || []).filter(n =>
        n && lockedVoices.includes((n as any).voice ?? 1) && ((n as any).measureIndex ?? 0) >= offset
      );
      const generatedInner = voiceFiltered.filter(n => !lockedVoices.includes(n.voice ?? 1));
      // Le voci scritte sono quelle abilitate PIÙ quelle date (che passano invariate):
      // tutto il resto non è stato toccato e deve restare dov'è.
      const scritte = new Set<number>([...enabledVoices, ...lockedVoices]);
      onApplyNotes([...originals, ...applyOffset(generatedInner)], scritte);
    } else {
      onApplyNotes(applyOffset(voiceFiltered), new Set<number>(enabledVoices));
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
  }, [generatedNotes, onApplyNotes, onApplyContexts, onClose, useMelody, sopranoFromScore, useBass, bassFromScore, useInner, innerVoice, innerFromScore, existingNotes, insertMeasure, enabledVoices, localTs, modulationContexts]);

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
      // Rebase to 0 when continuing from a later measure.
      const filtered = sopranoFromScore.filter(n => (n.measureIndex ?? 0) >= insertMeasure);
      const constraints: SopranoConstraint[] = filtered
        .map(n => ({
          midi: n.midi,
          measure: (n.measureIndex ?? 0) - insertMeasure,
          beat: n.beat ?? 1,
        }));
      const beatsPerMeasure = localTs.numerator * (4 / localTs.denominator);
      const autoProgression = autoHarmonize(constraints, localTonic, localMinor, harmonicRhythmBeats, beatsPerMeasure);

      // Build text representation with per-chord duration from melody note lengths.
      // Compute each chord's duration from the gap to the next chord (or end of measure).
      const beatsSuffix = (beats: number): string => {
        if (Math.abs(beats - 4) < 0.01) return ':w';
        if (Math.abs(beats - 3) < 0.01) return ':dh'; // dotted half
        if (Math.abs(beats - 2) < 0.01) return ':h';
        if (Math.abs(beats - 1.5) < 0.01) return ':dq'; // dotted quarter
        if (Math.abs(beats - 1) < 0.01) return ':q';
        if (Math.abs(beats - 0.5) < 0.01) return ':e';
        if (Math.abs(beats - 0.25) < 0.01) return ':s';
        return ':q'; // fallback
      };
      const text = autoProgression.map((c, idx) => {
        const absBeat = c.measure * beatsPerMeasure + (c.beat - 1);
        let durBeats = 1; // default quarter
        if (idx < autoProgression.length - 1) {
          const nextAbsBeat = autoProgression[idx + 1].measure * beatsPerMeasure + (autoProgression[idx + 1].beat - 1);
          durBeats = nextAbsBeat - absBeat;
        } else {
          // Last chord: fill to end of measure
          const endOfMeasure = (c.measure + 1) * beatsPerMeasure;
          durBeats = endOfMeasure - absBeat;
        }
        if (durBeats <= 0) durBeats = 1;
        return c.roman + beatsSuffix(durBeats);
      }).join(' - ');

      setProgressionText(text);
      setGeneratedNotes(null);
      setViolations([]);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Errore nell\'armonizzazione automatica.');
    }
  }, [sopranoFromScore, localTonic, localMinor, harmonicRhythmBeats, localTs, insertMeasure]);

  if (!isOpen) return null;

  const TONICS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

  return (
    <DraggablePanel onClose={onClose} title={t('chorale_title')}>

          {/* Progression input */}
          <div className="mb-4">
            <label className="block text-xs text-gray-300 mb-1">{t('chorale_progression_label')}</label>
            <input
              ref={inputRef}
              type="text"
              value={progressionText}
              onChange={e => { setProgressionText(e.target.value); setGradiDelGeneratore(false); setGeneratedNotes(null); setViolations([]); setError(null); }}
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
              const INVERSIONS_TRIAD = ['5', '6', '6/4'];
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

              /**
               * LA DURATA DI UN SINGOLO ACCORDO, a pulsante.
               *
               * L'eccezione si e' sempre potuta scrivere a mano (`V7:h`), ma
               * bisognava sapere le lettere. Ora si fa come i rivolti, che in
               * questa tavolozza si attaccano gia' all'ULTIMO accordo con un
               * clic — ed e' la semantica giusta: «Durata dell'armonia» e' la
               * regola, questa e' la deroga su QUELL'accordo.
               *
               * Cliccare due volte lo stesso valore lo TOGLIE: l'accordo torna
               * alla durata generale, e non serve un pulsante apposta.
               */
              const applicaDurata = (suffisso: string) => {
                setProgressionText(prev => {
                  const t = prev.trim();
                  if (!t) return t;
                  const parts = t.split(/\s*[-,]\s*/);
                  let last = parts[parts.length - 1];
                  // Non su un segno di modulazione (`→G`) ne' su una dominante
                  // secondaria a meta' (`V/`): li' non c'e' ancora un accordo a
                  // cui dare una durata, e uscirebbe `→G:h`.
                  if (/^[→>]/.test(last) || last.endsWith('/')) return prev;
                  let vecchio = '';
                  for (const s of Object.keys(INLINE_DURATION_SUFFIXES)) {
                    if (last.endsWith(s)) { vecchio = s; last = last.slice(0, -s.length); break; }
                  }
                  parts[parts.length - 1] = (vecchio === suffisso) ? last : last + suffisso;
                  return parts.join(' - ');
                });
                setGeneratedNotes(null); setViolations([]); setError(null);
              };

              /** C'e' un accordo a cui la deroga possa applicarsi? Senza, il clic
               *  sarebbe MUTO — ed e' il difetto peggiore: chi clicca non capisce
               *  se ha sbagliato pulsante o se il pulsante e' rotto. Meglio
               *  spento e visibile. */
              const derogaPossibile = (() => {
                const parts = progressionText.trim().split(/\s*[-,]\s*/).filter(Boolean);
                const last = parts[parts.length - 1] || '';
                if (!last) return false;
                return !/^[→>]/.test(last) && !last.endsWith('/');
              })();

              /** Il valore gia' appeso all'ultimo accordo, per accendere il pulsante. */
              const durataDellUltimo = (() => {
                const parts = progressionText.trim().split(/\s*[-,]\s*/).filter(Boolean);
                const last = parts[parts.length - 1] || '';
                for (const s of Object.keys(INLINE_DURATION_SUFFIXES)) if (last.endsWith(s)) return s;
                return '';
              })();

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
                  <button onClick={() => appendSuffix('7')} className={btnCls} title={t('rp_add_seventh')}>7</button>
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
                  {/* LA DEROGA SU UN ACCORDO. Le icone sono le stesse del comando
                      generale — e questo, senza una scritta, le rendeva
                      indistinguibili: due file di note uguali, e non si capisce
                      quale valga per tutti e quale per l'ultimo. La differenza
                      la fanno le parole, non l'aspetto. */}
                  <span className={`text-[10px] whitespace-nowrap ml-0.5 ${derogaPossibile ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t('chorale_this_chord')}
                  </span>
                  {DURATION_OPTIONS.filter(d => d.value !== 'auto' && d.value !== 'sixteenth').map(d => {
                    const suff = SUFFISSO_DI_DURATA[d.value];
                    if (!suff) return null;
                    const acceso = durataDellUltimo === suff;
                    return (
                      <button key={`dur-${d.value}`} onClick={() => applicaDurata(suff)}
                        disabled={!derogaPossibile}
                        title={derogaPossibile
                          ? `${d.label} — ${t('chorale_inline_duration_title')}`
                          : t('chorale_inline_duration_needs_chord')}
                        className={`px-1 py-0.5 rounded transition-colors ${!derogaPossibile
                          ? 'bg-slate-800 text-gray-600 cursor-not-allowed'
                          : acceso
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-gray-300 hover:bg-slate-600 hover:text-white'}`}>
                        <FiguraDurata base={d.base} punto={d.punto} className="h-4 w-4 shrink-0" />
                      </button>
                    );
                  })}
                  <div className={sepCls} />
                  <button onClick={() => {
                    setProgressionText(prev => {
                      const t = prev.trim();
                      return t ? t + ' - →' : '→';
                    });
                    setGeneratedNotes(null); setViolations([]); setError(null);
                  }} className={btnCls + ' text-cyan-400 hover:text-cyan-300'}
                      title={t('chorale_mod_title')}>
                    → mod</button>
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
              // Determine metric position for the next chord
              const numBeats = localTs.numerator;
              const hRhythm = harmonicRhythmBeats || numBeats; // default: 1 chord per measure
              const nextBeatIndex = tokens.length; // 0-based index of next chord
              const nextBeatInMeasure = ((nextBeatIndex * hRhythm) % numBeats) + 1;
              const isStrong = (numBeats === 4 && (nextBeatInMeasure === 1 || nextBeatInMeasure === 3))
                || (numBeats === 3 && nextBeatInMeasure === 1)
                || (numBeats === 2 && nextBeatInMeasure === 1)
                || (numBeats === 6 && (nextBeatInMeasure === 1 || nextBeatInMeasure === 4))
                || nextBeatInMeasure === 1;
              const beatStrength: 'strong' | 'weak' = isStrong ? 'strong' : 'weak';
              const suggestions: ChordSuggestion[] = suggestNextChord(recent, 6, beatStrength);
              if (suggestions.length === 0) return null;
              return (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-gray-500 mr-1" title={t('rp_corpus_tip')}>💡</span>
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
              <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-300 select-none">{t('chorale_syntax_guide')}</summary>
              <div className="mt-1 p-2 bg-slate-800 rounded border border-slate-700 text-[10px] text-gray-400 leading-relaxed grid grid-cols-2 gap-x-4 gap-y-0.5">
                <div><span className="text-white font-mono">I ii IV V vi viio</span> — {t('chorale_syntax_degree')}</div>
                <div><span className="text-white font-mono">V7 ii7</span> — {t('chorale_syntax_seventh')}</div>
                <div><span className="text-white font-mono">I6 I6/4 I64</span> — {t('chorale_syntax_inversions')}</div>
                <div><span className="text-white font-mono">V6/5 V4/3 V4/2</span> — {t('chorale_syntax_seventh_inv')}</div>
                <div><span className="text-white font-mono">viio vii°</span> — {t('chorale_syntax_diminished')}</div>
                <div><span className="text-white font-mono">III+</span> — {t('chorale_syntax_augmented')}</div>
                <div><span className="text-white font-mono">iiø7</span> — {t('chorale_syntax_halfdiminished')}</div>
                <div><span className="text-white font-mono">V/V V7/IV viio/ii</span> — {t('chorale_syntax_secondary_dom')}</div>
                <div><span className="text-white font-mono">bII bVII #IV</span> — {t('chorale_syntax_chromatic')}</div>
                <div><span className="text-white font-mono">It6 Fr6 Ger6</span> — {t('chorale_syntax_aug_sixth')}</div>
                <div><span className="text-white font-mono">Vdom7 IVmaj7</span> — {t('chorale_syntax_dom7')}</div>
                <div><span className="text-white font-mono">→G: →Bb: →f#:</span> — {t('chorale_syntax_modulation')}</div>
                <div><span className="text-white font-mono">|</span> — {t('chorale_syntax_barline')}</div>
                <div className="col-span-2 mt-1 border-t border-slate-700 pt-1">
                  <span className="text-gray-300">{t('chorale_syntax_inline_values')}</span>{' '}
                  <span className="text-white font-mono">I:w</span>={t('chorale_syntax_whole')}{' '}
                  <span className="text-white font-mono">IV:h</span>={t('chorale_syntax_half')}{' '}
                  <span className="text-white font-mono">V7:q</span>={t('chorale_syntax_quarter')}{' '}
                  <span className="text-white font-mono">ii:e</span>={t('chorale_syntax_eighth')}{' '}
                  <span className="text-white font-mono">viio:s</span>={t('chorale_syntax_sixteenth')}
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
                <option value="">{t('rp_pick_progression')}</option>
                <optgroup label="Cadenze e progressioni">
                  {PRESETS.map((p, i) => (
                    <option key={`b-${i}`} value={`builtin:${i}`}>{p.labelKey.startsWith('chorale_') ? t(p.labelKey) : p.labelKey}</option>
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
                title={t('rp_save_fav')}
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
                  title={t('rp_del_fav')}
                >🗑</button>
              )}
            </div>
          </div>

          {/* Config row: Tonica, Modo, Metro, Valore */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-300 mb-1">{t('chorale_tonic_label')}</label>
              <select
                value={localTonic}
                onChange={e => { setLocalTonic(e.target.value); setGeneratedNotes(null); }}
                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
              >
                {TONICS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">{t('chorale_mode_label')}</label>
              <select
                value={localMinor ? 'minor' : 'major'}
                onChange={e => { setLocalMinor(e.target.value === 'minor'); setGeneratedNotes(null); }}
                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
              >
                <option value="major">{t('chorale_mode_major')}</option>
                <option value="minor">{t('chorale_mode_minor')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">{t('chorale_meter_label')}</label>
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
              <label className="block text-xs text-gray-300 mb-1">
                {t('chorale_harmony_duration_label')}
                <span className="ml-1 text-[10px] text-gray-500">
                  — {vociDalloSpartito
                       ? t('chorale_harmony_duration_hint_melody')
                       : t('chorale_harmony_duration_hint_degrees')}
                  {' '}({t('chorale_harmony_duration_all')})
                </span>
              </label>
              <div className="flex gap-1">
                {DURATION_OPTIONS.map(d => (
                  <button
                    key={d.value}
                    title={d.label}
                    onClick={() => { setDurataArmonia(d.value); setGeneratedNotes(null); }}
                    className={`flex-1 flex items-center justify-center p-1.5 rounded border transition-colors ${
                      durataArmonia === d.value
                        ? 'bg-blue-600 border-blue-400 text-white'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    <FiguraDurata base={d.base} punto={d.punto} className="h-5 w-5 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">{t('chorale_voicing_label')}</label>
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
            <label className="block text-xs text-gray-300 mb-1">{t('chorale_voice_rules_label')}</label>
            <div className="flex flex-wrap gap-4 text-xs text-slate-200">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={doubleRoot} onChange={() => setDoubleRoot(v => !v)} className="accent-cyan-500" />
                {t('chorale_double_root')}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={allowParallel5ths} onChange={() => setAllowParallel5ths(v => !v)} className="accent-cyan-500" />
                {t('chorale_allow_par5')}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={allowParallel8ves} onChange={() => setAllowParallel8ves(v => !v)} className="accent-cyan-500" />
                {t('chorale_allow_par8')}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={allowCrossing} onChange={() => setAllowCrossing(v => !v)} className="accent-cyan-500" />
                {t('chorale_allow_crossing')}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={autoSevenths} onChange={() => setAutoSevenths(v => !v)} className="accent-cyan-500" />
                {t('chorale_auto7')}
              </label>
            </div>
          </div>

          {/* Come lavora il generatore: i tre stadi, per poterli confrontare a orecchio.
              Il passo indietro e il ripasso sono parti del veto e senza di lui non girano. */}
          <div className="mb-4">
            <label className="block text-xs text-gray-300 mb-1">{t('chorale_engine_controls_label')}</label>
            <div className="flex flex-wrap gap-4 text-xs text-slate-200">
              <label className="flex items-center gap-1 cursor-pointer" title={t('chorale_veto_rules_hint')}>
                <input type="checkbox" checked={vetoRegole} onChange={() => setVetoRegole(v => !v)} className="accent-cyan-500" />
                {t('chorale_veto_rules')}
              </label>
              <label className={`flex items-center gap-1 ${vetoRegole ? 'cursor-pointer' : 'cursor-default text-gray-500'}`} title={t('chorale_backstep_hint')}>
                <input type="checkbox" checked={vetoRegole && passoIndietro} disabled={!vetoRegole} onChange={() => setPassoIndietro(v => !v)} className="accent-cyan-500" />
                {t('chorale_backstep')}
              </label>
              <label className={`flex items-center gap-1 ${vetoRegole ? 'cursor-pointer' : 'cursor-default text-gray-500'}`} title={t('chorale_ripasso_hint')}>
                <input type="checkbox" checked={vetoRegole && ripasso} disabled={!vetoRegole} onChange={() => setRipasso(v => !v)} className="accent-cyan-500" />
                {t('chorale_ripasso')}
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
                {t('chorale_harmonize_soprano')}
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
                    {/* Il ritmo armonico NON e' piu' un comando a parte: lo dice
                        «Durata dell'armonia», che e' la stessa cosa detta una volta
                        sola. Qui resta il promemoria di cosa e' scelto, dove serve
                        leggerlo senza risalire il pannello. */}
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">
                      {t('chorale_harmony_duration_label')}:{' '}
                      <span className="text-gray-200">
                        {DURATION_OPTIONS.find(d => d.value === durataArmonia)?.label ?? ''}
                      </span>
                    </span>
                    <button
                      onClick={handleAutoHarmonize}
                      className="px-2 py-1 text-[10px] rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold whitespace-nowrap"
                      title={t('chorale_harmonize_soprano_title')}
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
            {perchePuntaSpenta && (
              <div className={`mt-1 text-[10px] ${perchePuntaSpenta.caso === 'vuoto' ? 'text-gray-500' : 'text-amber-300'}`}>
                {perchePuntaSpenta.caso === 'altraVoce'
                  ? t('chorale_melody_other_voice', { quante: perchePuntaSpenta.quante, voce: t(perchePuntaSpenta.voce) })
                  : perchePuntaSpenta.caso === 'pause'
                    ? t('chorale_melody_only_rests', { quante: perchePuntaSpenta.quante })
                    : t('chorale_no_voice1')}
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
                {t('chorale_harmonize_bass')}
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
                {t('chorale_no_voice4')}
              </div>
            )}
          </div>

          {/* Voce INTERNA data. Il campo `lockedVoices` del motore la prometteva dal
              15/02/2026 senza che nessuno la leggesse; qui la promessa viene mantenuta. */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-200">
              <input
                type="checkbox"
                checked={useInner}
                onChange={() => { setUseInner(v => !v); setGeneratedNotes(null); }}
                className="accent-green-500"
                disabled={innerFromScore.length === 0}
              />
              <span className={innerFromScore.length === 0 ? 'text-gray-500' : ''}>
                {t('chorale_harmonize_inner')}
              </span>
              <select
                value={innerVoice}
                onChange={e => { setInnerVoice(Number(e.target.value) as 2 | 3); setGeneratedNotes(null); }}
                className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-[11px] text-white"
              >
                <option value={2}>{t('chorale_inner_alto')}</option>
                <option value={3}>{t('chorale_inner_tenor')}</option>
              </select>
            </label>
            {useInner && innerFromScore.length > 0 && (
              <div className="mt-1 p-2 bg-slate-800 rounded border border-slate-700 text-[10px] text-gray-400">
                <div>
                  <span className="text-green-300 font-semibold">{innerFromScore.length}</span>{' '}
                  {t('chorale_inner_found', { quante: innerFromScore.length, voce: t(innerVoice === 2 ? 'chorale_inner_alto' : 'chorale_inner_tenor') }).replace(/^\d+\s*/, '')}
                </div>
                <div className="mt-0.5 text-gray-500">
                  {innerFromScore.slice(0, 12).map(n => `${n.pitch ?? '?'}${n.octave ?? ''}`).join(' ')}{innerFromScore.length > 12 ? ' …' : ''}
                </div>
                <div className="mt-1 text-[9px] text-amber-300/80">{t('chorale_inner_note')}</div>
              </div>
            )}
            {innerFromScore.length === 0 && (
              <div className="mt-1 text-[10px] text-gray-500">
                {t('chorale_inner_none', { voce: t(innerVoice === 2 ? 'chorale_inner_alto' : 'chorale_inner_tenor') })}
              </div>
            )}
          </div>

          {/* CHI SCEGLIE L'ARMONIA. Il riquadro dei gradi nasce già pieno e ha la
              precedenza su tutto: senza dirlo, una melodia spuntata non veniva letta e
              l'utente vedeva «il risultato non cambia mai». E dopo ogni generazione il
              riquadro viene riempito col risultato, il che congela le generazioni
              successive. Ora si vede chi decide, e quando il riquadro sta zittendo una
              voce lo si dice. */}
          {(() => {
            const daTesto = progressionText.trim().length > 0;
            const vociDate = (useMelody && sopranoFromScore.length > 0)
              || (useBass && bassFromScore.length > 0)
              || (useInner && innerFromScore.length > 0);
            const chi = daTesto ? t('chorale_who_text')
              : (useInner && innerFromScore.length > 0)
                ? t('chorale_who_inner', { voce: t(innerVoice === 2 ? 'chorale_inner_alto' : 'chorale_inner_tenor') })
              : (useMelody && sopranoFromScore.length > 0)
                ? ((useBass && bassFromScore.length > 0) ? t('chorale_who_both') : t('chorale_who_soprano'))
              : (useBass && bassFromScore.length > 0) ? t('chorale_who_bass')
              : t('chorale_who_none');
            return (
              <div className="mb-3">
                <div className="text-[11px] text-slate-300">
                  {t('chorale_who_decides', { chi })}
                </div>
                {daTesto && vociDate && (
                  <div className="mt-1 p-2 rounded border border-amber-600 bg-amber-950/40 text-[10px] text-amber-200">
                    {t('chorale_text_wins')}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Parsed preview */}
          {parsedPreview.length > 0 && (
            <div className="mb-4 p-2 bg-slate-800 rounded-md border border-slate-700">
              <label className="block text-xs text-gray-400 mb-1">{t('chorale_preview_label', { count: parsedPreview.length })}</label>
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
              ✓ {t('chorale_generated_summary', { notes: generatedNotes.length, chords: generatedNotes.length / 4 })}
              {violations.length === 0 && t('chorale_no_violations')}
            </div>
          )}

          {/* Voice enable toggles — shown after first generation */}
          {generatedNotes && generatedNotes.length > 0 && (
            <div className="flex items-center gap-3 p-2 bg-slate-800 rounded border border-slate-700">
              <span className="text-[10px] text-gray-400 mr-1">{t('chorale_generate_voices')}</span>
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
                    ? t('chorale_soprano_locked')
                    : enabledVoices.has(v)
                      ? t('chorale_voice_enabled', { label })
                      : t('chorale_voice_disabled', { label })}
                >
                  {enabledVoices.has(v) ? '✓' : '✗'} {label}
                </button>
              ))}
              {enabledVoices.size < 4 && (
                <span className="text-[9px] text-amber-300 ml-1">
                  {t('chorale_regen_hint')}
                </span>
              )}
            </div>
          )}

          {/* DUE COMANDI CHE SEMBRANO LA STESSA COSA, e non lo sono. Questi tasti agiscono
              quando si APPLICA: conservano la voce, ma l'armonia è già stata scelta
              ignorandola. La spunta «armonizza da una voce interna» agisce quando si GENERA.
              Misurato sui 73 brani del banco, la differenza è tutta qui: senza il vincolo il
              risultato ha 337 incroci e 859 accordi incompleti, con il vincolo 6 e 198.
              Chi spegne una voce che ha note sul rigo va avvertito, o si ritrova la seconda
              riga di quei numeri credendo di avere la prima. */}
          {generatedNotes && generatedNotes.length > 0 && (
            <div>
              {(() => {
                const dateOra = new Set<number>([
                  ...(useMelody && sopranoFromScore.length > 0 ? [1] : []),
                  ...(useBass && bassFromScore.length > 0 ? [4] : []),
                  ...(useInner && innerFromScore.length > 0 ? [innerVoice] : []),
                ]);
                const conNote = (v: number) => (existingNotes ?? [])
                  .some(n => n && !(n as any).isRest && Number((n as any).voice ?? 1) === v);
                const trascurate = [1, 2, 3, 4]
                  .filter(v => !enabledVoices.has(v) && !dateOra.has(v) && conNote(v));
                if (trascurate.length === 0) return null;
                const nomi = trascurate
                  .map(v => t(({ 1: 'voice_soprano', 2: 'voice_alto', 3: 'voice_tenor', 4: 'voice_bass' } as const)[v as 1]))
                  .join(', ');
                return (
                  <div className="mt-1 p-2 rounded border border-amber-600 bg-amber-950/40 text-[10px] text-amber-200">
                    {t('chorale_voice_off_unused', { voce: nomi })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Inserisci dalla misura (1-indexed for UI, 0-indexed internally) */}
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-gray-300">{t('chorale_insert_from_measure')}</label>
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
                {t('chorale_adapt_style')}
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
                {t('chorale_learn_file')}
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
                  title={t('rp_clear_profile')}
                >
                  {t('chorale_reset')}
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
                title={t('rp_load_profile')}
              >
                {t('chorale_load_repertoire', { count: (defaultStyleProfileData as any).filesAnalyzed })}
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
              disabled={progressionText.trim().length === 0 && !((useMelody && sopranoFromScore.length > 0) || (useBass && bassFromScore.length > 0) || (useInner && innerFromScore.length > 0))}
            >
              {t('chorale_generate_btn')}
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-2 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold
                disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!generatedNotes || generatedNotes.length === 0}
            >
              {t('chorale_apply_btn')}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md bg-slate-600 hover:bg-slate-500 text-white font-semibold"
            >
              {t('chorale_cancel_btn')}
            </button>
          </div>
    </DraggablePanel>
  );
};

export default RomanProgressionEditor;
