import { CHORD_FORMULAS, DURATION_VALUES } from '../constants';
import type { TimeSignature } from '../types';
import {
    calculateRomanFromChordInfo,
    computeFiguredBassFromNotes,
    FIGURED_BASS_UI_OPTIONS,
    getActiveNotesTimeline,
    getChordSymbol,
    getKeySignature,
    getRomanAnalysis,
    identifyChordCandidates,
    normalizeNotePitchFieldsWithKey,
} from './musicTheory';
import {
    buildEngineHarmonyOverrideMap,
    buildUserHarmonyOverrideMap,
    computeLookaheadTonicizationOverrides,
    computeStructuralSnapshotForHarmonyLabelEvent,
    filterTimelineForHarmonyLabels,
    getNearAbsBeat,
    isCompoundMeter,
    isStrongPulseInMeasure,
    qAbsBeat,
} from './harmonyLabelPipeline';

export type HarmonyLabelPoint = {
    id: string;
    x: number;
    roman: string;
    romanDisplay?: string;
    sequenceRoman?: string;
    sequenceRomanFunctional?: string;
    sequenceRomanSource?: string;
    figures: string[];
    symbol: string;
    absBeat?: number;
    hiddenMarker?: boolean;
    isOverride?: boolean;
    pcsSig?: string;
};

