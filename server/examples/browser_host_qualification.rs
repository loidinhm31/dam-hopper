#[path = "browser_host_qualification/adaptive_media.rs"]
mod adaptive_media;
#[path = "browser_host_qualification/fixtures.rs"]
mod fixtures;
#[path = "browser_host_qualification/stream_metrics.rs"]
mod stream_metrics;
use axum::extract::ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tempfile::tempdir;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message as UpstreamMessage;
use url::Url;

use dam_hopper_server::browser_host::cdp::CdpClient;
use dam_hopper_server::browser_host::process::{
    find_browser_executable, BrowserLaunchConfig, BrowserProcess,
};
use dam_hopper_server::browser_host::protocol::MAX_WS_MESSAGE_BYTES;
const WRITE_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Debug, PartialEq, Eq)]
enum WriteOutcome {
    Ok,
    Failed,
    DeadlineElapsed,
}

async fn write_with_outcome<F, E>(write: F) -> WriteOutcome
where
    F: Future<Output = Result<(), E>>,
{
    match timeout(WRITE_DEADLINE, write).await {
        Ok(Ok(())) => WriteOutcome::Ok,
        Ok(Err(_)) => WriteOutcome::Failed,
        Err(_) => WriteOutcome::DeadlineElapsed,
    }
}

struct InternalActorInfo {
    client: Arc<CdpClient>,
    target_id: String,
    session_id: String,
    frames_received: Arc<AtomicUsize>,
    terminal_error: Arc<parking_lot::Mutex<Option<String>>>,
}

#[derive(Clone)]
struct AppState {
    auth_token: String,
    port: u16,
    chrome_http_base: String,
    chrome_port: u16,
    discovery_auth_received: Arc<AtomicBool>,
    ws_auth_received: Arc<AtomicBool>,
    browser_ws_url: String,
    /// Exact approved Origin; any Origin-bearing request must match it byte for byte.
    allowed_origin: String,
    relay_semaphore: Arc<Semaphore>,
    client_write_deadline_timeouts: Arc<AtomicUsize>,
    upstream_write_deadline_timeouts: Arc<AtomicUsize>,
    generic_teardowns: Arc<AtomicUsize>,
    internal_session: Arc<Mutex<Option<InternalActorInfo>>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let auth_token = std::env::var("DAM_HOPPER_QUALIFICATION_TOKEN")
        .unwrap_or_else(|_| "test-qualification-token-secret".to_string());

    let mode = std::env::var("DAM_HOPPER_QUALIFICATION_MODE")
        .unwrap_or_else(|_| "phase01".to_string());

    if mode == "adaptive-media" {
        return adaptive_media::run().await;
    }

    if mode == "production-gateway" {
        return run_production_gateway(auth_token).await;
    }

