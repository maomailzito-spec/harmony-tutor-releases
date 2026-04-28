import {
  ENABLE_INFERRED_CONTEXTS_PREF_KEY,
  ENGRAVING_MODE_KEY,
  HARMONY_LABEL_MIN_SPAN_BEATS_KEY,
  HARMONY_SEQUENCES_ENABLED_KEY,
  STAFF_SYSTEM_MODE_KEY,
  SELECT_ONLY_CURRENT_VOICE_KEY,
  SHOW_HARMONY_DEBUG_KEY,
  SHOW_MEASURE_NUMBERS_KEY,
  SHOW_ROMAN_ANALYSIS_KEY,
  SHOW_QUICK_INSERT_BAR_KEY,
  SHOW_SYMBOL_ANALYSIS_KEY,
  SHOW_VOICE_COLORS_KEY,
  TOOLBAR_HIDDEN_KEY,
  HARMONY_ANALYSIS_PROFILE_CUSTOMIZED_KEY,
  HARMONY_ANALYSIS_PROFILE_DEFAULT_KEY,
  HARMONY_ANALYSIS_FILTERS_KEY,
  TOOLBAR_PREFS_KEY,
  EXPORT_INCLUDE_TITLE_KEY,
  ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY,
  AUTO_SAVE_INTERVAL_KEY,
  ANALYSIS_STATISTICAL_CORRECTION_KEY,
  STATISTICAL_BIAS_THRESHOLD_KEY,
  ENABLE_LEARNED_ORNAMENTS_KEY,
  ANALYSIS_STRICT_PASSING_NOTES_KEY,
  TONICIZATION_COMPACT_KEY,
  CHROMATIC_MODULATION_KEY,
  CADENTIAL_PATTERN_RECOGNITION_KEY,
  RULE_SUGGESTIONS_KEY,
  MIDI_EXPORT_TYPE_KEY,
} from '../storage/storageKeys';

export type PreferenceSectionId = 'Editor' | 'Analysis' | 'Render' | 'MIDI' | 'Export' | 'Debug';

export type PreferenceId =
  | 'editor.staffSystemMode'
  | 'editor.toolbarHidden'
  | 'editor.toolbarPrefs'
  | 'editor.showMeasureNumbers'
  | 'editor.showVoiceColors'
  | 'editor.showQuickInsertBar'
  | 'editor.selectOnlyCurrentVoice'
  | 'editor.autoSaveInterval'
  | 'render.engravingMode'
  | 'analysis.showRomanAnalysis'
  | 'analysis.showSymbolAnalysis'
  | 'analysis.profileBaseId'
  | 'analysis.profileCustomized'
  | 'analysis.sequencesEnabled'
  | 'analysis.enableInferredContexts'
  | 'analysis.harmonyLabelMinSpanBeats'
  | 'analysis.filters'
  | 'analysis.useStatisticalCorrection'
  | 'analysis.statisticalBiasThreshold'
  | 'analysis.enableLearnedOrnaments'
  | 'analysis.strictPassingNotes'
  | 'export.includeTitle'
  | 'debug.showHarmonyDebug'
  | 'analysis.tonicizationCompact'
  | 'analysis.cadentialPatterns'
  | 'analysis.ruleSuggestions'
  | 'analysis.chromaticModulation'
  | 'midi.exportType';

export type PreferenceDef<T> = {
  id: PreferenceId;
  section: PreferenceSectionId;
  label: string;
  i18nKey?: string;
  description?: string;
  descriptionI18nKey?: string;
  storageKey: string;
  defaultValue: T;
  kind: 'boolean' | 'enum' | 'number' | 'json';
  options?: Array<{ value: string; label: string; i18nKey?: string }>;
  min?: number;
  max?: number;
  step?: number;
  parse: (raw: string | null) => T;
  serialize: (value: T) => string;
};

export type HarmonyAnalysisFiltersPref = {
  showError: boolean;
  showWarning: boolean;
  showException: boolean;
  showChromatic: boolean;
  disabledRuleIds: Record<string, boolean>;
};

export type ToolbarPrefs = {
  order: string[];
};

const parseBool = (raw: string | null, fallback: boolean): boolean => {
  try {
    const v = String(raw ?? '').trim().toLowerCase();
    if (!v) return fallback;
    if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    return fallback;
  } catch {
    return fallback;
  }
};

