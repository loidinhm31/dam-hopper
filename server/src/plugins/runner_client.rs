#[cfg(unix)]
use std::collections::HashMap;
#[cfg(unix)]
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(unix)]
use std::sync::Arc;
use std::time::Duration;

#[cfg(unix)]
use parking_lot::Mutex as SyncMutex;
#[cfg(unix)]
use tokio::net::unix::OwnedWriteHalf;
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(unix)]
use tokio::sync::oneshot;
use tokio::sync::Mutex as TokioMutex;
#[cfg(unix)]
use tokio::time::sleep;

use super::admin::*;
#[cfg(unix)]
use super::contract::budgets::HANDSHAKE_TIMEOUT_SECS;
use super::contract::{
    ContextCloseParams, ContextCloseResult, ContextOpenParams, ContextOpenResult,
    PluginActivateParams, PluginActivateResult, PluginDeactivateParams, PluginDeactivateResult,
    PluginInvokeParams, PluginInvokeResult, PluginListParams, PluginListResult, PluginReadUiParams,
    PluginReadUiResult, RequestCancelParams, RequestCancelResult, RunnerHelloResult,
    RUNNER_PROTOCOL_VERSION,
};
use super::error::PluginError;
#[cfg(unix)]
use super::framing::{
    build_json_rpc_request, read_frame_async, validate_json_rpc_message, write_frame_async,
};

#[derive(Debug, Clone)]
pub struct RunnerClientConfig {
    pub socket_path: PathBuf,
    pub expected_runner_uid: Option<u32>,
    pub allow_root_peer: bool,
    pub client_name: String,
    pub max_reconnect_retries: usize,
    pub reconnect_base_delay: Duration,
}

impl Default for RunnerClientConfig {
    fn default() -> Self {
        Self {
            socket_path: PathBuf::from("/run/dam-hopper/plugin-runner.sock"),
            expected_runner_uid: None,
            allow_root_peer: false,
            client_name: "dam-hopper-api".to_string(),
            max_reconnect_retries: 5,
            reconnect_base_delay: Duration::from_millis(50),
        }
    }
}

#[cfg(unix)]
struct ConnectedSession {
    writer: Arc<TokioMutex<OwnedWriteHalf>>,
    pending_responses:
        Arc<SyncMutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, PluginError>>>>>,
    #[allow(dead_code)]
    pub generation: u64,
}

#[cfg(not(unix))]
struct ConnectedSession;

pub struct RunnerClient {
    #[allow(dead_code)]
    config: RunnerClientConfig,
    #[allow(dead_code)]
    session: TokioMutex<Option<ConnectedSession>>,
    next_req_id: AtomicU64,
    current_generation: AtomicU64,
}

impl RunnerClient {
    pub fn new(config: RunnerClientConfig) -> Self {
        Self {
            config,
            session: TokioMutex::new(None),
            next_req_id: AtomicU64::new(1),
            current_generation: AtomicU64::new(0),
        }
    }

    pub fn peek_next_request_id(&self) -> u64 {
        self.next_req_id.load(Ordering::SeqCst)
    }

    pub fn generation(&self) -> u64 {
        self.current_generation.load(Ordering::SeqCst)
    }

    fn generate_request_id(&self) -> String {
        let id = self.next_req_id.fetch_add(1, Ordering::SeqCst);
        format!("api-req-{id}")
    }

    #[cfg(unix)]
    fn validate_socket_file(&self) -> Result<(), PluginError> {
        let path = &self.config.socket_path;
        if !path.exists() {
            return Err(PluginError::runner_unavailable(format!(
                "Runner socket does not exist at '{}'",
                path.display()
            )));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
            let meta = fs::symlink_metadata(path).map_err(|e| {
                PluginError::runner_unavailable(format!("Failed to stat socket path: {e}"))
            })?;

            if meta.file_type().is_symlink() {
                return Err(PluginError::forbidden(
                    "Socket path is a symlink; symlinks are rejected for security",
                ));
            }

            if !meta.file_type().is_socket() {
                return Err(PluginError::forbidden(
                    "Target path exists but is not a Unix socket",
                ));
            }

            let mode = meta.permissions().mode();
            if mode & 0o002 != 0 {
                return Err(PluginError::forbidden(
                    "Runner socket must not be world-writable",
                ));
            }

            if let Some(expected_uid) = self.config.expected_runner_uid {
                let owner_uid = meta.uid();
                if owner_uid != expected_uid {
                    return Err(PluginError::forbidden(format!(
                        "Socket owner UID {owner_uid} does not match expected runner UID {expected_uid}",
                    )));
                }
            }
        }

        Ok(())
    }

