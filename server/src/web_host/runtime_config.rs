//! Strict runtime config and health response types for the dedicated web host.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

use crate::linux_release::origin::validate_web_origin;
use crate::linux_release::version::validate_version;

/// Maximum allowable size for runtime-config.json (4 KiB).
pub const MAX_RUNTIME_CONFIG_BYTES: usize = 4096;

#[derive(Debug, Error)]
pub enum WebHostConfigError {
    #[error("runtime config file '{0}' not found")]
    NotFound(String),
    #[error("runtime config file '{0}' is a symlink, which is rejected")]
    SymlinkRejected(String),
    #[error("runtime config file '{0}' exceeds 4 KiB size limit ({1} bytes)")]
    TooLarge(String, usize),
    #[error("failed to read runtime config '{0}': {1}")]
    Io(String, #[source] std::io::Error),
    #[error("invalid JSON in runtime config '{0}': {1}")]
    Json(String, #[source] serde_json::Error),
    #[error("invalid schemaVersion {0}, expected 1")]
    InvalidSchemaVersion(u32),
    #[error("invalid releaseVersion '{0}': {1}")]
    InvalidReleaseVersion(String, String),
    #[error("invalid profileId '{0}': must be a valid UUID v4")]
    InvalidProfileId(String),
    #[error("invalid apiUrl '{0}': {1}")]
    InvalidApiUrl(String, String),
}

/// Strict public runtime configuration returned at `/__dam-hopper/runtime-config.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebRuntimeConfig {
    pub schema_version: u32,
    pub release_version: String,
    pub profile_id: String,
    pub api_url: String,
}

impl WebRuntimeConfig {
    /// Validate that all fields meet strict security and correctness invariants.
    pub fn validate(&self) -> Result<(), WebHostConfigError> {
        if self.schema_version != 1 {
            return Err(WebHostConfigError::InvalidSchemaVersion(self.schema_version));
        }

        validate_version(&self.release_version).map_err(|e| {
            WebHostConfigError::InvalidReleaseVersion(self.release_version.clone(), e.to_string())
        })?;

        let parsed_uuid = uuid::Uuid::parse_str(&self.profile_id)
            .map_err(|_| WebHostConfigError::InvalidProfileId(self.profile_id.clone()))?;
        if parsed_uuid.get_version() != Some(uuid::Version::Random) {
            return Err(WebHostConfigError::InvalidProfileId(self.profile_id.clone()));
        }

        validate_web_origin(&self.api_url)
            .map_err(|e| WebHostConfigError::InvalidApiUrl(self.api_url.clone(), e.to_string()))?;

        Ok(())
    }

    /// Load, bound-check, and validate runtime config from disk without following symlinks.
    pub fn load_from_file(path: &Path) -> Result<Self, WebHostConfigError> {
        let display = path.display().to_string();
        let meta = std::fs::symlink_metadata(path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    WebHostConfigError::NotFound(display.clone())
                } else {
                    WebHostConfigError::Io(display.clone(), e)
                }
            })?;

        if meta.file_type().is_symlink() {
            return Err(WebHostConfigError::SymlinkRejected(display));
        }

        if meta.len() as usize > MAX_RUNTIME_CONFIG_BYTES {
            return Err(WebHostConfigError::TooLarge(display, meta.len() as usize));
        }

        let bytes = std::fs::read(path)
            .map_err(|e| WebHostConfigError::Io(display.clone(), e))?;
        if bytes.len() > MAX_RUNTIME_CONFIG_BYTES {
            return Err(WebHostConfigError::TooLarge(display, bytes.len()));
        }

        let config: Self = serde_json::from_slice(&bytes)
            .map_err(|e| WebHostConfigError::Json(display, e))?;
        config.validate()?;
        Ok(config)
    }
}

/// Health check response payload returned at `/__dam-hopper/health`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebHealthResponse {
    pub schema_version: u32,
    pub status: String,
    pub version: String,
    pub role: String,
}

impl WebHealthResponse {
    pub fn new(version: impl Into<String>) -> Self {
        Self {
            schema_version: 1,
            status: "ok".to_string(),
            version: version.into(),
            role: "web".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_runtime_config() {
        let cfg = WebRuntimeConfig {
            schema_version: 1,
            release_version: "0.1.0".to_string(),
            profile_id: "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            api_url: "http://127.0.0.1:4801".to_string(),
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_rejects_invalid_schema_version() {
        let cfg = WebRuntimeConfig {
            schema_version: 2,
            release_version: "0.1.0".to_string(),
            profile_id: "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            api_url: "http://127.0.0.1:4801".to_string(),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_rejects_invalid_uuid() {
        let cfg = WebRuntimeConfig {
            schema_version: 1,
            release_version: "0.1.0".to_string(),
            profile_id: "not-a-uuid".to_string(),
            api_url: "http://127.0.0.1:4801".to_string(),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_rejects_invalid_api_url() {
        let cfg = WebRuntimeConfig {
            schema_version: 1,
            release_version: "0.1.0".to_string(),
            profile_id: "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            api_url: "http://user:pass@127.0.0.1:4801/subpath?query=1#frag".to_string(),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_health_response_structure() {
        let health = WebHealthResponse::new("1.2.3");
        assert_eq!(health.schema_version, 1);
        assert_eq!(health.status, "ok");
        assert_eq!(health.version, "1.2.3");
        assert_eq!(health.role, "web");

        let json = serde_json::to_string(&health).unwrap();
        assert!(json.contains("\"schemaVersion\":1"));
        assert!(json.contains("\"role\":\"web\""));
    }
}
