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

// Centralized API for Electron
contextBridge.exposeInMainWorld('electronAPI', {
  // Mods API
  listMods: () => ipcRenderer.invoke('mods:list'),
  toggleMod: (modId, id) => ipcRenderer.invoke('mods:toggle', { modId, id }),
  
  // Settings API
  readSettings: (modId) => ipcRenderer.invoke('settings:read', { modId }),
  writeSettings: (modId, changes) => ipcRenderer.invoke('settings:write', { modId, changes }),

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  
  // FS API
  fs: {
    ensureDir: (modId, path) => fsInvoke('fs:ensureDir', { modId, path }),
    readFile: (modId, path) => fsInvoke('fs:readFile', { modId, path }),
    readBytes: (modId, path) => fsInvoke('fs:readBytes', { modId, path }),
    writeFile: (modId, path, content) => fsInvoke('fs:writeFile', { modId, path, content }),
    writeBytes: (modId, path, content) => fsInvoke('fs:writeBytes', { modId, path, content: Array.from(content) }),
    readDir: (modId, path) => fsInvoke('fs:readDir', { modId, path }),
    exists: (modId, path) => fsInvoke('fs:exists', { modId, path }),
    resolvePath: (modId, path) => fsInvoke('fs:resolvePath', { modId, path }),
    toFileUrl: (modId, path) => fsInvoke('fs:toFileUrl', { modId, path }),
    removeFile: (modId, path) => fsInvoke('fs:removeFile', { modId, path }),
    removeDir: (modId, path) => fsInvoke('fs:removeDir', { modId, path }),
    move: (modId, from, to) => fsInvoke('fs:move', { modId, from, to }),
  },
  
  // Shell API
  shell: {
    run: (modId, command, cwd) => ipcRenderer.invoke('shell:run', { modId, command, cwd }),
  },

  // Network, notifications, and native pickers
  net: {
    fetch: (modId, url) => ipcRenderer.invoke('net:fetch', { modId, url }),
  },
  notifications: {
    send: (modId, title, body) => ipcRenderer.invoke('notifications:send', { modId, title, body }),
  },
  dialog: {
    pickFolder: (modId, options) => ipcRenderer.invoke('dialog:pickFolder', { modId, ...options }),
    pickFiles: (modId, options) => ipcRenderer.invoke('dialog:pickFiles', { modId, ...options }),
    pickSaveFile: (modId, options) => ipcRenderer.invoke('dialog:pickSaveFile', { modId, ...options }),
  },

  pty: (() => {
    let nextListenerId = 0;
    const listeners = new Map();
    return {
      listShells: (modId) => ipcRenderer.invoke('pty:listShells', { modId }),
      spawn: (options) => ipcRenderer.invoke('pty:spawn', options),
      write: (modId, session, data) => ipcRenderer.invoke('pty:write', { modId, session, data }),
      resize: (modId, session, cols, rows) => ipcRenderer.invoke('pty:resize', { modId, session, cols, rows }),
      kill: (modId, session) => ipcRenderer.invoke('pty:kill', { modId, session }),
      listen: (modId, session, onData, onExit) => {
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

  // Webview API (mod-embedded native browser views)
  webview: {
    create: (modId, instance, url, x, y, width, height) =>
      ipcRenderer.invoke('webview:create', { modId, instance, url, x, y, width, height }),
    close: (modId, instance) => ipcRenderer.invoke('webview:close', { modId, instance }),
  },
  
});