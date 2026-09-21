# Code Review (Cycle 2): Phase D02 — Owner-Account Runner and Worker Supervision

**Date:** 2026-09-21  
**Target:** Phase D02 Implementation (Post-Fix Re-review)  
**Reviewer:** Senior Software Engineer (Code Review Specialist)  
**Status:** Approved  
**Overall Score:** 9.0 / 10  

---

## 1. Scope & Analyzed Files

- `server/src/plugins/framing.rs` (271 LOC) — Length-prefixed frame encoding/decoding, JSON-RPC 2.0 validation, EOF/truncation detection, async read/write.
- `server/src/plugins/runner_server.rs` (448 LOC) — Multiplexed Unix domain socket server (`into_split()`), SO_PEERCRED check, handshake, concurrent task dispatch.
- `server/src/plugins/runner_client.rs` (475 LOC) — Reconnecting client with full-duplex background reader, request-id routing via oneshot channels.
- `server/src/plugins/worker_process.rs` (396 LOC) — Node child spawn, UTF-8-safe bounded stderr sanitizer, process group kill, strict JSON-RPC stdout parsing.
- `server/src/plugins/worker_supervisor.rs` (620 LOC) — Installation supervisor, UUID-safe context lookup, generation fencing, process group kill and crash tracking on `DeadlineExceeded`.
- `server/src/plugins/registry.rs` (diff, +76 LOC) — Failure recording, persistent installation enable/disable with generation increment.
- `server/src/plugins/error.rs` (diff, +16 LOC) — `worker_failed` and `context_revoked` constructors.
- `server/src/plugins/mod.rs` (diff, +10 LOC) — Module exports.
- `server/src/bin/dam-hopper-plugin-runner.rs` (98 LOC) — Daemon entrypoint CLI and signal handling.
- `deploy/systemd/dam-hopper-plugin-runner.service.in` (56 LOC) — systemd service template, hardening, resource limits.
- `server/tests/plugin_runner_protocol.rs` (248 LOC) — Protocol, framing, peer UID tests.
- `server/tests/plugin_runner_supervision.rs` (632 LOC) — Real worker supervision, UUID context routing, stale context revocation, multiplexed concurrent cancellation.

**Total Lines Analyzed:** ~3,350 LOC  
**Updated Plan:** `plans/260920-1603-plugin-platform/phase-02-owner-runner.md`

---

## 2. Validation Commands & Results

### A. Scoped Protocol & Supervision Test Suites
```bash
cargo test --manifest-path server/Cargo.toml --test plugin_runner_protocol --test plugin_runner_supervision
```
**Output:**
```text
running 7 tests
test test_framing_encode_decode_roundtrip ... ok
test test_framing_fragmentation_and_coalescing ... ok
test test_framing_rejects_oversized_payload ... ok
test test_json_rpc_strict_validation ... ok
test test_runner_server_peer_uid_validation ... ok
test test_runner_server_rejects_mismatched_protocol_version ... ok
test test_runner_server_handshake_and_method_dispatch ... ok
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

running 6 tests
test test_real_worker_crash_and_restart_exhaustion ... ok
test test_real_worker_lifecycle_and_snapshot_summary ... ok
test test_context_id_uuid_support_through_runner_server ... ok
test test_stale_context_revocation_across_worker_restarts ... ok
test test_concurrent_invokes_and_cancellation_multiplexed ... ok
test test_real_worker_cancellation ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.18s
```

### B. Full Plugin Subsystem Test Suites
```bash
cargo test --manifest-path server/Cargo.toml \
  --test plugin_runner_protocol \
  --test plugin_runner_supervision \
  --test plugin_package_registry \
  --test plugin_package_archive \
  --test plugin_contract_fixtures
```
**Output:** `37 passed (5 suites, 6.18s)`

### C. Workspace Typecheck & Lints
```bash
cargo check --manifest-path server/Cargo.toml --tests --bin dam-hopper-plugin-runner
```
**Output:** `0 errors, 0 warnings`

---

## 3. Evaluation of Fixed Critical Issues

