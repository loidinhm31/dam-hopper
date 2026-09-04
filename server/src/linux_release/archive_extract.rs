//! Archive extraction and role projection to destination directory.

use super::archive::{bounded_gzip_reader, map_archive_read_error, map_entry_error};
use super::error::ReleaseError;
use super::inventory::{check_disallowed_files, normalize_inventory_path, TargetRole};
use super::manifest::ReleaseManifest;
use super::constants::MAX_ARCHIVE_ENTRY_BYTES;
use std::fs;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tar::{Archive, EntryType};

/// Extract role-projected entries from an archive into target destination directory.
pub fn extract_role_projection<R: Read>(
    reader: R,
    manifest: &ReleaseManifest,
    role: TargetRole,
    dest_dir: &Path,
) -> Result<(), ReleaseError> {
    let gz = bounded_gzip_reader(reader);
    let mut archive = Archive::new(gz);
    archive.set_ignore_zeros(false);

    let entries = archive
        .entries()
        .map_err(|e| map_archive_read_error("read archive entries for extraction", e.to_string()))?;

    for entry_result in entries {
        let mut entry = entry_result.map_err(|e| map_entry_error("unknown", e.to_string()))?;

        let raw_path = entry
            .path()
            .map_err(|e| map_entry_error("unknown", e.to_string()))?;
        let raw_path_str = raw_path
            .to_str()
            .ok_or_else(|| ReleaseError::ArchiveEntryTraversal("non-UTF-8 path".to_string()))?;
        let path_str = raw_path_str.trim_end_matches('/');
        normalize_inventory_path(path_str)?;
        check_disallowed_files(path_str)?;
        let normalized = path_str.to_string();

        let entry_size = entry.header().size().unwrap_or(0);
        if entry_size > MAX_ARCHIVE_ENTRY_BYTES {
            return Err(ReleaseError::ArchiveTooLarge {
                limit: MAX_ARCHIVE_ENTRY_BYTES,
            });
        }

        let inv_entry = manifest
            .inventory
            .iter()
            .find(|e| e.path == normalized)
            .ok_or_else(|| ReleaseError::ArchiveInventoryMismatch {
                reason: format!("unexpected entry during extraction: '{normalized}'"),
            })?;

        if !role.matches(&inv_entry.roles) {
            continue;
        }

        let target_path = dest_dir.join(&normalized);

        match entry.header().entry_type() {
            EntryType::Directory => {
                fs::create_dir_all(&target_path).map_err(|e| ReleaseError::Io {
                    action: "create target directory",
                    details: e.to_string(),
                })?;
                fs::set_permissions(&target_path, fs::Permissions::from_mode(inv_entry.mode))
                    .map_err(|e| ReleaseError::Io {
                        action: "set directory permissions",
                        details: e.to_string(),
                    })?;
            }
            EntryType::Regular => {
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
                        action: "create parent directory",
                        details: e.to_string(),
                    })?;
                }

                let mut out_file = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target_path)
                    .map_err(|e| ReleaseError::Io {
                        action: "create output file",
                        details: e.to_string(),
                    })?;

                std::io::copy(&mut entry, &mut out_file).map_err(|e| {
                    map_archive_read_error("extract regular file content", e.to_string())
                })?;
                out_file.sync_all().map_err(|e| ReleaseError::Io {
                    action: "fsync extracted file",
                    details: e.to_string(),
                })?;

                fs::set_permissions(&target_path, fs::Permissions::from_mode(inv_entry.mode))
                    .map_err(|e| ReleaseError::Io {
                        action: "set file permissions",
                        details: e.to_string(),
                    })?;
            }
            _ => {
                return Err(ReleaseError::ArchiveEntryNotRegularFileOrDir { path: normalized });
            }
        }
    }

    Ok(())
}
