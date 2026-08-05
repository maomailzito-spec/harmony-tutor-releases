/**
 * SEGNI D'OTTAVA — da quello che è scritto a quello che suona.
 *
 * L'altezza salvata è quella SCRITTA sul rigo; il segno dice che quel tratto suona
 * un'ottava sopra (8va) o sotto (8vb). Qui si traduce: dato un punto della linea del
 * tempo e la voce, quanti semitoni aggiungere.
 *
 * Modulo PURO: serve al playback, all'esportazione e ai collaudi allo stesso modo.
 */

/** Un segno d'ottava risolto sui tick, pronto da consultare durante l'esecuzione. */
export interface OctaveSpan {
    fromTick: number;
    toTick: number;
    /** Il segno vale per la voce in cui è stato scritto: un 8va sul soprano non
     *  trascina in alto il basso che suona nello stesso momento. */
    voice: number;
    direction: 'up' | 'down';
}

/**
 * Semitoni da aggiungere a una nota. Gli estremi sono COMPRESI: il segno copre anche
 * la nota su cui finisce, che è quella che si vede sotto la fine della parentesi.
 *
 * Più segni sovrapposti si sommano (un 15ma si scrive anche come due 8va): non è
 * scrittura comune, ma sommare è l'unica cosa che non perde informazione.
 */
export function octaveOffsetSemitones(spans: OctaveSpan[] | undefined, tick: number, voice: number): number {
    if (!spans || spans.length === 0) return 0;
    let semitoni = 0;
    for (const s of spans) {
        if (!s) continue;
        if (Number(s.voice) !== Number(voice)) continue;
        if (tick < s.fromTick - 1e-6 || tick > s.toTick + 1e-6) continue;
        semitoni += (s.direction === 'up' ? 12 : -12);
    }
    return semitoni;
}
