use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::utils::atomic_write;
use serde::de::Error as _;
use serde_json::Value;

use super::schema::{GlobalConfig, KnownWorkspace};

pub fn dam_hopper_config_dir() -> PathBuf {
    let xdg_home = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
        .unwrap_or_else(|| PathBuf::from("~/.config"));

    xdg_home.join("dam-hopper")
}

pub fn global_config_path() -> PathBuf {
    dam_hopper_config_dir().join("config.toml")
}
pub fn global_env_path() -> PathBuf {
    dam_hopper_config_dir().join(".env")
}

// ──────────────────────────────────────────────
// Core I/O — path-explicit (also used by tests)
// ──────────────────────────────────────────────

/// Read global config from an explicit path.
/// Returns `Ok(None)` for missing or unparseable files (matches Node.js behavior:
/// parse errors are warned and ignored rather than propagated).
pub fn read_global_config_at(path: &Path) -> Result<Option<GlobalConfig>, AppError> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(AppError::Config(format!(
                "Cannot read global config {}: {}",
                path.display(),
                e
            )));
        }
    };

    let parsed = toml::from_str::<toml::Value>(&content);
    if parsed.as_ref().is_ok_and(|value| {
        value
            .get("ui")
            .and_then(|ui| {
                ui.get("terminal_agent_notifications")
                    .or_else(|| ui.get("terminalAgentNotifications"))
            })
            .and_then(|canonical| canonical.get("version"))
            .is_some_and(|version| {
                let v = version.as_integer();
                v != Some(1) && v != Some(2)
            })
    }) {
        return Err(AppError::Config(
            "Unsupported terminal agent notifications version".to_string(),
        ));
    }
    let parsed = parsed.and_then(|mut value| {
        normalize_config_toml_value(&mut value);
        if let Some(ui) = value.get_mut("ui") {
            let mut json =
                serde_json::to_value(&*ui).map_err(|e| toml::de::Error::custom(e.to_string()))?;
            super::schema::migrate_terminal_agent_notifications(&mut json);
            *ui =
                json_to_toml(&json).ok_or_else(|| toml::de::Error::custom("invalid UI config"))?;
        }
        value.try_into()
    });
    match parsed {
        Ok(cfg) => Ok(Some(cfg)),
        Err(e) => Err(AppError::Config(format!(
            "Failed to parse global config {}: {}",
            path.display(),
            e
        ))),
    }
}

pub fn write_global_config_at(path: &Path, config: &GlobalConfig) -> Result<(), AppError> {
    if config
        .ui
        .as_ref()
        .is_some_and(|ui| ui.terminal_agent_notifications.version != 2)
    {
        return Err(AppError::Config(
            "Unsupported terminal agent notifications version".to_string(),
        ));
    }
    let toml_value = serialize_global_config_for_toml(config)?;
    let mut root_table = if path.exists() {
        let existing = std::fs::read_to_string(path)
            .map_err(|e| AppError::Config(format!("Cannot read config {}: {}", path.display(), e)))?;
        toml::from_str::<toml::Value>(&existing)
            .map_err(|e| AppError::Config(format!("Invalid TOML in {}: {}", path.display(), e)))?
            .as_table()
            .cloned()
            .unwrap_or_default()
    } else {
        toml::map::Map::new()
    };

    if let Some(existing_server) = root_table.get_mut("server").and_then(|t| t.as_table_mut()) {
        normalize_server_toml_table(existing_server);
        if !config.server.session_changes_enabled {
            existing_server.remove("session_changes_enabled");
        }
    }

    if let toml::Value::Table(new_table) = toml_value {
        for (k, v) in new_table {
            if k == "server" {
                if let (Some(existing_sub), Some(new_sub)) = (
                    root_table.get_mut(&k).and_then(|t| t.as_table_mut()),
                    v.as_table(),
                ) {
                    for (sub_k, sub_v) in new_sub {
                        existing_sub.insert(sub_k.clone(), sub_v.clone());
                    }
                    continue;
                }
            }
            root_table.insert(k, v);
        }
    }

    let content = toml::to_string_pretty(&toml::Value::Table(root_table))
        .map_err(|e| AppError::Config(format!("Cannot serialize global config: {}", e)))?;
    atomic_write(path, &content)
}

