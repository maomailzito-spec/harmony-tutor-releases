import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { INSTRUMENTS, instrumentEmoji } from '../constants/instruments';

/** Una traccia iniziale richiesta dal dialog: accompagnamento (con strumento GM)
 *  oppure batteria. Il rigo SATB è gestito a parte (boolean `satb`). */
export type NewProjectTrackSpec =
  | { type: 'acc'; instrumentId: number }
  | { type: 'drums' };

export type NewProjectConfig = {
  /** Mostra il rigo SATB (false = progetto incentrato su ACC/batteria, SATB nascosto). */
  satb: boolean;
  /** Tracce di accompagnamento/batteria da creare, nell'ordine. */
  tracks: NewProjectTrackSpec[];
};

type Template = { id: string; name: string; config: NewProjectConfig };

const TEMPLATES_KEY = 'harmony-tutor.projectTemplates.v1';

function loadTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t: any) => t && typeof t.name === 'string' && t.config);
  } catch {
    return [];
  }
}

function persistTemplates(list: Template[]) {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list)); } catch { /* quota — ignora */ }
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreate: (config: NewProjectConfig) => void;
}

const NewProjectDialog: React.FC<Props> = ({ open, onCancel, onCreate }) => {
  const { t: tT } = useTranslation('toolbar');
  const { t: tUi } = useTranslation('ui');
  const instrName = useCallback((gm: number) => {
    const key = INSTRUMENTS.find(i => i.gm === gm)?.i18nKey;
    return key ? tT('instrument_' + key) : `GM ${gm}`;
  }, [tT]);

  const [satb, setSatb] = useState(true);
  const [tracks, setTracks] = useState<NewProjectTrackSpec[]>([]);
  const [pickInstr, setPickInstr] = useState<number>(INSTRUMENTS[0]?.gm ?? 0);
  const [templates, setTemplates] = useState<Template[]>([]);

  // Reset selezione + ricarica template a ogni apertura.
  useEffect(() => {
    if (!open) return;
    setSatb(true);
    setTracks([]);
    setPickInstr(INSTRUMENTS[0]?.gm ?? 0);
    setTemplates(loadTemplates());
  }, [open]);

  const addAcc = useCallback(() => {
    setTracks(prev => [...prev, { type: 'acc', instrumentId: pickInstr }]);
  }, [pickInstr]);

  const addDrums = useCallback(() => {
    setTracks(prev => [...prev, { type: 'drums' }]);
  }, []);

  const removeTrack = useCallback((idx: number) => {
    setTracks(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const currentConfig = useCallback((): NewProjectConfig => ({ satb, tracks }), [satb, tracks]);

  const handleSaveTemplate = useCallback(() => {
    const name = window.prompt('Nome del template:')?.trim();
    if (!name) return;
    setTemplates(prev => {
      // Sovrascrivi se esiste già un template con lo stesso nome.
      const without = prev.filter(t => t.name !== name);
      const next = [...without, { id: crypto.randomUUID(), name, config: currentConfig() }]
        .sort((a, b) => a.name.localeCompare(b.name));
      persistTemplates(next);
      return next;
    });
  }, [currentConfig]);

  const applyTemplate = useCallback((tpl: Template) => {
    setSatb(tpl.config.satb !== false);
    setTracks(Array.isArray(tpl.config.tracks) ? tpl.config.tracks : []);
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates(prev => {
      const next = prev.filter(t => t.id !== id);
      persistTemplates(next);
      return next;
    });
  }, []);

  if (!open) return null;

  const accCount = tracks.filter(t => t.type === 'acc').length;
  const drumCount = tracks.filter(t => t.type === 'drums').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg p-6 flex flex-col gap-5 text-sm text-gray-100">
        <div>
          <h2 className="text-lg font-semibold">Nuovo progetto</h2>
          <p className="text-gray-400 text-xs mt-1">{tUi('np_choose')}</p>
        </div>

        {/* SATB */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={satb} onChange={e => setSatb(e.target.checked)} className="accent-cyan-500 w-4 h-4" />
          <span>{tUi('np_satb_line')} <strong>SATB</strong> {tUi('np_choir')}</span>
        </label>

        {/* ACC / batteria builder */}
        <div className="flex flex-col gap-2">
          <div className="text-gray-300 font-medium">{tUi('np_acc_tracks')}</div>
          <div className="flex items-center gap-2">
            <select
              value={pickInstr}
              onChange={e => setPickInstr(Number(e.target.value))}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 flex-1 outline-none focus:border-cyan-400"
            >
              {INSTRUMENTS.map(i => (
                <option key={i.gm} value={i.gm}>{i.emoji} {instrName(i.gm)}</option>
              ))}
            </select>
            <button
              onClick={addAcc}
              className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white whitespace-nowrap"
            >{tUi('np_add_instrument')}</button>
            <button
              onClick={addDrums}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white whitespace-nowrap"
            >+ 🥁 Batteria</button>
          </div>

          {tracks.length > 0 && (
            <ul className="flex flex-col gap-1 mt-1">
              {tracks.map((t, idx) => (
                <li key={idx} className="flex items-center justify-between bg-slate-800/60 rounded px-2 py-1">
                  <span>
                    {t.type === 'drums'
                      ? '🥁 Batteria'
                      : `${instrumentEmoji(t.instrumentId)} ${instrName(t.instrumentId)}`}
                  </span>
                  <button
                    onClick={() => removeTrack(idx)}
                    className="text-gray-400 hover:text-red-400 px-1"
                    title="Rimuovi"
                  >✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Template */}
        <div className="flex flex-col gap-2 border-t border-gray-700 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 font-medium">Template</span>
            <button
              onClick={handleSaveTemplate}
              className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
            >{tUi('np_save_config')}</button>
          </div>
          {templates.length === 0 ? (
            <div className="text-xs text-gray-500">Nessun template salvato.</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {templates.map(tpl => (
                <li key={tpl.id} className="flex items-center justify-between bg-slate-800/60 rounded px-2 py-1">
                  <button
                    onClick={() => applyTemplate(tpl)}
                    className="text-left flex-1 hover:text-cyan-300"
                    title={tUi('np_load_template')}
                  >
                    {tpl.name}
                    <span className="text-gray-500 text-xs ml-2">
                      ({tpl.config.satb !== false ? 'SATB' : 'no SATB'}
                      {tpl.config.tracks?.length ? `, ${tpl.config.tracks.length} tracce` : ''})
                    </span>
                  </button>
                  <button
                    onClick={() => deleteTemplate(tpl.id)}
                    className="text-gray-400 hover:text-red-400 px-1"
                    title={tUi('np_delete_template')}
                  >🗑</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-500">
            {satb ? 'SATB' : 'nessun SATB'} · {accCount} strum. · {drumCount} batt.
          </span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white">{tUi('cancel')}</button>
            <button onClick={() => onCreate(currentConfig())} className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium">Crea progetto</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewProjectDialog;
