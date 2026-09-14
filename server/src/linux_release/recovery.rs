//! Crash recovery and boot-time reconciliation one-shot.
//!
//! Enforces:
//! - Boot-time one-shot blocks app units on inconsistency
//! - Staged/Pending: old remains active, candidate units stay disabled
//! - Quiesced/Switched/Probing: automatically restores previous or clean baseline
//! - Committed: repairs unit enablement and current symlink without version rollback
use super::activate_preflight::{build_candidate_health_targets, validate_active_preflight};
use super::constants::{
    ALL_SERVICE_UNITS, API_SERVICE_UNIT, HELPER_SERVICE_UNIT, RECOVERY_SERVICE_UNIT,
    WEB_SERVICE_UNIT,
};
use super::legacy_format2::LEGACY_FORMAT2_UNIT;

use super::durable_fs::atomic_symlink;
use super::error::ReleaseError;
use super::journal::{classify_recovery, RecoveryAction};
use super::layout::Layout;
use super::lock::DeploymentLock;
use super::process::inspect_service_process;
use super::api_runtime::provision_installed_api_runtime;
use super::rollback::rollback_activation_failure;
use super::state::{load_or_init_manager_state, save_manager_state};
use super::state_record::{PendingCandidateRecord, ReleaseRecord};
use super::systemd::{disable_if_enabled, systemctl_enable, systemctl_is_active, systemctl_stop};
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
                ensure_active_runtime_ready(layout, active)?;
                repair_active_pointers(layout, active)?;
            }
            Ok(())
        }
        RecoveryAction::ResumePending => {
            if is_boot {
                disable_if_enabled(API_SERVICE_UNIT)?;
                let _ = disable_if_enabled(HELPER_SERVICE_UNIT);
                disable_if_enabled(WEB_SERVICE_UNIT)?;
                if let Some(active) = &state.active {
                    if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
                        super::rollback::inspect_imported_legacy_installation(
                            layout, active, false,
                        )
                        .await?;
                    }
                    ensure_active_runtime_ready(layout, active)?;
                    repair_active_pointers(layout, active)?;
                }
            }
            Ok(())
        }
        RecoveryAction::RestorePrevious => {
            rollback_activation_failure(layout, "crash recovery restoring pre-transaction state")
                .await
        }
        RecoveryAction::RepairCommitted => {
            if let Some(active) = &state.active {
                if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
                    super::rollback::inspect_imported_legacy_installation(layout, active, false)
                        .await?;
                }
                ensure_active_runtime_ready(layout, active)?;
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

fn ensure_active_runtime_ready(
    layout: &Layout,
    active: &ReleaseRecord,
) -> Result<(), ReleaseError> {
    if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
        return Ok(());
    }

    let candidate = PendingCandidateRecord {
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
    };
    let validation = (|| {
        let allowed_sqlite_pids = match inspect_service_process(API_SERVICE_UNIT)? {
            Some(ev) if ev.pid > 0 => vec![ev.pid],
            _ => Vec::new(),
        };
        validate_active_preflight(layout, &candidate, &allowed_sqlite_pids)?;
        build_candidate_health_targets(layout, &candidate)?;
        if active.role.includes_server() {
            provision_installed_api_runtime(layout)?;
        }
        Ok::<(), ReleaseError>(())
    })();
    if let Err(error) = validation {
        let disable_error = stop_and_disable_services(ALL_SERVICE_UNITS)
            .err()
            .map(|disable_error| format!("; disabling app units failed: {disable_error}"))
            .unwrap_or_default();
        return Err(ReleaseError::Config(format!(
            "RECOVERY_REQUIRED: active release preflight failed ({error}){disable_error}"
        )));
    }
    Ok(())
}

fn repair_active_pointers(
    layout: &Layout,
    active: &super::state_record::ReleaseRecord,
) -> Result<(), ReleaseError> {
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

    let repair_result = (|| {
        if active.tag == super::legacy_format2::LEGACY_FORMAT2_TAG {
            disable_if_enabled(API_SERVICE_UNIT)?;
            let _ = disable_if_enabled(HELPER_SERVICE_UNIT);
            disable_if_enabled(WEB_SERVICE_UNIT)?;
            systemctl_enable(LEGACY_FORMAT2_UNIT)?;
        } else {
            if active.role.includes_server() {
                let _ = systemctl_enable(HELPER_SERVICE_UNIT);
                systemctl_enable(API_SERVICE_UNIT)?;
            } else {
                let _ = disable_if_enabled(HELPER_SERVICE_UNIT);
                disable_if_enabled(API_SERVICE_UNIT)?;
            }

            if active.role.includes_web() {
                systemctl_enable(WEB_SERVICE_UNIT)?;
            } else {
                disable_if_enabled(WEB_SERVICE_UNIT)?;
            }
        }
        systemctl_enable(RECOVERY_SERVICE_UNIT)?;
        Ok::<(), ReleaseError>(())
    })();

    if let Err(error) = repair_result {
        let cleanup_error = stop_and_disable_services(ALL_SERVICE_UNITS).err();
        if let Some(cleanup_error) = cleanup_error {
            return Err(ReleaseError::Config(format!(
                "recovery pointer repair failed ({error}); fail-closed cleanup failed ({cleanup_error})"
            )));
        }
        return Err(error);
    }
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
