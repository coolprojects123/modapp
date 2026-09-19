// All app logic (commands, run(), setup) lives in lib.rs,
// compiled as the `modapp_lib` library crate -- this split is what lets
// mobile targets call modapp_lib::run() from their own platform entry point
// instead of a traditional main().
use mlua::Lua;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
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

/// Mod ids and webview instance names end up in directory names and webview
/// labels, and they arrive from JS, so they're restricted to a conservative
/// charset: no dots, no separators, nothing that can climb out of a folder.
fn validate_id(kind: &str, value: &str) -> Result<(), String> {
    let ok = !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(format!("invalid {kind}"))
    }
}

/// Turns a caller-supplied path into a clean relative path. Only plain names
/// (and `.`) are accepted -- no `..`, no root, no Windows drive prefixes.
fn sanitize_relative(path: &str) -> Result<PathBuf, String> {
    if path.contains('\0') {
        return Err("invalid path".into());
    }
    let mut clean = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => {
                // ':' in a Windows path component means a drive or an NTFS
                // alternate data stream.
                if cfg!(windows) && part.to_string_lossy().contains(':') {
                    return Err("invalid path".into());
                }
                clean.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir => return Err("path traversal is not allowed".into()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("path must be relative".into())
            }
        }
    }
    Ok(clean)
}

/// Rejects targets that resolve outside `base` once symlinks are followed.
/// Checks the nearest existing ancestor, so it also covers paths that don't
/// exist yet (about to be created).
fn ensure_within(base: &Path, target: &Path) -> Result<(), String> {
    // If the base doesn't exist yet, nothing inside it can be a symlink.
    let Ok(base) = base.canonicalize() else {
        return Ok(());
    };
    let mut probe = target;
    loop {
        match probe.canonicalize() {
            Ok(resolved) => {
                return if resolved.starts_with(&base) {
                    Ok(())
                } else {
                    Err("path escapes the mod data directory".into())
                };
            }
            Err(_) => {
                // Exists but can't be resolved = a dangling symlink, which
                // a write would happily follow to wherever it points.
                if probe.symlink_metadata().is_ok() {
                    return Err("path contains a broken symlink".into());
                }
                match probe.parent() {
                    Some(parent) => probe = parent,
                    None => return Err("invalid path".into()),
                }
            }
        }
    }
}

const MAX_READ_BYTES: u64 = 256 * 1024 * 1024;

