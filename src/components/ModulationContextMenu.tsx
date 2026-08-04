import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimeSignature, HarmonyLabelOverride } from '../types';

const relativeMinors: { [major: string]: string } = {
    'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#', 'F#': 'D#', 'C#': 'A#',
    'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb', 'Cb': 'Ab'
};

const keySignatureOptions = [
  { value: 'C', label: 'C Mag / A min (0 ♯/♭)' },
  { value: 'G', label: 'G Mag / E min (1 ♯)' },
  { value: 'D', label: 'D Mag / B min (2 ♯)' },
  { value: 'A', label: 'A Mag / F♯ min (3 ♯)' },
  { value: 'E', label: 'E Mag / C♯ min (4 ♯)' },
  { value: 'B', label: 'B Mag / G♯ min (5 ♯)' },
  { value: 'F#', label: 'F♯ Mag / D♯ min (6 ♯)' },
  { value: 'C#', label: 'C♯ Mag / A♯ min (7 ♯)' },
  { value: 'F', label: 'F Mag / D min (1 ♭)' },
  { value: 'Bb', label: 'B♭ Mag / G min (2 ♭)' },
  { value: 'Eb', label: 'E♭ Mag / C min (3 ♭)' },
  { value: 'Ab', label: 'A♭ Mag / F min (4 ♭)' },
  { value: 'Db', label: 'D♭ Mag / B♭ min (5 ♭)' },
  { value: 'Gb', label: 'G♭ Mag / E♭ min (6 ♭)' },
  { value: 'Cb', label: 'C♭ Mag / A♭ min (7 ♭)' },
];

const sharpKeyValues = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const flatKeyValues = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];

const sharpKeyOptions = keySignatureOptions.filter(k => sharpKeyValues.includes(k.value));
const flatKeyOptions = keySignatureOptions.filter(k => flatKeyValues.includes(k.value));

