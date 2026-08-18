use crate::persistence::SessionStore;
use crate::pty::SessionMeta;
use std::collections::HashMap;
use std::sync::{
    mpsc::{Receiver, RecvTimeoutError},
    Arc,
};
use std::time::{Duration, Instant};
use tracing::{debug, warn};

/// Commands sent to the persist worker thread.
#[derive(Debug)]
pub enum PersistCmd {
    /// Buffer update — worker batches per session, writes latest
    BufferUpdate {
        session_id: String,
        incarnation: u64,
        data: Vec<u8>,
        total_written: u64,
    },
    /// Session created — insert metadata row
    SessionCreated {
        meta: SessionMeta,
        incarnation: u64,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
        restart_max_retries: u32,
    },
    /// Session exited — flush buffer immediately
    SessionExited {
        session_id: String,
        incarnation: u64,
    },
    /// Replacement or setup failed after an existing identity was evicted.
    /// Keep the persisted row dead so restart cannot resurrect the old PTY.
    SessionDead {
        session_id: String,
        incarnation: u64,
    },
    /// Target disappeared — retain metadata for reconnect/retry without respawn.
    SessionTargetUnavailable {
        session_id: String,
        incarnation: u64,
    },
    /// Target disappeared before the normal SessionCreated command could
    /// create a row. Upsert the complete non-respawning identity instead of
    /// issuing an update against a row that may not exist yet.
    SessionTargetUnavailableUpsert {
        meta: SessionMeta,
        incarnation: u64,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
        restart_max_retries: u32,
    },
    /// Session removed — delete from DB
    SessionRemoved {
        session_id: String,
        incarnation: u64,
    },
    /// Graceful shutdown — flush all and exit
    Shutdown,
}

/// Pending buffer data waiting to be flushed to SQLite.
struct PendingBuffer {
    data: Vec<u8>,
    total_written: u64,
}

/// Async worker thread that batches buffer writes to SQLite.
///
/// Receives commands via mpsc channel from PTY reader threads.
/// Flushes to disk every 5s, on session exit, or on shutdown.
pub struct PersistWorker {
    rx: Receiver<PersistCmd>,
    store: Arc<SessionStore>,
    pending: HashMap<(String, u64), PendingBuffer>,
    last_flush: Instant,
}

impl PersistWorker {
    /// Creates a new persist worker with the given channel receiver and session store.
    pub fn new(rx: Receiver<PersistCmd>, store: Arc<SessionStore>) -> Self {
        Self {
            rx,
            store,
            pending: HashMap::new(),
            last_flush: Instant::now(),
        }
    }

