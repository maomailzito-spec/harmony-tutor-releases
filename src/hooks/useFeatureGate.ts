import { useEffect, useState } from 'react';

/**
 * Commercial feature gate. `limited` is true ONLY when the desktop app was opened in
 * "modalità limitata" — i.e. the 10-day trial expired, there is no valid license, and the
 * user chose «Continua (funzioni limitate)» at startup.
 *
 * In limited mode the app stays a full EDITOR: manual editing, revoice/«Cambio voce»,
 * export, playback and print remain available. Only the automatic ANALYSIS and automatic
 * REALIZATION (chord-symbol → SATB, ACC patterns) are disabled.
 *
 * Outside Electron (web build) or on any error the gate defaults to NOT limited.
 */
export function useFeatureGate(): { limited: boolean } {
    const [limited, setLimited] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const api = (window as any).electronAPI;
                const gate = await api?.getFeatureGate?.();
                if (!cancelled && gate && typeof gate.limited === 'boolean') {
                    setLimited(gate.limited);
                }
            } catch {
                /* non-Electron or IPC error → treat as full (never lock out by accident) */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    return { limited };
}
