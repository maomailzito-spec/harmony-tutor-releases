/**
 * useEditorZoom — extracted from GrandStaffEditor.tsx (Phase 2)
 *
 * Manages pinch-to-zoom (trackpad), zoom-level persistence in localStorage,
 * scroll-anchor correction, auto-reset on background click, and base-size
 * measurement for the zoom spacer.
 */
import { useState, useCallback, useRef, useEffect, useLayoutEffect, type RefObject } from 'react';
import { getString, setString } from '../storage/localStorage';
import { HT_EDITOR_ZOOM_KEY } from '../storage/storageKeys';

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;

export interface UseEditorZoomResult {
    editorZoom: number;
    resetEditorZoom: () => void;
    handleScoreMouseDownCapture: (e: React.MouseEvent) => void;
    zoomSpacerRef: RefObject<HTMLDivElement | null>;
    zoomBaseSize: { w: number; h: number };
}

export function useEditorZoom(
    scoreScrollRef: RefObject<HTMLDivElement | null>,
    staffContainerRef: RefObject<HTMLDivElement | null>,
): UseEditorZoomResult {
    // Editor zoom (trackpad pinch-to-zoom is delivered as WheelEvent with ctrlKey=true in Chromium).
    // Stored in localStorage for back-compat with older builds.
    const [editorZoom, setEditorZoom] = useState<number>(() => {
        try {
            const raw = getString(HT_EDITOR_ZOOM_KEY, '1');
            const n = Number(raw);
            if (!Number.isFinite(n)) return 1;
            return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
        } catch {
            return 1;
        }
    });

    const resetEditorZoom = useCallback(() => {
        setEditorZoom(1);
        try { setString(HT_EDITOR_ZOOM_KEY, '1'); } catch { /* ignore */ }
    }, []);

    const pendingZoomAnchorRef = useRef<null | {
        // base (unscaled) coordinates under the pointer at the time of the gesture
        baseX: number;
        baseY: number;
        pointerX: number;
        pointerY: number;
        targetZoom: number;
    }>(null);

    // Pinch gesture (trackpad) => wheel with ctrlKey=true.
    // Attached as native listener with { passive: false } so preventDefault() works.
    useEffect(() => {
        const el = scoreScrollRef.current;
        if (!el) return;
        const handler = (e: WheelEvent) => {
            if (!e.ctrlKey) return;

            const scroller = scoreScrollRef.current;
            const rect = scroller?.getBoundingClientRect?.();
            const pointerX = rect ? (Number(e.clientX) - rect.left) : 0;
            const pointerY = rect ? (Number(e.clientY) - rect.top) : 0;
            const startScrollLeft = scroller ? Number(scroller.scrollLeft) : 0;
            const startScrollTop = scroller ? Number(scroller.scrollTop) : 0;
            e.preventDefault();
            e.stopPropagation();

            const dy = Number(e.deltaY);
            if (!Number.isFinite(dy) || Math.abs(dy) < 0.01) return;

            // Smooth exponential zoom curve.
            const factor = Math.pow(1.0015, -dy);
            setEditorZoom((prev) => {
                const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * factor));
                try { setString(HT_EDITOR_ZOOM_KEY, String(Math.round(next * 1000) / 1000)); } catch { /* ignore */ }

                // Keep the content under the pointer stable while zooming.
                // We apply the actual scroll correction in a layout effect after the zoom renders,
                // to avoid one-frame lag/jitter (especially noticeable in page view).
                try {
                    if (scroller && rect && Number.isFinite(pointerX) && Number.isFinite(pointerY)) {
                        const baseX = (startScrollLeft + pointerX) / Math.max(1e-6, prev);
                        const baseY = (startScrollTop + pointerY) / Math.max(1e-6, prev);
                        pendingZoomAnchorRef.current = { baseX, baseY, pointerX, pointerY, targetZoom: next };
                    } else {
                        pendingZoomAnchorRef.current = null;
                    }
                } catch {
                    pendingZoomAnchorRef.current = null;
                }
                return next;
            });
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [scoreScrollRef]);

    useLayoutEffect(() => {
        const scroller = scoreScrollRef.current;
        const p = pendingZoomAnchorRef.current;
        if (!scroller || !p) return;
        if (Math.abs(p.targetZoom - editorZoom) > 1e-3) return;
        pendingZoomAnchorRef.current = null;
        try {
            const newLeft = p.baseX * editorZoom - p.pointerX;
            const newTop = p.baseY * editorZoom - p.pointerY;
            scroller.scrollLeft = Math.max(0, Math.round(newLeft));
            scroller.scrollTop = Math.max(0, Math.round(newTop));
        } catch {
            // ignore
        }
    }, [editorZoom, scoreScrollRef]);

    const zoomSpacerRef = useRef<HTMLDivElement | null>(null);

    const handleScoreMouseDownCapture = useCallback((e: React.MouseEvent) => {
        // Capture-phase so it still runs even when inner SVG handlers stopPropagation.
        // Only reset when clicking outside the actual score content (so we don't interfere with insert clicks).
        if (e.button !== 0) return;
        if (Math.abs(editorZoom - 1) <= 1e-3) return;
        try {
            const target = (e.target as any) as HTMLElement | null;
            if (!target) return;
            // If click is inside a note/tie, never reset.
            const inNoteOrTie = !!(target.closest?.('[data-note-id],[data-tie-from],[data-tie-to]'));
            if (inNoteOrTie) return;
            // Do not reset when interacting with UI controls.
            const inControl = !!(target.closest?.('input,button,textarea,select,[role="button"],[contenteditable="true"]'));
            if (inControl) return;

            const inSvg = !!target.closest?.('svg');
            const inScore = !!(staffContainerRef.current && staffContainerRef.current.contains(target));

            const clickedSpacer = !!target.closest?.('[data-zoom-spacer="1"]');
            const clickedOutsideScore = !!(staffContainerRef.current && !staffContainerRef.current.contains(target));
            const clickedScrollBg = !!(scoreScrollRef.current && target === scoreScrollRef.current);

            // When zoomed-in, the scaled content can cover the spacer and most of the scroll area;
            // clicks on "empty" margins often land on the score container div, not on the spacer.
            const clickedScoreNonSvgBg = inScore && !inSvg;

            if (clickedSpacer || clickedOutsideScore || clickedScrollBg || clickedScoreNonSvgBg) {
                resetEditorZoom();
            }
        } catch {
            // ignore
        }
    }, [editorZoom, resetEditorZoom, scoreScrollRef, staffContainerRef]);

    // True zoom without affecting layout: measure the base (unscaled) size, then:
    // - create a spacer sized (base * zoom) to get scrollbars
    // - render the score absolutely with transform: scale(zoom)
    const [zoomBaseSize, setZoomBaseSize] = useState<{ w: number; h: number }>({ w: 1, h: 1 });

    useLayoutEffect(() => {
        const el = staffContainerRef.current;
        if (!el) return;

        const measure = () => {
            try {
                const baseW = Math.max(1, Math.ceil(el.scrollWidth || el.offsetWidth || 1));
                const baseH = Math.max(1, Math.ceil(el.scrollHeight || el.offsetHeight || 1));
                setZoomBaseSize((prev) => (prev.w === baseW && prev.h === baseH ? prev : { w: baseW, h: baseH }));
            } catch {
                // ignore
            }
        };

        measure();

        // Prefer event-driven updates.
        try {
            if (typeof (globalThis as any).ResizeObserver === 'function') {
                const ro = new (globalThis as any).ResizeObserver(() => measure());
                ro.observe(el);
                return () => {
                    try { ro.disconnect(); } catch { /* ignore */ }
                };
            }
        } catch {
            // ignore
        }

        // Fallback: periodic re-measure.
        const id = window.setInterval(measure, 500);
        return () => window.clearInterval(id);
    }, [staffContainerRef]);

    return {
        editorZoom,
        resetEditorZoom,
        handleScoreMouseDownCapture,
        zoomSpacerRef,
        zoomBaseSize,
    };
}
