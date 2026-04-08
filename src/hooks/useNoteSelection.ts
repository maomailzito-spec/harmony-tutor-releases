/**
 * useNoteSelection — owns selection, clipboard, paste-caret, marquee state
 * AND read-only helpers: handleCopy, selectedTiePair, beam state, toggleTie,
 * handleDeselectOnClickOutside, handleToggleBeamGroup.
 *
 * Day-1: pure state ownership.
 * Day-2: read-only helpers + handleCopy, toggleTie, toggleBeam, deselect.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { StaffNote, Voice, TimeSignature, TimeSignatureChange } from '../types';
import { DURATION_VALUES } from '../constants';
import { calculateNoteBeats } from '../utils/musicTheory';

/* ── Paste-caret / paste-marker shapes ── */
export interface PasteCaret {
    x: number;
    systemIndex: number;
    measureIndex: number;
    beat: number;
}
export interface PasteMarker {
    systemIndex: number;
    measureIndex: number;
    beat: number;
    ts: number;
}

/* ── Selection rectangle (marquee) ── */
export interface SelectionRect {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    isVisible: boolean;
    systemIndex: number | null;
    filterVoice: Voice | null;
}

const EMPTY_SELECTION_RECT: SelectionRect = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    isVisible: false,
    systemIndex: null,
    filterVoice: null,
};

/* ── Hook ── */
export interface UseNoteSelectionParams {
    /** Current raw (un-analyzed) notes — needed by handleCopy, beam, tie. */
    rawNotes: StaffNote[];
    /** Setter to mutate rawNotes (for toggleTie, toggleBeam). */
    setRawNotes: React.Dispatch<React.SetStateAction<StaffNote[]>>;
    /** Current time signature. */
    timeSignature: TimeSignature;
    /** Time signature changes list. */
    timeSignatureChanges: TimeSignatureChange[];
}