    #[cfg(unix)]
    async fn connect_and_handshake(&self) -> Result<ConnectedSession, PluginError> {
        self.validate_socket_file()?;

        let stream = UnixStream::connect(&self.config.socket_path)
            .await
            .map_err(|e| {
                PluginError::runner_unavailable(format!(
                    "Failed to connect to runner socket at '{}': {e}",
                    self.config.socket_path.display()
                ))
            })?;

        // SO_PEERCRED verification
        #[cfg(unix)]
        {
            let ucred = stream.peer_cred().map_err(|e| {
                PluginError::unauthorized(format!("Failed to read runner peer credentials: {e}"))
            })?;
            let uid = ucred.uid();

            if uid == 0 && !self.config.allow_root_peer {
                return Err(PluginError::unauthorized(
                    "Connected to root peer UID (0), rejected by configuration",
                ));
            }

            if let Some(expected_uid) = self.config.expected_runner_uid {
                if uid != expected_uid {
                    return Err(PluginError::unauthorized(format!(
                        "Runner peer UID {uid} does not match expected UID {expected_uid}",
                    )));
                }
            }
        }

        let mut stream = stream;

        // Perform runner.hello handshake
        let hello_id = self.generate_request_id();
        let hello_req = build_json_rpc_request(
            &hello_id,
            "runner.hello",
            serde_json::json!({
                "hostVersion": env!("CARGO_PKG_VERSION"),
                "clientProtocolVersion": RUNNER_PROTOCOL_VERSION,
            }),
        );

        let req_bytes = serde_json::to_vec(&hello_req).unwrap();
        write_frame_async(&mut stream, &req_bytes).await?;

        let handshake_frame = tokio::time::timeout(
            Duration::from_secs(HANDSHAKE_TIMEOUT_SECS),
            read_frame_async(&mut stream),
        )
        .await
        .map_err(|_| PluginError::deadline_exceeded("Handshake timed out"))?
        .map_err(|e| {
            PluginError::runner_unavailable(format!("Failed to read handshake response: {e}"))
        })?
        .ok_or_else(|| {
            PluginError::runner_unavailable("Runner closed connection during handshake")
        })?;

        let parsed = validate_json_rpc_message(&handshake_frame)?;
        if let Some(err_val) = parsed.get("error") {
            let msg = err_val
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Handshake rejected");
            return Err(PluginError::runner_unavailable(format!(
                "Runner rejected handshake: {msg}"
            )));
        }

        let gen = self.current_generation.fetch_add(1, Ordering::SeqCst) + 1;
        tracing::info!(generation = gen, "RunnerClient connected and handshaked");

        let (mut reader, writer) = stream.into_split();
        let writer = Arc::new(TokioMutex::new(writer));
        let pending_responses: Arc<
            SyncMutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, PluginError>>>>,
        > = Arc::new(SyncMutex::new(HashMap::new()));

        let pending_clone = pending_responses.clone();

        // Background reader task for multiplexed responses
        tokio::spawn(async move {
            while let Ok(Some(frame)) = read_frame_async(&mut reader).await {
                if let Ok(parsed) = validate_json_rpc_message(&frame) {
                    if let Some(id) = parsed.get("id").and_then(|v| v.as_str()) {
                        let sender = pending_clone.lock().remove(id);
                        if let Some(tx) = sender {
                            if let Some(err_val) = parsed.get("error") {
                                let msg = err_val
                                    .get("message")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown runner error");
                                let plugin_error = if let Some(code_str) = err_val
                                    .get("data")
                                    .and_then(|d| d.get("pluginErrorCode"))
                                    .and_then(|c| c.as_str())
                                {
                                    let code = match code_str {
                                        "Unauthorized" => PluginErrorCode::Unauthorized,
                                        "Forbidden" => PluginErrorCode::Forbidden,
                                        "InvalidInput" => PluginErrorCode::InvalidInput,
                                        "SourceMissing" => PluginErrorCode::SourceMissing,
                                        "SourceNotConfigured" => {
                                            PluginErrorCode::SourceNotConfigured
                                        }
                                        "SourcePermissionDenied" => {
                                            PluginErrorCode::SourcePermissionDenied
                                        }
                                        "Incompatible" => PluginErrorCode::Incompatible,
                                        "Overloaded" => PluginErrorCode::Overloaded,
                                        "DeadlineExceeded" => PluginErrorCode::DeadlineExceeded,
                                        "Cancelled" => PluginErrorCode::Cancelled,
                                        "ContextRevoked" => PluginErrorCode::ContextRevoked,
                                        "SnapshotExpired" => PluginErrorCode::SnapshotExpired,
                                        "WorkerFailed" => PluginErrorCode::WorkerFailed,
                                        "RuntimeUnavailable" => PluginErrorCode::RuntimeUnavailable,
                                        "DetailChangedOrMissing" => {
                                            PluginErrorCode::DetailChangedOrMissing
                                        }
                                        _ => PluginErrorCode::RunnerUnavailable,
                                    };
                                    PluginError::new(code, msg)
                                } else {
                                    PluginError::runner_unavailable(msg)
                                };
                                let _ = tx.send(Err(plugin_error));
                            } else {
                                let res = parsed
                                    .get("result")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null);
                                let _ = tx.send(Ok(res));
                            }
                        }
                    }
                }
            }

            // Connection lost / EOF: fail all pending requests
            for (_, tx) in pending_clone.lock().drain() {
                let _ = tx.send(Err(PluginError::runner_unavailable(
                    "Runner connection closed",
                )));
            }
        });

