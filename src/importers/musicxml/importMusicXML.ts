import { TICKS_PER_QUARTER } from '../../constants';
import type { AccidentalType, ClefType, NoteDuration, StaffNote, TimeSignature, TimeSignatureChange } from '../../types';
import type { DynamicLevel, DynamicMark } from '../../utils/dynamics';
import type { ArticulationMark, Slur, OctaveShift } from '../../types';

/**
 * Una <part> del file, tenuta a sé. `notes` è lo STESSO materiale che finisce in
 * `MusicXMLImportResult.notes`, ma con le voci numerate DENTRO la parte (rigo 1 → voci
 * 1-2, rigo 2 → voci 1-2) invece che rimappate sulle 4 voci del corale: serve a chi
 * importa il file come traccia (una parte = un rigo) anziché come SATB.
 */
export type MusicXMLPart = {
  /** id della <part> nel file (P1, P2…) */
  id: string;
  /** <part-name> dalla <part-list>, vuoto se assente */
  name: string;
  notes: StaffNote[];
  /** La parte usa due righi (pianistica) → va incisa su grand staff. */
  hasSecondStaff: boolean;
  /** Chiave del rigo 1 (usata quando la parte sta su un rigo solo). */
  clef: ClefType;
  /** Strumento GM dichiarato dalla <part-list> (<midi-program>, 1-128 nel file → 0-127
   *  qui). Senza, la traccia importata userebbe il pianoforte per qualsiasi parte. */
  instrumentId?: number;
};

export type MusicXMLImportResult = {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  timeSignatureChanges: TimeSignatureChange[];
  keySignatureRoot: string;
  isMinorMode: boolean;
  staffSystemMode: 'grandstaff' | 'treble_only' | 'satb_ancient';
  projectTitle?: string;
  /** Le parti del file tenute separate (vedi MusicXMLPart). Stesso ordine del file. */
  parts: MusicXMLPart[];
  /** SEGNI D'OTTAVA letti dal file. Nel formato `type` dice di quanto è spostato lo
   *  SCRITTO: `down` = scritto sotto, suonato sopra = il nostro 8va (`up`). */
  octaveShifts: OctaveShift[];
  /** LEGATURE DI PORTAMENTO lette dal file, con i capi già risolti sugli id delle note
   *  importate. I due capi arrivano separati (`<slur type="start">` … `type="stop">`) e
   *  spesso a battute di distanza: si appaiano per `number`. */
  slurs: Slur[];
  /** SEGNI DI DINAMICA letti dal file (pp…ff, sf, fp, forcelle), pronti da disegnare e
   *  da modificare. Prima le dinamiche entravano SOLO come velocity delle note: il
   *  volume era giusto ma sulla carta non c'era niente, e le forcelle si perdevano del
   *  tutto. Nel programma i segni valgono per il brano, non per la parte: quelli uguali
   *  ripetuti in più parti (come li scrive MuseScore) contano una volta sola. */
  dynamics: DynamicMark[];
};

const NOTE_PC_BY_LETTER: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NOTE_POSITION_BY_LETTER: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  return String(el.textContent ?? '').trim();
}

function intOf(el: Element | null | undefined): number | null {
  const s = textOf(el);
  const v = Number.parseInt(s, 10);
  return Number.isFinite(v) ? v : null;
}

