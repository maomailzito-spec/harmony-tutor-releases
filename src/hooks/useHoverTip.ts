import { useCallback, useRef, useState } from 'react';

/**
 * IL SUGGERIMENTO CHE SI VEDE.
 *
 * I `title` nativi in questa applicazione non compaiono — è il motivo per cui la
 * toolbar si era già costruita un riquadro suo. La tavolozza non ce l'aveva, quindi
 * tutti i suoi suggerimenti (compresi i tasti: «Semiminima · 3») erano scritti e
 * invisibili: un aiuto che non si vede è un aiuto che non esiste.
 *
 * Legge l'attributo `title` dell'elemento sotto il puntatore e restituisce testo e
 * posizione; il riquadro lo disegna chi chiama. Non serve toccare i pulsanti: quelli
 * il `title` ce l'hanno già, ed è anche ciò che leggono gli screen reader.
 *
 * `MOSTRA_DA` evita di ridisegnare a ogni pixel di movimento — un riquadro che insegue
 * il mouse a sessanta fotogrammi al secondo è lo stesso genere di ridisegno continuo
 * che qui ha già affamato il thread audio.
 */
export function useHoverTip() {
    const radice = useRef<HTMLDivElement | null>(null);
    const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

    const suMovimento = useCallback((e: React.MouseEvent) => {
        try {
            const root = radice.current;
            if (!root) return;

            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (!el || !root.contains(el)) {
                if (tip) setTip(null);
                return;
            }

            const bersaglio = (el.closest('button,[role="button"],a,label,input') as HTMLElement | null) || el;
            const testo = (bersaglio?.getAttribute('title') || '').trim();
            if (!testo) {
                if (tip) setTip(null);
                return;
            }

            const x = e.clientX + 12;
            const y = e.clientY + 14;
            const MOSTRA_DA = 2;   // px di movimento sotto i quali non si ridisegna
            if (!tip || tip.text !== testo || Math.abs(tip.x - x) > MOSTRA_DA || Math.abs(tip.y - y) > MOSTRA_DA) {
                setTip({ x, y, text: testo });
            }
        } catch {
            // un suggerimento mancato non deve rompere il pannello
        }
    }, [tip]);

    const nascondi = useCallback(() => setTip(null), []);

    return { radice, tip, suMovimento, nascondi };
}
