/**
 * Export MuseScore 4 nativo (.mscx) — serializza StaffNote[] + analisi come basso
 * figurato TESTUALE nativo, così che VoiceOver legga il token (es. "V7", "IV43")
 * durante la navigazione delle note.
 *
 * PERCHÉ non MusicXML: l'importer MusicXML di MuseScore scarta il testo non-numerico
 * nel <figured-bass>. Il formato nativo .mscx invece conserva `<FiguredBass><text>…</text>`
 * (verificato: apre e VoiceOver lo legge). Questo exporter riusa la STESSA logica
 * musicale di exportMusicXML (raggruppamento misura → rigo → voce → onset) e cambia
 * solo la sintassi di output.
 *
 * Limiti v1 (documentati): niente legature native (le note legate escono ri-articolate,
 * altezze/beat corretti), niente terzine; chiavi normalizzate a violino/basso come in
 * exportMusicXML.
 */
import type { StaffNote, KeySignature, NoteDuration, TempoMark } from '../types';
import { normalizeTempoMarks } from '../utils/tempoMarks';
import { measureLengthMap, beatsOfMeasure } from '../utils/measureLengths';
import { parseChordSymbol, tpcOf } from '../utils/chordSymbol';
import { TICKS_PER_QUARTER } from '../constants';
import type { ExportMusicXMLOptions } from './exportMusicXML';

const TPQ = TICKS_PER_QUARTER; // 960

/** Font ridotto nel basso figurato: acceso per la modalità "parlata" (frasi italiane lunghe →
 *  niente allargamento misure/gonfiore pagine); spento per i token corti (V7). Impostato a
 *  inizio export (JS single-thread, non rientrante). */
let FB_SMALL_FONT = false;

const BASE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** tpc naturale (linea delle quinte): F=13 C=14 G=15 D=16 A=17 E=18 B=19. */
const NATURAL_TPC: Record<string, number> = { F: 13, C: 14, G: 15, D: 16, A: 17, E: 18, B: 19 };

const DURATION_TYPE_MAP: Record<NoteDuration, string> = {
  'whole': 'whole', 'half': 'half', 'quarter': 'quarter', 'eighth': 'eighth',
  'sixteenth': '16th', 'thirty-second': '32nd', 'sixty-fourth': '64th',
};

/** Durate base in tick (senza punto), dalla più lunga alla più corta. */
const DUR_TABLE: Array<{ ticks: number; type: string }> = [
  { ticks: TPQ * 4, type: 'whole' },
  { ticks: TPQ * 2, type: 'half' },
  { ticks: TPQ, type: 'quarter' },
  { ticks: TPQ / 2, type: 'eighth' },
  { ticks: TPQ / 4, type: '16th' },
  { ticks: TPQ / 8, type: '32nd' },
  { ticks: TPQ / 16, type: '64th' },
];

const FIFTHS_MAP: Record<string, number> = {
  'Cb': -7, 'Gb': -6, 'Db': -5, 'Ab': -4, 'Eb': -3, 'Bb': -2, 'F': -1,
  'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7,
};

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function computeFifths(ks: KeySignature, root?: string): number {
  if (root && FIFTHS_MAP[root] != null) return FIFTHS_MAP[root];
  return ks.type === 'sharp' ? ks.count : -ks.count;
}

/** MIDI + tpc (spelling) dalla nota. alter dedotto da midi − naturalMidi, così tiene conto
 *  anche degli accidenti impliciti dalla tonalità (che potrebbero non stare in `accidental`). */
