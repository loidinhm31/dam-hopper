use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};

use axum::extract::{ConnectInfo, Extension, Path, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::RwLock;

use crate::api::auth::AuthenticatedActor;
use crate::browser_host::attachments::{
    AttachmentError, AttachmentManager, IssueTicketRequest,
};
use crate::browser_host::auth::{
    evaluate_browser_admission, BrowserAdmission,
};
use crate::browser_host::input::{
    InputError, SessionInputManager, MAX_FIND_QUERY_CHARS,
};
use crate::browser_host::manager::ResetOutcome;
use crate::browser_host::session::{
    CreateSessionRequest, DEFAULT_MAX_TARGETS, SessionError, SessionRegistry,
};
use crate::state::AppState;
pub const X_BROWSER_LEASE: HeaderName = HeaderName::from_static("x-browser-lease");
pub static GLOBAL_SESSION_REGISTRY: LazyLock<SessionRegistry> =
    LazyLock::new(|| SessionRegistry::new(DEFAULT_MAX_TARGETS));
pub static GLOBAL_ATTACHMENT_MANAGER: LazyLock<AttachmentManager> =
    LazyLock::new(AttachmentManager::new);
pub static GLOBAL_INPUT_MANAGERS: LazyLock<
    RwLock<std::collections::HashMap<String, Arc<SessionInputManager>>>,
> = LazyLock::new(|| RwLock::new(std::collections::HashMap::new()));

pub fn global_session_registry() -> &'static SessionRegistry {
    &GLOBAL_SESSION_REGISTRY
}

pub fn global_attachment_manager() -> &'static AttachmentManager {
    &GLOBAL_ATTACHMENT_MANAGER
}

pub fn global_input_managers() -> &'static RwLock<std::collections::HashMap<String, Arc<SessionInputManager>>> {
    &GLOBAL_INPUT_MANAGERS
}

pub async fn get_or_create_input_manager(session_id: &str) -> Arc<SessionInputManager> {
    let mut map = global_input_managers().write().await;
    map.entry(session_id.to_string())
        .or_insert_with(|| Arc::new(SessionInputManager::new()))
        .clone()
}

pub(crate) fn no_store_response(status: StatusCode, json_val: serde_json::Value) -> Response {
    let mut resp = (status, Json(json_val)).into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    resp
}

pub(crate) fn browser_error_response(status: StatusCode, kind: &'static str, message: &str) -> Response {
    no_store_response(
        status,
        json!({
            "error": message,
            "kind": kind,
        }),
    )
}

impl From<SessionError> for Response {
    fn from(err: SessionError) -> Self {
        match err {
            SessionError::NotFound => {
                browser_error_response(StatusCode::NOT_FOUND, "sessionNotFound", "browser session not found")
            }
            SessionError::Forbidden => {
                browser_error_response(StatusCode::FORBIDDEN, "forbidden", "access to browser session is forbidden")
            }
            SessionError::Conflict(msg) => {
                browser_error_response(StatusCode::CONFLICT, "sessionConflict", &msg)
            }
            SessionError::Busy(msg) => {
                browser_error_response(StatusCode::TOO_MANY_REQUESTS, "browserBusy", &msg)
            }
            SessionError::InvalidInput(msg) => {
                browser_error_response(StatusCode::BAD_REQUEST, "invalidInput", &msg)
            }
            SessionError::PolicyViolation(msg) => {
                browser_error_response(StatusCode::BAD_REQUEST, "policyViolation", &msg)
            }
            SessionError::Internal(msg) => {
                browser_error_response(StatusCode::INTERNAL_SERVER_ERROR, "internalError", &msg)
            }
        }
    }
}

impl From<AttachmentError> for Response {
    fn from(err: AttachmentError) -> Self {
        match err {
            AttachmentError::TicketNotFound => {
                browser_error_response(StatusCode::UNAUTHORIZED, "ticketNotFound", "attachment ticket not found or already consumed")
            }
            AttachmentError::TicketExpired => {
                browser_error_response(StatusCode::UNAUTHORIZED, "ticketExpired", "attachment ticket has expired")
            }
            AttachmentError::PurposeMismatch { .. } => {
                browser_error_response(StatusCode::BAD_REQUEST, "purposeMismatch", &err.to_string())
            }
            AttachmentError::OriginMismatch { .. } => {
                browser_error_response(StatusCode::FORBIDDEN, "originMismatch", &err.to_string())
            }
            AttachmentError::CapacityExceeded(msg) => {
                browser_error_response(StatusCode::TOO_MANY_REQUESTS, "ticketCapacityExceeded", &msg)
            }
            _ => browser_error_response(StatusCode::BAD_REQUEST, "attachmentError", &err.to_string()),
        }
    }
}

