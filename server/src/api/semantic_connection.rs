//! Per-connection semantic document and cancellation state.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex, Notify};
use uuid::Uuid;

use crate::semantic::protocol::{
    SemanticLanguage, SemanticTransportErrorCode, SemanticUri, MAX_OPEN_DOCUMENTS,
};
use crate::semantic::trust::SemanticTrustState;

const MAX_INFLIGHT_REQUESTS: usize = 64;
const MAX_TOTAL_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct SemanticConnection {
    pub(crate) client_id: String,
    session_epoch: u64,
    inner: Arc<Mutex<ConnectionInner>>,
    closed: Arc<AtomicBool>,
}

struct ConnectionInner {
    epoch: u64,
    workspace_generation: u64,
    workspace_epoch: u64,
    profile_id: Option<String>,
    project_id: Option<String>,
    trust: Option<SemanticTrustState>,
    documents: HashMap<DocumentKey, DocumentRecord>,
    document_bytes: usize,
    inflight: HashMap<String, InflightRequest>,
    closed: bool,
}

#[derive(Clone)]
pub(crate) struct DocumentRecord {
    pub(crate) uri: SemanticUri,
    pub(crate) resolved_path: std::path::PathBuf,
    pub(crate) version: u64,
    pub(crate) text: Vec<u8>,
}

struct InflightRequest {
    document_version: u64,
    cancel: Arc<RequestCancellation>,
}

pub(crate) struct OutboundMessage {
    pub(crate) out_tx: mpsc::Sender<String>,
    pub(crate) json: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DocumentKey {
    profile_id: String,
    project_id: String,
    path: String,
    language: SemanticLanguage,
}

#[derive(Clone)]
pub(crate) struct ConnectionContext {
    pub(crate) epoch: u64,
    pub(crate) workspace_generation: u64,
    pub(crate) workspace_epoch: u64,
    pub(crate) profile_id: String,
    pub(crate) project_id: String,
    pub(crate) trust: SemanticTrustState,
}

#[derive(Default)]
pub(crate) struct RequestCancellation {
    pub(crate) cancelled: AtomicBool,
    notify: Notify,
}

impl RequestCancellation {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    pub(crate) async fn wait(&self) {
        let notified = self.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if self.cancelled.load(Ordering::Acquire) {
            return;
        }
        notified.await;
    }
}

impl SemanticConnection {
    pub(crate) fn new() -> Self {
        Self {
            client_id: Uuid::new_v4().simple().to_string(),
            session_epoch: Uuid::new_v4().as_u128() as u64,
            inner: Arc::new(Mutex::new(ConnectionInner {
                epoch: 1,
                workspace_generation: 0,
                workspace_epoch: 0,
                profile_id: None,
                project_id: None,
                trust: None,
                documents: HashMap::new(),
                document_bytes: 0,
                inflight: HashMap::new(),
                closed: false,
            })),
            closed: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn client_close_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.closed)
    }

    pub(crate) fn session_epoch(&self) -> u64 {
        self.session_epoch
    }

    pub(crate) async fn close(&self) {
        self.closed.store(true, Ordering::Release);
        let cancellations = {
            let mut inner = self.inner.lock().await;
            inner.closed = true;
            inner
                .inflight
                .drain()
                .map(|(_, request)| request.cancel)
                .collect::<Vec<_>>()
        };
        cancel_all(cancellations);
    }

    pub(crate) async fn same_project(
        &self,
        profile_id: &str,
        project_id: &str,
        workspace_generation: u64,
        workspace_epoch: u64,
        policy_revision: u64,
    ) -> bool {
        if self.closed.load(Ordering::Acquire) {
            return false;
        }
        let inner = self.inner.lock().await;
        !inner.closed
            && inner.profile_id.as_deref() == Some(profile_id)
            && inner.project_id.as_deref() == Some(project_id)
            && inner.workspace_generation == workspace_generation
            && inner.workspace_epoch == workspace_epoch
            && inner
                .trust
                .as_ref()
                .is_some_and(|trust| trust.policy_revision == policy_revision)
    }