fn serialize_global_config_for_toml(config: &GlobalConfig) -> Result<toml::Value, AppError> {
    let mut table = toml::map::Map::new();

    if let Some(ws) = &config.workspace {
        let mut ws_table = toml::map::Map::new();
        ws_table.insert("name".to_string(), toml::Value::String(ws.name.clone()));
        ws_table.insert("root".to_string(), toml::Value::String(ws.root.clone()));
        table.insert("workspace".to_string(), toml::Value::Table(ws_table));
    }

    if let Some(workspaces) = &config.workspaces {
        let ws_json = serde_json::to_value(workspaces)
            .map_err(|e| AppError::Config(format!("Failed to serialize workspaces: {e}")))?;
        if let Some(ws_toml) = json_to_toml(&ws_json) {
            table.insert("workspaces".to_string(), ws_toml);
        }
    }

    if let Some(ui) = &config.ui {
        let mut ui_json = serde_json::to_value(ui)
            .map_err(|e| AppError::Config(format!("Failed to serialize ui config: {e}")))?;
        normalize_ui_json_for_toml(&mut ui_json);
        if let Some(ui_toml) = json_to_toml(&ui_json) {
            table.insert("ui".to_string(), ui_toml);
        }
    }

    if config.server != Default::default() {
        let server_toml = crate::config::parser::server_to_toml(&config.server);
        table.insert("server".to_string(), server_toml);
    }

    Ok(toml::Value::Table(table))
}

pub(crate) const KNOWN_SCALAR_SHORTCUT_KEYS: &[&str] = &[
    "search_text_shortcut",
    "search_filename_shortcut",
    "open_terminal_shortcut",
    "terminal_file_panel_shortcut",
    "project_panel_shortcut",
    "reveal_active_file_shortcut",
    "git_panel_shortcut",
    "ports_panel_shortcut",
    "terminal_font_size_increase_shortcut",
    "terminal_font_size_decrease_shortcut",
    "os_palette_shortcut",
    "os_cycle_focus_shortcut",
];

trait ConfigMapValue: Sized {
    fn take_entries(&mut self) -> Option<Vec<(String, Self)>>;
    fn from_entries(entries: Vec<(String, Self)>) -> Self;
    fn as_array_items_mut(&mut self) -> Option<&mut Vec<Self>>;
}

impl ConfigMapValue for Value {
    fn take_entries(&mut self) -> Option<Vec<(String, Self)>> {
        self.as_object_mut()
            .map(|m| std::mem::take(m).into_iter().collect())
    }

    fn from_entries(entries: Vec<(String, Self)>) -> Self {
        let mut map = serde_json::Map::new();
        for (k, v) in entries {
            map.insert(k, v);
        }
        Value::Object(map)
    }

    fn as_array_items_mut(&mut self) -> Option<&mut Vec<Self>> {
        self.as_array_mut()
    }
}

impl ConfigMapValue for toml::Value {
    fn take_entries(&mut self) -> Option<Vec<(String, Self)>> {
        self.as_table_mut()
            .map(|t| std::mem::take(t).into_iter().collect())
    }

    fn from_entries(entries: Vec<(String, Self)>) -> Self {
        let mut map = toml::map::Map::new();
        for (k, v) in entries {
            map.insert(k, v);
        }
        toml::Value::Table(map)
    }

    fn as_array_items_mut(&mut self) -> Option<&mut Vec<Self>> {
        self.as_array_mut()
    }
}

fn normalize_table_keys<V: ConfigMapValue>(
    val: &mut V,
    map_key: fn(&str) -> &str,
    mut transform_child: impl FnMut(&str, &mut V),
) {
    let Some(entries) = val.take_entries() else {
        return;
    };
    let mut converted = Vec::new();
    let mut canonical = Vec::new();
    for (k, mut v) in entries {
        let mapped = map_key(&k).to_string();
        transform_child(&mapped, &mut v);
        if mapped != k {
            converted.push((mapped, v));
        } else {
            canonical.push((mapped, v));
        }
    }
    // Insert camelCase-converted entries first so canonical snake_case keys
    // deterministically win if both existed on disk or in a payload.
    let mut merged = std::collections::BTreeMap::new();
    for (k, v) in converted.into_iter().chain(canonical) {
        merged.insert(k, v);
    }
    *val = V::from_entries(merged.into_iter().collect());
}

