//! Strict authoritative manager state envelope and durable generation tracking.
//!
//! Stored in `/var/lib/dam-hopper-manager/state.json` with permissions `0600`.
//! Monotonic generation increments with every durable commit or boundary.

use super::constants::SCHEMA_VERSION;
use super::durable_fs::{atomic_write_json, copy_file_durable};
use super::error::ReleaseError;
use super::journal::DeploymentState;
pub use super::state_record::{
    FailureRecord, MigrationRecord, PendingCandidateRecord, ReleaseRecord, TransactionPhase,
    TransactionRecord,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Authoritative manager state envelope persisted to `/var/lib/dam-hopper-manager/state.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagerState {
    pub schema_version: u32,
    pub generation: u64,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<ReleaseRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<ReleaseRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<PendingCandidateRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction: Option<TransactionRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_failure: Option<FailureRecord>,
}

impl Default for ManagerState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            generation: 1,
            updated_at: Utc::now().to_rfc3339(),
            active: None,
            previous: None,
            pending: None,
            transaction: None,
            latest_failure: None,
        }
    }
}

impl ManagerState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn validate(&self) -> Result<(), ReleaseError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(ReleaseError::Config(format!(
                "unsupported state schema version {}, expected {}",
                self.schema_version, SCHEMA_VERSION
            )));
        }
        if self.generation == 0 {
            return Err(ReleaseError::Config("generation must be non-zero".into()));
        }
        if let Some(active) = &self.active {
            active.validate()?;
        }
        if let Some(previous) = &self.previous {
            previous.validate()?;
        }
        if let Some(pending) = &self.pending {
            pending.validate()?;
        }
        if let Some(tx) = &self.transaction {
            tx.validate()?;
        }
        Ok(())
    }

    pub fn is_tag_referenced(&self, tag: &str) -> bool {
        if let Some(a) = &self.active {
            if a.tag == tag {
                return true;
            }
        }
        if let Some(p) = &self.previous {
            if p.tag == tag {
                return true;
            }
        }
        if let Some(c) = &self.pending {
            if c.tag == tag {
                return true;
            }
        }
        if let Some(tx) = &self.transaction {
            if tx.target_tag == tag || tx.previous_tag.as_deref() == Some(tag) {
                return true;
            }
        }
        if let Some(f) = &self.latest_failure {
            if f.target_tag.as_deref() == Some(tag) {
                return true;
            }
        }
        false
    }

    pub fn current_deployment_state(&self) -> DeploymentState {
        if let Some(tx) = &self.transaction {
            match tx.phase {
                TransactionPhase::Staged => DeploymentState::Staged,
                TransactionPhase::Quiesced => DeploymentState::Quiesced,
                TransactionPhase::Switched => DeploymentState::Switched,
                TransactionPhase::Probing => DeploymentState::Probing,
                TransactionPhase::Committed => DeploymentState::Committed,
                TransactionPhase::RollingBack => DeploymentState::RollingBack,
                TransactionPhase::RolledBack => DeploymentState::RolledBack,
                TransactionPhase::Failed => DeploymentState::RecoveryRequired,
            }
        } else if self.pending.is_some() {
            DeploymentState::Pending
        } else if self.active.is_some() {
            DeploymentState::Active
        } else {
            DeploymentState::Absent
        }
    }
}

/// Load the authoritative manager state envelope or initialize a default.
pub fn load_or_init_manager_state(path: &Path) -> Result<ManagerState, ReleaseError> {
    if !path.exists() {
        return Ok(ManagerState::new());
    }
    let content = fs::read_to_string(path).map_err(|e| ReleaseError::Io {
        action: "read authoritative state",
        details: e.to_string(),
    })?;
    let state: ManagerState = serde_json::from_str(&content).map_err(|e| {
        ReleaseError::Config(format!(
            "failed to parse authoritative state file {}: {e}",
            path.display()
        ))
    })?;
    state.validate()?;
    Ok(state)
}

/// Durably persist the authoritative manager state envelope with mode 0600.
pub fn save_manager_state(path: &Path, state: &mut ManagerState) -> Result<(), ReleaseError> {
    state.generation = state.generation.saturating_add(1);
    state.updated_at = Utc::now().to_rfc3339();
    state.validate()?;
    atomic_write_json(path, state, Some(0o600))
}

/// Backup the current state file to a specific destination path.
pub fn backup_state_file(state_path: &Path, backup_path: &Path) -> Result<(), ReleaseError> {
    if state_path.exists() {
        copy_file_durable(state_path, backup_path, Some(0o600))?;
    }
    Ok(())
}
