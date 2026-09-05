//! Automatic and manual rollback restoration with verified health stability.

use super::account::get_user_by_name;
use super::activate_preflight::build_candidate_health_targets;
use super::constants::{
    ALL_SERVICE_UNITS, API_SERVICE_HEALTH_PATH, API_SERVICE_UNIT, RECOVERY_SERVICE_UNIT,
    WEB_SERVICE_UNIT,
};
use super::durable_fs::{atomic_symlink, copy_file_durable};
use super::error::ReleaseError;
use super::health::{
    DEFAULT_PROBE_INTERVAL, DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_STARTUP_DEADLINE,
    wait_for_health_stability,
};
use super::host_config::load_host_public_config;
use super::layout::Layout;
use super::legacy_format2::{
    LEGACY_FORMAT2_PORT, LEGACY_FORMAT2_TAG, LEGACY_FORMAT2_UNIT, LEGACY_FORMAT2_USER,
    validate_format2_unit,
};
use super::lock::DeploymentLock;
use super::manifest::ReleaseManifest;
use super::process::{check_ports_free, inspect_service_process, is_port_listening_wildcard};
use super::stage_units::stage_candidate_units_for_release_with_render_root_and_config;
use super::state::{load_or_init_manager_state, save_manager_state};
use super::state_record::{FailureRecord, PendingCandidateRecord, ReleaseRecord, TransactionPhase};
use super::systemd::{
    remove_unit_file, restore_unit_files, systemctl_daemon_reload, systemctl_disable,
    systemctl_enable, systemctl_is_active, systemctl_is_enabled, systemctl_start, systemctl_stop,
};
use chrono::Utc;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::time::Duration;

pub fn stop_and_disable_units(units: &[&str], systemd_dir: &Path) -> Result<(), ReleaseError> {
    for &unit in units {
        if systemctl_is_active(unit)? {
            systemctl_stop(unit)?;
        }
        if systemctl_is_enabled(unit)? {
            systemctl_disable(unit)?;
        }
        remove_unit_file(unit, systemd_dir)?;
    }
    systemctl_daemon_reload()?;
    Ok(())
}

fn release_to_candidate(r: &ReleaseRecord) -> PendingCandidateRecord {
    PendingCandidateRecord {
        tag: r.tag.clone(),
        role: r.role,
        staged_at: r.installed_at.clone(),
        release_path: r.release_path.clone(),
        manifest_sha256: r.manifest_sha256.clone(),
        archive_sha256: r.archive_sha256.clone(),
        pending_units_path: None,
        pending_host_config_path: None,
        api_unit_sha256: r.api_unit_sha256.clone(),
        web_unit_sha256: r.web_unit_sha256.clone(),
        host_config_sha256: r.host_config_sha256.clone(),
    }
}
fn stage_previous_release_candidate(
    layout: &Layout,
    release: &ReleaseRecord,
) -> Result<PendingCandidateRecord, ReleaseError> {
    let release_path = Path::new(&release.release_path);
    let manifest_path = release_path.join("release-manifest.json");
    let manifest_bytes = fs::read(&manifest_path).map_err(|e| ReleaseError::Io {
        action: "read previous release manifest for rollback",
        details: e.to_string(),
    })?;
    let manifest = ReleaseManifest::parse_and_validate(&manifest_bytes)?;
    if manifest.release.tag != release.tag || manifest.release.version != release.version {
        return Err(ReleaseError::Config(
            "previous release metadata does not match its release manifest".into(),
        ));
    }
    let manifest_sha256 = hex::encode(Sha256::digest(&manifest_bytes));
    if manifest_sha256 != release.manifest_sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: manifest_path.display().to_string(),
            expected: release.manifest_sha256.clone(),
            got: manifest_sha256,
        });
    }
    if manifest.archive.sha256 != release.archive_sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: manifest.archive.name.clone(),
            expected: release.archive_sha256.clone(),
            got: manifest.archive.sha256.clone(),
        });
    }

    let allow_origins = load_host_public_config(&layout.host_config_json_path())?
        .map(|config| config.allowed_web_origins)
        .unwrap_or_default();
    let tx_id = uuid::Uuid::new_v4().to_string();
    let pending_units_dir = layout.transaction_pending_units_dir(&tx_id);
    let pending_host_config_path = layout.transaction_pending_host_config_json_path(&tx_id);
    let stage_result = stage_candidate_units_for_release_with_render_root_and_config(
        layout,
        release_path,
        release_path,
        &manifest,
        release.role,
        &allow_origins,
        &pending_units_dir,
        &pending_host_config_path,
    );
    if let Err(error) = stage_result {
        let cleanup_result =
            cleanup_rollback_staging(&pending_units_dir, &pending_host_config_path);
        return match cleanup_result {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(ReleaseError::Config(format!(
                "rollback candidate staging failed ({error}); cleanup failed ({cleanup_error})"
            ))),
        };
    }
    let digests = (|| {
        let host_config_sha256 = hash_file(&pending_host_config_path)?;
        let api_unit_sha256 = hash_optional_file(&pending_units_dir.join(API_SERVICE_UNIT))?;
        let web_unit_sha256 = hash_optional_file(&pending_units_dir.join(WEB_SERVICE_UNIT))?;
        Ok::<_, ReleaseError>((host_config_sha256, api_unit_sha256, web_unit_sha256))
    })();
    let (host_config_sha256, api_unit_sha256, web_unit_sha256) = match digests {
        Ok(digests) => digests,
        Err(error) => {
            let cleanup_result =
                cleanup_rollback_staging(&pending_units_dir, &pending_host_config_path);
            return match cleanup_result {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(ReleaseError::Config(format!(
                    "rollback candidate digesting failed ({error}); cleanup failed ({cleanup_error})"
                ))),
            };
        }
    };

    Ok(PendingCandidateRecord {
        tag: release.tag.clone(),
        role: release.role,
        staged_at: Utc::now().to_rfc3339(),
        release_path: release.release_path.clone(),
        manifest_sha256: release.manifest_sha256.clone(),
        archive_sha256: release.archive_sha256.clone(),
        pending_units_path: Some(pending_units_dir.display().to_string()),
        pending_host_config_path: Some(pending_host_config_path.display().to_string()),
        api_unit_sha256,
        web_unit_sha256,
        host_config_sha256: Some(host_config_sha256),
    })
}

