// ─────────────────────────────────────────────────────────────────────────────
// Rilevatore di trasformazioni MELODICHE di un motivo (idea articolo "simmetria").
//
// Trova coppie modello → imitazione legate da:
//   • trasposizione (T)        intervalli uguali
//   • inversione (I)           intervalli negati (specchio)
//   • retrogrado (R)           letto al contrario
//   • retrogrado-inverso (RI)  combinazione
// in due "sapori": REALE (semitoni esatti) e TONALE (gradi diatonici / lettere).
//
// Opera sia DENTRO una voce (le simmetrie interne di una melodia) sia TRA voci
// diverse (imitazione contrappuntistica: soggetto in una voce → risposta, anche
// trasformata, in un'altra). È il riconoscimento speculare di melodicTransforms
// (che le GENERA), e distinto dal rilevatore ARMONICO (detectVoiceLeadingSequences,
// che lavora su voicing/progressioni d'accordo).
//
// Per limitare i falsi positivi: lunghezza minima, coerenza RITMICA (durate uguali
// per T/I, invertite per R/RI), solo match MASSIMALI (no sotto-segmenti), modello
// sempre prima dell'imitazione.
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffNote } from '../types';

export type MotifTransformType = 'transpose' | 'invert' | 'retrograde' | 'retrogradeInvert';
export type MotifMatchMode = 'tonal' | 'real';

export type MotifMatch = {
    type: MotifTransformType;
    mode: MotifMatchMode;
    modelVoice: number;
    imitationVoice: number;       // = modelVoice per i match dentro-voce
    length: number;               // numero di note del motivo
    modelNoteIds: string[];
    imitationNoteIds: string[];
    modelStartTick: number;
    modelEndTick: number;         // inclusivo (ultimo onset + durata)
    imitationStartTick: number;
    imitationEndTick: number;
};

export type MotifDetectionOptions = {
    minLen?: number;              // note minime di un motivo (default 4)
    maxLen?: number;              // note massime (default 16)
    voices?: number[];           // quali voci scandire (default: tutte le presenti)
    requireRhythm?: boolean;      // coerenza ritmica (default true)
    crossVoice?: boolean;         // rileva anche l'imitazione tra voci (default true)
    maxMatches?: number;          // tetto di sicurezza (default 200)
};

const LETTER_IDX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** Coordinata diatonica assoluta (per il confronto TONALE): ottava*7 + indice-lettera. */
function diatonicStep(n: any): number {
    const letter = String(n?.pitch || '').trim().charAt(0).toUpperCase();
    const li = LETTER_IDX[letter];
    const oct = Number(n?.octave);
    return (Number.isFinite(li) && Number.isFinite(oct)) ? oct * 7 + li : NaN;
}

type Line = {
    voice: number;
    ids: string[];
    midi: number[];
    step: number[];
    dur: number[];
    startTick: number[];
    endTick: number[];
};

/** Estrae le linee per-voce: solo note (no pause), ordinate per onset. */
function buildLines(notes: StaffNote[], voices?: number[]): Line[] {
    const byVoice = new Map<number, any[]>();
    for (const n of notes as any[]) {
        if (!n || n.isRest) continue;
        if (!Number.isFinite(Number(n.startTick))) continue;
        const v = Number(n.voice ?? 0);
        if (voices && !voices.includes(v)) continue;
        if (!byVoice.has(v)) byVoice.set(v, []);
        byVoice.get(v)!.push(n);
    }
    const lines: Line[] = [];
    for (const [voice, arr] of byVoice) {
        arr.sort((a, b) => Number(a.startTick) - Number(b.startTick));
        lines.push({
            voice,
            ids: arr.map(n => String(n.id)),
            midi: arr.map(n => Number(n.midi)),
            step: arr.map(n => diatonicStep(n)),
            dur: arr.map(n => Number(n.durationTicks ?? 0)),
            startTick: arr.map(n => Number(n.startTick)),
            endTick: arr.map(n => Number(n.startTick) + Number(n.durationTicks ?? 0)),
        });
    }
    return lines;
}

const valOf = (line: Line, mode: MotifMatchMode, idx: number): number =>
    mode === 'real' ? line.midi[idx] : line.step[idx];

