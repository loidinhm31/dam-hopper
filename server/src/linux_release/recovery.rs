//! Crash recovery and boot-time reconciliation one-shot.
//!
//! Enforces:
//! - Boot-time one-shot blocks app units on inconsistency
//! - Staged/Pending: old remains active, candidate units stay disabled
//! - Quiesced/Switched/Probing: automatically restores previous or clean baseline
//! - Committed: repairs unit enablement and current symlink without version rollback
use super::constants::{
    ALL_SERVICE_UNITS, API_SERVICE_UNIT, RECOVERY_SERVICE_UNIT, WEB_SERVICE_UNIT,
};
use super::legacy_format2::LEGACY_FORMAT2_UNIT;

use super::durable_fs::atomic_symlink;
use super::error::ReleaseError;
use super::journal::{classify_recovery, RecoveryAction};
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::rollback::rollback_activation_failure;
use super::state::{load_or_init_manager_state, save_manager_state};
use super::systemd::{
    disable_if_enabled, systemctl_enable, systemctl_is_active,
    systemctl_stop,
};
use std::path::Path;

/// Execute crash recovery or boot-time reconciliation.
pub async fn execute_recovery(layout: &Layout, is_boot: bool) -> Result<(), ReleaseError> {
    let _lock = DeploymentLock::acquire(&layout.deploy_lock_path())?;
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;

    let action = classify_recovery(&state);
    match action {
        RecoveryAction::NoAction => {
            if let Some(active) = &state.active {
                if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
                    super::rollback::inspect_imported_legacy_installation(layout, active, false)
                        .await?;
                }
                repair_active_pointers(layout, active)?;
            }
            Ok(())
        }
        RecoveryAction::ResumePending => {
            if is_boot {
                disable_if_enabled(API_SERVICE_UNIT)?;
                disable_if_enabled(WEB_SERVICE_UNIT)?;
                if let Some(active) = &state.active {
                    if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
                        super::rollback::inspect_imported_legacy_installation(layout, active, false)
                            .await?;
                    }
                    repair_active_pointers(layout, active)?;
                }
            }
            Ok(())
        }
        RecoveryAction::RestorePrevious => {
            rollback_activation_failure(layout, "crash recovery restoring pre-transaction state").await
        }
        RecoveryAction::RepairCommitted => {
            if let Some(active) = &state.active {
                if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
                    super::rollback::inspect_imported_legacy_installation(layout, active, false)
                        .await?;
                }
                repair_active_pointers(layout, active)?;
            }
            state.transaction = None;
            save_manager_state(&layout.manager_state_path(), &mut state)?;
            Ok(())
        }
        RecoveryAction::RecoveryRequired(reason) => {
            stop_and_disable_services(ALL_SERVICE_UNITS)?;
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
    if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
        disable_if_enabled(API_SERVICE_UNIT)?;
        disable_if_enabled(WEB_SERVICE_UNIT)?;
        systemctl_enable(LEGACY_FORMAT2_UNIT)?;
    } else {
        if active.role.includes_server() {
            systemctl_enable(API_SERVICE_UNIT)?;
        } else {
            disable_if_enabled(API_SERVICE_UNIT)?;
        }

        if active.role.includes_web() {
            systemctl_enable(WEB_SERVICE_UNIT)?;
        } else {
            disable_if_enabled(WEB_SERVICE_UNIT)?;
        }
    }
    systemctl_enable(RECOVERY_SERVICE_UNIT)?;

    let release_path = Path::new(&active.release_path);
    match std::fs::symlink_metadata(release_path) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: release_path.display().to_string(),
                expected: "regular active release directory".into(),
                got: "symbolic link or non-directory".into(),
            });
        }
        Err(error) => {
            return Err(ReleaseError::Config(format!(
                "active release path is missing or inaccessible: {} ({error})",
                release_path.display()
            )));
        }
    }
    atomic_symlink(release_path, &layout.current_link())?;
    Ok(())
}

fn stop_and_disable_services(units: &[&str]) -> Result<(), ReleaseError> {
    for &unit in units {
        if systemctl_is_active(unit)? {
            systemctl_stop(unit)?;
        }
        disable_if_enabled(unit)?;
    }
    Ok(())
}
