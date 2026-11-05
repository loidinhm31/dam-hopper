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

    if let toml::Value::Table(new_table) = toml_value {
        for (k, v) in new_table {
            if k == "server" {
                if let (Some(existing_sub), Some(new_sub)) = (
                    root_table.get_mut(&k).and_then(|t| t.as_table_mut()),
                    v.as_table(),
                ) {
                    existing_sub.remove("idleSuspend");
                    existing_sub.remove("hostResources");
                    existing_sub.remove("sessionChangesEnabled");
                    existing_sub.remove("workflowDeletedNoteRetentionDays");
                    existing_sub.remove("workflowEventRetentionDays");
                    existing_sub.remove("workflowStaleAfterHours");
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
    "terminal_workspace_shortcut",
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

pub(crate) fn normalize_ui_json_for_toml(value: &mut Value) {
    let Some(ui) = value.as_object_mut() else {
        return;
    };

    let entries = std::mem::take(ui);
    for (key, mut value) in entries {
        if key == "fleetTerminalShortcut" || key == "fleet_terminal_shortcut" {
            continue;
        }

        let toml_key = match key.as_str() {
            "systemFontSize" | "system_font_size" => "system_font_size",
            "editorFontSize" | "editor_font_size" => "editor_font_size",
            "terminalFontSize" | "terminal_font_size" => "terminal_font_size",
            "editorZoomWheelEnabled" | "editor_zoom_wheel_enabled" => "editor_zoom_wheel_enabled",
            "searchTextShortcut" | "search_text_shortcut" => "search_text_shortcut",
            "searchFilenameShortcut" | "search_filename_shortcut" => "search_filename_shortcut",
            "terminalWorkspaceShortcut" | "terminal_workspace_shortcut" => "terminal_workspace_shortcut",
            "terminalFilePanelShortcut" | "terminal_file_panel_shortcut" => "terminal_file_panel_shortcut",
            "projectPanelShortcut" | "project_panel_shortcut" => "project_panel_shortcut",
            "revealActiveFileShortcut" | "reveal_active_file_shortcut" => "reveal_active_file_shortcut",
            "gitPanelShortcut" | "git_panel_shortcut" => "git_panel_shortcut",
            "portsPanelShortcut" | "ports_panel_shortcut" => "ports_panel_shortcut",
            "terminalFontSizeIncreaseShortcut" | "terminal_font_size_increase_shortcut" => "terminal_font_size_increase_shortcut",
            "terminalFontSizeDecreaseShortcut" | "terminal_font_size_decrease_shortcut" => "terminal_font_size_decrease_shortcut",
            "hostResourcePinnedMount" | "host_resource_pinned_mount" => "host_resource_pinned_mount",
            "terminalSuggestionsEnabled" | "terminal_suggestions_enabled" => "terminal_suggestions_enabled",
            "terminalAutoSwitchProjectEnabled" | "terminal_auto_switch_project_enabled" => "terminal_auto_switch_project_enabled",
            "terminalAgentNotifications" | "terminal_agent_notifications" => "terminal_agent_notifications",
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
            "explorerShowHidden" | "explorer_show_hidden" => "explorer_show_hidden",
            "explorerLanguageFilter" | "explorer_language_filter" => "explorer_language_filter",
            "mobileCustomKeyboardEnabled" | "mobile_custom_keyboard_enabled" => "mobile_custom_keyboard_enabled",
            "mobileCustomKeyboardFontSize" | "mobile_custom_keyboard_font_size" => "mobile_custom_keyboard_font_size",
            "mobileCustomKeyboardPadding" | "mobile_custom_keyboard_padding" => "mobile_custom_keyboard_padding",
            "mobileCustomKeyboardRowGap" | "mobile_custom_keyboard_row_gap" => "mobile_custom_keyboard_row_gap",
            "terminalOrder" | "terminal_order" => "terminal_order",
            "projectOrder" | "project_order" => "project_order",
            "projectCommandOrder" | "project_command_order" => "project_command_order",
            "runtimeGroupOrder" | "runtime_group_order" => "runtime_group_order",
            "runtimeItemOrder" | "runtime_item_order" => "runtime_item_order",
            "terminalScrollButtonsEnabled" | "terminal_scroll_buttons_enabled" => "terminal_scroll_buttons_enabled",
            "terminalCommitStatusEnabled" | "terminal_commit_status_enabled" => "terminal_commit_status_enabled",
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
            "cursorTheme" | "cursor_theme" => "cursor_theme",
            "appShortcuts" | "app_shortcuts" => "app_shortcuts",
            other => other,
        };

        // Known shortcut paths only: encode explicit unbound as TOML "" before generic null dropping
        if KNOWN_SCALAR_SHORTCUT_KEYS.contains(&toml_key) && value.is_null() {
            value = Value::String("".to_string());
        } else if toml_key == "app_shortcuts" {
            if let Value::Object(inner) = &mut value {
                for val in inner.values_mut() {
                    if val.is_null() {
                        *val = Value::String("".to_string());
                    }
                }
            }
        }

        ui.insert(toml_key.to_string(), value);
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
