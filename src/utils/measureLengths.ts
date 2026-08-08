/**
 * DURATA REALE DELLE BATTUTE — quando una battuta non dura quanto dice il metro.
 *
 * Il programma è nato assumendo che ogni battuta duri esattamente quanto il metro in
 * vigore, e quell'assunzione è cablata in cinque punti che ricostruiscono la griglia
 * delle battute accumulando `acc += battutePerMisura(m)`. Regge finché la musica è
 * regolare, e si rompe su tutto il resto: battute di levare, battute d'aggiunta,
 * cadenze, e i file veri.
 *
 * Il caso che l'ha fatta emergere: una Fantaisie di Weiss esportata da Sibelius, dove
 * la battuta 15 contiene CINQUE semiminime in 4/4 — venti semicrome in una voce e
 * 1+2+1+½+½ nell'altra, col `<backup>` di 1280 unità (= 5 semiminime a 256 per
 * semiminima) che lo conferma. In MusicXML è legale: una battuta porta la propria
 * durata, indipendente dal metro, e MuseScore la disegna più lunga senza battere
 * ciglio. Noi invece facevamo cominciare la battuta 16 al movimento 60 mentre la
 * musica diceva 61, e la semiminima in più finiva disegnata sopra il primo movimento
 * della battuta dopo. In quel file succede in 26 battute su 65.
 *
 * Qui sta l'eccezione, in forma SPARSA: solo le battute che si discostano dal metro
 * hanno una voce. Una partitura regolare non ne ha nessuna e non paga niente.
 */
import type { MeasureLength } from '../types';

/** Le eccezioni indicizzate per battuta, ripulite. */
export function measureLengthMap(lengths: MeasureLength[] | null | undefined): Map<number, number> {
    const out = new Map<number, number>();
    for (const l of lengths || []) {
        if (!l || !Number.isFinite(l.measureIndex as number) || !Number.isFinite(l.beats as number)) continue;
        const m = Math.max(0, Math.round(Number(l.measureIndex)));
        const b = Number(l.beats);
        // Una durata nulla o negativa non è una battuta: si scarta invece di
        // mandare in stallo chi accumula la griglia.
        if (!(b > 0)) continue;
        out.set(m, b);
    }
    return out;
}

/**
 * Durata di una battuta, in semiminime: l'eccezione se c'è, altrimenti il metro.
 *
 * È la funzione che va infilata in OGNI punto che costruisce la griglia — se ne resta
 * fuori uno, quel punto legge le battute su una griglia diversa dagli altri, ed è
 * peggio che non averla affatto.
 */
export function beatsOfMeasure(
    measureIndex: number,
    nominalBeats: number,
    overrides: Map<number, number> | null | undefined,
): number {
    const eccezione = overrides?.get(measureIndex);
    if (typeof eccezione === 'number' && eccezione > 0) return eccezione;
    return Math.max(1e-6, Number.isFinite(nominalBeats) ? nominalBeats : 4);
}

/**
 * Le eccezioni ricavate dalle note: per ogni battuta, quanto CONTIENE davvero.
 *
 * Serve dopo un import (dove la durata la detta il file) e come rete di sicurezza per
 * i progetti vecchi, salvati prima che questa nozione esistesse. Si guarda la voce
 * più lunga: le altre, se sono più corte, sono semplicemente incomplete — è un altro
 * problema, e lo segnala il rilevatore delle misure incomplete.
 */
export function measureLengthsFromNotes(
    notes: Array<{ measureIndex?: number; startTick?: number; durationTicks?: number }>,
    ticksPerQuarter: number,
    nominalBeatsOf: (measureIndex: number) => number,
): MeasureLength[] {
    const finePerMisura = new Map<number, number>();
    const inizioPerMisura = new Map<number, number>();
    for (const n of notes || []) {
        const m = Number(n?.measureIndex);
        const st = Number(n?.startTick);
        const dt = Number(n?.durationTicks);
        if (!Number.isFinite(m) || !Number.isFinite(st)) continue;
        const fine = st + (Number.isFinite(dt) && dt > 0 ? dt : 0);
        const mi = Math.max(0, Math.round(m));
        inizioPerMisura.set(mi, Math.min(inizioPerMisura.get(mi) ?? Infinity, st));
        finePerMisura.set(mi, Math.max(finePerMisura.get(mi) ?? -Infinity, fine));
    }
    const out: MeasureLength[] = [];
    for (const [mi, fine] of finePerMisura) {
        const inizio = inizioPerMisura.get(mi);
        if (inizio == null || !Number.isFinite(inizio)) continue;
        const beats = (fine - inizio) / ticksPerQuarter;
        if (!(beats > 0)) continue;
        const nominale = nominalBeatsOf(mi);
        // Solo ciò che si discosta davvero: un arrotondamento non è un'eccezione.
        if (Math.abs(beats - nominale) < 1e-6) continue;
        out.push({ measureIndex: mi, beats });
    }
    return out.sort((a, b) => a.measureIndex - b.measureIndex);
}
