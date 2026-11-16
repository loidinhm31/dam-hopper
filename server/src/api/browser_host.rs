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
use crate::browser_host::attachments::{AttachmentError, AttachmentManager, IssueTicketRequest};
use crate::browser_host::auth::{
    evaluate_browser_admission, validate_request_origin, BrowserAdmission,
};
use crate::browser_host::input::{InputError, SessionInputManager, MAX_FIND_QUERY_CHARS};
use crate::browser_host::manager::{
    AdminRecheckCallback, FenceCallback, ManagerError, ResetFenceHooks, ResetOutcome, ResetStatus,
    DEFAULT_RESET_WAIT_TIMEOUT,
};
use crate::browser_host::network_policy::NetworkPolicy;
use crate::browser_host::selection::{self, InspectPoint, SelectionError};
use crate::browser_host::session::{
    BrowserSessionDto, CreateSessionRequest, SessionError, SessionRegistry, ViewportQueueOutcome,
    ViewportRequest,
};
use crate::state::AppState;
fn selection_error_to_response(err: SelectionError) -> Response {
    match err {
        SelectionError::Session(e) => e.into(),
        SelectionError::Artifact(e) => {
            let status = StatusCode::from_u16(e.status_code()).unwrap_or(StatusCode::BAD_REQUEST);
            let kind = match e {
                crate::browser_debug::BrowserDebugError::IncarnationMismatch => {
                    "TERMINAL_INCARNATION_MISMATCH"
                }
                crate::browser_debug::BrowserDebugError::NotFound => "notFound",
                crate::browser_debug::BrowserDebugError::TooLarge => "tooLarge",
                _ => "artifactError",
            };
            browser_error_response(status, kind, &e.to_string())
        }
        SelectionError::Conflict(msg) => {
            browser_error_response(StatusCode::CONFLICT, "conflict", &msg)
        }
        SelectionError::TerminalNotFound => browser_error_response(
            StatusCode::NOT_FOUND,
            "terminalNotFound",
            "terminal not found",
        ),
        SelectionError::TerminalIncarnationMismatch => browser_error_response(
            StatusCode::CONFLICT,
            "TERMINAL_INCARNATION_MISMATCH",
            "selected terminal incarnation mismatch",
        ),
        SelectionError::NoSelection(msg) => {
            browser_error_response(StatusCode::CONFLICT, "noSelection", &msg)
        }
        SelectionError::Cdp(msg) => {
            browser_error_response(StatusCode::BAD_GATEWAY, "cdpError", &msg)
        }
    }
}
pub const X_BROWSER_LEASE: HeaderName = HeaderName::from_static("x-browser-lease");
pub static GLOBAL_SESSION_REGISTRY: LazyLock<SessionRegistry> = LazyLock::new(SessionRegistry::new);
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

pub fn global_input_managers(
) -> &'static RwLock<std::collections::HashMap<String, Arc<SessionInputManager>>> {
    &GLOBAL_INPUT_MANAGERS
}

pub async fn get_or_create_input_manager(session_id: &str) -> Arc<SessionInputManager> {
    let mut map = global_input_managers().write().await;
    map.entry(session_id.to_string())
        .or_insert_with(|| SessionInputManager::new_shared(crate::browser_host::input::LEASE_TTL))
        .clone()
}
fn register_selection_lease_end_hook(
    input_mgr: &SessionInputManager,
    state: &AppState,
    session_id: &str,
    principal: &str,
) {
    let state = state.clone();
    let session_id = session_id.to_string();
    let principal = principal.to_string();
    input_mgr.set_lease_end_hook(Arc::new(move |ended_epoch| {
        let state = state.clone();
        let session_id = session_id.clone();
        let principal = principal.clone();
        Box::pin(async move {
            selection::clear_selection_on_lease_end(&state, &session_id, &principal, ended_epoch)
                .await;
        })
    }));
}


pub(crate) fn no_store_response(status: StatusCode, json_val: serde_json::Value) -> Response {
    let mut resp = (status, Json(json_val)).into_response();
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

pub(crate) fn browser_error_response(
    status: StatusCode,
    kind: &'static str,
    message: &str,
) -> Response {
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
            SessionError::NotFound => browser_error_response(
                StatusCode::NOT_FOUND,
                "sessionNotFound",
                "browser session not found",
            ),
            SessionError::Forbidden => browser_error_response(
                StatusCode::FORBIDDEN,
                "forbidden",
                "access to browser session is forbidden",
            ),
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
            SessionError::NativeUnavailable(msg) => {
                browser_error_response(StatusCode::BAD_GATEWAY, "nativeTargetUnavailable", &msg)
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
            AttachmentError::TicketNotFound => browser_error_response(
                StatusCode::UNAUTHORIZED,
                "ticketNotFound",
                "attachment ticket not found or already consumed",
            ),
            AttachmentError::TicketExpired => browser_error_response(
                StatusCode::UNAUTHORIZED,
                "ticketExpired",
                "attachment ticket has expired",
            ),
            AttachmentError::PurposeMismatch { .. } => {
                browser_error_response(StatusCode::BAD_REQUEST, "purposeMismatch", &err.to_string())
            }
            AttachmentError::OriginMismatch { .. } => {
                browser_error_response(StatusCode::FORBIDDEN, "originMismatch", &err.to_string())
            }
            AttachmentError::CapacityExceeded(msg) => browser_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "ticketCapacityExceeded",
                &msg,
            ),
            AttachmentError::ViewerCapacityExceeded(max) => browser_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "browserBusy",
                &format!("global active viewer capacity reached ({max})"),
            ),
            _ => {
                browser_error_response(StatusCode::BAD_REQUEST, "attachmentError", &err.to_string())
            }
        }
    }
}

