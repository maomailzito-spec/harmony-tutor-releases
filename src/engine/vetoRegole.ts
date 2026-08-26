/**
 * IL VETO DELLE REGOLE — il generatore chiede al checker VERO, non a una sua copia.
 *
 * Il generatore aveva dentro di sé una versione semplificata delle regole (`countParallels`
 * e le penalità di `scoreVoicing`), mentre il checker dell'applicazione ne ha oltre quaranta
 * con le loro eccezioni. Due conti separati che rispondono alla stessa domanda finiscono
 * sempre per divergere.
 *
 * Qui si chiede al checker vero. Ma non su tutto, e non con il suo stesso metro.
 *
 * ── PRIMO TAGLIO: QUALI REGOLE ────────────────────────────────────────────────────────
 *
 * L'analisi guarda una partitura già scritta e deve DEDURRE: se un Fa è nota d'accordo o di
 * passaggio, se quell'accordo è un perno con due letture, se una falsa relazione è un errore
 * o una figura retorica. Sono deduzioni, e possono sbagliare — su semicrome fitte, su
 * passaggi tonicizzanti, sulle libertà che un autore si prende.
 *
 * Il generatore però è l'AUTORE. Non deve dedurre niente: sa che quel Fa è la settima perché
 * l'ha appena scritto come settima. Chiedere all'analisi «che cos'è questa nota?» vorrebbe
 * dire farsi giudicare da un'ipotesi sul proprio stesso lavoro.
 *
 * Quindi gli si chiede solo aritmetica su note appena scritte — parallele, intervalli
 * melodici, incroci, ambiti, raddoppi, risoluzioni — e non gli si chiede mai dov'è una
 * cadenza, se qui si modula, se una nota è ornamentale, quale lettura ha un accordo perno.
 * L'elenco è `REGOLE_DI_VETO` qui sotto.
 *
 * ── SECONDO TAGLIO: LA GRAVITÀ NON È IL METRO GIUSTO ──────────────────────────────────
 *
 * Il primo tentativo usava la gravità del checker come discriminante: errore = veto, avviso
 * = costo. Sembrava elegante — il checker distingue da sé, `R-16` esce come `warning` per la
 * sincope armonica e come `error` per l'intervallo proibito. **Misurato, non funziona.**
 *
 * Sull'esercizio n.5 p.45 del Dubois il generatore produceva 8 ottave nascoste (`R-05`) e 6
 * quinte nascoste (`R-14`) fra soprano e basso, dove l'originale d'autore ne ha ZERO. Escono
 * tutte come avvisi, e il veto le lasciava passare in blocco.
 *
 * Il motivo è che la gravità risponde a una domanda diversa dalla nostra. Il checker giudica
 * il brano di qualcuno: lì una quinta nascosta è un'osservazione di stile, e chiamarla
 * errore sarebbe presuntuoso. Il generatore invece sta scegliendo fra venti alternative
 * ugualmente disponibili, e per lui la domanda non è «quanto è grave» ma **«era evitabile»**.
 * Fra due strade che costano uguale, quella senza quinta nascosta è semplicemente migliore.
 *
 * Perciò il veto vale per tutta la famiglia meccanica, qualunque gravità. La gravità torna
 * utile solo dove una regola ha davvero DUE nature, e allora la si nomina: `R-16` si veta
 * come errore (intervallo melodico proibito) e si ignora come avviso (sincope armonica, che
 * riguarda il ritmo e non la condotta, e che su un frammento artificiale darebbe per giunta
 * responsi senza senso).
 *
 * ── TERZO TAGLIO: LA FINESTRA, E COSA SI GIUDICA DENTRO ───────────────────────────────
 *
 * Due accordi non bastano. `R-06` (salto di quarta eccedente o quinta diminuita) parla del
 * salto E della sua risoluzione: sono TRE note, e in una finestra da due il checker ne vede
 * due e tace. Sul Dubois i due errori residui erano esattamente questi, e il veto non li
 * aveva mai visti. Lo stesso vale per `R-17a`, che somma due salti consecutivi.
 *
 * La finestra è quindi di tre accordi. Ma allargarla crea un problema nuovo: le violazioni
 * che stanno tutte dentro i due accordi GIÀ SCRITTI sono acqua passata, non dipendono dal
 * candidato, e conterebbero contro ogni alternativa allo stesso modo — bloccando tutto senza
 * distinguere niente. Perciò si contano solo le violazioni che TOCCANO l'accordo in esame.
 *
 * COSTO MISURATO: ~1,5 ms a controllo. L'accordo in carica si controlla sempre; le
 * alternative si pagano solo quando il veto scatta davvero.
 */
