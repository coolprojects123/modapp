// electron-builder hook: VMP-sign the packaged app with castLabs EVS so Widevine
// DRM sites (Spotify, ...) keep playing in the built app.
//
// Wired up in the electron-builder config:  "afterSign": "build/evs-sign.js"
// (afterSign runs after Authenticode code-signing and before the installer is made.
//  On Windows the VMP signature has to come AFTER code-signing, or it breaks.)
//
// Credentials come from EVS_ACCOUNT_NAME / EVS_PASSWD in the environment, or from
// your cached `python -m castlabs_evs.account reauth` login on a dev machine.
const { spawnSync } = require('child_process');

exports.default = async function evsSign(context) {
  const isLinux = context.electronPlatformName === 'linux';

  const python = process.platform === 'win32' ? 'python' : 'python3';
  // In CI there is no TTY: fail with an error instead of waiting for a password prompt.
  const env = { ...process.env, ...(process.env.CI ? { EVS_NO_ASK: '1' } : {}) };

  // sign-pkg takes the folder that CONTAINS the .exe / .app, which is appOutDir.
  const result = spawnSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], {
    stdio: 'inherit',
    env,
  });

  if (isLinux) {
    // Experimental: the Linux Widevine CDM has no VMP, so don't fail the build over it.
    if (result.error || result.status !== 0) {
      console.warn('[evs] Linux signing failed or is unsupported; continuing unsigned');
    }
    return;
  }

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`EVS VMP signing failed (exit code ${result.status})`);
};