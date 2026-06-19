import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccompanimentTrack, ClefType } from '../types';
import { INSTRUMENTS, instrumentEmoji, soundfontToGm } from '../constants/instruments';

/**
 * Unified, floating mixer window (replaces the sidebar-anchored TrackMixerPanel).
 *
 * Combines the four SATB voices and the accompaniment tracks into a single
 * draggable window — independent of score scroll/position, so it no longer
 * "slides" as the piece grows. Each channel has volume, mute, solo and an
 * instrument selector; ACC tracks additionally have visibility and add/delete.
 *
 * Mute/solo semantics are unified across voices and tracks (see the audibility
 * helpers in GrandStaffEditor): if anything is soloed anywhere, only soloed
 * channels sound; mute always silences.
 */
interface MixerPanelProps {
  // SATB voices
  voiceInstruments: Record<number, string>;
  /** Canale MIDI in uscita per voce (1-16); assente = auto (voce → 1-4). */
  voiceMidiChannels?: Record<number, number>;
  onChangeVoiceMidiChannel?: (voice: number, ch: number | null) => void;
  voiceVolumes: Record<number, number>;
  mutedVoices: Set<number>;
  soloVoices: Set<number>;
  onChangeVoiceInstrument: (voice: number, instrument: string) => void;
  onUpdateVoice: (voice: number, updates: { volume?: number; muted?: boolean }) => void;
  onToggleSolo: (voice: number) => void;
  /** SATB staff visibility (display-only, like ACC tracks; audio keeps playing). */
  satbVisible?: boolean;
  onToggleSatbVisible?: () => void;
  /** Custom SATB group name (editable like ACC track names). */
  satbName?: string;
  onRenameSatb?: (name: string) => void;
  // Accompaniment tracks
  accompanimentTracks: AccompanimentTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AccompanimentTrack>) => void;
  onAddEmptyTrack: () => void;
  onAddDrumTrack: () => void;
  onDeleteTrack: (trackId: string) => void;
  /** Instantaneous output peak (0..1) for a SATB voice — drives the signal LEDs. */
  getVoiceLevel?: (voice: number) => number;
  /** Instantaneous output peak (0..1) for an ACC track (by array index). */
  getTrackLevel?: (trackIndex: number) => number;
  // Master faders (linear gain 0..1): SATB group, ACC group, and global mixer out.
  satbMasterVolume?: number;
  accMasterVolume?: number;
  mixerMasterVolume?: number;
  onChangeSatbMasterVolume?: (v: number) => void;
  onChangeAccMasterVolume?: (v: number) => void;
  onChangeMixerMasterVolume?: (v: number) => void;
  getSatbMasterLevel?: () => number;
  getAccMasterLevel?: () => number;
  getMixerMasterLevel?: () => number;
  onClose: () => void;
}

const VOICE_LABELS: Record<number, string> = { 1: 'S', 2: 'A', 3: 'T', 4: 'B' };
const VOICE_NAMES: Record<number, string> = { 1: 'Soprano', 2: 'Contralto', 3: 'Tenore', 4: 'Basso' };
// Accent colours match the per-voice colours used in the toolbar.
const VOICE_ACCENTS: Record<number, string> = { 1: '#2563eb', 2: '#f97316', 3: '#16a34a', 4: '#dc2626' };

