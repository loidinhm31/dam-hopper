//! Host deployment configuration, role assignment, and storage.

use super::error::ReleaseError;
use super::inventory::TargetRole;
use super::origin::validate_web_origins;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Host configuration stored persistently in `/etc/dam-hopper/host.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostConfig {
    /// Active selected deployment role for this machine.
    pub role: TargetRole,
    /// Exact allowed browser origins for the API server (CORS).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_web_origins: Vec<String>,
}

impl HostConfig {
    /// Create a new host config after validating origins.
    pub fn new(role: TargetRole, allowed_web_origins: Vec<String>) -> Result<Self, ReleaseError> {
        let validated_origins = validate_web_origins(&allowed_web_origins)?;
        Ok(Self {
            role,
            allowed_web_origins: validated_origins,
        })
    }
}

/// Load host configuration from a given file path.
/// Returns `None` if the file does not exist.
pub fn load_host_config(path: &Path) -> Result<Option<HostConfig>, ReleaseError> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|e| ReleaseError::Io {
        action: "read host config",
        details: e.to_string(),
    })?;

    let config: HostConfig = toml::from_str(&content).map_err(|e| {
        ReleaseError::Config(format!(
            "failed to parse host config at '{}': {e}",
            path.display()
        ))
    })?;

    validate_web_origins(&config.allowed_web_origins)?;
    Ok(Some(config))
}

/// Save host configuration atomically to disk.
pub fn save_host_config(path: &Path, config: &HostConfig) -> Result<(), ReleaseError> {
    validate_web_origins(&config.allowed_web_origins)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
            action: "create host config directory",
            details: e.to_string(),
        })?;
    }

    let serialized = toml::to_string_pretty(config)
        .map_err(|e| ReleaseError::Config(format!("failed to serialize host config: {e}")))?;

    let temp_path = path.with_extension(format!("tmp.{}", std::process::id()));
    fs::write(&temp_path, serialized).map_err(|e| ReleaseError::Io {
        action: "write temporary host config",
        details: e.to_string(),
    })?;

    fs::rename(&temp_path, path).map_err(|e| ReleaseError::Io {
        action: "rename host config into place",
        details: e.to_string(),
    })?;

    Ok(())
}