const parseNumber = (raw: string | null, fallback: number): number => {
  try {
    if (raw == null) return fallback;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
};

export type StaffSystemModePref = 'grandstaff' | 'treble_only' | 'satb_ancient';
export type EngravingModePref = 'legacy' | 'enhanced';

export const PREFERENCES: Record<PreferenceId, PreferenceDef<any>> = {
  'editor.staffSystemMode': {
    id: 'editor.staffSystemMode',
    section: 'Editor',
    label: 'Layout righi (grandstaff / SATB / treble-only)',
    i18nKey: 'pref_editor_staff_system_mode',
    storageKey: STAFF_SYSTEM_MODE_KEY,
    defaultValue: 'grandstaff' as StaffSystemModePref,
    kind: 'enum',
    options: [
      { value: 'grandstaff', label: 'Grand staff', i18nKey: 'opt_staff_grandstaff' },
      { value: 'satb_ancient', label: 'SATB (chiavi antiche)', i18nKey: 'opt_staff_satb' },
      { value: 'treble_only', label: 'Treble only', i18nKey: 'opt_staff_treble' },
    ],
    parse: (raw) => {
      const v = String(raw ?? '').trim();
      return (v === 'grandstaff' || v === 'treble_only' || v === 'satb_ancient') ? v : 'grandstaff';
    },
    serialize: (value: StaffSystemModePref) => String(value),
  },

  'editor.toolbarHidden': {
    id: 'editor.toolbarHidden',
    section: 'Editor',
    label: 'Nascondi toolbar',
    i18nKey: 'pref_editor_toolbar_hidden',
    storageKey: TOOLBAR_HIDDEN_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'editor.toolbarPrefs': {
    id: 'editor.toolbarPrefs',
    section: 'Editor',
    label: 'Toolbar prefs (ordine)',
    i18nKey: 'pref_editor_toolbar_prefs',
    storageKey: TOOLBAR_PREFS_KEY,
    defaultValue: { order: [] } as ToolbarPrefs,
    kind: 'json',
    parse: (raw) => {
      try {
        if (!raw) return { order: [] };
        const parsed = JSON.parse(String(raw));
        const order = Array.isArray(parsed?.order) ? parsed.order.filter((x: any) => typeof x === 'string') : [];
        return { order };
      } catch {
        return { order: [] };
      }
    },
    serialize: (value: ToolbarPrefs) => {
      try {
        const order = Array.isArray(value?.order) ? value.order : [];
        return JSON.stringify({ order });
      } catch {
        return JSON.stringify({ order: [] });
      }
    },
  },

  'editor.showMeasureNumbers': {
    id: 'editor.showMeasureNumbers',
    section: 'Editor',
    label: 'Numeri misure',
    i18nKey: 'pref_editor_show_measure_numbers',
    storageKey: SHOW_MEASURE_NUMBERS_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'editor.showVoiceColors': {
    id: 'editor.showVoiceColors',
    section: 'Editor',
    label: 'Colori voci (BTAS)',
    i18nKey: 'pref_editor_show_voice_colors',
    storageKey: SHOW_VOICE_COLORS_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'editor.showQuickInsertBar': {
    id: 'editor.showQuickInsertBar',
    section: 'Editor',
    label: 'Transport (toolbar chiusa)',
    i18nKey: 'pref_editor_show_quick_insert_bar',
    storageKey: SHOW_QUICK_INSERT_BAR_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'editor.selectOnlyCurrentVoice': {
    id: 'editor.selectOnlyCurrentVoice',
    section: 'Editor',
    label: 'Seleziona solo voce corrente (rettangolo)',
    i18nKey: 'pref_editor_select_only_current_voice',
    storageKey: SELECT_ONLY_CURRENT_VOICE_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'editor.autoSaveInterval': {
    id: 'editor.autoSaveInterval',
    section: 'Editor',
    label: 'Salvataggio automatico',
    i18nKey: 'pref_editor_auto_save_interval',
    storageKey: AUTO_SAVE_INTERVAL_KEY,
    defaultValue: 0 as number,
    kind: 'enum',
    options: [
      { value: 0, label: 'Off', i18nKey: 'opt_autosave_off' },
      { value: 30, label: '30 secondi', i18nKey: 'opt_autosave_30s' },
      { value: 60, label: '1 minuto', i18nKey: 'opt_autosave_1m' },
      { value: 120, label: '2 minuti', i18nKey: 'opt_autosave_2m' },
      { value: 300, label: '5 minuti', i18nKey: 'opt_autosave_5m' },
    ] as any,
    parse: (raw) => {
      const v = Number(raw);
      return [0, 30, 60, 120, 300].includes(v) ? v : 0;
    },
    serialize: (value: number) => String(value),
  },

  'render.engravingMode': {
    id: 'render.engravingMode',
    section: 'Render',
    label: 'Engraving mode (legacy/enhanced)',
    i18nKey: 'pref_render_engraving_mode',
    storageKey: ENGRAVING_MODE_KEY,
    defaultValue: 'enhanced' as EngravingModePref,
    kind: 'enum',
    options: [
      { value: 'enhanced', label: 'Enhanced', i18nKey: 'opt_engraving_enhanced' },
      { value: 'legacy', label: 'Legacy', i18nKey: 'opt_engraving_legacy' },
    ],
    parse: (raw) => {
      const v = String(raw ?? '').trim();
      return (v === 'legacy' || v === 'enhanced') ? v : 'enhanced';
    },
    serialize: (value: EngravingModePref) => String(value),
  },

  'analysis.showRomanAnalysis': {
    id: 'analysis.showRomanAnalysis',
    section: 'Analysis',
    label: 'Mostra numeri romani',
    i18nKey: 'pref_analysis_show_roman',
    storageKey: SHOW_ROMAN_ANALYSIS_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.showSymbolAnalysis': {
    id: 'analysis.showSymbolAnalysis',
    section: 'Analysis',
    label: 'Mostra sigle accordi',
    i18nKey: 'pref_analysis_show_symbols',
    storageKey: SHOW_SYMBOL_ANALYSIS_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.profileBaseId': {
    id: 'analysis.profileBaseId',
    section: 'Analysis',
    label: 'Profilo analisi (base)',
    i18nKey: 'pref_analysis_profile_base',
    storageKey: HARMONY_ANALYSIS_PROFILE_DEFAULT_KEY,
    defaultValue: 'academic' as const,
    kind: 'enum',
    options: [
      { value: 'academic', label: 'Accademico', i18nKey: 'opt_profile_academic' },
      { value: 'symbols', label: 'Sigle', i18nKey: 'opt_profile_symbols' },
    ],
    parse: (raw) => {
      const v = String(raw ?? '').trim();
      return (v === 'academic' || v === 'symbols') ? v : 'academic';
    },
    serialize: (value: 'academic' | 'symbols') => String(value),
  },

  'analysis.profileCustomized': {
    id: 'analysis.profileCustomized',
    section: 'Analysis',
    label: 'Profilo analisi: custom',
    i18nKey: 'pref_analysis_profile_customized',
    storageKey: HARMONY_ANALYSIS_PROFILE_CUSTOMIZED_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.sequencesEnabled': {
    id: 'analysis.sequencesEnabled',
    section: 'Analysis',
    label: 'Sequenze (ON/OFF)',
    i18nKey: 'pref_analysis_sequences_enabled',
    storageKey: HARMONY_SEQUENCES_ENABLED_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.enableInferredContexts': {
    id: 'analysis.enableInferredContexts',
    section: 'Analysis',
    label: 'Inferisci contesti (modulazioni) automaticamente',
    i18nKey: 'pref_analysis_enable_inferred_contexts',
     storageKey: ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.harmonyLabelMinSpanBeats': {
    id: 'analysis.harmonyLabelMinSpanBeats',
    section: 'Analysis',
    label: 'Filtro anti-rumore: durata minima label (beats)',
    i18nKey: 'pref_analysis_label_min_span_beats',
    storageKey: HARMONY_LABEL_MIN_SPAN_BEATS_KEY,
    defaultValue: 0,
    kind: 'number',
    min: 0,
    max: 8,
    step: 0.25,
    parse: (raw) => {
      const v = parseNumber(raw, 0);
      return v >= 0 ? v : 0;
    },
    serialize: (value: number) => String(Number.isFinite(value) ? value : 0),
  },

  'analysis.filters': {
    id: 'analysis.filters',
    section: 'Analysis',
    label: 'Filtri analisi (error/warn/exception + disabled)',
    i18nKey: 'pref_analysis_filters',
    storageKey: HARMONY_ANALYSIS_FILTERS_KEY,
    defaultValue: {
      showError: true,
      showWarning: true,
      showException: true,
      showChromatic: true,
      disabledRuleIds: {},
    } as HarmonyAnalysisFiltersPref,
    kind: 'json',
    parse: (raw) => {
      try {
        if (!raw) {
          return { showError: true, showWarning: true, showException: true, showChromatic: true, disabledRuleIds: {} };
        }
        const p = JSON.parse(String(raw));
        const showError = typeof p?.showError === 'boolean' ? p.showError : true;
        const showWarning = typeof p?.showWarning === 'boolean' ? p.showWarning : true;
        const showException = typeof p?.showException === 'boolean' ? p.showException : true;
        const showChromatic = typeof p?.showChromatic === 'boolean' ? p.showChromatic : true;
        const disabledRuleIds = (p?.disabledRuleIds && typeof p.disabledRuleIds === 'object') ? p.disabledRuleIds : {};
        return { showError, showWarning, showException, showChromatic, disabledRuleIds };
      } catch {
        return { showError: true, showWarning: true, showException: true, showChromatic: true, disabledRuleIds: {} };
      }
    },
    serialize: (value: HarmonyAnalysisFiltersPref) => {
      try {
        const v = value || ({} as any);
        return JSON.stringify({
          showError: !!v.showError,
          showWarning: !!v.showWarning,
          showException: !!v.showException,
          showChromatic: v.showChromatic !== false,
          disabledRuleIds: (v.disabledRuleIds && typeof v.disabledRuleIds === 'object') ? v.disabledRuleIds : {},
        });
      } catch {
        return JSON.stringify({ showError: true, showWarning: true, showException: true, showChromatic: true, disabledRuleIds: {} });
      }
    },
  },

  'analysis.useStatisticalCorrection': {
    id: 'analysis.useStatisticalCorrection',
    section: 'Analysis',
    label: 'Correzione statistica progressioni',
    i18nKey: 'pref_analysis_statistical_correction',
    storageKey: ANALYSIS_STATISTICAL_CORRECTION_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.statisticalBiasThreshold': {
    id: 'analysis.statisticalBiasThreshold',
    section: 'Analysis',
    label: 'Soglia bias statistico',
    i18nKey: 'pref_analysis_statistical_bias_threshold',
    storageKey: STATISTICAL_BIAS_THRESHOLD_KEY,
    defaultValue: 2,
    kind: 'number',
    parse: (raw) => { const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : 2; },
    serialize: (value: number) => String(value),
  },

  'analysis.enableLearnedOrnaments': {
    id: 'analysis.enableLearnedOrnaments',
    section: 'Analysis',
    label: 'Ornamenti appresi',
    i18nKey: 'pref_analysis_learned_ornaments',
    storageKey: ENABLE_LEARNED_ORNAMENTS_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.strictPassingNotes': {
    id: 'analysis.strictPassingNotes',
    section: 'Analysis',
    label: 'Regola stretta note di passaggio',
    i18nKey: 'pref_analysis_strict_passing_notes',
    storageKey: ANALYSIS_STRICT_PASSING_NOTES_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'export.includeTitle': {
    id: 'export.includeTitle',
    section: 'Export',
    label: 'Includi titolo in stampa/export',
    i18nKey: 'pref_export_include_title',
    storageKey: EXPORT_INCLUDE_TITLE_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'debug.showHarmonyDebug': {
    id: 'debug.showHarmonyDebug',
    section: 'Debug',
    label: 'Debug harmony labels (pcs)',
    i18nKey: 'pref_debug_show_harmony_debug',
    storageKey: SHOW_HARMONY_DEBUG_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.tonicizationCompact': {
    id: 'analysis.tonicizationCompact',
    section: 'Analysis',
    label: 'Tonicizzazioni compatte',
    i18nKey: 'pref_analysis_tonicization_compact',
    storageKey: TONICIZATION_COMPACT_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.cadentialPatterns': {
    id: 'analysis.cadentialPatterns',
    section: 'Analysis',
    label: 'Riconoscimento pattern cadenzali',
    i18nKey: 'pref_analysis_cadential_patterns',
    storageKey: CADENTIAL_PATTERN_RECOGNITION_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },
  'analysis.ruleSuggestions': {
    id: 'analysis.ruleSuggestions',
    section: 'Analysis',
    label: 'Consigli personalizzati regole',
    i18nKey: 'pref_analysis_rule_suggestions',
    storageKey: RULE_SUGGESTIONS_KEY,
    defaultValue: {} as Record<string, string>,
    kind: 'json',
    parse: (raw) => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } },
    serialize: (value: Record<string, string>) => JSON.stringify(value),
  },
  'analysis.chromaticModulation': {
    id: 'analysis.chromaticModulation',
    section: 'Analysis',
    label: 'Modulazione cromatica (sperimentale)',
    i18nKey: 'pref_analysis_chromatic_modulation',
    storageKey: CHROMATIC_MODULATION_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },
  'midi.exportType': {
    id: 'midi.exportType',
    section: 'MIDI',
    label: 'Formato export MIDI',
    i18nKey: 'pref_midi_export_type',
    description: 'Type 1 (multi-traccia): una traccia per voce — compatibile con MuseScore/Finale/Sibelius. Type 0 (traccia singola): tutte le voci in una traccia — massima compatibilità.',
    descriptionI18nKey: 'pref_midi_export_type_description',
    storageKey: MIDI_EXPORT_TYPE_KEY,
    defaultValue: '1',
    kind: 'enum',
    options: [
      { value: '1', label: 'Type 1 — Multi-traccia (una per voce)', i18nKey: 'opt_midi_type1' },
      { value: '0', label: 'Type 0 — Traccia singola', i18nKey: 'opt_midi_type0' },
    ],
    parse: (raw) => (raw === '0' ? '0' : '1'),
    serialize: (value: string) => value,
  },
};

export const PREFERENCE_DEFS: PreferenceDef<any>[] = Object.values(PREFERENCES);

export function getPreferenceIdsBySection(section: PreferenceSectionId): PreferenceId[] {
  return PREFERENCE_DEFS.filter((d) => d.section === section).map((d) => d.id);
}
