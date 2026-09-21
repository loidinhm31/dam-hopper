use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use tar::{Archive, EntryType};

use super::error::PluginError;
use super::limits::{MAX_ARCHIVE_ENTRIES, MAX_PACKAGE_UNCOMPRESSED_BYTES};
use super::manifest::{validate_manifest, ManifestV1};
use super::package_path::{normalize_package_path, PathCollisionTracker};
use super::package_validate::{validate_entrypoints, validate_inventory_match};

pub struct BoundedReader<R> {
    pub inner: R,
    pub total_read: u64,
    pub limit: u64,
}

impl<R: Read> BoundedReader<R> {
    pub fn new(inner: R, limit: u64) -> Self {
        Self { inner, total_read: 0, limit }
    }
}

impl<R: Read> Read for BoundedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.total_read += n as u64;
        if self.total_read > self.limit {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Uncompressed archive size exceeded maximum limit of {} bytes", self.limit),
            ));
        }
        Ok(n)
    }
}

#[derive(Debug, Clone)]
pub struct InspectedEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mode: u32,
    pub sha256: Option<String>,
}

pub fn inspect_and_validate_package(
    tar_gz_path: &Path,
) -> Result<(ManifestV1, u64, Vec<u8>), PluginError> {
    let file = File::open(tar_gz_path).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to open staged package file: {e}"))
    })?;

    let gz = GzDecoder::new(file);
    let mut bounded = BoundedReader::new(gz, MAX_PACKAGE_UNCOMPRESSED_BYTES);
    let mut archive = Archive::new(&mut bounded);
    archive.set_ignore_zeros(false);

    let entries = archive.entries().map_err(|e| {
        PluginError::invalid_input(format!("Failed to read archive entries: {e}"))
    })?;

    let mut tracker = PathCollisionTracker::new();
    let mut entry_count = 0;
    let mut manifest_bytes: Option<Vec<u8>> = None;
    let mut inspected_entries: HashMap<String, InspectedEntry> = HashMap::new();

    for entry_res in entries {
        entry_count += 1;
        if entry_count > MAX_ARCHIVE_ENTRIES {
            return Err(PluginError::invalid_input(format!(
                "Archive entry count exceeds maximum limit of {MAX_ARCHIVE_ENTRIES}"
            )));
        }

        let mut entry = entry_res.map_err(|e| {
            PluginError::invalid_input(format!("Failed to read entry: {e}"))
        })?;

        let is_dir = match entry.header().entry_type() {
            EntryType::Regular => false,
            EntryType::Directory => true,
            other => {
                return Err(PluginError::invalid_input(format!(
                    "Unsupported archive entry type: {other:?}. Only regular files and directories allowed."
                )));
            }
        };

        let raw_path = entry.path().map_err(|e| {
            PluginError::invalid_input(format!("Invalid path in archive header: {e}"))
        })?;
        let raw_str = raw_path.to_str().ok_or_else(|| {
            PluginError::invalid_input("Archive entry path is not valid UTF-8")
        })?;

        let normalized = normalize_package_path(raw_str)?;
        tracker.check_and_insert(&normalized)?;

        let header_mode = entry.header().mode().unwrap_or(0) & 0o777;
        let entry_size = entry.header().size().unwrap_or(0);

        if is_dir {
            inspected_entries.insert(
                normalized.clone(),
                InspectedEntry { path: normalized, is_dir: true, size: 0, mode: header_mode, sha256: None },
            );
            continue;
        }

        let mut hasher = Sha256::new();
        let mut content = Vec::with_capacity(std::cmp::min(entry_size as usize, 64 * 1024));
        let mut chunk = [0u8; 8192];
        let mut read_bytes = 0u64;

        loop {
            let n = entry.read(&mut chunk).map_err(|e| {
                PluginError::invalid_input(format!("Failed reading entry '{normalized}': {e}"))
            })?;
            if n == 0 {
                break;
            }
            read_bytes += n as u64;
            hasher.update(&chunk[..n]);
            if normalized == "manifest.json" {
                content.extend_from_slice(&chunk[..n]);
            }
        }

        if read_bytes != entry_size {
            return Err(PluginError::invalid_input(format!(
                "Entry '{normalized}' size mismatch: declared {entry_size}, read {read_bytes}"
            )));
        }

        let digest = hex::encode(hasher.finalize());
        if normalized == "manifest.json" {
            manifest_bytes = Some(content);
        }

        inspected_entries.insert(
            normalized.clone(),
            InspectedEntry {
                path: normalized,
                is_dir: false,
                size: entry_size,
                mode: header_mode,
                sha256: Some(digest),
            },
        );
    }

    let manifest_raw = manifest_bytes.ok_or_else(|| {
        PluginError::invalid_input("Archive missing required 'manifest.json' entry")
    })?;
    let manifest_str = std::str::from_utf8(&manifest_raw).map_err(|e| {
        PluginError::invalid_input(format!("'manifest.json' is not valid UTF-8: {e}"))
    })?;
    let manifest = validate_manifest(manifest_str)?;

    validate_inventory_match(&manifest, &inspected_entries)?;
    validate_entrypoints(&manifest, &inspected_entries)?;

    Ok((manifest, bounded.total_read, manifest_raw))
}
