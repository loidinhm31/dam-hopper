//! Orchestration engine for candidate release activation and ordinary startup.

use super::account::verify_web_sysuser_account;
use super::activate_preflight::{
    build_candidate_health_targets, validate_active_preflight, validate_candidate_preflight,
};
use super::constants::{
    ALL_SERVICE_UNITS, API_SERVICE_UNIT, RECOVERY_SERVICE_UNIT, WEB_SERVICE_UNIT,
};
use super::durable_fs::{atomic_symlink, copy_file_durable};
use super::error::ReleaseError;
use super::health::{
    DEFAULT_PROBE_INTERVAL, DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_STARTUP_DEADLINE,
    wait_for_health_stability,
};
use super::journal::DeploymentState;
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::process::inspect_service_process;
use super::rollback::rollback_activation_failure;
use super::state::{ManagerState, load_or_init_manager_state, save_manager_state};
use super::state_record::{PendingCandidateRecord, ReleaseRecord, TransactionPhase};
use super::systemd::{
    backup_unit_files, disable_if_enabled, install_unit_file, systemctl_daemon_reload,
    systemctl_enable, systemctl_start, systemctl_stop, systemd_sysusers,
};
use super::transaction::ActivationTransaction;
use chrono::Utc;
use std::fs;
use std::io::IsTerminal;
use std::path::Path;

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
                super::rollback::inspect_imported_legacy_installation(layout, &active_record, true)
                    .await?;
                return Ok(());
            }
            validate_active_preflight(layout, &active_candidate, &allowed_sqlite_pids)?;
            if active_candidate.role.includes_server() {
                let host_config = super::host_config::load_host_config(&layout.host_config_path())?;
                let user_candidate = if let Some(u) = &args.service_user {
                    Some(u.as_str())
                } else {
                    host_config.as_ref().and_then(|c| c.service_user.as_deref())
                };
                if user_candidate.is_some()
                    || args.service_user.is_some()
                    || std::io::stdin().is_terminal()
                {
                    let user_name =
                        super::account::resolve_service_user(user_candidate, args.non_interactive)?;
                    let user_info = super::account::verify_api_service_account(&user_name)?;
                    let group_name = super::account::get_group_by_gid(user_info.gid)
                        .unwrap_or_else(|| user_name.clone());
                    let installed_api_unit = layout.systemd_unit_dir.join(API_SERVICE_UNIT);
                    if installed_api_unit.exists() {
                        if let Ok(content) = fs::read_to_string(&installed_api_unit) {
                            if let Ok(updated) = update_unit_service_identity(
                                &content,
                                &user_name,
                                &group_name,
                                super::constants::API_SERVICE_HOME,
                            ) {
                                let _ = fs::write(&installed_api_unit, updated.as_bytes());
                                let _ = systemctl_daemon_reload();
                            }
                        }
                    }
                    ensure_user_config_ownership(&user_info.home, user_info.uid, user_info.gid);
                }
                systemctl_start("dam-hopper-api.service")?;
            }
            if active_candidate.role.includes_web() {
                super::systemd::systemd_sysusers(&layout.sysusers_conf_path(), None)?;
                super::account::verify_web_sysuser_account(super::constants::WEB_SERVICE_IDENTITY)?;
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
    let mut candidate = candidate;
    if candidate.role.includes_server() {
        let host_config = super::host_config::load_host_config(&layout.host_config_path())?;
        let user_candidate = if let Some(u) = &args.service_user {
            Some(u.as_str())
        } else {
            host_config.as_ref().and_then(|c| c.service_user.as_deref())
        };

        let user_name = super::account::resolve_service_user(user_candidate, args.non_interactive)?;
        let user_info = super::account::verify_api_service_account(&user_name)?;
        let group_name =
            super::account::get_group_by_gid(user_info.gid).unwrap_or_else(|| user_name.clone());

        let mut config_to_save = host_config.unwrap_or_else(|| {
            super::host_config::HostConfig::new(candidate.role, vec![]).unwrap()
        });
        if config_to_save.service_user.as_deref() != Some(&user_name) {
            config_to_save.service_user = Some(user_name.clone());
            super::host_config::save_host_config(&layout.host_config_path(), &config_to_save)?;
        }
        ensure_user_config_ownership(&user_info.home, user_info.uid, user_info.gid);

        if let Some(ref units_path_str) = candidate.pending_units_path {
            let units_dir = std::path::Path::new(units_path_str);
            let api_unit_path = units_dir.join(API_SERVICE_UNIT);
            if api_unit_path.exists() {
                let unit_content =
                    fs::read_to_string(&api_unit_path).map_err(|e| ReleaseError::Io {
                        action: "read pending api unit",
                        details: e.to_string(),
                    })?;
                let updated = update_unit_service_identity(
                    &unit_content,
                    &user_name,
                    &group_name,
                    super::constants::API_SERVICE_HOME,
                )?;
                fs::write(&api_unit_path, updated.as_bytes()).map_err(|e| ReleaseError::Io {
                    action: "write updated pending api unit",
                    details: e.to_string(),
                })?;
                let new_hash = hash_optional_file(&api_unit_path)?;
                candidate.api_unit_sha256 = new_hash;
                state.pending = Some(candidate.clone());
                save_manager_state(&layout.manager_state_path(), &mut state)?;
            }
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
        let _ = systemctl_stop(unit);
    }
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

    if candidate.role.includes_server() {
        systemctl_start(API_SERVICE_UNIT)?;
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

    let targets = build_candidate_health_targets(candidate)?;
    wait_for_health_stability(
        &targets,
        DEFAULT_STARTUP_DEADLINE,
        DEFAULT_REQUIRED_CONSECUTIVE,
        DEFAULT_PROBE_INTERVAL,
    )
    .await?;

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

fn update_unit_service_identity(
    unit_content: &str,
    user: &str,
    group: &str,
    home: &str,
) -> Result<String, ReleaseError> {
    let mut lines = Vec::new();
    let mut in_service = false;
    let mut has_user = false;
    let mut has_group = false;
    let mut has_workdir = false;
    let mut has_home_env = false;
    let mut has_xdg_env = false;

    for line in unit_content.lines() {
        let trimmed = line.trim();
        if trimmed == "[Service]" {
            in_service = true;
            lines.push(line.to_string());
            continue;
        } else if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if in_service {
                if !has_user {
                    lines.push(format!("User={user}"));
                }
                if !has_group {
                    lines.push(format!("Group={group}"));
                }
                if !has_workdir {
                    lines.push(format!("WorkingDirectory={home}"));
                }
                if !has_home_env {
                    lines.push(format!("Environment=HOME={home}"));
                }
                if !has_xdg_env {
                    lines.push(format!("Environment=XDG_CONFIG_HOME={home}/.config"));
                }
                in_service = false;
            }
            lines.push(line.to_string());
            continue;
        }

        if in_service {
            if trimmed.starts_with("User=") {
                lines.push(format!("User={user}"));
                has_user = true;
                continue;
            } else if trimmed.starts_with("Group=") {
                lines.push(format!("Group={group}"));
                has_group = true;
                continue;
            } else if trimmed.starts_with("WorkingDirectory=") {
                lines.push(format!("WorkingDirectory={home}"));
                has_workdir = true;
                continue;
            } else if trimmed.starts_with("Environment=HOME=") {
                lines.push(format!("Environment=HOME={home}"));
                has_home_env = true;
                continue;
            } else if trimmed.starts_with("Environment=XDG_CONFIG_HOME=") {
                lines.push(format!("Environment=XDG_CONFIG_HOME={home}/.config"));
                has_xdg_env = true;
                continue;
            }
        }
        lines.push(line.to_string());
    }

    if in_service {
        if !has_user {
            lines.push(format!("User={user}"));
        }
        if !has_group {
            lines.push(format!("Group={group}"));
        }
        if !has_workdir {
            lines.push(format!("WorkingDirectory={home}"));
        }
        if !has_home_env {
            lines.push(format!("Environment=HOME={home}"));
        }
        if !has_xdg_env {
            lines.push(format!("Environment=XDG_CONFIG_HOME={home}/.config"));
        }
    }

    Ok(lines.join("\n") + "\n")
}

fn hash_optional_file(path: &Path) -> Result<Option<String>, ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => {
            let bytes = fs::read(path).map_err(|e| ReleaseError::Io {
                action: "read file for hash",
                details: e.to_string(),
            })?;
            use sha2::{Digest, Sha256};
            Ok(Some(format!("{:x}", Sha256::digest(&bytes))))
        }
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

fn ensure_user_config_ownership(user_home: &str, uid: u32, gid: u32) {
    let targets = if user_home == super::constants::API_SERVICE_HOME {
        vec![std::path::PathBuf::from(super::constants::API_SERVICE_HOME)]
    } else {
        vec![
            std::path::PathBuf::from(super::constants::API_SERVICE_HOME),
            std::path::PathBuf::from(user_home),
        ]
    };
    for base in targets {
        let _ = fs::create_dir_all(&base);
        let dot_config = base.join(".config");
        let user_config_dir = dot_config.join("dam-hopper");
        let _ = fs::create_dir_all(&user_config_dir);
        #[cfg(unix)]
        {
            chown_single(&base, uid, gid);
            chown_single(&dot_config, uid, gid);
            chown_recursive(&user_config_dir, uid, gid);
        }
    }
}

#[cfg(unix)]
fn chown_single(path: &std::path::Path, uid: u32, gid: u32) {
    if let Ok(c_path) = std::ffi::CString::new(path.to_string_lossy().as_bytes()) {
        unsafe {
            libc::chown(c_path.as_ptr(), uid, gid);
        }
    }
}

#[cfg(unix)]
fn chown_recursive(path: &std::path::Path, uid: u32, gid: u32) {
    chown_single(path, uid, gid);
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                chown_recursive(&p, uid, gid);
            } else {
                chown_single(&p, uid, gid);
            }
        }
    }
}
