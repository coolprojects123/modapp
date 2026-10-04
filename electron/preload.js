const { contextBridge, ipcRenderer } = require('electron');

// fs calls report a missing file as { __fsError } (see main.js) so the main process doesn't log a stack trace;
// turn it back into a normal rejected promise here.
async function fsInvoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (result && typeof result === 'object' && result.__fsError) {
    throw Object.assign(new Error(result.__fsError.message), { code: result.__fsError.code });
  }
  return result;
}

// Mod context management
// Each mod's scripts run in a context where window.__currentModId is set by bootstrap.js
// We expose a way for the renderer to access this
let currentModId = 'core';

// Expose mod context to renderer
contextBridge.exposeInMainWorld('modContext', {
  getModId: () => currentModId,
  setModId: (modId) => { currentModId = modId; }
});

// Helper to automatically inject modId into API calls
function withModId(channel, payload = {}) {
  if (!currentModId) {
    return Promise.reject(new Error('No mod context available. Are you calling this from a mod script?'));
  }
  return ipcRenderer.invoke(channel, { modId: currentModId, ...payload });
}

// Helper for fs operations with automatic modId
function fsWithModId(channel, payload) {
  if (!currentModId) {
    return Promise.reject(new Error('No mod context available. Are you calling this from a mod script?'));
  }
  return fsInvoke(channel, { modId: currentModId, ...payload });
}

// Centralized API for Electron
contextBridge.exposeInMainWorld('electronAPI', {
  // Mods API
  listMods: () => ipcRenderer.invoke('mods:list'),
  toggleMod: (id) => withModId('mods:toggle', { id }),
  
  // Settings API - automatically uses current mod's ID
  readSettings: () => withModId('settings:read'),
  writeSettings: (changes) => withModId('settings:write', { changes }),

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('updates:progress', listener);
    return () => ipcRenderer.removeListener('updates:progress', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),
  
  // FS API - automatically uses current mod's ID
  fs: {
    ensureDir: (path) => fsWithModId('fs:ensureDir', { path }),
    readFile: (path) => fsWithModId('fs:readFile', { path }),
    readBytes: (path) => fsWithModId('fs:readBytes', { path }),
    writeFile: (path, content) => fsWithModId('fs:writeFile', { path, content }),
    writeBytes: (path, content) => fsWithModId('fs:writeBytes', { path, content: Array.from(content) }),
    readDir: (path) => fsWithModId('fs:readDir', { path }),
    exists: (path) => fsWithModId('fs:exists', { path }),
    resolvePath: (path) => fsWithModId('fs:resolvePath', { path }),
    toFileUrl: (path) => fsWithModId('fs:toFileUrl', { path }),
    removeFile: (path) => fsWithModId('fs:removeFile', { path }),
    removeDir: (path) => fsWithModId('fs:removeDir', { path }),
    move: (from, to) => fsWithModId('fs:move', { from, to }),
  },
  
  // Shell API - automatically uses current mod's ID
  shell: {
    run: (command, cwd) => withModId('shell:run', { command, cwd }),
  },

  // Network, notifications, and native pickers - automatically uses current mod's ID
  net: {
    fetch: (url) => withModId('net:fetch', { url }),
  },
  notifications: {
    send: (title, body) => withModId('notifications:send', { title, body }),
  },
  dialog: {
    pickFolder: (options) => withModId('dialog:pickFolder', options),
    pickFiles: (options) => withModId('dialog:pickFiles', options),
    pickSaveFile: (options) => withModId('dialog:pickSaveFile', options),
  },

  pty: (() => {
    let nextListenerId = 0;
    const listeners = new Map();
    return {
      listShells: () => withModId('pty:listShells'),
      spawn: (options) => withModId('pty:spawn', options),
      write: (session, data) => withModId('pty:write', { session, data }),
      resize: (session, cols, rows) => withModId('pty:resize', { session, cols, rows }),
      kill: (session) => withModId('pty:kill', { session }),
      listen: (session, onData, onExit) => {
        const modId = currentModId;
        const id = String(++nextListenerId);
        const dataListener = (_event, payload) => {
          if (payload.modId === modId && payload.session === session) onData(payload.data);
        };
        const exitListener = (_event, payload) => {
          if (payload.modId === modId && payload.session === session) onExit(payload.exitCode);
        };
        ipcRenderer.on('pty:data', dataListener);
        ipcRenderer.on('pty:exit', exitListener);
        listeners.set(id, [dataListener, exitListener]);
        return id;
      },
      unlisten: (id) => {
        const [dataListener, exitListener] = listeners.get(id) || [];
        if (dataListener) ipcRenderer.removeListener('pty:data', dataListener);
        if (exitListener) ipcRenderer.removeListener('pty:exit', exitListener);
        listeners.delete(id);
      },
    };
  })(),

  // Webview API (mod-embedded native browser views) - automatically uses current mod's ID
  webview: {
    create: (instance, url, x, y, width, height) =>
      withModId('webview:create', { instance, url, x, y, width, height }),
    close: (instance) => withModId('webview:close', { instance }),
  },
  
});