use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use std::collections::HashMap;

use crate::pty::manager::PtyCreateOpts;
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// POST /api/terminal
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionBody {
    pub id: String,
    pub command: String,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
    pub project: Option<String>,
}

fn default_cols() -> u16 { 80 }
fn default_rows() -> u16 { 24 }

pub async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<CreateSessionBody>,
) -> Result<impl IntoResponse, ApiError> {
    let cwd = body.cwd.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    });
    let meta = state.pty_manager.create(PtyCreateOpts {
        id: body.id,
        command: body.command,
        cwd,
        env: body.env,
        cols: body.cols,
        rows: body.rows,
        project: body.project,
    }).map_err(ApiError::from_app)?;
    Ok(Json(meta))
}

// ---------------------------------------------------------------------------
// GET /api/terminal
// ---------------------------------------------------------------------------

pub async fn list_sessions(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.pty_manager.list()).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/terminal/detailed
// ---------------------------------------------------------------------------

pub async fn list_detailed(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.pty_manager.list_detailed()).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/terminal/:id/buffer
// ---------------------------------------------------------------------------

pub async fn get_buffer(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let buffer = state.pty_manager.get_buffer(&id).map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "buffer": buffer })))
}

// ---------------------------------------------------------------------------
// DELETE /api/terminal/:id  — kill (keep tombstone)
// ---------------------------------------------------------------------------

pub async fn kill_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    state.pty_manager.kill(&id).map_err(ApiError::from_app)?;
    Ok((StatusCode::NO_CONTENT, ()))
}

// ---------------------------------------------------------------------------
// DELETE /api/terminal/:id/remove  — kill + evict
// ---------------------------------------------------------------------------

pub async fn remove_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    state.pty_manager.remove(&id).map_err(ApiError::from_app)?;
    Ok((StatusCode::NO_CONTENT, ()))
}
