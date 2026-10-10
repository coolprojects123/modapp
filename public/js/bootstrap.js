/**
 * bootstrap.js — the engine, not the site.
 *
 * This file's only job is: load which mods are enabled, inject their CSS/JS
 * in order, and expose the ModAPI surface mods build on.
 * It has no opinion about what the site looks like or which tabs exist —
 * that's entirely up to whichever mods are loaded. Delete every mod and
 * this file renders an empty page.
 */

// Check if ModAPI already exists. If so, extend it; otherwise create a new one.
if (!window.ModAPI) {
  window.ModAPI = {};
}

// Store existing native API if present
const existingNativeAPI = window.ModAPI.native;

// Create or extend ModAPI
const modAPIImpl = (function () {
  const tabs = new Map();          // id -> { id, label, icon, render, source }
  const widgets = new Map();       // id -> { id, label, icon, mount, source }
  const overrides = new Map();     // id -> render fn
  const overrideOptions = new Map(); // id -> { fullBleed } (only what the overriding mod asked for)
  const activateHooks = new Map(); // id -> [fn, fn, ...]
  let identity = { title: 'modapp', icon: 'M' };
  let modAssetBase = null;
  let modId = null;

  // Everything a mod registers is remembered here so it can be taken back out when the mod is unloaded
  // (disabled, deleted or replaced) without reloading the whole page.
  const cleanups = new Map(); // mod id -> [fn]
  const track = (owner, fn) => {
    if (!owner) return;
    if (!cleanups.has(owner)) cleanups.set(owner, []);
    cleanups.get(owner).push(fn);
  };

  return {
    get modId() { return modId; },
    _setModId(id) { modId = id; },
    _setModAssetBase(base) { modAssetBase = base; },

    // Call while your script loads. fn runs when the mod is disabled, deleted or replaced: stop timers,
    // close terminals and sockets, remove listeners you added to document or window.
    onUnload(fn) { if (typeof fn === 'function') track(modId, fn); },

    // Runs a mod's cleanups and removes its stylesheets and script tags. Called by refreshMods().
    _unloadMod(id) {
      const list = cleanups.get(id) || [];
      cleanups.delete(id);
      for (const fn of list.reverse()) {
        try { fn(); } catch (err) { console.error(`[mods] cleanup for "${id}" failed:`, err); }
      }
      document.querySelectorAll(`link[data-mod-id="${CSS.escape(id)}"], script[data-mod-id="${CSS.escape(id)}"]`)
        .forEach((element) => element.remove());
    },

    // Puts tabs and widgets back in mod load order (the order saved by the Mods panel).
    _applyOrder(order) {
      const rank = (source) => { const index = order.indexOf(source); return index < 0 ? order.length : index; };
      for (const map of [tabs, widgets]) {
        const sorted = [...map.entries()].sort((a, b) => rank(a[1].source) - rank(b[1].source));
        map.clear();
        for (const [key, value] of sorted) map.set(key, value);
      }
    },

    setIdentity({ title, icon } = {}) {
      if (typeof title === 'string' && title.trim()) identity.title = title.trim();
      if (typeof icon === 'string' && icon.trim()) {
        const value = icon.trim();
        const isImageReference = /^(?:\.{0,2}\/|https?:|file:|data:image\/)/i.test(value);
        identity.icon = modAssetBase && isImageReference ? new URL(value, modAssetBase).href : value;
      }
      document.dispatchEvent(new CustomEvent('mods:identity-changed', { detail: { ...identity } }));
    },

    get identity() { return { ...identity }; },

    // Native API - use the Electron bridge if available.
    native: existingNativeAPI || {
      // Native embedded webviews (e.g. an in-app browser tab). Gated by the
      // single 'webview.access' permission in the calling mod's mod.json —
      // same permission for create/close/show/hide/reposition, since a mod
      // that can create one can reasonably manage the ones it created.
      // `instance` namespaces multiple webviews from the same mod (e.g. one
      // per open browser tab); each instance remains scoped to its owning mod.
      webview: {
        create(modIdArg, instance, { url, x, y, width, height, container } = {}) {
          if (!window.appAPI?.webview) {
            return Promise.reject(new Error('Native APIs are available in the desktop build only.'));
          }
          return window.appAPI.webview.create(modIdArg, instance, url, x, y, width, height, container);
        },
        close(modIdArg, instance) {
          if (!window.appAPI?.webview) {
            return Promise.reject(new Error('Native APIs are available in the desktop build only.'));
          }
          return window.appAPI.webview.close(modIdArg, instance);
        },
        setVisible(modIdArg, instance, visible) {
          if (!window.appAPI?.webview) {
            return Promise.reject(new Error('Native APIs are available in the desktop build only.'));
          }
          return window.appAPI.webview.setVisible(modIdArg, instance, visible);
        },
        setBounds(modIdArg, instance, { x, y, width, height } = {}) {
          if (!window.appAPI?.webview) {
            return Promise.reject(new Error('Native APIs are available in the desktop build only.'));
          }
          return window.appAPI.webview.setBounds(modIdArg, instance, x, y, width, height);
        },
      },
    },

    // Adds a brand new tab. render(container) is called once, the first time
    // the tab is opened; after that the same view is just shown and hidden.
    //   fullBleed: true -> the tab gets the whole content area (no padding, no
    //                      max-width, fills the height). The shell has no idea
    //                      which tabs want that; a tab has to ask.
    registerTab({ id, label, icon, render, fullBleed }) {
      if (!id || typeof render !== 'function') {
        console.warn('[ModAPI] registerTab requires an id and a render(container) function');
        return;
      }
      if (tabs.has(id) && tabs.get(id).source !== modId) {
        console.warn(`[ModAPI] tab "${id}" from "${modId}" replaces the tab registered by "${tabs.get(id).source}"`);
      }
      const owner = modId;
      track(owner, () => {
        if (tabs.get(id)?.source !== owner) return;
        tabs.delete(id);
        document.dispatchEvent(new CustomEvent('mods:tab-removed', { detail: { id } }));
      });
      tabs.set(id, { id, label: label || id, icon: icon || '\u{1F9E9}', render, fullBleed: !!fullBleed, source: modId });
      document.dispatchEvent(new CustomEvent('mods:tabs-changed'));
    },

    // Adds a floating panel toggled from a topbar button.
    //   center: true    -> centered instead of cascading from the top-left
    //   draggable: false -> locks position (implied by center)
    //   overlay: true    -> dims the page behind it; click-outside or Esc closes it
    //   width / height   -> explicit size (e.g. '420px'), instead of a mod
    //                       having to reach into its own panel's DOM to resize it
    //   noChrome: true   -> skip the generic title+close header; mount()
    //                       gets the whole panel and is responsible for its
    //                       own close affordance (call the passed close())
    registerWidget({ id, label, icon, mount, center, draggable, overlay, width, height, noChrome, onOpen, onClose }) {
      if (!id || typeof mount !== 'function') {
        console.warn('[ModAPI] registerWidget requires an id and a mount(container) function');
        return;
      }
      const owner = modId;
      track(owner, () => {
        if (widgets.get(id)?.source !== owner) return;
        widgets.delete(id);
        document.dispatchEvent(new CustomEvent('mods:widget-removed', { detail: { id } }));
      });
      widgets.set(id, {
        id,
        label: label || id,
        icon: icon || '\u{1F4CC}',
        mount,
        center: !!center,
        draggable: draggable !== false,
        overlay: !!overlay,
        width: width || null,
        height: height || null,
        noChrome: !!noChrome,
        onOpen: typeof onOpen === 'function' ? onOpen : null,
        onClose: typeof onClose === 'function' ? onClose : null,
        source: modId,
      });
      document.dispatchEvent(new CustomEvent('mods:widgets-changed'));
    },

    // Fully replaces how an existing tab (core or another mod's) renders.
    // options.fullBleed, if given, replaces the tab's own fullBleed setting.
    overrideTab(id, render, options = {}) {
      if (typeof render !== 'function') {
        console.warn('[ModAPI] overrideTab requires a render(container) function');
        return;
      }
      const owner = modId;
      track(owner, () => {
        if (overrides.get(id) !== render) return;
        overrides.delete(id);
        overrideOptions.delete(id);
      });
      overrides.set(id, render);
      if (options && typeof options.fullBleed === 'boolean') overrideOptions.set(id, { fullBleed: options.fullBleed });
      else overrideOptions.delete(id);
    },

    // Fires every time the given tab activates, after it renders — for
    // layering a widget/banner on top without owning the whole tab.
    onTabActivate(id, fn) {
      if (!activateHooks.has(id)) activateHooks.set(id, []);
      activateHooks.get(id).push(fn);
      track(modId, () => {
        const list = activateHooks.get(id);
        const index = list ? list.indexOf(fn) : -1;
        if (index >= 0) list.splice(index, 1);
      });
    },

    // -- internal, read by whichever mod is building the shell --
    _tabs: tabs,
    _widgets: widgets,
    _overrides: overrides,
    _overrideOptions: overrideOptions,
    _activateHooks: activateHooks,
  };
})();

