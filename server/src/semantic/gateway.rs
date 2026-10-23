//! Semantic WebSocket gateway mediating JSON-RPC protocol, lifecycle transitions,
//! filtered method allowlists, extension validation, and supervisor calls.
//!
//! Enforces:
//! - Canonical route `/ws/semantic/v1` filtered profile.
//! - Strict lifecycle order: Unattached -> Attached -> Initializing -> Ready -> ShuttingDown -> Terminated.
//! - Non-blocking reader execution: navigation commands are submitted to the session actor
//!   and response completion runs asynchronously with bounded in-flight requests.
//! - Virtual URI parsing and child `file://` translation with strict target containment.
//! - Extension enforcement: `damHopperDocumentVersion` is required on navigation requests
//!   and stripped before child dispatch.
//! - Safe internal request ID allocation preventing collision with child counters.
//! - Non-disclosing result filtering: outside-target files return sanitized results, stripping internal paths.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, warn};

use super::protocol::{
    is_allowed_semantic_method, is_supported_language, ConnectionId, NavigationParams, Position,
    TextDocumentContentChangeEvent, TextDocumentIdentifier, METHOD_CANCEL_REQUEST,
    METHOD_DEFINITION, METHOD_DID_CHANGE, METHOD_DID_CLOSE, METHOD_DID_OPEN, METHOD_EXIT,
    METHOD_IMPLEMENTATION, METHOD_INITIALIZE, METHOD_INITIALIZED, METHOD_SHUTDOWN,
};
use super::resources::{MAX_IN_FLIGHT_REQUESTS, SOCKET_SEND_TIMEOUT};
use super::session::{SemanticSessionHandle, SessionError};
use super::supervisor::SupervisorError;
use super::uri::{
    filter_location_or_link_result, parse_virtual_uri, virtual_uri_to_file_uri, UriMediationError,
};
use crate::api::auth::AuthenticatedActor;
use crate::fs::secure_path::{directory_identity, DirectoryIdentity};
use crate::state::AppState;
use crate::workspace_target::ProjectTargetRef;

/// Method identifier for attaching a project target to the semantic gateway.
pub const METHOD_ATTACH_TARGET: &str = "damHopper/attachTarget";

/// Standard and DamHopper-specific JSON-RPC error codes.
pub const RPC_ERR_PARSE_ERROR: i64 = -32700;
pub const RPC_ERR_INVALID_REQUEST: i64 = -32600;
pub const RPC_ERR_METHOD_NOT_FOUND: i64 = -32601;
pub const RPC_ERR_INVALID_PARAMS: i64 = -32602;
pub const RPC_ERR_INTERNAL_ERROR: i64 = -32603;
pub const RPC_ERR_SEMANTIC_DISABLED: i64 = -32000;
pub const RPC_ERR_UNSUPPORTED_DESCRIPTOR: i64 = -32001;
pub const RPC_ERR_TARGET_NOT_FOUND: i64 = -32002;
pub const RPC_ERR_STALE_VERSION: i64 = -32003;
pub const RPC_ERR_IN_FLIGHT_FULL: i64 = -32004;
pub const RPC_ERR_AUTH_INVALIDATED: i64 = -32005;

#[derive(Debug, Error)]
pub enum GatewayError {
    #[error("Invalid lifecycle state: {0}")]
    InvalidState(String),

    #[error("Invalid JSON-RPC message: {0}")]
    InvalidJsonRpc(String),

    #[error("Target error: {0}")]
    Target(String),

