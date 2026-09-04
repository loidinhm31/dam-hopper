//! Orchestration engine for candidate release activation and ordinary startup.

use super::activate_preflight::{
    build_candidate_health_targets, validate_active_preflight, validate_candidate_preflight,
};
use super::account::verify_web_sysuser_account;
use super::constants::{ALL_SERVICE_UNITS, API_SERVICE_UNIT, RECOVERY_SERVICE_UNIT, WEB_SERVICE_UNIT};
use super::durable_fs::{atomic_symlink, copy_file_durable};
use super::error::ReleaseError;
use super::health::{wait_for_health_stability, DEFAULT_PROBE_INTERVAL, DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_STARTUP_DEADLINE};
use super::journal::DeploymentState;
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::process::inspect_service_process;
use super::rollback::rollback_activation_failure;
use super::state::{load_or_init_manager_state, save_manager_state, ManagerState};
use super::state_record::{PendingCandidateRecord, ReleaseRecord, TransactionPhase};
use super::systemd::{
    backup_unit_files, disable_if_enabled, install_unit_file, systemctl_daemon_reload,
    systemctl_enable, systemctl_is_active, systemctl_start, systemctl_stop, systemd_sysusers,
};
use super::transaction::ActivationTransaction;
use chrono::Utc;
use std::fs;
use std::path::Path;

pub async fn execute_activation(layout: &Layout) -> Result<(), ReleaseError> {
    let lock = DeploymentLock::acquire(&layout.deploy_lock_path())?;
    execute_activation_locked(layout, &lock).await
}