export function computeHarmonyLabelsBySystem(opts: {
    isAnalysisEnabled: boolean;
    layoutData: any;
    timeSignature: TimeSignature;
    timeSignatureChanges: any[];
    effectiveAnalysisContexts: any[];
    analysisContextAbsBeat: (ctx: any) => number;
    currentTonic: string;
    isMinorMode: boolean;
    minorScaleMode?: 'off' | 'natural' | 'harmonic';
    harmonyOverrides: any[];
    analysisResult: any;
    analyzedNotes: any[];
    noteNameToChromaticIndex: (name: string) => number;
    startX: number;
    measurePaddingX: number;
}): HarmonyLabelPoint[][] {
    const {
        isAnalysisEnabled,
        layoutData,
        timeSignature,
        timeSignatureChanges,
        effectiveAnalysisContexts,
        analysisContextAbsBeat,
        currentTonic,
        isMinorMode,
        minorScaleMode,
        harmonyOverrides,
        analysisResult,
        analyzedNotes,
        noteNameToChromaticIndex,
        startX,
        measurePaddingX,
    } = opts;

    if (!isAnalysisEnabled || !layoutData) return [];

    // IMPORTANT: the harmony-label logic relies on analysis flags (isPassing/isNeighbor/...)
    // to suppress spurious labels on non-chord tones.
    // `layoutData.positionedNotes` may be derived from raw layout and can miss these flags,
    // so prefer `analyzedNotes` when available.
    const timelineSourceNotes = (Array.isArray(analyzedNotes) && analyzedNotes.length)
        ? analyzedNotes
        : layoutData.positionedNotes;
    const timeline = getActiveNotesTimeline(timelineSourceNotes, timeSignature as any, timeSignatureChanges as any);

    const isCompoundMeterFlag = isCompoundMeter(timeSignature);
    const isStrongPulseInMeasureFn = (inMeasureBeats0: number) => isStrongPulseInMeasure(timeSignature, inMeasureBeats0);

    const timelineForLabels = filterTimelineForHarmonyLabels(timeline as any, timeSignature) as any[];
    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

    const ctxAtAbsBeat = (absBeat: number) => (effectiveAnalysisContexts || [])
        .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
        .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

    const qAbs = qAbsBeat;
    const getNear = getNearAbsBeat;

    const overrideByAbsBeat = buildUserHarmonyOverrideMap(harmonyOverrides as any);
    const engineOverrideByAbsBeat = buildEngineHarmonyOverrideMap((analysisResult as any)?.autoHarmonyLabelOverrides);

    const pcSetFromNotes = (notes: any[]): Set<number> => {
        const s = new Set<number>();
        for (const n of notes || []) {
            if (!n || n.isRest) continue;
            const pc = Number.isFinite(n?.midi)
                ? (((n.midi % 12) + 12) % 12)
                : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
            if (pc == null || !Number.isFinite(pc)) continue;
            s.add(pc);
        }
        return s;
    };

    const {
        autoOverrideByAbsBeat,
        autoRomanDisplayByAbsBeat,
        protectedAbsBeats,
    } = computeLookaheadTonicizationOverrides({
        timelineForLabels,
        beatsPerMeasure,
        currentTonic,
        isMinorMode,
        minorScaleMode,
        ctxAtAbsBeat,
        noteNameToChromaticIndex,
        getRomanAnalysis: (notes: any[], tonic: string, isMinor: boolean) => getRomanAnalysis(notes as any, tonic, isMinor, { minorScaleMode }),
        identifyChordCandidates,
        pcSetFromNotes,
        overrideByAbsBeat,
    });

    const labelsBySystem: HarmonyLabelPoint[][] = (layoutData.systemsParams || []).map(() => []);

    function getXForAbsBeat(absBeat: number, system: any): number {
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) {
                const bpm = timeSignature.numerator * (4 / timeSignature.denominator);
                return Math.floor(ab / bpm);
            }
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const measureIndex = findMeasureIndexForAbsBeat(absBeat);
        const beatsPerMeasureLocal = (measureBeatsPerMeasure && measureBeatsPerMeasure[measureIndex])
            ? measureBeatsPerMeasure[measureIndex]
            : (timeSignature.numerator * (4 / timeSignature.denominator));
        const beatInMeasure = (absBeat - ((measureStartAbsBeat && measureStartAbsBeat[measureIndex]) ? measureStartAbsBeat[measureIndex] : (measureIndex * beatsPerMeasureLocal))) + 1;
        const idx = system.measureIndices.indexOf(measureIndex);
        if (idx === -1) return 0;
        const startXLocal = system.startMeasuresX[idx];
        const endX = idx < system.measureIndices.length - 1 ? system.startMeasuresX[idx + 1] : (system.width - startX);
        const measureWidth = Math.max(1, endX - startXLocal);
        const contentWidth = Math.max(1, measureWidth - (measurePaddingX * 2));
        const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / beatsPerMeasureLocal));
        return startXLocal + measurePaddingX + (rel * contentWidth);
    }

    const lastSigBySystem = new Map<number, string>();
    const lastCtxBySystem = new Map<number, string>();
    const lastStructuralByVoiceBySystem = new Map<number, Map<number, any>>();
    const lastBassPcBySystem = new Map<number, number | null>();
    const lastRomanBySystem = new Map<number, string>();
    const lastFiguresBySystem = new Map<number, string[]>();
    const lastChordRootPcBySystem = new Map<number, number | null>();
    const lastChordTypeBySystem = new Map<number, string | null>();

    const indexByAbsBeat = new Map<number, number>();
    for (let i = 0; i < (timeline || []).length; i++) {
        const ev = (timeline as any[])[i];
        if (ev && typeof ev.absBeat === 'number') indexByAbsBeat.set(ev.absBeat, i);
    }

    const isDissonantIntervalAgainstBass = (note: any, notes: any[]): boolean => {
        try {
            if (!note || note.isRest || !Number.isFinite(note.midi)) return false;
            const pool = (notes || []).filter(n => n && !n.isRest && Number.isFinite(n.midi));
            if (pool.length < 2) return false;
            const bass = pool.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
            if (!bass || bass.id === note.id) return false;
            const interval = (((note.midi - bass.midi) % 12) + 12) % 12;
            return interval === 1 || interval === 2 || interval === 5 || interval === 6 || interval === 10 || interval === 11;
        } catch {
            return false;
        }
    };

    const findNextOnsetForVoice = (fromFullIndex: number, voice: number, maxDeltaBeats = 1.01): { note: any; ev: any } | null => {
        try {
            if (fromFullIndex < 0 || fromFullIndex >= (timeline || []).length) return null;
            const fromEv: any = (timeline as any[])[fromFullIndex];
            const fromAbs = fromEv?.absBeat ?? 0;
            const prevIds = new Set<string>(((fromEv?.notes || []) as any[])
                .filter(n => (n?.voice ?? 1) === voice)
                .map(n => String(n?.id ?? '')));
            for (let j = fromFullIndex + 1; j < (timeline || []).length; j++) {
                const ev: any = (timeline as any[])[j];
                if (!ev || typeof ev.absBeat !== 'number') continue;
                if ((ev.absBeat - fromAbs) > maxDeltaBeats) break;
                const candidates = ((ev.notes || []) as any[]).filter(n => (n?.voice ?? 1) === voice);
                for (const n of candidates) {
                    const id = String(n?.id ?? '');
                    if (!id) continue;
                    if (!prevIds.has(id)) return { note: n, ev };
                }
            }
        } catch {
            // ignore
        }
        return null;
    };

    const isResolvingDissonanceForLabels = (n: any, evAbsBeat: number): boolean => {
        try {
            if (!n || n.isRest) return false;
            const v = (n?.voice ?? 1) as number;
            if (v === 4) return false;
            const fullIndex = indexByAbsBeat.get(evAbsBeat);
            if (fullIndex == null) return false;
            const curEv: any = (timeline as any[])[fullIndex];

            const isChordToneOfConfidentCandidate = (note: any, notesHere: any[]): boolean => {
                try {
                    if (!note || note.isRest) return false;
                    const notes = (notesHere || []) as any[];
                    if (notes.length < 3) return false;
                    const cands = identifyChordCandidates(notes as any);
                    const best = (cands && cands.length) ? cands[0] : null;
                    const matchType = (best as any)?.matchType;
                    const chordType = String(best?.type || '');
                    const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                    const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                    if (!confident || isSusLike || !best?.root || !best?.type) return false;

                    const rootPc = Number.isFinite((best.root as any).noteIndex)
                        ? (((best.root as any).noteIndex % 12) + 12) % 12
                        : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                    const notePc = Number.isFinite(note?.midi)
                        ? (((note.midi % 12) + 12) % 12)
                        : (typeof note.noteIndex === 'number' ? (((note.noteIndex % 12) + 12) % 12) : null);
                    if (rootPc == null || notePc == null) return false;

                    const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                    if (!Array.isArray(formula) || !formula.length) return false;
                    const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                    return formula.includes(intervalFromRoot);
                } catch {
                    return false;
                }
            };

            try {
                const prevEv: any = fullIndex > 0 ? (timeline as any[])[fullIndex - 1] : null;
                if (prevEv?.notes) {
                    const alreadySounding = ((prevEv.notes || []) as any[]).some(p => (p?.voice ?? 1) === v && String(p?.id ?? '') && String(p?.id ?? '') === String(n?.id ?? ''));
                    if (alreadySounding) return false;
                }
            } catch {
                // ignore
            }

            try {
                const notesHere = (curEv?.notes || []) as any[];
                if (isChordToneOfConfidentCandidate(n, notesHere)) {
                    const cands = identifyChordCandidates(notesHere as any);
                    const best = (cands && cands.length) ? cands[0] : null;
                    const chordType = String(best?.type || '');
                    const rootPc = Number.isFinite((best?.root as any)?.noteIndex)
                        ? (((best.root as any).noteIndex % 12) + 12) % 12
                        : (Number.isFinite((best?.root as any)?.midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                    const notePc = Number.isFinite(n?.midi)
                        ? (((n.midi % 12) + 12) % 12)
                        : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                    if (rootPc != null && notePc != null) {
                        const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                        try {
                            const isSeventh = intervalFromRoot === 10 || intervalFromRoot === 11;
                            const isMajor7Like = /Major\s*7/i.test(chordType) || /Minor\s*7/i.test(chordType);
                            const isDominant7 = /Dominant\s*7/i.test(chordType) || (/7/.test(chordType) && /Dominant/i.test(chordType));
                            if (isSeventh && isMajor7Like && !isDominant7) {
                                const remaining = notesHere.filter(nn => String(nn?.id ?? '') !== String(n?.id ?? ''));
                                if (remaining.length >= 2) {
                                    const c2 = identifyChordCandidates(remaining as any);
                                    const b2 = (c2 && c2.length) ? c2[0] : null;
                                    const mt2 = (b2 as any)?.matchType;
                                    const confident2 = mt2 === 'exact' || mt2 === 'no_fifth' || mt2 === 'no_third';
                                    const t2 = String(b2?.type || '');
                                    const isTriad2 = !/7|9|11|13/i.test(t2) && !/Major\s*7|Minor\s*7|Dominant\s*7/i.test(t2);
                                    if (confident2 && isTriad2) {
                                        // allow
                                    } else {
                                        return false;
                                    }
                                } else {
                                    return false;
                                }
                            } else {
                                return false;
                            }
                        } catch {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
            } catch {
                // ignore
            }

            if (!isDissonantIntervalAgainstBass(n, curEv?.notes || [])) return false;

            const next = findNextOnsetForVoice(fullIndex, v, 2.01);
            if (!next?.note || !Number.isFinite(n.midi) || !Number.isFinite(next.note.midi)) return false;
            const step = Math.abs((next.note.midi ?? 0) - (n.midi ?? 0));
            if (!(step > 0 && step <= 2)) return false;
            if (isDissonantIntervalAgainstBass(next.note, next.ev?.notes || [])) return false;
            return true;
        } catch {
            return false;
        }
    };

    const isNonChordToneAtLabelEvent = (n: any, absBeat: number) => {
        try {
            if (!n) return true;
            if (n.isRest) return true;
            const v = (n?.voice ?? 1) as number;
            if (v === 4) {
                const isBassOrnFlag = !!(n.isPassing || n.isEscape || n.isNeighbor || n.isAnticipation || n.isAppoggiatura);
                if (!isBassOrnFlag) return false;

                const dur = (() => {
                    try {
                        const base = (DURATION_VALUES as any)[n.duration || 'quarter'] || 1;
                        let val = base;
                        if (n.isDotted) val *= 1.5;
                        if (n.isTriplet) val *= 2 / 3;
                        if (n.isDuplet) val *= 3 / 2;
                        return val;
                    } catch {
                        return 999;
                    }
                })();

                const weak = (() => {
                    try {
                        const beatsPerMeasure2 = timeSignature.numerator * (4 / timeSignature.denominator);
                        const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure2) * beatsPerMeasure2;
                        return !isStrongPulseInMeasureFn(inMeasure);
                    } catch {
                        return false;
                    }
                })();

                if (weak && dur <= 1.01) return true;
                return false;
            }

            // This block is intentionally kept identical to the component's behavior.
            // It prefers keeping likely chord tones when the engine mis-tags them.
            try {
                const isStrongBeat = (() => {
                    try {
                        const beatsPerMeasure2 = timeSignature.numerator * (4 / timeSignature.denominator);
                        const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure2) * beatsPerMeasure2;
                        return isStrongPulseInMeasureFn(inMeasure);
                    } catch {
                        return false;
                    }
                })();

                const hasNctFlag = !!(n.isAnticipation || n.isAppoggiatura || (n.isNeighbor && isStrongBeat));
                if (hasNctFlag) {
                    const fullIndex = indexByAbsBeat.get(absBeat);
                    const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                    const notesHere = (curEv?.notes || []) as any[];
                    if (notesHere.length >= 3) {
                        const cands = identifyChordCandidates(notesHere as any);
                        const best = (cands && cands.length) ? cands[0] : null;
                        const matchType = (best as any)?.matchType;
                        const chordType = String(best?.type || '');
                        const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                        const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                        if (confident && !isSusLike && best?.root && best?.type) {
                            const rootPc = Number.isFinite((best.root as any).noteIndex)
                                ? (((best.root as any).noteIndex % 12) + 12) % 12
                                : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                            const notePc = Number.isFinite(n?.midi)
                                ? (((n.midi % 12) + 12) % 12)
                                : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                            if (rootPc != null && notePc != null) {
                                const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                                if (Array.isArray(formula) && formula.length) {
                                    const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                                    if (formula.includes(intervalFromRoot)) {
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch {
                // ignore
            }

            try {
                if (n.isPassing || n.isEscape) {
                    const isBeatBoundary = (() => {
                        try {
                            const beatsPerMeasure2 = timeSignature.numerator * (4 / timeSignature.denominator);
                            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure2) * beatsPerMeasure2;
                            const isCompound = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
                            const EPS = 1e-3;
                            if (isCompound) return isStrongPulseInMeasureFn(inMeasure);
                            return Math.abs(inMeasure - Math.round(inMeasure)) < EPS;
                        } catch {
                            return false;
                        }
                    })();

                    if (isBeatBoundary) {
                        const fullIndex = indexByAbsBeat.get(absBeat);
                        const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                        const notesHereAll = (curEv?.notes || []) as any[];
                        const supportNotes = (notesHereAll || []).filter((x: any) => {
                            if (!x || x.isRest) return false;
                            if (String(x?.id ?? '') === String(n?.id ?? '')) return false;
                            if (x.isPassing || x.isEscape || x.isNeighbor || x.isAnticipation || x.isAppoggiatura) return false;
                            return true;
                        });
                        if (supportNotes.length >= 3) {
                            const cands = identifyChordCandidates(supportNotes as any);
                            const best = (cands && cands.length) ? cands[0] : null;
                            const matchType = (best as any)?.matchType;
                            const chordType = String(best?.type || '');
                            const confident = matchType === 'exact' || matchType === 'no_fifth' || matchType === 'no_third';
                            const isSusLike = chordType.includes('Sus') || chordType.includes('sus') || chordType.includes('Add') || chordType.includes('add');
                            if (confident && !isSusLike && best?.root && best?.type) {
                                const rootPc = Number.isFinite((best.root as any).noteIndex)
                                    ? (((best.root as any).noteIndex % 12) + 12) % 12
                                    : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                                const notePc = Number.isFinite(n?.midi)
                                    ? (((n.midi % 12) + 12) % 12)
                                    : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                                if (rootPc != null && notePc != null) {
                                    const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                                    if (Array.isArray(formula) && formula.length) {
                                        const intervalFromRoot = (((notePc - rootPc) % 12) + 12) % 12;
                                        if (formula.includes(intervalFromRoot)) {
                                            return false;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    return true;
                }
            } catch {
                // ignore
            }

            if (n.isPassing || n.isEscape) return true;

            if (n.isAppoggiatura) {
                const fullIndex = indexByAbsBeat.get(absBeat);
                const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                if (curEv?.notes && isDissonantIntervalAgainstBass(n, curEv.notes || [])) return true;
                return false;
            }

            if (n.isAnticipation) {
                const fullIndex = indexByAbsBeat.get(absBeat);
                const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                if (curEv?.notes && isDissonantIntervalAgainstBass(n, curEv.notes || [])) return true;
                return false;
            }

            if (n.isNeighbor) {
                const fullIndex = indexByAbsBeat.get(absBeat);
                const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                if (curEv?.notes && !isDissonantIntervalAgainstBass(n, curEv.notes || [])) {
                    try {
                        const beatsPerMeasure2 = timeSignature.numerator * (4 / timeSignature.denominator);
                        const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure2) * beatsPerMeasure2;
                        if (isStrongPulseInMeasureFn(inMeasure)) return false;
                    } catch {
                        // ignore
                    }
                }
                return true;
            }

            const s = n.isSuspension;
            if (s && typeof s.fromAbsBeat === 'number' && Math.abs(s.fromAbsBeat - absBeat) < 1e-6) return true;
            if (isResolvingDissonanceForLabels(n, absBeat)) return true;
        } catch {
            // ignore
        }
        return false;
    };

    const inferDiatonicRomanFromBass = (bassPc: number | null, tonic: string, isMinor: boolean): { roman: string; triad: { root: number; third: number; fifth: number } } | null => {
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
                triad: {
                    root: rootPc,
                    third: (rootPc + thirdInt) % 12,
                    fifth: (rootPc + fifthInt) % 12,
                },
            };
        } catch {
            return null;
        }
    };

    const findPrevNoteForVoice = (fromFullIndex: number, voice: number, curNoteId: string, maxDeltaBeats = 2.01): { note: any; ev: any } | null => {
        try {
            if (fromFullIndex < 0 || fromFullIndex >= (timeline || []).length) return null;
            const fromEv: any = (timeline as any[])[fromFullIndex];
            const fromAbs = Number(fromEv?.absBeat ?? 0);

            for (let i = fromFullIndex - 1; i >= 0; i--) {
                const ev: any = (timeline as any[])[i];
                if (!ev) continue;
                const abs = Number(ev.absBeat);
                if (!Number.isFinite(abs)) continue;
                if ((fromAbs - abs) > maxDeltaBeats + 1e-6) break;

                const notesHere = (ev.notes || []) as any[];
                const cand = notesHere.find(n => n && !n.isRest && (n.voice ?? 1) === voice);
                if (!cand) continue;
                const id = String(cand?.id ?? '');
                if (!id || id === String(curNoteId || '')) continue;
                return { note: cand, ev };
            }
            return null;
        } catch {
            return null;
        }
    };

    const durBeats = (n: any): number => {
        try {
            if (!n) return 999;
            const base = (DURATION_VALUES as any)[n.duration || 'quarter'] || 1;
            let val = base;
            if (n.isDotted) val *= 1.5;
            if (n.isTriplet) val *= 2 / 3;
            if (n.isDuplet) val *= 3 / 2;
            return Number(val);
        } catch {
            return 999;
        }
    };

    const inferDiatonicTriadFromRoman = (roman: string, tonic: string, isMinor: boolean): { root: number; third: number; fifth: number } | null => {
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
            return {
                root: rootPc,
                third: (rootPc + thirdInt) % 12,
                fifth: (rootPc + fifthInt) % 12,
            };
        } catch {
            return null;
        }
    };

    const signatureFromNotes = (notes: any[]) => {
        try {
            const pcs = [...new Set((notes || []).filter(Boolean)
                .map((n: any) => {
                    if (Number.isFinite(n?.midi)) return (((n.midi % 12) + 12) % 12);
                    if (typeof n?.noteIndex === 'number') return (((n.noteIndex % 12) + 12) % 12);
                    return null;
                })
                .filter((v: any) => v != null && Number.isFinite(v)))].sort((a, b) => a - b);
            return pcs.join('-');
        } catch {
            return '';
        }
    };

    const triadPcsFromRootAndType = (rootPc: number, chordType: string): { root: number; third: number; fifth: number } | null => {
        try {
            if (rootPc == null || !Number.isFinite(rootPc)) return null;
            const t = String(chordType || '');
            const isDim = t.includes('dim') || t.includes('°') || t.includes('b5');
            const isAug = t.includes('aug') || t.includes('+') || t.includes('#5');
            const isMinorTriad = !isDim && !isAug && (t.startsWith('m') || t.includes('Minor'));
            const thirdInt = isMinorTriad || isDim ? 3 : 4;
            const fifthInt = isAug ? 8 : (isDim ? 6 : 7);
            const root = (((rootPc % 12) + 12) % 12);
            return {
                root,
                third: (root + thirdInt) % 12,
                fifth: (root + fifthInt) % 12,
            };
        } catch {
            return null;
        }
    };

    const isSubset = (a: Set<number>, b: Set<number>): boolean => {
        for (const x of a) if (!b.has(x)) return false;
        return true;
    };

    timelineForLabels.forEach((event: any, eventIndex: number) => {
        const measureIndex = event.measureIndex;
        let systemIndex = -1;
        for (let i = 0; i < layoutData.systemsParams.length; i++) {
            if (layoutData.systemsParams[i].measureIndices.includes(measureIndex)) {
                systemIndex = i;
                break;
            }
        }
        if (systemIndex === -1) return;
        const system = layoutData.systemsParams[systemIndex];

        const fullNotes = (event.notes || []);

        // Bass appoggiatura / unprepared retardation heuristic:
        // If the bass at this event is a short non-chord tone that resolves by step
        // to the next bass onset, label using the *resolved* bass so the harmony
        // appears at the dissonance onset (like suspensions) without creating a
        // spurious dominant-type label.
        const bassAppoggiatura = (() => {
            try {
                const absBeat = Number(event.absBeat);
                const fullIndex = indexByAbsBeat.get(absBeat);
                if (fullIndex == null) return null;

                const active = (fullNotes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi)) as any[];
                if (active.length < 3) return null;

                const curBass = active.slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                if (!curBass || (curBass.voice ?? 1) !== 4) return null;
                const curDur = durBeats(curBass);
                if (!(curDur > 0 && curDur <= 0.51 + 1e-6)) return null;

                const nextBass = findNextOnsetForVoice(fullIndex, 4, 0.76);
                if (!nextBass?.note || !Number.isFinite(nextBass.note.midi)) return null;
                const step = Math.abs((nextBass.note.midi ?? 0) - (curBass.midi ?? 0));
                if (!(step > 0 && step <= 2)) return null;

                const support = (fullNotes || []).filter((x: any) => {
                    if (!x || x.isRest) return false;
                    if (String(x?.id ?? '') === String(curBass?.id ?? '')) return false;
                    if (x.isPassing || x.isEscape || x.isNeighbor || x.isAnticipation || x.isAppoggiatura) return false;
                    return true;
                });
                if (support.length < 2) return null;

                const cands = identifyChordCandidates(support as any);
                const best: any = (cands && cands.length) ? cands[0] : null;
                const mt = String(best?.matchType || '');
                const confident = mt === 'exact' || mt === 'no_fifth' || mt === 'no_third';
                if (!confident || !best?.root || !best?.type) return null;

                const rootPc = Number.isFinite((best.root as any).noteIndex)
                    ? (((best.root as any).noteIndex % 12) + 12) % 12
                    : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                if (rootPc == null || !Array.isArray(formula) || !formula.length) return null;

                const pcOf = (n: any): number | null => {
                    if (!n || n.isRest) return null;
                    if (Number.isFinite(n.midi)) return (((n.midi % 12) + 12) % 12);
                    if (typeof n.noteIndex === 'number' && Number.isFinite(n.noteIndex)) return (((n.noteIndex % 12) + 12) % 12);
                    return null;
                };
                const isChordTone = (n: any): boolean => {
                    const pc = pcOf(n);
                    if (pc == null) return false;
                    const rel = (((pc - rootPc) % 12) + 12) % 12;
                    return rel === 0 || formula.includes(rel);
                };

                if (isChordTone(curBass)) return null;
                if (!isChordTone(nextBass.note)) return null;

                const labelNotes = (support as any[]).slice();
                labelNotes.push(nextBass.note);
                return { curBassId: String(curBass?.id ?? ''), resolvedBass: nextBass.note, labelNotes };
            } catch {
                return null;
            }
        })();

        const labelNotesOverride = (() => {
            try {
                const absBeat = Number(event.absBeat);
                const fullIndex = indexByAbsBeat.get(absBeat);
                if (fullIndex == null) return null;

                // Start from bass-resolved notes if we detected a bass appoggiatura.
                let base: any[] = bassAppoggiatura?.labelNotes
                    ? (bassAppoggiatura.labelNotes || []).slice()
                    : (fullNotes || []).slice();

                // Only consider accented appoggiaturas on strong beats.
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                const isBeatBoundary = (() => {
                    try {
                        const EPS = 1e-3;
                        if (isCompoundMeterFlag) return isStrongPulseInMeasureFn(inMeasure);
                        return Math.abs(inMeasure - Math.round(inMeasure)) < EPS;
                    } catch {
                        return false;
                    }
                })();
                const isStrongHere = isStrongPulseInMeasureFn(inMeasure);
                if (!(isStrongHere || isBeatBoundary)) return bassAppoggiatura?.labelNotes ? base : null;

                const prevEv: any = (eventIndex > 0) ? (timelineForLabels[eventIndex - 1] as any) : null;
                const prevIds = new Set<string>(((prevEv?.notes || []) as any[]).map((n: any) => String(n?.id ?? '')).filter(Boolean));
                const onsetHere = new Set<string>(((fullNotes || []) as any[])
                    .filter((n: any) => n && !n.isRest && !prevIds.has(String(n.id ?? '')))
                    .map((n: any) => String(n.id ?? ''))
                    .filter(Boolean));

                // Propose replacements for upper-voice onsets that resolve by step.
                const proposals: Array<{ voice: number; cur: any; next: any }> = [];
                for (const voice of [1, 2, 3]) {
                    const cur = (fullNotes || []).find((n: any) => n && !n.isRest && (n.voice ?? 1) === voice);
                    if (!cur) continue;
                    const curId = String(cur?.id ?? '');
                    if (!curId || !onsetHere.has(curId)) continue;
                    if ((cur as any).isSuspension) continue;

                    const d = durBeats(cur);
                    if (!(d > 0 && d <= 0.51 + 1e-6)) continue;

                    const next = findNextOnsetForVoice(fullIndex, voice, 0.76);
                    if (!next?.note) continue;
                    if (!Number.isFinite(cur?.midi) || !Number.isFinite(next.note?.midi)) continue;

                    const step = Math.abs((next.note.midi ?? 0) - (cur.midi ?? 0));
                    if (!(step > 0 && step <= 2)) continue;

                    proposals.push({ voice, cur, next: next.note });
                }

                if (!proposals.length) return bassAppoggiatura?.labelNotes ? base : null;

                // Build a "resolved" verticality for chord identification.
                const resolved: any[] = (fullNotes || []).filter((n: any) => {
                    const v = Number(n?.voice ?? 1);
                    const p = proposals.find(pp => pp.voice === v);
                    if (!p) return true;
                    return String(n?.id ?? '') !== String(p.cur?.id ?? '');
                });
                for (const p of proposals) resolved.push(p.next);

                const chordInfo = (() => {
                    try {
                        const support = (resolved || []).filter((x: any) => {
                            if (!x || x.isRest) return false;
                            if (x.isPassing || x.isEscape || x.isNeighbor || x.isAnticipation || x.isAppoggiatura) return false;
                            return true;
                        });
                        if (support.length < 3) return null;
                        const cands = identifyChordCandidates(support as any);
                        const best: any = (cands && cands.length) ? cands[0] : null;
                        const mt = String(best?.matchType || '');
                        const confident = mt === 'exact' || mt === 'no_fifth' || mt === 'no_third';
                        if (!confident || !best?.root || !best?.type) return null;

                        const rootPc = Number.isFinite((best.root as any).noteIndex)
                            ? (((best.root as any).noteIndex % 12) + 12) % 12
                            : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                        if (rootPc == null || !Array.isArray(formula) || !formula.length) return null;
                        return { rootPc, formula };
                    } catch {
                        return null;
                    }
                })();

                if (!chordInfo) return bassAppoggiatura?.labelNotes ? base : null;

                const isChordTone = (n: any): boolean => {
                    try {
                        if (!n || n.isRest) return false;
                        const notePc = Number.isFinite(n?.midi)
                            ? (((n.midi % 12) + 12) % 12)
                            : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                        if (notePc == null) return false;
                        const rel = (((notePc - chordInfo.rootPc) % 12) + 12) % 12;
                        return rel === 0 || chordInfo.formula.includes(rel);
                    } catch {
                        return false;
                    }
                };

                // Apply only proposals where current is non-chord tone and resolved is chord tone.
                const finalRepls = proposals.filter(p => !isChordTone(p.cur) && isChordTone(p.next));
                if (!finalRepls.length) return bassAppoggiatura?.labelNotes ? base : null;

                // Apply to base (which may already contain bass resolution).
                base = (base || []).filter((n: any) => {
                    const v = Number(n?.voice ?? 1);
                    const p = finalRepls.find(pp => pp.voice === v);
                    if (!p) return true;
                    return String(n?.id ?? '') !== String(p.cur?.id ?? '');
                });
                for (const p of finalRepls) base.push(p.next);

                return base;
            } catch {
                return bassAppoggiatura?.labelNotes ? (bassAppoggiatura.labelNotes || []).slice() : null;
            }
        })();

        const {
            harmonicNotes,
            fallbackHarmonicNotes,
            baseHarmonicNotes,
            analysisNotes,
            analysisNotesForNaming,
        } = computeStructuralSnapshotForHarmonyLabelEvent({
            fullNotes,
            eventAbsBeat: Number(event.absBeat),
            systemIndex,
            timeSignature,
            isCompoundMeter: isCompoundMeterFlag,
            isStrongPulseInMeasure: isStrongPulseInMeasureFn,
            isNonChordToneAtLabelEvent,
            isDissonantIntervalAgainstBass,
            lastStructuralByVoiceBySystem,
        });

        const bassNote = ((labelNotesOverride || analysisNotes) || [])
            .filter((n: any) => n && !n.isRest && Number.isFinite(n.midi))
            .slice()
            .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
        const bassPc = bassNote && Number.isFinite(bassNote.midi) ? (((bassNote.midi % 12) + 12) % 12) : null;

        const harmonicSig = signatureFromNotes((labelNotesOverride || baseHarmonicNotes) as any);
        const fullSig = signatureFromNotes(fullNotes || []);
        // For "hidden change" detection, ignore pure ornaments. Otherwise a passing tone onset
        // changes `fullSig` and can incorrectly force a new visible harmony label.
        const fullSigNoOrn = signatureFromNotes((fullNotes || []).filter((n: any) => {
            if (!n || n.isRest) return false;
            return !(
                n.isPassing ||
                n.isNeighbor ||
                n.isAnticipation ||
                n.isAppoggiatura ||
                n.isEscape
            );
        }));
        if (!harmonicSig || (!labelNotesOverride && baseHarmonicNotes.length < 2)) {
            return;
        }

        const applicableContext = ctxAtAbsBeat(event.absBeat);
        const contextTonic = applicableContext ? applicableContext.newTonic : currentTonic;
        const contextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinorMode;

        const ctxKey = `${contextTonic}::${contextIsMinor ? 'm' : 'M'}`;
        const prevSig = lastSigBySystem.get(systemIndex);
        const prevCtx = lastCtxBySystem.get(systemIndex);
        const prevBassPc = lastBassPcBySystem.get(systemIndex);

        const hasOrnamentOnsetAtThisBeat = (() => {
            try {
                return (fullNotes || []).some((n: any) => {
                    if (!n || n.isRest) return false;
                    // Treat passing notes as ornaments for label-suppression purposes.
                    // A bass passing tone can otherwise create spurious harmony labels (e.g. I4)
                    // on weak beats even when the underlying harmony is held.
                    return !!(n.isPassing || n.isNeighbor || n.isAnticipation || n.isAppoggiatura || n.isEscape);
                });
            } catch {
                return false;
            }
        })();

        const shouldSuppressAsCompletion = (() => {
            try {
                if (!prevSig || prevCtx !== ctxKey) return false;
                if (prevBassPc == null || bassPc == null) return false;
                if (prevBassPc !== bassPc) return false;

                const prevPcs = new Set(prevSig.split('-').filter(Boolean).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)));
                const curPcs = new Set(harmonicSig.split('-').filter(Boolean).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)));
                if (prevPcs.size !== 2) return false;
                if (curPcs.size !== 3) return false;
                for (const p of prevPcs) if (!curPcs.has(p)) return false;

                {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
                        const ok = Array.from(curPcs).every(p => triadSet.has(p));
                        if (ok) return true;
                    }
                }

                {
                    const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman && !String(prevRoman).includes('/')) {
                        const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                        if (prevTriad) {
                            const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                            const okPrev = Array.from(prevPcs).every(p => triadSet.has(p));
                            const okCur = Array.from(curPcs).every(p => triadSet.has(p));
                            if (okPrev && okCur) return true;
                        }
                    }
                }

                return false;
            } catch {
                return false;
            }
        })();

        const hasSuspensionOnsetHere = (() => {
            try {
                return (analyzedNotes as any[] || []).some((n: any) =>
                    n &&
                    n.isSuspension &&
                    typeof (n as any).isSuspension?.fromAbsBeat === 'number' &&
                    Math.abs(((n as any).isSuspension.fromAbsBeat as number) - event.absBeat) < 1e-6,
                );
            } catch {
                return false;
            }
        })();

        const previewRoman = (() => {
            try {
                const r = getRomanAnalysis((analysisNotesForNaming || []) as any, contextTonic, contextIsMinor, { minorScaleMode });
                if (r?.roman) return String(r.roman);
                const rFull = getRomanAnalysis((fullNotes || []) as any, contextTonic, contextIsMinor, { minorScaleMode });
                return rFull?.roman ? String(rFull.roman) : '';
            } catch {
                return '';
            }
        })();

        try {
            if (!hasSuspensionOnsetHere && isCompoundMeterFlag) {
                const absBeat = Number(event.absBeat);
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                const strongPulse = isStrongPulseInMeasureFn(inMeasure);

                if (!strongPulse && prevCtx === ctxKey && prevBassPc != null && bassPc != null && prevBassPc === bassPc) {
                    const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman2) {
                        const x = getXForAbsBeat(event.absBeat, system);
                        labelsBySystem[systemIndex].push({
                            id: `hlabel-hidden-compound-${systemIndex}-${event.absBeat}`,
                            x,
                            roman: prevRoman2,
                            figures: lastFiguresBySystem.get(systemIndex) || [],
                            symbol: '',
                            absBeat: event.absBeat,
                            hiddenMarker: true,
                        });
                    }
                    return;
                }
            }
        } catch {
            // ignore
        }

        const hasHiddenChange = !!(fullSigNoOrn && prevSig && fullSigNoOrn !== prevSig);

        // If the "change" is only a reduction of pitch-classes (e.g. a bass note ends and a
        // passing tone enters), do not treat it as a real harmonic change for suppression.
        const isReductionOfPrevSig = (() => {
            try {
                if (!prevSig || !fullSigNoOrn) return false;
                const prevPcs = new Set(prevSig.split('-').filter(Boolean).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)));
                const curPcs = new Set(fullSigNoOrn.split('-').filter(Boolean).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)));
                if (!prevPcs.size || !curPcs.size) return false;
                if (curPcs.size > prevPcs.size) return false;
                for (const pc of curPcs) if (!prevPcs.has(pc)) return false;
                return true;
            } catch {
                return false;
            }
        })();

        // Strong rule (UI/pedagogy): ornamental onsets must NOT create new harmony labels.
        // On weak beats, if anything is marked as passing/neighbor/appoggiatura/etc., keep the
        // previous label (optionally add a hidden marker so hold-lines still behave).
        // This avoids "harmonizing" an ornament with a spurious label like I4.
        try {
            const absBeat = Number(event.absBeat);
            const q = qAbs(absBeat);
            const hasAnyOverrideHere = overrideByAbsBeat.has(q) || engineOverrideByAbsBeat.has(q) || protectedAbsBeats.has(q);

            if (hasOrnamentOnsetAtThisBeat && !hasSuspensionOnsetHere && !hasAnyOverrideHere) {
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                const isStrongHere = isStrongPulseInMeasureFn(inMeasure);
                if (!isStrongHere) {
                    const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman2) {
                        const x = getXForAbsBeat(event.absBeat, system);
                        labelsBySystem[systemIndex].push({
                            id: `hlabel-hidden-orn-${systemIndex}-${event.absBeat}`,
                            x,
                            roman: prevRoman2,
                            figures: lastFiguresBySystem.get(systemIndex) || [],
                            symbol: '',
                            absBeat: event.absBeat,
                            hiddenMarker: true,
                        });
                    }
                    return;
                }
            }
        } catch {
            // ignore
        }

        // Detect "double passing" (two voices moving by short stepwise motion through the beat)
        // and suppress label creation even on strong beats.
        try {
            const absBeat = Number(event.absBeat);
            const q = qAbs(absBeat);
            const hasAnyOverrideHere = overrideByAbsBeat.has(q) || engineOverrideByAbsBeat.has(q) || protectedAbsBeats.has(q);
            if (!hasSuspensionOnsetHere && !hasAnyOverrideHere) {
                const fullIndex = indexByAbsBeat.get(absBeat);
                const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                const prevEv: any = (fullIndex != null && fullIndex > 0) ? (timeline as any[])[fullIndex - 1] : null;
                const prevIds = new Set<string>(((prevEv?.notes || []) as any[]).map((n: any) => String(n?.id ?? '')).filter(Boolean));
                const onsetNotes = ((curEv?.notes || []) as any[]).filter((n: any) => n && !n.isRest && !prevIds.has(String(n.id ?? '')));

                // Micro-onset suppression: in simple meters, do not create new harmony labels on
                // non-beat-boundary 16ths (or shorter). These are almost always ornamental voice-leading
                // under a held harmony, and labeling them creates noisy "harmonization".
                const isBeatBoundary = (() => {
                    try {
                        const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                        const EPS = 1e-3;
                        if (isCompoundMeterFlag) return isStrongPulseInMeasureFn(inMeasure);
                        return Math.abs(inMeasure - Math.round(inMeasure)) < EPS;
                    } catch {
                        return false;
                    }
                })();

                const hasSixteenthOnset = onsetNotes.some((n: any) => {
                    const d = durBeats(n);
                    return Number.isFinite(d) && d > 0 && d <= 0.26 + 1e-6;
                });

                if (!isBeatBoundary && hasSixteenthOnset) {
                    const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman2) {
                        const x = getXForAbsBeat(event.absBeat, system);
                        labelsBySystem[systemIndex].push({
                            id: `hlabel-hidden-micro-${systemIndex}-${event.absBeat}`,
                            x,
                            roman: prevRoman2,
                            figures: lastFiguresBySystem.get(systemIndex) || [],
                            symbol: '',
                            absBeat: event.absBeat,
                            hiddenMarker: true,
                        });
                    }
                    return;
                }

                // Identify the *structural* chord at this event (ignore ornaments).
                // If we can't identify a confident chord, do NOT suppress (stay conservative).
                const chordInfo = (() => {
                    try {
                        const support = ((curEv?.notes || []) as any[]).filter((x: any) => {
                            if (!x || x.isRest) return false;
                            if (x.isPassing || x.isEscape || x.isNeighbor || x.isAnticipation || x.isAppoggiatura) return false;
                            return true;
                        });
                        if (support.length < 3) return null;
                        const cands = identifyChordCandidates(support as any);
                        const best: any = (cands && cands.length) ? cands[0] : null;
                        const mt = String(best?.matchType || '');
                        const confident = mt === 'exact' || mt === 'no_fifth' || mt === 'no_third';
                        if (!confident || !best?.root || !best?.type) return null;

                        const rootPc = Number.isFinite((best.root as any).noteIndex)
                            ? (((best.root as any).noteIndex % 12) + 12) % 12
                            : (Number.isFinite((best.root as any).midi) ? (((best.root as any).midi % 12) + 12) % 12 : null);
                        const formula = (CHORD_FORMULAS as any)?.[best.type] as number[] | undefined;
                        if (rootPc == null || !Array.isArray(formula) || !formula.length) return null;
                        return { rootPc, formula };
                    } catch {
                        return null;
                    }
                })();

                const isChordToneHere = (n: any): boolean => {
                    try {
                        if (!chordInfo || !n || n.isRest) return true;
                        const notePc = Number.isFinite(n?.midi)
                            ? (((n.midi % 12) + 12) % 12)
                            : (typeof n.noteIndex === 'number' ? (((n.noteIndex % 12) + 12) % 12) : null);
                        if (notePc == null) return true;
                        const rel = (((notePc - chordInfo.rootPc) % 12) + 12) % 12;
                        return rel === 0 || chordInfo.formula.includes(rel);
                    } catch {
                        return true;
                    }
                };

                let passingLikeCount = 0;
                for (const n of onsetNotes) {
                    const v = Number(n.voice ?? 1);
                    if (!Number.isFinite(v)) continue;
                    if (v === 4) continue; // focus on upper voices for this heuristic
                    const d = durBeats(n);
                    if (!(d > 0 && d <= 0.51 + 1e-6)) continue;

                    // Never treat an onset chord tone as "passing-like" for suppression.
                    // Otherwise real harmony on strong beats (often with short values) disappears.
                    if (isChordToneHere(n)) continue;

                    const prev = findPrevNoteForVoice(fullIndex ?? 0, v, String(n.id ?? ''), 2.01);
                    const next = findNextOnsetForVoice(fullIndex ?? 0, v, 2.01);
                    if (!prev?.note || !next?.note) continue;
                    if (!Number.isFinite(prev.note.midi) || !Number.isFinite(n.midi) || !Number.isFinite(next.note.midi)) continue;

                    const s1 = Math.abs((n.midi ?? 0) - (prev.note.midi ?? 0));
                    const s2 = Math.abs((next.note.midi ?? 0) - (n.midi ?? 0));
                    const dir1 = Math.sign((n.midi ?? 0) - (prev.note.midi ?? 0));
                    const dir2 = Math.sign((next.note.midi ?? 0) - (n.midi ?? 0));
                    const stepwise = (s1 > 0 && s1 <= 2 && s2 > 0 && s2 <= 2 && dir1 !== 0 && dir1 === dir2);
                    if (!stepwise) continue;

                    passingLikeCount++;
                }

                if (passingLikeCount >= 2) {
                    const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman2) {
                        const x = getXForAbsBeat(event.absBeat, system);
                        labelsBySystem[systemIndex].push({
                            id: `hlabel-hidden-doublepass-${systemIndex}-${event.absBeat}`,
                            x,
                            roman: prevRoman2,
                            figures: lastFiguresBySystem.get(systemIndex) || [],
                            symbol: '',
                            absBeat: event.absBeat,
                            hiddenMarker: true,
                        });
                    }
                    return;
                }
            }
        } catch {
            // ignore
        }

        if (!hasSuspensionOnsetHere && !hasHiddenChange && ((prevSig === harmonicSig && prevCtx === ctxKey) || shouldSuppressAsCompletion)) {
            const prevRoman = lastRomanBySystem.get(systemIndex) || '';
            if (previewRoman && prevRoman && previewRoman !== prevRoman) {
                // do not suppress
            } else {
                if (hasOrnamentOnsetAtThisBeat || shouldSuppressAsCompletion) {
                    const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman2) {
                        const x = getXForAbsBeat(event.absBeat, system);
                        labelsBySystem[systemIndex].push({
                            id: `hlabel-hidden-${systemIndex}-${event.absBeat}`,
                            x,
                            roman: prevRoman2,
                            figures: lastFiguresBySystem.get(systemIndex) || [],
                            symbol: '',
                            absBeat: event.absBeat,
                            hiddenMarker: true,
                        });
                    }
                }
                return;
            }
        }

        lastSigBySystem.set(systemIndex, harmonicSig);
        lastCtxBySystem.set(systemIndex, ctxKey);
        lastBassPcBySystem.set(systemIndex, bassPc);

        // L2 figured bass must reflect the actual vertical intervals above the bass.
        // IMPORTANT: keep suspensions here (e.g. 6/4 or 4-3 at onset), but drop surface ornaments.
        // Using analysisNotes can exclude suspension tones at their onset and collapse 6/4 -> 6.
        const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
        const normalizeForLabels = (arr: any[]): any[] => {
            try {
                return (arr || []).map(n => normalizeNotePitchFieldsWithKey(n, contextKeySignature));
            } catch {
                return (arr || []).slice();
            }
        };

        const notesForRoman = normalizeForLabels((labelNotesOverride || analysisNotesForNaming) as any);
        const notesForSymbol = normalizeForLabels((labelNotesOverride || fullNotes) as any);
        // If we intentionally label the *resolved* harmony (appoggiatura/retardation heuristic),
        // also compute figures from the resolved snapshot to avoid cluttering the UI with
        // ornamental verticalities (e.g. 9-8 / 4-3 shown as a separate "chord").
        const notesForFiguresSrc = normalizeForLabels(((labelNotesOverride || fullNotes) || []) as any);

        const chordForFigures = (notesForFiguresSrc || []).filter((n: any) => {
            if (!n || n.isRest) return false;
            const anyN = n as any;
            return !(
                anyN.isPassing ||
                anyN.isNeighbor ||
                anyN.isAnticipation ||
                anyN.isAppoggiatura ||
                anyN.isEscape
            );
        });
        let figures: string[] = computeFiguredBassFromNotes(chordForFigures as any, FIGURED_BASS_UI_OPTIONS).figures;
        if (!figures?.length) {
            figures = computeFiguredBassFromNotes(analysisNotes as any, FIGURED_BASS_UI_OPTIONS).figures;
        }

        let roman = '';
        let symbol = '';
        let isAug6Roman = false;
        let romanDisplay: string | undefined = undefined;

        const prevRoman = lastRomanBySystem.get(systemIndex) || '';
        const prevRootPc = lastChordRootPcBySystem.get(systemIndex);
        const prevType = lastChordTypeBySystem.get(systemIndex);

        try {
            const r = getRomanAnalysis(notesForRoman as any, contextTonic, contextIsMinor, { minorScaleMode });
            if (r) {
                roman = r.roman;
                isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
            }

            try {
                const rr0 = String(roman || '');
                const pcCount = (arr: any[]): number => {
                    try {
                        const set = new Set<number>();
                        for (const n of (arr || [])) {
                            if (!n || n.isRest) continue;
                            const ni = Number(n.noteIndex);
                            const mi = Number(n.midi);
                            const pc = Number.isFinite(ni) ? ((ni % 12) + 12) % 12 : Number.isFinite(mi) ? ((mi % 12) + 12) % 12 : null;
                            if (pc == null) continue;
                            set.add(pc);
                        }
                        return set.size;
                    } catch {
                        return 0;
                    }
                };
                const pcsNaming = pcCount(notesForRoman as any);
                const pcsAnalysis = pcCount(analysisNotes as any);
                const pcsFull = pcCount((notesForSymbol || []) as any);

                const hasMoreInfoInFull = pcsFull > pcsNaming && pcsFull >= 4;
                if (rr0.startsWith('vii') && ((pcsNaming > 0 && pcsNaming < 3 && (pcsAnalysis >= 3 || pcsFull >= 3)) || hasMoreInfoInFull)) {
                    const alt1 = getRomanAnalysis(analysisNotes as any, contextTonic, contextIsMinor, { minorScaleMode });
                    const alt2 = getRomanAnalysis((notesForSymbol || []) as any, contextTonic, contextIsMinor, { minorScaleMode });
                    const isPlausible = (s: string) => {
                        const t = String(s || '').trim();
                        return t === 'V' || t === 'I' || t === 'v' || t === 'i' || t.startsWith('V/') || t.startsWith('I/') || t.startsWith('v/') || t.startsWith('i/');
                    };
                    const pick = [alt1, alt2].find(x => x?.roman && isPlausible(String(x.roman)));
                    if (pick?.roman) {
                        roman = String(pick.roman);
                        isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                    }
                }
            } catch {
                // ignore
            }

            try {
                const rrHere = String(roman || '').trim();
                if (rrHere === 'III' || rrHere === 'iii') {
                    const g = getRomanAnalysis(notesForRoman as any, currentTonic, isMinorMode, { minorScaleMode });
                    const gRoman = String(g?.roman || '').trim();
                    const isGlobalDominant = gRoman === 'V' || gRoman === 'v' || gRoman.startsWith('V/') || gRoman.startsWith('v/');
                    if (isGlobalDominant) {
                        const maxAhead = (beatsPerMeasure * 2) + 1e-6;
                        let resolvesToGlobalI = false;
                        for (let t = eventIndex + 1; t < timelineForLabels.length; t++) {
                            const ev2: any = timelineForLabels[t];
                            if (!ev2) continue;
                            const dt = Number(ev2.absBeat) - Number(event.absBeat);
                            if (!Number.isFinite(dt) || dt < -1e-6) continue;
                            if (dt > maxAhead) break;
                            const r2 = getRomanAnalysis((ev2?.notes || []) as any, currentTonic, isMinorMode, { minorScaleMode });
                            const rr2 = String(r2?.roman || '').trim();
                            if (rr2 === (isMinorMode ? 'i' : 'I')) {
                                resolvesToGlobalI = true;
                                break;
                            }
                        }
                        if (resolvesToGlobalI) {
                            roman = gRoman;
                            isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                        }
                    }
                }
            } catch {
                // ignore
            }

            try {
                if (!roman) {
                    const candidates = identifyChordCandidates(notesForRoman as any);
                    let bestSecondary: { roman: string; score: number } | null = null;
                    for (const c of (candidates as any[]) || []) {
                        const rr = calculateRomanFromChordInfo({ root: c.root, type: c.type, intervals: c.intervals }, contextTonic, contextIsMinor);
                        if (!rr || !String(rr).startsWith('V/')) continue;
                        const score = Number.isFinite((c as any).score) ? Number((c as any).score) : 0;
                        if (!bestSecondary || score > bestSecondary.score) bestSecondary = { roman: rr, score };
                    }
                    if (bestSecondary) roman = bestSecondary.roman;
                }
            } catch {
                // ignore
            }

            const s = getChordSymbol((notesForSymbol || []) as any, contextKeySignature, contextTonic);
            if (s) symbol = s;

            try {
                const rrHere = String(roman || '').trim();
                if (!roman && symbol && contextIsMinor) {
                    const sym = String(symbol || '').replace('♯', '#').replace('♭', 'b');
                    if (/m\(maj7\)|mmaj7|minmaj7/i.test(sym)) {
                        const rootMatch = sym.match(/^([A-G])([#b]?)/);
                        const rootName = rootMatch ? `${rootMatch[1]}${rootMatch[2] || ''}` : '';
                        const rootPc = rootName ? noteNameToChromaticIndex(rootName) : null;
                        const tonicPc = contextTonic ? noteNameToChromaticIndex(contextTonic) : null;
                        if (rootPc != null && tonicPc != null && rootPc === tonicPc) {
                            roman = 'I7';
                        }
                    }
                }

                // keep rescue block structure for future parity; currently no-op
                void rrHere;
            } catch {
                // ignore
            }

            // dyad ambiguity
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                const pcs = pcSetFromNotes(analysisNotes as any);
                if (!isSecondaryOrSlashRoman && bassPc != null && pcs.size <= 2) {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        roman = inferred.roman;
                    }
                }
            } catch {
                // ignore
            }

            // shell continuation
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                const pcs = pcSetFromNotes(analysisNotes as any);
                if (!isSecondaryOrSlashRoman && prevRoman && bassPc != null && pcs.size > 0 && pcs.size <= 2) {
                    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                    if (prevTriad) {
                        const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                        }
                    }
                }
            } catch {
                // ignore
            }

            // rootless inference
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                if (!isSecondaryOrSlashRoman && bassPc != null && !roman) {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        const pcs = pcSetFromNotes(analysisNotes as any);
                        const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
                        const pcsSubset = isSubset(pcs, triadSet);
                        if (pcsSubset && pcs.size > 0 && pcs.size <= 3) {
                            roman = inferred.roman;
                        }
                    }
                }
            } catch {
                // ignore
            }

            // inversion inference
            try {
                const pcs = pcSetFromNotes(analysisNotes as any);
                if (prevRoman && prevRootPc != null && prevType && bassPc != null && roman && roman !== prevRoman && !String(roman).includes('/')) {
                    const triad = triadPcsFromRootAndType(prevRootPc, prevType);
                    if (triad) {
                        const triadSet = new Set<number>([triad.root, triad.third, triad.fifth]);
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                        }
                    }
                }

                if (prevRoman && bassPc != null && roman && roman !== prevRoman && !String(roman).includes('/')) {
                    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                    if (prevTriad) {
                        const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                        }
                    }
                }
            } catch {
                // ignore
            }

        } catch {
            // ignore
        }

        // Capture chord root/type for next event
        try {
            const candidates = identifyChordCandidates(analysisNotesForNaming || []);
            if (candidates && candidates.length) {
                const chosen = candidates[0];
                const rootPc = (chosen?.root?.noteIndex ?? null);
                if (rootPc != null && Number.isFinite(rootPc)) lastChordRootPcBySystem.set(systemIndex, (((rootPc % 12) + 12) % 12));
                if (chosen?.type) lastChordTypeBySystem.set(systemIndex, String(chosen.type));
            }
        } catch {
            // ignore
        }

        if (roman) {
            lastRomanBySystem.set(systemIndex, roman);
            lastFiguresBySystem.set(systemIndex, (figures || []).slice());
        }

        // suspension-aware rendering adjustments (kept for parity)
        try {
            const CLASSIC_TYPES = new Set(['4-3', '6-5', '7-6', '7-8', '8-7', '9-8', '2-3']);

            const isSuspensionOnsetHere2 = (analyzedNotes as any[] || []).some((n: any) => {
                const s = n?.isSuspension;
                if (!s || typeof s.fromAbsBeat !== 'number') return false;
                return Math.abs(s.fromAbsBeat - event.absBeat) < 1e-6;
            });
            const resolvingSuspensions = (analyzedNotes || [])
                .map(n => (n as any)?.isSuspension)
                .filter((s: any) => s && typeof s.resolvedById === 'string' && s.resolvedById)
                .filter((s: any) => !!(event.notes && event.notes.find((nn: any) => nn.id === s.resolvedById)));

            if (resolvingSuspensions.length) {
                const hasClassic = resolvingSuspensions.some((s: any) => CLASSIC_TYPES.has(String(s.type)));
                const hasNonClassic = resolvingSuspensions.some((s: any) => !CLASSIC_TYPES.has(String(s.type)));
                if (!isSuspensionOnsetHere2 && hasClassic && !hasNonClassic) {
                    const prevRomanForCompare = prevRoman || '';
                    const isMinorMajor7 = (() => {
                        const sym = String(symbol || '').replace('♯', '#').replace('♭', 'b');
                        return /m\(maj7\)|mmaj7|minmaj7/i.test(sym);
                    })();
                    if ((!roman || roman === prevRomanForCompare) && !isMinorMajor7) {
                        roman = '';
                        figures = [];
                        symbol = '';
                    }
                }
            }
        } catch {
            // ignore
        }

        // Auto overrides (engine + lookahead), then user overrides
        let isAutoOverrideHere = false;
        try {
            const a = qAbs(event.absBeat);

            const shouldApplyRomanOverride = (nextRoman: any): boolean => {
                try {
                    const next = String(nextRoman ?? '').trim();
                    if (!next) return true;
                    const cur = String(roman ?? '').trim();
                    if (!cur) return true;

                    const nextIsSecondary = next.includes('/') && !next.includes('=');
                    const curIsSecondary = cur.includes('/');

                    // If we already have a non-secondary roman (e.g. vii°) from the current verticality,
                    // do not let a lookahead/auto override replace it with a secondary label (e.g. V/vi).
                    if (nextIsSecondary && !curIsSecondary) return false;
                    return true;
                } catch {
                    return true;
                }
            };

            if (!overrideByAbsBeat.has(a)) {
                const eng = getNear(engineOverrideByAbsBeat, a);
                if (eng) {
                    if (eng.roman !== undefined && shouldApplyRomanOverride(eng.roman)) roman = eng.roman;
                    if (eng.symbol !== undefined) symbol = eng.symbol;
                    if (eng.figures !== undefined) figures = eng.figures;
                    if (eng.romanDisplay !== undefined) romanDisplay = eng.romanDisplay;
                    isAutoOverrideHere = true;
                }

                const auto = getNear(autoOverrideByAbsBeat, a);
                if (auto) {
                    if (auto.roman !== undefined && shouldApplyRomanOverride(auto.roman)) roman = auto.roman;
                    if (auto.symbol !== undefined) symbol = auto.symbol;
                    if (auto.figures !== undefined) figures = auto.figures;
                    isAutoOverrideHere = true;
                }
            }
        } catch {
            // ignore
        }

        try {
            const ov = overrideByAbsBeat.get(qAbs(event.absBeat));
            if (ov) {
                if (ov.roman !== undefined) roman = ov.roman;
                if (ov.romanDisplay !== undefined) romanDisplay = ov.romanDisplay;
                if (ov.symbol !== undefined) symbol = ov.symbol;
                if (ov.figures !== undefined) figures = ov.figures;
            }
        } catch {
            // ignore
        }

        // Display-only lookahead pivots
        try {
            const a = qAbs(event.absBeat);
            if (!overrideByAbsBeat.has(a) && !romanDisplay) {
                const autoDisp = getNear(autoRomanDisplayByAbsBeat, a);
                if (autoDisp) {
                    const s = String(autoDisp || '');
                    if (s.includes('/') && !s.includes('=')) {
                        const cur = String(roman ?? '').trim();
                        const curIsSecondary = cur.includes('/');
                        if (!cur || curIsSecondary) {
                            roman = s;
                            romanDisplay = undefined;
                        }
                    } else {
                        romanDisplay = s;
                    }
                }
            }
        } catch {
            // ignore
        }

        try {
            if (isAutoOverrideHere && roman && !romanDisplay) {
                romanDisplay = String(roman);
            }
        } catch {
            // ignore
        }

        if (!roman && !symbol && !(figures && figures.length)) return;

        const x = getXForAbsBeat(event.absBeat, system);
        labelsBySystem[systemIndex].push({
            id: `hlabel-${systemIndex}-${event.absBeat}`,
            x,
            roman,
            romanDisplay,
            figures,
            symbol,
            absBeat: event.absBeat,
            isOverride: overrideByAbsBeat.has(qAbs(event.absBeat)) || isAutoOverrideHere,
            pcsSig: signatureFromNotes((fullNotes || []) as any),
        });

        void fallbackHarmonicNotes;
        void harmonicNotes;
        void protectedAbsBeats;
        void isAug6Roman;
    });

    labelsBySystem.forEach(systemLabels => systemLabels.sort((a, b) => a.x - b.x));
    return labelsBySystem;
}
