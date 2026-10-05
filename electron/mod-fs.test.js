const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createModFilesystem } = require('./mod-fs');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modapp-mod-fs-'));
  const modsDir = path.join(root, 'mods');
  const dataDir = path.join(root, 'mod-data');
  fs.mkdirSync(path.join(modsDir, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'demo', 'mod.json'), JSON.stringify({ permissions: ['fs.read'] }));
  const permissions = new Set(['fs.read']);
  const filesystem = createModFilesystem({
    modsDir,
    dataDir,
    requireEnabled: (modId) => {
      if (modId !== 'demo') throw new Error('unknown mod');
    },
    requirePermission: (modId, permission) => {
      if (modId !== 'demo') throw new Error('unknown mod');
      if (!permissions.has(permission)) throw new Error(`mod '${modId}' lacks permission '${permission}'`);
    },
  });
  return { root, dataDir, filesystem, permissions };
}

test('relative data paths work without filesystem permissions', (context) => {
  const { root, filesystem } = setup();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  filesystem.writeFile('demo', 'notes.txt', 'hello');
  assert.equal(filesystem.readFile('demo', 'notes.txt'), 'hello');
});

test('relative traversal is rejected before touching disk', (context) => {
  const { root, filesystem } = setup();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => filesystem.writeFile('demo', '../outside.txt', 'blocked'), /traversal/);
});

test('absolute paths are rejected for security', (context) => {
  const { root, filesystem, permissions } = setup();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside.txt');
  // Absolute paths are now blocked entirely for security
  assert.throws(() => filesystem.writeFile('demo', outside, 'blocked'), /absolute paths are not allowed/);
  // Even with fs.write permission, absolute paths are blocked
  permissions.add('fs.write');
  assert.throws(() => filesystem.writeFile('demo', outside, 'allowed'), /absolute paths are not allowed/);
});

test('mods that are unknown or disabled are rejected', (context) => {
  const { root, filesystem } = setup();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => filesystem.readFile('other', 'notes.txt'), /unknown mod/);
  assert.throws(() => filesystem.readFile('../demo', 'notes.txt'), /invalid mod id/);
});

test('symlinks cannot be used to escape the data directory', (context) => {
  const { root, dataDir, filesystem } = setup();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(dataDir, 'demo'), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(dataDir, 'demo', 'link'), 'junction');
  } catch {
    context.skip('symlinks are not available here');
    return;
  }
  assert.throws(() => filesystem.writeFile('demo', 'link/escaped.txt', 'blocked'), /escapes/);
  assert.equal(fs.existsSync(path.join(outside, 'escaped.txt')), false);
});