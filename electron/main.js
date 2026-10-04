// Electron main process: owns app data, permission checks, and native services.
const { app, BrowserWindow, components } = require('electron');
// `components` only exists on the castlabs Electron build (Widevine); it is undefined on stock Electron.
const { ipcMain } = require('electron');
const { dialog, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const { shell: electronShell } = require('electron');
const { normalizeNotes, repoFromConfig, fetchReleaseBody } = require('./update-notes');
const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
const pty = require('node-pty');
const { createModFilesystem } = require('./mod-fs');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

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

// On castlabs Electron the CDM is installed by `components`, so don't point Chromium at an external one.
const widevine = components ? null : findWidevineCdm();
if (components) {
  console.log('[widevine] castlabs Electron detected; CDM is managed by the components API');
} else if (widevine) {
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
const isDev = !app.isPackaged;
const modsDir = isDev ? path.join(rootDir, 'mods') : path.join(app.getPath('userData'), 'mods');
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

function ensureRuntimeSettingsFiles() {
  if (isDev) return;

  fs.mkdirSync(modsDir, { recursive: true });
  for (const [sourceName, targetName] of [['settings.json', '.settings.json'], ['mods-config.json', '.config.json']]) {
    const targetPath = path.join(modsDir, targetName);
    const sourcePath = path.join(rootDir, sourceName);
    if (!fs.existsSync(targetPath) && fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, targetPath);
  }
}

ensureRuntimeSettingsFiles();

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

// Mod filesystem operations are registered below, after permission helpers.

// ============================================================
// Settings and Mod Management
// ============================================================
ipcMain.handle('settings:read', (event, { modId }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'settings.read');
  return { ...defaultSettings, ...readJson(settingsPath, {}) };
});
ipcMain.handle('settings:write', (event, { modId, changes }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'settings.write');
  const settings = { ...defaultSettings, ...readJson(settingsPath, {}), ...changes };
  writeJson(settingsPath, settings);
  return settings;
});

ipcMain.handle('mods:list', () => discoverMods());
ipcMain.handle('mods:toggle', (event, { modId, id }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'mods.toggle');
  const mod = discoverMods().find((item) => item.id === id);
  if (!mod || mod.core) return mod ? mod.enabled : false;
  const config = readJson(configPath, {});
  config[id] = !mod.enabled;
  writeJson(configPath, config);
  return config[id];
});

// Update flow. The renderer owns the confirmation UI (the Core mod's update dialog,
// which shows the release notes as markdown); main reports what is available and,
// when asked, downloads and installs it.
let updateInstalling = false;

async function findUpdate() {
  const result = await autoUpdater.checkForUpdates();
  const update = result?.updateInfo;
  if (!update || update.version === app.getVersion()) return null;
  return update;
}

ipcMain.handle('updates:check', async () => {
  if (!app.isPackaged) return { available: false, configured: false };
  const update = await findUpdate();
  if (!update) return { available: false };

  const repo = repoFromConfig(process.resourcesPath);
  // The raw release body is markdown. If GitHub can't be reached, fall back to the
  // updater's own notes (HTML from the releases feed, converted to markdown).
  const release = await fetchReleaseBody({ repo, version: update.version });
  return {
    available: true,
    version: update.version,
    currentVersion: app.getVersion(),
    body: release?.body || normalizeNotes(update.releaseNotes),
    bodyFormat: 'markdown',
    date: update.releaseDate || null,
    releaseUrl: release?.url || `https://github.com/${repo}/releases/tag/v${update.version}`,
  };
});

