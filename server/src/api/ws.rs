use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use axum_extra::extract::CookieJar;
use serde::Deserialize;
use subtle::ConstantTimeEq;
use tracing::{debug, warn};

use crate::api::auth::AUTH_COOKIE;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// WebSocket upgrade handler
// ---------------------------------------------------------------------------

/// GET /ws — upgrades to WebSocket.
///
/// Auth priority:
/// 1. `?token=` query param (cross-origin, sessionStorage)
/// 2. `devhub-auth` cookie (same-origin, e.g. Vite dev proxy)
pub async fn ws_handler(
    upgrade: WebSocketUpgrade,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    jar: CookieJar,
    State(state): State<AppState>,
) -> Response {
    let expected = state.auth_token.as_bytes();

    let auth_ok = params
        .get("token")
        .map(|t| t.as_bytes().ct_eq(expected).into())
        .unwrap_or(false)
        || jar
            .get(AUTH_COOKIE)
            .map(|c| c.value().as_bytes().ct_eq(expected).into())
            .unwrap_or(false);

    if !auth_ok {
        return axum::response::IntoResponse::into_response((
            axum::http::StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({ "error": "Unauthorized" })),
        ));
    }

    upgrade.on_upgrade(move |socket| handle_socket(socket, state))
}

// ---------------------------------------------------------------------------
// Inbound message types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum InboundMsg {
    #[serde(rename = "terminal:write")]
    TerminalWrite { id: String, data: String },
    #[serde(rename = "terminal:resize")]
    TerminalResize { id: String, cols: u16, rows: u16 },
}

// ---------------------------------------------------------------------------
// Socket handler — single loop reads inbound and a separate task forwards outbound
// ---------------------------------------------------------------------------

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut broadcast_rx = state.event_sink.subscribe();
    let pty_mgr = state.pty_manager.clone();

    loop {
        tokio::select! {
            // Outbound: broadcast → WS client
            result = broadcast_rx.recv() => {
                match result {
                    Ok(msg) => {
                        if socket.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!(dropped = n, "WS client lagged; messages dropped");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }

            // Inbound: WS client → PTY manager
            msg = socket.recv() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    _ => break,
                };

                let text = match msg {
                    Message::Text(t) => t,
                    Message::Close(_) => break,
                    _ => continue,
                };

                let parsed: InboundMsg = match serde_json::from_str(&text) {
                    Ok(m) => m,
                    Err(e) => {
                        debug!(error = %e, raw = %text, "WS message parse error");
                        continue;
                    }
                };

                match parsed {
                    InboundMsg::TerminalWrite { id, data } => {
                        if let Err(e) = pty_mgr.write(&id, data.as_bytes()) {
                            debug!(id = %id, error = %e, "PTY write error");
                        }
                    }
                    InboundMsg::TerminalResize { id, cols, rows } => {
                        if let Err(e) = pty_mgr.resize(&id, cols, rows) {
                            debug!(id = %id, error = %e, "PTY resize error");
                        }
                    }
                }
            }
        }
    }
}
