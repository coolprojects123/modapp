//! Native file and folder pickers (the OS "Open" / "Save" dialogs), gated by
//! the `dialog.pick` permission. A dialog only returns the paths the user chose;
//! reading or writing them is still governed by the `fs.*` / `shell.run`
//! permissions.
//!
//! The blocking dialog calls park their thread until the user answers, so they
//! run on the blocking pool, never on the main thread.

use crate::permissions::require_permission;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

const PERMISSION: &str = "dialog.pick";

fn path_string(path: FilePath) -> Result<String, String> {
    path.into_path()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

/// Only start the dialog in a directory that exists.
fn existing_dir(dir: Option<String>) -> Option<PathBuf> {
    dir.map(PathBuf::from).filter(|p| p.is_dir())
}

#[tauri::command]
pub async fn pick_folder(
    app: AppHandle,
    mod_id: String,
    title: Option<String>,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    require_permission(&app, &mod_id, PERMISSION)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let Some(dir) = existing_dir(default_dir) {
            dialog = dialog.set_directory(dir);
        }
        dialog.blocking_pick_folder().map(path_string).transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Returns the chosen files (one, or several when `multiple` is set); an empty
/// list means the dialog was cancelled.
#[tauri::command]
pub async fn pick_files(
    app: AppHandle,
    mod_id: String,
    title: Option<String>,
    default_dir: Option<String>,
    multiple: bool,
) -> Result<Vec<String>, String> {
    require_permission(&app, &mod_id, PERMISSION)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let Some(dir) = existing_dir(default_dir) {
            dialog = dialog.set_directory(dir);
        }
        let picked = if multiple {
            dialog.blocking_pick_files().unwrap_or_default()
        } else {
            dialog.blocking_pick_file().into_iter().collect()
        };
        picked.into_iter().map(path_string).collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pick_save_file(
    app: AppHandle,
    mod_id: String,
    title: Option<String>,
    default_dir: Option<String>,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    require_permission(&app, &mod_id, PERMISSION)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let Some(dir) = existing_dir(default_dir) {
            dialog = dialog.set_directory(dir);
        }
        if let Some(name) = default_name {
            dialog = dialog.set_file_name(name);
        }
        dialog.blocking_save_file().map(path_string).transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}