    let exec = find_browser_executable(None)?;
    let tmp = tempdir()?;
    let mut config = BrowserLaunchConfig::new(tmp.path().join("qual-user-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let mut browser = BrowserProcess::launch(config).await?;
    let browser_ws = browser.ws_endpoint().to_string();
    let parsed_ws = Url::parse(&browser_ws)?;
    let chrome_port = parsed_ws.port().ok_or("missing devtools port")?;
    let chrome_http_base = format!("http://127.0.0.1:{chrome_port}");

    // Connect internal actor session to prove simultaneous agent & internal sessions
    let internal_client = match CdpClient::connect(&browser_ws).await {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("[Qualification Fixture] Warning: internal CdpClient connect failed: {e}");
            None
        }
    };

    let mut initial_actor_info = None;
    if let Some(ic) = internal_client {
        match setup_internal_session(ic).await {
            Ok(info) => initial_actor_info = Some(info),
            Err(e) => {
                eprintln!("[Qualification Fixture] Warning: setup_internal_session failed: {e}")
            }
        }
    }

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let port = local_addr.port();

    let state = AppState {
        auth_token: auth_token.clone(),
        port,
        chrome_http_base,
        chrome_port,
        discovery_auth_received: Arc::new(AtomicBool::new(false)),
        ws_auth_received: Arc::new(AtomicBool::new(false)),
        browser_ws_url: browser_ws.clone(),
        allowed_origin: std::env::var("DAM_HOPPER_QUALIFICATION_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| format!("http://127.0.0.1:{port}")),
        relay_semaphore: Arc::new(Semaphore::new(2)),
        client_write_deadline_timeouts: Arc::new(AtomicUsize::new(0)),
        upstream_write_deadline_timeouts: Arc::new(AtomicUsize::new(0)),
        generic_teardowns: Arc::new(AtomicUsize::new(0)),
        internal_session: Arc::new(Mutex::new(initial_actor_info)),
    };
    let app = Router::new()
        .route("/json/version", get(json_version))
        .route("/json/version/", get(json_version))
        .route("/json/list", get(json_list))
        .route("/json/list/", get(json_list))
        .route("/json", get(json_list))
        .route("/json/", get(json_list))
        .route("/cdp", get(ws_handler))
        .route("/cdp/{target_id}", get(ws_handler_target))
        .route(
            "/api/qualification/status",
            get(qualification_status).post(reset_status),
        )
        .route("/api/qualification/reset", post(reset_status))
        .route(
            "/api/qualification/internal_session",
            get(api_internal_session_status),
        )
        .route(
            "/api/qualification/internal_session/poke",
            post(api_internal_session_poke),
        )
        .route(
            "/api/qualification/flood_output",
            post(api_qualification_flood_output),
        )
        .with_state(state.clone());

    // Spawn HTTP/WS server
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    // Output machine-readable JSON readiness contract on stdout (<= 4KiB)
    let ready_json = json!({
        "qualificationReady": true,
        "port": port,
        "httpUrl": format!("http://127.0.0.1:{port}"),
        "wsUrl": format!("ws://127.0.0.1:{port}/cdp"),
        "expectedToken": auth_token,
        "browserPid": browser.pid(),
    });

    println!("{}", serde_json::to_string(&ready_json)?);

    // Keep running until stdin EOF, SIGINT (Ctrl+C), or SIGTERM
    let mut stdin = tokio::io::stdin();
    let mut buf = [0u8; 1024];

    #[cfg(unix)]
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            eprintln!("[Qualification Fixture] Received Ctrl+C, shutting down");
        }
        _ = stdin.read(&mut buf) => {
            eprintln!("[Qualification Fixture] Stdin closed, shutting down");
        }
        _ = async {
            #[cfg(unix)]
            { sigterm.recv().await; }
            #[cfg(not(unix))]
            { std::future::pending::<()>().await; }
        } => {
            eprintln!("[Qualification Fixture] Received SIGTERM, shutting down");
        }
    }
    browser.terminate().await?;
    eprintln!("[Qualification Fixture] Browser terminated cleanly");

    Ok(())
}

