# Code Review: Phase 04 — SQLite Schema

**Date:** 2026-04-17  
**Reviewer:** code-reviewer  
**Score:** 8.5/10

---

## Scope

**Files reviewed:**
- `server/Cargo.toml` (+3 lines: rusqlite dependency)
- `server/src/persistence/mod.rs` (+351 lines: new module)
- `server/src/persistence/migrations/001_initial.sql` (+27 lines: schema)
- `server/src/config/schema.rs` (+45 lines: ServerConfig)
- `server/src/config/parser.rs` (+1 line: parse server section)
- `server/src/config/mod.rs` (+1 line: export ServerConfig)
- `server/src/lib.rs` (+1 line: persistence module)
- `server/src/main.rs` (+48 lines: initialization)
- `server/src/api/workspace.rs` (+1 line: ServerConfig::default)
- Test files: `server/src/api/tests.rs`, `server/tests/*.rs` (ServerConfig::default)

**Lines analyzed:** ~480 new/modified lines across 11 files  
**Review focus:** Security, performance, architecture, YAGNI/KISS/DRY

---

## Overall Assessment

Solid implementation. Clean separation concerns. Proper parameterized queries prevent SQL injection. Comprehensive test coverage (6 unit tests, all passing). Minor issues around file permissions, mutex granularity, and hardcoded values.

---

## Critical Issues ❌ **MUST FIX**

### 1. **Missing database file permissions** (Security — Priority 1)

**Issue:** SQLite database file created with OS default permissions (typically 0644), exposing terminal buffers that may contain sensitive data (passwords, API keys, session tokens).

**Location:** `server/src/persistence/mod.rs:29`

```rust
pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
    let conn = Connection::open(path)?;  // ❌ No permission control
    conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
    Ok(Self { conn: Arc::new(Mutex::new(conn)) })
}
```

**Impact:** Sensitive terminal output readable by any user on system. Plan acknowledges buffer may contain sensitive output (phase-04-sqlite-schema.md:168).

**Fix:** Mirror pattern from `write_token()` function (main.rs:279):

```rust
pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
    // Create file with restricted permissions first (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        if !path.exists() {
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .mode(0o600)
                .open(path)
                .map_err(|e| rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(1), 
                    Some(format!("Failed to create DB with permissions: {}", e))
                ))?;
        }
    }
    
    let conn = Connection::open(path)?;
    conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
    Ok(Self { conn: Arc::new(Mutex::new(conn)) })
}
```

**Verification:**
```bash
ls -la ~/.config/dam-hopper/sessions.db  # Should show -rw-------
```

---

## High Priority Warnings ⚠️ **SHOULD FIX**

### 2. **Coarse-grained mutex locking** (Performance)

**Issue:** Holding `Mutex<Connection>` lock for entire query execution blocks all other persistence operations. Critical path includes disk I/O (BLOB writes) and query parsing.

**Location:** `server/src/persistence/mod.rs:46,97,109,173,191,202`

```rust
pub fn save_buffer(&self, id: &str, data: &[u8], total_written: u64) 
    -> Result<(), rusqlite::Error> {
    let conn = self.conn.lock().unwrap();  // ❌ Held during entire INSERT
    conn.execute(
        "INSERT OR REPLACE INTO session_buffers ...",
        params![id, data, total_written as i64, now_ms() as i64],
    )?;
    Ok(())
}
```

**Impact:**
- Large buffer writes (>1MB) block all reads/writes
- Serializes all persistence operations
- Phase 05 worker will serialize persist requests from all sessions

**Fix options:**
1. **Immediate (pragmatic):** Accept serialization for Phase 04. Single-threaded SQLite is simple, safe. Monitor if Phase 05 worker becomes bottleneck.
2. **Phase 05+ optimization:** Connection pool (r2d2) + WAL mode for concurrent readers. Requires benchmark data showing actual contention.

**Recommendation:** Ship as-is for Phase 04. Revisit if Phase 05 persist worker shows >100ms latency in production.

---

### 3. **Hardcoded `restart_max_retries`** (Correctness)

**Issue:** `save_session()` hardcodes `restart_max_retries = 5` instead of reading from `meta.restart_max_retries`. Acknowledged as TODO in code comment.

**Location:** `server/src/persistence/mod.rs:77`

