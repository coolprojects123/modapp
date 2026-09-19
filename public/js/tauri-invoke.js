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
	// Read-only, non-configurable: other scripts can't replace the bridge
	// with a wrapper that logs or rewrites calls.
	Object.defineProperty(window, '__TAURI_INVOKE__', {
		value: tauriCore.invoke.bind(tauriCore),
		writable: false,
		configurable: false,
	});
	Object.defineProperty(window, '__TAURI_CONVERT_FILE_SRC__', {
		value: tauriCore?.convertFileSrc
			? tauriCore.convertFileSrc.bind(tauriCore)
			: convertFileSrc,
		writable: false,
		configurable: false,
	});
}

console.log('[tauri-invoke] Tauri API exposed globally');