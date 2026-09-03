/**
 * IL GIUDICE DELLE CADENZE.
 *
 * Serve a rispondere a «questa e' una cadenza ben formata?», che e' una domanda
 * DIVERSA da «e' uguale a quella dell'autore» — e la differenza non e'
 * accademica. Misurando le cadenze finali del generatore contro quelle
 * d'autore, su Dubois n1 usciva `I6/4–V7–I` dove l'autore scrive `I–V–I`:
 * contato come «diverso», ma e' una cadenza composta, cioe' migliore. Un metro
 * per somiglianza avrebbe insegnato al generatore a imitare invece che a
 * chiudere bene.
 *
 * Qui si guarda com'e' FATTA la formula:
 *
 *   · dove arriva      — tonica (o dominante, per una sospesa)
 *   · com'e' la dominante — in stato FONDAMENTALE, che e' cio' che rende
 *                        conclusiva una cadenza perfetta; rivoltata no
 *   · cosa la prepara  — una sottodominante, o la quarta e sesta cadenzale
 *
 * Non giudica il gusto: giudica se la formula c'e' ed e' completa.
 */

import { parseRoman } from './choralRealization';

/** I gradi, contati da zero: 0 = I, 3 = IV, 4 = V, 5 = vi. */
const TONICA = 0, SOTTODOMINANTE = 3, DOMINANTE = 4, SESTO = 5, SECONDO = 1, SETTIMO = 6;

export type SpecieDiCadenza =
  | 'perfetta'     // sottodominante → V fondamentale → I fondamentale
  | 'composta'     // I6/4 → V(7) → I: la quarta e sesta cadenzale
  | 'imperfetta'   // V → I con uno dei due rivoltato: chiude, ma non conclude
  | 'sospesa'      // finisce sulla dominante
  | 'inganno'      // V → vi
  | 'plagale'      // IV → I
  | 'nessuna';     // non e' una formula di cadenza

export type Cadenza = {
  specie: SpecieDiCadenza;
  /** Ben formata = la formula c'e' ED e' completa: dominante in stato
   *  fondamentale e qualcosa che la prepara. Una `semplice` o una `imperfetta`
   *  sono cadenze riconoscibili ma non ben formate. */
  benFormata: boolean;
  /** Perche', in una riga: serve a chi legge il resoconto di una misura. */
  perche: string;
};

const NESSUNA: Cadenza = { specie: 'nessuna', benFormata: false, perche: 'non e\' una formula di cadenza' };

/**
 * Giudica la chiusura di una progressione.
 *
 * @param gradi  i numeri romani COMPLETI di cifre (`V7`, `I6/4`, `ii6`), in
 *               ordine; si guardano gli ultimi tre.
 */
export function giudicaCadenza(gradi: string[]): Cadenza {
  if (!Array.isArray(gradi) || gradi.length < 2) return NESSUNA;

  const p = (s: string) => { try { return parseRoman(String(s)); } catch { return null; } };
  const ultimo = p(gradi[gradi.length - 1]);
  const penultimo = p(gradi[gradi.length - 2]);
  const terzultimo = gradi.length >= 3 ? p(gradi[gradi.length - 3]) : null;
  if (!ultimo || !penultimo) return NESSUNA;

  // Una dominante SECONDARIA non chiude niente: `V/iv` non e' la dominante di
  // casa, e prenderla per tale e' l'errore che fa sembrare cadenza qualunque
  // cosa finisca con un accordo maggiore.
  const diCasa = (x: any) => x && x.secondaryTarget == null;
  const eDominante = (x: any) => diCasa(x) && x.degree === DOMINANTE;
  const eTonica = (x: any) => diCasa(x) && x.degree === TONICA;
  const ePreparazione = (x: any) => diCasa(x)
    && (x.degree === SOTTODOMINANTE || x.degree === SECONDO || x.degree === SESTO);

  // ── SOSPESA: si ferma sulla dominante. E' una chiusura a tutti gli effetti,
  //    ed e' quella che l'antecedente di un periodo deve fare.
  if (eDominante(ultimo)) {
    return {
      specie: 'sospesa',
      benFormata: ultimo.inversion === 0,
      perche: ultimo.inversion === 0
        ? 'si ferma sulla dominante in stato fondamentale'
        : 'si ferma sulla dominante, ma rivoltata: sospende male',
    };
  }

  // ── D'INGANNO: la dominante promette la tonica e consegna il sesto grado.
  if (eDominante(penultimo) && diCasa(ultimo) && ultimo.degree === SESTO) {
    return { specie: 'inganno', benFormata: penultimo.inversion === 0,
      perche: 'la dominante risolve sul sesto grado' };
  }

  // ── PLAGALE: sottodominante → tonica, senza dominante di mezzo.
  if (diCasa(penultimo) && penultimo.degree === SOTTODOMINANTE && eTonica(ultimo)) {
    return { specie: 'plagale', benFormata: penultimo.inversion === 0 && ultimo.inversion === 0,
      perche: 'sottodominante sulla tonica, senza dominante' };
  }

  // Da qui in poi serve la coppia dominante → tonica.
  if (!eDominante(penultimo) || !eTonica(ultimo)) {
    // Il settimo grado fa le veci della dominante, ma non conclude mai davvero.
    if (diCasa(penultimo) && penultimo.degree === SETTIMO && eTonica(ultimo)) {
      return { specie: 'imperfetta', benFormata: false,
        perche: 'il settimo grado al posto della dominante: non conclude' };
    }
    return NESSUNA;
  }

  // ── La dominante RIVOLTATA non conclude: il basso non fa il salto di quinta.
  if (penultimo.inversion !== 0 || ultimo.inversion !== 0) {
    return { specie: 'imperfetta', benFormata: false,
      perche: penultimo.inversion !== 0
        ? 'la dominante e\' rivoltata: il basso non scende di quinta'
        : 'la tonica e\' rivoltata: si chiude senza posarsi' };
  }

  // ── COMPOSTA: la quarta e sesta cadenzale prepara la dominante.
  if (terzultimo && diCasa(terzultimo) && terzultimo.degree === TONICA && terzultimo.inversion === 2) {
    return { specie: 'composta', benFormata: true,
      perche: 'quarta e sesta cadenzale, poi dominante e tonica' };
  }

  // ── PERFETTA: dominante fondamentale sulla tonica fondamentale. BASTA
  //    QUESTO. La preparazione e' un ornamento della formula, non un
  //    requisito: la prima versione di questo giudice la pretendeva e
  //    bocciava `I–V–I`, cioe' bocciava Bach — sei cadenze d'autore su nove.
  //    Quando lo strumento boccia il repertorio, e' lo strumento a sbagliare.
  return {
    specie: 'perfetta',
    benFormata: true,
    perche: terzultimo && ePreparazione(terzultimo)
      ? 'sottodominante, dominante fondamentale, tonica'
      : 'dominante fondamentale sulla tonica',
  };
}