async fn setup_internal_session(
    client: Arc<CdpClient>,
) -> Result<InternalActorInfo, Box<dyn std::error::Error + Send + Sync>> {
    let create_res = client
        .send_command(
            "Target.createTarget",
            Some(json!({ "url": "about:blank" })),
            None,
        )
        .await?;
    let target_id = create_res["targetId"]
        .as_str()
        .ok_or("missing targetId")?
        .to_string();

    let attach_res = client
        .send_command(
            "Target.attachToTarget",
            Some(json!({ "targetId": target_id, "flatten": true })),
            None,
        )
        .await?;
    let session_id = attach_res["sessionId"]
        .as_str()
        .ok_or("missing sessionId")?
        .to_string();

    client
        .send_command("Page.enable", None, Some(&session_id))
        .await?;

    let mut screencast_rx = client.subscribe_screencast();
    client
        .send_command(
            "Page.startScreencast",
            Some(json!({
                "format": "jpeg",
                "quality": 65,
                "maxWidth": 1280,
                "maxHeight": 900,
                "everyNthFrame": 1
            })),
            Some(&session_id),
        )
        .await?;

    let frames_received = Arc::new(AtomicUsize::new(0));
    let terminal_error = Arc::new(parking_lot::Mutex::new(None));

    let frames_counter = frames_received.clone();
    let term_err = terminal_error.clone();
    let ack_client = client.clone();
    let ack_sid = session_id.clone();

    tokio::spawn(async move {
        loop {
            match screencast_rx.recv().await {
                Ok(frame) => {
                    if frame.session_id == ack_sid {
                        frames_counter.fetch_add(1, Ordering::SeqCst);
                        if let Err(e) = ack_client
                            .ack_screencast_frame(&ack_sid, frame.frame_session_id)
                            .await
                        {
                            *term_err.lock() = Some(format!("screencast ACK failed: {e}"));
                            break;
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    *term_err.lock() = Some("screencast broadcast closed".to_string());
                    break;
                }
            }
        }
    });

    Ok(InternalActorInfo {
        client,
        target_id,
        session_id,
        frames_received,
        terminal_error,
    })
}

async fn json_version(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    validate_auth(&headers, &state.auth_token)?;
    validate_origin(&headers, &state.allowed_origin)?;
    state.discovery_auth_received.store(true, Ordering::SeqCst);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let url = format!("{}/json/version", state.chrome_http_base);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let bytes = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    if bytes.len() > 65536 {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let mut val: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| StatusCode::BAD_GATEWAY)?;

    // Rewrite webSocketDebuggerUrl to point to our qualification proxy endpoint
    val["webSocketDebuggerUrl"] = json!(format!("ws://127.0.0.1:{}/cdp", state.port));

    Ok(Json(val).into_response())
}

async fn json_list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    validate_auth(&headers, &state.auth_token)?;
    validate_origin(&headers, &state.allowed_origin)?;
    state.discovery_auth_received.store(true, Ordering::SeqCst);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let url = format!("{}/json/list", state.chrome_http_base);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let bytes = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    if bytes.len() > 262144 {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let mut val: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| StatusCode::BAD_GATEWAY)?;

    if let Some(targets) = val.as_array_mut() {
        for target in targets {
            if let Some(target_id) = target.get("id").and_then(|v| v.as_str()) {
                target["webSocketDebuggerUrl"] =
                    json!(format!("ws://127.0.0.1:{}/cdp/{}", state.port, target_id));
            } else {
                target["webSocketDebuggerUrl"] =
                    json!(format!("ws://127.0.0.1:{}/cdp", state.port));
            }
        }
    }

    Ok(Json(val).into_response())
}

async fn ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, StatusCode> {
    validate_auth(&headers, &state.auth_token)?;
    validate_origin(&headers, &state.allowed_origin)?;

    let permit = state
        .relay_semaphore
        .clone()
        .try_acquire_owned()
        .map_err(|_| StatusCode::TOO_MANY_REQUESTS)?;

    state.ws_auth_received.store(true, Ordering::SeqCst);
    let browser_ws_url = state.browser_ws_url.clone();
    let c_deadlines = state.client_write_deadline_timeouts.clone();
    let u_deadlines = state.upstream_write_deadline_timeouts.clone();
    let teardowns = state.generic_teardowns.clone();

    Ok(ws
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            handle_proxy_socket(
                socket,
                browser_ws_url,
                permit,
                c_deadlines,
                u_deadlines,
                teardowns,
            )
        }))
}

