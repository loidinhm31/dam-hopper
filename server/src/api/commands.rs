use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::state::AppState;

// ---------------------------------------------------------------------------
// GET /api/commands/search?query=&projectType=&limit=
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub query: String,
    pub project_type: Option<String>,
    pub limit: Option<usize>,
}

pub async fn search_commands(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    let limit = q.limit.unwrap_or(20);
    let results = match &q.project_type {
        Some(pt) => state.command_registry.search_by_type(&q.query, pt, limit),
        None => state.command_registry.search(&q.query, limit),
    };
    Json(results).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/commands?projectType=
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub project_type: String,
}

pub async fn list_commands(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let commands = state.command_registry.get_commands(&q.project_type).to_vec();
    Json(commands).into_response()
}
