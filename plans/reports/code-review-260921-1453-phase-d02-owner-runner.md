# Code Review: Phase D02 — Owner-Account Runner and Worker Supervision

**Date:** 2026-09-21  
**Target:** Phase D02 Implementation  
**Reviewer:** Senior Software Engineer (Code Review Specialist)  
**Status:** Changes Requested  
**Overall Score:** 6.0 / 10  

---

## 1. Scope & Analyzed Files

- `server/src/plugins/framing.rs` (215 LOC) — Length-prefixed frame encoding/decoding, JSON-RPC validation, aggregate buffer limits.
- `server/src/plugins/runner_server.rs` (450 LOC) — Unix domain socket server, SO_PEERCRED check, handshake, JSON-RPC dispatch.
- `server/src/plugins/runner_client.rs` (438 LOC) — Unix domain socket client, connection management, request serialization.
- `server/src/plugins/worker_process.rs` (390 LOC) — Child Node process spawn, framed stdin/stdout, bounded stderr, process group kill.
- `server/src/plugins/worker_supervisor.rs` (593 LOC) — Installation supervisor, concurrency limits, crash tracking, restart exhaustion.
- `server/src/plugins/registry.rs` (diff, +76 LOC) — Failure recording, installation enable/disable.
- `server/src/plugins/error.rs` (diff, +16 LOC) — Error code constructors.
- `server/src/plugins/mod.rs` (diff, +10 LOC) — Module exports.
- `server/src/bin/dam-hopper-plugin-runner.rs` (98 LOC) — Daemon entrypoint CLI and signal handling.
- `deploy/systemd/dam-hopper-plugin-runner.service.in` (48 LOC) — systemd service template, hardening, resource limits.
- `server/tests/plugin_runner_protocol.rs` (248 LOC) — Protocol, framing, peer UID tests.
- `server/tests/plugin_runner_supervision.rs` (411 LOC) — Real worker supervision, cancel, crash exhaustion tests.

**Total Lines Analyzed:** ~2,950 LOC  

---

## 2. Validation Commands & Results

Executed scoped test suites via `cargo test`:
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
test test_runner_server_handshake_and_method_dispatch ... ok
test test_runner_server_rejects_mismatched_protocol_version ... ok
test test_runner_server_peer_uid_validation ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

