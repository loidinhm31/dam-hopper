//! Semantic navigation dispatch and LSP result fencing.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::semantic_connection::{
    ConnectionContext, DocumentRecord, OutboundMessage, RequestCancellation, SemanticConnection,
};
use super::semantic_messages::{
    send_message, serialize_navigation_response_for_send, transport_error,
};
use crate::semantic::navigation as lsp_navigation;
use crate::semantic::navigation_response::{
    SemanticNavigationErrorCode, SemanticNavigationResponse,
};
use crate::semantic::path_mapper::SemanticPathMapper;
use crate::semantic::protocol::{
    DescriptorAvailabilityState, SemanticDescriptorAvailability, SemanticLanguage,
    SemanticNavigationRequest, SemanticServerMessage, SemanticStatusState,
    SemanticTransportErrorCode, MAX_DOCUMENT_BYTES,
};
use crate::semantic::session::{LspSession, SessionError, SessionKey};
use crate::semantic::supervisor::{SemanticSessionFence, SupervisorError};
use crate::semantic::trust::SemanticTrust;
use crate::state::AppState;

pub(crate) async fn active_session(
    state: &AppState,
    connection: &SemanticConnection,
    language: SemanticLanguage,
) -> Option<Arc<LspSession>> {
    let context = connection.current_context().await?;
    if context.trust.trust == SemanticTrust::Revoked
        || !state
            .semantic_supervisor
            .is_lifecycle_current(context.workspace_generation)
    {
        return None;
    }
    let fingerprint = state
        .semantic_supervisor
        .registry()
        .descriptor_fingerprint(language)?;
    let key = SessionKey {
        client_id: connection.client_id.clone(),
        profile_id: context.profile_id,
        project_id: context.project_id,
        descriptor_fingerprint: fingerprint,
        trust_policy_revision: context.trust.policy_revision,
    };
    state.semantic_supervisor.existing_session(&key).await
}

pub(crate) async fn spawn_navigation(
    state: AppState,
    connection: SemanticConnection,
    request: SemanticNavigationRequest,
    out_tx: mpsc::Sender<String>,
) -> JoinHandle<()> {
    let Ok(context) = connection.context_for(&request.uri).await else {
        return tokio::spawn(async move {
            let _ = send_message(
                &out_tx,
                transport_error(SemanticTransportErrorCode::ProjectMismatch),
            )
            .await;
        });
    };
    let cancel = Arc::new(RequestCancellation::default());
    if !connection
        .add_request(
            request.request_id.clone(),
            request.document_version,
            Arc::clone(&cancel),
        )
        .await
    {
        return tokio::spawn(async move {
            let _ = send_message(
                &out_tx,
                transport_error(SemanticTransportErrorCode::InvalidMessage),
            )
            .await;
        });
    }
    let lifecycle_generation = context.workspace_generation;
    let response_context = context.clone();
    let response_cancel = Arc::clone(&cancel);
    tokio::spawn(async move {
        let response =
            execute_navigation(&state, &connection, &request, context, cancel, &out_tx).await;
        let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
        if state
            .semantic_supervisor
            .is_lifecycle_current(lifecycle_generation)
        {
            if let Some(json) = serialize_navigation_response_for_send(&response) {
                connection
                    .try_send_if_current(
                        &response_context,
                        &request.uri,
                        request.document_version,
                        Some(&*response_cancel),
                        matches!(&response, SemanticNavigationResponse::Cancelled { .. }),
                        OutboundMessage {
                            out_tx: out_tx.clone(),
                            json,
                        },
                    )
                    .await;
            }
        }
        connection
            .finish_request(&request.request_id, &response_cancel)
            .await;
    })
}

