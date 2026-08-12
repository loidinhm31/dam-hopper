//! Controlled stdio LSP session primitives.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex, Notify};
use tokio::task::JoinHandle;
use url::Url;

use super::bundle::VerifiedBundle;
use super::codec::{decode_frame, encode_frame, MAX_FRAME_BYTES};
use super::protocol::{
    SemanticLanguage, SemanticUri, MAX_DOCUMENT_BYTES, MAX_RESPONSE_BYTES, MAX_SEQUENCE,
};
use super::trust::InitializationPolicy;

pub const MAX_INTERACTIVE_REQUESTS: usize = 2;
pub const MAX_QUEUED_REQUESTS: usize = 32;
pub const MAX_QUEUED_REQUEST_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_CAPABILITY_KEYS: usize = 128;
const MAX_RESPONSE_QUEUE: usize = 16;
const MAX_SNAPSHOT_BYTES: usize = 5 * 1024 * 1024;
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(2);
const REQUEST_WRITE_TIMEOUT: Duration = Duration::from_millis(100);

#[derive(Clone)]
pub struct CrashNotifier {
    pending: Arc<StdMutex<HashSet<SessionKey>>>,
    sender: mpsc::UnboundedSender<SessionKey>,
}

impl CrashNotifier {
    pub fn channel() -> (Self, mpsc::UnboundedReceiver<SessionKey>) {
        let (sender, receiver) = mpsc::unbounded_channel();
        (
            Self {
                pending: Arc::new(StdMutex::new(HashSet::new())),
                sender,
            },
            receiver,
        )
    }

    fn notify(&self, key: &SessionKey) {
        let Ok(mut pending) = self.pending.lock() else {
            return;
        };
        if pending.insert(key.clone()) {
            let _ = self.sender.send(key.clone());
        }
    }

    pub fn is_pending(&self, key: &SessionKey) -> bool {
        self.pending
            .lock()
            .map(|pending| pending.contains(key))
            .unwrap_or(true)
    }

