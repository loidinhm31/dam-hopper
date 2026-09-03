//! Ownership and permission validation for release trees and manager state.

use super::error::ReleaseError;
use super::layout::Layout;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

/// Verify expected mode and optional root ownership on a file or directory.
pub fn verify_path_permissions(
    path: &Path,
    expected_mode: u32,
    require_root: bool,
) -> Result<(), ReleaseError> {
    let meta = fs::symlink_metadata(path).map_err(|e| ReleaseError::Io {
        action: "read metadata for permissions check",
        details: e.to_string(),
    })?;

    if meta.file_type().is_symlink() {
        return Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: "regular file or directory".into(),
            got: "symbolic link".into(),
        });
    }

    let actual_mode = meta.mode() & 0o777;
    if actual_mode != expected_mode {
        return Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: format!("mode {:04o}", expected_mode),
            got: format!("mode {:04o}", actual_mode),
        });
    }

    if require_root && meta.uid() != 0 {
        return Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: "root owner (uid 0)".into(),
            got: format!("uid {}", meta.uid()),
        });
    }

    Ok(())
}

/// Recursively verify release directory permissions:
/// directories 0755, binaries in bin/ 0755, other regular files 0644.
pub fn verify_release_ownership(
    release_dir: &Path,
    require_root: bool,
) -> Result<(), ReleaseError> {
    if !release_dir.exists() {
        return Err(ReleaseError::OwnershipViolation {
            path: release_dir.display().to_string(),
            expected: "directory to exist".into(),
            got: "path does not exist".into(),
        });
    }

    verify_path_permissions(release_dir, 0o755, require_root)?;
    visit_dir_recursive(release_dir, require_root)
}

fn visit_dir_recursive(dir: &Path, require_root: bool) -> Result<(), ReleaseError> {
    let entries = fs::read_dir(dir).map_err(|e| ReleaseError::Io {
        action: "read directory for ownership verification",
        details: e.to_string(),
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| ReleaseError::Io {
            action: "read dir entry",
            details: e.to_string(),
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|e| ReleaseError::Io {
            action: "read file type",
            details: e.to_string(),
        })?;

        if file_type.is_dir() {
            verify_path_permissions(&path, 0o755, require_root)?;
            visit_dir_recursive(&path, require_root)?;
        } else if file_type.is_file() {
            let in_bin = path
                .parent()
                .map(|p| p.file_name().and_then(|n| n.to_str()) == Some("bin"))
                .unwrap_or(false);
            let expected_mode = if in_bin { 0o755 } else { 0o644 };
            verify_path_permissions(&path, expected_mode, require_root)?;
        } else {
            return Err(ReleaseError::OwnershipViolation {
                path: path.display().to_string(),
                expected: "regular file or directory".into(),
                got: "special file or link".into(),
            });
        }
    }

    Ok(())
}

/// Verify permissions on manager state files and directories.
pub fn verify_manager_state_permissions(
    layout: &Layout,
    require_root: bool,
) -> Result<(), ReleaseError> {
    let staging = layout.staging_dir();
    if staging.exists() {
        verify_path_permissions(&staging, 0o700, require_root)?;
    }

    let pending = layout.pending_state_path();
    if pending.exists() {
        verify_path_permissions(&pending, 0o600, require_root)?;
    }

    let host_config = layout.host_config_path();
    if host_config.exists() {
        verify_path_permissions(&host_config, 0o644, require_root)?;
    }

    let lock = layout.deploy_lock_path();
    if lock.exists() {
        verify_path_permissions(&lock, 0o600, require_root)?;
    }

    Ok(())
}
