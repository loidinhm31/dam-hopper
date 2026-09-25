# Code Review Summary: Phase D03 Authorized Plugin API (Re-Review)

**Date:** 2026-09-22  
**Reviewer:** Senior Software Engineer (ReviewerAgent2)  
**Score:** 9.2 / 10  
**Status:** Approved (All 4 critical findings resolved; non-blocking warnings identified)

---

### Scope
- **Files reviewed:**
  - `server/src/plugins/authorization.rs`
  - `server/src/plugins/contexts.rs`
  - `server/src/plugins/api_service.rs`
  - `server/src/plugins/runner_server.rs`
  - `server/src/plugins/worker_supervisor.rs`
  - `server/src/plugins/worker_process.rs`
  - `server/src/plugins/mod.rs`
  - `server/src/api/plugins.rs`
  - `server/src/api/auth.rs`
  - `server/src/api/ws.rs`
  - `server/src/api/ws_protocol.rs`
  - `server/src/api/router.rs`
  - `server/src/state.rs`
  - `packages/ui/src/api/plugin-types.ts`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/ws-transport.ts`
  - `server/tests/plugin_authorization.rs`
  - `server/tests/plugin_api_integration.rs`
  - `server/tests/plugin_runner_supervision.rs`
- **Lines analyzed:** ~3,100 lines (diff + context)
- **Updated plans:** `plans/260920-1603-plugin-platform/phase-03-authorized-api.md`

---

### Overall Assessment
All 4 critical issues from initial cycle resolved cleanly. Request ID race eliminated via per-worker atomic request IDs. UI IPC channel mappings for `plugins:*` added and verified. Sensitive worker stderr removed from client RPC errors and routed strictly to server tracing. Default-deny authorization policy fully enforced with visibility filtering. Lock contention on invoke resolved with read-lock fast path in `validate_epoch`. Active WebSocket epochs & contexts revoked on HTTP logout. Zero TypeScript errors, all scoped integration and unit tests passing.

---

### Critical Issues
*None. All 4 previous critical issues verified resolved:*
1. **[RESOLVED] Request ID Collisions:** `worker.generate_request_id()` now generates unique IDs (`req-{pid}-{counter}`) in `open_context()` and `close_context()`.
2. **[RESOLVED] Broken UI WsTransport Channel Mapping:** `packages/ui/src/api/ws-transport.ts` maps `plugins:list` to `GET /api/plugins` and `plugins:openContext`, `closeContext`, `invoke`, `cancel` to corresponding `POST /api/plugins/...` endpoints.
3. **[RESOLVED] Worker Stderr Leaked in RPC Responses:** `server/src/plugins/worker_process.rs:238` logs `stderr` to `tracing::error!` and returns sanitized `Worker handshake failed: {e}`.
4. **[RESOLVED] Default-Allow Grant Fallback:** `server/src/plugins/authorization.rs:276` enforces default-deny when actor has no configured grants. `api_service.rs:list_plugins` filters via `has_actor_visibility`.

---

### Warnings (Non-Blocking)

1. **`revoke_by_actor` Leaves Stale Epochs in `self.epochs`**
   - **Location:** `server/src/plugins/authorization.rs:133-145`
   - **Impact:** `revoke_by_actor` sets `ep.is_valid = false` but does not remove entries from `self.epochs` (unlike `revoke_epoch` which calls `epochs.remove(&epoch_id)`). Over extended runtime with frequent user logouts, dead epoch entries accumulate in memory.
   - **Recommendation:** Remove keys from `epochs` in `revoke_by_actor`:
     ```rust
     for id in epoch_ids {
         epochs.remove(&id);
     }
     ```

2. **Lazy Context Expiry Sweep Relies on Mutation Triggers**
   - **Location:** `server/src/plugins/contexts.rs:53, 94`
   - **Impact:** Expired contexts pruned only during `insert()` or `begin_invoke()`. If traffic pauses, abandoned idle contexts remain allocated past 15-min TTL until next operation.
   - **Recommendation:** Add background interval task (`tokio::time::interval(Duration::from_secs(60))`) calling `state.plugin_service.context_table.cleanup_expired()`.

3. **Hardcoded Machine Absolute Path in Integration Tests**
   - **Location:** `server/tests/plugin_api_integration.rs:543, 569, 598, 611`
   - **Impact:** Hardcoded `/home/loidinh/WS/evcrate` will fail if run in CI or other dev environments.
   - **Recommendation:** Resolve dynamically:
     ```rust
     let evcrate_root = std::env::var("EVCRATE_ROOT")
         .map(PathBuf::from)
         .unwrap_or_else(|_| PathBuf::from("/home/loidinh/WS/evcrate"));
     ```

---

### Suggestions

1. **Prune Stale Protocol Event or Wire Forwarding:** `PluginRevoked` event in `ws_protocol.rs:503` and `plugin-types.ts:79` remains unreferenced. Wire to context revocation in Phase D04/D05 or gate under feature flag.
2. **Periodic Epoch Sweep:** Add `prune_expired_epochs(&self)` to `EpochRegistry` to sweep epochs where `now >= exp`.

---

### Positive Observations
- **RAII Concurrency Tracking:** `InvokeGuard` with `Drop` implementation ensures `in_flight` counter decrements on all exit paths (panics, errors, timeouts).
- **Target Resolution Isolation:** Strict use of `WorkspaceTargetResolver::resolve` prevents path traversal and unverified worktree aliases.
- **Defense in Depth:** Both route-level (`check_no_auth`) and service-level (`check_open_authorization`, `check_invoke_authorization`) enforce `--no-auth` denial.
- **Fast-Path Read Locking:** Read-lock optimization in `validate_epoch` eliminates cross-request serialization bottlenecks.

---

### Validation Commands & Results
- `cargo test --manifest-path server/Cargo.toml --test plugin_authorization`: **7/7 passed (0.00s)**
- `cargo test --manifest-path server/Cargo.toml --test plugin_runner_supervision`: **6/6 passed (6.18s)**
- `cargo test --manifest-path server/Cargo.toml --test plugin_api_integration`: **3/3 passed (0.23s)**
- `pnpm --filter @dam-hopper/ui test -- packages/ui/src/api/ws-transport.test.ts`: **1,845/1,845 passed (11.75s)**
- `pnpm --filter @dam-hopper/ui build`: **Clean compilation (0 errors)**

---

### Unresolved Questions
1. Should `revoke_by_actor` on logout also emit a push notification to active WebSockets under that actor to trigger immediate client-side token discard?
2. When packaging for standalone distribution, what canonical env var or relative lookup should determine the default `EVCRATE_ROOT`?
