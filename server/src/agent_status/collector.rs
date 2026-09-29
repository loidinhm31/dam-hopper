use std::net::SocketAddr;
use std::path::{Path, PathBuf};
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
    AgentKind, AgentStatusAvailability, PrivateHookEnvelope, ReporterHello, ReporterRejected,
    ReporterReport, AGENT_HOOKS_PATH, AGENT_STATUS_PROTOCOL_VERSION, AGENT_STATUS_WS_PATH,
    BURST_REPORTS, HELLO_TIMEOUT_SECS, MAX_PRE_AUTH_CONCURRENCY, MAX_PRIVATE_FRAME_BYTES,
    MAX_REPORTS_PER_SEC,
};

static PRE_AUTH_SEMAPHORE: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| tokio::sync::Semaphore::new(MAX_PRE_AUTH_CONCURRENCY));

fn valid_private_host(host: &str, runtime: &AgentStatusRuntime) -> bool {
    let Some(port) = runtime.listener_url().and_then(|url| {
        url.strip_prefix("ws://127.0.0.1:")?
            .split_once('/')
            .map(|(port, _)| port.to_string())
    }) else {
        return false;
    };
    host == format!("127.0.0.1:{port}")
        || host == format!("localhost:{port}")
        || host == format!("[::1]:{port}")
}

/// Private loopback collector handle serving the authenticated agent status WebSocket route.
pub struct AgentStatusCollector {
    local_addr: SocketAddr,
    ws_url: String,
    socket_path: Option<PathBuf>,
    socket_dir: Option<PathBuf>,
    runtime: AgentStatusRuntime,
    server_task: tokio::task::JoinHandle<()>,
    uds_task: Option<tokio::task::JoinHandle<()>>,
}

impl AgentStatusCollector {
    /// Bind collector to the specified loopback socket address and start serving.
    pub async fn bind(
        runtime: AgentStatusRuntime,
        addr: SocketAddr,
    ) -> Result<Self, std::io::Error> {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        let local_addr = listener.local_addr()?;
        let ws_url = format!(
            "ws://127.0.0.1:{}{}",
            local_addr.port(),
            AGENT_STATUS_WS_PATH
        );

        runtime.set_listener(ws_url.clone(), AgentStatusAvailability::Ready);

        let app = Router::new()
            .route(AGENT_STATUS_WS_PATH, get(ws_upgrade_handler))
            .with_state(runtime.clone());

        #[cfg(target_os = "linux")]
        let (socket_path, socket_dir, uds_task) = {
            let (dir, sock) = create_private_socket_dir()?;
            let uds_listener = tokio::net::UnixListener::bind(&sock)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&sock, std::fs::Permissions::from_mode(0o600));
            }
            runtime.set_hook_socket_path(Some(sock.clone()));
            let uds_rt = runtime.clone();
            let uds_task = tokio::spawn(async move {
                run_uds_server(uds_listener, uds_rt).await;
            });
            (Some(sock), Some(dir), Some(uds_task))
        };
        #[cfg(not(target_os = "linux"))]
        let (socket_path, socket_dir, uds_task) = (None, None, None);

        let server_task = tokio::spawn(async move {
            let make_service = app.into_make_service_with_connect_info::<SocketAddr>();
            if let Err(e) = axum::serve(listener, make_service).await {
                tracing::warn!(error = %e, "Agent status collector server error");
            }
        });

        Ok(Self {
            local_addr,
            ws_url,
            socket_path,
            socket_dir,
            runtime,
            server_task,
            uds_task,
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

    /// Path to the Unix domain socket for native agent hook reporting (Linux only).
    pub fn socket_path(&self) -> Option<&Path> {
        self.socket_path.as_deref()
    }

    /// Shut down the collector listener task and clean up socket artifacts.
    pub fn shutdown(self) {
        self.server_task.abort();
        if let Some(task) = &self.uds_task {
            task.abort();
        }
        if let Some(path) = &self.socket_path {
            let _ = std::fs::remove_file(path);
        }
        if let Some(dir) = &self.socket_dir {
            let _ = std::fs::remove_dir_all(dir);
        }
        self.runtime.set_hook_socket_path(None);
    }
}

impl Drop for AgentStatusCollector {
    fn drop(&mut self) {
        if let Some(path) = &self.socket_path {
            let _ = std::fs::remove_file(path);
        }
        if let Some(dir) = &self.socket_dir {
            let _ = std::fs::remove_dir_all(dir);
        }
        self.runtime.set_hook_socket_path(None);
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
    let host_is_loopback = valid_private_host(host_val, &runtime);
    if !host_is_loopback {
        return (StatusCode::BAD_REQUEST, "Host must be loopback").into_response();
    }

    // 4. Reject browser Origin header
    if headers.contains_key(header::ORIGIN) {
        return (
            StatusCode::FORBIDDEN,
            "Origin header forbidden on private collector",
        )
            .into_response();
    }

    // 5. Authenticate terminal capability Bearer token
    let Some(auth_val) = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
    else {
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
            return (
                StatusCode::UNAUTHORIZED,
                "Invalid or revoked capability token",
            )
                .into_response();
        }
    };

    let token = token.to_owned();
    upgrade
        .max_frame_size(MAX_PRIVATE_FRAME_BYTES)
        .max_message_size(MAX_PRIVATE_FRAME_BYTES)
        .on_upgrade(move |socket| {
            handle_reporter_socket(socket, runtime, terminal_id, incarnation, token)
        })
}
#[cfg(target_os = "linux")]
fn create_private_socket_dir() -> Result<(PathBuf, PathBuf), std::io::Error> {
    use std::os::unix::fs::DirBuilderExt;
    use std::os::unix::fs::PermissionsExt;

    let dir_name = format!(
        "dh-hooks-{}-{}",
        std::process::id(),
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let dir_path = std::env::temp_dir().join(dir_name);

    let mut builder = std::fs::DirBuilder::new();
    builder.mode(0o700);
    builder.create(&dir_path)?;

    let _ = std::fs::set_permissions(&dir_path, std::fs::Permissions::from_mode(0o700));

    let socket_path = dir_path.join("hooks.sock");
    Ok((dir_path, socket_path))
}

#[cfg(target_os = "linux")]
async fn run_uds_server(listener: tokio::net::UnixListener, runtime: AgentStatusRuntime) {
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                tracing::debug!("UDS accept error: {e}");
                continue;
            }
        };

        // Enforce pre-auth connection concurrency limit (32) before reading any bytes!
        let permit = match PRE_AUTH_SEMAPHORE.try_acquire() {
            Ok(permit) => permit,
            Err(_) => {
                // Drop the excess connection without spawning an unbounded task.
                drop(stream);
                continue;
            }
        };

        let runtime = runtime.clone();
        tokio::spawn(async move {
            let _permit = permit;
            handle_uds_connection(stream, runtime).await;
        });
    }
}

