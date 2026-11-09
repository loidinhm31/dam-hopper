# Phase 05 Test Execution Report: Cycle 2 Post-Review Re-Verification

## 1. Request & Authority
- **Operation:** `run` (code validation & regression test suite execution)
- **Scope:** Phase 05 re-verification following Review Cycle 1 fixes across screencast producer (`browser_host_screencast`), media fanout, credit controller & settled-frame governor (`browser_host_media`), memory bounds admission & diagnostics (`browser_host_bounds`), plus regression gates (`browser_host_gateway`, `browser_host_admission`, `browser_host_lifecycle`, and `@dam-hopper/ui test:e2e:typecheck`).
- **Authority:** Read-only test execution and reporting (`run`). No product, test, or CI edits authorized.
- **Loaded Policies:** `test-principles.md`, `code-validation.md`.
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Node.js v24.16.0, pnpm 10.4.1, Cargo/Rustc 1.91.0, Chrome `/usr/bin/google-chrome`.

---

## 2. Risk Map & Selection
- **Targeted Behavior:** Phase 05 native screencast producer with burst event coalescing, candidate replacement, heartbeat expiry, zero-copy BHJF envelope broadcasting, per-socket credit controller governor with settled-frame flush, stalled viewer isolation, cross-socket credit isolation, diagnostics ring buffers and metrics counters, and hard memory bounds admission control with tracked frame reservation drop semantics.
- **Verification Gates:**
  1. Target 1: Phase 05 Screencast Producer (`browser_host_screencast`)
  2. Target 2: Phase 05 Media Fanout & Credit Controller (`browser_host_media`)
  3. Target 3: Phase 05 Memory Bounds & Diagnostics (`browser_host_bounds`)
  4. Target 4a: Regression — CDP Gateway (`browser_host_gateway`)
  5. Target 4b: Regression — Browser Host Admission (`browser_host_admission`)
  6. Target 4c: Regression — Browser Host Lifecycle (`browser_host_lifecycle`)
  7. Target 4d: Regression — UI E2E Typecheck (`@dam-hopper/ui test:e2e:typecheck`)
  8. Target 4e: Browser Host Core Unit Checks (`cargo test --lib browser_host`)

---

## 3. Execution Summary

### A. Default Invocation (Exact Commands Requested)
| # | Check / Command | Exit | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `cargo test --manifest-path server/Cargo.toml --test browser_host_screencast -- --nocapture` | 0 | 0.00s | 3 | 0 | 0* | **PASS\*** |
| 2 | `cargo test --manifest-path server/Cargo.toml --test browser_host_media -- --nocapture` | 0 | 1.12s | 5 | 0 | 0 | **PASS** |
| 3 | `cargo test --manifest-path server/Cargo.toml --test browser_host_bounds -- --nocapture` | 0 | 0.00s | 3 | 0 | 0 | **PASS** |
| 4a | `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway` | 0 | 0.92s | 14 | 0 | 0 | **PASS** |
| 4b | `cargo test --manifest-path server/Cargo.toml --test browser_host_admission` | 0 | 0.61s | 7 | 0 | 0 | **PASS** |
| 4c | `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle` | 0 | 0.27s | 10 | 0 | 0 | **PASS** |
| 4d | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | 0 | 1.28s | 1 | 0 | 0 | **PASS** |
| 4e | `cargo test --manifest-path server/Cargo.toml --lib browser_host` | 0 | 0.00s | 24 | 0 | 0 | **PASS** |
| **Total** | **All Verification Targets (Default Execution)** | **0** | **4.20s** | **67** | **0** | **0** | **PASS\*** |

\* *Note: Target 1 tests internally return early with `SKIP: No Chrome/Chromium executable available on this system.` when `DAM_HOPPER_BROWSER_EXECUTABLE` is not provided.*

---

### B. Real Browser Execution (`DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/google-chrome`)
| # | Check / Command | Exit | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1.1 | `browser_host_screencast` (`test_screencast_heartbeat_expiry`) | 0 | 0.70s | 1 | 0 | 0 | **PASS** |
| 1.2 | `browser_host_screencast` (`test_screencast_burst_events_and_candidate_replacement`) | 0 | 1.30s | 1 | 0 | 0 | **PASS** |
| 1.3 | `browser_host_screencast` (`test_screencast_producer_lifecycle_and_frames`) | 101 | 1.34s | 0 | 1 | 0 | **FAIL** |

