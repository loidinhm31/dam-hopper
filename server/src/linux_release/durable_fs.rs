//! Durable filesystem operations with crash consistency guarantees.
//!
//! Enforces:
//! 1. Write to temporary file in the target directory (same filesystem).
//! 2. Restrict file permissions before data write (typically 0600 or 0644).
//! 3. `fsync` data and metadata to disk.
//! 4. Atomic `rename` over destination.
//! 5. `fsync` the parent directory to commit the directory entry.

use super::error::ReleaseError;
use serde::Serialize;
use std::fs::{self, File};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tempfile::Builder;

/// Sync directory metadata and entries to disk.
pub fn sync_dir(dir: &Path) -> Result<(), ReleaseError> {
    if !dir.exists() {
        return Ok(());
    }
    let f = File::open(dir).map_err(|e| ReleaseError::Io {
        action: "open directory for sync",
        details: e.to_string(),
    })?;
    f.sync_all().map_err(|e| ReleaseError::Io {
        action: "fsync directory",
        details: e.to_string(),
    })?;
    Ok(())
}

/// Atomically and durably write data to `path`.
pub fn atomic_write_file(
    path: &Path,
    content: &[u8],
    mode: Option<u32>,
) -> Result<(), ReleaseError> {
    let parent = path.parent().ok_or_else(|| ReleaseError::Io {
        action: "resolve parent directory",
        details: format!("no parent for {}", path.display()),
    })?;

    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
            action: "create parent directory",
            details: e.to_string(),
        })?;
        sync_dir(parent)?;
    }

    let mut temp = Builder::new()
        .prefix(".tmp-durable-")
        .tempfile_in(parent)
        .map_err(|e| ReleaseError::Io {
            action: "create tempfile in parent directory",
            details: e.to_string(),
        })?;

    #[cfg(unix)]
    if let Some(m) = mode {
        let perms = fs::Permissions::from_mode(m);
        fs::set_permissions(temp.path(), perms).map_err(|e| ReleaseError::Io {
            action: "set tempfile permissions",
            details: e.to_string(),
        })?;
    }

    use std::io::Write;
    temp.write_all(content).map_err(|e| ReleaseError::Io {
        action: "write data to tempfile",
        details: e.to_string(),
    })?;
    temp.as_file().sync_all().map_err(|e| ReleaseError::Io {
        action: "fsync tempfile",
        details: e.to_string(),
    })?;

    temp.persist(path).map_err(|e| ReleaseError::Io {
        action: "atomic persist tempfile over destination",
        details: e.error.to_string(),
    })?;

    sync_dir(parent)?;
    Ok(())
}

/// Atomically and durably write a serializable JSON value to `path`.
pub fn atomic_write_json<T: Serialize>(
    path: &Path,
    value: &T,
    mode: Option<u32>,
) -> Result<(), ReleaseError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| ReleaseError::Config(format!("failed to serialize JSON: {e}")))?;
    atomic_write_file(path, &bytes, mode)
}

/// Durably copy a file from `src` to `dst` via tempfile and fsync.
pub fn copy_file_durable(src: &Path, dst: &Path, mode: Option<u32>) -> Result<(), ReleaseError> {
    let bytes = fs::read(src).map_err(|e| ReleaseError::Io {
        action: "read source file for durable copy",
        details: e.to_string(),
    })?;
    let target_mode = mode.or_else(|| {
        #[cfg(unix)]
        {
            fs::metadata(src).ok().map(|m| m.permissions().mode())
        }
        #[cfg(not(unix))]
        {
            None
        }
    });
    atomic_write_file(dst, &bytes, target_mode)
}

/// Atomically create or update a symbolic link to point to `target`.
pub fn atomic_symlink(target: &Path, link_path: &Path) -> Result<(), ReleaseError> {
    let parent = link_path.parent().ok_or_else(|| ReleaseError::Io {
        action: "resolve parent for symlink",
        details: format!("no parent for {}", link_path.display()),
    })?;

    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
            action: "create parent directory for symlink",
            details: e.to_string(),
        })?;
        sync_dir(parent)?;
    }

    #[cfg(unix)]
    {
        let tmp_link_name = format!(".tmp-link-{}", uuid::Uuid::new_v4());
        let tmp_link_path = parent.join(tmp_link_name);

        std::os::unix::fs::symlink(target, &tmp_link_path).map_err(|e| ReleaseError::Io {
            action: "create temporary symlink",
            details: e.to_string(),
        })?;

        if let Err(e) = fs::rename(&tmp_link_path, link_path) {
            let _ = fs::remove_file(&tmp_link_path);
            return Err(ReleaseError::Io {
                action: "rename temporary symlink over target link",
                details: e.to_string(),
            });
        }

        sync_dir(parent)?;
        Ok(())
    }

    #[cfg(not(unix))]
    {
        Err(ReleaseError::Config(
            "atomic symlinks not supported on non-unix".into(),
        ))
    }
}
