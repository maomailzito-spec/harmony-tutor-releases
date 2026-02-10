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

  GUITAR_LIBRARY_LOAD: 'guitar-library-load';
  GUITAR_LIBRARY_SAVE: 'guitar-library-save';
}>;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
