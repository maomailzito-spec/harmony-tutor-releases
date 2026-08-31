'use strict';

const { IPC_CHANNELS } = require('./ipcChannels');

/**
 * Central registry for Electron menu actions and their payload shapes.
 *
 * Goals:
 * - Single source of truth for action names (main + renderer)
 * - Lightweight runtime validation/normalization (avoid crashes)
 * - Type declarations provided via adjacent menuActionRegistry.d.ts
 */

const MENU_ACTIONS = Object.freeze({
  NEW: 'new',
  OPEN: 'open',
  IMPORT_MIDI: 'import-midi',
  IMPORT_MUSICXML: 'import-musicxml',
  EXPORT_MIDI: 'export-midi',
  EXPORT_MUSICXML: 'export-musicxml',
  EXPORT_PDF: 'export-pdf',
  EXPORT_PNG: 'export-png',
  PRINT: 'print',
  SAVE: 'save',
  SAVE_AS: 'save-as',
  CLOSE_PROJECT: 'close-project',

  UNDO: 'undo',
  REDO: 'redo',
  EDIT_COMMAND: 'edit-command',

  OPEN_PREFERENCES: 'open-preferences',
  TOGGLE_TOOLBAR_CUSTOMIZE: 'toggle-toolbar-customize',

  SET_QUICK_INSERT_BAR: 'set-quick-insert-bar',
  // La toolbar si nascondeva solo con ⌥T: senza voce di menù, per chi esplora
  // l'applicazione dai menù quel comando non esisteva.
  SET_TOOLBAR_HIDDEN: 'set-toolbar-hidden',
  // Il titolo nell'esportazione: sta accanto a «quel che si vede è quel che si esporta»,
  // perché è la stessa domanda — cosa finisce nel file.
  SET_EXPORT_INCLUDE_TITLE: 'set-export-include-title',
  SET_STAFF_SYSTEM_MODE: 'set-staff-system-mode',
  SET_ORCHESTRAL_GROUPING: 'set-orchestral-grouping',
  SET_SHOW_MEASURE_NUMBERS: 'set-show-measure-numbers',
  SET_SHOW_HARMONY_DEBUG: 'set-show-harmony-debug',
  SET_SHOW_VOICE_COLORS: 'set-show-voice-colors',
  SET_CONCERT_PITCH: 'set-concert-pitch',
  SET_ENGRAVING_MODE: 'set-engraving-mode',
  RUN_OVERLAP_AUDIT: 'run-overlap-audit',

  SET_TITLE_FONT_FAMILY: 'set-title-font-family',
  INCREASE_TITLE_FONT: 'increase-title-font',
  DECREASE_TITLE_FONT: 'decrease-title-font',

  SET_SELECT_ONLY_VOICE: 'set-select-only-voice',
  // Soggetto dell'analisi: il coro o una traccia. Dal MENÙ e non solo dalla toolbar,
  // perché i menù di sistema sono il modo in cui chi usa uno screen reader esplora
  // l'applicazione — e senza questa voce il comando era di fatto irraggiungibile.
  SET_ANALYSIS_SUBJECT: 'set-analysis-subject',
  // I TRE STRATI D'ANALISI E I RIGHI, DAL MENÙ. Erano raggiungibili solo dalla barra
  // degli strumenti — cioè col mouse, su pulsanti piccoli. Per chi usa uno screen
  // reader il menù di sistema È l'applicazione: senza queste voci le scelte che
  // decidono cosa si vede E cosa finisce nei file esportati restavano di fatto
  // precluse. Stessa ragione per cui SET_ANALYSIS_SUBJECT è finito qui.
  SET_SHOW_ROMAN: 'set-show-roman',
  SET_SHOW_SYMBOLS: 'set-show-symbols',
  SET_SHOW_FIGURED_BASS: 'set-show-figured-bass',
  SET_SATB_VISIBLE: 'set-satb-visible',
  SET_TRACK_VISIBLE: 'set-track-visible',
  TOGGLE_VIOLATIONS_PANEL: 'toggle-violations-panel',
  SET_APP_MODE: 'set-app-mode',
  GENERATE_FROM_ROMAN: 'generate-from-roman',
  TOGGLE_ANALYSIS_LOCK: 'toggle-analysis-lock',
});

const MENU_ACTION_SET = new Set(Object.values(MENU_ACTIONS));

function isMenuAction(action) {
  return typeof action === 'string' && MENU_ACTION_SET.has(action);
}

function toBoolean(value) {
  return value === true || value === '1' || value === 1;
}

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value;
}