running 3 tests
test test_real_worker_lifecycle_and_snapshot_summary ... ok
test test_real_worker_cancellation ... ok
test test_real_worker_crash_and_restart_exhaustion ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```
*Note:* Existing tests pass, but have significant coverage blind spots that masked several critical bugs detailed below.

---

## 3. Critical Issues (MUST FIX)

### C1. Context ID String Splitting Breaks on UUID Installation IDs
- **Location:** `server/src/plugins/runner_server.rs:408-415, 425-433`
- **Issue:** `params.context_id.split('-').nth(1)` assumes `context_id` format is `ctx-{installation_id}-{uuid}` with non-hyphenated installation ID. In DamHopper, `installation_id` is a UUIDv4 (e.g. `b4f8a846-9b16-43e6-bf75-01e4a11f26a7`). Splitting on `-` extracts only `"b4f8a846"`, causing `supervisor_manager.get_or_create(installation_id)` to fail with `"Installation 'b4f8a846' not found"` on all `context.close` and `plugin.invoke` calls routed through `RunnerServer`.
- **Impact:** System-wide failure to invoke or close any context through the runner socket API. (Tests passed only because `plugin_runner_supervision.rs` bypassed `RunnerServer` and called `sup.invoke` directly).
- **Remediation:** Implement `SupervisorManager::find_by_context_id(&self, context_id: &str) -> Option<Arc<InstallationSupervisor>>` or register active contexts in `SupervisorManager`, avoiding fragile delimiter splitting.

### C2. Transport Blocking Prevents Cancellation Responsiveness and Concurrency
- **Location:** `server/src/plugins/runner_server.rs:278-328`, `server/src/plugins/runner_client.rs:188-296`
- **Issue:**
  1. In `RunnerServer::handle_connection`, socket frames are read and processed sequentially: `read_frame_async` -> `dispatch_method(...).await` -> `write_frame_async`. While a long-running operation (`advisor.scan`, up to 30s) is in-flight, the server is blocked awaiting completion and stops reading frames from the socket. A `request.cancel` message sent by the client sits unread in the kernel buffer until the operation settles or times out.
  2. In `RunnerClient::execute_call`, `self.session.lock().await` is held for the entire duration of the RPC roundtrip (write request + read response). `RunnerClient::cancel_request` also calls `execute_call`, blocking on the same mutex and unable to send the cancel frame until the long-running operation completes.
- **Impact:** Complete violation of Key Insight 30 and Requirements 9, 12, and 80 ("cancel ack <= 250ms under saturated long-running queue"). Concurrent operations on a single connection are serialized.
- **Remediation:** Split `UnixStream` into read and write halves. In `RunnerServer`, spawn async tasks for request execution with an MPSC response channel to a dedicated writer task; process `request.cancel` immediately upon receipt. In `RunnerClient`, multiplex outgoing requests and incoming responses using request ID channels.

### C3. No Process Termination or Failure Escalation on Request Timeout / Deadline
- **Location:** `server/src/plugins/worker_supervisor.rs:384-389`
- **Issue:** In `invoke()`, `needs_crash_handling` is computed as `invoke_res.is_err() && !worker.is_alive()`. When an operation times out (`PluginErrorCode::DeadlineExceeded`), `worker.is_alive()` is still `true`. Consequently, `handle_worker_crash()` is NOT called. The slow/wedged worker process group is NEVER terminated, in-flight requests and contexts are NOT failed, and the crash is NOT counted against the 3-in-60s restart budget.
- **Impact:** Violates Requirement 13 ("On missed cancellation/deadline, terminate the worker process group, fail all its requests and contexts once, and expose explicit restart state"). Wedged workers continue running indefinitely.
- **Remediation:** Check `if invoke_res.is_err() && (!worker.is_alive() || invoke_res.as_ref().unwrap_err().code == PluginErrorCode::DeadlineExceeded)`. On deadline timeout, forcefully terminate the process group and trigger crash handling.

### C4. Stale Contexts Persist Across Worker Crashes and Bypass Generation Fencing
- **Location:** `server/src/plugins/worker_supervisor.rs:435-466`, `299-335`
- **Issue:** When `handle_worker_crash()` runs, `inner.contexts` is never cleared (unlike `deactivate()` which calls `inner.contexts.clear()`). Furthermore, `invoke()` does not verify that `ctx.activation_generation == inner.generation`. When the supervisor activates a new worker in a new generation, old contexts remain active in memory; subsequent `invoke` calls on those contexts are forwarded to the new worker process (which has no state for them).
- **Impact:** Violates Key Insight 29 ("Killing a wedged worker must settle every request/context it owned exactly once") and Requirement 13 ("fail all its requests and contexts once").
- **Remediation:** In `handle_worker_crash()`, clear `inner.contexts`. In `invoke()`, reject requests whose context's `activation_generation` does not match current `inner.generation`.

---

## 4. Warnings (SHOULD FIX)

### W1. Missing 32-Request Queue and Fair Scheduler
- **Location:** `server/src/plugins/worker_supervisor.rs:278-294`
- **Issue:** Requirements 9, 10, 47, and 48 require tracking up to 16 contexts, 4 in-flight invokes/context, 16 per worker, and 32 queued requests with reserved capacity for cancel/control. `TrackedRequestStatus::Queued` is defined in an enum but never used. The code immediately returns `Err(PluginError::overloaded)` if limits are hit; no queuing mechanism exists.

### W2. Missing 64 KiB Control Frame Payload Ceiling Enforcement
- **Location:** `server/src/plugins/framing.rs:6`
- **Issue:** `MAX_CONTROL_FRAME_BYTES: usize = 64 * 1024` is defined in `framing.rs` but never checked anywhere. Requirement 49 specifies "Apply 16 MiB per frame, 64 KiB control-message and 64 MiB aggregate in-flight frame/serialization caps." Control frames can currently consume up to 16 MiB.

### W3. Worker Stdout Lacks Strict JSON-RPC Validation and Drops Worker Notifications
- **Location:** `server/src/plugins/worker_process.rs:107-160`
- **Issue:** Stdout frames from the worker are parsed with raw `serde_json::from_str` without calling `validate_json_rpc_message`. Furthermore, frames lacking an `id` field are ignored (`if let Some(id_val) = msg.get("id").and_then(|v| v.as_str())`), causing worker notifications (`worker.health`, `worker.shutdown`) to be dropped.

### W4. Potential UTF-8 Panics in Stderr Truncation
- **Location:** `server/src/plugins/worker_process.rs:184-188`
- **Issue:** `&line[..1024]` blindly slices byte index 1024. If byte 1024 lands in the middle of a multi-byte UTF-8 character, Rust panics at runtime with `byte index 1024 is not a char boundary`, crashing the stderr reader task. Use `line.char_indices()` or `floor_char_boundary(1024)`.

### W5. Loss of Structured `PluginErrorCode` across JSON-RPC Transport
- **Location:** `server/src/plugins/runner_server.rs:324`, `server/src/plugins/runner_client.rs:252-259`
- **Issue:** `runner_server.rs` maps all dispatch errors to hardcoded JSON-RPC error code `-32603` with message `err.to_string()`. `runner_client.rs` blindly reconstructs all errors as `PluginError::runner_unavailable(msg)`. Specific codes (`Overloaded`, `DeadlineExceeded`, `Forbidden`, `Unauthorized`, `InvalidInput`) are erased. Structured error info should be carried in the JSON-RPC error `data` property.

### W6. Truncated Frame Header Read Treated as Clean EOF
- **Location:** `server/src/plugins/framing.rs:175-181`
- **Issue:** `read_frame_async` maps `ErrorKind::UnexpectedEof` to `Ok(None)`. If a peer sends 1 to 3 bytes of a 4-byte header and closes the connection, it is treated as a clean EOF instead of an incomplete frame error.

### W7. Optional Peer UID Validation Allows Unauthenticated Peers by Default
- **Location:** `server/src/plugins/runner_server.rs:175-207`, `server/src/bin/dam-hopper-plugin-runner.rs:32`
- **Issue:** `expected_api_uid` and `expected_runner_uid` are `Option<u32>`. When not specified (CLI default is `None`), any non-root user can connect to the Unix domain socket. Requirement 2 mandates rejecting unknown or changed peers unless explicitly configured.

### W8. Incomplete Parameter Validation in `plugin.readUi` and `plugin.activate`
- **Location:** `server/src/plugins/runner_server.rs:361-381`
- **Issue:** `plugin.readUi` ignores `params.activation_generation`, `params.actor_subject`, and `params.configured_project_target`. `plugin.activate` ignores `params.version` and does not verify it matches `inst.active_version`.

---

## 5. Suggestions (NICE TO HAVE)

### S1. Residual Process Group Cleanup on Graceful Exit
- **Location:** `server/src/plugins/worker_process.rs:350-377`
- **Issue:** In `kill_process_group`, if `child.wait()` succeeds within the 5s graceful timeout, the function returns without signaling `-self.pgid`. If the main Node process exited but left child processes in the process group, they survive. Calling `libc::kill(-self.pgid, libc::SIGKILL)` unconditionally ensures clean process group teardown per Requirement 14.

### S2. Insecure Socket Directory Verification for `/tmp`
- **Location:** `server/src/plugins/runner_server.rs:136-166`
- **Issue:** `validate_socket_directory` allows `/tmp` because `/tmp` has the sticky bit set (`mode & 0o1000 != 0`), bypassing `(mode & 0o002 != 0) && (mode & 0o1000 == 0)`. Also, `fs::metadata` follows symlinks instead of using `symlink_metadata`.

### S3. CLI Default for `--node-bin` Searches PATH
- **Location:** `server/src/bin/dam-hopper-plugin-runner.rs:27`
- **Issue:** `#[arg(long, default_value = "node")]` falls back to PATH resolution if not provided, conflicting with Requirement 101 ("never search PATH"). Make `--node-bin` a required argument without default in binary.

