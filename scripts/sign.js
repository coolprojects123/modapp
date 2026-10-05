#!/usr/bin/env node
/**
 * Code signing script for Electron binaries
 * 
 * Usage:
 *   npm run sign -- --platform=win32 (Windows)
 *   npm run sign -- --platform=darwin (macOS)
 *   npm run sign -- --platform=linux (Linux, experimental)
 * 
 * Environment variables for signing:
 * - WIN_CSC_LINK: Path to Windows code signing certificate (.p12 file)
 * - WIN_CSC_KEY_PASSWORD: Password for Windows certificate
 * - CSC_LINK: Path to macOS code signing certificate
 * - CSC_KEY_PASSWORD: Password for macOS certificate
 * - CSC_IDENTITY_AUTO_DISCOVERY: Set to false to use specific identity
 * 
 * For EVS (Widevine) signing:
 * - EVS_ACCOUNT_NAME: castLabs EVS account name
 * - EVS_PASSWD: castLabs EVS password
 * 
 * This script works with electron-builder's built-in code signing.
 * electron-builder automatically handles code signing when the
 * appropriate environment variables are set.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function log(message) {
  console.log(`[sign] ${message}`);
}

function error(message) {
  console.error(`[sign] ERROR: ${message}`);
  process.exit(1);
}

function getPlatformFromArgs() {
  const args = process.argv.slice(2);
  const platformArg = args.find(arg => arg.startsWith('--platform='));
  if (platformArg) {
    return platformArg.split('=')[1];
  }
  return process.platform;
}

function checkSigningPrerequisites(platform) {
  const prerequisites = {
    win32: [
      { env: 'WIN_CSC_LINK', desc: 'Windows code signing certificate (.p12) path' },
      { env: 'WIN_CSC_KEY_PASSWORD', desc: 'Windows certificate password' }
    ],
    darwin: [
      { env: 'CSC_LINK', desc: 'macOS Developer ID Application certificate path' },
      { env: 'CSC_KEY_PASSWORD', desc: 'macOS certificate password (optional)' }
    ],
    linux: [] // No standard code signing for Linux
  };

  const missing = [];
  const platformPrereqs = prerequisites[platform] || [];
  
  for (const { env, desc } of platformPrereqs) {
    if (!process.env[env]) {
      missing.push(`${env} (${desc})`);
    }
  }

  if (missing.length > 0) {
    log(`Warning: Missing environment variables for ${platform} code signing:`);
    missing.forEach(m => log(`  - ${m}`));
    log('');
    log('electron-builder will skip code signing if certificates are not configured.');
    log('You can set these variables in your environment or .env file.');
    return false;
  }
  return true;
}

function checkEVSPrerequisites() {
  const missing = [];
  
  if (!process.env.EVS_ACCOUNT_NAME) {
    missing.push('EVS_ACCOUNT_NAME (castLabs EVS account name)');
  }
  if (!process.env.EVS_PASSWD) {
    missing.push('EVS_PASSWD (castLabs EVS password)');
  }

  if (missing.length > 0) {
    log(`Warning: Missing EVS environment variables for Widevine DRM signing:`);
    missing.forEach(m => log(`  - ${m}`));
    log('');
    log('Widevine DRM content (Spotify, Netflix) will not work in signed builds.');
    return false;
  }
  return true;
}

function signBinaries(platform) {
  log(`Starting signing process for ${platform}`);
  
  const distDir = path.resolve('./dist-electron');
  
  // Check if binaries exist
  if (!fs.existsSync(distDir)) {
    error(`No built binaries found in ${distDir}. Run 'npm run build' or 'npm run build:${platform}' first.`);
  }

  // Build arguments based on platform
  const args = ['--publish', 'never'];
  
  switch (platform) {
    case 'win32':
      args.push('--win', '--x64');
      break;
    case 'darwin':
      args.push('--mac', '--x64', '--arm64');
      break;
    case 'linux':
      args.push('--linux', '--x64');
      break;
    default:
      error(`Unsupported platform: ${platform}. Use win32, darwin, or linux.`);
  }

  log(`Running electron-builder with signing: electron-builder ${args.join(' ')}`);
  
  // Run electron-builder which handles code signing automatically
  const result = spawnSync('npx', ['electron-builder', ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Ensure electron-builder uses the correct platform
      npm_config_arch: platform === 'darwin' ? 'arm64,x64' : 'x64'
    }
  });

  if (result.error) {
    error(`Failed to run electron-builder: ${result.error.message}`);
  }

  if (result.status !== 0) {
    error(`electron-builder exited with code ${result.status}`);
  }

  log(`Successfully signed binaries for ${platform}`);
  
  // Check if EVS signing was performed
  if (platform !== 'linux') {
    const evsResult = spawnSync('node', ['./build/evs-sign.js'], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env
    });

    if (evsResult.status === 0) {
      log('EVS signing completed successfully');
    } else if (evsResult.status !== null) {
      log('EVS signing skipped or failed (optional for Widevine DRM)');
    }
  }
}

function main() {
  const platform = getPlatformFromArgs();
  log(`Signing for platform: ${platform}`);
  
  // Check prerequisites but don't fail - electron-builder can handle missing certs
  checkSigningPrerequisites(platform);
  checkEVSPrerequisites();
  
  // Run the signing process
  signBinaries(platform);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { signBinaries, checkSigningPrerequisites, checkEVSPrerequisites };