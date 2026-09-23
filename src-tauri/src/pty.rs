// Real pseudo-terminal sessions for mods. Gated by its own `pty.access`
// permission, deliberately separate from `shell.run`: shell.run is a
// one-shot, timeout-bounded command runner; pty.access hands a mod an
// interactive shell. A mod may hold either, both, or neither.
//
// Frontend contract (see ModAPI.ide.pty in the IDE mod's api.js):
//   pty_list_shells(mod_id)                                   -> [{ id, label }]
//   pty_spawn(mod_id, session, shell_id?, cols, rows, cwd?)   -> shell label
//   pty_write(mod_id, session, data)
//   pty_resize(mod_id, session, cols, rows)
//   pty_kill(mod_id, session)
// Output arrives as events `pty_<session>_data` (string) and
// `pty_<session>_exit` (exit code). `session` is a random token chosen by the
// frontend before spawning, so listeners exist before the first byte is
// emitted and other mods sharing the webview can't guess the event names.
// Every command also checks that the session belongs to the calling mod_id.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::permissions::{require_permission, require_permission_any_state};

const PERMISSION: &str = "pty.access";
const MAX_SESSIONS_PER_MOD: usize = 16;

struct Session {
    mod_id: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

#[derive(Clone, Default)]
pub struct PtyState {
    sessions: Sessions,
}

fn lock(sessions: &Sessions) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
    sessions.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize, Clone)]
pub struct ShellInfo {
    id: String,
    label: String,
    #[serde(skip)]
    path: PathBuf,
    #[serde(skip)]
    args: Vec<String>,
}

fn shell_info(id: &str, label: &str, path: PathBuf, args: &[&str]) -> ShellInfo {
    ShellInfo {
        id: id.to_string(),
        label: label.to_string(),
        path,
        args: args.iter().map(|a| a.to_string()).collect(),
    }
}

// ---------------------------------------------------------------------
// Shell discovery. Only shells found here can be spawned -- a mod picks by
// id and never supplies an executable path.
// ---------------------------------------------------------------------

#[cfg(windows)]
fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
        .split(';')
        .map(|s| s.to_lowercase())
        .collect();
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn discover_shells() -> Vec<ShellInfo> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    let env_path = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let sysroot = env_path("SystemRoot").unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    let mut out: Vec<ShellInfo> = Vec::new();

    // PowerShell 7+ (pwsh), then Windows PowerShell 5.1.
    let pwsh = which("pwsh").or_else(|| {
        env_path("ProgramFiles")
            .map(|p| p.join("PowerShell").join("7").join("pwsh.exe"))
            .filter(|p| p.is_file())
    });
    if let Some(path) = pwsh {
        out.push(shell_info("pwsh", "PowerShell", path, &[]));
    }
    let ps5 = sysroot
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if ps5.is_file() {
        out.push(shell_info("powershell", "Windows PowerShell", ps5, &[]));
    }

    // cmd.exe
    let cmd = env_path("ComSpec")
        .filter(|p| p.is_file())
        .unwrap_or_else(|| sysroot.join("System32").join("cmd.exe"));
    out.push(shell_info("cmd", "Command Prompt", cmd, &[]));

    // WSL: one entry per installed distro (falls back to the default distro).
    let wsl = sysroot.join("System32").join("wsl.exe");
    if wsl.is_file() {
        let mut distros: Vec<String> = Vec::new();
        let listing = Command::new(&wsl)
            .args(["-l", "-q"])
            .env_remove("WSL_UTF8")
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output();
        if let Ok(output) = listing {
            if output.status.success() {
                // `wsl -l` writes UTF-16LE.
                let units: Vec<u16> = output
                    .stdout
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                for line in String::from_utf16_lossy(&units).lines() {
                    let name = line.trim().trim_start_matches('\u{feff}').trim();
                    if !name.is_empty() && !name.starts_with("docker-desktop") {
                        distros.push(name.to_string());
                    }
                }
            }
        }
        if distros.is_empty() {
            out.push(shell_info("wsl", "WSL", wsl.clone(), &[]));
        } else {
            for distro in distros {
                out.push(ShellInfo {
                    id: format!("wsl:{distro}"),
                    label: format!("WSL: {distro}"),
                    path: wsl.clone(),
                    args: vec!["-d".into(), distro],
                });
            }
        }
    }

    // Git Bash, if installed.
    let git_bash = [
        env_path("ProgramFiles"),
        env_path("ProgramFiles(x86)"),
        env_path("LOCALAPPDATA").map(|p| p.join("Programs")),
    ]
    .into_iter()
    .flatten()
    .map(|base| base.join("Git").join("bin").join("bash.exe"))
    .find(|p| p.is_file());
    if let Some(path) = git_bash {
        out.push(shell_info("gitbash", "Git Bash", path, &["--login", "-i"]));
    }

    out
}

#[cfg(not(windows))]
fn discover_shells() -> Vec<ShellInfo> {
    let mut out: Vec<ShellInfo> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let args: &[&str] = if cfg!(target_os = "macos") { &["-l"] } else { &[] };

    let mut add = |path: PathBuf, out: &mut Vec<ShellInfo>| {
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => return,
        };
        if matches!(name.as_str(), "nologin" | "false" | "git-shell") || !path.is_file() {
            return;
        }
        if !seen.insert(path.clone()) {
            return;
        }
        let id = path.to_string_lossy().to_string();
        out.push(shell_info(&id, &name, path, args));
    };

    // The user's login shell first, so it's the default.
    if let Some(shell) = std::env::var_os("SHELL") {
        add(PathBuf::from(shell), &mut out);
    }
    if let Ok(listing) = std::fs::read_to_string("/etc/shells") {
        for line in listing.lines() {
            let line = line.trim();
            if line.starts_with('/') {
                add(PathBuf::from(line), &mut out);
            }
        }
    }
    out
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