### S4. Dead Code: `stderr_diagnostics`
- **Location:** `server/src/plugins/worker_process.rs:386-388`
- **Issue:** `stderr_diagnostics` is defined on `WorkerProcess` but never called or exposed.

### S5. Integration Test Gap for Context & Request Multiplexing
- **Location:** `server/tests/`
- **Issue:** Add an end-to-end test connecting `RunnerClient` to `RunnerServer`, issuing `open_context`, `invoke`, and `close_context` over the Unix socket. Add a test asserting `cancel_request` responsiveness while a slow `invoke` is in-flight on the same connection.

---

## 6. Positive Observations

- Strict 4-byte big-endian framing and 16 MiB allocation rejection before reading frame body in `framing.rs`.
- Clean JSON-RPC 2.0 validation in `validate_json_rpc_message` rejecting batches, numeric IDs, and unexpected fields.
- Child process group isolation (`cmd.process_group(0)`) and multi-stage teardown (`worker.shutdown` -> SIGTERM -> SIGKILL).
- Clean environment scrubbing in `WorkerProcess::spawn` with `env_clear()`, stripping ambient tokens and cookies.
- Durable 3-in-60s restart exhaustion persisted through `PluginRegistry::record_installation_failure`.
- Hardened systemd service template with `ProtectSystem=strict`, `MemoryMax=1G`, `TasksMax=64`, and `NoNewPrivileges=true`.

---

## 7. Recommended Actions

1. Fix context ID routing in `runner_server.rs` by implementing context ID lookup in `SupervisorManager`.
2. Decouple read/write framing on both server and client to enable concurrent request processing and instant cancel delivery.
3. Trigger `handle_worker_crash()` when `invoke` fails with `PluginErrorCode::DeadlineExceeded`.
4. Clear `inner.contexts` in `handle_worker_crash()` and add generation check in `invoke()`.
5. Enforce `MAX_CONTROL_FRAME_BYTES` (64 KiB) for non-invoke/readUi methods.
6. Fix `&line[..1024]` UTF-8 boundary slice in `worker_process.rs`.
7. Preserve structured `PluginError` in JSON-RPC error `data` property.
8. Add comprehensive integration tests covering `open_context` -> `invoke` -> `cancel` over `RunnerClient`.

---

## 8. Unresolved Questions

1. Will the production Node >=22.19 executable path be pinned and distributed via release packaging (e.g. `/usr/lib/dam-hopper/node` or `/opt/dam-hopper/bin/node`), or provisioned by host package manager at a standardized path?
2. What are the definitive system users/groups for `@ADVISOR_OWNER_USER@` and `@ADVISOR_OWNER_GROUP@` across target deployment distributions (Fedora / RHEL / Ubuntu / Debian)?
