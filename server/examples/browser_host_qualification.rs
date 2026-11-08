use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use axum::extract::ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tempfile::tempdir;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message as UpstreamMessage;

use dam_hopper_server::browser_host::process::{
    find_browser_executable, BrowserLaunchConfig, BrowserProcess,
};
use dam_hopper_server::browser_host::protocol::MAX_WS_MESSAGE_BYTES;

/// Per-write deadline for both relay directions (architecture-contracts.md §3 agent relay).
const WRITE_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Clone)]
struct AppState {
    auth_token: String,
    port: u16,
    discovery_auth_received: Arc<AtomicBool>,
    ws_auth_received: Arc<AtomicBool>,
    browser_ws_url: String,
    /// Exact approved Origin; any Origin-bearing request must match it byte for byte.
    allowed_origin: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let auth_token = std::env::var("DAM_HOPPER_QUALIFICATION_TOKEN")
        .unwrap_or_else(|_| "test-qualification-token-secret".to_string());

    let exec = find_browser_executable(None)?;
    let tmp = tempdir()?;
    let mut config = BrowserLaunchConfig::new(tmp.path().join("qual-user-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let mut browser = BrowserProcess::launch(config).await?;
    let browser_ws = browser.ws_endpoint().to_string();

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let port = local_addr.port();

    let state = AppState {
        auth_token: auth_token.clone(),
        port,
        discovery_auth_received: Arc::new(AtomicBool::new(false)),
        ws_auth_received: Arc::new(AtomicBool::new(false)),
        browser_ws_url: browser_ws.clone(),
        allowed_origin: std::env::var("DAM_HOPPER_QUALIFICATION_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| format!("http://127.0.0.1:{port}")),
    };

    let app = Router::new()
        .route("/json/version", get(json_version))
        .route("/json/version/", get(json_version))
        .route("/json/list", get(json_list))
        .route("/json/list/", get(json_list))
        .route("/json", get(json_list))
        .route("/json/", get(json_list))
        .route("/cdp", get(ws_handler))
        .route("/api/qualification/status", get(qualification_status).post(reset_status))
        .route("/api/qualification/reset", post(reset_status))
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

async fn json_version(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    validate_auth(&headers, &state.auth_token)?;
    validate_origin(&headers, &state.allowed_origin)?;
    state.discovery_auth_received.store(true, Ordering::SeqCst);

    let resp = json!({
        "Browser": "Chrome/157.0.8103.38",
        "Protocol-Version": "1.3",
        "User-Agent": "Mozilla/5.0 HeadlessChrome/157.0.8103.38",
        "V8-Version": "12.0.0",
        "WebKit-Version": "537.36",
        "webSocketDebuggerUrl": format!("ws://127.0.0.1:{}/cdp", state.port),
    });

    Ok(Json(resp).into_response())
}

async fn json_list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    validate_auth(&headers, &state.auth_token)?;
    validate_origin(&headers, &state.allowed_origin)?;
    state.discovery_auth_received.store(true, Ordering::SeqCst);

    let resp = json!([{
        "description": "",
        "devtoolsFrontendUrl": "",
        "id": "qualification-page-target",
        "title": "about:blank",
        "type": "page",
        "url": "about:blank",
        "webSocketDebuggerUrl": format!("ws://127.0.0.1:{}/cdp", state.port),
    }]);

    Ok(Json(resp).into_response())
}

async fn ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, StatusCode> {
    validate_auth(&headers, &state.auth_token)?;
    validate_origin(&headers, &state.allowed_origin)?;
    state.ws_auth_received.store(true, Ordering::SeqCst);

    let browser_ws_url = state.browser_ws_url.clone();

    Ok(ws
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(|socket| handle_proxy_socket(socket, browser_ws_url)))
}

/// Test-only relay. Both directions are bounded (4 MiB message/frame, 5s write deadline);
/// any read/write error, oversize message or deadline miss tears down both sockets.
async fn handle_proxy_socket(mut client_ws: WebSocket, browser_ws_url: String) {
    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(MAX_WS_MESSAGE_BYTES);
    config.max_frame_size = Some(MAX_WS_MESSAGE_BYTES);
    let Ok((mut upstream_ws, _)) =
        tokio_tungstenite::connect_async_with_config(&browser_ws_url, Some(config), false).await
    else {
        return;
    };

    loop {
        tokio::select! {
            client_msg = client_ws.next() => {
                let forwarded = match client_msg {
                    Some(Ok(AxumWsMessage::Text(t))) => {
                        within_write_deadline(upstream_ws.send(UpstreamMessage::Text(t.as_str().into()))).await
                    }
                    Some(Ok(AxumWsMessage::Binary(b))) => {
                        within_write_deadline(upstream_ws.send(UpstreamMessage::Binary(b.into()))).await
                    }
                    Some(Ok(AxumWsMessage::Ping(_))) | Some(Ok(AxumWsMessage::Pong(_))) => true,
                    Some(Ok(AxumWsMessage::Close(_))) | Some(Err(_)) | None => false,
                };
                if !forwarded {
                    break;
                }
            }
            upstream_msg = upstream_ws.next() => {
                let forwarded = match upstream_msg {
                    Some(Ok(UpstreamMessage::Text(t))) => {
                        within_write_deadline(client_ws.send(AxumWsMessage::Text(t.as_str().into()))).await
                    }
                    Some(Ok(UpstreamMessage::Binary(b))) => {
                        within_write_deadline(client_ws.send(AxumWsMessage::Binary(b.into()))).await
                    }
                    Some(Ok(UpstreamMessage::Ping(_)))
                    | Some(Ok(UpstreamMessage::Pong(_)))
                    | Some(Ok(UpstreamMessage::Frame(_))) => true,
                    Some(Ok(UpstreamMessage::Close(_))) | Some(Err(_)) | None => false,
                };
                if !forwarded {
                    break;
                }
            }
        }
    }

    // Best-effort bounded close of both sides; dropping afterwards releases the sockets.
    let _ = timeout(WRITE_DEADLINE, upstream_ws.close(None)).await;
    let _ = timeout(WRITE_DEADLINE, client_ws.send(AxumWsMessage::Close(None))).await;
}

/// True only if the write completed successfully within the write deadline.
async fn within_write_deadline<F, E>(write: F) -> bool
where
    F: Future<Output = Result<(), E>>,
{
    matches!(timeout(WRITE_DEADLINE, write).await, Ok(Ok(())))
}

async fn qualification_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "discoveryAuthReceived": state.discovery_auth_received.load(Ordering::SeqCst),
        "wsAuthReceived": state.ws_auth_received.load(Ordering::SeqCst),
        "bothAuthReceived": state.discovery_auth_received.load(Ordering::SeqCst) && state.ws_auth_received.load(Ordering::SeqCst),
    }))
}
async fn reset_status(State(state): State<AppState>) -> StatusCode {
    state.discovery_auth_received.store(false, Ordering::SeqCst);
    state.ws_auth_received.store(false, Ordering::SeqCst);
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
