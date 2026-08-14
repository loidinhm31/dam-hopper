//! Authenticated semantic WebSocket transport.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{
    ws::{CloseFrame, Message, WebSocket},
    Query, State, WebSocketUpgrade,
};
use axum::response::{IntoResponse, Response};
use axum_extra::extract::CookieJar;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Notify};
use tokio::task::JoinHandle;

use super::semantic_connection::{DocumentRecord, OutboundMessage, SemanticConnection};
use super::semantic_messages::{send_message, transport_error};
use super::semantic_navigation::{active_session, spawn_navigation};
use crate::api::auth::{self, AUTH_COOKIE};
use crate::semantic::path_mapper::SemanticPathMapper;
use crate::semantic::protocol::{
    parse_client_message, validate_opaque_id, SemanticClientMessage, SemanticCloseReason,
    SemanticDocumentReplay, SemanticLanguage, SemanticServerMessage, SemanticStatusState,
    SemanticTransportErrorCode, SemanticTrustEventReason, MAX_DOCUMENT_BYTES,
    SEMANTIC_PROTOCOL_VERSION,
};
use crate::semantic::session::SessionError;
use crate::semantic::supervisor::SemanticSupervisorEvent;
use crate::semantic::trust::{SemanticTrust, SemanticTrustState};
use crate::state::AppState;

const OUTBOUND_CAPACITY: usize = 64;
const MAX_NAVIGATION_TASKS: usize = 64;
const MAX_NAVIGATION_TASK_AGE_MS: u64 = 5_000;
const LANGUAGES: [SemanticLanguage; 4] = [
    SemanticLanguage::Rust,
    SemanticLanguage::Typescript,
    SemanticLanguage::Javascript,
    SemanticLanguage::Java,
];

pub async fn ws_handler(
    upgrade: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    jar: CookieJar,
    State(state): State<AppState>,
) -> Response {
    let token = params
        .get("token")
        .cloned()
        .or_else(|| jar.get(AUTH_COOKIE).map(|cookie| cookie.value().to_owned()));
    let Some(actor) = auth::websocket_actor(state.no_auth, token, &state.jwt_secret) else {
        return (
            axum::http::StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({"error": "Unauthorized"})),
        )
            .into_response();
    };
    upgrade
        .max_frame_size(crate::semantic::protocol::MAX_SEMANTIC_WS_MESSAGE_BYTES)
        .max_message_size(crate::semantic::protocol::MAX_SEMANTIC_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state, actor.subject))
}

