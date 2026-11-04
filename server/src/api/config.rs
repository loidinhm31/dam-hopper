use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use crate::pty::event_sink::EventSink;
use serde_json::Value;
use std::path::{Path as FsPath, Path as StdPath, PathBuf};

use crate::config::parser::project_path_for_toml;
use crate::config::schema::DamHopperConfig;
use crate::config::{
    read_config, read_global_config_at, write_global_config_at,
};
use crate::error::AppError;
use crate::state::{project_roots_from_config, AppState};
use crate::utils::atomic_write;
use crate::workspace_target::{FilesystemTargetRef, ProjectTargetRef};

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
    let _workspace_context = state.workspace_context_guard.write().await;
    let current = state.config.read().await.clone();
    preserve_and_reject_idle_suspend_mutation(&mut body, &current)?;
    let config_path = current.config_path.clone();
    let ws_root = current.resolve_workspace_root().ok();
    let config_dir = config_path.parent().unwrap_or(StdPath::new("/"));
    let project_base_dir = ws_root.as_deref().unwrap_or(config_dir);
    relativize_project_paths(&mut body, project_base_dir);
    normalize_config_json_for_toml(&mut body);

    // Read existing TOML to preserve unrepresented sections
    let mut doc = read_toml_value(&config_path)?;
    let tv = json_to_toml(&body).ok_or_else(|| {
        ApiError::from_app(AppError::InvalidInput("Cannot convert JSON to TOML".into()))
    })?;
    if let (Some(doc_table), Some(new_table)) = (doc.as_table_mut(), tv.as_table()) {
        for key in ["workspace", "server", "projects", "features", "agent_store"] {
            if let Some(val) = new_table.get(key) {
                doc_table.insert(key.to_string(), val.clone());
            }
        }
    } else {
        doc = tv;
    }
    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    let candidate = crate::config::parse_config_str_at_path(&toml_str, &config_path)
        .map_err(ApiError::from_app)?;

    let target_agent_dir = resolve_configured_omp_agent_dir(&state).await;

    let newly_installed_for_enable = if candidate.server.session_changes_enabled
        && !current.server.session_changes_enabled
    {
        let dir = target_agent_dir.as_ref().map_err(|e| {
            ApiError::from_app(crate::error::AppError::Config(format!(
                "Cannot resolve OMP agent directory to enable session changes: {e}"
            )))
        })?;
        let pre_status = crate::agent_status::check_session_changes_extension_status(dir)
            .map_err(|e| ApiError::from_app(crate::error::AppError::Config(e.to_string())))?;
        let was_absent = pre_status.status == crate::agent_status::ManagedExtensionStatus::Absent;
        crate::agent_status::install_session_changes_extension(dir)
            .map_err(|e| {
                ApiError::from_app(crate::error::AppError::Config(format!(
                    "Failed to install managed session changes extension: {e}"
                )))
            })?;
        was_absent
    } else {
        false
    };

    if !candidate.server.session_changes_enabled && current.server.session_changes_enabled {
        state.session_changes.disable_and_purge();
        if let Ok(dir) = &target_agent_dir {
            let _ = crate::agent_status::uninstall_session_changes_extension(dir);
        }
    }

    if let Err(write_err) = atomic_write(&config_path, &toml_str).map_err(ApiError::from_app) {
        if newly_installed_for_enable {
            if let Ok(dir) = &target_agent_dir {
                let _ = crate::agent_status::uninstall_session_changes_extension(dir);
            }
        }
        return Err(write_err);
    }
    reload_config_locked(&state).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkProjectRequest {
    pub name: String,
    pub target: FilesystemTargetRef,
    pub path: String,
    #[serde(default)]
    pub project_type: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// POST /api/config/projects — mark folder as project
// ---------------------------------------------------------------------------

pub async fn mark_project(
    State(state): State<AppState>,
    Json(body): Json<MarkProjectRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "INVALID_NAME",
            "Project name cannot be empty",
        ));
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "INVALID_NAME",
            "Project name contains invalid characters",
        ));
    }

    // Resolve target and path
    let resolved = state
        .resolve_filesystem_target(&body.target)
        .await
        .map_err(ApiError::from)?;
    if !resolved.available() {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "TARGET_UNAVAILABLE",
            "Filesystem target is unavailable",
        ));
    }

    let root_path = resolved.root_path().to_path_buf();
    let rel_path = body.path.trim_start_matches('/');
    let target_folder = if rel_path.is_empty() || rel_path == "." {
        root_path.clone()
    } else {
        root_path.join(rel_path)
    };

    if target_folder
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "PATH_ESCAPE",
            "Project path cannot escape target root",
        ));
    }

    let canonical_folder = dunce::canonicalize(&target_folder).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ApiError::custom(StatusCode::NOT_FOUND, "NOT_FOUND", format!("Folder not found: {}", target_folder.display()))
        } else {
            ApiError::from_app(AppError::Io(e))
        }
    })?;

    if !canonical_folder.is_dir() {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "NOT_A_DIRECTORY",
            format!("Path is not a directory: {}", canonical_folder.display()),
        ));
    }

    let canonical_root = dunce::canonicalize(&root_path).unwrap_or(root_path.clone());
    if !crate::workspace_target::target_path_is_within(&canonical_folder, &canonical_root) {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "PATH_ESCAPE",
            "Project folder resolves outside target root",
        ));
    }

    let _workspace_context = state.workspace_context_guard.write().await;
    let cfg_guard = state.config.read().await;
    let config_path = cfg_guard.config_path.clone();
    let ws_root = cfg_guard.resolve_workspace_root().ok();
    let config_dir = config_path.parent().unwrap_or_else(|| std::path::Path::new("/"));
    let project_base_dir = ws_root.as_deref().unwrap_or(config_dir);
    drop(cfg_guard);
    // Reread latest disk state
    let mut doc = read_toml_value(&config_path)?;
    if let Some(table) = doc.as_table_mut() {
        if !table.contains_key("projects") {
            table.insert("projects".to_string(), toml::Value::Array(Vec::new()));
        }
    }
    let projects = doc
        .get_mut("projects")
        .and_then(|p| p.as_array_mut())
        .ok_or_else(|| {
            ApiError::from_app(AppError::Config("projects in config is not an array".into()))
        })?;

    // Check duplicate project name
    if projects
        .iter()
        .any(|p| p.get("name").and_then(|n| n.as_str()) == Some(name))
    {
        return Err(ApiError::custom(
            StatusCode::CONFLICT,
            "DUPLICATE_PROJECT_NAME",
            format!("Project name already exists: {name}"),
        ));
    }

    // Check duplicate canonical root (distinct nested roots allowed)
    for p in projects.iter() {
        if let Some(path_str) = p.get("path").and_then(|pt| pt.as_str()) {
            let existing_path = if std::path::Path::new(path_str).is_absolute() {
                PathBuf::from(path_str)
            } else {
                project_base_dir.join(path_str)
            };
            if let Ok(existing_canonical) = dunce::canonicalize(&existing_path) {
                if existing_canonical == canonical_folder {
                    return Err(ApiError::custom(
                        StatusCode::CONFLICT,
                        "DUPLICATE_PROJECT_ROOT",
                        "A project with this root path already exists",
                    ));
                }
            }
        }
    }

    // Determine project_type
    let project_type = if let Some(pt_str) = body.project_type.as_deref() {
        match pt_str.to_lowercase().as_str() {
            "maven" => "maven",
            "gradle" => "gradle",
            "npm" => "npm",
            "pnpm" => "pnpm",
            "cargo" => "cargo",
            "custom" => "custom",
            other => {
                return Err(ApiError::custom(
                    StatusCode::BAD_REQUEST,
                    "INVALID_PROJECT_TYPE",
                    format!("Unsupported projectType: {other}"),
                ));
            }
        }
        .to_string()
    } else {
        crate::config::discovery::detect_project_type(&canonical_folder)
            .map(|t| t.to_string())
            .unwrap_or_else(|| "custom".to_string())
    };

    let toml_path = project_path_for_toml(&canonical_folder, project_base_dir);

    let mut new_proj_table = toml::map::Map::new();
    new_proj_table.insert("name".to_string(), toml::Value::String(name.to_string()));
    new_proj_table.insert("path".to_string(), toml::Value::String(toml_path));
    new_proj_table.insert("type".to_string(), toml::Value::String(project_type));
    if let Some(tags) = body.tags {
        let tag_values: Vec<toml::Value> = tags.into_iter().map(toml::Value::String).collect();
        new_proj_table.insert("tags".to_string(), toml::Value::Array(tag_values));
    }

    projects.push(toml::Value::Table(new_proj_table));

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    let candidate = crate::config::parse_config_str_at_path(&toml_str, &config_path)
        .map_err(ApiError::from_app)?;

    atomic_write(&config_path, &toml_str).map_err(ApiError::from_app)?;
    reconcile_and_publish_config_locked(&state, candidate).await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "name": name,
    })))
}

