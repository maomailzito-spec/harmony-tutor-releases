/**
 * ARTICOLAZIONI — dal segno scritto al suono.
 *
 * Stanno sulla NOTA (a differenza delle dinamiche, che valgono per tutto il brano) e,
 * come le dinamiche, non sono solo disegno: uno staccato accorcia davvero, un accento
 * si sente davvero. Un programma che insegna a scrivere deve far sentire la differenza
 * fra quello che si è scritto e quello che si sarebbe potuto scrivere.
 *
 * Modulo PURO: nessun React, nessuna geometria. Serve al disegno, al playback e ai
 * collaudi allo stesso modo.
 */
import type { ArticulationMark } from '../types';

/** Elenco e ordine in cui compaiono nella tavolozza. */
export const ARTICULATIONS: ArticulationMark[] = ['staccato', 'staccatissimo', 'accent', 'marcato', 'tenuto'];

/** Glifo VexFlow di ciascuna (codici della libreria, non simboli di comodo). */
export const ARTICULATION_VF_CODE: Record<ArticulationMark, string> = {
    staccato: 'a.',
    staccatissimo: 'av',
    accent: 'a>',
    marcato: 'a^',
    tenuto: 'a-',
};

/** Come si chiamano e come si disegnano nella tavolozza. */
export const ARTICULATION_UI: Record<ArticulationMark, { simbolo: string; nome: string }> = {
    staccato: { simbolo: '·', nome: 'Staccato' },
    staccatissimo: { simbolo: '▾', nome: 'Staccatissimo' },
    accent: { simbolo: '>', nome: 'Accento' },
    marcato: { simbolo: '^', nome: 'Marcato' },
    tenuto: { simbolo: '–', nome: 'Tenuto' },
};

/**
 * Effetto sul suono.
 *
 * `durationFactor` accorcia la nota; `gainFactor` la rinforza. L'accento agisce sul
 * VOLUME e non sulla sola velocity perché una nota inserita a mano, in un brano senza
 * segni di dinamica, non ha nessuna velocity: sommare a un numero che non c'è avrebbe
 * lasciato l'accento muto proprio nel caso più comune. `velocityDelta` serve in più,
 * quando la velocity c'è, per far scegliere allo strumento uno strato di campione più
 * brillante — cioè per cambiare il TIMBRO, non solo l'intensità.
 *
 * Il tenuto non cambia niente: la durata piena è già il comportamento normale. Vale
 * come segno scritto, e diventerà udibile il giorno in cui le note avranno un distacco
 * di serie fra l'una e l'altra.
 */
const EFFETTO: Record<ArticulationMark, { durationFactor: number; gainFactor: number; velocityDelta: number }> = {
    staccato: { durationFactor: 0.50, gainFactor: 1.00, velocityDelta: 0 },
    staccatissimo: { durationFactor: 0.35, gainFactor: 1.00, velocityDelta: 0 },
    accent: { durationFactor: 1.00, gainFactor: 1.30, velocityDelta: 18 },
    marcato: { durationFactor: 0.80, gainFactor: 1.45, velocityDelta: 26 },
    tenuto: { durationFactor: 1.00, gainFactor: 1.00, velocityDelta: 0 },
};

export interface ArticulationPlayback {
    durationFactor: number;
    gainFactor: number;
    velocityDelta: number;
}

const NESSUNO: ArticulationPlayback = { durationFactor: 1, gainFactor: 1, velocityDelta: 0 };

/** Effetto complessivo di più articolazioni sulla stessa nota (accento + staccato). */
export function articulationPlayback(marks: ArticulationMark[] | undefined): ArticulationPlayback {
    if (!marks || marks.length === 0) return NESSUNO;
    let durationFactor = 1, gainFactor = 1, velocityDelta = 0;
    for (const m of marks) {
        const e = EFFETTO[m];
        if (!e) continue;
        // Le durate si moltiplicano (staccatissimo + marcato accorcia due volte), il
        // rinforzo NON si somma: si tiene il più forte, altrimenti due segni insieme
        // sfondavano il livello.
        durationFactor *= e.durationFactor;
        gainFactor = Math.max(gainFactor, e.gainFactor);
        velocityDelta = Math.max(velocityDelta, e.velocityDelta);
    }
    return { durationFactor: Math.max(0.05, durationFactor), gainFactor, velocityDelta };
}
