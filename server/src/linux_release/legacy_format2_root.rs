//! Read-only filesystem invariant validation for the format-2 root tree.

use super::error::ReleaseError;
use super::legacy_format2_manifest::{parse_format2_manifest, LegacyFormat2Manifest};
use sha2::{Digest, Sha256};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

/// Verify format-2 root layout, permissions, marker, nonce, and binary hash.
pub fn inspect_format2_root(
    root_dir: &Path,
    require_root: bool,
) -> Result<LegacyFormat2Manifest, ReleaseError> {
    let root_meta = fs::symlink_metadata(root_dir).map_err(|e| ReleaseError::Io {
        action: "stat format-2 root",
        details: e.to_string(),
    })?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 root must be a directory and not a symlink".into(),
        });
    }
    if (root_meta.mode() & 0o777) != 0o755 || (require_root && root_meta.uid() != 0) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 root permissions must be 0755 root-owned".into(),
        });
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(root_dir).map_err(|e| ReleaseError::Io {
        action: "read format-2 root dir",
        details: e.to_string(),
    })? {
        let entry = entry.map_err(|e| ReleaseError::Io {
            action: "read format-2 root entry",
            details: e.to_string(),
        })?;
        entries.push(entry.file_name().to_string_lossy().to_string());
    }
    entries.sort();

    if entries.iter().any(|e| e == "web") {
        return Err(ReleaseError::UnsupportedFormat1Migration(
            "format-2 root contains legacy web directory; format 1 is unsupported".into(),
        ));
    }
    if entries != [".systemd-fresh-install", "bin"] {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("root entries must be exactly ['.systemd-fresh-install', 'bin'], got {entries:?}"),
        });
    }

    // Inspect bin/dam-hopper-server
    let bin_dir = root_dir.join("bin");
    let bin_meta = fs::symlink_metadata(&bin_dir).map_err(|e| ReleaseError::Io {
        action: "stat format-2 bin dir",
        details: e.to_string(),
    })?;
    if bin_meta.file_type().is_symlink()
        || !bin_meta.is_dir()
        || (bin_meta.mode() & 0o777) != 0o755
        || (require_root && bin_meta.uid() != 0)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 bin/ must be an unlinked 0755 directory".into(),
        });
    }
    let mut bin_entries = Vec::new();
    for entry in fs::read_dir(&bin_dir).map_err(|e| ReleaseError::Io {
        action: "read format-2 bin dir entries",
        details: e.to_string(),
    })? {
        let entry = entry.map_err(|e| ReleaseError::Io {
            action: "read format-2 bin dir entry",
            details: e.to_string(),
        })?;
        if entry.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: "format-2 bin/ entry must not be a symlink".into(),
            });
        }
        bin_entries.push(entry.file_name().to_string_lossy().to_string());
    }
    if bin_entries != ["dam-hopper-server"] {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("bin entries must be exactly ['dam-hopper-server'], got {bin_entries:?}"),
        });
    }
    let server_bin = bin_dir.join("dam-hopper-server");
    let bin_file_meta = fs::symlink_metadata(&server_bin).map_err(|e| ReleaseError::Io {
        action: "stat format-2 server binary",
        details: e.to_string(),
    })?;
    if bin_file_meta.file_type().is_symlink()
        || !bin_file_meta.is_file()
        || (bin_file_meta.mode() & 0o777) != 0o755
        || (require_root && bin_file_meta.uid() != 0)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 server binary must be a 0755 regular file".into(),
        });
    }
    let binary_bytes = fs::read(&server_bin).map_err(|e| ReleaseError::Io {
        action: "read format-2 server binary",
        details: e.to_string(),
    })?;
    let computed_bin_hash = hex::encode(Sha256::digest(&binary_bytes));

    // Inspect marker directory
    let marker_dir = root_dir.join(".systemd-fresh-install");
    let marker_meta = fs::symlink_metadata(&marker_dir).map_err(|e| ReleaseError::Io {
        action: "stat format-2 marker dir",
        details: e.to_string(),
    })?;
    if marker_meta.file_type().is_symlink()
        || !marker_meta.is_dir()
        || (marker_meta.mode() & 0o777) != 0o700
        || (require_root && marker_meta.uid() != 0)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 marker dir must be a 0700 directory".into(),
        });
    }
    let mut marker_entries = Vec::new();
    for entry in fs::read_dir(&marker_dir).map_err(|e| ReleaseError::Io {
        action: "read format-2 marker dir entries",
        details: e.to_string(),
    })? {
        let entry = entry.map_err(|e| ReleaseError::Io {
            action: "read format-2 marker dir entry",
            details: e.to_string(),
        })?;
        if entry.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: "format-2 marker entry must not be a symlink".into(),
            });
        }
        marker_entries.push(entry.file_name().to_string_lossy().to_string());
    }
    marker_entries.sort();
    if marker_entries.iter().any(|e| e == "web.sha256") {
        return Err(ReleaseError::UnsupportedFormat1Migration(
            "marker contains web.sha256; format 1 is unsupported".into(),
        ));
    }
    if marker_entries != ["manifest", "nonce"] {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("marker entries must be exactly ['manifest', 'nonce'], got {marker_entries:?}"),
        });
    }

    let manifest_path = marker_dir.join("manifest");
    let manifest_meta = fs::symlink_metadata(&manifest_path).map_err(|e| ReleaseError::Io {
        action: "stat format-2 manifest",
        details: e.to_string(),
    })?;
    if manifest_meta.file_type().is_symlink()
        || !manifest_meta.is_file()
        || (manifest_meta.mode() & 0o777) != 0o600
        || (require_root && manifest_meta.uid() != 0)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 manifest must be a 0600 regular file".into(),
        });
    }
    let manifest_content = fs::read_to_string(&manifest_path).map_err(|e| ReleaseError::Io {
        action: "read format-2 manifest",
        details: e.to_string(),
    })?;
    let manifest = parse_format2_manifest(&manifest_content)?;

    let nonce_path = marker_dir.join("nonce");
    let nonce_meta = fs::symlink_metadata(&nonce_path).map_err(|e| ReleaseError::Io {
        action: "stat format-2 nonce",
        details: e.to_string(),
    })?;
    if nonce_meta.file_type().is_symlink()
        || !nonce_meta.is_file()
        || (nonce_meta.mode() & 0o777) != 0o600
        || (require_root && nonce_meta.uid() != 0)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 nonce must be a 0600 regular file".into(),
        });
    }
    let nonce_content = fs::read_to_string(&nonce_path).map_err(|e| ReleaseError::Io {
        action: "read format-2 nonce",
        details: e.to_string(),
    })?;
    if nonce_content.trim() != manifest.nonce {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "marker nonce does not match manifest nonce".into(),
        });
    }

    if computed_bin_hash != manifest.binary_sha256 {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "binary hash mismatch: expected {}, got {}",
                manifest.binary_sha256, computed_bin_hash
            ),
        });
    }

    Ok(manifest)
}
