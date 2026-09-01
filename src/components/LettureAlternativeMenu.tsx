/**
 * LE LETTURE ALTERNATIVE, sull'etichetta.
 *
 * Quando l'analisi ha trovato più di una lettura possibile per un accordo, sceglierne
 * un'altra è la cosa che si fa più spesso — ed era in fondo a un percorso: clic
 * sull'etichetta, si apre il pannello delle proprietà, e lì dentro si cerca la sezione.
 * Qui le alternative compaiono subito sotto l'etichetta, e il pannello resta a un passo
 * per tutto il resto.
 *
 * Se alternative non ce ne sono, questo menù non si apre affatto: il clic porta al
 * pannello come prima. Non si mostra mai un elenco vuoto per dire che è vuoto.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type LetturaAlternativa = {
    roman: string;
    figures?: string[];
    impliedTonic: string;
    isMinor: boolean;
};

type Props = {
    x: number;
    y: number;
    /** La lettura attualmente mostrata, per marcarla come tale. */
    corrente?: string;
    letture: LetturaAlternativa[];
    onScegli: (alt: LetturaAlternativa) => void;
    onApriPannello: () => void;
    onClose: () => void;
};

const LettureAlternativeMenu: React.FC<Props> = ({ x, y, corrente, letture, onScegli, onApriPannello, onClose }) => {
    const { t } = useTranslation('ui');
    const ref = useRef<HTMLDivElement>(null);

    // CHE RIENTRI NELLO SCHERMO. Ancorato sotto l'etichetta, su un'etichetta in fondo alla
    // pagina o all'ultimo sistema il menù finirebbe fuori: si misura dopo il montaggio e,
    // se sborda, si sposta sopra l'etichetta o rientra da destra.
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: y, left: x });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) { setPos({ top: y, left: x }); return; }
        const r = el.getBoundingClientRect();
        const margine = 8;
        let top = y, left = x;
        if (top + r.height > window.innerHeight - margine) top = Math.max(margine, y - r.height - 22);
        if (left + r.width > window.innerWidth - margine) left = Math.max(margine, window.innerWidth - r.width - margine);
        setPos({ top, left });
    }, [x, y, letture.length]);

    useEffect(() => {
        const fuori = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', fuori);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('mousedown', fuori);
            document.removeEventListener('keydown', esc);
        };
    }, [onClose]);

    const etichetta = (a: LetturaAlternativa) =>
        `${a.roman}${(a.figures || []).length ? ' ' + (a.figures || []).join('/') : ''}`;

    return (
        <div
            ref={ref}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 60 }}
            className="min-w-[130px] rounded-lg border border-slate-500 bg-white shadow-xl py-1 text-slate-900"
            onClick={e => e.stopPropagation()}
        >
            {letture.map((a, i) => {
                const testo = etichetta(a);
                const attuale = corrente != null && testo === corrente;
                return (
                    <button
                        key={`${testo}-${i}`}
                        onClick={() => { onScegli(a); onClose(); }}
                        className={`w-full text-left px-3 py-1.5 text-[15px] leading-tight hover:bg-slate-100 transition-colors ${attuale ? 'font-semibold' : ''}`}
                        title={`${a.impliedTonic} ${a.isMinor ? 'min' : 'Mag'}`}
                    >
                        {testo}
                    </button>
                );
            })}
            <div className="my-1 h-px bg-slate-200" />
            <button
                onClick={() => { onApriPannello(); onClose(); }}
                className="w-full text-left px-3 py-1 text-[11px] text-slate-500 hover:bg-slate-100 transition-colors"
            >
                {t('alt_menu_more', { defaultValue: 'Altre proprietà…' })}
            </button>
        </div>
    );
};

export default LettureAlternativeMenu;
