use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

use super::error::PluginError;

static ID_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9_.-]*[a-z0-9]$").unwrap());
static SHA256_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-f0-9]{64}$").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ManifestContracts {
    pub runner_protocol: String,
    pub worker_sdk: String,
    pub ui_bridge: String,
    pub manifest: u32,
    pub data_api: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackendEntrypoint {
    pub runtime: String,
    pub range: String,
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UiEntrypoint {
    pub entry: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ManifestEntrypoints {
    pub backend: BackendEntrypoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui: Option<UiEntrypoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NavigationItem {
    pub id: String,
    pub title: String,
    pub route: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InventoryItem {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub mode: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ManifestV1 {
    pub manifest_version: u32,
    pub id: String,
    pub version: String,
    pub publisher: String,
    pub host_version_range: String,
    pub contracts: ManifestContracts,
    pub capabilities: Vec<String>,
    pub entrypoints: ManifestEntrypoints,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub navigation: Option<Vec<NavigationItem>>,
    pub inventory: Vec<InventoryItem>,
}

pub fn validate_manifest(raw: &str) -> Result<ManifestV1, PluginError> {
    let manifest: ManifestV1 = serde_json::from_str(raw).map_err(|err| {
        PluginError::invalid_input(format!("Manifest schema validation failed: {}", err))
    })?;

    if manifest.manifest_version != 1 {
        return Err(PluginError::incompatible(format!(
            "Unsupported manifestVersion: {}",
            manifest.manifest_version
        )));
    }

    if !ID_REGEX.is_match(&manifest.id) {
        return Err(PluginError::invalid_input(format!(
            "Invalid plugin id: {}",
            manifest.id
        )));
    }

    semver::Version::parse(&manifest.version).map_err(|err| {
        PluginError::invalid_input(format!("Invalid plugin semver version: {}", err))
    })?;

    if manifest.publisher.trim().is_empty() {
        return Err(PluginError::invalid_input(
            "Manifest publisher must not be empty",
        ));
    }

    if manifest.host_version_range.trim().is_empty() {
        return Err(PluginError::invalid_input(
            "Manifest hostVersionRange must not be empty",
        ));
    }

    if manifest.contracts.manifest != 1 {
        return Err(PluginError::incompatible(
            "Manifest contracts.manifest must be 1",
        ));
    }

    if manifest.entrypoints.backend.runtime != "node" {
        return Err(PluginError::invalid_input("Backend runtime must be 'node'"));
    }

    if let Some(ui) = &manifest.entrypoints.ui {
        if ui.mode != "opaque-srcdoc" {
            return Err(PluginError::invalid_input(
                "Ui mode must be 'opaque-srcdoc'",
            ));
        }
    }

    for item in &manifest.inventory {
        if !SHA256_REGEX.is_match(&item.sha256) {
            return Err(PluginError::invalid_input(format!(
                "Invalid sha256 in inventory: {}",
                item.sha256
            )));
        }
    }

    Ok(manifest)
}
