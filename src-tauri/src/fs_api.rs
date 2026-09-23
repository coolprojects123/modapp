//! Filesystem API.
//!
//! - Relative paths resolve inside the calling mod's own data directory in the
//!   app data folder. Every enabled mod can use that with no permission.
//! - Absolute paths reach the whole filesystem, and need the matching `fs.*`
//!   permission (`fs.read`, `fs.write`, `fs.read_dir`, `fs.remove`, `fs.move`,
//!   `fs.ensure_dir`) unless they happen to resolve into the mod's own data
//!   directory.
//!
//! The data-directory size quota applies to writes inside the mod's own data
//! directory only.

use crate::paths::{mod_data_dir, resolve_mod_path};
use crate::permissions::require_fs_access;
use crate::storage::{check_quota, check_readable_size};
use std::fs;
use std::path::Path;
use tauri::AppHandle;

fn create_parent(path: &Path) -> Result<(), String> {
    match path.parent() {
        Some(parent) => fs::create_dir_all(parent).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn system_ensure_dir(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.ensure_dir", target.own_data)?;
    fs::create_dir_all(&target.path).map_err(|error| error.to_string())?;
    Ok(target.path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn system_read_file(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.read", target.own_data)?;
    check_readable_size(&target.path)?;
    fs::read_to_string(&target.path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn system_write_file(
    app: AppHandle,
    mod_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.write", target.own_data)?;
    if target.own_data {
        check_quota(&mod_data_dir(&app, &mod_id)?, &target.path, content.len() as u64)?;
    }
    create_parent(&target.path)?;
    fs::write(&target.path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn system_read_dir(app: AppHandle, mod_id: String, path: String) -> Result<Vec<String>, String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.read_dir", target.own_data)?;
    fs::read_dir(&target.path)
        .map_err(|error| error.to_string())?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .map_err(|error| error.to_string())
        })
        .collect()
}

#[tauri::command]
pub fn system_path_exists(app: AppHandle, mod_id: String, path: String) -> Result<bool, String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.read", target.own_data)?;
    Ok(target.path.exists())
}

#[tauri::command]
pub fn system_resolve_path(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.read", target.own_data)?;
    Ok(target.path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn system_remove_file(app: AppHandle, mod_id: String, path: String) -> Result<(), String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.remove", target.own_data)?;
    fs::remove_file(&target.path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn system_remove_dir(app: AppHandle, mod_id: String, path: String) -> Result<(), String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.remove", target.own_data)?;
    if target.path.parent().is_none() {
        return Err("refusing to remove a filesystem root".into());
    }
    fs::remove_dir_all(&target.path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn system_read_bytes(app: AppHandle, mod_id: String, path: String) -> Result<Vec<u8>, String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.read", target.own_data)?;
    check_readable_size(&target.path)?;
    fs::read(&target.path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn system_write_bytes(
    app: AppHandle,
    mod_id: String,
    path: String,
    content: Vec<u8>,
) -> Result<(), String> {
    let target = resolve_mod_path(&app, &mod_id, &path)?;
    require_fs_access(&app, &mod_id, "fs.write", target.own_data)?;
    if target.own_data {
        check_quota(&mod_data_dir(&app, &mod_id)?, &target.path, content.len() as u64)?;
    }
    create_parent(&target.path)?;
    fs::write(&target.path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn system_move(app: AppHandle, mod_id: String, from: String, to: String) -> Result<(), String> {
    let source = resolve_mod_path(&app, &mod_id, &from)?;
    let destination = resolve_mod_path(&app, &mod_id, &to)?;
    require_fs_access(
        &app,
        &mod_id,
        "fs.move",
        source.own_data && destination.own_data,
    )?;
    create_parent(&destination.path)?;
    fs::rename(&source.path, &destination.path).map_err(|error| error.to_string())
}