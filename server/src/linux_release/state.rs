//! Strict authoritative manager state envelope and durable generation tracking.
//!
//! Stored in `/var/lib/dam-hopper-manager/state.json` with permissions `0600`.
//! Monotonic generation increments with every durable commit or boundary.

use super::constants::{
    MANAGER_STATE_SCHEMA_VERSION, MANAGER_STATE_SCHEMA_VERSION_LEGACY,
    MANAGER_STATE_SCHEMA_VERSION_LEGACY_V2, MAX_STATE_BYTES,
};
use super::lock::DeploymentLock;
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
use std::io::Read;
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
            schema_version: MANAGER_STATE_SCHEMA_VERSION,
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
        if self.schema_version != MANAGER_STATE_SCHEMA_VERSION {
            return Err(ReleaseError::Config(format!(
                "unsupported state schema version {}, expected {}",
                self.schema_version,
                MANAGER_STATE_SCHEMA_VERSION
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
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ManagerState::new());
        }
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect authoritative state",
                details: error.to_string(),
            });
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: "regular authoritative state file".into(),
            got: "symbolic link or non-regular file".into(),
        });
    }

    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|e| ReleaseError::Io {
            action: "open authoritative state with no-follow",
            details: e.to_string(),
        })?;
    let mut content = Vec::new();
    file.by_ref()
        .take(MAX_STATE_BYTES as u64 + 1)
        .read_to_end(&mut content)
        .map_err(|e| ReleaseError::Io {
            action: "read authoritative state",
            details: e.to_string(),
        })?;
    if content.len() > MAX_STATE_BYTES {
        return Err(ReleaseError::Config(format!(
            "authoritative state exceeds maximum size of {MAX_STATE_BYTES} bytes"
        )));
    }

    let raw_val: serde_json::Value = serde_json::from_slice(&content).map_err(|e| {
        ReleaseError::Config(format!(
            "failed to parse authoritative state file {}: {e}",
            path.display()
        ))
    })?;

    let schema_ver = raw_val
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| {
            ReleaseError::Config(format!(
                "authoritative state file {} is missing valid schemaVersion",
                path.display()
            ))
        })? as u32;

    if schema_ver == MANAGER_STATE_SCHEMA_VERSION {
        let state: ManagerState = serde_json::from_value(raw_val).map_err(|e| {
            ReleaseError::Config(format!(
                "failed to parse authoritative state file {}: {e}",
                path.display()
            ))
        })?;
        state.validate()?;
        Ok(state)
    } else if schema_ver == MANAGER_STATE_SCHEMA_VERSION_LEGACY
        || schema_ver == MANAGER_STATE_SCHEMA_VERSION_LEGACY_V2
    {
        migrate_legacy_manager_state(path, &content)
    } else {
        Err(ReleaseError::Config(format!(
            "unsupported state schema version {schema_ver}, expected {MANAGER_STATE_SCHEMA_VERSION}"
        )))
    }
}

const OBSOLETE_PLUGIN_FIELDS: &[&str] = &[
    "runnerUnitSha256",
    "runnerTmpfilesSha256",
    "pluginOwnerUser",
    "pluginOwnerUid",
    "pluginAdminConfigSha256",
    "pluginRuntimeNodeVersion",
    "pluginRuntimeNodeSha256",
    "pluginPlatformEnabled",
];

const ALLOWED_TOP_LEVEL_KEYS: &[&str] = &[
    "schemaVersion",
    "generation",
    "updatedAt",
    "active",
    "previous",
    "pending",
    "transaction",
    "latestFailure",
];

fn strip_obsolete_plugin_fields(val: &mut serde_json::Value) {
    if let serde_json::Value::Object(map) = val {
        for field in OBSOLETE_PLUGIN_FIELDS {
            map.remove(*field);
        }
    }
}

