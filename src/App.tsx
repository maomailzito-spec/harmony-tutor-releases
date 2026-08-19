import React, { useState, useEffect, useRef } from 'react';
import { AudioService } from './services/AudioService';
import ScalesVisualizer from './components/ScalesVisualizer';
import ChordVisualizer from './components/ChordVisualizer';
import IntervalsVisualizer from './components/IntervalsVisualizer';
import MainEditor from './components/MainEditor';
import GrandStaffEditor from './components/GrandStaffEditor';
import UpdateProgressBar from './components/UpdateProgressBar';
import { getAppFlavor, isModeEnabled } from './flavor';
import { MENU_ACTIONS } from './contracts/menuActionRuntime';
import { getMenuActionTarget } from './contracts/menuActionTargets';
import { electronBridge } from './services/electronBridge';
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

    const [menuErrorToast, setMenuErrorToast] = useState<{ code: string; message: string; ts: number } | null>(null);
    
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
        // Diagnostica del sincronismo, da console: `__htAudioLate()` mostra quante note
        // sono state consegnate in ritardo al motore audio (con `true` azzera il conto).
        try { (window as any).__htAudioLate = (reset?: boolean) => AudioService.readLateness(!!reset); } catch { /* ignore */ }
        // ELENCO DEGLI STRUMENTI DI DIAGNOSI — `__htAiuto()` in console.
        // Restano nella build pubblicata: costano zero finché non li si chiama (i due che
        // raccolgono dati mentre l'app lavora si accendono da localStorage e di default
        // sono spenti), e servono ai difetti che si vedono solo sulla macchina di chi li
        // segnala, dove non c'è nessun ambiente di sviluppo da avviare. Chi non sa che
        // esistono non li incontra mai; a noi bastano due righe dettate al telefono.
        try {
            (window as any).__htAiuto = () => {
                const attivo = (nome: string) => (typeof (window as any)[nome] === 'function' ? 'pronto' : 'non ancora disponibile');
                const righe = [
                    { comando: '__htAudio()', stato: attivo('__htAudio'), cosa_dice: 'note consegnate in ritardo al motore audio + quanto è intervenuto il limitatore' },
                    { comando: '__htAudioLate(azzera?)', stato: attivo('__htAudioLate'), cosa_dice: 'solo il conto dei ritardi; con true riparte da zero' },
                    { comando: '__htBattuta(n)', stato: attivo('__htBattuta'), cosa_dice: 'cosa c\'è davvero nella battuta n: voce, figura, inizio/durata/fine in tick, e i posti dove una nota può cominciare' },
                    { comando: '__htUltimiInserimenti()', stato: attivo('__htUltimiInserimenti'), cosa_dice: 'le ultime venti note scritte col mouse: dove si è cliccato, che tempo è stato letto, quale attacco ha vinto' },
                    { comando: '__htMisure()', stato: attivo('__htMisure'), cosa_dice: 'da dove esce il numero di misure in barra: il minimo, l\'ultima misura del coro, l\'ultima delle tracce, quante ne sono disegnate' },
                    { comando: '__htMisuraTeste()', stato: attivo('__htMisuraTeste'), cosa_dice: 'scarto fra la x che diamo a una nota e la testa disegnata — da accendere prima: localStorage._HT_MISURA_TESTE = \'1\' e ricaricare' },
                    { comando: '__htGhost', stato: (typeof (window as any).__htGhost === 'object' && (window as any).__htGhost) ? 'pronto' : 'non ancora disponibile', cosa_dice: 'lo stesso scarto per la nota fantasma; si legge DOPO aver mosso il mouse sul rigo (stesso interruttore di __htMisuraTeste)' },
                ];
                // eslint-disable-next-line no-console
                console.table(righe);
                // eslint-disable-next-line no-console
                console.log(
                    'Interruttori che non sono comandi:\n' +
                    "  localStorage._HT_DEBUG_BEAT = '43'  → ricarica → in console il ragionamento delle etichette sul movimento 43 (con '-1' tutti)\n" +
                    "  localStorage._HT_MISURA_TESTE = '1' → ricarica → accende la raccolta per __htMisuraTeste() e __htGhost\n" +
                    '  per spegnerli: localStorage.removeItem(\'_HT_DEBUG_BEAT\')',
                );
                return 'Strumenti di diagnosi. "non ancora disponibile" = quella parte dell\'app non è ancora stata aperta, o l\'interruttore è spento.';
            };
        } catch { /* la diagnostica non deve mai disturbare l'avvio */ }
    }, []);

    // Native menu integration (Electron): allow switching app mode from "Vista".
    useEffect(() => {
        const remove = electronBridge.onMenuAction((action, payload) => {
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
        return () => remove();
    }, [flavor]);

    // Native menu integration (Electron): surface menu errors and allow Import/Export MIDI to
    // work even if the user is not currently on the GrandStaff view.
    useEffect(() => {
        if (!isModeEnabled(flavor, 'grandStaff')) return;

        const removeErr = electronBridge.onMenuError((code: string, message: string) => {
            const next = { code: String(code || 'errore'), message: String(message || ''), ts: Date.now() };
            setMenuErrorToast(next);
            // Auto-dismiss (non-invasive). Keep last error visible briefly.
            window.setTimeout(() => {
                setMenuErrorToast((cur) => (cur && cur.ts === next.ts) ? null : cur);
            }, 6500);
        });

        const remove = electronBridge.onMenuAction((action, payload) => {
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
            removeErr();
            remove();
        };
    }, [mode, flavor]);
    
    return (
        <div className="h-screen overflow-hidden flex flex-col bg-gray-900 font-sans text-gray-100">
            {menuErrorToast ? (
                <div className="fixed top-3 right-3 z-50 max-w-[min(520px,calc(100vw-24px))] rounded-md border border-red-700/50 bg-red-950/80 px-3 py-2 text-sm shadow-lg backdrop-blur">
                    <div className="font-semibold text-red-100">{menuErrorToast.code}</div>
                    {menuErrorToast.message ? (
                        <div className="mt-0.5 text-red-100/90 break-words">{menuErrorToast.message}</div>
                    ) : null}
                </div>
            ) : null}
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
            <UpdateProgressBar />
        </div>
    );
};

export default App;