ipcMain.handle('updates:install', async () => {
  if (!app.isPackaged) return { installed: false, available: false };
  if (updateInstalling) return { installed: false, available: true, busy: true };
  const update = await findUpdate();
  if (!update) return { installed: false, available: false };

  updateInstalling = true;
  const sendProgress = ({ percent, transferred, total, bytesPerSecond }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updates:progress', { percent, transferred, total, bytesPerSecond });
    }
  };
  autoUpdater.on('download-progress', sendProgress);
  try {
    await autoUpdater.downloadUpdate();
  } finally {
    autoUpdater.removeListener('download-progress', sendProgress);
    updateInstalling = false;
  }
  // Give the renderer a moment to receive this result before the app quits.
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 400);
  return { installed: true, available: true, version: update.version };
});

// Opens a link from rendered markdown in the OS browser (never inside the app window).
ipcMain.handle('app:openExternal', async (_event, { url }) => {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('invalid url'); }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('only http(s) and mailto links can be opened');
  await electronShell.openExternal(parsed.href);
});

function modPermissions(modId) {
  if (typeof modId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(modId)) throw new Error('invalid mod id');
  
  // Resolve the manifest path and verify it's within modsDir to prevent symlink attacks
  const manifestPath = path.resolve(modsDir, modId, 'mod.json');
  const modsDirResolved = path.resolve(modsDir);
  
  // Check that the resolved manifest path is actually within the mods directory
  // This prevents symlink attacks where modId resolves to a path outside modsDir
  if (!manifestPath.startsWith(modsDirResolved + path.sep) && 
      !manifestPath.startsWith(modsDirResolved)) {
    throw new Error(`mod '${modId}' path resolves outside mods directory`);
  }
  
  const manifest = readJson(manifestPath, null);
  return new Set(manifest?.permissions || []);
}

function requirePermission(modId, permission) {
  if (!modPermissions(modId).has(permission)) {
    throw new Error(`mod '${modId}' lacks permission '${permission}'`);
  }
}

function requireEnabledPermission(modId, permission) {
  requirePermission(modId, permission);
  if (!modEnabled(modId)) throw new Error(`mod '${modId}' is disabled`);
}

function modEnabled(modId) {
  if (modId === 'core') return true;
  const mod = discoverMods().find((item) => item.id === modId);
  return !!mod?.enabled;
}

const modFilesystem = createModFilesystem({
  dataDir: path.join(app.getPath('userData'), 'mod-data'),
  requireEnabled(modId) {
    if (!modEnabled(modId)) throw new Error(`mod '${modId}' is disabled`);
  },
  requirePermission(modId, permission) {
    if (!modEnabled(modId)) throw new Error(`mod '${modId}' is disabled`);
    requirePermission(modId, permission);
  },
});

for (const [operation, method] of [
  ['ensureDir', 'ensureDir'], ['readFile', 'readFile'], ['readBytes', 'readBytes'],
  ['writeFile', 'writeFile'], ['writeBytes', 'writeBytes'], ['readDir', 'readDir'],
  ['exists', 'exists'], ['resolvePath', 'resolvePath'], ['toFileUrl', 'toFileUrl'], ['removeFile', 'removeFile'],
  ['removeDir', 'removeDir'], ['move', 'move'],
]) {
  ipcMain.handle(`fs:${operation}`, (event, { modId, path: filePath, from, to, content }) => {
    const callerModId = validateModContext(event, modId);
    try {
      if (operation === 'move') return modFilesystem[method](callerModId, from, to);
      if (operation === 'writeFile' || operation === 'writeBytes') return modFilesystem[method](callerModId, filePath, content);
      return modFilesystem[method](callerModId, filePath);
    } catch (error) {
      // A missing file is a normal answer (first run, optional config). Throwing from an ipcMain handler makes
      // Electron print a stack trace for every one, so hand it to preload.js, which rethrows it in the renderer.
      if (error && error.code === 'ENOENT') return { __fsError: { code: 'ENOENT', message: error.message } };
      throw error;
    }
  });
}

