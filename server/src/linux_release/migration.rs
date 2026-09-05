//! Staging, directory exchange, restoration, and cleanup for format-2 migration.

use super::durable_fs::{
    atomic_exchange_directories, atomic_write_file, copy_file_durable, sync_dir,
};
use super::error::ReleaseError;
use super::layout::Layout;
use super::legacy_format2::{LEGACY_FORMAT2_TAG, LEGACY_FORMAT2_UNIT};
use super::state_record::MigrationRecord;
use super::systemd::{systemctl_daemon_reload, systemctl_enable, systemctl_start};
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
    let parent = layout
        .opt_dir
        .parent()
        .ok_or_else(|| ReleaseError::Config("canonical opt_dir has no parent directory".into()))?;
    verify_same_device(&layout.opt_dir, parent)?;

    let migration_root = parent.join(format!(".dam-hopper-migration.{tx_id}"));
    match fs::symlink_metadata(&migration_root) {
        Ok(_) => {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!(
                    "migration workspace already exists: {}",
                    migration_root.display()
                ),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect migration workspace",
                details: error.to_string(),
            });
        }
    }
    fs::create_dir(&migration_root).map_err(|e| ReleaseError::Io {
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
    atomic_write_file(
        &marker_path,
        marker_json.to_string().as_bytes(),
        Some(0o600),
    )?;

    Ok(migration_root)
}

/// Stage legacy format-2 import and candidate release into an isolated sibling migration workspace.
pub fn stage_migration_candidate(
    layout: &Layout,
    tx_id: &str,
    archive_path: &Path,
    manifest_bytes: &[u8],
    manifest: &super::manifest::ReleaseManifest,
    role: super::inventory::TargetRole,
    allow_origins: &[String],
) -> Result<(PathBuf, PathBuf, MigrationRecord), ReleaseError> {
    let api_version = super::legacy_format2::verify_format2_live_preflight(layout)?;
    let manifest_info = super::legacy_format2::inspect_format2_root(&layout.opt_dir, false)?;
    let unit_path = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    let unit_content = super::legacy_format2::validate_format2_unit(
        &unit_path,
        &manifest_info.unit_sha256,
        false,
    )?;
    let wants_link = layout
        .systemd_unit_dir
        .join("multi-user.target.wants")
        .join(LEGACY_FORMAT2_UNIT);
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
    if !wants_target
        .to_string_lossy()
        .ends_with(LEGACY_FORMAT2_UNIT)
    {
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
        api_version: api_version.clone(),
        device_id: 0,
    };

    if let Err(error) = super::legacy_format2::import_legacy_format2_release(
        &legacy_evidence,
        &mig_layout.releases_dir().join(LEGACY_FORMAT2_TAG),
    ) {
        cleanup_migration_workspace(&migration_root)?;
        return Err(error);
    }

    let tx_dir = mig_layout.transaction_staging_dir(tx_id);
    if let Err(error) = fs::create_dir_all(&tx_dir) {
        cleanup_migration_workspace(&migration_root)?;
        return Err(ReleaseError::Io {
            action: "create staging transaction directory",
            details: error.to_string(),
        });
    }
    fs::set_permissions(&tx_dir, fs::Permissions::from_mode(0o700)).map_err(|error| {
        ReleaseError::Io {
            action: "set staging transaction directory permissions",
            details: error.to_string(),
        }
    })?;

    let target_dir = match super::stage_transaction::execute_staging_transaction(
        &mig_layout,
        &tx_dir,
        archive_path,
        manifest_bytes,
        manifest,
        role,
        false,
    ) {
        Ok(target_dir) => target_dir,
        Err(error) => {
            cleanup_migration_workspace(&migration_root)?;
            return Err(error);
        }
    };
    cleanup_migration_workspace(&tx_dir)?;

    let pending_units_dir = layout.transaction_pending_units_dir(tx_id);
    let pending_host_config_path = layout.transaction_pending_host_config_json_path(tx_id);
    if let Err(error) =
        super::stage_units::stage_candidate_units_for_release_with_render_root_and_config(
            layout,
            &target_dir,
            &layout.release_role_dir(&manifest.release.tag, role.as_str()),
            manifest,
            role,
            allow_origins,
            &pending_units_dir,
            &pending_host_config_path,
        )
    {
        cleanup_dir_if_present(&pending_units_dir, "remove failed pending unit staging")?;
        cleanup_file_if_present(
            &pending_host_config_path,
            "remove failed pending host configuration",
        )?;
        cleanup_migration_workspace(&migration_root)?;
        return Err(error);
    }

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
        legacy_api_version: Some(legacy_evidence.api_version),
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
    let marker_path = layout.opt_dir.join(".migration-transaction");
    let canonical_has_marker = match fs::symlink_metadata(&marker_path) {
        Ok(meta) if meta.file_type().is_file() => true,
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: marker_path.display().to_string(),
                expected: "regular migration marker".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect migration marker",
                details: error.to_string(),
            });
        }
    };
    if migration_record.exchanged || canonical_has_marker {
        let mig_root = Path::new(&migration_record.migration_root);
        match fs::symlink_metadata(mig_root) {
            Ok(meta) if meta.file_type().is_dir() => {}
            Ok(_) => {
                return Err(ReleaseError::OwnershipViolation {
                    path: mig_root.display().to_string(),
                    expected: "regular migration rollback workspace".into(),
                    got: "symbolic link or non-directory".into(),
                });
            }
            Err(error) => {
                return Err(ReleaseError::LegacyMigrationRejected {
                    reason: format!(
                        "migration rollback workspace is missing: {} ({error})",
                        mig_root.display()
                    ),
                });
            }
        }
        atomic_exchange_directories(&layout.opt_dir, mig_root)?;
    }

    let backup_unit = Path::new(&migration_record.old_unit_backup_path);
    let fallback_backup = layout
        .releases_dir()
        .join(LEGACY_FORMAT2_TAG)
        .join("server")
        .join("systemd")
        .join(LEGACY_FORMAT2_UNIT);
    let source_unit = match fs::symlink_metadata(backup_unit) {
        Ok(meta) if meta.file_type().is_file() => backup_unit.to_path_buf(),
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: backup_unit.display().to_string(),
                expected: "regular legacy unit backup".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match fs::symlink_metadata(&fallback_backup) {
                Ok(meta) if meta.file_type().is_file() => fallback_backup,
                Ok(_) => {
                    return Err(ReleaseError::OwnershipViolation {
                        path: fallback_backup.display().to_string(),
                        expected: "regular legacy unit backup".into(),
                        got: "symbolic link or non-regular file".into(),
                    });
                }
                Err(_) => {
                    return Err(ReleaseError::LegacyMigrationRejected {
                        reason: "legacy unit backup is missing".to_string(),
                    });
                }
            }
        }
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect legacy unit backup",
                details: error.to_string(),
            });
        }
    };
    let source_unit_hash = hex::encode(Sha256::digest(fs::read(&source_unit).map_err(|e| {
        ReleaseError::Io {
            action: "read legacy unit backup",
            details: e.to_string(),
        }
    })?));
    if source_unit_hash != migration_record.legacy_unit_sha256 {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "legacy unit backup hash mismatch: expected {}, got {}",
                migration_record.legacy_unit_sha256, source_unit_hash
            ),
        });
    }
    let target_unit = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    copy_file_durable(&source_unit, &target_unit, Some(0o644))?;

    let target_wants = Path::new(&migration_record.old_wants_link_path);
    match fs::symlink_metadata(target_wants) {
        Ok(meta) if meta.file_type().is_symlink() => {
            let target = fs::read_link(target_wants).map_err(|e| ReleaseError::Io {
                action: "read legacy wants link target",
                details: e.to_string(),
            })?;
            if !target.to_string_lossy().ends_with(LEGACY_FORMAT2_UNIT) {
                return Err(ReleaseError::LegacyMigrationRejected {
                    reason: format!(
                        "legacy wants link does not target {LEGACY_FORMAT2_UNIT}: {}",
                        target.display()
                    ),
                });
            }
        }
        Ok(_) => {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!(
                    "legacy wants path is not a symbolic link: {}",
                    target_wants.display()
                ),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = target_wants.parent() {
                fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
                    action: "create legacy wants directory",
                    details: e.to_string(),
                })?;
            }
            std::os::unix::fs::symlink(&target_unit, target_wants).map_err(|e| {
                ReleaseError::Io {
                    action: "restore legacy wants link",
                    details: e.to_string(),
                }
            })?;
        }
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect legacy wants link",
                details: error.to_string(),
            });
        }
    }

    systemctl_daemon_reload()?;
    systemctl_enable(LEGACY_FORMAT2_UNIT)?;
    systemctl_start(LEGACY_FORMAT2_UNIT)?;
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

    match fs::symlink_metadata(&imported_bin) {
        Ok(meta) if meta.file_type().is_file() => {}
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: imported_bin.display().to_string(),
                expected: "regular imported legacy binary".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        Err(error) => {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!(
                    "imported legacy binary is missing or inaccessible: {} ({error})",
                    imported_bin.display()
                ),
            });
        }
    }
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
    let marker_path = layout.opt_dir.join(".migration-transaction");

    match fs::symlink_metadata(&marker_path) {
        Ok(meta) if meta.file_type().is_file() => {
            fs::remove_file(&marker_path).map_err(|e| ReleaseError::Io {
                action: "remove migration transaction marker",
                details: e.to_string(),
            })?;
            sync_dir(&layout.opt_dir)?;
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: marker_path.display().to_string(),
                expected: "regular migration transaction marker".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect migration transaction marker",
                details: error.to_string(),
            });
        }
    }

    let old_root = Path::new(&migration_record.migration_root);
    match fs::symlink_metadata(old_root) {
        Ok(meta) if meta.file_type().is_dir() => {
            fs::remove_dir_all(old_root).map_err(|e| ReleaseError::Io {
                action: "remove exchanged legacy root after commit verification",
                details: e.to_string(),
            })?;
            if let Some(parent) = old_root.parent() {
                sync_dir(parent)?;
            }
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: old_root.display().to_string(),
                expected: "regular exchanged legacy root".into(),
                got: "symbolic link or non-directory".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect exchanged legacy root",
                details: error.to_string(),
            });
        }
    }

    Ok(())
}
fn cleanup_migration_workspace(path: &Path) -> Result<(), ReleaseError> {
    cleanup_dir_if_present(path, "remove migration workspace")
}

fn cleanup_dir_if_present(path: &Path, action: &'static str) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_dir() => {
            fs::remove_dir_all(path).map_err(|e| ReleaseError::Io {
                action,
                details: format!("{}: {e}", path.display()),
            })
        }
        Ok(_) => Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("cleanup path is not a directory: {}", path.display()),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ReleaseError::Io {
            action,
            details: format!("{}: {error}", path.display()),
        }),
    }
}

fn cleanup_file_if_present(path: &Path, action: &'static str) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => {
            fs::remove_file(path).map_err(|e| ReleaseError::Io {
                action,
                details: format!("{}: {e}", path.display()),
            })
        }
        Ok(_) => Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("cleanup path is not a regular file: {}", path.display()),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ReleaseError::Io {
            action,
            details: format!("{}: {error}", path.display()),
        }),
    }
}
