/**
 * Music Player API
 * Uses the centralized ModAPI.native.fs API
 */
ModAPI.music = {
  async getFilesystem() {
    if (window.nativeAPIReady) await window.nativeAPIReady;
    const native = window.nativeAPI || ModAPI.native;
    // Each mod automatically uses its own ID - no forMod() needed
    return native?.fs;
  },

  async getFileUrl(filePath) {
    const fs = await this.getFilesystem();
    if (!fs?.toFileUrl) throw new Error('Native file URL API not available');
    return fs.toFileUrl(filePath);
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