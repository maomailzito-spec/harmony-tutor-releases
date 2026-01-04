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
  saveFile: (content, filePath) => ipcRenderer.invoke('save-file-dialog', content, filePath)
  ,
  addRecentFile: (filePath) => ipcRenderer.send('add-recent', filePath)
});