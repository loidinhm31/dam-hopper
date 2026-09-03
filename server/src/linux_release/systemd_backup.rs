//! Systemd unit backup, atomic installation, and rollback restoration.

use super::durable_fs::{copy_file_durable, sync_dir};
use super::error::ReleaseError;
use std::fs;
use std::path::Path;

/// Backup existing installed units to a transaction-private directory.
pub fn backup_unit_files(
    unit_names: &[&str],
    systemd_dir: &Path,
    backup_dir: &Path,
) -> Result<Vec<String>, ReleaseError> {
    if !backup_dir.exists() {
        fs::create_dir_all(backup_dir).map_err(|e| ReleaseError::Io {
            action: "create unit backup directory",
            details: e.to_string(),
        })?;
        sync_dir(backup_dir)?;
    }

    let mut backed_up = Vec::new();
    for &name in unit_names {
        let src = systemd_dir.join(name);
        if src.exists() {
            let dst = backup_dir.join(name);
            copy_file_durable(&src, &dst, Some(0o644))?;
            backed_up.push(name.to_string());
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

/// Restore unit files from a backup directory into the systemd directory.
pub fn restore_unit_files(backup_dir: &Path, systemd_dir: &Path) -> Result<(), ReleaseError> {
    if !backup_dir.exists() {
        return Ok(());
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
        if path.is_file() {
            let file_name = entry.file_name();
            let dst = systemd_dir.join(file_name);
            copy_file_durable(&path, &dst, Some(0o644))?;
        }
    }
    sync_dir(systemd_dir)?;
    Ok(())
}

/// Remove an installed unit file from the systemd directory if present.
pub fn remove_unit_file(unit_name: &str, systemd_dir: &Path) -> Result<(), ReleaseError> {
    let path = systemd_dir.join(unit_name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| ReleaseError::Io {
            action: "remove systemd unit file",
            details: e.to_string(),
        })?;
        sync_dir(systemd_dir)?;
    }
    Ok(())
}