---

## 4. Per-Target Breakdown & Evidence

### Target 1: `browser_host_screencast` (Default: 3 passed / Real Browser: 2 passed, 1 failed)
- `test_screencast_heartbeat_expiry` — PASS (0.70s with real Chrome)
  - Verified heartbeat timeout: screencast stops automatically when viewer fails to send heartbeat.
- `test_screencast_burst_events_and_candidate_replacement` — PASS (1.30s with real Chrome)
  - Real browser screencast event burst received: `[Screencast Metrics] Received: 1, ACKs: 1, Decoded: 1, Published: 1`.
  - Verified candidate replacement and rate limiter coalescing.
- `test_screencast_producer_lifecycle_and_frames` — FAIL under real Chrome execution
  - **First Failure:** `tests/browser_host_screencast.rs:138:5`
  - **Panic Message:** `assertion failed: cached.is_some()`
  - **Root Cause Analysis:** In Review Cycle 1 fix for Warning W5 ("Epoch/geometry fences permit stale input-trusted publications"), `server/src/browser_host/screencast.rs:191-194` was updated to invalidate the cached frame on dimension changes:
    ```rust
    let dims_changed = old_geom.css_width != geom.css_width || old_geom.css_height != geom.css_height || (old_geom.dpr - geom.dpr).abs() > f32::EPSILON;
    *self.geometry.write().await = geom;
    if dims_changed {
        *self.cached_frame.write().await = None;
        *self.cached_header.write().await = None;
    }
    ```
    At `tests/browser_host_screencast.rs:122-138`, the test updates geometry from 1280x720 to 800x600 (`dims_changed = true`), which immediately clears `cached_frame`. The test then executes:
    ```rust
    // 4. Verify cached frame survives across operations
    let cached = producer.get_cached_frame().await;
    assert!(cached.is_some());
    ```
    The test assertion retains the pre-W5 expectation that cached frame persists across dimension-changing resizes, directly conflicting with the W5 invalidation fix.

### Target 2: `browser_host_media` (5 passed, 0 failed, 0 skipped — 1.12s)
- `test_credit_controller_foreign_socket_rejection` — PASS
- `test_identical_full_bhjf_buffer_shared_without_app_copies` — PASS
- `test_settled_frame_governor_flush` — PASS (New test verifying W3: settled frame delivery flush without stranding)
- `test_credit_controller_bounds_and_governor` — PASS
- `test_stalled_viewer_isolation_between_two_viewers` — PASS

### Target 3: `browser_host_bounds` (3 passed, 0 failed, 0 skipped — 0.00s)
- `test_memory_admission_controller_hard_caps` — PASS
- `test_tracked_bhjf_frame_last_clone_drops_reservation` — PASS
- `test_stream_diagnostics_counters_and_ring_buffer` — PASS

### Target 4: Regression Suites (31 passed across 3 targets)
- `browser_host_gateway` (14 passed — 0.92s): All admission, dynamic budget, cancellation, origin gating, and capacity limit checks passed.
- `browser_host_admission` (7 passed — 0.61s): Loopback/origin gating, unauthenticated rejection, admin capability, and URL policy checks passed.
- `browser_host_lifecycle` (10 passed — 0.27s): Profile lock, tombstone lifecycle, epoch validation, simulate kill/delete failure, reconnect and stop passed.

### Target 5: TypeScript UI E2E Typecheck (1 passed — 1.28s)
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck` (`tsc -p tsconfig.e2e.json`): Exit code 0, 0 type errors.

### Target 6: Browser Host Core Unit Checks (24 passed — 0.00s)
- 24 unit tests across CDP client, command budget, input mapping, lease lifecycle, network policy, and session isolation passed.

---

## 5. Disposition & Findings
- **Status:** **PARTIAL / FAIL on real browser execution** (PASS on default invocation where browser executable is not injected; FAIL under real Chromium execution due to pre-W5 test assertion contradiction in `test_screencast_producer_lifecycle_and_frames`).
- **Handoff for Repair:**
  - Route to developer / debug workflow for `server/tests/browser_host_screencast.rs`:
    Align test assertion at line 138 with W5 cache invalidation semantics (either verify that `cached.is_none()` immediately after incompatible dimension change until a new epoch frame arrives, or update geometry with identical dimensions if testing non-invalidation operations).
- **Unresolved Questions:** None.
