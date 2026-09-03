//! Orchestration engine for candidate release activation and ordinary startup.

use super::activate_preflight::{build_candidate_health_targets, validate_candidate_preflight};
use super::constants::{ALL_SERVICE_UNITS, RECOVERY_SERVICE_UNIT};
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
    backup_unit_files, install_unit_file, systemctl_daemon_reload, systemctl_disable,
    systemctl_enable, systemctl_is_active, systemctl_start, systemctl_stop,
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

    let candidate = match state.pending.clone() {
        Some(c) => c,
        None => {
            let active = state.active.as_ref().ok_or_else(|| {
                ReleaseError::Config("no active release or pending candidate to start".into())
            })?;
            if active.role.includes_server() {
                systemctl_start("dam-hopper-api.service")?;
            }
            if active.role.includes_web() {
                systemctl_start("dam-hopper-web.service")?;
            }
            return Ok(());
        }
    };

    let mut allowed_sqlite_pids = Vec::new();
    if let Ok(Some(ev)) = inspect_service_process("dam-hopper-api.service") {
        if ev.pid > 0 {
            allowed_sqlite_pids.push(ev.pid);
        }
    }

    validate_candidate_preflight(layout, &candidate, &allowed_sqlite_pids)?;

    let tx = ActivationTransaction::new(layout)?;
    tx.record_phase(layout, &mut state, DeploymentState::Quiesced, TransactionPhase::Quiesced)?;

    // Entire sequence through durable commit is enclosed in the transactional rollback boundary
    let pipeline_res = execute_activation_pipeline(layout, &tx, &candidate, &mut state).await;

    if let Err(err) = pipeline_res {
        let err_msg = err.to_string();
        let _ = tx.record_failure(layout, &mut state, "ACTIVATION_FAILED", &err_msg);

        match rollback_activation_failure(layout, &err_msg).await {
            Ok(()) => {
                return Err(ReleaseError::ProcessInspectionFailed {
                    reason: format!("activation failed ({err_msg}); successfully rolled back"),
                });
            }
            Err(rollback_err) => {
                return Err(ReleaseError::Config(format!(
                    "CRITICAL: activation failed ({err_msg}) AND rollback failed ({rollback_err}): RECOVERY_REQUIRED"
                )));
            }
        }
    }

    // Post-commit convenience pointer repair and retention (release is already durably committed)
    let _ = atomic_symlink(Path::new(&candidate.release_path), &layout.current_link());
    super::retention::apply_retention(layout, &state)?;
    Ok(())
}

async fn execute_activation_pipeline(
    layout: &Layout,
    tx: &ActivationTransaction,
    candidate: &PendingCandidateRecord,
    state: &mut ManagerState,
) -> Result<(), ReleaseError> {
    for &u in ALL_SERVICE_UNITS {
        if let Ok(true) = systemctl_is_active(u) {
            let _ = systemctl_stop(u);
        }
    }

    backup_unit_files(ALL_SERVICE_UNITS, &layout.systemd_unit_dir, &tx.units_backup_dir)?;

    if let Some(ref units_path) = candidate.pending_units_path {
        let p = Path::new(units_path);
        if p.exists() {
            let entries = fs::read_dir(p).map_err(|e| ReleaseError::Io {
                action: "read pending units dir",
                details: e.to_string(),
            })?;
            for entry in entries.flatten() {
                install_unit_file(&entry.path(), &layout.systemd_unit_dir)?;
            }
        }
    }

    if layout.host_config_json_path().exists() {
        let _ = copy_file_durable(&layout.host_config_json_path(), &tx.public_config_backup_path, Some(0o644));
    }

    if let Some(ref cfg) = candidate.pending_host_config_path {
        let p = Path::new(cfg);
        if p.exists() {
            copy_file_durable(p, &layout.host_config_json_path(), Some(0o644))?;
        }
    }

    systemctl_daemon_reload()?;
    tx.record_phase(layout, state, DeploymentState::Switched, TransactionPhase::Switched)?;

    if candidate.role.includes_server() {
        systemctl_start("dam-hopper-api.service")?;
    }
    if candidate.role.includes_web() {
        systemctl_start("dam-hopper-web.service")?;
    }

    tx.record_phase(layout, state, DeploymentState::Probing, TransactionPhase::Probing)?;

    let targets = build_candidate_health_targets(candidate)?;
    wait_for_health_stability(&targets, DEFAULT_STARTUP_DEADLINE, DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_PROBE_INTERVAL).await?;

    // Enable/disable units, propagating any failure
    if candidate.role.includes_server() {
        systemctl_enable("dam-hopper-api.service")?;
    } else {
        systemctl_disable("dam-hopper-api.service")?;
    }
    systemctl_enable(RECOVERY_SERVICE_UNIT)?;


    if candidate.role.includes_web() {
        systemctl_enable("dam-hopper-web.service")?;
    } else {
        systemctl_disable("dam-hopper-web.service")?;
    }

    state.previous = state.active.take();
    state.active = Some(ReleaseRecord {
        tag: candidate.tag.clone(),
        version: candidate.tag.trim_start_matches('v').to_string(),
        role: candidate.role,
        release_path: candidate.release_path.clone(),
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

    save_manager_state(&layout.manager_state_path(), state)
}
