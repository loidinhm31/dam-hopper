# Code Review Summary: Phase 05 Transactional Sampler & Automatic Admission Coordinator

**Date:** 2026-09-11 08:49  
**Reviewer:** Senior Software Engineer (Phase05Reviewer)  
**Score:** 9.6 / 10  
**Status:** Approved with Fixes Applied  

---

## Scope
- **Files reviewed:**
  - `server/src/idle_suspend/activity/sampler.rs`
  - `server/src/idle_suspend/activity/mod.rs`
  - `server/src/idle_suspend/coordinator.rs`
  - `server/src/idle_suspend/status.rs`
  - `server/src/idle_suspend/policy.rs`
  - `server/src/idle_suspend/mod.rs`
  - `server/src/pty/manager.rs`
  - `server/src/pty/fleet_state.rs`
  - `server/src/state.rs`
  - `server/src/api/idle_suspend.rs`
  - `server/src/idle_suspend/tests.rs`
  - `server/src/pty/tests.rs`
- **Lines of code analyzed:** ~4,200 LOC
- **Review focus:** Concurrency safety, transactional boundaries, privacy leakage, admission fencing, status publishing invariants, and flakiness elimination.
- **Updated plans:**
  - `plans/260910-1604-agent-activity-idle-suspend/phase-05-sampler-coordinator.md`
  - `plans/260910-1604-agent-activity-idle-suspend/plan.md`

---

## Overall Assessment
Implementation adheres strictly to Phase 05 normative requirements. The transactional worker correctly decouples process scan and TCP netlink diagnostics from coordinator execution. Back-to-back commits ensure no desynchronized baseline generations. The private opaque ticket mechanism securely enforces multi-stage fences under manager lock without leaking PIDs or socket descriptors.

Four concrete issues were identified and addressed:
1. **Critical:** `eligibility_deadline` calculation in `coordinator.rs:901` mistakenly used `quiet_anchor` rather than `anchor + quiet_period_seconds`, bypassing the manager-locked deadline expiry fence.
2. **High:** Status publishing erroneously checked `last_attempted_epoch_activity_revision.is_some()`, causing `reasonCode: "epochSpent"` to latch permanently across future epochs even after genuine activity.
3. **High:** Thread-unsafe `libc::getpwuid` in `server/src/pty/manager.rs` caused intermittent concurrent test panics with `"spawn failed: nul byte found in provided data"`. Replaced with `std::sync::LazyLock` and `libc::getpwuid_r`.
4. **Medium:** Leftover `eprintln!` debug statements in `coordinator.rs` (lines 634 and 776) emitted unformatted debug logs to stderr. Cleaned up, and immediate non-quiescent context was hooked into `activity_watcher.changed()`.

---

## Critical Issues & Fixes Applied

### 1. Inaccurate `eligibility_deadline` calculation in Final sample dispatch
- **Problem:** In `coordinator.rs:901`, `let eligibility_deadline = quiet_anchor.unwrap_or_else(Instant::now);` passed the start of the quiet period as the ticket's `eligibility_deadline`.
- **Impact:** In `pty_manager.try_claim_agent_activity_handoff`, the defense-in-depth check `if admission.now < admission.ticket.eligibility_deadline` evaluates whether the quiet period has elapsed. Passing `quiet_anchor` instead of `quiet_anchor + quiet_period_seconds` disabled this check, allowing premature claims if coordinator scheduling glitched.
- **Fix:** Corrected to `let eligibility_deadline = anchor + Duration::from_secs(quiet_period_seconds);`.

---

## High Priority Findings & Fixes Applied

### 2. Permanent `epoch_spent` latch in public status publication
- **Problem:** In `coordinator.rs`, all 8 callers of `publish_status_checked` evaluated `epoch_spent` as `last_attempted_epoch_activity_revision.is_some()`.
- **Impact:** Once an automatic claim was attempted in an epoch, `last_attempted_epoch_activity_revision` became `Some(...)`. When subsequent genuine activity advanced `epoch_activity_revision`, the status reason remained stuck reporting `epochSpent` rather than the active qualifying reason (`recentInput`, `recentOutput`, etc.).
- **Fix:** Updated condition to `Some(epoch_activity_revision) == last_attempted_epoch_activity_revision`, which correctly matches the opposite of `epoch_eligible`.

### 3. MT-unsafe `libc::getpwuid` in PTY environment resolution
- **Problem:** `resolve_current_user_account()` called `libc::getpwuid`, which uses a shared static buffer in glibc.
- **Impact:** Parallel test execution caused race conditions corrupting user directory/name strings, leading `portable-pty` to fail with `nul byte found in provided data` (~25% failure rate in `agent_activity_claim_tests`).
- **Fix:** Switched to `std::sync::LazyLock` and thread-safe re-entrant `libc::getpwuid_r`.

---

## Medium Priority Improvements & Fixes Applied

### 4. Leftover `eprintln!` debug output & immediate non-quiescent context
- **Problem:** `coordinator.rs` contained `eprintln!("[DEBUG-TRIGGER] ...")` and `eprintln!("[DEBUG-CLAIM-FAILED] ...")`.
- **Fix:** Removed both debug statements. In `activity_watcher.changed()`, added `seen_non_quiescent = true;` to guarantee immediate non-quiescent context upon terminal interaction without waiting for the 2-second sampler poll.

### 5. Compiler dead-code warnings in `ActivityObservation`
- **Problem:** Compiler warned about unread crate-private fields on `ActivityObservation` (`observation_sequence`, `fleet_generation`, etc.).
- **Fix:** Added `#[allow(dead_code)]` attribute to `ActivityObservation`.

---

## Positive Observations
1. **Strict Privacy Bounds:** Attributable processes and executable identities are exposed exclusively via authenticated `measurementWarning.processes` on `no-store` responses. DTO serializations exclude session arguments, environment variables, working directories, and raw socket metadata.
2. **Transactional Commit Isolation:** `ProcessDiscovery` and `TcpObserver` prepare samples independently; failure in either stage drops uncommitted structures, guaranteeing no corrupted baseline state.
3. **Failure Context Enrichment:** Netlink diagnostics failures join implicated socket inodes back against the prepared process sample without performing a second out-of-band scan.
4. **Opaque Claim Tickets:** `ActivityClaimTicket` omits roots and output sequences from `Debug` formatting, preventing identity leaks in debug logs.
5. **Meaningful Change Filtering:** `is_meaningful_change()` filters out sample heartbeats and timestamp drift, preventing redundant WebSocket status broadcasts.

---

## Validation Results
- `cargo test --lib idle_suspend::activity::sampler::tests`: **7/7 passed** (0.02s)
- `cargo test --lib pty::tests::agent_activity_claim_tests`: **7/7 passed** (0.01s; 20/20 consecutive loop iterations passed with zero flakiness)
- `cargo test --lib idle_suspend::tests::test_coordinator_`: **12/12 passed** (1.13s)
- `cargo test --lib idle_suspend::`: **131/131 passed** (1.14s)

---

## Unresolved Questions
None. All Phase 05 behavioral invariants, concurrency guarantees, and security bounds are satisfied.
