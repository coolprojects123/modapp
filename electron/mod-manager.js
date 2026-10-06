// Installing, deleting and ordering mods (main process). Kept separate from main.js so it can be tested.
//
// Layout inside modsDir:
//   <id>/mod.json   one folder per mod
//   .config.json    { [id]: enabled }
//   .order.json     [id, ...]  load order (core is always first and is never stored)
//   .removed.json   [id, ...]  bundled mods the user deleted, so the launch-time sync doesn't bring them back
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CORE_ID = 'core';
const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filePath);
}

function sanitizeId(name) {
  const id = String(name || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return MOD_ID_PATTERN.test(id) ? id : null;
}

function isWithin(base, target) {
  const relative = path.relative(base, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Copies a folder, skipping symlinks, and enforces the same size/count limits as a zip.
function copyTree(source, destination, budget) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { copyTree(from, to, budget); continue; }
    if (!entry.isFile()) continue;
    budget.entries += 1;
    budget.bytes += fs.statSync(from).size;
    if (budget.entries > MAX_ENTRIES || budget.bytes > MAX_TOTAL_BYTES) throw new Error('mod is too large');
    fs.copyFileSync(from, to);
  }
}

function extractZip(zipPath, destination) {
  const AdmZip = require('adm-zip'); // only needed for uploads, so load it lazily
  let zip;
  try { zip = new AdmZip(zipPath); } catch { throw new Error('that file is not a valid zip'); }
  const entries = zip.getEntries().filter((entry) => {
    const name = entry.entryName.replace(/\\/g, '/');
    return !entry.isDirectory && !name.startsWith('__MACOSX/') && !name.split('/').pop().startsWith('._');
  });
  if (entries.length === 0) throw new Error('the zip file is empty');
  if (entries.length > MAX_ENTRIES) throw new Error('mod is too large');

  const names = entries.map((entry) => entry.entryName.replace(/\\/g, '/'));
  let total = 0;
  for (const entry of entries) total += entry.header.size;
  if (total > MAX_TOTAL_BYTES) throw new Error('mod is too large');

  // Zipped as a folder (everything under one top-level directory)? Use that directory as the mod root.
  const tops = new Set(names.map((name) => name.split('/')[0]));
  const hasRootManifest = names.includes('mod.json');
  const wrapper = !hasRootManifest && tops.size === 1 && names.every((name) => name.includes('/')) ? [...tops][0] : null;

  let written = 0;
  entries.forEach((entry, index) => {
    let relative = names[index];
    if (wrapper) relative = relative.slice(wrapper.length + 1);
    if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\0')) {
      throw new Error(`unsafe path in zip: ${names[index]}`);
    }
    const target = path.resolve(destination, relative);
    if (!isWithin(destination, target)) throw new Error(`unsafe path in zip: ${names[index]}`);
    const data = entry.getData();
    written += data.length; // header sizes can lie, so count what was actually unpacked too
    if (written > MAX_TOTAL_BYTES) throw new Error('mod is too large');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data); // regular files only, so a zip can't create symlinks
  });

  return wrapper;
}

// ---------- GitHub ----------
// Accepts: owner/repo, github.com/owner/repo, https://github.com/owner/repo(.git),
//          .../tree/<branch>, .../releases/tag/<tag>. The mod must be at the top of the repository.
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const GITHUB_REF = /^[A-Za-z0-9._/-]{1,200}$/;

function parseGithubUrl(input) {
  let text = String(input || '').trim();
  if (!text) throw new Error('enter a GitHub repository URL');
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) text = `https://github.com/${text}`;
  else if (/^github\.com\//i.test(text)) text = `https://${text}`;

  let url;
  try { url = new URL(text); } catch { throw new Error('that is not a valid GitHub URL'); }
  if (url.protocol !== 'https:' || !/^(www\.)?github\.com$/i.test(url.hostname)) {
    throw new Error('only https://github.com links are supported');
  }

  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  const owner = parts[0];
  const repo = (parts[1] || '').replace(/\.git$/i, '');
  if (!GITHUB_NAME.test(owner || '') || !GITHUB_NAME.test(repo) || repo === '.' || repo === '..') {
    throw new Error('expected a link like https://github.com/owner/repo');
  }

  if (parts.length > 2 && parts[2] !== 'tree' && !(parts[2] === 'releases' && parts[3] === 'tag')) {
    throw new Error('expected a link to the repository, a branch (/tree/...) or a release tag');
  }

  let ref = null;
  if (parts[2] === 'tree' && parts.length > 3) ref = parts.slice(3).join('/');
  else if (parts[2] === 'releases' && parts[3] === 'tag' && parts.length > 4) ref = parts.slice(4).join('/');
  if (ref !== null && (!GITHUB_REF.test(ref) || ref.split('/').includes('..'))) throw new Error('invalid branch or tag name');

  return { owner, repo, ref };
}

function githubZipUrl({ owner, repo, ref }) {
  return `https://github.com/${owner}/${repo}/archive/${ref ? ref.split('/').map(encodeURIComponent).join('/') : 'HEAD'}.zip`;
}

// A direct link to a .zip file. https only, no embedded credentials.
function parseZipUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { throw new Error('enter a link that starts with https://'); }
  if (url.protocol !== 'https:') throw new Error('only https:// links are supported');
  if (url.username || url.password) throw new Error('links with a username or password are not supported');
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  return { url: url.href, host: url.host, fileName: `${sanitizeId(last.replace(/\.zip$/i, '')) || 'mod'}.zip` };
}

