use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

// ──────────────────────────────────────────────
// Status & Settings DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorStatusDto {
    pub enabled: bool,
    pub available: bool,
    pub path: Option<String>,
    pub source_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorSettingsDto {
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorSettingsUpdateDto {
    pub enabled: bool,
}

// ──────────────────────────────────────────────
// History Scan & Inventory DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDiagnosticDto {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consultation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryScanSummaryDto {
    pub status: String,
    pub projects_discovered: usize,
    pub tasks_discovered: usize,
    pub consultations_discovered: usize,
    pub accepted_records: usize,
    pub invalid_records: usize,
    pub bytes_discovered: u64,
    pub bytes_read: u64,
    pub diagnostics: Vec<HistoryDiagnosticDto>,
    pub suppressed_diagnostics: usize,
    pub limit_hit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInventoryItemDto {
    pub project_id: String,
    pub label: Option<String>,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInventoryDto {
    pub entries: Vec<ProjectInventoryItemDto>,
    pub total_projects: usize,
    pub unfiltered_total_records: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRefreshResultDto {
    pub state: String,
    pub snapshot_id: Option<String>,
    pub observed_at: u64,
    pub scan: HistoryScanSummaryDto,
    pub stale_reason: Option<String>,
    pub inventory: Option<ProjectInventoryDto>,
}

// ──────────────────────────────────────────────
// History Filters & Query DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMetricFiltersDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statuses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome_states: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome_results: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backends: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub efforts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_identities: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_identities: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at_from: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at_to: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQueryDto {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "projectId")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "taskRunId")]
    pub task_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<HistoryMetricFiltersDto>,
}

// ──────────────────────────────────────────────
// History Summary DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummaryParamsDto {
    #[serde(alias = "snapshotId")]
    pub snapshot_id: String,
    #[serde(default)]
    pub query: HistoryQueryDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummaryMetricsDto {
    pub metric_definition_version: u32,
    pub total_consultations: usize,
    pub completed_consultations: usize,
    pub advice_ready_count: usize,
    pub failed_count: usize,
    pub resolved_count: usize,
    pub unresolved_count: usize,
    pub regressed_count: usize,
    pub missing_outcome_count: usize,
    pub avg_latency_ms: Option<f64>,
    pub p95_latency_ms: Option<f64>,
    pub route_distribution: HashMap<String, usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counts: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan: Option<HistoryScanSummaryDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummaryResultDto {
    pub state: String,
    pub snapshot_id: String,
    pub metrics: HistorySummaryMetricsDto,
    pub inventory: ProjectInventoryDto,
}

// ──────────────────────────────────────────────
// History Page DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRouteDto {
    pub backend: String,
    pub model: String,
    pub effort: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRowDto {
    pub record_ref: String,
    pub project_id: String,
    pub task_run_id: String,
    pub consultation_id: String,
    pub status: String,
    pub route: HistoryRouteDto,
    pub checkpoint_digest: String,
    pub prompt_identity: String,
    pub build_identity: String,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub receipt_elapsed_ms: Option<u64>,
    pub outcome_state: String,
    pub outcome_result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPageParamsDto {
    #[serde(alias = "snapshotId")]
    pub snapshot_id: String,
    #[serde(default)]
    pub query: HistoryQueryDto,
    #[serde(default = "default_page_sort")]
    pub sort: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

fn default_page_sort() -> String {
    "started_at_desc".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPageResultDto {
    pub state: String,
    pub snapshot_id: String,
    pub entries: Vec<HistoryRowDto>,
    pub next_cursor: Option<String>,
    pub returned_bytes: usize,
}

// ──────────────────────────────────────────────
// History Detail DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetailParamsDto {
    #[serde(alias = "snapshotId")]
    pub snapshot_id: String,
    #[serde(alias = "recordRef")]
    pub record_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetailResultDto {
    pub status: String, // "ready" | "changed" | "missing"
    pub snapshot_id: String,
    pub record_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<serde_json::Value>,
}

// ──────────────────────────────────────────────
// Internal Captured / Normalized Record Models
// ──────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RawRecordCaptured {
    pub record_ref: String,
    pub project_id: String,
    pub task_run_id: String,
    pub consultation_id: String,
    pub exec_path: PathBuf,
    pub out_path: PathBuf,
    pub has_outcome: bool,
    pub exec_fingerprint: String,
    pub out_fingerprint: Option<String>,
    pub exec_dev: u64,
    pub exec_ino: u64,
    pub exec_size: u64,
    pub out_dev: Option<u64>,
    pub out_ino: Option<u64>,
    pub out_size: u64,
}

#[derive(Debug, Clone)]
pub struct NormalizedHistoryRecord {
    pub project_id: String,
    pub task_run_id: String,
    pub consultation_id: String,
    pub status: String,
    pub checkpoint_digest: String,
    pub route: HistoryRouteDto,
    pub prompt_identity: String,
    pub build_identity: String,
    pub attempts: Vec<serde_json::Value>,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub receipt_elapsed_ms: Option<u64>,
    pub error: Option<serde_json::Value>,
    pub outcome_state: String,
    pub outcome_result: Option<String>,
    pub source_relative_path: String,
}

#[derive(Debug, Clone)]
pub struct HistorySnapshot {
    pub snapshot_id: String,
    pub owner_subject: String,
    pub state: String,
    pub observed_at: u64,
    pub last_accessed_at: u64,
    pub scan: HistoryScanSummaryDto,
    pub rows: Vec<HistoryRowDto>,
    pub raw_records: HashMap<String, RawRecordCaptured>,
    pub normalized_records: Vec<NormalizedHistoryRecord>,
    pub inventory: ProjectInventoryDto,
}