function midiTpc(note: StaffNote): { midi: number; tpc: number } {
  const letter = String(note.pitch || 'C').toUpperCase();
  const octave = note.octave ?? 4;
  const naturalMidi = (octave + 1) * 12 + (BASE_PC[letter] ?? 0);
  const midi = Number.isFinite(note.midi) ? Math.round(note.midi) : naturalMidi;
  // L'alterazione si ricava dalle CLASSI DI SUONO, non dalla differenza in semitoni:
  // la grafia di una nota non dipende dall'ottava in cui sta. Prima si sottraeva
  // `naturalMidi`, e bastava che `midi` e `octave` non fossero d'accordo (succede quando
  // qualcuno sposta l'uno e dimentica l'altro) perché lo scarto valesse dodici semitoni.
  // La protezione che lo schiacciava a −2 rendeva il difetto invisibile e plausibile:
  // usciva un doppio bemolle, che è una nota vera e sbagliata — peggio di un errore.
  let alter = (((midi - naturalMidi) % 12) + 18) % 12 - 6;   // → −6…+5, senza le ottave
  if (alter > 2) alter = 2; if (alter < -2) alter = -2;
  const tpc = (NATURAL_TPC[letter] ?? 14) + 7 * alter;
  return { midi, tpc };
}

function getNoteDurationTicks(note: StaffNote): number {
  if (note.durationTicks && note.durationTicks > 0) return note.durationTicks;
  const base = DUR_TABLE.find(d => d.type === DURATION_TYPE_MAP[note.duration || 'quarter'])?.ticks || TPQ;
  return note.isDotted ? Math.round(base * 1.5) : base;
}

/** durationType + dots simbolici per una nota (preferisce la durata simbolica del modello). */
function noteDurType(note: StaffNote): { type: string; dots: number } {
  const dur = note.duration;
  if (dur && DURATION_TYPE_MAP[dur]) return { type: DURATION_TYPE_MAP[dur], dots: note.isDotted ? 1 : 0 };
  // fallback dai tick
  const t = getNoteDurationTicks(note);
  for (const d of DUR_TABLE) {
    if (t === d.ticks) return { type: d.type, dots: 0 };
    if (t === Math.round(d.ticks * 1.5)) return { type: d.type, dots: 1 };
  }
  // nearest
  let best = DUR_TABLE[2];
  for (const d of DUR_TABLE) if (Math.abs(d.ticks - t) < Math.abs(best.ticks - t)) best = d;
  return { type: best.type, dots: 0 };
}

/** Scompone un intervallo di tick in una lista di pause (greedy, senza punto). */
function decomposeRests(ticks: number): Array<{ type: string; dots: number; ticks: number }> {
  const out: Array<{ type: string; dots: number; ticks: number }> = [];
  let rem = Math.round(ticks);
  for (const d of DUR_TABLE) {
    while (rem >= d.ticks) { out.push({ type: d.type, dots: 0, ticks: d.ticks }); rem -= d.ticks; }
  }
  return out;
}

/** Frazione di semibreve per <ticks> del FiguredBass (es. quarto → 1/4). */
function fracOfWhole(ticks: number): string {
  const whole = TPQ * 4;
  let n = Math.round(ticks), d = whole;
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const k = g(n, d) || 1;
  n = Math.round(n / k); d = Math.round(d / k);
  return `${n}/${d}`;
}

// ── Serializzazione ──────────────────────────────────────────────────────────

interface Token { tick: number; text: string; }
interface Sigla { tick: number; symbol: string; }

/**
 * `<Harmony>` nativo di MuseScore: la sigla come ACCORDO, non come testo.
 *
 * Finora le sigle nel .mscx non uscivano affatto: chi apriva il file accessibile con
 * romani accesi non trovava un solo accordo scritto. Ora escono come oggetto vero —
 * si traspone, si modifica, si stampa con le convenzioni di MuseScore.
 *
 * NOTA sulla lettura vocale: l'elemento che sappiamo per certo essere letto da
 * VoiceOver è `<FiguredBass><text>`, ed è lì che continua ad andare il testo
 * dell'analisi. Che `<Harmony>` venga annunciato navigando NON è verificato: se lo è,
 * la sigla si sente due volte nel caso "solo sigle accese" — da provare sul campo
 * prima di togliere qualcosa.
 *
 * `<root>` è un numero TPC (linea delle quinte); `<name>` è la qualità come stringa —
 * MuseScore ristampa quella, quindi ci va la grafia dell'utente e non una
 * ricostruzione.
 */
