use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::config::{
    add_known_workspace_at,
    discovery::{discover_projects, DiscoveredProject},
    list_known_workspaces_at, remove_known_workspace_at,
};
use crate::pty::EventSink as _;
use crate::state::AppState;
use crate::utils::atomic_write;

use super::config::read_toml_value;
use super::error::{ApiError, AppJson};

// ---------------------------------------------------------------------------
// GET /api/workspace/status
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub ready: bool,
    pub path: Option<String>,
    pub config_path: Option<String>,
    pub name: Option<String>,
    pub project_count: usize,
    pub workspace_epoch: u64,
}

pub async fn get_status(State(state): State<AppState>) -> AppJson<WorkspaceStatus> {
    let cfg = state.config.read().await;
    let ws_root = cfg.resolve_workspace_root().ok();
    let ready = ws_root.is_some();
    let epoch = state.workspace_epoch();
    AppJson(WorkspaceStatus {
        ready,
        path: ws_root.as_ref().map(|p| p.to_string_lossy().into_owned()),
        config_path: Some(cfg.config_path.to_string_lossy().into_owned()),
        name: Some(cfg.workspace.name.clone()),
        project_count: cfg.projects.len(),
        workspace_epoch: epoch,
    })
}

// ---------------------------------------------------------------------------
// GET /api/workspace
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub name: String,
    pub root: String,
    pub config_path: String,
    pub project_count: usize,
    pub workspace_epoch: u64,
}

pub async fn get_workspace(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    let ws_root = cfg.resolve_workspace_root().ok();
    let epoch = state.workspace_epoch();
    Json(WorkspaceInfo {
        name: cfg.workspace.name.clone(),
        root: ws_root
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| cfg.workspace.root.clone()),
        config_path: cfg.config_path.to_string_lossy().into_owned(),
        project_count: cfg.projects.len(),
        workspace_epoch: epoch,
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// POST /api/workspace/init  { path: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PathBody {
    pub path: String,
}

#[derive(Deserialize)]
pub struct SwitchWorkspaceBody {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

pub async fn init_workspace(
    State(state): State<AppState>,
    Json(body): Json<PathBody>,
) -> Result<impl IntoResponse, ApiError> {
    let candidate = PathBuf::from(body.path.trim());
    let canonical = dunce::canonicalize(&candidate).map_err(|_e| {
        ApiError::from(crate::error::AppError::NotFound(format!(
            "Path not found: {}",
            body.path
        )))
    })?;
    if !canonical.is_dir() {
        return Err(ApiError::from(crate::error::AppError::InvalidInput(
            "Path is not a directory".to_string(),
        )));
    }
    if crate::config::parser::is_sensitive_workspace_root(&canonical) {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "SENSITIVE_DIRECTORY",
            "Workspace root resolves to sensitive directory",
        ));
    }
    crate::fs::sandbox::WorkspaceSandbox::new(canonical.clone()).map_err(|e| {
        ApiError::custom(StatusCode::BAD_REQUEST, "INVALID_ROOT", e.to_string())
    })?;

    let workspace_name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workspace")
        .to_string();

    let discovered = discover_projects(&canonical);

    let _workspace_context = state.workspace_context_guard.write().await;
    let config_path = state.config.read().await.config_path.clone();
    let mut doc = read_toml_value(&config_path)?;
    let root_table = doc.as_table_mut().ok_or_else(|| {
        ApiError::from_app(crate::error::AppError::Config("Expected TOML table at root".into()))
    })?;

    let ws_table = root_table
        .entry("workspace")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| {
            ApiError::from_app(crate::error::AppError::Config("[workspace] must be a table".into()))
        })?;
    ws_table.insert("name".to_string(), toml::Value::String(workspace_name));
    ws_table.insert("root".to_string(), toml::Value::String(canonical.to_string_lossy().into_owned()));

    if !discovered.is_empty() {
        let projects = root_table
            .entry("projects")
            .or_insert_with(|| toml::Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| {
                ApiError::from_app(crate::error::AppError::Config("projects must be an array".into()))
            })?;
        for p in discovered {
            if !projects.iter().any(|existing| existing.get("name").and_then(|n| n.as_str()) == Some(&p.name)) {
                let toml_path = crate::config::parser::project_path_for_toml(&PathBuf::from(&p.path), &canonical);
                let mut ptable = toml::map::Map::new();
                ptable.insert("name".to_string(), toml::Value::String(p.name));
                ptable.insert("path".to_string(), toml::Value::String(toml_path));
                ptable.insert("type".to_string(), toml::Value::String(p.project_type.to_string()));
                projects.push(toml::Value::Table(ptable));
            }
        }
    }

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?;
    let candidate_cfg = crate::config::parse_config_str_at_path(&toml_str, &config_path)
        .map_err(ApiError::from_app)?;

    atomic_write(&config_path, &toml_str).map_err(ApiError::from_app)?;

    let _ = state.pty_manager.dispose();
    state.media_tickets.revoke_all();
    state.fs.reinit_workspace_sandbox(Some(canonical.clone()));
    state.fs.bump_workspace_epoch();
    state.fs.reinit_sandbox(crate::state::project_roots_from_config(&candidate_cfg));
    state.workspace_target_resolver.invalidate_all().await;
    *state.workspace_dir.write().await = canonical.clone();
    *state.global_config.write().await = crate::config::schema::GlobalConfig {
        workspace: Some(candidate_cfg.workspace.clone()),
        workspaces: candidate_cfg.workspaces.clone(),
        ui: candidate_cfg.ui.clone(),
        server: candidate_cfg.server.clone(),
    };
    *state.config.write().await = candidate_cfg;

    state.event_sink.broadcast(
        "workspace:changed",
        serde_json::json!({
            "path": canonical.to_string_lossy(),
            "workspaceEpoch": state.workspace_epoch()
        }),
    );

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/workspace/switch  { path: string } or { root: string, name?: string }
// ---------------------------------------------------------------------------

