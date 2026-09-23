use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

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
pub(crate) fn updater_configured(app: &AppHandle) -> bool {
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
pub async fn check_for_updates(app: AppHandle) -> Result<Value, String> {
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
pub async fn install_update(app: AppHandle) -> Result<Value, String> {
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