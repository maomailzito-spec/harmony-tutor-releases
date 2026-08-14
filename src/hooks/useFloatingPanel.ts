import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * UN PANNELLO CHE SI SPOSTA COL MOUSE.
 *
 * Il trascinamento esisteva già due volte, copiato: in `MixerPanel` e in
 * `DrumPalettePanel` — che lo dichiara pure nel commento («same pattern as
 * MixerPanel»). Due copie identiche sono due copie che alla prima modifica
 * divergono, ed è la ragione per cui questo sta qui e non in un terzo posto.
 * I due pannelli esistenti possono migrare quando si toccheranno: funzionano,
 * e riscriverli senza motivo è un rischio senza guadagno.
 *
 * La posizione resta DENTRO la finestra: trascinando fuori dal bordo il pannello
 * tornerebbe irraggiungibile, e non c'è modo di ripescarlo se non riavviando.
 *
 * @param inizio      posizione di partenza, in pixel dall'angolo alto-sinistra
 * @param chiaveMemoria se data, la posizione sopravvive alla chiusura dell'app
 */
export function useFloatingPanel(
    inizio: { x: number; y: number },
    chiaveMemoria?: string,
) {
    const [pos, setPos] = useState<{ x: number; y: number }>(() => {
        if (!chiaveMemoria) return inizio;
        try {
            const salvata = JSON.parse(localStorage.getItem(chiaveMemoria) || 'null');
            if (salvata && Number.isFinite(salvata.x) && Number.isFinite(salvata.y)) {
                // Una posizione salvata su uno schermo più grande può cadere fuori da
                // quello attuale: si riporta dentro invece di sparire.
                return {
                    x: Math.max(0, Math.min(window.innerWidth - 80, salvata.x)),
                    y: Math.max(0, Math.min(window.innerHeight - 40, salvata.y)),
                };
            }
        } catch { /* posizione illeggibile: si riparte da quella di partenza */ }
        return inizio;
    });

    const trascinamento = useRef<{ dx: number; dy: number } | null>(null);

    /** Da mettere sull'`onMouseDown` della maniglia, non di tutto il pannello:
     *  altrimenti ogni pulsante diventa un punto di presa e non si clicca più. */
    const prendi = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        trascinamento.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    }, [pos]);

    useEffect(() => {
        const muovi = (e: MouseEvent) => {
            if (!trascinamento.current) return;
            const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - trascinamento.current.dx));
            const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - trascinamento.current.dy));
            setPos({ x, y });
        };
        const lascia = () => {
            if (trascinamento.current && chiaveMemoria) {
                try { localStorage.setItem(chiaveMemoria, JSON.stringify(pos)); } catch { /* ignora */ }
            }
            trascinamento.current = null;
        };
        window.addEventListener('mousemove', muovi);
        window.addEventListener('mouseup', lascia);
        return () => {
            window.removeEventListener('mousemove', muovi);
            window.removeEventListener('mouseup', lascia);
        };
    }, [pos, chiaveMemoria]);

    return { pos, prendi };
}