async fn handle_socket(socket: WebSocket, state: AppState, actor_subject: String) {
    let connection = SemanticConnection::new(actor_subject);
    let (ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<String>(OUTBOUND_CAPACITY);
    let writer = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(json) = out_rx.recv().await {
            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_tx
            .send(Message::Close(Some(CloseFrame {
                code: 1000,
                reason: "semantic session closed".into(),
            })))
            .await;
    });

    let supervisor_events = state.semantic_supervisor.subscribe();
    let handshake_sent = {
        let _workspace_context = state.workspace_context_guard.read().await;
        let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
        let handshake = build_handshake(&state, &connection).await;
        send_message(&out_tx, handshake).await
    };
    if !handshake_sent {
        return;
    }
    let shutdown_signal = Arc::new(Notify::new());
    let event_task = tokio::spawn(semantic_event_loop(
        supervisor_events,
        connection.clone(),
        state.clone(),
        out_tx.clone(),
        Arc::clone(&shutdown_signal),
    ));
    let mut navigation_tasks: Vec<(JoinHandle<()>, std::time::Instant)> = Vec::new();

    loop {
        let message = tokio::select! {
            message = ws_rx.next() => message,
            _ = shutdown_signal.notified() => break,
        };
        let Some(message) = message else { break };
        let Ok(message) = message else { break };
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Binary(_) => {
                let _ = send_message(
                    &out_tx,
                    transport_error(SemanticTransportErrorCode::InvalidMessage),
                )
                .await;
                continue;
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => continue,
        };
        let parsed = match parse_client_message(&text) {
            Ok(message) => message,
            Err(error) => {
                let _ = send_message(&out_tx, transport_error(error.into())).await;
                continue;
            }
        };
        match parsed {
            SemanticClientMessage::Project {
                profile_id,
                project_id,
            } => {
                handle_project(&state, &connection, profile_id, project_id, &out_tx).await;
            }
            SemanticClientMessage::Prewarm {
                project_id,
                language,
                tab_generation,
            } => {
                handle_prewarm(
                    &state,
                    &connection,
                    project_id,
                    language,
                    tab_generation,
                    &out_tx,
                )
                .await;
            }
            SemanticClientMessage::DocumentOpen {
                uri,
                document_version,
                text,
            } => {
                handle_document(
                    &state,
                    &connection,
                    uri,
                    document_version,
                    text.into_bytes(),
                    true,
                    &out_tx,
                )
                .await;
            }
            SemanticClientMessage::DocumentChange {
                uri,
                document_version,
                text,
            } => {
                handle_document(
                    &state,
                    &connection,
                    uri,
                    document_version,
                    text.into_bytes(),
                    false,
                    &out_tx,
                )
                .await;
            }
            SemanticClientMessage::DocumentClose {
                uri,
                document_version,
            } => {
                handle_close(&state, &connection, uri, document_version, &out_tx).await;
            }
            SemanticClientMessage::Navigate(request) => {
                navigation_tasks.retain_mut(|(task, started)| {
                    if !task.is_finished()
                        && started.elapsed().as_millis() > MAX_NAVIGATION_TASK_AGE_MS as u128
                    {
                        task.abort();
                    }
                    !task.is_finished()
                });
                if navigation_tasks.len() >= MAX_NAVIGATION_TASKS {
                    let _ = send_message(
                        &out_tx,
                        transport_error(SemanticTransportErrorCode::InternalUnavailable),
                    )
                    .await;
                    continue;
                }
                navigation_tasks.push((
                    spawn_navigation(state.clone(), connection.clone(), request, out_tx.clone())
                        .await,
                    std::time::Instant::now(),
                ));
            }
            SemanticClientMessage::Cancel(cancel) => {
                let _ = connection
                    .cancel_request(&cancel.request_id, cancel.document_version)
                    .await;
            }
            SemanticClientMessage::Resync { project_id } => {
                handle_resync(&state, &connection, project_id, &out_tx).await;
            }
        }
    }

    connection.close().await;
    event_task.abort();
    let _ = event_task.await;
    for (task, _) in navigation_tasks {
        task.abort();
        let _ = task.await;
    }
    state
        .semantic_supervisor
        .release_client(&connection.session_client_id())
        .await;
    drop(out_tx);
    let _ = writer.await;
}

async fn build_handshake(
    state: &AppState,
    connection: &SemanticConnection,
) -> SemanticServerMessage {
    let availability = LANGUAGES
        .iter()
        .map(|language| state.semantic_supervisor.availability(*language))
        .collect::<Vec<_>>();
    let projects = {
        let config = state.config.read().await;
        config
            .projects
            .iter()
            .map(|project| project.name.clone())
            .filter(|project_id| validate_opaque_id(project_id, "project_id").is_ok())
            .collect::<Vec<_>>()
    };
    let trust = state
        .fs
        .sandbox()
        .ok()
        .map(|sandbox| {
            projects
                .iter()
                .filter_map(|project_id| {
                    let root = sandbox.project_root(project_id)?;
                    state
                        .semantic_supervisor
                        .trust_state(project_id, &root)
                        .ok()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    SemanticServerMessage::Handshake {
        protocol_version: SEMANTIC_PROTOCOL_VERSION,
        session_epoch: connection.session_epoch(),
        workspace_generation: state.semantic_supervisor.lifecycle_generation(),
        availability,
        trust,
    }
}

async fn handle_project(
    state: &AppState,
    connection: &SemanticConnection,
    profile_id: String,
    project_id: String,
    out_tx: &mpsc::Sender<String>,
) {
    let _workspace_context = state.workspace_context_guard.read().await;
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    if validate_opaque_id(&project_id, "project_id").is_err() {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::InvalidMessage),
        )
        .await;
        return;
    }
    let Ok(sandbox) = state.fs.sandbox() else {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::InternalUnavailable),
        )
        .await;
        return;
    };
    let Some(root) = sandbox.project_root(&project_id) else {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::UnknownProject),
        )
        .await;
        return;
    };
    let Ok(trust) = state.semantic_supervisor.trust_state(&project_id, &root) else {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::InternalUnavailable),
        )
        .await;
        return;
    };
    let lifecycle_generation = state.semantic_supervisor.lifecycle_generation();
    let workspace_epoch = state.semantic_supervisor.workspace_epoch();
    if !connection
        .same_project(
            &profile_id,
            &project_id,
            lifecycle_generation,
            workspace_epoch,
            trust.policy_revision,
        )
        .await
    {
        state
            .semantic_supervisor
            .release_client(&connection.session_client_id())
            .await;
        connection
            .select_project(
                profile_id,
                project_id.clone(),
                lifecycle_generation,
                workspace_epoch,
                trust.clone(),
            )
            .await;
    }
    let availability = LANGUAGES
        .iter()
        .map(|language| state.semantic_supervisor.availability(*language))
        .collect();
    let Some(context) = connection.current_context().await else {
        return;
    };
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
    {
        return;
    }
    if let Ok(json) = crate::semantic::transport_messages::serialize_server_message(
        &SemanticServerMessage::Project {
            project_id,
            workspace_generation: context.workspace_generation,
            trust,
            availability,
        },
    ) {
        let _ = connection
            .try_send_if_selection_current(&context, out_tx, json)
            .await;
    }
}