#[cfg(target_os = "linux")]
async fn handle_uds_connection(mut stream: tokio::net::UnixStream, runtime: AgentStatusRuntime) {
    use tokio::io::AsyncWriteExt;

    let operation = async {
        // 1. Peer credentials via SO_PEERCRED
        let cred = stream.peer_cred().map_err(|e| {
            tracing::warn!("Failed to read SO_PEERCRED from UnixStream: {e}");
            (
                StatusCode::FORBIDDEN,
                "Missing socket credentials".to_string(),
            )
        })?;

        let peer_pid = cred.pid().ok_or_else(|| {
            (
                StatusCode::FORBIDDEN,
                "Missing peer PID in socket credentials".to_string(),
            )
        })? as u32;

        let expected_uid = unsafe { libc::geteuid() };
        if cred.uid() != expected_uid {
            return Err((StatusCode::FORBIDDEN, "Peer UID mismatch".to_string()));
        }

        // 2. Read bounded HTTP request (at most 4KiB headers and 4KiB body)
        let (method, path, headers, body) = read_bounded_http_request(&mut stream).await?;

        // 3. Verify method and path
        if method != "POST" {
            return Err((
                StatusCode::METHOD_NOT_ALLOWED,
                "Method Not Allowed".to_string(),
            ));
        }
        if path != AGENT_HOOKS_PATH {
            return Err((StatusCode::NOT_FOUND, "Not Found".to_string()));
        }

        // 4. Reject Origin header
        if headers.contains_key("origin") {
            return Err((
                StatusCode::FORBIDDEN,
                "Origin header forbidden on private collector".to_string(),
            ));
        }
        if headers.get("host").map(String::as_str) != Some("localhost") {
            return Err((StatusCode::BAD_REQUEST, "Invalid private Host".to_string()));
        }

        // 5. Authenticate Bearer token
        let token = match headers.get("authorization") {
            Some(val) if val.starts_with("Bearer ") => val["Bearer ".len()..].trim(),
            _ => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    "Missing or invalid Authorization header".to_string(),
                ));
            }
        };

        let (terminal_id, incarnation) = match runtime.authenticate_bearer(token) {
            TokenAuthResult::Active {
                terminal_id,
                incarnation,
            } => (terminal_id, incarnation),
            TokenAuthResult::Pending => {
                return Err((
                    StatusCode::SERVICE_UNAVAILABLE,
                    serde_json::json!({
                        "error": "Capability pending publication",
                        "retryable": true
                    })
                    .to_string(),
                ));
            }
            TokenAuthResult::InvalidOrRevoked => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    "Invalid or revoked capability token".to_string(),
                ));
            }
        };

        // 6. Rate limit check (max 20/s, burst 40)
        if !runtime.check_hook_rate_limit(&terminal_id, incarnation) {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                "Rate limit exceeded (max 20 reports/sec, burst 40)".to_string(),
            ));
        }

        // 7. Parse JSON envelope
        let envelope: PrivateHookEnvelope = serde_json::from_slice(&body).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid hook envelope JSON: {e}"),
            )
        })?;

        // 8. Validate hook envelope protocol and identifiers
        super::hook_ingress::validate_hook_envelope(&envelope).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid hook envelope: {e}"),
            )
        })?;

        // 9. Lookup registered root for PTY incarnation
        let registered_root = runtime
            .get_terminal_root(&terminal_id, incarnation)
            .ok_or_else(|| {
                (
                    StatusCode::FORBIDDEN,
                    "No registered root process identity for terminal incarnation".to_string(),
                )
            })?;

        // 10. Verify process ancestry in /proc outside locks, checking peer_pid against leaf
        super::hook_ingress::verify_reporter_ancestry(
            std::path::Path::new("/proc"),
            peer_pid,
            registered_root,
            &envelope,
        )
        .map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                format!("Process ancestry verification failed: {e}"),
            )
        })?;

        // 11. Apply hook event to runtime
        let now_ms = crate::pty::session::now_ms();
        match runtime.apply_hook_event(&terminal_id, incarnation, &envelope, now_ms) {
            Ok(row) => {
                let resp = serde_json::json!({
                    "status": "accepted",
                    "eventId": envelope.event_id,
                    "row": row
                })
                .to_string();
                Ok((StatusCode::OK, resp))
            }
            Err(e) => Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("Hook event rejected: {e}"),
            )),
        }
    };

    let result = tokio::time::timeout(Duration::from_millis(250), operation).await;
    match result {
        Ok(Ok((status, body))) => {
            let resp = format!(
                "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("OK"),
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
        }
        Ok(Err((status, msg))) => {
            let resp = format!(
                "HTTP/1.1 {} {}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("Error"),
                msg.len(),
                msg
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
        }
        Err(_) => {
            // Timed out (>250ms), close immediately
            let _ = stream.shutdown().await;
        }
    }
}

#[cfg(target_os = "linux")]
async fn read_bounded_http_request(
    stream: &mut tokio::net::UnixStream,
) -> Result<
    (
        String,
        String,
        std::collections::HashMap<String, String>,
        Vec<u8>,
    ),
    (StatusCode, String),
> {
    use tokio::io::AsyncReadExt;

    let mut buf = [0u8; MAX_PRIVATE_FRAME_BYTES];
    let mut total_read = 0;
    let mut header_end = None;
    let mut delimiter_len = 0;

    // Read headers until \r\n\r\n or \n\n
    while total_read < MAX_PRIVATE_FRAME_BYTES {
        let n = stream.read(&mut buf[total_read..]).await.map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("I/O error reading request: {e}"),
            )
        })?;
        if n == 0 {
            break;
        }
        total_read += n;

        if let Some(pos) = buf[..total_read].windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = Some(pos);
            delimiter_len = 4;
            break;
        } else if let Some(pos) = buf[..total_read].windows(2).position(|w| w == b"\n\n") {
            header_end = Some(pos);
            delimiter_len = 2;
            break;
        }
    }

    let header_pos = header_end.ok_or_else(|| {
        (
            StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE,
            "Headers too large or incomplete".to_string(),
        )
    })?;

    let header_bytes = &buf[..header_pos];
    let header_str = std::str::from_utf8(header_bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Invalid UTF-8 in HTTP headers".to_string(),
        )
    })?;

    let mut lines = header_str.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "Missing request line".to_string()))?;

    let mut req_parts = request_line.split_whitespace();
    let method = req_parts
        .next()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "Missing HTTP method".to_string()))?
        .to_string();
    let raw_path = req_parts
        .next()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "Missing HTTP path".to_string()))?;

    // Reject query parameters and fragments
    if raw_path.contains('?') || raw_path.contains('#') {
        return Err((
            StatusCode::BAD_REQUEST,
            "Query parameters forbidden".to_string(),
        ));
    }
    let path = raw_path.to_string();

    let mut headers = std::collections::HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let content_length: usize = match headers.get("content-length") {
        Some(cl) => cl.parse().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "Invalid Content-Length".to_string(),
            )
        })?,
        None => 0,
    };

    if content_length > MAX_PRIVATE_FRAME_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "Payload size {content_length} exceeds limit of {MAX_PRIVATE_FRAME_BYTES} bytes"
            ),
        ));
    }

    let body_start = header_pos + delimiter_len;
    let initial_body_bytes = total_read.saturating_sub(body_start);
    let mut body = Vec::with_capacity(content_length);
    if initial_body_bytes > 0 {
        let copy_len = initial_body_bytes.min(content_length);
        body.extend_from_slice(&buf[body_start..body_start + copy_len]);
    }

    while body.len() < content_length {
        let mut chunk = [0u8; 1024];
        let remaining = content_length - body.len();
        let read_len = remaining.min(chunk.len());
        let n = stream.read(&mut chunk[..read_len]).await.map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("I/O error reading body: {e}"),
            )
        })?;
        if n == 0 {
            return Err((
                StatusCode::BAD_REQUEST,
                "Unexpected EOF reading request body".to_string(),
            ));
        }
        body.extend_from_slice(&chunk[..n]);
    }

    Ok((method, path, headers, body))
}

