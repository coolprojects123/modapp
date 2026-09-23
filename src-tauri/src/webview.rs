use crate::paths::validate_id;
use crate::permissions::{mod_enabled, require_permission, require_permission_any_state};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window};

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
pub(crate) fn mod_webview_label(mod_id: &str, instance: &str) -> Result<String, String> {
    validate_id("mod id", mod_id)?;
    validate_id("webview instance", instance)?;
    Ok(format!("mod-webview-{mod_id}-{instance}"))
}

/// A UA that doesn't match the engine actually rendering it is a bigger
/// red flag to site-side bot detection than an honest one -- so this picks
/// the UA per the real host platform rather than hardcoding one.
pub(crate) fn platform_user_agent() -> &'static str {
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
pub async fn create_mod_webview(
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
pub fn close_mod_webview(app: AppHandle, mod_id: String, instance: String) -> Result<(), String> {
    require_permission_any_state(&app, &mod_id, "webview.access")?;
    let label = mod_webview_label(&mod_id, &instance)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_mod_webview_visible(
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
pub fn set_mod_webview_bounds(
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