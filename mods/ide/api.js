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