use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::fs::ops::{self, MAX_READ_BYTES};
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// Shared param / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ProjectPathParams {
    pub project: String,
    pub path: String,
}

#[derive(Deserialize)]
pub struct ReadParams {
    pub project: String,
    pub path: String,
    pub offset: Option<u64>,
    pub len: Option<u64>,
}

#[derive(Serialize)]
pub struct ListResponse {
    pub entries: Vec<crate::fs::DirEntry>,
}

#[derive(Serialize)]
pub struct BinaryResponse {
    pub binary: bool,
    pub mime: Option<String>,
}

// ---------------------------------------------------------------------------
// Helper: resolve + validate a project-relative path
// ---------------------------------------------------------------------------

async fn resolve(
    state: &AppState,
    project: &str,
    rel_path: &str,
) -> Result<std::path::PathBuf, AppError> {
    let project_abs = state.project_path(project).await?;
    let sandbox = state.fs.sandbox().map_err(AppError::Fs)?;
    let proposed = project_abs.join(rel_path);
    sandbox.validate(proposed).await.map_err(AppError::Fs)
}

// ---------------------------------------------------------------------------
// GET /api/fs/list?project=NAME&path=REL
// ---------------------------------------------------------------------------

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ProjectPathParams>,
) -> Result<Json<ListResponse>, ApiError> {
    let canonical = resolve(&state, &params.project, &params.path)
        .await
        .map_err(ApiError::from)?;
    let entries = ops::list_dir(&canonical).await.map_err(AppError::Fs)?;
    Ok(Json(ListResponse { entries }))
}

// ---------------------------------------------------------------------------
// GET /api/fs/read?project=NAME&path=REL[&offset=N&len=M]
// ---------------------------------------------------------------------------

pub async fn read(
    State(state): State<AppState>,
    Query(params): Query<ReadParams>,
) -> Result<Response, ApiError> {
    let canonical = resolve(&state, &params.project, &params.path)
        .await
        .map_err(ApiError::from)?;

    let (is_binary, mime) = ops::detect_binary(&canonical)
        .await
        .map_err(AppError::Fs)?;

    if is_binary {
        let body = Json(BinaryResponse { binary: true, mime });
        return Ok(body.into_response());
    }

    let range = params.offset.zip(params.len);
    let bytes = ops::read_file(&canonical, range, MAX_READ_BYTES)
        .await
        .map_err(AppError::Fs)?;

    let content_type = mime_guess::from_path(&canonical)
        .first_raw()
        .unwrap_or("text/plain")
        .to_string();

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type)],
        bytes,
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// GET /api/fs/stat?project=NAME&path=REL
// ---------------------------------------------------------------------------

pub async fn stat(
    State(state): State<AppState>,
    Query(params): Query<ProjectPathParams>,
) -> Result<Json<crate::fs::FileStat>, ApiError> {
    let canonical = resolve(&state, &params.project, &params.path)
        .await
        .map_err(ApiError::from)?;
    let file_stat = ops::stat(&canonical).await.map_err(AppError::Fs)?;
    Ok(Json(file_stat))
}