fn cleanup_rollback_staging(
    pending_units_dir: &Path,
    pending_host_config_path: &Path,
) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(pending_units_dir) {
        Ok(meta) if meta.file_type().is_dir() => {
            fs::remove_dir_all(pending_units_dir).map_err(|e| ReleaseError::Io {
                action: "remove failed rollback pending units",
                details: e.to_string(),
            })?
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: pending_units_dir.display().to_string(),
                expected: "regular directory".into(),
                got: "non-directory or symbolic link".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect failed rollback pending units",
                details: error.to_string(),
            });
        }
    }
    match fs::symlink_metadata(pending_host_config_path) {
        Ok(meta) if meta.file_type().is_file() => fs::remove_file(pending_host_config_path)
            .map_err(|e| ReleaseError::Io {
                action: "remove failed rollback pending host config",
                details: e.to_string(),
            })?,
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: pending_host_config_path.display().to_string(),
                expected: "regular file".into(),
                got: "non-regular file or symbolic link".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect failed rollback pending host config",
                details: error.to_string(),
            });
        }
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<String, ReleaseError> {
    let bytes = fs::read(path).map_err(|e| ReleaseError::Io {
        action: "read rollback candidate file for digest",
        details: e.to_string(),
    })?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn hash_optional_file(path: &Path) -> Result<Option<String>, ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => hash_file(path).map(Some),
        Ok(_) => Err(ReleaseError::InvalidBundle {
            path: path.display().to_string(),
            reason: "rollback candidate unit path is not a regular file".into(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ReleaseError::Io {
            action: "inspect rollback candidate unit file",
            details: error.to_string(),
        }),
    }
}
fn validate_imported_legacy_release(
    layout: &Layout,
    release: &ReleaseRecord,
) -> Result<(), ReleaseError> {
    if release.tag != LEGACY_FORMAT2_TAG || release.role != super::inventory::TargetRole::Server {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "imported legacy rollback record must be a server release".into(),
        });
    }

    let expected_release_path = layout.release_role_dir(LEGACY_FORMAT2_TAG, "server");
    let release_path = Path::new(&release.release_path);
    if release_path != expected_release_path {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "imported legacy release path is not canonical: expected {}, got {}",
                expected_release_path.display(),
                release_path.display()
            ),
        });
    }

    let binary_path = release_path.join("bin").join("dam-hopper-server");
    super::ownership::verify_path_permissions(&binary_path, 0o755, true)?;
    let binary_hash = hash_file(&binary_path)?;
    if binary_hash != release.manifest_sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: binary_path.display().to_string(),
            expected: release.manifest_sha256.clone(),
            got: binary_hash,
        });
    }

    let unit_hash =
        release
            .api_unit_sha256
            .as_ref()
            .ok_or_else(|| ReleaseError::LegacyMigrationRejected {
                reason: "imported legacy rollback record has no unit digest".into(),
            })?;
    let unit_path = release_path.join("systemd").join(LEGACY_FORMAT2_UNIT);
    validate_format2_unit(&unit_path, unit_hash, true)?;
    Ok(())
}

