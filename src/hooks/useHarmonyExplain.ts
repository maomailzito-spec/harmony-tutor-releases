/**
 * useHarmonyExplain — hook that manages the "chord identity card" modal.
 *
 * Extracted from GrandStaffEditor to keep the main component lean.
 * Returns { isExplainOpen, explainData, openExplain, closeExplain }.
 */
import { useState, useCallback } from 'react';
import i18n from '../i18n';
import type { StaffNote, AnalysisContext, TimeSignature } from '../types';
import type { HarmonyExplainData, HarmonyExplainConfidenceLevel } from '../components/HarmonyLabelExplainModal';
import {
    getRomanAnalysisDebugSnapshot,
    identifyChordCandidates,
    getChordSymbol,
    computeFiguredBassFromNotes,
    getKeySignature,
} from '../utils/musicTheory';

export interface UseHarmonyExplainParams {
    analyzedNotes: StaffNote[];
    analysisContexts: AnalysisContext[];
    currentTonic: string;
    isMinorMode: boolean;
    analysisContextAbsBeat: (ctx: AnalysisContext) => number;
    timeSignature: TimeSignature;
}

export function useHarmonyExplain(params: UseHarmonyExplainParams) {
    const { analyzedNotes, analysisContexts, currentTonic, isMinorMode, analysisContextAbsBeat, timeSignature } = params;

    const [isExplainOpen, setIsExplainOpen] = useState(false);
    const [explainData, setExplainData] = useState<HarmonyExplainData | null>(null);

    const openExplain = useCallback((lbl: any) => {
        try {
            const notes = analyzedNotes as StaffNote[];
            const labelAbsBeat = Number(lbl.absBeat ?? 0);

            // Compute beatsPerMeasure from time signature
            const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

            // Filter notes matching this label's absolute beat
            const labelNotes = notes.filter((n: any) => {
                if (!n || n.isRest) return false;
                const noteAbsBeat = (n.measureIndex ?? 0) * beatsPerMeasure + (Number(n.beat ?? 1) - 1);
                // Include held notes: active if onset <= labelAbsBeat < onset + duration
                const _DV: Record<string,number> = { whole:4, half:2, quarter:1, '8th':0.5, '16th':0.25, '32nd':0.125 };
                let dur = (_DV[n.duration] || 1);
                if (n.isDotted) dur *= 1.5;
                if (n.isTriplet) dur *= 2 / 3;
                if (n.isDuplet) dur *= 3 / 2;
                return noteAbsBeat <= labelAbsBeat + 1e-6 && labelAbsBeat < noteAbsBeat + dur - 1e-6;
            });
            if (!labelNotes.length) return;

            // Resolve active analysis context at this beat
            let ctxTonic = currentTonic;
            let ctxIsMinor = isMinorMode;
            for (const c of [...analysisContexts].sort(
                (a, b) => analysisContextAbsBeat(a) - analysisContextAbsBeat(b))
            ) {
                if (analysisContextAbsBeat(c) <= labelAbsBeat) {
                    ctxTonic = c.newTonic ?? currentTonic;
                    ctxIsMinor = Boolean(c.newIsMinor);
                }
            }

            const keySig = getKeySignature(ctxTonic, ctxIsMinor ? 'Minor' : 'Major');

            // Analysis helpers
            const debugSnap = getRomanAnalysisDebugSnapshot(labelNotes as any, ctxTonic, ctxIsMinor);
            const candidates = identifyChordCandidates(labelNotes as any);
            const figResult = computeFiguredBassFromNotes(labelNotes as any);
            const symResult = getChordSymbol(labelNotes as any, keySig, ctxTonic);

            // ── Confidence ──
            // Lo score raw di identifyChordCandidates() non è una percentuale 0–100:
            // dipende dal tipo di match e dal numero di note (un exact match completo
            // può valere ~29). Le soglie assolute non funzionano: usiamo criteri
            // qualitativi (matchType, candidato unico, gap sul 2° candidato).
            const mainCand = candidates?.[0];
            const secondCand = candidates?.[1];
            const isOverride = Boolean((lbl as any).isOverride);
            let confidenceLevel: HarmonyExplainConfidenceLevel = 'low';
            const confidenceReasons: string[] = [];
            if (!mainCand) {
                confidenceLevel = 'low';
                confidenceReasons.push(i18n.t('confidence_no_candidate'));
            } else if (isOverride) {
                confidenceLevel = 'high';
                confidenceReasons.push(i18n.t('confidence_override'));
            } else {
                const topScore = Number(mainCand.score ?? 0);
                const secondScore = Number(secondCand?.score ?? 0);
                const gap = secondCand ? topScore - secondScore : topScore;
                const matchType = String((mainCand as any).matchType ?? '');
                if (matchType === 'exact') {
                    confidenceLevel = 'high';
                    confidenceReasons.push(i18n.t('confidence_exact_match'));
                } else if (candidates.length === 1 && topScore > 0) {
                    confidenceLevel = 'high';
                    confidenceReasons.push(i18n.t('confidence_unique'));
                } else if (gap >= 10) {
                    confidenceLevel = 'high';
                    confidenceReasons.push(i18n.t('confidence_wide_margin'));
                } else if (topScore >= 15 && gap >= 5) {
                    confidenceLevel = 'medium';
                    confidenceReasons.push(i18n.t('confidence_probable'));
                } else {
                    confidenceLevel = 'low';
                    confidenceReasons.push(
                        secondCand
                            ? i18n.t('confidence_multiple')
                            : i18n.t('confidence_partial')
                    );
                }
            }

            // ── PCS / removed notes ──
            const pcsBase: number[] = debugSnap?.pcsBase ?? [];
            const pcsFigures: number[] = debugSnap?.pcsFigures ?? [];
            const pcsRoman: number[] = debugSnap?.pcsRoman ?? [];

            const fmtRemoved = (arr: any[]) => (arr ?? []).map((n: any) =>
                `${n.pitch ?? ''}${n.explicitAccidental ?? ''}${n.octave ?? ''} v${n.voice ?? ''}`
            );

            // Derive measureIndex and beat from absBeat
            const derivedMeasureIndex = Math.floor(labelAbsBeat / beatsPerMeasure);
            const derivedBeat = (labelAbsBeat % beatsPerMeasure) + 1;

            // Determine flat preference from context tonic
            const preferFlats = ['F','Bb','Eb','Ab','Db','Gb'].includes(ctxTonic);

            // ── Build data matching current HarmonyExplainData type ──
            const data: HarmonyExplainData = {
                absBeat: labelAbsBeat,
                ui: {
                    measureIndex: derivedMeasureIndex,
                    beatInMeasure: derivedBeat,
                    preferFlats,
                },
                context: { tonic: ctxTonic, isMinor: ctxIsMinor },
                label: {
                    roman: String(lbl.roman ?? ''),
                    romanDisplay: String((lbl as any).romanDisplay ?? lbl.roman ?? ''),
                    symbol: String(symResult ?? ''),
                    figures: (figResult?.figures ?? []).map(String),
                    isOverride: Boolean((lbl as any).isOverride),
                    alternatives: (lbl as any).alternatives ?? undefined,
                },
                notes: labelNotes,
                debugSnapshot: {
                    pcsBase,
                    pcsFigures,
                    pcsRoman,
                    removedForFigures: debugSnap?.removedForFigures ?? [],
                    removedForRoman: debugSnap?.removedForRoman ?? [],
                },
                candidates: (candidates ?? []).slice(0, 8).map((c: any) => {
                    const rPitch = c.root?.pitch ?? '';
                    const rAcc = c.root?.accidental ?? '';
                    const rName = rAcc === 'sharp' ? rPitch + '#'
                        : rAcc === 'flat' ? rPitch + 'b'
                        : rAcc === 'double-sharp' ? rPitch + '##'
                        : rAcc === 'double-flat' ? rPitch + 'bb'
                        : rPitch;
                    return {
                        rootPc: c.root?.midi != null ? ((c.root.midi % 12 + 12) % 12) : null,
                        rootName: rName || null,
                        type: String(c.type ?? ''),
                        matchType: String(c.matchType ?? c.type ?? ''),
                        score: Number(c.score ?? 0),
                    };
                }),
                confidence: { level: confidenceLevel, reasons: confidenceReasons },
            };

            setExplainData(data);
            setIsExplainOpen(true);
        } catch { /* ignore */ }
    }, [analyzedNotes, analysisContexts, currentTonic, isMinorMode, analysisContextAbsBeat, timeSignature]);

    const closeExplain = useCallback(() => {
        setIsExplainOpen(false);
        setExplainData(null);
    }, []);

    return { isExplainOpen, explainData, openExplain, closeExplain };
}
