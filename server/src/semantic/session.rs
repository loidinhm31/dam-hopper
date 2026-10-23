//! Target-scoped semantic session actor, child process management,
//! FIFO request ordering, version extension validation, and document-scoped close.

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::time::sleep;

use super::child::{ChildError, ChildEvent, ChildStatus, SemanticChildHandle, SemanticChildOwner};
use super::launch::{BundledLaunchSpec, LaunchError};
use super::overlay::{OverlayError, SessionOverlayMap};
use super::protocol::{
    is_supported_language, NavigationParams, SemanticState, SessionIdentityFence, SessionKey,
    TextDocumentContentChangeEvent, METHOD_CANCEL_REQUEST, METHOD_DID_CHANGE, METHOD_DID_CLOSE,
    METHOD_DID_OPEN, METHOD_INITIALIZE, METHOD_INITIALIZED,
};
use super::resources::{
    IDLE_SHUTDOWN_TIMEOUT, MAX_IN_FLIGHT_REQUESTS, MAX_RESTARTS_PER_WINDOW,
    NAVIGATION_REQUEST_TIMEOUT, RESTART_BACKOFF_STAGE1, RESTART_BACKOFF_STAGE2, RESTART_WINDOW,
    STARTUP_TIMEOUT, TOTAL_TEARDOWN_BUDGET,
};

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

    #[error("Session invalidated")]
    Invalidated,
}

/// In-flight navigation request awaiting child response.
#[allow(dead_code)]
struct InFlightRequest {
    request_id: Value,
    source_uri: String,
    document_open_incarnation: u64,
    document_version: i64,
    destination_versions_snapshot: HashMap<String, i64>,
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
        method: String,
        params: NavigationParams,
        reply: oneshot::Sender<Result<Value, SessionError>>,
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
}

/// Handle to communicate with an isolated semantic session.
#[derive(Clone)]
pub struct SemanticSessionHandle {
    pub key: SessionKey,
    cmd_tx: mpsc::Sender<SessionCommand>,
}

impl SemanticSessionHandle {
    pub async fn initialize(&self) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::Initialize { reply: tx })
            .await
            .map_err(|_| SessionError::Invalidated)?;
        rx.await.map_err(|_| SessionError::Invalidated)?
    }

    pub async fn did_open(
        &self,
        uri: String,
        language_id: String,
        version: i64,
        text: String,
    ) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::DidOpen {
                uri,
                language_id,
                version,
                text,
                reply: tx,
            })
            .await
            .map_err(|_| SessionError::Invalidated)?;
        rx.await.map_err(|_| SessionError::Invalidated)?
    }

    pub async fn did_change(
        &self,
        uri: String,
        version: i64,
        changes: Vec<TextDocumentContentChangeEvent>,
    ) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::DidChange {
                uri,
                version,
                changes,
                reply: tx,
            })
            .await
            .map_err(|_| SessionError::Invalidated)?;
        rx.await.map_err(|_| SessionError::Invalidated)?
    }

    pub async fn did_close(&self, uri: String) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::DidClose { uri, reply: tx })
            .await
            .map_err(|_| SessionError::Invalidated)?;
        rx.await.map_err(|_| SessionError::Invalidated)?
    }

    pub async fn navigation(
        &self,
        method: &str,
        params: NavigationParams,
    ) -> Result<Value, SessionError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::Navigation {
                method: method.to_string(),
                params,
                reply: tx,
            })
            .await
            .map_err(|_| SessionError::Invalidated)?;
        rx.await.map_err(|_| SessionError::Invalidated)?
    }

    pub async fn cancel_request(&self, id: Value) {
        let _ = self.cmd_tx.send(SessionCommand::CancelRequest { id }).await;
    }

    pub async fn shutdown(&self) -> Result<(), SessionError> {
        let (tx, rx) = oneshot::channel();
        let _ = self
            .cmd_tx
            .send(SessionCommand::Shutdown { reply: tx })
            .await;
        rx.await.unwrap_or(Ok(()))
    }

    pub async fn get_state(&self) -> SemanticState {
        let (tx, rx) = oneshot::channel();
        if self
            .cmd_tx
            .send(SessionCommand::GetState { reply: tx })
            .await
            .is_err()
        {
            return SemanticState::Invalidated;
        }
        rx.await.unwrap_or(SemanticState::Invalidated)
    }

    pub async fn get_overlay_stats(&self) -> (usize, usize) {
        let (tx, rx) = oneshot::channel();
        if self
            .cmd_tx
            .send(SessionCommand::GetOverlayStats { reply: tx })
            .await
            .is_err()
        {
            return (0, 0);
        }
        rx.await.unwrap_or((0, 0))
    }

    pub async fn get_pgid(&self) -> Option<u32> {
        let (tx, rx) = oneshot::channel();
        if self
            .cmd_tx
            .send(SessionCommand::GetPgid { reply: tx })
            .await
            .is_err()
        {
            return None;
        }
        rx.await.unwrap_or(None)
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
    overlays: SessionOverlayMap,
    in_flight_requests: HashMap<Value, InFlightRequest>,
    next_req_id: u64,
    restarts_in_window: Vec<Instant>,
    cmd_rx: mpsc::Receiver<SessionCommand>,
    idle_timer_token: Arc<AtomicU64>,
    idle_notify_tx: mpsc::Sender<SessionKey>,
}

