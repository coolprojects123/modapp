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
  
  /**
   * Toggle a mod on/off
   * @param {string} id - Mod ID
   * @returns {Promise<boolean>} New enabled state
   */
  async toggleMod(id) {
    if (hasNativeMods) {
      return await ModAPI.native.mods.toggle(id);
    }
    
    // Fallback to old callBackend system
    if (typeof originalAppAPI.callBackend === 'function') {
      return await ModAPI.native.callBackend('core', 'toggle_mod', [id]);
    }
    
    // Browser-only mode: can't toggle
    return false;
  },
  
  /**
   * List all mods
   * @returns {Promise<Array>} Array of mod objects
   */
  async listMods() {
    if (hasNativeMods) {
      return await ModAPI.native.mods.list();
    }
    
    // Fallback to old callBackend system
    if (typeof originalAppAPI.callBackend === 'function') {
      const mods = await ModAPI.native.callBackend('core', 'list_mods', []);
      return mods;
    }
    
    // Browser-only mode: return empty array
    return [];
  },
};