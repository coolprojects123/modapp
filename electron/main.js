// ELECTRON FOR TESTING ONLY. This file is not used in the Tauri build, which uses src-tauri/src/lib.rs instead.
const { app, BrowserWindow, WebContentsView } = require('electron');
const { ipcMain } = require('electron');
const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

// ============================================================
// Widevine CDM setup. Vanilla Electron doesn't bundle Widevine
// (licensing), but Chromium (which Electron embeds) can load an external
// CDM via these two command-line switches if pointed at one already
// installed by a real Chrome/Chromium on the machine. Must run before
// app.whenReady() -- Chromium reads these at startup, not on demand.
// Override with WIDEVINE_CDM_PATH / WIDEVINE_CDM_VERSION env vars if
// auto-detection below doesn't find your install.
//
// NOTE: on vanilla/stock Electron (installed via `npm install electron`),
// these command-line switches are inert -- stock Electron's Chromium was
// not compiled with Widevine support, so pointing at a CDM here has no
// effect and DRM-gated sites (Spotify, Netflix, etc.) will still fail
// with "Platform does not support navigator.requestMediaKeySystemAccess".
// Real Widevine support requires the castlabs Electron fork instead:
// https://github.com/castlabs/electron-releases
// This block is left in (and made safe to run under vanilla Electron)
// so the app doesn't crash either way -- it just won't unlock DRM
// playback unless you're on a Widevine-enabled Electron build.
// ============================================================
function platformDirName() {
  const map = { linux: { x64: 'linux_x64', arm64: 'linux_arm64' }, darwin: { x64: 'mac_x64', arm64: 'mac_arm64' }, win32: { x64: 'win_x64', ia32: 'win_x86' } };
  return map[process.platform]?.[process.arch] || null;
}

