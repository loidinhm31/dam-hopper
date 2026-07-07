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
    // Preserve the distinction between omitted terminalIds (default/all) and
    // an explicit empty list (no terminal sessions or tails).
    let scoped_terminal_ids: Option<Vec<String>> = request.terminal_ids.clone();
    let backend_events = {
        let scoped_terminal_ids = scoped_terminal_ids.clone();
        tokio::task::spawn_blocking(move || diagnostics.recent_events(window_minutes))
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|event| {
                scoped_terminal_ids.as_ref().is_none_or(|ids| {
                    event
                        .fields
                        .get("sessionId")
                        .is_none_or(|session_id| ids.iter().any(|id| id == session_id))
                })
            })
            .collect::<Vec<_>>()
    };
    let effective_window_minutes = state
        .diagnostics
        .effective_window_minutes(request.window_minutes);
    let stats = state.diagnostics.stats();
    let terminal_sessions = state
        .pty_manager
        .list_detailed()
        .into_iter()
        .filter(|session| {
            scoped_terminal_ids
                .as_ref()
                .is_none_or(|ids| ids.iter().any(|id| id == &session.meta.id))
        })
        .filter_map(|session| serde_json::to_value(session).ok())
        .collect::<Vec<_>>();

    // Build terminal tails (Phase 03): capped + redacted scrollback tail per session.
    let terminal_tails: Vec<Value> = if request.include_terminal_output {
        // Determine which session IDs to collect tails for.
        let known_ids: Vec<String> = match &scoped_terminal_ids {
            Some(ids) => ids.clone(),
            // Default: all known sessions (live + dead tombstones).
            _ => state
                .pty_manager
                .list()
                .into_iter()
                .map(|meta| meta.id)
                .collect(),
        };
        let max_bytes = request.terminal_tail_bytes;
        let pty_manager = state.pty_manager.clone();
        known_ids
            .iter()
            .filter_map(|id| pty_manager.terminal_tail(id, max_bytes))
            .filter_map(|tail| serde_json::to_value(tail).ok())
            .collect()
    } else {
        Vec::new()
    };

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
            tails: terminal_tails,
        },
        system,
    })
}
