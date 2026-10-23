//! Dedicated WebSocket endpoint (`/ws/semantic/v1`) exposing the filtered
//! semantic language server protocol.
//!
//! Enforces:
//! - Exact subprotocol: `dam-hopper.semantic.lsp.v1`.
//! - Authentication and Origin allowlist parity with core `/ws`.
//! - Dedicated 4 MiB frame/message limit and token-bucket rate limiter.
//! - Cancellation-first live auth watcher: invalidates supervisor admission and reaps
//!   child process trees BEFORE any socket message delivery.
//! - Independent writer/reader loops ensuring slow or blocked consumers cannot delay
//!   resource reclamation.

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum_extra::extract::CookieJar;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use tracing::{debug, warn};

use super::auth::AUTH_COOKIE;
use super::ws::websocket_origin_allowed;
use crate::api::auth::AuthenticatedActor;
use crate::semantic::gateway::{json_rpc_error, SemanticGateway, RPC_ERR_PARSE_ERROR};
use crate::semantic::protocol::ConnectionId;
use crate::semantic::resources::{
    AUTH_STORE_LOOKUP_TIMEOUT, MAX_FRAME_BODY_BYTES, MAX_QUEUED_MESSAGES, MESSAGE_RATE_BURST,
    MESSAGE_RATE_PER_SEC, SOCKET_SEND_TIMEOUT,
};
use crate::state::AppState;
/// Exact required WebSocket subprotocol for DamHopper semantic LSP v1.
pub const SEMANTIC_SUBPROTOCOL: &str = "dam-hopper.semantic.lsp.v1";

/// Close codes for semantic WebSocket connections.
pub const CLOSE_POLICY_VIOLATION: u16 = 1008;
pub const CLOSE_INTERNAL_ERROR: u16 = 1011;
pub const CLOSE_FULL_LOGIN_REQUIRED: u16 = 4401;
pub const CLOSE_MFA_REQUIRED: u16 = 4403;
pub const CLOSE_AUTH_UNAVAILABLE: u16 = 1013;

/// In-memory token-bucket rate limiter for semantic WebSocket messages.
struct TokenBucketRateLimiter {
    capacity: f64,
    tokens: f64,
    refill_rate_per_sec: f64,
    last_refill: Instant,
}

impl TokenBucketRateLimiter {
    fn new(rate_per_sec: u32, burst: u32) -> Self {
        Self {
            capacity: burst as f64,
            tokens: burst as f64,
            refill_rate_per_sec: rate_per_sec as f64,
            last_refill: Instant::now(),
        }
    }

    fn try_consume(&mut self, cost: f64) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.last_refill = now;
        self.tokens = (self.tokens + elapsed * self.refill_rate_per_sec).min(self.capacity);

        if self.tokens >= cost {
            self.tokens -= cost;
            true
        } else {
            false
        }
    }
}

