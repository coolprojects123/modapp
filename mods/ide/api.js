/**
 * IDE API
 * Uses the centralized ModAPI.native.shell API
 */
ModAPI.ide = {
  /**
   * Run a shell command
   * @param {string} command - The command to run
   * @param {string} [cwd] - Working directory (defaults to mods directory)
   * @returns {Promise<{code: number, stdout: string, stderr: string}>}
   */
  async runCommand(command, cwd = '') {
    if (ModAPI.native?.shell?.forMod) {
      return await ModAPI.native.shell.forMod('ide').run(command, cwd);
    }
    
    // Browser mode - no shell access
    throw new Error('Shell API not available in this environment');
  },
  
  /**
   * Run a command and get the output
   * @param {string} command - The command to run
   * @param {string} [cwd] - Working directory
   * @returns {Promise<string>} Combined stdout and stderr
   */
  async runCommandSimple(command, cwd = '') {
    const result = await this.runCommand(command, cwd);
    return result.stdout + result.stderr;
  },
};
// Interactive terminals and native file pickers use explicit permissioned APIs.
(function () {
  const MOD_ID = 'ide';
  const pty = ModAPI.native.pty.forMod(MOD_ID);

  ModAPI.ide.pty = {
    /** @returns {Promise<{id: string, label: string}[]>} default shell first */
    shells: () => pty.shells(),

    /**
     * Start a shell in a real PTY.
     * @returns {Promise<{session: string, label: string, close: () => Promise<void>}>}
     */
    open: (options) => pty.open(options),

    write: (session, data) => pty.write(session, data),

    resize: (session, cols, rows) => pty.resize(session, cols, rows),
  };

  /** Native OS pickers (needs the "dialog.pick" permission). Cancelling resolves to null / []. */
  ModAPI.ide.dialog = {
    pickFolder({ title, defaultDir } = {}) {
      return ModAPI.native.dialog.pickFolder(MOD_ID, { title, defaultDir });
    },
    pickFiles({ title, defaultDir, multiple = true } = {}) {
      return ModAPI.native.dialog.pickFiles(MOD_ID, { title, defaultDir, multiple });
    },
    pickSaveFile({ title, defaultDir, defaultName } = {}) {
      return ModAPI.native.dialog.pickSaveFile(MOD_ID, { title, defaultDir, defaultName });
    },
  };
})();