fn server_key_to_snake(key: &str) -> &str {
    match key {
        "sessionDbPath" | "session_db_path" => "session_db_path",
        "sessionBufferTtlHours" | "session_buffer_ttl_hours" => "session_buffer_ttl_hours",
        "hostResources" | "host_resources" => "host_resources",
        "workflowEventRetentionDays" | "workflow_event_retention_days" => {
            "workflow_event_retention_days"
        }
        "workflowDeletedNoteRetentionDays" | "workflow_deleted_note_retention_days" => {
            "workflow_deleted_note_retention_days"
        }
        "workflowStaleAfterHours" | "workflow_stale_after_hours" => "workflow_stale_after_hours",
        "idleSuspend" | "idle_suspend" => "idle_suspend",
        "sessionChangesEnabled" | "session_changes_enabled" => "session_changes_enabled",
        "browser" => "browser",
        other => other,
    }
}

fn host_resources_key_to_snake(key: &str) -> &str {
    match key {
        "lightSampleSeconds" | "light_sample_seconds" => "light_sample_seconds",
        "processSampleSeconds" | "process_sample_seconds" => "process_sample_seconds",
        "pssSampleSeconds" | "pss_sample_seconds" => "pss_sample_seconds",
        "jitterMillis" | "jitter_millis" => "jitter_millis",
        "processDeadlineMillis" | "process_deadline_millis" => "process_deadline_millis",
        "snapshotDeadlineMillis" | "snapshot_deadline_millis" => "snapshot_deadline_millis",
        "ringCapacity" | "ring_capacity" => "ring_capacity",
        "maxAlertIncidents" | "max_alert_incidents" => "max_alert_incidents",
        "reclaimableCachePercent" | "reclaimable_cache_percent" => "reclaimable_cache_percent",
        "availableWarningPercent" | "available_warning_percent" => "available_warning_percent",
        "availableCriticalPercent" | "available_critical_percent" => "available_critical_percent",
        "availableOomPercent" | "available_oom_percent" => "available_oom_percent",
        "psiSomePercent" | "psi_some_percent" => "psi_some_percent",
        "psiFullPercent" | "psi_full_percent" => "psi_full_percent",
        other => other,
    }
}

fn idle_suspend_key_to_snake(key: &str) -> &str {
    match key {
        "enabled" => "enabled",
        "quietPeriodSeconds" | "quiet_period_seconds" => "quiet_period_seconds",
        "wakeAfterSeconds" | "wake_after_seconds" => "wake_after_seconds",
        "enrollmentReference" | "enrollment_reference" => "enrollment_reference",
        "capabilitySelection" | "capability_selection" => "capability_selection",
        "automaticPolicy" | "automatic_policy" => "automatic_policy",
        "agentExecutables" | "agent_executables" => "agent_executables",
        other => other,
    }
}

fn browser_key_to_snake(key: &str) -> &str {
    match key {
        "enabled" => "enabled",
        "executablePath" | "executable_path" => "executable_path",
        "profileRoot" | "profile_root" => "profile_root",
        "allowedTargetOrigins" | "allowed_target_origins" => "allowed_target_origins",
        "allowedAssetOrigins" | "allowed_asset_origins" => "allowed_asset_origins",
        "allowedDevOrigins" | "allowed_dev_origins" => "allowed_dev_origins",
        "deniedDestinations" | "denied_destinations" => "denied_destinations",
        "budgets" => "budgets",
        other => other,
    }
}

