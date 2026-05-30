import React, { useState, useEffect, useRef } from 'react';
import type { AccompanimentTrack } from '../types';

/** General MIDI program numbers paired with the soundfont names supported by the
 *  playback engine (see GM_TO_INSTR in GrandStaffEditor). Keep in sync with it. */
const INSTRUMENT_OPTIONS: Array<{ gm: number; emoji: string; label: string }> = [
  { gm: 0,  emoji: '🎹', label: 'Piano' },
  { gm: 19, emoji: '⛪', label: 'Organo' },
  { gm: 6,  emoji: '🎵', label: 'Clavicembalo' },
  { gm: 48, emoji: '🎻', label: 'Archi' },
  { gm: 52, emoji: '🎤', label: 'Coro' },
  { gm: 73, emoji: '🪈', label: 'Flauto' },
  { gm: 68, emoji: '🎼', label: 'Oboe' },
  { gm: 71, emoji: '🎼', label: 'Clarinetto' },
  { gm: 56, emoji: '🎺', label: 'Tromba' },
  { gm: 60, emoji: '📯', label: 'Corno' },
  { gm: 40, emoji: '🎻', label: 'Violino' },
  { gm: 42, emoji: '🎻', label: 'Violoncello' },
];
const instrumentEmoji = (gm: number) =>
  INSTRUMENT_OPTIONS.find(o => o.gm === gm)?.emoji ?? '🎹';

interface TrackMixerPanelProps {
  accompanimentTracks: AccompanimentTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AccompanimentTrack>) => void;
  onDeleteTrack: (trackId: string) => void;
  onAddEmptyTrack: () => void;
  onClose: () => void;
}

const TrackMixerPanel: React.FC<TrackMixerPanelProps> = ({
  accompanimentTracks,
  onUpdateTrack,
  onDeleteTrack,
  onAddEmptyTrack,
  onClose,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, trackId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, trackId });
  };

  const handleDelete = (trackId: string) => {
    const track = accompanimentTracks.find(t => t.id === trackId);
    if (window.confirm(`Eliminare la traccia '${track?.name ?? ''}'?`)) {
      onDeleteTrack(trackId);
    }
    setContextMenu(null);
  };

  return (
    <div className="w-[60px] flex-shrink-0 h-full bg-slate-800 rounded-lg flex flex-col border-r border-slate-700 overflow-y-auto overflow-x-hidden">
      {/* Header / close */}
      <div className="flex items-center justify-end px-1 pt-1 flex-shrink-0">
        <button
          onClick={onClose}
          title="Chiudi mixer"
          className="w-5 h-5 text-gray-500 hover:text-gray-300 flex items-center justify-center text-xs rounded transition-colors"
        >✕</button>
      </div>

      {/* Add empty track button */}
      <button
        onClick={onAddEmptyTrack}
        title="Aggiungi nuova traccia vuota"
        className="mx-1 mb-1 h-6 bg-cyan-700 hover:bg-cyan-600 text-white text-[10px] font-bold rounded transition-colors flex-shrink-0"
      >
        + Nuova
      </button>

      {/* Track list */}
      <div className="flex flex-col flex-1">
        {accompanimentTracks.length === 0 ? (
          <div className="text-gray-500 text-[9px] text-center px-1 py-3 leading-tight">
            Nessuna<br />traccia
          </div>
        ) : (
          accompanimentTracks.map((track, i) => (
            <div
              key={track.id}
              className={`flex flex-col items-center gap-1.5 py-2 px-1 ${i > 0 ? 'border-t border-slate-600' : ''}`}
              onContextMenu={(e) => handleContextMenu(e, track.id)}
            >
              {/* Name */}
              <div
                className="text-[9px] text-gray-300 w-full text-center truncate leading-tight"
                title={track.name}
              >
                {track.name}
              </div>

              {/* Instrument selector */}
              <div className="relative w-7 h-6" title={`Strumento: ${INSTRUMENT_OPTIONS.find(o => o.gm === track.instrumentId)?.label ?? 'Piano'}`}>
                <div className="w-full h-full rounded bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-[13px] pointer-events-none transition-colors">
                  {instrumentEmoji(track.instrumentId)}
                </div>
                <select
                  value={track.instrumentId}
                  onChange={(e) => onUpdateTrack(track.id, { instrumentId: parseInt(e.target.value, 10) })}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  aria-label="Strumento traccia"
                >
                  {INSTRUMENT_OPTIONS.map(opt => (
                    <option key={opt.gm} value={opt.gm}>{opt.emoji} {opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Mute */}
              <button
                onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                title={track.muted ? 'Riattiva' : 'Silenzia'}
                className={`w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${
                  track.muted
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-600 text-gray-300 hover:bg-slate-500'
                }`}
              >
                M
              </button>

              {/* Visibility */}
              <button
                onClick={() => onUpdateTrack(track.id, { visible: !track.visible })}
                title={track.visible ? 'Nascondi pentagramma' : 'Mostra pentagramma'}
                className={`w-6 h-6 rounded text-[11px] flex items-center justify-center transition-colors ${
                  track.visible
                    ? 'bg-slate-600 text-gray-300 hover:bg-slate-500'
                    : 'bg-slate-700 text-gray-600 hover:bg-slate-600'
                }`}
              >
                {track.visible ? '👁' : '🚫'}
              </button>

              {/* Volume slider (vertical) */}
              <div className="flex flex-col items-center gap-0.5 mt-0.5">
                <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={track.volume}
                    onChange={(e) => onUpdateTrack(track.id, { volume: parseFloat(e.target.value) })}
                    title={`Volume: ${Math.round(track.volume * 100)}%`}
                    orient="vertical"
                    style={{
                      writingMode: 'vertical-lr' as any,
                      direction: 'rtl',
                      width: 20,
                      height: 80,
                      cursor: 'pointer',
                      accentColor: '#38bdf8',
                    }}
                  />
                </div>
                <span className="text-[8px] text-gray-400 leading-none">
                  {Math.round(track.volume * 100)}%
                </span>
              </div>
            </div>
          ))
        )}
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

export default TrackMixerPanel;
