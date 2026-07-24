export const IPC_CHANNELS: Readonly<{
  MENU_ACTION: 'menu-action';
  MENU_ERROR: 'menu-error';

  ADD_RECENT: 'add-recent';
  SET_MENU_STATE: 'set-menu-state';

  SAVE_FILE: 'save-file';
  SAVE_FILE_DIALOG: 'save-file-dialog';
  SAVE_BINARY_FILE: 'save-binary-file';

  EXPORT_PDF_FROM_HTML: 'export-pdf-from-html';
  EXPORT_PNG_FROM_HTML: 'export-png-from-html';
  EXPORT_MUSICXML: 'export-musicxml';

  GUITAR_LIBRARY_LOAD: 'guitar-library-load';
  GUITAR_LIBRARY_SAVE: 'guitar-library-save';

  GET_TRIAL_INFO: 'get-trial-info';

  ACTIVATE_LICENSE: 'activate-license';
  DEACTIVATE_LICENSE: 'deactivate-license';
  GET_LICENSE_INFO: 'get-license-info';
  GET_FEATURE_GATE: 'get-feature-gate';
  SHOW_ACTIVATION_DIALOG: 'show-activation-dialog';
}>;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
