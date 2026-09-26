//! Orchestration engine for candidate release activation and ordinary startup.

use super::account::verify_web_sysuser_account;
use super::activate_preflight::{
    build_candidate_health_targets, validate_active_preflight, validate_candidate_preflight,
};
use super::api_runtime::provision_and_start_api;
use super::constants::{
    ALL_SERVICE_UNITS, API_SERVICE_UNIT, HELPER_SERVICE_UNIT, RECOVERY_SERVICE_UNIT,
    RUNNER_SERVICE_UNIT, RUNNER_TMPFILES_CONF, WEB_SERVICE_UNIT,
};
use super::durable_fs::{atomic_symlink, copy_file_durable};
use super::error::ReleaseError;
use super::health::{
    wait_for_health_stability, DEFAULT_PROBE_INTERVAL, DEFAULT_REQUIRED_CONSECUTIVE,
    DEFAULT_STARTUP_DEADLINE,
};
use super::journal::DeploymentState;
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::process::inspect_service_process;
use super::rollback::rollback_activation_failure;
use super::stage_units::stage_candidate_units_for_release_with_identity;
use super::state::{load_or_init_manager_state, save_manager_state, ManagerState};
use super::state_record::{PendingCandidateRecord, ReleaseRecord, TransactionPhase};
use super::systemd::{
    backup_unit_files, disable_if_enabled, install_unit_file, systemctl_daemon_reload,
    systemctl_enable, systemctl_start, systemctl_stop, systemd_sysusers,
};
use super::transaction::ActivationTransaction;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub(crate) fn provision_plugin_runtime(layout: &Layout) -> Result<(), ReleaseError> {
    let runner_path = layout.systemd_unit_dir.join(RUNNER_SERVICE_UNIT);
    if !runner_path.try_exists().map_err(|error| ReleaseError::Io {
        action: "inspect installed plugin runner unit",
        details: error.to_string(),
    })? {
        return Ok(());
    }
    let read_unit = |path: &Path| -> Result<super::unit_parser::ParsedUnit, ReleaseError> {
        let content = fs::read_to_string(path).map_err(|error| ReleaseError::Io {
            action: "read plugin runtime identity",
            details: format!("{}: {error}", path.display()),
        })?;
        super::unit_parser::ParsedUnit::parse(&content)
    };
    let api = super::account::resolve_api_runtime_identity(&read_unit(
        &layout.systemd_unit_dir.join(API_SERVICE_UNIT),
    )?)?;
    let runner = read_unit(&runner_path)?;
    let identity = super::account::resolve_api_runtime_identity(&runner)?;
    super::account::ensure_plugin_runner_state(&identity.user, &api.user)?;
    let host_config = super::host_config::load_host_config(&layout.host_config_path())?;
    let subjects = host_config
        .as_ref()
        .map(|config| config.plugin_admin_subjects.as_slice())
        .unwrap_or_default();
    super::account::sync_plugin_admins_file(&layout.etc_dir.join("plugin-admins.json"), subjects)?;
    super::systemd::systemd_tmpfiles_create(&layout.runner_tmpfiles_conf_path(), None)?;
    Ok(())
}

pub(crate) async fn verify_started_plugin_runner(layout: &Layout) -> Result<(), ReleaseError> {
    let path = layout.systemd_unit_dir.join(RUNNER_SERVICE_UNIT);
    if !path.try_exists().map_err(|error| ReleaseError::Io {
        action: "inspect plugin runner health unit",
        details: error.to_string(),
    })? {
        return Ok(());
    }
    if !super::systemd::systemctl_is_active(RUNNER_SERVICE_UNIT)? {
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: "plugin runner service is not active after API health stabilization".into(),
        });
    }
    let content = fs::read_to_string(path).map_err(|error| ReleaseError::Io {
        action: "read plugin runner health identity",
        details: error.to_string(),
    })?;
    let identity = super::account::resolve_api_runtime_identity(
        &super::unit_parser::ParsedUnit::parse(&content)?,
    )?;
    let socket = layout
        .trusted_root()
        .join(super::constants::DEFAULT_RUNNER_SOCKET_PATH.trim_start_matches('/'));
    match super::health::probe_runner_health(&socket, Some(identity.uid)).await {
        super::health::HttpProbeOutcome::Success => Ok(()),
        super::health::HttpProbeOutcome::Transient(reason)
        | super::health::HttpProbeOutcome::Fatal(reason) => {
            Err(ReleaseError::ProcessInspectionFailed { reason })
        }
    }
}