function buildMatch(A: Line, mStart: number, B: Line, iStart: number, len: number, type: MotifTransformType, mode: MotifMatchMode): MotifMatch {
    return {
        type, mode, length: len,
        modelVoice: A.voice, imitationVoice: B.voice,
        modelNoteIds: A.ids.slice(mStart, mStart + len),
        imitationNoteIds: B.ids.slice(iStart, iStart + len),
        modelStartTick: A.startTick[mStart],
        modelEndTick: A.endTick[mStart + len - 1],
        imitationStartTick: B.startTick[iStart],
        imitationEndTick: B.endTick[iStart + len - 1],
    };
}

export function detectMotifTransformations(notes: StaffNote[], options?: MotifDetectionOptions): MotifMatch[] {
    const minLen = Math.max(3, Math.round(options?.minLen ?? 4));
    const maxLen = Math.max(minLen, Math.round(options?.maxLen ?? 16));
    const requireRhythm = options?.requireRhythm ?? true;
    const crossVoice = options?.crossVoice ?? true;
    const maxMatches = Math.max(1, Math.round(options?.maxMatches ?? 200));
    const modes: MotifMatchMode[] = ['real', 'tonal'];   // real prima (più specifico)

    const lines = buildLines(notes, options?.voices);
    const out: MotifMatch[] = [];
    const covered = new Set<string>();
    const keyOf = (av: number, mi: number, bv: number, ii: number, t: string) => `${av}|${mi}|${bv}|${ii}|${t}`;

    // Cross-voce: l'imitazione deve entrare STRETTAMENTE DOPO il modello. Due voci che
    // partono insieme con materiale correlato sono raddoppio/moto parallelo, non
    // imitazione (ed era la causa della "bracket all'inizio del brano").
    const ordered = (A: Line, mi: number, B: Line, ii: number): boolean =>
        B.startTick[ii] > A.startTick[mi];

    // ── T / I: modello in A (start i) ↔ imitazione in B (start j) ──
    const matchTI = (A: Line, B: Line, cross: boolean) => {
        const nA = A.midi.length, nB = B.midi.length;
        for (const mode of modes) {
            const intA = (idx: number) => valOf(A, mode, idx + 1) - valOf(A, mode, idx);
            const intB = (idx: number) => valOf(B, mode, idx + 1) - valOf(B, mode, idx);
            for (let i = 0; i + minLen <= nA; i++) {
                for (let j = 0; j + minLen <= nB; j++) {
                    if (!cross) { if (j < i + minLen) continue; }
                    else { if (!ordered(A, i, B, j)) continue; }
                    for (const type of ['transpose', 'invert'] as const) {
                        const sign = type === 'transpose' ? 1 : -1;
                        let len = 1;
                        while (
                            (i + len) < nA && (j + len) < nB &&
                            (cross || (i + len) <= j) &&
                            intB(j + len - 1) === sign * intA(i + len - 1) &&
                            // Ritmo della NOTA AGGIUNTA (offset len): stessa spaziatura d'onset
                            // dal precedente + stessa durata → modello e imitazione hanno lo
                            // STESSO span (banda e bracket di pari larghezza).
                            (!requireRhythm || (
                                (A.startTick[i + len] - A.startTick[i + len - 1]) === (B.startTick[j + len] - B.startTick[j + len - 1]) &&
                                A.dur[i + len] === B.dur[j + len]
                            )) &&
                            (len + 1) <= maxLen
                        ) { len++; }
                        if (len < minLen) continue;
                        if (!cross && (i + len) > j) continue;
                        const k = keyOf(A.voice, i, B.voice, j, type);
                        if (covered.has(k)) continue;
                        covered.add(k);
                        out.push(buildMatch(A, i, B, j, len, type, mode));
                    }
                }
            }
        }
    };

    // ── R / RI: modello in A (start i) ↔ imitazione in B (end e) ──
    // R:  vB(e-k) − vA(i+k) costante ;  RI: vB(e-k) + vA(i+k) costante.
    const matchRRI = (A: Line, B: Line, cross: boolean) => {
        const nA = A.midi.length, nB = B.midi.length;
        for (const mode of modes) {
            const vA = (idx: number) => valOf(A, mode, idx);
            const vB = (idx: number) => valOf(B, mode, idx);
            for (let i = 0; i + minLen <= nA; i++) {
                for (let e = nB - 1; e >= minLen - 1; e--) {
                    for (const type of ['retrograde', 'retrogradeInvert'] as const) {
                        const isRI = type === 'retrogradeInvert';
                        const c0 = isRI ? vB(e) + vA(i) : vB(e) - vA(i);
                        // Durata della coppia-ancora (modello i ↔ imitazione e): nel retrogrado
                        // l'ultima nota dell'imitazione = prima del modello → serve a far
                        // combaciare la durata TOTALE (e quindi lo span banda/bracket).
                        if (requireRhythm && B.dur[e] !== A.dur[i]) continue;
                        let len = 1;
                        while (true) {
                            const mi = i + len, ce = e - len;
                            if (mi >= nA || ce < 0) break;
                            if (!cross && mi > ce) break;
                            const c = isRI ? vB(ce) + vA(mi) : vB(ce) - vA(mi);
                            if (c !== c0) break;
                            if (requireRhythm && B.dur[ce] !== A.dur[mi]) break;
                            if (len + 1 > maxLen) break;
                            len++;
                        }
                        if (len < minLen) continue;
                        const iStart = e - len + 1;
                        if (!cross) { if (i + len > iStart) continue; }
                        else { if (!ordered(A, i, B, iStart)) continue; }
                        const kk = keyOf(A.voice, i, B.voice, iStart, type);
                        if (covered.has(kk)) continue;
                        covered.add(kk);
                        out.push(buildMatch(A, i, B, iStart, len, type, mode));
                    }
                }
            }
        }
    };

    // Dentro-voce
    for (const L of lines) { matchTI(L, L, false); matchRRI(L, L, false); }
    // Cross-voce (coppie ordinate distinte; il vincolo `ordered` evita i duplicati)
    if (crossVoice) {
        for (let a = 0; a < lines.length; a++) {
            for (let b = 0; b < lines.length; b++) {
                if (a === b) continue;
                matchTI(lines[a], lines[b], true);
                matchRRI(lines[a], lines[b], true);
            }
        }
    }

    // ── Deduplica per REGIONE: tieni la spiegazione migliore (più lunga; a parità
    // T > I > R > RI; reale > tonale). ──
    const TYPE_PRIORITY: Record<MotifTransformType, number> = { transpose: 0, invert: 1, retrograde: 2, retrogradeInvert: 3 };
    const best = new Map<string, MotifMatch>();
    for (const m of out) {
        const key = `${m.modelVoice}|${m.imitationVoice}|${m.modelStartTick}|${m.modelEndTick}|${m.imitationStartTick}|${m.imitationEndTick}`;
        const cur = best.get(key);
        if (!cur) { best.set(key, m); continue; }
        const better =
            m.length > cur.length ||
            (m.length === cur.length && TYPE_PRIORITY[m.type] < TYPE_PRIORITY[cur.type]) ||
            (m.length === cur.length && m.type === cur.type && m.mode === 'real' && cur.mode === 'tonal');
        if (better) best.set(key, m);
    }

    // Sopprimi i match interamente CONTENUTI (modello e imitazione) in un match
    // già accettato della stessa coppia di voci → via i sotto-segmenti.
    const ranked = [...best.values()].sort((a, b) => b.length - a.length || a.modelStartTick - b.modelStartTick);
    const within = (s: number, e: number, S: number, E: number) => s >= S && e <= E;
    const kept: MotifMatch[] = [];
    for (const m of ranked) {
        const contained = kept.some(k =>
            k.modelVoice === m.modelVoice && k.imitationVoice === m.imitationVoice &&
            within(m.modelStartTick, m.modelEndTick, k.modelStartTick, k.modelEndTick) &&
            within(m.imitationStartTick, m.imitationEndTick, k.imitationStartTick, k.imitationEndTick));
        if (!contained) kept.push(m);
        if (kept.length >= maxMatches) break;
    }
    return kept;
}
