use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde_json::Value;
use std::path::{Path as FsPath, Path as StdPath, PathBuf};

use crate::config::parser::project_path_for_toml;
use crate::config::schema::DamHopperConfig;
use crate::config::{
    global_config_path, read_config, read_global_config_at, write_global_config_at,
};
use crate::error::AppError;
use crate::state::{project_roots_from_config, AppState};
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
    // Hold the workspace guard before taking the snapshot. A full-config PUT
    // must not serialize a stale semantic value after a settings PATCH wins.
    let _workspace_context = state.workspace_context_guard.write().await;
    let current = state.config.read().await.clone();
    preserve_and_reject_telemetry_mutation(&mut body, &current)?;
    preserve_and_reject_semantic_mutation(&mut body, &current)?;
    let config_path = current.config_path.clone();
    let config_dir = config_path.parent().unwrap_or(StdPath::new("/"));
    relativize_project_paths(&mut body, config_dir);
    normalize_config_json_for_toml(&mut body);
    write_json_as_toml(&config_path, &body)?;
    reload_config_locked(&state).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn preserve_and_reject_semantic_mutation(
    body: &mut Value,
    current: &DamHopperConfig,
) -> Result<(), ApiError> {
    let current = serde_json::to_value(&current.server.semantic)
        .map_err(|error| ApiError::from_app(AppError::Internal(error.to_string())))?;
    let root = body.as_object_mut().ok_or_else(|| {
        ApiError::from_app(AppError::InvalidInput(
            "Config must be an object".to_string(),
        ))
    })?;
    let server = root
        .entry("server")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            ApiError::from_app(AppError::InvalidInput(
                "server must be an object".to_string(),
            ))
        })?;
    let requested = server.entry("semantic").or_insert_with(|| current.clone());
    if requested != &current {
        return Err(ApiError::from_app(AppError::InvalidInput(
            "Update semantic navigation through /api/settings/semantic-navigation".to_string(),
        )));
    }
    Ok(())
}

fn preserve_and_reject_telemetry_mutation(
    body: &mut Value,
    current: &DamHopperConfig,
) -> Result<(), ApiError> {
    let current = serde_json::to_value(&current.server.telemetry)
        .map_err(|error| ApiError::from_app(AppError::Internal(error.to_string())))?;
    let root = body.as_object_mut().ok_or_else(|| {
        ApiError::from_app(AppError::InvalidInput(
            "Config must be an object".to_string(),
        ))
    })?;
    let server = root
        .entry("server")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            ApiError::from_app(AppError::InvalidInput(
                "server must be an object".to_string(),
            ))
        })?;
    let requested = server.entry("telemetry").or_insert_with(|| current.clone());
    if requested != &current {
        return Err(ApiError::from_app(AppError::InvalidInput(
            "Update telemetry through /api/usage/settings".to_string(),
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// PATCH /api/config/projects/:name
// ---------------------------------------------------------------------------

pub async fn update_project(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(patch): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    // Serialize project patches with semantic settings and workspace changes from
    // the active config read through runtime application.
    let _workspace_context = state.workspace_context_guard.write().await;
    let config_path = state.config.read().await.config_path.clone();
    let raw = read_toml_value(&config_path)?;

    let mut doc = raw;
    patch_project(&mut doc, &name, &patch)?;

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    atomic_write(&config_path, &toml_str).map_err(ApiError::from_app)?;

    reload_config_locked(&state).await?;
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
    Ok(Json(serde_json::json!({ "updated": true })))
}

// ---------------------------------------------------------------------------
// POST /api/global-config/ui  { ui: UiConfig fields }
// ---------------------------------------------------------------------------

pub async fn update_global_ui(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let gc_path = global_config_path();
    update_global_ui_at_path(&state, &gc_path, body.get("ui"))
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "updated": true })))
}

pub(crate) fn merge_global_ui_config(
    existing: Option<crate::config::schema::UiConfig>,
    incoming: &Value,
) -> Result<crate::config::schema::UiConfig, AppError> {
    if !incoming.is_object() {
        return Err(AppError::InvalidInput("ui must be an object".to_string()));
    }
    let mut merged = serde_json::to_value(existing.unwrap_or_default())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    merge_json_objects(&mut merged, incoming);
    let new_ui: crate::config::schema::UiConfig = serde_json::from_value(merged)
        .map_err(|e| AppError::InvalidInput(format!("Invalid UI config: {e}")))?;
    new_ui
        .validate_font_sizes()
        .map_err(AppError::InvalidInput)?;
    new_ui
        .validate_mobile_keyboard_sizes()
        .map_err(AppError::InvalidInput)?;
    new_ui
        .validate_terminal_notification_sound_volume()
        .map_err(AppError::InvalidInput)?;
    Ok(new_ui)
}

pub(crate) async fn update_global_ui_at_path(
    state: &AppState,
    gc_path: &FsPath,
    incoming_ui: Option<&Value>,
) -> Result<(), AppError> {
    update_global_ui_at_path_with_codex_home(state, gc_path, incoming_ui, None).await
}

