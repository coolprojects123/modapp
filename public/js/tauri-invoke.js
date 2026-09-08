/**
 * Tauri v2+ invoke bridge
 * This module exposes Tauri's invoke and convertFileSrc functions globally
 * so they can be used by the rest of the app which uses regular scripts.
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core';

// Expose to window so regular scripts can use them
window.__TAURI_INVOKE__ = invoke;
window.__TAURI_CONVERT_FILE_SRC__ = convertFileSrc;

console.log('[tauri-invoke] Tauri API exposed globally');
