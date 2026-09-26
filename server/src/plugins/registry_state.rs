use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::LazyLock;

use super::contract::GrantKey;
use super::error::PluginError;
use super::manifest::{ManifestContracts, ManifestEntrypoints};

static ID_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9_.-]*[a-z0-9]$").unwrap());
static SHA256_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-f0-9]{64}$").unwrap());

pub const REGISTRY_SCHEMA_VERSION: u32 = 1;

/// Strict package record stored in the durable registry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegisteredPackageRecord {
    pub plugin_id: String,
    pub version: String,
    pub archive_sha256: String,
    pub publisher: String,
    pub host_version_range: String,
    pub contracts: ManifestContracts,
    pub capabilities: Vec<String>,
    pub entrypoints: ManifestEntrypoints,
    pub installed_at: String,
}

impl RegisteredPackageRecord {
    pub fn validate(&self) -> Result<(), PluginError> {
        if !ID_REGEX.is_match(&self.plugin_id) {
            return Err(PluginError::invalid_input(format!(
                "Invalid plugin ID in package record: '{}'",
                self.plugin_id
            )));
        }
        if semver::Version::parse(&self.version).is_err() {
            return Err(PluginError::invalid_input(format!(
                "Invalid semver version in package record: '{}'",
                self.version
            )));
        }
        if !SHA256_REGEX.is_match(&self.archive_sha256) {
            return Err(PluginError::invalid_input(format!(
                "Invalid archive SHA-256 in package record: '{}'",
                self.archive_sha256
            )));
        }
        Ok(())
    }
}
/// Typed owner-history source provisioned as part of trusted installation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OwnerHistorySource {
    pub root_path: String,
    pub root_identity: String,
    #[serde(default = "default_source_revision")]
    pub source_revision: u64,
    #[serde(default = "default_true")]
    pub all_authenticated_history_read: bool,
}

fn default_source_revision() -> u64 {
    1
}

fn default_true() -> bool {
    true
}

impl OwnerHistorySource {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.root_path.trim().is_empty()
            || !self.root_path.starts_with('/')
            || self.root_path.contains("..")
            || self.root_path.contains('\0')
        {
            return Err(PluginError::invalid_input(
                "owner_history_source.root_path must be a normalized non-empty absolute path without parent traversal",
            ));
        }
        if !SHA256_REGEX.is_match(&self.root_identity) {
            return Err(PluginError::invalid_input(format!(
                "Invalid owner_history_source.root_identity: '{}' (must be 64-char lowercase hex)",
                self.root_identity
            )));
        }
        if self.source_revision == 0 {
            return Err(PluginError::invalid_input(
                "owner_history_source.source_revision must be at least 1",
            ));
        }
        Ok(())
    }
}

/// Snapshot of a previously active package pair for non-security rollback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RollbackPackageSnapshot {
    pub package_digest: String,
    pub version: String,
    pub bindings: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
    pub published_at: String,
}

impl RollbackPackageSnapshot {
    pub fn validate(&self) -> Result<(), PluginError> {
        if !SHA256_REGEX.is_match(&self.package_digest) {
            return Err(PluginError::invalid_input(format!(
                "Invalid package digest in rollback snapshot: '{}'",
                self.package_digest
            )));
        }
        if semver::Version::parse(&self.version).is_err() {
            return Err(PluginError::invalid_input(format!(
                "Invalid version in rollback snapshot: '{}'",
                self.version
            )));
        }
        if let Some(source) = &self.owner_history_source {
            source.validate()?;
        }
        Ok(())
    }
}

/// Current security-authoritative state for an installation.
///
/// Under Requirement 12 & 13:
/// "Never restore revoked actor/source grants, replaced bindings, disabled intent,
/// admin membership or old auth/security revisions. Persisted current security intent
/// wins even when activation failure races a grant revoke or disable."
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityIntent {
    pub enabled: bool,
    pub grants: Vec<GrantKey>,
    pub bindings: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
    pub security_revision: u64,
}

