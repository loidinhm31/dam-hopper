//! Dedicated HTTP endpoints for server-global semantic navigation settings.
//!
//! Provides:
//! - `GET /api/semantic/settings`: Safe inspection of configured intent, runtime admission,
//!   passive toolchain readiness, immutable tuple identifier, resource capability, and caller authority.
//! - `PATCH /api/semantic/settings`: Admin-only hot toggle (`{ enabled: bool }`) requiring signed
//!   credentials and fresh role re-evaluation. Rejects `--no-auth` and non-admin users.

use axum::{extract::State, response::IntoResponse, Extension, Json};
use serde::{Deserialize, Serialize};

use crate::api::auth::{
    evaluate_current_admin, AuthenticatedActor, CredentialMechanism, VerifiedAuthClaims,
};
use crate::api::error::ApiError;
use crate::auth::UserRole;
use crate::config::schema::SemanticConfig;
use crate::config::{global_config_path, read_global_config_at, write_global_config_at};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSettingsResponse {
    pub configured_enabled: bool,
    pub runtime_enabled: bool,
    pub runtime_state: String,
    pub integrity_status: Option<String>,
    pub toolchain_ready: bool,
    pub tuple_identifier: Option<String>,
    pub policy_capability: String,
    pub resource_warning: Option<String>,
    pub active_trees: usize,
    pub open_documents: usize,
    pub total_overlay_bytes: usize,
    pub generation: u64,
    pub transition_error: Option<String>,
    pub can_mutate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PatchSemanticSettingsRequest {
    pub enabled: bool,
}

async fn build_settings_response(
    state: &AppState,
    configured_enabled: bool,
    can_mutate: bool,
) -> SemanticSettingsResponse {
    let agg = state.semantic_supervisor.get_aggregate_status().await;
    // Controller availability is not evidence of controls applied to a child.
    // The production session owner currently uses portable enforcement only.
    let policy_capability = "portable-only".to_string();
    let resource_warning = Some(
        "Semantic children run with portable application limits, not hard RSS/CPU limits or a filesystem sandbox. Trusted workspaces only.".to_string(),
    );
    let tuple_identifier = state
        .semantic_supervisor
        .tool_profile()
        .map(|p| p.tuple_id().to_string());

    let cached_status = state.semantic_supervisor.tool_integrity_status();
    let (integrity_status, toolchain_ready) = match &cached_status {
        None => (None, false),
        Some(crate::semantic::tool_profile::ToolIntegrityStatus::Unverified) => {
            (Some("Unverified".to_string()), false)
        }
        Some(crate::semantic::tool_profile::ToolIntegrityStatus::Valid) => {
            (Some("Valid".to_string()), true)
        }
        Some(crate::semantic::tool_profile::ToolIntegrityStatus::Missing { component, .. }) => {
            (Some(format!("Missing component: {component}")), false)
        }
        Some(crate::semantic::tool_profile::ToolIntegrityStatus::InvalidFileType {
            reason,
            ..
        }) => (Some(format!("Invalid file type: {reason}")), false),
        Some(crate::semantic::tool_profile::ToolIntegrityStatus::PermissionDenied {
            reason,
            ..
        }) => (Some(format!("Permission denied: {reason}")), false),
        Some(crate::semantic::tool_profile::ToolIntegrityStatus::DigestMismatch { .. }) => {
            (Some("Digest mismatch".to_string()), false)
        }
    };

    // Internal failures can contain release/config paths. Never publish those details.
    let transition_error = state
        .semantic_supervisor
        .last_transition_error()
        .await
        .map(|_| "SEMANTIC_TRANSITION_FAILED".to_string());

    SemanticSettingsResponse {
        configured_enabled,
        runtime_enabled: agg.enabled,
        runtime_state: agg.state.to_string(),
        integrity_status,
        toolchain_ready,
        tuple_identifier,
        policy_capability,
        resource_warning,
        active_trees: agg.active_trees,
        open_documents: agg.open_documents,
        total_overlay_bytes: agg.total_overlay_bytes,
        generation: state.semantic_supervisor.runtime_epoch(),
        transition_error,
        can_mutate,
    }
}

pub async fn get_settings(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    mechanism: Option<Extension<CredentialMechanism>>,
) -> impl IntoResponse {
    let configured_enabled = {
        let gc = state.global_config.read().await;
        gc.semantic.as_ref().map(|s| s.enabled).unwrap_or(false)
    };

    let can_mutate = if state.no_auth {
        false
    } else {
        match (actor.as_ref(), mechanism.as_ref()) {
            (Some(Extension(act)), Some(Extension(mech))) => {
                *mech != CredentialMechanism::NoAuthDev && act.role == Some(UserRole::Admin)
            }
            _ => false,
        }
    };

    let response = build_settings_response(&state, configured_enabled, can_mutate).await;
    Json(response)
}

/// Bound authentication admission, not the cancellable HTTP response lifetime of
/// an admitted settings transaction.
pub async fn authenticate_settings_request(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let admitted = tokio::time::timeout(
        crate::semantic::resources::AUTH_STORE_LOOKUP_TIMEOUT,
        crate::api::auth::authenticate_request(&state, &jar, request),
    )
    .await;
    match admitted {
        Ok(Ok(request)) => next.run(request).await,
        Ok(Err(response)) => response,
        Err(_) => crate::api::auth_mfa::auth_error_response(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Authentication backend unavailable",
            None,
        ),
    }
}

pub async fn patch_settings(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    mechanism: Option<Extension<CredentialMechanism>>,
    claims: Option<Extension<VerifiedAuthClaims>>,
    Json(patch): Json<PatchSemanticSettingsRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // The transaction owns its locks and completes even when the HTTP request is dropped.
    tokio::spawn(apply_settings_patch(state, actor, mechanism, claims, patch))
        .await
        .map_err(|_| {
            ApiError::from_app(crate::error::AppError::Internal(
                "Semantic settings transition failed".to_string(),
            ))
        })?
}

async fn apply_settings_patch(
    state: AppState,
    actor: Option<Extension<AuthenticatedActor>>,
    mechanism: Option<Extension<CredentialMechanism>>,
    claims: Option<Extension<VerifiedAuthClaims>>,
    patch: PatchSemanticSettingsRequest,
) -> Result<Json<SemanticSettingsResponse>, ApiError> {
    // 1. Initial Authorization: verify admin authority before any side effects or locks
    evaluate_current_admin(
        &state,
        actor.as_ref().map(|e| &e.0),
        mechanism.as_ref().map(|e| &e.0),
        claims.as_ref().map(|e| &e.0),
    )
    .await?;

    // 2. Strict serialized lock order: global_config_mutation_lock -> supervisor transition_lock
    let _config_guard = state.global_config_mutation_lock.lock().await;
    let _transition_guard = state.semantic_supervisor.transition_lock().lock().await;

    // Waiting for a concurrent transition must not retain a stale privilege grant,
    // including the authorized no-op path.
    evaluate_current_admin(
        &state,
        actor.as_ref().map(|e| &e.0),
        mechanism.as_ref().map(|e| &e.0),
        claims.as_ref().map(|e| &e.0),
    )
    .await?;

    let gc_path = global_config_path();
    let mut gc = match read_global_config_at(&gc_path).map_err(|_| {
        ApiError::from_app(crate::error::AppError::Internal(
            "Semantic settings could not be read".to_string(),
        ))
    })? {
        Some(c) => c,
        None => state.global_config.read().await.clone(),
    };

    let current_enabled = gc.semantic.as_ref().map(|s| s.enabled).unwrap_or(false);
    let is_effective_enabled = state.semantic_supervisor.is_effective_enabled();

    // 3. Authorized idempotence check: no-op if durable intent and runtime state both agree
    if patch.enabled == current_enabled && patch.enabled == is_effective_enabled {
        let response = build_settings_response(&state, current_enabled, true).await;
        return Ok(Json(response));
    }

    if !patch.enabled {
        // --- Transitioning OFF ---
        // a. Immediate admission revocation and complete child tree reaping
        if state.semantic_supervisor.prepare_disable().await.is_err() {
            state
                .semantic_supervisor
                .record_disable_failure("SEMANTIC_TEARDOWN_FAILED".to_string())
                .await;
            return Err(ApiError::from_app(crate::error::AppError::Internal(
                "Semantic session cleanup failed".to_string(),
            )));
        }

        // b. Fresh admin re-evaluation immediately before durable disk commit
        let recheck = evaluate_current_admin(
            &state,
            actor.as_ref().map(|e| &e.0),
            mechanism.as_ref().map(|e| &e.0),
            claims.as_ref().map(|e| &e.0),
        )
        .await;

        if let Err(recheck_err) = recheck {
            // Demotion or store failure observed post-teardown! Enforce safe-disabled state with mismatch.
            state
                .semantic_supervisor
                .record_disable_failure(
                    "Administrator demoted or session revoked before commit; safely disabled with mismatch"
                        .to_string(),
                )
                .await;
            return Err(recheck_err);
        }

        // c. Durable atomic commit to disk and in-memory config
        gc.semantic = Some(SemanticConfig { enabled: false });
        if write_global_config_at(&gc_path, &gc).is_err() {
            state
                .semantic_supervisor
                .record_disable_failure("SEMANTIC_PERSIST_FAILED".to_string())
                .await;
            return Err(ApiError::from_app(crate::error::AppError::Internal(
                "Semantic settings persistence failed".to_string(),
            )));
        }

        *state.global_config.write().await = gc.clone();
        state.semantic_supervisor.commit_disable().await;
    } else {
        // --- Transitioning ON ---
        // a. Passive integrity verification without child process execution
        state
            .semantic_supervisor
            .prepare_enable()
            .await
            .map_err(|_| {
                ApiError::from_app(crate::error::AppError::InvalidInput(
                    "Bundled semantic engine is unavailable or cleanup is incomplete".to_string(),
                ))
            })?;

        // b. Fresh admin re-evaluation immediately before durable disk commit
        evaluate_current_admin(
            &state,
            actor.as_ref().map(|e| &e.0),
            mechanism.as_ref().map(|e| &e.0),
            claims.as_ref().map(|e| &e.0),
        )
        .await?;

        // c. Durable atomic commit to disk and in-memory config
        gc.semantic = Some(SemanticConfig { enabled: true });
        write_global_config_at(&gc_path, &gc).map_err(|_| {
            ApiError::from_app(crate::error::AppError::Internal(
                "Semantic settings persistence failed".to_string(),
            ))
        })?;
        *state.global_config.write().await = gc.clone();
        state.semantic_supervisor.commit_enable().await;
    }

    let response = build_settings_response(&state, patch.enabled, true).await;
    Ok(Json(response))
}