```rust
params![
    // ...
    5, // restart_max_retries (hardcoded for now, Phase 1 doesn't expose this)
    // ...
],
```

**Impact:**
- Persisted value always 5 regardless of actual config
- Phase 06 restore will use incorrect retry count
- Data inconsistency between memory (SessionMeta) and DB

**Fix:** Change signature to accept `restart_max_retries` parameter:

```rust
pub fn save_session(
    &self,
    meta: &SessionMeta,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    restart_max_retries: u32,  // ← Add parameter
) -> Result<(), rusqlite::Error> {
    // ...
    params![
        // ...
        restart_max_retries as i64,  // Use actual value
        // ...
    ],
}
```

Caller in Phase 05/06 passes: `store.save_session(&meta, &env, cols, rows, project_config.restart_max_retries)?;`

---

## Medium Priority Suggestions 💡 **NICE TO HAVE**

### 4. **Panic on mutex poisoning** (Resilience)

**Issue:** `.unwrap()` on mutex lock panics if any thread poisoned the mutex via panic. Entire server crashes instead of degrading gracefully.

**Location:** All 6 methods in `SessionStore`

```rust
let conn = self.conn.lock().unwrap();  // ❌ Panics on poison
```

**Impact:**
- One panic in persistence logic crashes server
- No graceful degradation (e.g., disable persistence, continue serving requests)

**Fix:**
```rust
let conn = self.conn.lock().map_err(|e| {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(1),
        Some(format!("Mutex poisoned: {}", e))
    )
})?;
```

**Trade-off:** Panics are rare in practice. Current code cleaner. Consider if production logs show mutex poisoning.

---

### 5. **Missing cleanup scheduling** (Operational)

**Issue:** `cleanup_expired()` exists but never called. Dead session buffers accumulate indefinitely.

**Location:** `server/src/main.rs:126-173` (persistence initialization)

**Impact:**
- Database grows unbounded
- Disk exhaustion on long-running servers
- Plan specifies 24h TTL (phase-04-sqlite-schema.md:72) but never enforced

**Fix:** Spawn cleanup task in Phase 05 worker (alongside persist loop):

```rust
// In Phase 05 persist worker
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(3600)); // 1h
    loop {
        interval.tick().await;
        if let Err(e) = store.cleanup_expired(config.server.session_buffer_ttl_hours) {
            tracing::warn!(error = %e, "Failed to cleanup expired buffers");
        }
    }
});
```

**Defer to Phase 05?** Yes. Phase 04 doesn't spawn persist worker yet (main.rs:155: `TODO Phase 05`).

---

### 6. **Unsafe `.unwrap()` in JSON serialization** (Error handling)

**Issue:** Serialization failure returns `"{}"` empty object, hiding errors. Caller can't detect failure.

**Location:** `server/src/persistence/mod.rs:48`

```rust
let env_json = serde_json::to_string(env).unwrap_or_else(|_| "{}".to_string());
```

**Impact:**
- Invalid env HashMap (e.g., keys with control chars) silently becomes `{}`
- Phase 06 restore gets empty env, different from original session
- No error logged

**Fix:**
```rust
let env_json = serde_json::to_string(env).map_err(|e| {
    rusqlite::Error::ToSqlConversionFailure(Box::new(e))
})?;
```

**Trade-off:** `serde_json` serialization rarely fails for `HashMap<String, String>`. Current code pragmatic. Fix if logs show serialization errors.

---

### 7. **Index on `session_buffers.updated_at` missing** (Performance)

**Issue:** Schema indexes `sessions.updated_at` but not `session_buffers.updated_at`. `cleanup_expired()` scans all buffers.

