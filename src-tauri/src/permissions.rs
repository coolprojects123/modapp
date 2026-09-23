//! Per-mod manifests, enabled state, and the permission checks every
//! capability (fs, webview, shell, pty, ...) goes through. Everything is read
//! fresh from disk at call time, so there is no cache to keep in sync.

use crate::paths::{mods_dir, validate_id};
use crate::storage::read_json;
use serde_json::{Map, Value};
use std::collections::HashSet;
use tauri::AppHandle;

/// Permission check only. Used where a disabled mod must still be able to
/// clean up after itself (closing / hiding / resizing its webviews).
pub(crate) fn require_permission_any_state(
    app: &AppHandle,
    mod_id: &str,
    permission: &str,
) -> Result<(), String> {
    if !mod_permissions(app, mod_id)?.contains(permission) {
        return Err(format!("mod '{mod_id}' lacks permission '{permission}'"));
    }
    Ok(())
}

/// Permission check plus enabled state: a disabled mod gets no capabilities.
pub(crate) fn require_permission(app: &AppHandle, mod_id: &str, permission: &str) -> Result<(), String> {
    require_permission_any_state(app, mod_id, permission)?;
    if !mod_enabled(app, mod_id)? {
        return Err(format!("mod '{mod_id}' is disabled"));
    }
    Ok(())
}

/// Access check for filesystem paths. A mod's own data directory (in the app
/// data folder) is open to every enabled mod; anywhere else on the filesystem
/// needs the given `fs.*` permission.
pub(crate) fn require_fs_access(
    app: &AppHandle,
    mod_id: &str,
    permission: &str,
    own_data: bool,
) -> Result<(), String> {
    if own_data {
        if !mod_enabled(app, mod_id)? {
            return Err(format!("mod '{mod_id}' is disabled"));
        }
        Ok(())
    } else {
        require_permission(app, mod_id, permission)
    }
}

/// Reads a mod's own mod.json fresh (no cache) -- permissions and enabled
/// state are always read at call time, so toggling a mod off (done inside
/// Core's own Lua backend now) takes effect immediately with no in-memory
/// table to keep in sync.
pub(crate) fn mod_manifest(app: &AppHandle, mod_id: &str) -> Result<Value, String> {
    validate_id("mod id", mod_id)?;
    let manifest_path = mods_dir(app)?.join(mod_id).join("mod.json");
    if !manifest_path.exists() {
        return Err(format!("unknown mod: {mod_id}"));
    }
    Ok(read_json(&manifest_path, Value::Null))
}

pub(crate) fn mod_permissions(app: &AppHandle, mod_id: &str) -> Result<HashSet<String>, String> {
    let manifest = mod_manifest(app, mod_id)?;
    Ok(manifest
        .get("permissions")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default())
}

pub(crate) fn mod_enabled(app: &AppHandle, mod_id: &str) -> Result<bool, String> {
    if mod_id == "core" {
        return Ok(true);
    }
    let manifest = mod_manifest(app, mod_id)?;
    let config = read_json(
        &mods_dir(app)?.join(".config.json"),
        Value::Object(Map::new()),
    );
    Ok(config
        .get(mod_id)
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            manifest
                .get("enabledByDefault")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        }))
}