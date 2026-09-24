/**
 * settings-api.js — a per-mod settings store that persists to
 * <mod data dir>/settings.json via ModAPI.native (native fs), and therefore
 * DOES hit the backend and needs the mod's "fs.*" permissions.
 *
 * This is deliberately separate from tab-settings-api.js's TabSettings
 * store (localStorage-only, no backend, no permission). Use this one when
 * settings must survive outside a single webview profile, be visible to
 * backend.lua, or exceed localStorage's ~5-10MB budget.
 *
 * Usage:
 *   await ModSettings.set('myMod', 'fontSize', 14);
 *   ModSettings.get('myMod', 'fontSize', 12);   // sync cached read
 *   await ModSettings.getAll('myMod');
 *   ModSettings.onChange('myMod', ({ key, value }) => { ... });
 */
(function () {
  'use strict';

  const FILE = 'settings.json';
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const caches = new Map(); // id -> last-read object

  function validId(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      throw new Error('ModSettings needs a valid id (letters, digits, - or _).');
    }
    return true;
  }

  function hasFs() {
    return !!(ModAPI.native?.fs?.readFile || ModAPI.native?.fs?.read);
  }

  function fsRead() {
    const fs = ModAPI.native.fs;
    if (typeof fs.readFile === 'function') return fs.readFile(FILE);
    if (typeof fs.read === 'function') return fs.read(FILE);
    throw new Error('No native fs read available');
  }

  function fsWrite(json) {
    const fs = ModAPI.native.fs;
    if (typeof fs.writeFile === 'function') return fs.writeFile(FILE, json);
    if (typeof fs.write === 'function') return fs.write(FILE, json);
    throw new Error('No native fs write available');
  }

  function parse(json) {
    try {
      const parsed = json ? JSON.parse(json) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  async function readAll(id) {
    validId(id);
    if (!hasFs()) {
      // Browser-only fallback: mirror into localStorage so the API still works.
      return parse(localStorage.getItem('modapp_mod_settings_' + id));
    }
    const json = await fsRead();
    const all = parse(json);
    caches.set(id, all);
    return all;
  }

  async function writeAll(id, values) {
    caches.set(id, values);
    if (!hasFs()) {
      localStorage.setItem('modapp_mod_settings_' + id, JSON.stringify(values));
      return;
    }
    await fsWrite(JSON.stringify(values));
  }

  function emit(id, key, value, bulk) {
    document.dispatchEvent(
      new CustomEvent('mods:mod-settings-changed', {
        detail: { id, key, value, bulk: !!bulk },
      })
    );
  }

  let ready = null;
  function nativeReady() {
    if (!ready) ready = window.nativeAPIReady || Promise.resolve();
    return ready;
  }

  window.ModSettings = {
    /** Synchronous read of the last-loaded cache (may be stale before load()). */
    get(id, key, fallback) {
      validId(id);
      const all = caches.get(id);
      return all && Object.prototype.hasOwnProperty.call(all, key)
        ? all[key]
        : fallback;
    },

    async getAsync(id, key, fallback) {
      const all = await readAll(id);
      return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
    },

    async getAll(id) {
      return { ...(await readAll(id)) };
    },

    async set(id, key, value) {
      const all = await readAll(id);
      all[key] = value;
      await writeAll(id, all);
      emit(id, key, value);
      return value;
    },

    // Merges several keys in one write/one event.
    async setAll(id, changes) {
      const all = { ...(await readAll(id)), ...changes };
      await writeAll(id, all);
      emit(id, null, { ...all }, true);
      return { ...all };
    },

    async remove(id, key) {
      const all = await readAll(id);
      delete all[key];
      await writeAll(id, all);
      emit(id, key, undefined);
    },

    /** Wait for the native bridge, then warm the cache. Call once at mod init. */
    async load(id) {
      await nativeReady();
      await readAll(id);
    },

    // fn receives { id, key, value } ('key' null and 'bulk' true after setAll).
    // Pass no id to listen across every mod's settings.
    onChange(id, fn) {
      const handler = (event) => {
        if (id && event.detail.id !== id) return;
        try {
          fn(event.detail);
        } catch (err) {
          console.error('[ModSettings] onChange handler failed:', err);
        }
      };
      document.addEventListener('mods:mod-settings-changed', handler);
      return () => document.removeEventListener('mods:mod-settings-changed', handler);
    },
  };
})();