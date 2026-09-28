# Code Review: Phase 02 — Reporter Transport and PTY Lifecycle

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/agent_status/runtime.rs` (created, 543 LOC)
  - `server/src/agent_status/collector.rs` (created, 320 LOC)
  - `server/src/api/agent_status.rs` (created, 9 LOC)
  - `server/tests/agent_status_runtime.rs` (created, 445 LOC)
  - `server/src/agent_status/mod.rs` (modified, +6 LOC)
  - `server/src/agent_status/types.rs` (modified, +62 LOC)
  - `server/src/agent_status/tests.rs` (modified, +158 LOC)
  - `server/src/state.rs` (modified, +11 LOC)
  - `server/src/main.rs` (modified, +47 LOC)
  - `server/src/pty/manager.rs` (modified, +78 LOC)
  - `server/src/pty/tests.rs` (modified, +124 LOC)
  - `server/src/api/mod.rs` (modified, +1 LOC)
  - `server/src/api/router.rs` (modified, +6 LOC)
  - `server/src/api/ws.rs` (modified, +44 LOC)
  - `server/src/api/ws_protocol.rs` (modified, +26 LOC)
  - `server/src/api/tests.rs` (modified, +51 LOC)
- Lines of code analyzed: ~1,930 lines
- Review focus: Security, concurrency, lock ordering, credential lifecycle, PTY respawn/restore/kill cleanup, memory leaks, YAGNI/KISS/DRY adherence.
- Updated plans:
  - `plans/260928-0318-agent-status-omp-first/phase-02-reporter-transport-and-pty-lifecycle.md`
  - `plans/260928-0318-agent-status-omp-first/plan.md`

### Overall Assessment
Score: **9.0 / 10**

Architecture implementation is exceptionally clean, robust, and faithful to normative architecture in `docs/architecture/agent-status.md`.
- Fail-open listener lifecycle correctly decoupled from core terminal operation.
- Ephemeral loopback port bind (`127.0.0.1:0`) and binding before session restore verified.
- Zero credential leakage into persisted schemas, `opts.env`, SQLite, or diagnostic payloads.
- Lock inversion is architecturally impossible: `agent_status` has zero references to `pty_manager`, and `pty_manager` calls `agent_status` strictly outside its internal mutexes.
- Constant-time bearer token check, strict rejection of browser `Origin` and URL query params, loopback peer validation.
- All 1563 cargo tests pass across 57 test suites without regressions. All 1923 UI vitest tests pass. Zero compiler warnings on new code.
- 1 High Priority finding (lease expiry reporter handle eviction), 1 Medium Priority finding (unbounded `by_token` map on revocation), and 1 Medium Priority finding (unused `MAX_PRE_AUTH_CONCURRENCY`).

---

### Critical Issues
None. Zero vulnerabilities, breaking regressions, or privilege escalations identified.

---

### High Priority Findings

#### 1. Reporter Handle and Socket Not Evicted on Lease Expiration
- **Location**: `server/src/agent_status/runtime.rs:480-508` (`check_leases`)
- **Impact**: When terminal lease expires (15s of reporter silence), `reg.check_leases()` marks terminal state as `Unknown` and broadcasts the update. However, `self.0.reporters` is not pruned and `handle.close_tx` is not signaled. The hung WebSocket task remains blocked on `socket.recv()`, and if a new reporter instance attempts to connect to that same terminal incarnation, `admit_reporter` rejects it with `AgentStatusError::ReporterOccupied { active }`.
- **Contract Violation**: Normative architecture states: *"Expiry, close, release or PTY retirement permits a new claimant."*
- **Fix**: In `AgentStatusRuntime::check_leases`, evict the reporter handle and fire `close_tx` for every expired terminal:
  ```rust
  for output in &outputs {
      if output.state_changed {
          if let Some(row) = &output.row {
              let mut reporters = self.0.reporters.lock();
              let key = (row.id.clone(), row.incarnation);
              if let Some(mut handle) = reporters.remove(&key) {
                  if let Some(tx) = handle.close_tx.take() {
                      let _ = tx.send(());
                  }
              }
          }
      }
  }
  ```

---

### Medium Priority Improvements

#### 2. Potential Memory Leak in `CredentialStore::by_token`
- **Location**: `server/src/agent_status/runtime.rs:260-268` (`revoke_credential`)
- **Impact**: When credentials are revoked (`remove_terminal`, spawn failure, replacement, kill, exit), `by_terminal.remove(&key)` removes the terminal mapping, but `by_token` mutates the record in-place to `cred.state = CredentialState::Revoked` without ever deleting it. In long-running servers with continuous terminal churn/respawns, `by_token` grows monotonically.
- **Fix**: Since `authenticate_bearer` returns `TokenAuthResult::InvalidOrRevoked` for both unknown and revoked tokens, directly remove the entry:
  ```rust
  if let Some(token) = creds.by_terminal.remove(&key) {
      creds.by_token.remove(&token);
  }
  ```

#### 3. Unenforced `MAX_PRE_AUTH_CONCURRENCY` Constant
- **Location**: `server/src/agent_status/types.rs:37`, `server/src/agent_status/collector.rs:77-146`
- **Impact**: `pub const MAX_PRE_AUTH_CONCURRENCY: usize = 32;` is defined in `types.rs` per architecture requirements ("pre-auth connection concurrency 32"), but is unused in `collector.rs`. Connections awaiting the initial `ReporterHello` (up to 3 seconds) are unbounded.
- **Fix**: Guard the pre-admission phase in `handle_reporter_socket` with a `tokio::sync::Semaphore` of permit capacity 32 or return `StatusCode::SERVICE_UNAVAILABLE` when active pre-admission counter exceeds 32.

---

### Low Priority Suggestions

#### 4. Host Header Exact Port Validation
- **Location**: `server/src/agent_status/collector.rs:98-106`
- **Impact**: Current check `host_val.starts_with("127.0.0.1:") || host_val.starts_with("localhost:")` validates loopback prefix, but does not verify that the port matches the bound collector port. While peer IP is strictly validated as loopback (`peer_addr.ip().is_loopback()`), verifying exact port `local_addr.port()` adds defense-in-depth.

---

### Positive Observations
1. **Flawless Lock Hierarchy**: Zero potential for deadlocks. `agent_status` does not import or know about `pty_manager`. In `pty_manager`, credential reservation, activation, and revocation are strictly performed outside `inner.lock()`.
2. **Strict Credential Hygiene**: Capability tokens and private URLs are systematically stripped from user-supplied and parent environments case-insensitively, injected strictly onto `portable_pty::CommandBuilder`, and never persisted in `opts.env`, `RespawnOpts.env`, `SessionMeta`, SQLite, or diagnostic logs.
3. **Fail-Open Terminal Resilience**: Collector startup failure leaves PTY operations 100% operational; PTY manager creation gracefully falls back to stripped status variables when status runtime is unavailable or platform-unqualified.
4. **Clean Decoupling of Semantic Push**: UI WebSocket stream forwards agent status changes and invalidation over `alert_tx` control channel without touching raw terminal output buffers or incurring per-terminal subscription overhead.
5. **Comprehensive Automated Tests**: Real loopback WebSocket integration tests (`tests/agent_status_runtime.rs`), PTY lifecycle kill/respawn tests, and API snapshot authorization tests provide thorough end-to-end evidence.

---

### Recommended Actions
1. Apply Finding 1 fix: in `runtime.rs:check_leases`, evict expired reporter from `self.0.reporters` and signal its `close_tx`.
2. Apply Finding 2 fix: in `runtime.rs:revoke_credential`, call `creds.by_token.remove(&token)` to prevent memory leakage.
3. Wire `MAX_PRE_AUTH_CONCURRENCY` semaphore in `collector.rs`.
4. Proceed to Phase 03 (OMP adapter and installer).

---

### Metrics
- Type Coverage: 100% Rust strict typing; TypeScript types mirrored.
- Test Coverage: 5 unit/integration test suites specifically targeting Phase 02 (all passing).
- Cargo Server Tests: 1,563 passed (57 suites, 5 ignored, 0 failed).
- UI Vitest Tests: 1,923 passed (275 suites, 0 failed).
- TypeScript Compiler: 0 errors (`pnpm --filter @dam-hopper/ui build`).
- Compiler / Clippy Warnings in New Code: 0 warnings.

---

### Unresolved Questions
None.
