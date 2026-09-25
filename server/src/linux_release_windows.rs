//! Windows contract facade for DamHopper release metadata and web-host contracts.
//!
//! Exposes portable validators, error types, and DTOs consumed by `web_host`
//! on Windows targets without compiling Linux-only deployment, systemd, or libc dependencies.

#[path = "linux_release/error.rs"]
pub mod error;

#[path = "linux_release/version.rs"]
pub mod version;

#[path = "linux_release/origin.rs"]
pub mod origin;

#[path = "linux_release/durable_fs.rs"]
pub mod durable_fs;
pub use error::ReleaseError;
pub use origin::{validate_web_origin, validate_web_origins};
pub use version::{
    validate_commit_sha, validate_release_tag, validate_sha256_hex, validate_version,
};

pub mod inventory {
    use serde::{Deserialize, Serialize};

    /// Target role selected during installation or runtime.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, clap::ValueEnum)]
    #[serde(rename_all = "lowercase")]
    pub enum TargetRole {
        Server,
        Web,
        Both,
    }

    impl TargetRole {
        pub fn as_str(&self) -> &'static str {
            match self {
                TargetRole::Server => "server",
                TargetRole::Web => "web",
                TargetRole::Both => "both",
            }
        }

        pub fn includes_server(&self) -> bool {
            matches!(self, TargetRole::Server | TargetRole::Both)
        }

        pub fn includes_web(&self) -> bool {
            matches!(self, TargetRole::Web | TargetRole::Both)
        }
    }

    impl std::fmt::Display for TargetRole {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "{}", self.as_str())
        }
    }
}

pub use inventory::TargetRole;

pub mod host_config {
    use super::error::ReleaseError;
    use super::inventory::TargetRole;
    use super::origin::{validate_web_origin, validate_web_origins};
    use super::version::validate_version;
    use serde::{Deserialize, Serialize};

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
            let parsed_uuid = uuid::Uuid::parse_str(&profile_id).map_err(|e| {
                ReleaseError::Config(format!("invalid profile_id '{profile_id}': {e}"))
            })?;
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
}

pub use host_config::HostPublicConfig;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_windows_facade_target_role_serde() {
        let role = TargetRole::Both;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"both\"");
        let parsed: TargetRole = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, TargetRole::Both);
        assert!(parsed.includes_server());
        assert!(parsed.includes_web());
    }

    #[test]
    fn test_windows_facade_host_public_config_validation() {
        let config = HostPublicConfig::new(
            TargetRole::Server,
            "1.2.3".to_string(),
            "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            Some("http://localhost:4803".to_string()),
            vec!["http://localhost:5173".to_string()],
        );
        assert!(config.is_ok());

        // Invalid version
        let bad_version = HostPublicConfig::new(
            TargetRole::Server,
            "1.2.3-beta".to_string(),
            "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
            None,
            vec![],
        );
        assert!(bad_version.is_err());
    }
}