pub async fn execute_activation_locked(
    layout: &Layout,
    _lock: &DeploymentLock,
) -> Result<(), ReleaseError> {
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;

    let mut allowed_sqlite_pids = Vec::new();
    match inspect_service_process("dam-hopper-api.service")? {
        Some(ev) if ev.pid > 0 => allowed_sqlite_pids.push(ev.pid),
        _ => {}
    }

    let candidate = match state.pending.clone() {
        Some(candidate) => candidate,
        None => {
            let active = state.active.as_ref().ok_or_else(|| {
                ReleaseError::Config("no active release or pending candidate to start".into())
            })?;
            let active_candidate = PendingCandidateRecord {
                tag: active.tag.clone(),
                role: active.role,
                staged_at: active.installed_at.clone(),
                release_path: active.release_path.clone(),
                manifest_sha256: active.manifest_sha256.clone(),
                archive_sha256: active.archive_sha256.clone(),
                pending_units_path: None,
                pending_host_config_path: None,
                api_unit_sha256: active.api_unit_sha256.clone(),
                web_unit_sha256: active.web_unit_sha256.clone(),
                host_config_sha256: active.host_config_sha256.clone(),
            };
            if active_candidate.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
                let active_record = active.clone();
                super::rollback::inspect_imported_legacy_installation(
                    layout,
                    &active_record,
                    false,
                )
                .await?;
                systemctl_start(super::legacy_format2::LEGACY_FORMAT2_UNIT)?;
                super::rollback::inspect_imported_legacy_installation(
                    layout,
                    &active_record,
                    true,
                )
                .await?;
                return Ok(());
            }
            validate_active_preflight(layout, &active_candidate, &allowed_sqlite_pids)?;
            if active_candidate.role.includes_server() {
                systemctl_start("dam-hopper-api.service")?;
            }
            if active_candidate.role.includes_web() {
                super::systemd::systemd_sysusers(
                    &layout.sysusers_conf_path(),
                    None,
                )?;
                super::account::verify_web_sysuser_account(
                    super::constants::WEB_SERVICE_IDENTITY,
                )?;
                systemctl_start("dam-hopper-web.service")?;
            }
            let targets = build_candidate_health_targets(&active_candidate)?;
            wait_for_health_stability(
                &targets,
                DEFAULT_STARTUP_DEADLINE,
                DEFAULT_REQUIRED_CONSECUTIVE,
                DEFAULT_PROBE_INTERVAL,
            )
            .await?;
            return Ok(());
        }
    };

    validate_candidate_preflight(layout, &candidate, &allowed_sqlite_pids)?;

    let tx = if let Some(ref existing) = state.transaction {
        ActivationTransaction::from_id(layout, &existing.tx_id)?
    } else {
        ActivationTransaction::new(layout)?
    };
    tx.record_phase(layout, &mut state, DeploymentState::Quiesced, TransactionPhase::Quiesced)?;
    let migration = state
        .transaction
        .as_ref()
        .and_then(|transaction| transaction.migration.clone());
    let pipeline_res = execute_activation_pipeline(layout, &tx, &candidate, &mut state).await;

    if let Err(err) = pipeline_res {
        let err_msg = err.to_string();
        let failure_record_error = tx
            .record_failure(layout, &mut state, "ACTIVATION_FAILED", &err_msg)
            .err();

        match rollback_activation_failure(layout, &err_msg).await {
            Ok(()) => {
                if let Some(record_error) = failure_record_error {
                    return Err(ReleaseError::Config(format!(
                        "activation failed ({err_msg}); successfully rolled back, but failure state persistence failed ({record_error})"
                    )));
                }
                return Err(ReleaseError::ProcessInspectionFailed {
                    reason: format!("activation failed ({err_msg}); successfully rolled back"),
                });
            }
            Err(rollback_err) => {
                let record_suffix = failure_record_error
                    .map(|record_error| format!("; failure state persistence also failed ({record_error})"))
                    .unwrap_or_default();
                return Err(ReleaseError::Config(format!(
                    "CRITICAL: activation failed ({err_msg}) AND rollback failed ({rollback_err}){record_suffix}: RECOVERY_REQUIRED"
                )));
            }
        }
    }

    if let Some(ref migration) = migration {
        if let Err(error) = super::migration::commit_migration_cleanup(layout, migration) {
            state.latest_failure = Some(super::state_record::FailureRecord {
                failed_at: Utc::now().to_rfc3339(),
                tx_id: None,
                target_tag: state.active.as_ref().map(|active| active.tag.clone()),
                phase: "COMMITTED_MIGRATION_CLEANUP".into(),
                sanitized_error: error.to_string(),
            });
            let persistence_error = save_manager_state(&layout.manager_state_path(), &mut state)
                .err()
                .map(|save_error| format!("; failure state persistence also failed ({save_error})"))
                .unwrap_or_default();
            return Err(ReleaseError::Config(format!(
                "activation committed but migration cleanup failed ({error}){persistence_error}: RECOVERY_REQUIRED"
            )));
        }
    }

    // Post-commit convenience pointer repair and retention (release is already durably committed)
    let active_release_path = state
        .active
        .as_ref()
        .ok_or_else(|| ReleaseError::Config("activation committed without an active release".into()))?
        .release_path
        .clone();
    atomic_symlink(Path::new(&active_release_path), &layout.current_link())?;
    super::retention::apply_retention(layout, &state)?;
    Ok(())
}

