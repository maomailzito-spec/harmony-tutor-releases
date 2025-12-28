const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onMenuAction: (callback) => {
    const subscription = (_event, action, payload) => callback(action, payload);
    ipcRenderer.on('menu-action', subscription);
    return () => ipcRenderer.removeListener('menu-action', subscription);
  },
  saveFile: (content) => ipcRenderer.invoke('save-file-dialog', content)
});