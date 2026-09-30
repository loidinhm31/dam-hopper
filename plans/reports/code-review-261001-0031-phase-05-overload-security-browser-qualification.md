# Code Review Report: Phase 05 — Overload, security and browser qualification

## Score: 7.8/10

### Scope
- **Files reviewed (7):**
  - `server/src/system/resource_stream.rs` (qual_hook test module, serialization timing, atomic counters)
  - `server/src/system/monitor.rs` (revision bump recording, snapshot sample recording, commit telemetry)
  - `server/src/auth/store.rs` (live get_user / get_session test instrumentation)
  - `server/src/api/resource_events.rs` (admission/emission hooks, supervisor check duration, live ignored harness)
  - `server/tests/common/auth_fixtures.rs` (mandatory Mongo fixture constructor enforcing DB presence)
  - `server/tests/host_resource_sse_qualification.rs` (11 behavioral qualification tests C01, C02, C03-C04, C05, C06-C07/C10, C12, C13, C14, C15, C16-C17, C19)
  - `scripts/qualify-host-resource-sse.mjs` (qualification runner for harness, release, and cleanup modes)
- **Lines of code analyzed:** ~1,650 lines of Rust and JavaScript
- **Review focus:** Overload protection (32 global / 4 subject limit), security invariants (Origin, Bearer-only, mode 0600/0700 file permissions), supervisor session revocation, resource leak prevention (RAII permits), runner accuracy, and test depth.
- **Updated plans:**
  - `plans/260929-1522-host-resources-sse/phase-05-overload-security-and-browser-qualification.md` (Updated status to in-progress 65%, review score 7.5/10, todo list checklist, and next steps)

---

## Overall Assessment

Phase 05 introduces substantial, well-architected infrastructure for qualifying host-resource SSE delivery under concurrency and security constraints. The core Rust architecture is commendable:
- Test-only hooks (`qual_hook`) are strictly isolated under `#[cfg(test)]`, ensuring zero production runtime or memory overhead.
- RAII-based permit management (`AdmissionPermit` and `SubjectGuard`) guarantees immediate permit return and map key cleanup on drop or connection termination.
- Non-GET requests (such as `OPTIONS`) immediately bypass admission checks and DB access without permit consumption.
- 11/11 behavioral qualification tests pass cleanly in 7.06s.

However, two critical issues and several warnings require immediate remediation:
1. The Node.js runner (`scripts/qualify-host-resource-sse.mjs`) calls `fetch` without consuming the response body streams, causing TCP socket buffers to fill up and stalling the server in write backpressure rather than exercising active concurrent consumers during the 30-minute N=32 soak test.
2. The supervisor revocation test (`test_c16_c17_supervisor_revocation`) only verifies MongoDB record mutation and fails to assert that the active SSE stream is actually revoked, receives an error control frame, or disconnects.
3. Playwright browser driving is absent from the runner script, leaving C37 and C41 browser qualification unexecutable via the automated runner.

---

## Critical Issues (MUST FIX)

### 1. Runner `fetch` SSE bodies are never consumed (`scripts/qualify-host-resource-sse.mjs:249-253, 308-312`)
- **Problem:** In both `runHarnessMode` client measurement series and the N=32 soak loop, requests are spawned via `fetch(`${ready.url}/api/system/resources/v1/events`, ...)` but `res.body` is never read or drained.
- **Impact:** Node.js undici socket buffers saturate after initial chunks. TCP window flow control backpressures to the Axum server. On the server, the 16-capacity mpsc channel fills up and `producer_task` blocks indefinitely at `tx.send().await`. Instead of simulating 32 active consumers continuously receiving periodic status and paired data frames, the test measures a stalled server under TCP write backpressure.
- **Remediation:** Consume the response body stream chunks asynchronously:
  ```javascript
  const fetchPromise = fetch(`${ready.url}/api/system/resources/v1/events`, {
    headers: { Authorization: `Bearer ${actor.token}` },
    signal: controller.signal,
  }).then(async (res) => {
    if (!res?.body) return;
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // Stream aborted on phase transition
    }
  }).catch(() => null);
  ```

