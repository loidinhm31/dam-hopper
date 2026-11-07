use axum::{
    extract::{rejection::BytesRejection, Path, State},
    http::{
        header::{HeaderMap, HeaderName, HeaderValue, CACHE_CONTROL},
        StatusCode,
    },
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::{collections::HashMap, path::PathBuf};
use tracing::warn;

use crate::config::schema::{RestartPolicy, DEFAULT_RESTART_MAX_RETRIES};
use crate::error::AppError;
use crate::pty::manager::PtyCreateOpts;
use crate::pty::manager::{
    GuardedTerminationError, GuardedTerminationOutcome, TerminalInventoryState,
};
use crate::pty::SessionMeta;
use crate::state::AppState;
use crate::workspace_target::{
    target_path_is_within, target_path_relative, FilesystemTargetRef, ProjectTargetRef,
    ResolvedProjectTarget, WorkspaceTargetError,
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
    #[serde(default)]
    pub target: Option<FilesystemTargetRef>,
    pub project: Option<String>,
    /// Optional registered worktree target. The server resolves and records
    /// the canonical target before spawning the PTY.
    pub worktree_path: Option<String>,
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub struct RenameSessionBody {
    pub name: Option<String>,
}

fn normalize_terminal_name(name: Option<String>) -> Result<Option<String>, AppError> {
    let Some(name) = name else {
        return Ok(None);
    };
    let name = name.trim().to_string();
    if name.is_empty() {
        return Ok(None);
    }
    if name.chars().count() > 64 {
        return Err(AppError::InvalidInput(
            "Terminal name must be 64 characters or fewer".to_string(),
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(
            "Terminal name must not contain control characters".to_string(),
        ));
    }
    Ok(Some(name))
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
        target: requested_target,
        project: requested_project,
        worktree_path: requested_worktree,
        name,
    } = body;

    let (target, cwd, project, canonical_worktree_path) = match requested_target {
        Some(FilesystemTargetRef::Workspace(_)) => {
            if requested_project.is_some() || requested_worktree.is_some() {
                return Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_FS_TARGET",
                    "workspace folder terminal cannot have project or worktreePath",
                ));
            }
            let cwd_param = requested_cwd.ok_or_else(|| {
                ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_FS_TARGET",
                    "workspace folder terminal requires cwd",
                )
            })?;
            let sandbox = state.workspace_sandbox().map_err(|_| {
                ApiError::custom(
                    StatusCode::FORBIDDEN,
                    "UNCONFIGURED_WORKSPACE_ROOT",
                    "workspace root is not configured or unavailable",
                )
            })?;
            sandbox.check_identity().map_err(AppError::Fs)?;
            let p = if std::path::Path::new(&cwd_param).is_absolute() {
                PathBuf::from(&cwd_param)
            } else {
                sandbox.root().join(&cwd_param)
            };
            let canonical_cwd = dunce::canonicalize(&p).map_err(|_| {
                ApiError::custom(StatusCode::BAD_REQUEST, "INVALID_CWD", "cwd does not exist")
            })?;
            if !canonical_cwd.is_dir() {
                return Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_CWD",
                    "cwd is not a directory",
                ));
            }
            if !crate::workspace_target::target_path_is_within(&canonical_cwd, sandbox.root()) {
                return Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "PATH_ESCAPE",
                    "cwd escapes workspace root",
                ));
            }
            sandbox.check_identity().map_err(AppError::Fs)?;
            (
                None,
                canonical_cwd.to_string_lossy().into_owned(),
                None,
                None,
            )
        }
        Some(FilesystemTargetRef::Project(p)) => {
            let target = resolve_terminal_target(&state, Some(&p.project), p.worktree_path).await?;
            let cwd = resolve_terminal_cwd(&state, target.as_ref(), requested_cwd).await?;
            let canonical_worktree_path = target.as_ref().and_then(|resolved| {
                (!resolved.is_root()).then(|| resolved.target_path().to_string_lossy().into_owned())
            });
            let project_name = target.as_ref().map(|t| t.project().to_string());
            (target, cwd, project_name, canonical_worktree_path)
        }
        None => {
            let target =
                resolve_terminal_target(&state, requested_project.as_deref(), requested_worktree)
                    .await?;
            let cwd = resolve_terminal_cwd(&state, target.as_ref(), requested_cwd).await?;
            let canonical_worktree_path = target.as_ref().and_then(|resolved| {
                (!resolved.is_root()).then(|| resolved.target_path().to_string_lossy().into_owned())
            });
            (target, cwd, requested_project, canonical_worktree_path)
        }
    };

    let (restart_policy, restart_max_retries, env) =
        resolve_terminal_env(&state, project.as_deref(), target.as_ref(), env).await?;

    let meta = match state.pty_manager.create(PtyCreateOpts {
        id: id.clone(),
        command,
        cwd,
        env,
        cols,
        rows,
        project,
        worktree_path: canonical_worktree_path,
        name: normalize_terminal_name(name)?,
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
                        &id,
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
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("x-damhopper-termination-version"),
        HeaderValue::from_static("1"),
    );
    headers.insert(
        HeaderName::from_static("x-damhopper-pty-epoch"),
        HeaderValue::try_from(state.pty_manager.server_epoch().to_string()).unwrap(),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((headers, Json(meta)))
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
        if let Some(cwd) = requested_cwd {
            return Ok(cwd);
        }
        if let Ok(sandbox) = state.workspace_sandbox() {
            if sandbox.root().is_dir() {
                return Ok(sandbox.root().to_string_lossy().into_owned());
            }
        }
        return default_untargeted_terminal_cwd();
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

#[cfg(not(windows))]
fn default_untargeted_terminal_cwd() -> Result<String, ApiError> {
    Ok(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
}

#[cfg(windows)]
fn default_untargeted_terminal_cwd() -> Result<String, ApiError> {
    dirs::home_dir()
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok().filter(|path| path.is_dir()))
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| {
            ApiError::from_app(AppError::PtyError(
                "Unable to resolve a valid Windows terminal cwd".into(),
            ))
        })
}

// ---------------------------------------------------------------------------
// GET /api/terminal
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct TerminalInventoryRowDto {
    #[serde(flatten)]
    pub meta: SessionMeta,
    #[serde(rename = "incarnationExact")]
    pub incarnation_exact: String,
    #[serde(rename = "terminationState")]
    pub termination_state: TerminalInventoryState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffer_bytes: Option<usize>,
}

pub async fn list_sessions(State(state): State<AppState>) -> impl IntoResponse {
    let snapshot = state.pty_manager.termination_inventory_snapshot(false);
    let rows: Vec<TerminalInventoryRowDto> = snapshot
        .rows
        .into_iter()
        .map(|row| TerminalInventoryRowDto {
            meta: row.meta,
            incarnation_exact: row.incarnation.to_string(),
            termination_state: row.termination_state,
            buffer_bytes: None,
        })
        .collect();

    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("x-damhopper-termination-version"),
        HeaderValue::from_static("1"),
    );
    headers.insert(
        HeaderName::from_static("x-damhopper-pty-epoch"),
        HeaderValue::try_from(snapshot.server_epoch.to_string()).unwrap(),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));

    (headers, Json(rows))
}