fn browser_budgets_key_to_snake(key: &str) -> &str {
    match key {
        "maxProcesses" | "max_processes" => "max_processes",
        "maxTargets" | "max_targets" => "max_targets",
        "maxViewers" | "max_viewers" => "max_viewers",
        "maxRawCdpConnections" | "max_raw_cdp_connections" => "max_raw_cdp_connections",
        "memoryCeilingBytes" | "memory_ceiling_bytes" => "memory_ceiling_bytes",
        "jpegQuality" | "jpeg_quality" => "jpeg_quality",
        "maxWidth" | "max_width" => "max_width",
        "maxHeight" | "max_height" => "max_height",
        "frameRateFps" | "frame_rate_fps" => "frame_rate_fps",
        other => other,
    }
}

fn normalize_browser_value<V: ConfigMapValue>(val: &mut V) {
    normalize_table_keys(val, browser_key_to_snake, |key, child| {
        if key == "budgets" {
            normalize_table_keys(child, browser_budgets_key_to_snake, |_, _| {});
        }
    });
}

fn normalize_server_value<V: ConfigMapValue>(val: &mut V) {
    normalize_table_keys(val, server_key_to_snake, |key, child| match key {
        "host_resources" => normalize_table_keys(child, host_resources_key_to_snake, |_, _| {}),
        "idle_suspend" => normalize_table_keys(child, idle_suspend_key_to_snake, |_, _| {}),
        "browser" => normalize_browser_value(child),
        _ => {}
    });
}

pub(crate) fn normalize_server_json_for_toml(value: &mut Value) {
    normalize_server_value(value);
}

pub(crate) fn normalize_server_toml_table(table: &mut toml::map::Map<String, toml::Value>) {
    let mut wrapped = toml::Value::Table(std::mem::take(table));
    normalize_server_value(&mut wrapped);
    if let toml::Value::Table(normalized) = wrapped {
        *table = normalized;
    }
}

pub(crate) fn project_key_to_snake(key: &str) -> &str {
    match key {
        "envFile" | "env_file" => "env_file",
        "restartPolicy" | "restart" => "restart",
        "restartMaxRetries" | "restart_max_retries" => "restart_max_retries",
        "healthCheckUrl" | "health_check_url" => "health_check_url",
        other => other,
    }
}

fn service_key_to_snake(key: &str) -> &str {
    match key {
        "buildCommand" | "build_command" => "build_command",
        "runCommand" | "run_command" => "run_command",
        other => other,
    }
}

fn normalize_services_value<V: ConfigMapValue>(val: &mut V) {
    if let Some(items) = val.as_array_items_mut() {
        for service in items {
            normalize_table_keys(service, service_key_to_snake, |_, _| {});
        }
    }
}

fn normalize_project_value<V: ConfigMapValue>(val: &mut V) {
    normalize_table_keys(val, project_key_to_snake, |key, child| {
        if key == "services" {
            normalize_services_value(child);
        }
    });
}

pub(crate) fn normalize_project_json_for_toml(value: &mut Value) {
    normalize_project_value(value);
}

pub(crate) fn normalize_services_json_for_toml(value: &mut Value) {
    normalize_services_value(value);
}

pub(crate) fn normalize_config_toml_value(value: &mut toml::Value) {
    let Some(root) = value.as_table_mut() else {
        return;
    };
    if let Some(server) = root.get_mut("server").and_then(|v| v.as_table_mut()) {
        normalize_server_toml_table(server);
    }
    if let Some(browser) = root.get_mut("browser") {
        normalize_browser_value(browser);
    }
    if let Some(projects) = root.get_mut("projects").and_then(|v| v.as_array_mut()) {
        for project in projects {
            normalize_project_value(project);
        }
    }
    if let Some(ui) = root.get_mut("ui") {
        normalize_table_keys(ui, ui_key_to_snake, |key, child| {
            if key == "agent_settings_paths" {
                normalize_table_keys(child, agent_settings_paths_key_to_snake, |_, _| {});
            }
        });
    }
}

fn agent_settings_paths_key_to_snake(key: &str) -> &str {
    match key {
        "ompAgentDir" | "omp_agent_dir" => "omp_agent_dir",
        "codexDir" | "codex_dir" => "codex_dir",
        "claudeDir" | "claude_dir" => "claude_dir",
        other => other,
    }
}