fn validate_installed_legacy_unit_and_wants(
    layout: &Layout,
    expected_unit_hash: &str,
) -> Result<(), ReleaseError> {
    let unit_path = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    validate_format2_unit(&unit_path, expected_unit_hash, true)?;

    let wants_path = layout
        .systemd_unit_dir
        .join("multi-user.target.wants")
        .join(LEGACY_FORMAT2_UNIT);
    let wants_meta = fs::symlink_metadata(&wants_path).map_err(|e| ReleaseError::Io {
        action: "stat imported legacy wants link",
        details: e.to_string(),
    })?;
    if !wants_meta.file_type().is_symlink() {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "imported legacy wants entry must be a symbolic link".into(),
        });
    }
    let wants_target = fs::read_link(&wants_path).map_err(|e| ReleaseError::Io {
        action: "read imported legacy wants link target",
        details: e.to_string(),
    })?;
    if !wants_target
        .to_string_lossy()
        .ends_with(LEGACY_FORMAT2_UNIT)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("imported legacy wants link does not target {LEGACY_FORMAT2_UNIT}"),
        });
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportedLegacyHealthResponse {
    schema_version: u32,
    status: String,
    version: String,
    role: String,
}

async fn probe_imported_legacy_health() -> Result<(), ReleaseError> {
    const MAX_BODY_BYTES: usize = 65_536;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| ReleaseError::Config(format!("failed to build legacy health client: {e}")))?;
    let url = format!("http://127.0.0.1:{LEGACY_FORMAT2_PORT}{API_SERVICE_HEALTH_PATH}");
    let response =
        client
            .get(&url)
            .send()
            .await
            .map_err(|e| ReleaseError::LegacyMigrationRejected {
                reason: format!("legacy health probe failed at {url}: {e}"),
            })?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health probe returned status {}", response.status()),
        });
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type.contains("application/json") {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health probe returned non-JSON Content-Type '{content_type}'"),
        });
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health response exceeds {MAX_BODY_BYTES} bytes"),
        });
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| ReleaseError::LegacyMigrationRejected {
            reason: format!("failed to read legacy health response: {e}"),
        })?;
        if body.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("legacy health response exceeds {MAX_BODY_BYTES} bytes"),
            });
        }
        body.extend_from_slice(&chunk);
    }
    let health: ImportedLegacyHealthResponse =
        serde_json::from_slice(&body).map_err(|e| ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health response is invalid JSON: {e}"),
        })?;
    if health.schema_version != 1 || health.role != "api" {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "legacy health response schema or role is invalid".into(),
        });
    }
    if health.status != "ok" || health.version.is_empty() {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "legacy health response is not an exact healthy API response".into(),
        });
    }
    Ok(())
}
/// Verify a committed imported format-2 release and, optionally, its live service.
pub(crate) async fn inspect_imported_legacy_installation(
    layout: &Layout,
    release: &ReleaseRecord,
    check_live_process: bool,
) -> Result<(), ReleaseError> {
    validate_imported_legacy_release(layout, release)?;
    let binary_path = layout.opt_dir.join("bin").join("dam-hopper-server");
    super::ownership::verify_path_permissions(&binary_path, 0o755, true)?;
    let imported_hash = hash_file(
        Path::new(&release.release_path)
            .join("bin")
            .join("dam-hopper-server")
            .as_path(),
    )?;
    let installed_hash = hash_file(&binary_path)?;
    if installed_hash != imported_hash {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: binary_path.display().to_string(),
            expected: imported_hash,
            got: installed_hash,
        });
    }

    let unit_hash =
        release
            .api_unit_sha256
            .as_ref()
            .ok_or_else(|| ReleaseError::LegacyMigrationRejected {
                reason: "imported legacy rollback record has no unit digest".into(),
            })?;
    validate_installed_legacy_unit_and_wants(layout, unit_hash)?;

    if !check_live_process {
        return Ok(());
    }
    if !systemctl_is_active(LEGACY_FORMAT2_UNIT)? {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("{LEGACY_FORMAT2_UNIT} is not active"),
        });
    }
    let process = inspect_service_process(LEGACY_FORMAT2_UNIT)?.ok_or_else(|| {
        ReleaseError::LegacyMigrationRejected {
            reason: format!("{LEGACY_FORMAT2_UNIT} has no active main process"),
        }
    })?;
    let user = get_user_by_name(LEGACY_FORMAT2_USER).ok_or_else(|| {
        ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy service user '{LEGACY_FORMAT2_USER}' does not exist"),
        }
    })?;
    if process.uid != user.uid || process.gid != user.gid {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "legacy process identity mismatch: expected {}:{}, got {}:{}",
                user.uid, user.gid, process.uid, process.gid
            ),
        });
    }
    if process.exe_path.as_deref() != Some(binary_path.as_path()) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "legacy process executable mismatch: expected {}, got {:?}",
                binary_path.display(),
                process.exe_path
            ),
        });
    }
    if !is_port_listening_wildcard(LEGACY_FORMAT2_PORT)? {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("port {LEGACY_FORMAT2_PORT} is not listening on wildcard address"),
        });
    }
    check_ports_free(&[4800, 4802])?;
    probe_imported_legacy_health().await
}