// ============================================================
// Mod webviews. Electron renders these as <webview> elements in the frontend
// so CSS containment and stacking work; these IPC handlers remain the
// permission gate before the frontend creates or manages an element.
// ============================================================
ipcMain.handle('webview:create', (event, { instance, url }) => {
  const callerModId = getCallerModId(event);
  if (!callerModId) throw new Error('No mod context for webview creation');
  requirePermission(callerModId, 'webview.access');
  if (!modEnabled(callerModId)) throw new Error(`mod '${callerModId}' is disabled`);
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('only http(s) URLs can be opened in a mod webview');
  }
  return true;
});

ipcMain.handle('webview:close', (event, { instance }) => {
  const callerModId = getCallerModId(event);
  if (!callerModId) throw new Error('No mod context for webview close');
  requirePermission(callerModId, 'webview.access');
  return true;
});

ipcMain.handle('webview:setVisible', (event, { instance, visible }) => {
  const callerModId = getCallerModId(event);
  if (!callerModId) throw new Error('No mod context for webview setVisible');
  requirePermission(callerModId, 'webview.access');
  return true;
});

ipcMain.handle('webview:setBounds', (event, { instance, x, y, width, height }) => {
  const callerModId = getCallerModId(event);
  if (!callerModId) throw new Error('No mod context for webview setBounds');
  requirePermission(callerModId, 'webview.access');
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'modapp',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'public', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Pages inside a mod <webview> that try to open a new window (target=_blank, window.open, login popups)
// would otherwise be blocked silently. Load those URLs in the same webview instead.
// Test switch: PowerShell> $env:MODAPP_NO_GPU=1; npm start   (rules out GPU/hardware-decode playback problems)
if (process.env.MODAPP_NO_GPU) app.disableHardwareAcceleration();

// Electron's default user agent contains "Electron/x" and sites (Spotify, Google) treat that as an unknown or
// mobile browser. Report a normal desktop Chrome for the current OS and Chromium version instead.
function desktopUserAgent() {
  const os = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : 'X11; Linux x86_64';
  const major = process.versions.chrome.split('.')[0];
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setUserAgent(desktopUserAgent());

  // Debug aid: PowerShell> $env:MODAPP_DEBUG_WEBVIEW=1; npm start
  // Prints webview errors, DRM/licence requests and failed HTTP requests to this terminal.
  if (process.env.MODAPP_DEBUG_WEBVIEW) {
    contents.on('console-message', (event, level, message) => {
      const lvl = event.level ?? level;
      const msg = String(event.message ?? message);
      if (lvl === 'error' || lvl === 3 || /drm|eme|widevine|licen[sc]e|keysystem|mediakeys/i.test(msg)) {
        console.log('[webview console]', lvl, msg.slice(0, 400));
      }
    });
    contents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      const drm = /licen[sc]e|widevine|drm|playready/i.test(details.url);
      if ((details.statusCode >= 400 && !/sessions\/current/.test(details.url)) || drm) {
        console.log('[webview http]', details.statusCode, details.method, details.url.slice(0, 200));
      }
    });
    contents.on('media-started-playing', () => console.log('[webview] media started'));
    contents.on('media-paused', () => console.log('[webview] media paused'));
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) contents.loadURL(url);
    return { action: 'deny' };
  });
});

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
  if (components && typeof components.whenReady === 'function') {
    await components.whenReady();
    console.log('components ready:', components.status());
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

const notificationTimes = new Map();

// Mod context tracking: maps frame IDs to mod IDs
// This ensures mods can only use their own ID for API calls
const modContexts = new Map(); // frameId -> modId

function getCallerModId(event) {
  // Get the frame ID from the IPC event
  const frameId = event?.frameId || event?.sender?.frameId;
  if (!frameId) return null;
  
  // Look up which mod this frame belongs to
  return modContexts.get(frameId) || null;
}

function validateModContext(event, requestedModId) {
  const callerModId = getCallerModId(event);
  if (!callerModId) {
    throw new Error(`cannot determine caller mod context`);
  }
  
  // Ensure the requested modId matches the caller's modId
  if (callerModId !== requestedModId) {
    throw new Error(`mod '${callerModId}' cannot impersonate mod '${requestedModId}'`);
  }
  
  return callerModId;
}

ipcMain.handle('shell:run', (event, { modId, command, cwd = '' }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'shell.run');
  if (typeof command !== 'string' || !command.trim() || Buffer.byteLength(command) > 64 * 1024) {
    throw new Error('shell.run needs a non-empty command smaller than 64 KiB');
  }
  
  // Validate command to prevent shell injection
  // Block dangerous shell metacharacters and commands
  const dangerousPatterns = [
    ';',    // Command separator
    '&',    // Background/job control
    '|',    // Pipe
    '`',    // Command substitution
    '$(',   // Command substitution
    '>',    // Output redirection
    '<',    // Input redirection
    '>>',   // Append redirection
    'rm',   // Dangerous: remove files
    'dd',   // Dangerous: disk destruction
    'mv',   // Dangerous: move files
    'cp',   // Potentially dangerous
    'chmod',// Dangerous: change permissions
    'chown',// Dangerous: change ownership
    'kill', // Dangerous: kill processes
    'pkill',// Dangerous: kill processes
    'wget', // Can download malicious files
    'curl', // Can download malicious files
    'nc',   // Network tool
    'netcat',// Network tool
    'ssh',  // Remote access
    'scp',  // File transfer
    'sftp', // File transfer
    'sudo', // Privilege escalation
    'su',   // Privilege escalation
  ];
  
  const hasDangerousPattern = dangerousPatterns.some(pattern => command.includes(pattern));
  if (hasDangerousPattern) {
    throw new Error('shell.run: command contains disallowed patterns or characters');
  }
  
  // Additional validation: only allow alphanumeric, spaces, and safe characters
  // This allows basic commands like 'ls -la', 'echo hello', etc.
  if (!/^[a-zA-Z0-9_\-\.\/\s]+$/.test(command)) {
    throw new Error('shell.run: command contains invalid characters');
  }
  
  const workingDirectory = modFilesystem.resolvePath(callerModId, cwd || '');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
  return new Promise((resolve) => {
    execFile(executable, args, { cwd: workingDirectory, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        timedOut: error?.killed === true || error?.code === 'ETIMEDOUT',
      });
    });
  });
});

