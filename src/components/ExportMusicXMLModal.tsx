import { useEffect, useRef, useState } from 'react';

export type ExportMusicXMLMode = 'standard' | 'spoken' | 'functional' | 'absolute';
export type ExportMusicXMLChoice = { mode: ExportMusicXMLMode };

type Props = {
    open: boolean;
    onClose: () => void;
    onConfirm: (choice: ExportMusicXMLChoice) => void;
};

type Main = 'standard' | 'spoken' | 'token';

const MAIN: Array<{ v: Main; title: string; fmt: string; desc: string }> = [
    { v: 'standard', title: 'Standard (visivo)', fmt: '.musicxml · tutti i software', desc: 'Romani sopra + cifre reali sotto. Formato universale (MuseScore, Finale, Sibelius, Dorico…).' },
    { v: 'spoken', title: 'Parlata (non vedenti)', fmt: '.mscx · solo MuseScore', desc: 'Analisi scritta in italiano nel basso figurato, letta da VoiceOver. Niente da installare.' },
    { v: 'token', title: 'Token (per dizionario VoiceOver)', fmt: '.mscx · solo MuseScore', desc: 'Sigle compatte nel basso figurato; richiede un dizionario di pronuncia VoiceOver.' },
];

const SUB: Array<{ v: 'functional' | 'absolute'; title: string }> = [
    { v: 'functional', title: 'Funzionale — grado (V7, IV43)' },
    { v: 'absolute', title: 'Assoluto — sigla (Bb7, F#65)' },
];

/**
 * Dialogo di export dell'analisi. Si apre su "Standard" con il focus su Esporta → Invio conferma
 * subito. Il ramo "Token" espone due sotto-scelte (funzionale / assoluto).
 */
export default function ExportMusicXMLModal({ open, onClose, onConfirm }: Props) {
    const [main, setMain] = useState<Main>('standard');
    const [sub, setSub] = useState<'functional' | 'absolute'>('functional');
    const confirmRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return;
        setMain('standard');
        setSub('functional');
        const id = setTimeout(() => confirmRef.current?.focus(), 0);
        return () => clearTimeout(id);
    }, [open]);

    if (!open) return null;

    const resolved: ExportMusicXMLMode = main === 'token' ? sub : main;
    const confirm = () => onConfirm({ mode: resolved });

    return (
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
            onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
                else if (e.key === 'Enter') { e.stopPropagation(); confirm(); }
            }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-[470px] max-w-[92vw] rounded-lg border border-slate-700 bg-slate-800 p-5 text-slate-100 shadow-2xl">
                <div className="mb-3 text-base font-semibold">Esporta analisi</div>

                <div className="space-y-2">
                    {MAIN.map(m => (
                        <div key={m.v}>
                            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-700 p-2 hover:bg-slate-700/40">
                                <input type="radio" name="xml-main" className="mt-1" checked={main === m.v} onChange={() => setMain(m.v)} />
                                <span>
                                    <span className="font-medium">{m.title}</span>
                                    <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{m.fmt}</span>
                                    <span className="block text-xs text-slate-400">{m.desc}</span>
                                </span>
                            </label>
                            {m.v === 'token' && main === 'token' && (
                                <div className="ml-7 mt-1 space-y-1">
                                    {SUB.map(s => (
                                        <label key={s.v} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-700 p-1.5 text-sm hover:bg-slate-700/40">
                                            <input type="radio" name="xml-sub" checked={sub === s.v} onChange={() => setSub(s.v)} />
                                            <span>{s.title}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <button type="button" className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700" onClick={onClose}>Annulla</button>
                    <button ref={confirmRef} type="button" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500" onClick={confirm}>Esporta</button>
                </div>
            </div>
        </div>
    );
}