async fn handle_prewarm(
    state: &AppState,
    connection: &SemanticConnection,
    project_id: String,
    language: SemanticLanguage,
    tab_generation: u64,
    out_tx: &mpsc::Sender<String>,
) {
    let _workspace_context = state.workspace_context_guard.read().await;
    let Some(context) = connection.current_context().await else {
        return;
    };
    if context.project_id != project_id || context.trust.trust == SemanticTrust::Revoked {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::ProjectMismatch),
        )
        .await;
        return;
    }
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
        || !connection.selection_is_current(&context).await
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::PolicyChanged),
        )
        .await;
        return;
    }
    let Ok(sandbox) = state.fs.sandbox() else {
        return;
    };
    let Some(project_root) = sandbox.project_root(&project_id) else {
        return;
    };
    let Some(descriptor_fingerprint) = state
        .semantic_supervisor
        .registry()
        .descriptor_fingerprint(language)
    else {
        return;
    };
    let result = state
        .semantic_supervisor
        .request_prewarm(crate::semantic::supervisor::PrewarmIntent {
            key: crate::semantic::supervisor::PrewarmKey {
                client_id: connection.session_client_id(),
                profile_id: context.profile_id.clone(),
                project_id: project_id.clone(),
                descriptor_fingerprint,
                trust_policy_revision: context.trust.policy_revision,
                tab_generation,
            },
            language,
            project_root,
            trust: context.trust.trust,
            stable_for_ms: crate::semantic::supervisor::PREWARM_DWELL_MS,
            workspace_generation: context.workspace_generation,
            workspace_epoch: context.workspace_epoch,
        })
        .await;
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
        || !connection.selection_is_current(&context).await
    {
        return;
    }
    if result.is_err() {
        let _ = send_message(
            out_tx,
            SemanticServerMessage::Status {
                project_id,
                state: SemanticStatusState::Unavailable,
                policy_revision: context.trust.policy_revision,
            },
        )
        .await;
    }
}

async fn handle_document(
    state: &AppState,
    connection: &SemanticConnection,
    uri: crate::semantic::protocol::SemanticUri,
    version: u64,
    text: Vec<u8>,
    opening: bool,
    out_tx: &mpsc::Sender<String>,
) {
    let _workspace_context = state.workspace_context_guard.read().await;
    let Ok(context) = connection.context_for(&uri).await else {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::ProjectMismatch),
        )
        .await;
        return;
    };
    if context.trust.trust == SemanticTrust::Revoked
        || !state
            .semantic_supervisor
            .is_lifecycle_current(context.workspace_generation)
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::PolicyChanged),
        )
        .await;
        return;
    }
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
        || !connection.selection_is_current(&context).await
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::PolicyChanged),
        )
        .await;
        return;
    }
    let Ok(sandbox) = state.fs.sandbox() else {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::InternalUnavailable),
        )
        .await;
        return;
    };
    let mapper = SemanticPathMapper::new(sandbox);
    let resolved_path = match mapper.resolve_uri(&uri).await {
        Ok(path) => path,
        Err(_) => {
            let _ = send_message(
                out_tx,
                transport_error(SemanticTransportErrorCode::InvalidMessage),
            )
            .await;
            return;
        }
    };
    if text.len() > MAX_DOCUMENT_BYTES as usize {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::InvalidMessage),
        )
        .await;
        return;
    }
    if !opening
        && connection
            .document(&uri)
            .await
            .is_some_and(|previous| previous.resolved_path != resolved_path)
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::StaleDocument),
        )
        .await;
        return;
    }
    let document = DocumentRecord {
        uri: uri.clone(),
        resolved_path: resolved_path.clone(),
        version,
        text: text.clone(),
    };
    let previous = match connection.replace_document(document, opening).await {
        Ok(previous) => previous,
        Err(code) => {
            let _ = send_message(out_tx, transport_error(code)).await;
            return;
        }
    };
    if let Some(session) = active_session(state, connection, uri.language).await {
        if let Err(error) = session
            .sync_document(uri.clone(), resolved_path, version, text)
            .await
        {
            connection.restore_document(&uri, version, previous).await;
            let _ = send_message(out_tx, transport_error(session_error_code(error))).await;
            return;
        }
    }
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
        || !connection.selection_is_current(&context).await
        || !connection.is_current(&context, &uri, version).await
    {
        connection.restore_document(&uri, version, previous).await;
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::PolicyChanged),
        )
        .await;
        return;
    }
    if let Ok(json) = crate::semantic::transport_messages::serialize_server_message(
        &SemanticServerMessage::DocumentAccepted {
            uri: uri.clone(),
            document_version: version,
        },
    ) {
        let _ = connection
            .try_send_if_current(
                &context,
                &uri,
                version,
                None,
                false,
                OutboundMessage {
                    out_tx: out_tx.clone(),
                    json,
                },
            )
            .await;
    }
}

