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
use crate::workspace_target::{
    FileIdentity, FilesystemTargetRef, ProjectTargetRef, ResolvedFilesystemTarget,
    ResolvedProjectTarget,
};
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
    pub target_type: Option<String>,
    pub project: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    pub q: String,
    pub case: Option<bool>,
    pub max: Option<usize>,
    #[serde(default)]
    pub scope: Option<SearchScope>,
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
    pub target_type: Option<String>,
    pub project: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
}
// ---------------------------------------------------------------------------
// Shared param / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathParams {
    pub target_type: Option<String>,
    pub project: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadParams {
    pub target_type: Option<String>,
    pub project: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    pub path: String,
    pub offset: Option<u64>,
    pub len: Option<u64>,
    #[serde(default)]
    pub mode: Option<String>,
}
#[derive(Serialize)]
pub struct ListResponse {
    pub entries: Vec<crate::fs::DirEntry>,
}

#[derive(Serialize)]
pub struct BinaryResponse {
    pub binary: bool,
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_identity: Option<FileIdentity>,
}

// ---------------------------------------------------------------------------
// Helper: resolve + validate a project-relative path
// ---------------------------------------------------------------------------

pub(super) struct ResolvedFsPath {
    pub target: ResolvedFilesystemTarget,
    pub canonical: std::path::PathBuf,
    pub file_identity: FileIdentity,
}

pub fn parse_rest_target(
    target_type: Option<&str>,
    project: Option<String>,
    worktree_path: Option<String>,
) -> Result<FilesystemTargetRef, ApiError> {
    match target_type {
        Some("workspace") => {
            if project.is_some() || worktree_path.is_some() {
                return Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_FS_TARGET",
                    "workspace target cannot have project or worktreePath",
                ));
            }
            Ok(FilesystemTargetRef::workspace())
        }
        Some("project") => {
            let project = project.ok_or_else(|| {
                ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_FS_TARGET",
                    "project target requires project parameter",
                )
            })?;
            Ok(FilesystemTargetRef::project(project, worktree_path))
        }
        Some(other) => Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "INVALID_FS_TARGET",
            format!("unknown targetType: {other}"),
        )),
        None => {
            if let Some(project) = project {
                Ok(FilesystemTargetRef::project(project, worktree_path))
            } else {
                Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_FS_TARGET",
                    "missing filesystem target",
                ))
            }
        }
    }
}

