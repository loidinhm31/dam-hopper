use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
};
use serde_json::Value;
use std::path::{Path as StdPath, PathBuf};

use crate::config::{global_config_path, load_workspace_config, read_global_config_at, write_global_config_at};
use crate::error::AppError;
use crate::state::AppState;
use crate::utils::atomic_write;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

pub async fn get_config(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    Json(cfg.clone()).into_response()
}

// ---------------------------------------------------------------------------
// PUT /api/config — full config replace (JSON → TOML → write)
// ---------------------------------------------------------------------------

pub async fn update_config(
    State(state): State<AppState>,
    Json(mut body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let config_path = state.config.read().await.config_path.clone();
    let config_dir = config_path.parent().unwrap_or(StdPath::new("/"));
    relativize_project_paths(&mut body, config_dir);
    write_json_as_toml(&config_path, &body)?;
    reload_config(&state).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// PATCH /api/config/projects/:name
// ---------------------------------------------------------------------------

pub async fn update_project(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(patch): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let config_path = state.config.read().await.config_path.clone();
    let raw = read_toml_value(&config_path)?;

    let mut doc = raw;
    patch_project(&mut doc, &name, &patch)?;

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    atomic_write(&config_path, &toml_str).map_err(ApiError::from_app)?;

    reload_config(&state).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/global-config
// ---------------------------------------------------------------------------

pub async fn get_global_config(State(state): State<AppState>) -> impl IntoResponse {
    let gc = state.global_config.read().await;
    Json(gc.clone()).into_response()
}

// ---------------------------------------------------------------------------
// POST /api/global-config/defaults  { defaults: object }
// ---------------------------------------------------------------------------

pub async fn update_global_defaults(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let gc_path = global_config_path();
    let mut gc = read_global_config_at(&gc_path)
        .map_err(ApiError::from_app)?
        .unwrap_or_default();

    if let Some(defaults_val) = body.get("defaults") {
        let new_defaults: crate::config::schema::GlobalDefaults =
            serde_json::from_value(defaults_val.clone())
                .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
        gc.defaults = Some(new_defaults);
    }

    write_global_config_at(&gc_path, &gc).map_err(ApiError::from_app)?;
    *state.global_config.write().await = gc;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

pub async fn list_projects(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    Json(cfg.projects.clone()).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/projects/:name
// ---------------------------------------------------------------------------

pub async fn get_project(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let cfg = state.config.read().await;
    let project = cfg.projects.iter().find(|p| p.name == name).cloned();
    project
        .map(|p| Ok(Json(p).into_response()))
        .unwrap_or_else(|| Err(ApiError::from_app(AppError::NotFound(format!("Project not found: {name}")))))
}

// ---------------------------------------------------------------------------
// GET /api/projects/:name/status — git status for a single project
// ---------------------------------------------------------------------------

pub async fn get_project_status(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let path: PathBuf = {
        let cfg = state.config.read().await;
        cfg.projects.iter()
            .find(|p| p.name == name)
            .map(|p| PathBuf::from(&p.path))
            .ok_or_else(|| ApiError::from_app(AppError::NotFound(format!("Project not found: {name}"))))?
    };

    let status = crate::git::get_status(&path, &name)
        .unwrap_or_else(|e| crate::git::GitStatus::error(&name, e.to_string()));

    Ok(Json(status))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert absolute project paths to relative (relative to config_dir) so the
/// TOML validator doesn't reject them. Mirrors the logic in `project_to_toml`.
fn relativize_project_paths(body: &mut Value, config_dir: &StdPath) {
    let Some(projects) = body.get_mut("projects").and_then(|p| p.as_array_mut()) else {
        return;
    };
    for project in projects.iter_mut() {
        let Some(path_str) = project.get("path").and_then(|v| v.as_str()).map(str::to_string) else {
            continue;
        };
        let p = StdPath::new(&path_str);
        if p.is_absolute() {
            let rel = pathdiff::diff_paths(p, config_dir)
                .unwrap_or_else(|| p.to_path_buf())
                .to_string_lossy()
                .to_string();
            let rel = if rel.is_empty() { ".".to_string() } else { rel };
            if let Some(obj) = project.as_object_mut() {
                obj.insert("path".to_string(), Value::String(rel));
            }
        }
    }
}

fn read_toml_value(path: &std::path::Path) -> Result<toml::Value, ApiError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| ApiError::from_app(AppError::Config(e.to_string())))?;
    toml::from_str(&content)
        .map_err(|e| ApiError::from_app(AppError::Config(e.to_string())))
}

fn write_json_as_toml(path: &std::path::Path, v: &Value) -> Result<(), ApiError> {
    let tv = json_to_toml(v)
        .ok_or_else(|| ApiError::from_app(AppError::InvalidInput("Cannot convert JSON to TOML".into())))?;
    let toml_str = toml::to_string_pretty(&tv)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    atomic_write(path, &toml_str).map_err(ApiError::from_app)
}

fn patch_project(doc: &mut toml::Value, name: &str, patch: &Value) -> Result<(), ApiError> {
    let projects = doc
        .get_mut("projects")
        .and_then(|p| p.as_array_mut())
        .ok_or_else(|| ApiError::from_app(AppError::Config("No projects array in config".into())))?;

    let project = projects.iter_mut().find(|p| {
        p.get("name").and_then(|n| n.as_str()) == Some(name)
    });

    let proj = project.ok_or_else(|| ApiError::from_app(AppError::NotFound(format!("Project not found: {name}"))))?;

    if let (toml::Value::Table(tbl), Value::Object(patch_map)) = (proj, patch) {
        for (k, v) in patch_map {
            match json_to_toml(v) {
                Some(tv) => { tbl.insert(k.clone(), tv); }
                None => { tbl.remove(k); }
            }
        }
    }
    Ok(())
}

fn json_to_toml(v: &Value) -> Option<toml::Value> {
    match v {
        Value::Null => None,
        Value::Bool(b) => Some(toml::Value::Boolean(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() { Some(toml::Value::Integer(i)) }
            else { n.as_f64().map(toml::Value::Float) }
        }
        Value::String(s) => Some(toml::Value::String(s.clone())),
        Value::Array(arr) => {
            let items: Vec<_> = arr.iter().filter_map(json_to_toml).collect();
            Some(toml::Value::Array(items))
        }
        Value::Object(map) => {
            let mut tbl = toml::map::Map::new();
            for (k, v) in map {
                if let Some(tv) = json_to_toml(v) {
                    tbl.insert(k.clone(), tv);
                }
            }
            Some(toml::Value::Table(tbl))
        }
    }
}

async fn reload_config(state: &AppState) -> Result<(), ApiError> {
    let workspace_dir = state.workspace_dir.read().await.clone();
    let new_cfg = load_workspace_config(&workspace_dir).map_err(ApiError::from_app)?;
    *state.config.write().await = new_cfg;
    Ok(())
}
