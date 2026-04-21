use crate::persistence::SessionStore;
use crate::pty::SessionMeta;
use std::collections::HashMap;
use std::sync::{mpsc::{Receiver, RecvTimeoutError}, Arc};
use std::time::{Duration, Instant};
use tracing::{debug, warn};

/// Commands sent to the persist worker thread.
#[derive(Debug)]
pub enum PersistCmd {
    /// Buffer update — worker batches per session, writes latest
    BufferUpdate {
        session_id: String,
        data: Vec<u8>,
        total_written: u64,
    },
    /// Session created — insert metadata row
    SessionCreated {
        meta: SessionMeta,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
        restart_max_retries: u32,
    },
    /// Session exited — flush buffer immediately
    SessionExited { session_id: String },
    /// Session removed — delete from DB
    SessionRemoved { session_id: String },
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
    pending: HashMap<String, PendingBuffer>,
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
                data,
                total_written,
            } => {
                // Batch: only keep latest update per session
                self.pending.insert(
                    session_id,
                    PendingBuffer {
                        data,
                        total_written,
                    },
                );
                true
            }
            PersistCmd::SessionCreated {
                meta,
                env,
                cols,
                rows,
                restart_max_retries,
            } => {
                if let Err(e) = self.store.save_session(&meta, &env, cols, rows, restart_max_retries) {
                    warn!(session_id = %meta.id, error = %e, "Failed to persist session");
                }
                true
            }
            PersistCmd::SessionExited { session_id } => {
                // Flush buffer immediately, then mark dead so restore skips it.
                // Row and buffer are kept so attach can still replay the final output.
                self.flush_session(&session_id);
                if let Err(e) = self.store.mark_session_dead(&session_id) {
                    warn!(session_id, error = %e, "Failed to mark session dead");
                }
                true
            }
            PersistCmd::SessionRemoved { session_id } => {
                // Remove from pending queue and delete from DB
                self.pending.remove(&session_id);
                if let Err(e) = self.store.delete_session(&session_id) {
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
        for (session_id, buf) in items {
            self.write_buffer(&session_id, &buf);
        }
        self.last_flush = Instant::now();
    }

    /// Flushes a specific session's buffer to SQLite and removes it from pending.
    fn flush_session(&mut self, session_id: &str) {
        if let Some(buf) = self.pending.remove(session_id) {
            debug!(session_id, "Flushing session buffer on exit");
            self.write_buffer(session_id, &buf);
        }
    }

    /// Writes buffer data to SQLite.
    fn write_buffer(&self, session_id: &str, buf: &PendingBuffer) {
        debug!(session_id, bytes = buf.data.len(), total_written = buf.total_written, "Writing buffer to SQLite");
        if let Err(e) = self.store.save_buffer(session_id, &buf.data, buf.total_written) {
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
            project: None,
            command: "test".to_string(),
            cwd: "/tmp".to_string(),
            session_type: SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: 1234567890,
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
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
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        // Send multiple buffer updates for same session
        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
            data: b"first".to_vec(),
            total_written: 5,
        })
        .unwrap();

        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
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
    fn test_session_exit_immediate_flush() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let meta = create_test_meta("s1");
        let env = HashMap::new();

        // Create session first
        tx.send(PersistCmd::SessionCreated {
            meta,
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
            data: b"data".to_vec(),
            total_written: 4,
        })
        .unwrap();

        tx.send(PersistCmd::SessionExited {
            session_id: "s1".to_string(),
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
    fn test_session_removed_deletes_from_db() {
        let (store, _tmp) = create_test_store();
        let (tx, rx) = mpsc::channel();
        let worker = PersistWorker::new(rx, store.clone());

        let meta = create_test_meta("s1");
        let env = HashMap::new();

        // Create session
        tx.send(PersistCmd::SessionCreated {
            meta: meta.clone(),
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        // Then remove it
        tx.send(PersistCmd::SessionRemoved {
            session_id: "s1".to_string(),
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
            env: env.clone(),
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        tx.send(PersistCmd::SessionCreated {
            meta: meta2,
            env,
            cols: 80,
            rows: 24,
            restart_max_retries: 5,
        })
        .unwrap();

        // Add buffer updates without explicit flush
        tx.send(PersistCmd::BufferUpdate {
            session_id: "s1".to_string(),
            data: b"data1".to_vec(),
            total_written: 5,
        })
        .unwrap();

        tx.send(PersistCmd::BufferUpdate {
            session_id: "s2".to_string(),
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
}
