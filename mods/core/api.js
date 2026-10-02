/**
 * Core API
 * Bridges script.js to the centralized ModAPI.native API
 * Uses the new ModAPI.native.settings and ModAPI.native.mods APIs
 */

// Don't overwrite window.appAPI entirely - extend it so that
// the original methods remain available
const originalAppAPI = window.appAPI || {};

window.appAPI = {
  ...originalAppAPI,
  
  /**
   * Read app settings
   * @returns {Promise<Object>} Settings object
   */
  async readSettings() {
    if (ModAPI.native?.settings?.read) {
      return await ModAPI.native.settings.read();
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
    if (ModAPI.native?.settings?.write) {
      return await ModAPI.native.settings.write(changes);
    }
    
    // Browser-only mode: can't persist, just return the changes
    return { ...changes };
  },
  
  async listMods() {
    return await ModAPI.native.mods.list();
  },

  async toggleMod(id) {
    return await ModAPI.native.mods.toggle(id);
  },

};