use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportRequest {
    #[serde(default = "default_window_minutes")]
    pub window_minutes: u64,
    #[serde(default = "default_include_terminal_output")]
    pub include_terminal_output: bool,
    #[serde(default = "default_terminal_tail_bytes")]
    pub terminal_tail_bytes: usize,
    #[serde(default)]
    pub terminal_ids: Option<Vec<String>>,
    #[serde(default, alias = "frontendSnapshot")]
    pub frontend: Option<Value>,
}

impl Default for DiagnosticExportRequest {
    fn default() -> Self {
        Self {
            window_minutes: default_window_minutes(),
            include_terminal_output: default_include_terminal_output(),
            terminal_tail_bytes: default_terminal_tail_bytes(),
            terminal_ids: None,
            frontend: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub timestamp_ms: u64,
    pub level: String,
    pub source: String,
    pub message: String,
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportResponse {
    pub diagnostic_schema_version: u8,
    pub generated_at: u64,
    pub scope: DiagnosticScope,
    pub manifest: DiagnosticExportManifest,
    pub frontend: Value,
    pub backend: BackendDiagnostics,
    pub terminals: TerminalDiagnostics,
    pub system: crate::system::HostMetrics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticScope {
    pub window_minutes: u64,
    pub include_terminal_output: bool,
    pub terminal_tail_bytes: usize,
    pub terminal_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportManifest {
    pub backend_event_count: usize,
    pub terminal_session_count: usize,
    pub retention_minutes: u64,
    pub storage: String,
    pub dropped_persist_events: u64,
    pub persist_error_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendDiagnostics {
    pub events: Vec<DiagnosticEvent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDiagnostics {
    pub sessions: Vec<serde_json::Value>,
    pub tails: Vec<serde_json::Value>,
}

fn default_window_minutes() -> u64 {
    60
}

fn default_include_terminal_output() -> bool {
    true
}

fn default_terminal_tail_bytes() -> usize {
    65_536
}
