exports.default = async function evsSign(context) {
  const isLinux = context.electronPlatformName === 'linux';

  const python = process.platform === 'win32' ? 'python' : 'python3';
  const env = { ...process.env, ...(process.env.CI ? { EVS_NO_ASK: '1' } : {}) };

  const result = spawnSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], {
    stdio: 'inherit',
    env,
  });

  if (isLinux) {
    // Experimental: the Linux CDM has no VMP, so don't fail the build over it.
    if (result.error || result.status !== 0) {
      console.warn('[evs] Linux signing failed or is unsupported; continuing unsigned');
    }
    return;
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`EVS VMP signing failed (exit code ${result.status})`);
};