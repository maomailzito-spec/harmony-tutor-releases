import React, { useEffect, useMemo, useState } from 'react';
import { ANALYSIS_PROFILE_PRESETS, AnalysisProfileBaseId, AnalysisProfileSelectionValue } from '../utils/analysisProfiles';

type PreferencesTabId = 'editor' | 'midi' | 'font' | 'analysis';

export type PreferencesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: PreferencesTabId;
  analysisProfileValue?: AnalysisProfileSelectionValue;
  analysisProfileBaseId?: AnalysisProfileBaseId;
  onApplyAnalysisProfileBase?: (baseId: AnalysisProfileBaseId) => void;
  onMarkAnalysisProfileCustomized?: () => void;
  enableInferredContexts?: boolean;
  onToggleEnableInferredContexts?: (next: boolean) => void;
  harmonyLabelMinSpanBeats?: number;
  onChangeHarmonyLabelMinSpanBeats?: (next: number) => void;
};

const TAB_LABEL: Record<PreferencesTabId, string> = {
  editor: 'Editor',
  midi: 'MIDI',
  font: 'Font / Render',
  analysis: 'Analisi',
};

const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'editor',
  analysisProfileValue,
  analysisProfileBaseId,
  onApplyAnalysisProfileBase,
  onMarkAnalysisProfileCustomized,
  enableInferredContexts,
  onToggleEnableInferredContexts,
  harmonyLabelMinSpanBeats,
  onChangeHarmonyLabelMinSpanBeats,
}) => {
  const tabs = useMemo(() => (Object.keys(TAB_LABEL) as PreferencesTabId[]), []);
  const [activeTab, setActiveTab] = useState<PreferencesTabId>(initialTab);

  // Draggable modal position (screen coords).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [drag, setDrag] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    // Center on open (but keep last position while open).
    setPos(prev => {
      if (prev) return prev;
      try {
        const w = 860;
        const h = 560;
        const x = Math.max(12, Math.round((window.innerWidth - w) / 2));
        const y = Math.max(12, Math.round((window.innerHeight - h) / 2));
        return { x, y };
      } catch {
        return { x: 12, y: 12 };
      }
    });
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    if (!isDragging || !drag) return;

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const nextX = drag.originX + dx;
      const nextY = drag.originY + dy;

      // Rough clamp (keeps header reachable).
      const margin = 12;
      const maxX = Math.max(margin, window.innerWidth - margin - 240);
      const maxY = Math.max(margin, window.innerHeight - margin - 80);
      setPos({ x: clamp(nextX, margin, maxX), y: clamp(nextY, margin, maxY) });
    };

    const onUp = () => {
      setIsDragging(false);
      setDrag(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, isDragging, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[11000]">
      <div className="absolute inset-0 bg-black/40" onMouseDown={onClose} />
      <div className="absolute inset-0" onMouseDown={onClose}>
        <div
          className="w-[860px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
          style={pos ? { position: 'absolute', left: pos.x, top: pos.y, userSelect: isDragging ? 'none' : 'auto' } : { position: 'absolute', left: 12, top: 12 }}
          role="dialog"
          aria-modal="true"
          aria-label="Preferenze"
        >
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 cursor-move"
            onMouseDown={(e) => {
              // Drag only with primary button.
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              const cur = pos ?? { x: 12, y: 12 };
              setIsDragging(true);
              setDrag({ startX: e.clientX, startY: e.clientY, originX: cur.x, originY: cur.y });
            }}
          >
            <div>
              <div className="text-sm font-semibold text-slate-100">Preferenze</div>
              <div className="text-[11px] text-slate-400">Raggruppa impostazioni non essenziali alla toolbar.</div>
            </div>
            <button
              className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
              onClick={onClose}
              title="Chiudi (Esc)"
            >
              Chiudi
            </button>
          </div>

          <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700 bg-slate-900/70">
            {tabs.map((t) => {
              const isActive = activeTab === t;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={
                    'px-3 py-1 rounded-md text-xs font-semibold transition-colors ' +
                    (isActive ? 'bg-cyan-600 text-white' : 'text-slate-200 hover:bg-slate-700')
                  }
                >
                  {TAB_LABEL[t]}
                </button>
              );
            })}
          </div>

          <div className="p-4 overflow-y-auto max-h-[calc(100vh-10rem)]">
            {activeTab === 'editor' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">Editor</div>
                <div className="text-sm text-slate-300">
                  Placeholder: qui confluiranno opzioni dell’editor che oggi sono sparse tra toolbar e menu.
                </div>
                <div className="text-xs text-slate-400">
                  Nota: per ora questa finestra non sposta né modifica alcuna funzione esistente.
                </div>
              </div>
            )}

            {activeTab === 'midi' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">MIDI</div>
                <div className="text-sm text-slate-300">
                  Placeholder: qui confluiranno le impostazioni MIDI (input/output, step input, canali, ecc.).
                </div>
                <div className="text-xs text-slate-400">Il pannello MIDI attuale resta invariato.</div>
              </div>
            )}

            {activeTab === 'font' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">Font / Render</div>
                <div className="text-sm text-slate-300">
                  Placeholder: opzioni di resa grafica, font del titolo, dimensioni, ecc.
                </div>
              </div>
            )}

            {activeTab === 'analysis' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">Analisi</div>
                <div className="text-sm text-slate-300">Opzioni dell’analisi armonica.</div>

                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <div className="text-sm font-semibold text-slate-100">Profilo analisi</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Un profilo è un preset (non blocca combinazioni). Se modifichi manualmente i toggle, il profilo diventa “Custom”.
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-slate-300">Profilo:</label>
                    <select
                      className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1"
                      value={String(analysisProfileValue ?? 'academic')}
                      onChange={(e) => {
                        const v = String(e.target.value || '').trim();
                        if (v === 'custom') {
                          onMarkAnalysisProfileCustomized?.();
                          return;
                        }
                        if (v === 'academic' || v === 'symbols') {
                          onApplyAnalysisProfileBase?.(v as AnalysisProfileBaseId);
                        }
                      }}
                      disabled={!onApplyAnalysisProfileBase && !onMarkAnalysisProfileCustomized}
                    >
                      <option value="academic">{ANALYSIS_PROFILE_PRESETS.academic.label}</option>
                      <option value="symbols">{ANALYSIS_PROFILE_PRESETS.symbols.label}</option>
                      <option value="custom">Custom</option>
                    </select>

                    <button
                      className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        if (!analysisProfileBaseId) return;
                        onApplyAnalysisProfileBase?.(analysisProfileBaseId);
                      }}
                      disabled={!analysisProfileBaseId || !onApplyAnalysisProfileBase}
                      title="Re-applica il preset del profilo base (ripristina defaults)"
                      type="button"
                    >
                      Applica preset
                    </button>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-400">
                    {(() => {
                      const base = analysisProfileBaseId ?? 'academic';
                      return ANALYSIS_PROFILE_PRESETS[base]?.description ?? '';
                    })()}
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!enableInferredContexts}
                    onChange={(e) => onToggleEnableInferredContexts?.(!!e.target.checked)}
                    disabled={!onToggleEnableInferredContexts}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Inferisci contesti (modulazioni) automaticamente</div>
                    <div className="text-xs text-slate-400">
                      Se attivo (e se non hai inserito contesti manuali), l’app può applicare cambi di tonalità inferiti per far tornare Romani come V7 dentro una modulazione (es. sezione in Eb/Cm).
                      Può però alterare alcune etichette anche in presenza di tonicizzazioni brevi.
                    </div>
                  </div>
                </label>

                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <div className="text-sm font-semibold text-slate-100">Filtro anti-rumore (etichette)</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Riduce l’affollamento campionando le etichette su una griglia ritmica (utile con semicrome e doppie note di passaggio).
                    Non modifica l’analisi: è solo un filtro di visualizzazione.
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-slate-300">Mostra label solo se durano almeno:</label>
                    <select
                      className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1"
                      value={Number(harmonyLabelMinSpanBeats ?? 0)}
                      onChange={(e) => onChangeHarmonyLabelMinSpanBeats?.(Number(e.target.value) || 0)}
                      disabled={!onChangeHarmonyLabelMinSpanBeats}
                    >
                      <option value={0}>Off (tutte)</option>
                      <option value={0.25}>1/16 (semicroma)</option>
                      <option value={0.5}>1/8 (croma)</option>
                      <option value={1}>1/4 (semiminima)</option>
                      <option value={2}>1/2 (minima)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
