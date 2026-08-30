import React, { useEffect, useMemo, useState } from 'react';
import { RULE_TEXTS } from '../utils/ruleTexts';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { ANALYSIS_PROFILE_PRESETS, type AnalysisProfileBaseId } from '../utils/analysisProfiles';
import { usePreference } from '../preferences/usePreference';
import { PREFERENCE_DEFS, type PreferenceDef, type PreferenceSectionId, getPreferenceIdsBySection } from '../preferences/preferencesRegistry';
import { resetPreferences } from '../preferences/preferencesStore';
import type { HarmonyAnalysisFiltersPref } from '../preferences/preferencesRegistry';

export type PreferencesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: PreferenceSectionId;
  // MIDI output selection — mirrored into the MIDI tab (also stays in the toolbar).
  midiOutputs?: Array<{ id: string; name?: string }>;
  selectedMidiOutput?: { id: string; name?: string } | null;
  setSelectedMidiOutput?: (value: any | null) => void;
  onActivateMidi?: () => void | Promise<void>;
};

// ─── Consigli personalizzati – catalogo e editor inline ───
//
// L'ELENCO SI COSTRUISCE DAL CATALOGO VERO, non a mano. Prima era una tabella scritta a
// mano di 21 regole, e l'applicazione ne conosce 78: mancavano TUTTE le eccezioni, tutte le
// cadenze, tutti gli ornamenti e diciotto regole di condotta — comprese quelle aggiunte di
// recente, come l'accordo incompleto, la grafia incoerente e la falsa relazione di tritono.
// Una lista scritta a mano non cresce quando cresce il programma; questa sì.
// SOLO REGOLE ED ECCEZIONI, e il criterio è dell'utente: qui si personalizza il CONSIGLIO,
// cioè il commento su qualcosa che il pannello scrive e su cui un insegnante o un allievo
// possono avere un'opinione diversa. Una cadenza perfetta o un'anticipazione riconosciuta
// non sono giudizi: sono identificazioni, e non c'è niente da controbattere. Fuori anche
// perché sei sigle di ornamento non compaiono MAI — provate su 296 brani del corpus.
const FAMIGLIE: { chiave: string; test: (id: string) => boolean }[] = [
  { chiave: 'rule_sugg_group_exc', test: id => id.startsWith('EXC-') },
  { chiave: 'rule_sugg_group_rules', test: id => id.startsWith('R-') },
];
const ORDINE_FAMIGLIE = ['rule_sugg_group_rules', 'rule_sugg_group_exc'];
const famigliaDi = (id: string) => (FAMIGLIE.find(f => f.test(id))?.chiave ?? 'rule_sugg_group_rules');
const CATALOGO_REGOLE = Object.keys(RULE_TEXTS)
  .filter(id => FAMIGLIE.some(f => f.test(id)))
  .sort();

