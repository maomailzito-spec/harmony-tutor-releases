/// <reference lib="webworker" />
/**
 * Harmony analysis Web Worker.
 *
 * Runs the (pure, i18n/localStorage-free) `applyHarmonyRules` off the main thread so editing never
 * blocks. The main thread posts { seq, args }; we reply { seq, ok, result } (or { seq, ok:false, error }).
 * `seq` lets the caller discard stale (out-of-order) results.
 *
 * The analysis returns RAW violations (no localized text): the main thread localizes them at render
 * via enrichViolationsWithText — the worker has no i18n.
 */
import { applyHarmonyRules } from '../utils/musicTheory';

interface AnalysisArgs {
    notes: any[];
    keySignature: any;
    keyTonic: string;
    isMinor: boolean;
    analysisContexts: any[];
    timeSignature?: any;
    doubleBarlineMeasures?: number[];
    ornamentOverrides?: any[];
    harmonyOverrides?: any[];
    opts?: { learnedOrnamentsEnabled?: boolean; partCount?: 2 | 3 | 4 };
}

self.onmessage = (e: MessageEvent<{ seq: number; args: AnalysisArgs }>) => {
    const { seq, args } = e.data || ({} as any);
    try {
        const result = applyHarmonyRules(
            args.notes,
            args.keySignature,
            args.keyTonic,
            args.isMinor,
            args.analysisContexts,
            args.timeSignature,
            args.doubleBarlineMeasures,
            args.ornamentOverrides,
            args.harmonyOverrides,
            args.opts,
        );
        // Compact the payload: `analyzedNotes` is the input notes + a few analysis annotations. Ship
        // a SPARSE diff per note (id + only the fields that changed vs input) so the main thread
        // deserializes far less; it reconstructs analyzedNotes by merging the diff onto the live notes.
        const inputById = new Map<any, any>();
        for (const n of (args.notes || [])) if (n && (n as any).id != null) inputById.set((n as any).id, n);
        const analyzedNotesSparse = ((result as any).analyzedNotes || []).map((an: any) => {
            const inp = an && an.id != null ? inputById.get(an.id) : undefined;
            if (!inp) return an; // synthesized/new note (no input match) → ship in full
            const diff: any = { id: an.id };
            for (const k in an) if (an[k] !== inp[k]) diff[k] = an[k];
            return diff;
        });
        (self as unknown as Worker).postMessage({
            seq,
            ok: true,
            result: {
                analyzedNotesSparse,
                connections: (result as any).connections,
                violations: (result as any).violations,
                inferredAnalysisContexts: (result as any).inferredAnalysisContexts,
            },
        });
    } catch (err: any) {
        (self as unknown as Worker).postMessage({ seq, ok: false, error: String(err?.message ?? err) });
    }
};
