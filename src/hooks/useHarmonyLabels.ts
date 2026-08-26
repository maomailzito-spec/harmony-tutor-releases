/**
 * useHarmonyLabels — extracted from GrandStaffEditor.tsx (Phase 2)
 *
 * Computes all harmony analysis overlay data per system:
 * roman numerals, figured bass, chord symbols, progression markers,
 * sequence markers, modulation markers, and time-signature markers.
 */
import { useMemo } from 'react';
import { computeHarmonyLabelsBySystemCore } from './harmonyLabelsCore';
import type { StaffNote, TimeSignature, AnalysisContext, HarmonyLabelOverride, TimeSignatureChange, AccompanimentTrack, KeySignatureChange, KeySignature, TempoMark, MeasureLength } from '../types';
import { normalizeKeyChanges, keyChangeAtMeasure } from '../utils/keySignatureChanges';
import { normalizeTempoMarks, tempoMarkLabel } from '../utils/tempoMarks';
import { getActiveNotesTimeline, identifyChordCandidates, calculateRomanFromChordInfo, getRomanAnalysis, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS, getKeySignature, getChordSymbol, bassScaleDegreeRoman, isEnharmonicSpellingMismatch } from '../utils/musicTheory';
import { structuralNotes, buildEngineHarmonyOverrideMap } from '../utils/harmonyLabelPipeline';
import { usePreference } from '../preferences/usePreference';
import { evaluateCadentialPatterns, type ChordEvent, pcToNoteName, noteNameToPc, qualityFamily, getScalePcs } from '../utils/cadentialPatterns';
import { CADENTIAL_PATTERN_RECOGNITION_KEY, ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY } from '../storage/storageKeys';
import { detectVoiceLeadingSequences } from '../utils/sequenceDetector';
import { detectMotifTransformations, type MotifMatch, type MotifTransformType } from '../utils/melodicMotifDetector';