ipcMain.handle('net:fetch', async (event, { modId, url }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'net.fetch');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('fetch_url: url must be http(s)');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw new Error('response is too large (max 1 MiB)');
  return {
    code: response.ok ? 0 : response.status,
    stdout: bytes.toString('utf8'),
    stderr: response.ok ? '' : response.statusText,
    timedOut: false,
  };
});

ipcMain.handle('notifications:send', (event, { modId, title, body }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'notifications.send');
  if (typeof title !== 'string' || !title.trim()) throw new Error('notification title must not be empty');
  if (title.length > 500 || String(body || '').length > 500) throw new Error('notification title/body is too long');
  const now = Date.now();
  const recent = (notificationTimes.get(callerModId) || []).filter((timestamp) => now - timestamp < 60000);
  if (recent.length >= 10) throw new Error(`mod '${callerModId}' is sending notifications too fast (max 10/min)`);
  recent.push(now);
  notificationTimes.set(callerModId, recent);
  if (!Notification.isSupported()) throw new Error('OS notifications are not supported');
  new Notification({ title, body: String(body || '') }).show();
});

ipcMain.handle('dialog:pickFolder', async (event, { modId, title, defaultDir }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'dialog.pick');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || undefined,
    defaultPath: defaultDir || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('dialog:pickFiles', async (event, { modId, title, defaultDir, multiple }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'dialog.pick');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || undefined,
    defaultPath: defaultDir || undefined,
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:pickSaveFile', async (event, { modId, title, defaultDir, defaultName }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'dialog.pick');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: title || undefined,
    defaultPath: defaultDir && defaultName ? path.join(defaultDir, defaultName) : (defaultDir || defaultName || undefined),
  });
  return result.canceled ? null : result.filePath || null;
});

