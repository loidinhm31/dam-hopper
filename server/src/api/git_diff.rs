/// Route handlers for git diff, staging, discard, conflict resolution, and commit.
///
/// All routes are scoped to a specific project: /api/git/:project/...
/// Path parameters are validated via `safe_join` inside the git::diff module.
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::git;
use crate::git::{
    discover_available_vcs_roots, resolve_git_path_root, resolve_git_request_root,
    staged_vcs_root_ids,
};
use crate::state::AppState;
use crate::workspace_target::ProjectTargetRef;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// GET /api/git/{project}/diff  — list changed files
// ---------------------------------------------------------------------------

pub async fn list_diff(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(q): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, q.worktree_path).await?;
    let resp = tokio::task::spawn_blocking(move || {
        if q.root.as_deref() == Some("*") {
            let roots = discover_available_vcs_roots(&path)?;
            aggregate_diff(&path, roots)
        } else {
            let root = resolve_git_request_root(&path, q.root.as_deref())?;
            let mut resp = git::get_diff_files(&root.root_path)?;
            annotate_diff_response(&mut resp, &root.root_id, &root.root_path_display);
            Ok(resp)
        }
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// GET /api/git/{project}/untracked?offset=0&limit=500  — paginate untracked
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UntrackedQuery {
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootQuery {
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn list_untracked(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(q): Query<UntrackedQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, q.worktree_path).await?;
    let limit = q.limit.unwrap_or(git::UNTRACKED_PAGE_SIZE);
    let offset = q.offset;
    let root = q.root;
    let resp = tokio::task::spawn_blocking(move || {
        let root = resolve_git_request_root(&path, root.as_deref())?;
        let mut resp = git::get_untracked_page(&root.root_path, offset, limit)?;
        annotate_diff_response(&mut resp, &root.root_id, &root.root_path_display);
        Ok(resp)
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// GET /api/git/{project}/diff/file?path=<rel_path>  — file diff content
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePathQuery {
    pub path: String,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn get_file_diff(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(q): Query<FilePathQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = resolve_target_path(&state, &project, q.worktree_path).await?;
    let rel = q.path;
    let root = q.root;
    let content = tokio::task::spawn_blocking(move || {
        let (root, paths) = resolve_git_path_root(&proj_path, root.as_deref(), &[rel])?;
        git::get_file_diff(&root.root_path, &paths[0])
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(content))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/stage  — { paths: string[] }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsBody {
    pub paths: Vec<String>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn stage(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<PathsBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let paths = body.paths;
    let root = body.root;
    tokio::task::spawn_blocking(move || {
        let (root, paths) = resolve_git_path_root(&proj_path, root.as_deref(), &paths)?;
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        git::stage_files(&root.root_path, &refs)
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
    let proj_path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let paths = body.paths;
    let root = body.root;
    tokio::task::spawn_blocking(move || {
        let (root, paths) = resolve_git_path_root(&proj_path, root.as_deref(), &paths)?;
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        git::unstage_files(&root.root_path, &refs)
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
#[serde(rename_all = "camelCase")]
pub struct SinglePathBody {
    pub path: String,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn discard(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<SinglePathBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let rel = body.path;
    let root = body.root;
    tokio::task::spawn_blocking(move || {
        let (root, paths) = resolve_git_path_root(&proj_path, root.as_deref(), &[rel])?;
        git::discard_file(&root.root_path, &paths[0])
    })
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
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn discard_hunk(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<DiscardHunkBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let rel = body.path;
    let idx = body.hunk_index;
    let root = body.root;
    tokio::task::spawn_blocking(move || {
        let (root, paths) = resolve_git_path_root(&proj_path, root.as_deref(), &[rel])?;
        git::discard_hunk(&root.root_path, &paths[0], idx)
    })
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
    Query(q): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, q.worktree_path).await?;
    let conflicts = tokio::task::spawn_blocking(move || {
        let root = resolve_git_request_root(&path, q.root.as_deref())?;
        git::get_conflicts(&root.root_path)
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(conflicts))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/resolve  — { path: string, content: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveBody {
    pub path: String,
    pub content: String,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn resolve(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<ResolveBody>,
) -> Result<impl IntoResponse, ApiError> {
    let proj_path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let rel = body.path;
    let content = body.content;
    let root = body.root;
    tokio::task::spawn_blocking(move || {
        let (root, paths) = resolve_git_path_root(&proj_path, root.as_deref(), &[rel])?;
        git::resolve_conflict(&root.root_path, &paths[0], &content)
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/git/{project}/commit  — { message: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitBody {
    pub message: String,
    pub amend: Option<bool>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
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
    let proj_path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let message = body.message;
    let amend = body.amend.unwrap_or(false);
    let root = body.root;
    let hash = tokio::task::spawn_blocking(move || {
        if root.as_deref().is_none() {
            reject_mixed_root_commit(&proj_path)?;
        }
        let root = resolve_git_request_root(&proj_path, root.as_deref())?;
        git::commit_files(&root.root_path, &message, amend)
    })
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
    Query(q): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, q.worktree_path).await?;
    let resp = tokio::task::spawn_blocking(move || {
        let root = resolve_git_request_root(&path, q.root.as_deref())?;
        let mut entries = git::get_commit_files(&root.root_path, &hash)?;
        for entry in &mut entries {
            entry.root_id = Some(root.root_id.clone());
            entry.root_path = Some(root.root_path_display.clone());
        }
        Ok(entries)
    })
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
    let proj_path = resolve_target_path(&state, &project, q.worktree_path).await?;
    let rel = q.path;
    let root = q.root;
    let content = tokio::task::spawn_blocking(move || {
        let (root, paths) = resolve_git_path_root(&proj_path, root.as_deref(), &[rel])?;
        git::get_commit_file_diff(&root.root_path, &paths[0], &hash)
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from_app)?;
    Ok(Json(content))
}

fn aggregate_diff(
    project_path: &std::path::Path,
    roots: Vec<git::VcsRoot>,
) -> Result<git::DiffResponse, crate::error::AppError> {
    let mut aggregate = git::DiffResponse {
        entries: Vec::new(),
        untracked_truncated: false,
        untracked_total: 0,
    };

    for root in roots {
        let Ok(resolved) = resolve_git_request_root(project_path, Some(&root.root_id)) else {
            continue;
        };
        let mut resp = git::get_diff_files(&resolved.root_path)?;
        annotate_diff_response(&mut resp, &resolved.root_id, &resolved.root_path_display);
        aggregate.untracked_truncated |= resp.untracked_truncated;
        aggregate.untracked_total += resp.untracked_total;
        aggregate.entries.extend(resp.entries);
    }

    Ok(aggregate)
}

fn annotate_diff_response(resp: &mut git::DiffResponse, root_id: &str, root_path: &str) {
    for entry in &mut resp.entries {
        entry.root_id = Some(root_id.to_string());
        entry.root_path = Some(root_path.to_string());
    }
}

fn reject_mixed_root_commit(project_path: &std::path::Path) -> Result<(), crate::error::AppError> {
    let staged_roots = staged_vcs_root_ids(project_path)?;
    if staged_roots.len() > 1 {
        return Err(crate::error::AppError::InvalidInput(format!(
            "mixed VCS root commit blocked; select one root before committing: {}",
            staged_roots.join(", ")
        )));
    }
    Ok(())
}

async fn resolve_target_path(
    state: &AppState,
    project_name: &str,
    worktree_path: Option<String>,
) -> Result<std::path::PathBuf, ApiError> {
    state
        .resolve_project_target(&ProjectTargetRef {
            project: project_name.to_string(),
            worktree_path,
        })
        .await
        .map(|target| target.target_path().to_path_buf())
        .map_err(ApiError::from_app)
}
