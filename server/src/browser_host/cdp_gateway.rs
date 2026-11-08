use std::future::Future;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::extract::{ConnectInfo, Extension, Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message as UpstreamMessage;
use tracing::{debug, warn};
use url::Url;

use crate::api::auth::AuthenticatedActor;
use crate::api::browser_host::{
    authenticate_browser_caller, browser_error_response, global_attachment_manager,
    no_store_response,
};
use crate::browser_host::attachments::AttachmentPurpose;
use crate::browser_host::auth::{verify_live_admission, BrowserAdmission, LIVE_CHECK_INTERVAL};
use crate::browser_host::protocol::MAX_WS_MESSAGE_BYTES;
use crate::state::AppState;

pub const DEFAULT_MAX_AGENT_CDP_CONNECTIONS: usize = 2;
pub const WRITE_DEADLINE: Duration = Duration::from_secs(5);
pub const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub const CDP_SUBPROTOCOL: &str = "damhopper.browser.cdp.v1";
pub const TICKET_SUBPROTOCOL_PREFIX: &str = "damhopper.ticket.";

pub static GLOBAL_CDP_GATEWAY: LazyLock<CdpGatewayManager> =
    LazyLock::new(|| CdpGatewayManager::new(DEFAULT_MAX_AGENT_CDP_CONNECTIONS));

pub fn global_cdp_gateway() -> &'static CdpGatewayManager {
    &GLOBAL_CDP_GATEWAY
}

#[derive(Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    Ok,
    Failed,
    DeadlineElapsed,
}

pub async fn write_with_outcome<F, E>(write: F) -> WriteOutcome
where
    F: Future<Output = Result<(), E>>,
{
    match timeout(WRITE_DEADLINE, write).await {
        Ok(Ok(())) => WriteOutcome::Ok,
        Ok(Err(_)) => WriteOutcome::Failed,
        Err(_) => WriteOutcome::DeadlineElapsed,
    }
}
pub async fn write_with_cancel<F, E>(
    write: F,
    abort_rx: &mut tokio::sync::mpsc::Receiver<()>,
) -> (WriteOutcome, bool)
where
    F: Future<Output = Result<(), E>>,
{
    tokio::select! {
        _ = abort_rx.recv() => (WriteOutcome::Failed, true),
        outcome = write_with_outcome(write) => (outcome, false),
    }
}

pub struct CdpGatewayManager {
    semaphore: Arc<Semaphore>,
    active_connections: Arc<AtomicUsize>,
}

impl CdpGatewayManager {
    pub fn new(capacity: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(capacity)),
            active_connections: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn active_connections(&self) -> usize {
        self.active_connections.load(Ordering::SeqCst)
    }

    pub fn try_acquire(&self) -> Result<CdpGatewayPermit, StatusCode> {
        let permit = self
            .semaphore
            .clone()
            .try_acquire_owned()
            .map_err(|_| StatusCode::TOO_MANY_REQUESTS)?;
        self.active_connections.fetch_add(1, Ordering::SeqCst);
        Ok(CdpGatewayPermit {
            _permit: permit,
            counter: self.active_connections.clone(),
        })
    }
}

#[derive(Debug)]
pub struct CdpGatewayPermit {
    _permit: OwnedSemaphorePermit,
    counter: Arc<AtomicUsize>,
}

impl Drop for CdpGatewayPermit {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Derives the rewritten gateway WebSocket URL base.
/// Respects architecture contract: derived from configured public server origin,
/// never untrusted forwarded Host header (e.g. X-Forwarded-Host).
pub fn resolve_gateway_ws_base(headers: &HeaderMap, _state: &AppState) -> String {
    if let Ok(pub_origin) = std::env::var("DAM_HOPPER_PUBLIC_SERVER_ORIGIN") {
        let trimmed = pub_origin.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            if let Some(rest) = trimmed.strip_prefix("https://") {
                return format!("wss://{rest}");
            } else if let Some(rest) = trimmed.strip_prefix("http://") {
                return format!("ws://{rest}");
            } else if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
                return trimmed.to_string();
            }
        }
    }

    // Direct Host header only (never forwarded headers)
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .unwrap_or("127.0.0.1:4801");

    format!("ws://{host}")
}

