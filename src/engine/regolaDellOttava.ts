/**
 * LA REGOLA DELL'OTTAVA.
 *
 * La formula settecentesca che assegna un'armonia standard a ciascun grado
 * della scala AL BASSO, salendo e scendendo. Serviva a realizzare il continuo
 * senza cifratura, ed e' la base della tradizione dei partimenti.
 *
 * PERCHE' QUI. Dove il basso procede per grado congiunto — la maggioranza dei
 * bassi di scuola — da' l'armonizzazione idiomatica di riferimento. E non
 * chiede corpus ne' statistiche: sono due tavole per modo, ascendente e
 * discendente. E' il contrario del lavoro sui brani d'autore, e agisce proprio
 * dove il generatore produce soluzioni corrette ma poco stilistiche.
 *
 * IL PRINCIPIO. I gradi stabili — I, IV, V — prendono lo stato fondamentale; i
 * gradi di passaggio del basso prendono i rivolti. Il repertorio di accordi e'
 * strettissimo: quasi tutto e' I, IV e V che si alternano sotto un basso che
 * cammina.
 *
 * LA FORMULAZIONE E' UNA SCELTA, e va dichiarata. La regola dell'ottava non e'
 * una sola: Fenaroli, Durante e i trattatisti francesi danno cifre diverse
 * sugli stessi gradi — non sono errori, sono tradizioni. Qui si adotta la
 * versione CON LE TRIADI della tavola italiana, quella coerente col repertorio
 * di scuola dell'applicazione. In quella versione le due direzioni coincidono.
 *
 * LA DIREZIONE HA COMUNQUE IL SUO POSTO nella tavola, perche' nella versione
 * CON LE SETTIME non coincidono: il sesto grado che SALE al settimo prende un
 * semplice 6 di passaggio, quello che SCENDE al quinto prende il 6/4+ (V4/3 di
 * V), perche' li' serve preparare la dominante. Quando si adottera' anche
 * quella, si riempie l'altra colonna senza toccare chi la legge.
 *
 * IL MODO MINORE non cambia i GRADI: cambia le note del basso — sale con sesto
 * e settimo alzati, scende con entrambi naturali — e quelle sono un dato, non
 * una scelta. Il V resta sempre maggiore in tutte e due le direzioni: la
 * sensibile non si abbassa mai.
 *
 * ══ STATO: la tavola e' BUONA, ma non serve come preferenza del generatore.
 *
 * Misurata sul repertorio (`scripts/gli-autori-seguono-la-regola.ts`), con le
 * correzioni dell'utente sui gradi dove le armonie idiomatiche sono piu' d'una,
 * coincide col 61% delle armonie d'autore dove il basso cammina per grado:
 *
 *     4°  IV | ii6            78%      ← il piu' saldo
 *     1°  I                   66%
 *     6°  IV6 | vi            66%
 *     7°  V6 | vii°           61%
 *     5°  V                   60%
 *     3°  I6                  49%      gli autori scrivono anche `iii` (128)
 *     2°  V6/4 | vii°6        35%      gli autori scrivono `ii` (200)
 *
 * PROVATA COME PREFERENZA NEL GENERATORE, e annullata: col basso dato porta gli
 * errori da 65 a 67 (peso 2), 72 (peso 4), 73 (peso 8). Al 61% d'accordo,
 * quattro volte su dieci spinge dalla parte sbagliata, e li' combatte contro il
 * vincolo di melodia e la condotta delle voci. Il repertorio dell'applicazione
 * — corali e bassi di scuola — non e' partimento, e i gradi dove la regola cede
 * (2° e 3°) sono proprio quelli dove il corale fa di suo (`ii`, `iii`).
 *
 * DOVE INVECE SERVE, ed e' il beneficio che l'utente aveva previsto: come
 * OSSERVAZIONE dell'analizzatore. Quando la realizzazione si discosta dalla
 * regola, e' una cosa da dire — «corretto, ma il passaggio idiomatico su questo
 * grado sarebbe il 6». Li' non c'e' niente da peggiorare: si aggiunge un
 * commento didattico che dal pentagramma non si legge, e il 61% e' una base
 * onesta per OSSERVARE, non per imporre.
 *
 * LIMITI, dichiarati. Copre i soli movimenti per GRADO CONGIUNTO: sui salti non
 * dice niente, e i salti sono i punti in cui l'armonizzazione e' piu' libera.
 * E non dice niente sulle note estranee: da' l'accordo giusto, non la
 * figurazione che lo rende musicale invece che a blocchi.
 */