function emitHarmony(w: (s: string) => void, symbol: string): void {
  const p = parseChordSymbol(symbol);
  if (!p) return;
  w('          <Harmony>');
  w(`            <root>${tpcOf(p.rootStep, p.rootAlter)}</root>`);
  if (p.quality) w(`            <name>${escapeXml(p.quality)}</name>`);
  if (p.bassStep) w(`            <base>${tpcOf(p.bassStep, p.bassAlter ?? 0)}</base>`);
  w('          </Harmony>');
}

/** Glifo SMuFL dell'unità di battito, per la scritta «♩ = 60» di MuseScore. */
const SIMBOLO_UNITA: Record<string, string> = {
  whole: 'metNoteWhole', half: 'metNoteHalfUp', quarter: 'metNoteQuarterUp',
  eighth: 'met8thNoteUp', sixteenth: 'met16thNoteUp',
};

/**
 * Un segno d'andamento nel formato di MuseScore.
 *
 * ATTENZIONE all'unità: `<tempo>` è in semiminime al SECONDO (60 al minuto = 1), non
 * al minuto. Scriverci i battiti al minuto significherebbe un brano sessanta volte
 * più veloce.
 */
function scriviTempo(
  w: (line: string) => void,
  bpm: number,
  beatUnit: NonNullable<TempoMark['beatUnit']>,
  dotted: boolean,
): void {
  const quartiPerUnita = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 }[beatUnit] ?? 1;
  const bpmSemiminime = bpm * quartiPerUnita * (dotted ? 1.5 : 1);
  const sym = SIMBOLO_UNITA[beatUnit] ?? SIMBOLO_UNITA.quarter;
  w('          <Tempo>');
  w(`            <tempo>${(bpmSemiminime / 60).toFixed(6)}</tempo>`);
  w('            <followText>1</followText>');
  w(`            <text><sym>${sym}</sym>${dotted ? '<sym>metAugmentationDot</sym>' : ''} = ${Math.round(bpm)}</text>`);
  w('            </Tempo>');
}

