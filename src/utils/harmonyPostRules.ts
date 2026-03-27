/**
 * harmonyPostRules.ts — Pure, stateless post-processing rules extracted from
 * useHarmonyLabels.ts. These can be called by both the live UI hook and the
 * headless regression-check / export pipelines.
 *
 * Each function mirrors one R-rule from the live pipeline.
 * The original inline code in useHarmonyLabels remains intact until Phase 5.
 */

import {
    calculateRomanFromChordInfo,
    getChordSymbol,
    getKeySignature,
    getRomanAnalysis,
    identifyChordCandidates,
} from './musicTheory';

import { NOTE_NAMES, ALL_NOTE_SPELLINGS } from '../constants';

// ────────────────── local helpers (duplicated from useHarmonyLabels closure) ──────────────────

function noteNameToChromaticIndex(name: string): number {
    const idxSharp = NOTE_NAMES.indexOf(name);
    if (idxSharp >= 0) return idxSharp;
    const normalized = name.replace('♯', '#').replace('♭', 'b');
    for (let i = 0; i < ALL_NOTE_SPELLINGS.length; i++) {
        if (ALL_NOTE_SPELLINGS[i].includes(normalized)) return i;
    }
    return -1;
}

export function inferDiatonicRomanFromBass(bassPc: number | null, tonic: string, isMinor: boolean): { roman: string; triad: { root: number; third: number; fifth: number } } | null {
    try {
        if (bassPc == null) return null;
        const tIdx = noteNameToChromaticIndex(String(tonic ?? ''));
        if (tIdx == null || tIdx < 0 || !Number.isFinite(tIdx)) return null;
        const scaleIntervals = isMinor
            ? [0, 2, 3, 5, 7, 8, 10]
            : [0, 2, 4, 5, 7, 9, 11];
        const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
        const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
        const romans = isMinor ? romanMin : romanMaj;
        let degree = -1;
        for (let i = 0; i < scaleIntervals.length; i++) {
            const pc = (((tIdx + scaleIntervals[i]) % 12) + 12) % 12;
            if (pc === bassPc) { degree = i; break; }
        }
        if (degree < 0) return null;
        const roman = romans[degree];
        const rootPc = (((tIdx + scaleIntervals[degree]) % 12) + 12) % 12;
        const isDim = roman.includes('°');
        const isMinTriad = !isDim && roman === roman.toLowerCase();
        const isAug = roman.includes('+');
        const thirdInt = isMinTriad || isDim ? 3 : 4;
        const fifthInt = isAug ? 8 : (isDim ? 6 : 7);
        return {
            roman,
            triad: { root: rootPc, third: (rootPc + thirdInt) % 12, fifth: (rootPc + fifthInt) % 12 },
        };
    } catch { return null; }
}

export function inferDiatonicTriadFromRoman(roman: string, tonic: string, isMinor: boolean): { root: number; third: number; fifth: number } | null {
    try {
        const r = String(roman || '').trim();
        if (!r) return null;
        const tIdx = noteNameToChromaticIndex(String(tonic ?? ''));
        if (tIdx == null || tIdx < 0 || !Number.isFinite(tIdx)) return null;
        const scaleIntervals = isMinor
            ? [0, 2, 3, 5, 7, 8, 10]
            : [0, 2, 4, 5, 7, 9, 11];
        const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
        const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
        const romans = isMinor ? romanMin : romanMaj;
        const degree = romans.indexOf(r);
        if (degree < 0) return null;
        const rootPc = (((tIdx + scaleIntervals[degree]) % 12) + 12) % 12;
        const isDim = r.includes('°');
        const isMinTriad = !isDim && r === r.toLowerCase();
        const isAug = r.includes('+');
        const thirdInt = isMinTriad || isDim ? 3 : 4;
        const fifthInt = isAug ? 8 : (isDim ? 6 : 7);
        return { root: rootPc, third: (rootPc + thirdInt) % 12, fifth: (rootPc + fifthInt) % 12 };
    } catch { return null; }
}

// ────────────────── helpers ──────────────────

function pcSetFromNotes(notes: any[]): Set<number> {
    const s = new Set<number>();
    for (const n of (notes || [])) {
        if (!n || n.isRest) continue;
        const ni = Number(n.noteIndex);
        const mi = Number(n.midi);
        const pc = Number.isFinite(ni) ? ((ni % 12) + 12) % 12
                 : Number.isFinite(mi) ? ((mi % 12) + 12) % 12
                 : null;
        if (pc != null) s.add(pc);
    }
    return s;
}