/** Un'armonia della tavola: grado (0 = I) e rivolto (0 fondamentale, 1 primo,
 *  2 secondo, 3 terzo). La settima non e' un campo: la decide `shouldUseSeventh`,
 *  e la stessa casella copre percio' `V6/4` e `V4/3`, che come POSA sono lo
 *  stesso accordo nello stesso rivolto. */
export type ArmoniaAttesa = { grado: number; rivolto: number };

/**
 * NON UN'ARMONIA PER GRADO, MA UN INSIEME.
 *
 * La prima versione dava una risposta sola per grado e coincideva col 45% del
 * repertorio. L'utente ha spiegato perche': su piu' gradi le armonie idiomatiche
 * sono PIU' D'UNA, e la scelta e' di stile.
 *
 *   4°  salendo `ii6`, scendendo `V4/2`      ← qui la direzione decide davvero
 *   7°  vanno bene sia `V6` sia `vii°`
 *   6°  la regola dice `IV6`, ma non si puo' escludere `vi`
 *   2°  le tre formulazioni sono tutte accettabili, dipende dallo stile
 *
 * Per un sistema di PREFERENZE l'insieme e' anche piu' adatto di una risposta
 * sola: si premia tutto cio' che e' idiomatico, senza scegliere al posto di chi
 * scrive fra due opzioni entrambe buone.
 */
const I      = { grado: 0, rivolto: 0 };
const I6     = { grado: 0, rivolto: 1 };
const ii6    = { grado: 1, rivolto: 1 };
const IV     = { grado: 3, rivolto: 0 };
const IV6    = { grado: 3, rivolto: 1 };
const V      = { grado: 4, rivolto: 0 };
const V6     = { grado: 4, rivolto: 1 };
const V64    = { grado: 4, rivolto: 2 };   // e `V4/3`: stessa posa
const V42    = { grado: 4, rivolto: 3 };
const vi     = { grado: 5, rivolto: 0 };
const vii    = { grado: 6, rivolto: 0 };
const vii6   = { grado: 6, rivolto: 1 };   // e `vii°6/5`

/** Salendo, per grado del basso (0 = tonica … 6 = settimo). */
const SALENDO: ArmoniaAttesa[][] = [
  [I],                 // 1°  il grado piu' stabile
  [V64, vii6],         // 2°  le tre formulazioni: V6/4, V4/3 (stessa posa), vii°6/5
  [I6],                // 3°  la tonica in primo rivolto
  [IV, ii6],           // 4°  la triade da' `IV`; con le settime, salendo, `ii6`
  [V],                 // 5°  stabile
  [IV6, vi],           // 6°  la regola dice IV6; il vi non si esclude
  [V6, vii],           // 7°  vanno bene tutt'e due
];

/** Scendendo. Cambia il 4°, ed e' il caso che mostra perche' la direzione conta:
 *  in discesa il quarto grado prende il `V4/2`, che prepara il I6. */
const SCENDENDO: ArmoniaAttesa[][] = [
  [I],
  [V64, vii6],
  [I6],
  [IV, V42],           // 4°  scendendo la versione con le settime da' `V4/2`
  [V],
  [IV6, vi],
  [V6, vii],
];

/**
 * Le armonie che la regola dell'ottava considera idiomatiche sotto questo grado
 * del basso, andando in quella direzione.
 *
 * @param gradoDelBasso  0 = tonica … 6 = settimo grado.
 * @param sale  il basso procede verso l'alto.
 * @returns lista vuota dove la tavola non dice niente.
 */
export function armonieDellaRegola(gradoDelBasso: number, sale: boolean): ArmoniaAttesa[] {
  if (!Number.isFinite(gradoDelBasso) || gradoDelBasso < 0 || gradoDelBasso > 6) return [];
  return (sale ? SALENDO : SCENDENDO)[gradoDelBasso] ?? [];
}

/** Comodita': la prima delle idiomatiche, per chi ne vuole una sola. */
export function armoniaDellaRegola(gradoDelBasso: number, sale: boolean): ArmoniaAttesa | null {
  return armonieDellaRegola(gradoDelBasso, sale)[0] ?? null;
}
