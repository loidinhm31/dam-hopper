use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
};
use serde::Deserialize;
use std::path::PathBuf;

use crate::git::{
    BulkGitService, WorktreeAddOptions,
    add_worktree, list_branches, list_worktrees, remove_worktree, update_branch,
};
use crate::git::bulk::ProjectRef;
use crate::git::progress::create_progress_channel;
use crate::pty::EventSink as _;
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// POST /api/git/fetch  { projects?: string[] }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ProjectsBody {
    pub projects: Option<Vec<String>>,
}

pub async fn fetch_projects(
    State(state): State<AppState>,
    Json(body): Json<ProjectsBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_list = collect_project_list(&state, body.projects.as_deref()).await;

    // BulkGitService is intentionally per-request: each request manages its own
    // concurrency (Semaphore(4)). Two concurrent fetch requests each run 4 ops = 8 total,
    // which is acceptable for a local dev tool targeting a few dozen projects.
    let bulk = BulkGitService::new(4);
    forward_progress_events(bulk.subscribe(), state.event_sink.clone());

    let refs: Vec<ProjectRef<'_>> = project_list.iter()
        .map(|(n, p)| ProjectRef { name: n.as_str(), path: p.as_path() })
        .collect();
    let results = bulk.fetch_all(&refs).await;
    Ok(Json(results))
}

// ---------------------------------------------------------------------------
// POST /api/git/pull  { projects?: string[] }
// ---------------------------------------------------------------------------

pub async fn pull_projects(
    State(state): State<AppState>,
    Json(body): Json<ProjectsBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_list = collect_project_list(&state, body.projects.as_deref()).await;

    // Intentionally per-request — see fetch_projects for rationale.
    let bulk = BulkGitService::new(4);
    forward_progress_events(bulk.subscribe(), state.event_sink.clone());

    let refs: Vec<ProjectRef<'_>> = project_list.iter()
        .map(|(n, p)| ProjectRef { name: n.as_str(), path: p.as_path() })
        .collect();
    let results = bulk.pull_all(&refs).await;
    Ok(Json(results))
}

// ---------------------------------------------------------------------------
// POST /api/git/push  { project: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PushBody {
    pub project: String,
}

pub async fn push_project(
    State(state): State<AppState>,
    Json(body): Json<PushBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_project_path(&state, &body.project).await?;
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

    let result = crate::git::cli_fallback::push(&path, &body.project, &progress).await;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// GET /api/git/:project/worktrees
// ---------------------------------------------------------------------------

pub async fn get_worktrees(
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_project_path(&state, &project).await?;
    let worktrees = list_worktrees(&path).await.map_err(ApiError::from_app)?;
    Ok(Json(worktrees))
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
    let path = resolve_project_path(&state, &project).await?;
    let opts = WorktreeAddOptions {
        branch: body.branch,
        path: body.path,
        create_branch: body.create_branch.unwrap_or(false),
        base_branch: body.base_branch,
    };
    let worktree = add_worktree(&path, opts).await.map_err(ApiError::from_app)?;
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
    let project_path = resolve_project_path(&state, &project).await?;
    remove_worktree(&project_path, &body.path).await.map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/git/:project/branches
// ---------------------------------------------------------------------------

pub async fn get_branches(
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_project_path(&state, &project).await?;
    let branches = list_branches(&path).map_err(ApiError::from_app)?;
    Ok(Json(branches))
}

// ---------------------------------------------------------------------------
// POST /api/git/:project/branches/update  { branch?: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct UpdateBranchBody {
    pub branch: Option<String>,
}

pub async fn update_branch_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(body): Json<UpdateBranchBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = resolve_project_path(&state, &project).await?;
    let branch = body.branch.as_deref().unwrap_or("main");
    let result = update_branch(&path, branch, "origin").map_err(ApiError::from_app)?;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn resolve_project_path(state: &AppState, project_name: &str) -> Result<PathBuf, ApiError> {
    state.project_path(project_name).await.map_err(ApiError::from_app)
}

async fn collect_project_list(state: &AppState, filter: Option<&[String]>) -> Vec<(String, PathBuf)> {
    let cfg = state.config.read().await;
    cfg.projects
        .iter()
        .filter(|p| filter.map(|f| f.iter().any(|n| n == &p.name)).unwrap_or(true))
        .map(|p| (p.name.clone(), PathBuf::from(&p.path)))
        .collect()
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
