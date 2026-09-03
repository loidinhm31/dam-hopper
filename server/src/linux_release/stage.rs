//! Pending candidate state and role resolution for release staging.

use super::error::ReleaseError;
use super::host_config::{load_host_config, save_host_config, HostConfig};
use super::inventory::TargetRole;
use super::layout::Layout;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub use super::stage_transaction::stage_release_bundle;

/// Pending release candidate metadata written to `/var/lib/dam-hopper/pending.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingState {
    pub tag: String,
    pub role: TargetRole,
    pub staged_at: String,
    pub release_path: String,
    pub manifest_sha256: String,
    pub archive_sha256: String,
}

/// Load pending candidate metadata if present.
pub fn load_pending_state(path: &Path) -> Result<Option<PendingState>, ReleaseError> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|e| ReleaseError::Io {
        action: "read pending state",
        details: e.to_string(),
    })?;
    let state: PendingState = serde_json::from_str(&content)
        .map_err(|e| ReleaseError::Config(format!("failed to parse pending state: {e}")))?;
    Ok(Some(state))
}

/// Save pending candidate metadata durably with fsync.
pub fn save_pending_state(path: &Path, state: &PendingState) -> Result<(), ReleaseError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
            action: "create state directory",
            details: e.to_string(),
        })?;
    }

    let json = serde_json::to_string_pretty(state)
        .map_err(|e| ReleaseError::Config(format!("failed to serialize pending state: {e}")))?;

    let temp_path = path.with_extension(format!("tmp.{}", std::process::id()));
    let file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_path)
        .map_err(|e| ReleaseError::Io {
            action: "open temporary pending state file",
            details: e.to_string(),
        })?;

    use std::io::Write;
    let mut writer = std::io::BufWriter::new(file);
    writer
        .write_all(json.as_bytes())
        .map_err(|e| ReleaseError::Io {
            action: "write pending state",
            details: e.to_string(),
        })?;
    writer.flush().map_err(|e| ReleaseError::Io {
        action: "flush pending state buffer",
        details: e.to_string(),
    })?;
    writer
        .into_inner()
        .map_err(|e| ReleaseError::Io {
            action: "extract pending state inner file",
            details: e.to_string(),
        })?
        .sync_all()
        .map_err(|e| ReleaseError::Io {
            action: "fsync pending state file",
            details: e.to_string(),
        })?;

    fs::rename(&temp_path, path).map_err(|e| ReleaseError::Io {
        action: "rename pending state into place",
        details: e.to_string(),
    })?;

    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }

    Ok(())
}

/// Resolve and update the host role configuration.
pub fn resolve_host_role(
    layout: &Layout,
    requested_role: Option<TargetRole>,
    allow_origins: &[String],
    is_role_set: bool,
) -> Result<TargetRole, ReleaseError> {
    let existing_config = load_host_config(&layout.host_config_path())?;

    if is_role_set {
        let role = requested_role.ok_or(ReleaseError::MissingRole)?;
        let mut origins = existing_config
            .as_ref()
            .map(|c| c.allowed_web_origins.clone())
            .unwrap_or_default();
        if !allow_origins.is_empty() {
            origins = allow_origins.to_vec();
        }
        let config = HostConfig::new(role, origins)?;
        save_host_config(&layout.host_config_path(), &config)?;
        return Ok(role);
    }

    match existing_config {
        Some(mut config) => {
            if let Some(requested) = requested_role {
                if requested != config.role {
                    return Err(ReleaseError::RoleConflict {
                        recorded: config.role.to_string(),
                        requested: requested.to_string(),
                    });
                }
            }
            if !allow_origins.is_empty() {
                config.allowed_web_origins = allow_origins.to_vec();
                save_host_config(&layout.host_config_path(), &config)?;
            }
            Ok(config.role)
        }
        None => {
            let role = requested_role.ok_or(ReleaseError::MissingRole)?;
            let config = HostConfig::new(role, allow_origins.to_vec())?;
            save_host_config(&layout.host_config_path(), &config)?;
            Ok(role)
        }
    }
}
