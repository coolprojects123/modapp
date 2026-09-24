//! System command: the one bridge every mod's backend.lua calls through.
//! Everything a mod is allowed to do natively is a host function installed
//! here, gated by that mod's own declared permissions -- settings, mod
//! toggling, shell access, filesystem access, notifications are ALL just
//! permissions now, none of them get their own dedicated command.

use crate::lua_env::build_lua_env;
use crate::paths::mods_dir;
use crate::permissions::{mod_enabled, mod_permissions};
use serde_json::{Map, Value};
use std::fs;
use tauri::AppHandle;

/// Host functions installed by build_lua_env. They exist so a mod's own
/// backend.lua can call them; they must never be invoked directly as the
/// entry point, or any caller could reach e.g. run_shell without going
/// through the mod's logic.
pub(crate) const HOST_FUNCTIONS: &[&str] = &[
    "ensure_dir",
    "settings_read",
    "settings_write",
    "mods_toggle",
    "run_shell",
    "notify",
];

// Async + spawn_blocking: sync commands run on the main thread, so a slow
// backend script (or a shell command up to its timeout) would freeze the UI.
#[tauri::command]
pub async fn call_mod_backend(
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

pub(crate) fn call_mod_backend_blocking(
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

pub(crate) fn lua_value_to_json(value: mlua::Value, depth: usize) -> Result<Value, String> {
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