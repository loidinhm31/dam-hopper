use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};

use crate::api::error::ApiError;
use crate::error::GitBlameError;
use crate::git::execute_native_blame;
use crate::git::types::{GitBlameInput, GitBlameResponse};
use crate::state::AppState;
use crate::workspace_target::ProjectTargetRef;

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

/// POST /api/git/{project}/blame
///
/// Computes line-by-line Git attribution for an in-memory editor buffer snapshot.
/// Enforces global admission via a 2-permit semaphore and bounds execution.
pub async fn blame_route(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Json(input): Json<GitBlameInput>,
) -> Result<impl IntoResponse, ApiError> {
    // Shared admission check: try-acquire 1 of 2 permits; returns 503 GIT_BLAME_BUSY if full.
    let permit = state
        .git_blame_semaphore
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::from(GitBlameError::Busy))?;

    let target_path = resolve_target_path(&state, &project, input.worktree_path.clone()).await?;

    let resp: GitBlameResponse = tokio::task::spawn_blocking(move || {
        // Keep permit owned inside the blocking closure for its full lifetime.
        let _permit = permit;
        execute_native_blame(&target_path, &input)
    })
    .await
    .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?
    .map_err(ApiError::from)?;

    Ok(Json(resp))
}