    pub(crate) fn clear(&self, key: &SessionKey) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(key);
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SessionKey {
    pub client_id: String,
    pub profile_id: String,
    pub project_id: String,
    pub descriptor_fingerprint: String,
    pub trust_policy_revision: u64,
}

impl SessionKey {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.client_id.is_empty()
            || self.profile_id.is_empty()
            || self.project_id.is_empty()
            || self.descriptor_fingerprint.is_empty()
            || self.client_id.len() > 128
            || self.profile_id.len() > 128
            || self.project_id.len() > 128
            || self.descriptor_fingerprint.len() > 256
            || self.trust_policy_revision > MAX_SEQUENCE
        {
            return Err(SessionError::InvalidKey);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentSnapshot {
    pub uri: SemanticUri,
    pub resolved_path: PathBuf,
    pub version: u64,
    pub text: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum SessionState {
    Starting = 0,
    Ready = 1,
    Crashed = 2,
    Shutdown = 3,
}

pub struct LspSession {
    pub key: SessionKey,
    pub policy: InitializationPolicy,
    language: SemanticLanguage,
    project_root: PathBuf,
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<ChildStdin>>,
    /// Serializes dispatch with shutdown so revoked sessions cannot write
    /// another request after the supervisor invalidates their policy.
    dispatch_lock: Mutex<()>,
    scheduler: Mutex<RequestScheduler>,
    response_gate: Mutex<()>,
    request_sequence: AtomicU64,
    responses: Mutex<ResponseQueue>,
    response_notify: Notify,
    snapshots: Mutex<SnapshotStore>,
    capabilities: Mutex<HashSet<String>>,
    crash_notifier: CrashNotifier,
    crash_reported: AtomicBool,
    last_activity_ms: AtomicU64,
    state: AtomicU8,
    stdout_task: Mutex<Option<JoinHandle<()>>>,
    child_monitor_task: Mutex<Option<JoinHandle<()>>>,
}

impl LspSession {
    pub async fn start(
        key: SessionKey,
        bundle: VerifiedBundle,
        project_root: PathBuf,
        policy: InitializationPolicy,
        crash_notifier: CrashNotifier,
    ) -> Result<Arc<Self>, SessionError> {
        key.validate()?;
        if !project_root.is_absolute() {
            return Err(SessionError::InvalidProjectRoot);
        }
        let mut command = Command::new(bundle.program());
        command
            .args(bundle.args())
            .current_dir(&project_root)
            .env_clear()
            .env(
                "DAM_HOPPER_SEMANTIC_POLICY",
                match policy {
                    InitializationPolicy::Restricted => "restricted",
                    InitializationPolicy::Trusted => "trusted",
                },
            )
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            tracing::debug!(error = %error, "semantic bundle process spawn failed");
            SessionError::SpawnFailed
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            tracing::debug!("semantic bundle process did not expose stdin");
            SessionError::SpawnFailed
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            tracing::debug!("semantic bundle process did not expose stdout");
            SessionError::SpawnFailed
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            tracing::debug!("semantic bundle process did not expose stderr");
            SessionError::SpawnFailed
        })?;
        spawn_stderr_drain(stderr);
        let session = Arc::new(Self {
            key,
            policy,
            language: bundle.language(),
            project_root,
            child: Arc::new(Mutex::new(Some(child))),
            stdin: Arc::new(Mutex::new(stdin)),
            dispatch_lock: Mutex::new(()),
            scheduler: Mutex::new(RequestScheduler::default()),
            response_gate: Mutex::new(()),
            request_sequence: AtomicU64::new(1),
            responses: Mutex::new(ResponseQueue::default()),
            response_notify: Notify::new(),
            snapshots: Mutex::new(SnapshotStore::default()),
            capabilities: Mutex::new(HashSet::new()),
            crash_notifier,
            crash_reported: AtomicBool::new(false),
            last_activity_ms: AtomicU64::new(now_ms()),
            state: AtomicU8::new(SessionState::Starting as u8),
            stdout_task: Mutex::new(None),
            child_monitor_task: Mutex::new(None),
        });
        let stdout_task = spawn_stdout_drain(&session, stdout);
        *session.stdout_task.lock().await = Some(stdout_task);
        let child_monitor_task = spawn_child_monitor(&session);
        *session.child_monitor_task.lock().await = Some(child_monitor_task);
        if let Err(error) = session.initialize().await {
            session.shutdown().await;
            return Err(error);
        }
        session
            .state
            .store(SessionState::Ready as u8, Ordering::Release);
        Ok(session)
    }

    async fn initialize(&self) -> Result<(), SessionError> {
        let initialize = initialization_message(self.policy, self.language);
        let frame = encode_frame(&initialize).map_err(|_| SessionError::FrameTooLarge)?;
        self.write_request_frame(&frame)
            .await
            .map_err(|_| SessionError::InitializationFailed)?;
        let response = tokio::time::timeout(INITIALIZE_TIMEOUT, self.wait_for_response())
            .await
            .map_err(|_| SessionError::InitializationTimeout)??;
        let result = response
            .get("result")
            .ok_or(SessionError::InitializationFailed)?;
        self.negotiate_capabilities(result).await?;
        let initialized = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        });
        let frame = encode_frame(&initialized).map_err(|_| SessionError::FrameTooLarge)?;
        self.write_request_frame(&frame)
            .await
            .map_err(|_| SessionError::InitializationFailed)
    }

    async fn wait_for_response(&self) -> Result<Value, SessionError> {
        loop {
            let notified = self.response_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.state() == SessionState::Crashed {
                return Err(SessionError::InitializationFailed);
            }
            if let Some(value) = self.next_response().await {
                if value.get("id") == Some(&Value::String("dam-hopper-initialize".into()))
                    && value.get("jsonrpc") == Some(&Value::String("2.0".into()))
                {
                    if value.get("error").is_some() {
                        return Err(SessionError::InitializationFailed);
                    }
                    return Ok(value);
                }
                continue;
            }
            notified.await;
        }
    }

