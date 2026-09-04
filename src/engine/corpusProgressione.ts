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
import melodiaJson from '../data/armoniaSottoMelodia.json';
import bassoJson from '../data/armoniaSottoIlBasso.json';

type MappaBigrammi = { [da: string]: { [a: string]: number } };
type PerModo = {
    unigrammi: { [grado: string]: number };
    bigrammi: MappaBigrammi;
    unigrammiForte: { [grado: string]: number };
    unigrammiDebole: { [grado: string]: number };
    bigrammiForte: MappaBigrammi;
    bigrammiDebole: MappaBigrammi;
    chiusure: { antecedente: { [g: string]: number }; conseguente: { [g: string]: number } };
    chiusurePosizione: { prima: { [g: string]: number }; interna: { [g: string]: number }; ultima: { [g: string]: number } };
    raddoppi: { [rivolto: string]: { [membro: string]: number } };
    intervalliEstremi: { [forza: string]: { [semitoni: string]: number } };
    motoEstremi: { [tipo: string]: number };
    rivolti: MappaBigrammi;
};

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


/**
 * DA UNA FREQUENZA A UN COSTO: LA SORPRESA, NON LA PROPORZIONE.
 *
 * Il primo tentativo trasformava la frequenza in un valore lineare, `(conto / massimo) × 10`.
 * Sembra innocuo e non lo è: schiaccia i rapporti veri dentro una scala additiva. In maggiore
 * il `I` compare 2,9 volte più del `vi` — un rapporto modesto — ma su quella scala diventa
 * uno scarto di 6,5 punti, mentre gli altri termini del punteggio (copertura, transizioni,
 * cadenze) valgono ±3. Il grado più frequente stravinceva ogni volta che entrava in gara.
 *
 * MISURATO su Dubois, Delachi e Pedron: il generatore metteva la tonica nel 29,3% degli
 * accordi contro il 17,7% degli autori, e il `vi` nell'1,6% contro il 6,3%. Su una nota che
 * poteva essere I o vi prendeva I quasi sempre — che è l'«interpretazione dubbia» che si
 * sente all'ascolto.
 *
 * La conversione giusta da probabilità a costo additivo è il logaritmo: quanto è SORPRENDENTE
 * incontrare quel grado, dato il corpus. Il rapporto 2,9 a 1 torna a valere ln(2,9) ≈ 1,06 —
 * poco più di un punto — e i gradi deboli tornano in gara quando la melodia li chiede.
 *
 * Vale per tutti i pesi che vengono da un conteggio, altrimenti due parti del punteggio
 * parlerebbero scale diverse: i gradi, le chiusure di frase e le tonicizzazioni.
 */
const SCALA_SORPRESA = 3;
const MASSIMO_PESO = 10;
/** Da un conteggio al «peso» che il percorso usa: `MASSIMO_PESO` per il più frequente, meno
 *  per i più rari, con la distanza misurata in logaritmo. */
const pesoDaConto = (conto: number, massimo: number) =>
    MASSIMO_PESO - Math.log(Math.max(massimo, 1) / Math.max(conto, 0.5)) * SCALA_SORPRESA;

/** Quanto ci si fida di un campione di questa dimensione: 0 = per niente, 1 = del tutto. */
const fiducia = (osservazioni: number) =>
    Math.max(0, Math.min(1, osservazioni / CAMPIONE_PIENO)) * VOCE_DEL_CORPUS;

/**
 * QUANTO È FREQUENTE CIASCUN GRADO, nella stessa scala dei pesi scritti a mano (0…10 circa),
 * così che gli altri termini del punteggio — copertura, cadenze, monotonia — conservino il
 * peso che avevano.
 */
/**
 * @param forte se dato, si guardano i conti del solo tempo FORTE o del solo tempo DEBOLE.
 *   Non è una raffinatezza: nel corpus il quinto grado sta più spesso sul tempo debole
 *   (21,7%) che sul forte (16,2%), e la tonica il contrario (29% contro 18%). È la regola
 *   del ritmo armonico — la dominante spinge, la conclusione atterra sul battere — scritta
 *   dai compositori invece che da noi.
 */