    pub(crate) async fn select_project(
        &self,
        profile_id: String,
        project_id: String,
        workspace_generation: u64,
        workspace_epoch: u64,
        trust: SemanticTrustState,
    ) {
        let cancellations = {
            let mut inner = self.inner.lock().await;
            inner.epoch = inner.epoch.saturating_add(1);
            inner.workspace_generation = workspace_generation;
            inner.workspace_epoch = workspace_epoch;
            inner.profile_id = Some(profile_id);
            inner.project_id = Some(project_id);
            inner.trust = Some(trust);
            inner.documents.clear();
            inner.document_bytes = 0;
            inner
                .inflight
                .drain()
                .map(|(_, request)| request.cancel)
                .collect::<Vec<_>>()
        };
        cancel_all(cancellations);
    }

    pub(crate) async fn current_context(&self) -> Option<ConnectionContext> {
        let inner = self.inner.lock().await;
        if inner.closed {
            return None;
        }
        Some(ConnectionContext {
            epoch: inner.epoch,
            workspace_generation: inner.workspace_generation,
            workspace_epoch: inner.workspace_epoch,
            profile_id: inner.profile_id.clone()?,
            project_id: inner.project_id.clone()?,
            trust: inner.trust.clone()?,
        })
    }

    pub(crate) async fn context_for(
        &self,
        uri: &SemanticUri,
    ) -> Result<ConnectionContext, SemanticTransportErrorCode> {
        let inner = self.inner.lock().await;
        if inner.closed {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        }
        let Some(profile_id) = inner.profile_id.clone() else {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        };
        let Some(project_id) = inner.project_id.clone() else {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        };
        let Some(trust) = inner.trust.clone() else {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        };
        if profile_id != uri.profile_id {
            return Err(SemanticTransportErrorCode::ProfileMismatch);
        }
        if project_id != uri.project_id {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        }
        Ok(ConnectionContext {
            epoch: inner.epoch,
            workspace_generation: inner.workspace_generation,
            workspace_epoch: inner.workspace_epoch,
            profile_id,
            project_id,
            trust,
        })
    }

    pub(crate) async fn upsert_document(
        &self,
        document: DocumentRecord,
        opening: bool,
    ) -> Result<(), SemanticTransportErrorCode> {
        self.replace_document(document, opening).await.map(|_| ())
    }

    pub(crate) async fn replace_document(
        &self,
        document: DocumentRecord,
        opening: bool,
    ) -> Result<Option<DocumentRecord>, SemanticTransportErrorCode> {
        let mut inner = self.inner.lock().await;
        if inner.closed {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        }
        if inner.profile_id.as_deref() != Some(&document.uri.profile_id)
            || inner.project_id.as_deref() != Some(&document.uri.project_id)
        {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        }
        let key = document_key(&document.uri);
        if inner.documents.len() >= MAX_OPEN_DOCUMENTS && !inner.documents.contains_key(&key) {
            return Err(SemanticTransportErrorCode::InternalUnavailable);
        }
        let old_bytes = inner
            .documents
            .get(&key)
            .map(|old| old.text.len())
            .unwrap_or_default();
        let old = inner.documents.get(&key);
        if opening == old.is_some() || old.is_some_and(|old| old.version >= document.version) {
            return Err(SemanticTransportErrorCode::StaleDocument);
        }
        let next_bytes = inner
            .document_bytes
            .saturating_sub(old_bytes)
            .saturating_add(document.text.len());
        if next_bytes > MAX_TOTAL_DOCUMENT_BYTES {
            return Err(SemanticTransportErrorCode::InternalUnavailable);
        }
        let previous = inner.documents.insert(key, document);
        inner.document_bytes = next_bytes;
        Ok(previous)
    }

    pub(crate) async fn restore_document(
        &self,
        uri: &SemanticUri,
        expected_version: u64,
        previous: Option<DocumentRecord>,
    ) {
        let mut inner = self.inner.lock().await;
        if inner.closed {
            return;
        }
        if inner
            .documents
            .get(&document_key(uri))
            .is_none_or(|document| document.version != expected_version)
        {
            return;
        }
        let current_bytes = inner
            .documents
            .get(&document_key(uri))
            .map(|document| document.text.len())
            .unwrap_or_default();
        match previous {
            Some(document) => {
                inner.document_bytes = inner
                    .document_bytes
                    .saturating_sub(current_bytes)
                    .saturating_add(document.text.len());
                inner.documents.insert(document_key(uri), document);
            }
            None => {
                inner.document_bytes = inner.document_bytes.saturating_sub(current_bytes);
                inner.documents.remove(&document_key(uri));
            }
        }
    }

