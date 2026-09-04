//! Read-only format-2 verification and legacy import model.

pub use super::legacy_format2_inspect::{
    inspect_format2_installation, verify_format2_live_preflight, LegacyFormat2Evidence,
    LEGACY_FORMAT2_PORT, LEGACY_FORMAT2_TAG, LEGACY_FORMAT2_UNIT, LEGACY_FORMAT2_USER,
};
pub use super::legacy_format2_manifest::{parse_format2_manifest, LegacyFormat2Manifest};
pub use super::legacy_format2_root::inspect_format2_root;
pub use super::legacy_format2_unit::validate_format2_unit;

use super::durable_fs::copy_file_durable;
use super::error::ReleaseError;
use super::inventory::TargetRole;
use super::state_record::ReleaseRecord;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub fn is_legacy_format2_root(root_dir: &Path) -> bool {
    let Ok(root_meta) = fs::symlink_metadata(root_dir) else {
        return false;
    };
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return false;
    }
    let Ok(marker_meta) = fs::symlink_metadata(root_dir.join(".systemd-fresh-install").join("manifest")) else {
        return false;
    };
    marker_meta.file_type().is_file()
}

/// Copy and verify legacy format-2 binary and unit evidence into an imported release directory.
pub fn import_legacy_format2_release(
    evidence: &LegacyFormat2Evidence,
    target_release_dir: &Path,
) -> Result<ReleaseRecord, ReleaseError> {
    let server_bin_dir = target_release_dir.join("server").join("bin");
    fs::create_dir_all(&server_bin_dir).map_err(|e| ReleaseError::Io {
        action: "create imported server bin dir",
        details: e.to_string(),
    })?;

    let dest_bin = server_bin_dir.join("dam-hopper-server");
    copy_file_durable(&evidence.binary_path, &dest_bin, Some(0o755))?;

    let imported_bin_bytes = fs::read(&dest_bin).map_err(|e| ReleaseError::Io {
        action: "read imported server binary",
        details: e.to_string(),
    })?;
    let imported_bin_hash = hex::encode(Sha256::digest(&imported_bin_bytes));
    if imported_bin_hash != evidence.binary_sha256 {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "imported binary hash mismatch".into(),
        });
    }

    let server_unit_dir = target_release_dir.join("server").join("systemd");
    fs::create_dir_all(&server_unit_dir).map_err(|e| ReleaseError::Io {
        action: "create imported server unit dir",
        details: e.to_string(),
    })?;

    let dest_unit = server_unit_dir.join(LEGACY_FORMAT2_UNIT);
    copy_file_durable(&evidence.unit_path, &dest_unit, Some(0o644))?;

    let imported_unit_bytes = fs::read(&dest_unit).map_err(|e| ReleaseError::Io {
        action: "read imported server unit",
        details: e.to_string(),
    })?;
    let imported_unit_hash = hex::encode(Sha256::digest(&imported_unit_bytes));
    if imported_unit_hash != evidence.unit_sha256 {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "imported unit hash mismatch".into(),
        });
    }

    let now = Utc::now().to_rfc3339();
    Ok(ReleaseRecord {
        tag: LEGACY_FORMAT2_TAG.to_string(),
        version: "imported".to_string(),
        role: TargetRole::Server,
        release_path: target_release_dir.to_string_lossy().to_string(),
        manifest_sha256: evidence.binary_sha256.clone(),
        archive_sha256: evidence.binary_sha256.clone(),
        installed_at: now.clone(),
        committed_at: now,
        api_unit_sha256: Some(evidence.unit_sha256.clone()),
        web_unit_sha256: None,
        host_config_sha256: None,
    })
}