async fn ws_handler_target(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(target_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, StatusCode> {
    validate_auth(&headers, &state.auth_token)?;
    validate_origin(&headers, &state.allowed_origin)?;

    let permit = state
        .relay_semaphore
        .clone()
        .try_acquire_owned()
        .map_err(|_| StatusCode::TOO_MANY_REQUESTS)?;

    state.ws_auth_received.store(true, Ordering::SeqCst);
    let target_ws_url = format!(
        "ws://127.0.0.1:{}/devtools/page/{}",
        state.chrome_port, target_id
    );
    let c_deadlines = state.client_write_deadline_timeouts.clone();
    let u_deadlines = state.upstream_write_deadline_timeouts.clone();
    let teardowns = state.generic_teardowns.clone();

    Ok(ws
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            handle_proxy_socket(
                socket,
                target_ws_url,
                permit,
                c_deadlines,
                u_deadlines,
                teardowns,
            )
        }))
}
/// Test-only relay. Both directions are bounded (4 MiB message/frame, 5s write deadline);
/// any read/write error, oversize message or deadline miss tears down both sockets.
async fn handle_proxy_socket(
    mut client_ws: WebSocket,
    target_ws_url: String,
    _permit: OwnedSemaphorePermit,
    client_deadline_timeouts: Arc<AtomicUsize>,
    upstream_deadline_timeouts: Arc<AtomicUsize>,
    generic_teardowns: Arc<AtomicUsize>,
) {
    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(MAX_WS_MESSAGE_BYTES);
    config.max_frame_size = Some(MAX_WS_MESSAGE_BYTES);
    let Ok((mut upstream_ws, _)) =
        tokio_tungstenite::connect_async_with_config(&target_ws_url, Some(config), false).await
    else {
        return;
    };

    loop {
        tokio::select! {
            client_msg = client_ws.next() => {
                let forwarded = match client_msg {
                    Some(Ok(AxumWsMessage::Text(t))) => {
                        let outcome = write_with_outcome(upstream_ws.send(UpstreamMessage::Text(t.as_str().into()))).await;
                        if outcome == WriteOutcome::DeadlineElapsed {
                            upstream_deadline_timeouts.fetch_add(1, Ordering::SeqCst);
                        }
                        outcome == WriteOutcome::Ok
                    }
                    Some(Ok(AxumWsMessage::Binary(b))) => {
                        let outcome = write_with_outcome(upstream_ws.send(UpstreamMessage::Binary(b.into()))).await;
                        if outcome == WriteOutcome::DeadlineElapsed {
                            upstream_deadline_timeouts.fetch_add(1, Ordering::SeqCst);
                        }
                        outcome == WriteOutcome::Ok
                    }
                    Some(Ok(AxumWsMessage::Ping(_))) | Some(Ok(AxumWsMessage::Pong(_))) => true,
                    Some(Ok(AxumWsMessage::Close(_))) | Some(Err(_)) | None => false,
                };
                if !forwarded {
                    generic_teardowns.fetch_add(1, Ordering::SeqCst);
                    break;
                }
            }
            upstream_msg = upstream_ws.next() => {
                let forwarded = match upstream_msg {
                    Some(Ok(UpstreamMessage::Text(t))) => {
                        let outcome = write_with_outcome(client_ws.send(AxumWsMessage::Text(t.as_str().into()))).await;
                        if outcome == WriteOutcome::DeadlineElapsed {
                            client_deadline_timeouts.fetch_add(1, Ordering::SeqCst);
                        }
                        outcome == WriteOutcome::Ok
                    }
                    Some(Ok(UpstreamMessage::Binary(b))) => {
                        let outcome = write_with_outcome(client_ws.send(AxumWsMessage::Binary(b.into()))).await;
                        if outcome == WriteOutcome::DeadlineElapsed {
                            client_deadline_timeouts.fetch_add(1, Ordering::SeqCst);
                        }
                        outcome == WriteOutcome::Ok
                    }
                    Some(Ok(UpstreamMessage::Ping(_)))
                    | Some(Ok(UpstreamMessage::Pong(_)))
                    | Some(Ok(UpstreamMessage::Frame(_))) => true,
                    Some(Ok(UpstreamMessage::Close(_))) | Some(Err(_)) | None => false,
                };
                if !forwarded {
                    generic_teardowns.fetch_add(1, Ordering::SeqCst);
                    break;
                }
            }
        }
    }

    // Best-effort bounded close of both sides; dropping afterwards releases the sockets and permit.
    let _ = timeout(WRITE_DEADLINE, upstream_ws.close(None)).await;
    let _ = timeout(WRITE_DEADLINE, client_ws.send(AxumWsMessage::Close(None))).await;
}