pub(super) async fn resolve(
    state: &AppState,
    target_ref: &FilesystemTargetRef,
    rel_path: &str,
) -> Result<ResolvedFsPath, AppError> {
    if std::path::Path::new(rel_path).is_absolute() {
        return Err(AppError::Fs(crate::fs::FsError::PathEscape));
    }
    let workspace_id = state.workspace_id().await;
    let workspace_epoch = state.workspace_epoch();
    match target_ref {
        FilesystemTargetRef::Workspace(_) => {
            let sandbox = state.workspace_sandbox().map_err(AppError::Fs)?;
            sandbox.check_identity().map_err(AppError::Fs)?;
            let trimmed = rel_path.trim_start_matches('/');
            let proposed = if trimmed.is_empty() {
                sandbox.root().to_path_buf()
            } else {
                sandbox.root().join(trimmed)
            };
            let canonical = sandbox
                .validate_workspace(proposed)
                .await
                .map_err(AppError::Fs)?;
            let file_identity = FileIdentity::new(
                workspace_id,
                workspace_epoch,
                canonical.to_string_lossy().to_string(),
            );
            Ok(ResolvedFsPath {
                target: ResolvedFilesystemTarget::from_workspace(sandbox.root().to_path_buf()),
                canonical,
                file_identity,
            })
        }
        FilesystemTargetRef::Project(project_ref) => {
            let target = state.resolve_project_target(project_ref).await?;
            let sandbox = state.fs.sandbox().map_err(AppError::Fs)?;
            let trimmed = rel_path.trim_start_matches('/');
            let proposed = if trimmed.is_empty() {
                target.target_path().to_path_buf()
            } else {
                target.target_path().join(trimmed)
            };
            let canonical = sandbox
                .validate_target(&target, proposed)
                .await
                .map_err(AppError::Fs)?;
            let file_identity = FileIdentity::new(
                workspace_id,
                workspace_epoch,
                canonical.to_string_lossy().to_string(),
            );
            Ok(ResolvedFsPath {
                target: ResolvedFilesystemTarget::from_project(target),
                canonical,
                file_identity,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// GET /api/fs/list?project=NAME&path=REL
// ---------------------------------------------------------------------------

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ProjectPathParams>,
) -> Result<Json<ListResponse>, ApiError> {
    let target = parse_rest_target(
        params.target_type.as_deref(),
        params.project,
        params.worktree_path,
    )?;
    let resolved = resolve(&state, &target, &params.path)
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
    let target = parse_rest_target(
        params.target_type.as_deref(),
        params.project,
        params.worktree_path,
    )?;
    if let Some(mode) = &params.mode {
        if mode != "plan-document" {
            return Err(ApiError::from(AppError::InvalidInput(
                "unsupported read mode".into(),
            )));
        }
        if params.offset.is_some() || params.len.is_some() {
            return Err(ApiError::from(AppError::InvalidInput(
                "range reads not allowed in plan-document mode".into(),
            )));
        }
        let is_md = std::path::Path::new(&params.path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            return Err(ApiError::from(AppError::InvalidInput(
                "plan-document mode requires a .md file".into(),
            )));
        }

        let resolved_target = state
            .resolve_filesystem_target(&target)
            .await
            .map_err(ApiError::from)?;
        if !resolved_target.available() {
            return Err(ApiError::from(AppError::WorkspaceTarget(
                crate::workspace_target::WorkspaceTargetError::UnavailableTarget,
            )));
        }
        let root_path = resolved_target.root_path().to_path_buf();
        let initial_root_id = crate::fs::secure_path::directory_identity(&root_path)
            .map_err(|_| ApiError::from(AppError::Unavailable("filesystem unavailable".into())))?;

        let rel_path = params.path.trim_start_matches('/');
        let p = std::path::Path::new(rel_path);
        if p.is_absolute() || p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(ApiError::from(AppError::Fs(crate::fs::FsError::PathEscape)));
        }

        let snap = crate::fs::secure_path::read_regular_snapshot(&root_path, p, 64 * 1024)
            .map_err(|e| match e {
                crate::fs::FsError::TooLarge(_) => ApiError::from(AppError::Fs(e)),
                crate::fs::FsError::Conflict => {
                    ApiError::from(AppError::Conflict("document changed during read".into()))
                }
                crate::fs::FsError::NotFound => {
                    ApiError::from(AppError::NotFound("document not found".into()))
                }
                _ => ApiError::from(AppError::Fs(e)),
            })?;

        if snap.bytes.contains(&0) || std::str::from_utf8(&snap.bytes).is_err() {
            return Err(ApiError::from(AppError::InvalidInput(
                "file contains invalid UTF-8 or null byte".into(),
            )));
        }

        let current_root_id = crate::fs::secure_path::directory_identity(resolved_target.root_path())
            .map_err(|_| ApiError::from(AppError::Conflict("target replaced".into())))?;
        if current_root_id != initial_root_id {
            return Err(ApiError::from(AppError::Conflict("target replaced".into())));
        }

        return Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/markdown")],
            snap.bytes,
        )
            .into_response());
    }
    let resolved = resolve(&state, &target, &params.path)
        .await
        .map_err(ApiError::from)?;
    let canonical = resolved.canonical;

    let (is_binary, mime) = ops::detect_binary(&canonical).await.map_err(AppError::Fs)?;

    if is_binary {
        let body = Json(BinaryResponse {
            binary: true,
            mime,
            file_identity: Some(resolved.file_identity),
        });
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

    let identity_json = serde_json::to_string(&resolved.file_identity).unwrap_or_default();

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type.as_str()),
            (header::HeaderName::from_static("x-file-identity"), identity_json.as_str()),
        ],
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
    let target = parse_rest_target(
        params.target_type.as_deref(),
        params.project,
        params.worktree_path,
    )?;
    let resolved = resolve(&state, &target, &params.path)
        .await
        .map_err(ApiError::from)?;
    let mut file_stat = ops::stat(&resolved.canonical).await.map_err(AppError::Fs)?;
    file_stat.file_identity = Some(resolved.file_identity);
    Ok(Json(file_stat))
}

