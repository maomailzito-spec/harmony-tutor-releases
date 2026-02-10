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
  SET_SHOW_MEASURE_NUMBERS: 'set-show-measure-numbers',
  SET_SHOW_HARMONY_DEBUG: 'set-show-harmony-debug',
  SET_SHOW_VOICE_COLORS: 'set-show-voice-colors',
  SET_ENGRAVING_MODE: 'set-engraving-mode',
  RUN_OVERLAP_AUDIT: 'run-overlap-audit',

  SET_TITLE_FONT_FAMILY: 'set-title-font-family',
  INCREASE_TITLE_FONT: 'increase-title-font',
  DECREASE_TITLE_FONT: 'decrease-title-font',

  SET_SELECT_ONLY_VOICE: 'set-select-only-voice',
  SET_APP_MODE: 'set-app-mode',
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

    case MENU_ACTIONS.SET_QUICK_INSERT_BAR:
    case MENU_ACTIONS.SET_SHOW_MEASURE_NUMBERS:
    case MENU_ACTIONS.SET_SHOW_HARMONY_DEBUG:
    case MENU_ACTIONS.SET_SHOW_VOICE_COLORS:
    case MENU_ACTIONS.SET_SELECT_ONLY_VOICE: {
      const p = payload as any;
      return { enabled: toBoolean(p?.enabled) } as MenuActionPayloadMap[A];
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

    default:
      return undefined as MenuActionPayloadMap[A];
  }
}
