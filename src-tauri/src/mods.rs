use crate::paths::{mods_dir, validate_id};
use crate::storage::read_json;
use serde_json::{Map, Value};
use std::fs;
use tauri::AppHandle;

// ---------------------------------------------------------------------
// System command: mod discovery. Has to be native -- the frontend needs
// this list before any mod's own JS/backend can be loaded at all.
// ---------------------------------------------------------------------

#[tauri::command]
pub fn list_mods(app: AppHandle) -> Result<Vec<Value>, String> {
    let directory = mods_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let config = read_json(
        &directory.join(".config.json"),
        Value::Object(Map::new()),
    );

    let config = config
        .as_object()
        .cloned()
        .unwrap_or_default();

    let mut mods = Vec::new();

    for entry in fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
    {
        let entry = entry.map_err(|error| error.to_string())?;

        if !entry.path().is_dir() {
            continue;
        }

        let id = entry.file_name()
            .to_string_lossy()
            .to_string();

        // Folders whose names aren't valid mod ids are never surfaced, so
        // they can't be loaded or addressed through any command.
        if validate_id("mod id", &id).is_err() {
            continue;
        }

        let manifest_path = entry.path().join("mod.json");

        if !manifest_path.exists() {
            continue;
        }

        let mut manifest =
            read_json(&manifest_path, Value::Null);

        let Some(object) = manifest.as_object_mut() else {
            continue;
        };

        let core = id == "core";

        let enabled = if core {
            true
        } else {
            config
                .get(&id)
                .and_then(Value::as_bool)
                .unwrap_or_else(|| {
                    object
                        .get("enabledByDefault")
                        .and_then(Value::as_bool)
                        .unwrap_or(true)
                })
        };

        object.insert(
            "id".into(),
            Value::String(id.clone()),
        );

        object.insert(
            "core".into(),
            Value::Bool(core),
        );

        object.insert(
            "enabled".into(),
            Value::Bool(enabled),
        );

        object.insert(
            "assetBase".into(),
            Value::String(
                entry.path()
                    .to_string_lossy()
                    .to_string()
            ),
        );

        mods.push(manifest);
    }

    Ok(mods)
}