import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Cornice flottante premium e trascinabile per i moduli FX (compressore, EQ, …), stile
 * plug-in moderno: fondo a gradiente scuro, bordo con leggero glow d'accento, header curato
 * con titolo + chip del bersaglio (la traccia) + slot extra (es. bypass) + chiusura.
 * Riusabile da ogni effetto così il linguaggio visivo è coerente.
 */
export interface FxWindowProps {
  title: string;
  /** Bersaglio dell'effetto (nome traccia / "Master"). Mostrato come chip. */
  target?: string;
  accent?: string;
  width?: number;
  initial?: { x: number; y: number };
  headerExtra?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

const FxWindow: React.FC<FxWindowProps> = ({
  title, target, accent = '#22d3ee', width = 300, initial, headerExtra, onClose, children,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(initial ?? { x: 240, y: 130 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // non trascinare dai pulsanti dell'header
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
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 1001, width,
        background: 'linear-gradient(180deg,#1c2536 0%,#0e1525 100%)',
        border: `1px solid ${accent}40`,
        borderRadius: 12,
        boxShadow: `0 18px 50px -12px rgba(0,0,0,0.75), 0 0 0 1px rgba(0,0,0,0.4), 0 0 24px -8px ${accent}55`,
      }}
      className="select-none"
    >
      {/* Header */}
      <div
        onMouseDown={onTitleMouseDown}
        className="flex items-center gap-2 px-3 py-2 cursor-move rounded-t-xl"
        style={{ background: 'linear-gradient(180deg,#222d42 0%,#161f31 100%)', borderBottom: '1px solid #0b1220' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 99, background: accent, boxShadow: `0 0 6px ${accent}` }} />
        <span className="text-[12.5px] font-medium tracking-wide text-gray-100">{title}</span>
        {target && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: accent, background: `${accent}1f`, border: `1px solid ${accent}40` }}>
            {target}
          </span>
        )}
        <div className="flex-1" />
        {headerExtra}
        <button
          onClick={onClose}
          title="Chiudi"
          className="w-5 h-5 text-gray-500 hover:text-gray-100 flex items-center justify-center text-xs rounded hover:bg-white/5 transition-colors"
        >
          ✕
        </button>
      </div>
      {/* Body */}
      <div className="p-3.5">{children}</div>
    </div>
  );
};

export default FxWindow;
