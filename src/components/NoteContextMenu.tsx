import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * IL MENÙ DEL TASTO DESTRO SULLA NOTA.
 *
 * Il tasto destro, in questa applicazione, ha sempre voluto dire «togli»: un segno,
 * una legatura, una dinamica. Sulla nota però toglieva solo le articolazioni, e su una
 * nota che non ne ha sembrava non fare niente — un gesto che a volte agisce e a volte
 * tace è il più difficile da imparare.
 *
 * Ora sulla nota apre un menù, e «togli le articolazioni» è una delle sue voci. Costa
 * un clic in più, ma il tasto destro che apre un menù è quello che chiunque si aspetta.
 *
 * Il motivo vero per cui esiste sono gli ORNAMENTI. Nota di passaggio, appoggiatura,
 * ritardo: in un programma d'analisi armonica sono fra le operazioni più frequenti, e
 * finora vivevano SOLO come scorciatoie elencate dentro un modale — invisibili a
 * chiunque non le conoscesse già. Qui hanno una casa che si vede, e la scorciatoia
 * scritta accanto la insegna a chi userà l'applicazione a lungo.
 */

export type NoteMenuData = {
    x: number; y: number; noteId: string; conArticolazioni: boolean;
    /** Battuta della nota: serve alle voci che agiscono sulla BATTUTA e non sulla nota,
     *  come l'a capo di sistema. Chi vuole spezzare la riga clicca lì dove sta guardando. */
    measureIndex?: number;
    /** Se quella battuta ha già un a capo: la voce dice «togli» invece di «vai a capo». */
    conACapo?: boolean;
};

/** [tipo, chiave di traduzione, testo italiano di ripiego, scorciatoia].
 *  Il nome si traduce: questo menù si vede anche in inglese, e i termini dell'analisi
 *  hanno un nome proprio nelle due lingue (nota di volta = neighbor tone). */
const ORNAMENTI: Array<[string, string, string, string]> = [
    ['passing',      'note_menu_nct_passing',      'Nota di passaggio',  '⌥P'],
    ['neighbor',     'note_menu_nct_neighbor',     'Nota di volta',      '⌥V'],
    ['appoggiatura', 'note_menu_nct_appoggiatura', 'Appoggiatura',       '⌥A'],
    ['suspension',   'note_menu_nct_suspension',   'Ritardo',            '⌥R'],
    ['escape',       'note_menu_nct_escape',       'Nota di sfuggita',   '⌥S'],
    ['cambiata',     'note_menu_nct_cambiata',     'Cambiata',           '⌥C'],
    ['anticipation', 'note_menu_nct_anticipation', 'Anticipazione',      '⌥N'],
];