    pub(crate) async fn remove_document(
        &self,
        uri: &SemanticUri,
        version: u64,
    ) -> Result<bool, SemanticTransportErrorCode> {
        let mut inner = self.inner.lock().await;
        if inner.closed {
            return Err(SemanticTransportErrorCode::ProjectMismatch);
        }
        if inner
            .documents
            .get(&document_key(uri))
            .is_some_and(|document| document.version > version)
        {
            return Err(SemanticTransportErrorCode::StaleDocument);
        }
        let removed = inner.documents.remove(&document_key(uri));
        if let Some(document) = &removed {
            inner.document_bytes = inner.document_bytes.saturating_sub(document.text.len());
        }
        Ok(removed.is_some())
    }

    pub(crate) async fn documents(&self, language: SemanticLanguage) -> Vec<DocumentRecord> {
        let inner = self.inner.lock().await;
        let Some(profile_id) = inner.profile_id.as_deref() else {
            return Vec::new();
        };
        let Some(project_id) = inner.project_id.as_deref() else {
            return Vec::new();
        };
        inner
            .documents
            .values()
            .filter(|document| {
                document.uri.profile_id == profile_id
                    && document.uri.project_id == project_id
                    && document.uri.language == language
            })
            .cloned()
            .collect()
    }

    pub(crate) async fn document(&self, uri: &SemanticUri) -> Option<DocumentRecord> {
        self.inner
            .lock()
            .await
            .documents
            .get(&document_key(uri))
            .cloned()
    }

    pub(crate) async fn selection_is_current(&self, context: &ConnectionContext) -> bool {
        let inner = self.inner.lock().await;
        !inner.closed
            && inner.epoch == context.epoch
            && inner.workspace_generation == context.workspace_generation
            && inner.workspace_epoch == context.workspace_epoch
            && inner.profile_id.as_deref() == Some(&context.profile_id)
            && inner.project_id.as_deref() == Some(&context.project_id)
            && inner
                .trust
                .as_ref()
                .is_some_and(|trust| trust.policy_revision == context.trust.policy_revision)
    }

    pub(crate) async fn is_current(
        &self,
        context: &ConnectionContext,
        uri: &SemanticUri,
        version: u64,
    ) -> bool {
        let inner = self.inner.lock().await;
        !inner.closed
            && inner.epoch == context.epoch
            && inner.workspace_generation == context.workspace_generation
            && inner.workspace_epoch == context.workspace_epoch
            && inner.profile_id.as_deref() == Some(&context.profile_id)
            && inner.project_id.as_deref() == Some(&context.project_id)
            && inner
                .trust
                .as_ref()
                .is_some_and(|trust| trust.policy_revision == context.trust.policy_revision)
            && inner.profile_id.as_deref() == Some(&uri.profile_id)
            && inner.project_id.as_deref() == Some(&uri.project_id)
            && inner
                .documents
                .get(&document_key(uri))
                .is_some_and(|document| document.version == version)
    }

    pub(crate) async fn add_request(
        &self,
        request_id: String,
        document_version: u64,
        cancel: Arc<RequestCancellation>,
    ) -> bool {
        let mut inner = self.inner.lock().await;
        if inner.closed {
            return false;
        }
        if inner.inflight.len() >= MAX_INFLIGHT_REQUESTS || inner.inflight.contains_key(&request_id)
        {
            return false;
        }
        inner.inflight.insert(
            request_id,
            InflightRequest {
                document_version,
                cancel,
            },
        );
        true
    }

    pub(crate) async fn cancel_request(&self, request_id: &str, document_version: u64) -> bool {
        let inner = self.inner.lock().await;
        let Some(request) = inner
            .inflight
            .get(request_id)
            .filter(|request| request.document_version == document_version)
        else {
            return false;
        };
        request.cancel.cancel();
        true
    }