/// Validates Origin header per architecture-contracts.md §5:
/// - Exact approved Origin matching (case-sensitive byte-for-byte).
/// - `null`, trailing slash, repeated, or comma-separated Origin headers rejected with 403 Forbidden.
/// - Origin-less requests permitted ONLY for Authorization-header authenticated clients.
pub fn validate_cdp_origin(
    headers: &HeaderMap,
    state: &AppState,
    has_bearer_auth: bool,
) -> Result<(), Response> {
    let mut origin_iter = headers.get_all(header::ORIGIN).iter();
    match (origin_iter.next(), origin_iter.next()) {
        (None, _) => {
            if has_bearer_auth {
                Ok(())
            } else {
                warn!("Origin-less CDP request rejected: missing Authorization header");
                Err(browser_error_response(
                    StatusCode::FORBIDDEN,
                    "forbiddenOrigin",
                    "Origin-less request requires Authorization header bearer authentication",
                ))
            }
        }
        (Some(origin_hdr), None) => {
            let origin_bytes = origin_hdr.as_bytes();
            if origin_bytes.contains(&b',') {
                warn!("CDP request rejected: duplicate or comma-separated Origin header");
                return Err(browser_error_response(
                    StatusCode::FORBIDDEN,
                    "forbiddenOrigin",
                    "duplicate or comma-separated Origin header is forbidden",
                ));
            }
            let origin_str = match origin_hdr.to_str() {
                Ok(s) => s.trim(),
                Err(_) => {
                    return Err(browser_error_response(
                        StatusCode::FORBIDDEN,
                        "forbiddenOrigin",
                        "invalid Origin header encoding",
                    ))
                }
            };
            if origin_str == "null" || origin_str.ends_with('/') {
                warn!(origin = origin_str, "CDP request rejected: invalid Origin format");
                return Err(browser_error_response(
                    StatusCode::FORBIDDEN,
                    "forbiddenOrigin",
                    "Origin cannot be null or contain trailing slash",
                ));
            }

            let matched = state
                .cors_origins
                .iter()
                .any(|allowed| allowed.as_bytes() == origin_bytes)
                || state
                    .browser_host
                    .config()
                    .allowed_dev_origins
                    .iter()
                    .any(|allowed| allowed.as_bytes() == origin_bytes);

            let dev_fallback = (state.cors_origins.is_empty()
                && state.browser_host.config().allowed_dev_origins.is_empty())
                && (origin_str.eq_ignore_ascii_case("http://127.0.0.1:5173")
                    || origin_str.eq_ignore_ascii_case("http://localhost:5173"));

            if matched || dev_fallback {
                Ok(())
            } else {
                warn!(origin = origin_str, "CDP request rejected: Origin not in approved allowlist");
                Err(browser_error_response(
                    StatusCode::FORBIDDEN,
                    "forbiddenOrigin",
                    "Origin does not match exact approved origin allowlist",
                ))
            }
        }
        _ => {
            warn!("CDP request rejected: multiple Origin headers");
            Err(browser_error_response(
                StatusCode::FORBIDDEN,
                "forbiddenOrigin",
                "multiple Origin headers are forbidden",
            ))
        }
    }
}

/// Helper to authenticate and validate Origin for discovery HTTP requests.
async fn authenticate_and_validate_discovery(
    state: &AppState,
    headers: &HeaderMap,
    connect: Option<&Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<&AuthenticatedActor>,
) -> Result<BrowserAdmission, Response> {
    let has_bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.starts_with("Bearer "))
        .unwrap_or(false);

    // Authentication evaluated first: bad Origin without auth fails 401, not Origin oracle
    let admission = authenticate_browser_caller(state, headers, connect, actor).await?;

    // Origin validated next
    validate_cdp_origin(headers, state, has_bearer)?;

    Ok(admission)
}