### 2. Superficial test assertion for supervisor session revocation (`server/tests/host_resource_sse_qualification.rs:450-455`)
- **Problem:** `test_c16_c17_supervisor_revocation` establishes an SSE stream, revokes the session in MongoDB with `fixture.store.revoke_session`, and then simply asserts `fixture.store.get_session(&session.id).unwrap().revoked_at.is_some()`.
- **Impact:** The test never advances time past the 5-second supervisor tick, never reads from the response stream, and never verifies that the supervisor revokes emission eligibility, closes the stream, or sends a `SESSION_REVOKED` / `AUTH_REQUIRED` control frame. A regression in supervisor revocation logic would pass undetected.
- **Remediation:** Read chunks from `resp.into_body().into_data_stream()` with a timeout/interval, verify the stream receives `event: host-resources-error` with code `AUTH_REQUIRED` / `SESSION_REVOKED`, and assert the stream terminates.

---

## Warnings (SHOULD FIX)

### 1. Playwright browser driving absent from runner script (C37 / C41) (`scripts/qualify-host-resource-sse.mjs`)
- **Problem:** The Phase 05 plan specifies that the runner loads Playwright from `packages/ui` via `createRequire`, opens the built web preview in Chromium, navigates the settings credential form, and verifies commit-to-DOM latency ≤ 1 s (C37) and real loopback presentation (C41). `scripts/qualify-host-resource-sse.mjs` contains zero browser automation logic.
- **Impact:** Gates C37 and C41 cannot be executed or qualified using the script.
- **Remediation:** Integrate Playwright browser driving using `packages/ui` dependencies, or explicitly output C37/C41 as `status: "blocked"` with reason in `summary.json`.

### 2. C19 test bypasses unread socket backpressure and 10s Axum I/O cutoff (`server/tests/host_resource_sse_qualification.rs:460-479`)
- **Problem:** `test_c19_feature_shutdown_and_task_cleanup` only tests that calling `events.shutdown().await` on an idle `HostResourceEvents` completes in < 2 seconds.
- **Impact:** Does not test active unread HTTP sockets under write backpressure, upgraded WebSocket split I/O, or the 10-second Axum I/O shutdown cutoff.
- **Remediation:** Add a targeted test spawning a live socket that leaves responses unread, triggers server shutdown, and confirms the connection is forcibly aborted within 10 seconds while releasing all permits within 2 seconds.

### 3. C14 test omits OPTIONS preflight and 0-permit verification (`server/tests/host_resource_sse_qualification.rs:364-392`)
- **Problem:** Test `test_c14_cors_options_preflight_and_origin_admission` only sends a GET with a disallowed origin. It never issues an `OPTIONS` request.
- **Impact:** Does not prove that `OPTIONS /api/system/resources/v1/events` preflight succeeds and consumes zero global or subject admission permits.
- **Remediation:** Send `Method::OPTIONS` with Origin and Access-Control-Request-Method headers, assert HTTP 200/204 or 405 without permit acquisition (`active_global_permits() == 0`).

### 4. Runner omits 33rd client and actor-fifth rejection (`scripts/qualify-host-resource-sse.mjs`)
- **Problem:** While Rust tests C12 and C13 verify 429 rejections, the Node runner never tests 33rd client rejection or actor-fifth rejection during harness execution.
- **Impact:** `summary.json` lacks live harness evidence for 33rd/fifth limit enforcement.
- **Remediation:** During the N=32 phase, attempt a 33rd request and an actor's 5th request, asserting 429 `Retry-After: 30`, and log the result in `summary.json`.

