// Bridges script.js's window.appAPI calls to Core's own backend.lua via
// the single generic call_mod_backend command. Settings/mod-toggle are no
// longer dedicated native commands -- they're just permissions Core has.

// Don't overwrite window.appAPI entirely - extend it so that
// ModAPI.native.callBackend can still access the original callBackend method
const originalAppAPI = window.appAPI || {};

// Check if we have a callBackend method (desktop environment)
const hasCallBackend = typeof originalAppAPI.callBackend === 'function';

window.appAPI = {
  ...originalAppAPI,
  async readSettings() {
    if (!hasCallBackend) {
      // Browser-only mode: return default settings
      return {
        siteTitle: 'modapp',
        siteIcon: 'M',
        tagline: 'a modular desktop app',
        defaultTab: 'home',
        accentColor: '#3b82f6',
        reduceMotion: false,
      };
    }
    const json = await ModAPI.native.callBackend('core', 'read_settings', []);
    return JSON.parse(json);
  },
  async writeSettings(changes) {
    if (!hasCallBackend) {
      // Browser-only mode: settings can't be persisted
      return { ...changes };
    }
    const json = await ModAPI.native.callBackend('core', 'write_settings', [JSON.stringify(changes)]);
    return JSON.parse(json);
  },
  toggleMod(id) {
    if (!hasCallBackend) {
      // Browser-only mode: can't toggle mods
      return false;
    }
    return ModAPI.native.callBackend('core', 'toggle_mod', [id]);
  },
};