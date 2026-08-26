use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::fs::ops::{self, MAX_READ_BYTES, MAX_WORKSPACE_SEARCH_RESULTS};
use crate::state::AppState;
use crate::workspace_target::{ProjectTargetRef, ResolvedProjectTarget};

use super::error::ApiError;

// ---------------------------------------------------------------------------
// Search types
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SearchScope {
    #[default]
    Project,
    Workspace,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    pub project: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    pub q: String,
    pub case: Option<bool>,
    pub max: Option<usize>,
    #[serde(default)]
    pub scope: SearchScope,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub matches: Vec<ops::SearchMatch>,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct PathSearchResponse {
    pub query: String,
    pub matches: Vec<ops::PathSearchMatch>,
    pub truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageFilesParams {
    pub project: String,
    #[serde(default)]
    pub worktree_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Shared param / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathParams {
    pub project: String,
    #[serde(default)]
    pub worktree_path: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadParams {
    pub project: String,
    #[serde(default)]
    pub worktree_path: Option<String>,
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

pub(super) struct ResolvedFsPath {
    pub target: ResolvedProjectTarget,
    pub canonical: std::path::PathBuf,
}

pub(super) async fn resolve(
    state: &AppState,
    target_ref: &ProjectTargetRef,
    rel_path: &str,
) -> Result<ResolvedFsPath, AppError> {
    if std::path::Path::new(rel_path).is_absolute() {
        return Err(AppError::Fs(crate::fs::FsError::PathEscape));
    }
    let target = state.resolve_project_target(target_ref).await?;
    let sandbox = state.fs.sandbox().map_err(AppError::Fs)?;
    let proposed = target.target_path().join(rel_path);
    let canonical = sandbox
        .validate_target(&target, proposed)
        .await
        .map_err(AppError::Fs)?;
    Ok(ResolvedFsPath { target, canonical })
}

fn target_ref(project: String, worktree_path: Option<String>) -> ProjectTargetRef {
    ProjectTargetRef {
        project,
        worktree_path,
    }
}

// ---------------------------------------------------------------------------
// GET /api/fs/list?project=NAME&path=REL
// ---------------------------------------------------------------------------

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ProjectPathParams>,
) -> Result<Json<ListResponse>, ApiError> {
    let resolved = resolve(
        &state,
        &target_ref(params.project, params.worktree_path),
        &params.path,
    )
    .await
    .map_err(ApiError::from)?;
    let entries = ops::list_dir(&resolved.canonical)
        .await
        .map_err(AppError::Fs)?;
    Ok(Json(ListResponse { entries }))
}

// ---------------------------------------------------------------------------
// GET /api/fs/read?project=NAME&path=REL[&offset=N&len=M]
// ---------------------------------------------------------------------------

pub async fn read(
    State(state): State<AppState>,
    Query(params): Query<ReadParams>,
) -> Result<Response, ApiError> {
    let resolved = resolve(
        &state,
        &target_ref(params.project, params.worktree_path),
        &params.path,
    )
    .await
    .map_err(ApiError::from)?;
    let canonical = resolved.canonical;

    let (is_binary, mime) = ops::detect_binary(&canonical).await.map_err(AppError::Fs)?;

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
    let resolved = resolve(
        &state,
        &target_ref(params.project, params.worktree_path),
        &params.path,
    )
    .await
    .map_err(ApiError::from)?;
    let file_stat = ops::stat(&resolved.canonical).await.map_err(AppError::Fs)?;
    Ok(Json(file_stat))
}

// ---------------------------------------------------------------------------
// GET /api/fs/language-files?project=NAME
// ---------------------------------------------------------------------------

pub async fn language_files(
    State(state): State<AppState>,
    Query(params): Query<LanguageFilesParams>,
) -> Result<Json<ops::LanguageScanResult>, ApiError> {
    let resolved = resolve(
        &state,
        &target_ref(params.project, params.worktree_path),
        "",
    )
    .await
    .map_err(ApiError::from)?;
    let result = ops::scan_language_files(&resolved.canonical)
        .await
        .map_err(AppError::Fs)?;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// GET /api/fs/download?project=NAME&path=REL
// ---------------------------------------------------------------------------

pub async fn download(
    State(state): State<AppState>,
    Query(params): Query<ProjectPathParams>,
) -> Result<Response, ApiError> {
    let resolved = resolve(
        &state,
        &target_ref(params.project, params.worktree_path),
        &params.path,
    )
    .await
    .map_err(ApiError::from)?;
    let canonical = resolved.canonical;

    let meta = tokio::fs::metadata(&canonical)
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;

    if !meta.is_file() {
        return Err(ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)));
    }

    let filename = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".to_string());

    let content_type = mime_guess::from_path(&canonical)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_string();

    // Percent-encode non-ASCII for RFC 5987 compatibility.
    let encoded_name: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect();

    let disposition =
        format!("attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_name}");

    let file = tokio::fs::File::open(&canonical)
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;

    let stream = tokio_util::io::ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CONTENT_LENGTH, meta.len().to_string()),
        ],
        body,
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// GET /api/fs/search?project=NAME&q=QUERY[&case=true&max=N&scope=project|workspace]
// ---------------------------------------------------------------------------

pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, ApiError> {
    let case = params.case.unwrap_or(false);
    let query = params.q.clone();

    if params.scope == SearchScope::Workspace {
        if params.worktree_path.is_some() {
            return Err(ApiError::from(AppError::InvalidInput(
                "worktreePath is not supported for workspace scope".into(),
            )));
        }
        let projects: Vec<(String, std::path::PathBuf)> = {
            let cfg = state.config.read().await;
            cfg.projects
                .iter()
                .map(|p| (p.name.clone(), std::path::PathBuf::from(&p.path)))
                .collect()
        };
        let (matches, truncated) =
            ops::search_workspace(projects, &query, case, 200, MAX_WORKSPACE_SEARCH_RESULTS).await;
        Ok(Json(SearchResponse {
            query,
            matches,
            truncated,
        }))
    } else {
        let project_name = params.project.ok_or_else(|| {
            ApiError::from(AppError::InvalidInput(
                "project parameter required for project scope".into(),
            ))
        })?;
        let root = resolve(&state, &target_ref(project_name, params.worktree_path), "")
            .await
            .map_err(ApiError::from)?;
        let max = params.max.unwrap_or(200).min(ops::MAX_SEARCH_RESULTS);
        let (matches, truncated) = ops::search_files(&root.canonical, &query, case, max)
            .await
            .map_err(AppError::Fs)?;
        Ok(Json(SearchResponse {
            query,
            matches,
            truncated,
        }))
    }
}

// ---------------------------------------------------------------------------
// GET /api/fs/search-paths?project=NAME&q=QUERY[&case=true&max=N&scope=project|workspace]
// ---------------------------------------------------------------------------

pub async fn search_paths(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<PathSearchResponse>, ApiError> {
    let case = params.case.unwrap_or(false);
    let query = params.q.clone();

    if params.scope == SearchScope::Workspace {
        if params.worktree_path.is_some() {
            return Err(ApiError::from(AppError::InvalidInput(
                "worktreePath is not supported for workspace scope".into(),
            )));
        }
        let projects: Vec<(String, std::path::PathBuf)> = {
            let cfg = state.config.read().await;
            cfg.projects
                .iter()
                .map(|p| (p.name.clone(), std::path::PathBuf::from(&p.path)))
                .collect()
        };
        let (matches, truncated) =
            ops::search_paths_workspace(projects, &query, case, 200, MAX_WORKSPACE_SEARCH_RESULTS)
                .await;
        Ok(Json(PathSearchResponse {
            query,
            matches,
            truncated,
        }))
    } else {
        let project_name = params.project.ok_or_else(|| {
            ApiError::from(AppError::InvalidInput(
                "project parameter required for project scope".into(),
            ))
        })?;
        let root = resolve(&state, &target_ref(project_name, params.worktree_path), "")
            .await
            .map_err(ApiError::from)?;
        let max = params.max.unwrap_or(200).min(ops::MAX_SEARCH_RESULTS);
        let (matches, truncated) = ops::search_paths(&root.canonical, &query, case, max)
            .await
            .map_err(AppError::Fs)?;
        Ok(Json(PathSearchResponse {
            query,
            matches,
            truncated,
        }))
    }
}