function isSubset(sub: Set<number>, sup: Set<number>): boolean {
    for (const v of sub) if (!sup.has(v)) return false;
    return true;
}

function pcCount(arr: any[]): number {
    return pcSetFromNotes(arr).size;
}

// ────────────────── R1: viiRescue ──────────────────

export interface R1Input {
    roman: string;
    analysisNotesForNaming: any[];
    analysisNotes: any[];
    fullNotes: any[];
    contextTonic: string;
    contextIsMinor: boolean;
    ornamentOverrides?: Record<string, string>;
}

/**
 * R1: If getRomanAnalysis returned vii° but the naming-filter collapsed the
 * verticality to a dyad, re-try with the fuller verticality. If it yields
 * a plausible dominant/tonic label, prefer that.
 */
export function applyR1ViiRescue(input: R1Input): string {
    const { roman, analysisNotesForNaming, analysisNotes, fullNotes, contextTonic, contextIsMinor, ornamentOverrides } = input;
    try {
        const rr0 = String(roman || '');
        const pcsNaming = pcCount(analysisNotesForNaming);
        const pcsAnalysis = pcCount(analysisNotes);
        const pcsFull = pcCount(fullNotes);

        if (rr0.startsWith('vii') && pcsNaming > 0 && pcsNaming < 3 && (pcsAnalysis >= 3 || pcsFull >= 3)) {
            const opts = ornamentOverrides ? { ornamentOverrides } : undefined;
            const alt1 = getRomanAnalysis(analysisNotes as any, contextTonic, contextIsMinor, opts);
            const alt2 = getRomanAnalysis(fullNotes as any, contextTonic, contextIsMinor, opts);
            const isPlausible = (s: string) => s === 'V' || s === 'I' || s.startsWith('V/') || s.startsWith('I/');
            const pick = [alt1, alt2].find(x => x?.roman && isPlausible(String(x.roman)));
            if (pick?.roman) return String(pick.roman);
        }
    } catch { /* ignore */ }
    return roman;
}

// ────────────────── R2: secDom ──────────────────

export interface R2Input {
    roman: string;
    analysisNotesForNaming: any[];
    contextTonic: string;
    contextIsMinor: boolean;
}

/**
 * R2: If roman is empty, check chord candidates for a confident V/x label.
 */
export function applyR2SecDom(input: R2Input): string {
    const { roman, analysisNotesForNaming, contextTonic, contextIsMinor } = input;
    if (roman) return roman;
    try {
        const candidates = identifyChordCandidates(analysisNotesForNaming as any);
        let bestSecondary: { roman: string; score: number } | null = null;
        for (const c of (candidates as any[]) || []) {
            const rr = calculateRomanFromChordInfo(
                { root: c.root, type: c.type, intervals: c.intervals },
                contextTonic,
                contextIsMinor,
            );
            if (!rr || !String(rr).startsWith('V/')) continue;
            const score = Number.isFinite((c as any).score) ? Number((c as any).score) : 0;
            if (!bestSecondary || score > bestSecondary.score) bestSecondary = { roman: rr, score };
        }
        if (bestSecondary) return bestSecondary.roman;
    } catch { /* ignore */ }
    return roman;
}

// ────────────────── R3: I7 (minor tonic maj7) ──────────────────

export interface R3Input {
    roman: string;
    symbol: string;
    contextTonic: string;
    contextIsMinor: boolean;
}

/**
 * R3: If roman is empty, symbol indicates a minor-major-7th chord on the tonic,
 * label as I7.
 */
