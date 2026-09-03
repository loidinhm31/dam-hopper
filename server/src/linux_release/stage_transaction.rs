//! Staging transaction execution, archive extraction, and pending state recording.

use super::archive::inspect_and_validate_archive;
use super::archive_extract::extract_role_projection;
use super::attestation::verify_file_attestation;
use super::error::ReleaseError;
use super::inventory::TargetRole;
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::manifest::ReleaseManifest;
use super::stage::{resolve_host_role, PendingState};
use super::stage_units::stage_candidate_units;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::PermissionsExt;
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
    let mut manifest_file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&manifest_path)
        .map_err(|e| ReleaseError::Io {
            action: "open manifest with no-follow",
            details: e.to_string(),
        })?;
    let mut manifest_bytes = Vec::new();
    manifest_file
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

    if verify_attestation {
        verify_file_attestation(&manifest_path, None)?;
        verify_file_attestation(&archive_path, None)?;
    }

    let role = resolve_host_role(layout, requested_role, allow_origins, is_role_set)?;

    let tx_id = uuid::Uuid::new_v4().to_string();
    let (target_dir, pending_units_dir, migration_opt) = if super::legacy_format2::is_legacy_format2_root(&layout.opt_dir) {
        let (t, u, m) = super::migration::stage_migration_candidate(
            layout,
            &tx_id,
            &archive_path,
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
        let _ = fs::set_permissions(&tx_dir, fs::Permissions::from_mode(0o700));

        let result = execute_staging_transaction(layout, &tx_dir, &archive_path, &manifest, role);
        let _ = fs::remove_dir_all(&tx_dir);
        let target_dir = result?;
        let pending_units_dir =
            stage_candidate_units(layout, &target_dir, &manifest, role, allow_origins)?;
        (target_dir, pending_units_dir, None)
    };
    let manifest_sha256 = hex::encode(Sha256::digest(&manifest_bytes));

    let pending_record = super::state_record::PendingCandidateRecord {
        tag: manifest.release.tag.clone(),
        role,
        staged_at: chrono::Utc::now().to_rfc3339(),
        release_path: target_dir.display().to_string(),
        manifest_sha256,
        archive_sha256: manifest.archive.sha256.clone(),
        pending_units_path: Some(pending_units_dir.display().to_string()),
        pending_host_config_path: Some(
            layout
                .var_lib_dir
                .join("pending-host-config.json")
                .display()
                .to_string(),
        ),
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
    };

    let mut mgr_state = super::state::load_or_init_manager_state(&layout.manager_state_path())?;
    mgr_state.pending = Some(pending_record.clone());
    if let Some(mig) = migration_opt {
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
            migration: Some(mig),
        };
        mgr_state.transaction = Some(tx_record);
    }
    super::state::save_manager_state(&layout.manager_state_path(), &mut mgr_state)?;
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

    let staged_archive_path = tx_dir.join(&manifest.archive.name);
    let mut staged_archive_file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(&staged_archive_path)
        .map_err(|e| ReleaseError::Io {
            action: "create staged archive copy",
            details: e.to_string(),
        })?;

    let mut hasher = Sha256::new();
    let mut buf = [0u8; 16384];
    loop {
        let n = src_file.read(&mut buf).map_err(|e| ReleaseError::Io {
            action: "read archive from bundle",
            details: e.to_string(),
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        staged_archive_file
            .write_all(&buf[..n])
            .map_err(|e| ReleaseError::Io {
                action: "write archive to staging",
                details: e.to_string(),
            })?;
    }

    let computed_sha = hex::encode(hasher.finalize());
    if computed_sha != manifest.archive.sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: manifest.archive.name.clone(),
            expected: manifest.archive.sha256.clone(),
            got: computed_sha,
        });
    }

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

    let target_dir = layout.release_role_dir(&manifest.release.tag, role.as_str());
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).map_err(|e| ReleaseError::Io {
            action: "remove pre-existing release directory",
            details: e.to_string(),
        })?;
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

    Ok(target_dir)
}
