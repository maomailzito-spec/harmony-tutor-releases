/**
 * useHarmonyExplain — hook that manages the "chord identity card" modal.
 *
 * Extracted from GrandStaffEditor to keep the main component lean.
 * Returns { isExplainOpen, explainData, openExplain, closeExplain }.
 */
import { useState, useCallback } from 'react';
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
                return Math.abs(noteAbsBeat - labelAbsBeat) < 0.01;
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
            const mainCand = candidates?.[0];
            let confidenceLevel: HarmonyExplainConfidenceLevel = 'medium';
            const confidenceReasons: string[] = [];
            if (mainCand) {
                const score = mainCand.score ?? 0;
                if (score >= 80) { confidenceLevel = 'high'; confidenceReasons.push(`Punteggio alto (${score})`); }
                else if (score >= 50) { confidenceLevel = 'medium'; confidenceReasons.push(`Punteggio medio (${score})`); }
                else { confidenceLevel = 'low'; confidenceReasons.push(`Punteggio basso (${score})`); }
            } else {
                confidenceLevel = 'low';
                confidenceReasons.push('Nessun candidato trovato');
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
                },
                notes: labelNotes,
                debugSnapshot: {
                    pcsBase,
                    pcsFigures,
                    pcsRoman,
                    removedForFigures: debugSnap?.removedForFigures ?? [],
                    removedForRoman: debugSnap?.removedForRoman ?? [],
                },
                candidates: (candidates ?? []).slice(0, 8).map((c: any) => ({
                    rootPc: c.root?.midi != null ? ((c.root.midi % 12 + 12) % 12) : null,
                    type: String(c.type ?? ''),
                    matchType: String(c.matchType ?? c.type ?? ''),
                    score: Number(c.score ?? 0),
                })),
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
