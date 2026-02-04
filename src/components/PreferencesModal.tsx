import React, { useEffect, useMemo, useState } from 'react';
import { ANALYSIS_PROFILE_PRESETS, type AnalysisProfileBaseId } from '../utils/analysisProfiles';
import { usePreference } from '../preferences/usePreference';
import { PREFERENCE_DEFS, type PreferenceDef, type PreferenceSectionId, getPreferenceIdsBySection } from '../preferences/preferencesRegistry';
import { resetPreferences } from '../preferences/preferencesStore';
import { HARMONY_ANALYSIS_FILTERS_KEY } from '../storage/storageKeys';
import { setJSON } from '../storage/localStorage';

export type PreferencesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: PreferenceSectionId;
};

const TAB_LABEL: Record<PreferenceSectionId, string> = {
  Editor: 'Editor',
  Analysis: 'Analisi',
  Render: 'Render',
  MIDI: 'MIDI',
  Export: 'Export',
  Debug: 'Debug',
};

const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'Editor',
}) => {
  const tabs = useMemo(() => (Object.keys(TAB_LABEL) as PreferenceSectionId[]), []);
  const [activeTab, setActiveTab] = useState<PreferenceSectionId>(initialTab);

  const defsForTab = useMemo(() => {
    return PREFERENCE_DEFS
      .filter((d) => d.section === activeTab)
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [activeTab]);

  const [profileBaseId, setProfileBaseId] = usePreference<AnalysisProfileBaseId>('analysis.profileBaseId');
  const [profileCustomized, setProfileCustomized] = usePreference<boolean>('analysis.profileCustomized');

  const [showRomanAnalysis, setShowRomanAnalysis] = usePreference<boolean>('analysis.showRomanAnalysis');
  const [showSymbolAnalysis, setShowSymbolAnalysis] = usePreference<boolean>('analysis.showSymbolAnalysis');
  const [sequencesEnabled, setSequencesEnabled] = usePreference<boolean>('analysis.sequencesEnabled');
  const [enableInferredContexts, setEnableInferredContexts] = usePreference<boolean>('analysis.enableInferredContexts');
  const [harmonyLabelMinSpanBeats, setHarmonyLabelMinSpanBeats] = usePreference<number>('analysis.harmonyLabelMinSpanBeats');

  const analysisProfileSelectionValue = useMemo(() => {
    return profileCustomized ? 'custom' : profileBaseId;
  }, [profileBaseId, profileCustomized]);

  const applyAnalysisProfileBase = (baseId: AnalysisProfileBaseId) => {
    const preset = ANALYSIS_PROFILE_PRESETS[baseId]?.preset;
    if (!preset) return;

    setProfileBaseId(baseId);
    setProfileCustomized(false);
    setShowRomanAnalysis(!!preset.showRomanAnalysis);
    setShowSymbolAnalysis(!!preset.showSymbolAnalysis);
    setSequencesEnabled(!!preset.sequencesEnabled);

    // Keep the analysis panel filters in sync (legacy storage + event).
    try {
      setJSON(HARMONY_ANALYSIS_FILTERS_KEY, {
        showError: preset.analysisFilters.showError,
        showWarning: preset.analysisFilters.showWarning,
        showException: preset.analysisFilters.showException,
        disabledRuleIds: {},
      });
      window.dispatchEvent(
        new CustomEvent('harmony-analysis-filters-changed', {
          detail: {
            showError: preset.analysisFilters.showError,
            showWarning: preset.analysisFilters.showWarning,
            showException: preset.analysisFilters.showException,
            disabledRuleIds: {},
          },
        })
      );
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    // Auto-maintain “custom” state when the three core toggles diverge from the base preset.
    try {
      const preset = ANALYSIS_PROFILE_PRESETS[profileBaseId]?.preset;
      if (!preset) return;
      const matches =
        !!preset.showRomanAnalysis === !!showRomanAnalysis &&
        !!preset.showSymbolAnalysis === !!showSymbolAnalysis &&
        !!preset.sequencesEnabled === !!sequencesEnabled;
      setProfileCustomized(!matches);
    } catch {
      // ignore
    }
  }, [profileBaseId, sequencesEnabled, setProfileCustomized, showRomanAnalysis, showSymbolAnalysis]);

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

  const resetCurrentSection = () => {
    try {
      resetPreferences(getPreferenceIdsBySection(activeTab));
    } catch {
      // ignore
    }
  };

  const resetAll = () => {
    try {
      resetPreferences(PREFERENCE_DEFS.map((d) => d.id));
    } catch {
      // ignore
    }
  };

  const PreferenceRow: React.FC<{ def: PreferenceDef<any> }> = ({ def }) => {
    const [val, setVal] = usePreference<any>(def.id);
    if (def.kind === 'boolean') {
      return (
        <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={!!val}
            onChange={(e) => setVal(!!e.target.checked)}
          />
          <div>
            <div className="text-sm font-semibold text-slate-100">{def.label}</div>
            <div className="text-[11px] text-slate-400">Default: {def.defaultValue ? 'ON' : 'OFF'}</div>
          </div>
        </label>
      );
    }
    if (def.kind === 'enum') {
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <div className="text-sm font-semibold text-slate-100">{def.label}</div>
          <div className="mt-2 flex items-center gap-2">
            <select
              className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1"
              value={String(val)}
              onChange={(e) => setVal(String(e.target.value))}
            >
              {(def.options || []).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Default: {String(def.defaultValue)}</div>
        </div>
      );
    }
    if (def.kind === 'number') {
      const min = typeof def.min === 'number' ? def.min : undefined;
      const max = typeof def.max === 'number' ? def.max : undefined;
      const step = typeof def.step === 'number' ? def.step : 1;
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <div className="text-sm font-semibold text-slate-100">{def.label}</div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              className="w-28 bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1"
              value={Number(val)}
              min={min}
              max={max}
              step={step}
              onChange={(e) => setVal(Number(e.target.value) || 0)}
            />
            {(min != null || max != null) && (
              <span className="text-[11px] text-slate-400">
                {min != null ? `min ${min}` : ''}{min != null && max != null ? ' · ' : ''}{max != null ? `max ${max}` : ''}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Default: {String(def.defaultValue)}</div>
        </div>
      );
    }
    return null;
  };

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
            <div className="flex items-center gap-2">
              <button
                className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
                onClick={resetCurrentSection}
                title="Reset preferenze della sezione corrente"
                type="button"
              >
                Reset sezione
              </button>
              <button
                className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
                onClick={onClose}
                title="Chiudi (Esc)"
                type="button"
              >
                Chiudi
              </button>
            </div>
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
            {activeTab === 'Analysis' && (
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
                      value={String(analysisProfileSelectionValue ?? 'academic')}
                      onChange={(e) => {
                        const v = String(e.target.value || '').trim();
                        if (v === 'custom') {
                          setProfileCustomized(true);
                          return;
                        }
                        if (v === 'academic' || v === 'symbols') {
                          applyAnalysisProfileBase(v as AnalysisProfileBaseId);
                        }
                      }}
                    >
                      <option value="academic">{ANALYSIS_PROFILE_PRESETS.academic.label}</option>
                      <option value="symbols">{ANALYSIS_PROFILE_PRESETS.symbols.label}</option>
                      <option value="custom">Custom</option>
                    </select>

                    <button
                      className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        if (!profileBaseId) return;
                        applyAnalysisProfileBase(profileBaseId);
                      }}
                      disabled={!profileBaseId}
                      title="Re-applica il preset del profilo base (ripristina defaults)"
                      type="button"
                    >
                      Applica preset
                    </button>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-400">
                    {(() => {
                      const base = profileBaseId ?? 'academic';
                      return ANALYSIS_PROFILE_PRESETS[base]?.description ?? '';
                    })()}
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!showRomanAnalysis}
                    onChange={(e) => setShowRomanAnalysis(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Mostra numeri romani</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!showSymbolAnalysis}
                    onChange={(e) => setShowSymbolAnalysis(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Mostra sigle accordi</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!sequencesEnabled}
                    onChange={(e) => setSequencesEnabled(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Rileva sequenze (progressioni)</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!enableInferredContexts}
                    onChange={(e) => setEnableInferredContexts(!!e.target.checked)}
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
                      onChange={(e) => setHarmonyLabelMinSpanBeats(Number(e.target.value) || 0)}
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

            {activeTab !== 'Analysis' && (
              <div className="space-y-2">
                <div className="text-sm text-slate-300">Impostazioni {TAB_LABEL[activeTab]}.</div>
                {defsForTab.length === 0 ? (
                  <div className="text-xs text-slate-400">(Nessuna preferenza in questa sezione per ora.)</div>
                ) : (
                  defsForTab.map((def) => (
                    <PreferenceRow key={def.id} def={def} />
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-700 bg-slate-900/60">
            <div className="text-[11px] text-slate-400">Le preferenze sono salvate localmente.</div>
            <button
              className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
              onClick={resetAll}
              title="Reset di tutte le preferenze ai default"
              type="button"
            >
              Reset tutto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