impl From<InputError> for Response {
    fn from(err: InputError) -> Self {
        match err {
            InputError::LeaseNotFound => browser_error_response(
                StatusCode::FORBIDDEN,
                "leaseNotFound",
                "no active control lease",
            ),
            InputError::LeaseExpired => browser_error_response(
                StatusCode::FORBIDDEN,
                "leaseExpired",
                "control lease has expired",
            ),
            InputError::LeaseConflict(msg) => {
                browser_error_response(StatusCode::CONFLICT, "leaseConflict", &msg)
            }
            InputError::NotLeaseHolder => browser_error_response(
                StatusCode::FORBIDDEN,
                "notLeaseHolder",
                "caller does not hold control lease",
            ),
            InputError::StaleViewportEpoch { .. } => {
                browser_error_response(StatusCode::CONFLICT, "staleViewportEpoch", &err.to_string())
            }
            InputError::SequenceGap { .. } | InputError::StaleSequence { .. } => {
                browser_error_response(
                    StatusCode::BAD_REQUEST,
                    "sequenceViolation",
                    &err.to_string(),
                )
            }
            InputError::QueueOverflow => browser_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "queueOverflow",
                "input queue limit exceeded",
            ),
            InputError::GeometryUnavailable => browser_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "inputUnavailable",
                "geometry unavailable",
            ),
            InputError::ReleaseFailed(msg) => {
                browser_error_response(StatusCode::SERVICE_UNAVAILABLE, "inputUnavailable", &msg)
            }
            InputError::InvalidFraction { .. } => browser_error_response(
                StatusCode::BAD_REQUEST,
                "invalidCoordinates",
                &err.to_string(),
            ),
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
        let token_opt = if headers.contains_key(header::AUTHORIZATION) {
            crate::api::auth::extract_bearer_token(headers).map(str::to_string)
        } else {
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|c_str| {
                    for part in c_str.split(';') {
                        let trimmed = part.trim();
                        if let Some(val) =
                            trimmed.strip_prefix(&format!("{}=", crate::api::auth::AUTH_COOKIE))
                        {
                            return Some(val.to_string());
                        }
                    }
                    None
                })
        };
        if let Some(token) = token_opt {
            if let Some(claims) = crate::auth::model::AuthClaims::decode(&token, &state.jwt_secret)
            {
                match state.auth_service.evaluate_claims(&claims).await {
                    crate::auth::model::AuthDecision::Authenticated { session, user } => {
                        let expires_at = crate::auth::model::bson_to_chrono(session.expires_at);
                        let mfa_verified_at =
                            crate::auth::model::bson_to_chrono(session.mfa_verified_at);
                        let effective_deadline =
                            crate::auth::compute_mfa_due_at(mfa_verified_at, expires_at);
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

/// Applies the full configured Browser request policy (target/asset origins and denied
/// destinations, not CORS origins) before a navigation reaches the session registry.
fn prevalidate_navigation(state: &AppState, is_dev: bool, url: &str) -> Result<(), SessionError> {
    let policy = NetworkPolicy::from_config(state.browser_host.config(), is_dev)?;
    policy.validate_navigation(url)?;
    Ok(())
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

    no_store_response(
        StatusCode::OK,
        serde_json::to_value(&caps).unwrap_or_default(),
    )
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

    no_store_response(
        StatusCode::OK,
        serde_json::to_value(&sessions).unwrap_or_default(),
    )
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

    if let Err(err) = prevalidate_navigation(&state, admission.is_dev, &body.url) {
        return err.into();
    }

    // Ensure the principal's browser instance is started or adopt running
    let handle = match state
        .browser_host
        .ensure_running(&admission.principal, admission.is_dev)
        .await
    {
        Ok(handle) => handle,
        Err(err) => {
            return browser_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "browserUnavailable",
                &err.to_string(),
            );
        }
    };

    match crate::browser_host::media::create_native_session(&state, &admission, &handle, &body)
        .await
    {
        Ok((dto, created)) => {
            let status = if created {
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
        Ok(dto) => {
            let mut val = serde_json::to_value(&dto).unwrap_or_default();
            let nav_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false).unwrap_or(0);
            if let Some(summary) =
                selection::get_selection_summary(&id, &admission.principal, nav_rev).await
            {
                if let Some(obj) = val.as_object_mut() {
                    obj.insert(
                        "selection".to_string(),
                        serde_json::to_value(&summary).unwrap_or_default(),
                    );
                }
            }
            no_store_response(StatusCode::OK, val)
        }
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

    match crate::browser_host::media::close_native_session(&state, &id, &admission.principal).await
    {
        Ok(()) => no_store_response(
            StatusCode::OK,
            json!({ "status": "closed", "browserSessionId": id }),
        ),
        Err(SessionError::NativeUnavailable(msg)) => no_store_response(
            StatusCode::BAD_GATEWAY,
            json!({
                "error": msg,
                "kind": "nativeCloseUnconfirmed",
                "status": "closing",
                "browserSessionId": id,
            }),
        ),
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigateRequest {
    pub url: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
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

    if let Err(err) = prevalidate_navigation(&state, admission.is_dev, &body.url) {
        return err.into();
    }

    match selection::fence_registry_navigation(
        &state,
        &id,
        global_session_registry().navigate(
            &id,
            &admission.principal,
            &body.url,
            body.navigation_revision,
            &state.browser_host.config().allowed_target_origins,
        ),
        |dto| crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false),
    )
    .await
    {
        Ok(dto) => {
            let input_mgr = get_or_create_input_manager(&id).await;
            input_mgr.set_selected_text("").await;
            if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
                let parsed_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false);
                if let Some(rev) = parsed_rev {
                    prod.request_audio_doc_epoch(rev);
                }
                global_session_registry()
                    .mark_api_navigation_pending(&id)
                    .await;
                if let Ok(page_sid) = prod.ensure_page_session().await {
                    let _ = if let Some(rev) = parsed_rev {
                        prod.dispatch_navigation_for_epoch(
                            rev,
                            "Page.navigate",
                            Some(json!({ "url": dto.url })),
                            &page_sid,
                        )
                        .await
                    } else {
                        prod.cdp_client
                            .send_command(
                                "Page.navigate",
                                Some(json!({ "url": dto.url })),
                                Some(&page_sid),
                            )
                            .await
                    };
                }
            }
            no_store_response(
                StatusCode::OK,
                serde_json::to_value(&dto).unwrap_or_default(),
            )
        }
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRequest {
    pub direction: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
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

    match selection::fence_registry_navigation(
        &state,
        &id,
        global_session_registry().history(
            &id,
            &admission.principal,
            &body.direction,
            body.navigation_revision,
        ),
        |dto| crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false),
    )
    .await
    {
        Ok(dto) => {
            if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
                let parsed_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false);
                let mut dispatched = false;
                if let Ok(page_sid) = prod.ensure_page_session().await {
                    if let Ok(hist) = prod
                        .cdp_client
                        .send_command("Page.getNavigationHistory", None, Some(&page_sid))
                        .await
                    {
                        if let (Some(idx), Some(entries)) = (
                            hist.get("currentIndex").and_then(|v| v.as_i64()),
                            hist.get("entries").and_then(|v| v.as_array()),
                        ) {
                            let target_idx = if body.direction == "back" {
                                idx - 1
                            } else {
                                idx + 1
                            };
                            if target_idx >= 0 && (target_idx as usize) < entries.len() {
                                let entry_url = entries[target_idx as usize]
                                    .get("url")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string);
                                if let Some(entry_id) = entries[target_idx as usize]
                                    .get("id")
                                    .and_then(|v| v.as_i64())
                                {
                                    if let Some(rev) = parsed_rev {
                                        prod.request_audio_doc_epoch(rev);
                                    }
                                    global_session_registry()
                                        .mark_api_navigation_pending(&id)
                                        .await;
                                    dispatched = true;
                                    let _ = if let Some(rev) = parsed_rev {
                                        prod.dispatch_navigation_for_epoch_with_url(
                                            rev,
                                            "Page.navigateToHistoryEntry",
                                            Some(json!({ "entryId": entry_id })),
                                            &page_sid,
                                            entry_url.as_deref(),
                                        )
                                        .await
                                    } else {
                                        prod.cdp_client
                                            .send_command(
                                                "Page.navigateToHistoryEntry",
                                                Some(json!({ "entryId": entry_id })),
                                                Some(&page_sid),
                                            )
                                            .await
                                    };
                                }
                            }
                        }
                    }
                }
                if !dispatched {
                    if let Some(rev) = parsed_rev {
                        prod.resolve_noop_audio_doc_epoch(rev);
                    }
                }
            }
            no_store_response(
                StatusCode::OK,
                serde_json::to_value(&dto).unwrap_or_default(),
            )
        }
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadRequest {
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
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

    match selection::fence_registry_navigation(
        &state,
        &id,
        global_session_registry().reload(&id, &admission.principal, body.navigation_revision),
        |dto| crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false),
    )
    .await
    {
        Ok(dto) => {
            if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
                let parsed_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false);
                if let Some(rev) = parsed_rev {
                    prod.request_audio_doc_epoch(rev);
                }
                global_session_registry()
                    .mark_api_navigation_pending(&id)
                    .await;
                if let Ok(page_sid) = prod.ensure_page_session().await {
                    let _ = if let Some(rev) = parsed_rev {
                        prod.dispatch_navigation_for_epoch(rev, "Page.reload", None, &page_sid)
                            .await
                    } else {
                        prod.cdp_client
                            .send_command("Page.reload", None, Some(&page_sid))
                            .await
                    };
                }
            }
            no_store_response(
                StatusCode::OK,
                serde_json::to_value(&dto).unwrap_or_default(),
            )
        }
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewportRequest {
    pub lease_token: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
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
    if let Err(err) = input_mgr
        .renew_lease(&body.lease_token, admission.effective_deadline)
        .await
    {
        return err.into();
    }

    let registry = global_session_registry();
    let initial = match registry
        .begin_viewport_transaction(
            &id,
            &admission.principal,
            Some(body.viewport_epoch),
            body.width,
            body.height,
            body.dpr,
        )
        .await
    {
        Ok(Ok(noop_dto)) => {
            return no_store_response(
                StatusCode::OK,
                serde_json::to_value(&noop_dto).unwrap_or_default(),
            );
        }
        Ok(Err(outcome)) => outcome,
        Err(err) => return err.into(),
    };

    match initial {
        ViewportQueueOutcome::Follower(rx) => match rx.await {
            Ok(Ok(dto)) => no_store_response(
                StatusCode::OK,
                serde_json::to_value(&dto).unwrap_or_default(),
            ),
            Ok(Err(err)) => err.into(),
            Err(_) => SessionError::Internal("viewport transaction cancelled".to_string()).into(),
        },
        ViewportQueueOutcome::Leader {
            request: first_req,
            spacing_wait: first_wait,
        } => {
            if !first_wait.is_zero() {
                tokio::time::sleep(first_wait).await;
            }
            if let Err(_) = input_mgr.validate_lease(&body.lease_token).await {
                let lease_err = SessionError::Conflict("control lease revoked".to_string());
                global_session_registry()
                    .abort_viewport_coalescer(&id, lease_err.clone())
                    .await;
                return lease_err.into();
            }
            let first_res = apply_single_viewport_step(
                &id,
                &admission.principal,
                Some(body.viewport_epoch),
                first_req,
                &input_mgr,
            )
            .await;

            // Drain any coalesced pending slot in a background/inline loop so superseded HTTP
            // callers receive the authoritative applied result after the 100ms spacing window.
            let session_id = id.clone();
            let principal = admission.principal.clone();
            let mgr_clone = input_mgr.clone();
            let lease_token = body.lease_token.clone();
            tokio::spawn(async move {
                loop {
                    let next = global_session_registry()
                        .take_next_coalesced_viewport(&session_id)
                        .await;
                    let Some((next_req, mut waiters, wait_dur)) = next else {
                        break;
                    };
                    if !wait_dur.is_zero() {
                        tokio::time::sleep(wait_dur).await;
                    }
                    if let Err(_) = mgr_clone.validate_lease(&lease_token).await {
                        let lease_err = SessionError::Conflict("control lease revoked".to_string());
                        for waiter in waiters.drain(..) {
                            let _ = waiter.send(Err(lease_err.clone()));
                        }
                        global_session_registry()
                            .abort_viewport_coalescer(&session_id, lease_err)
                            .await;
                        break;
                    }
                    let step_res = apply_single_viewport_step(
                        &session_id,
                        &principal,
                        None,
                        next_req,
                        &mgr_clone,
                    )
                    .await;
                    for waiter in waiters.drain(..) {
                        let _ = waiter.send(step_res.clone());
                    }
                }
            });

            match first_res {
                Ok(dto) => no_store_response(
                    StatusCode::OK,
                    serde_json::to_value(&dto).unwrap_or_default(),
                ),
                Err(err) => err.into(),
            }
        }
    }
}

async fn apply_single_viewport_step(
    session_id: &str,
    principal: &str,
    expected_viewport_epoch: Option<u64>,
    sanitized: ViewportRequest,
    input_mgr: &Arc<SessionInputManager>,
) -> Result<BrowserSessionDto, SessionError> {
    let (dto, changed, prev_geom, prev_epoch) = global_session_registry()
        .apply_sanitized_viewport(session_id, principal, expected_viewport_epoch, sanitized.clone())
        .await?;
    if !changed {
        return Ok(dto);
    }
    let applied_epoch =
        crate::browser_host::decimal_counter::parse_canonical_u64(&dto.viewport_epoch, false)
            .ok_or_else(|| SessionError::Internal("registry produced a non-canonical viewportEpoch".to_string()))?;
    // Old-epoch input is rejected from here on, before any native command or cache swap.
    input_mgr.set_expected_viewport_epoch(applied_epoch).await;
    if let Some(prod) = crate::browser_host::media::get_producer(session_id).await {
        let new_geom = crate::browser_host::protocol::TargetGeometry {
            css_width: sanitized.width as f64,
            css_height: sanitized.height as f64,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: sanitized.dpr,
        };
        if let Err(err) = prod.update_geometry(new_geom, applied_epoch).await {
            global_session_registry()
                .rollback_viewport(session_id, prev_geom, prev_epoch)
                .await;
            input_mgr.set_expected_viewport_epoch(prev_epoch).await;
            return Err(SessionError::NativeUnavailable(format!(
                "failed to apply native viewport geometry: {err}"
            )));
        }
    }
    Ok(dto)
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
    if let Err(err) = global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    match input_mgr
        .acquire_lease(&body.viewer_id, &body.holder_kind)
        .await
    {
        Ok((lease_token, expires_at_unix_ms)) => {
            register_selection_lease_end_hook(&input_mgr, &state, &id, &admission.principal);
            no_store_response(
                StatusCode::OK,
                json!({
                    "leaseToken": lease_token,
                    "expiresAtUnixMs": expires_at_unix_ms,
                }),
            )
        }
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

    if let Err(err) = global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    match input_mgr
        .renew_lease(&body.lease_token, admission.effective_deadline)
        .await
    {
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

    if let Err(err) = global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    match input_mgr.release_lease(&body.lease_token).await {
        Ok(ended_epoch) => {
            if let Some(ended_epoch) = ended_epoch {
                selection::clear_selection_on_lease_end(
                    &state,
                    &id,
                    &admission.principal,
                    ended_epoch,
                )
                .await;
            }
            no_store_response(StatusCode::OK, json!({ "status": "released" }))
        }
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

    if let Err(err) = global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        return err.into();
    }

    // Validate lease holder
    let input_mgr = get_or_create_input_manager(&id).await;
    if let Err(err) = input_mgr
        .renew_lease(&body.lease_token, admission.effective_deadline)
        .await
    {
        return err.into();
    }

    no_store_response(
        StatusCode::OK,
        json!({ "dialogId": body.dialog_id, "status": "handled" }),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionActionRequest {
    pub lease_token: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
    pub navigation_revision: u64,
    #[serde(default)]
    pub inspect_point: Option<InspectPoint>,
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

    if let Err(err) = global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    let (_, lease_epoch) = match input_mgr
        .renew_lease_with_epoch(&body.lease_token, admission.effective_deadline)
        .await
    {
        Ok(v) => v,
        Err(err) => return err.into(),
    };
    register_selection_lease_end_hook(&input_mgr, &state, &id, &admission.principal);

    match selection::start_selection(
        &state,
        &id,
        &admission.principal,
        admission.is_dev,
        body.navigation_revision,
        body.inspect_point,
        &input_mgr,
        lease_epoch,
    )
    .await
    {
        Ok(summary) => no_store_response(
            StatusCode::OK,
            json!({
                "selectionActive": summary.active,
                "navigationRevision": summary.navigation_revision.to_string(),
                "selectionRevision": summary.selection_revision.to_string(),
                "preview": summary.preview,
            }),
        ),
        Err(err) => selection_error_to_response(err),
    }
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

    if let Err(err) = global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        return err.into();
    }

    let input_mgr = get_or_create_input_manager(&id).await;
    if let Err(err) = input_mgr
        .renew_lease(&body.lease_token, admission.effective_deadline)
        .await
    {
        return err.into();
    }

    match selection::cancel_selection(&state, &id, &admission.principal, body.navigation_revision)
        .await
    {
        Ok(summary) => no_store_response(
            StatusCode::OK,
            json!({
                "selectionActive": summary.active,
                "navigationRevision": summary.navigation_revision.to_string(),
                "selectionRevision": summary.selection_revision.to_string(),
            }),
        ),
        Err(err) => selection_error_to_response(err),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionArtifactsRequest {
    #[serde(with = "crate::browser_host::decimal_counter::nonneg")]
    pub selection_revision: u64,
    pub terminal_id: String,
    #[serde(with = "crate::browser_host::decimal_counter::nonneg")]
    pub terminal_incarnation: u64,
    #[serde(default, with = "crate::browser_host::decimal_counter::positive_opt")]
    pub navigation_revision: Option<u64>,
    #[serde(default)]
    pub include_png: Option<bool>,
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

    let resolved_actor = if let Some(Extension(a)) = actor {
        a
    } else if admission.is_dev {
        AuthenticatedActor::dev_user()
    } else {
        AuthenticatedActor {
            subject: admission.principal.clone(),
            exp: None,
            session_id: admission.session_id.clone(),
            auth_version: admission.auth_version,
            credential_version: admission.credential_version,
            effective_deadline: admission.effective_deadline,
            role: Some(crate::auth::model::UserRole::Admin),
        }
    };

    match selection::create_managed_selection_artifact(
        &state,
        &id,
        &admission,
        &resolved_actor,
        body.selection_revision,
        body.navigation_revision,
        body.terminal_id,
        body.terminal_incarnation,
        body.include_png,
    )
    .await
    {
        Ok(result) => no_store_response(
            StatusCode::CREATED,
            serde_json::to_value(&result).unwrap_or_default(),
        ),
        Err(err) => selection_error_to_response(err),
    }
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

    if let Err(err) = global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
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
    if let Err(err) = input_mgr
        .renew_lease(&body.lease_token, admission.effective_deadline)
        .await
    {
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

    let initial_dto = match global_session_registry()
        .get_session(&id, &admission.principal)
        .await
    {
        Ok(dto) => dto,
        Err(err) => return err.into(),
    };
    let initial_authority = (
        initial_dto.navigation_revision.clone(),
        initial_dto.browser_incarnation.clone(),
        initial_dto.profile_epoch.clone(),
    );

    let Some(lease_token) = headers.get(&X_BROWSER_LEASE).and_then(|v| v.to_str().ok()) else {
        return browser_error_response(
            StatusCode::FORBIDDEN,
            "leaseHeaderRequired",
            "X-Browser-Lease header is required for selected-text command",
        );
    };

    let input_mgr = get_or_create_input_manager(&id).await;
    let initial_lease_epoch = match input_mgr.validate_lease_epoch(lease_token).await {
        Ok(ep) => ep,
        Err(err) => return err.into(),
    };
    let mut text = match input_mgr.get_selected_text(lease_token).await {
        Ok(cached) => cached,
        Err(err) => return err.into(),
    };

    if initial_dto.status == "running" {
        if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
            const SELECTED_TEXT_JS: &str = r#"(() => {
  const MAX_CU = 65536;
  const bound = (str) => {
    if (str.length <= MAX_CU) return str;
    let end = MAX_CU;
    const code = str.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    return str.slice(0, end);
  };
  try {
    const active = document.activeElement;
    if (active && active.tagName === 'INPUT' && (active.type || '').toLowerCase() === 'password') {
      return '';
    }
    const sel = window.getSelection();
    const s = sel ? sel.toString() : '';
    if (s) {
      return bound(s);
    }
    if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && (active.type || '').toLowerCase() !== 'password'))) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start && typeof active.value === 'string') {
        let sliceEnd = Math.min(end, start + MAX_CU);
        if (sliceEnd < end) {
          const code = active.value.charCodeAt(sliceEnd - 1);
          if (code >= 0xd800 && code <= 0xdbff) sliceEnd -= 1;
        }
        return active.value.slice(start, sliceEnd);
      }
    }
    return '';
  } catch (_) {
    return '';
  }
})()"#;

            let eval_result = if let Ok(Ok(page_sid)) = tokio::time::timeout(
                std::time::Duration::from_secs(1),
                prod.ensure_page_session(),
            )
            .await
            {
                tokio::time::timeout(
                    std::time::Duration::from_secs(1),
                    prod.cdp_client.send_command(
                        "Runtime.evaluate",
                        Some(json!({
                            "expression": SELECTED_TEXT_JS,
                            "returnByValue": true,
                        })),
                        Some(&page_sid),
                    ),
                )
                .await
                .ok()
                .and_then(|res| res.ok())
            } else {
                None
            };

            // Revalidate session authority and lease after CDP await before caching/returning.
            let current_dto = match global_session_registry()
                .get_session(&id, &admission.principal)
                .await
            {
                Ok(dto) => dto,
                Err(err) => return err.into(),
            };
            if current_dto.status != "running"
                || (
                    current_dto.navigation_revision,
                    current_dto.browser_incarnation,
                    current_dto.profile_epoch,
                ) != initial_authority
            {
                return browser_error_response(
                    StatusCode::CONFLICT,
                    "sessionConflict",
                    "session authority changed during selected-text read",
                );
            }
            match input_mgr.validate_lease_epoch(lease_token).await {
                Ok(ep) if ep == initial_lease_epoch => {}
                Ok(_) => return InputError::NotLeaseHolder.into(),
                Err(err) => return err.into(),
            }

            if let Some(val) = eval_result {
                if let Some(live_text) = val.pointer("/result/value").and_then(|v| v.as_str()) {
                    text = input_mgr.set_selected_text(live_text).await;
                }
            }
        }
    }

    no_store_response(StatusCode::OK, json!({ "text": text }))
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
        // Issue authority is the live session identity: `Running`, same owner and mode, and
        // the exact profile epoch + incarnation the ticket claims.
        if let Err(err) = global_session_registry()
            .verify_attachment_identity(
                sid,
                &admission.principal,
                admission.is_dev,
                body.profile_epoch,
                &body.browser_incarnation,
            )
            .await
        {
            return match err {
                SessionError::NotFound => browser_error_response(
                    StatusCode::NOT_FOUND,
                    "sessionNotFound",
                    "session not found, stale identity or foreign principal",
                ),
                other => other.into(),
            };
        }
    }
    let origin = match validate_request_origin(&state, &headers) {
        Ok(origin) => origin,
        Err(err) => {
            return browser_error_response(
                StatusCode::FORBIDDEN,
                "forbiddenOrigin",
                &err.to_string(),
            )
        }
    };

    match global_attachment_manager()
        .issue_ticket(&admission, &body, origin.as_deref())
        .await
    {
        Ok(resp) => no_store_response(
            StatusCode::OK,
            serde_json::to_value(&resp).unwrap_or_default(),
        ),
        Err(err) => err.into(),
    }
}

