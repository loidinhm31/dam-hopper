//! Dedicated HTTP endpoints for server-global semantic navigation settings.
//!
//! Provides:
//! - `GET /api/semantic/settings`: Safe inspection of configured intent, runtime admission,
//!   passive toolchain readiness, immutable tuple identifier, resource capability, and caller authority.
//! - `PATCH /api/semantic/settings`: Admin-only hot toggle (`{ enabled: bool }`) requiring signed
//!   credentials and fresh role re-evaluation. Rejects `--no-auth` and non-admin users.

use axum::{
    extract::State,
    response::IntoResponse,
    Extension, Json,
};
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

fn detect_resource_capability() -> (String, Option<String>) {
    #[cfg(target_os = "linux")]
    {
        let cgroup_base = std::path::Path::new("/sys/fs/cgroup");
        let controllers_file = cgroup_base.join("cgroup.controllers");
        if controllers_file.exists() {
            if let Ok(controllers) = std::fs::read_to_string(&controllers_file) {
                if controllers.contains("memory") && controllers.contains("cpu") && controllers.contains("pids") {
                    return ("cgroup-v2".to_string(), None);
                }
            }
        }
        (
            "portable-only".to_string(),
            Some("Linux cgroup v2 controllers not fully available; running with advisory portable resource limits.".to_string()),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        (
            "portable-only".to_string(),
            Some("Host platform does not support Linux cgroups; running with portable resource limits.".to_string()),
        )
    }
}

async fn build_settings_response(
    state: &AppState,
    configured_enabled: bool,
    can_mutate: bool,
) -> SemanticSettingsResponse {
    let agg = state.semantic_supervisor.get_aggregate_status().await;
    let (policy_capability, resource_warning) = detect_resource_capability();
    let tuple_identifier = state
        .semantic_supervisor
        .tool_profile()
        .map(|p| p.tuple_id().to_string());

    let integrity_status = state
        .semantic_supervisor
        .tool_integrity_status()
        .map(|s| match s {
            crate::semantic::tool_profile::ToolIntegrityStatus::Valid => "Valid".to_string(),
            crate::semantic::tool_profile::ToolIntegrityStatus::Missing { component, .. } => {
                format!("Missing component: {component}")
            }
            crate::semantic::tool_profile::ToolIntegrityStatus::InvalidFileType { reason, .. } => {
                format!("Invalid file type: {reason}")
            }
            crate::semantic::tool_profile::ToolIntegrityStatus::PermissionDenied { reason, .. } => {
                format!("Permission denied: {reason}")
            }
            crate::semantic::tool_profile::ToolIntegrityStatus::DigestMismatch { .. } => {
                "Digest mismatch".to_string()
            }
        });

    let toolchain_ready = state
        .semantic_supervisor
        .tool_integrity_status()
        .map(|s| s.is_valid())
        .unwrap_or(false);

    let transition_error = state.semantic_supervisor.last_transition_error().await;

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

pub async fn patch_settings(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    mechanism: Option<Extension<CredentialMechanism>>,
    claims: Option<Extension<VerifiedAuthClaims>>,
    Json(patch): Json<PatchSemanticSettingsRequest>,
) -> Result<impl IntoResponse, ApiError> {
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

    let gc_path = global_config_path();
    let mut gc = match read_global_config_at(&gc_path).map_err(ApiError::from_app)? {
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
        if let Err(disable_err) = state.semantic_supervisor.prepare_disable().await {
            state
                .semantic_supervisor
                .record_disable_failure(format!("Teardown failed: {disable_err}"))
                .await;
            return Err(ApiError::from_app(crate::error::AppError::Internal(
                format!("Failed to clean up active semantic sessions: {disable_err}"),
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
        if let Err(write_err) = write_global_config_at(&gc_path, &gc) {
            state
                .semantic_supervisor
                .record_disable_failure(format!("Failed to persist disabled config: {write_err}"))
                .await;
            return Err(ApiError::from_app(write_err));
        }

        *state.global_config.write().await = gc.clone();
        state.semantic_supervisor.commit_disable().await;
    } else {
        // --- Transitioning ON ---
        // a. Passive integrity verification without child process execution
        state
            .semantic_supervisor
            .prepare_enable()
            .map_err(|e| ApiError::from_app(crate::error::AppError::InvalidInput(e.to_string())))?;

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
        write_global_config_at(&gc_path, &gc).map_err(ApiError::from_app)?;
        *state.global_config.write().await = gc.clone();
        state.semantic_supervisor.commit_enable().await;
    }

    let response = build_settings_response(&state, patch.enabled, true).await;
    Ok(Json(response))
}