    pub(crate) async fn try_send_if_current(
        &self,
        context: &ConnectionContext,
        uri: &SemanticUri,
        version: u64,
        cancel: Option<&RequestCancellation>,
        allow_cancelled: bool,
        message: OutboundMessage,
    ) -> bool {
        if self.closed.load(Ordering::Acquire) {
            return false;
        }
        let inner = self.inner.lock().await;
        if inner.closed
            || cancel
                .is_some_and(|cancel| !allow_cancelled && cancel.cancelled.load(Ordering::Acquire))
            || inner.epoch != context.epoch
            || inner.workspace_generation != context.workspace_generation
            || inner.workspace_epoch != context.workspace_epoch
            || inner.profile_id.as_deref() != Some(&context.profile_id)
            || inner.project_id.as_deref() != Some(&context.project_id)
            || inner
                .trust
                .as_ref()
                .is_none_or(|trust| trust.policy_revision != context.trust.policy_revision)
            || inner.profile_id.as_deref() != Some(&uri.profile_id)
            || inner.project_id.as_deref() != Some(&uri.project_id)
            || inner
                .documents
                .get(&document_key(uri))
                .is_none_or(|document| document.version != version)
        {
            return false;
        }
        message.out_tx.try_send(message.json).is_ok()
    }

    pub(crate) async fn try_send_if_selection_current(
        &self,
        context: &ConnectionContext,
        out_tx: &mpsc::Sender<String>,
        json: String,
    ) -> bool {
        if self.closed.load(Ordering::Acquire) {
            return false;
        }
        let inner = self.inner.lock().await;
        if inner.closed
            || inner.epoch != context.epoch
            || inner.workspace_generation != context.workspace_generation
            || inner.workspace_epoch != context.workspace_epoch
            || inner.profile_id.as_deref() != Some(&context.profile_id)
            || inner.project_id.as_deref() != Some(&context.project_id)
            || inner
                .trust
                .as_ref()
                .is_none_or(|trust| trust.policy_revision != context.trust.policy_revision)
        {
            return false;
        }
        out_tx.try_send(json).is_ok()
    }

    pub(crate) async fn try_send_batch_if_selection_current(
        &self,
        context: &ConnectionContext,
        out_tx: &mpsc::Sender<String>,
        messages: Vec<String>,
    ) -> bool {
        if self.closed.load(Ordering::Acquire) {
            return false;
        }
        let inner = self.inner.lock().await;
        if inner.closed
            || inner.epoch != context.epoch
            || inner.workspace_generation != context.workspace_generation
            || inner.workspace_epoch != context.workspace_epoch
            || inner.profile_id.as_deref() != Some(&context.profile_id)
            || inner.project_id.as_deref() != Some(&context.project_id)
            || inner
                .trust
                .as_ref()
                .is_none_or(|trust| trust.policy_revision != context.trust.policy_revision)
        {
            return false;
        }
        let mut permits = match out_tx.try_reserve_many(messages.len()) {
            Ok(permits) => permits,
            Err(_) => return false,
        };
        for json in messages {
            let Some(permit) = permits.next() else {
                return false;
            };
            permit.send(json);
        }
        true
    }

    pub(crate) async fn finish_request(&self, request_id: &str, cancel: &Arc<RequestCancellation>) {
        let mut inner = self.inner.lock().await;
        if inner
            .inflight
            .get(request_id)
            .is_some_and(|request| Arc::ptr_eq(&request.cancel, cancel))
        {
            inner.inflight.remove(request_id);
        }
    }

    pub(crate) async fn invalidate_policy(
        &self,
        project_id: &str,
        trust: SemanticTrustState,
        generation: u64,
    ) {
        let cancellations = {
            let mut inner = self.inner.lock().await;
            if inner.project_id.as_deref() != Some(project_id) {
                return;
            }
            inner.epoch = inner.epoch.saturating_add(1);
            inner.workspace_generation = generation;
            if trust.trust == crate::semantic::trust::SemanticTrust::Revoked {
                inner.documents.clear();
                inner.document_bytes = 0;
            }
            inner.trust = Some(trust);
            inner
                .inflight
                .drain()
                .map(|(_, request)| request.cancel)
                .collect::<Vec<_>>()
        };
        cancel_all(cancellations);
    }

