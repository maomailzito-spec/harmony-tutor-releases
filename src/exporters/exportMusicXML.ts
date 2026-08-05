/**
 * Export MusicXML — serializes StaffNote[] + metadata to MusicXML 4.0 partwise format.
 *
 * Produces a valid MusicXML file compatible with MuseScore, Finale, Sibelius, etc.
 */
import type { StaffNote, KeySignature, TimeSignature, TimeSignatureChange, NoteDuration, ClefType } from '../types';
import { TICKS_PER_QUARTER } from '../constants';
import { DYNAMIC_VELOCITY, type DynamicMark } from '../utils/dynamics';
import type { ArticulationMark } from '../types';

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
  /** SEGNI DI DINAMICA: <dynamics> per i livelli e gli accenti, <wedge> per le forcelle.
   *  In questo programma valgono per tutto il brano (non appartengono a una voce), quindi
   *  ogni <part> se li porta: chi apre il file li trova su ogni rigo, come in una
   *  partitura corale dove il *f* si scrive una volta e riguarda l'insieme. */
  dynamics?: DynamicMark[];
  /** Nome della parte del coro nella <part-list> (default "Piano"). */
  satbName?: string;
  /** TRACCE DI ACCOMPAGNAMENTO: ognuna diventa una <part> a sé. Senza, un brano scritto
   *  su una traccia veniva esportato in un file vuoto (usciva solo il coro). */
  accompanimentTracks?: Array<{
    name?: string;
    notes: StaffNote[];
    staffMode?: 'grandstaff' | 'treble_only';
    clef?: ClefType;
    isDrum?: boolean;
  }>;
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

