use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::AppError;
use crate::git::bulk::ProjectRef;
use crate::git::progress::create_progress_channel;
use crate::git::{
    add_worktree, checkout_branch, cherry_pick, cherry_pick_commit_files, create_branch,
    delete_branch, discover_available_vcs_roots, drop_commit, drop_commit_files,
    edit_commit_message, get_commit_message, get_log, list_branches, prune_worktrees,
    remove_worktree, reset_to_commit, resolve_git_request_root, revert_commit, revert_commit_files,
    undo_last_commit, update_branch, BulkGitService, CheckoutStrategy, ResetMode,
    WorktreeAddOptions,
};
use crate::pty::EventSink as _;
use crate::state::AppState;
use crate::workspace_target::{is_not_git_repository_error, ProjectTargetRef};

use super::error::ApiError;

// ---------------------------------------------------------------------------
// POST /api/git/fetch  { projects?: string[], targets?: ProjectTargetRef[] }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsBody {
    pub projects: Option<Vec<String>>,
    pub targets: Option<Vec<ProjectTargetRef>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitOperationResultResponse {
    #[serde(flatten)]
    result: crate::git::GitOperationResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree_path: Option<String>,
}

fn attach_target_identity(
    results: Vec<crate::git::GitOperationResult>,
    projects: &[(String, PathBuf, Option<String>)],
) -> Vec<GitOperationResultResponse> {
    results
        .into_iter()
        .zip(projects.iter())
        .map(
            |(result, (_, _, worktree_path))| GitOperationResultResponse {
                result,
                worktree_path: worktree_path.clone(),
            },
        )
        .collect()
}

pub async fn fetch_projects(
    State(state): State<AppState>,
    Json(body): Json<ProjectsBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_list =
        collect_project_list(&state, body.projects.as_deref(), body.targets.as_deref()).await?;
    let ssh_cred = state.ssh_creds.read().await.clone();

    // BulkGitService is intentionally per-request: each request manages its own
    // concurrency (Semaphore(4)). Two concurrent fetch requests each run 4 ops = 8 total,
    // which is acceptable for a local dev tool targeting a few dozen projects.
    let bulk = BulkGitService::new(4).with_creds(ssh_cred);
    forward_progress_events(bulk.subscribe(), state.event_sink.clone());

    let refs: Vec<ProjectRef<'_>> = project_list
        .iter()
        .map(|(n, p, _)| ProjectRef {
            name: n.as_str(),
            path: p.as_path(),
        })
        .collect();
    let results = bulk.fetch_all(&refs).await;
    Ok(Json(attach_target_identity(results, &project_list)))
}

// ---------------------------------------------------------------------------
// POST /api/git/pull  { projects?: string[], targets?: ProjectTargetRef[] }
// ---------------------------------------------------------------------------

pub async fn pull_projects(
    State(state): State<AppState>,
    Json(body): Json<ProjectsBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_list =
        collect_project_list(&state, body.projects.as_deref(), body.targets.as_deref()).await?;
    let ssh_cred = state.ssh_creds.read().await.clone();

    // Intentionally per-request — see fetch_projects for rationale.
    let bulk = BulkGitService::new(4).with_creds(ssh_cred);
    forward_progress_events(bulk.subscribe(), state.event_sink.clone());

    let refs: Vec<ProjectRef<'_>> = project_list
        .iter()
        .map(|(n, p, _)| ProjectRef {
            name: n.as_str(),
            path: p.as_path(),
        })
        .collect();
    let results = bulk.pull_all(&refs).await;
    Ok(Json(attach_target_identity(results, &project_list)))
}

// ---------------------------------------------------------------------------
// POST /api/git/push  { project: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushBody {
    pub project: String,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
    #[serde(default)]
    pub force: bool,
}

pub async fn push_project(
    State(state): State<AppState>,
    Json(body): Json<PushBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_path = resolve_target_path(&state, &body.project, body.worktree_path).await?;
    let ssh_cred = state.ssh_creds.read().await.clone();
    let root = resolve_git_request_root(&project_path, body.root.as_deref())
        .map_err(ApiError::from_app)?;
    let progress = Some(create_progress_channel());

    if let Some(ref tx) = progress {
        let mut rx = tx.subscribe();
        let sink = state.event_sink.clone();
        tokio::spawn(async move {
            while let Ok(evt) = rx.recv().await {
                let payload = serde_json::to_value(&evt).unwrap_or_default();
                sink.broadcast("git:progress", payload);
            }
        });
    }

    let result = if body.force {
        crate::git::repository::force_push(&root.root_path, &body.project, &progress, ssh_cred)
            .await
    } else {
        crate::git::push(&root.root_path, &body.project, &progress, ssh_cred).await
    };
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// GET /api/git/:project/worktrees
// ---------------------------------------------------------------------------

pub async fn get_worktrees(
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let worktrees = state
        .refresh_project_worktrees(&project)
        .await
        .map_err(map_worktree_git_error)?;
    Ok(Json(worktrees))
}

// ---------------------------------------------------------------------------
// GET /api/git/:project/roots
// ---------------------------------------------------------------------------

pub async fn get_vcs_roots(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(query): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, query.worktree_path).await?;
    let roots = discover_available_vcs_roots(&path).map_err(ApiError::from_app)?;
    Ok(Json(roots))
}

