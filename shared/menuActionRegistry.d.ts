export const MENU_ACTIONS: Readonly<{
  NEW: 'new';
  OPEN: 'open';
  IMPORT_MIDI: 'import-midi';
  EXPORT_MIDI: 'export-midi';
  PRINT: 'print';
  SAVE: 'save';
  SAVE_AS: 'save-as';
  CLOSE_PROJECT: 'close-project';

  UNDO: 'undo';
  REDO: 'redo';
  EDIT_COMMAND: 'edit-command';

  OPEN_PREFERENCES: 'open-preferences';
  TOGGLE_TOOLBAR_CUSTOMIZE: 'toggle-toolbar-customize';

  SET_QUICK_INSERT_BAR: 'set-quick-insert-bar';
  SET_SHOW_MEASURE_NUMBERS: 'set-show-measure-numbers';
  SET_SHOW_HARMONY_DEBUG: 'set-show-harmony-debug';
  SET_SHOW_VOICE_COLORS: 'set-show-voice-colors';
  SET_ENGRAVING_MODE: 'set-engraving-mode';
  RUN_OVERLAP_AUDIT: 'run-overlap-audit';

  SET_TITLE_FONT_FAMILY: 'set-title-font-family';
  INCREASE_TITLE_FONT: 'increase-title-font';
  DECREASE_TITLE_FONT: 'decrease-title-font';

  SET_SELECT_ONLY_VOICE: 'set-select-only-voice';
  SET_APP_MODE: 'set-app-mode';
}>;

export type MenuAction = (typeof MENU_ACTIONS)[keyof typeof MENU_ACTIONS];

export type MenuActionPayloadMap = {
  'new': undefined;
  'open': { data: string; filePath?: string };
  'import-midi': { base64: string; filePath: string };
  'export-midi': undefined;
  'print': undefined;
  'save': undefined;
  'save-as': undefined;
  'close-project': undefined;

  'undo': undefined;
  'redo': undefined;
  'edit-command': { command: 'cut' | 'copy' | 'paste' | 'selectAll' };

  'open-preferences': undefined;
  'toggle-toolbar-customize': undefined;

  'set-quick-insert-bar': { enabled: boolean };
  'set-show-measure-numbers': { enabled: boolean };
  'set-show-harmony-debug': { enabled: boolean };
  'set-show-voice-colors': { enabled: boolean };
  'set-engraving-mode': { mode: 'legacy' | 'enhanced' };
  'run-overlap-audit': { mode: 'legacy' | 'enhanced' };

  'set-title-font-family': { family: 'serif' | 'sans-serif' | 'monospace' };
  'increase-title-font': undefined;
  'decrease-title-font': undefined;

  'set-select-only-voice': { enabled: boolean };
  'set-app-mode': { mode: 'scales' | 'chords' | 'intervals' | 'editor' | 'grandStaff' };
};

export type MenuActionPayload<A extends MenuAction> = MenuActionPayloadMap[A];

export function isMenuAction(action: unknown): action is MenuAction;

export function normalizeMenuActionPayload<A extends MenuAction>(
  action: A,
  payload: unknown
): MenuActionPayload<A> | null;

export function sendMenuAction<A extends MenuAction>(
  webContents: { send: (channel: string, ...args: any[]) => void } | null | undefined,
  action: A,
  payload: MenuActionPayload<A>
): boolean;

export function sendMenuError(
  webContents: { send: (channel: string, ...args: any[]) => void } | null | undefined,
  code: string,
  message: string
): boolean;
