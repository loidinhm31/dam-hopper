# Code Review Summary: Phase D03 Authorized Plugin API and Connection-Bound Contexts

**Date:** 2026-09-22  
**Reviewer:** Senior Software Engineer (ReviewerAgent)  
**Score:** 6.5 / 10  
**Status:** In Progress (Backend foundations solid & tests passing; critical transport & concurrency bugs require remediation)

---

### Scope
- **Files reviewed:**
  - `server/src/plugins/authorization.rs`
  - `server/src/plugins/contexts.rs`
  - `server/src/plugins/api_service.rs`
  - `server/src/api/plugins.rs`
  - `server/src/api/auth.rs`
  - `server/src/api/ws.rs`
  - `server/src/api/ws_protocol.rs`
  - `server/src/state.rs`
  - `server/src/api/router.rs`
  - `server/src/plugins/mod.rs`
  - `server/src/plugins/runner_server.rs`
  - `server/src/plugins/worker_supervisor.rs`
  - `server/src/plugins/worker_process.rs`
  - `packages/ui/src/api/plugin-types.ts`
  - `packages/ui/src/api/client.ts`
  - `server/tests/plugin_authorization.rs`
  - `server/tests/plugin_api_integration.rs`
  - `server/tests/plugin_runner_supervision.rs`
  - `/home/loidinh/WS/evcrate/plugin/backend/authorized-backend.cjs`
- **Lines analyzed:** ~2,800 lines (diff + context)
- **Updated plans:** `plans/260920-1603-plugin-platform/phase-03-authorized-api.md`

---

### Overall Assessment
Backend architecture cleanly isolates authorization, connection-bound epochs, and supervisor coordination. Defense-in-depth no-auth rejection, strict workspace target resolution via `WorkspaceTargetResolver`, payload ceiling enforcement, and integration tests (`plugin_api_integration`, `plugin_authorization`) verify the G1 contract with a real evcrate candidate package. However, critical blockers prevent full sign-off:
1. Static request IDs in worker context management race and drop concurrent requests.
2. `packages/ui/src/api/client.ts` plugin methods throw runtime errors due to missing endpoint mappings in `ws-transport.ts`.
3. Worker stderr is exposed in RPC failure responses, violating code standards.
4. Default-allow grant fallback violates explicit-grant-only requirement.
5. Epoch registry lacks eviction, causing unbounded memory growth.

---

### Critical Issues

1. **Static Request ID Collision in Concurrent Worker Operations**
   - **Location:** `server/src/plugins/worker_supervisor.rs:266, 297`
   - **Problem:** `sup.open_context()` hardcodes ID `"open-ctx"`, `sup.close_context()` hardcodes `"close-ctx"`. `WorkerProcess::pending_requests` maps ID to oneshot channel sender. Concurrent context openings/closings collide on identical ID, overwriting pending sender and dropping channel with `"Worker dropped response channel prematurely"`.
   - **Fix:** Use unique ID via `worker.generate_request_id()`.
     ```rust
     let req_id = worker.generate_request_id();
     let worker_res = worker.send_request(&req_id, "context.open", worker_params, Duration::from_secs(5)).await;
     ```

2. **Broken UI WsTransport Channel Mapping (Runtime Crash)**
   - **Location:** `packages/ui/src/api/client.ts:2658-2671` & `packages/ui/src/api/ws-transport.ts:1325`
   - **Problem:** `client.plugins` calls `transport.invoke("plugins:list?...")`, `"plugins:openContext"`, etc. `channelToEndpoint` in `ws-transport.ts` lacks all `plugins:*` cases, hitting `default: throw new Error("Unknown channel for WsTransport: " + channel)`. Any UI plugin call crashes immediately.
   - **Fix:** Add `plugins:*` channel mappings in `packages/ui/src/api/ws-transport.ts:channelToEndpoint()` mapping to `/api/plugins/...` endpoints.

3. **Information Disclosure: Worker Stderr Leaked in RPC Error Response**
   - **Location:** `server/src/plugins/worker_process.rs:238` & `server/src/api/plugins.rs:96`
   - **Problem:** `PluginError::worker_failed` formats `stderr_dump` into error message. `plugins.rs:plugin_error_response` serializes `err.message` to HTTP JSON response. Violates `docs/code-standards.md:105` ("Never put stderr, request bodies, credentials, or source paths in RPC responses") and leaks environment paths and internal diagnostics.
   - **Fix:** Keep `stderr_dump` in `tracing::error!` log only. Return sanitized generic error message:
     ```rust
     return Err(PluginError::worker_failed(format!("Worker handshake failed: {e}")));
     ```

4. **Default-Allow Grant Vulnerability for Unconfigured Actors**
   - **Location:** `server/src/plugins/authorization.rs:242-251`
   - **Problem:** When `self.grants.read().get(actor_subject)` is `None`, `verify_grant` returns `Ok(())`, permitting ungranted actors all operations on all installations and targets. Violates Requirement 6 and Requirement 147 ("This phase grants only explicit per-actor installation/target operations").
   - **Fix:** Fail closed when no grant exists:
     ```rust
     let Some(actor_grants) = grants_guard.get(actor_subject) else {
         return Err(PluginError::forbidden(format!("Actor '{actor_subject}' has no configured plugin grants")));
     };
     ```

---

### Warnings