// ---------------------------------------------------------------------------
// DELETE /api/config/projects/:name — unmark project
// ---------------------------------------------------------------------------

pub async fn unmark_project(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let _workspace_context = state.workspace_context_guard.write().await;
    let config_path = state.config.read().await.config_path.clone();

    let mut doc = read_toml_value(&config_path)?;
    let projects = match doc.get_mut("projects").and_then(|p| p.as_array_mut()) {
        Some(p) => p,
        None => {
            return Err(ApiError::custom(
                StatusCode::NOT_FOUND,
                "UNKNOWN_PROJECT",
                format!("Project not found: {name}"),
            ));
        }
    };

    let index = projects
        .iter()
        .position(|p| p.get("name").and_then(|n| n.as_str()) == Some(&name))
        .ok_or_else(|| {
            ApiError::custom(
                StatusCode::NOT_FOUND,
                "UNKNOWN_PROJECT",
                format!("Project not found: {name}"),
            )
        })?;

    projects.remove(index);

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    let candidate = crate::config::parse_config_str_at_path(&toml_str, &config_path)
        .map_err(ApiError::from_app)?;

    atomic_write(&config_path, &toml_str).map_err(ApiError::from_app)?;
    reconcile_and_publish_config_locked(&state, candidate).await?;

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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGlobalWorkspaceRequest {
    pub root: String,
    pub name: Option<String>,
}

pub async fn update_global_workspace(
    State(state): State<AppState>,
    Json(body): Json<UpdateGlobalWorkspaceRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let root_str = body.root.trim();
    if root_str.is_empty() {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "INVALID_ROOT",
            "Workspace root cannot be empty",
        ));
    }
    let candidate_path = PathBuf::from(root_str);
    let canonical = dunce::canonicalize(&candidate_path).map_err(|e| {
        ApiError::custom(
            StatusCode::BAD_REQUEST,
            "NOT_FOUND",
            format!("Workspace root does not exist: {e}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(ApiError::custom(
            StatusCode::BAD_REQUEST,
            "NOT_A_DIRECTORY",
            "Workspace root is not a directory",
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
        ApiError::from_app(AppError::Config("Expected TOML table at root".into()))
    })?;
    let ws_table = root_table
        .entry("workspace")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| {
            ApiError::from_app(AppError::Config("[workspace] must be a table".into()))
        })?;

    ws_table.insert(
        "root".to_string(),
        toml::Value::String(canonical.to_string_lossy().into_owned()),
    );
    if let Some(name) = body.name.filter(|n| !n.trim().is_empty()) {
        ws_table.insert("name".to_string(), toml::Value::String(name));
    }

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| ApiError::from_app(AppError::Internal(e.to_string())))?;
    let candidate = crate::config::parse_config_str_at_path(&toml_str, &config_path)
        .map_err(ApiError::from_app)?;

    atomic_write(&config_path, &toml_str).map_err(ApiError::from_app)?;

    let _ = state.pty_manager.dispose();
    state.media_tickets.revoke_all();
    state.fs.reinit_workspace_sandbox(Some(canonical.clone()));
    state.fs.bump_workspace_epoch();
    state.fs.reinit_sandbox(project_roots_from_config(&candidate));
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
// POST /api/global-config/ui  { ui: UiConfig fields }
// ---------------------------------------------------------------------------

