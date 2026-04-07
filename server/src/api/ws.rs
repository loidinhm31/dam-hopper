use std::collections::HashMap;

use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    response::Response,
};
use axum_extra::extract::CookieJar;
use futures_util::stream::StreamExt;
use subtle::ConstantTimeEq;
use tokio::sync::mpsc;
use tracing::{debug, warn};

use futures_util::SinkExt;

use crate::api::auth::AUTH_COOKIE;
use crate::api::ws_protocol::{ClientMsg, FsEventDto, ServerMsg, WireMsg};
use crate::fs::tree_snapshot_sync;
use crate::state::AppState;

/// Bounded per-connection outbound channel.
const CONN_CHAN_CAP: usize = 512;

/// WS close code for backpressure overflow.
/// Uses 4001 (private range 4000-4999, RFC 6455 §7.4.2) — custom application code.
/// 1009 (MANDATORY_EXTENSION) is not appropriate here per RFC semantics.
const CLOSE_OVERFLOW: u16 = 4001;

// ---------------------------------------------------------------------------
// WebSocket upgrade handler
// ---------------------------------------------------------------------------

pub async fn ws_handler(
    upgrade: WebSocketUpgrade,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
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
// Socket handler — writer-task + reader-loop pattern
// ---------------------------------------------------------------------------

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<WireMsg>(CONN_CHAN_CAP);

    // Writer task: drains the per-conn mpsc → WS sink.
    // Owns ws_tx exclusively; no other path writes to the socket.
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            let wire = match msg {
                WireMsg::Text(t) => Message::Text(t.into()),
                WireMsg::Binary(b) => Message::Binary(b.into()),
                WireMsg::CloseOverflow => {
                    let _ = ws_tx
                        .send(Message::Close(Some(CloseFrame {
                            code: CLOSE_OVERFLOW,
                            reason: "message queue overflow".into(),
                        })))
                        .await;
                    break;
                }
            };
            if ws_tx.send(wire).await.is_err() {
                break;
            }
        }
    });

    // PTY broadcast pump: event_sink → mpsc (fire-and-forget; drop-oldest handled
    // at the broadcast channel level — PTY broadcaster drops old messages on lag).
    let pty_rx = state.event_sink.subscribe();
    let pty_out = out_tx.clone();
    let pty_pump = tokio::spawn(pump_pty(pty_rx, pty_out));

    // Per-conn fs subscription pumps: sub_id → JoinHandle
    let mut fs_pumps: HashMap<u64, tokio::task::JoinHandle<()>> = HashMap::new();

    // Reader loop
    while let Some(msg) = ws_rx.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };

        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            Message::Binary(_) | Message::Ping(_) | Message::Pong(_) => continue,
        };

        let parsed: ClientMsg = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                debug!(error = %e, raw = %text, "WS message parse error");
                continue;
            }
        };

        match parsed {
            // -----------------------------------------------------------
            // Terminal
            // -----------------------------------------------------------
            ClientMsg::TermWrite { id, data } => {
                if let Err(e) = state.pty_manager.write(&id, data.as_bytes()) {
                    debug!(id = %id, error = %e, "PTY write error");
                }
            }
            ClientMsg::TermResize { id, cols, rows } => {
                if let Err(e) = state.pty_manager.resize(&id, cols, rows) {
                    debug!(id = %id, error = %e, "PTY resize error");
                }
            }

            // -----------------------------------------------------------
            // FS — subscribe
            // -----------------------------------------------------------
            ClientMsg::FsSubTree { req_id, project, path } => {
                let snapshot_result = do_fs_subscribe(
                    req_id,
                    &project,
                    &path,
                    &state,
                    out_tx.clone(),
                    &mut fs_pumps,
                )
                .await;

                if let Err((code, msg)) = snapshot_result {
                    let err_msg = ServerMsg::FsError { req_id, code, message: msg };
                    if let Ok(json) = serde_json::to_string(&err_msg) {
                        let _ = out_tx.send(WireMsg::Text(json)).await;
                    }
                }
            }

            // -----------------------------------------------------------
            // FS — unsubscribe
            // -----------------------------------------------------------
            ClientMsg::FsUnsubTree { sub_id } => {
                if let Some(handle) = fs_pumps.remove(&sub_id) {
                    handle.abort();
                }
                state.fs.unsubscribe_tree(sub_id);
                debug!(sub_id, "fs:unsubscribe_tree");
            }

            // -----------------------------------------------------------
            // FS — read (stub, full impl Phase 04)
            // -----------------------------------------------------------
            ClientMsg::FsRead { req_id, .. } => {
                let resp = ServerMsg::FsReadResult {
                    req_id,
                    ok: false,
                    mime: None,
                    binary: false,
                    data: None,
                };
                if let Ok(json) = serde_json::to_string(&resp) {
                    let _ = out_tx.send(WireMsg::Text(json)).await;
                }
            }
        }
    }

    // Cleanup: abort all fs pump tasks and release subscriptions
    for (sub_id, handle) in fs_pumps {
        handle.abort();
        state.fs.unsubscribe_tree(sub_id);
    }
    pty_pump.abort();
    writer.abort();
}

