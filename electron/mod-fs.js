const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_READ_BYTES = 256 * 1024 * 1024;
const MOD_DATA_QUOTA_BYTES = 4 * 1024 * 1024 * 1024;
const MOD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isWithin(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function realPathForMissingTarget(target) {
  let probe = target;
  while (true) {
    try {
      const resolved = fs.realpathSync(probe);
      return path.resolve(resolved, path.relative(probe, target));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        if (fs.lstatSync(probe).isSymbolicLink()) throw new Error('path contains a broken symlink');
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      const parent = path.dirname(probe);
      if (parent === probe) throw new Error('invalid path');
      probe = parent;
    }
  }
}

function directorySize(directory) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch { return 0; }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += directorySize(target);
    else if (entry.isFile()) {
      try { total += fs.statSync(target).size; } catch { /* concurrently removed */ }
    }
  }
  return total;
}

function checkQuota(base, target, incomingBytes) {
  let previousBytes = 0;
  try { previousBytes = fs.statSync(target).size; } catch { /* new file */ }
  const used = Math.max(0, directorySize(base) - previousBytes);
  if (used + incomingBytes > MOD_DATA_QUOTA_BYTES) {
    throw new Error(`mod data quota of ${MOD_DATA_QUOTA_BYTES / (1024 * 1024)} MiB exceeded`);
  }
}

function createModFilesystem({ modsDir, dataDir, requireEnabled, requirePermission }) {
  function resolveTarget(modId, requestedPath, permission) {
    if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId)) throw new Error('invalid mod id');
    if (typeof requestedPath !== 'string' || requestedPath.includes('\0')) throw new Error('invalid path');

    // Mods only get relative paths inside their own data directory. Check that before touching the disk.
    if (path.isAbsolute(requestedPath)) {
      throw new Error('absolute paths are not allowed; use relative paths within mod data directory');
    }
    if (requestedPath.split(/[\\/]/).includes('..')) throw new Error('path traversal is not allowed');
    if (process.platform === 'win32' && requestedPath.includes(':')) throw new Error('invalid path');

    requireEnabled(modId);

    const base = path.resolve(dataDir, modId);
    const target = path.resolve(base, requestedPath);
    if (!isWithin(base, target)) throw new Error('path escapes the mod data directory');
    // Resolve symlinks too, so a link inside the data directory can't point somewhere else.
    if (!isWithin(realPathForMissingTarget(base), realPathForMissingTarget(target))) {
      throw new Error('path escapes the mod data directory');
    }
    const ownData = true;

    return { base, target, ownData };
  }

  function ensureDir(modId, requestedPath) {
    const { target } = resolveTarget(modId, requestedPath, 'fs.ensure_dir');
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  function readFile(modId, requestedPath) {
    const { target } = resolveTarget(modId, requestedPath, 'fs.read');
    if (fs.statSync(target).size > MAX_READ_BYTES) throw new Error('file is too large to read');
    return fs.readFileSync(target, 'utf8');
  }

  function readBytes(modId, requestedPath) {
    const { target } = resolveTarget(modId, requestedPath, 'fs.read');
    if (fs.statSync(target).size > MAX_READ_BYTES) throw new Error('file is too large to read');
    return Array.from(fs.readFileSync(target));
  }

  function writeFile(modId, requestedPath, content) {
    if (typeof content !== 'string') throw new Error('file content must be a string');
    const resolved = resolveTarget(modId, requestedPath, 'fs.write');
    if (resolved.ownData) checkQuota(resolved.base, resolved.target, Buffer.byteLength(content));
    fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
    fs.writeFileSync(resolved.target, content, 'utf8');
  }

  function writeBytes(modId, requestedPath, bytes) {
    if (!Array.isArray(bytes) || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error('file content must be a byte array');
    }
    const content = Buffer.from(bytes);
    const resolved = resolveTarget(modId, requestedPath, 'fs.write');
    if (resolved.ownData) checkQuota(resolved.base, resolved.target, content.length);
    fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
    fs.writeFileSync(resolved.target, content);
  }

  function readDir(modId, requestedPath = '') {
    const { target } = resolveTarget(modId, requestedPath, 'fs.read_dir');
    return fs.readdirSync(target);
  }

  function exists(modId, requestedPath) {
    const { target } = resolveTarget(modId, requestedPath, 'fs.read');
    return fs.existsSync(target);
  }

  function resolvePath(modId, requestedPath) {
    return resolveTarget(modId, requestedPath, 'fs.read').target;
  }

  function toFileUrl(modId, requestedPath) {
    return pathToFileURL(resolveTarget(modId, requestedPath, 'fs.read').target).href;
  }

  function removeFile(modId, requestedPath) {
    const { target } = resolveTarget(modId, requestedPath, 'fs.remove');
    fs.unlinkSync(target);
  }

  function removeDir(modId, requestedPath) {
    const { target } = resolveTarget(modId, requestedPath, 'fs.remove');
    if (path.dirname(target) === target) throw new Error('refusing to remove a filesystem root');
    fs.rmSync(target, { recursive: true });
  }

  function move(modId, fromPath, toPath) {
    const source = resolveTarget(modId, fromPath, 'fs.move');
    const destination = resolveTarget(modId, toPath, 'fs.move');
    if (!source.ownData || !destination.ownData) requirePermission(modId, 'fs.move');
    fs.mkdirSync(path.dirname(destination.target), { recursive: true });
    fs.renameSync(source.target, destination.target);
  }

  return { ensureDir, readFile, readBytes, writeFile, writeBytes, readDir, exists, resolvePath, toFileUrl, removeFile, removeDir, move };
}

module.exports = { createModFilesystem };