const ModulationContextMenu: React.FC<{
    menuData: { x: number; y: number; absBeat: number; measureIndex: number; beat: number };
    onClose: () => void;
    onApply: (absBeat: number, newTonic: string, newIsMinor: boolean, label?: string) => void;
    onApplyTextMarker: (absBeat: number, label?: string) => void;
    onRemove: (absBeat: number) => void;
    existingHarmonyOverride: HarmonyLabelOverride | null;
    onApplyHarmonyOverride: (absBeat: number, roman: string, figures: string[], symbol: string) => void;
    onRemoveHarmonyOverride: (absBeat: number) => void;
    existingTonicizationHint?: { tonic: string; isMinor: boolean } | null;
    onRemoveTonicizationHint?: (absBeat: number) => void;
    inferredTonicAtBeat?: { tonic: string; isMinor: boolean } | null;
    hasSuppressedInference?: boolean;
    onSuppressInference?: (absBeat: number) => void;
    onUnsuppressInference?: (absBeat: number) => void;
    initialKey: string;
    initialIsMinor: boolean;
    initialLabel?: string;
    initialTimeSignature: TimeSignature;
    selectedNoteCount?: number;
    onApplyOrnamentOverride?: (type: string) => void;
    onRemoveOrnamentOverride?: () => void;
    hasExistingOrnamentOverride?: boolean;
    onMoveToTreble?: () => void;
    onMoveToBass?: () => void;
    onResetStaff?: () => void;
}> = ({ menuData, onClose, onApply, onApplyTextMarker, onRemove, existingHarmonyOverride, onApplyHarmonyOverride, onRemoveHarmonyOverride, initialKey, initialIsMinor, initialLabel, initialTimeSignature, selectedNoteCount, onApplyOrnamentOverride, onRemoveOrnamentOverride, hasExistingOrnamentOverride, onMoveToTreble, onMoveToBass, onResetStaff, existingTonicizationHint, onRemoveTonicizationHint, inferredTonicAtBeat, hasSuppressedInference, onSuppressInference, onUnsuppressInference }) => {
    const { t } = useTranslation('ui');
    const [tempKey, setTempKey] = useState(initialKey);
    const [tempIsMinor, setTempIsMinor] = useState(initialIsMinor);
    const [tempLabel, setTempLabel] = useState(initialLabel || '');
    const menuRef = useRef<HTMLDivElement>(null);

    const [floatingPos, setFloatingPos] = useState<{ top: number; left: number }>({ top: menuData.y, left: menuData.x });
    const menuSizeRef = useRef<{ w: number; h: number }>({ w: 360, h: 420 });
    const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; baseTop: number; baseLeft: number }>({ dragging: false, startX: 0, startY: 0, baseTop: 0, baseLeft: 0 });

    const clampPos = useCallback((top0: number, left0: number) => {
        try {
            const pad = 12;
            const vw = window.innerWidth || 0;
            const vh = window.innerHeight || 0;
            const w = menuSizeRef.current.w || 0;
            const h = menuSizeRef.current.h || 0;

            let top = Number(top0);
            let left = Number(left0);
            if (!Number.isFinite(top)) top = pad;
            if (!Number.isFinite(left)) left = pad;

            if (left + w > vw - pad) left = Math.max(pad, vw - pad - w);
            if (top + h > vh - pad) top = Math.max(pad, vh - pad - h);
            if (left < pad) left = pad;
            if (top < pad) top = pad;
            return { top, left };
        } catch {
            return { top: top0, left: left0 };
        }
    }, []);

    const [roman, setRoman] = useState<string>(existingHarmonyOverride?.roman || '');
    const [symbol, setSymbol] = useState<string>(existingHarmonyOverride?.symbol || '');
    const [figuresRaw, setFiguresRaw] = useState<string>(() => {
        try {
            const figs = (existingHarmonyOverride?.figures || []).map(f => String(f));
            return figs.join('/');
        } catch {
            return '';
        }
    });

    useEffect(() => {
        setTempLabel(initialLabel || '');
    }, [initialLabel, initialTimeSignature.denominator, initialTimeSignature.numerator, menuData.absBeat]);

    useLayoutEffect(() => {
        try {
            const el = menuRef.current;
            if (!el) return;

            // Clamp inside viewport so the menu is always reachable.
            const pad = 12;
            window.requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect();
                if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
                    menuSizeRef.current = { w: rect.width, h: rect.height };
                }
                const vw = window.innerWidth || 0;
                const vh = window.innerHeight || 0;

                let top = Number(menuData.y);
                let left = Number(menuData.x);
                if (!Number.isFinite(top)) top = pad;
                if (!Number.isFinite(left)) left = pad;

                if (left + rect.width > vw - pad) left = Math.max(pad, vw - pad - rect.width);
                if (top + rect.height > vh - pad) top = Math.max(pad, vh - pad - rect.height);
                if (left < pad) left = pad;
                if (top < pad) top = pad;

                setFloatingPos(clampPos(top, left));
            });
        } catch {
            // ignore
        }
    }, [clampPos, menuData.x, menuData.y, menuData.absBeat]);

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            try {
                if (!dragRef.current.dragging) return;
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                setFloatingPos(clampPos(dragRef.current.baseTop + dy, dragRef.current.baseLeft + dx));
            } catch {
                // ignore
            }
        };
        const handleUp = () => {
            dragRef.current.dragging = false;
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [clampPos]);

    const beginDrag = (e: React.MouseEvent) => {
        try {
            if ((e as any).button != null && (e as any).button !== 0) return;
            dragRef.current.dragging = true;
            dragRef.current.startX = e.clientX;
            dragRef.current.startY = e.clientY;
            dragRef.current.baseTop = floatingPos.top;
            dragRef.current.baseLeft = floatingPos.left;
            e.preventDefault();
            e.stopPropagation();
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        setRoman(existingHarmonyOverride?.roman || '');
        setSymbol(existingHarmonyOverride?.symbol || '');
        try {
            const figs = (existingHarmonyOverride?.figures || []).map(f => String(f));
            setFiguresRaw(figs.join('/'));
        } catch {
            setFiguresRaw('');
        }
    }, [existingHarmonyOverride, menuData.absBeat]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    const handleApplyClick = () => {
        const tonicToApply = tempIsMinor ? (relativeMinors[tempKey] || tempKey) : tempKey;
        onApply(menuData.absBeat, tonicToApply, tempIsMinor, tempLabel);
    };

    const handleInsertTextOnly = () => {
        onApplyTextMarker(menuData.absBeat, tempLabel);
    };

    const parseFigures = (raw: string): string[] => {
        const s = String(raw || '').trim();
        if (!s) return [];
        return s
            .split(/[\/\s,]+/g)
            .map(x => x.trim())
            .filter(Boolean);
    };

    const handleApplyHarmonyOverride = () => {
        onApplyHarmonyOverride(menuData.absBeat, roman, parseFigures(figuresRaw), symbol);
    };

    return (
        <div
            ref={menuRef}
            style={{ top: floatingPos.top, left: floatingPos.left }}
            className="fixed z-50 bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-600 flex flex-col gap-3 w-[360px] max-w-[90vw] max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
        >
            <div className="flex items-center justify-between gap-2">
                <h3
                    className="text-white font-bold text-sm cursor-move select-none"
                    title={t('menu_drag_to_move')}
                    onMouseDown={beginDrag}
                >
                    {t('menu_panel_title', { defaultValue: 'Proprietà' })} — {t('menu_measure_label')} {menuData.measureIndex + 1}, beat {Number.isInteger(menuData.beat) ? menuData.beat : menuData.beat.toFixed(3)}
                </h3>
                <button
                    onClick={onClose}
                    className="px-2 py-0.5 text-[11px] rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors flex-shrink-0"
                    title={t('menu_close')}
                >
                    ✕
                </button>
            </div>
            <div className="text-[10px] font-semibold mb-1 text-gray-300 uppercase tracking-wide">
                {t('menu_modulation_title', { defaultValue: 'Modulazione / tonicizzazione' })}
            </div>
            <div className="flex items-center gap-2">
                 <select value={tempKey} onChange={e => setTempKey(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs w-full">
                    <optgroup label={t('menu_key_sharps_group')}>{sharpKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                    <optgroup label={t('menu_key_flats_group')}>{flatKeyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label.split('(')[0]}</option>)}</optgroup>
                </select>
                <div className="relative flex p-0.5 bg-gray-900/50 rounded-md flex-shrink-0">
                    <div className="absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] bg-stone-200 rounded-sm transition-transform" style={{ transform: `translateX(${tempIsMinor ? '100%' : '0%'}) ` }}></div>
                    <button onClick={() => setTempIsMinor(false)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${!tempIsMinor ? 'text-gray-900' : 'text-gray-300'}`}>{t('menu_major_abbr')}</button>
                    <button onClick={() => setTempIsMinor(true)} className={`relative w-12 rounded-sm py-0.5 text-xs font-bold transition-colors ${tempIsMinor ? 'text-gray-900' : 'text-gray-300'}`}>{t('menu_minor_abbr')}</button>
                </div>
            </div>
            <div className="flex gap-2">
                <button onClick={handleApplyClick} className="px-2 py-1 text-[11px] rounded-md bg-cyan-600 hover:bg-cyan-500 font-semibold transition-colors">{t('menu_apply_context')}</button>
                <button
                    onClick={handleInsertTextOnly}
                    className="px-2 py-1 text-[11px] rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors"
                    title={t('menu_insert_text_tooltip')}
                    disabled={!String(tempLabel || '').trim()}
                >
                    {t('menu_insert_text_btn')}
                </button>
                <button onClick={() => onRemove(menuData.absBeat)} className="px-2 py-1 text-[11px] rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors">{t('menu_remove')}</button>
            </div>
            {/* Soppressione inferenza — rimuovi senza aggiungere nulla */}
            {inferredTonicAtBeat && !hasSuppressedInference && onSuppressInference && (
                <div className="border-t border-slate-600 pt-2 mt-1">
                    <div className="text-[10px] text-slate-400 mb-1">
                        Modulazione inferita attiva: <span className="text-orange-300 font-semibold">{inferredTonicAtBeat.tonic} {inferredTonicAtBeat.isMinor ? 'min' : 'Maj'}</span>
                    </div>
                    <button
                        onClick={() => { onSuppressInference(menuData.absBeat); onClose(); }}
                        className="px-2 py-1 text-[11px] rounded-md bg-orange-800 hover:bg-orange-700 font-semibold transition-colors"
                        title="Ignora questa inferenza automatica senza aggiungere nessun contesto manuale"
                    >
                        Rimuovi inferenza
                    </button>
                </div>
            )}
            {hasSuppressedInference && onUnsuppressInference && (
                <div className="border-t border-slate-600 pt-2 mt-1">
                    <div className="text-[10px] text-slate-400 mb-1">Inferenza soppressa a questo beat</div>
                    <button
                        onClick={() => { onUnsuppressInference(menuData.absBeat); onClose(); }}
                        className="px-2 py-1 text-[11px] rounded-md bg-slate-600 hover:bg-slate-500 font-semibold transition-colors"
                    >
                        Ripristina inferenza automatica
                    </button>
                </div>
            )}
            {/* Cancella misura, ritornelli e cambio di metro sono passati alla TAVOLOZZA
                DEI SEGNI (pulsante "pf" in toolbar): si trascinano sul punto voluto e si
                tolgono col tasto destro. Qui restano solo le cose che riguardano
                l'ANALISI di questo punto — tonalità, testo, override — per non tenere
                due strade separate da mantenere allineate. */}
            <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-300">{t('menu_text_label')}</label>
                <input
                    value={tempLabel}
                    onChange={e => setTempLabel(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                    placeholder={t('menu_text_label')}
                />
            </div>

            <div className="h-px bg-slate-600/60" />

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-300">{t('menu_harmony_override_label')}</label>
                    <span className="text-[10px] text-gray-400">{t('menu_harmony_override_hint')}</span>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300">{t('menu_roman_label')}</label>
                    <input
                        value={roman}
                        onChange={e => setRoman(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                        placeholder="es. I, V/vi, Ger+"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300">{t('menu_figures_label')}</label>
                    <input
                        value={figuresRaw}
                        onChange={e => setFiguresRaw(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                        placeholder="es. 6/5"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300">{t('menu_chord_symbol_label')}</label>
                    <input
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white"
                        placeholder="es. D7/F#"
                    />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleApplyHarmonyOverride}
                        className="px-2 py-1 text-[11px] rounded-md bg-cyan-700 hover:bg-cyan-600 font-semibold transition-colors"
                        title={t('menu_apply_harmony_override_tooltip')}
                    >
                        {t('menu_apply_harmony_override_btn')}
                    </button>
                    <button
                        onClick={() => onRemoveHarmonyOverride(menuData.absBeat)}
                        className="px-2 py-1 text-[11px] rounded-md bg-red-700 hover:bg-red-600 font-semibold transition-colors"
                        title={t('menu_remove_harmony_override_tooltip')}
                    >
                        {t('menu_remove_harmony_override_btn')}
                    </button>
                </div>
            </div>

            {/* ── Tonicization hint removal ── */}
            {existingTonicizationHint && onRemoveTonicizationHint && (
                <div className="border-t border-slate-600 pt-2 mt-1">
                    <div className="text-[10px] text-slate-400 mb-1">Tonicizzazione locale attiva: <span className="text-blue-300 font-semibold">{existingTonicizationHint.tonic} {existingTonicizationHint.isMinor ? 'min' : 'Maj'}</span></div>
                    <button
                        onClick={() => { onRemoveTonicizationHint(menuData.absBeat); }}
                        className="px-2 py-1 text-[11px] rounded-md bg-orange-700 hover:bg-orange-600 font-semibold transition-colors"
                    >
                        Rimuovi tonicizzazione
                    </button>
                </div>
            )}

            {/* ── Ornament override section ── */}
            {selectedNoteCount != null && selectedNoteCount > 0 && onApplyOrnamentOverride && (
                <div className="border-t border-gray-600 pt-2 mt-2">
                    <div className="text-[10px] font-semibold mb-1 text-gray-300 uppercase tracking-wide">{t('menu_ornament_title')}</div>
                    {([
                        { labelKey: 'menu_ornament_passing', shortcut: '⌥P', type: 'passing' },
                        { labelKey: 'menu_ornament_neighbor', shortcut: '⌥V', type: 'neighbor' },
                        { labelKey: 'menu_ornament_appoggiatura', shortcut: '⌥A', type: 'appoggiatura' },
                        { labelKey: 'menu_ornament_anticipation', shortcut: '⌥N', type: 'anticipation' },
                        { labelKey: 'menu_ornament_escape', shortcut: '⌥S', type: 'escape' },
                          { labelKey: 'menu_ornament_cambiata', shortcut: '⌥C', type: 'cambiata' },
                        { labelKey: 'menu_ornament_suspension', shortcut: '⌥R', type: 'suspension' },
                    ] as const).map(item => (
                        <button key={item.type} onClick={() => onApplyOrnamentOverride(item.type)}
                            className="block w-full text-left px-2 py-0.5 text-[11px] hover:bg-gray-600 rounded transition-colors">
                            {t(item.labelKey)}  {item.shortcut}
                        </button>
                    ))}
                    {hasExistingOrnamentOverride && onRemoveOrnamentOverride && (
                        <button onClick={onRemoveOrnamentOverride}
                            className="block w-full text-left px-2 py-0.5 text-[11px] text-red-400 hover:bg-gray-600 rounded mt-1 transition-colors">
                            {t('menu_ornament_remove')}
                        </button>
                    )}
                </div>
            )}

            {/* ── Staff override section ── */}
            {(onMoveToTreble || onMoveToBass) && (
                <div className="border-t border-gray-600 pt-2 mt-2">
                    <div className="text-[10px] font-semibold mb-1 text-gray-300 uppercase tracking-wide">{t('menu_staff_move_title')}</div>
                    {onMoveToTreble && (
                        <button onClick={onMoveToTreble}
                            className="block w-full text-left px-2 py-0.5 text-[11px] hover:bg-gray-600 rounded transition-colors">
                            {t('menu_staff_treble')}  <span className="text-gray-400 ml-1">⎿↑</span>
                        </button>
                    )}
                    {onMoveToBass && (
                        <button onClick={onMoveToBass}
                            className="block w-full text-left px-2 py-0.5 text-[11px] hover:bg-gray-600 rounded transition-colors">
                            {t('menu_staff_bass')}  <span className="text-gray-400 ml-1">⎿↓</span>
                        </button>
                    )}
                    {onResetStaff && (
                        <button onClick={onResetStaff}
                            className="block w-full text-left px-2 py-0.5 text-[11px] text-yellow-400 hover:bg-gray-600 rounded mt-1 transition-colors">
                            {t('menu_staff_reset')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default ModulationContextMenu;
