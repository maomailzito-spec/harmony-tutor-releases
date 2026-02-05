export const HT_EDITOR_ZOOM_KEY = 'HT_EDITOR_ZOOM' as const;

export const TOOLBAR_PREFS_KEY = 'harmony-tutor.toolbarPrefs.v1' as const;
export const STAFF_SYSTEM_MODE_KEY = 'harmony-tutor.staffSystemMode.v1' as const;
export const ENGRAVING_MODE_KEY = 'harmony-tutor.engravingMode.v1' as const;

export const ENABLE_INFERRED_CONTEXTS_PREF_KEY = 'HT_ENABLE_INFERRED_CONTEXTS' as const;

export const HARMONY_ANALYSIS_FILTERS_KEY = 'harmony.analysis.filters.v1' as const;
export const HARMONY_ANALYSIS_PROFILE_DEFAULT_KEY = 'harmony.analysis.profileDefault.v1' as const;
export const HARMONY_ANALYSIS_PROFILE_CUSTOMIZED_KEY = 'harmony.analysis.profileCustomized.v1' as const;
export const HARMONY_SEQUENCES_ENABLED_KEY = 'harmony.analysis.sequencesEnabled.v1' as const;
export const HARMONY_LABEL_MIN_SPAN_BEATS_KEY = 'harmony.analysis.labelMinSpanBeats.v1' as const;

// GrandStaff editor/view toggles (persisted preferences)
export const SHOW_MEASURE_NUMBERS_KEY = 'harmony-tutor.showMeasureNumbers.v1' as const;
export const SHOW_VOICE_COLORS_KEY = 'harmony-tutor.showVoiceColors.v1' as const;
export const SHOW_QUICK_INSERT_BAR_KEY = 'harmony-tutor.showQuickInsertBar.v1' as const;
export const SHOW_HARMONY_DEBUG_KEY = 'harmony-tutor.showHarmonyDebug.v1' as const;
export const SELECT_ONLY_CURRENT_VOICE_KEY = 'harmony-tutor.selectOnlyCurrentVoice.v1' as const;
export const SHOW_ROMAN_ANALYSIS_KEY = 'harmony-tutor.showRomanAnalysis.v1' as const;
export const SHOW_SYMBOL_ANALYSIS_KEY = 'harmony-tutor.showSymbolAnalysis.v1' as const;
export const TOOLBAR_HIDDEN_KEY = 'harmony-tutor.toolbarHidden.v1' as const;

export const HARMONY_DEV_LOG_R06_KEY = 'harmony.dev.logR06' as const;

// Guitar-only custom library keys
export const GUITAR_CUSTOM_SCALES_KEY = 'guitarAppCustomScales' as const;
export const GUITAR_CUSTOM_CHORDS_KEY = 'guitarAppCustomChords' as const;
export const GUITAR_CUSTOM_SCALE_SHAPES_KEY = 'guitarAppCustomScaleShapes' as const;
export const GUITAR_CUSTOM_VOICINGS_KEY = 'guitarAppCustomVoicings' as const;

// Aggregate export: use this (and `StorageKey`) to avoid introducing magic-string keys.
export const STORAGE_KEYS = {
	HT_EDITOR_ZOOM_KEY,
	TOOLBAR_PREFS_KEY,
	STAFF_SYSTEM_MODE_KEY,
	ENGRAVING_MODE_KEY,
	ENABLE_INFERRED_CONTEXTS_PREF_KEY,
	HARMONY_ANALYSIS_FILTERS_KEY,
	HARMONY_ANALYSIS_PROFILE_DEFAULT_KEY,
	HARMONY_ANALYSIS_PROFILE_CUSTOMIZED_KEY,
	HARMONY_SEQUENCES_ENABLED_KEY,
	HARMONY_LABEL_MIN_SPAN_BEATS_KEY,
	SHOW_MEASURE_NUMBERS_KEY,
	SHOW_VOICE_COLORS_KEY,
	SHOW_QUICK_INSERT_BAR_KEY,
	SHOW_HARMONY_DEBUG_KEY,
	SELECT_ONLY_CURRENT_VOICE_KEY,
	SHOW_ROMAN_ANALYSIS_KEY,
	SHOW_SYMBOL_ANALYSIS_KEY,
	TOOLBAR_HIDDEN_KEY,
	HARMONY_DEV_LOG_R06_KEY,
	GUITAR_CUSTOM_SCALES_KEY,
	GUITAR_CUSTOM_CHORDS_KEY,
	GUITAR_CUSTOM_SCALE_SHAPES_KEY,
	GUITAR_CUSTOM_VOICINGS_KEY,
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