function normalizeMenuActionPayload(action, payload) {
  if (!isMenuAction(action)) return null;

  switch (action) {
    case MENU_ACTIONS.OPEN: {
      const data = normalizeString(payload && payload.data);
      const filePath = normalizeString(payload && payload.filePath);
      if (!data) return null;
      return filePath ? { data, filePath } : { data };
    }

    case MENU_ACTIONS.IMPORT_MIDI: {
      const base64 = normalizeString(payload && payload.base64);
      const filePath = normalizeString(payload && payload.filePath);
      if (!base64 || !filePath) return null;
      return { base64, filePath };
    }

    case MENU_ACTIONS.IMPORT_MUSICXML: {
      const xml = normalizeString(payload && payload.xml);
      const filePath = normalizeString(payload && payload.filePath);
      if (!xml || !filePath) return null;
      return { xml, filePath };
    }

    case MENU_ACTIONS.EDIT_COMMAND: {
      const command = normalizeString(payload && payload.command);
      if (command !== 'cut' && command !== 'copy' && command !== 'paste' && command !== 'selectAll') return null;
      return { command };
    }

    case MENU_ACTIONS.SET_ORCHESTRAL_GROUPING:
    case MENU_ACTIONS.SET_EXPORT_INCLUDE_TITLE:
    case MENU_ACTIONS.SET_TOOLBAR_HIDDEN:
    case MENU_ACTIONS.SET_QUICK_INSERT_BAR:
    case MENU_ACTIONS.SET_SHOW_MEASURE_NUMBERS:
    case MENU_ACTIONS.SET_SHOW_HARMONY_DEBUG:
    case MENU_ACTIONS.SET_SHOW_VOICE_COLORS:
    case MENU_ACTIONS.SET_CONCERT_PITCH:
    case MENU_ACTIONS.SET_SELECT_ONLY_VOICE:
    case MENU_ACTIONS.SET_SHOW_ROMAN:
    case MENU_ACTIONS.SET_SHOW_SYMBOLS:
    case MENU_ACTIONS.SET_SHOW_FIGURED_BASS:
    case MENU_ACTIONS.SET_SATB_VISIBLE: {
      return { enabled: toBoolean(payload && payload.enabled) };
    }

    case MENU_ACTIONS.SET_TRACK_VISIBLE: {
      const trackId = normalizeString(payload && payload.trackId);
      if (!trackId) return null;
      return { trackId, enabled: toBoolean(payload && payload.enabled) };
    }

    case MENU_ACTIONS.SET_STAFF_SYSTEM_MODE: {
      const mode = normalizeString(payload && payload.mode);
      if (mode !== 'grandstaff' && mode !== 'satb_ancient' && mode !== 'treble_only') return null;
      return { mode };
    }

    case MENU_ACTIONS.SET_ENGRAVING_MODE:
    case MENU_ACTIONS.RUN_OVERLAP_AUDIT: {
      const mode = normalizeString(payload && payload.mode);
      if (mode !== 'legacy' && mode !== 'enhanced') return null;
      return { mode };
    }

    case MENU_ACTIONS.SET_TITLE_FONT_FAMILY: {
      const family = normalizeString(payload && payload.family);
      if (family !== 'serif' && family !== 'sans-serif' && family !== 'monospace') return null;
      return { family };
    }

    case MENU_ACTIONS.SET_ANALYSIS_SUBJECT: {
      const subject = normalizeString(payload && payload.subject);
      if (subject !== 'satb' && subject !== 'acc') return null;
      return { subject };
    }

    case MENU_ACTIONS.SET_APP_MODE: {
      const mode = normalizeString(payload && payload.mode);
      if (mode !== 'scales' && mode !== 'chords' && mode !== 'intervals' && mode !== 'editor' && mode !== 'grandStaff') return null;
      return { mode };
    }

    // Chorale generation — no payload (UI handles config)
    case MENU_ACTIONS.GENERATE_FROM_ROMAN:
      return undefined;

    // Actions with no payload
    default:
      return undefined;
  }
}

function sendMenuAction(webContents, action, payload) {
  if (!webContents) return false;
  if (!isMenuAction(action)) return false;
  const normalized = normalizeMenuActionPayload(action, payload);
  if (normalized === null) return false;

  try {
    webContents.send(IPC_CHANNELS.MENU_ACTION, action, normalized);
    return true;
  } catch {
    return false;
  }
}

function sendMenuError(webContents, code, message) {
  if (!webContents) return false;
  try {
    const safeCode = typeof code === 'string' ? code : 'error';
    const safeMessage = typeof message === 'string' ? message : String(message || '');
    webContents.send(IPC_CHANNELS.MENU_ERROR, safeCode, safeMessage);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  MENU_ACTIONS,
  isMenuAction,
  normalizeMenuActionPayload,
  sendMenuAction,
  sendMenuError,
};
