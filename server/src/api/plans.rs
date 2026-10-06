use std::collections::HashSet;

use axum::{
    extract::{rejection::QueryRejection, Query, RawQuery, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::error::AppError;
use crate::fs::secure_path;
use crate::plans::dto::*;
use crate::plans::scan::{self, PlansError};
use crate::state::AppState;
use crate::workspace_target::{ProjectTargetRef, WorkspaceTargetError};

use super::error::ApiError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanFoldersQuery {
    pub project: String,
    #[serde(default, alias = "worktree_path")]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectedPlanQuery {
    pub project: String,
    #[serde(default, alias = "worktree_path")]
    pub worktree_path: Option<String>,
    pub plan_path: String,
}

fn check_no_duplicate_keys(raw_query: &RawQuery) -> Result<(), PlansError> {
    let query_str = raw_query.0.as_deref().unwrap_or_default();
    let mut seen_keys = HashSet::new();
    for pair in query_str.split('&') {
        if pair.is_empty() {
            continue;
        }
        let key = pair.split('=').next().unwrap_or("");
        if !seen_keys.insert(key) {
            return Err(PlansError::InvalidQuery("duplicate query parameter"));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// GET /api/plans/folders
// ---------------------------------------------------------------------------

pub async fn get_plan_folders(
    State(state): State<AppState>,
    raw_query: RawQuery,
    query_res: Result<Query<PlanFoldersQuery>, QueryRejection>,
) -> Result<impl IntoResponse, ApiError> {
    check_no_duplicate_keys(&raw_query)?;
    let Query(params) = query_res.map_err(|_| PlansError::InvalidQuery("invalid query parameters"))?;
    let _workspace_context = state.workspace_context_guard.read().await;

    let target_ref = ProjectTargetRef {
        project: params.project.clone(),
        worktree_path: params.worktree_path.clone(),
    };

    let target = state
        .resolve_project_target(&target_ref)
        .await
        .map_err(|e| match e {
            AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject) => {
                ApiError::from(AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject))
            }
            AppError::WorkspaceTarget(WorkspaceTargetError::UnregisteredTarget) => {
                ApiError::from(AppError::WorkspaceTarget(
                    WorkspaceTargetError::UnregisteredTarget,
                ))
            }
            AppError::WorkspaceTarget(WorkspaceTargetError::UnavailableTarget) => {
                ApiError::from(AppError::WorkspaceTarget(
                    WorkspaceTargetError::UnavailableTarget,
                ))
            }
            _ => ApiError::from(e),
        })?;

    if !target.available() {
        return Err(ApiError::from(PlansError::TargetChanged));
    }

    let root_path = target.target_path().to_path_buf();
    let initial_root_id =
        secure_path::directory_identity(&root_path).map_err(|_| PlansError::FsUnavailable)?;

    let requested_path = params.path.unwrap_or_else(|| "plans".to_string());
    let plan_target = PlanTarget {
        project: target.project().to_string(),
        worktree_path: target.worktree().map(|w| w.path.clone()),
        target_key: target.target_key().to_string(),
    };

    let response = tokio::task::spawn_blocking(move || {
        scan::scan_plan_folders(&root_path, &requested_path, plan_target)
    })
    .await
    .map_err(|_| PlansError::ReadFailed)??;

    // Revalidate target before sending response
    let current_root_id = secure_path::directory_identity(target.target_path())
        .map_err(|_| PlansError::TargetChanged)?;
    if current_root_id != initial_root_id {
        return Err(ApiError::from(PlansError::TargetChanged));
    }

    let recheck_target = state
        .resolve_project_target(&target_ref)
        .await
        .map_err(|_| PlansError::TargetChanged)?;
    if !recheck_target.available() || recheck_target.target_path() != target.target_path() {
        return Err(ApiError::from(PlansError::TargetChanged));
    }

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// GET /api/plans
// ---------------------------------------------------------------------------

pub async fn get_selected_plan(
    State(state): State<AppState>,
    raw_query: RawQuery,
    query_res: Result<Query<SelectedPlanQuery>, QueryRejection>,
) -> Result<impl IntoResponse, ApiError> {
    check_no_duplicate_keys(&raw_query)?;
    let Query(params) = query_res.map_err(|_| PlansError::InvalidQuery("invalid query parameters"))?;
    let _workspace_context = state.workspace_context_guard.read().await;

    let target_ref = ProjectTargetRef {
        project: params.project.clone(),
        worktree_path: params.worktree_path.clone(),
    };

    let target = state
        .resolve_project_target(&target_ref)
        .await
        .map_err(|e| match e {
            AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject) => {
                ApiError::from(AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject))
            }
            AppError::WorkspaceTarget(WorkspaceTargetError::UnregisteredTarget) => {
                ApiError::from(AppError::WorkspaceTarget(
                    WorkspaceTargetError::UnregisteredTarget,
                ))
            }
            AppError::WorkspaceTarget(WorkspaceTargetError::UnavailableTarget) => {
                ApiError::from(AppError::WorkspaceTarget(
                    WorkspaceTargetError::UnavailableTarget,
                ))
            }
            _ => ApiError::from(e),
        })?;

    if !target.available() {
        return Err(ApiError::from(PlansError::TargetChanged));
    }

    let root_path = target.target_path().to_path_buf();
    let initial_root_id =
        secure_path::directory_identity(&root_path).map_err(|_| PlansError::FsUnavailable)?;

    let plan_target = PlanTarget {
        project: target.project().to_string(),
        worktree_path: target.worktree().map(|w| w.path.clone()),
        target_key: target.target_key().to_string(),
    };
    let plan_path = params.plan_path;

    let response = tokio::task::spawn_blocking(move || {
        scan::read_selected_plan(&root_path, &plan_path, plan_target)
    })
    .await
    .map_err(|_| PlansError::ReadFailed)??;

    // Revalidate target before sending response
    let current_root_id = secure_path::directory_identity(target.target_path())
        .map_err(|_| PlansError::TargetChanged)?;
    if current_root_id != initial_root_id {
        return Err(ApiError::from(PlansError::TargetChanged));
    }

    let recheck_target = state
        .resolve_project_target(&target_ref)
        .await
        .map_err(|_| PlansError::TargetChanged)?;
    if !recheck_target.available() || recheck_target.target_path() != target.target_path() {
        return Err(ApiError::from(PlansError::TargetChanged));
    }

    Ok(Json(response))
}