// Merge the implementation with any existing ModAPI properties.
// This preserves ModAPI.native that was set by the Electron bridge.
// Uses defineProperties (not Object.assign) because modId and identity are
// accessor getters on modAPIImpl -- Object.assign would invoke each getter
// once and copy the resulting value as a static property, permanently
// freezing modId at whatever it was (null, at this point, since no mod has
// loaded yet) instead of staying live as mods load one by one.
Object.defineProperties(window.ModAPI, Object.getOwnPropertyDescriptors(modAPIImpl));

// Asset paths in mod.json must stay inside the mod's own folder: no
// absolute paths, schemes or drive letters, and no ".." segments (also
// checked after percent-decoding, since URL parsing treats %2e%2e as "..").
function safeModPath(modId, src) {
  let decoded = null;
  try { decoded = typeof src === 'string' ? decodeURIComponent(src) : null; } catch (err) { /* stays null */ }
  const ok = decoded !== null
    && decoded.length > 0
    && !/^[\\/]/.test(decoded)
    && !/^[a-z][a-z0-9+.-]*:/i.test(decoded)
    && !decoded.split(/[\\/]/).includes('..');
  if (!ok) console.warn(`[mods] "${modId}" has an invalid asset path in mod.json: ${JSON.stringify(src)}`);
  return ok;
}