async fn handle_close(
    state: &AppState,
    connection: &SemanticConnection,
    uri: crate::semantic::protocol::SemanticUri,
    version: u64,
    out_tx: &mpsc::Sender<String>,
) {
    let _workspace_context = state.workspace_context_guard.read().await;
    let Ok(context) = connection.context_for(&uri).await else {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::ProjectMismatch),
        )
        .await;
        return;
    };
    if context.trust.trust == SemanticTrust::Revoked
        || !state
            .semantic_supervisor
            .is_lifecycle_current(context.workspace_generation)
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::PolicyChanged),
        )
        .await;
        return;
    }
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
        || !connection.selection_is_current(&context).await
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::PolicyChanged),
        )
        .await;
        return;
    }
    if let Some(session) = active_session(state, connection, uri.language).await {
        if let Err(error) = session.close_document(uri.clone(), version).await {
            let _ = send_message(out_tx, transport_error(session_error_code(error))).await;
            return;
        }
    }
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
        || !connection.selection_is_current(&context).await
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::PolicyChanged),
        )
        .await;
        return;
    }
    match connection.remove_document(&uri, version).await {
        Ok(_) => {
            if let Ok(json) = crate::semantic::transport_messages::serialize_server_message(
                &SemanticServerMessage::DocumentAccepted {
                    uri,
                    document_version: version,
                },
            ) {
                let _ = connection
                    .try_send_if_selection_current(&context, out_tx, json)
                    .await;
            }
        }
        Err(code) => {
            let _ = send_message(out_tx, transport_error(code)).await;
        }
    }
}

async fn handle_resync(
    state: &AppState,
    connection: &SemanticConnection,
    project_id: String,
    out_tx: &mpsc::Sender<String>,
) {
    let _workspace_context = state.workspace_context_guard.read().await;
    let Some(context) = connection.current_context().await else {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::ProjectMismatch),
        )
        .await;
        return;
    };
    if context.project_id != project_id
        || !state
            .semantic_supervisor
            .is_lifecycle_current(context.workspace_generation)
    {
        let _ = send_message(
            out_tx,
            transport_error(SemanticTransportErrorCode::ProjectMismatch),
        )
        .await;
        return;
    }
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
        || !connection.selection_is_current(&context).await
    {
        return;
    }
    let mut documents = Vec::new();
    for language in LANGUAGES {
        documents.extend(
            connection
                .documents(language)
                .await
                .into_iter()
                .map(|document| SemanticDocumentReplay {
                    uri: document.uri,
                    document_version: document.version,
                }),
        );
    }
    if let Ok(json) = crate::semantic::transport_messages::serialize_server_message(
        &SemanticServerMessage::Replay {
            project_id,
            documents,
        },
    ) {
        let _ = connection
            .try_send_if_selection_current(&context, out_tx, json)
            .await;
    }
}

