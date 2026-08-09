/**
 * SIGLE ARMONICHE DETTE A PAROLE — solo per chi ascolta.
 *
 * Sullo schermo resta scritto `V7`, come deve. Questa funzione serve a costruire il
 * NOME ACCESSIBILE, cioè quello che uno screen reader legge: «settima di dominante».
 * Testo visibile e nome letto sono due cose distinte, e l'app le tiene già distinte in
 * più punti (il triangolo mostra «⚠7» e annuncia «7 misure incomplete: l'analisi di
 * quei punti è parziale»).
 *
 * PERCHÉ non basta il dizionario di VoiceOver: quello esiste, l'abbiamo costruito per
 * l'export, ma è limitato a MuseScore — di proposito, perché altrimenti «I», «V», «C»
 * verrebbero ripronunciati in ogni programma del Mac. Va installato a mano su ogni
 * computer e si perde cambiando macchina. Detto dal programma, invece, funziona per
 * chiunque apra l'app, subito, senza sapere che esiste.
 *
 * Il vocabolario non è nuovo: è `spokenPhrase`, lo stesso che scrive le frasi
 * dell'export accessibile. Non esporta niente — è un traduttore puro da sigla a
 * italiano — e sta fra gli esportatori solo perché finora lo chiamava soltanto quello.
 */
import { spokenPhrase } from '../exporters/spokenHarmony';

/**
 * Sigle riconosciute dentro un testo corrente.
 *
 * ATTENZIONE alle parole italiane: `i` è un articolo e `e` una congiunzione, quindi le
 * minuscole di UNA lettera restano fuori — «i bassi» non deve diventare «primo grado
 * bassi». Si convertono le maiuscole (in italiano non esistono `I` e `V` come parole a
 * sé) e le minuscole da due lettere in su, che sigle lo sono per forza.
 */
const SIGLA = /(?<![\w#♭♯])((?:[b#♭♯])?(?:VII|VI|IV|III|II|I|V|vii|iii|iv|vi|ii)(?:[o°ø+]*)(?:\d+)?(?:\/(?:[b#♭♯])?(?:VII|VI|IV|III|II|I|V|vii|iii|iv|vi|ii))?|N6|N|It6|Fr6|Ger6)(?![\w])/g;

/**
 * Il testo con le sigle armoniche sostituite dalla loro forma parlata.
 *
 * Da usare SOLO per `aria-label` / `aria-describedby`: mai per ciò che si stampa o si
 * disegna, che deve restare la sigla.
 */
export function pronunciaSigle(testo: string | null | undefined): string {
    const s = String(testo ?? '');
    if (!s) return '';
    return s.replace(SIGLA, (match) => {
        try {
            const detto = spokenPhrase({ roman: match });
            // Se il traduttore non la riconosce restituisce la sigla stessa: in quel
            // caso si lascia com'è, che è sempre meglio di una parola inventata.
            return detto && detto !== match ? detto : match;
        } catch {
            return match;
        }
    });
}