const ptySessions = new Map();

function availableShells() {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    const candidates = [
      { id: 'powershell', label: 'Windows PowerShell', path: path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
      { id: 'cmd', label: 'Command Prompt', path: process.env.ComSpec || path.join(root, 'System32', 'cmd.exe') },
    ];
    if (process.env.ProgramFiles) {
      candidates.unshift({ id: 'pwsh', label: 'PowerShell 7', path: path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe') });
    }
    return candidates.filter((item) => fs.existsSync(item.path)).map((item) => ({ ...item, args: [] }));
  }
  return [...new Set([process.env.SHELL, '/bin/bash', '/bin/zsh', '/bin/sh'].filter(Boolean))]
    .filter((shellPath) => fs.existsSync(shellPath) && !shellPath.endsWith('/nologin') && !shellPath.endsWith('/false'))
    .map((shellPath) => ({ id: shellPath, label: path.basename(shellPath), path: shellPath, args: [] }));
}

function ptySessionKey(modId, session) {
  if (typeof session !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(session)) throw new Error('invalid terminal session id');
  return `${modId}:${session}`;
}

ipcMain.handle('pty:listShells', (event, { modId }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'pty.access');
  return availableShells().map(({ id, label }) => ({ id, label }));
});

ipcMain.handle('pty:spawn', (event, { modId, session, shellId, cols, rows, cwd }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'pty.access');
  const key = ptySessionKey(callerModId, session);
  if (ptySessions.has(key)) throw new Error('terminal session already exists');
  if ([...ptySessions.keys()].filter((existing) => existing.startsWith(`${callerModId}:`)).length >= 16) {
    throw new Error('too many open terminal sessions');
  }
  const shell = availableShells().find((item) => item.id === shellId) || availableShells()[0];
  if (!shell) throw new Error('no supported shell was found');
  const workingDirectory = modFilesystem.resolvePath(callerModId, cwd || '');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const terminal = pty.spawn(shell.path, shell.args, {
    name: 'xterm-256color',
    cols: Math.max(1, Math.min(500, Number(cols) || 80)),
    rows: Math.max(1, Math.min(300, Number(rows) || 24)),
    cwd: workingDirectory,
    env: process.env,
  });
  ptySessions.set(key, { modId: callerModId, session, terminal });
  terminal.onData((data) => mainWindow?.webContents.send('pty:data', { modId: callerModId, session, data }));
  terminal.onExit(({ exitCode }) => {
    ptySessions.delete(key);
    mainWindow?.webContents.send('pty:exit', { modId: callerModId, session, exitCode });
  });
  return shell.label;
});

ipcMain.handle('pty:write', (event, { modId, session, data }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'pty.access');
  const entry = ptySessions.get(ptySessionKey(callerModId, session));
  if (entry && typeof data === 'string' && Buffer.byteLength(data) <= 64 * 1024) entry.terminal.write(data);
});

ipcMain.handle('pty:resize', (event, { modId, session, cols, rows }) => {
  const callerModId = validateModContext(event, modId);
  requireEnabledPermission(callerModId, 'pty.access');
  const entry = ptySessions.get(ptySessionKey(callerModId, session));
  if (entry) entry.terminal.resize(Math.max(1, Math.min(500, Number(cols) || 80)), Math.max(1, Math.min(300, Number(rows) || 24)));
});

ipcMain.handle('pty:kill', (event, { modId, session }) => {
  const callerModId = validateModContext(event, modId);
  requirePermission(callerModId, 'pty.access');
  const key = ptySessionKey(callerModId, session);
  ptySessions.get(key)?.terminal.kill();
  ptySessions.delete(key);
});

app.on('before-quit', () => {
  for (const { terminal } of ptySessions.values()) terminal.kill();
  ptySessions.clear();
});