pub(crate) async fn update_global_ui_at_path_with_codex_home(
    state: &AppState,
    gc_path: &FsPath,
    incoming_ui: Option<&Value>,
    codex_home_override: Option<&FsPath>,
) -> Result<(), AppError> {
    let mut gc = read_global_config_at(gc_path)?.unwrap_or_default();
    let should_sync_codex_tui = incoming_ui
        .and_then(|ui| ui.get("terminalCodexNotificationsEnabled"))
        .is_some();
    let previous_codex_notifications_enabled = gc
        .ui
        .as_ref()
        .map(|ui| ui.terminal_codex_notifications_enabled)
        .unwrap_or(false);

    if let Some(ui_val) = incoming_ui {
        gc.ui = Some(merge_global_ui_config(gc.ui.clone(), ui_val)?);
    }

    let next_codex_notifications_enabled = gc
        .ui
        .as_ref()
        .map(|ui| ui.terminal_codex_notifications_enabled)
        .unwrap_or(false);

    if should_sync_codex_tui
        || next_codex_notifications_enabled != previous_codex_notifications_enabled
    {
        sync_codex_tui_config(codex_home_override, next_codex_notifications_enabled)?;
    }

    write_global_config_at(gc_path, &gc)?;
    *state.global_config.write().await = gc;
    Ok(())
}

fn sync_codex_tui_config(
    codex_home_override: Option<&FsPath>,
    enabled: bool,
) -> Result<(), AppError> {
    let home_dir = codex_home_override
        .map(FsPath::to_path_buf)
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::Config("Unable to resolve home directory".to_string()))?;
    let codex_dir = home_dir.join(".codex");
    let config_path = codex_dir.join("config.toml");

    if !enabled && !config_path.exists() {
        return Ok(());
    }

    let mut doc = if config_path.exists() {
        let raw = std::fs::read_to_string(&config_path).map_err(|e| {
            AppError::Config(format!("Failed to read {}: {e}", config_path.display()))
        })?;
        if raw.trim().is_empty() {
            toml::Value::Table(toml::map::Map::new())
        } else {
            toml::from_str::<toml::Value>(&raw).map_err(|e| {
                AppError::InvalidInput(format!("Invalid TOML in {}: {e}", config_path.display()))
            })?
        }
    } else {
        std::fs::create_dir_all(&codex_dir).map_err(|e| {
            AppError::Config(format!("Failed to create {}: {e}", codex_dir.display()))
        })?;
        toml::Value::Table(toml::map::Map::new())
    };

    let root = doc.as_table_mut().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "{} root must be a TOML table",
            config_path.display()
        ))
    })?;
    let tui_value = root
        .entry("tui".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let tui = tui_value.as_table_mut().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "{} [tui] section must be a TOML table",
            config_path.display()
        ))
    })?;

    tui.insert("notifications".to_string(), toml::Value::Boolean(enabled));
    tui.insert(
        "notification_method".to_string(),
        toml::Value::String("osc9".to_string()),
    );
    tui.insert(
        "notification_condition".to_string(),
        toml::Value::String("always".to_string()),
    );

    let serialized = toml::to_string_pretty(&doc).map_err(|e| AppError::Internal(e.to_string()))?;
    atomic_write(&config_path, &serialized)?;
    Ok(())
}

fn merge_json_objects(base: &mut Value, incoming: &Value) {
    let (Some(base_obj), Some(incoming_obj)) = (base.as_object_mut(), incoming.as_object()) else {
        return;
    };
    for (key, value) in incoming_obj {
        base_obj.insert(key.clone(), value.clone());
    }
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
        .unwrap_or_else(|| {
            Err(ApiError::from_app(AppError::NotFound(format!(
                "Project not found: {name}"
            ))))
        })
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
        cfg.projects
            .iter()
            .find(|p| p.name == name)
            .map(|p| PathBuf::from(&p.path))
            .ok_or_else(|| {
                ApiError::from_app(AppError::NotFound(format!("Project not found: {name}")))
            })?
    };

    let status = crate::git::get_status(&path, &name)
        .unwrap_or_else(|e| crate::git::GitStatus::error(&name, e.to_string()));

    Ok(Json(status))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Format project paths the same way as `project_to_toml`: keep them relative
/// only when they stay inside `config_dir` without a `..` prefix; otherwise
/// preserve the absolute path.
fn relativize_project_paths(body: &mut Value, config_dir: &StdPath) {
    let Some(projects) = body.get_mut("projects").and_then(|p| p.as_array_mut()) else {
        return;
    };
    for project in projects.iter_mut() {
        let Some(path_str) = project
            .get("path")
            .and_then(|v| v.as_str())
            .map(str::to_string)
        else {
            continue;
        };
        let p = StdPath::new(&path_str);
        if p.is_absolute() {
            if let Some(obj) = project.as_object_mut() {
                obj.insert(
                    "path".to_string(),
                    Value::String(project_path_for_toml(p, config_dir)),
                );
            }
        }
    }
}