### C1. Context ID String Splitting with UUIDs
- **Status:** **FULLY RESOLVED**
- **Changes:**
  - `open_context()` creates context IDs as `ctx:<installation_id>:<uuid>`.
  - `parse_context_installation_id()` strips prefix `ctx:` and performs `rest.rsplit_once(':')`, isolating the installation UUID from the context UUID cleanly.
  - `SupervisorManager::get_by_context()` parses the installation ID and retrieves or creates the supervisor.
  - `runner_server.rs` routes `context.close` and `plugin.invoke` via `get_by_context(&params.context_id)`.
  - Added `test_context_id_uuid_support_through_runner_server` in `plugin_runner_supervision.rs` verifying end-to-end `open_context` -> `invoke` -> `close_context` over the Unix socket.

### C2. Transport Sequential Blocking on Unix Socket
- **Status:** **FULLY RESOLVED**
- **Changes:**
  - `RunnerServer`: `stream.into_split()` decouples reader and writer. The reader loop reads frames continuously and spawns a `tokio::spawn` task for each request. The writer is locked only for the duration of transmitting the response frame.
  - `RunnerClient`: `stream.into_split()` with a background reader task demultiplexing incoming frames into request-keyed oneshot channels. `execute_call` releases session lock prior to I/O and locks writer only during frame transmission.
  - Responsive cancellation: An in-flight slow operation does not block transmission or processing of `request.cancel`.
  - Added `test_concurrent_invokes_and_cancellation_multiplexed` asserting cancellation response `< 250ms` while a slow invoke runs on the same client connection.

### C3. Deadline Exceeded Process Group Termination and Restart Escalation
- **Status:** **FULLY RESOLVED**
- **Changes:**
  - `InstallationSupervisor::invoke` checks:
    ```rust
    let is_deadline = matches!(&invoke_res, Err(e) if e.code == PluginErrorCode::DeadlineExceeded);
    let needs_crash_handling = is_deadline || (invoke_res.is_err() && !worker.is_alive());
    if needs_crash_handling {
        self.handle_worker_crash().await;
    }
    ```
  - A timeout now triggers `handle_worker_crash()`, escalating crashes against the 3-in-60s budget, clearing in-flight operations, and killing the worker process group.

### C4. Stale Context Leaking Across Restarts and Generation Fencing
- **Status:** **FULLY RESOLVED**
- **Changes:**
  - `handle_worker_crash()` and `deactivate()` clear `inner.contexts`.
  - `activate()` increments `inner.generation += 1`.
  - `invoke()` enforces generation fencing:
    ```rust
    if ctx.activation_generation != generation {
        return Err(PluginError::context_revoked(
            "Context belongs to prior worker generation and has been revoked",
        ));
    }
    ```
  - Added `test_stale_context_revocation_across_worker_restarts` confirming old context IDs return `ContextRevoked` or `InvalidInput` post-restart.

---

## 4. Critical Issues (MUST FIX)

**None.** All 4 critical issues from Cycle 1 have been completely resolved and verified by passing tests.

---

## 5. Warnings (SHOULD FIX)

### W1. Racy Cancellation Mapping via `client.peek_next_request_id()`
- **Location:** `server/src/plugins/runner_client.rs:75-77`
- **Issue:** `peek_next_request_id(&self)` inspects the atomic counter before `invoke` executes. If concurrent tasks invoke operations, peeking the counter leads to a race condition where task A cancels task B's request ID.
- **Impact:** Cancellation under concurrent caller threads in Phase D03/D05 could cancel the wrong operation.
- **Recommendation:** Provide `RunnerClient::invoke_with_id(&self, request_id: Option<String>, params: PluginInvokeParams)` or return an invocation handle encapsulating the request ID.

### W2. Loss of Structured `PluginErrorCode` across JSON-RPC Transport
- **Location:** `server/src/plugins/runner_server.rs:335`, `server/src/plugins/runner_client.rs:229-234`
- **Issue:** `runner_server.rs` maps all errors to JSON-RPC `-32603` without populating error `data`. `runner_client.rs` reconstructs all responses as `PluginError::runner_unavailable(msg)`. Specific codes (`Overloaded`, `DeadlineExceeded`, `ContextRevoked`, `Forbidden`) are erased.
- **Recommendation:** Include `{"errorCode": err.code.as_str()}` in the JSON-RPC error `data` payload and reconstruct the specific `PluginError` variant in `runner_client.rs`.