function getFirstNonEmpty(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

/**
 * Alterazione EFFETTIVA dell'altezza, ricavata da `<alter>`.
 *
 * ATTENZIONE alla semantica del formato: `<alter>` è l'alterazione SUONATA, armatura
 * compresa. Quindi in Fa maggiore un Si bemolle "di chiave" ha `<alter>-1</alter>` senza
 * alcun segno stampato, mentre un Si BEQUADRO ha alter 0 (o assente) e in più
 * `<accidental>natural</accidental>`. Restituire null per alter 0 (com'era) faceva perdere
 * proprio il bequadro: la nota restava senza alterazione, l'app la rideduceva
 * dall'armatura e il Si tornava BEMOLLE — cambiava l'altezza, non solo il segno.
 */
function accidentalFromAlter(alter: number): AccidentalType | null {
  if (!Number.isFinite(alter)) return null;
  if (alter === 0) return 'natural';
  if (alter === 1) return 'sharp';
  if (alter === -1) return 'flat';
  if (alter === 2) return 'double-sharp';
  if (alter === -2) return 'double-flat';
  return null;
}

/** Segno STAMPATO (`<accidental>`): è la grafia voluta dal file, distinta dall'altezza. */
const PRINTED_ACCIDENTAL: Record<string, AccidentalType> = {
  'sharp': 'sharp',
  'flat': 'flat',
  'natural': 'natural',
  'double-sharp': 'double-sharp',
  'sharp-sharp': 'double-sharp',
  'flat-flat': 'double-flat',
  'double-flat': 'double-flat',
};
function accidentalFromPrinted(text: string): AccidentalType | null {
  return PRINTED_ACCIDENTAL[String(text || '').trim().toLowerCase()] ?? null;
}

function noteDurationFromType(type: string): NoteDuration | null {
  switch (String(type || '').trim()) {
    case 'whole':
      return 'whole';
    case 'half':
      return 'half';
    case 'quarter':
      return 'quarter';
    case 'eighth':
      return 'eighth';
    case '16th':
      return 'sixteenth';
    case '32nd':
      return 'thirty-second';
    case '64th':
      return 'sixty-fourth';
    default:
      return null;
  }
}

// Notated durations as beats (quarter = 1), longest first — used to reconcile the
// duration LABEL with the real <duration>.
const DURATION_BEATS: Array<[NoteDuration, number]> = [
  ['whole', 4], ['half', 2], ['quarter', 1], ['eighth', 0.5],
  ['sixteenth', 0.25], ['thirty-second', 0.125], ['sixty-fourth', 0.0625],
];

/**
 * Sceglie il label di durata (+ eventuale punto) la cui lunghezza SUONATA è più vicina a `beats`.
 * Serve perché il playback ricostruisce gli onset SOMMANDO i label: per le pause importate il label
 * deve valere quanto la durata reale, altrimenti le note successive slittano. (Es. semibreve = 4,
 * mezza col punto = 3.) Considera anche i valori puntati.
 */
function inferDurationFromBeats(beats: number): { duration: NoteDuration; dotted: boolean } {
  let best: { duration: NoteDuration; dotted: boolean } = { duration: 'quarter', dotted: false };
  let bestDiff = Infinity;
  for (const [dur, base] of DURATION_BEATS) {
    for (const dotted of [false, true]) {
      const diff = Math.abs(base * (dotted ? 1.5 : 1) - beats);
      if (diff < bestDiff - 1e-9) { bestDiff = diff; best = { duration: dur, dotted }; }
    }
  }
  return best;
}

/**
 * Dinamiche → velocity MIDI.
 *
 * Serve per il VOLUME di riproduzione: nell'app una nota SENZA velocity suona a volume
 * PIENO (1.0), mentre tutto ciò che arriva dal MIDI o esce dall'export sta su una nominale
 * di 88 (≈ 0.67). Importare senza velocity metteva quindi il materiale MusicXML ~3,5 dB
 * sopra tutto il resto — con quattro voci simultanee e nessun limitatore sul master, è
 * saturazione all'attacco di ogni nota. Il MusicXML le dinamiche ce le ha: usiamole.
 *
 * `<sound dynamics="X"/>` è la fonte precisa (X è una percentuale in cui 100 = velocity 90,
 * per specifica); `<dynamics><p/></dynamics>` è il segno grafico, mappato ai valori d'uso.
 */
const DEFAULT_VELOCITY = 88; // nominale dell'app per le note senza dinamica (vedi midiWriter)

const DYNAMIC_MARK_VELOCITY: Record<string, number> = {
  pppp: 10, ppp: 16, pp: 33, p: 49, mp: 64,
  mf: 80, f: 96, ff: 112, fff: 126, ffff: 127,
  fp: 96, sf: 96, sfz: 112, sffz: 112, sfp: 96, rf: 96, rfz: 96, fz: 112,
};

/** Legge la dinamica da un <direction> (o da un <sound> nudo). null = non ne porta. */
function velocityFromDirection(el: Element): number | null {
  const sound = el.tagName === 'sound' ? el : el.querySelector('sound[dynamics]');
  const raw = sound?.getAttribute('dynamics');
  if (raw != null) {
    const pct = Number.parseFloat(raw);
    // Specifica MusicXML: dynamics="100" ⇒ velocity 90.
    if (Number.isFinite(pct) && pct > 0) return Math.max(1, Math.min(127, Math.round(90 * pct / 100)));
  }
  const dyn = el.querySelector('direction-type > dynamics');
  if (dyn) {
    for (const child of Array.from(dyn.children)) {
      const v = DYNAMIC_MARK_VELOCITY[child.tagName.toLowerCase()];
      if (v != null) return v;
    }
  }
  return null;
}

/** Articolazioni: elementi MusicXML → nomi nostri. Quelle che non abbiamo (spiccato,
 *  detached-legato…) si ignorano: meglio non scritte che scritte per un'altra cosa. */
const XML_ARTICULATION: Record<string, ArticulationMark> = {
  staccato: 'staccato',
  staccatissimo: 'staccatissimo',
  accent: 'accent',
  'strong-accent': 'marcato',
  tenuto: 'tenuto',
};

/** Capi di legatura dichiarati da una <note>: [{tipo, numero}]. */
export function readNoteSlurEnds(noteEl: Element): Array<{ tipo: 'start' | 'stop'; numero: string }> {
  const out: Array<{ tipo: 'start' | 'stop'; numero: string }> = [];
  try {
    for (const sl of Array.from(noteEl.querySelectorAll('notations > slur'))) {
      const tipo = String(sl.getAttribute('type') || '').toLowerCase();
      if (tipo !== 'start' && tipo !== 'stop') continue; // 'continue' non apre né chiude
      out.push({ tipo, numero: String(sl.getAttribute('number') || '1') });
    }
  } catch { /* nota senza notations */ }
  return out;
}

/** Articolazioni di una <note>, dal suo <notations><articulations>.
 *  (Esportata per il banco di prova, come `readDynamicSigns`.) */
export function readNoteArticulations(noteEl: Element): ArticulationMark[] {
  const out: ArticulationMark[] = [];
  try {
    for (const grp of Array.from(noteEl.querySelectorAll('notations > articulations'))) {
      for (const c of Array.from(grp.children)) {
        const a = XML_ARTICULATION[c.tagName.toLowerCase()];
        if (a && !out.includes(a)) out.push(a);
      }
    }
  } catch { /* nota senza notations */ }
  return out;
}

/** Nomi MusicXML dei livelli → i nostri. Gli estremi che non abbiamo (pppp, ffff)
 *  ricadono sul più vicino invece di sparire. */
const XML_DYNAMIC_LEVEL: Record<string, DynamicLevel> = {
  pppp: 'ppp', ppp: 'ppp', pp: 'pp', p: 'p', mp: 'mp',
  mf: 'mf', f: 'f', ff: 'ff', fff: 'fff', ffff: 'fff',
};

/** Accenti istantanei: agiscono sul solo attacco, non spostano il livello in vigore. */
const XML_DYNAMIC_ACCENT: Record<string, 'sf' | 'sfz' | 'rf'> = {
  sf: 'sf', sfz: 'sfz', sffz: 'sfz', fz: 'sfz', rf: 'rf', rfz: 'rf',
};

/**
 * Segni GRAFICI di un <direction>: livelli, accenti, fp e forcelle.
 *
 * Le forcelle arrivano in due pezzi (apertura e `stop`) che possono stare in battute
 * diverse: l'apertura resta in sospeso finché non arriva la chiusura. L'attributo
 * `number` distingue forcelle sovrapposte — senza, due forcelle intrecciate si
 * chiuderebbero a vicenda nell'ordine sbagliato.
 */
export function readDynamicSigns(
  el: Element,
  absBeat: number,
  out: DynamicMark[],
  openWedges: Map<string, { from: number; direction: 'cresc' | 'dim' }>,
): void {
  for (const dt of Array.from(el.querySelectorAll(':scope > direction-type'))) {
    const dyn = dt.querySelector(':scope > dynamics');
    if (dyn) {
      for (const c of Array.from(dyn.children)) {
        const t = c.tagName.toLowerCase();
        // fp e sfp sono la stessa idea: attacco forte, poi si resta piano.
        if (t === 'fp' || t === 'sfp') { out.push({ kind: 'fp', absBeat }); continue; }
        const lvl = XML_DYNAMIC_LEVEL[t];
        if (lvl) { out.push({ kind: 'level', absBeat, level: lvl }); continue; }
        const acc = XML_DYNAMIC_ACCENT[t];
        if (acc) out.push({ kind: 'accent', absBeat, label: acc });
      }
    }
    const wedge = dt.querySelector(':scope > wedge');
    if (wedge) {
      const tipo = String(wedge.getAttribute('type') || '').toLowerCase();
      const num = String(wedge.getAttribute('number') || '1');
      if (tipo === 'crescendo' || tipo === 'diminuendo') {
        openWedges.set(num, { from: absBeat, direction: tipo === 'crescendo' ? 'cresc' : 'dim' });
      } else if (tipo === 'stop') {
        const aperta = openWedges.get(num);
        if (aperta && absBeat > aperta.from) {
          out.push({ kind: 'hairpin', fromAbsBeat: aperta.from, toAbsBeat: absBeat, direction: aperta.direction });
        }
        openWedges.delete(num);
      }
      // type="continue" non apre e non chiude: la forcella prosegue.
    }
  }
}

/** Chiave per riconoscere due segni UGUALI ripetuti in parti diverse.
 *  (Questa e `readDynamicSigns` sono esportate per il banco di prova: i collaudi girano
 *  in node, che non ha un DOM, quindi il lettore va provato da solo.) */
export function dynamicKey(d: DynamicMark): string {
  return d.kind === 'hairpin'
    ? `h|${d.direction}|${d.fromAbsBeat.toFixed(4)}|${d.toAbsBeat.toFixed(4)}`
    : `${d.kind}|${(d as any).level ?? (d as any).label ?? ''}|${d.absBeat.toFixed(4)}`;
}

function clefFromMusicXML(sign: string, line: number | null): ClefType {
  const s = String(sign || '').trim().toUpperCase();
  if (s === 'F') return 'bass';
  if (s === 'G') return 'treble';
  if (s === 'C') {
    // Common C clef placements.
    if (line === 1) return 'soprano';
    if (line === 3) return 'alto';
    if (line === 4) return 'tenor';
    return 'alto';
  }
  return 'treble';
}

function keyRootFromFifths(fifths: number, mode: 'major' | 'minor'): { root: string; isMinor: boolean } {
  // Represent roots in the app's sharp-name domain; getKeySignature() can still emit flat signatures.
  const majorByFifths: Record<number, string> = {
    [-7]: 'B',
    [-6]: 'F#',
    [-5]: 'C#',
    [-4]: 'G#',
    [-3]: 'D#',
    [-2]: 'A#',
    [-1]: 'F',
    0: 'C',
    1: 'G',
    2: 'D',
    3: 'A',
    4: 'E',
    5: 'B',
    6: 'F#',
    7: 'C#',
  };
  const minorByFifths: Record<number, string> = {
    [-7]: 'G#',
    [-6]: 'D#',
    [-5]: 'A#',
    [-4]: 'F',
    [-3]: 'C',
    [-2]: 'G',
    [-1]: 'D',
    0: 'A',
    1: 'E',
    2: 'B',
    3: 'F#',
    4: 'C#',
    5: 'G#',
    6: 'D#',
    7: 'A#',
  };

  const safeFifths = Number.isFinite(fifths) ? Math.max(-7, Math.min(7, Math.trunc(fifths))) : 0;
  if (mode === 'minor') {
    // The app stores keySignatureRoot as the RELATIVE MAJOR root.
    // For minor mode, fifths=0 → C major signature → A minor, so root='C'.
    return { root: majorByFifths[safeFifths] || 'C', isMinor: true };
  }
  return { root: majorByFifths[safeFifths] || 'C', isMinor: false };
}

function createIdFactory(prefix: string) {
  let i = 0;
  return () => {
    i++;
    const r = (globalThis as any)?.crypto?.randomUUID?.();
    if (typeof r === 'string' && r) return `${prefix}-${r}`;
    return `${prefix}-${Date.now()}-${i}`;
  };
}

function parseXmlOrThrow(xml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const msg = getFirstNonEmpty(textOf(parseError), 'MusicXML non valido (parsererror).');
    throw new Error(msg);
  }
  return doc;
}

