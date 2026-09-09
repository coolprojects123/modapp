// THIS IS THE PRODUCTION BUILD ENTRY POINT. All app logic (commands, run(), setup) lives in lib.rs,
// compiled as the `modapp_lib` library crate -- this split is what lets
// mobile targets call modapp_lib::run() from their own platform entry point
// instead of a traditional main().
use mlua::Lua;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

const DEFAULT_SETTINGS: &str = r##"{
  "siteTitle": "modapp",
    "siteIcon": "M",
  "tagline": "a modular desktop app",
  "defaultTab": "home",
  "accentColor": "#3b82f6",
  "reduceMotion": false
}"##;

// ---------------------------------------------------------------------
// Filesystem helpers. Not commands -- only reachable from within lib.rs,
// used to build the sandboxes and to run the two commands that must
// exist natively (mod discovery, updates).
// ---------------------------------------------------------------------

fn mods_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("mods"))
        .map_err(|error| error.to_string())
}

/// Per-mod, sandboxed data directory. Lua backends can only ever write here
/// (via ensure_dir), never to arbitrary paths.
fn mod_data_dir(app: &AppHandle, mod_id: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("mod-data").join(mod_id))
        .map_err(|error| error.to_string())
}

fn system_data_path(app: &AppHandle, mod_id: &str, path: &str) -> Result<PathBuf, String> {
    if mod_id.is_empty() || mod_id == "." || mod_id == ".." || mod_id.contains('/') || mod_id.contains('\\') {
        return Err("invalid mod id".into());
    }
    if Path::new(path).is_absolute() {
        return Err("path must be relative".into());
    }
    let relative = Path::new(path);
    if relative.components().any(|component| {
        matches!(component, std::path::Component::ParentDir)
    }) {
        return Err("path traversal is not allowed".into());
    }
    Ok(mod_data_dir(app, mod_id)?.join(relative))
}

fn require_fs_permission(app: &AppHandle, mod_id: &str, permission: &str) -> Result<(), String> {
    if !mod_permissions(app, mod_id)?.contains(permission) {
        return Err(format!("mod '{mod_id}' lacks permission '{permission}'"));
    }
    Ok(())
}

#[tauri::command]
fn system_ensure_dir(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    require_fs_permission(&app, &mod_id, "fs.ensure_dir")?;
    let directory = system_data_path(&app, &mod_id, &path)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.to_string_lossy().to_string())
}