/// GET /api/browser/cdp/json/version and /api/browser/cdp/json/version/
pub async fn get_cdp_version(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
) -> Response {
    let admission = match authenticate_and_validate_discovery(
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

    let handle = match state
        .browser_host
        .ensure_running(&admission.principal, admission.is_dev)
        .await
    {
        Ok(h) => h,
        Err(err) => {
            return browser_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "browserUnavailable",
                &err.to_string(),
            );
        }
    };

    let chrome_port = match Url::parse(&handle.ws_endpoint)
        .ok()
        .and_then(|u| u.port())
    {
        Some(p) => p,
        None => {
            return browser_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internalError",
                "failed to parse DevTools port from browser process",
            );
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return browser_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internalError",
                &e.to_string(),
            );
        }
    };

    let url = format!("http://127.0.0.1:{chrome_port}/json/version");
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                "failed to fetch version from browser engine",
            );
        }
    };

    let bytes = match resp.bytes().await {
        Ok(b) if b.len() <= 65536 => b,
        Ok(_) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                "browser version discovery payload exceeded 64KiB bound",
            );
        }
        Err(_) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                "failed to read browser version response",
            );
        }
    };

    let mut val: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                &format!("invalid JSON from browser engine: {e}"),
            );
        }
    };

    let ws_base = resolve_gateway_ws_base(&headers, &state);
    val["webSocketDebuggerUrl"] = json!(format!("{ws_base}/api/browser/cdp/ws"));

    // Sanitize devtoolsFrontendUrl if present so it doesn't leak internal loopback
    if let Some(frontend_url) = val.get_mut("devtoolsFrontendUrl") {
        if let Some(s) = frontend_url.as_str() {
            let sanitized = s.replace(&format!("127.0.0.1:{chrome_port}"), ws_base.trim_start_matches("ws://").trim_start_matches("wss://"));
            *frontend_url = json!(sanitized);
        }
    }

    no_store_response(StatusCode::OK, val)
}

/// GET /api/browser/cdp/json/list and /api/browser/cdp/json/list/
pub async fn get_cdp_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
) -> Response {
    let admission = match authenticate_and_validate_discovery(
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

    let handle = match state
        .browser_host
        .ensure_running(&admission.principal, admission.is_dev)
        .await
    {
        Ok(h) => h,
        Err(err) => {
            return browser_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "browserUnavailable",
                &err.to_string(),
            );
        }
    };

    let chrome_port = match Url::parse(&handle.ws_endpoint)
        .ok()
        .and_then(|u| u.port())
    {
        Some(p) => p,
        None => {
            return browser_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internalError",
                "failed to parse DevTools port from browser process",
            );
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return browser_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internalError",
                &e.to_string(),
            );
        }
    };

    let url = format!("http://127.0.0.1:{chrome_port}/json/list");
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                "failed to fetch target list from browser engine",
            );
        }
    };

    let bytes = match resp.bytes().await {
        Ok(b) if b.len() <= 262144 => b,
        Ok(_) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                "browser target list discovery payload exceeded 256KiB bound",
            );
        }
        Err(_) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                "failed to read browser target list response",
            );
        }
    };

    let mut val: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            return browser_error_response(
                StatusCode::BAD_GATEWAY,
                "badGateway",
                &format!("invalid JSON from browser engine: {e}"),
            );
        }
    };

    let ws_base = resolve_gateway_ws_base(&headers, &state);
    if let Some(targets) = val.as_array_mut() {
        for target in targets {
            if let Some(target_id) = target.get("id").and_then(|v| v.as_str()) {
                target["webSocketDebuggerUrl"] =
                    json!(format!("{ws_base}/api/browser/cdp/ws/{target_id}"));
            } else {
                target["webSocketDebuggerUrl"] = json!(format!("{ws_base}/api/browser/cdp/ws"));
            }

            if let Some(frontend_url) = target.get_mut("devtoolsFrontendUrl") {
                if let Some(s) = frontend_url.as_str() {
                    let sanitized = s.replace(&format!("127.0.0.1:{chrome_port}"), ws_base.trim_start_matches("ws://").trim_start_matches("wss://"));
                    *frontend_url = json!(sanitized);
                }
            }
        }
    }

    no_store_response(StatusCode::OK, val)
}