fn check_readable_size(path: &Path) -> Result<(), String> {
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
const MOD_DATA_QUOTA_BYTES: u64 = 4 * 1024 * 1024 * 1024;

fn dir_size(path: &Path) -> u64 {
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
fn check_quota(base: &Path, target: &Path, incoming: u64) -> Result<(), String> {
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

/// Per-mod, sandboxed data directory. Lua backends can only ever write here
/// (via ensure_dir), never to arbitrary paths.
fn mod_data_dir(app: &AppHandle, mod_id: &str) -> Result<PathBuf, String> {
    validate_id("mod id", mod_id)?;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("mod-data").join(mod_id))
        .map_err(|error| error.to_string())
}

fn system_data_path(app: &AppHandle, mod_id: &str, path: &str) -> Result<PathBuf, String> {
    let relative = sanitize_relative(path)?;
    let base = mod_data_dir(app, mod_id)?;
    let full = base.join(relative);
    ensure_within(&base, &full)?;
    Ok(full)
}

/// Permission check only. Used where a disabled mod must still be able to
/// clean up after itself (closing / hiding / resizing its webviews).
fn require_permission_any_state(
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
fn require_permission(app: &AppHandle, mod_id: &str, permission: &str) -> Result<(), String> {
    require_permission_any_state(app, mod_id, permission)?;
    if !mod_enabled(app, mod_id)? {
        return Err(format!("mod '{mod_id}' is disabled"));
    }
    Ok(())
}

#[tauri::command]
fn system_ensure_dir(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    require_permission(&app, &mod_id, "fs.ensure_dir")?;
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
    validate_id("mod id", mod_id)?;
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
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default())
}

fn mod_enabled(app: &AppHandle, mod_id: &str) -> Result<bool, String> {
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

// ---------------------------------------------------------------------
// System command: mod discovery. Has to be native -- the frontend needs
// this list before any mod's own JS/backend can be loaded at all.
// ---------------------------------------------------------------------

#[tauri::command]
fn list_mods(app: AppHandle) -> Result<Vec<Value>, String> {
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

#[tauri::command]
fn system_read_file(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    require_permission(&app, &mod_id, "fs.read")?;
    let file = system_data_path(&app, &mod_id, &path)?;
    check_readable_size(&file)?;
    fs::read_to_string(file).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_write_file(
    app: AppHandle,
    mod_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    require_permission(&app, &mod_id, "fs.write")?;
    let file = system_data_path(&app, &mod_id, &path)?;
    check_quota(&mod_data_dir(&app, &mod_id)?, &file, content.len() as u64)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(file, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_read_dir(app: AppHandle, mod_id: String, path: String) -> Result<Vec<String>, String> {
    require_permission(&app, &mod_id, "fs.read_dir")?;
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
    require_permission(&app, &mod_id, "fs.read")?;
    Ok(system_data_path(&app, &mod_id, &path)?.exists())
}

#[tauri::command]
fn system_resolve_path(app: AppHandle, mod_id: String, path: String) -> Result<String, String> {
    require_permission(&app, &mod_id, "fs.read")?;
    Ok(system_data_path(&app, &mod_id, &path)?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn system_remove_file(app: AppHandle, mod_id: String, path: String) -> Result<(), String> {
    require_permission(&app, &mod_id, "fs.remove")?;
    fs::remove_file(system_data_path(&app, &mod_id, &path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_remove_dir(app: AppHandle, mod_id: String, path: String) -> Result<(), String> {
    require_permission(&app, &mod_id, "fs.remove")?;
    fs::remove_dir_all(system_data_path(&app, &mod_id, &path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_read_bytes(app: AppHandle, mod_id: String, path: String) -> Result<Vec<u8>, String> {
    require_permission(&app, &mod_id, "fs.read")?;
    let file = system_data_path(&app, &mod_id, &path)?;
    check_readable_size(&file)?;
    fs::read(file).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_write_bytes(
    app: AppHandle,
    mod_id: String,
    path: String,
    content: Vec<u8>,
) -> Result<(), String> {
    require_permission(&app, &mod_id, "fs.write")?;
    let file = system_data_path(&app, &mod_id, &path)?;
    check_quota(&mod_data_dir(&app, &mod_id)?, &file, content.len() as u64)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(file, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn system_move(app: AppHandle, mod_id: String, from: String, to: String) -> Result<(), String> {
    require_permission(&app, &mod_id, "fs.move")?;
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

const SHELL_TIMEOUT: Duration = Duration::from_secs(30);
const SHELL_OUTPUT_CAP: usize = 1024 * 1024;
const SHELL_MAX_COMMAND_BYTES: usize = 64 * 1024;

type SharedBuf = Arc<Mutex<Vec<u8>>>;

/// Drains a child's pipe on a background thread, keeping at most
/// SHELL_OUTPUT_CAP bytes. It keeps reading (and discarding) past the cap so
/// the child never blocks on a full pipe.
fn drain_capped<R: Read + Send + 'static>(mut reader: R) -> (SharedBuf, std::thread::JoinHandle<()>) {
    let buffer: SharedBuf = Arc::new(Mutex::new(Vec::new()));
    let shared = Arc::clone(&buffer);
    let handle = std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut kept = shared.lock().unwrap_or_else(|e| e.into_inner());
                    let room = SHELL_OUTPUT_CAP.saturating_sub(kept.len());
                    kept.extend_from_slice(&chunk[..n.min(room)]);
                }
            }
        }
    });
    (buffer, handle)
}

/// Runs a command via the platform shell (no login shell) with a hard
/// timeout. Returns (exit code, stdout, stderr, timed_out).
///
/// Only the shell process is killed on timeout, not its whole process tree,
/// and captured output is snapshotted after a short grace period instead of
/// joined -- a backgrounded grandchild holding the pipe open can't hang us.
fn run_shell_command(
    command: &str,
    cwd: &Path,
) -> std::io::Result<(i32, Vec<u8>, Vec<u8>, bool)> {
    let mut shell = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("bash");
        c.arg("-c").arg(command);
        c
    };
    let mut child = shell
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let (out_buf, out_thread) = drain_capped(child.stdout.take().expect("piped stdout"));
    let (err_buf, err_thread) = drain_capped(child.stderr.take().expect("piped stderr"));

    let deadline = Instant::now() + SHELL_TIMEOUT;
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            break child.wait()?;
        }
        std::thread::sleep(Duration::from_millis(25));
    };

    let grace = Instant::now() + Duration::from_millis(500);
    while !(out_thread.is_finished() && err_thread.is_finished()) && Instant::now() < grace {
        std::thread::sleep(Duration::from_millis(10));
    }
    let stdout = out_buf.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let stderr = err_buf.lock().unwrap_or_else(|e| e.into_inner()).clone();
    Ok((status.code().unwrap_or(1), stdout, stderr, timed_out))
}

/// Lua resource limits. The hook fires every LUA_HOOK_INTERVAL VM
/// instructions; LUA_MAX_HOOK_CALLS of them is roughly 400M instructions,
/// which stops an accidental infinite loop within a few seconds. (A script
/// that wraps its loop in pcall can still swallow the error -- this guards
/// against bugs, not a hostile mod.) Time spent inside host functions such
/// as run_shell doesn't count against the budget.
const LUA_MEMORY_LIMIT_BYTES: usize = 64 * 1024 * 1024;
const LUA_HOOK_INTERVAL: u32 = 10_000;
const LUA_MAX_HOOK_CALLS: u64 = 40_000;

fn build_lua_env(
    app: &AppHandle,
    mod_id: &str,
    permissions: &HashSet<String>,
) -> Result<Lua, String> {
    // Empty stdlib: no io/os/package/debug baked in. A script can only ever
    // reach what's explicitly installed below.
    let lua = Lua::new_with(mlua::StdLib::NONE, mlua::LuaOptions::default())
        .map_err(|error| error.to_string())?;

    if let Err(error) = lua.set_memory_limit(LUA_MEMORY_LIMIT_BYTES) {
        eprintln!("[mods] could not set Lua memory limit: {error}");
    }
    let hook_calls = Arc::new(AtomicU64::new(0));
    lua.set_hook(
        mlua::HookTriggers {
            every_nth_instruction: Some(LUA_HOOK_INTERVAL),
            ..Default::default()
        },
        move |_lua, _debug| {
            if hook_calls.fetch_add(1, Ordering::Relaxed) >= LUA_MAX_HOOK_CALLS {
                return Err(mlua::Error::RuntimeError(
                    "script exceeded its instruction budget".into(),
                ));
            }
            Ok(())
        },
    );

    // Scoped so `globals` (which borrows `lua`) is dropped before we move
    // `lua` out in the Ok(lua) below.
    {
        let globals = lua.globals();

        // StdLib::NONE still leaves the base library, and dofile/loadfile in
        // it read arbitrary files off disk. Remove anything that touches the
        // filesystem or module loader (setting a missing global is harmless).
        for name in ["dofile", "loadfile", "require"] {
            globals
                .set(name, mlua::Value::Nil)
                .map_err(|error| error.to_string())?;
        }

        // ---- fs.ensure_dir: per-mod sandboxed data directory ----
        if permissions.contains("fs.ensure_dir") {
            let data_dir = mod_data_dir(app, mod_id)?;
            let f = lua
                .create_function(move |_, subpath: String| {
                    // A bare contains("..") check isn't enough: joining an
                    // absolute path REPLACES the base, escaping the sandbox.
                    let relative =
                        sanitize_relative(&subpath).map_err(mlua::Error::RuntimeError)?;
                    let dir = data_dir.join(relative);
                    ensure_within(&data_dir, &dir).map_err(mlua::Error::RuntimeError)?;
                    std::fs::create_dir_all(&dir).map_err(mlua::Error::external)?;
                    Ok(dir.to_string_lossy().to_string())
                })
                .map_err(|error| error.to_string())?;
            globals
                .set("ensure_dir", f)
                .map_err(|error| error.to_string())?;
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
            globals
                .set("settings_read", f)
                .map_err(|error| error.to_string())?;
        }

        if permissions.contains("settings.write") {
            let directory = mods_dir(app)?;
            let f = lua
                .create_function(move |_, changes_json: String| {
                    let changes: Value =
                        serde_json::from_str(&changes_json).map_err(mlua::Error::external)?;
                    let mut settings: Value =
                        serde_json::from_str(DEFAULT_SETTINGS).map_err(mlua::Error::external)?;
                    if let Value::Object(saved) =
                        read_json(&directory.join(".settings.json"), Value::Object(Map::new()))
                    {
                        settings.as_object_mut().unwrap().extend(saved);
                    }
                    if let (Some(current), Some(changes)) =
                        (settings.as_object_mut(), changes.as_object())
                    {
                        current.extend(changes.clone());
                    }
                    write_json(&directory.join(".settings.json"), &settings)
                        .map_err(mlua::Error::external)?;
                    serde_json::to_string(&settings).map_err(mlua::Error::external)
                })
                .map_err(|error| error.to_string())?;
            globals
                .set("settings_write", f)
                .map_err(|error| error.to_string())?;
        }

        // ---- mods.toggle: flips a mod's enabled state in .config.json ----
        if permissions.contains("mods.toggle") {
            let app_handle = app.clone();

            let f = lua
                .create_function(move |_, id: String| {
                    if id == "core" {
                        return Ok(true);
                    }

                    let current =
                        mod_enabled(&app_handle, &id)
                            .map_err(mlua::Error::external)?;

                    let config_path =
                        mods_dir(&app_handle)
                            .map_err(mlua::Error::external)?
                            .join(".config.json");

                    let mut config =
                        read_json(&config_path, Value::Object(Map::new()));

                    let object = config
                        .as_object_mut()
                        .ok_or_else(|| {
                            mlua::Error::external(
                                "mod configuration must be a JSON object"
                            )
                        })?;

                    object.insert(
                        id,
                        Value::Bool(!current),
                    );

                    write_json(&config_path, &config)
                        .map_err(mlua::Error::external)?;

                    Ok(!current)
                })
                .map_err(|error| error.to_string())?;

            globals
                .set("mods_toggle", f)
                .map_err(|error| error.to_string())?;
        }

        // ---- shell.run: arbitrary command execution. Powerful -- grant it
        // only to mods that genuinely need it. Runs without a login shell,
        // with a timeout and a cap on captured output. Defaults to the
        // mod's own data directory rather than the mods folder. ----
        if permissions.contains("shell.run") {
            let data_dir = mod_data_dir(app, mod_id)?;
            let f = lua
                .create_function(move |lua, (command, cwd): (String, Option<String>)| {
                    if command.len() > SHELL_MAX_COMMAND_BYTES {
                        return Err(mlua::Error::RuntimeError("command is too long".into()));
                    }
                    std::fs::create_dir_all(&data_dir).map_err(mlua::Error::external)?;
                    let cwd = match cwd.as_deref() {
                        None | Some("") => data_dir.clone(),
                        Some(given) => {
                            let given = PathBuf::from(given);
                            if given.is_absolute() {
                                // A shell can `cd` anywhere anyway, so an
                                // absolute cwd isn't a boundary -- it only
                                // has to be a real directory.
                                given
                            } else {
                                data_dir.join(
                                    sanitize_relative(&given.to_string_lossy())
                                        .map_err(mlua::Error::RuntimeError)?,
                                )
                            }
                        }
                    };
                    if !cwd.is_dir() {
                        return Err(mlua::Error::RuntimeError(
                            "cwd is not an existing directory".into(),
                        ));
                    }
                    let (code, stdout, stderr, timed_out) =
                        run_shell_command(&command, &cwd).map_err(mlua::Error::external)?;
                    let table = lua.create_table()?;
                    table.set("code", code)?;
                    table.set("stdout", String::from_utf8_lossy(&stdout).to_string())?;
                    table.set("stderr", String::from_utf8_lossy(&stderr).to_string())?;
                    table.set("timedOut", timed_out)?;
                    Ok(table)
                })
                .map_err(|error| error.to_string())?;
            globals
                .set("run_shell", f)
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(lua)
}

// ---------------------------------------------------------------------
// Mod webviews. Every embedded native webview a mod wants (browser tabs,
// etc.) goes through here instead of the frontend touching Tauri's own
// webview commands directly -- that would bypass mod.json permissions
// entirely, the same way calling into another mod's backend.lua would.
// Owning creation here also means UA/header behavior lives in one place
// instead of being duplicated (and drifting) across every mod that wants
// a webview.
// ---------------------------------------------------------------------

/// Labels are namespaced by mod_id so one mod can never address, hide, or
/// close a webview belonging to another mod, even by guessing a label.
fn mod_webview_label(mod_id: &str, instance: &str) -> Result<String, String> {
    validate_id("mod id", mod_id)?;
    validate_id("webview instance", instance)?;
    Ok(format!("mod-webview-{mod_id}-{instance}"))
}

/// A UA that doesn't match the engine actually rendering it is a bigger
/// red flag to site-side bot detection than an honest one -- so this picks
/// the UA per the real host platform rather than hardcoding one.
fn platform_user_agent() -> &'static str {
    if cfg!(target_os = "windows") {
        // WebView2 = real Chromium.
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    } else if cfg!(target_os = "macos") {
        // WKWebView = real WebKit/Safari.
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    } else {
        // WebKitGTK.
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
}

// True embedded child webview via Window::add_child. This positions
// relative to the PARENT WINDOW'S OWN CLIENT AREA (unlike a separate
// WebviewWindow, which needs absolute screen coordinates) -- so the
// frontend's viewport rect (already relative to the page, which fills the
// window) can be used directly, no parent-offset math needed. This also
// means it automatically tracks the parent window on move/resize with no
// extra event wiring (contrast with wire_mod_webview_tracking, previously
// needed only because the separate-top-level-window approach did NOT
// track automatically).
//
// NOTE: reintroduced after initially moving away from add_child due to a
// documented history of real bugs on Windows in some Tauri/wry versions
// (z-order landing behind the parent, blank rendering, deadlocks when
// called synchronously off the main thread). If any of those resurface,
// the separate-WebviewWindow approach (see git history / previous
// revision of this function) is the fallback.
#[tauri::command]
async fn create_mod_webview(
    app: AppHandle,
    window: Window,
    mod_id: String,
    instance: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    require_permission(&app, &mod_id, "webview.access")?;
    if !mod_enabled(&app, &mod_id)? {
        return Err(format!("mod '{mod_id}' is disabled"));
    }

    let label = mod_webview_label(&mod_id, &instance)?;
    if app.get_webview(&label).is_some() {
        return Err(format!("webview '{label}' already exists — close it first"));
    }

    let parsed_url = Url::parse(&url).map_err(|error| error.to_string())?;
    // Anything but http(s) would let a mod point a webview at file://,
    // asset://, tauri:// or similar local/privileged origins.
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("only http(s) URLs can be opened in a mod webview".into());
    }
    if ![x, y, width, height].iter().all(|v| v.is_finite()) {
        return Err("webview bounds must be finite numbers".into());
    }

    // add_child must run on the main thread. Same non-blocking oneshot
    // handoff as before -- see the comment on result_rx.await below for
    // why this can't be a blocking recv().
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    let window_for_main_thread = window.clone();
    window
        .run_on_main_thread(move || {
            let builder = tauri::webview::WebviewBuilder::new(
                &label,
                WebviewUrl::External(parsed_url),
            )
            .user_agent(platform_user_agent());
            let outcome = window_for_main_thread
                .add_child(
                    builder,
                    LogicalPosition::new(x, y),
                    LogicalSize::new(width, height),
                )
                .map(|_webview| ())
                .map_err(|error| error.to_string());
            let _ = result_tx.send(outcome);
        })
        .map_err(|error| error.to_string())?;
    // Non-blocking: yields this task's thread instead of parking it, so
    // if this command happens to be running on the main thread itself,
    // the run_on_main_thread closure queued above still gets a chance to
    // execute before we resume. Blocking here (e.g. std::sync::mpsc::recv)
    // would self-deadlock in that case.
    result_rx
        .await
        .map_err(|error| error.to_string())??;

    Ok(())
}

#[tauri::command]
fn close_mod_webview(app: AppHandle, mod_id: String, instance: String) -> Result<(), String> {
    require_permission_any_state(&app, &mod_id, "webview.access")?;
    let label = mod_webview_label(&mod_id, &instance)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_mod_webview_visible(
    app: AppHandle,
    mod_id: String,
    instance: String,
    visible: bool,
) -> Result<(), String> {
    require_permission_any_state(&app, &mod_id, "webview.access")?;
    let label = mod_webview_label(&mod_id, &instance)?;
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    if visible {
        webview.show()
    } else {
        webview.hide()
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_mod_webview_bounds(
    app: AppHandle,
    mod_id: String,
    instance: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    require_permission_any_state(&app, &mod_id, "webview.access")?;
    let label = mod_webview_label(&mod_id, &instance)?;
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    // A child webview's position/size, like add_child's own arguments, are
    // relative to the parent window's client area -- no parent-offset math
    // needed here, unlike the old separate-top-level-window version.
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Host functions installed by build_lua_env. They exist so a mod's own
/// backend.lua can call them; they must never be invoked directly as the
/// entry point, or any caller could reach e.g. run_shell without going
/// through the mod's logic.
const HOST_FUNCTIONS: &[&str] = &[
    "ensure_dir",
    "settings_read",
    "settings_write",
    "mods_toggle",
    "run_shell",
];

// Async + spawn_blocking: sync commands run on the main thread, so a slow
// backend script (or a shell command up to its timeout) would freeze the UI.
#[tauri::command]
async fn call_mod_backend(
    app: AppHandle,
    mod_id: String,
    function: String,
    args: Vec<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        call_mod_backend_blocking(app, mod_id, function, args)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn call_mod_backend_blocking(
    app: AppHandle,
    mod_id: String,
    function: String,
    args: Vec<String>,
) -> Result<Value, String> {
    if HOST_FUNCTIONS.contains(&function.as_str()) {
        return Err(format!("'{function}' is a host function and can't be called directly"));
    }
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
    lua.load(&script)
        .exec()
        .map_err(|error| error.to_string())?;

    let func: mlua::Function = lua
        .globals()
        .get(function.as_str())
        .map_err(|_| format!("backend function '{function}' not found in mod '{mod_id}'"))?;

    let result: mlua::Value = func
        .call(mlua::Variadic::from_iter(args))
        .map_err(|error| error.to_string())?;

    lua_value_to_json(result, 0)
}

fn lua_value_to_json(value: mlua::Value, depth: usize) -> Result<Value, String> {
    // A self-referencing Lua table would otherwise recurse until the whole
    // process dies of a stack overflow.
    if depth > 32 {
        return Err("Lua return value is nested too deeply".into());
    }
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
                map.insert(key, lua_value_to_json(val, depth + 1)?);
            }
            Ok(Value::Object(map))
        }
        other => Err(format!("unsupported Lua return type: {other:?}")),
    }
}

// ---------------------------------------------------------------------
// System commands: updates. Explicitly a core/native feature. These two
// commands are reachable from any script in the webview (there's no per-mod
// identity to check), so the guards live here instead:
//   - updates count as configured only if tauri.conf.json has an updater
//     public key, so signature verification can never be skipped;
//   - installing needs the user's OK in a NATIVE dialog that scripts can't
//     click, so a mod can't silently trigger an install;
//   - only one install can run at a time.
// ---------------------------------------------------------------------

static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

struct InstallGuard;

impl Drop for InstallGuard {
    fn drop(&mut self) {
        UPDATE_IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

/// True only if the updater config carries a non-empty public key.
fn updater_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(Value::as_str)
        .map(|key| !key.trim().is_empty())
        .unwrap_or(false)
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<Value, String> {
    if !updater_configured(&app) {
        return Ok(serde_json::json!({ "available": false, "configured": false }));
    }
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(serde_json::json!({ "available": false }));
    };

    // `body` is release-note text from the update server: render it with
    // textContent, never innerHTML.
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
    if !updater_configured(&app) {
        return Err("updates are not configured (no updater public key)".into());
    }
    if UPDATE_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err("an update is already in progress".into());
    }
    let _guard = InstallGuard;

    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(serde_json::json!({ "installed": false, "available": false }));
    };

    let mut notes = update.body.clone().unwrap_or_default();
    if notes.chars().count() > 600 {
        notes = notes.chars().take(600).collect::<String>() + "…";
    }
    let prompt = format!(
        "Version {} is available (you have {}).\n\n{}\n\nInstall it now?",
        update.version, update.current_version, notes
    );
    let dialog_app = app.clone();
    // blocking_show parks its thread until the user answers, so it runs on
    // the blocking pool rather than an async worker.
    let confirmed = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .message(prompt)
            .title("Install update?")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install".into(),
                "Cancel".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|error| error.to_string())?;

    if !confirmed {
        return Ok(serde_json::json!({
            "installed": false,
            "available": true,
            "declined": true,
        }));
    }

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let target = mods_dir(app.handle()).map_err(std::io::Error::other)?;
            let bundled = app
                .path()
                .resource_dir()
                .map_err(std::io::Error::other)?
                .join("mods");
            // The source-tree fallback is dev-only: in a release build it would
            // bake the build machine's path in and load mods from there.
            let bundled = if bundled.exists() || !cfg!(debug_assertions) {
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
            create_mod_webview,
            close_mod_webview,
            set_mod_webview_visible,
            set_mod_webview_bounds,
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