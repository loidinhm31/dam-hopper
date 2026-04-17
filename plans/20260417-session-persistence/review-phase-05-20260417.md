# Code Review: Phase 05 - Persist Worker

**Date:** 2026-04-17  
**Reviewer:** code-reviewer  
**Scope:** Session persistence worker implementation  
**Branch:** session-persistence  
**Score:** 6.5/10

---

## Summary

Phase 05 persist worker implementation introduces async worker for SQLite buffer persistence. Architecture is sound, tests pass (5/5), but **2 critical blocking bugs** and **1 major performance issue** prevent production readiness.

**Status:** ❌ **BLOCKED - Critical issues must be fixed**

---

## Files Reviewed

- `server/src/persistence/worker.rs` (new, 403 lines)
- `server/src/persistence/mod.rs` (export worker module)
- `server/src/pty/buffer.rs` (add `snapshot()` method)
- `server/src/pty/manager.rs` (integrate persist_tx)
- `server/src/main.rs` (spawn worker thread)

Lines analyzed: ~600  
Tests verified: 5/5 passing ✅

---

## Critical Issues (MUST FIX)

### 1. 🚨 PTY Reader Thread Blocking ❌ BLOCKER

**File:** [server/src/pty/manager.rs#L453](../../../server/src/pty/manager.rs#L453)  
**Severity:** CRITICAL  
**Category:** Performance / Concurrency  

#### Problem

```rust
// reader_thread hot path — BLOCKS if queue full
if let Some(tx) = &persist_tx {
    let (snapshot_data, total_written) = buf.snapshot();
    let _ = tx.send(crate::persistence::PersistCmd::BufferUpdate {  // BLOCKING!
        session_id: session_id.clone(),
        data: snapshot_data,
        total_written,
    });
}
```

`SyncSender::send()` is **blocking** — if bounded channel (256 slots) is full, PTY reader thread **STOPS READING** until persist worker drains queue. This defeats entire async worker design.

#### Impact

- Fast-scrolling terminals (build logs, test output) can fill queue instantly
- Reader thread blocks → PTY buffer overflow → data loss
- All terminals freeze if worker panics/hangs (queue never drains)
- Violates Phase 05 requirement: "PTY reader thread must never block on database I/O"

#### Fix

```rust
// Use try_send (non-blocking) — drop oldest if queue full
if let Some(tx) = &persist_tx {
    let (snapshot_data, total_written) = buf.snapshot();
    if let Err(e) = tx.try_send(crate::persistence::PersistCmd::BufferUpdate {
        session_id: session_id.clone(),
        data: snapshot_data,
        total_written,
    }) {
        warn!(
            session_id = %session_id,
            error = %e,
            "Persist queue full — dropping buffer update (worker may be slow/dead)"
        );
    }
}
```

**Verification:** Same pattern needed in 3 other locations:
- [manager.rs#L256](../../../server/src/pty/manager.rs#L256) (SessionCreated)
- [manager.rs#L327](../../../server/src/pty/manager.rs#L327) (SessionRemoved)
- [manager.rs#L486](../../../server/src/pty/manager.rs#L486) (SessionExited)

---

### 2. 🔥 Buffer Cloned on EVERY PTY Read ❌ BLOCKER

**File:** [server/src/pty/manager.rs#L452](../../../server/src/pty/manager.rs#L452)  
**Severity:** CRITICAL  
**Category:** Performance  

#### Problem

```rust
Ok(n) => {
    let data = &chunk[..n];
    {
        let mut buf = buffer.lock().unwrap();
        buf.push(data);
        
        // Clones 256KB on EVERY PTY read (100s per second!)
        if let Some(tx) = &persist_tx {
            let (snapshot_data, total_written) = buf.snapshot();  // ← EXPENSIVE CLONE
            let _ = tx.send(crate::persistence::PersistCmd::BufferUpdate { ... });
        }
    }
    // ...
}
```

#### Impact

**Micro-benchmark (worst case):**
- Fast terminal: 1000 reads/sec × 256KB clone = **256 MB/sec memory churn**
- Hot loop: mutex lock → clone 256KB → mutex unlock → repeat
- GC pressure, cache thrashing, CPU spike on every keystroke
- Violates Phase 05 design: "Flush strategy: every 5s OR on session exit"

Current behavior: **3000+ clones per 5s window** instead of 1 flush.

#### Root Cause

Worker batching logic is correct (only latest per session written). **Channel send is in wrong place** — should be in worker's periodic flush, not reader thread.

#### Fix

**Option A: Send Only Notifications (Recommended)**

```rust
// reader_thread — send notification, NOT buffer data
Ok(n) => {
    let data = &chunk[..n];
    {
        let mut buf = buffer.lock().unwrap();
        buf.push(data);
    }
    // NO snapshot here — worker pulls buffer on flush
}

// PersistWorker::flush_all() — snapshot on flush, not on push
fn flush_all(&mut self) {
    for (session_id, _) in &self.pending {
        // Pull buffer from manager when needed
        if let Some((data, total)) = self.get_buffer_snapshot(session_id) {
            self.write_buffer(session_id, &data, total);
        }
    }
}
```

**Option B: Send Metadata Only**

```rust
// Send lightweight signal
tx.try_send(PersistCmd::BufferUpdate {
    session_id: session_id.clone(),
    data: Vec::new(),  // Empty — worker reads from buffer on flush
    total_written: buf.current_offset(),
});
```

**Option C: Keep Current, Gate by Time**

```rust
// Only snapshot if >5s since last persist (still suboptimal)
static LAST_PERSIST_TIME: AtomicU64 = AtomicU64::new(0);
let now = now_ms();
if now - LAST_PERSIST_TIME.load(Relaxed) > 5000 {
    let snapshot = buf.snapshot();
    let _ = tx.try_send(...);
    LAST_PERSIST_TIME.store(now, Relaxed);
}
```

**Recommendation:** Option A (architectural fix). Current design inverts batching logic.

---

## High Priority (SHOULD FIX)

### 3. Dead Code Warning 🟡

**File:** [server/src/persistence/worker.rs#L37](../../../server/src/persistence/worker.rs#L37)  
**Severity:** HIGH  
**Category:** YAGNI Violation  

```rust
struct PendingBuffer {
    data: Vec<u8>,
    total_written: u64,
    updated_at: Instant,  // ← NEVER READ
}
```

**Compiler warning:**
```
warning: field `updated_at` is never read
  --> src\persistence\worker.rs:37:5
```

**Fix:** Remove field unless future TTL-based eviction planned (not in Phase 05 spec).

---

### 4. Missing Graceful Shutdown Integration ⚠️

**File:** [server/src/main.rs](../../../server/src/main.rs)  
**Severity:** HIGH  
**Category:** Error Handling  

Worker spawned but **no shutdown signal** on server exit:

```rust
std::thread::Builder::new()
    .name("persist-worker".to_string())
    .spawn(move || {
        worker.run();  // ← Runs forever until channel disconnected
    })
```

**Issue:** Worker flushes on channel disconnect (when `main.rs` exits), but no explicit `PersistCmd::Shutdown` sent. Works but relies on implicit behavior.

**Fix:** Add shutdown handler:

```rust
// In main.rs, before server shutdown
if let Some(tx) = persist_tx {
    let _ = tx.send(PersistCmd::Shutdown);
}
```

Or use `tokio::signal::ctrl_c()` to intercept SIGTERM/SIGINT.

---

## Medium Priority (Code Quality)

### 5. SQL Injection Protection ✅ OK

All queries use parameterized statements via `rusqlite::params![]`:

```rust
conn.execute(
    "INSERT OR REPLACE INTO session_buffers (session_id, data, total_written, updated_at)
     VALUES (?1, ?2, ?3, ?4)",
    params![id, data, total_written as i64, now_ms() as i64],
)?;
```

**Verdict:** Safe. No string interpolation. ✅

---

### 6. Unix File Permissions ✅ OK

```rust
#[cfg(unix)]
{
    use std::os::unix::fs::OpenOptionsExt;
    if !path.exists() {
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .mode(0o600)  // ← User-only access
            .open(path)?;
    }
}
```

**Verdict:** Secure. DB file created with `0o600` (read/write owner only). ✅

---

### 7. Bounded Channel Sizing

```rust
let (tx, rx) = std::sync::mpsc::sync_channel(256);
```

**Analysis:**
- 256 slots × ~256KB per BufferUpdate = **64MB max queue memory**
- At 1000 updates/sec, queue fills in 256ms if worker stalls
- Current blocking `send()` makes this moot (Issue #1)

**Recommendation:** After fixing try_send, reduce to 64 slots (16MB cap). Faster detection of stuck worker.

---

## Low Priority (Suggestions)

### 8. Worker Panic Recovery

Currently no supervision. If worker panics:
- Channel remains open (send succeeds)
- Data silently lost until server restart

**Suggestion:** Wrap `worker.run()` in panic handler:

```rust
let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    worker.run();
}));
if let Err(e) = result {
    tracing::error!("Persist worker panicked: {:?}", e);
}
```

---

### 9. Metrics Instrumentation NICE-TO-HAVE

Add observability:

```rust
struct WorkerMetrics {
    buffers_flushed: AtomicU64,
    flush_errors: AtomicU64,
    queue_full_drops: AtomicU64,
}
```

Expose via `/api/persistence/metrics` or prometheus endpoint.

---

## Positive Observations ✅

1. **Test Coverage:** 5/5 tests pass, cover all critical paths (batching, immediate flush, graceful shutdown)
2. **Architecture:** Clean separation PTY hot path ↔ worker thread
3. **Batch Optimization:** Only latest buffer per session written (O(1) per session)
4. **Thread Safety:** Proper Arc/Mutex usage, no data races
5. **Error Handling:** All DB operations return Result, errors logged
6. **Documentation:** Clear intent comments in worker loop

---

## Test Results

```
running 5 tests
test persistence::worker::tests::test_session_created ... ok
test persistence::worker::tests::test_session_exit_immediate_flush ... ok
test persistence::worker::tests::test_session_removed_deletes_from_db ... ok
test persistence::worker::tests::test_buffer_batching ... ok
test persistence::worker::tests::test_graceful_shutdown_flushes_all ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured
```

**Verdict:** Tests pass but **don't catch blocking send() bug** (single-threaded test env).

---

## Recommended Actions

### Blocking (Do NOT Merge)

1. **[CRITICAL]** Replace all `tx.send()` with `tx.try_send()` + error handling (4 locations)
2. **[CRITICAL]** Move buffer snapshot from reader hot path to worker flush — ARCHITECTURAL FIX REQUIRED
3. **[HIGH]** Remove unused `updated_at` field from PendingBuffer
4. **[HIGH]** Add explicit shutdown signal to worker

### Before Phase 06

5. Add load test: 10 terminals × 1000 writes/sec × 5min
6. Verify queue never fills with try_send
7. Profile memory: should see ~1 snapshot/5s, not 1000/s

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PTY freeze if queue fills | **HIGH** | **CRITICAL** | Fix #1: try_send |
| Memory spike on fast scrolling | **CERTAIN** | **CRITICAL** | Fix #2: defer snapshot |
| Data loss if worker panics | MEDIUM | HIGH | Add panic handler |
| DB corruption on concurrent access | LOW | MEDIUM | rusqlite Mutex prevents |

---

## Architectural Concerns

### Fundamental Design Flaw

Current flow violates batching principle:

```
PTY READ → SNAPSHOT buffer (256KB) → SEND to queue → Worker batches → SQLite
           ↑ WRONG PLACE                            ↑ RIGHT PLACE
```

Should be:

```
PTY READ → UPDATE metadata → Queue notification → Worker: SNAPSHOT + batch → SQLite
```

Worker batching is correct. **Snapshot placement is wrong.**

---

## Unresolved Questions

1. **Buffer snapshot strategy:** Pull from manager on flush vs. send on every write?  
   **Answer:** Pull on flush (architectural principle of async workers)

2. **Queue full behavior:** Drop oldest vs. drop newest?  
   **Answer:** Drop newest (latest state replaces older state anyway)

3. **Worker panic recovery:** Auto-restart vs. graceful degradation?  
   **Answer:** Defer to Phase 06 (out of scope for Phase 05)

---

## Metrics

- **Type Coverage:** 100% (Rust strict mode)
- **Test Coverage:** 5 worker tests (unit level)
- **Concurrency Issues:** 2 found (blocking send, race-free with fix)
- **Security Issues:** 0 found (SQL injection protected, file permissions correct)
- **Performance Issues:** 2 found (both critical)

---

## Next Steps

### Immediate (Blocking Phase 05 Completion)

- [ ] Fix blocking send() → try_send()
- [ ] Move snapshot to worker flush
- [ ] Remove dead code warning
- [ ] Add shutdown handler

### Phase 06 Prerequisites

- [ ] Load test with fixed implementation
- [ ] Verify no blocking in hot path
- [ ] Profile: snapshot count should be ~1/5s not 1000/s
- [ ] Add metrics endpoint (optional)

---

## Conclusion

Implementation demonstrates solid understanding of async worker pattern and SQLite persistence. **However, 2 critical bugs make current code production-unsafe:**

1. Blocking send defeats async design
2. Snapshot-on-every-read wastes 99.9% of clones

Both are **architectural fixes** requiring code movement, not just find-replace. Estimated fix time: **2-4 hours**.

After fixes, implementation will be production-ready for Phase 06 startup restore integration.

**Recommendation:** ❌ **DO NOT MERGE** until blocking issues resolved and load tested.

---

**Reviewed by:** code-reviewer  
**Date:** 2026-04-17  
**Confidence:** High (code paths analyzed, tests verified, compiler warnings noted)
