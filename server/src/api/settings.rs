use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;

use crate::config::read_config;
use crate::state::project_roots_from_config;
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// POST /api/settings/cache-clear  (cache:clear IPC)
// ---------------------------------------------------------------------------

pub async fn cache_clear(State(state): State<AppState>) -> impl IntoResponse {
    // In the Rust server there's no in-process cache beyond RwLock fields.
    // Re-reading config is the closest equivalent.
    let _workspace_context = state.workspace_context_guard.write().await;
    let config_path = state.config.read().await.config_path.clone();
    match read_config(&config_path) {
        Ok(cfg) => {
            state.semantic_supervisor.invalidate_workspace().await;
            state.media_tickets.revoke_all();
            state.fs.reinit_sandbox(project_roots_from_config(&cfg));
            state
                .host_resource_monitor
                .reconfigure(cfg.server.host_resources.clone())
                .await;
            *state.config.write().await = cfg;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// POST /api/settings/reset  (workspace:reset IPC)
// ---------------------------------------------------------------------------

pub async fn reset(State(state): State<AppState>) -> impl IntoResponse {
    // Stop all PTY and semantic sessions — equivalent to workspace reset
    state.pty_manager.dispose();
    state.semantic_supervisor.invalidate_workspace().await;
    Json(serde_json::json!({ "ok": true })).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/settings/export
// ---------------------------------------------------------------------------

pub async fn export_settings(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    let gc = state.global_config.read().await;
    let export = serde_json::json!({
        "config": *cfg,
        "globalConfig": *gc,
    });
    Json(export).into_response()
}

// ---------------------------------------------------------------------------
// POST /api/settings/import  { config?, globalConfig? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBody {
    pub global_config: Option<crate::config::GlobalConfig>,
}

pub async fn import_settings(
    State(state): State<AppState>,
    Json(body): Json<ImportBody>,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(gc) = body.global_config {
        let gc_path = crate::config::global_config_path();
        crate::config::write_global_config_at(&gc_path, &gc).map_err(ApiError::from_app)?;
        *state.global_config.write().await = gc;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

pub async fn health(_state: State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
