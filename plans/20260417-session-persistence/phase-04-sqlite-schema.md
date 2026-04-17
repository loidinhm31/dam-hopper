# Phase 04 — SQLite Schema + Config

## Context
- Parent: [plan.md](./plan.md)
- Dependencies: Phase A complete (phases 1-3)

## Overview
- Date: 2026-04-17
- Description: Add SQLite database schema for session persistence and configuration options.
- Priority: P3 (optional enhancement)
- Implementation status: pending
- Effort: 4h

## Key Insights
- Phase B is optional — only needed if users want sessions to survive server restart.
- `rusqlite` is the standard Rust SQLite crate, sync API works well with worker thread pattern.
- Schema mirrors `SessionMeta` + raw buffer BLOB.
- Database file location follows XDG pattern (`~/.config/dam-hopper/sessions.db`).

## Requirements
- Add `rusqlite` dependency to `Cargo.toml`.
- Create migration script for initial schema.
- Add `[server]` config section with `session_persistence` and `session_db_path` options.
- Initialize database on server startup (if enabled).
- Provide `SessionStore` struct with CRUD operations.

## Architecture

### Database Schema

```sql
-- migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project TEXT,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    session_type TEXT NOT NULL,
    restart_policy TEXT NOT NULL DEFAULT 'never',
    restart_max_retries INTEGER NOT NULL DEFAULT 5,
    env_json TEXT,  -- JSON-encoded HashMap<String, String>
    cols INTEGER NOT NULL DEFAULT 120,
    rows INTEGER NOT NULL DEFAULT 32,
    created_at INTEGER NOT NULL,  -- Unix timestamp ms
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_buffers (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    data BLOB NOT NULL,
    total_written INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
```

### Configuration

```toml
# dam-hopper.toml or global config

[server]
# Enable SQLite session persistence (optional, default: false)
session_persistence = true

# Database file path (default: ~/.config/dam-hopper/sessions.db)
session_db_path = "~/.config/dam-hopper/sessions.db"

# TTL for dead session buffers in hours (default: 24)
session_buffer_ttl_hours = 24
```

### Rust Types

```rust
// server/src/persistence/mod.rs

use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex};

pub struct SessionStore {
    conn: Arc<Mutex<Connection>>,
}

impl SessionStore {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub fn save_session(&self, meta: &SessionMeta, env: &HashMap<String, String>) -> Result<()>;
    pub fn save_buffer(&self, id: &str, data: &[u8], total_written: u64) -> Result<()>;
    pub fn load_sessions(&self) -> Result<Vec<PersistedSession>>;
    pub fn load_buffer(&self, id: &str) -> Result<Option<(Vec<u8>, u64)>>;
    pub fn delete_session(&self, id: &str) -> Result<()>;
    pub fn cleanup_expired(&self, ttl_hours: u64) -> Result<usize>;
}

pub struct PersistedSession {
    pub meta: SessionMeta,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}
```

## Related Code Files
- `server/Cargo.toml` — add `rusqlite` dependency
- `server/src/persistence/mod.rs` — new module (create)
- `server/src/persistence/migrations/001_initial.sql` — schema (create)
- `server/src/config/schema.rs` — add `[server]` section
- `server/src/main.rs` — initialize `SessionStore` if enabled

## Implementation Steps
1. Add `rusqlite = { version = "0.31", features = ["bundled"] }` to Cargo.toml.
2. Create `server/src/persistence/mod.rs` with `SessionStore` struct.
3. Create `server/src/persistence/migrations/001_initial.sql`.
4. Add `ServerConfig` to config schema with persistence options.
5. Parse `[server]` section in config loader.
6. Initialize `SessionStore` in `main.rs` (if enabled).
7. Add unit tests for CRUD operations.

## Todo
- [x] Add rusqlite dependency
- [x] Create persistence module
- [x] Create migration SQL
- [x] Add ServerConfig to schema
- [x] Parse [server] section
- [x] Initialize in main.rs
- [x] Unit tests for SessionStore

## Code Review
- **Status:** Complete (2026-04-17)
- **Score:** 8.5/10
- **Report:** [review-phase-04-20260417.md](./review-phase-04-20260417.md)
- **Critical issues:** 1 (database file permissions)
- **Warnings:** 2 (mutex locking, hardcoded values)
- **Suggestions:** 4 (error handling, cleanup scheduling)

## Test Cases

| Scenario | Expected |
|----------|----------|
| Create session store | migrations run, tables exist |
| Save session | row inserted |
| Save buffer | BLOB stored |
| Load sessions | returns all sessions |
| Delete session | cascades to buffer |
| Cleanup expired | removes old buffers |

## Success Criteria
- `cargo test persistence` passes.
- Database file created on startup (if enabled).
- Schema matches `SessionMeta` fields.

## Risk Assessment
- Low. Schema is additive, rusqlite is well-tested.
- Migration idempotency: `CREATE TABLE IF NOT EXISTS` handles re-runs.

## Security Considerations
- Database file should be 0600 permissions (user-only).
- Buffer data may contain sensitive terminal output — same exposure as memory buffer.

## Next Steps
Phase 5 implements async persist worker.