/// GET /api/browser/cdp/json (alias for /json/list per CDP specification)
pub async fn get_cdp_json_alias(
    state: State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
) -> Response {
    get_cdp_list(state, headers, connect, actor).await
}

/// GET /api/browser/cdp/ws
pub async fn cdp_ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    cdp_ws_handler_internal(state, headers, connect, actor, ws, None).await
}

/// GET /api/browser/cdp/ws/{target_id}
pub async fn cdp_ws_handler_target(
    State(state): State<AppState>,
    Path(target_id): Path<String>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    cdp_ws_handler_internal(state, headers, connect, actor, ws, Some(target_id)).await
}

async fn cdp_ws_handler_internal(
    state: AppState,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    actor: Option<Extension<AuthenticatedActor>>,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    target_id: Option<String>,
) -> Response {
    // 1. Check for ticket capability in Sec-WebSocket-Protocol
    let subprotocols_str = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let mut ticket_capability: Option<String> = None;
    let mut client_requested_cdp_protocol = false;

    for proto in subprotocols_str.split(',') {
        let p = proto.trim();
        if p == CDP_SUBPROTOCOL {
            client_requested_cdp_protocol = true;
        } else if let Some(ticket) = p.strip_prefix(TICKET_SUBPROTOCOL_PREFIX) {
            ticket_capability = Some(ticket.to_string());
        }
    }

    let has_bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.starts_with("Bearer "))
        .unwrap_or(false);

    let mut ticket_expected_incarnation: Option<String> = None;
    let mut ticket_expected_epoch: Option<u64> = None;

    let admission = if has_bearer || state.no_auth || actor.is_some() {
        // Authenticate via caller
        match authenticate_browser_caller(
            &state,
            &headers,
            connect.as_ref(),
            actor.as_ref().map(|Extension(a)| a),
        )
        .await
        {
            Ok(adm) => adm,
            Err(resp) => return resp,
        }
    } else if let Some(ticket) = &ticket_capability {
        // Ticket capability consumed
        let origin_str = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
        let consumed = match global_attachment_manager()
            .consume_ticket(&ticket, AttachmentPurpose::AgentCdp, origin_str)
            .await
        {
            Ok(c) => c,
            Err(err) => return err.into(),
        };
        ticket_expected_incarnation = Some(consumed.browser_incarnation.clone());
        ticket_expected_epoch = Some(consumed.profile_epoch);

        let adm = BrowserAdmission {
            principal: consumed.principal.clone(),
            is_dev: false,
            session_id: consumed.auth_session_id.clone(),
            auth_version: consumed.auth_version,
            credential_version: consumed.credential_version,
            effective_deadline: consumed.effective_deadline,
        };

        if let Err(err) = crate::browser_host::auth::verify_live_admission(&state, &adm).await {
            warn!(principal = %adm.principal, error = %err, "Ticket live auth check failed on CDP upgrade");
            return browser_error_response(StatusCode::UNAUTHORIZED, "invalidSession", "live authentication validation failed");
        }

        adm
    } else {
        return browser_error_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "authentication required for CDP gateway",
        );
    };

    // 2. Validate Origin
    if let Err(resp) = validate_cdp_origin(&headers, &state, has_bearer) {
        return resp;
    }

    // 3. Acquire capacity permit (max 2 agent connections globally by default)
    let permit = match global_cdp_gateway().try_acquire() {
        Ok(p) => p,
        Err(status) => {
            warn!("CDP gateway busy: maximum concurrent agent connections reached");
            return browser_error_response(
                status,
                "browserBusy",
                "maximum concurrent agent CDP connections reached (capacity is 2)",
            );
        }
    };

    // 4. Ensure principal instance is running
    let handle = match state
        .browser_host
        .ensure_running(&admission.principal, admission.is_dev)
        .await
    {
        Ok(h) => {
            if let Some(ref exp_inc) = ticket_expected_incarnation {
                if exp_inc != &h.browser_incarnation {
                    return browser_error_response(
                        StatusCode::UNAUTHORIZED,
                        "staleIncarnation",
                        "ticket browser incarnation does not match running instance",
                    );
                }
            }
            if let Some(exp_epoch) = ticket_expected_epoch {
                if exp_epoch != h.profile_epoch {
                    return browser_error_response(
                        StatusCode::UNAUTHORIZED,
                        "staleEpoch",
                        "ticket profile epoch does not match running instance",
                    );
                }
            }
            h
        }
        Err(err) => {
            return browser_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "browserUnavailable",
                &err.to_string(),
            );
        }
    };
    // 5. Determine upstream URL
    if let Some(tid) = &target_id {
        if tid.is_empty()
            || tid.len() > 128
            || !tid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return browser_error_response(
                StatusCode::BAD_REQUEST,
                "invalidTargetId",
                "target id must be 1-128 ascii alphanumeric or '-' / '_'",
            );
        }
    }

    let upstream_url = if let Some(tid) = &target_id {
        let chrome_port = match Url::parse(&handle.ws_endpoint)
            .ok()
            .and_then(|u| u.port())
        {
            Some(p) => p,
            None => {
                return browser_error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internalError",
                    "failed to parse DevTools port from browser process",
                );
            }
        };
        format!("ws://127.0.0.1:{chrome_port}/devtools/page/{tid}")
    } else {
        handle.ws_endpoint.clone()
    };

    warn!(
        principal = %admission.principal,
        target_id = ?target_id,
        "Agent attached to raw CDP gateway; raw CDP has instance-wide authority and bypasses input leases and fences"
    );
    let ws = match ws {
        Ok(upgrade) => upgrade,
        Err(rejection) => return rejection.into_response(),
    };
    let mut response_builder = ws
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES);

    if client_requested_cdp_protocol {
        response_builder = response_builder.protocols([CDP_SUBPROTOCOL]);
    }

    response_builder.on_upgrade(move |client_socket| {
        relay_agent_cdp_socket(client_socket, upstream_url, permit, state, admission)
    })
}

