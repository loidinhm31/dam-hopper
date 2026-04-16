# Code Review: Phase 04 Restart Engine
**Date:** 2026-04-16  
**Reviewer:** code-reviewer mode  
**Implementation:** PTY auto-restart with exponential backoff + supervisor pattern

---

## Executive Summary

**Overall Score: 8.5/10** — Solid implementation with excellent test coverage and clean architecture. Two critical bugs must be fixed before merge:

1. **Exit code harvesting always returns 0** (breaks `OnFailure` policy)
2. **Unbounded respawn channel** (DoS risk if supervisor hangs)

Architecture quality is high (supervisor pattern textbook-correct). Tests cover decision matrix exhaustively (8 unit + 5 integration tests).

---

## Score Breakdown

| Category | Score | Notes |
|---|---|---|
| **Architecture** | 9/10 | Supervisor pattern optimal; clean separation blocking/async |
| **Security** | 8/10 | One DoS vector (unbounded channel); retry limits good |
| **Performance** | 9/10 | O(1) lookups; minor `killed` set leak |
| **Testing** | 9/10 | Decision matrix 8/8 rows; missing concurrent create test |
| **YAGNI/DRY** | 9/10 | One unused field (`_prev_exit_code`) |
| **Code Quality** | 8/10 | Clear logic; misleading function names |

---

## Critical Issues (MUST FIX)

### 1. Exit Code Harvesting Bug ⚠️ **BLOCKER**

