use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::error::PluginError;
use super::manifest::{ManifestContracts, ManifestEntrypoints, ManifestV1};

/// Root-seeded list of administrator subjects authorized for plugin management operations.
#[derive(Debug, Clone)]
pub struct AdminSubjectList {
    subjects: HashSet<String>,
    config_digest: String,
}

impl AdminSubjectList {
    pub fn new(subjects: impl IntoIterator<Item = String>) -> Self {
        let mut set = HashSet::new();
        let mut sorted = Vec::new();
        for s in subjects {
            let trimmed = s.trim().to_string();
            if !trimmed.is_empty() {
                if set.insert(trimmed.clone()) {
                    sorted.push(trimmed);
                }
            }
        }
        sorted.sort();

        let mut hasher = Sha256::new();
        for s in &sorted {
            hasher.update(s.as_bytes());
            hasher.update(b"\n");
        }
        let config_digest = hex::encode(hasher.finalize());

        Self {
            subjects: set,
            config_digest,
        }
    }

    pub fn is_admin(&self, subject: &str) -> bool {
        if self.subjects.contains(subject) {
            return true;
        }
        if subject == "dev-user" && !Self::is_production() {
            return true;
        }
        false
    }

    fn is_production() -> bool {
        std::env::var("RUST_ENV").unwrap_or_default() == "production"
            || std::env::var("ENVIRONMENT").unwrap_or_default() == "production"
    }

    pub fn config_digest(&self) -> &str {
        &self.config_digest
    }
}

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
    admin_subjects: &AdminSubjectList,
    actor_subject: &str,
    expected_sha256: &str,
    requested_security_revision: u64,
    current_security_revision: u64,
    review: &StageReviewDto,
) -> Result<(), PluginError> {
    if !admin_subjects.is_admin(actor_subject) {
        return Err(PluginError::unauthorized(format!(
            "Actor subject '{actor_subject}' is not in authorized plugin admin list"
        )));
    }

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
