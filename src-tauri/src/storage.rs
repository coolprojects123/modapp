//! JSON persistence, directory copying, and the size/quota limits applied to
//! mod data.

use serde_json::Value;
use std::fs;
use std::path::Path;

pub(crate) fn copy_dir(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        // Symlinks are skipped: following them can copy files from outside
        // the bundle, or recurse forever on a loop.
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_dir(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(source_path, target_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn read_json(path: &Path, fallback: Value) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(fallback)
}

pub(crate) fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    fs::write(
        path,
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(crate) const MAX_READ_BYTES: u64 = 256 * 1024 * 1024;

pub(crate) fn check_readable_size(path: &Path) -> Result<(), String> {
    let len = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .len();
    if len > MAX_READ_BYTES {
        return Err(format!("file is too large to read ({len} bytes)"));
    }
    Ok(())
}

/// Per-mod cap on total bytes in its data directory. Raise it if a mod
/// (e.g. a music library) legitimately needs more.
pub(crate) const MOD_DATA_QUOTA_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub(crate) fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            total += dir_size(&entry.path());
        } else if let Ok(meta) = entry.metadata() {
            total += meta.len();
        }
    }
    total
}

/// Fails if writing `incoming` bytes to `target` would push the mod's data
/// directory over its quota. An overwritten file's old size is not counted.
pub(crate) fn check_quota(base: &Path, target: &Path, incoming: u64) -> Result<(), String> {
    let existing = fs::metadata(target).map(|meta| meta.len()).unwrap_or(0);
    let used = dir_size(base).saturating_sub(existing);
    if used.saturating_add(incoming) > MOD_DATA_QUOTA_BYTES {
        return Err(format!(
            "mod data quota of {} MiB exceeded",
            MOD_DATA_QUOTA_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}