function findWidevineCdm() {
  if (process.env.WIDEVINE_CDM_PATH && process.env.WIDEVINE_CDM_VERSION) {
    return { path: process.env.WIDEVINE_CDM_PATH, version: process.env.WIDEVINE_CDM_VERSION };
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidateRoots = {
    linux: [
      '/opt/google/chrome/WidevineCdm',
      '/opt/google/chrome-unstable/WidevineCdm',
      '/usr/lib64/chromium-browser/WidevineCdm',
      '/usr/lib/chromium/WidevineCdm',
      path.join(home, '.config/google-chrome/WidevineCdm'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/Current/Libraries/WidevineCdm',
    ],
    win32: [
      'C:\\Program Files (x86)\\Google\\Chrome\\Application',
      'C:\\Program Files\\Google\\Chrome\\Application',
    ],
  };
  const dirName = platformDirName();
  if (!dirName) return null;

  for (const root of candidateRoots[process.platform] || []) {
    try {
      // Windows nests WidevineCdm under a versioned Chrome install dir
      // (Application/<chromeVersion>/WidevineCdm); Linux/macOS don't.
      const roots = process.platform === 'win32'
        ? fs.readdirSync(root).map((v) => path.join(root, v, 'WidevineCdm')).filter((p) => fs.existsSync(p))
        : [root];
      for (const cdmRoot of roots) {
        const platformDir = path.join(cdmRoot, '_platform_specific', dirName);
        const manifestPath = path.join(cdmRoot, 'manifest.json');
        if (fs.existsSync(platformDir) && fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          return { path: platformDir, version: manifest.version };
        }
      }
    } catch {
      // candidate root doesn't exist / not readable — try the next one.
    }
  }
  return null;
}

const widevine = findWidevineCdm();
if (widevine) {
  app.commandLine.appendSwitch('widevine-cdm-path', widevine.path);
  app.commandLine.appendSwitch('widevine-cdm-version', widevine.version);
  console.log(`[widevine] using CDM ${widevine.version} from ${widevine.path}`);
} else {
  console.warn(
    '[widevine] no Widevine CDM found (checked common Chrome/Chromium install paths). ' +
    'DRM-gated sites (Spotify, Netflix, etc.) will not play. ' +
    'Set WIDEVINE_CDM_PATH and WIDEVINE_CDM_VERSION env vars to point at one manually.'
  );
}

let mainWindow;
const rootDir = path.join(__dirname, '..');
const modsDir = path.join(app.getPath('userData'), 'mods');
const settingsPath = path.join(modsDir, '.settings.json');
const configPath = path.join(modsDir, '.config.json');

const defaultSettings = {
  siteTitle: 'modapp',
  siteIcon: 'M',
  tagline: 'a modular desktop app',
  defaultTab: 'home',
  accentColor: '#3b82f6',
  reduceMotion: false,
};

fs.mkdirSync(modsDir, { recursive: true });
for (const entry of fs.readdirSync(path.join(rootDir, 'mods'), { withFileTypes: true })) {
  const sourcePath = path.join(rootDir, 'mods', entry.name);
  const targetPath = path.join(modsDir, entry.name);
  if (entry.isDirectory() && !fs.existsSync(targetPath)) fs.cpSync(sourcePath, targetPath, { recursive: true });
}
for (const [sourceName, targetName] of [['settings.json', '.settings.json'], ['mods-config.json', '.config.json']]) {
  const targetPath = path.join(modsDir, targetName);
  const sourcePath = path.join(rootDir, sourceName);
  if (!fs.existsSync(targetPath) && fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, targetPath);
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function discoverMods() {
  const config = readJson(configPath, {});
  return fs.readdirSync(modsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const id = entry.name;
      const manifestPath = path.join(modsDir, id, 'mod.json');
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = readJson(manifestPath, null);
      if (!manifest) return null;
      const core = id === 'core';
      return {
        ...manifest,
        id,
        assetBase: `${pathToFileURL(path.join(modsDir, id)).href}/`,
        core,
        enabled: core ? true : (config[id] !== undefined ? config[id] : manifest.enabledByDefault !== false),
      };
    })
    .filter(Boolean);
}

// ============================================================
// New Centralized FS API Endpoints
// ============================================================

// Filesystem operations
ipcMain.handle('ensure_dir', (_event, { path: dirPath }) => {
  const fullPath = path.join(modsDir, dirPath);
  fs.mkdirSync(fullPath, { recursive: true });
  return fullPath;
});

ipcMain.handle('read_file', (_event, { path: filePath }) => {
  const fullPath = path.join(modsDir, filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
});

ipcMain.handle('write_file', (_event, { path: filePath, content }) => {
  const fullPath = path.join(modsDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  return true;
});

ipcMain.handle('read_dir', (_event, { path: dirPath }) => {
  const fullPath = path.join(modsDir, dirPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Directory not found: ${fullPath}`);
  }
  return fs.readdirSync(fullPath);
});

ipcMain.handle('path_exists', (_event, { path: checkPath }) => {
  const fullPath = path.join(modsDir, checkPath);
  return fs.existsSync(fullPath);
});

// Shell operations
ipcMain.handle('shell:run', (_event, { command, cwd }) => {
  return new Promise((resolve) => {
    execFile('/usr/bin/bash', ['-lc', command], { 
      cwd: cwd ? path.join(modsDir, cwd) : modsDir, 
      timeout: 30000, 
      maxBuffer: 1024 * 1024 
    }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
});

// ============================================================
// Settings and Mod Management
// ============================================================
ipcMain.handle('settings:read', () => ({ ...defaultSettings, ...readJson(settingsPath, {}) }));
ipcMain.handle('settings:write', (_event, changes) => {
  const settings = { ...defaultSettings, ...readJson(settingsPath, {}), ...changes };
  writeJson(settingsPath, settings);
  return settings;
});

ipcMain.handle('mods:list', () => discoverMods());
ipcMain.handle('mods:toggle', (_event, id) => {
  const mod = discoverMods().find((item) => item.id === id);
  if (!mod || mod.core) return mod ? mod.enabled : false;
  const config = readJson(configPath, {});
  config[id] = !mod.enabled;
  writeJson(configPath, config);
  return config[id];
});

// ============================================================
// Updates
// ============================================================
ipcMain.handle('updates:check', () => ({ available: false }));
ipcMain.handle('updates:install', () => ({ installed: false, available: false }));

// ============================================================
// Legacy Backwards Compatibility
// ============================================================

// Old mods:callBackend endpoint - redirects to new system
ipcMain.handle('mods:callBackend', async (_event, { modId, functionName, args }) => {
  console.warn('[Electron] mods:callBackend is deprecated. Use direct API calls.');
  
  // Route to new endpoints based on modId and functionName
  if (modId === 'core') {
    if (functionName === 'read_settings') {
      return JSON.stringify({ ...defaultSettings, ...readJson(settingsPath, {}) });
    }
    if (functionName === 'write_settings') {
      const changes = JSON.parse(args[0] || '{}');
      const settings = { ...defaultSettings, ...readJson(settingsPath, {}), ...changes };
      writeJson(settingsPath, settings);
      return JSON.stringify(settings);
    }
    if (functionName === 'toggle_mod') {
      const id = args[0];
      const mod = discoverMods().find((item) => item.id === id);
      if (!mod || mod.core) return mod ? mod.enabled : false;
      const config = readJson(configPath, {});
      config[id] = !mod.enabled;
      writeJson(configPath, config);
      return config[id];
    }
  }
  
  if (modId === 'music-player' && functionName === 'ensure_uploads_dir') {
    const fullPath = path.join(modsDir, 'music-uploads');
    fs.mkdirSync(fullPath, { recursive: true });
    return fullPath;
  }
  
  if (modId === 'ide' && functionName === 'run_command') {
    const command = args[0];
    const cwd = args[1] || '';
    return new Promise((resolve) => {
      execFile('/usr/bin/bash', ['-lc', command], {
        cwd: cwd ? path.join(modsDir, cwd) : modsDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    });
  }
  
  throw new Error(`Unknown backend function: ${modId}.${functionName}`);
});

// Old native:invoke endpoint - redirects to new system
ipcMain.handle('native:invoke', (_event, { method, payload } = {}) => {
  console.warn('[Electron] native:invoke is deprecated.');
  
  if (method === 'ensure_music_uploads_dir') {
    const fullPath = path.join(modsDir, 'music-uploads');
    fs.mkdirSync(fullPath, { recursive: true });
    return fullPath;
  }
  if (method === 'shell.run') {
    const { command, cwd } = payload || {};
    return new Promise((resolve) => {
      execFile('/usr/bin/bash', ['-lc', command], {
        cwd: cwd ? path.join(modsDir, cwd) : modsDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    });
  }
  
  throw new Error(`Unknown native method: ${method}`);
});

function modPermissions(modId) {
  const manifestPath = path.join(modsDir, modId, 'mod.json');
  const manifest = readJson(manifestPath, null);
  return new Set(manifest?.permissions || []);
}

function requirePermission(modId, permission) {
  if (!modPermissions(modId).has(permission)) {
    throw new Error(`mod '${modId}' lacks permission '${permission}'`);
  }
}

function modEnabled(modId) {
  if (modId === 'core') return true;
  const mod = discoverMods().find((item) => item.id === modId);
  return !!mod?.enabled;
}

// ============================================================
// Mod webviews. Namespaced by mod_id + instance so one mod can never
// address another's webview, mirroring the Rust side's mod_webview_label.
// A real Chrome/Chromium UA is honest here (Electron's webContents *is*
// Chromium), unlike the WebKitGTK/WKWebView cases where the UA had to be
// picked per-engine to avoid a mismatch.
// ============================================================
const modWebviews = new Map(); // "modId:instance" -> { view, bounds, attached }

function webviewKey(modId, instance) {
  return `${modId}:${instance}`;
}

function defaultUserAgent() {
  switch (process.platform) {
    case 'win32':
      return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    case 'darwin':
      return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    default:
      return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
}

ipcMain.handle('webview:create', (_event, { modId, instance, url, x, y, width, height }) => {
  requirePermission(modId, 'webview.access');
  if (!modEnabled(modId)) throw new Error(`mod '${modId}' is disabled`);

  const key = webviewKey(modId, instance);
  if (modWebviews.has(key)) throw new Error(`webview '${key}' already exists — close it first`);

  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  view.webContents.setUserAgent(defaultUserAgent());
  view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  mainWindow.contentView.addChildView(view);
  view.webContents.loadURL(url);

  modWebviews.set(key, { view, bounds: { x, y, width, height }, attached: true });
  return true;
});

ipcMain.handle('webview:close', (_event, { modId, instance }) => {
  requirePermission(modId, 'webview.access');
  const key = webviewKey(modId, instance);
  const entry = modWebviews.get(key);
  if (!entry) return true;
  if (entry.attached) mainWindow.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
  modWebviews.delete(key);
  return true;
});

ipcMain.handle('webview:setVisible', (_event, { modId, instance, visible }) => {
  requirePermission(modId, 'webview.access');
  const key = webviewKey(modId, instance);
  const entry = modWebviews.get(key);
  if (!entry) return true;
  // WebContentsView has no direct show/hide toggle -- detaching from the
  // window's contentView is the documented way to hide one, and
  // re-attaching (with bounds restored) to show it again.
  if (visible && !entry.attached) {
    mainWindow.contentView.addChildView(entry.view);
    entry.view.setBounds({
      x: Math.round(entry.bounds.x),
      y: Math.round(entry.bounds.y),
      width: Math.round(entry.bounds.width),
      height: Math.round(entry.bounds.height),
    });
    entry.attached = true;
  } else if (!visible && entry.attached) {
    mainWindow.contentView.removeChildView(entry.view);
    entry.attached = false;
  }
  return true;
});

ipcMain.handle('webview:setBounds', (_event, { modId, instance, x, y, width, height }) => {
  requirePermission(modId, 'webview.access');
  const key = webviewKey(modId, instance);
  const entry = modWebviews.get(key);
  if (!entry) return true;
  entry.bounds = { x, y, width, height };
  if (entry.attached) {
    entry.view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  }
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'modapp',
    icon: path.join(rootDir, 'src-tauri', 'icons', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'public', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // `app.components` (the Chromium component updater used to load an
  // external Widevine CDM) only exists on Widevine-enabled Electron
  // builds such as the castlabs fork (castlabs/electron-releases).
  // On vanilla/stock Electron this API doesn't exist -- calling it
  // unconditionally crashes app startup with an UnhandledPromiseRejection
  // before the window is ever created. Guard it so the app still runs
  // (without DRM/Widevine playback) on stock Electron, and still gets
  // full Widevine support automatically if you later switch back to the
  // castlabs build.
  if (app.components && typeof app.components.whenReady === 'function') {
    await app.components.whenReady();
    console.log('components ready:', app.components.status());
  } else {
    console.warn(
      '[widevine] app.components is not available on this Electron build. ' +
      'This means you are on vanilla/stock Electron, not a Widevine-enabled ' +
      'build (e.g. castlabs/electron-releases). DRM-gated sites like Spotify ' +
      'will load but will not be able to play audio ' +
      '(EMEError: Platform does not support navigator.requestMediaKeySystemAccess).'
    );
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});