    pub fn state(&self) -> SessionState {
        match self.state.load(Ordering::Acquire) {
            1 => SessionState::Ready,
            2 => SessionState::Crashed,
            3 => SessionState::Shutdown,
            _ => SessionState::Starting,
        }
    }

    pub fn is_idle(&self, now: u64, grace_ms: u64) -> bool {
        now.saturating_sub(self.last_activity_ms.load(Ordering::Acquire)) >= grace_ms
    }

    pub fn last_activity_ms(&self) -> u64 {
        self.last_activity_ms.load(Ordering::Acquire)
    }

    pub async fn try_admit(&self, request_id: &str) -> Result<RequestAdmission, SessionError> {
        let _dispatch = self.dispatch_lock.lock().await;
        let admission = self.admit_request(request_id, Vec::new()).await?;
        if admission.queued {
            let _ = self.scheduler.lock().await.cancel(request_id);
            return Err(SessionError::QueueRequiresPayload);
        }
        Ok(admission)
    }

    async fn admit_request(
        &self,
        request_id: &str,
        frame: Vec<u8>,
    ) -> Result<RequestAdmission, SessionError> {
        if self.state() != SessionState::Ready {
            return Err(SessionError::NotReady);
        }
        if request_id.is_empty() || request_id.len() > 128 {
            return Err(SessionError::InvalidRequestId);
        }
        let mut scheduler = self.scheduler.lock().await;
        let admission = scheduler.admit(request_id, frame)?;
        self.last_activity_ms.store(now_ms(), Ordering::Release);
        Ok(admission)
    }

    pub async fn send_request(
        &self,
        request_id: &str,
        value: &Value,
    ) -> Result<RequestAdmission, SessionError> {
        let _dispatch = self.dispatch_lock.lock().await;
        let frame = encode_frame(value).map_err(|_| SessionError::FrameTooLarge)?;
        let admission = self.admit_request(request_id, frame.clone()).await?;
        if admission.queued {
            return Ok(admission);
        }
        if self.write_request_frame(&frame).await.is_err() {
            self.cancel_request_inner(request_id).await;
            self.report_crash();
            return Err(SessionError::WriteFailed);
        }
        Ok(admission)
    }

    pub async fn complete_request(&self, request_id: &str) -> bool {
        let _dispatch = self.dispatch_lock.lock().await;
        let (completed, next) = self.scheduler.lock().await.complete(request_id);
        if let Some(next) = next {
            if !next.frame.is_empty() && self.write_request_frame(&next.frame).await.is_err() {
                self.report_crash();
            }
        }
        completed
    }

    pub async fn next_response(&self) -> Option<Value> {
        let _dispatch = self.dispatch_lock.lock().await;
        if self.state() == SessionState::Shutdown {
            return None;
        }
        let mut responses = self.responses.lock().await;
        let (value, bytes) = responses.items.pop_front()?;
        responses.bytes = responses.bytes.saturating_sub(bytes);
        Some(value)
    }

    pub async fn cancel_request(&self, request_id: &str) -> bool {
        let _dispatch = self.dispatch_lock.lock().await;
        self.cancel_request_inner(request_id).await
    }

    async fn write_request_frame(&self, frame: &[u8]) -> Result<(), SessionError> {
        tokio::time::timeout(REQUEST_WRITE_TIMEOUT, async {
            self.stdin.lock().await.write_all(frame).await
        })
        .await
        .map_err(|_| SessionError::WriteFailed)?
        .map_err(|_| SessionError::WriteFailed)
    }

