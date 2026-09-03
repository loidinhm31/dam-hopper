//! Staging, directory exchange, restoration, and cleanup for format-2 migration.

use super::durable_fs::{atomic_exchange_directories, copy_file_durable};
use super::error::ReleaseError;
use super::layout::Layout;
use super::legacy_format2::{LEGACY_FORMAT2_TAG, LEGACY_FORMAT2_UNIT};
use super::state_record::MigrationRecord;
use super::systemd::{systemctl_daemon_reload, systemctl_start};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// Check if side-staging directory path and canonical root share the same filesystem device.
pub fn verify_same_device(path_a: &Path, path_b: &Path) -> Result<(), ReleaseError> {
    let meta_a = fs::metadata(path_a).map_err(|e| ReleaseError::Io {
        action: "stat device for path A",
        details: e.to_string(),
    })?;
    let meta_b = fs::metadata(path_b).map_err(|e| ReleaseError::Io {
        action: "stat device for path B",
        details: e.to_string(),
    })?;
    if meta_a.dev() != meta_b.dev() {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "device mismatch: path A dev {} != path B dev {}",
                meta_a.dev(),
                meta_b.dev()
            ),
        });
    }
    Ok(())
}

/// Create side-staging migration workspace beside the canonical root on the same device.
pub fn create_migration_workspace(layout: &Layout, tx_id: &str) -> Result<PathBuf, ReleaseError> {
    let parent = layout.opt_dir.parent().ok_or_else(|| ReleaseError::Config(
        "canonical opt_dir has no parent directory".into(),
    ))?;
    verify_same_device(&layout.opt_dir, parent)?;

    let migration_root = parent.join(format!(".dam-hopper-migration.{tx_id}"));
    if migration_root.exists() {
        let _ = fs::remove_dir_all(&migration_root);
    }
    fs::create_dir_all(&migration_root).map_err(|e| ReleaseError::Io {
        action: "create migration workspace",
        details: e.to_string(),
    })?;
    fs::set_permissions(&migration_root, fs::Permissions::from_mode(0o700)).map_err(|e| {
        ReleaseError::Io {
            action: "set migration workspace permissions to 0700",
            details: e.to_string(),
        }
    })?;

    // Write crash recovery marker inside the workspace
    let marker_path = migration_root.join(".migration-transaction");
    let marker_json = serde_json::json!({
        "txId": tx_id,
        "role": "migration_root",
        "stagedAt": Utc::now().to_rfc3339(),
    });
    fs::write(&marker_path, marker_json.to_string()).map_err(|e| ReleaseError::Io {
        action: "write migration transaction marker",
        details: e.to_string(),
    })?;

    Ok(migration_root)
}

/// Stage legacy format-2 import and candidate release into an isolated sibling migration workspace.
pub fn stage_migration_candidate(
    layout: &Layout,
    tx_id: &str,
    archive_path: &Path,
    manifest: &super::manifest::ReleaseManifest,
    role: super::inventory::TargetRole,
    allow_origins: &[String],
) -> Result<(PathBuf, PathBuf, MigrationRecord), ReleaseError> {
    let manifest_info = super::legacy_format2::inspect_format2_root(&layout.opt_dir, false)?;
    let unit_path = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    let unit_content =
        super::legacy_format2::validate_format2_unit(&unit_path, &manifest_info.unit_sha256, false)?;
    let wants_link = layout.systemd_unit_dir.join("multi-user.target.wants").join(LEGACY_FORMAT2_UNIT);
    let wants_meta = fs::symlink_metadata(&wants_link).map_err(|e| ReleaseError::Io {
        action: "stat format-2 wants link",
        details: e.to_string(),
    })?;
    if !wants_meta.file_type().is_symlink() {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 wants entry must be a symbolic link".into(),
        });
    }
    let wants_target = fs::read_link(&wants_link).map_err(|e| ReleaseError::Io {
        action: "read format-2 wants link target",
        details: e.to_string(),
    })?;
    if !wants_target.to_string_lossy().ends_with(LEGACY_FORMAT2_UNIT) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("format-2 wants link does not target {LEGACY_FORMAT2_UNIT}"),
        });
    }

    let migration_root = create_migration_workspace(layout, tx_id)?;
    let mut mig_layout = layout.clone();
    mig_layout.opt_dir = migration_root.clone();

    let legacy_evidence = super::legacy_format2::LegacyFormat2Evidence {
        root_path: layout.opt_dir.clone(),
        binary_path: layout.opt_dir.join("bin").join("dam-hopper-server"),
        binary_sha256: manifest_info.binary_sha256.clone(),
        unit_path: unit_path.clone(),
        unit_sha256: manifest_info.unit_sha256.clone(),
        unit_content,
        wants_link_path: wants_link.clone(),
        manifest: manifest_info,
        pid: 0,
        uid: 0,
        gid: 0,
        api_version: "imported".into(),
        device_id: 0,
    };

    let _imported_prev = super::legacy_format2::import_legacy_format2_release(
        &legacy_evidence,
        &mig_layout.releases_dir().join(LEGACY_FORMAT2_TAG),
    )?;

    let tx_dir = mig_layout.transaction_staging_dir(tx_id);
    fs::create_dir_all(&tx_dir).map_err(|e| ReleaseError::Io {
        action: "create staging transaction directory",
        details: e.to_string(),
    })?;
    let _ = fs::set_permissions(&tx_dir, fs::Permissions::from_mode(0o700));

    let res = super::stage_transaction::execute_staging_transaction(
        &mig_layout,
        &tx_dir,
        archive_path,
        manifest,
        role,
    );
    let _ = fs::remove_dir_all(&tx_dir);
    let target_dir = res?;
    let pending_units_dir =
        super::stage_units::stage_candidate_units(layout, &target_dir, manifest, role, allow_origins)?;

    let imported_unit_path = migration_root
        .join("releases")
        .join(LEGACY_FORMAT2_TAG)
        .join("server")
        .join("systemd")
        .join(LEGACY_FORMAT2_UNIT);
    let mig_record = MigrationRecord {
        legacy_root: layout.opt_dir.display().to_string(),
        migration_root: migration_root.display().to_string(),
        legacy_binary_sha256: legacy_evidence.binary_sha256,
        legacy_unit_sha256: legacy_evidence.unit_sha256,
        exchanged: false,
        old_unit_backup_path: imported_unit_path.display().to_string(),
        old_wants_link_path: wants_link.display().to_string(),
    };

    Ok((target_dir, pending_units_dir, mig_record))
}