export function applyR3I7(input: R3Input): string {
    const { roman, symbol, contextTonic, contextIsMinor } = input;
    if (roman || !symbol || !contextIsMinor) return roman;
    try {
        const sym = String(symbol).replace('♯', '#').replace('♭', 'b');
        if (/m\(maj7\)|mmaj7|minmaj7/i.test(sym)) {
            const rootMatch = sym.match(/^([A-G])([#b]?)/);
            const rootName = rootMatch ? `${rootMatch[1]}${rootMatch[2] || ''}` : '';
            const rootPc = rootName ? noteNameToChromaticIndex(rootName) : null;
            const tonicPc = contextTonic ? noteNameToChromaticIndex(contextTonic) : null;
            if (rootPc != null && tonicPc != null && rootPc === tonicPc) {
                return 'I7';
            }
        }
    } catch { /* ignore */ }
    return roman;
}

// ────────────────── R6: rootless / diatonic shell ──────────────────

export interface R6Input {
    roman: string;
    bassPc: number | null;
    analysisNotes: any[];
    contextTonic: string;
    contextIsMinor: boolean;
}

/**
 * R6: Fallback diatonic shell/rootless inference — use bass to infer a diatonic
 * triad when we cannot confidently label the harmony.
 */
export function applyR6Rootless(input: R6Input): string {
    const { roman, bassPc, analysisNotes, contextTonic, contextIsMinor } = input;
    if (roman) return roman;
    if (bassPc == null) return roman;
    try {
        const isSecondaryOrSlash = typeof roman === 'string' && roman.includes('/');
        if (isSecondaryOrSlash) return roman;
        const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
        if (inferred) {
            const pcs = pcSetFromNotes(analysisNotes);
            const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
            if (isSubset(pcs, triadSet) && pcs.size > 0 && pcs.size <= 3) {
                return inferred.roman;
            }
        }
    } catch { /* ignore */ }
    return roman;
}

// ────────────────── R11: sparseRescue ──────────────────

export interface R11Input {
    roman: string;
    analysisNotes: any[];
    bassPc: number | null;
    contextTonic: string;
    contextIsMinor: boolean;
    currentRoman?: string; // if set, prefer candidate matching this
}

/**
 * R11: Sparse texture rescue — when roman is empty, try chord candidates
 * and prefer the one whose root matches the bass.
 */
export function applyR11SparseRescue(input: R11Input): string {
    const { roman, analysisNotes, bassPc, contextTonic, contextIsMinor, currentRoman } = input;
    if (roman) return roman;
    try {
        const candidates = identifyChordCandidates(analysisNotes as any);
        if (!candidates || !(candidates as any[]).length) return roman;
        let preferred: any = null;
        if (currentRoman) {
            preferred = (candidates as any[]).find((c: any) => {
                const rr = calculateRomanFromChordInfo(
                    { root: c.root, type: c.type, intervals: c.intervals },
                    contextTonic, contextIsMinor,
                );
                return rr === currentRoman;
            });
        }
        if (!preferred && bassPc != null) {
            preferred = (candidates as any[]).find((c: any) => (c?.root?.noteIndex ?? null) === bassPc) || candidates[0];
        }
        if (preferred) {
            const forced = calculateRomanFromChordInfo(
                { root: preferred.root, type: preferred.type, intervals: preferred.intervals },
                contextTonic, contextIsMinor,
            );
            if (forced) return forced;
        }
    } catch { /* ignore */ }
    return roman;
}

// ────────────────── R12: autoOvr ──────────────────

export interface R12Input {
    roman: string;
    symbol: string;
    figures: string[];
    absBeat: number;
    autoOverrideByAbsBeat: Map<number, { roman?: string; symbol?: string; figures?: string[] }>;
    overrideByAbsBeat: Map<number, any>;
}

/**
 * R12: Apply auto-generated harmony overrides (from pipeline), unless
 * beat already has a manual override or the current roman is tonic.
 */
export function applyR12AutoOverride(input: R12Input): { roman: string; symbol: string; figures: string[] } {
    const { absBeat, autoOverrideByAbsBeat, overrideByAbsBeat } = input;
    let { roman, symbol, figures } = input;
    try {
        const a = Math.round(absBeat * 1e6) / 1e6;
        if (!overrideByAbsBeat.has(a)) {
            const auto = getNear(autoOverrideByAbsBeat, a);
            if (auto) {
                const isCurrentlyTonic = roman === 'I' || roman === 'i';
                if (!isCurrentlyTonic) {
                    if (auto.roman !== undefined) roman = auto.roman;
                    if (auto.symbol !== undefined) symbol = auto.symbol;
                    if (auto.figures !== undefined) figures = auto.figures;
                }
            }
        }
    } catch { /* ignore */ }
    return { roman, symbol, figures };
}

function getNear(map: Map<number, any>, key: number): any | undefined {
    if (map.has(key)) return map.get(key);
    for (const [k, v] of map) {
        if (Math.abs(k - key) < 1e-3) return v;
    }
    return undefined;
}

// ────────────────── R13: manualOvr ──────────────────

export interface R13Input {
    roman: string;
    symbol: string;
    figures: string[];
    absBeat: number;
    overrideByAbsBeat: Map<number, { roman?: string; symbol?: string; figures?: string[] }>;
}

/**
 * R13: Apply user manual overrides.
 */
export function applyR13ManualOverride(input: R13Input): { roman: string; symbol: string; figures: string[] } {
    let { roman, symbol, figures } = input;
    try {
        const a = Math.round(input.absBeat * 1e6) / 1e6;
        const ov = input.overrideByAbsBeat.get(a);
        if (!ov) {
            // Try fuzzy match
            for (const [k, v] of input.overrideByAbsBeat) {
                if (Math.abs(k - a) < 1e-3) {
                    if (v.roman !== undefined) roman = v.roman;
                    if (v.symbol !== undefined) symbol = v.symbol;
                    if (v.figures !== undefined) figures = v.figures;
                    return { roman, symbol, figures };
                }
            }
            return { roman, symbol, figures };
        }
        if (ov.roman !== undefined) roman = ov.roman;
        if (ov.symbol !== undefined) symbol = ov.symbol;
        if (ov.figures !== undefined) figures = ov.figures;
    } catch { /* ignore */ }
    return { roman, symbol, figures };
}

// ────────────────── Convenience: apply all stateless rules ──────────────────

export interface StatelessRulesInput {
    analysisNotesForNaming: any[];
    analysisNotes: any[];
    fullNotes: any[];
    contextTonic: string;
    contextIsMinor: boolean;
    bassPc: number | null;
    ornamentOverrides?: Record<string, string>;
    absBeat: number;
    autoOverrideByAbsBeat: Map<number, { roman?: string; symbol?: string; figures?: string[] }>;
    overrideByAbsBeat: Map<number, { roman?: string; symbol?: string; figures?: string[] }>;
}

/**
 * Apply R0 (getRomanAnalysis) + all stateless post-rules (R1-R3, R6, R11, R12, R13)
 * in the same order as the live hook.
 */
export function applyStatelessRules(input: StatelessRulesInput): { roman: string; symbol: string; figures: string[] } {
    const { analysisNotesForNaming, analysisNotes, fullNotes, contextTonic, contextIsMinor, bassPc, ornamentOverrides } = input;

    // R0: base getRomanAnalysis
    const r = getRomanAnalysis(analysisNotesForNaming as any, contextTonic, contextIsMinor,
        ornamentOverrides ? { ornamentOverrides } : undefined);
    let roman = r?.roman ?? '';
    let figures = r?.figures ?? [];

    // Symbol from full notes
    const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
    let symbol = getChordSymbol(fullNotes as any, contextKeySignature, contextTonic) ?? '';

    // R1: viiRescue
    roman = applyR1ViiRescue({ roman, analysisNotesForNaming, analysisNotes, fullNotes, contextTonic, contextIsMinor, ornamentOverrides });

    // R2: secDom
    roman = applyR2SecDom({ roman, analysisNotesForNaming, contextTonic, contextIsMinor });

    // R3: I7
    roman = applyR3I7({ roman, symbol, contextTonic, contextIsMinor });

    // R6: rootless
    roman = applyR6Rootless({ roman, bassPc, analysisNotes, contextTonic, contextIsMinor });

    // R11: sparseRescue
    roman = applyR11SparseRescue({ roman, analysisNotes, bassPc, contextTonic, contextIsMinor });

    // R12: autoOverride
    const r12 = applyR12AutoOverride({ roman, symbol, figures, absBeat: input.absBeat, autoOverrideByAbsBeat: input.autoOverrideByAbsBeat, overrideByAbsBeat: input.overrideByAbsBeat });
    roman = r12.roman; symbol = r12.symbol; figures = r12.figures;

    // R13: manualOverride
    const r13 = applyR13ManualOverride({ roman, symbol, figures, absBeat: input.absBeat, overrideByAbsBeat: input.overrideByAbsBeat });
    roman = r13.roman; symbol = r13.symbol; figures = r13.figures;

    return { roman, symbol, figures };
}
