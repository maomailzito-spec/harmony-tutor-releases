import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Floating, draggable percussion module (replaces the old inline "🥁 Mappa" bar).
 *
 * Rectangular panel that opens/closes on demand from the toolbar. Contains the
 * kit selector (orchestral/rock) and the per-piece insert buttons (clic = pezzo
 * al cursore). Chrome matches the unified Mixer (slate theme) with amber accents
 * for the drum identity. Drag pattern mirrors MixerPanel.
 */
export interface DrumPalettePiece {
  midi: number;
  label: string;
}

interface DrumPalettePanelProps {
  trackName: string;
  kit: 'orchestral' | 'rock';
  onSetKit: (k: 'orchestral' | 'rock') => void;
  /** Pieces in palette order (the buttons already carry the instrument name). */
  pieces: DrumPalettePiece[];
  onInsertPiece: (midi: number) => void;
  onClose: () => void;
}

const DrumPalettePanel: React.FC<DrumPalettePanelProps> = ({
  trackName, kit, onSetKit, pieces, onInsertPiece, onClose,
}) => {
    const { t } = useTranslation('ui');
  // --- Floating window position + drag (same pattern as MixerPanel) ---
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 160, y: 96 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dragRef.current.dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragRef.current.dy));
      setPos({ x, y });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000, width: 248 }}
      className="bg-slate-800 rounded-lg shadow-2xl border border-slate-700 select-none"
    >
      {/* Title bar (drag handle) */}
      <div
        onMouseDown={onTitleMouseDown}
        className="flex items-center justify-between px-2 py-1 bg-slate-900 rounded-t-lg cursor-move"
      >
        <span className="text-[11px] font-bold text-gray-300 tracking-wide truncate">
          🥁 Percussioni — {trackName}
        </span>
        <button
          onClick={onClose}
          title={t('drums_close')}
          className="w-5 h-5 text-gray-500 hover:text-gray-200 flex items-center justify-center text-xs rounded transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="p-2">
        {/* Kit selector */}
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mr-1">Kit</span>
          <div className="inline-flex rounded overflow-hidden border border-slate-600">
            <button onClick={() => onSetKit('orchestral')} title="Kit orchestrale (VSCO2)"
              className={`h-6 px-2 text-[10px] font-semibold transition-colors ${kit === 'orchestral' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-gray-300 hover:bg-slate-600'}`}>Orchestra</button>
            <button onClick={() => onSetKit('rock')} title="Kit rock (Salamander)"
              className={`h-6 px-2 text-[10px] font-semibold border-l border-slate-600 transition-colors ${kit === 'rock' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-gray-300 hover:bg-slate-600'}`}>Rock</button>
          </div>
        </div>

        {/* Insert buttons — uniform 2-column grid (every cell same size) */}
        <div className="grid grid-cols-2 gap-1">
          {pieces.map(p => (
            <button
              key={p.midi}
              onClick={() => onInsertPiece(p.midi)}
              title={`Inserisci "${p.label}" (MIDI ${p.midi}) al cursore`}
              className="h-7 px-2 text-[10px] font-semibold rounded bg-slate-700 text-gray-200 border border-slate-600 hover:bg-slate-600 active:bg-amber-600 active:text-white transition-colors truncate"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="text-[9px] text-gray-400 mt-2 leading-snug">
          clic = pezzo al cursore (avanza) · frecce ←→ · ripassa un beat = sovrapposti · oppure clic diretto sul rigo
        </div>
      </div>
    </div>
  );
};

export default DrumPalettePanel;
