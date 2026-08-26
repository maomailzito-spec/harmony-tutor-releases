/**
 * IL CORPUS CHE PROPONE — statistiche di progressione al servizio del generatore.
 *
 * La coppia che regge il generatore di corali è «il corpus propone, il checker dispone».
 * La seconda metà è fatta (`vetoRegole.ts`): prima di fissare un accordo lo si sottopone alle
 * regole vere. La prima metà mancava del tutto — `autoHarmonize` sceglieva i gradi con dei
 * pesi scritti a mano e quattro bonus di transizione altrettanto inventati, senza mai
 * guardare le 393 armonizzazioni che il programma ha già analizzato.
 *
 * Questo modulo apre quel cassetto. La fonte è `data/progressionStats.json` — 393 brani,
 * 6619 transizioni — che finora serviva soltanto al suggeritore di accordi.
 *
 * ── COSA CAMBIA, IN CONCRETO ──────────────────────────────────────────────────────────
 *
 * I pesi scritti a mano mettevano IV terzo (8) e vi quarto (6). Il corpus dice il contrario:
 *
 *      I 18,5%   ·   V 14,1%   ·   vi 13,1%   ·   ii 9,6%   ·   IV 7,6%
 *
 * `vi` è quasi il doppio di `IV`, e anche `ii` gli sta davanti. Non è una sfumatura: è la
 * differenza fra un corale che gira sulle triadi primarie come un esercizio di scuola e uno
 * che usa i gradi deboli come fa la musica scritta.
 *
 * ── I DUE MODI SONO CONTATI A PARTE, E LA TONICA È QUELLA VERA ────────────────────────
 *
 * La fonte NON è `progressionStats.json`, che alimenta il suggeritore di accordi, ma un file
 * suo (`progressionStatsByMode.json`, prodotto da `scripts/estrai-stats-per-modo.ts`), e per
 * due ragioni che si sono viste soltanto misurando.
 *
 * La prima è il MODO. Le statistiche vecchie stanno in un mucchio unico: la `V` del maggiore
 * e quella del minore sono la stessa voce. Provando a leggerle per modo, in minore la
 * dominante risultava dieci volte più frequente della tonica, e un generatore con quei pesi
 * la tonica non l'avrebbe quasi mai scelta.
 *
 * La seconda è la TONICA. L'estrattore vecchio passa `keySignatureRoot` tale e quale come
 * tonica dell'analisi, ma quel campo tiene la fondamentale MAGGIORE relativa: **ogni brano
 * in minore del corpus era stato analizzato nella tonalità sbagliata**. Da lì venivano i
 * numeri incongrui — la tonica `i` a 41 osservazioni, e una processione di `♭VI`, `♭VII`,
 * `♭III` che sono i gradi di casa scambiati per alterazioni. Con la tonica giusta la stessa
 * raccolta dà `i` a 486. Vedi `utils/relativeMinors.ts`: è la stessa trappola, terza volta.
 *
 * Resta la disciplina della confidenza: dove il campione è scarso il valore del corpus si
 * mescola con quello scritto a mano, in proporzione a quanto campione c'è — come fa
 * `choralStyleProfile.ts`, e per la stessa ragione. Una statistica su quaranta osservazioni
 * non è una conoscenza, è un'impressione.
 */
import statsJson from '../data/progressionStatsByMode.json';

type MappaBigrammi = { [da: string]: { [a: string]: number } };
type PerModo = { unigrammi: { [grado: string]: number }; bigrammi: MappaBigrammi };

const stats = statsJson as unknown as { major: PerModo; minor: PerModo };
const delModo = (isMinor: boolean): PerModo => (isMinor ? stats.minor : stats.major);

/** Sotto questo numero di osservazioni il corpus non parla da solo. */
const CAMPIONE_PIENO = 120;

/** I pesi di partenza, quelli scritti a mano: restano il fondo su cui il corpus si mescola
 *  quando ha poco da dire. Preferiscono I, V, IV e puniscono iii e vii°. */
const PESI_A_MANO: Record<number, number> = { 0: 10, 1: 5, 2: 2, 3: 8, 4: 9, 5: 6, 6: 3 };

/** I bonus di transizione scritti a mano, nella forma «da → a → quanto». */
const TRANSIZIONI_A_MANO: Record<number, Record<number, number>> = {
    4: { 0: 5 },            // V → I
    3: { 4: 3 },            // IV → V
    1: { 4: 3 },            // ii → V
    5: { 1: 2, 3: 2 },      // vi → ii, vi → IV
};

/**
 * Come il corpus chiama ciascun grado, nei due modi. Le etichette devono combaciare con
 * quelle che l'analisi ha SCRITTO nel corpus, non con quelle del generatore: `viio` del
 * codice là dentro è `vii°`.
 *
 * Ogni grado ne ha PIÙ D'UNA, perché lo stesso grado cambia qualità: in minore la dominante
 * si trova scritta `V` quando porta la sensibile e `v` quando resta modale, e il settimo
 * grado esce `VII`, `♭VII` o `vii°` a seconda di come l'analisi lo legge. Sono lo stesso
 * gradino della scala e vanno sommati, altrimenti il conto si sbriciola fra le grafie.
 */