export function useNoteSelection({
    rawNotes,
    setRawNotes,
    timeSignature,
    timeSignatureChanges,
}: UseNoteSelectionParams) {
    // ── Selected notes ──
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    const latestSelectedNoteIds = useRef(selectedNoteIds);
    useEffect(() => {
        latestSelectedNoteIds.current = selectedNoteIds;
    }, [selectedNoteIds]);

    // ── Clipboard ──
    const [clipboard, setClipboard] = useState<StaffNote[] | null>(null);
    const latestClipboardRef = useRef<StaffNote[] | null>(clipboard);
    const pasteToSelectedVoiceRef = useRef(false);
    const skipPlayheadRefineOnceRef = useRef(false);
    useEffect(() => {
        latestClipboardRef.current = clipboard;
    }, [clipboard]);

    // ── Copy / paste error ──
    const [copyPasteError, setCopyPasteError] = useState<string | null>(null);

    // ── Paste caret / marker ──
    const [pasteCaret, setPasteCaret] = useState<PasteCaret | null>(null);
    const [pasteMarker, setPasteMarker] = useState<PasteMarker | null>(null);
    const latestPasteCaretRef = useRef<PasteCaret | null>(pasteCaret);
    useEffect(() => {
        latestPasteCaretRef.current = pasteCaret;
    }, [pasteCaret]);
    const setPasteCaretImmediate = useCallback((next: PasteCaret | null) => {
        latestPasteCaretRef.current = next;
        setPasteCaret(next);
    }, []);

    // ── Marquee selection rectangle ──
    const [selectionRect, setSelectionRect] = useState<SelectionRect>(EMPTY_SELECTION_RECT);

    // ── handleCopy ──
    const handleCopy = useCallback(() => {
        const currentSelected = latestSelectedNoteIds.current;
        if (!currentSelected || currentSelected.size === 0) return;
        const selected = rawNotes.filter(n => currentSelected.has(n.id));
        const copied = selected.map(n => ({ ...n }));
        setClipboard(copied);
    }, [rawNotes, setClipboard]);

    // ── selectedNotesBeamState (useMemo) ──
    const selectedNotesBeamState = useMemo(() => {
        const beamable = rawNotes.filter(n =>
            selectedNoteIds.has(n.id) &&
            !n.isRest &&
            DURATION_VALUES[n.duration || 'quarter'] <= 0.5
        );
        if (beamable.length < 2) return 'unbeamable' as const;

        const firstId = (beamable[0] as any).manualBeamGroupId;
        if (firstId && beamable.every(n => (n as any).manualBeamGroupId === firstId)) return 'beamed' as const;

        return beamable.some(n => (n as any).manualBeamGroupId) ? 'mixed' as const : 'unbeamed' as const;
    }, [rawNotes, selectedNoteIds]);

    // ── handleToggleBeamGroup ──
    const handleToggleBeamGroup = useCallback(() => {
        if (selectedNotesBeamState === 'unbeamable') return;

        const isBeamableSelected = (n: StaffNote) =>
            selectedNoteIds.has(n.id) && !n.isRest && DURATION_VALUES[n.duration || 'quarter'] <= 0.5;

        if (selectedNotesBeamState === 'beamed') {
            setRawNotes(prev => prev.map(n => {
                if (!isBeamableSelected(n)) return n;
                const { manualBeamGroupId, ...rest } = n as any;
                return { ...rest, manualBeamDisabled: true };
            }));
        } else {
            const gid = crypto.randomUUID();
            setRawNotes(prev => prev.map(n => isBeamableSelected(n) ? ({ ...(n as any), manualBeamGroupId: gid, manualBeamDisabled: false }) : n));
        }
    }, [selectedNotesBeamState, selectedNoteIds, setRawNotes]);

    // ── handleToggleTie ──
    const handleToggleTie = useCallback(() => {
        if (selectedNoteIds.size === 0) return;

        const notesWithBeats = calculateNoteBeats(rawNotes, timeSignature, timeSignatureChanges);
        const selected = notesWithBeats.filter(n => selectedNoteIds.has(n.id) && !n.isRest);
        if (selected.length === 0) return;

        const _tieMidi = (n: any): number => {
            try {
                const letter = String(n.pitch || '').charAt(0).toUpperCase();
                const bp: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                const base = bp[letter];
                if (base == null || !Number.isFinite(n.octave)) return Number(n.midi) || 0;
                const acc = String(n.accidental || '');
                const off = acc === 'flat' ? -1 : acc === 'sharp' ? 1
                    : acc === 'double-flat' ? -2 : acc === 'double-sharp' ? 2 : 0;
                let m = (Number(n.octave) + 1) * 12 + base + off;
                if (letter === 'B' && off > 0 && base + off >= 12) m += 12;
                return m;
            } catch { return Number(n.midi) || 0; }
        };

        setRawNotes(prev => prev.map(n => {
            if (!selectedNoteIds.has(n.id)) return n;

            const idx = notesWithBeats.findIndex(x => x.id === n.id);
            if (idx < 0) return n;

            const voice = notesWithBeats[idx].voice;
            let next: StaffNote | undefined;
            for (let i = idx + 1; i < notesWithBeats.length; i++) {
                if (notesWithBeats[i].voice === voice) { next = notesWithBeats[i]; break; }
            }
            if (!next || next.isRest || _tieMidi(next) !== _tieMidi(notesWithBeats[idx])) return n;

            if ((n as any).isTiedToNext) {
                const { isTiedToNext, ...rest } = n as any;
                return rest;
            }
            return { ...(n as any), isTiedToNext: true };
        }));
    }, [rawNotes, selectedNoteIds, setRawNotes, timeSignature, timeSignatureChanges]);

    // ── handleDeselectOnClickOutside ──
    const handleDeselectOnClickOutside = useCallback((_e: React.MouseEvent) => {
        setSelectedNoteIds(new Set());
    }, []);

    return {
        // selected notes
        selectedNoteIds,
        setSelectedNoteIds,
        latestSelectedNoteIds,
        // clipboard
        clipboard,
        setClipboard,
        latestClipboardRef,
        pasteToSelectedVoiceRef,
        skipPlayheadRefineOnceRef,
        // error
        copyPasteError,
        setCopyPasteError,
        // paste caret / marker
        pasteCaret,
        setPasteCaret,
        pasteMarker,
        setPasteMarker,
        latestPasteCaretRef,
        setPasteCaretImmediate,
        // marquee
        selectionRect,
        setSelectionRect,
        // Day-2: helpers & callbacks
        handleCopy,
        selectedNotesBeamState,
        handleToggleBeamGroup,
        handleToggleTie,
        handleDeselectOnClickOutside,
    } as const;
}

export type NoteSelectionState = ReturnType<typeof useNoteSelection>;