/// Automatic rollback on candidate activation failure: restores `state.active` or clean baseline.
pub async fn rollback_activation_failure(
    layout: &Layout,
    reason: &str,
) -> Result<(), ReleaseError> {
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;
    // Case 1: First-install baseline restoration
    if state.active.is_none() {
        for &unit in ALL_SERVICE_UNITS {
            let _ = super::systemd::systemctl_stop(unit);
            let _ = super::systemd::disable_if_enabled(unit);
        }
        let _ = super::process::terminate_stray_listeners(&[
            super::constants::API_SERVICE_PORT,
            super::constants::WEB_SERVICE_PORT,
        ]);
        if let Some(tx) = state.transaction.clone() {
            if let Some(ref mig) = tx.migration {
                stop_and_disable_units(ALL_SERVICE_UNITS, &layout.systemd_unit_dir)?;
                super::migration::rollback_migration_exchange(layout, mig)?;
                state.transaction = None;
                state.latest_failure = Some(FailureRecord {
                    failed_at: Utc::now().to_rfc3339(),
                    tx_id: Some(tx.tx_id.clone()),
                    target_tag: state.pending.as_ref().map(|p| p.tag.clone()),
                    phase: "ROLLED_BACK_MIGRATION".into(),
                    sanitized_error: reason.to_string(),
                });
                save_manager_state(&layout.manager_state_path(), &mut state)?;
                return Ok(());
            }
        }
        match fs::symlink_metadata(layout.current_link()) {
            Ok(_) => fs::remove_file(layout.current_link()).map_err(|e| ReleaseError::Io {
                action: "remove current release symlink",
                details: e.to_string(),
            })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect current release symlink",
                    details: error.to_string(),
                });
            }
        }
        match fs::symlink_metadata(layout.host_config_json_path()) {
            Ok(_) => {
                fs::remove_file(layout.host_config_json_path()).map_err(|e| ReleaseError::Io {
                    action: "remove public host configuration",
                    details: e.to_string(),
                })?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect public host configuration",
                    details: error.to_string(),
                });
            }
        }
        state.transaction = None;
        state.latest_failure = Some(FailureRecord {
            failed_at: Utc::now().to_rfc3339(),
            tx_id: None,
            target_tag: state.pending.as_ref().map(|p| p.tag.clone()),
            phase: "ROLLBACK_FIRST_INSTALL_BASELINE".into(),
            sanitized_error: reason.to_string(),
        });
        save_manager_state(&layout.manager_state_path(), &mut state)?;
        return Ok(());
    }

    // Case 2: Restore currently active release from backups
    let active = state.active.clone().unwrap();
    for &unit in ALL_SERVICE_UNITS {
        let _ = systemctl_stop(unit);
    }
    let _ = super::process::terminate_stray_listeners(&[
        super::constants::API_SERVICE_PORT,
        super::constants::WEB_SERVICE_PORT,
    ]);

    if let Some(tx) = &state.transaction {
        if let Some(bkp) = &tx.units_backup_dir {
            let p = Path::new(bkp);
            match fs::symlink_metadata(p) {
                Ok(meta) if meta.file_type().is_dir() => {
                    restore_unit_files(p, &layout.systemd_unit_dir)?;
                }
                Ok(_) => {
                    return Err(ReleaseError::OwnershipViolation {
                        path: p.display().to_string(),
                        expected: "regular unit backup directory".into(),
                        got: "symbolic link or non-directory".into(),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(ReleaseError::Io {
                        action: "inspect unit backup directory",
                        details: error.to_string(),
                    });
                }
            }
        }
        if let Some(bkp) = &tx.public_config_backup_path {
            let p = Path::new(bkp);
            match fs::symlink_metadata(p) {
                Ok(meta) if meta.file_type().is_file() => {
                    copy_file_durable(p, &layout.host_config_json_path(), Some(0o644))?;
                }
                Ok(_) => {
                    return Err(ReleaseError::OwnershipViolation {
                        path: p.display().to_string(),
                        expected: "regular public configuration backup".into(),
                        got: "symbolic link or non-regular file".into(),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(ReleaseError::Io {
                        action: "inspect public configuration backup",
                        details: error.to_string(),
                    });
                }
            }
        }
    }
    systemctl_daemon_reload()?;
    systemctl_enable(RECOVERY_SERVICE_UNIT)?;

    if active.role.includes_server() {
        systemctl_start("dam-hopper-api.service")?;
    }
    if active.role.includes_web() {
        systemctl_start("dam-hopper-web.service")?;
    }

    let cand = release_to_candidate(&active);
    let targets = build_candidate_health_targets(&cand)?;
    if let Err(e) = wait_for_health_stability(
        &targets,
        DEFAULT_STARTUP_DEADLINE,
        DEFAULT_REQUIRED_CONSECUTIVE,
        DEFAULT_PROBE_INTERVAL,
    )
    .await
    {
        if let Some(ref mut tx) = state.transaction {
            tx.phase = TransactionPhase::Failed;
        }
        state.latest_failure = Some(FailureRecord {
            failed_at: Utc::now().to_rfc3339(),
            tx_id: state.transaction.as_ref().map(|t| t.tx_id.clone()),
            target_tag: Some(active.tag.clone()),
            phase: "RECOVERY_REQUIRED".into(),
            sanitized_error: format!("restoration of active release failed: {e}"),
        });
        save_manager_state(&layout.manager_state_path(), &mut state)?;
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: format!("restoration of active release failed (RECOVERY_REQUIRED): {e}"),
        });
    }

    state.transaction = None;
    state.latest_failure = Some(FailureRecord {
        failed_at: Utc::now().to_rfc3339(),
        tx_id: None,
        target_tag: state.pending.as_ref().map(|p| p.tag.clone()),
        phase: "ROLLED_BACK_TO_ACTIVE".into(),
        sanitized_error: reason.to_string(),
    });
    save_manager_state(&layout.manager_state_path(), &mut state)?;
    atomic_symlink(Path::new(&active.release_path), &layout.current_link())?;
    Ok(())
}

/// Manual rollback to recorded previous release.
pub async fn execute_manual_rollback(layout: &Layout) -> Result<(), ReleaseError> {
    let _lock = DeploymentLock::acquire(&layout.deploy_lock_path())?;
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;
    let prev = state.previous.clone().ok_or_else(|| {
        ReleaseError::Config("no previous release recorded for manual rollback".into())
    })?;

    if prev.tag == LEGACY_FORMAT2_TAG {
        validate_imported_legacy_release(layout, &prev)?;

        let target_unit = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
        let target_wants = layout
            .systemd_unit_dir
            .join("multi-user.target.wants")
            .join(LEGACY_FORMAT2_UNIT);
        match fs::symlink_metadata(&target_wants) {
            Ok(meta) if meta.file_type().is_symlink() => {
                let target = fs::read_link(&target_wants).map_err(|e| ReleaseError::Io {
                    action: "read existing legacy wants link",
                    details: e.to_string(),
                })?;
                if !target.to_string_lossy().ends_with(LEGACY_FORMAT2_UNIT) {
                    return Err(ReleaseError::LegacyMigrationRejected {
                        reason: format!(
                            "existing legacy wants link does not target {LEGACY_FORMAT2_UNIT}"
                        ),
                    });
                }
            }
            Ok(_) => {
                return Err(ReleaseError::OwnershipViolation {
                    path: target_wants.display().to_string(),
                    expected: "symbolic link to legacy unit".into(),
                    got: "non-symbolic link entry".into(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect existing legacy wants link",
                    details: error.to_string(),
                });
            }
        }

        if systemctl_is_active(LEGACY_FORMAT2_UNIT)? {
            systemctl_stop(LEGACY_FORMAT2_UNIT)?;
        }
        if systemctl_is_enabled(LEGACY_FORMAT2_UNIT)? {
            systemctl_disable(LEGACY_FORMAT2_UNIT)?;
        }
        stop_and_disable_units(ALL_SERVICE_UNITS, &layout.systemd_unit_dir)?;
        remove_unit_file(LEGACY_FORMAT2_UNIT, &layout.systemd_unit_dir)?;

        let release_path = Path::new(&prev.release_path);
        let legacy_unit_src = release_path.join("systemd").join(LEGACY_FORMAT2_UNIT);
        let legacy_bin_src = release_path.join("bin").join("dam-hopper-server");
        copy_file_durable(&legacy_unit_src, &target_unit, Some(0o644))?;

        let bin_parent = layout.opt_dir.join("bin");
        fs::create_dir_all(&bin_parent).map_err(|e| ReleaseError::Io {
            action: "create legacy rollback bin directory",
            details: e.to_string(),
        })?;
        copy_file_durable(
            &legacy_bin_src,
            &bin_parent.join("dam-hopper-server"),
            Some(0o755),
        )?;

        match fs::symlink_metadata(&target_wants) {
            Ok(meta) if meta.file_type().is_symlink() => {
                let target = fs::read_link(&target_wants).map_err(|e| ReleaseError::Io {
                    action: "read recreated legacy wants link",
                    details: e.to_string(),
                })?;
                if !target.to_string_lossy().ends_with(LEGACY_FORMAT2_UNIT) {
                    return Err(ReleaseError::LegacyMigrationRejected {
                        reason: format!(
                            "recreated legacy wants link does not target {LEGACY_FORMAT2_UNIT}"
                        ),
                    });
                }
            }
            Ok(_) => {
                return Err(ReleaseError::OwnershipViolation {
                    path: target_wants.display().to_string(),
                    expected: "symbolic link to legacy unit".into(),
                    got: "non-symbolic link entry".into(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Some(parent) = target_wants.parent() {
                    fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
                        action: "create legacy rollback wants directory",
                        details: e.to_string(),
                    })?;
                }
                std::os::unix::fs::symlink(&target_unit, &target_wants).map_err(|e| {
                    ReleaseError::Io {
                        action: "create legacy rollback wants link",
                        details: e.to_string(),
                    }
                })?;
            }
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect recreated legacy wants link",
                    details: error.to_string(),
                });
            }
        }

        let unit_hash = prev.api_unit_sha256.as_deref().ok_or_else(|| {
            ReleaseError::LegacyMigrationRejected {
                reason: "imported legacy rollback record has no unit digest".into(),
            }
        })?;
        validate_installed_legacy_unit_and_wants(layout, unit_hash)?;
        systemctl_daemon_reload()?;
        systemctl_enable(LEGACY_FORMAT2_UNIT)?;
        systemctl_start(LEGACY_FORMAT2_UNIT)?;
        inspect_imported_legacy_installation(layout, &prev, true).await?;

        let old_active = state.active.take();
        state.previous = old_active;
        state.active = Some(prev.clone());
        state.pending = None;
        state.transaction = None;
        if let Err(error) = save_manager_state(&layout.manager_state_path(), &mut state) {
            return Err(ReleaseError::Config(format!(
                "legacy rollback service was verified but state persistence failed: {error}; RECOVERY_REQUIRED"
            )));
        }
        atomic_symlink(Path::new(&prev.release_path), &layout.current_link())?;
        return Ok(());
    }

    let cand = stage_previous_release_candidate(layout, &prev)?;
    state.pending = Some(cand);
    save_manager_state(&layout.manager_state_path(), &mut state)?;
    super::activate::execute_activation_locked(layout, &_lock).await
}