async fn qualification_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let int_status = state.internal_session.lock().await;
    let (frames_received, terminal_error) = match &*int_status {
        Some(info) => (
            info.frames_received.load(Ordering::SeqCst),
            info.terminal_error.lock().clone(),
        ),
        None => (0, None),
    };

    Json(json!({
        "discoveryAuthReceived": state.discovery_auth_received.load(Ordering::SeqCst),
        "wsAuthReceived": state.ws_auth_received.load(Ordering::SeqCst),
        "bothAuthReceived": state.discovery_auth_received.load(Ordering::SeqCst) && state.ws_auth_received.load(Ordering::SeqCst),
        "clientWriteDeadlineTimeouts": state.client_write_deadline_timeouts.load(Ordering::SeqCst),
        "upstreamWriteDeadlineTimeouts": state.upstream_write_deadline_timeouts.load(Ordering::SeqCst),
        "genericTeardowns": state.generic_teardowns.load(Ordering::SeqCst),
        "internalSessionFrames": frames_received,
        "internalSessionError": terminal_error,
    }))
}

async fn reset_status(State(state): State<AppState>) -> StatusCode {
    state.discovery_auth_received.store(false, Ordering::SeqCst);
    state.ws_auth_received.store(false, Ordering::SeqCst);
    state
        .client_write_deadline_timeouts
        .store(0, Ordering::SeqCst);
    state
        .upstream_write_deadline_timeouts
        .store(0, Ordering::SeqCst);
    state.generic_teardowns.store(0, Ordering::SeqCst);
    StatusCode::OK
}

async fn api_internal_session_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let guard = state.internal_session.lock().await;
    let info = guard.as_ref().ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(json!({
        "active": true,
        "targetId": info.target_id,
        "sessionId": info.session_id,
        "framesReceived": info.frames_received.load(Ordering::SeqCst),
        "terminalError": *info.terminal_error.lock(),
    })))
}

async fn api_internal_session_poke(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let guard = state.internal_session.lock().await;
    let info = guard.as_ref().ok_or(StatusCode::NOT_FOUND)?;
    let sid = &info.session_id;

    // Trigger visual change on target A to drive screencast frames
    let _ = info.client.send_command(
        "Runtime.evaluate",
        Some(json!({
            "expression": "document.body.style.backgroundColor = document.body.style.backgroundColor === 'red' ? 'blue' : 'red'; 1",
            "returnByValue": true
        })),
        Some(sid),
    ).await;

    Ok(Json(json!({ "ok": true })))
}

async fn api_qualification_flood_output() -> StatusCode {
    let chunk = "x".repeat(1024 * 1024);
    for _ in 0..12 {
        println!("{}", chunk);
    }
    StatusCode::OK
}
fn validate_auth(headers: &HeaderMap, expected_token: &str) -> Result<(), StatusCode> {
    if let Some(auth_val) = headers.get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            let expected_bearer = format!("Bearer {expected_token}");
            if auth_str == expected_bearer {
                return Ok(());
            }
        }
    }
    Err(StatusCode::UNAUTHORIZED)
}

