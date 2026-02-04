import type { HarmonyLabelOverride, TimeSignature } from '../types';

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
            overrideByAbsBeat.set(qAbsBeat(a), {
                absBeat: a,
                roman: typeof o?.roman === 'string' ? o.roman : undefined,
                romanDisplay: typeof o?.romanDisplay === 'string' ? o.romanDisplay : undefined,
                symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                note: typeof o?.note === 'string' ? o.note : undefined,
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
    const fallbackHarmonicNotes = (harmonicNotes.length >= 2)
        ? harmonicNotes
        : (fullNotes || []).filter((n: any) => n && !n.isRest);
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
            const r = getRomanAnalysis((ev?.notes || []) as any, ctxTonic, ctxIsMinor);
            const rootPc = (() => {
                try {
                    const pcs = pcSetFromNotes((ev?.notes || []) as any);
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
            };
        }).filter((x: any) => Number.isFinite(x.absBeat));

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
            if (k < 0) continue;

            try {
                const bk = base[k];
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
                const bk = base[k];
                if (bk && Number.isFinite(bk.q) && !overrideByAbsBeat.has(bk.q)) {
                    const display = `${tonicizedIsMinor ? 'i' : 'I'}=${targetRoman}`;
                    autoRomanDisplayByAbsBeat.set(bk.q, display);
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
    } catch {
        // ignore
    }

    return {
        autoOverrideByAbsBeat,
        autoRomanDisplayByAbsBeat,
        protectedAbsBeats,
    };
}
