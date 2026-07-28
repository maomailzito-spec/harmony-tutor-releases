import type { Voice } from '../types';

/**
 * Numero di PARTI del coro. Il progetto nasce a quattro (SATB); riducendo si scrive
 * a tre o a due parti, primo passo verso le scritture non-SATB (contrappunto).
 */
export type PartCount = 2 | 3 | 4;

/**
 * Voci attive per numero di parti. La convenzione è: si tengono sempre le due voci
 * ESTREME (Soprano e Basso) e si tolgono le interne dal basso verso l'alto, perché
 * la voce più grave deve restare il BASSO — è a lui che sono agganciate le regole
 * su rivolti, raddoppi e moto delle parti estreme.
 *   4 → S A T B   ·   3 → S A B   ·   2 → S B
 */
export const activeVoicesForPartCount = (parts: PartCount): Voice[] =>
    parts === 2 ? [1, 4] : parts === 3 ? [1, 2, 4] : [1, 2, 3, 4];

/** Voci NON scrivibili con questo numero di parti (3 → il Tenore; 2 → Contralto e Tenore). */
export const inactiveVoicesForPartCount = (parts: PartCount): Voice[] =>
    ([1, 2, 3, 4] as Voice[]).filter(v => !activeVoicesForPartCount(parts).includes(v));

export const isVoiceActive = (voice: number, parts: PartCount): boolean =>
    activeVoicesForPartCount(parts).includes(voice as Voice);

/** Normalizza un valore letto da file/localStorage (assente o strano = quattro parti). */
export const normalizePartCount = (value: unknown): PartCount => {
    const n = Number(value);
    return n === 2 || n === 3 ? (n as PartCount) : 4;
};

/**
 * Voce attiva più vicina a quella richiesta (per non restare "fermi" su una voce
 * spenta dopo aver ridotto le parti): a parità di distanza si scende verso il basso.
 */
export const nearestActiveVoice = (voice: Voice, parts: PartCount): Voice => {
    const active = activeVoicesForPartCount(parts);
    if (active.includes(voice)) return voice;
    let best = active[0];
    let bestDist = Math.abs(active[0] - voice);
    for (const v of active) {
        const d = Math.abs(v - voice);
        if (d < bestDist || (d === bestDist && v > best)) { best = v; bestDist = d; }
    }
    return best;
};

/** Etichetta breve della voce (S/A/T/B), indipendente dalla lingua. */
export const voiceShortLabel = (voice: number): string =>
    voice === 1 ? 'S' : voice === 2 ? 'A' : voice === 3 ? 'T' : 'B';
