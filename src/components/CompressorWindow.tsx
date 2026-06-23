import React, { useState, useRef, useEffect } from 'react';
import FxWindow from './fx/FxWindow';
import Knob from './fx/Knob';

/**
 * Finestra del COMPRESSORE in stile plug-in moderno (FabFilter-like): curva di trasferimento
 * I/O interattiva visiva, GR meter, manopole rotary. Modello "insert → finestra": tiene
 * l'effetto fuori dal mixer e gli dà spazio vero. Solo UI; nodi audio nel parent.
 */
const ACCENT = '#4f9dff';        // blu elettrico — più "pro" del rosa
const CURVE_LINE = '#dbeafe';    // linea di contenimento sottile, bianco-azzurra

interface CompressorWindowProps {
  enabled: boolean;
  threshold: number; // dB
  ratio: number;
  attack: number;    // s
  release: number;   // s
  makeup: number;    // dB
  target?: string;   // nome della traccia / "Master"
  onToggle: () => void;
  onChangeThreshold: (v: number) => void;
  onChangeRatio: (v: number) => void;
  onChangeAttack: (v: number) => void;
  onChangeRelease: (v: number) => void;
  onChangeMakeup: (v: number) => void;
  getReduction?: () => number;
  onClose: () => void;
}

/** Curva di trasferimento ingresso→uscita (dB) con griglia, SCALA NUMERICA sugli assi,
 *  riferimento 1:1, soglia e makeup. Linee sottili per un tratto preciso ed elegante. */
const TransferCurve: React.FC<{ threshold: number; ratio: number; makeup: number; w: number; h: number }> = ({ threshold, ratio, makeup, w, h }) => {
  const mL = 18, mB = 13, mT = 5, mR = 5; // margini per le scale numeriche
  const x0 = mL, x1 = w - mR, y0 = mT, y1 = h - mB;
  const gx = (i: number) => x0 + ((i + 60) / 60) * (x1 - x0);
  const gy = (o: number) => y0 + (1 - (o + 60) / 60) * (y1 - y0);
  const out = (i: number) => {
    const o = i <= threshold ? i : threshold + (i - threshold) / ratio;
    return Math.max(-60, Math.min(0, o + makeup));
  };
  const pts: string[] = [];
  for (let i = -60; i <= 0; i += 1.5) pts.push(`${gx(i).toFixed(1)},${gy(out(i)).toFixed(1)}`);
  // Area sotto la curva (zona ombreggiata) → chiusa fino alla base del grafico.
  const area = `M ${pts.join(' L ')} L ${gx(0).toFixed(1)},${y1.toFixed(1)} L ${gx(-60).toFixed(1)},${y1.toFixed(1)} Z`;
  const grid = [-48, -36, -24, -12, 0];
  const tx = gx(threshold), ty = gy(out(threshold));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id="cgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1424" /><stop offset="100%" stopColor="#0a0f1c" />
        </linearGradient>
        <linearGradient id="cfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.34" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="5" fill="url(#cgrad)" stroke="#1e293b" strokeWidth="1" />
      {grid.map(g => (
        <g key={g}>
          <line x1={gx(g)} y1={y0} x2={gx(g)} y2={y1} stroke="#16223a" strokeWidth="1" />
          <line x1={x0} y1={gy(g)} x2={x1} y2={gy(g)} stroke="#16223a" strokeWidth="1" />
          <text x={gx(g)} y={h - 3.5} textAnchor="middle" fontSize="6.5" fill="#5b6b86">{g}</text>
          {g !== 0 && <text x={x0 - 3} y={gy(g) + 2.2} textAnchor="end" fontSize="6.5" fill="#5b6b86">{g}</text>}
        </g>
      ))}
      <line x1={gx(-60)} y1={gy(-60)} x2={gx(0)} y2={gy(0)} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
      <line x1={tx} y1={y0} x2={tx} y2={y1} stroke={`${ACCENT}66`} strokeWidth="1" strokeDasharray="2 2" />
      {/* zona ombreggiata + linea sottile di contenimento */}
      <path d={area} fill="url(#cfill)" />
      <polyline points={pts.join(' ')} fill="none" stroke={CURVE_LINE} strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={tx} cy={ty} r="2.5" fill={CURVE_LINE} stroke={ACCENT} strokeWidth="1" />
    </svg>
  );
};