    async fn cancel_request_inner(&self, request_id: &str) -> bool {
        let was_active = self.scheduler.lock().await.active.contains(request_id);
        let (cancelled, next) = self.scheduler.lock().await.cancel(request_id);
        if was_active {
            let cancel = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "$/cancelRequest",
                "params": {"id": request_id}
            });
            if self.write_notification_locked(&cancel).await.is_err() {
                self.report_crash();
            }
        }
        if let Some(next) = next {
            if !next.frame.is_empty() && self.write_request_frame(&next.frame).await.is_err() {
                self.report_crash();
            }
        }
        cancelled
    }

    pub async fn sync_document(
        &self,
        uri: SemanticUri,
        resolved_path: PathBuf,
        version: u64,
        text: Vec<u8>,
    ) -> Result<(), SessionError> {
        let text = String::from_utf8(text).map_err(|_| SessionError::InvalidDocument)?;
        let _dispatch = self.dispatch_lock.lock().await;
        if self.state() != SessionState::Ready {
            return Err(SessionError::NotReady);
        }
        if uri.profile_id != self.key.profile_id
            || uri.project_id != self.key.project_id
            || uri.language != self.language
        {
            return Err(SessionError::InvalidDocument);
        }
        uri.validate().map_err(|_| SessionError::InvalidDocument)?;
        if version > MAX_SEQUENCE || text.len() > MAX_DOCUMENT_BYTES as usize {
            return Err(SessionError::DocumentLimitExceeded);
        }
        let key = snapshot_key(&uri);
        let old = {
            let snapshots = self.snapshots.lock().await;
            snapshots.items.get(&key).cloned()
        };
        if old
            .as_ref()
            .is_some_and(|snapshot| snapshot.version >= version)
        {
            return Err(SessionError::StaleDocument);
        }
        let old_bytes = old
            .as_ref()
            .map(|snapshot| snapshot.text.len())
            .unwrap_or_default();
        let snapshots = self.snapshots.lock().await;
        let next_bytes = snapshots
            .bytes
            .saturating_sub(old_bytes)
            .saturating_add(text.len());
        if next_bytes > MAX_SNAPSHOT_BYTES {
            return Err(SessionError::DocumentLimitExceeded);
        }
        let resolved_path = self.canonical_document_path(&resolved_path)?;
        if old
            .as_ref()
            .is_some_and(|snapshot| snapshot.resolved_path != resolved_path)
        {
            return Err(SessionError::StaleDocument);
        }
        let internal_uri = self.internal_uri(&resolved_path)?;
        let snapshot_text = text.clone();
        let message = if old.is_some() {
            serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didChange",
                "params": {
                    "textDocument": {"uri": internal_uri, "version": version},
                    "contentChanges": [{"text": text}]
                }
            })
        } else {
            serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": {
                    "textDocument": {
                        "uri": internal_uri,
                        "languageId": language_id(self.language),
                        "version": version,
                        "text": text
                    }
                }
            })
        };
        drop(snapshots);
        self.write_notification_locked(&message).await?;
        let mut snapshots = self.snapshots.lock().await;
        snapshots.items.insert(
            key,
            DocumentSnapshot {
                uri,
                resolved_path,
                version,
                text: snapshot_text.into_bytes(),
            },
        );
        snapshots.bytes = next_bytes;
        self.last_activity_ms.store(now_ms(), Ordering::Release);
        Ok(())
    }

    pub async fn close_document(&self, uri: SemanticUri, version: u64) -> Result<(), SessionError> {
        let _dispatch = self.dispatch_lock.lock().await;
        if self.state() != SessionState::Ready {
            return Err(SessionError::NotReady);
        }
        if uri.profile_id != self.key.profile_id
            || uri.project_id != self.key.project_id
            || uri.language != self.language
        {
            return Err(SessionError::InvalidDocument);
        }
        uri.validate().map_err(|_| SessionError::InvalidDocument)?;
        let key = snapshot_key(&uri);
        let snapshot = {
            let snapshots = self.snapshots.lock().await;
            if snapshots
                .items
                .get(&key)
                .is_some_and(|old| old.version > version)
            {
                return Err(SessionError::StaleDocument);
            }
            snapshots.items.get(&key).cloned()
        };
        if let Some(snapshot) = snapshot {
            let resolved_path = self.canonical_document_path(&snapshot.resolved_path)?;
            let message = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didClose",
                "params": {"textDocument": {"uri": self.internal_uri(&resolved_path)?}}
            });
            self.write_notification_locked(&message).await?;
            let mut snapshots = self.snapshots.lock().await;
            if let Some(old) = snapshots.items.remove(&key) {
                snapshots.bytes = snapshots.bytes.saturating_sub(old.text.len());
            }
        }
        self.last_activity_ms.store(now_ms(), Ordering::Release);
        Ok(())
    }

    pub async fn request(
        &self,
        request_id: &str,
        value: &Value,
        deadline: Duration,
    ) -> Result<Value, SessionError> {
        let _response_gate = self.response_gate.lock().await;
        self.send_request(request_id, value).await?;
        match tokio::time::timeout(deadline, self.wait_for_request_response(request_id)).await {
            Ok(result) => {
                self.complete_request(request_id).await;
                result
            }
            Err(_) => {
                self.cancel_request(request_id).await;
                Err(SessionError::RequestTimeout)
            }
        }
    }

    async fn wait_for_request_response(&self, request_id: &str) -> Result<Value, SessionError> {
        loop {
            let notified = self.response_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if matches!(self.state(), SessionState::Crashed | SessionState::Shutdown) {
                return Err(SessionError::NotReady);
            }
            if let Some(value) = self.next_response().await {
                if value.get("id") == Some(&Value::String(request_id.to_owned())) {
                    return Ok(value);
                }
                continue;
            }
            notified.await;
        }
    }

    fn canonical_document_path(&self, path: &std::path::Path) -> Result<PathBuf, SessionError> {
        let canonical = match std::fs::canonicalize(path) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let parent = path.parent().ok_or(SessionError::InvalidDocument)?;
                let name = path.file_name().ok_or(SessionError::InvalidDocument)?;
                parent
                    .canonicalize()
                    .map_err(|_| SessionError::InvalidDocument)?
                    .join(name)
            }
            Err(_) => return Err(SessionError::InvalidDocument),
        };
        if !canonical.starts_with(&self.project_root) {
            return Err(SessionError::InvalidDocument);
        }
        match std::fs::metadata(&canonical) {
            Ok(metadata) if metadata.is_file() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) | Err(_) => return Err(SessionError::InvalidDocument),
        }
        Ok(canonical)
    }

    fn internal_uri(&self, path: &std::path::Path) -> Result<String, SessionError> {
        Url::from_file_path(path)
            .map(|value| value.to_string())
            .map_err(|_| SessionError::InvalidDocument)
    }

    async fn write_notification_locked(&self, value: &Value) -> Result<(), SessionError> {
        let frame = encode_frame(value).map_err(|_| SessionError::FrameTooLarge)?;
        self.write_request_frame(&frame).await
    }

    pub fn next_request_id(&self) -> String {
        let sequence = self.request_sequence.fetch_add(1, Ordering::Relaxed);
        format!("dh-{}-{}", self.key.client_id, sequence)
    }

    pub async fn snapshot(&self, uri: &SemanticUri) -> Option<DocumentSnapshot> {
        self.snapshots
            .lock()
            .await
            .items
            .get(&snapshot_key(uri))
            .cloned()
    }

    pub async fn negotiate_capabilities(&self, value: &Value) -> Result<(), SessionError> {
        let object = value
            .get("capabilities")
            .and_then(Value::as_object)
            .ok_or(SessionError::InvalidCapabilities)?;
        if object.len() > MAX_CAPABILITY_KEYS {
            return Err(SessionError::InvalidCapabilities);
        }
        let mut capabilities = self.capabilities.lock().await;
        capabilities.clear();
        for (key, value) in object {
            if key.len() > 128
                || !key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
            {
                return Err(SessionError::InvalidCapabilities);
            }
            if value.is_boolean() || value.is_object() {
                capabilities.insert(key.clone());
            }
        }
        Ok(())
    }

    pub async fn shutdown(&self) {
        let _dispatch = self.dispatch_lock.lock().await;
        self.state
            .store(SessionState::Shutdown as u8, Ordering::Release);
        self.response_notify.notify_waiters();
        let mut responses = self.responses.lock().await;
        responses.items.clear();
        responses.bytes = 0;
        drop(responses);
        self.terminate_process().await;
        self.abort_io_tasks().await;
    }

    pub(crate) async fn cleanup_after_crash(&self) {
        let _dispatch = self.dispatch_lock.lock().await;
        self.terminate_process().await;
        self.abort_io_tasks().await;
    }

    async fn terminate_process(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    async fn abort_io_tasks(&self) {
        if let Some(task) = self.stdout_task.lock().await.take() {
            task.abort();
            let _ = task.await;
        }
        if let Some(task) = self.child_monitor_task.lock().await.take() {
            task.abort();
            let _ = task.await;
        }
    }

    fn report_crash(&self) {
        if self.state() == SessionState::Shutdown {
            return;
        }
        self.state
            .store(SessionState::Crashed as u8, Ordering::Release);
        self.response_notify.notify_waiters();
        if !self.crash_reported.swap(true, Ordering::AcqRel) {
            self.crash_notifier.notify(&self.key);
        }
    }
}

