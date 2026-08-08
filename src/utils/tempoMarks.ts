/**
 * SEGNI DI METRONOMO — dal segno scritto ai conti della riproduzione.
 *
 * Il segno conserva l'unità com'è stampata («𝅗𝅥 = 70»); tutto il resto del programma
 * ragiona in semiminime al minuto. Qui sta la conversione, in un posto solo, perché
 * sbagliarla vuol dire suonare al doppio o alla metà — ed è già successo leggendo
 * `<per-minute>` senza guardare `<beat-unit>`.
 */
import type { TempoMark } from '../types';

/** Quante semiminute vale un'unità di battito. */
const QUARTERS_PER_UNIT: Record<NonNullable<TempoMark['beatUnit']>, number> = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    sixteenth: 0.25,
};

/** Glifo Unicode dell'unità, per scriverlo sulla partitura. */
const GLYPH: Record<NonNullable<TempoMark['beatUnit']>, string> = {
    whole: '\u{1D15D}',      // 𝅝
    half: '\u{1D15E}',       // 𝅗𝅥
    quarter: '♩',       // ♩
    eighth: '♪',        // ♪
    sixteenth: '\u{1D161}',  // 𝅘𝅥𝅯
};

/** Il segno riportato alla SEMIMINIMA: è l'unica misura con cui si fanno i conti. */
export function tempoMarkQuarterBpm(m: Pick<TempoMark, 'bpm' | 'beatUnit' | 'dotted'>): number {
    const unit = QUARTERS_PER_UNIT[m.beatUnit ?? 'quarter'] ?? 1;
    const bpm = Number(m.bpm) || 0;
    return bpm * unit * (m.dotted ? 1.5 : 1);
}

/** Come si legge sulla pagina: «♩ = 60», «𝅗𝅥. = 70». */
export function tempoMarkLabel(m: Pick<TempoMark, 'bpm' | 'beatUnit' | 'dotted'>): string {
    const glyph = GLYPH[m.beatUnit ?? 'quarter'] ?? GLYPH.quarter;
    return `${glyph}${m.dotted ? '.' : ''} = ${Math.round(Number(m.bpm) || 0)}`;
}

/** Nome MusicXML dell'unità, per `<beat-unit>`. */
export function tempoMarkXmlBeatUnit(m: Pick<TempoMark, 'beatUnit'>): string {
    const u = m.beatUnit ?? 'quarter';
    return u === 'sixteenth' ? '16th' : u;
}

/**
 * Segni ordinati e ripuliti: uno solo per battuta (vince l'ultimo posato), niente
 * valori assurdi. Stessa regola dei cambi d'armatura — due segni sulla stessa battuta
 * non si possono né disegnare né suonare.
 */
export function normalizeTempoMarks(marks: TempoMark[] | null | undefined): TempoMark[] {
    const perMisura = new Map<number, TempoMark>();
    for (const m of marks || []) {
        if (!m || !Number.isFinite(m.measureIndex as number)) continue;
        const bpm = Number(m.bpm);
        if (!Number.isFinite(bpm) || bpm <= 0) continue;
        const mis = Math.max(0, Math.round(Number(m.measureIndex)));
        perMisura.set(mis, { ...m, measureIndex: mis, bpm: Math.max(1, Math.min(999, Math.round(bpm))) });
    }
    return Array.from(perMisura.values()).sort((a, b) => a.measureIndex - b.measureIndex);
}
