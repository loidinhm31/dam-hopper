use std::collections::BTreeMap;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::contract::GrantKey;
pub use super::registry_state::OwnerHistorySource;
pub use super::trust::StageReviewDto;

/// Grant configuration supplied at approval before the installation ID is known.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InitialGrant {
    pub actor_subject: String,
    pub configured_project_target: String,
    pub allowed_operations: Vec<String>,
    #[serde(default)]
    pub allow_current_account_policy: bool,
}
// ---------------------------------------------------------------------------
// Admin RPC DTOs (used over Unix domain socket RPC)
// ---------------------------------------------------------------------------

pub use super::registry_stage::StageBeginResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageBeginParams {
    pub expected_sha256: String,
    pub total_bytes: u64,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageChunkParams {
    pub stage_id: String,
    pub sequence: u64,
    pub chunk_base64: String,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageChunkResult {
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageFinishParams {
    pub stage_id: String,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveStageParams {
    pub stage_id: String,
    pub expected_sha256: String,
    pub expected_security_revision: u64,
    #[serde(default)]
    pub initial_bindings: BTreeMap<String, String>,
    #[serde(default)]
    pub initial_grants: Vec<InitialGrant>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackParams {
    pub installation_id: String,
    pub expected_security_revision: u64,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnableParams {
    pub installation_id: String,
    pub expected_security_revision: u64,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisableParams {
    pub installation_id: String,
    pub expected_security_revision: u64,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveParams {
    pub installation_id: String,
    pub expected_security_revision: u64,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceGrantsParams {
    pub installation_id: String,
    pub expected_security_revision: u64,
    pub grants: Vec<GrantKey>,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceBindingsParams {
    pub installation_id: String,
    pub expected_security_revision: u64,
    pub bindings: BTreeMap<String, String>,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceOwnerHistorySourceParams {
    pub installation_id: String,
    pub expected_security_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
    pub actor_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminListParams {
    pub actor_subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginActorGrantsParams {
    pub actor_subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActorGrantsResult {
    pub grants: Vec<GrantKey>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdminGetParams {
    pub installation_id: String,
    pub actor_subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPackageSnapshotDto {
    pub package_digest: String,
    pub version: String,
    pub bindings: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
    pub published_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminInstallationDto {
    pub installation_id: String,
    pub plugin_id: String,
    pub active_package_digest: String,
    pub active_version: String,
    pub activation_generation: u64,
    pub enabled: bool,
    pub bindings: BTreeMap<String, String>,
    pub grants: Vec<GrantKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
    pub has_ui: bool,
    pub worker_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_package: Option<RollbackPackageSnapshotDto>,
    pub can_rollback: bool,
    pub security_revision: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminInstallationListResult {
    pub installations: Vec<AdminInstallationDto>,
    pub security_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminRemoveResult {
    pub installation_id: String,
    pub removed: bool,
    pub cleaned_packages: Vec<String>,
}

// ---------------------------------------------------------------------------
// HTTP Request / Response DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveStageRequest {
    pub expected_sha256: String,
    pub expected_security_revision: u64,
    #[serde(default)]
    pub initial_bindings: BTreeMap<String, String>,
    #[serde(default)]
    pub initial_grants: Vec<InitialGrant>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleActionRequest {
    pub expected_security_revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceGrantsRequest {
    pub expected_security_revision: u64,
    pub grants: Vec<GrantKey>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceBindingsRequest {
    pub expected_security_revision: u64,
    pub bindings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceOwnerHistorySourceRequest {
    pub expected_security_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
}

// ---------------------------------------------------------------------------
// Redacted Audit Records
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuditRecord {
    pub timestamp: String,
    pub actor: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_generation: Option<u64>,
    pub security_revision: u64,
    pub outcome: String,
}

impl AdminAuditRecord {
    pub fn new(
        actor: impl Into<String>,
        operation: impl Into<String>,
        security_revision: u64,
        outcome: impl Into<String>,
    ) -> Self {
        Self {
            timestamp: Utc::now().to_rfc3339(),
            actor: actor.into(),
            operation: operation.into(),
            installation_id: None,
            package_digest: None,
            old_generation: None,
            new_generation: None,
            security_revision,
            outcome: outcome.into(),
        }
    }
}

pub fn record_admin_audit(record: &AdminAuditRecord) {
    tracing::info!(
        target: "plugin::admin::audit",
        timestamp = %record.timestamp,
        actor = %record.actor,
        operation = %record.operation,
        installation_id = ?record.installation_id,
        package_digest = ?record.package_digest,
        old_generation = ?record.old_generation,
        new_generation = ?record.new_generation,
        security_revision = record.security_revision,
        outcome = %record.outcome,
        "Plugin admin audit event"
    );
}