/** GR meter verticale: si riempie dall'alto (la riduzione tira giù). rAF leggero. */
const GrMeterV: React.FC<{ getReduction?: () => number; active: boolean; height: number }> = ({ getReduction, active, height }) => {
  const [gr, setGr] = useState(0);
  const ref = useRef(getReduction);
  ref.current = getReduction;
  useEffect(() => {
    let raf = 0; let shown = 0;
    const tick = () => {
      const v = ref.current ? ref.current() : 0;
      shown = Math.max(v, shown * 0.85);
      setGr(shown);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const pct = Math.min(1, gr / 18);
  return (
    <div className="flex flex-col items-center">
      <div style={{ position: 'relative', width: 8, height, borderRadius: 3, background: '#0b1220', boxShadow: 'inset 0 0 0 1px #334155', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${pct * 100}%`, background: 'linear-gradient(180deg,#fbbf24,#f59e0b)', opacity: active ? 1 : 0.22, transition: 'height 50ms linear' }} />
      </div>
      <span className="text-[8px] tabular-nums mt-0.5" style={{ color: active && gr >= 0.1 ? '#fbbf24' : '#64748b' }}>{active && gr >= 0.1 ? gr.toFixed(0) : '0'}</span>
      <span className="text-[8px] text-gray-500 leading-none">GR</span>
    </div>
  );
};

const CompressorWindow: React.FC<CompressorWindowProps> = ({
  enabled, threshold, ratio, attack, release, makeup, target,
  onToggle, onChangeThreshold, onChangeRatio, onChangeAttack, onChangeRelease, onChangeMakeup,
  getReduction, onClose,
}) => {
  const dis = !enabled;
  return (
    <FxWindow
      title="Compressore"
      target={target ?? 'Master'}
      accent={ACCENT}
      width={480}
      onClose={onClose}
      headerExtra={
        <button
          onClick={onToggle}
          title={enabled ? 'Attivo — clic per bypass' : 'Bypass — clic per attivare'}
          className="text-[10px] font-semibold px-2 py-0.5 rounded transition-colors"
          style={enabled
            ? { color: '#fff', background: ACCENT, boxShadow: `0 0 8px ${ACCENT}88` }
            : { color: '#94a3b8', background: '#1e293b', border: '1px solid #334155' }}
        >
          {enabled ? 'ON' : 'BYP'}
        </button>
      }
    >
      {/* Display: curva di trasferimento + GR meter */}
      <div className="flex gap-3 items-stretch mb-4" style={{ opacity: enabled ? 1 : 0.6 }}>
        <TransferCurve threshold={threshold} ratio={ratio} makeup={makeup} w={400} h={200} />
        <GrMeterV getReduction={getReduction} active={enabled} height={182} />
      </div>

      {/* Manopole */}
      <div className="flex justify-between items-start px-1">
        <Knob label="Thr" display={`${Math.round(threshold)}dB`} value={threshold} min={-48} max={0} onChange={onChangeThreshold} accent={ACCENT} size={50} disabled={dis} defaultValue={-18} wheelStep={1} />
        <Knob label="Ratio" display={`${ratio.toFixed(1)}:1`} value={ratio} min={1} max={12} onChange={onChangeRatio} accent={ACCENT} size={50} disabled={dis} defaultValue={3} wheelStep={0.5} />
        <Knob label="Atk" display={`${Math.round(attack * 1000)}ms`} value={attack} min={0.001} max={0.1} onChange={onChangeAttack} accent={ACCENT} size={50} disabled={dis} defaultValue={0.01} wheelStep={0.002} />
        <Knob label="Rel" display={`${Math.round(release * 1000)}ms`} value={release} min={0.02} max={0.6} onChange={onChangeRelease} accent={ACCENT} size={50} disabled={dis} defaultValue={0.15} wheelStep={0.01} />
        <Knob label="Gain" display={`${makeup > 0 ? '+' : ''}${makeup.toFixed(0)}dB`} value={makeup} min={0} max={18} onChange={onChangeMakeup} accent={ACCENT} size={50} disabled={dis} defaultValue={0} wheelStep={0.5} />
      </div>
    </FxWindow>
  );
};

export default CompressorWindow;
