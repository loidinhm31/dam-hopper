use axum::extract::{Extension, Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde::Deserialize;

use crate::api::auth::AuthenticatedActor;
use crate::api::plugins::plugin_error_response;
use crate::plugins::admin::*;
use crate::state::AppState;
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoveQuery {
    #[serde(default)]
    pub expected_security_revision: Option<u64>,
}

fn check_no_auth(no_auth: bool) -> Result<(), Response> {
    if no_auth {
        Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Plugin management operations are strictly disabled in --no-auth mode",
                "code": "NoAuthForbidden",
            })),
        )
            .into_response())
    } else {
        Ok(())
    }
}

/// GET /api/plugins/admin — list all installations with admin/worker details
pub async fn list_admin_installations_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_list_installations(&actor.subject)
        .await
    {
        Ok(list) => (StatusCode::OK, Json(list)).into_response(),
        Err(err) => plugin_error_response(err),
    }
}

/// GET /api/plugins/admin/installations/:id — get installation details
pub async fn get_admin_installation_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_get_installation(&actor.subject, &id)
        .await
    {
        Ok(inst) => (StatusCode::OK, Json(inst)).into_response(),
        Err(err) => plugin_error_response(err),
    }
}

/// POST /api/plugins/admin/stages — stream a gzip package archive to runner with backpressure
pub async fn stage_package_upload_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    headers: HeaderMap,
    request: Request,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.contains("gzip") && !content_type.contains("octet-stream") {
        return (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(serde_json::json!({
                "error": "Invalid Content-Type; application/gzip or application/octet-stream required",
                "code": "UnsupportedMediaType",
            })),
        )
            .into_response();
    }

    let expected_sha256 = headers
        .get("X-Expected-SHA256")
        .or_else(|| headers.get("x-expected-sha256"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if expected_sha256.len() != 64 || !expected_sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Missing or invalid X-Expected-SHA256 header (must be 64-char hex string)",
                "code": "InvalidExpectedSha256",
            })),
        )
            .into_response();
    }

    let total_bytes = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    if total_bytes == 0 {
        return (
            StatusCode::LENGTH_REQUIRED,
            Json(serde_json::json!({
                "error": "Missing or zero Content-Length header",
                "code": "LengthRequired",
            })),
        )
            .into_response();
    }
    if total_bytes > crate::plugins::MAX_PACKAGE_COMPRESSED_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "error": format!(
                    "Invalid Content-Length: must not exceed {} bytes",
                    crate::plugins::MAX_PACKAGE_COMPRESSED_BYTES
                ),
                "code": "PayloadTooLarge",
            })),
        )
            .into_response();
    }

    let begin_res = match state
        .plugin_service
        .runner_client()
        .admin_stage_begin(StageBeginParams {
            expected_sha256: expected_sha256.to_string(),
            total_bytes,
            actor_subject: actor.subject.clone(),
        })
        .await
    {
        Ok(b) => b,
        Err(e) => return plugin_error_response(e),
    };

    use base64::Engine;
    let mut stream = request.into_body().into_data_stream();
    let mut sequence = 0u64;
    let mut buffer = Vec::with_capacity(begin_res.max_chunk_size);
    let mut received_bytes = 0u64;

    while let Some(chunk_res) = stream.next().await {
        let chunk = match chunk_res {
            Ok(bytes) => bytes,
            Err(e) => {
                tracing::warn!(error = %e, "Client disconnected or body read error during stage upload");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": format!("Streaming body error: {e}"),
                        "code": "StreamError",
                    })),
                )
                    .into_response();
            }
        };

        received_bytes += chunk.len() as u64;
        if received_bytes > total_bytes
            || received_bytes > crate::plugins::MAX_PACKAGE_COMPRESSED_BYTES
        {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({
                    "error": "Uploaded stream exceeded declared length or max package size",
                    "code": "PayloadTooLarge",
                })),
            )
                .into_response();
        }

        buffer.extend_from_slice(&chunk);
        while buffer.len() >= begin_res.max_chunk_size {
            let chunk_to_send: Vec<u8> = buffer.drain(..begin_res.max_chunk_size).collect();
            let b64 = base64::engine::general_purpose::STANDARD.encode(&chunk_to_send);
            if let Err(e) = state
                .plugin_service
                .runner_client()
                .admin_stage_chunk(StageChunkParams {
                    stage_id: begin_res.stage_id.clone(),
                    sequence,
                    chunk_base64: b64,
                    actor_subject: actor.subject.clone(),
                })
                .await
            {
                return plugin_error_response(e);
            }
            sequence += 1;
        }
    }

    if !buffer.is_empty() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&buffer);
        if let Err(e) = state
            .plugin_service
            .runner_client()
            .admin_stage_chunk(StageChunkParams {
                stage_id: begin_res.stage_id.clone(),
                sequence,
                chunk_base64: b64,
                actor_subject: actor.subject.clone(),
            })
            .await
        {
            return plugin_error_response(e);
        }
    }

    match state
        .plugin_service
        .runner_client()
        .admin_stage_finish(StageFinishParams {
            stage_id: begin_res.stage_id.clone(),
            actor_subject: actor.subject.clone(),
        })
        .await
    {
        Ok(review) => (StatusCode::CREATED, Json(review)).into_response(),
        Err(e) => plugin_error_response(e),
    }
}

