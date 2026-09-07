/**
 * UNA FIGURA ARMONICA NON È UN ACCORDO: È UN TRATTO DI TEMPO.
 *
 * Il motore d'analisi ragiona per EVENTI — un evento ogni volta che una nota comincia o
 * finisce. È la griglia giusta per confrontare due accordi vicini, ed è quella sbagliata
 * per giudicare una figura che si distende: la figura ne occupa tre, di eventi, e chi ne
 * guarda uno solo sbaglia in tutti i modi in cui la figura può distendersi.
 *
 * Lo si è imparato scrivendo il controllo sul 6/4 cadenzale, che di quel giudizio è il
 * caso capostipite: cinque falsi positivi, e i due che contano sono lo STESSO fenomeno
 * visto dalle due parti —
 *
 *   la figura si forma PRIMA      il 6/4 scritto con la sospensione (il modo abituale di
 *                                 Bach) arriva per gradi: prima la quarta, poi la sesta.
 *                                 Guardando l'ultima fetta sembrava entrare su una
 *                                 suddivisione debole mentre stava sul battere da mezzo
 *                                 movimento;
 *   la figura si estende DOPO     nel Delachi il 6/4 prepara un ritardo: la quarta non
 *                                 risolve con la sesta, resta e risolve un movimento più
 *                                 in là. Il 6/4 sta sul debole PERCHÉ prepara, e una
 *                                 dissonanza preparata si prepara sul debole.
 *
 * Le funzioni di qui servono a dire dove una figura comincia, quanto dura e cosa lascia
 * dietro di sé, in modo che una regola possa leggerle invece di guardarsi intorno da sola.
 * Sono generiche apposta: qualunque regola che parli di posizione metrica ha lo stesso
 * problema e può usarle.
 */
import type { TimeSignature, TimeSignatureChange } from '../types';

/** Il minimo che serve a queste funzioni: un evento del motore d'analisi. */
export type EventoArmonico = {
    absBeat: number;
    measureIndex?: number;
    beat?: number;
    notes: any[];
};

const mod12 = (n: number) => (((n % 12) + 12) % 12);

const suonanti = (ev: EventoArmonico): any[] =>
    (ev?.notes || []).filter(n => n && !n.isRest && Number.isFinite(n.midi));

/** Il metro in vigore in una battuta: i cambi valgono dalla loro battuta in poi. */
export function metroAllaBattuta(
    misura: number,
    metroBase: TimeSignature,
    cambi?: TimeSignatureChange[],
): TimeSignature {
    let corrente = metroBase;
    for (const c of (cambi || []).slice().sort((a, b) => Number((a as any).measureIndex) - Number((b as any).measureIndex))) {
        if (!Number.isFinite(Number((c as any).measureIndex))) continue;
        if (Number((c as any).measureIndex) <= misura) {
            corrente = { numerator: Number((c as any).numerator), denominator: Number((c as any).denominator) } as TimeSignature;
        }
    }
    return corrente;
}

/**
 * PESO METRICO, non «forte o debole».
 *
 * Per confrontare due posizioni — questa sta più in basso di quella — un booleano non
 * basta: in 3/4 il secondo e il terzo movimento sono tutt'e due «non forti», ma il terzo
 * è più debole del primo, ed è lì che una cadenza composta si rovescia nel suo contrario.
 *
 * Il conto passa dall'UNITÀ DI MOVIMENTO e non dal quarto: in 3/2 la seconda semiminima
 * non è un movimento debole, non è un movimento affatto — è una suddivisione della prima
 * minima, e pesarla come la terza minima falsa ogni confronto. Vale allo stesso modo per
 * il tempo tagliato.
 *
 *   3 = battere
 *   2 = appoggio secondario (il terzo movimento in 4/4, le pulsazioni dei metri composti)
 *   1 = altro movimento pieno
 *   0 = suddivisione
 */
export function pesoMetrico(beat: number, ts: TimeSignature): number {
    if (!ts || !Number.isFinite(ts.numerator) || !Number.isFinite(ts.denominator)) return 0;
    const b0 = Number(beat) - 1;
    if (!Number.isFinite(b0)) return 0;

    // I metri composti pulsano per gruppi di tre: l'unità reale è il valore puntato.
    const composto = ts.denominator === 8 && ts.numerator % 3 === 0 && ts.numerator > 3;
    const unita = composto ? 1.5 : 4 / ts.denominator;
    const m = b0 / unita;
    if (Math.abs(m - Math.round(m)) > 1e-6) return 0;

    const mov = Math.round(m);
    if (mov === 0) return 3;
    if (composto) return 1;
    if (ts.denominator === 4 && ts.numerator === 4 && mov === 2) return 2;
    return 1;
}