    /// Main worker loop — runs until channel is closed or Shutdown command received.
    pub fn run(mut self) {
        debug!("Persist worker started");

        loop {
            // Non-blocking recv with 1s timeout
            match self.rx.recv_timeout(Duration::from_secs(1)) {
                Ok(cmd) => {
                    if !self.handle_cmd(cmd) {
                        // Shutdown command received
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    // Normal timeout, continue to check flush timer
                }
                Err(RecvTimeoutError::Disconnected) => {
                    debug!("Persist worker channel disconnected");
                    break;
                }
            }

            // Periodic flush every 5s
            if self.last_flush.elapsed() > Duration::from_secs(5) {
                self.flush_all();
            }
        }

        // Final flush on shutdown
        self.flush_all();
        debug!("Persist worker stopped");
    }

    /// Handles a single command from the channel.
    /// Returns true if should continue, false if should exit loop.
    fn handle_cmd(&mut self, cmd: PersistCmd) -> bool {
        match cmd {
            PersistCmd::BufferUpdate {
                session_id,
                incarnation,
                data,
                total_written,
            } => {
                // Batch: only keep latest update per session
                self.pending.insert(
                    (session_id, incarnation),
                    PendingBuffer {
                        data,
                        total_written,
                    },
                );
                true
            }
            PersistCmd::SessionCreated {
                meta,
                incarnation,
                env,
                cols,
                rows,
                restart_max_retries,
            } => {
                if let Err(e) = self.store.save_session_for_incarnation(
                    &meta,
                    incarnation,
                    &env,
                    cols,
                    rows,
                    restart_max_retries,
                ) {
                    warn!(session_id = %meta.id, error = %e, "Failed to persist session");
                }
                true
            }
            PersistCmd::SessionExited {
                session_id,
                incarnation,
            } => {
                // Flush buffer immediately, then mark dead so restore skips it.
                // Row and buffer are kept so attach can still replay the final output.
                self.flush_session(&session_id, incarnation);
                if let Err(e) = self
                    .store
                    .mark_session_dead_for_incarnation(&session_id, incarnation)
                {
                    warn!(session_id, error = %e, "Failed to mark session dead");
                }
                true
            }
            PersistCmd::SessionDead {
                session_id,
                incarnation,
            } => {
                if let Err(e) = self
                    .store
                    .mark_session_dead_for_incarnation(&session_id, incarnation)
                {
                    warn!(session_id, error = %e, "Failed to mark failed replacement dead");
                }
                true
            }
            PersistCmd::SessionTargetUnavailable {
                session_id,
                incarnation,
            } => {
                if let Err(e) = self
                    .store
                    .mark_session_target_unavailable_for_incarnation(&session_id, incarnation)
                {
                    warn!(session_id, error = %e, "Failed to retain unavailable target session");
                }
                true
            }
            PersistCmd::SessionTargetUnavailableUpsert {
                meta,
                incarnation,
                env,
                cols,
                rows,
                restart_max_retries,
            } => {
                if let Err(e) = self.store.save_session_target_unavailable_for_incarnation(
                    &meta,
                    incarnation,
                    &env,
                    cols,
                    rows,
                    restart_max_retries,
                ) {
                    warn!(session_id = %meta.id, error = %e, "Failed to upsert unavailable target session");
                }
                true
            }
            PersistCmd::SessionRemoved {
                session_id,
                incarnation,
            } => {
                // Remove from pending queue and delete from DB
                self.pending.retain(|(pending_id, pending_incarnation), _| {
                    pending_id != &session_id || incarnation != *pending_incarnation
                });
                if let Err(e) = self
                    .store
                    .delete_session_for_incarnation(&session_id, incarnation)
                {
                    warn!(session_id, error = %e, "Failed to delete persisted session");
                }
                true
            }
            PersistCmd::Shutdown => {
                // Shutdown signal - return false to exit loop
                false
            }
        }
    }

    /// Flushes all pending buffers to SQLite and clears the pending map.
    fn flush_all(&mut self) {
        if self.pending.is_empty() {
            return;
        }

        debug!(count = self.pending.len(), "Flushing all pending buffers");
        // Collect into Vec to avoid borrow checker conflict
        let items: Vec<_> = self.pending.drain().collect();
        for ((session_id, incarnation), buf) in items {
            self.write_buffer(&session_id, incarnation, &buf);
        }
        self.last_flush = Instant::now();
    }

    /// Flushes a specific session's buffer to SQLite and removes it from pending.
    fn flush_session(&mut self, session_id: &str, incarnation: u64) {
        if let Some(buf) = self.pending.remove(&(session_id.to_string(), incarnation)) {
            debug!(session_id, "Flushing session buffer on exit");
            self.write_buffer(session_id, incarnation, &buf);
        }
    }

    /// Writes buffer data to SQLite.
    fn write_buffer(&self, session_id: &str, incarnation: u64, buf: &PendingBuffer) {
        debug!(
            session_id,
            bytes = buf.data.len(),
            total_written = buf.total_written,
            "Writing buffer to SQLite"
        );
        if let Err(e) = self.store.save_buffer_for_incarnation(
            session_id,
            incarnation,
            &buf.data,
            buf.total_written,
        ) {
            warn!(session_id, error = %e, "Failed to persist buffer");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RestartPolicy;
    use crate::persistence::SessionStore;
    use crate::pty::session::SessionType;
    use std::sync::mpsc;
    use tempfile::TempDir;

    fn create_test_store() -> (Arc<SessionStore>, TempDir) {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let store = SessionStore::open(&db_path).unwrap();
        (Arc::new(store), tmp)
    }

    fn create_test_meta(id: &str) -> SessionMeta {
        SessionMeta {
            id: id.to_string(),
            incarnation: 0,
            project: None,
            command: "test".to_string(),
            cwd: "/tmp".to_string(),
            worktree_path: None,
            session_type: SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: 1234567890,
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
            target_unavailable: false,
        }
    }

    #[test]
    fn test_buffer_batching() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let meta = create_test_meta("s1");
        let env = HashMap::new();

        // Create session first (required for foreign key constraint)
        tx.send(PersistCmd::SessionCreated {
            meta,
            incarnation: 0,
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        // Send multiple buffer updates for same session
        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
            incarnation: 0,
            data: b"first".to_vec(),
            total_written: 5,
        })
        .unwrap();

        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
            incarnation: 0,
            data: b"second".to_vec(),
            total_written: 11,
        })
        .unwrap();

        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        // Only latest should be persisted
        let loaded = (*store).load_buffer("s1").unwrap();
        assert!(loaded.is_some());
        let (data, total) = loaded.unwrap();
        assert_eq!(data, b"second");
        assert_eq!(total, 11);
    }