pub async fn update_global_ui(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let _workspace_context = state.workspace_context_guard.write().await;
    let gc_path = state.config_path().await;
    let ui_value = body.get("ui").unwrap_or(&body);
    update_global_ui_at_path(&state, &gc_path, Some(ui_value))
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
    new_ui
        .validate_window_placement()
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
                let validated = crate::api::agent_status::expand_and_validate_path(omp_dir, Some(&home))
                    .map_err(|e| AppError::Config(format!("Invalid OMP agent directory: {e}")))?;
                if state.session_changes.is_enabled() {
                    let current = resolve_configured_omp_agent_dir(state).await.ok();
                    if let Some(current_p) = current {
                        if current_p != validated {
                            return Err(AppError::Config(
                                "Cannot change OMP agent directory while Session Changes is enabled; disable Session Changes first".to_string()
                            ));
                        }
                    }
                }
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
    *state.global_config.write().await = gc.clone();
    state.config.write().await.ui = gc.ui;
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

pub(crate) fn read_toml_value(path: &std::path::Path) -> Result<toml::Value, ApiError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| ApiError::from_app(AppError::Config(e.to_string())))?;
    toml::from_str(&content).map_err(|e| ApiError::from_app(AppError::Config(e.to_string())))
}


fn patch_project(doc: &mut toml::Value, name: &str, patch: &Value) -> Result<(), ApiError> {
    let projects = match doc.get_mut("projects").and_then(|p| p.as_array_mut()) {
        Some(p) => p,
        None => {
            return Err(ApiError::custom(
                StatusCode::NOT_FOUND,
                "UNKNOWN_PROJECT",
                format!("Project not found: {name}"),
            ));
        }
    };

    let project = projects
        .iter_mut()
        .find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name));

    let proj = project.ok_or_else(|| {
        ApiError::custom(
            StatusCode::NOT_FOUND,
            "UNKNOWN_PROJECT",
            format!("Project not found: {name}"),
        )
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
    if let Some(server) = value.get_mut("server").and_then(Value::as_object_mut) {
        if let Some(sc) = server.remove("sessionChangesEnabled") {
            server.insert("session_changes_enabled".to_string(), sc);
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

pub async fn reload_config_locked(state: &AppState) -> Result<(), ApiError> {
    let config_path = state.config.read().await.config_path.clone();
    let new_cfg: DamHopperConfig = read_config(&config_path).map_err(ApiError::from_app)?;
    reconcile_and_publish_config_locked(state, new_cfg).await
}

pub async fn reconcile_and_publish_config_locked(
    state: &AppState,
    mut new_cfg: DamHopperConfig,
) -> Result<(), ApiError> {
    let current_cfg = state.config.read().await.clone();
    reconcile_session_changes_lifecycle(state, &current_cfg, &new_cfg).await?;

    {
        let timing = state.idle_suspend_timing.read().await;
        state
            .idle_suspend_policy
            .apply_to_config(&mut new_cfg, &timing);
    }
    state.media_tickets.revoke_all();
    let ws_root = new_cfg.resolve_workspace_root().ok();
    state.fs.reinit_workspace_sandbox(ws_root.clone());
    if let Some(r) = &ws_root {
        *state.workspace_dir.write().await = r.clone();
    }
    state.fs.reinit_sandbox(project_roots_from_config(&new_cfg));
    state.workspace_target_resolver.invalidate_all().await;
    state
        .host_resource_monitor
        .reconfigure(new_cfg.server.host_resources.clone())
        .await;
    *state.global_config.write().await = crate::config::schema::GlobalConfig {
        workspace: Some(new_cfg.workspace.clone()),
        workspaces: new_cfg.workspaces.clone(),
        ui: new_cfg.ui.clone(),
        server: new_cfg.server.clone(),
    };
    *state.config.write().await = new_cfg;
    Ok(())
}

pub(crate) async fn reconcile_session_changes_lifecycle(
    state: &AppState,
    _current_cfg: &DamHopperConfig,
    new_cfg: &DamHopperConfig,
) -> Result<(), ApiError> {
    if new_cfg.server.session_changes_enabled {
        let agent_dir = resolve_configured_omp_agent_dir(state).await
            .map_err(|e| ApiError::from_app(crate::error::AppError::Config(
                format!("Failed to resolve OMP agent directory for session changes: {e}")
            )))?;
        match crate::agent_status::install_session_changes_extension(&agent_dir) {
            Ok(_) => {
                state.session_changes.enable();
            }
            Err(e) => {
                state.session_changes.disable_and_purge();
                return Err(ApiError::from_app(crate::error::AppError::Config(
                    format!("Failed to install managed session changes extension: {e}")
                )));
            }
        }
    } else {
        state.session_changes.disable_and_purge();
        if let Ok(agent_dir) = resolve_configured_omp_agent_dir(state).await {
            match crate::agent_status::uninstall_session_changes_extension(&agent_dir) {
                Ok(_) => {}
                Err(crate::agent_status::IntegrationError::RefusingDeleteModified(path)) => {
                    tracing::warn!(
                        "Preserving locally modified session changes extension at '{}' during disable",
                        path.display()
                    );
                }
                Err(e) => {
                    tracing::warn!("Failed to safely uninstall session changes extension: {e}");
                }
            }
        }
    }
    Ok(())
}

pub(crate) async fn resolve_configured_omp_agent_dir(
    state: &AppState,
) -> Result<PathBuf, crate::agent_status::IntegrationError> {
    let global_cfg = state.global_config.read().await;
    let explicit = global_cfg
        .ui
        .as_ref()
        .and_then(|u| u.agent_settings_paths.as_ref())
        .and_then(|p| p.omp_agent_dir.as_deref());
    crate::api::agent_status::resolve_target_agent_dir(explicit)
}

pub async fn startup_reconcile_session_changes(state: &AppState) {
    let cfg = state.config.read().await;
    if cfg.server.session_changes_enabled {
        match resolve_configured_omp_agent_dir(state).await {
            Ok(agent_dir) => {
                match crate::agent_status::install_session_changes_extension(&agent_dir) {
                    Ok(_) => {
                        state.session_changes.enable();
                        tracing::info!("Session changes tracking enabled and managed extension reconciled");
                    }
                    Err(e) => {
                        state.session_changes.disable_and_purge();
                        tracing::error!(
                            "Failed to install session changes extension at startup: {e}"
                        );
                    }
                }
            }
            Err(e) => {
                state.session_changes.disable_and_purge();
                tracing::error!(
                    "Failed to resolve agent directory for session changes at startup: {e}"
                );
            }
        }
    } else {
        state.session_changes.disable_and_purge();
        if let Ok(agent_dir) = resolve_configured_omp_agent_dir(state).await {
            match crate::agent_status::uninstall_session_changes_extension(&agent_dir) {
                Ok(_) => {}
                Err(crate::agent_status::IntegrationError::RefusingDeleteModified(path)) => {
                    tracing::warn!(
                        "Preserving locally modified session changes extension at '{}' during startup",
                        path.display()
                    );
                }
                Err(e) => {
                    tracing::debug!("No session changes extension removed during startup: {e}");
                }
            }
        }
    }
}
