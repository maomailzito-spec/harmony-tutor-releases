import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimeSignature } from '../types';

export const VALID_DENOMINATORS = [2, 4, 8, 16];

export const denominatorStepFn = (current: number, direction: 'up' | 'down') => {
    const currentIndex = VALID_DENOMINATORS.indexOf(current);
    if (direction === 'up') {
        return VALID_DENOMINATORS[Math.min(VALID_DENOMINATORS.length - 1, currentIndex + 1)];
    }
    return VALID_DENOMINATORS[Math.max(0, currentIndex - 1)];
};

/** `6/8`, `6 8`, `6|8` → { 6, 8 }. null se non è un metro scrivibile. */
export function parseTimeSignature(testo: string): TimeSignature | null {
    const m = String(testo).trim().match(/^(\d{1,2})\s*[/|\s]\s*(\d{1,2})$/);
    if (!m) return null;
    const numerator = Number(m[1]);
    const denominator = Number(m[2]);
    if (!Number.isFinite(numerator) || numerator < 1 || numerator > 16) return null;
    if (!VALID_DENOMINATORS.includes(denominator)) return null;
    return { numerator, denominator };
}

/**
 * UNA DELLE DUE CIFRE DEL METRO.
 *
 * Tre modi di cambiarla, perché tre sono le abitudini diverse: si SCRIVE (chi sa già
 * che vuole 7/8 lo digita e basta), si SCORRE con la rotella stando col mouse sopra,
 * si spinge con le FRECCE ↑↓ da tastiera. Nessuno dei tre è il modo «giusto»: erano
 * frecce da cliccare, ed era il più lento dei tre.
 *
 * La rotella si ascolta con un listener NON passivo aggiunto a mano: React attacca
 * `onWheel` come passivo, quindi da lì `preventDefault()` non funziona e sotto le
 * cifre scorrerebbe la partitura mentre si cambia il metro.
 */
const CifraMetro: React.FC<{
    value: number;
    onChange: (v: number) => void;
    passo: (current: number, direction: 'up' | 'down') => number;
    valida: (v: number) => boolean;
    etichetta: string;
}> = ({ value, onChange, passo, valida, etichetta }) => {
    const { t } = useTranslation('ui');
    const [bozza, setBozza] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const muovi = useCallback((direction: 'up' | 'down') => {
        const nuovo = passo(value, direction);
        if (nuovo !== value) onChange(nuovo);
    }, [value, passo, onChange]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();   // niente scorrimento della partitura sotto il puntatore
            e.stopPropagation();
            if (Math.abs(e.deltaY) < 1) return;
            muovi(e.deltaY < 0 ? 'up' : 'down');
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [muovi]);

    const conferma = () => {
        if (bozza !== null) {
            const n = parseInt(bozza, 10);
            // Un valore che non esiste come cifra di metro non si applica: si torna a
            // quello di prima invece di inventare un 5/5.
            if (Number.isFinite(n) && valida(n)) onChange(n);
            setBozza(null);
        }
    };

    return (
        <input
            ref={ref}
            type="text"
            inputMode="numeric"
            value={bozza ?? String(value)}
            onChange={e => setBozza(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
            onFocus={e => e.currentTarget.select()}
            onBlur={conferma}
            onKeyDown={e => {
                if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setBozza(null); muovi('up'); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setBozza(null); muovi('down'); }
                else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); conferma(); e.currentTarget.blur(); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setBozza(null); e.currentTarget.blur(); }
                else e.stopPropagation();   // le lettere non devono arrivare all'editor
            }}
            title={t('ts_write_tip')}
            aria-label={etichetta}
            className="w-6 bg-transparent text-center outline-none focus:bg-slate-600 rounded-sm"
        />
    );
};

/**
 * IL METRO NELLA BARRA — alto come tutto il resto, e con le due cifre indipendenti.
 *
 * Era un riquadro di 40×56 px con le cifre impilate e quattro frecce: due volte
 * l'altezza di ogni altro comando. Impilarle è giusto SULLA PARTITURA, dove il metro
 * si scrive così; in una barra alta trenta pixel non ci sta senza diventare
 * illeggibile. Le due cifre restano però due cose separate — un 6/8 non si cambia in
 * 3/8 toccando il denominatore — e ognuna si modifica per conto suo.
 */
const TimeSignatureControl: React.FC<{
    value: TimeSignature;
    onChange: (newValue: TimeSignature) => void;
}> = ({ value, onChange }) => {
    const { t } = useTranslation('ui');
    return (
    <div
        className="flex items-center h-[30px] px-1 bg-slate-700 border border-slate-600 rounded-md text-white font-serif text-sm"
        title={t('ts_meter_tip')}
    >
        <CifraMetro
            value={value.numerator}
            onChange={n => onChange({ ...value, numerator: n })}
            passo={(c, d) => Math.max(1, Math.min(16, c + (d === 'up' ? 1 : -1)))}
            valida={n => n >= 1 && n <= 16}
            etichetta={t('ts_numerator')}
        />
        <span className="text-slate-400 select-none">/</span>
        <CifraMetro
            value={value.denominator}
            onChange={n => onChange({ ...value, denominator: n })}
            passo={denominatorStepFn}
            valida={n => VALID_DENOMINATORS.includes(n)}
            etichetta={t('ts_denominator')}
        />
    </div>
    );
};

export default TimeSignatureControl;