// ---------------------------------------------------------------------------
// POST /api/git/:project/worktrees
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddWorktreeBody {
    pub branch: String,
    pub path: Option<String>,
    pub create_branch: Option<bool>,
    pub base_branch: Option<String>,
}

pub async fn add_worktree_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<AddWorktreeBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = state
        .workspace_target_project_path(&project)
        .await
        .map_err(ApiError::from_app)?;
    let opts = WorktreeAddOptions {
        branch: body.branch,
        path: body.path,
        create_branch: body.create_branch.unwrap_or(false),
        base_branch: body.base_branch,
    };
    let worktree = add_worktree(&path, opts)
        .await
        .map_err(map_worktree_git_error)?;
    state.invalidate_project_worktrees(&path).await;
    let worktrees = state
        .refresh_project_worktrees(&project)
        .await
        .map_err(map_worktree_git_error)?;
    let worktree = worktrees
        .into_iter()
        .find(|candidate| candidate.repository_path == worktree.path)
        .ok_or_else(|| {
            ApiError::from_app(crate::error::AppError::Internal(
                "Worktree created but target metadata was not found".to_string(),
            ))
        })?;
    Ok(Json(worktree))
}

// ---------------------------------------------------------------------------
// DELETE /api/git/:project/worktrees  { path: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RemoveWorktreeBody {
    pub path: String,
}

pub async fn remove_worktree_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<RemoveWorktreeBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_path = state
        .workspace_target_project_path(&project)
        .await
        .map_err(ApiError::from_app)?;
    let target = state
        .resolve_project_target(&ProjectTargetRef {
            project: project.clone(),
            worktree_path: Some(body.path),
        })
        .await
        .map_err(ApiError::from_app)?;
    let worktree = target.worktree().cloned().ok_or_else(|| {
        ApiError::from_app(crate::error::AppError::InvalidInput(
            "The configured project root cannot be removed as a worktree".to_string(),
        ))
    })?;
    if worktree.is_main {
        return Err(ApiError::from_app(crate::error::AppError::InvalidInput(
            "The configured project root cannot be removed as a worktree".to_string(),
        )));
    }
    remove_worktree(&project_path, &worktree.repository_path)
        .await
        .map_err(ApiError::from_app)?;
    state.invalidate_project_worktrees(&project_path).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/git/:project/worktrees/prune
// ---------------------------------------------------------------------------

pub async fn prune_worktrees_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let project_path = state
        .workspace_target_project_path(&project)
        .await
        .map_err(ApiError::from_app)?;
    prune_worktrees(&project_path)
        .await
        .map_err(map_worktree_git_error)?;
    state.invalidate_project_worktrees(&project_path).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn map_worktree_git_error(error: AppError) -> ApiError {
    match error {
        AppError::Git(message) if is_not_git_repository_error(&message) => {
            ApiError::from_app(AppError::GitUnavailable)
        }
        error => ApiError::from_app(error),
    }
}

// ---------------------------------------------------------------------------
// GET /api/git/:project/branches
// ---------------------------------------------------------------------------

