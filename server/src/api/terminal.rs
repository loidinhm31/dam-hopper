use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::{collections::HashMap, path::PathBuf};
use tracing::warn;

use crate::config::schema::{RestartPolicy, DEFAULT_RESTART_MAX_RETRIES};
use crate::error::AppError;
use crate::pty::manager::PtyCreateOpts;
use crate::state::AppState;
use crate::workspace_target::{
    target_path_is_within, target_path_relative, ProjectTargetRef, ResolvedProjectTarget,
    WorkspaceTargetError,
};

use super::error::ApiError;

// ---------------------------------------------------------------------------
// POST /api/terminal
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionBody {
    pub id: String,
    pub command: String,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
    pub project: Option<String>,
    /// Optional registered worktree target. The server resolves and records
    /// the canonical target before spawning the PTY.
    pub worktree_path: Option<String>,
}

fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}

pub async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<CreateSessionBody>,
) -> Result<impl IntoResponse, ApiError> {
    // Worktree removal and terminal creation share this guard so a live
    // session cannot appear between the removal blocker check and git remove.
    let _workspace_context = state.workspace_context_guard.write().await;
    let CreateSessionBody {
        id,
        command,
        cwd: requested_cwd,
        env,
        cols,
        rows,
        project,
        worktree_path,
    } = body;
    let target = resolve_terminal_target(&state, project.as_deref(), worktree_path).await?;
    let cwd = resolve_terminal_cwd(&state, target.as_ref(), requested_cwd).await?;

    let (restart_policy, restart_max_retries, env) =
        resolve_terminal_env(&state, project.as_deref(), target.as_ref(), env).await?;
    let canonical_worktree_path = target.as_ref().and_then(|resolved| {
        (!resolved.is_root()).then(|| resolved.target_path().to_string_lossy().into_owned())
    });
    let session_id = id.clone();

    let meta = match state.pty_manager.create(PtyCreateOpts {
        id,
        command,
        cwd,
        env,
        cols,
        rows,
        project,
        worktree_path: canonical_worktree_path,
        restart_policy,
        restart_max_retries,
    }) {
        Ok(meta) => meta,
        Err(error) => {
            if let Some(target) = target.as_ref().filter(|target| !target.is_root()) {
                let target_ref = ProjectTargetRef {
                    project: target.project().to_string(),
                    worktree_path: Some(target.target_path().to_string_lossy().into_owned()),
                };
                if matches!(
                    state.resolve_project_target(&target_ref).await,
                    Err(AppError::WorkspaceTarget(
                        WorkspaceTargetError::UnknownProject
                            | WorkspaceTargetError::UnregisteredTarget
                            | WorkspaceTargetError::UnavailableTarget
                            | WorkspaceTargetError::InvalidPath
                    ))
                ) {
                    if state.pty_manager.mark_target_unavailable(
                        &session_id,
                        &target_ref.project,
                        target_ref.worktree_path.as_deref().unwrap_or_default(),
                    ) {
                        return Err(ApiError::from_app(AppError::WorkspaceTarget(
                            WorkspaceTargetError::UnavailableTarget,
                        )));
                    }
                }
            }
            return Err(ApiError::from_app(error));
        }
    };
    Ok(Json(meta))
}

async fn resolve_terminal_target(
    state: &AppState,
    project_name: Option<&str>,
    worktree_path: Option<String>,
) -> Result<Option<ResolvedProjectTarget>, ApiError> {
    let Some(project_name) = project_name else {
        if worktree_path.is_some() {
            return Err(ApiError::from_app(AppError::InvalidInput(
                "A worktree target requires a project".to_string(),
            )));
        }
        return Ok(None);
    };

    state
        .resolve_project_target(&ProjectTargetRef {
            project: project_name.to_string(),
            worktree_path,
        })
        .await
        .map(Some)
        .map_err(ApiError::from_app)
}

