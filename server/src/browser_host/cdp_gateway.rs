use std::future::Future;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Extension, Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message as UpstreamMessage;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use url::Url;

use crate::api::auth::AuthenticatedActor;
use crate::api::browser_host::{
    authenticate_browser_caller, browser_error_response, global_attachment_manager,
    no_store_response,
};
use crate::browser_host::attachments::AttachmentPurpose;
use crate::browser_host::auth::{
    validate_request_origin, verify_live_admission, BrowserAdmission, LIVE_CHECK_INTERVAL,
};
use crate::browser_host::config::PublicServerOrigin;
use crate::browser_host::diagnostics::global_memory_controller;
use crate::browser_host::protocol::MAX_WS_MESSAGE_BYTES;
use crate::browser_host::raw_geometry_fence::handle_client_cdp_message;
use crate::browser_host::raw_session_targets::RawSessionTargets;
use crate::state::AppState;

pub const DEFAULT_MAX_AGENT_CDP_CONNECTIONS: usize = 2;
pub const MAX_AGENT_CDP_CAPACITY: usize = 8;
pub const WRITE_DEADLINE: Duration = Duration::from_secs(5);
pub const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub const CDP_SUBPROTOCOL: &str = "damhopper.browser.cdp.v1";
pub const TICKET_SUBPROTOCOL_PREFIX: &str = "damhopper.ticket.";

