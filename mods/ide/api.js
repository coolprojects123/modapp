ModAPI.ide = {
  runCommand(command, cwd) {
    // Routed through call_mod_backend, scoped to this mod's own
    // backend.lua and its "shell.run" permission only.
    // Returns a rejected promise in non-desktop environments (browser-only mode)
    if (!window.appAPI?.callBackend) {
      return Promise.reject(new Error('Native APIs are available in the desktop build only.'));
    }
    return ModAPI.native.callBackend('ide', 'run_command', [command, cwd || '']);
  },
};