import React, { useEffect, useRef } from 'react';

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

export type NoteMenuData = { x: number; y: number; noteId: string; conArticolazioni: boolean };

const ORNAMENTI: Array<[string, string, string]> = [
    ['passing',      'Nota di passaggio',  '⌥P'],
    ['neighbor',     'Nota di volta',      '⌥V'],
    ['appoggiatura', 'Appoggiatura',       '⌥A'],
    ['suspension',   'Ritardo',            '⌥R'],
    ['escape',       'Nota di sfuggita',   '⌥S'],
    ['cambiata',     'Cambiata',           '⌥C'],
    ['anticipation', 'Anticipazione',      '⌥N'],
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
}> = ({
    data, onClose, onOrnamento, onTogliOrnamento, onCorona,
    onTogliArticolazioni, onSpostaSu, onSpostaGiu, onRigoPredefinito,
}) => {
    const ref = useRef<HTMLDivElement | null>(null);

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
            // In coordinate di finestra, e rientrato dai bordi: un menù che esce dallo
            // schermo è un menù con delle voci irraggiungibili.
            style={{
                position: 'fixed',
                left: Math.min(data.x, window.innerWidth - 236),
                top: Math.min(data.y, window.innerHeight - 340),
                width: 224,
                zIndex: 10060,
            }}
            className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-1 select-none"
        >
            <div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Ornamento</div>
            {ORNAMENTI.map(([tipo, nome, scorciatoia]) => (
                <button key={tipo} className={voce} onClick={() => { onOrnamento(tipo); onClose(); }}>
                    <span>{nome}</span><span className={tasto}>{scorciatoia}</span>
                </button>
            ))}
            <button className={voce} onClick={() => { onOrnamento('structural'); onClose(); }}>
                <span>Forza strutturale</span><span className={tasto}>⌥H</span>
            </button>
            <button className={voce} onClick={() => { onTogliOrnamento(); onClose(); }}>
                <span className="text-slate-300">Togli l'ornamento</span>
            </button>

            <div className="h-px bg-slate-600/60 my-1" />

            <button className={voce} onClick={() => { onCorona(); onClose(); }}>
                <span>Corona</span><span className={tasto}>⌥F</span>
            </button>
            {/* Solo se c'è qualcosa da togliere: una voce che non farebbe niente è
                peggio di una voce assente — promette e non mantiene. */}
            {data.conArticolazioni && (
                <button className={voce} onClick={() => { onTogliArticolazioni(); onClose(); }}>
                    <span>Togli le articolazioni</span>
                </button>
            )}

            <div className="h-px bg-slate-600/60 my-1" />

            <div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Sposta di rigo</div>
            <button className={voce} onClick={() => { onSpostaSu(); onClose(); }}>
                <span>Al rigo superiore</span><span className={tasto}>⌥↑</span>
            </button>
            <button className={voce} onClick={() => { onSpostaGiu(); onClose(); }}>
                <span>Al rigo inferiore</span><span className={tasto}>⌥↓</span>
            </button>
            <button className={voce} onClick={() => { onRigoPredefinito(); onClose(); }}>
                <span className="text-slate-300">Rigo della sua voce</span>
            </button>
        </div>
    );
};

export default NoteContextMenu;
