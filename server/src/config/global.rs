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

pub fn global_registry_path() -> PathBuf {
    dam_hopper_config_dir().join("dam-hopper.toml")
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
            tracing::warn!(path = %path.display(), error = %e, "Cannot read global config — ignoring");
            return Ok(None);
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
        Err(e) => {
            // Matches Node.js behavior: corrupted global config is warned and ignored.
            tracing::warn!(path = %path.display(), error = %e, "Failed to parse global config — ignoring");
            Ok(None)
        }
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
    let content = toml::to_string_pretty(&toml_value)
        .map_err(|e| AppError::Config(format!("Cannot serialize global config: {}", e)))?;
    // atomic_write uses 0o600 on Unix (protects workspace paths + future auth tokens)
    atomic_write(path, &content)
}

fn serialize_global_config_for_toml(config: &GlobalConfig) -> Result<toml::Value, AppError> {
    let mut json = serde_json::to_value(config)
        .map_err(|e| AppError::Config(format!("Cannot serialize global config: {}", e)))?;
    normalize_global_config_json_for_toml(&mut json);
    json_to_toml(&json)
        .ok_or_else(|| AppError::Config("Cannot convert global config to TOML".to_string()))
}

fn normalize_global_config_json_for_toml(value: &mut Value) {
    let Some(root) = value.as_object_mut() else {
        return;
    };

    if let Some(ui) = root.get_mut("ui") {
        normalize_ui_json_for_toml(ui);
    }
    if let Some(server) = root.get_mut("server") {
        normalize_server_json_for_toml(server);
    }
}

fn normalize_server_json_for_toml(value: &mut Value) {
    let Some(server) = value.as_object_mut() else {
        return;
    };

    let entries = std::mem::take(server);
    for (key, value) in entries {
        let toml_key = match key.as_str() {
            "sessionDbPath" => "session_db_path",
            "sessionBufferTtlHours" => "session_buffer_ttl_hours",
            other => other,
        };
        let mut value = value;
        if toml_key == "telemetry" {
            normalize_telemetry_json_for_toml(&mut value);
        }
        server.insert(toml_key.to_string(), value);
    }
}

fn normalize_telemetry_json_for_toml(value: &mut Value) {
    let Some(telemetry) = value.as_object_mut() else {
        return;
    };
    let entries = std::mem::take(telemetry);
    for (key, value) in entries {
        let toml_key = match key.as_str() {
            "dbPath" => "db_path",
            "detailRetentionDays" => "detail_retention_days",
            "aggregateRetentionDays" => "aggregate_retention_days",
            other => other,
        };
        telemetry.insert(toml_key.to_string(), value);
    }
}

fn normalize_ui_json_for_toml(value: &mut Value) {
    let Some(ui) = value.as_object_mut() else {
        return;
    };

    let entries = std::mem::take(ui);
    for (key, mut value) in entries {
        let toml_key = match key.as_str() {
            "systemFontSize" => "system_font_size",
            "editorFontSize" => "editor_font_size",
            "terminalFontSize" => "terminal_font_size",
            "editorZoomWheelEnabled" => "editor_zoom_wheel_enabled",
            "searchTextShortcut" => "search_text_shortcut",
            "searchFilenameShortcut" => "search_filename_shortcut",
            "terminalWorkspaceShortcut" => "terminal_workspace_shortcut",
            "terminalFilePanelShortcut" => "terminal_file_panel_shortcut",
            "projectPanelShortcut" => "project_panel_shortcut",
            "revealActiveFileShortcut" => "reveal_active_file_shortcut",
            "gitPanelShortcut" => "git_panel_shortcut",
            "portsPanelShortcut" => "ports_panel_shortcut",
            "fleetTerminalShortcut" => "fleet_terminal_shortcut",
            "terminalFontSizeIncreaseShortcut" => "terminal_font_size_increase_shortcut",
            "terminalFontSizeDecreaseShortcut" => "terminal_font_size_decrease_shortcut",
            "hostResourcePinnedMount" => "host_resource_pinned_mount",
            "terminalSuggestionsEnabled" => "terminal_suggestions_enabled",
            "terminalAutoSwitchProjectEnabled" => "terminal_auto_switch_project_enabled",
            "terminalAgentNotifications" => "terminal_agent_notifications",
            "agentSettingsPaths" | "agent_settings_paths" => {
                if let Value::Object(inner) = &mut value {
                    let inner_entries: Vec<(String, Value)> =
                        inner.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
                    inner.clear();
                    for (ik, iv) in inner_entries {
                        let toml_ik = match ik.as_str() {
                            "ompAgentDir" | "omp_agent_dir" => "omp_agent_dir",
                            "codexDir" | "codex_dir" => "codex_dir",
                            "claudeDir" | "claude_dir" => "claude_dir",
                            other => other,
                        };
                        inner.insert(toml_ik.to_string(), iv);
                    }
                }
                "agent_settings_paths"
            }
            "explorerShowHidden" => "explorer_show_hidden",
            "explorerLanguageFilter" => "explorer_language_filter",
            "mobileCustomKeyboardEnabled" => "mobile_custom_keyboard_enabled",
            "mobileCustomKeyboardFontSize" => "mobile_custom_keyboard_font_size",
            "mobileCustomKeyboardPadding" => "mobile_custom_keyboard_padding",
            "mobileCustomKeyboardRowGap" => "mobile_custom_keyboard_row_gap",
            "terminalOrder" => "terminal_order",
            "projectOrder" => "project_order",
            "projectCommandOrder" => "project_command_order",
            "runtimeGroupOrder" => "runtime_group_order",
            "runtimeItemOrder" => "runtime_item_order",
            "terminalScrollButtonsEnabled" => "terminal_scroll_buttons_enabled",
            "terminalCommitStatusEnabled" => "terminal_commit_status_enabled",
            "terminalScrollStep" => "terminal_scroll_step",
            other => other,
        };
        ui.insert(toml_key.to_string(), value);
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
