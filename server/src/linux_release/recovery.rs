//! Crash recovery and boot-time reconciliation one-shot.
//!
//! Enforces:
//! - Boot-time one-shot blocks app units on inconsistency
//! - Staged/Pending: old remains active, candidate units stay disabled
//! - Quiesced/Switched/Probing: automatically restores previous or clean baseline
//! - Committed: repairs unit enablement and current symlink without version rollback
use super::constants::{ALL_SERVICE_UNITS, RECOVERY_SERVICE_UNIT};

use super::durable_fs::atomic_symlink;
use super::error::ReleaseError;
use super::journal::{classify_recovery, RecoveryAction};
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::rollback::{rollback_activation_failure, stop_and_disable_units};
use super::state::{load_or_init_manager_state, save_manager_state};
use super::systemd::{systemctl_disable, systemctl_enable};
use std::path::Path;

/// Execute crash recovery or boot-time reconciliation.
pub async fn execute_recovery(layout: &Layout, is_boot: bool) -> Result<(), ReleaseError> {
    let _lock = DeploymentLock::acquire(&layout.deploy_lock_path())?;
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;

    let action = classify_recovery(&state);
    match action {
        RecoveryAction::NoAction => {
            if let Some(ref active) = state.active {
                repair_active_pointers(layout, active)?;
            }
            Ok(())
        }
        RecoveryAction::ResumePending => {
            // Uncommitted candidate must not start on boot
            if is_boot {
                let _ = systemctl_disable("dam-hopper-api.service");
                let _ = systemctl_disable("dam-hopper-web.service");
                if let Some(ref active) = state.active {
                    repair_active_pointers(layout, active)?;
                }
            }
            Ok(())
        }
        RecoveryAction::RestorePrevious => {
            rollback_activation_failure(layout, "crash recovery restoring pre-transaction state").await
        }
        RecoveryAction::RepairCommitted => {
            if let Some(ref active) = state.active {
                repair_active_pointers(layout, active)?;
            }
            state.transaction = None;
            save_manager_state(&layout.manager_state_path(), &mut state)?;
            Ok(())
        }
        RecoveryAction::RecoveryRequired(reason) => {
            let _ = stop_and_disable_units(ALL_SERVICE_UNITS, &layout.systemd_unit_dir);
            Err(ReleaseError::Config(format!(
                "RECOVERY_REQUIRED: {reason}; app units disabled to prevent unsafe start"
            )))
        }
    }
}

fn repair_active_pointers(
    layout: &Layout,
    active: &super::state_record::ReleaseRecord,
) -> Result<(), ReleaseError> {
    if active.role.includes_server() {
        let _ = systemctl_enable("dam-hopper-api.service");
    } else {
        let _ = systemctl_disable("dam-hopper-api.service");
    }

    if active.role.includes_web() {
        let _ = systemctl_enable("dam-hopper-web.service");
    } else {
        let _ = systemctl_disable("dam-hopper-web.service");
    }
    let _ = systemctl_enable(RECOVERY_SERVICE_UNIT);

    let release_path = Path::new(&active.release_path);
    if release_path.exists() {
        let _ = atomic_symlink(release_path, &layout.current_link());
    }
    Ok(())
}