/** Articolazioni: nomi nostri → elementi MusicXML (dentro <notations><articulations>). */
const ARTICULATION_XML: Record<ArticulationMark, string> = {
  staccato: 'staccato',
  staccatissimo: 'staccatissimo',
  accent: 'accent',
  marcato: 'strong-accent',
  tenuto: 'tenuto',
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
  /** Percussioni: MusicXML vuole <unpitched> (altezza non intonata). La posizione sul
   *  rigo è convenzionale — il valore ritmico è quello che conta. */
  unpitched?: boolean,
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
  } else if (unpitched) {
    w('        <unpitched>');
    w(`          <display-step>${(note.pitch || 'B').toUpperCase()}</display-step>`);
    w(`          <display-octave>${note.octave ?? 4}</display-octave>`);
    w('        </unpitched>');
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

  // <notations> è UNO solo per nota: legature e articolazioni vanno nello stesso.
  const artNota = (Array.isArray((note as any).articulations) ? (note as any).articulations : [])
    .filter((a: string) => !!ARTICULATION_XML[a as ArticulationMark]);
  if (note.isTiedToNext || note.isTiedFromPrev || artNota.length > 0) {
    w('        <notations>');
    if (note.isTiedFromPrev) w('          <tied type="stop"/>');
    if (note.isTiedToNext) w('          <tied type="start"/>');
    if (artNota.length > 0) {
      w('          <articulations>');
      for (const a of artNota) w(`            <${ARTICULATION_XML[a as ArticulationMark]}/>`);
      w('          </articulations>');
    }
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

// ── Dinamiche ──────────────────────────────────────────────────────────────

/** Una direzione già pronta, con il punto della battuta in cui va infilata.
 *  `ordine` conta solo a parità di tick: prima si chiude la forcella che finisce lì,
 *  poi si scrive il segno di quel punto, poi si apre la forcella che parte di lì. */
type DynDirection = { localTick: number; ordine: number; lines: string[] };

/** `<sound dynamics>` vuole una PERCENTUALE, dove 100 = velocity 90 (lo dice la
 *  specifica MusicXML). Senza, chi riapre il file vede il segno ma lo suona a caso. */
const soundDynamicsPercent = (velocity: number): number =>
    Math.max(1, Math.round((velocity / 90) * 100));

function buildDynDirection(corpo: string[], velocity?: number): string[] {
    const lines = [
        '      <direction placement="below">',
        '        <direction-type>',
        ...corpo,
        '        </direction-type>',
        '        <staff>1</staff>',
    ];
    if (velocity != null) lines.push(`        <sound dynamics="${soundDynamicsPercent(velocity)}"/>`);
    lines.push('      </direction>');
    return lines;
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

  // ── PARTI ──────────────────────────────────────────────────────────────────
  // Prima l'export scriveva UNA sola parte, quella del coro: un brano scritto su una
  // traccia di accompagnamento usciva in un file vuoto. Ora ogni traccia diventa una
  // <part> a sé, col suo nome, i suoi righi e la sua chiave.
  type PartCfg = {
    id: string;
    name: string;
    notes: StaffNote[];
    staves: 1 | 2;
    clefs: Array<{ number: number; sign: string; line: number }>;
    /** Su quale rigo della parte va la nota (0 = primo, 1 = secondo). */
    staffOf: (n: StaffNote) => 0 | 1;
    /** Solo il coro porta l'analisi (romani + basso figurato). */
    withHarmony: boolean;
    /** Percussioni: altezze non intonate (<unpitched>), la posizione è convenzionale. */
    unpitched?: boolean;
  };

  const CLEF_XML: Record<string, { sign: string; line: number }> = {
    treble: { sign: 'G', line: 2 },
    bass: { sign: 'F', line: 4 },
    alto: { sign: 'C', line: 3 },
    tenor: { sign: 'C', line: 4 },
    soprano: { sign: 'C', line: 1 },
    percussion: { sign: 'percussion', line: 3 },
  };

  const parts: PartCfg[] = [{
    id: 'P1',
    name: (opts.satbName || '').trim() || 'Piano',
    notes,
    staves: 2,
    clefs: [{ number: 1, sign: 'G', line: 2 }, { number: 2, sign: 'F', line: 4 }],
    // Coro: voci 1-2 sul rigo acuto, 3-4 sul grave (o la chiave della nota, se presente).
    staffOf: (n) => (((n.clefOverride || n.clef || ((n.voice ?? 1) <= 2 ? 'treble' : 'bass')) === 'bass') ? 1 : 0),
    withHarmony: true,
  }];

  (opts.accompanimentTracks || []).forEach((t, i) => {
    const tNotes = (t?.notes || []).filter(Boolean);
    if (tNotes.length === 0) return;
    const isDrum = !!t.isDrum;
    const grand = !isDrum && ((t.staffMode ?? 'grandstaff') === 'grandstaff');
    const single = CLEF_XML[String(isDrum ? 'percussion' : (t.clef || 'treble'))] || CLEF_XML.treble;
    parts.push({
      id: `P${parts.length + 1}`,
      name: (t.name || '').trim() || `Traccia ${i + 1}`,
      notes: tNotes,
      staves: grand ? 2 : 1,
      clefs: grand
        ? [{ number: 1, sign: 'G', line: 2 }, { number: 2, sign: 'F', line: 4 }]
        : [{ number: 1, sign: single.sign, line: single.line }],
      staffOf: grand ? ((n) => (n.clef === 'bass' ? 1 : 0)) : (() => 0),
      withHarmony: false,
      unpitched: isDrum,
    });
  });

  // Una parte VUOTA non va scritta (comparirebbe un rigo vuoto in chi apre il file):
  // si tiene solo se non c'è nient'altro, perché un MusicXML senza parti non è valido.
  // Gli id vengono rinumerati dopo lo scarto, così restano coerenti con la <part-list>.
  const nonEmpty = parts.filter(p => p.notes.some(n => !n.isRest));
  const finalParts = (nonEmpty.length > 0 ? nonEmpty : parts.slice(0, 1))
    .map((p, i) => ({ ...p, id: `P${i + 1}` }));

  // Armonia per misura → { localTick → {roman, figures} }. localTick calcolato con la
  // STESSA convenzione delle note (tick − inizio battuta) così coincide con gli onset.
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

  // Le parti di un file MusicXML devono avere le STESSE battute: l'estensione è quella
  // del materiale più lungo, coro o traccia che sia.
  const measuresOf = (ns: StaffNote[]): number =>
    ns.reduce((mx, n) => Math.max(mx, Number.isFinite(n.measureIndex as number) ? Number(n.measureIndex) : 0), 0);
  const maxMeasure = opts.totalMeasures
    ? opts.totalMeasures - 1
    : finalParts.reduce((mx, p) => Math.max(mx, measuresOf(p.notes)), 0);

  // ── DINAMICHE per battuta ──────────────────────────────────────────────────
  // I segni sono ancorati a un punto della linea del tempo (absBeat, in semiminime):
  // qui diventano tick, poi battuta + posizione dentro la battuta, passando dalla
  // stessa mappa delle note così un cambio di metro non li sposta.
  const measureOfTick = (tick: number): number => {
    let m = 0;
    while (m < maxMeasure && measureStartTicks(m + 1) <= tick + 1) m++;
    return m;
  };
  const dynByMeasure = new Map<number, DynDirection[]>();
  const pushDyn = (absBeat: number, ordine: number, corpo: string[], velocity?: number): void => {
    if (!Number.isFinite(absBeat)) return;
    const tick = Math.round(Math.max(0, absBeat) * DIVISIONS);
    const m = measureOfTick(tick);
    const localTick = Math.max(0, tick - measureStartTicks(m));
    if (!dynByMeasure.has(m)) dynByMeasure.set(m, []);
    dynByMeasure.get(m)!.push({ localTick, ordine, lines: buildDynDirection(corpo, velocity) });
  };
  for (const d of (opts.dynamics || [])) {
    if (!d) continue;
    if (d.kind === 'level') {
      pushDyn(d.absBeat, 1, [`          <dynamics><${d.level}/></dynamics>`], DYNAMIC_VELOCITY[d.level]);
    } else if (d.kind === 'accent') {
      pushDyn(d.absBeat, 1, [`          <dynamics><${d.label}/></dynamics>`]);
    } else if (d.kind === 'fp') {
      pushDyn(d.absBeat, 1, ['          <dynamics><fp/></dynamics>']);
    } else if (d.kind === 'hairpin') {
      const a = Math.min(d.fromAbsBeat, d.toAbsBeat);
      const b = Math.max(d.fromAbsBeat, d.toAbsBeat);
      pushDyn(a, 2, [`          <wedge type="${d.direction === 'cresc' ? 'crescendo' : 'diminuendo'}"/>`]);
      pushDyn(b, 0, ['          <wedge type="stop"/>']);
    }
  }
  for (const list of dynByMeasure.values()) {
    list.sort((x, y) => (x.localTick - y.localTick) || (x.ordine - y.ordine));
  }

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

  w('  <part-list>');
  for (const p of finalParts) {
    w(`    <score-part id="${p.id}">`);
    w(`      <part-name>${escapeXml(p.name)}</part-name>`);
    w('    </score-part>');
  }
  w('  </part-list>');

  for (const part of finalParts) {
    // Note della parte raggruppate per misura.
    const notesByMeasure = new Map<number, StaffNote[]>();
    for (const n of part.notes) {
      if (n.isRest && !n.duration) continue;
      const m = n.measureIndex ?? 0;
      if (!notesByMeasure.has(m)) notesByMeasure.set(m, []);
      notesByMeasure.get(m)!.push(n);
    }

    w(`  <part id="${part.id}">`);

    for (let m = 0; m <= maxMeasure; m++) {
      w(`    <measure number="${m + 1}">`);

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
        if (part.staves > 1) w(`        <staves>${part.staves}</staves>`);
        for (const c of part.clefs) {
          w(`        <clef number="${c.number}">`);
          w(`          <sign>${c.sign}</sign>`);
          w(`          <line>${c.line}</line>`);
          w('        </clef>');
        }
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

      // I segni di dinamica vanno scritti PRIMA delle note, ciascuno al suo punto: si
      // avanza con <forward> fino al tick del segno e alla fine si riempie il resto
      // della battuta, così il flusso delle note riparte da capo col solito <backup>.
      // Corsia dedicata e non agganciata agli attacchi perché la coda di una forcella
      // cade spesso dove nessuna voce attacca, e lì non avrebbe trovato un posto.
      const dynHere = dynByMeasure.get(m) || [];
      let dynStreamWritten = false;
      if (dynHere.length > 0) {
        let cur = 0;
        for (const d of dynHere) {
          const t = Math.max(0, Math.min(measureTotalTicks, d.localTick));
          if (t > cur) {
            w('      <forward>');
            w(`        <duration>${t - cur}</duration>`);
            w('      </forward>');
            cur = t;
          }
          for (const line of d.lines) w(line);
        }
        // Se i segni stavano tutti sul primo movimento non ci si è mossi: inutile
        // percorrere la battuta e riavvolgerla a vuoto (un <forward> seguito da un
        // <backup> della stessa misura è un giro a vuoto che certi programmi leggono
        // come una voce in più).
        if (cur > 0) {
          if (measureTotalTicks > cur) {
            w('      <forward>');
            w(`        <duration>${measureTotalTicks - cur}</duration>`);
            w('      </forward>');
          }
          dynStreamWritten = true;
        }
      }

      // Armonia di questa misura, agganciata per localTick (onset). Ogni etichetta emessa
      // UNA sola volta: il romano sul rigo acuto, le cifre sul rigo grave.
      const hMap = part.withHarmony ? harmonyByMeasure.get(m) : undefined;
      const emittedRoman = new Set<number>();
      const emittedFig = new Set<number>();

      // Note divise per rigo della parte.
      const staffNotes: StaffNote[][] = part.staves === 2 ? [[], []] : [[]];
      for (const n of measureNotes) {
        const idx = part.staves === 2 ? part.staffOf(n) : 0;
        staffNotes[idx].push(n);
      }

      // Serve un <backup> prima del prossimo flusso di voce? Sì anche se la corsia delle
      // dinamiche ha già percorso la battuta per intero.
      let needsBackup = dynStreamWritten;

      for (let staffIdx = 0; staffIdx < staffNotes.length; staffIdx++) {
        const sNotes = staffNotes[staffIdx];
        const staffNum = staffIdx + 1;
        if (sNotes.length === 0 && staffIdx > 0) continue;

        const voiceGroups = new Map<number, StaffNote[]>();
        for (const n of sNotes) {
          const v = n.voice ?? (staffIdx === 0 ? 1 : 3);
          if (!voiceGroups.has(v)) voiceGroups.set(v, []);
          voiceGroups.get(v)!.push(n);
        }

        const sortedVoices = [...voiceGroups.keys()].sort((a, b) => a - b);

        for (const voiceNum of sortedVoices) {
          const voiceNotes = voiceGroups.get(voiceNum)!;

          voiceNotes.sort((a, b) => {
            const ta = a.startTick ?? ((a.beat ?? 1) - 1) * DIVISIONS;
            const tb = b.startTick ?? ((b.beat ?? 1) - 1) * DIVISIONS;
            return ta - tb;
          });

          if (needsBackup) {
            w('      <backup>');
            w(`        <duration>${measureTotalTicks}</duration>`);
            w('      </backup>');
          }

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
            if (onsetTick > currentTick) {
              const gap = onsetTick - currentTick;
              w('      <forward>');
              w(`        <duration>${gap}</duration>`);
              w(`        <voice>${voiceNum}</voice>`);
              w(`        <staff>${staffNum}</staff>`);
              w('      </forward>');
              currentTick = onsetTick;
            }

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
              emitNote(w, note, voiceNum, staffNum, isFirstInChord, part.unpitched);
              isFirstInChord = false;
            }

            currentTick = onsetTick + getNoteDurationTicks(chordNotes[0]);
          }

          needsBackup = true;
        }

        if (sNotes.length === 0) needsBackup = true;
      }

      if (m === maxMeasure) {
        w('      <barline location="right">');
        w('        <bar-style>light-heavy</bar-style>');
        w('      </barline>');
      }

      w('    </measure>');
    }

    w('  </part>');
  }

  w('</score-partwise>');

  return lines.join('\n');
}
