/**
 * useHarmonyLabels — extracted from GrandStaffEditor.tsx (Phase 2)
 *
 * Computes all harmony analysis overlay data per system:
 * roman numerals, figured bass, chord symbols, progression markers,
 * sequence markers, modulation markers, and time-signature markers.
 */
import { useMemo } from 'react';
import type { StaffNote, TimeSignature, AnalysisContext, HarmonyLabelOverride, TimeSignatureChange } from '../types';
import { getActiveNotesTimeline, identifyChordCandidates, calculateRomanFromChordInfo, getRomanAnalysis, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS, getKeySignature, getChordSymbol } from '../utils/musicTheory';
import { structuralNotes } from '../utils/harmonyLabelPipeline';
import { usePreference } from '../preferences/usePreference';
import { evaluateCadentialPatterns, type ChordEvent, pcToNoteName, noteNameToPc, qualityFamily, getScalePcs } from '../utils/cadentialPatterns';
import { CADENTIAL_PATTERN_RECOGNITION_KEY } from '../storage/storageKeys';
import { detectVoiceLeadingSequences } from '../utils/sequenceDetector';
import { getBigramProbability, type StyleProfile } from '../engine/choralStyleProfile';
import { TICKS_PER_QUARTER, CHORD_FORMULAS, NOTE_NAMES, ALL_NOTE_SPELLINGS, DURATION_VALUES } from '../constants';
import { suggestNextChord } from '../engine/progressionSuggester';

// ─── Utility: note name → chromatic index (0-11) ──────────────────────────
function noteNameToChromaticIndex(name: string): number {
    const idxSharp = NOTE_NAMES.indexOf(name);
    if (idxSharp >= 0) return idxSharp;
    const normalized = name.replace('♯', '#').replace('♭', 'b');
    for (let i = 0; i < ALL_NOTE_SPELLINGS.length; i++) {
        if (ALL_NOTE_SPELLINGS[i].includes(normalized)) return i;
    }
    return -1;
}

// Layout constants (must match GrandStaffEditor.tsx)
const START_X = 50;
const MEASURE_PADDING_X = 20;
const TOP_STAFF_TOP = 30;
const VF_SATB_SOPRANO_Y = 40;
const STAFF_MARGIN = 50;

export interface UseHarmonyLabelsParams {
    layoutData: any;
    timeSignature: TimeSignature;
    timeSignatureChanges: TimeSignatureChange[];
    analysisContexts: AnalysisContext[];
    harmonyOverrides: any[];
    currentTonic: string;
    isMinorMode: boolean;
    isAnalysisEnabled: boolean;
    isSequencesEnabled: boolean;
    staffSystemMode: string;
    notes: StaffNote[];
    analyzedNotes: StaffNote[];
    analysisContextAbsBeat: (ctx: AnalysisContext) => number;
    timeSignatureChangeAbsBeat: (tc: TimeSignatureChange) => number;
    harmonyLabelMinSpanBeats?: number;
    useStatisticalCorrection?: boolean;
    statisticalBiasThreshold?: number;
    styleProfile?: StyleProfile | null;
    ornamentOverrides?: Array<{ noteId: string; type: string }>;
}