pub async fn execute_activation(layout: &Layout) -> Result<(), ReleaseError> {
    execute_activation_with_args(layout, &super::cli::StartArgs::default()).await
}

pub async fn execute_activation_with_args(
    layout: &Layout,
    args: &super::cli::StartArgs,
) -> Result<(), ReleaseError> {
    let lock = DeploymentLock::acquire(&layout.deploy_lock_path())?;
    execute_activation_locked_with_args(layout, &lock, args).await
}

pub async fn execute_activation_locked(
    layout: &Layout,
    lock: &DeploymentLock,
) -> Result<(), ReleaseError> {
    execute_activation_locked_with_args(layout, lock, &super::cli::StartArgs::default()).await
}

pub async fn execute_activation_locked_with_args(
    layout: &Layout,
    _lock: &DeploymentLock,
    args: &super::cli::StartArgs,
) -> Result<(), ReleaseError> {
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;

    let mut allowed_sqlite_pids = Vec::new();
    match inspect_service_process("dam-hopper-api.service")? {
        Some(ev) if ev.pid > 0 => allowed_sqlite_pids.push(ev.pid),
        _ => {}
    }

    let mut identity_override = None;
    let mut identity_already_staged = false;
    let mut candidate = match state.pending.clone() {
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
                helper_unit_sha256: active.helper_unit_sha256.clone(),
                runner_unit_sha256: active.runner_unit_sha256.clone(),
                runner_tmpfiles_sha256: active.runner_tmpfiles_sha256.clone(),
                plugin_owner_user: active.plugin_owner_user.clone(),
                plugin_owner_uid: active.plugin_owner_uid,
                plugin_admin_config_sha256: active.plugin_admin_config_sha256.clone(),
                plugin_runtime_node_version: active.plugin_runtime_node_version.clone(),
                plugin_runtime_node_sha256: active.plugin_runtime_node_sha256.clone(),
                plugin_platform_enabled: active.plugin_platform_enabled,
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
                super::rollback::inspect_imported_legacy_installation(layout, &active_record, true)
                    .await?;
                return Ok(());
            }

            let restage_for_override = if active_candidate.role.includes_server() {
                match args.service_user.as_deref() {
                    Some(_) => true,
                    None => {
                        let unit_path = layout.systemd_unit_dir.join(API_SERVICE_UNIT);
                        let content =
                            fs::read_to_string(&unit_path).map_err(|error| ReleaseError::Io {
                                action: "read installed API unit",
                                details: error.to_string(),
                            })?;
                        let parsed = super::unit_parser::ParsedUnit::parse(&content)?;
                        super::account::resolve_api_runtime_identity(&parsed)?;
                        false
                    }
                }
            } else {
                false
            };

            if restage_for_override {
                let requested = args.service_user.as_deref().ok_or_else(|| {
                    ReleaseError::Config("service-user override unexpectedly missing".into())
                })?;
                let staged =
                    stage_service_user_override_candidate(layout, &active_candidate, requested)?;
                state.pending = Some(staged.clone());
                save_manager_state(&layout.manager_state_path(), &mut state)?;
                identity_override = Some(requested.trim().to_string());
                identity_already_staged = true;
                staged
            } else {
                validate_active_preflight(layout, &active_candidate, &allowed_sqlite_pids)?;
                let targets = build_candidate_health_targets(layout, &active_candidate)?;
                if active_candidate.role.includes_server() {
                    provision_plugin_runtime(layout)?;
                    if layout.systemd_unit_dir.join(RUNNER_SERVICE_UNIT).exists() {
                        systemctl_start(RUNNER_SERVICE_UNIT)?;
                    }
                    if let Err(e) = systemctl_start(HELPER_SERVICE_UNIT) {
                        tracing::warn!(
                            "idle-suspend helper service startup failed (continuing API startup): {e}"
                        );
                    }
                    provision_and_start_api(
                        layout,
                        &layout.systemd_unit_dir.join(API_SERVICE_UNIT),
                        || systemctl_start(API_SERVICE_UNIT),
                    )?;
                }
                if active_candidate.role.includes_web() {
                    super::systemd::systemd_sysusers(&layout.sysusers_conf_path(), None)?;
                    super::account::verify_web_sysuser_account(
                        super::constants::WEB_SERVICE_IDENTITY,
                    )?;
                    systemctl_start("dam-hopper-web.service")?;
                }
                wait_for_health_stability(
                    &targets,
                    DEFAULT_STARTUP_DEADLINE,
                    DEFAULT_REQUIRED_CONSECUTIVE,
                    DEFAULT_PROBE_INTERVAL,
                )
                .await?;
                if active_candidate.role.includes_server() {
                    verify_started_plugin_runner(layout).await?;
                }
                return Ok(());
            }
        }
    };
    if candidate.role.includes_server() {
        let units_dir = candidate
            .pending_units_path
            .as_deref()
            .map(Path::new)
            .ok_or_else(|| {
                ReleaseError::Config("pending candidate has no API unit directory".into())
            })?;
        if let Some(requested) = args.service_user.as_deref() {
            if !identity_already_staged {
                candidate = stage_service_user_override_candidate(layout, &candidate, requested)?;
                state.pending = Some(candidate.clone());
                save_manager_state(&layout.manager_state_path(), &mut state)?;
                identity_override = Some(requested.trim().to_string());
            }
            let api_unit_path = candidate
                .pending_units_path
                .as_deref()
                .map(Path::new)
                .ok_or_else(|| {
                    ReleaseError::Config("staged candidate has no API unit directory".into())
                })?
                .join(API_SERVICE_UNIT);
            let content = fs::read_to_string(&api_unit_path).map_err(|e| ReleaseError::Io {
                action: "read finalized pending API unit",
                details: e.to_string(),
            })?;
            super::account::resolve_api_runtime_identity(&super::unit_parser::ParsedUnit::parse(
                &content,
            )?)?;
        } else {
            let api_unit_path = units_dir.join(API_SERVICE_UNIT);
            let content = fs::read_to_string(&api_unit_path).map_err(|e| ReleaseError::Io {
                action: "read pending API unit",
                details: e.to_string(),
            })?;
            super::account::resolve_api_runtime_identity(&super::unit_parser::ParsedUnit::parse(
                &content,
            )?)?;
        }
    }

    validate_candidate_preflight(layout, &candidate, &allowed_sqlite_pids)?;

    let tx = if let Some(ref existing) = state.transaction {
        ActivationTransaction::from_id(layout, &existing.tx_id)?
    } else {
        ActivationTransaction::new(layout)?
    };
    tx.record_phase(
        layout,
        &mut state,
        DeploymentState::Quiesced,
        TransactionPhase::Quiesced,
    )?;
    let migration = state
        .transaction
        .as_ref()
        .and_then(|transaction| transaction.migration.clone());
    let pipeline_res = execute_activation_pipeline(
        layout,
        &tx,
        &candidate,
        &mut state,
        identity_override.as_deref(),
    )
    .await;

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
                    .map(|record_error| {
                        format!("; failure state persistence also failed ({record_error})")
                    })
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
        .ok_or_else(|| {
            ReleaseError::Config("activation committed without an active release".into())
        })?
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
    service_user_override: Option<&str>,
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
        if layout.systemd_unit_dir.join(unit).exists() {
            systemctl_stop(unit)?;
        }
    }
    super::runtime_cleanup::cleanup_stopped_plugin_runtime(layout)?;
    let _ = systemctl_stop(super::legacy_format2::LEGACY_FORMAT2_UNIT);
    let _ = super::process::terminate_stray_listeners(&[
        super::constants::API_SERVICE_PORT,
        super::constants::WEB_SERVICE_PORT,
    ]);

    backup_unit_files(
        ALL_SERVICE_UNITS,
        &layout.systemd_unit_dir,
        &tx.units_backup_dir,
    )?;
    let legacy_unit_path = layout
        .systemd_unit_dir
        .join(super::legacy_format2::LEGACY_FORMAT2_UNIT);
    match fs::symlink_metadata(&legacy_unit_path) {
        Ok(_) => copy_file_durable(
            &legacy_unit_path,
            &tx.units_backup_dir
                .join(super::legacy_format2::LEGACY_FORMAT2_UNIT),
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
        if !entry
            .file_type()
            .map_err(|e| ReleaseError::Io {
                action: "inspect pending unit entry",
                details: e.to_string(),
            })?
            .is_file()
        {
            return Err(ReleaseError::InvalidBundle {
                path: path.display().to_string(),
                reason: "pending unit entry must be a regular file".to_string(),
            });
        }
        match entry.file_name().to_string_lossy().as_ref() {
            API_SERVICE_UNIT
            | WEB_SERVICE_UNIT
            | RECOVERY_SERVICE_UNIT
            | HELPER_SERVICE_UNIT
            | RUNNER_SERVICE_UNIT => {
                install_unit_file(&path, &layout.systemd_unit_dir)?;
            }
            "dam-hopper-web.conf" if candidate.role.includes_web() => {
                copy_file_durable(&path, &layout.sysusers_conf_path(), Some(0o644))?;
            }
            RUNNER_TMPFILES_CONF if candidate.role.includes_server() => {
                copy_file_durable(&path, &layout.runner_tmpfiles_conf_path(), Some(0o644))?;
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

    if candidate.role.includes_server() {
        provision_plugin_runtime(layout)?;
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
    match fs::symlink_metadata(&layout.host_config_path()) {
        Ok(_) => copy_file_durable(
            &layout.host_config_path(),
            &tx.config_backup_path,
            Some(0o644),
        )?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect active host configuration",
                details: error.to_string(),
            });
        }
    }

    let config_path = candidate
        .pending_host_config_path
        .as_deref()
        .ok_or_else(|| {
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
    let finalized_service_user = if let Some(service_user) = service_user_override {
        Some(service_user.trim().to_string())
    } else if candidate.role.includes_server() {
        let units_path = candidate.pending_units_path.as_deref().ok_or_else(|| {
            ReleaseError::Config("server candidate has no finalized unit directory".into())
        })?;
        let api_unit_path = Path::new(units_path).join(API_SERVICE_UNIT);
        let api_unit = fs::read_to_string(&api_unit_path).map_err(|error| ReleaseError::Io {
            action: "read finalized API unit for host identity reconciliation",
            details: error.to_string(),
        })?;
        Some(
            super::account::resolve_api_runtime_identity(&super::unit_parser::ParsedUnit::parse(
                &api_unit,
            )?)?
            .user,
        )
    } else {
        None
    };
    if let Some(service_user) = finalized_service_user {
        let origins = super::host_config::load_host_public_config(Path::new(config_path))?
            .map(|config| config.allowed_web_origins)
            .unwrap_or_default();
        let mut config = super::host_config::load_host_config(&layout.host_config_path())?
            .unwrap_or_else(|| {
                super::host_config::HostConfig::new(candidate.role, origins)
                    .expect("validated public origins")
            });
        config.service_user = Some(service_user);
        super::host_config::save_host_config(&layout.host_config_path(), &config)?;
    }
    copy_file_durable(
        Path::new(config_path),
        &layout.host_config_json_path(),
        Some(0o644),
    )?;
    systemctl_daemon_reload()?;
    tx.record_phase(
        layout,
        state,
        DeploymentState::Switched,
        TransactionPhase::Switched,
    )?;
    let mut health_candidate = candidate.clone();
    health_candidate.pending_units_path = None;
    validate_active_preflight(layout, &health_candidate, &[])?;
    let targets = build_candidate_health_targets(layout, &health_candidate)?;

    if candidate.role.includes_server() {
        if let Err(e) = systemctl_start(HELPER_SERVICE_UNIT) {
            tracing::warn!(
                "idle-suspend helper service startup failed (continuing API startup): {e}"
            );
        }
        let runner_unit_installed = layout.systemd_unit_dir.join(RUNNER_SERVICE_UNIT).exists();
        if runner_unit_installed {
            systemctl_start(RUNNER_SERVICE_UNIT)?;
        }
        provision_and_start_api(
            layout,
            &layout.systemd_unit_dir.join(API_SERVICE_UNIT),
            || systemctl_start(API_SERVICE_UNIT),
        )?;
    }
    if candidate.role.includes_web() {
        systemctl_start(WEB_SERVICE_UNIT)?;
    }

    tx.record_phase(
        layout,
        state,
        DeploymentState::Probing,
        TransactionPhase::Probing,
    )?;
    wait_for_health_stability(
        &targets,
        DEFAULT_STARTUP_DEADLINE,
        DEFAULT_REQUIRED_CONSECUTIVE,
        DEFAULT_PROBE_INTERVAL,
    )
    .await?;
    if candidate.role.includes_server() {
        verify_started_plugin_runner(layout).await?;
    }

    // Enable/disable units, propagating any failure
    if candidate.role.includes_server() {
        if let Err(e) = systemctl_enable(HELPER_SERVICE_UNIT) {
            tracing::warn!("idle-suspend helper service enable failed: {e}");
        }
        let runner_unit_installed = layout.systemd_unit_dir.join(RUNNER_SERVICE_UNIT).exists();
        if runner_unit_installed {
            systemctl_enable(RUNNER_SERVICE_UNIT)?;
        }
        systemctl_enable(API_SERVICE_UNIT)?;
    } else {
        let _ = disable_if_enabled(HELPER_SERVICE_UNIT);
        let _ = disable_if_enabled(RUNNER_SERVICE_UNIT);
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
            helper_unit_sha256: None,
            runner_unit_sha256: None,
            runner_tmpfiles_sha256: None,
            plugin_owner_user: None,
            plugin_owner_uid: None,
            plugin_admin_config_sha256: None,
            plugin_runtime_node_version: None,
            plugin_runtime_node_sha256: None,
            plugin_platform_enabled: None,
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
        helper_unit_sha256: candidate.helper_unit_sha256.clone(),
        runner_unit_sha256: candidate.runner_unit_sha256.clone(),
        runner_tmpfiles_sha256: candidate.runner_tmpfiles_sha256.clone(),
        plugin_owner_user: candidate.plugin_owner_user.clone(),
        plugin_owner_uid: candidate.plugin_owner_uid,
        plugin_admin_config_sha256: candidate.plugin_admin_config_sha256.clone(),
        plugin_runtime_node_version: candidate.plugin_runtime_node_version.clone(),
        plugin_runtime_node_sha256: candidate.plugin_runtime_node_sha256.clone(),
        plugin_platform_enabled: candidate.plugin_platform_enabled,
    });
    state.pending = None;
    state.transaction = None;

    save_manager_state(&layout.manager_state_path(), state)?;

    Ok(())
}

fn stage_service_user_override_candidate(
    layout: &Layout,
    base: &PendingCandidateRecord,
    service_user: &str,
) -> Result<PendingCandidateRecord, ReleaseError> {
    super::account::verify_api_service_account(service_user)?;

    let release_path = Path::new(&base.release_path);
    let manifest_path = release_path.join("release-manifest.json");
    let manifest = super::manifest::validate_manifest_and_archive(&manifest_path, None)?;
    let installed_public_config_path = layout.host_config_json_path();
    let public_config_path = base
        .pending_host_config_path
        .as_deref()
        .map(Path::new)
        .unwrap_or(&installed_public_config_path);
    let public_config = super::host_config::load_host_public_config(public_config_path)?
        .ok_or_else(|| ReleaseError::Config("public host configuration is missing".into()))?;

    let transaction_id = uuid::Uuid::new_v4().to_string();
    let pending_units_dir = layout.transaction_pending_units_dir(&transaction_id);
    let pending_host_config_path =
        layout.transaction_pending_host_config_json_path(&transaction_id);
    let stage_result = stage_candidate_units_for_release_with_identity(
        layout,
        release_path,
        release_path,
        &manifest,
        base.role,
        &public_config.allowed_web_origins,
        &pending_units_dir,
        &pending_host_config_path,
        Some(service_user),
    );
    if let Err(error) = stage_result {
        let _ = fs::remove_dir_all(&pending_units_dir);
        let _ = fs::remove_file(&pending_host_config_path);
        return Err(error);
    }

    let digest_result = (|| {
        let api_unit_sha256 = hash_optional_activation_file(
            &pending_units_dir.join(API_SERVICE_UNIT),
            "read finalized API unit for digest",
        )?;
        let web_unit_sha256 = hash_optional_activation_file(
            &pending_units_dir.join(WEB_SERVICE_UNIT),
            "read finalized Web unit for digest",
        )?;
        let helper_unit_sha256 = hash_optional_activation_file(
            &pending_units_dir.join(HELPER_SERVICE_UNIT),
            "read finalized helper unit for digest",
        )?;
        let host_config_sha256 = hash_required_activation_file(
            &pending_host_config_path,
            "read finalized public host configuration for digest",
        )?;
        Ok::<_, ReleaseError>((
            api_unit_sha256,
            web_unit_sha256,
            helper_unit_sha256,
            host_config_sha256,
        ))
    })();
    let (api_unit_sha256, web_unit_sha256, helper_unit_sha256, host_config_sha256) =
        match digest_result {
            Ok(digests) => digests,
            Err(error) => {
                let _ = fs::remove_dir_all(&pending_units_dir);
                let _ = fs::remove_file(&pending_host_config_path);
                return Err(error);
            }
        };

    let mut candidate = base.clone();
    candidate.pending_units_path = Some(pending_units_dir.display().to_string());
    candidate.pending_host_config_path = Some(pending_host_config_path.display().to_string());
    candidate.api_unit_sha256 = api_unit_sha256;
    candidate.web_unit_sha256 = web_unit_sha256;
    candidate.helper_unit_sha256 = helper_unit_sha256;
    candidate.host_config_sha256 = Some(host_config_sha256);
    Ok(candidate)
}

fn hash_required_activation_file(
    path: &Path,
    action: &'static str,
) -> Result<String, ReleaseError> {
    let bytes = fs::read(path).map_err(|error| ReleaseError::Io {
        action,
        details: error.to_string(),
    })?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn hash_optional_activation_file(
    path: &Path,
    action: &'static str,
) -> Result<Option<String>, ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            Ok(Some(hash_required_activation_file(path, action)?))
        }
        Ok(_) => Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: "regular file".into(),
            got: "non-regular file".into(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ReleaseError::Io {
            action: "inspect finalized unit for digest",
            details: error.to_string(),
        }),
    }
}