    #[test]
    fn test_session_created() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let meta = create_test_meta("s1");
        let env = HashMap::new();

        tx.send(PersistCmd::SessionCreated {
            meta: meta.clone(),
            incarnation: 0,
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        // Session should be persisted
        let sessions = (*store).load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].meta.id, "s1");
    }

    #[test]
    fn test_target_unavailable_upsert_creates_missing_session() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let mut meta = create_test_meta("s1");
        meta.project = Some("demo".to_string());
        meta.worktree_path = Some("/tmp/demo-worktree".to_string());
        let env = HashMap::from([("MODE".to_string(), "target".to_string())]);

        tx.send(PersistCmd::SessionTargetUnavailableUpsert {
            meta,
            incarnation: 12,
            env,
            cols: 132,
            rows: 40,
            restart_max_retries: 7,
        })
        .unwrap();
        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].meta.target_unavailable);
        assert_eq!(sessions[0].incarnation, 12);
        assert_eq!(sessions[0].cols, 132);
        assert_eq!(sessions[0].rows, 40);
    }

    #[test]
    fn test_session_exit_immediate_flush() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let meta = create_test_meta("s1");
        let env = HashMap::new();

        // Create session first
        tx.send(PersistCmd::SessionCreated {
            meta,
            incarnation: 0,
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
            incarnation: 0,
            data: b"data".to_vec(),
            total_written: 4,
        })
        .unwrap();

        tx.send(PersistCmd::SessionExited {
            session_id: "s1".to_string(),
            incarnation: 0,
        })
        .unwrap();

        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        // Buffer should be persisted even without waiting for timer
        let loaded = (*store).load_buffer("s1").unwrap();
        assert!(loaded.is_some());
    }

    #[test]
    fn test_failed_replacement_is_not_restored() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        tx.send(PersistCmd::SessionCreated {
            meta: create_test_meta("s1"),
            incarnation: 0,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();
        tx.send(PersistCmd::SessionDead {
            session_id: "s1".to_string(),
            incarnation: 0,
        })
        .unwrap();
        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        assert!(
            store.load_sessions().unwrap().is_empty(),
            "a failed replacement must not be resurrected on restart"
        );
    }

    #[test]
    fn late_session_exit_does_not_clear_target_unavailable_state() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        tx.send(PersistCmd::SessionCreated {
            meta: create_test_meta("target-late-exit"),
            incarnation: 1,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();
        tx.send(PersistCmd::SessionTargetUnavailable {
            session_id: "target-late-exit".to_string(),
            incarnation: 1,
        })
        .unwrap();
        tx.send(PersistCmd::SessionExited {
            session_id: "target-late-exit".to_string(),
            incarnation: 1,
        })
        .unwrap();
        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].meta.target_unavailable);
    }

    #[test]
    fn test_session_removed_deletes_from_db() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let meta = create_test_meta("s1");
        let env = HashMap::new();

        // Create session
        tx.send(PersistCmd::SessionCreated {
            meta: meta.clone(),
            incarnation: 0,
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        // Then remove it
        tx.send(PersistCmd::SessionRemoved {
            session_id: "s1".to_string(),
            incarnation: 0,
        })
        .unwrap();

        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        // Session should be deleted
        let sessions = (*store).load_sessions().unwrap();
        assert_eq!(sessions.len(), 0);
    }

    #[test]
    fn test_graceful_shutdown_flushes_all() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let meta1 = create_test_meta("s1");
        let meta2 = create_test_meta("s2");
        let env = HashMap::new();

        // Create sessions first
        tx.send(PersistCmd::SessionCreated {
            meta: meta1,
            incarnation: 0,
            env: env.clone(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        tx.send(PersistCmd::SessionCreated {
            meta: meta2,
            incarnation: 0,
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        // Add buffer updates without explicit flush
        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
            incarnation: 0,
            data: b"data1".to_vec(),
            total_written: 5,
        })
        .unwrap();

        tx.send(PersistCmd::BufferUpdate {
            session_id: "s2".to_string(),
            incarnation: 0,
            data: b"data2".to_vec(),
            total_written: 5,
        })
        .unwrap();

        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        // Both should be flushed on shutdown
        assert!((*store).load_buffer("s1").unwrap().is_some());
        assert!((*store).load_buffer("s2").unwrap().is_some());
    }

    #[test]
    fn stale_incarnation_commands_cannot_mutate_reused_session_id() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        tx.send(PersistCmd::SessionCreated {
            meta: create_test_meta("reused"),
            incarnation: 1,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();
        tx.send(PersistCmd::BufferUpdate {
            session_id: "reused".to_string(),
            incarnation: 1,
            data: b"old incarnation".to_vec(),
            total_written: 15,
        })
        .unwrap();

        let mut new_meta = create_test_meta("reused");
        new_meta.command = "new command".to_string();
        tx.send(PersistCmd::SessionCreated {
            meta: new_meta,
            incarnation: 2,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();
        tx.send(PersistCmd::SessionExited {
            session_id: "reused".to_string(),
            incarnation: 1,
        })
        .unwrap();
        tx.send(PersistCmd::BufferUpdate {
            session_id: "reused".to_string(),
            incarnation: 1,
            data: b"stale output".to_vec(),
            total_written: 12,
        })
        .unwrap();
        tx.send(PersistCmd::BufferUpdate {
            session_id: "reused".to_string(),
            incarnation: 2,
            data: b"current output".to_vec(),
            total_written: 14,
        })
        .unwrap();
        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].incarnation, 2);
        assert_eq!(sessions[0].meta.command, "new command");
        let (data, total_written) = store.load_buffer("reused").unwrap().unwrap();
        assert_eq!(data, b"current output");
        assert_eq!(total_written, 14);
    }

    #[test]
    fn removal_watermark_blocks_late_create_but_allows_newer_recreate() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        tx.send(PersistCmd::SessionRemoved {
            session_id: "ordered".to_string(),
            incarnation: 10,
        })
        .unwrap();
        tx.send(PersistCmd::SessionCreated {
            meta: create_test_meta("ordered"),
            incarnation: 9,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        let mut newer = create_test_meta("ordered");
        newer.command = "newer".to_string();
        tx.send(PersistCmd::SessionCreated {
            meta: newer,
            incarnation: 11,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();
        tx.send(PersistCmd::Shutdown).unwrap();
        drop(tx);

        worker.run();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].incarnation, 11);
        assert_eq!(sessions[0].meta.command, "newer");
    }
}
