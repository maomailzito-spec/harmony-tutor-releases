import type { HarmonyLabelOverride, TimeSignature } from '../types';
import { suggestNextChord } from '../engine/progressionSuggester';

/** Filter out notes flagged as ornamental (auto-detected or manual override).
 *  When filtering would leave fewer than 2 notes, fall back to the full set
 *  so chord analysis still has enough data.
 *  @param overrideMap  Optional Map<noteId, ornamentType> for direct ID lookup
 *                      (survives object copies / different object graphs). */
export function structuralNotes(notes: any[], overrideMap?: Map<string, string>): any[] {
    if (!notes || notes.length === 0) return notes;
    const filtered = notes.filter((n: any) => {
        if (!n) return true;
        // Direct ID check against override map
        if (overrideMap && n.id) {
            const ov = overrideMap.get(n.id);
            if (ov && ov !== 'structural') return false;
        }
        // Composite key check (midi-measureIndex-beat) for cross-graph matching
        if (overrideMap) {
            const midi = Number(n.midi);
            if (Number.isFinite(midi)) {
                const ov2 = overrideMap.get(`${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`);
                if (ov2 && ov2 !== 'structural') return false;
            }
        }
        if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
        if (n.isPassing || n.isNeighbor || n.isAppoggiatura || n.isAnticipation || n.isEscape) return false;
        return true;
    });
    // If user manual overrides were responsible for the filtering, respect
    // the override even when fewer than 2 notes remain (avoid re-including
    // the ornamental note via the safety fallback).
    if (filtered.length >= 2) return filtered;
    const hasUserOverride = notes.some((n: any) => n?.ornamentOverride && n.ornamentOverride !== 'structural');
    return hasUserOverride ? filtered : notes;
}

export type TimelineEventLike = {
    absBeat?: number;
    notes?: Array<{ id?: string } | any>;
};

export function qAbsBeat(x: number): number {
    try {
        const q = 192;
        return Math.round(Number(x) * q) / q;
    } catch {
        return Number(x) || 0;
    }
}

