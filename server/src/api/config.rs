use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde_json::Value;
use std::path::{Path as FsPath, Path as StdPath};

use crate::config::parser::project_path_for_toml;
use crate::config::schema::DamHopperConfig;
use crate::config::{
    global_config_path, read_config, read_global_config_at, write_global_config_at,
};
use crate::error::AppError;
use crate::state::{project_roots_from_config, AppState};
use crate::utils::atomic_write;
use crate::workspace_target::ProjectTargetRef;

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
    let current = state.config.read().await.clone();
    preserve_and_reject_telemetry_mutation(&mut body, &current)?;
    preserve_and_reject_idle_suspend_mutation(&mut body, &current)?;
    let config_path = current.config_path.clone();
    let config_dir = config_path.parent().unwrap_or(StdPath::new("/"));
    relativize_project_paths(&mut body, config_dir);
    normalize_config_json_for_toml(&mut body);
    write_json_as_toml(&config_path, &body)?;
    reload_config(&state).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
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

fn preserve_and_reject_idle_suspend_mutation(
    body: &mut Value,
    current: &DamHopperConfig,
) -> Result<(), ApiError> {
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

    let requested = server
        .remove("idleSuspend")
        .or_else(|| server.remove("idle_suspend"));
    if let Some(requested_val) = requested {
        let requested_cfg: Result<crate::config::IdleSuspendConfig, _> =
            serde_json::from_value(requested_val.clone());
        match requested_cfg {
            Ok(cfg) if cfg == current.server.idle_suspend => {}
            _ => {
                return Err(ApiError::from_app(AppError::InvalidInput(
                    "Terminal idle-suspend timing must be configured via PATCH /api/system/idle-suspend/v1/timing and enablement is startup-owned".to_string(),
                )));
            }
        }
    }

    let mut idle_map = serde_json::Map::new();
    idle_map.insert(
        "enabled".to_string(),
        Value::Bool(current.server.idle_suspend.enabled),
    );
    idle_map.insert(
        "quiet_period_seconds".to_string(),
        Value::Number(serde_json::Number::from(
            current.server.idle_suspend.quiet_period_seconds,
        )),
    );
    idle_map.insert(
        "wake_after_seconds".to_string(),
        Value::Number(serde_json::Number::from(
            current.server.idle_suspend.wake_after_seconds,
        )),
    );
    if let Some(enrollment) = &current.server.idle_suspend.enrollment_reference {
        idle_map.insert(
            "enrollment_reference".to_string(),
            Value::String(enrollment.clone()),
        );
    }
    if current.server.idle_suspend.capability_selection != Default::default() {
        idle_map.insert(
            "capability_selection".to_string(),
            Value::String(
                current
                    .server
                    .idle_suspend
                    .capability_selection
                    .as_str()
                    .to_string(),
            ),
        );
    }
    if current.server.idle_suspend.automatic_policy != Default::default() {
        idle_map.insert(
            "automatic_policy".to_string(),
            Value::String(
                current
                    .server
                    .idle_suspend
                    .automatic_policy
                    .as_str()
                    .to_string(),
            ),
        );
    }
    if current.server.idle_suspend.agent_executables
        != crate::config::default_idle_suspend_agent_executables()
    {
        let execs: Vec<Value> = current
            .server
            .idle_suspend
            .agent_executables
            .iter()
            .cloned()
            .map(Value::String)
            .collect();
        idle_map.insert("agent_executables".to_string(), Value::Array(execs));
    }
    server.insert("idle_suspend".to_string(), Value::Object(idle_map));
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
    let mut incoming = incoming.clone();
    crate::config::schema::migrate_terminal_agent_notifications(&mut incoming);
    if let (Some(base_policy), Some(patch_policy)) = (
        merged.pointer_mut("/terminalAgentNotifications"),
        incoming.pointer("/terminalAgentNotifications"),
    ) {
        if patch_policy.is_object() {
            for (key, value) in patch_policy.as_object().unwrap() {
                if key != "agents" {
                    base_policy[key] = value.clone();
                }
            }
            if let (Some(base_agents), Some(patch_agents)) =
                (base_policy.get_mut("agents"), patch_policy.get("agents"))
            {
                for (agent, policy) in patch_agents.as_object().into_iter().flat_map(|a| a.iter()) {
                    if let Some(base) = base_agents.get_mut(agent) {
                        merge_json_objects(base, policy);
                    } else {
                        base_agents
                            .as_object_mut()
                            .unwrap()
                            .insert(agent.clone(), policy.clone());
                    }
                }
            } else if let Some(agents) = patch_policy.get("agents") {
                base_policy["agents"] = agents.clone();
            }
            incoming
                .as_object_mut()
                .unwrap()
                .remove("terminalAgentNotifications");
        }
    }
    merge_json_objects(&mut merged, &incoming);
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
    new_ui
        .validate_host_resource_pinned_mount()
        .map_err(AppError::InvalidInput)?;
    Ok(new_ui)
}

