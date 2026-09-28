use std::net::SocketAddr;
use std::time::Duration;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use tokio::time::Instant;

use super::runtime::{AgentStatusRuntime, TokenAuthResult};
use super::types::{
    AgentKind, AgentStatusAvailability, ReporterHello,
    ReporterRejected, ReporterReport, AGENT_STATUS_PROTOCOL_VERSION, AGENT_STATUS_WS_PATH,
    BURST_REPORTS, HELLO_TIMEOUT_SECS, MAX_PRE_AUTH_CONCURRENCY, MAX_PRIVATE_FRAME_BYTES,
    MAX_REPORTS_PER_SEC,
};

static PRE_AUTH_SEMAPHORE: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| tokio::sync::Semaphore::new(MAX_PRE_AUTH_CONCURRENCY));

/// Private loopback collector handle serving the authenticated agent status WebSocket route.
pub struct AgentStatusCollector {
    local_addr: SocketAddr,
    ws_url: String,
    server_task: tokio::task::JoinHandle<()>,
}

impl AgentStatusCollector {
    /// Bind collector to the specified loopback socket address and start serving.
    pub async fn bind(
        runtime: AgentStatusRuntime,
        addr: SocketAddr,
    ) -> Result<Self, std::io::Error> {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        let local_addr = listener.local_addr()?;
        let ws_url = format!("ws://127.0.0.1:{}{}", local_addr.port(), AGENT_STATUS_WS_PATH);

        runtime.set_listener(ws_url.clone(), AgentStatusAvailability::Ready);

        let app = Router::new()
            .route(AGENT_STATUS_WS_PATH, get(ws_upgrade_handler))
            .with_state(runtime);

        let server_task = tokio::spawn(async move {
            let make_service = app.into_make_service_with_connect_info::<SocketAddr>();
            if let Err(e) = axum::serve(listener, make_service).await {
                tracing::warn!(error = %e, "Agent status collector server error");
            }
        });

        Ok(Self {
            local_addr,
            ws_url,
            server_task,
        })
    }

    /// Bound socket address.
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// Complete WebSocket URL advertised to terminal children.
    pub fn ws_url(&self) -> &str {
        &self.ws_url
    }

    /// Shut down the collector listener task.
    pub fn shutdown(self) {
        self.server_task.abort();
    }
}

/// HTTP handler enforcing loopback, Host, scheme, Origin rejection, and capability authentication.
async fn ws_upgrade_handler(
    upgrade: WebSocketUpgrade,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    State(runtime): State<AgentStatusRuntime>,
) -> Response {
    // 1. Peer address must be loopback
    if !peer_addr.ip().is_loopback() {
        return (StatusCode::FORBIDDEN, "Peer must be loopback").into_response();
    }

    // 2. Reject any query parameters (credentials in query strings strictly forbidden)
    if uri.query().is_some() {
        return (StatusCode::BAD_REQUEST, "Query parameters forbidden").into_response();
    }

    // 3. Exact loopback Host header check
    let Some(host_val) = headers.get(header::HOST).and_then(|h| h.to_str().ok()) else {
        return (StatusCode::BAD_REQUEST, "Missing Host header").into_response();
    };
    let host_is_loopback = host_val.starts_with("127.0.0.1:")
        || host_val.starts_with("localhost:")
        || host_val.starts_with("[::1]:")
        || host_val == "127.0.0.1"
        || host_val == "localhost"
        || host_val == "[::1]";
    if !host_is_loopback {
        return (StatusCode::BAD_REQUEST, "Host must be loopback").into_response();
    }

    // 4. Reject browser Origin header
    if headers.contains_key(header::ORIGIN) {
        return (StatusCode::FORBIDDEN, "Origin header forbidden on private collector").into_response();
    }

    // 5. Authenticate terminal capability Bearer token
    let Some(auth_val) = headers.get(header::AUTHORIZATION).and_then(|h| h.to_str().ok()) else {
        return (StatusCode::UNAUTHORIZED, "Missing Authorization header").into_response();
    };
    let Some(token) = auth_val.strip_prefix("Bearer ") else {
        return (StatusCode::UNAUTHORIZED, "Bearer scheme required").into_response();
    };

    let auth_res = runtime.authenticate_bearer(token.trim());
    let (terminal_id, incarnation) = match auth_res {
        TokenAuthResult::Active {
            terminal_id,
            incarnation,
        } => (terminal_id, incarnation),
        TokenAuthResult::Pending => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(serde_json::json!({
                    "error": "Capability pending publication",
                    "retryable": true
                })),
            )
                .into_response();
        }
        TokenAuthResult::InvalidOrRevoked => {
            return (StatusCode::UNAUTHORIZED, "Invalid or revoked capability token").into_response();
        }
    };

    upgrade
        .max_frame_size(MAX_PRIVATE_FRAME_BYTES)
        .max_message_size(MAX_PRIVATE_FRAME_BYTES)
        .on_upgrade(move |socket| handle_reporter_socket(socket, runtime, terminal_id, incarnation))
}

