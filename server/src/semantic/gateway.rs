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
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;
use tracing::{debug, warn};
use url::Url;

use super::outbound::OutboundSender;
use super::protocol::{
    contains_forbidden_override_field, is_allowed_semantic_method, is_notification_method,
    is_request_method, is_supported_language, language_id_for_path, object_has_only_keys,
    validate_request_id, ConnectionId, NavigationParams, Position, TextDocumentContentChangeEvent,
    TextDocumentIdentifier, METHOD_CANCEL_REQUEST, METHOD_DEFINITION, METHOD_DID_CHANGE,
    METHOD_DID_CLOSE, METHOD_DID_OPEN, METHOD_EXIT, METHOD_IMPLEMENTATION, METHOD_INITIALIZE,
    METHOD_INITIALIZED, METHOD_SHUTDOWN,
};
use super::resources::{
    ADAPTIVE_SYNC_THRESHOLD_BYTES, MAX_DOCUMENT_BYTES, MAX_IN_FLIGHT_REQUESTS,
    MAX_OPEN_DOCUMENTS_PER_SESSION, MAX_SESSION_OVERLAY_BYTES, NAVIGATION_REQUEST_TIMEOUT,
    RESOURCE_POLICY_VERSION, SOCKET_SEND_TIMEOUT,
};
use super::session::{RevocationToken, SemanticSessionHandle, SessionError};
use super::supervisor::SupervisorError;
use super::uri::{
    compute_text_sha256, extract_in_target_destination_uris,
    filter_location_or_link_result_with_provenance, parse_virtual_uri, project_disk_text_for_pin,
    unwrap_lsp_result_payload, validate_range, virtual_uri_to_file_uri, DestinationProvenance,
    UriMediationError,
};
use crate::api::auth::AuthenticatedActor;
use crate::fs::secure_path::{directory_identity, DirectoryIdentity};
use crate::state::AppState;
use crate::workspace_target::ProjectTargetRef;
#[cfg(any(test, feature = "test-support"))]
pub mod test_barriers {
    use tokio::sync::Notify;
    use std::sync::LazyLock;

    pub static F3_PAUSE_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
    pub static F3_RESUME_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
    pub static F3_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub static F9_GAP_PAUSE_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
    pub static F9_GAP_RESUME_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
    pub static F9_GAP_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub static F9_STAGE2_PAUSE_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
    pub static F9_STAGE2_RESUME_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
    pub static F9_STAGE2_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub fn reset() {
        F3_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
        F9_GAP_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
        F9_STAGE2_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    pub struct BarrierGuard;
    impl Drop for BarrierGuard {
        fn drop(&mut self) {
            reset();
        }
    }
}


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
pub const RPC_ERR_REQUEST_CANCELLED: i64 = -32800;

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

/// In-flight logical navigation request ownership and child tracking.
#[derive(Debug, Clone)]
pub struct LogicalNavigationEntry {
    pub active_child_id: Option<u64>,
    pub cancelled: bool,
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
    client_to_logical: Arc<Mutex<HashMap<Value, LogicalNavigationEntry>>>,
    internal_to_client: Arc<Mutex<HashMap<u64, Value>>>,
    next_internal_id: Arc<AtomicU64>,
    open_docs: Arc<Mutex<HashMap<String, (i64, u64)>>>,
    next_doc_incarnation: u64,
    session_revocation: Arc<std::sync::RwLock<Option<RevocationToken>>>,
    outbound_tx: OutboundSender,
}

impl SemanticGateway {
    pub fn new(
        connection_id: ConnectionId,
        state: AppState,
        actor: AuthenticatedActor,
        admission_epoch: u64,
        outbound_tx: OutboundSender,
    ) -> Self {
        Self {
            connection_id,
            state,
            actor,
            admission_epoch,
            lifecycle: GatewayState::Unattached,
            in_flight_count: Arc::new(AtomicUsize::new(0)),
            client_to_logical: Arc::new(Mutex::new(HashMap::new())),
            internal_to_client: Arc::new(Mutex::new(HashMap::new())),
            next_internal_id: Arc::new(AtomicU64::new(1_000_000)),
            open_docs: Arc::new(Mutex::new(HashMap::new())),
            next_doc_incarnation: 0,
            session_revocation: Arc::new(std::sync::RwLock::new(None)),
            outbound_tx,
        }
    }

    /// Shared handle to the active session's immediate revocation token for writer/watcher fencing.
    pub fn session_revocation_handle(&self) -> Arc<std::sync::RwLock<Option<RevocationToken>>> {
        Arc::clone(&self.session_revocation)
    }

    /// Returns true if the gateway has transitioned to the `Terminated` state.
    pub fn is_terminated(&self) -> bool {
        matches!(self.lifecycle, GatewayState::Terminated)
    }

    async fn is_authority_revoked(&self, handle_opt: Option<&SemanticSessionHandle>) -> bool {
        if !self.state.semantic_supervisor.is_enabled() {
            return true;
        }
        if let Some(h) = handle_opt {
            if h.is_revoked() {
                return true;
            }
        }
        if let Ok(guard) = self.session_revocation.read() {
            if let Some(tok) = guard.as_ref() {
                if tok.is_revoked() {
                    return true;
                }
            }
        }
        let current_epoch = self
            .state
            .semantic_supervisor
            .get_connection_epoch(&self.connection_id)
            .await;
        current_epoch != Some(self.admission_epoch)
    }

    async fn evict_document_overlay(&self, handle: &SemanticSessionHandle, file_url: &str) {
        self.open_docs.lock().await.remove(file_url);
        let _ = handle.did_close(file_url.to_string()).await;
    }

    async fn close_document_from_params_if_resolvable(&self, params: &Value) {
        let (binding, handle) = match &self.lifecycle {
            GatewayState::Ready(b, h) => (b.clone(), h.clone()),
            _ => return,
        };
        let Some(uri_str) = params
            .get("textDocument")
            .and_then(|d| d.get("uri"))
            .and_then(|u| u.as_str())
        else {
            return;
        };
        let Ok(parsed_uri) = parse_virtual_uri(uri_str, &binding.target_id) else {
            return;
        };
        let file_url_str = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok((u, _)) => u.to_string(),
            Err(_) => {
                let candidate = binding.target_root.join(&parsed_uri.relative_path);
                match Url::from_file_path(&candidate) {
                    Ok(u) => u.to_string(),
                    Err(_) => return,
                }
            }
        };
        self.evict_document_overlay(&handle, &file_url_str).await;
    }

    /// Process a single incoming raw text message from the WebSocket reader.
    pub async fn handle_incoming_text(&mut self, text: &str) -> Result<(), GatewayError> {
        if self.is_terminated() || self.outbound_tx.is_closed() {
            return Err(GatewayError::InvalidState("Gateway is terminated".into()));
        }

        let map = match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(map)) => map,
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

        // Validate `id` first: never echo an invalid ID on any response path (W-C)
        let raw_id = map.get("id").cloned();
        if let Some(id_val) = &raw_id {
            if !validate_request_id(id_val) {
                let err_res = json_rpc_error(
                    Value::Null,
                    RPC_ERR_INVALID_PARAMS,
                    "Invalid request ID: must be an integer or non-empty string up to 64 bytes",
                    Some("INVALID_REQUEST_ID"),
                );
                self.send_outbound(err_res).await;
                return Ok(());
            }
        }

        if !object_has_only_keys(&map, &["jsonrpc", "id", "method", "params"]) {
            let err_res = json_rpc_error(
                raw_id.unwrap_or(Value::Null),
                RPC_ERR_INVALID_REQUEST,
                "Unknown or forbidden top-level field in JSON-RPC message",
                Some("UNKNOWN_FIELD"),
            );
            self.send_outbound(err_res).await;
            return Ok(());
        }