    #[error("Supervisor error: {0}")]
    Supervisor(#[from] SupervisorError),

    #[error("Session error: {0}")]
    Session(#[from] SessionError),

    #[error("URI mediation error: {0}")]
    Uri(#[from] UriMediationError),
}

/// Resolved immutable target binding for an attached connection.
#[derive(Clone, Debug)]
pub struct TargetBinding {
    pub project: String,
    pub worktree: Option<String>,
    pub target_id: String,
    pub target_root: PathBuf,
    pub(crate) root_identity: DirectoryIdentity,
}

/// Connection lifecycle states enforcing strict ordering.
pub enum GatewayState {
    Unattached,
    Attached(TargetBinding),
    Initializing(TargetBinding, SemanticSessionHandle),
    Ready(TargetBinding, SemanticSessionHandle),
    ShuttingDown(TargetBinding, SemanticSessionHandle),
    Terminated,
}

impl GatewayState {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Unattached => "unattached",
            Self::Attached(_) => "attached",
            Self::Initializing(_, _) => "initializing",
            Self::Ready(_, _) => "ready",
            Self::ShuttingDown(_, _) => "shutting-down",
            Self::Terminated => "terminated",
        }
    }
}

/// Active gateway session managing client protocol state.
pub struct SemanticGateway {
    connection_id: ConnectionId,
    state: AppState,
    #[allow(dead_code)]
    actor: AuthenticatedActor,
    admission_epoch: u64,
    lifecycle: GatewayState,
    in_flight_count: Arc<AtomicUsize>,
    client_to_internal: Arc<Mutex<HashMap<Value, u64>>>,
    internal_to_client: Arc<Mutex<HashMap<u64, Value>>>,
    next_internal_id: u64,
    outbound_tx: mpsc::Sender<String>,
}

impl SemanticGateway {
    pub fn new(
        connection_id: ConnectionId,
        state: AppState,
        actor: AuthenticatedActor,
        admission_epoch: u64,
        outbound_tx: mpsc::Sender<String>,
    ) -> Self {
        Self {
            connection_id,
            state,
            actor,
            admission_epoch,
            lifecycle: GatewayState::Unattached,
            in_flight_count: Arc::new(AtomicUsize::new(0)),
            client_to_internal: Arc::new(Mutex::new(HashMap::new())),
            internal_to_client: Arc::new(Mutex::new(HashMap::new())),
            next_internal_id: 1_000_000,
            outbound_tx,
        }
    }

    /// Process a single incoming raw text message from the WebSocket reader.
    pub async fn handle_incoming_text(&mut self, text: &str) -> Result<(), GatewayError> {
        let msg: Value = match serde_json::from_str(text) {
            Ok(Value::Object(map)) => Value::Object(map),
            _ => {
                let err_res = json_rpc_error(
                    Value::Null,
                    RPC_ERR_PARSE_ERROR,
                    "Invalid JSON-RPC payload: expected single object",
                    None,
                );
                self.send_outbound(err_res).await;
                return Ok(());
            }
        };

        let req_id = msg.get("id").cloned();
        let method = match msg.get("method").and_then(|m| m.as_str()) {
            Some(m) => m,
            None => {
                let err_res = json_rpc_error(
                    req_id.unwrap_or(Value::Null),
                    RPC_ERR_INVALID_REQUEST,
                    "Missing method in JSON-RPC message",
                    None,
                );
                self.send_outbound(err_res).await;
                return Ok(());
            }
        };

        // Method allowlist check
        if method != METHOD_ATTACH_TARGET && !is_allowed_semantic_method(method) {
            let err_res = json_rpc_error(
                req_id.unwrap_or(Value::Null),
                RPC_ERR_METHOD_NOT_FOUND,
                &format!("Method '{method}' is not supported in semantic filtered profile"),
                None,
            );
            self.send_outbound(err_res).await;
            return Ok(());
        }

        let params = msg.get("params").cloned().unwrap_or(Value::Null);

        match method {
            METHOD_ATTACH_TARGET => self.handle_attach_target(req_id, params).await?,
            METHOD_INITIALIZE => self.handle_initialize(req_id, params).await?,
            METHOD_INITIALIZED => self.handle_initialized(params).await?,
            METHOD_DID_OPEN => self.handle_did_open(params).await?,
            METHOD_DID_CHANGE => self.handle_did_change(params).await?,
            METHOD_DID_CLOSE => self.handle_did_close(params).await?,
            METHOD_DEFINITION | METHOD_IMPLEMENTATION => {
                self.handle_navigation(method, req_id, params).await?
            }
            METHOD_CANCEL_REQUEST => self.handle_cancel_request(params).await?,
            METHOD_SHUTDOWN => self.handle_shutdown(req_id).await?,
            METHOD_EXIT => self.handle_exit().await?,
            _ => {
                let err_res = json_rpc_error(
                    req_id.unwrap_or(Value::Null),
                    RPC_ERR_METHOD_NOT_FOUND,
                    "Method not found",
                    None,
                );
                self.send_outbound(err_res).await;
            }
        }

        Ok(())
    }

