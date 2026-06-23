import React, { useRef, useCallback } from 'react';
import FxWindow from './fx/FxWindow';
import Knob from './fx/Knob';

/**
 * Finestra EQ a 3 bande (low shelf / mid peak / high shelf) in stile plug-in moderno
 * (FabFilter-like): curva di risposta in frequenza calcolata analiticamente (cookbook RBJ),
 * con i 3 punti banda TRASCINABILI (X = frequenza log, Y = guadagno) — manipolazione diretta.
 * Solo UI; i BiquadFilter veri sono nel parent.
 */
const ACCENT = '#2dd4bf';
const BAND_COLORS = { low: '#38bdf8', mid: '#22c55e', high: '#f59e0b' };
const FS = 44100;
const FMIN = 20, FMAX = 20000, GMAX = 18;

type Band = { freq: number; gain: number; q?: number };
type EqProps = {
  enabled: boolean;
  low: Band; mid: Band; high: Band;
  target?: string;
  onToggle: () => void;
  onChange: (patch: { low?: Partial<Band>; mid?: Partial<Band>; high?: Partial<Band> }) => void;
  onClose: () => void;
};

// ── Magnitudine biquad (dB) dalle formule RBJ ────────────────────────────────
const magFromCoeffs = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number, w: number): number => {
  const cw = Math.cos(w), c2w = Math.cos(2 * w);
  const num = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * cw + 2 * b0 * b2 * c2w;
  const den = a0 * a0 + a1 * a1 + a2 * a2 + 2 * (a0 * a1 + a1 * a2) * cw + 2 * a0 * a2 * c2w;
  return 10 * Math.log10(Math.max(1e-9, num) / Math.max(1e-9, den));
};
const bandMagDb = (type: 'low' | 'mid' | 'high', f0: number, gainDb: number, q: number, f: number): number => {
  if (Math.abs(gainDb) < 0.01) return 0;
  const w0 = 2 * Math.PI * f0 / FS;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const w = 2 * Math.PI * f / FS;
  if (type === 'mid') {
    const alpha = sw / (2 * Math.max(0.1, q));
    return magFromCoeffs(1 + alpha * A, -2 * cw, 1 - alpha * A, 1 + alpha / A, -2 * cw, 1 - alpha / A, w);
  }
  const alpha = sw / 2 * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2); // S=1
  const ap = 2 * Math.sqrt(A) * alpha;
  if (type === 'low') {
    return magFromCoeffs(
      A * ((A + 1) - (A - 1) * cw + ap), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - ap),
      (A + 1) + (A - 1) * cw + ap, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - ap, w);
  }
  return magFromCoeffs(
    A * ((A + 1) + (A - 1) * cw + ap), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - ap),
    (A + 1) - (A - 1) * cw + ap, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - ap, w);
};

