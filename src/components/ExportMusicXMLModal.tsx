import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type ExportMusicXMLMode = 'midi' | 'standard' | 'spoken' | 'functional' | 'absolute';
export type ExportMusicXMLChoice = { mode: ExportMusicXMLMode };

type Props = {
    open: boolean;
    onClose: () => void;
    onConfirm: (choice: ExportMusicXMLChoice) => void;
    /** I righi che finiranno nel file, già filtrati: «Coro», «Chitarra»… */
    righiInclusi?: string[];
    /** Gli strati d'analisi accesi: «numeri romani», «sigle», «cifratura». */
    analisiInclusa?: string[];
};

type Main = 'midi' | 'standard' | 'spoken' | 'token';

/**
 * Dialogo di export della musica. Si apre su "MusicXML" con il focus su Esporta → Invio conferma
 * subito. Il ramo "Token" espone due sotto-scelte (funzionale / assoluto). MIDI e MusicXML sono
 * formati generali; Parlata e Token stanno sotto l'intestazione "Per non vedenti".
 * Stringhe localizzate via i18next (italiano come defaultValue, inglese in en/ui.json).
 */
export default function ExportMusicXMLModal({ open, onClose, onConfirm, righiInclusi = [], analisiInclusa = [] }: Props) {
    const { t } = useTranslation('ui');
    const [main, setMain] = useState<Main>('standard');
    const [sub, setSub] = useState<'functional' | 'absolute'>('functional');
    const confirmRef = useRef<HTMLButtonElement | null>(null);

    // group: 'main' = formati generali; 'a11y' = flusso per non vedenti (intestazione dedicata).
    // NB: 'standard' è l'enum INTERNO della modalità MusicXML — la label mostrata è "MusicXML",
    // ma la chiave non cambia (baseline di regressione dell'export invariata).
    const MAIN: Array<{ v: Main; title: string; fmt: string; desc: string; group: 'main' | 'a11y' }> = [
        { v: 'midi', title: 'MIDI', fmt: t('export_music_midi_fmt', { defaultValue: '.mid · sequencer, DAW, notazione' }), desc: t('export_music_midi_desc', { defaultValue: 'Le note del brano come file MIDI (senza analisi). Per DAW, editor di notazione e sintetizzatori.' }), group: 'main' },
        { v: 'standard', title: 'MusicXML', fmt: t('export_music_xml_fmt', { defaultValue: '.musicxml · tutti i software' }), desc: t('export_music_xml_desc', { defaultValue: 'Romani sopra + cifre reali sotto. Formato universale (MuseScore, Finale, Sibelius, Dorico…).' }), group: 'main' },
        { v: 'spoken', title: t('export_music_spoken_title', { defaultValue: 'Parlata (non vedenti)' }), fmt: t('export_music_mscx_fmt', { defaultValue: '.mscx · solo MuseScore' }), desc: t('export_music_spoken_desc', { defaultValue: 'Analisi scritta in italiano nel basso figurato, letta da VoiceOver. Niente da installare.' }), group: 'a11y' },
        { v: 'token', title: t('export_music_token_title', { defaultValue: 'Token (per dizionario VoiceOver)' }), fmt: t('export_music_mscx_fmt', { defaultValue: '.mscx · solo MuseScore' }), desc: t('export_music_token_desc', { defaultValue: 'Sigle compatte nel basso figurato; richiede un dizionario di pronuncia VoiceOver.' }), group: 'a11y' },
    ];

    const SUB: Array<{ v: 'functional' | 'absolute'; title: string }> = [
        { v: 'functional', title: t('export_music_sub_functional', { defaultValue: 'Funzionale — grado (V7, IV43)' }) },
        { v: 'absolute', title: t('export_music_sub_absolute', { defaultValue: 'Assoluto — sigla (Bb7, F#65)' }) },
    ];

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

    // CHE COSA STA PER USCIRE, detto a parole prima di salvare.
    //
    // Righi e strati d'analisi si scelgono altrove — sulla barra, o dal menù «Vista»
    // per chi non usa il mouse — e la pagina lo mostra. Ma chi non vede la pagina
    // arrivava qui senza sapere in che stato fosse: premeva Esporta e lo scopriva
    // riaprendo il file. Questa riga è l'ultimo controllo prima di scrivere, ed è
    // legata al pulsante con aria-describedby: il fuoco parte da lì, quindi si sente
    // insieme al pulsante senza doverla cercare.
    const elenco = (voci: string[]) => voci.join(', ');
    const righiDetti = righiInclusi.length
        ? t('export_music_summary_staves', { defaultValue: 'Righi: {{elenco}}.', elenco: elenco(righiInclusi) })
        : '';
    const analisiDetta = resolved === 'midi'
        ? t('export_music_summary_midi', { defaultValue: 'Il MIDI porta le note, non l\'analisi.' })
        : (analisiInclusa.length
            ? t('export_music_summary_analysis', { defaultValue: 'Analisi: {{elenco}}.', elenco: elenco(analisiInclusa) })
            : t('export_music_summary_no_analysis', { defaultValue: 'Nessuna analisi: sono spente tutte e tre.' }));
    const riepilogo = [righiDetti, analisiDetta].filter(Boolean).join(' ');

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
                <div className="mb-3 text-base font-semibold">{t('export_music_title', { defaultValue: 'Esporta musica' })}</div>

                <div className="space-y-2">
                    {MAIN.map((m, i) => (
                        <div key={m.v}>
                            {/* Intestazione di sezione: appare prima del primo item "Per non vedenti". */}
                            {m.group === 'a11y' && MAIN[i - 1]?.group !== 'a11y' && (
                                <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('export_music_a11y_header', { defaultValue: 'Per non vedenti' })}</div>
                            )}
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

                <div
                    id="export-riepilogo"
                    role="status"
                    className="mt-4 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-300"
                >
                    <span className="font-semibold text-slate-200">{t('export_music_summary_label', { defaultValue: 'Verrà esportato' })}</span>
                    {' — '}{riepilogo}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <button type="button" className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700" onClick={onClose}>{t('export_music_cancel', { defaultValue: 'Annulla' })}</button>
                    <button ref={confirmRef} type="button" aria-describedby="export-riepilogo" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500" onClick={confirm}>{t('export_music_confirm', { defaultValue: 'Esporta' })}</button>
                </div>
            </div>
        </div>
    );
}
