use axum::{Json, extract::{State, Query}, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::config::{
    add_known_workspace_at, global_config_path, list_known_workspaces_at,
    load_workspace_config, remove_known_workspace_at,
    discovery::{discover_projects, DiscoveredProject},
    schema::{DamHopperConfig, WorkspaceInfo as WorkspaceInfoSchema, FeaturesConfig, ProjectConfig},
    parser::write_config,
    CONFIG_FILENAME,
};
use crate::pty::EventSink as _;
use crate::state::AppState;

use super::error::{ApiError, AppJson};

// ---------------------------------------------------------------------------
// GET /api/workspace/status
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub ready: bool,
    pub path: Option<String>,
    pub name: Option<String>,
    pub project_count: usize,
}

pub async fn get_status(State(state): State<AppState>) -> AppJson<WorkspaceStatus> {
    let cfg = state.config.read().await;
    let ready = cfg.config_path.exists();
    AppJson(WorkspaceStatus {
        ready,
        path: Some(
            cfg.config_path
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
        ),
        name: Some(cfg.workspace.name.clone()),
        project_count: cfg.projects.len(),
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
    pub project_count: usize,
}

pub async fn get_workspace(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    let workspace_dir = state.workspace_dir.read().await;
    Json(WorkspaceInfo {
        name: cfg.workspace.name.clone(),
        root: workspace_dir.to_string_lossy().into_owned(),
        project_count: cfg.projects.len(),
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

pub async fn init_workspace(
    State(state): State<AppState>,
    Json(body): Json<PathBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = PathBuf::from(&body.path);
    
    // Validate path exists
    if !path.exists() {
        return Err(ApiError::from(crate::error::AppError::NotFound(
            format!("Path not found: {}", body.path)
        )));
    }
    if !path.is_dir() {
        return Err(ApiError::from(crate::error::AppError::InvalidInput(
            "Path is not a directory".to_string()
        )));
    }
    
    // Try to load existing config, or create a new one
    let cfg = match load_workspace_config(&path) {
        Ok(existing) => existing,
        Err(_) => {
            // No config found - create a new one
            let config_path = path.join(CONFIG_FILENAME);
            
            // Derive workspace name from directory
            let workspace_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("workspace")
                .to_string();
            
            // Discover projects in the directory
            let discovered = discover_projects(&path);
            let projects: Vec<ProjectConfig> = discovered
                .into_iter()
                .map(|p| {
                    ProjectConfig {
                        name: p.name,
                        path: p.path, // Absolute; will be made relative by write_config
                        project_type: p.project_type,
                        services: None,
                        commands: None,
                        env_file: None,
                        tags: None,
                        terminals: vec![],
                        agents: None,
                        restart_policy: crate::config::RestartPolicy::Never,
                        restart_max_retries: crate::config::DEFAULT_RESTART_MAX_RETRIES,
                        health_check_url: None,
                    }
                })
                .collect();
            
            let new_config = DamHopperConfig {
                workspace: WorkspaceInfoSchema {
                    name: workspace_name,
                    root: ".".to_string(),
                },
                agent_store: None,
                server: crate::config::ServerConfig::default(),
                projects,
                features: FeaturesConfig::default(),
                config_path: config_path.clone(),
            };
            
            // Write the config file
            write_config(&config_path, &new_config).map_err(ApiError::from_app)?;
            
            // Re-load to get properly resolved paths
            load_workspace_config(&path).map_err(ApiError::from_app)?
        }
    };
    
    let sandbox_root = cfg.config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| path.clone());
    state.fs.reinit_sandbox(sandbox_root);
    *state.workspace_dir.write().await = path;
    *state.config.write().await = cfg;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/workspace/switch  { path: string }
// ---------------------------------------------------------------------------

pub async fn switch_workspace(
    State(state): State<AppState>,
    Json(body): Json<PathBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = std::path::PathBuf::from(&body.path);
    let cfg = load_workspace_config(&path).map_err(ApiError::from_app)?;

    state.pty_manager.dispose();

    let sandbox_root = cfg.config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| path.clone());
    state.fs.reinit_sandbox(sandbox_root);

    *state.workspace_dir.write().await = path.clone();
    *state.config.write().await = cfg;

    state.event_sink.broadcast(
        "workspace:changed",
        serde_json::json!({ "path": body.path }),
    );

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/workspace/known
// ---------------------------------------------------------------------------

pub async fn list_known(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let gc_path = global_config_path();
    let workspaces = list_known_workspaces_at(&gc_path).map_err(ApiError::from_app)?;
    let current = {
        let dir = state.workspace_dir.read().await;
        dir.to_str().map(String::from)
    };
    Ok(Json(serde_json::json!({ "workspaces": workspaces, "current": current })))
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
    State(_state): State<AppState>,
    Json(body): Json<AddKnownBody>,
) -> Result<impl IntoResponse, ApiError> {
    let gc_path = global_config_path();
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
    State(_state): State<AppState>,
    Json(body): Json<PathBody>,
) -> Result<impl IntoResponse, ApiError> {
    let gc_path = global_config_path();
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
        return Err(ApiError::from(crate::error::AppError::NotFound(format!("Path not found: {}", q.path))));
    }
    if !path.is_dir() {
        return Err(ApiError::from(crate::error::AppError::InvalidInput("Path is not a directory".to_string())));
    }
    
    let projects = discover_projects(&path);
    Ok(Json(DiscoverResponse {
        path: q.path,
        projects,
    }))
}