pub(crate) fn is_valid_reset_operation_id(op_id: &str) -> bool {
    let trimmed = op_id.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 128
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn validate_destructive_browser_csrf(
    state: &AppState,
    headers: &HeaderMap,
    has_bearer_auth: bool,
) -> bool {
    if headers.contains_key(header::ORIGIN) {
        // Exact approved-origin policy shared with admission; never Host-derived same-origin.
        return validate_request_origin(state, headers).is_ok();
    }

    if state.no_auth {
        true
    } else {
        has_bearer_auth
    }
}

/// Revokes the Browser resources tied to one login (`auth_session_id`). The revocation is first
/// published synchronously to the artifact store, so a managed handoff already waiting for the
/// PTY mutation lock is denied there without any further I/O.
pub(crate) async fn revoke_auth_session_browser_resources(
    state: &AppState,
    principal: &str,
    auth_session_id: &str,
) {
    state.browser_debug_artifacts.publish_revocation(principal);
    crate::browser_host::devtools::global_devtools_leases()
        .revoke_by_auth_session(principal, auth_session_id)
        .await;
    let cancelled = global_attachment_manager()
        .revoke_by_auth_session(principal, auth_session_id)
        .await;
    if cancelled.is_empty() {
        return;
    }
    let holders: Vec<(Arc<SessionInputManager>, String)> = {
        let managers = global_input_managers().read().await;
        cancelled
            .into_iter()
            .filter_map(|(browser_session_id, viewer_id)| {
                managers
                    .get(&browser_session_id)
                    .cloned()
                    .map(|mgr| (mgr, viewer_id))
            })
            .collect()
    };
    // The map lock is released: each revoke awaits its native key/button release.
    for (mgr, viewer_id) in holders {
        if let Err(err) = mgr.revoke_lease_if_holder(&viewer_id).await {
            tracing::warn!(error = %err, "auth revoke: native input release failed");
        }
    }
}

/// Pure in-memory fence with zero disk or network I/O; returns the closed browser session ids.
/// Fenced managed artifacts stay charged in the store's retryable pending-cleanup set until
/// their private files are really gone ([`purge_principal_artifacts`]).
pub(crate) async fn fence_principal_browser_resources_sync(
    state: &AppState,
    principal: &str,
) -> Vec<String> {
    crate::browser_host::devtools::global_devtools_leases()
        .revoke_all_for_principal(principal)
        .await;
    global_attachment_manager()
        .revoke_all_for_principal(principal)
        .await;
    let closed_session_ids = global_session_registry()
        .close_principal_sessions(principal)
        .await;
    {
        // In-memory only: no further input is accepted. The native release (browser I/O) is
        // done by `teardown_principal_network_resources`, which keeps the managers until then.
        let input_map = global_input_managers().read().await;
        for session_id in &closed_session_ids {
            if let Some(mgr) = input_map.get(session_id) {
                mgr.fence_lease().await;
            }
        }
    }
    let pending_sel_ids = selection::fence_principal_sessions_in_memory(principal).await;
    state
        .browser_debug_artifacts
        .fence_managed_by_principal_and_ids(principal, None, &pending_sel_ids)
        .await;
    closed_session_ids
}

/// One purge attempt of every retained private artifact file of `principal`. Fails while any
/// file remains (the quota stays charged and a later attempt retries).
pub(crate) async fn purge_principal_artifacts(
    state: &AppState,
    principal: &str,
) -> Result<(), crate::browser_debug::BrowserDebugError> {
    state
        .browser_debug_artifacts
        .retry_pending_cleanups(Some(principal))
        .await
}

/// Retries the artifact purge with bounded backoff until no private file remains. Reset
/// completion is claimed only after this returns, so a denied unlink keeps the reset
/// cleanup-pending instead of reporting completion with files left behind.
pub(crate) async fn purge_principal_artifacts_until_clean(state: &AppState, principal: &str) {
    let mut delay = std::time::Duration::from_millis(50);
    while let Err(error) = purge_principal_artifacts(state, principal).await {
        tracing::warn!(principal, error = %error, "browser artifact purge incomplete; retrying");
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(std::time::Duration::from_secs(2));
    }
}

pub(crate) async fn teardown_principal_network_resources(session_ids: Vec<String>) {
    for sid in session_ids {
        // Native keyup/mouseup first, while the producer's CDP connection is still alive.
        release_session_input(&sid).await;
        remove_producer(&sid).await;
    }
}

/// Retires every non-native resource of a session that left the live set (native loss, crash,
/// failed adoption): viewer tickets/sockets, input lease and the producer.
pub(crate) async fn retire_session_native_resources(session_id: &str) {
    release_session_viewers(session_id).await;
    remove_producer(session_id).await;
}

/// Revokes the viewer tickets, attachments and control lease of a session, keeping its producer.
pub(crate) async fn release_session_viewers(session_id: &str) {
    // Held native keys/buttons are released BEFORE sockets and producer go away.
    release_session_input(session_id).await;
    crate::browser_host::devtools::global_devtools_leases()
        .revoke_by_browser_session(session_id)
        .await;
    global_attachment_manager()
        .revoke_by_browser_session(session_id)
        .await;
}

/// Ends the session's control lease with a native release on the captured identity and drops
/// its input manager. A failed release is logged (the session is going away).
async fn release_session_input(session_id: &str) {
    let manager = global_input_managers().write().await.remove(session_id);
    if let Some(mgr) = manager {
        if let Err(err) = mgr.revoke_lease().await {
            tracing::warn!(session_id, error = %err, "session end: native input release failed");
        }
    }
}

/// Revokes every Browser resource of `principal`. Fails (after finishing the network teardown)
/// while any private artifact file could not be removed, so callers never report a completed
/// purge with files left behind.
pub(crate) async fn revoke_principal_browser_resources(
    state: &AppState,
    principal: &str,
) -> Result<(), crate::browser_debug::BrowserDebugError> {
    let session_ids = fence_principal_browser_resources_sync(state, principal).await;
    let purged = purge_principal_artifacts(state, principal).await;
    teardown_principal_network_resources(session_ids).await;
    purged
}

pub(crate) fn make_reset_fence_hooks(
    state: AppState,
    principal: String,
    recheck_admin: Option<AdminRecheckCallback>,
) -> ResetFenceHooks {
    let pending: Arc<tokio::sync::Mutex<Vec<String>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));

    let sync_state = state.clone();
    let sync_principal = principal.clone();
    let sync_slot = pending.clone();
    let sync_fence: FenceCallback = Arc::new(move || {
        let state = sync_state.clone();
        let principal = sync_principal.clone();
        let slot = sync_slot.clone();
        Box::pin(async move {
            let sids = fence_principal_browser_resources_sync(&state, &principal).await;
            *slot.lock().await = sids;
        })
    });

    let async_slot = pending;
    let async_principal = principal;
    let async_state = state;
    let async_teardown: FenceCallback = Arc::new(move || {
        let slot = async_slot.clone();
        let principal = async_principal.clone();
        let state = async_state.clone();
        Box::pin(async move {
            let sids = std::mem::take(&mut *slot.lock().await);
            // Purge fenced managed artifacts BEFORE bounded network teardown and BEFORE profile
            // user-data deletion; a denied unlink keeps the reset pending until it succeeds.
            let purged = purge_principal_artifacts(&state, &principal).await;
            let _ = tokio::time::timeout(
                DEFAULT_RESET_WAIT_TIMEOUT,
                teardown_principal_network_resources(sids),
            )
            .await;
            if purged.is_err() {
                purge_principal_artifacts_until_clean(&state, &principal).await;
            }
        })
    });

    ResetFenceHooks {
        recheck_admin,
        sync_fence: Some(sync_fence),
        async_teardown: Some(async_teardown),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileResetRequest {
    pub operation_id: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
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

    let has_bearer = crate::api::auth::extract_bearer_token(&headers).is_some();
    if !validate_destructive_browser_csrf(&state, &headers, has_bearer) {
        return browser_error_response(
            StatusCode::FORBIDDEN,
            "forbiddenOrigin",
            "destructive browser profile reset requires an allowed Origin or explicit Bearer authentication",
        );
    }

    if !is_valid_reset_operation_id(&body.operation_id) {
        return browser_error_response(
            StatusCode::BAD_REQUEST,
            "invalidOperationId",
            "operationId must be a non-empty identifier up to 128 safe characters",
        );
    }

    if !body.confirmed {
        return browser_error_response(
            StatusCode::BAD_REQUEST,
            "confirmationRequired",
            "confirmed: true is required for profile reset",
        );
    }

    let op_id = body.operation_id.trim();
    let recheck_state = state.clone();
    let recheck_principal = admission.principal.clone();
    let recheck_is_dev = admission.is_dev;
    let recheck_admin: AdminRecheckCallback = Arc::new(move || {
        let state = recheck_state.clone();
        let principal = recheck_principal.clone();
        Box::pin(async move {
            if state.no_auth {
                recheck_is_dev
            } else {
                super::auth::verify_live_admin_for_reset(&state, &principal).await
            }
        })
    });
    let hooks = make_reset_fence_hooks(
        state.clone(),
        admission.principal.clone(),
        Some(recheck_admin),
    );
    match state
        .browser_host
        .reset_profile_with_hooks(
            &admission.principal,
            admission.is_dev,
            op_id,
            body.expected_profile_epoch,
            hooks,
        )
        .await
    {
        Ok(ResetOutcome::Completed {
            operation_id,
            new_profile_epoch,
        }) => no_store_response(
            StatusCode::OK,
            json!({
                "operationId": operation_id,
                "status": "completed",
                "profileEpoch": new_profile_epoch.to_string(),
                "newProfileEpoch": new_profile_epoch.to_string(),
            }),
        ),
        Ok(ResetOutcome::CleanupPending {
            operation_id,
            profile_epoch,
            reason,
        }) => no_store_response(
            StatusCode::ACCEPTED,
            json!({
                "operationId": operation_id,
                "status": "cleanupPending",
                "profileEpoch": profile_epoch.to_string(),
                "reason": reason,
            }),
        ),
        Err(ManagerError::PermissionDenied(msg)) => {
            browser_error_response(StatusCode::FORBIDDEN, "adminRequired", &msg)
        }
        Err(ManagerError::StaleEpoch { expected, actual }) => browser_error_response(
            StatusCode::CONFLICT,
            "staleEpoch",
            &format!("stale profile epoch (expected {expected}, current {actual})"),
        ),
        Err(ManagerError::CleanupPending(msg)) => {
            let active_op = msg
                .rsplit_once("operation ")
                .map(|(_, op)| op.trim().to_string())
                .filter(|op| is_valid_reset_operation_id(op));
            no_store_response(
                StatusCode::CONFLICT,
                json!({
                    "error": msg,
                    "kind": "cleanupPending",
                    "operationId": active_op,
                }),
            )
        }
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

    if !is_valid_reset_operation_id(&operation_id) {
        return browser_error_response(
            StatusCode::BAD_REQUEST,
            "invalidOperationId",
            "invalid operationId",
        );
    }

    match state
        .browser_host
        .get_reset_status(&admission.principal, admission.is_dev, operation_id.trim())
        .await
    {
        Ok(ResetStatus::Completed {
            operation_id,
            profile_epoch,
        }) => no_store_response(
            StatusCode::OK,
            json!({
                "operationId": operation_id,
                "status": "completed",
                "profileEpoch": profile_epoch.to_string(),
                "newProfileEpoch": profile_epoch.to_string(),
            }),
        ),
        Ok(ResetStatus::CleanupPending {
            operation_id,
            profile_epoch,
            reason,
        }) => no_store_response(
            StatusCode::OK,
            json!({
                "operationId": operation_id,
                "status": "cleanupPending",
                "profileEpoch": profile_epoch.to_string(),
                "reason": reason,
            }),
        ),
        Ok(ResetStatus::NotFound) => browser_error_response(
            StatusCode::NOT_FOUND,
            "operationNotFound",
            "profile reset operation not found",
        ),
        Err(err) => browser_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "resetStatusFailed",
            &err.to_string(),
        ),
    }
}
const MAX_DEVTOOLS_ASSET_BYTES: usize = 4 * 1024 * 1024;
const DEVTOOLS_ASSET_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
static DEVTOOLS_ASSET_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(DEVTOOLS_ASSET_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("build devtools asset http client")
});

