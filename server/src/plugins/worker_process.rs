use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::contract::budgets::{GRACEFUL_STOP_TIMEOUT_SECS, HANDSHAKE_TIMEOUT_SECS};
use super::contract::RUNNER_PROTOCOL_VERSION;
use super::error::PluginError;
use super::framing::{
    build_json_rpc_request, read_frame_async, validate_json_rpc_message, write_frame_async,
};

#[derive(Debug, Clone)]
pub struct WorkerProcessConfig {
    pub node_bin: PathBuf,
    pub package_dir: PathBuf,
    pub entrypoint: PathBuf,
    pub installation_id: String,
    pub generation: u64,
}

pub struct WorkerProcess {
    pub config: WorkerProcessConfig,
    pub pid: u32,
    pgid: i32,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    pending_requests:
        Arc<Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, PluginError>>>>>,
    stderr_lines: Arc<Mutex<Vec<String>>>,
    is_alive: Arc<AtomicBool>,
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
    next_req_id: AtomicU64,
}

impl WorkerProcess {
    pub async fn spawn(config: WorkerProcessConfig) -> Result<Arc<Self>, PluginError> {
        if !config.node_bin.exists() {
            return Err(PluginError::runner_unavailable(format!(
                "Node executable not found at '{}'",
                config.node_bin.display()
            )));
        }

        let entrypoint_abs = if config.entrypoint.is_absolute() {
            config.entrypoint.clone()
        } else {
            config.package_dir.join(&config.entrypoint)
        };

        if !entrypoint_abs.exists() {
            return Err(PluginError::runner_unavailable(format!(
                "Worker entrypoint not found at '{}'",
                entrypoint_abs.display()
            )));
        }

        let mut cmd = Command::new(&config.node_bin);
        cmd.arg(&entrypoint_abs);
        cmd.current_dir(&config.package_dir);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Restrict environment to runtime paths; never forward credentials or service settings.
        cmd.env_clear();
        for variable in ["PATH", "HOME"] {
            if let Ok(value) = std::env::var(variable) {
                cmd.env(variable, value);
            }
        }
        cmd.env("NODE_ENV", "production");
        cmd.env("TMPDIR", "/tmp");

        #[cfg(unix)]
        {
            cmd.process_group(0);
        }

        let mut child = cmd.spawn().map_err(|e| {
            PluginError::runner_unavailable(format!("Failed to spawn worker process: {e}"))
        })?;

        let pid = child
            .id()
            .ok_or_else(|| PluginError::runner_unavailable("Worker process spawned without PID"))?;

        let pgid = pid as i32;

        let stdin = child.stdin.take().ok_or_else(|| {
            PluginError::runner_unavailable("Failed to capture worker stdin pipe")
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            PluginError::runner_unavailable("Failed to capture worker stdout pipe")
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            PluginError::runner_unavailable("Failed to capture worker stderr pipe")
        })?;

        let pending_requests: Arc<
            Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, PluginError>>>>,
        > = Arc::new(Mutex::new(HashMap::new()));
        let stderr_lines = Arc::new(Mutex::new(Vec::new()));
        let is_alive = Arc::new(AtomicBool::new(true));

        let pending_clone = pending_requests.clone();
        let is_alive_clone = is_alive.clone();

        // Stdout reader task: processes length-prefixed JSON-RPC frames
        tokio::spawn(async move {
            let mut reader = stdout;
            loop {
                match read_frame_async(&mut reader).await {
                    Ok(Some(frame_text)) => {
                        let parsed = validate_json_rpc_message(&frame_text);
                        match parsed {
                            Ok(msg) => {
                                if let Some(id_val) = msg.get("id").and_then(|v| v.as_str()) {
                                    let sender = pending_clone.lock().remove(id_val);
                                    if let Some(tx) = sender {
                                        if let Some(err_val) = msg.get("error") {
                                            let err_msg = err_val
                                                .get("message")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("Worker returned error");
                                            let _ =
                                                tx.send(Err(PluginError::worker_failed(err_msg)));
                                        } else if let Some(res_val) = msg.get("result") {
                                            let _ = tx.send(Ok(res_val.clone()));
                                        } else {
                                            let _ = tx.send(Ok(serde_json::Value::Null));
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Corrupted JSON from worker stdout: {e}");
                                is_alive_clone.store(false, Ordering::SeqCst);
                                let mut pending = pending_clone.lock();
                                for (_, tx) in pending.drain() {
                                    let _ = tx.send(Err(PluginError::worker_failed(
                                        "Worker stdout protocol violation",
                                    )));
                                }
                                break;
                            }
                        }
                    }
                    Ok(None) => {
                        // Clean EOF from worker stdout
                        is_alive_clone.store(false, Ordering::SeqCst);
                        let mut pending = pending_clone.lock();
                        for (_, tx) in pending.drain() {
                            let _ = tx.send(Err(PluginError::worker_failed(
                                "Worker closed connection unexpectedly",
                            )));
                        }
                        break;
                    }
                    Err(err) => {
                        tracing::warn!("Frame decode error from worker: {err}");
                        is_alive_clone.store(false, Ordering::SeqCst);
                        let mut pending = pending_clone.lock();
                        for (_, tx) in pending.drain() {
                            let _ = tx.send(Err(PluginError::worker_failed(format!(
                                "Worker frame error: {err}"
                            ))));
                        }
                        break;
                    }
                }
            }
        });

        // Stderr reader task: sanitizes and bounds diagnostics
        let stderr_lines_clone = stderr_lines.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                // Sanitize: truncate line length and bound storage
                let sanitized = if line.len() > 1024 {
                    let end = line
                        .char_indices()
                        .map(|(i, _)| i)
                        .take_while(|&i| i <= 1024)
                        .last()
                        .unwrap_or(0);
                    format!("{}...", &line[..end])
                } else {
                    line
                };
                let mut lines = stderr_lines_clone.lock();
                if lines.len() >= 50 {
                    lines.remove(0);
                }
                lines.push(sanitized);
            }
        });

        let worker = Arc::new(Self {
            config,
            pid,
            pgid,
            stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
            pending_requests,
            stderr_lines,
            is_alive,
            child: Arc::new(tokio::sync::Mutex::new(Some(child))),
            next_req_id: AtomicU64::new(1),
        });

        // Perform runner.hello handshake with worker within 5 seconds
        let handshake_res = timeout(
            Duration::from_secs(HANDSHAKE_TIMEOUT_SECS),
            worker.send_request_internal(
                "init-handshake",
                "runner.hello",
                serde_json::json!({
                    "hostVersion": env!("CARGO_PKG_VERSION"),
                    "clientProtocolVersion": RUNNER_PROTOCOL_VERSION,
                }),
            ),
        )
        .await;

        match handshake_res {
            Ok(Ok(_)) => {
                tracing::info!(pid = worker.pid, "Worker handshake completed successfully");
                Ok(worker)
            }
            Ok(Err(e)) => {
                let stderr_dump = worker.stderr_diagnostics().join("\n");
                tracing::error!(pid = worker.pid, stderr = %stderr_dump, error = %e, "Worker handshake rejected");
                worker.kill_process_group().await;
                Err(PluginError::runner_unavailable(format!(
                    "Worker handshake failed: {e}"
                )))
            }
            Err(_) => {
                tracing::error!(pid = worker.pid, "Worker handshake timed out");
                worker.kill_process_group().await;
                Err(PluginError::runner_unavailable(
                    "Worker handshake timed out after 5 seconds",
                ))
            }
        }
    }

