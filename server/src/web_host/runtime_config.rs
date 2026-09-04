//! Strict runtime config and health response types for the dedicated web host.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

use crate::linux_release::host_config::HostPublicConfig;
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebRuntimeConfig {
    pub schema_version: u32,
    pub release_version: String,
    pub profile_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_url: Option<String>,
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

        if let Some(api_url) = &self.api_url {
            validate_web_origin(api_url).map_err(|e| {
                WebHostConfigError::InvalidApiUrl(api_url.clone(), e.to_string())
            })?;
        }

        Ok(())
    }

    /// Load the machine-local `HostPublicConfig`, then expose only the strict
    /// runtime fields to the web process. Runtime settings are never packaged.
    pub fn load_from_file(path: &Path) -> Result<Self, WebHostConfigError> {
        let display = path.display().to_string();
        let meta = std::fs::symlink_metadata(path).map_err(|e| {
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

        let host_config: HostPublicConfig = serde_json::from_slice(&bytes)
            .map_err(|e| WebHostConfigError::Json(display, e))?;
        let config = Self {
            schema_version: host_config.schema_version,
            release_version: host_config.release_version,
            profile_id: host_config.profile_id,
            api_url: host_config.api_url,
        };
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
            api_url: Some("http://127.0.0.1:4801".to_string()),
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_valid_runtime_config_without_api_url() {
        let cfg = WebRuntimeConfig {
            schema_version: 1,
            release_version: "0.1.0".to_string(),
            profile_id: "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            api_url: None,
        };
        assert!(cfg.validate().is_ok());
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("apiUrl"));
    }

    #[test]
    fn test_rejects_invalid_schema_version() {
        let cfg = WebRuntimeConfig {
            schema_version: 2,
            release_version: "0.1.0".to_string(),
            profile_id: "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            api_url: Some("http://127.0.0.1:4801".to_string()),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_rejects_invalid_uuid() {
        let cfg = WebRuntimeConfig {
            schema_version: 1,
            release_version: "0.1.0".to_string(),
            profile_id: "not-a-uuid".to_string(),
            api_url: Some("http://127.0.0.1:4801".to_string()),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_rejects_invalid_api_url() {
        let cfg = WebRuntimeConfig {
            schema_version: 1,
            release_version: "0.1.0".to_string(),
            profile_id: "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            api_url: Some(
                "http://user:pass@127.0.0.1:4801/subpath?query=1#frag".to_string(),
            ),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_rejects_unknown_runtime_config_fields() {
        let result = serde_json::from_str::<WebRuntimeConfig>(
            r#"{"schemaVersion":1,"releaseVersion":"0.1.0","profileId":"c7325e68-07e1-4e44-8d96-b333a4658cf9","unexpected":true}"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_load_projects_serialized_host_public_config() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("host-config.json");
        let host_config = HostPublicConfig::new(
            crate::linux_release::TargetRole::Both,
            "0.1.0".to_string(),
            "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            None,
            vec!["http://localhost:4802".to_string()],
        )
        .unwrap();
        std::fs::write(&path, serde_json::to_vec(&host_config).unwrap()).unwrap();

        let runtime = WebRuntimeConfig::load_from_file(&path).unwrap();
        assert_eq!(runtime.api_url, None);
        let output: serde_json::Value = serde_json::to_value(runtime).unwrap();
        let object = output.as_object().unwrap();
        assert_eq!(object.len(), 3);
        assert!(!object.contains_key("role"));
        assert!(!object.contains_key("allowedWebOrigins"));
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
