/**
 * Export MusicXML — serializes StaffNote[] + metadata to MusicXML 4.0 partwise format.
 *
 * Produces a valid MusicXML file compatible with MuseScore, Finale, Sibelius, etc.
 */
import type { StaffNote, KeySignature, TimeSignature, TimeSignatureChange, NoteDuration } from '../types';
import { TICKS_PER_QUARTER } from '../constants';

// ── Types ──────────────────────────────────────────────────────────────────

/** Etichetta d'analisi armonica da serializzare, agganciata a un onset (beat). */
export interface HarmonyExportLabel {
  /** Indice di misura (0-based) a cui appartiene l'etichetta. */
  measureIndex: number;
  /** Tick assoluto dell'onset (coincide con lo startTick delle note a quel beat). */
  tick: number;
  /** Testo del numero romano già nella forma visualizzata (sequenziato/override inclusi). */
  roman?: string;
  /** Cifre del basso figurato, es. ["6","4"]. */
  figures?: string[];
  /** Token compatto già pronto (V7, IV43, Bb65…) per l'export nativo .mscx accessibile.
   *  Usato SOLO da exportMuseScoreMscx come testo del <FiguredBass>. */
  token?: string;
}

export interface ExportMusicXMLOptions {
  notes: StaffNote[];
  title?: string;
  keySignature: KeySignature;
  timeSignature: TimeSignature;
  timeSignatureChanges?: TimeSignatureChange[];
  isMinorMode?: boolean;
  keySignatureRoot?: string;
  totalMeasures?: number;
  /** Analisi armonica opzionale: serializzata come <direction>(romano) + <figured-bass>(cifre).
   *  Non modifica la serializzazione delle note. */
  harmonyLabels?: HarmonyExportLabel[];
}

// ── Constants ──────────────────────────────────────────────────────────────

/** MusicXML divisions = ticks per quarter note. We use our internal TICKS_PER_QUARTER. */
const DIVISIONS = TICKS_PER_QUARTER;

/** Map internal duration names → MusicXML <type> element values. */
const DURATION_TYPE_MAP: Record<NoteDuration, string> = {
  'whole': 'whole',
  'half': 'half',
  'quarter': 'quarter',
  'eighth': 'eighth',
  'sixteenth': '16th',
  'thirty-second': '32nd',
  'sixty-fourth': '64th',
};

/** Map internal duration names → duration in ticks (divisions). */
const DURATION_TICKS: Record<NoteDuration, number> = {
  'whole': DIVISIONS * 4,
  'half': DIVISIONS * 2,
  'quarter': DIVISIONS,
  'eighth': DIVISIONS / 2,
  'sixteenth': DIVISIONS / 4,
  'thirty-second': DIVISIONS / 8,
  'sixty-fourth': DIVISIONS / 16,
};

/** Map internal accidental names → MusicXML <accidental> values. */
const ACCIDENTAL_MAP: Record<string, { alter: number; accText: string }> = {
  'sharp': { alter: 1, accText: 'sharp' },
  'flat': { alter: -1, accText: 'flat' },
  'natural': { alter: 0, accText: 'natural' },
  'double-sharp': { alter: 2, accText: 'double-sharp' },
  'double-flat': { alter: -2, accText: 'double-flat' },
};