async fn execute_activation_pipeline(
    layout: &Layout,
    tx: &ActivationTransaction,
    candidate: &PendingCandidateRecord,
    state: &mut ManagerState,
) -> Result<(), ReleaseError> {
    let is_migration = state
        .transaction
        .as_ref()
        .map(|transaction| transaction.migration.is_some())
        .unwrap_or(false);
    if is_migration {
        // Capture the exact live format-2 evidence before any stop or unit mutation.
        super::legacy_format2::inspect_format2_installation(layout, true, true).await?;
    }

    for &unit in ALL_SERVICE_UNITS {
        if systemctl_is_active(unit)? {
            systemctl_stop(unit)?;
        }
    }
    if systemctl_is_active(super::legacy_format2::LEGACY_FORMAT2_UNIT)? {
        systemctl_stop(super::legacy_format2::LEGACY_FORMAT2_UNIT)?;
    }

    backup_unit_files(ALL_SERVICE_UNITS, &layout.systemd_unit_dir, &tx.units_backup_dir)?;
    let legacy_unit_path = layout.systemd_unit_dir.join(super::legacy_format2::LEGACY_FORMAT2_UNIT);
    match fs::symlink_metadata(&legacy_unit_path) {
        Ok(_) => copy_file_durable(
            &legacy_unit_path,
            &tx.units_backup_dir.join(super::legacy_format2::LEGACY_FORMAT2_UNIT),
            Some(0o644),
        )?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect legacy systemd unit before backup",
                details: error.to_string(),
            });
        }
    }
    let mut runtime_candidate = candidate.clone();
    if is_migration {
        if let Some(transaction) = &mut state.transaction {
            if let Some(migration) = &mut transaction.migration {
                super::migration::execute_migration_exchange(layout, migration)?;
                runtime_candidate.release_path = layout
                    .release_role_dir(&runtime_candidate.tag, runtime_candidate.role.as_str())
                    .display()
                    .to_string();
                state.pending = Some(runtime_candidate.clone());
                save_manager_state(&layout.manager_state_path(), state)?;
            }
        }
        let legacy_unit = layout
            .systemd_unit_dir
            .join(super::legacy_format2::LEGACY_FORMAT2_UNIT);
        match fs::symlink_metadata(&legacy_unit) {
            Ok(_) => {
                fs::remove_file(&legacy_unit).map_err(|e| ReleaseError::Io {
                    action: "remove legacy systemd unit",
                    details: e.to_string(),
                })?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect legacy systemd unit before removal",
                    details: error.to_string(),
                });
            }
        }
        let legacy_wants = layout
            .systemd_unit_dir
            .join("multi-user.target.wants")
            .join(super::legacy_format2::LEGACY_FORMAT2_UNIT);
        match fs::symlink_metadata(&legacy_wants) {
            Ok(_) => {
                fs::remove_file(&legacy_wants).map_err(|e| ReleaseError::Io {
                    action: "remove legacy systemd wants link",
                    details: e.to_string(),
                })?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect legacy systemd wants link before removal",
                    details: error.to_string(),
                });
            }
        }
    }

    let candidate = &runtime_candidate;
    let units_path = candidate.pending_units_path.as_deref().ok_or_else(|| {
        ReleaseError::Config("pending candidate has no rendered unit directory".to_string())
    })?;
    let entries = fs::read_dir(units_path).map_err(|e| ReleaseError::Io {
        action: "read pending units dir",
        details: e.to_string(),
    })?;
    for entry_result in entries {
        let entry = entry_result.map_err(|e| ReleaseError::Io {
            action: "iterate pending units directory",
            details: e.to_string(),
        })?;
        let path = entry.path();
        if !entry.file_type().map_err(|e| ReleaseError::Io {
            action: "inspect pending unit entry",
            details: e.to_string(),
        })?.is_file() {
            return Err(ReleaseError::InvalidBundle {
                path: path.display().to_string(),
                reason: "pending unit entry must be a regular file".to_string(),
            });
        }
        match entry.file_name().to_string_lossy().as_ref() {
            API_SERVICE_UNIT | WEB_SERVICE_UNIT | RECOVERY_SERVICE_UNIT => {
                install_unit_file(&path, &layout.systemd_unit_dir)?;
            }
            "dam-hopper-web.conf" if candidate.role.includes_web() => {
                copy_file_durable(&path, &layout.sysusers_conf_path(), Some(0o644))?;
            }
            name => {
                return Err(ReleaseError::InvalidBundle {
                    path: path.display().to_string(),
                    reason: format!("unexpected pending unit entry '{name}'"),
                });
            }
        }
    }

    if candidate.role.includes_web() {
        systemd_sysusers(&layout.sysusers_conf_path(), None)?;
        verify_web_sysuser_account(super::constants::WEB_SERVICE_IDENTITY)?;
    }

    match fs::symlink_metadata(&layout.host_config_json_path()) {
        Ok(_) => copy_file_durable(
            &layout.host_config_json_path(),
            &tx.public_config_backup_path,
            Some(0o644),
        )?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect active public host config",
                details: error.to_string(),
            });
        }
    }

    let config_path = candidate.pending_host_config_path.as_deref().ok_or_else(|| {
        ReleaseError::Config("pending candidate has no public host configuration".to_string())
    })?;
    match fs::symlink_metadata(config_path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ReleaseError::InvalidBundle {
                path: config_path.to_string(),
                reason: "pending public host configuration is missing".to_string(),
            });
        }
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect pending public host configuration",
                details: error.to_string(),
            });
        }
    }
    copy_file_durable(
        Path::new(config_path),
        &layout.host_config_json_path(),
        Some(0o644),
    )?;

    systemctl_daemon_reload()?;
    tx.record_phase(layout, state, DeploymentState::Switched, TransactionPhase::Switched)?;

    if candidate.role.includes_server() {
        systemctl_start(API_SERVICE_UNIT)?;
    }
    if candidate.role.includes_web() {
        systemctl_start(WEB_SERVICE_UNIT)?;
    }

    tx.record_phase(layout, state, DeploymentState::Probing, TransactionPhase::Probing)?;

    let targets = build_candidate_health_targets(candidate)?;
    wait_for_health_stability(&targets, DEFAULT_STARTUP_DEADLINE, DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_PROBE_INTERVAL).await?;

    // Enable/disable units, propagating any failure
    if candidate.role.includes_server() {
        systemctl_enable(API_SERVICE_UNIT)?;
    } else {
        disable_if_enabled(API_SERVICE_UNIT)?;
    }
    systemctl_enable(RECOVERY_SERVICE_UNIT)?;


    if candidate.role.includes_web() {
        systemctl_enable(WEB_SERVICE_UNIT)?;
    } else {
        disable_if_enabled(WEB_SERVICE_UNIT)?;
    }

    let mig_opt = state.transaction.as_ref().and_then(|t| t.migration.clone());
    if let Some(ref mig) = mig_opt {
        state.previous = Some(ReleaseRecord {
            tag: super::legacy_format2::LEGACY_FORMAT2_TAG.to_string(),
            version: mig
                .legacy_api_version
                .clone()
                .unwrap_or_else(|| "format-2-imported".to_string()),
            role: super::inventory::TargetRole::Server,
            release_path: layout
                .releases_dir()
                .join(super::legacy_format2::LEGACY_FORMAT2_TAG)
                .join("server")
                .display()
                .to_string(),
            manifest_sha256: mig.legacy_binary_sha256.clone(),
            archive_sha256: mig.legacy_binary_sha256.clone(),
            installed_at: candidate.staged_at.clone(),
            committed_at: Utc::now().to_rfc3339(),
            api_unit_sha256: Some(mig.legacy_unit_sha256.clone()),
            web_unit_sha256: None,
            host_config_sha256: None,
        });
    } else {
        state.previous = state.active.take();
    }

    let canonical_release_path = layout
        .releases_dir()
        .join(&candidate.tag)
        .join(candidate.role.to_string())
        .display()
        .to_string();
    state.active = Some(ReleaseRecord {
        tag: candidate.tag.clone(),
        version: candidate.tag.trim_start_matches('v').to_string(),
        role: candidate.role,
        release_path: canonical_release_path,
        manifest_sha256: candidate.manifest_sha256.clone(),
        archive_sha256: candidate.archive_sha256.clone(),
        installed_at: candidate.staged_at.clone(),
        committed_at: Utc::now().to_rfc3339(),
        api_unit_sha256: candidate.api_unit_sha256.clone(),
        web_unit_sha256: candidate.web_unit_sha256.clone(),
        host_config_sha256: candidate.host_config_sha256.clone(),
    });
    state.pending = None;
    state.transaction = None;

    save_manager_state(&layout.manager_state_path(), state)?;


    Ok(())
}
