use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;
use std::path::PathBuf;

use crate::agent_status::{
    check_extension_status, install_extension, uninstall_extension,
    AgentStatusSnapshotV1, ExtensionStatusReport, IntegrationError,
};
use crate::api::error::ApiError;
use crate::state::AppState;

/// Query parameters for extension inspection and uninstallation.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionQuery {
    pub agent_dir: Option<String>,
}

/// Request body for extension installation.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInstallBody {
    pub agent_dir: Option<String>,
}

fn resolve_target_agent_dir(explicit: Option<&str>) -> Result<PathBuf, IntegrationError> {
    if let Some(raw) = explicit {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if !p.is_absolute() {
                return Err(IntegrationError::NonAbsolutePath(p));
            }
            return Ok(p);
        }
    }

    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        let p = PathBuf::from(dir);
        if p.is_absolute() {
            return Ok(p);
        }
    }

    dirs::home_dir()
        .map(|h| h.join(".omp").join("agent"))
        .ok_or_else(|| {
            IntegrationError::InvalidAgentDirectory(PathBuf::from("~/.omp/agent"))
        })
}

/// Get current public agent status snapshot across all terminals.
pub async fn get_snapshot(State(state): State<AppState>) -> Json<AgentStatusSnapshotV1> {
    Json(state.agent_status.snapshot())
}

/// Check status of the managed OMP extension.
pub async fn get_omp_extension_status(
    Query(q): Query<ExtensionQuery>,
) -> Result<Json<ExtensionStatusReport>, ApiError> {
    let agent_dir = resolve_target_agent_dir(q.agent_dir.as_deref())
        .map_err(ApiError::from)?;
    let report = check_extension_status(&agent_dir).map_err(ApiError::from)?;
    Ok(Json(report))
}

/// Install or upgrade the managed OMP extension.
pub async fn install_omp_extension(
    Json(body): Json<ExtensionInstallBody>,
) -> Result<Json<ExtensionStatusReport>, ApiError> {
    let agent_dir = resolve_target_agent_dir(body.agent_dir.as_deref())
        .map_err(ApiError::from)?;

    if !agent_dir.exists() {
        std::fs::create_dir_all(&agent_dir)
            .map_err(|e| ApiError::from_app(IntegrationError::Io(e).into()))?;
    }

    let report = install_extension(&agent_dir).map_err(ApiError::from)?;
    Ok(Json(report))
}

/// Uninstall the managed OMP extension.
pub async fn uninstall_omp_extension(
    Query(q): Query<ExtensionQuery>,
) -> Result<Json<ExtensionStatusReport>, ApiError> {
    let agent_dir = resolve_target_agent_dir(q.agent_dir.as_deref())
        .map_err(ApiError::from)?;
    let report = uninstall_extension(&agent_dir).map_err(ApiError::from)?;
    Ok(Json(report))
}
