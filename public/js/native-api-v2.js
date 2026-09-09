/**
 * native-api-v2.js - Redesigned Native API System
 * 
 * This file provides a centralized native API that mods can use.
 * It supports multiple backends (Electron, Tauri, Browser with limitations).
 * 
 * Usage:
 * - Electron: Uses electronAPI
 * - Tauri: Uses @tauri-apps/api via injected __TAURI_INVOKE__
 * - Browser: Provides stub implementations that return errors
 * 
 * The API is exposed as ModAPI.native and window.appAPI
 */

(function() {
  'use strict';

  // ============================================================
  // Filesystem API
  // ============================================================
  const fs = {
    // In browser mode, all operations return errors
    // In desktop mode, these are replaced with real implementations
    readFile: async (path) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    writeFile: async (path, content) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    ensureDir: async (path) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    listDir: async (path) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    readDir: async (path) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    exists: async (path) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    removeFile: async (path) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    removeDir: async (path) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
  };

  // ============================================================
  // Settings API
  // ============================================================
  const settings = {
    read: async () => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    write: async (changes) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
  };

  // ============================================================
  // Mods API
  // ============================================================
  const mods = {
    list: async () => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    toggle: async (modId) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
  };

  // ============================================================
  // Shell API (for IDE)
  // ============================================================
  const shell = {
    run: async (command, cwd) => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
  };

  // ============================================================
  // Update API
  // ============================================================
  const updates = {
    check: async () => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
    install: async () => {
      throw new Error('Native APIs are available in the desktop build only.');
    },
  };

  // ============================================================
  // The Native API object
  // ============================================================
  const nativeAPI = {
    fs,
    settings,
    mods,
    shell,
    updates,
    
    // Legacy callBackend for backwards compatibility
    // This will be removed in future versions
    callBackend: async (modId, functionName, args = []) => {
      // Route to the appropriate API based on modId and functionName
      if (modId === 'core') {
        if (functionName === 'read_settings') {
          return JSON.stringify(await settings.read());
        }
        if (functionName === 'write_settings') {
          await settings.write(JSON.parse(args[0]));
          return JSON.stringify(await settings.read());
        }
        if (functionName === 'toggle_mod') {
          return await mods.toggle(args[0]);
        }
      }
      if (modId === 'music-player' && functionName === 'ensure_uploads_dir') {
        await fs.ensureDir('music-uploads');
        return 'music-uploads';
      }
      if (modId === 'ide' && functionName === 'run_command') {
        const result = await shell.run(args[0], args[1]);
        return result;
      }
      throw new Error(`Unknown backend call: ${modId}.${functionName}`);
    },
  };

  let resolveNativeAPI;
  const nativeAPIReady = new Promise((resolve) => {
    resolveNativeAPI = resolve;
  });
  window.nativeAPIReady = nativeAPIReady;

  // ============================================================
  // Detect environment and set up real implementations
  // ============================================================

  // Try Electron first
  if (window.electronAPI) {
    console.log('[native-api-v2] Electron detected');
    
    // Map electronAPI to our native API
    if (window.electronAPI.listMods) {
      mods.list = window.electronAPI.listMods;
    }
    if (window.electronAPI.toggleMod) {
      mods.toggle = window.electronAPI.toggleMod;
    }
    if (window.electronAPI.readSettings) {
      settings.read = window.electronAPI.readSettings;
    }
    if (window.electronAPI.writeSettings) {
      settings.write = window.electronAPI.writeSettings;
    }
    if (window.electronAPI.checkForUpdates) {
      updates.check = window.electronAPI.checkForUpdates;
    }
    if (window.electronAPI.installUpdate) {
      updates.install = window.electronAPI.installUpdate;
    }
    if (window.electronAPI.callBackend) {
      // Legacy support
      nativeAPI.callBackend = window.electronAPI.callBackend;
    }
    if (window.electronAPI.invoke) {
      // For native invoke calls
      nativeAPI.invoke = window.electronAPI.invoke;
    }
    
    // Electron-specific FS implementation
    fs.ensureDir = async (path) => {
      return window.electronAPI.invoke('ensure_dir', { path });
    };
    fs.readFile = async (path) => {
      return window.electronAPI.invoke('read_file', { path });
    };
    fs.writeFile = async (path, content) => {
      return window.electronAPI.invoke('write_file', { path, content });
    };
    fs.readDir = async (path) => {
      return window.electronAPI.invoke('read_dir', { path });
    };
    
    // Set up window.appAPI for backwards compatibility
    window.appAPI = {
      listMods: mods.list,
      toggleMod: mods.toggle,
      readSettings: settings.read,
      writeSettings: settings.write,
      checkForUpdates: updates.check,
      installUpdate: updates.install,
      callBackend: nativeAPI.callBackend,
      // Expose the new API
      fs: fs,
      settings: settings,
      mods: mods,
      shell: shell,
      updates: updates,
    };
    
    console.log('[native-api-v2] Electron API set up');
    resolveNativeAPI(nativeAPI);
    return;
  }

  // Try Tauri (check for the functions we inject via tauri-invoke.js)
  let invokeFn = null;
  let convertFileSrcFn = (path) => path;

  function trySetupTauri() {
    // Check for our injected __TAURI_INVOKE__
    if (window.__TAURI_INVOKE__ && typeof window.__TAURI_INVOKE__ === 'function') {
      invokeFn = window.__TAURI_INVOKE__;
      convertFileSrcFn = window.__TAURI_CONVERT_FILE_SRC__ || convertFileSrcFn;
      return true;
    }
    // Check for other Tauri patterns
    if (window.__TAURI__?.invoke && typeof window.__TAURI__.invoke === 'function') {
      invokeFn = window.__TAURI__.invoke;
      convertFileSrcFn = window.__TAURI__.convertFileSrc || convertFileSrcFn;
      return true;
    }
    if (window.__TAURI__?.core?.invoke && typeof window.__TAURI__.core.invoke === 'function') {
      invokeFn = window.__TAURI__.core.invoke;
      convertFileSrcFn = window.__TAURI__.core.convertFileSrc || convertFileSrcFn;
      return true;
    }
    return false;
  }

  // Try immediately
  if (trySetupTauri()) {
    setupTauriAPI();
    return;
  }

  // Wait for async loading (Tauri module might load after this script)
  const startTime = Date.now();
  const checkInterval = setInterval(() => {
    if (trySetupTauri()) {
      clearInterval(checkInterval);
      setupTauriAPI();
      return;
    }
    if (Date.now() - startTime > 5000) {
      clearInterval(checkInterval);
      console.warn('[native-api-v2] Tauri API not detected after 5s');
      // Fall through to browser mode
      setupBrowserAPI();
    }
  }, 100);

  function setupTauriAPI() {
    console.log('[native-api-v2] Tauri detected, setting up API');

    nativeAPI.invoke = invokeFn;
    nativeAPI.convertFileSrc = convertFileSrcFn;
    nativeAPI.callBackend = async (modId, functionName, args = []) => {
      return invokeFn('call_mod_backend', {
        modId,
        function: functionName,
        args,
      });
    };
    
    // Set up all Tauri-based API calls
    mods.list = async () => {
      const rawMods = await invokeFn('list_mods');
      return rawMods.map(mod => ({
        ...mod,
        assetBase: convertFileSrcFn(mod.assetBase) + '/',
      }));
    };
    
    mods.toggle = async (modId) => {
      return nativeAPI.callBackend('core', 'toggle_mod', [modId]);
    };
    
    settings.read = async () => {
      const result = await nativeAPI.callBackend('core', 'read_settings');
      return typeof result === 'string' ? JSON.parse(result) : result;
    };
    
    settings.write = async (changes) => {
      const result = await nativeAPI.callBackend('core', 'write_settings', [JSON.stringify(changes)]);
      return typeof result === 'string' ? JSON.parse(result) : result;
    };
    
    updates.check = async () => {
      return invokeFn('check_for_updates');
    };
    
    updates.install = async () => {
      return invokeFn('install_update');
    };
    
    // FS operations via Tauri
    fs.forMod = (modId) => {
      const payload = (extra = {}) => ({ modId, ...extra });
      return {
        ensureDir: (path) => invokeFn('system_ensure_dir', payload({ path })),
        readFile: (path) => invokeFn('system_read_file', payload({ path })),
        writeFile: (path, content) => invokeFn('system_write_file', payload({ path, content })),
        readBytes: async (path) => new Uint8Array(await invokeFn('system_read_bytes', payload({ path }))),
        writeBytes: (path, bytes) => invokeFn('system_write_bytes', payload({ path, content: Array.from(bytes) })),
        readDir: (path = '') => invokeFn('system_read_dir', payload({ path })),
        listDir: (path = '') => invokeFn('system_read_dir', payload({ path })),
        exists: (path) => invokeFn('system_path_exists', payload({ path })),
        resolvePath: (path) => invokeFn('system_resolve_path', payload({ path })),
        removeFile: (path) => invokeFn('system_remove_file', payload({ path })),
        removeDir: (path) => invokeFn('system_remove_dir', payload({ path })),
        move: (from, to) => invokeFn('system_move', payload({ from, to })),
      };
    };

    Object.assign(fs, fs.forMod('music-player'));
    
    // Set up shell for IDE
    shell.run = async (command, cwd = '') => {
      return nativeAPI.callBackend('ide', 'run_command', [command, cwd]);
    };
    
    // Set up window.appAPI for backwards compatibility
    window.appAPI = {
      listMods: mods.list,
      toggleMod: mods.toggle,
      readSettings: settings.read,
      writeSettings: settings.write,
      checkForUpdates: updates.check,
      installUpdate: updates.install,
      callBackend: nativeAPI.callBackend,
      // Expose the new API
      fs: fs,
      settings: settings,
      mods: mods,
      shell: shell,
      updates: updates,
    };
    
    console.log('[native-api-v2] Tauri API set up successfully');
    resolveNativeAPI(nativeAPI);
  }

  function setupBrowserAPI() {
    console.log('[native-api-v2] Browser mode - native APIs will return errors');
    
    // In browser mode, just use the stub implementations
    // Mods can still work but won't have access to native features
    window.appAPI = {
      listMods: async () => [],
      toggleMod: async () => false,
      readSettings: async () => ({}),
      writeSettings: async () => ({}),
      checkForUpdates: async () => ({ available: false }),
      installUpdate: async () => ({}),
      callBackend: async () => {
        throw new Error('Native APIs are available in the desktop build only.');
      },
      fs: fs,
      settings: settings,
      mods: mods,
      shell: shell,
      updates: updates,
    };
    resolveNativeAPI(nativeAPI);
  }

  // Expose to ModAPI
  window.ModAPI = window.ModAPI || {};
  window.ModAPI.native = nativeAPI;
  
  // Also expose to window for direct access
  window.nativeAPI = nativeAPI;
})();
