/**
 * Tauri v2+ invoke bridge
 * This module exposes Tauri's invoke and convertFileSrc functions globally
 * so they can be used by the rest of the app which uses regular scripts.
 */

// This frontend is served as plain files, so package imports are not resolved
// here. Tauri exposes the v2 core API because withGlobalTauri is enabled.
const tauriCore = window.__TAURI__?.core;
const convertFileSrc = tauriCore?.convertFileSrc || ((filePath, protocol = 'asset') =>
	`${protocol}://localhost/${encodeURIComponent(filePath)}`);

if (typeof tauriCore?.invoke === 'function') {
	window.__TAURI_INVOKE__ = tauriCore.invoke.bind(tauriCore);
	window.__TAURI_CONVERT_FILE_SRC__ = tauriCore?.convertFileSrc
		? tauriCore.convertFileSrc.bind(tauriCore)
		: convertFileSrc;
}

console.log('[tauri-invoke] Tauri API exposed globally');
