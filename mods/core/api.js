/**
 * Core API
 * Bridges script.js to the centralized ModAPI.native API
 * Uses the new ModAPI.native.settings and ModAPI.native.mods APIs
 */

// Don't overwrite window.appAPI entirely - extend it so that
// the original methods remain available
const originalAppAPI = window.appAPI || {};

// Check what's available in the environment
const hasNativeSettings = ModAPI.native?.settings?.read;
const hasNativeMods = ModAPI.native?.mods?.list;

window.appAPI = {
  ...originalAppAPI,
  
  /**
   * Read app settings
   * @returns {Promise<Object>} Settings object
   */
  async readSettings() {
    if (hasNativeSettings) {
      return await ModAPI.native.settings.read();
    }
    
    // Fallback to old callBackend system
    if (typeof originalAppAPI.callBackend === 'function') {
      const json = await ModAPI.native.callBackend('core', 'read_settings', []);
      return JSON.parse(json);
    }
    
    // Browser-only mode: return default settings
    return {
      siteTitle: 'modapp',
      siteIcon: 'M',
      tagline: 'a modular desktop app',
      defaultTab: 'home',
      accentColor: '#3b82f6',
      reduceMotion: false,
      themeVars: {},
    };
  },
  
  /**
   * Write app settings
   * @param {Object} changes - Settings to update
   * @returns {Promise<Object>} Updated settings
   */
  async writeSettings(changes) {
    if (hasNativeSettings) {
      return await ModAPI.native.settings.write(changes);
    }
    
    // Fallback to old callBackend system
    if (typeof originalAppAPI.callBackend === 'function') {
      const json = await ModAPI.native.callBackend('core', 'write_settings', [JSON.stringify(changes)]);
      return JSON.parse(json);
    }
    
    // Browser-only mode: can't persist, just return the changes
    return { ...changes };
  },
  
  async listMods() {
    return await window.__TAURI__.core.invoke('list_mods');
  },

  async toggleMod(id) {
    return await ModAPI.native.callBackend(
      'core',
      'toggle_mod',
      [id]
    );
  },

  /**
   * Lightweight check: is a new version available? Does not download or
   * install anything.
   * @returns {Promise<{available: boolean, configured?: boolean, version?: string, currentVersion?: string, body?: string, date?: string}>}
   */
  async checkForUpdates() {
    return await window.__TAURI__.core.invoke('check_for_updates');
  },

  /**
   * Re-checks, then (if one is available) shows the native OS confirmation
   * dialog and installs on accept. The dialog is native Rust-side UI a mod's
   * script can't click through, so this is safe to call without any of our
   * own confirmation UI first.
   * @returns {Promise<{installed: boolean, available: boolean, declined?: boolean, version?: string}>}
   */
  async installUpdate() {
    return await window.__TAURI__.core.invoke('install_update');
  },
};