const EqCurve: React.FC<{ low: Band; mid: Band; high: Band; enabled: boolean; w: number; h: number; onChange: EqProps['onChange'] }> = ({ low, mid, high, enabled, w, h, onChange }) => {
  const ref = useRef<SVGSVGElement>(null);
  const mL = 20, mB = 13, mT = 6, mR = 6;
  const x0 = mL, x1 = w - mR, y0 = mT, y1 = h - mB;
  const logspan = Math.log10(FMAX / FMIN);
  const fToX = (f: number) => x0 + (Math.log10(f / FMIN) / logspan) * (x1 - x0);
  const xToF = (x: number) => FMIN * Math.pow(10, ((x - x0) / (x1 - x0)) * logspan);
  const gToY = (g: number) => y0 + (1 - (g + GMAX) / (2 * GMAX)) * (y1 - y0);
  const yToG = (y: number) => (1 - (y - y0) / (y1 - y0)) * 2 * GMAX - GMAX;
  const resp = (f: number) => bandMagDb('low', low.freq, low.gain, 0.7, f) + bandMagDb('mid', mid.freq, mid.gain, mid.q ?? 1, f) + bandMagDb('high', high.freq, high.gain, 0.7, f);

  const pts: string[] = [];
  for (let x = x0; x <= x1; x += 2) pts.push(`${x.toFixed(1)},${gToY(Math.max(-GMAX, Math.min(GMAX, resp(xToF(x))))).toFixed(1)}`);
  const area = `M ${pts.join(' L ')} L ${x1.toFixed(1)},${gToY(0).toFixed(1)} L ${x0.toFixed(1)},${gToY(0).toFixed(1)} Z`;
  const fGrid = [100, 1000, 10000];
  const gGrid = [-12, 0, 12];
  const bands: Array<{ key: 'low' | 'mid' | 'high'; b: Band }> = [{ key: 'low', b: low }, { key: 'mid', b: mid }, { key: 'high', b: high }];

  const drag = useRef<'low' | 'mid' | 'high' | null>(null);
  const setFromEvent = useCallback((clientX: number, clientY: number) => {
    const el = ref.current; if (!el || !drag.current) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(FMIN, Math.min(FMAX, xToF(Math.max(x0, Math.min(x1, clientX - r.left)))));
    const g = Math.max(-GMAX, Math.min(GMAX, yToG(Math.max(y0, Math.min(y1, clientY - r.top)))));
    onChange({ [drag.current]: { freq: Math.round(f), gain: Math.round(g * 10) / 10 } } as any);
  }, [onChange]); // eslint-disable-line
  const onDown = (key: 'low' | 'mid' | 'high') => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation(); drag.current = key;
    const mv = (ev: PointerEvent) => setFromEvent(ev.clientX, ev.clientY);
    const up = () => { drag.current = null; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  return (
    <svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ opacity: enabled ? 1 : 0.55 }}>
      <defs>
        <linearGradient id="eqbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0c1424" /><stop offset="100%" stopColor="#0a0f1c" /></linearGradient>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity="0.26" /><stop offset="100%" stopColor={ACCENT} stopOpacity="0.03" /></linearGradient>
      </defs>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="5" fill="url(#eqbg)" stroke="#1e293b" />
      {fGrid.map(f => (<g key={'f' + f}><line x1={fToX(f)} y1={y0} x2={fToX(f)} y2={y1} stroke="#16223a" /><text x={fToX(f)} y={h - 3.5} textAnchor="middle" fontSize="6.5" fill="#5b6b86">{f >= 1000 ? `${f / 1000}k` : f}</text></g>))}
      {gGrid.map(g => (<g key={'g' + g}><line x1={x0} y1={gToY(g)} x2={x1} y2={gToY(g)} stroke={g === 0 ? '#243049' : '#16223a'} /><text x={x0 - 3} y={gToY(g) + 2.2} textAnchor="end" fontSize="6.5" fill="#5b6b86">{g > 0 ? `+${g}` : g}</text></g>))}
      <path d={area} fill="url(#eqfill)" />
      <polyline points={pts.join(' ')} fill="none" stroke="#dbeafe" strokeWidth="1" strokeLinejoin="round" />
      {bands.map(({ key, b }) => (
        <g key={key}>
          {/* hit-area generosa: drag su tutte le bande, scroll = Q solo sul mid (peaking) */}
          <circle cx={fToX(b.freq)} cy={gToY(b.gain)} r="13" fill="transparent"
            style={{ cursor: enabled ? 'grab' : 'default' }}
            onPointerDown={enabled ? onDown(key) : undefined}
            onWheel={enabled && key === 'mid' ? (e) => {
              e.stopPropagation();
              const nq = Math.max(0.3, Math.min(8, (mid.q ?? 1) - Math.sign(e.deltaY) * 0.2));
              onChange({ mid: { q: Math.round(nq * 10) / 10 } } as any);
            } : undefined} />
          <circle cx={fToX(b.freq)} cy={gToY(b.gain)} r="6" fill={BAND_COLORS[key]} fillOpacity={enabled ? 0.9 : 0.4} stroke="#0b1220" strokeWidth="1.5" style={{ pointerEvents: 'none' }} />
        </g>
      ))}
    </svg>
  );
};

const EqWindow: React.FC<EqProps> = ({ enabled, low, mid, high, target, onToggle, onChange, onClose }) => {
  const dis = !enabled;
  return (
    <FxWindow
      title="EQ" target={target} accent={ACCENT} width={480} onClose={onClose}
      headerExtra={
        <button onClick={onToggle} title={enabled ? 'Attivo — clic per bypass' : 'Bypass — clic per attivare'}
          className="text-[10px] font-semibold px-2 py-0.5 rounded transition-colors"
          style={enabled ? { color: '#06281f', background: ACCENT, boxShadow: `0 0 8px ${ACCENT}88` } : { color: '#94a3b8', background: '#1e293b', border: '1px solid #334155' }}>
          {enabled ? 'ON' : 'BYP'}
        </button>
      }
    >
      <div className="mb-3"><EqCurve low={low} mid={mid} high={high} enabled={enabled} w={448} h={210} onChange={onChange} /></div>
      <div className="flex justify-around items-start">
        <Knob label="Low" display={`${low.gain > 0 ? '+' : ''}${low.gain}dB`} value={low.gain} min={-GMAX} max={GMAX} onChange={(v) => onChange({ low: { gain: Math.round(v) } })} accent={BAND_COLORS.low} size={48} disabled={dis} defaultValue={0} wheelStep={1} />
        <Knob label="Mid" display={`${mid.gain > 0 ? '+' : ''}${mid.gain}dB`} value={mid.gain} min={-GMAX} max={GMAX} onChange={(v) => onChange({ mid: { gain: Math.round(v) } })} accent={BAND_COLORS.mid} size={48} disabled={dis} defaultValue={0} wheelStep={1} />
        <Knob label="Mid Q" display={`${(mid.q ?? 1).toFixed(1)}`} value={mid.q ?? 1} min={0.3} max={8} onChange={(v) => onChange({ mid: { q: Math.round(v * 10) / 10 } })} accent={BAND_COLORS.mid} size={48} disabled={dis} defaultValue={1} wheelStep={0.2} />
        <Knob label="High" display={`${high.gain > 0 ? '+' : ''}${high.gain}dB`} value={high.gain} min={-GMAX} max={GMAX} onChange={(v) => onChange({ high: { gain: Math.round(v) } })} accent={BAND_COLORS.high} size={48} disabled={dis} defaultValue={0} wheelStep={1} />
      </div>
    </FxWindow>
  );
};

export default EqWindow;