// ---------------------------------------------------------------------------
// PTY broadcast pump
// ---------------------------------------------------------------------------

async fn pump_pty(
    mut rx: tokio::sync::broadcast::Receiver<String>,
    out_tx: mpsc::Sender<WireMsg>,
) {
    loop {
        match rx.recv().await {
            Ok(msg) => {
                // Drop-oldest policy: if the PTY event can't be sent (channel
                // closed), we exit cleanly. The broadcast channel handles lag.
                if out_tx.send(WireMsg::Text(msg)).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!(dropped = n, "PTY broadcast lagged; messages dropped");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ---------------------------------------------------------------------------
// FS subscribe helper
// ---------------------------------------------------------------------------

async fn do_fs_subscribe(
    req_id: u64,
    project: &str,
    path: &str,
    state: &AppState,
    out_tx: mpsc::Sender<WireMsg>,
    fs_pumps: &mut HashMap<u64, tokio::task::JoinHandle<()>>,
) -> Result<(), (String, String)> {
    // Resolve project path
    let project_abs = state.project_path(project).await.map_err(|e| {
        ("PROJECT_NOT_FOUND".to_string(), e.to_string())
    })?;

    // Validate via sandbox
    let sandbox = state.fs.sandbox().map_err(|e| {
        ("FS_UNAVAILABLE".to_string(), e.to_string())
    })?;

    let rel_path = if path.is_empty() || path == "/" { "." } else { path.trim_start_matches('/') };
    let abs_path = sandbox.validate(project_abs.join(rel_path)).await.map_err(|e| {
        ("PATH_REJECTED".to_string(), e.to_string())
    })?;

    // Subscribe watcher
    let (sub_id, fs_rx) = state.fs.subscribe_tree(project_abs.clone(), abs_path.clone())
        .map_err(|e| ("WATCHER_ERROR".to_string(), e.to_string()))?;

    debug!(sub_id, project, path, "fs:subscribe_tree");

    // Generate snapshot (blocking IO in spawn_blocking so it doesn't hold the reader)
    let snap_path = abs_path.clone();
    let nodes = tokio::task::spawn_blocking(move || tree_snapshot_sync(&snap_path))
        .await
        .map_err(|e| ("INTERNAL".to_string(), e.to_string()))?
        .map_err(|e| ("SNAPSHOT_ERROR".to_string(), e.to_string()))?;

    // Send snapshot
    let snap = ServerMsg::TreeSnapshot { req_id, sub_id, nodes };
    let json = serde_json::to_string(&snap).map_err(|e| ("SERIALIZE".to_string(), e.to_string()))?;
    out_tx.send(WireMsg::Text(json)).await.map_err(|_| ("CONN_CLOSED".to_string(), "connection closed".to_string()))?;

    // Spawn pump task: broadcast::Receiver<FsEvent> → mpsc, filtered by prefix
    let filter_prefix = abs_path.clone();
    let pump_out = out_tx.clone();
    let handle = tokio::spawn(async move {
        pump_fs_events(sub_id, fs_rx, filter_prefix, pump_out).await;
    });

    fs_pumps.insert(sub_id, handle);
    Ok(())
}

// ---------------------------------------------------------------------------
// FS event pump — per subscription
// ---------------------------------------------------------------------------

async fn pump_fs_events(
    sub_id: u64,
    mut rx: tokio::sync::broadcast::Receiver<crate::fs::FsEvent>,
    filter_prefix: std::path::PathBuf,
    out_tx: mpsc::Sender<WireMsg>,
) {
    loop {
        match rx.recv().await {
            Ok(ev) => {
                // Server-side filter: skip events outside the subscribed subtree.
                // Path::starts_with is component-based (semantic), not byte-level —
                // `/foo/bar` does NOT match prefix `/foo/b`. For rename events, pass
                // through if either path touches the subscribed tree.
                let path_in = ev.path.starts_with(&filter_prefix);
                let from_in = ev.from.as_ref().map(|p| p.starts_with(&filter_prefix)).unwrap_or(false);
                if !path_in && !from_in {
                    continue;
                }

                let dto: FsEventDto = ev.into();
                let msg = ServerMsg::FsEventMsg { sub_id, event: dto };
                let json = match serde_json::to_string(&msg) {
                    Ok(j) => j,
                    Err(e) => {
                        warn!(error = %e, "failed to serialize fs event");
                        continue;
                    }
                };

                // Drop-on-overflow for fs subscriptions: 1009 policy
                match out_tx.try_send(WireMsg::Text(json)) {
                    Ok(_) => {}
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        warn!(sub_id, cap = CONN_CHAN_CAP, "fs pump mpsc full — closing connection (4001)");
                        // Best-effort close frame; writer task may already be gone
                        let _ = out_tx.try_send(WireMsg::CloseOverflow);
                        break;
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => break,
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!(sub_id, dropped = n, "fs broadcast lagged");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}