        Ok(ConnectedSession {
            writer,
            pending_responses,
            generation: gen,
        })
    }

    async fn execute_call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        #[cfg(not(unix))]
        {
            let _ = (method, params);
            return Err(PluginError::runner_unavailable(
                "Plugin runner is only supported on Unix platforms",
            ));
        }

        #[cfg(unix)]
        {
            let mut retries = 0;
            loop {
                let (writer, pending_responses) = {
                    let mut session_guard = self.session.lock().await;

                    if session_guard.is_none() {
                        match self.connect_and_handshake().await {
                            Ok(sess) => *session_guard = Some(sess),
                            Err(e) => {
                                if retries >= self.config.max_reconnect_retries {
                                    return Err(e);
                                }
                                retries += 1;
                                let delay = self.config.reconnect_base_delay * (1 << (retries - 1));
                                sleep(delay).await;
                                continue;
                            }
                        }
                    }

                    let session = session_guard.as_ref().unwrap();
                    (session.writer.clone(), session.pending_responses.clone())
                };

                let req_id = self.generate_request_id();
                let req_json = build_json_rpc_request(&req_id, method, params.clone());
                let req_bytes = serde_json::to_vec(&req_json).unwrap();

                let (tx, rx) = oneshot::channel();
                pending_responses.lock().insert(req_id.clone(), tx);

                {
                    let mut w = writer.lock().await;
                    if let Err(e) = write_frame_async(&mut *w, &req_bytes).await {
                        tracing::warn!("Failed to write to runner session: {e}, will reconnect");
                        pending_responses.lock().remove(&req_id);
                        *self.session.lock().await = None;
                        if retries >= self.config.max_reconnect_retries {
                            return Err(PluginError::runner_unavailable(format!(
                                "Runner write failure: {e}"
                            )));
                        }
                        retries += 1;
                        let delay = self.config.reconnect_base_delay * (1 << (retries - 1));
                        sleep(delay).await;
                        continue;
                    }
                }

                match rx.await {
                    Ok(Ok(val)) => return Ok(val),
                    Ok(Err(err)) => return Err(err),
                    Err(_) => {
                        tracing::warn!(
                            "Response channel dropped for request {req_id}, will reconnect"
                        );
                        *self.session.lock().await = None;
                        if retries >= self.config.max_reconnect_retries {
                            return Err(PluginError::runner_unavailable(
                                "Runner dropped response channel prematurely",
                            ));
                        }
                        retries += 1;
                        let delay = self.config.reconnect_base_delay * (1 << (retries - 1));
                        sleep(delay).await;
                        continue;
                    }
                }
            }
        }
    }

    pub async fn hello(&self) -> Result<RunnerHelloResult, PluginError> {
        let res = self
            .execute_call(
                "runner.hello",
                serde_json::json!({
                    "hostVersion": env!("CARGO_PKG_VERSION"),
                    "clientProtocolVersion": RUNNER_PROTOCOL_VERSION,
                }),
            )
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse hello result: {e}")))
    }

    pub async fn list_plugins(
        &self,
        include_disabled: bool,
    ) -> Result<PluginListResult, PluginError> {
        let res = self
            .execute_call(
                "plugin.list",
                serde_json::to_value(PluginListParams { include_disabled }).unwrap(),
            )
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse list result: {e}")))
    }

    pub async fn read_ui(
        &self,
        params: PluginReadUiParams,
    ) -> Result<PluginReadUiResult, PluginError> {
        let res = self
            .execute_call("plugin.readUi", serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse readUi result: {e}")))
    }

    pub async fn activate(
        &self,
        installation_id: &str,
        version: &str,
    ) -> Result<PluginActivateResult, PluginError> {
        let res = self
            .execute_call(
                "plugin.activate",
                serde_json::to_value(PluginActivateParams {
                    installation_id: installation_id.to_string(),
                    version: version.to_string(),
                })
                .unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse activate result: {e}"))
        })
    }

    pub async fn deactivate(
        &self,
        installation_id: &str,
    ) -> Result<PluginDeactivateResult, PluginError> {
        let res = self
            .execute_call(
                "plugin.deactivate",
                serde_json::to_value(PluginDeactivateParams {
                    installation_id: installation_id.to_string(),
                })
                .unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse deactivate result: {e}"))
        })
    }

    pub async fn open_context(
        &self,
        params: ContextOpenParams,
    ) -> Result<ContextOpenResult, PluginError> {
        let res = self
            .execute_call("context.open", serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse open_context result: {e}"))
        })
    }

    pub async fn close_context(
        &self,
        context_id: &str,
        reason: Option<String>,
    ) -> Result<ContextCloseResult, PluginError> {
        let res = self
            .execute_call(
                "context.close",
                serde_json::to_value(ContextCloseParams {
                    context_id: context_id.to_string(),
                    reason,
                })
                .unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse close_context result: {e}"))
        })
    }

    async fn execute_invoke(
        &self,
        request_id: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        #[cfg(not(unix))]
        {
            let _ = (request_id, params);
            return Err(PluginError::runner_unavailable(
                "Plugin runner is only supported on Unix platforms",
            ));
        }

        #[cfg(unix)]
        {
            let mut retries = 0;
            let (writer, pending_responses) = loop {
                let mut session_guard = self.session.lock().await;
                if session_guard.is_none() {
                    match self.connect_and_handshake().await {
                        Ok(session) => *session_guard = Some(session),
                        Err(error) => {
                            if retries >= self.config.max_reconnect_retries {
                                return Err(error);
                            }
                            retries += 1;
                            let delay = self.config.reconnect_base_delay * (1 << (retries - 1));
                            drop(session_guard);
                            sleep(delay).await;
                            continue;
                        }
                    }
                }
                let session = session_guard.as_ref().unwrap();
                break (session.writer.clone(), session.pending_responses.clone());
            };

            let request = build_json_rpc_request(request_id, "plugin.invoke", params);
            let request_bytes = serde_json::to_vec(&request).unwrap();
            let (tx, rx) = oneshot::channel();
            {
                let mut pending = pending_responses.lock();
                if pending.contains_key(request_id) {
                    return Err(PluginError::invalid_input(
                        "Plugin request ID is already in flight",
                    ));
                }
                pending.insert(request_id.to_string(), tx);
            }

            {
                let mut writer = writer.lock().await;
                if let Err(error) = write_frame_async(&mut *writer, &request_bytes).await {
                    pending_responses.lock().remove(request_id);
                    *self.session.lock().await = None;
                    return Err(PluginError::runner_unavailable(format!(
                        "Runner write failure: {error}"
                    )));
                }
            }

            match rx.await {
                Ok(Ok(value)) => Ok(value),
                Ok(Err(error)) => Err(error),
                Err(_) => {
                    *self.session.lock().await = None;
                    Err(PluginError::runner_unavailable(
                        "Runner dropped invoke response channel",
                    ))
                }
            }
        }
    }

    pub async fn invoke_with_request_id(
        &self,
        request_id: &str,
        params: PluginInvokeParams,
    ) -> Result<PluginInvokeResult, PluginError> {
        let res = self
            .execute_invoke(request_id, serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse invoke result: {e}")))
    }

    pub async fn invoke(
        &self,
        params: PluginInvokeParams,
    ) -> Result<PluginInvokeResult, PluginError> {
        let request_id = self.generate_request_id();
        self.invoke_with_request_id(&request_id, params).await
    }

    pub async fn cancel_request(
        &self,
        context_id: &str,
        request_id: &str,
    ) -> Result<RequestCancelResult, PluginError> {
        let res = self
            .execute_call(
                "request.cancel",
                serde_json::to_value(RequestCancelParams {
                    context_id: context_id.to_string(),
                    request_id: request_id.to_string(),
                })
                .unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse cancel_request result: {e}"))
        })
    }

    pub async fn admin_stage_begin(
        &self,
        params: StageBeginParams,
    ) -> Result<StageBeginResult, PluginError> {
        let res = self
            .execute_call(
                "management.stage.begin",
                serde_json::to_value(params).unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse stage begin result: {e}"))
        })
    }

    pub async fn admin_stage_chunk(
        &self,
        params: StageChunkParams,
    ) -> Result<StageChunkResult, PluginError> {
        let res = self
            .execute_call(
                "management.stage.chunk",
                serde_json::to_value(params).unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse stage chunk result: {e}"))
        })
    }

    pub async fn admin_stage_finish(
        &self,
        params: StageFinishParams,
    ) -> Result<StageReviewDto, PluginError> {
        let res = self
            .execute_call(
                "management.stage.finish",
                serde_json::to_value(params).unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse stage finish result: {e}"))
        })
    }

    pub async fn admin_approve(
        &self,
        params: ApproveStageParams,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call("management.approve", serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse approve result: {e}")))
    }

    pub async fn admin_rollback(
        &self,
        params: RollbackParams,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call("management.rollback", serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse rollback result: {e}"))
        })
    }

    pub async fn admin_disable(
        &self,
        params: DisableParams,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call("management.disable", serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse disable result: {e}")))
    }

    pub async fn admin_enable(
        &self,
        params: EnableParams,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call("management.enable", serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse enable result: {e}")))
    }

    pub async fn admin_remove(
        &self,
        params: RemoveParams,
    ) -> Result<AdminRemoveResult, PluginError> {
        let res = self
            .execute_call("management.remove", serde_json::to_value(params).unwrap())
            .await?;
        serde_json::from_value(res)
            .map_err(|e| PluginError::invalid_input(format!("Failed to parse remove result: {e}")))
    }

    pub async fn admin_replace_grants(
        &self,
        params: ReplaceGrantsParams,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call(
                "management.grants.replace",
                serde_json::to_value(params).unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse replace grants result: {e}"))
        })
    }

    pub async fn admin_replace_bindings(
        &self,
        params: ReplaceBindingsParams,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call(
                "management.bindings.replace",
                serde_json::to_value(params).unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse replace bindings result: {e}"))
        })
    }
    pub async fn admin_replace_owner_history_source(
        &self,
        params: ReplaceOwnerHistorySourceParams,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call(
                "management.ownerHistorySource.replace",
                serde_json::to_value(params).unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!(
                "Failed to parse replace owner history source result: {e}"
            ))
        })
    }

    pub async fn admin_list_installations(
        &self,
        actor: &str,
    ) -> Result<AdminInstallationListResult, PluginError> {
        let res = self
            .execute_call(
                "management.installations.list",
                serde_json::to_value(AdminListParams {
                    actor_subject: actor.to_string(),
                })
                .unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse admin list result: {e}"))
        })
    }

    pub async fn admin_get_installation(
        &self,
        actor: &str,
        installation_id: &str,
    ) -> Result<AdminInstallationDto, PluginError> {
        let res = self
            .execute_call(
                "management.installations.get",
                serde_json::to_value(AdminGetParams {
                    actor_subject: actor.to_string(),
                    installation_id: installation_id.to_string(),
                })
                .unwrap(),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| {
            PluginError::invalid_input(format!("Failed to parse admin get result: {e}"))
        })
    }
}