export function importMusicXML(xml: string): MusicXMLImportResult {
  const doc = parseXmlOrThrow(xml);

  const root = doc.querySelector('score-partwise') || doc.documentElement;
  if (!root) throw new Error('MusicXML non valido: root mancante.');

  const title = getFirstNonEmpty(
    textOf(doc.querySelector('work > work-title')),
    textOf(doc.querySelector('movement-title')),
    textOf(doc.querySelector('credit credit-words')),
  );

  const parts = Array.from(doc.querySelectorAll('part'));
  if (parts.length === 0) throw new Error('MusicXML non valido: nessun <part>.');

  const makeId = createIdFactory('mx');

  // Global score-level defaults
  let timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
  const timeSignatureChanges: TimeSignatureChange[] = [];

  let keySignatureRoot = 'C';
  let isMinorMode = false;

  // Use the first encountered key signature as the project key.
  let didSetKey = false;
  let didSetTime = false;

  const notes: StaffNote[] = [];

  // Heuristic: if any note declares staff=2, assume grandstaff.
  let sawSecondStaff = false;

  // Le parti si LEGGONO tutte (l'import "come traccia" mette ogni parte sul suo rigo, e
  // una partitura d'orchestra ne ha più di quattro), ma solo le prime 4 confluiscono nel
  // corale: le 4 voci del SATB non possono ospitarne di più, e le altre finirebbero
  // ammucchiate nel basso.
  const MAX_SATB_PARTS = 4;
  const partsToParse = parts;
  const satbPartCount = Math.min(parts.length, MAX_SATB_PARTS);

  // Detect multi-part SATB: 3+ parts typically means S/A/T/B as individual parts
  const isSeparateSATB = satbPartCount >= 3;

  // Nomi delle parti dalla <part-list> (indicizzati per id della <score-part>).
  const partNameById = new Map<string, string>();
  const partProgramById = new Map<string, number>();
  try {
    for (const sp of Array.from(doc.querySelectorAll('part-list > score-part'))) {
      const id = String(sp.getAttribute('id') || '').trim();
      if (id) partNameById.set(id, textOf(sp.querySelector('part-name')));
      // Strumento: <midi-instrument><midi-program> è 1-128, i programmi GM 0-127.
      if (id) {
        const prog = Number(textOf(sp.querySelector('midi-instrument > midi-program')));
        if (Number.isFinite(prog) && prog >= 1 && prog <= 128) partProgramById.set(id, prog - 1);
      }
    }
  } catch {
    // ignore
  }

  const partsOut: MusicXMLPart[] = [];

  // Segni di dinamica del BRANO. Nel file stanno dentro le parti (e MuseScore li ripete
  // identici su ognuna); qui valgono per tutti, quindi si raccolgono una volta sola.
  const dynamics: DynamicMark[] = [];
  const dynSeen = new Set<string>();
  // Legature: i capi arrivano separati e vanno appaiati per numero, dentro la parte.
  const slurs: Slur[] = [];
  const octaveShifts: OctaveShift[] = [];

  for (let partIndex = 0; partIndex < partsToParse.length; partIndex++) {
    const part = partsToParse[partIndex];
    const measures = Array.from(part.querySelectorAll(':scope > measure'));

    // Accumulatore della parte (voci locali al rigo, vedi MusicXMLPart).
    const partNotes: StaffNote[] = [];
    let partSawSecondStaff = false;
    let partFirstClef: ClefType | null = null;
    // Le voci MusicXML del rigo (1,2… oppure 5,6 per il rigo sinistro pianistico)
    // rimappate, nell'ordine in cui compaiono, sulla convenzione del "grand staff a voci"
    // dell'app: rigo 1 → voci 1-2, rigo 2 → voci 3-4 (gambi 1/3 su, 2/4 giù). Max 2 voci
    // per rigo, come nell'import MIDI: le eccedenti confluiscono nella seconda.
    const localVoiceByStaff = new Map<number, Map<number, 1 | 2 | 3 | 4>>();

    // Dinamica corrente della parte (si porta avanti fino al segno successivo).
    let currentVelocity = DEFAULT_VELOCITY;

    // Segni grafici di questa parte, e le forcelle ancora aperte in attesa del loro stop.
    const partDynamics: DynamicMark[] = [];
    // Legature aperte in questa parte, in attesa del loro `stop` (chiave = number).
    const legatureAperte = new Map<string, string>();
    // Segni d'ottava: il file dice DA DOVE e FIN DOVE in tick; le note a cui agganciarli
    // si sanno solo dopo averle lette, quindi si tiene l'elenco di quelle della parte.
    let ottavaAperta: { daTick: number; direzione: 'up' | 'down' } | null = null;
    const noteDiParte: Array<{ id: string; tick: number }> = [];
    const openWedges = new Map<string, { from: number; direction: 'cresc' | 'dim' }>();
    let finePartAbsBeat = 0;

    // Score cursor at measure granularity (ticks). We derive it from timeSignature changes.
    // Inside each measure we position notes by their MusicXML position in divisions.
    // `divisions` persists across measures per MusicXML spec — only updated when <attributes> declares a new value.
    let divisions = 1;
    for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
      const measure = measures[measureIndex];

      // attributes
      const attrs = measure.querySelector(':scope > attributes');
      // divisions persists from previous measure (MusicXML spec); only update when declared.
      if (attrs) {
        const div = intOf(attrs.querySelector('divisions'));
        if (div != null && div > 0) divisions = div;

        const timeEl = attrs.querySelector('time');
        if (timeEl) {
          const beats = intOf(timeEl.querySelector('beats'));
          const beatType = intOf(timeEl.querySelector('beat-type'));
          if (beats != null && beatType != null && beats > 0 && beatType > 0) {
            const nextTs = { numerator: beats, denominator: beatType };
            if (!didSetTime) {
              timeSignature = nextTs;
              didSetTime = true;
            } else if (!timeSignatureChanges.some(c => c.measureIndex === measureIndex)) {
              // Only record if changed vs last known. La guardia sul measureIndex serve
              // perché le parti si leggono una dopo l'altra e ognuna ripercorre le STESSE
              // battute: senza, un corale a 4 parti registrava ogni cambio di tempo 4 volte.
              const last = (timeSignatureChanges.length > 0)
                ? timeSignatureChanges[timeSignatureChanges.length - 1]
                : null;
              const lastEffective = last
                ? { numerator: last.numerator, denominator: last.denominator }
                : timeSignature;
              if (lastEffective.numerator !== nextTs.numerator || lastEffective.denominator !== nextTs.denominator) {
                timeSignatureChanges.push({ measureIndex, numerator: nextTs.numerator, denominator: nextTs.denominator });
              }
            }
          }
        }

        const keyEl = attrs.querySelector('key');
        if (keyEl) {
          const fifths = intOf(keyEl.querySelector('fifths')) ?? 0;
          const modeRaw = textOf(keyEl.querySelector('mode')).toLowerCase();
          const mode = (modeRaw === 'minor') ? 'minor' : 'major';
          if (!didSetKey) {
            const k = keyRootFromFifths(fifths, mode);
            keySignatureRoot = k.root;
            isMinorMode = k.isMinor;
            didSetKey = true;
          }
        }
      }

      // Determine the effective time signature for this measure (needed for beat numbering only).
      const effectiveTs = (() => {
        let cur: TimeSignature = timeSignature;
        for (const c of timeSignatureChanges) {
          if ((c.measureIndex ?? 0) <= measureIndex) cur = { numerator: c.numerator, denominator: c.denominator };
          else break;
        }
        return cur;
      })();
      const beatsPerMeasure = effectiveTs.numerator * (4 / effectiveTs.denominator);

      // Clef per staff (fallback per part)
      const clefByStaff = new Map<number, ClefType>();
      try {
        const clefs = Array.from(measure.querySelectorAll(':scope > attributes > clef'));
        for (const c of clefs) {
          const staffNum = Number.parseInt(c.getAttribute('number') || '1', 10);
          const sign = textOf(c.querySelector('sign'));
          const line = intOf(c.querySelector('line'));
          clefByStaff.set(Number.isFinite(staffNum) ? staffNum : 1, clefFromMusicXML(sign, line));
        }
      } catch {
        // ignore
      }

      const measureStartAbsBeat = (() => {
        // Compute via accumulated beats from 0 to measureIndex, honoring timeSignatureChanges.
        let acc = 0;
        for (let m = 0; m < measureIndex; m++) {
          let ts: TimeSignature = timeSignature;
          for (const c of timeSignatureChanges) {
            if ((c.measureIndex ?? 0) <= m) ts = { numerator: c.numerator, denominator: c.denominator };
            else break;
          }
          acc += ts.numerator * (4 / ts.denominator);
        }
        return acc;
      })();
      const measureStartTick = Math.round(measureStartAbsBeat * TICKS_PER_QUARTER);
      // Dove finisce la musica letta finora: serve a chiudere una forcella rimasta
      // aperta nel file.
      finePartAbsBeat = Math.max(finePartAbsBeat, measureStartAbsBeat + beatsPerMeasure);

      // Iterate measure children in order to support <backup>/<forward>.
      let curPosDiv = 0;
      let lastChordStartDiv: number | null = null;

      const children = Array.from(measure.children);
      for (const child of children) {
        const tag = child.tagName;
        if (tag === 'backup') {
          const dur = intOf(child.querySelector('duration'));
          if (dur != null) curPosDiv = Math.max(0, curPosDiv - dur);
          lastChordStartDiv = null;
          continue;
        }
        if (tag === 'forward') {
          const dur = intOf(child.querySelector('duration'));
          if (dur != null) curPosDiv += dur;
          lastChordStartDiv = null;
          continue;
        }
        if (tag === 'direction' || tag === 'sound') {
          const v = velocityFromDirection(child);
          if (v != null) currentVelocity = v;
          // …e il segno GRAFICO, al punto in cui si trova il cursore della battuta.
          if (tag === 'direction') {
            const absBeat = measureStartAbsBeat + (divisions > 0 ? curPosDiv / divisions : 0);
            readDynamicSigns(child, absBeat, partDynamics, openWedges);
            // Segno d'ottava: si apre e si chiude a distanza, e i capi sono NOTE, che
            // qui non sono ancora tutte lette → si tiene il punto e si aggancia al `stop`.
            try {
              const os = child.querySelector('direction-type > octave-shift');
              const tipo = String(os?.getAttribute('type') || '').toLowerCase();
              const tick = Math.round(absBeat * TICKS_PER_QUARTER);
              if (tipo === 'down' || tipo === 'up') {
                // down = scritto sotto, suonato sopra = il nostro 'up'.
                ottavaAperta = { daTick: tick, direzione: tipo === 'down' ? 'up' : 'down' };
              } else if (tipo === 'stop' && ottavaAperta) {
                const dentro = noteDiParte.filter(x => x.tick >= ottavaAperta!.daTick - 1 && x.tick < tick - 1);
                if (dentro.length > 0) {
                  octaveShifts.push({
                    id: makeId(),
                    fromNoteId: dentro[0].id,
                    toNoteId: dentro[dentro.length - 1].id,
                    direction: ottavaAperta.direzione,
                  });
                }
                ottavaAperta = null;
              }
            } catch { /* direzione senza octave-shift */ }
          }
          continue;
        }
        if (tag !== 'note') continue;

        const noteEl = child;
        const isGrace = !!noteEl.querySelector('grace');
        if (isGrace) {
          // MVP: ignore grace notes (no stable spacing/playback contract).
          continue;
        }

        const isChord = !!noteEl.querySelector('chord');
        const startDiv = isChord && lastChordStartDiv != null ? lastChordStartDiv : curPosDiv;
        if (!isChord) lastChordStartDiv = startDiv;

        const durDiv = intOf(noteEl.querySelector('duration')) ?? 0;

        const voiceRaw = intOf(noteEl.querySelector('voice')) ?? 1;
        const staffRaw = intOf(noteEl.querySelector('staff')) ?? 1;
        const staff = (Number.isFinite(staffRaw) && staffRaw > 0) ? staffRaw : 1;
        // Solo le parti che finiscono nel corale decidono se il progetto è a grand staff.
        if (staff >= 2 && partIndex < MAX_SATB_PARTS) sawSecondStaff = true;

        const clef: ClefType = clefByStaff.get(staff) || (
          isSeparateSATB
            ? (partIndex >= 2 ? 'bass' : 'treble')
            : (staff === 2 ? 'bass' : (partIndex === 1 ? 'bass' : 'treble'))
        );

        const voice: 1 | 2 | 3 | 4 = (() => {
          if (isSeparateSATB) {
            // Each part → one voice: part 0=S(1), part 1=A(2), part 2=T(3), part 3=B(4)
            return Math.min(4, partIndex + 1) as 1 | 2 | 3 | 4;
          }
          // 1–2 parts: use staff+voice mapping (staff 1 → voices 1/2; staff 2 → voices 3/4)
          const v = Math.max(1, Math.min(4, Math.trunc(voiceRaw)));
          // If this is the second part and staff is still 1, offset to bass voices
          if (partIndex === 1 && staff === 1) return (v === 1 ? 3 : 4) as 1 | 2 | 3 | 4;
          if (staff === 2) return (v === 1 ? 3 : (v === 2 ? 4 : (v as any)));
          return (v as any);
        })();

        const isRest = !!noteEl.querySelector('rest');

        const pitchEl = noteEl.querySelector('pitch');
        const step = textOf(pitchEl?.querySelector('step'));
        const alter = intOf(pitchEl?.querySelector('alter')) ?? 0;
        // Il <pitch> del file è l'altezza che SUONA. Dentro un tratto d'ottava, quella
        // SCRITTA (l'unica che salviamo) sta un'ottava più in là: senza questa riga un
        // brano esportato e riletto saliva di un'ottava a ogni giro.
        const ottavaLetta = intOf(pitchEl?.querySelector('octave')) ?? 4;
        const octave = ottavaLetta - (ottavaAperta ? (ottavaAperta.direzione === 'up' ? 1 : -1) : 0);

        const letter = String(step || '').trim().toUpperCase();
        const basePc = NOTE_PC_BY_LETTER[letter];
        const basePos = NOTE_POSITION_BY_LETTER[letter];

        const midi = (!isRest && basePc != null)
          ? ((octave + 1) * 12 + basePc + alter)
          : 60;
        const noteIndex = ((midi % 12) + 12) % 12;
        const position = (!isRest && basePos != null)
          ? (basePos + (octave - 4) * 7)
          : 0;

        const typeRaw = textOf(noteEl.querySelector('type'));
        const parsedType = noteDurationFromType(typeRaw);
        const xmlDots = noteEl.querySelectorAll('dot').length;
        const hasTimeMod = !!noteEl.querySelector('time-modification');

        // Il playback somma i LABEL di durata per ricostruire gli onset, quindi il label deve
        // riflettere la durata reale (l'authority MusicXML per il timing è <duration>). Riconcilio:
        //  · terzine/duine (time-modification): tengo il label parsato — il playback applica il rapporto;
        //  · PAUSE (con o senza <type>) e note SENZA <type>: inferisco label + punto da <duration>,
        //    così una pausa di misura MuseScore (semibreve, senza <type>) non diventa una semiminima;
        //  · note normali con <type>: label invariato (comportamento storico).
        let duration: NoteDuration;
        let isDotted: boolean;
        if (hasTimeMod) {
          duration = parsedType || 'quarter';
          isDotted = xmlDots > 0;
        } else if (isRest || !parsedType) {
          const beats = (divisions > 0) ? (durDiv / divisions) : 1;
          const inf = inferDurationFromBeats(beats);
          duration = inf.duration;
          isDotted = inf.dotted;
        } else {
          duration = parsedType;
          isDotted = xmlDots > 0;
        }

        const tm = noteEl.querySelector('time-modification');
        const actualNotes = intOf(tm?.querySelector('actual-notes'));
        const normalNotes = intOf(tm?.querySelector('normal-notes'));
        const isTriplet = actualNotes === 3 && normalNotes === 2;
        const isDuplet = actualNotes === 2 && normalNotes === 3;

        const tieEls = Array.from(noteEl.querySelectorAll('tie'));
        const tieStarts = tieEls.some(t => String(t.getAttribute('type') || '').toLowerCase() === 'start');
        const tieStops = tieEls.some(t => String(t.getAttribute('type') || '').toLowerCase() === 'stop');

        const startBeats = (divisions > 0) ? (startDiv / divisions) : 0;
        const durationBeats = (divisions > 0) ? (durDiv / divisions) : 0;
        const startTick = measureStartTick + Math.round(startBeats * TICKS_PER_QUARTER);
        const durationTicks = Math.max(1, Math.round(durationBeats * TICKS_PER_QUARTER));

        // Alterazione EFFETTIVA (per l'altezza) e segno STAMPATO (per la grafia) sono
        // due cose diverse e vanno tenute separate:
        //  · `accidental` descrive l'altezza reale — serve all'app per non ricalcolare
        //    la nota dall'armatura e cambiarla (è così che il Si bequadro tornava bemolle);
        //  · `explicitAccidental`/`userAccidental` sono il SEGNO da disegnare, e si
        //    scrivono solo se il file lo stampa davvero. Se il file NON stampa nulla
        //    (il Si bemolle "di chiave" in Fa maggiore), lasciandoli vuoti l'app disegna
        //    secondo l'armatura, senza alterazioni ridondanti su ogni nota.
        const accidental = accidentalFromAlter(alter);
        const printedAccidental = accidentalFromPrinted(textOf(noteEl.querySelector('accidental')));

        const chordId = `mx-chord-${partIndex}-${measureIndex}-${startDiv}-${staff}-${voice}`;

        // Beat is measured in quarter-note units from the measure start.
        const beatInMeasure = Math.max(1, startBeats + 1);

        const staffNote: StaffNote = {
          id: makeId(),
          pitch: isRest ? 'C' : (letter || 'C'),
          octave,
          accidental: accidental ?? undefined,
          explicitAccidental: printedAccidental ?? undefined,
          userAccidental: printedAccidental ?? undefined,
          position,
          midi,
          noteIndex,
          duration,
          isRest,
          isDotted,
          isTriplet,
          isDuplet,
          isTiedToNext: tieStarts || undefined,
          isTiedFromPrev: tieStops || undefined,
          chordId,
          measureIndex,
          beat: beatInMeasure,
          startTick,
          durationTicks,
          clef,
          voice,
          // Le pause non suonano: la velocity resta solo sulle note.
          ...(isRest ? {} : { velocity: currentVelocity }),
          // Articolazioni scritte nel file: entrano come segni veri, disegnati e
          // modificabili, non come un accorciamento già cotto nella durata.
          ...(() => {
            if (isRest) return {};
            const arts = readNoteArticulations(noteEl);
            return arts.length > 0 ? { articulations: arts } : {};
          })(),
        };

        if (!isRest) noteDiParte.push({ id: staffNote.id, tick: startTick });

        // Capi di legatura: `start` mette in attesa l'id di questa nota, `stop` la chiude
        // sulla nota corrente. Il numero tiene distinte le legature sovrapposte.
        if (!isRest) {
          for (const capo of readNoteSlurEnds(noteEl)) {
            if (capo.tipo === 'start') {
              legatureAperte.set(capo.numero, staffNote.id);
            } else {
              const daId = legatureAperte.get(capo.numero);
              legatureAperte.delete(capo.numero);
              if (daId && daId !== staffNote.id) {
                slurs.push({ id: makeId(), fromNoteId: daId, toNoteId: staffNote.id });
              }
            }
          }
        }

        if (partIndex < MAX_SATB_PARTS) notes.push(staffNote);

        // Copia per la parte: stessa nota, ma numerata sulle voci del SUO rigo.
        if (staff >= 2) partSawSecondStaff = true;
        else if (partFirstClef == null) partFirstClef = clef;
        let staffVoices = localVoiceByStaff.get(staff);
        if (!staffVoices) { staffVoices = new Map(); localVoiceByStaff.set(staff, staffVoices); }
        let localVoice = staffVoices.get(voiceRaw);
        if (localVoice == null) {
          localVoice = (staffVoices.size === 0 ? 1 : 2) + (staff >= 2 ? 2 : 0) as 1 | 2 | 3 | 4;
          staffVoices.set(voiceRaw, localVoice);
        }
        partNotes.push({ ...staffNote, id: makeId(), voice: localVoice });

        if (!isChord) {
          curPosDiv += durDiv;
          // Stay within measure bounds if the file is slightly inconsistent.
          if (Number.isFinite(beatsPerMeasure) && beatsPerMeasure > 0) {
            const maxDiv = Math.round(beatsPerMeasure * divisions);
            if (maxDiv > 0) curPosDiv = Math.min(curPosDiv, maxDiv);
          }
        }
      }
    }

    // Una forcella senza il suo `stop` (file scritti male, o parte che finisce prima)
    // si chiude alla fine del brano invece di sparire.
    for (const aperta of openWedges.values()) {
      if (finePartAbsBeat > aperta.from) {
        partDynamics.push({ kind: 'hairpin', fromAbsBeat: aperta.from, toAbsBeat: finePartAbsBeat, direction: aperta.direction });
      }
    }
    for (const d of partDynamics) {
      const k = dynamicKey(d);
      if (dynSeen.has(k)) continue;
      dynSeen.add(k);
      dynamics.push(d);
    }

    partNotes.sort((a, b) => {
      const stA = Number((a as any).startTick ?? 0);
      const stB = Number((b as any).startTick ?? 0);
      if (stA !== stB) return stA - stB;
      if ((a.voice ?? 1) !== (b.voice ?? 1)) return (a.voice ?? 1) - (b.voice ?? 1);
      return (a.midi ?? 0) - (b.midi ?? 0);
    });
    const partId = String(part.getAttribute('id') || '').trim();
    partsOut.push({
      id: partId || `part-${partIndex + 1}`,
      name: (partId ? (partNameById.get(partId) || '') : '').trim(),
      notes: partNotes,
      hasSecondStaff: partSawSecondStaff,
      clef: partFirstClef || 'treble',
      ...(partId && partProgramById.has(partId) ? { instrumentId: partProgramById.get(partId) } : {}),
    });
  }

  const staffSystemMode: MusicXMLImportResult['staffSystemMode'] = (isSeparateSATB || satbPartCount >= 2 || sawSecondStaff)
    ? 'grandstaff'
    : 'treble_only';

  // Final normalization: stable sort by startTick/voice/midi.
  notes.sort((a, b) => {
    const stA = Number((a as any).startTick ?? 0);
    const stB = Number((b as any).startTick ?? 0);
    if (stA !== stB) return stA - stB;
    if ((a.voice ?? 1) !== (b.voice ?? 1)) return (a.voice ?? 1) - (b.voice ?? 1);
    return (a.midi ?? 0) - (b.midi ?? 0);
  });

  return {
    notes,
    timeSignature,
    timeSignatureChanges,
    keySignatureRoot,
    isMinorMode,
    staffSystemMode,
    projectTitle: title || undefined,
    parts: partsOut,
    slurs,
    octaveShifts,
    dynamics: dynamics.sort((a, b) => {
      const aa = a.kind === 'hairpin' ? a.fromAbsBeat : a.absBeat;
      const bb = b.kind === 'hairpin' ? b.fromAbsBeat : b.absBeat;
      return aa - bb;
    }),
  };
}
