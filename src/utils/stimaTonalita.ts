/**
 * STIMARE LA TONALITÀ DALLE SOLE ALTEZZE — serve all'import MIDI.
 *
 * ── PERCHÉ ────────────────────────────────────────────────────────────────────────────
 *
 * Un file MIDI non contiene alterazioni: contiene numeri. Il 61 non è né Do♯ né Re♭, e
 * quale delle due si scrive lo decide l'armatura. Quindi all'import la tonalità non è un
 * contorno: decide la grafia di ogni nota alterata del brano.
 *
 * Il formato prevede un messaggio che la dichiara (meta `0x59`), ma è inaffidabile in un
 * modo preciso: quando chi scrive il file non se ne occupa, ci finisce comunque il valore di
 * partenza — **zero diesis, maggiore**, cioè Do maggiore. Provato sui file di prova in
 * `tests/`: tre su quattro dichiarano Do maggiore, e fra questi la cantata 41 di Bach, che
 * in Do maggiore non è. Il quarto non dichiara niente.
 *
 * Da qui la regola dell'import:
 *
 *   dichiarazione DIVERSA da Do maggiore   →  è una scelta deliberata: si crede al file
 *   dichiarazione di Do maggiore, o nessuna →  è il silenzio del formato: si stima
 *
 * Non è una furbizia: è che quei due casi nel file si scrivono identici, e l'unico modo di
 * distinguerli è guardare le note.
 *
 * ── COME ──────────────────────────────────────────────────────────────────────────────
 *
 * Il metodo è quello di Krumhansl e Schmuckler, che è lo standard per questo problema. Si
 * conta quanto DURA ciascuna delle dodici altezze nel brano (la durata, non il numero di
 * attacchi: una semiminima tenuta pesa più di una biscroma di passaggio), e si confronta il
 * profilo che ne esce con ventiquattro profili di riferimento — uno per tonalità — misurati
 * su ascoltatori veri. Vince la correlazione più alta.
 *
 * Perché non basta contare le note fuori dalla scala: il modo. Le scale minori usate davvero
 * comprendono la sensibile alzata e spesso anche il sesto grado alzato, quindi come INSIEMI
 * di note sono più grandi di quelle maggiori e vincerebbero sempre, per il solo fatto di
 * contenere di più. I profili non hanno questo difetto perché non guardano se una nota c'è,
 * ma quanto pesa: nel minore la terza minore pesa molto e la maggiore poco, ed è quello a
 * distinguere i due modi.
 */

/** I profili di Krumhansl-Kessler, da Do. Indice = semitoni sopra la tonica. */
const PROFILO_MAGGIORE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILO_MINORE   = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Fondamentale maggiore per ciascuna classe d'altezza, nella grafia che l'app usa per le
 *  armature (quella del circolo delle quinte, non l'enarmonia più comoda). */
const MAGGIORE_PER_PC: Record<number, string> = {
    0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
    6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
};

export type StimaTonalita = {
    /** Fondamentale MAGGIORE relativa, nella convenzione di `keySignatureRoot`. */
    root: string;
    isMinor: boolean;
    /** Correlazione della vincitrice (−1…1). Sotto ~0,5 la stima è debole. */
    forza: number;
    /** Quanto stacca la seconda classificata: se è poco, le due letture si equivalgono. */
    distacco: number;
};

type NotaPerStima = { midi?: number; durationTicks?: number; isRest?: boolean };

function correlazione(peso: number[], profilo: number[], rotazione: number): number {
    let sx = 0, sy = 0;
    for (let i = 0; i < 12; i++) { sx += peso[(i + rotazione) % 12]; sy += profilo[i]; }
    const mx = sx / 12, my = sy / 12;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) {
        const a = peso[(i + rotazione) % 12] - mx;
        const b = profilo[i] - my;
        num += a * b; dx += a * a; dy += b * b;
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * Stima la tonalità di un insieme di note. `null` se non c'è abbastanza materiale.
 *
 * Restituisce la fondamentale nella convenzione dell'app (`keySignatureRoot` = MAGGIORE
 * relativa anche in minore): un brano stimato in Mi minore torna `{ root: 'G', isMinor: true }`.
 */
export function stimaTonalita(note: NotaPerStima[]): StimaTonalita | null {
    const peso = new Array(12).fill(0);
    let totale = 0;
    for (const n of note) {
        if (!n || n.isRest) continue;
        const midi = Number(n.midi);
        if (!Number.isFinite(midi) || midi <= 0) continue;
        // Le note senza durata dichiarata contano una volta: meglio contarle che ignorarle.
        const d = Number(n.durationTicks);
        const q = Number.isFinite(d) && d > 0 ? d : 480;
        peso[((midi % 12) + 12) % 12] += q;
        totale += q;
    }
    if (totale <= 0) return null;

    let miglioreR = 0, migliorePc = 0, miglioreMin = false;
    let secondaR = -2;
    for (let pc = 0; pc < 12; pc++) {
        for (const min of [false, true]) {
            const r = correlazione(peso, min ? PROFILO_MINORE : PROFILO_MAGGIORE, pc);
            if (r > miglioreR) {
                secondaR = miglioreR;
                miglioreR = r; migliorePc = pc; miglioreMin = min;
            } else if (r > secondaR) {
                secondaR = r;
            }
        }
    }

    // In minore la tonica stimata è quella VERA (La minore → pc 9); il campo `root` vuole
    // invece la maggiore relativa, che sta tre semitoni sopra.
    const pcArmatura = miglioreMin ? (migliorePc + 3) % 12 : migliorePc;
    return {
        root: MAGGIORE_PER_PC[pcArmatura] || 'C',
        isMinor: miglioreMin,
        forza: miglioreR,
        distacco: miglioreR - secondaR,
    };
}