/// POST /api/plugins/admin/stages/:stageId/approve — approve stage and install/update
pub async fn approve_stage_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(stage_id): Path<String>,
    Json(body): Json<ApproveStageRequest>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_approve(ApproveStageParams {
            stage_id,
            expected_sha256: body.expected_sha256,
            expected_security_revision: body.expected_security_revision,
            initial_bindings: body.initial_bindings,
            initial_grants: body.initial_grants,
            owner_history_source: body.owner_history_source,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(inst) => {
            state.plugin_service.auth_service().set_owner_history_source(&inst.installation_id, inst.owner_history_source.clone());
            state.plugin_service.invalidate_caches_and_revoke_all();
            (StatusCode::OK, Json(inst)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}

/// POST /api/plugins/admin/installations/:id/rollback — rollback to previous package
pub async fn rollback_installation_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
    Json(body): Json<LifecycleActionRequest>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_rollback(RollbackParams {
            installation_id: id.clone(),
            expected_security_revision: body.expected_security_revision,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(inst) => {
            state.plugin_service.invalidate_installation(&id);
            (StatusCode::OK, Json(inst)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}

/// POST /api/plugins/admin/installations/:id/enable — enable installation
pub async fn enable_installation_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
    Json(body): Json<LifecycleActionRequest>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_enable(EnableParams {
            installation_id: id.clone(),
            expected_security_revision: body.expected_security_revision,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(inst) => {
            state.plugin_service.invalidate_installation(&id);
            (StatusCode::OK, Json(inst)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}

/// POST /api/plugins/admin/installations/:id/disable — disable installation
pub async fn disable_installation_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
    Json(body): Json<LifecycleActionRequest>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_disable(DisableParams {
            installation_id: id.clone(),
            expected_security_revision: body.expected_security_revision,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(inst) => {
            state.plugin_service.invalidate_installation(&id);
            (StatusCode::OK, Json(inst)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}

/// DELETE /api/plugins/admin/installations/:id — remove installation
pub async fn remove_installation_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
    Query(query): Query<RemoveQuery>,
    headers: HeaderMap,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    let expected_revision = query
        .expected_security_revision
        .or_else(|| {
            headers
                .get("X-Expected-Security-Revision")
                .or_else(|| headers.get("x-expected-security-revision"))
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
        })
        .unwrap_or(0);
    match state
        .plugin_service
        .runner_client()
        .admin_remove(RemoveParams {
            installation_id: id.clone(),
            expected_security_revision: expected_revision,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(res) => {
            state.plugin_service.invalidate_installation(&id);
            (StatusCode::OK, Json(res)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}

/// PUT /api/plugins/admin/installations/:id/grants — replace grants
pub async fn replace_grants_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
    Json(body): Json<ReplaceGrantsRequest>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_replace_grants(ReplaceGrantsParams {
            installation_id: id.clone(),
            expected_security_revision: body.expected_security_revision,
            grants: body.grants,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(inst) => {
            state.plugin_service.invalidate_installation(&id);
            (StatusCode::OK, Json(inst)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}

/// PUT /api/plugins/admin/installations/:id/bindings — replace bindings
pub async fn replace_bindings_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
    Json(body): Json<ReplaceBindingsRequest>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_replace_bindings(ReplaceBindingsParams {
            installation_id: id.clone(),
            expected_security_revision: body.expected_security_revision,
            bindings: body.bindings,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(inst) => {
            state.plugin_service.invalidate_installation(&id);
            (StatusCode::OK, Json(inst)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}
/// PUT /api/plugins/admin/installations/:id/owner-history-source — replace owner-history source
pub async fn replace_owner_history_source_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Path(id): Path<String>,
    Json(body): Json<ReplaceOwnerHistorySourceRequest>,
) -> Response {
    if let Err(res) = check_no_auth(state.no_auth) {
        return res;
    }

    match state
        .plugin_service
        .runner_client()
        .admin_replace_owner_history_source(ReplaceOwnerHistorySourceParams {
            installation_id: id.clone(),
            expected_security_revision: body.expected_security_revision,
            owner_history_source: body.owner_history_source,
            actor_subject: actor.subject,
        })
        .await
    {
        Ok(inst) => {
            state.plugin_service.auth_service().set_owner_history_source(&id, inst.owner_history_source.clone());
            state.plugin_service.invalidate_installation(&id);
            (StatusCode::OK, Json(inst)).into_response()
        }
        Err(e) => plugin_error_response(e),
    }
}
