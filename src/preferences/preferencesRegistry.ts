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
  ENABLE_LEARNED_ORNAMENTS_KEY,
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
  | 'analysis.enableLearnedOrnaments'
  | 'export.includeTitle'
  | 'debug.showHarmonyDebug';

export type PreferenceDef<T> = {
  id: PreferenceId;
  section: PreferenceSectionId;
  label: string;
  storageKey: string;
  defaultValue: T;
  kind: 'boolean' | 'enum' | 'number' | 'json';
  options?: Array<{ value: string; label: string }>;
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
    storageKey: STAFF_SYSTEM_MODE_KEY,
    defaultValue: 'grandstaff' as StaffSystemModePref,
    kind: 'enum',
    options: [
      { value: 'grandstaff', label: 'Grand staff' },
      { value: 'satb_ancient', label: 'SATB (chiavi antiche)' },
      { value: 'treble_only', label: 'Treble only' },
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
    storageKey: AUTO_SAVE_INTERVAL_KEY,
    defaultValue: 0 as number,
    kind: 'enum',
    options: [
      { value: 0, label: 'Off' },
      { value: 30, label: '30 secondi' },
      { value: 60, label: '1 minuto' },
      { value: 120, label: '2 minuti' },
      { value: 300, label: '5 minuti' },
    ],
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
    storageKey: ENGRAVING_MODE_KEY,
    defaultValue: 'enhanced' as EngravingModePref,
    kind: 'enum',
    options: [
      { value: 'enhanced', label: 'Enhanced' },
      { value: 'legacy', label: 'Legacy' },
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
    storageKey: HARMONY_ANALYSIS_PROFILE_DEFAULT_KEY,
    defaultValue: 'academic' as const,
    kind: 'enum',
    options: [
      { value: 'academic', label: 'Accademico' },
      { value: 'symbols', label: 'Sigle' },
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
    storageKey: HARMONY_ANALYSIS_FILTERS_KEY,
    defaultValue: {
      showError: true,
      showWarning: true,
      showException: true,
      disabledRuleIds: {},
    } as HarmonyAnalysisFiltersPref,
    kind: 'json',
    parse: (raw) => {
      try {
        if (!raw) {
          return { showError: true, showWarning: true, showException: true, disabledRuleIds: {} };
        }
        const p = JSON.parse(String(raw));
        const showError = typeof p?.showError === 'boolean' ? p.showError : true;
        const showWarning = typeof p?.showWarning === 'boolean' ? p.showWarning : true;
        const showException = typeof p?.showException === 'boolean' ? p.showException : true;
        const disabledRuleIds = (p?.disabledRuleIds && typeof p.disabledRuleIds === 'object') ? p.disabledRuleIds : {};
        return { showError, showWarning, showException, disabledRuleIds };
      } catch {
        return { showError: true, showWarning: true, showException: true, disabledRuleIds: {} };
      }
    },
    serialize: (value: HarmonyAnalysisFiltersPref) => {
      try {
        const v = value || ({} as any);
        return JSON.stringify({
          showError: !!v.showError,
          showWarning: !!v.showWarning,
          showException: !!v.showException,
          disabledRuleIds: (v.disabledRuleIds && typeof v.disabledRuleIds === 'object') ? v.disabledRuleIds : {},
        });
      } catch {
        return JSON.stringify({ showError: true, showWarning: true, showException: true, disabledRuleIds: {} });
      }
    },
  },

  'analysis.useStatisticalCorrection': {
    id: 'analysis.useStatisticalCorrection',
    section: 'Analysis',
    label: 'Correzione statistica progressioni',
    storageKey: ANALYSIS_STATISTICAL_CORRECTION_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.enableLearnedOrnaments': {
    id: 'analysis.enableLearnedOrnaments',
    section: 'Analysis',
    label: 'Ornamenti appresi',
    storageKey: ENABLE_LEARNED_ORNAMENTS_KEY,
    defaultValue: true,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'export.includeTitle': {
    id: 'export.includeTitle',
    section: 'Export',
    label: 'Includi titolo in stampa/export',
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
    storageKey: SHOW_HARMONY_DEBUG_KEY,
    defaultValue: false,
    kind: 'boolean',
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },
};

export const PREFERENCE_DEFS: PreferenceDef<any>[] = Object.values(PREFERENCES);

export function getPreferenceIdsBySection(section: PreferenceSectionId): PreferenceId[] {
  return PREFERENCE_DEFS.filter((d) => d.section === section).map((d) => d.id);
}
