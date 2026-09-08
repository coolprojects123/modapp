/**
 * bootstrap.js — the engine, not the site.
 *
 * This file's only job is: load which mods are enabled, inject their CSS/JS
 * in order, and expose the ModAPI surface mods build on.
 * It has no opinion about what the site looks like or which tabs exist —
 * that's entirely up to whichever mods are loaded. Delete every mod and
 * this file renders an empty page.
 */

window.ModAPI = (function () {
  const tabs = new Map();          // id -> { id, label, icon, render, source }
  const widgets = new Map();       // id -> { id, label, icon, mount, source }
  const overrides = new Map();     // id -> render fn
  const activateHooks = new Map(); // id -> [fn, fn, ...]
  let identity = { title: 'modapp', icon: 'M' };
  let modAssetBase = null;
  let modId = null;

  return {
    get modId() { return modId; },
    _setModId(id) { modId = id; },
    _setModAssetBase(base) { modAssetBase = base; },

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

    native: {
      // Deprecated: no backing command exists anymore (native_invoke was
      // removed). Kept only so a stale call fails with a clear message
      // instead of a bare "undefined is not a function".
      invoke(method, payload) {
        if (!window.appAPI?.invoke) {
          return Promise.reject(new Error(
            `ModAPI.native.invoke('${method}') is no longer available — use ModAPI.native.callBackend(modId, fn, args) instead.`
          ));
        }
        return window.appAPI.invoke(method, payload);
      },

      // The one bridge every mod's backend.lua is reached through. modId
      // must match the calling mod's own folder id — a mod cannot call
      // into another mod's backend, since call_mod_backend on the Rust
      // side loads that mod's own permissions and backend.lua only.
      callBackend(modIdArg, functionName, args = []) {
        if (!window.appAPI?.callBackend) {
          return Promise.reject(new Error('Native APIs are available in the desktop build only.'));
        }
        return window.appAPI.callBackend(modIdArg, functionName, args);
      },
    },

    // Adds a brand new tab. render(container) is called each time it's opened.
    registerTab({ id, label, icon, render }) {
      if (!id || typeof render !== 'function') {
        console.warn('[ModAPI] registerTab requires an id and a render(container) function');
        return;
      }
      tabs.set(id, { id, label: label || id, icon: icon || '\u{1F9E9}', render, source: modId });
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
    registerWidget({ id, label, icon, mount, center, draggable, overlay, width, height, noChrome }) {
      if (!id || typeof mount !== 'function') {
        console.warn('[ModAPI] registerWidget requires an id and a mount(container) function');
        return;
      }
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
        source: modId,
      });
      document.dispatchEvent(new CustomEvent('mods:widgets-changed'));
    },

    // Fully replaces how an existing tab (core or another mod's) renders.
    overrideTab(id, render) {
      if (typeof render !== 'function') {
        console.warn('[ModAPI] overrideTab requires a render(container) function');
        return;
      }
      overrides.set(id, render);
    },

    // Fires every time the given tab activates, after it renders — for
    // layering a widget/banner on top without owning the whole tab.
    onTabActivate(id, fn) {
      if (!activateHooks.has(id)) activateHooks.set(id, []);
      activateHooks.get(id).push(fn);
    },

    // -- internal, read by whichever mod is building the shell --
    _tabs: tabs,
    _widgets: widgets,
    _overrides: overrides,
    _activateHooks: activateHooks,
  };
})();

async function loadMods() {
  const mods = window.appAPI
    ? (await window.appAPI.listMods()).filter((mod) => mod.enabled)
    : window.MOD_MANIFESTS
      .map((mod) => ({ ...mod, core: mod.id === 'core' }))
      .filter((mod) => mod.core || mod.enabledByDefault !== false);

  mods.sort((a, b) => (b.core === true) - (a.core === true));

  for (const mod of mods) {
    for (const src of mod.apis || []) {
      window.ModAPI._setModId(mod.id);
      window.ModAPI._setModAssetBase(mod.assetBase || null);
      try {
        await loadScript(mod.assetBase ? `${mod.assetBase}${src}` : `../mods/${mod.id}/${src}`);
      } catch (err) {
        console.error(`[mods] failed to load API for "${mod.id}":`, err);
      }
    }
  }

  for (const mod of mods) {
    for (const href of mod.styles || []) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = mod.assetBase ? `${mod.assetBase}${href}` : `../mods/${mod.id}/${href}`;
      link.dataset.modId = mod.id;
      document.head.appendChild(link);
    }
  }

  // Scripts load sequentially so each mod can rely on earlier mods having run.
  for (const mod of mods) {
    for (const src of mod.scripts || []) {
      window.ModAPI._setModId(mod.id);
      window.ModAPI._setModAssetBase(mod.assetBase || null);
      try {
        await loadScript(mod.assetBase ? `${mod.assetBase}${src}` : `../mods/${mod.id}/${src}`);
      } catch (err) {
        console.error(`[mods] failed to load script for "${mod.id}":`, err);
      }
    }
  }
  window.ModAPI._setModId(null);
  window.ModAPI._setModAssetBase(null);

  return mods;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.dataset.dynamic = 'true';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function autoCheckForUpdates() {
  if (!window.appAPI?.checkForUpdates) return;

  try {
    const result = await window.appAPI.checkForUpdates();
    if (result?.available) {
      console.info('[updates] new version available:', result.version || 'unknown');
    }
  } catch (error) {
    console.warn('[updates] update check failed:', error);
  }
}

(async function boot() {
  const mods = await loadMods();
  await autoCheckForUpdates();
  // Every mod script has now run and had a chance to register tabs/widgets.
  // site.js listens for this to build the nav/widget-bar from whatever
  // got registered.
  document.dispatchEvent(new CustomEvent('mods:ready', { detail: mods }));
})();