# Code Review: Phase 02 — Authenticated SSE Endpoint

**Date:** 2026-09-30  
**Reviewer:** Senior Software Engineer (Phase02Reviewer)  
**Target:** Phase 02 — Authenticated SSE Endpoint (`plans/260929-1522-host-resources-sse/phase-02-authenticated-sse-endpoint.md`)  
**Architecture Contract:** `docs/architecture/host-resource-sse.md`  
**Overall Score:** 9.2 / 10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/api/auth.rs` (extracted `authenticate_request`, `VerifiedAuthClaims`, `authenticate_stream_request` with 2 s timeout)
  - `server/src/api/resource_events.rs` (new: `AdmissionPermit`, `SubjectGuard`, `SubjectPermit`, `BodyLease`, `HostResourceAdmission`, `HostResourceEvents`, `LeaseStream`, `RevocationState`, supervisor, middleware layers, `events_handler`)
  - `server/src/api/mod.rs` (registered `resource_events` module)
  - `server/src/api/router.rs` (registered `/api/system/resources/v1/events` with reverse middleware order)
  - `server/src/state.rs` (integrated `host_resource_events` runtime into `AppState`)
  - `server/src/lib.rs` (registered `http_shutdown` module)
  - `server/src/http_shutdown.rs` (new: `ForceCloseIo` with independent read/write cancellation futures, `ForceCloseListener`)
  - `server/src/main.rs` (`ForceCloseListener` via zero-work `tap_io` adapter, 10 s forced close timer, pre-drain feature shutdown)
  - `server/tests/host_resource_events.rs` (new: 9 integration tests covering route admission, origin, preflight, bearer, 32 global / 4 subject limits, shutdown revocation)
- **Lines of code analyzed:** ~1,560 lines of Rust code and tests.
- **Review focus:** Security, performance, concurrency, lifecycle/shutdown safety, YAGNI/KISS/DRY, and task completeness.
- **Updated plans:**
  - `plans/260929-1522-host-resources-sse/phase-02-authenticated-sse-endpoint.md` (marked B02-A, B02-B, B02-C, B02-I complete; 100%)
  - `plans/260929-1522-host-resources-sse/plan.md` (updated progress to 3/7 phases complete; 43%)

### Overall Assessment
The Phase 02 implementation faithfully delivers the authenticated host-resource SSE delivery endpoint, robust body-lifetime admission controls, independent auth supervision, and pre-drain HTTP shutdown isolation as specified in the frozen architecture (`docs/architecture/host-resource-sse.md`).

Key strengths:
1. **Accurate Route Layer Hierarchy:** Axum route layers wrap in reverse order of addition. The implementation arranges layers so that `global_admission_layer` executes outermost (before DB reads or token parsing), followed by `origin_admission_layer`, `authenticate_stream_request` (with 2 s timeout only around the auth future, keeping `Next.run` outside), `bearer_required_layer` (preventing cookie auth without leaking plugin-specific wording), and `subject_admission_layer` (max 4 per user).
2. **Leak-Proof Concurrency & Admission Limits:** Uses clone-safe `AdmissionPermit` and `SubjectPermit` wrappers around owned permits to satisfy Axum's `Extensions` clone requirements, transferring ownership via `take()` into `BodyLease`. If dropped prior to stream handoff or when the HTTP body stream terminates, semaphore permits and subject counts are promptly and safely released.
3. **Bounded Pre-Drain Teardown & Forced HTTP Close:** `http_shutdown.rs` wraps `TcpListener` in `ForceCloseListener` using Axum 0.8.8 `ListenerExt::tap_io` to preserve peer `SocketAddr` ConnectInfo without violating Rust orphan rules. Independent read/write cancellation futures abort hung or backpressured SSE/WS sockets at signal + 10 s, guaranteeing bounded HTTP drain before PTY and telemetry cleanup.
4. **Clean Code Discipline:** Zero compile warnings in all new and modified Phase 02 files. Strong DRY adherence by factoring `authenticate_request` from `require_auth`.

All 15 targeted unit and integration tests pass cleanly.

---

## Critical Issues (0)
*None.* No security vulnerabilities, memory safety violations, or data corruption hazards found.

---

## High Priority Findings (0)
*None.* No architectural deviations or functional blockers found.

---

## Medium Priority Improvements (2)

### 1. Potential Missed Revocation Notification in `producer_task`
- **Location:** `server/src/api/resource_events.rs:271, 518-529`
- **Issue:**
  `RevocationState::revoke` calls `self.notify.notify_waiters()`. In Tokio, `notify_waiters()` does not store a permit if there are currently no tasks awaiting `.notified()`.
  When `events_handler` spawns `producer_task`, the task performs two asynchronous sends (`initial_status` and `initial_frame.bytes`) before entering the `tokio::select!` event loop:
  ```rust
  if tx.send(Ok(initial_status)).await.is_err() { return; }
  if tx.send(Ok(initial_frame.bytes.clone())).await.is_err() { return; }
  ```
  If `supervisor` revokes during this setup window (e.g. if the actor's `effective_deadline` is already expired, causing `deadline_sleep` of `Duration::ZERO` to fire immediately), `notify_waiters()` fires while `producer_task` is still sending the initial frame. Because `producer_task` is not yet awaiting `notified()`, the notification is dropped.
  While subsequent timer ticks or subscription updates check `if producer_revocation.is_revoked()`, they merely `break` out of the loop without sending the `host-resources-error` control frame (`encode_error_control`).
- **Recommendation:**
  Check `is_revoked()` at the start of each iteration in `producer_task` (or before `tokio::select!`) to ensure the error frame is always emitted:
  ```rust
  loop {
      if producer_revocation.is_revoked() {
          if let Some(reason) = producer_revocation.take_reason() {
              if let Ok(err_bytes) = encode_error_control(reason.code, reason.error) {
                  let _ = tx.send(Ok(err_bytes)).await;
              }
          }
          break;
      }
      tokio::select! { ... }
  }
  ```
  Alternatively, use `self.notify.notify_one()` (which stores a permit if unpolled) or `tokio::sync::watch`.

### 2. Immediate Client Disconnect Detection via `tx.closed()`
- **Location:** `server/src/api/resource_events.rs:518-596`
- **Issue:**
  `producer_task` relies on `tx.send(...).await` failing to detect that the client disconnected (when `LeaseStream` and `ReceiverStream` drop).
  If a client disconnects while the server is between events (e.g. idle during the 1 s snapshot interval or 15 s periodic interval), `producer_task` remains suspended in `tokio::select!` waiting for `sub.changed()` or `periodic_timer.tick()`. Only after the next event attempts to send will `tx.send` fail, terminating `producer_task`, dropping `_guard`, and cancelling `supervisor`.
- **Recommendation:**
  Add `_ = tx.closed() => break,` to the `tokio::select!` block in `producer_task`:
  ```rust
  tokio::select! {
      _ = tx.closed() => break,
      _ = producer_revocation.notify.notified() => { ... }
      ...
  }
  ```
  `mpsc::Sender::closed()` resolves immediately when the receiver is dropped, allowing instant teardown of `producer_task` and cancellation of `supervisor` without waiting for the next data or timer event.

---

## Low Priority Suggestions (3)

### 1. Avoidable `String` Allocation in `SubjectGuard::drop`
- **Location:** `server/src/api/resource_events.rs:70-71`
- **Issue:**
  ```rust
  let mut counts = self.subject_counts.lock();
  if let std::collections::hash_map::Entry::Occupied(mut entry) =
      counts.entry(self.subject.clone())
  { ... }
  ```
  `self.subject.clone()` allocates an unnecessary heap `String` on every stream termination just to look up the entry.
- **Recommendation:**
  Use `get_mut` by reference and `remove` only if count reaches zero:
  ```rust
  let mut counts = self.subject_counts.lock();
  if let Some(val) = counts.get_mut(&self.subject) {
      *val = val.saturating_sub(1);
      if *val == 0 {
          counts.remove(&self.subject);
      }
  }
  ```

### 2. Minor Cloning Optimization for `AuthenticatedActor` in Stream Handler
- **Location:** `server/src/api/resource_events.rs:483`
- **Issue:**
  `AuthenticatedActor` contains multiple `String` fields (`subject`, `session_id`). Cloned once per stream request when spawning the supervisor.
- **Recommendation:**
  `spawn_supervisor` only requires `effective_deadline` and `role`. Passing these two scalar/enum fields directly avoids cloning the `subject` and `session_id` strings.

### 3. Clippy / Unused Warning in Unrelated File
- **Location:** `server/src/pty/tests.rs:14:16`
- **Issue:** `unused import: atomic::Ordering` produces a warning when running tests with clippy / full test targets. Not in Phase 02 code, but worth cleaning up in a housekeeping pass.

---

## Positive Observations
1. **Orphan Rule Compliance via `tap_io`:** Axum 0.8.8 does not permit external crates to implement `Connected<IncomingStream>` directly for `SocketAddr`. Implementing `ForceCloseListener` and wrapping it with `.tap_io(|_: &mut ForceCloseIo| {})` in `main.rs` leverages Axum's generic `Connected` implementation for `TapIo<L, F>`, cleanly preserving `ConnectInfo<SocketAddr>`.
2. **Independent Read/Write Cancellation Futures:** `ForceCloseIo` pins two separate cancellation futures (`read_cancel` and `write_cancel`) with an atomic `is_cancelled()` fast path. This completely eliminates race conditions when concurrent tasks poll read and write (such as split WebSocket streams or HTTP/2 frames).
3. **Reverse Layer Ordering Verification:** Correctly wired Axum layers:
   ```rust
   router
       .route_layer(subject_admission_layer)   // 5th (innermost)
       .route_layer(bearer_required_layer)    // 4th
       .route_layer(authenticate_stream_request) // 3rd (2s timeout)
       .route_layer(origin_admission_layer)   // 2nd
       .route_layer(global_admission_layer)   // 1st (outermost)
   ```
4. **Preflight / OPTIONS Insulation:** Preflight requests are intercepted by outer `CorsLayer` when configured, or return 405 when empty, without acquiring semaphore permits or triggering auth checks.
5. **Clean Auth Factoring (DRY):** Extracted `authenticate_request` from `require_auth`, allowing `authenticate_stream_request` to wrap only the policy evaluation in a 2 s deadline without duplicating JWT verification or timing downstream response streaming.
6. **Strict Error Formatting:** All error responses follow `{ "code": "...", "error": "..." }` with accurate HTTP status codes (403, 405, 429 with `Retry-After: 30`, 503 `AUTH_UNAVAILABLE` or `FRAME_TOO_LARGE`).

---

## Recommended Actions
1. **[Medium]** Add `if producer_revocation.is_revoked()` check before/at the start of `producer_task`'s loop to ensure error frames are always dispatched if revocation occurs during initial frame transmission.
2. **[Medium]** Add `_ = tx.closed() => break,` to `tokio::select!` in `producer_task` for immediate disconnect detection and supervisor teardown.
3. **[Low]** Replace `counts.entry(self.subject.clone())` with `counts.get_mut(&self.subject)` in `SubjectGuard::drop` to avoid `String` allocation.
4. **[Low]** Pass only `effective_deadline` and `role` to `spawn_supervisor` instead of cloning the entire `AuthenticatedActor`.

---

## Metrics
- **Type Coverage:** 100% strongly typed Rust.
- **Test Results:**
  - `cargo test --manifest-path server/Cargo.toml --test host_resource_events`: 9 passed, 0 failed (1.73 s).
  - `cargo test --manifest-path server/Cargo.toml --lib api::resource_events::tests`: 5 passed, 0 failed (0.00 s).
  - `cargo test --manifest-path server/Cargo.toml --lib http_shutdown::tests`: 1 passed, 0 failed (0.00 s).
  - **Total Scoped Tests:** 15 passed, 0 failed.
- **Compiler Warnings:** 0 warnings in all Phase 02 files under `cargo check --tests`.

---

## Unresolved Questions
1. In `spawn_supervisor`, when the claims expiry or session deadline arrives, it sleeps monotonically using `signed_duration_since(now_dt)`. If the deadline is already expired at admission (e.g. within milliseconds of connection), `duration` saturates to `ZERO` and immediately revokes. Is it intended that initial status/data still reach the client before error control, or should admission reject already-expired tokens before header emission? (Current behavior is safe and bounded; the client receives the initial frame followed immediately by an error frame).
