use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

use super::framing::{AsyncLspReader, AsyncLspWriter, FramingError};
use super::launch::{BundledLaunchSpec, LaunchError};
use super::reaper::{terminate_and_reap_tree, verify_pgid_reaped, ReaperError};
pub use super::types::{
    BoundedMessage, ByteBudgetCounter, ChildEvent, ChildStatus, FORCED_KILL_GRACE,
    GRACEFUL_SHUTDOWN_TIMEOUT, MAX_QUEUE_BYTES, MAX_QUEUE_COUNT, MAX_STDERR_RING_BYTES,
    STDIN_WRITE_TIMEOUT,
};

const TOTAL_TEARDOWN_BUDGET: Duration = Duration::from_millis(5000);

#[derive(Debug, Error)]
pub enum ChildError {
    #[error("Launch configuration error: {0}")]
    Launch(#[from] LaunchError),

    #[error("Child spawn failed: {0}")]
    SpawnFailed(#[from] std::io::Error),

    #[error("I/O handles unavailable from spawned child")]
    MissingStdio,

    #[error("Outbound command queue full: count limit ({MAX_QUEUE_COUNT}) or byte limit ({MAX_QUEUE_BYTES}) exceeded")]
    QueueFull,

    #[error("Child process is not in a running state")]
    NotRunning,

    #[error("Framing error: {0}")]
    Framing(#[from] FramingError),

    #[error("Reaper error: {0}")]
    Reaper(#[from] ReaperError),
}

#[derive(Debug)]
enum InternalSignal {
    StdoutError,
    StdoutEof,
    InboundFull,
}

pub struct SemanticChildHandle {
    pub pid: u32,
    pub pgid: u32,
    cmd_tx: mpsc::Sender<Vec<u8>>,
    stop_tx: Option<oneshot::Sender<()>>,
    byte_budget: ByteBudgetCounter,
    terminal_published: Arc<AtomicBool>,
}

impl SemanticChildHandle {
    pub fn send_message(&self, payload: Vec<u8>) -> Result<(), ChildError> {
        let msg_len = payload.len();
        if msg_len > super::framing::MAX_BODY_SIZE {
            return Err(ChildError::Framing(FramingError::BodyTooLarge(msg_len)));
        }
        std::str::from_utf8(&payload)
            .map_err(|e| ChildError::Framing(FramingError::InvalidUtf8(e)))?;
        serde_json::from_slice::<serde_json::Value>(&payload)
            .map_err(|e| ChildError::Framing(FramingError::InvalidJson(e)))?;

        if !self.byte_budget.try_reserve(msg_len) {
            return Err(ChildError::QueueFull);
        }

        match self.cmd_tx.try_send(payload) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.byte_budget.release(msg_len);
                Err(ChildError::QueueFull)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                self.byte_budget.release(msg_len);
                Err(ChildError::NotRunning)
            }
        }
    }

    pub fn shutdown(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }

    pub fn is_terminated(&self) -> bool {
        self.terminal_published.load(Ordering::Acquire)
    }
}

impl Drop for SemanticChildHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[doc(hidden)]
pub struct SemanticChildOwner;

impl SemanticChildOwner {
    #[doc(hidden)]
    pub fn spawn(
        spec: &BundledLaunchSpec,
    ) -> Result<(SemanticChildHandle, mpsc::Receiver<ChildEvent>), ChildError> {
        let mut cmd = spec.build_command();
        let mut child = cmd.spawn()?;

        let pid = child
            .id()
            .ok_or_else(|| ChildError::SpawnFailed(std::io::Error::other("Missing child PID")))?;
        let pgid = pid;

        let stdin = child.stdin.take().ok_or(ChildError::MissingStdio)?;
        let stdout = child.stdout.take().ok_or(ChildError::MissingStdio)?;
        let stderr = child.stderr.take().ok_or(ChildError::MissingStdio)?;

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<Vec<u8>>(MAX_QUEUE_COUNT);
        let (event_tx, event_rx) = mpsc::channel::<ChildEvent>(MAX_QUEUE_COUNT);
        let (internal_tx, mut internal_rx) = mpsc::channel::<InternalSignal>(4);
        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

        let outbound_budget = ByteBudgetCounter::new(MAX_QUEUE_BYTES);
        let inbound_budget = ByteBudgetCounter::new(MAX_QUEUE_BYTES);
        let terminal_published = Arc::new(AtomicBool::new(false));

        // 1. Binary-safe bounded stderr drain task with circular byte ring and redaction
        let event_tx_stderr = event_tx.clone();
        tokio::spawn(async move {
            let mut reader = stderr;
            let mut buf = [0u8; 4096];
            let mut ring = VecDeque::with_capacity(MAX_STDERR_RING_BYTES);
            let mut total_lines = 0u64;
            let mut total_bytes = 0u64;

            while let Ok(n) = reader.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                total_bytes += n as u64;
                for &b in &buf[..n] {
                    if b == b'\n' {
                        total_lines += 1;
                    }
                    if ring.len() >= MAX_STDERR_RING_BYTES {
                        ring.pop_front();
                    }
                    ring.push_back(b);
                }
            }

            let raw_bytes: Vec<u8> = ring.into_iter().collect();
            let recent_snippet = sanitize_text(&String::from_utf8_lossy(&raw_bytes));
            let _ = event_tx_stderr
                .send(ChildEvent::StderrSummary {
                    total_lines,
                    total_bytes,
                    recent_snippet,
                })
                .await;
        });

        // 2. Stdout framing reader task with byte budget enforcement
        let event_tx_stdout = event_tx.clone();
        let internal_tx_stdout = internal_tx.clone();
        let in_budget_clone = inbound_budget.clone();
        tokio::spawn(async move {
            let mut reader = AsyncLspReader::new(stdout);
            loop {
                match reader.read_message().await {
                    Ok(Some(msg)) => {
                        let msg_len = msg.len();
                        if !in_budget_clone.try_reserve(msg_len) {
                            let _ = internal_tx_stdout.send(InternalSignal::InboundFull).await;
                            break;
                        }

                        let bounded = BoundedMessage::new(msg, in_budget_clone.clone());
                        if event_tx_stdout
                            .send(ChildEvent::Message(bounded))
                            .await
                            .is_err()
                        {
                            // Event receiver dropped by consumer
                            break;
                        }
                    }
                    Ok(None) => {
                        let _ = internal_tx_stdout.send(InternalSignal::StdoutEof).await;
                        break;
                    }
                    Err(_) => {
                        let _ = internal_tx_stdout.send(InternalSignal::StdoutError).await;
                        break;
                    }
                }
            }
        });

        // 3. Owner actor
        let terminal_for_owner = Arc::clone(&terminal_published);
        let budget_for_owner = outbound_budget.clone();
        tokio::spawn(async move {
            let mut writer = AsyncLspWriter::new(stdin);
            let graceful: bool;
            let mut termination_reason: Option<ChildStatus> = None;

            loop {
                tokio::select! {
                    biased;

                    _ = &mut stop_rx => {
                        graceful = true;
                        break;
                    }

                    _ = event_tx.closed() => {
                        graceful = false;
                        break;
                    }

                    sig = internal_rx.recv() => {
                        match sig {
                            Some(InternalSignal::StdoutError) => {
                                graceful = false;
                                termination_reason = Some(ChildStatus::Crashed("Stdout framing error".into()));
                                break;
                            }
                            Some(InternalSignal::InboundFull) => {
                                graceful = false;
                                termination_reason = Some(ChildStatus::Crashed("Inbound message queue budget exceeded".into()));
                                break;
                            }
                            Some(InternalSignal::StdoutEof) | None => {
                                graceful = true;
                                break;
                            }
                        }
                    }

                    exit_res = child.wait() => {
                        let mut final_status = match exit_res {
                            Ok(st) => ChildStatus::Exited(st.code()),
                            Err(e) => ChildStatus::Crashed(e.to_string()),
                        };

                        #[cfg(unix)]
                        {
                            use nix::sys::signal::Signal;
                            let _ = super::reaper::signal_pgid(pgid, Some(Signal::SIGKILL));
                            if !verify_pgid_reaped(pgid, FORCED_KILL_GRACE).await {
                                final_status = ChildStatus::Crashed(format!("Descendant leak in PGID {pgid}"));
                            }
                        }

                        let _ = timeout(Duration::from_millis(500), event_tx.send(ChildEvent::Terminated(final_status))).await;
                        terminal_for_owner.store(true, Ordering::Release);
                        return;
                    }

                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(payload) => {
                                let payload_len = payload.len();
                                budget_for_owner.release(payload_len);

                                match timeout(STDIN_WRITE_TIMEOUT, writer.write_message(&payload)).await {
                                    Ok(Ok(())) => {}
                                    Ok(Err(_)) | Err(_) => {
                                        graceful = false;
                                        termination_reason = Some(ChildStatus::Crashed("Failed writing to child stdin".into()));
                                        break;
                                    }
                                }
                            }
                            None => {
                                graceful = true;
                                break;
                            }
                        }
                    }
                }
            }

            // Execute bounded teardown
            let teardown_result = timeout(TOTAL_TEARDOWN_BUDGET, async {
                if graceful {
                    // Phase 01 graceful LSP handshake: send shutdown RPC then exit notification
                    let shutdown_rpc =
                        br#"{"jsonrpc":"2.0","id":999999,"method":"shutdown","params":null}"#;
                    let _ = timeout(
                        Duration::from_millis(300),
                        writer.write_message(shutdown_rpc),
                    )
                    .await;

                    // Await voluntary exit within grace window
                    if let Ok(Ok(status)) = timeout(Duration::from_millis(500), child.wait()).await
                    {
                        if super::reaper::is_pgid_empty(pgid) {
                            return ChildStatus::Exited(status.code());
                        }
                    }

                    let exit_notif = br#"{"jsonrpc":"2.0","method":"exit","params":null}"#;
                    let _ =
                        timeout(Duration::from_millis(200), writer.write_message(exit_notif)).await;

                    if let Ok(Ok(status)) = timeout(Duration::from_millis(300), child.wait()).await
                    {
                        if super::reaper::is_pgid_empty(pgid) {
                            return ChildStatus::Exited(status.code());
                        }
                    }
                }

                // Forceful tree escalation
                match terminate_and_reap_tree(
                    &mut child,
                    pgid,
                    Duration::from_millis(800),
                    Duration::from_millis(1200),
                )
                .await
                {
                    Ok(status) => ChildStatus::Exited(status.code()),
                    Err(e) => ChildStatus::Crashed(e.to_string()),
                }
            })
            .await;

            // Unconditional final cleanup safety outside timeout (C1)
            #[cfg(unix)]
            {
                use nix::sys::signal::Signal;
                let _ = super::reaper::signal_pgid(pgid, Some(Signal::SIGKILL));
            }
            let _ = verify_pgid_reaped(pgid, Duration::from_millis(500)).await;

            let final_status = match teardown_result {
                Ok(status) => {
                    if let Some(reason) = termination_reason {
                        reason
                    } else if !super::reaper::is_pgid_empty(pgid) {
                        ChildStatus::Crashed(format!("Descendant leak in PGID {pgid}"))
                    } else {
                        status
                    }
                }
                Err(_) => {
                    if !super::reaper::is_pgid_empty(pgid) {
                        ChildStatus::Crashed(format!(
                            "Teardown timed out; descendant leak in PGID {pgid}"
                        ))
                    } else {
                        ChildStatus::Crashed(
                            "Teardown overall deadline exceeded (5s budget)".into(),
                        )
                    }
                }
            };

            let _ = timeout(
                Duration::from_millis(500),
                event_tx.send(ChildEvent::Terminated(final_status)),
            )
            .await;
            terminal_for_owner.store(true, Ordering::Release);
        });

        let handle = SemanticChildHandle {
            pid,
            pgid,
            cmd_tx,
            stop_tx: Some(stop_tx),
            byte_budget: outbound_budget,
            terminal_published,
        };

        Ok((handle, event_rx))
    }
}

fn sanitize_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.contains("authorization")
            || lower.contains("bearer")
            || lower.contains("token")
            || lower.contains("password")
        {
            out.push_str("[REDACTED SECRETS]\n");
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}