export function exportMuseScoreMscx(opts: ExportMusicXMLOptions, smallFont = false): string {
  FB_SMALL_FONT = smallFont;
  const {
    notes, title = 'Untitled', keySignature, timeSignature,
    isMinorMode = false, keySignatureRoot, harmonyLabels = [],
  } = opts;

  const numerator = timeSignature.numerator;
  // BATTUTE IRREGOLARI. Qui la durata della battuta era UNA COSTANTE, e le note si
  // collocavano con `tick − m × numerator × TPQ`: dopo una battuta che contiene più
  // del metro (la 15 della Fantaisie ne ha cinque, di movimenti) ogni nota risultava
  // un movimento in ritardo, e il riempimento a fine battuta infilava una PAUSA DI
  // SEMIMINIMA sul primo movimento — in ogni battuta, fino alla fine. Suonava giusto
  // perché gli attacchi erano al loro posto: era il conto a non tornare.
  const nominaleQuarti = numerator * (4 / timeSignature.denominator);
  // Andamento d'inizio e cambi, per la scrittura qui sotto.
  const bpmIniziale = Math.max(20, Math.min(300, Math.round(Number(opts.bpm) || 120)));
  const segnoTempoDiMisura = new Map<number, TempoMark>();
  for (const tm of normalizeTempoMarks(opts.tempoMarks)) segnoTempoDiMisura.set(tm.measureIndex, tm);
  const eccezioniDurata = measureLengthMap(opts.measureLengths);
  const measureLenOf = (m: number): number =>
    Math.round(beatsOfMeasure(m, nominaleQuarti, eccezioniDurata) * TPQ);
  const _startCache: number[] = [0];
  const measureStartTickOf = (m: number): number => {
    while (_startCache.length <= m) {
      const prev = _startCache.length - 1;
      _startCache.push(_startCache[prev] + measureLenOf(prev));
    }
    return _startCache[m];
  };
  const fifths = computeFifths(keySignature, keySignatureRoot);
  const mode = isMinorMode ? 'minor' : 'major';

  // Note per misura (scarta pause vuote senza durata, come exportMusicXML)
  const notesByMeasure = new Map<number, StaffNote[]>();
  for (const n of notes) {
    if (n.isRest && !n.duration) continue;
    const m = n.measureIndex ?? 0;
    if (!notesByMeasure.has(m)) notesByMeasure.set(m, []);
    notesByMeasure.get(m)!.push(n);
  }
  const maxMeasure = opts.totalMeasures ? opts.totalMeasures - 1 : Math.max(0, ...notesByMeasure.keys());

  // Token d'armonia per misura → localTick → testo (token ?? roman).
  const tokensByMeasure = new Map<number, Token[]>();
  for (const h of harmonyLabels) {
    const text = String(h.token ?? h.roman ?? '').trim();
    if (!text) continue;
    const mi = h.measureIndex ?? 0;
    const localTick = h.tick - measureStartTickOf(mi);
    if (!tokensByMeasure.has(mi)) tokensByMeasure.set(mi, []);
    tokensByMeasure.get(mi)!.push({ tick: localTick, text });
  }
  for (const arr of tokensByMeasure.values()) arr.sort((a, b) => a.tick - b.tick);

  // SIGLE per battuta → localTick. Vivono accanto ai token d'analisi ma su un altro
  // elemento: il basso figurato dice il GRADO, la sigla dice l'ACCORDO, e chi studia
  // usa spesso l'una o l'altra.
  const sigleByMeasure = new Map<number, Sigla[]>();
  for (const h of harmonyLabels) {
    const sym = String((h as any).symbol ?? '').trim();
    if (!sym) continue;
    const mi = h.measureIndex ?? 0;
    const localTick = h.tick - measureStartTickOf(mi);
    if (!sigleByMeasure.has(mi)) sigleByMeasure.set(mi, []);
    sigleByMeasure.get(mi)!.push({ tick: localTick, symbol: sym });
  }
  for (const arr of sigleByMeasure.values()) arr.sort((a, b) => a.tick - b.tick);

  // Determina il rigo/voce "d'armonia" (dove appendere il basso figurato): rigo grave se
  // esiste, altrimenti acuto; dentro, la voce più bassa (numero app più alto = basso).
  const clefOf = (n: StaffNote) => n.clefOverride || n.clef || ((n.voice ?? 1) <= 2 ? 'treble' : 'bass');
  let bassStaffHasNotes = false;
  const voicesByStaff: [Set<number>, Set<number>] = [new Set(), new Set()];
  for (const n of notes) {
    if (n.isRest && !n.duration) continue;
    const si = clefOf(n) === 'bass' ? 1 : 0;
    if (si === 1) bassStaffHasNotes = true;
    voicesByStaff[si].add(n.voice ?? (si === 0 ? 1 : 3));
  }
  // RIGHI: due solo se servono davvero. Prima ne scriveva SEMPRE due, quindi un brano
  // su rigo singolo — una chitarra, un violino, una parte sola — arrivava in MuseScore
  // su grand staff, con un rigo grave vuoto sotto. Per chi legge con lo screen reader
  // non è un dettaglio estetico: è un rigo in più da attraversare a ogni battuta.
  const numeroRighi = bassStaffHasNotes ? 2 : 1;
  const harmonyStaffIdx = bassStaffHasNotes ? 1 : 0;

  /**
   * Lo STRUMENTO della parte esportata.
   *
   * Prima era sempre e comunque «Piano», anche per una Fantaisie per chitarra: uno
   * screen reader annunciava lo strumento sbagliato a ogni apertura. Quando il brano
   * sta su UNA sola traccia, quella traccia sa già come si chiama, che programma GM
   * ha e se traspone.
   */
  const strumento = (() => {
    const tracce = (opts.accompanimentTracks || []).filter(t => (t.notes || []).some(n => n && !n.isRest));
    const sola = tracce.length === 1 ? tracce[0] : null;
    const gm = (typeof sola?.instrumentId === 'number' && sola.instrumentId >= 0 && sola.instrumentId <= 127)
      ? sola.instrumentId
      : 0;
    return {
      nome: (sola?.name || '').trim() || 'Piano',
      // Il nome del timbro nel formato di MuseScore: senza un id valido lo strumento
      // resta quello di default, quindi meglio il pianoforte che un id inventato.
      id: gm >= 24 && gm <= 25 ? 'pluck.guitar' : 'keyboard.piano',
      programma: gm,
      traspOttave: Number(sola?.octaveTranspose) || 0,
    };
  })();
  const harmonyVoiceNum = voicesByStaff[harmonyStaffIdx].size
    ? Math.max(...voicesByStaff[harmonyStaffIdx])
    : (harmonyStaffIdx === 0 ? 1 : 3);

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  // ── Intestazione ──
  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<museScore version="4.70">');
  w('  <programVersion>4.7.3</programVersion>');
  w('  <Score>');
  w('    <Division>480</Division>');
  w(`    <metaTag name="workTitle">${escapeXml(title)}</metaTag>`);
  w('    <Part id="1">');
  w('      <Staff>');
  w('        <StaffType group="pitched"><name>stdNormal</name></StaffType>');
  if (numeroRighi === 2) {
    w('        <bracket type="1" span="2" col="1" visible="1"/>');
    w('        <barLineSpan>1</barLineSpan>');
  }
  w('        </Staff>');
  if (numeroRighi === 2) {
    w('      <Staff>');
    w('        <StaffType group="pitched"><name>stdNormal</name></StaffType>');
    w('        </Staff>');
  }
  w(`      <trackName>${escapeXml(strumento.nome)}</trackName>`);
  w(`      <Instrument id="${strumento.id}">`);
  w(`        <longName>${escapeXml(strumento.nome)}</longName>`);
  w(`        <instrumentId>${strumento.id}</instrumentId>`);
  if (strumento.traspOttave !== 0) {
    // STRUMENTO TRASPOSITORE: la chitarra suona un'ottava sotto lo scritto. MuseScore
    // conserva le altezze SUONATE e riporta a video quelle SCRITTE applicando questa
    // traspozione — senza dichiararla, la parte compariva un'ottava più in basso.
    w(`        <transposeDiatonic>${strumento.traspOttave * 7}</transposeDiatonic>`);
    w(`        <transposeChromatic>${strumento.traspOttave * 12}</transposeChromatic>`);
  }
  w(`        <Channel><program value="${strumento.programma}"/><synti>Fluid</synti></Channel>`);
  w('        </Instrument>');
  w('      </Part>');

  // ── Rigo 1 (violino) e Rigo 2 (basso) come sequenze di misure separate ──
  for (let staffIdx = 0; staffIdx < numeroRighi; staffIdx++) {
    const staffId = staffIdx + 1;
    w(`    <Staff id="${staffId}">`);
    if (staffIdx === 0) {
      w('      <VBox>');
      w('        <height>10</height>');
      w(`        <Text><style>title</style><text>${escapeXml(title)}</text></Text>`);
      w('        </VBox>');
    }

    for (let m = 0; m <= maxMeasure; m++) {
      // Una battuta IRREGOLARE deve DICHIARARE la propria durata, altrimenti MuseScore
      // le dà quella del metro e l'eccedenza scavalla nella battuta dopo — travata
      // insieme, che è esattamente il difetto segnalato fra la 15 e la 16. `len` è una
      // frazione di semibreve: cinque semiminime si scrivono 5/4.
      const quartiDiQuestaMisura = measureLenOf(m) / TPQ;
      const irregolare = Math.abs(quartiDiQuestaMisura - nominaleQuarti) > 1e-6;
      w(irregolare ? `      <Measure len="${quartiDiQuestaMisura}/4">` : '      <Measure>');
      const measureNotes = notesByMeasure.get(m) || [];
      // note di QUESTO rigo
      const staffNotes = measureNotes.filter(n => (clefOf(n) === 'bass' ? 1 : 0) === staffIdx);

      // voci presenti nel rigo (sull'intero brano, per coerenza tra misure), ordinate
      const voiceNums = [...voicesByStaff[staffIdx]].sort((a, b) => a - b);
      let voicesToEmit = voiceNums.length ? voiceNums : [staffIdx === 0 ? 1 : 3];
      // MuseScore forza il basso figurato sulla VOCE 1 del rigo: metti la voce d'armonia
      // (il basso) come PRIMO blocco del rigo grave, così i token cadono sul basso.
      if (staffIdx === harmonyStaffIdx && voicesToEmit.includes(harmonyVoiceNum)) {
        voicesToEmit = [harmonyVoiceNum, ...voicesToEmit.filter(v => v !== harmonyVoiceNum)];
      }

      let firstVoiceOfMeasure = true;
      for (const vNum of voicesToEmit) {
        w('        <voice>');
        // Chiave/tonalità/tempo: solo misura 0, prima voce
        if (m === 0 && firstVoiceOfMeasure) {
          w('          <Clef>');
          w(`            <concertClefType>${staffIdx === 0 ? 'G' : 'F'}</concertClefType>`);
          w(`            <transposingClefType>${staffIdx === 0 ? 'G' : 'F'}</transposingClefType>`);
          w('            <isHeader>1</isHeader>');
          w('            </Clef>');
          w('          <KeySig>');
          w(`            <concertKey>${fifths}</concertKey>`);
          if (mode === 'minor') w('            <mode>minor</mode>');
          w('            </KeySig>');
          w('          <TimeSig>');
          w(`            <sigN>${numerator}</sigN>`);
          w(`            <sigD>${timeSignature.denominator}</sigD>`);
          w('            </TimeSig>');
          // ANDAMENTO. Non veniva scritto affatto: MuseScore ci metteva il suo 120 di
          // default, e un brano segnato a 60 andava al doppio della velocità. Nel
          // formato di MuseScore `<tempo>` è in semiminime al SECONDO, non al minuto.
          if (staffIdx === 0) scriviTempo(w, bpmIniziale, 'quarter', false);
        }
        // Cambi d'andamento a metà brano, sul rigo acuto e sulla prima voce.
        if (staffIdx === 0 && firstVoiceOfMeasure && m > 0) {
          const segno = segnoTempoDiMisura.get(m);
          if (segno) scriviTempo(w, segno.bpm, segno.beatUnit ?? 'quarter', !!segno.dotted);
        }

        const isHarmonyVoice = staffIdx === harmonyStaffIdx && vNum === harmonyVoiceNum;
        // Sul rigo grave a 2 voci il basso è stato messo in "voce 1": forziamo i gambi
        // alla direzione convenzionale (basso in giù, tenore in su) per leggibilità.
        const twoVoiceHarmony = staffIdx === harmonyStaffIdx && voicesToEmit.length >= 2;
        const stem: 'up' | 'down' | undefined = twoVoiceHarmony
          ? (vNum === harmonyVoiceNum ? 'down' : 'up')
          : undefined;
        emitVoiceStream(
          w,
          staffNotes.filter(n => (n.voice ?? (staffIdx === 0 ? 1 : 3)) === vNum),
          measureStartTickOf(m), measureLenOf(m),
          isHarmonyVoice ? (tokensByMeasure.get(m) || []) : [],
          stem,
          strumento.traspOttave * 12,
          // Le sigle stanno sopra il rigo ACUTO e sulla prima voce: è dove si scrivono, e
          // dove chi naviga se le aspetta.
          (staffIdx === 0 && firstVoiceOfMeasure) ? (sigleByMeasure.get(m) || []) : [],
        );

        w('          </voice>');
        firstVoiceOfMeasure = false;
      }
      w('        </Measure>');
    }
    w('      </Staff>');
  }

  w('    </Score>');
  w('  </museScore>');
  return lines.join('\n');
}

