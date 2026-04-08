import React, { useState, useEffect, useRef } from 'react';
import type { HarmonyLabelOverride } from '../types';


const HarmonyOverrideContextMenu: React.FC<{
    menuData: { x: number; y: number; absBeat: number; measureIndex: number; beat: number };
    existing: HarmonyLabelOverride | null;
    onClose: () => void;
    onApply: (absBeat: number, roman: string, figures: string[], symbol: string) => void;
    onRemove: (absBeat: number) => void;
}> = ({ menuData, existing, onClose, onApply, onRemove }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [roman, setRoman] = useState<string>(existing?.roman || '');
    const [symbol, setSymbol] = useState<string>(existing?.symbol || '');
    const [figuresRaw, setFiguresRaw] = useState<string>(() => {
        try {
            const figs = (existing?.figures || []).map(f => String(f));
            return figs.join('/');
        } catch {
            return '';
        }
    });

    useEffect(() => {
        setRoman(existing?.roman || '');
        setSymbol(existing?.symbol || '');
        try {
            const figs = (existing?.figures || []).map(f => String(f));
            setFiguresRaw(figs.join('/'));
        } catch {
            setFiguresRaw('');
        }
    }, [existing]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    const parseFigures = (raw: string): string[] => {
        const s = String(raw || '').trim();
        if (!s) return [];
        return s
            .split(/[\/\s,]+/g)
            .map(x => x.trim())
            .filter(Boolean);
    };

    const handleApply = () => {
        onApply(menuData.absBeat, roman, parseFigures(figuresRaw), symbol);
    };

    return (
        <div
            ref={menuRef}
            style={{ top: menuData.y, left: menuData.x }}
            className="fixed z-50 bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-600 flex flex-col gap-3 w-[320px]"
            onClick={e => e.stopPropagation()}
        >
            <h3 className="text-white font-bold text-sm">
                Override analisi (Misura {menuData.measureIndex + 1}, beat {Number.isInteger(menuData.beat) ? menuData.beat : menuData.beat.toFixed(3)})
            </h3>
            <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-300">Roman</label>
                <input
                    value={roman}
                    onChange={e => setRoman(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder="es. V/vi"
                />
                <label className="text-xs text-gray-300">Figure (separate da / o spazio)</label>
                <input
                    value={figuresRaw}
                    onChange={e => setFiguresRaw(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder="es. 4/5/9"
                />
                <label className="text-xs text-gray-300">Simbolo accordo (opzionale)</label>
                <input
                    value={symbol}
                    onChange={e => setSymbol(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder="es. G7(b9)/F"
                />
                <p className="text-[11px] text-gray-400">Suggerimento: apri questo menu con Option+click destro.</p>
            </div>
            <div className="flex gap-2 mt-2">
                <button onClick={handleApply} className="flex-1 px-3 py-1 text-sm rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors">Applica</button>
                <button onClick={() => onRemove(menuData.absBeat)} className="px-3 py-1 text-sm rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors">Rimuovi</button>
                <button onClick={onClose} className="px-3 py-1 text-sm rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors">Annulla</button>
            </div>
        </div>
    );
};

export default HarmonyOverrideContextMenu;