### 5. `HOST_RESOURCE_QUAL_CONFIG` ignored in live test (`server/src/api/resource_events.rs:1093-1099`)
- **Problem:** The test ignores `HOST_RESOURCE_QUAL_CONFIG` and creates a hardcoded config string if `dam-hopper.toml` does not exist.
- **Impact:** Custom config provided by the runner cannot be loaded into the test harness.
- **Remediation:** Check `std::env::var("HOST_RESOURCE_QUAL_CONFIG")` and read from that path if present.

---

## Suggestions (NICE TO HAVE)

1. **Control socket error on missing phase name (`server/src/api/resource_events.rs:1185-1190`):**
   - In `live_host_resource_qualification`, if `cmd == "phase"` but `"name"` is missing, no response is written. Send `{"status":"error","error":"missing_name"}\n` instead of closing/ignoring.
2. **`test_c05_frame_size_limits` oversize rejection check (`server/tests/host_resource_sse_qualification.rs:158-169`):**
   - Also test that an artificially oversized frame (>256 KiB) is rejected with `FrameTooLarge`.
3. **Avoid synchronous file flush on every test hook event (`server/src/system/resource_stream.rs:334`):**
   - Calling `file.flush()` on every JSONL record during 1 s stress sampling adds disk I/O overhead. Use a `BufWriter` with periodic flush or flush on harness completion.

---

## Positive Observations

- **Zero Production Overhead:** All test instrumentation (`qual_hook`) is strictly isolated behind `#[cfg(test)]`. In `cargo build --release --bin dam-hopper-server`, all hooks are eliminated at compile time.
- **Robust RAII Permit Cleanup:** `AdmissionPermit` and `SubjectGuard` use RAII wrappers around `OwnedSemaphorePermit` and `HashMap`. When client connections disconnect or requests fail midway, permits and subject counters decrement immediately.
- **Strict File System Permissions:** `live_host_resource_qualification` strictly creates directory mode 0700 and credentials/tokens/sockets mode 0600 on Unix systems.
- **Clean Non-GET Middleware Bypass:** All SSE admission and auth route middleware layers immediately skip non-GET requests (`request.method() != GET`), preventing permit leaks and auth overhead on OPTIONS or 405 requests.
- **High Test Pass Rate:** 11/11 tests in `host_resource_sse_qualification.rs` pass cleanly with zero compiler warnings in 7.06s.

---

## Recommended Actions

1. **Fix stream draining in `scripts/qualify-host-resource-sse.mjs`:** Asynchronously read response bodies in both client series and soak loops to test active consumers.
2. **Enhance `test_c16_c17_supervisor_revocation` in `server/tests/host_resource_sse_qualification.rs`:** Read from the SSE body stream and assert stream cutoff/error event upon session revocation.
3. **Add OPTIONS preflight test to `test_c14_cors_options_preflight_and_origin_admission`:** Assert 0 permits acquired on OPTIONS.
4. **Implement Playwright runner integration or mark C37/C41 blocked:** Ensure automated runs honestly reflect browser qualification state.
5. **Support `HOST_RESOURCE_QUAL_CONFIG` in `resource_events.rs`:** Enable dynamic config injection from the runner script.

---

## Metrics

- **Type Coverage:** 100% in Rust files (strictly typed, zero `any` equivalents).
- **Test Pass Rate:** 11/11 passed (100%) in `server/tests/host_resource_sse_qualification.rs`.
- **Compiler Warnings:** 0 in Phase 05 files (`dam-hopper-server` library and tests).
- **Clippy Warnings:** 0 in Phase 05 files.

---

## Unresolved Questions

1. Which specific reference and weak Linux host environments will be designated for the 30-minute N=32 soak and baseline CPU measurements?
2. What deployed reverse proxy / load balancer (e.g. Nginx, Caddy, Envoy) and buffering/idle timeout configurations will be used for the proxy qualification gate (C40)?
3. Will Playwright browser automation for C37/C41 be embedded directly in `scripts/qualify-host-resource-sse.mjs` or orchestrated via an external test step before the Phase 06 rollout gate?
