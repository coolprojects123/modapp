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

/// Spawns an already-built Command, waits with a hard timeout, and captures
/// output. Shared by run_shell_command (goes through a platform shell, so
/// the caller's whole command is a single string re-parsed by that shell)
/// and run_argv (no shell at all -- each argument is a genuine OS-level
/// argv element, so nothing gets re-parsed or needs quoting).
///
/// Only the child process is killed on timeout, not its whole process tree,
/// and captured output is snapshotted after a short grace period instead of
/// joined -- a backgrounded grandchild holding the pipe open can't hang us.
fn run_command(mut command: Command, cwd: &Path) -> std::io::Result<(i32, Vec<u8>, Vec<u8>, bool)> {
    let mut child = command
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

/// Runs a command via the platform shell (no login shell) with a hard
/// timeout. Returns (exit code, stdout, stderr, timed_out).
///
/// NOTE ON WINDOWS QUOTING: `command` is a single string that gets re-parsed
/// TWICE before anything in it runs -- once by Rust's own Command::arg()
/// escaping (which wraps/escapes the whole string using the MS C-runtime
/// argv convention so it survives as one argument to cmd.exe), and again by
/// cmd.exe's own, incompatible quoting rules ("..." grouping, ^ escapes, %
/// expansion) once it receives that already-escaped string after /C. A
/// caller trying to embed a quoted argument (e.g. a URL) inside `command`
/// cannot reliably control both layers at once -- quoting that's correct
/// for cmd.exe alone breaks once Rust's own escaping runs first. This is
/// not a caller bug to work around with cleverer quoting; if a script needs
/// to pass a single untrusted argument to a specific program safely and
/// portably, prefer run_argv (below) instead of building a command string.
pub(crate) fn run_shell_command(
    command: &str,
    cwd: &Path,
) -> std::io::Result<(i32, Vec<u8>, Vec<u8>, bool)> {
    let shell = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("bash");
        c.arg("-c").arg(command);
        c
    };
    run_command(shell, cwd)
}

/// Runs `program` with `args` directly -- NOT through a shell. Each element
/// of `args` becomes exactly one OS-level argv entry (via Rust's
/// Command::arg, called once per element), so there is no string for any
/// shell to re-parse and therefore nothing to quote or escape, on either
/// platform. This is the safe, portable way to run a fixed program with a
/// caller-supplied argument (e.g. curl with an untrusted URL) -- see the
/// long comment on run_shell_command for why building a quoted command
/// string for cmd.exe specifically cannot be made reliable the other way.
pub(crate) fn run_argv(
    program: &str,
    args: &[String],
    cwd: &Path,
) -> std::io::Result<(i32, Vec<u8>, Vec<u8>, bool)> {
    let mut command = Command::new(program);
    command.args(args);
    run_command(command, cwd)
}