export function getNearAbsBeat<T>(m: Map<number, T>, a0: number): T | undefined {
    try {
        const a = Number(a0);
        if (!Number.isFinite(a)) return undefined;
        const direct = m.get(a);
        if (direct !== undefined) return direct;

        const EPS = (1 / 192) + 1e-6;
        for (const [k, v] of m.entries()) {
            if (Math.abs(Number(k) - a) <= EPS) return v;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

export function buildUserHarmonyOverrideMap(harmonyOverrides: any[]): Map<number, HarmonyLabelOverride> {
    const overrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
    try {
        (harmonyOverrides || []).forEach((o: any) => {
            const a = Number(o?.absBeat);
            if (!Number.isFinite(a)) return;

            const roman0 = typeof o?.roman === 'string' ? o.roman : undefined;
            const romanDisplay0 = typeof o?.romanDisplay === 'string' ? o.romanDisplay : undefined;
            const symbol0 = typeof o?.symbol === 'string' ? o.symbol : undefined;
            const figuresRaw = Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined;
            const note0 = typeof o?.note === 'string' ? o.note : undefined;

            // Normalize empty fields to `undefined` so they don't clear computed labels.
            const roman = (roman0 != null && String(roman0).trim()) ? String(roman0) : undefined;
            const romanDisplay = (romanDisplay0 != null && String(romanDisplay0).trim()) ? String(romanDisplay0) : undefined;
            const symbol = (symbol0 != null && String(symbol0).trim()) ? String(symbol0) : undefined;
            const figures0 = (figuresRaw || []).map(s => String(s || '').trim()).filter(Boolean);
            const figures = figures0.length ? figures0 : undefined;
            const note = (note0 != null && String(note0).trim()) ? String(note0) : undefined;

            const hasAny = !!roman || !!romanDisplay || !!symbol || !!(figures && figures.length) || !!note;

            // Special case: an empty override acts as a "force label here" marker.
            // It prevents suppression at this absBeat without overriding content.
            if (!hasAny) {
                overrideByAbsBeat.set(qAbsBeat(a), {
                    absBeat: a,
                    force: true,
                });
                return;
            }

            overrideByAbsBeat.set(qAbsBeat(a), {
                absBeat: a,
                roman,
                romanDisplay,
                symbol,
                figures,
                note,
            });
        });
    } catch {
        // ignore
    }
    return overrideByAbsBeat;
}

export function buildEngineHarmonyOverrideMap(autoHarmonyLabelOverrides: any[]): Map<number, HarmonyLabelOverride> {
    const engineOverrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
    try {
        const arr = autoHarmonyLabelOverrides;
        if (Array.isArray(arr)) {
            for (const o of arr) {
                const a = Number(o?.absBeat);
                if (!Number.isFinite(a)) continue;
                engineOverrideByAbsBeat.set(qAbsBeat(a), {
                    absBeat: a,
                    roman: typeof o?.roman === 'string' ? o.roman : undefined,
                    romanDisplay: typeof o?.romanDisplay === 'string' ? o.romanDisplay : undefined,
                    symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                    figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                    note: typeof o?.note === 'string' ? o.note : undefined,
                });
            }
        }
    } catch {
        // ignore
    }
    return engineOverrideByAbsBeat;
}

export function isCompoundMeter(timeSignature: TimeSignature): boolean {
    return timeSignature.denominator === 8
        && (timeSignature.numerator % 3 === 0)
        && timeSignature.numerator > 3;
}

export function isStrongPulseInMeasure(timeSignature: TimeSignature, inMeasureBeats0: number): boolean {
    try {
        if (!Number.isFinite(inMeasureBeats0)) return false;
        const EPS = 1e-3;

        if (isCompoundMeter(timeSignature)) {
            const pulse = 1.5;
            const r = ((inMeasureBeats0 % pulse) + pulse) % pulse;
            return Math.abs(r) < EPS || Math.abs(pulse - r) < EPS;
        }

        const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
        if (!nearInt(inMeasureBeats0)) return false;
        const beat0 = Math.round(inMeasureBeats0);
        return beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
    } catch {
        return false;
    }
}

export function filterTimelineForHarmonyLabels(
    timeline: any[],
    timeSignature: TimeSignature,
    harmonyLabelMinSpanBeats: number = 0
): any[] {
    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
    const minSpan = Number(harmonyLabelMinSpanBeats) || 0;
    const EPS = 1e-6;

    return (timeline || []).filter((ev: any, idx: number) => {
        if (!ev) return false;
        if (idx === 0) return true;

        const prev = (timeline || [])[idx - 1] as any;
        const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
        const curNotes = (ev?.notes || []) as any[];

        const hasOnset = curNotes.some(n => {
            const id = String(n?.id ?? '');
            return id && !prevIds.has(id);
        });

        const passesStructuralGate = (() => {
            if (hasOnset) return true;

            // Also keep note-off-only events on strong pulses.
            try {
                const curIds = new Set<string>(curNotes.map(n => String(n?.id ?? '')).filter(Boolean));
                const removed = Array.from(prevIds).some(id => id && !curIds.has(id));
                if (!removed) return false;

                const absBeat = Number(ev?.absBeat);
                if (!Number.isFinite(absBeat)) return false;
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                return isStrongPulseInMeasure(timeSignature, inMeasure);
            } catch {
                return false;
            }
        })();

        if (!passesStructuralGate) return false;

        // Optional anti-noise filter: drop very short segments (next scanpoint too close).
        if (minSpan > EPS && idx < (timeline || []).length - 1) {
            try {
                const a0 = Number(ev?.absBeat);
                const a1 = Number((timeline || [])[idx + 1]?.absBeat);
                if (Number.isFinite(a0) && Number.isFinite(a1)) {
                    const span = a1 - a0;
                    if (Number.isFinite(span) && span + EPS < minSpan) return false;
                }
            } catch {
                // ignore
            }
        }

        return true;
    });
}

export function computeStructuralSnapshotForHarmonyLabelEvent(opts: {
    fullNotes: any[];
    eventAbsBeat: number;
    systemIndex: number;
    timeSignature: TimeSignature;
    isCompoundMeter: boolean;
    isStrongPulseInMeasure: (inMeasureBeats0: number) => boolean;
    isNonChordToneAtLabelEvent: (note: any, absBeat: number) => boolean;
    isDissonantIntervalAgainstBass: (note: any, notes: any[]) => boolean;
    lastStructuralByVoiceBySystem: Map<number, Map<number, any>>;
}): {
    harmonicNotes: any[];
    fallbackHarmonicNotes: any[];
    baseHarmonicNotes: any[];
    analysisNotes: any[];
    analysisNotesForNaming: any[];
} {
    const fullNotes = (opts.fullNotes || []) as any[];

    const {
        eventAbsBeat,
        systemIndex,
        timeSignature,
        isCompoundMeter,
        isStrongPulseInMeasure,
        isNonChordToneAtLabelEvent,
        isDissonantIntervalAgainstBass,
        lastStructuralByVoiceBySystem,
    } = opts;

    const voiceSet = new Set<number>();
    for (const n of fullNotes) {
        const v = (n?.voice ?? 1) as number;
        if (!n || n.isRest) continue;
        voiceSet.add(v);
    }

    if (!lastStructuralByVoiceBySystem.has(systemIndex)) {
        lastStructuralByVoiceBySystem.set(systemIndex, new Map<number, any>());
    }
    const lastStructural = lastStructuralByVoiceBySystem.get(systemIndex)!;

    for (const v of Array.from(lastStructural.keys())) {
        if (!voiceSet.has(v)) lastStructural.delete(v);
    }

    for (const n of fullNotes) {
        if (!n || n.isRest) continue;
        const v = (n?.voice ?? 1) as number;

        try {
            if (v === 4 && isCompoundMeter) {
                const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                const absBeat = Number(eventAbsBeat);
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                const strongPulse = isStrongPulseInMeasure(inMeasure);
                const base = ({
                    whole: 4,
                    half: 2,
                    quarter: 1,
                    eighth: 0.5,
                    sixteenth: 0.25,
                    'thirty-second': 0.125,
                    'sixty-fourth': 0.0625,
                } as any)[n.duration || 'quarter'] || 1;
                let dur = base;
                if (n.isDotted) dur *= 1.5;
                if (n.isTriplet) dur *= 2 / 3;
                if (n.isDuplet) dur *= 3 / 2;
                if (!strongPulse && dur <= 0.51) {
                    continue;
                }
            }
        } catch {
            // ignore
        }

        if (isNonChordToneAtLabelEvent(n, eventAbsBeat)) {
            try {
                const s = (n as any)?.isSuspension;
                if (s && typeof s.fromAbsBeat === 'number' && Math.abs((s.fromAbsBeat as number) - Number(eventAbsBeat)) < 1e-3) {
                    lastStructural.delete(v);
                }
            } catch {
                // ignore
            }
            continue;
        }

        lastStructural.set(v, n);
    }

    const harmonicNotes = Array.from(lastStructural.values()).filter(Boolean);

    const fullNotesNoOrn = (() => {
        try {
            return (fullNotes || []).filter((n: any) => {
                if (!n || n.isRest) return false;
                // Surface ornaments should not drive fallback harmony labeling.
                return !(
                    n.isPassing ||
                    n.isNeighbor ||
                    n.isAnticipation ||
                    n.isAppoggiatura ||
                    n.isEscape
                );
            });
        } catch {
            return (fullNotes || []).filter((n: any) => n && !n.isRest);
        }
    })();
    const fallbackHarmonicNotes = (harmonicNotes.length >= 2)
        ? harmonicNotes
        : ((fullNotesNoOrn.length >= 2) ? fullNotesNoOrn : (fullNotes || []).filter((n: any) => n && !n.isRest));
    const baseHarmonicNotes = (fallbackHarmonicNotes.length >= 2)
        ? fallbackHarmonicNotes
        : (fullNotes || []).filter((n: any) => n && !n.isRest);

    const SUSP_EPS = 1e-3;
    const harmonicNotesNoSuspAtThisBeat = fallbackHarmonicNotes.filter((n: any) => {
        const s = n?.isSuspension;
        if (!s || typeof s.fromAbsBeat !== 'number') return true;
        return Math.abs(s.fromAbsBeat - eventAbsBeat) >= SUSP_EPS;
    });
    const analysisNotes = (harmonicNotesNoSuspAtThisBeat.length >= 2)
        ? harmonicNotesNoSuspAtThisBeat
        : harmonicNotes;

    const analysisNotesForNaming = (() => {
        try {
            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
            const absBeat = Number(eventAbsBeat);
            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
            const isStrong = isStrongPulseInMeasure(inMeasure);

            if (!isStrong) return analysisNotes;

            return (analysisNotes || []).map((n: any) => {
                if (!n || n.isRest) return n;
                const s = n.isSuspension;
                const isSusp = !!s && typeof s.fromAbsBeat === 'number';
                const isNctFlag = !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura);

                if (!isNctFlag && !isSusp) return n;

                const dissonantVsBass = isDissonantIntervalAgainstBass(n, fullNotes || []);

                const isSuspStartHere = isSusp && Math.abs((s.fromAbsBeat as number) - absBeat) < SUSP_EPS;
                if (isSusp && isSuspStartHere) return n;

                if (dissonantVsBass) return n;

                return {
                    ...n,
                    isNeighbor: false,
                    isAnticipation: false,
                    isAppoggiatura: false,
                    isSuspension: isSusp ? undefined : n.isSuspension,
                };
            });
        } catch {
            return analysisNotes;
        }
    })();

    return {
        harmonicNotes,
        fallbackHarmonicNotes,
        baseHarmonicNotes,
        analysisNotes,
        analysisNotesForNaming,
    };
}

export function computeLookaheadTonicizationOverrides(opts: {
    timelineForLabels: any[];
    beatsPerMeasure: number;
    currentTonic: string;
    isMinorMode: boolean;
    minorScaleMode?: 'off' | 'natural' | 'harmonic';
    ctxAtAbsBeat: (absBeat: number) => any;
    noteNameToChromaticIndex: (name: string) => number;
    getRomanAnalysis: (notes: any[], tonic: string, isMinor: boolean) => any;
    identifyChordCandidates: (notes: any[]) => any[];
    pcSetFromNotes: (notes: any[]) => Set<number> | null;
    overrideByAbsBeat: Map<number, HarmonyLabelOverride>;
    useStatisticalCorrection?: boolean;
}): {
    autoOverrideByAbsBeat: Map<number, HarmonyLabelOverride>;
    autoRomanDisplayByAbsBeat: Map<number, string>;
    protectedAbsBeats: Set<number>;
} {
    const autoOverrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
    const autoRomanDisplayByAbsBeat = new Map<number, string>();
    const protectedAbsBeats = new Set<number>();

    try {
        const {
            timelineForLabels,
            beatsPerMeasure,
            currentTonic,
            isMinorMode,
            minorScaleMode,
            ctxAtAbsBeat,
            noteNameToChromaticIndex,
            getRomanAnalysis,
            identifyChordCandidates,
            pcSetFromNotes,
            overrideByAbsBeat,
            useStatisticalCorrection,
        } = opts;

        const preferFlats = (() => {
            try {
                return String(currentTonic || '').includes('b');
            } catch {
                return true;
            }
        })();

        const pcToName = (pc: number): string => {
            const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
            const idx = (((Number(pc) % 12) + 12) % 12);
            return preferFlats ? flat[idx] : sharp[idx];
        };

        const degreeIndexFromRoman = (r: string): number | null => {
            const s0 = String(r || '').trim();
            if (!s0) return null;
            const s = s0
                .replace(/\s+/g, '')
                .replace(/[^ivIV]/g, '')
                .toLowerCase();
            if (s === 'i') return 0;
            if (s === 'ii') return 1;
            if (s === 'iii') return 2;
            if (s === 'iv') return 3;
            if (s === 'v') return 4;
            if (s === 'vi') return 5;
            if (s === 'vii') return 6;
            return null;
        };

        const scaleIntervalsForContext = (isMinor: boolean): number[] => {
            if (!isMinor) return [0, 2, 4, 5, 7, 9, 11];
            const mode = (minorScaleMode === 'harmonic') ? 'harmonic' : 'natural';
            return mode === 'harmonic'
                ? [0, 2, 3, 5, 7, 8, 11]
                : [0, 2, 3, 5, 7, 8, 10];
        };

        const base = (timelineForLabels || []).map((ev: any) => {
            const absBeat = Number(ev?.absBeat);
            const ctx = ctxAtAbsBeat(absBeat);
            const ctxTonic = ctx ? String(ctx.newTonic || '') : String(currentTonic || 'C');
            const ctxIsMinor = ctx ? !!ctx.newIsMinor : !!isMinorMode;
            const r = getRomanAnalysis(structuralNotes(ev?.notes || []), ctxTonic, ctxIsMinor);
            const rootPc = (() => {
                try {
                    const pcs = pcSetFromNotes(structuralNotes(ev?.notes || []));
                    if (pcs && pcs.size === 3) {
                        const arr = Array.from(pcs.values());
                        for (const pc of arr) {
                            const maj = new Set<number>([pc, (pc + 4) % 12, (pc + 7) % 12]);
                            const min = new Set<number>([pc, (pc + 3) % 12, (pc + 7) % 12]);
                            const dim = new Set<number>([pc, (pc + 3) % 12, (pc + 6) % 12]);
                            const aug = new Set<number>([pc, (pc + 4) % 12, (pc + 8) % 12]);
                            const matches = (s: Set<number>) => arr.every(x => s.has(x));
                            if (matches(maj) || matches(min) || matches(dim) || matches(aug)) {
                                return pc;
                            }
                        }
                    }

                    const cands = identifyChordCandidates((ev?.notes || []) as any);
                    const best = Array.isArray(cands) ? cands[0] : null;
                    const pc = Number(best?.root?.noteIndex);
                    return Number.isFinite(pc) ? (((pc % 12) + 12) % 12) : null;
                } catch {
                    return null;
                }
            })();
            return {
                absBeat,
                q: qAbsBeat(absBeat),
                ctxTonic,
                ctxIsMinor,
                roman: String(r?.roman || ''),
                rootPc,
                notes: (ev?.notes || []) as any[],
            };
        }).filter((x: any) => Number.isFinite(x.absBeat));

        // Pre-modulation pivots: when the context changes (inferred modulation), relabel the last
        // beat(s) before the boundary in the *new* key as a display/auto override.
        // This fixes common cases where a chord is correctly a bVII in the old key but is a clear
        // V/V (or similar) in the upcoming key.
        try {
            const maxLookbackShort = Math.min(2.01, beatsPerMeasure);
            const maxLookbackLong = Math.min(beatsPerMeasure * 2, 8.01);
            for (let j = 1; j < base.length; j++) {
                const prev = base[j - 1];
                const cur = base[j];
                if (!prev || !cur) continue;
                const ctxKeyPrev = `${prev.ctxTonic}|${prev.ctxIsMinor ? 'm' : 'M'}`;
                const ctxKeyCur = `${cur.ctxTonic}|${cur.ctxIsMinor ? 'm' : 'M'}`;
                if (!prev.ctxTonic || !cur.ctxTonic) continue;
                if (ctxKeyPrev === ctxKeyCur) continue;

                for (let p = j - 1; p >= 0; p--) {
                    const bp = base[p];
                    if (!bp) continue;
                    const dt = (cur.absBeat - bp.absBeat);
                    if (dt > maxLookbackLong + 1e-6) break;

                    const pq = Number(bp.q);
                    if (!Number.isFinite(pq)) continue;
                    if (overrideByAbsBeat.has(pq)) continue;
                    if (autoRomanDisplayByAbsBeat.has(pq)) continue;

                    const rp = String(bp.roman || '').trim();
                    if (!rp) continue;
                    if (rp.includes('/')) continue;

                    const local = String(getRomanAnalysis(structuralNotes(bp.notes || []), cur.ctxTonic, !!cur.ctxIsMinor)?.roman || '').trim();
                    if (!local) continue;

                    // Only apply if the new-key reading is clearly functional.
                    const functional = local.includes('/') || /^V(?!I)/.test(local) || /^ii/i.test(local) || /^iv/i.test(local);
                    if (!functional) continue;

                    // For a longer lookback window, require an explicit secondary-dominant style label.
                    // This keeps the relabeling conservative and avoids broad re-interpretations.
                    if (dt > maxLookbackShort + 1e-6 && !local.includes('/')) continue;

                    autoRomanDisplayByAbsBeat.set(pq, local);
                }
            }
        } catch {
            // ignore
        }

        const maxLookaheadBeats = beatsPerMeasure * 2;
        for (let j = 0; j < base.length; j++) {
            const bj = base[j];
            const rj = String(bj.roman || '');
            const m = rj.match(/^([Vv])\/(.+)$/);
            if (!m) continue;
            const targetRoman = String(m[2] || '').trim();
            if (!targetRoman) continue;

            let k = -1;
            for (let t = j + 1; t < base.length; t++) {
                if ((base[t].absBeat - bj.absBeat) > maxLookaheadBeats + 1e-6) break;
                if (String(base[t].roman || '') === targetRoman) {
                    k = t;
                    break;
                }
            }

            // Even if we cannot find an explicit `targetRoman` event nearby, an explicit V/x label
            // is already strong evidence of tonicization. We still use it to relabel the immediate
            // predominant(s) before V/x in the tonicized key.

            try {
                const bk = (k >= 0) ? base[k] : null;
                if (bk && Number.isFinite(bk.q)) protectedAbsBeats.add(bk.q);
            } catch {
                // ignore
            }

            const tonicPc = noteNameToChromaticIndex(String(bj.ctxTonic || 'C'));
            if (tonicPc == null || tonicPc < 0) continue;
            const degIdx = degreeIndexFromRoman(targetRoman);
            if (degIdx == null) continue;
            const ints = scaleIntervalsForContext(!!bj.ctxIsMinor);
            const tonicizedPc = (((tonicPc + (ints[degIdx] ?? 0)) % 12) + 12) % 12;
            const tonicizedTonic = pcToName(tonicizedPc);

            const tonicizedIsMinor = targetRoman === targetRoman.toLowerCase();

            try {
                const bk = (k >= 0) ? base[k] : null;
                if (bk && Number.isFinite(bk.q) && !overrideByAbsBeat.has(bk.q)) {
                    // Intentionally do not add a tonicization tag on the resolution chord.
                    // It tends to clutter the editor and is redundant with nearby V/x labels.
                }
            } catch {
                // ignore
            }

            // Also label the immediate predominant(s) BEFORE the secondary dominant in the tonicized key.
            // This helps tonal grammar: predominant -> V/x -> (i= x), and avoids odd readings like
            // minor-V in major or bVII when the tonicization clearly points to a minor target.
            try {
                const maxLookback = Math.min(2.01, beatsPerMeasure); // only a short window
                for (let p = j - 1; p >= 0; p--) {
                    const bp = base[p];
                    if (!bp || !Number.isFinite(bp.absBeat)) continue;
                    if ((bj.absBeat - bp.absBeat) > maxLookback + 1e-6) break;

                    const pq = Number(bp.q);
                    if (!Number.isFinite(pq)) continue;
                    if (overrideByAbsBeat.has(pq)) continue;
                    if (autoRomanDisplayByAbsBeat.has(pq)) continue;

                    const rp = String(bp.roman || '').trim();
                    if (!rp) continue;
                    if (rp.includes('/')) continue; // already secondary; don't relabel

                    const tonicizedRoman = String(getRomanAnalysis(structuralNotes(bp.notes || []), tonicizedTonic, tonicizedIsMinor)?.roman || '').trim();
                    if (!tonicizedRoman) continue;
                    const isPredLike = /^iv/i.test(tonicizedRoman) || /^ii/i.test(tonicizedRoman) || /^VI/i.test(tonicizedRoman) || /^iio/i.test(tonicizedRoman) || /°/.test(tonicizedRoman);
                    if (!isPredLike) continue;

                    autoRomanDisplayByAbsBeat.set(pq, tonicizedRoman);
                }
            } catch {
                // ignore
            }

            try {
                const bjQ = Number(bj.q);
                if (!Number.isFinite(bjQ) || overrideByAbsBeat.has(bjQ)) {
                    // do nothing
                } else {
                    autoOverrideByAbsBeat.set(bjQ, {
                        absBeat: bj.absBeat,
                        roman: rj,
                        note: `tonicization:${tonicizedTonic}${tonicizedIsMinor ? 'm' : ''}`,
                    });
                }
            } catch {
                // ignore
            }
        }

        // Implicit tonicizations: infer V/x even when getRomanAnalysis did not emit a slash.
        // Example: a dominant-like sonority resolves to a diatonic degree within a short window,
        // and contains the chromatic leading tone of that target. This lets the engine use
        // tonal grammar even when the local chord snapshot is incomplete.
        try {
            const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
            const romanMin = ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°'];

            const pcSet = (notes: any[]): Set<number> | null => {
                try {
                    return pcSetFromNotes ? (pcSetFromNotes(notes as any) as any) : null;
                } catch {
                    return null;
                }
            };

            const isDominantLikeCandidate = (notes: any[], rootPc: number): boolean => {
                try {
                    const cands = identifyChordCandidates((notes || []) as any);
                    if (!Array.isArray(cands) || cands.length === 0) return false;
                    const cand = cands.find((c: any) => Number(c?.root?.noteIndex) === rootPc) || cands[0];
                    if (!cand) return false;
                    const t = String(cand.type || '');
                    const ints: Set<number> | undefined = (cand as any)?.intervals;
                    const hasM3 = !!ints?.has?.(4);
                    const hasP5 = !!ints?.has?.(7);
                    const hasm7 = !!ints?.has?.(10);
                    const isMajTriad = t === 'Major' || t === BuiltInChords.Major;
                    const isDomType = t.startsWith('Dominant');
                    // Triad: require M3; Seventh: require a dominant shell (P5+m7) even if 3rd is delayed.
                    if (isMajTriad) return hasM3;
                    if (isDomType) return (hasM3 && hasm7) || (hasP5 && hasm7);
                    return false;
                } catch {
                    return false;
                }
            };

            const countFlatAccidentals = (notes: any[]): number => {
                try {
                    let c = 0;
                    for (const n of (notes || []) as any[]) {
                        if (!n || n.isRest) continue;
                        const ea = String((n as any).explicitAccidental ?? '').toLowerCase();
                        const ua = String((n as any).userAccidental ?? '').toLowerCase();
                        if (ea === 'flat' || ua === 'flat') c++;
                    }
                    return c;
                } catch {
                    return 0;
                }
            };

            for (let j = 0; j < base.length; j++) {
                const bj = base[j];
                if (!bj || !Number.isFinite(bj.absBeat)) continue;
                const rj0 = String(bj.roman || '').trim();
                if (!rj0) continue;
                if (rj0.includes('/')) continue;

                const bjQ = Number(bj.q);
                if (!Number.isFinite(bjQ)) continue;
                if (overrideByAbsBeat.has(bjQ)) continue;
                if (autoOverrideByAbsBeat.has(bjQ)) continue;

                const tonicPc = noteNameToChromaticIndex(String(bj.ctxTonic || 'C'));
                if (!(tonicPc >= 0)) continue;

                const ints = scaleIntervalsForContext(!!bj.ctxIsMinor);
                const romans = bj.ctxIsMinor ? romanMin : romanMaj;
                const diatonicPcSet = new Set<number>(ints.map(iv => (((tonicPc + iv) % 12) + 12) % 12));

                const rootPc = Number(bj.rootPc);
                if (!Number.isFinite(rootPc)) continue;

                // Consider targets other than I (degree 0).
                for (let degIdx = 1; degIdx < 7; degIdx++) {
                    const targetRoman = String(romans[degIdx] || '').trim();
                    if (!targetRoman) continue;

                    const targetRootPc = (((tonicPc + (ints[degIdx] ?? 0)) % 12) + 12) % 12;
                    const expectedDomRootPc = (((targetRootPc + 7) % 12) + 12) % 12;
                    if (rootPc !== expectedDomRootPc) continue;

                    const pcs = pcSet(bj.notes || []);
                    if (!pcs || pcs.size < 3) continue;

                    const targetIsNonDiatonic = !diatonicPcSet.has(targetRootPc);

                    // Default: require chromatic LT to the target (prevents diatonic V readings like V/V in major).
                    // Exception: if the *target* is non-diatonic in the current context, a dominant-7th + resolution
                    // is already strong evidence of tonicization even when the LT is diatonic in the global key.
                    // Example: in C major, B♭7 -> E♭ (V/♭III) has LT = D, which is diatonic in C.
                    if (!targetIsNonDiatonic) {
                        const ltPc = (((targetRootPc - 1) % 12) + 12) % 12;
                        const hasLt = pcs.has(ltPc);
                        const isLtChromatic = !diatonicPcSet.has(ltPc);
                        if (!hasLt || !isLtChromatic) continue;
                    }

                    if (!isDominantLikeCandidate(bj.notes || [], rootPc)) continue;

                    // Look for a resolution to the target degree nearby.
                    let k = -1;
                    for (let t = j + 1; t < base.length; t++) {
                        if ((base[t].absBeat - bj.absBeat) > maxLookaheadBeats + 1e-6) break;
                        const bt = base[t];
                        if (!bt) continue;
                        const rt = String(bt.roman || '').trim();
                        if (rt === targetRoman) { k = t; break; }
                        if (Number.isFinite(Number(bt.rootPc)) && Number(bt.rootPc) === targetRootPc) { k = t; break; }
                    }
                    if (k < 0) continue;

                    const tonicizedTonic = pcToName(targetRootPc);
                    const tonicizedIsMinor = targetRoman === targetRoman.toLowerCase();

                    try {
                        const bk = base[k];
                        if (bk && Number.isFinite(bk.q)) protectedAbsBeats.add(Number(bk.q));
                    } catch { /* ignore */ }

                    try {
                        const bk = base[k];
                        if (bk && Number.isFinite(bk.q) && !overrideByAbsBeat.has(Number(bk.q))) {
                            const display = `${tonicizedIsMinor ? 'i' : 'I'}=${targetRoman}`;
                            autoRomanDisplayByAbsBeat.set(Number(bk.q), display);
                        }
                    } catch { /* ignore */ }

                    // Predominant display immediately before the inferred V/x.
                    try {
                        const maxLookback = Math.min(2.01, beatsPerMeasure);
                        for (let p = j - 1; p >= 0; p--) {
                            const bp = base[p];
                            if (!bp || !Number.isFinite(bp.absBeat)) continue;
                            if ((bj.absBeat - bp.absBeat) > maxLookback + 1e-6) break;
                            const pq = Number(bp.q);
                            if (!Number.isFinite(pq)) continue;
                            if (overrideByAbsBeat.has(pq)) continue;
                            if (autoRomanDisplayByAbsBeat.has(pq)) continue;
                            const rp = String(bp.roman || '').trim();
                            if (!rp || rp.includes('/')) continue;
                            const tonicizedRoman = String(getRomanAnalysis(structuralNotes(bp.notes || []), tonicizedTonic, tonicizedIsMinor)?.roman || '').trim();
                            if (!tonicizedRoman) continue;
                            const isPredLike = /^iv/i.test(tonicizedRoman) || /^ii/i.test(tonicizedRoman) || /^VI/i.test(tonicizedRoman) || /^iio/i.test(tonicizedRoman) || /°/.test(tonicizedRoman);
                            if (!isPredLike) continue;
                            autoRomanDisplayByAbsBeat.set(pq, tonicizedRoman);
                        }
                    } catch { /* ignore */ }

                    // Finally, auto-override the current event to V/target.
                    autoOverrideByAbsBeat.set(bjQ, {
                        absBeat: bj.absBeat,
                        roman: `V/${targetRoman}`,
                        note: `tonicization:${tonicizedTonic}${tonicizedIsMinor ? 'm' : ''}`,
                    });

                    // One inferred target is enough.
                    break;
                }

                // Borrowed targets (major-mode only): ♭III / ♭VI / ♭VII.
                // These degrees are not diatonic in major, so the diatonic-only loop above cannot mark
                // tonicizations like B♭7 -> E♭m in C major. We keep this conservative:
                // - require a dominant-like sonority,
                // - require multiple flats in spelling (strong key-signature cue),
                // - require multiple non-diatonic pcs vs current context,
                // - require a near resolution to a chord whose root matches the borrowed target.
                try {
                    if (bj.ctxIsMinor) continue;
                    if (autoOverrideByAbsBeat.has(bjQ)) continue;

                    const flatCount = countFlatAccidentals(bj.notes || []);
                    if (flatCount < 2) continue;

                    const pcsHere = pcSet(bj.notes || []);
                    if (!pcsHere || pcsHere.size < 3) continue;
                    const nonDia = Array.from(pcsHere.values()).filter(pc => !diatonicPcSet.has(pc)).length;
                    if (nonDia < 2) continue;

                    if (!isDominantLikeCandidate(bj.notes || [], rootPc)) continue;

                    const borrowedTargets: Array<{ roman: string; rootPc: number }> = [
                        { roman: '♭III', rootPc: (((tonicPc + 3) % 12) + 12) % 12 },
                        { roman: '♭VI', rootPc: (((tonicPc + 8) % 12) + 12) % 12 },
                        { roman: '♭VII', rootPc: (((tonicPc + 10) % 12) + 12) % 12 },
                    ];

                    for (const tgt of borrowedTargets) {
                        const expectedDomRootPc = (((tgt.rootPc + 7) % 12) + 12) % 12;
                        if (rootPc !== expectedDomRootPc) continue;

                        let k = -1;
                        for (let t = j + 1; t < base.length; t++) {
                            if ((base[t].absBeat - bj.absBeat) > maxLookaheadBeats + 1e-6) break;
                            const bt = base[t];
                            if (!bt) continue;
                            const btRoot = Number(bt.rootPc);
                            if (Number.isFinite(btRoot) && (((btRoot % 12) + 12) % 12) === tgt.rootPc) { k = t; break; }
                            const pcsT = pcSet(bt.notes || []);
                            if (pcsT && pcsT.size >= 3 && pcsT.has(tgt.rootPc)) { k = t; break; }
                        }
                        if (k < 0) continue;

                        autoOverrideByAbsBeat.set(bjQ, {
                            absBeat: bj.absBeat,
                            roman: `V/${tgt.roman}`,
                            note: `tonicization:${pcToName(tgt.rootPc)}`,
                        });
                        break;
                    }
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }
    } catch {
        // ignore
    }

    // ── Statistical refinement: correct improbable romans using corpus probabilities ──
    // Rules: (1) only intervene on extreme improbability (<2%), (2) never invent
    // chords — only pick from identifyChordCandidates alternatives, (3) the
    // alternative must have >5% probability AND >5× the current probability.
    if (useStatisticalCorrection) {
        try {
            const stripFig = (s: string) => s.replace(/[0-9♭♯]+$/g, '');
            for (let i = 1; i < base.length; i++) {
                const bi = base[i];
                if (!bi?.roman) continue;
                // Never override user or existing auto overrides
                if (overrideByAbsBeat.has(bi.q) || autoOverrideByAbsBeat.has(bi.q)) continue;
                const prev = base[i - 1];
                if (!prev?.roman) continue;
                const prevBase = stripFig(prev.roman);
                const curBase = stripFig(bi.roman);
                if (!prevBase || !curBase) continue;
                // Build context (trigram if available, else bigram)
                const context = i >= 2 && base[i - 2]?.roman
                    ? [stripFig(base[i - 2].roman), prevBase] : [prevBase];
                const suggestions = suggestNextChord(context, 20);
                if (suggestions.length === 0) continue;
                const curProb = suggestions.find(s => s.chord === curBase)?.probability ?? 0;
                // Only intervene on extreme improbability
                if (curProb >= 0.02) continue;
                // Get alternative chord interpretations from the SAME notes
                const cands = identifyChordCandidates(bi.notes || []);
                if (!Array.isArray(cands) || cands.length < 2) continue;
                let bestAlt: { roman: string; prob: number } | null = null;
                for (const c of cands) {
                    if (!c?.root) continue;
                    // Reorder notes so this candidate's root is lowest → different inversion reading
                    const reordered = [...(bi.notes || [])].sort((a: any, b: any) => {
                        const aR = (((a.noteIndex ?? -1) % 12) + 12) % 12 === (((c.root.noteIndex ?? -1) % 12) + 12) % 12;
                        const bR = (((b.noteIndex ?? -1) % 12) + 12) % 12 === (((c.root.noteIndex ?? -1) % 12) + 12) % 12;
                        if (aR && !bR) return -1;
                        if (!aR && bR) return 1;
                        return 0;
                    });
                    const alt = getRomanAnalysis(structuralNotes(reordered), bi.ctxTonic, bi.ctxIsMinor);
                    if (!alt?.roman) continue;
                    const altBase = stripFig(String(alt.roman));
                    if (altBase === curBase) continue;
                    const altProb = suggestions.find(s => s.chord === altBase)?.probability ?? 0;
                    if (altProb > 0.05 && altProb > curProb * 5) {
                        if (!bestAlt || altProb > bestAlt.prob) {
                            bestAlt = { roman: String(alt.roman), prob: altProb };
                        }
                    }
                }
                if (bestAlt) {
                    autoOverrideByAbsBeat.set(bi.q, {
                        absBeat: bi.absBeat,
                        roman: bestAlt.roman,
                        note: 'stat-correction',
                    });
                }
            }
        } catch {
            // ignore
        }
    }

    return {
        autoOverrideByAbsBeat,
        autoRomanDisplayByAbsBeat,
        protectedAbsBeats,
    };
}
