//! Where mods live on disk, and the rules every caller-supplied id or path
//! must pass before it touches the filesystem.

use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) fn mods_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("mods"))
        .map_err(|error| error.to_string())
}

/// Mod ids and webview instance names end up in directory names and webview
/// labels, and they arrive from JS, so they're restricted to a conservative
/// charset: no dots, no separators, nothing that can climb out of a folder.
pub(crate) fn validate_id(kind: &str, value: &str) -> Result<(), String> {
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
pub(crate) fn sanitize_relative(path: &str) -> Result<PathBuf, String> {
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
pub(crate) fn ensure_within(base: &Path, target: &Path) -> Result<(), String> {
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

/// Per-mod, sandboxed data directory. Lua backends can only ever write here
/// (via ensure_dir), never to arbitrary paths.
pub(crate) fn mod_data_dir(app: &AppHandle, mod_id: &str) -> Result<PathBuf, String> {
    validate_id("mod id", mod_id)?;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("mod-data").join(mod_id))
        .map_err(|error| error.to_string())
}

/// A caller-supplied path after resolution.
pub(crate) struct ResolvedPath {
    pub path: PathBuf,
    /// True when the path is inside the calling mod's own data directory (which
    /// lives in the app data folder). Every enabled mod may use that with no
    /// permission; any other location needs an explicit `fs.*` permission.
    pub own_data: bool,
}

/// Collapses `.` and `..` without touching the filesystem, so a `..` hidden in
/// a not-yet-existing tail can't be used to smuggle a path out of a directory.
fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Whether `target`, with symlinks resolved, ends up inside `base`. Checks the
/// nearest existing ancestor, so it also works for paths about to be created.
fn is_inside(base: &Path, target: &Path) -> bool {
    let Ok(canonical_base) = base.canonicalize() else {
        // Nothing has been created under the data directory yet, so there are
        // no symlinks to worry about.
        return target.starts_with(base);
    };
    let mut probe = target;
    loop {
        if let Ok(resolved) = probe.canonicalize() {
            return resolved.starts_with(&canonical_base);
        }
        match probe.parent() {
            Some(parent) => probe = parent,
            None => return false,
        }
    }
}

/// Resolves a path from a mod.
///
/// - Relative paths are always inside the mod's own data directory (sandboxed:
///   no `..`, no symlink escapes).
/// - Absolute paths can point anywhere on the filesystem. They count as
///   `own_data` only if they resolve into the mod's own data directory.
pub(crate) fn resolve_mod_path(
    app: &AppHandle,
    mod_id: &str,
    path: &str,
) -> Result<ResolvedPath, String> {
    if path.contains('\0') {
        return Err("invalid path".into());
    }
    let base = mod_data_dir(app, mod_id)?;
    let given = Path::new(path);
    if given.is_absolute() {
        let full = normalize_lexical(given);
        let own_data = is_inside(&base, &full);
        Ok(ResolvedPath { path: full, own_data })
    } else {
        let full = base.join(sanitize_relative(path)?);
        ensure_within(&base, &full)?;
        Ok(ResolvedPath { path: full, own_data: true })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_dots_lexically() {
        assert_eq!(
            normalize_lexical(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
        // Can't climb above the root.
        assert_eq!(normalize_lexical(Path::new("/../../x")), PathBuf::from("/x"));
    }

    #[test]
    fn dotdot_in_a_missing_tail_cannot_escape_the_data_dir() {
        let base = std::env::temp_dir().join(format!("modapp-paths-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let inside = normalize_lexical(&base.join("new/dir"));
        let escaping = normalize_lexical(&base.join("new/../../outside"));
        assert!(is_inside(&base, &inside));
        assert!(!is_inside(&base, &escaping));
        assert!(!is_inside(&base, Path::new("/etc/passwd")));
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn missing_data_dir_falls_back_to_lexical_check() {
        let base = std::env::temp_dir().join("modapp-does-not-exist-xyz");
        assert!(is_inside(&base, &base.join("a/b")));
        assert!(!is_inside(&base, &std::env::temp_dir().join("other")));
    }
}