async fn resolve_terminal_cwd(
    state: &AppState,
    target: Option<&ResolvedProjectTarget>,
    requested_cwd: Option<String>,
) -> Result<String, ApiError> {
    let Some(target) = target else {
        return Ok(requested_cwd
            .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())));
    };

    let sandbox = state
        .fs
        .sandbox()
        .map_err(|err| ApiError::from_app(AppError::Fs(err)))?;
    let project_name = target.project();
    if sandbox.project_root(project_name).is_none() {
        return Err(ApiError::from_app(AppError::NotFound(format!(
            "Project not found: {project_name}"
        ))));
    }
    let target_path = target.target_path();
    let configured_root = sandbox.project_root(project_name).ok_or_else(|| {
        ApiError::from_app(AppError::NotFound(format!(
            "Project not found: {project_name}"
        )))
    })?;
    let proposed = requested_cwd
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                if target_path_is_within(&path, target_path) {
                    path
                } else {
                    target_path_relative(&path, &configured_root)
                        .map(|relative| target_path.join(relative))
                        .unwrap_or(path)
                }
            } else {
                target_path.join(path)
            }
        })
        .unwrap_or_else(|| target_path.to_path_buf());
    let cwd = sandbox
        .validate_target(target, proposed)
        .await
        .map_err(|err| ApiError::from_app(AppError::Fs(err)))?;

    if !cwd.is_dir() {
        return Err(ApiError::from_app(AppError::InvalidInput(format!(
            "Terminal cwd is not a directory: {}",
            cwd.display()
        ))));
    }
    if !target_path_is_within(&cwd, target_path) {
        return Err(ApiError::from_app(AppError::InvalidInput(format!(
            "Terminal cwd must stay inside the selected worktree: {}",
            target_path.display()
        ))));
    }

    Ok(cwd.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// GET /api/terminal
// ---------------------------------------------------------------------------

pub async fn list_sessions(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.pty_manager.list()).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/terminal/detailed
// ---------------------------------------------------------------------------

pub async fn list_detailed(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.pty_manager.list_detailed()).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/terminal/:id/buffer
// ---------------------------------------------------------------------------

pub async fn get_buffer(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let buffer = state
        .pty_manager
        .get_buffer(&id)
        .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "buffer": buffer })))
}

// ---------------------------------------------------------------------------
// DELETE /api/terminal/:id  — kill (keep tombstone)
// ---------------------------------------------------------------------------

pub async fn kill_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    state.pty_manager.kill(&id).map_err(ApiError::from_app)?;
    Ok((StatusCode::NO_CONTENT, ()))
}

// ---------------------------------------------------------------------------
// DELETE /api/terminal/:id/remove  — kill + evict
// ---------------------------------------------------------------------------

pub async fn remove_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let removed_incarnation = state.pty_manager.remove(&id).map_err(ApiError::from_app)?;
    if let (Some(pfm), Some(incarnation)) = (&state.port_forward_manager, removed_incarnation) {
        pfm.remove_session_ports(&id, incarnation).await;
    }
    Ok((StatusCode::NO_CONTENT, ()))
}

async fn resolve_terminal_env(
    state: &AppState,
    project_name: Option<&str>,
    target: Option<&ResolvedProjectTarget>,
    request_env: HashMap<String, String>,
) -> Result<(RestartPolicy, u32, HashMap<String, String>), ApiError> {
    let mut env = HashMap::new();

    let (restart_policy, restart_max_retries) = if let Some(project_name) = project_name {
        let project = {
            let cfg = state.config.read().await;
            cfg.projects
                .iter()
                .find(|p| p.name == project_name)
                .map(|project| {
                    (
                        project.path.clone(),
                        project.env_file.clone(),
                        project.restart_policy,
                        project.restart_max_retries,
                    )
                })
        };

        if let Some((project_path, env_file, restart_policy, restart_max_retries)) = project {
            if let Some(env_file) = env_file {
                let env_root = target
                    .map(|resolved| resolved.target_path().to_path_buf())
                    .unwrap_or_else(|| PathBuf::from(project_path));
                load_project_env_file(project_name, env_root.join(env_file), &mut env)?;
            }
            (restart_policy, restart_max_retries)
        } else {
            (RestartPolicy::default(), DEFAULT_RESTART_MAX_RETRIES)
        }
    } else {
        (RestartPolicy::default(), DEFAULT_RESTART_MAX_RETRIES)
    };

    env.extend(request_env);
    Ok((restart_policy, restart_max_retries, env))
}

fn load_project_env_file(
    project_name: &str,
    env_path: PathBuf,
    env: &mut HashMap<String, String>,
) -> Result<(), ApiError> {
    match dotenvy::from_path_iter(&env_path) {
        Ok(iter) => {
            for item in iter {
                let (key, value) = item.map_err(|err| {
                    ApiError::from_app(AppError::InvalidInput(format!(
                        "Invalid env_file for project '{project_name}': {} ({err})",
                        env_path.display()
                    )))
                })?;
                env.insert(key, value);
            }
            Ok(())
        }
        Err(dotenvy::Error::Io(io_err)) if io_err.kind() == std::io::ErrorKind::NotFound => {
            warn!(
                project = %project_name,
                path = %env_path.display(),
                "Configured project env_file not found; continuing without it"
            );
            Ok(())
        }
        Err(err) => Err(ApiError::from_app(AppError::InvalidInput(format!(
            "Failed to read env_file for project '{project_name}': {} ({err})",
            env_path.display()
        )))),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{target_path_is_within, target_path_relative};
    use std::path::Path;

    #[cfg(windows)]
    #[test]
    fn terminal_cwd_accepts_case_and_extended_unc_aliases() {
        let target = Path::new(r"\\server\share\project");
        let requested = Path::new(r"\\?\UNC\SERVER\SHARE\Project\src");

        assert!(target_path_is_within(requested, target));
        assert_eq!(
            target_path_relative(requested, target),
            Some(std::path::PathBuf::from("src"))
        );
    }
}
