/**
 * useNoteEditor — editing operations on selected notes.
 *
 * Owns: applyEditToSelectedNotes, applyAccidentalToSelectedNotes,
 *       applyDottedToSelectedNotes, computeDurationTicks.
 * UI wrappers (setActiveAccidentalAndApply, setDottedFromSource) stay in GSE.
 */
import { useCallback } from 'react';
import type { StaffNote, KeySignature, TimeSignature, AccidentalType, Voice, AccompanimentTrack } from '../types';
import { rebuildMeasureTimelineForVoice } from '../utils/musicTheory';
import { DURATION_VALUES, TICKS_PER_QUARTER } from '../constants';

export interface UseNoteEditorParams {
    selectedNoteIds: Set<string>;
    setSelectedNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    setRawNotes: React.Dispatch<React.SetStateAction<StaffNote[]>>;
    timeSignature: TimeSignature;
    keySignature: KeySignature;
    justInsertedNoteRef: React.MutableRefObject<string | null>;
    latestAccompanimentTracksRef: React.MutableRefObject<AccompanimentTrack[]>;
    setAccompanimentTracks: React.Dispatch<React.SetStateAction<AccompanimentTrack[]>>;
}

export function useNoteEditor({
    selectedNoteIds, setSelectedNoteIds, setRawNotes,
    timeSignature, keySignature, justInsertedNoteRef,
    latestAccompanimentTracksRef, setAccompanimentTracks,
}: UseNoteEditorParams) {

    // ── computeDurationTicks ──
    const computeDurationTicks = useCallback((n: StaffNote) => {
        try {
            const base = (DURATION_VALUES as any)[(n as any).duration || 'quarter'] || 1;
            let durBeats = base;
            if ((n as any).isDotted) durBeats *= 1.5;
            if ((n as any).isTriplet) durBeats *= 2 / 3;
            if ((n as any).isDuplet) durBeats *= 3 / 2;
            return Math.round(durBeats * TICKS_PER_QUARTER);
        } catch {
            return (n as any).durationTicks;
        }
    }, []);

    // ── applyEditToSelectedNotes ──
    const applyEditToSelectedNotes = useCallback((
        updateFn: (n: StaffNote) => StaffNote,
        opts?: { rebuildTimeline?: boolean },
    ) => {
        if (!selectedNoteIds || selectedNoteIds.size === 0) return;

        setRawNotes(prev => {
            try {
                const selected = prev.filter(n => selectedNoteIds.has(n.id));
                if (selected.length === 0) return prev;

                let next = prev.map(n => selectedNoteIds.has(n.id) ? updateFn(n) : n);

                if (opts?.rebuildTimeline) {
                    const affected = new Map<string, { m: number; v: Voice }>();
                    for (const n of selected) {
                        const m = (n as any).measureIndex;
                        const v = (n as any).voice;
                        if (typeof m === 'number' && typeof v === 'number') affected.set(`${m}|${v}`, { m, v: v as Voice });
                    }
                    for (const { m, v } of affected.values()) {
                        const rebuilt = rebuildMeasureTimelineForVoice(next, m, v, timeSignature);
                        const others = next.filter(nn => nn.measureIndex !== m || nn.voice !== v);
                        next = [...others, ...rebuilt];
                    }
                }

                return next.sort((a, b) => {
                    if ((a.measureIndex ?? 0) !== (b.measureIndex ?? 0)) return (a.measureIndex ?? 0) - (b.measureIndex ?? 0);
                    const aSt = (a as any).startTick;
                    const bSt = (b as any).startTick;
                    if (typeof aSt === 'number' && typeof bSt === 'number' && aSt !== bSt) return aSt - bSt;
                    if ((a.beat ?? 1) !== (b.beat ?? 1)) return (a.beat ?? 1) - (b.beat ?? 1);
                    return (a.voice ?? 1) - (b.voice ?? 1);
                });
            } catch {
                return prev;
            }
        });

        // Route the same updateFn to any selected ACC notes
        const accTracks = latestAccompanimentTracksRef.current;
        const accIds = [...selectedNoteIds].filter(id =>
            accTracks.some(t => t.notes.some(n => n.id === id)));
        if (accIds.length > 0) {
            const accIdSet = new Set(accIds);
            setAccompanimentTracks(prev => prev.map(track => ({
                ...track,
                notes: track.notes.map(n => {
                    if (!accIdSet.has(n.id)) return n;
                    return updateFn(n);
                }),
            })));
        }
    }, [selectedNoteIds, setRawNotes, timeSignature, latestAccompanimentTracksRef, setAccompanimentTracks]);

    // ── applyAccidentalToSelectedNotes ──
    const applyAccidentalToSelectedNotes = useCallback((acc: AccidentalType | null) => {
        if (!selectedNoteIds || selectedNoteIds.size === 0) return;
        if (justInsertedNoteRef.current && selectedNoteIds.size === 1 && selectedNoteIds.has(justInsertedNoteRef.current)) {
            justInsertedNoteRef.current = null;
            setSelectedNoteIds(new Set());
            return;
        }

        const LETTER_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, keySignature.type === 'sharp' ? keySignature.count : 0);
        const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, keySignature.type === 'flat' ? keySignature.count : 0);

        applyEditToSelectedNotes((n) => {
            if (n.isRest) return n;

            const pitch = (n as any).pitch as string;
            const octave = (n as any).octave as number;
            const baseMidi = (octave + 1) * 12 + (LETTER_SEMI[pitch] ?? 0);
            const keyAlt =
                (keySignature.type === 'sharp' && sharpNotes.includes(pitch)) ? 1 :
                (keySignature.type === 'flat' && flatNotes.includes(pitch)) ? -1 : 0;

            if (!acc) {
                const restoredMidi = baseMidi + keyAlt;
                const { userAccidental, explicitAccidental, accidental, ...rest } = n as any;
                return { ...(rest as StaffNote), midi: restoredMidi, noteIndex: ((restoredMidi % 12) + 12) % 12 };
            }

            const accOffset =
                acc === 'sharp' ? 1 :
                acc === 'flat' ? -1 :
                acc === 'double-sharp' ? 2 :
                acc === 'double-flat' ? -2 : 0;
            const finalMidi = baseMidi + accOffset;

            return {
                ...(n as any),
                midi: finalMidi,
                noteIndex: ((finalMidi % 12) + 12) % 12,
                userAccidental: acc,
                explicitAccidental: acc,
                accidental: acc,
            } as StaffNote;
        });
    }, [applyEditToSelectedNotes, keySignature, selectedNoteIds, justInsertedNoteRef, setSelectedNoteIds]);

    // ── applyDottedToSelectedNotes ──
    const applyDottedToSelectedNotes = useCallback((nextIsDotted: boolean) => {
        if (!selectedNoteIds || selectedNoteIds.size === 0) return;
        if (justInsertedNoteRef.current && selectedNoteIds.size === 1 && selectedNoteIds.has(justInsertedNoteRef.current)) {
            justInsertedNoteRef.current = null;
            setSelectedNoteIds(new Set());
            return;
        }
        applyEditToSelectedNotes((n) => {
            const updated = { ...(n as any), isDotted: nextIsDotted } as StaffNote;
            return { ...(updated as any), durationTicks: computeDurationTicks(updated) } as StaffNote;
        }, { rebuildTimeline: true });
    }, [applyEditToSelectedNotes, computeDurationTicks, selectedNoteIds, justInsertedNoteRef, setSelectedNoteIds]);

    return {
        computeDurationTicks,
        applyEditToSelectedNotes,
        applyAccidentalToSelectedNotes,
        applyDottedToSelectedNotes,
    } as const;
}

export type NoteEditorState = ReturnType<typeof useNoteEditor>;
