const { contextBridge, ipcRenderer } = require('electron');

// Centralized API for Electron
contextBridge.exposeInMainWorld('electronAPI', {
  // Mods API
  listMods: () => ipcRenderer.invoke('mods:list'),
  toggleMod: (id) => ipcRenderer.invoke('mods:toggle', id),
  
  // Settings API
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (changes) => ipcRenderer.invoke('settings:write', changes),
  
  // Updates API
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  
  // FS API
  fs: {
    ensureDir: (path) => ipcRenderer.invoke('ensure_dir', { path }),
    readFile: (path) => ipcRenderer.invoke('read_file', { path }),
    writeFile: (path, content) => ipcRenderer.invoke('write_file', { path, content }),
    readDir: (path) => ipcRenderer.invoke('read_dir', { path }),
    pathExists: (path) => ipcRenderer.invoke('path_exists', { path }),
  },
  
  // Shell API
  shell: {
    run: (command, cwd) => ipcRenderer.invoke('shell:run', { command, cwd }),
  },

  // Webview API (mod-embedded native browser views)
  webview: {
    create: (modId, instance, url, x, y, width, height) =>
      ipcRenderer.invoke('webview:create', { modId, instance, url, x, y, width, height }),
    close: (modId, instance) => ipcRenderer.invoke('webview:close', { modId, instance }),
    setVisible: (modId, instance, visible) =>
      ipcRenderer.invoke('webview:setVisible', { modId, instance, visible }),
    setBounds: (modId, instance, x, y, width, height) =>
      ipcRenderer.invoke('webview:setBounds', { modId, instance, x, y, width, height }),
  },
  
  // Legacy endpoints (deprecated but kept for backwards compatibility)
  invoke: (method, payload) => ipcRenderer.invoke('native:invoke', { method, payload }),
  callBackend: (modId, functionName, args) => ipcRenderer.invoke('mods:callBackend', { modId, functionName, args }),
});