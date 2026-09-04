//! Staging transaction execution, archive extraction, and pending state recording.

use super::archive::inspect_and_validate_archive;
use super::archive_extract::extract_role_projection;
use super::attestation::verify_file_attestation;
use super::constants::MAX_MANIFEST_BYTES;
use super::error::ReleaseError;
use super::host_config::{load_host_config, save_host_config, HostConfig};
use super::inventory::TargetRole;
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::manifest::ReleaseManifest;
use super::stage::PendingState;
use super::stage::{determine_host_role, persist_host_role};
use super::stage_units::stage_candidate_units_for_release_with_render_root_and_config;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;

/// Stage a release bundle into `/opt/dam-hopper/releases/<tag>/<role>` and persist
/// pending state to `/var/lib/dam-hopper/pending.json`.
pub fn stage_release_bundle(
    layout: &Layout,
    bundle_dir: &Path,
    requested_role: Option<TargetRole>,
    allow_origins: &[String],
    verify_attestation: bool,
    is_role_set: bool,
) -> Result<PendingState, ReleaseError> {
    let _lock = DeploymentLock::acquire(&layout.deploy_lock_path())?;

    let manifest_path = bundle_dir.join("release-manifest.json");
    let manifest_meta =
        fs::symlink_metadata(&manifest_path).map_err(|e| ReleaseError::InvalidBundle {
            path: manifest_path.display().to_string(),
            reason: format!("missing or inaccessible manifest: {e}"),
        })?;

    if manifest_meta.file_type().is_symlink() {
        return Err(ReleaseError::InvalidBundle {
            path: manifest_path.display().to_string(),
            reason: "manifest cannot be a symbolic link".to_string(),
        });
    }

    use std::os::unix::fs::OpenOptionsExt;
    let manifest_file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&manifest_path)
        .map_err(|e| ReleaseError::Io {
            action: "open manifest with no-follow",
            details: e.to_string(),
        })?;
    let mut manifest_bytes = Vec::new();
    manifest_file
        .take(MAX_MANIFEST_BYTES as u64 + 1)
        .read_to_end(&mut manifest_bytes)
        .map_err(|e| ReleaseError::Io {
            action: "read manifest bytes from bundle",
            details: e.to_string(),
        })?;

    let manifest = ReleaseManifest::parse_and_validate(&manifest_bytes)?;
    let archive_path = bundle_dir.join(&manifest.archive.name);
    let archive_meta =
        fs::symlink_metadata(&archive_path).map_err(|e| ReleaseError::InvalidBundle {
            path: archive_path.display().to_string(),
            reason: format!("missing or inaccessible archive: {e}"),
        })?;

    if archive_meta.file_type().is_symlink() {
        return Err(ReleaseError::InvalidBundle {
            path: archive_path.display().to_string(),
            reason: "archive cannot be a symbolic link".to_string(),
        });
    }

    if archive_meta.len() != manifest.archive.size {
        return Err(ReleaseError::InvalidBundle {
            path: archive_path.display().to_string(),
            reason: format!(
                "archive size {} does not match manifest size {}",
                archive_meta.len(),
                manifest.archive.size
            ),
        });
    }

    if verify_attestation {
        verify_file_attestation(&manifest_path, None)?;
        verify_file_attestation(&archive_path, None)?;
    }

    verify_existing_install_root(&layout)?;

    let previous_host_config = load_host_config(&layout.host_config_path())?;
    let (role, host_config) =
        determine_host_role(layout, requested_role, allow_origins, is_role_set)?;


    let tx_id = uuid::Uuid::new_v4().to_string();
    let pending_host_config_path =
        layout.transaction_pending_host_config_json_path(&tx_id);
    let legacy_format2_root = super::legacy_format2::is_legacy_format2_root(&layout.opt_dir);
    let (target_dir, pending_units_dir, migration_opt) = if legacy_format2_root {
        let (t, u, m) = super::migration::stage_migration_candidate(
            layout,
            &tx_id,
            &archive_path,
            &manifest_bytes,
            &manifest,
            role,
            allow_origins,
        )?;
        (t, u, Some(m))
    } else {
        let tx_dir = layout.transaction_staging_dir(&tx_id);
        fs::create_dir_all(&tx_dir).map_err(|e| ReleaseError::Io {
            action: "create staging transaction directory",
            details: e.to_string(),
        })?;
        fs::set_permissions(&tx_dir, fs::Permissions::from_mode(0o700)).map_err(|e| {
            ReleaseError::Io {
                action: "set staging transaction directory permissions",
                details: e.to_string(),
            }
        })?;

        let result = execute_staging_transaction(
            layout,
            &tx_dir,
            &archive_path,
            &manifest_bytes,
            &manifest,
            role,
        );
        let cleanup_result =
            remove_dir_if_present(&tx_dir, "remove staging transaction directory");
        let target_dir = match result {
            Ok(target_dir) => target_dir,
            Err(stage_error) => {
                if let Err(cleanup_error) = cleanup_result {
                    return Err(ReleaseError::Config(format!(
                        "release staging failed ({stage_error}); cleanup failed ({cleanup_error})"
                    )));
                }
                return Err(stage_error);
            }
        };
        if let Err(cleanup_error) = cleanup_result {
            return Err(ReleaseError::Config(format!(
                "release staging completed but transaction cleanup failed ({cleanup_error})"
            )));
        }
        let pending_units_dir = layout.transaction_pending_units_dir(&tx_id);
        if let Err(stage_error) = stage_candidate_units_for_release_with_render_root_and_config(
            layout,
            &target_dir,
            &target_dir,
            &manifest,
            role,
            allow_origins,
            &pending_units_dir,
            &pending_host_config_path,
        ) {
            let cleanup_result = remove_dir_if_present(&target_dir, "remove failed release staging")
                .and_then(|_| {
                    remove_dir_if_present(
                        &pending_units_dir,
                        "remove failed pending unit staging",
                    )
                })
                .and_then(|_| {
                    remove_file_if_present(
                        &pending_host_config_path,
                        "remove failed pending host configuration",
                    )
                });
            if let Err(cleanup_error) = cleanup_result {
                return Err(ReleaseError::Config(format!(
                    "release staging failed ({stage_error}); cleanup failed ({cleanup_error})"
                )));
            }
            return Err(stage_error);
        }
        (target_dir, pending_units_dir, None)
    };
    let persist_result = persist_host_role(layout, &host_config);
    if let Err(error) = persist_result {
        return Err(cleanup_staging_failure(
            error,
            layout,
            &target_dir,
            &pending_units_dir,
            &pending_host_config_path,
            migration_opt.as_ref(),
            previous_host_config.as_ref(),
        ));
    }

    let digests = (|| {
        let manifest_sha256 = hex::encode(Sha256::digest(&manifest_bytes));
        let api_unit_sha256 = hash_optional_file(
            &pending_units_dir.join(super::constants::API_SERVICE_UNIT),
        )?;
        let web_unit_sha256 = hash_optional_file(
            &pending_units_dir.join(super::constants::WEB_SERVICE_UNIT),
        )?;
        let host_config_sha256 = hash_file(&pending_host_config_path)?;
        Ok::<_, ReleaseError>((
            manifest_sha256,
            api_unit_sha256,
            web_unit_sha256,
            host_config_sha256,
        ))
    })();
    let (manifest_sha256, api_unit_sha256, web_unit_sha256, host_config_sha256) =
        match digests {
            Ok(digests) => digests,
            Err(error) => {
                return Err(cleanup_staging_failure(
                    error,
                    layout,
                    &target_dir,
                    &pending_units_dir,
                    &pending_host_config_path,
                    migration_opt.as_ref(),
                    previous_host_config.as_ref(),
                ));
            }
        };

    let pending_record = super::state_record::PendingCandidateRecord {
        tag: manifest.release.tag.clone(),
        role,
        staged_at: chrono::Utc::now().to_rfc3339(),
        release_path: target_dir.display().to_string(),
        manifest_sha256,
        archive_sha256: manifest.archive.sha256.clone(),
        pending_units_path: Some(pending_units_dir.display().to_string()),
        pending_host_config_path: Some(pending_host_config_path.display().to_string()),
        api_unit_sha256,
        web_unit_sha256,
        host_config_sha256: Some(host_config_sha256),
    };

    let mut mgr_state = match super::state::load_or_init_manager_state(&layout.manager_state_path()) {
        Ok(state) => state,
        Err(error) => {
            return Err(cleanup_staging_failure(
                error,
                layout,
                &target_dir,
                &pending_units_dir,
                &pending_host_config_path,
                migration_opt.as_ref(),
                previous_host_config.as_ref(),
            ));
        }
    };
    mgr_state.pending = Some(pending_record.clone());
    if let Some(mig) = migration_opt.as_ref() {
        let tx_record = super::state_record::TransactionRecord {
            tx_id: tx_id.clone(),
            phase: super::state_record::TransactionPhase::Staged,
            started_at: chrono::Utc::now().to_rfc3339(),
            target_tag: manifest.release.tag.clone(),
            target_role: role,
            previous_tag: Some(super::legacy_format2::LEGACY_FORMAT2_TAG.to_string()),
            previous_role: Some(TargetRole::Server),
            units_backup_dir: Some(pending_units_dir.display().to_string()),
            config_backup_path: None,
            public_config_backup_path: None,
            migration: Some(mig.clone()),
        };
        mgr_state.transaction = Some(tx_record);
    } else {
        mgr_state.transaction = None;
    }
    if let Err(error) = super::state::save_manager_state(&layout.manager_state_path(), &mut mgr_state) {
        match super::state::load_or_init_manager_state(&layout.manager_state_path()) {
            Ok(saved_state) if saved_state.pending.as_ref() == Some(&pending_record) => {
                return Err(ReleaseError::Config(format!(
                    "staging state was durably committed but finalization reported an error: {error}"
                )));
            }
            Ok(_) => {
                return Err(cleanup_staging_failure(
                    error,
                    layout,
                    &target_dir,
                    &pending_units_dir,
                    &pending_host_config_path,
                    migration_opt.as_ref(),
                    previous_host_config.as_ref(),
                ));
            }
            Err(recovery_error) => {
                return Err(ReleaseError::Config(format!(
                    "staging state persistence failed ({error}) and could not be reconciled ({recovery_error}); RECOVERY_REQUIRED"
                )));
            }
        }
    }
    let pending = PendingState {
        tag: pending_record.tag,
        role: pending_record.role,
        staged_at: pending_record.staged_at,
        release_path: pending_record.release_path,
        manifest_sha256: pending_record.manifest_sha256,
        archive_sha256: pending_record.archive_sha256,
        pending_units_path: pending_record.pending_units_path,
    };
    Ok(pending)
}

