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
use crate::telemetry::SafeIdentifier;
use uuid::Uuid;

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
    let cwd = resolve_terminal_cwd(&state, body.project.as_deref(), body.cwd).await?;

    let (restart_policy, restart_max_retries, env) =
        resolve_terminal_env(&state, body.project.as_deref(), body.env).await?;
    let telemetry = state
        .telemetry
        .read()
        .expect("telemetry state lock poisoned")
        .clone();
    let collector_enabled = state.config.read().await.server.telemetry.collector.enabled;
    let codex_marker = (collector_enabled
        && telemetry.control.is_enabled()
        && is_direct_codex_command(&body.command)
        && !env.contains_key("OTEL_RESOURCE_ATTRIBUTES")
        // Do not overwrite an inherited collector configuration either.
        && std::env::var_os("OTEL_RESOURCE_ATTRIBUTES").is_none())
    .then(|| SafeIdentifier::new(Uuid::new_v4().to_string()).expect("UUID is a safe identifier"));

    let meta = state
        .pty_manager
        .create(PtyCreateOpts {
            id: body.id,
            command: body.command,
            cwd,
            env,
            runtime_otlp_run_marker: codex_marker
                .as_ref()
                .map(|marker| marker.as_str().to_string()),
            cols: body.cols,
            rows: body.rows,
            project: body.project,
            restart_policy,
            restart_max_retries,
        })
        .map_err(ApiError::from_app)?;
    if let Some(marker) = codex_marker {
        telemetry
            .codex_correlation
            .register(marker, chrono::Utc::now().timestamp_millis());
    }
    Ok(Json(meta))
}

fn is_direct_codex_command(command: &str) -> bool {
    let mut words = command.split_ascii_whitespace();
    matches!(words.next(), Some("codex"))
        && !command.chars().any(|character| {
            matches!(
                character,
                '|' | ';' | '&' | '>' | '<' | '`' | '$' | '\n' | '\r'
            )
        })
}

#[cfg(test)]
mod tests {
    use super::is_direct_codex_command;

    #[test]
    fn recognizes_only_an_uncomposed_codex_invocation() {
        assert!(is_direct_codex_command("codex --json"));
        assert!(!is_direct_codex_command("CODEx --json"));
        assert!(!is_direct_codex_command("env codex --json"));
        assert!(!is_direct_codex_command("codex --json && other-command"));
        assert!(!is_direct_codex_command("codex; other-command"));
    }
}

async fn resolve_terminal_cwd(
    state: &AppState,
    project_name: Option<&str>,
    requested_cwd: Option<String>,
) -> Result<String, ApiError> {
    let Some(project_name) = project_name else {
        return Ok(requested_cwd
            .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())));
    };

    let sandbox = state
        .fs
        .sandbox()
        .map_err(|err| ApiError::from_app(AppError::Fs(err)))?;
    let project_root = sandbox.project_root(project_name).ok_or_else(|| {
        ApiError::from_app(AppError::NotFound(format!(
            "Project not found: {project_name}"
        )))
    })?;
    let proposed = requested_cwd
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                project_root.join(path)
            }
        })
        .unwrap_or_else(|| project_root.clone());
    let cwd = sandbox
        .validate(project_name, proposed)
        .await
        .map_err(|err| ApiError::from_app(AppError::Fs(err)))?;

    if !cwd.is_dir() {
        return Err(ApiError::from_app(AppError::InvalidInput(format!(
            "Terminal cwd is not a directory: {}",
            cwd.display()
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
