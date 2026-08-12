//! Authenticated, server-authoritative semantic trust endpoints.

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::error::AppError;
use crate::semantic::protocol::validate_opaque_id;
use crate::semantic::supervisor::SupervisorError;
use crate::semantic::trust::{
    SemanticTrustChallenge, SemanticTrustState, SemanticTrustTransitionRequest,
};
use crate::state::AppState;

use super::error::{ApiError, AppJson};

const TRANSITION_AUDIT_REASON: &str = "explicit semantic trust transition";
const REVOKE_AUDIT_REASON: &str = "explicit semantic trust revocation";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevokeBody {}

pub async fn status(
    Path(project_id): Path<String>,
    State(state): State<AppState>,
) -> Result<AppJson<SemanticTrustState>, ApiError> {
    let _workspace_context = state.workspace_context_guard.read().await;
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    let (root, _) = project_context(&state, &project_id).await?;
    state
        .semantic_supervisor
        .trust_state(&project_id, &root)
        .map(AppJson)
        .map_err(map_supervisor_error)
}

pub async fn challenge(
    Path(project_id): Path<String>,
    State(state): State<AppState>,
) -> Result<AppJson<SemanticTrustChallenge>, ApiError> {
    let _workspace_context = state.workspace_context_guard.read().await;
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    let (root, _) = project_context(&state, &project_id).await?;
    state
        .semantic_supervisor
        .issue_trust_challenge(&project_id, &root)
        .map(AppJson)
        .map_err(map_supervisor_error)
}

pub async fn transition(
    Path(project_id): Path<String>,
    State(state): State<AppState>,
    Json(request): Json<SemanticTrustTransitionRequest>,
) -> Result<AppJson<SemanticTrustState>, ApiError> {
    if request.project_id != project_id {
        return Err(invalid("project identity mismatch"));
    }
    let (root, workspace_epoch) = {
        let _workspace_context = state.workspace_context_guard.read().await;
        let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
        let context = project_context(&state, &project_id).await?;
        (context.0, state.semantic_supervisor.workspace_epoch())
    };
    state
        .semantic_supervisor
        .transition_trust(&request, &root, TRANSITION_AUDIT_REASON, workspace_epoch)
        .await
        .map_err(map_supervisor_error)?;
    let _workspace_context = state.workspace_context_guard.read().await;
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    state
        .semantic_supervisor
        .trust_state(&project_id, &root)
        .map(AppJson)
        .map_err(map_supervisor_error)
}

pub async fn revoke(
    Path(project_id): Path<String>,
    State(state): State<AppState>,
    Json(_body): Json<RevokeBody>,
) -> Result<impl IntoResponse, ApiError> {
    let (root, workspace_epoch) = {
        let _workspace_context = state.workspace_context_guard.read().await;
        let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
        let context = project_context(&state, &project_id).await?;
        (context.0, state.semantic_supervisor.workspace_epoch())
    };
    state
        .semantic_supervisor
        .revoke_project(&project_id, &root, REVOKE_AUDIT_REASON, workspace_epoch)
        .await
        .map_err(map_supervisor_error)?;
    let _workspace_context = state.workspace_context_guard.read().await;
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    state
        .semantic_supervisor
        .trust_state(&project_id, &root)
        .map(|state| Json(state).into_response())
        .map_err(map_supervisor_error)
}

async fn project_context(
    state: &AppState,
    project_id: &str,
) -> Result<(std::path::PathBuf, SemanticTrustState), ApiError> {
    if validate_opaque_id(project_id, "project_id").is_err() {
        return Err(invalid("semantic project identity is invalid"));
    }
    let sandbox = state
        .fs
        .sandbox()
        .map_err(|_| unavailable("filesystem sandbox unavailable"))?;
    let root = sandbox
        .project_root(project_id)
        .ok_or_else(|| not_found("semantic project not found"))?;
    let trust = state
        .semantic_supervisor
        .trust_state(project_id, &root)
        .map_err(map_supervisor_error)?;
    Ok((root, trust))
}

fn map_supervisor_error(error: SupervisorError) -> ApiError {
    match error {
        SupervisorError::Trust(
            crate::semantic::trust_store::TrustStoreError::PersistenceUnavailable,
        ) => unavailable("semantic trust persistence unavailable"),
        SupervisorError::Trust(crate::semantic::trust_store::TrustStoreError::ChallengeMissing)
        | SupervisorError::Trust(
            crate::semantic::trust_store::TrustStoreError::ProjectIdMismatch,
        ) => invalid("semantic trust challenge is invalid"),
        SupervisorError::Trust(_) => invalid("semantic trust request is invalid"),
        SupervisorError::UnsupportedCapability | SupervisorError::Disabled => {
            unavailable("semantic capability unavailable")
        }
        SupervisorError::ProjectRevoked => invalid("semantic project is revoked"),
        SupervisorError::TrustPolicyChanged => invalid("semantic trust policy changed"),
        _ => unavailable("semantic service unavailable"),
    }
}

fn invalid(message: &str) -> ApiError {
    ApiError::from_app(AppError::InvalidInput(message.into()))
}

fn not_found(message: &str) -> ApiError {
    ApiError::from_app(AppError::NotFound(message.into()))
}

fn unavailable(message: &str) -> ApiError {
    ApiError::from_app(AppError::Unavailable(message.into()))
}