/// Bounded bidirectional upstream WebSocket relay.
/// Bounds:
/// - 4 MiB frame cap, 4 MiB message cap.
/// - 5s per-write deadline.
/// - Periodic 5s live auth admission check.
/// - Cancellation token check.
/// - Clean teardown of both sockets on any violation or close.
async fn relay_agent_cdp_socket(
    mut client_ws: WebSocket,
    upstream_url: String,
    _permit: CdpGatewayPermit,
    state: AppState,
    admission: BrowserAdmission,
) {
    let mut ws_config = WebSocketConfig::default();
    ws_config.max_message_size = Some(MAX_WS_MESSAGE_BYTES);
    ws_config.max_frame_size = Some(MAX_WS_MESSAGE_BYTES);

    let upstream_res = timeout(
        UPSTREAM_CONNECT_TIMEOUT,
        tokio_tungstenite::connect_async_with_config(&upstream_url, Some(ws_config), false),
    )
    .await;

    let (mut upstream_ws, _) = match upstream_res {
        Ok(Ok(pair)) => pair,
        Ok(Err(err)) => {
            warn!("Failed to connect to upstream browser CDP endpoint: {err}");
            let _ = timeout(Duration::from_millis(500), client_ws.send(AxumWsMessage::Close(None))).await;
            return;
        }
        Err(_) => {
            warn!("Timed out connecting to upstream browser CDP endpoint");
            let _ = timeout(Duration::from_millis(500), client_ws.send(AxumWsMessage::Close(None))).await;
            return;
        }
    };

    let (auth_abort_tx, mut auth_abort_rx) = tokio::sync::mpsc::channel::<()>(1);
    let state_for_auth = state.clone();
    let admission_for_auth = admission.clone();
    let auth_watcher = tokio::spawn(async move {
        let mut interval = tokio::time::interval(LIVE_CHECK_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await; // Skip immediate tick 0
        loop {
            interval.tick().await;
            if let Some(deadline) = admission_for_auth.effective_deadline {
                if chrono::Utc::now() >= deadline {
                    warn!(principal = %admission_for_auth.principal, "Agent CDP connection terminated: effective deadline reached");
                    let _ = auth_abort_tx.send(()).await;
                    break;
                }
            }
            if let Err(err) = verify_live_admission(&state_for_auth, &admission_for_auth).await {
                warn!(
                    principal = %admission_for_auth.principal,
                    "Agent CDP connection terminated: live admission check failed: {err}"
                );
                let _ = auth_abort_tx.send(()).await;
                break;
            }
        }
    });

    state.browser_host.register_agent_cdp(&admission.principal, admission.is_dev).await;

    let deadline_duration = admission
        .effective_deadline
        .and_then(|dl| dl.signed_duration_since(chrono::Utc::now()).to_std().ok())
        .unwrap_or(Duration::from_secs(86400 * 365));
    let deadline_sleep = tokio::time::sleep(deadline_duration);
    tokio::pin!(deadline_sleep);

    let mut aborted_by_auth = false;
    loop {
        tokio::select! {
            _ = &mut deadline_sleep => {
                warn!(principal = %admission.principal, "Agent CDP connection terminated: absolute deadline reached");
                aborted_by_auth = true;
                break;
            }
            _ = auth_abort_rx.recv() => {
                aborted_by_auth = true;
                break;
            }
            client_msg = client_ws.next() => {
                let (forwarded, aborted) = match client_msg {
                    Some(Ok(AxumWsMessage::Text(t))) => {
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Text(t.as_str().into())),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(AxumWsMessage::Binary(b))) => {
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Binary(b)),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(AxumWsMessage::Ping(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Ping(p)),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(AxumWsMessage::Pong(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Pong(p)),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(AxumWsMessage::Close(_))) | Some(Err(_)) | None => (false, false),
                };
                if aborted {
                    aborted_by_auth = true;
                    break;
                }
                if !forwarded {
                    break;
                }
            }
            upstream_msg = upstream_ws.next() => {
                let (forwarded, aborted) = match upstream_msg {
                    Some(Ok(UpstreamMessage::Text(t))) => {
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Text(t.as_str().into())),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(UpstreamMessage::Binary(b))) => {
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Binary(b)),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(UpstreamMessage::Ping(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Ping(p)),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(UpstreamMessage::Pong(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Pong(p)),
                            &mut auth_abort_rx,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(UpstreamMessage::Frame(_))) => (true, false),
                    Some(Ok(UpstreamMessage::Close(_))) | Some(Err(_)) | None => (false, false),
                };
                if aborted {
                    aborted_by_auth = true;
                    break;
                }
                if !forwarded {
                    break;
                }
            }
        }
    }
    auth_watcher.abort();

    state.browser_host.unregister_agent_cdp(&admission.principal, admission.is_dev).await;

    // Best effort bounded close (skip slow close if aborted due to auth failure)
    if !aborted_by_auth {
        let _ = timeout(Duration::from_millis(500), upstream_ws.close(None)).await;
        let _ = timeout(Duration::from_millis(500), client_ws.send(AxumWsMessage::Close(None))).await;
    }
    debug!(principal = %admission.principal, "CDP gateway relay closed");
}
