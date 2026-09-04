//! Systemd unit backup, atomic installation, and rollback restoration.

use super::durable_fs::{copy_file_durable, sync_dir};
use super::error::ReleaseError;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

/// Backup existing installed units to a transaction-private directory.
pub fn backup_unit_files(
    unit_names: &[&str],
    systemd_dir: &Path,
    backup_dir: &Path,
) -> Result<Vec<String>, ReleaseError> {
    match fs::symlink_metadata(backup_dir) {
        Ok(metadata) if metadata.file_type().is_dir() => {
            let mode = metadata.permissions().mode() & 0o777;
            if mode != 0o700 {
                return Err(ReleaseError::OwnershipViolation {
                    path: backup_dir.display().to_string(),
                    expected: "0700 transaction backup directory".into(),
                    got: format!("{mode:#o}"),
                });
            }
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: backup_dir.display().to_string(),
                expected: "regular transaction backup directory".into(),
                got: "symbolic link or non-directory".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(backup_dir).map_err(|e| ReleaseError::Io {
                action: "create unit backup directory",
                details: e.to_string(),
            })?;
            fs::set_permissions(backup_dir, fs::Permissions::from_mode(0o700)).map_err(|e| {
                ReleaseError::Io {
                    action: "set unit backup directory permissions",
                    details: e.to_string(),
                }
            })?;
            sync_dir(backup_dir)?;
        }
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect unit backup directory",
                details: error.to_string(),
            });
        }
    }

    let mut backed_up = Vec::new();
    for &name in unit_names {
        let src = systemd_dir.join(name);
        match fs::symlink_metadata(&src) {
            Ok(meta) if meta.file_type().is_file() => {
                let dst = backup_dir.join(name);
                copy_file_durable(&src, &dst, Some(0o644))?;
                backed_up.push(name.to_string());
            }
            Ok(_) => {
                return Err(ReleaseError::OwnershipViolation {
                    path: src.display().to_string(),
                    expected: "regular unit file".into(),
                    got: "symbolic link or non-regular file".into(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect existing systemd unit",
                    details: error.to_string(),
                });
            }
        }
    }
    sync_dir(backup_dir)?;
    Ok(backed_up)
}

/// Atomically install a candidate unit file into the systemd unit directory.
pub fn install_unit_file(
    candidate_unit_path: &Path,
    systemd_dir: &Path,
) -> Result<(), ReleaseError> {
    let file_name = candidate_unit_path
        .file_name()
        .ok_or_else(|| ReleaseError::Io {
            action: "get candidate unit filename",
            details: format!("invalid path: {}", candidate_unit_path.display()),
        })?;
    let dst = systemd_dir.join(file_name);
    copy_file_durable(candidate_unit_path, &dst, Some(0o644))
}

/// Restore unit files from a backup directory into the systemd unit directory.
pub fn restore_unit_files(backup_dir: &Path, systemd_dir: &Path) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(backup_dir) {
        Ok(meta) if meta.file_type().is_dir() => {}
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: backup_dir.display().to_string(),
                expected: "regular backup directory".into(),
                got: "symbolic link or non-directory".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect unit backup directory",
                details: error.to_string(),
            });
        }
    }

    let entries = fs::read_dir(backup_dir).map_err(|e| ReleaseError::Io {
        action: "read unit backup directory",
        details: e.to_string(),
    })?;

    for entry_res in entries {
        let entry = entry_res.map_err(|e| ReleaseError::Io {
            action: "iterate backup unit entry",
            details: e.to_string(),
        })?;
        let path = entry.path();
        let meta = entry.file_type().map_err(|e| ReleaseError::Io {
            action: "inspect backup unit entry",
            details: e.to_string(),
        })?;
        if !meta.is_file() {
            return Err(ReleaseError::OwnershipViolation {
                path: path.display().to_string(),
                expected: "regular backup unit file".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        let file_name = entry.file_name();
        let dst = systemd_dir.join(file_name);
        copy_file_durable(&path, &dst, Some(0o644))?;
    }
    sync_dir(systemd_dir)?;
    Ok(())
}

/// Remove an installed unit file from the systemd directory if present.
pub fn remove_unit_file(unit_name: &str, systemd_dir: &Path) -> Result<(), ReleaseError> {
    let path = systemd_dir.join(unit_name);
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_file() => {
            fs::remove_file(&path).map_err(|e| ReleaseError::Io {
                action: "remove systemd unit file",
                details: e.to_string(),
            })?;
            sync_dir(systemd_dir)?;
            Ok(())
        }
        Ok(_) => Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: "regular systemd unit file".into(),
            got: "symbolic link or non-regular file".into(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ReleaseError::Io {
            action: "inspect systemd unit file before removal",
            details: error.to_string(),
        }),
    }
}