// ---------------------------------------------------------------------------
// GET /api/terminal/detailed
// ---------------------------------------------------------------------------

pub async fn list_detailed(State(state): State<AppState>) -> impl IntoResponse {
    let snapshot = state.pty_manager.termination_inventory_snapshot(true);
    let rows: Vec<TerminalInventoryRowDto> = snapshot
        .rows
        .into_iter()
        .map(|row| TerminalInventoryRowDto {
            meta: row.meta,
            incarnation_exact: row.incarnation.to_string(),
            termination_state: row.termination_state,
            buffer_bytes: Some(row.buffer_bytes.unwrap_or(0)),
        })
        .collect();

    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("x-damhopper-termination-version"),
        HeaderValue::from_static("1"),
    );
    headers.insert(
        HeaderName::from_static("x-damhopper-pty-epoch"),
        HeaderValue::try_from(snapshot.server_epoch.to_string()).unwrap(),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));

    (headers, Json(rows))
}

// ---------------------------------------------------------------------------
// POST /api/terminal/:id/terminate
// ---------------------------------------------------------------------------

pub const TERMINATION_MAX_BODY_BYTES: usize = 512;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct TerminateRequestBody {
    version: serde_json::Value,
    expected_server_epoch: serde_json::Value,
    expected_incarnation: serde_json::Value,
}