const ETICHETTE_MAGGIORE: string[][] = [
    ['I'], ['ii'], ['iii'], ['IV'], ['V'], ['vi'], ['vii°', 'vii'],
];
const ETICHETTE_MINORE: string[][] = [
    ['i'], ['ii°', 'ii'], ['III', '♭III'], ['iv', 'IV'], ['V', 'v'], ['VI', '♭VI'], ['VII', '♭VII', 'vii°', 'vii'],
];

const etichette = (isMinor: boolean) => (isMinor ? ETICHETTE_MINORE : ETICHETTE_MAGGIORE);
const somma = (mappa: { [k: string]: number }, nomi: string[]) =>
    nomi.reduce((t, n) => t + (mappa[n] ?? 0), 0);

/**
 * QUANTA VOCE IN CAPITOLO HA IL CORPUS, al massimo.
 *
 * Non è stato deciso a tavolino: si è provata la scala intera su **75 brani** del corpus,
 * confrontando col generatore a pesi scritti a mano.
 *
 *      0 (a mano)  443 errori, 465 avvisi
 *      0,25        443 errori, 460 avvisi
 *      0,5         456 errori, 464 avvisi
 *      0,75        454 errori, 454 avvisi
 *      1           447 errori, **424** avvisi
 *
 * Gli errori non si muovono — il conto oscilla dentro il suo rumore. Gli AVVISI invece
 * scendono, e solo a corpus pieno: circa il 9% in meno. Ha senso, perché i pesi decidono
 * QUALE GRADO, non come si conducono le voci: gli errori li fanno sparire il veto e il passo
 * indietro, che lavorano a valle e non dipendono da questa scelta.
 *
 * LEZIONE DI METODO. Su un campione di dieci brani lo 0,25 sembrava il migliore (20 errori
 * contro 21). Su settantacinque dà esattamente lo stesso numero dello zero: era rumore.
 */
const VOCE_DEL_CORPUS = 1;

/** Quanto ci si fida di un campione di questa dimensione: 0 = per niente, 1 = del tutto. */
const fiducia = (osservazioni: number) =>
    Math.max(0, Math.min(1, osservazioni / CAMPIONE_PIENO)) * VOCE_DEL_CORPUS;

/**
 * QUANTO È FREQUENTE CIASCUN GRADO, nella stessa scala dei pesi scritti a mano (0…10 circa),
 * così che gli altri termini del punteggio — copertura, cadenze, monotonia — conservino il
 * peso che avevano.
 */
export function pesiDeiGradi(isMinor: boolean): Record<number, number> {
    const nomi = etichette(isMinor);
    const uni = delModo(isMinor).unigrammi;
    const conti = nomi.map(gruppo => somma(uni, gruppo));
    const totale = conti.reduce((a, b) => a + b, 0);
    const massimo = Math.max(...conti, 1);
    const f = fiducia(totale);
    const fuori: Record<number, number> = {};
    for (let deg = 0; deg < 7; deg++) {
        const dalCorpus = (conti[deg] / massimo) * 10;
        fuori[deg] = (1 - f) * (PESI_A_MANO[deg] ?? 1) + f * dalCorpus;
    }
    return fuori;
}

/** Quanto pesa al massimo una transizione molto frequente. Tarato sui bonus che sostituisce:
 *  il corpus dà `V → I` al 49%, e 10 × 0,49 fa 4,9 — cioè il +5 che c'era scritto a mano. */
const PESO_TRANSIZIONE = 10;

/**
 * IL BONUS PER ANDARE DAL GRADO `da` AL GRADO `a`, dalle transizioni osservate.
 *
 * Sostituisce i quattro casi scritti a mano (V→I, IV→V, ii→V, vi→ii/IV) con tutte le
 * quarantanove coppie, ciascuna col suo peso vero. `da < 0` significa «primo accordo»: lì
 * non c'è transizione e il bonus è zero.
 */
export function bonusTransizione(isMinor: boolean, da: number, a: number): number {
    if (da < 0 || da > 6 || a < 0 || a > 6) return 0;
    const nomi = etichette(isMinor);
    const bigrammi = delModo(isMinor).bigrammi;
    // Le righe di tutte le grafie dello stesso grado di partenza si sommano.
    const riga: Record<string, number> = {};
    let totaleRiga = 0;
    for (const nomeDa of nomi[da]) {
        for (const [verso, c] of Object.entries(bigrammi[nomeDa] || {})) {
            riga[verso] = (riga[verso] ?? 0) + c;
            totaleRiga += c;
        }
    }
    const aMano = TRANSIZIONI_A_MANO[da]?.[a] ?? 0;
    if (totaleRiga <= 0) return aMano;
    const p = somma(riga, nomi[a]) / totaleRiga;
    const f = fiducia(totaleRiga);
    return (1 - f) * aMano + f * (p * PESO_TRANSIZIONE);
}

/** Diagnostica: quanto materiale ha il corpus per questo modo, e come lo distribuisce. */
export function fotografiaCorpus(isMinor: boolean): { grado: string; conto: number; peso: number }[] {
    const nomi = etichette(isMinor);
    const pesi = pesiDeiGradi(isMinor);
    const uni = delModo(isMinor).unigrammi;
    return nomi.map((gruppo, deg) => ({ grado: gruppo.join('/'), conto: somma(uni, gruppo), peso: Math.round((pesi[deg] ?? 0) * 10) / 10 }));
}