/** Key signature: fifths value for each tonic. */
const FIFTHS_MAP: Record<string, number> = {
  'Cb': -7, 'Gb': -6, 'Db': -5, 'Ab': -4, 'Eb': -3, 'Bb': -2, 'F': -1,
  'C': 0,
  'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Compute the fifths value for the key signature.
 * Positive = sharps, negative = flats.
 */
function computeFifths(ks: KeySignature, root?: string): number {
  if (root && FIFTHS_MAP[root] != null) return FIFTHS_MAP[root];
  return ks.type === 'sharp' ? ks.count : -ks.count;
}

/**
 * Get the effective accidental for a note, considering explicitAccidental and accidental fields.
 */
function getEffectiveAccidental(note: StaffNote): string | null {
  return (note.explicitAccidental ?? note.accidental ?? null) as string | null;
}

/**
 * Compute duration ticks for a note, accounting for dotted notes.
 */
function getNoteDurationTicks(note: StaffNote): number {
  const dur = note.duration || 'quarter';
  let ticks = note.durationTicks || DURATION_TICKS[dur] || DIVISIONS;
  // If durationTicks is set, use it directly (most reliable)
  if (note.durationTicks && note.durationTicks > 0) return note.durationTicks;
  if (note.isDotted) ticks = Math.round(ticks * 1.5);
  return ticks;
}

// ── Note emitter ───────────────────────────────────────────────────────

function emitNote(
  w: (s: string) => void,
  note: StaffNote,
  voiceNum: number,
  staffNum: number,
  isFirst: boolean,
): void {
  const dur = note.duration || 'quarter';
  const durationTicks = getNoteDurationTicks(note);
  const mxmlType = DURATION_TYPE_MAP[dur] || 'quarter';

  w('      <note>');

  // Chord tag for additional notes at same onset in the SAME voice
  if (!isFirst) {
    w('        <chord/>');
  }

  if (note.isRest) {
    w('        <rest/>');
  } else {
    const step = (note.pitch || 'C').toUpperCase();
    const octave = note.octave ?? 4;
    const acc = getEffectiveAccidental(note);
    const accInfo = acc ? ACCIDENTAL_MAP[acc] : null;

    w('        <pitch>');
    w(`          <step>${step}</step>`);
    if (accInfo && accInfo.alter !== 0) {
      w(`          <alter>${accInfo.alter}</alter>`);
    }
    w(`          <octave>${octave}</octave>`);
    w('        </pitch>');

    if (note.explicitAccidental && ACCIDENTAL_MAP[note.explicitAccidental]) {
      w(`        <accidental>${ACCIDENTAL_MAP[note.explicitAccidental].accText}</accidental>`);
    }
  }

  w(`        <duration>${durationTicks}</duration>`);
  if (note.isTiedToNext || note.isTiedFromPrev) {
    if (note.isTiedFromPrev) w('        <tie type="stop"/>');
    if (note.isTiedToNext) w('        <tie type="start"/>');
  }
  w(`        <voice>${voiceNum}</voice>`);
  w(`        <type>${mxmlType}</type>`);
  if (note.isDotted) {
    w('        <dot/>');
  }
  w(`        <staff>${staffNum}</staff>`);

  if (note.isTiedToNext || note.isTiedFromPrev) {
    w('        <notations>');
    if (note.isTiedFromPrev) w('          <tied type="stop"/>');
    if (note.isTiedToNext) w('          <tied type="start"/>');
    w('        </notations>');
  }

  w('      </note>');
}

// ── Harmony emitters ───────────────────────────────────────────────────────

/** Romano come annotazione testuale (scelta v1: massima leggibilità per screen reader/
 *  Braille; il <numeral> semantico di MusicXML 4.0 è un enhancement successivo). */
function emitHarmonyDirection(w: (s: string) => void, roman: string, staffNum: number): void {
  w('      <direction placement="above">');
  w('        <direction-type>');
  w(`          <words>${escapeXml(roman)}</words>`);
  w('        </direction-type>');
  w(`        <staff>${staffNum}</staff>`);
  w('      </direction>');
}

const FIG_ACC_WORD: Record<string, string> = { '#': 'sharp', '+': 'sharp', 'b': 'flat', '♮': 'natural', 'n': 'natural' };

/** Scompone una cifra tipo "6", "#4", "b6", "5" in prefix/number (accidente + numero). */
function parseFigure(f: string): { prefix?: string; number?: string; raw: string } {
  const s = String(f).trim();
  const m = s.match(/^([#b♮n+]?)(\d+)$/);
  if (m) return { prefix: m[1] ? FIG_ACC_WORD[m[1]] : undefined, number: m[2], raw: s };
  // Cifra non standard (es. "6/5", solo accidente): resa come testo in figure-number.
  return { raw: s };
}

/** Basso figurato col tag dedicato <figured-bass> (ben supportato, storico). */
function emitFiguredBass(w: (s: string) => void, figures: string[]): void {
  const figs = figures.map(f => String(f).trim()).filter(Boolean);
  if (figs.length === 0) return;
  w('      <figured-bass>');
  for (const f of figs) {
    const p = parseFigure(f);
    w('        <figure>');
    if (p.prefix) w(`          <prefix>${p.prefix}</prefix>`);
    w(`          <figure-number>${escapeXml(p.number ?? p.raw)}</figure-number>`);
    w('        </figure>');
  }
  w('      </figured-bass>');
}

// ── Main Export ────────────────────────────────────────────────────────────

export function exportMusicXML(opts: ExportMusicXMLOptions): string {
  const {
    notes,
    title = 'Untitled',
    keySignature,
    timeSignature,
    isMinorMode = false,
    keySignatureRoot,
    harmonyLabels = [],
    timeSignatureChanges = [],
  } = opts;

  // ── Mappa delle battute (CAMBI DI METRO) ───────────────────────────────────
  // Prima l'export assumeva un metro costante: la lunghezza di ogni battuta e
  // l'inizio della battuta m (`m * numerator * DIVISIONS`) erano calcolati sul metro
  // iniziale. Con un cambio di metro, da lì in avanti l'inizio-battuta era sbagliato →
  // le note uscivano in posizioni sbagliate (e il file riletto "girava fuori tempo").
  // Nota: la vecchia formula sbagliava anche i metri con denominatore ≠ 4 (un 6/8 vale
  // 3 semiminime, non 6).
  const meterChanges = timeSignatureChanges
    .filter(c => c && Number.isFinite(c.measureIndex as number) && c.numerator > 0 && c.denominator > 0)
    .map(c => ({ measureIndex: Number(c.measureIndex), numerator: c.numerator, denominator: c.denominator }))
    .sort((a, b) => a.measureIndex - b.measureIndex);
  const tsAtMeasure = (m: number): TimeSignature => {
    let cur: TimeSignature = timeSignature;
    for (const c of meterChanges) {
      if (c.measureIndex <= m) cur = { numerator: c.numerator, denominator: c.denominator };
      else break;
    }
    return cur;
  };
  const measureLenTicks = (m: number): number => {
    const ts = tsAtMeasure(m);
    return Math.round(ts.numerator * (4 / ts.denominator) * DIVISIONS);
  };
  const measureStartCache: number[] = [0];
  const measureStartTicks = (m: number): number => {
    while (measureStartCache.length <= m) {
      const prev = measureStartCache.length - 1;
      measureStartCache.push(measureStartCache[prev] + measureLenTicks(prev));
    }
    return measureStartCache[m];
  };

  // Group notes by measure
  const notesByMeasure = new Map<number, StaffNote[]>();
  for (const n of notes) {
    if (n.isRest && !n.duration) continue;
    const m = n.measureIndex ?? 0;
    if (!notesByMeasure.has(m)) notesByMeasure.set(m, []);
    notesByMeasure.get(m)!.push(n);
  }

  // Armonia per misura → { localTick → {roman, figures} }. localTick calcolato con la
  // STESSA convenzione delle note (tick − m·numerator·DIVISIONS) così coincide con gli onset.
  const harmonyByMeasure = new Map<number, Map<number, { roman?: string; figures?: string[] }>>();
  for (const h of harmonyLabels) {
    const mi = h.measureIndex ?? 0;
    const localTick = h.tick - measureStartTicks(mi);
    if (!harmonyByMeasure.has(mi)) harmonyByMeasure.set(mi, new Map());
    const existing = harmonyByMeasure.get(mi)!.get(localTick) || {};
    harmonyByMeasure.get(mi)!.set(localTick, {
      roman: h.roman ?? existing.roman,
      figures: (h.figures && h.figures.length) ? h.figures : existing.figures,
    });
  }

  const maxMeasure = opts.totalMeasures
    ? opts.totalMeasures - 1
    : Math.max(0, ...notesByMeasure.keys());

  const fifths = computeFifths(keySignature, keySignatureRoot);
  const mode = isMinorMode ? 'minor' : 'major';

  // ── Build XML ──
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"');
  w('  "http://www.musicxml.org/dtds/partwise.dtd">');
  w('<score-partwise version="4.0">');

  // Work title
  w('  <work>');
  w(`    <work-title>${escapeXml(title)}</work-title>`);
  w('  </work>');
  w('  <identification>');
  w('    <encoding>');
  w('      <software>Harmony Tutor</software>');
  w(`      <encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>`);
  w('    </encoding>');
  w('  </identification>');

  // Part list — two staves (treble + bass) in one part
  w('  <part-list>');
  w('    <score-part id="P1">');
  w('      <part-name>Piano</part-name>');
  w('    </score-part>');
  w('  </part-list>');

  w('  <part id="P1">');

  for (let m = 0; m <= maxMeasure; m++) {
    w(`    <measure number="${m + 1}">`);

    // Attributes on first measure (or when time sig changes)
    if (m === 0) {
      w('      <attributes>');
      w(`        <divisions>${DIVISIONS}</divisions>`);
      w('        <key>');
      w(`          <fifths>${fifths}</fifths>`);
      w(`          <mode>${mode}</mode>`);
      w('        </key>');
      w('        <time>');
      w(`          <beats>${timeSignature.numerator}</beats>`);
      w(`          <beat-type>${timeSignature.denominator}</beat-type>`);
      w('        </time>');
      w('        <staves>2</staves>');
      w('        <clef number="1">');
      w('          <sign>G</sign>');
      w('          <line>2</line>');
      w('        </clef>');
      w('        <clef number="2">');
      w('          <sign>F</sign>');
      w('          <line>4</line>');
      w('        </clef>');
      w('      </attributes>');
    } else if (measureLenTicks(m) !== measureLenTicks(m - 1)
      || tsAtMeasure(m).numerator !== tsAtMeasure(m - 1).numerator
      || tsAtMeasure(m).denominator !== tsAtMeasure(m - 1).denominator) {
      // CAMBIO DI METRO: va dichiarato nella battuta in cui entra in vigore, altrimenti
      // il file resta nel metro iniziale e chi lo rilegge divide le battute sbagliate.
      const ts = tsAtMeasure(m);
      w('      <attributes>');
      w('        <time>');
      w(`          <beats>${ts.numerator}</beats>`);
      w(`          <beat-type>${ts.denominator}</beat-type>`);
      w('        </time>');
      w('      </attributes>');
    }

    const measureNotes = notesByMeasure.get(m) || [];
    const measureTotalTicks = measureLenTicks(m);

    // Armonia di questa misura, agganciata per localTick (onset). Ogni etichetta emessa
    // UNA sola volta: il romano sul rigo acuto, le cifre sul rigo grave.
    const hMap = harmonyByMeasure.get(m);
    const emittedRoman = new Set<number>();
    const emittedFig = new Set<number>();

    // Separate notes into staff 1 (treble: voices 1,2) and staff 2 (bass: voices 3,4)
    const staffNotes: [StaffNote[], StaffNote[]] = [[], []];
    for (const n of measureNotes) {
      const v = n.voice ?? 1;
      const clef = n.clefOverride || n.clef || (v <= 2 ? 'treble' : 'bass');
      const staffIdx = clef === 'bass' ? 1 : 0;
      staffNotes[staffIdx].push(n);
    }

    let needsBackup = false; // track whether we need <backup> before the next voice stream

    // Write each staff, voice by voice
    for (let staffIdx = 0; staffIdx < 2; staffIdx++) {
      const sNotes = staffNotes[staffIdx];
      const staffNum = staffIdx + 1;
      if (sNotes.length === 0 && staffIdx === 1) continue;

      // Group by voice
      const voiceGroups = new Map<number, StaffNote[]>();
      for (const n of sNotes) {
        const v = n.voice ?? (staffIdx === 0 ? 1 : 3);
        if (!voiceGroups.has(v)) voiceGroups.set(v, []);
        voiceGroups.get(v)!.push(n);
      }

      // Sort voices
      const sortedVoices = [...voiceGroups.keys()].sort((a, b) => a - b);

      for (const voiceNum of sortedVoices) {
        const voiceNotes = voiceGroups.get(voiceNum)!;

        // Sort notes by onset tick
        voiceNotes.sort((a, b) => {
          const ta = a.startTick ?? ((a.beat ?? 1) - 1) * DIVISIONS;
          const tb = b.startTick ?? ((b.beat ?? 1) - 1) * DIVISIONS;
          return ta - tb;
        });

        // <backup> to the start of the measure before each new voice stream
        if (needsBackup) {
          w('      <backup>');
          w(`        <duration>${measureTotalTicks}</duration>`);
          w('      </backup>');
        }

        // Group by onset tick within this voice (for real chords: same voice, same tick)
        const onsets = new Map<number, StaffNote[]>();
        for (const n of voiceNotes) {
          const tick = n.startTick ?? ((n.beat ?? 1) - 1) * DIVISIONS;
          const localTick = tick - measureStartTicks(m);
          if (!onsets.has(localTick)) onsets.set(localTick, []);
          onsets.get(localTick)!.push(n);
        }

        const sortedOnsets = [...onsets.entries()].sort((a, b) => a[0] - b[0]);

        let currentTick = 0;
        for (const [onsetTick, chordNotes] of sortedOnsets) {
          // Forward rest if there's a gap
          if (onsetTick > currentTick) {
            const gap = onsetTick - currentTick;
            w('      <forward>');
            w(`        <duration>${gap}</duration>`);
            w(`        <voice>${voiceNum}</voice>`);
            w(`        <staff>${staffNum}</staff>`);
            w('      </forward>');
            currentTick = onsetTick;
          }

          // Armonia PRIMA della nota a questo onset (non consuma durata).
          if (hMap) {
            if (staffIdx === 0 && !emittedRoman.has(onsetTick)) {
              const roman = hMap.get(onsetTick)?.roman;
              if (roman) { emitHarmonyDirection(w, roman, staffNum); emittedRoman.add(onsetTick); }
            }
            if (staffIdx === 1 && !emittedFig.has(onsetTick)) {
              const figures = hMap.get(onsetTick)?.figures;
              if (figures && figures.length) { emitFiguredBass(w, figures); emittedFig.add(onsetTick); }
            }
          }

          let isFirstInChord = true;
          for (const note of chordNotes) {
            emitNote(w, note, voiceNum, staffNum, isFirstInChord);
            isFirstInChord = false;
          }

          // Advance current tick (use first note's duration)
          currentTick = onsetTick + getNoteDurationTicks(chordNotes[0]);
        }

        needsBackup = true;
      }

      // If staff 1 had no notes but we still need to emit staff 2
      if (sNotes.length === 0) {
        needsBackup = true;
      }
    }

    // Barline on last measure
    if (m === maxMeasure) {
      w('      <barline location="right">');
      w('        <bar-style>light-heavy</bar-style>');
      w('      </barline>');
    }

    w('    </measure>');
  }

  w('  </part>');
  w('</score-partwise>');

  return lines.join('\n');
}