interface Seg { start: number; dur: number; chord: StaffNote[] | null; rest: { type: string; dots: number } | null; durOverride?: { type: string; dots: number }; }

/** Emette il flusso di una voce dentro una misura: accordi/pause a riempire la misura,
 *  con i token del basso figurato scritti PRIMA del segmento che suona al loro onset
 *  (in MuseScore il FiguredBass si aggancia al Chord/Rest che lo segue). */
function emitVoiceStream(
  w: (s: string) => void,
  voiceNotes: StaffNote[],
  measureStartTick: number, measureLen: number,
  tokens: Token[],
  stem?: 'up' | 'down',
  /** Traspozione dello strumento, in semitoni (vedi emitChord). */
  traspSemitoni = 0,
  sigle: Sigla[] = [],
): void {
  // onset (localTick) → note[] (accordo reale: stessa voce, stesso onset)
  const onsets = new Map<number, StaffNote[]>();
  for (const n of voiceNotes) {
    const tick = n.startTick ?? ((n.beat ?? 1) - 1) * TPQ;
    const localTick = tick - measureStartTick;
    if (!onsets.has(localTick)) onsets.set(localTick, []);
    onsets.get(localTick)!.push(n);
  }
  const sortedOnsets = [...onsets.entries()].sort((a, b) => a[0] - b[0]);
  // I confini che spezzano i segmenti sono quelli dei token E quelli delle sigle: una
  // sigla che cade a metà di una nota tenuta deve avere il suo posto lì, altrimenti
  // finisce attaccata all'attacco precedente — cioè su un altro tempo.
  const tokenTicks = [...new Set([...tokens.map(t => t.tick), ...sigle.map(s => s.tick)])].sort((a, b) => a - b);

  // ── Costruisci la lista ordinata dei segmenti (accordi + pause di riempimento,
  //    spezzate sui tick dei token così ogni token ha un confine di segmento) ──
  const segs: Seg[] = [];
  const addRests = (from: number, to: number) => {
    let a = from;
    const bounds = [...tokenTicks.filter(t => t > from && t < to), to];
    for (const b of bounds) {
      if (b <= a) continue;
      let t = a;
      for (const r of decomposeRests(b - a)) {
        segs.push({ start: t, dur: r.ticks, chord: null, rest: { type: r.type, dots: r.dots } });
        t += r.ticks;
      }
      a = b;
    }
  };

  let cur = 0;
  for (const [onsetTick, chordNotes] of sortedOnsets) {
    if (onsetTick > cur) { addRests(cur, onsetTick); cur = onsetTick; }
    const dur = getNoteDurationTicks(chordNotes[0]);
    const end = onsetTick + dur;
    if (chordNotes[0].isRest) {
      segs.push({ start: onsetTick, dur, chord: null, rest: noteDurType(chordNotes[0]) });
    } else {
      // Se dei token cadono DENTRO la durata dell'accordo (basso tenuto mentre l'armonia
      // cambia), spezzalo su quei confini: ogni grado avrà il suo slot al beat giusto, senza
      // impilarsi (le note spezzate escono ri-articolate, come le legature in v1).
      const internal = tokenTicks.filter(t => t > onsetTick && t < end);
      let a = onsetTick;
      for (const b of [...internal, end]) {
        let t2 = a;
        for (const d of decomposeRests(b - a)) {
          segs.push({ start: t2, dur: d.ticks, chord: chordNotes, rest: null, durOverride: { type: d.type, dots: d.dots } });
          t2 += d.ticks;
        }
        a = b;
      }
    }
    cur = end;
  }
  if (cur < measureLen) addRests(cur, measureLen);

  // ── Emissione: prima di ogni segmento scarica i token che suonano su di esso ──
  let tIdx = 0;
  let sIdx = 0;
  for (const seg of segs) {
    while (tIdx < tokens.length && tokens[tIdx].tick < seg.start + seg.dur) {
      emitFiguredBass(w, tokens[tIdx].text, seg.dur);
      tIdx++;
    }
    while (sIdx < sigle.length && sigle[sIdx].tick < seg.start + seg.dur) {
      emitHarmony(w, sigle[sIdx].symbol);
      sIdx++;
    }
    if (seg.chord) emitChord(w, seg.chord, stem, seg.durOverride, traspSemitoni);
    else emitRestSeg(w, seg.rest!);
  }
  while (tIdx < tokens.length) { emitFiguredBass(w, tokens[tIdx].text, TPQ); tIdx++; }
  while (sIdx < sigle.length) { emitHarmony(w, sigle[sIdx].symbol); sIdx++; }
}