const loadedMods = new Map(); // id -> manifest, for every mod that is currently running

function assetUrl(mod, file, bust) {
  const url = mod.assetBase ? `${mod.assetBase}${file}` : `../mods/${mod.id}/${file}`;
  return bust ? `${url}?v=${bust}` : url; // a changed version of a mod must not come from the cache
}

async function runModScripts(mod, files, kind, bust) {
  for (const src of files || []) {
    if (!safeModPath(mod.id, src)) continue;
    window.ModAPI._setModId(mod.id);
    window.ModAPI._setModAssetBase(mod.assetBase || null);
    try {
      await loadScript(assetUrl(mod, src, bust), mod.id);
    } catch (err) {
      console.error(`[mods] failed to load ${kind} for "${mod.id}":`, err);
    }
  }
}

function addModStyles(mod, bust) {
  for (const href of mod.styles || []) {
    if (!safeModPath(mod.id, href)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = assetUrl(mod, href, bust);
    link.dataset.modId = mod.id;
    document.head.appendChild(link);
  }
}

const modBases = (mods) => mods.filter((mod) => mod.assetBase).map((mod) => [mod.assetBase, mod.id]);

async function loadMods() {
  if (window.nativeAPIReady) await window.nativeAPIReady;

  // Store full manifests for core mod to access enabled/disabled state
  if (!window.appAPI) {
    window.MOD_MANIFESTS_FULL = window.MOD_MANIFESTS.map((mod) => ({
      ...mod,
      core: mod.id === 'core'
    }));
  }

  const mods = window.appAPI
    ? (await window.appAPI.listMods()).filter((mod) => mod.enabled)
    : window.MOD_MANIFESTS_FULL.filter((mod) => mod.core || mod.enabled);

  mods.sort((a, b) => (b.core === true) - (a.core === true));

  // [assetBase, modId] pairs. native-api.js uses these to work out which mod a native call came from
  // (by finding the mod's own script URL in the call stack) and sends that id to the backend explicitly.
  window.ModAPI._modBases = modBases(mods);

  for (const mod of mods) await runModScripts(mod, mod.apis, 'API');
  for (const mod of mods) addModStyles(mod);
  // Scripts load sequentially so each mod can rely on earlier mods having run.
  for (const mod of mods) await runModScripts(mod, mod.scripts, 'script');

  window.ModAPI._setModId(null);
  window.ModAPI._setModAssetBase(null);
  for (const mod of mods) loadedMods.set(mod.id, mod);

  return mods;
}

// Applies mod changes (enable, disable, install, delete, replace, reorder) to the running app instead of
// reloading the page, so open tabs, playing music, terminals and webviews in the other mods keep going.
//   reload: ids of mods whose files were replaced; they are unloaded and loaded again.
let refreshQueue = Promise.resolve();
function refreshMods(options) {
  const run = refreshQueue.then(() => applyModChanges(options));
  refreshQueue = run.catch(() => {});
  return run;
}

async function applyModChanges({ reload = [] } = {}) {
  if (!window.appAPI?.listMods) return { loaded: [], unloaded: [] };
  const all = await window.appAPI.listMods();
  const desired = all.filter((mod) => mod.enabled);
  const wanted = new Set(desired.map((mod) => mod.id));
  // A mod whose files were replaced on disk (same id, new stamp) is reloaded without being told to.
  const reloading = new Set([
    ...reload,
    ...desired
      .filter((mod) => loadedMods.has(mod.id) && mod.stamp !== undefined && loadedMods.get(mod.id).stamp !== mod.stamp)
      .map((mod) => mod.id),
  ]);

  const drop = [...loadedMods.keys()].filter((id) => id !== 'core' && (!wanted.has(id) || reloading.has(id)));
  for (const id of drop) {
    window.ModAPI._unloadMod(id);
    loadedMods.delete(id);
  }

  window.ModAPI._modBases = modBases(desired); // new mods need to be recognised before their code runs
  const fresh = desired.filter((mod) => !loadedMods.has(mod.id));
  const bust = Date.now();
  for (const mod of fresh) await runModScripts(mod, mod.apis, 'API', bust);
  for (const mod of fresh) addModStyles(mod, bust);
  for (const mod of fresh) await runModScripts(mod, mod.scripts, 'script', bust);
  window.ModAPI._setModId(null);
  window.ModAPI._setModAssetBase(null);
  for (const mod of fresh) loadedMods.set(mod.id, mod);

  window.ModAPI._applyOrder(desired.map((mod) => mod.id));
  document.dispatchEvent(new CustomEvent('mods:tabs-changed'));
  document.dispatchEvent(new CustomEvent('mods:widgets-changed'));
  document.dispatchEvent(new CustomEvent('mods:refreshed', {
    detail: { loaded: fresh.map((mod) => mod.id), unloaded: drop },
  }));
  return { loaded: fresh.map((mod) => mod.id), unloaded: drop };
}
window.ModAPI.refreshMods = refreshMods;

function loadScript(src, modId) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.dataset.dynamic = 'true';
    if (modId) script.dataset.modId = modId;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

(async function boot() {
  const mods = await loadMods();
  // Every mod script has now run and had a chance to register tabs/widgets.
  // site.js listens for this to build the nav/widget-bar from whatever
  // got registered.
  document.dispatchEvent(new CustomEvent('mods:ready', { detail: mods }));
})();