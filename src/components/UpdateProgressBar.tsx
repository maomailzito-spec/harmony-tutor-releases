import React, { useState, useEffect } from 'react';

/**
 * Floating progress bar for auto-update downloads.
 * Listens to UPDATE_DOWNLOAD_PROGRESS from the main process via preload bridge.
 * Shows a slim bar at the bottom of the window during download, auto-hides when done/error.
 */
const UpdateProgressBar: React.FC = () => {
    const [state, setState] = useState<{
        percent: number;
        status: 'idle' | 'downloading' | 'ready' | 'error';
        error?: string;
    }>({ percent: 0, status: 'idle' });

    useEffect(() => {
        const api = (window as any).electronAPI;
        if (!api?.onUpdateProgress) return;
        const unsub = api.onUpdateProgress((data: any) => {
            setState({
                percent: data.percent ?? 0,
                status: data.status ?? 'idle',
                error: data.error,
            });
        });
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    // Auto-hide after "ready" or "error" after 6 seconds
    useEffect(() => {
        if (state.status === 'ready' || state.status === 'error') {
            const t = setTimeout(() => setState(s => ({ ...s, status: 'idle' })), 6000);
            return () => clearTimeout(t);
        }
    }, [state.status]);

    if (state.status === 'idle') return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 z-[9999] pointer-events-none">
            <div className="mx-auto max-w-xl pointer-events-auto px-4 pb-2">
                <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-lg px-4 py-2 flex items-center gap-3">
                    {state.status === 'downloading' && (
                        <>
                            <span className="text-xs text-slate-300 whitespace-nowrap">
                                Scaricando aggiornamento…
                            </span>
                            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-cyan-500 rounded-full transition-all duration-300"
                                    style={{ width: `${state.percent}%` }}
                                />
                            </div>
                            <span className="text-xs text-slate-400 w-10 text-right">
                                {state.percent}%
                            </span>
                        </>
                    )}
                    {state.status === 'ready' && (
                        <span className="text-xs text-green-400">
                            ✓ Aggiornamento scaricato — verrà installato al riavvio.
                        </span>
                    )}
                    {state.status === 'error' && (
                        <span className="text-xs text-red-400">
                            Errore aggiornamento: {state.error || 'sconosciuto'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdateProgressBar;
