use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use tar::{Archive, EntryType};

use super::error::PluginError;
use super::manifest::ManifestV1;
use super::package::BoundedReader;
use super::package_path::normalize_package_path;
use super::registry_layout::PluginRegistryLayout;

/// Controlled extraction of verified package entries into destination directory.
/// Never uses Archive::unpack. Files are written with restricted permissions and synced.
pub fn extract_package_archive(
    tar_gz_path: &Path,
    extract_dest_dir: &Path,
    manifest: &ManifestV1,
) -> Result<(), PluginError> {
    if extract_dest_dir.exists() {
        fs::remove_dir_all(extract_dest_dir).map_err(|e| {
            PluginError::runner_unavailable(format!(
                "Failed to clean target extraction dir '{}': {e}",
                extract_dest_dir.display()
            ))
        })?;
    }
    fs::create_dir_all(extract_dest_dir).map_err(|e| {
        PluginError::runner_unavailable(format!(
            "Failed to create extraction dir '{}': {e}",
            extract_dest_dir.display()
        ))
    })?;

    let file = File::open(tar_gz_path).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to open package archive: {e}"))
    })?;

    let gz = GzDecoder::new(file);
    let mut bounded = BoundedReader::new(gz, super::limits::MAX_PACKAGE_UNCOMPRESSED_BYTES);
    let mut archive = Archive::new(&mut bounded);
    archive.set_ignore_zeros(false);

    let entries = archive.entries().map_err(|e| {
        PluginError::invalid_input(format!(
            "Failed to read archive entries for extraction: {e}"
        ))
    })?;

    for entry_res in entries {
        let mut entry = entry_res.map_err(|e| {
            PluginError::invalid_input(format!("Failed to read entry during extraction: {e}"))
        })?;

        let raw_path = entry
            .path()
            .map_err(|e| PluginError::invalid_input(format!("Invalid path in entry: {e}")))?;
        let raw_str = raw_path
            .to_str()
            .ok_or_else(|| PluginError::invalid_input("Non-UTF-8 path during extraction"))?;
        let normalized = normalize_package_path(raw_str)?;
        let target_path = extract_dest_dir.join(&normalized);

        match entry.header().entry_type() {
            EntryType::Directory => {
                fs::create_dir_all(&target_path).map_err(|e| {
                    PluginError::runner_unavailable(format!(
                        "Failed to create directory '{}': {e}",
                        target_path.display()
                    ))
                })?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&target_path, fs::Permissions::from_mode(0o755));
                }
            }
            EntryType::Regular => {
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| {
                        PluginError::runner_unavailable(format!(
                            "Failed to create parent directory '{}': {e}",
                            parent.display()
                        ))
                    })?;
                }

                let mut open_opts = OpenOptions::new();
                open_opts.write(true).create_new(true);
                let mode = entry.header().mode().unwrap_or(0o644) & 0o777;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    open_opts.mode(mode);
                }

                let mut out_file = open_opts.open(&target_path).map_err(|e| {
                    PluginError::runner_unavailable(format!(
                        "Failed to create file '{}': {e}",
                        target_path.display()
                    ))
                })?;

                let mut buf = [0u8; 8192];
                loop {
                    let n = entry.read(&mut buf).map_err(|e| {
                        PluginError::invalid_input(format!(
                            "Failed reading content for '{}': {e}",
                            normalized
                        ))
                    })?;
                    if n == 0 {
                        break;
                    }
                    out_file.write_all(&buf[..n]).map_err(|e| {
                        PluginError::runner_unavailable(format!(
                            "Failed writing to '{}': {e}",
                            target_path.display()
                        ))
                    })?;
                }

                out_file.sync_all().map_err(|e| {
                    PluginError::runner_unavailable(format!(
                        "Failed syncing file '{}': {e}",
                        target_path.display()
                    ))
                })?;
            }
            _ => {
                return Err(PluginError::invalid_input(format!(
                    "Unexpected entry type for '{}'",
                    normalized
                )));
            }
        }
    }

    // Also write inventory.json
    let inventory_path = extract_dest_dir.join("inventory.json");
    let inventory_bytes = serde_json::to_vec_pretty(&manifest.inventory)
        .map_err(|e| PluginError::invalid_input(format!("Failed to serialize inventory: {e}")))?;
    fs::write(&inventory_path, &inventory_bytes).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to write inventory.json: {e}"))
    })?;

    // Sync extraction directory
    crate::linux_release::durable_fs::sync_dir(extract_dest_dir).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to sync extraction directory: {e}"))
    })?;

    Ok(())
}

/// Atomically publish extracted package directory to final immutable location.
pub fn publish_extracted_package(
    layout: &PluginRegistryLayout,
    temp_extracted_dir: &Path,
    plugin_id: &str,
    version: &str,
    sha256: &str,
) -> Result<PathBuf, PluginError> {
    let final_dir = layout.package_dir(plugin_id, version, sha256);
    if final_dir.exists() {
        // Idempotent: already published with exact same digest
        let _ = fs::remove_dir_all(temp_extracted_dir);
        return Ok(final_dir);
    }

    if let Some(parent) = final_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            PluginError::runner_unavailable(format!(
                "Failed to create package parent dir '{}': {e}",
                parent.display()
            ))
        })?;
    }

    fs::rename(temp_extracted_dir, &final_dir).map_err(|e| {
        PluginError::runner_unavailable(format!(
            "Failed to atomically publish package to '{}': {e}",
            final_dir.display()
        ))
    })?;

    if let Some(parent) = final_dir.parent() {
        let _ = crate::linux_release::durable_fs::sync_dir(parent);
    }

    Ok(final_dir)
}
