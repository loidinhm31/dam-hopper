use axum::{extract::State, response::IntoResponse, Json};
use serde_json::json;

use crate::state::AppState;

/// GET /api/ports — returns all currently detected ports.
///
/// Returns `{ "ports": [] }` on non-Linux or when port forward manager is absent.
pub async fn list_ports(State(state): State<AppState>) -> impl IntoResponse {
    let ports = match &state.port_forward_manager {
        Some(pfm) => pfm.list().await,
        None => vec![],
    };
    Json(json!({ "ports": ports }))
}