        if map.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
            let err_res = json_rpc_error(
                raw_id.unwrap_or(Value::Null),
                RPC_ERR_INVALID_REQUEST,
                "Invalid or missing jsonrpc version '2.0'",
                Some("INVALID_JSONRPC"),
            );
            self.send_outbound(err_res).await;
            return Ok(());
        }

        let method = match map.get("method").and_then(|m| m.as_str()) {
            Some(m) => m,
            None => {
                let err_res = json_rpc_error(
                    raw_id.unwrap_or(Value::Null),
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
            if let Some(id) = raw_id {
                let err_res = json_rpc_error(
                    id,
                    RPC_ERR_METHOD_NOT_FOUND,
                    &format!("Method '{method}' is not supported in semantic filtered profile"),
                    Some("METHOD_NOT_FOUND"),
                );
                self.send_outbound(err_res).await;
            }
            return Ok(());
        }

        let params = map.get("params").cloned().unwrap_or(Value::Null);

        // Enforce strict request-vs-notification ID rules (W-C)
        if is_request_method(method) && raw_id.is_none() {
            debug!(method = %method, "Dropping notification-style message for request-only method");
            return Ok(());
        }
        if is_notification_method(method) && raw_id.is_some() {
            if method == METHOD_DID_OPEN || method == METHOD_DID_CHANGE {
                self.close_document_from_params_if_resolvable(&params).await;
            }
            let err_res = json_rpc_error(
                raw_id.unwrap_or(Value::Null),
                RPC_ERR_INVALID_REQUEST,
                "Notification method must not include a request ID",
                Some("UNEXPECTED_NOTIFICATION_ID"),
            );
            self.send_outbound(err_res).await;
            return Ok(());
        }

        match method {
            METHOD_ATTACH_TARGET => self.handle_attach_target(raw_id.unwrap(), params).await?,
            METHOD_INITIALIZE => self.handle_initialize(raw_id.unwrap(), params).await?,
            METHOD_INITIALIZED => self.handle_initialized(params).await?,
            METHOD_DID_OPEN => self.handle_did_open(params).await?,
            METHOD_DID_CHANGE => self.handle_did_change(params).await?,
            METHOD_DID_CLOSE => self.handle_did_close(params).await?,
            METHOD_DEFINITION | METHOD_IMPLEMENTATION => {
                self.handle_navigation(method, raw_id.unwrap(), params)
                    .await?
            }
            METHOD_CANCEL_REQUEST => self.handle_cancel_request(params).await?,
            METHOD_SHUTDOWN => self.handle_shutdown(raw_id.unwrap(), params).await?,
            METHOD_EXIT => self.handle_exit().await?,
            _ => {}
        }

        Ok(())
    }

    /// Handle `damHopper/attachTarget`.
    async fn handle_attach_target(&mut self, id: Value, params: Value) -> Result<(), GatewayError> {
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

        let Some(params_obj) = params.as_object() else {
            let err = json_rpc_error(
                id,
                RPC_ERR_INVALID_PARAMS,
                "Attach parameters must be a JSON object",
                Some("INVALID_PARAMS"),
            );
            self.send_outbound(err).await;
            return Ok(());
        };
        if !object_has_only_keys(params_obj, &["target", "descriptor"])
            || contains_forbidden_override_field(&params)
        {
            let err = json_rpc_error(
                id,
                RPC_ERR_INVALID_PARAMS,
                "Unknown or forbidden field in attachTarget parameters",
                Some("UNKNOWN_ATTACH_FIELD"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        let Some(target_map) = params.get("target").and_then(|t| t.as_object()) else {
            let err = json_rpc_error(
                id,
                RPC_ERR_INVALID_PARAMS,
                "Missing or invalid 'target' object in attachTarget parameters",
                Some("INVALID_PARAMS"),
            );
            self.send_outbound(err).await;
            return Ok(());
        };
        if !object_has_only_keys(target_map, &["project", "worktreePath"]) {
            let err = json_rpc_error(
                id,
                RPC_ERR_INVALID_PARAMS,
                "Unknown or forbidden field in attachTarget target descriptor",
                Some("UNKNOWN_ATTACH_FIELD"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        if let Some(wt_val) = target_map.get("worktreePath") {
            if !wt_val.is_null() && wt_val.as_str().map(|s| s.trim().is_empty()).unwrap_or(true) {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_INVALID_PARAMS,
                    "Invalid 'target.worktreePath' parameter",
                    Some("INVALID_PARAMS"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
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

        if self
            .state
            .semantic_supervisor
            .get_connection_epoch(&self.connection_id)
            .await
            != Some(self.admission_epoch)
        {
            let err = json_rpc_error(
                id,
                RPC_ERR_AUTH_INVALIDATED,
                "Connection admission invalidated",
                Some("AUTH_REVOKED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

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

        let target_path = resolved_target.target_path();
        if std::fs::symlink_metadata(target_path)
            .map(|m| m.file_type().is_symlink() || !m.is_dir())
            .unwrap_or(true)
        {
            let err = json_rpc_error(
                id,
                RPC_ERR_TARGET_NOT_FOUND,
                "Target directory does not exist or cannot be accessed",
                Some("TARGET_NOT_FOUND"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        let target_root = match dunce::canonicalize(target_path) {
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
        let canonical_worktree = if resolved_target.is_root() {
            None
        } else {
            resolved_target
                .worktree()
                .map(|wt| wt.path.clone())
                .or(worktree_path)
        };

        let binding = TargetBinding {
            project: project_str,
            worktree: canonical_worktree,
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
                "adaptiveSyncThresholdBytes": ADAPTIVE_SYNC_THRESHOLD_BYTES,
                "maxDocumentBytes": MAX_DOCUMENT_BYTES,
                "maxOpenDocuments": MAX_OPEN_DOCUMENTS_PER_SESSION,
                "maxSessionOverlayBytes": MAX_SESSION_OVERLAY_BYTES,
                "maxInFlightRequests": MAX_IN_FLIGHT_REQUESTS,
                "resourcePolicyVersion": RESOURCE_POLICY_VERSION,
            }
        });
        self.send_outbound(success).await;

        Ok(())
    }

    /// Handle `initialize`.
    async fn handle_initialize(&mut self, id: Value, params: Value) -> Result<(), GatewayError> {
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

        // Reject forbidden override/command/root/initializationOptions fields before child spawn
        let init_params_valid = match &params {
            Value::Null => true,
            Value::Object(map) => {
                let allowed_keys = &[
                    "processId",
                    "clientInfo",
                    "locale",
                    "rootPath",
                    "rootUri",
                    "capabilities",
                    "trace",
                    "workspaceFolders",
                    "initializationOptions",
                ];
                let only_allowed = object_has_only_keys(map, allowed_keys);
                let no_root_override = map.get("rootPath").map_or(true, Value::is_null)
                    && map.get("rootUri").map_or(true, Value::is_null)
                    && map.get("workspaceFolders").map_or(true, Value::is_null)
                    && map
                        .get("initializationOptions")
                        .map_or(true, Value::is_null);
                only_allowed && no_root_override && !contains_forbidden_override_field(&params)
            }
            _ => false,
        };
        if !init_params_valid {
            let err = json_rpc_error(
                id,
                RPC_ERR_INVALID_PARAMS,
                "Forbidden or invalid field in initialize parameters (custom root, options, or commands are prohibited)",
                Some("FORBIDDEN_INITIALIZE_FIELD"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        if std::fs::symlink_metadata(&binding.target_root)
            .map(|m| m.file_type().is_symlink() || !m.is_dir())
            .unwrap_or(true)
        {
            let err = json_rpc_error(
                id,
                RPC_ERR_TARGET_NOT_FOUND,
                "Target root directory identity has changed",
                Some("TARGET_IDENTITY_MODIFIED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

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
        if let Ok(mut guard) = self.session_revocation.write() {
            *guard = Some(session_handle.revocation_token().clone());
        }

        if session_handle.is_revoked() || self.is_authority_revoked(Some(&session_handle)).await {
            let _ = session_handle.shutdown().await;
            let err = json_rpc_error(
                id,
                RPC_ERR_AUTH_INVALIDATED,
                "Connection or target was invalidated before initialization",
                Some("AUTH_REVOKED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // Initialize child TSLS
        match session_handle.initialize().await {
            Ok(()) => {}
            Err(SessionError::Invalidated) => {
                let err = json_rpc_error(
                    id,
                    RPC_ERR_AUTH_INVALIDATED,
                    "Session was invalidated during initialization",
                    Some("AUTH_REVOKED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(_) => {
                if session_handle.is_revoked()
                    || self.is_authority_revoked(Some(&session_handle)).await
                {
                    let err = json_rpc_error(
                        id,
                        RPC_ERR_AUTH_INVALIDATED,
                        "Session was invalidated during initialization",
                        Some("AUTH_REVOKED"),
                    );
                    self.send_outbound(err).await;
                    return Ok(());
                }
                let err = json_rpc_error(
                    id,
                    RPC_ERR_INTERNAL_ERROR,
                    "Language server initialization failed",
                    Some("CHILD_INIT_FAILED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        }

        // Re-verify immediate revocation token and connection epoch after async startup
        if session_handle.is_revoked() || self.is_authority_revoked(Some(&session_handle)).await {
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

        // Fixed server-owned initialize capabilities: single Incremental sync + negotiated policy
        let reply = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "capabilities": {
                    "textDocumentSync": 2, // TextDocumentSyncKind::Incremental
                    "definitionProvider": true,
                    "implementationProvider": true,
                    "experimental": {
                        "damHopperAdaptiveSync": {
                            "version": RESOURCE_POLICY_VERSION,
                            "thresholdBytes": ADAPTIVE_SYNC_THRESHOLD_BYTES,
                            "maxDocumentBytes": MAX_DOCUMENT_BYTES,
                            "maxOpenDocuments": MAX_OPEN_DOCUMENTS_PER_SESSION,
                            "maxSessionOverlayBytes": MAX_SESSION_OVERLAY_BYTES,
                            "maxInFlightRequests": MAX_IN_FLIGHT_REQUESTS,
                        }
                    }
                }
            }
        });
        self.send_outbound(reply).await;

        Ok(())
    }

    /// Handle `initialized`.
    async fn handle_initialized(&mut self, params: Value) -> Result<(), GatewayError> {
        let valid_params = match &params {
            Value::Null => true,
            Value::Object(map) => map.is_empty(),
            _ => false,
        };
        if !valid_params {
            return Ok(());
        }
        match &self.lifecycle {
            GatewayState::Initializing(binding, handle) => {
                if handle.is_revoked() || self.is_authority_revoked(Some(handle)).await {
                    return Ok(());
                }
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

        if handle.is_revoked() || self.is_authority_revoked(Some(&handle)).await {
            return Ok(());
        }

        let Some(text_doc) = params.get("textDocument") else {
            return Ok(());
        };
        let Some(uri_str) = text_doc.get("uri").and_then(|u| u.as_str()) else {
            return Ok(());
        };

        let parsed_uri = match parse_virtual_uri(uri_str, &binding.target_id) {
            Ok(p) => p,
            Err(e) => {
                warn!(error = ?e, "Rejecting invalid didOpen virtual URI");
                return Ok(());
            }
        };

        let fallback_file_url =
            Url::from_file_path(binding.target_root.join(&parsed_uri.relative_path))
                .ok()
                .map(|u| u.to_string());

        if std::fs::symlink_metadata(&binding.target_root)
            .map(|m| m.file_type().is_symlink() || !m.is_dir())
            .unwrap_or(true)
            || directory_identity(&binding.target_root).ok() != Some(binding.root_identity)
        {
            if let Some(f_url) = &fallback_file_url {
                self.evict_document_overlay(&handle, f_url).await;
            }
            return Ok(());
        }

        let (file_url, _) = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok(res) => res,
            Err(e) => {
                warn!(error = ?e, "Rejecting didOpen path outside target root");
                if let Some(f_url) = &fallback_file_url {
                    self.evict_document_overlay(&handle, f_url).await;
                }
                return Ok(());
            }
        };
        let file_url_str = file_url.to_string();

        // Once file_url_str is resolved, any validation rejection MUST close/evict any overlay (W-D)
        let params_valid = params
            .as_object()
            .map(|m| object_has_only_keys(m, &["textDocument"]))
            .unwrap_or(false)
            && text_doc
                .as_object()
                .map(|m| object_has_only_keys(m, &["uri", "languageId", "version", "text"]))
                .unwrap_or(false)
            && !contains_forbidden_override_field(&params);
        if !params_valid {
            warn!("Rejecting didOpen with malformed or forbidden fields; closing document overlay");
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        }

        let Some(language_id) = text_doc.get("languageId").and_then(|l| l.as_str()) else {
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        };
        if !is_supported_language(language_id) {
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        }

        let Some(version) = text_doc.get("version").and_then(|v| v.as_i64()) else {
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        };
        if version < 1 {
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        }

        let Some(text) = text_doc.get("text").and_then(|t| t.as_str()) else {
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        };
        if text.len() > MAX_DOCUMENT_BYTES {
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        }

        self.next_doc_incarnation = self.next_doc_incarnation.wrapping_add(1);
        let doc_inc = self.next_doc_incarnation;
        self.open_docs
            .lock()
            .await
            .insert(file_url_str.clone(), (version, doc_inc));

        if let Err(e) = handle
            .did_open(
                file_url_str.clone(),
                language_id.to_string(),
                version,
                text.to_string(),
            )
            .await
        {
            warn!(error = ?e, "didOpen failed on session actor; closing document to prevent desync");
            self.evict_document_overlay(&handle, &file_url_str).await;
        }

        Ok(())
    }

    /// Handle `textDocument/didChange`.
    async fn handle_did_change(&mut self, params: Value) -> Result<(), GatewayError> {
        let (binding, handle) = match &self.lifecycle {
            GatewayState::Ready(b, h) => (b.clone(), h.clone()),
            _ => return Ok(()),
        };

        if handle.is_revoked() || self.is_authority_revoked(Some(&handle)).await {
            return Ok(());
        }

        let Some(text_doc) = params.get("textDocument") else {
            return Ok(());
        };
        let Some(uri_str) = text_doc.get("uri").and_then(|u| u.as_str()) else {
            return Ok(());
        };

        let parsed_uri = match parse_virtual_uri(uri_str, &binding.target_id) {
            Ok(p) => p,
            Err(e) => {
                warn!(error = ?e, "Rejecting invalid didChange virtual URI");
                return Ok(());
            }
        };

        let fallback_file_url =
            Url::from_file_path(binding.target_root.join(&parsed_uri.relative_path))
                .ok()
                .map(|u| u.to_string());

        if std::fs::symlink_metadata(&binding.target_root)
            .map(|m| m.file_type().is_symlink() || !m.is_dir())
            .unwrap_or(true)
            || directory_identity(&binding.target_root).ok() != Some(binding.root_identity)
        {
            if let Some(f_url) = &fallback_file_url {
                self.evict_document_overlay(&handle, f_url).await;
            }
            return Ok(());
        }

        let (file_url, _) = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok(res) => res,
            Err(e) => {
                warn!(error = ?e, "Rejecting didChange path outside target root");
                if let Some(f_url) = &fallback_file_url {
                    self.evict_document_overlay(&handle, f_url).await;
                }
                return Ok(());
            }
        };
        let file_url_str = file_url.to_string();

        // Validate structure and fields; any failure evicts the overlay (W-D)
        let structure_valid = params
            .as_object()
            .map(|m| object_has_only_keys(m, &["textDocument", "contentChanges"]))
            .unwrap_or(false)
            && text_doc
                .as_object()
                .map(|m| object_has_only_keys(m, &["uri", "version"]))
                .unwrap_or(false)
            && !contains_forbidden_override_field(&params);
        if !structure_valid {
            warn!("Rejecting didChange with unknown or forbidden fields; closing document to prevent desync");
            self.evict_document_overlay(&handle, &file_url_str).await;
            return Ok(());
        }

        let version = match text_doc.get("version").and_then(|v| v.as_i64()) {
            Some(v) if v >= 1 => v,
            _ => {
                warn!(
                    "Missing or invalid version in didChange; closing document to prevent desync"
                );
                self.evict_document_overlay(&handle, &file_url_str).await;
                return Ok(());
            }
        };

        let content_changes_val = match params.get("contentChanges").and_then(|c| c.as_array()) {
            Some(c) if !c.is_empty() => c,
            _ => {
                warn!("Missing or empty contentChanges in didChange; closing document to prevent desync");
                self.evict_document_overlay(&handle, &file_url_str).await;
                return Ok(());
            }
        };

        let mut changes = Vec::with_capacity(content_changes_val.len());
        for c in content_changes_val {
            let item_keys_ok = c
                .as_object()
                .map(|m| object_has_only_keys(m, &["range", "rangeLength", "text"]))
                .unwrap_or(false);
            if !item_keys_ok {
                warn!("Rejecting contentChange item with unknown fields; closing document to prevent desync");
                self.evict_document_overlay(&handle, &file_url_str).await;
                return Ok(());
            }
            match serde_json::from_value::<TextDocumentContentChangeEvent>(c.clone()) {
                Ok(change) => {
                    if change.text.len() > MAX_DOCUMENT_BYTES {
                        self.evict_document_overlay(&handle, &file_url_str).await;
                        return Ok(());
                    }
                    if let Some(r) = &change.range {
                        if validate_range(r).is_err() {
                            self.evict_document_overlay(&handle, &file_url_str).await;
                            return Ok(());
                        }
                    }
                    changes.push(change);
                }
                Err(e) => {
                    warn!(error = %e, "Rejecting malformed contentChange item; closing document to prevent desync");
                    self.evict_document_overlay(&handle, &file_url_str).await;
                    return Ok(());
                }
            }
        }

        {
            let mut docs = self.open_docs.lock().await;
            if let Some(entry) = docs.get_mut(&file_url_str) {
                entry.0 = version;
            } else {
                drop(docs);
                self.evict_document_overlay(&handle, &file_url_str).await;
                return Ok(());
            }
        }

        if let Err(e) = handle
            .did_change(file_url_str.clone(), version, changes)
            .await
        {
            warn!(error = ?e, "didChange failed on session actor; closing document to prevent desync");
            self.evict_document_overlay(&handle, &file_url_str).await;
        }
        Ok(())
    }

    /// Handle `textDocument/didClose`.
    async fn handle_did_close(&mut self, params: Value) -> Result<(), GatewayError> {
        let (binding, handle) = match &self.lifecycle {
            GatewayState::Ready(b, h) => (b.clone(), h.clone()),
            _ => return Ok(()),
        };

        let Some(text_doc) = params.get("textDocument") else {
            return Ok(());
        };
        let Some(uri_str) = text_doc.get("uri").and_then(|u| u.as_str()) else {
            return Ok(());
        };
        let Ok(parsed_uri) = parse_virtual_uri(uri_str, &binding.target_id) else {
            return Ok(());
        };

        let file_url_str = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok((u, _)) => u.to_string(),
            Err(_) => {
                let candidate = binding.target_root.join(&parsed_uri.relative_path);
                match Url::from_file_path(&candidate) {
                    Ok(u) => u.to_string(),
                    Err(_) => return Ok(()),
                }
            }
        };

        self.evict_document_overlay(&handle, &file_url_str).await;
        Ok(())
    }

    /// Handle `textDocument/definition` and `textDocument/implementation`.
    async fn handle_navigation(
        &mut self,
        method: &str,
        client_id: Value,
        params: Value,
    ) -> Result<(), GatewayError> {
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

        // Immediate RevocationToken check at request admission (Phase 08 C2 / Phase 09)
        if handle.is_revoked() || self.is_authority_revoked(Some(&handle)).await {
            let err = json_rpc_error(
                client_id,
                RPC_ERR_AUTH_INVALIDATED,
                "Session invalidated: connection or target changed",
                Some("AUTH_INVALIDATED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        // Reject unknown or command-like fields on navigation params
        let nav_fields_valid = params
            .as_object()
            .map(|m| {
                object_has_only_keys(
                    m,
                    &[
                        "textDocument",
                        "position",
                        "damHopperDocumentVersion",
                        "damHopperModelGeneration",
                    ],
                )
            })
            .unwrap_or(false)
            && params
                .get("textDocument")
                .and_then(|d| d.as_object())
                .map(|m| object_has_only_keys(m, &["uri"]))
                .unwrap_or(true)
            && params
                .get("position")
                .and_then(|p| p.as_object())
                .map(|m| object_has_only_keys(m, &["line", "character"]))
                .unwrap_or(true)
            && !contains_forbidden_override_field(&params);
        if !nav_fields_valid {
            let err = json_rpc_error(
                client_id,
                RPC_ERR_INVALID_PARAMS,
                "Unknown or forbidden field in navigation parameters",
                Some("UNKNOWN_NAVIGATION_FIELD"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

        let is_duplicate = {
            let map = self.client_to_logical.lock().await;
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

        // Recheck target root identity and symlink status against filesystem
        if std::fs::symlink_metadata(&binding.target_root)
            .map(|m| m.file_type().is_symlink() || !m.is_dir())
            .unwrap_or(true)
        {
            let err = json_rpc_error(
                client_id,
                RPC_ERR_TARGET_NOT_FOUND,
                "Target root directory identity has changed",
                Some("TARGET_IDENTITY_MODIFIED"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }
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
                if l > (u32::MAX as u64 / 2) || c > (u32::MAX as u64 / 2) || v < 1 {
                    let err = json_rpc_error(
                        client_id,
                        RPC_ERR_INVALID_PARAMS,
                        "Position coordinates or version outside allowed boundary",
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
            Err(_) => {
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_INVALID_PARAMS,
                    "Invalid virtual URI",
                    Some("INVALID_URI"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };

        let (file_url, _) = match virtual_uri_to_file_uri(&parsed_uri, &binding.target_root) {
            Ok(res) => res,
            Err(_) => {
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_INVALID_PARAMS,
                    "URI resolves outside target",
                    Some("OUTSIDE_TARGET"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
        };
        let source_file_uri = file_url.to_string();

        let nav_params = NavigationParams {
            text_document: TextDocumentIdentifier {
                uri: source_file_uri.clone(),
            },
            position: Position { line, character },
            dam_hopper_document_version: doc_version,
            dam_hopper_model_generation: params
                .get("damHopperModelGeneration")
                .and_then(|g| g.as_u64()),
        };

        let open_docs_at_submit = self.open_docs.lock().await.clone();

        let internal_id = self.next_internal_id.fetch_add(1, Ordering::SeqCst);
        {
            self.client_to_logical.lock().await.insert(
                client_id.clone(),
                LogicalNavigationEntry {
                    active_child_id: Some(internal_id),
                    cancelled: false,
                },
            );
            self.internal_to_client
                .lock()
                .await
                .insert(internal_id, client_id.clone());
        }

        // Submit to session handle without blocking the reader loop
        let rx = match handle
            .submit_navigation(Value::from(internal_id), method, nav_params.clone())
            .await
        {
            Ok(receiver) => receiver,
            Err(SessionError::StaleDocumentVersion { current, requested }) => {
                self.client_to_logical.lock().await.remove(&client_id);
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
                self.client_to_logical.lock().await.remove(&client_id);
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
            Err(SessionError::Invalidated) => {
                self.client_to_logical.lock().await.remove(&client_id);
                self.internal_to_client.lock().await.remove(&internal_id);
                let err = json_rpc_error(
                    client_id,
                    RPC_ERR_AUTH_INVALIDATED,
                    "Session invalidated: connection or target changed",
                    Some("AUTH_INVALIDATED"),
                );
                self.send_outbound(err).await;
                return Ok(());
            }
            Err(_) => {
                self.client_to_logical.lock().await.remove(&client_id);
                self.internal_to_client.lock().await.remove(&internal_id);
                if handle.is_revoked() || self.is_authority_revoked(Some(&handle)).await {
                    let err = json_rpc_error(
                        client_id,
                        RPC_ERR_AUTH_INVALIDATED,
                        "Session invalidated: connection or target changed",
                        Some("AUTH_INVALIDATED"),
                    );
                    self.send_outbound(err).await;
                    return Ok(());
                }
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
        let root_identity = binding.root_identity;
        let client_map = Arc::clone(&self.client_to_logical);
        let internal_map = Arc::clone(&self.internal_to_client);
        let next_internal_id = Arc::clone(&self.next_internal_id);
        let open_docs = Arc::clone(&self.open_docs);
        let revocation_token = handle.revocation_token().clone();
        let supervisor = Arc::clone(&self.state.semantic_supervisor);
        let conn_id = self.connection_id.clone();
        let admission_epoch = self.admission_epoch;
        let method_owned = method.to_string();
        let nav_deadline = tokio::time::Instant::now() + NAVIGATION_REQUEST_TIMEOUT;
        let c_id = client_id.clone();
        let handle_clone = handle.clone();
        let session_revocation = Arc::clone(&self.session_revocation);

        tokio::spawn(async move {
            let active_child_holder = Arc::new(AtomicU64::new(internal_id));

            struct InFlightGuard {
                in_flight_counter: Arc<AtomicUsize>,
                client_map: Arc<Mutex<HashMap<Value, LogicalNavigationEntry>>>,
                internal_map: Arc<Mutex<HashMap<u64, Value>>>,
                client_id: Value,
                active_child: Arc<AtomicU64>,
                completed: bool,
            }
            impl Drop for InFlightGuard {
                fn drop(&mut self) {
                    if !self.completed {
                        self.in_flight_counter.fetch_sub(1, Ordering::SeqCst);
                        let client_map = Arc::clone(&self.client_map);
                        let internal_map = Arc::clone(&self.internal_map);
                        let cid = self.client_id.clone();
                        let aid = self.active_child.swap(0, Ordering::SeqCst);
                        tokio::spawn(async move {
                            client_map.lock().await.remove(&cid);
                            if aid != 0 {
                                internal_map.lock().await.remove(&aid);
                            }
                        });
                    }
                }
            }

            let mut guard = InFlightGuard {
                in_flight_counter: Arc::clone(&in_flight_counter),
                client_map: Arc::clone(&client_map),
                internal_map: Arc::clone(&internal_map),
                client_id: c_id.clone(),
                active_child: Arc::clone(&active_child_holder),
                completed: false,
            };

            let finish = |msg: Value| {
                let out_tx = out_tx.clone();
                let client_map = Arc::clone(&client_map);
                let internal_map = Arc::clone(&internal_map);
                let in_flight_counter = Arc::clone(&in_flight_counter);
                let active_child = Arc::clone(&active_child_holder);
                let session_revocation = Arc::clone(&session_revocation);
                let cid = c_id.clone();
                async move {
                    let final_msg = {
                        let map = client_map.lock().await;
                        let is_cancelled = map.get(&cid).map_or(false, |e| e.cancelled);
                        let is_already_cancel_err = msg
                            .get("error")
                            .and_then(|e| e.get("code"))
                            .and_then(|c| c.as_i64())
                            == Some(RPC_ERR_REQUEST_CANCELLED);
                        if is_cancelled && !is_already_cancel_err {
                            json_rpc_error(
                                cid.clone(),
                                RPC_ERR_REQUEST_CANCELLED,
                                "Request cancelled",
                                Some("REQUEST_CANCELLED"),
                            )
                        } else {
                            msg
                        }
                    };

                    let child_id = active_child.swap(0, Ordering::SeqCst);
                    let send_res =
                        tokio::time::timeout(SOCKET_SEND_TIMEOUT, out_tx.send(final_msg.to_string())).await;
                    if send_res.is_err() || matches!(send_res, Ok(Err(_))) {
                        if let Ok(guard) = session_revocation.read() {
                            if let Some(tok) = guard.as_ref() {
                                tok.revoke();
                            }
                        }
                    }
                    {
                        let mut c_map = client_map.lock().await;
                        let mut i_map = internal_map.lock().await;
                        c_map.remove(&cid);
                        if child_id != 0 {
                            i_map.remove(&child_id);
                        }
                    }
                    in_flight_counter.fetch_sub(1, Ordering::SeqCst);
                }
            };

            let raw_res = tokio::select! {
                biased;
                _ = revocation_token.cancelled() => Ok(Err(SessionError::Invalidated)),
                _ = tokio::time::sleep_until(nav_deadline) => Ok(Err(SessionError::Timeout)),
                res = rx => res,
            };

            if matches!(raw_res, Ok(Err(SessionError::Timeout)) | Ok(Err(SessionError::Invalidated))) {
                handle_clone.cancel_request(Value::from(internal_id)).await;
            }

            let is_cancelled = {
                let mut c_map = client_map.lock().await;
                let mut i_map = internal_map.lock().await;
                i_map.remove(&internal_id);
                active_child_holder.store(0, Ordering::SeqCst);
                if let Some(entry) = c_map.get_mut(&c_id) {
                    entry.active_child_id = None;
                    entry.cancelled
                } else {
                    true
                }
            };

            if is_cancelled {
                guard.completed = true;
                let err = json_rpc_error(
                    c_id.clone(),
                    RPC_ERR_REQUEST_CANCELLED,
                    "Request cancelled",
                    Some("REQUEST_CANCELLED"),
                );
                finish(err).await;
                return;
            }

            if revocation_token.is_revoked()
                || !supervisor.is_enabled()
                || supervisor.get_connection_epoch(&conn_id).await != Some(admission_epoch)
            {
                guard.completed = true;
                let err = json_rpc_error(
                    c_id.clone(),
                    RPC_ERR_AUTH_INVALIDATED,
                    "Session invalidated",
                    Some("AUTH_REVOKED"),
                );
                finish(err).await;
                return;
            }
            if tokio::time::Instant::now() >= nav_deadline {
                guard.completed = true;
                let err = json_rpc_error(
                    c_id.clone(),
                    RPC_ERR_INTERNAL_ERROR,
                    "Navigation request timed out",
                    Some("TIMEOUT"),
                );
                finish(err).await;
                return;
            }


            match raw_res {
                Ok(Ok(raw_result)) => {
                    if unwrap_lsp_result_payload(&raw_result).is_err() {
                        guard.completed = true;
                        let err = json_rpc_error(
                            c_id.clone(),
                            RPC_ERR_INTERNAL_ERROR,
                            "Navigation request failed",
                            Some("NAVIGATION_ERROR"),
                        );
                        finish(err).await;
                        return;
                    }
                    if std::fs::symlink_metadata(&target_root)
                        .map(|m| m.file_type().is_symlink() || !m.is_dir())
                        .unwrap_or(true)
                        || directory_identity(&target_root).ok() != Some(root_identity)
                    {
                        guard.completed = true;
                        let err = json_rpc_error(
                            c_id.clone(),
                            RPC_ERR_TARGET_NOT_FOUND,
                            "Target root directory identity has changed",
                            Some("TARGET_IDENTITY_MODIFIED"),
                        );
                        finish(err).await;
                        return;
                    }

                    let source_submit_state = open_docs_at_submit.get(&source_file_uri).copied();
                    if open_docs.lock().await.get(&source_file_uri).copied() != source_submit_state
                    {
                        guard.completed = true;
                        let err = json_rpc_error(
                            c_id.clone(),
                            RPC_ERR_STALE_VERSION,
                            "Source document overlay changed or closed while navigation was in flight",
                            Some("STALE_VERSION"),
                        );
                        finish(err).await;
                        return;
                    }
                    let source_snap = match tokio::time::timeout_at(
                        nav_deadline,
                        handle_clone.get_overlay_snapshot(&source_file_uri),
                    )
                    .await
                    {
                        Ok(Ok(Some(s)))
                            if s.version == doc_version
                                && nav_params
                                    .dam_hopper_model_generation
                                    .map_or(true, |g| g == s.open_incarnation) =>
                        {
                            s
                        }
                        Err(_) => {
                            guard.completed = true;
                            let err = json_rpc_error(
                                c_id.clone(),
                                RPC_ERR_INTERNAL_ERROR,
                                "Navigation request timed out",
                                Some("TIMEOUT"),
                            );
                            finish(err).await;
                            return;
                        }
                        _ => {
                            guard.completed = true;
                            let err = json_rpc_error(
                                c_id.clone(),
                                RPC_ERR_STALE_VERSION,
                                "Source document overlay changed or closed while navigation was in flight",
                                Some("STALE_VERSION"),
                            );
                            finish(err).await;
                            return;
                        }
                    };
                     let mut requery_nav_params = nav_params.clone();
                     requery_nav_params.dam_hopper_model_generation =
                         Some(source_snap.open_incarnation);

                     let dest_candidates =
                         extract_in_target_destination_uris(&raw_result, &target_id, &target_root);
                     let mut provenance_map: HashMap<String, DestinationProvenance> = HashMap::new();
                     let mut unopened_destinations: Vec<(String, PathBuf)> = Vec::new();
                     let mut open_dest_actor_identities: HashMap<String, (i64, u64)> = HashMap::new();

                     for (dest_file_uri, canonical_dest_path) in dest_candidates {
                         if let Some(&(submit_ver, submit_inc)) =
                             open_docs_at_submit.get(&dest_file_uri)
                         {
                             let still_same_in_gateway = open_docs.lock().await.get(&dest_file_uri)
                                 == Some(&(submit_ver, submit_inc));
                             let snap_opt = match tokio::time::timeout_at(
                                 nav_deadline,
                                 handle_clone.get_overlay_snapshot(&dest_file_uri),
                             )
                             .await
                             {
                                 Ok(res) => res.ok().flatten(),
                                 Err(_) => {
                                     guard.completed = true;
                                     let err = json_rpc_error(
                                         c_id.clone(),
                                         RPC_ERR_INTERNAL_ERROR,
                                         "Navigation request timed out",
                                         Some("TIMEOUT"),
                                     );
                                     finish(err).await;
                                     return;
                                 }
                             };
                             match (still_same_in_gateway, snap_opt) {
                                 (true, Some(snap)) if snap.version == submit_ver => {
                                     open_dest_actor_identities.insert(
                                         dest_file_uri.clone(),
                                         (snap.version, snap.open_incarnation),
                                     );
                                     provenance_map.insert(
                                         dest_file_uri,
                                         DestinationProvenance {
                                             content_sha256: snap.content_sha256,
                                             version: Some(snap.version),
                                             open_incarnation: Some(snap.open_incarnation),
                                             text: snap.text,
                                         },
                                     );
                                 }
                                 _ => {
                                     guard.completed = true;
                                     let err = json_rpc_error(
                                         c_id.clone(),
                                         RPC_ERR_STALE_VERSION,
                                         "Destination document modified or closed while navigation was in flight",
                                         Some("STALE_VERSION"),
                                     );
                                     finish(err).await;
                                     return;
                                 }
                             }
                         } else {
                             unopened_destinations.push((dest_file_uri, canonical_dest_path));
                         }
                     }

                     let mut final_raw_result = raw_result;
                     if !unopened_destinations.is_empty() {
                         if unopened_destinations.len() > 4 {
                            guard.completed = true;
                             let err = json_rpc_error(
                                c_id.clone(),
                                 RPC_ERR_INTERNAL_ERROR,
                                 "Navigation destination fanout exceeds bounded pin-and-requery limit",
                                 Some("NAVIGATION_ERROR"),
                             );
                            finish(err).await;
                             return;
                         }

                         let mut pinned_files: Vec<(String, String, String)> =
                             Vec::with_capacity(unopened_destinations.len());
                        let mut expected_pin_shas: HashMap<String, String> =
                            HashMap::with_capacity(unopened_destinations.len());

                         for (dest_file_uri, canonical_dest_path) in &unopened_destinations {
                             let meta_ok = std::fs::symlink_metadata(canonical_dest_path)
                                 .map(|m| {
                                     m.file_type().is_file()
                                         && (m.len() as usize) <= MAX_DOCUMENT_BYTES
                                 })
                                 .unwrap_or(false);
                             let Some(lang_id) = language_id_for_path(canonical_dest_path) else {
                                guard.completed = true;
                                 let err = json_rpc_error(
                                    c_id.clone(),
                                     RPC_ERR_INTERNAL_ERROR,
                                     "Unsupported destination file language for freshness pin",
                                     Some("NAVIGATION_ERROR"),
                                 );
                                finish(err).await;
                                 return;
                             };
                            let canonical_dest_path_owned = canonical_dest_path.clone();
                            let disk_read_res = tokio::time::timeout_at(
                                nav_deadline,
                                tokio::task::spawn_blocking(move || {
                                    if meta_ok {
                                        std::fs::read_to_string(&canonical_dest_path_owned).ok()
                                    } else {
                                        None
                                    }
                                }),
                            )
                            .await;
                            let disk_text = match disk_read_res {
                                Ok(Ok(Some(text))) => text,
                                Ok(Ok(None)) | Ok(Err(_)) => {
                                    guard.completed = true;
                                    let err = json_rpc_error(
                                        c_id.clone(),
                                        RPC_ERR_INTERNAL_ERROR,
                                        "Failed to read canonical destination file for freshness pin",
                                        Some("NAVIGATION_ERROR"),
                                    );
                                    finish(err).await;
                                    return;
                                }
                                Err(_) => {
                                    guard.completed = true;
                                    let err = json_rpc_error(
                                        c_id.clone(),
                                        RPC_ERR_INTERNAL_ERROR,
                                        "Navigation request timed out",
                                        Some("TIMEOUT"),
                                    );
                                    finish(err).await;
                                    return;
                                }
                            };
                             let disk_text = project_disk_text_for_pin(&disk_text);
                             let sha256 = compute_text_sha256(&disk_text);
                            let text_owned = disk_text.into_owned();
                            expected_pin_shas.insert(dest_file_uri.clone(), sha256);
                            pinned_files.push((
                                dest_file_uri.clone(),
                                lang_id.to_string(),
                                text_owned,
                            ));
                        }
                        #[cfg(any(test, feature = "test-support"))]
                        if test_barriers::F9_GAP_ENABLED.load(std::sync::atomic::Ordering::SeqCst) {
                            test_barriers::F9_GAP_PAUSE_NOTIFY.notify_waiters();
                            test_barriers::F9_GAP_RESUME_NOTIFY.notified().await;
                        }


                        let is_cancelled = {
                            let map = client_map.lock().await;
                            map.get(&c_id).map_or(true, |e| e.cancelled)
                        };
                        if is_cancelled {
                            guard.completed = true;
                            let err = json_rpc_error(
                                c_id.clone(),
                                RPC_ERR_REQUEST_CANCELLED,
                                "Request cancelled",
                                Some("REQUEST_CANCELLED"),
                            );
                            finish(err).await;
                            return;
                         }

                         let docs_before_pin = open_docs.lock().await.clone();
                         for (dest_file_uri, _) in &unopened_destinations {
                             if docs_before_pin.get(dest_file_uri).is_some() {
                                 if let Ok(Ok(Some(snap))) = tokio::time::timeout_at(
                                     nav_deadline,
                                     handle_clone.get_overlay_snapshot(dest_file_uri),
                                 )
                                 .await
                                 {
                                     open_dest_actor_identities.insert(
                                         dest_file_uri.clone(),
                                         (snap.version, snap.open_incarnation),
                                     );
                                 }
                             }
                         }
                         let requery_id = next_internal_id.fetch_add(1, Ordering::SeqCst);
                        {
                            let mut c_map = client_map.lock().await;
                            let mut i_map = internal_map.lock().await;
                            if let Some(entry) = c_map.get_mut(&c_id) {
                                if entry.cancelled {
                                    drop(c_map);
                                    drop(i_map);
                                    guard.completed = true;
                                    let err = json_rpc_error(
                                        c_id.clone(),
                                        RPC_ERR_REQUEST_CANCELLED,
                                        "Request cancelled",
                                        Some("REQUEST_CANCELLED"),
                                    );
                                    finish(err).await;
                                    return;
                                }
                                entry.active_child_id = Some(requery_id);
                            }
                            i_map.insert(requery_id, c_id.clone());
                            active_child_holder.store(requery_id, Ordering::SeqCst);
                        }
                        if tokio::time::Instant::now() >= nav_deadline {
                            handle_clone.cancel_request(Value::from(requery_id)).await;
                            guard.completed = true;
                            let err = json_rpc_error(
                                c_id.clone(),
                                RPC_ERR_INTERNAL_ERROR,
                                "Navigation request timed out",
                                Some("TIMEOUT"),
                            );
                            finish(err).await;
                            return;
                        }

                        let requery_rx = match tokio::time::timeout_at(
                            nav_deadline,
                            handle_clone.submit_pinned_navigation(
                                Value::from(requery_id),
                                &method_owned,
                                requery_nav_params,
                                pinned_files,
                            ),
                        )
                        .await
                        {
                            Ok(Ok(rx)) => rx,
                            Ok(Err(SessionError::StaleDocumentVersion { current, requested })) => {
                                guard.completed = true;
                                let err = json_rpc_error(
                                    c_id.clone(),
                                    RPC_ERR_STALE_VERSION,
                                    &format!("Stale document version: current {current}, requested {requested}"),
                                    Some("STALE_VERSION"),
                                );
                                finish(err).await;
                                return;
                            }
                            Ok(Err(SessionError::Invalidated)) => {
                                guard.completed = true;
                                let err = json_rpc_error(
                                    c_id.clone(),
                                    RPC_ERR_AUTH_INVALIDATED,
                                    "Session invalidated",
                                    Some("AUTH_REVOKED"),
                                );
                                finish(err).await;
                                return;
                            }
                            Ok(Err(SessionError::Timeout)) => {
                                guard.completed = true;
                                let err = json_rpc_error(
                                    c_id.clone(),
                                    RPC_ERR_INTERNAL_ERROR,
                                    "Navigation request timed out",
                                    Some("TIMEOUT"),
                                );
                                finish(err).await;
                                return;
                            }
                            Err(_) => {
                                guard.completed = true;
                                let err = json_rpc_error(
                                    c_id.clone(),
                                    RPC_ERR_INTERNAL_ERROR,
                                    "Navigation request timed out",
                                    Some("TIMEOUT"),
                                );
                                finish(err).await;
                                return;
                            }
                            Ok(Err(_)) => {
                                guard.completed = true;
                                let err = json_rpc_error(
                                    c_id.clone(),
                                    RPC_ERR_INTERNAL_ERROR,
                                    "Destination pin-and-requery submission failed",
                                    Some("NAVIGATION_ERROR"),
                                );
                                finish(err).await;
                                return;
                            }
                        };
                        #[cfg(any(test, feature = "test-support"))]
                        if test_barriers::F9_STAGE2_ENABLED.load(std::sync::atomic::Ordering::SeqCst) {
                            test_barriers::F9_STAGE2_PAUSE_NOTIFY.notify_waiters();
                            test_barriers::F9_STAGE2_RESUME_NOTIFY.notified().await;
                        }


                        let is_cancelled = {
                            let map = client_map.lock().await;
                            map.get(&c_id).map_or(true, |e| e.cancelled)
                        };
                        if is_cancelled {
                            handle_clone.cancel_request(Value::from(requery_id)).await;
                            guard.completed = true;
                            let err = json_rpc_error(
                                c_id.clone(),
                                RPC_ERR_REQUEST_CANCELLED,
                                "Request cancelled",
                                Some("REQUEST_CANCELLED"),
                            );
                            finish(err).await;
                            return;
                        }

                         let requery_res = tokio::select! {
                             biased;
                             _ = revocation_token.cancelled() => Ok(Err(SessionError::Invalidated)),
                             _ = tokio::time::sleep_until(nav_deadline) => Ok(Err(SessionError::Timeout)),
                             res = requery_rx => res,
                         };

                        if matches!(requery_res, Ok(Err(SessionError::Timeout)) | Ok(Err(SessionError::Invalidated))) {
                            handle_clone.cancel_request(Value::from(requery_id)).await;
                        }

                        let is_cancelled = {
                            let mut c_map = client_map.lock().await;
                            let mut i_map = internal_map.lock().await;
                            i_map.remove(&requery_id);
                            active_child_holder.store(0, Ordering::SeqCst);
                            if let Some(entry) = c_map.get_mut(&c_id) {
                                entry.active_child_id = None;
                                entry.cancelled
                            } else {
                                true
                            }
                        };

                        if is_cancelled {
                            guard.completed = true;
                            let err = json_rpc_error(
                                c_id.clone(),
                                RPC_ERR_REQUEST_CANCELLED,
                                "Request cancelled",
                                Some("REQUEST_CANCELLED"),
                            );
                            finish(err).await;
                            return;
                        }

                        let mut proven_snapshots: HashMap<String, (String, String, i64, u64)> =
                            HashMap::new();

                         match requery_res {
                            Ok(Ok(mut verified_raw)) => {
                                if let Some(obj) = verified_raw.as_object_mut() {
                                    if let Some(proven_val) = obj.remove("_damHopperProvenSnapshots") {
                                        if let Some(map) = proven_val.as_object() {
                                            for (uri, snap_val) in map {
                                                if let (Some(text), Some(sha), Some(ver), Some(inc)) = (
                                                    snap_val.get("text").and_then(|t| t.as_str()),
                                                    snap_val.get("contentSha256").and_then(|s| s.as_str()),
                                                    snap_val.get("version").and_then(|v| v.as_i64()),
                                                    snap_val.get("openIncarnation").and_then(|i| i.as_u64()),
                                                ) {
                                                    if compute_text_sha256(text) == sha {
                                                        proven_snapshots.insert(
                                                            uri.clone(),
                                                            (text.to_string(), sha.to_string(), ver, inc),
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                 final_raw_result = verified_raw;
                             }
                             Ok(Err(SessionError::StaleDocumentVersion { current, requested })) => {
                                guard.completed = true;
                                 let err = json_rpc_error(
                                    c_id.clone(),
                                     RPC_ERR_STALE_VERSION,
                                     &format!("Stale document version: current {current}, requested {requested}"),
                                     Some("STALE_VERSION"),
                                 );
                                finish(err).await;
                                return;
                            }
                            Ok(Err(SessionError::Cancelled)) => {
                                guard.completed = true;
                                let err = json_rpc_error(
                                    c_id.clone(),
                                    RPC_ERR_REQUEST_CANCELLED,
                                    "Request cancelled",
                                    Some("REQUEST_CANCELLED"),
                                );
                                finish(err).await;
                                 return;
                             }
                             Ok(Err(SessionError::Invalidated)) => {
                                guard.completed = true;
                                 let err = json_rpc_error(
                                    c_id.clone(),
                                     RPC_ERR_AUTH_INVALIDATED,
                                     "Session invalidated",
                                     Some("AUTH_REVOKED"),
                                 );
                                finish(err).await;
                                 return;
                             }
                             Ok(Err(SessionError::Timeout)) => {
                                guard.completed = true;
                                 let err = json_rpc_error(
                                    c_id.clone(),
                                     RPC_ERR_INTERNAL_ERROR,
                                     "Navigation request timed out",
                                     Some("TIMEOUT"),
                                 );
                                finish(err).await;
                                 return;
                             }
                             _ => {
                                guard.completed = true;
                                 let err = json_rpc_error(
                                    c_id.clone(),
                                     RPC_ERR_INTERNAL_ERROR,
                                     "Destination pin-and-requery failed",
                                     Some("NAVIGATION_ERROR"),
                                 );
                                finish(err).await;
                                 return;
                             }
                         }

                         let docs_after_requery = open_docs.lock().await.clone();
                        let source_snap_after = handle_clone
                             .get_overlay_snapshot(&source_file_uri)
                             .await
                             .ok()
                             .flatten();
                         let source_unchanged = docs_after_requery.get(&source_file_uri)
                             == open_docs_at_submit.get(&source_file_uri)
                             && source_snap_after.as_ref().is_some_and(|s| {
                                 s.version == source_snap.version
                                     && s.open_incarnation == source_snap.open_incarnation
                             });
                         if !source_unchanged {
                            guard.completed = true;
                             let err = json_rpc_error(
                                c_id.clone(),
                                 RPC_ERR_STALE_VERSION,
                                 "Source document state modified during destination pin-and-requery",
                                 Some("STALE_VERSION"),
                             );
                            finish(err).await;
                             return;
                         }
                        // Re-verify that every originally open destination remained completely unchanged during requery
                        for dest_file_uri in open_docs_at_submit.keys() {
                            if provenance_map.contains_key(dest_file_uri) {
                                let Some(&(submit_ver, submit_inc)) = open_docs_at_submit.get(dest_file_uri) else {
                                    continue;
                                };
                                let Some(&(actor_ver, actor_inc)) = open_dest_actor_identities.get(dest_file_uri) else {
                                    continue;
                                };
                                let still_same_in_gateway = docs_after_requery.get(dest_file_uri)
                                    == Some(&(submit_ver, submit_inc));
                                let snap_opt = match tokio::time::timeout_at(
                                    nav_deadline,
                                    handle_clone.get_overlay_snapshot(dest_file_uri),
                                )
                                .await
                                {
                                    Ok(res) => res.ok().flatten(),
                                    Err(_) => {
                                        guard.completed = true;
                                        let err = json_rpc_error(
                                            c_id.clone(),
                                            RPC_ERR_INTERNAL_ERROR,
                                            "Navigation request timed out",
                                            Some("TIMEOUT"),
                                        );
                                        finish(err).await;
                                        return;
                                    }
                                };
                                let valid = still_same_in_gateway
                                    && snap_opt.as_ref().is_some_and(|s| {
                                        s.version == actor_ver && s.open_incarnation == actor_inc
                                    });
                                if !valid {
                                    guard.completed = true;
                                    let err = json_rpc_error(
                                        c_id.clone(),
                                        RPC_ERR_STALE_VERSION,
                                        "Open destination document modified or closed during pin-and-requery",
                                        Some("STALE_VERSION"),
                                    );
                                    finish(err).await;
                                    return;
                                }
                            }
                        }


                        #[cfg(any(test, feature = "test-support"))]
                        if test_barriers::F3_ENABLED.load(std::sync::atomic::Ordering::SeqCst) {
                            test_barriers::F3_PAUSE_NOTIFY.notify_waiters();
                            test_barriers::F3_RESUME_NOTIFY.notified().await;
                        }

                         for (dest_file_uri, _) in &unopened_destinations {
                             if docs_after_requery.get(dest_file_uri)
                                 != docs_before_pin.get(dest_file_uri)
                             {
                                guard.completed = true;
                                 let err = json_rpc_error(
                                    c_id.clone(),
                                     RPC_ERR_STALE_VERSION,
                                     "Destination document modified during pin-and-requery",
                                     Some("STALE_VERSION"),
                                 );
                                finish(err).await;
                                 return;
                             }

                            let Some((snap_text, snap_sha, snap_ver, snap_inc)) =
                                proven_snapshots.get(dest_file_uri)
                            else {
                                guard.completed = true;
                                let err = json_rpc_error(
                                    c_id.clone(),
                                    RPC_ERR_STALE_VERSION,
                                    "Destination document missing proven snapshot from requery",
                                    Some("STALE_VERSION"),
                                );
                                finish(err).await;
                                return;
                            };

                            let is_user_open_before = docs_before_pin.get(dest_file_uri).is_some();
                            if is_user_open_before {
                                if let Some(&(actor_ver, actor_inc)) = open_dest_actor_identities.get(dest_file_uri) {
                                    if *snap_ver != actor_ver || *snap_inc != actor_inc {
                                        guard.completed = true;
                                        let err = json_rpc_error(
                                            c_id.clone(),
                                            RPC_ERR_STALE_VERSION,
                                            "Destination overlay version shifted during requery",
                                            Some("STALE_VERSION"),
                                        );
                                        finish(err).await;
                                        return;
                                    }
                                }
                                 provenance_map.insert(
                                     dest_file_uri.clone(),
                                     DestinationProvenance {
                                        content_sha256: snap_sha.clone(),
                                        version: Some(*snap_ver),
                                        open_incarnation: Some(*snap_inc),
                                        text: snap_text.clone(),
                                    },
                                );
                            } else {
                                let Some(expected_sha) = expected_pin_shas.get(dest_file_uri) else {
                                    guard.completed = true;
                                    let err = json_rpc_error(
                                        c_id.clone(),
                                        RPC_ERR_STALE_VERSION,
                                        "Destination disk pin was not registered",
                                        Some("STALE_VERSION"),
                                    );
                                    finish(err).await;
                                    return;
                                };
                                if snap_sha != expected_sha {
                                    guard.completed = true;
                                    let err = json_rpc_error(
                                        c_id.clone(),
                                        RPC_ERR_STALE_VERSION,
                                        "Destination proven snapshot digest does not match pinned text",
                                        Some("STALE_VERSION"),
                                    );
                                    finish(err).await;
                                    return;
                                }
                                provenance_map.insert(
                                    dest_file_uri.clone(),
                                    DestinationProvenance {
                                        content_sha256: snap_sha.clone(),
                                        version: None,
                                        open_incarnation: None,
                                        text: snap_text.clone(),
                                     },
                                 );
                             }
                         }
                     }

                     let final_dests = extract_in_target_destination_uris(
                         &final_raw_result,
                         &target_id,
                         &target_root,
                     );
                     if final_dests
                         .iter()
                         .any(|(u, _)| !provenance_map.contains_key(u))
                     {
                        guard.completed = true;
                         let err = json_rpc_error(
                            c_id.clone(),
                             RPC_ERR_STALE_VERSION,
                             "Navigation destination shifted outside validated pin set",
                             Some("STALE_VERSION"),
                         );
                        finish(err).await;
                         return;
                     }

                     if revocation_token.is_revoked()
                         || !supervisor.is_enabled()
                         || supervisor.get_connection_epoch(&conn_id).await != Some(admission_epoch)
                     {
                        guard.completed = true;
                         let err = json_rpc_error(
                            c_id.clone(),
                             RPC_ERR_AUTH_INVALIDATED,
                             "Session invalidated",
                             Some("AUTH_REVOKED"),
                         );
                        finish(err).await;
                         return;
                     }

                     let sanitized = match filter_location_or_link_result_with_provenance(
                         &final_raw_result,
                         &target_id,
                         &target_root,
                         &provenance_map,
                         Some(&source_snap.text),
                     ) {
                         Ok(v) => v,
                         Err(_) => {
                            guard.completed = true;
                             let err = json_rpc_error(
                                c_id.clone(),
                                 RPC_ERR_INTERNAL_ERROR,
                                 "Navigation result filtering failed",
                                 Some("NAVIGATION_ERROR"),
                             );
                            finish(err).await;
                             return;
                         }
                     };
                    if tokio::time::Instant::now() >= nav_deadline {
                        guard.completed = true;
                        let err = json_rpc_error(
                            c_id.clone(),
                            RPC_ERR_INTERNAL_ERROR,
                            "Navigation request timed out",
                            Some("TIMEOUT"),
                        );
                        finish(err).await;
                        return;
                    }


                    // Recheck cancellation immediately prior to terminal publication
                    let is_cancelled = {
                        let map = client_map.lock().await;
                        map.get(&c_id).map_or(true, |e| e.cancelled)
                    };
                    if is_cancelled {
                        guard.completed = true;
                        let err = json_rpc_error(
                            c_id.clone(),
                            RPC_ERR_REQUEST_CANCELLED,
                            "Request cancelled",
                            Some("REQUEST_CANCELLED"),
                        );
                        finish(err).await;
                        return;
                    }

                    guard.completed = true;
                     let response = json!({
                         "jsonrpc": "2.0",
                        "id": c_id.clone(),
                         "result": sanitized,
                     });
                    finish(response).await;
                 }
                 Ok(Err(SessionError::StaleDocumentVersion { current, requested })) => {
                    guard.completed = true;
                     let err = json_rpc_error(
                        c_id.clone(),
                         RPC_ERR_STALE_VERSION,
                        &format!("Stale document version: current {current}, requested {requested}"),
                         Some("STALE_VERSION"),
                     );
                    finish(err).await;
                 }
                 Ok(Err(SessionError::DocumentNotFound(_))) => {
                    guard.completed = true;
                     let err = json_rpc_error(
                        c_id.clone(),
                         RPC_ERR_STALE_VERSION,
                         "Source document overlay is no longer open",
                         Some("STALE_VERSION"),
                     );
                    finish(err).await;
                 }
                 Ok(Err(SessionError::Timeout)) => {
                    guard.completed = true;
                     let err = json_rpc_error(
                        c_id.clone(),
                         RPC_ERR_INTERNAL_ERROR,
                         "Navigation request timed out",
                         Some("TIMEOUT"),
                     );
                    finish(err).await;
                 }
                 Ok(Err(SessionError::Cancelled)) => {
                    guard.completed = true;
                     let err = json_rpc_error(
                        c_id.clone(),
                         RPC_ERR_REQUEST_CANCELLED,
                         "Request cancelled",
                         Some("REQUEST_CANCELLED"),
                     );
                    finish(err).await;
                 }
                 Ok(Err(SessionError::Invalidated)) => {
                    guard.completed = true;
                     let err = json_rpc_error(
                        c_id.clone(),
                         RPC_ERR_AUTH_INVALIDATED,
                         "Session invalidated",
                         Some("AUTH_REVOKED"),
                     );
                    finish(err).await;
                 }
                 Ok(Err(_)) => {
                    guard.completed = true;
                     let err = json_rpc_error(
                        c_id.clone(),
                         RPC_ERR_INTERNAL_ERROR,
                         "Navigation request failed",
                         Some("NAVIGATION_ERROR"),
                     );
                    finish(err).await;
                 }
                 Err(_) => {
                    guard.completed = true;
                     let err = if revocation_token.is_revoked() || !supervisor.is_enabled() {
                         json_rpc_error(
                            c_id.clone(),
                             RPC_ERR_AUTH_INVALIDATED,
                             "Session invalidated",
                             Some("AUTH_REVOKED"),
                         )
                     } else {
                         json_rpc_error(
                            c_id.clone(),
                             RPC_ERR_INTERNAL_ERROR,
                             "Request terminated before response was produced",
                             Some("SESSION_CLOSED"),
                         )
                     };
                    finish(err).await;
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

        let Some(params_obj) = params.as_object() else {
            return Ok(());
        };
        if !object_has_only_keys(params_obj, &["id"]) {
            return Ok(());
        }

        if let Some(cancel_id) = params_obj.get("id") {
            if !validate_request_id(cancel_id) {
                return Ok(());
            }
            let active_child_id = {
                let mut map = self.client_to_logical.lock().await;
                if let Some(entry) = map.get_mut(cancel_id) {
                    entry.cancelled = true;
                    entry.active_child_id
                } else {
                    None
                }
            };
            if let Some(child_id) = active_child_id {
                handle.cancel_request(Value::from(child_id)).await;
            }
        }
        Ok(())
    }

    /// Handle `shutdown`.
    async fn handle_shutdown(&mut self, id: Value, params: Value) -> Result<(), GatewayError> {
        let valid_params = match &params {
            Value::Null => true,
            Value::Object(map) => map.is_empty(),
            _ => false,
        };
        if !valid_params {
            let err = json_rpc_error(
                id,
                RPC_ERR_INVALID_PARAMS,
                "Shutdown parameters must be null or empty",
                Some("INVALID_PARAMS"),
            );
            self.send_outbound(err).await;
            return Ok(());
        }

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
        if let Ok(guard) = self.session_revocation.read() {
            if let Some(tok) = guard.as_ref() {
                tok.revoke();
            }
        }
        self.lifecycle = GatewayState::Terminated;
        self.open_docs.lock().await.clear();
        self.client_to_logical.lock().await.clear();
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
        match tokio::time::timeout(SOCKET_SEND_TIMEOUT, self.outbound_tx.send(text)).await {
            Ok(Ok(())) => {}
            _ => {
                warn!(
                    "Outbound queue send timed out or closed; terminating gateway and releasing session"
                );
                self.teardown().await;
            }
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
