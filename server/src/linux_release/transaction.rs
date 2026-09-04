//! Lock-scoped transaction tracking and phase persistence.

use super::error::ReleaseError;
use super::journal::{validate_transition, DeploymentState};
use super::layout::Layout;
use super::state::{save_manager_state, ManagerState};
use super::state_record::{FailureRecord, TransactionPhase, TransactionRecord};
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use std::os::unix::fs::PermissionsExt;
use uuid::Uuid;

/// Transaction context managing in-flight deployment phases and backups.
#[derive(Debug, Clone)]
pub struct ActivationTransaction {
    pub tx_id: String,
    pub tx_dir: PathBuf,
    pub units_backup_dir: PathBuf,
    pub config_backup_path: PathBuf,
    pub public_config_backup_path: PathBuf,
}

fn ensure_private_directory(path: &Path) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => {
            let mode = metadata.permissions().mode() & 0o777;
            if mode != 0o700 {
                return Err(ReleaseError::OwnershipViolation {
                    path: path.display().to_string(),
                    expected: "0700 transaction directory".into(),
                    got: format!("{mode:#o}"),
                });
            }
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: path.display().to_string(),
                expected: "regular transaction directory".into(),
                got: "symbolic link or non-directory".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path).map_err(|e| ReleaseError::Io {
                action: "create transaction directory",
                details: e.to_string(),
            })?;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| {
                ReleaseError::Io {
                    action: "set transaction directory permissions",
                    details: e.to_string(),
                }
            })?;
        }
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect transaction directory",
                details: error.to_string(),
            });
        }
    }
    Ok(())
}

impl ActivationTransaction {
    /// Initialize a new activation transaction with private backup and staging paths.
    pub fn new(layout: &Layout) -> Result<Self, ReleaseError> {
        let tx_id = Uuid::new_v4().to_string();
        let tx_dir = layout.transaction_staging_dir(&tx_id);
        let backups_root = layout.var_lib_dir.join("backups").join(&tx_id);
        let units_backup_dir = backups_root.join("units");
        let config_backup_path = backups_root.join("host.toml");
        let public_config_backup_path = backups_root.join("host-config.json");

        ensure_private_directory(&backups_root)?;
        ensure_private_directory(&units_backup_dir)?;

        Ok(Self {
            tx_id,
            tx_dir,
            units_backup_dir,
            config_backup_path,
            public_config_backup_path,
        })
    }

    /// Initialize an activation transaction with an existing transaction ID.
    pub fn from_id(layout: &Layout, tx_id: &str) -> Result<Self, ReleaseError> {
        let tx_id = tx_id.to_string();
        let tx_dir = layout.transaction_staging_dir(&tx_id);
        let backups_root = layout.var_lib_dir.join("backups").join(&tx_id);
        let units_backup_dir = backups_root.join("units");
        let config_backup_path = backups_root.join("host.toml");
        let public_config_backup_path = backups_root.join("host-config.json");

        ensure_private_directory(&backups_root)?;
        ensure_private_directory(&units_backup_dir)?;

        Ok(Self {
            tx_id,
            tx_dir,
            units_backup_dir,
            config_backup_path,
            public_config_backup_path,
        })
    }

    /// Record a transaction phase change and durably persist the manager state.
    /// Derives current deployment state from the envelope and enforces transaction ownership.
    pub fn record_phase(
        &self,
        layout: &Layout,
        state: &mut ManagerState,
        to_state: DeploymentState,
        phase: TransactionPhase,
    ) -> Result<(), ReleaseError> {
        let current_state = state.current_deployment_state();
        validate_transition(current_state, to_state)?;

        if let Some(existing_tx) = &state.transaction {
            if existing_tx.tx_id != self.tx_id {
                return Err(ReleaseError::Config(format!(
                    "transaction ownership violation: expected {}, found {}",
                    self.tx_id, existing_tx.tx_id
                )));
            }
        }

        match &mut state.transaction {
            Some(t) => {
                t.phase = phase;
            }
            None => {
                let pending = state.pending.as_ref().ok_or_else(|| {
                    ReleaseError::Config("cannot start transaction without pending candidate".into())
                })?;
                let prev_tag = state.active.as_ref().map(|a| a.tag.clone());
                let prev_role = state.active.as_ref().map(|a| a.role);
                let record = TransactionRecord {
                    tx_id: self.tx_id.clone(),
                    phase,
                    started_at: Utc::now().to_rfc3339(),
                    target_tag: pending.tag.clone(),
                    target_role: pending.role,
                    previous_tag: prev_tag,
                    previous_role: prev_role,
                    units_backup_dir: Some(self.units_backup_dir.display().to_string()),
                    config_backup_path: Some(self.config_backup_path.display().to_string()),
                    public_config_backup_path: Some(
                        self.public_config_backup_path.display().to_string(),
                    ),
                    migration: None,
                };
                state.transaction = Some(record);
            }
        }

        save_manager_state(&layout.manager_state_path(), state)?;
        Ok(())
    }

    /// Record failure into state envelope without discarding errors.
    pub fn record_failure(
        &self,
        layout: &Layout,
        state: &mut ManagerState,
        phase: &str,
        error_msg: &str,
    ) -> Result<(), ReleaseError> {
        state.latest_failure = Some(FailureRecord {
            failed_at: Utc::now().to_rfc3339(),
            tx_id: Some(self.tx_id.clone()),
            target_tag: state.pending.as_ref().map(|p| p.tag.clone()),
            phase: phase.to_string(),
            sanitized_error: error_msg.to_string(),
        });
        save_manager_state(&layout.manager_state_path(), state)
    }
}
