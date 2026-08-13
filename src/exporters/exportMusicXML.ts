/**
 * Export MusicXML — serializes StaffNote[] + metadata to MusicXML 4.0 partwise format.
 *
 * Produces a valid MusicXML file compatible with MuseScore, Finale, Sibelius, etc.
 */
import type { StaffNote, KeySignature, TimeSignature, TimeSignatureChange, NoteDuration, ClefType } from '../types';
import { TICKS_PER_QUARTER } from '../constants';
import { DYNAMIC_VELOCITY, type DynamicMark } from '../utils/dynamics';
import type { ArticulationMark, Slur, OctaveShift, KeySignatureChange, TempoMark, MeasureLength } from '../types';
import { measureLengthMap, beatsOfMeasure } from '../utils/measureLengths';
import { normalizeTempoMarks, tempoMarkQuarterBpm, tempoMarkXmlBeatUnit } from '../utils/tempoMarks';
import { parseChordSymbol } from '../utils/chordSymbol';

// ── Types ──────────────────────────────────────────────────────────────────

/** Etichetta d'analisi armonica da serializzare, agganciata a un onset (beat). */
export interface HarmonyExportLabel {
  /** SIGLA dell'accordo (`Cmaj7`, `Gm(add9)/A`). Esce come `<harmony>` — l'elemento
   *  vero del formato, non testo: chi apre il file la vede come un accordo, la
   *  traspone, la modifica. Prima le sigle non uscivano affatto. */
  symbol?: string;
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
  /** LEGATURE DI PORTAMENTO: `<slur type="start">` sulla prima nota e `type="stop"`
   *  sull'ultima, con lo stesso `number` — è così che si riconoscono i due capi. */
  slurs?: Slur[];
  /** CAMBI D'ARMATURA a metà brano: `<key>` dichiarato nella misura in cui entrano in
   *  vigore, come si fa per il metro. Senza, un brano che modula usciva tutto
   *  nell'armatura d'inizio e chi lo riapre lo vede pieno di alterazioni scritte. */
  keySignatureChanges?: KeySignatureChange[];
  /** SEGNI D'OTTAVA (8va/8vb).
   *
   *  ATTENZIONE alla convenzione del formato, che è l'opposto di come si dice a parole:
   *  `type` dichiara di quanto è stato spostato lo SCRITTO rispetto a quello che suona.
   *  Un 8va — scritto un'ottava sotto, suonato sopra — è quindi `type="down"`.
   *  Vanno solo nella parte che contiene le note a cui sono agganciati: un 8va sul coro
   *  non riguarda l'organo. */
  octaveShifts?: OctaveShift[];
  /** SEGNI DI DINAMICA: <dynamics> per i livelli e gli accenti, <wedge> per le forcelle.
   *  In questo programma valgono per tutto il brano (non appartengono a una voce), quindi
   *  ogni <part> se li porta: chi apre il file li trova su ogni rigo, come in una
   *  partitura corale dove il *f* si scrive una volta e riguarda l'insieme. */
  dynamics?: DynamicMark[];
  /** SEGNI DI METRONOMO a metà brano («♩ = 60»): `<direction>` con `<metronome>` più
   *  `<sound tempo>` per chi il file lo SUONA. L'unità esce com'è scritta — un
   *  «𝅗𝅥 = 70» ristampato «♩ = 140» sarebbe la stessa velocità ma un'altra indicazione,
   *  e chi riapre il file non ritroverebbe la sua partitura. Come le dinamiche, valgono
   *  per tutto il brano: ogni parte se li porta. */
  tempoMarks?: TempoMark[];
  /** DURATA REALE delle battute che non coincidono col metro. Senza, l'export
   *  ricostruisce una griglia diversa da quella del progetto e infila pause dove il
   *  conto non torna. */
  measureLengths?: MeasureLength[];
  /** ANDAMENTO d'inizio del brano, in semiminime al minuto. Serve all'export .mscx,
   *  che senza scriveva niente e lasciava a MuseScore il suo 120 di default. */
  bpm?: number;
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
    /** Rigo TRASPOSITORE (−1 = chiave con l'8 sotto, il tenore dei corali). Le note sono
     *  salvate all'altezza LETTA; nel file `<pitch>` è l'altezza SUONATA, quindi va
     *  spostata — e la chiave lo dichiara con `<clef-octave-change>`. */
    octaveTranspose?: number;
    /** Strumento General MIDI della traccia (0-127). */
    instrumentId?: number;
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

/** Nome dello strumento per i programmi GM che il programma usa davvero. Serve solo a
 *  dire a chi legge «questo è questo», così non tira a indovinare dal nome della parte. */
const GM_INSTRUMENT_NAME: Record<number, string> = {
  0: 'Piano', 6: 'Harpsichord', 19: 'Church Organ', 24: 'Classical Guitar',
  32: 'Acoustic Bass', 40: 'Violin', 41: 'Viola', 42: 'Cello', 48: 'Strings',
  52: 'Choir Aahs', 56: 'Trumpet', 71: 'Clarinet', 73: 'Flute',
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
  /** Numeri delle legature che COMINCIANO e che FINISCONO su questa nota. */
  capiLegatura?: { start: number[]; stop: number[] },
  /** Ottave da aggiungere all'altezza scritta per ottenere quella che SUONA (segni 8va).
   *  Nel MusicXML `<pitch>` è l'altezza SUONATA: è `<octave-shift>` a dire di quanto va
   *  DISEGNATA più in basso. Verificato in MuseScore: esportando l'altezza scritta, le
   *  note comparivano un'ottava sotto l'originale. */
  ottaveDaSommare?: number,
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
    const octave = (note.octave ?? 4) + (ottaveDaSommare ?? 0);
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
  const slurStart = capiLegatura?.start ?? [];
  const slurStop = capiLegatura?.stop ?? [];
  if (note.isTiedToNext || note.isTiedFromPrev || artNota.length > 0 || slurStart.length > 0 || slurStop.length > 0) {
    w('        <notations>');
    if (note.isTiedFromPrev) w('          <tied type="stop"/>');
    if (note.isTiedToNext) w('          <tied type="start"/>');
    // Prima le chiusure, poi le aperture: è l'ordine in cui si leggono.
    for (const num of slurStop) w(`          <slur type="stop" number="${num}"/>`);
    for (const num of slurStart) w(`          <slur type="start" number="${num}"/>`);
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
/**
 * `<harmony>` — la sigla come accordo, non come testo.
 *
 * `kind` porta anche l'attributo `text`: è la grafia della QUALITÀ come l'ha scritta
 * l'utente (`m(add9)`), e chi apre stampa quella. Senza, la sigla verrebbe ristampata
 * secondo le convenzioni del programma che legge — cioè non come l'aveva scritta chi
 * l'ha scritta. Attenzione: lì va SOLO la qualità, non la sigla intera: fondamentale e
 * basso li stampa il programma da `<root>` e `<bass>`, e ripeterli darebbe «GGm…/A/A».
 * Le sigle che non si riescono a classificare escono come `other` col loro testo:
 * meglio un accordo dichiarato «altro» ma scritto giusto, che una sigla persa.
 */
function emitChordSymbol(w: (s: string) => void, symbol: string): void {
  const p = parseChordSymbol(symbol);
  if (!p) return;
  w('      <harmony>');
  w('        <root>');
  w(`          <root-step>${p.rootStep}</root-step>`);
  if (p.rootAlter) w(`          <root-alter>${p.rootAlter}</root-alter>`);
  w('        </root>');
  w(`        <kind text="${escapeXml(p.quality)}">${p.kind}</kind>`);
  if (p.bassStep) {
    w('        <bass>');
    w(`          <bass-step>${p.bassStep}</bass-step>`);
    if (p.bassAlter) w(`          <bass-alter>${p.bassAlter}</bass-alter>`);
    w('        </bass>');
  }
  w('      </harmony>');
}

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
  // BATTUTE IRREGOLARI anche qui. Questa è la griglia dell'EXPORT, e per un po' è
  // stata l'ultima a contare tutte le battute uguali al metro: le note delle battute
  // dopo una da cinque movimenti risultavano un movimento in ritardo rispetto
  // all'inizio calcolato, e l'esportatore riempiva il buco con una PAUSA DI
  // SEMIMINIMA sul primo movimento — in ogni battuta, da lì alla fine. Suonava giusto
  // (gli attacchi erano al loro posto) ma la pagina era piena di pause inventate.
  const eccezioniDurata = measureLengthMap(opts.measureLengths);
  const measureLenTicks = (m: number): number => {
    const ts = tsAtMeasure(m);
    const nominale = ts.numerator * (4 / ts.denominator);
    return Math.round(beatsOfMeasure(m, nominale, eccezioniDurata) * DIVISIONS);
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
    /** Rigo traspositore: ottave da togliere all'altezza scritta per avere la suonata. */
    octaveTranspose?: number;
    /** Programma General MIDI (0-127) da dichiarare nella <part-list>. */
    instrumentId?: number;
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
      ...(t.octaveTranspose ? { octaveTranspose: Number(t.octaveTranspose) } : {}),
      ...(Number.isFinite(t.instrumentId as any) ? { instrumentId: Number(t.instrumentId) } : {}),
    });
  });

  // Una parte VUOTA non va scritta (comparirebbe un rigo vuoto in chi apre il file):
  // si tiene solo se non c'è nient'altro, perché un MusicXML senza parti non è valido.
  // Gli id vengono rinumerati dopo lo scarto, così restano coerenti con la <part-list>.
  const nonEmpty = parts.filter(p => p.notes.some(n => !n.isRest));
  const finalParts = (nonEmpty.length > 0 ? nonEmpty : parts.slice(0, 1))
    .map((p, i) => ({ ...p, id: `P${i + 1}` }));
  // L'ANALISI va scritta su una parte che esiste. È assegnata al coro, ma un brano
  // strumentale importato sta su una traccia e il coro viene scartato perché vuoto: le
  // etichette non trovavano più dove andare e il file usciva senza una riga d'analisi.
  // Se nessuna parte superstite la porta, la prende la prima.
  if (finalParts.length > 0 && !finalParts.some(p => p.withHarmony)) {
    finalParts[0] = { ...finalParts[0], withHarmony: true };
  }

  // Armonia per misura → { localTick → {roman, figures} }. localTick calcolato con la
  // STESSA convenzione delle note (tick − inizio battuta) così coincide con gli onset.
  const harmonyByMeasure = new Map<number, Map<number, { roman?: string; figures?: string[]; symbol?: string }>>();
  for (const h of harmonyLabels) {
    const mi = h.measureIndex ?? 0;
    const localTick = h.tick - measureStartTicks(mi);
    if (!harmonyByMeasure.has(mi)) harmonyByMeasure.set(mi, new Map());
    const existing = harmonyByMeasure.get(mi)!.get(localTick) || {};
    harmonyByMeasure.get(mi)!.set(localTick, {
      roman: h.roman ?? existing.roman,
      figures: (h.figures && h.figures.length) ? h.figures : existing.figures,
      symbol: h.symbol ?? existing.symbol,
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
  /** Mette una direzione nella corsia della sua battuta, dato il punto in semiminime. */
  const pushInLane = (
    lane: Map<number, DynDirection[]>,
    absBeat: number, ordine: number, corpo: string[], velocity?: number,
  ): void => {
    if (!Number.isFinite(absBeat)) return;
    const tick = Math.round(Math.max(0, absBeat) * DIVISIONS);
    const m = measureOfTick(tick);
    const localTick = Math.max(0, tick - measureStartTicks(m));
    if (!lane.has(m)) lane.set(m, []);
    lane.get(m)!.push({ localTick, ordine, lines: buildDynDirection(corpo, velocity) });
  };
  const pushDyn = (absBeat: number, ordine: number, corpo: string[], velocity?: number): void =>
    pushInLane(dynByMeasure, absBeat, ordine, corpo, velocity);
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

  // ── LEGATURE: a ogni legatura il suo numero, per riconoscere i capi che vanno
  // insieme. MusicXML ne ammette 16 in contemporanea; si riciclano a giro perché due
  // legature lontane possono portare lo stesso numero senza confondersi.
  const inizioLegatura = new Map<string, number[]>();
  const fineLegatura = new Map<string, number[]>();
  (opts.slurs || []).forEach((sl, i) => {
    if (!sl?.fromNoteId || !sl?.toNoteId) return;
    const num = (i % 6) + 1;
    if (!inizioLegatura.has(sl.fromNoteId)) inizioLegatura.set(sl.fromNoteId, []);
    if (!fineLegatura.has(sl.toNoteId)) fineLegatura.set(sl.toNoteId, []);
    inizioLegatura.get(sl.fromNoteId)!.push(num);
    fineLegatura.get(sl.toNoteId)!.push(num);
  });

  // ── SEGNI D'OTTAVA, parte per parte ──
  // Sono agganciati a due note: si scrivono solo nella parte che quelle note ce l'ha.
  const ottavePerParte = new Map<string, Map<number, DynDirection[]>>();
  /** Tratti d'ottava della parte, risolti sui tick: servono anche ad alzare le altezze. */
  const trattiPerParte = new Map<string, Array<{ da: number; a: number; voce: number; ottave: number }>>();
  for (const parte of finalParts) {
    const perId = new Map(parte.notes.filter(n => n?.id).map(n => [n.id, n]));
    const corsia = new Map<number, DynDirection[]>();
    const tratti: Array<{ da: number; a: number; voce: number; ottave: number }> = [];
    for (const o of (opts.octaveShifts || [])) {
      const a = perId.get(o?.fromNoteId);
      const b = perId.get(o?.toNoteId);
      if (!a || !b) continue; // il segno non è di questa parte
      tratti.push({
        da: Math.min(Number((a as any).startTick ?? 0), Number((b as any).startTick ?? 0)),
        a: Math.max(Number((a as any).startTick ?? 0), Number((b as any).startTick ?? 0)),
        voce: Number((a as any).voice ?? 1),
        ottave: o.direction === 'up' ? 1 : -1,
      });
      const t1 = Number((a as any).startTick ?? 0);
      const t2 = Number((b as any).startTick ?? 0);
      const inizio = Math.min(t1, t2) / DIVISIONS;
      // La chiusura va DOPO l'ultima nota coperta: messa sul suo attacco, chi legge
      // escluderebbe proprio la nota sotto la fine della parentesi.
      const ultima = t2 >= t1 ? b : a;
      const fine = (Math.max(t1, t2) + Number((ultima as any).durationTicks ?? DIVISIONS)) / DIVISIONS;
      // 8va (suona sopra) = scritto sotto = type="down". Vedi il commento sul tipo.
      const tipo = o.direction === 'up' ? 'down' : 'up';
      pushInLane(corsia, inizio, 2, [`          <octave-shift type="${tipo}" size="8"/>`]);
      pushInLane(corsia, fine, 0, ['          <octave-shift type="stop" size="8"/>']);
    }
    if (corsia.size > 0) ottavePerParte.set(parte.id, corsia);
    if (tratti.length > 0) trattiPerParte.set(parte.id, tratti);
  }
  /** Ottave da sommare all'altezza scritta di una nota per ottenere quella suonata. */
  const ottaveDi = (partId: string, n: StaffNote): number => {
    const tratti = trattiPerParte.get(partId);
    if (!tratti) return 0;
    const t = Number((n as any).startTick ?? 0);
    const v = Number((n as any).voice ?? 1);
    let tot = 0;
    for (const x of tratti) {
      if (x.voce !== v) continue;
      if (t < x.da - 1e-6 || t > x.a + 1e-6) continue;
      tot += x.ottave;
    }
    return tot;
  };

  const fifths = computeFifths(keySignature, keySignatureRoot);
  const mode = isMinorMode ? 'minor' : 'major';

  // ── CAMBI D'ARMATURA: misura → <key> da dichiarare lì ──
  // ── SEGNI DI METRONOMO per battuta ────────────────────────────────────────
  // Stanno all'inizio della battuta da cui valgono, prima delle note, nella stessa
  // corsia delle dinamiche (`ordine` basso = escono per primi: l'andamento si legge
  // prima del resto). `<sound tempo>` è sempre in semiminime al minuto, anche quando
  // il segno stampato dichiara un'altra unità.
  const tempoPerMisura = new Map<number, DynDirection[]>();
  for (const tm of normalizeTempoMarks(opts.tempoMarks)) {
    const corpo = [
      '      <direction placement="above">',
      '        <direction-type>',
      '          <metronome>',
      `            <beat-unit>${tempoMarkXmlBeatUnit(tm)}</beat-unit>`,
      ...(tm.dotted ? ['            <beat-unit-dot/>'] : []),
      `            <per-minute>${Math.round(tm.bpm)}</per-minute>`,
      '          </metronome>',
      '        </direction-type>',
      `        <sound tempo="${Math.round(tempoMarkQuarterBpm(tm))}"/>`,
      '      </direction>',
    ];
    const lista = tempoPerMisura.get(tm.measureIndex) || [];
    lista.push({ localTick: 0, ordine: -1, lines: corpo });
    tempoPerMisura.set(tm.measureIndex, lista);
  }

  const armaturaPerMisura = new Map<number, { fifths: number; mode: string }>();
  for (const c of (opts.keySignatureChanges || [])) {
    if (!c || !Number.isFinite(c.measureIndex) || c.measureIndex <= 0) continue;
    const f = FIFTHS_MAP[String(c.root)];
    if (f == null) continue;
    armaturaPerMisura.set(Math.round(c.measureIndex), { fifths: f, mode: c.isMinor ? 'minor' : 'major' });
  }

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
    // STRUMENTO DICHIARATO. Senza, chi apre il file lo INDOVINA dal nome della parte —
    // e un rigo chiamato «Tenore» finisce riconosciuto come sax tenore, che è uno
    // strumento traspositore in Si bemolle: le note compaiono spostate di un tono e con
    // grafie impossibili (doppi bemolli). Dichiarando programma e nome dello strumento
    // non c'è più niente da indovinare.
    const prog = Number.isFinite(p.instrumentId as any) ? Math.max(0, Math.min(127, Number(p.instrumentId))) : 0;
    w(`      <score-instrument id="${p.id}-I1">`);
    w(`        <instrument-name>${escapeXml(GM_INSTRUMENT_NAME[prog] || 'Piano')}</instrument-name>`);
    w('      </score-instrument>');
    w(`      <midi-instrument id="${p.id}-I1">`);
    w(`        <midi-channel>${Math.min(16, finalParts.indexOf(p) + 1)}</midi-channel>`);
    w(`        <midi-program>${prog + 1}</midi-program>`);
    w('      </midi-instrument>');
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
          // Rigo traspositore: senza questa riga chi riapre il file disegna la parte
          // un'ottava più in alto di com'è scritta (il tenore dei corali).
          if (part.octaveTranspose) w(`          <clef-octave-change>${part.octaveTranspose}</clef-octave-change>`);
          w('        </clef>');
        }
        w('      </attributes>');
      } else {
        // CAMBIO DI METRO e/o D'ARMATURA: vanno dichiarati nella battuta in cui entrano
        // in vigore, altrimenti il file resta in quelli iniziali e chi lo rilegge divide
        // le battute sbagliate o scrive le note nell'armatura sbagliata. Nello STESSO
        // <attributes>, e con la chiave prima del metro come vuole il formato.
        const cambioMetro = measureLenTicks(m) !== measureLenTicks(m - 1)
          || tsAtMeasure(m).numerator !== tsAtMeasure(m - 1).numerator
          || tsAtMeasure(m).denominator !== tsAtMeasure(m - 1).denominator;
        const cambioArmatura = armaturaPerMisura.get(m);
        if (cambioMetro || cambioArmatura) {
          w('      <attributes>');
          if (cambioArmatura) {
            w('        <key>');
            w(`          <fifths>${cambioArmatura.fifths}</fifths>`);
            w(`          <mode>${cambioArmatura.mode}</mode>`);
            w('        </key>');
          }
          if (cambioMetro) {
            const ts = tsAtMeasure(m);
            w('        <time>');
            w(`          <beats>${ts.numerator}</beats>`);
            w(`          <beat-type>${ts.denominator}</beat-type>`);
            w('        </time>');
          }
          w('      </attributes>');
        }
      }

      const measureNotes = notesByMeasure.get(m) || [];
      const measureTotalTicks = measureLenTicks(m);

      // I segni di dinamica vanno scritti PRIMA delle note, ciascuno al suo punto: si
      // avanza con <forward> fino al tick del segno e alla fine si riempie il resto
      // della battuta, così il flusso delle note riparte da capo col solito <backup>.
      // Corsia dedicata e non agganciata agli attacchi perché la coda di una forcella
      // cade spesso dove nessuna voce attacca, e lì non avrebbe trovato un posto.
      const dynHere = [
        ...(tempoPerMisura.get(m) || []),
        ...(dynByMeasure.get(m) || []),
        ...((ottavePerParte.get(part.id)?.get(m)) || []),
      ].sort((x, y) => (x.localTick - y.localTick) || (x.ordine - y.ordine));
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
      const emittedSym = new Set<number>();

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
              // SIGLA D'ACCORDO come `<harmony>`, l'elemento vero del formato: chi apre il
              // file la vede come un accordo — la traspone, la modifica, la riconosce —
              // invece che come una scritta. Va PRIMA della nota del suo attacco, com'è
              // nella specifica. Prima le sigle non uscivano affatto.
              if (staffIdx === 0 && !emittedSym.has(onsetTick)) {
                const sigla = hMap.get(onsetTick)?.symbol;
                if (sigla) { emitChordSymbol(w, sigla); emittedSym.add(onsetTick); }
              }
              if (staffIdx === 0 && !emittedRoman.has(onsetTick)) {
                const roman = hMap.get(onsetTick)?.roman;
                if (roman) { emitHarmonyDirection(w, roman, staffNum); emittedRoman.add(onsetTick); }
              }
              // Le cifre stanno sotto il BASSO, cioè sul secondo rigo. Se la parte ha un
              // rigo solo — un brano strumentale importato come traccia — quel rigo non
              // esiste e le cifre non uscivano affatto: lì vanno sull'unico rigo che c'è.
              if ((staffIdx === 1 || part.staves === 1) && !emittedFig.has(onsetTick)) {
                const figures = hMap.get(onsetTick)?.figures;
                if (figures && figures.length) { emitFiguredBass(w, figures); emittedFig.add(onsetTick); }
              }
            }

            let isFirstInChord = true;
            for (const note of chordNotes) {
              emitNote(w, note, voiceNum, staffNum, isFirstInChord, part.unpitched, {
                start: inizioLegatura.get(note.id) || [],
                stop: fineLegatura.get(note.id) || [],
              }, ottaveDi(part.id, note) + (part.octaveTranspose ?? 0));
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