/// Migrate a legacy manager state envelope (v1 or v2) to native schema version 3.
/// Validates strict legacy envelope, backs up original, strips obsolete plugin fields,
/// bumps generation once, and durably persists the migrated state.
pub fn migrate_legacy_manager_state(
    path: &Path,
    content: &[u8],
) -> Result<ManagerState, ReleaseError> {
    let mut raw_val: serde_json::Value = serde_json::from_slice(content).map_err(|e| {
        ReleaseError::Config(format!(
            "failed to parse authoritative state file {}: {e}",
            path.display()
        ))
    })?;

    let obj = raw_val.as_object_mut().ok_or_else(|| {
        ReleaseError::Config("authoritative state must be a JSON object".into())
    })?;

    for key in obj.keys() {
        if !ALLOWED_TOP_LEVEL_KEYS.contains(&key.as_str()) {
            return Err(ReleaseError::Config(format!(
                "refusing manager state migration: unknown top-level field '{key}' in {}",
                path.display()
            )));
        }
    }

    let schema_ver = obj
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| {
            ReleaseError::Config(format!(
                "authoritative state file {} is missing valid schemaVersion",
                path.display()
            ))
        })? as u32;

    if schema_ver != MANAGER_STATE_SCHEMA_VERSION_LEGACY
        && schema_ver != MANAGER_STATE_SCHEMA_VERSION_LEGACY_V2
    {
        return Err(ReleaseError::Config(format!(
            "cannot migrate state with schema version {schema_ver}, expected legacy v1 or v2"
        )));
    }

    if let Some(tx) = obj.get("transaction") {
        if !tx.is_null() {
            return Err(ReleaseError::Config(
                "refusing manager state migration: unfinished live transaction in flight".into(),
            ));
        }
    }

    let old_generation = obj
        .get("generation")
        .and_then(|g| g.as_u64())
        .filter(|&g| g > 0)
        .ok_or_else(|| {
            ReleaseError::Config("refusing manager state migration: invalid generation".into())
        })?;

    let lock_path = path.with_file_name("deploy.lock");
    let _lock = DeploymentLock::acquire(&lock_path)?;

    let backup_path = path.with_extension(format!("v{schema_ver}.bak"));
    copy_file_durable(path, &backup_path, Some(0o644))?;

    if let Some(active) = obj.get_mut("active") {
        strip_obsolete_plugin_fields(active);
    }
    if let Some(previous) = obj.get_mut("previous") {
        strip_obsolete_plugin_fields(previous);
    }
    if let Some(pending) = obj.get_mut("pending") {
        strip_obsolete_plugin_fields(pending);
    }

    let new_generation = old_generation.saturating_add(1);
    obj.insert("schemaVersion".to_string(), serde_json::json!(MANAGER_STATE_SCHEMA_VERSION));
    obj.insert("generation".to_string(), serde_json::json!(new_generation));
    obj.insert("updatedAt".to_string(), serde_json::json!(Utc::now().to_rfc3339()));

    let state: ManagerState = serde_json::from_value(raw_val).map_err(|e| {
        ReleaseError::Config(format!(
            "failed to deserialize migrated authoritative state: {e}"
        ))
    })?;
    state.validate()?;

    atomic_write_json(path, &state, Some(0o644))?;
    Ok(state)
}
/// Durably persist the authoritative manager state envelope with mode 0644.
pub fn save_manager_state(path: &Path, state: &mut ManagerState) -> Result<(), ReleaseError> {
    state.generation = state.generation.saturating_add(1);
    state.updated_at = Utc::now().to_rfc3339();
    state.validate()?;
    atomic_write_json(path, state, Some(0o644))
}

/// Backup the current state file to a specific destination path.
pub fn backup_state_file(state_path: &Path, backup_path: &Path) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(state_path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            copy_file_durable(state_path, backup_path, Some(0o644))?;
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: state_path.display().to_string(),
                expected: "regular state file".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect state file before backup",
                details: error.to_string(),
            });
        }
    }
    Ok(())
}