    pub(crate) async fn invalidate_workspace(
        &self,
        workspace_generation: u64,
        workspace_epoch: u64,
    ) {
        let cancellations = {
            let mut inner = self.inner.lock().await;
            inner.epoch = inner.epoch.saturating_add(1);
            inner.workspace_generation = workspace_generation;
            inner.workspace_epoch = workspace_epoch;
            inner.profile_id = None;
            inner.project_id = None;
            inner.trust = None;
            inner.documents.clear();
            inner.document_bytes = 0;
            inner
                .inflight
                .drain()
                .map(|(_, request)| request.cancel)
                .collect::<Vec<_>>()
        };
        cancel_all(cancellations);
    }
}

fn document_key(uri: &SemanticUri) -> DocumentKey {
    DocumentKey {
        profile_id: uri.profile_id.clone(),
        project_id: uri.project_id.clone(),
        path: uri.path.clone(),
        language: uri.language,
    }
}

fn cancel_all(cancellations: Vec<Arc<RequestCancellation>>) {
    for cancellation in cancellations {
        cancellation.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::trust::{SemanticTrust, TrustTransitionReason};

    #[tokio::test]
    async fn document_versions_are_monotonic_per_connection() {
        let connection = SemanticConnection::new();
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
        let uri = SemanticUri {
            profile_id: "profile".into(),
            project_id: "project".into(),
            path: "src/main.rs".into(),
            language: SemanticLanguage::Rust,
        };
        assert!(connection
            .upsert_document(
                DocumentRecord {
                    uri: uri.clone(),
                    resolved_path: "/project/src/main.rs".into(),
                    version: 2,
                    text: b"new".to_vec()
                },
                true,
            )
            .await
            .is_ok());
        assert_eq!(
            connection
                .upsert_document(
                    DocumentRecord {
                        uri,
                        resolved_path: "/project/src/main.rs".into(),
                        version: 1,
                        text: b"old".to_vec()
                    },
                    false
                )
                .await,
            Err(SemanticTransportErrorCode::StaleDocument)
        );
    }

    #[tokio::test]
    async fn cancellation_requires_the_matching_document_version() {
        let connection = SemanticConnection::new();
        let cancel = Arc::new(RequestCancellation::default());
        assert!(
            connection
                .add_request("request".into(), 7, Arc::clone(&cancel))
                .await
        );
        assert!(!connection.cancel_request("request", 8).await);
        assert!(!cancel.cancelled.load(Ordering::Acquire));
        assert!(connection.cancel_request("request", 7).await);
        assert!(cancel.cancelled.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn trust_invalidation_preserves_the_workspace_epoch() {
        let connection = SemanticConnection::new();
        connection
            .select_project(
                "profile".into(),
                "project".into(),
                4,
                7,
                SemanticTrustState {
                    project_id: "project".into(),
                    trust: SemanticTrust::Restricted,
                    can_transition: true,
                    transition_reason: Some(TrustTransitionReason::ConfirmationRequired),
                    policy_revision: 0,
                },
            )
            .await;
        connection
            .invalidate_policy(
                "project",
                SemanticTrustState {
                    project_id: "project".into(),
                    trust: SemanticTrust::Trusted,
                    can_transition: true,
                    transition_reason: None,
                    policy_revision: 1,
                },
                5,
            )
            .await;
        let context = connection.current_context().await.unwrap();
        assert_eq!(context.workspace_generation, 5);
        assert_eq!(context.workspace_epoch, 7);
    }

    #[tokio::test]
    async fn batch_output_does_not_enqueue_a_partial_prefix() {
        let connection = SemanticConnection::new();
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
        let context = connection.current_context().await.unwrap();
        let (out_tx, mut out_rx) = mpsc::channel(1);
        assert!(
            !connection
                .try_send_batch_if_selection_current(
                    &context,
                    &out_tx,
                    vec!["first".into(), "second".into()],
                )
                .await
        );
        assert!(out_rx.try_recv().is_err());
        assert!(
            connection
                .try_send_batch_if_selection_current(&context, &out_tx, vec!["first".into()])
                .await
        );
        assert_eq!(out_rx.recv().await.as_deref(), Some("first"));
    }
}
