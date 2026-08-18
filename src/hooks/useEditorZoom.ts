/**
 * useEditorZoom — extracted from GrandStaffEditor.tsx (Phase 2)
 *
 * Manages pinch-to-zoom (trackpad), zoom-level persistence in localStorage,
 * scroll-anchor correction, reset on background double-click, and base-size
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
    handleScoreDoubleClick: (e: React.MouseEvent) => void;
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

    /**
     * DOPPIO CLIC SUL NULLA → torna al 100%.
     *
     * Prima bastava un clic singolo, e resettava o no a seconda che il punto cadesse
     * dentro l'`<svg>` di un sistema oppure fuori. Ma l'SVG di un sistema è alto quanto il
     * sistema: copre anche il bianco sopra e sotto i righi, cioè proprio quella che a occhio
     * è «pagina vuota». Due clic a un centimetro di distanza si comportavano in modo
     * opposto, e capitava di perdere lo zoom appoggiando il puntatore sulla pagina mentre
     * si lavora — una regola invisibile, che è il peggior tipo di regola.
     *
     * Ora il gesto è deliberato (doppio clic) e la condizione è una sola, visibile a
     * occhio: si resetta SOLO se sotto il puntatore non c'è niente di disegnato. Qualunque
     * cosa — nota, legatura, segno, etichetta, righi, chiave — blocca il reset, perché il
     * bersaglio dell'evento è quell'elemento e non il fondo. Restano il ⌘0 e il comando in
     * barra per chi preferisce non mirare.
     */
    const handleScoreDoubleClick = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        if (Math.abs(editorZoom - 1) <= 1e-3) return;
        try {
            const target = (e.target as Element | null);
            if (!target) return;

            // Il fondo è un contenitore (div) o l'SVG stesso: dentro l'SVG, il bersaglio è
            // l'elemento `<svg>` solo quando il punto non tocca nessun glifo.
            const tag = String((target as any).tagName ?? '').toLowerCase();
            if (tag !== 'div' && tag !== 'svg') return;

            // Nemmeno sui comandi (titolo, campi, pulsanti).
            if (target.closest?.('input,button,textarea,select,[role="button"],[contenteditable="true"]')) return;

            resetEditorZoom();
        } catch {
            // ignore
        }
    }, [editorZoom, resetEditorZoom]);

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
        handleScoreDoubleClick,
        zoomSpacerRef,
        zoomBaseSize,
    };
}
