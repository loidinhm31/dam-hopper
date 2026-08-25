use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket},
        State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use axum_extra::extract::CookieJar;
use base64::{
    engine::general_purpose::STANDARD as BASE64,
    engine::general_purpose::URL_SAFE_NO_PAD as OPAQUE_B64, Engine as _,
};
use futures_util::stream::StreamExt;
use tokio::sync::mpsc;
use tracing::{debug, warn};

use futures_util::SinkExt;

use opaque_ke::ServerLogin;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::api::auth::AUTH_COOKIE;
use crate::api::ws_protocol::{ClientMsg, FsEventDto, ServerMsg, WireMsg};
use crate::crypto::opaque::{
    handle_login_finish, handle_login_start, handle_register_finish, handle_register_start,
    validate_identifier, DamHopperOpaqueSuite,
};
use crate::fs::{
    mutate, ops, secure_path, tree_snapshot_sync, EncUploadState, UploadState, MAX_UPLOAD_BYTES,
};
use crate::state::AppState;
use crate::workspace_target::{ProjectTargetRef, ResolvedProjectTarget};

/// Bounded per-connection outbound channels (split for PTY + FS).
/// PTY (control + terminal output) uses backpressure via .await.
/// FS (file events) uses try_send; overflow drops the subscription only.
/// Both use 512 cap to handle burst scenarios (large git operations, parallel builds).
const PTY_CHAN_CAP: usize = 512;
const FS_CHAN_CAP: usize = 512;
const ALERT_CHAN_CAP: usize = 32;

/// WS close code for backpressure overflow (deprecated with channel split).
const CLOSE_OVERFLOW: u16 = 4001;

/// Max file size for unrestricted WS read (5 MB). Larger files require range reads.
const FS_WS_READ_MAX: u64 = 5 * 1024 * 1024;

/// Max write size cap (100 MB). Enforced at write_begin.
const FS_WRITE_MAX: u64 = 100 * 1024 * 1024;

// ---------------------------------------------------------------------------
// In-flight write state (per connection)
// ---------------------------------------------------------------------------

struct WriteInFlight {
    /// Immutable server-resolved target identity captured at write begin.
    target: TargetBinding,
    /// Target-relative path used for commit-time re-resolution.
    relative_path: std::path::PathBuf,
    /// Absolute validated path being written.
    abs_path: std::path::PathBuf,
    /// Client-supplied expected mtime; checked at commit time.
    expected_mtime: i64,
    /// Declared total size from write_begin — enforced as per-session cap.
    declared_size: u64,
    /// Next expected seq number (monotonic validation).
    next_seq: u32,
    /// Temporary file co-located with the target.
    temp: tempfile::NamedTempFile,
    /// Total bytes written to the temp file.
    bytes_written: u64,
}

struct UploadInFlight {
    target: TargetBinding,
    relative_path: std::path::PathBuf,
    inner: UploadState,
}

struct EncUploadInFlight {
    target: TargetBinding,
    relative_path: std::path::PathBuf,
    inner: EncUploadState,
}

struct FsSubscriptionGuard {
    fs: crate::fs::FsSubsystem,
    sub_id: u64,
    armed: bool,
}

impl FsSubscriptionGuard {
    fn new(fs: crate::fs::FsSubsystem, sub_id: u64) -> Self {
        Self {
            fs,
            sub_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for FsSubscriptionGuard {
    fn drop(&mut self) {
        if self.armed {
            self.fs.unsubscribe_tree(self.sub_id);
        }
    }
}

#[derive(Clone)]
struct TargetBinding {
    resolved: ResolvedProjectTarget,
    root_identity: secure_path::DirectoryIdentity,
}

// ---------------------------------------------------------------------------
// WebSocket upgrade handler
// ---------------------------------------------------------------------------

pub async fn ws_handler(
    upgrade: WebSocketUpgrade,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    jar: CookieJar,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    let token = params
        .get("token")
        .cloned()
        .or_else(|| jar.get(AUTH_COOKIE).map(|c| c.value().to_string()));
    let origin_ok = websocket_origin_allowed(
        state.no_auth,
        headers.contains_key(header::ORIGIN),
        state.origin_is_allowed(&headers),
        params.contains_key("token"),
    );

    if !origin_ok {
        return axum::response::IntoResponse::into_response((
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({ "error": "Origin not allowed" })),
        ));
    }

    let auth_ok = websocket_auth_ok(state.no_auth, token, &state.jwt_secret);

    if !auth_ok {
        return axum::response::IntoResponse::into_response((
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({ "error": "Unauthorized" })),
        ));
    }

    upgrade.on_upgrade(move |socket| handle_socket(socket, state))
}

fn websocket_origin_allowed(
    no_auth: bool,
    has_origin: bool,
    origin_is_allowed: bool,
    has_query_token: bool,
) -> bool {
    if has_origin {
        origin_is_allowed
    } else {
        // Browser handshakes always include Origin. Permit origin-less clients
        // only when they present a bearer query token (or explicit no-auth).
        no_auth || has_query_token
    }
}

fn websocket_auth_ok(no_auth: bool, token: Option<String>, jwt_secret: &str) -> bool {
    no_auth
        || token
            .map(|value| crate::api::auth::validate_jwt(&value, jwt_secret))
            .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Socket handler — writer-task + reader-loop pattern
// ---------------------------------------------------------------------------

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Split channels: alerts get a priority queue ahead of PTY output; FS uses
    // try_send and drops only the overflowing subscription.
    let (pty_tx, mut pty_rx) = mpsc::channel::<WireMsg>(PTY_CHAN_CAP);
    let (fs_tx, mut fs_rx) = mpsc::channel::<WireMsg>(FS_CHAN_CAP);
    let (alert_tx, mut alert_rx) = mpsc::channel::<WireMsg>(ALERT_CHAN_CAP);

    // Writer task: drains both channels → WS sink using select.
    let writer = tokio::spawn(async move {
        loop {
            let msg = tokio::select! {
                biased;
                Some(m) = alert_rx.recv() => m,
                Some(m) = pty_rx.recv() => m,
                Some(m) = fs_rx.recv() => m,
                else => break,
            };

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

    // PTY output and host alerts use independent broadcast streams, so a noisy
    // terminal cannot cause an alert-stream gap.
    let pty_order = Arc::new(tokio::sync::Mutex::new(()));
    let pty_rx_broadcast = state.event_sink.subscribe();
    let pty_out = pty_tx.clone();
    let pty_pump = tokio::spawn(pump_pty(pty_rx_broadcast, pty_out, Arc::clone(&pty_order)));
    let host_alert_rx = state.event_sink.subscribe_host_alerts();
    let host_alert_pump = tokio::spawn(pump_host_alerts(host_alert_rx, alert_tx));

    // Per-conn fs subscription pumps: sub_id → JoinHandle
    let mut fs_pumps: HashMap<u64, tokio::task::JoinHandle<()>> = HashMap::new();

    // In-flight write sessions: write_id → WriteInFlight
    let mut writes: HashMap<u64, WriteInFlight> = HashMap::new();
    let mut next_write_id: u64 = 1;

    // In-flight upload sessions: upload_id → UploadState
    let mut uploads: HashMap<String, UploadInFlight> = HashMap::new();
    // In-flight encrypted upload sessions: upload_id → EncUploadState
    let mut enc_uploads: HashMap<String, EncUploadInFlight> = HashMap::new();

    enum PendingBinary {
        Upload {
            upload_id: String,
            seq: u64,
        },
        Write {
            write_id: u64,
            seq: u32,
        },
        /// Phase 04: encrypted binary upload chunk (fs:put_chunk)
        EncPut {
            upload_id: String,
            seq: u64,
        },
        /// Phase 04/06: encrypted text save — carries resolved paths for the binary handler
        EncPutSave {
            req_id: u64,
            session_id: String,
            target: TargetBinding,
            relative_path: std::path::PathBuf,
            path_abs: std::path::PathBuf,
        },
    }
    // Pending binary frame correlation: set by fs:upload_chunk or fs:write_chunk_binary
    let mut pending_binary: Option<PendingBinary> = None;

    // Per-connection OPAQUE login state (intermediate, consumed at login_finish)
    let mut opaque_login_states: HashMap<String, ServerLogin<DamHopperOpaqueSuite>> =
        HashMap::new();
    // Per-connection AES keys derived from OPAQUE login (keyed by session_id)
    let mut aes_keys: HashMap<String, Zeroizing<Vec<u8>>> = HashMap::new();

    // Reader loop
    while let Some(msg) = ws_rx.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };

        // Handle binary frames for upload chunks and binary write chunks
        if let Message::Binary(bytes) = msg {
            match pending_binary.take() {
                Some(PendingBinary::Upload { upload_id, seq }) => {
                    handle_upload_binary(&upload_id, seq, bytes.as_ref(), &mut uploads, &pty_tx)
                        .await;
                }
                Some(PendingBinary::Write { write_id, seq }) => {
                    handle_write_binary(write_id, seq, bytes.as_ref(), &mut writes, &pty_tx).await;
                }
                Some(PendingBinary::EncPut { upload_id, seq }) => {
                    handle_enc_put_binary(
                        &upload_id,
                        seq,
                        bytes.as_ref(),
                        &mut enc_uploads,
                        &pty_tx,
                    )
                    .await;
                }
                Some(PendingBinary::EncPutSave {
                    req_id,
                    session_id,
                    target,
                    relative_path,
                    path_abs,
                }) => {
                    handle_enc_put_save_binary(
                        req_id,
                        &session_id,
                        &target,
                        &relative_path,
                        &path_abs,
                        bytes.as_ref(),
                        &state,
                        &aes_keys,
                        &pty_tx,
                    )
                    .await;
                }
                None => {
                    warn!("unexpected binary frame (no pending header) — dropping");
                }
            }
            continue;
        }

        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Binary(_) => unreachable!("handled above"),
        };

        let parsed: ClientMsg = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                debug!(error = %e, "WS message parse error");
                state.diagnostics.record_terminal_event(
                    "ws",
                    "ws.parse_error",
                    std::collections::BTreeMap::from([
                        ("error".into(), e.to_string()),
                        // Do NOT store raw text — may contain user input/secrets.
                    ]),
                );
                continue;
            }
        };

