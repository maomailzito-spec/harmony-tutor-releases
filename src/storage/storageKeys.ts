export const HT_EDITOR_ZOOM_KEY = 'HT_EDITOR_ZOOM' as const;

export const TOOLBAR_PREFS_KEY = 'harmony-tutor.toolbarPrefs.v1' as const;
export const STAFF_SYSTEM_MODE_KEY = 'harmony-tutor.staffSystemMode.v1' as const;
export const ENGRAVING_MODE_KEY = 'harmony-tutor.engravingMode.v1' as const;

export const ENABLE_INFERRED_CONTEXTS_PREF_KEY = 'HT_ENABLE_INFERRED_CONTEXTS' as const;
// Versioned key (preferred). Keep legacy key migration in localStorageMigrations.
export const ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY = 'harmony-tutor.analysis.enableInferredContexts.v2' as const;

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
export const AUTO_SAVE_INTERVAL_KEY = 'harmony-tutor.editor.autoSaveInterval.v1' as const;
export const ANALYSIS_STATISTICAL_CORRECTION_KEY = 'harmony-tutor.analysis.statisticalCorrection.v1' as const;
export const ENABLE_LEARNED_ORNAMENTS_KEY = 'harmony-tutor.analysis.learnedOrnaments.v1' as const;

// Export / print
export const EXPORT_INCLUDE_TITLE_KEY = 'harmony-tutor.export.includeTitle.v1' as const;

export const HARMONY_DEV_LOG_R06_KEY = 'harmony.dev.logR06' as const;

// Guitar-only custom library keys
export const GUITAR_CUSTOM_SCALES_KEY = 'harmony-tutor.guitar.customScales.v1' as const;
export const GUITAR_CUSTOM_CHORDS_KEY = 'harmony-tutor.guitar.customChords.v1' as const;
export const GUITAR_CUSTOM_SCALE_SHAPES_KEY = 'harmony-tutor.guitar.customScaleShapes.v1' as const;
export const GUITAR_CUSTOM_VOICINGS_KEY = 'harmony-tutor.guitar.customVoicings.v1' as const;

// Aggregate export: use this (and `StorageKey`) to avoid introducing magic-string keys.
export const STORAGE_KEYS = {
	HT_EDITOR_ZOOM_KEY,
	TOOLBAR_PREFS_KEY,
	STAFF_SYSTEM_MODE_KEY,
	ENGRAVING_MODE_KEY,
	ENABLE_INFERRED_CONTEXTS_PREF_KEY,
	ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY,
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
	EXPORT_INCLUDE_TITLE_KEY,
	HARMONY_DEV_LOG_R06_KEY,
	GUITAR_CUSTOM_SCALES_KEY,
	GUITAR_CUSTOM_CHORDS_KEY,
	GUITAR_CUSTOM_SCALE_SHAPES_KEY,
	GUITAR_CUSTOM_VOICINGS_KEY,
        ENABLE_LEARNED_ORNAMENTS_KEY,
} as const;
