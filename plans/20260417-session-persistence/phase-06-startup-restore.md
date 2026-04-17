# Phase 06 — Startup Restore

## Context
- Parent: [plan.md](./plan.md)
- Dependencies: Phase 5 (persist worker)

## Overview
- Date: 2026-04-17
- Description: On server startup, restore sessions from SQLite and respawn PTY processes for restartable sessions.
- Priority: P3 (optional enhancement)
- Implementation status: pending
- Effort: 4h

## Key Insights
- Only sessions with `restart_policy != "never"` should auto-spawn on startup.
- Buffer is loaded lazily on `terminal:attach` (not eagerly on startup).
- Dead sessions (exit before restart) should NOT auto-spawn — preserved for manual inspection.
- Startup restore should be fast (<1s) — don't block server ready state.

## Requirements
- On startup (if persistence enabled): load session records from SQLite.
- For each session with `restart_policy != "never"` AND `alive == true` at persist time:
  - Respawn PTY process with saved command/cwd/env.
  - Register in `PtySessionManager`.
- Broadcast `terminal:changed` after restore complete.
- Handle missing/corrupt database gracefully (log warning, continue without restore).

## Architecture

### Startup Flow

```
main.rs startup
       │
       ▼
┌──────────────────────────────┐
│  Check session_persistence   │
│  config flag                 │
└──────────────┬───────────────┘
               │ enabled
               ▼
┌──────────────────────────────┐
│  Open SQLite database        │
│  (run migrations if needed)  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Load session records        │
│  from sessions table         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  For each restartable:       │
│  - restart_policy != never   │
│  - last known alive          │
│  → spawn PTY process         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Broadcast terminal:changed  │
│  Server ready                │
└──────────────────────────────┘
```

### Restore Logic

```rust
// server/src/persistence/restore.rs

pub async fn restore_sessions(
    store: &SessionStore,
    pty_manager: &PtySessionManager,
    config: &WorkspaceConfig,
) -> Result<usize, AppError> {
    let persisted = store.load_sessions()?;
    let mut restored = 0;
    
    for session in persisted {
        // Skip non-restartable sessions
        if session.meta.restart_policy == RestartPolicy::Never {
            debug!(id = %session.meta.id, "Skipping never-restart session");
            continue;
        }
        
        // Skip sessions that were dead at persist time
        if !session.meta.alive {
            debug!(id = %session.meta.id, "Skipping dead session");
            continue;
        }
        
        // Verify project still exists in config
        let project_exists = config.projects.iter()
            .any(|p| Some(&p.name) == session.meta.project.as_ref());
        
        if session.meta.project.is_some() && !project_exists {
            warn!(id = %session.meta.id, project = ?session.meta.project, 
                  "Skipping session for removed project");
            continue;
        }
        
        // Spawn PTY
        let opts = PtyCreateOpts {
            id: session.meta.id.clone(),
            command: session.meta.command.clone(),
            cwd: session.meta.cwd.clone(),
            env: session.env,
            cols: session.cols,
            rows: session.rows,
            project: session.meta.project.clone(),
            restart_policy: session.meta.restart_policy,
            restart_max_retries: 5, // TODO: persist this too
        };
        
        match pty_manager.create(opts) {
            Ok(_) => {
                info!(id = %session.meta.id, "Restored session from persistence");
                restored += 1;
            }
            Err(e) => {
                warn!(id = %session.meta.id, error = %e, "Failed to restore session");
            }
        }
    }
    
    // Cleanup expired buffers
    let expired = store.cleanup_expired(config.server.session_buffer_ttl_hours)?;
    if expired > 0 {
        info!(count = expired, "Cleaned up expired session buffers");
    }
    
    Ok(restored)
}
```

### Buffer Lazy Load

```rust
// Extend get_buffer_with_offset to check persistence

impl PtySessionManager {
    pub fn get_buffer_with_offset(
        &self, 
        id: &str, 
        from_offset: Option<u64>
    ) -> Result<(String, u64), AppError> {
        let inner = self.inner.lock().unwrap();
        
        // Try in-memory first
        if let Some(session) = inner.live.get(id) {
            let buf = session.buffer.lock().unwrap();
            let (data, offset) = buf.read_from(from_offset);
            return Ok((String::from_utf8_lossy(data).into_owned(), offset));
        }
        
        // Fallback to persistence (for dead sessions)
        if let Some(store) = &self.session_store {
            if let Some((data, total_written)) = store.load_buffer(id)? {
                return Ok((String::from_utf8_lossy(&data).into_owned(), total_written));
            }
        }
        
        Err(AppError::SessionNotFound(id.to_string()))
    }
}
```

### Main.rs Integration

```rust
// main.rs

async fn main() -> Result<()> {
    // ... existing setup ...
    
    // Initialize persistence (if enabled)
    let (session_store, persist_tx) = if config.server.session_persistence {
        let db_path = expand_path(&config.server.session_db_path)?;
        let store = SessionStore::open(&db_path)?;
        
        // Spawn persist worker
        let (tx, rx) = mpsc::channel(256);
        let worker = PersistWorker::new(rx, store.clone());
        std::thread::Builder::new()
            .name("persist-worker".into())
            .spawn(move || worker.run())?;
        
        (Some(store), Some(tx))
    } else {
        (None, None)
    };
    
    let pty_manager = PtySessionManager::new(
        event_sink.clone(),
        persist_tx,
        session_store.clone(),
    );
    
    // Restore sessions (if persistence enabled)
    if let Some(store) = &session_store {
        match restore_sessions(store, &pty_manager, &config).await {
            Ok(count) => info!(count, "Restored sessions from persistence"),
            Err(e) => warn!(error = %e, "Failed to restore sessions"),
        }
    }
    
    // ... rest of startup ...
}
```

## Related Code Files
- `server/src/persistence/restore.rs` — new file (create)
- `server/src/persistence/mod.rs` — export restore
- `server/src/pty/manager.rs` — add session_store, lazy buffer load
- `server/src/main.rs` — call restore on startup

## Implementation Steps
1. Create `restore_sessions()` function in `persistence/restore.rs`.
2. Add `session_store` field to `PtySessionManager`.
3. Extend `get_buffer_with_offset()` to fallback to persistence.
4. Integrate restore into `main.rs` startup sequence.
5. Add startup logging for restore count.
6. Manual test: start server, create session, restart server, verify restore.

## Todo
- [ ] restore_sessions() function
- [ ] Manager session_store field
- [ ] Lazy buffer load fallback
- [ ] Main.rs integration
- [ ] Startup logging
- [ ] Manual smoke test

## Test Cases

| Scenario | Expected |
|----------|----------|
| Fresh start (no DB) | No restore, no error |
| Restore restartable sessions | PTY processes spawned |
| Skip never-restart sessions | Not spawned |
| Skip dead sessions | Not spawned |
| Corrupt DB | Warning logged, continue |
| Project removed from config | Session skipped with warning |

## Success Criteria
- Server restart preserves session list.
- Restartable sessions auto-spawn on startup.
- Buffer available via `terminal:attach` after restart.
- Startup time <1s with 10 sessions.

## Risk Assessment
- Medium. Startup must be robust to DB corruption/missing.
- Mitigation: Catch all errors, log warnings, continue without restore.
- Race: Session spawn during restore — unlikely, but handle gracefully.

## Security Considerations
- Restored sessions run with original command/env — same trust model as user-initiated sessions.
- If workspace config changes (project removed), skip that session.

## Next Steps
Phase B complete. F-08 fully implemented.
