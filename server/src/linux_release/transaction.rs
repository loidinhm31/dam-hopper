//! Lock-scoped transaction tracking and phase persistence.

use super::error::ReleaseError;
use super::journal::{validate_transition, DeploymentState};
use super::layout::Layout;
use super::state::{save_manager_state, ManagerState};
use super::state_record::{FailureRecord, TransactionPhase, TransactionRecord};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
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

impl ActivationTransaction {
    /// Initialize a new activation transaction with private backup and staging paths.
    pub fn new(layout: &Layout) -> Result<Self, ReleaseError> {
        let tx_id = Uuid::new_v4().to_string();
        let tx_dir = layout.transaction_staging_dir(&tx_id);
        let backups_root = layout.var_lib_dir.join("backups").join(&tx_id);
        let units_backup_dir = backups_root.join("units");
        let config_backup_path = backups_root.join("host.toml");
        let public_config_backup_path = backups_root.join("host-config.json");

        if !units_backup_dir.exists() {
            fs::create_dir_all(&units_backup_dir).map_err(|e| ReleaseError::Io {
                action: "create transaction backup directory",
                details: e.to_string(),
            })?;
        }

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
