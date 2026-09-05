//! Safe release archive inspection, entry validation, and inventory verification.

use super::constants::{MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_UNCOMPRESSED_BYTES};
use super::error::ReleaseError;
use super::inventory::{check_disallowed_files, normalize_inventory_path, EntryKind};
use super::manifest::ReleaseManifest;
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{self, Read};
use tar::{Archive, EntryType};

pub use super::archive_extract::extract_role_projection;

const ARCHIVE_LIMIT_MARKER: &str = "dam-hopper archive expansion limit exceeded";

/// Reader that rejects archives whose decompressed stream exceeds the global
/// expansion bound without buffering the decompressed payload.
pub(crate) struct BoundedArchiveReader<R> {
    inner: R,
    limit: u64,
    total: u64,
}

impl<R> BoundedArchiveReader<R> {
    pub(crate) fn new(inner: R) -> Self {
        Self::with_limit(inner, MAX_ARCHIVE_UNCOMPRESSED_BYTES)
    }

    fn with_limit(inner: R, limit: u64) -> Self {
        Self {
            inner,
            limit,
            total: 0,
        }
    }
}

impl<R: Read> Read for BoundedArchiveReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let limit = self.limit;
        if self.total >= limit {
            let mut probe = [0u8; 1];
            return match self.inner.read(&mut probe)? {
                0 => Ok(0),
                _ => Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    ARCHIVE_LIMIT_MARKER,
                )),
            };
        }

        let remaining = limit - self.total;
        if remaining >= buf.len() as u64 {
            let read = self.inner.read(buf)?;
            self.total = self.total.saturating_add(read as u64);
            return Ok(read);
        }

        let allowed = remaining as usize;
        let read = self.inner.read(&mut buf[..allowed])?;
        self.total = self.total.saturating_add(read as u64);
        if read < allowed {
            return Ok(read);
        }

        let mut probe = [0u8; 1];
        if self.inner.read(&mut probe)? == 0 {
            Ok(read)
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidData,
                ARCHIVE_LIMIT_MARKER,
            ))
        }
    }
}

pub(crate) fn bounded_gzip_reader<R: Read>(
    reader: R,
) -> BoundedArchiveReader<GzDecoder<R>> {
    BoundedArchiveReader::new(GzDecoder::new(reader))
}

pub(crate) fn map_archive_read_error(action: &'static str, details: String) -> ReleaseError {
    if details.contains(ARCHIVE_LIMIT_MARKER) {
        ReleaseError::ArchiveTooLarge {
            limit: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
        }
    } else {
        ReleaseError::Io { action, details }
    }
}

pub(crate) fn map_entry_error(path: &str, details: String) -> ReleaseError {
    if details.contains(ARCHIVE_LIMIT_MARKER) {
        ReleaseError::ArchiveTooLarge {
            limit: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
        }
    } else {
        ReleaseError::ArchiveEntryInvalid {
            path: path.to_string(),
            reason: details,
        }
    }
}

/// Validate that every archive entry matches manifest inventory and contains no
/// links, devices, special files, or invalid paths.
pub fn inspect_and_validate_archive<R: Read>(
    reader: R,
    manifest: &ReleaseManifest,
) -> Result<(), ReleaseError> {
    let gz = bounded_gzip_reader(reader);
    let mut archive = Archive::new(gz);
    archive.set_ignore_zeros(false);

    let mut seen_paths = HashSet::new();
    let entries = archive
        .entries()
        .map_err(|e| map_archive_read_error("read archive entries", e.to_string()))?;

    for entry_result in entries {
        let mut entry = entry_result
            .map_err(|e| map_entry_error("unknown", e.to_string()))?;

        let entry_type = entry.header().entry_type();
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
                if expected_size > MAX_ARCHIVE_ENTRY_BYTES {
                    return Err(ReleaseError::ArchiveTooLarge {
                        limit: MAX_ARCHIVE_ENTRY_BYTES,
                    });
                }

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
                    let n = entry
                        .read(&mut buf)
                        .map_err(|e| map_entry_error(&normalized, e.to_string()))?;
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


#[cfg(test)]
mod tests {
    use super::BoundedArchiveReader;
    use std::io::{Cursor, Read};

    #[test]
    fn bounded_reader_rejects_decompression_expansion() {
        let mut reader = BoundedArchiveReader::with_limit(Cursor::new(vec![0u8; 5]), 4);
        let mut buffer = [0u8; 4];
        assert_eq!(reader.read(&mut buffer).unwrap(), 4);
        let error = reader.read(&mut buffer).unwrap_err();
        assert!(error.to_string().contains("expansion limit exceeded"));
    }
}