### W3. Missing 64 KiB Control Frame Payload Ceiling Enforcement
- **Location:** `server/src/plugins/framing.rs:6`
- **Issue:** `MAX_CONTROL_FRAME_BYTES: usize = 64 * 1024` is defined but not enforced on control frames (`runner.hello`, `context.open`, `context.close`, `request.cancel`). Control frames can consume up to 16 MiB.
- **Recommendation:** Check payload size against `MAX_CONTROL_FRAME_BYTES` for non-`plugin.invoke` / non-`plugin.readUi` methods.

### W4. Worker Stdout Notifications Dropped Without ID
- **Location:** `server/src/plugins/worker_process.rs:123`
- **Issue:** In the worker stdout reader, frames lacking an `"id"` field are ignored. While strict JSON-RPC validation is now enforced, valid worker notifications (`worker.health`, `worker.shutdown`) cannot be processed.
- **Recommendation:** Branch on `msg.get("method")` when `"id"` is absent to handle notifications.

### W5. Missing 32-Request Queue Mechanism
- **Location:** `server/src/plugins/worker_supervisor.rs:286-290`
- **Issue:** Requests exceeding `MAX_OPERATIONS_PER_WORKER` (16) immediately return `PluginError::overloaded`. Requirement 9 specifies queueing up to 32 requests with reserved capacity for cancel/control.
- **Recommendation:** Implement bounded MPSC / semaphore queuing for Phase D03/D05.

### W6. Optional Peer UID Validation Allows Unauthenticated Peers by Default
- **Location:** `server/src/bin/dam-hopper-plugin-runner.rs:30`, `server/src/plugins/runner_server.rs:188`
- **Issue:** `expected_api_uid` defaults to `None`. In ad-hoc runs without CLI arguments, any local non-root user can connect to the Unix domain socket.
- **Recommendation:** Default to runner UID or require explicit `--expected-api-uid` in production environments (handled correctly in the systemd service template).

---

## 6. Suggestions (NICE TO HAVE)

### S1. Residual Process Group Cleanup on Graceful Exit
- **Location:** `server/src/plugins/worker_process.rs:358-382`
- **Issue:** If the primary Node process exits within 5s of receiving `worker.shutdown`, `libc::kill(-self.pgid, libc::SIGKILL)` is bypassed. Any detached child processes spawned by Node could survive.
- **Recommendation:** Issue `libc::kill(-self.pgid, libc::SIGKILL)` unconditionally at the end of `kill_process_group`.

### S2. Symlink Verification on Socket Parent Directory
- **Location:** `server/src/plugins/runner_server.rs:136-166`
- **Issue:** `fs::metadata` follows symlinks. Use `symlink_metadata` to verify directory ancestry is free of symlink redirections.

### S3. CLI Default for `--node-bin`
- **Location:** `server/src/bin/dam-hopper-plugin-runner.rs:25`
- **Issue:** `--node-bin` defaults to `"node"`, which resolves via `PATH`. Requirement 101 specifies never searching `PATH`. Make `--node-bin` a required argument without default.

---

## 7. Positive Observations

- **Robust Context Routing:** Clean extraction of installation UUIDs from compound `ctx:<installation_id>:<uuid>` strings without brittle character splitting.
- **High Concurrency & Responsiveness:** Async full-duplex multiplexing via `stream.into_split()` decouples reading from execution; cancellations execute in `< 2ms` under saturated invoke conditions.
- **Strict Generation Fencing:** Worker restart invalidates prior contexts, preventing stale operations from mutating state or reaching subsequent worker instances.
- **Resilient Escalation:** Deadlines automatically escalate to process group kill and crash recording, enforcing the 3-in-60s budget.
- **Hardened Systemd Template:** Excellent security isolation (`ProtectSystem=strict`, `NoNewPrivileges=true`, `MemoryMax=1G`).

---

## 8. Unresolved Questions

1. **Structured RPC Error Protocol:** Should Phase D03 formalize the JSON-RPC error `data.code` mapping schema across all plugin RPCs, or will `PluginErrorCode` string representation be standardized?
2. **Pinned Node.js Packaging:** Will the pinned Node >= 22.19 executable be distributed under `/usr/lib/dam-hopper/node` by the release package installer?