function RuleSuggestionsEditor() {
  const { t } = useTranslation('preferences');
  const { t: tRule } = useTranslation('rules');
  const { t: tRuleTexts } = useTranslation('ruleTexts');
  const [suggestions, setSuggestions] = usePreference<Record<string, string>>('analysis.ruleSuggestions');
  const suggs = (suggestions ?? {}) as Record<string, string>;
  const [expanded, setExpanded] = React.useState(false);

  const handleChange = (ruleId: string, text: string) => {
    const next = { ...suggs };
    if (text.trim()) { next[ruleId] = text; } else { delete next[ruleId]; }
    setSuggestions(next);
  };

  const customCount = Object.keys(suggs).filter(k => suggs[k]?.trim()).length;
  const [filtro, setFiltro] = React.useState('');

  /**
   * Il nome leggibile di una regola. I TITOLI NON STANNO NEL REGISTRO TypeScript — lì ci
   * sono solo `body` e `suggestion` — ma nel file di lingua `ruleTexts`. Cercandoli nel
   * posto sbagliato quarantotto regole su sessantanove si sarebbero presentate col solo
   * codice, che è esattamente il modo in cui l'app non deve parlare.
   */
  const nomeRegola = React.useCallback((ruleId: string): string => {
    const dalCatalogo = tRuleTexts(`${ruleId}.title`, { defaultValue: '' });
    if (dalCatalogo) return dalCatalogo;
    const breve = tRule(`rule.${ruleId}`, { defaultValue: '' });
    return breve || ruleId;
  }, [tRule, tRuleTexts]);

  // Le regole già commentate vengono in cima alla loro famiglia: sono quelle che si torna a
  // rileggere, e in un elenco di settantotto voci cercarle a scorrimento è una penitenza.
  const perFamiglia = React.useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const mappa = new Map<string, string[]>();
    for (const id of CATALOGO_REGOLE) {
      if (q && !id.toLowerCase().includes(q) && !nomeRegola(id).toLowerCase().includes(q)) continue;
      const f = famigliaDi(id);
      if (!mappa.has(f)) mappa.set(f, []);
      mappa.get(f)!.push(id);
    }
    for (const lista of mappa.values()) {
      lista.sort((a, b) => {
        const ca = suggs[a]?.trim() ? 0 : 1, cb = suggs[b]?.trim() ? 0 : 1;
        return ca !== cb ? ca - cb : nomeRegola(a).localeCompare(nomeRegola(b));
      });
    }
    return ORDINE_FAMIGLIE.filter(f => mappa.has(f)).map(f => [f, mappa.get(f)!] as const);
  }, [filtro, suggs, nomeRegola]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <button type="button" onClick={() => setExpanded(!expanded)}
        className="w-full text-left flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-100">{t('rule_suggestions_title', { defaultValue: 'Consigli personalizzati' })}</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {t('rule_suggestions_hint', { defaultValue: 'Personalizza il testo "Consiglio" per ogni regola. Le regole e le descrizioni non sono modificabili.' })}
            {customCount > 0 && <span className="ml-1 text-cyan-400">{t('rule_suggestions_count', { count: customCount, defaultValue: '({{count}} personalizzati)' })}</span>}
          </div>
        </div>
        <span className="text-slate-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3">
          <input
            type="text"
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            placeholder={t('rule_sugg_filter', { defaultValue: 'Filtra per nome o codice…' })}
            className="w-full mb-2 bg-slate-800 border border-slate-600 text-slate-100 text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
          />
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {perFamiglia.length === 0 && (
            <div className="text-xs text-slate-500 py-2">{t('rule_sugg_empty', { defaultValue: 'Nessuna regola col nome cercato.' })}</div>
          )}
          {perFamiglia.map(([famiglia, regole]) => (
            <React.Fragment key={famiglia}>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold pt-2 pb-0.5 sticky top-0 bg-slate-900/95">
                {t(famiglia, { defaultValue: famiglia })} <span className="text-slate-600">· {regole.length}</span>
              </div>
              {regole.map(ruleId => (
            <div key={ruleId} className="flex flex-col gap-0.5">
              <label className="text-xs text-slate-300 font-semibold select-none">
                {ruleId} — {nomeRegola(ruleId)}
              </label>
              <textarea
                className="bg-slate-800 border border-slate-600 text-slate-100 text-xs rounded px-2 py-1 resize-none focus:border-cyan-500 focus:outline-none"
                rows={2}
                placeholder={t('rule_suggestions_placeholder', { defaultValue: '(consiglio predefinito — lascia vuoto)' })}
                value={suggs[ruleId] || ''}
                onChange={(e) => handleChange(ruleId, e.target.value)}
              />
            </div>
              ))}
            </React.Fragment>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TAB_LABEL: Record<PreferenceSectionId, string> = {
  Editor: 'Editor',
  Analysis: 'Analisi',
  Render: 'Render',
  MIDI: 'MIDI',
  Export: 'Export',
  Debug: 'Debug',
};

const TAB_TRANSLATION_KEY: Record<PreferenceSectionId, string> = {
  Editor: 'tab_editor',
  Analysis: 'tab_analysis',
  Render: 'tab_render',
  MIDI: 'tab_midi',
  Export: 'tab_export',
  Debug: 'tab_debug',
};

const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'Editor',
  midiOutputs,
  selectedMidiOutput,
  setSelectedMidiOutput,
  onActivateMidi,
}) => {
  const { t } = useTranslation(['ui', 'preferences']);
  const tp = (key: string | undefined, fallback: string, opts?: Record<string, unknown>) =>
    key ? (t(`preferences:${key}`, { defaultValue: fallback, ...(opts || {}) }) as string) : fallback;
  const tabs = useMemo(() => (Object.keys(TAB_LABEL) as PreferenceSectionId[]), []);
  const [activeTab, setActiveTab] = useState<PreferenceSectionId>(initialTab);
  const currentLanguage = i18n.language === 'en' ? 'en' : 'it';
  const handleLanguageChange = (lng: 'en' | 'it') => { i18n.changeLanguage(lng); };

  // Preferenze che NON vanno nell'elenco generico, per due ragioni diverse:
  // · hanno un riquadro tutto loro più sopra (comparirebbero due volte, con un altro
  //   aspetto e un'altra etichetta);
  // · non sono impostazioni ma STATO INTERNO — la disposizione della barra si cambia
  //   trascinando i gruppi nella barra stessa, non da qui, e mostrarla come «Toolbar
  //   prefs (ordine)» invita solo a romperla.
  const CON_RIQUADRO_PROPRIO = new Set<string>(['editor.staffLineWeight', 'editor.toolbarPrefs']);

  const defsForTab = useMemo(() => {
    return PREFERENCE_DEFS
      .filter((d) => d.section === activeTab && !CON_RIQUADRO_PROPRIO.has(d.id))
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [activeTab]);

  const [profileBaseId, setProfileBaseId] = usePreference<AnalysisProfileBaseId>('analysis.profileBaseId');
  const [profileCustomized, setProfileCustomized] = usePreference<boolean>('analysis.profileCustomized');

  const [staffLineWeight, setStaffLineWeight] = usePreference<'sottile' | 'normale' | 'marcato'>('editor.staffLineWeight');
  const [showRomanAnalysis, setShowRomanAnalysis] = usePreference<boolean>('analysis.showRomanAnalysis');
  const [romanBassMode, setRomanBassMode] = usePreference<boolean>('analysis.romanBassMode');
  const [showSymbolAnalysis, setShowSymbolAnalysis] = usePreference<boolean>('analysis.showSymbolAnalysis');
  const [sequencesEnabled, setSequencesEnabled] = usePreference<boolean>('analysis.sequencesEnabled');
  const [enableInferredContexts, setEnableInferredContexts] = usePreference<boolean>('analysis.enableInferredContexts');
  const [harmonyLabelMinSpanBeats, setHarmonyLabelMinSpanBeats] = usePreference<number>('analysis.harmonyLabelMinSpanBeats');
  const [, setAnalysisFilters] = usePreference<HarmonyAnalysisFiltersPref>('analysis.filters');
  const [useStatisticalCorrection, setUseStatisticalCorrection] = usePreference<boolean>('analysis.useStatisticalCorrection');
  const [statisticalBiasThreshold, setStatisticalBiasThreshold] = usePreference<number>('analysis.statisticalBiasThreshold');
  const [enableLearnedOrnaments, setEnableLearnedOrnaments] = usePreference<boolean>('analysis.enableLearnedOrnaments');
  const [strictPassingNotes, setStrictPassingNotes] = usePreference<boolean>('analysis.strictPassingNotes');
  const [tonicizationCompact, setTonicizationCompact] = usePreference<boolean>('analysis.tonicizationCompact');
  const [chromaticModulation, setChromaticModulation] = usePreference<boolean>('analysis.chromaticModulation');
  const [cadentialPatterns, setCadentialPatterns] = usePreference<boolean>('analysis.cadentialPatterns');
  const [accHint, setAccHint] = usePreference<boolean>('analysis.accHint');

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

    // Keep the analysis panel filters in sync.
    try {
      setAnalysisFilters({
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
    const labelText = tp(def.i18nKey, def.label);
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
            <div className="text-sm font-semibold text-slate-100">{labelText}</div>
            <div className="text-[11px] text-slate-400">{t('default_label')}: {def.defaultValue ? t('default_on') : t('default_off')}</div>
          </div>
        </label>
      );
    }
    if (def.kind === 'enum') {
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <div className="text-sm font-semibold text-slate-100">{labelText}</div>
          <div className="mt-2 flex items-center gap-2">
            <select
              className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1"
              value={String(val)}
              onChange={(e) => setVal(String(e.target.value))}
            >
              {(def.options || []).map((o) => (
                <option key={o.value} value={o.value}>{tp(o.i18nKey, o.label)}</option>
              ))}
            </select>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">{t('default_label')}: {String(def.defaultValue)}</div>
        </div>
      );
    }
    if (def.kind === 'number') {
      const min = typeof def.min === 'number' ? def.min : undefined;
      const max = typeof def.max === 'number' ? def.max : undefined;
      const step = typeof def.step === 'number' ? def.step : 1;
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <div className="text-sm font-semibold text-slate-100">{labelText}</div>
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
          <div className="text-[11px] text-slate-400 mt-1">{t('default_label')}: {String(def.defaultValue)}</div>
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
          className="flex flex-col w-[860px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl"
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
              <div className="text-sm font-semibold text-slate-100">{t('preferences_title')}</div>
              <div className="text-[11px] text-slate-400">{t('preferences_subtitle')}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
                onClick={resetCurrentSection}
                title={t('reset_section_tooltip')}
                type="button"
              >
                {t('reset_section')}
              </button>
              <button
                className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
                onClick={onClose}
                title={t('close_tooltip')}
                type="button"
              >
                {t('close')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700 bg-slate-900/70">
            {tabs.map((tabId) => {
              const isActive = activeTab === tabId;
              return (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId)}
                  className={
                    'px-3 py-1 rounded-md text-xs font-semibold transition-colors ' +
                    (isActive ? 'bg-cyan-600 text-white' : 'text-slate-200 hover:bg-slate-700')
                  }
                >
                  {t(TAB_TRANSLATION_KEY[tabId])}
                </button>
              );
            })}
          </div>

          <div className="p-4 overflow-y-auto flex-1 min-h-0">
            {activeTab === 'Analysis' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">{tp('section_analysis_title', 'Analisi')}</div>
                <div className="text-sm text-slate-300">{tp('section_analysis_subtitle', 'Opzioni dell’analisi armonica.')}</div>

                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <div className="text-sm font-semibold text-slate-100">{tp('analysis_profile_title', 'Profilo analisi')}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {tp('analysis_profile_hint', 'Un profilo è un preset (non blocca combinazioni). Se modifichi manualmente i toggle, il profilo diventa “Custom”.')}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-slate-300">{tp('analysis_profile_select_label', 'Profilo:')}</label>
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
                      <option value="academic">{tp('opt_profile_academic', ANALYSIS_PROFILE_PRESETS.academic.label)}</option>
                      <option value="symbols">{tp('opt_profile_symbols', ANALYSIS_PROFILE_PRESETS.symbols.label)}</option>
                      <option value="custom">{tp('analysis_profile_custom', 'Custom')}</option>
                    </select>

                    <button
                      className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        if (!profileBaseId) return;
                        applyAnalysisProfileBase(profileBaseId);
                      }}
                      disabled={!profileBaseId}
                      title={tp('analysis_profile_apply_preset_tooltip', 'Re-applica il preset del profilo base (ripristina defaults)')}
                      type="button"
                    >
                      {tp('analysis_profile_apply_preset', 'Applica preset')}
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
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_show_roman', 'Mostra numeri romani')}</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!romanBassMode}
                    onChange={(e) => setRomanBassMode(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_roman_bass_mode', 'Numerazione scuola romana (grado del basso)')}</div>
                    <div className="text-[11px] text-slate-400">{tp('pref_analysis_roman_bass_mode_hint', 'Il numero romano indica il grado della nota reale al basso (sempre maiuscolo); l’accordo è espresso dalle cifre. Richiede “Mostra numeri romani” attivo.')}</div>
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
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_show_symbols', 'Mostra sigle accordi')}</div>
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
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_sequences_label', 'Rileva sequenze (progressioni)')}</div>
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
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_enable_inferred_contexts', 'Inferisci contesti (modulazioni) automaticamente')}</div>
                    <div className="text-xs text-slate-400">
                      {tp('pref_analysis_enable_inferred_contexts_hint', 'Se attivo, l’app può applicare cambi di tonalità inferiti per far tornare Romani come V7 dentro una modulazione (es. sezione in Eb/Cm). Non sovrascrive i contesti manuali: se hai marker manuali, quelli restano prioritari.')}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!useStatisticalCorrection}
                    onChange={(e) => setUseStatisticalCorrection(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_statistical_correction', 'Correzione statistica progressioni')}</div>
                    <div className="text-xs text-slate-400">
                      {tp('pref_analysis_statistical_correction_hint', 'Usa le statistiche estratte dagli esercizi per correggere etichette romane improbabili. Richiede un corpus ampio di esercizi.')}
                    </div>
                  </div>
                </label>

                {!!useStatisticalCorrection && (
                  <div className="ml-6 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <div className="text-sm font-semibold text-slate-100 mb-1">{tp('pref_analysis_statistical_bias_threshold', 'Soglia bias statistico')}</div>
                    <div className="text-xs text-slate-400 mb-2">
                      {tp('pref_analysis_statistical_bias_threshold_hint', 'R14 interviene quando la differenza di score tra i due migliori candidati è inferiore a questa soglia.')}
                    </div>
                    <select
                      className="bg-slate-800 text-slate-100 text-sm rounded px-2 py-1 border border-slate-600"
                      value={statisticalBiasThreshold ?? 2}
                      onChange={(e) => setStatisticalBiasThreshold(Number(e.target.value))}
                    >
                      <option value={1}>{tp('opt_bias_conservative', 'Conservativo (1)')}</option>
                      <option value={2}>{tp('opt_bias_moderate', 'Moderato (2)')}</option>
                      <option value={4}>{tp('opt_bias_aggressive', 'Aggressivo (4)')}</option>
                    </select>
                  </div>
                )}

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!enableLearnedOrnaments}
                    onChange={(e) => setEnableLearnedOrnaments(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_learned_ornaments', 'Ornamenti appresi')}</div>
                    <div className="text-xs text-slate-400">
                      {tp('pref_analysis_learned_ornaments_hint', 'Rileva automaticamente gli ornamenti basandosi sui pattern appresi dalle correzioni manuali.')}
                    </div>
                  </div>
                </label>

                  <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!strictPassingNotes}
                      onChange={(e) => setStrictPassingNotes(!!e.target.checked)}
                    />
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_strict_passing_notes', 'Regola stretta note di passaggio')}</div>
                      <div className="text-xs text-slate-400">
                        {tp('pref_analysis_strict_passing_notes_hint', 'Applica i guard più severi sulla durata e sul profilo ornamentale delle note di passaggio. Disattivala per tornare rapidamente a un comportamento più permissivo.')}
                      </div>
                    </div>
                  </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!tonicizationCompact}
                    onChange={(e) => setTonicizationCompact(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_tonicization_compact', 'Tonicizzazioni compatte')}</div>
                    <div className="text-xs text-slate-400">
                      {tp('pref_analysis_tonicization_compact_hint', 'Mostra [in IV]: ii → V → I anziché ii/IV → V/IV → I/IV. Ideale per brani con valori veloci.')}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!cadentialPatterns}
                    onChange={(e) => setCadentialPatterns(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_cadential_patterns', 'Riconoscimento pattern cadenzali')}</div>
                    <div className="text-xs text-slate-400">
                      {tp('pref_analysis_cadential_patterns_hint', 'Rileva automaticamente cadenze (ii–V–I, IV–V–I, ecc.) e inietta tonicizzazioni temporanee verso la tonalità target.')}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!chromaticModulation}
                    onChange={(e) => setChromaticModulation(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_chromatic_modulation', 'Modulazione cromatica (sperimentale)')}</div>
                    <div className="text-xs text-slate-400">
                      {tp('pref_analysis_chromatic_modulation_hint', 'Rileva modulazioni prive di preparazione cadenzale analizzando il contenuto cromatico su finestre di ≥ 3 misure consecutive.')}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!accHint}
                    onChange={(e) => setAccHint(!!e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{tp('pref_analysis_acc_hint', 'Hint armonica dall\'accompagnamento')}</div>
                    <div className="text-xs text-slate-400">
                      {tp('pref_analysis_acc_hint_description', 'Usa le note delle tracce ACC (non mutate) per disambiguare l\'identificazione degli accordi SATB. Il basso ACC è il segnale più forte. Senza tracce ACC, o se disabilitato, l\'analisi è identica a prima.')}
                    </div>
                  </div>
                </label>

                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <div className="text-sm font-semibold text-slate-100">{tp('label_min_span_section_title', 'Filtro anti-rumore (etichette)')}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {tp('label_min_span_section_hint', 'Riduce l’affollamento campionando le etichette su una griglia ritmica (utile con semicrome e doppie note di passaggio). Non modifica l’analisi: è solo un filtro di visualizzazione.')}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-slate-300">{tp('label_min_span_select_label', 'Mostra label solo se durano almeno:')}</label>
                    <select
                      className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1"
                      value={Number(harmonyLabelMinSpanBeats ?? 0)}
                      onChange={(e) => setHarmonyLabelMinSpanBeats(Number(e.target.value) || 0)}
                    >
                      <option value={0}>{tp('opt_label_span_off', 'Off (tutte)')}</option>
                      <option value={0.25}>{tp('opt_label_span_16', '1/16 (semicroma)')}</option>
                      <option value={0.5}>{tp('opt_label_span_8', '1/8 (croma)')}</option>
                      <option value={1}>{tp('opt_label_span_4', '1/4 (semiminima)')}</option>
                      <option value={2}>{tp('opt_label_span_2', '1/2 (minima)')}</option>
                    </select>
                  </div>
                </div>

                {/* ─── Consigli personalizzati per regole ─── */}
                <RuleSuggestionsEditor />

              </div>
            )}

            {activeTab !== 'Analysis' && (
              <div className="space-y-2">
                {activeTab === 'Editor' && (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 mb-3">
                    <div className="text-sm font-semibold text-slate-100">
                      {tp('staff_line_weight_title', 'Corpo delle righe del pentagramma')}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {tp('staff_line_weight_hint', 'Le righe del pentagramma partono da un grigio chiaro: qui si scuriscono, e si ingrossano appena. Serve sugli schermi molto densi e nella stampa. Il guadagno viene dal contrasto più che dallo spessore: una riga troppo grossa schiaccia le teste delle note.')}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      {([
                        ['sottile', tp('staff_line_thin', 'Sottile')],
                        ['normale', tp('staff_line_normal', 'Normale')],
                        ['marcato', tp('staff_line_bold', 'Marcato')],
                      ] as const).map(([valore, etichetta]) => (
                        <button
                          key={valore}
                          type="button"
                          onClick={() => setStaffLineWeight(valore)}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${
                            staffLineWeight === valore
                              ? 'bg-cyan-600 text-white font-semibold'
                              : 'text-gray-200 hover:bg-slate-700'
                          }`}
                        >
                          {etichetta}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {activeTab === 'Editor' && (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <div className="text-sm font-semibold text-slate-100">{t('language_section_title')}</div>
                    <div className="text-xs text-slate-400 mt-1">{t('language_section_hint')}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-slate-300">{t('language')}:</label>
                      <select
                        className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1"
                        value={currentLanguage}
                        onChange={(e) => handleLanguageChange((e.target.value === 'it' ? 'it' : 'en'))}
                      >
                        <option value="en">{t('language_english')}</option>
                        <option value="it">{t('language_italian')}</option>
                      </select>
                    </div>
                  </div>
                )}
                {activeTab === 'MIDI' && setSelectedMidiOutput && (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <div className="text-sm font-semibold text-slate-100">{tp('midi_output_title', 'Uscita MIDI')}</div>
                    <div className="text-xs text-slate-400 mt-1">{tp('midi_output_hint', 'Scegli dove inviare il playback: audio interno o un dispositivo MIDI esterno. È la stessa impostazione del menu nella toolbar.')}</div>
                    <div className="mt-2 space-y-1">
                      <button
                        type="button"
                        onClick={() => setSelectedMidiOutput(null)}
                        className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${selectedMidiOutput ? 'text-gray-200 hover:bg-slate-700' : 'bg-cyan-600 text-white'}`}
                      >
                        <span>{tp('midi_internal_audio', 'Audio interno')}</span>
                        {!selectedMidiOutput && <span className="text-[11px]">✓</span>}
                      </button>
                      {(midiOutputs || []).length === 0 ? (
                        <button
                          type="button"
                          onClick={() => { void onActivateMidi?.(); }}
                          className="w-full rounded-md px-2 py-1 text-left text-xs text-gray-200 hover:bg-slate-700 transition-colors"
                        >
                          {tp('midi_activate', 'Attiva MIDI / cerca dispositivi…')}
                        </button>
                      ) : (
                        (midiOutputs || []).map((output) => {
                          const isSelected = selectedMidiOutput?.id === output.id;
                          return (
                            <button
                              key={output.id}
                              type="button"
                              onClick={() => setSelectedMidiOutput(output)}
                              className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${isSelected ? 'bg-cyan-600 text-white' : 'text-gray-200 hover:bg-slate-700'}`}
                              title={output.name}
                            >
                              <span className="truncate">{output.name}</span>
                              {isSelected && <span className="text-[11px]">✓</span>}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
                <div className="text-sm text-slate-300">{t('tab_settings_for', { tab: t(TAB_TRANSLATION_KEY[activeTab]) })}</div>
                {defsForTab.length === 0 ? (
                  <div className="text-xs text-slate-400">{t('tab_no_preferences')}</div>
                ) : (
                  defsForTab.map((def) => (
                    <PreferenceRow key={def.id} def={def} />
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-700 bg-slate-900/60">
            <div className="text-[11px] text-slate-400">{t('preferences_saved_locally_note')}</div>
            <button
              className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
              onClick={resetAll}
              title={t('reset_all_tooltip')}
              type="button"
            >
              {t('reset_all')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
