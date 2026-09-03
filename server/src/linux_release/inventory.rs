//! Inventory entry types, role models, and serde support.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub use super::inventory_path::{check_disallowed_files, normalize_inventory_path};
pub use super::inventory_validation::validate_inventory;

/// Kind of filesystem entry recorded in the manifest inventory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

/// Target deployment roles supported by the release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseRole {
    Common,
    Server,
    Web,
}

/// Target role selected during installation or runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum TargetRole {
    Server,
    Web,
    Both,
}

impl TargetRole {
    /// Check if an entry with the given roles matches this target role.
    pub fn matches(&self, roles: &[ReleaseRole]) -> bool {
        match self {
            TargetRole::Server => {
                roles.contains(&ReleaseRole::Common) || roles.contains(&ReleaseRole::Server)
            }
            TargetRole::Web => {
                roles.contains(&ReleaseRole::Common) || roles.contains(&ReleaseRole::Web)
            }
            TargetRole::Both => true,
        }
    }

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
/// Single entry in the release inventory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InventoryEntry {
    pub path: String,
    pub kind: EntryKind,
    pub roles: Vec<ReleaseRole>,
    #[serde(
        deserialize_with = "deserialize_mode",
        serialize_with = "serialize_mode"
    )]
    pub mode: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

fn deserialize_mode<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ModeValue {
        Int(u32),
        Str(String),
    }

    match ModeValue::deserialize(deserializer)? {
        ModeValue::Int(n) => Ok(n),
        ModeValue::Str(s) => {
            u32::from_str_radix(s.trim_start_matches("0o"), 8).map_err(serde::de::Error::custom)
        }
    }
}

fn serialize_mode<S>(mode: &u32, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_u32(*mode)
}