fn ui_key_to_snake(key: &str) -> &str {
    match key {
        "systemFontSize" | "system_font_size" => "system_font_size",
        "editorFontSize" | "editor_font_size" => "editor_font_size",
        "terminalFontSize" | "terminal_font_size" => "terminal_font_size",
        "editorZoomWheelEnabled" | "editor_zoom_wheel_enabled" => "editor_zoom_wheel_enabled",
        "searchTextShortcut" | "search_text_shortcut" => "search_text_shortcut",
        "searchFilenameShortcut" | "search_filename_shortcut" => "search_filename_shortcut",
        "openTerminalShortcut" | "open_terminal_shortcut" => "open_terminal_shortcut",
        "terminalFilePanelShortcut" | "terminal_file_panel_shortcut" => {
            "terminal_file_panel_shortcut"
        }
        "projectPanelShortcut" | "project_panel_shortcut" => "project_panel_shortcut",
        "revealActiveFileShortcut" | "reveal_active_file_shortcut" => "reveal_active_file_shortcut",
        "gitPanelShortcut" | "git_panel_shortcut" => "git_panel_shortcut",
        "portsPanelShortcut" | "ports_panel_shortcut" => "ports_panel_shortcut",
        "terminalFontSizeIncreaseShortcut" | "terminal_font_size_increase_shortcut" => {
            "terminal_font_size_increase_shortcut"
        }
        "terminalFontSizeDecreaseShortcut" | "terminal_font_size_decrease_shortcut" => {
            "terminal_font_size_decrease_shortcut"
        }
        "hostResourcePinnedMount" | "host_resource_pinned_mount" => "host_resource_pinned_mount",
        "terminalSuggestionsEnabled" | "terminal_suggestions_enabled" => {
            "terminal_suggestions_enabled"
        }
        "terminalAutoSwitchProjectEnabled" | "terminal_auto_switch_project_enabled" => {
            "terminal_auto_switch_project_enabled"
        }
        "terminalAgentNotifications" | "terminal_agent_notifications" => {
            "terminal_agent_notifications"
        }
        "agentSettingsPaths" | "agent_settings_paths" => "agent_settings_paths",
        "explorerShowHidden" | "explorer_show_hidden" => "explorer_show_hidden",
        "explorerLanguageFilter" | "explorer_language_filter" => "explorer_language_filter",
        "mobileCustomKeyboardEnabled" | "mobile_custom_keyboard_enabled" => {
            "mobile_custom_keyboard_enabled"
        }
        "mobileCustomKeyboardFontSize" | "mobile_custom_keyboard_font_size" => {
            "mobile_custom_keyboard_font_size"
        }
        "mobileCustomKeyboardPadding" | "mobile_custom_keyboard_padding" => {
            "mobile_custom_keyboard_padding"
        }
        "mobileCustomKeyboardRowGap" | "mobile_custom_keyboard_row_gap" => {
            "mobile_custom_keyboard_row_gap"
        }
        "terminalOrder" | "terminal_order" => "terminal_order",
        "projectOrder" | "project_order" => "project_order",
        "projectCommandOrder" | "project_command_order" => "project_command_order",
        "runtimeGroupOrder" | "runtime_group_order" => "runtime_group_order",
        "runtimeItemOrder" | "runtime_item_order" => "runtime_item_order",
        "terminalScrollButtonsEnabled" | "terminal_scroll_buttons_enabled" => {
            "terminal_scroll_buttons_enabled"
        }
        "terminalCommitStatusEnabled" | "terminal_commit_status_enabled" => {
            "terminal_commit_status_enabled"
        }
        "terminalScrollStep" | "terminal_scroll_step" => "terminal_scroll_step",
        "cognitoModeShortcut" | "cognito_mode_shortcut" => "cognito_mode_shortcut",
        "cognitoModeStyle" | "cognito_mode_style" => "cognito_mode_style",
        "defaultWindowPlacement" | "default_window_placement" => "default_window_placement",
        "osPaletteShortcut" | "os_palette_shortcut" => "os_palette_shortcut",
        "osCycleFocusShortcut" | "os_cycle_focus_shortcut" => "os_cycle_focus_shortcut",
        "dockPadding" | "dock_padding" => "dock_padding",
        "dockItemSpacing" | "dock_item_spacing" => "dock_item_spacing",
        "dockOuterSpacing" | "dock_outer_spacing" => "dock_outer_spacing",
        "dockRadius" | "dock_radius" => "dock_radius",
        "dockPosition" | "dock_position" => "dock_position",
        "cursorTheme" | "cursor_theme" => "cursor_theme",
        "appShortcuts" | "app_shortcuts" => "app_shortcuts",
        other => other,
    }
}

