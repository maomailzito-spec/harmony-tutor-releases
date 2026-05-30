/**
 * useHarmonyLabels — extracted from GrandStaffEditor.tsx (Phase 2)
 *
 * Computes all harmony analysis overlay data per system:
 * roman numerals, figured bass, chord symbols, progression markers,
 * sequence markers, modulation markers, and time-signature markers.
 */
import { useMemo } from 'react';
import type { StaffNote, TimeSignature, AnalysisContext, HarmonyLabelOverride, TimeSignatureChange, AccompanimentTrack } from '../types';
import { getActiveNotesTimeline, identifyChordCandidates, calculateRomanFromChordInfo, getRomanAnalysis, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS, getKeySignature, getChordSymbol } from '../utils/musicTheory';
import { structuralNotes, buildEngineHarmonyOverrideMap } from '../utils/harmonyLabelPipeline';
import { usePreference } from '../preferences/usePreference';
import { evaluateCadentialPatterns, type ChordEvent, pcToNoteName, noteNameToPc, qualityFamily, getScalePcs } from '../utils/cadentialPatterns';
import { CADENTIAL_PATTERN_RECOGNITION_KEY, ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY } from '../storage/storageKeys';
import { detectVoiceLeadingSequences } from '../utils/sequenceDetector';
import { detectChromaticModulations } from '../utils/chromaticModulationDetector';
import { getBigramProbability, type StyleProfile } from '../engine/choralStyleProfile';
import { TICKS_PER_QUARTER, CHORD_FORMULAS, NOTE_NAMES, ALL_NOTE_SPELLINGS, DURATION_VALUES } from '../constants';
import { suggestNextChord } from '../engine/progressionSuggester';
import { shouldBlockTonicization } from '../utils/modalInterchange';
import {
    applyR1ViiRescue,
    applyR2SecDom,
    applyR3I7,
    applyR4DyadBass,
    applyR5ShellCont,
    applyR6Rootless,
    applyR7PostInvRoot,
    applyR8PostInvDiat,
    applyR10SuspDedup,
    applyR11SparseRescue,
    applyR12AutoOverride,
    applyR13ManualOverride,
    applyR14CorpusBias,
} from '../utils/harmonyPostRules';

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
    autoHarmonyLabelOverrides?: any[];
    tonicizationHints?: import('../types').TonicizationHint[];
    inferredContextSuppressions?: number[];
    enableInferredContexts?: boolean;
    cadentialPatternsEnabled?: boolean;
    accompanimentTracks?: AccompanimentTrack[];
}

