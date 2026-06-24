import React, { useCallback, useRef } from 'react';

/**
 * Manopola rotary in stile plug-in moderno (FabFilter-like): anello di traccia + anello
 * valore con accent, indicatore, e readout. Trascinamento VERTICALE (su = aumenta), rotellina
 * a passo fine, doppio-click = reset al default. Niente slider nativi → look pro e coerente.
 *
 * Solo presentazione: il valore e l'handler arrivano dal parent.
 */
export interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label?: string;
  /** Testo del valore già formattato (es. "-18 dB", "3.0:1"). */
  display?: string;
  accent?: string;
  size?: number;        // diametro px
  disabled?: boolean;
  /** Doppio-click → ripristina questo valore (default = min). */
  defaultValue?: number;
  /** Manopola bipolare: traccia disegnata dal CENTRO al valore (per pan/gain ±). */
  bipolar?: boolean;
  /** Passo della rotellina (in unità del parametro). */
  wheelStep?: number;
}

const ARC_START = 225; // gradi dal top, in senso orario (7:30)
const ARC_SWEEP = 270; // ampiezza totale (fino a 4:30)

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};
const arcPath = (cx: number, cy: number, r: number, fromDeg: number, toDeg: number) => {
  const s = polar(cx, cy, r, fromDeg);
  const e = polar(cx, cy, r, toDeg);
  const large = ((toDeg - fromDeg + 360) % 360) > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
};

const Knob: React.FC<KnobProps> = ({
  value, min, max, onChange, label, display, accent = '#22d3ee', size = 48, disabled,
  defaultValue, bipolar, wheelStep,
}) => {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const pos = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const valueDeg = ARC_START + pos * ARC_SWEEP;
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 4;
  const ind = polar(cx, cy, r - 2, valueDeg);
  const indInner = polar(cx, cy, r * 0.42, valueDeg);
  // Anello valore: dal min (o dal centro se bipolar) fino al valore.
  const fromDeg = bipolar ? (ARC_START + 0.5 * ARC_SWEEP) : ARC_START;
  const fwd = valueDeg >= fromDeg;

  const setFromClientY = useCallback((clientY: number) => {
    if (!drag.current) return;
    const delta = drag.current.y - clientY;          // su = +
    const span = max - min;
    let v = drag.current.v + (delta / 180) * span;   // 180px = corsa intera
    v = Math.max(min, Math.min(max, v));
    onChange(v);
  }, [max, min, onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    drag.current = { y: e.clientY, v: value };
    const move = (ev: PointerEvent) => setFromClientY(ev.clientY);
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    const step = wheelStep ?? (max - min) / 40;
    onChange(Math.max(min, Math.min(max, value - Math.sign(e.deltaY) * step)));
  };
  const onDoubleClick = () => { if (!disabled) onChange(defaultValue ?? (bipolar ? (min + max) / 2 : min)); };

  return (
    <div className="flex flex-col items-center select-none" style={{ opacity: disabled ? 0.45 : 1, width: size + 8 }}>
      <svg
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        onPointerDown={onPointerDown} onWheel={onWheel} onDoubleClick={onDoubleClick}
        style={{ cursor: disabled ? 'default' : 'ns-resize', touchAction: 'none' }}
      >
        <defs>
          <radialGradient id={`kg-${accent.replace('#', '')}`} cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0f172a" />
          </radialGradient>
        </defs>
        {/* corpo manopola */}
        <circle cx={cx} cy={cy} r={r * 0.74} fill={`url(#kg-${accent.replace('#', '')})`} stroke="#0b1220" strokeWidth="1" />
        {/* traccia */}
        <path d={arcPath(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP)} fill="none" stroke="#1e293b" strokeWidth="2.4" strokeLinecap="round" />
        {/* valore */}
        <path
          d={fwd ? arcPath(cx, cy, r, fromDeg, valueDeg) : arcPath(cx, cy, r, valueDeg, fromDeg)}
          fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 2px ${accent})` }}
        />
        {/* indicatore */}
        <line x1={indInner.x} y1={indInner.y} x2={ind.x} y2={ind.y} stroke="#e2e8f0" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      {display != null && <div className="text-[10px] font-mono tabular-nums text-gray-200 leading-none mt-0.5">{display}</div>}
      {label != null && <div className="text-[9px] uppercase tracking-wide text-gray-400 leading-none mt-0.5">{label}</div>}
    </div>
  );
};

export default Knob;
