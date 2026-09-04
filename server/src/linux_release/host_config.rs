//! Host deployment configuration, role assignment, and storage.

use super::durable_fs::atomic_write_file;
use super::error::ReleaseError;
use super::inventory::TargetRole;
use super::origin::{validate_web_origin, validate_web_origins};
use super::version::validate_version;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

const MAX_HOST_CONFIG_BYTES: usize = 64 * 1024;

fn read_config_file(path: &Path) -> Result<Option<Vec<u8>>, ReleaseError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect host configuration",
                details: error.to_string(),
            });
        }
    };
    if !metadata.file_type().is_file() {
        return Err(ReleaseError::OwnershipViolation {
            path: path.display().to_string(),
            expected: "regular host configuration file".into(),
            got: "symbolic link or non-regular file".into(),
        });
    }
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| ReleaseError::Io {
            action: "open host configuration with no-follow",
            details: error.to_string(),
        })?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_HOST_CONFIG_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| ReleaseError::Io {
            action: "read host configuration",
            details: error.to_string(),
        })?;
    if bytes.len() > MAX_HOST_CONFIG_BYTES {
        return Err(ReleaseError::Config(format!(
            "host configuration exceeds maximum size of {MAX_HOST_CONFIG_BYTES} bytes"
        )));
    }
    Ok(Some(bytes))
}

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
    let Some(bytes) = read_config_file(path)? else {
        return Ok(None);
    };
    let content = String::from_utf8(bytes).map_err(|error| {
        ReleaseError::Config(format!(
            "host config at '{}' is not valid UTF-8: {error}",
            path.display()
        ))
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

    let serialized = toml::to_string_pretty(config)
        .map_err(|e| ReleaseError::Config(format!("failed to serialize host config: {e}")))?;
    atomic_write_file(path, serialized.as_bytes(), Some(0o644))
}

/// Public host configuration stored in `/etc/dam-hopper/host-config.json`
/// and candidate `/var/lib/dam-hopper/pending-host-config.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostPublicConfig {
    pub schema_version: u32,
    pub role: TargetRole,
    pub release_version: String,
    pub profile_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_web_origins: Vec<String>,
}

impl HostPublicConfig {
    pub fn new(
        role: TargetRole,
        release_version: String,
        profile_id: String,
        api_url: Option<String>,
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

        if let Some(api_url) = &api_url {
            validate_web_origin(api_url)?;
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
    let Some(bytes) = read_config_file(path)? else {
        return Ok(None);
    };

    let config: HostPublicConfig = serde_json::from_slice(&bytes).map_err(|e| {
        ReleaseError::Config(format!(
            "failed to parse public host config at '{}': {e}",
            path.display()
        ))
    })?;

    validate_web_origins(&config.allowed_web_origins)?;
    if let Some(api_url) = &config.api_url {
        validate_web_origin(api_url)?;
    }
    Ok(Some(config))
}

/// Save public host configuration atomically to disk with fsync.
pub fn save_host_public_config(path: &Path, config: &HostPublicConfig) -> Result<(), ReleaseError> {
    validate_web_origins(&config.allowed_web_origins)?;

    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| ReleaseError::Config(format!("failed to serialize public host config: {e}")))?;
    atomic_write_file(path, serialized.as_bytes(), Some(0o644))
}
