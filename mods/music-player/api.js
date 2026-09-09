/**
 * Music Player API
 * Uses the centralized ModAPI.native.fs API
 */
ModAPI.music = {
  async getFilesystem() {
    if (window.nativeAPIReady) await window.nativeAPIReady;
    const native = window.nativeAPI || ModAPI.native;
    if (native?.fs?.forMod) return native.fs.forMod('music-player');

    if (typeof window.__TAURI_INVOKE__ === 'function') {
      const invoke = window.__TAURI_INVOKE__;
      const payload = (extra = {}) => ({ modId: 'music-player', ...extra });
      return {
        ensureDir: (path) => invoke('system_ensure_dir', payload({ path })),
        readFile: (path) => invoke('system_read_file', payload({ path })),
        writeFile: (path, content) => invoke('system_write_file', payload({ path, content })),
        readBytes: async (path) => new Uint8Array(await invoke('system_read_bytes', payload({ path }))),
        writeBytes: (path, bytes) => invoke('system_write_bytes', payload({ path, content: Array.from(bytes) })),
        readDir: (path = '') => invoke('system_read_dir', payload({ path })),
        resolvePath: (path) => invoke('system_resolve_path', payload({ path })),
        move: (from, to) => invoke('system_move', payload({ from, to })),
        removeFile: (path) => invoke('system_remove_file', payload({ path })),
      };
    }

    return native?.fs
  },

  async getFileUrl(filePath) {
    const fs = await this.getFilesystem();
    if (!fs?.resolvePath) throw new Error('Native file URL API not available');
    const path = await fs.resolvePath(filePath);
    const convert = window.nativeAPI?.convertFileSrc || ((value) =>
      `asset://localhost/${encodeURIComponent(value)}`);
    return convert(path);
  },

  /**
   * Ensures the music uploads directory exists
   * @returns {Promise<string>} The path to the uploads directory
   */
  async ensureUploadsDir() {
    const fs = await this.getFilesystem();
    if (fs?.ensureDir) {
      return await fs.ensureDir('music-uploads');
    }

    // Fallback to old callBackend system for backwards compatibility
    if (window.appAPI?.callBackend) {
      return await ModAPI.native.callBackend('music-player', 'ensure_uploads_dir', []);
    }

    // Browser mode - return empty (no FS access)
    return '';
  },

  /**
   * Reads a file from the music directory
   * @param {string} filePath - Path relative to mod data directory
   * @returns {Promise<string>} File contents
   */
  readFile: async function(filePath) {
    const fs = await this.getFilesystem();
    if (fs?.readFile) {
      return await fs.readFile(filePath);
    }
    throw new Error('File API not available in this environment');
  },

  /**
   * Writes a file to the music directory
   * @param {string} filePath - Path relative to mod data directory
   * @param {string} content - File content
   * @returns {Promise<void>}
   */
  writeFile: async function(filePath, content) {
    const fs = await this.getFilesystem();
    if (fs?.writeFile) {
      return await fs.writeFile(filePath, content);
    }
    throw new Error('File API not available in this environment');
  },

  /**
   * Lists files in a directory
   * @param {string} dirPath - Path relative to mod data directory
   * @returns {Promise<string[]>} Array of filenames
   */
  listDir: async function(dirPath) {
    const fs = await this.getFilesystem();
    if (fs?.readDir) {
      return await fs.readDir(dirPath);
    }
    throw new Error('File API not available in this environment');
  },

  readBytes: async function(filePath) {
    const fs = await this.getFilesystem();
    if (fs?.readBytes) return await fs.readBytes(filePath);
    throw new Error('Binary file API not available in this environment');
  },

  writeBytes: async function(filePath, bytes) {
    const fs = await this.getFilesystem();
    if (fs?.writeBytes) return await fs.writeBytes(filePath, bytes);
    throw new Error('Binary file API not available in this environment');
  },

  move: async function(from, to) {
    const fs = await this.getFilesystem();
    if (fs?.move) return await fs.move(from, to);
    throw new Error('File API not available in this environment');
  },

  removeFile: async function(filePath) {
    const fs = await this.getFilesystem();
    if (fs?.removeFile) return await fs.removeFile(filePath);
    throw new Error('File API not available in this environment');
  },
};