        match parsed {
            // -----------------------------------------------------------
            // Terminal
            // -----------------------------------------------------------
            ClientMsg::TermWrite { id, data } => {
                // Record byte count only — never the raw input data (Phase 03 security).
                state.diagnostics.record_terminal_event(
                    "ws",
                    "terminal.write",
                    std::collections::BTreeMap::from([
                        ("sessionId".into(), id.clone()),
                        ("bytes".into(), data.len().to_string()),
                    ]),
                );
                if let Err(e) = state.pty_manager.write(&id, data.as_bytes()) {
                    debug!(id = %id, error = %e, "PTY write error");
                }
            }
            ClientMsg::TermResize { id, cols, rows } => {
                state.diagnostics.record_terminal_event(
                    "ws",
                    "terminal.resize",
                    std::collections::BTreeMap::from([
                        ("sessionId".into(), id.clone()),
                        ("cols".into(), cols.to_string()),
                        ("rows".into(), rows.to_string()),
                    ]),
                );
                if let Err(e) = state.pty_manager.resize(&id, cols, rows) {
                    debug!(id = %id, error = %e, "PTY resize error");
                }
            }
            ClientMsg::TermAttach { id, from_offset } => {
                state.diagnostics.record_terminal_event(
                    "ws",
                    "terminal.attach",
                    std::collections::BTreeMap::from([
                        ("sessionId".into(), id.clone()),
                        (
                            "fromOffset".into(),
                            from_offset
                                .map(|v| v.to_string())
                                .unwrap_or_else(|| "none".into()),
                        ),
                    ]),
                );
                // Replay is sent only to this connection. Preserve the PTY's
                // current editing state for this client without broadcasting a
                // lifecycle reset to other viewers of the same session.
                // Serialize the snapshot and its response frames against this
                // connection's live PTY pump so output cannot overtake replay.
                let _attach_order = pty_order.lock().await;
                match state.pty_manager.get_attach_snapshot(&id, from_offset) {
                    Ok(snapshot) => {
                        let replay = snapshot.replay;
                        let msg = ServerMsg::TermBuffer {
                            id: id.clone(),
                            data: replay.data,
                            offset: replay.offset,
                            reset: replay.reset,
                            truncated: replay.truncated,
                        };
                        if let Ok(json) = serde_json::to_string(&msg) {
                            if let Err(e) = pty_tx.send(WireMsg::Text(json)).await {
                                warn!(id = %id, error = %e, "Failed to send terminal:buffer");
                            }
                        }
                        if let Some(generation) = snapshot.editing_generation {
                            let msg = ServerMsg::TerminalLifecycle {
                                id: id.clone(),
                                lifecycle: "editing".into(),
                                generation,
                                command: None,
                            };
                            if let Ok(json) = serde_json::to_string(&msg) {
                                if let Err(e) = pty_tx.send(WireMsg::Text(json)).await {
                                    warn!(id = %id, error = %e, "Failed to send terminal lifecycle snapshot");
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!(id = %id, error = %e, "terminal:attach failed");
                        state.diagnostics.record_terminal_event(
                            "ws",
                            "terminal.attach_failed",
                            std::collections::BTreeMap::from([
                                ("sessionId".into(), id.clone()),
                                ("error".into(), e.to_string()),
                            ]),
                        );
                        // No response — client should detect via timeout and create new session
                    }
                }
            }

            // -----------------------------------------------------------
            // FS — subscribe / unsubscribe
            // -----------------------------------------------------------
            ClientMsg::FsSubTree {
                req_id,
                project,
                worktree_path,
                path,
            } => {
                let result = do_fs_subscribe(
                    req_id,
                    &project,
                    worktree_path.as_deref(),
                    &path,
                    &state,
                    pty_tx.clone(),
                    fs_tx.clone(),
                    &mut fs_pumps,
                )
                .await;

                if let Err((code, msg)) = result {
                    send_fs_error(&pty_tx, req_id, code, msg).await;
                }
            }

            ClientMsg::FsUnsubTree { sub_id } => {
                if let Some(handle) = fs_pumps.remove(&sub_id) {
                    handle.abort();
                }
                state.fs.unsubscribe_tree(sub_id);
                debug!(sub_id, "fs:unsubscribe_tree");
            }

            // -----------------------------------------------------------
            // FS — read
            // -----------------------------------------------------------
            ClientMsg::FsRead {
                req_id,
                project,
                worktree_path,
                path,
                offset,
                len,
            } => {
                let result = do_fs_read(
                    req_id,
                    &project,
                    worktree_path.as_deref(),
                    &path,
                    offset,
                    len,
                    &state,
                )
                .await;
                let json = match serde_json::to_string(&result) {
                    Ok(j) => j,
                    Err(e) => {
                        warn!(error = %e, "failed to serialize fs:read_result");
                        continue;
                    }
                };
                let _ = pty_tx.send(WireMsg::Text(json)).await;
            }

            // -----------------------------------------------------------
            // FS — write begin
            // -----------------------------------------------------------
            ClientMsg::FsWriteBegin {
                req_id,
                project,
                worktree_path,
                path,
                expected_mtime,
                size,
                encoding: _,
            } => {
                if size > FS_WRITE_MAX {
                    send_fs_error(
                        &pty_tx,
                        req_id,
                        "TOO_LARGE".into(),
                        format!("write size {} exceeds {FS_WRITE_MAX} byte cap", size),
                    )
                    .await;
                    continue;
                }

                let target_result =
                    resolve_target_path(&project, worktree_path.as_deref(), &path, &state).await;
                match target_result {
                    Err((code, msg)) => send_fs_error(&pty_tx, req_id, code, msg).await,
                    Ok((target, abs_path)) => {
                        let relative_path = match abs_path.strip_prefix(target.target_path()) {
                            Ok(relative) => relative.to_path_buf(),
                            Err(_) => {
                                send_fs_error(
                                    &pty_tx,
                                    req_id,
                                    "PATH_REJECTED".into(),
                                    "resolved path is outside the selected target".into(),
                                )
                                .await;
                                continue;
                            }
                        };
                        let target = match bind_resolved_target(target).await {
                            Ok(target) => target,
                            Err(error) => {
                                send_fs_error(
                                    &pty_tx,
                                    req_id,
                                    "PATH_REJECTED".into(),
                                    error.to_string(),
                                )
                                .await;
                                continue;
                            }
                        };
                        let parent = abs_path.parent().unwrap_or(&abs_path);
                        let temp = match tempfile::NamedTempFile::new_in(parent) {
                            Ok(t) => t,
                            Err(e) => {
                                warn!(req_id, error = %e, "fs:write_begin: tempfile creation failed");
                                send_fs_error(&pty_tx, req_id, "IO_ERROR".into(), e.to_string())
                                    .await;
                                continue;
                            }
                        };

                        let write_id = next_write_id;
                        next_write_id += 1;
                        writes.insert(
                            write_id,
                            WriteInFlight {
                                target,
                                relative_path,
                                abs_path,
                                expected_mtime,
                                declared_size: size,
                                temp,
                                bytes_written: 0,
                                next_seq: 0,
                            },
                        );
                        let ack = ServerMsg::FsWriteAck { req_id, write_id };
                        if let Ok(json) = serde_json::to_string(&ack) {
                            let _ = pty_tx.send(WireMsg::Text(json)).await;
                        }
                        debug!(req_id, write_id, path, project, "fs:write_begin");
                    }
                }
            }

            // -----------------------------------------------------------
            // FS — write chunk
            // -----------------------------------------------------------
            ClientMsg::FsWriteChunk {
                write_id,
                seq,
                eof,
                data,
            } => {
                let entry = match writes.get_mut(&write_id) {
                    Some(e) => e,
                    None => {
                        warn!(write_id, "fs:write_chunk for unknown write_id — dropping");
                        continue;
                    }
                };

                if seq != entry.next_seq {
                    warn!(
                        write_id,
                        seq,
                        expected = entry.next_seq,
                        "out-of-order chunk — aborting write"
                    );
                    writes.remove(&write_id);
                    continue;
                }

                match BASE64.decode(&data) {
                    Ok(bytes) => {
                        let accumulated = entry.bytes_written + bytes.len() as u64;
                        if accumulated > entry.declared_size {
                            warn!(
                                write_id,
                                accumulated,
                                declared = entry.declared_size,
                                "write_chunk exceeds declared size — aborting write"
                            );
                            writes.remove(&write_id);
                            continue;
                        }
                        if let Err(e) = entry.temp.write_all(&bytes) {
                            warn!(write_id, error = %e, "write_chunk: tempfile write failed — aborting write");
                            writes.remove(&write_id);
                            continue;
                        }
                        entry.bytes_written = accumulated;
                        entry.next_seq += 1;
                    }
                    Err(e) => {
                        warn!(write_id, seq, error = %e, "chunk base64 decode failed — aborting write");
                        writes.remove(&write_id);
                        continue;
                    }
                }

                let _ = eof;

                let ack = ServerMsg::FsWriteChunkAck { write_id, seq };
                if let Ok(json) = serde_json::to_string(&ack) {
                    let _ = pty_tx.send(WireMsg::Text(json)).await;
                }
            }

            // -----------------------------------------------------------
            // FS — write chunk binary (binary frame follows)
            // -----------------------------------------------------------
            ClientMsg::FsWriteChunkBinary { write_id, seq } => {
                let entry = match writes.get(&write_id) {
                    Some(e) => e,
                    None => {
                        warn!(
                            write_id,
                            "fs:write_chunk_binary for unknown write_id — dropping"
                        );
                        continue;
                    }
                };

                if seq != entry.next_seq {
                    warn!(
                        write_id,
                        seq,
                        expected = entry.next_seq,
                        "out-of-order binary chunk — aborting write"
                    );
                    writes.remove(&write_id);
                    continue;
                }

                pending_binary = Some(PendingBinary::Write { write_id, seq });
            }

            // -----------------------------------------------------------
            // FS — write commit
            // -----------------------------------------------------------
            ClientMsg::FsWriteCommit { write_id } => {
                let entry = match writes.remove(&write_id) {
                    Some(e) => e,
                    None => {
                        warn!(write_id, "fs:write_commit for unknown write_id");
                        let result_msg = ServerMsg::FsWriteResult {
                            write_id,
                            ok: false,
                            new_mtime: None,
                            conflict: false,
                            error: Some("write session not found".into()),
                        };
                        if let Ok(json) = serde_json::to_string(&result_msg) {
                            let _ = pty_tx.send(WireMsg::Text(json)).await;
                        }
                        continue;
                    }
                };

                // Integrity check: must have written exactly the declared size.
                if entry.bytes_written != entry.declared_size {
                    warn!(
                        write_id,
                        written = entry.bytes_written,
                        declared = entry.declared_size,
                        "fs:write_commit: bytes_written != declared_size — rejecting"
                    );
                    let result_msg = ServerMsg::FsWriteResult {
                        write_id,
                        ok: false,
                        new_mtime: None,
                        conflict: false,
                        error: Some(format!(
                            "incomplete write: sent {} of {} bytes",
                            entry.bytes_written, entry.declared_size
                        )),
                    };
                    if let Ok(json) = serde_json::to_string(&result_msg) {
                        let _ = pty_tx.send(WireMsg::Text(json)).await;
                    }
                    continue;
                }

                let revalidated = revalidate_bound_path(
                    &state,
                    &entry.target,
                    &entry.relative_path,
                    &entry.abs_path,
                    false,
                )
                .await;
                let write_result = match revalidated {
                    Ok(_) => {
                        secure_path::persist_temp(
                            entry.target.resolved.target_path().to_path_buf(),
                            entry.relative_path.clone(),
                            entry.temp,
                            Some(entry.expected_mtime),
                            Some(entry.target.root_identity),
                            false,
                        )
                        .await
                    }
                    Err(error) => Err(error),
                };

                let result_msg = match write_result {
                    Ok(new_mtime) => {
                        debug!(write_id, new_mtime, "fs:write_commit success");
                        ServerMsg::FsWriteResult {
                            write_id,
                            ok: true,
                            new_mtime: Some(new_mtime),
                            conflict: false,
                            error: None,
                        }
                    }
                    Err(crate::fs::FsError::Conflict) => {
                        warn!(write_id, "fs:write_commit conflict");
                        ServerMsg::FsWriteResult {
                            write_id,
                            ok: false,
                            new_mtime: None,
                            conflict: true,
                            error: Some("file modified since last read".into()),
                        }
                    }
                    Err(e) => {
                        warn!(write_id, error = %e, "fs:write_commit error");
                        ServerMsg::FsWriteResult {
                            write_id,
                            ok: false,
                            new_mtime: None,
                            conflict: false,
                            error: Some(e.to_string()),
                        }
                    }
                };

                if let Ok(json) = serde_json::to_string(&result_msg) {
                    let _ = pty_tx.send(WireMsg::Text(json)).await;
                }
            }

            // -----------------------------------------------------------
            // FS — mutating ops
            // -----------------------------------------------------------
            ClientMsg::FsOp {
                req_id,
                op,
                project,
                worktree_path,
                path,
                new_path,
                force_git,
            } => {
                let result = do_fs_op(
                    req_id,
                    &op,
                    &project,
                    worktree_path.as_deref(),
                    &path,
                    new_path.as_deref(),
                    force_git,
                    &state,
                )
                .await;
                let msg = match result {
                    Ok(()) => ServerMsg::FsOpResult {
                        req_id,
                        ok: true,
                        error: None,
                    },
                    Err(e) => {
                        warn!(req_id, op = %op, error = %e, "fs:op failed");
                        ServerMsg::FsOpResult {
                            req_id,
                            ok: false,
                            error: Some(e.to_string()),
                        }
                    }
                };
                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = pty_tx.send(WireMsg::Text(json)).await;
                }
            }

            // -----------------------------------------------------------
            // FS — upload begin
            // -----------------------------------------------------------
            ClientMsg::FsUploadBegin {
                req_id,
                upload_id,
                project,
                worktree_path,
                dir,
                filename,
                len,
            } => {
                let result = do_upload_begin(
                    req_id,
                    &upload_id,
                    &project,
                    worktree_path.as_deref(),
                    &dir,
                    &filename,
                    len,
                    &state,
                    &mut uploads,
                )
                .await;
                let msg = match result {
                    Ok(()) => ServerMsg::FsUploadBeginOk { req_id, upload_id },
                    Err(e) => {
                        warn!(req_id, upload_id, error = %e, "fs:upload_begin failed");
                        ServerMsg::FsError {
                            req_id,
                            code: "UPLOAD_BEGIN_FAILED".into(),
                            message: e.to_string(),
                        }
                    }
                };
                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = pty_tx.send(WireMsg::Text(json)).await;
                }
            }

            // -----------------------------------------------------------
            // FS — upload chunk header (binary frame follows)
            // -----------------------------------------------------------
            ClientMsg::FsUploadChunk { upload_id, seq } => {
                // Validate state exists before accepting the binary frame.
                if !uploads.contains_key(&upload_id) {
                    warn!(
                        upload_id,
                        seq, "fs:upload_chunk for unknown upload_id — dropping"
                    );
                    continue;
                }
                if uploads[&upload_id].inner.next_seq != seq {
                    warn!(
                        upload_id,
                        seq,
                        expected = uploads[&upload_id].inner.next_seq,
                        "out-of-order chunk — aborting upload"
                    );
                    uploads.remove(&upload_id);
                    continue;
                }
                // Store the pending correlation; binary frame handler will pick it up.
                pending_binary = Some(PendingBinary::Upload { upload_id, seq });
            }

            // -----------------------------------------------------------
            // FS — upload commit
            // -----------------------------------------------------------
            ClientMsg::FsUploadCommit { req_id, upload_id } => {
                let state_opt = uploads.remove(&upload_id);
                let msg = match state_opt {
                    None => {
                        warn!(req_id, upload_id, "fs:upload_commit for unknown upload_id");
                        ServerMsg::FsUploadResult {
                            req_id,
                            upload_id,
                            ok: false,
                            new_mtime: None,
                            error: Some("upload session not found".into()),
                        }
                    }
                    Some(upload_state) => {
                        let up_id = upload_state.inner.target_abs.to_string_lossy().to_string();
                        let revalidated = revalidate_bound_path(
                            &state,
                            &upload_state.target,
                            &upload_state.relative_path,
                            &upload_state.inner.target_abs,
                            true,
                        )
                        .await;
                        match revalidated {
                            Err(error) => ServerMsg::FsUploadResult {
                                req_id,
                                upload_id,
                                ok: false,
                                new_mtime: None,
                                error: Some(error.to_string()),
                            },
                            Ok(_) => {
                                let target_root =
                                    upload_state.target.resolved.target_path().to_path_buf();
                                let relative_path = upload_state.relative_path.clone();
                                let commit = tokio::task::spawn_blocking(move || {
                                    upload_state.inner.commit_at_target(
                                        &target_root,
                                        &relative_path,
                                        None,
                                        Some(upload_state.target.root_identity),
                                        false,
                                    )
                                })
                                .await;
                                match commit {
                                    Ok(Ok(new_mtime)) => {
                                        debug!(req_id, new_mtime, "fs:upload_commit success");
                                        crate::audit_fs!("upload", "<upload>", up_id, true);
                                        ServerMsg::FsUploadResult {
                                            req_id,
                                            upload_id,
                                            ok: true,
                                            new_mtime: Some(new_mtime),
                                            error: None,
                                        }
                                    }
                                    Ok(Err(e)) => {
                                        warn!(req_id, error = %e, "fs:upload_commit failed");
                                        ServerMsg::FsUploadResult {
                                            req_id,
                                            upload_id,
                                            ok: false,
                                            new_mtime: None,
                                            error: Some(e.to_string()),
                                        }
                                    }
                                    Err(e) => {
                                        warn!(
                                            req_id,
                                            error = %e,
                                            "fs:upload_commit spawn_blocking error"
                                        );
                                        ServerMsg::FsUploadResult {
                                            req_id,
                                            upload_id,
                                            ok: false,
                                            new_mtime: None,
                                            error: Some(e.to_string()),
                                        }
                                    }
                                }
                            }
                        }
                    }
                };
                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = pty_tx.send(WireMsg::Text(json)).await;
                }
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE registration (auth:register_start)
            // -----------------------------------------------------------
            ClientMsg::AuthRegisterStart {
                req_id,
                identifier,
                data,
            } => {
                if !validate_identifier(&identifier) {
                    let msg = ServerMsg::AuthRegisterStartResponse {
                        req_id,
                        ok: false,
                        data: None,
                        error: Some(
                            "invalid identifier (alphanumeric + hyphens, max 128 chars)".into(),
                        ),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                let decoded = match OPAQUE_B64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthRegisterStartResponse {
                            req_id,
                            ok: false,
                            data: None,
                            error: Some(format!("base64 decode failed: {e}")),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let setup = std::sync::Arc::clone(&state.opaque_server_setup);
                let id = identifier.clone();
                let result = tokio::task::spawn_blocking(move || {
                    handle_register_start(&setup, &id, &decoded)
                })
                .await;

                let msg = match result {
                    Ok(Ok(response_bytes)) => {
                        debug!(req_id, identifier, "auth:register_start ok");
                        ServerMsg::AuthRegisterStartResponse {
                            req_id,
                            ok: true,
                            data: Some(OPAQUE_B64.encode(&response_bytes)),
                            error: None,
                        }
                    }
                    Ok(Err(e)) => {
                        warn!(req_id, identifier, error = %e, "auth:register_start failed");
                        ServerMsg::AuthRegisterStartResponse {
                            req_id,
                            ok: false,
                            data: None,
                            error: Some(e),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:register_start spawn_blocking error");
                        ServerMsg::AuthRegisterStartResponse {
                            req_id,
                            ok: false,
                            data: None,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE registration (auth:register_finish)
            // -----------------------------------------------------------
            ClientMsg::AuthRegisterFinish {
                req_id,
                identifier,
                data,
                overwrite,
            } => {
                if !validate_identifier(&identifier) {
                    let msg = ServerMsg::AuthRegisterFinishResponse {
                        req_id,
                        ok: false,
                        error: Some("invalid identifier".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                // Reject silent overwrite of an existing registration (H1).
                if !overwrite
                    && state
                        .opaque_registrations
                        .read()
                        .await
                        .contains_key(&identifier)
                {
                    let msg = ServerMsg::AuthRegisterFinishResponse {
                        req_id,
                        ok: false,
                        error: Some(
                            "identifier already registered — set overwrite:true to replace".into(),
                        ),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                let decoded = match OPAQUE_B64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthRegisterFinishResponse {
                            req_id,
                            ok: false,
                            error: Some(format!("base64 decode failed: {e}")),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let result =
                    tokio::task::spawn_blocking(move || handle_register_finish(&decoded)).await;

                let msg = match result {
                    Ok(Ok(registration)) => {
                        state
                            .opaque_registrations
                            .write()
                            .await
                            .insert(identifier.clone(), registration);
                        debug!(
                            req_id,
                            identifier, overwrite, "auth:register_finish ok — credential stored"
                        );
                        ServerMsg::AuthRegisterFinishResponse {
                            req_id,
                            ok: true,
                            error: None,
                        }
                    }
                    Ok(Err(e)) => {
                        warn!(req_id, identifier, error = %e, "auth:register_finish failed");
                        ServerMsg::AuthRegisterFinishResponse {
                            req_id,
                            ok: false,
                            error: Some(e),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:register_finish spawn_blocking error");
                        ServerMsg::AuthRegisterFinishResponse {
                            req_id,
                            ok: false,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE login (auth:login_start)
            // -----------------------------------------------------------
            ClientMsg::AuthLoginStart {
                req_id,
                identifier,
                data,
            } => {
                if !validate_identifier(&identifier) {
                    let msg = ServerMsg::AuthLoginStartResponse {
                        req_id,
                        ok: false,
                        session_id: None,
                        data: None,
                        error: Some("invalid identifier".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                // C2: cap in-flight login sessions per connection to prevent memory exhaustion.
                if opaque_login_states.len() >= 16 {
                    let msg = ServerMsg::AuthLoginStartResponse {
                        req_id,
                        ok: false,
                        session_id: None,
                        data: None,
                        error: Some(
                            "too many pending login sessions — complete or abandon existing ones"
                                .into(),
                        ),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                let decoded = match OPAQUE_B64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthLoginStartResponse {
                            req_id,
                            ok: false,
                            session_id: None,
                            data: None,
                            error: Some(format!("base64 decode failed: {e}")),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let registration = state
                    .opaque_registrations
                    .read()
                    .await
                    .get(&identifier)
                    .cloned();
                let setup = std::sync::Arc::clone(&state.opaque_server_setup);
                let id = identifier.clone();
                let session_id = Uuid::new_v4().to_string();
                let sid_for_state = session_id.clone();

                let result = tokio::task::spawn_blocking(move || {
                    handle_login_start(&setup, &id, registration, &decoded)
                })
                .await;

                let msg = match result {
                    Ok(Ok((login_state, response_bytes))) => {
                        opaque_login_states.insert(sid_for_state, login_state);
                        debug!(req_id, identifier, session_id, "auth:login_start ok");
                        ServerMsg::AuthLoginStartResponse {
                            req_id,
                            ok: true,
                            session_id: Some(session_id),
                            data: Some(OPAQUE_B64.encode(&response_bytes)),
                            error: None,
                        }
                    }
                    Ok(Err(e)) => {
                        warn!(req_id, identifier, error = %e, "auth:login_start failed");
                        ServerMsg::AuthLoginStartResponse {
                            req_id,
                            ok: false,
                            session_id: None,
                            data: None,
                            error: Some(e),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:login_start spawn_blocking error");
                        ServerMsg::AuthLoginStartResponse {
                            req_id,
                            ok: false,
                            session_id: None,
                            data: None,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE login (auth:login_finish)
            // -----------------------------------------------------------
            ClientMsg::AuthLoginFinish {
                req_id,
                session_id,
                data,
            } => {
                // C3: check aes_keys cap before consuming login_state so client can retry.
                if aes_keys.len() >= 16 {
                    let msg = ServerMsg::AuthLoginFinishResponse {
                        req_id, ok: false, session_id: None,
                        error: Some("too many active sessions — remove unused sessions before logging in again".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                let login_state = match opaque_login_states.remove(&session_id) {
                    Some(s) => s,
                    None => {
                        let msg = ServerMsg::AuthLoginFinishResponse {
                            req_id,
                            ok: false,
                            session_id: None,
                            error: Some(
                                "login session not found — run auth:login_start first".into(),
                            ),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let decoded = match OPAQUE_B64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthLoginFinishResponse {
                            req_id,
                            ok: false,
                            session_id: None,
                            error: Some(format!("base64 decode failed: {e}")),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let sid = session_id.clone();
                let result =
                    tokio::task::spawn_blocking(move || handle_login_finish(login_state, &decoded))
                        .await;

                let msg = match result {
                    Ok(Ok(aes_key)) => {
                        aes_keys.insert(session_id.clone(), aes_key);
                        debug!(req_id, session_id, "auth:login_finish ok — AES key derived");
                        ServerMsg::AuthLoginFinishResponse {
                            req_id,
                            ok: true,
                            session_id: Some(sid),
                            error: None,
                        }
                    }
                    Ok(Err(_e)) => {
                        warn!(
                            req_id,
                            session_id, "auth:login_finish failed (crypto error)"
                        );
                        ServerMsg::AuthLoginFinishResponse {
                            req_id,
                            ok: false,
                            session_id: None,
                            error: Some("authentication failed".into()),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:login_finish spawn_blocking error");
                        ServerMsg::AuthLoginFinishResponse {
                            req_id,
                            ok: false,
                            session_id: None,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            ClientMsg::AuthSessionRemove { session_id } => {
                if aes_keys.remove(&session_id).is_some() {
                    debug!(session_id, "auth:session_remove — key evicted");
                }
            }

            // -----------------------------------------------------------
            // FS — encrypted put (Phase 04 implementation)
            // -----------------------------------------------------------
            ClientMsg::FsPutBegin {
                req_id,
                upload_id,
                session_id,
                project,
                worktree_path,
                dir,
                filename,
                len,
                expected_mtime,
            } => {
                if !aes_keys.contains_key(&session_id) {
                    send_fs_error(
                        &pty_tx,
                        req_id,
                        "OPAQUE_LOGIN_REQUIRED".into(),
                        "fs:put_begin requires OPAQUE login (auth:login_start + auth:login_finish)"
                            .into(),
                    )
                    .await;
                } else {
                    match do_enc_put_begin(
                        req_id,
                        &upload_id,
                        &session_id,
                        &project,
                        worktree_path.as_deref(),
                        &dir,
                        &filename,
                        len,
                        expected_mtime,
                        &state,
                        &mut enc_uploads,
                    )
                    .await
                    {
                        Ok(()) => {
                            debug!(req_id, upload_id, len, project, "fs:put_begin accepted");
                            let msg = ServerMsg::FsPutBeginOk { req_id, upload_id };
                            send_json(&pty_tx, &msg).await;
                        }
                        Err((code, message)) => {
                            warn!(req_id, code, message, "fs:put_begin rejected");
                            send_fs_error(&pty_tx, req_id, code, message).await;
                        }
                    }
                }
            }
            ClientMsg::FsPutChunk { upload_id, seq } => {
                // Set pending_binary — next binary frame is this chunk
                pending_binary = Some(PendingBinary::EncPut { upload_id, seq });
            }
            ClientMsg::FsPutCommit { req_id, upload_id } => {
                let enc_state = match enc_uploads.remove(&upload_id) {
                    Some(s) => s,
                    None => {
                        let msg = ServerMsg::FsPutResult {
                            req_id,
                            upload_id,
                            ok: false,
                            conflict: false,
                            new_mtime: None,
                            error: Some("upload session not found — fs:put_begin first".into()),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let session_id = enc_state.inner.session_id.clone();
                let aes_key = match aes_keys.get(&session_id) {
                    Some(k) => k.clone(),
                    None => {
                        let msg = ServerMsg::FsPutResult {
                            req_id,
                            upload_id,
                            ok: false,
                            conflict: false,
                            new_mtime: None,
                            error: Some("OPAQUE session not found — login may have expired".into()),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let target_abs = enc_state.inner.inner.target_abs.clone();
                let expected_mtime = enc_state.inner.expected_mtime;
                let target_root = enc_state.target.resolved.target_path().to_path_buf();
                let target_root_identity = enc_state.target.root_identity;
                let relative_path = enc_state.relative_path.clone();
                let uid = upload_id.clone();

                // Validate byte count matches what was declared at begin
                let bytes_written = enc_state.inner.inner.bytes_written;
                let expected_len = enc_state.inner.inner.expected_len;
                if bytes_written != expected_len {
                    let msg = ServerMsg::FsPutResult {
                        req_id,
                        upload_id: uid,
                        ok: false,
                        conflict: false,
                        new_mtime: None,
                        error: Some(format!(
                            "size mismatch: wrote {bytes_written} bytes but declared {expected_len}"
                        )),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                if let Err(error) = revalidate_bound_path(
                    &state,
                    &enc_state.target,
                    &enc_state.relative_path,
                    &target_abs,
                    true,
                )
                .await
                {
                    let msg = ServerMsg::FsPutResult {
                        req_id,
                        upload_id: uid,
                        ok: false,
                        conflict: false,
                        new_mtime: None,
                        error: Some(error.to_string()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                // H2: move NamedTempFile into closure so it stays alive until the read completes
                let temp_file = enc_state.inner.inner.temp;
                // H1: return (error_msg, is_conflict) from spawn_blocking for accurate client signaling
                let result = tokio::task::spawn_blocking(move || -> Result<i64, (String, bool)> {
                    // Read from temp file — NamedTempFile kept alive in this closure (H2)
                    let temp_path = temp_file.path().to_path_buf();
                    let encrypted_bytes = std::fs::read(&temp_path)
                        .map_err(|e| (format!("read encrypted temp failed: {e}"), false))?;
                    drop(temp_file); // explicit: delete temp before decrypt (memory + hygiene)

                    // FIX-05: decrypt first, then drop encrypted blob before writing (~2x peak vs ~3x)
                    use crate::fs::decrypt::decrypt_blob;
                    let dec = decrypt_blob(&encrypted_bytes, &aes_key)
                        .map_err(|e| (e.to_string(), false))?;
                    drop(encrypted_bytes);

                    crate::fs::secure_path::write_bytes(
                        &target_root,
                        &relative_path,
                        &dec.content,
                        expected_mtime,
                        Some(target_root_identity),
                        false,
                    )
                    .map_err(|error| {
                        (
                            error.to_string(),
                            matches!(error, crate::fs::FsError::Conflict),
                        )
                    })
                })
                .await;

                let msg = match result {
                    Ok(Ok(new_mtime)) => {
                        debug!(req_id, new_mtime, upload_id, "fs:put_commit decrypt ok");
                        ServerMsg::FsPutResult {
                            req_id,
                            upload_id: uid,
                            ok: true,
                            conflict: false,
                            new_mtime: Some(new_mtime),
                            error: None,
                        }
                    }
                    Ok(Err((e, is_conflict))) => {
                        if is_conflict {
                            warn!(req_id, error = %e, "fs:put_commit conflict");
                        } else {
                            warn!(req_id, error = %e, "fs:put_commit decrypt failed");
                        }
                        ServerMsg::FsPutResult {
                            req_id,
                            upload_id: uid,
                            ok: false,
                            conflict: is_conflict,
                            new_mtime: None,
                            error: Some(e),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "fs:put_commit spawn_blocking error");
                        ServerMsg::FsPutResult {
                            req_id,
                            upload_id: uid,
                            ok: false,
                            conflict: false,
                            new_mtime: None,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }
            ClientMsg::FsPutSave {
                req_id,
                session_id,
                project,
                worktree_path,
                path,
            } => {
                // Validate session and resolve path first; binary frame will do the decrypt+write
                if !aes_keys.contains_key(&session_id) {
                    send_fs_error(
                        &pty_tx,
                        req_id,
                        "OPAQUE_LOGIN_REQUIRED".into(),
                        "fs:put_save requires OPAQUE login".into(),
                    )
                    .await;
                } else {
                    match resolve_target_path(&project, worktree_path.as_deref(), &path, &state)
                        .await
                    {
                        Ok((target, path_abs)) => {
                            let relative_path = match path_abs.strip_prefix(target.target_path()) {
                                Ok(relative) => relative.to_path_buf(),
                                Err(_) => {
                                    send_fs_error(
                                        &pty_tx,
                                        req_id,
                                        "PATH_REJECTED".into(),
                                        "resolved path is outside the selected target".into(),
                                    )
                                    .await;
                                    continue;
                                }
                            };
                            let target = match bind_resolved_target(target).await {
                                Ok(target) => target,
                                Err(error) => {
                                    send_fs_error(
                                        &pty_tx,
                                        req_id,
                                        "PATH_REJECTED".into(),
                                        error.to_string(),
                                    )
                                    .await;
                                    continue;
                                }
                            };
                            pending_binary = Some(PendingBinary::EncPutSave {
                                req_id,
                                session_id,
                                target,
                                relative_path,
                                path_abs,
                            });
                        }
                        Err((code, message)) => {
                            warn!(req_id, code, message, "fs:put_save path rejected");
                            send_fs_error(&pty_tx, req_id, code, message).await;
                        }
                    }
                }
            }
        }
    }

    // Cleanup
    for (sub_id, handle) in fs_pumps {
        handle.abort();
        state.fs.unsubscribe_tree(sub_id);
    }
    pty_pump.abort();
    host_alert_pump.abort();
    writer.abort();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn send_fs_error(out_tx: &mpsc::Sender<WireMsg>, req_id: u64, code: String, message: String) {
    let err_msg = ServerMsg::FsError {
        req_id,
        code,
        message,
    };
    if let Ok(json) = serde_json::to_string(&err_msg) {
        let _ = out_tx.send(WireMsg::Text(json)).await;
    }
}

async fn send_json(tx: &mpsc::Sender<WireMsg>, msg: &ServerMsg) {
    if let Ok(json) = serde_json::to_string(msg) {
        let _ = tx.send(WireMsg::Text(json)).await;
    }
}

/// Resolve project + relative path → validated absolute path.
async fn resolve_abs_path(
    project: &str,
    worktree_path: Option<&str>,
    path: &str,
    state: &AppState,
) -> Result<std::path::PathBuf, (String, String)> {
    resolve_target_path(project, worktree_path, path, state)
        .await
        .map(|(_, canonical)| canonical)
}

async fn resolve_target_path(
    project: &str,
    worktree_path: Option<&str>,
    path: &str,
    state: &AppState,
) -> Result<(ResolvedProjectTarget, std::path::PathBuf), (String, String)> {
    let rel = if path.is_empty() || path == "/" {
        "."
    } else {
        path.trim_start_matches('/')
    };
    let target_ref = ProjectTargetRef {
        project: project.to_owned(),
        worktree_path: worktree_path.map(str::to_owned),
    };
    super::fs::resolve(state, &target_ref, rel)
        .await
        .map(|resolved| (resolved.target, resolved.canonical))
        .map_err(map_fs_resolution_error)
}

async fn bind_resolved_target(
    target: ResolvedProjectTarget,
) -> Result<TargetBinding, crate::fs::FsError> {
    let target_path = target.target_path().to_path_buf();
    let root_identity =
        tokio::task::spawn_blocking(move || secure_path::directory_identity(&target_path))
            .await
            .map_err(|error| crate::fs::FsError::Io(std::io::Error::other(error.to_string())))??;
    Ok(TargetBinding {
        resolved: target,
        root_identity,
    })
}

async fn revalidate_target_binding(
    state: &AppState,
    binding: &TargetBinding,
) -> Result<ResolvedProjectTarget, crate::fs::FsError> {
    let expected = &binding.resolved;
    let target_ref = ProjectTargetRef {
        project: expected.project().to_owned(),
        worktree_path: (!expected.is_root())
            .then(|| expected.target_path().to_string_lossy().into_owned()),
    };
    let current = state
        .resolve_project_target(&target_ref)
        .await
        .map_err(|error| crate::fs::FsError::MutationRefused(error.to_string()))?;
    if current.project() != expected.project()
        || current.configured_root() != expected.configured_root()
        || current.target_path() != expected.target_path()
        || current.target_key() != expected.target_key()
        || current.is_root() != expected.is_root()
    {
        return Err(crate::fs::FsError::MutationRefused(
            "filesystem target changed while operation was in flight".into(),
        ));
    }

    let target_path = current.target_path().to_path_buf();
    let root_identity =
        tokio::task::spawn_blocking(move || secure_path::directory_identity(&target_path))
            .await
            .map_err(|error| crate::fs::FsError::Io(std::io::Error::other(error.to_string())))??;
    if root_identity != binding.root_identity {
        return Err(crate::fs::FsError::MutationRefused(
            "filesystem target was replaced while operation was in flight".into(),
        ));
    }
    Ok(current)
}

async fn revalidate_bound_path(
    state: &AppState,
    binding: &TargetBinding,
    relative_path: &std::path::Path,
    expected_abs: &std::path::Path,
    allow_missing_final: bool,
) -> Result<std::path::PathBuf, crate::fs::FsError> {
    let current = revalidate_target_binding(state, binding).await?;
    let sandbox = state.fs.sandbox()?;
    let proposed = current.target_path().join(relative_path);
    let validated = if allow_missing_final {
        let parent = proposed.parent().ok_or_else(|| {
            crate::fs::FsError::MutationRefused("target path has no parent".into())
        })?;
        let name = proposed
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                crate::fs::FsError::MutationRefused("target filename is invalid".into())
            })?;
        sandbox
            .validate_new_target_path(&current, parent.to_path_buf(), name)
            .await?
    } else {
        sandbox.validate_target(&current, proposed).await?
    };
    if validated != expected_abs {
        return Err(crate::fs::FsError::MutationRefused(
            "filesystem path changed while operation was in flight".into(),
        ));
    }
    Ok(validated)
}

fn map_fs_resolution_error(error: crate::error::AppError) -> (String, String) {
    let code = match &error {
        crate::error::AppError::Fs(crate::fs::FsError::NotFound) => "PATH_REJECTED",
        _ => error.api_code().unwrap_or(match error.status_code() {
            404 => "PROJECT_NOT_FOUND",
            503 => "FS_UNAVAILABLE",
            _ => "PATH_REJECTED",
        }),
    };
    (code.to_owned(), error.to_string())
}

/// Handle `fs:read` — stat + binary detect + ranged/full read → base64 response.
async fn do_fs_read(
    req_id: u64,
    project: &str,
    worktree_path: Option<&str>,
    path: &str,
    offset: Option<u64>,
    len: Option<u64>,
    state: &AppState,
) -> ServerMsg {
    let abs = match resolve_abs_path(project, worktree_path, path, state).await {
        Ok(p) => p,
        Err((code, _message)) => {
            return ServerMsg::FsReadResult {
                req_id,
                ok: false,
                mime: None,
                binary: false,
                mtime: None,
                size: None,
                data: None,
                code: Some(code),
            };
        }
    };

    // Detect binary + mime (cheap: reads first 8KB)
    let (is_binary, mime) = match ops::detect_binary(&abs).await {
        Ok(v) => v,
        Err(e) => {
            return ServerMsg::FsReadResult {
                req_id,
                ok: false,
                mime: None,
                binary: false,
                mtime: None,
                size: None,
                data: None,
                code: Some(format!("IO_ERROR: {e}")),
            };
        }
    };

    // Stat for mtime + size
    let meta = match tokio::fs::metadata(&abs).await {
        Ok(m) => m,
        Err(e) => {
            return ServerMsg::FsReadResult {
                req_id,
                ok: false,
                mime: None,
                binary: false,
                mtime: None,
                size: None,
                data: None,
                code: Some(format!("IO_ERROR: {e}")),
            };
        }
    };
    let file_size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Determine range
    let range = match (offset, len) {
        (Some(o), Some(l)) => Some((o, l)),
        (Some(o), None) => Some((o, file_size.saturating_sub(o))),
        _ => None,
    };

    // Without a range, enforce 5MB cap (range reads are uncapped — LargeFileViewer owns that)
    let max = if range.is_some() {
        u64::MAX
    } else {
        FS_WS_READ_MAX
    };

    let bytes = match ops::read_file(&abs, range, max).await {
        Ok(b) => b,
        Err(crate::fs::FsError::TooLarge(_)) => {
            return ServerMsg::FsReadResult {
                req_id,
                ok: false,
                mime,
                binary: is_binary,
                mtime: Some(mtime),
                size: Some(file_size),
                data: None,
                code: Some("TOO_LARGE".into()),
            };
        }
        Err(e) => {
            return ServerMsg::FsReadResult {
                req_id,
                ok: false,
                mime,
                binary: is_binary,
                mtime: None,
                size: None,
                data: None,
                code: Some(e.to_string()),
            };
        }
    };

    let encoded = BASE64.encode(&bytes);

    ServerMsg::FsReadResult {
        req_id,
        ok: true,
        mime,
        binary: is_binary,
        mtime: Some(mtime),
        size: Some(file_size),
        data: Some(encoded),
        code: None,
    }
}

// ---------------------------------------------------------------------------
// FS mutating op helper
// ---------------------------------------------------------------------------

async fn do_fs_op(
    _req_id: u64,
    op: &str,
    project: &str,
    worktree_path: Option<&str>,
    path: &str,
    new_path: Option<&str>,
    force_git: bool,
    state: &AppState,
) -> Result<(), crate::fs::FsError> {
    let target = state
        .resolve_project_target(&ProjectTargetRef {
            project: project.to_owned(),
            worktree_path: worktree_path.map(str::to_owned),
        })
        .await
        .map_err(|e| crate::fs::FsError::MutationRefused(e.to_string()))?;

    let sandbox = state.fs.sandbox()?;
    let target_root = target.target_path().to_path_buf();

    match op {
        "create_file" | "create_dir" => {
            // Target doesn't exist yet — validate via parent + filename split.
            let rel = trim_leading_slash(path);
            let proposed = target_root.join(rel);
            let parent = proposed
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or(target_root.clone());
            let name = proposed.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // Validate parent exists and is within sandbox, then construct new abs path.
            let new_abs = sandbox
                .validate_new_target_path(&target, parent, name)
                .await?;
            if op == "create_file" {
                mutate::create_file(&new_abs, &target_root).await
            } else {
                mutate::create_dir(&new_abs, &target_root).await
            }
        }
        "delete" => {
            let rel = trim_leading_slash(path);
            // Empty/root path: validate will succeed on project root.
            // assert_safe_mutation will then reject it.
            let abs = if rel == "." {
                target_root.clone()
            } else {
                sandbox
                    .validate_target(&target, target_root.join(rel))
                    .await?
            };
            mutate::delete(&abs, &target_root, force_git).await
        }
        "rename" | "move" => {
            let rel = trim_leading_slash(path);
            let abs = sandbox
                .validate_target(&target, target_root.join(rel))
                .await?;

            let dst_rel = new_path.ok_or_else(|| {
                crate::fs::FsError::MutationRefused("rename/move requires new_path".into())
            })?;
            let dst_rel = trim_leading_slash(dst_rel);
            let dst_proposed = target_root.join(dst_rel);
            let dst_parent = dst_proposed
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or(target_root.clone());
            let dst_name = dst_proposed
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let dst_abs = sandbox
                .validate_new_target_path(&target, dst_parent, dst_name)
                .await?;

            if op == "rename" {
                mutate::rename(&abs, &dst_abs, &target_root).await
            } else {
                mutate::move_path(&abs, &dst_abs, &target_root).await
            }
        }
        _ => Err(crate::fs::FsError::MutationRefused(format!(
            "unknown op: {op}"
        ))),
    }
}

fn trim_leading_slash(s: &str) -> &str {
    if s.is_empty() || s == "/" {
        "."
    } else {
        s.trim_start_matches('/')
    }
}

// ---------------------------------------------------------------------------
// Upload begin helper
// ---------------------------------------------------------------------------

async fn do_upload_begin(
    _req_id: u64,
    upload_id: &str,
    project: &str,
    worktree_path: Option<&str>,
    dir: &str,
    filename: &str,
    len: u64,
    state: &AppState,
    uploads: &mut HashMap<String, UploadInFlight>,
) -> Result<(), crate::fs::FsError> {
    if len > MAX_UPLOAD_BYTES {
        return Err(crate::fs::FsError::TooLarge(len));
    }

    let target = state
        .resolve_project_target(&ProjectTargetRef {
            project: project.to_owned(),
            worktree_path: worktree_path.map(str::to_owned),
        })
        .await
        .map_err(|e| crate::fs::FsError::MutationRefused(e.to_string()))?;

    let sandbox = state.fs.sandbox()?;

    let dir_rel = trim_leading_slash(dir);
    let dir_abs = sandbox
        .validate_target(&target, target.target_path().join(dir_rel))
        .await?;

    // validate_new_path checks filename for path separators / ".." / empty
    let target_abs = sandbox
        .validate_new_target_path(&target, dir_abs, filename)
        .await?;

    let relative_path = target_abs
        .strip_prefix(target.target_path())
        .map_err(|_| crate::fs::FsError::PathEscape)?
        .to_path_buf();
    let target = bind_resolved_target(target).await?;
    let upload_state = UploadInFlight {
        target,
        relative_path,
        inner: UploadState::new(target_abs, len)?,
    };
    uploads.insert(upload_id.to_string(), upload_state);

    debug!(upload_id, len, project, "fs:upload_begin accepted");
    Ok(())
}

// ---------------------------------------------------------------------------
// Upload binary frame handler
// ---------------------------------------------------------------------------

async fn handle_upload_binary(
    upload_id: &str,
    seq: u64,
    data: &[u8],
    uploads: &mut HashMap<String, UploadInFlight>,
    pty_tx: &mpsc::Sender<WireMsg>,
) {
    let state = match uploads.get_mut(upload_id) {
        Some(s) => s,
        None => {
            warn!(
                upload_id,
                seq, "binary frame: upload session not found — dropping"
            );
            return;
        }
    };

    match state.inner.append_chunk(data) {
        Ok(()) => {
            let ack = ServerMsg::FsUploadChunkAck {
                upload_id: upload_id.to_string(),
                seq,
            };
            if let Ok(json) = serde_json::to_string(&ack) {
                let _ = pty_tx.send(WireMsg::Text(json)).await;
            }
        }
        Err(e) => {
            warn!(upload_id, seq, error = %e, "upload chunk rejected — aborting upload");
            uploads.remove(upload_id);
        }
    }
}

// ---------------------------------------------------------------------------
// Write binary frame handler
// ---------------------------------------------------------------------------

async fn handle_write_binary(
    write_id: u64,
    seq: u32,
    data: &[u8],
    writes: &mut HashMap<u64, WriteInFlight>,
    pty_tx: &mpsc::Sender<WireMsg>,
) {
    let entry = match writes.get_mut(&write_id) {
        Some(e) => e,
        None => {
            warn!(
                write_id,
                seq, "binary frame: write session not found — dropping"
            );
            return;
        }
    };

    // Note: seq check already done in FsWriteChunkBinary handler to set pending_binary
    let accumulated = entry.bytes_written + data.len() as u64;
    if accumulated > entry.declared_size {
        warn!(
            write_id,
            accumulated,
            declared = entry.declared_size,
            "binary write_chunk exceeds declared size — aborting write"
        );
        writes.remove(&write_id);
        return;
    }

    if let Err(e) = entry.temp.write_all(data) {
        warn!(write_id, error = %e, "binary write_chunk: tempfile write failed — aborting write");
        writes.remove(&write_id);
        return;
    }

    entry.bytes_written = accumulated;
    entry.next_seq += 1;

    let ack = ServerMsg::FsWriteChunkAck { write_id, seq };
    if let Ok(json) = serde_json::to_string(&ack) {
        let _ = pty_tx.send(WireMsg::Text(json)).await;
    }
}

// ---------------------------------------------------------------------------
// Encrypted put binary frame handler (fs:put_chunk)
// ---------------------------------------------------------------------------

async fn handle_enc_put_binary(
    upload_id: &str,
    seq: u64,
    data: &[u8],
    enc_uploads: &mut HashMap<String, EncUploadInFlight>,
    pty_tx: &mpsc::Sender<WireMsg>,
) {
    // FIX-02: validate seq before appending; borrow dropped before potential remove
    let expected_seq = match enc_uploads.get(upload_id) {
        Some(s) => s.inner.inner.next_seq,
        None => {
            warn!(
                upload_id,
                seq, "enc put binary: upload session not found — dropping"
            );
            return;
        }
    };

    if seq != expected_seq {
        warn!(
            upload_id,
            seq,
            expected = expected_seq,
            "enc put chunk: seq out of order — aborting upload"
        );
        enc_uploads.remove(upload_id);
        return;
    }

    // Invariant: entry was present at seq check above; this branch is unreachable in practice
    let state = match enc_uploads.get_mut(upload_id) {
        Some(s) => s,
        None => return,
    };

    match state.inner.inner.append_chunk(data) {
        Ok(()) => {
            let ack = ServerMsg::FsPutChunkAck {
                upload_id: upload_id.to_string(),
                seq,
            };
            if let Ok(json) = serde_json::to_string(&ack) {
                let _ = pty_tx.send(WireMsg::Text(json)).await;
            }
        }
        Err(e) => {
            warn!(upload_id, seq, error = %e, "enc put chunk rejected — aborting upload");
            enc_uploads.remove(upload_id);
        }
    }
}

// ---------------------------------------------------------------------------
// Encrypted text save binary frame handler (fs:put_save)
// ---------------------------------------------------------------------------

async fn handle_enc_put_save_binary(
    req_id: u64,
    session_id: &str,
    target: &TargetBinding,
    relative_path: &std::path::Path,
    path_abs: &std::path::Path,
    data: &[u8],
    state: &AppState,
    aes_keys: &HashMap<String, Zeroizing<Vec<u8>>>,
    pty_tx: &mpsc::Sender<WireMsg>,
) {
    let aes_key = match aes_keys.get(session_id) {
        Some(k) => k.clone(),
        None => {
            warn!(req_id, session_id, "enc put_save: no aes_key for session");
            let msg = ServerMsg::FsPutSaveResult {
                req_id,
                ok: false,
                new_mtime: None,
                error: Some("OPAQUE session not found — login may have expired".into()),
            };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = pty_tx.send(WireMsg::Text(json)).await;
            }
            return;
        }
    };

    match revalidate_bound_path(state, target, relative_path, path_abs, false).await {
        Ok(_) => {}
        Err(error) => {
            warn!(req_id, error = %error, "enc put_save target changed");
            let msg = ServerMsg::FsPutSaveResult {
                req_id,
                ok: false,
                new_mtime: None,
                error: Some(error.to_string()),
            };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = pty_tx.send(WireMsg::Text(json)).await;
            }
            return;
        }
    }

    let encrypted_bytes = data.to_vec();
    let target_root = target.resolved.target_path().to_path_buf();
    let target_root_identity = target.root_identity;
    let relative_path = relative_path.to_path_buf();

    let result = tokio::task::spawn_blocking(move || -> Result<i64, String> {
        use crate::fs::decrypt::decrypt_blob;
        let dec = decrypt_blob(&encrypted_bytes, &aes_key).map_err(|e| e.to_string())?;
        crate::fs::secure_path::write_bytes(
            &target_root,
            &relative_path,
            &dec.content,
            None,
            Some(target_root_identity),
            false,
        )
        .map_err(|e| e.to_string())
    })
    .await;

    let msg = match result {
        Ok(Ok(new_mtime)) => {
            debug!(req_id, new_mtime, "fs:put_save decrypt ok");
            ServerMsg::FsPutSaveResult {
                req_id,
                ok: true,
                new_mtime: Some(new_mtime),
                error: None,
            }
        }
        Ok(Err(e)) => {
            warn!(req_id, error = %e, "fs:put_save decrypt failed");
            ServerMsg::FsPutSaveResult {
                req_id,
                ok: false,
                new_mtime: None,
                error: Some(format!("decrypt failed: {e}")),
            }
        }
        Err(e) => {
            warn!(req_id, error = %e, "fs:put_save spawn_blocking error");
            ServerMsg::FsPutSaveResult {
                req_id,
                ok: false,
                new_mtime: None,
                error: Some(format!("internal error: {e}")),
            }
        }
    };
    if let Ok(json) = serde_json::to_string(&msg) {
        let _ = pty_tx.send(WireMsg::Text(json)).await;
    }
}

// ---------------------------------------------------------------------------
// Encrypted upload begin helper (fs:put_begin)
// ---------------------------------------------------------------------------

async fn do_enc_put_begin(
    _req_id: u64,
    upload_id: &str,
    session_id: &str,
    project: &str,
    worktree_path: Option<&str>,
    dir: &str,
    filename: &str,
    len: u64,
    expected_mtime: Option<i64>,
    state: &AppState,
    enc_uploads: &mut HashMap<String, EncUploadInFlight>,
) -> Result<(), (String, String)> {
    // FIX-04: cap concurrent encrypted uploads per connection
    if enc_uploads.len() >= 8 {
        return Err((
            "LIMIT_EXCEEDED".into(),
            "too many concurrent encrypted uploads on this connection (max 8)".into(),
        ));
    }

    if len > MAX_UPLOAD_BYTES {
        return Err((
            "TOO_LARGE".into(),
            format!(
                "encrypted upload too large: {len} bytes (max {})",
                MAX_UPLOAD_BYTES,
            ),
        ));
    }

    if enc_uploads.contains_key(upload_id) {
        return Err((
            "DUPLICATE_UPLOAD_ID".into(),
            format!("upload_id already active: {upload_id}"),
        ));
    }

    let target = state
        .resolve_project_target(&ProjectTargetRef {
            project: project.to_owned(),
            worktree_path: worktree_path.map(str::to_owned),
        })
        .await
        .map_err(map_fs_resolution_error)?;
    let sandbox = state
        .fs
        .sandbox()
        .map_err(|e| ("FS_UNAVAILABLE".into(), e.to_string()))?;
    let target_root = target.target_path().to_path_buf();

    let dir_abs = target_root.join(dir.trim_start_matches('/'));

    // FIX-01: fast-path lexical traversal check before any filesystem I/O
    if dir_abs
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(("FORBIDDEN".into(), "path traversal in dir field".into()));
    }

    // FIX-01 + FIX-M2: validate nearest existing ancestor BEFORE creating dirs.
    // This prevents create_dir_all from following a pre-existing symlink that escapes the sandbox.
    {
        let mut check = dir_abs.clone();
        loop {
            match sandbox.validate_target(&target, check.clone()).await {
                Ok(_) => break, // found an existing ancestor within sandbox
                Err(crate::fs::FsError::NotFound) => {
                    check = check.parent().map(|p| p.to_path_buf()).ok_or_else(|| {
                        (
                            "INVALID_PATH".into(),
                            "dir has no valid parent within workspace".into(),
                        )
                    })?;
                }
                Err(e) => {
                    return Err(match e {
                        crate::fs::FsError::PathEscape | crate::fs::FsError::PermissionDenied => {
                            ("FORBIDDEN".into(), "dir resolves outside workspace".into())
                        }
                        _ => ("INVALID_PATH".into(), e.to_string()),
                    })
                }
            }
        }
    }

    // FIX-08: auto-create target directory (ancestor validated safe above)
    tokio::fs::create_dir_all(&dir_abs).await.map_err(|e| {
        (
            "UPLOAD_INIT_FAILED".into(),
            format!("failed to create target directory: {e}"),
        )
    })?;

    // FIX-01: final canonicalize + sandbox check on now-existing dir
    let dir_validated = sandbox
        .validate_target(&target, dir_abs)
        .await
        .map_err(|e| match e {
            crate::fs::FsError::PathEscape | crate::fs::FsError::PermissionDenied => {
                ("FORBIDDEN".into(), "dir resolves outside workspace".into())
            }
            _ => ("INVALID_PATH".into(), e.to_string()),
        })?;

    let target_abs = sandbox
        .validate_new_target_path(&target, dir_validated, filename)
        .await
        .map_err(|e| ("INVALID_PATH".into(), e.to_string()))?;

    let relative_path = target_abs
        .strip_prefix(target.target_path())
        .map_err(|_| {
            (
                "FORBIDDEN".into(),
                "target escaped selected worktree".into(),
            )
        })?
        .to_path_buf();
    let target = bind_resolved_target(target)
        .await
        .map_err(|error| ("UPLOAD_INIT_FAILED".into(), error.to_string()))?;
    let enc_state = EncUploadInFlight {
        target,
        relative_path,
        inner: EncUploadState::new(target_abs, len, session_id.to_string(), expected_mtime)
            .map_err(|e| ("UPLOAD_INIT_FAILED".into(), e.to_string()))?,
    };

    enc_uploads.insert(upload_id.to_string(), enc_state);
    Ok(())
}

// ---------------------------------------------------------------------------
// PTY broadcast pump
// ---------------------------------------------------------------------------

async fn pump_pty(
    mut rx: tokio::sync::broadcast::Receiver<String>,
    pty_tx: mpsc::Sender<WireMsg>,
    order: Arc<tokio::sync::Mutex<()>>,
) {
    loop {
        match rx.recv().await {
            Ok(msg) => {
                let _order = order.lock().await;
                if pty_tx.send(WireMsg::Text(msg)).await.is_err() {
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

async fn pump_host_alerts(
    mut rx: tokio::sync::broadcast::Receiver<String>,
    alert_tx: mpsc::Sender<WireMsg>,
) {
    loop {
        match rx.recv().await {
            Ok(msg) => {
                if alert_tx.send(WireMsg::Text(msg)).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!(
                    dropped = n,
                    "host alert broadcast lagged; invalidating alerts"
                );
                if alert_tx
                    .send(WireMsg::Text(
                        serde_json::json!({
                            "kind": "host:alertsInvalidated",
                            "payload": { "reason": "lagged" },
                        })
                        .to_string(),
                    ))
                    .await
                    .is_err()
                {
                    break;
                }
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
    worktree_path: Option<&str>,
    path: &str,
    state: &AppState,
    pty_tx: mpsc::Sender<WireMsg>,
    fs_tx: mpsc::Sender<WireMsg>,
    fs_pumps: &mut HashMap<u64, tokio::task::JoinHandle<()>>,
) -> Result<(), (String, String)> {
    let (target, abs_path) = resolve_target_path(project, worktree_path, path, state).await?;

    let (sub_id, fs_rx) = state
        .fs
        .subscribe_target_tree(&target, abs_path.clone())
        .map_err(|e| match e {
            crate::fs::FsError::NotFound => (
                "PROJECT_NOT_FOUND".to_string(),
                format!("Project not found: {project}"),
            ),
            crate::fs::FsError::PathEscape => ("PATH_REJECTED".to_string(), e.to_string()),
            _ => ("WATCHER_ERROR".to_string(), e.to_string()),
        })?;

    debug!(sub_id, project, target_key = %target.target_key(), path, "fs:subscribe_tree");

    let mut registration = FsSubscriptionGuard::new(state.fs.clone(), sub_id);
    let snap_path = abs_path.clone();
    let nodes = tokio::task::spawn_blocking(move || tree_snapshot_sync(&snap_path))
        .await
        .map_err(|e| ("INTERNAL".to_string(), e.to_string()))?
        .map_err(|e| ("SNAPSHOT_ERROR".to_string(), e.to_string()))?;

    let snap = ServerMsg::TreeSnapshot {
        req_id,
        sub_id,
        nodes,
    };
    let json =
        serde_json::to_string(&snap).map_err(|e| ("SERIALIZE".to_string(), e.to_string()))?;
    pty_tx
        .send(WireMsg::Text(json))
        .await
        .map_err(|_| ("CONN_CLOSED".to_string(), "connection closed".to_string()))?;

    let filter_prefix = abs_path.clone();
    let fs = state.fs.clone();
    registration.disarm();
    let handle = tokio::spawn(async move {
        pump_fs_events(sub_id, fs_rx, filter_prefix, fs_tx, pty_tx, fs).await;
    });

    fs_pumps.insert(sub_id, handle);
    Ok(())
}

// ---------------------------------------------------------------------------
// FS event pump
// ---------------------------------------------------------------------------

async fn pump_fs_events(
    sub_id: u64,
    mut rx: tokio::sync::broadcast::Receiver<crate::fs::FsEvent>,
    filter_prefix: std::path::PathBuf,
    fs_tx: mpsc::Sender<WireMsg>,
    pty_tx: mpsc::Sender<WireMsg>,
    fs: crate::fs::FsSubsystem,
) {
    loop {
        match rx.recv().await {
            Ok(ev) => {
                let path_in = ev.path.starts_with(&filter_prefix);
                let from_in = ev
                    .from
                    .as_ref()
                    .map(|p| p.starts_with(&filter_prefix))
                    .unwrap_or(false);
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

                match fs_tx.try_send(WireMsg::Text(json)) {
                    Ok(_) => {}
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        warn!(
                            sub_id,
                            cap = FS_CHAN_CAP,
                            "fs pump mpsc full — dropping subscription"
                        );

                        // Send overflow notice via pty channel (proper backpressure)
                        let overflow = ServerMsg::FsOverflow {
                            sub_id,
                            message: format!(
                                "FS event buffer full ({}); subscription dropped",
                                FS_CHAN_CAP
                            ),
                        };
                        if let Ok(json) = serde_json::to_string(&overflow) {
                            let _ = pty_tx.send(WireMsg::Text(json)).await;
                        }
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
    fs.unsubscribe_tree(sub_id);
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tokio::sync::{broadcast, mpsc};

    use super::{
        pump_fs_events, pump_host_alerts, pump_pty, websocket_auth_ok, websocket_origin_allowed,
        FsSubscriptionGuard,
    };
    use crate::api::ws_protocol::WireMsg;
    use crate::fs::{event::FsEventKind, FsEvent, FsSubsystem};

    #[test]
    fn no_auth_mode_allows_websocket_without_a_token() {
        assert!(websocket_auth_ok(true, None, "test-secret"));
    }

    #[test]
    fn authenticated_mode_still_requires_a_valid_token() {
        assert!(!websocket_auth_ok(false, None, "test-secret"));
    }

    #[test]
    fn websocket_origin_policy_rejects_unlisted_browser_origins() {
        assert!(websocket_origin_allowed(false, true, true, false));
        assert!(!websocket_origin_allowed(false, true, false, true));
        assert!(websocket_origin_allowed(false, false, false, true));
        assert!(!websocket_origin_allowed(false, false, false, false));
        assert!(websocket_origin_allowed(true, false, false, false));
    }

    #[tokio::test]
    async fn pty_pump_waits_behind_attach_order_barrier() {
        let (broadcast_tx, broadcast_rx) = broadcast::channel(4);
        let (out_tx, mut out_rx) = mpsc::channel(4);
        let order = Arc::new(tokio::sync::Mutex::new(()));
        let guard = order.lock().await;
        let pump = tokio::spawn(pump_pty(broadcast_rx, out_tx, Arc::clone(&order)));

        broadcast_tx.send("live-output".into()).unwrap();
        tokio::task::yield_now().await;
        assert!(out_rx.try_recv().is_err());

        drop(guard);
        let message = tokio::time::timeout(std::time::Duration::from_secs(1), out_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(message, WireMsg::Text(value) if value == "live-output"));
        pump.abort();
    }

    #[tokio::test]
    async fn host_alert_pump_invalidates_resource_alerts_after_broadcast_lag() {
        let (broadcast_tx, broadcast_rx) = broadcast::channel(1);
        let (out_tx, mut out_rx) = mpsc::channel(4);
        broadcast_tx.send("first".into()).unwrap();
        broadcast_tx.send("second".into()).unwrap();
        let pump = tokio::spawn(pump_host_alerts(broadcast_rx, out_tx));

        let message = tokio::time::timeout(std::time::Duration::from_secs(1), out_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(message, WireMsg::Text(value) if value.contains("host:alertsInvalidated"))
        );
        pump.abort();
    }

    #[test]
    fn subscription_guard_releases_registration_on_setup_failure() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let fs = FsSubsystem::new(vec![("project".into(), root.clone())]);
        let (sub_id, _watcher_rx) = fs.subscribe_tree("project", root.clone()).unwrap();
        assert_eq!(fs.watcher_refcount(&root), 1);

        drop(FsSubscriptionGuard::new(fs.clone(), sub_id));

        assert_eq!(fs.watcher_refcount(&root), 0);
    }

    #[tokio::test]
    async fn fs_event_overflow_releases_subscription() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let fs = FsSubsystem::new(vec![("project".into(), root.clone())]);
        let (sub_id, _watcher_rx) = fs.subscribe_tree("project", root.clone()).unwrap();
        let (event_tx, event_rx) = broadcast::channel(2);
        let (fs_tx, _fs_rx) = mpsc::channel(1);
        fs_tx.send(WireMsg::Text("occupied".into())).await.unwrap();
        let (pty_tx, mut pty_rx) = mpsc::channel(1);
        let pump = tokio::spawn(pump_fs_events(
            sub_id,
            event_rx,
            root.clone(),
            fs_tx,
            pty_tx,
            fs.clone(),
        ));

        event_tx
            .send(FsEvent {
                kind: FsEventKind::Modified,
                path: root.join("changed.txt"),
                from: None,
            })
            .unwrap();

        tokio::time::timeout(std::time::Duration::from_secs(1), pump)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(fs.watcher_refcount(&root), 0);
        assert!(
            matches!(pty_rx.recv().await, Some(WireMsg::Text(message)) if message.contains("fs:overflow"))
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn target_root_identity_detects_same_path_replacement() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target");
        let old_target = tmp.path().join("old-target");
        std::fs::create_dir(&target).unwrap();
        let initial = super::secure_path::directory_identity(&target).unwrap();

        std::fs::rename(&target, &old_target).unwrap();
        std::fs::create_dir(&target).unwrap();
        let replacement = super::secure_path::directory_identity(&target).unwrap();

        assert_ne!(initial, replacement);
    }
}