impl From<InputError> for Response {
    fn from(err: InputError) -> Self {
        match err {
            InputError::LeaseNotFound => {
                browser_error_response(StatusCode::FORBIDDEN, "leaseNotFound", "no active control lease")
            }
            InputError::LeaseExpired => {
                browser_error_response(StatusCode::FORBIDDEN, "leaseExpired", "control lease has expired")
            }
            InputError::LeaseConflict(msg) => {
                browser_error_response(StatusCode::CONFLICT, "leaseConflict", &msg)
            }
            InputError::NotLeaseHolder => {
                browser_error_response(StatusCode::FORBIDDEN, "notLeaseHolder", "caller does not hold control lease")
            }
            InputError::StaleViewportEpoch { .. } => {
                browser_error_response(StatusCode::CONFLICT, "staleViewportEpoch", &err.to_string())
            }
            InputError::SequenceGap { .. } | InputError::StaleSequence { .. } => {
                browser_error_response(StatusCode::BAD_REQUEST, "sequenceViolation", &err.to_string())
            }
            InputError::QueueOverflow => {
                browser_error_response(StatusCode::TOO_MANY_REQUESTS, "queueOverflow", "input queue limit exceeded")
            }
            InputError::GeometryUnavailable => {
                browser_error_response(StatusCode::SERVICE_UNAVAILABLE, "inputUnavailable", "geometry unavailable")
            }
            InputError::InvalidFraction { .. } => {
                browser_error_response(StatusCode::BAD_REQUEST, "invalidCoordinates", &err.to_string())
            }
            InputError::TextTooLong { .. } | InputError::QueryTooLong { .. } => {
                browser_error_response(StatusCode::BAD_REQUEST, "payloadTooLarge", &err.to_string())
            }
        }
    }
}

pub(crate) async fn authenticate_browser_caller(
    state: &AppState,
    headers: &HeaderMap,
    connect: Option<&Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<&AuthenticatedActor>,
) -> Result<BrowserAdmission, Response> {
    let mut resolved_actor = actor.cloned();
    if resolved_actor.is_none() && !state.no_auth {
        let token_opt = crate::api::auth::extract_bearer_token(headers).map(str::to_string).or_else(|| {
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|c_str| {
                    for part in c_str.split(';') {
                        let trimmed = part.trim();
                        if let Some(val) = trimmed.strip_prefix(&format!("{}=", crate::api::auth::AUTH_COOKIE)) {
                            return Some(val.to_string());
                        }
                    }
                    None
                })
        });

        if let Some(token) = token_opt {
            if let Some(claims) = crate::auth::model::AuthClaims::decode(&token, &state.jwt_secret) {
                match state.auth_service.evaluate_claims(&claims).await {
                    crate::auth::model::AuthDecision::Authenticated { session, user } => {
                        let expires_at = crate::auth::model::bson_to_chrono(session.expires_at);
                        let mfa_verified_at = crate::auth::model::bson_to_chrono(session.mfa_verified_at);
                        let effective_deadline = crate::auth::compute_mfa_due_at(mfa_verified_at, expires_at);
                        resolved_actor = Some(AuthenticatedActor::with_session(
                            user.username.clone(),
                            Some(expires_at.timestamp() as usize),
                            session.id.clone(),
                            session.auth_version,
                            session.credential_version,
                            effective_deadline,
                            user.role,
                        ));
                    }
                    crate::auth::model::AuthDecision::MfaRequired { .. } => {
                        return Err(browser_error_response(
                            StatusCode::UNAUTHORIZED,
                            "mfaRequired",
                            "MFA verification required",
                        ));
                    }
                    crate::auth::model::AuthDecision::FullLoginRequired { reason } => {
                        let (status, kind) = if reason.contains("disabled") {
                            (StatusCode::FORBIDDEN, "accountDisabled")
                        } else {
                            (StatusCode::UNAUTHORIZED, "invalidSession")
                        };
                        return Err(browser_error_response(
                            status,
                            kind,
                            &format!("authentication required: {reason}"),
                        ));
                    }
                    crate::auth::model::AuthDecision::Unavailable { reason } => {
                        return Err(browser_error_response(
                            StatusCode::SERVICE_UNAVAILABLE,
                            "authUnavailable",
                            &format!("auth service unavailable: {reason}"),
                        ));
                    }
                }
            }
        }
    }

    evaluate_browser_admission(
        state,
        headers,
        connect.map(|Extension(c)| c.0),
        resolved_actor.as_ref(),
    )
    .await
    .map_err(|err| {
        let status = err.status_code();
        let kind = err.kind();
        browser_error_response(status, kind, &err.to_string())
    })
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/// GET /api/browser/capabilities
pub async fn get_capabilities(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    let caps = state
        .browser_host
        .capabilities(&admission.principal, admission.is_dev)
        .await;

    no_store_response(StatusCode::OK, serde_json::to_value(&caps).unwrap_or_default())
}

