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
  addRecentFile: (filePath) => ipcRenderer.send('add-recent', filePath)
});