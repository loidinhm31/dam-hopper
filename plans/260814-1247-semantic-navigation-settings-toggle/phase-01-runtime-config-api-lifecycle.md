# Phase 01 — Runtime, config, and protected API

## Context links
- [Config schema](../../server/src/config/schema.rs) — `SemanticNavigationConfig`, `ServerConfig`, default false.
- [Config API/reload](../../server/src/api/config.rs) — active `config_path`, reload lock, current semantic invalidation gap.
- [Settings API](../../server/src/api/settings.rs) — protected settings handlers and atomic/cache patterns.
- [Router](../../server/src/api/router.rs) — protected route group; preserve authenticated semantic WS handler.
- [Supervisor](../../server/src/semantic/supervisor.rs) — immutable `enabled`, lifecycle generation/epoch, sessions, pending prewarm.
- [Registry/protocol](../../server/src/semantic/registry.rs) and [protocol](../../server/src/semantic/protocol.rs) — signed-bundle availability and stable reason enums.
- [Architecture](../../docs/system-architecture.md) semantic navigation sections; update before implementation.

## Overview/date/priority/status
- Date: 2026-08-14; priority: P2; status: completed (2026-08-14 15:28 +07:00).
- Replace supervisor's immutable enable gate with an atomic/runtime-reconfigurable gate and expose one narrow, protected workspace setting API.

## Key Insights
- `server.semantic.enabled` already owns the persisted field and defaults false; do not add a second preference or migration.
- Supervisor availability currently masks registry state when disabled. Capability inspection for Settings must read raw registry availability, not the masked `supervisor.availability`.
- Existing `invalidate_workspace` already drains sessions, cancels pending prewarm, clears pending admission, and advances fences. Reuse its cleanup semantics, but make enable/disable state changes live and observable.
- Full config reload currently invalidates but leaves the immutable supervisor flag stale; every config assignment/workspace switch must synchronize it.

## Requirements
- Add protected `GET/PATCH /api/settings/semantic-navigation`.
- Request: `{ "enabled": boolean }`; reject unknown/non-boolean fields with existing API error conventions.
- Response: `{ enabled: boolean, available: boolean, disabledReason: string | null }` where `enabled` is the persisted setting and `available` means at least one verified bundled Rust/TypeScript/JavaScript descriptor can run.
- Missing/invalid/unsupported bundle maps to a safe, clear reason; never include filesystem paths, commands, host PATH, or port details.
- PATCH `enabled:true` when unavailable returns conflict (`409`) with the same stable reason and does not modify TOML. PATCH false always succeeds and cleans stale runtime state.
- Mutate only `[server.semantic].enabled` in the active `config_path`; preserve all other TOML ownership/content via atomic write.
- Existing authenticated `/ws/semantic` and project trust/bundle safety remain unchanged.

## Architecture
1. Add a small runtime reconfiguration method on `SemanticSupervisor` backed by `Arc<AtomicBool>` (or equivalent lock already owned by the supervisor). Under `lifecycle_gate.write()` set the gate before admitting/cleaning work, advance lifecycle generation and workspace epoch, drain sessions, cancel/remove pending prewarm/admission entries, and emit `WorkspaceChanged` so all clients fence stale results. Keep process/resource caps and trust store unchanged.
2. Keep `invalidate_workspace()` as the workspace cleanup entry point, delegating to the same cleanup primitive with the current gate. Add a reconfigure path so config reload can apply the new bool once, not perform duplicate invalidations.
3. Add a capability summary that inspects raw registry descriptors for Rust, TypeScript, and JavaScript only. `Ready`/bundle-valid states make `available=true`; missing/invalid/unsupported states become stable user-facing messages. Java remains unsupported and does not make the global switch unavailable when other supported descriptors exist.
4. In the protected router, register GET/PATCH handlers (prefer existing `settings.rs` to avoid an unnecessary module). Serialize the current configured bool plus capability summary.
5. For PATCH, take `workspace_context_guard.write()`, read the current config path, validate capability for enabling, edit only the semantic TOML key, atomically write and re-read, reconfigure the supervisor, then publish the new in-memory config. Restore the old TOML if re-read/reconfigure fails. No sandbox/media reset is needed for this single field.
6. Update `config.rs` reload and workspace-switch paths to call the same supervisor reconfigure/sync method using the newly loaded `server.semantic.enabled`; retain existing workspace fencing for all other config changes.

## Related code files
- Modify: `server/src/semantic/supervisor.rs`, `server/src/api/settings.rs`, `server/src/api/router.rs`, `server/src/api/config.rs`, `server/src/api/workspace.rs` if switch logic bypasses `reload_config`.
- Modify tests: `server/src/api/tests.rs`, `server/src/config/tests.rs`, supervisor unit tests, `server/tests/ws_semantic_navigation.rs`.
- Create no new backend module unless existing module boundaries make the route unmaintainable.

## Implementation Steps
1. Define the API DTO and stable reason mapping; document that it is aggregate capability, not project trust.
2. Change the supervisor gate to atomic and replace all direct bool checks with `is_enabled()`.
3. Extract shared lifecycle cleanup; implement idempotent runtime reconfigure with generation/epoch fencing and event emission.
4. Ensure disable sets the gate false before cleanup; enable checks capability, sets the gate, fences old clients, and allows only post-event admissions.
5. Implement atomic active-TOML patch with typed body validation, safe error mapping, and rollback.
6. Wire protected routes and synchronize reload/workspace-switch state without broad PUT semantics.
7. Update architecture doc during `/code` before implementation, including toggle state transitions and data flow.

## Todo list
- [x] Mutable gate and shared cleanup primitive.
- [x] Raw bundle capability summary and stable reason text.
- [x] Protected GET/PATCH route and active TOML patch.
- [x] Reload/workspace-switch synchronization.
- [x] Architecture doc update before code.

## Success Criteria
- Fresh/missing `server.semantic` loads as false.
- GET reports false plus actionable unavailable reason when no signed supported bundle exists.
- Valid signed bundle permits PATCH true; false/true changes take effect without restart.
- PATCH never writes global config, project config, or unrelated TOML keys.
- Disable cannot leak sessions, prewarm admissions, or late results across a generation/epoch boundary.

## Risk Assessment
- TOML write/reload failure could desynchronize disk and memory; mitigate with atomic write, re-read, and restore-on-failure.
- Duplicate lifecycle events during reload could cause reconnect churn; centralize cleanup and call it once per config transition.
- Existing workspace switch may have a separate invalidation path; trace and test both direct switch and config reload.

## Security Considerations
- Keep endpoint in protected router; do not make capability details a public route.
- Preserve semantic WS authentication/origin checks and project trust checks.
- Do not invoke host executables or inspect PATH; only verified release bundle registry state controls availability.
- Use stable bounded reason text; do not expose bundle paths, command lines, workspace paths, or secrets.

## Completion record
- **Completed:** 2026-08-14 15:28 +07:00.
- **Evidence:** protected API/router, raw signed-bundle capability summary, active-TOML persistence/rollback, mutable supervisor gate, reload/workspace synchronization; `cargo fmt --check`, `cargo check`, and focused Rust tests passed.
- **Residuals:** TOML comments/trivia may be rewritten by the current serializer; availability may remain stale after bundle mutation.

## Next steps
- Phase 02 consumes the exact response and mutation contract.
- Phase 03 verifies event-loop/client fences and live editor behavior.
