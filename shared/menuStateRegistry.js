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

  // I TRE STRATI D'ANALISI E I RIGHI: il menù mostra la spunta, quindi deve sapere
  // com'è messa la pagina. Senza, la spunta direbbe una cosa e lo schermo un'altra.
  for (const k of ['showRomanEnabled', 'showSymbolsEnabled', 'showFiguredBassEnabled', 'satbVisibleEnabled']) {
    if (typeof s[k] === 'boolean') out[k] = s[k];
    else if (s[k] != null) out[k] = toBoolean(s[k]);
  }

  // Le tracce si chiamano col loro nome nel menù: l'elenco arriva da qui.
  if (Array.isArray(s.accTracks)) {
    out.accTracks = s.accTracks
      .filter((t) => t && typeof t.id === 'string' && t.id.length > 0)
      .map((t) => ({
        id: t.id,
        name: typeof t.name === 'string' ? t.name : '',
        visible: t.visible !== false,
      }));
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
