import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccompanimentTrack } from '../types';
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
  voiceVolumes: Record<number, number>;
  mutedVoices: Set<number>;
  soloVoices: Set<number>;
  onChangeVoiceInstrument: (voice: number, instrument: string) => void;
  onUpdateVoice: (voice: number, updates: { volume?: number; muted?: boolean }) => void;
  onToggleSolo: (voice: number) => void;
  // Accompaniment tracks
  accompanimentTracks: AccompanimentTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AccompanimentTrack>) => void;
  onAddEmptyTrack: () => void;
  onDeleteTrack: (trackId: string) => void;
  onClose: () => void;
}

const VOICE_LABELS: Record<number, string> = { 1: 'S', 2: 'A', 3: 'T', 4: 'B' };
const VOICE_NAMES: Record<number, string> = { 1: 'Soprano', 2: 'Contralto', 3: 'Tenore', 4: 'Basso' };
// Accent colours match the per-voice colours used in the toolbar.
const VOICE_ACCENTS: Record<number, string> = { 1: '#2563eb', 2: '#f97316', 3: '#16a34a', 4: '#dc2626' };

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
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({
  tT, label, title, accent, gm, onChangeInstrument, volume, onChangeVolume,
  muted, onToggleMute, solo, onToggleSolo, visible, onToggleVisible, onContextMenu,
}) => (
  <div
    className="flex flex-col items-center gap-1.5 px-1.5 py-2 rounded bg-slate-900/40"
    style={{ width: 56 }}
    onContextMenu={onContextMenu}
  >
    {/* Label */}
    <div
      className="text-[10px] font-bold w-full text-center truncate leading-tight"
      style={{ color: accent ?? '#cbd5e1' }}
      title={title}
    >
      {label}
    </div>

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

    {/* Volume fader (vertical) */}
    <div className="flex flex-col items-center gap-0.5 mt-0.5">
      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
          title={`Volume: ${Math.round(volume * 100)}%`}
          orient="vertical"
          style={{
            writingMode: 'vertical-lr' as any,
            direction: 'rtl',
            width: 20,
            height: 80,
            cursor: 'pointer',
            accentColor: accent ?? '#38bdf8',
          }}
        />
      </div>
      <span className="text-[8px] text-gray-400 leading-none">{Math.round(volume * 100)}%</span>
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

const MixerPanel: React.FC<MixerPanelProps> = ({
  voiceInstruments, voiceVolumes, mutedVoices, soloVoices,
  onChangeVoiceInstrument, onUpdateVoice, onToggleSolo,
  accompanimentTracks, onUpdateTrack, onAddEmptyTrack, onDeleteTrack,
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
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1 px-1">Voci</div>
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
              />
            ))}
          </div>
        </section>

        {/* Divider */}
        <div className="w-px bg-slate-600 self-stretch" />

        {/* TRACCE section */}
        <section className="flex flex-col">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Tracce</span>
            <button
              onClick={onAddEmptyTrack}
              title="Aggiungi nuova traccia vuota"
              className="h-4 px-1.5 bg-cyan-700 hover:bg-cyan-600 text-white text-[9px] font-bold rounded transition-colors"
            >
              + Nuova
            </button>
          </div>
          <div className="flex gap-1">
            {accompanimentTracks.length === 0 ? (
              <div className="text-gray-500 text-[9px] text-center px-3 py-6 leading-tight self-center">
                Nessuna<br />traccia
              </div>
            ) : (
              accompanimentTracks.map(track => (
                <ChannelStrip
                  key={track.id}
                  tT={tT}
                  label={track.name}
                  title={track.name}
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
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, trackId: track.id }); }}
                />
              ))
            )}
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