fn copy_dir(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir(&source_path, &target_path)?;
        } else {
            fs::copy(source_path, target_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn read_json(path: &Path, fallback: Value) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(fallback)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    fs::write(
        path,
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

/// Reads a mod's own mod.json fresh (no cache) -- permissions and enabled
/// state are always read at call time, so toggling a mod off (done inside
/// Core's own Lua backend now) takes effect immediately with no in-memory
/// table to keep in sync.
fn mod_manifest(app: &AppHandle, mod_id: &str) -> Result<Value, String> {
    let manifest_path = mods_dir(app)?.join(mod_id).join("mod.json");
    if !manifest_path.exists() {
        return Err(format!("unknown mod: {mod_id}"));
    }
    Ok(read_json(&manifest_path, Value::Null))
}

fn mod_permissions(app: &AppHandle, mod_id: &str) -> Result<HashSet<String>, String> {
    let manifest = mod_manifest(app, mod_id)?;
    Ok(manifest
        .get("permissions")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default())
}

fn mod_enabled(app: &AppHandle, mod_id: &str) -> Result<bool, String> {
    if mod_id == "core" {
        return Ok(true);
    }
    let manifest = mod_manifest(app, mod_id)?;
    let config = read_json(&mods_dir(app)?.join(".config.json"), Value::Object(Map::new()));
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

// ---------------------------------------------------------------------
// System command: mod discovery. Has to be native -- the frontend needs
// this list before any mod's own JS/backend can be loaded at all.
// ---------------------------------------------------------------------

#[tauri::command]
fn list_mods(app: AppHandle) -> Result<Vec<Value>, String> {
    let directory = mods_dir(&app)?;
    let config = read_json(&directory.join(".config.json"), Value::Object(Map::new()));
    let config = config.as_object().cloned().unwrap_or_default();
    let mut mods = Vec::new();

    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let manifest_path = entry.path().join("mod.json");
        if !manifest_path.exists() {
            continue;
        }
        let mut manifest = read_json(&manifest_path, Value::Null);
        let Some(object) = manifest.as_object_mut() else {
            continue;
        };
        let core = id == "core";
        let enabled = if core {
            true
        } else {
            config.get(&id).and_then(Value::as_bool).unwrap_or_else(|| {
                object
                    .get("enabledByDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(true)
            })
        };
        object.insert("id".into(), Value::String(id.clone()));
        object.insert("core".into(), Value::Bool(core));
        object.insert("enabled".into(), Value::Bool(enabled));
        object.insert(
            "assetBase".into(),
            Value::String(entry.path().to_string_lossy().to_string()),
        );
        mods.push(manifest);
    }

    Ok(mods)
}

#[tauri::command]
fn system_read_file(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    require_fs_permission(&app, &mod_id, "fs.read")?;
    fs::read_to_string(system_data_path(&app, &mod_id, &path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_write_file(app: AppHandle, mod_id: String, path: String, content: String) -> Result<(), String> {
    require_fs_permission(&app, &mod_id, "fs.write")?;
    let file = system_data_path(&app, &mod_id, &path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(file, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_read_dir(app: AppHandle, mod_id: String, path: String) -> Result<Vec<String>, String> {
    require_fs_permission(&app, &mod_id, "fs.read_dir")?;
    let directory = system_data_path(&app, &mod_id, &path)?;
    fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .map_err(|error| error.to_string())
        })
        .collect()
}

#[tauri::command]
fn system_path_exists(app: AppHandle, mod_id: String, path: String) -> Result<bool, String> {
    require_fs_permission(&app, &mod_id, "fs.read")?;
    Ok(system_data_path(&app, &mod_id, &path)?.exists())
}

#[tauri::command]
fn system_resolve_path(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    require_fs_permission(&app, &mod_id, "fs.read")?;
    Ok(system_data_path(&app, &mod_id, &path)?.to_string_lossy().to_string())
}

#[tauri::command]
fn system_remove_file(app: AppHandle, mod_id: String, path: String) -> Result<(), String> {
    require_fs_permission(&app, &mod_id, "fs.remove")?;
    fs::remove_file(system_data_path(&app, &mod_id, &path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_remove_dir(app: AppHandle, mod_id: String, path: String) -> Result<(), String> {
    require_fs_permission(&app, &mod_id, "fs.remove")?;
    fs::remove_dir_all(system_data_path(&app, &mod_id, &path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_read_bytes(app: AppHandle, mod_id: String, path: String) -> Result<Vec<u8>, String> {
    require_fs_permission(&app, &mod_id, "fs.read")?;
    fs::read(system_data_path(&app, &mod_id, &path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_write_bytes(app: AppHandle, mod_id: String, path: String, content: Vec<u8>) -> Result<(), String> {
    require_fs_permission(&app, &mod_id, "fs.write")?;
    let file = system_data_path(&app, &mod_id, &path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(file, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_move(app: AppHandle, mod_id: String, from: String, to: String) -> Result<(), String> {
    require_fs_permission(&app, &mod_id, "fs.move")?;
    let source = system_data_path(&app, &mod_id, &from)?;
    let destination = system_data_path(&app, &mod_id, &to)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(source, destination).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------
// System command: the one bridge every mod's backend.lua calls through.
// Everything a mod is allowed to do natively is a host function installed
// here, gated by that mod's own declared permissions -- settings, mod
// toggling, shell access, filesystem access are ALL just permissions now,
// none of them get their own dedicated command.
// ---------------------------------------------------------------------

fn build_lua_env(app: &AppHandle, mod_id: &str, permissions: &HashSet<String>) -> Result<Lua, String> {
    // Empty stdlib: no io/os/package/debug baked in. A script can only ever
    // reach what's explicitly installed below.
    let lua = Lua::new_with(mlua::StdLib::NONE, mlua::LuaOptions::default())
        .map_err(|error| error.to_string())?;

    // Scoped so `globals` (which borrows `lua`) is dropped before we move
    // `lua` out in the Ok(lua) below.
    {
        let globals = lua.globals();

        // ---- fs.ensure_dir: per-mod sandboxed data directory ----
        if permissions.contains("fs.ensure_dir") {
            let data_dir = mod_data_dir(app, mod_id)?;
            let f = lua
                .create_function(move |_, subpath: String| {
                    if subpath.contains("..") {
                        return Err(mlua::Error::RuntimeError("invalid subpath".into()));
                    }
                    let dir = data_dir.join(&subpath);
                    std::fs::create_dir_all(&dir).map_err(mlua::Error::external)?;
                    Ok(dir.to_string_lossy().to_string())
                })
                .map_err(|error| error.to_string())?;
            globals.set("ensure_dir", f).map_err(|error| error.to_string())?;
        }

        // ---- settings.read / settings.write: app-wide settings, Core-only in practice ----
        if permissions.contains("settings.read") {
            let directory = mods_dir(app)?;
            let f = lua
                .create_function(move |_, ()| {
                    let mut settings: Value =
                        serde_json::from_str(DEFAULT_SETTINGS).map_err(mlua::Error::external)?;
                    if let Value::Object(saved) =
                        read_json(&directory.join(".settings.json"), Value::Object(Map::new()))
                    {
                        settings.as_object_mut().unwrap().extend(saved);
                    }
                    serde_json::to_string(&settings).map_err(mlua::Error::external)
                })
                .map_err(|error| error.to_string())?;
            globals.set("settings_read", f).map_err(|error| error.to_string())?;
        }

        if permissions.contains("settings.write") {
            let directory = mods_dir(app)?;
            let f = lua
                .create_function(move |_, changes_json: String| {
                    let changes: Value = serde_json::from_str(&changes_json).map_err(mlua::Error::external)?;
                    let mut settings: Value =
                        serde_json::from_str(DEFAULT_SETTINGS).map_err(mlua::Error::external)?;
                    if let Value::Object(saved) =
                        read_json(&directory.join(".settings.json"), Value::Object(Map::new()))
                    {
                        settings.as_object_mut().unwrap().extend(saved);
                    }
                    if let (Some(current), Some(changes)) = (settings.as_object_mut(), changes.as_object()) {
                        current.extend(changes.clone());
                    }
                    write_json(&directory.join(".settings.json"), &settings).map_err(mlua::Error::external)?;
                    serde_json::to_string(&settings).map_err(mlua::Error::external)
                })
                .map_err(|error| error.to_string())?;
            globals.set("settings_write", f).map_err(|error| error.to_string())?;
        }

        // ---- mods.toggle: flips a mod's enabled state in .config.json ----
        if permissions.contains("mods.toggle") {
            let directory = mods_dir(app)?;
            let app_handle = app.clone();
            let f = lua
                .create_function(move |_, id: String| {
                    if id == "core" {
                        return Ok(true);
                    }
                    let current = mod_enabled(&app_handle, &id).map_err(mlua::Error::external)?;
                    let config_path = directory.join(".config.json");
                    let mut config = read_json(&config_path, Value::Object(Map::new()));
                    config
                        .as_object_mut()
                        .unwrap()
                        .insert(id, Value::Bool(!current));
                    write_json(&config_path, &config).map_err(mlua::Error::external)?;
                    Ok(!current)
                })
                .map_err(|error| error.to_string())?;
            globals.set("mods_toggle", f).map_err(|error| error.to_string())?;
        }

        // ---- shell.run: arbitrary command execution. Powerful -- only ever
        // grant this to a mod whose entire purpose requires it (e.g. a terminal). ----
        if permissions.contains("shell.run") {
            let default_cwd = mods_dir(app)?;
            let f = lua
                .create_function(move |lua, (command, cwd): (String, Option<String>)| {
                    let output = std::process::Command::new("/usr/bin/bash")
                        .arg("-lc")
                        .arg(&command)
                        .current_dir(cwd.map(PathBuf::from).unwrap_or_else(|| default_cwd.clone()))
                        .output()
                        .map_err(mlua::Error::external)?;
                    let table = lua.create_table()?;
                    table.set("code", output.status.code().unwrap_or(1))?;
                    table.set("stdout", String::from_utf8_lossy(&output.stdout).to_string())?;
                    table.set("stderr", String::from_utf8_lossy(&output.stderr).to_string())?;
                    Ok(table)
                })
                .map_err(|error| error.to_string())?;
            globals.set("run_shell", f).map_err(|error| error.to_string())?;
        }
    }

    Ok(lua)
}

#[tauri::command]
fn call_mod_backend(
    app: AppHandle,
    mod_id: String,
    function: String,
    args: Vec<String>,
) -> Result<Value, String> {
    if !mod_enabled(&app, &mod_id)? {
        return Err(format!("mod '{mod_id}' is disabled"));
    }

    let permissions = mod_permissions(&app, &mod_id)?;

    let script_path = mods_dir(&app)?.join(&mod_id).join("backend.lua");
    if !script_path.exists() {
        return Err(format!("mod '{mod_id}' has no backend.lua"));
    }
    let script = fs::read_to_string(&script_path).map_err(|error| error.to_string())?;

    let lua = build_lua_env(&app, &mod_id, &permissions)?;
    lua.load(&script).exec().map_err(|error| error.to_string())?;

    let func: mlua::Function = lua
        .globals()
        .get(function.as_str())
        .map_err(|_| format!("backend function '{function}' not found in mod '{mod_id}'"))?;

    let result: mlua::Value = func
        .call(mlua::Variadic::from_iter(args))
        .map_err(|error| error.to_string())?;

    lua_value_to_json(result)
}

fn lua_value_to_json(value: mlua::Value) -> Result<Value, String> {
    match value {
        mlua::Value::Nil => Ok(Value::Null),
        mlua::Value::Boolean(b) => Ok(Value::Bool(b)),
        mlua::Value::Integer(i) => Ok(Value::from(i)),
        mlua::Value::Number(n) => Ok(Value::from(n)),
        mlua::Value::String(s) => Ok(Value::String(
            s.to_str().map_err(|error| error.to_string())?.to_string(),
        )),
        mlua::Value::Table(table) => {
            let mut map = Map::new();
            for pair in table.pairs::<String, mlua::Value>() {
                let (key, val) = pair.map_err(|error| error.to_string())?;
                map.insert(key, lua_value_to_json(val)?);
            }
            Ok(Value::Object(map))
        }
        other => Err(format!("unsupported Lua return type: {other:?}")),
    }
}

// ---------------------------------------------------------------------
// System commands: updates. Explicitly a core/native feature -- not a
// permission any mod can be granted, since it drives the app itself.
// ---------------------------------------------------------------------

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<Value, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(serde_json::json!({ "available": false }));
    };

    Ok(serde_json::json!({
        "available": true,
        "version": update.version,
        "currentVersion": update.current_version,
        "body": update.body,
        "date": update.date.map(|date| date.to_string()),
    }))
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<Value, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(serde_json::json!({ "installed": false, "available": false }));
    };

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "installed": true,
        "available": true,
        "version": update.version,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let target = mods_dir(app.handle()).map_err(std::io::Error::other)?;
            let bundled = app
                .path()
                .resource_dir()
                .map_err(std::io::Error::other)?
                .join("mods");
            let bundled = if bundled.exists() {
                bundled
            } else {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("mods")
            };
            if bundled.exists() {
                copy_dir(&bundled, &target).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_mods,
            call_mod_backend,
            system_ensure_dir,
            system_read_file,
            system_write_file,
            system_read_dir,
            system_path_exists,
            system_resolve_path,
            system_remove_file,
            system_remove_dir,
            system_read_bytes,
            system_write_bytes,
            system_move,
            check_for_updates,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running modapp");
}