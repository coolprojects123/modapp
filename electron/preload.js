const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  listMods: () => ipcRenderer.invoke('mods:list'),
  toggleMod: (id) => ipcRenderer.invoke('mods:toggle', id),
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (changes) => ipcRenderer.invoke('settings:write', changes),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  invoke: (method, payload) => ipcRenderer.invoke('native:invoke', { method, payload }),
  callBackend: (modId, functionName, args) => ipcRenderer.invoke('mods:callBackend', { modId, functionName, args }),
});