pub(crate) fn execute_staging_transaction(
    layout: &Layout,
    tx_dir: &Path,
    archive_path: &Path,
    manifest_bytes: &[u8],
    manifest: &ReleaseManifest,
    role: TargetRole,
) -> Result<std::path::PathBuf, ReleaseError> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut src_file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(archive_path)
        .map_err(|e| ReleaseError::Io {
            action: "open bundle archive with no-follow",
            details: e.to_string(),
        })?;
    let source_before = src_file.metadata().map_err(|e| ReleaseError::Io {
        action: "stat bundle archive before copy",
        details: e.to_string(),
    })?;

    let staged_archive_path = tx_dir.join(&manifest.archive.name);
    let mut staged_archive_file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&staged_archive_path)
        .map_err(|e| ReleaseError::Io {
            action: "create staged archive copy",
            details: e.to_string(),
        })?;

    let mut hasher = Sha256::new();
    let mut copied_bytes = 0u64;
    let mut buf = [0u8; 16384];
    loop {
        let n = src_file.read(&mut buf).map_err(|e| ReleaseError::Io {
            action: "read archive from bundle",
            details: e.to_string(),
        })?;
        if n == 0 {
            break;
        }
        copied_bytes = copied_bytes.saturating_add(n as u64);
        hasher.update(&buf[..n]);
        staged_archive_file
            .write_all(&buf[..n])
            .map_err(|e| ReleaseError::Io {
                action: "write archive to staging",
                details: e.to_string(),
            })?;
    }

    let source_after = src_file.metadata().map_err(|e| ReleaseError::Io {
        action: "stat bundle archive after copy",
        details: e.to_string(),
    })?;
    if source_before.dev() != source_after.dev()
        || source_before.ino() != source_after.ino()
        || source_before.len() != source_after.len()
        || source_before.len() != copied_bytes
    {
        return Err(ReleaseError::InvalidBundle {
            path: archive_path.display().to_string(),
            reason: "archive changed while it was being copied".to_string(),
        });
    }

    let computed_sha = hex::encode(hasher.finalize());
    if computed_sha != manifest.archive.sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: manifest.archive.name.clone(),
            expected: manifest.archive.sha256.clone(),
            got: computed_sha,
        });
    }
    staged_archive_file.sync_all().map_err(|e| ReleaseError::Io {
        action: "fsync staged archive copy",
        details: e.to_string(),
    })?;

    // Inspect archive contents against manifest
    staged_archive_file
        .seek(SeekFrom::Start(0))
        .map_err(|e| ReleaseError::Io {
            action: "rewind staged archive file",
            details: e.to_string(),
        })?;
    inspect_and_validate_archive(&mut staged_archive_file, manifest)?;

    // Extract role projection
    let tx_release_dir = tx_dir.join("release");
    fs::create_dir_all(&tx_release_dir).map_err(|e| ReleaseError::Io {
        action: "create transaction release directory",
        details: e.to_string(),
    })?;

    staged_archive_file
        .seek(SeekFrom::Start(0))
        .map_err(|e| ReleaseError::Io {
            action: "rewind staged archive file for extraction",
            details: e.to_string(),
        })?;
    extract_role_projection(&mut staged_archive_file, manifest, role, &tx_release_dir)?;

    let manifest_target = tx_release_dir.join("release-manifest.json");
    let mut manifest_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&manifest_target)
        .map_err(|e| ReleaseError::Io {
            action: "create persisted release manifest",
            details: e.to_string(),
        })?;
    manifest_file
        .write_all(manifest_bytes)
        .map_err(|e| ReleaseError::Io {
            action: "write persisted release manifest",
            details: e.to_string(),
        })?;
    manifest_file.sync_all().map_err(|e| ReleaseError::Io {
        action: "fsync persisted release manifest",
        details: e.to_string(),
    })?;
    fs::set_permissions(&manifest_target, fs::Permissions::from_mode(0o644)).map_err(|e| {
        ReleaseError::Io {
            action: "set persisted release manifest permissions",
            details: e.to_string(),
        }
    })?;

    let target_dir = layout.release_role_dir(&manifest.release.tag, role.as_str());
    match fs::symlink_metadata(&target_dir) {
        Ok(_) => {
            let mgr_state = super::state::load_or_init_manager_state(&layout.manager_state_path())?;
            let is_active = mgr_state
                .active
                .as_ref()
                .is_some_and(|a| a.release_path == target_dir.to_string_lossy());
            let is_previous = mgr_state
                .previous
                .as_ref()
                .is_some_and(|p| p.release_path == target_dir.to_string_lossy());
            if is_active || is_previous {
                return Err(ReleaseError::InvalidBundle {
                    path: target_dir.display().to_string(),
                    reason: "cannot overwrite active or previous release destination".to_string(),
                });
            }
            fs::remove_dir_all(&target_dir).map_err(|e| ReleaseError::Io {
                action: "remove uncommitted candidate release destination",
                details: e.to_string(),
            })?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect release destination",
                details: error.to_string(),
            });
        }
    }

    if let Some(parent) = target_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
            action: "create release parent directory",
            details: e.to_string(),
        })?;
    }

    fs::rename(&tx_release_dir, &target_dir).map_err(|e| ReleaseError::Io {
        action: "rename staged release into destination",
        details: e.to_string(),
    })?;

    if let Some(parent) = target_dir.parent() {
        super::durable_fs::sync_dir(parent)?;
    }

    Ok(target_dir)
}