/// POST /api/browser/sessions/{id}/devtools
pub async fn create_devtools_lease(
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

    let (dto, target_id) = match global_session_registry()
        .owned_running_target(&id, &admission.principal, admission.is_dev)
        .await
    {
        Ok(found) => found,
        Err(err) => return err.into(),
    };

    let profile_epoch =
        crate::browser_host::decimal_counter::parse_canonical_u64(&dto.profile_epoch, false)
            .unwrap_or(0);
    if !state.browser_host.is_instance_live_sync(
        &admission.principal,
        admission.is_dev,
        profile_epoch,
        &dto.browser_incarnation,
    ) {
        return browser_error_response(
            StatusCode::CONFLICT,
            "staleIncarnation",
            "browser instance is no longer live",
        );
    }

    match crate::browser_host::devtools::global_devtools_leases()
        .mint(
            &admission,
            &id,
            &target_id,
            &dto.browser_incarnation,
            profile_epoch,
        )
        .await
    {
        Ok(lease) => no_store_response(
            StatusCode::OK,
            serde_json::to_value(&lease).unwrap_or_default(),
        ),
        Err(resp) => resp,
    }
}

/// DELETE /api/browser/sessions/{id}/devtools/{token}
pub async fn revoke_devtools_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path((id, token)): Path<(String, String)>,
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

    if global_session_registry()
        .session_exists_for_other(&id, &admission.principal)
        .await
    {
        return browser_error_response(
            StatusCode::NOT_FOUND,
            "sessionNotFound",
            "browser session not found",
        );
    }

    let revoked = crate::browser_host::devtools::global_devtools_leases()
        .revoke_by_token(&admission.principal, &id, &token)
        .await;
    no_store_response(StatusCode::OK, json!({ "revoked": revoked }))
}

