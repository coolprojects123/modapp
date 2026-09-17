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

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  const filePath = resolveFile(req.url);

  const respond = (status, contentType, data) => {
    res.writeHead(status, { 'Content-Type': contentType });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(data);
  };

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