function emitRestSeg(w: (s: string) => void, r: { type: string; dots: number }): void {
  w(`          <Rest><durationType>${r.type}</durationType>${r.dots ? `<dots>${r.dots}</dots>` : ''}</Rest>`);
}

/**
 * @param traspSemitoni  Traspozione dello strumento, in semitoni. Serve SOLO a scrivere
 *   `tpc2` (la grafia della parte scritta): le altezze arrivano qui già SUONATE — chi
 *   prepara le note per il file accessibile le converte apposta, perché chi legge con
 *   lo screen reader sente i nomi delle note e non vede la chiave. Sommare qui la
 *   traspozione le abbasserebbe una seconda volta: è l'errore che ha lasciato il
 *   disegno dov'era e ha fatto scendere il suono di un'altra ottava.
 */
function emitChord(w: (s: string) => void, chordNotes: StaffNote[], stem?: 'up' | 'down', durOverride?: { type: string; dots: number }, traspSemitoni = 0): void {
  const { type, dots } = durOverride ?? noteDurType(chordNotes[0]);
  w('          <Chord>');
  w(`            <durationType>${type}</durationType>`);
  if (dots) w(`            <dots>${dots}</dots>`);
  if (stem) w(`            <StemDirection>${stem}</StemDirection>`);
  for (const n of chordNotes) {
    const { midi, tpc } = midiTpc(n);
    w('            <Note>');
    w(`              <pitch>${midi}</pitch>`);
    w(`              <tpc>${tpc}</tpc>`);
    // Con uno strumento traspositore MuseScore vuole ANCHE la grafia della parte
    // scritta (`tpc2`): la traspozione è di ottave tonde, quindi la lettera non cambia
    // e le due grafie coincidono. L'altezza a video la ricava lui, sottraendo la
    // traspozione dichiarata: memorizzato Re2 (suonato) con −12, disegna Re3 — cioè
    // quello che c'è sulla partitura stampata, mentre suona la nota vera.
    if (traspSemitoni !== 0) w(`              <tpc2>${tpc}</tpc2>`);
    w('              </Note>');
  }
  w('            </Chord>');
}

function emitFiguredBass(w: (s: string) => void, text: string, segTicks: number): void {
  // Font minuscolo: VoiceOver legge il testo a prescindere dalla dimensione, ma così il
  // basso figurato occupa poca larghezza e MuseScore NON allarga le misure (niente gonfiore
  // di pagine con le frasi italiane lunghe).
  const font = FB_SMALL_FONT ? '<font size="4"/>' : '';
  w('          <FiguredBass>');
  w(`            <ticks>${fracOfWhole(segTicks)}</ticks>`);
  w(`            <text>${font}${escapeXml(text)}</text>`);
  w('            </FiguredBass>');
}