    /// Handle `damHopper/attachTarget`.
    async fn handle_attach_target(
        &mut self,
        req_id: Option<Value>,
        params: Value,
    ) -> Result<(), GatewayError> {
        let id = req_id.unwrap_or(Value::Null);
        if !matches!(self.lifecycle, GatewayState::Unattached) {
            let err = json_rpc_error(
                id,
                RPC_ERR_INVALID_REQUEST,
                "Target is already attached to this connection",
                Some("TARGET_ALREADY_ATTACHED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        let target_obj = params.get("target");
        let project = target_obj
            .and_then(|t| t.get("project"))
            .and_then(|p| p.as_str());
        let worktree_path = target_obj
            .and_then(|t| t.get("worktreePath"))
            .and_then(|w| w.as_str())
            .map(|s| s.to_string());
        let descriptor = params.get("descriptor").and_then(|d| d.as_str());

        let project_str = match project {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_INVALID_PARAMS,
                    "Missing or invalid 'target.project' parameter",
                    None,
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let descriptor_str = match descriptor {
            Some("typescript") => "typescript".to_string(),
            _ => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_UNSUPPORTED_DESCRIPTOR,
                    "Unsupported language descriptor. Only 'typescript' is supported.",
                    Some("UNSUPPORTED_DESCRIPTOR"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let target_ref = ProjectTargetRef {
            project: project_str.clone(),
            worktree_path: worktree_path.clone(),
        };

        let resolved_target = match self.state.resolve_project_target(&target_ref).await {
            Ok(t) if t.available() => t,
            Ok(_) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_TARGET_NOT_FOUND,
                    "Attached target is currently unavailable",
                    Some("TARGET_UNAVAILABLE"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(_) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_TARGET_NOT_FOUND,
                    "Failed to resolve target project",
                    Some("TARGET_NOT_FOUND"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let target_root = match dunce::canonicalize(resolved_target.target_path()) {
            Ok(p) => p,
            Err(_) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_TARGET_NOT_FOUND,
                    "Target directory does not exist or cannot be accessed",
                    Some("TARGET_NOT_FOUND"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let root_identity = match directory_identity(&target_root) {
            Ok(ident) => ident,
            Err(_) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_TARGET_NOT_FOUND,
                    "Failed to capture target root identity",
                    Some("TARGET_IDENTITY_FAILED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let target_id = resolved_target.target_key().to_string();

        let binding = TargetBinding {
            project: project_str,
            worktree: worktree_path,
            target_id: target_id.clone(),
            target_root,
            root_identity,
        };

        self.lifecycle = GatewayState::Attached(binding);

        let success = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "targetId": target_id,
                "descriptor": descriptor_str,
            }
        });
        self.send_outbound(success).await;

        Ok(())
    }

    /// Handle `initialize`.
    async fn handle_initialize(
        &mut self,
        req_id: Option<Value>,
        _params: Value,
    ) -> Result<(), GatewayError> {
        let id = req_id.unwrap_or(Value::Null);

        let binding = match &self.lifecycle {
            GatewayState::Attached(b) => b.clone(),
            GatewayState::Unattached => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_INVALID_REQUEST,
                    "Connection must attach target before initialization (send damHopper/attachTarget first)",
                    Some("ATTACH_REQUIRED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            _ => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_INVALID_REQUEST,
                    "Session is already initialized",
                    Some("ALREADY_INITIALIZED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        // Recheck target root identity against filesystem
        let current_identity = match directory_identity(&binding.target_root) {
            Ok(ident) => ident,
            Err(_) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_TARGET_NOT_FOUND,
                    "Target root directory is no longer accessible",
                    Some("TARGET_IDENTITY_FAILED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };
        if current_identity != binding.root_identity {
            let err = json_rpc_error(
                id,
                RPC_ERR_TARGET_NOT_FOUND,
                "Target root directory identity has changed",
                Some("TARGET_IDENTITY_MODIFIED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        if !self.state.semantic_supervisor.is_enabled() {
            let err = json_rpc_error(
                id,
                RPC_ERR_SEMANTIC_DISABLED,
                "Semantic subsystem is disabled on this server",
                Some("SEMANTIC_DISABLED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // Verify admission epoch has not been invalidated
        let current_conn_epoch = self
            .state
            .semantic_supervisor
            .get_connection_epoch(&self.connection_id)
            .await;
        if current_conn_epoch != Some(self.admission_epoch) {
            let err = json_rpc_error(
                id,
                RPC_ERR_AUTH_INVALIDATED,
                "Connection admission invalidated",
                Some("AUTH_REVOKED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // Lazy session creation through supervisor
        let session_handle = match self
            .state
            .semantic_supervisor
            .get_or_create_session(
                self.connection_id.clone(),
                &binding.project,
                binding.worktree.clone(),
                binding.target_root.clone(),
                self.admission_epoch,
            )
            .await
        {
            Ok(h) => h,
            Err(SupervisorError::Disabled) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_SEMANTIC_DISABLED,
                    "Semantic subsystem is disabled",
                    Some("SEMANTIC_DISABLED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(SupervisorError::ConnectionTreeLimitExceeded(max)) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_IN_FLIGHT_FULL,
                    &format!("Per-connection semantic tree limit ({max}) exceeded"),
                    Some("CONNECTION_TREE_LIMIT"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(SupervisorError::GlobalTreeLimitExceeded(max)) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_IN_FLIGHT_FULL,
                    &format!("Global semantic tree limit ({max}) exceeded"),
                    Some("GLOBAL_TREE_LIMIT"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(_) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_INTERNAL_ERROR,
                    "Failed to spawn language server session",
                    Some("SESSION_SPAWN_FAILED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        // Initialize child TSLS
        if session_handle.initialize().await.is_err() {
            let err = json_rpc_error(
                id,
                RPC_ERR_INTERNAL_ERROR,
                "Language server initialization failed",
                Some("CHILD_INIT_FAILED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // Re-verify connection epoch after async startup
        let after_conn_epoch = self
            .state
            .semantic_supervisor
            .get_connection_epoch(&self.connection_id)
            .await;
        if after_conn_epoch != Some(self.admission_epoch) {
            let _ = session_handle.shutdown().await;
            let err = json_rpc_error(
                id,
                RPC_ERR_AUTH_INVALIDATED,
                "Connection was invalidated during initialization",
                Some("AUTH_REVOKED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        self.lifecycle = GatewayState::Initializing(binding, session_handle);

        // Fixed server-owned initialize capabilities: single Incremental sync
        let reply = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "capabilities": {
                    "textDocumentSync": 2, // TextDocumentSyncKind::Incremental
                    "definitionProvider": true,
                    "implementationProvider": true,
                }
            }
        });
        self.send_outbound(reply).await;

        Ok(())
    }

    /// Handle `initialized`.
    async fn handle_initialized(&mut self, _params: Value) -> Result<(), GatewayError> {
        match &self.lifecycle {
            GatewayState::Initializing(binding, handle) => {
                self.lifecycle = GatewayState::Ready(binding.clone(), handle.clone());
            }
            _ => {
                debug!(
                    state = self.lifecycle.name(),
                    "Ignoring unexpected initialized notification"
                );
            }
        }
        Ok(())
    }

    /// Handle `textDocument/didOpen`.
    async fn handle_did_open(&mut self, params: Value) -> Result<(), GatewayError> {
        let (binding, handle) = match &self.lifecycle {
            GatewayState::Ready(b, h) => (b.clone(), h.clone()),
            _ => return Ok(()),
        };

        let text_doc = match params.get("textDocument") {
            Some(d) => d,
            None => return Ok(()),
        };

        let uri_str = match text_doc.get("uri").and_then(|u| u.as_str()) {
            Some(u) => u,
            None => return Ok(()),
        };

        let language_id = match text_doc.get("languageId").and_then(|l| l.as_str()) {
            Some(l) => l,
            None => return Ok(()),
        };

        if !is_supported_language(language_id) {
            return Ok(());
        }

        let version = text_doc
            .get("version")
            .and_then(|v| v.as_i64())
            .unwrap_or(1);
        let text = text_doc
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .to_string();

        let parsed_uri = match parse_virtual_uri(uri_str, &binding.target_id) {
            Ok(p) => p,
            Err(e) => {
                warn!(error = ?e, uri = %uri_str, "Rejecting invalid didOpen virtual URI");
                return Ok(());
            }
        };

        let (file_url, _) = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok(res) => res,
            Err(e) => {
                warn!(error = ?e, uri = %uri_str, "Rejecting didOpen path outside target root");
                return Ok(());
            }
        };

        if let Err(e) = handle
            .did_open(file_url.to_string(), language_id.to_string(), version, text)
            .await
        {
            warn!(error = ?e, "didOpen failed on session actor; closing document to prevent desync");
            let _ = handle.did_close(file_url.to_string()).await;
        }

        Ok(())
    }

    /// Handle `textDocument/didChange`.
    async fn handle_did_change(&mut self, params: Value) -> Result<(), GatewayError> {
        let (binding, handle) = match &self.lifecycle {
            GatewayState::Ready(b, h) => (b.clone(), h.clone()),
            _ => return Ok(()),
        };

        let text_doc = match params.get("textDocument") {
            Some(d) => d,
            None => return Ok(()),
        };

        let uri_str = match text_doc.get("uri").and_then(|u| u.as_str()) {
            Some(u) => u,
            None => return Ok(()),
        };

        let version = match text_doc.get("version").and_then(|v| v.as_i64()) {
            Some(v) => v,
            None => return Ok(()),
        };

        let content_changes_val = match params.get("contentChanges").and_then(|c| c.as_array()) {
            Some(c) => c,
            None => return Ok(()),
        };

        let mut changes = Vec::with_capacity(content_changes_val.len());
        for c in content_changes_val {
            match serde_json::from_value::<TextDocumentContentChangeEvent>(c.clone()) {
                Ok(change) => changes.push(change),
                Err(e) => {
                    warn!(error = %e, "Rejecting malformed contentChange item; dropping entire didChange");
                    return Ok(());
                }
            }
        }

        let parsed_uri = match parse_virtual_uri(uri_str, &binding.target_id) {
            Ok(p) => p,
            Err(e) => {
                warn!(error = ?e, uri = %uri_str, "Rejecting invalid didChange virtual URI");
                return Ok(());
            }
        };

        let (file_url, _) = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok(res) => res,
            Err(e) => {
                warn!(error = ?e, uri = %uri_str, "Rejecting didChange path outside target root");
                return Ok(());
            }
        };

        if let Err(e) = handle
            .did_change(file_url.to_string(), version, changes)
            .await
        {
            warn!(error = ?e, "didChange failed on session actor; closing document to prevent desync");
            let _ = handle.did_close(file_url.to_string()).await;
        }
        Ok(())
    }

    /// Handle `textDocument/didClose`.
    async fn handle_did_close(&mut self, params: Value) -> Result<(), GatewayError> {
        let (binding, handle) = match &self.lifecycle {
            GatewayState::Ready(b, h) => (b.clone(), h.clone()),
            _ => return Ok(()),
        };

        let text_doc = match params.get("textDocument") {
            Some(d) => d,
            None => return Ok(()),
        };

        let uri_str = match text_doc.get("uri").and_then(|u| u.as_str()) {
            Some(u) => u,
            None => return Ok(()),
        };

        let parsed_uri = match parse_virtual_uri(uri_str, &binding.target_id) {
            Ok(p) => p,
            Err(_) => return Ok(()),
        };

        let (file_url, _) = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok(res) => res,
            Err(_) => return Ok(()),
        };

        let _ = handle.did_close(file_url.to_string()).await;

        Ok(())
    }

    /// Handle `textDocument/definition` and `textDocument/implementation`.
    async fn handle_navigation(
        &mut self,
        method: &str,
        req_id: Option<Value>,
        params: Value,
    ) -> Result<(), GatewayError> {
        // Validate and bound client request ID
        let client_id = match req_id {
            Some(v) => {
                let is_valid = match &v {
                    Value::Number(n) => n.is_i64() || n.is_u64(),
                    Value::String(s) => !s.is_empty() && s.len() <= 64,
                    _ => false,
                };
                if !is_valid {
                    let err = json_rpc_error(
                        Value::Null,
                        RPC_ERR_INVALID_PARAMS,
                        "Invalid request ID: must be an integer or non-empty string up to 64 bytes",
                        Some("INVALID_REQUEST_ID"),
                    );
                    self.send_outbound(err).await;
                    return Ok(());
                }
                v
            }
            None => {
                // Navigation requires an ID; notifications cannot be navigation requests
                return Ok(());
            }
        };

        let (binding, handle) = match &self.lifecycle {
            GatewayState::Ready(b, h) => (b.clone(), h.clone()),
            _ => {
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_INVALID_REQUEST,
                    "Session is not in ready state for navigation requests",
                    Some("NOT_READY"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let is_duplicate = {
            let map = self.client_to_internal.lock().await;
            map.contains_key(&client_id)
        };
        if is_duplicate {
            let err = json_rpc_error(
                client_id,
                RPC_ERR_INVALID_REQUEST,
                "Duplicate in-flight request ID",
                Some("DUPLICATE_REQUEST_ID"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // In-flight concurrency bound check
        if self.in_flight_count.load(Ordering::Acquire) >= MAX_IN_FLIGHT_REQUESTS {
            let err = json_rpc_error(
                client_id,
                RPC_ERR_IN_FLIGHT_FULL,
                &format!(
                    "Maximum concurrent navigation requests ({MAX_IN_FLIGHT_REQUESTS}) exceeded"
                ),
                Some("IN_FLIGHT_FULL"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // Recheck target root identity against filesystem
        let current_identity = match directory_identity(&binding.target_root) {
            Ok(ident) => ident,
            Err(_) => {
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_TARGET_NOT_FOUND,
                    "Target directory is no longer accessible",
                    Some("TARGET_IDENTITY_FAILED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };
        if current_identity != binding.root_identity {
            let err = json_rpc_error(
                client_id,
                RPC_ERR_TARGET_NOT_FOUND,
                "Target root directory identity has changed",
                Some("TARGET_IDENTITY_MODIFIED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // Parse navigation parameters
        let text_doc_val = params.get("textDocument");
        let uri_str = text_doc_val
            .and_then(|d| d.get("uri"))
            .and_then(|u| u.as_str());
        let pos_val = params.get("position");
        let line = pos_val.and_then(|p| p.get("line")).and_then(|l| l.as_u64());
        let character = pos_val
            .and_then(|p| p.get("character"))
            .and_then(|c| c.as_u64());

        // Required DamHopper extension: damHopperDocumentVersion
        let doc_version = params
            .get("damHopperDocumentVersion")
            .and_then(|v| v.as_i64());

        let (uri_str, line, character, doc_version) = match (uri_str, line, character, doc_version)
        {
            (Some(u), Some(l), Some(c), Some(v)) => {
                if l > (u32::MAX as u64 / 2) || c > (u32::MAX as u64 / 2) {
                    let err = json_rpc_error(
                        client_id,
                        RPC_ERR_INVALID_PARAMS,
                        "Position coordinates exceed maximum boundary",
                        Some("INVALID_COORDINATES"),
                    );
                    self.send_outbound(err).await;
                    return Ok(());
                }
                (u, l as u32, c as u32, v)
            }
            _ => {
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_INVALID_PARAMS,
                    "Missing required navigation parameters: textDocument.uri, position, or damHopperDocumentVersion",
                    Some("INVALID_PARAMS"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let parsed_uri = match parse_virtual_uri(uri_str, &binding.target_id) {
            Ok(p) => p,
            Err(e) => {
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_INVALID_PARAMS,
                    &format!("Invalid virtual URI: {e}"),
                    Some("INVALID_URI"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let (file_url, _) = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok(res) => res,
            Err(e) => {
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_INVALID_PARAMS,
                    &format!("URI resolves outside target: {e}"),
                    Some("OUTSIDE_TARGET"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let nav_params = NavigationParams {
            text_document: TextDocumentIdentifier {
                uri: file_url.to_string(),
            },
            position: Position { line, character },
            dam_hopper_document_version: doc_version,
            dam_hopper_model_generation: params
                .get("damHopperModelGeneration")
                .and_then(|g| g.as_u64()),
        };

        // Allocate internal ID and register in maps
        let internal_id = self.next_internal_id;
        self.next_internal_id = self.next_internal_id.wrapping_add(1);
        {
            self.client_to_internal
                .lock()
                .await
                .insert(client_id.clone(), internal_id);
            self.internal_to_client
                .lock()
                .await
                .insert(internal_id, client_id.clone());
        }

        // Submit to session handle without blocking the reader loop
        let rx = match handle
            .submit_navigation(Value::from(internal_id), method, nav_params)
            .await
        {
            Ok(receiver) => receiver,
            Err(SessionError::StaleDocumentVersion { current, requested }) => {
                self.client_to_internal.lock().await.remove(&client_id);
                self.internal_to_client.lock().await.remove(&internal_id);
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_STALE_VERSION,
                    &format!(
                        "Stale document version: overlay is version {current}, request was for {requested}"
                    ),
                    Some("STALE_VERSION"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(SessionError::InFlightQueueFull { count, max }) => {
                self.client_to_internal.lock().await.remove(&client_id);
                self.internal_to_client.lock().await.remove(&internal_id);
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_IN_FLIGHT_FULL,
                    &format!("In-flight queue full ({count} >= {max})"),
                    Some("IN_FLIGHT_FULL"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(_) => {
                self.client_to_internal.lock().await.remove(&client_id);
                self.internal_to_client.lock().await.remove(&internal_id);
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_INTERNAL_ERROR,
                    "Navigation request submission failed",
                    Some("NAVIGATION_FAILED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        // Spawn asynchronous completion worker
        self.in_flight_count.fetch_add(1, Ordering::SeqCst);
        let in_flight_counter = Arc::clone(&self.in_flight_count);
        let out_tx = self.outbound_tx.clone();
        let target_id = binding.target_id.clone();
        let target_root = binding.target_root.clone();
        let client_map = Arc::clone(&self.client_to_internal);
        let internal_map = Arc::clone(&self.internal_to_client);

        tokio::spawn(async move {
            struct InFlightGuard(Arc<AtomicUsize>);
            impl Drop for InFlightGuard {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::SeqCst);
                }
            }
            let _guard = InFlightGuard(in_flight_counter);

            let raw_res = rx.await;
            let c_id = {
                let mut map = internal_map.lock().await;
                let cid = map.remove(&internal_id).unwrap_or(Value::Null);
                client_map.lock().await.remove(&cid);
                cid
            };

            match raw_res {
                Ok(Ok(raw_result)) => {
                    let sanitized =
                        filter_location_or_link_result(&raw_result, &target_id, &target_root)
                            .unwrap_or(Value::Null);

                    let response = json!({
                        "jsonrpc": "2.0",
                        "id": c_id,
                        "result": sanitized,
                    });
                    let _ = tokio::time::timeout(
                        SOCKET_SEND_TIMEOUT,
                        out_tx.send(response.to_string()),
                    )
                    .await;
                }
                Ok(Err(SessionError::StaleDocumentVersion { current, requested })) => {
                    let err = json_rpc_error(
                        c_id,
                        RPC_ERR_STALE_VERSION,
                        &format!(
                            "Stale document version: current {current}, requested {requested}"
                        ),
                        Some("STALE_VERSION"),
                    );
                    let _ = tokio::time::timeout(SOCKET_SEND_TIMEOUT, out_tx.send(err.to_string()))
                        .await;
                }
                Ok(Err(SessionError::Timeout)) => {
                    let err = json_rpc_error(
                        c_id,
                        RPC_ERR_INTERNAL_ERROR,
                        "Navigation request timed out",
                        Some("TIMEOUT"),
                    );
                    let _ = tokio::time::timeout(SOCKET_SEND_TIMEOUT, out_tx.send(err.to_string()))
                        .await;
                }
                Ok(Err(SessionError::Invalidated)) => {
                    let err = json_rpc_error(
                        c_id,
                        RPC_ERR_AUTH_INVALIDATED,
                        "Session invalidated",
                        Some("AUTH_REVOKED"),
                    );
                    let _ = tokio::time::timeout(SOCKET_SEND_TIMEOUT, out_tx.send(err.to_string()))
                        .await;
                }
                Ok(Err(_)) => {
                    let err = json_rpc_error(
                        c_id,
                        RPC_ERR_INTERNAL_ERROR,
                        "Navigation request failed",
                        Some("NAVIGATION_ERROR"),
                    );
                    let _ = tokio::time::timeout(SOCKET_SEND_TIMEOUT, out_tx.send(err.to_string()))
                        .await;
                }
                Err(_) => {
                    let err = json_rpc_error(
                        c_id,
                        RPC_ERR_INTERNAL_ERROR,
                        "Request terminated before response was produced",
                        Some("SESSION_CLOSED"),
                    );
                    let _ = tokio::time::timeout(SOCKET_SEND_TIMEOUT, out_tx.send(err.to_string()))
                        .await;
                }
            }
        });

        Ok(())
    }

    /// Handle `$/cancelRequest`.
    async fn handle_cancel_request(&mut self, params: Value) -> Result<(), GatewayError> {
        let handle = match &self.lifecycle {
            GatewayState::Ready(_, h) => h.clone(),
            _ => return Ok(()),
        };

        if let Some(cancel_id) = params.get("id") {
            let internal_id_opt = {
                let map = self.client_to_internal.lock().await;
                map.get(cancel_id).copied()
            };
            if let Some(internal_id) = internal_id_opt {
                handle.cancel_request(Value::from(internal_id)).await;
            }
        }

        Ok(())
    }

    /// Handle `shutdown`.
    async fn handle_shutdown(&mut self, req_id: Option<Value>) -> Result<(), GatewayError> {
        let id = req_id.unwrap_or(Value::Null);

        match std::mem::replace(&mut self.lifecycle, GatewayState::Terminated) {
            GatewayState::Ready(binding, handle) | GatewayState::Initializing(binding, handle) => {
                let _ = handle.shutdown().await;
                self.lifecycle = GatewayState::ShuttingDown(binding, handle);
                let reply = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": Value::Null,
                });
                self.send_outbound(reply).await;
            }
            other => {
                self.lifecycle = other;
                let err = json_rpc_error(
                    id,
                    RPC_ERR_INVALID_REQUEST,
                    "Session is not ready to shut down",
                    None,
                );
                self.send_outbound(err).await;
            }
        }

        Ok(())
    }

    /// Handle `exit`.
    async fn handle_exit(&mut self) -> Result<(), GatewayError> {
        self.teardown().await;
        Ok(())
    }

    /// Teardown and cleanup on connection close or live auth invalidation.
    pub async fn teardown(&mut self) {
        self.lifecycle = GatewayState::Terminated;
        self.client_to_internal.lock().await.clear();
        self.internal_to_client.lock().await.clear();
        self.state
            .semantic_supervisor
            .invalidate_connection(&self.connection_id)
            .await;
        self.state
            .semantic_supervisor
            .release_connection(&self.connection_id)
            .await;
    }

    /// Send formatted JSON-RPC message to the outbound channel within SOCKET_SEND_TIMEOUT.
    async fn send_outbound(&mut self, msg: Value) {
        let text = msg.to_string();
        if tokio::time::timeout(SOCKET_SEND_TIMEOUT, self.outbound_tx.send(text))
            .await
            .is_err()
        {
            warn!(
                "Outbound queue send timed out or closed; terminating gateway and releasing session"
            );
            self.teardown().await;
        }
    }
}

/// Helper to build a standard compliant JSON-RPC 2.0 error object.
pub fn json_rpc_error(id: Value, code: i64, message: &str, dam_hopper_code: Option<&str>) -> Value {
    let mut err_obj = json!({
        "code": code,
        "message": message,
    });

    if let Some(dh_code) = dam_hopper_code {
        err_obj.as_object_mut().unwrap().insert(
            "data".to_string(),
            json!({
                "damHopperCode": dh_code
            }),
        );
    }

    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": err_obj,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_rpc_error_formatting() {
        let err = json_rpc_error(
            Value::from(42),
            RPC_ERR_METHOD_NOT_FOUND,
            "Method not found",
            Some("METHOD_NOT_FOUND"),
        );

        assert_eq!(err["jsonrpc"], "2.0");
        assert_eq!(err["id"], 42);
        assert_eq!(err["error"]["code"], RPC_ERR_METHOD_NOT_FOUND);
        assert_eq!(err["error"]["message"], "Method not found");
        assert_eq!(err["error"]["data"]["damHopperCode"], "METHOD_NOT_FOUND");
    }

    #[test]
    fn test_gateway_state_names() {
        assert_eq!(GatewayState::Unattached.name(), "unattached");
        assert_eq!(GatewayState::Terminated.name(), "terminated");
    }
}