const NoteContextMenu: React.FC<{
    data: NoteMenuData;
    onClose: () => void;
    onOrnamento: (tipo: string) => void;
    onTogliOrnamento: () => void;
    onCorona: () => void;
    onTogliArticolazioni: () => void;
    onSpostaSu: () => void;
    onSpostaGiu: () => void;
    onRigoPredefinito: () => void;
    onACapo?: () => void;
}> = ({
    data, onClose, onOrnamento, onTogliOrnamento, onCorona,
    onTogliArticolazioni, onSpostaSu, onSpostaGiu, onRigoPredefinito, onACapo,
}) => {
    const { t } = useTranslation('ui');
    const ref = useRef<HTMLDivElement | null>(null);

    /** DOVE STA IL MENÙ: si misura, non si indovina.
     *
     *  Prima si rientrava dai bordi con l'altezza scritta a mano (340 px). Basta
     *  aggiungere una voce perché quel numero non sia più vero, ed è successo: col tasto
     *  destro su una nota in fondo al pentagramma il menù finiva tagliato di sotto. Qui si
     *  misura il menù DOPO averlo composto e prima di dipingerlo, e se non ci sta lo si
     *  tira dentro. Se non ci sta nemmeno in altezza, scorre. */
    const [posizione, setPosizione] = useState<{ left: number; top: number }>({ left: data.x, top: data.y });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const MARGINE = 8;
        const r = el.getBoundingClientRect();
        let left = data.x;
        let top = data.y;
        if (left + r.width > window.innerWidth - MARGINE) left = window.innerWidth - r.width - MARGINE;
        if (top + r.height > window.innerHeight - MARGINE) top = window.innerHeight - r.height - MARGINE;
        setPosizione({ left: Math.max(MARGINE, left), top: Math.max(MARGINE, top) });
    }, [data.x, data.y, data.conArticolazioni, data.measureIndex, data.conACapo]);

    // Si chiude cliccando fuori o con Esc: un menù contestuale che resta aperto diventa
    // un pannello, e copre la musica su cui si stava lavorando.
    useEffect(() => {
        const fuori = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const tasto = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('mousedown', fuori);
        window.addEventListener('keydown', tasto);
        return () => { window.removeEventListener('mousedown', fuori); window.removeEventListener('keydown', tasto); };
    }, [onClose]);

    const voce = 'w-full text-left px-2 py-1 text-[12px] text-slate-100 hover:bg-sky-700/60 rounded flex items-center justify-between gap-3';
    const tasto = 'text-[10px] text-slate-400 font-mono';

    return (
        <div
            ref={ref}
            // In coordinate di finestra; il rientro dai bordi lo calcola l'effetto qui
            // sopra, sulla misura vera del menù.
            style={{
                position: 'fixed',
                left: posizione.left,
                top: posizione.top,
                width: 224,
                zIndex: 10060,
                // Su finestre basse il menù è più alto dello schermo: meglio scorrerlo che
                // avere delle voci irraggiungibili.
                maxHeight: 'calc(100vh - 16px)',
                overflowY: 'auto',
            }}
            className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-1 select-none"
        >
            <div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">{t('note_menu_nct_title', { defaultValue: 'Ornamento' })}</div>
            {ORNAMENTI.map(([tipo, chiave, nome, scorciatoia]) => (
                <button key={tipo} className={voce} onClick={() => { onOrnamento(tipo); onClose(); }}>
                    <span>{t(chiave, { defaultValue: nome })}</span><span className={tasto}>{scorciatoia}</span>
                </button>
            ))}
            <button className={voce} onClick={() => { onOrnamento('structural'); onClose(); }}>
                <span>{t('note_menu_force_structural', { defaultValue: 'Forza strutturale' })}</span><span className={tasto}>⌥H</span>
            </button>
            <button className={voce} onClick={() => { onTogliOrnamento(); onClose(); }}>
                <span className="text-slate-300">{t('note_menu_clear_nct', { defaultValue: "Togli l'ornamento" })}</span>
            </button>

            <div className="h-px bg-slate-600/60 my-1" />

            <button className={voce} onClick={() => { onCorona(); onClose(); }}>
                <span>{t('note_menu_fermata', { defaultValue: 'Corona' })}</span><span className={tasto}>⌥F</span>
            </button>
            {/* Solo se c'è qualcosa da togliere: una voce che non farebbe niente è
                peggio di una voce assente — promette e non mantiene. */}
            {data.conArticolazioni && (
                <button className={voce} onClick={() => { onTogliArticolazioni(); onClose(); }}>
                    <span>{t('note_menu_clear_artic', { defaultValue: 'Togli le articolazioni' })}</span>
                </button>
            )}

            <div className="h-px bg-slate-600/60 my-1" />

            <div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">{t('note_menu_move_staff', { defaultValue: 'Sposta di rigo' })}</div>
            <button className={voce} onClick={() => { onSpostaSu(); onClose(); }}>
                <span>{t('note_menu_staff_upper', { defaultValue: 'Al rigo superiore' })}</span><span className={tasto}>⌥↑</span>
            </button>
            <button className={voce} onClick={() => { onSpostaGiu(); onClose(); }}>
                <span>{t('note_menu_staff_lower', { defaultValue: 'Al rigo inferiore' })}</span><span className={tasto}>⌥↓</span>
            </button>
            <button className={voce} onClick={() => { onRigoPredefinito(); onClose(); }}>
                <span className="text-slate-300">{t('note_menu_staff_default', { defaultValue: 'Rigo della sua voce' })}</span>
            </button>

            {/* IMPAGINAZIONE. Agisce sulla battuta, non sulla nota, ma è qui che si va a
                cercarla: si guarda la musica e si decide che la riga finisce lì. */}
            {onACapo && typeof data.measureIndex === 'number' && (
                <>
                    <div className="h-px bg-slate-600/60 my-1" />
                    <button className={voce} onClick={() => { onACapo(); onClose(); }}>
                        <span>{data.conACapo
                            ? t('note_menu_break_remove', { defaultValue: "Togli l'a capo" })
                            : t('note_menu_break_add', { defaultValue: 'Vai a capo dopo questa battuta' })}</span>
                        <span className={tasto}>⌥⏎</span>
                    </button>
                </>
            )}
        </div>
    );
};

export default NoteContextMenu;
