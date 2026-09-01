/**
 * IL RECORD DELLA SPIEGAZIONE.
 *
 * Raccoglie, per un accordo scelto, tutto ciò che il motore ha GIÀ deciso e che oggi non
 * pubblica. Non aggiunge niente: se qui comparisse un giudizio che l'analisi non ha
 * espresso, il testo che ne nasce sarebbe un commento esterno — cioè il difetto che
 * abbiamo visto altrove, dove la descrizione si mette a interpretare lo spartito invece di
 * raccontare l'analisi.
 *
 * Da qui nasceranno tre frasi al massimo:
 *
 *   IDENTIFICAZIONE   dipende solo dalle note: che accordo è e come si cifra
 *   EVIDENZA          la nota che DECIDE fra questa lettura e la seconda — esiste solo
 *                     quando una seconda c'è davvero
 *   FUNZIONE          dipende dalla coppia con l'accordo seguente, e quindi cambia mentre
 *                     si scrive (qui non c'è ancora: serve il vicino)
 *
 * Due regole di taglio, che valgono già in questo record: niente che si legga di per sé
 * dall'etichetta, e MAI parlare di ciò che non c'è. Se l'accordo non ha una seconda lettura
 * il campo `evidenza` è nullo — non «nessuna alternativa trovata».
 */
import type { StaffNote } from '../types';
import { identifyChordCandidates, getRomanAnalysis, getChordSymbol, getKeySignature } from '../utils/musicTheory';

/** Un termine del punteggio, col nome che il motore gli dà. */
export type Motivo = { nome: string; delta: number };

export type Lettura = {
  /** Come la scriverebbe l'analisi: `Dm7`, `G7`… */
  sigla: string;
  matchType: string;
  punteggio: number;
  motivi: Motivo[];
};

export type SpiegazioneAccordo = {
  /** Il numero romano e le cifre, come già li produce l'analisi. */
  roman: string | null;
  figure: string[];
  /** La lettura scelta, e la seconda classificata se ce n'è una. */
  scelta: Lettura | null;
  seconda: Lettura | null;
  /**
   * IL MOTIVO CHE DECIDE: il termine di punteggio col divario maggiore fra le due letture.
   * `null` quando non c'è una seconda lettura, oppure quando il divario nasce solo da
   * «accordo più comune» — che non è una ragione da dire a uno studente: sul corpus
   * riguarda il 4% degli accordi, e lì il testo si limita a identificare.
   */
  evidenza: { motivo: string; scarto: number } | null;
  /** Le note dell'accordo, e quelle che l'analisi ha giudicato ornamentali. */
  noteAccordo: StaffNote[];
  noteEstranee: { nota: StaffNote; categoria: string }[];
  /** La nota che sta al basso. */
  basso: StaffNote | null;
};

/** I motivi che NON si dicono: sono veri, ma non insegnano niente. */
const MOTIVI_MUTI = new Set(['accordo piu\' comune']);

const categoriaOrnamento = (n: any): string | null => {
  if (n?.ornamentOverride && n.ornamentOverride !== 'structural') return String(n.ornamentOverride);
  if (n?.isPassing) return 'passing';
  if (n?.isNeighbor) return 'neighbor';
  if (n?.isAppoggiatura) return 'appoggiatura';
  if (n?.isAnticipation) return 'anticipation';
  if (n?.isEscape) return 'escape';
  if (n?.isCambiata) return 'cambiata';
  if (n?.isSuspension) return 'suspension';
  return null;
};

/** L'alterazione della radice arriva come NUMERO (0 = naturale): va scritta come segno. */
const segno = (alt: any): string => {
  const n = Number(alt);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? '#'.repeat(Math.min(n, 2)) : 'b'.repeat(Math.min(-n, 2));
};

// La SIGLA la scrive `getChordSymbol`, che è la stessa che l'utente vede sullo spartito:
// costruirsene una qui darebbe due nomi diversi per lo stesso accordo — e uno dei due
// sbagliato (la lettera senza alterazione: «B» per un accordo di Si bemolle).
const comeLettura = (c: any, sigla: string | null): Lettura => ({
  sigla: sigla ?? `${c?.rootSpelled?.letter ?? '?'}${segno(c?.rootSpelled?.accidental)} ${c?.type ?? ''}`.trim(),
  matchType: String(c?.matchType ?? ''),
  punteggio: Number(c?.score ?? 0),
  motivi: Array.isArray(c?.motivi) ? c.motivi : [],
});

export function spiegaAccordo(
  note: StaffNote[],
  keyTonic: string,
  isMinorMode: boolean,
): SpiegazioneAccordo | null {
  const vive = (note || []).filter(n => n && !(n as any).isRest);
  if (vive.length < 2) return null;

  // Le note che l'analisi considera ornamentali non fanno parte dell'accordo: è la stessa
  // distinzione che usa il resto del programma, non una nuova.
  const estranee: { nota: StaffNote; categoria: string }[] = [];
  const dellAccordo: StaffNote[] = [];
  for (const n of vive) {
    const cat = categoriaOrnamento(n);
    if (cat) estranee.push({ nota: n, categoria: cat });
    else dellAccordo.push(n);
  }
  const perIdentificare = dellAccordo.length >= 2 ? dellAccordo : vive;

  let candidati: any[] = [];
  try { candidati = (identifyChordCandidates(perIdentificare as any) as any[]) || []; } catch { /* ignora */ }
  let siglaScelta: string | null = null;
  try {
    siglaScelta = getChordSymbol(perIdentificare as any, getKeySignature(keyTonic, isMinorMode ? 'Minor' : 'Major') as any, keyTonic);
  } catch { /* ignora */ }
  const scelta = candidati[0] ? comeLettura(candidati[0], siglaScelta) : null;
  // La SECONDA lettura non ha una sigla propria: `getChordSymbol` risponde su note, non su
  // un candidato. Si compone dalla radice scritta e dal tipo — basta a nominarla.
  const seconda = candidati[1] && candidati[1].score !== candidati[0]?.score ? comeLettura(candidati[1], null) : null;

  // Il motivo che decide: il termine col divario maggiore. Se è uno di quelli muti, non si
  // dichiara nessuna evidenza — meglio una frase in meno che una frase vuota.
  let evidenza: { motivo: string; scarto: number } | null = null;
  if (scelta && seconda) {
    const mappa = (l: Lettura) => new Map(l.motivi.map(m => [m.nome, m.delta]));
    const a = mappa(scelta), b = mappa(seconda);
    let nome = '', scarto = 0;
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const d = (a.get(k) ?? 0) - (b.get(k) ?? 0);
      if (Math.abs(d) > Math.abs(scarto)) { scarto = d; nome = k; }
    }
    if (nome && !MOTIVI_MUTI.has(nome)) evidenza = { motivo: nome, scarto };
  }

  let roman: string | null = null;
  let figure: string[] = [];
  try {
    const r = getRomanAnalysis(perIdentificare as any, keyTonic, isMinorMode);
    if (r?.roman && r.roman !== '?') { roman = r.roman; figure = r.figures || []; }
  } catch { /* ignora */ }

  const basso = dellAccordo.length
    ? dellAccordo.slice().sort((x: any, y: any) => Number(x.midi) - Number(y.midi))[0]
    : null;

  return { roman, figure, scelta, seconda, evidenza, noteAccordo: dellAccordo, noteEstranee: estranee, basso };
}
