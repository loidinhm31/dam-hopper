//! Release, candidate, and transaction records for the manager state envelope.

use super::error::ReleaseError;
use super::inventory::TargetRole;
use super::version::{validate_release_tag, validate_sha256_hex, validate_tag_format};
use serde::{Deserialize, Serialize};

/// Detailed metadata of a committed active or previous release.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseRecord {
    pub tag: String,
    pub version: String,
    pub role: TargetRole,
    pub release_path: String,
    pub manifest_sha256: String,
    pub archive_sha256: String,
    pub installed_at: String,
    pub committed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_unit_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_unit_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_config_sha256: Option<String>,
}

impl ReleaseRecord {
    pub fn validate(&self) -> Result<(), ReleaseError> {
        validate_release_tag(&self.tag, &self.version)?;
        validate_sha256_hex(&self.manifest_sha256)?;
        validate_sha256_hex(&self.archive_sha256)?;
        if let Some(h) = &self.api_unit_sha256 {
            validate_sha256_hex(h)?;
        }
        if let Some(h) = &self.web_unit_sha256 {
            validate_sha256_hex(h)?;
        }
        if let Some(h) = &self.host_config_sha256 {
            validate_sha256_hex(h)?;
        }
        Ok(())
    }
}

/// Metadata of a staged candidate release waiting for activation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingCandidateRecord {
    pub tag: String,
    pub role: TargetRole,
    pub staged_at: String,
    pub release_path: String,
    pub manifest_sha256: String,
    pub archive_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_units_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_host_config_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_unit_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_unit_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_config_sha256: Option<String>,
}

impl PendingCandidateRecord {
    pub fn validate(&self) -> Result<(), ReleaseError> {
        validate_tag_format(&self.tag)?;
        validate_sha256_hex(&self.manifest_sha256)?;
        validate_sha256_hex(&self.archive_sha256)?;
        if let Some(h) = &self.api_unit_sha256 {
            validate_sha256_hex(h)?;
        }
        if let Some(h) = &self.web_unit_sha256 {
            validate_sha256_hex(h)?;
        }
        if let Some(h) = &self.host_config_sha256 {
            validate_sha256_hex(h)?;
        }
        Ok(())
    }
}

/// Transaction execution phase recorded during an in-flight transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionPhase {
    Staged,
    Quiesced,
    Switched,
    Probing,
    Committed,
    RollingBack,
    RolledBack,
    Failed,
}

/// In-flight transaction record for crash recovery and auditability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionRecord {
    pub tx_id: String,
    pub phase: TransactionPhase,
    pub started_at: String,
    pub target_tag: String,
    pub target_role: TargetRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_role: Option<TargetRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units_backup_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_backup_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_config_backup_path: Option<String>,
}

impl TransactionRecord {
    pub fn validate(&self) -> Result<(), ReleaseError> {
        if self.tx_id.trim().is_empty() {
            return Err(ReleaseError::Config("transaction id cannot be empty".into()));
        }
        validate_tag_format(&self.target_tag)?;
        if let Some(prev) = &self.previous_tag {
            validate_tag_format(prev)?;
        }
        Ok(())
    }
}

/// Record of the latest failure encounter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureRecord {
    pub failed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tx_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_tag: Option<String>,
    pub phase: String,
    pub sanitized_error: String,
}
