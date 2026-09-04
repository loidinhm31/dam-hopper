//! Pending candidate state and role resolution for release staging.

use super::error::ReleaseError;
use super::host_config::{load_host_config, save_host_config, HostConfig};
use super::inventory::TargetRole;
use super::layout::Layout;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub use super::stage_transaction::stage_release_bundle;

/// Pending release candidate metadata written to `/var/lib/dam-hopper/pending.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingState {
    pub tag: String,
    pub role: TargetRole,
    pub staged_at: String,
    pub release_path: String,
    pub manifest_sha256: String,
    pub archive_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_units_path: Option<String>,
}

/// Load pending candidate metadata from authoritative state if present.
pub fn load_pending_state(path: &Path) -> Result<Option<PendingState>, ReleaseError> {
    let state_path = if path.file_name() == Some(std::ffi::OsStr::new("pending.json")) {
        path.with_file_name("state.json")
    } else {
        path.to_path_buf()
    };
    if !state_path.exists() {
        return Ok(None);
    }
    let mgr_state = super::state::load_or_init_manager_state(&state_path)?;
    Ok(mgr_state.pending.map(|p| PendingState {
        tag: p.tag,
        role: p.role,
        staged_at: p.staged_at,
        release_path: p.release_path,
        manifest_sha256: p.manifest_sha256,
        archive_sha256: p.archive_sha256,
        pending_units_path: p.pending_units_path,
    }))
}

/// Resolve the requested role without mutating the host configuration.
pub fn determine_host_role(
    layout: &Layout,
    requested_role: Option<TargetRole>,
    allow_origins: &[String],
    is_role_set: bool,
) -> Result<(TargetRole, HostConfig), ReleaseError> {
    let existing_config = load_host_config(&layout.host_config_path())?;

    if is_role_set {
        let role = requested_role.ok_or(ReleaseError::MissingRole)?;
        let mut origins = existing_config
            .as_ref()
            .map(|c| c.allowed_web_origins.clone())
            .unwrap_or_default();
        if !allow_origins.is_empty() {
            origins = allow_origins.to_vec();
        }
        return Ok((role, HostConfig::new(role, origins)?));
    }

    match existing_config {
        Some(config) => {
            if let Some(requested) = requested_role {
                if requested != config.role {
                    return Err(ReleaseError::RoleConflict {
                        recorded: config.role.to_string(),
                        requested: requested.to_string(),
                    });
                }
            }
            let role = config.role;
            let origins = if allow_origins.is_empty() {
                config.allowed_web_origins
            } else {
                allow_origins.to_vec()
            };
            Ok((role, HostConfig::new(role, origins)?))
        }
        None => {
            let role = requested_role.ok_or(ReleaseError::MissingRole)?;
            Ok((role, HostConfig::new(role, allow_origins.to_vec())?))
        }
    }
}

/// Persist a previously validated host role configuration.
pub fn persist_host_role(layout: &Layout, config: &HostConfig) -> Result<(), ReleaseError> {
    save_host_config(&layout.host_config_path(), config)
}

/// Resolve and update the host role configuration.
pub fn resolve_host_role(
    layout: &Layout,
    requested_role: Option<TargetRole>,
    allow_origins: &[String],
    is_role_set: bool,
) -> Result<TargetRole, ReleaseError> {
    let (role, config) =
        determine_host_role(layout, requested_role, allow_origins, is_role_set)?;
    persist_host_role(layout, &config)?;
    Ok(role)
}