pub(crate) fn normalize_ui_json_keys(value: &mut Value) {
    normalize_table_keys(value, ui_key_to_snake, |key, child| {
        if key == "agent_settings_paths" {
            normalize_table_keys(child, agent_settings_paths_key_to_snake, |_, _| {});
        }
    });
}

pub(crate) fn normalize_ui_json_for_toml(value: &mut Value) {
    normalize_ui_json_keys(value);
    let Some(ui) = value.as_object_mut() else {
        return;
    };

    for retired in [
        "fleetTerminalShortcut",
        "fleet_terminal_shortcut",
        "terminalWorkspaceShortcut",
        "terminal_workspace_shortcut",
    ] {
        ui.remove(retired);
    }

    // Known shortcut paths only: encode explicit unbound as TOML "" before generic null dropping
    for (toml_key, val) in ui.iter_mut() {
        if KNOWN_SCALAR_SHORTCUT_KEYS.contains(&toml_key.as_str()) && val.is_null() {
            *val = Value::String("".to_string());
        } else if toml_key == "app_shortcuts" {
            if let Value::Object(inner) = val {
                for shortcut_val in inner.values_mut() {
                    if shortcut_val.is_null() {
                        *shortcut_val = Value::String("".to_string());
                    }
                }
            }
        }
    }
}

pub(crate) fn json_to_toml(v: &Value) -> Option<toml::Value> {
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

// ──────────────────────────────────────────────
// Public API — resolves XDG path automatically
// ──────────────────────────────────────────────

pub fn read_global_config() -> Result<Option<GlobalConfig>, AppError> {
    read_global_config_at(&global_config_path())
}

pub fn write_global_config(config: &GlobalConfig) -> Result<(), AppError> {
    write_global_config_at(&global_config_path(), config)
}

pub fn list_known_workspaces() -> Result<Vec<KnownWorkspace>, AppError> {
    Ok(read_global_config()?
        .unwrap_or_default()
        .workspaces
        .unwrap_or_default())
}

pub fn list_known_workspaces_at(path: &Path) -> Result<Vec<KnownWorkspace>, AppError> {
    Ok(read_global_config_at(path)?
        .unwrap_or_default()
        .workspaces
        .unwrap_or_default())
}

pub fn add_known_workspace(name: &str, workspace_path: &str) -> Result<(), AppError> {
    add_known_workspace_at(&global_config_path(), name, workspace_path)
}

pub fn add_known_workspace_at(
    config_path: &Path,
    name: &str,
    workspace_path: &str,
) -> Result<(), AppError> {
    let mut cfg = read_global_config_at(config_path)?.unwrap_or_default();
    let workspaces = cfg.workspaces.get_or_insert_with(Vec::new);

    if let Some(existing) = workspaces.iter_mut().find(|w| w.path == workspace_path) {
        if existing.name == name {
            return Ok(());
        }
        existing.name = name.to_string();
    } else {
        workspaces.push(KnownWorkspace {
            name: name.to_string(),
            path: workspace_path.to_string(),
        });
    }

    write_global_config_at(config_path, &cfg)
}

pub fn remove_known_workspace(workspace_path: &str) -> Result<(), AppError> {
    remove_known_workspace_at(&global_config_path(), workspace_path)
}

pub fn remove_known_workspace_at(config_path: &Path, workspace_path: &str) -> Result<(), AppError> {
    let mut cfg = match read_global_config_at(config_path)? {
        Some(c) => c,
        None => return Ok(()),
    };

    let workspaces = cfg.workspaces.get_or_insert_with(Vec::new);
    let before = workspaces.len();
    workspaces.retain(|w| w.path != workspace_path);
    if workspaces.len() == before {
        return Ok(());
    }

    write_global_config_at(config_path, &cfg)
}
