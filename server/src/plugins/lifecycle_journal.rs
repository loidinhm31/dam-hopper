use std::fs;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use super::error::PluginError;
use super::registry_layout::PluginRegistryLayout;

static UUID_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
});
static SHA256_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-f0-9]{64}$").unwrap());

/// Lifecycle operations managed by the transaction coordinator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleOperation {
    Install,
    Update,
    Rollback,
    Enable,
    Disable,
    Remove,
    ReplaceGrants,
    ReplaceBindings,
}

/// Durable phases of a lifecycle transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecyclePhase {
    Initiated,
    Draining,
    Stopped,
    Activating,
    Healthy,
    Published,
    Committed,
    Failed,
    Aborted,
}

impl LifecyclePhase {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            LifecyclePhase::Committed | LifecyclePhase::Failed | LifecyclePhase::Aborted
        )
    }
}

/// Information about the candidate package/generation being activated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LifecycleCandidate {
    pub plugin_id: String,
    pub version: String,
    pub package_digest: String,
    pub target_generation: u64,
}

impl LifecycleCandidate {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.plugin_id.trim().is_empty() {
            return Err(PluginError::invalid_input("candidate plugin_id cannot be empty"));
        }
        if semver::Version::parse(&self.version).is_err() {
            return Err(PluginError::invalid_input(format!(
                "Invalid candidate version: '{}'",
                self.version
            )));
        }
        if !SHA256_REGEX.is_match(&self.package_digest) {
            return Err(PluginError::invalid_input(format!(
                "Invalid candidate package digest: '{}'",
                self.package_digest
            )));
        }
        if self.target_generation == 0 {
            return Err(PluginError::invalid_input(
                "target_generation must be at least 1",
            ));
        }
        Ok(())
    }
}

/// Strict durable record for per-installation lifecycle transactions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LifecycleTransactionRecord {
    pub transaction_id: String,
    pub installation_id: String,
    pub operation: LifecycleOperation,
    pub phase: LifecyclePhase,
    pub actor_subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate: Option<LifecycleCandidate>,
    pub security_revision_before: u64,
    pub generation_before: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_after: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl LifecycleTransactionRecord {
    pub fn validate(&self) -> Result<(), PluginError> {
        if !UUID_REGEX.is_match(&self.transaction_id) {
            return Err(PluginError::invalid_input(format!(
                "Invalid lifecycle transaction ID: '{}'",
                self.transaction_id
            )));
        }
        if self.installation_id.trim().is_empty() {
            return Err(PluginError::invalid_input("installation_id cannot be empty"));
        }
        if self.actor_subject.trim().is_empty() {
            return Err(PluginError::invalid_input("actor_subject cannot be empty"));
        }
        if let Some(cand) = &self.candidate {
            cand.validate()?;
        }
        Ok(())
    }
}

/// Write a lifecycle transaction record to disk atomically with fsync.
pub fn write_lifecycle_journal_record(
    layout: &PluginRegistryLayout,
    record: &LifecycleTransactionRecord,
) -> Result<(), PluginError> {
    record.validate()?;
    let path = layout.lifecycle_journal_file(&record.transaction_id);
    let bytes = serde_json::to_vec_pretty(record).map_err(|e| {
        PluginError::invalid_input(format!(
            "Failed to serialize lifecycle journal record: {e}"
        ))
    })?;

    crate::linux_release::durable_fs::atomic_write_file(&path, &bytes, Some(0o600)).map_err(
        |e| {
            PluginError::runner_unavailable(format!(
                "Failed to write lifecycle journal record: {e}"
            ))
        },
    )?;

    if let Some(parent) = path.parent() {
        let _ = crate::linux_release::durable_fs::sync_dir(parent);
    }
    Ok(())
}

/// Read a lifecycle transaction record from disk.
pub fn read_lifecycle_journal_record(
    layout: &PluginRegistryLayout,
    transaction_id: &str,
) -> Result<LifecycleTransactionRecord, PluginError> {
    let path = layout.lifecycle_journal_file(transaction_id);
    if !path.exists() {
        return Err(PluginError::invalid_input(format!(
            "Lifecycle transaction '{transaction_id}' not found"
        )));
    }
    let content = fs::read_to_string(&path).map_err(|e| {
        PluginError::runner_unavailable(format!(
            "Failed to read lifecycle journal record: {e}"
        ))
    })?;
    let record: LifecycleTransactionRecord = serde_json::from_str(&content).map_err(|e| {
        PluginError::invalid_input(format!("Corrupt lifecycle journal record: {e}"))
    })?;
    record.validate()?;
    Ok(record)
}

/// Scan journal directory for incomplete/active lifecycle transactions.
pub fn list_pending_lifecycle_transactions(
    layout: &PluginRegistryLayout,
) -> Result<Vec<LifecycleTransactionRecord>, PluginError> {
    let dir = layout.journal_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut pending = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to read journal dir: {e}"))
    })?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("lifecycle-") && name.ends_with(".json") {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                if let Ok(record) = serde_json::from_str::<LifecycleTransactionRecord>(&content) {
                    if !record.phase.is_terminal() {
                        pending.push(record);
                    }
                }
            }
        }
    }

    Ok(pending)
}