import type { StaffNote, KeySignature } from '../types';
import { applyHarmonyRules } from '../utils/musicTheory';

/**
 * Le regole che il generatore può usare come VETO: aritmetica su note che ha appena scritto,
 * senza nessuna interpretazione di mezzo.
 *
 * Tenute fuori di proposito: le cadenze (`CAD-*`), la falsa relazione cromatica (`R-09`, che
 * ha eccezioni retoriche legittime), l'accordo incompleto (`R-CHORD-COMPLETE`, che è una
 * scelta), le preferenze di raddoppio in stato fondamentale e primo rivolto (`R-10-6`,
 * `R-10-3RD`, che sono gusto), e tutte le `EXC-*`, che non sono violazioni ma il contrario.
 *
 * `R-CHORD-COMPLETE` era anche lui in quel gruppo, come «è una scelta». Non lo è: la regola
 * guarda quali note dell'accordo mancano e segnala il TERZO assente, che non è un'omissione
 * lecita — la quinta si omette, la terza no, altrimenti l'accordo non ha modo. È aritmetica
 * sulle note scritte, esattamente come le altre di questa famiglia. È entrato quando gli
 * accordi incompleti sono diventati il primo addebito del generatore (61 in eccesso sui 75
 * brani): metterlo nel veto ha tolto 10 errori e 76 avvisi.
 *
 * `R-10-3RD` invece è rimasta fuori, e stavolta la classificazione era giusta: portarla nel
 * veto toglie 52 avvisi ma AGGIUNGE 19 errori, perché a volte raddoppiare la terza è il male
 * minore — la si raddoppia per non fare parallele. È una preferenza per davvero.
 *
 * `R-10-64` era in quel gruppo ed è stato SPOSTATO QUI. Era un errore di classificazione mio:
 * in un accordo di quarta e sesta la quarta sul basso non è una nota qualunque, è la
 * dissonanza dell'accordo, e raddoppiare una dissonanza non è una preferenza — è un errore.
 * La regola infatti non interpreta niente, conta solo quale nota risulta raddoppiata.
 * Segnalato dall'utente su un 4/6 uscito col Do raddoppiato invece del basso.
 */
export const REGOLE_DI_VETO = new Set<string>([
  'R-01',        // quinte e ottave parallele
  'R-04',        // incrocio di voci
  'R-05',        // ottava nascosta
  'R-06',        // salto eccedente o diminuito non risolto
  'R-07',        // risoluzione della sensibile
  'R-08',        // spaziatura eccessiva
  'R-10',        // sensibile raddoppiata
  'R-10-DIM5',   // quinta diminuita raddoppiata
  'R-10-7TH',    // settima raddoppiata
  'R-10-64',     // raddoppio sbagliato in quarta e sesta (vedi sotto)
  'R-CHORD-COMPLETE',  // accordo incompleto (vedi sotto)
  'R-12',        // risoluzione della settima
  'R-13',        // moto retto di tutte e quattro le voci
  'R-14',        // quinta nascosta
  'R-17a',       // due salti nella stessa direzione che sommano una settima o una nona
  'R-17c',       // tritono melodico
  'R-18',        // scontro cromatico simultaneo
]);

/**
 * Le regole che hanno DUE nature e si vetano soltanto nella loro forma di errore.
 * `R-16` è l'unica finora: `error` = intervallo melodico proibito (aritmetica, si veta),
 * `warning` = sincope armonica (ritmo e notazione, non condotta delle voci).
 */
const SOLO_COME_ERRORE = new Set<string>(['R-16']);

