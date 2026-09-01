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

/**
 * Quali note NON fanno parte dell'accordo. La lista è la stessa di `structuralNotes`, che è
 * la funzione con cui il resto del programma decide la stessa cosa: riscriverla qui aveva
 * già prodotto una divergenza.
 *
 * IL RITARDO NON C'È, ed è la correzione: un ritardo non è una nota da togliere, è una nota
 * che RITARDA una nota dell'accordo. Togliendolo l'accordo resta monco — sulla «Cantata
 * 147», a misura 10, il Re di ritardo veniva scartato e da La+Fa# soli il motore leggeva
 * `F#m` invece del `Re maggiore` che c'è scritto.
 */
const categoriaOrnamento = (n: any): string | null => {
  if (n?.ornamentOverride && n.ornamentOverride !== 'structural') return String(n.ornamentOverride);
  if (n?.isPassing) return 'passing';
  if (n?.isNeighbor) return 'neighbor';
  if (n?.isAppoggiatura) return 'appoggiatura';
  if (n?.isAnticipation) return 'anticipation';
  if (n?.isEscape) return 'escape';
  if (n?.isCambiata) return 'cambiata';
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
  // Con meno di TRE note l'identificazione è un indovinello: due note non fanno un accordo,
  // e il motore risponderebbe comunque qualcosa. Meglio identificare su tutto ciò che suona.
  const perIdentificare = dellAccordo.length >= 3 ? dellAccordo : vive;

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

// ─────────────────────────────────────────────────────────────────────────────
// LE RELAZIONI
//
// La funzione di un accordo non è una proprietà dell'accordo: dipende da dove va. Lo stesso
// `V7` è «in attesa» finché non si scrive l'accordo dopo, e diventa «risolve d'inganno sul
// vi» appena lo si scrive. Per questo non si scrive una descrizione per accordo ma una
// frase per RELAZIONE, e le famiglie di relazione sono poche.
//
// Che cosa NON entra qui, per decisione dell'utente:
//
//   * le funzioni (tonica, sottodominante, dominante) non compaiono nel testo. Sono già
//     leggibili dal numero romano, e dirle violerebbe la regola di taglio: servono al
//     motore per riconoscere la relazione, non al lettore;
//   * le CADENZE non sono relazioni. `V→I` a metà frase è una risoluzione; diventa cadenza
//     solo in posizione conclusiva. Sono uno strato a parte, e richiedono un criterio di
//     posizione che questo repertorio non scrive (zero corone su 84 brani di scuola).
//
// LE FRASI SONO SCRITTE DAL PUNTO DI VISTA DELL'ARRIVO, cioè di dove sta il cursore quando
// si chiede «cosa sto facendo qui». La prima stesura le scriveva dalla partenza, e sotto un
// `V` compariva «prepara la dominante» — che parlava del `ii` precedente e sembrava dire una
// sciocchezza sul `V` stesso.
//
// E le frasi dicono l'OBBLIGO, non il fatto: «la sensibile sale alla tonica» è ciò che deve
// accadere. Se non accade lo dice il checker, che quella verifica la fa già — e dirlo qui
// senza controllare vorrebbe dire affermare cose non verificate.

export type Famiglia =
  | 'stessoAccordoAltroRivolto' | 'accordoRibattuto'
  | 'risoluzioneDominante' | 'risoluzioneInganno' | 'diminuitaRisolta'
  | 'tonicizzazioneRisolta' | 'tonicizzazioneNonRisolta'
  | 'preparazioneDominante' | 'quinteDiscendenti' | 'gradoAscendente'
  | 'giustapposizione';

const GRADI: Record<string, number> = {
  I: 0, i: 0, II: 1, ii: 1, 'ii°': 1, iio: 1, III: 2, iii: 2, IV: 3, iv: 3,
  V: 4, v: 4, VI: 5, vi: 5, VII: 6, vii: 6, 'vii°': 6, viio: 6,
};

/** Il grado, spogliato di cifre e bersaglio: `V7/ii` → `V`. */
export function gradoDi(roman: string): string {
  return String(roman || '').split('/')[0].replace(/[0-9]+$/, '').replace(/6\/4|6\/5|4\/3|4\/2/g, '').trim();
}

/**
 * La relazione fra due accordi consecutivi. `null` per il primo accordo, che un «prima»
 * non ce l'ha — e non si parla di ciò che non c'è.
 */
export function relazioneFra(
  precedente: { roman: string | null; bassoPc: number | null } | null,
  corrente: { roman: string | null; bassoPc: number | null },
): Famiglia | null {
  if (!precedente?.roman || !corrente.roman) return null;
  const ra = precedente.roman, rb = corrente.roman;
  const ga = gradoDi(ra), gb = gradoDi(rb);
  if (!ga || !gb) return null;

  // Prima di tutto: è ancora lo stesso accordo? È il caso più frequente del repertorio —
  // quasi una coppia su cinque — e non è una relazione armonica. Riconoscerlo per primo
  // evita che finisca dentro un'altra famiglia a produrre una frase falsa.
  if (ga === gb && !ra.includes('/') && !rb.includes('/')) {
    return precedente.bassoPc !== corrente.bassoPc ? 'stessoAccordoAltroRivolto' : 'accordoRibattuto';
  }
  if (ra.includes('/')) {
    return gradoDi(ra.split('/')[1]) === gb ? 'tonicizzazioneRisolta' : 'tonicizzazioneNonRisolta';
  }
  // Un accordo che PROMETTE un altro grado (`V/vi`) non è la dominante di casa: leggerlo
  // come tale faceva comparire «la dominante arriva preparata» sotto un `V/vi`, che parla
  // di tutt'altra dominante. `gradoDi` toglie il bersaglio, quindi il controllo va fatto
  // sulla sigla intera.
  if (rb.includes('/')) return 'giustapposizione';
  const ia = GRADI[ga], ib = GRADI[gb];
  if (ia == null || ib == null) return 'giustapposizione';
  // LA MAIUSCOLA CONTA. Le frasi della dominante parlano della SENSIBILE, e la sensibile
  // c'è solo nella dominante MAGGIORE: in minore naturale il quinto grado è `v`, e non ne
  // ha. Trattando `v` come `V` — che nella tabella dei gradi finiscono nello stesso indice —
  // sul «Corale Schinelli» compariva «la sensibile sale comunque alla tonica» sotto un
  // `Bm → C`, dove di sensibile non ce n'è nessuna. Affermare una nota che non esiste è
  // il difetto peggiore che questo testo possa avere.
  const dominanteVera = ga === 'V';
  const diminuitaVera = ga.includes('°') || ga.includes('o');
  if (dominanteVera && ib === 0) return 'risoluzioneDominante';
  if (dominanteVera && ib === 5) return 'risoluzioneInganno';
  if (ia === 6 && diminuitaVera && ib === 0) return 'diminuitaRisolta';
  if ((ia === 1 || ia === 3) && ib === 4) return 'preparazioneDominante';
  // IL VERSO. La quinta DISCENDENTE porta la fondamentale in giù di una quinta — `vi→ii`,
  // `ii→V`, `V→I` — che in gradi è un salto di +3. Scritta al contrario, la regola marcava
  // `I→V` (che è una quinta ASCENDENTE) come progressione discendente: sul «Dubois prova»
  // compariva sei volte su undici battute, e sempre sull'accordo sbagliato.
  if (((ib - ia + 7) % 7) === 3) return 'quinteDiscendenti';
  if (((ib - ia + 7) % 7) === 1) return 'gradoAscendente';
  return 'giustapposizione';
}

/** La chiave di traduzione della frase, o `null` se quella famiglia non merita parole. */
export function fraseDiRelazione(f: Famiglia | null): string | null {
  if (!f) return null;
  // MISURATO guardando il testo su un corale: «stesso accordo ribattuto» compariva tre
  // volte su quattordici accordi e non aggiungeva niente — vedere due volte di fila la
  // stessa sigla lo mostra già. Il cambio di RIVOLTO invece informa: dice che si è mosso il
  // basso e non l'armonia, che dalla sigla non si legge. La famiglia si è divisa in due
  // provandola, non decidendola a tavolino.
  if (f === 'giustapposizione' || f === 'accordoRibattuto') return null;
  return `rel_${f}`;
}
