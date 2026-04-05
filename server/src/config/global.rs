use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::utils::atomic_write;

use super::schema::{GlobalConfig, KnownWorkspace};

pub fn global_config_path() -> PathBuf {
    let xdg_home = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
        .unwrap_or_else(|| PathBuf::from("~/.config"));

    xdg_home.join("dev-hub").join("config.toml")
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

    match toml::from_str::<GlobalConfig>(&content) {
        Ok(cfg) => Ok(Some(cfg)),
        Err(e) => {
            // Matches Node.js behavior: corrupted global config is warned and ignored.
            tracing::warn!(path = %path.display(), error = %e, "Failed to parse global config — ignoring");
            Ok(None)
        }
    }
}

pub fn write_global_config_at(path: &Path, config: &GlobalConfig) -> Result<(), AppError> {
    let content = toml::to_string_pretty(config).map_err(|e| {
        AppError::Config(format!("Cannot serialize global config: {}", e))
    })?;
    // atomic_write uses 0o600 on Unix (protects workspace paths + future auth tokens)
    atomic_write(path, &content)
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

pub fn remove_known_workspace_at(
    config_path: &Path,
    workspace_path: &str,
) -> Result<(), AppError> {
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
