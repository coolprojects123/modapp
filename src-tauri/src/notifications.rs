//! System command: OS notifications. A global capability -- any mod can
//! request it via the `notifications.send` permission, same as webview.access
//! or shell.run. Not calendar-specific; the calendar mod is just the first
//! caller.

use crate::permissions::require_permission;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

const PERMISSION: &str = "notifications.send";

// Simple per-mod rate limit so a buggy or hostile mod can't spam OS
// notifications. Resets are per-process (in-memory), which is fine -- the
// worst case on restart is one extra burst.
const MAX_PER_MOD_PER_MINUTE: u32 = 10;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) struct NotificationRateState(Mutex<HashMap<String, Vec<Instant>>>);

impl Default for NotificationRateState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

fn rate_limited(state: &NotificationRateState, mod_id: &str) -> bool {
    let mut map = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    let entry = map.entry(mod_id.to_string()).or_default();
    entry.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
    if entry.len() as u32 >= MAX_PER_MOD_PER_MINUTE {
        return true;
    }
    entry.push(now);
    false
}

#[tauri::command]
pub fn send_notification(
    app: AppHandle,
    mod_id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    notify_from_backend(&app, &mod_id, title, body)
}

/// Shared by the `send_notification` Tauri command (frontend JS callers) and
/// the `notify` Lua host function (backend.lua callers) -- one path, one set
/// of checks, so a mod can't get a looser notification (no rate limit, no
/// length cap) by going through Lua instead of JS.
pub(crate) fn notify_from_backend(
    app: &AppHandle,
    mod_id: &str,
    title: String,
    body: String,
) -> Result<(), String> {
    require_permission(app, mod_id, PERMISSION)?;

    if title.trim().is_empty() {
        return Err("notification title must not be empty".into());
    }
    // Generous but bounded -- this is a desktop toast, not a document.
    const MAX_LEN: usize = 500;
    if title.chars().count() > MAX_LEN || body.chars().count() > MAX_LEN {
        return Err("notification title/body is too long".into());
    }

    let state = app.state::<NotificationRateState>();
    if rate_limited(&state, mod_id) {
        return Err(format!(
            "mod '{mod_id}' is sending notifications too fast (max {MAX_PER_MOD_PER_MINUTE}/min)"
        ));
    }

    // Title/body are shown verbatim -- they're the mod's own text, not a
    // spoofable "from" field, since mod_id (checked above) is what actually
    // gates whether this call was allowed at all.
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}