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
    let cwd = body
        .cwd
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()));

    let (restart_policy, restart_max_retries, env) =
        resolve_terminal_env(&state, body.project.as_deref(), body.env).await?;

    let meta = state
        .pty_manager
        .create(PtyCreateOpts {
            id: body.id,
            command: body.command,
            cwd,
            env,
            cols: body.cols,
            rows: body.rows,
            project: body.project,
            restart_policy,
            restart_max_retries,
        })
        .map_err(ApiError::from_app)?;
    Ok(Json(meta))
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
    state.pty_manager.remove(&id).map_err(ApiError::from_app)?;
    if let Some(pfm) = &state.port_forward_manager {
        pfm.remove_session_ports(&id).await;
    }
    Ok((StatusCode::NO_CONTENT, ()))
}

async fn resolve_terminal_env(
    state: &AppState,
    project_name: Option<&str>,
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
                load_project_env_file(
                    project_name,
                    PathBuf::from(project_path).join(env_file),
                    &mut env,
                )?;
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