async fn resolve_devtools_chrome_port(
    state: &AppState,
    lease: &crate::browser_host::devtools::DevToolsLease,
) -> Result<u16, Response> {
    if crate::browser_host::auth::verify_live_admission(state, &lease.admission)
        .await
        .is_err()
    {
        return Err(browser_error_response(
            StatusCode::UNAUTHORIZED,
            "invalidSession",
            "live auth failed",
        ));
    }
    if !state.browser_host.is_instance_live_sync(
        &lease.admission.principal,
        lease.admission.is_dev,
        lease.profile_epoch,
        &lease.browser_incarnation,
    ) {
        return Err(browser_error_response(
            StatusCode::UNAUTHORIZED,
            "staleIncarnation",
            "browser instance is no longer live",
        ));
    }
    let (_, target_id) = global_session_registry()
        .owned_running_target(
            &lease.browser_session_id,
            &lease.admission.principal,
            lease.admission.is_dev,
        )
        .await
        .map_err(Response::from)?;
    if target_id != lease.native_target_id {
        return Err(browser_error_response(
            StatusCode::UNAUTHORIZED,
            "staleTarget",
            "browser target rotated",
        ));
    }
    let handle = state
        .browser_host
        .ensure_running(&lease.admission.principal, lease.admission.is_dev)
        .await
        .map_err(|e| {
            browser_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "browserUnavailable",
                &e.to_string(),
            )
        })?;
    if handle.browser_incarnation != lease.browser_incarnation
        || handle.profile_epoch != lease.profile_epoch
    {
        return Err(browser_error_response(
            StatusCode::UNAUTHORIZED,
            "staleIncarnation",
            "browser incarnation mismatch",
        ));
    }
    url::Url::parse(&handle.ws_endpoint)
        .ok()
        .and_then(|u| u.port())
        .ok_or_else(|| {
            browser_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internalError",
                "missing browser port",
            )
        })
}