/// Origin-less requests (header-authenticated native/agent clients such as Playwright from Node)
/// pass; an Origin-bearing request must carry exactly one value equal to the approved Origin,
/// even with a valid bearer. `null`, repeated or differently-cased origins are rejected.
fn validate_origin(headers: &HeaderMap, allowed_origin: &str) -> Result<(), StatusCode> {
    let mut values = headers.get_all(header::ORIGIN).iter();
    match (values.next(), values.next()) {
        (None, _) => Ok(()),
        (Some(origin), None) if origin.as_bytes() == allowed_origin.as_bytes() => Ok(()),
        _ => Err(StatusCode::FORBIDDEN),
    }
}

async fn run_production_gateway(
    _auth_token: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let exec = find_browser_executable(None)?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let port = local_addr.port();
    let public_origin = dam_hopper_server::browser_host::config::PublicServerOrigin::parse(
        &format!("http://127.0.0.1:{port}"),
    )?;
    let tmp = tempdir()?;
    let workspace_root = tmp.path().to_path_buf();
    let jwt_secret = "qual-secret-jwt-key-32-bytes-long!!!".to_string();

    let (event_sink, _rx) = dam_hopper_server::pty::BroadcastEventSink::new(512);
    let pty_manager = dam_hopper_server::pty::PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = dam_hopper_server::config::DamHopperConfig {
        workspace: dam_hopper_server::config::WorkspaceInfo {
            name: "qual-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig {
            session_db_path: workspace_root.join("sessions.db").display().to_string(),
            browser: dam_hopper_server::browser_host::config::BrowserHostConfig {
                enabled: true,
                executable_path: Some(exec.clone()),
                profile_root: Some(workspace_root.join("browser-profiles")),
                budgets: dam_hopper_server::browser_host::config::BrowserBudgetsConfig {
                    max_raw_cdp_connections: 2,
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        },
        projects: vec![],
        features: dam_hopper_server::config::FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: workspace_root.join("dam-hopper.toml"),
    };
    let global_config = dam_hopper_server::config::GlobalConfig::default();
    let agent_store = dam_hopper_server::agent_store::AgentStoreService::new(workspace_root.join(".dam-hopper/agent-store"));
    let fs = dam_hopper_server::fs::FsSubsystem::new(vec![]);
    let tunnel_manager = dam_hopper_server::tunnel::TunnelSessionManager::new(
        Arc::new(event_sink.clone()),
        Arc::new(dam_hopper_server::tunnel::CloudflaredDriver),
    );
    let diagnostics = dam_hopper_server::diagnostics::DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));
    let opaque_setup = dam_hopper_server::crypto::load_or_create_server_setup()?;

    let mut app_state = dam_hopper_server::state::AppState::new(
        workspace_root.clone(),
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret.clone(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        opaque_setup,
        diagnostics,
    )?
    .with_public_server_origin(Some(public_origin));

    let db_path = workspace_root.join("auth.db");
    let store = dam_hopper_server::auth::AuthStore::open_sqlite(&db_path).await?;
    let auth_service = Arc::new(dam_hopper_server::auth::AuthService::with_system_clock(
        Some(store.clone()),
        None,
    ));
    app_state = app_state.with_auth_service(auth_service);

    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);

    let user1 = dam_hopper_server::auth::model::UserRecord {
        id: None,
        username: "admin".to_string(),
        password_hash: "mock_hash".to_string(),
        role: dam_hopper_server::auth::model::UserRole::Admin,
        is_enabled: true,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    store.create_user(user1).await?;

    let session1 = dam_hopper_server::auth::model::AuthSession {
        id: "admin-session-1".to_string(),
        username: "admin".to_string(),
        auth_version: 1,
        credential_version: 1,
        issued_at: dam_hopper_server::auth::model::chrono_to_bson(now),
        expires_at: dam_hopper_server::auth::model::chrono_to_bson(exp),
        mfa_verified_at: dam_hopper_server::auth::model::chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };
    store.create_session(session1).await?;

    let claims1 = dam_hopper_server::auth::model::AuthClaims {
        v: dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION,
        sub: "admin".to_string(),
        sid: "admin-session-1".to_string(),
        auth_version: 1,
        credential_version: 1,
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    };
    let token1 = claims1.encode(&jwt_secret)?;

    let user2 = dam_hopper_server::auth::model::UserRecord {
        id: None,
        username: "agent_user".to_string(),
        password_hash: "mock_hash".to_string(),
        role: dam_hopper_server::auth::model::UserRole::Admin,
        is_enabled: true,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    store.create_user(user2).await?;

    let session2 = dam_hopper_server::auth::model::AuthSession {
        id: "admin-session-2".to_string(),
        username: "admin".to_string(),
        auth_version: 1,
        credential_version: 1,
        issued_at: dam_hopper_server::auth::model::chrono_to_bson(now),
        expires_at: dam_hopper_server::auth::model::chrono_to_bson(exp),
        mfa_verified_at: dam_hopper_server::auth::model::chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };
    store.create_session(session2).await?;

    let claims2 = dam_hopper_server::auth::model::AuthClaims {
        v: dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION,
        sub: "admin".to_string(),
        sid: "admin-session-2".to_string(),
        auth_version: 1,
        credential_version: 1,
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    };
    let token2 = claims2.encode(&jwt_secret)?;

    let handle = app_state
        .browser_host
        .ensure_running("admin", false)
        .await?;
    let browser_ws = handle.ws_endpoint.clone();
    let browser_pid = handle.pid;

    let internal_client = match CdpClient::connect(&browser_ws).await {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("[Qualification Fixture] Warning: internal CdpClient connect failed: {e}");
            None
        }
    };

    let mut initial_actor_info = None;
    if let Some(ic) = internal_client {
        match setup_internal_session(ic).await {
            Ok(info) => initial_actor_info = Some(info),
            Err(e) => {
                eprintln!("[Qualification Fixture] Warning: setup_internal_session failed: {e}")
            }
        }
    }


    let allowed_origin = std::env::var("DAM_HOPPER_QUALIFICATION_ALLOWED_ORIGIN")
        .unwrap_or_else(|_| format!("http://127.0.0.1:{port}"));
    let origins = dam_hopper_server::api::router::parse_cors_origins(Some(&allowed_origin))
        .unwrap_or_default();

    let internal_session_arc = Arc::new(Mutex::new(initial_actor_info));

    #[derive(Clone)]
    struct QualProdState {
        store: dam_hopper_server::auth::AuthStore,
        db_path: std::path::PathBuf,
        internal_session: Arc<Mutex<Option<InternalActorInfo>>>,
    }

    let qual_state = QualProdState {
        store: store.clone(),
        db_path: db_path.clone(),
        internal_session: internal_session_arc.clone(),
    };

    let qual_routes = Router::new()
        .route(
            "/api/qualification/status",
            get(|State(qs): State<QualProdState>| async move {
                let int_status = qs.internal_session.lock().await;
                let (frames_received, terminal_error) = match &*int_status {
                    Some(info) => (
                        info.frames_received.load(Ordering::SeqCst),
                        info.terminal_error.lock().clone(),
                    ),
                    None => (0, None),
                };
                Json(json!({
                    "qualificationReady": true,
                    "mode": "production-gateway",
                    "internalSessionFrames": frames_received,
                    "internalSessionError": terminal_error,
                }))
            }),
        )
        .route(
            "/api/qualification/internal_session",
            get(|State(qs): State<QualProdState>| async move {
                let guard = qs.internal_session.lock().await;
                let info = guard.as_ref().ok_or(StatusCode::NOT_FOUND)?;
                Ok::<_, StatusCode>(Json(json!({
                    "active": true,
                    "targetId": info.target_id,
                    "sessionId": info.session_id,
                    "framesReceived": info.frames_received.load(Ordering::SeqCst),
                    "terminalError": *info.terminal_error.lock(),
                })))
            }),
        )
        .route(
            "/api/qualification/internal_session/poke",
            post(|State(qs): State<QualProdState>| async move {
                let guard = qs.internal_session.lock().await;
                let info = guard.as_ref().ok_or(StatusCode::NOT_FOUND)?;
                let sid = &info.session_id;
                let res = info.client.send_command(
                    "Runtime.evaluate",
                    Some(json!({
                        "expression": "document.body.style.backgroundColor = document.body.style.backgroundColor === 'red' ? 'blue' : 'red'; 1",
                        "returnByValue": true
                    })),
                    Some(sid),
                ).await;
                if let Err(e) = res {
                    eprintln!("[Qualification Fixture] poke send_command failed: {e}");
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
                Ok::<_, StatusCode>(Json(json!({ "ok": true })))
            }))
        .route(
            "/api/qualification/internal_session/eval",
            post(|State(qs): State<QualProdState>, Json(body): Json<serde_json::Value>| async move {
                let guard = qs.internal_session.lock().await;
                let info = guard.as_ref().ok_or(StatusCode::NOT_FOUND)?;
                let sid = &info.session_id;
                let expr = body.get("expression").and_then(|v| v.as_str()).unwrap_or("document.title");
                let res = info.client.send_command(
                    "Runtime.evaluate",
                    Some(json!({
                        "expression": expr,
                        "returnByValue": true
                    })),
                    Some(sid),
                ).await;
                match res {
                    Ok(val) => Ok::<_, StatusCode>(Json(val)),
                    Err(e) => {
                        eprintln!("[Qualification Fixture] eval failed: {e}");
                        Err(StatusCode::INTERNAL_SERVER_ERROR)
                    }
                }
            }))
        .route(
            "/api/qualification/revoke_session",
            post(|State(qs): State<QualProdState>, Json(body): Json<serde_json::Value>| async move {
                let session_id = body.get("sessionId").and_then(|v| v.as_str()).unwrap_or("admin-session-2");
                let now = chrono::Utc::now();
                let _ = qs.store.revoke_session(session_id, now).await;
                StatusCode::OK
            }),
        )
        .route(
            "/api/qualification/demote_user",
            post(|State(qs): State<QualProdState>, Json(body): Json<serde_json::Value>| async move {
                let username = body.get("username").and_then(|v| v.as_str()).unwrap_or("agent_user");
                if let Ok(conn) = rusqlite::Connection::open(&qs.db_path) {
                    let _ = conn.execute(
                        "UPDATE auth_users SET role = 'user' WHERE username = ?1",
                        [username],
                    );
                }
                StatusCode::OK
            }),
        )
        .with_state(qual_state);

    let app = dam_hopper_server::api::router::build_router_with_origins(app_state.clone(), origins)
        .merge(qual_routes);

    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let ready_json = json!({
        "qualificationReady": true,
        "port": port,
        "httpUrl": format!("http://127.0.0.1:{port}"),
        "wsUrl": format!("ws://127.0.0.1:{port}/api/browser/cdp/ws"),
        "expectedToken": token1,
        "siblingToken": token2,
        "browserPid": browser_pid,
        "mode": "production-gateway",
    });

    println!("{}", serde_json::to_string(&ready_json)?);

    let mut stdin = tokio::io::stdin();
    let mut buf = [0u8; 1024];

    #[cfg(unix)]
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            eprintln!("[Qualification Fixture] Received Ctrl+C, shutting down");
        }
        _ = stdin.read(&mut buf) => {
            eprintln!("[Qualification Fixture] Stdin closed, shutting down");
        }
        _ = async {
            #[cfg(unix)]
            { sigterm.recv().await; }
            #[cfg(not(unix))]
            { std::future::pending::<()>().await; }
        } => {
            eprintln!("[Qualification Fixture] Received SIGTERM, shutting down");
        }
    }

    app_state.browser_host.shutdown_all().await;
    eprintln!("[Qualification Fixture] Production gateway shutdown cleanly");
    Ok(())
}
