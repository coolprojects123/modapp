#!/usr/bin/env node
// scripts/dev-server.js
//
// Minimal static file server for `tauri dev`. Serves the app shell from
// `public/` at the site root, and mod folders from `mods/` under `/mods/*`
// — the same two directories the packaged app ultimately resolves assets
// from, just over plain HTTP instead of Tauri's asset protocol.
//
// Why this exists: with no `devUrl`/`beforeDevCommand` set, the Tauri CLI
// spins up its own built-in dev server that ONLY serves `frontendDist`
// (public/). `mods/` sits outside that directory, so anything under it
// (mod script.js/style.css/vendor files) 404s to the SPA fallback. This
// server exposes both directories explicitly instead.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 1430;
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const MODS_DIR = path.join(ROOT, 'mods');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Order matters: more specific prefixes first.
const ROUTES = [
  { prefix: '/mods/', dir: path.join(ROOT, 'mods') },
  { prefix: '/', dir: path.join(ROOT, 'public') },
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.lua': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);

  // Special case: serve dynamic mods.js
  if (decoded === '/js/mods.js' || decoded === '/mods.js') {
    return null; // Will be handled separately
  }

  for (const route of ROUTES) {
    if (!decoded.startsWith(route.prefix)) continue;
    const relative = decoded.slice(route.prefix.length);
    const filePath = path.normalize(path.join(route.dir, relative));

    // Refuse to serve anything that escapes this route's own directory
    // (blocks `..`-based path traversal out of public/ or mods/).
    if (!filePath.startsWith(route.dir)) continue;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

function generateModsJS() {
  let manifests = [];
  
  // Load mods-config.json for enabled state
  const modsConfigPath = path.join(ROOT, 'mods-config.json');
  const modsConfig = fs.existsSync(modsConfigPath)
    ? JSON.parse(fs.readFileSync(modsConfigPath, 'utf-8'))
    : {};
  
  if (fs.existsSync(MODS_DIR)) {
    const modFolders = fs.readdirSync(MODS_DIR);
    
    for (const folder of modFolders) {
      const modJsonPath = path.join(MODS_DIR, folder, 'mod.json');
      
      if (fs.existsSync(modJsonPath)) {
        try {
          const modJson = JSON.parse(fs.readFileSync(modJsonPath, 'utf-8'));
          const id = modJson.id || folder;
          const modsConfigValue = modsConfig[id];
          const enabled = modsConfigValue !== undefined ? modsConfigValue : modJson.enabledByDefault || false;
          const manifest = {
            id: id,
            name: modJson.name || folder,
            version: modJson.version || '1.0.0',
            description: modJson.description || '',
            enabledByDefault: modJson.enabledByDefault || false,
            enabled: enabled,
            apis: modJson.apis || [],
            styles: modJson.styles || [],
            scripts: modJson.scripts || [],
          };
          manifests.push(manifest);
        } catch (err) {
          console.error(`[dev-server] failed to read mod.json for ${folder}:`, err);
        }
      }
    }
  }
  
  // Sort: core first, then alphabetically
  manifests.sort((a, b) => {
    if (a.id === 'core') return -1;
    if (b.id === 'core') return 1;
    return a.id.localeCompare(b.id);
  });
  
  const jsContent = `window.MOD_MANIFESTS = ${JSON.stringify(manifests, null, 2)};`;
  return jsContent;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  const urlPath = req.url;
  const decoded = decodeURIComponent(urlPath.split('?')[0]);

  const respond = (status, contentType, data) => {
    res.writeHead(status, { 'Content-Type': contentType });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(data);
  };

  // Special handling for dynamic mods.js
  if (decoded === '/js/mods.js' || decoded === '/mods.js') {
    try {
      const jsContent = generateModsJS();
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(jsContent);
    } catch (err) {
      respond(500, 'text/plain', 'Internal server error');
    }
    return;
  }

  const filePath = resolveFile(req.url);

  if (!filePath) {
    // No matching static file under either route — fall back to the app
    // shell, same SPA-fallback behavior as Tauri's built-in dev server.
    const indexPath = path.join(ROOT, 'public', 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) { respond(404, 'text/plain', 'Not found'); return; }
      respond(200, 'text/html; charset=utf-8', data);
    });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { respond(500, 'text/plain', 'Internal server error'); return; }
    respond(200, contentType, data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[dev-server] serving public/ at / and mods/ at /mods/ on http://${HOST}:${PORT}`);
});