/// GET /api/browser/devtools/{token}/{*path}
pub async fn proxy_devtools_asset(
    State(state): State<AppState>,
    Path((token, path)): Path<(String, String)>,
) -> Response {
    if crate::browser_host::devtools_filter::validate_devtools_asset_path(&path).is_err() {
        return browser_error_response(
            StatusCode::BAD_REQUEST,
            "invalidPath",
            "invalid devtools asset path",
        );
    }
    let Some(lease) = crate::browser_host::devtools::global_devtools_leases()
        .resolve_and_refresh_asset(&token)
        .await
    else {
        return browser_error_response(
            StatusCode::UNAUTHORIZED,
            "invalidDevToolsToken",
            "invalid or expired devtools token",
        );
    };
    let chrome_port = match resolve_devtools_chrome_port(&state, &lease).await {
        Ok(port) => port,
        Err(resp) => return resp,
    };
    let Ok(resp) = DEVTOOLS_ASSET_CLIENT
        .get(format!("http://127.0.0.1:{chrome_port}/devtools/{path}"))
        .send()
        .await
    else {
        return browser_error_response(
            StatusCode::BAD_GATEWAY,
            "badGateway",
            "failed to fetch devtools asset",
        );
    };
    if !resp.status().is_success() {
        return browser_error_response(
            StatusCode::NOT_FOUND,
            "assetNotFound",
            "devtools asset not found",
        );
    }
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let Ok(bytes) =
        crate::browser_host::cdp_gateway::read_bounded_bytes(resp, MAX_DEVTOOLS_ASSET_BYTES).await
    else {
        return browser_error_response(
            StatusCode::BAD_GATEWAY,
            "badGateway",
            "devtools asset exceeded size bound",
        );
    };
    let (body_bytes, cache_ctl) = if content_type.to_ascii_lowercase().starts_with("text/html") {
        let rewritten = crate::browser_host::devtools_filter::rewrite_devtools_html_csp(
            &String::from_utf8_lossy(&bytes),
        );
        (rewritten.into_bytes(), "no-store")
    } else {
        (bytes, "private, max-age=300")
    };
    let mut out = Response::new(axum::body::Body::from(body_bytes));
    *out.status_mut() = StatusCode::OK;
    if let Ok(ct) = HeaderValue::from_str(&content_type) {
        out.headers_mut().insert(header::CONTENT_TYPE, ct);
    }
    out.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache_ctl));
    out.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    out.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    out
}

