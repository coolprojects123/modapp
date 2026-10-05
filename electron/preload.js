const { contextBridge, ipcRenderer } = require('electron');

const MOD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// fs calls report a missing file as { __fsError } (see main.js) so the main process doesn't log a stack trace;
// turn it back into a normal rejected promise here.
async function fsInvoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (result && typeof result === 'object' && result.__fsError) {
    throw Object.assign(new Error(result.__fsError.message), { code: result.__fsError.code });
  }
  return result;
}

// There is no "current mod" here. Every permissioned call is made through an API object that is bound to ONE
// mod id (electronAPI.forMod(id)), and the id is sent explicitly with each message. Nothing is shared or
// defaulted, so a call can never silently run as some other mod (or as core).
let nextListenerId = 0;
const ptyListeners = new Map();

function createBoundApi(modId) {
  // modId goes last so a payload can never override it.
  const call = (channel, payload) => ipcRenderer.invoke(channel, { ...payload, modId });
  const fsCall = (channel, payload) => fsInvoke(channel, { ...payload, modId });

  return Object.freeze({
    toggleMod: (id) => call('mods:toggle', { id }),
    readSettings: () => call('settings:read'),
    writeSettings: (changes) => call('settings:write', { changes }),

    fs: {
      ensureDir: (path) => fsCall('fs:ensureDir', { path }),
      readFile: (path) => fsCall('fs:readFile', { path }),
      readBytes: (path) => fsCall('fs:readBytes', { path }),
      writeFile: (path, content) => fsCall('fs:writeFile', { path, content }),
      writeBytes: (path, content) => fsCall('fs:writeBytes', { path, content: Array.from(content) }),
      readDir: (path) => fsCall('fs:readDir', { path }),
      exists: (path) => fsCall('fs:exists', { path }),
      resolvePath: (path) => fsCall('fs:resolvePath', { path }),
      toFileUrl: (path) => fsCall('fs:toFileUrl', { path }),
      removeFile: (path) => fsCall('fs:removeFile', { path }),
      removeDir: (path) => fsCall('fs:removeDir', { path }),
      move: (from, to) => fsCall('fs:move', { from, to }),
    },

    shell: {
      run: (command, cwd) => call('shell:run', { command, cwd }),
    },
    net: {
      fetch: (url) => call('net:fetch', { url }),
    },
    notifications: {
      send: (title, body) => call('notifications:send', { title, body }),
    },
    dialog: {
      pickFolder: (options) => call('dialog:pickFolder', options),
      pickFiles: (options) => call('dialog:pickFiles', options),
      pickSaveFile: (options) => call('dialog:pickSaveFile', options),
    },

    pty: {
      listShells: () => call('pty:listShells'),
      spawn: (options) => call('pty:spawn', options),
      write: (session, data) => call('pty:write', { session, data }),
      resize: (session, cols, rows) => call('pty:resize', { session, cols, rows }),
      kill: (session) => call('pty:kill', { session }),
      listen: (session, onData, onExit) => {
        const id = String(++nextListenerId);
        const dataListener = (_event, payload) => {
          if (payload.modId === modId && payload.session === session) onData?.(payload.data);
        };
        const exitListener = (_event, payload) => {
          if (payload.modId === modId && payload.session === session) onExit?.(payload.exitCode);
        };
        ipcRenderer.on('pty:data', dataListener);
        ipcRenderer.on('pty:exit', exitListener);
        ptyListeners.set(id, [dataListener, exitListener]);
        return id;
      },
      unlisten: (id) => {
        const [dataListener, exitListener] = ptyListeners.get(id) || [];
        if (dataListener) ipcRenderer.removeListener('pty:data', dataListener);
        if (exitListener) ipcRenderer.removeListener('pty:exit', exitListener);
        ptyListeners.delete(id);
      },
    },

    // Webview calls are permission gates: the renderer creates the <webview> element itself, and only plain
    // values cross the IPC boundary (never DOM nodes).
    webview: {
      create: ({ instance, url, x, y, width, height } = {}) =>
        call('webview:create', { instance, url, x, y, width, height }),
      close: ({ instance } = {}) => call('webview:close', { instance }),
      setVisible: ({ instance, visible } = {}) => call('webview:setVisible', { instance, visible }),
      setBounds: ({ instance, x, y, width, height } = {}) =>
        call('webview:setBounds', { instance, x, y, width, height }),
    },
  });
}

const boundApis = new Map();

contextBridge.exposeInMainWorld('electronAPI', {
  // Calls that need no mod identity.
  listMods: () => ipcRenderer.invoke('mods:list'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('updates:progress', listener);
    return () => ipcRenderer.removeListener('updates:progress', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),

  // Everything permissioned: electronAPI.forMod('music-player').fs.readFile(...)
  forMod: (modId) => {
    if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId)) throw new Error('invalid mod id');
    let api = boundApis.get(modId);
    if (!api) {
      api = createBoundApi(modId);
      boundApis.set(modId, api);
    }
    return api;
  },
});