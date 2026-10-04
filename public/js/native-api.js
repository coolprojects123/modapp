(function () {
  'use strict';

  const unavailable = () => Promise.reject(new Error('Native APIs are available in the Electron desktop build only.'));
  const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
  const assertId = (kind, value) => {
    if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`Invalid ${kind}.`);
  };
  const assertWebUrl = (value) => {
    let url;
    try { url = new URL(value); } catch { throw new Error('Invalid webview URL.'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs can be opened in a mod webview.');
  };

  const fs = {
    // Each mod automatically uses its own ID - no forMod() needed
    ensureDir: (path) => window.electronAPI.fs.ensureDir(path),
    readFile: (path) => window.electronAPI.fs.readFile(path),
    readBytes: async (path) => new Uint8Array(await window.electronAPI.fs.readBytes(path)),
    writeFile: (path, content) => window.electronAPI.fs.writeFile(path, content),
    writeBytes: (path, bytes) => window.electronAPI.fs.writeBytes(path, bytes),
    readDir: (path = '') => window.electronAPI.fs.readDir(path),
    listDir: (path = '') => window.electronAPI.fs.readDir(path),
    exists: (path) => window.electronAPI.fs.exists(path),
    resolvePath: (path) => window.electronAPI.fs.resolvePath(path),
    toFileUrl: (path) => window.electronAPI.fs.toFileUrl(path),
    removeFile: (path) => window.electronAPI.fs.removeFile(path),
    removeDir: (path) => window.electronAPI.fs.removeDir(path),
    move: (from, to) => window.electronAPI.fs.move(from, to),
  };

  const settings = {
    // Each mod automatically uses its own ID
    read: () => window.electronAPI?.readSettings ? window.electronAPI.readSettings() : unavailable(),
    write: (changes) => window.electronAPI?.writeSettings ? window.electronAPI.writeSettings(changes) : unavailable(),
  };
  const mods = {
    list: () => window.electronAPI?.listMods ? window.electronAPI.listMods() : unavailable(),
    toggle: (id) => window.electronAPI?.toggleMod ? window.electronAPI.toggleMod(id) : unavailable(),
  };
  const shell = {
    // Each mod automatically uses its own ID - no forMod() needed
    run: (command, cwd = '') => window.electronAPI?.shell ? window.electronAPI.shell.run(command, cwd) : unavailable(),
  };
  const net = {
    // Each mod automatically uses its own ID
    fetch: (url) => window.electronAPI?.net ? window.electronAPI.net.fetch(url) : unavailable(),
  };
  const notifications = {
    // Each mod automatically uses its own ID
    send: (title, body = '') => window.electronAPI?.notifications ? window.electronAPI.notifications.send(title, body) : unavailable(),
  };
  const dialog = {
    // Each mod automatically uses its own ID
    pickFolder: (options = {}) => window.electronAPI?.dialog ? window.electronAPI.dialog.pickFolder(options) : unavailable(),
    pickFiles: (options = {}) => window.electronAPI?.dialog ? window.electronAPI.dialog.pickFiles(options) : unavailable(),
    pickSaveFile: (options = {}) => window.electronAPI?.dialog ? window.electronAPI.dialog.pickSaveFile(options) : unavailable(),
  };
  // PTY API - Each mod automatically uses its own ID - no forMod() needed
  // This creates a factory that returns the PTY API for the current mod
  function createPtyApi() {
    const api = window.electronAPI?.pty;
    if (!api) return { shells: unavailable, open: unavailable, write: unavailable, resize: unavailable };
    return {
      shells: () => api.listShells(),
      async open({ shell: shellId, cols, rows, cwd, onData, onExit }) {
        const random = new Uint8Array(16);
        crypto.getRandomValues(random);
        const session = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
        const listenerId = api.listen(session, onData, onExit);
        try {
          const label = await api.spawn({ session, shellId: shellId || null, cols, rows, cwd: cwd || null });
          return {
            session,
            label,
            close: async () => {
              api.unlisten(listenerId);
              await api.kill(session).catch(() => {});
            },
          };
        } catch (error) {
          api.unlisten(listenerId);
          throw error;
        }
      },
      write: (session, data) => api.write(session, data),
      resize: (session, cols, rows) => api.resize(session, cols, rows),
    };
  }
  const pty = createPtyApi();
  const updates = {
    check: () => window.electronAPI?.checkForUpdates ? window.electronAPI.checkForUpdates() : unavailable(),
    install: () => window.electronAPI?.installUpdate ? window.electronAPI.installUpdate() : unavailable(),
  };
  const webviews = new Map();
  const webviewKey = (instance) => {
    const modId = window.modContext?.getModId?.() || 'core';
    return `${modId}:${instance}`;
  };
  function normalizeWebviewSpec(arg, fallback = {}) {
    if (arg && typeof arg === 'object' && !Array.isArray(arg) && 'url' in arg) {
      return arg;
    }
    if (typeof arg === 'string') {
      return { url: arg, ...fallback };
    }
    return { ...fallback };
  }
  const webview = {
    async create(instance, arg1, arg2, arg3, arg4, arg5, arg6) {
      const modId = getCurrentModId();
      const spec = normalizeWebviewSpec(arg1, {
        x: arg2,
        y: arg3,
        width: arg4,
        height: arg5,
        container: arg6,
      });
      const { url, container } = spec;
      assertId('webview instance', instance);
      assertWebUrl(url);
      if (!(container instanceof HTMLElement)) throw new Error('An HTML container is required for an Electron webview.');
      const key = webviewKey(instance);
      if (webviews.has(key)) throw new Error(`webview '${key}' already exists`);
      // Permission check / registration only. Sizing is left to CSS: the tab
      // view is display:none while render() runs, so measuring it here gives 0.
      await window.electronAPI.webview.create({ instance, url });
      const element = document.createElement('webview');
      element.className = 'mod-native-webview';
      element.setAttribute('partition', `persist:mod-${modId}`);
      
      // Security: Disable Node.js integration and enable context isolation
      element.setAttribute('nodeintegration', 'false');
      element.setAttribute('contextisolation', 'true');
      element.setAttribute('webgl', 'false');
      element.setAttribute('allowpopups', 'false');
      element.setAttribute('nodeintegrationinsubframes', 'false');
      element.setAttribute('nodeintegrationinworker', 'false');
      
      element.src = url;
      container.classList.add('mod-native-webview-host');
      container.appendChild(element);
      webviews.set(key, element);
    },
    async close(instance) {
      const modId = window.modContext?.getModId?.() || 'core';
      await window.electronAPI.webview.close({ instance });
      webviews.get(webviewKey(instance))?.remove();
      webviews.delete(webviewKey(instance));
    },
    async setVisible(instance, visible) {
      const modId = window.modContext?.getModId?.() || 'core';
      await window.electronAPI.webview.setVisible({ instance, visible });
      const element = webviews.get(webviewKey(instance));
      if (element) element.style.visibility = visible ? 'visible' : 'hidden';
    },
    async setBounds(instance, arg1, arg2, arg3, arg4) {
      const modId = window.modContext?.getModId?.() || 'core';
      // Only applied when a mod explicitly asks for a fixed rect; otherwise
      // the webview keeps filling its host via CSS.
      const element = webviews.get(webviewKey(instance));
      if (element && [arg1, arg2, arg3, arg4].every((v) => typeof v === 'number')) {
        element.style.inset = 'auto';
        element.style.left = `${arg1}px`;
        element.style.top = `${arg2}px`;
        element.style.width = `${arg3}px`;
        element.style.height = `${arg4}px`;
      }
      await window.electronAPI.webview.setBounds({ instance, x: arg1, y: arg2, width: arg3, height: arg4 });
    },
  };

  const nativeAPI = { fs, settings, mods, shell, net, notifications, dialog, pty, updates, webview };
  const unavailableAppAPI = {
    listMods: async () => [],
    toggleMod: async () => false,
    readSettings: async () => ({}),
    writeSettings: async () => ({}),
    webview: { create: unavailable, close: unavailable, setVisible: unavailable, setBounds: unavailable },
    fs, settings, mods, shell, net, notifications, dialog, pty,
  };

  window.nativeAPI = nativeAPI;
  window.ModAPI = window.ModAPI || {};
  window.ModAPI.native = nativeAPI;
  window.appAPI = window.electronAPI ? {
    listMods: mods.list,
    toggleMod: mods.toggle,
    readSettings: settings.read,
    writeSettings: settings.write,
    checkForUpdates: updates.check,
    installUpdate: updates.install,
    webview,
    fs, settings, mods, shell, net, notifications, dialog, pty, updates,
  } : unavailableAppAPI;
  window.nativeAPIReady = Promise.resolve(nativeAPI);
})();