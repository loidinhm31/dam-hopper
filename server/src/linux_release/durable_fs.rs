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
    match fs::symlink_metadata(dir) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: dir.display().to_string(),
                expected: "regular directory".into(),
                got: "symbolic link or non-directory".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect directory for sync",
                details: error.to_string(),
            });
        }
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

fn ensure_directory(path: &Path, action: &'static str) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: "regular directory".into(),
            got: "symbolic link or non-directory".into(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path).map_err(|e| ReleaseError::Io {
                action,
                details: e.to_string(),
            })?;
            match fs::symlink_metadata(path) {
                Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
                Ok(_) => Err(ReleaseError::OwnershipViolation {
                    path: path.display().to_string(),
                    expected: "regular directory".into(),
                    got: "symbolic link or non-directory".into(),
                }),
                Err(error) => Err(ReleaseError::Io {
                    action,
                    details: error.to_string(),
                }),
            }
        }
        Err(error) => Err(ReleaseError::Io {
            action,
            details: error.to_string(),
        }),
    }
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

    ensure_directory(parent, "create parent directory")?;

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
    let source_meta = fs::symlink_metadata(src).map_err(|e| ReleaseError::Io {
        action: "inspect source file for durable copy",
        details: e.to_string(),
    })?;
    if source_meta.file_type().is_symlink() || !source_meta.is_file() {
        return Err(ReleaseError::OwnershipViolation {
            path: src.display().to_string(),
            expected: "regular source file".into(),
            got: "symbolic link or non-regular file".into(),
        });
    }
    let bytes = fs::read(src).map_err(|e| ReleaseError::Io {
        action: "read source file for durable copy",
        details: e.to_string(),
    })?;
    let target_mode = mode.or_else(|| {
        #[cfg(unix)]
        {
            Some(source_meta.permissions().mode())
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

    ensure_directory(parent, "create parent directory for symlink")?;

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

/// Atomically exchange two directories on the same filesystem using renameat2(RENAME_EXCHANGE).
pub fn atomic_exchange_directories(path_a: &Path, path_b: &Path) -> Result<(), ReleaseError> {
    #[cfg(target_os = "linux")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let c_a = CString::new(path_a.as_os_str().as_bytes()).map_err(|e| ReleaseError::Io {
            action: "convert path_a to CString",
            details: e.to_string(),
        })?;
        let c_b = CString::new(path_b.as_os_str().as_bytes()).map_err(|e| ReleaseError::Io {
            action: "convert path_b to CString",
            details: e.to_string(),
        })?;

        let ret = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                c_a.as_ptr(),
                libc::AT_FDCWD,
                c_b.as_ptr(),
                libc::RENAME_EXCHANGE,
            )
        };
        if ret != 0 {
            let err = std::io::Error::last_os_error();
            return Err(ReleaseError::ExchangeFailed {
                action: "renameat2(RENAME_EXCHANGE)",
                details: err.to_string(),
            });
        }

        if let Some(p) = path_a.parent() {
            sync_dir(p)?;
        }
        if let Some(p) = path_b.parent() {
            sync_dir(p)?;
        }

        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (path_a, path_b);
        Err(ReleaseError::ExchangeFailed {
            action: "atomic_exchange_directories",
            details: "RENAME_EXCHANGE is only supported on Linux".into(),
        })
    }
}