async fn semantic_event_loop(
    mut events: tokio::sync::broadcast::Receiver<SemanticSupervisorEvent>,
    connection: SemanticConnection,
    state: AppState,
    out_tx: mpsc::Sender<String>,
    shutdown_signal: Arc<Notify>,
) {
    loop {
        let event = match events.recv().await {
            Ok(event) => event,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                // Missing a lifecycle event is fail-closed: discard the selected
                // project and documents rather than risk serving stale results.
                let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
                let generation = state.semantic_supervisor.lifecycle_generation();
                let workspace_epoch = state.semantic_supervisor.workspace_epoch();
                connection
                    .invalidate_workspace(generation, workspace_epoch)
                    .await;
                if !send_lifecycle_message(
                    &connection,
                    &out_tx,
                    &shutdown_signal,
                    SemanticServerMessage::WorkspaceChanged {
                        reason: SemanticCloseReason::WorkspaceChanged,
                    },
                )
                .await
                {
                    return;
                }
                continue;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        };
        match event {
            SemanticSupervisorEvent::TrustChanged {
                generation,
                workspace_epoch,
                project_id,
                trust,
                policy_revision,
                revoked,
            } => {
                if fail_closed_for_stale_workspace(&connection, &state, &out_tx, &shutdown_signal)
                    .await
                {
                    continue;
                }
                if !state.semantic_supervisor.is_lifecycle_current(generation)
                    || !state
                        .semantic_supervisor
                        .is_workspace_current(workspace_epoch)
                {
                    continue;
                }
                let Some(context) = connection.current_context().await else {
                    continue;
                };
                if context.project_id != project_id
                    || context.workspace_epoch != workspace_epoch
                    || context.workspace_generation >= generation
                {
                    continue;
                }
                let trust_state =
                    current_trust_state(&state, &project_id, trust, policy_revision).await;
                let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
                if !state.semantic_supervisor.is_lifecycle_current(generation)
                    || !state
                        .semantic_supervisor
                        .is_workspace_current(workspace_epoch)
                    || connection.current_context().await.is_none_or(|context| {
                        context.project_id != project_id
                            || context.workspace_epoch != workspace_epoch
                            || context.workspace_generation >= generation
                    })
                {
                    continue;
                }
                connection
                    .invalidate_policy(&project_id, trust_state.clone(), generation)
                    .await;
                let reason = if revoked {
                    SemanticTrustEventReason::Revoked
                } else {
                    SemanticTrustEventReason::Transition
                };
                let Some(context) = connection.current_context().await.filter(|context| {
                    context.project_id == project_id
                        && context.workspace_epoch == workspace_epoch
                        && context.workspace_generation == generation
                }) else {
                    continue;
                };
                let mut messages = Vec::new();
                if let Ok(json) = crate::semantic::transport_messages::serialize_server_message(
                    &SemanticServerMessage::TrustChanged {
                        project_id: project_id.clone(),
                        trust: trust_state,
                        reason,
                    },
                ) {
                    messages.push(json);
                }
                if revoked {
                    if let Ok(json) = crate::semantic::transport_messages::serialize_server_message(
                        &SemanticServerMessage::Status {
                            project_id: project_id.clone(),
                            state: SemanticStatusState::Unavailable,
                            policy_revision,
                        },
                    ) {
                        messages.push(json);
                    }
                    if let Ok(json) = crate::semantic::transport_messages::serialize_server_message(
                        &SemanticServerMessage::Closed {
                            reason: SemanticCloseReason::ProjectRevoked,
                        },
                    ) {
                        messages.push(json);
                    }
                }
                let _ = connection
                    .try_send_batch_if_selection_current(&context, &out_tx, messages)
                    .await;
            }
            SemanticSupervisorEvent::WorkspaceChanged {
                generation,
                workspace_epoch,
            } => {
                let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
                if !state.semantic_supervisor.is_lifecycle_current(generation)
                    || !state
                        .semantic_supervisor
                        .is_workspace_current(workspace_epoch)
                {
                    continue;
                }
                connection
                    .invalidate_workspace(generation, workspace_epoch)
                    .await;
                if !send_lifecycle_message(
                    &connection,
                    &out_tx,
                    &shutdown_signal,
                    SemanticServerMessage::WorkspaceChanged {
                        reason: SemanticCloseReason::WorkspaceChanged,
                    },
                )
                .await
                {
                    return;
                }
            }
            SemanticSupervisorEvent::Shutdown { generation } => {
                let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
                if !state.semantic_supervisor.is_lifecycle_current(generation) {
                    continue;
                }
                let workspace_epoch = state.semantic_supervisor.workspace_epoch();
                connection
                    .invalidate_workspace(generation, workspace_epoch)
                    .await;
                let sent = send_lifecycle_message(
                    &connection,
                    &out_tx,
                    &shutdown_signal,
                    SemanticServerMessage::Closed {
                        reason: SemanticCloseReason::ServerShutdown,
                    },
                )
                .await;
                if sent {
                    shutdown_signal.notify_one();
                }
                return;
            }
        }
    }
}