/// WebSocket connection loop managing hello handshake, report ingress, rate limits, and fenced cleanup.
async fn handle_reporter_socket(
    mut socket: WebSocket,
    runtime: AgentStatusRuntime,
    terminal_id: String,
    incarnation: u64,
) {
    // Enforce pre-auth connection concurrency limit (32)
    let pre_auth_permit = match PRE_AUTH_SEMAPHORE.try_acquire() {
        Ok(permit) => permit,
        Err(_) => {
            let reject = ReporterRejected::new("pre-auth concurrency limit exceeded");
            if let Ok(json) = serde_json::to_string(&reject) {
                let _ = socket.send(Message::Text(json.into())).await;
            }
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };
    // 1. Initial hello handshake within deadline
    let hello_res = tokio::time::timeout(
        Duration::from_secs(HELLO_TIMEOUT_SECS),
        socket.recv(),
    )
    .await;

    let hello = match hello_res {
        Ok(Some(Ok(Message::Text(text)))) => {
            match serde_json::from_str::<ReporterHello>(&text) {
                Ok(hello) => {
                    if hello.version != AGENT_STATUS_PROTOCOL_VERSION {
                        let reject = ReporterRejected::new(format!(
                            "unsupported protocol version: expected {AGENT_STATUS_PROTOCOL_VERSION}, got {}",
                            hello.version
                        ));
                        if let Ok(json) = serde_json::to_string(&reject) {
                            let _ = socket.send(Message::Text(json.into())).await;
                        }
                        let _ = socket.send(Message::Close(None)).await;
                        return;
                    }
                    if hello.agent_kind != AgentKind::Omp {
                        let reject = ReporterRejected::new("unsupported agent kind");
                        if let Ok(json) = serde_json::to_string(&reject) {
                            let _ = socket.send(Message::Text(json.into())).await;
                        }
                        let _ = socket.send(Message::Close(None)).await;
                        return;
                    }
                    hello
                }
                Err(e) => {
                    let reject = ReporterRejected::new(format!("malformed hello: {e}"));
                    if let Ok(json) = serde_json::to_string(&reject) {
                        let _ = socket.send(Message::Text(json.into())).await;
                    }
                    let _ = socket.send(Message::Close(None)).await;
                    return;
                }
            }
        }
        _ => {
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };
    // Drop pre-auth permit once initial hello is parsed
    drop(pre_auth_permit);


    // 2. Admit reporter with close notification channel for replacement/teardown
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel::<()>();
    let accepted = match runtime.admit_reporter(&terminal_id, incarnation, &hello, close_tx) {
        Ok(acc) => acc,
        Err(e) => {
            let reject = ReporterRejected::new(e.to_string());
            if let Ok(json) = serde_json::to_string(&reject) {
                let _ = socket.send(Message::Text(json.into())).await;
            }
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    // Send accepted acknowledgement
    let reporter_epoch = accepted.reporter_epoch;
    if let Ok(accepted_json) = serde_json::to_string(&accepted) {
        if socket.send(Message::Text(accepted_json.into())).await.is_err() {
            runtime.mark_unknown_on_disconnect(&terminal_id, incarnation, reporter_epoch);
            return;
        }
    } else {
        runtime.mark_unknown_on_disconnect(&terminal_id, incarnation, reporter_epoch);
        return;
    }

    // 3. Message loop with token-bucket rate limiting
    let mut tokens = BURST_REPORTS as f64;
    let mut last_tick = Instant::now();

    loop {
        tokio::select! {
            _ = &mut close_rx => {
                // Connection superseded by same reporter reconnect, credential revoked, or shutdown
                let _ = socket.send(Message::Close(None)).await;
                break;
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if text.len() > MAX_PRIVATE_FRAME_BYTES {
                            let reject = ReporterRejected::new("frame exceeds maximum size");
                            if let Ok(json) = serde_json::to_string(&reject) {
                                let _ = socket.send(Message::Text(json.into())).await;
                            }
                            break;
                        }

                        // Rate limit check
                        let now = Instant::now();
                        let elapsed = now.duration_since(last_tick).as_secs_f64();
                        last_tick = now;
                        tokens = (tokens + elapsed * (MAX_REPORTS_PER_SEC as f64)).min(BURST_REPORTS as f64);
                        if tokens < 1.0 {
                            let reject = ReporterRejected::new("rate limit exceeded");
                            if let Ok(json) = serde_json::to_string(&reject) {
                                let _ = socket.send(Message::Text(json.into())).await;
                            }
                            continue;
                        }
                        tokens -= 1.0;

                        // Parse report payload
                        let report: ReporterReport = match serde_json::from_str(&text) {
                            Ok(r) => r,
                            Err(e) => {
                                let reject = ReporterRejected::new(format!("malformed report: {e}"));
                                if let Ok(json) = serde_json::to_string(&reject) {
                                    let _ = socket.send(Message::Text(json.into())).await;
                                }
                                continue;
                            }
                        };

                        // Apply to runtime and registry
                        match runtime.apply_report(&terminal_id, incarnation, reporter_epoch, report) {
                            Ok(ack) => {
                                if let Ok(json) = serde_json::to_string(&ack) {
                                    if socket.send(Message::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            Err(e) => {
                                let reject = ReporterRejected::new(e.to_string());
                                if let Ok(json) = serde_json::to_string(&reject) {
                                    let _ = socket.send(Message::Text(json.into())).await;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(bytes))) => {
                        if socket.send(Message::Pong(bytes)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) => {
                        break;
                    }
                    Some(Ok(Message::Binary(_))) => {
                        let reject = ReporterRejected::new("binary frames not supported");
                        if let Ok(json) = serde_json::to_string(&reject) {
                            let _ = socket.send(Message::Text(json.into())).await;
                        }
                        break;
                    }
                    Some(Err(_)) | None => {
                        break;
                    }
                }
            }
        }
    }

    // 4. Mark unknown on disconnect (fenced by reporter epoch)
    runtime.mark_unknown_on_disconnect(&terminal_id, incarnation, reporter_epoch);
}