/// Strict installation record representing an active or configured plugin instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InstallationRecord {
    pub installation_id: String,
    pub plugin_id: String,
    pub active_package_digest: String,
    pub active_version: String,
    pub activation_generation: u64,
    pub enabled: bool,
    pub bindings: BTreeMap<String, String>,
    pub grants: Vec<GrantKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_history_source: Option<OwnerHistorySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_package: Option<RollbackPackageSnapshot>,
    pub created_at: String,
    pub updated_at: String,
}
impl InstallationRecord {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.installation_id.trim().is_empty() {
            return Err(PluginError::invalid_input(
                "installation_id cannot be empty",
            ));
        }
        if !ID_REGEX.is_match(&self.plugin_id) {
            return Err(PluginError::invalid_input(format!(
                "Invalid plugin ID in installation record: '{}'",
                self.plugin_id
            )));
        }
        if !SHA256_REGEX.is_match(&self.active_package_digest) {
            return Err(PluginError::invalid_input(format!(
                "Invalid active package digest: '{}'",
                self.active_package_digest
            )));
        }
        if semver::Version::parse(&self.active_version).is_err() {
            return Err(PluginError::invalid_input(format!(
                "Invalid active version: '{}'",
                self.active_version
            )));
        }
        if self.activation_generation == 0 {
            return Err(PluginError::invalid_input(
                "activation_generation must be at least 1",
            ));
        }
        if let Some(prev) = &self.previous_package {
            prev.validate()?;
        }
        if let Some(source) = &self.owner_history_source {
            source.validate()?;
        }
        Ok(())
    }

    pub fn security_intent(&self, security_revision: u64) -> SecurityIntent {
        SecurityIntent {
            enabled: self.enabled,
            grants: self.grants.clone(),
            bindings: self.bindings.clone(),
            owner_history_source: self.owner_history_source.clone(),
            security_revision,
        }
    }
}

/// Strict root authority record persisted at `registry-v1.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegistryV1Record {
    pub version: u32,
    pub registry_revision: u64,
    pub security_revision: u64,
    pub packages: BTreeMap<String, RegisteredPackageRecord>,
    pub installations: BTreeMap<String, InstallationRecord>,
}

impl RegistryV1Record {
    pub fn new_empty() -> Self {
        Self {
            version: REGISTRY_SCHEMA_VERSION,
            registry_revision: 1,
            security_revision: 1,
            packages: BTreeMap::new(),
            installations: BTreeMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), PluginError> {
        if self.version != REGISTRY_SCHEMA_VERSION {
            return Err(PluginError::invalid_input(format!(
                "Unsupported registry schema version: {}, expected {}",
                self.version, REGISTRY_SCHEMA_VERSION
            )));
        }
        if self.registry_revision == 0 {
            return Err(PluginError::invalid_input("registry_revision must be >= 1"));
        }
        if self.security_revision == 0 {
            return Err(PluginError::invalid_input("security_revision must be >= 1"));
        }

        for (key, pkg) in &self.packages {
            pkg.validate()?;
            let expected_key = format!("{}@{}#{}", pkg.plugin_id, pkg.version, pkg.archive_sha256);
            if key != &expected_key {
                return Err(PluginError::invalid_input(format!(
                    "Package key mismatch: expected '{}', got '{}'",
                    expected_key, key
                )));
            }
        }

        for (id, inst) in &self.installations {
            inst.validate()?;
            if id != &inst.installation_id {
                return Err(PluginError::invalid_input(format!(
                    "Installation key mismatch: expected '{}', got '{}'",
                    inst.installation_id, id
                )));
            }

            let expected_pkg_key = format!(
                "{}@{}#{}",
                inst.plugin_id, inst.active_version, inst.active_package_digest
            );
            if !self.packages.contains_key(&expected_pkg_key) {
                return Err(PluginError::invalid_input(format!(
                    "Installation '{}' references non-existent package '{}'",
                    id, expected_pkg_key
                )));
            }
        }

        Ok(())
    }
}
