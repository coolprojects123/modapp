// All app logic lives in the modules below; this file only wires them together.
// It is compiled as the `modapp_lib` library crate -- this split is what lets
// mobile targets call modapp_lib::run() from their own platform entry point
// instead of a traditional main().
//
//   paths        mod / data directory locations and path-safety rules
//   storage      JSON files, directory copy, size + quota limits
//   permissions  mod manifests, enabled state, permission checks
//   mods         mod discovery (list_mods)
//   fs_api       filesystem commands (fs.* permissions)
//   webview      embedded mod webviews (webview.access)
//   shell        one-shot command execution (shell.run)
//   dialog       native file / folder pickers (dialog.pick)
//   pty          interactive terminals (pty.access)
//   lua_env      sandboxed Lua host functions for backend.lua
//   backend      call_mod_backend, the bridge into backend.lua
//   updater      app updates

mod backend;
mod dialog;
mod fs_api;
mod lua_env;
mod mods;
mod paths;
mod permissions;
mod pty;
mod shell;
mod storage;
mod updater;
mod webview;

use std::path::PathBuf;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let target = paths::mods_dir(app.handle()).map_err(std::io::Error::other)?;
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
                storage::copy_dir(&bundled, &target).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mods::list_mods,
            backend::call_mod_backend,
            webview::create_mod_webview,
            webview::close_mod_webview,
            webview::set_mod_webview_visible,
            webview::set_mod_webview_bounds,
            fs_api::system_ensure_dir,
            fs_api::system_read_file,
            fs_api::system_write_file,
            fs_api::system_read_dir,
            fs_api::system_path_exists,
            fs_api::system_resolve_path,
            fs_api::system_remove_file,
            fs_api::system_remove_dir,
            fs_api::system_read_bytes,
            fs_api::system_write_bytes,
            fs_api::system_move,
            updater::check_for_updates,
            updater::install_update,
            dialog::pick_folder,
            dialog::pick_files,
            dialog::pick_save_file,
            pty::pty_list_shells,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running modapp");
}