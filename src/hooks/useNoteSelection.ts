/**
 * useNoteSelection — owns selection, clipboard, paste-caret and marquee state.
 *
 * Day-1 extraction: pure state ownership, zero logic.
 * GrandStaffEditor destructures the return value and passes individual pieces
 * to the same callbacks that used them before — behaviour is 100 % identical.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { StaffNote, Voice } from '../types';

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
export function useNoteSelection() {
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
    } as const;
}

export type NoteSelectionState = ReturnType<typeof useNoteSelection>;
