(function () {
  // Electron build
  if (window.electronAPI) {
    console.log('[native-api] Using electronAPI');
    window.appAPI = window.electronAPI;
    return;
  }

  let invokeFn = null;
  let convertFileSrcFn = (path) => path;

  // Helper to check and set up appAPI
  function trySetupAppAPI() {
    // Check for __TAURI_INVOKE__ (from our tauri-invoke.js module)
    if (window.__TAURI_INVOKE__ && typeof window.__TAURI_INVOKE__ === 'function') {
      console.log('[native-api] Found __TAURI_INVOKE__, setting up appAPI');
      invokeFn = window.__TAURI_INVOKE__;
      convertFileSrcFn = window.__TAURI_CONVERT_FILE_SRC__ || convertFileSrcFn;
    }
    // Fallback: check for other Tauri API patterns
    else if (typeof window.__TAURI__ !== 'undefined') {
      if (window.__TAURI__.invoke && typeof window.__TAURI__.invoke === 'function') {
        invokeFn = window.__TAURI__.invoke;
        convertFileSrcFn = window.__TAURI__.convertFileSrc || window.__TAURI__.transformFileSrc || convertFileSrcFn;
      }
      else if (window.__TAURI__.core?.invoke && typeof window.__TAURI__.core.invoke === 'function') {
        invokeFn = window.__TAURI__.core.invoke;
        convertFileSrcFn = window.__TAURI__.core.convertFileSrc || convertFileSrcFn;
      }
    }

    // If we found an invoke function, set up appAPI
    if (invokeFn) {
      window.appAPI = {
        listMods: async () => {
          try {
            const mods = await invokeFn('list_mods');
            return mods.map((mod) => ({
              ...mod,
              assetBase: convertFileSrcFn(mod.assetBase) + '/',
            }));
          } catch (error) {
            console.error('[native-api] list_mods failed:', error);
            throw error;
          }
        },
        checkForUpdates: () => invokeFn('check_for_updates'),
        installUpdate: () => invokeFn('install_update'),
        callBackend: async (modId, functionName, args = []) => {
          try {
            return await invokeFn('call_mod_backend', { modId, function: functionName, args });
          } catch (error) {
            console.error(`[native-api] callBackend(${modId}.${functionName}) failed:`, error);
            throw error;
          }
        },
      };
      console.log('[native-api] appAPI successfully set up');
      return true;
    }
    return false;
  }

  // Try immediately first
  if (trySetupAppAPI()) {
    return;
  }

  // If not found, wait for potential async loading (Tauri module might load after this script)
  // Check periodically for up to 3 seconds
  const startTime = Date.now();
  const checkInterval = setInterval(() => {
    if (trySetupAppAPI()) {
      clearInterval(checkInterval);
      return;
    }
    if (Date.now() - startTime > 3000) {
      clearInterval(checkInterval);
      console.warn('[native-api] No desktop API detected after 3s. electronAPI:', !!window.electronAPI, '__TAURI__:', !!window.__TAURI__, '__TAURI_INVOKE__:', !!window.__TAURI_INVOKE__);
    }
  }, 100);
})();