//! One-shot shell command execution for the `shell.run` permission: a hard
//! timeout and a cap on captured output. (Interactive terminals are the
//! separate `pty.access` permission -- see pty.rs.)

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(crate) const SHELL_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const SHELL_OUTPUT_CAP: usize = 1024 * 1024;
pub(crate) const SHELL_MAX_COMMAND_BYTES: usize = 64 * 1024;

type SharedBuf = Arc<Mutex<Vec<u8>>>;

/// Drains a child's pipe on a background thread, keeping at most
/// SHELL_OUTPUT_CAP bytes. It keeps reading (and discarding) past the cap so
/// the child never blocks on a full pipe.
pub(crate) fn drain_capped<R: Read + Send + 'static>(mut reader: R) -> (SharedBuf, std::thread::JoinHandle<()>) {
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
pub(crate) fn run_shell_command(
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