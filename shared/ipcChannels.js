'use strict';

// Central registry for IPC channel names.
// Shared by Electron main + preload to avoid string drift.

const IPC_CHANNELS = Object.freeze({
  MENU_ACTION: 'menu-action',
  MENU_ERROR: 'menu-error',

  ADD_RECENT: 'add-recent',
  SET_MENU_STATE: 'set-menu-state',

  SAVE_FILE: 'save-file',
  SAVE_FILE_DIALOG: 'save-file-dialog',
  SAVE_BINARY_FILE: 'save-binary-file',

  EXPORT_PDF_FROM_HTML: 'export-pdf-from-html',
  EXPORT_PNG_FROM_HTML: 'export-png-from-html',
  EXPORT_MUSICXML: 'export-musicxml',

  GUITAR_LIBRARY_LOAD: 'guitar-library-load',
  GUITAR_LIBRARY_SAVE: 'guitar-library-save',
});

module.exports = {
  IPC_CHANNELS,
};