/// GET /api/browser/sessions
pub async fn list_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    let sessions = global_session_registry()
        .list_sessions(&admission.principal)
        .await;

    no_store_response(StatusCode::OK, serde_json::to_value(&sessions).unwrap_or_default())
}

/// POST /api/browser/sessions
pub async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(body): Json<CreateSessionRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    // Ensure the principal's browser instance is started or adopt running
    let (incarnation, profile_epoch) = match state
        .browser_host
        .ensure_running(&admission.principal, admission.is_dev)
        .await
    {
        Ok(handle) => (handle.browser_incarnation, handle.profile_epoch),
        Err(err) => {
            return browser_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "browserUnavailable",
                &err.to_string(),
            );
        }
    };

    match global_session_registry()
        .create_or_idempotent_get(
            &admission.principal,
            admission.is_dev,
            &incarnation,
            profile_epoch,
            &body,
            &state.cors_origins,
        )
        .await
    {
        Ok((dto, is_new)) => {
            let status = if is_new {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            no_store_response(status, serde_json::to_value(&dto).unwrap_or_default())
        }
        Err(err) => err.into(),
    }
}

/// GET /api/browser/sessions/{id}
pub async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    match global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        Ok(dto) => no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default()),
        Err(err) => err.into(),
    }
}

/// DELETE /api/browser/sessions/{id}
pub async fn delete_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    match global_session_registry()
        .delete_session(&id, &admission.principal)
        .await
    {
        Ok(()) => {
            global_attachment_manager().revoke_by_browser_session(&id).await;
            if let Some(mgr) = global_input_managers().write().await.remove(&id) {
                mgr.revoke_lease().await;
            }
            no_store_response(StatusCode::OK, json!({ "status": "closed", "browserSessionId": id }))
        }
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigateRequest {
    pub url: String,
    pub navigation_revision: u64,
}

/// POST /api/browser/sessions/{id}/navigate
pub async fn navigate_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<NavigateRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    match global_session_registry()
        .navigate(
            &id,
            &admission.principal,
            &body.url,
            body.navigation_revision,
            &state.cors_origins,
        )
        .await
    {
        Ok(dto) => {
            let input_mgr = get_or_create_input_manager(&id).await;
            input_mgr.set_selected_text("").await;
            no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default())
        }
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRequest {
    pub direction: String,
    pub navigation_revision: u64,
}

/// POST /api/browser/sessions/{id}/history
pub async fn history_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<HistoryRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    match global_session_registry()
        .history(
            &id,
            &admission.principal,
            &body.direction,
            body.navigation_revision,
        )
        .await
    {
        Ok(dto) => no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default()),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadRequest {
    pub navigation_revision: u64,
}

/// POST /api/browser/sessions/{id}/reload
pub async fn reload_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<ReloadRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    match global_session_registry()
        .reload(&id, &admission.principal, body.navigation_revision)
        .await
    {
        Ok(dto) => no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default()),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewportRequest {
    pub lease_token: String,
    pub viewport_epoch: u64,
    pub width: u32,
    pub height: u32,
    pub dpr: f64,
}

/// PUT /api/browser/sessions/{id}/viewport
pub async fn update_viewport(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateViewportRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };
    // Validate caller holds active lease
    let input_mgr = get_or_create_input_manager(&id).await;
    if let Err(err) = input_mgr.renew_lease(&body.lease_token, admission.effective_deadline).await {
        return err.into();
    }

    match global_session_registry()
        .update_viewport(
            &id,
            &admission.principal,
            body.viewport_epoch,
            body.width,
            body.height,
            body.dpr,
        )
        .await
    {
        Ok(dto) => no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default()),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireControlRequest {
    pub viewer_id: String,
    pub holder_kind: String,
}

/// POST /api/browser/sessions/{id}/control/acquire
pub async fn acquire_control(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<AcquireControlRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    // Verify session belongs to principal
    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    match input_mgr.acquire_lease(&body.viewer_id, &body.holder_kind).await {
        Ok((lease_token, expires_at_unix_ms)) => no_store_response(
            StatusCode::OK,
            json!({
                "leaseToken": lease_token,
                "expiresAtUnixMs": expires_at_unix_ms,
            }),
        ),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenewControlRequest {
    pub lease_token: String,
}

/// POST /api/browser/sessions/{id}/control/renew
pub async fn renew_control(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<RenewControlRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    match input_mgr.renew_lease(&body.lease_token, admission.effective_deadline).await {
        Ok(expires_at_unix_ms) => no_store_response(
            StatusCode::OK,
            json!({
                "leaseToken": body.lease_token,
                "expiresAtUnixMs": expires_at_unix_ms,
            }),
        ),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseControlRequest {
    pub lease_token: String,
}

/// POST /api/browser/sessions/{id}/control/release
pub async fn release_control(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<ReleaseControlRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    match input_mgr.release_lease(&body.lease_token).await {
        Ok(_) => no_store_response(StatusCode::OK, json!({ "status": "released" })),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogResponseRequest {
    pub lease_token: String,
    pub dialog_id: String,
    pub accept: bool,
    pub prompt_text: Option<String>,
}

/// POST /api/browser/sessions/{id}/dialog
pub async fn handle_dialog(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<DialogResponseRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    // Validate lease holder
    let input_mgr = get_or_create_input_manager(&id).await;
    if let Err(err) = input_mgr.renew_lease(&body.lease_token, admission.effective_deadline).await {
        return err.into();
    }

    no_store_response(StatusCode::OK, json!({ "dialogId": body.dialog_id, "status": "handled" }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionActionRequest {
    pub lease_token: String,
    pub navigation_revision: u64,
}

/// POST /api/browser/sessions/{id}/selection/start
pub async fn start_selection(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<SelectionActionRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    if let Err(err) = input_mgr.renew_lease(&body.lease_token, admission.effective_deadline).await {
        return err.into();
    }

    no_store_response(StatusCode::OK, json!({ "selectionActive": true, "navigationRevision": body.navigation_revision }))
}

/// POST /api/browser/sessions/{id}/selection/cancel
pub async fn cancel_selection(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<SelectionActionRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    if let Err(err) = input_mgr.renew_lease(&body.lease_token, admission.effective_deadline).await {
        return err.into();
    }

    no_store_response(StatusCode::OK, json!({ "selectionActive": false, "navigationRevision": body.navigation_revision }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionArtifactsRequest {
    pub selection_revision: u64,
    pub terminal_id: String,
    pub terminal_incarnation: String,
}

/// POST /api/browser/sessions/{id}/selection/artifacts
pub async fn create_selection_artifacts(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<SelectionArtifactsRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    let artifact_id = format!("browser-sel-{}", uuid::Uuid::new_v4());
    no_store_response(
        StatusCode::CREATED,
        json!({
            "artifactId": artifact_id,
            "selectionRevision": body.selection_revision,
            "terminalId": body.terminal_id,
        }),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRequest {
    pub lease_token: String,
    pub query: String,
    pub forward: bool,
}

/// POST /api/browser/sessions/{id}/find
pub async fn find_in_page(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    Json(body): Json<FindRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    if body.query.chars().count() > MAX_FIND_QUERY_CHARS {
        return browser_error_response(
            StatusCode::BAD_REQUEST,
            "queryTooLong",
            "find query exceeds maximum character limit",
        );
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    if let Err(err) = input_mgr.renew_lease(&body.lease_token, admission.effective_deadline).await {
        return err.into();
    }

    no_store_response(
        StatusCode::OK,
        json!({
            "query": body.query,
            "forward": body.forward,
            "matchCount": 0,
            "activeMatchOrdinal": 0,
        }),
    )
}

/// GET /api/browser/sessions/{id}/selected-text
pub async fn get_selected_text(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if let Err(err) = global_session_registry().get_session(&id, &admission.principal).await {
        return err.into();
    }

    let Some(lease_token) = headers.get(&X_BROWSER_LEASE).and_then(|v| v.to_str().ok()) else {
        return browser_error_response(
            StatusCode::FORBIDDEN,
            "leaseHeaderRequired",
            "X-Browser-Lease header is required for selected-text command",
        );
    };

    let input_mgr = get_or_create_input_manager(&id).await;
    match input_mgr.get_selected_text(lease_token).await {
        Ok(text) => no_store_response(StatusCode::OK, json!({ "text": text })),
        Err(err) => err.into(),
    }
}

/// POST /api/browser/attachments
pub async fn issue_attachment_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(body): Json<IssueTicketRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };
    if let Some(sid) = &body.browser_session_id {
        if global_session_registry().get_session(sid, &admission.principal).await.is_err() {
            return browser_error_response(
                StatusCode::NOT_FOUND,
                "sessionNotFound",
                "session not found or foreign principal",
            );
        }
    }
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());

    match global_attachment_manager()
        .issue_ticket(&admission, &body, origin)
        .await
    {
        Ok(resp) => no_store_response(StatusCode::OK, serde_json::to_value(&resp).unwrap_or_default()),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileResetRequest {
    pub operation_id: String,
    pub expected_profile_epoch: u64,
    pub confirmed: bool,
}

/// POST /api/browser/profile/reset
pub async fn reset_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(body): Json<ProfileResetRequest>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    if !body.confirmed {
        return browser_error_response(
            StatusCode::BAD_REQUEST,
            "confirmationRequired",
            "confirmed: true is required for profile reset",
        );
    }

    // Cancel all attachments, close sessions, and clear input managers for this principal
    global_attachment_manager().revoke_all_for_principal(&admission.principal).await;
    global_session_registry().close_principal_sessions(&admission.principal).await;
    global_input_managers().write().await.clear();
    match state
        .browser_host
        .reset_profile(
            &admission.principal,
            admission.is_dev,
            &body.operation_id,
            body.expected_profile_epoch,
        )
        .await
    {
        Ok(ResetOutcome::Completed { operation_id, new_profile_epoch }) => no_store_response(
            StatusCode::OK,
            json!({
                "operationId": operation_id,
                "status": "completed",
                "newProfileEpoch": new_profile_epoch,
            }),
        ),
        Ok(ResetOutcome::CleanupPending { operation_id, profile_epoch, reason }) => no_store_response(
            StatusCode::ACCEPTED,
            json!({
                "operationId": operation_id,
                "status": "cleanupPending",
                "profileEpoch": profile_epoch,
                "reason": reason,
            }),
        ),
        Err(err) => browser_error_response(StatusCode::CONFLICT, "resetFailed", &err.to_string()),
    }
}

/// GET /api/browser/profile/reset/{operationId}
pub async fn get_profile_reset_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(operation_id): Path<String>,
) -> Response {
    let admission = match authenticate_browser_caller(
        &state,
        &headers,
        connect.as_ref(),
        actor.as_ref().map(|Extension(a)| a),
    )
    .await
    {
        Ok(adm) => adm,
        Err(resp) => return resp,
    };

    let caps = state
        .browser_host
        .capabilities(&admission.principal, admission.is_dev)
        .await;

    no_store_response(
        StatusCode::OK,
        json!({
            "operationId": operation_id,
            "status": if caps.available { "completed" } else { "cleanupPending" },
            "profileEpoch": caps.profile_epoch,
        }),
    )
}

pub use crate::browser_host::cdp_gateway::{
    cdp_ws_handler, cdp_ws_handler_target, get_cdp_json_alias, get_cdp_list, get_cdp_version,
};