/// WebSocket upgrade handler for `/ws/semantic/v1`.
pub async fn semantic_ws_handler(
    upgrade: WebSocketUpgrade,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    jar: CookieJar,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    // 1. Exact subprotocol negotiation
    let client_subprotocol = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok());

    match client_subprotocol {
        Some(protocols) => {
            let matches = protocols
                .split(',')
                .map(str::trim)
                .any(|p| p == SEMANTIC_SUBPROTOCOL);
            if !matches {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(json!({
                        "error": format!("Sec-WebSocket-Protocol must negotiate '{SEMANTIC_SUBPROTOCOL}'"),
                        "code": "INVALID_SUBPROTOCOL",
                    })),
                )
                    .into_response();
            }
        }
        None => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(json!({
                    "error": format!("Sec-WebSocket-Protocol header is required and must negotiate '{SEMANTIC_SUBPROTOCOL}'"),
                    "code": "SUBPROTOCOL_REQUIRED",
                })),
            )
                .into_response();
        }
    }

    // 2. Origin check: matches core /ws policy exactly
    let origin_ok = websocket_origin_allowed(
        state.no_auth,
        headers.contains_key(header::ORIGIN),
        state.origin_is_allowed(&headers),
        params.contains_key("token"),
    );

    if !origin_ok {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(json!({ "error": "Origin not allowed" })),
        )
            .into_response();
    }

    // 3. Token extraction: query parameter takes precedence over cookie
    let token = params
        .get("token")
        .cloned()
        .or_else(|| jar.get(AUTH_COOKIE).map(|c| c.value().to_string()));

    // 4. Authenticated actor evaluation
    let actor = if state.no_auth {
        crate::api::auth::AuthenticatedActor::dev_user()
    } else {
        let Some(t) = token else {
            return (
                StatusCode::UNAUTHORIZED,
                axum::Json(json!({
                    "error": "Authentication required",
                    "code": "AUTH_REQUIRED"
                })),
            )
                .into_response();
        };

        let Some(claims) = crate::auth::model::AuthClaims::decode(&t, &state.jwt_secret) else {
            return (
                StatusCode::UNAUTHORIZED,
                axum::Json(json!({
                    "error": "Session token invalid or legacy format",
                    "code": "AUTH_REQUIRED"
                })),
            )
                .into_response();
        };

        match state.auth_service.evaluate_claims(&claims).await {
            crate::auth::model::AuthDecision::Authenticated { session, user } => {
                let expires_at = crate::auth::model::bson_to_chrono(session.expires_at);
                let mfa_verified_at = crate::auth::model::bson_to_chrono(session.mfa_verified_at);
                let effective_deadline =
                    crate::auth::policy::compute_mfa_due_at(mfa_verified_at, expires_at);
                crate::api::auth::AuthenticatedActor::with_session(
                    user.username.clone(),
                    Some(expires_at.timestamp() as usize),
                    session.id.clone(),
                    session.auth_version,
                    session.credential_version,
                    effective_deadline,
                    user.role,
                )
            }
            crate::auth::model::AuthDecision::MfaRequired { .. } => {
                return (
                    StatusCode::UNAUTHORIZED,
                    axum::Json(json!({
                        "error": "MFA verification required",
                        "code": "MFA_REQUIRED"
                    })),
                )
                    .into_response();
            }
            crate::auth::model::AuthDecision::FullLoginRequired { reason } => {
                let code = if reason.contains("expired") {
                    "SESSION_EXPIRED"
                } else if reason.contains("revoked")
                    || reason.contains("superseded")
                    || reason.contains("version")
                {
                    "SESSION_REVOKED"
                } else if reason.contains("disabled") {
                    "ACCOUNT_DISABLED"
                } else {
                    "AUTH_REQUIRED"
                };
                return (
                    StatusCode::UNAUTHORIZED,
                    axum::Json(json!({
                        "error": reason,
                        "code": code
                    })),
                )
                    .into_response();
            }
            crate::auth::model::AuthDecision::Unavailable { reason } => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    axum::Json(json!({
                        "error": format!("Authentication backend unavailable: {reason}"),
                        "code": "AUTH_UNAVAILABLE"
                    })),
                )
                    .into_response();
            }
        }
    };

    // 5. Client presence admission reservation
    let pending_guard = match state.client_presence.reserve_pending_upgrade(actor.clone()) {
        Ok(guard) => guard,
        Err(err) => {
            warn!(%err, "Rejecting semantic WebSocket upgrade due to presence admission failure");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(json!({
                    "error": err.to_string(),
                    "code": "PRESENCE_UNAVAILABLE",
                })),
            )
                .into_response();
        }
    };

    // 6. Enforce 4 MiB frame/message limit and negotiate subprotocol
    let upgrade = upgrade
        .protocols([SEMANTIC_SUBPROTOCOL])
        .max_frame_size(MAX_FRAME_BODY_BYTES)
        .max_message_size(MAX_FRAME_BODY_BYTES);

    upgrade.on_upgrade(move |socket| handle_semantic_socket(socket, state, actor, pending_guard))
}

