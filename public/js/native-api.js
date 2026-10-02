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
    forMod(modId) {
      assertId('mod id', modId);
      const api = window.electronAPI.fs;
      return {
        ensureDir: (path) => api.ensureDir(modId, path),
        readFile: (path) => api.readFile(modId, path),
        readBytes: async (path) => new Uint8Array(await api.readBytes(modId, path)),
        writeFile: (path, content) => api.writeFile(modId, path, content),
        writeBytes: (path, bytes) => api.writeBytes(modId, path, bytes),
        readDir: (path = '') => api.readDir(modId, path),
        listDir: (path = '') => api.readDir(modId, path),
        exists: (path) => api.exists(modId, path),
        resolvePath: (path) => api.resolvePath(modId, path),
        toFileUrl: (path) => api.toFileUrl(modId, path),
        removeFile: (path) => api.removeFile(modId, path),
        removeDir: (path) => api.removeDir(modId, path),
        move: (from, to) => api.move(modId, from, to),
      };
    },
  };
  Object.assign(fs, fs.forMod('music-player'));

  const settings = {
    read: () => window.electronAPI?.readSettings ? window.electronAPI.readSettings('core') : unavailable(),
    write: (changes) => window.electronAPI?.writeSettings ? window.electronAPI.writeSettings('core', changes) : unavailable(),
  };
  const mods = {
    list: () => window.electronAPI?.listMods ? window.electronAPI.listMods() : unavailable(),
    toggle: (modId) => window.electronAPI?.toggleMod ? window.electronAPI.toggleMod('core', modId) : unavailable(),
  };
  const shell = {
    forMod(modId) {
      assertId('mod id', modId);
      return { run: (command, cwd = '') => window.electronAPI?.shell ? window.electronAPI.shell.run(modId, command, cwd) : unavailable() };
    },
    run: (command, cwd = '') => shell.forMod('ide').run(command, cwd),
  };
  const net = {
    fetch: (modId, url) => {
      assertId('mod id', modId);
      return window.electronAPI?.net ? window.electronAPI.net.fetch(modId, url) : unavailable();
    },
  };
  const notifications = {
    send: (modId, title, body = '') => {
      assertId('mod id', modId);
      return window.electronAPI?.notifications ? window.electronAPI.notifications.send(modId, title, body) : unavailable();
    },
  };
  const dialog = {
    pickFolder: (modId, options = {}) => window.electronAPI?.dialog ? window.electronAPI.dialog.pickFolder(modId, options) : unavailable(),
    pickFiles: (modId, options = {}) => window.electronAPI?.dialog ? window.electronAPI.dialog.pickFiles(modId, options) : unavailable(),
    pickSaveFile: (modId, options = {}) => window.electronAPI?.dialog ? window.electronAPI.dialog.pickSaveFile(modId, options) : unavailable(),
  };
  const pty = {
    forMod(modId) {
      assertId('mod id', modId);
      const api = window.electronAPI?.pty;
      if (!api) return { shells: unavailable, open: unavailable, write: unavailable, resize: unavailable };
      return {
        shells: () => api.listShells(modId),
        async open({ shell: shellId, cols, rows, cwd, onData, onExit }) {
          const random = new Uint8Array(16);
          crypto.getRandomValues(random);
          const session = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
          const listenerId = api.listen(modId, session, onData, onExit);
          try {
            const label = await api.spawn({ modId, session, shellId: shellId || null, cols, rows, cwd: cwd || null });
            return {
              session,
              label,
              close: async () => {
                api.unlisten(listenerId);
                await api.kill(modId, session).catch(() => {});
              },
            };
          } catch (error) {
            api.unlisten(listenerId);
            throw error;
          }
        },
        write: (session, data) => api.write(modId, session, data),
        resize: (session, cols, rows) => api.resize(modId, session, cols, rows),
      };
    },
  };
  const updates = {
    check: () => window.electronAPI?.checkForUpdates ? window.electronAPI.checkForUpdates() : unavailable(),
    install: () => window.electronAPI?.installUpdate ? window.electronAPI.installUpdate() : unavailable(),
  };
  const webviews = new Map();
  const webviewKey = (modId, instance) => `${modId}:${instance}`;
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
    async create(modId, instance, arg1, arg2, arg3, arg4, arg5, arg6) {
      const spec = normalizeWebviewSpec(arg1, {
        x: arg2,
        y: arg3,
        width: arg4,
        height: arg5,
        container: arg6,
      });
      const { url, container } = spec;
      assertId('mod id', modId);
      assertId('webview instance', instance);
      assertWebUrl(url);
      if (!(container instanceof HTMLElement)) throw new Error('An HTML container is required for an Electron webview.');
      const key = webviewKey(modId, instance);
      if (webviews.has(key)) throw new Error(`webview '${key}' already exists`);
      // Permission check / registration only. Sizing is left to CSS: the tab
      // view is display:none while render() runs, so measuring it here gives 0.
      await window.electronAPI.webview.create(modId, instance, url);
      const element = document.createElement('webview');
      element.className = 'mod-native-webview';
      element.setAttribute('partition', `persist:mod-${modId}`);
      element.src = url;
      container.classList.add('mod-native-webview-host');
      container.appendChild(element);
      webviews.set(key, element);
    },
    async close(modId, instance) {
      await window.electronAPI.webview.close(modId, instance);
      webviews.get(webviewKey(modId, instance))?.remove();
      webviews.delete(webviewKey(modId, instance));
    },
    async setVisible(modId, instance, visible) {
      await window.electronAPI.webview.setVisible(modId, instance, visible);
      const element = webviews.get(webviewKey(modId, instance));
      if (element) element.style.visibility = visible ? 'visible' : 'hidden';
    },
    async setBounds(modId, instance, arg1, arg2, arg3, arg4) {
      // Only applied when a mod explicitly asks for a fixed rect; otherwise
      // the webview keeps filling its host via CSS.
      const element = webviews.get(webviewKey(modId, instance));
      if (element && [arg1, arg2, arg3, arg4].every((v) => typeof v === 'number')) {
        element.style.inset = 'auto';
        element.style.left = `${arg1}px`;
        element.style.top = `${arg2}px`;
        element.style.width = `${arg3}px`;
        element.style.height = `${arg4}px`;
      }
      await window.electronAPI.webview.setBounds(modId, instance, arg1, arg2, arg3, arg4);
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