**Location:** `server/src/persistence/migrations/001_initial.sql:25`

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
-- Missing: CREATE INDEX IF NOT EXISTS idx_buffers_updated ON session_buffers(updated_at);
```

**Impact:**
- O(n) scan for cleanup
- 10k sessions = 10k buffer scans
- Acceptable for Phase 04 (no cleanup task). Problem in Phase 05+.

**Fix:**
```sql
CREATE INDEX IF NOT EXISTS idx_buffers_updated ON session_buffers(updated_at);
```

Add in **002_add_buffer_index.sql** migration. SQLite supports online index creation.

---

## Positive Observations ✅

1. **SQL injection prevention:** All queries use parameterized statements (`params![...]`). Zero string concatenation.
2. **Comprehensive test coverage:** 6 unit tests cover all CRUD operations, CASCADE delete, expired cleanup, not-found cases.
3. **Proper FK constraint:** `session_buffers` references `sessions(id) ON DELETE CASCADE` prevents orphans.
4. **Idempotent migrations:** `CREATE TABLE IF NOT EXISTS` allows re-run without errors.
5. **Type safety:** Strong types (`SessionType`, `RestartPolicy`) with exhaustive match. No string enum magic.
6. **Clean integration:** ServerConfig properly threaded through config parsing, well-documented defaults.
7. **Graceful degradation:** Persistence errors logged as warnings, server continues without persistence (main.rs:148-160).
8. **Index strategy:** `idx_sessions_project` optimizes project-scoped queries.

---

## Recommended Actions

### Immediate (before merge)
1. ✅ **Fix database file permissions** (Issue #1) → Add 0o600 mode in `SessionStore::open()`
2. ✅ **Fix hardcoded restart_max_retries** (Issue #3) → Add parameter to `save_session()`

### Phase 05
3. 💡 Spawn cleanup task with 1h interval (Issue #5)
4. 💡 Add `idx_buffers_updated` index in 002 migration (Issue #7)

### Monitor in production
5. 📊 Measure persist worker latency. If >100ms, revisit mutex granularity (Issue #2)
6. 📊 Check logs for JSON serialization errors. If any, make fatal (Issue #6)

### Optional
7. 🔧 Replace `.unwrap()` on mutex with error propagation (Issue #4) — only if production logs show poisoning

---

## Test Results

```bash
$ cargo test persistence --lib
running 6 tests
test persistence::tests::load_buffer_returns_none_when_not_found ... ok
test persistence::tests::create_session_store ... ok
test persistence::tests::save_and_load_session ... ok
test persistence::tests::save_and_load_buffer ... ok
test persistence::tests::delete_session_cascades_to_buffer ... ok
test persistence::tests::cleanup_expired_buffers ... ok

test result: ok. 6 passed; 0 failed; 0 ignored
```

**Clippy:** Zero warnings in persistence module. 14 unrelated warnings in other modules.

---

## Task Completeness ✅

Plan TODO list (phase-04-sqlite-schema.md:127-133):

- [x] Add rusqlite dependency → `Cargo.toml:72`
- [x] Create persistence module → `src/persistence/mod.rs`
- [x] Create migration SQL → `migrations/001_initial.sql`
- [x] Add ServerConfig to schema → `config/schema.rs:251`
- [x] Parse [server] section → `config/parser.rs:48`
- [x] Initialize in main.rs → `main.rs:126`
- [x] Unit tests for SessionStore → 6 tests passing

All plan requirements met. Phase 04 complete pending fixes for Issues #1 and #3.

---

## Security Review Summary

| Concern | Status | Notes |
|---------|--------|-------|
| SQL injection | ✅ Pass | Parameterized queries throughout |
| File permissions | ❌ Fail | Database readable by all users → **Fix required** |
| Auth bypass | ✅ N/A | No authentication logic in persistence layer |
| Sensitive data exposure | ⚠️ Warning | Buffer data may contain passwords (acknowledged) |
| Path traversal | ✅ Pass | Uses Path::parent(), no string manipulation |

---

## Performance Metrics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| save_session | O(1) | Single INSERT, indexed PK |
| save_buffer | O(n) | BLOB size linear |
| load_sessions | O(n) | Full table scan, but single-user typically <100 sessions |
| load_buffer | O(1) | PK lookup |
| delete_session | O(1) | PK delete + CASCADE |
| cleanup_expired | O(n) | **Missing index** → Phase 05 concern |

---

## Next Steps

Phase 05 will:
- Store `SessionStore` in `AppState`
- Spawn persist worker with cleanup task
- Integrate with restart engine
- Add buffer offset tracking

**Blockers:** None. Phase 04 ready for merge after applying fixes #1 and #3.

---

## References

- Plan: [phase-04-sqlite-schema.md](./phase-04-sqlite-schema.md)
- Schema: [001_initial.sql](../../server/src/persistence/migrations/001_initial.sql)
- Tests: [mod.rs#L223-L351](../../server/src/persistence/mod.rs)
- rusqlite docs: [0.31 API](https://docs.rs/rusqlite/0.31/)
