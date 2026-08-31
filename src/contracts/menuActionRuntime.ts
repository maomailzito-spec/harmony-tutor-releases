import type { MenuAction, MenuActionPayloadMap } from '../../shared/menuActionRegistry';

// Browser-safe (ESM) runtime contract for menu actions.
//
// Electron main uses the CommonJS runtime in shared/menuActionRegistry.js.
// The `satisfies` clause keeps this file in lockstep with the shared contract types.

export const MENU_ACTIONS = {
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
  SET_TOOLBAR_HIDDEN: 'set-toolbar-hidden',
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
  SET_ANALYSIS_SUBJECT: 'set-analysis-subject',
  SET_SHOW_ROMAN: 'set-show-roman',
  SET_SHOW_SYMBOLS: 'set-show-symbols',
  SET_SHOW_FIGURED_BASS: 'set-show-figured-bass',
  SET_SATB_VISIBLE: 'set-satb-visible',
  SET_TRACK_VISIBLE: 'set-track-visible',
  TOGGLE_VIOLATIONS_PANEL: 'toggle-violations-panel',
  SET_APP_MODE: 'set-app-mode',
  GENERATE_FROM_ROMAN: 'generate-from-roman',
  TOGGLE_ANALYSIS_LOCK: 'toggle-analysis-lock',
} as const satisfies typeof import('../../shared/menuActionRegistry').MENU_ACTIONS;

const MENU_ACTION_SET: ReadonlySet<string> = new Set(Object.values(MENU_ACTIONS));

export function isMenuAction(action: unknown): action is MenuAction {
  return typeof action === 'string' && MENU_ACTION_SET.has(action);
}

function toBoolean(value: unknown) {
  return value === true || value === '1' || value === 1;
}

export function normalizeMenuActionPayload<A extends MenuAction>(
  action: A,
  payload: unknown
): MenuActionPayloadMap[A] | null {
  switch (action) {
    case MENU_ACTIONS.OPEN: {
      const p = payload as any;
      const data = typeof p?.data === 'string' ? p.data : '';
      const filePath = typeof p?.filePath === 'string' ? p.filePath : undefined;
      if (!data) return null;
      return (filePath ? { data, filePath } : { data }) as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.IMPORT_MIDI: {
      const p = payload as any;
      const base64 = typeof p?.base64 === 'string' ? p.base64 : '';
      const filePath = typeof p?.filePath === 'string' ? p.filePath : '';
      if (!base64 || !filePath) return null;
      return { base64, filePath } as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.IMPORT_MUSICXML: {
      const p = payload as any;
      const xml = typeof p?.xml === 'string' ? p.xml : '';
      const filePath = typeof p?.filePath === 'string' ? p.filePath : '';
      if (!xml || !filePath) return null;
      return { xml, filePath } as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.EDIT_COMMAND: {
      const p = payload as any;
      const command = typeof p?.command === 'string' ? p.command : '';
      if (command !== 'cut' && command !== 'copy' && command !== 'paste' && command !== 'selectAll') return null;
      return { command } as MenuActionPayloadMap[A];
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
      const p = payload as any;
      return { enabled: toBoolean(p?.enabled) } as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.SET_TRACK_VISIBLE: {
      const p = payload as any;
      const trackId = typeof p?.trackId === 'string' ? p.trackId : '';
      if (!trackId) return null;
      return { trackId, enabled: toBoolean(p?.enabled) } as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.SET_ANALYSIS_SUBJECT: {
      const p = payload as any;
      const subject = typeof p?.subject === 'string' ? p.subject : '';
      return (subject === 'acc' ? { subject: 'acc' } : { subject: 'satb' }) as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.SET_STAFF_SYSTEM_MODE: {
      const p = payload as any;
      const mode = typeof p?.mode === 'string' ? p.mode : '';
      if (mode !== 'grandstaff' && mode !== 'satb_ancient' && mode !== 'treble_only') return null;
      return { mode } as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.SET_ENGRAVING_MODE:
    case MENU_ACTIONS.RUN_OVERLAP_AUDIT: {
      const p = payload as any;
      const mode = typeof p?.mode === 'string' ? p.mode : '';
      if (mode !== 'legacy' && mode !== 'enhanced') return null;
      return { mode } as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.SET_TITLE_FONT_FAMILY: {
      const p = payload as any;
      const family = typeof p?.family === 'string' ? p.family : '';
      if (family !== 'serif' && family !== 'sans-serif' && family !== 'monospace') return null;
      return { family } as MenuActionPayloadMap[A];
    }

    case MENU_ACTIONS.SET_APP_MODE: {
      const p = payload as any;
      const mode = typeof p?.mode === 'string' ? p.mode : '';
      if (mode !== 'scales' && mode !== 'chords' && mode !== 'intervals' && mode !== 'editor' && mode !== 'grandStaff') return null;
      return { mode } as MenuActionPayloadMap[A];
    }

    // Chorale generation — no payload (UI handles config)
    case MENU_ACTIONS.GENERATE_FROM_ROMAN:
      return undefined as MenuActionPayloadMap[A];

    // Analysis lock toggle — no payload
    case MENU_ACTIONS.TOGGLE_ANALYSIS_LOCK:
      return undefined as MenuActionPayloadMap[A];

    default:
      return undefined as MenuActionPayloadMap[A];
  }
}
