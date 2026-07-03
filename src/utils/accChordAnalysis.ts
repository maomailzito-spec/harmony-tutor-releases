// ─────────────────────────────────────────────────────────────────────────────
// Riduzione accordale di una traccia di ACCOMPAGNAMENTO (piano/chitarra che
// accompagna) → sigla (+ numero romano a richiesta), con RITMO ARMONICO dedotto.
//
// Percorso PARALLELO e indipendente dalla pipeline SATB: non tocca il motore
// d'analisi corale. Riusa solo il cuore agnostico alla tessitura
// (`identifyChordCandidates` / `getChordSymbol` / `getRomanAnalysis`).
//
// Strategia (v2, "segmentazione a chiarezza d'accordo"):
//   • per ogni MISURA si prova a tagliarla sulla griglia dei MOVIMENTI e si sceglie,
//     via programmazione dinamica, la suddivisione che massimizza la CHIAREZZA totale
//     (quanto ogni segmento forma UN solo accordo pulito) meno una penalità per ogni
//     taglio in più (anti-frammentazione);
//   • così un arpeggio che riempie la misura resta UN accordo, ma se la misura contiene
//     due armonie (es. minima + minima) i confini emergono da soli → la DURATA
//     dell'accordo (minima/semiminima/…) è data dalla lunghezza del segmento;
//   • DEDUP consecutivi: un'etichetta solo dove l'armonia CAMBIA (resa lead-sheet).
// Griglia = il movimento (v1). Raffinamenti rimandati: mezzo-movimento (arpeggi più
// corti), metri con cambi, de-pedalatura.
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffNote, KeySignature } from '../types';
import { TICKS_PER_QUARTER } from '../constants';
import { getChordSymbol, getRomanAnalysis, identifyChordCandidates } from './musicTheory';

export type AccChordLabel = {
    absBeat: number;
    sigla?: string;
    roman?: string;
    figures?: string[];
};

// Penalità per ogni taglio in più: più alta → meno segmenti (verso il per-misura).
const SEGMENT_PENALTY = 0.35;
// Penalità per pitch-class oltre le 4: un segmento con troppe note distinte è
// probabilmente la FUSIONE di due armonie → conviene tagliarlo.
const FOREIGN_PC_PENALTY = 0.30;

/** Quanto un insieme di note forma UN solo accordo pulito (0 = nulla/ambiguo, ~1 = triade/7ª esatta). */
function clarityOf(segNotes: StaffNote[], orn?: Record<string, string>): number {
    if (!segNotes.length) return -0.5; // segmento vuoto: non isolarlo (si fonde col vicino)
    const pcs = new Set<number>();
    for (const n of segNotes) {
        const m = Number(n.midi);
        if (Number.isFinite(m)) pcs.add(((m % 12) + 12) % 12);
    }
    if (pcs.size === 0) return -0.5;
    if (pcs.size === 1) return 0.15; // una sola altezza: non è un accordo

    let best: any = null;
    try {
        const cands = identifyChordCandidates(segNotes as any, orn);
        best = cands && cands.length ? cands[0] : null;
    } catch { /* */ }
    if (!best) return 0.1;

    let base = best.matchType === 'exact' ? 1.0
        : (best.matchType === 'no_fifth' || best.matchType === 'no_third') ? 0.55
        : 0.3;
    base -= FOREIGN_PC_PENALTY * Math.max(0, pcs.size - 4);
    return Math.max(0, base);
}

