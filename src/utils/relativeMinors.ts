/**
 * LA TONICA NON È IL CAMPO `keySignatureRoot`.
 *
 * Nei file del programma quel campo tiene sempre la fondamentale MAGGIORE relativa, anche
 * per un brano in minore: Re minore si scrive `'F'` + `isMinorMode`, Mi minore si scrive
 * `'G'`. È la convenzione dell'armatura (vedi `types.ts`, campo `root`), e va benissimo per
 * disegnare il rigo — l'armatura di Mi minore e quella di Sol maggiore sono la stessa cosa.
 *
 * Diventa una trappola appena il valore esce dal disegno e finisce dove serve la tonica
 * VERA: analisi, generatore, profilo di stile. Chi lo passa tale e quale sta dicendo «Sol
 * minore» a un brano in Mi minore, e da lì in poi ogni Mi e ogni Si naturale — cioè le note
 * di casa — diventano estranee alla tonalità.
 *
 * È già successo due volte, e tutt'e due sono costate: il banco di prova dei corali
 * misurava così ogni brano in minore (un corale dava 58 errori invece di 4), e il pannello
 * del generatore pre-compilava la tonica sbagliata. La tabella stava in una costante privata
 * dentro `GrandStaffEditor`, quindi chi ne aveva bisogno altrove non poteva vederla: qui è
 * condivisa perché la terza volta non succeda.
 */

/** Fondamentale maggiore → sua relativa minore. */
export const relativeMinors: { [major: string]: string } = {
    'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#', 'F#': 'D#', 'C#': 'A#',
    'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb', 'Cb': 'Ab'
};

/**
 * DUE GRAFIE PER LA STESSA TONALITÀ, E UNA TABELLA INDICIZZATA PER NOME.
 *
 * Il programma scrive la fondamentale d'armatura in due dialetti diversi:
 *
 *   il selettore   `keySignatureOptions.ts` offre i nomi VERI delle tonalità —
 *                  'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb' — ed è la grafia di questa tabella;
 *   le classi
 *   d'altezza      chi ricava la fondamentale da un numero (l'importatore MusicXML dalle
 *                  alterazioni in chiave, `ALL_NOTE_SPELLINGS`, `FLAT_MAJOR_ROOTS` in
 *                  `constants.ts`) usa i nomi col diesis: 'A#' STA PER Si♭ maggiore.
 *
 * Finché tutto passa per la classe d'altezza i due dialetti si equivalgono. Ma questa
 * conversione è indicizzata per NOME, e lì il secondo dialetto non trova niente: la
 * ripiega restituisce una radice maggiore dove serviva una tonica minore, e nessuno se ne
 * accorge perché non c'è nessun errore — il brano viene semplicemente analizzato in
 * un'altra tonalità.
 *
 * MISURATO: rompeva SEI armature su quindici, e sono quelle che contano — Sol minore, Do
 * minore, Fa minore, Si♭ minore, Mi♭ minore, La♭ minore, cioè ogni minore con l'armatura
 * in bemolle importato da MusicXML. Peggio: i due punti che facevano la conversione
 * ripiegavano in modo DIVERSO (qui la radice stessa, in `GrandStaffEditor` un 'A'
 * costante), quindi lo stesso brano usciva in due tonalità sbagliate diverse secondo chi
 * chiedeva.
 *
 * La cura non è aggiungere voci alla tabella ogni volta che ne salta fuori una: è
 * NORMALIZZARE PRIMA DI CERCARE, qui, in un punto solo.
 */

/** Le fondamentali che sono davvero nomi di tonalità: quelle offerte dal selettore. */
const RADICI_VERE = new Set(['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']);

/** Le grafie che una tonalità non ha: 'A#' non è un'armatura, Si♭ sì. */
const GRAFIE_ALTERNATIVE: { [alias: string]: string } = {
    'A#': 'Bb', 'D#': 'Eb', 'G#': 'Ab',
    'E#': 'F', 'B#': 'C', 'Fb': 'E', 'Abb': 'G', 'Bbb': 'A', 'Ebb': 'D',
};

/**
 * La fondamentale d'armatura scritta come la scrive il selettore.
 *
 * Le grafie che sono già nomi di tonalità restano com'erano — `C#` e `Db` sono due
 * armature DIVERSE (sette diesis e cinque bemolli) e non vanno confuse fra loro.
 */
export function radiceCanonica(keySignatureRoot: string): string {
    const r = String(keySignatureRoot || '').trim();
    if (!r) return 'C';
    if (RADICI_VERE.has(r)) return r;
    return GRAFIE_ALTERNATIVE[r] || r;
}

/**
 * La tonica vera di un brano, dati il campo `keySignatureRoot` e il modo.
 * In maggiore è la radice stessa; in minore è la sua relativa minore.
 */
export function tonicaReale(keySignatureRoot: string, isMinor: boolean): string {
    const radice = radiceCanonica(keySignatureRoot);
    if (!isMinor) return radice;
    return relativeMinors[radice] || radice;
}

/**
 * LA STRADA CONTRARIA: dalla tonica all'armatura che la scrive.
 *
 * Serve a chi riceve una tonica (un contesto d'analisi, il menù di modulazione) e deve
 * riempire un selettore d'armatura, che ragiona in fondamentali maggiori. Stava scritta a
 * mano dentro `GrandStaffEditor`, invertendo la tabella sul posto a ogni disegno del menù:
 * la conversione è UNA e sta qui, in tutt'e due i versi.
 */
export function radiceDiArmatura(tonica: string, isMinor: boolean): string {
    const t = radiceCanonica(tonica);
    if (!isMinor) return t;
    const trovata = Object.entries(relativeMinors).find(([, min]) => min === t || min === tonica);
    return trovata ? trovata[0] : t;
}