fn read_toml_value(path: &std::path::Path) -> Result<toml::Value, ApiError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| ApiError::from_app(AppError::Config(e.to_string())))?;
    toml::from_str(&content).map_err(|e| ApiError::from_app(AppError::Config(e.to_string())))
}

fn write_json_as_toml(path: &std::path::Path, v: &Value) -> Result<(), ApiError> {
    let tv = json_to_toml(v).ok_or_else(|| {
        ApiError::from_app(AppError::InvalidInput("Cannot convert JSON to TOML".into()))
    })?;
    let toml_str = toml::to_string_pretty(&tv)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    atomic_write(path, &toml_str).map_err(ApiError::from_app)
}

fn patch_project(doc: &mut toml::Value, name: &str, patch: &Value) -> Result<(), ApiError> {
    let projects = doc
        .get_mut("projects")
        .and_then(|p| p.as_array_mut())
        .ok_or_else(|| {
            ApiError::from_app(AppError::Config("No projects array in config".into()))
        })?;

    let project = projects
        .iter_mut()
        .find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name));

    let proj = project.ok_or_else(|| {
        ApiError::from_app(AppError::NotFound(format!("Project not found: {name}")))
    })?;

    if let (toml::Value::Table(tbl), Value::Object(patch_map)) = (proj, patch) {
        for (k, v) in patch_map {
            let toml_key = project_json_key_to_toml(k);
            let normalized_value = normalize_project_field_value_for_toml(toml_key, v);
            remove_project_key_aliases(tbl, toml_key);
            match json_to_toml(&normalized_value) {
                Some(tv) => {
                    tbl.insert(toml_key.to_string(), tv);
                }
                None => {
                    tbl.remove(toml_key);
                }
            }
        }
    }
    Ok(())
}

fn normalize_config_json_for_toml(value: &mut Value) {
    if let Some(projects) = value.get_mut("projects").and_then(Value::as_array_mut) {
        for project in projects {
            normalize_project_json_for_toml(project);
        }
    }
}

fn normalize_project_json_for_toml(value: &mut Value) {
    let Some(project) = value.as_object_mut() else {
        return;
    };

    let entries = std::mem::take(project);
    for (key, value) in entries {
        let toml_key = project_json_key_to_toml(&key).to_string();
        project.insert(
            toml_key.clone(),
            normalize_project_field_value_for_toml(&toml_key, &value),
        );
    }
}

fn project_json_key_to_toml(key: &str) -> &str {
    match key {
        "envFile" => "env_file",
        "restartPolicy" => "restart",
        "restartMaxRetries" => "restart_max_retries",
        "healthCheckUrl" => "health_check_url",
        other => other,
    }
}

fn normalize_project_field_value_for_toml(key: &str, value: &Value) -> Value {
    if key == "services" {
        return normalize_services_for_toml(value);
    }
    value.clone()
}

fn normalize_services_for_toml(value: &Value) -> Value {
    let Some(services) = value.as_array() else {
        return value.clone();
    };

    Value::Array(
        services
            .iter()
            .map(|service| {
                let Some(service_obj) = service.as_object() else {
                    return service.clone();
                };
                let mut normalized = serde_json::Map::new();
                for (key, value) in service_obj {
                    let toml_key = match key.as_str() {
                        "buildCommand" => "build_command",
                        "runCommand" => "run_command",
                        other => other,
                    };
                    normalized.insert(toml_key.to_string(), value.clone());
                }
                Value::Object(normalized)
            })
            .collect(),
    )
}

fn remove_project_key_aliases(tbl: &mut toml::map::Map<String, toml::Value>, toml_key: &str) {
    let aliases: &[&str] = match toml_key {
        "env_file" => &["envFile"],
        "restart" => &["restartPolicy"],
        "restart_max_retries" => &["restartMaxRetries"],
        "health_check_url" => &["healthCheckUrl"],
        _ => &[],
    };
    for alias in aliases {
        tbl.remove(*alias);
    }
}

fn json_to_toml(v: &Value) -> Option<toml::Value> {
    match v {
        Value::Null => None,
        Value::Bool(b) => Some(toml::Value::Boolean(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(toml::Value::Integer(i))
            } else {
                n.as_f64().map(toml::Value::Float)
            }
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

/// Reload workspace state when the caller already owns the workspace write guard.
async fn reload_config_locked(state: &AppState) -> Result<(), ApiError> {
    let config_path = state.config.read().await.config_path.clone();
    let new_cfg: DamHopperConfig = read_config(&config_path).map_err(ApiError::from_app)?;
    state
        .semantic_supervisor
        .invalidate_workspace_with_enabled(new_cfg.server.semantic.enabled)
        .await;
    state.media_tickets.revoke_all();
    state.fs.reinit_sandbox(project_roots_from_config(&new_cfg));
    state
        .host_resource_monitor
        .reconfigure(new_cfg.server.host_resources.clone())
        .await;
    *state.config.write().await = new_cfg;
    Ok(())
}