fn hash_file(path: &Path) -> Result<String, ReleaseError> {
    let bytes = fs::read(path).map_err(|e| ReleaseError::Io {
        action: "read staged file for digest",
        details: e.to_string(),
    })?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn hash_optional_file(path: &Path) -> Result<Option<String>, ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => hash_file(path).map(Some),
        Ok(_) => Err(ReleaseError::InvalidBundle {
            path: path.display().to_string(),
            reason: "staged unit path is not a regular file".to_string(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ReleaseError::Io {
            action: "inspect staged unit file",
            details: error.to_string(),
        }),
    }
}
fn remove_dir_if_present(path: &Path, action: &'static str) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_dir() => fs::remove_dir_all(path).map_err(|e| {
            ReleaseError::Io {
                action,
                details: format!("{}: {e}", path.display()),
            }
        }),
        Ok(_) => Err(ReleaseError::InvalidBundle {
            path: path.display().to_string(),
            reason: "staging cleanup target is not a directory".to_string(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ReleaseError::Io {
            action,
            details: format!("{}: {error}", path.display()),
        }),
    }
}

fn cleanup_staging_failure(
    original_error: ReleaseError,
    layout: &Layout,
    target_dir: &Path,
    pending_units_dir: &Path,
    pending_host_config_path: &Path,
    migration: Option<&super::state_record::MigrationRecord>,
    previous_host_config: Option<&HostConfig>,
) -> ReleaseError {
    let mut cleanup_errors = Vec::new();
    if let Err(error) = remove_file_if_present(
        pending_host_config_path,
        "remove failed pending host configuration",
    ) {
        cleanup_errors.push(error.to_string());
    }
    if let Err(error) =
        remove_dir_if_present(pending_units_dir, "remove failed pending unit staging")
    {
        cleanup_errors.push(error.to_string());
    }
    let release_cleanup_path = migration
        .map(|record| Path::new(&record.migration_root))
        .unwrap_or(target_dir);
    if let Err(error) = remove_dir_if_present(
        release_cleanup_path,
        "remove failed release staging",
    ) {
        cleanup_errors.push(error.to_string());
    }

    let host_config_restore = match previous_host_config {
        Some(config) => save_host_config(&layout.host_config_path(), config),
        None => remove_file_if_present(
            &layout.host_config_path(),
            "remove newly created host configuration",
        ),
    };
    if let Err(error) = host_config_restore {
        cleanup_errors.push(error.to_string());
    }

    if cleanup_errors.is_empty() {
        original_error
    } else {
        ReleaseError::Config(format!(
            "staging failed ({original_error}); cleanup failed: {}",
            cleanup_errors.join("; ")
        ))
    }
}