impl SemanticSessionActor {
    pub fn spawn(
        key: SessionKey,
        fence: SessionIdentityFence,
        target_root: PathBuf,
        launch_spec: BundledLaunchSpec,
        idle_notify_tx: mpsc::Sender<SessionKey>,
    ) -> SemanticSessionHandle {
        let (cmd_tx, cmd_rx) = mpsc::channel(32);
        let actor = Self {
            key: key.clone(),
            fence,
            target_root,
            launch_spec,
            state: SemanticState::Idle,
            child_handle: None,
            child_event_rx: None,
            overlays: SessionOverlayMap::new(),
            in_flight_requests: HashMap::new(),
            next_req_id: 100,
            restarts_in_window: Vec::new(),
            cmd_rx,
            idle_timer_token: Arc::new(AtomicU64::new(0)),
            idle_notify_tx,
        };

        tokio::spawn(actor.run());

        SemanticSessionHandle { key, cmd_tx }
    }

    async fn run(mut self) {
        let mut deadline_ticker = tokio::time::interval(Duration::from_millis(500));
        loop {
            tokio::select! {
                _ = deadline_ticker.tick() => {
                    self.sweep_expired_requests().await;
                }
                cmd_opt = self.cmd_rx.recv() => {
                    match cmd_opt {
                        Some(cmd) => {
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
                        // Pending forever if no child
                        std::future::pending::<Option<ChildEvent>>().await
                    }
                } => {
                    self.handle_child_event(event).await;
                }
                else => break,
            }
        }

        self.cleanup().await;
    }

    async fn handle_command(&mut self, cmd: SessionCommand) -> bool {
        match cmd {
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
                method,
                params,
                reply,
            } => {
                let res = self.do_navigation(&method, params, reply).await;
                if let Err(_e) = res {
                    // Immediate error (e.g. queue full or stale version)
                    // If res was Ok, the reply sender is stored in in_flight_requests
                }
                false
            }
            SessionCommand::CancelRequest { id } => {
                self.do_cancel_request(id).await;
                false
            }
            SessionCommand::Shutdown { reply } => {
                self.cleanup().await;
                let _ = reply.send(Ok(()));
                true // Terminate actor loop
            }
            SessionCommand::GetState { reply } => {
                let _ = reply.send(self.state);
                false
            }
            SessionCommand::GetOverlayStats { reply } => {
                let _ = reply.send((self.overlays.document_count(), self.overlays.total_bytes()));
                false
            }
            SessionCommand::GetPgid { reply } => {
                let pgid = self.child_handle.as_ref().map(|h| h.pgid);
                let _ = reply.send(pgid);
                false
            }
        }
    }