function getAccompanimentPcsForBeat(
    tracks: AccompanimentTrack[],
    absBeat: number,
    ornOverrideMap?: Map<string, string>,
): { pcs: number[]; lowestMidi: number | null } {
    const activePcs = new Set<number>();
    let lowestMidi: number | null = null;
    const beatTick = absBeat * TICKS_PER_QUARTER;
    for (const track of tracks) {
        if ((track as any).muted) continue;
        for (const note of (track.notes ?? [])) {
            if (note.isRest || !Number.isFinite(note.midi) || !note.midi) continue;
            const s = note.startTick ?? 0;
            const d = note.durationTicks ?? 0;
            if (s <= beatTick && beatTick < s + d) {
                // Surgical participation: an accompaniment note feeds the analysis ONLY
                // when the user marked it harmonic (Opt+H → 'structural'). By default ACC
                // notes stay out of chord identification (they "just sound"). Without a
                // marking map nothing participates.
                const ov = ornOverrideMap
                    ? (ornOverrideMap.get(note.id)
                       ?? ornOverrideMap.get(`${note.midi}-${note.measureIndex ?? -1}-${note.beat ?? -1}`))
                    : undefined;
                if (ov !== 'structural') continue;
                const pc = ((note.midi % 12) + 12) % 12;
                activePcs.add(pc);
                if (lowestMidi === null || note.midi < lowestMidi) lowestMidi = note.midi;
            }
        }
    }
    return { pcs: [...activePcs], lowestMidi };
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
        tonicizationHints,
        inferredContextSuppressions,
        enableInferredContexts,
        cadentialPatternsEnabled,
        accompanimentTracks,
    } = params;

    const [compactTonicization] = usePreference<boolean>('analysis.tonicizationCompact');
    const [_chromaticModulationEnabled] = usePreference<boolean>('analysis.chromaticModulation');
    const [accHintEnabled] = usePreference<boolean>('analysis.accHint');

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
                    if (src.isCambiata) pn.isCambiata = true;
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

        // ── TS-aware helpers: compute beat-in-measure accounting for TS changes ──
        const tsEffectiveAt = (absBeat: number): TimeSignature => {
            let ts = timeSignature;
            for (const c of (timeSignatureChanges || [])) {
                if (typeof c.absBeat === 'number' && c.absBeat <= absBeat + 1e-6) {
                    ts = { numerator: c.numerator, denominator: c.denominator } as TimeSignature;
                }
            }
            return ts;
        };

        const getInMeasure = (absBeat: number): number => {
            let runAbs = 0;
            let curTs = timeSignature;
            let curMi = 0;
            for (const c of (timeSignatureChanges || [])) {
                if (typeof c.absBeat !== 'number') continue;
                if (c.absBeat > absBeat + 1e-6) break;
                const bpm = curTs.numerator * (4 / curTs.denominator);
                const measBefore = (c.measureIndex ?? curMi) - curMi;
                runAbs += measBefore * bpm;
                curTs = { numerator: c.numerator, denominator: c.denominator } as TimeSignature;
                curMi = c.measureIndex ?? curMi;
            }
            const bpm = curTs.numerator * (4 / curTs.denominator);
            const inRegion = absBeat - runAbs;
            return inRegion - Math.floor(inRegion / bpm) * bpm;
        };

        const isStrongAtAbsBeat = (absBeat: number): boolean => {
            const ts2 = tsEffectiveAt(absBeat);
            const cm = ts2.denominator === 8 && (ts2.numerator % 3 === 0) && ts2.numerator > 3;
            const inMeas = getInMeasure(absBeat);
            const EPS = 1e-3;
            if (cm) {
                const pulse = 1.5;
                const r = ((inMeas % pulse) + pulse) % pulse;
                return Math.abs(r) < EPS || Math.abs(pulse - r) < EPS;
            }
            const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
            return nearInt(inMeas);
        };

        // ─── Cadential Pattern Recognition (Fase 1) ───
        let _effectiveCtxs: AnalysisContext[] = [...(analysisContexts || [])];
        const _suppressedBeats = new Set((inferredContextSuppressions || []).map(b => Math.round(b * 1e6) / 1e6));
        // pushInferred pushes directly so all intermediate reads of _effectiveCtxs work correctly.
        // Suppression is applied in a single pass at the end (flushInferred).
        const pushInferred = (ctx: AnalysisContext) => {
            _effectiveCtxs.push(ctx);
        };
        // Applied after all cadential/chromatic/hint blocks: removes suppressed inferred contexts.
        const flushInferred = () => {
            if (_suppressedBeats.size === 0) return;
            // Sort inferred contexts by beat to find which one is "active" at each suppressed beat
            const inferredOnly = _effectiveCtxs
                .filter((c: any) => c.source === 'inferred')
                .sort((a, b) => (a.absBeat ?? 0) - (b.absBeat ?? 0));
            const suppressedCtxBeats = new Set<number>();
            for (const sb of _suppressedBeats) {
                let best: AnalysisContext | null = null;
                for (const ctx of inferredOnly) {
                    if ((ctx.absBeat ?? 0) <= sb + 1e-6) best = ctx;
                    else break;
                }
                if (best) suppressedCtxBeats.add(Math.round((best.absBeat ?? 0) * 1e6) / 1e6);
            }
            if (suppressedCtxBeats.size > 0) {
                _effectiveCtxs = _effectiveCtxs.filter((c: any) => {
                    if (c.source !== 'inferred') return true;
                    return !suppressedCtxBeats.has(Math.round((c.absBeat ?? 0) * 1e6) / 1e6);
                });
            }
        };
        const _pivotCandidates = new Map<number, {tonic: string, isMinor: boolean}>();
        // Beats where a Cadential 6/4 pattern places an I6/4. The label loop will
        // relabel I6/4 → V6/4 at these beats (lettura funzionale moderna).
        const _cadential64Beats = new Set<number>();
        // Gate: if the "Inferisci contesti" toggle is OFF, skip all inferred context generation.
        // Use the React prop (passed from GSE via usePreference) so changes re-trigger the memo.
        // undefined = key not set = default ON
        const _inferCtxEnabled = enableInferredContexts !== false;
        const _cadEnabled2 = _inferCtxEnabled && cadentialPatternsEnabled !== false;
        // Lifted: used by cadential, chromatic-modulation and tonicization-hint
        // blocks below. Keeping the definition at the outer scope avoids the
        // TS "name not found" errors when _cadEnabled is false (and the inner
        // definition is skipped).
        const _resolveHomeAt = (returnBeat: number): { tonic: string; isMinor: boolean } => {
            const manuals = (analysisContexts || [])
                .filter((c: any) => c.source !== 'inferred')
                .map((c: AnalysisContext) => ({ ab: analysisContextAbsBeat(c), c }))
                .filter(x => x.ab <= returnBeat - 1e-6)
                .sort((a, b) => b.ab - a.ab);
            if (manuals.length > 0) {
                const top = manuals[0].c as any;
                return { tonic: top.newTonic, isMinor: !!top.newIsMinor };
            }
            return { tonic: currentTonic, isMinor: isMinorMode };
        };
        try {
            const _cadEnabled = _cadEnabled2;
            if (_cadEnabled && timelineForLabels.length >= 2) {
                const _chEvts: ChordEvent[] = [];
                for (const ev of timelineForLabels) {
                    if (!ev?.notes?.length) continue;
                    try {
                        // Substitute bass suspension-onset notes with their resolution
                        // so cadential pattern detection sees the target chord.
                        const SUSP_EPS_CAD = 1e-3;
                        const notesForCad = (ev.notes as any[]).map((n: any) => {
                            if (!n || n.isRest || (n.voice ?? 1) !== 4) return n;
                            const s = n.isSuspension;
                            if (!s || typeof s.fromAbsBeat !== 'number') return n;
                            if (Math.abs(s.fromAbsBeat - ev.absBeat) >= SUSP_EPS_CAD) return n;
                            if (typeof s.resolvedMidi !== 'number') return n;
                            return { ...n, midi: s.resolvedMidi, pitch: s.resolvedPitch ?? n.pitch,
                                octave: s.resolvedOctave ?? n.octave,
                                accidental: s.resolvedAccidental != null ? s.resolvedAccidental : (n.accidental ?? ''),
                                isSuspension: undefined };
                        }).filter((n: any) => {
                            if (!n || n.isRest) return false;
                            // Exclude ornamental notes from cadential pattern recognition.
                            // Check both direct field AND override map — overrides loaded from a project
                            // file are stored separately and not merged into note objects.
                            if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
                            if (n.id) {
                                const ov = ornOverrideMap.get(n.id);
                                if (ov && ov !== 'structural') return false;
                            }
                            const _midi = Number(n.midi);
                            if (Number.isFinite(_midi)) {
                                const ov2 = ornOverrideMap.get(`${_midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`);
                                if (ov2 && ov2 !== 'structural') return false;
                            }
                            if (n.isPassing || n.isNeighbor || n.isAppoggiatura || n.isAnticipation || n.isEscape || n.isCambiata) return false;
                            return true;
                        });
                        const cands = identifyChordCandidates(notesForCad, ornOverrideRecord);
                        const top = cands?.[0];
                        if (!top?.root) continue;
                        // root can be string or object {noteIndex, midi}
                        const rootPc = typeof top.root === 'string'
                            ? noteNameToPc(top.root)
                            : (((Number((top.root as any)?.noteIndex ?? (top.root as any)?.midi ?? 0)) % 12) + 12) % 12;
                        const bassMidi = Math.min(...(notesForCad as any[]).map((n: any) => Number(n.midi)));
                        const bassPc = ((bassMidi % 12) + 12) % 12;
                        const _newEv = { rootPc, quality: top.type || '', bassPc, absBeat: ev.absBeat,
                            notePcs: [...new Set<number>((notesForCad as any[]).map((n: any) => ((Number(n.midi) % 12) + 12) % 12))] };
                        // Dedup: collapse consecutive events that don't represent a real harmonic change.
                        // The cadential pattern matcher slides a window over consecutive events; spurious
                        // partial-chord events (e.g. when a soprano onset gets filtered as ornamental,
                        // leaving only 2 of the 3 chord tones) corrupt multi-slot pattern matching.
                        const _prev = _chEvts[_chEvts.length - 1];
                        const _isSameChord = _prev
                            && _prev.rootPc === _newEv.rootPc
                            && _prev.quality === _newEv.quality
                            && _prev.bassPc === _newEv.bassPc;
                        const _isSubsetOfPrev = _prev
                            && _prev.bassPc === _newEv.bassPc
                            && !!_prev.notePcs
                            && _newEv.notePcs.length < _prev.notePcs.length
                            && _newEv.notePcs.every(pc => _prev.notePcs!.includes(pc));
                        // Same-family collapse: consecutive events with same root and same
                        // quality FAMILY (Dominant 7 / Dominant 9 / Dominant 11 / Dominant 13
                        // are all "dominant" — they're micro-variations of the same harmony
                        // caused by melodic decoration). Without this, a multi-event
                        // dominant section breaks the cadential pattern matcher's sliding
                        // window: e.g. A°→D7♭9→D11→D7→Gm has 5 events and no 3-element window
                        // contains both A° and Gm with the dominant in between.
                        const _isSameFamily = _prev
                            && _prev.rootPc === _newEv.rootPc
                            && qualityFamily(_prev.quality) === qualityFamily(_newEv.quality)
                            && qualityFamily(_newEv.quality) !== 'other';
                        if (_isSameChord || _isSubsetOfPrev || _isSameFamily) {
                            // skip — same chord, subset, or same harmonic family
                        } else {
                            _chEvts.push(_newEv);
                        }
                    } catch { /* skip event */ }
                }
                const _cadMatchesRaw = evaluateCadentialPatterns(
                    _chEvts, noteNameToPc(currentTonic), isMinorMode, { minConfidence: 70 },
                );                // Post-filter: reject cadence matches whose "dominant" chord is
                // actually a Major-7th sonority (maj7 ≠ dominant). The dominant
                // slot is always the penultimate chord in the formula window.
                const _homeScalePcs0 = new Set(getScalePcs(noteNameToPc(currentTonic), isMinorMode));
                const _cadMatches = _cadMatchesRaw.filter(m => {
                    // Find the penultimate event (the V slot)
                    const domBeat = (() => {
                        if (m.startBeat === m.endBeat) return m.startBeat;
                        const candidates = _chEvts.filter(e => e.absBeat >= m.startBeat && e.absBeat < m.endBeat);
                        return candidates.length > 0 ? candidates[candidates.length - 1].absBeat : m.startBeat;
                    })();
                    const domEv = _chEvts.find(e => Math.abs(e.absBeat - domBeat) < 0.05);
                    // Reject cadences whose dominant is maj7
                    if (domEv && /maj.*7|major\s*7/i.test(domEv.quality)) return false;
                    // Reject cadences whose resolution is a borrowed chord (modal interchange)
                    // UNLESS the dominant chord contains chromatic notes (notes outside the
                    // home scale), which indicates a genuine secondary dominant targeting
                    // a real modulation (e.g. C→Eb via Bb7→Eb, where Bb7 has Ab).
                    const resEv = _chEvts.find(e => Math.abs(e.absBeat - m.endBeat) < 0.05);
                    if (resEv && shouldBlockTonicization(resEv.rootPc, resEv.quality, currentTonic, isMinorMode)) {
                        const _domHasChromaticCad = domEv?.notePcs?.some(pc => !_homeScalePcs0.has(pc));
                        if (!_domHasChromaticCad) return false;
                        // else: allow — chromatic dominant is genuine evidence of modulation
                    }
                    // Reject cadences whose resolution is a dominant 7th sonority:
                    // a dom7 chord is not a stable "I" arrival — it's a passing
                    // secondary dominant (e.g. V/V → V7 is NOT a tonicization to V).
                    if (resEv && /dominant\s*7/i.test(resEv.quality)) return false;
                    // Reject cadences resolving to a diatonic degree of the home key:
                    // this is a secondary dominant (V/x → x), not a modulation —
                    // UNLESS the dominant contains a "differentiating PC": a note that
                    // is diatonic in the target key but NOT in the home key.
                    // This is the hallmark of a real modulation (e.g. F# in D7 for C→G).
                    if (resEv != null && _homeScalePcs0.has(resEv.rootPc)) {
                        const _tgtScale = new Set(getScalePcs(resEv.rootPc, qualityFamily(resEv.quality) !== 'major'));
                        const _domHasDiffPc = domEv?.notePcs?.some(pc => _tgtScale.has(pc) && !_homeScalePcs0.has(pc));
                        if (!_domHasDiffPc) return false;
                    }
                    return true;
                });
                const _manualBeats = new Set(
                    (analysisContexts || []).filter((c: any) => c.source !== 'inferred')
                        .map((c: AnalysisContext) => analysisContextAbsBeat(c)),
                );
                // Helper: when injecting a "return-to-home" inferred context,
                // find the most recent MANUAL override before the return beat
                // and return to that key instead of the file's initial tonic.
                // Without this, a manual override (e.g. "Bb major from m26")
                // gets silently superseded at the first cadential pattern that
                // injects a return-to-home reverting to currentTonic.
                // (definition lifted to the enclosing scope)
                for (const m of _cadMatches) {
                    // ── Cadential 6/4: collect the beat of the I6/4 chord so the
                    // label assembly loop can relabel it as V6/4 later.
                    if (/CAD64/i.test(m.formulaId)) {
                        const _expectedBassPc = (m.targetTonicPc + 7) % 12;
                        const _i64Ev = _chEvts.find(e =>
                            e.absBeat >= m.startBeat - 1e-6
                            && e.absBeat <= m.endBeat + 1e-6
                            && e.rootPc === m.targetTonicPc
                            && e.bassPc === _expectedBassPc,
                        );
                        if (_i64Ev) _cadential64Beats.add(_i64Ev.absBeat);
                    }

                    // ── Overlap guard: skip cadences whose startBeat falls
                    // inside the span of a higher-confidence cadence.
                    // This prevents a spurious low-confidence deceptive
                    // cadence (e.g. Db conf=70) from overriding a
                    // legitimate tonicization (e.g. Ab conf=85).
                    const _isOverlapped = _cadMatches.some(other =>
                        other !== m &&
                        other.confidence > m.confidence &&
                        m.startBeat >= other.startBeat - 1e-6 &&
                        m.startBeat <= other.endBeat + 1e-6,
                    );
                    if (_isOverlapped) continue;

                    if (!_manualBeats.has(m.startBeat)) {
                        // Deceptive cadences confirm the *matched* key
                        // (e.g. Am when the home key is C). Inject the
                        // matched tonic at the cadence span, then return to
                        // the home key after the resolution.
                        if (m.deceptive) {
                            const _decTonic = pcToNoteName(m.targetTonicPc, { tonic: currentTonic, isMinor: isMinorMode });
                            const _decMinor = m.targetIsMinor;
                            pushInferred({
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
                                // Don't return to home if the next beat is
                                // covered by another cadential match (which
                                // has its own context).
                                const decReturnBeat = nextAfterDec.absBeat;
                                const decCoveredByNext = _cadMatches.some(
                                    other => other !== m
                                        && other.startBeat <= decReturnBeat + 1e-6
                                        && other.endBeat >= decReturnBeat - 1e-6,
                                );
                                if (!decCoveredByNext && !_manualBeats.has(decReturnBeat)) {
                                    const _h = _resolveHomeAt(nextAfterDec.absBeat);
                                    pushInferred({
                                        absBeat: nextAfterDec.absBeat,
                                        newTonic: _h.tonic,
                                        newIsMinor: _h.isMinor,
                                        score: 0,
                                        source: 'inferred',
                                    });
                                }
                            }
                            continue;
                        }
                        // ── Tonicisation START: switch to target key ──
                        pushInferred({
                            absBeat: m.startBeat,
                            newTonic: pcToNoteName(m.targetTonicPc, { tonic: currentTonic, isMinor: isMinorMode }),
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
                                    { tonic: pcToNoteName(m.targetTonicPc, { tonic: currentTonic, isMinor: isMinorMode }), isMinor: m.targetIsMinor });
                            }
                            const returnBeat = nextEvAfterRes.absBeat;
                            const coveredByNext = _cadMatches.some(
                                other => other !== m
                                    && other.startBeat <= returnBeat + 1e-6
                                    && other.endBeat >= returnBeat - 1e-6,
                            );
                            // Only return to home key if the next chord is NOT diatonic
                            // to the target key — i.e. the music actually left the
                            // modulated key. If it's still diatonic, the modulation persists.
                            const nextIsDiatonicHome = nextEvAfterRes.notePcs?.every(pc => _homeScalePcs0.has(pc));
                            if (!coveredByNext && !nextIsDiatonic && nextIsDiatonicHome && !_manualBeats.has(returnBeat)) {
                                const _h = _resolveHomeAt(returnBeat);
                                pushInferred({
                                    absBeat: returnBeat,
                                    newTonic: _h.tonic,
                                    newIsMinor: _h.isMinor,
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
                    // A chord with a major 7th (e.g. Ebmaj7) is NOT a dominant
                    if (/maj.*7|major\s*7/i.test(dom.quality)) continue;
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
                    // If the resolution chord is a borrowed chord from the parallel
                    // minor (iv, ♭VI, ♭VII…), this is modal interchange, not a
                    // tonicization — skip.
                    if (shouldBlockTonicization(res.rootPc, res.quality, currentTonic, isMinorMode)) continue;
                    // Guard: if the resolution root is diatonic to the home key,
                    // this is usually a secondary dominant (V/x → x), not a modulation —
                    // UNLESS the dominant contains a differentiating PC (diatonic in
                    // the target key but NOT the home key), indicating a real modulation.
                    if (_homeScalePcs.has(targetPc)) {
                        const _dreTargetScale = new Set(getScalePcs(targetPc, targetIsMinor));
                        const _dreHasDiffPc = dom.notePcs?.some(pc => _dreTargetScale.has(pc) && !_homeScalePcs.has(pc));
                        if (!_dreHasDiffPc) continue;
                    }
                    // Skip if already covered by a cadential match or manual marker
                    const alreadyCovered = _effectiveCtxs.some(c =>
                        Math.abs(analysisContextAbsBeat(c) - dom.absBeat) < 0.1
                        && noteNameToPc(c.newTonic) === targetPc);
                    if (alreadyCovered) continue;
                    // Inject tonicisation context covering V + resolution
                    pushInferred({
                        absBeat: dom.absBeat,
                        newTonic: pcToNoteName(targetPc, { tonic: currentTonic, isMinor: isMinorMode }),
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
                                { tonic: pcToNoteName(targetPc, { tonic: currentTonic, isMinor: isMinorMode }), isMinor: targetIsMinor });
                        }
                        // Only return to home key if the next chord is NOT diatonic
                        // to the target key (= the music left the modulated key).
                        // If the next chord IS diatonic to the target key, the modulation
                        // persists — do not snap back to the home key.
                        const nextIsDiatonicHome = _nextAfterRes.notePcs?.every(pc => _homeScalePcs.has(pc));
                        if (!nextIsDiatonicD && nextIsDiatonicHome && !_manualBeats.has(_nextAfterRes.absBeat)) {
                            const _h = _resolveHomeAt(_nextAfterRes.absBeat);
                            pushInferred({
                                absBeat: _nextAfterRes.absBeat,
                                newTonic: _h.tonic,
                                newIsMinor: _h.isMinor,
                                score: 0,
                                source: 'inferred',
                            });
                        }
                    }
                }
            }
        } catch { /* cadential recognition failed gracefully */ }

        // ─── Chromatic Window Modulation Detection (experimental) ───
        try {
            if (_chromaticModulationEnabled) {
                const chromResults = detectChromaticModulations(
                    analyzedNotes as any, currentTonic, isMinorMode,
                    timeSignature, undefined,
                    _effectiveCtxs,
                );
                for (const cr of chromResults) {
                    // Compute absBeat range for the modulation region
                    const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
                    const regionStartAbs = cr.startMeasure * beatsPerMeasure;
                    const regionEndAbs = (cr.endMeasure + 1) * beatsPerMeasure;

                    // Remove any inferred (cadential) contexts WITHIN the modulation region
                    // that would otherwise override the chromatic detection
                    for (let ci = _effectiveCtxs.length - 1; ci >= 0; ci--) {
                        const c = _effectiveCtxs[ci];
                        if (c.source !== 'inferred') continue; // keep manual contexts
                        const cAbs = analysisContextAbsBeat(c);
                        if (cAbs >= regionStartAbs && cAbs < regionEndAbs) {
                            _effectiveCtxs.splice(ci, 1);
                        }
                    }

                    // Add modulation context
                    pushInferred({
                        measureIndex: cr.startMeasure,
                        newTonic: cr.newTonicName,
                        newIsMinor: cr.newIsMinor,
                        source: 'inferred',
                    });

                    // Return to home key after region ends
                    const returnMeasure = cr.endMeasure + 1;
                    const returnAlready = _effectiveCtxs.some(c =>
                        c.measureIndex != null && Math.abs(c.measureIndex - returnMeasure) <= 1);
                    if (!returnAlready) {
                        const _h = _resolveHomeAt(returnMeasure * beatsPerMeasure);
                        pushInferred({
                            measureIndex: returnMeasure,
                            newTonic: _h.tonic,
                            newIsMinor: _h.isMinor,
                            source: 'inferred',
                        });
                    }
                }
            }
        } catch { /* chromatic modulation detection failed gracefully */ }

        // ─── Tonicization Hints (user-inserted, self-exhausting) ───────────
        // For each hint, look ahead through the timeline events to find how
        // long the hint tonic "fits" better than the home tonic, then inject
        // start + return contexts exactly like cadential pattern detection does.
        try {
            if (tonicizationHints && tonicizationHints.length > 0) {
                const hintHomeScalePcs = new Set(getScalePcs(noteNameToPc(currentTonic), isMinorMode));
                // Build a lightweight chord-event list from the timeline (independent of _cadEnabled)
                const _hintEvts = timelineForLabels
                    .filter(ev => ev?.notes?.length)
                    .map(ev => {
                        const pcs = (ev.notes as any[])
                            .filter((n: any) => n && !n.isRest)
                            .map((n: any) => ((Number(n.midi) % 12) + 12) % 12);
                        return { absBeat: ev.absBeat, pcs };
                    })
                    .filter(ev => ev.pcs.length > 0);

                const _hintManualBeats = new Set(
                    (analysisContexts || []).filter((c: any) => c.source !== 'inferred')
                        .map((c: AnalysisContext) => analysisContextAbsBeat(c)),
                );

                for (const hint of tonicizationHints) {
                    const hintTonicPc = noteNameToPc(hint.tonic);
                    const hintScalePcs = new Set(getScalePcs(hintTonicPc, hint.isMinor));
                    // Skip if hint tonic == home tonic
                    if (hintTonicPc === noteNameToPc(currentTonic) && hint.isMinor === isMinorMode) continue;
                    // Skip if a manual context already covers this beat
                    if (_hintManualBeats.has(hint.absBeat)) continue;

                    // Find events from hint.absBeat forward
                    const eventsFromHint = _hintEvts.filter(ev => ev.absBeat >= hint.absBeat - 1e-6);
                    if (!eventsFromHint.length) continue;

                    // Greedy lookahead: continue while hintFit >= homeFit
                    let lastHintBeat = hint.absBeat;
                    for (const ev of eventsFromHint) {
                        if (!ev.pcs.length) continue;
                        const hintFit = ev.pcs.filter((pc: number) => hintScalePcs.has(pc)).length / ev.pcs.length;
                        const homeFit = ev.pcs.filter((pc: number) => hintHomeScalePcs.has(pc)).length / ev.pcs.length;
                        // Stop when home clearly dominates (gap > 0.3) and we've moved past the hint beat
                        if (homeFit > hintFit + 0.3 && ev.absBeat > hint.absBeat + 1e-6) break;
                        lastHintBeat = ev.absBeat;
                    }

                    // Inject tonicization start
                    pushInferred({
                        absBeat: hint.absBeat,
                        newTonic: hint.tonic,
                        newIsMinor: hint.isMinor,
                        score: 80,
                        source: 'inferred',
                    });

                    // Inject return-to-home at the next event after lastHintBeat
                    const returnEv = _hintEvts.find(ev => ev.absBeat > lastHintBeat + 1e-6);
                    if (returnEv && !_hintManualBeats.has(returnEv.absBeat)) {
                        const _h = _resolveHomeAt(returnEv.absBeat);
                        pushInferred({
                            absBeat: returnEv.absBeat,
                            newTonic: _h.tonic,
                            newIsMinor: _h.isMinor,
                            score: 0,
                            source: 'inferred',
                        });
                    }
                }
            }
        } catch { /* tonicization hints failed gracefully */ }

        // Flush all pending inferred contexts, applying suppression filter
        flushInferred();


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
        const autoOverrideByAbsBeat = buildEngineHarmonyOverrideMap(params.autoHarmonyLabelOverrides || []);
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
                const _accHint = (accHintEnabled && accompanimentTracks && accompanimentTracks.length > 0)
                    ? getAccompanimentPcsForBeat(accompanimentTracks.filter(t => !t.muted && t.visible !== false), absBeat, ornOverrideMap)
                    : null;
                const r = getRomanAnalysis(structuralNotes(ev?.notes || [], ornOverrideMap), ctxTonic, ctxIsMinor, {
                    ornamentOverrides: ornOverrideRecord,
                    ...(_accHint && _accHint.pcs.length > 0 ? { accHintPcs: _accHint.pcs, accLowestMidi: _accHint.lowestMidi, accForced: true } : {}),
                });

                // Compute root PC for fallback resolution matching (V/x → X where quality differs).
                const rootPc = (() => {
                    try {
                        const pcs = new Set<number>((ev?.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi)).map((n: any) => ((Number(n.midi) % 12) + 12) % 12));
                        if (pcs.size < 3) return null;
                        const arr = Array.from(pcs);
                        for (const pc of arr) {
                            const maj = new Set([pc, (pc + 4) % 12, (pc + 7) % 12]);
                            const min = new Set([pc, (pc + 3) % 12, (pc + 7) % 12]);
                            const dim = new Set([pc, (pc + 3) % 12, (pc + 6) % 12]);
                            const aug = new Set([pc, (pc + 4) % 12, (pc + 8) % 12]);
                            const matches = (s: Set<number>) => arr.every(x => s.has(x));
                            if (matches(maj) || matches(min) || matches(dim) || matches(aug)) return pc;
                        }
                        return null;
                    } catch { return null; }
                })();
                return {
                    ev,
                    absBeat,
                    q: qAbs(absBeat),
                    ctxTonic,
                    ctxIsMinor,
                    roman: String(r?.roman || ''),
                    rootPc,
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
                    // Non sovrascrivere se il Roman globale è già vii° (sensibile chiara: tonicizzazione già esplicita)
                    if (!/^vii°/i.test(homeR)) {autoRomanDisplayByAbsBeat.set(bEntry.q, `${rTgt.roman}=${homeR}`);
                    }
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
                // Extended scale: natural + harmonic + melodic (for diatonic guard)
                const _scaleExt = new Set(getScalePcs(_globalPc, isMinorMode));
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
                        // Guard: if K's root is diatonic to the home key, V→I in K
                        // is really V/x→x (secondary dominant), not a modulation.
                        const _kPcGuard = noteNameToChromaticIndex(K);
                        if (_kPcGuard >= 0 && _scaleExt.has(_kPcGuard)) continue;
                        const rJ = getRomanAnalysis(stJ, K, false);
                        if (!rJ || rJ.roman !== 'I') continue;
                        // Guard: a minor chord on the tonic (has ♭3 in figures)
                        // is not a genuine "I" arrival — it is i (modal interchange).
                        // Skip so tonicization is not spuriously triggered.
                        // Use chord quality (not figures) to avoid false positives on inversions.
                        {
                            const _arrCands = identifyChordCandidates(stJ as any);
                            const _arrQ = (_arrCands?.[0]?.type || '').toLowerCase();
                            if (_arrQ.includes('minor') && !_arrQ.includes('diminish')) continue;
                        }
                        // Guard: skip enharmonic tautological match (e.g. K='Gb' for an F# chord)
                        const _kPc = noteNameToChromaticIndex(K);
                        // If the arrival chord is a borrowed chord from the parallel
                        // minor (iv, ♭VI, …), prefer modal interchange over tonicization —
                        // UNLESS the preceding chord has chromatic evidence (notes outside
                        // the home scale), which indicates a genuine secondary dominant.
                        {
                            const _arrivCands = identifyChordCandidates(stJ as any);
                            const _arrivQ = _arrivCands?.[0]?.type || '';
                            if (shouldBlockTonicization(_kPc, _arrivQ, currentTonic, isMinorMode)) {
                                // Check: does the dominant (stPrev) contain chromatic notes?
                                let _domHasChromatic = false;
                                for (const _dn of stPrev) {
                                    const _dpc = ((Number((_dn as any).midi) % 12) + 12) % 12;
                                    if (!_scale.has(_dpc)) { _domHasChromatic = true; break; }
                                }
                                if (!_domHasChromatic) continue; // block: no chromatic evidence
                                // else: allow — this is a real secondary dominant
                            }
                        }
                        const _rootNote = stJ.find(n => ((Number(n?.midi) % 12) + 12) % 12 === _kPc);
                        if (_rootNote) {
                            const _sp = String(_rootNote.pitch || '') + (_rootNote.accidental === 'sharp' ? '#' : _rootNote.accidental === 'flat' ? 'b' : '');
                            if (_sp !== K) continue;
                        }
                        const rPrev = getRomanAnalysis(stPrev, K, false);
                        if (!rPrev || !/^(V|vii[°o])/.test(rPrev.roman)) continue;
                        // V/x (secondary dominant of another degree) is not the
                        // primary dominant of K — skip auto-tonicization.
                        if (rPrev.roman.includes('/')) continue;
                        // V° (diminished) is not a real dominant — skip auto-tonicization.
                        // However vii° IS a valid leading-tone dominant function.
                        const _isLeadingTone = /^vii[°o]/.test(rPrev.roman);
                        if (!_isLeadingTone && /°|dim/.test(rPrev.roman)) continue;
                        // A chord with a major 7th (e.g. Ebmaj7) is NOT a dominant —
                        // dominants have minor 7ths. Check the actual pitch content.
                        // Skip this check for vii° which has no 7th from the dominant root.
                        if (!_isLeadingTone) {
                            const _prevPcs = [...new Set(stPrev.map((n: any) => ((Number(n?.midi) % 12) + 12) % 12))];
                            const _kPc = noteNameToChromaticIndex(K);
                            // The dominant root is a 5th above K (7 semitones)
                            const _domRoot = (_kPc + 7) % 12;
                            // Major 7th above dominant root = 11 semitones
                            const _maj7Pc = (_domRoot + 11) % 12;
                            // Minor 7th above dominant root = 10 semitones
                            const _min7Pc = (_domRoot + 10) % 12;
                            const _hasMaj7 = _prevPcs.includes(_maj7Pc);
                            const _hasMin7 = _prevPcs.includes(_min7Pc);
                            // If the chord has a major 7th but no minor 7th, it's not a dominant
                            if (_hasMaj7 && !_hasMin7) continue;
                        }

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
                            let _firstDisplayedForK = true;
                            for (let s = firstIdx; s <= lastIdx; s++) {
                                if (autoRomanDisplayByAbsBeat.has(base[s].q) || overrideByAbsBeat.has(base[s].q)) continue;
                                if (!base[s].ev?.notes?.length) continue;

                                // GUARD: non riscrivere vii°, vii°/X, ♭V, ♭II, ♭III, ♭VI, ♭VII come tonicizzazione cromatica.
                                // Sono già funzioni armoniche esplicite (sensibili o gradi prestati).
                                {
                                    const _hr = String(base[s].roman || '');
                                    if (/^vii°/i.test(_hr)) continue;
                                    if (/^♭/.test(_hr)) continue;
                                }

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

                                // Never relabel the home key's dominant 7th (V7, V9…) as
                                // a secondary function.  The tritone resolution makes V7
                                // unambiguously the primary dominant.  A plain V triad
                                // can legitimately be I of a secondary key (tonicization).
                                {
                                    const _homeRoman = String(base[s].roman || '');
                                    // The tonic chord (I/i) must never be relabeled as a
                                    // secondary function — it's the strongest harmonic anchor.
                                    // Also protect V7/V9 (dom7 quality).
                                    if (/^(I|i)(6|64)?$/.test(_homeRoman)) { /* tonic anchor */ continue; }
                                    if (/^V/.test(_homeRoman) && !_homeRoman.includes('/')) {
                                        const _stSDom = structuralNotes(base[s].ev.notes, ornOverrideMap);
                                        const _candsDom = identifyChordCandidates(_stSDom as any);
                                        const _topQDom = (_candsDom?.[0]?.type || '').toLowerCase();
                                        if (_topQDom.includes('dominant') && /7|9|11|13/.test(_topQDom)) continue;
                                    }
                                }

                                // If this chord is already a borrowed chord (modal interchange)
                                // in the home key (iv, ♭VI, ♭VII…), prefer that label over the
                                // tonicization display — modal interchange is more informative.
                                {
                                    const _stSCheck = structuralNotes(base[s].ev.notes, ornOverrideMap);
                                    const _candsCheck = identifyChordCandidates(_stSCheck as any);
                                    const _topC = _candsCheck?.[0];
                                    const _topQ = _topC?.type || '';
                                    const _topRootPc = (() => {
                                        if (!_topC?.root) return -1;
                                        if (typeof _topC.root === 'string') return noteNameToChromaticIndex(_topC.root);
                                        const ni = Number((_topC.root as any)?.noteIndex);
                                        return Number.isFinite(ni) ? ((ni % 12) + 12) % 12 : -1;
                                    })();
                                    if (_topRootPc >= 0 && shouldBlockTonicization(_topRootPc, _topQ, currentTonic, isMinorMode)) continue;
                                }

                                const stS = structuralNotes(base[s].ev.notes, ornOverrideMap);
                                const rS = getRomanAnalysis(stS, K, false);
                                if (rS) {
                                    // Strip any secondary-function suffix (e.g. V/V → V) to prevent
                                    // triple-nesting like V/V/IV.  We only want the LOCAL function in key K.
                                    let localR = String(rS.roman || '').replace(/\/.*$/, '');

                                    // Melodic minor correction: in a tonicization to a minor chord,
                                    // a half-diminished chord whose root is the raised 6th degree
                                    // (= semitone below the 5th of K) is vi° not vii°.
                                    // E.g. C#m7♭5 in Em context = vi° (melodic/dorian minor), not vii°.
                                    if (/^vii[°o]/.test(localR)) {
                                        const _arrCands = identifyChordCandidates(stJ as any);
                                        const _arrQ = (_arrCands?.[0]?.type || '').toLowerCase();
                                        if (_arrQ.includes('minor')) {
                                            // Arrival chord is minor → tonicization target is minor.
                                            // Check if this chord's root is the raised 6th (major 6th above tonic of K)
                                            const _kPcLocal = noteNameToChromaticIndex(K);
                                            const _raised6thPcLocal = ((_kPcLocal + 9) % 12);
                                            const _stSPcs = (stS as any[]).map((n: any) => ((Number(n?.midi) % 12) + 12) % 12);
                                            const _bassMidi = Math.min(...(stS as any[]).filter((n: any) => Number.isFinite(n?.midi)).map((n: any) => Number(n.midi)));
                                            const _bassPc = ((_bassMidi % 12) + 12) % 12;
                                            // Raised 6th = major 6th above tonic
                                            if (_bassPc === _raised6thPcLocal) {
                                                localR = localR.replace(/^vii/, 'vi');
                                            }
                                        }
                                    }
                                    if (compactTonicization) {autoRomanDisplayByAbsBeat.set(base[s].q, _firstDisplayedForK ? `${localR}/${degLabel}` : localR);
                                    } else {
                                        const spanLen = lastIdx - firstIdx + 1;
                                        let display: string;
                                        if (spanLen >= 4) {
                                            // Extended modulation: entry=parent→child, inside=local, exit=child→parent
                                            if (s === firstIdx) {
                                                display = `${degLabel}=${localR}`;
                                            } else if (s === lastIdx) {
                                                display = `${localR}=${degLabel}`;
                                            } else {
                                                display = localR;
                                            }
                                        } else {
                                            // Short tonicization: arrival=localR=degLabel, others=localR/degLabel
                                            display = (s === j) ? `${localR}=${degLabel}` : `${localR}/${degLabel}`;
                                        }autoRomanDisplayByAbsBeat.set(base[s].q, display);
                                    }
                                    _firstDisplayedForK = false;
                                }
                            }
                            break; // don't try more keys for this arrival beat
                        }
                    }
                }
            }

            // ── Melodic-minor vi° at context boundary ──
            // When a vii° chord in the old context immediately precedes a V→i
            // cadence in a new minor context, the vii° is really vi° of the new
            // minor key (melodic/dorian raised 6th).  E.g. C#m7♭5 before V→i in
            // Em = vi°/ii in D major.
            for (let i = 0; i < base.length - 2; i++) {
                if (autoRomanDisplayByAbsBeat.has(base[i].q)) continue;
                if (!/^vii[°o]/.test(base[i].roman)) continue;
                const next = base[i + 1];
                // Next chord must be in a different, minor context and be V
                if (next.ctxTonic === base[i].ctxTonic) continue;
                if (!next.ctxIsMinor) continue;
                if (next.roman !== 'V') continue;
                // The chord after V should resolve to i in the same context
                const res = base[i + 2];
                if (res.ctxTonic !== next.ctxTonic || res.roman !== 'i') continue;
                // Verify root is the raised 6th (semitone below 5th of new key)
                const _stVii = structuralNotes(base[i].ev?.notes || [], ornOverrideMap);
                const _cands = identifyChordCandidates(_stVii as any);
                const _q = (_cands?.[0]?.type || '').toLowerCase();
                if (!_q.includes('diminish') && !(_q.includes('minor') && _q.includes('5'))) continue;
                const _newKeyPc = noteNameToChromaticIndex(next.ctxTonic);
                // Raised 6th = major 6th above the tonic (e.g. C# in Em = E+9 semitones)
                const _raised6thPc = ((_newKeyPc + 9) % 12);
                const _bassMidi = Math.min(...(_stVii as any[]).filter((n: any) => Number.isFinite(n?.midi)).map((n: any) => Number(n.midi)));
                const _bassPc = ((_bassMidi % 12) + 12) % 12;
                if (_bassPc !== _raised6thPc) continue;
                // Compute degree label for the new context tonic in the global key
                const _ctxBoundaryGlobalPc = noteNameToChromaticIndex(currentTonic);
                const _ctxBoundaryTargetPc = noteNameToChromaticIndex(next.ctxTonic);
                const _ctxBoundaryInterval = ((_ctxBoundaryTargetPc - _ctxBoundaryGlobalPc) % 12 + 12) % 12;
                const _ctxBoundaryDegNames = isMinorMode
                    ? ['i','\u266DII','ii\u00B0','\u266DIII','iv','v','\u266DVI','\u266DVII','VI','vi\u00B0','VII','vii\u00B0']
                    : ['I','\u266DII','ii','\u266DIII','iii','IV','\u266EIV\u00B0','V','\u266DVI','vi','\u266DVII','vii\u00B0'];
                const _newKeyDeg = _ctxBoundaryDegNames[_ctxBoundaryInterval] || null;
                if (!_newKeyDeg) continue;autoRomanDisplayByAbsBeat.set(base[i].q, `vi°/${_newKeyDeg}`);
            }

            const maxLookaheadBeats = beatsPerMeasure * 2;
            for (let j = 0; j < base.length; j++) {
                const bj = base[j];
                const rj = String(bj.roman || '');
                const m = rj.match(/^([Vv])\/(.+)$/);
                if (!m) continue;
                const targetRoman = String(m[2] || '').trim();
                if (!targetRoman) continue;

                // V/X on a very weak sub-beat (e.g. beat 3.5 in 4/4) is usually
                // a passing sonority, not a real secondary dominant. Skip pivot
                // generation for these to avoid spurious i=X labels.
                const bjAbsBeat = Number(bj.absBeat);
                if (Number.isFinite(bjAbsBeat)) {
                    const frac = ((bjAbsBeat % 1) + 1) % 1;
                    if (frac > 0.01 && frac < 0.99) continue; // sub-beat like .5, .25, .75
                }

                // Skip if this beat is already protected as a resolution target of a
                // preceding V/x — its base roman (e.g. V/vi) is a stale analysis that
                // will be overridden by the autoRomanDisplayByAbsBeat (e.g. III).
                const bjQ0 = Number(bj.q);
                if (Number.isFinite(bjQ0) && protectedAbsBeats.has(bjQ0)) continue;

                // Find an arrival chord labeled exactly as the target within 2 measures.
                let k = -1;
                for (let t = j + 1; t < base.length; t++) {
                    if ((base[t].absBeat - bj.absBeat) > maxLookaheadBeats + 1e-6) break;
                    if (String(base[t].roman || '') === targetRoman) {
                        k = t;
                        break;
                    }
                }

                // Fallback: if no exact roman match, find the next chord whose root PC
                // matches the expected resolution degree. This catches quality mismatches
                // such as V/iii → III (major instead of minor) in modulating sequences.
                if (k < 0) {
                    try {
                        const _tonicPc = noteNameToChromaticIndex(String(bj.ctxTonic || 'C'));
                        const _degIdx = degreeIndexFromRoman(targetRoman);
                        if (_tonicPc != null && _tonicPc >= 0 && _degIdx != null) {
                            const _ints = scaleIntervalsForContext(!!bj.ctxIsMinor);
                            const _expectedPc = (((_tonicPc + (_ints[_degIdx] ?? 0)) % 12) + 12) % 12;
                            for (let t = j + 1; t < base.length; t++) {
                                if ((base[t].absBeat - bj.absBeat) > maxLookaheadBeats + 1e-6) break;
                                const rpc = base[t].rootPc;
                                if (rpc != null && Number.isFinite(rpc) && (((rpc % 12) + 12) % 12) === _expectedPc) {
                                    k = t;
                                    break;
                                }
                            }
                        }
                    } catch { /* ignore */ }
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
                        // When the resolution was found via rootPC fallback (quality mismatch),
                        // determine the actual quality from the chord and display the correct
                        // global roman numeral (e.g. III instead of i=iii for a major triad
                        // on the iii degree).
                        const resolvedByExactRoman = String(bk.roman || '') === targetRoman;
                        if (resolvedByExactRoman) {
                            const localTonicRoman = tonicizedIsMinor ? 'i' : 'I';
                            // Only show when the global roman differs (otherwise it's noisy).
                            if (String(bk.roman || '') && String(bk.roman || '') !== localTonicRoman) {autoRomanDisplayByAbsBeat.set(bk.q, `${localTonicRoman}=${targetRoman}`);
                            }
                        } else {
                            // Quality mismatch: show the target degree with the actual quality.
                            // e.g. V/iii → C# Maj → display "III" (uppercase = major)
                            const chordIsMajor = (() => {
                                try {
                                    const rpc = bk.rootPc;
                                    if (rpc == null) return null;
                                    const pcs = new Set<number>((bk.ev?.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi)).map((n: any) => ((Number(n.midi) % 12) + 12) % 12));
                                    const majThird = (rpc + 4) % 12;
                                    const minThird = (rpc + 3) % 12;
                                    if (pcs.has(majThird)) return true;
                                    if (pcs.has(minThird)) return false;
                                    return null;
                                } catch { return null; }
                            })();
                            const baseTarget = targetRoman.replace(/[°+]/g, '');
                            const displayRoman = chordIsMajor === true
                                ? baseTarget.toUpperCase()
                                : chordIsMajor === false
                                    ? baseTarget.toLowerCase()
                                    : baseTarget.toUpperCase();autoRomanDisplayByAbsBeat.set(bk.q, displayRoman);
                        }
                    }
                } catch { /* ignore */ }

                // Propagate protection to subsequent beats in the same measure that share
                // the same PC set as the resolution chord. This suppresses spurious labels
                // (e.g. V) on weak beats caused by bass arpeggiation under a held chord.
                try {
                    const bk = base[k];
                    if (bk) {
                        const resPcs = new Set((bk.ev?.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi)).map((n: any) => ((Number(n.midi) % 12) + 12) % 12));
                        if (resPcs.size >= 2) {
                            const resDisplay = autoRomanDisplayByAbsBeat.get(bk.q);
                            for (let t = k + 1; t < base.length; t++) {
                                const bt = base[t];
                                if ((bt.absBeat - bk.absBeat) >= beatsPerMeasure - 1e-6) break;
                                const btPcs = new Set((bt.ev?.notes || []).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi)).map((n: any) => ((Number(n.midi) % 12) + 12) % 12));
                                // Check if btPcs is a subset of resPcs (same harmony, possibly fewer voices)
                                let isSubset = btPcs.size > 0;
                                for (const pc of btPcs) { if (!resPcs.has(pc)) { isSubset = false; break; } }
                                if (isSubset) {
                                    protectedAbsBeats.add(bt.q);

                if (resDisplay) autoRomanDisplayByAbsBeat.set(bt.q, resDisplay);
                                }
                            }
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
                    // Don't relabel beats that already carry a secondary-function
                    // label (e.g. vii°/IV) — they belong to a different tonicization.
                    if (String(bi.roman || '').includes('/')) continue;

                    const rr = getRomanAnalysis(structuralNotes(bi.ev?.notes || [], ornOverrideMap), tonicizedTonic, tonicizedIsMinor, { ornamentOverrides: ornOverrideRecord });
                    // Strip any secondary-function suffix to prevent nesting (e.g. vii°/V → vii°)
                    const localRoman = String(rr?.roman || '').replace(/\/.*$/, '');

                    // Also support the common pre-dominant pattern in tonicized minor:
                    // ii° – V – i (e.g., in G: C#° – F# – Bm = ii°/iii – V/iii – i=iii).
                    // This is often more musically informative than reading the diminished chord
                    // as vii°/V when it does not actually resolve to V.
                    if (localRoman && /^ii/i.test(localRoman) && (localRoman.includes('°') || localRoman.includes('ø'))) {
                        // Display-only — never overwrite the structural roman.autoRomanDisplayByAbsBeat.set(bi.q, `${localRoman}/${targetRoman}`);
                        continue;
                    }

                    // Melodic minor correction: in a tonicization to a minor key,
                    // a half-diminished chord on the raised 6th (e.g. C#m7♭5 in Em)
                    // appears as VI in the natural minor analysis.  Re-label it vi°/target,
                    // which reflects the melodic/dorian minor context.
                    if (tonicizedIsMinor && localRoman === 'VI') {
                        const _lbNotes = structuralNotes(bi.ev?.notes || [], ornOverrideMap);
                        const _lbCands = identifyChordCandidates(_lbNotes as any);
                        const _lbQ = String(_lbCands?.[0]?.type || '').toLowerCase();
                        if (_lbQ.includes('diminish') || (_lbQ.includes('minor 7') && _lbQ.includes('5'))) {autoRomanDisplayByAbsBeat.set(bi.q, `vi°/${targetRoman}`);
                            continue;
                        }
                    }

                    // Only reinterpret a *minor* subdominant as iv/target (e.g. Gm -> iv/ii in C).
                    // Do not relabel a major IV in the tonicized key (often a mixture/pivot sonority).
                    if (localRoman !== 'iv') continue;

                    // Double-check: a true iv is a minor triad. A dominant 7th
                    // chord (e.g. Eb7 = Eb-G-Bb-Db) is NOT iv — it's a dominant
                    // sonority regardless of scale degree. Also reject major/augmented.
                    {
                        const _ivNotes = structuralNotes(bi.ev?.notes || [], ornOverrideMap);
                        const _ivCands = identifyChordCandidates(_ivNotes as any);
                        const _ivQuality = String(_ivCands?.[0]?.type || '').toLowerCase();
                        if (_ivQuality.includes('dom') || _ivQuality.includes('major') || _ivQuality.includes('aug')) continue;
                    }

                    // Pivot display (keep base roman stable, but show that this chord is a pivot):
                    // Example in C: Am (vi) before V/iii→iii becomes vi=iv.
                    // Keep it short to reduce overlap; the target (/iii) is typically evident
                    // from nearby V/target and i=target labels.
                    const globalRomanHere = String(bi.roman || '').trim();
                    if (globalRomanHere) {autoRomanDisplayByAbsBeat.set(bi.q, `${globalRomanHere}=${localRoman}`);
                    } else {autoRomanDisplayByAbsBeat.set(bi.q, `${localRoman}/${targetRoman}`);
                    }
                }
            }

            // ── Post-filter: protect tonic & dominant-7th from spurious relabel ──
            // If a beat's raw roman in the home key is I/i (tonic) or V7 (dom7),
            // never override it with a secondary-function display label.
            for (const [abQ] of [...autoRomanDisplayByAbsBeat]) {
                const bEntry = base.find((b: any) => Math.abs(b.q - abQ) < 0.1);
                if (!bEntry) continue;
                const homeR = String(bEntry.roman || '');
                // Tonic chord anchor — never relabel
                if (/^(I|i)(6|64)?$/.test(homeR)) {
                    autoRomanDisplayByAbsBeat.delete(abQ);
                    continue;
                }
                // Dominant 7th anchor — never relabel
                if (/^V/.test(homeR) && !homeR.includes('/')) {
                    const _sn = structuralNotes(bEntry.ev?.notes || [], ornOverrideMap);
                    const _cc = identifyChordCandidates(_sn as any);
                    const _qq = (_cc?.[0]?.type || '').toLowerCase();
                    if (_qq.includes('dominant') && /7|9|11|13/.test(_qq)) {
                        autoRomanDisplayByAbsBeat.delete(abQ);
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
                            ? ((((best as any).root.noteIndex % 12) + 12) % 12)
                            : (Number.isFinite((best?.root as any)?.midi) ? ((((best as any).root.midi % 12) + 12) % 12) : null);
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
                                if (isSeventh && (isMajor7Like || isDominant7)) {
                                    // The 7th is a chord tone of a confident
                                    // 7th-chord candidate — keep it structural
                                    // so figures (7/5 etc.) are generated.
                                    return false;
                                }
                                // Non-7th chord tones of confident candidates:
                                return false;
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
                // User explicitly marked as structural → always keep as chord tone
                if (n.ornamentOverride === 'structural') return false;
                const ovById2 = ornOverrideMap.size > 0 ? (ornOverrideMap.get(n.id) ?? null) : null;
                if (ovById2 === 'structural') return false;

                const v = (n?.voice ?? 1) as number;
                if (v === 4) {
                    // By default keep the bass in the structural snapshot (it stabilizes labels).
                    // Exception: when the engine explicitly flags a short weak-beat bass note as an
                    // ornament (passing/escape/neighbor/etc.), ignore it so it doesn't create a
                    // spurious harmony label (e.g. V4 from a bass "nota di volta").
                    const isBassOrnFlag = !!(n.isPassing || n.isEscape || n.isCambiata || n.isNeighbor || n.isAnticipation || n.isAppoggiatura);
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
                    const hasNctFlag = !!(n.isAnticipation || n.isAppoggiatura || n.isCambiata || (n.isNeighbor && isStrongBeat));
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
                    if (n.isPassing || n.isEscape || n.isCambiata) {
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

                if (n.isPassing || n.isEscape || n.isCambiata) return true;

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
                    .filter((v: any): v is number => v != null && Number.isFinite(v)))].sort((a, b) => a - b);
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

        // Precompute: index of the last non-rest event for Picardy-third detection.
        const lastNonRestEventIndex = (() => {
            for (let i = timelineFiltered.length - 1; i >= 0; i--) {
                const ev: any = timelineFiltered[i];
                if ((ev?.notes || []).some((n: any) => n && !n.isRest)) return i;
            }
            return timelineFiltered.length - 1;
        })();

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
                // Guard: if the "appoggiatura" note forms a standard chord
                // interval with the bass (3rd, 5th, 7th…), it is likely a real
                // chord tone mis-tagged — skip substitution so the label sees
                // the actual vertical (e.g. Cm7 stays Cm7, not Ab).
                try {
                    const _appoggPc2 = ((Number(_an.midi) % 12) + 12) % 12;
                    const _bassN2 = (event.notes as any[])
                        .filter((nn: any) => nn && !nn.isRest && Number.isFinite(nn.midi))
                        .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                    if (_bassN2) {
                        const _bassPc2 = ((Number(_bassN2.midi) % 12) + 12) % 12;
                        const _iv = ((_appoggPc2 - _bassPc2) + 12) % 12;
                        // Standard chord intervals: unison(0), m3(3), M3(4), P5(7), m6(8), M6(9), m7(10), M7(11)
                        if ([0, 3, 4, 7, 8, 9, 10, 11].includes(_iv)) continue;
                    }
                } catch { /* ignore */ }
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
                            isEscape: false, isCambiata: false, isSuspension: undefined,
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
                                isEscape: false, isCambiata: false, isSuspension: undefined,
                            });
                        }
                    }
                    continue;
                }

                // In compound meters (6/8, 9/8, 12/8), bass lines are often written as
                // arpeggiations on the internal 8th/16th grid. Those short bass notes should
                // not flip the harmony label/figures on weak subdivisions.
                try {
                    const isCompoundHereBass = (() => {
                        const te = tsEffectiveAt(Number(event.absBeat));
                        return te.denominator === 8 && (te.numerator % 3 === 0) && te.numerator > 3;
                    })();
                    if (v === 4 && (isCompoundMeter || isCompoundHereBass)) {
                        const absBeat = Number(event.absBeat);
                        const inMeasure = getInMeasure(absBeat);
                        const strongPulse = isStrongAtAbsBeat(absBeat);
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
                        if (s && typeof s.fromAbsBeat === 'number' && String(s.type) !== 'app') {
                            if (Math.abs((s.fromAbsBeat as number) - Number(event.absBeat)) < 1e-3) {
                                lastStructural.delete(v);
                            } else {
                                // Held suspension: still sounding at this beat → structural
                                lastStructural.set(v, {
                                    ...n,
                                    isPassing: false, isNeighbor: false,
                                    isAppoggiatura: false, isAnticipation: false,
                                    isEscape: false, isCambiata: false, isSuspension: undefined,
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
                                // Guard: if the appoggiatura note forms a standard chord
                                // interval (3rd, 5th, 7th, or unison/octave) with the bass,
                                // it is likely a real chord tone (e.g. 7th) mis-tagged as
                                // appoggiatura — keep it structural instead of substituting.
                                const _appoggPc = ((Number(n.midi) % 12) + 12) % 12;
                                // Find the bass note from current context
                                const _bassN = (event.notes as any[])
                                    .filter((nn: any) => nn && !nn.isRest && Number.isFinite(nn.midi))
                                    .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
                                if (_bassN) {
                                    const _bassPc = ((Number(_bassN.midi) % 12) + 12) % 12;
                                    const _interval = ((_appoggPc - _bassPc) + 12) % 12;
                                    // 0=unison, 3/4=3rd, 7=5th, 8/9=6th, 10/11=7th
                                    const _chordIntervals = new Set([0, 3, 4, 7, 8, 9, 10, 11]);
                                    // Skip guard when the appoggiatura IS the bass note itself:
                                    // interval with self is always 0 (unison), which would incorrectly
                                    // prevent substitution. Bass appoggiaturas must still be substituted.
                                    const _isBassNote = _bassN === n || (Number(_bassN.midi) === Number(n.midi));
                                    if (!_isBassNote && _chordIntervals.has(_interval)) {
                                        // Appoggiatura is consonant/standard with bass — treat as structural
                                        lastStructural.set(v, { ...n, isAppoggiatura: false });
                                        continue;
                                    }
                                }
                                // Guard: don't substitute if the resolution pitch-class
                                // duplicates another voice already in the snapshot — this
                                // would collapse a richer chord (e.g. Cm7 → Ab major).
                                const _resPc = ((Number(_resolNote.midi) % 12) + 12) % 12;
                                const _existingPcs = new Set<number>();
                                for (const [_vk, _vn] of lastStructural.entries()) {
                                    if (_vk === v) continue;
                                    if (_vn && !_vn.isRest && Number.isFinite(_vn.midi)) {
                                        _existingPcs.add(((Number(_vn.midi) % 12) + 12) % 12);
                                    }
                                }
                                if (!_existingPcs.has(_resPc)) {
                                    lastStructural.set(v, _resolNote);
                                    continue;
                                }
                                // Resolution duplicates existing pc — keep the appoggiatura
                                // as structural (it was likely a real chord tone, e.g. 7th).
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

                lastStructural.set(v, _suspFlag ? { ...n, isSuspension: undefined } : n);
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
            // We scan fullNotes to find suspension-onset notes (they may already be absent
            // from harmonicNotes/fallbackHarmonicNotes due to lastStructural.delete).
            // When the suspension carries resolution data, substitute a synthetic note
            // so chord identification sees the target harmony (e.g. Db sus → C → I).
            const SUSP_EPS = 1e-3;
            const suspResolutions: any[] = [];
            for (const n of fullNotes) {
                if (!n || n.isRest) continue;
                const s = (n as any)?.isSuspension;
                if (!s || typeof s.fromAbsBeat !== 'number') continue;
                // Auto-detected: only substitute bass (voice 4). Manual: any voice.
                if (!s.manual && ((n as any).voice ?? 1) !== 4) continue;
                if (Math.abs(s.fromAbsBeat - event.absBeat) >= SUSP_EPS) continue;
                if (typeof s.resolvedMidi === 'number') {
                    // Guard: if the "suspended" note is the lowest note in the
                    // verticality AND it forms a standard chord interval (3rd, 5th,
                    // tritone, 7th) with the notes above, it is likely a real bass
                    // note (e.g. F in Fr+ = F-G-B-Db), not a true suspension.
                    // Don't substitute — the label would collapse to a wrong chord.
                    const _suspMidi = Number(n.midi);
                    const _otherNotes = (fullNotes || []).filter((on: any) =>
                        on && !on.isRest && Number.isFinite(on.midi) && on !== n
                        && !on.isSuspension);
                    const _isLowest = _otherNotes.every((on: any) => on.midi >= _suspMidi);
                    if (_isLowest && _otherNotes.length >= 2) {
                        // Check: does the suspended note form useful intervals with upper notes?
                        const _suspPc = ((_suspMidi % 12) + 12) % 12;
                        const _chordIvs = new Set([3, 4, 6, 7, 8, 9, 10, 11]); // m3,M3,tritone,P5,m6,M6,m7,M7
                        const _hasChordInterval = _otherNotes.some((on: any) => {
                            const _iv = ((((on.midi % 12) - _suspPc) % 12) + 12) % 12;
                            return _chordIvs.has(_iv);
                        });
                        if (_hasChordInterval) continue; // keep original bass, skip substitution
                    }
                    suspResolutions.push({
                        ...n,
                        midi: s.resolvedMidi,
                        pitch: s.resolvedPitch ?? n.pitch,
                        octave: s.resolvedOctave ?? n.octave,
                        accidental: s.resolvedAccidental != null ? s.resolvedAccidental : (n.accidental ?? ''),
                        isSuspension: undefined,
                        _isSuspensionResolutionSubstitute: true,
                    });
                }
            }
            // Voices for which we have a resolution substitute — remove originals
            const suspSubstVoices = new Set(suspResolutions.map((n: any) => n.voice ?? 1));
            const harmonicNotesNoSuspAtThisBeat = fallbackHarmonicNotes.filter((n: any) => {
                // Remove if we have a substitution for this voice (covers cases
                // where fallbackHarmonicNotes lacks the isSuspension flag)
                if (suspSubstVoices.has(n.voice ?? 1)) return false;
                const s = n?.isSuspension;
                if (!s || typeof s.fromAbsBeat !== 'number') return true;
                return Math.abs(s.fromAbsBeat - event.absBeat) >= SUSP_EPS;
            });
            if (suspResolutions.length) harmonicNotesNoSuspAtThisBeat.push(...suspResolutions);

            const analysisNotes = (harmonicNotesNoSuspAtThisBeat.length >= 2)
                ? harmonicNotesNoSuspAtThisBeat
                : harmonicNotes;


            // For naming (roman + chord symbol), treat consonant "neighbor/anticipation" notes on
            // strong beats as chord tones. This avoids cases where a true chord tone gets tagged as
            // NCT and then removed inside getRomanAnalysis/getChordSymbol, collapsing a triad to a dyad
            // (e.g. Bb/D -> iii5 and missing chord symbol).
            const analysisNotesForNaming = (() => {
                try {
                    const absBeat = Number(event.absBeat);
                    const inMeasure = getInMeasure(absBeat);
                    const isStrong = isStrongAtAbsBeat(absBeat);

                    if (!isStrong) return analysisNotes;

                    return (analysisNotes || []).map((n: any) => {
                        if (!n || n.isRest) return n;
                        const s = n.isSuspension;
                        const isSusp = !!s && typeof s.fromAbsBeat === 'number';
                        const isNctFlag = !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura || n.isCambiata);

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
                                isCambiata: false,
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
            if (!harmonicSig || baseHarmonicNotes.length < 2) return;

            const applicableContext = ctxAtAbsBeat(event.absBeat);
            let contextTonic = applicableContext ? applicableContext.newTonic : currentTonic;
            let contextIsMinor = applicableContext ? applicableContext.newIsMinor : isMinorMode;

            // Guard: if a tonicization context would reassign the home key's
            // tonic triad (I/i) or dominant 7th (V7/V9), fall back to the global key.
            // These chords are too structurally important to be relabeled.
            // EXCEPTION: manual user overrides (source !== 'inferred') take absolute
            // precedence — the user explicitly chose this modulation, don't second-guess it.
            if (applicableContext && (contextTonic !== currentTonic || contextIsMinor !== isMinorMode)) {
                const _isManualCtx = (applicableContext as any).source !== 'inferred';
                if (!_isManualCtx) {
                    const _gR = getRomanAnalysis(analysisNotes as any, currentTonic, isMinorMode, { ornamentOverrides: ornOverrideRecord });
                    const _gRoman = String(_gR?.roman || '');
                    if (/^(I|i)(6|64)?$/.test(_gRoman)) {
                        // Tonic chord — never reassign context
                        contextTonic = currentTonic;
                        contextIsMinor = isMinorMode;
                    } else if (/^V/.test(_gRoman) && !_gRoman.includes('/')) {
                        const _gCands = identifyChordCandidates(analysisNotes as any);
                        const _gQ = (_gCands?.[0]?.type || '').toLowerCase();
                        if (_gQ.includes('dominant') && /7|9|11|13/.test(_gQ)) {
                            contextTonic = currentTonic;
                            contextIsMinor = isMinorMode;
                        }
                    }
                }
            }


            // ── Permanent diagnostic tracer ──────────────────────────────────
            // Activate from browser console:  localStorage.setItem('_HT_DEBUG_BEAT', '43')
            // List all beats:                 localStorage.setItem('_HT_DEBUG_BEAT', '-1')
            // Deactivate:                     localStorage.removeItem('_HT_DEBUG_BEAT')
            // Persists across reloads — set once, reload, see output.
            const _dbgRaw = localStorage.getItem('_HT_DEBUG_BEAT');
            const _dbgBeat = _dbgRaw !== null ? Number(_dbgRaw) : NaN;
            const _dbg = !isNaN(_dbgBeat) && _dbgBeat >= 0 && Math.abs(event.absBeat - _dbgBeat) < 0.5;

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
                        return !!(n.isNeighbor || n.isAnticipation || n.isAppoggiatura || n.isEscape || n.isCambiata);
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

            // ── Arpeggio suppression (generalised) ──────────────────────
            // When the previous Roman is known, ALL current PCs belong to
            // that chord's triad (plus 7th for dominants), and the bass
            // hasn't changed, suppress as continuation of the same harmony.
            const shouldSuppressAsArpeggio = (() => {
                try {
                    if (!prevSig || prevCtx !== ctxKey) return false;
                    if (prevBassPc == null || bassPc == null) return false;
                    if (prevBassPc !== bassPc) return false;
                    const curPcs = new Set(harmonicSig.split('-').filter(Boolean).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)));
                    if (curPcs.size < 1) return false;
                    const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                    if (!prevRoman2) return false;
                    const prevTriad2 = inferDiatonicTriadFromRoman(prevRoman2, contextTonic, contextIsMinor);
                    if (!prevTriad2) return false;
                    const triadSet2 = new Set<number>([prevTriad2.root, prevTriad2.third, prevTriad2.fifth]);
                    const seventh = ((prevTriad2.root + 10) % 12 + 12) % 12;
                    if (/^(V|vii|VII)/i.test(prevRoman2)) triadSet2.add(seventh);
                    return Array.from(curPcs).every(p => triadSet2.has(p));
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
                const isCompoundHere = (() => {
                    const te = tsEffectiveAt(Number(event.absBeat));
                    return te.denominator === 8 && (te.numerator % 3 === 0) && te.numerator > 3;
                })();
                if (!hasSuspensionOnsetHere && (isCompoundMeter || isCompoundHere)) {
                    const absBeat = Number(event.absBeat);
                    const inMeasure = getInMeasure(absBeat);
                    const strongPulse = isStrongAtAbsBeat(absBeat);

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

            // ── Voicing-change suppression ──────────────────────────────────
            // When only the upper-voice layout changes (e.g. soprano jumps to a
            // different octave of a chord tone) but the Roman numeral base, bass
            // PC, and tonal context remain identical, suppress the redundant label.
            // Applies only on weak beats to avoid hiding real harmonic changes.
            const shouldSuppressAsVoicingChange = (() => {
                try {
                    if (!previewRoman || !prevCtx || prevCtx !== ctxKey) return false;
                    const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                    if (!prevRoman) return false;
                    // Compare only the functional base (strip trailing figures/digits)
                    const romanBase = (r: string) => r.replace(/[\d/]+$/, '');
                    if (romanBase(previewRoman) !== romanBase(prevRoman)) return false;
                    if (prevBassPc == null || bassPc == null || prevBassPc !== bassPc) return false;
                    const absBeatN = Number(event.absBeat);
                    if (!Number.isFinite(absBeatN)) return false;
                    if (isStrongAtAbsBeat(absBeatN)) return false;
                    return true;
                } catch {
                    return false;
                }
            })();

            if (shouldSuppressAsVoicingChange && !hasSuspensionOnsetHere && !hasManualOrnOverride && !overrideByAbsBeat.has(qAbs(event.absBeat))) {
                const prevRoman2 = lastRomanBySystem.get(systemIndex) || '';
                if (prevRoman2) {
                    const x = getXForAbsBeat(event.absBeat, system);
                    labelsBySystem[systemIndex].push({
                        id: `hlabel-hidden-voicing-${systemIndex}-${event.absBeat}`,
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

            if (!hasSuspensionOnsetHere && !hasManualOrnOverride && (!hasHiddenChange || shouldSuppressAsArpeggio) && !overrideByAbsBeat.has(qAbs(event.absBeat)) && ((prevSig === harmonicSig && prevCtx === ctxKey) || shouldSuppressAsCompletion || shouldSuppressAsArpeggio || isAppoggResolSuppressible)) {

                // Before suppressing, verify figured-bass figures haven't changed.
                // Even when the PCS signature is identical (same chord), the voicing
                // may have changed (e.g. root position → second inversion) producing
                // different figures (e.g. "4" → "6/4"). In that case, emit the label.
                try {
                    const earlyFigures = computeFiguredBassFromNotes(analysisNotes as any, FIGURED_BASS_UI_OPTIONS).figures;
                    const prevFigs = lastFiguresBySystem.get(systemIndex) || [];
                    const _figKey = (f: string[]) => f.join('/');
                    if (_figKey(earlyFigures || []) !== _figKey(prevFigs)) {
                        // Figures changed → do NOT suppress, fall through to normal label emit
                    } else {

                const prevRoman = lastRomanBySystem.get(systemIndex) || '';
                if (previewRoman && prevRoman && previewRoman !== prevRoman) {
                    // Real harmonic change -> do not suppress.
                } else {
                // Keep the label stable, but record that *something happened* here (ornament/appoggiatura)
                // so the renderer can draw a short hold-line across hidden beats.
                if (hasOrnamentOnsetAtThisBeat || shouldSuppressAsCompletion || shouldSuppressAsArpeggio) {
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

                    } // close figures-same block
                } catch { /* fall through on error */ }
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
            let hasAug6Variants = false;

            const prevRoman = lastRomanBySystem.get(systemIndex) || '';
            const prevRootPc = lastChordRootPcBySystem.get(systemIndex);
            const prevType = lastChordTypeBySystem.get(systemIndex);

            // Hoisted to event scope so the symbol-reconcile (below) can reuse the SAME
            // ACC hint the Roman used, keeping symbol and Roman on one identification.
            const _accHintLabel = (accHintEnabled && accompanimentTracks && accompanimentTracks.length > 0)
                ? getAccompanimentPcsForBeat(accompanimentTracks.filter(t => !t.muted && t.visible !== false), Number(event.absBeat), ornOverrideMap)
                : null;

            try {
                const r = getRomanAnalysis(analysisNotesForNaming as any, contextTonic, contextIsMinor, {
                    ornamentOverrides: ornOverrideRecord,
                    ...(_accHintLabel && _accHintLabel.pcs.length > 0 ? { accHintPcs: _accHintLabel.pcs, accLowestMidi: _accHintLabel.lowestMidi, accForced: true } : {}),
                });

                if (r) {
                    roman = r.roman;
                    _dt('R0:getRoman', roman);
                    isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+' || roman === 'Sw+');
                    if (isAug6Roman && r.figures?.length) {
                        figures = r.figures;
                    }
                    if ((r as any).aug6Variants?.length) {
                        hasAug6Variants = true;
                    }
                }

                // Rsemi: vii°/X by upward-semitone resolution.
                // Per gli accordi diminuiti, la firma inequivocabile di vii°/X è la
                // risoluzione al semitono superiore: se il chord successivo nella timeline
                // ha root = root(corrente)+1, è vii°/X (X = grado della root successiva).
                // Vince sempre sull'interpretazione diatonica (ii° in minore ecc.) perché
                // il comportamento di risoluzione è semanticamente più forte della
                // diatonicità delle note.
                try {
                    if (roman && /°/.test(roman)) {
                        const currCands = identifyChordCandidates(analysisNotesForNaming || []);
                        const currRootRaw = currCands?.[0]?.root?.noteIndex;
                        if (typeof currRootRaw === 'number' && Number.isFinite(currRootRaw)) {
                            const currRootPc = ((currRootRaw % 12) + 12) % 12;
                            let nextRootPc: number | null = null;
                            for (let j = eventIndex + 1; j < timelineFiltered.length; j++) {
                                const ne = timelineFiltered[j];
                                if (!ne?.notes?.length) continue;
                                const realNotes = (ne.notes as any[]).filter((n: any) => n && !n.isRest);
                                if (realNotes.length < 2) continue;
                                const cands = identifyChordCandidates(realNotes);
                                const rp = cands?.[0]?.root?.noteIndex;
                                if (typeof rp === 'number' && Number.isFinite(rp)) {
                                    const np = ((rp % 12) + 12) % 12;
                                    if (np === currRootPc) continue;
                                    nextRootPc = np;
                                    break;
                                }
                            }
                            if (nextRootPc != null && ((nextRootPc - currRootPc) + 12) % 12 === 1) {
                                const tPc = ((noteNameToPc(contextTonic) % 12) + 12) % 12;
                                const isHomeLT = currRootPc === ((tPc + 11) % 12) && nextRootPc === tPc;
                                if (!isHomeLT) {
                                    const iv = ((nextRootPc - tPc) + 12) % 12;
                                    let targetRoman: string;
                                    if (contextIsMinor) {
                                        const diatonicMin: Record<number, string> = { 0: 'i', 2: 'ii°', 3: 'III', 5: 'iv', 7: 'V', 8: 'VI', 10: 'VII' };
                                        targetRoman = diatonicMin[iv]
                                            ?? ['i', '♭ii', 'ii', '♭iii', 'iii', 'iv', '♯iv', 'v', '♭vi', 'vi', '♭vii', 'vii'][iv];
                                    } else {
                                        const diatonicMaj: Record<number, string> = { 0: 'I', 2: 'ii', 4: 'iii', 5: 'IV', 7: 'V', 9: 'vi' };
                                        targetRoman = diatonicMaj[iv]
                                            ?? ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'][iv];
                                    }
                                    if (targetRoman) {
                                        const has7 = /7/.test(roman);
                                        roman = `vii°${has7 ? '7' : ''}/${targetRoman}`;
                                        _dt('Rsemi:viiResolution', roman);
                                    }
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }

                // R1: viiRescue — prefer fuller verticality when naming-filter collapses to dyad
                try {
                    const r1 = applyR1ViiRescue({ roman, analysisNotesForNaming: analysisNotesForNaming as any, analysisNotes: analysisNotes as any, fullNotes: (fullNotes || []) as any, contextTonic, contextIsMinor, ornamentOverrides: ornOverrideRecord });
                    if (r1 !== roman) {
                        roman = r1;
                        _dt('R1:viiRescue', roman);
                        isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+' || roman === 'Sw+');
                    }
                } catch {
                    // ignore
                }

// R2: secDom — rescue secondary dominants from candidates
                  try {
                      const r2 = applyR2SecDom({ roman, analysisNotesForNaming: analysisNotesForNaming as any, contextTonic, contextIsMinor });
                      if (r2 !== roman) { roman = r2; _dt('R2:secDom', roman); }
                  } catch { /* ignore */ }


                const contextKeySignature = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
                // Symbols should reflect the actual verticality (including altered tones),
                // while roman/figures follow the structural snapshot.
                // EXCEPT for explicit user-set ornament overrides (⌥O): when the
                // user marks a note as ornamental, that intent must apply to the
                // chord symbol too, otherwise a marked-out melodic passing tone
                // (e.g. an Eb over a Gb-aug verticality) corrupts the sigla
                // (it becomes EbmMaj7/Gb instead of GbAug).
                const fullNotesForSymbol = (fullNotes || []).filter((n: any) => {
                    if (!n) return true;
                    const ovId = n.id ? ornOverrideMap.get(n.id) : undefined;
                    if (ovId && ovId !== 'structural') return false;
                    const midi = Number(n.midi);
                    if (Number.isFinite(midi)) {
                        const ovKey = ornOverrideMap.get(`${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`);
                        if (ovKey && ovKey !== 'structural') return false;
                    }
                    if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
                    return true;
                });
                const s = getChordSymbol(fullNotesForSymbol as any, contextKeySignature, contextTonic);
                if (s) symbol = s;

                // R3: I7 — minor tonic maj7 fallback
                try {
                    const r3 = applyR3I7({ roman, symbol, contextTonic, contextIsMinor });
                    if (r3 !== roman) { roman = r3; _dt('R3:I7', roman); }
                } catch { /* ignore */ }

                // If the chord symbol explicitly indicates a slash (e.g. D7/F#),
                // prefer roman derived from the *symbol root*.
                // Under suspensions/ties, identifyChordCandidates can mis-root and collapse
                // into misleading labels like I4/7.
                try {
                    // (slash-root roman override removed)
                } catch { /* ignore */ }

            } catch { /* ignore — outer try for R0-R3 */ }

            // R4: dyadBass — infer from bass when ≤2 PCs
            try {
                const r4 = applyR4DyadBass({ roman, bassPc, analysisNotes: analysisNotes as any, contextTonic, contextIsMinor });
                if (r4 !== roman) { roman = r4; _dt('R4:dyadBass', roman, { bassPc }); }
            } catch { /* ignore */ }

            // R5: shellCont — keep previous roman if current is sparse subset
            try {
                const prevCtx = lastContextBySystem.get(systemIndex);
                const r5 = applyR5ShellCont({ roman, bassPc, analysisNotes: analysisNotes as any, prevRoman, contextTonic, contextIsMinor, prevContext: prevCtx || null });
                if (r5 !== roman) { roman = r5; _dt('R5:shellCont', roman, { prevRoman }); }
            } catch { /* ignore */ }

            // R6: rootless — diatonic shell inference from bass
            try {
                const r6 = applyR6Rootless({ roman, bassPc, analysisNotes: analysisNotes as any, contextTonic, contextIsMinor });
                if (r6 !== roman) { roman = r6; _dt('R6:rootless', roman, { bassPc }); }
            } catch { /* ignore */ }

            // R7: postInvRoot — infer inversion from previous chord root/type
            try {
                const r7 = applyR7PostInvRoot({ roman, bassPc, analysisNotes: analysisNotes as any, prevRoman, prevRootPc: prevRootPc ?? null, prevType: prevType ?? null });
                if (r7 !== roman) { roman = r7; _dt('R7:postInvRoot', roman, { prevRoman, prevRootPc }); }
            } catch { /* ignore */ }

            // R8: postInvDiat — keep prevRoman if current PCs ⊆ prevRoman's triad
            try {
                const prevCtx2 = lastContextBySystem.get(systemIndex);
                const r8 = applyR8PostInvDiat({ roman, bassPc, analysisNotes: analysisNotes as any, prevRoman, contextTonic, contextIsMinor, prevContext: prevCtx2 || null });
                if (r8 !== roman) { roman = r8; _dt('R8:postInvDiat', roman, { prevRoman }); }
            } catch { /* ignore */ }

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

            // Save pre-update roman for suspension dedup comparison (R10).
            // lastRomanBySystem is about to be overwritten with the current roman,
            // so we must capture the *previous* value before updating.
            const _prevRomanBeforeUpdate = lastRomanBySystem.get(systemIndex) || '';

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

                // Deduplicate: if multiple suspNotes come from the same voice at the same onset,
                // keep only the one with the most specific type (classic > generic 'susp'/'app').
                const deduped: any[] = [];
                const CLASSIC_SET = new Set(['4-3', '6-5', '7-6', '7-8', '8-7', '9-8', '2-3']);
                const seenVoices = new Map<number, any>();
                for (const sn of suspNotes) {
                    const v = (sn as any).voice ?? 0;
                    const existing = seenVoices.get(v);
                    if (!existing) {
                        seenVoices.set(v, sn);
                    } else {
                        // Prefer the one with classic type
                        const curType = String((sn as any).isSuspension?.type ?? '');
                        const exType = String((existing as any).isSuspension?.type ?? '');
                        if (CLASSIC_SET.has(curType) && !CLASSIC_SET.has(exType)) {
                            seenVoices.set(v, sn);
                        }
                    }
                }
                const dedupedSuspNotes = Array.from(seenVoices.values());

                if (dedupedSuspNotes.length) {
                    const suspInfos = dedupedSuspNotes
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
                        const isPlainDiatonic = (r: string) => !!r && !r.includes('/') && !r.includes('It+') && !r.includes('Fr+') && !r.includes('Ger+') && !r.includes('Sw+');

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
                                        const rr = calculateRomanFromChordInfo({ root: c.root, type: c.type, intervals: c.intervals, rootSpelled: (c as any).rootSpelled }, tonicHere, isMinorHere);
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
                            // Use analysisNotes (which has suspension→resolution substitutions)
                            // so figured bass reflects the target harmony, not the suspended notes.
                            const figSource = (analysisNotes && analysisNotes.length >= 2) ? analysisNotes : (fullNotes || []);
                            const fullFigures = computeFiguredBassFromNotes((figSource || []) as any, FIGURED_BASS_UI_OPTIONS).figures;
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
                    // R10: suspDedup — suppress duplicate roman at classic suspension resolution
                    const r10 = applyR10SuspDedup({
                        roman, symbol, figures,
                        prevRoman: _prevRomanBeforeUpdate,
                        isSuspensionOnsetHere,
                        hasClassicSuspension: hasClassic,
                        hasNonClassicSuspension: hasNonClassic,
                    });
                    if (r10.roman !== roman || r10.symbol !== symbol) {
                        _dt('R10:suspDedup', r10.roman, { prevRoman: _prevRomanBeforeUpdate });
                    }
                    roman = r10.roman;
                    figures = r10.figures;
                    symbol = r10.symbol;
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

            // R12 + R13: auto/manual overrides
            try {
                const r12 = applyR12AutoOverride({ roman, symbol, figures, absBeat: event.absBeat, autoOverrideByAbsBeat, overrideByAbsBeat });
                if (r12.roman !== roman) _dt('R12:autoOvr', r12.roman);
                roman = r12.roman; symbol = r12.symbol; figures = r12.figures;
            } catch { /* ignore */ }
            try {
                const r13 = applyR13ManualOverride({ roman, symbol, figures, absBeat: event.absBeat, overrideByAbsBeat });
                if (r13.roman !== roman) _dt('R13:manualOvr', r13.roman);
                roman = r13.roman; symbol = r13.symbol; figures = r13.figures;
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
            try {
                if (useStatisticalCorrection && styleProfile?.romanBigrams && prevRoman && roman) {
                    const prevCtxR14 = lastContextBySystem.get(systemIndex);
                    const r14 = applyR14CorpusBias({
                        roman, prevRoman,
                        analysisNotesForNaming: (analysisNotesForNaming && analysisNotesForNaming.length >= 2
                            ? analysisNotesForNaming : (analysisNotes && analysisNotes.length >= 2 ? analysisNotes : [])) as any,
                        contextTonic, contextIsMinor,
                        prevContext: prevCtxR14 || null,
                        styleProfile,
                        getBigramProbability,
                    });
                    if (r14 !== roman) {
                        roman = r14;
                        _dt('R14:corpusBias', roman, { prevRoman });
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
                            // Don't override when current roman is already a secondary
                            // function (vii°/X, V/X). Resolution-based readings (Rsemi)
                            // are stronger than the tonicization-pivot display heuristic.
                            const _isAlreadySecondary = /\//.test(roman);
                            if (!_isAlreadySecondary && (!_isDom || !_isBareI)) {
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

            // ── Diagnostic dump (activated via localStorage._HT_DEBUG_BEAT) ──
            if (_dbg && _tr.length) {
                console.groupCollapsed(`[HT-DEBUG] beat ${event.absBeat} → roman="${roman}" figs=${JSON.stringify(figures)} ctx=${contextTonic}${contextIsMinor ? 'm' : ''}`);
                console.table(_tr);
                console.groupEnd();
            }

            // ── Final Picardy-third override (Terza Piccarda) ──
            // Applied AFTER all overrides (auto, user, display) to ensure nothing
            // can reintroduce V/iv or I=V/iv at the last chord in minor.
            if (isMinorMode && eventIndex >= lastNonRestEventIndex) {
                try {
                    const _picTonicPc2 = noteNameToChromaticIndex(currentTonic);
                    const _pNotes2 = (analysisNotes || fullNotes || []) as any[];
                    const _pPcs2 = new Set<number>();
                    let _pBass2 = Infinity;
                    let _pBassPc2 = -1;
                    for (const n of _pNotes2) {
                        if (!n || n.isRest) continue;
                        const mi = Number(n.midi);
                        if (!Number.isFinite(mi)) continue;
                        _pPcs2.add(((mi % 12) + 12) % 12);
                        if (mi < _pBass2) { _pBass2 = mi; _pBassPc2 = ((mi % 12) + 12) % 12; }
                    }
                    if (_pBassPc2 === _picTonicPc2 && _pPcs2.size >= 3
                        && _pPcs2.has(_picTonicPc2)
                        && _pPcs2.has(((_picTonicPc2 + 4) % 12))
                        && _pPcs2.has(((_picTonicPc2 + 7) % 12))) {
                        roman = 'I';
                        romanDisplay = undefined;
                    }
                } catch { /* ignore */ }
            }

            // ── Q6: reconcile chord symbol with the Roman's final identification ──
            // The Roman follows the naming snapshot + ACC hint; the symbol follows the SATB
            // verticality. When they resolve to different roots the labels contradict (e.g.
            // an ACC bass D under SATB A-C: Roman → ii but symbol stayed Am). Recompute the
            // symbol from the SAME merged set (naming notes + ACC-hint pcs, with the ACC
            // bass) so both agree. Faithfulness guard: an ACC-derived root is trusted only
            // when it's the ACC bass — mirroring getRomanAnalysis, which lets an ACC-only
            // root win only when the bass evidences it (otherwise it's penalised). Skipped
            // for aug6 (symbol = enharmonic sonority) and override beats; cadential 6/4 and
            // secondary dominants share the root, so the root-difference guard is inert.
            try {
                if (roman && symbol && !isAug6Roman && !hasAug6Variants
                    && !overrideByAbsBeat.has(qAbs(event.absBeat))) {
                    // Merge the user-marked (Opt+H = 'structural') accompaniment notes
                    // sounding at this beat into the naming set — the SAME notes the Roman
                    // used via the ACC hint — so the symbol reflects the same identification.
                    // Real notes carry proper spelling (synthetic pitch-less notes gave "/A").
                    let mergedNaming: any[] = analysisNotesForNaming as any[];
                    if (_accHintLabel && _accHintLabel.pcs.length > 0 && accompanimentTracks && accompanimentTracks.length > 0) {
                        const beatTick = Number(event.absBeat) * TICKS_PER_QUARTER;
                        const accNotesAtBeat: any[] = [];
                        for (const t of accompanimentTracks) {
                            if ((t as any).muted || (t as any).visible === false) continue;
                            for (const n of ((t as any).notes || [])) {
                                if (!n || n.isRest || !Number.isFinite(n.midi) || !n.midi) continue;
                                const s = n.startTick ?? 0; const d = n.durationTicks ?? 0;
                                if (!(s <= beatTick && beatTick < s + d)) continue;
                                const ov = ornOverrideMap.get(n.id)
                                    ?? ornOverrideMap.get(`${n.midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`);
                                if (ov !== 'structural') continue; // only user-marked notes participate
                                accNotesAtBeat.push(n);
                            }
                        }
                        if (accNotesAtBeat.length > 0) mergedNaming = [...(analysisNotesForNaming as any[]), ...accNotesAtBeat];
                    }
                    const romanCands = identifyChordCandidates(mergedNaming as any);
                    const romanRootRaw = (romanCands as any)?.[0]?.root?.noteIndex;
                    const romanRootPc = (typeof romanRootRaw === 'number' && Number.isFinite(romanRootRaw))
                        ? ((romanRootRaw % 12) + 12) % 12 : null;
                    // No bass-only guard here: the merged ACC notes are user-marked
                    // (Opt+H = harmonic), so they're trusted at any register.
                    const symRootMatch = String(symbol).match(/^([A-G])([#b♯♭]?)/);
                    let symRootPc: number | null = null;
                    if (symRootMatch) {
                        const nm = `${symRootMatch[1]}${(symRootMatch[2] || '').replace('♯', '#').replace('♭', 'b')}`;
                        const pc = noteNameToChromaticIndex(nm);
                        symRootPc = (typeof pc === 'number' && pc >= 0) ? ((pc % 12) + 12) % 12 : null;
                    }
                    if (romanRootPc != null && symRootPc != null && romanRootPc !== symRootPc) {
                        const ksReconcile = getKeySignature(contextTonic, contextIsMinor ? 'Minor' : 'Major');
                        // Neutralize voice/clef so getChordSymbol's bass picker uses the
                        // GLOBALLY lowest note as the bass — otherwise it prefers the SATB
                        // bass voice and ignores a lower marked ACC note, mislabelling the
                        // inversion (e.g. always Dm7/A regardless of the real ACC bass).
                        const mergedForSymbol = (mergedNaming as any[]).map(n => ({ ...n, voice: 1, clef: 'treble' }));
                        const reSym = getChordSymbol(mergedForSymbol as any, ksReconcile, contextTonic);
                        if (reSym) { symbol = reSym; _dt('Q6:symbolReconcile', symbol); }
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

            // ── Calcola etichette alternative (letture ambigue) ──
            // Confronta il grado romano nella tonica corrente (contextTonic) con:
            //   1. La tonica globale (currentTonic), se diversa
            //   2. La root dell'accordo come tonica propria ("I in Bb")
            let alternatives: import('../utils/computeHarmonyLabelsBySystem').AlternativeLabel[] | undefined;
            if (roman && !overrideByAbsBeat.has(qAbs(event.absBeat))) {
                try {
                    const altNotes = analysisNotes as any[];
                    // Trova la root dal primo candidato
                    const cands = identifyChordCandidates(altNotes as any);
                    const topCand = cands && (cands as any[]).length ? (cands as any[])[0] : null;
                    const rootNote = topCand?.root as any;
                    const rPitch: string = rootNote?.pitch ?? '';
                    const rAcc: string = rootNote?.accidental ?? '';
                    const rootName: string = rAcc === 'sharp' ? rPitch + '#'
                        : rAcc === 'flat' ? rPitch + 'b'
                        : rAcc === 'double-sharp' ? rPitch + '##'
                        : rAcc === 'double-flat' ? rPitch + 'bb'
                        : rPitch;

                    const tonicCandidates: Array<{ tonic: string; isMinor: boolean }> = [];
                    if (currentTonic && currentTonic !== contextTonic) {
                        tonicCandidates.push({ tonic: currentTonic, isMinor: isMinorMode });
                    }
                    // Relativa minore/maggiore della tonica corrente: B°7 in C maj → ii° in Am
                    {
                        const _curPc = noteNameToPc(currentTonic);
                        if (Number.isFinite(_curPc)) {
                            const relTonicPc = isMinorMode ? (_curPc + 3) % 12 : (_curPc + 9) % 12;
                            const relIsMinor = !isMinorMode;
                            const relTonic = pcToNoteName(relTonicPc, { tonic: currentTonic, isMinor: isMinorMode });
                            if (relTonic && relTonic !== contextTonic && relTonic !== currentTonic) {
                                tonicCandidates.push({ tonic: relTonic, isMinor: relIsMinor });
                            }
                        }
                    }
                    if (rootName && rootName !== contextTonic && rootName !== currentTonic) {
                        tonicCandidates.push({ tonic: rootName, isMinor: false });
                    }

                    const altResults: import('../utils/computeHarmonyLabelsBySystem').AlternativeLabel[] = [];
                    const seenRomans = new Set<string>([roman]);
                    for (const tc of tonicCandidates) {
                        const altR = getRomanAnalysis(altNotes, tc.tonic, tc.isMinor, { ornamentOverrides: ornOverrideRecord });
                        const altRoman = altR?.roman ?? '';
                        if (!altRoman || seenRomans.has(altRoman)) continue;
                        // Filtra letture musicalmente impossibili: I°, i°, I+, i+ (la tonica non
                        // può essere diminuita o aumentata per definizione). Si producono quando
                        // si testa la root dell'accordo come tonica candidata su un accordo dim/aug.
                        if (/^[Ii][°+]/.test(altRoman)) continue;
                        seenRomans.add(altRoman);
                        const altKeySignature = getKeySignature(tc.tonic, tc.isMinor ? 'Minor' : 'Major');
                        const altSymbol = getChordSymbol(altNotes, altKeySignature, tc.tonic) ?? '';
                        altResults.push({
                            roman: altRoman,
                            figures: altR?.figures ?? [],
                            symbol: altSymbol,
                            impliedTonic: tc.tonic,
                            score: 0,
                        });
                        if (altResults.length >= 2) break;
                    }
                    if (altResults.length) alternatives = altResults;
                } catch { /* ignore */ }
            }

            // ─────────────────────────────────────────────────────────────────
            // Cadential 6/4 relabeling: when an I6/4 chord stands on the dominant
            // bass and resolves to V (same bass), it functions as a dominant with
            // appoggiature (6→5, 4→3). Display it as V6/4 instead of I6/4 so the
            // analysis reflects modern functional reading.
            //
            // Trigger conditions (any one is sufficient):
            //  (a) The cadential pattern recognizer identified the I6/4 explicitly,
            //      OR
            //  (b) Direct local check: roman is I/i with figures 6/4 AND the bass
            //      pitch class is the dominant of the current tonic AND the next
            //      timeline event is the V on the same bass with the 4 actually
            //      resolved to 3 (leading-tone present). Without the 4→3 motion
            //      it is not a true cadential 6/4 — keep it as I6/4.
            try {
                if (
                    (roman === 'I' || roman === 'i')
                    && !overrideByAbsBeat.has(qAbs(event.absBeat))
                ) {
                    const _figs = (figures || []).map(String);
                    const _has64 = _figs.some(f => /(^|[^\d])6($|[^\d])/.test(f))
                                && _figs.some(f => /(^|[^\d])4($|[^\d])/.test(f));
                    if (_has64) {
                        let _isCad64 = _cadential64Beats.has(event.absBeat);
                        if (!_isCad64 && bassPc != null) {
                            // Direct check: dominant of current context tonic
                            const _tonicIdx = noteNameToPc(contextTonic);
                            if (Number.isFinite(_tonicIdx)) {
                                const _domPc = ((_tonicIdx + 7) % 12 + 12) % 12;
                                // 4th above the dominant bass = tonic pc
                                // 3rd of V (= leading tone of the key) = domPc + 4
                                const _fourthPc = ((_domPc + 5) % 12 + 12) % 12;
                                const _ltPc = ((_domPc + 4) % 12 + 12) % 12;
                                if (bassPc === _domPc) {
                                    // Current upper voices must actually contain the 4th
                                    // above the bass (otherwise there is no 4 to resolve).
                                    const _curPcs = new Set<number>();
                                    for (const nn of (fullNotes || []) as any[]) {
                                        if (!nn || nn.isRest) continue;
                                        const m = Number(nn.midi);
                                        if (!Number.isFinite(m)) continue;
                                        _curPcs.add(((m % 12) + 12) % 12);
                                    }
                                    const _hasFourth = _curPcs.has(_fourthPc);
                                    if (_hasFourth) {
                                        // Look ahead: next non-empty timeline event
                                        // must keep the same bass AND show the 4→3
                                        // resolution (leading tone present in upper voices,
                                        // and the tonic pc gone from the upper voices).
                                        for (let j = eventIndex + 1; j < timelineFiltered.length; j++) {
                                            const ne = timelineFiltered[j] as any;
                                            const nNotes = (ne?.notes as any[] || []).filter((n: any) => n && !n.isRest);
                                            if (!nNotes.length) continue;
                                            let _nextBassMidi = Infinity;
                                            const _nextPcs = new Set<number>();
                                            for (const nn of nNotes) {
                                                const m = Number(nn.midi);
                                                if (!Number.isFinite(m)) continue;
                                                _nextPcs.add(((m % 12) + 12) % 12);
                                                if (m < _nextBassMidi) _nextBassMidi = m;
                                            }
                                            if (Number.isFinite(_nextBassMidi)) {
                                                const _nextBassPc = ((_nextBassMidi % 12) + 12) % 12;
                                                const _bassHeld = _nextBassPc === _domPc;
                                                const _ltAppeared = _nextPcs.has(_ltPc);
                                                const _fourthGone = !_nextPcs.has(_fourthPc);
                                                if (_bassHeld && _ltAppeared && _fourthGone) {
                                                    _isCad64 = true;
                                                }
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        if (_isCad64) {
                            roman = 'V';
                            if (romanDisplay) romanDisplay = romanDisplay.replace(/^[iI]\b/, 'V');
                        }
                    }
                }
            } catch { /* ignore — keep I6/4 on error */ }

            // ─────────────────────────────────────────────────────────────────
            labelsBySystem[systemIndex].push({
                id: `lbl-${event.absBeat}`,
                x,
                roman,
                romanDisplay,
                figures,
                symbol,
                absBeat: event.absBeat,
                isOverride: overrideByAbsBeat.has(qAbs(event.absBeat)),
                pcsSig: signatureFromNotes((fullNotes || []) as any),
                ...(hasAug6Variants ? { isChromatic: true } : {}),
                ...(alternatives ? { alternatives } : {}),
            });
        });

        // Sort labels in each system by x
        labelsBySystem.forEach(systemLabels => systemLabels.sort((a, b) => a.x - b.x));

        // ── Post-pass: simplify extended tonicization regions in final labels ──
        // When ≥ 4 labels within a window mostly reference the same /target or =target,
        // convert to extended modulation convention:
        //   entry: target=localRoman, inside: localRoman, exit: localRoman=target
        // Also treats bare roman equal to target (e.g. "iii" counts as targeting "iii")
        // and allows up to 1 gap label within a run.
        try {
            const targetRe = /[/=]([ivIV]+[°øo♭♯#]?(?:\d*)?)$/;
            const prefixRe = /^([ivIV]+[°øo♭♯#]?(?:\d*)?)=/;
            const bareRomanRe = /^([ivIV]+[°øo♭♯#]?(?:\d*)?)$/;
            const getTarget = (label: string, runningTarget?: string | null): string | null => {
                const m1 = label.match(targetRe);
                if (m1) return m1[1];
                const m2 = label.match(prefixRe);
                if (m2) return m2[1];
                // Bare roman that matches the running target (e.g. "iii" in a /iii region)
                if (runningTarget) {
                    const m3 = label.match(bareRomanRe);
                    if (m3 && m3[1] === runningTarget) return runningTarget;
                }
                return null;
            };
            const stripTarget = (label: string): string => {
                return label.replace(targetRe, '').replace(prefixRe, '');
            };
            for (const sysLabels of labelsBySystem) {
                // Two-pass: first identify candidate regions, then rewrite.
                // Allow up to 1 consecutive "gap" label that doesn't match the target.
                const MAX_GAP = 1;
                let runStart = -1;
                let runTarget: string | null = null;
                let gapCount = 0;
                let lastMatchIdx = -1;

                const flushRun = (endIdx: number) => {
                    // endIdx is the last MATCHING index (not the gap)
                    if (runStart < 0 || !runTarget || endIdx < 0) return;
                    const len = endIdx - runStart + 1;
                    if (len < 4) { runStart = -1; runTarget = null; gapCount = 0; lastMatchIdx = -1; return; }
                    for (let ri = runStart; ri <= endIdx; ri++) {
                        const lbl = sysLabels[ri];
                        const disp = String(lbl.romanDisplay || lbl.roman || '');
                        const thisTarget = getTarget(disp, runTarget);
                        if (ri === runStart) {
                            // Entry: keep as-is (e.g. V/iii stays V/iii — it's the preparation dominant)
                        } else if (ri === endIdx) {
                            // Exit: localRoman=target (e.g. i=iii)
                            const local = stripTarget(disp) || disp;
                            // Non riscrivere vii°/X — il dim7 non è una tonica locale.
                            if (!/^vii°/i.test(disp)) {
                                lbl.romanDisplay = `${local}=${runTarget}`;
                            }
                        } else if (thisTarget === runTarget) {
                            // Inside (matching): strip target suffix → simple local roman
                            // Skip vii°/X — il dim7 mantiene il suo /target esplicito.
                            if (/^vii°/i.test(disp)) {
                                // leave as-is
                            } else {
                            let local = stripTarget(disp) || disp;
                            // A bare roman equal to the target (e.g. "iii" in a /iii region)
                            // is the local tonic — display as i/I (depending on target case)
                            // BUT: never rewrite a dominant (V, vii°) as tonic — the dominant
                            // is a structural function, not "the target degree as local tonic".
                            if (local === runTarget && !/^(V|vii°?)$/i.test(local)) {
                                const isMinorTarget = runTarget === runTarget.toLowerCase();
                                local = isMinorTarget ? 'i' : 'I';
                            }
                            lbl.romanDisplay = local;
                            }
                        } else {
                            // Gap label (e.g. vii°/V): leave as-is — stripping the
                            // suffix would give a roman in the wrong key context.
                        }
                    }
                    runStart = -1;
                    runTarget = null;
                    gapCount = 0;
                    lastMatchIdx = -1;
                };

                for (let li = 0; li < sysLabels.length; li++) {
                    const disp = String(sysLabels[li].romanDisplay || sysLabels[li].roman || '');
                    const target = getTarget(disp, runTarget);

                    if (target && target === runTarget) {
                        gapCount = 0;
                        lastMatchIdx = li;
                    } else if (runTarget && gapCount < MAX_GAP) {
                        // Allow gap
                        gapCount++;
                    } else {
                        // End current run and start new one
                        flushRun(lastMatchIdx);
                        // Try to start a new run from this label
                        const freshTarget = getTarget(disp, null);
                        if (freshTarget) {
                            runStart = li;
                            runTarget = freshTarget;
                            gapCount = 0;
                            lastMatchIdx = li;
                        } else {
                            runStart = -1;
                            runTarget = null;
                            gapCount = 0;
                            lastMatchIdx = -1;
                        }
                    }
                }
                flushRun(lastMatchIdx);
            }
        } catch { /* ignore */ }

        return labelsBySystem;
    }, [_chromaticModulationEnabled, accHintEnabled, accompanimentTracks, analysisContextAbsBeat, analysisContexts, analyzedNotes, cadentialPatternsEnabled, compactTonicization, currentTonic, enableInferredContexts, harmonyOverrides, isAnalysisEnabled, isMinorMode, layoutData, minSpanBeats, ornOverrideMap, ornOverrideRecord, timeSignature, tonicizationHints, inferredContextSuppressions]);

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

            // Helper: detect literal pitch repetition (not a transposing sequence).
            // If the bass starts on the same absolute pitch in both blocks and
            // the melodic deltas are the same, it's a repetition at the same pitch level.
            const isLiteralRepetition = (a: NoteSig | null, b: NoteSig | null): boolean => {
                if (!a || !b) return false;
                const firstBassA = a.bassSeq?.find(v => v != null);
                const firstBassB = b.bassSeq?.find(v => v != null);
                if (firstBassA == null || firstBassB == null) return false;
                // Same starting bass pitch + same deltas → same absolute pitches → repetition
                return firstBassA === firstBassB;
            };

            // Note-motion auto detection disabled: it duplicated the brackets emitted
            // by detectVoiceLeadingSequences (canonical detector). The helpers above
            // are kept defined but unused on purpose — annotated spans below still apply.
            void onsetSigForTwoMeasures; void sigForTwoMeasures;
            void onsetMatch; void noteMatch; void isLiteralRepetition;
            void maxMeasureIndex;
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

            // Helper: check if targetPcs is templatePcs transposed by `semis`.
            // Used to validate per-slot that the consumer is propagating the
            // template's roman onto an actually-corresponding chord. The
            // sequence detector validates L transitions per leg; the consumer
            // here iterates k=0..L inclusive, so the boundary slot at k=L is
            // unvalidated by the detector and can break the transposition
            // pattern (e.g. a resolution chord that returns to the home key).
            const pcsTransposedEqual = (templatePcsSig: string, targetPcsSig: string, semis: number): boolean => {
                if (!templatePcsSig || !targetPcsSig) return false;
                const parse = (s: string) => {
                    const set = new Set<number>();
                    for (const tok of s.split('-')) {
                        if (!tok) continue;
                        const n = parseInt(tok, 10);
                        if (Number.isFinite(n)) set.add(((n % 12) + 12) % 12);
                    }
                    return set;
                };
                const tpl = parse(templatePcsSig);
                const tgt = parse(targetPcsSig);
                if (tpl.size === 0 || tpl.size !== tgt.size) return false;
                const offset = ((semis % 12) + 12) % 12;
                for (const pc of tpl) {
                    const transposed = ((pc + offset) % 12 + 12) % 12;
                    if (!tgt.has(transposed)) return false;
                }
                return true;
            };

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

                    // Per-slot validation for modulating sequences: ensure the
                    // target chord IS actually the template transposed by
                    // r * transpositionSemitones. If not, the slot lies outside
                    // the genuine sequence pattern (typically a resolution
                    // chord or a boundary overshoot) — skip propagation rather
                    // than mask the target's native roman/figures.
                    if (isModulatingSeq && Number.isFinite(seq.transpositionSemitones as number)) {
                        const tplLbl = row.lab?.label as any;
                        const tplPcs = String(tplLbl?.pcsSig || '');
                        const tgtPcs = String((target as any)?.pcsSig || '');
                        if (tplPcs && tgtPcs) {
                            const expectedSemis = Number(seq.transpositionSemitones) * r;
                            if (!pcsTransposedEqual(tplPcs, tgtPcs, expectedSemis)) {
                                continue;
                            }
                        }
                    }

                    (target as any).sequenceRoman = row.stripped;
                    if (row.functional) {
                        (target as any).sequenceRomanFunctional = row.functional;
                        (target as any).sequenceRomanSource = templateRoman;
                        // For modulating sequences the model's roman must win
                        // over any romanDisplay generated by the pivot / secondary
                        // analysis pipeline (which analyses in a potentially wrong tonic).
                        // Note: figures are NOT propagated from the template —
                        // they depend on the target's actual voicing (inversion,
                        // 7th encoding) and propagating them masks legitimate
                        // differences between transposed copies.
                        if (isModulatingSeq) {
                            (target as any).romanDisplay = undefined;
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
            // If the stored label already looks like a key bracket (from musicTheory.ts),
            // use only the canonical tonicLabel to avoid duplication like "[ G maj ] [ G Maj ]".
            if (custom && /^\[.*\]$/.test(custom)) return tonicLabel;
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
            const sysIndex = layoutData.systemsParams.findIndex((sp: any) => (sp.measureIndices || []).includes(measureIndex));
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