fn remove_file_if_present(path: &Path, action: &'static str) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => fs::remove_file(path).map_err(|e| {
            ReleaseError::Io {
                action,
                details: format!("{}: {e}", path.display()),
            }
        }),
        Ok(_) => Err(ReleaseError::InvalidBundle {
            path: path.display().to_string(),
            reason: "staging cleanup target is not a regular file".to_string(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ReleaseError::Io {
            action,
            details: format!("{}: {error}", path.display()),
        }),
    }
}

fn verify_existing_install_root(layout: &Layout) -> Result<(), ReleaseError> {
    let root = &layout.opt_dir;
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect managed release root",
                details: error.to_string(),
            });
        }
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: root.display().to_string(),
                expected: "regular managed release root".into(),
                got: "symbolic link or non-directory".into(),
            });
        }
    }

    let marker = root.join(".systemd-fresh-install").join("manifest");
    match fs::symlink_metadata(&marker) {
        Ok(metadata) if metadata.file_type().is_file() => return Ok(()),
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: marker.display().to_string(),
                expected: "regular format-2 marker".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect format-2 marker",
                details: error.to_string(),
            });
        }
    }

    let releases = root.join("releases");
    match fs::symlink_metadata(&releases) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(ReleaseError::OwnershipViolation {
            path: releases.display().to_string(),
            expected: "regular managed releases directory".into(),
            got: "symbolic link or non-directory".into(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(ReleaseError::LegacyMigrationRejected {
                reason: format!(
                    "existing release root is neither a manager tree nor an exact format-2 installation: {}",
                    root.display()
                ),
            })
        }
        Err(error) => Err(ReleaseError::Io {
            action: "inspect managed releases directory",
            details: error.to_string(),
        }),
    }
}