    pub fn is_alive(&self) -> bool {
        self.is_alive.load(Ordering::SeqCst)
    }

    pub fn generate_request_id(&self) -> String {
        let n = self.next_req_id.fetch_add(1, Ordering::SeqCst);
        format!("req-{}-{}", self.pid, n)
    }

    pub async fn send_request(
        &self,
        id: &str,
        method: &str,
        params: serde_json::Value,
        req_timeout: Duration,
    ) -> Result<serde_json::Value, PluginError> {
        if !self.is_alive() {
            return Err(PluginError::worker_failed("Worker process is not running"));
        }

        match timeout(req_timeout, self.send_request_internal(id, method, params)).await {
            Ok(res) => res,
            Err(_) => {
                self.pending_requests.lock().remove(id);
                Err(PluginError::deadline_exceeded(format!(
                    "Request '{id}' timed out after {:?}",
                    req_timeout
                )))
            }
        }
    }

    async fn send_request_internal(
        &self,
        id: &str,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        let (tx, rx) = oneshot::channel();
        self.pending_requests.lock().insert(id.to_string(), tx);

        let req_json = build_json_rpc_request(id, method, params);
        let req_bytes = serde_json::to_vec(&req_json).map_err(|e| {
            self.pending_requests.lock().remove(id);
            PluginError::invalid_input(format!("Failed to serialize request: {e}"))
        })?;

        {
            let mut stdin_guard = self.stdin.lock().await;
            if let Err(e) = write_frame_async(&mut *stdin_guard, &req_bytes).await {
                self.pending_requests.lock().remove(id);
                self.is_alive.store(false, Ordering::SeqCst);
                return Err(PluginError::worker_failed(format!(
                    "Failed to write to worker stdin: {e}"
                )));
            }
        }

        rx.await.map_err(|_| {
            PluginError::worker_failed("Worker dropped response channel prematurely")
        })?
    }

    pub async fn send_notification(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<(), PluginError> {
        if !self.is_alive() {
            return Err(PluginError::worker_failed("Worker process is not running"));
        }

        let notif_json = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });

        let notif_bytes = serde_json::to_vec(&notif_json).map_err(|e| {
            PluginError::invalid_input(format!("Failed to serialize notification: {e}"))
        })?;

        let mut stdin_guard = self.stdin.lock().await;
        write_frame_async(&mut *stdin_guard, &notif_bytes)
            .await
            .map_err(|e| {
                self.is_alive.store(false, Ordering::SeqCst);
                PluginError::worker_failed(format!("Failed to write notification to worker: {e}"))
            })
    }

    pub async fn kill_process_group(&self) {
        self.is_alive.store(false, Ordering::SeqCst);

        // First attempt graceful stop notification with bounded 5s wait
        let _ = self
            .send_notification(
                "worker.shutdown",
                serde_json::json!({
                    "reason": "supervisor_teardown"
                }),
            )
            .await;

        let mut child_guard = self.child.lock().await;
        if let Some(child) = child_guard.as_mut() {
            let wait_res = timeout(
                Duration::from_secs(GRACEFUL_STOP_TIMEOUT_SECS),
                child.wait(),
            )
            .await;
            if wait_res.is_err() {
                // Escalation: Send SIGTERM to process group
                #[cfg(unix)]
                {
                    unsafe {
                        libc::kill(-self.pgid, libc::SIGTERM);
                    }
                }
                // Short wait before hard SIGKILL
                tokio::time::sleep(Duration::from_millis(500)).await;
                #[cfg(unix)]
                {
                    unsafe {
                        libc::kill(-self.pgid, libc::SIGKILL);
                    }
                }
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
        }
        *child_guard = None;

        // Drain pending requests
        let mut pending = self.pending_requests.lock();
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(PluginError::worker_failed("Worker terminated")));
        }
    }

    pub fn stderr_diagnostics(&self) -> Vec<String> {
        self.stderr_lines.lock().clone()
    }
}
