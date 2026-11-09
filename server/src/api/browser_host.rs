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
use crate::browser_debug::BrowserDebugArtifactManager;
use crate::browser_host::manager::{
    AdminRecheckCallback, FenceCallback, ManagerError, ResetFenceHooks, ResetOutcome, ResetStatus,
    DEFAULT_RESET_WAIT_TIMEOUT,
};
use crate::browser_host::selection::{self, InspectPoint, SelectionError};
use crate::browser_host::session::{
    CreateSessionRequest, DEFAULT_MAX_TARGETS, SessionError, SessionRegistry,
};
use crate::state::AppState;
fn deserialize_u64_or_string<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = u64;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("u64 integer or canonical decimal string")
        }
        fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<u64, E> {
            Ok(v)
        }
        fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<u64, E> {
            u64::try_from(v).map_err(|_| E::custom("negative integer"))
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<u64, E> {
            v.parse::<u64>().map_err(E::custom)
        }
    }
    deserializer.deserialize_any(Visitor)
}

fn deserialize_opt_u64_or_string<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Val {
        Num(u64),
        Str(String),
    }
    match Option::<Val>::deserialize(deserializer)? {
        None => Ok(None),
        Some(Val::Num(n)) => Ok(Some(n)),
        Some(Val::Str(s)) => s.parse::<u64>().map(Some).map_err(serde::de::Error::custom),
    }
}

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
        SelectionError::Conflict(msg) => browser_error_response(StatusCode::CONFLICT, "conflict", &msg),
        SelectionError::TerminalNotFound => {
            browser_error_response(StatusCode::NOT_FOUND, "terminalNotFound", "terminal not found")
        }
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
        let token_opt = if headers.contains_key(header::AUTHORIZATION) {
            crate::api::auth::extract_bearer_token(headers).map(str::to_string)
        } else {
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
        };
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
                let _ = crate::browser_host::media::ensure_producer_for_session(
                    &state,
                    &dto.browser_session_id,
                    &admission.principal,
                    admission.is_dev,
                )
                .await;
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
            let nav_rev = dto.navigation_revision.parse::<u64>().unwrap_or(0);
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

    match global_session_registry()
        .delete_session(&id, &admission.principal)
        .await
    {
        Ok(()) => {
            selection::cleanup_session(&state, &id).await;
            crate::browser_host::media::remove_producer(&id).await;
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
    #[serde(deserialize_with = "deserialize_u64_or_string")]
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
            let new_nav_rev = dto.navigation_revision.parse::<u64>().unwrap_or(0);
            if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
                global_session_registry().mark_api_navigation_pending(&id).await;
                if let Ok(page_sid) = prod.ensure_page_session().await {
                    let _ = prod
                        .cdp_client
                        .send_command(
                            "Page.navigate",
                            Some(json!({ "url": dto.url })),
                            Some(&page_sid),
                        )
                        .await;
                }
            }
            selection::invalidate_on_navigation(&state, &id, Some(new_nav_rev)).await;
            no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default())
        }
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRequest {
    pub direction: String,
    #[serde(deserialize_with = "deserialize_u64_or_string")]
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
        Ok(dto) => {
            let new_nav_rev = dto.navigation_revision.parse::<u64>().unwrap_or(0);
            if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
                global_session_registry().mark_api_navigation_pending(&id).await;
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
                            let target_idx = if body.direction == "back" { idx - 1 } else { idx + 1 };
                            if target_idx >= 0 && (target_idx as usize) < entries.len() {
                                if let Some(entry_id) = entries[target_idx as usize].get("id").and_then(|v| v.as_i64()) {
                                    let _ = prod
                                        .cdp_client
                                        .send_command(
                                            "Page.navigateToHistoryEntry",
                                            Some(json!({ "entryId": entry_id })),
                                            Some(&page_sid),
                                        )
                                        .await;
                                }
                            }
                        }
                    }
                }
            }
            selection::invalidate_on_navigation(&state, &id, Some(new_nav_rev)).await;
            no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default())
        }
        Err(err) => err.into(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadRequest {
    #[serde(deserialize_with = "deserialize_u64_or_string")]
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
        Ok(dto) => {
            let new_nav_rev = dto.navigation_revision.parse::<u64>().unwrap_or(0);
            if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
                global_session_registry().mark_api_navigation_pending(&id).await;
                if let Ok(page_sid) = prod.ensure_page_session().await {
                    let _ = prod
                        .cdp_client
                        .send_command("Page.reload", None, Some(&page_sid))
                        .await;
                }
            }
            selection::invalidate_on_navigation(&state, &id, Some(new_nav_rev)).await;
            no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default())
        }
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
        Ok(dto) => {
            if let Some(prod) = crate::browser_host::media::get_producer(&id).await {
                let new_geom = crate::browser_host::protocol::TargetGeometry {
                    css_width: body.width as f64,
                    css_height: body.height as f64,
                    offset_top: 0.0,
                    scroll_x: 0.0,
                    scroll_y: 0.0,
                    page_scale: 1.0,
                    visual_offset_x: 0.0,
                    visual_offset_y: 0.0,
                    dpr: body.dpr,
                };
                let _ = prod.update_geometry(new_geom).await;
            }
            input_mgr.set_expected_viewport_epoch(body.viewport_epoch + 1).await;
            no_store_response(StatusCode::OK, serde_json::to_value(&dto).unwrap_or_default())
        }
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionActionRequest {
    pub lease_token: String,
    #[serde(deserialize_with = "deserialize_u64_or_string")]
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
    if let Err(err) = input_mgr
        .renew_lease(&body.lease_token, admission.effective_deadline)
        .await
    {
        return err.into();
    }

    match selection::start_selection(
        &state,
        &id,
        &admission.principal,
        admission.is_dev,
        body.navigation_revision,
        body.inspect_point,
    )
    .await
    {
        Ok(summary) => no_store_response(
            StatusCode::OK,
            json!({
                "selectionActive": summary.active,
                "navigationRevision": summary.navigation_revision,
                "selectionRevision": summary.selection_revision,
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

    match selection::cancel_selection(&state, &id, &admission.principal, body.navigation_revision).await {
        Ok(summary) => no_store_response(
            StatusCode::OK,
            json!({
                "selectionActive": summary.active,
                "navigationRevision": summary.navigation_revision,
                "selectionRevision": summary.selection_revision,
            }),
        ),
        Err(err) => selection_error_to_response(err),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionArtifactsRequest {
    #[serde(deserialize_with = "deserialize_u64_or_string")]
    pub selection_revision: u64,
    pub terminal_id: String,
    #[serde(deserialize_with = "deserialize_u64_or_string")]
    pub terminal_incarnation: u64,
    #[serde(default, deserialize_with = "deserialize_opt_u64_or_string")]
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
        if state.origin_is_allowed(headers) {
            return true;
        }
        if state.no_auth && state.cors_origins.is_empty() {
            if headers.get_all(header::ORIGIN).iter().count() == 1 {
                if let Some(origin_val) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
                    return origin_val == "http://127.0.0.1:5173"
                        || origin_val == "http://localhost:5173";
                }
            }
        }
        return false;
    }

    if state.no_auth {
        true
    } else {
        has_bearer_auth
    }
}

pub(crate) async fn revoke_auth_session_browser_resources(principal: &str, auth_session_id: &str) {
    let cancelled = global_attachment_manager()
        .revoke_by_auth_session(principal, auth_session_id)
        .await;
    if cancelled.is_empty() {
        return;
    }
    let managers = global_input_managers().read().await;
    for (browser_session_id, viewer_id) in cancelled {
        if let Some(mgr) = managers.get(&browser_session_id).cloned() {
            if mgr.is_lease_holder(&viewer_id).await {
                let releases = mgr.revoke_lease().await;
                if !releases.is_empty() {
                    if let Some(producer) = get_producer(&browser_session_id).await {
                        if let Ok(page_sid) = producer.ensure_page_session().await {
                            let geom = producer.geometry().await;
                            for rel in &releases {
                                crate::browser_host::media::dispatch_input_event_to_cdp(
                                    &producer.cdp_client,
                                    &page_sid,
                                    &geom,
                                    rel,
                                )
                                .await;
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Pure in-memory fence with zero disk or network I/O; returns `(session_ids, removed_artifact_paths)`.
pub(crate) async fn fence_principal_browser_resources_sync(
    state: &AppState,
    principal: &str,
) -> (Vec<String>, Vec<(uuid::Uuid, Vec<std::path::PathBuf>)>) {
    global_attachment_manager()
        .revoke_all_for_principal(principal)
        .await;
    let principal_sessions = global_session_registry().list_sessions(principal).await;
    global_session_registry()
        .close_principal_sessions(principal)
        .await;
    {
        let mut input_map = global_input_managers().write().await;
        for s in &principal_sessions {
            if let Some(mgr) = input_map.remove(&s.browser_session_id) {
                let _ = mgr.revoke_lease().await;
            }
        }
    }
    let pending_sel_ids = selection::fence_principal_sessions_in_memory(principal).await;
    let removed_artifacts = state
        .browser_debug_artifacts
        .fence_managed_by_principal_and_ids(principal, None, &pending_sel_ids)
        .await;
    let session_ids = principal_sessions
        .into_iter()
        .map(|s| s.browser_session_id)
        .collect();
    (session_ids, removed_artifacts)
}

pub(crate) async fn teardown_principal_network_resources(session_ids: Vec<String>) {
    for sid in session_ids {
        remove_producer(&sid).await;
    }
}

pub(crate) async fn revoke_principal_browser_resources(state: &AppState, principal: &str) {
    let (session_ids, removed_artifacts) =
        fence_principal_browser_resources_sync(state, principal).await;
    BrowserDebugArtifactManager::delete_fenced_artifacts(removed_artifacts, principal).await;
    teardown_principal_network_resources(session_ids).await;
}

pub(crate) fn make_reset_fence_hooks(
    state: AppState,
    principal: String,
    recheck_admin: Option<AdminRecheckCallback>,
) -> ResetFenceHooks {
    type PendingCleanup = (Vec<String>, Vec<(uuid::Uuid, Vec<std::path::PathBuf>)>);
    let pending: Arc<tokio::sync::Mutex<PendingCleanup>> =
        Arc::new(tokio::sync::Mutex::new((Vec::new(), Vec::new())));

    let sync_state = state.clone();
    let sync_principal = principal.clone();
    let sync_slot = pending.clone();
    let sync_fence: FenceCallback = Arc::new(move || {
        let state = sync_state.clone();
        let principal = sync_principal.clone();
        let slot = sync_slot.clone();
        Box::pin(async move {
            let (sids, artifacts) =
                fence_principal_browser_resources_sync(&state, &principal).await;
            *slot.lock().await = (sids, artifacts);
        })
    });

    let async_slot = pending;
    let async_principal = principal;
    let async_teardown: FenceCallback = Arc::new(move || {
        let slot = async_slot.clone();
        let principal = async_principal.clone();
        Box::pin(async move {
            let (sids, artifacts) = std::mem::take(&mut *slot.lock().await);
            // Delete fenced managed artifacts BEFORE bounded network teardown and BEFORE profile user-data deletion
            BrowserDebugArtifactManager::delete_fenced_artifacts(artifacts, &principal).await;
            let _ = tokio::time::timeout(
                DEFAULT_RESET_WAIT_TIMEOUT,
                teardown_principal_network_resources(sids),
            )
            .await;
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
    #[serde(deserialize_with = "deserialize_u64_or_string")]
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
                "profileEpoch": new_profile_epoch,
                "newProfileEpoch": new_profile_epoch,
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
                "profileEpoch": profile_epoch,
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
                "profileEpoch": profile_epoch,
                "newProfileEpoch": profile_epoch,
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
                "profileEpoch": profile_epoch,
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
pub use crate::browser_host::cdp_gateway::{
    cdp_ws_handler, cdp_ws_handler_target, get_cdp_json_alias, get_cdp_list, get_cdp_version,
};
pub use crate::browser_host::media::{
    control_ws_handler, get_or_register_producer, get_producer, media_ws_handler, remove_producer,
};