// Per-track staff options. "grandstaff" = treble+bass (keyboard); the others are a
// single staff with the given clef (instrumental/vocal lines). Encoded as
// { staffMode, clef } applied to the AccompanimentTrack.
type StaffChoice = { value: string; label: string; staffMode: 'grandstaff' | 'treble_only'; clef?: ClefType; voiced?: boolean; octaveTranspose?: number };
const STAFF_OPTIONS: StaffChoice[] = [
  { value: 'grandstaff',        label: 'Grandstaff',        staffMode: 'grandstaff' },
  { value: 'grandstaff-voiced', label: 'Grand staff a voci', staffMode: 'grandstaff', voiced: true },
  { value: 'single-treble',      label: '𝄞 Violino',          staffMode: 'treble_only', clef: 'treble' },
  // Chiavi traspositrici (8vb): suonano un'ottava SOTTO il scritto, come chitarra e basso.
  { value: 'single-treble-8vb',  label: '𝄞 Chitarra (8vb)',   staffMode: 'treble_only', clef: 'treble', octaveTranspose: -1 },
  { value: 'single-bass',        label: '𝄢 Basso',            staffMode: 'treble_only', clef: 'bass' },
  { value: 'single-bass-8vb',    label: '𝄢 Basso (8vb)',      staffMode: 'treble_only', clef: 'bass', octaveTranspose: -1 },
  { value: 'single-soprano',     label: 'Soprano',            staffMode: 'treble_only', clef: 'soprano' },
  { value: 'single-alto',        label: 'Contralto',          staffMode: 'treble_only', clef: 'alto' },
  { value: 'single-tenor',       label: 'Tenore',             staffMode: 'treble_only', clef: 'tenor' },
];
const staffChoiceValue = (track: AccompanimentTrack): string => {
  if (track.staffMode === 'grandstaff') return track.voiced ? 'grandstaff-voiced' : 'grandstaff';
  const clef = track.clef ?? 'treble';
  if (track.octaveTranspose === -1 && (clef === 'treble' || clef === 'bass')) return `single-${clef}-8vb`;
  return `single-${clef}`;
};

// ── Fader / level helpers ───────────────────────────────────────────────────
// The stored `volume` stays a LINEAR gain in [0..1] (0 dB at unity), so the
// audio engine is untouched. The fader uses a gentle audio taper (squared) so
// the mid-throw stays usable — about −19 dB at 1/3, −5 dB at 3/4, 0 dB at top —
// instead of a steep dB-linear taper that left the lower half nearly silent.
// The dB readout still shows 20·log10(gain).
const DB_FLOOR = -60; // readout shows −∞ below this
const gainToDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
/** fader position (0 bottom .. 1 top) → linear gain */
const posToGain = (p: number): number => (p <= 0 ? 0 : p * p);
/** linear gain → fader position (0..1) */
const gainToPos = (g: number): number => (g <= 0 ? 0 : Math.sqrt(Math.min(1, g)));

const FADER_H = 104;       // px height of the fader travel
const CAP_H = 13;          // px height of the fader cap
const LED_COUNT = 20;      // segments in the signal meter
const METER_FLOOR_DB = -48; // bottom of the LED meter scale

/** Per-segment colour ramp (green → yellow → orange → red as we climb toward
 *  the top), so a hot signal lights the red segments and the whole meter reads
 *  "loud" at a glance. `i` is 1-based from the bottom. */
const ledColor = (i: number): string => {
  const f = (i - 1) / (LED_COUNT - 1);      // 0 bottom … 1 top
  const hue = Math.round(120 * (1 - Math.pow(f, 1.15))); // 120=green → 0=red
  return `hsl(${hue}, 92%, 52%)`;
};

/** Vertical LED signal meter. Runs its own rAF so only this tiny column
 *  repaints (~60fps), never the whole panel. Fast attack, slow release,
 *  with a short peak-hold segment. */