pub(crate) async fn update_global_ui_at_path(
    state: &AppState,
    gc_path: &FsPath,
    incoming_ui: Option<&Value>,
) -> Result<(), AppError> {
    let mut gc = read_global_config_at(gc_path)?.unwrap_or_default();

    if let Some(ui_val) = incoming_ui {
        gc.ui = Some(merge_global_ui_config(gc.ui.clone(), ui_val)?);
    }

    // Validate path configurations and notification enablement policies before persisting
    if let Some(ui) = gc.ui.as_ref() {
        let home = crate::api::agent_status::resolve_effective_home()
            .unwrap_or_else(|| std::path::PathBuf::from("/"));

        // Validate agentSettingsPaths if provided
        if let Some(paths) = ui.agent_settings_paths.as_ref() {
            if let Some(omp_dir) = paths.omp_agent_dir.as_deref().filter(|s| !s.trim().is_empty()) {
                crate::api::agent_status::expand_and_validate_path(omp_dir, Some(&home))
                    .map_err(|e| AppError::Config(format!("Invalid OMP agent directory: {e}")))?;
            }
            if let Some(codex_dir) = paths.codex_dir.as_deref().filter(|s| !s.trim().is_empty()) {
                crate::api::agent_status::expand_and_validate_path(codex_dir, Some(&home))
                    .map_err(|e| AppError::Config(format!("Invalid Codex directory: {e}")))?;
            }
            if let Some(claude_dir) = paths.claude_dir.as_deref().filter(|s| !s.trim().is_empty()) {
                crate::api::agent_status::expand_and_validate_path(claude_dir, Some(&home))
                    .map_err(|e| AppError::Config(format!("Invalid Claude directory: {e}")))?;
            }
        }

        if ui.terminal_agent_notifications.agents.codex.enabled {
            return Err(AppError::Config(
                "Cannot enable Codex notifications: Codex provides status only in this rollout"
                    .to_string(),
            ));
        }

        if ui.terminal_agent_notifications.agents.omp.enabled {
            let configured_omp_dir = ui
                .agent_settings_paths
                .as_ref()
                .and_then(|p| p.omp_agent_dir.as_deref());
            let omp_notification_dir = std::env::var("PI_CODING_AGENT_DIR")
                .ok()
                .map(std::path::PathBuf::from)
                .filter(|p| p.is_absolute())
                .unwrap_or_else(|| home.join(".omp").join("agent"));

            let omp_install_dir = match configured_omp_dir.filter(|s| !s.trim().is_empty()) {
                Some(explicit) => {
                    crate::api::agent_status::expand_and_validate_path(explicit, Some(&home))
                        .map_err(|e| {
                            AppError::Config(format!("Invalid OMP agent directory: {e}"))
                        })?
                }
                None => omp_notification_dir.clone(),
            };

            if omp_install_dir != omp_notification_dir {
                return Err(AppError::Config(format!(
                    "Cannot enable OMP notifications: configured install path ({}) does not match notification runtime path ({})",
                    omp_install_dir.display(),
                    omp_notification_dir.display()
                )));
            }

            let status = crate::agent_status::check_extension_status(&omp_install_dir)
                .map(|r| r.status)
                .unwrap_or(crate::agent_status::ManagedExtensionStatus::Absent);
            if status != crate::agent_status::ManagedExtensionStatus::Current {
                return Err(AppError::Config(format!(
                    "Cannot enable OMP notifications: extension is not installed at {} (status: {})",
                    omp_install_dir.display(),
                    status
                )));
            }
        }

        if ui.terminal_agent_notifications.agents.claude.enabled {
            let configured_claude_dir = ui
                .agent_settings_paths
                .as_ref()
                .and_then(|p| p.claude_dir.as_deref());
            let claude_notification_dir = std::env::var("CLAUDE_CONFIG_DIR")
                .ok()
                .map(std::path::PathBuf::from)
                .filter(|p| p.is_absolute())
                .unwrap_or_else(|| home.join(".claude"));

            let claude_dir = match configured_claude_dir.filter(|s| !s.trim().is_empty()) {
                Some(explicit) => {
                    crate::api::agent_status::expand_and_validate_path(explicit, Some(&home))
                        .map_err(|e| {
                            AppError::Config(format!("Invalid Claude directory: {e}"))
                        })?
                }
                None => claude_notification_dir.clone(),
            };

            if claude_dir != claude_notification_dir {
                return Err(AppError::Config(format!(
                    "Cannot enable Claude notifications: configured path ({}) does not match notification runtime path ({})",
                    claude_dir.display(),
                    claude_notification_dir.display()
                )));
            }

            let report = crate::agent_status::check_native_integration_status(
                crate::agent_status::AgentKind::Claude,
                &claude_dir,
            )
            .map_err(|e| AppError::Config(format!("Failed to verify Claude integration: {e}")))?;

            if report.readiness != crate::agent_status::ManagedReadinessStatus::Ready {
                return Err(AppError::Config(format!(
                    "Cannot enable Claude notifications: native hook installation is not ready ({})",
                    report.readiness
                )));
            }
        }
    }

    write_global_config_at(gc_path, &gc)?;
    *state.global_config.write().await = gc;
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatusQuery {
    pub worktree_path: Option<String>,
}

pub async fn get_project_status(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(query): Query<ProjectStatusQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let target = state
        .resolve_project_target(&ProjectTargetRef {
            project: name.clone(),
            worktree_path: query.worktree_path,
        })
        .await
        .map_err(ApiError::from_app)?;

    let status = crate::git::get_status(target.target_path(), &name)
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

pub(crate) async fn reload_config(state: &AppState) -> Result<(), ApiError> {
    let _workspace_context = state.workspace_context_guard.write().await;
    reload_config_locked(state).await
}

pub(crate) async fn reload_config_locked(state: &AppState) -> Result<(), ApiError> {
    let config_path = state.config.read().await.config_path.clone();
    let mut new_cfg: DamHopperConfig = read_config(&config_path).map_err(ApiError::from_app)?;
    {
        let timing = state.idle_suspend_timing.read().await;
        state
            .idle_suspend_policy
            .apply_to_config(&mut new_cfg, &timing);
    }
    state.media_tickets.revoke_all();
    state.fs.reinit_sandbox(project_roots_from_config(&new_cfg));
    state.workspace_target_resolver.invalidate_all().await;
    state
        .host_resource_monitor
        .reconfigure(new_cfg.server.host_resources.clone())
        .await;
    *state.config.write().await = new_cfg;
    Ok(())
}
