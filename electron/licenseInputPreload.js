/**
 * licenseInputPreload.js — Minimal preload for the license key input dialog.
 * Exposes only submitKey / cancelKey via contextBridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseAPI', {
  submitKey: (key) => ipcRenderer.send('license-key-submitted', key),
  cancelKey: () => ipcRenderer.send('license-key-cancelled'),
});