export function computeAccChordAnalysis(opts: {
    notes: StaffNote[];
    keySignature: KeySignature;
    keySignatureRoot: string;
    isMinorMode: boolean;
    timeSignature?: { numerator: number; denominator: number };
    /** Marcatura 'structural' (ri-orientata sulla traccia ACC): rifinisce l'analisi. */
    ornOverrides?: Record<string, string>;
}): AccChordLabel[] {
    const { notes, keySignature, keySignatureRoot, isMinorMode, ornOverrides } = opts;
    const pitched = (notes || []).filter(n =>
        n && !n.isRest && Number.isFinite(Number(n.midi)) && Number.isFinite(Number(n.startTick)));
    if (pitched.length < 2) return [];

    const TPQ = TICKS_PER_QUARTER;
    const ts = (opts.timeSignature && opts.timeSignature.numerator) ? opts.timeSignature : { numerator: 4, denominator: 4 };
    const ticksPerBeat = TPQ * 4 / ts.denominator;
    const beatsPerMeasure = Math.max(1, Math.round(ts.numerator));
    const ticksPerMeasure = ticksPerBeat * beatsPerMeasure;

    // Raggruppa le note per MISURA (onset).
    const byMeasure = new Map<number, StaffNote[]>();
    for (const n of pitched) {
        const mi = Math.floor(Number(n.startTick) / ticksPerMeasure);
        if (!byMeasure.has(mi)) byMeasure.set(mi, []);
        byMeasure.get(mi)!.push(n);
    }

    const out: AccChordLabel[] = [];
    let lastKey = '';
    const emit = (segNotes: StaffNote[], winStartTick: number) => {
        const seen = new Map<number, StaffNote>();
        for (const n of segNotes) { const m = Number(n.midi); if (!seen.has(m)) seen.set(m, n); }
        const chord = [...seen.values()];
        if (chord.length < 2) return;
        const sigla = getChordSymbol(chord as any, keySignature) || undefined;
        const rr = getRomanAnalysis(chord as any, keySignatureRoot, isMinorMode,
            ornOverrides ? { ornamentOverrides: ornOverrides } : undefined);
        const roman = rr?.roman || undefined;
        const figures = (rr?.figures && rr.figures.length) ? rr.figures : undefined;
        if (!sigla && !roman) return;
        const key = `${sigla ?? ''}|${roman ?? ''}`;
        if (key === lastKey) return; // dedup: solo al CAMBIO d'accordo
        lastKey = key;
        // Posiziona al primo ONSET dentro la finestra (una nota tenuta da prima non sposta
        // l'etichetta indietro); se nessuna nota inizia qui, all'inizio della finestra.
        const onsets = segNotes.map(n => Number(n.startTick)).filter(s => s >= winStartTick);
        const absTick = onsets.length ? Math.min(...onsets) : winStartTick;
        out.push({ absBeat: absTick / TPQ, sigla, roman, figures });
    };

    for (const mi of [...byMeasure.keys()].sort((a, b) => a - b)) {
        const measureStart = mi * ticksPerMeasure;
        const B = beatsPerMeasure;
        const winTick = (k: number): number => measureStart + k * ticksPerBeat;

        // Note SONANTI nella finestra [winTick(i), winTick(j)): una nota lunga (es. un basso
        // tenuto) conta in OGNI movimento che attraversa, non solo dove inizia. Si guarda
        // tutta la traccia (`pitched`) così valgono anche le legature oltre la stanghetta.
        const soundingIn = (i: number, j: number): StaffNote[] => {
            const a = winTick(i), b = winTick(j);
            return pitched.filter(n => {
                const s = Number(n.startTick);
                const e = s + Number(n.durationTicks ?? 0);
                return s < b && e > a;
            });
        };

        // Chiarezza memoizzata di ogni segmento [i, j).
        const clarMemo: number[][] = Array.from({ length: B + 1 }, () => new Array(B + 1).fill(NaN));
        const clarity = (i: number, j: number): number => {
            if (!Number.isNaN(clarMemo[i][j])) return clarMemo[i][j];
            const v = clarityOf(soundingIn(i, j), ornOverrides);
            clarMemo[i][j] = v;
            return v;
        };

        // DP: dp[j] = miglior punteggio per la porzione [0, j) di misura; back[j] = inizio dell'ultimo segmento.
        const dp = new Array(B + 1).fill(-Infinity);
        const back = new Array(B + 1).fill(0);
        dp[0] = 0;
        for (let j = 1; j <= B; j++) {
            for (let i = 0; i < j; i++) {
                if (dp[i] === -Infinity) continue;
                const score = dp[i] + clarity(i, j) - SEGMENT_PENALTY;
                if (score > dp[j]) { dp[j] = score; back[j] = i; }
            }
        }

        // Ricostruzione dei segmenti (in ordine) ed emissione.
        const segs: Array<[number, number]> = [];
        let j = B;
        while (j > 0) { const i = back[j]; segs.unshift([i, j]); j = i; }
        for (const [i, jj] of segs) emit(soundingIn(i, jj), winTick(i));
    }

    return out;
}