/// GET /api/browser/devtools/{token}/ws
pub async fn devtools_ws_handler(
    State(state): State<AppState>,
    Path(token): Path<String>,
    ws: Result<
        axum::extract::ws::WebSocketUpgrade,
        axum::extract::ws::rejection::WebSocketUpgradeRejection,
    >,
) -> Response {
    let ws = match ws {
        Ok(upgrade) => upgrade,
        Err(rej) => return rej.into_response(),
    };
    let (hash, lease, permit) = match crate::browser_host::devtools::global_devtools_leases()
        .claim_ws(&token)
        .await
    {
        Ok(claimed) => claimed,
        Err(StatusCode::TOO_MANY_REQUESTS) => {
            return browser_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "tooManyConnections",
                "devtools websocket limit reached",
            )
        }
        Err(StatusCode::CONFLICT) => {
            return browser_error_response(
                StatusCode::CONFLICT,
                "leaseInUse",
                "devtools websocket already active",
            )
        }
        Err(_) => {
            return browser_error_response(
                StatusCode::UNAUTHORIZED,
                "invalidDevToolsToken",
                "invalid or expired devtools token",
            )
        }
    };
    let chrome_port = match resolve_devtools_chrome_port(&state, &lease).await {
        Ok(port) => port,
        Err(resp) => {
            crate::browser_host::devtools::global_devtools_leases()
                .revoke_by_hash(&hash)
                .await;
            return resp;
        }
    };
    ws.max_message_size(crate::browser_host::protocol::MAX_WS_MESSAGE_BYTES)
        .max_frame_size(crate::browser_host::protocol::MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            relay_devtools_socket(socket, state, hash, lease, chrome_port, permit)
        })
}

