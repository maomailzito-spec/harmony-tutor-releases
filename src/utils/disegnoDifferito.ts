/**
 * I SISTEMI CHE NON SI VEDONO SI DISEGNANO DOPO — e l'elenco di chi è rimasto indietro.
 *
 * Incidere un sistema costa: su un brano a tredici tracce sono ~190 ms, quasi tutti spesi
 * a disegnare le note delle parti (misurato con `__htCosti()`). Finché si disegnavano
 * TUTTI i sistemi a ogni modifica, scrivere una nota costava mezzo secondo abbondante e il
 * conto cresceva con la lunghezza del brano. Ma di sistemi se ne vedono due o tre per
 * volta: gli altri si possono disegnare quando servono, o quando c'è tempo.
 *
 * IL PUNTO DELICATO NON È LA VELOCITÀ, È LA STAMPA. Stampa, PDF e PNG non ridisegnano
 * niente: CLONANO il disegno vivo (`cloneNode` compare una volta sola in tutto il
 * programma, in `buildExportHtml`). Un sistema mai disegnato uscirebbe BIANCO sulla
 * carta — cioè avremmo scambiato una lentezza con un difetto molto peggiore, e per giunta
 * di quelli che si scoprono dal cliente.
 *
 * Perciò l'elenco qui sotto non è un'ottimizzazione: è la RETE. Ogni sistema che rimanda
 * il proprio disegno si iscrive; chi sta per clonare il DOM chiama `disegnaTuttoOra()`, che
 * salda i debiti **in modo sincrono** — quando ritorna, sulla pagina c'è tutto. Niente
 * attese di fotogrammi, niente effetti di React da aspettare: il clone parte a conti
 * chiusi. È l'unico modo per cui la garanzia si legge in una riga sola invece di dipendere
 * dall'ordine con cui React esegue le cose.
 */

type Debito = () => void;

const debiti = new Map<symbol, Debito>();

/** Contatori di VITA, non istantanei. La fotografia «quanti debiti ci sono adesso» dice
 *  quasi sempre zero — non perché il meccanismo non lavori, ma perché ha già finito — e
 *  uno zero che significa «tutto a posto» e uno che significa «non ho guardato niente» si
 *  scrivono uguali. Questi invece si accumulano, quindi testimoniano che il differimento
 *  è successo davvero anche quando è già stato riassorbito. */
export const conti = { differiti: 0, saldatiDallaGuardia: 0, recuperatiInPausa: 0 };

/** Un sistema dichiara di aver RIMANDATO il proprio disegno. */
export function rimandaDisegno(chiave: symbol, disegna: Debito): void {
  if (!debiti.has(chiave)) conti.differiti++;
  debiti.set(chiave, disegna);
}

/** Un sistema in arretrato si e' disegnato da solo, in una pausa. */
export function segnaRecuperoInPausa(): void {
  conti.recuperatiInPausa++;
}

/** Un sistema ha disegnato (o se ne va): non deve più niente. */
export function debitoSaldato(chiave: symbol): void {
  debiti.delete(chiave);
}

/**
 * Salda TUTTI i debiti, subito e in modo sincrono. Da chiamare prima di qualunque cosa
 * legga il disegno dal DOM — stampa, PDF, PNG.
 *
 * @returns quanti sistemi sono stati disegnati (0 = era già tutto pronto).
 */
export function disegnaTuttoOra(): number {
  // Si lavora su una COPIA: ogni disegno cancella il proprio debito dalla mappa, e
  // modificarla mentre la si percorre lascerebbe indietro qualcuno — cioè un rigo bianco.
  const daFare = Array.from(debiti.values());
  debiti.clear();
  conti.saldatiDallaGuardia += daFare.length;
  for (const disegna of daFare) {
    try {
      disegna();
    } catch {
      // Un sistema che non si disegna non deve impedire agli altri di farlo: meglio una
      // stampa con un rigo mancante che una stampa che non parte.
    }
  }
  return daFare.length;
}

/** Quanti sistemi sono in arretrato (diagnostica). */
export function quantiInArretrato(): number {
  return debiti.size;
}
