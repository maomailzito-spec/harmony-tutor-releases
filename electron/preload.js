const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onMenuAction: (callback) => {
    const subscription = (_event, action, payload) => {
      console.log('[PRELOAD] menu-action ricevuto:', action, payload);
      callback(action, payload);
    };
    ipcRenderer.on('menu-action', subscription);
    return () => ipcRenderer.removeListener('menu-action', subscription);
  },
  // saveFile(content, path?) -> if path provided, main writes directly; otherwise shows Save dialog
  saveFile: (content, targetPath) => ipcRenderer.invoke('save-file', content, targetPath),
  addRecentFile: (filePath) => ipcRenderer.send('add-recent', filePath),
  // Keep native app menu in sync with renderer state (for checkmarks)
  setMenuState: (state) => ipcRenderer.send('set-menu-state', state),
  guitarLibrary: {
    load: () => ipcRenderer.invoke('guitar-library-load'),
    save: (library) => ipcRenderer.invoke('guitar-library-save', library)
  }
});