export function useHarmonyLabels(params: UseHarmonyLabelsParams) {
    const {
        layoutData, timeSignature, timeSignatureChanges,
        analysisContexts, harmonyOverrides,
        currentTonic, isMinorMode, isAnalysisEnabled, isSequencesEnabled,
        staffSystemMode, notes, analyzedNotes,
        analysisContextAbsBeat, timeSignatureChangeAbsBeat,
        harmonyLabelMinSpanBeats,
        useStatisticalCorrection,
        statisticalBiasThreshold,
        styleProfile,
        ornamentOverrides,
    } = params;

    const [compactTonicization] = usePreference<boolean>('analysis.tonicizationCompact');

    const minSpanBeats = Number(harmonyLabelMinSpanBeats) || 0;

    // Build a Map<key, ornamentType> for direct lookup in structuralNotes().
    // Keys include BOTH noteId AND composite midi-measure-beat for cross-graph matching.
    const ornOverrideMap = useMemo(() => {
        const m = new Map<string, string>();
        const noteById = new Map<string, any>();
        for (const n of (analyzedNotes || []) as any[]) {
            if (n?.id) noteById.set(n.id, n);
        }
        for (const o of ornamentOverrides || []) {
            if (!o?.noteId || !o?.type) continue;
            m.set(o.noteId, o.type);
            // Add composite key from the source note (if still in analyzedNotes)
            const src = noteById.get(o.noteId);
            if (src) {
                const midi = Number(src.midi);
                if (Number.isFinite(midi)) {
                    m.set(`${midi}-${src.measureIndex ?? -1}-${src.beat ?? -1}`, o.type);
                }
            }
            // Add composite key from stored fields (for orphaned IDs)
            if ((o as any).midi != null && (o as any).measureIndex != null && (o as any).beat != null) {
                m.set(`${(o as any).midi}-${(o as any).measureIndex}-${(o as any).beat}`, o.type);
            }
        }
        // Also include IDs from analyzedNotes that carry ornamentOverride
        // (set by applyHarmonyRules early/late tag, which uses its own matching).
        // This ensures the map works even when stored composite keys are stale.
        for (const n of (analyzedNotes || []) as any[]) {
            if (!n?.id || !n?.ornamentOverride) continue;
            if (n.ornamentOverride === 'structural') continue;
            if (m.has(n.id)) continue;
            m.set(n.id, n.ornamentOverride);
            const midi = Number(n.midi);
            if (Number.isFinite(midi)) {
                m.set(`${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`, n.ornamentOverride);
            }
        }
        return m;
    }, [ornamentOverrides, analyzedNotes]);

    // Convert to Record keyed by BOTH noteId AND composite midi-measure-beat
    // (timeline notes have different IDs from the source notes in ornamentOverrides)
    const ornOverrideRecord = useMemo((): Record<string, string> => {
        const rec: Record<string, string> = {};
        for (const [k, v] of ornOverrideMap.entries()) rec[k] = v;
        return rec;
    }, [ornOverrideMap]);

    const harmonyLabelsBySystem = useMemo(() => {
        if (!isAnalysisEnabled || !layoutData) return [];

        // ── Propagate ornament flags from analyzedNotes → positionedNotes ──
        // layoutData.positionedNotes come from layout computation and may NOT carry
        // ornament flags (isPassing, ornamentOverride, etc.) that reside on analyzedNotes.
        // Copy them by matching note IDs so structuralNotes() can filter correctly.
        try {
            if (analyzedNotes?.length && layoutData.positionedNotes?.length) {
                const flagMap = new Map<string, any>();
                for (const n of analyzedNotes as any[]) {
                    if (!n?.id) continue;
                    flagMap.set(n.id, n);
                }
                for (const pn of layoutData.positionedNotes as any[]) {
                    const src = flagMap.get(pn?.id);
                    if (!src) continue;
                    if (src.isPassing) pn.isPassing = true;
                    if (src.isNeighbor) pn.isNeighbor = true;
                    if (src.isAppoggiatura) pn.isAppoggiatura = true;
                    if (src.isAnticipation) pn.isAnticipation = true;
                    if (src.isEscape) pn.isEscape = true;
                    if (src.ornamentOverride) pn.ornamentOverride = src.ornamentOverride;
                    if (src.ornamentMark) pn.ornamentMark = src.ornamentMark;
                    if (src.isSuspension) pn.isSuspension = src.isSuspension;
                }
            }
        } catch { /* ignore */ }

        // Use the timeline of all active notes at each event (start/end of any note)
        const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges);

        // Labels should follow *structural onsets* rather than every scanpoint.
        // Note-off-only scanpoints can temporarily reduce the verticality (e.g. 2 notes)
        // and cause spurious chord identification (like #IV° ...) even when the harmony
        // is conceptually being held.
        const isCompoundMeter = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
        const isStrongPulseInMeasure = (inMeasureBeats0: number) => {
            try {
                if (!Number.isFinite(inMeasureBeats0)) return false;
                const EPS = 1e-3;
                if (isCompoundMeter) {
                    // dotted-quarter pulse: 3 eighths = 1.5 beats (quarter units)
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
        };

        const timelineForLabels = (timeline || []).filter((ev: any, idx: number) => {
            if (!ev) return false;
            if (idx === 0) return true;

            const prev = timeline[idx - 1] as any;
            const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
            const curNotes = (ev?.notes || []) as any[];

            // 1) Keep onset events (at least one new active note).
            const hasOnset = curNotes.some(n => {
                const id = String(n?.id ?? '');
                return id && !prevIds.has(id);
            });
            if (hasOnset) return true;

            // 2) Also keep note-off-only events on strong beats / barlines.
            // Otherwise, a harmony change caused by a release at the barline
            // gets shifted to the next onset (user reported beat-1 label moving to beat-2).
            try {
                const curIds = new Set<string>(curNotes.map(n => String(n?.id ?? '')).filter(Boolean));
                const removed = Array.from(prevIds).some(id => id && !curIds.has(id));
                if (!removed) return false;

                const absBeat = Number(ev?.absBeat);
                if (!Number.isFinite(absBeat)) return false;
                const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                return isStrongPulseInMeasure(inMeasure);
            } catch {
                return false;
            }
        });

        // Anti-noise filter (greedy forward): keep first event, then keep the
        // next only when its distance from the last *kept* event ≥ minSpan.
        // This preserves structural beats and absorbs ornamental short events.
        const timelineFiltered: any[] = (() => {
            if (minSpanBeats <= 1e-6) return [...timelineForLabels];
            const result: any[] = [];
            let lastKeptBeat = -Infinity;
            for (const ev of timelineForLabels) {
                const a = Number(ev?.absBeat);
                if (!Number.isFinite(a)) { result.push(ev); continue; }
                if (a - lastKeptBeat + 1e-6 >= minSpanBeats) {
                    result.push(ev);
                    lastKeptBeat = a;
                }
            }
            return result;
        })();

        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        // ─── Cadential Pattern Recognition (Fase 1) ───
        let _effectiveCtxs: AnalysisContext[] = [...(analysisContexts || [])];
        const _pivotCandidates = new Map<number, {tonic: string, isMinor: boolean}>();
        try {
            const _cadEnabled = typeof localStorage !== 'undefined'
                && localStorage.getItem(CADENTIAL_PATTERN_RECOGNITION_KEY) !== '0';
            if (_cadEnabled && timelineForLabels.length >= 2) {
                const _chEvts: ChordEvent[] = [];
                for (const ev of timelineForLabels) {
                    if (!ev?.notes?.length) continue;
                    try {
                        const cands = identifyChordCandidates(ev.notes);
                        const top = cands?.[0];
                        if (!top?.root) continue;
                        // root can be string or object {noteIndex, midi}
                        const rootPc = typeof top.root === 'string'
                            ? noteNameToPc(top.root)
                            : (((Number((top.root as any)?.noteIndex ?? (top.root as any)?.midi ?? 0)) % 12) + 12) % 12;
                        const bassMidi = Math.min(...(ev.notes as any[]).map((n: any) => Number(n.midi)));
                        const bassPc = ((bassMidi % 12) + 12) % 12;
                        _chEvts.push({ rootPc, quality: top.type || '', bassPc, absBeat: ev.absBeat,
                            notePcs: [...new Set((ev.notes as any[]).map((n: any) => ((Number(n.midi) % 12) + 12) % 12))] });
                    } catch { /* skip event */ }
                }
                const _cadMatches = evaluateCadentialPatterns(
                    _chEvts, noteNameToPc(currentTonic), isMinorMode, { minConfidence: 70 },
                );
                const _manualBeats = new Set(
                    (analysisContexts || []).filter((c: any) => c.source !== 'inferred')
                        .map((c: AnalysisContext) => analysisContextAbsBeat(c)),
                );
                for (const m of _cadMatches) {
                    if (!_manualBeats.has(m.startBeat)) {
                        // Deceptive cadences confirm the *matched* key
                        // (e.g. Am when the home key is C). Inject the
                        // matched tonic at the cadence span, then return to
                        // the home key after the resolution.
                        if (m.deceptive) {
                            const _decTonic = pcToNoteName(m.targetTonicPc);
                            const _decMinor = m.targetIsMinor;
                            _effectiveCtxs.push({
                                absBeat: m.startBeat,
                                newTonic: _decTonic,
                                newIsMinor: _decMinor,
                                score: 100,
                                source: 'inferred',
                            });
                            // Return to home key after the deceptive resolution
                            const nextAfterDec = _chEvts.find(
                                ev => ev.absBeat > m.endBeat + 1e-6,
                            );
                            if (nextAfterDec) {
                                // Pivot detection on chord after resolution
                                const _decScale = new Set(
                                    getScalePcs(m.targetTonicPc, _decMinor),
                                );
                                if (nextAfterDec.notePcs?.every(pc => _decScale.has(pc))) {
                                    _pivotCandidates.set(nextAfterDec.absBeat,
                                        { tonic: _decTonic, isMinor: _decMinor });
                                }
                                if (!_manualBeats.has(nextAfterDec.absBeat)) {
                                    _effectiveCtxs.push({
                                        absBeat: nextAfterDec.absBeat,
                                        newTonic: currentTonic,
                                        newIsMinor: isMinorMode,
                                        score: 0,
                                        source: 'inferred',
                                    });
                                }
                            }
                            continue;
                        }
                        // ── Tonicisation START: switch to target key ──
                        _effectiveCtxs.push({
                            absBeat: m.startBeat,
                            newTonic: pcToNoteName(m.targetTonicPc),
                            newIsMinor: m.targetIsMinor,
                            score: m.confidence,
                            source: 'inferred',
                        });
                        // ── Tonicisation END: return to home key ──
                        // The resolution chord (at m.endBeat) must stay entirely
                        // in the target key.  Return only at the NEXT timeline
                        // event after the resolution onset.
                        const nextEvAfterRes = _chEvts.find(
                            ev => ev.absBeat > m.endBeat + 1e-6,
                        );
                        if (nextEvAfterRes) {
                            // ── Pivot detection: if the chord right after
                            // the resolution is diatonic to the target key,
                            // record it as a pivot candidate (VI=III style).
                            const _tgtScale = new Set(getScalePcs(m.targetTonicPc, m.targetIsMinor));
                            const nextIsDiatonic = nextEvAfterRes.notePcs?.every(pc => _tgtScale.has(pc));
                            if (nextIsDiatonic) {
                                _pivotCandidates.set(nextEvAfterRes.absBeat,
                                    { tonic: pcToNoteName(m.targetTonicPc), isMinor: m.targetIsMinor });
                            }
                            const returnBeat = nextEvAfterRes.absBeat;
                            const coveredByNext = _cadMatches.some(
                                other => other !== m
                                    && other.startBeat <= returnBeat + 1e-6
                                    && other.endBeat >= returnBeat - 1e-6,
                            );
                            if (!coveredByNext && !_manualBeats.has(returnBeat)) {
                                _effectiveCtxs.push({
                                    absBeat: returnBeat,
                                    newTonic: currentTonic,
                                    newIsMinor: isMinorMode,
                                    score: 0,
                                    source: 'inferred',
                                });
                            }
                        }
                    }
                }

                // ─── Dominant Resolution Extension ───
                // When a chord acts as V of a new key (with chromatic notes
                // outside the home scale) and the next chord resolves as I/i,
                // extend the tonicised context so the resolution stays in the
                // target key rather than snapping back to the home key.
                const _homeScalePcs = new Set(getScalePcs(noteNameToPc(currentTonic), isMinorMode));
                for (let ci = 0; ci < _chEvts.length - 1; ci++) {
                    const dom = _chEvts[ci], res = _chEvts[ci + 1];
                    // V→I/i: dominant root is 7 semitones above resolution root
                    if (((dom.rootPc - res.rootPc + 12) % 12) !== 7) continue;
                    if (qualityFamily(dom.quality) !== 'major') continue;
                    // In minor keys, ♭VII → III is V → I of the relative major
                    // and needs no chromatic evidence (all notes are diatonic).
                    const _homePc = noteNameToPc(currentTonic);
                    const isBVII_to_III = isMinorMode
                        && dom.rootPc === (_homePc + 10) % 12
                        && res.rootPc === (_homePc + 3) % 12
                        && qualityFamily(res.quality) === 'major';
                    // Require chromatic evidence unless it's the ♭VII → III case
                    if (!isBVII_to_III && !dom.notePcs?.some(pc => !_homeScalePcs.has(pc))) continue;
                    const targetPc = res.rootPc;
                    const targetIsMinor = qualityFamily(res.quality) !== 'major';
                    // Skip if already covered by a cadential match or manual marker
                    const alreadyCovered = _effectiveCtxs.some(c =>
                        Math.abs(analysisContextAbsBeat(c) - dom.absBeat) < 0.1
                        && noteNameToPc(c.newTonic) === targetPc);
                    if (alreadyCovered) continue;
                    // Inject tonicisation context covering V + resolution
                    _effectiveCtxs.push({
                        absBeat: dom.absBeat,
                        newTonic: pcToNoteName(targetPc),
                        newIsMinor: targetIsMinor,
                        score: 65,
                        source: 'inferred',
                    });
                    // Return to home key + pivot detection:
                    // if the chord after the resolution is diatonic to the
                    // target key, record it as a pivot candidate (VI=III).
                    const _nextAfterRes = _chEvts.find(ev => ev.absBeat > res.absBeat + 1e-6);
                    if (_nextAfterRes) {
                        const _tgtScaleD = new Set(getScalePcs(targetPc, targetIsMinor));
                        const nextIsDiatonicD = _nextAfterRes.notePcs?.every(pc => _tgtScaleD.has(pc));
                        if (nextIsDiatonicD) {
                            _pivotCandidates.set(_nextAfterRes.absBeat,
                                { tonic: pcToNoteName(targetPc), isMinor: targetIsMinor });
                        }
                        if (!_manualBeats.has(_nextAfterRes.absBeat)) {
                            _effectiveCtxs.push({
                                absBeat: _nextAfterRes.absBeat,
                                newTonic: currentTonic,
                                newIsMinor: isMinorMode,
                                score: 0,
                                source: 'inferred',
                            });
                        }
                    }
                }
            }
        } catch { /* cadential recognition failed gracefully */ }

        const ctxAtAbsBeat = (absBeat: number) => _effectiveCtxs
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => {
                const d = analysisContextAbsBeat(b) - analysisContextAbsBeat(a);
                if (Math.abs(d) > 1e-6) return d;
                // Same beat: prefer higher-confidence entry (tonicisation > return-to-home)
                return ((b as any).score ?? 0) - ((a as any).score ?? 0);
            })[0];

        const qAbs = (x: number) => {
            try {
                // Quantize to 1/192 of a beat to avoid float drift and to align with timeline events.
                const q = 192;
                return Math.round(Number(x) * q) / q;
            } catch {
                return Number(x) || 0;
            }
        };

        const getNear = <T,>(m: Map<number, T>, a0: number): T | undefined => {
            try {
                const a = Number(a0);
                if (!Number.isFinite(a)) return undefined;
                const direct = m.get(a);
                if (direct !== undefined) return direct;
                // Tolerate tiny float drift between different absBeat sources.
                const EPS = (1 / 192) + 1e-6;
                for (const [k, v] of m.entries()) {
                    if (Math.abs(Number(k) - a) <= EPS) return v;
                }
                return undefined;
            } catch {
                return undefined;
            }
        };

        const overrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        try {
            (harmonyOverrides || []).forEach((o: any) => {
                const a = Number(o?.absBeat);
                if (!Number.isFinite(a)) return;
                overrideByAbsBeat.set(qAbs(a), {
                    absBeat: a,
                    roman: typeof o?.roman === 'string' ? o.roman : undefined,
                    symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                    figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                    note: typeof o?.note === 'string' ? o.note : undefined,
                });
            });
        } catch { /* ignore */ }

        // Ensure beats with user-placed harmony overrides are always present
        // in the filtered timeline so the override is actually applied.
        if (overrideByAbsBeat.size > 0) {
            const filteredBeats = new Set(timelineFiltered.map((ev: any) => qAbs(Number(ev?.absBeat))));
            for (const [ovrBeat] of overrideByAbsBeat) {
                if (filteredBeats.has(ovrBeat)) continue;
                const match = (timeline || []).find((ev: any) =>
                    ev && Math.abs(qAbs(Number(ev?.absBeat)) - ovrBeat) < 1e-6);
                if (match) timelineFiltered.push(match);
            }
            timelineFiltered.sort((a: any, b: any) => Number(a?.absBeat) - Number(b?.absBeat));
        }

        // ---------------------------------------------------------
        // 2-measure lookahead tonicization (label-only)
        // ---------------------------------------------------------
        // Goal: allow a short, "provisional" functional reading of a few events without
        // emitting a key-context change. Example in C: Gm before V/ii → ii can be shown as iv/ii.
        // This pass only creates display overrides and never beats a user override.
        const autoOverrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        const autoRomanDisplayByAbsBeat = new Map<number, string>();
        const protectedAbsBeats = new Set<number>();
        try {
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

            const scaleIntervalsForContext = (isMinor: boolean): number[] => (
                isMinor
                    ? [0, 2, 3, 5, 7, 8, 10] // natural minor
                    : [0, 2, 4, 5, 7, 9, 11]
            );

            // Precompute base Roman labels for the label timeline under the *current* active context.
            const base = (timelineFiltered || []).map((ev: any) => {
                const absBeat = Number(ev?.absBeat);
                const ctx = ctxAtAbsBeat(absBeat);
                const ctxTonic = ctx ? String(ctx.newTonic || '') : String(currentTonic || 'C');
                const ctxIsMinor = ctx ? !!ctx.newIsMinor : !!isMinorMode;
                const r = getRomanAnalysis(structuralNotes(ev?.notes || [], ornOverrideMap), ctxTonic, ctxIsMinor, { ornamentOverrides: ornOverrideRecord });
                return {
                    ev,
                    absBeat,
                    q: qAbs(absBeat),
                    ctxTonic,
                    ctxIsMinor,
                    roman: String(r?.roman || ''),
                };
            }).filter(x => Number.isFinite(x.absBeat));

            // Inject user harmony overrides into base so the lookahead
            // tonicization sees the user's intended roman labels and can
            // propagate context to neighboring beats.
            if (overrideByAbsBeat.size > 0) {
                for (const b of base) {
                    const ov = overrideByAbsBeat.get(b.q);
                    if (ov?.roman) b.roman = ov.roman;
                }
            }

            // ─── Pivot labels from cadential resolution ───
            for (const [pivBeat, pivInfo] of _pivotCandidates) {
                if (autoRomanDisplayByAbsBeat.has(pivBeat)) continue;
                const bEntry = base.find((b: any) => Math.abs(b.q - pivBeat) < 0.1);
                if (!bEntry?.ev?.notes?.length) continue;
                const rTgt = getRomanAnalysis(
                    structuralNotes(bEntry.ev.notes, ornOverrideMap),
                    pivInfo.tonic, pivInfo.isMinor,
                    { ornamentOverrides: ornOverrideRecord },
                );
                const homeR = String(bEntry.roman || '');
                if (rTgt?.roman && homeR && rTgt.roman !== homeR) {
                    autoRomanDisplayByAbsBeat.set(bEntry.q, `${rTgt.roman}=${homeR}`);
                }
            }

            // ── Cadential tonicization detector ──
            // Detect V→I cadential patterns in secondary keys that the engine missed.
            // E.g., in C major: Bb/D → C/E → F ≡ IV→V→I in F (tonicization to IV).
            {
                const _allKeys = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
                const _globalPc = noteNameToChromaticIndex(currentTonic);
                const _scaleIntervals = isMinorMode ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
                const _scale = new Set(_scaleIntervals.map(i => (i + _globalPc) % 12));
                const _degreeNames = isMinorMode
                    ? ['i','\u266DII','ii\u00B0','\u266DIII','iv','v','\u266DVI','\u266DVII','VI','vi\u00B0','VII','vii\u00B0']
                    : ['I','\u266DII','ii','\u266DIII','iii','IV','\u266EIV\u00B0','V','\u266DVI','vi','\u266DVII','vii\u00B0'];

                const _keyDeg = (targetKey: string): string | null => {
                    const tPc = noteNameToChromaticIndex(targetKey);
                    if (tPc < 0 || _globalPc < 0) return null;
                    const interval = ((tPc - _globalPc) % 12 + 12) % 12;
                    return _degreeNames[interval] || null;
                };

                const _funcRe = /^(ii|III|IV|vi|I|iii|V|i|iv|v|\u266DVII|\u266DVI|\u266DIII)/;

                for (let j = 1; j < base.length; j++) {
                    if (autoOverrideByAbsBeat.has(base[j].q) || autoRomanDisplayByAbsBeat.has(base[j].q)
                        || overrideByAbsBeat.has(base[j].q)) continue;
                    // If this chord is already a secondary dominant in the global key
                    // (e.g. V/V), don't relabel it as "I=degree".  The secondary-
                    // function label is more informative and musically correct.
                    const _globalRomanJ = String(base[j].roman || '');
                    if (_globalRomanJ.includes('/')) continue;
                    // Hybrid guard: skip 12-key scan when DRE already provides
                    // a strong diatonic function in a modulated (non-global) context.
                    // This prevents tautological matches (e.g. F#=I in F# key)
                    // while still allowing tonicization detection in the global key zone.
                    const _dreStrong = /^(I|i|II|ii|III|iii|IV|iv|V|v|VI|vi|VII|vii)(°|ø|7|6|64|$)/.test(_globalRomanJ);
                    if (_dreStrong && base[j].ctxTonic !== currentTonic) continue;
                    const evJ = base[j].ev;
                    const evPrev = base[j - 1].ev;
                    if (!evJ?.notes?.length || !evPrev?.notes?.length) continue;
                    const stJ = structuralNotes(evJ.notes, ornOverrideMap);
                    const stPrev = structuralNotes(evPrev.notes, ornOverrideMap);
                    if (stJ.length < 2 || stPrev.length < 2) continue;

                    for (const K of _allKeys) {
                        if (K === currentTonic) continue;
                        const rJ = getRomanAnalysis(stJ, K, false);
                        if (!rJ || rJ.roman !== 'I') continue;
                        // Guard: skip enharmonic tautological match (e.g. K='Gb' for an F# chord)
                        const _kPc = noteNameToChromaticIndex(K);
                        const _rootNote = stJ.find(n => ((Number(n?.midi) % 12) + 12) % 12 === _kPc);
                        if (_rootNote) {
                            const _sp = String(_rootNote.pitch || '') + (_rootNote.accidental === 'sharp' ? '#' : _rootNote.accidental === 'flat' ? 'b' : '');
                            if (_sp !== K) continue;
                        }
                        const rPrev = getRomanAnalysis(stPrev, K, false);
                        if (!rPrev || !/^V/.test(rPrev.roman)) continue;
                        // V° (diminished) is not a real dominant — skip auto-tonicization
                        if (/°|dim/.test(rPrev.roman)) continue;

                        const degLabel = _keyDeg(K);
                        if (!degLabel) continue;

                        // Look back for pre-dominants in K (up to 2 measures)
                        let firstIdx = j - 1;
                        for (let i = j - 2; i >= 0 && (base[j].absBeat - base[i].absBeat) <= beatsPerMeasure * 2; i--) {
                            if (!base[i].ev?.notes?.length) break;
                            const stI = structuralNotes(base[i].ev.notes, ornOverrideMap);
                            if (stI.length < 2) break;
                            const rI = getRomanAnalysis(stI, K, false);
                            if (rI && _funcRe.test(rI.roman)) firstIdx = i;
                            else break;
                        }
                        // Look forward for continuation in K (up to 2 measures)
                        let lastIdx = j;
                        for (let i = j + 1; i < base.length && (base[i].absBeat - base[j].absBeat) <= beatsPerMeasure * 2; i++) {
                            if (!base[i].ev?.notes?.length) break;
                            const stI = structuralNotes(base[i].ev.notes, ornOverrideMap);
                            if (stI.length < 2) break;
                            const rI = getRomanAnalysis(stI, K, false);
                            if (rI && _funcRe.test(rI.roman)) lastIdx = i;
                            else break;
                        }

                        // Require chromatic evidence across the entire span [firstIdx..lastIdx]
                        let _hasChromatic = false;
                        for (let s = firstIdx; s <= lastIdx && !_hasChromatic; s++) {
                            const _ns = base[s].ev?.notes || [];
                            for (const _n of _ns) {
                                const _pc = (((_n as any).midi ?? 0) % 12 + 12) % 12;
                                if (!_scale.has(_pc)) { _hasChromatic = true; break; }
                            }
                        }
                        if (!_hasChromatic) continue;

                        if ((lastIdx - firstIdx + 1) >= 2) {
                            for (let s = firstIdx; s <= lastIdx; s++) {
                                if (autoRomanDisplayByAbsBeat.has(base[s].q) || overrideByAbsBeat.has(base[s].q)) continue;
                                if (!base[s].ev?.notes?.length) continue;

                                // Only label chords that contain at least one chromatic note
                                // relative to the global key.  Diatonic chords (e.g. I in C)
                                // should keep their natural label — they are not evidence
                                // of a tonicization by themselves.
                                let _chordHasChromatic = false;
                                for (const _cn of (base[s].ev.notes || [])) {
                                    const _cpc = (((_cn as any).midi ?? 0) % 12 + 12) % 12;
                                    if (!_scale.has(_cpc)) { _chordHasChromatic = true; break; }
                                }
                                if (!_chordHasChromatic) continue;

                                const stS = structuralNotes(base[s].ev.notes, ornOverrideMap);
                                const rS = getRomanAnalysis(stS, K, false);
                                if (rS) {
                                    // Strip any secondary-function suffix (e.g. V/V → V) to prevent
                                    // triple-nesting like V/V/IV.  We only want the LOCAL function in key K.
                                    const localR = String(rS.roman || '').replace(/\/.*$/, '');
                                    if (compactTonicization) {
                                        autoRomanDisplayByAbsBeat.set(base[s].q, s === firstIdx ? `[${degLabel}] ${localR}` : localR);
                                    } else {
                                        const display = (s === j) ? `${localR}=${degLabel}` : `${localR}/${degLabel}`;
                                        autoRomanDisplayByAbsBeat.set(base[s].q, display);
                                    }
                                }
                            }
                            break; // don't try more keys for this arrival beat
                        }
                    }
                }
            }

            const maxLookaheadBeats = beatsPerMeasure * 2;
            for (let j = 0; j < base.length; j++) {
                const bj = base[j];
                const rj = String(bj.roman || '');
                const m = rj.match(/^([Vv])\/(.+)$/);
                if (!m) continue;
                const targetRoman = String(m[2] || '').trim();
                if (!targetRoman) continue;

                // Find an arrival chord labeled exactly as the target within 2 measures.
                let k = -1;
                for (let t = j + 1; t < base.length; t++) {
                    if ((base[t].absBeat - bj.absBeat) > maxLookaheadBeats + 1e-6) break;
                    if (String(base[t].roman || '') === targetRoman) {
                        k = t;
                        break;
                    }
                }
                if (k < 0) continue;

                // Protect the resolution chord from being reinterpreted by later tonicizations.
                // This avoids confusing cases like: iv/ii - V/ii - (resolution) being later
                // relabeled as iv/vi just because a V/vi appears afterwards.
                try {
                    const bk = base[k];
                    if (bk && Number.isFinite(bk.q)) protectedAbsBeats.add(bk.q);
                } catch { /* ignore */ }

                // Determine the tonicized key root (pitch name) for the target degree in the CURRENT context.
                const tonicPc = noteNameToChromaticIndex(String(bj.ctxTonic || 'C'));
                if (tonicPc == null || tonicPc < 0) continue;
                const degIdx = degreeIndexFromRoman(targetRoman);
                if (degIdx == null) continue;
                const ints = scaleIntervalsForContext(!!bj.ctxIsMinor);
                const tonicizedPc = (((tonicPc + (ints[degIdx] ?? 0)) % 12) + 12) % 12;
                const tonicizedTonic = pcToName(tonicizedPc);

                // Heuristic: if the target degree is a lowercase roman, treat the tonicized key as minor.
                const tonicizedIsMinor = targetRoman === targetRoman.toLowerCase();

                // Add a display-only pivot on the resolution chord: i=ii, I=V, etc.
                // This makes it clear the cadence closed in the tonicized key without
                // asserting a persistent key change.
                try {
                    const bk = base[k];
                    if (bk && Number.isFinite(bk.q) && !overrideByAbsBeat.has(bk.q)) {
                        const localTonicRoman = tonicizedIsMinor ? 'i' : 'I';
                        // Only show when the global roman differs (otherwise it's noisy).
                        if (String(bk.roman || '') && String(bk.roman || '') !== localTonicRoman) {
                            autoRomanDisplayByAbsBeat.set(bk.q, `${localTonicRoman}=${targetRoman}`);
                        }
                    }
                } catch { /* ignore */ }

                // Look BACK within 2 measures for a chord that is iv in the tonicized key.
                // If found, display it as a pivot: globalRoman=iv/target.
                for (let i = j - 1; i >= 0; i--) {
                    const bi = base[i];
                    if ((bj.absBeat - bi.absBeat) > maxLookaheadBeats + 1e-6) break;
                    if (overrideByAbsBeat.has(bi.q)) continue; // user override always wins
                    if (autoOverrideByAbsBeat.has(bi.q)) continue;
                    if (protectedAbsBeats.has(bi.q)) continue;

                    const rr = getRomanAnalysis(structuralNotes(bi.ev?.notes || [], ornOverrideMap), tonicizedTonic, tonicizedIsMinor, { ornamentOverrides: ornOverrideRecord });
                    // Strip any secondary-function suffix to prevent nesting (e.g. vii°/V → vii°)
                    const localRoman = String(rr?.roman || '').replace(/\/.*$/, '');

                    // Also support the common pre-dominant pattern in tonicized minor:
                    // ii° – V – i (e.g., in G: C#° – F# – Bm = ii°/iii – V/iii – i=iii).
                    // This is often more musically informative than reading the diminished chord
                    // as vii°/V when it does not actually resolve to V.
                    if (localRoman && /^ii/i.test(localRoman) && (localRoman.includes('°') || localRoman.includes('ø'))) {
                        // Display-only — never overwrite the structural roman.
                        autoRomanDisplayByAbsBeat.set(bi.q, `${localRoman}/${targetRoman}`);
                        continue;
                    }

                    // Only reinterpret a *minor* subdominant as iv/target (e.g. Gm -> iv/ii in C).
                    // Do not relabel a major IV in the tonicized key (often a mixture/pivot sonority).
                    if (localRoman !== 'iv') continue;

                    // Pivot display (keep base roman stable, but show that this chord is a pivot):
                    // Example in C: Am (vi) before V/iii→iii becomes vi=iv.
                    // Keep it short to reduce overlap; the target (/iii) is typically evident
                    // from nearby V/target and i=target labels.
                    const globalRomanHere = String(bi.roman || '').trim();
                    if (globalRomanHere) {
                        autoRomanDisplayByAbsBeat.set(bi.q, `${globalRomanHere}=${localRoman}`);
                    } else {
                        autoRomanDisplayByAbsBeat.set(bi.q, `${localRoman}/${targetRoman}`);
                    }
                }
            }
        } catch { /* ignore */ }

        // For each system, collect all timeline events that fall within its measures
        const labelsBySystem: { id: string; x: number; roman: string; romanDisplay?: string; sequenceRoman?: string; sequenceRomanFunctional?: string; sequenceRomanSource?: string; figures: string[]; symbol: string; absBeat?: number; hiddenMarker?: boolean; isOverride?: boolean; pcsSig?: string }[][] = layoutData.systemsParams.map(() => []);


        // Helper: compute xPosition for a given absBeat in a system
        function getXForAbsBeat(absBeat: number, system: any) {
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
            const beatsPerMeasure = (measureBeatsPerMeasure && measureBeatsPerMeasure[measureIndex])
                ? measureBeatsPerMeasure[measureIndex]
                : (timeSignature.numerator * (4 / timeSignature.denominator));
            const beatInMeasure = (absBeat - ((measureStartAbsBeat && measureStartAbsBeat[measureIndex]) ? measureStartAbsBeat[measureIndex] : (measureIndex * beatsPerMeasure))) + 1;
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return 0;
            const startX = system.startMeasuresX[idx];
            const endX = idx < system.measureIndices.length - 1 ? system.startMeasuresX[idx + 1] : (system.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / beatsPerMeasure));
            return startX + MEASURE_PADDING_X + (rel * contentWidth);
        }

        const lastSigBySystem = new Map<number, string>();
        const lastCtxBySystem = new Map<number, string>();
        const lastStructuralByVoiceBySystem = new Map<number, Map<number, any>>();
        const lastBassPcBySystem = new Map<number, number | null>();
        const lastRomanBySystem = new Map<number, string>();
        const lastContextBySystem = new Map<number, { tonic: string; isMinor: boolean }>();
        const lastFiguresBySystem = new Map<number, string[]>();
        const lastChordRootPcBySystem = new Map<number, number | null>();
        const lastChordTypeBySystem = new Map<number, string | null>();
        const lastHadAppoggBySystem = new Map<number, number>();  // absBeat of last appoggiatura onset

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
            } catch { /* ignore */ }
            return null;
        };

        const isResolvingDissonanceForLabels = (n: any, evAbsBeat: number): boolean => {
            try {
                if (!n || n.isRest) return false;
                const v = (n?.voice ?? 1) as number;
                if (v === 4) return false; // never treat bass as non-chord tone for labels
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

                // Only treat *onsets* as potential resolving dissonances/appoggiature.
                // If this note was already sounding in the previous event, it's a held tone.
                try {
                    const prevEv: any = fullIndex > 0 ? (timeline as any[])[fullIndex - 1] : null;
                    if (prevEv?.notes) {
                        const alreadySounding = ((prevEv.notes || []) as any[]).some(p => (p?.voice ?? 1) === v && String(p?.id ?? '') && String(p?.id ?? '') === String(n?.id ?? ''));
                        if (alreadySounding) return false;
                    }
                } catch { /* ignore */ }

                // Critical guard: in inversions, chord tones can be dissonant vs the *bass* (e.g. the 3rd of V7 in 4/2).
                // Do not classify a note as a "resolving dissonance" if it is a chord tone of a confident, non-sus chord
                // interpretation of the current verticality. This prevents secondary dominants (e.g. D7/C = V7/V 4/2)
                // from collapsing into I4/7 after adding the next-beat resolution.
                try {
                    const notesHere = (curEv?.notes || []) as any[];
                    if (isChordToneOfConfidentCandidate(n, notesHere)) {
                        // Still allow the special 7-6/7-8 style resolution logic below to run
                        // for non-dominant major/minor seventh chords when dropping the 7th yields
                        // a stable triad (handled in the next block).
                        // Default: chord tones are NOT treated as resolving dissonances.
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
                            // Exception: allow a resolving 7th (common 7-6 retardation/appoggiatura)
                            // to be treated as a non-chord tone *even if* the best chord candidate
                            // is a 7th chord, when dropping this note yields a triadic interpretation.
                            // This is intentionally conservative: do NOT do this for dominant 7ths,
                            // to avoid breaking V7/V and cadential dominant behavior.
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
                                            // Do NOT short-circuit; allow the resolution tests below.
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
                } catch { /* ignore */ }

                // Duration-based guard: if this note has the same duration as all others
                // at this event AND it belongs to a confident chord of the current
                // verticality, do NOT treat it as a resolving dissonance. This prevents
                // real chord members (e.g. the 3rd of V7 in V4/2) from being excluded
                // when they happen to be dissonant vs the bass and step-resolve to the
                // next chord. We use identifyChordCandidates directly because the local
                // isChordToneOfConfidentCandidate helper can fail in edge cases.
                try {
                    const notesHere2 = (curEv?.notes || []) as any[];
                    const nonRestHere = notesHere2.filter((nn: any) => nn && !nn.isRest);
                    if (nonRestHere.length >= 3) {
                        const durations = nonRestHere.map((nn: any) => nn.duration || 'quarter');
                        const allSameDur = durations.every((d: string) => d === durations[0]);
                        if (allSameDur) {
                            const cands = identifyChordCandidates(nonRestHere as any);
                            const best: any = (cands && cands.length) ? cands[0] : null;
                            const mt = String(best?.matchType || '');
                            const confident = mt === 'exact' || mt === 'no_fifth' || mt === 'no_third';
                            if (confident && best?.root && best?.type) {
                                const chordType = String(best.type || '');
                                const isSusLike = /sus|add/i.test(chordType);
                                if (!isSusLike) {
                                    const rootPc = Number.isFinite((best.root as any).noteIndex)
                                        ? (((best.root as any).noteIndex % 12) + 12) % 12
                                        : Number.isFinite((best.root as any).midi)
                                            ? (((best.root as any).midi % 12) + 12) % 12 : null;
                                    const notePc = Number.isFinite(n?.midi)
                                        ? (((n.midi % 12) + 12) % 12) : null;
                                    if (rootPc != null && notePc != null) {
                                        const formula = (CHORD_FORMULAS as any)?.[chordType] as number[] | undefined;
                                        if (Array.isArray(formula) && formula.length) {
                                            const interval = (((notePc - rootPc) % 12) + 12) % 12;
                                            if (interval === 0 || formula.includes(interval)) {
                                                return false;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }

                if (!isDissonantIntervalAgainstBass(n, curEv?.notes || [])) return false;

                // Appoggiature can last longer than a single beat; allow a slightly wider window.
                const next = findNextOnsetForVoice(fullIndex, v, 2.01);
                if (!next?.note || !Number.isFinite(n.midi) || !Number.isFinite(next.note.midi)) return false;
                const step = Math.abs((next.note.midi ?? 0) - (n.midi ?? 0));
                if (!(step > 0 && step <= 2)) return false;
                // Resolution should remove the vertical dissonance vs the (new) bass.
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
                // User manual ornament overrides are absolute — bypass all rescue heuristics.
                // Check both the flag on the note AND the ornOverrideMap (for orphaned IDs
                // where the flag couldn't be set because override noteId ≠ analyzedNote id).
                if (n.ornamentOverride && n.ornamentOverride !== 'structural') return true;
                if (ornOverrideMap.size > 0) {
                    const ovById = ornOverrideMap.get(n.id);
                    if (ovById && ovById !== 'structural') return true;
                    const midi = Number(n.midi);
                    if (Number.isFinite(midi)) {
                        const ck = `${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`;
                        const ovByCk = ornOverrideMap.get(ck);
                        if (ovByCk && ovByCk !== 'structural') return true;
                    }
                }
                const v = (n?.voice ?? 1) as number;
                if (v === 4) {
                    // By default keep the bass in the structural snapshot (it stabilizes labels).
                    // Exception: when the engine explicitly flags a short weak-beat bass note as an
                    // ornament (passing/escape/neighbor/etc.), ignore it so it doesn't create a
                    // spurious harmony label (e.g. V4 from a bass "nota di volta").
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
                            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                            return !isStrongPulseInMeasure(inMeasure);
                        } catch {
                            return false;
                        }
                    })();

                    if (weak && dur <= 1.01) return true;
                    return false;
                }

                // Mis-tag guard (critical for inversions): chord tones can be dissonant vs the bass.
                // If the engine tagged a chord tone as neighbor/anticipation/appoggiatura, keep it
                // in the structural snapshot when it belongs to a confident chord candidate.
                try {
                    const isStrongBeat = (() => {
                        try {
                            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                            return isStrongPulseInMeasure(inMeasure);
                        } catch {
                            return false;
                        }
                    })();

                    // IMPORTANT: do not "rescue" weak-beat neighbors as chord tones.
                    // Otherwise a short note di volta can form a plausible triad (e.g. D–F–A)
                    // and incorrectly flip the harmony/figured bass at that scanpoint.
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
                } catch { /* ignore */ }

                // Passing notes are usually non-structural, but in compound meters the 4th eighth is a
                // strong pulse and real harmony changes can happen there. If the engine mis-tags a
                // chord tone as passing/escape, keep it when it fits a confident chord candidate.
                try {
                    if (n.isPassing || n.isEscape) {
                        const isStrongBeat = (() => {
                            try {
                                const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                                return isStrongPulseInMeasure(inMeasure);
                            } catch {
                                return false;
                            }
                        })();

                        if (isStrongBeat) {
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
                        return true;
                    }
                } catch { /* ignore */ }

                if (n.isPassing || n.isEscape) return true;

                // If a note is tagged as appoggiatura but it's actually consonant against the
                // current bass, treat it as a chord tone (mis-tag guard).
                if (n.isAppoggiatura) {
                    const fullIndex = indexByAbsBeat.get(absBeat);
                    const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                    if (curEv?.notes && isDissonantIntervalAgainstBass(n, curEv.notes || [])) return true;
                    return false;
                }

                // Anticipations are tricky: they can be either true NCTs (dissonant against the
                // current bass) or simply early chord tones that belong to the underlying harmony.
                // If an "anticipation" is consonant against the bass at this scanpoint, keep it
                // in the structural snapshot to avoid collapsing triads to dyads (e.g. Bb/D -> iii5).
                if (n.isAnticipation) {
                    const fullIndex = indexByAbsBeat.get(absBeat);
                    const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                    if (curEv?.notes && isDissonantIntervalAgainstBass(n, curEv.notes || [])) return true;
                    return false;
                }

                // Same idea for neighbors: if the engine tagged a chord tone as a neighbor, but it's
                // consonant against the current bass on a strong beat, keep it so inversions like I6
                // don't collapse into dyad-inferred labels.
                if (n.isNeighbor) {
                    const fullIndex = indexByAbsBeat.get(absBeat);
                    const curEv: any = (fullIndex != null) ? (timeline as any[])[fullIndex] : null;
                    if (curEv?.notes && !isDissonantIntervalAgainstBass(n, curEv.notes || [])) {
                        try {
                            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                            const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                            if (isStrongPulseInMeasure(inMeasure)) return false;
                        } catch { /* ignore */ }
                    }
                    return true;
                }
                const s = n.isSuspension;
                if (s && typeof s.fromAbsBeat === 'number' && Math.abs(s.fromAbsBeat - absBeat) < 1e-6) return true;
                if (isResolvingDissonanceForLabels(n, absBeat)) return true;
            } catch (_) { /* ignore */ }
            return false;
        };

        const inferDiatonicRomanFromBass = (bassPc: number | null, tonic: string, isMinor: boolean): { roman: string; triad: { root: number; third: number; fifth: number } } | null => {
            try {
                if (bassPc == null) return null;
                const tIdx = noteNameToChromaticIndex(String(tonic ?? ''));
                if (tIdx == null || tIdx < 0 || !Number.isFinite(tIdx)) return null;

                const scaleIntervals = isMinor
                    ? [0, 2, 3, 5, 7, 8, 10] // natural minor for diatonic triads
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
                    }
                };
            } catch {
                return null;
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
                // Use pitch-class signature only. This avoids re-labeling just because
                // a voice re-articulates the same harmony in another octave/register.
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

        const triadPcsFromRootAndType = (rootPc: number, chordType: string): { root: number; third: number; fifth: number } | null => {
            try {
                if (rootPc == null || !Number.isFinite(rootPc)) return null;
                const t = String(chordType || '');
                const isDim = t.includes('dim') || t.includes('°') || t.includes('b5');
                const isAug = t.includes('aug') || t.includes('+') || t.includes('#5');
                const isMinor = !isDim && !isAug && (t.startsWith('m') || t.includes('Minor'));
                const thirdInt = isMinor || isDim ? 3 : 4;
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

        timelineFiltered.forEach((event, eventIndex) => {
            // Find which system this event belongs to
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

            // Structural harmony: ignore ornaments/anticipations so they don't create
            // micro-harmony labels on every scan-point.
            const fullNotes = (event.notes || []);

            // Build a stable structural snapshot by voice: if a voice is currently on an ornament
            // (anticipation/neighbor/etc.), keep the last non-ornamental active note for that voice.
            // This prevents spurious label changes when a chord tone is temporarily replaced by an ornament.
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

            // Clear voices that are no longer active at this event.
            for (const v of Array.from(lastStructural.keys())) {
                if (!voiceSet.has(v)) lastStructural.delete(v);
            }

            // ── APPOGGIATURA VERTICALIZATION PRE-SCAN ──
            // When one or more notes at this beat are appoggiaturas (auto-detected
            // or manually overridden), the target harmony is formed by REPLACING
            // each appoggiatura with its resolution (next note in same voice)
            // and treating every OTHER note as a structural chord tone.
            // This prevents the auto-detection engine from incorrectly excluding
            // real chord tones that happen to carry ornament flags.
            const _appoggResolutions = new Map<number, any>();
            for (const _an of fullNotes) {
                if (!_an || _an.isRest) continue;
                const _av = ((_an as any)?.voice ?? 1) as number;
                let _isAppogg = !!(_an as any).isAppoggiatura;
                if (!_isAppogg && (_an as any).ornamentOverride === 'appoggiatura') _isAppogg = true;
                if (!_isAppogg && ornOverrideMap.size > 0) {
                    const _ovId = ornOverrideMap.get(_an.id);
                    if (_ovId === 'appoggiatura') { _isAppogg = true; }
                    else {
                        const _am = Number(_an.midi);
                        if (Number.isFinite(_am)) {
                            const _ack = `${_am}-${_an.measureIndex ?? -1}-${_an.beat ?? -1}`;
                            if (ornOverrideMap.get(_ack) === 'appoggiatura') _isAppogg = true;
                        }
                    }
                }
                if (!_isAppogg) continue;
                // Look ahead: find the resolution note (next timeline event, same voice)
                if (eventIndex + 1 < timelineFiltered.length) {
                    const _nxEv = timelineFiltered[eventIndex + 1] as any;
                    const _nxNotes = (_nxEv?.notes || []) as any[];
                    const _rn = _nxNotes.find(
                        (nn: any) => nn && !nn.isRest && ((nn.voice ?? 1) as number) === _av
                    );
                    if (_rn) _appoggResolutions.set(_av, _rn);
                }
            }
            const _hasAppoggAtBeat = _appoggResolutions.size > 0;


            // Update with any currently-active non-ornamental notes.
            for (const n of fullNotes) {
                if (!n || n.isRest) continue;
                const v = (n?.voice ?? 1) as number;

                // ── APPOGGIATURA VERTICALIZATION ──
                // When there's an appoggiatura at this beat, build the target chord:
                // • appoggiatura voice → resolution note
                // • other voices → structural (bypass auto-detection flags)
                // Only user MANUAL overrides on other voices are still respected.
                if (_hasAppoggAtBeat) {
                    if (_appoggResolutions.has(v)) {
                        // This voice carries the appoggiatura → use resolution note.
                        // Create a clean copy so getRomanAnalysis doesn't filter it.
                        const _rn = _appoggResolutions.get(v);
                        lastStructural.set(v, {
                            ..._rn,
                            isPassing: false, isNeighbor: false,
                            isAppoggiatura: false, isAnticipation: false,
                            isEscape: false, isSuspension: undefined,
                        });
                    } else {
                        // Other voices: respect only USER manual overrides
                        let _manualExclude = false;
                        if (n.ornamentOverride && n.ornamentOverride !== 'structural' && n.ornamentOverride !== 'appoggiatura') {
                            _manualExclude = true;
                        } else if (ornOverrideMap.size > 0) {
                            const _ov1 = ornOverrideMap.get(n.id);
                            if (_ov1 && _ov1 !== 'structural' && _ov1 !== 'appoggiatura') {
                                _manualExclude = true;
                            } else {
                                const _m2 = Number(n.midi);
                                if (Number.isFinite(_m2)) {
                                    const _ck2 = `${_m2}-${n.measureIndex ?? -1}-${n.beat ?? -1}`;
                                    const _ov2 = ornOverrideMap.get(_ck2);
                                    if (_ov2 && _ov2 !== 'structural' && _ov2 !== 'appoggiatura') _manualExclude = true;
                                }
                            }
                        }
                        if (_manualExclude) {
                            lastStructural.delete(v);
                        } else {
                            // Insert a CLEAN copy: strip all auto-detection NCT
                            // flags so getRomanAnalysis treats this as a pure
                            // structural chord tone in the verticalization.
                            lastStructural.set(v, {
                                ...n,
                                isPassing: false, isNeighbor: false,
                                isAppoggiatura: false, isAnticipation: false,
                                isEscape: false, isSuspension: undefined,
                            });
                        }
                    }
                    continue;
                }

                // In compound meters (6/8, 9/8, 12/8), bass lines are often written as
                // arpeggiations on the internal 8th/16th grid. Those short bass notes should
                // not flip the harmony label/figures on weak subdivisions.
                try {
                    if (v === 4 && isCompoundMeter) {
                        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                        const absBeat = Number(event.absBeat);
                        const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                        const strongPulse = isStrongPulseInMeasure(inMeasure);
                        const base = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25, 'thirty-second': 0.125, 'sixty-fourth': 0.0625 } as any)[n.duration || 'quarter'] || 1;
                        let dur = base;
                        if (n.isDotted) dur *= 1.5;
                        if (n.isTriplet) dur *= 2 / 3;
                        if (n.isDuplet) dur *= 3 / 2;
                        if (!strongPulse && dur <= 0.51) {
                            // treat as non-structural bass motion (arpeggio/passing)
                            continue;
                        }
                    }
                } catch { /* ignore */ }

                if (isNonChordToneAtLabelEvent(n, event.absBeat)) {
                    // If the current active note for this voice is a suspension onset,
                    // do not keep any structural note for this voice at this scanpoint.
                    // For other ornaments (passing/neighbor/etc.), keep the previous structural note.
                    // HELD SUSPENSIONS (onset at a previous beat) are still sounding →
                    // treat them as structural chord tones.
                    try {
                        const s = (n as any)?.isSuspension;
                        if (s && typeof s.fromAbsBeat === 'number') {
                            if (Math.abs((s.fromAbsBeat as number) - Number(event.absBeat)) < 1e-3) {
                                lastStructural.delete(v);
                            } else {
                                // Held suspension: still sounding at this beat → structural
                                lastStructural.set(v, {
                                    ...n,
                                    isPassing: false, isNeighbor: false,
                                    isAppoggiatura: false, isAnticipation: false,
                                    isEscape: false, isSuspension: undefined,
                                });
                            }
                            continue;
                        }
                    } catch { /* ignore */ }
                    // Appoggiatura: replace this voice in the structural snapshot with
                    // the resolution note (next note in same voice) so the chord label
                    // reflects the target harmony — just like suspensions include
                    // the resolved note. Without this, removing the appoggiatura leaves
                    // an incomplete chord (e.g. G-D instead of G-B-D → V).
                    try {
                        if ((n as any).isAppoggiatura && eventIndex + 1 < timelineFiltered.length) {
                            const _nextEv = timelineFiltered[eventIndex + 1] as any;
                            const _nextNotes = (_nextEv?.notes || []) as any[];
                            const _resolNote = _nextNotes.find((nn: any) => nn && !nn.isRest && ((nn.voice ?? 1) as number) === v);
                            if (_resolNote) {
                                lastStructural.set(v, _resolNote);
                                continue; // skip ornament-delete — voice uses resolution note
                            }
                        }
                    } catch { /* ignore */ }
                    // For USER-overridden ornaments: remove voice from structural snapshot entirely.
                    // Auto-detected ornaments keep the previous structural note (voice continuity),
                    // but manual overrides mean the user explicitly wants this pitch excluded
                    // from the chord analysis — not replaced by the previous note in that voice.
                    if (n.ornamentOverride && n.ornamentOverride !== 'structural') {
                        lastStructural.delete(v);
                    } else if (ornOverrideMap.size > 0) {
                        const _ov1 = ornOverrideMap.get(n.id);
                        if (_ov1 && _ov1 !== 'structural') {
                            lastStructural.delete(v);
                        } else {
                            const _midi = Number(n.midi);
                            if (Number.isFinite(_midi)) {
                                const _ck = `${_midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`;
                                const _ov2 = ornOverrideMap.get(_ck);
                                if (_ov2 && _ov2 !== 'structural') {
                                    lastStructural.delete(v);
                                }
                            }
                        }
                    }
                    continue;
                }
                // We only reach here when isNonChordToneAtLabelEvent returned false,
                // meaning this note is structural.  Clear any residual isSuspension
                // flag so downstream filters (harmonicNotesNoSuspAtThisBeat) don't
                // accidentally remove it from the chord verticalization.
                const _suspFlag = (n as any)?.isSuspension;
                // ── Targeted diagnostic for F#3 isSuspension clean ──
                try {
                    const _dbgRaw2 = localStorage.getItem('_HT_DEBUG_BEAT');
                    const _dbgB2 = _dbgRaw2 !== null ? Number(_dbgRaw2) : NaN;
                    if (!isNaN(_dbgB2) && _dbgB2 >= 0 && Math.abs(Number(event.absBeat) - _dbgB2) < 0.5 && v === 4) {
                        console.log('[HT-DBG] v4 path at ab=' + event.absBeat +
                            ' _suspFlag=' + JSON.stringify(_suspFlag) +
                            ' cleaning=' + !!_suspFlag);
                    }
                } catch { /* ignore */ }
                lastStructural.set(v, _suspFlag ? { ...n, isSuspension: undefined } : n);
            }

            // ── Diagnostic: dump lastStructural content when tracer is active ──
            const _dbgRawEarly = localStorage.getItem('_HT_DEBUG_BEAT');
            const _dbgBeatEarly = _dbgRawEarly !== null ? Number(_dbgRawEarly) : NaN;
            const _dbgEarly = !isNaN(_dbgBeatEarly) && _dbgBeatEarly >= 0 && Math.abs(event.absBeat - _dbgBeatEarly) < 0.5;
            if (_dbgEarly) {
                const lsEntries = Array.from(lastStructural.entries()).map(([v, n]) => ({
                    v, midi: (n as any)?.midi, pitch: (n as any)?.pitch, acc: (n as any)?.accidental, explAcc: (n as any)?.explicitAccidental, noteIndex: (n as any)?.noteIndex, susp: !!(n as any)?.isSuspension
                }));
                console.log('[HT-DBG] lastStructural at ab=' + event.absBeat + ':', JSON.stringify(lsEntries));
                console.log('[HT-DBG] fullNotes at ab=' + event.absBeat + ':', JSON.stringify((fullNotes || []).map((n: any) => ({
                    midi: n?.midi, pitch: n?.pitch, voice: n?.voice, acc: n?.accidental, explAcc: n?.explicitAccidental, susp: !!n?.isSuspension
                }))));
            }

            // Filter out user-overridden ornamental notes from the structural snapshot.
            // Notes in lastStructural may have been stored at a PREVIOUS event, before
            // the user marked them as ornaments. Their objects won't carry the
            // ornamentOverride flag, so we must also check ornOverrideMap.
            const harmonicNotes = Array.from(lastStructural.values()).filter((n: any) => {
                if (!n) return false;
                if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
                if (ornOverrideMap.size > 0) {
                    const ov1 = ornOverrideMap.get(n.id);
                    if (ov1 && ov1 !== 'structural') return false;
                    const midi = Number(n.midi);
                    if (Number.isFinite(midi)) {
                        const ck = `${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`;
                        const ov2 = ornOverrideMap.get(ck);
                        if (ov2 && ov2 !== 'structural') return false;
                    }
                }
                return true;
            });

            const fallbackHarmonicNotes = (harmonicNotes.length >= 2)
                ? harmonicNotes
                : (fullNotes || []).filter((n: any) => {
                    if (!n || n.isRest) return false;
                    if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
                    if (ornOverrideMap.size > 0) {
                        const ovById = ornOverrideMap.get(n.id);
                        if (ovById && ovById !== 'structural') return false;
                        const midi = Number(n.midi);
                        if (Number.isFinite(midi)) {
                            const ck = `${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`;
                            const ovByCk = ornOverrideMap.get(ck);
                            if (ovByCk && ovByCk !== 'structural') return false;
                        }
                    }
                    return true;
                });
            const baseHarmonicNotes = (fallbackHarmonicNotes.length >= 2)
                ? fallbackHarmonicNotes
                : (fullNotes || []).filter((n: any) => {
                    if (!n || n.isRest) return false;
                    if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
                    if (ornOverrideMap.size > 0) {
                        const ovById = ornOverrideMap.get(n.id);
                        if (ovById && ovById !== 'structural') return false;
                        const midi = Number(n.midi);
                        if (Number.isFinite(midi)) {
                            const ck = `${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`;
                            const ovByCk = ornOverrideMap.get(ck);
                            if (ovByCk && ovByCk !== 'structural') return false;
                        }
                    }
                    return true;
                });

            // If a suspension originates at this event, the held tone is a non-chord tone
            // against the new harmony. Exclude it from the chord-analysis snapshot so we
            // don't accidentally label the verticality as a sus/add sonority (e.g. V7/6).
            const SUSP_EPS = 1e-3;
            const harmonicNotesNoSuspAtThisBeat = fallbackHarmonicNotes.filter((n: any) => {
                const s = n?.isSuspension;
                if (!s || typeof s.fromAbsBeat !== 'number') return true;
                return Math.abs(s.fromAbsBeat - event.absBeat) >= SUSP_EPS;
            });
            const analysisNotes = (harmonicNotesNoSuspAtThisBeat.length >= 2)
                ? harmonicNotesNoSuspAtThisBeat
                : harmonicNotes;

            // For naming (roman + chord symbol), treat consonant "neighbor/anticipation" notes on
            // strong beats as chord tones. This avoids cases where a true chord tone gets tagged as
            // NCT and then removed inside getRomanAnalysis/getChordSymbol, collapsing a triad to a dyad
            // (e.g. Bb/D -> iii5 and missing chord symbol).
            const analysisNotesForNaming = (() => {
                try {
                    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                    const absBeat = Number(event.absBeat);
                    const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                    const isStrong = isStrongPulseInMeasure(inMeasure);

                    if (!isStrong) return analysisNotes;

                    return (analysisNotes || []).map((n: any) => {
                        if (!n || n.isRest) return n;
                        const s = n.isSuspension;
                        const isSusp = !!s && typeof s.fromAbsBeat === 'number';
                        const isNctFlag = !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura);

                        if (!isNctFlag && !isSusp) return n;

                        // Use fullNotes so consonance is evaluated against the real bass.
                        const dissonantVsBass = isDissonantIntervalAgainstBass(n, fullNotes || []);

                        // Only drop/keep suspension behavior at its actual onset. During preparation,
                        // a note can be marked as isSuspension but should still count as chord tone.
                        // Suspensions are sounding notes in the vertical — keep them structural
                        // regardless of which beat they started on (held suspensions matter too).
                        if (isSusp) return n;

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

            // Bass-driven stability: avoid re-labeling on every upper-voice onset.
            // If the bass pitch-class is unchanged, keep the previous label (unless this is the first label).
            const bassNote = (analysisNotes || [])
                .filter((n: any) => n && !n.isRest && Number.isFinite(n.midi))
                .slice()
                .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
            const bassPc = bassNote && Number.isFinite(bassNote.midi) ? (((bassNote.midi % 12) + 12) % 12) : null;

            // Use analysisNotes (suspension-filtered) for the harmonic signature.
            // baseHarmonicNotes still includes held/suspended tones, which can make
            // two genuinely different chords look identical by pitch-class set.
            const harmonicSig = signatureFromNotes(analysisNotes);
            const fullSig = signatureFromNotes(fullNotes || []);
            if (!harmonicSig || baseHarmonicNotes.length < 2) {
                return;
            }

            const applicableContext = ctxAtAbsBeat(event.absBeat);
            const contextTonic = applicableContext ? applicableContext.newTonic : currentTonic;
            const contextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinorMode;

            // ── Permanent diagnostic tracer ──────────────────────────────────
            // Activate from browser console:  localStorage.setItem('_HT_DEBUG_BEAT', '43')
            // List all beats:                 localStorage.setItem('_HT_DEBUG_BEAT', '-1')
            // Deactivate:                     localStorage.removeItem('_HT_DEBUG_BEAT')
            // Persists across reloads — set once, reload, see output.
            const _dbgRaw = localStorage.getItem('_HT_DEBUG_BEAT');
            const _dbgBeat = _dbgRaw !== null ? Number(_dbgRaw) : NaN;
            const _dbg = !isNaN(_dbgBeat) && _dbgBeat >= 0 && Math.abs(event.absBeat - _dbgBeat) < 0.5;
            if (_dbgBeat === -1) console.log(`[HT-BEATS] ab=${event.absBeat} bassPc=${bassPc} midis=[${event.notes?.map((n: any) => n.midi).join(',') ?? ''}]`);
            const _tr: Array<{ step: string; roman: string; detail?: any }> = [];
            const _dt = (step: string, romanVal: string, detail?: any) => {
                if (_dbg) _tr.push({ step, roman: romanVal, ...(detail ? { detail } : {}) });
            };
            // ─────────────────────────────────────────────────────────────────

            const ctxKey = `${contextTonic}::${contextIsMinor ? 'm' : 'M'}`;
            const prevSig = lastSigBySystem.get(systemIndex);
            const prevCtx = lastCtxBySystem.get(systemIndex);
            const prevBassPc = lastBassPcBySystem.get(systemIndex);

            const hasOrnamentOnsetAtThisBeat = (() => {
                try {
                    // Only true "ornaments" should create hidden markers for the generic harmony hold-line.
                    // Passing notes already have their own connection/line, so don't double-draw.
                    return (fullNotes || []).some((n: any) => {
                        if (!n || n.isRest) return false;
                        return !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura || n.isEscape);
                    });
                } catch {
                    return false;
                }
            })();

            // Detect if this event has an appoggiatura onset (used to suppress
            // the label on the *next* event where the appoggiatura resolves).
            let hasAppoggiaturaOnsetHere = false;
            let isAppoggResolSuppressible = false;
            let isAppoggiaturaResolution = false;

            try {
                hasAppoggiaturaOnsetHere = (fullNotes || []).some((n: any) => !!(n && !n.isRest && n.isAppoggiatura));

                // If the previous event had an appoggiatura and the current event is
                // its resolution (within 2 beats), suppress the label because the
                // harmony is already labeled at the appoggiatura beat.  The resolved
                // note merely completes the chord — no new label is needed.
                const lastAppBeat = lastHadAppoggBySystem.get(systemIndex) ?? -Infinity;
                isAppoggiaturaResolution = (event.absBeat - lastAppBeat > 0) && (event.absBeat - lastAppBeat <= 2 + 1e-6)
                    && !hasAppoggiaturaOnsetHere;
                // Only suppress if bass didn't change (a bass change = real harmony change).
                const prevBassPcHere = lastBassPcBySystem.get(systemIndex);
                isAppoggResolSuppressible = isAppoggiaturaResolution
                    && (prevBassPcHere == null || bassPc == null || prevBassPcHere === bassPc);
            } catch { /* ignore */ }

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

                    // Case A: completion to the diatonic triad implied by the bass.
                    {
                        const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                        if (inferred) {
                            const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
                            const ok = Array.from(curPcs).every(p => triadSet.has(p));
                            if (ok) return true;
                        }
                    }

                    // Case B: completion to the previous *diatonic* triad (shell -> full triad)
                    // e.g. vi6 shell (C–E over C) -> vi6 (A–C–E over C).
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
                    const r = getRomanAnalysis((analysisNotesForNaming || []) as any, contextTonic, contextIsMinor, { ornamentOverrides: ornOverrideRecord });
                    if (r?.roman) return String(r.roman);
                    const rFull = getRomanAnalysis((fullNotes || []) as any, contextTonic, contextIsMinor, { ornamentOverrides: ornOverrideRecord });
                    if (rFull?.roman) return String(rFull.roman);
                    return '';
                } catch {
                    return '';
                }
            })();

            // Compound-meter noise guard:
            // If we're on an internal 8th subdivision (non-strong pulse) and the bass hasn't changed,
            // don't emit a new harmony label/figures just because upper voices arpeggiate/passage.
            // Keep the previous label alive via a hidden marker so the hold-line renderer can show continuity.
            try {
                if (!hasSuspensionOnsetHere && isCompoundMeter) {
                    const absBeat = Number(event.absBeat);
                    const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                    const strongPulse = isStrongPulseInMeasure(inMeasure);

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
            } catch { /* ignore */ }

            // A "hidden change" means the full vertical sonority changed even though
            // the structural-note signature is the same. This catches e.g. bass
            // movement under sustained upper voices. BUT: if the only difference
            // is an ornamental note (passing/neighbor) entering or leaving, that
            // is NOT a real harmonic change — the structural notes are identical.
            // So we only flag hasHiddenChange when the full sig differs AND the
            // structural (harmonic) sig also differs from its previous value.
            const hasHiddenChange = !!(fullSig && prevSig && fullSig !== prevSig && harmonicSig !== prevSig);

            // If user has manually set an ornament override (suspension, appoggiatura, etc.),
            // never auto-suppress — the user's intent takes priority.
            const hasManualOrnOverride = (fullNotes || []).some((n: any) =>
                n && !n.isRest && n.ornamentOverride && n.ornamentOverride !== 'structural');

            if (!hasSuspensionOnsetHere && !hasManualOrnOverride && !hasHiddenChange && !overrideByAbsBeat.has(qAbs(event.absBeat)) && ((prevSig === harmonicSig && prevCtx === ctxKey) || shouldSuppressAsCompletion || isAppoggResolSuppressible)) {

                const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                if (previewRoman && prevRoman && previewRoman !== prevRoman) {
                    // Real harmonic change -> do not suppress.
                } else {
                // Keep the label stable, but record that *something happened* here (ornament/appoggiatura)
                // so the renderer can draw a short hold-line across hidden beats.
                if (hasOrnamentOnsetAtThisBeat || shouldSuppressAsCompletion) {
                    const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                    if (prevRoman) {
                        const x = getXForAbsBeat(event.absBeat, system);
                        labelsBySystem[systemIndex].push({
                            id: `hlabel-hidden-${systemIndex}-${event.absBeat}`,
                            x,
                            roman: prevRoman,
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
            if (hasAppoggiaturaOnsetHere) lastHadAppoggBySystem.set(systemIndex, Number(event.absBeat));
            else if (!isAppoggiaturaResolution) lastHadAppoggBySystem.delete(systemIndex);

            // L2: figures depend only on the actual vertical intervals above the real bass.
            // Never derive/overwrite them from roman/symbol/quality.
            let figures: string[] = computeFiguredBassFromNotes(analysisNotes as any, FIGURED_BASS_UI_OPTIONS).figures;

            let roman = '';
            let symbol = '';
            let isAug6Roman = false;

            const prevRoman = lastRomanBySystem.get(systemIndex) || '';
            const prevRootPc = lastChordRootPcBySystem.get(systemIndex);
            const prevType = lastChordTypeBySystem.get(systemIndex);

            try {
                // ── Diagnostic: dump analysisNotesForNaming before getRomanAnalysis ──
                if (_dbgEarly) {
                    console.log('[HT-DBG] analysisNotesForNaming at ab=' + event.absBeat + ':',
                        JSON.stringify((analysisNotesForNaming || []).map((n: any) => ({
                            midi: n?.midi, pitch: n?.pitch, noteIndex: n?.noteIndex,
                            acc: n?.accidental, explAcc: n?.explicitAccidental,
                            susp: !!(n as any)?.isSuspension, voice: n?.voice
                        }))));
                }
                const r = getRomanAnalysis(analysisNotesForNaming as any, contextTonic, contextIsMinor, { ornamentOverrides: ornOverrideRecord });
                if (r) {
                    roman = r.roman;
                    _dt('R0:getRoman', roman);
                    isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                }


                // Rescue: if naming-filter collapses a triad to a dyad, vii° can be a false positive.
                // Prefer the analysis of the fuller verticality when it yields a plausible dominant/tonic label.
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
                    const pcsNaming = pcCount(analysisNotesForNaming as any);
                    const pcsAnalysis = pcCount(analysisNotes as any);
                    const pcsFull = pcCount((fullNotes || []) as any);

                    if (rr0.startsWith('vii') && pcsNaming > 0 && pcsNaming < 3 && (pcsAnalysis >= 3 || pcsFull >= 3)) {
                        const alt1 = getRomanAnalysis(analysisNotes as any, contextTonic, contextIsMinor, { ornamentOverrides: ornOverrideRecord });
                        const alt2 = getRomanAnalysis((fullNotes || []) as any, contextTonic, contextIsMinor, { ornamentOverrides: ornOverrideRecord });
                        const isPlausible = (s: string) => s === 'V' || s === 'I' || s.startsWith('V/') || s.startsWith('I/');
                        const pick = [alt1, alt2].find(x => x?.roman && isPlausible(String(x.roman)));
                        if (pick?.roman) {
                            roman = String(pick.roman);
                            _dt('R1:viiRescue', roman, { pick: pick?.roman, rr0 });
                            isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+');
                        }
                    }
                } catch {
                    // ignore
                }

                // Rescue: secondary dominants (V/x) should stay visible even in inversions.
                // In some sparse/incomplete verticalities (common when voices are tied or filtered as NCT),
                // getRomanAnalysis can return null/empty, leaving only Arabic figures (6, 6/5, ...).
                // If chord candidates yield a confident V/x under the current context, prefer that label.
                try {
                    if (!roman) {
                        const candidates = identifyChordCandidates(analysisNotesForNaming as any);
                        let bestSecondary: { roman: string; score: number } | null = null;
                        for (const c of (candidates as any[]) || []) {
                            const rr = calculateRomanFromChordInfo({ root: c.root, type: c.type, intervals: c.intervals }, contextTonic, contextIsMinor);
                            if (!rr || !String(rr).startsWith('V/')) continue;
                            const score = Number.isFinite((c as any).score) ? Number((c as any).score) : 0;
                            if (!bestSecondary || score > bestSecondary.score) bestSecondary = { roman: rr, score };
                        }
                        if (bestSecondary) roman = bestSecondary.roman;
                        if (bestSecondary) _dt('R2:secDom', roman);
                    }
                } catch { /* ignore */ }

                const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
                // Symbols should reflect the actual verticality (including altered tones),
                // while roman/figures follow the structural snapshot.
                const s = getChordSymbol((fullNotes || []) as any, contextKeySignature, contextTonic);
                if (s) symbol = s;

                // Fallback for tonic minor-maj7: if symbol matches and roman is still empty, show I7.
                try {
                    if (!roman && symbol && contextIsMinor) {
                        const sym = String(symbol || '').replace('♯', '#').replace('♭', 'b');
                        if (/m\(maj7\)|mmaj7|minmaj7/i.test(sym)) {
                            const rootMatch = sym.match(/^([A-G])([#b]?)/);
                            const rootName = rootMatch ? `${rootMatch[1]}${rootMatch[2] || ''}` : '';
                            const rootPc = rootName ? noteNameToChromaticIndex(rootName) : null;
                            const tonicPc = contextTonic ? noteNameToChromaticIndex(contextTonic) : null;
                            if (rootPc != null && tonicPc != null && rootPc === tonicPc) {
                                roman = 'I7';
                                _dt('R3:I7', roman);
                            }
                        }
                    }
                } catch { /* ignore */ }

                // If the chord symbol explicitly indicates a slash (e.g. D7/F#),
                // prefer roman derived from the *symbol root*.
                // Under suspensions/ties, identifyChordCandidates can mis-root and collapse
                // into misleading labels like I4/7.
                try {
                    // (slash-root roman override removed)
                } catch { /* ignore */ }

            // If we only have a dyad (2 pitch classes), roman labeling is inherently ambiguous.
            // Prefer a diatonic bass-inferred label to avoid V/III misreads on power-chord shells
            // (e.g. C–G should read as I in C, A–E as vi).
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                const pcs = pcSetFromNotes(analysisNotes as any);
                if (!isSecondaryOrSlashRoman && bassPc != null && pcs.size <= 2) {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        roman = inferred.roman;
                        _dt('R4:dyadBass', roman, { bassPc, inferred: inferred?.roman });
                    }
                }
            } catch { /* ignore */ }

            // --- Shell continuation (appoggiature / sparse textures) ---
            // If the previous label is a diatonic triad (e.g. vi) and the current vertical
            // is just a sparse subset of that triad (often 2 PCs, because one chord tone is
            // momentarily missing), keep the previous Roman numeral and reflect the inversion
            // from the bass.
            // This prevents weak-beat shells like C–E over C from collapsing to I when the
            // intended harmony is still vi6 (A–C–E with A omitted).
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                const pcs = pcSetFromNotes(analysisNotes as any);
                const prevCtx = lastContextBySystem.get(systemIndex);
                const sameCtx = !prevCtx || (prevCtx.tonic === contextTonic && prevCtx.isMinor === contextIsMinor);
                if (!isSecondaryOrSlashRoman && prevRoman && bassPc != null && pcs.size > 0 && pcs.size <= 2 && sameCtx) {
                    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                    if (prevTriad) {
                        const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                            _dt('R5:shellCont', roman, { prevRoman, sameCtx });
                        }
                    }
                }
            } catch { /* ignore */ }

            // --- Diatonic shell/rootless inference (your "due accordi" policy) ---
            // This is a *fallback* only: use the bass to infer a diatonic triad when we
            // cannot confidently label the harmony. Do NOT override an existing roman label,
            // otherwise inversions start looking like "root=bass".
            try {
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                if (!isSecondaryOrSlashRoman && bassPc != null && !roman) {
                    const inferred = inferDiatonicRomanFromBass(bassPc, contextTonic, contextIsMinor);
                    if (inferred) {
                        const pcs = pcSetFromNotes(analysisNotes as any);
                        const triadSet = new Set<number>([inferred.triad.root, inferred.triad.third, inferred.triad.fifth]);
                        const pcsSubset = isSubset(pcs, triadSet);
                        // Allow very sparse sets (2 pcs) to still count as the triad.
                        if (pcsSubset && pcs.size > 0 && pcs.size <= 3) {
                            roman = inferred.roman;
                            _dt('R6:rootless', roman, { bassPc });
                        }
                    }
                }
            } catch { /* ignore */ }

            // --- Post-processing: infer inversions from the previous harmony when the bass moves
            // to a chord tone.
            try {
                const pcs = pcSetFromNotes(analysisNotes as any);
                const isSecondaryOrSlashRoman = typeof roman === 'string' && roman.includes('/');
                if (prevRoman && prevRootPc != null && prevType && bassPc != null && roman && roman !== prevRoman && !String(roman).includes('/')) {
                    const triad = triadPcsFromRootAndType(prevRootPc, prevType);
                    if (triad) {
                        const triadSet = new Set<number>([triad.root, triad.third, triad.fifth]);
                        // Current vertical may be rootless; allow subset of the triad.
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                            _dt('R7:postInvRoot', roman, { prevRoman, prevRootPc });
                        }
                    }
                }

                // If the previous chord is a *diatonic triad label* (I/ii/iii/IV/V/vi/vii° etc.)
                // keep that roman when the current vertical is a subset of its triad, even if the
                // bass alone would imply a different diatonic root (e.g. Am/C shell -> vi6, not I).
                const prevCtx2 = lastContextBySystem.get(systemIndex);
                const sameCtx2 = !prevCtx2 || (prevCtx2.tonic === contextTonic && prevCtx2.isMinor === contextIsMinor);
                if (sameCtx2 && prevRoman && bassPc != null && roman && roman !== prevRoman && !String(roman).includes('/')) {
                    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
                    if (prevTriad) {
                        const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
                        if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
                            roman = prevRoman;
                            _dt('R8:postInvDiat', roman, { prevRoman, sameCtx2 });
                        }
                    }
                }
            } catch (_) {
                // ignore
            }

            } catch (_) {
                // ignore
            }

            // Capture the most likely chord root/type for inversion inference on the next label.
            try {
                const candidates = identifyChordCandidates(analysisNotesForNaming || []);
                if (candidates && candidates.length) {
                    const chosen = candidates[0];
                    const rootPc = (chosen?.root?.noteIndex ?? null);
                    if (rootPc != null && Number.isFinite(rootPc)) lastChordRootPcBySystem.set(systemIndex, (((rootPc % 12) + 12) % 12));
                    if (chosen?.type) lastChordTypeBySystem.set(systemIndex, String(chosen.type));
                }
            } catch (_) {}

            if (roman) {
                lastRomanBySystem.set(systemIndex, roman);
                lastContextBySystem.set(systemIndex, { tonic: contextTonic, isMinor: contextIsMinor });
                lastFiguresBySystem.set(systemIndex, (figures || []).slice());
            }

            // If a suspension originates at this event, prefer showing the resolution's Roman
            // at the suspension onset and include the suspension type as figured label.
            try {
                // Determine if this event is the suspension onset using the explicit
                // `fromAbsBeat` field (connections are ambiguous with tied notes).
                const suspNotes = (analyzedNotes as any[] || []).filter((n: any) => {
                    const s = n?.isSuspension;
                    if (!s || typeof s.fromAbsBeat !== 'number') return false;
                    return Math.abs(s.fromAbsBeat - event.absBeat) < 1e-6;
                });

                if (suspNotes.length) {
                    const suspInfos = suspNotes
                        .map((sn: any) => ({
                            sn,
                            s: (sn as any)?.isSuspension,
                            type: String((sn as any)?.isSuspension?.type ?? ''),
                        }))
                        .filter((x: any) => !!x.s);
                    if (!suspInfos.length) return;

                    // Use one suspension as the Roman-resolution driver. For double suspensions,
                    // the resolution harmony should be the same.
                    const sForRoman = (suspInfos.find((x: any) => typeof x?.s?.resolvedById === 'string' && x.s.resolvedById) || suspInfos[0]).s;

                    const normalizeSuspNum = (num: number): number | null => {
                        try {
                            if (!Number.isFinite(num)) return null;
                            const n = Math.round(num);
                            if (n <= 0) return null;
                            return (((n - 1) % 7 + 7) % 7) + 1;
                        } catch {
                            return null;
                        }
                    };
                    const normalizeFigureString = (fig: string): string => {
                        const s = String(fig ?? '').trim();
                        if (!s) return s;
                        // Preserve special cases we intentionally show as compound figures.
                        // (9-8 suspensions are shown with a 9 at the onset, not 2.)
                        const m = s.match(/(\d+)/);
                        if (!m) return s;
                        const n = parseInt(m[1], 10);
                        if (!Number.isFinite(n) || n <= 0) return s;
                        if (n === 8 || n === 9) return s;
                        if (n > 9) {
                            const simple = (((n - 1) % 7 + 7) % 7) + 1;
                            return s.replace(m[1], String(simple));
                        }
                        return s;
                    };
                    const CLASSIC_TYPES = new Set(['4-3', '6-5', '7-6', '7-8', '8-7', '9-8', '2-3']);
                    const classicSuspInfos = suspInfos.filter((x: any) => CLASSIC_TYPES.has(String(x.type)));
                    const allSuspensionsClassic = classicSuspInfos.length > 0 && classicSuspInfos.length === suspInfos.length;
                    const hasNineEight = classicSuspInfos.some((x: any) => String(x.type) === '9-8');
                    const hasTwoThree = classicSuspInfos.some((x: any) => String(x.type) === '2-3');
                    // Prefer showing the Roman numeral of the *resolution harmony*.
                    // This matches traditional analysis where the dissonance is a
                    // non-chord tone against the new chord, and aligns with how we
                    // label other suspensions/ritardi.
                    let resolvedRoman: string | null = null;
                    let resEvForSusp: any | null = null;
                    try {
                        if (sForRoman && typeof sForRoman.resolvedById === 'string' && sForRoman.resolvedById) {
                            const resEv = (timeline || [])
                                .filter((ev: any) => typeof ev?.absBeat === 'number' && ev.absBeat >= event.absBeat - 1e-6)
                                .find((ev: any) => (ev?.notes || []).some((nn: any) => nn?.id === sForRoman.resolvedById));
                            if (resEv) {
                                resEvForSusp = resEv;
                                const ctxRes = ctxAtAbsBeat(resEv.absBeat);
                                const tonicRes = ctxRes ? ctxRes.newTonic : contextTonic;
                                const isMinorRes = ctxRes ? ctxRes.newIsMinor : contextIsMinor;
                                const rRes = getRomanAnalysis(resEv.notes || [], tonicRes, isMinorRes, { ornamentOverrides: ornOverrideRecord });
                                if (rRes?.roman) resolvedRoman = rRes.roman;
                            }
                        }
                    } catch (_) {}

                    // IMPORTANT: `analysisNotes` already excludes the suspended note at this beat,
                    // so `roman` computed earlier is typically the correct *resolution harmony*.
                    // However, in some double-suspension / incomplete voicings the onset can be
                    // mis-read as a diatonic triad (e.g. iii) even though the resolution harmony
                    // is a clear dominant/secondary dominant (e.g. V/vi). In that case, prefer
                    // the resolution-event Roman at the suspension onset.
                    {
                        const onsetRoman = String(roman || '').trim();
                        const resRoman = String(resolvedRoman || '').trim();
                        const isDominantish = (r: string) => r === 'V' || r.startsWith('V/');
                        const isPlainDiatonic = (r: string) => !!r && !r.includes('/') && !r.includes('It+') && !r.includes('Fr+') && !r.includes('Ger+');

                        // Guard: don't override a plain diatonic roman with the resolution's
                        // dominant when the onset analysisNotes already form a full triad
                        // (3+ distinct pitch classes). The R9 heuristic is meant for sparse
                        // voicings where the suspending note removal collapses the chord to a
                        // misleading dyad (e.g. iii instead of V). A complete triad like iv
                        // should never be replaced by V just because the next beat is V.
                        const onsetPcCount = new Set((analysisNotes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi)).map((n: any) => ((n.midi % 12) + 12) % 12)).size;

                        if ((!onsetRoman && resRoman) || (isPlainDiatonic(onsetRoman) && isDominantish(resRoman) && resRoman !== onsetRoman && onsetPcCount < 3)) {
                            roman = resRoman;
                            _dt('R9:domRes', roman, { resRoman });
                        }
                        if (!roman) {
                            // Fallback: underlying harmony at suspension onset.
                            const rHere = getRomanAnalysis(analysisNotes as any, contextTonic, contextIsMinor, { ornamentOverrides: ornOverrideRecord });
                            if (rHere) roman = rHere.roman || roman;
                        }
                    }

                    // In very sparse textures (e.g. G–E with the suspension filtered out),
                    // the chord-ID can flip to iii even though the intended harmony is V.
                    // Stabilize by preferring a resolution-event chord candidate that matches
                    // the bass pitch-class, and as a last resort force V over dominant bass.
                    try {
                        // Don't clobber secondary dominants (V/x) with sparse-texture heuristics.
                        if (String(roman).includes('/')) {
                            // keep as-is
                        } else {
                        const evForRoman = (resEvForSusp || event) as any;
                        const evNotes = (evForRoman?.notes || []) as any[];
                        const bassNote = evNotes.slice().sort((x, y) => (x?.midi ?? 0) - (y?.midi ?? 0))[0];
                        const bassPc = (bassNote && Number.isFinite(bassNote.midi)) ? ((bassNote.midi % 12) + 12) % 12 : null;
                        const ctxHere = ctxAtAbsBeat(evForRoman?.absBeat ?? event.absBeat);
                        const tonicHere = ctxHere ? ctxHere.newTonic : contextTonic;
                        const isMinorHere = ctxHere ? ctxHere.newIsMinor : contextIsMinor;

                        const candidates = identifyChordCandidates(evNotes);
                        if (candidates && candidates.length) {
                            // If we already have a Roman label, prefer the chord candidate that
                            // agrees with it (important for inversions like ii6 over Ab bass).
                            let preferred: any = candidates[0];
                            try {
                                const curRoman = String(roman || '').trim();
                                if (curRoman) {
                                    const matching = (candidates as any[]).find((c: any) => {
                                        const rr = calculateRomanFromChordInfo({ root: c.root, type: c.type, intervals: c.intervals }, tonicHere, isMinorHere);
                                        return rr === curRoman;
                                    });
                                    if (matching) preferred = matching;
                                } else if (bassPc != null) {
                                    preferred = (candidates as any[]).find(c => (c?.root?.noteIndex ?? null) === bassPc) || candidates[0];
                                }
                            } catch { /* ignore */ }

                            const forced = preferred
                                ? calculateRomanFromChordInfo({ root: preferred.root, type: preferred.type, intervals: preferred.intervals }, tonicHere, isMinorHere)
                                : null;
                            if (forced && !roman) { roman = forced; _dt('R11:sparseRescue', roman); }
                        }
                        }
                    } catch (_) {}

                    // Figures policy:
                    // - Classic suspensions (4-3/6-5/7-6/9-8): show the suspension figure(s) next to the Roman
                    //   (e.g. V4/5, V6), and show only the resolution number at the end of the hold-line.
                    // - Non-classic ritardi (e.g. bass retardation): prefer vertical figures computed on the
                    //   full sounding set at the onset.
                    if (allSuspensionsClassic) {
                        try {
                            // Compute onset figures from the *structural* notes at this event (including the held tone),
                            // otherwise we risk getting a sanitized chord that hides the suspension.
                            const onsetFigures = (computeFiguredBassFromNotes((harmonicNotes || []) as any, FIGURED_BASS_UI_OPTIONS).figures || figures || [])
                                .map(normalizeFigureString);

                            // Ensure the suspension-from figure(s) are present (double suspensions => multiple)
                            const fromWanteds = classicSuspInfos
                                .map((x: any) => {
                                    const suspType = String(x.type ?? '');
                                    if (suspType === '4-3') return 4;
                                    if (suspType === '6-5') return 6;
                                    if (suspType === '7-6') return 7;
                                    if (suspType === '7-8') return 7;
                                    if (suspType === '8-7') return 8;
                                    if (suspType === '9-8') return 9;
                                    if (suspType === '2-3') return 2;
                                    return normalizeSuspNum(Number((x.s as any)?.fromNum));
                                })
                                .filter((n: any) => n != null);

                            const out: string[] = [];
                            const push = (x: string) => { if (x && !out.includes(x)) out.push(x); };
                            // Keep any onset figures (e.g., the 5 in a 4-3 over V)
                            onsetFigures.forEach(push);
                            fromWanteds.forEach((n: any) => push(String(n)));

                            // Special case: double suspension 9-8 + 4-3.
                            // For didactic alignment, drop the plain '5' (otherwise the onset figures
                            // can look visually "crossed" relative to the 8/3 resolution stack).
                            const isDoubleNineFour =
                                classicSuspInfos.length === 2 &&
                                hasNineEight &&
                                classicSuspInfos.some((x: any) => String(x.type) === '4-3');
                            if (isDoubleNineFour) {
                                for (let i = out.length - 1; i >= 0; i--) {
                                    if (out[i] === '5') out.splice(i, 1);
                                }
                            }
                            // Pedagogical convention: if a 9-8 suspension is present, prefer 9 over 2.
                            // (2 is the simple form of 9, but here we explicitly want 9 because it resolves to 8.)
                            if (hasNineEight && out.includes('9')) {
                                for (let i = out.length - 1; i >= 0; i--) {
                                    if (out[i] === '2') out.splice(i, 1);
                                }
                            }

                            // Conversely, for a 2-3 ascending ritardo, prefer 2 over 9.
                            // (We only prefer 9 in the specific 9-8 suspension convention.)
                            if (hasTwoThree && out.includes('2')) {
                                for (let i = out.length - 1; i >= 0; i--) {
                                    if (out[i] === '9') out.splice(i, 1);
                                }
                            }
                            // In double suspensions, order figures so the higher suspension-from figure
                            // appears above the lower one (avoids visual crossing like 9__3 / 4__8).
                            if (classicSuspInfos.length > 1) {
                                const extractNum = (t: string) => {
                                    const m = String(t || '').match(/(\d+)/);
                                    const n = m ? Number(m[1]) : Number.NaN;
                                    return Number.isFinite(n) ? n : Number.NaN;
                                };
                                figures = out.slice().sort((a, b) => {
                                    const an = extractNum(a);
                                    const bn = extractNum(b);
                                    const aa = Number.isFinite(an) ? an : -Infinity;
                                    const bb = Number.isFinite(bn) ? bn : -Infinity;
                                    return bb - aa;
                                });
                            } else {
                                figures = out;
                            }
                        } catch (_) {
                            figures = (figures || []).map(normalizeFigureString);
                        }
                    } else {
                        try {
                            const fullFigures = computeFiguredBassFromNotes((fullNotes || []) as any, FIGURED_BASS_UI_OPTIONS).figures;
                            if (fullFigures?.length) figures = fullFigures;
                            figures = (figures || []).map(normalizeFigureString);
                        } catch (_) {
                            figures = (figures || []).map(normalizeFigureString);
                        }
                    }
                }
            } catch (_) {}

            // If this event is the resolution target of a *classic* suspension (4-3/7-6/9-8),
            // suppress the harmony label here to avoid duplicate Roman numerals colliding with
            // the resolution-number glyph we draw near the resolved note.
            //
            // IMPORTANT: keep the Roman numeral at the resolution for non-classic cases
            // (e.g., the 2/4 ritardo we labeled with a resolving chord like ii).
            try {
                const CLASSIC_TYPES = new Set(['4-3', '6-5', '7-6', '7-8', '8-7', '9-8', '2-3']);

                const isSuspensionOnsetHere = (analyzedNotes as any[] || []).some((n: any) => {
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
                    if (!isSuspensionOnsetHere && hasClassic && !hasNonClassic) {
                        // Only suppress if the harmony is unchanged (avoid hiding a real change).
                        const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                        const isMinorMajor7 = (() => {
                            const sym = String(symbol || '').replace('♯', '#').replace('♭', 'b');
                            return /m\(maj7\)|mmaj7|minmaj7/i.test(sym);
                        })();
                        // Never clear a secondary dominant (V/x) or other slash-roman:
                        // these represent real harmonic information, not a suspension artifact.
                        const isSlashRoman = typeof roman === 'string' && roman.includes('/');
                        if ((!roman || roman === prevRoman) && !isMinorMajor7 && !isSlashRoman) {
                            roman = '';
                            _dt('R10:suspDedup', roman, { prevRoman });
                            figures = [];
                            symbol = '';
                        }
                    }
                }
            } catch (_) {}

            // --- Rescue: secondary dominants from explicit chord symbol ---
            // In some cases (especially when ties/suspensions make the vertical set "dirty"),
            // the chord-ID can collapse into something like I with odd figures (e.g. 4 + 7),
            // even though the chord symbol is clearly a dominant seventh (e.g. D7 => V7/V in C).
            // Prefer the dominant-based roman when the symbol is unambiguous.
            try {
                const symRaw = String(symbol || '');
                const sym = symRaw.replace('♯', '#').replace('♭', 'b');
                // For functional inference we only care about the chord's root/quality;
                // if the symbol includes a slash bass (inversion), keep only the part before '/'.
                const symForFunction = sym.split('/')[0] || sym;

                const isDominantSymbol = (() => {
                    if (!symForFunction) return false;
                    if (/maj7/i.test(symForFunction)) return false;
                    if (/m7/i.test(symForFunction)) return false;
                    if (symForFunction.includes('°') || /dim7/i.test(symForFunction)) return false;
                    // IMPORTANT: do not treat "add9"/"sus" sonorities as dominants.
                    // Otherwise a plain tonic add9 like C–E–G–D becomes C7 => V/IV.
                    if (/add/i.test(symForFunction)) return false;
                    if (/sus/i.test(symForFunction)) return false;

                    // Dominant-type spellings in this app: "7", "7b9", "7#9", "11", "13", etc.
                    // - If it explicitly contains '7' (and isn't maj7/m7/dim7), treat as dominant.
                    // - If it contains 9/11/13 without 'maj' or 'm', treat as dominant shorthand (e.g. "C9").
                    if (/7/.test(symForFunction)) return true;
                    if (/(9|11|13)/.test(symForFunction) && !/maj/i.test(symForFunction) && !/\bm\b/i.test(symForFunction) && !/m(?!aj)/i.test(symForFunction)) {
                        return true;
                    }
                    return false;
                })();

                const looksLikeI47 = (() => {
                    const figs = (figures || []).map(f => String(f));
                    return String(roman || '') === 'I' && figs.includes('4') && figs.includes('7');
                })();

                if (isDominantSymbol && !String(roman || '').includes('/') && (looksLikeI47 || String(roman || '') === 'I')) {
                    const m = symForFunction.match(/^([A-G])([#b]?)/);
                    if (m) {
                        const rootName = `${m[1]}${m[2] || ''}`;
                        const rootPc = noteNameToChromaticIndex(rootName);
                        if (rootPc != null && rootPc >= 0) {
                            const virtualRootMidi = 60 + (((rootPc % 12) + 12) % 12);
                            const virtualRoot = ({ id: 'virtual-root', pitch: 'C', octave: 4, position: 0, midi: virtualRootMidi, noteIndex: rootPc } as any);
                            const forced = calculateRomanFromChordInfo({ root: virtualRoot, type: 'Dominant 7' }, contextTonic, contextIsMinor);
                            if (forced && String(forced).includes('/')) {
                                roman = forced;
                            }
                        }
                    }
                }
            } catch { /* ignore */ }

            // Auto (analysis) overrides: label-only tonicization. Never beats a user override.
            // Guard: never let auto tonicization replace a tonic chord (I/i) — the tonic
            // label is too important to be overwritten by a lookahead heuristic.
            try {
                const a = qAbs(event.absBeat);
                if (!overrideByAbsBeat.has(a)) {
                    const auto = getNear(autoOverrideByAbsBeat, a);
                    if (auto) {
                        const isCurrentlyTonic = roman === 'I' || roman === 'i';
                        if (!isCurrentlyTonic) {
                            if (auto.roman !== undefined) { roman = auto.roman; _dt('R12:autoOvr', roman); }
                            if (auto.symbol !== undefined) symbol = auto.symbol;
                            if (auto.figures !== undefined) figures = auto.figures;
                        }
                    }
                }
            } catch { /* ignore */ }

            // User overrides: allow forcing Roman/figures/symbol at this absBeat.
            try {
                const ov = overrideByAbsBeat.get(qAbs(event.absBeat));
                if (ov) {
                    if (ov.roman !== undefined) { roman = ov.roman; _dt('R13:manualOvr', roman); }
                    if (ov.symbol !== undefined) symbol = ov.symbol;
                    if (ov.figures !== undefined) figures = ov.figures;
                }
            } catch { /* ignore */ }

            // Final rescue: if we still ended up with vii° but the *unfiltered* verticality spells the
            // dominant major triad in the current key, prefer V.
            try {
                const rr = String(roman || '');
                if (rr.startsWith('vii')) {
                    const tonicPc = noteNameToChromaticIndex(contextTonic);
                    if (tonicPc != null && tonicPc >= 0) {
                        const domPc = (((tonicPc + 7) % 12) + 12) % 12;
                        const domTriad = new Set<number>([domPc, (domPc + 4) % 12, (domPc + 7) % 12]);
                        const pcs = new Set<number>();
                        for (const n of (fullNotes || []) as any[]) {
                            if (!n || n.isRest) continue;
                            const ni = Number((n as any).noteIndex);
                            const mi = Number((n as any).midi);
                            const pc = Number.isFinite(ni) ? (((ni % 12) + 12) % 12) : Number.isFinite(mi) ? (((mi % 12) + 12) % 12) : null;
                            if (pc == null) continue;
                            pcs.add(pc);
                        }
                        const matchesDom = pcs.size >= 3 && [...domTriad].every(x => pcs.has(x));
                        // Do not override a confident tonic label (I/i) to V.
                        // This prevents cadential barlines (e.g. Db→Gb in Gb major) from being displayed as V
                        // just because dominant chord tones may still be present in the full verticality.
                        if (matchesDom && !(roman === 'I' || roman === 'i')) roman = 'V';
                    }
                }
            } catch { /* ignore */ }

            // ── R14: Statistical corpus bias ──
            // When useStatisticalCorrection is on and two chord candidates are close in score,
            // use bigram probability P(roman | prevRoman) to prefer the more likely progression.
            try {
                if (useStatisticalCorrection && styleProfile?.romanBigrams && prevRoman && roman) {
                    const threshold = Number(statisticalBiasThreshold) || 2;
                    const candNotes = (analysisNotesForNaming && analysisNotesForNaming.length >= 2)
                        ? analysisNotesForNaming : (analysisNotes && analysisNotes.length >= 2 ? analysisNotes : null);
                    if (candNotes) {
                        const allCands = identifyChordCandidates(candNotes as any);
                        if (Array.isArray(allCands) && allCands.length >= 2) {
                            const c0 = allCands[0] as any;
                            const c1 = allCands[1] as any;
                            const scoreDiff = (c0.score ?? 0) - (c1.score ?? 0);
                            if (scoreDiff < threshold && c1.root && c1.type) {
                                const altRoman = calculateRomanFromChordInfo(
                                    { root: c1.root, type: c1.type, intervals: c1.intervals },
                                    contextTonic, contextIsMinor,
                                );
                                if (altRoman && altRoman !== roman) {
                                    const pCurr = getBigramProbability(styleProfile, prevRoman, roman);
                                    const pAlt = getBigramProbability(styleProfile, prevRoman, altRoman);
                                    if (pAlt > pCurr * 1.5 && pAlt > 0.05) {
                                        roman = altRoman;
                                        _dt('R14:corpusBias', roman, { prevRoman, pCurr, pAlt, scoreDiff });
                                    }
                                }
                            }
                        }
                    }
                }
            } catch { /* ignore */ }

            // Display-only: when we are in a tonicization/modulation context, show pivot tonics as `I=V`.
            // This keeps the analysis context in the new key (so following chords aren't distorted),
            // while still showing the functional relation to the global key.
            let romanDisplay: string | undefined = undefined;

            // Display-only (label-only tonicization): show resolution pivot as i=ii, I=V, etc.
            // Guard: never replace a tonic label (I/i) with an auto display override.
            try {
                const a = qAbs(event.absBeat);
                const isCurrentlyTonicForDisp = roman === 'I' || roman === 'i';
                if (!overrideByAbsBeat.has(a)) {
                    const autoDisp = getNear(autoRomanDisplayByAbsBeat, a);
                    if (autoDisp) {
                        const s = String(autoDisp || '');
                        // Never replace a tonic label (I/i) — the tonic chord is not
                        // a secondary function; it should always show as I.
                        if (!isCurrentlyTonicForDisp) {
                            // Don't override dominant (V) with bare tonic (I)
                            // from tautological tonicization (e.g. F# maj = I in F#)
                            const _isDom = /^V($|[0-9°+])/.test(roman);
                            const _isBareI = /^[Ii]$/.test(s);
                            if (!_isDom || !_isBareI) {
                                romanDisplay = s;
                                _dt('D1:cadPivot', String(romanDisplay));
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
            try {
                const inNonGlobalContext = !!(applicableContext && (contextTonic !== currentTonic || contextIsMinor !== isMinorMode));
                const localRoman = String(roman || '');
                const localIsTonic = localRoman === 'I' || localRoman === 'i';
                if (inNonGlobalContext && localIsTonic) {
                    const global = getRomanAnalysis((analysisNotesForNaming || []) as any, currentTonic, isMinorMode, { ornamentOverrides: ornOverrideRecord });
                    const globalRoman = String(global?.roman || '');
                    if (globalRoman && globalRoman !== localRoman) {
                        // Common/pedagogical: show I=V on dominant-key pivot.
                        if (globalRoman === 'V' || globalRoman.startsWith('V/')) {
                            romanDisplay = `${localRoman}=${globalRoman}`;
                            _dt('D2:nonGlobalPivot', String(romanDisplay));
                        }
                    }
                }
            } catch { /* ignore */ }

            if (!roman && !symbol && !(figures && figures.length)) return;

            // ── User-ornament beat suppression ──
            // If the ONLY new onset notes at this beat are user-overridden ornaments,
            // suppress the visible label.  Emit a hiddenMarker instead so the
            // hold-line renderer can still show continuity from the previous label.
            try {
                if (ornOverrideMap.size > 0) {
                    // Onset notes = notes whose attack beat matches this event
                    const onsetNotes = (fullNotes || []).filter((n: any) => {
                        if (!n || n.isRest) return false;
                        // A note is an "onset" here if its own beat matches this event's beat
                        const nb = Number(n.beat);
                        const eb = Number(event.beat ?? event.absBeat);
                        return Number.isFinite(nb) && Number.isFinite(eb) && Math.abs(nb - eb) < 0.01;
                    });
                    if (onsetNotes.length > 0) {
                        const allUserOrn = onsetNotes.every((n: any) => {
                            if (n.ornamentOverride && n.ornamentOverride !== 'structural') return true;
                            const ov1 = ornOverrideMap.get(n.id);
                            if (ov1 && ov1 !== 'structural') return true;
                            const midi = Number(n.midi);
                            if (Number.isFinite(midi)) {
                                const ck = `${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`;
                                const ov2 = ornOverrideMap.get(ck);
                                if (ov2 && ov2 !== 'structural') return true;
                            }
                            return false;
                        });
                        if (allUserOrn) {
                            // Don't suppress if user has a harmony override at this beat
                            const ov = overrideByAbsBeat.get(qAbs(event.absBeat));
                            if (!ov) {
                            const prevR = lastRomanBySystem.get(systemIndex) || '';
                            if (prevR) {
                                const xh = getXForAbsBeat(event.absBeat, system);
                                labelsBySystem[systemIndex].push({
                                    id: `hlabel-hidden-ornoverride-${systemIndex}-${event.absBeat}`,
                                    x: xh,
                                    roman: prevR,
                                    figures: lastFiguresBySystem.get(systemIndex) || [],
                                    symbol: '',
                                    absBeat: event.absBeat,
                                    hiddenMarker: true,
                                });
                            }
                            return;
                            }
                        }
                    }
                }
            } catch { /* ignore */ }

            // Anchor label to the current timeline event's beat (not just the note's attack)
            const x = getXForAbsBeat(event.absBeat, system);



            // ── Diagnostic dump ──────────────────────────────────────────────
            if (_dbg && _tr.length) {
                console.groupCollapsed(
                    `[HT-DEBUG] beat ${event.absBeat} → roman="${roman}" display="${romanDisplay ?? ''}" ctx=${contextTonic}${contextIsMinor ? 'm' : ''}`
                );
                console.table(_tr);
                console.log({ contextTonic, contextIsMinor, bassPc, prevRoman, appCtx: applicableContext?.newTonic });
                console.groupEnd();
            }
            // ─────────────────────────────────────────────────────────────────

            labelsBySystem[systemIndex].push({
                id: `hlabel-${systemIndex}-${event.absBeat}`,
                x,
                roman,
                romanDisplay,
                figures,
                symbol,
                absBeat: event.absBeat,
                isOverride: overrideByAbsBeat.has(qAbs(event.absBeat)),
                pcsSig: signatureFromNotes((fullNotes || []) as any),
            });
        });

        // Sort labels in each system by x
        labelsBySystem.forEach(systemLabels => systemLabels.sort((a, b) => a.x - b.x));

        return labelsBySystem;
    }, [analysisContextAbsBeat, analysisContexts, analyzedNotes, compactTonicization, currentTonic, harmonyOverrides, isAnalysisEnabled, isMinorMode, layoutData, minSpanBeats, ornOverrideMap, ornOverrideRecord, statisticalBiasThreshold, styleProfile, timeSignature, useStatisticalCorrection]);

    // Detect simple harmonic progressions (sequenze) where a 2-measure motif repeats.
    // This is intentionally conservative: it looks for repeated *functional shapes* rather than
    // exact roman equality (e.g. I…V/ii repeating as ii…V/bIII).
    const progressionMarkersBySystem = useMemo(() => {
        if (!layoutData) return [] as Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>>;
        if (!isSequencesEnabled) return [] as Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>>;

        const beatsPerMeasureBase = timeSignature.numerator * (4 / timeSignature.denominator);
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!Number.isFinite(ab)) return 0;
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) {
                return Math.floor(ab / beatsPerMeasureBase);
            }
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const parseRoman = (r0: string): { main: string; secondary: string | null; trailing: string } => {
            // Robust Roman parser for formats like:
            // - V6, I64
            // - V/ii
            // - V6/ii, V65/ii
            // - V/ii6
            // We normalize accidentals (b/#) so matching is stable.
            const raw = String(r0 || '').trim();
            const normalizeGlyphs = (s: string) => s
                .replace(/♭/g, 'b')
                .replace(/♯/g, '#')
                .replace(/𝄫/g, 'bb')
                .replace(/𝄪/g, '##');
            const r = normalizeGlyphs(raw);

            const parts = r.split('/');
            const left = String(parts[0] || '').trim();
            const right = parts.length > 1 ? String(parts[1] || '').trim() : '';

            const splitRomanAndDigits = (seg: string): { roman: string; digits: string; rest: string } => {
                const m = seg.match(/^([ivIV°+ø#b]+)(\d*)(.*)$/);
                if (!m) return { roman: seg, digits: '', rest: '' };
                return { roman: String(m[1] || ''), digits: String(m[2] || ''), rest: String(m[3] || '') };
            };

            const l = splitRomanAndDigits(left);
            const r2 = right ? splitRomanAndDigits(right) : { roman: '', digits: '', rest: '' };

            // Anything after the roman+digits on either side is treated as trailing too.
            const trailing = `${l.digits || ''}${r2.digits || ''}${l.rest || ''}${r2.rest || ''}`.trim();
            const main = String(l.roman || '').trim();
            const secondary = r2.roman ? String(r2.roman).trim() : null;
            return { main, secondary: secondary || null, trailing };
        };
        const normFigures = (figs: any): string => {
            try {
                if (!Array.isArray(figs)) return '';
                return figs.map((x: any) => String(x)).filter(Boolean).join('');
            } catch {
                return '';
            }
        };

        type HarmonyEv = { absBeat: number; measureIndex: number; roman: string; figuresKey: string };
        const events: HarmonyEv[] = [];
        if (isAnalysisEnabled) {
            try {
                (harmonyLabelsBySystem || []).forEach((arr: any[]) => {
                    (arr || []).forEach((lbl: any) => {
                        const absBeat = Number(lbl?.absBeat);
                        const roman = String(lbl?.roman ?? '');
                        if (!Number.isFinite(absBeat) || !roman) return;
                        if (lbl?.hiddenMarker) return;
                        events.push({
                            absBeat,
                            measureIndex: findMeasureIndexForAbsBeat(absBeat),
                            roman,
                            figuresKey: normFigures(lbl?.figures),
                        });
                    });
                });
            } catch { /* ignore */ }
        }

        // Fallback: if the label pipeline produced zero harmony labels (events=0) but analysis is enabled,
        // compute a minimal roman timeline by sampling 3 structural points per measure.
        // This avoids false negatives caused by label-suppression heuristics.
        let usedFallback = false;
        if (isAnalysisEnabled && events.length === 0) {
            try {
                const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges);
                const ctxAtAbsBeatLocal = (absBeat: number) => (analysisContexts || [])
                    .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
                    .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

                const measuresInScore = (() => {
                    const s = new Set<number>();
                    (layoutData.positionedNotes || []).forEach((n: any) => {
                        const mi = Number(n?.measureIndex);
                        if (Number.isFinite(mi)) s.add(mi);
                    });
                    return Array.from(s).sort((a, b) => a - b);
                })();

                // Walk timeline once; for each sample absBeat, pick last event <= sample.
                const getNotesAt = (absBeat: number): any[] => {
                    try {
                        let best: any = null;
                        for (const ev of (timeline || [])) {
                            if (!ev || typeof ev.absBeat !== 'number') continue;
                            if (ev.absBeat <= absBeat + 1e-6) best = ev;
                            else break;
                        }
                        return (best?.notes || []) as any[];
                    } catch {
                        return [];
                    }
                };

                for (const m of measuresInScore) {
                    const start = (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number')
                        ? (measureStartAbsBeat[m] as number)
                        : (m * beatsPerMeasureBase);
                    const bpm = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number')
                        ? Math.max(1, Number(measureBeatsPerMeasure[m]))
                        : Math.max(1, beatsPerMeasureBase);

                    const sampleAbs = [0, 1 / 3, 2 / 3].map(fr => start + fr * bpm);
                    for (const a of sampleAbs) {
                        const notesHere = getNotesAt(a);
                        if (!notesHere || notesHere.length < 2) continue;
                        const ctx = ctxAtAbsBeatLocal(a);
                        const tonic = (ctx?.newTonic || currentTonic) as any;
                        const isMinor = typeof ctx?.newIsMinor === 'boolean' ? ctx.newIsMinor : isMinorMode;
                        const r = getRomanAnalysis(notesHere as any, tonic, isMinor, { ornamentOverrides: ornOverrideRecord });
                        const roman = String(r?.roman || '').trim();
                        if (!roman) continue;
                        events.push({ absBeat: a, measureIndex: m, roman, figuresKey: Array.isArray(r?.figures) ? r!.figures.join('') : '' });
                        usedFallback = true;
                    }
                }
            } catch { /* ignore */ }
        }

        const byMeasure = new Map<number, HarmonyEv[]>();
        if (events.length) {
            for (const ev of events) {
                if (!byMeasure.has(ev.measureIndex)) byMeasure.set(ev.measureIndex, []);
                byMeasure.get(ev.measureIndex)!.push(ev);
            }
            for (const [m, arr] of byMeasure.entries()) {
                arr.sort((a, b) => a.absBeat - b.absBeat);
                byMeasure.set(m, arr);
            }
        }

        const maxMeasureIndex = (() => {
            try {
                const xs = (layoutData?.systemsParams || []).flatMap((s: any) => Array.isArray(s?.measureIndices) ? s.measureIndices : []);
                const maxFromSystems = xs.length ? Math.max(...xs) : 0;
                const maxFromNotes = Math.max(0, ...((layoutData?.positionedNotes || []) as any[])
                    .map(n => Number(n?.measureIndex))
                    .filter(v => Number.isFinite(v)) as number[]);
                return Math.max(maxFromSystems, maxFromNotes);
            } catch {
                return 0;
            }
        })();

        const measureIndices = Array.from({ length: Math.max(0, maxMeasureIndex) + 1 }, (_, i) => i);

        const measureTokenSeq = (m: number): Array<{ main: string; secondary: string | null; fig: string }> => {
            const arr = (byMeasure.get(m) || []).slice();
            if (!arr.length) return [];

            // Normalize within a measure: many pieces have 3 functional snapshots per bar,
            // but the analyzer may emit extra labels (ornaments, releases on strong points, etc.).
            // Bucket events into 3 equal slices of the measure and pick the first per bucket.
            const start = (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number')
                ? (measureStartAbsBeat[m] as number)
                : (m * beatsPerMeasureBase);
            const bpm = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number')
                ? Math.max(1, Number(measureBeatsPerMeasure[m]))
                : Math.max(1, beatsPerMeasureBase);

            arr.sort((a, b) => a.absBeat - b.absBeat);

            // Bucket to exactly 3 slots (0,1,2). Fill gaps with nearest previous/next so
            // the signature length stays stable across blocks.
            const bucketEv: Array<HarmonyEv | null> = [null, null, null];
            for (const ev of arr) {
                const rel = (ev.absBeat - start) / bpm;
                const bucket = Math.max(0, Math.min(2, Math.floor(rel * 3)));
                if (!bucketEv[bucket]) bucketEv[bucket] = ev;
            }

            // Fill forward from previous
            for (let i = 0; i < 3; i++) {
                if (!bucketEv[i] && i > 0) bucketEv[i] = bucketEv[i - 1];
            }
            // Fill backward from next
            for (let i = 2; i >= 0; i--) {
                if (!bucketEv[i] && i < 2) bucketEv[i] = bucketEv[i + 1];
            }
            // If still empty (shouldn't), bail.
            if (!bucketEv[0] && !bucketEv[1] && !bucketEv[2]) return [];

            const tokens = bucketEv
                .filter(Boolean)
                .map((ev) => {
                    const p = parseRoman((ev as HarmonyEv).roman);
                    const fig = `${(ev as HarmonyEv).figuresKey || ''}${p.trailing || ''}`;
                    return { main: p.main, secondary: p.secondary, fig };
                });

            // Keep 3 slots, but collapse exact duplicates to avoid "T,T,T" noise.
            const out: Array<{ main: string; secondary: string | null; fig: string }> = [];
            for (const t of tokens) {
                const prev = out[out.length - 1];
                if (prev && prev.main === t.main && prev.secondary === t.secondary) continue;
                out.push(t);
            }
            return out;
        };

        const isDominantFunction = (t: { main: string; secondary: string | null; fig: string }): boolean => {
            try {
                const main = String(t?.main || '').trim();
                if (!main) return false;
                // Treat V and vii° (and common ascii variants like "viio") as dominant-function.
                if (main === 'V' || main === 'v') return true;
                if (/^vii/i.test(main)) return true;
            } catch { /* ignore */ }
            return false;
        };

        const measureRoleSeq = (m: number): string[] => {
            const toks = measureTokenSeq(m);
            if (!toks.length) return [];

            // Convert 3-slot-ish tokens to roles for matching. We want to recognize
            // the Dubois consonant progression shape X–D–X even when X changes (I, ii, iii...).
            const roles: string[] = toks.map(t => {
                if (isDominantFunction(t)) return 'D';
                if (t.secondary && String(t.main || '').toUpperCase() === 'V') return 'Dsec';
                return `${t.main}${t.secondary ? '/' + t.secondary : ''}`;
            });

            // If first and last are the same non-dominant harmony, collapse to X ... X.
            // This makes I–V–I and ii–V–ii comparable.
            if (roles.length >= 3) {
                const first = roles[0];
                const last = roles[roles.length - 1];
                if (first === last && first !== 'D' && first !== 'Dsec') {
                    roles[0] = 'X';
                    roles[roles.length - 1] = 'X';
                }
                // Also collapse any remaining non-dominant degrees to X if we have X endpoints.
                // This avoids mismatches like X,D,IV for ornaments.
                if (roles[0] === 'X' && roles[roles.length - 1] === 'X') {
                    for (let i = 1; i < roles.length - 1; i++) {
                        if (roles[i] !== 'D' && roles[i] !== 'Dsec') roles[i] = 'Xmid';
                    }
                }
            }
            return roles;
        };

        const blockSignature = (mStart: number): string => {
            const a0 = measureRoleSeq(mStart);
            const a1 = measureRoleSeq(mStart + 1);
            if (!a0.length || !a1.length) return '';
            return `${a0.join(',')}|${a1.join(',')}`;
        };

        const spans: Array<{ startMeasure: number; endMeasure: number; repeats?: number; source: 'auto' | 'annotated' | 'note' }> = [];

        // ---------------------------------------------------------
        // NOTE-MOTION detector (voice-leading pattern repetition)
        // ---------------------------------------------------------
        // Detect a 2-measure "motif" repeating in the next 2 measures by comparing
        // interval patterns on the bass and soprano lines (and their vertical interval).
        // This is designed to work even when Roman labels are unstable.
        try {
            const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges);
            const absBeats = (timeline || []).map(ev => Number(ev?.absBeat)).filter(Number.isFinite) as number[];

            const getNotesAtAbsBeat = (absBeat: number): any[] => {
                try {
                    if (!timeline?.length) return [];
                    // binary search: last event <= absBeat
                    let lo = 0;
                    let hi = absBeats.length - 1;
                    let best = 0;
                    while (lo <= hi) {
                        const mid = (lo + hi) >> 1;
                        const v = absBeats[mid];
                        if (v <= absBeat + 1e-6) {
                            best = mid;
                            lo = mid + 1;
                        } else {
                            hi = mid - 1;
                        }
                    }
                    const ev: any = (timeline as any[])[best];
                    return (ev?.notes || []) as any[];
                } catch {
                    return [];
                }
            };

            const midiForVoice = (notesHere: any[], voice: number): number | null => {
                try {
                    const pool = (notesHere || [])
                        .filter(n => n && !n.isRest && Number.isFinite(n.midi) && (n.voice ?? 1) === voice)
                        .map(n => Number(n.midi));
                    if (!pool.length) return null;
                    // In SATB each voice is monophonic; still, be safe.
                    if (voice === 4) return Math.min(...pool);
                    if (voice === 1) return Math.max(...pool);
                    // inner voices: pick median-ish
                    const sorted = pool.slice().sort((a, b) => a - b);
                    return sorted[Math.floor(sorted.length / 2)] ?? null;
                } catch {
                    return null;
                }
            };

            const beatsPerMeasureAt = (m: number): number => {
                const bpm = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number')
                    ? Number(measureBeatsPerMeasure[m])
                    : beatsPerMeasureBase;
                return Math.max(1, Number.isFinite(bpm) ? bpm : beatsPerMeasureBase);
            };

            const startAbsBeatOfMeasure = (m: number): number => {
                if (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number') return Number(measureStartAbsBeat[m]);
                return m * beatsPerMeasureBase;
            };

            const sampleAbsBeatsForMeasure = (m: number): number[] => {
                const start = startAbsBeatOfMeasure(m);
                const bpm = beatsPerMeasureAt(m);
                return [0, 1 / 3, 2 / 3].map(fr => start + fr * bpm);
            };

            const noteAbsBeat = (n: any): number => {
                const m = Number(n?.measureIndex ?? 0);
                const b = Number(n?.beat ?? 1);
                const start = startAbsBeatOfMeasure(m);
                return start + (b - 1);
            };

            const voiceOnsetSeqInWindow = (voice: number, startAbs: number, endAbs: number): { mids: number[]; timesQ: number[] } => {
                try {
                    const raw = ((layoutData.positionedNotes || []) as any[])
                        .filter(n => n && !n.isRest && Number.isFinite(n.midi) && (n.voice ?? 1) === voice)
                        .map(n => ({ abs: noteAbsBeat(n), midi: Number(n.midi) }))
                        .filter(x => Number.isFinite(x.abs) && x.abs >= startAbs - 1e-6 && x.abs < endAbs - 1e-6)
                        .sort((a, b) => a.abs - b.abs);

                    if (!raw.length) return { mids: [], timesQ: [] };

                    const mids: number[] = [];
                    const timesQ: number[] = [];
                    const span = Math.max(1e-6, endAbs - startAbs);
                    for (const x of raw) {
                        const last = mids[mids.length - 1];
                        if (last != null && x.midi === last) continue;
                        mids.push(x.midi);
                        // quantize normalized time to reduce jitter (1/48 of the block)
                        const t = (x.abs - startAbs) / span;
                        const tq = Math.round(t * 48) / 48;
                        timesQ.push(tq);
                    }
                    return { mids, timesQ };
                } catch {
                    return { mids: [], timesQ: [] };
                }
            };

            const eqDelta = (d1: number, d2: number): boolean => {
                if (!Number.isFinite(d1) || !Number.isFinite(d2)) return false;
                if (d1 === d2) return true;
                // Allow octave-equivalence with preserved direction.
                const s1 = Math.sign(d1);
                const s2 = Math.sign(d2);
                if (s1 !== 0 && s2 !== 0 && s1 !== s2) return false;
                const diff = d1 - d2;
                return Math.abs(diff % 12) < 1e-6;
            };

            const mod12 = (x: number): number => {
                const v = ((x % 12) + 12) % 12;
                return v;
            };

            type NoteSig = {
                bassD: number[];
                sopD: number[];
                vert12: number[];
                bassSeq: Array<number | null>;
                sopSeq: Array<number | null>;
            };

            type OnsetSig = {
                bassD: number[];
                sopD: number[];
                bassTimes: number[];
                sopTimes: number[];
            };

            const sigForTwoMeasures = (mStart: number): NoteSig | null => {
                try {
                    const points = [...sampleAbsBeatsForMeasure(mStart), ...sampleAbsBeatsForMeasure(mStart + 1)];
                    const bassSeq: Array<number | null> = [];
                    const sopSeq: Array<number | null> = [];
                    for (const a of points) {
                        const notesHere = getNotesAtAbsBeat(a);
                        bassSeq.push(midiForVoice(notesHere, 4));
                        sopSeq.push(midiForVoice(notesHere, 1));
                    }

                    const bassD: number[] = [];
                    const sopD: number[] = [];
                    const vert12: number[] = [];

                    for (let i = 0; i < points.length - 1; i++) {
                        const b0 = bassSeq[i];
                        const b1 = bassSeq[i + 1];
                        if (b0 != null && b1 != null) bassD.push(b1 - b0);
                    }
                    for (let i = 0; i < points.length - 1; i++) {
                        const s0 = sopSeq[i];
                        const s1 = sopSeq[i + 1];
                        if (s0 != null && s1 != null) sopD.push(s1 - s0);
                    }
                    for (let i = 0; i < points.length; i++) {
                        const b = bassSeq[i];
                        const s = sopSeq[i];
                        if (b != null && s != null) vert12.push(mod12(s - b));
                    }

                    // Require some data; otherwise skip.
                    if (bassD.length < 2 || vert12.length < 3) return null;
                    return { bassD, sopD, vert12, bassSeq, sopSeq };
                } catch {
                    return null;
                }
            };

            const noteMatch = (a: NoteSig, b: NoteSig): boolean => {
                // All-zero deltas match trivially but indicate static harmony, not a sequence
                if (a.bassD.every(d => d === 0) && a.sopD.every(d => d === 0)) return false;
                // Compare bass deltas (strong signal)
                const nBass = Math.min(a.bassD.length, b.bassD.length);
                let bassOK = 0;
                for (let i = 0; i < nBass; i++) if (eqDelta(a.bassD[i], b.bassD[i])) bassOK++;
                if (nBass < 2 || bassOK !== nBass) return false;

                // Compare vertical intervals (mod 12) at sampled points.
                const nVert = Math.min(a.vert12.length, b.vert12.length);
                let vertOK = 0;
                for (let i = 0; i < nVert; i++) if (a.vert12[i] === b.vert12[i]) vertOK++;
                if (nVert < 3 || vertOK < nVert - 1) return false; // allow 1 mismatch

                // Soprano deltas: optional, but if we have enough, require a decent match.
                const nS = Math.min(a.sopD.length, b.sopD.length);
                if (nS >= 2) {
                    let sopOK = 0;
                    for (let i = 0; i < nS; i++) if (eqDelta(a.sopD[i], b.sopD[i])) sopOK++;
                    if (sopOK < nS - 1) return false;
                }
                return true;
            };

            const onsetSigForTwoMeasures = (mStart: number): OnsetSig | null => {
                try {
                    const startAbs = startAbsBeatOfMeasure(mStart);
                    const endAbs = startAbsBeatOfMeasure(mStart + 2);
                    const bass = voiceOnsetSeqInWindow(4, startAbs, endAbs);
                    const sop = voiceOnsetSeqInWindow(1, startAbs, endAbs);

                    const deltas = (mids: number[]) => {
                        const out: number[] = [];
                        for (let i = 0; i < mids.length - 1; i++) out.push(mids[i + 1] - mids[i]);
                        return out;
                    };

                    const bassD = deltas(bass.mids);
                    const sopD = deltas(sop.mids);
                    if (bassD.length < 2) return null;
                    // Static voice leading (all zero deltas) → not a genuine sequence
                    if (bassD.every(d => d === 0) && sopD.every(d => d === 0)) return null;
                    return { bassD, sopD, bassTimes: bass.timesQ, sopTimes: sop.timesQ };
                } catch {
                    return null;
                }
            };

            const onsetMatch = (a: OnsetSig, b: OnsetSig): boolean => {
                // All-zero deltas = static voice leading, not a genuine sequence
                if (a.bassD.every(d => d === 0) && b.bassD.every(d => d === 0)) return false;
                const nBass = Math.min(a.bassD.length, b.bassD.length);
                if (nBass < 2) return false;
                for (let i = 0; i < nBass; i++) {
                    if (!eqDelta(a.bassD[i], b.bassD[i])) return false;
                }

                // Compare (quantized) onset timing patterns for bass.
                const nT = Math.min(a.bassTimes.length, b.bassTimes.length);
                if (nT >= 3) {
                    let ok = 0;
                    for (let i = 0; i < nT; i++) if (a.bassTimes[i] === b.bassTimes[i]) ok++;
                    if (ok < nT - 1) return false;
                }

                // Soprano optional: if both have enough deltas, require approximate match.
                const nS = Math.min(a.sopD.length, b.sopD.length);
                if (nS >= 2) {
                    let ok = 0;
                    for (let i = 0; i < nS; i++) if (eqDelta(a.sopD[i], b.sopD[i])) ok++;
                    if (ok < nS - 1) return false;
                }
                return true;
            };

            const maxM = Math.max(0, maxMeasureIndex);
            for (let m0 = 0; m0 <= maxM - 3; m0++) {
                const oa = onsetSigForTwoMeasures(m0);
                const ob = onsetSigForTwoMeasures(m0 + 2);
                const a = sigForTwoMeasures(m0);
                const b = sigForTwoMeasures(m0 + 2);
                const onsetOK = !!oa && !!ob && onsetMatch(oa, ob);
                const sampleOK = !!a && !!b && noteMatch(a, b);
                if (onsetOK || sampleOK) {
                    spans.push({ startMeasure: m0, endMeasure: m0 + 3, repeats: 2, source: 'note' });
                    m0 += 3;
                }
            }

            // (debug logging removed)
        } catch {
            // ignore
        }
        if (measureIndices.length >= 4) {
            for (let m0 = 0; m0 <= measureIndices.length - 4; m0++) {

                const sigA = blockSignature(m0);
                const sigB = blockSignature(m0 + 2);
                if (!sigA || !sigB) continue;

                // Skip identical label repetitions — a true harmonic sequence
                // requires transposed interval patterns (e.g. I-V → vi-iii),
                // not the same chords repeated verbatim.  The note-motion
                // detector (above) handles genuine sequences via interval matching.
                // if (sigA && sigA === sigB) { spans.push(...); m0 += 3; }
            }
        }

        // Also support explicit annotations inside `analysisContexts`.
        // You can mark a progression span with labels like "inizio progressione" and "fine progressione".
        try {
            const starts = (analysisContexts || [])
                .filter((c: any) => typeof c?.label === 'string' && /inizio\s+progressione/i.test(String(c.label)))
                .map((c: any) => Number(c.absBeat))
                .filter((a: number) => Number.isFinite(a))
                .sort((a: number, b: number) => a - b);
            const ends = (analysisContexts || [])
                .filter((c: any) => typeof c?.label === 'string' && /fine\s+progressione/i.test(String(c.label)))
                .map((c: any) => Number(c.absBeat))
                .filter((a: number) => Number.isFinite(a))
                .sort((a: number, b: number) => a - b);

            // Pair each start with the next end after it.
            let endIdx = 0;
            for (const s of starts) {
                while (endIdx < ends.length && ends[endIdx] <= s + 1e-6) endIdx++;
                if (endIdx >= ends.length) break;
                const e = ends[endIdx];
                endIdx++;

                const sm = findMeasureIndexForAbsBeat(s);
                const em = findMeasureIndexForAbsBeat(Math.max(s, e - 1e-6));
                if (Number.isFinite(sm) && Number.isFinite(em) && em >= sm) {
                    spans.push({ startMeasure: sm, endMeasure: em, source: 'annotated' });
                }
            }
        } catch {
            // ignore
        }

        // De-dupe spans (prefer note > auto > annotated when identical).
        const uniq = new Map<string, { startMeasure: number; endMeasure: number; repeats?: number; source: 'auto' | 'annotated' | 'note' }>();
        for (const sp of spans) {
            const key = `${sp.startMeasure}-${sp.endMeasure}`;
            const existing = uniq.get(key);
            if (!existing) {
                uniq.set(key, sp);
                continue;
            }
            const prio = (s: any) => (s === 'note' ? 3 : (s === 'auto' ? 2 : 1));
            if (prio(sp.source) > prio(existing.source)) uniq.set(key, sp);
        }
        const spansFinal = Array.from(uniq.values()).sort((a, b) => a.startMeasure - b.startMeasure || a.endMeasure - b.endMeasure);

        // (debug logging removed)

        if (!spansFinal.length) return layoutData.systemsParams.map(() => []);

        const markersBySystem: Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string; modelX1?: number; modelX2?: number; modelY?: number }>> = layoutData.systemsParams.map(() => []);

        const staffTopY = staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 18) : (TOP_STAFF_TOP + 18);
        const textY = staffTopY - 6;

        const measureStartXInSystem = (system: any, measureIndex: number): number | null => {
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return null;
            return Number(system.startMeasuresX?.[idx] ?? 0);
        };
        const measureEndXInSystem = (system: any, measureIndex: number): number | null => {
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return null;
            const staffEndX = (system.width ?? 0) - STAFF_MARGIN;
            const nextX = (idx < system.measureIndices.length - 1) ? Number(system.startMeasuresX?.[idx + 1] ?? staffEndX) : staffEndX;
            return nextX;
        };

        spansFinal.forEach((sp, k) => {
            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                const system = layoutData.systemsParams[si];
                const sysMeasures = system.measureIndices || [];
                const sysMin = sysMeasures.length ? Math.min(...sysMeasures) : null;
                const sysMax = sysMeasures.length ? Math.max(...sysMeasures) : null;
                if (sysMin == null || sysMax == null) continue;
                if (sp.endMeasure < sysMin || sp.startMeasure > sysMax) continue;

                const localStart = Math.max(sp.startMeasure, sysMin);
                const localEnd = Math.min(sp.endMeasure, sysMax);
                const x1 = measureStartXInSystem(system, localStart);
                const x2 = measureEndXInSystem(system, localEnd);
                if (x1 == null || x2 == null) continue;

                const pad = 6;
                const xx1 = x1 + pad;
                const xx2 = x2 - pad;
                const midX = (xx1 + xx2) / 2;

                // Model line: first half of the span (the "modello")
                const totalMeasures = sp.endMeasure - sp.startMeasure + 1;
                const modelLen = Math.floor(totalMeasures / (sp.repeats ?? 2));
                const modelEndMeasure = sp.startMeasure + modelLen - 1;
                // Only draw model line if model end is within this system
                let modelX2val: number | undefined;
                if (modelEndMeasure >= sysMin && modelEndMeasure <= sysMax) {
                    const mx2 = measureEndXInSystem(system, modelEndMeasure);
                    if (mx2 != null) modelX2val = mx2 - pad;
                }
                const modelLineY = staffTopY + 3;

                markersBySystem[si].push({
                    id: `prog-${sp.startMeasure}-${sp.endMeasure}-${k}-${si}`,
                    x1: xx1,
                    x2: xx2,
                    midX,
                    y: staffTopY,
                    textY,
                    label: sp.source === 'auto'
                        ? `Prog. (${sp.repeats ?? 2}×2 mis.)`
                        : (sp.source === 'note' ? 'Prog. (note)' : 'Prog. (annotata)'),
                    modelX1: xx1,
                    modelX2: modelX2val,
                    modelY: modelLineY,
                });
            }
        });

        return markersBySystem;
    }, [analysisContexts, harmonyLabelsBySystem, isAnalysisEnabled, isSequencesEnabled, layoutData, staffSystemMode, timeSignature]);

    const sequenceMatches = useMemo(() => {
        if (!isAnalysisEnabled || !isSequencesEnabled) return [];

        // IMPORTANT: build labelPoints from a global timeline so results are stable
        // even when layout changes (e.g. measures-per-line causes different system breaks).
        // The per-system harmony label suppression logic resets at system boundaries;
        // using it for sequence detection makes matches jump around.
        const timeline = getActiveNotesTimeline((analyzedNotes || notes) as any, timeSignature, timeSignatureChanges);
        const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
        const isCompoundMeter = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
        const isStrongPulseInMeasure = (inMeasureBeats0: number) => {
            try {
                if (!Number.isFinite(inMeasureBeats0)) return false;
                const EPS = 1e-3;
                if (isCompoundMeter) {
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
        };

        const timelineForLabels = (timeline || []).filter((ev: any, idx: number) => {
            if (!ev) return false;
            if (idx === 0) return true;
            const prev = timeline[idx - 1] as any;
            const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
            const curNotes = (ev?.notes || []) as any[];
            const hasOnset = curNotes.some(n => {
                const id = String(n?.id ?? '');
                return id && !prevIds.has(id);
            });
            if (hasOnset) return true;
            try {
                const curIds = new Set<string>(curNotes.map(n => String(n?.id ?? '')).filter(Boolean));
                const removed = Array.from(prevIds).some(id => id && !curIds.has(id));
                if (!removed) return false;
                const absBeat = Number(ev?.absBeat);
                if (!Number.isFinite(absBeat)) return false;
                const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
                return isStrongPulseInMeasure(inMeasure);
            } catch {
                return false;
            }
        });

        // Anti-noise filter (greedy forward): same logic as the main label useMemo.
        const timelineFiltered2 = (() => {
            if (minSpanBeats <= 1e-6) return timelineForLabels;
            const result: any[] = [];
            let lastKeptBeat = -Infinity;
            for (const ev of timelineForLabels) {
                const a = Number(ev?.absBeat);
                if (!Number.isFinite(a)) { result.push(ev); continue; }
                if (a - lastKeptBeat + 1e-6 >= minSpanBeats) {
                    result.push(ev);
                    lastKeptBeat = a;
                }
            }
            return result;
        })();

        const ctxAtAbsBeat = (absBeat: number) => (analysisContexts || [])
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

        const qAbs = (x: number) => {
            try {
                const q = 192;
                return Math.round(Number(x) * q) / q;
            } catch {
                return Number(x) || 0;
            }
        };

        const overrideByAbsBeat = new Map<number, HarmonyLabelOverride>();
        try {
            (harmonyOverrides || []).forEach((o: any) => {
                const a = Number(o?.absBeat);
                if (!Number.isFinite(a)) return;
                overrideByAbsBeat.set(qAbs(a), {
                    absBeat: a,
                    roman: typeof o?.roman === 'string' ? o.roman : undefined,
                    symbol: typeof o?.symbol === 'string' ? o.symbol : undefined,
                    figures: Array.isArray(o?.figures) ? o.figures.map((x: any) => String(x)) : undefined,
                    note: typeof o?.note === 'string' ? o.note : undefined,
                });
            });
        } catch { /* ignore */ }

        const labelPoints = (timelineFiltered2 || []).map((ev: any) => {
            const absBeat = Number(ev?.absBeat);
            if (!Number.isFinite(absBeat)) return null;
            const a = qAbs(absBeat);

            // Compute under current analysis context.
            const ctx = ctxAtAbsBeat(absBeat);
            const tonic = ctx ? String(ctx.newTonic || '') : String(currentTonic || 'C');
            const isMinor = ctx ? !!ctx.newIsMinor : !!isMinorMode;

            let roman = '';
            let symbol: string | undefined = undefined;
            let figures: string[] | undefined = undefined;
            try {
                const r = getRomanAnalysis(structuralNotes(ev?.notes || [], ornOverrideMap), tonic, isMinor, { ornamentOverrides: ornOverrideRecord });
                roman = String(r?.roman || '');
                figures = Array.isArray(r?.figures) ? r!.figures.map((x: any) => String(x)) : undefined;
            } catch { /* ignore */ }

            // Apply user override if present (wins).
            try {
                const ov = overrideByAbsBeat.get(a);
                if (ov) {
                    if (ov.roman != null) roman = String(ov.roman);
                    if (ov.symbol != null) symbol = String(ov.symbol);
                    if (ov.figures != null) figures = ov.figures;
                }
            } catch { /* ignore */ }

            return {
                absBeat,
                roman: roman || undefined,
                symbol,
                figures,
            };
        }).filter(Boolean) as Array<{ absBeat: number; roman?: string; symbol?: string; figures?: string[] }>;

        return detectVoiceLeadingSequences(notes, timeSignature, timeSignatureChanges, labelPoints, undefined, {
            keySignatureRoot: String(currentTonic || 'C'),
            isMinorMode: !!isMinorMode,
        });
    }, [analyzedNotes, currentTonic, analysisContexts, harmonyOverrides, isAnalysisEnabled, isMinorMode, isSequencesEnabled, minSpanBeats, notes, timeSignature, timeSignatureChanges]);

    const harmonyLabelsBySystemSequenced = useMemo(() => {
        if (!harmonyLabelsBySystem?.length || !sequenceMatches.length) return harmonyLabelsBySystem || [];

        const labelsBySystem = (harmonyLabelsBySystem || []).map(arr => arr.map(lbl => ({ ...lbl })));
        const flat = labelsBySystem.flatMap((arr, systemIndex) =>
            arr.map((lbl, labelIndex) => ({
                systemIndex,
                labelIndex,
                label: lbl,
                tick: Number.isFinite(lbl?.absBeat as number) ? Math.round(Number(lbl.absBeat) * TICKS_PER_QUARTER) : Number.NaN,
            }))
        ).filter(x => Number.isFinite(x.tick));

        flat.sort((a, b) => a.tick - b.tick);

        const findNearestLabelIndex = (tick: number) => {
            if (!flat.length) return null;
            let lo = 0;
            let hi = flat.length - 1;
            while (lo < hi) {
                const mid = Math.floor((lo + hi) / 2);
                if (flat[mid].tick < tick) lo = mid + 1;
                else hi = mid;
            }
            const candidates = [flat[lo], flat[lo - 1]].filter(Boolean) as typeof flat;
            let best: (typeof flat)[number] | null = null;
            let bestDist = Infinity;
            for (const c of candidates) {
                const dist = Math.abs(c.tick - tick);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = c;
                }
            }
            const TOL_TICKS = 12;
            if (!best || bestDist > TOL_TICKS) return null;
            return best;
        };

        const ctxAtAbsBeat = (absBeat: number) => (analysisContexts || [])
            .filter(c => analysisContextAbsBeat(c) <= absBeat + 1e-6)
            .sort((a, b) => analysisContextAbsBeat(b) - analysisContextAbsBeat(a))[0];

        const mod7 = (n: number) => ((n % 7) + 7) % 7;

        const degreeIndexFromRomanLoose = (romanRaw: string): number | null => {
            try {
                const raw0 = String(romanRaw || '').trim();
                if (!raw0) return null;
                const raw = raw0
                    .replace(/♭/g, 'b')
                    .replace(/♯/g, '#')
                    .replace(/𝄫/g, 'bb')
                    .replace(/𝄪/g, '##');
                const left = raw.split('/')[0];
                const m = left.match(/^([#b]*)(vii|vi|iv|v|iii|ii|i)/i);
                if (!m) return null;
                const core = String(m[2] || '').toLowerCase();
                if (core === 'i') return 0;
                if (core === 'ii') return 1;
                if (core === 'iii') return 2;
                if (core === 'iv') return 3;
                if (core === 'v') return 4;
                if (core === 'vi') return 5;
                if (core === 'vii') return 6;
                return null;
            } catch {
                return null;
            }
        };

        const stripSecondary = (roman: string) => {
            const raw = String(roman || '').trim();
            if (!raw) return raw;
            const parts = raw.split('/');
            return String(parts[0] || '').trim();
        };

        const normalizeFunctionalRomanInSequence = (
            romanRaw: string,
            localTonicDegreeIdx: number | null,
            localTonicIsMinor: boolean | null,
        ): string => {
            const raw = String(romanRaw || '').trim();
            if (!raw) return raw;

            // Do not touch special/aug6/borrowed tags.
            if (/^(It\+|Fr\+|Ger\+|N6)\b/.test(raw)) return raw;

            const qualitySuffix = (s0: string): { qual: string; tail: string } => {
                try {
                    const s = String(s0 || '').trim();
                    // Keep ° / ø / + and any trailing figures like 7.
                    const qual = s.includes('ø') ? 'ø' : s.includes('°') ? '°' : s.includes('+') ? '+' : '';
                    const m = s.match(/(\d+)$/);
                    const tail = m ? String(m[1]) : '';
                    return { qual, tail };
                } catch {
                    return { qual: '', tail: '' };
                }
            };

            const degreeToUpper = (degreeIdx: number, qual: string, tail: string): string => {
                const base = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][mod7(degreeIdx)] ?? '';
                return `${base}${qual}${tail}`;
            };

            // If it's a secondary (x/y), the head (x) is already the *function in the tonicized key*.
            // We want a pure functional read, so: i/iii -> I, ii°/iii -> II°, V/iii -> V, etc.
            if (raw.includes('/')) {
                const head = stripSecondary(raw);
                const d = degreeIndexFromRomanLoose(head);
                if (d == null) return head;
                const { qual, tail } = qualitySuffix(head);
                return degreeToUpper(d, qual, tail);
            }

            // Otherwise (diatonic/global roman), map it into the inferred local tonic context.
            if (localTonicDegreeIdx == null || localTonicIsMinor == null) return raw;
            const d = degreeIndexFromRomanLoose(raw);
            if (d == null) return raw;
            const rel = mod7(d - localTonicDegreeIdx);
            const { qual, tail } = qualitySuffix(raw);
            return degreeToUpper(rel, qual, tail);
        };

        const inferLocalTonicFromTemplate = (templateRomans: string[]) => {
            try {
                // 1) Strongest signal: an explicit tonic label I/x or i/x.
                // This is exactly the pedagogical case "i/iii" you mentioned.
                for (let i = 0; i < templateRomans.length; i++) {
                    const r0 = String(templateRomans[i] || '').trim();
                    if (!r0 || !r0.includes('/')) continue;
                    const [head0, target0] = r0.split('/');
                    const head = String(head0 || '').trim();
                    const target = String(target0 || '').trim();
                    if (!target) continue;
                    const isTonicHead = /^i(?!i)|^I(?!I)/.test(head); // i or I (not ii / II)
                    if (!isTonicHead) continue;
                    const degreeIdx = degreeIndexFromRomanLoose(target);
                    if (degreeIdx == null) continue;
                    const isMinor = head === head.toLowerCase();
                    return { degreeIdx, isMinor };
                }

                let bestTarget: string | null = null;
                for (let i = 0; i < templateRomans.length; i++) {
                    const r = String(templateRomans[i] || '').trim();
                    const m = r.match(/^(?:V|v|vii[°+ø]?)[^/]*\/(.+)$/);
                    if (!m) continue;
                    const target = String(m[1] || '').trim();
                    if (!target) continue;
                    // Only consider it a tonicization if the target actually appears later in the template.
                    const appears = templateRomans.slice(i + 1).some(x => String(x || '').trim() === target);
                    if (appears) bestTarget = target;
                }
                // IMPORTANT: if we have no explicit tonicization evidence, do NOT force a local tonic.
                // Otherwise plain diatonic progressions (e.g. IV–V–I–vi) get re-labeled as I–II–V–III.
                if (!bestTarget) return { degreeIdx: null as number | null, isMinor: null as boolean | null };
                const degreeIdx = degreeIndexFromRomanLoose(bestTarget);
                if (degreeIdx == null) return { degreeIdx: null as number | null, isMinor: null as boolean | null };
                const isMinor = bestTarget === bestTarget.toLowerCase();
                return { degreeIdx, isMinor };
            } catch {
                return { degreeIdx: null as number | null, isMinor: null as boolean | null };
            }
        };

        const normalizeRomanDegree = (romanRaw: string) => {
            const raw = String(romanRaw || '').trim();
            if (!raw) return '';
            const r = raw
                .replace(/♭/g, 'b')
                .replace(/♯/g, '#')
                .replace(/𝄫/g, 'bb')
                .replace(/𝄪/g, '##');
            const left = r.split('/')[0];
            const m = left.match(/^([#b]*)(vii[°+ø]?|[ivIV]+)/);
            return m ? `${m[1] || ''}${m[2] || ''}` : left.replace(/\d+/g, '');
        };

        const hasAccidentalPrefix = (romanRaw: string) => {
            const r = String(romanRaw || '')
                .trim()
                .replace(/♭/g, 'b')
                .replace(/♯/g, '#')
                .replace(/𝄫/g, 'bb')
                .replace(/𝄪/g, '##');
            return /^([#b]+)/.test(r);
        };

        for (const seq of sequenceMatches) {
            if (Number.isFinite(seq.transpositionSemitones as number) && Number(seq.transpositionSemitones) === 0) continue;
            const slots = seq.slotTicks || [];
            if (!slots.length) continue;
            const L = seq.lengthSteps;
            const repeats = Math.max(2, Number(seq.repeatsCount ?? 2));

            // Build a stable mapping from TEMPLATE slot k -> functional roman.
            // This avoids recomputing (and potentially changing) the inferred local tonic
            // for each copied label.
            const templateByK: Array<{ lab: typeof flat[number] | null; src: string; stripped: string; functional: string; figures?: string[] }> = [];
            const tmplRomans: string[] = [];
            for (let kk = 0; kk <= L; kk += 1) {
                const slot = slots[seq.startSlotIdx + kk];
                const lab = Number.isFinite(slot) ? findNearestLabelIndex(slot) : null;
                const src = String(lab?.label?.roman ?? '').trim();
                if (src) tmplRomans.push(src);
                const figures = lab?.label?.figures;
                templateByK.push({ lab, src, stripped: stripSecondary(src), functional: src, figures: Array.isArray(figures) ? figures : undefined });
            }
            const inferred0 = inferLocalTonicFromTemplate(tmplRomans);
            // If we have no explicit tonicization evidence but the sequence is truly transposed,
            // allow a fallback where the first template chord is treated as the local tonic,
            // ONLY when it's a plausible tonic substitute (I/iii/vi). This makes patterns like
            // "iii – V" display as "I – V" without breaking diatonic cadences like IV–V–I–vi.
            const inferred = (() => {
                try {
                    if (inferred0.degreeIdx != null && inferred0.isMinor != null) return inferred0;
                    const transp = Number(seq.transpositionSemitones);
                    if (!Number.isFinite(transp) || Math.abs(transp) < 1e-6) return inferred0;
                    const first = String(templateByK[0]?.src || '').trim();
                    if (!first) return inferred0;
                    const d = degreeIndexFromRomanLoose(first);
                    if (d == null) return inferred0;
                    // Only I (0), iii (2), vi (5) qualify.
                    if (!(d === 0 || d === 2 || d === 5)) return inferred0;
                    const isMinor = first === first.toLowerCase();
                    return { degreeIdx: d, isMinor };
                } catch {
                    return inferred0;
                }
            })();
            // When no valid functional transformation was determined (degreeIdx is null
            // or the inferred local tonic IS the global tonic), propagating the template's
            // literal roman to copies would override each copy's native Roman
            // (e.g. "vi" → "V" for a diatonic non-modulating sequence).
            // Skip sequence annotation entirely in that case — UNLESS it's a modulating
            // sequence, where each link must replicate the model's exact roman numerals.
            const isModulatingSeq = !!seq.isModulating;
            const skipFunctional = !isModulatingSeq && (inferred.degreeIdx == null || (inferred.degreeIdx === 0 && !inferred.isMinor));

            for (let kk = 0; kk < templateByK.length; kk += 1) {
                const row = templateByK[kk];
                // For modulating sequences: each link is an exact transposition of the
                // model, so the functional roman IS the template's own roman (V→I repeats
                // as V→I in each new local key).
                const functional = isModulatingSeq
                    ? (row.src || '')
                    : ((!skipFunctional && row.src && inferred.degreeIdx != null && inferred.isMinor != null)
                        ? normalizeFunctionalRomanInSequence(row.src, inferred.degreeIdx, inferred.isMinor)
                        : '');
                templateByK[kk] = { ...row, functional };
            }

            // Annotate the TEMPLATE occurrence itself, so the whole sequence reads consistently.
            try {
                for (let kk = 0; kk <= L; kk += 1) {
                    const row = templateByK[kk];
                    if (!row?.lab) continue;
                    const lbl = labelsBySystem[row.lab.systemIndex]?.[row.lab.labelIndex];
                    if (!lbl) continue;
                    if (row.src && !skipFunctional) {
                        (lbl as any).sequenceRoman = row.stripped;
                        if (row.functional) {
                            (lbl as any).sequenceRomanFunctional = row.functional;
                            (lbl as any).sequenceRomanSource = row.src;
                        }
                    }
                }
            } catch {
                // ignore
            }

            for (let r = 1; r < repeats; r += 1) {
                for (let k = 0; k <= L; k += 1) {
                    const slotB = slots[seq.startSlotIdx + r * L + k];
                    const labB = findNearestLabelIndex(slotB);
                    if (!Number.isFinite(slotB) || !labB) continue;

                    const row = templateByK[k];
                    const templateRoman = String(row?.src ?? '').trim();
                    if (!templateRoman) continue;
                    const target = labelsBySystem[labB.systemIndex]?.[labB.labelIndex];
                    if (!target) continue;
                    if (skipFunctional || !row.functional) continue;
                    (target as any).sequenceRoman = row.stripped;
                    if (row.functional) {
                        (target as any).sequenceRomanFunctional = row.functional;
                        (target as any).sequenceRomanSource = templateRoman;
                        // For modulating sequences the model's roman must win
                        // over any romanDisplay generated by the pivot / secondary
                        // analysis pipeline (which analyses in a potentially wrong tonic).
                        if (isModulatingSeq) {
                            (target as any).romanDisplay = undefined;
                            // Also propagate figures from the model — the chord
                            // voicing is an exact transposition of the model.
                            if (Array.isArray(row.figures)) {
                                (target as any).figures = row.figures;
                            }
                        }
                    }
                }
            }
        }

        return labelsBySystem;
    }, [harmonyLabelsBySystem, sequenceMatches]);

    const sequenceMarkersBySystem = useMemo(() => {
        if (!layoutData || !sequenceMatches.length) return [] as Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>>;

        const markersBySystem: Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string }>> = layoutData.systemsParams.map(() => []);
        const staffTopY = staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 36) : (TOP_STAFF_TOP + 36);
        const textY = staffTopY - 6;

        // Option B: anchor to absBeat boundaries rather than measure boundaries.
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const beatsFallback = timeSignature.numerator * (4 / timeSignature.denominator);

        const beatsInMeasure = (m: number): number => {
            const b = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number') ? Number(measureBeatsPerMeasure[m]) : beatsFallback;
            return Number.isFinite(b) && b > 0 ? b : beatsFallback;
        };
        const startAbsForMeasure = (m: number): number => {
            if (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number') return Number(measureStartAbsBeat[m]);
            return m * beatsFallback;
        };

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) return Math.floor(ab / beatsFallback);
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const getXForAbsBeat = (absBeat: number, system: any) => {
            // Prefer a system-local lookup to avoid rendering glitches when rounding causes
            // findMeasureIndexForAbsBeat() to pick a measure not present in this system.
            const findMeasureIdxInSystem = () => {
                try {
                    const measures = system.measureIndices || [];
                    if (!measures.length) return null;
                    const EPS = 1e-6;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const end = start + beatsInMeasure(m);
                        if (absBeat >= start - EPS && absBeat < end - EPS) return { m, idx: i };
                    }
                    // Clamp to closest bucket.
                    let bestIdx = 0;
                    let bestDist = Infinity;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const dist = Math.abs(absBeat - start);
                        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                    }
                    return { m: measures[bestIdx], idx: bestIdx };
                } catch {
                    return null;
                }
            };

            const local = findMeasureIdxInSystem();
            const measureIndex = local ? local.m : findMeasureIndexForAbsBeat(absBeat);
            const bpm = beatsInMeasure(measureIndex);
            const startAbs = startAbsForMeasure(measureIndex);
            const beatInMeasure = (absBeat - startAbs) + 1;

            const idx = local ? local.idx : system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return system.startMeasuresX?.[0] ?? 0;
            const startX = system.startMeasuresX[idx];
            const endX = idx < system.measureIndices.length - 1 ? system.startMeasuresX[idx + 1] : (system.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / bpm));
            return startX + MEASURE_PADDING_X + (rel * contentWidth);
        };

        const formatAbsBeatPos = (absBeat: number): string => {
            try {
                const m = findMeasureIndexForAbsBeat(absBeat);
                const bpm = beatsInMeasure(m);
                const startAbs = startAbsForMeasure(m);
                const beat = (absBeat - startAbs) + 1;
                const nearInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-3;
                const beatLabel = nearInt(beat) ? String(Math.round(beat)) : String(Math.round(beat * 4) / 4);
                return `m${m + 1}b${beatLabel}`;
            } catch {
                return '';
            }
        };

        sequenceMatches.forEach((seq, k) => {
            // Full sequence span: from model start to end of last repetition.
            const startTick = Number(seq.startTick);
            const endTickExcl = Number(seq.endTick);
            if (!Number.isFinite(startTick) || !Number.isFinite(endTickExcl)) return;

            const absStart = startTick / TICKS_PER_QUARTER;
            // Use inclusive end (endTickExclusive-1) to keep the bracket inside the last measure
            // when the sequence ends exactly at a barline.
            const endTickIncl = Math.max(startTick, endTickExcl - 1);
            const absEnd = endTickIncl / TICKS_PER_QUARTER;
            if (!Number.isFinite(absStart) || !Number.isFinite(absEnd) || !(absEnd > absStart + 1e-9)) return;

            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                const system = layoutData.systemsParams[si];
                const sysMeasures = system.measureIndices || [];
                const sysMin = sysMeasures.length ? Math.min(...sysMeasures) : null;
                const sysMax = sysMeasures.length ? Math.max(...sysMeasures) : null;
                if (sysMin == null || sysMax == null) continue;

                const sysAbsStart = startAbsForMeasure(sysMin);
                const sysAbsEnd = startAbsForMeasure(sysMax) + beatsInMeasure(sysMax);

                const oStart = Math.max(absStart, sysAbsStart);
                const oEnd = Math.min(absEnd, sysAbsEnd);
                if (!(oEnd > oStart + 1e-6)) continue;

                let x1 = getXForAbsBeat(oStart, system);
                let x2 = getXForAbsBeat(oEnd, system);
                if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
                if (x2 < x1) [x1, x2] = [x2, x1];

                const pad = 6;
                const xx1 = x1 + pad;
                const xx2 = x2 - pad;
                if (!(xx2 > xx1 + 2)) continue;
                const midX = (xx1 + xx2) / 2;
                const conf = Math.round(seq.confidence * 100);
                const modelRange = (seq.modelStartMeasure != null && seq.modelEndMeasure != null)
                    ? (seq.modelStartMeasure === seq.modelEndMeasure
                        ? `m${seq.modelStartMeasure + 1}`
                        : `m${seq.modelStartMeasure + 1}-${seq.modelEndMeasure + 1}`)
                    : '';
                const repeatRange = (seq.repeatStartMeasure != null && seq.repeatEndMeasure != null)
                    ? (seq.repeatStartMeasure === seq.repeatEndMeasure
                        ? `m${seq.repeatStartMeasure + 1}`
                        : `m${seq.repeatStartMeasure + 1}-${seq.repeatEndMeasure + 1}`)
                    : '';
                const isFirstFragment = absStart >= sysAbsStart - 1e-6 && absStart <= sysAbsEnd + 1e-6;
                markersBySystem[si].push({
                    id: `seq-${seq.startMeasure}-${seq.endMeasure}-${k}-${si}`,
                    x1: xx1,
                    x2: xx2,
                    midX,
                    y: staffTopY,
                    textY,
                    // If the detected sequence starts/ends mid-measure, include beat offsets
                    // so the bracket geometry matches the label and feels less ambiguous.
                    label: (() => {
                        if (!isFirstFragment) return '';
                        const posA = formatAbsBeatPos(absStart);
                        const posB = formatAbsBeatPos(absEnd);
                        const hasPos = !!(posA && posB);
                        return hasPos
                            ? `Seq. ${posA}→${posB}`
                            : `Seq. ${modelRange}→${repeatRange}`;
                    })(),
                });
            }
        });

        return markersBySystem;
    }, [layoutData, sequenceMatches, staffSystemMode]);

    // Subtle highlight for the *model* range of each sequence (discreet visual cue).
    const sequenceModelMarkersBySystem = useMemo(() => {
        if (!layoutData || !sequenceMatches.length) return [] as Array<Array<{ id: string; x1: number; x2: number; y: number }>>;

        const markersBySystem: Array<Array<{ id: string; x1: number; x2: number; y: number }>> = layoutData.systemsParams.map(() => []);
        const staffTopY = staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 36) : (TOP_STAFF_TOP + 36);

        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const beatsFallback = timeSignature.numerator * (4 / timeSignature.denominator);

        const beatsInMeasure = (m: number): number => {
            const b = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number') ? Number(measureBeatsPerMeasure[m]) : beatsFallback;
            return Number.isFinite(b) && b > 0 ? b : beatsFallback;
        };
        const startAbsForMeasure = (m: number): number => {
            if (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number') return Number(measureStartAbsBeat[m]);
            return m * beatsFallback;
        };

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) return Math.floor(ab / beatsFallback);
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) {
                if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        const getXForAbsBeat = (absBeat: number, system: any) => {
            // Robust system-local mapping: avoid x=0 when rounding picks a measure not in this system.
            const findMeasureIdxInSystem = () => {
                try {
                    const measures = system.measureIndices || [];
                    if (!measures.length) return null;
                    const EPS = 1e-6;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const end = start + beatsInMeasure(m);
                        if (absBeat >= start - EPS && absBeat < end - EPS) return { m, idx: i };
                    }
                    let bestIdx = 0;
                    let bestDist = Infinity;
                    for (let i = 0; i < measures.length; i++) {
                        const m = measures[i];
                        const start = startAbsForMeasure(m);
                        const dist = Math.abs(absBeat - start);
                        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                    }
                    return { m: measures[bestIdx], idx: bestIdx };
                } catch {
                    return null;
                }
            };

            const local = findMeasureIdxInSystem();
            const measureIndex = local ? local.m : findMeasureIndexForAbsBeat(absBeat);
            const bpm = beatsInMeasure(measureIndex);
            const startAbs = startAbsForMeasure(measureIndex);
            const beatInMeasure = (absBeat - startAbs) + 1;
            const idx = local ? local.idx : system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return system.startMeasuresX?.[0] ?? 0;
            const startX = system.startMeasuresX[idx];
            const endX = idx < system.measureIndices.length - 1 ? system.startMeasuresX[idx + 1] : (system.width - START_X);
            const measureWidth = Math.max(1, endX - startX);
            const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
            const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / bpm));
            return startX + MEASURE_PADDING_X + (rel * contentWidth);
        };

        sequenceMatches.forEach((seq, k) => {
            const slots = seq.slotTicks || [];
            const L = seq.lengthSteps;
            const modelStartTick = Number(seq.startTick);
            // repeatStartTick = tick where the repeat begins = end of model
            let repeatStartTick = Number(slots[seq.startSlotIdx + L]);
            // Fallback: if slotTicks lookup fails, compute from modelEndMeasure
            if (!Number.isFinite(repeatStartTick) && seq.modelEndMeasure != null) {
                const mEnd = seq.modelEndMeasure;
                repeatStartTick = (startAbsForMeasure(mEnd) + beatsInMeasure(mEnd)) * TICKS_PER_QUARTER;
            }
            // Second fallback: use repeatStartMeasure
            if (!Number.isFinite(repeatStartTick) && seq.repeatStartMeasure != null) {
                repeatStartTick = startAbsForMeasure(seq.repeatStartMeasure) * TICKS_PER_QUARTER;
            }
            if (!Number.isFinite(modelStartTick) || !Number.isFinite(repeatStartTick)) return;

            const absStart = modelStartTick / TICKS_PER_QUARTER;
            const absEnd = repeatStartTick / TICKS_PER_QUARTER;
            if (!Number.isFinite(absStart) || !Number.isFinite(absEnd) || absEnd <= absStart) return;

            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                const system = layoutData.systemsParams[si];
                const sysMeasures = system.measureIndices || [];
                if (!sysMeasures.length) continue;
                const sysMin = Math.min(...sysMeasures);
                const sysMax = Math.max(...sysMeasures);
                const sysAbsStart = startAbsForMeasure(sysMin);
                const sysAbsEnd = startAbsForMeasure(sysMax) + beatsInMeasure(sysMax);

                const oStart = Math.max(absStart, sysAbsStart);
                const oEnd = Math.min(absEnd, sysAbsEnd);
                if (!(oEnd > oStart + 1e-6)) continue;

                let x1 = getXForAbsBeat(oStart, system);
                let x2 = getXForAbsBeat(oEnd, system);
                if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
                if (x2 < x1) [x1, x2] = [x2, x1];

                const pad = 6;
                markersBySystem[si].push({
                    id: `seq-model-${seq.startSlotIdx}-${k}-${si}`,
                    x1: x1 + pad,
                    x2: x2 - pad,
                    y: staffTopY + 3,
                });
            }
        });

        return markersBySystem;
    }, [layoutData, sequenceMatches, staffSystemMode]);

    // Modulation / tonicization markers per system (from analysisContexts)
    const contextMarkersBySystem = useMemo(() => {
        if (!layoutData || analysisContexts.length === 0) return [] as { x: number; label: string }[][];

        const formatLabel = (ctx: AnalysisContext) => {
            const quality = ctx.newIsMinor ? 'min' : 'Maj';
            const tonicLabel = `[ ${ctx.newTonic} ${quality} ]`;
            const custom = ctx.label && String(ctx.label).trim() ? String(ctx.label).trim() : '';
            // markerMode='text' → show only the custom label, no tonic bracket
            if (ctx.markerMode === 'text' && custom) return custom;
            return custom ? `${custom} ${tonicLabel}` : tonicLabel;
        };

        const markersBySystem: { x: number; label: string }[][] = layoutData.systemsParams.map(() => []);
        const measureStarts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeats = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;

        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStarts || measureStarts.length === 0) {
                const bpm = timeSignature.numerator * (4 / timeSignature.denominator);
                return Math.floor(ab / bpm);
            }
            for (let m = measureStarts.length - 1; m >= 0; m--) {
                if (ab >= (measureStarts[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };

        for (const ctx of analysisContexts) {
            const absBeat = analysisContextAbsBeat(ctx);
            if (!Number.isFinite(absBeat) || absBeat < 0) continue;

            const measureIndex = findMeasureIndexForAbsBeat(absBeat);
            const bpm = (measureBeats && measureBeats[measureIndex])
                ? measureBeats[measureIndex]
                : (timeSignature.numerator * (4 / timeSignature.denominator));
            const beatInMeasure = (absBeat - ((measureStarts && measureStarts[measureIndex] != null) ? measureStarts[measureIndex] : (measureIndex * bpm))) + 1;

            for (let systemIndex = 0; systemIndex < layoutData.systemsParams.length; systemIndex++) {
                const sys = layoutData.systemsParams[systemIndex];
                const idx = sys.measureIndices.indexOf(measureIndex);
                if (idx < 0) continue;

                const startX = sys.startMeasuresX[idx];
                const endX = idx < sys.measureIndices.length - 1 ? sys.startMeasuresX[idx + 1] : (sys.width - START_X);
                const measureWidth = Math.max(1, endX - startX);
                const contentWidth = Math.max(1, measureWidth - (MEASURE_PADDING_X * 2));
                const rel = Math.max(0, Math.min(1, (beatInMeasure - 1) / bpm));
                const x = startX + MEASURE_PADDING_X + (rel * contentWidth);

                markersBySystem[systemIndex].push({ x: x + 10, label: formatLabel(ctx) });
                break;
            }
        }

        markersBySystem.forEach(ms => ms.sort((a, b) => a.x - b.x));
        return markersBySystem;
    }, [analysisContextAbsBeat, analysisContexts, layoutData, timeSignature]);

    const timeSignatureMarkersBySystem = useMemo(() => {
        if (!layoutData || timeSignatureChanges.length === 0) return [] as { x: number; numerator: number; denominator: number; measureIndex: number }[][];

        const markersBySystem: { x: number; numerator: number; denominator: number; measureIndex: number }[][] = layoutData.systemsParams.map(() => []);
        const measureStarts = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeats = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const findMeasureIndexForAbsBeat = (ab: number): number => {
            if (!measureStarts || measureStarts.length === 0) {
                const bpm = timeSignature.numerator * (4 / timeSignature.denominator);
                return Math.floor(ab / bpm);
            }
            for (let m = measureStarts.length - 1; m >= 0; m--) {
                if (ab >= (measureStarts[m] ?? 0) - 1e-9) return m;
            }
            return 0;
        };
        const getXForMeasureStart = (system: any, measureIndex: number) => {
            const idx = system.measureIndices.indexOf(measureIndex);
            if (idx === -1) return 0;
            return system.startMeasuresX[idx] + 6;
        };

        for (const tc of timeSignatureChanges) {
            const absBeat = timeSignatureChangeAbsBeat(tc);
            if (!Number.isFinite(absBeat)) continue;
            const measureIndex = Number.isFinite(tc.measureIndex as any)
                ? Number(tc.measureIndex)
                : findMeasureIndexForAbsBeat(absBeat);
            const sysIndex = layoutData.systemsParams.findIndex(sp => (sp.measureIndices || []).includes(measureIndex));
            if (sysIndex < 0) continue;
            const system = layoutData.systemsParams[sysIndex];
            const x = getXForMeasureStart(system, measureIndex);
            markersBySystem[sysIndex].push({ x, numerator: tc.numerator, denominator: tc.denominator, measureIndex });
        }

        markersBySystem.forEach(ms => ms.sort((a, b) => a.x - b.x));
        return markersBySystem;
    }, [layoutData, timeSignature, timeSignatureChangeAbsBeat, timeSignatureChanges]);


    return {
        harmonyLabelsBySystemSequenced,
        progressionMarkersBySystem,
        sequenceMarkersBySystem,
        sequenceModelMarkersBySystem,
        contextMarkersBySystem,
        timeSignatureMarkersBySystem,
        sequenceMatches,
    };
}
