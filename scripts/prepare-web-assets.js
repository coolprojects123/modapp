const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'node_modules', 'jsmediatags', 'dist', 'jsmediatags.min.js');
const targetDir = path.join(__dirname, '..', 'mods', 'music-player', 'vendor');
const target = path.join(targetDir, 'jsmediatags.min.js');

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);