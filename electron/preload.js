const { contextBridge, ipcRenderer } = require('electron');

const { IPC_CHANNELS } = require('../shared/ipcChannels');
const { isMenuAction, normalizeMenuActionPayload } = require('../shared/menuActionRegistry');
const { normalizeMenuState } = require('../shared/menuStateRegistry');

contextBridge.exposeInMainWorld('electronAPI', {
  onMenuAction: (callback) => {
    const subscription = (_event, action, payload) => {
      try {
        if (!isMenuAction(action)) return;
        const normalized = normalizeMenuActionPayload(action, payload);
        if (normalized === null) return;
        callback(action, normalized);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on(IPC_CHANNELS.MENU_ACTION, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_ACTION, subscription);
  },
  onMenuError: (callback) => {
    const subscription = (_event, code, message) => {
      try {
        callback(code, message);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on(IPC_CHANNELS.MENU_ERROR, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_ERROR, subscription);
  },
  // saveFile(content, path?) -> if path provided, main writes directly; otherwise shows Save dialog
  saveFile: (content, targetPath) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FILE, content, targetPath),

  // Legacy/optional: explicitly show Save dialog for text content.
  // Prefer saveFile(content) unless you need the structured response.
  saveFileDialog: (content) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FILE_DIALOG, content),

  // Save a base64-encoded binary payload (e.g. MIDI export).
  saveBinaryFile: (base64, targetPath, filters) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_BINARY_FILE, base64, targetPath, filters),

  // Export helpers (main process): render a supplied HTML snapshot to PDF/PNG.
  exportPdfFromHtml: (html, options) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PDF_FROM_HTML, html, options),
  exportPngFromHtml: (html, options) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PNG_FROM_HTML, html, options),

  addRecentFile: (filePath) => ipcRenderer.send(IPC_CHANNELS.ADD_RECENT, filePath),
  // Keep native app menu in sync with renderer state (for checkmarks)
  setMenuState: (state) => {
    const normalized = normalizeMenuState(state);
    if (!normalized) return;
    ipcRenderer.send(IPC_CHANNELS.SET_MENU_STATE, normalized);
  },
  guitarLibrary: {
    load: () => ipcRenderer.invoke(IPC_CHANNELS.GUITAR_LIBRARY_LOAD),
    save: (library) => ipcRenderer.invoke(IPC_CHANNELS.GUITAR_LIBRARY_SAVE, library)
  }
});