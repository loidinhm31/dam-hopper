//! Safe release archive inspection, entry validation, and inventory verification.

use super::error::ReleaseError;
use super::inventory::{check_disallowed_files, normalize_inventory_path, EntryKind};
use super::manifest::ReleaseManifest;
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Read;
use tar::{Archive, EntryType};

pub use super::archive_extract::extract_role_projection;

/// Validate that every archive entry matches manifest inventory and contains no
/// links, devices, special files, or invalid paths.
pub fn inspect_and_validate_archive<R: Read>(
    reader: R,
    manifest: &ReleaseManifest,
) -> Result<(), ReleaseError> {
    let gz = GzDecoder::new(reader);
    let mut archive = Archive::new(gz);
    archive.set_ignore_zeros(false);

    let mut seen_paths = HashSet::new();

    let entries = archive.entries().map_err(|e| ReleaseError::Io {
        action: "read archive entries",
        details: e.to_string(),
    })?;

    for entry_result in entries {
        let mut entry = entry_result.map_err(|e| ReleaseError::ArchiveEntryInvalid {
            path: "unknown".to_string(),
            reason: e.to_string(),
        })?;

        let entry_type = entry.header().entry_type();
        let raw_path = entry
            .path()
            .map_err(|e| ReleaseError::ArchiveEntryInvalid {
                path: "unknown".to_string(),
                reason: e.to_string(),
            })?;

        let raw_path_str = raw_path
            .to_str()
            .ok_or_else(|| ReleaseError::ArchiveEntryTraversal("non-UTF-8 path".to_string()))?;
        let path_str = raw_path_str.trim_end_matches('/');
        normalize_inventory_path(path_str)?;
        check_disallowed_files(path_str)?;
        let normalized = path_str.to_string();

        if !seen_paths.insert(normalized.clone()) {
            return Err(ReleaseError::DuplicateInventoryPath(normalized));
        }

        let inv_entry = manifest
            .inventory
            .iter()
            .find(|e| e.path == normalized)
            .ok_or_else(|| ReleaseError::ArchiveInventoryMismatch {
                reason: format!("unexpected entry in archive: '{normalized}'"),
            })?;

        let header_mode = entry.header().mode().unwrap_or(0) & 0o777;
        if header_mode != inv_entry.mode {
            return Err(ReleaseError::ArchiveEntryInvalid {
                path: normalized.clone(),
                reason: format!(
                    "mode mismatch: archive has {header_mode:#o}, manifest expects {:#o}",
                    inv_entry.mode
                ),
            });
        }

        match entry_type {
            EntryType::Directory => {
                if inv_entry.kind != EntryKind::Dir {
                    return Err(ReleaseError::ArchiveEntryInvalid {
                        path: normalized,
                        reason: "expected file, found directory".to_string(),
                    });
                }
            }
            EntryType::Regular => {
                if inv_entry.kind != EntryKind::File {
                    return Err(ReleaseError::ArchiveEntryInvalid {
                        path: normalized,
                        reason: "expected directory, found regular file".to_string(),
                    });
                }

                let expected_size =
                    inv_entry
                        .size
                        .ok_or_else(|| ReleaseError::MissingFileMetadata {
                            path: normalized.clone(),
                        })?;

                let entry_size = entry.header().size().unwrap_or(0);
                if entry_size != expected_size {
                    return Err(ReleaseError::ArchiveEntryInvalid {
                        path: normalized.clone(),
                        reason: format!(
                            "size mismatch: archive header has {entry_size}, manifest expects {expected_size}"
                        ),
                    });
                }

                let mut hasher = Sha256::new();
                let mut buf = [0u8; 8192];
                let mut total_read = 0u64;

                loop {
                    let n = entry.read(&mut buf).map_err(|e| ReleaseError::Io {
                        action: "read archive entry body",
                        details: e.to_string(),
                    })?;
                    if n == 0 {
                        break;
                    }
                    total_read += n as u64;
                    hasher.update(&buf[..n]);
                }

                if total_read != expected_size {
                    return Err(ReleaseError::ArchiveEntryInvalid {
                        path: normalized.clone(),
                        reason: format!(
                            "actual read size {total_read} differs from expected {expected_size}"
                        ),
                    });
                }

                let actual_sha = hex::encode(hasher.finalize());
                let expected_sha = inv_entry.sha256.as_deref().unwrap_or("");
                if actual_sha != expected_sha {
                    return Err(ReleaseError::ArchiveDigestMismatch {
                        path: normalized,
                        expected: expected_sha.to_string(),
                        got: actual_sha,
                    });
                }
            }
            _ => {
                return Err(ReleaseError::ArchiveEntryNotRegularFileOrDir { path: normalized });
            }
        }
    }

    for inv_entry in &manifest.inventory {
        if !seen_paths.contains(&inv_entry.path) {
            return Err(ReleaseError::ArchiveInventoryMismatch {
                reason: format!("manifest entry missing from archive: '{}'", inv_entry.path),
            });
        }
    }

    Ok(())
}