fn validate_session(session: &str) -> Result<(), String> {
    let ok = (16..=64).contains(&session.len())
        && session.chars().all(|c| c.is_ascii_alphanumeric());
    if ok {
        Ok(())
    } else {
        Err("invalid terminal session id".into())
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Emits as much of `pending` as is valid UTF-8, keeping an incomplete
/// trailing sequence for the next read so multi-byte characters never split.
fn flush_utf8(app: &AppHandle, event: &str, pending: &mut Vec<u8>) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                if !text.is_empty() {
                    let _ = app.emit(event, text);
                }
                pending.clear();
                return;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    let _ = app.emit(event, text);
                    pending.drain(..valid);
                    continue;
                }
                match error.error_len() {
                    Some(len) => {
                        let _ = app.emit(event, "\u{FFFD}");
                        pending.drain(..len);
                    }
                    None => return, // incomplete sequence; wait for more bytes
                }
            }
        }
    }
}

fn spawn_session(
    app: AppHandle,
    sessions: Sessions,
    mod_id: String,
    session: String,
    shell_id: Option<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let shells = discover_shells();
    let shell = match shell_id.as_deref() {
        Some(id) => shells.iter().find(|s| s.id == id),
        None => shells.first(),
    }
    .ok_or_else(|| "shell not found on this system".to_string())?
    .clone();

    {
        let map = lock(&sessions);
        if map.contains_key(&session) {
            return Err("terminal session already exists".into());
        }
        if map.values().filter(|s| s.mod_id == mod_id).count() >= MAX_SESSIONS_PER_MOD {
            return Err("too many open terminal sessions".into());
        }
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut command = CommandBuilder::new(&shell.path);
    for arg in &shell.args {
        command.arg(arg);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let dir = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(home_dir);
    if let Some(dir) = dir {
        command.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let master = pair.master;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    lock(&sessions).insert(
        session.clone(),
        Session {
            mod_id,
            master,
            writer,
            child,
        },
    );

    // Output pump.
    let data_event = format!("pty_{session}_data");
    let app_reader = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    flush_utf8(&app_reader, &data_event, &mut pending);
                }
            }
        }
    });

    // Exit watcher. Polled rather than relying on reader EOF, because
    // ConPTY keeps the output pipe open after the child has exited.
    let exit_event = format!("pty_{session}_exit");
    let watcher_sessions = sessions.clone();
    let watcher_key = session.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(150));
        let code = {
            let mut map = lock(&watcher_sessions);
            match map.get_mut(&watcher_key) {
                None => return, // killed explicitly
                Some(s) => match s.child.try_wait() {
                    Ok(Some(status)) => Some(status.exit_code()),
                    Ok(None) => None,
                    Err(_) => Some(1),
                },
            }
        };
        if let Some(code) = code {
            // Let the reader deliver the final bytes before tearing down.
            std::thread::sleep(Duration::from_millis(200));
            let removed = lock(&watcher_sessions).remove(&watcher_key);
            if removed.is_some() {
                drop(removed);
                let _ = app.emit(&exit_event, code);
            }
            return;
        }
    });

    Ok(shell.label)
}

#[tauri::command]
pub async fn pty_list_shells(app: AppHandle, mod_id: String) -> Result<Vec<ShellInfo>, String> {
    require_permission(&app, &mod_id, PERMISSION)?;
    tauri::async_runtime::spawn_blocking(discover_shells)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    mod_id: String,
    session: String,
    shell_id: Option<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    require_permission(&app, &mod_id, PERMISSION)?;
    validate_session(&session)?;
    let sessions = state.sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        spawn_session(app, sessions, mod_id, session, shell_id, cols, rows, cwd)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pty_write(
    app: AppHandle,
    state: State<'_, PtyState>,
    mod_id: String,
    session: String,
    data: String,
) -> Result<(), String> {
    require_permission_any_state(&app, &mod_id, PERMISSION)?;
    let sessions = state.sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut map = lock(&sessions);
        let s = map
            .get_mut(&session)
            .filter(|s| s.mod_id == mod_id)
            .ok_or_else(|| "no such terminal session".to_string())?;
        s.writer
            .write_all(data.as_bytes())
            .and_then(|_| s.writer.flush())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pty_resize(
    app: AppHandle,
    state: State<'_, PtyState>,
    mod_id: String,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    require_permission_any_state(&app, &mod_id, PERMISSION)?;
    let map = lock(&state.sessions);
    let s = map
        .get(&session)
        .filter(|s| s.mod_id == mod_id)
        .ok_or_else(|| "no such terminal session".to_string())?;
    s.master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(
    app: AppHandle,
    state: State<'_, PtyState>,
    mod_id: String,
    session: String,
) -> Result<(), String> {
    require_permission_any_state(&app, &mod_id, PERMISSION)?;
    let removed = {
        let mut map = lock(&state.sessions);
        match map.get(&session) {
            Some(s) if s.mod_id == mod_id => map.remove(&session),
            _ => None,
        }
    };
    drop(removed); // Session::drop kills the child
    Ok(())
}