export function pesiDeiGradi(isMinor: boolean, forte?: boolean): Record<number, number> {
    const nomi = etichette(isMinor);
    const m = delModo(isMinor);
    const uni = forte == null ? m.unigrammi : (forte ? m.unigrammiForte : m.unigrammiDebole);
    const conti = nomi.map(gruppo => somma(uni, gruppo));
    const totale = conti.reduce((a, b) => a + b, 0);
    const massimo = Math.max(...conti, 1);
    const f = fiducia(totale);
    const fuori: Record<number, number> = {};
    for (let deg = 0; deg < 7; deg++) {
        fuori[deg] = (1 - f) * (PESI_A_MANO[deg] ?? 1) + f * pesoDaConto(conti[deg], massimo);
    }
    return fuori;
}

/** Quanto pesa al massimo una transizione, in più o in meno. La forbice che ne esce va da
 *  circa −2,5 a +3,5: paragonabile ai bonus scritti a mano che sostituisce (0…+5), ma con
 *  segno. */
const PESO_TRANSIZIONE = 10;

/**
 * QUANTO È IDIOMATICO ANDARE DAL GRADO `da` AL GRADO `a` — in più o in meno.
 *
 * Sostituisce i quattro casi scritti a mano (V→I, IV→V, ii→V, vi→ii/IV) con tutte le
 * quarantanove coppie. `da < 0` significa «primo accordo»: lì non c'è transizione.
 *
 * ── PERCHÉ NON BASTA LA FREQUENZA ─────────────────────────────────────────────────────
 *
 * Il primo tentativo dava un bonus proporzionale alla probabilità: `P(a | da) × 10`. Il
 * risultato, provato dall'utente su una melodia del Delachi, era corretto e **piatto** — il
 * quinto grado ripetuto su quattro primi movimenti di fila, e due `V → ii`, che è una
 * retrocessione. Zero errori e musica morta.
 *
 * Il motivo è che una successione rara prendeva un bonus PICCOLO, mai una penalità: il
 * corpus poteva dire «questo si fa spesso» ma non «questo non si fa». E siccome nel
 * punteggio gli altri termini (copertura, cadenze) sono positivi, un bonus piccolo non
 * ferma niente.
 *
 * La misura giusta non è quanto è frequente `a` dopo `da`, ma **quanto lo è PIÙ DEL SOLITO**:
 *
 *      P(a | da) − P(a)
 *
 * Dopo il V, il I passa dal 25% al 60% — un moto che il corpus chiede a gran voce (+0,35).
 * Il IV scende dall'8,8% al 2,9% (−0,06), il ii dal 9% al 5% (−0,04): sono le retrocessioni,
 * e ora COSTANO invece di fruttare poco. Ripetere lo stesso grado prende la penalità piena,
 * perché nel corpus le ripetizioni consecutive sono state tolte in fase di raccolta: una
 * progressione è fatta di cambiamenti.
 */
export function bonusTransizione(isMinor: boolean, da: number, a: number, forteArrivo?: boolean): number {
    if (da < 0 || da > 6 || a < 0 || a > 6) return 0;
    const nomi = etichette(isMinor);
    const m = delModo(isMinor);
    const bigrammi = forteArrivo == null ? m.bigrammi : (forteArrivo ? m.bigrammiForte : m.bigrammiDebole);
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
    // Quanto vale `a` in generale, per sapere se qui è più o meno atteso del solito. Il
    // «generale» dev'essere lo stesso mondo del condizionato: se si guarda il tempo debole,
    // il termine di paragone sono i gradi sul tempo debole.
    const uni = forteArrivo == null ? m.unigrammi : (forteArrivo ? m.unigrammiForte : m.unigrammiDebole);
    let totaleUni = 0;
    for (const v of Object.values(uni)) totaleUni += v;
    const pGenerale = totaleUni > 0 ? somma(uni, nomi[a]) / totaleUni : 0;
    const f = fiducia(totaleRiga);
    return (1 - f) * aMano + f * ((p - pGenerale) * PESO_TRANSIZIONE);
}

/** Diagnostica: quanto materiale ha il corpus per questo modo, e come lo distribuisce. */
export function fotografiaCorpus(isMinor: boolean): { grado: string; conto: number; peso: number }[] {
    const nomi = etichette(isMinor);
    const pesi = pesiDeiGradi(isMinor);
    const uni = delModo(isMinor).unigrammi;
    return nomi.map((gruppo, deg) => ({ grado: gruppo.join('/'), conto: somma(uni, gruppo), peso: Math.round((pesi[deg] ?? 0) * 10) / 10 }));
}

