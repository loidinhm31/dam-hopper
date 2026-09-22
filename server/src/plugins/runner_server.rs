use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::{UnixListener, UnixStream};
use tokio::sync::watch;
use tokio::time::timeout;

use super::contract::budgets::HANDSHAKE_TIMEOUT_SECS;
use super::contract::{
    ContextCloseParams, ContextOpenParams, PluginActivateParams, PluginActivateResult,
    PluginDeactivateParams, PluginDeactivateResult, PluginInvokeParams, PluginListParams,
    PluginListResult, PluginReadUiParams, RequestCancelParams, RunnerHelloParams,
    RunnerHelloResult, PUBLIC_RUNNER_METHODS, RUNNER_PROTOCOL_VERSION,
};
use super::error::PluginError;
use super::framing::{
    build_json_rpc_error, build_json_rpc_response, read_frame_async, validate_json_rpc_message,
    write_frame_async,
};
use super::registry::PluginRegistry;
use super::worker_supervisor::SupervisorManager;

#[derive(Debug, Clone)]
pub struct RunnerServerConfig {
    pub socket_path: PathBuf,
    pub expected_api_uid: Option<u32>,
    pub allow_root_peer: bool,
}

pub struct RunnerServer {
    pub config: RunnerServerConfig,
    pub registry: Arc<PluginRegistry>,
    pub supervisor_manager: Arc<SupervisorManager>,
}

impl RunnerServer {
    pub fn new(
        config: RunnerServerConfig,
        registry: Arc<PluginRegistry>,
        supervisor_manager: Arc<SupervisorManager>,
    ) -> Self {
        Self {
            config,
            registry,
            supervisor_manager,
        }
    }

    pub async fn run(&self, mut shutdown_rx: watch::Receiver<bool>) -> Result<(), PluginError> {
        self.validate_socket_directory()?;
        self.cleanup_existing_socket()?;

        let listener = UnixListener::bind(&self.config.socket_path).map_err(|e| {
            PluginError::runner_unavailable(format!(
                "Failed to bind socket at '{}': {e}",
                self.config.socket_path.display()
            ))
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                fs::set_permissions(&self.config.socket_path, fs::Permissions::from_mode(0o660));
        }

        tracing::info!(
            socket = %self.config.socket_path.display(),
            expected_api_uid = ?self.config.expected_api_uid,
            "RunnerServer listening on Unix socket"
        );

        loop {
            tokio::select! {
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((stream, _)) => {
                            if let Err(e) = self.verify_peer_credentials(&stream) {
                                tracing::warn!(error = %e, "Rejected unauthenticated Unix peer");
                                continue;
                            }
                            let reg = self.registry.clone();
                            let sup_mgr = self.supervisor_manager.clone();
                            tokio::spawn(async move {
                                if let Err(e) = handle_connection(stream, reg, sup_mgr).await {
                                    tracing::debug!(error = %e, "Connection closed");
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("Accept failed: {e}");
                        }
                    }
                }
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        tracing::info!("RunnerServer received shutdown signal");
                        break;
                    }
                }
            }
        }

        let _ = fs::remove_file(&self.config.socket_path);
        self.supervisor_manager.deactivate_all().await;
        Ok(())
    }

    fn validate_socket_directory(&self) -> Result<(), PluginError> {
        let parent = self.config.socket_path.parent().ok_or_else(|| {
            PluginError::invalid_input("Socket path must have a parent directory")
        })?;

        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                PluginError::runner_unavailable(format!(
                    "Failed to create runtime directory '{}': {e}",
                    parent.display()
                ))
            })?;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = fs::metadata(parent).map_err(|e| {
                PluginError::runner_unavailable(format!(
                    "Failed to read parent directory metadata: {e}"
                ))
            })?;
            let mode = metadata.permissions().mode();
            if (mode & 0o002 != 0) && (mode & 0o1000 == 0) {
                return Err(PluginError::forbidden(format!(
                    "Runtime directory '{}' is world-writable without sticky bit (mode: {:o})",
                    parent.display(),
                    mode
                )));
            }
        }

        Ok(())
    }

    fn cleanup_existing_socket(&self) -> Result<(), PluginError> {
        if self.config.socket_path.exists() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::FileTypeExt;
                let meta = fs::symlink_metadata(&self.config.socket_path).map_err(|e| {
                    PluginError::runner_unavailable(format!(
                        "Failed to stat existing socket path: {e}"
                    ))
                })?;
                if meta.file_type().is_symlink() {
                    return Err(PluginError::forbidden(
                        "Socket path is a symlink; symlinks are rejected for security",
                    ));
                }
                if !meta.file_type().is_socket() {
                    return Err(PluginError::forbidden(
                        "Existing file at socket path is not a Unix socket",
                    ));
                }
            }
            fs::remove_file(&self.config.socket_path).map_err(|e| {
                PluginError::runner_unavailable(format!("Failed to unlink existing socket: {e}"))
            })?;
        }
        Ok(())
    }

    fn verify_peer_credentials(&self, stream: &UnixStream) -> Result<(), PluginError> {
        #[cfg(unix)]
        {
            let ucred = stream.peer_cred().map_err(|e| {
                PluginError::unauthorized(format!("Failed to query peer credentials: {e}"))
            })?;
            let uid = ucred.uid();

            if uid == 0 && !self.config.allow_root_peer {
                return Err(PluginError::unauthorized(
                    "Root peer UID (0) is rejected for runner socket connection",
                ));
            }

            if let Some(expected_uid) = self.config.expected_api_uid {
                if uid != expected_uid {
                    return Err(PluginError::unauthorized(format!(
                        "Peer UID {uid} does not match expected API UID {expected_uid}",
                    )));
                }
            }
        }
        Ok(())
    }
}