fn is_canonical_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let b = s.as_bytes();
    if b[8] != b'-' || b[13] != b'-' || b[18] != b'-' || b[23] != b'-' {
        return false;
    }
    for (i, &c) in b.iter().enumerate() {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            continue;
        }
        if !c.is_ascii_digit() && !(b'a'..=b'f').contains(&c) {
            return false;
        }
    }
    true
}

fn is_canonical_positive_u64(s: &str) -> bool {
    if s.is_empty() || s.len() > 20 {
        return false;
    }
    let bytes = s.as_bytes();
    if !bytes[0].is_ascii_digit() || bytes[0] == b'0' {
        return false;
    }
    for &b in &bytes[1..] {
        if !b.is_ascii_digit() {
            return false;
        }
    }
    if s.len() == 20 && s > "18446744073709551615" {
        return false;
    }
    s.parse::<u64>().is_ok()
}

pub async fn terminate_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    payload: Result<axum::body::Bytes, BytesRejection>,
) -> (StatusCode, Json<serde_json::Value>) {
    let is_json = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.starts_with("application/json"))
        .unwrap_or(false);
    if !is_json {
        return (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(serde_json::json!({
                "error": "Content-Type must be application/json",
                "code": "TERMINATION_INVALID_REQUEST",
            })),
        );
    }
    let bytes = match payload {
        Ok(b) => b,
        Err(e) => {
            if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
                return (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    Json(serde_json::json!({
                        "error": "Request body exceeds 512 bytes limit",
                        "code": "TERMINATION_BODY_TOO_LARGE",
                    })),
                );
            }
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Malformed termination request payload",
                    "code": "TERMINATION_INVALID_REQUEST",
                })),
            );
        }
    };

    if bytes.len() > TERMINATION_MAX_BODY_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "error": "Request body exceeds 512 bytes limit",
                "code": "TERMINATION_BODY_TOO_LARGE",
            })),
        );
    }

    let body: TerminateRequestBody = match serde_json::from_slice(&bytes) {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Malformed termination request payload",
                    "code": "TERMINATION_INVALID_REQUEST",
                })),
            );
        }
    };

    // Check version
    match body.version.as_i64() {
        Some(1) => {}
        Some(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Unsupported protocol version",
                    "code": "TERMINATION_UNSUPPORTED_VERSION",
                })),
            );
        }
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Malformed termination request payload",
                    "code": "TERMINATION_INVALID_REQUEST",
                })),
            );
        }
    }

    // Check expectedServerEpoch: must be string and canonical lowercase UUID
    let epoch_str = match body.expected_server_epoch.as_str() {
        Some(s) if is_canonical_uuid(s) => s,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Malformed termination request payload",
                    "code": "TERMINATION_INVALID_REQUEST",
                })),
            );
        }
    };
    let expected_epoch = match uuid::Uuid::parse_str(epoch_str) {
        Ok(u) => u,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Malformed termination request payload",
                    "code": "TERMINATION_INVALID_REQUEST",
                })),
            );
        }
    };

    // Check expectedIncarnation: must be string and canonical positive u64
    let inc_str = match body.expected_incarnation.as_str() {
        Some(s) if is_canonical_positive_u64(s) => s,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Malformed termination request payload",
                    "code": "TERMINATION_INVALID_REQUEST",
                })),
            );
        }
    };
    let expected_incarnation: u64 = match inc_str.parse() {
        Ok(n) if n > 0 => n,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Malformed termination request payload",
                    "code": "TERMINATION_INVALID_REQUEST",
                })),
            );
        }
    };

    match state
        .pty_manager
        .request_termination(&id, &expected_epoch, expected_incarnation)
    {
        Ok(GuardedTerminationOutcome::TerminationRequested) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({
                "version": 1,
                "serverEpoch": epoch_str,
                "terminalId": id,
                "incarnation": inc_str,
                "outcome": "terminationRequested",
            })),
        ),
        Ok(GuardedTerminationOutcome::RestartCancelled) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "version": 1,
                "serverEpoch": epoch_str,
                "terminalId": id,
                "incarnation": inc_str,
                "outcome": "restartCancelled",
            })),
        ),
        Err(GuardedTerminationError::EpochMismatch) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "PTY server epoch mismatch",
                "code": "TERMINATION_EPOCH_MISMATCH",
            })),
        ),
        Err(GuardedTerminationError::ManagerClosing) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "PTY manager is shutting down",
                "code": "TERMINATION_MANAGER_CLOSING",
            })),
        ),
        Err(GuardedTerminationError::ReplacementPending) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Replacement session creation already admitted",
                "code": "TERMINATION_REPLACEMENT_PENDING",
            })),
        ),
        Err(GuardedTerminationError::NotFound) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "Session not found",
                "code": "TERMINATION_NOT_FOUND",
            })),
        ),
        Err(GuardedTerminationError::IncarnationMismatch) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Incarnation mismatch",
                "code": "TERMINATION_INCARNATION_MISMATCH",
            })),
        ),
        Err(GuardedTerminationError::AlreadyRequested) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Termination already requested or cancelled",
                "code": "TERMINATION_ALREADY_REQUESTED",
            })),
        ),
        Err(GuardedTerminationError::NotLive) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Session is not live or cancellable",
                "code": "TERMINATION_NOT_LIVE",
            })),
        ),
        Err(GuardedTerminationError::SignalFailed(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "OS process signal dispatch failed",
                "code": "TERMINATION_SIGNAL_FAILED",
            })),
        ),
    }
}