async fn relay_devtools_socket(
    mut client_ws: axum::extract::ws::WebSocket,
    state: AppState,
    hash: [u8; 32],
    lease: crate::browser_host::devtools::DevToolsLease,
    chrome_port: u16,
    permit: crate::browser_host::cdp_gateway::CdpGatewayPermit,
) {
    use axum::extract::ws::Message as AxumWsMessage;
    use futures_util::{SinkExt, StreamExt};
    use tokio::time::timeout;
    use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
    use tokio_tungstenite::tungstenite::Message as UpstreamMessage;

    use crate::browser_host::cdp_gateway::{
        write_with_cancel, AbortOnDrop, WriteOutcome, UPSTREAM_CONNECT_TIMEOUT,
    };
    use crate::browser_host::devtools::global_devtools_leases;
    use crate::browser_host::devtools_filter::{
        inspect_devtools_client_message, ClientMessageVerdict, DevToolsUpstreamFilter,
    };
    use crate::browser_host::diagnostics::global_memory_controller;
    use crate::browser_host::protocol::MAX_WS_MESSAGE_BYTES;

    let mut cfg = WebSocketConfig::default();
    cfg.max_message_size = Some(MAX_WS_MESSAGE_BYTES);
    cfg.max_frame_size = Some(MAX_WS_MESSAGE_BYTES);
    let upstream_url = format!(
        "ws://127.0.0.1:{chrome_port}/devtools/page/{}",
        lease.native_target_id
    );
    let Ok(Ok((mut upstream_ws, _))) = timeout(
        UPSTREAM_CONNECT_TIMEOUT,
        tokio_tungstenite::connect_async_with_config(&upstream_url, Some(cfg), false),
    )
    .await
    else {
        let _ = timeout(
            std::time::Duration::from_millis(500),
            client_ws.send(AxumWsMessage::Close(None)),
        )
        .await;
        global_devtools_leases().revoke_by_hash(&hash).await;
        return;
    };

    let (abort_tx, mut abort_rx) = tokio::sync::mpsc::channel::<()>(1);
    let admission = lease.admission.clone();
    let state_auth = state.clone();
    let watcher = tokio::spawn(async move {
        let mut tick = tokio::time::interval(crate::browser_host::auth::LIVE_CHECK_INTERVAL);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        loop {
            tick.tick().await;
            if crate::browser_host::auth::verify_live_admission(&state_auth, &admission)
                .await
                .is_err()
                || !global_devtools_leases().refresh_ws(&hash).await
            {
                let _ = abort_tx.send(()).await;
                break;
            }
        }
    });
    let _watcher_guard = AbortOnDrop(Some(watcher));

    let deadline_at = lease.admission.effective_deadline.map(|dl| {
        let rem = (dl - chrono::Utc::now())
            .to_std()
            .unwrap_or(std::time::Duration::from_millis(1));
        tokio::time::Instant::now() + rem
    });
    let deadline_sleep = tokio::time::sleep_until(
        deadline_at.unwrap_or_else(|| {
            tokio::time::Instant::now() + std::time::Duration::from_secs(86400 * 365)
        }),
    );
    tokio::pin!(deadline_sleep);
    let mut upstream_filter = DevToolsUpstreamFilter::default();

    loop {
        tokio::select! {
            _ = &mut deadline_sleep, if deadline_at.is_some() => break,
            _ = lease.cancel.cancelled() => break,
            _ = abort_rx.recv() => break,
            msg = client_ws.next() => {
                let ok = match msg {
                    Some(Ok(AxumWsMessage::Text(t))) => {
                        let Ok(_mem) = global_memory_controller().try_reserve(t.len().saturating_mul(2)) else { break; };
                        match inspect_devtools_client_message(t.as_str(), &lease.native_target_id) {
                            ClientMessageVerdict::Forward => {
                                write_with_cancel(upstream_ws.send(UpstreamMessage::Text(t.as_str().into())), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                            }
                            ClientMessageVerdict::Reject(Some(err)) => {
                                write_with_cancel(client_ws.send(AxumWsMessage::Text(err.into())), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                            }
                            ClientMessageVerdict::Reject(None) => true,
                        }
                    }
                    Some(Ok(AxumWsMessage::Binary(b))) => {
                        let Ok(_mem) = global_memory_controller().try_reserve(b.len()) else { break; };
                        write_with_cancel(upstream_ws.send(UpstreamMessage::Binary(b)), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                    }
                    Some(Ok(AxumWsMessage::Ping(p))) => {
                        write_with_cancel(upstream_ws.send(UpstreamMessage::Ping(p)), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                    }
                    Some(Ok(AxumWsMessage::Pong(p))) => {
                        write_with_cancel(upstream_ws.send(UpstreamMessage::Pong(p)), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                    }
                    _ => false,
                };
                if !ok { break; }
            }
            msg = upstream_ws.next() => {
                let ok = match msg {
                    Some(Ok(UpstreamMessage::Text(t))) => {
                        let Ok(_mem) = global_memory_controller().try_reserve(t.len().saturating_mul(2)) else { break; };
                        if !upstream_filter.should_forward(t.as_str(), &lease.native_target_id) {
                            true
                        } else {
                            write_with_cancel(client_ws.send(AxumWsMessage::Text(t.as_str().into())), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                        }
                    }
                    Some(Ok(UpstreamMessage::Binary(b))) => {
                        let Ok(_mem) = global_memory_controller().try_reserve(b.len()) else { break; };
                        write_with_cancel(client_ws.send(AxumWsMessage::Binary(b)), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                    }
                    Some(Ok(UpstreamMessage::Ping(p))) => {
                        write_with_cancel(client_ws.send(AxumWsMessage::Ping(p)), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                    }
                    Some(Ok(UpstreamMessage::Pong(p))) => {
                        write_with_cancel(client_ws.send(AxumWsMessage::Pong(p)), &mut abort_rx, deadline_at).await.0 == WriteOutcome::Ok
                    }
                    Some(Ok(UpstreamMessage::Frame(_))) => true,
                    _ => false,
                };
                if !ok { break; }
            }
        }
    }

    drop(_watcher_guard);
    let _ = timeout(
        std::time::Duration::from_millis(500),
        upstream_ws.close(None),
    )
    .await;
    let _ = timeout(
        std::time::Duration::from_millis(500),
        client_ws.send(AxumWsMessage::Close(None)),
    )
    .await;
    drop(permit);
    global_devtools_leases().revoke_by_hash(&hash).await;
}

pub use crate::browser_host::cdp_gateway::{
    cdp_ws_handler, cdp_ws_handler_target, get_cdp_json_alias, get_cdp_list, get_cdp_version,
};
pub use crate::browser_host::media::{
    control_ws_handler, get_or_register_producer, get_producer, media_ws_handler, remove_producer,
};