/// Execute atomic root exchange: sets workspace mode 0755, then swaps directories.
pub fn execute_migration_exchange(
    layout: &Layout,
    migration_record: &mut MigrationRecord,
) -> Result<(), ReleaseError> {
    let mig_root = Path::new(&migration_record.migration_root);
    fs::set_permissions(mig_root, fs::Permissions::from_mode(0o755)).map_err(|e| {
        ReleaseError::Io {
            action: "set migration root permissions to 0755 before exchange",
            details: e.to_string(),
        }
    })?;

    atomic_exchange_directories(&layout.opt_dir, mig_root)?;
    migration_record.exchanged = true;
    Ok(())
}

/// Rollback atomic root exchange: swaps directories back, restores unit and enablement.
pub fn rollback_migration_exchange(
    layout: &Layout,
    migration_record: &MigrationRecord,
) -> Result<(), ReleaseError> {
    let canonical_has_marker = layout.opt_dir.join(".migration-transaction").exists();
    if migration_record.exchanged || canonical_has_marker {
        let mig_root = Path::new(&migration_record.migration_root);
        if mig_root.exists() {
            let _ = atomic_exchange_directories(&layout.opt_dir, mig_root);
        }
    }

    let backup_unit = Path::new(&migration_record.old_unit_backup_path);
    let target_unit = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    if backup_unit.exists() {
        let _ = copy_file_durable(backup_unit, &target_unit, Some(0o644));
    } else {
        let fallback_backup = layout
            .releases_dir()
            .join(LEGACY_FORMAT2_TAG)
            .join("server")
            .join("systemd")
            .join(LEGACY_FORMAT2_UNIT);
        if fallback_backup.exists() {
            let _ = copy_file_durable(&fallback_backup, &target_unit, Some(0o644));
        }
    }

    let target_wants = Path::new(&migration_record.old_wants_link_path);
    if !target_wants.exists() {
        if let Some(parent) = target_wants.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = std::os::unix::fs::symlink(&target_unit, target_wants);
    }

    let _ = systemctl_daemon_reload();
    let _ = systemctl_start(LEGACY_FORMAT2_UNIT);
    Ok(())
}

/// Commit migration cleanup: verify imported previous binary hash equals exchanged root, then prune.
pub fn commit_migration_cleanup(
    layout: &Layout,
    migration_record: &MigrationRecord,
) -> Result<(), ReleaseError> {
    let imported_bin = layout
        .releases_dir()
        .join(LEGACY_FORMAT2_TAG)
        .join("server")
        .join("bin")
        .join("dam-hopper-server");

    if imported_bin.is_file() {
        let bytes = fs::read(&imported_bin).map_err(|e| ReleaseError::Io {
            action: "read imported legacy binary for commit check",
            details: e.to_string(),
        })?;
        let hash = hex::encode(Sha256::digest(&bytes));
        if hash != migration_record.legacy_binary_sha256 {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: "imported binary hash did not match recorded legacy hash at commit".into(),
            });
        }
    }

    let marker_path = layout.opt_dir.join(".migration-transaction");
    if marker_path.exists() {
        let _ = fs::remove_file(marker_path);
    }

    let old_root = Path::new(&migration_record.migration_root);
    if old_root.exists() {
        fs::remove_dir_all(old_root).map_err(|e| ReleaseError::Io {
            action: "remove exchanged legacy root after commit verification",
            details: e.to_string(),
        })?;
    }

    Ok(())
}