async fn handle_connection(
    stream: UnixStream,
    registry: Arc<PluginRegistry>,
    supervisor_manager: Arc<SupervisorManager>,
) -> Result<(), PluginError> {
    let (mut reader, writer) = stream.into_split();
    let writer = Arc::new(tokio::sync::Mutex::new(writer));

    let handshake_frame = match timeout(
        Duration::from_secs(HANDSHAKE_TIMEOUT_SECS),
        read_frame_async(&mut reader),
    )
    .await
    {
        Ok(Ok(Some(frame))) => frame,
        Ok(Ok(None)) => return Ok(()),
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            let err_json = build_json_rpc_error(
                "unknown",
                -32603,
                "Handshake timeout: no runner.hello received within 5 seconds",
                None,
            );
            let mut w = writer.lock().await;
            let _ = write_frame_async(&mut *w, &serde_json::to_vec(&err_json).unwrap()).await;
            return Err(PluginError::deadline_exceeded("Handshake timed out"));
        }
    };

    let handshake_val = validate_json_rpc_message(&handshake_frame)?;
    let method = handshake_val
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let id = handshake_val
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("0");

    if method != "runner.hello" {
        let err_json = build_json_rpc_error(
            id,
            -32600,
            "Handshake required: first request must be runner.hello",
            None,
        );
        let mut w = writer.lock().await;
        let _ = write_frame_async(&mut *w, &serde_json::to_vec(&err_json).unwrap()).await;
        return Err(PluginError::unauthorized(
            "First request was not runner.hello",
        ));
    }

    let params: RunnerHelloParams = match handshake_val.get("params") {
        Some(p) => serde_json::from_value(p.clone())
            .map_err(|e| PluginError::invalid_input(format!("Invalid runner.hello params: {e}")))?,
        None => return Err(PluginError::invalid_input("Missing runner.hello params")),
    };

    if params.client_protocol_version != RUNNER_PROTOCOL_VERSION {
        let err_json = build_json_rpc_error(
            id,
            -32602,
            &format!(
                "Incompatible protocol version: client requested {}, runner supports {}",
                params.client_protocol_version, RUNNER_PROTOCOL_VERSION
            ),
            None,
        );
        let mut w = writer.lock().await;
        let _ = write_frame_async(&mut *w, &serde_json::to_vec(&err_json).unwrap()).await;
        return Err(PluginError::runner_unavailable("Protocol version mismatch"));
    }

    let hello_res = RunnerHelloResult {
        runner_version: env!("CARGO_PKG_VERSION").to_string(),
        negotiated_protocol_version: RUNNER_PROTOCOL_VERSION.to_string(),
        supported_capabilities: vec!["advisor.scan".to_string()],
    };

    let resp_json = build_json_rpc_response(id, serde_json::to_value(&hello_res).unwrap());
    {
        let mut w = writer.lock().await;
        write_frame_async(&mut *w, &serde_json::to_vec(&resp_json).unwrap()).await?;
    }

    while let Some(frame) = read_frame_async(&mut reader).await? {
        let parsed_msg = match validate_json_rpc_message(&frame) {
            Ok(v) => v,
            Err(e) => {
                let err_json = build_json_rpc_error("unknown", -32600, &e.to_string(), None);
                let mut w = writer.lock().await;
                let _ = write_frame_async(&mut *w, &serde_json::to_vec(&err_json).unwrap()).await;
                continue;
            }
        };

        let req_id = parsed_msg
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let req_method = parsed_msg
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let params_val = parsed_msg
            .get("params")
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        let reg = registry.clone();
        let sup_mgr = supervisor_manager.clone();
        let w_clone = writer.clone();

        tokio::spawn(async move {
            if !PUBLIC_RUNNER_METHODS.contains(&req_method.as_str()) {
                let err_json = build_json_rpc_error(
                    &req_id,
                    -32601,
                    &format!("Method '{req_method}' not found or not permitted"),
                    None,
                );
                let mut w = w_clone.lock().await;
                let _ = write_frame_async(&mut *w, &serde_json::to_vec(&err_json).unwrap()).await;
                return;
            }

            let dispatch_result =
                dispatch_method(&req_id, &req_method, params_val, &reg, &sup_mgr).await;

            let resp_payload = match dispatch_result {
                Ok(res_val) => build_json_rpc_response(&req_id, res_val),
                Err(err) => build_json_rpc_error(&req_id, -32603, &err.to_string(), None),
            };

            let mut w = w_clone.lock().await;
            let _ = write_frame_async(&mut *w, &serde_json::to_vec(&resp_payload).unwrap()).await;
        });
    }

    Ok(())
}