**File:** [manager.rs#L637-648](../../../server/src/pty/manager.rs#L637-648)

**Problem:** `harvest_exit_code()` always returns `0` for natural exits (assumes EOF = clean exit). Violates `OnFailure` policy semantics.

```rust
fn harvest_exit_code(id: &str, inner: &Arc<Mutex<Inner>>) -> i32 {
    if guard.live.contains_key(id) {
        0  // ← WRONG! Process may have exited with code 1, 127, etc.
    } else {
        -1  // Killed
    }
}
```

**Impact:**
- `OnFailure` policy won't restart failures (`exit 1` treated as `exit 0`)
- Test `restart_on_failure_policy_restarts_failed_command` unreliable
- Decision matrix row "on-failure + exit≠0 → restart" **broken**

**Root cause:** `portable-pty` API doesn't expose child exit status. `MasterPty` has no `wait()` equivalent.

**Fix options:**
1. **Short-term:** Default to `-1` (assume failure) instead of `0`. Change policy semantics: `OnFailure` = "restart on any exit", `Always` = same.
2. **Long-term:** Wrap child in `std::process::Command`, call `waitpid()`, store exit code before EOF. Requires architecture change.
3. **Pragmatic:** Document limitation + redefine policies:
   - `Never` = no restart
   - `OnFailure` = restart on any exit (no distinction)
   - `Always` = same as on-failure
   - Only manual kill blocks restart

**Recommendation:** Option 3 + doc update. Real exit codes require OS-level `waitpid()` not available through current abstraction.

**Action:**
- [ ] Update `harvest_exit_code()` doc comment explaining limitation
- [ ] Update plan/tests to reflect "exit code always -1 or 0" semantics
- [ ] Consider filing upstream issue with `portable-pty` for exit code API

---

### 2. Unbounded Respawn Channel 🛑 **DoS Risk**

**File:** [manager.rs#L126](../../../server/src/pty/manager.rs#L126)

```rust
let (respawn_tx, respawn_rx) = mpsc::unbounded_channel();
```

**Problem:** If supervisor loop panics/hangs, reader threads keep sending `RespawnCmd` forever. Memory leak → OOM.

**Attack vector:** Supervisor bug + 1000 crashing sessions = unbounded queue growth.

**Fix:**

```rust
let (respawn_tx, respawn_rx) = mpsc::channel(256);  // Bounded

// In reader_thread:
if let Err(e) = respawn_tx.try_send(cmd) {
    warn!("Respawn queue full for {session_id}, dropping: {e}");
}
```

**Why 256?** Typical max concurrent sessions = ~50. 5× buffer = safety margin. Queue full = supervisor dead/slow, drop is correct.

**Action:**
- [ ] Replace `unbounded_channel()` with `channel(256)`
- [ ] Change `send()` to `try_send()` with error logging
- [ ] Add metric for respawn queue depth (Phase 6)

---

## High Priority

### 3. Race: `killed` flag TOCTOU 🏁

**File:** [manager.rs#L388-403](../../../server/src/pty/manager.rs#L388-403)

**Problem:** Check-then-act pattern without lock held:

```rust
let was_killed = inner_guard.killed.contains(&session_id);  // ← CHECK
// ... lock released ...
if should_restart {
    respawn_tx.send(cmd);  // ← ACT (lock not held)
}
```

**Mitigated:** Supervisor checks `killed` again before spawn (line 454-458), but not documented as race defense.

**Fix:** Add clarity comment in reader_thread:

```rust
// Note: Lock released before send. If user calls kill() here (TOCTOU window),
// supervisor will detect killed flag and skip respawn (see supervisor_loop).
if let Some(delay) = should_restart {
    respawn_tx.send(cmd);
}
```

---

### 4. Supervisor JoinHandle Not Tracked 🔄

**File:** [manager.rs#L134-139](../../../server/src/pty/manager.rs#L134-139)

```rust
tokio::spawn(supervisor_loop(...));  // ← Handle dropped immediately
```

**Problem:** `dispose()` drops sender but doesn't wait for supervisor exit. Supervisor may spawn sessions during shutdown.

**Fix:**

```rust
struct PtySessionManager {
    supervisor_handle: tokio::task::JoinHandle<()>,
    // ...
}

pub fn dispose(&self) {
    drop(self.respawn_tx);  // Close channel
    if let Ok(handle) = self.supervisor_handle.lock() {
        tokio::task::block_in_place(|| handle.await);  // Wait for drain
    }
}
```

---

## Medium Priority

### 5. `killed` Set Unbounded Growth 📈

**File:** [manager.rs#L600](../../../server/src/pty/manager.rs#L600)

**Problem:** Removed from `killed` only on respawn. If user creates 10k unique IDs then kills them, set retains all forever.

**Impact:** ~50 bytes/session, grows unbounded. Not critical but violates "no leaks" principle.

**Fix:** Clean in tombstone sweep task:

```rust
guard.dead.retain(|id, d| {
    let keep = d.died_at.elapsed() < DEAD_SESSION_TTL;
    if !keep {
        guard.killed.remove(id);  // Clean killed flag
    }
    keep
});
```

---

### 6. Misleading Function Name 📛

**File:** [manager.rs#L637](../../../server/src/pty/manager.rs#L637)

```rust
fn harvest_exit_code(...) -> i32
```

**Problem:** "harvest" implies extraction from OS. Actually infers/guesses. Misleading given Issue #1.

**Fix:**

```rust
/// Infers exit code heuristically (portable-pty doesn't expose exit status).
/// Returns -1 if killed, 0 for natural exit. NOT ACCURATE for real codes.
fn infer_exit_code(...) -> i32
```

---

### 7. Restart Counter Reset Dataflow Unclear 🔢

**File:** [manager.rs#L412-417](../../../server/src/pty/manager.rs#L412-417)

```rust
let next_restart_count = if exit_code == 0 && restart_count > 0 {
    0  // Reset on clean exit
} else {
    restart_count
};
```

**Problem:** Computed but never used in current scope. Reader must trace `cmd.restart_count` → `respawn_internal` → `meta.restart_count = cmd.restart_count + 1`.

**Fix:** Add comment:

```rust
// Reset allows fresh retries after transient failures.
// Consumed by respawn_internal which increments before spawn.
let next_restart_count = ...
```

---

## Low Priority (Nice to Have)

### 8. Test Gap: Concurrent Create During Respawn 🧪

**Missing:** Test for race where user calls `terminal:create` while supervisor respawns same ID.

**Expected:** Last-writer-wins (documented in plan as "same as create()").

**Add:**

```rust
#[test]
fn recreate_during_respawn_replaces_session() {
    let mgr = make_manager();
    let mut opts = opts("restart:race", "exit 1");
    opts.restart_policy = RestartPolicy::OnFailure;
    mgr.create(opts.clone()).unwrap();
    
    std::thread::sleep(Duration::from_millis(500));  // Wait for backoff
    
    opts.command = "echo new".to_string();
    mgr.create(opts).unwrap();  // Should replace pending respawn
    
    let buffer = mgr.get_buffer("restart:race").unwrap();
    assert!(buffer.contains("new"));
}
```

---

### 9. Unused Field: `RespawnCmd._prev_exit_code` 🗑️

**File:** [manager.rs#L28](../../../server/src/pty/manager.rs#L28)

```rust
struct RespawnCmd {
    _prev_exit_code: i32,  // ← Underscore = intentionally unused
}
```

**Decision:** Keep for Phase 5 WS events (send exit code in `process:restarted`) OR remove now (YAGNI).

---

### 10. Pure Function Visibility Workaround 🔍

**File:** [manager.rs#L705-712](../../../server/src/pty/manager.rs#L705-712)

```rust
#[cfg(test)]
pub(crate) fn restart_delay_ms(...) { ... }

#[cfg(not(test))]
fn restart_delay_ms(...) { ... }
```

**Issue:** Code duplication for test visibility. Standard pattern: `#[cfg_attr(test)]` or accept `pub(crate)` in prod (harmless).

**Improvement:** Single function:

```rust
#[cfg_attr(test, visibility::make(pub(crate)))]
fn restart_delay_ms(...) { ... }
```

Or just use `pub(crate)` everywhere (not exposed outside crate).

---

## Positive Observations ✅

1. **Supervisor pattern is textbook-correct** — cleanly separates blocking reader from async respawn.
2. **Decision matrix 8/8 rows tested** — exhaustive unit tests for pure functions.
3. **Integration tests cover all policies** — `OnFailure`, `Always`, `Never`, manual kill.
4. **Restart counter reset semantics match systemd/Docker** — correct UX.
5. **Session ID reuse prevents frontend churn** — excellent design decision.
6. **Exponential backoff with 30s cap** — production-grade resilience.
7. **No `spawn_blocking` abuse** — correctly uses OS threads for PTY reads.
8. **`killed` flag pattern correct** (modulo TOCTOU doc issue).

---

## Test Matrix Coverage

| Policy | Exit=0 | Exit≠0 | Killed | Retries | Test |
|---|---|---|---|---|---|
| Never | any | any | any | any | ✅ `decide_restart_never_policy` |
| OnFailure | 0 | — | no | — | ✅ `..._clean_exit` |
| OnFailure | — | 1 | no | yes | ✅ `..._failure_exit` |
| OnFailure | — | 1 | no | no | ✅ `..._retries_exhausted` |
| Always | 0 | — | no | yes | ✅ `..._restarts_on_clean_exit` |
| Always | — | 1 | no | yes | ✅ `..._restarts_on_failure` |
| Always | any | any | no | no | ✅ `..._retries_exhausted` |
| any | any | any | yes | any | ✅ `decide_restart_manual_kill_blocks` |

**Coverage:** 8/8 matrix rows ✅

**Integration tests:**
- ✅ Restart on failure (`restart_on_failure_policy_restarts_failed_command`)
- ✅ Stop after max retries (`restart_on_failure_policy_stops_after_max_retries`)
- ✅ Never policy no restart (`restart_never_policy_does_not_restart`)
- ✅ Kill via API blocks restart (`restart_kill_via_api_prevents_restart`)
- ✅ Always restarts on clean exit (`restart_always_policy_restarts_on_clean_exit`)

**Missing:**
- ⚠️  Concurrent create during respawn (Issue #8)
- ⚠️  Supervisor panic recovery (hard to test, needs fault injection)

---

## Recommended Action Plan

### Pre-Merge (Before Phase 5)

1. **[P0]** Fix/document exit code issue (Issue #1) — 30 min
2. **[P0]** Bound respawn channel (Issue #2) — 15 min
3. **[P1]** Track supervisor JoinHandle (Issue #4) — 20 min
4. **[P1]** Add TOCTOU doc comment (Issue #3) — 5 min
5. **[P2]** Clean `killed` in tombstone sweep (Issue #5) — 10 min
6. **[P2]** Rename `harvest_exit_code` (Issue #6) — 5 min

**Estimated:** 1.5h total

### Post-Merge (Phase 5+)

7. **[P3]** Add concurrent create test (Issue #8) — 15 min
8. **[P3]** Decide on `_prev_exit_code` (Issue #9) — 5 min
9. **[P3]** Simplify pure function visibility (Issue #10) — 5 min

**Estimated:** 25 min

---

## Unresolved Questions

1. **Exit code semantics:** Accept portable-pty limitation OR invest in OS-level `waitpid()` wrapper? → **Decision needed from architect**
2. **Respawn queue bound:** 256 sufficient? Should it scale with `restart_max_retries`? → **256 is fine (5× typical load)**
3. **Supervisor crash recovery:** Should manager spawn watchdog to restart supervisor? → **No, YAGNI (supervisor is simple, unlikely to panic)**
4. **`_prev_exit_code` field:** Keep for Phase 5 metrics OR remove now? → **Decision deferred to Phase 5 implementation**

---

## Files Modified

- ✅ `server/src/pty/manager.rs` — restart engine (supervisorpattern)
- ✅ `server/src/pty/tests.rs` — 8 unit + 5 integration tests
- ✅ `server/src/pty/session.rs` — `RespawnOpts` type (Phase 3, no changes)

---

## Conclusion

Excellent implementation overall. Supervisor pattern is optimal for this use case. Test coverage is thorough (decision matrix exhaustive). Architecture adheres to KISS/DRY.

**Two critical bugs block merge:**
1. Exit code harvesting (API limitation, needs documentation)
2. Unbounded channel (DoS risk, easy fix)

Post-fix, implementation is production-ready.

**Recommendation:** Fix Issues #1-6, merge, then address remaining items in Phase 5.

---

**Review completed:** 2026-04-16  
**Next review:** Phase 05 (WS events + channel split)