/**
 * QUANTO PESA UN ACCORDO DI TONICIZZAZIONE (`V/V`, `V7/vi`, `vii°/iv`…), nella stessa scala
 * dei gradi diatonici.
 *
 * Nel corpus valgono il **12% degli accordi in maggiore** e il 9,6% in minore: non sono un
 * ornamento, sono un pezzo del vocabolario. Il generatore non ne aveva nessuno, e una nota di
 * melodia fuori scala finiva sotto l'accordo di tonica — che è il modo più diretto di
 * scrivere uno scontro cromatico.
 *
 * @param chiave l'etichetta com'è scritta nel corpus: `V/V`, `V/vi`, `vii°/iv`…
 */
export function pesoSecondaria(isMinor: boolean, chiave: string): number {
    const uni = delModo(isMinor).unigrammi;
    const nomi = etichette(isMinor);
    // Il metro è lo stesso dei gradi: il massimo diatonico vale 10.
    const massimo = Math.max(...nomi.map(g => somma(uni, g)), 1);
    // La settima non è contata a parte nel corpus (le cifre sono già cadute): `V7/V` e `V/V`
    // pescano dalla stessa voce.
    const base = chiave.replace(/^V7\//, 'V/');
    return pesoDaConto(uni[base] ?? 0, massimo);
}


/**
 * CHE BASSO VUOLE UN CERTO GRADO — dal corpus, non da una costante.
 *
 * «Se metto un ii, cosa posso mettere al basso» è una domanda a cui l'armonia risponde con
 * delle consuetudini, e le consuetudini stanno scritte nel repertorio. Il corpus dice che il
 * `ii` sta in primo rivolto il 29% delle volte contro il 17% del `I`, e che in minore il
 * `ii°` in primo rivolto (34%) è più frequente che in posizione fondamentale (24%) — cioè
 * esattamente la regola di scuola, ma misurata invece che asserita.
 *
 * Prima era una tabella di quattro numeri scelti da me, uguale per tutti i gradi.
 *
 * ── È UNA CONSUETUDINE, NON UNA REGOLA, E PESA POCO APPOSTA ───────────────────────────
 *
 * La frequenza con cui un grado compare in un certo rivolto è un'inclinazione generale.
 * QUALE rivolto vada in un punto preciso lo decide un'altra cosa: come si muovono le voci —
 * se il basso fa una linea, se nascono quinte parallele — e quella decisione sta a valle, nel
 * realizzatore e nel veto delle regole.
 *
 * Misurato: con questa consuetudine a peso alto (8) la condotta migliorava — meno altalene,
 * meno retrocessioni — ma gli ERRORI salivano da 256 a 280, perché il corpus preferisce la
 * posizione fondamentale e una fila di accordi tutti in stato fondamentale produce parallele
 * fra le voci estreme. Una statistica sul repertorio intero non sa niente del punto in cui
 * ci troviamo.
 *
 * Perciò pesa poco: è un suggerimento che cede a chi ne sa di più. Le consuetudini che invece
 * sono REGOLE — il 4/6 che ha bisogno di un'occasione — restano scritte a parte e taglienti.
 */
const PESO_RIVOLTO = 3;

/** Dal cifrato dell'analisi al numero di rivolto. Le alterazioni nel cifrato (`5♯3`, `♯64`)
 *  dicono che nota è alterata, non chi sta al basso: si tolgono. */
function rivoltoDalCifrato(cifra: string): number | null {
    const c = cifra.replace(/[♯♭♮#b]/g, '');
    if (c === '5' || c === '3' || c === '53' || c === '' || c === '7' || c === '75' || c === '73') return 0;
    if (c === '6' || c === '63' || c === '65') return 1;
    if (c === '64' || c === '43') return 2;
    if (c === '42' || c === '2' || c === '4') return 3;
    return null;
}

/**
 * Quanto costa mettere quel grado in quel rivolto. Zero = è il suo rivolto abituale.
 *
 * **MISURATA E NON IN USO.** Provata dentro la scelta della progressione, migliorava la
 * condotta (meno altalene, meno retrocessioni) e PEGGIORAVA la scrittura: 280 errori invece
 * di 256 su 75 brani. Il motivo è che il corpus preferisce la posizione fondamentale, e una
 * fila di accordi tutti in stato fondamentale produce parallele fra le voci estreme — una
 * statistica sul repertorio intero non sa niente del punto in cui ci si trova. Vince invece,
 * e nettamente (237 errori), la sola regola METRICA del 4/6, che non è una frequenza ma una
 * consuetudine con un contesto preciso.
 *
 * Resta qui perché il dato è buono e la domanda che risolve — «se metto un ii, che basso ci
 * va» — è quella giusta: manca il posto dove porla, che è la condotta delle voci, non la
 * scelta del grado.
 */
export function costoDelRivolto(isMinor: boolean, deg: number, inv: number): number {
    if (deg < 0 || deg > 6) return inv === 0 ? 0 : inv === 1 ? 1.5 : inv === 2 ? 6 : 3;
    const tabella = delModo(isMinor).rivolti || {};
    const conti: number[] = [0, 0, 0, 0];
    let totale = 0;
    for (const nome of etichette(isMinor)[deg]) {
        for (const [cifra, c] of Object.entries(tabella[nome] || {})) {
            const rv = rivoltoDalCifrato(cifra);
            if (rv == null) continue;
            conti[rv] += c;
            totale += c;
        }
    }
    // Poco materiale: si torna alla consuetudine generica (fondamentale, poi primo rivolto).
    const f = fiducia(totale);
    const aMano = inv === 0 ? 0 : inv === 1 ? 1.5 : inv === 2 ? 8 : 3;
    if (totale <= 0) return aMano;
    const massimo = Math.max(...conti, 1);
    const dalCorpus = (1 - conti[inv] / massimo) * PESO_RIVOLTO;
    return (1 - f) * aMano + f * dalCorpus;
}


/**
 * LE VOCI ESTREME TRACCIANO LA VIA, IL RESTO È COLORE.
 *
 * Il generatore sceglieva i gradi e il basso usciva come conseguenza: cioè il contrario di
 * come si scrive. Soprano e basso sono il telaio — un contrappunto a due voci che regge tutto
 * — e le voci interne lo riempiono.
 *
 * Il corpus ha soprano e basso scritti in ogni brano, e non li avevamo mai guardati. Dicono
 * due cose nette:
 *
 *   L'INTERVALLO fra le estreme, e dove cade. Unisono e ottava valgono il 22% sul tempo
 *   forte e solo l'11% sul debole: sono la sonorità d'ARRIVO, atterrano sul battere. Sul
 *   tempo debole comandano terze e quinte, che sono di passaggio.
 *
 *   IL MOTO fra un accordo e l'altro: contrario 49%, retto 28%, obliquo 21%. Il moto
 *   contrario non è una preferenza da manuale, è quasi la metà di tutto ciò che è stato
 *   scritto.
 */

/** Quanto ci si aspetta questo intervallo fra soprano e basso, qui. Zero = è il più comune. */
export function costoIntervalloEstremi(isMinor: boolean, forte: boolean, semitoni: number): number {
    const PESO = 3;
    const tab = delModo(isMinor).intervalliEstremi?.[forte ? 'forte' : 'debole'];
    if (!tab) return 0;
    let totale = 0, massimo = 0;
    for (const v of Object.values(tab)) { totale += v; if (v > massimo) massimo = v; }
    if (totale <= 0 || massimo <= 0) return 0;
    const iv = ((semitoni % 12) + 12) % 12;
    return (1 - (tab[String(iv)] ?? 0) / massimo) * PESO * fiducia(totale);
}

/**
 * Quanto costa muovere le estreme in questo modo. Zero = il moto più consueto (contrario).
 *
 * Va chiesto dove le note sono VERE. Provato dentro la scelta della progressione, dove del
 * basso si conosce solo la classe d'altezza: «sale o scende» diventa una supposizione (si
 * prende il tragitto più breve fra le due classi) e il responso è ambiguo — meno errori e
 * meno retrocessioni, ma più avvisi e più altalene. Nel realizzatore invece soprano e basso
 * sono due numeri, e la domanda ha una risposta sola.
 *
 * Non prende il modo: fra maggiore e minore la differenza è di un punto percentuale, e non
 * vale infilare un parametro lungo tutta la catena di `scoreVoicing` per quello.
 */
export function costoMotoEstremi(tipo: 'contrario' | 'retto' | 'obliquo'): number {
    const PESO = 2.5;
    const tab: { [k: string]: number } = {};
    for (const m of [stats.major, stats.minor]) {
        for (const [k, v] of Object.entries(m.motoEstremi || {})) tab[k] = (tab[k] ?? 0) + v;
    }
    if (!Object.keys(tab).length) return 0;
    let totale = 0, massimo = 0;
    for (const v of Object.values(tab)) { totale += v; if (v > massimo) massimo = v; }
    if (totale <= 0 || massimo <= 0) return 0;
    return (1 - (tab[tipo] ?? 0) / massimo) * PESO * fiducia(totale);
}


/**
 * COME CHIUDE UNA FRASE, SECONDO DOVE STA NEL BRANO.
 *
 * È il criterio che risponde alla domanda «dove va messo un gesto», che la statistica da sola
 * non pone. Un percorso che prende sempre il costo minimo riproduce la MODA di un modello
 * probabilistico, non la sua distribuzione: dove il corpus dice «dopo il V, il I al 60% e il
 * vi al 12%», chi sceglie il migliore scrive `V→I` il cento per cento delle volte. La cadenza
 * d'inganno non si conquista alzandole il peso — si conquista dicendo DOVE sta.
 *
 * E il posto ce l'ha. Detto dall'utente: «in un compito scolastico una cadenza d'inganno la
 * metterei in una parte intermedia della composizione, non subito all'inizio o verso la
 * fine». Il corpus lo conferma, e generalizza il principio a tutti i gradi di deviazione:
 *
 *      chiude su      1ª frase   interne   ultima
 *      I (maggiore)      27%       20%      56%
 *      vi                 5%        9%       6%
 *      III (minore)       8%       15%       ~0%
 *      ♭VII               —         7%       ~0%
 *
 * L'ultima frase conclude — la tonica al 56% in maggiore. I gradi che NEGANO la chiusura
 * stanno in mezzo, perché ciò che nega una chiusura ha bisogno di un seguito, e nell'ultima
 * frase il seguito non c'è.
 *
 * Sostituisce l'asse antecedente/conseguente, che diceva una cosa vera ma più debole: in un
 * brano di quattro frasi la seconda e la quarta sono tutt'e due «conseguenti», e la
 * differenza fra chiudere a metà e chiudere alla fine andava persa.
 */
export type PosizioneFrase = 'prima' | 'interna' | 'ultima';

export function pesiDiChiusura(isMinor: boolean, posizione: PosizioneFrase): Record<number, number> | null {
    const nomi = etichette(isMinor);
    const tab = delModo(isMinor).chiusurePosizione?.[posizione];
    if (!tab) return null;
    const conti = nomi.map(gruppo => somma(tab, gruppo));
    const totale = conti.reduce((a, b) => a + b, 0);
    if (totale <= 0) return null;
    const massimo = Math.max(...conti, 1);
    const f = fiducia(totale);
    const generici = pesiDeiGradi(isMinor);
    const fuori: Record<number, number> = {};
    for (let deg = 0; deg < 7; deg++) {
        // Dove il campione è scarso — l'ultima frase in minore ne ha meno di cinquanta — si
        // torna verso i pesi generici invece di inventare una consuetudine.
        fuori[deg] = (1 - f) * (generici[deg] ?? 1) + f * pesoDaConto(conti[deg], massimo);
    }
    return fuori;
}


/**
 * QUALE NOTA DELL'ACCORDO SI RADDOPPIA.
 *
 * Domanda del REALIZZATORE, non della scelta dell'armonia: si pone quando le quattro note
 * esistono. I raddoppi sbagliati erano il primo addebito rimasto al generatore.
 *
 * ── LA REGOLA ─────────────────────────────────────────────────────────────────────────
 *
 * Si raddoppia la fondamentale, in seconda battuta la quinta. La terza no — MA la vera
 * discriminante non è quale nota dell'accordo sia: è **che grado della tonalità** sia quella
 * nota. Se è un grado TONALE — I, IV o V della tonalità — va bene anche se è la terza
 * dell'accordo: un `ii` può raddoppiare la propria terza, perché quella terza è il quarto
 * grado. Un `V` invece non può, perché la sua terza è la sensibile.
 *
 * E nella quarta e sesta si raddoppia il BASSO, che è la quinta dell'accordo.
 *
 * ── COSA DICE IL CORPUS ───────────────────────────────────────────────────────────────
 *
 * Confermato, sui 380 brani:
 *
 *   stato fondamentale   fondamentale 86%, e delle poche terze raddoppiate il 63% è un
 *                        grado tonale (in minore il 75%)
 *   primo rivolto        fondamentale 44%, terza 34%, quinta 20% — e lì tonale e modale si
 *                        equivalgono: il primo rivolto è davvero il rivolto libero
 *   quarta e sesta       la quinta, cioè il basso, l'86%
 *
 * I numeri qui sotto seguono quella forma: severi dove la distribuzione è ripida (lo stato
 * fondamentale, la quarta e sesta), quasi indifferenti dove è piatta (il primo rivolto).
 *
 * @param inv rivolto: 0 fondamentale, 1 primo, 2 quarta e sesta, 3 terzo.
 * @param membro l'intervallo sopra la fondamentale della nota raddoppiata: 0, 3/4, 6/7/8, 10/11.
 * @param gradoDaTonica semitoni fra la nota raddoppiata e la tonica del brano.
 */
export function costoDelRaddoppio(inv: number, membro: number, gradoDaTonica: number): number {
    const g = ((gradoDaTonica % 12) + 12) % 12;
    // I gradi TONALI stanno a 0, 5 e 7 semitoni dalla tonica in tutt'e due i modi.
    const tonale = g === 0 || g === 5 || g === 7;
    const famiglia = (membro === 0) ? 'fondamentale'
        : (membro === 3 || membro === 4) ? 'terza'
        : (membro === 6 || membro === 7 || membro === 8) ? 'quinta'
        : 'settima';

    // ── CIÒ CHE HA OBBLIGO DI RISOLUZIONE NON SI RADDOPPIA MAI ──
    //
    // Prima di ogni preferenza. Una nota che deve andare da qualche parte, raddoppiata, deve
    // andarci in DUE voci — e due voci che fanno lo stesso movimento obbligato sono ottave
    // parallele, o una risoluzione mancata. Non è questione di gusto o di stabilità: è che
    // la risoluzione non ci sta.
    //
    //   la SETTIMA dell'accordo, che è la dissonanza e scende di grado;
    //   la QUINTA quando è diminuita o eccedente, cioè quando forma un tritono o una
    //     eccedente con la fondamentale: anche lei è obbligata;
    //   la SENSIBILE della tonalità, che sale alla tonica.
    //
    // Il checker le sbarra già come veto (`R-10`, `R-10-DIM5`, `R-10-7TH`, `R-10-64`), ma il
    // veto arriva dopo: se la preferenza non le conosce, continua a PROPORLE e il veto deve
    // rifiutarle una per una. Meglio non proporle.
    const OBBLIGATA = 20;
    if (famiglia === 'settima') return OBBLIGATA;
    if (membro === 6 || membro === 8) return OBBLIGATA;   // quinta diminuita o eccedente
    if (g === 11) return OBBLIGATA;                       // la sensibile della tonalità
    // E le note CROMATICHE della tonalità: la tonica alzata e la quarta alzata sono estranee
    // in tutt'e due i modi, e quando compaiono è perché stanno tonicizzando qualcosa — cioè
    // sono sensibili di un'altra tonalità, con lo stesso obbligo.
    if (g === 1 || g === 6) return OBBLIGATA;
    if (inv === 2) {
        // Quarta e sesta: si raddoppia il basso, cioè la quinta.
        if (famiglia === 'quinta') return 0;
        return famiglia === 'fondamentale' ? 6 : 10;
    }
    if (inv === 1) {
        // Primo rivolto: il rivolto libero. Nessuna scelta è davvero fuori posto.
        if (famiglia === 'fondamentale') return 0;
        if (famiglia === 'quinta') return 1;
        return tonale ? 0.5 : 3;
    }
    // Stato fondamentale (e terzo rivolto, che si comporta allo stesso modo).
    if (famiglia === 'fondamentale') return 0;
    if (famiglia === 'quinta') return 3;
    return tonale ? 4 : 12;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHE ARMONIA SOTTO CHE NOTA
// ─────────────────────────────────────────────────────────────────────────────
/**
 * L'unica cosa che il corpus sapeva dire e nessuno gli chiedeva.
 *
 * Tutte le altre funzioni qui dentro guardano da accordo ad accordo: quale
 * grado e' frequente, quale segue quale, quale rivolto, quale raddoppio. La
 * MELODIA non entrava mai — nel generatore serviva solo a dire «questo accordo
 * contiene la nota?», che e' un test di appartenenza, non una scelta.
 *
 * Ma il grado che canta il soprano dice moltissimo. Misurato sul repertorio
 * d'autore, su 9316 armonie:
 *
 *     senza sapere la melodia   la prima vale 18,4%   le prime due 36,1%
 *     sapendo il grado          la prima vale 43,1%   le prime due 62,1%
 *
 * E in certi casi decide quasi da sola: la sensibile in minore sul battere e'
 * la dominante nell'88% dei casi; il ♭6 in minore e' il quarto grado nel 64%.
 *
 * Resta un PESO e non una regola — 43% vuol dire che suggerisce, non impone.
 */
type TavolaMelodia = Record<string, Record<string, Record<string, number>>>;
const melodia = melodiaJson as unknown as { MAG: TavolaMelodia; min: TavolaMelodia };

/** I gradi come li nomina la tavola: semitoni dalla tonica. */
const NOME_GRADO_MELODIA = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

/**
 * Quanto ci si aspetta QUESTA armonia sotto QUELLA nota di melodia, qui.
 *
 * @param semitoniDallaTonica  il grado del soprano, 0…11.
 * @param nomeCorpus  come il corpus chiama l'armonia (`I`, `ii°`, `V/V`, `♭VII`).
 * @returns 0 = quanto ci si aspetta normalmente; positivo = il repertorio la
 *   mette li' piu' spesso; negativo = meno. Zero anche quando il campione e'
 *   troppo magro per dire qualcosa, che e' il caso dei gradi cromatici rari.
 */
export function pesoSottoLaMelodia(
    isMinor: boolean,
    semitoniDallaTonica: number,
    forte: boolean,
    nomeCorpus: string,
): number {
    const grado = NOME_GRADO_MELODIA[((semitoniDallaTonica % 12) + 12) % 12];
    const tav = (isMinor ? melodia.min : melodia.MAG)?.[grado]?.[forte ? 'forte' : 'debole'];
    if (!tav) return 0;
    const conti = Object.values(tav);
    const totale = conti.reduce((a, b) => a + b, 0);
    if (totale < 20) return 0;              // troppo poco per dire qualcosa
    const massimo = Math.max(...conti, 1);
    const suo = tav[nomeCorpus] ?? 0;
    // Centrato sulla MEDIA della distribuzione: chi sta sopra la media guadagna,
    // chi sta sotto perde, e un'armonia mai vista sotto quella nota perde tutto.
    const media = totale / conti.length;
    const f = fiducia(totale);
    return f * ((suo - media) / massimo) * 10;
}

/**
 * Quanto ci si aspetta QUESTA armonia sopra QUEL basso.
 *
 * Gemella di `pesoSottoLaMelodia`, e serve al caso che nella didattica viene
 * per primo: il basso dato. Il basso e' MENO AMBIGUO del canto — misurato sul
 * repertorio, sapendo il suo grado la prima scelta vale il 57,3% contro il
 * 43,1% della melodia — perche' e' legato direttamente alla funzione, mentre
 * una nota di melodia puo' essere qualunque membro di molti accordi.
 *
 * Il quinto grado lo mostra meglio di ogni spiegazione:
 *     al SOPRANO   V 38%   I 38%    ← perfettamente ambiguo
 *     al BASSO     V 71%   I 17%
 *
 * La tavola tiene il solo GRADO, senza cifre: col basso dato il rivolto non e'
 * da scegliere — la nota al basso E' il basso — e il filtro delle pose lo fissa
 * gia'. Resta da decidere quale armonia, e a quella la tavola risponde.
 */
export function pesoSottoIlBasso(
    isMinor: boolean,
    semitoniDallaTonica: number,
    forte: boolean,
    nomeCorpus: string,
): number {
    const tavole = bassoJson as unknown as { MAG: TavolaMelodia; min: TavolaMelodia };
    const grado = NOME_GRADO_MELODIA[((semitoniDallaTonica % 12) + 12) % 12];
    const tav = (isMinor ? tavole.min : tavole.MAG)?.[grado]?.[forte ? 'forte' : 'debole'];
    if (!tav) return 0;
    const conti = Object.values(tav);
    const totale = conti.reduce((a, b) => a + b, 0);
    if (totale < 20) return 0;
    const massimo = Math.max(...conti, 1);
    const suo = tav[nomeCorpus] ?? 0;
    const media = totale / conti.length;
    return fiducia(totale) * ((suo - media) / massimo) * 10;
}