/** Colore FISSO per tipo di trasformazione melodica (modello=bracket, imitazione=note). */
const MOTIF_TYPE_COLOR: Record<MotifTransformType, { fill: string; stroke: string }> = {
    invert:           { fill: '#7c3aed', stroke: '#6d28d9' }, // viola
    retrograde:       { fill: '#0d9488', stroke: '#0f766e' }, // teal
    retrogradeInvert: { fill: '#c026d3', stroke: '#a21caf' }, // fucsia
    transpose:        { fill: '#db2777', stroke: '#be185d' }, // rosa
};
const MOTIF_TYPE_ABBR: Record<MotifTransformType, string> = { transpose: 'T', invert: 'I', retrograde: 'R', retrogradeInvert: 'RI' };
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
    /** Cambi d'armatura a metà brano + armatura d'impianto: servono a piazzarli sul rigo. */
    keySignatureChanges?: KeySignatureChange[];
    keySignatureRoot?: string;
    analysisContexts: AnalysisContext[];
    /** I contesti scritti dall'utente, senza i dedotti (vedi HarmonyLabelsInput). */
    declaredAnalysisContexts?: AnalysisContext[];
    /** Segni di metronomo a metà brano: servono solo a essere disegnati. */
    tempoMarks?: TempoMark[];
    /** Durate reali delle battute irregolari: l'analisi deve leggere il brano sulla
     *  STESSA griglia del disegno e del suono, altrimenti dopo una battuta che
     *  contiene più del metro gli accordi risultano sfasati di un movimento. */
    measureLengths?: MeasureLength[];
    harmonyOverrides: any[];
    currentTonic: string;
    isMinorMode: boolean;
    isAnalysisEnabled: boolean;
    isSequencesEnabled: boolean;
    isMotifsEnabled?: boolean;
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
        keySignatureChanges, keySignatureRoot, tempoMarks, measureLengths,
        analysisContexts, harmonyOverrides,
        currentTonic, isMinorMode, isAnalysisEnabled, isSequencesEnabled, isMotifsEnabled,
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

    // FIRMA DELL'IMPAGINAZIONE — quali misure stanno su quale riga e quanto è larga.
    //
    // Il memo delle etichette qui sotto NON dipende da `layoutData` per scelta: l'identità
    // di layoutData cambia a ogni modifica delle note, e rifare il posizionamento (~440 ms
    // sul brano intero) ad ogni tasto premuto era il collo di bottiglia dell'editing. Il
    // prezzo però era che, cambiando SOLO l'impaginazione — ridimensionamento della
    // finestra, zoom, vista a nastro — le etichette restavano dov'erano mentre le misure
    // si spostavano, e le misure entrate nella riga non ne avevano affatto.
    //
    // Questa firma cattura solo ciò che sposta le etichette (la spartizione in righe e la
    // larghezza dei sistemi) e NON la spaziatura fine, che cambia ad ogni nota inserita:
    // così l'editing non paga nulla, mentre zoom e ridimensionamento fanno ricalcolare.
    const layoutSignature = useMemo(() => {
        const sys = (layoutData as any)?.systemsParams as any[] | undefined;
        if (!sys || sys.length === 0) return '';
        return sys.map((s: any) => {
            const mi = s?.measureIndices || [];
            return `${mi[0] ?? -1}-${mi[mi.length - 1] ?? -1}:${Math.round(Number(s?.width) || 0)}`;
        }).join('|');
    }, [layoutData]);

    // IL CALCOLO STA IN UN FILE SUO (harmonyLabelsCore.ts) perché possa girare senza
    // React, e quindi essere provato su tutto il repertorio da uno script invece che
    // aprendo l'applicazione. Qui resta solo la memoizzazione: stesse dipendenze di
    // prima, nessun cambio di comportamento.
    const harmonyLabelsBySystem = useMemo(() => computeHarmonyLabelsBySystemCore({
            _chromaticModulationEnabled,
            accHintEnabled,
            accompanimentTracks,
            analysisContextAbsBeat,
            analysisContexts,
            analyzedNotes,
            cadentialPatternsEnabled,
            compactTonicization,
            currentTonic,
            enableInferredContexts,
            harmonyOverrides,
            inferredContextSuppressions,
            isAnalysisEnabled,
            isMinorMode,
            layoutData,
            measureLengths,
            minSpanBeats,
            ornOverrideMap,
            ornOverrideRecord,
            styleProfile,
            timeSignature,
            timeSignatureChanges,
            tonicizationHints,
            useStatisticalCorrection,
            autoHarmonyLabelOverrides: params.autoHarmonyLabelOverrides,
            declaredAnalysisContexts: params.declaredAnalysisContexts,
        }), [_chromaticModulationEnabled, accHintEnabled, accompanimentTracks, analysisContextAbsBeat, analysisContexts, analyzedNotes, cadentialPatternsEnabled, compactTonicization, currentTonic, enableInferredContexts, harmonyOverrides, isAnalysisEnabled, isMinorMode, minSpanBeats, ornOverrideMap, ornOverrideRecord, timeSignature, tonicizationHints, inferredContextSuppressions, layoutSignature]);

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
                const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges, measureLengths);
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
            const timeline = getActiveNotesTimeline(layoutData.positionedNotes, timeSignature, timeSignatureChanges, measureLengths);
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
        const timeline = getActiveNotesTimeline((analyzedNotes || notes) as any, timeSignature, timeSignatureChanges, measureLengths);
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
            keyTonic: String(currentTonic || 'C'),
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
                    // Boundary home-dominant guard: the closing slot (kk===L) is the
                    // unvalidated overshoot. If it is the home-key cadential dominant
                    // (bare V/V7), keep its native functional Roman rather than the
                    // sequence's local-tonic relabel (which would call an A7 in D "IV").
                    if (kk === L && /^V7?$/.test(String((lbl as any).roman || '').trim())) continue;
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
                    // Boundary home-dominant guard (see template loop): a closing slot
                    // that is the home-key cadential dominant keeps its native V/V7.
                    if (k === L && /^V7?$/.test(String((target as any).roman || '').trim())) continue;
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
        if (!layoutData || analysisContexts.length === 0) return [] as { x: number; label: string; absBeat: number; isTesto: boolean }[][];

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

        // `absBeat` viaggia col marcatore: serve a chi lo vuole TOGLIERE dalla partitura
        // col tasto destro, che altrimenti saprebbe dove sta sullo schermo ma non nel brano.
        const markersBySystem: { x: number; label: string; absBeat: number; isTesto: boolean }[][] = layoutData.systemsParams.map(() => []);
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

                // `isTesto` distingue una SCRITTA dell'utente da un marcatore di
                // tonalità — e da una tonicizzazione DEDOTTA dal motore, che in questa
                // corsia sta insieme alle altre ma non esiste fra i contesti dell'utente.
                // Chi vuole spostarle o toglierle deve poterle distinguere: agire su una
                // dedotta significa non togliere niente (non c'è) e aggiungere un
                // contesto nuovo, che cambia la lettura tonale e fa comparire sigle
                // diverse sulla partitura.
                markersBySystem[systemIndex].push({
                    x: x + 10,
                    label: formatLabel(ctx),
                    absBeat,
                    isTesto: ctx.markerMode === 'text' && (ctx as any).source !== 'inferred',
                });
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

    /**
     * CAMBI D'ARMATURA da disegnare, sistema per sistema. Stessa impalcatura dei cambi
     * di metro qui sopra: si trova la x d'inizio della battuta in cui il cambio entra in
     * vigore. Ogni cambio porta anche l'armatura DA ANNULLARE, che è quella in vigore
     * fino a lì — i bequadri che tolgono i diesis o i bemolli di prima.
     */
    const keySignatureMarkersBySystem = useMemo(() => {
        const vuoto = [] as Array<Array<{ x: number; nuova: KeySignature; daAnnullare: KeySignature; measureIndex: number }>>;
        if (!layoutData || !(keySignatureChanges || []).length) return vuoto;
        const base = { root: String(keySignatureRoot || 'C'), isMinor: !!isMinorMode };
        const markersBySystem = layoutData.systemsParams.map(() => [] as Array<{ x: number; nuova: KeySignature; daAnnullare: KeySignature; measureIndex: number }>);
        for (const ch of normalizeKeyChanges(keySignatureChanges)) {
            const cambio = keyChangeAtMeasure(base, keySignatureChanges, ch.measureIndex);
            if (!cambio) continue; // un cambio verso la stessa armatura non si disegna
            const sysIndex = layoutData.systemsParams.findIndex((sp: any) => (sp.measureIndices || []).includes(ch.measureIndex));
            if (sysIndex < 0) continue;
            const system = layoutData.systemsParams[sysIndex];
            const idx = system.measureIndices.indexOf(ch.measureIndex);
            if (idx === -1) continue;
            // Se il cambio cade sulla PRIMA misura del sistema, l'armatura nuova è già
            // quella stampata in testa al rigo: ridisegnarla in mezzo sarebbe un doppione.
            if (idx === 0) continue;
            // La misura ha uno spazio riservato a sinistra per l'armatura nuova: il segno
            // va DENTRO quello spazio, non sopra le note che cominciano dopo.
            const spazio = Number((layoutData as any)?.keyChangeExtraByMeasure?.[ch.measureIndex] ?? 0);
            markersBySystem[sysIndex].push({
                x: system.startMeasuresX[idx] - spazio + 4,
                // Si passano le ARMATURE, non i nomi delle tonalità: il programma tiene
                // le fondamentali nel dominio dei diesis (un La bemolle importato torna
                // 'G#'), che VexFlow non conosce come tonalità. Convertire qui in
                // armatura — diesis/bemolli e quanti — toglie di mezzo il problema, e la
                // traduzione nel nome del disegno la fa chi disegna, una volta sola.
                nuova: getKeySignature(cambio.nuova, 'Major'),
                daAnnullare: getKeySignature(cambio.daAnnullare, 'Major'),
                measureIndex: ch.measureIndex,
            });
        }
        markersBySystem.forEach((ms: any[]) => ms.sort((a, b) => a.x - b.x));
        return markersBySystem;
    }, [layoutData, keySignatureChanges, keySignatureRoot, isMinorMode]);

    /**
     * SEGNI DI METRONOMO da disegnare, sistema per sistema. Stessa impalcatura dei
     * cambi di metro e d'armatura: la x è l'inizio della battuta da cui il segno vale.
     * L'etichetta è già pronta da stampare («♩ = 60»): l'unità resta quella scritta
     * nella partitura, non quella dei conti.
     */
    const tempoMarkMarkersBySystem = useMemo(() => {
        const vuoto = [] as Array<Array<{ x: number; label: string; measureIndex: number; offsetY: number }>>;
        if (!layoutData || !(tempoMarks || []).length) return vuoto;
        const markersBySystem = layoutData.systemsParams.map(() => [] as Array<{ x: number; label: string; measureIndex: number; offsetY: number }>);
        for (const m of normalizeTempoMarks(tempoMarks)) {
            const sysIndex = layoutData.systemsParams.findIndex((sp: any) => (sp.measureIndices || []).includes(m.measureIndex));
            if (sysIndex < 0) continue;
            const system = layoutData.systemsParams[sysIndex];
            const idx = system.measureIndices.indexOf(m.measureIndex);
            if (idx === -1) continue;
            markersBySystem[sysIndex].push({
                x: system.startMeasuresX[idx] + 2,
                label: tempoMarkLabel(m),
                measureIndex: m.measureIndex,
                // Lo spostamento verticale deciso trascinandolo: il disegno lo somma
                // all'altezza abituale (vedi `TempoMark.offsetY`).
                offsetY: Number((m as any).offsetY) || 0,
            });
        }
        markersBySystem.forEach((ms: any[]) => ms.sort((a, b) => a.x - b.x));
        return markersBySystem;
    }, [layoutData, tempoMarks]);


    // ── Trasformazioni MELODICHE (idea "simmetria"): T/I/R/RI, dentro-voce e
    // cross-voce, tonale+reale. Banda sotto il MODELLO + bracket con etichetta
    // sull'IMITAZIONE, in lane/colori distinti dalle sequenze armoniche. ──
    const motifMatches = useMemo<MotifMatch[]>(() => {
        if (!isMotifsEnabled) return [];
        try { return detectMotifTransformations(notes, { minLen: 5, maxMatches: 120 }); }
        catch { return []; }
    }, [isMotifsEnabled, notes]);

    const motifData = useMemo(() => {
        const styleById: Record<string, { fill: string; stroke: string }> = {};
        const shown: Array<MotifMatch & { color: string }> = [];
        if (!motifMatches.length) return { styleById, shown };

        // Seleziona i match da EVIDENZIARE: priorità a I/R/RI (le simmetrie "non ovvie",
        // il punto dell'articolo) sulle trasposizioni (rumorose in musica tonale, in
        // parte coperte dal rilevatore armonico); niente sovrapposizioni (per non
        // confondere i colori su note condivise); con un tetto.
        const MAX_SHOWN = 12;
        const occupied: Array<[number, number]> = [];
        const overlaps = (a: number, b: number) => occupied.some(([s, e]) => a < e && s < b);
        const score = (m: MotifMatch) => m.length + (m.type !== 'transpose' ? 100 : 0);
        const shownRaw: MotifMatch[] = [];
        for (const m of [...motifMatches].sort((x, y) => score(y) - score(x))) {
            if (overlaps(m.modelStartTick, m.modelEndTick) || overlaps(m.imitationStartTick, m.imitationEndTick)) continue;
            occupied.push([m.modelStartTick, m.modelEndTick], [m.imitationStartTick, m.imitationEndTick]);
            shownRaw.push(m);
            if (shownRaw.length >= MAX_SHOWN) break;
        }

        // COLORE FISSO PER TIPO (così la legenda mappa tipo→colore). Il MODELLO avrà una
        // bracket in questo colore; l'IMITAZIONE avrà le NOTE piene in questo colore.
        shownRaw.forEach((m) => {
            const tc = MOTIF_TYPE_COLOR[m.type];
            // Sia il MODELLO sia l'IMITAZIONE hanno le note colorate (stesso colore del
            // tipo) → si vede su QUALE voce sono; il modello in più ha la bracket.
            for (const id of m.modelNoteIds) styleById[id] = { fill: tc.fill, stroke: tc.stroke };
            for (const id of m.imitationNoteIds) styleById[id] = { fill: tc.fill, stroke: tc.stroke };
            shown.push({ ...m, color: tc.stroke });
        });
        return { styleById, shown };
    }, [motifMatches]);

    // Bracket sul MODELLO (colore del tipo + sigla), per sistema. L'imitazione è
    // evidenziata sulle note (motifNoteStyles), quindi qui solo il modello.
    const motifBracketsBySystem = useMemo(() => {
        const bySystem: Array<Array<{ id: string; x1: number; x2: number; midX: number; y: number; textY: number; label: string; color: string }>> =
            layoutData ? layoutData.systemsParams.map(() => []) : [];
        if (!layoutData || !motifData.shown.length) return bySystem;

        const laneY = (staffSystemMode === 'satb_ancient' ? (VF_SATB_SOPRANO_Y + 36) : (TOP_STAFF_TOP + 36)) - 16;
        const textY = laneY - 5;
        const measureStartAbsBeat = (layoutData as any)?.measureStartAbsBeat as number[] | undefined;
        const measureBeatsPerMeasure = (layoutData as any)?.measureBeatsPerMeasure as number[] | undefined;
        const beatsFallback = timeSignature.numerator * (4 / timeSignature.denominator);
        const beatsInMeasure = (m: number) => { const b = (measureBeatsPerMeasure && typeof measureBeatsPerMeasure[m] === 'number') ? Number(measureBeatsPerMeasure[m]) : beatsFallback; return Number.isFinite(b) && b > 0 ? b : beatsFallback; };
        const startAbsForMeasure = (m: number) => (measureStartAbsBeat && typeof measureStartAbsBeat[m] === 'number') ? Number(measureStartAbsBeat[m]) : m * beatsFallback;
        const findMeasureIndexForAbsBeat = (ab: number) => {
            if (!measureStartAbsBeat || measureStartAbsBeat.length === 0) return Math.floor(ab / beatsFallback);
            for (let m = measureStartAbsBeat.length - 1; m >= 0; m--) if (ab >= (measureStartAbsBeat[m] ?? 0) - 1e-9) return m;
            return 0;
        };
        const getXForAbsBeat = (absBeat: number, system: any) => {
            const measures = system.measureIndices || [];
            let local: { m: number; idx: number } | null = null;
            for (let i = 0; i < measures.length; i++) {
                const m = measures[i]; const start = startAbsForMeasure(m); const end = start + beatsInMeasure(m);
                if (absBeat >= start - 1e-6 && absBeat < end - 1e-6) { local = { m, idx: i }; break; }
            }
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

        motifData.shown.forEach((m, k) => {
            const absStart = m.modelStartTick / TICKS_PER_QUARTER;
            const absEnd = Math.max(m.modelStartTick, m.modelEndTick - 1) / TICKS_PER_QUARTER;
            if (!(absEnd > absStart + 1e-9)) return;
            for (let si = 0; si < layoutData.systemsParams.length; si++) {
                const system = layoutData.systemsParams[si];
                const sysMeasures = system.measureIndices || [];
                if (!sysMeasures.length) continue;
                const sysMin = Math.min(...sysMeasures), sysMax = Math.max(...sysMeasures);
                const sysAbsStart = startAbsForMeasure(sysMin);
                const sysAbsEnd = startAbsForMeasure(sysMax) + beatsInMeasure(sysMax);
                const oStart = Math.max(absStart, sysAbsStart);
                // Clamp appena DENTRO l'ultima misura del rigo: sysAbsEnd è l'inizio della
                // misura successiva (sul rigo dopo) e getXForAbsBeat non la troverebbe nel
                // sistema corrente → x sbagliata e bracket "bucata" al confine di sistema.
                const oEnd = Math.min(absEnd, sysAbsEnd - 1e-3);
                if (!(oEnd > oStart + 1e-6)) continue;
                let x1 = getXForAbsBeat(oStart, system), x2 = getXForAbsBeat(oEnd, system);
                if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
                if (x2 < x1) [x1, x2] = [x2, x1];
                const xx1 = x1 + 4, xx2 = x2 - 4;
                if (!(xx2 > xx1 + 2)) continue;
                const isFirst = absStart >= sysAbsStart - 1e-6 && absStart <= sysAbsEnd + 1e-6;
                bySystem[si].push({ id: `motif-model-${k}-${si}`, x1: xx1, x2: xx2, midX: (xx1 + xx2) / 2, y: laneY, textY, label: isFirst ? MOTIF_TYPE_ABBR[m.type] : '', color: m.color });
            }
        });
        return bySystem;
    }, [layoutData, motifData.shown, staffSystemMode, timeSignature]);

    return {
        harmonyLabelsBySystemSequenced,
        progressionMarkersBySystem,
        sequenceMarkersBySystem,
        sequenceModelMarkersBySystem,
        contextMarkersBySystem,
        timeSignatureMarkersBySystem,
        keySignatureMarkersBySystem,
        tempoMarkMarkersBySystem,
        sequenceMatches,
        motifNoteStyles: motifData.styleById,
        motifBracketsBySystem,
        motifMatches: motifData.shown,
    };
}
