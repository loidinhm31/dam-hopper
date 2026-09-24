use serde::{Deserialize, Serialize};

pub const RUNNER_PROTOCOL_VERSION: &str = "1.0.0";
pub const WORKER_SDK_VERSION: &str = "1.0.0";
pub const UI_BRIDGE_VERSION: &str = "1.0.0";

pub mod budgets {
    pub const MAX_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
    pub const MAX_CONTROL_BYTES: usize = 64 * 1024;
    pub const MAX_PACKAGE_COMPRESSED_BYTES: usize = 32 * 1024 * 1024;
    pub const MAX_PACKAGE_EXPANDED_BYTES: usize = 64 * 1024 * 1024;
    pub const MAX_PACKAGE_ENTRIES: usize = 2048;
    pub const MAX_UI_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;
    pub const MAX_OPERATIONS_PER_CONTEXT: usize = 4;
    pub const MAX_OPERATIONS_PER_WORKER: usize = 16;
    pub const MAX_QUEUE_CAPACITY: usize = 32;
    pub const MAX_CONTEXTS_PER_WORKER: usize = 16;
    pub const CONTEXT_IDLE_TTL_SECS: u64 = 15 * 60;
    pub const MAX_SNAPSHOTS_PER_CONTEXT: usize = 2;
    pub const MAX_AGGREGATE_SNAPSHOT_BYTES: usize = 128 * 1024 * 1024;
    pub const SNAPSHOT_IDLE_TTL_SECS: u64 = 5 * 60;
    pub const MAX_ACTIVE_SCANS_PER_WORKER: usize = 1;
    pub const MAX_SCAN_IO_BYTES: usize = 256 * 1024 * 1024;
    pub const SCAN_DEADLINE_SECS: u64 = 30;
    pub const AGGREGATE_BUFFERED_FRAMES_BYTES: usize = 64 * 1024 * 1024;
    pub const DEFAULT_PAGE_SIZE: usize = 100;
    pub const MAX_PAGE_SIZE: usize = 500;
    pub const MAX_PAGE_RESULT_BYTES: usize = 1024 * 1024;
    pub const MAX_EVALUATION_FILE_READ_BYTES: usize = 8 * 1024 * 1024;
    pub const WORKER_CGROUP_MEMORY_MAX_BYTES: usize = 1024 * 1024 * 1024;
    pub const WORKER_CGROUP_TASKS_MAX: usize = 64;
    pub const WORKER_RSS_TARGET_BYTES: usize = 512 * 1024 * 1024;
    pub const HANDSHAKE_TIMEOUT_SECS: u64 = 5;
    pub const ORDINARY_REQUEST_TIMEOUT_SECS: u64 = 10;
    pub const GRACEFUL_STOP_TIMEOUT_SECS: u64 = 5;
    pub const MAX_CRASH_FAILURES: usize = 3;
    pub const CRASH_WINDOW_SECS: u64 = 60;
}

pub const PUBLIC_RUNNER_METHODS: &[&str] = &[
    "runner.hello",
    "plugin.list",
    "plugin.readUi",
    "plugin.activate",
    "plugin.deactivate",
    "context.open",
    "context.close",
    "plugin.invoke",
    "request.cancel",
];

pub const ADMIN_RUNNER_METHODS: &[&str] = &[
    "management.stage.begin",
    "management.stage.chunk",
    "management.stage.finish",
    "management.approve",
    "management.rollback",
    "management.disable",
    "management.enable",
    "management.remove",
    "management.grants.replace",
    "management.bindings.replace",
    "management.installations.list",
    "management.installations.get",
];

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantKey {
    pub actor_subject: String,
    pub installation_id: String,
    pub configured_project_target: String,
    pub allowed_operations: Vec<String>,
    pub allow_current_account_policy: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CancelOutcome {
    Accepted,
    AlreadySettled,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerHelloParams {
    pub host_version: String,
    pub client_protocol_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerHelloResult {
    pub runner_version: String,
    pub negotiated_protocol_version: String,
    pub supported_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginListParams {
    #[serde(default)]
    pub include_disabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMetadataItem {
    pub id: String,
    pub version: String,
    pub publisher: String,
    pub capabilities: Vec<String>,
    pub has_ui: bool,
    pub active_digest: String,
    pub active_generation: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginListResult {
    pub plugins: Vec<PluginMetadataItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginReadUiParams {
    pub installation_id: String,
    pub expected_digest: String,
    pub activation_generation: u64,
    pub actor_subject: String,
    pub project_target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginReadUiResult {
    pub raw_bytes_base64: String,
    pub sha256: String,
    pub size: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActivateParams {
    pub installation_id: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActivateResult {
    pub activation_generation: u64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDeactivateParams {
    pub installation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDeactivateResult {
    pub status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContextScopeKind {
    Project,
    HistoryRoot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextScopeDescriptor {
    pub kind: ContextScopeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_revision: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextOpenParams {
    pub actor_subject: String,
    pub installation_id: String,
    pub configured_project_target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<ContextScopeDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    pub allowed_operations: Vec<String>,
    pub allow_current_account_policy: bool,
    pub api_connection_epoch: u64,
    pub activation_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextOpenResult {
    pub context_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_kind: Option<ContextScopeKind>,
    pub binding_revision: u64,
    pub grant_revision: u64,
    pub activation_generation: u64,
    pub expires_at: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCloseParams {
    pub context_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCloseResult {
    pub closed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginInvokeParams {
    pub context_id: String,
    pub operation: String,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInvokeResult {
    pub result: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestCancelParams {
    pub context_id: String,
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestCancelResult {
    pub outcome: CancelOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerHealthNotification {
    pub worker_pid: u32,
    pub status: String,
    pub rss_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerShutdownNotification {
    pub worker_pid: u32,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementStageBeginParams {
    pub expected_sha256: String,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementStageBeginResult {
    pub stage_id: String,
    pub transaction_id: String,
    pub max_chunk_size: usize,
    pub security_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementStageChunkParams {
    pub stage_id: String,
    pub sequence: u64,
    pub chunk_bytes_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementStageChunkResult {
    pub received_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementStageFinishParams {
    pub stage_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementApproveParams {
    pub stage_id: String,
    pub expected_sha256: String,
    pub security_revision: u64,
}