    async fn do_initialize(&mut self) -> Result<(), SessionError> {
        if self.state == SemanticState::Ready && self.child_handle.is_some() {
            return Ok(());
        }

        self.state = SemanticState::Starting;
        self.fence.child_incarnation += 1;
        let (mut handle, mut event_rx) =
            SemanticChildOwner::spawn(&self.launch_spec).map_err(SessionError::Child)?;

        // Send LSP initialize RPC
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
                    }
                }
            }
        });

        let init_bytes = serde_json::to_vec(&init_req).unwrap();
        handle
            .send_message(init_bytes)
            .map_err(SessionError::Child)?;

        // Await initialize response within STARTUP_TIMEOUT
        let init_res = tokio::time::timeout(STARTUP_TIMEOUT, async {
            while let Some(evt) = event_rx.recv().await {
                match evt {
                    ChildEvent::Message(msg) => {
                        if let Ok(parsed) = serde_json::from_slice::<Value>(&msg) {
                            if parsed.get("id") == Some(&Value::from(1)) {
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
                    ChildEvent::Terminated(status) => {
                        return Err(SessionError::ChildCrashed(format!("{:?}", status)));
                    }
                    _ => {}
                }
            }
            Err(SessionError::ChildCrashed(
                "Event stream closed during initialization".into(),
            ))
        })
        .await;

        match init_res {
            Ok(Ok(())) => {
                // Send initialized notification
                let initialized_notif = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": METHOD_INITIALIZED,
                    "params": {}
                });
                let init_notif_bytes = serde_json::to_vec(&initialized_notif).unwrap();
                let _ = handle.send_message(init_notif_bytes);

                self.child_handle = Some(handle);
                self.child_event_rx = Some(event_rx);
                self.state = SemanticState::Ready;
                Ok(())
            }
            Ok(Err(e)) => {
                self.state = SemanticState::Crashed;
                handle.shutdown();
                Err(e)
            }
            Err(_) => {
                self.state = SemanticState::Timeout;
                handle.shutdown();
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

        let _doc_open_incarnation =
            self.overlays
                .open_document(uri.clone(), language_id.clone(), version, text.clone())?;

        // Dispatch didOpen to child stdio
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
            self.state = SemanticState::Invalidated;
            return Err(e);
        }

        Ok(())
    }

    async fn do_did_close(&mut self, uri: &str) -> Result<(), SessionError> {
        let removed = self.overlays.close_document(uri);
        if removed.is_none() {
            return Err(SessionError::DocumentNotFound(uri.to_string()));
        }

        // Cancel pending requests for this URI
        let cancelled_ids: Vec<Value> = self
            .in_flight_requests
            .iter()
            .filter(|(_, req)| req.source_uri == uri)
            .map(|(id, _)| id.clone())
            .collect();

        for id in cancelled_ids {
            if let Some(req) = self.in_flight_requests.remove(&id) {
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
        method: &str,
        params: NavigationParams,
        reply: oneshot::Sender<Result<Value, SessionError>>,
    ) -> Result<(), SessionError> {
        if self.state != SemanticState::Ready {
            let err = SessionError::NotReady(self.state);
            let _ = reply.send(Err(err));
            return Ok(());
        }

        let source_uri = params.text_document.uri.clone();
        let (doc_version, doc_open_incarnation) = {
            let doc = self
                .overlays
                .get(&source_uri)
                .ok_or_else(|| SessionError::DocumentNotFound(source_uri.clone()))?;
            (doc.version, doc.open_incarnation)
        };

        if doc_version != params.dam_hopper_document_version {
            let err = SessionError::StaleDocumentVersion {
                current: doc_version,
                requested: params.dam_hopper_document_version,
            };
            let _ = reply.send(Err(err));
            return Ok(());
        }

        if self.in_flight_requests.len() >= MAX_IN_FLIGHT_REQUESTS {
            let err = SessionError::InFlightQueueFull {
                count: self.in_flight_requests.len(),
                max: MAX_IN_FLIGHT_REQUESTS,
            };
            let _ = reply.send(Err(err));
            return Ok(());
        }

        self.cancel_idle_timer();

        let req_id_num = self.next_req_id;
        self.next_req_id += 1;
        let req_id = Value::from(req_id_num);
        // Snapshot versions of currently open destination overlays
        let destination_versions_snapshot = self.overlays.document_versions_snapshot();

        // Strip damHopper* fields before forwarding to child
        let std_params = params.to_standard_lsp_params();
        let lsp_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": req_id_num,
            "method": method,
            "params": std_params
        });

        if let Err(e) = self.send_child_json(&lsp_req).await {
            let _ = reply.send(Err(e));
            return Ok(());
        }

        self.in_flight_requests.insert(
            req_id.clone(),
            InFlightRequest {
                request_id: req_id,
                source_uri,
                document_open_incarnation: doc_open_incarnation,
                document_version: doc_version,
                destination_versions_snapshot,
                response_tx: reply,
                created_at: Instant::now(),
            },
        );

        Ok(())
    }

    async fn do_cancel_request(&mut self, id: Value) {
        if let Some(req) = self.in_flight_requests.remove(&id) {
            let _ = req.response_tx.send(Ok(Value::Null));

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
                if let Ok(parsed) = serde_json::from_slice::<Value>(&msg) {
                    if let Some(method_val) = parsed.get("method").and_then(|m| m.as_str()) {
                        // Child-initiated request or notification
                        if let Some(id) = parsed.get("id") {
                            let response_result = if method_val == "workspace/configuration" {
                                serde_json::json!([{}])
                            } else {
                                Value::Null
                            };
                            let resp = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": response_result
                            });
                            let _ = self.send_child_json(&resp).await;
                        }
                    } else if let Some(id) = parsed.get("id") {
                        if let Some(in_flight) = self.in_flight_requests.remove(id) {
                            self.resolve_navigation_response(in_flight, parsed);
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

    fn resolve_navigation_response(&self, in_flight: InFlightRequest, response: Value) {
        // 1. Validate source document freshness
        if let Some(current_doc) = self.overlays.get(&in_flight.source_uri) {
            if current_doc.open_incarnation != in_flight.document_open_incarnation
                || current_doc.version != in_flight.document_version
            {
                // Source document changed while request was in-flight -> discard stale result
                let _ = in_flight.response_tx.send(Ok(Value::Null));
                return;
            }
        } else {
            // Source document was closed -> discard
            let _ = in_flight.response_tx.send(Ok(Value::Null));
            return;
        }

        // 2. Validate destination freshness for open overlays
        if let Some(result) = response.get("result") {
            let mut is_stale = false;
            let check_loc = |loc: &Value| -> bool {
                let uri_opt = loc.get("uri").or_else(|| loc.get("targetUri"));
                if let Some(uri_val) = uri_opt.and_then(|u| u.as_str()) {
                    if let Some(&snapshot_ver) =
                        in_flight.destination_versions_snapshot.get(uri_val)
                    {
                        if let Some(current_doc) = self.overlays.get(uri_val) {
                            if current_doc.version != snapshot_ver {
                                return true; // Destination modified while in flight!
                            }
                        }
                    }
                }
                false
            };

            if result.is_array() {
                for loc in result.as_array().unwrap() {
                    if check_loc(loc) {
                        is_stale = true;
                        break;
                    }
                }
            } else if result.is_object() && check_loc(result) {
                is_stale = true;
            }

            if is_stale {
                let _ = in_flight.response_tx.send(Ok(Value::Null));
                return;
            }
        }

        let _ = in_flight.response_tx.send(Ok(response));
    }

    async fn handle_child_exit(&mut self, status: ChildStatus) {
        self.child_handle = None;
        self.child_event_rx = None;

        // Drain in-flight requests with crash error
        for (_, req) in self.in_flight_requests.drain() {
            let _ = req
                .response_tx
                .send(Err(SessionError::ChildCrashed(format!("{:?}", status))));
        }
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

        // Apply restart backoff
        self.restarts_in_window.push(now);
        let backoff = if self.restarts_in_window.len() == 1 {
            RESTART_BACKOFF_STAGE1
        } else {
            RESTART_BACKOFF_STAGE2
        };

        sleep(backoff).await;

        // Attempt restart and full replay
        self.state = SemanticState::Starting;
        if self.do_initialize().await.is_ok() {
            let docs = self.overlays.all_documents();
            for doc in docs {
                let notif = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": METHOD_DID_OPEN,
                    "params": {
                        "textDocument": {
                            "uri": doc.uri,
                            "languageId": doc.language_id,
                            "version": doc.version,
                            "text": doc.text
                        }
                    }
                });
                let _ = self.send_child_json(&notif).await;
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

    async fn cleanup(&mut self) {
        self.cancel_idle_timer();
        self.state = SemanticState::ShuttingDown;

        for (_, req) in self.in_flight_requests.drain() {
            let _ = req.response_tx.send(Err(SessionError::Invalidated));
        }
        if let Some(mut handle) = self.child_handle.take() {
            handle.shutdown();
            if let Some(mut rx) = self.child_event_rx.take() {
                let _ = tokio::time::timeout(
                    TOTAL_TEARDOWN_BUDGET + Duration::from_millis(500),
                    async {
                        while let Some(evt) = rx.recv().await {
                            if let ChildEvent::Terminated(_) = evt {
                                break;
                            }
                        }
                    },
                )
                .await;
            }
        }
        self.child_event_rx = None;
        self.overlays.clear();
        self.state = SemanticState::Idle;
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