async fn fail_closed_for_stale_workspace(
    connection: &SemanticConnection,
    state: &AppState,
    out_tx: &mpsc::Sender<String>,
    shutdown_signal: &Notify,
) -> bool {
    let Some(context) = connection.current_context().await else {
        return false;
    };
    if context.workspace_epoch >= state.semantic_supervisor.workspace_epoch() {
        return false;
    }
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    let generation = state.semantic_supervisor.lifecycle_generation();
    let workspace_epoch = state.semantic_supervisor.workspace_epoch();
    if connection
        .current_context()
        .await
        .is_none_or(|context| context.workspace_epoch >= workspace_epoch)
    {
        return false;
    }
    connection
        .invalidate_workspace(generation, workspace_epoch)
        .await;
    let _ = send_lifecycle_message(
        connection,
        out_tx,
        shutdown_signal,
        SemanticServerMessage::WorkspaceChanged {
            reason: SemanticCloseReason::WorkspaceChanged,
        },
    )
    .await;
    true
}

async fn send_lifecycle_message(
    connection: &SemanticConnection,
    out_tx: &mpsc::Sender<String>,
    shutdown_signal: &Notify,
    message: SemanticServerMessage,
) -> bool {
    if send_message(out_tx, message).await {
        return true;
    }
    // A full outbound queue must not strand a client across a lifecycle fence.
    // Close the connection and wake the owning socket loop so it releases all
    // sessions and reconnects through the normal client path.
    connection.close().await;
    shutdown_signal.notify_one();
    false
}

fn session_error_code(error: SessionError) -> SemanticTransportErrorCode {
    match error {
        SessionError::StaleDocument => SemanticTransportErrorCode::StaleDocument,
        SessionError::DocumentLimitExceeded | SessionError::InvalidDocument => {
            SemanticTransportErrorCode::InvalidMessage
        }
        _ => SemanticTransportErrorCode::InternalUnavailable,
    }
}

async fn current_trust_state(
    state: &AppState,
    project_id: &str,
    trust: SemanticTrust,
    policy_revision: u64,
) -> SemanticTrustState {
    let _workspace_context = state.workspace_context_guard.read().await;
    if let Ok(sandbox) = state.fs.sandbox() {
        if let Some(root) = sandbox.project_root(project_id) {
            if let Ok(value) = state.semantic_supervisor.trust_state(project_id, &root) {
                return value;
            }
        }
    }
    SemanticTrustState {
        project_id: project_id.to_owned(),
        trust,
        can_transition: false,
        transition_reason: None,
        policy_revision,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::trust::{SemanticTrust, TrustTransitionReason};
    use std::time::Duration;

    #[tokio::test]
    async fn lifecycle_send_failure_closes_connection_and_wakes_socket_loop() {
        let connection = SemanticConnection::new("test-actor");
        connection
            .select_project(
                "profile".into(),
                "project".into(),
                0,
                0,
                SemanticTrustState {
                    project_id: "project".into(),
                    trust: SemanticTrust::Restricted,
                    can_transition: true,
                    transition_reason: Some(TrustTransitionReason::ConfirmationRequired),
                    policy_revision: 0,
                },
            )
            .await;
        let (out_tx, mut out_rx) = mpsc::channel(1);
        out_tx.try_send("queue already full".into()).unwrap();
        let shutdown_signal = Notify::new();

        let sent = send_lifecycle_message(
            &connection,
            &out_tx,
            &shutdown_signal,
            SemanticServerMessage::WorkspaceChanged {
                reason: SemanticCloseReason::WorkspaceChanged,
            },
        )
        .await;

        assert!(!sent);
        assert_eq!(out_rx.try_recv().as_deref(), Ok("queue already full"));
        assert!(connection.current_context().await.is_none());
        assert!(
            tokio::time::timeout(Duration::from_secs(1), shutdown_signal.notified())
                .await
                .is_ok()
        );
    }
}
