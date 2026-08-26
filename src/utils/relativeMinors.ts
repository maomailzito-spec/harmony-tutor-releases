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
 * La tonica vera di un brano, dati il campo `keySignatureRoot` e il modo.
 * In maggiore è la radice stessa; in minore è la sua relativa minore.
 */
export function tonicaReale(keySignatureRoot: string, isMinor: boolean): string {
    if (!isMinor) return keySignatureRoot;
    return relativeMinors[keySignatureRoot] || keySignatureRoot;
}