#[derive(Default)]
struct ResponseQueue {
    items: VecDeque<(Value, usize)>,
    bytes: usize,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SnapshotKey {
    profile_id: String,
    project_id: String,
    path: String,
    language: SemanticLanguage,
}

#[derive(Default)]
struct SnapshotStore {
    items: HashMap<SnapshotKey, DocumentSnapshot>,
    bytes: usize,
}

fn snapshot_key(uri: &SemanticUri) -> SnapshotKey {
    SnapshotKey {
        profile_id: uri.profile_id.clone(),
        project_id: uri.project_id.clone(),
        path: uri.path.clone(),
        language: uri.language,
    }
}

fn language_id(language: SemanticLanguage) -> &'static str {
    match language {
        SemanticLanguage::Rust => "rust",
        SemanticLanguage::Typescript => "typescript",
        SemanticLanguage::Javascript => "javascript",
        SemanticLanguage::Java => "java",
    }
}

fn initialization_message(policy: InitializationPolicy, language: SemanticLanguage) -> Value {
    let options = policy.options();
    let initialization_options = match language {
        SemanticLanguage::Rust => serde_json::json!({
            "cargo": {
                "buildScripts": {"enable": options.allow_build_scripts}
            },
            "procMacro": {"enable": options.allow_build_tooling}
        }),
        SemanticLanguage::Typescript | SemanticLanguage::Javascript => serde_json::json!({
            "plugins": [],
            "allowLocalPluginLoads": options.allow_workspace_plugins,
            "disableAutomaticTypingAcquisition": true
        }),
        SemanticLanguage::Java => serde_json::json!({
            "configuration": {"updateBuildConfiguration": "disabled"},
            "import": {
                "gradle": {"enabled": false},
                "maven": {"enabled": false}
            }
        }),
    };
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": "dam-hopper-initialize",
        "method": "initialize",
        "params": {
            "processId": Value::Null,
            "rootUri": Value::Null,
            "capabilities": {},
            "initializationOptions": initialization_options,
            "damHopperPolicy": {
                "allowBuildScripts": options.allow_build_scripts,
                "allowWorkspacePlugins": options.allow_workspace_plugins,
                "allowBuildTooling": options.allow_build_tooling
            }
        }
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestAdmission {
    pub queued: bool,
}

#[derive(Default)]
struct RequestScheduler {
    active: HashSet<String>,
    queued: VecDeque<QueuedRequest>,
    queued_bytes: usize,
}

struct QueuedRequest {
    request_id: String,
    frame: Vec<u8>,
}

impl RequestScheduler {
    fn admit(
        &mut self,
        request_id: &str,
        frame: Vec<u8>,
    ) -> Result<RequestAdmission, SessionError> {
        if self.active.contains(request_id)
            || self
                .queued
                .iter()
                .any(|request| request.request_id == request_id)
        {
            return Err(SessionError::DuplicateRequest);
        }
        if self.active.len() < MAX_INTERACTIVE_REQUESTS {
            self.active.insert(request_id.to_string());
            Ok(RequestAdmission { queued: false })
        } else if self.queued.len() < MAX_QUEUED_REQUESTS {
            if self.queued_bytes.saturating_add(frame.len()) > MAX_QUEUED_REQUEST_BYTES {
                return Err(SessionError::QueueMemoryFull);
            }
            self.queued_bytes = self.queued_bytes.saturating_add(frame.len());
            self.queued.push_back(QueuedRequest {
                request_id: request_id.to_string(),
                frame,
            });
            Ok(RequestAdmission { queued: true })
        } else {
            Err(SessionError::QueueFull)
        }
    }

    fn complete(&mut self, request_id: &str) -> (bool, Option<QueuedRequest>) {
        if !self.active.remove(request_id) {
            return (false, None);
        }
        let next = self.queued.pop_front();
        if let Some(next) = &next {
            self.queued_bytes = self.queued_bytes.saturating_sub(next.frame.len());
            self.active.insert(next.request_id.clone());
        }
        (true, next)
    }

    fn cancel(&mut self, request_id: &str) -> (bool, Option<QueuedRequest>) {
        if self.active.remove(request_id) {
            let next = self.queued.pop_front();
            if let Some(next) = &next {
                self.queued_bytes = self.queued_bytes.saturating_sub(next.frame.len());
                self.active.insert(next.request_id.clone());
            }
            return (true, next);
        }
        let Some(index) = self
            .queued
            .iter()
            .position(|request| request.request_id == request_id)
        else {
            return (false, None);
        };
        let removed = self.queued.remove(index).expect("queued index exists");
        self.queued_bytes = self.queued_bytes.saturating_sub(removed.frame.len());
        (true, None)
    }
}

fn spawn_stdout_drain(
    session: &Arc<LspSession>,
    mut stdout: tokio::process::ChildStdout,
) -> JoinHandle<()> {
    let weak = Arc::downgrade(session);
    tokio::spawn(async move {
        let mut buffer = Vec::with_capacity(MAX_FRAME_BYTES.min(64 * 1024));
        let mut chunk = [0u8; 16 * 1024];
        loop {
            let read = match stdout.read(&mut chunk).await {
                Ok(0) | Err(_) => {
                    if let Some(session) = weak.upgrade() {
                        session.report_crash();
                    }
                    return;
                }
                Ok(read) => read,
            };
            buffer.extend_from_slice(&chunk[..read]);
            loop {
                match decode_frame(&buffer) {
                    Ok(Some((value, consumed))) => {
                        buffer.drain(..consumed);
                        let Some(session) = weak.upgrade() else {
                            return;
                        };
                        let response_bytes = match serde_json::to_vec(&value) {
                            Ok(bytes) => bytes.len(),
                            Err(_) => {
                                session.report_crash();
                                return;
                            }
                        };
                        let mut responses = session.responses.lock().await;
                        if responses.items.len() == MAX_RESPONSE_QUEUE
                            || responses.bytes.saturating_add(response_bytes) > MAX_RESPONSE_BYTES
                        {
                            drop(responses);
                            session.report_crash();
                            return;
                        }
                        responses.bytes = responses.bytes.saturating_add(response_bytes);
                        responses.items.push_back((value, response_bytes));
                        session.response_notify.notify_one();
                    }
                    Ok(None) => break,
                    Err(_) => {
                        if let Some(session) = weak.upgrade() {
                            session.report_crash();
                        }
                        return;
                    }
                }
            }
            if buffer.len() > MAX_FRAME_BYTES {
                if let Some(session) = weak.upgrade() {
                    session.report_crash();
                }
                return;
            }
        }
    })
}

fn spawn_stderr_drain(mut stderr: tokio::process::ChildStderr) {
    tokio::spawn(async move {
        let mut buffer = [0u8; 16 * 1024];
        while stderr
            .read(&mut buffer)
            .await
            .ok()
            .filter(|size| *size > 0)
            .is_some()
        {}
    });
}

fn spawn_child_monitor(session: &Arc<LspSession>) -> JoinHandle<()> {
    let weak = Arc::downgrade(session);
    tokio::spawn(async move {
        loop {
            let Some(session) = weak.upgrade() else {
                return;
            };
            let exited = {
                let mut child = session.child.lock().await;
                let Some(child) = child.as_mut() else {
                    return;
                };
                match child.try_wait() {
                    Ok(Some(_)) | Err(_) => true,
                    Ok(None) => false,
                }
            };
            if exited {
                session.report_crash();
                return;
            }
            drop(session);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("session key is invalid")]
    InvalidKey,
    #[error("project root must be absolute")]
    InvalidProjectRoot,
    #[error("LSP process could not be started")]
    SpawnFailed,
    #[error("LSP process initialization failed")]
    InitializationFailed,
    #[error("LSP initialize response timed out")]
    InitializationTimeout,
    #[error("LSP session is not ready")]
    NotReady,
    #[error("request id is invalid")]
    InvalidRequestId,
    #[error("request is already active or queued")]
    DuplicateRequest,
    #[error("LSP request timed out")]
    RequestTimeout,
    #[error("interactive request queue is full")]
    QueueFull,
    #[error("interactive request queue memory cap reached")]
    QueueMemoryFull,
    #[error("queued requests must be admitted through send_request")]
    QueueRequiresPayload,
    #[error("LSP frame exceeds the limit")]
    FrameTooLarge,
    #[error("LSP request write failed")]
    WriteFailed,
    #[error("document snapshot is invalid")]
    InvalidDocument,
    #[error("document snapshot exceeds the limit")]
    DocumentLimitExceeded,
    #[error("document version is stale")]
    StaleDocument,
    #[error("LSP capabilities are invalid")]
    InvalidCapabilities,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_policy_uses_fixed_trusted_deltas() {
        let restricted =
            initialization_message(InitializationPolicy::Restricted, SemanticLanguage::Rust);
        let trusted = initialization_message(InitializationPolicy::Trusted, SemanticLanguage::Rust);
        assert_eq!(
            restricted["params"]["damHopperPolicy"]["allowWorkspacePlugins"],
            false
        );
        assert_eq!(
            trusted["params"]["damHopperPolicy"]["allowWorkspacePlugins"],
            true
        );
        assert_ne!(restricted, trusted);
        assert_eq!(
            trusted["params"]["initializationOptions"]["cargo"]["buildScripts"]["enable"],
            true
        );
        let typescript = initialization_message(
            InitializationPolicy::Restricted,
            SemanticLanguage::Typescript,
        );
        assert_eq!(
            typescript["params"]["initializationOptions"]["plugins"],
            serde_json::json!([])
        );
        assert_eq!(
            typescript["params"]["initializationOptions"]["disableAutomaticTypingAcquisition"],
            true
        );
    }

    #[test]
    fn queued_request_memory_is_released_on_completion_and_cancellation() {
        let mut scheduler = RequestScheduler::default();
        scheduler.active.insert("active-1".into());
        scheduler.active.insert("active-2".into());
        let frame = vec![0; MAX_QUEUED_REQUEST_BYTES / 2];
        assert!(scheduler.admit("queued-1", frame.clone()).unwrap().queued);
        assert!(scheduler.admit("queued-2", frame).unwrap().queued);
        assert!(matches!(
            scheduler.admit("queued-3", vec![0; 1]),
            Err(SessionError::QueueMemoryFull)
        ));
        assert!(scheduler.cancel("queued-1").0);
        assert!(scheduler.admit("queued-3", vec![0; 1]).unwrap().queued);
        assert!(scheduler.complete("active-1").0);
        assert!(scheduler.queued_bytes < MAX_QUEUED_REQUEST_BYTES);
    }
}
