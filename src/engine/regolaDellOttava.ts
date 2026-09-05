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
 * ══ STATO: LA TAVOLA NON E' ANCORA GIUSTA, e non e' collegata al generatore.
 *
 * Messa alla prova sul repertorio (`scripts/gli-autori-seguono-la-regola.ts`),
 * questa versione con le triadi coincide col 45% delle armonie d'autore dove il
 * basso cammina per grado — e collegarla come preferenza portava gli errori del
 * basso dato da 65 a 75. Non e' una differenza di repertorio: Dubois 47%, Bach
 * 44%, Delamont 42%, tutti uguali.
 *
 * DOVE SBAGLIA, per grado del basso:
 *
 *     2°  la tavola vuole V6/4   coincide il 15%   gli autori: ii 200, vii°6 101
 *     6°  vuole IV6                        26%     vi 299
 *     7°  vuole V6                         40%     vii° 123
 *     4°  vuole IV                         45%     ii6 181, V4/2 67
 *     1°  I                                66%     ← questo regge
 *     5°  V                                60%     ← anche
 *
 * E il `V4/2` che compare 67 volte sul quarto grado e' la prova che LA
 * DIREZIONE CONTA davvero: e' la cifra della DISCESA, e una tavola cieca alla
 * direzione — come questa, dove `SCENDENDO` ripete `SALENDO` — non la puo'
 * esprimere. I gradi che reggono (1° e 5°) sono quelli stabili, gli stessi in
 * tutte le formulazioni; quelli che cadono sono i gradi di passaggio, dove le
 * tradizioni divergono ed e' necessario scegliere le cifre GIUSTE.
 *
 * Serve la versione CON LE SETTIME e con le due colonne davvero distinte. Lo
 * strumento per validarla c'e' gia': si riempiono le tavole e si rimisura.
 *
 * LIMITI, dichiarati. Copre i soli movimenti per GRADO CONGIUNTO: sui salti non
 * dice niente, e i salti sono i punti in cui l'armonizzazione e' piu' libera.
 * E non dice niente sulle note estranee: da' l'accordo giusto, non la
 * figurazione che lo rende musicale invece che a blocchi.
 */

/** Un'armonia della tavola: grado (0 = I) e rivolto (0 fondamentale, 1 primo, 2 secondo). */
export type ArmoniaAttesa = { grado: number; rivolto: number };

/**
 * La tavola, per grado del BASSO (0 = tonica … 6 = settimo).
 *
 *   1  I        il grado piu' stabile, stato fondamentale
 *   2  V6/4     quarta e sesta di passaggio sopra il secondo grado
 *   3  I6       la tonica in primo rivolto: il basso e' la sua terza
 *   4  IV       stabile, stato fondamentale
 *   5  V        stabile, stato fondamentale
 *   6  IV6      la sottodominante in primo rivolto
 *   7  V6       la dominante in primo rivolto: al basso c'e' la sensibile
 */
const SALENDO: (ArmoniaAttesa | null)[] = [
  { grado: 0, rivolto: 0 },   // 1 → I
  { grado: 4, rivolto: 2 },   // 2 → V 6/4
  { grado: 0, rivolto: 1 },   // 3 → I 6
  { grado: 3, rivolto: 0 },   // 4 → IV
  { grado: 4, rivolto: 0 },   // 5 → V
  { grado: 3, rivolto: 1 },   // 6 → IV 6
  { grado: 4, rivolto: 1 },   // 7 → V 6
];

/** Nella versione con le TRIADI la discesa ripete la salita. Con le settime no:
 *  vedi la nota in testa al file. */
const SCENDENDO: (ArmoniaAttesa | null)[] = SALENDO;

/**
 * Che armonia vuole la regola dell'ottava sotto questo grado del basso.
 *
 * @param gradoDelBasso  0 = tonica … 6 = settimo grado.
 * @param sale  il basso procede verso l'alto.
 * @returns `null` dove la tavola non dice niente.
 */
export function armoniaDellaRegola(gradoDelBasso: number, sale: boolean): ArmoniaAttesa | null {
  if (!Number.isFinite(gradoDelBasso) || gradoDelBasso < 0 || gradoDelBasso > 6) return null;
  return (sale ? SALENDO : SCENDENDO)[gradoDelBasso] ?? null;
}
