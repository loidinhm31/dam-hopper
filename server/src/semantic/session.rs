//! Controlled stdio LSP session primitives.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};

use super::bundle::VerifiedBundle;
use super::codec::{decode_frame, encode_frame, MAX_FRAME_BYTES};
use super::protocol::{
    SemanticLanguage, SemanticUri, MAX_DOCUMENT_BYTES, MAX_RESPONSE_BYTES, MAX_SEQUENCE,
};
use super::trust::InitializationPolicy;

pub const MAX_INTERACTIVE_REQUESTS: usize = 2;
pub const MAX_QUEUED_REQUESTS: usize = 32;
pub const MAX_CAPABILITY_KEYS: usize = 128;
const MAX_RESPONSE_QUEUE: usize = 16;
const MAX_SNAPSHOT_BYTES: usize = 5 * 1024 * 1024;

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
    pub project_id: String,
    pub descriptor_fingerprint: String,
    pub trust_policy_revision: u64,
}

impl SessionKey {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.client_id.is_empty()
            || self.project_id.is_empty()
            || self.descriptor_fingerprint.is_empty()
            || self.client_id.len() > 128
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
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<ChildStdin>>,
    scheduler: Mutex<RequestScheduler>,
    responses: Mutex<ResponseQueue>,
    snapshots: Mutex<SnapshotStore>,
    capabilities: Mutex<HashSet<String>>,
    crash_notifier: CrashNotifier,
    crash_reported: AtomicBool,
    last_activity_ms: AtomicU64,
    state: AtomicU8,
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
            .current_dir(project_root)
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
            child: Arc::new(Mutex::new(Some(child))),
            stdin: Arc::new(Mutex::new(stdin)),
            scheduler: Mutex::new(RequestScheduler::default()),
            responses: Mutex::new(ResponseQueue::default()),
            snapshots: Mutex::new(SnapshotStore::default()),
            capabilities: Mutex::new(HashSet::new()),
            crash_notifier,
            crash_reported: AtomicBool::new(false),
            last_activity_ms: AtomicU64::new(now_ms()),
            state: AtomicU8::new(SessionState::Starting as u8),
        });
        spawn_stdout_drain(&session, stdout);
        spawn_child_monitor(&session);
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
        self.stdin
            .lock()
            .await
            .write_all(&frame)
            .await
            .map_err(|_| SessionError::InitializationFailed)
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

    pub async fn try_admit(&self, request_id: &str) -> Result<RequestAdmission, SessionError> {
        let admission = self.admit_request(request_id, Vec::new()).await?;
        if admission.queued {
            let _ = self.cancel_request(request_id).await;
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
        let frame = encode_frame(value).map_err(|_| SessionError::FrameTooLarge)?;
        let admission = self.admit_request(request_id, frame.clone()).await?;
        if admission.queued {
            return Ok(admission);
        }
        let write_result = self.stdin.lock().await.write_all(&frame).await;
        if write_result.is_err() {
            self.cancel_request(request_id).await;
            self.report_crash();
            return Err(SessionError::WriteFailed);
        }
        Ok(admission)
    }

    pub async fn complete_request(&self, request_id: &str) -> bool {
        let (completed, next) = self.scheduler.lock().await.complete(request_id);
        if let Some(next) = next {
            if !next.frame.is_empty()
                && self
                    .stdin
                    .lock()
                    .await
                    .write_all(&next.frame)
                    .await
                    .is_err()
            {
                self.report_crash();
            }
        }
        completed
    }

    pub async fn next_response(&self) -> Option<Value> {
        let mut responses = self.responses.lock().await;
        let (value, bytes) = responses.items.pop_front()?;
        responses.bytes = responses.bytes.saturating_sub(bytes);
        Some(value)
    }

    pub async fn cancel_request(&self, request_id: &str) -> bool {
        let (cancelled, next) = self.scheduler.lock().await.cancel(request_id);
        if let Some(next) = next {
            if !next.frame.is_empty()
                && self
                    .stdin
                    .lock()
                    .await
                    .write_all(&next.frame)
                    .await
                    .is_err()
            {
                self.report_crash();
            }
        }
        cancelled
    }

    pub async fn sync_document(
        &self,
        uri: SemanticUri,
        version: u64,
        text: Vec<u8>,
    ) -> Result<(), SessionError> {
        if self.state() != SessionState::Ready {
            return Err(SessionError::NotReady);
        }
        uri.validate().map_err(|_| SessionError::InvalidDocument)?;
        if version > MAX_SEQUENCE || text.len() > MAX_DOCUMENT_BYTES as usize {
            return Err(SessionError::DocumentLimitExceeded);
        }
        let key = uri.path.clone();
        let mut snapshots = self.snapshots.lock().await;
        if snapshots
            .items
            .get(&key)
            .is_some_and(|old| old.version >= version)
        {
            return Err(SessionError::StaleDocument);
        }
        let old_bytes = snapshots
            .items
            .get(&key)
            .map(|snapshot| snapshot.text.len())
            .unwrap_or_default();
        let next_bytes = snapshots
            .bytes
            .saturating_sub(old_bytes)
            .saturating_add(text.len());
        if next_bytes > MAX_SNAPSHOT_BYTES {
            return Err(SessionError::DocumentLimitExceeded);
        }
        snapshots
            .items
            .insert(key, DocumentSnapshot { uri, version, text });
        snapshots.bytes = next_bytes;
        self.last_activity_ms.store(now_ms(), Ordering::Release);
        Ok(())
    }

    pub async fn snapshot(&self, path: &str) -> Option<DocumentSnapshot> {
        self.snapshots.lock().await.items.get(path).cloned()
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
        self.state
            .store(SessionState::Shutdown as u8, Ordering::Release);
        self.terminate_process().await;
    }

    pub(crate) async fn cleanup_after_crash(&self) {
        self.terminate_process().await;
    }

    async fn terminate_process(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    fn report_crash(&self) {
        if self.state() == SessionState::Shutdown {
            return;
        }
        self.state
            .store(SessionState::Crashed as u8, Ordering::Release);
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

#[derive(Default)]
struct SnapshotStore {
    items: HashMap<String, DocumentSnapshot>,
    bytes: usize,
}

fn initialization_message(policy: InitializationPolicy, language: SemanticLanguage) -> Value {
    let options = policy.options();
    let descriptor_settings = match language {
        SemanticLanguage::Rust => serde_json::json!({
            "rust-analyzer": {
                "cargo": {
                    "buildScripts": {"enable": options.allow_build_scripts}
                },
                "procMacro": {"enable": options.allow_build_tooling}
            }
        }),
        SemanticLanguage::Typescript | SemanticLanguage::Javascript => serde_json::json!({
            "typescript-language-server": {
                "plugins": [],
                "allowLocalPluginLoads": options.allow_workspace_plugins,
                "disableAutomaticTypingAcquisition": true
            }
        }),
        SemanticLanguage::Java => serde_json::json!({
            "java": {
                "configuration": {"updateBuildConfiguration": "disabled"},
                "import": {
                    "gradle": {"enabled": false},
                    "maven": {"enabled": false}
                }
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
            "initializationOptions": {
                "damHopper": {
                    "allowBuildScripts": options.allow_build_scripts,
                    "allowWorkspacePlugins": options.allow_workspace_plugins,
                    "allowBuildTooling": options.allow_build_tooling
                },
                "descriptorSettings": descriptor_settings
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
            self.active.insert(next.request_id.clone());
        }
        (true, next)
    }

    fn cancel(&mut self, request_id: &str) -> (bool, Option<QueuedRequest>) {
        if self.active.remove(request_id) {
            let next = self.queued.pop_front();
            if let Some(next) = &next {
                self.active.insert(next.request_id.clone());
            }
            return (true, next);
        }
        let before = self.queued.len();
        self.queued
            .retain(|request| request.request_id != request_id);
        (before != self.queued.len(), None)
    }
}

fn spawn_stdout_drain(session: &Arc<LspSession>, mut stdout: tokio::process::ChildStdout) {
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
    });
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

fn spawn_child_monitor(session: &Arc<LspSession>) {
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
    });
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
    #[error("LSP session is not ready")]
    NotReady,
    #[error("request id is invalid")]
    InvalidRequestId,
    #[error("request is already active or queued")]
    DuplicateRequest,
    #[error("interactive request queue is full")]
    QueueFull,
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
    fn initialization_policy_is_forwarded_to_the_release_process() {
        let restricted =
            initialization_message(InitializationPolicy::Restricted, SemanticLanguage::Rust);
        let trusted = initialization_message(InitializationPolicy::Trusted, SemanticLanguage::Rust);
        assert_eq!(
            restricted["params"]["initializationOptions"]["damHopper"]["allowWorkspacePlugins"],
            false
        );
        assert_eq!(
            trusted["params"]["initializationOptions"]["damHopper"]["allowWorkspacePlugins"],
            false
        );
        assert_eq!(restricted, trusted);
    }
}
