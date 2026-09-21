use std::fs;

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

use super::error::PluginError;
use super::registry_layout::PluginRegistryLayout;

static UUID_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
});
static SHA256_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-f0-9]{64}$").unwrap());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionPhase {
    Receiving,
    Inspected,
    Approved,
    Extracted,
    Registered,
    Activated,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransactionRecord {
    pub transaction_id: String,
    pub stage_id: String,
    pub phase: TransactionPhase,
    pub actor_subject: String,
    pub plugin_id: Option<String>,
    pub plugin_version: Option<String>,
    pub expected_sha256: String,
    pub actual_sha256: Option<String>,
    pub total_bytes: u64,
    pub security_revision: u64,
    pub installation_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl TransactionRecord {
    pub fn validate(&self) -> Result<(), PluginError> {
        if !UUID_REGEX.is_match(&self.transaction_id) {
            return Err(PluginError::invalid_input(format!(
                "Invalid transaction ID: '{}'",
                self.transaction_id
            )));
        }
        if !UUID_REGEX.is_match(&self.stage_id) {
            return Err(PluginError::invalid_input(format!(
                "Invalid stage ID: '{}'",
                self.stage_id
            )));
        }
        if self.actor_subject.trim().is_empty() {
            return Err(PluginError::invalid_input("actor_subject cannot be empty"));
        }
        if !SHA256_REGEX.is_match(&self.expected_sha256) {
            return Err(PluginError::invalid_input(format!(
                "Invalid expected SHA-256: '{}'",
                self.expected_sha256
            )));
        }
        if let Some(actual) = &self.actual_sha256 {
            if !SHA256_REGEX.is_match(actual) {
                return Err(PluginError::invalid_input(format!(
                    "Invalid actual SHA-256: '{}'",
                    actual
                )));
            }
        }
        Ok(())
    }
}

pub fn write_journal_record(
    layout: &PluginRegistryLayout,
    record: &TransactionRecord,
) -> Result<(), PluginError> {
    record.validate()?;
    let path = layout.journal_file(&record.transaction_id);
    let bytes = serde_json::to_vec_pretty(record).map_err(|e| {
        PluginError::invalid_input(format!("Failed to serialize journal record: {e}"))
    })?;
    crate::linux_release::durable_fs::atomic_write_file(&path, &bytes, Some(0o600)).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to write journal record: {e}"))
    })?;
    Ok(())
}

pub fn read_journal_record(
    layout: &PluginRegistryLayout,
    transaction_id: &str,
) -> Result<TransactionRecord, PluginError> {
    let path = layout.journal_file(transaction_id);
    if !path.exists() {
        return Err(PluginError::invalid_input(format!(
            "Journal record not found for transaction '{transaction_id}'"
        )));
    }
    let data = fs::read_to_string(&path).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to read journal record: {e}"))
    })?;
    let record: TransactionRecord = serde_json::from_str(&data).map_err(|e| {
        PluginError::invalid_input(format!("Failed to parse journal record: {e}"))
    })?;
    record.validate()?;
    Ok(record)
}

pub fn list_journal_records(
    layout: &PluginRegistryLayout,
) -> Result<Vec<TransactionRecord>, PluginError> {
    let dir = layout.journal_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to read journal directory: {e}"))
    })?;
    for entry in entries {
        let entry = entry.map_err(|e| {
            PluginError::runner_unavailable(format!("Failed to read journal entry: {e}"))
        })?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let data = fs::read_to_string(&path).map_err(|e| {
                PluginError::runner_unavailable(format!("Failed to read journal record: {e}"))
            })?;
            if let Ok(record) = serde_json::from_str::<TransactionRecord>(&data) {
                if record.validate().is_ok() {
                    records.push(record);
                }
            }
        }
    }
    Ok(records)
}