/**
 * DOVE COMINCIA DAVVERO un'armonia.
 *
 * Si torna indietro finché il basso è LA STESSA NOTA e le classi d'altezza sono un
 * sottoinsieme di quelle di qui: cioè finché quel che si sente è la stessa armonia ancora
 * incompleta, che è come si presenta ogni figura che arriva per gradi.
 */
export function iniziaArmonia(
    eventi: EventoArmonico[],
    idx: number,
    bassoDi: (ev: EventoArmonico) => any,
): number {
    const pcsDi = (ev: EventoArmonico) => new Set(suonanti(ev).map(n => mod12(n.midi)));
    const pcsQui = pcsDi(eventi[idx]);
    const bassoQui = bassoDi(eventi[idx]);
    if (!bassoQui) return idx;
    let k = idx;
    while (k > 0) {
        const prima = eventi[k - 1];
        const bassoPrima = bassoDi(prima);
        if (!bassoPrima || bassoPrima.id !== bassoQui.id) break;
        let dentro = true;
        pcsDi(prima).forEach(x => { if (!pcsQui.has(x)) dentro = false; });
        if (!dentro) break;
        k--;
    }
    return k;
}

/** Quanto DURA un'armonia: fino al primo evento che cambia accordo. */
export function duraArmonia(eventi: EventoArmonico[], idx: number): number {
    const impronta = (ev: EventoArmonico) =>
        Array.from(new Set(suonanti(ev).map(n => mod12(n.midi)))).sort((x, y) => x - y).join('.');
    const qui = impronta(eventi[idx]);
    for (let k = idx + 1; k < eventi.length; k++) {
        if (impronta(eventi[k]) !== qui) return eventi[k].absBeat - eventi[idx].absBeat;
    }
    const ultimo = eventi[eventi.length - 1];
    const coda = suonanti(ultimo).reduce((m, n) => Math.max(m, Number(n.durationTicks) || 0), 0) / 480;
    return (ultimo.absBeat + coda) - eventi[idx].absBeat;
}

/** La figura del 6/4 come TRATTO, con i suoi tre momenti. */
export type FiguraSeiQuattro = {
    /** L'evento in cui la dissonanza ENTRA (non l'ultima fetta in cui si completa). */
    inizio: number;
    /** L'evento prima che la figura cominci, se c'è. */
    primaDi: EventoArmonico | null;
    /** Da quando entra a quando risolve. */
    durata: number;
    /** Quanto dura la risoluzione: fino all'evento seguente, perché una dominante
     *  prolungata oltre la cadenza non rende «breve» il 6/4 che la precede. */
    durataRisoluzione: number;
    /** Le dissonanze (quarta o sesta sopra il basso) che nella risoluzione SUONANO ANCORA:
     *  se ce n'è una, la figura non si chiude qui e il 6/4 stava preparando un ritardo. */
    dissonanzeTenute: any[];
};

export function figuraSeiQuattro(
    eventi: EventoArmonico[],
    idx: number,
    bassoDi: (ev: EventoArmonico) => any,
): FiguraSeiQuattro | null {
    const sei = eventi[idx];
    const risoluzione = eventi[idx + 1];
    if (!sei || !risoluzione) return null;
    const basso = bassoDi(sei);
    if (!basso) return null;

    const inizio = iniziaArmonia(eventi, idx, bassoDi);
    const dopo = eventi[idx + 2];

    const eDissonanza = (n: any) => {
        const i = mod12(n.midi - basso.midi);
        return i === 5 || i === 8 || i === 9;   // quarta, sesta minore, sesta maggiore
    };
    const dissonanzeTenute = suonanti(sei)
        .filter(eDissonanza)
        .filter(n => suonanti(risoluzione).some(m => m.midi === n.midi));

    return {
        inizio,
        primaDi: inizio > 0 ? eventi[inizio - 1] : null,
        durata: risoluzione.absBeat - eventi[inizio].absBeat,
        durataRisoluzione: dopo ? dopo.absBeat - risoluzione.absBeat : duraArmonia(eventi, idx + 1),
        dissonanzeTenute,
    };
}
