use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::timeout;

use super::framing::{AsyncLspReader, AsyncLspWriter, FramingError};
use super::launch::{BundledLaunchSpec, LaunchError};
use super::pressure::{OutboundChildMessage, OutboundSlotPermit, SessionPressureCounters};
use super::reaper::{
    merge_descendants, sample_tree_resources, terminate_and_reap_tree_with_descendants,
    verify_pids_dead, verify_tree_reaped, ReaperError,
};
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
    cmd_tx: mpsc::Sender<OutboundChildMessage>,
    stop_tx: Option<oneshot::Sender<()>>,
    byte_budget: ByteBudgetCounter,
    terminal_published: Arc<AtomicBool>,
    term_rx: watch::Receiver<Option<ChildStatus>>,
    counters: Arc<SessionPressureCounters>,
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
        let permit = match self.cmd_tx.try_reserve() {
            Ok(p) => p,
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.byte_budget.release(msg_len);
                return Err(ChildError::QueueFull);
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                self.byte_budget.release(msg_len);
                return Err(ChildError::NotRunning);
            }
        };

        let slot_permit = OutboundSlotPermit::new(
            msg_len,
            Arc::clone(&self.counters),
            self.byte_budget.clone(),
        );

        permit.send(OutboundChildMessage {
            payload,
            permit: slot_permit,
        });
        Ok(())
    }

    pub fn shutdown(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }

    pub fn is_terminated(&self) -> bool {
        self.terminal_published.load(Ordering::Acquire)
    }

    /// Awaits terminal status publication directly from the owner actor without depending on
    /// bounded stdout message queue capacity.
    pub async fn wait_terminated(&mut self) -> ChildStatus {
        loop {
            if let Some(status) = self.term_rx.borrow().clone() {
                return status;
            }
            if self.term_rx.changed().await.is_err() {
                return self
                    .term_rx
                    .borrow()
                    .clone()
                    .unwrap_or_else(|| ChildStatus::Crashed("Child owner task exited".into()));
            }
        }
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
        Self::spawn_with_counters(spec, Arc::new(SessionPressureCounters::default()))
    }

    #[doc(hidden)]
    pub fn spawn_with_counters(
        spec: &BundledLaunchSpec,
        counters: Arc<SessionPressureCounters>,
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

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<OutboundChildMessage>(MAX_QUEUE_COUNT);
        let (event_tx, event_rx) = mpsc::channel::<ChildEvent>(MAX_QUEUE_COUNT);
        let (internal_tx, mut internal_rx) = mpsc::channel::<InternalSignal>(4);
        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let (term_tx, term_rx) = watch::channel::<Option<ChildStatus>>(None);

        let max_processes_per_tree = spec.max_processes_per_tree;
        let max_tree_rss_bytes = spec.max_tree_rss_bytes;

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
        tokio::spawn(async move {
            let mut writer = AsyncLspWriter::new(stdin);
            let graceful: bool;
            let mut termination_reason: Option<ChildStatus> = None;
            let mut recorded_descendants: Vec<u32> = Vec::new();
            let mut resource_ticker = tokio::time::interval(Duration::from_millis(200));

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
                        merge_descendants(pgid, &mut recorded_descendants);
                        let mut final_status = match exit_res {
                            Ok(st) => ChildStatus::Exited(st.code()),
                            Err(e) => ChildStatus::Crashed(e.to_string()),
                        };

                        #[cfg(unix)]
                        {
                            use nix::sys::signal::{kill, Signal};
                            use nix::unistd::Pid;
                            let _ = super::reaper::signal_pgid(pgid, Some(Signal::SIGKILL));
                            for &desc_pid in &recorded_descendants {
                                let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGKILL));
                            }
                            if !verify_tree_reaped(pgid, &recorded_descendants, FORCED_KILL_GRACE).await {
                                final_status = ChildStatus::Crashed(format!("Descendant leak in PGID {pgid}"));
                            }
                        }

                        // Release queued payloads and close admission before terminal acknowledgment.
                        drop(cmd_rx);
                        let _ = term_tx.send(Some(final_status.clone()));
                        terminal_for_owner.store(true, Ordering::Release);
                        let _ = timeout(Duration::from_millis(500), event_tx.send(ChildEvent::Terminated(final_status))).await;
                        return;
                    }

                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(msg) => {
                                let OutboundChildMessage { payload, permit } = msg;
                                drop(permit);
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

                    _ = resource_ticker.tick() => {
                        let sample = sample_tree_resources(pid);
                        for p in sample.pids {
                            if p != pid && !recorded_descendants.contains(&p) {
                                recorded_descendants.push(p);
                            }
                        }
                        if sample.process_count > max_processes_per_tree {
                            graceful = false;
                            termination_reason = Some(ChildStatus::Crashed(format!(
                                "Portable process tree limit exceeded: {} > {}",
                                sample.process_count, max_processes_per_tree
                            )));
                            break;
                        }
                        if sample.rss_bytes > max_tree_rss_bytes {
                            graceful = false;
                            termination_reason = Some(ChildStatus::Crashed(format!(
                                "Portable sampled RSS limit exceeded: {} bytes > {} bytes",
                                sample.rss_bytes, max_tree_rss_bytes
                            )));
                            break;
                        }
                    }
                }
            }
            drop(cmd_rx);

            // Snapshot descendants before sending graceful shutdown RPC so `/proc/<pid>/children` is captured while alive
            merge_descendants(pgid, &mut recorded_descendants);

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
                        merge_descendants(pgid, &mut recorded_descendants);
                        if verify_tree_reaped(
                            pgid,
                            &recorded_descendants,
                            Duration::from_millis(100),
                        )
                        .await
                        {
                            return ChildStatus::Exited(status.code());
                        }
                    }

                    let exit_notif = br#"{"jsonrpc":"2.0","method":"exit","params":null}"#;
                    let _ =
                        timeout(Duration::from_millis(200), writer.write_message(exit_notif)).await;

                    if let Ok(Ok(status)) = timeout(Duration::from_millis(300), child.wait()).await
                    {
                        merge_descendants(pgid, &mut recorded_descendants);
                        if verify_tree_reaped(
                            pgid,
                            &recorded_descendants,
                            Duration::from_millis(100),
                        )
                        .await
                        {
                            return ChildStatus::Exited(status.code());
                        }
                    }
                }

                // Forceful tree escalation
                match terminate_and_reap_tree_with_descendants(
                    &mut child,
                    pgid,
                    &mut recorded_descendants,
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
            merge_descendants(pgid, &mut recorded_descendants);
            #[cfg(unix)]
            {
                use nix::sys::signal::{kill, Signal};
                use nix::unistd::Pid;
                let _ = super::reaper::signal_pgid(pgid, Some(Signal::SIGKILL));
                for &desc_pid in &recorded_descendants {
                    let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGKILL));
                }
            }
            let _ =
                verify_tree_reaped(pgid, &recorded_descendants, Duration::from_millis(500)).await;

            let tree_clean =
                super::reaper::is_pgid_empty(pgid) && verify_pids_dead(&recorded_descendants);
            let final_status = match teardown_result {
                Ok(status) => {
                    if let Some(reason) = termination_reason {
                        reason
                    } else if !tree_clean {
                        ChildStatus::Crashed(format!("Descendant leak in PGID {pgid}"))
                    } else {
                        status
                    }
                }
                Err(_) => {
                    if !tree_clean {
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

            let _ = term_tx.send(Some(final_status.clone()));
            terminal_for_owner.store(true, Ordering::Release);
            let _ = timeout(
                Duration::from_millis(500),
                event_tx.send(ChildEvent::Terminated(final_status)),
            )
            .await;
        });

        let handle = SemanticChildHandle {
            pid,
            pgid,
            cmd_tx,
            stop_tx: Some(stop_tx),
            byte_budget: outbound_budget,
            terminal_published,
            term_rx,
            counters,
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
