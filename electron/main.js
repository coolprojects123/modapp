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

ipcMain.handle('mods:list', () => discoverMods());
ipcMain.handle('mods:toggle', (_event, id) => {
  const mod = discoverMods().find((item) => item.id === id);
  if (!mod || mod.core) return mod ? mod.enabled : false;
  const config = readJson(configPath, {});
  config[id] = !mod.enabled;
  writeJson(configPath, config);
  return config[id];
});

ipcMain.handle('mods:callBackend', async (_event, { modId, functionName, args }) => {
  const mod = discoverMods().find((m) => m.id === modId);
  if (!mod) throw new Error(`Mod not found: ${modId}`);
  
  const backendPath = path.join(modsDir, modId, 'backend.lua');
  if (!fs.existsSync(backendPath)) throw new Error(`Backend not found for mod ${modId}`);
  
  // Core mod backend functions
  if (modId === 'core') {
    if (functionName === 'read_settings') {
      return JSON.stringify(readJson(settingsPath, {}));
    }
    if (functionName === 'write_settings') {
      const changes = JSON.parse(args[0] || '{}');
      const settings = { ...defaultSettings, ...readJson(settingsPath, {}), ...changes };
      writeJson(settingsPath, settings);
      return JSON.stringify(settings);
    }
    if (functionName === 'toggle_mod') {
      const id = args[0];
      const modToToggle = discoverMods().find((m) => m.id === id);
      if (!modToToggle || modToToggle.core) return modToToggle ? modToToggle.enabled : false;
      const config = readJson(configPath, {});
      config[id] = !modToToggle.enabled;
      writeJson(configPath, config);
      return config[id];
    }
  }
  
  // IDE mod backend functions
  if (modId === 'ide' && functionName === 'run_command') {
    const command = args[0] || '';
    const cwd = args[1] || modsDir;
    return new Promise((resolve) => {
      execFile('/usr/bin/bash', ['-lc', command], { 
        cwd: cwd !== '' ? cwd : undefined, 
        timeout: 30000, 
        maxBuffer: 1024 * 1024 
      }, (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    });
  }
  
  // Music Player mod backend functions
  if (modId === 'music-player' && functionName === 'ensure_uploads_dir') {
    const uploadsDir = path.join(app.getPath('userData'), 'music-uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    return uploadsDir;
  }
  
  throw new Error(`Unknown backend function: ${modId}.${functionName}`);
});
ipcMain.handle('settings:read', () => ({ ...defaultSettings, ...readJson(settingsPath, {}) }));
ipcMain.handle('settings:write', (_event, changes) => {
  const settings = { ...defaultSettings, ...readJson(settingsPath, {}), ...changes };
  writeJson(settingsPath, settings);
  return settings;
});
ipcMain.handle('updates:check', () => ({ available: false }));
ipcMain.handle('updates:install', () => ({ installed: false, available: false }));
ipcMain.handle('native:invoke', (_event, { method, payload } = {}) => {
  if (method === 'ensure_music_uploads_dir') {
    const uploadsDir = path.join(app.getPath('userData'), 'music-uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    return uploadsDir;
  }
  if (method !== 'shell.run') throw new Error(`Unknown native method: ${method}`);
  return new Promise((resolve) => {
    const { command, cwd } = payload || {};
    execFile('/usr/bin/bash', ['-lc', command], { cwd: cwd || modsDir, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'modapp',
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