pub async fn switch_workspace(
    State(state): State<AppState>,
    Json(body): Json<SwitchWorkspaceBody>,
) -> Result<impl IntoResponse, ApiError> {
    let target_str = body.root.as_deref().or(body.path.as_deref()).unwrap_or("").trim();
    if target_str.is_empty() {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "INVALID_ROOT",
            "Target path cannot be empty",
        ));
    }

    let candidate_path = PathBuf::from(target_str);
    let canonical = dunce::canonicalize(&candidate_path).map_err(|e| {
        ApiError::custom(
            StatusCode::BAD_REQUEST,
            "NOT_FOUND",
            format!("Path not found: {e}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "NOT_A_DIRECTORY",
            "Path is not a directory",
        ));
    }
    if crate::config::parser::is_sensitive_workspace_root(&canonical) {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "SENSITIVE_DIRECTORY",
            "Workspace root resolves to sensitive directory",
        ));
    }
    crate::fs::sandbox::WorkspaceSandbox::new(canonical.clone()).map_err(|e| {
        ApiError::custom(StatusCode::BAD_REQUEST, "INVALID_ROOT", e.to_string())
    })?;

    let _workspace_context = state.workspace_context_guard.write().await;
    let config_path = state.config.read().await.config_path.clone();
    let mut doc = read_toml_value(&config_path)?;
    let root_table = doc.as_table_mut().ok_or_else(|| {
        ApiError::from_app(crate::error::AppError::Config("Expected TOML table at root".into()))
    })?;

    let ws_table = root_table
        .entry("workspace")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| {
            ApiError::from_app(crate::error::AppError::Config("[workspace] must be a table".into()))
        })?;

    ws_table.insert(
        "root".to_string(),
        toml::Value::String(canonical.to_string_lossy().into_owned()),
    );
    if let Some(name) = body.name.filter(|n| !n.trim().is_empty()) {
        ws_table.insert("name".to_string(), toml::Value::String(name));
    }

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(crate::error::AppError::Internal(e.to_string())))?;
    let candidate = crate::config::parse_config_str_at_path(&toml_str, &config_path)
        .map_err(ApiError::from_app)?;

    atomic_write(&config_path, &toml_str).map_err(ApiError::from_app)?;

    let _ = state.pty_manager.dispose();
    state.media_tickets.revoke_all();
    state.fs.reinit_workspace_sandbox(Some(canonical.clone()));
    state.fs.bump_workspace_epoch();
    state.fs.reinit_sandbox(crate::state::project_roots_from_config(&candidate));
    state.workspace_target_resolver.invalidate_all().await;
    *state.workspace_dir.write().await = canonical.clone();
    *state.global_config.write().await = crate::config::schema::GlobalConfig {
        workspace: Some(candidate.workspace.clone()),
        workspaces: candidate.workspaces.clone(),
        ui: candidate.ui.clone(),
        server: candidate.server.clone(),
    };
    *state.config.write().await = candidate;

    state.event_sink.broadcast(
        "workspace:changed",
        serde_json::json!({
            "path": canonical.to_string_lossy(),
            "workspaceEpoch": state.workspace_epoch()
        }),
    );

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/workspace/known
// ---------------------------------------------------------------------------

pub async fn list_known(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let gc_path = state.config.read().await.config_path.clone();
    let workspaces = list_known_workspaces_at(&gc_path).map_err(ApiError::from_app)?;
    let current = {
        let dir = state.workspace_dir.read().await;
        dir.to_str().map(String::from)
    };
    Ok(Json(
        serde_json::json!({ "workspaces": workspaces, "current": current }),
    ))
}

// ---------------------------------------------------------------------------
// POST /api/workspace/known  { path: string, name?: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AddKnownBody {
    pub path: String,
    pub name: Option<String>,
}

pub async fn add_known(
    State(state): State<AppState>,
    Json(body): Json<AddKnownBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _workspace_context = state.workspace_context_guard.write().await;
    let gc_path = state.config.read().await.config_path.clone();
    // Derive workspace name from path if not provided
    let name = body.name.clone().unwrap_or_else(|| {
        std::path::Path::new(&body.path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("workspace")
            .to_string()
    });
    add_known_workspace_at(&gc_path, &name, &body.path).map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// DELETE /api/workspace/known  { path: string }
// ---------------------------------------------------------------------------

pub async fn remove_known(
    State(state): State<AppState>,
    Json(body): Json<PathBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _workspace_context = state.workspace_context_guard.write().await;
    let gc_path = state.config.read().await.config_path.clone();
    remove_known_workspace_at(&gc_path, &body.path).map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/workspace/discover?path=...
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct DiscoverQuery {
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResponse {
    pub path: String,
    pub projects: Vec<DiscoveredProject>,
}

pub async fn discover_projects_handler(
    Query(q): Query<DiscoverQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = std::path::PathBuf::from(&q.path);

    // Validate path exists and is a directory
    if !path.exists() {
        return Err(ApiError::from(crate::error::AppError::NotFound(format!(
            "Path not found: {}",
            q.path
        ))));
    }
    if !path.is_dir() {
        return Err(ApiError::from(crate::error::AppError::InvalidInput(
            "Path is not a directory".to_string(),
        )));
    }

    let projects = discover_projects(&path);
    Ok(Json(DiscoverResponse {
        path: q.path,
        projects,
    }))
}