export type EsitoVeto = {
  /** Quante regole di veto tocca l'accordo in esame. Zero = la strada è libera. */
  quante: number;
  /** Di quelle, quante il checker le chiama ERRORI. */
  errori: number;
  /** E quante AVVISI. */
  avvisi: number;
  /** Quali, per poterlo dire a chi guarda (diagnostica, non logica). */
  regole: string[];
};

const NIENTE: EsitoVeto = { quante: 0, errori: 0, avvisi: 0, regole: [] };

/**
 * Fra due strade tutt'e due imperfette, quale è meno peggio.
 *
 * Contare le violazioni e basta è sbagliato, e si è visto subito: sull'esercizio del Dubois
 * il veto respingeva un accordo per DUE quinte nascoste, e accettava al suo posto un accordo
 * con UN salto di settima al basso — uno invece di due, quindi «meglio». È un pessimo
 * affare: le quinte nascoste fra le voci estreme sono un difetto di stile, la settima al
 * basso è un errore che nessuno scriverebbe.
 *
 * La gravità del checker, che come cancello non serviva, come ORDINE serve: prima si
 * confrontano gli errori, e solo a parità gli avvisi. Un errore in più non si compra mai
 * con un numero qualsiasi di avvisi in meno.
 *
 * @returns negativo se `a` è preferibile, positivo se lo è `b`, zero se pari.
 */
export function confronta(a: EsitoVeto, b: EsitoVeto): number {
  return a.errori !== b.errori ? a.errori - b.errori : a.avvisi - b.avvisi;
}

/**
 * Interroga il checker sulla finestra e riporta le sole violazioni di veto che toccano
 * l'accordo in esame.
 *
 * Le note arrivano già costruite da `voicingToStaffNotes`, con la GRAFIA giusta — che qui
 * non è un dettaglio: `R-18` parla di scontri cromatici e `R-06` di quarte eccedenti, e un
 * Sol♯ scritto La♭ cambia la risposta a tutt'e due. Chi chiama le colloca su movimenti
 * forti consecutivi: al checker serve sapere che gli accordi si susseguono, non in che punto
 * del brano si trovino.
 *
 * @param passato  gli accordi già scritti, dal più lontano al più vicino (0, 1 o 2)
 * @param inEsame  l'accordo candidato, l'unico su cui si emette il giudizio
 */
export function veto(
  passato: StaffNote[][],
  inEsame: StaffNote[],
  keySignature: KeySignature,
  tonica: string,
  minore: boolean,
): EsitoVeto {
  if (!inEsame.length) return NIENTE;

  const frammento: StaffNote[] = [];
  for (const acc of passato) frammento.push(...acc);
  frammento.push(...inEsame);

  const idsInEsame = new Set(inEsame.map(n => n.id));

  try {
    const res = applyHarmonyRules(
      frammento, keySignature, tonica, minore, [],
      { numerator: 4, denominator: 4 } as any, [], [], [], { partCount: 4 },
    );
    const regole: string[] = [];
    let errori = 0, avvisi = 0;
    for (const v of (res?.violations ?? []) as any[]) {
      const id = String(v?.ruleId ?? '');
      if (!REGOLE_DI_VETO.has(id) && !SOLO_COME_ERRORE.has(id)) continue;
      if (SOLO_COME_ERRORE.has(id) && v?.severity !== 'error') continue;
      // Solo ciò che TOCCA l'accordo in esame: il resto è già scritto e conterebbe uguale
      // contro ogni alternativa, cioè non distinguerebbe niente.
      const ids: string[] = Array.isArray(v?.noteIds) ? v.noteIds : [];
      if (!ids.some(x => idsInEsame.has(x))) continue;
      regole.push(id);
      if (v?.severity === 'error') errori++; else avvisi++;
    }
    return regole.length ? { quante: regole.length, errori, avvisi, regole } : NIENTE;
  } catch {
    // Un checker che non risponde non deve impedire di generare: senza veto si torna al
    // comportamento di prima, che è imperfetto ma esiste.
    return NIENTE;
  }
}
