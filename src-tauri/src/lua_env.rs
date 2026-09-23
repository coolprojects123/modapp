//! The sandboxed Lua environment a mod's backend.lua runs in. Everything a mod
//! may do natively is a host function installed here, gated by that mod's own
//! declared permissions.

use crate::paths::{mod_data_dir, mods_dir, resolve_mod_path, sanitize_relative};
use crate::permissions::mod_enabled;
use crate::shell::{run_shell_command, SHELL_MAX_COMMAND_BYTES};
use crate::storage::{read_json, write_json};
use mlua::Lua;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

const DEFAULT_SETTINGS: &str = r##"{
  "siteTitle": "modapp",
    "siteIcon": "M",
  "tagline": "a modular desktop app",
  "defaultTab": "home",
  "accentColor": "#3b82f6",
  "reduceMotion": false
}"##;

/// Lua resource limits. The hook fires every LUA_HOOK_INTERVAL VM
/// instructions; LUA_MAX_HOOK_CALLS of them is roughly 400M instructions,
/// which stops an accidental infinite loop within a few seconds. (A script
/// that wraps its loop in pcall can still swallow the error -- this guards
/// against bugs, not a hostile mod.) Time spent inside host functions such
/// as run_shell doesn't count against the budget.
pub(crate) const LUA_MEMORY_LIMIT_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const LUA_HOOK_INTERVAL: u32 = 10_000;
pub(crate) const LUA_MAX_HOOK_CALLS: u64 = 40_000;

pub(crate) fn build_lua_env(
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

        // ---- ensure_dir: creates a directory and returns its full path. Relative
        // paths land in the mod's own data directory (always allowed); absolute
        // paths elsewhere on the filesystem need the fs.ensure_dir permission. ----
        {
            let app_handle = app.clone();
            let owner = mod_id.to_string();
            let outside_allowed = permissions.contains("fs.ensure_dir");
            let f = lua
                .create_function(move |_, subpath: String| {
                    let target = resolve_mod_path(&app_handle, &owner, &subpath)
                        .map_err(mlua::Error::RuntimeError)?;
                    if !target.own_data && !outside_allowed {
                        return Err(mlua::Error::RuntimeError(
                            "path is outside the mod data directory (requires fs.ensure_dir)".into(),
                        ));
                    }
                    std::fs::create_dir_all(&target.path).map_err(mlua::Error::external)?;
                    Ok(target.path.to_string_lossy().to_string())
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