const LedMeter: React.FC<{ getLevel?: () => number }> = ({ getLevel }) => {
  const [lit, setLit] = useState(0);
  const [peakSeg, setPeakSeg] = useState(0);
  const getLevelRef = useRef(getLevel);
  getLevelRef.current = getLevel;

  useEffect(() => {
    let raf = 0;
    let smooth = 0;       // smoothed 0..1 level
    let peak = 0;         // peak-hold 0..1
    let peakWait = 0;     // seconds remaining before peak decays
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const amp = getLevelRef.current ? Math.max(0, Math.min(1, getLevelRef.current())) : 0;
      const db = amp > 0 ? 20 * Math.log10(amp) : -Infinity;
      const frac = db === -Infinity ? 0 : Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
      // fast attack, slow release
      smooth = frac > smooth ? frac : smooth + (frac - smooth) * Math.min(1, dt * 7);
      if (smooth >= peak) { peak = smooth; peakWait = 0.7; }
      else if (peakWait > 0) { peakWait -= dt; }
      else { peak = Math.max(0, peak - dt * 0.5); }
      setLit(Math.round(smooth * LED_COUNT));
      setPeakSeg(peak > 0.001 ? Math.max(1, Math.round(peak * LED_COUNT)) : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const segs = [];
  for (let i = 1; i <= LED_COUNT; i++) {
    const on = i <= lit;
    const isPeak = i === peakSeg;
    const color = ledColor(i);
    segs.push(
      <div
        key={i}
        style={{
          flex: 1,
          marginTop: 1,
          borderRadius: 1,
          background: on || isPeak ? color : '#161f2e',
          opacity: on ? 1 : isPeak ? 0.85 : 0.5,
          boxShadow: on ? `0 0 2px ${color}` : 'none',
          transition: 'background 40ms linear, opacity 40ms linear',
        }}
      />
    );
  }
  // column-reverse so the first child sits at the BOTTOM
  return <div style={{ display: 'flex', flexDirection: 'column-reverse', width: 7, height: FADER_H }}>{segs}</div>;
};

/** Console-style vertical fader: incised groove, accent fill, metal cap with an
 *  accent center line, a dB scale on the left and the LED meter on the right. */
const ConsoleFader: React.FC<{
  value: number;                 // linear gain 0..1
  onChange: (gain: number) => void;
  accent: string;
  getLevel?: () => number;
}> = ({ value, onChange, accent, getLevel }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const pos = gainToPos(value);

  const setFromClientY = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    onChange(posToGain(p));
  }, [onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setFromClientY(e.clientY);
    const move = (ev: PointerEvent) => setFromClientY(ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onWheel = (e: React.WheelEvent) => {
    const np = Math.max(0, Math.min(1, pos - Math.sign(e.deltaY) * 0.03));
    onChange(posToGain(np));
  };

  const capTop = (1 - pos) * (FADER_H - CAP_H);
  const ticks = [0, -6, -12, -24, -48];

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 3, height: FADER_H }}>
      {/* dB scale */}
      <div style={{ position: 'relative', width: 15, fontSize: 7, color: '#64748b', lineHeight: 1 }}>
        {ticks.map(t => {
          // throw position for a given dB under the squared taper: p = 10^(dB/40)
          const y = (1 - Math.pow(10, t / 40)) * 100;
          return (
            <span key={t} style={{ position: 'absolute', top: `calc(${y}% - 3px)`, right: 0 }}>{t}</span>
          );
        })}
        <span style={{ position: 'absolute', bottom: -2, right: 0 }}>∞</span>
      </div>

      {/* groove + fill + cap (drag area) */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
        title={`Volume: ${gainToDb(value) <= DB_FLOOR + 0.1 ? '−∞' : gainToDb(value).toFixed(1) + ' dB'}`}
        style={{ position: 'relative', width: 24, cursor: 'ns-resize', touchAction: 'none' }}
      >
        {/* groove */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 5, transform: 'translateX(-50%)', borderRadius: 3, background: '#0b1220', boxShadow: 'inset 0 0 2px #000, inset 0 0 0 1px #334155' }} />
        {/* accent fill below the cap */}
        <div style={{ position: 'absolute', left: '50%', width: 5, transform: 'translateX(-50%)', bottom: 0, top: `${(1 - pos) * 100}%`, borderRadius: 3, background: accent, opacity: 0.85 }} />
        {/* 0 dB reference tick (top) */}
        <div style={{ position: 'absolute', left: 3, right: 3, top: 0, height: 1, background: '#475569' }} />
        {/* fader cap */}
        <div
          style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: capTop,
            width: 26, height: CAP_H, borderRadius: 3,
            background: 'linear-gradient(180deg,#e2e8f0 0%,#94a3b8 55%,#64748b 100%)',
            border: '1px solid #0f172a',
            boxShadow: '0 1px 2px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ position: 'absolute', left: 2, right: 2, top: '50%', height: 2, transform: 'translateY(-50%)', background: accent, borderRadius: 1 }} />
        </div>
      </div>

      {/* signal LEDs */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <LedMeter getLevel={getLevel} />
      </div>
    </div>
  );
};

/** A single vertical channel strip (shared layout for voices and tracks). */
const ChannelStrip: React.FC<{
  /** Translator for the 'toolbar' namespace (instrument labels). */
  tT: (key: string) => string;
  label: string;
  title: string;
  accent?: string;
  /** GM program number currently selected (drives emoji + selector value). */
  gm: number;
  onChangeInstrument: (gm: number) => void;
  volume: number;
  onChangeVolume: (v: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  solo: boolean;
  onToggleSolo: () => void;
  /** Optional visibility toggle (ACC tracks only). */
  visible?: boolean;
  onToggleVisible?: () => void;
  /** Optional staff/clef selector (ACC tracks only). */
  staffControl?: React.ReactNode;
  /** Optional MIDI output channel selector (ACC tracks only). */
  midiChannelControl?: React.ReactNode;
  /** Optional rename handler (ACC tracks only): makes the label an editable input. */
  onRename?: (name: string) => void;
  /** Optional track color + handler (ACC tracks only): shows a color swatch. */
  color?: string;
  onChangeColor?: (c: string) => void;
  /** Instantaneous output peak (0..1) for the signal LEDs. */
  getLevel?: () => number;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({
  tT, label, title, accent, gm, onChangeInstrument, volume, onChangeVolume,
  muted, onToggleMute, solo, onToggleSolo, visible, onToggleVisible, staffControl, midiChannelControl, onRename, color, onChangeColor, getLevel, onContextMenu,
}) => (
  <div
    className="flex flex-col items-center gap-1.5 px-1.5 py-2 rounded bg-slate-900/40"
    style={{ width: 66 }}
    onContextMenu={onContextMenu}
  >
    {/* Label — editable input for ACC tracks, static text for voices */}
    {onRename ? (
      <input
        value={label}
        onChange={(e) => onRename(e.target.value)}
        title="Rinomina traccia"
        aria-label="Nome traccia"
        className="text-[10px] font-bold w-full text-center leading-tight bg-transparent border-b border-transparent hover:border-slate-600 focus:border-cyan-500 focus:bg-slate-900/60 outline-none rounded-sm"
        style={{ color: accent ?? '#cbd5e1' }}
      />
    ) : (
      <div
        className="text-[10px] font-bold w-full text-center truncate leading-tight"
        style={{ color: accent ?? '#cbd5e1' }}
        title={title}
      >
        {label}
      </div>
    )}

    {/* Instrument selector (emoji button with an invisible native <select> overlay) */}
    <div
      className="relative w-7 h-6"
      title={`${tT('instrument_' + (INSTRUMENTS.find(o => o.gm === gm)?.i18nKey ?? 'piano'))}`}
    >
      <div className="w-full h-full rounded bg-slate-600 flex items-center justify-center text-[13px] pointer-events-none">
        {instrumentEmoji(gm)}
      </div>
      <select
        value={gm}
        onChange={(e) => onChangeInstrument(parseInt(e.target.value, 10))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label={`Strumento ${title}`}
      >
        {INSTRUMENTS.map(opt => (
          <option key={opt.gm} value={opt.gm}>{opt.emoji} {tT('instrument_' + opt.i18nKey)}</option>
        ))}
      </select>
    </div>

    {/* Staff/clef selector (ACC tracks only) */}
    {staffControl}

    {/* MIDI output channel selector (ACC tracks only) */}
    {midiChannelControl}

    {/* Track color picker (ACC tracks only) */}
    {onChangeColor && (
      <label
        className="relative w-7 h-4 rounded cursor-pointer border border-slate-600 overflow-hidden"
        style={{ backgroundColor: color || '#64748b' }}
        title="Colore traccia"
      >
        <input
          type="color"
          value={color || '#64748b'}
          onChange={(e) => onChangeColor(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label="Colore traccia"
        />
      </label>
    )}

    {/* Mute / Solo */}
    <div className="flex gap-1">
      <button
        onClick={onToggleMute}
        title={muted ? 'Riattiva' : 'Silenzia'}
        className={`w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${
          muted ? 'bg-red-600 text-white' : 'bg-slate-600 text-gray-300 hover:bg-slate-500'
        }`}
      >
        M
      </button>
      <button
        onClick={onToggleSolo}
        title={solo ? 'Disattiva solo' : 'Solo'}
        className={`w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${
          solo ? 'bg-yellow-500 text-black' : 'bg-slate-600 text-gray-300 hover:bg-slate-500'
        }`}
      >
        S
      </button>
    </div>

    {/* Visibility (ACC only) */}
    {onToggleVisible && (
      <button
        onClick={onToggleVisible}
        title={visible ? 'Nascondi pentagramma' : 'Mostra pentagramma'}
        className={`w-6 h-6 rounded text-[11px] flex items-center justify-center transition-colors ${
          visible ? 'bg-slate-600 text-gray-300 hover:bg-slate-500' : 'bg-slate-700 text-gray-600 hover:bg-slate-600'
        }`}
      >
        {visible ? '👁' : '🚫'}
      </button>
    )}

    {/* Volume fader (console style) + dB readout */}
    <div className="flex flex-col items-center gap-0.5 mt-0.5">
      <ConsoleFader
        value={volume}
        onChange={onChangeVolume}
        accent={accent ?? '#38bdf8'}
        getLevel={getLevel}
      />
      <span className="text-[8px] text-gray-300 font-mono leading-none tabular-nums">
        {gainToDb(volume) <= DB_FLOOR + 0.1 ? '−∞' : `${gainToDb(volume) > 0 ? '+' : ''}${gainToDb(volume).toFixed(1)}`} dB
      </span>
    </div>

    {/* FX placeholder (layout only — future insert slots) */}
    <button
      disabled
      title="Effetti (in arrivo)"
      className="w-full h-5 mt-0.5 rounded border border-dashed border-slate-600 text-[8px] text-slate-500 cursor-not-allowed"
    >
      + FX
    </button>
  </div>
);

/** Master/group strip: just a label, a console fader with its meter, and a dB
 *  readout. Used for the SATB-group, ACC-group and global mixer master buses. The
 *  fader sits near the bottom to line up with the channel-strip faders alongside. */
const MasterStrip: React.FC<{
  label: string;
  accent: string;
  volume: number;
  onChangeVolume: (v: number) => void;
  getLevel?: () => number;
}> = ({ label, accent, volume, onChangeVolume, getLevel }) => (
  <div
    className="flex flex-col items-center px-1.5 py-2 rounded bg-slate-900/60 border border-slate-700"
    style={{ width: 66 }}
  >
    <div className="text-[10px] font-bold w-full text-center truncate leading-tight" style={{ color: accent }} title={label}>
      {label}
    </div>
    {/* Spacer so the fader bottom aligns with the channel-strip faders */}
    <div className="flex-1" style={{ minHeight: 8 }} />
    <div className="flex flex-col items-center gap-0.5">
      <ConsoleFader value={volume} onChange={onChangeVolume} accent={accent} getLevel={getLevel} />
      <span className="text-[8px] text-gray-300 font-mono leading-none tabular-nums">
        {gainToDb(volume) <= DB_FLOOR + 0.1 ? '−∞' : `${gainToDb(volume) > 0 ? '+' : ''}${gainToDb(volume).toFixed(1)}`} dB
      </span>
    </div>
  </div>
);

const MixerPanel: React.FC<MixerPanelProps> = ({
  voiceInstruments, voiceMidiChannels, onChangeVoiceMidiChannel, voiceVolumes, mutedVoices, soloVoices,
  onChangeVoiceInstrument, onUpdateVoice, onToggleSolo,
  satbVisible, onToggleSatbVisible, satbName, onRenameSatb,
  accompanimentTracks, onUpdateTrack, onAddEmptyTrack, onAddDrumTrack, onDeleteTrack,
  getVoiceLevel, getTrackLevel,
  satbMasterVolume = 1, accMasterVolume = 1, mixerMasterVolume = 1,
  onChangeSatbMasterVolume, onChangeAccMasterVolume, onChangeMixerMasterVolume,
  getSatbMasterLevel, getAccMasterLevel, getMixerMasterLevel,
  onClose,
}) => {
  const { t: tT } = useTranslation('toolbar');

  // --- Floating window position + drag (standard mousemove/mouseup pattern) ---
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 120, y: 120 });
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

  // --- Context menu (delete ACC track) ---
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // --- "+" add-track menu (replaces the inline +Nuova / +Batteria buttons) ---
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [addMenuOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const handleDelete = (trackId: string) => {
    const track = accompanimentTracks.find(t => t.id === trackId);
    if (window.confirm(`Eliminare la traccia '${track?.name ?? ''}'?`)) onDeleteTrack(trackId);
    setContextMenu(null);
  };

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000 }}
      className="bg-slate-800 rounded-lg shadow-2xl border border-slate-700 select-none"
    >
      {/* Title bar (drag handle) */}
      <div
        onMouseDown={onTitleMouseDown}
        className="flex items-center justify-between px-2 py-1 bg-slate-900 rounded-t-lg cursor-move"
      >
        <span className="text-[11px] font-bold text-gray-300 tracking-wide">🎚 Mixer</span>
        <button
          onClick={onClose}
          title="Chiudi mixer"
          className="w-5 h-5 text-gray-500 hover:text-gray-200 flex items-center justify-center text-xs rounded transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Body: VOCI | TRACCE */}
      <div className="flex items-stretch gap-3 p-2 max-w-[80vw] overflow-x-auto">
        {/* VOCI section */}
        <section className="flex flex-col">
          <div className="flex items-center justify-between mb-1 px-1">
            {onRenameSatb ? (
              <input
                value={satbName ?? ''}
                onChange={(e) => onRenameSatb(e.target.value)}
                placeholder="Voci (SATB)"
                title="Rinomina il gruppo SATB"
                aria-label="Nome SATB"
                className="text-[9px] font-bold text-gray-300 uppercase tracking-wider w-24 bg-transparent border-b border-transparent hover:border-slate-600 focus:border-cyan-500 focus:bg-slate-900/60 outline-none rounded-sm"
              />
            ) : (
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Voci (SATB)</span>
            )}
            {onToggleSatbVisible && (
              <button
                onClick={onToggleSatbVisible}
                title={satbVisible ? 'Nascondi rigo SATB' : 'Mostra rigo SATB'}
                className={`h-4 px-1 rounded text-[10px] leading-none flex items-center justify-center transition-colors ${
                  satbVisible ? 'bg-slate-600 text-gray-300 hover:bg-slate-500' : 'bg-slate-700 text-gray-600 hover:bg-slate-600'
                }`}
              >
                {satbVisible ? '👁' : '🚫'}
              </button>
            )}
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map(v => (
              <ChannelStrip
                key={v}
                tT={tT}
                label={VOICE_LABELS[v]}
                title={VOICE_NAMES[v]}
                accent={VOICE_ACCENTS[v]}
                gm={soundfontToGm(voiceInstruments[v])}
                onChangeInstrument={(gm) => {
                  const sf = INSTRUMENTS.find(o => o.gm === gm)?.soundfont ?? 'acoustic_grand_piano';
                  onChangeVoiceInstrument(v, sf);
                }}
                volume={voiceVolumes[v] ?? 1}
                onChangeVolume={(vol) => onUpdateVoice(v, { volume: vol })}
                muted={mutedVoices.has(v)}
                onToggleMute={() => onUpdateVoice(v, { muted: !mutedVoices.has(v) })}
                solo={soloVoices.has(v)}
                onToggleSolo={() => onToggleSolo(v)}
                getLevel={getVoiceLevel ? () => getVoiceLevel(v) : undefined}
                midiChannelControl={onChangeVoiceMidiChannel ? (
                  <select
                    value={voiceMidiChannels?.[v] ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      onChangeVoiceMidiChannel(v, val === 0 ? null : val);
                    }}
                    title="Canale MIDI in uscita (verso DAW esterno)"
                    aria-label="Canale MIDI in uscita"
                    className="w-full bg-slate-700 text-gray-200 text-[8px] rounded px-0.5 py-0.5 border border-slate-600 cursor-pointer"
                  >
                    <option value={0}>MIDI: Auto</option>
                    {Array.from({ length: 16 }, (_, i) => i + 1).map(c => (
                      <option key={c} value={c}>MIDI ch. {c}</option>
                    ))}
                  </select>
                ) : undefined}
              />
            ))}
            {/* SATB group master */}
            <div className="w-px bg-slate-700/70 self-stretch mx-0.5" />
            <MasterStrip
              label="SATB"
              accent="#a78bfa"
              volume={satbMasterVolume}
              onChangeVolume={(v) => onChangeSatbMasterVolume?.(v)}
              getLevel={getSatbMasterLevel}
            />
          </div>
        </section>

        {/* Divider */}
        <div className="w-px bg-slate-600 self-stretch" />

        {/* TRACCE section */}
        <section className="flex flex-col">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Tracce</span>
            {/* Single "+" that opens a small menu — keeps the fader area uncluttered. */}
            <div className="relative" ref={addMenuRef}>
              <button
                onClick={() => setAddMenuOpen(o => !o)}
                title="Aggiungi traccia"
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
                className={`w-5 h-5 flex items-center justify-center rounded text-white text-sm font-bold leading-none transition-colors ${addMenuOpen ? 'bg-cyan-600' : 'bg-cyan-700 hover:bg-cyan-600'}`}
              >
                +
              </button>
              {addMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 z-20 bg-slate-700 border border-slate-600 rounded shadow-lg py-1 min-w-[140px]"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    role="menuitem"
                    onClick={() => { onAddEmptyTrack(); setAddMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-100 hover:bg-slate-600 whitespace-nowrap"
                  >
                    🎵 Nuova traccia
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { onAddDrumTrack(); setAddMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-100 hover:bg-slate-600 whitespace-nowrap"
                  >
                    🥁 Batteria
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-1">
            {accompanimentTracks.length === 0 ? (
              <div className="text-gray-500 text-[9px] text-center px-3 py-6 leading-tight self-center">
                Nessuna<br />traccia
              </div>
            ) : (
              accompanimentTracks.map((track, idx) => (
                <ChannelStrip
                  key={track.id}
                  tT={tT}
                  label={track.name}
                  title={track.name}
                  accent={track.color}
                  gm={track.instrumentId}
                  onChangeInstrument={(gm) => onUpdateTrack(track.id, { instrumentId: gm })}
                  volume={track.volume}
                  onChangeVolume={(vol) => onUpdateTrack(track.id, { volume: vol })}
                  muted={track.muted}
                  onToggleMute={() => onUpdateTrack(track.id, { muted: !track.muted })}
                  solo={!!track.solo}
                  onToggleSolo={() => onUpdateTrack(track.id, { solo: !track.solo })}
                  visible={track.visible}
                  onToggleVisible={() => onUpdateTrack(track.id, { visible: !track.visible })}
                  onRename={(name) => onUpdateTrack(track.id, { name })}
                  color={track.color}
                  onChangeColor={(c) => onUpdateTrack(track.id, { color: c })}
                  getLevel={getTrackLevel ? () => getTrackLevel(idx) : undefined}
                  staffControl={
                    <select
                      value={staffChoiceValue(track)}
                      onChange={(e) => {
                        const opt = STAFF_OPTIONS.find(o => o.value === e.target.value);
                        if (opt) onUpdateTrack(track.id, { staffMode: opt.staffMode, clef: opt.clef, voiced: !!opt.voiced, octaveTranspose: opt.octaveTranspose ?? 0 });
                      }}
                      title="Tipo di rigo / chiave"
                      aria-label="Tipo di rigo"
                      className="w-full bg-slate-700 text-gray-200 text-[8px] rounded px-0.5 py-0.5 border border-slate-600 cursor-pointer"
                    >
                      {STAFF_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  }
                  midiChannelControl={
                    <select
                      value={track.midiChannel ?? 0}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        onUpdateTrack(track.id, { midiChannel: v === 0 ? undefined : v });
                      }}
                      title="Canale MIDI in uscita (verso DAW esterno)"
                      aria-label="Canale MIDI in uscita"
                      className="w-full bg-slate-700 text-gray-200 text-[8px] rounded px-0.5 py-0.5 border border-slate-600 cursor-pointer"
                    >
                      <option value={0}>MIDI: Auto</option>
                      {Array.from({ length: 16 }, (_, i) => i + 1).map(c => (
                        <option key={c} value={c}>MIDI ch. {c}</option>
                      ))}
                    </select>
                  }
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, trackId: track.id }); }}
                />
              ))
            )}
            {/* ACC group master */}
            <div className="w-px bg-slate-700/70 self-stretch mx-0.5" />
            <MasterStrip
              label="ACC"
              accent="#2dd4bf"
              volume={accMasterVolume}
              onChangeVolume={(v) => onChangeAccMasterVolume?.(v)}
              getLevel={getAccMasterLevel}
            />
          </div>
        </section>

        {/* Divider */}
        <div className="w-px bg-slate-600 self-stretch" />

        {/* MASTER section (global mixer out) */}
        <section className="flex flex-col">
          <div className="flex items-center mb-1 px-1">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Master</span>
          </div>
          <div className="flex gap-1">
            <MasterStrip
              label="MIX"
              accent="#38bdf8"
              volume={mixerMasterVolume}
              onChangeVolume={(v) => onChangeMixerMasterVolume?.(v)}
              getLevel={getMixerMasterLevel}
            />
          </div>
        </section>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
          className="bg-slate-700 border border-slate-600 rounded shadow-lg py-1"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleDelete(contextMenu.trackId)}
            className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-slate-600 whitespace-nowrap"
          >
            Elimina traccia
          </button>
        </div>
      )}
    </div>
  );
};

export default MixerPanel;
