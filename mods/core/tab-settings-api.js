/**
 * tab-settings-api.js — a settings store for tabs that never touches the
 * backend: no ModAPI.native, no callBackend, no fs, no IPC. Backed by
 * localStorage in the webview itself, so it works identically in browser
 * dev mode, Electron, and Tauri with zero platform branching.
 *
 * This is deliberately separate from settings-api.js's per-mod store
 * (which persists to <mod data dir>/settings.json via native.fs and does
 * hit the backend). Use this one when a tab just wants a few small,
 * non-sensitive UI preferences (last-selected view, sort order, a
 * collapsed/expanded flag) and doesn't need them to survive outside this
 * one browser/webview profile. Trade-offs vs. the native-backed store:
 *   - Not written to disk under the app's data directory -- lives in the
 *     webview's localStorage instead, so it's cleared if the user clears
 *     the app's browsing data/cache, and isn't visible to backend.lua.
 *   - Subject to the browser's localStorage size limit (~5-10MB total,
 *     shared across everything using it), not the app's mod-data quota.
 *   - No permission needed, since nothing native is ever called.
 *
 * Usage:
 *   TabSettings.set('calendar', 'sortOrder', 'date');
 *   TabSettings.get('calendar', 'sortOrder', 'date');   // fallback if unset
 *   TabSettings.getAll('calendar');                      // -> { sortOrder: 'date', ... }
 *   TabSettings.onChange('calendar', ({ key, value }) => { ... });
 *
 * The id passed in is caller-chosen -- conventionally a tab's registerTab
 * id, but nothing enforces that; a mod with multiple tabs that want to
 * share one settings bucket can just use its own mod id instead.
 */
(function () {
  'use strict';

  const PREFIX = 'modapp_tab_settings_';
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function storageKey(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      throw new Error('TabSettings needs a valid id (letters, digits, - or _).');
    }
    return PREFIX + id;
  }

  function readAll(id) {
    try {
      const raw = localStorage.getItem(storageKey(id));
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(id, values) {
    localStorage.setItem(storageKey(id), JSON.stringify(values));
  }

  window.TabSettings = {
    get(id, key, fallback) {
      const all = readAll(id);
      return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
    },

    getAll(id) {
      return { ...readAll(id) };
    },

    set(id, key, value) {
      const all = readAll(id);
      all[key] = value;
      writeAll(id, all);
      document.dispatchEvent(
        new CustomEvent('mods:tab-settings-changed', { detail: { id, key, value } })
      );
      return value;
    },

    // Merges several keys in one write/one event, instead of one
    // dispatch-per-key from calling set() in a loop.
    setAll(id, changes) {
      const all = { ...readAll(id), ...changes };
      writeAll(id, all);
      document.dispatchEvent(
        new CustomEvent('mods:tab-settings-changed', { detail: { id, key: null, value: all, bulk: true } })
      );
      return { ...all };
    },

    remove(id, key) {
      const all = readAll(id);
      delete all[key];
      writeAll(id, all);
      document.dispatchEvent(
        new CustomEvent('mods:tab-settings-changed', { detail: { id, key, value: undefined } })
      );
    },

    // fn receives { id, key, value } ('key' is null and 'bulk' true after
    // setAll). Pass no id to listen across every tab's settings.
    onChange(id, fn) {
      const handler = (event) => {
        if (id && event.detail.id !== id) return;
        try {
          fn(event.detail);
        } catch (err) {
          console.error('[TabSettings] onChange handler failed:', err);
        }
      };
      document.addEventListener('mods:tab-settings-changed', handler);
      return () => document.removeEventListener('mods:tab-settings-changed', handler);
    },
  };
})();