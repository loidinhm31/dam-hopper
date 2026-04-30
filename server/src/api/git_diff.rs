/// Route handlers for git diff, staging, discard, conflict resolution, and commit.
///
/// All routes are scoped to a specific project: /api/git/:project/...
/// Path parameters are validated via `safe_join` inside the git::diff module.
use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};

use crate::git;
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// GET /api/git/{project}/diff  — list changed files
// ---------------------------------------------------------------------------

pub async fn list_diff(
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let resp = tokio::task::spawn_blocking(move || git::get_diff_files(&path))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// GET /api/git/{project}/untracked?offset=0&limit=500  — paginate untracked
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct UntrackedQuery {
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
}

pub async fn list_untracked(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(q): Query<UntrackedQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let limit = q.limit.unwrap_or(git::UNTRACKED_PAGE_SIZE);
    let offset = q.offset;
    let resp = tokio::task::spawn_blocking(move || git::get_untracked_page(&path, offset, limit))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// GET /api/git/{project}/diff/file?path=<rel_path>  — file diff content
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct FilePathQuery {
    pub path: String,
}

pub async fn get_file_diff(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(q): Query<FilePathQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let rel = q.path;
    let content = tokio::task::spawn_blocking(move || git::get_file_diff(&proj_path, &rel))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(content))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/stage  — { paths: string[] }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PathsBody {
    pub paths: Vec<String>,
}

pub async fn stage(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<PathsBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let paths = body.paths;
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        git::stage_files(&proj_path, &refs)
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/unstage  — { paths: string[] }
// ---------------------------------------------------------------------------

pub async fn unstage(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<PathsBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let paths = body.paths;
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        git::unstage_files(&proj_path, &refs)
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/discard  — { path: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SinglePathBody {
    pub path: String,
}

pub async fn discard(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<SinglePathBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let rel = body.path;
    tokio::task::spawn_blocking(move || git::discard_file(&proj_path, &rel))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/discard-hunk  — { path: string, hunkIndex: number }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardHunkBody {
    pub path: String,
    pub hunk_index: usize,
}

pub async fn discard_hunk(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<DiscardHunkBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let rel = body.path;
    let idx = body.hunk_index;
    tokio::task::spawn_blocking(move || git::discard_hunk(&proj_path, &rel, idx))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/git/{project}/conflicts
// ---------------------------------------------------------------------------

pub async fn list_conflicts(
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let conflicts = tokio::task::spawn_blocking(move || git::get_conflicts(&path))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(conflicts))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/resolve  — { path: string, content: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ResolveBody {
    pub path: String,
    pub content: String,
}

pub async fn resolve(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<ResolveBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let rel = body.path;
    let content = body.content;
    tokio::task::spawn_blocking(move || git::resolve_conflict(&proj_path, &rel, &content))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/commit  — { message: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CommitBody {
    pub message: String,
}

#[derive(Serialize)]
pub struct CommitResponse {
    pub ok: bool,
    pub hash: String,
}

pub async fn commit(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<CommitBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let message = body.message;
    let hash = tokio::task::spawn_blocking(move || git::commit_files(&proj_path, &message))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(CommitResponse { ok: true, hash }))
}

// ---------------------------------------------------------------------------
// GET /api/git/{project}/commit/{hash}/files  — list files in commit
// ---------------------------------------------------------------------------

pub async fn get_commit_files(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let resp = tokio::task::spawn_blocking(move || git::get_commit_files(&path, &hash))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// GET /api/git/{project}/commit/{hash}/diff?path=<rel_path>  — file diff in commit
// ---------------------------------------------------------------------------

pub async fn get_commit_file_diff(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Query(q): Query<FilePathQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = state.project_path(&project).await.map_err(ApiError::from_app)?;
    let rel = q.path;
    let content = tokio::task::spawn_blocking(move || git::get_commit_file_diff(&proj_path, &rel, &hash))
        .await
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
        .map_err(ApiError::from_app)?;
    Ok(Json(content))
}
