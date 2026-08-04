import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * PRENDI E POSA — impalcatura generica per portare un segno da una tavolozza
 * flottante al punto voluto della partitura.
 *
 * Non sa nulla di dinamiche: trasporta un "carico" qualunque (`SignDragPayload`)
 * e, quando lo si molla sopra un sistema, restituisce DOVE è stato mollato in
 * coordinate della partitura. Chi la usa decide cosa farne. Serve alle dinamiche
 * oggi e agli altri segni domani — rallentando, accenti, staccati, legature.
 *
 * Il bersaglio è il contenitore di ogni sistema, che porta già `data-system-index`.
 *
 * Un clic SENZA spostamento non è un trascinamento: il gesto viene abbandonato e
 * l'`onClick` del pulsante fa il suo corso, così la tavolozza continua a
 * funzionare anche col vecchio "seleziona la nota e clicca il segno".
 */
export interface SignDragPayload {
    /** Che cosa si sta posando: chi riceve il rilascio decide in base a questo. */
    kind: string;
    /** Dati liberi del segno (il livello, il tipo di accento, la direzione…). */
    data?: any;
    /** Come si disegna l'anteprima che segue il cursore. */
    label: string;
}

export interface SignDropTarget {
    systemIndex: number;
    /** Coordinate DENTRO l'SVG del sistema, le stesse che usa il clic sul rigo. */
    x: number;
    y: number;
}

/** Oltre questi pixel il gesto diventa un trascinamento (sotto, resta un clic). */
const SOGLIA_PX = 4;

export function useSignDrag(onDrop: (payload: SignDragPayload, target: SignDropTarget) => void) {
    const [carico, setCarico] = useState<SignDragPayload | null>(null);
    const [punta, setPunta] = useState<{ x: number; y: number } | null>(null);

    const statoRef = useRef<{ payload: SignDragPayload; x0: number; y0: number; mosso: boolean } | null>(null);
    const onDropRef = useRef(onDrop);
    useEffect(() => { onDropRef.current = onDrop; }, [onDrop]);

    /** Da chiamare sul mousedown del pulsante della tavolozza. */
    const inizia = useCallback((payload: SignDragPayload, e: { clientX: number; clientY: number; button?: number }) => {
        if (e.button != null && e.button !== 0) return;
        statoRef.current = { payload, x0: e.clientX, y0: e.clientY, mosso: false };
    }, []);

    useEffect(() => {
        const muovi = (e: MouseEvent) => {
            const st = statoRef.current;
            if (!st) return;
            if (!st.mosso) {
                if (Math.abs(e.clientX - st.x0) < SOGLIA_PX && Math.abs(e.clientY - st.y0) < SOGLIA_PX) return;
                st.mosso = true;
                setCarico(st.payload);
            }
            setPunta({ x: e.clientX, y: e.clientY });
        };

        const molla = (e: MouseEvent) => {
            const st = statoRef.current;
            statoRef.current = null;
            setCarico(null);
            setPunta(null);
            if (!st || !st.mosso) return; // era un clic, non un trascinamento

            try {
                // Il contenitore del sistema sotto il puntatore. L'overlay non riceve
                // il mouse, quindi si parte da qualunque elemento e si risale.
                const sotto = document.elementFromPoint(e.clientX, e.clientY);
                const contenitore = (sotto as Element | null)?.closest?.('[data-system-index]') as HTMLElement | null;
                if (!contenitore) return;
                const idx = Number(contenitore.getAttribute('data-system-index'));
                if (!Number.isFinite(idx)) return;

                // Stessa conversione del clic sul rigo: rettangolo dell'SVG + viewBox.
                const svg = contenitore.querySelector('svg') as SVGSVGElement | null;
                if (!svg) return;
                const rect = svg.getBoundingClientRect();
                const vb = svg.viewBox?.baseVal;
                const svgW = (vb?.width && vb.width > 0) ? vb.width : rect.width;
                const svgH = (vb?.height && vb.height > 0) ? vb.height : rect.height;
                const scaleX = rect.width ? (svgW / rect.width) : 1;
                const scaleY = rect.height ? (svgH / rect.height) : 1;

                onDropRef.current(st.payload, {
                    systemIndex: idx,
                    x: (e.clientX - rect.left) * scaleX,
                    y: (e.clientY - rect.top) * scaleY,
                });
            } catch { /* rilascio fuori bersaglio: si abbandona */ }
        };

        window.addEventListener('mousemove', muovi);
        window.addEventListener('mouseup', molla);
        return () => {
            window.removeEventListener('mousemove', muovi);
            window.removeEventListener('mouseup', molla);
        };
    }, []);

    return { inizia, carico, punta, inCorso: carico != null };
}
