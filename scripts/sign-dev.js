#!/usr/bin/env node
/**
 * Development signing for Electron binaries
 * Cross-platform wrapper for castLabs EVS signing
 * 
 * Usage:
 *   npm run sign:dev              # Uses cached credentials if no args provided
 *   npm run sign:dev -- --account=your@email.com --password=yourpassword
 *   node scripts/sign-dev.js      # Uses cached credentials
 *   node scripts/sign-dev.js --account=your@email.com --password=yourpassword
 * 
 * If no arguments are provided, assumes user is already signed in with cached
 * credentials from ~/.castlabs_evs (created by: python -m castlabs_evs.account reauth)
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function error(message) {
  log(message, 'ERROR');
  process.exit(1);
}

function getElectronPath() {
  // Default path to electron binary in node_modules
  const electronDist = path.resolve('./node_modules/electron/dist');
  
  // Check if electron.exe exists (Windows) or electron binary (macOS/Linux)
  const isWindows = process.platform === 'win32';
  const electronBinary = isWindows ? 'electron.exe' : 'electron';
  const binaryPath = path.join(electronDist, electronBinary);
  
  if (fs.existsSync(binaryPath)) {
    return electronDist;
  }
  
  // Alternative paths to check
  const altPaths = [
    path.resolve('./node_modules/.bin/electron'),
    path.resolve('./vendor/electron/dist'),
  ];
  
  for (const altPath of altPaths) {
    const altBinary = path.join(altPath, electronBinary);
    if (fs.existsSync(altBinary)) {
      return altPath;
    }
  }
  
  return electronDist; // Return default even if not found
}

function checkPrerequisites() {
  // Check if Python is available
  try {
    const result = spawnSync('python', ['--version'], { stdio: 'pipe' });
    if (result.status !== 0) {
      error('Python is not available. Please install Python 3.');
    }
    log(`Using Python: ${result.stdout.toString().trim()}`);
  } catch (e) {
    error('Python check failed: ' + e.message);
  }

  // Check if castlabs_evs is installed
  try {
    const result = spawnSync('python', ['-m', 'castlabs_evs', '--version'], { stdio: 'pipe' });
    if (result.status !== 0) {
      log('castlabs_evs not found. Installing...');
      const installResult = spawnSync('python', ['-m', 'pip', 'install', 'castlabs-evs'], { stdio: 'inherit' });
      if (installResult.status !== 0) {
        error('Failed to install castlabs-evs. Run: python -m pip install castlabs-evs');
      }
    } else {
      log(`castlabs_evs version: ${result.stdout.toString().trim()}`);
    }
  } catch (e) {
    error('castlabs_evs check failed: ' + e.message);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--account=')) {
      options.account = arg.substring('--account='.length);
    } else if (arg.startsWith('--password=')) {
      options.password = arg.substring('--password='.length);
    } else if (arg.startsWith('--electron-path=')) {
      options.electronPath = arg.substring('--electron-path='.length);
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--')) {
      log(`Unknown option: ${arg}`);
    }
  }
  
  return options;
}

function getCredentials() {
  const options = parseArgs();
  
  const account = options.account || 
    process.env.EVS_ACCOUNT_NAME || 
    process.env.CASTLABS_ACCOUNT_NAME ||
    process.env.EVS_USER;
  
  const password = options.password || 
    process.env.EVS_PASSWD || 
    process.env.CASTLABS_PASSWORD ||
    process.env.EVS_PASSWORD;
  
  const electronPath = options.electronPath || getElectronPath();
  const force = options.force || false;
  
  return { account, password, electronPath, force, hasExplicitCredentials: !!(options.account || options.password) };
}

function signOnWindows(account, password, electronPath, force, hasExplicitCredentials) {
  const psScript = path.resolve('./scripts/sign-dev.ps1');
  
  if (!fs.existsSync(psScript)) {
    error(`PowerShell signing script not found: ${psScript}`);
  }

  // Only pass credentials if they are explicitly provided
  const args = [psScript];
  if (hasExplicitCredentials) {
    if (account) args.push(`-AccountName "${account}"`);
    if (password) args.push(`-Password "${password}"`);
  }
  if (electronPath) args.push(`-ElectronPath "${electronPath}"`);
  if (force) args.push('-Force');

  // Check if we're already in PowerShell
  const isPowershell = process.env._?.toLowerCase().includes('powershell') || 
    process.platform !== 'win32';
  
  if (isPowershell) {
    log(`Running: pwsh ${args.join(' ')}`);
    const result = spawnSync('pwsh', args, { 
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd()
    });
    
    if (result.status !== 0) {
      error(`PowerShell signing failed with exit code ${result.status}`);
    }
  } else {
    // Run through PowerShell
    const psCommand = `& "${psScript}" ${args.slice(1).join(' ')}`;
    
    log(`Running: powershell -Command "${psCommand}"`);
    const result = spawnSync('powershell', ['-Command', psCommand], { 
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd()
    });
    
    if (result.status !== 0) {
      error(`PowerShell signing failed with exit code ${result.status}`);
    }
  }
}

function signOnUnix(account, password, electronPath, force, hasExplicitCredentials) {
  log('Unix signing (macOS/Linux)');
  
  // Set environment variables only if explicitly provided
  const env = { ...process.env };
  if (hasExplicitCredentials) {
    if (account) env.EVS_ACCOUNT_NAME = account;
    if (password) env.EVS_PASSWD = password;
  }
  env.EVS_NO_ASK = '1';
  
  const signCmd = `python -m castlabs_evs.vmp sign-pkg "${electronPath}"`;
  
  log(`Running: ${signCmd}`);
  const result = spawnSync('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', electronPath], {
    stdio: 'inherit',
    env: env,
    cwd: process.cwd()
  });
  
  if (result.status !== 0) {
    error(`castLabs signing failed with exit code ${result.status}`);
  }
  
  log('Electron binary signed successfully!');
}

function checkAlreadySigned(electronPath, force) {
  const isWindows = process.platform === 'win32';
  const sigFile = isWindows ? 
    path.join(electronPath, 'electron.exe.sig') :
    path.join(electronPath, 'electron.sig');
  
  if (fs.existsSync(sigFile) && !force) {
    log(`Electron binary is already signed: ${sigFile}`);
    log('Use --force to re-sign.');
    return true;
  }
  
  return false;
}

function main() {
  const { account, password, electronPath, force, hasExplicitCredentials } = getCredentials();
  
  // If no explicit credentials provided, assume user is signed in with cached credentials
  if (!hasExplicitCredentials && !account && !password) {
    log('No explicit credentials provided, using cached castLabs EVS credentials');
  } else {
    // Validate explicit credentials if provided
    if (!account) {
      error('EVS account name not provided. Set EVS_ACCOUNT_NAME environment variable or use --account=email');
    }
    
    if (!password) {
      error('EVS password not provided. Set EVS_PASSWD environment variable or use --password=pass');
    }
  }
  
  log('Starting Electron binary development signing');
  if (account) log(`Account: ${account}`);
  else log('Using cached credentials');
  log(`Electron path: ${electronPath}`);
  log(`Platform: ${process.platform}`);
  
  // Check if Electron path exists
  if (!fs.existsSync(electronPath)) {
    error(`Electron path not found: ${electronPath}. Run: npm install`);
  }
  
  // Check if already signed
  if (checkAlreadySigned(electronPath, force)) {
    return; // Exit successfully
  }
  
  // Check prerequisites
  checkPrerequisites();
  
  // Sign based on platform
  if (process.platform === 'win32') {
    signOnWindows(account, password, electronPath, force, hasExplicitCredentials);
  } else {
    signOnUnix(account, password, electronPath, force, hasExplicitCredentials);
  }
  
  // Verify signing
  const sigFile = path.join(electronPath, process.platform === 'win32' ? 'electron.exe.sig' : 'electron.sig');
  if (fs.existsSync(sigFile)) {
    log('SUCCESS: Electron binary signed successfully!');
    log(`Signature file: ${sigFile}`);
  } else {
    log('WARNING: Signature file not created. Check if signing was successful.', 'WARNING');
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { 
  getElectronPath, 
  checkPrerequisites, 
  parseArgs, 
  getCredentials,
  signOnWindows,
  signOnUnix,
  checkAlreadySigned,
  main 
};