pub async fn rename_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<RenameSessionBody>,
) -> Result<impl IntoResponse, ApiError> {
    let name = normalize_terminal_name(body.name).map_err(ApiError::from_app)?;
    let meta = state
        .pty_manager
        .rename(&id, name)
        .map_err(ApiError::from_app)?;
    Ok(Json(meta))
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
        pfm.remove_session_ports(&id, incarnation);
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

#[cfg(test)]
mod terminal_name_tests {
    use super::normalize_terminal_name;
    use crate::error::AppError;

    #[test]
    fn terminal_name_normalizes_trimmed_and_blank_values() {
        assert_eq!(
            normalize_terminal_name(Some("  Release shell \t".to_string())).unwrap(),
            Some("Release shell".to_string())
        );
        assert_eq!(normalize_terminal_name(None).unwrap(), None);
        assert_eq!(
            normalize_terminal_name(Some(" \n\t ".to_string())).unwrap(),
            None
        );
    }

    #[test]
    fn terminal_name_rejects_control_characters_and_long_values() {
        let control_error =
            normalize_terminal_name(Some("Release\u{0007}shell".to_string())).unwrap_err();
        assert!(matches!(
            control_error,
            AppError::InvalidInput(message)
                if message == "Terminal name must not contain control characters"
        ));

        let length_error = normalize_terminal_name(Some("x".repeat(65))).unwrap_err();
        assert!(matches!(
            length_error,
            AppError::InvalidInput(message)
                if message == "Terminal name must be 64 characters or fewer"
        ));
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{default_untargeted_terminal_cwd, target_path_is_within, target_path_relative};
    use std::path::Path;

    #[test]
    fn windows_default_terminal_cwd_is_an_existing_directory() {
        let cwd = default_untargeted_terminal_cwd()
            .unwrap_or_else(|error| panic!("Windows cwd fallback: {}", error));
        assert!(Path::new(&cwd).is_dir());
        assert_ne!(cwd, "/tmp");
    }

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
