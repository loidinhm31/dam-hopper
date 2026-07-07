use axum::{extract::State, Json};
use serde_json::Value;

use crate::{
    diagnostics::{
        BackendDiagnostics, DiagnosticExportManifest, DiagnosticExportRequest,
        DiagnosticExportResponse, DiagnosticScope, TerminalDiagnostics,
    },
    state::AppState,
};

/// POST /api/diagnostics/export - local diagnostics bundle for debugging.
pub async fn export_diagnostics(
    State(state): State<AppState>,
    request: Option<Json<DiagnosticExportRequest>>,
) -> Json<DiagnosticExportResponse> {
    let request = request.map(|Json(request)| request).unwrap_or_default();
    let workspace_root = state.workspace_dir.read().await.clone();
    let system = state.host_metrics.sample(&workspace_root);
    let diagnostics = state.diagnostics.clone();
    let window_minutes = request.window_minutes;
    let backend_events =
        tokio::task::spawn_blocking(move || diagnostics.recent_events(window_minutes))
            .await
            .unwrap_or_default();
    let effective_window_minutes = state
        .diagnostics
        .effective_window_minutes(request.window_minutes);
    let stats = state.diagnostics.stats();
    let terminal_sessions = state
        .pty_manager
        .list_detailed()
        .into_iter()
        .filter_map(|session| serde_json::to_value(session).ok())
        .collect::<Vec<_>>();

    Json(DiagnosticExportResponse {
        diagnostic_schema_version: 1,
        generated_at: crate::diagnostics::now_ms(),
        scope: DiagnosticScope {
            window_minutes: effective_window_minutes,
            include_terminal_output: request.include_terminal_output,
            terminal_tail_bytes: request.terminal_tail_bytes,
            terminal_ids: request.terminal_ids,
        },
        manifest: DiagnosticExportManifest {
            backend_event_count: backend_events.len(),
            terminal_session_count: terminal_sessions.len(),
            retention_minutes: state.diagnostics.retention_minutes(),
            storage: "localConfigJsonl".to_string(),
            dropped_persist_events: stats.dropped_persist_events,
            persist_error_count: stats.persist_error_count,
        },
        frontend: request.frontend.unwrap_or(Value::Null),
        backend: BackendDiagnostics {
            events: backend_events,
        },
        terminals: TerminalDiagnostics {
            sessions: terminal_sessions,
            tails: Vec::new(),
        },
        system,
    })
}