async fn execute_navigation(
    state: &AppState,
    connection: &SemanticConnection,
    request: &SemanticNavigationRequest,
    context: ConnectionContext,
    cancel: Arc<RequestCancellation>,
    out_tx: &mpsc::Sender<String>,
) -> SemanticNavigationResponse {
    let workspace_context = state.workspace_context_guard.read().await;
    let base = |error| SemanticNavigationResponse::Error {
        request_id: request.request_id.clone(),
        document_version: request.document_version,
        policy_revision: context.trust.policy_revision,
        error,
    };
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
    {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    if context.trust.trust == SemanticTrust::Revoked {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    let Ok(sandbox) = state.fs.sandbox() else {
        return base(SemanticNavigationErrorCode::InternalUnavailable);
    };
    let mapper = SemanticPathMapper::new(sandbox);
    let Ok(resolved_path) = mapper.resolve_uri(&request.uri).await else {
        return base(SemanticNavigationErrorCode::StaleDocument);
    };
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
    {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    let Some(document) = connection.document(&request.uri).await else {
        let Ok(file) = tokio::fs::File::open(&resolved_path).await else {
            return base(SemanticNavigationErrorCode::StaleDocument);
        };
        let opened_path = match tokio::fs::canonicalize(&resolved_path).await {
            Ok(path) if path == resolved_path => path,
            _ => return base(SemanticNavigationErrorCode::StaleDocument),
        };
        let Ok(metadata) = file.metadata().await else {
            return base(SemanticNavigationErrorCode::StaleDocument);
        };
        if !metadata.is_file() {
            return base(SemanticNavigationErrorCode::StaleDocument);
        }
        let mut text = Vec::new();
        if file
            .take(MAX_DOCUMENT_BYTES.saturating_add(1))
            .read_to_end(&mut text)
            .await
            .is_err()
        {
            return base(SemanticNavigationErrorCode::StaleDocument);
        }
        if text.len() > MAX_DOCUMENT_BYTES as usize {
            return base(SemanticNavigationErrorCode::InternalUnavailable);
        }
        let document = DocumentRecord {
            uri: request.uri.clone(),
            resolved_path: opened_path,
            version: request.document_version,
            text,
        };
        if let Err(code) = connection.upsert_document(document.clone(), true).await {
            return base(transport_code_to_navigation(code));
        }
        drop(workspace_context);
        return execute_with_document(
            state,
            connection,
            request,
            cancel,
            NavigationDocument {
                context,
                mapper,
                resolved_path: document.resolved_path.clone(),
                current_document: document,
            },
            out_tx,
        )
        .await;
    };
    if document.version != request.document_version || document.resolved_path != resolved_path {
        return base(SemanticNavigationErrorCode::StaleDocument);
    }
    drop(workspace_context);
    execute_with_document(
        state,
        connection,
        request,
        cancel,
        NavigationDocument {
            context,
            mapper,
            resolved_path,
            current_document: document,
        },
        out_tx,
    )
    .await
}

struct NavigationDocument {
    context: ConnectionContext,
    mapper: SemanticPathMapper,
    resolved_path: std::path::PathBuf,
    current_document: DocumentRecord,
}

async fn execute_with_document(
    state: &AppState,
    connection: &SemanticConnection,
    request: &SemanticNavigationRequest,
    cancel: Arc<RequestCancellation>,
    document: NavigationDocument,
    out_tx: &mpsc::Sender<String>,
) -> SemanticNavigationResponse {
    let NavigationDocument {
        context,
        mapper,
        resolved_path,
        current_document,
    } = document;
    let base = |error| SemanticNavigationResponse::Error {
        request_id: request.request_id.clone(),
        document_version: request.document_version,
        policy_revision: context.trust.policy_revision,
        error,
    };
    let root = match mapper.project_root(&context.project_id) {
        Ok(root) => root,
        Err(_) => return base(SemanticNavigationErrorCode::StaleDocument),
    };
    let current_trust = match state
        .semantic_supervisor
        .trust_state(&context.project_id, &root)
    {
        Ok(trust) => trust,
        Err(_) => return base(SemanticNavigationErrorCode::InternalUnavailable),
    };
    if current_trust.policy_revision != context.trust.policy_revision {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    let registry = state.semantic_supervisor.registry();
    let availability = state.semantic_supervisor.availability(request.uri.language);
    if !matches!(availability.state, DescriptorAvailabilityState::Ready) {
        return SemanticNavigationResponse::Unavailable {
            request_id: request.request_id.clone(),
            document_version: request.document_version,
            policy_revision: context.trust.policy_revision,
            availability,
        };
    }
    let Some(fingerprint) = registry.descriptor_fingerprint(request.uri.language) else {
        return base(SemanticNavigationErrorCode::InternalUnavailable);
    };
    let key = SessionKey {
        client_id: connection.client_id.clone(),
        profile_id: context.profile_id.clone(),
        project_id: context.project_id.clone(),
        descriptor_fingerprint: fingerprint,
        trust_policy_revision: context.trust.policy_revision,
    };
    if cancel.cancelled.load(Ordering::Acquire) {
        return cancelled(request, context.trust.policy_revision);
    }
    if !connection
        .is_current(&context, &request.uri, request.document_version)
        .await
    {
        return base(SemanticNavigationErrorCode::StaleDocument);
    }
    let _ = send_fenced_message(
        state,
        connection,
        &context,
        request,
        &cancel,
        out_tx,
        SemanticServerMessage::Status {
            project_id: context.project_id.clone(),
            state: SemanticStatusState::Starting,
            policy_revision: context.trust.policy_revision,
        },
    )
    .await;
    let session_key = key.clone();
    let session = match state
        .semantic_supervisor
        .ensure_session_for_client(
            key,
            request.uri.language,
            root.clone(),
            context.trust.trust,
            connection.client_close_flag(),
            SemanticSessionFence {
                lifecycle_generation: context.workspace_generation,
                workspace_epoch: context.workspace_epoch,
            },
        )
        .await
    {
        Ok(session) => {
            let selection_current = connection.selection_is_current(&context).await;
            let lifecycle_current = state
                .semantic_supervisor
                .is_lifecycle_current(context.workspace_generation);
            if !selection_current || !lifecycle_current {
                state
                    .semantic_supervisor
                    .release_session_if(&session_key, &session)
                    .await;
                return base(if lifecycle_current {
                    SemanticNavigationErrorCode::StaleDocument
                } else {
                    SemanticNavigationErrorCode::PolicyChanged
                });
            }
            session
        }
        Err(error) => {
            return supervisor_error_response(
                request,
                context.trust.policy_revision,
                error,
                availability,
            )
        }
    };
    for document in connection.documents(request.uri.language).await {
        if let Err(error) = session
            .sync_document(
                document.uri,
                document.resolved_path,
                document.version,
                document.text,
            )
            .await
        {
            if !matches!(error, SessionError::StaleDocument) {
                return base(session_error_to_navigation(error));
            }
        }
    }
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
    {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    let lsp_uri = match mapper.lsp_uri_for_path(&resolved_path) {
        Ok(uri) => uri,
        Err(_) => return base(SemanticNavigationErrorCode::StaleDocument),
    };
    if connection
        .document(&current_document.uri)
        .await
        .is_none_or(|document| {
            document.version != current_document.version
                || document.resolved_path != current_document.resolved_path
        })
    {
        if let Err(error) = session
            .sync_document(
                current_document.uri.clone(),
                current_document.resolved_path.clone(),
                current_document.version,
                current_document.text.clone(),
            )
            .await
        {
            if !matches!(error, SessionError::StaleDocument) {
                return base(session_error_to_navigation(error));
            }
        }
    }
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
    {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    let lsp_request_id = session.next_request_id();
    if cancel.cancelled.load(Ordering::Acquire) {
        let _ = session.cancel_request(&lsp_request_id).await;
        return cancelled(request, context.trust.policy_revision);
    }
    let lsp_request = lsp_navigation::lsp_request(&lsp_request_id, request, &lsp_uri);
    let result = tokio::select! {
        response = session.request(&lsp_request_id, &lsp_request, Duration::from_millis(lsp_navigation::NAVIGATION_DEADLINE_MS)) => response,
        _ = cancel.wait() => {
            let _ = session.cancel_request(&lsp_request_id).await;
            return cancelled(request, context.trust.policy_revision);
        }
    };
    let value = match result {
        Ok(value) if value.get("error").is_none() => value
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        Err(SessionError::RequestTimeout) => {
            return base(SemanticNavigationErrorCode::DeadlineExceeded)
        }
        Err(_) | Ok(_) => return base(SemanticNavigationErrorCode::InternalUnavailable),
    };
    let latest_trust = match state
        .semantic_supervisor
        .trust_state(&context.project_id, &root)
    {
        Ok(trust) => trust,
        Err(_) => return base(SemanticNavigationErrorCode::InternalUnavailable),
    };
    if latest_trust.policy_revision != context.trust.policy_revision
        || !state
            .semantic_supervisor
            .is_lifecycle_current(context.workspace_generation)
    {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    if !connection
        .is_current(&context, &request.uri, request.document_version)
        .await
    {
        return base(SemanticNavigationErrorCode::StaleDocument);
    }
    let targets = lsp_navigation::map_result(
        &value,
        &mapper,
        &context.profile_id,
        &context.project_id,
        request.uri.language,
        request.max_targets,
    )
    .await;
    if !state
        .semantic_supervisor
        .is_lifecycle_current(context.workspace_generation)
    {
        return base(SemanticNavigationErrorCode::PolicyChanged);
    }
    let _ = send_fenced_message(
        state,
        connection,
        &context,
        request,
        &cancel,
        out_tx,
        SemanticServerMessage::Progress {
            request_id: request.request_id.clone(),
            document_version: request.document_version,
            policy_revision: context.trust.policy_revision,
            state: SemanticStatusState::Ready,
        },
    )
    .await;
    if targets.is_empty() {
        SemanticNavigationResponse::Empty {
            request_id: request.request_id.clone(),
            document_version: request.document_version,
            policy_revision: context.trust.policy_revision,
        }
    } else {
        SemanticNavigationResponse::Targets {
            request_id: request.request_id.clone(),
            document_version: request.document_version,
            policy_revision: context.trust.policy_revision,
            targets,
        }
    }
}

async fn send_fenced_message(
    state: &AppState,
    connection: &SemanticConnection,
    context: &ConnectionContext,
    request: &SemanticNavigationRequest,
    cancel: &RequestCancellation,
    out_tx: &mpsc::Sender<String>,
    message: SemanticServerMessage,
) -> bool {
    let _lifecycle = state.semantic_supervisor.lifecycle_read().await;
    if cancel.cancelled.load(Ordering::Acquire)
        || !state
            .semantic_supervisor
            .is_lifecycle_current(context.workspace_generation)
        || !connection
            .is_current(context, &request.uri, request.document_version)
            .await
    {
        return false;
    }
    let Ok(json) = crate::semantic::transport_messages::serialize_server_message(&message) else {
        return false;
    };
    connection
        .try_send_if_current(
            context,
            &request.uri,
            request.document_version,
            Some(cancel),
            false,
            OutboundMessage {
                out_tx: out_tx.clone(),
                json,
            },
        )
        .await
}

fn cancelled(
    request: &SemanticNavigationRequest,
    policy_revision: u64,
) -> SemanticNavigationResponse {
    SemanticNavigationResponse::Cancelled {
        request_id: request.request_id.clone(),
        document_version: request.document_version,
        policy_revision,
    }
}

fn supervisor_error_response(
    request: &SemanticNavigationRequest,
    policy_revision: u64,
    error: SupervisorError,
    availability: SemanticDescriptorAvailability,
) -> SemanticNavigationResponse {
    let base = |code| SemanticNavigationResponse::Error {
        request_id: request.request_id.clone(),
        document_version: request.document_version,
        policy_revision,
        error: code,
    };
    match error {
        SupervisorError::UnsupportedCapability | SupervisorError::Disabled => {
            SemanticNavigationResponse::Unavailable {
                request_id: request.request_id.clone(),
                document_version: request.document_version,
                policy_revision,
                availability,
            }
        }
        SupervisorError::TrustPolicyChanged | SupervisorError::ProjectRevoked => {
            base(SemanticNavigationErrorCode::PolicyChanged)
        }
        SupervisorError::Backoff { .. } | SupervisorError::Quarantined => {
            base(SemanticNavigationErrorCode::InternalUnavailable)
        }
        _ => base(SemanticNavigationErrorCode::InternalUnavailable),
    }
}

fn transport_code_to_navigation(code: SemanticTransportErrorCode) -> SemanticNavigationErrorCode {
    match code {
        SemanticTransportErrorCode::StaleDocument => SemanticNavigationErrorCode::StaleDocument,
        SemanticTransportErrorCode::PolicyChanged => SemanticNavigationErrorCode::PolicyChanged,
        _ => SemanticNavigationErrorCode::InternalUnavailable,
    }
}

fn session_error_to_navigation(error: SessionError) -> SemanticNavigationErrorCode {
    match error {
        SessionError::StaleDocument => SemanticNavigationErrorCode::StaleDocument,
        SessionError::DocumentLimitExceeded | SessionError::InvalidDocument => {
            SemanticNavigationErrorCode::InternalUnavailable
        }
        _ => SemanticNavigationErrorCode::InternalUnavailable,
    }
}
