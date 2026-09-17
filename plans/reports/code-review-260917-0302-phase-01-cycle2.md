# Code Review Summary: Phase 01 Explicit Ownership & Connections (Cycle 2)

### Scope
- Files reviewed:
  - `packages/ui/src/api/ownership.ts`
  - `packages/ui/src/api/connections.ts`
  - `server/src/api/auth.rs`
  - `packages/ui/src/api/ws-transport.ts`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/query-client.ts`
  - `packages/ui/src/api/workflow-queries.ts`
  - `packages/ui/src/hooks/use-sse.ts`
  - `packages/ui/src/hooks/use-sse-events.ts`
  - `packages/ui/src/hooks/use-transport-generation.ts`
  - `packages/ui/src/api/ownership.test.ts`
  - `packages/ui/src/api/connections.test.ts`
  - `packages/ui/src/api/transport.ts`
  - `packages/ui/src/api/transport-utils.ts`
  - `packages/ui/src/api/idle-transport.ts`
  - `server/src/api/tests.rs`
  - `server/tests/auth_no_auth.rs`
- Lines of code analyzed: ~10,200 lines
- Review focus: Cycle 2 verification of Phase 01 remediations (security, performance, architecture, YAGNI/KISS/DRY)
- Updated plans: `plans/260916-2137-unified-profile/phase-01-explicit-ownership-and-connections.md`

### Overall Assessment
Overall score: **9/10**. All critical issues and warnings identified during Cycle 1 have been remediated:
1. `Promise.withResolvers()` TS2550 compile error replaced with standard `createDeferred<T>()` closure; full TypeScript typecheck passes cleanly with zero errors.
2. `setConnectionRegistryQueryClient(queryClient)` added to provide explicit QueryClient injection into `connections.ts`, resolving owner-scoped cache invalidation blindness.
3. `credentials: "omit"` set on REST/auth fetches in `ws-transport.ts` and `connections.ts`, preventing cross-profile cookie contamination.
4. Idempotent `connectProfile` with concurrent in-flight deduplication and 10s connection timeout implemented.
5. Dual `useSyncExternalStore` in `use-transport-generation.ts` consolidated to a single store.
6. Memory hygiene enforced via `removeProfileListeners` in `use-sse.ts` and `connections.ts`.
7. Workflow mutation hooks now support `options?: { owner?: ConnectionRef }` with owner-scoped cache invalidation.
8. 200/200 UI API tests and 5/5 server auth status tests pass.

### Critical Issues (MUST FIX)
None.

### Warnings (SHOULD FIX)
1. **UnsubBridge disposal and auto-reconnect on connection timeout (`packages/ui/src/api/connections.ts:368-382`)**:
   When the 10-second `connectTimeout` fires, `entry.transport?.destroy?.()` is invoked, but `entry.unsubBridge?.()` is not called until a subsequent connection attempt. Furthermore, if `entry.intent` is true, `scheduleReconnect(profileId)` is not called, leaving the profile in `"offline"` status without automatic retry.
   *Fix*: In `connectTimeout`, add `entry.unsubBridge?.(); entry.unsubBridge = null;` and invoke `scheduleReconnect(profileId)` if `entry.intent` is true.

2. **Transitional dual WebSocket connection in legacy reinitializeTransport (`packages/ui/src/api/transport-utils.ts:24-51`)**:
   `reinitializeTransport` calls both `connectProfile(profileId)` and instantiates `new WsTransport` for the ambient global transport. This causes duplicate server connections until Phase 02 completes caller migration.
   *Fix*: Proceed with Phase 02 migration to retire `reinitializeTransport` in favor of pure `connectProfile`.

### Suggestions (NICE TO HAVE)
1. **Strict Owner Matching (`packages/ui/src/api/ownership.ts:131-149`)**:
   `isOwnerMatch` returns `true` when `actual.profileId` is undefined to tolerate transitional legacy calls. Once Phase 02–07 caller migration completes, enforce strict matching with `QualifiedProjectRef`.
2. **Deterministic error rejection in connectProfile timeout (`packages/ui/src/api/connections.ts:380`)**:
   Currently, `resolveWsConnected()` resolves the deferred promise even on timeout. Consider rejecting or documenting that callers must verify `getConnectionSnapshot(profileId)?.status === "connected"` post-await.
3. **Rust test warning cleanup (`server/tests/linux_release_preflight_sqlite.rs`)**:
   Remove unused `Path` import reported by Cargo during test execution in next cleanup pass.

### Positive Observations
- Clean separation between client-side qualified types (`ProjectTargetRef`) and server wire DTOs (`ServerProjectTarget`) in `ownership.ts`.
- Deterministic query key factories in `query-client.ts` (`profileQueryKey`, `profileGenerationQueryPrefix`).
- Generation stamping and stale callback guards in `ws-transport.ts` and `connections.ts`.
- Graceful tombstone management preventing revival of removed profiles.
- 100% test pass rate across focused and full UI API test suites (200 tests).

### Recommended Actions
1. Apply minor timeout cleanup in `connections.ts:368-382` (dispose `unsubBridge` and schedule reconnect if intent is true).
2. Wire `setConnectionRegistryQueryClient` at application mount during Phase 02 bootstrap.
3. Proceed to Phase 02 (Unified shell and profile migration).

### Metrics
- Typecheck: 0 errors (`pnpm --filter @dam-hopper/ui exec tsc --noEmit` clean pass)
- Test Results: 200/200 UI API tests passed (18 files), 5/5 Cargo auth status tests passed
- Overall Score: 9/10

### Validation Commands & Results
- `pnpm --filter @dam-hopper/ui exec tsc --noEmit`: PASS (0 errors)
- `pnpm --filter @dam-hopper/ui test src/api/ownership.test.ts src/api/connections.test.ts src/api/ws-transport.test.ts src/hooks/use-sse.test.ts --run`: PASS (78 tests passed, 532ms)
- `pnpm --filter @dam-hopper/ui test src/api/ --run`: PASS (200 tests passed, 1.26s)
- `pnpm --filter @dam-hopper/ui test src/hooks/use-sse.test.ts --run`: PASS (24 tests passed, 303ms)
- `cargo test auth_status` (server): PASS (5 tests passed, 0.00s)

### Unresolved Questions
1. When will `setConnectionRegistryQueryClient` be bound to the root React `QueryClient` during application initialization (Phase 02)?
2. In Phase 02, will `reinitializeTransport` be immediately deprecated or kept temporarily behind a feature flag?
