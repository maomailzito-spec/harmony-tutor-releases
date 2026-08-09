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
 * CIFRE DEL BASSO FIGURATO scritte con la barra: «6/4» va detto «quarta e sesta»,
 * non «sei barra quattro». Si leggono dal basso verso l'alto, com'è la convenzione.
 *
 * Si convertono SOLO le coppie che sono cifre d'armonia. Fuori restano di proposito
 * 4/4, 3/4, 2/4, 6/8, 12/8 e simili, che sono METRI: dirli «quarta e quarta» sarebbe
 * peggio del male che si cura. Resta un'ambiguità vera su 6/4, che è sia un rivolto
 * sia un metro — nel pannello delle violazioni è sempre il rivolto, ma vale la pena
 * saperlo.
 */
const CIFRE_ITALIANO: Record<string, string> = {
    '6/4': 'quarta e sesta',
    '6/5': 'quinta e sesta',
    '4/3': 'quarta e terza',
    '4/2': 'quarta e seconda',
    '7/5': 'quinta e settima',
    '9/7': 'settima e nona',
    '6/3': 'sesta',
};
const CIFRA = new RegExp(`(?<![\\w/])(${Object.keys(CIFRE_ITALIANO).map(k => k.replace('/', '\\/')).join('|')})(?![\\w/])`, 'g');

/**
 * Il testo con le sigle armoniche sostituite dalla loro forma parlata.
 *
 * Da usare SOLO per `aria-label` / `aria-describedby`: mai per ciò che si stampa o si
 * disegna, che deve restare la sigla.
 */
export function pronunciaSigle(testo: string | null | undefined): string {
    const s = String(testo ?? '');
    if (!s) return '';
    const conCifre = s.replace(CIFRA, (m) => CIFRE_ITALIANO[m] ?? m);
    return conCifre.replace(SIGLA, (match) => {
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
