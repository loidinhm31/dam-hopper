use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::error::PluginError;
use super::manifest::{ManifestContracts, ManifestEntrypoints, ManifestV1};
/// Strict review DTO returned after a package has been streamed and inspected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StageReviewDto {
    pub stage_id: String,
    pub transaction_id: String,
    pub plugin_id: String,
    pub version: String,
    pub publisher: String,
    pub host_version_range: String,
    pub contracts: ManifestContracts,
    pub capabilities: Vec<String>,
    pub entrypoints: ManifestEntrypoints,
    pub total_entries: usize,
    pub uncompressed_bytes: u64,
    pub archive_sha256: String,
    pub security_revision: u64,
    pub stage_expires_at: String,
}

impl StageReviewDto {
    pub fn from_manifest(
        stage_id: &str,
        transaction_id: &str,
        manifest: &ManifestV1,
        archive_sha256: &str,
        uncompressed_bytes: u64,
        security_revision: u64,
        expires_at: DateTime<Utc>,
    ) -> Self {
        Self {
            stage_id: stage_id.to_string(),
            transaction_id: transaction_id.to_string(),
            plugin_id: manifest.id.clone(),
            version: manifest.version.clone(),
            publisher: manifest.publisher.clone(),
            host_version_range: manifest.host_version_range.clone(),
            contracts: manifest.contracts.clone(),
            capabilities: manifest.capabilities.clone(),
            entrypoints: manifest.entrypoints.clone(),
            total_entries: manifest.inventory.len(),
            uncompressed_bytes,
            archive_sha256: archive_sha256.to_lowercase(),
            security_revision,
            stage_expires_at: expires_at.to_rfc3339(),
        }
    }
}

/// Validates that an approval request satisfies all security revision, actor, and digest constraints.
pub fn validate_stage_approval(
    _actor_subject: &str,
    expected_sha256: &str,
    requested_security_revision: u64,
    current_security_revision: u64,
    review: &StageReviewDto,
) -> Result<(), PluginError> {

    if requested_security_revision != current_security_revision {
        return Err(PluginError::forbidden(format!(
            "Approval security revision mismatch: request specified {}, current is {}",
            requested_security_revision, current_security_revision
        )));
    }

    if review.security_revision != current_security_revision {
        return Err(PluginError::forbidden(format!(
            "Stage invalidated by security revision update: stage had {}, current is {}",
            review.security_revision, current_security_revision
        )));
    }

    let expected_lower = expected_sha256.to_lowercase();
    if expected_lower != review.archive_sha256 {
        return Err(PluginError::invalid_input(format!(
            "Approval digest mismatch: expected {}, stage review has {}",
            expected_lower, review.archive_sha256
        )));
    }

    let expires_at = DateTime::parse_from_rfc3339(&review.stage_expires_at)
        .map_err(|e| {
            PluginError::invalid_input(format!("Invalid stage expiration timestamp: {e}"))
        })?
        .with_timezone(&Utc);

    if Utc::now() > expires_at {
        return Err(PluginError::deadline_exceeded(format!(
            "Stage review token has expired at {}",
            review.stage_expires_at
        )));
    }

    Ok(())
}