pub static GLOBAL_CDP_GATEWAY: LazyLock<CdpGatewayManager> =
    LazyLock::new(|| CdpGatewayManager::new(MAX_AGENT_CDP_CAPACITY));

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
    deadline_at: Option<tokio::time::Instant>,
    cancel: Option<&CancellationToken>,
) -> (WriteOutcome, bool)
where
    F: Future<Output = Result<(), E>>,
{
    let write_fut = write_with_outcome(write);
    let cancel_fut = async {
        match cancel {
            Some(token) => token.cancelled().await,
            None => std::future::pending::<()>().await,
        }
    };
    if let Some(dl) = deadline_at {
        let sleep_fut = tokio::time::sleep_until(dl);
        tokio::select! {
            _ = cancel_fut => (WriteOutcome::Failed, true),
            _ = abort_rx.recv() => (WriteOutcome::Failed, true),
            _ = sleep_fut => (WriteOutcome::DeadlineElapsed, true),
            outcome = write_fut => (outcome, false),
        }
    } else {
        tokio::select! {
            _ = cancel_fut => (WriteOutcome::Failed, true),
            _ = abort_rx.recv() => (WriteOutcome::Failed, true),
            outcome = write_fut => (outcome, false),
        }
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

    pub fn try_acquire_with_limit(
        &self,
        max_allowed: usize,
    ) -> Result<CdpGatewayPermit, StatusCode> {
        let current = self.active_connections.load(Ordering::SeqCst);
        if current >= max_allowed {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        let permit = self
            .semaphore
            .clone()
            .try_acquire_owned()
            .map_err(|_| StatusCode::TOO_MANY_REQUESTS)?;
        let prev = self.active_connections.fetch_add(1, Ordering::SeqCst);
        if prev >= max_allowed {
            self.active_connections.fetch_sub(1, Ordering::SeqCst);
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        Ok(CdpGatewayPermit {
            _permit: permit,
            counter: self.active_connections.clone(),
        })
    }

    pub fn try_acquire(&self) -> Result<CdpGatewayPermit, StatusCode> {
        self.try_acquire_with_limit(DEFAULT_MAX_AGENT_CDP_CONNECTIONS)
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

/// Resolves the trusted public origin used to rewrite discovery WebSocket URLs.
///
/// Only the parsed operator-configured origin (`DAM_HOPPER_PUBLIC_SERVER_ORIGIN`, scheme and
/// authority only) is trusted; in guarded development with a loopback bound listener the
/// verified bound socket address is used instead. The request `Host` and forwarded headers
/// are never consulted, so an unconfigured or invalid origin rejects discovery rather than
/// advertising an attacker-controlled destination for the next authenticated connection.
pub fn resolve_gateway_public_origin(state: &AppState) -> Option<PublicServerOrigin> {
    if let Some(public) = state.public_server_origin.as_deref() {
        return Some(public.clone());
    }
    if state.no_auth {
        if let Some(bound) = state
            .bound_listener()
            .filter(|a| crate::browser_host::auth::is_loopback_ip(a.ip()))
        {
            return Some(PublicServerOrigin::from_listener_addr(bound));
        }
    }
    None
}

/// 503 for discovery when [`resolve_gateway_public_origin`] has no trusted origin.
fn public_origin_unavailable_response() -> Response {
    warn!("CDP discovery rejected: no trusted public server origin is configured");
    browser_error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        "publicOriginUnavailable",
        "a valid DAM_HOPPER_PUBLIC_SERVER_ORIGIN is required for raw CDP discovery",
    )
}

/// Validates the Origin header for raw CDP discovery and upgrades (architecture-contracts §5):
/// - Origin-bearing requests must exactly match the unified approved-origin set, even with a
///   valid bearer; `null`, empty, malformed, non-UTF8, repeated and non-approved values (and an
///   empty allowlist) are rejected with 403 Forbidden.
/// - Origin-less requests are permitted ONLY for Authorization-header authenticated clients.
pub fn validate_cdp_origin(
    headers: &HeaderMap,
    state: &AppState,
    has_bearer_auth: bool,
) -> Result<(), Response> {
    match validate_request_origin(state, headers) {
        Ok(Some(_)) => Ok(()),
        Ok(None) if has_bearer_auth => Ok(()),
        Ok(None) => {
            warn!("Origin-less CDP request rejected: missing Authorization header");
            Err(browser_error_response(
                StatusCode::FORBIDDEN,
                "forbiddenOrigin",
                "Origin-less request requires Authorization header bearer authentication",
            ))
        }
        Err(err) => {
            warn!(error = %err, "CDP request rejected: Origin not approved");
            Err(browser_error_response(
                StatusCode::FORBIDDEN,
                "forbiddenOrigin",
                &err.to_string(),
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

pub(crate) async fn read_bounded_bytes(
    mut resp: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, &'static str> {
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| "read_failed")? {
        if buf.len().saturating_add(chunk.len()) > max_bytes {
            return Err("exceeded_bound");
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
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
    // Fail before touching the browser when no trusted public origin can be advertised.
    let Some(public) = resolve_gateway_public_origin(&state) else {
        return public_origin_unavailable_response();
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

    let chrome_port = match Url::parse(&handle.ws_endpoint).ok().and_then(|u| u.port()) {
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

    let bytes = match read_bounded_bytes(resp, 65536).await {
        Ok(b) => b,
        Err("exceeded_bound") => {
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

    let ws_base = public.ws_base();
    val["webSocketDebuggerUrl"] = json!(format!("{ws_base}/api/browser/cdp/ws"));

    // Sanitize devtoolsFrontendUrl if present so it doesn't leak internal loopback
    if let Some(frontend_url) = val.get_mut("devtoolsFrontendUrl") {
        if let Some(s) = frontend_url.as_str() {
            let sanitized = s.replace(&format!("127.0.0.1:{chrome_port}"), public.authority());
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
    // Fail before touching the browser when no trusted public origin can be advertised.
    let Some(public) = resolve_gateway_public_origin(&state) else {
        return public_origin_unavailable_response();
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

    let chrome_port = match Url::parse(&handle.ws_endpoint).ok().and_then(|u| u.port()) {
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

    let bytes = match read_bounded_bytes(resp, 262144).await {
        Ok(b) => b,
        Err("exceeded_bound") => {
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

    let ws_base = public.ws_base();
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
                    let sanitized =
                        s.replace(&format!("127.0.0.1:{chrome_port}"), public.authority());
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
            return browser_error_response(
                StatusCode::UNAUTHORIZED,
                "invalidSession",
                "live authentication validation failed",
            );
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

    // 3. Acquire capacity permit (governed by config.browser.budgets.max_raw_cdp_connections)
    let max_connections = state.browser_host.config().budgets.max_raw_cdp_connections;
    let permit = match global_cdp_gateway().try_acquire_with_limit(max_connections) {
        Ok(p) => p,
        Err(status) => {
            warn!(
                max_connections,
                "CDP gateway busy: maximum concurrent agent connections reached"
            );
            return browser_error_response(
                status,
                "browserBusy",
                &format!("maximum concurrent agent CDP connections reached (capacity is {max_connections})"),
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
    // Browser startup can take long: re-verify live authority before upgrading so a principal
    // revoked or demoted during setup never reaches the upstream relay.
    if let Err(err) = verify_live_admission(&state, &admission).await {
        warn!(principal = %admission.principal, error = %err, "CDP upgrade rejected: live admission failed after setup");
        return browser_error_response(
            StatusCode::UNAUTHORIZED,
            "invalidSession",
            "live authentication validation failed",
        );
    }
    // 5. Determine upstream URL
    if let Some(tid) = &target_id {
        if tid.is_empty()
            || tid.len() > 128
            || !tid
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return browser_error_response(
                StatusCode::BAD_REQUEST,
                "invalidTargetId",
                "target id must be 1-128 ascii alphanumeric or '-' / '_'",
            );
        }
    }

    let upstream_url = if let Some(tid) = &target_id {
        let chrome_port = match Url::parse(&handle.ws_endpoint).ok().and_then(|u| u.port()) {
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
        relay_agent_cdp_socket(client_socket, upstream_url, permit, state, admission, target_id)
    })
}

pub(crate) struct AbortOnDrop(pub(crate) Option<tokio::task::JoinHandle<()>>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            handle.abort();
        }
    }
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
    page_target: Option<String>,
) {
    let mut ws_config = WebSocketConfig::default();
    ws_config.max_message_size = Some(MAX_WS_MESSAGE_BYTES);
    ws_config.max_frame_size = Some(MAX_WS_MESSAGE_BYTES);

    let (deadline_duration, deadline_instant) = match admission.effective_deadline {
        Some(dl) => {
            let now = chrono::Utc::now();
            if now >= dl {
                warn!(principal = %admission.principal, "Agent CDP connection rejected: effective deadline already elapsed");
                let _ = timeout(
                    Duration::from_millis(500),
                    client_ws.send(AxumWsMessage::Close(None)),
                )
                .await;
                return;
            }
            let rem_std = dl
                .signed_duration_since(now)
                .to_std()
                .unwrap_or(Duration::from_millis(1));
            let inst = tokio::time::Instant::now() + rem_std;
            (rem_std, inst)
        }
        None => (
            Duration::from_secs(86400 * 365),
            tokio::time::Instant::now() + Duration::from_secs(86400 * 365),
        ),
    };

    // Live-auth supervision starts before any setup await (upstream connect, registration), so
    // a revoked/demoted principal cannot hold a half-set-up connection past one check interval.
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
    let _watcher_guard = AbortOnDrop(Some(auth_watcher));

    let connect_timeout = deadline_duration.min(UPSTREAM_CONNECT_TIMEOUT);

    let upstream_res = tokio::select! {
        _ = auth_abort_rx.recv() => {
            warn!(principal = %admission.principal, "Agent CDP connection aborted by auth during upstream connect");
            let _ = timeout(Duration::from_millis(500), client_ws.send(AxumWsMessage::Close(None))).await;
            return;
        }
        res = timeout(
            connect_timeout,
            tokio_tungstenite::connect_async_with_config(&upstream_url, Some(ws_config), false),
        ) => res,
    };

    let (mut upstream_ws, _) = match upstream_res {
        Ok(Ok(pair)) => pair,
        Ok(Err(err)) => {
            warn!("Failed to connect to upstream browser CDP endpoint: {err}");
            let _ = timeout(
                Duration::from_millis(500),
                client_ws.send(AxumWsMessage::Close(None)),
            )
            .await;
            return;
        }
        Err(_) => {
            warn!("Timed out connecting to upstream browser CDP endpoint");
            let _ = timeout(
                Duration::from_millis(500),
                client_ws.send(AxumWsMessage::Close(None)),
            )
            .await;
            return;
        }
    };

    let reg_fut = state
        .browser_host
        .register_agent_cdp(&admission.principal, admission.is_dev);
    tokio::select! {
        _ = auth_abort_rx.recv() => {
            warn!(principal = %admission.principal, "Agent CDP connection aborted by auth during registration");
            let _ = timeout(Duration::from_millis(500), client_ws.send(AxumWsMessage::Close(None))).await;
            return;
        }
        _ = tokio::time::sleep_until(deadline_instant) => {
            warn!(principal = %admission.principal, "Agent CDP registration timed out: deadline reached");
            let _ = timeout(Duration::from_millis(500), client_ws.send(AxumWsMessage::Close(None))).await;
            return;
        }
        _ = reg_fut => {}
    }

    let deadline_sleep = tokio::time::sleep_until(deadline_instant);
    tokio::pin!(deadline_sleep);
    let mut raw_targets = RawSessionTargets::new(page_target);
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
                        // The incoming text stays alive during the send and `.into()` below copies it.
                        let Ok(_resident) = global_memory_controller().try_reserve(t.len().saturating_mul(2)) else {
                            warn!(principal = %admission.principal, "Agent CDP relay closed: payload memory budget exhausted");
                            break;
                        };
                        let handle_fut = handle_client_cdp_message(t.as_str(), &admission.principal, admission.is_dev, &mut raw_targets);
                        let aborted_during_handle = tokio::select! {
                            _ = auth_abort_rx.recv() => true,
                            _ = tokio::time::sleep_until(deadline_instant) => true,
                            _ = handle_fut => false,
                        };
                        if aborted_during_handle {
                            aborted_by_auth = true;
                            break;
                        }
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Text(t.as_str().into())),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(AxumWsMessage::Binary(b))) => {
                        let Ok(_resident) = global_memory_controller().try_reserve(b.len()) else {
                            warn!(principal = %admission.principal, "Agent CDP relay closed: payload memory budget exhausted");
                            break;
                        };
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Binary(b)),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(AxumWsMessage::Ping(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Ping(p)),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(AxumWsMessage::Pong(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            upstream_ws.send(UpstreamMessage::Pong(p)),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
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
                        // The incoming text stays alive during the send and `.into()` below copies it.
                        let Ok(_resident) = global_memory_controller().try_reserve(t.len().saturating_mul(2)) else {
                            warn!(principal = %admission.principal, "Agent CDP relay closed: payload memory budget exhausted");
                            break;
                        };
                        raw_targets.observe_upstream(t.as_str());
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Text(t.as_str().into())),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(UpstreamMessage::Binary(b))) => {
                        let Ok(_resident) = global_memory_controller().try_reserve(b.len()) else {
                            warn!(principal = %admission.principal, "Agent CDP relay closed: payload memory budget exhausted");
                            break;
                        };
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Binary(b)),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(UpstreamMessage::Ping(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Ping(p)),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
                        ).await;
                        (outcome == WriteOutcome::Ok, aborted)
                    }
                    Some(Ok(UpstreamMessage::Pong(p))) => {
                        let (outcome, aborted) = write_with_cancel(
                            client_ws.send(AxumWsMessage::Pong(p)),
                            &mut auth_abort_rx,
                            Some(deadline_instant),
                            None,
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

    // Fast teardown: drop sockets immediately to cancel physical network transports,
    // avoiding lock contention delays during manager accounting.
    if !aborted_by_auth {
        let _ = timeout(Duration::from_millis(500), upstream_ws.close(None)).await;
        let _ = timeout(
            Duration::from_millis(500),
            client_ws.send(AxumWsMessage::Close(None)),
        )
        .await;
    }
    drop(upstream_ws);
    drop(client_ws);
    drop(_permit); // Free capacity permit immediately before slow manager unregister

    state
        .browser_host
        .unregister_agent_cdp(&admission.principal, admission.is_dev)
        .await;
    debug!(principal = %admission.principal, "CDP gateway relay closed");
}
