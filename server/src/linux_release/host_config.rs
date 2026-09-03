//! Host deployment configuration, role assignment, and storage.

use super::error::ReleaseError;
use super::inventory::TargetRole;
use super::origin::validate_web_origins;
use super::version::validate_version;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
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

/// Public host configuration stored in `/etc/dam-hopper/host-config.json`
/// and candidate `/var/lib/dam-hopper/pending-host-config.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPublicConfig {
    pub schema_version: u32,
    pub role: TargetRole,
    pub release_version: String,
    pub profile_id: String,
    pub api_url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_web_origins: Vec<String>,
}

impl HostPublicConfig {
    pub fn new(
        role: TargetRole,
        release_version: String,
        profile_id: String,
        api_url: String,
        allowed_web_origins: Vec<String>,
    ) -> Result<Self, ReleaseError> {
        let validated_origins = validate_web_origins(&allowed_web_origins)?;
        validate_version(&release_version)?;
        let parsed_uuid = uuid::Uuid::parse_str(&profile_id)
            .map_err(|e| ReleaseError::Config(format!("invalid profile_id '{profile_id}': {e}")))?;
        if parsed_uuid.get_version() != Some(uuid::Version::Random) {
            return Err(ReleaseError::Config(format!(
                "invalid profile_id '{profile_id}': must be UUID v4"
            )));
        }

        Ok(Self {
            schema_version: 1,
            role,
            release_version,
            profile_id,
            api_url,
            allowed_web_origins: validated_origins,
        })
    }
}

/// Load public host configuration JSON from a given file path.
pub fn load_host_public_config(path: &Path) -> Result<Option<HostPublicConfig>, ReleaseError> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|e| ReleaseError::Io {
        action: "read public host config",
        details: e.to_string(),
    })?;

    let config: HostPublicConfig = serde_json::from_str(&content).map_err(|e| {
        ReleaseError::Config(format!(
            "failed to parse public host config at '{}': {e}",
            path.display()
        ))
    })?;

    validate_web_origins(&config.allowed_web_origins)?;
    Ok(Some(config))
}

/// Save public host configuration atomically to disk with fsync.
pub fn save_host_public_config(path: &Path, config: &HostPublicConfig) -> Result<(), ReleaseError> {
    validate_web_origins(&config.allowed_web_origins)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
            action: "create public host config directory",
            details: e.to_string(),
        })?;
    }

    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| ReleaseError::Config(format!("failed to serialize public host config: {e}")))?;

    let temp_path = path.with_extension(format!("tmp.{}", std::process::id()));
    let file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_path)
        .map_err(|e| ReleaseError::Io {
            action: "open temporary public host config",
            details: e.to_string(),
        })?;

    let mut writer = std::io::BufWriter::new(file);
    writer.write_all(serialized.as_bytes()).map_err(|e| ReleaseError::Io {
        action: "write serialized public host config",
        details: e.to_string(),
    })?;
    writer.flush().map_err(|e| ReleaseError::Io {
        action: "flush public host config",
        details: e.to_string(),
    })?;
    let file = writer.into_inner().map_err(|e| ReleaseError::Io {
        action: "extract file writer for public host config",
        details: e.to_string(),
    })?;
    file.sync_all().map_err(|e| ReleaseError::Io {
        action: "fsync public host config",
        details: e.to_string(),
    })?;
    fs::rename(&temp_path, path).map_err(|e| ReleaseError::Io {
        action: "rename public host config into place",
        details: e.to_string(),
    })?;

    Ok(())
}
