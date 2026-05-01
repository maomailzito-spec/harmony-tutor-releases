'use strict';

/**
 * Shared contract for renderer -> main menu state syncing.
 *
 * Goals:
 * - Single source of truth for allowed keys
 * - Lightweight runtime normalization (avoid crashes)
 */

function toBoolean(value) {
  return value === true || value === '1' || value === 1;
}

function normalizeMenuState(state) {
  if (!state || typeof state !== 'object') return null;
  const s = state;
  const out = {};

  if (typeof s.selectOnlyCurrentVoiceEnabled === 'boolean') {
    out.selectOnlyCurrentVoiceEnabled = s.selectOnlyCurrentVoiceEnabled;
  } else if (s.selectOnlyCurrentVoiceEnabled != null) {
    out.selectOnlyCurrentVoiceEnabled = toBoolean(s.selectOnlyCurrentVoiceEnabled);
  }

  if (typeof s.showMeasureNumbersEnabled === 'boolean') {
    out.showMeasureNumbersEnabled = s.showMeasureNumbersEnabled;
  } else if (s.showMeasureNumbersEnabled != null) {
    out.showMeasureNumbersEnabled = toBoolean(s.showMeasureNumbersEnabled);
  }

  if (typeof s.showHarmonyDebugEnabled === 'boolean') {
    out.showHarmonyDebugEnabled = s.showHarmonyDebugEnabled;
  } else if (s.showHarmonyDebugEnabled != null) {
    out.showHarmonyDebugEnabled = toBoolean(s.showHarmonyDebugEnabled);
  }

  if (typeof s.showVoiceColorsEnabled === 'boolean') {
    out.showVoiceColorsEnabled = s.showVoiceColorsEnabled;
  } else if (s.showVoiceColorsEnabled != null) {
    out.showVoiceColorsEnabled = toBoolean(s.showVoiceColorsEnabled);
  }

  if (typeof s.showQuickInsertBarEnabled === 'boolean') {
    out.showQuickInsertBarEnabled = s.showQuickInsertBarEnabled;
  } else if (s.showQuickInsertBarEnabled != null) {
    out.showQuickInsertBarEnabled = toBoolean(s.showQuickInsertBarEnabled);
  }

  if (s.engravingMode === 'legacy' || s.engravingMode === 'enhanced') {
    out.engravingMode = s.engravingMode;
  }

  if (typeof s.language === 'string' && s.language.length > 0) {
    out.language = s.language;
  }

  return out;
}

module.exports = {
  normalizeMenuState,
};
