//! Strict release manifest types, parsing, serialization, and role projection.

use super::constants::MAX_MANIFEST_BYTES;
use super::error::ReleaseError;
use super::inventory::{InventoryEntry, TargetRole};
use super::manifest_validation::validate_manifest_invariants;
use serde::{Deserialize, Serialize};

/// Root release manifest representation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
    pub schema_version: u32,
    pub release: ReleaseMeta,
    pub profile: ProfileMeta,
    pub archive: ArchiveMeta,
    pub components: ComponentsMeta,
    pub inventory: Vec<InventoryEntry>,
    pub services: ServicesMeta,
    pub rollback: RollbackMeta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseMeta {
    pub tag: String,
    pub version: String,
    pub commit_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileMeta {
    pub id: String,
    pub os_id: String,
    pub os_version: String,
    pub arch: String,
    pub target: String,
    pub glibc_min: String,
    pub systemd_min: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveMeta {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentVersion {
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentsMeta {
    pub cli: ComponentVersion,
    pub api: ComponentVersion,
    pub web_host: ComponentVersion,
    pub web_assets: ComponentVersion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceContract {
    pub unit_name: String,
    pub identity: String,
    pub bind_host: String,
    pub port: u16,
    pub health_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServicesMeta {
    pub api: ServiceContract,
    pub web: ServiceContract,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackMeta {
    pub previous_release_compatible: bool,
    pub state_compatibility: String,
}

impl ReleaseManifest {
    /// Parse and validate a UTF-8 manifest JSON string against strict v1 schema and contract invariants.
    pub fn parse_and_validate(raw_bytes: &[u8]) -> Result<Self, ReleaseError> {
        if raw_bytes.len() > MAX_MANIFEST_BYTES {
            return Err(ReleaseError::PayloadTooLarge(raw_bytes.len()));
        }

        let manifest: ReleaseManifest = serde_json::from_slice(raw_bytes)
            .map_err(|e| ReleaseError::JsonDeserialization(e.to_string()))?;

        validate_manifest_invariants(&manifest)?;
        Ok(manifest)
    }

    /// Project the release inventory to entries applicable for the given target role.
    pub fn project_role(&self, role: TargetRole) -> Vec<&InventoryEntry> {
        self.inventory
            .iter()
            .filter(|entry| role.matches(&entry.roles))
            .collect()
    }
}
