use axum::extract::{Extension, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::api::auth::AuthenticatedActor;
use crate::plugins::contract::{ContextScopeKind, PluginMetadataItem};
use crate::plugins::error::{PluginError, PluginErrorCode};
use crate::state::AppState;
use crate::workspace_target::ProjectTargetRef;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListPluginsQuery {
    pub project: String,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPluginsResponse {
    pub plugins: Vec<PluginMetadataItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetWireDto {
    pub project: String,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenContextRequest {
    pub epoch: u64,
    pub installation_id: String,
    pub target: TargetWireDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_kind: Option<ContextScopeKind>,
    #[serde(default)]
    pub allowed_operations: Vec<String>,
    #[serde(default)]
    pub allow_current_account_policy: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloseContextRequest {
    pub epoch: u64,
    pub context_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvokeRequest {
    pub epoch: u64,
    pub context_id: String,
    pub request_id: String,
    pub operation: String,
    pub payload: serde_json::Value,
    pub deadline_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeResponse {
    pub result: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelRequest {
    pub epoch: u64,
    pub context_id: String,
    pub request_id: String,
}

pub fn plugin_error_response(err: PluginError) -> Response {
    let status = match err.code {
        PluginErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
        PluginErrorCode::Forbidden | PluginErrorCode::SourcePermissionDenied => {
            StatusCode::FORBIDDEN
        }
        PluginErrorCode::InvalidInput
        | PluginErrorCode::Incompatible
        | PluginErrorCode::DetailChangedOrMissing => StatusCode::BAD_REQUEST,
        PluginErrorCode::SourceMissing | PluginErrorCode::SourceNotConfigured => {
            StatusCode::NOT_FOUND
        }
        PluginErrorCode::Overloaded => StatusCode::TOO_MANY_REQUESTS,
        PluginErrorCode::DeadlineExceeded => StatusCode::GATEWAY_TIMEOUT,
        PluginErrorCode::Cancelled => StatusCode::CONFLICT,
        PluginErrorCode::ContextRevoked | PluginErrorCode::SnapshotExpired => StatusCode::GONE,
        PluginErrorCode::WorkerFailed
        | PluginErrorCode::RunnerUnavailable
        | PluginErrorCode::RuntimeUnavailable => StatusCode::SERVICE_UNAVAILABLE,
    };

    (
        status,
        Json(serde_json::json!({
            "error": err.message,
            "code": format!("{:?}", err.code),
        })),
    )
        .into_response()
}

fn check_no_auth(no_auth: bool) -> Result<(), Response> {
    if no_auth {
        Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Plugin platform is strictly disabled in --no-auth mode",
                "code": "NoAuthForbidden",
            })),
        )
            .into_response())
    } else {
        Ok(())
    }
}

pub async fn list_plugins_handler(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Query(query): Query<ListPluginsQuery>,
) -> Response {
    if let Err(resp) = check_no_auth(state.no_auth) {
        return resp;
    }

    let Some(Extension(actor)) = actor else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )
            .into_response();
    };

    let configured_root = match state.workspace_target_project_path(&query.project).await {
        Ok(path) => path,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Project target not found" })),
            )
                .into_response();
        }
    };

    let target_ref = ProjectTargetRef {
        project: query.project,
        worktree_path: query.worktree_path,
    };

    match state
        .plugin_service
        .list_plugins(&actor, &target_ref, &configured_root, state.no_auth)
        .await
    {
        Ok(plugins) => Json(ListPluginsResponse { plugins }).into_response(),
        Err(e) => plugin_error_response(e),
    }
}

pub async fn open_context_handler(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(request): Json<OpenContextRequest>,
) -> Response {
    if let Err(resp) = check_no_auth(state.no_auth) {
        return resp;
    }

    let Some(Extension(actor)) = actor else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )
            .into_response();
    };

    let configured_root = match state
        .workspace_target_project_path(&request.target.project)
        .await
    {
        Ok(path) => path,
        Err(e) => {
            if request.scope_kind == Some(ContextScopeKind::HistoryRoot) {
                std::path::PathBuf::from("/")
            } else {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": format!("Project target not found: {e}") })),
                )
                    .into_response();
            }
        }
    };

    let target_ref = ProjectTargetRef {
        project: request.target.project,
        worktree_path: request.target.worktree_path,
    };

    match state
        .plugin_service
        .open_context(
            &actor,
            request.epoch,
            &request.installation_id,
            &target_ref,
            &configured_root,
            request.scope_kind,
            request.allowed_operations,
            request.allow_current_account_policy,
            state.no_auth,
        )
        .await
    {
        Ok(res) => Json(res).into_response(),
        Err(e) => plugin_error_response(e),
    }
}

pub async fn invoke_handler(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(request): Json<InvokeRequest>,
) -> Response {
    if let Err(resp) = check_no_auth(state.no_auth) {
        return resp;
    }

    let Some(Extension(actor)) = actor else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )
            .into_response();
    };

    match state
        .plugin_service
        .invoke(
            &actor,
            request.epoch,
            &request.context_id,
            &request.request_id,
            &request.operation,
            request.payload,
            request.deadline_ms,
            state.no_auth,
        )
        .await
    {
        Ok(result) => Json(InvokeResponse { result }).into_response(),
        Err(e) => plugin_error_response(e),
    }
}

pub async fn cancel_handler(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(request): Json<CancelRequest>,
) -> Response {
    if let Err(resp) = check_no_auth(state.no_auth) {
        return resp;
    }

    let Some(Extension(actor)) = actor else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )
            .into_response();
    };

    match state
        .plugin_service
        .cancel_request(
            &actor,
            request.epoch,
            &request.context_id,
            &request.request_id,
            state.no_auth,
        )
        .await
    {
        Ok(res) => Json(res).into_response(),
        Err(e) => plugin_error_response(e),
    }
}

pub async fn close_context_handler(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(request): Json<CloseContextRequest>,
) -> Response {
    if let Err(resp) = check_no_auth(state.no_auth) {
        return resp;
    }

    let Some(Extension(actor)) = actor else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )
            .into_response();
    };

    match state
        .plugin_service
        .close_context(&actor, request.epoch, &request.context_id, state.no_auth)
        .await
    {
        Ok(res) => Json(res).into_response(),
        Err(e) => plugin_error_response(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invoke_request_rejects_legacy_params_field() {
        let request = serde_json::json!({
            "epoch": 1,
            "requestId": "frame-request-1",
            "contextId": "ctx-1",
            "operation": "advisor.scan",
            "payload": {},
            "params": {}
        });

        assert!(serde_json::from_value::<InvokeRequest>(request).is_err());
    }

    #[test]
    fn list_metadata_exposes_active_identity_in_camel_case() {
        let response = ListPluginsResponse {
            plugins: vec![PluginMetadataItem {
                id: "install-1".to_string(),
                version: "1.0.0".to_string(),
                publisher: "publisher".to_string(),
                capabilities: vec![],
                has_ui: true,
                active_digest: "a".repeat(64),
                active_generation: 4,
                enabled: true,
                owner_history_source: None,
            }],
        };

        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["plugins"][0]["activeDigest"], "a".repeat(64));
        assert_eq!(value["plugins"][0]["activeGeneration"], 4);
        assert!(value["plugins"][0].get("active_digest").is_none());
    }
}
