/**
 * ARMATURA IN VIGORE in un dato punto del brano.
 *
 * Finora l'armatura era una sola per tutto il pezzo e chiunque la leggeva prendeva
 * quella. Con i cambi a metà brano la domanda giusta non è più «qual è l'armatura» ma
 * «qual è l'armatura QUI» — ed è la stessa trasformazione che ha già subìto il metro.
 *
 * Modulo PURO: serve al disegno, alla grafia degli accidenti, all'analisi e ai collaudi.
 */
import type { KeySignatureChange } from '../types';

export interface ArmaturaInVigore {
    /** Fondamentale MAGGIORE relativa (convenzione del brano: Re minore → 'F'). */
    root: string;
    isMinor: boolean;
    /** Battuta da cui vale (0 = quella d'impianto). */
    daMisura: number;
}

/** Ordina e ripulisce i cambi: uno solo per battuta, l'ultimo scritto vince. */
export function normalizeKeyChanges(changes: KeySignatureChange[] | undefined): KeySignatureChange[] {
    const perMisura = new Map<number, KeySignatureChange>();
    for (const c of (changes || [])) {
        if (!c || !Number.isFinite(c.measureIndex) || c.measureIndex < 0) continue;
        if (!c.root) continue;
        perMisura.set(Math.round(c.measureIndex), { ...c, measureIndex: Math.round(c.measureIndex) });
    }
    return [...perMisura.values()].sort((a, b) => a.measureIndex - b.measureIndex);
}

/** L'armatura in vigore all'inizio di una battuta. */
export function keyAtMeasure(
    base: { root: string; isMinor: boolean },
    changes: KeySignatureChange[] | undefined,
    measureIndex: number,
): ArmaturaInVigore {
    let corrente: ArmaturaInVigore = { root: base.root, isMinor: !!base.isMinor, daMisura: 0 };
    for (const c of normalizeKeyChanges(changes)) {
        if (c.measureIndex > measureIndex) break;
        corrente = { root: c.root, isMinor: !!c.isMinor, daMisura: c.measureIndex };
    }
    return corrente;
}

/**
 * Cambia qualcosa all'inizio di questa battuta? Restituisce l'armatura NUOVA e quella
 * DA ANNULLARE (i bequadri che tolgono la precedente): senza l'annullamento, passando
 * da tre diesis a nessuno il rigo resterebbe muto e chi legge continuerebbe coi diesis.
 */
export function keyChangeAtMeasure(
    base: { root: string; isMinor: boolean },
    changes: KeySignatureChange[] | undefined,
    measureIndex: number,
): { nuova: string; daAnnullare: string } | null {
    const elenco = normalizeKeyChanges(changes);
    const qui = elenco.find(c => c.measureIndex === measureIndex);
    if (!qui) return null;
    // Un "cambio" verso la stessa armatura non è un cambio.
    const prima = keyAtMeasure(base, elenco.filter(c => c.measureIndex < measureIndex), measureIndex);
    if (prima.root === qui.root) return null;
    return { nuova: qui.root, daAnnullare: prima.root };
}
