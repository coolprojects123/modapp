/**
 * ModAPI.native: the renderer side of the native bridge.
 *
 * Every permissioned call goes straight to the backend through electronAPI.forMod(modId), with the id of the
 * mod that made the call sent explicitly. There is no shared "current mod" and no default to core: the core
 * mod is just another caller, and code that is not part of any mod cannot make permissioned calls at all.
 *
 * The caller is found from the call stack: the topmost frame whose script URL is inside a mod's own folder
 * (bootstrap.js records those folders in ModAPI._modBases). V8 includes async frames, so this also works from
 * timers, event handlers and code after an await.
 */
(function () {
  'use strict';

  const bridge = window.electronAPI;
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

  // ---- who is calling? ----
  function callerModId() {
    const bases = window.ModAPI?._modBases;
    if (!bases?.length) return null;
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    let stack = '';
    try { stack = new Error().stack || ''; } finally { Error.stackTraceLimit = limit; }
    for (const match of stack.matchAll(/(file:\/\/\/[^\s()]+?):\d+:\d+/g)) {
      const entry = bases.find(([base]) => match[1].startsWith(base));
      if (entry) return entry[1];
    }
    return null;
  }

  // Throws unless the call comes from a mod script. Must be called synchronously, before any await.
  function requireCaller() {
    if (!bridge) throw new Error('Native APIs are available in the Electron desktop build only.');
    const modId = callerModId();
    if (!modId) throw new Error('Native APIs can only be called from a mod script.');
    return modId;
  }

  // Runs use(boundApi) for the calling mod; always returns a promise.
  function call(use) {
    try {
      return Promise.resolve(use(bridge.forMod(requireCaller())));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const fs = {
    ensureDir: (path) => call((api) => api.fs.ensureDir(path)),
    readFile: (path) => call((api) => api.fs.readFile(path)),
    readBytes: async (path) => new Uint8Array(await call((api) => api.fs.readBytes(path))),
    writeFile: (path, content) => call((api) => api.fs.writeFile(path, content)),
    writeBytes: (path, bytes) => call((api) => api.fs.writeBytes(path, bytes)),
    readDir: (path = '') => call((api) => api.fs.readDir(path)),
    listDir: (path = '') => call((api) => api.fs.readDir(path)),
    exists: (path) => call((api) => api.fs.exists(path)),
    resolvePath: (path) => call((api) => api.fs.resolvePath(path)),
    toFileUrl: (path) => call((api) => api.fs.toFileUrl(path)),
    removeFile: (path) => call((api) => api.fs.removeFile(path)),
    removeDir: (path) => call((api) => api.fs.removeDir(path)),
    move: (from, to) => call((api) => api.fs.move(from, to)),
  };

  const settings = {
    read: () => call((api) => api.readSettings()),
    write: (changes) => call((api) => api.writeSettings(changes)),
  };
  const mods = {
    list: () => (bridge ? bridge.listMods() : unavailable()),
    toggle: (id) => call((api) => api.toggleMod(id)),
  };
  const shell = {
    run: (command, cwd = '') => call((api) => api.shell.run(command, cwd)),
  };
  const net = {
    fetch: (url) => call((api) => api.net.fetch(url)),
  };
  const notifications = {
    send: (title, body = '') => call((api) => api.notifications.send(title, body)),
  };
  const dialog = {
    pickFolder: (options = {}) => call((api) => api.dialog.pickFolder(options)),
    pickFiles: (options = {}) => call((api) => api.dialog.pickFiles(options)),
    pickSaveFile: (options = {}) => call((api) => api.dialog.pickSaveFile(options)),
  };

  const pty = {
    shells: () => call((api) => api.pty.listShells()),
    async open({ shell: shellId, cols, rows, cwd, onData, onExit } = {}) {
      // Bound once, so close() later still acts as the mod that opened the terminal.
      const api = bridge.forMod(requireCaller()).pty;
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
    write: (session, data) => call((api) => api.pty.write(session, data)),
    resize: (session, cols, rows) => call((api) => api.pty.resize(session, cols, rows)),
  };

  const updates = {
    check: () => (bridge?.checkForUpdates ? bridge.checkForUpdates() : unavailable()),
    install: () => (bridge?.installUpdate ? bridge.installUpdate() : unavailable()),
  };

  // ---- webviews ----
  // The backend only checks permission and registers the request; the <webview> element is created here.
  // Keys include the owning mod, and each method reads the caller once, up front (before any await).
  const webviews = new Map();
  function normalizeWebviewSpec(arg, fallback = {}) {
    if (arg && typeof arg === 'object' && !Array.isArray(arg) && 'url' in arg) return arg;
    if (typeof arg === 'string') return { url: arg, ...fallback };
    return { ...fallback };
  }
  const webview = {
    // Permission gate only, for mods that build their own <webview> element (e.g. the browser mod).
    authorize(instance, url) {
      try {
        assertId('webview instance', instance);
        assertWebUrl(url);
      } catch (error) {
        return Promise.reject(error);
      }
      return call((api) => api.webview.create({ instance, url }));
    },
    async create(instance, arg1, arg2, arg3, arg4, arg5, arg6) {
      const modId = requireCaller();
      const api = bridge.forMod(modId);
      const spec = normalizeWebviewSpec(arg1, { x: arg2, y: arg3, width: arg4, height: arg5, container: arg6 });
      const { url, container } = spec;
      assertId('webview instance', instance);
      assertWebUrl(url);
      if (!(container instanceof HTMLElement)) throw new Error('An HTML container is required for an Electron webview.');
      const key = `${modId}:${instance}`;
      if (webviews.has(key)) throw new Error(`webview '${key}' already exists`);
      // Sizing is left to CSS: the tab view is display:none while render() runs, so measuring it here gives 0.
      await api.webview.create({ instance, url });
      const element = document.createElement('webview');
      element.className = 'mod-native-webview';
      element.setAttribute('partition', `persist:mod-${modId}`);
      // No nodeintegration / allowpopups / contextisolation attributes: Electron treats them as boolean
      // attributes, so their mere presence turns them ON. main.js's will-attach-webview locks them down.
      element.src = url;
      container.classList.add('mod-native-webview-host');
      container.appendChild(element);
      webviews.set(key, element);
    },
    async close(instance) {
      const modId = requireCaller();
      const key = `${modId}:${instance}`;
      await bridge.forMod(modId).webview.close({ instance });
      webviews.get(key)?.remove();
      webviews.delete(key);
    },
    async setVisible(instance, visible) {
      const modId = requireCaller();
      const key = `${modId}:${instance}`;
      await bridge.forMod(modId).webview.setVisible({ instance, visible });
      const element = webviews.get(key);
      if (element) element.style.visibility = visible ? 'visible' : 'hidden';
    },
    async setBounds(instance, arg1, arg2, arg3, arg4) {
      const modId = requireCaller();
      const key = `${modId}:${instance}`;
      const element = webviews.get(key);
      const host = element?.parentElement;
      if (host && [arg1, arg2, arg3, arg4].every((v) => typeof v === 'number')) {
        // Mods give bounds in window coordinates (e.g. getBoundingClientRect() of their container); the
        // <webview> is an absolutely positioned child of that container, so convert to host-relative ones.
        const hostRect = host.getBoundingClientRect();
        if (hostRect.width > 0 && hostRect.height > 0) {
          element.style.inset = 'auto';
          element.style.left = `${arg1 - hostRect.left - host.clientLeft}px`;
          element.style.top = `${arg2 - hostRect.top - host.clientTop}px`;
          element.style.width = `${arg3}px`;
          element.style.height = `${arg4}px`;
        }
      }
      await bridge.forMod(modId).webview.setBounds({ instance, x: arg1, y: arg2, width: arg3, height: arg4 });
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
  window.appAPI = bridge ? {
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