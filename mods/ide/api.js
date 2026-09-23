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
    // Use the new centralized shell API if available
    if (ModAPI.native?.shell?.run) {
      return await ModAPI.native.shell.run(command, cwd);
    }
    
    // Fallback to old callBackend system for backwards compatibility
    if (window.appAPI?.callBackend) {
      return await ModAPI.native.callBackend('ide', 'run_command', [command, cwd]);
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
/**
 * PTY + dialog APIs: real interactive terminal sessions ("pty.access", separate from
 * "shell.run") and native file pickers ("dialog.pick"). Talk to the native pty_* / pick_* commands.
 */
(function () {
  const MOD_ID = 'ide';

  function bridge() {
    const g = window.__TAURI__;
    if (g && g.core && g.core.invoke && g.event && g.event.listen) {
      return { invoke: g.core.invoke.bind(g.core), listen: g.event.listen.bind(g.event) };
    }
    const t = window.__TAURI_INTERNALS__;
    if (!t) throw new Error('The terminal needs the native app (Tauri IPC is not available here)');
    return {
      invoke: (cmd, args) => t.invoke(cmd, args),
      listen: async (event, handler) => {
        const callback = t.transformCallback(handler);
        const eventId = await t.invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: callback });
        return () => {
          try { window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener(event, eventId); } catch { /* older Tauri */ }
          t.invoke('plugin:event|unlisten', { event, eventId }).catch(() => {});
        };
      },
    };
  }

  ModAPI.ide.pty = {
    /** @returns {Promise<{id: string, label: string}[]>} default shell first */
    shells() {
      return bridge().invoke('pty_list_shells', { modId: MOD_ID });
    },

    /**
     * Start a shell in a real PTY.
     * @returns {Promise<{session: string, label: string, close: () => Promise<void>}>}
     */
    async open({ shell, cols, rows, cwd, onData, onExit }) {
      const b = bridge();
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const session = Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
      const offs = [
        await b.listen(`pty_${session}_data`, (event) => onData(event.payload)),
        await b.listen(`pty_${session}_exit`, (event) => onExit(event.payload)),
      ];
      const release = () => offs.forEach((off) => { try { off(); } catch { /* already gone */ } });
      try {
        const label = await b.invoke('pty_spawn', { modId: MOD_ID, session, shellId: shell || null, cols, rows, cwd: cwd || null });
        return {
          session,
          label,
          close: async () => { release(); await b.invoke('pty_kill', { modId: MOD_ID, session }).catch(() => {}); },
        };
      } catch (error) {
        release();
        throw error;
      }
    },

    write(session, data) {
      return bridge().invoke('pty_write', { modId: MOD_ID, session, data });
    },

    resize(session, cols, rows) {
      return bridge().invoke('pty_resize', { modId: MOD_ID, session, cols, rows });
    },
  };

  /** Native OS pickers (needs the "dialog.pick" permission). Cancelling resolves to null / []. */
  ModAPI.ide.dialog = {
    pickFolder({ title, defaultDir } = {}) {
      return bridge().invoke('pick_folder', { modId: MOD_ID, title: title || null, defaultDir: defaultDir || null });
    },
    pickFiles({ title, defaultDir, multiple = true } = {}) {
      return bridge().invoke('pick_files', { modId: MOD_ID, title: title || null, defaultDir: defaultDir || null, multiple });
    },
    pickSaveFile({ title, defaultDir, defaultName } = {}) {
      return bridge().invoke('pick_save_file', { modId: MOD_ID, title: title || null, defaultDir: defaultDir || null, defaultName: defaultName || null });
    },
  };
})();