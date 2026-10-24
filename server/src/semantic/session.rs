//! Target-scoped semantic session actor, child process management,
//! FIFO request ordering, version extension validation, and document-scoped close.

use super::supervisor::ToolchainVerifier;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::time::sleep;

use super::child::{ChildError, ChildEvent, ChildStatus, SemanticChildHandle, SemanticChildOwner};
use super::launch::{BundledLaunchSpec, LaunchError};
use super::overlay::{OverlayError, SessionOverlayMap};
pub use super::pressure::SessionDiagnosticsSnapshot;
use super::pressure::{CommandSlotPermit, EnqueuedCommand, SessionPressureCounters};
use super::protocol::{
    is_supported_language, NavigationParams, SemanticState, SessionIdentityFence, SessionKey,
    TextDocumentContentChangeEvent, METHOD_CANCEL_REQUEST, METHOD_DID_CHANGE, METHOD_DID_CLOSE,
    METHOD_DID_OPEN, METHOD_INITIALIZE, METHOD_INITIALIZED,
};
use super::reaper::{
    get_all_descendants, is_pgid_empty, merge_descendants, verify_pids_dead, verify_tree_reaped,
    ReaperError,
};
use super::resources::{
    ResourceLimitError, ResourcePolicy, FORCE_KILL_REAP_BUDGET, IDLE_SHUTDOWN_TIMEOUT,
    MAX_IN_FLIGHT_REQUESTS, MAX_OPEN_DOCUMENTS_PER_SESSION, MAX_RESTARTS_PER_WINDOW,
    MAX_SESSION_OVERLAY_BYTES, NAVIGATION_REQUEST_TIMEOUT, RESTART_BACKOFF_STAGE1,
    RESTART_BACKOFF_STAGE2, RESTART_WINDOW, STARTUP_TIMEOUT, TOTAL_TEARDOWN_BUDGET,
};
pub use super::types::{OverlayDocumentSnapshot, RevocationToken};

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("Session is not ready (state: {0})")]
    NotReady(SemanticState),

    #[error("Unsupported language: {0}")]
    UnsupportedLanguage(String),

    #[error("Document not found: {0}")]
    DocumentNotFound(String),

    #[error(
        "Stale document version: overlay is version {current}, request was for version {requested}"
    )]
    StaleDocumentVersion { current: i64, requested: i64 },

    #[error("In-flight request queue full ({count} >= {max})")]
    InFlightQueueFull { count: usize, max: usize },

    #[error("Child communication error: {0}")]
    Child(#[from] ChildError),

    #[error("Overlay error: {0}")]
    Overlay(#[from] OverlayError),

    #[error("Launch configuration error: {0}")]
    Launch(#[from] LaunchError),

    #[error("Child process crashed: {0}")]
    ChildCrashed(String),

    #[error("Request timed out")]
    Timeout,

    #[error("Request cancelled")]
    Cancelled,

    #[error("Session invalidated")]
    Invalidated,
}

/// Refcounted temporary disk-pin lease held in `SemanticSessionActor` during G5 pinned navigation.
struct TempPinEntry {
    uri: String,
    language_id: String,
    text: String,
    content_sha256: String,
    refcount: usize,
    generation: u64,
}

/// In-flight navigation request awaiting child response.
struct InFlightRequest {
    source_uri: String,
    document_open_incarnation: u64,
    document_version: i64,
    destination_snapshot: HashMap<String, (u64, i64)>,
    leased_temp_pins: Vec<(String, u64)>,
    pinned_snapshots: HashMap<String, OverlayDocumentSnapshot>,
    is_pinned_requery: bool,
    response_tx: oneshot::Sender<Result<Value, SessionError>>,
    created_at: Instant,
}
/// Commands sent to the session actor task.
pub enum SessionCommand {
    Initialize {
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    DidOpen {
        uri: String,
        language_id: String,
        version: i64,
        text: String,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    DidChange {
        uri: String,
        version: i64,
        changes: Vec<TextDocumentContentChangeEvent>,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    DidClose {
        uri: String,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    Navigation {
        request_id: Option<Value>,
        method: String,
        params: NavigationParams,
        pinned_files: Vec<(String, String, String)>,
        reply: oneshot::Sender<Result<Value, SessionError>>,
    },
    GetOverlaySnapshot {
        uri: String,
        reply: oneshot::Sender<Result<Option<OverlayDocumentSnapshot>, SessionError>>,
    },
    CancelRequest {
        id: Value,
    },
    Shutdown {
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    GetState {
        reply: oneshot::Sender<SemanticState>,
    },
    GetOverlayStats {
        reply: oneshot::Sender<(usize, usize)>, // (doc_count, total_bytes)
    },
    GetPgid {
        reply: oneshot::Sender<Option<u32>>,
    },
    Invalidate,
}

/// Handle to communicate with an isolated semantic session.
#[derive(Clone)]
pub struct SemanticSessionHandle {
    pub key: SessionKey,
    pub fence: SessionIdentityFence,
    cmd_tx: mpsc::Sender<EnqueuedCommand<SessionCommand>>,
    revocation: RevocationToken,
    cleanly_reaped: Arc<AtomicBool>,
    actor_done: Arc<AtomicBool>,
    current_pgid: Arc<AtomicU32>,
    counters: Arc<SessionPressureCounters>,
}

impl SemanticSessionHandle {
    /// Shared synchronous revocation token for this session.
    #[inline]
    pub fn revocation_token(&self) -> &RevocationToken {
        &self.revocation
    }

    /// Cheap, non-blocking sync cached snapshot of session pressure diagnostics.
    #[inline]
    pub fn diagnostics(&self) -> SessionDiagnosticsSnapshot {
        self.counters.snapshot()
    }

    /// Check whether this session has been synchronously revoked.
    #[inline]
    pub fn is_revoked(&self) -> bool {
        self.revocation.is_revoked()
    }

    /// Synchronously revoke this session's authority token without awaiting actor mailbox capacity.
    #[inline]
    pub fn revoke_now(&self) {
        self.revocation.revoke();
    }

    /// Non-blocking enqueue of `SessionCommand::Invalidate` (used alongside `revoke_now`).
    #[inline]
    pub(crate) fn try_enqueue_invalidate(&self) {
        if let Ok(permit) = self.cmd_tx.try_reserve() {
            let slot_permit = CommandSlotPermit::new(Arc::clone(&self.counters));
            permit.send(EnqueuedCommand {
                cmd: SessionCommand::Invalidate,
                permit: slot_permit,
            });
        }
    }

    /// Whether the session's child tree (if any) has been verified completely reaped.
    #[inline]
    pub fn is_cleanly_reaped(&self) -> bool {
        self.cleanly_reaped.load(Ordering::Acquire)
    }

    /// Whether the session actor loop has exited.
    #[inline]
    pub fn is_actor_done(&self) -> bool {
        self.actor_done.load(Ordering::Acquire)
    }

    /// Cached PGID of the current or unreaped child process tree, if any.
    #[inline]
    pub fn current_pgid_cached(&self) -> Option<u32> {
        let pgid = self.current_pgid.load(Ordering::Acquire);
        if pgid > 0 {
            Some(pgid)
        } else {
            None
        }
    }

    pub fn cached_overlay_stats(&self) -> (usize, usize) {
        (
            self.counters.open_documents.load(Ordering::Acquire),
            self.counters.overlay_bytes.load(Ordering::Acquire),
        )
    }

    pub(crate) fn downgrade_cmd_tx(&self) -> mpsc::WeakSender<EnqueuedCommand<SessionCommand>> {
        self.cmd_tx.downgrade()
    }

    pub(crate) fn from_parts(
        key: SessionKey,
        fence: SessionIdentityFence,
        cmd_tx: mpsc::Sender<EnqueuedCommand<SessionCommand>>,
        revocation: RevocationToken,
        cleanly_reaped: Arc<AtomicBool>,
        actor_done: Arc<AtomicBool>,
        current_pgid: Arc<AtomicU32>,
        counters: Arc<SessionPressureCounters>,
    ) -> Self {
        Self {
            key,
            fence,
            cmd_tx,
            revocation,
            cleanly_reaped,
            actor_done,
            current_pgid,
            counters,
        }
    }

    pub(crate) fn shared_flags(
        &self,
    ) -> (
        RevocationToken,
        Arc<AtomicBool>,
        Arc<AtomicBool>,
        Arc<AtomicU32>,
        Arc<SessionPressureCounters>,
    ) {
        (
            self.revocation.clone(),
            Arc::clone(&self.cleanly_reaped),
            Arc::clone(&self.actor_done),
            Arc::clone(&self.current_pgid),
            Arc::clone(&self.counters),
        )
    }

    async fn send_fenced_command(&self, cmd: SessionCommand) -> Result<(), SessionError> {
        if self.is_revoked() {
            return Err(SessionError::Invalidated);
        }
        tokio::select! {
            biased;
            _ = self.revocation.cancelled() => Err(SessionError::Invalidated),
            res = self.cmd_tx.reserve() => {
                match res {
                    Ok(permit) => {
                        if self.is_revoked() {
                            return Err(SessionError::Invalidated);
                        }
                        let slot_permit = CommandSlotPermit::new(Arc::clone(&self.counters));
                        permit.send(EnqueuedCommand {
                            cmd,
                            permit: slot_permit,
                        });
                        Ok(())
                    }
                    Err(_) => Err(SessionError::Invalidated),
                }
            }
        }
    }

    async fn await_fenced_reply<T>(
        &self,
        rx: oneshot::Receiver<Result<T, SessionError>>,
    ) -> Result<T, SessionError> {
        tokio::select! {
            biased;
            _ = self.revocation.cancelled() => Err(SessionError::Invalidated),
            res = rx => {
                if self.is_revoked() {
                    return Err(SessionError::Invalidated);
                }
                res.map_err(|_| SessionError::Invalidated)?
            }
        }
    }

    pub async fn initialize(&self) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.send_fenced_command(SessionCommand::Initialize { reply: tx })
            .await?;
        self.await_fenced_reply(rx).await
    }

    pub async fn did_open(
        &self,
        uri: String,
        language_id: String,
        version: i64,
        text: String,
    ) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.send_fenced_command(SessionCommand::DidOpen {
            uri,
            language_id,
            version,
            text,
            reply: tx,
        })
        .await?;
        self.await_fenced_reply(rx).await
    }

    pub async fn did_change(
        &self,
        uri: String,
        version: i64,
        changes: Vec<TextDocumentContentChangeEvent>,
    ) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.send_fenced_command(SessionCommand::DidChange {
            uri,
            version,
            changes,
            reply: tx,
        })
        .await?;
        self.await_fenced_reply(rx).await
    }

    pub async fn did_close(&self, uri: String) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.send_fenced_command(SessionCommand::DidClose { uri, reply: tx })
            .await?;
        self.await_fenced_reply(rx).await
    }

    pub async fn get_overlay_snapshot(
        &self,
        uri: &str,
    ) -> Result<Option<OverlayDocumentSnapshot>, SessionError> {
        let (tx, rx) = oneshot::channel();
        self.send_fenced_command(SessionCommand::GetOverlaySnapshot {
            uri: uri.to_string(),
            reply: tx,
        })
        .await?;
        self.await_fenced_reply(rx).await
    }

    pub async fn submit_navigation(
        &self,
        request_id: Value,
        method: &str,
        params: NavigationParams,
    ) -> Result<oneshot::Receiver<Result<Value, SessionError>>, SessionError> {
        self.submit_pinned_navigation(request_id, method, params, Vec::new())
            .await
    }

    pub async fn submit_pinned_navigation(
        &self,
        request_id: Value,
        method: &str,
        params: NavigationParams,
        pinned_files: Vec<(String, String, String)>,
    ) -> Result<oneshot::Receiver<Result<Value, SessionError>>, SessionError> {
        let (actor_tx, actor_rx) = oneshot::channel();
        self.send_fenced_command(SessionCommand::Navigation {
            request_id: Some(request_id),
            method: method.to_string(),
            params,
            pinned_files,
            reply: actor_tx,
        })
        .await?;

        let (caller_tx, caller_rx) = oneshot::channel();
        let revocation = self.revocation.clone();
        tokio::spawn(async move {
            tokio::select! {
                biased;
                _ = revocation.cancelled() => {
                    let _ = caller_tx.send(Err(SessionError::Invalidated));
                }
                res = actor_rx => {
                    if revocation.is_revoked() {
                        let _ = caller_tx.send(Err(SessionError::Invalidated));
                    } else if let Ok(val) = res {
                        let _ = caller_tx.send(val);
                    } else {
                        let _ = caller_tx.send(Err(SessionError::Invalidated));
                    }
                }
            }
        });
        Ok(caller_rx)
    }

    pub async fn navigation(
        &self,
        method: &str,
        params: NavigationParams,
    ) -> Result<Value, SessionError> {
        let rx = self.submit_navigation(Value::Null, method, params).await?;
        self.await_fenced_reply(rx).await
    }

    pub async fn cancel_request(&self, id: Value) {
        if !self.is_revoked() {
            if let Ok(permit) = self.cmd_tx.reserve().await {
                let slot_permit = CommandSlotPermit::new(Arc::clone(&self.counters));
                permit.send(EnqueuedCommand {
                    cmd: SessionCommand::CancelRequest { id },
                    permit: slot_permit,
                });
            }
        }
    }

    pub async fn invalidate(&self) {
        self.revoke_now();
        self.try_enqueue_invalidate();
    }

    pub async fn shutdown(&self) -> Result<(), SessionError> {
        self.revoke_now();
        let (tx, rx) = oneshot::channel();
        if let Ok(permit) = self.cmd_tx.reserve().await {
            let slot_permit = CommandSlotPermit::new(Arc::clone(&self.counters));
            permit.send(EnqueuedCommand {
                cmd: SessionCommand::Shutdown { reply: tx },
                permit: slot_permit,
            });
        } else {
            return if self.is_cleanly_reaped() {
                Ok(())
            } else {
                Err(SessionError::ChildCrashed(
                    "Session actor exited with unreaped child process tree".into(),
                ))
            };
        }
        match rx.await {
            Ok(res) => res,
            Err(_) => {
                if self.is_cleanly_reaped() {
                    Ok(())
                } else {
                    Err(SessionError::ChildCrashed(
                        "Session actor dropped shutdown reply with unreaped child process tree"
                            .into(),
                    ))
                }
            }
        }
    }

    pub async fn get_state(&self) -> SemanticState {
        if self.is_revoked() {
            return SemanticState::Invalidated;
        }
        let (tx, rx) = oneshot::channel();
        if let Ok(permit) = self.cmd_tx.reserve().await {
            let slot_permit = CommandSlotPermit::new(Arc::clone(&self.counters));
            permit.send(EnqueuedCommand {
                cmd: SessionCommand::GetState { reply: tx },
                permit: slot_permit,
            });
            rx.await.unwrap_or(SemanticState::Invalidated)
        } else {
            SemanticState::Invalidated
        }
    }

    pub async fn get_overlay_stats(&self) -> (usize, usize) {
        self.cached_overlay_stats()
    }

    pub async fn get_pgid(&self) -> Option<u32> {
        if self.is_revoked() {
            return self.current_pgid_cached();
        }
        let (tx, rx) = oneshot::channel();
        if let Ok(permit) = self.cmd_tx.try_reserve() {
            let slot_permit = CommandSlotPermit::new(Arc::clone(&self.counters));
            permit.send(EnqueuedCommand {
                cmd: SessionCommand::GetPgid { reply: tx },
                permit: slot_permit,
            });
            rx.await.unwrap_or_else(|_| self.current_pgid_cached())
        } else {
            self.current_pgid_cached()
        }
    }
}

/// Internal session actor running the event loop.
pub struct SemanticSessionActor {
    key: SessionKey,
    fence: SessionIdentityFence,
    target_root: PathBuf,
    launch_spec: BundledLaunchSpec,
    state: SemanticState,
    child_handle: Option<SemanticChildHandle>,
    child_event_rx: Option<mpsc::Receiver<ChildEvent>>,
    unreaped_pgid: Option<(u32, Vec<u32>)>,
    overlays: SessionOverlayMap,
    temp_pins: HashMap<String, TempPinEntry>,
    temp_pin_bytes: usize,
    next_temp_pin_generation: u64,
    in_flight_requests: HashMap<Value, InFlightRequest>,
    next_req_id: u64,
    restarts_in_window: Vec<Instant>,
    cmd_rx: mpsc::Receiver<EnqueuedCommand<SessionCommand>>,
    idle_timer_token: Arc<AtomicU64>,
    idle_notify_tx: mpsc::Sender<SessionKey>,
    revocation: RevocationToken,
    cleanly_reaped: Arc<AtomicBool>,
    actor_done: Arc<AtomicBool>,
    current_pgid: Arc<AtomicU32>,
    counters: Arc<SessionPressureCounters>,
    verifier: Option<ToolchainVerifier>,
}

impl SemanticSessionActor {
    pub fn spawn(
        key: SessionKey,
        fence: SessionIdentityFence,
        target_root: PathBuf,
        launch_spec: BundledLaunchSpec,
        idle_notify_tx: mpsc::Sender<SessionKey>,
        verifier: Option<ToolchainVerifier>,
    ) -> SemanticSessionHandle {
        let (cmd_tx, cmd_rx) = mpsc::channel(32);
        let handle_fence = fence.clone();
        let revocation = RevocationToken::new();
        let cleanly_reaped = Arc::new(AtomicBool::new(true));
        let actor_done = Arc::new(AtomicBool::new(false));
        let current_pgid = Arc::new(AtomicU32::new(0));
        let counters = Arc::new(SessionPressureCounters::new());

        let actor = Self {
            key: key.clone(),
            fence,
            target_root,
            launch_spec,
            state: SemanticState::Idle,
            child_handle: None,
            child_event_rx: None,
            unreaped_pgid: None,
            overlays: SessionOverlayMap::new(),
            temp_pins: HashMap::new(),
            temp_pin_bytes: 0,
            next_temp_pin_generation: 0,
            in_flight_requests: HashMap::new(),
            next_req_id: 100,
            restarts_in_window: Vec::new(),
            cmd_rx,
            idle_timer_token: Arc::new(AtomicU64::new(0)),
            idle_notify_tx,
            revocation: revocation.clone(),
            cleanly_reaped: Arc::clone(&cleanly_reaped),
            actor_done: Arc::clone(&actor_done),
            current_pgid: Arc::clone(&current_pgid),
            counters: Arc::clone(&counters),
            verifier,
        };

        tokio::spawn(actor.run());

        SemanticSessionHandle {
            key,
            fence: handle_fence,
            cmd_tx,
            revocation,
            cleanly_reaped,
            actor_done,
            current_pgid,
            counters,
        }
    }

    fn sync_overlay_atomics(&self) {
        let docs = self.overlays.document_count() + self.temp_pins.len();
        let bytes = self.overlays.total_bytes() + self.temp_pin_bytes;
        self.counters.open_documents.store(docs, Ordering::Release);
        SessionPressureCounters::update_peak(&self.counters.peak_open_documents, docs);
        self.counters.overlay_bytes.store(bytes, Ordering::Release);
        SessionPressureCounters::update_peak(&self.counters.peak_overlay_bytes, bytes);
    }

    fn apply_invalidation(&mut self) {
        self.revocation.revoke();
        self.state = SemanticState::Invalidated;
        self.cancel_idle_timer();
        self.overlays.clear();
        self.temp_pins.clear();
        self.temp_pin_bytes = 0;
        self.sync_overlay_atomics();
        let drained = self.in_flight_requests.len();
        for (_, req) in self.in_flight_requests.drain() {
            let _ = req.response_tx.send(Err(SessionError::Invalidated));
        }
        self.counters
            .in_flight_requests
            .fetch_sub(drained, Ordering::SeqCst);
    }

    async fn release_temp_pins(&mut self, leased: &[(String, u64)]) {
        if leased.is_empty() {
            return;
        }
        let mut to_close = Vec::new();
        for (uri, gen) in leased {
            let should_remove = if let Some(entry) = self.temp_pins.get_mut(uri) {
                if entry.generation == *gen {
                    entry.refcount = entry.refcount.saturating_sub(1);
                    entry.refcount == 0
                } else {
                    false
                }
            } else {
                false
            };
            if should_remove {
                if let Some(removed) = self.temp_pins.remove(uri) {
                    self.temp_pin_bytes = self.temp_pin_bytes.saturating_sub(removed.text.len());
                    to_close.push(removed.uri);
                }
            }
        }
        self.sync_overlay_atomics();
        for uri in to_close {
            let close_notif = serde_json::json!({
                "jsonrpc": "2.0",
                "method": METHOD_DID_CLOSE,
                "params": {
                    "textDocument": {
                        "uri": uri
                    }
                }
            });
            let _ = self.send_child_json(&close_notif).await;
        }
    }
    async fn run(mut self) {
        let mut deadline_ticker = tokio::time::interval(Duration::from_millis(500));
        loop {
            tokio::select! {
                biased;

                _ = self.revocation.cancelled(), if self.state != SemanticState::Invalidated => {
                    self.apply_invalidation();
                }
                cmd_opt = self.cmd_rx.recv() => {
                    match cmd_opt {
                        Some(enqueued) => {
                            let EnqueuedCommand { cmd, permit } = enqueued;
                            drop(permit);
                            let should_stop = self.handle_command(cmd).await;
                            if should_stop {
                                break;
                            }
                        }
                        None => {
                            // All handle senders dropped; terminate actor loop
                            break;
                        }
                    }
                }
                Some(event) = async {
                    if let Some(rx) = &mut self.child_event_rx {
                        rx.recv().await
                    } else {
                        std::future::pending::<Option<ChildEvent>>().await
                    }
                } => {
                    self.handle_child_event(event).await;
                }
                _ = deadline_ticker.tick() => {
                    self.sweep_expired_requests().await;
                }
                else => break,
            }
        }
        self.close_command_queue();

        let _ = self.cleanup().await;
        self.actor_done.store(true, Ordering::Release);
    }

    fn close_command_queue(&mut self) {
        self.cmd_rx.close();
        while let Ok(enqueued) = self.cmd_rx.try_recv() {
            drop(enqueued);
        }
    }

    async fn handle_command(&mut self, cmd: SessionCommand) -> bool {
        if self.revocation.is_revoked() && self.state != SemanticState::Invalidated {
            self.apply_invalidation();
        }

        if self.state == SemanticState::Invalidated {
            match cmd {
                SessionCommand::Shutdown { reply } => {
                    let res = self.cleanup().await;
                    let is_ok = res.is_ok();
                    if is_ok {
                        self.close_command_queue();
                    }
                    let _ = reply.send(res);
                    return is_ok;
                }
                SessionCommand::GetState { reply } => {
                    let _ = reply.send(SemanticState::Invalidated);
                    return false;
                }
                SessionCommand::GetOverlayStats { reply } => {
                    let _ = reply.send((0, 0));
                    return false;
                }
                SessionCommand::GetPgid { reply } => {
                    let pgid = self
                        .child_handle
                        .as_ref()
                        .map(|h| h.pgid)
                        .or_else(|| self.unreaped_pgid.as_ref().map(|(p, _)| *p));
                    let _ = reply.send(pgid);
                    return false;
                }
                SessionCommand::Initialize { reply }
                | SessionCommand::DidOpen { reply, .. }
                | SessionCommand::DidChange { reply, .. }
                | SessionCommand::DidClose { reply, .. } => {
                    let _ = reply.send(Err(SessionError::Invalidated));
                    return false;
                }
                SessionCommand::Navigation { reply, .. } => {
                    let _ = reply.send(Err(SessionError::Invalidated));
                    return false;
                }
                SessionCommand::GetOverlaySnapshot { reply, .. } => {
                    let _ = reply.send(Err(SessionError::Invalidated));
                    return false;
                }
                SessionCommand::CancelRequest { .. } | SessionCommand::Invalidate => {
                    return false;
                }
            }
        }

        match cmd {
            SessionCommand::Invalidate => {
                self.apply_invalidation();
                false
            }
            SessionCommand::Initialize { reply } => {
                let res = self.do_initialize().await;
                let _ = reply.send(res);
                false
            }
            SessionCommand::DidOpen {
                uri,
                language_id,
                version,
                text,
                reply,
            } => {
                let res = self.do_did_open(uri, language_id, version, text).await;
                let _ = reply.send(res);
                false
            }
            SessionCommand::DidChange {
                uri,
                version,
                changes,
                reply,
            } => {
                let res = self.do_did_change(&uri, version, changes).await;
                let _ = reply.send(res);
                false
            }
            SessionCommand::DidClose { uri, reply } => {
                let res = self.do_did_close(&uri).await;
                let _ = reply.send(res);
                false
            }
            SessionCommand::Navigation {
                request_id,
                method,
                params,
                pinned_files,
                reply,
            } => {
                let _ = self
                    .do_navigation(request_id, &method, params, pinned_files, reply)
                    .await;
                false
            }
            SessionCommand::GetOverlaySnapshot { uri, reply } => {
                let snap = self.overlays.get(&uri).map(|doc| OverlayDocumentSnapshot {
                    uri: doc.uri.clone(),
                    language_id: doc.language_id.clone(),
                    version: doc.version,
                    open_incarnation: doc.open_incarnation,
                    content_sha256: compute_text_sha256(&doc.text),
                    text: doc.text.clone(),
                });
                let _ = reply.send(Ok(snap));
                false
            }
            SessionCommand::CancelRequest { id } => {
                self.do_cancel_request(id).await;
                false
            }
            SessionCommand::Shutdown { reply } => {
                self.apply_invalidation();
                let res = self.cleanup().await;
                let is_ok = res.is_ok();
                if is_ok {
                    self.close_command_queue();
                }
                let _ = reply.send(res);
                is_ok
            }
            SessionCommand::GetState { reply } => {
                let _ = reply.send(self.state);
                false
            }
            SessionCommand::GetOverlayStats { reply } => {
                let _ = reply.send((
                    self.overlays.document_count() + self.temp_pins.len(),
                    self.overlays.total_bytes() + self.temp_pin_bytes,
                ));
                false
            }
            SessionCommand::GetPgid { reply } => {
                let pgid = self
                    .child_handle
                    .as_ref()
                    .map(|h| h.pgid)
                    .or_else(|| self.unreaped_pgid.as_ref().map(|(p, _)| *p));
                let _ = reply.send(pgid);
                false
            }
        }
    }

    async fn do_initialize(&mut self) -> Result<(), SessionError> {
        if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
            return Err(SessionError::Invalidated);
        }
        if self.state == SemanticState::Ready && self.child_handle.is_some() {
            return Ok(());
        }
        if let Some(verifier) = &self.verifier {
            if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
                return Err(SessionError::Invalidated);
            }

            tokio::select! {
                biased;
                _ = self.revocation.cancelled() => {
                    return Err(SessionError::Invalidated);
                }
                res = verifier.verify_fresh() => {
                    if let Err(e) = res {
                        self.state = SemanticState::Crashed;
                        return Err(SessionError::Child(ChildError::SpawnFailed(
                            std::io::Error::other(format!(
                                "Toolchain integrity verification failed before spawn: {e}"
                            )),
                        )));
                    }
                }
            }
        }

        if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
            return Err(SessionError::Invalidated);
        }

        self.state = SemanticState::Starting;
        self.fence.child_incarnation += 1;
        self.cleanly_reaped.store(false, Ordering::Release);
        self.counters.spawn_attempts.fetch_add(1, Ordering::SeqCst);
        let (handle, event_rx) = match SemanticChildOwner::spawn_with_counters(
            &self.launch_spec,
            Arc::clone(&self.counters),
        ) {
            Ok(pair) => pair,
            Err(e) => {
                self.cleanly_reaped.store(true, Ordering::Release);
                self.state = SemanticState::Crashed;
                return Err(SessionError::Child(e));
            }
        };
        self.counters
            .successful_spawns
            .fetch_add(1, Ordering::SeqCst);

        self.current_pgid.store(handle.pgid, Ordering::Release);
        self.child_handle = Some(handle);
        self.child_event_rx = Some(event_rx);

        let mut init_options = serde_json::json!({
            "disableAutomaticTypingAcquisition": true,
            "maxTsServerMemory": self.launch_spec.v8_max_old_space_mb,
            "plugins": [],
            "hostInfo": "dam-hopper"
        });
        if let Some(tsserver) = &self.launch_spec.tsserver_path {
            init_options["tsserver"] = serde_json::json!({
                "path": tsserver.to_string_lossy(),
                // Partial-semantic startup answers can resolve only the local import alias.
                "useSyntaxServer": "never"
            });
        }

        let init_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": METHOD_INITIALIZE,
            "params": {
                "processId": std::process::id(),
                "rootUri": path_to_file_uri(&self.target_root),
                "capabilities": {
                    "textDocument": {
                        "synchronization": {
                            "dynamicRegistration": false,
                            "willSave": false,
                            "willSaveWaitUntil": false,
                            "didSave": false
                        },
                        "definition": { "dynamicRegistration": false },
                        "implementation": { "dynamicRegistration": false }
                    },
                    "workspace": {
                        "configuration": true
                    }
                },
                "initializationOptions": init_options
            }
        });

        if let Err(e) = self.send_child_json(&init_req).await {
            self.state = SemanticState::Crashed;
            let _ = self.reap_current_child().await;
            return Err(e);
        }

        let revocation = self.revocation.clone();
        let init_res = tokio::time::timeout(STARTUP_TIMEOUT, async {
            loop {
                let evt_opt = {
                    let Some(rx) = &mut self.child_event_rx else {
                        return Err(SessionError::ChildCrashed(
                            "Event stream missing during initialization".into(),
                        ));
                    };
                    tokio::select! {
                        biased;
                        _ = revocation.cancelled() => return Err(SessionError::Invalidated),
                        evt = rx.recv() => evt,
                    }
                };
                match evt_opt {
                    Some(ChildEvent::Message(msg)) => {
                        if let Ok(parsed) = serde_json::from_slice::<Value>(&msg) {
                            if let Some(method_val) = parsed.get("method").and_then(|m| m.as_str())
                            {
                                if let Some(id) = parsed.get("id") {
                                    let response_result =
                                        build_child_request_reply(method_val, &parsed);
                                    let resp = serde_json::json!({
                                        "jsonrpc": "2.0",
                                        "id": id,
                                        "result": response_result
                                    });
                                    let _ = self.send_child_json(&resp).await;
                                }
                            } else if parsed.get("id") == Some(&Value::from(1)) {
                                if let Some(err) = parsed.get("error") {
                                    return Err(SessionError::ChildCrashed(format!(
                                        "LSP initialize error: {:?}",
                                        err
                                    )));
                                }
                                return Ok(());
                            }
                        }
                    }
                    Some(ChildEvent::Terminated(status)) => {
                        return Err(SessionError::ChildCrashed(format!("{:?}", status)));
                    }
                    Some(ChildEvent::StderrSummary { .. }) => {}
                    None => {
                        return Err(SessionError::ChildCrashed(
                            "Event stream closed during initialization".into(),
                        ));
                    }
                }
            }
        })
        .await;

        match init_res {
            Ok(Ok(())) => {
                if self.revocation.is_revoked() {
                    self.apply_invalidation();
                    return Err(SessionError::Invalidated);
                }
                let initialized_notif = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": METHOD_INITIALIZED,
                    "params": {}
                });
                let _ = self.send_child_json(&initialized_notif).await;
                self.state = SemanticState::Ready;
                Ok(())
            }
            Ok(Err(SessionError::Invalidated)) => {
                self.apply_invalidation();
                Err(SessionError::Invalidated)
            }
            Ok(Err(e)) => {
                self.state = SemanticState::Crashed;
                let _ = self.reap_current_child().await;
                Err(e)
            }
            Err(_) => {
                self.state = SemanticState::Timeout;
                let _ = self.reap_current_child().await;
                Err(SessionError::Timeout)
            }
        }
    }

    async fn do_did_open(
        &mut self,
        uri: String,
        language_id: String,
        version: i64,
        text: String,
    ) -> Result<(), SessionError> {
        if !is_supported_language(&language_id) {
            return Err(SessionError::UnsupportedLanguage(language_id));
        }

        self.cancel_idle_timer();

        if self.child_handle.is_none() {
            self.do_initialize().await?;
        }

        // If URI is currently held as a temporary G5 disk pin, supersede it cleanly before user didOpen
        if let Some(removed_pin) = self.temp_pins.remove(&uri) {
            self.temp_pin_bytes = self.temp_pin_bytes.saturating_sub(removed_pin.text.len());
            self.sync_overlay_atomics();
            let close_notif = serde_json::json!({
                "jsonrpc": "2.0",
                "method": METHOD_DID_CLOSE,
                "params": {
                    "textDocument": {
                        "uri": &uri
                    }
                }
            });
            let _ = self.send_child_json(&close_notif).await;
        }

        if self.overlays.document_count() + self.temp_pins.len() >= MAX_OPEN_DOCUMENTS_PER_SESSION {
            return Err(SessionError::Overlay(OverlayError::ResourceLimit(
                ResourceLimitError::TooManyDocuments {
                    count: self.overlays.document_count() + self.temp_pins.len() + 1,
                    max: MAX_OPEN_DOCUMENTS_PER_SESSION,
                },
            )));
        }
        if self.overlays.total_bytes() + self.temp_pin_bytes + text.len()
            > MAX_SESSION_OVERLAY_BYTES
        {
            return Err(SessionError::Overlay(OverlayError::ResourceLimit(
                ResourceLimitError::SessionOverlayExceeded {
                    bytes: self.overlays.total_bytes() + self.temp_pin_bytes + text.len(),
                    max: MAX_SESSION_OVERLAY_BYTES,
                },
            )));
        }

        let _doc_open_incarnation =
            self.overlays
                .open_document(uri.clone(), language_id.clone(), version, text.clone())?;
        self.sync_overlay_atomics();
        let notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": METHOD_DID_OPEN,
            "params": {
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": version,
                    "text": text
                }
            }
        });

        self.send_child_json(&notif).await
    }

    async fn do_did_change(
        &mut self,
        uri: &str,
        version: i64,
        changes: Vec<TextDocumentContentChangeEvent>,
    ) -> Result<(), SessionError> {
        let is_incremental = self.overlays.apply_changes(uri, version, &changes)?;
        self.sync_overlay_atomics();
        // Prepare outbound changes for child
        let outbound_changes = if is_incremental {
            // >= 64 KiB: send ranged edits
            changes
        } else {
            // < 64 KiB: send range-less full text replacement
            let doc = self.overlays.get(uri).unwrap();
            vec![TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: doc.text.clone(),
            }]
        };

        let notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": METHOD_DID_CHANGE,
            "params": {
                "textDocument": {
                    "uri": uri,
                    "version": version
                },
                "contentChanges": outbound_changes
            }
        });

        // Enqueue to child. If enqueue fails after overlay commit, invalidate session generation.
        if let Err(e) = self.send_child_json(&notif).await {
            self.apply_invalidation();
            return Err(e);
        }

        Ok(())
    }

    async fn do_did_close(&mut self, uri: &str) -> Result<(), SessionError> {
        let removed = self.overlays.close_document(uri);
        if removed.is_none() {
            return Err(SessionError::DocumentNotFound(uri.to_string()));
        }
        self.sync_overlay_atomics();
        // Cancel pending requests for this URI
        let cancelled_ids: Vec<Value> = self
            .in_flight_requests
            .iter()
            .filter(|(_, req)| req.source_uri == uri)
            .map(|(id, _)| id.clone())
            .collect();

        for id in cancelled_ids {
            if let Some(req) = self.in_flight_requests.remove(&id) {
                self.counters
                    .in_flight_requests
                    .fetch_sub(1, Ordering::SeqCst);
                self.counters
                    .navigation_cancellations
                    .fetch_add(1, Ordering::SeqCst);
                self.release_temp_pins(&req.leased_temp_pins).await;
                let _ = req.response_tx.send(Ok(Value::Null));
            }
        }
        let notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": METHOD_DID_CLOSE,
            "params": {
                "textDocument": {
                    "uri": uri
                }
            }
        });

        let _ = self.send_child_json(&notif).await;

        self.check_schedule_idle_timer();

        Ok(())
    }

    async fn do_navigation(
        &mut self,
        request_id: Option<Value>,
        method: &str,
        params: NavigationParams,
        pinned_files: Vec<(String, String, String)>,
        reply: oneshot::Sender<Result<Value, SessionError>>,
    ) -> Result<(), SessionError> {
        if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
            let _ = reply.send(Err(SessionError::Invalidated));
            return Ok(());
        }
        if self.state != SemanticState::Ready {
            let err = SessionError::NotReady(self.state);
            let _ = reply.send(Err(err));
            return Ok(());
        }

        let source_uri = params.text_document.uri.clone();
        let (doc_version, doc_open_incarnation) = {
            let Some(doc) = self.overlays.get(&source_uri) else {
                let _ = reply.send(Err(SessionError::DocumentNotFound(source_uri)));
                return Ok(());
            };
            (doc.version, doc.open_incarnation)
        };

        let is_pinned_requery = !pinned_files.is_empty();
        if doc_version != params.dam_hopper_document_version {
            let err = SessionError::StaleDocumentVersion {
                current: doc_version,
                requested: params.dam_hopper_document_version,
            };
            let _ = reply.send(Err(err));
            return Ok(());
        }
        if is_pinned_requery {
            if let Some(expected_inc) = params.dam_hopper_model_generation {
                if doc_open_incarnation != expected_inc {
                    let err = SessionError::StaleDocumentVersion {
                        current: doc_version,
                        requested: params.dam_hopper_document_version,
                    };
                    let _ = reply.send(Err(err));
                    return Ok(());
                }
            }
        }

        if self.in_flight_requests.len() >= MAX_IN_FLIGHT_REQUESTS {
            self.counters
                .navigation_overloads
                .fetch_add(1, Ordering::SeqCst);
            let err = SessionError::InFlightQueueFull {
                count: self.in_flight_requests.len(),
                max: MAX_IN_FLIGHT_REQUESTS,
            };
            let _ = reply.send(Err(err));
            return Ok(());
        }
        self.cancel_idle_timer();

        let req_id = match request_id {
            Some(val) if !val.is_null() => val,
            _ => {
                let req_id_num = self.next_req_id;
                self.next_req_id += 1;
                Value::from(req_id_num)
            }
        };
        if self.in_flight_requests.contains_key(&req_id) {
            let _ = reply.send(Err(SessionError::InFlightQueueFull {
                count: self.in_flight_requests.len(),
                max: MAX_IN_FLIGHT_REQUESTS,
            }));
            return Ok(());
        }

        // Snapshot (open_incarnation, version) of currently open user overlays
        let mut destination_snapshot: HashMap<String, (u64, i64)> = self
            .overlays
            .all_documents()
            .into_iter()
            .map(|d| (d.uri.clone(), (d.open_incarnation, d.version)))
            .collect();

        // Process G5 pinned files: atomically select user overlay when already open,
        // otherwise acquire a refcounted temporary pin lease in `self.temp_pins`.
        let mut leased_temp_pins: Vec<(String, u64)> = Vec::new();
        let mut pinned_snapshots: HashMap<String, OverlayDocumentSnapshot> = HashMap::new();

        for (file_uri, lang_id, disk_text) in pinned_files {
            if let Some(existing_doc) = self.overlays.get(&file_uri) {
                destination_snapshot.insert(
                    file_uri.clone(),
                    (existing_doc.open_incarnation, existing_doc.version),
                );
                pinned_snapshots.insert(
                    file_uri,
                    OverlayDocumentSnapshot {
                        uri: existing_doc.uri.clone(),
                        language_id: existing_doc.language_id.clone(),
                        version: existing_doc.version,
                        open_incarnation: existing_doc.open_incarnation,
                        content_sha256: compute_text_sha256(&existing_doc.text),
                        text: existing_doc.text.clone(),
                    },
                );
                continue;
            }

            if let Some(pin) = self.temp_pins.get_mut(&file_uri) {
                if pin.text != disk_text {
                    self.release_temp_pins(&leased_temp_pins).await;
                    let _ = reply.send(Err(SessionError::StaleDocumentVersion {
                        current: 0,
                        requested: params.dam_hopper_document_version,
                    }));
                    return Ok(());
                }
                pin.refcount += 1;
                leased_temp_pins.push((file_uri.clone(), pin.generation));
                pinned_snapshots.insert(
                    file_uri,
                    OverlayDocumentSnapshot {
                        uri: pin.uri.clone(),
                        language_id: pin.language_id.clone(),
                        version: 0,
                        open_incarnation: 0,
                        content_sha256: pin.content_sha256.clone(),
                        text: pin.text.clone(),
                    },
                );
                continue;
            }

            // Enforce document size, session document count, and session byte limits before opening temp pin
            if let Err(limit_err) = ResourcePolicy::validate_document_size(disk_text.len()) {
                self.release_temp_pins(&leased_temp_pins).await;
                let _ = reply.send(Err(SessionError::Overlay(OverlayError::ResourceLimit(
                    limit_err,
                ))));
                return Ok(());
            }
            if self.overlays.document_count() + self.temp_pins.len()
                >= MAX_OPEN_DOCUMENTS_PER_SESSION
            {
                self.release_temp_pins(&leased_temp_pins).await;
                let _ = reply.send(Err(SessionError::Overlay(OverlayError::ResourceLimit(
                    ResourceLimitError::TooManyDocuments {
                        count: self.overlays.document_count() + self.temp_pins.len() + 1,
                        max: MAX_OPEN_DOCUMENTS_PER_SESSION,
                    },
                ))));
                return Ok(());
            }
            if self.overlays.total_bytes() + self.temp_pin_bytes + disk_text.len()
                > MAX_SESSION_OVERLAY_BYTES
            {
                self.release_temp_pins(&leased_temp_pins).await;
                let _ = reply.send(Err(SessionError::Overlay(OverlayError::ResourceLimit(
                    ResourceLimitError::SessionOverlayExceeded {
                        bytes: self.overlays.total_bytes() + self.temp_pin_bytes + disk_text.len(),
                        max: MAX_SESSION_OVERLAY_BYTES,
                    },
                ))));
                return Ok(());
            }

            let open_notif = serde_json::json!({
                "jsonrpc": "2.0",
                "method": METHOD_DID_OPEN,
                "params": {
                    "textDocument": {
                        "uri": &file_uri,
                        "languageId": &lang_id,
                        "version": 1,
                        "text": &disk_text
                    }
                }
            });
            if let Err(e) = self.send_child_json(&open_notif).await {
                self.release_temp_pins(&leased_temp_pins).await;
                let _ = reply.send(Err(e));
                return Ok(());
            }

            self.next_temp_pin_generation += 1;
            let gen = self.next_temp_pin_generation;
            let sha = compute_text_sha256(&disk_text);
            self.temp_pin_bytes += disk_text.len();
            self.temp_pins.insert(
                file_uri.clone(),
                TempPinEntry {
                    uri: file_uri.clone(),
                    language_id: lang_id.clone(),
                    text: disk_text.clone(),
                    content_sha256: sha.clone(),
                    refcount: 1,
                    generation: gen,
                },
            );
            self.sync_overlay_atomics();
            leased_temp_pins.push((file_uri.clone(), gen));
            pinned_snapshots.insert(
                file_uri.clone(),
                OverlayDocumentSnapshot {
                    uri: file_uri,
                    language_id: lang_id,
                    version: 0,
                    open_incarnation: 0,
                    content_sha256: sha,
                    text: disk_text,
                },
            );
        }

        // Strip damHopper* fields before forwarding to child
        let std_params = params.to_standard_lsp_params();
        let lsp_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": std_params
        });

        if let Err(e) = self.send_child_json(&lsp_req).await {
            self.release_temp_pins(&leased_temp_pins).await;
            let _ = reply.send(Err(e));
            return Ok(());
        }

        self.in_flight_requests.insert(
            req_id.clone(),
            InFlightRequest {
                source_uri,
                document_open_incarnation: doc_open_incarnation,
                document_version: doc_version,
                destination_snapshot,
                leased_temp_pins,
                pinned_snapshots,
                is_pinned_requery,
                response_tx: reply,
                created_at: Instant::now(),
            },
        );
        let cur_in_flight = self
            .counters
            .in_flight_requests
            .fetch_add(1, Ordering::SeqCst)
            + 1;
        SessionPressureCounters::update_peak(&self.counters.peak_in_flight_requests, cur_in_flight);

        Ok(())
    }

    async fn do_cancel_request(&mut self, id: Value) {
        if let Some(req) = self.in_flight_requests.remove(&id) {
            self.counters
                .in_flight_requests
                .fetch_sub(1, Ordering::SeqCst);
            self.counters
                .navigation_cancellations
                .fetch_add(1, Ordering::SeqCst);
            self.release_temp_pins(&req.leased_temp_pins).await;
            let _ = req.response_tx.send(Err(SessionError::Cancelled));

            let cancel_notif = serde_json::json!({
                "jsonrpc": "2.0",
                "method": METHOD_CANCEL_REQUEST,
                "params": { "id": id }
            });
            let _ = self.send_child_json(&cancel_notif).await;
        }

        self.check_schedule_idle_timer();
    }

    async fn handle_child_event(&mut self, event: ChildEvent) {
        match event {
            ChildEvent::Message(msg) => {
                if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
                    self.apply_invalidation();
                    return;
                }
                if let Ok(parsed) = serde_json::from_slice::<Value>(&msg) {
                    if let Some(method_val) = parsed.get("method").and_then(|m| m.as_str()) {
                        if let Some(id) = parsed.get("id") {
                            let response_result = build_child_request_reply(method_val, &parsed);
                            let resp = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": response_result
                            });
                            let _ = self.send_child_json(&resp).await;
                        }
                    } else if let Some(id) = parsed.get("id") {
                        if let Some(in_flight) = self.in_flight_requests.remove(id) {
                            self.counters
                                .in_flight_requests
                                .fetch_sub(1, Ordering::SeqCst);
                            self.resolve_navigation_response(in_flight, parsed).await;
                            self.check_schedule_idle_timer();
                        }
                    }
                }
            }
            ChildEvent::Terminated(status) => {
                self.handle_child_exit(status).await;
            }
            ChildEvent::StderrSummary { .. } => {}
        }
    }

    async fn resolve_navigation_response(
        &mut self,
        in_flight: InFlightRequest,
        mut response: Value,
    ) {
        // Check whether leased temporary pins remained intact before releasing them
        let temp_pins_intact = in_flight.leased_temp_pins.iter().all(|(uri, gen)| {
            self.temp_pins
                .get(uri)
                .map(|entry| entry.generation == *gen)
                .unwrap_or(false)
        });
        let leased_uri_set: std::collections::HashSet<&str> = in_flight
            .leased_temp_pins
            .iter()
            .map(|(u, _)| u.as_str())
            .collect();

        if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
            self.release_temp_pins(&in_flight.leased_temp_pins).await;
            let _ = in_flight.response_tx.send(Err(SessionError::Invalidated));
            return;
        }

        let send_stale = |counters: &Arc<SessionPressureCounters>,
                          in_flight: &InFlightRequest|
         -> Result<Value, SessionError> {
            counters.stale_results.fetch_add(1, Ordering::SeqCst);
            if in_flight.is_pinned_requery {
                Err(SessionError::StaleDocumentVersion {
                    current: 0,
                    requested: in_flight.document_version,
                })
            } else {
                Ok(Value::Null)
            }
        };

        if !temp_pins_intact {
            self.release_temp_pins(&in_flight.leased_temp_pins).await;
            let reply = send_stale(&self.counters, &in_flight);
            let _ = in_flight.response_tx.send(reply);
            return;
        }

        // 1. Validate source document freshness
        if let Some(current_doc) = self.overlays.get(&in_flight.source_uri) {
            if current_doc.open_incarnation != in_flight.document_open_incarnation
                || current_doc.version != in_flight.document_version
            {
                self.release_temp_pins(&in_flight.leased_temp_pins).await;
                let reply = send_stale(&self.counters, &in_flight);
                let _ = in_flight.response_tx.send(reply);
                return;
            }
        } else {
            self.release_temp_pins(&in_flight.leased_temp_pins).await;
            let reply = send_stale(&self.counters, &in_flight);
            let _ = in_flight.response_tx.send(reply);
            return;
        }

        // 2. Validate participant overlays & destination freshness
        for (uri, &(snap_inc, snap_ver)) in &in_flight.destination_snapshot {
            match self.overlays.get(uri) {
                Some(current_doc)
                    if current_doc.open_incarnation == snap_inc
                        && current_doc.version == snap_ver => {}
                _ if in_flight.pinned_snapshots.contains_key(uri) => {
                    self.release_temp_pins(&in_flight.leased_temp_pins).await;
                    let reply = send_stale(&self.counters, &in_flight);
                    let _ = in_flight.response_tx.send(reply);
                    return;
                }
                _ => {}
            }
        }

        if let Some(result) = response.get("result") {
            let mut is_stale = false;
            let check_loc = |loc: &Value| -> bool {
                let uri_opt = loc.get("uri").or_else(|| loc.get("targetUri"));
                if let Some(uri_val) = uri_opt.and_then(|u| u.as_str()) {
                    if let Some(&(snap_inc, snap_ver)) = in_flight.destination_snapshot.get(uri_val)
                    {
                        match self.overlays.get(uri_val) {
                            Some(current_doc)
                                if current_doc.open_incarnation == snap_inc
                                    && current_doc.version == snap_ver => {}
                            _ => return true,
                        }
                    } else if self.overlays.get(uri_val).is_some()
                        && !leased_uri_set.contains(uri_val)
                    {
                        return true;
                    }
                }
                false
            };

            if let Some(arr) = result.as_array() {
                for loc in arr {
                    if check_loc(loc) {
                        is_stale = true;
                        break;
                    }
                }
            } else if result.is_object() && check_loc(result) {
                is_stale = true;
            }

            if is_stale {
                self.release_temp_pins(&in_flight.leased_temp_pins).await;
                let reply = send_stale(&self.counters, &in_flight);
                let _ = in_flight.response_tx.send(reply);
                return;
            }
        }

        // Release refcounted temporary pin leases now that child has evaluated and replied
        self.release_temp_pins(&in_flight.leased_temp_pins).await;

        if !in_flight.pinned_snapshots.is_empty() {
            if let Some(obj) = response.as_object_mut() {
                let mut map = serde_json::Map::new();
                for (k, snap) in in_flight.pinned_snapshots {
                    map.insert(
                        k,
                        serde_json::json!({
                            "uri": snap.uri,
                            "languageId": snap.language_id,
                            "version": snap.version,
                            "openIncarnation": snap.open_incarnation,
                            "contentSha256": snap.content_sha256,
                            "text": snap.text,
                        }),
                    );
                }
                obj.insert("_damHopperProvenSnapshots".to_string(), Value::Object(map));
            }
        }

        let _ = in_flight.response_tx.send(Ok(response));
    }

    async fn handle_child_exit(&mut self, status: ChildStatus) {
        let exited_pgid = self.child_handle.as_ref().map(|h| h.pgid);
        self.child_handle = None;
        self.child_event_rx = None;
        self.temp_pins.clear();
        self.temp_pin_bytes = 0;
        self.sync_overlay_atomics();

        if let Some(pgid) = exited_pgid {
            let descendants = get_all_descendants(pgid);
            if is_pgid_empty(pgid) && verify_pids_dead(&descendants) {
                self.cleanly_reaped.store(true, Ordering::Release);
                self.current_pgid.store(0, Ordering::Release);
                self.unreaped_pgid = None;
            } else {
                self.cleanly_reaped.store(false, Ordering::Release);
                self.unreaped_pgid = Some((pgid, descendants));
            }
        }

        // If session is revoked or invalidated, NEVER enter crash restart (Phase 08 R3)
        if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
            self.apply_invalidation();
            return;
        }

        // Drain in-flight requests with crash error
        let drained = self.in_flight_requests.len();
        for (_, req) in self.in_flight_requests.drain() {
            let _ = req
                .response_tx
                .send(Err(SessionError::ChildCrashed(format!("{:?}", status))));
        }
        self.counters
            .in_flight_requests
            .fetch_sub(drained, Ordering::SeqCst);
        if self.state == SemanticState::ShuttingDown {
            self.state = SemanticState::Idle;
            return;
        }

        self.state = SemanticState::Crashed;

        // Check restart budget
        let now = Instant::now();
        self.restarts_in_window
            .retain(|&t| now.duration_since(t) < RESTART_WINDOW);

        if self.restarts_in_window.len() >= MAX_RESTARTS_PER_WINDOW {
            return;
        }

        // Apply cancellation-aware restart backoff
        self.restarts_in_window.push(now);
        let backoff = if self.restarts_in_window.len() == 1 {
            RESTART_BACKOFF_STAGE1
        } else {
            RESTART_BACKOFF_STAGE2
        };

        let revocation = self.revocation.clone();
        tokio::select! {
            biased;
            _ = revocation.cancelled() => {
                self.apply_invalidation();
                return;
            }
            _ = sleep(backoff) => {}
        }

        if self.revocation.is_revoked() || self.state == SemanticState::Invalidated {
            self.apply_invalidation();
            return;
        }
        // Attempt restart and full replay
        self.counters
            .restart_attempts
            .fetch_add(1, Ordering::SeqCst);
        self.state = SemanticState::Starting;
        if self.do_initialize().await.is_ok() {
            let docs: Vec<(String, String, i64, String)> = self
                .overlays
                .all_documents()
                .into_iter()
                .map(|d| {
                    (
                        d.uri.clone(),
                        d.language_id.clone(),
                        d.version,
                        d.text.clone(),
                    )
                })
                .collect();
            let mut replay_ok = true;
            for (uri, language_id, version, text) in docs {
                if self.revocation.is_revoked() {
                    self.apply_invalidation();
                    return;
                }
                let notif = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": METHOD_DID_OPEN,
                    "params": {
                        "textDocument": {
                            "uri": uri,
                            "languageId": language_id,
                            "version": version,
                            "text": text
                        }
                    }
                });
                if self.send_child_json(&notif).await.is_err() {
                    replay_ok = false;
                    break;
                }
            }
            if replay_ok {
                self.counters
                    .successful_restarts
                    .fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    fn check_schedule_idle_timer(&mut self) {
        if self.overlays.document_count() == 0 && self.in_flight_requests.is_empty() {
            let token = self.idle_timer_token.fetch_add(1, Ordering::SeqCst) + 1;
            let token_clone = Arc::clone(&self.idle_timer_token);
            let tx = self.idle_notify_tx.clone();
            let key = self.key.clone();

            tokio::spawn(async move {
                sleep(IDLE_SHUTDOWN_TIMEOUT).await;
                if token_clone.load(Ordering::SeqCst) == token {
                    let _ = tx.send(key).await;
                }
            });
        }
    }

    fn cancel_idle_timer(&mut self) {
        self.idle_timer_token.fetch_add(1, Ordering::SeqCst);
    }

    async fn send_child_json(&mut self, json_val: &Value) -> Result<(), SessionError> {
        let handle = self
            .child_handle
            .as_mut()
            .ok_or(SessionError::NotReady(self.state))?;

        let bytes = serde_json::to_vec(json_val).map_err(|e| ChildError::Framing(e.into()))?;
        handle.send_message(bytes).map_err(SessionError::Child)
    }

    async fn reap_current_child(&mut self) -> Result<(), SessionError> {
        if let Some(mut handle) = self.child_handle.take() {
            let pgid = handle.pgid;
            let mut descendants = get_all_descendants(pgid);
            handle.shutdown();
            self.child_event_rx = None;
            let _ = tokio::time::timeout(
                TOTAL_TEARDOWN_BUDGET + Duration::from_millis(500),
                handle.wait_terminated(),
            )
            .await;
            merge_descendants(pgid, &mut descendants);
            if !is_pgid_empty(pgid) || !verify_pids_dead(&descendants) {
                #[cfg(unix)]
                {
                    use nix::sys::signal::{kill, Signal};
                    use nix::unistd::Pid;
                    let _ = super::reaper::signal_pgid(pgid, Some(Signal::SIGKILL));
                    for &desc_pid in &descendants {
                        let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGKILL));
                    }
                }
                let _ = verify_tree_reaped(pgid, &descendants, Duration::from_millis(500)).await;
            }
            if is_pgid_empty(pgid) && verify_pids_dead(&descendants) {
                self.unreaped_pgid = None;
                self.current_pgid.store(0, Ordering::Release);
                self.cleanly_reaped.store(true, Ordering::Release);
                return Ok(());
            } else {
                self.unreaped_pgid = Some((pgid, descendants));
                self.cleanly_reaped.store(false, Ordering::Release);
                return Err(SessionError::Child(ChildError::Reaper(
                    ReaperError::DescendantLeak(pgid),
                )));
            }
        }

        if let Some((pgid, mut descendants)) = self.unreaped_pgid.take() {
            merge_descendants(pgid, &mut descendants);
            if !is_pgid_empty(pgid) || !verify_pids_dead(&descendants) {
                #[cfg(unix)]
                {
                    use nix::sys::signal::{kill, Signal};
                    use nix::unistd::Pid;
                    let _ = super::reaper::signal_pgid(pgid, Some(Signal::SIGKILL));
                    for &desc_pid in &descendants {
                        let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGKILL));
                    }
                }
                let _ = verify_tree_reaped(pgid, &descendants, FORCE_KILL_REAP_BUDGET).await;
            }
            if is_pgid_empty(pgid) && verify_pids_dead(&descendants) {
                self.current_pgid.store(0, Ordering::Release);
                self.cleanly_reaped.store(true, Ordering::Release);
                return Ok(());
            } else {
                self.unreaped_pgid = Some((pgid, descendants));
                self.cleanly_reaped.store(false, Ordering::Release);
                return Err(SessionError::Child(ChildError::Reaper(
                    ReaperError::DescendantLeak(pgid),
                )));
            }
        }

        self.current_pgid.store(0, Ordering::Release);
        self.cleanly_reaped.store(true, Ordering::Release);
        Ok(())
    }

    async fn cleanup(&mut self) -> Result<(), SessionError> {
        self.cancel_idle_timer();
        self.state = SemanticState::ShuttingDown;

        let drained = self.in_flight_requests.len();
        for (_, req) in self.in_flight_requests.drain() {
            let _ = req.response_tx.send(Err(SessionError::Invalidated));
        }
        self.counters
            .in_flight_requests
            .fetch_sub(drained, Ordering::SeqCst);
        self.overlays.clear();
        self.temp_pins.clear();
        self.temp_pin_bytes = 0;
        self.sync_overlay_atomics();

        let res = self.reap_current_child().await;
        self.state = SemanticState::Invalidated;
        res
    }

    async fn sweep_expired_requests(&mut self) {
        let now = Instant::now();
        let mut expired = Vec::new();
        for (id, req) in &self.in_flight_requests {
            if now.duration_since(req.created_at) >= NAVIGATION_REQUEST_TIMEOUT {
                expired.push(id.clone());
            }
        }
        for id in expired {
            if let Some(req) = self.in_flight_requests.remove(&id) {
                self.counters
                    .in_flight_requests
                    .fetch_sub(1, Ordering::SeqCst);
                self.counters
                    .navigation_timeouts
                    .fetch_add(1, Ordering::SeqCst);
                self.release_temp_pins(&req.leased_temp_pins).await;
                let _ = req.response_tx.send(Err(SessionError::Timeout));
                let cancel_notif = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": METHOD_CANCEL_REQUEST,
                    "params": { "id": id }
                });
                let _ = self.send_child_json(&cancel_notif).await;
            }
        }
    }
}

fn build_child_request_reply(method: &str, parsed: &Value) -> Value {
    if method == "workspace/configuration" {
        let count = parsed
            .pointer("/params/items")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(1)
            .max(1);
        Value::Array(vec![serde_json::json!({}); count])
    } else {
        Value::Null
    }
}

fn compute_text_sha256(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    let mut hex = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{b:02x}");
    }
    hex
}

/// Safely convert a filesystem path into a percent-encoded `file://` URI.
pub fn path_to_file_uri(path: &std::path::Path) -> String {
    let mut out = String::from("file://");
    for byte in path.to_string_lossy().as_bytes() {
        match *byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(*byte as char);
            }
            other => {
                use std::fmt::Write;
                let _ = write!(out, "%{:02X}", other);
            }
        }
    }
    out
}
