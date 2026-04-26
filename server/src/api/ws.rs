use std::collections::HashMap;
use std::io::Write;

use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    response::Response,
};
use axum_extra::extract::CookieJar;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
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
    DamHopperOpaqueSuite, handle_login_finish, handle_login_start, handle_register_finish,
    handle_register_start, validate_identifier,
};
use crate::fs::{
    atomic_persist_with_check, mutate, ops, tree_snapshot_sync, UploadState, MAX_UPLOAD_BYTES,
};
use crate::state::AppState;

/// Bounded per-connection outbound channels (split for PTY + FS).
/// PTY (control + terminal output) uses backpressure via .await.
/// FS (file events) uses try_send; overflow drops the subscription only.
/// Both use 512 cap to handle burst scenarios (large git operations, parallel builds).
const PTY_CHAN_CAP: usize = 512;
const FS_CHAN_CAP: usize = 512;

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

// ---------------------------------------------------------------------------
// WebSocket upgrade handler
// ---------------------------------------------------------------------------

pub async fn ws_handler(
    upgrade: WebSocketUpgrade,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    jar: CookieJar,
    State(state): State<AppState>,
) -> Response {
    let token = params.get("token").cloned()
        .or_else(|| jar.get(AUTH_COOKIE).map(|c| c.value().to_string()));

    let auth_ok = token
        .map(|t| crate::api::auth::validate_jwt(&t, &state.jwt_secret))
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

    // Split channels: PTY (with backpressure) + FS (try_send, overflow drops sub only)
    let (pty_tx, mut pty_rx) = mpsc::channel::<WireMsg>(PTY_CHAN_CAP);
    let (fs_tx, mut fs_rx) = mpsc::channel::<WireMsg>(FS_CHAN_CAP);

    // Writer task: drains both channels → WS sink using select.
    let writer = tokio::spawn(async move {
        loop {
            let msg = tokio::select! {
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

    // PTY broadcast pump (uses pty_tx with .await for proper backpressure)
    let pty_rx_broadcast = state.event_sink.subscribe();
    let pty_out = pty_tx.clone();
    let pty_pump = tokio::spawn(pump_pty(pty_rx_broadcast, pty_out));

    // Per-conn fs subscription pumps: sub_id → JoinHandle
    let mut fs_pumps: HashMap<u64, tokio::task::JoinHandle<()>> = HashMap::new();

    // In-flight write sessions: write_id → WriteInFlight
    let mut writes: HashMap<u64, WriteInFlight> = HashMap::new();
    let mut next_write_id: u64 = 1;

    // In-flight upload sessions: upload_id → UploadState
    let mut uploads: HashMap<String, UploadState> = HashMap::new();

    enum PendingBinary {
        Upload { upload_id: String, seq: u64 },
        Write { write_id: u64, seq: u32 },
        /// Phase 04: encrypted binary upload chunk (fs:put_chunk)
        EncPut { upload_id: String, seq: u64 },
        /// Phase 04/06: encrypted text save blob (fs:put_save)
        EncPutSave { req_id: u64, session_id: String },
    }
    // Pending binary frame correlation: set by fs:upload_chunk or fs:write_chunk_binary
    let mut pending_binary: Option<PendingBinary> = None;

    // Per-connection OPAQUE login state (intermediate, consumed at login_finish)
    let mut opaque_login_states: HashMap<String, ServerLogin<DamHopperOpaqueSuite>> =
        HashMap::new();
    // Per-connection AES keys derived from OPAQUE login (keyed by session_id)
    let mut export_keys: HashMap<String, Zeroizing<Vec<u8>>> = HashMap::new();

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
                    handle_upload_binary(&upload_id, seq, bytes.as_ref(), &mut uploads, &pty_tx).await;
                }
                Some(PendingBinary::Write { write_id, seq }) => {
                    handle_write_binary(write_id, seq, bytes.as_ref(), &mut writes, &pty_tx).await;
                }
                Some(PendingBinary::EncPut { upload_id, seq }) => {
                    // Phase 04: encrypted binary upload chunk
                    warn!(upload_id, seq, "fs:put_chunk binary (Phase 04 not yet implemented) — dropping");
                }
                Some(PendingBinary::EncPutSave { req_id, .. }) => {
                    // Phase 04/06: encrypted text save blob
                    warn!(req_id, "fs:put_save binary (Phase 04/06 not yet implemented) — dropping");
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
            ClientMsg::TermAttach { id, from_offset } => {
                match state.pty_manager.get_buffer_with_offset(&id, from_offset) {
                    Ok((data, offset)) => {
                        let msg = ServerMsg::TermBuffer {
                            id: id.clone(),
                            data,
                            offset,
                        };
                        if let Ok(json) = serde_json::to_string(&msg) {
                            if let Err(e) = pty_tx.send(WireMsg::Text(json)).await {
                                warn!(id = %id, error = %e, "Failed to send terminal:buffer");
                            }
                        }
                    }
                    Err(e) => {
                        warn!(id = %id, error = %e, "terminal:attach failed");
                        // No response — client should detect via timeout and create new session
                    }
                }
            }

            // -----------------------------------------------------------
            // FS — subscribe / unsubscribe
            // -----------------------------------------------------------
            ClientMsg::FsSubTree { req_id, project, path } => {
                let result = do_fs_subscribe(
                    req_id,
                    &project,
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
            ClientMsg::FsRead { req_id, project, path, offset, len } => {
                let result = do_fs_read(req_id, &project, &path, offset, len, &state).await;
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
            ClientMsg::FsWriteBegin { req_id, project, path, expected_mtime, size, encoding: _ } => {
                if size > FS_WRITE_MAX {
                    send_fs_error(&pty_tx, req_id, "TOO_LARGE".into(),
                        format!("write size {} exceeds {FS_WRITE_MAX} byte cap", size)).await;
                    continue;
                }

                let abs_result = resolve_abs_path(&project, &path, &state).await;
                match abs_result {
                    Err((code, msg)) => send_fs_error(&pty_tx, req_id, code, msg).await,
                    Ok(abs_path) => {
                        let parent = abs_path.parent().unwrap_or(&abs_path);
                        let temp = match tempfile::NamedTempFile::new_in(parent) {
                            Ok(t) => t,
                            Err(e) => {
                                warn!(req_id, error = %e, "fs:write_begin: tempfile creation failed");
                                send_fs_error(&pty_tx, req_id, "IO_ERROR".into(), e.to_string()).await;
                                continue;
                            }
                        };

                        let write_id = next_write_id;
                        next_write_id += 1;
                        writes.insert(write_id, WriteInFlight {
                            abs_path,
                            expected_mtime,
                            declared_size: size,
                            temp,
                            bytes_written: 0,
                            next_seq: 0,
                        });
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
            ClientMsg::FsWriteChunk { write_id, seq, eof, data } => {
                let entry = match writes.get_mut(&write_id) {
                    Some(e) => e,
                    None => {
                        warn!(write_id, "fs:write_chunk for unknown write_id — dropping");
                        continue;
                    }
                };

                if seq != entry.next_seq {
                    warn!(write_id, seq, expected = entry.next_seq, "out-of-order chunk — aborting write");
                    writes.remove(&write_id);
                    continue;
                }

                match BASE64.decode(&data) {
                    Ok(bytes) => {
                        let accumulated = entry.bytes_written + bytes.len() as u64;
                        if accumulated > entry.declared_size {
                            warn!(write_id, accumulated, declared = entry.declared_size,
                                "write_chunk exceeds declared size — aborting write");
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
                        warn!(write_id, "fs:write_chunk_binary for unknown write_id — dropping");
                        continue;
                    }
                };

                if seq != entry.next_seq {
                    warn!(write_id, seq, expected = entry.next_seq, "out-of-order binary chunk — aborting write");
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
                    warn!(write_id, written = entry.bytes_written, declared = entry.declared_size,
                        "fs:write_commit: bytes_written != declared_size — rejecting");
                    let result_msg = ServerMsg::FsWriteResult {
                        write_id,
                        ok: false,
                        new_mtime: None,
                        conflict: false,
                        error: Some(format!("incomplete write: sent {} of {} bytes", entry.bytes_written, entry.declared_size)),
                    };
                    if let Ok(json) = serde_json::to_string(&result_msg) {
                        let _ = pty_tx.send(WireMsg::Text(json)).await;
                    }
                    continue;
                }

                let write_result = atomic_persist_with_check(
                    &entry.abs_path,
                    entry.expected_mtime,
                    entry.temp,
                    false, // fsync off by default
                )
                .await;

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
            ClientMsg::FsOp { req_id, op, project, path, new_path, force_git } => {
                let result = do_fs_op(req_id, &op, &project, &path, new_path.as_deref(), force_git, &state).await;
                let msg = match result {
                    Ok(()) => ServerMsg::FsOpResult { req_id, ok: true, error: None },
                    Err(e) => {
                        warn!(req_id, op = %op, error = %e, "fs:op failed");
                        ServerMsg::FsOpResult { req_id, ok: false, error: Some(e.to_string()) }
                    }
                };
                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = pty_tx.send(WireMsg::Text(json)).await;
                }
            }

            // -----------------------------------------------------------
            // FS — upload begin
            // -----------------------------------------------------------
            ClientMsg::FsUploadBegin { req_id, upload_id, project, dir, filename, len } => {
                let result = do_upload_begin(req_id, &upload_id, &project, &dir, &filename, len, &state, &mut uploads).await;
                let msg = match result {
                    Ok(()) => ServerMsg::FsUploadBeginOk { req_id, upload_id },
                    Err(e) => {
                        warn!(req_id, upload_id, error = %e, "fs:upload_begin failed");
                        ServerMsg::FsError { req_id, code: "UPLOAD_BEGIN_FAILED".into(), message: e.to_string() }
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
                    warn!(upload_id, seq, "fs:upload_chunk for unknown upload_id — dropping");
                    continue;
                }
                if uploads[&upload_id].next_seq != seq {
                    warn!(upload_id, seq, expected = uploads[&upload_id].next_seq, "out-of-order chunk — aborting upload");
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
                        let up_id = upload_state.target_abs.to_string_lossy().to_string();
                        match tokio::task::spawn_blocking(move || upload_state.commit(false)).await {
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
                                warn!(req_id, error = %e, "fs:upload_commit spawn_blocking error");
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
                };
                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = pty_tx.send(WireMsg::Text(json)).await;
                }
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE registration (auth:register_start)
            // -----------------------------------------------------------
            ClientMsg::AuthRegisterStart { req_id, identifier, data } => {
                if !validate_identifier(&identifier) {
                    let msg = ServerMsg::AuthRegisterStartResponse {
                        req_id, ok: false, data: None,
                        error: Some("invalid identifier (alphanumeric + hyphens, max 128 chars)".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                let decoded = match BASE64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthRegisterStartResponse {
                            req_id, ok: false, data: None,
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
                }).await;

                let msg = match result {
                    Ok(Ok(response_bytes)) => {
                        debug!(req_id, identifier, "auth:register_start ok");
                        ServerMsg::AuthRegisterStartResponse {
                            req_id, ok: true,
                            data: Some(BASE64.encode(&response_bytes)),
                            error: None,
                        }
                    }
                    Ok(Err(e)) => {
                        warn!(req_id, identifier, error = %e, "auth:register_start failed");
                        ServerMsg::AuthRegisterStartResponse {
                            req_id, ok: false, data: None, error: Some(e),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:register_start spawn_blocking error");
                        ServerMsg::AuthRegisterStartResponse {
                            req_id, ok: false, data: None,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE registration (auth:register_finish)
            // -----------------------------------------------------------
            ClientMsg::AuthRegisterFinish { req_id, identifier, data, overwrite } => {
                if !validate_identifier(&identifier) {
                    let msg = ServerMsg::AuthRegisterFinishResponse {
                        req_id, ok: false,
                        error: Some("invalid identifier".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                // Reject silent overwrite of an existing registration (H1).
                if !overwrite && state.opaque_registrations.read().await.contains_key(&identifier) {
                    let msg = ServerMsg::AuthRegisterFinishResponse {
                        req_id, ok: false,
                        error: Some("identifier already registered — set overwrite:true to replace".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                let decoded = match BASE64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthRegisterFinishResponse {
                            req_id, ok: false,
                            error: Some(format!("base64 decode failed: {e}")),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let result = tokio::task::spawn_blocking(move || {
                    handle_register_finish(&decoded)
                }).await;

                let msg = match result {
                    Ok(Ok(registration)) => {
                        state.opaque_registrations.write().await.insert(identifier.clone(), registration);
                        debug!(req_id, identifier, overwrite, "auth:register_finish ok — credential stored");
                        ServerMsg::AuthRegisterFinishResponse { req_id, ok: true, error: None }
                    }
                    Ok(Err(e)) => {
                        warn!(req_id, identifier, error = %e, "auth:register_finish failed");
                        ServerMsg::AuthRegisterFinishResponse { req_id, ok: false, error: Some(e) }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:register_finish spawn_blocking error");
                        ServerMsg::AuthRegisterFinishResponse {
                            req_id, ok: false,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE login (auth:login_start)
            // -----------------------------------------------------------
            ClientMsg::AuthLoginStart { req_id, identifier, data } => {
                if !validate_identifier(&identifier) {
                    let msg = ServerMsg::AuthLoginStartResponse {
                        req_id, ok: false, session_id: None, data: None,
                        error: Some("invalid identifier".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                // C2: cap in-flight login sessions per connection to prevent memory exhaustion.
                if opaque_login_states.len() >= 16 {
                    let msg = ServerMsg::AuthLoginStartResponse {
                        req_id, ok: false, session_id: None, data: None,
                        error: Some("too many pending login sessions — complete or abandon existing ones".into()),
                    };
                    send_json(&pty_tx, &msg).await;
                    continue;
                }

                let decoded = match BASE64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthLoginStartResponse {
                            req_id, ok: false, session_id: None, data: None,
                            error: Some(format!("base64 decode failed: {e}")),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let registration = state.opaque_registrations.read().await
                    .get(&identifier)
                    .cloned();
                let setup = std::sync::Arc::clone(&state.opaque_server_setup);
                let id = identifier.clone();
                let session_id = Uuid::new_v4().to_string();
                let sid_for_state = session_id.clone();

                let result = tokio::task::spawn_blocking(move || {
                    handle_login_start(&setup, &id, registration, &decoded)
                }).await;

                let msg = match result {
                    Ok(Ok((login_state, response_bytes))) => {
                        opaque_login_states.insert(sid_for_state, login_state);
                        debug!(req_id, identifier, session_id, "auth:login_start ok");
                        ServerMsg::AuthLoginStartResponse {
                            req_id, ok: true,
                            session_id: Some(session_id),
                            data: Some(BASE64.encode(&response_bytes)),
                            error: None,
                        }
                    }
                    Ok(Err(e)) => {
                        warn!(req_id, identifier, error = %e, "auth:login_start failed");
                        ServerMsg::AuthLoginStartResponse {
                            req_id, ok: false, session_id: None, data: None, error: Some(e),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:login_start spawn_blocking error");
                        ServerMsg::AuthLoginStartResponse {
                            req_id, ok: false, session_id: None, data: None,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            // -----------------------------------------------------------
            // Auth — OPAQUE login (auth:login_finish)
            // -----------------------------------------------------------
            ClientMsg::AuthLoginFinish { req_id, session_id, data } => {
                // C3: check export_keys cap before consuming login_state so client can retry.
                if export_keys.len() >= 16 {
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
                            req_id, ok: false, session_id: None,
                            error: Some("login session not found — run auth:login_start first".into()),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let decoded = match BASE64.decode(&data) {
                    Ok(b) => b,
                    Err(e) => {
                        let msg = ServerMsg::AuthLoginFinishResponse {
                            req_id, ok: false, session_id: None,
                            error: Some(format!("base64 decode failed: {e}")),
                        };
                        send_json(&pty_tx, &msg).await;
                        continue;
                    }
                };

                let sid = session_id.clone();
                let result = tokio::task::spawn_blocking(move || {
                    handle_login_finish(login_state, &decoded)
                }).await;

                let msg = match result {
                    Ok(Ok(aes_key)) => {
                        export_keys.insert(session_id.clone(), aes_key);
                        debug!(req_id, session_id, "auth:login_finish ok — AES key derived");
                        ServerMsg::AuthLoginFinishResponse {
                            req_id, ok: true, session_id: Some(sid), error: None,
                        }
                    }
                    Ok(Err(_e)) => {
                        warn!(req_id, session_id, "auth:login_finish failed (crypto error)");
                        ServerMsg::AuthLoginFinishResponse {
                            req_id, ok: false, session_id: None,
                            error: Some("authentication failed".into()),
                        }
                    }
                    Err(e) => {
                        warn!(req_id, error = %e, "auth:login_finish spawn_blocking error");
                        ServerMsg::AuthLoginFinishResponse {
                            req_id, ok: false, session_id: None,
                            error: Some(format!("internal error: {e}")),
                        }
                    }
                };
                send_json(&pty_tx, &msg).await;
            }

            // -----------------------------------------------------------
            // FS — encrypted put (Phase 04/06 stubs — not yet implemented)
            // -----------------------------------------------------------
            ClientMsg::FsPutBegin { req_id, .. } => {
                warn!(req_id, "fs:put_begin (Phase 04 not yet implemented)");
                send_fs_error(&pty_tx, req_id, "NOT_IMPLEMENTED".into(),
                    "fs:put_* requires Phase 04 implementation".into()).await;
            }
            ClientMsg::FsPutChunk { upload_id, seq } => {
                warn!(upload_id, seq, "fs:put_chunk (Phase 04 not yet implemented) — absorbing binary frame");
                pending_binary = Some(PendingBinary::EncPut { upload_id, seq });
            }
            ClientMsg::FsPutCommit { req_id, upload_id } => {
                warn!(req_id, upload_id, "fs:put_commit (Phase 04 not yet implemented)");
                let msg = ServerMsg::FsPutResult {
                    req_id, upload_id, ok: false, new_mtime: None,
                    error: Some("fs:put_* requires Phase 04 implementation".into()),
                };
                send_json(&pty_tx, &msg).await;
            }
            ClientMsg::FsPutSave { req_id, session_id, .. } => {
                warn!(req_id, "fs:put_save (Phase 04/06 not yet implemented) — absorbing binary frame");
                pending_binary = Some(PendingBinary::EncPutSave { req_id, session_id });
            }
        }
    }

    // Cleanup
    for (sub_id, handle) in fs_pumps {
        handle.abort();
        state.fs.unsubscribe_tree(sub_id);
    }
    pty_pump.abort();
    writer.abort();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn send_fs_error(out_tx: &mpsc::Sender<WireMsg>, req_id: u64, code: String, message: String) {
    let err_msg = ServerMsg::FsError { req_id, code, message };
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
    path: &str,
    state: &AppState,
) -> Result<std::path::PathBuf, (String, String)> {
    let project_abs = state.project_path(project).await.map_err(|e| {
        ("PROJECT_NOT_FOUND".to_string(), e.to_string())
    })?;

    let sandbox = state.fs.sandbox().map_err(|e| {
        ("FS_UNAVAILABLE".to_string(), e.to_string())
    })?;

    let rel = if path.is_empty() || path == "/" { "." } else { path.trim_start_matches('/') };
    sandbox.validate(project_abs.join(rel)).await.map_err(|e| {
        ("PATH_REJECTED".to_string(), e.to_string())
    })
}

/// Handle `fs:read` — stat + binary detect + ranged/full read → base64 response.
async fn do_fs_read(
    req_id: u64,
    project: &str,
    path: &str,
    offset: Option<u64>,
    len: Option<u64>,
    state: &AppState,
) -> ServerMsg {
    let abs = match resolve_abs_path(project, path, state).await {
        Ok(p) => p,
        Err((code, _message)) => {
            return ServerMsg::FsReadResult {
                req_id, ok: false, mime: None, binary: false,
                mtime: None, size: None, data: None,
                code: Some(code),
            };
        }
    };

    // Detect binary + mime (cheap: reads first 8KB)
    let (is_binary, mime) = match ops::detect_binary(&abs).await {
        Ok(v) => v,
        Err(e) => {
            return ServerMsg::FsReadResult {
                req_id, ok: false, mime: None, binary: false,
                mtime: None, size: None, data: None,
                code: Some(format!("IO_ERROR: {e}")),
            };
        }
    };

    // Stat for mtime + size
    let meta = match tokio::fs::metadata(&abs).await {
        Ok(m) => m,
        Err(e) => {
            return ServerMsg::FsReadResult {
                req_id, ok: false, mime: None, binary: false,
                mtime: None, size: None, data: None,
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
    let max = if range.is_some() { u64::MAX } else { FS_WS_READ_MAX };

    let bytes = match ops::read_file(&abs, range, max).await {
        Ok(b) => b,
        Err(crate::fs::FsError::TooLarge(_)) => {
            return ServerMsg::FsReadResult {
                req_id, ok: false, mime, binary: is_binary,
                mtime: Some(mtime), size: Some(file_size),
                data: None, code: Some("TOO_LARGE".into()),
            };
        }
        Err(e) => {
            return ServerMsg::FsReadResult {
                req_id, ok: false, mime, binary: is_binary,
                mtime: None, size: None, data: None,
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
    path: &str,
    new_path: Option<&str>,
    force_git: bool,
    state: &AppState,
) -> Result<(), crate::fs::FsError> {
    let project_abs = state.project_path(project).await.map_err(|e| {
        crate::fs::FsError::MutationRefused(e.to_string())
    })?;

    let sandbox = state.fs.sandbox()?;

    match op {
        "create_file" | "create_dir" => {
            // Target doesn't exist yet — validate via parent + filename split.
            let rel = trim_leading_slash(path);
            let proposed = project_abs.join(rel);
            let parent = proposed.parent()
                .map(|p| p.to_path_buf())
                .unwrap_or(project_abs.clone());
            let name = proposed.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            // Validate parent exists and is within sandbox, then construct new abs path.
            let new_abs = sandbox.validate_new_path(parent, name).await?;
            if op == "create_file" {
                mutate::create_file(&new_abs, &project_abs).await
            } else {
                mutate::create_dir(&new_abs, &project_abs).await
            }
        }
        "delete" => {
            let rel = trim_leading_slash(path);
            // Empty/root path: validate will succeed on project root.
            // assert_safe_mutation will then reject it.
            let abs = if rel == "." {
                project_abs.clone()
            } else {
                sandbox.validate(project_abs.join(rel)).await?
            };
            mutate::delete(&abs, &project_abs, force_git).await
        }
        "rename" | "move" => {
            let rel = trim_leading_slash(path);
            let abs = sandbox.validate(project_abs.join(rel)).await?;

            let dst_rel = new_path.ok_or_else(|| {
                crate::fs::FsError::MutationRefused("rename/move requires new_path".into())
            })?;
            let dst_rel = trim_leading_slash(dst_rel);
            let dst_proposed = project_abs.join(dst_rel);
            let dst_parent = dst_proposed.parent()
                .map(|p| p.to_path_buf())
                .unwrap_or(project_abs.clone());
            let dst_name = dst_proposed.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let dst_abs = sandbox.validate_new_path(dst_parent, dst_name).await?;

            if op == "rename" {
                mutate::rename(&abs, &dst_abs, &project_abs).await
            } else {
                mutate::move_path(&abs, &dst_abs, &project_abs).await
            }
        }
        _ => Err(crate::fs::FsError::MutationRefused(format!("unknown op: {op}"))),
    }
}

fn trim_leading_slash(s: &str) -> &str {
    if s.is_empty() || s == "/" { "." } else { s.trim_start_matches('/') }
}

// ---------------------------------------------------------------------------
// Upload begin helper
// ---------------------------------------------------------------------------

async fn do_upload_begin(
    _req_id: u64,
    upload_id: &str,
    project: &str,
    dir: &str,
    filename: &str,
    len: u64,
    state: &AppState,
    uploads: &mut HashMap<String, UploadState>,
) -> Result<(), crate::fs::FsError> {
    if len > MAX_UPLOAD_BYTES {
        return Err(crate::fs::FsError::TooLarge(len));
    }

    let project_abs = state.project_path(project).await.map_err(|e| {
        crate::fs::FsError::MutationRefused(e.to_string())
    })?;

    let sandbox = state.fs.sandbox()?;

    let dir_rel = trim_leading_slash(dir);
    let dir_abs = sandbox.validate(project_abs.join(dir_rel)).await?;

    // validate_new_path checks filename for path separators / ".." / empty
    let target_abs = sandbox.validate_new_path(dir_abs, filename).await?;

    let upload_state = UploadState::new(target_abs, len)?;
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
    uploads: &mut HashMap<String, UploadState>,
    pty_tx: &mpsc::Sender<WireMsg>,
) {
    let state = match uploads.get_mut(upload_id) {
        Some(s) => s,
        None => {
            warn!(upload_id, seq, "binary frame: upload session not found — dropping");
            return;
        }
    };

    match state.append_chunk(data) {
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
            warn!(write_id, seq, "binary frame: write session not found — dropping");
            return;
        }
    };

    // Note: seq check already done in FsWriteChunkBinary handler to set pending_binary
    let accumulated = entry.bytes_written + data.len() as u64;
    if accumulated > entry.declared_size {
        warn!(write_id, accumulated, declared = entry.declared_size,
            "binary write_chunk exceeds declared size — aborting write");
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
// PTY broadcast pump
// ---------------------------------------------------------------------------

async fn pump_pty(
    mut rx: tokio::sync::broadcast::Receiver<String>,
    pty_tx: mpsc::Sender<WireMsg>,
) {
    loop {
        match rx.recv().await {
            Ok(msg) => {
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

// ---------------------------------------------------------------------------
// FS subscribe helper
// ---------------------------------------------------------------------------

async fn do_fs_subscribe(
    req_id: u64,
    project: &str,
    path: &str,
    state: &AppState,
    pty_tx: mpsc::Sender<WireMsg>,
    fs_tx: mpsc::Sender<WireMsg>,
    fs_pumps: &mut HashMap<u64, tokio::task::JoinHandle<()>>,
) -> Result<(), (String, String)> {
    let project_abs = state.project_path(project).await.map_err(|e| {
        ("PROJECT_NOT_FOUND".to_string(), e.to_string())
    })?;

    let sandbox = state.fs.sandbox().map_err(|e| {
        ("FS_UNAVAILABLE".to_string(), e.to_string())
    })?;

    let rel_path = if path.is_empty() || path == "/" { "." } else { path.trim_start_matches('/') };
    let abs_path = sandbox.validate(project_abs.join(rel_path)).await.map_err(|e| {
        ("PATH_REJECTED".to_string(), e.to_string())
    })?;

    let (sub_id, fs_rx) = state.fs.subscribe_tree(project_abs.clone(), abs_path.clone())
        .map_err(|e| ("WATCHER_ERROR".to_string(), e.to_string()))?;

    debug!(sub_id, project, path, "fs:subscribe_tree");

    let snap_path = abs_path.clone();
    let nodes = tokio::task::spawn_blocking(move || tree_snapshot_sync(&snap_path))
        .await
        .map_err(|e| ("INTERNAL".to_string(), e.to_string()))?
        .map_err(|e| ("SNAPSHOT_ERROR".to_string(), e.to_string()))?;

    let snap = ServerMsg::TreeSnapshot { req_id, sub_id, nodes };
    let json = serde_json::to_string(&snap).map_err(|e| ("SERIALIZE".to_string(), e.to_string()))?;
    pty_tx.send(WireMsg::Text(json)).await.map_err(|_| ("CONN_CLOSED".to_string(), "connection closed".to_string()))?;

    let filter_prefix = abs_path.clone();
    let handle = tokio::spawn(async move {
        pump_fs_events(sub_id, fs_rx, filter_prefix, fs_tx, pty_tx).await;
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
) {
    loop {
        match rx.recv().await {
            Ok(ev) => {
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

                match fs_tx.try_send(WireMsg::Text(json)) {
                    Ok(_) => {}
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        warn!(sub_id, cap = FS_CHAN_CAP, "fs pump mpsc full — dropping subscription");
                        
                        // Send overflow notice via pty channel (proper backpressure)
                        let overflow = ServerMsg::FsOverflow {
                            sub_id,
                            message: format!("FS event buffer full ({}); subscription dropped", FS_CHAN_CAP),
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
}