/// Socket session handler with dedicated reader, writer, and cancellation-first live auth watcher.
async fn handle_semantic_socket(
    socket: WebSocket,
    state: AppState,
    actor: AuthenticatedActor,
    pending_guard: crate::idle_suspend::client_presence::PendingUpgradeGuard,
) {
    let connection_id = ConnectionId(format!("semantic-{}", uuid::Uuid::new_v4()));

    // Promote pending upgrade reservation to an active presence connection
    let capability_secret = uuid::Uuid::new_v4().to_string();
    let presence_guard = match pending_guard.promote(connection_id.0.clone(), &capability_secret) {
        Ok(g) => g,
        Err(err) => {
            warn!(%err, "Failed to promote presence reservation to active presence");
            return;
        }
    };

    let start_admission_epoch = state
        .semantic_supervisor
        .register_connection(&connection_id)
        .await;

    let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(MAX_QUEUED_MESSAGES);
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let (close_tx, close_rx) = watch::channel::<Option<(u16, String)>>(None);

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Spawn dedicated writer task with bounded send timeouts
    let mut cancel_rx_writer = cancel_rx.clone();
    let cancel_tx_writer = cancel_tx.clone();
    let close_rx_writer = close_rx.clone();
    let writer_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = cancel_rx_writer.changed() => {
                    break;
                }
                msg_opt = outbound_rx.recv() => {
                    match msg_opt {
                        Some(text) => {
                            let send_res = tokio::time::timeout(
                                SOCKET_SEND_TIMEOUT,
                                ws_sink.send(Message::Text(text.into())),
                            )
                            .await;
                            if send_res.is_err() || matches!(send_res, Ok(Err(_))) {
                                break;
                            }
                        }
                        None => break,
                    }
                }
            }
        }
        let close_info = close_rx_writer.borrow().clone();
        let (code, reason) = close_info.unwrap_or((1000, "Normal closure".to_string()));
        let _ = tokio::time::timeout(
            SOCKET_SEND_TIMEOUT,
            ws_sink.send(Message::Close(Some(CloseFrame {
                code,
                reason: reason.into(),
            }))),
        )
        .await;
        let _ = cancel_tx_writer.send(true);
    });

    // Spawn live auth watcher: cancellation-first invalidation
    let auth_watcher_task = if !state.no_auth && actor.session_id.is_some() {
        let state_c = state.clone();
        let actor_c = actor.clone();
        let conn_id_c = connection_id.clone();
        let cancel_tx_c = cancel_tx.clone();
        let close_tx_c = close_tx.clone();
        let mut cancel_rx_watcher = cancel_rx.clone();

        Some(tokio::spawn(async move {
            let session_id = actor_c.session_id.clone().unwrap();
            let auth_version = actor_c.auth_version.unwrap_or(0);
            let credential_version = actor_c.credential_version.unwrap_or(0);
            let effective_deadline = actor_c.effective_deadline;
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            interval.tick().await;

            loop {
                tokio::select! {
                    _ = cancel_rx_watcher.changed() => break,
                    _ = interval.tick() => {
                        let now = state_c.auth_service.clock().now();
                        let mut invalidate_reason: Option<(u16, &str)> = None;

                        if let Some(deadline) = effective_deadline {
                            if now >= deadline {
                                let is_expired = actor_c.exp.map(|e| now.timestamp() as usize >= e).unwrap_or(false);
                                let (code, reason) = if is_expired {
                                    (CLOSE_FULL_LOGIN_REQUIRED, "Session expired")
                                } else {
                                    (CLOSE_MFA_REQUIRED, "MFA verification required")
                                };
                                invalidate_reason = Some((code, reason));
                            }
                        }

                        if invalidate_reason.is_none() {
                            if let Some(store) = state_c.auth_service.store() {
                                let check_res = tokio::time::timeout(AUTH_STORE_LOOKUP_TIMEOUT, async {
                                    let session = store.get_session(&session_id).await?;
                                    let user = store.get_user(&actor_c.subject).await?;
                                    Ok::<_, crate::auth::store::StoreError>((session, user))
                                }).await;

                                match check_res {
                                    Ok(Ok((Some(session), Some(user)))) => {
                                        if !user.is_enabled
                                            || session.revoked_at.is_some()
                                            || session.auth_version != auth_version
                                            || user.auth_version != auth_version
                                            || session.auth_version != user.auth_version
                                            || session.credential_version != credential_version
                                        {
                                            invalidate_reason = Some((CLOSE_FULL_LOGIN_REQUIRED, "Session revoked or account modified"));
                                        } else {
                                            let expires_at = crate::auth::model::bson_to_chrono(session.expires_at);
                                            let mfa_verified_at = crate::auth::model::bson_to_chrono(session.mfa_verified_at);
                                            let mfa_due_at = crate::auth::policy::compute_mfa_due_at(mfa_verified_at, expires_at);
                                            if now >= mfa_due_at {
                                                let is_expired = now >= expires_at;
                                                let (code, reason) = if is_expired {
                                                    (CLOSE_FULL_LOGIN_REQUIRED, "Session expired")
                                                } else {
                                                    (CLOSE_MFA_REQUIRED, "MFA verification required")
                                                };
                                                invalidate_reason = Some((code, reason));
                                            }
                                        }
                                    }
                                    Ok(Ok((None, _))) | Ok(Ok((_, None))) => {
                                        invalidate_reason = Some((CLOSE_FULL_LOGIN_REQUIRED, "Session or user not found"));
                                    }
                                    Ok(Err(e)) => {
                                        warn!(error = %e, "Live auth store query failed during semantic check");
                                        invalidate_reason = Some((CLOSE_AUTH_UNAVAILABLE, "Authentication verification failed"));
                                    }
                                    Err(_) => {
                                        warn!("Live auth store query timed out during semantic check; failing closed");
                                        invalidate_reason = Some((CLOSE_AUTH_UNAVAILABLE, "Authentication check timed out"));
                                    }
                                }
                            }
                        }

                        if let Some((code, reason)) = invalidate_reason {
                            warn!(reason = %reason, "Live auth invalidation detected; triggering cancellation-first teardown");

                            // 1. Invalidate admission and reap trees FIRST before any socket operation
                            state_c.semantic_supervisor.invalidate_connection(&conn_id_c).await;

                            // 2. Deliver actual auth close code to writer
                            let _ = close_tx_c.send(Some((code, reason.to_string())));

                            // 3. Signal cancel to reader and writer loops
                            let _ = cancel_tx_c.send(true);
                            break;
                        }
                    }
                }
            }
        }))
    } else {
        None
    };

    // Instantiate semantic gateway
    let mut gateway = SemanticGateway::new(
        connection_id.clone(),
        state.clone(),
        actor,
        start_admission_epoch,
        outbound_tx.clone(),
    );

    let mut rate_limiter = TokenBucketRateLimiter::new(MESSAGE_RATE_PER_SEC, MESSAGE_RATE_BURST);

    // Reader loop: process incoming messages sequentially
    loop {
        tokio::select! {
            biased;
            _ = cancel_rx.changed() => {
                break;
            }
            msg_res = tokio::time::timeout(Duration::from_secs(60), ws_stream.next()) => {
                match msg_res {
                    Ok(Some(Ok(Message::Text(text)))) => {
                        // Rate limiter check (1 token per message)
                        if !rate_limiter.try_consume(1.0) {
                            warn!("Semantic message rate limit exceeded; throttling");
                            let err_msg = json_rpc_error(
                                serde_json::Value::Null,
                                -32004,
                                "Rate limit exceeded (40 msg/s, burst 80)",
                                Some("RATE_LIMIT_EXCEEDED"),
                            );
                            let _ = tokio::time::timeout(
                                SOCKET_SEND_TIMEOUT,
                                outbound_tx.send(err_msg.to_string()),
                            )
                            .await;
                            continue;
                        }

                        if let Err(e) = gateway.handle_incoming_text(&text).await {
                            warn!(error = ?e, "Gateway handled text error");
                        }
                    }
                    Ok(Some(Ok(Message::Binary(_)))) => {
                        // Rate limiter check
                        let _ = rate_limiter.try_consume(1.0);

                        // Binary payloads are strictly forbidden in semantic JSON-RPC profile
                        let err_msg = json_rpc_error(
                            serde_json::Value::Null,
                            RPC_ERR_PARSE_ERROR,
                            "Binary messages are not permitted in semantic protocol",
                            None,
                        );
                        let _ = tokio::time::timeout(
                            SOCKET_SEND_TIMEOUT,
                            outbound_tx.send(err_msg.to_string()),
                        )
                        .await;
                    }
                    Ok(Some(Ok(Message::Ping(_)))) | Ok(Some(Ok(Message::Pong(_)))) => {
                        // Axum handles ping/pong automatically
                    }
                    Ok(Some(Ok(Message::Close(_)))) => {
                        debug!("Client sent WebSocket close");
                        break;
                    }
                    Ok(Some(Err(e))) => {
                        warn!(error = %e, "WebSocket stream error");
                        break;
                    }
                    Ok(None) => {
                        // Client disconnected
                        break;
                    }
                    Err(_) => {
                        // 60-second inactivity timeout (no messages/pings received from peer)
                        warn!("Semantic WebSocket 60s inactivity timeout; closing half-open connection");
                        break;
                    }
                }
            }
        }
    }
    let _ = cancel_tx.send(true);

    if let Some(task) = auth_watcher_task {
        task.abort();
    }

    gateway.teardown().await;

    // Bounded wait for writer task to finish sending close frame
    let _ = tokio::time::timeout(SOCKET_SEND_TIMEOUT, writer_task).await;
    drop(presence_guard);
}