pub async fn get_branches(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(query): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, query.worktree_path).await?;
    let root =
        resolve_git_request_root(&path, query.root.as_deref()).map_err(ApiError::from_app)?;
    let branches = list_branches(&root.root_path).map_err(ApiError::from_app)?;
    Ok(Json(branches))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootQuery {
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchBody {
    pub name: String,
    pub start_point: Option<String>,
    pub checkout: Option<bool>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn create_branch_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<CreateBranchBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = create_branch(
        &root.root_path,
        &body.name,
        body.start_point.as_deref(),
        body.checkout.unwrap_or(false),
    )
    .await
    .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBranchBody {
    pub name: String,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn delete_branch_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<DeleteBranchBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = delete_branch(&root.root_path, &body.name)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutBranchBody {
    pub branch: String,
    pub start_point: Option<String>,
    pub create: Option<bool>,
    pub strategy: Option<CheckoutStrategy>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn checkout_branch_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<CheckoutBranchBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = checkout_branch(
        &root.root_path,
        &body.branch,
        body.start_point.as_deref(),
        body.create.unwrap_or(false),
        body.strategy.unwrap_or(CheckoutStrategy::Normal),
    )
    .await
    .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// GET /api/git/:project/log
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetLogQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub r#ref: Option<String>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn get_log_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    axum::extract::Query(query): axum::extract::Query<GetLogQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, query.worktree_path).await?;
    let root =
        resolve_git_request_root(&path, query.root.as_deref()).map_err(ApiError::from_app)?;
    let limit = query.limit.unwrap_or(100);
    let offset = query.offset.unwrap_or(0);
    let log = get_log(&root.root_path, limit, offset, query.r#ref.as_deref())
        .map_err(ApiError::from_app)?;
    Ok(Json(log))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickBody {
    pub hash: String,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn cherry_pick_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<CherryPickBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = cherry_pick(&root.root_path, &body.hash)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetBody {
    pub hash: String,
    pub mode: ResetMode,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn reset_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<ResetBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = reset_to_commit(&root.root_path, &body.hash, body.mode)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

pub async fn undo_last_commit_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(query): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, query.worktree_path).await?;
    let root =
        resolve_git_request_root(&path, query.root.as_deref()).map_err(ApiError::from_app)?;
    let result = undo_last_commit(&root.root_path)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileOperationBody {
    pub paths: Vec<String>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn cherry_pick_commit_files_route(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Json(body): Json<CommitFileOperationBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = cherry_pick_commit_files(&root.root_path, &hash, &body.paths)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

pub async fn drop_commit_files_route(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Json(body): Json<CommitFileOperationBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = drop_commit_files(&root.root_path, &hash, &body.paths)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

pub async fn drop_commit_route(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Query(query): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, query.worktree_path).await?;
    let root =
        resolve_git_request_root(&path, query.root.as_deref()).map_err(ApiError::from_app)?;
    let result = drop_commit(&root.root_path, &hash)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

#[derive(Serialize)]
pub struct CommitMessageResponse {
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditCommitMessageBody {
    pub message: String,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn get_commit_message_route(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Query(query): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, query.worktree_path).await?;
    let root =
        resolve_git_request_root(&path, query.root.as_deref()).map_err(ApiError::from_app)?;
    let message = get_commit_message(&root.root_path, &hash).map_err(ApiError::from_app)?;
    Ok(Json(CommitMessageResponse { message }))
}

pub async fn edit_commit_message_route(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Json(body): Json<EditCommitMessageBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = edit_commit_message(&root.root_path, &hash, &body.message)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

pub async fn revert_commit_route(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Query(query): Query<RootQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, query.worktree_path).await?;
    let root =
        resolve_git_request_root(&path, query.root.as_deref()).map_err(ApiError::from_app)?;
    let result = revert_commit(&root.root_path, &hash)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

pub async fn revert_commit_files_route(
    State(state): State<AppState>,
    Path((project, hash)): Path<(String, String)>,
    Json(body): Json<CommitFileOperationBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let result = revert_commit_files(&root.root_path, &hash, &body.paths)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// POST /api/git/:project/branches/update  { branch?: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBranchBody {
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub root: Option<String>,
}

pub async fn update_branch_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<UpdateBranchBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_target_path(&state, &project, body.worktree_path).await?;
    let root = resolve_git_request_root(&path, body.root.as_deref()).map_err(ApiError::from_app)?;
    let branch = body.branch.as_deref().unwrap_or("main");
    let result = update_branch(&root.root_path, branch, "origin").map_err(ApiError::from_app)?;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn resolve_target_path(
    state: &AppState,
    project_name: &str,
    worktree_path: Option<String>,
) -> Result<PathBuf, ApiError> {
    state
        .resolve_project_target(&ProjectTargetRef {
            project: project_name.to_string(),
            worktree_path,
        })
        .await
        .map(|target| target.target_path().to_path_buf())
        .map_err(ApiError::from_app)
}

async fn collect_project_list(
    state: &AppState,
    filter: Option<&[String]>,
    targets: Option<&[ProjectTargetRef]>,
) -> Result<Vec<(String, PathBuf, Option<String>)>, AppError> {
    if let Some(targets) = targets {
        let mut project_list = Vec::with_capacity(targets.len());
        for target in targets {
            let resolved = state.resolve_project_target(target).await?;
            project_list.push((
                target.project.clone(),
                resolved.target_path().to_path_buf(),
                target.worktree_path.clone(),
            ));
        }
        return Ok(project_list);
    }

    let cfg = state.config.read().await;
    Ok(cfg
        .projects
        .iter()
        .filter(|p| {
            filter
                .map(|f| f.iter().any(|n| n == &p.name))
                .unwrap_or(true)
        })
        .map(|p| (p.name.clone(), PathBuf::from(&p.path), None))
        .collect())
}

fn forward_progress_events(
    rx: Option<crate::git::progress::ProgressReceiver>,
    sink: crate::pty::BroadcastEventSink,
) {
    if let Some(mut rx) = rx {
        tokio::spawn(async move {
            while let Ok(evt) = rx.recv().await {
                let payload = serde_json::to_value(&evt).unwrap_or_default();
                sink.broadcast("git:progress", payload);
            }
        });
    }
}
