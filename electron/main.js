// ELECTRON FOR TESTING ONLY. This file is not used in the Tauri build, which uses src-tauri/src/lib.rs instead.
const { app, BrowserWindow } = require('electron');
const { ipcMain } = require('electron');
const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

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
      return JSON.stringify(await ipcMain.handle('settings:read')());
    }
    if (functionName === 'write_settings') {
      const changes = JSON.parse(args[0] || '{}');
      return JSON.stringify(await ipcMain.handle('settings:write', { changes }));
    }
    if (functionName === 'toggle_mod') {
      return await ipcMain.handle('mods:toggle', args[0]);
    }
  }
  
  if (modId === 'music-player' && functionName === 'ensure_uploads_dir') {
    return await ipcMain.handle('ensure_dir', { path: 'music-uploads' });
  }
  
  if (modId === 'ide' && functionName === 'run_command') {
    return await ipcMain.handle('shell:run', { command: args[0], cwd: args[1] || '' });
  }
  
  throw new Error(`Unknown backend function: ${modId}.${functionName}`);
});

// Old native:invoke endpoint - redirects to new system
ipcMain.handle('native:invoke', (_event, { method, payload } = {}) => {
  console.warn('[Electron] native:invoke is deprecated.');
  
  if (method === 'ensure_music_uploads_dir') {
    return ipcMain.handle('ensure_dir', { path: 'music-uploads' });
  }
  if (method === 'shell.run') {
    return ipcMain.handle('shell:run', payload);
  }
  
  throw new Error(`Unknown native method: ${method}`);
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

app.whenReady().then(createWindow);

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
