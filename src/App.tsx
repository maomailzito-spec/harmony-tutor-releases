import React, { useState, useEffect, useRef } from 'react';
import { AudioService } from './services/AudioService';
import ScalesVisualizer from './components/ScalesVisualizer';
import ChordVisualizer from './components/ChordVisualizer';
import IntervalsVisualizer from './components/IntervalsVisualizer';
import MainEditor from './components/MainEditor';
import GrandStaffEditor from './components/GrandStaffEditor';
import { getAppFlavor, isModeEnabled } from './flavor';
import { MENU_ACTIONS } from './contracts/menuActionRuntime';
import { getMenuActionTarget } from './contracts/menuActionTargets';
import type { MenuAction, MenuActionPayloadMap } from '../shared/menuActionRegistry';

type AppMode = 'scales' | 'chords' | 'intervals' | 'editor' | 'grandStaff';

const App: React.FC = () => {
    const flavor = getAppFlavor();
    const defaultMode: AppMode = (flavor === 'guitar') ? 'editor' : 'grandStaff';
    const [mode, setMode] = useState<AppMode>(defaultMode);
    const [pendingMenuAction, setPendingMenuAction] = useState<{
        action: MenuAction;
        payload: MenuActionPayloadMap[MenuAction];
        nonce: number;
    } | null>(null);
    
    // --- AUDIO STATE ---
    const audioServiceRef = useRef(new AudioService());
    const [isAudioReady, setIsAudioReady] = useState(false);

    useEffect(() => {
        const audioService = audioServiceRef.current;
        audioService.init().then(() => {
            setIsAudioReady(true);
        }).catch(() => {
            // errore silenziato
        });
    }, []);

    // Native menu integration (Electron): allow switching app mode from "Vista".
    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.onMenuAction) return;
        const remove = api.onMenuAction((action, payload) => {
            try {
                if (action !== MENU_ACTIONS.SET_APP_MODE) return;
                const next = payload?.mode;
                if (!next) return;
                if (!isModeEnabled(flavor, next)) return;
                setMode(next as AppMode);
            } catch {
                // ignore
            }
        });
        return () => { if (remove) remove(); };
    }, [flavor]);

    // Native menu integration (Electron): surface menu errors and allow Import/Export MIDI to
    // work even if the user is not currently on the GrandStaff view.
    useEffect(() => {
        if (!isModeEnabled(flavor, 'grandStaff')) return;
        const api = window.electronAPI;
        if (!api) return;

        const removeErr = api.onMenuError?.((code: string, message: string) => {
            try { window.alert(`${String(code || 'errore')}: ${String(message || '')}`); } catch { /* ignore */ }
        });

        const remove = api.onMenuAction?.((action, payload) => {
            try {
                // If the action targets GrandStaff but we're not there, switch and queue it.
                if (getMenuActionTarget(action) !== 'grandStaff') return;
                if (mode === 'grandStaff') return;
                setMode('grandStaff');
                setPendingMenuAction({ action, payload: payload as any, nonce: Date.now() });
            } catch {
                // ignore
            }
        });

        return () => {
            if (removeErr) removeErr();
            if (remove) remove();
        };
    }, [mode, flavor]);
    
    return (
        <div className="h-screen overflow-hidden flex flex-col bg-gray-900 font-sans text-gray-100">
            <div className="w-full px-2 lg:px-4 flex flex-col flex-grow min-h-0 overflow-hidden">

                <div className={mode === 'scales' ? 'flex flex-col flex-grow min-h-0 overflow-hidden' : 'hidden'}>
                    <ScalesVisualizer 
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                        isActive={mode === 'scales'}
                    />
                </div>
                <div className={mode === 'chords' ? 'flex flex-col flex-grow min-h-0 overflow-hidden' : 'hidden'}>
                    <ChordVisualizer 
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                        isActive={mode === 'chords'}
                    />
                </div>
                <div className={mode === 'intervals' ? 'flex flex-col flex-grow min-h-0 overflow-hidden' : 'hidden'}>
                    <IntervalsVisualizer
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                        isActive={mode === 'intervals'}
                    />
                </div>
                <div className={mode === 'editor' ? 'flex flex-col flex-grow min-h-0 overflow-hidden' : 'hidden'}>
                    <MainEditor
                        isActive={mode === 'editor'}
                    />
                </div>
                <div className={(mode === 'grandStaff' && isModeEnabled(flavor, 'grandStaff')) ? 'flex flex-col flex-grow min-h-0 overflow-hidden' : 'hidden'}>
                    <GrandStaffEditor
                        isActive={mode === 'grandStaff'}
                        audioService={audioServiceRef.current}
                        isAudioReady={isAudioReady}
                        pendingMenuAction={pendingMenuAction}
                        onConsumePendingMenuAction={(nonce) => {
                            setPendingMenuAction(prev => (prev && prev.nonce === nonce) ? null : prev);
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default App;