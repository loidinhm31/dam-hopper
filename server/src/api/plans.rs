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
    #[serde(default, alias = "target_type")]
    pub target_type: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default, alias = "worktree_path")]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectedPlanQuery {
    #[serde(default, alias = "target_type")]
    pub target_type: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default, alias = "worktree_path")]
    pub worktree_path: Option<String>,
    pub plan_path: String,
}

enum ResolvedPlansScope {
    Workspace {
        root_path: std::path::PathBuf,
    },
    Project {
        target_ref: ProjectTargetRef,
        root_path: std::path::PathBuf,
        initial_root_id: secure_path::DirectoryIdentity,
    },
}

async fn resolve_plans_scope(
    state: &AppState,
    target_type: Option<&str>,
    project: Option<String>,
    worktree_path: Option<String>,
) -> Result<(ResolvedPlansScope, std::path::PathBuf, PlanTarget), ApiError> {
    let is_workspace = match target_type {
        Some("workspace") => true,
        Some("project") => false,
        Some(_) => return Err(ApiError::from(PlansError::InvalidQuery("unknown targetType"))),
        None => project.as_deref() == Some(crate::workflow::GLOBAL_WORKSPACE_PROJECT),
    };

    if is_workspace {
        if worktree_path
            .as_deref()
            .is_some_and(|w| !w.trim().is_empty())
        {
            return Err(ApiError::from(PlansError::InvalidQuery(
                "workspace target cannot specify worktreePath",
            )));
        }
        let sandbox = state
            .workspace_sandbox()
            .map_err(|_| PlansError::FsUnavailable)?;
        sandbox
            .check_identity()
            .map_err(|_| PlansError::TargetChanged)?;
        let root_path = sandbox.root().to_path_buf();
        let plan_target = PlanTarget {
            project: crate::workflow::GLOBAL_WORKSPACE_PROJECT.to_string(),
            worktree_path: None,
            target_key: "workspace".to_string(),
        };
        return Ok((
            ResolvedPlansScope::Workspace {
                root_path: root_path.clone(),
            },
            root_path,
            plan_target,
        ));
    }

    let project_name = project
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| PlansError::InvalidQuery("missing project or workspace target"))?;

    let target_ref = ProjectTargetRef {
        project: project_name,
        worktree_path,
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

    Ok((
        ResolvedPlansScope::Project {
            target_ref,
            root_path: root_path.clone(),
            initial_root_id,
        },
        root_path,
        plan_target,
    ))
}

async fn revalidate_plans_scope(
    state: &AppState,
    scope: &ResolvedPlansScope,
) -> Result<(), ApiError> {
    match scope {
        ResolvedPlansScope::Workspace { root_path } => {
            let current_sandbox = state
                .workspace_sandbox()
                .map_err(|_| PlansError::TargetChanged)?;
            if current_sandbox.root() != root_path {
                return Err(ApiError::from(PlansError::TargetChanged));
            }
            current_sandbox
                .check_identity()
                .map_err(|_| PlansError::TargetChanged)?;
            Ok(())
        }
        ResolvedPlansScope::Project {
            target_ref,
            root_path,
            initial_root_id,
        } => {
            let current_root_id = secure_path::directory_identity(root_path)
                .map_err(|_| PlansError::TargetChanged)?;
            if &current_root_id != initial_root_id {
                return Err(ApiError::from(PlansError::TargetChanged));
            }

            let recheck_target = state
                .resolve_project_target(target_ref)
                .await
                .map_err(|_| PlansError::TargetChanged)?;
            if !recheck_target.available() || recheck_target.target_path() != root_path {
                return Err(ApiError::from(PlansError::TargetChanged));
            }
            Ok(())
        }
    }
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

    let (scope, root_path, plan_target) = resolve_plans_scope(
        &state,
        params.target_type.as_deref(),
        params.project,
        params.worktree_path,
    )
    .await?;

    let requested_path = params.path.unwrap_or_else(|| "plans".to_string());

    let response = tokio::task::spawn_blocking(move || {
        scan::scan_plan_folders(&root_path, &requested_path, plan_target)
    })
    .await
    .map_err(|_| PlansError::ReadFailed)??;

    revalidate_plans_scope(&state, &scope).await?;
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

    let (scope, root_path, plan_target) = resolve_plans_scope(
        &state,
        params.target_type.as_deref(),
        params.project,
        params.worktree_path,
    )
    .await?;

    let plan_path = params.plan_path;

    let response = tokio::task::spawn_blocking(move || {
        scan::read_selected_plan(&root_path, &plan_path, plan_target)
    })
    .await
    .map_err(|_| PlansError::ReadFailed)??;

    revalidate_plans_scope(&state, &scope).await?;
    Ok(Json(response))
}
