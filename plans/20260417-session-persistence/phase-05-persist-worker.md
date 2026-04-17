# Phase 05 — Persist Worker

## Context
- Parent: [plan.md](./plan.md)
- Dependencies: Phase 4 (SQLite schema)

## Overview
- Date: 2026-04-17
- Description: Async worker thread that batches buffer writes to SQLite without blocking PTY hot path.
- Priority: P3 (optional enhancement)
- Implementation status: pending
- Effort: 6h

## Key Insights
- PTY reader thread must never block on database I/O.
- Chatminal pattern: dedicated worker consumes batched updates from mpsc channel.
- Flush strategy: every 5s OR on session exit OR on graceful shutdown.
- Bounded channel prevents memory explosion if worker is slow.

## Requirements
- Spawn dedicated thread for persist operations (NOT tokio task — sync rusqlite API).
- Use mpsc channel for buffer update commands.
- Batch writes: collect multiple updates per session, write latest only.
- Flush on: timer (5s), session exit event, server shutdown signal.
- Handle channel full gracefully (drop oldest update, log warning).

## Architecture

### Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  PTY Reader     │────▶│  mpsc channel   │────▶│  Persist Worker │
│  Thread         │     │  (bounded 256)  │     │  Thread         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │ push to buffer                                │ batch write
        ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│ ScrollbackBuffer│                           │   SQLite DB     │
│ (in-memory)     │                           │   sessions.db   │
└─────────────────┘                           └─────────────────┘
```

### Channel Commands

```rust
// server/src/persistence/worker.rs

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
    },
    /// Session exited — flush buffer immediately
    SessionExited {
        session_id: String,
    },
    /// Session removed — delete from DB
    SessionRemoved {
        session_id: String,
    },
    /// Graceful shutdown — flush all and exit
    Shutdown,
}
```

### Worker Implementation

```rust
pub struct PersistWorker {
    rx: mpsc::Receiver<PersistCmd>,
    store: SessionStore,
    pending: HashMap<String, PendingBuffer>,
    last_flush: Instant,
}

struct PendingBuffer {
    data: Vec<u8>,
    total_written: u64,
    updated_at: Instant,
}

impl PersistWorker {
    pub fn run(mut self) {
        loop {
            // Non-blocking recv with 1s timeout
            match self.rx.recv_timeout(Duration::from_secs(1)) {
                Ok(cmd) => self.handle_cmd(cmd),
                Err(RecvTimeoutError::Timeout) => {},
                Err(RecvTimeoutError::Disconnected) => break,
            }
            
            // Periodic flush
            if self.last_flush.elapsed() > Duration::from_secs(5) {
                self.flush_all();
            }
        }
        
        // Final flush on shutdown
        self.flush_all();
    }
    
    fn handle_cmd(&mut self, cmd: PersistCmd) {
        match cmd {
            PersistCmd::BufferUpdate { session_id, data, total_written } => {
                self.pending.insert(session_id, PendingBuffer {
                    data,
                    total_written,
                    updated_at: Instant::now(),
                });
            }
            PersistCmd::SessionCreated { meta, env, cols, rows } => {
                if let Err(e) = self.store.save_session(&meta, &env, cols, rows) {
                    warn!(error = %e, "Failed to persist session");
                }
            }
            PersistCmd::SessionExited { session_id } => {
                self.flush_session(&session_id);
            }
            PersistCmd::SessionRemoved { session_id } => {
                self.pending.remove(&session_id);
                if let Err(e) = self.store.delete_session(&session_id) {
                    warn!(error = %e, "Failed to delete persisted session");
                }
            }
            PersistCmd::Shutdown => {
                self.flush_all();
                return; // Exit worker loop
            }
        }
    }
    
    fn flush_all(&mut self) {
        for (session_id, buf) in self.pending.drain() {
            self.write_buffer(&session_id, &buf);
        }
        self.last_flush = Instant::now();
    }
    
    fn flush_session(&mut self, session_id: &str) {
        if let Some(buf) = self.pending.remove(session_id) {
            self.write_buffer(session_id, &buf);
        }
    }
    
    fn write_buffer(&self, session_id: &str, buf: &PendingBuffer) {
        if let Err(e) = self.store.save_buffer(session_id, &buf.data, buf.total_written) {
            warn!(session_id, error = %e, "Failed to persist buffer");
        }
    }
}
```

### Integration Points

```rust
// PtySessionManager — send updates

impl PtySessionManager {
    pub fn create(&self, opts: PtyCreateOpts) -> Result<SessionMeta, AppError> {
        // ... existing spawn logic ...
        
        // Send to persist worker (if enabled)
        if let Some(tx) = &self.persist_tx {
            let _ = tx.try_send(PersistCmd::SessionCreated {
                meta: meta.clone(),
                env: opts.env.clone(),
                cols: opts.cols,
                rows: opts.rows,
            });
        }
        
        Ok(meta)
    }
}

// Reader thread — send buffer updates

fn reader_thread(..., persist_tx: Option<mpsc::Sender<PersistCmd>>) {
    // ... existing read loop ...
    
    // After pushing to in-memory buffer
    if let Some(tx) = &persist_tx {
        // Clone buffer snapshot for persist
        let snapshot = buffer.lock().unwrap().snapshot();
        let _ = tx.try_send(PersistCmd::BufferUpdate {
            session_id: session_id.clone(),
            data: snapshot.0,
            total_written: snapshot.1,
        });
    }
}
```

## Related Code Files
- `server/src/persistence/worker.rs` — new file (create)
- `server/src/persistence/mod.rs` — export worker
- `server/src/pty/manager.rs` — add persist_tx, send commands
- `server/src/main.rs` — spawn worker thread

## Implementation Steps
1. Create `PersistCmd` enum in `persistence/worker.rs`.
2. Implement `PersistWorker` struct with batch logic.
3. Add `snapshot()` method to `ScrollbackBuffer`.
4. Add `persist_tx: Option<mpsc::Sender<PersistCmd>>` to `PtySessionManager`.
5. Send `SessionCreated` on create, `BufferUpdate` on push, `SessionExited` on exit.
6. Spawn worker thread in `main.rs` (if persistence enabled).
7. Handle `Shutdown` on graceful server stop.

## Todo
- [ ] PersistCmd enum
- [ ] PersistWorker struct
- [ ] Buffer snapshot method
- [ ] Manager integration (persist_tx)
- [ ] Create/exit/remove commands
- [ ] Buffer update commands
- [ ] Worker thread spawn
- [ ] Graceful shutdown

## Test Cases

| Scenario | Expected |
|----------|----------|
| Buffer update batching | Only latest per session written |
| 5s timer flush | Pending buffers flushed |
| Session exit | Immediate flush |
| Channel full | Oldest dropped, warning logged |
| Graceful shutdown | All pending flushed |

## Success Criteria
- PTY reader thread never blocks on DB.
- Buffer persisted within 5s of update.
- No data loss on graceful shutdown.

## Risk Assessment
- Medium. Channel full scenario must be handled gracefully.
- Mitigation: Bounded channel with try_send, drop oldest on full.
- Worker panic: Log error, but don't crash server.

## Performance Considerations
- Buffer clone overhead: ~256KB per update — acceptable at 5s intervals.
- SQLite write latency: BLOB writes are fast, ~1-5ms for 256KB.
- Batch deduplication: Only latest per session → O(1) writes per session.

## Next Steps
Phase 6 implements startup restore (load sessions from DB).
