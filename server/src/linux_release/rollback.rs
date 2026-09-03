//! Automatic and manual rollback restoration with verified health stability.

use super::activate_preflight::build_candidate_health_targets;
use super::constants::{ALL_SERVICE_UNITS, RECOVERY_SERVICE_UNIT};
use super::durable_fs::{atomic_symlink, copy_file_durable};
use super::error::ReleaseError;
use super::health::{wait_for_health_stability, DEFAULT_PROBE_INTERVAL, DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_STARTUP_DEADLINE};
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::state::{load_or_init_manager_state, save_manager_state};
use super::state_record::{FailureRecord, PendingCandidateRecord, ReleaseRecord, TransactionPhase};
use super::systemd::{
    remove_unit_file, restore_unit_files, systemctl_daemon_reload, systemctl_disable,
    systemctl_is_active, systemctl_start, systemctl_stop,
};
use chrono::Utc;
use std::fs;
use std::path::Path;

pub fn stop_and_disable_units(units: &[&str], systemd_dir: &Path) -> Result<(), ReleaseError> {
    for &unit in units {
        if let Ok(true) = systemctl_is_active(unit) {
            let _ = systemctl_stop(unit);
        }
        let _ = systemctl_disable(unit);
        let _ = remove_unit_file(unit, systemd_dir);
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

/// Automatic rollback on candidate activation failure: restores `state.active` or clean baseline.
pub async fn rollback_activation_failure(layout: &Layout, reason: &str) -> Result<(), ReleaseError> {
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;
    // Case 1: First-install baseline restoration
    if state.active.is_none() {
        stop_and_disable_units(ALL_SERVICE_UNITS, &layout.systemd_unit_dir)?;
        if layout.current_link().exists() {
            let _ = fs::remove_file(layout.current_link());
        }
        if layout.host_config_json_path().exists() {
            let _ = fs::remove_file(layout.host_config_json_path());
        }
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
    for &u in ALL_SERVICE_UNITS {
        if let Ok(true) = systemctl_is_active(u) {
            let _ = systemctl_stop(u);
        }
    }

    if let Some(ref tx) = state.transaction {
        if let Some(ref bkp) = tx.units_backup_dir {
            let p = Path::new(bkp);
            if p.exists() {
                restore_unit_files(p, &layout.systemd_unit_dir)?;
            }
        }
        if let Some(ref bkp) = tx.public_config_backup_path {
            let p = Path::new(bkp);
            if p.exists() {
                let _ = copy_file_durable(p, &layout.host_config_json_path(), Some(0o644));
            }
        }
    }
    systemctl_daemon_reload()?;
    let _ = super::systemd::systemctl_enable(RECOVERY_SERVICE_UNIT);


    if active.role.includes_server() {
        systemctl_start("dam-hopper-api.service")?;
    }
    if active.role.includes_web() {
        systemctl_start("dam-hopper-web.service")?;
    }

    let cand = release_to_candidate(&active);
    let targets = build_candidate_health_targets(&cand)?;
    if let Err(e) = wait_for_health_stability(&targets, DEFAULT_STARTUP_DEADLINE, DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_PROBE_INTERVAL).await {
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
    let _ = atomic_symlink(Path::new(&active.release_path), &layout.current_link());
    Ok(())
}

/// Manual rollback to recorded previous release.
pub async fn execute_manual_rollback(layout: &Layout) -> Result<(), ReleaseError> {
    let _lock = DeploymentLock::acquire(&layout.deploy_lock_path())?;
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;
    let prev = state.previous.clone().ok_or_else(|| {
        ReleaseError::Config("no previous release recorded for manual rollback".into())
    })?;

    let cand = release_to_candidate(&prev);
    state.pending = Some(cand);
    save_manager_state(&layout.manager_state_path(), &mut state)?;
    super::activate::execute_activation_locked(layout, &_lock).await
}