1. **Unbounded Memory Leak in `EpochRegistry`**
   - **Location:** `server/src/plugins/authorization.rs:105-115`
   - **Problem:** `revoke_epoch` sets `is_valid = false`, never removing from `epochs` or `actor_index`. Under high connection turnover, memory grows indefinitely.
   - **Fix:** Remove revoked entries and clean up `actor_index`. Add TTL eviction sweep.

2. **HTTP Logout Does Not Invalidate Actor Epochs or Contexts**
   - **Location:** `server/src/api/auth.rs:379`
   - **Problem:** `POST /api/auth/logout` clears auth cookie but never calls `state.plugin_service.revoke_actor()`. Active WebSocket epochs and contexts remain usable post-logout until socket drop.
   - **Fix:** Extract actor in `logout` handler and call `state.plugin_service.revoke_actor(&actor.subject).await`.

3. **Tautological Plugin Visibility Filter in `list_plugins`**
   - **Location:** `server/src/plugins/api_service.rs:98-107`
   - **Problem:** `|| self.auth_service.epoch_registry().validate_epoch(0, &actor.subject).is_err()` is always true since epoch 0 is never valid. Bypasses visibility filter entirely, returning all plugins to any actor.
   - **Fix:** Provide non-epoch grant visibility helper:
     ```rust
     self.auth_service.has_actor_visibility(&actor.subject, &p.id, target_str)
     ```

4. **Dead Code: Unused `PluginRevoked` WebSocket Event**
   - **Location:** `server/src/api/ws_protocol.rs:503` & `packages/ui/src/api/plugin-types.ts:79`
   - **Problem:** Protocol variant declared but never emitted on context revocation or handled in UI transport. Clients never receive asynchronous revocation notices.

5. **Lock Contention on Every Invoke Validation**
   - **Location:** `server/src/plugins/authorization.rs:74`
   - **Problem:** `validate_epoch` acquires `RwLock::write` on every invoke validation to handle expiration. Serializes concurrent invokes server-wide.
   - **Fix:** Acquire `read()` lock first; upgrade/re-acquire `write()` only if expired (`now >= exp`).

6. **Missing Periodic Sweep for Expired Contexts**
   - **Location:** `server/src/main.rs` & `server/src/plugins/contexts.rs:285`
   - **Problem:** `cleanup_expired()` only runs lazily on insert/invoke. No background timer task in `main.rs` sweeps orphaned idle contexts.

7. **Hardcoded Machine Absolute Paths in Evcrate Backend and Integration Tests**
   - **Location:**
     - `/home/loidinh/WS/evcrate/plugin/backend/authorized-backend.cjs:16, 32`
     - `server/tests/plugin_api_integration.rs:533, 559, 588, 601, 607`
   - **Problem:** Hardcoded `/home/loidinh/WS/evcrate` will break in CI or other dev environments.
   - **Fix:** Resolve dynamically via `process.env.EVCRATE_ROOT` or relative path navigation.

---

### Suggestions

1. **Clippy Large Error Variant Optimization (`server/src/api/plugins.rs:103`)**
   - `check_no_auth` returns `Result<(), Response>` with 128+ byte error variant. Return `Option<Response>` or custom lightweight error.
2. **Context Table In-Flight Counter Optimization (`server/src/plugins/contexts.rs:138-142`)**
   - Track `worker_in_flight` as per-installation counter instead of summing across hashmap on every `begin_invoke`.
3. **Complete D03 Client Ownership Requirements:**
   - Add connection generation scoping in `packages/ui/src/api/query-client.ts`.
   - Wire plugin context cleanup to connection teardown in `packages/ui/src/api/connections.ts`.

---

### Positive Observations
- **Strict No-Auth Gating:** Multi-layered check across HTTP router middleware, route handlers, `api_service.rs`, and `authorization.rs` completely prevents bypass in `--no-auth` mode.
- **Authoritative Target Resolution:** Fully leverages `WorkspaceTargetResolver::resolve` to validate registered worktrees, preventing directory traversal and unregistered worktree fallback.
- **Source Immutability Defense:** `test_plugin_api_full_g1_lifecycle_and_immutability` and `test_real_evcrate_candidate_package_g1_snapshot_summary` verify byte-for-byte immutability, mtime preservation, and file size consistency on real evcrate assets.
- **Resource Limits:** Explicit request body size limits (`RequestBodyLimitLayer`) and concurrency ceilings (4/context, 16/worker) prevent worker starvation.

---

### Validation Commands & Results
1. `cargo test --manifest-path server/Cargo.toml --test plugin_authorization`:
   - **Result:** PASS (6 tests, 0 failures, 0.00s)
2. `cargo test --manifest-path server/Cargo.toml --test plugin_api_integration`:
   - **Result:** PASS (3 tests, 0 failures, 0.23s; real evcrate candidate G1 summary passes)
3. `cargo test --manifest-path server/Cargo.toml --test plugin_runner_supervision`:
   - **Result:** PASS (6 tests, 0 failures, 6.18s)
4. `cargo check --manifest-path server/Cargo.toml --tests`:
   - **Result:** PASS (0 compiler errors)
5. `pnpm --filter @dam-hopper/ui build`:
   - **Result:** PASS (TypeScript clean compile)

---

### Unresolved Questions
1. Is default-allow for unconfigured actors intended for initial development, or should production default-deny be strictly enforced immediately?
2. What canonical fallback path should `authorized-backend.cjs` use when running in standalone container or CI packaging without `/home/loidinh/WS/evcrate`?