// ---------------------------------------------------------------------------
// GET /api/fs/language-files?project=NAME
// ---------------------------------------------------------------------------

pub async fn language_files(
    State(state): State<AppState>,
    Query(params): Query<LanguageFilesParams>,
) -> Result<Json<ops::LanguageScanResult>, ApiError> {
    let target = parse_rest_target(
        params.target_type.as_deref(),
        params.project,
        params.worktree_path,
    )?;
    let resolved = resolve(&state, &target, "")
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
    let target = parse_rest_target(
        params.target_type.as_deref(),
        params.project,
        params.worktree_path,
    )?;
    let resolved = resolve(&state, &target, &params.path)
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

    let target = parse_rest_target(
        params.target_type.as_deref(),
        params.project,
        params.worktree_path.clone(),
    )?;

    match target {
        FilesystemTargetRef::Workspace(_) => {
            if let Some(SearchScope::Project) = params.scope {
                return Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_FS_TARGET",
                    "scope=project is incompatible with targetType=workspace",
                ));
            }
            let sandbox = state.workspace_sandbox().map_err(|e| match e {
                crate::fs::FsError::Unavailable => ApiError::custom(
                    StatusCode::FORBIDDEN,
                    "UNCONFIGURED_WORKSPACE_ROOT",
                    "workspace root is not configured or unavailable",
                ),
                other => ApiError::from(AppError::Fs(other)),
            })?;
            sandbox.check_identity().map_err(AppError::Fs)?;
            let max = params.max.unwrap_or(200).min(ops::MAX_WORKSPACE_SEARCH_RESULTS);
            let (matches, truncated) = ops::search_files(sandbox.root(), &query, case, max)
                .await
                .map_err(AppError::Fs)?;
            Ok(Json(SearchResponse {
                query,
                matches,
                truncated,
            }))
        }
        FilesystemTargetRef::Project(project_ref) => {
            if let Some(SearchScope::Workspace) = params.scope {
                return Err(ApiError::custom(
                    StatusCode::FORBIDDEN,
                    "INVALID_FS_TARGET",
                    "scope=workspace is not permitted for project target",
                ));
            }
            let root = resolve(&state, &FilesystemTargetRef::Project(project_ref), "")
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

    let target = parse_rest_target(
        params.target_type.as_deref(),
        params.project,
        params.worktree_path.clone(),
    )?;

    match target {
        FilesystemTargetRef::Workspace(_) => {
            if let Some(SearchScope::Project) = params.scope {
                return Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_FS_TARGET",
                    "scope=project is incompatible with targetType=workspace",
                ));
            }
            let sandbox = state.workspace_sandbox().map_err(|e| match e {
                crate::fs::FsError::Unavailable => ApiError::custom(
                    StatusCode::FORBIDDEN,
                    "UNCONFIGURED_WORKSPACE_ROOT",
                    "workspace root is not configured or unavailable",
                ),
                other => ApiError::from(AppError::Fs(other)),
            })?;
            sandbox.check_identity().map_err(AppError::Fs)?;
            let max = params.max.unwrap_or(200).min(ops::MAX_WORKSPACE_SEARCH_RESULTS);
            let (matches, truncated) = ops::search_paths(sandbox.root(), &query, case, max)
                .await
                .map_err(AppError::Fs)?;
            Ok(Json(PathSearchResponse {
                query,
                matches,
                truncated,
            }))
        }
        FilesystemTargetRef::Project(project_ref) => {
            if let Some(SearchScope::Workspace) = params.scope {
                return Err(ApiError::custom(
                    StatusCode::FORBIDDEN,
                    "INVALID_FS_TARGET",
                    "scope=workspace is not permitted for project target",
                ));
            }
            let root = resolve(&state, &FilesystemTargetRef::Project(project_ref), "")
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
}