async fn dispatch_method(
    req_id: &str,
    method: &str,
    params: serde_json::Value,
    registry: &Arc<PluginRegistry>,
    supervisor_manager: &Arc<SupervisorManager>,
) -> Result<serde_json::Value, PluginError> {
    match method {
        "runner.hello" => {
            let res = RunnerHelloResult {
                runner_version: env!("CARGO_PKG_VERSION").to_string(),
                negotiated_protocol_version: RUNNER_PROTOCOL_VERSION.to_string(),
                supported_capabilities: vec!["advisor.scan".to_string()],
            };
            Ok(serde_json::to_value(res).unwrap())
        }
        "plugin.list" => {
            let params: PluginListParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid plugin.list params: {e}"))
            })?;
            let (plugins, _) = registry.list_plugins()?;
            let filtered = if params.include_disabled {
                plugins
            } else {
                plugins.into_iter().filter(|p| p.enabled).collect()
            };
            Ok(serde_json::to_value(PluginListResult { plugins: filtered }).unwrap())
        }
        "plugin.readUi" => {
            let params: PluginReadUiParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid plugin.readUi params: {e}"))
            })?;
            let res = registry.read_ui_bytes(&params)?;
            Ok(serde_json::to_value(res).unwrap())
        }
        "plugin.activate" => {
            let params: PluginActivateParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid plugin.activate params: {e}"))
            })?;
            let sup = supervisor_manager
                .get_or_create(&params.installation_id)
                .await?;
            sup.activate().await?;
            Ok(serde_json::to_value(PluginActivateResult {
                activation_generation: sup.generation(),
                status: "active".to_string(),
            })
            .unwrap())
        }
        "plugin.deactivate" => {
            let params: PluginDeactivateParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid plugin.deactivate params: {e}"))
            })?;
            supervisor_manager
                .deactivate(&params.installation_id)
                .await?;
            Ok(serde_json::to_value(PluginDeactivateResult {
                status: "inactive".to_string(),
            })
            .unwrap())
        }
        "context.open" => {
            let params: ContextOpenParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid context.open params: {e}"))
            })?;
            let sup = supervisor_manager
                .get_or_create(&params.installation_id)
                .await?;
            let res = sup.open_context(params).await?;
            Ok(serde_json::to_value(res).unwrap())
        }
        "context.close" => {
            let params: ContextCloseParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid context.close params: {e}"))
            })?;
            let sup = supervisor_manager
                .get_by_context(&params.context_id)
                .await?;
            let res = sup.close_context(params).await?;
            Ok(serde_json::to_value(res).unwrap())
        }
        "plugin.invoke" => {
            let params: PluginInvokeParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid plugin.invoke params: {e}"))
            })?;
            let sup = supervisor_manager
                .get_by_context(&params.context_id)
                .await?;
            let res = sup.invoke(req_id, params).await?;
            Ok(serde_json::to_value(res).unwrap())
        }
        "request.cancel" => {
            let params: RequestCancelParams = serde_json::from_value(params).map_err(|e| {
                PluginError::invalid_input(format!("Invalid request.cancel params: {e}"))
            })?;
            let res = supervisor_manager.cancel_request(params).await;
            Ok(serde_json::to_value(res).unwrap())
        }
        _ => Err(PluginError::invalid_input(format!(
            "Unhandled method '{method}'"
        ))),
    }
}
