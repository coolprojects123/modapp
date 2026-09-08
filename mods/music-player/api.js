ModAPI.music = {
  ensureUploadsDir() {
    // Routed through the single call_mod_backend command, scoped to this
    // mod's own backend.lua and its declared permissions only.
    // Returns a resolved promise in non-desktop environments (browser-only mode)
    if (!window.appAPI?.callBackend) {
      return Promise.resolve();
    }
    return ModAPI.native.callBackend('music-player', 'ensure_uploads_dir', []);
  },
};