// Downloads a zip into a temp file and returns its path (the caller deletes the folder it is in).
// `fetchImpl` is injected so main.js can use its private-network-blocking fetch for arbitrary links.
async function downloadZipFile(url, { fetchImpl = fetch, timeoutMs = 60000, fileName = 'mod.zip', hostOk = () => true, notFound } = {}) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'modapp-mod-installer' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) throw new Error(notFound || 'that file was not found');
  if (!response.ok) throw new Error(`the server answered with status ${response.status}`);
  if (!hostOk(new URL(response.url || url).hostname)) throw new Error('unexpected download location');

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_TOTAL_BYTES) throw new Error('mod is too large');

  const chunks = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > MAX_TOTAL_BYTES) { await reader.cancel(); throw new Error('mod is too large'); }
    chunks.push(Buffer.from(value));
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modapp-download-'));
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}

function downloadGithubZip(parsed, options = {}) {
  return downloadZipFile(githubZipUrl(parsed), {
    ...options,
    fileName: `${parsed.repo}.zip`,
    hostOk: (host) => host === 'github.com' || host === 'codeload.github.com',
    notFound: 'that GitHub repository or branch was not found (or it is private)',
  });
}

function createModManager({ modsDir, configPath = path.join(modsDir, '.config.json') }) {
  const orderPath = path.join(modsDir, '.order.json');
  const removedPath = path.join(modsDir, '.removed.json');

  const idList = (filePath) => {
    const value = readJson(filePath, []);
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && MOD_ID_PATTERN.test(id)) : [];
  };

  const removedIds = () => idList(removedPath);

  // Core first, then the saved order; mods with no saved position go last (alphabetically).
  function sortMods(mods) {
    const order = idList(orderPath);
    const rank = (id) => (id === CORE_ID ? -1 : order.includes(id) ? order.indexOf(id) : Number.MAX_SAFE_INTEGER);
    return [...mods].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  }

  // `ids` is the full desired order. Unknown ids are dropped, anything missing is appended, core is implicit.
  function saveOrder(ids, knownIds) {
    if (!Array.isArray(ids)) throw new Error('order must be a list of mod ids');
    const known = new Set(knownIds);
    const next = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id === CORE_ID || !known.has(id) || next.includes(id)) continue;
      next.push(id);
    }
    for (const id of knownIds) if (id !== CORE_ID && !next.includes(id)) next.push(id);
    fs.mkdirSync(modsDir, { recursive: true });
    writeJson(orderPath, next);
    return next;
  }

  // Validates a zip file or folder and unpacks it into a temp folder. Nothing in modsDir is touched yet.
  function stage(sourcePath, { idHint } = {}) {
    const stats = fs.statSync(sourcePath);
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'modapp-install-'));
    const cleanup = () => fs.rmSync(staging, { recursive: true, force: true });
    try {
      let nameHint;
      if (stats.isDirectory()) {
        copyTree(sourcePath, staging, { entries: 0, bytes: 0 });
        nameHint = path.basename(sourcePath);
      } else if (/\.zip$/i.test(sourcePath)) {
        const wrapper = extractZip(sourcePath, staging);
        nameHint = wrapper || path.basename(sourcePath).replace(/\.zip$/i, '');
      } else {
        throw new Error('choose a .zip file or a mod folder');
      }

      const manifest = readJson(path.join(staging, 'mod.json'), null);
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('no valid mod.json found at the top of the mod');
      }
      if (manifest.permissions !== undefined
        && !(Array.isArray(manifest.permissions) && manifest.permissions.every((item) => typeof item === 'string'))) {
        throw new Error('mod.json: "permissions" must be a list of strings');
      }
      const id = sanitizeId(idHint || nameHint);
      if (!id) throw new Error('could not work out a valid mod id from the file name');
      if (id === CORE_ID) throw new Error('"core" is reserved');

      return { id, manifest, dir: staging, cleanup, exists: fs.existsSync(path.join(modsDir, id)) };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  // Moves a staged mod into modsDir (replacing an existing one) and puts it at the end of the load order.
  function commit(staged) {
    const target = path.join(modsDir, staged.id);
    const incoming = path.join(modsDir, `.installing-${staged.id}`);
    try {
      fs.mkdirSync(modsDir, { recursive: true });
      fs.rmSync(incoming, { recursive: true, force: true });
      fs.cpSync(staged.dir, incoming, { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(incoming, target);
    } finally {
      fs.rmSync(incoming, { recursive: true, force: true });
      staged.cleanup();
    }
    writeJson(removedPath, removedIds().filter((id) => id !== staged.id));
    const order = idList(orderPath);
    if (!order.includes(staged.id)) writeJson(orderPath, [...order, staged.id]);
    return staged.id;
  }

  function remove(id) {
    if (typeof id !== 'string' || !MOD_ID_PATTERN.test(id)) throw new Error('invalid mod id');
    if (id === CORE_ID) throw new Error('the core mod cannot be deleted');
    const target = path.resolve(modsDir, id);
    if (!isWithin(path.resolve(modsDir), target)) throw new Error('invalid mod id');
    if (!fs.existsSync(path.join(target, 'mod.json'))) throw new Error(`mod '${id}' is not installed`);

    fs.rmSync(target, { recursive: true, force: true });
    const config = readJson(configPath, {});
    if (config && typeof config === 'object' && id in config) {
      delete config[id];
      writeJson(configPath, config);
    }
    writeJson(orderPath, idList(orderPath).filter((item) => item !== id));
    if (!removedIds().includes(id)) writeJson(removedPath, [...removedIds(), id]);
  }

  return { sortMods, saveOrder, stage, commit, remove, removedIds };
}

module.exports = { createModManager, parseGithubUrl, githubZipUrl, parseZipUrl, downloadZipFile, downloadGithubZip, MOD_ID_PATTERN, CORE_ID };