/// WebSocket connection loop managing hello handshake, report ingress, rate limits, and fenced cleanup.
async fn handle_reporter_socket(
    mut socket: WebSocket,
    runtime: AgentStatusRuntime,
    terminal_id: String,
    incarnation: u64,
    authenticated_token: String,
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
    let hello_res =
        tokio::time::timeout(Duration::from_secs(HELLO_TIMEOUT_SECS), socket.recv()).await;

    let hello = match hello_res {
        Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<ReporterHello>(&text) {
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
        },
        _ => {
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };
    // Drop pre-auth permit once initial hello is parsed
    drop(pre_auth_permit);

    // 2. Admit reporter with close notification channel for replacement/teardown
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel::<()>();
    let accepted = match runtime.admit_reporter(
        &terminal_id,
        incarnation,
        &authenticated_token,
        &hello,
        close_tx,
    ) {
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
        if socket
            .send(Message::Text(accepted_json.into()))
            .await
            .is_err()
        {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_collector_bind_and_cleanup() {
        let runtime = AgentStatusRuntime::new(AgentStatusAvailability::Ready, None);
        let collector =
            AgentStatusCollector::bind(runtime.clone(), SocketAddr::from(([127, 0, 0, 1], 0)))
                .await
                .expect("bind collector");

        assert!(collector.ws_url().contains(AGENT_STATUS_WS_PATH));

        #[cfg(target_os = "linux")]
        {
            let socket_path = collector.socket_path().expect("socket path on linux");
            assert!(socket_path.exists());

            // Verify private directory permissions are 0700
            use std::os::unix::fs::PermissionsExt;
            let parent = socket_path.parent().expect("parent dir");
            let meta = std::fs::metadata(parent).expect("dir metadata");
            assert_eq!(meta.permissions().mode() & 0o777, 0o700);
        }

        // Verify TCP listener does NOT accept POST /v1/agent-hooks
        let tcp_addr = collector.local_addr();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        if let Ok(mut stream) = tokio::net::TcpStream::connect(tcp_addr).await {
            let req = format!(
                "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                AGENT_HOOKS_PATH, tcp_addr
            );
            let _ = stream.write_all(req.as_bytes()).await;
            let mut resp_buf = [0u8; 128];
            let n = stream.read(&mut resp_buf).await.unwrap_or(0);
            let resp_str = String::from_utf8_lossy(&resp_buf[..n]);
            assert!(
                resp_str.starts_with("HTTP/1.1 404") || resp_str.starts_with("HTTP/1.1 405"),
                "Expected 404 or 405 on TCP POST, got: {resp_str}"
            );
        }
        collector.shutdown();
    }
}
