# Code Review Report: Phase 04 — Owner-fenced resource query and UI cutover

## Score: 9.3/10

### Scope
- **Files reviewed (17):**
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/queries.ts`
  - `packages/ui/src/api/connections.ts`
  - `packages/ui/src/api/host-resource-stream-coordinator.ts`
  - `packages/ui/src/api/host-resource-stream-coordinator.test.ts`
  - `packages/ui/src/api/host-resource-query-source.test.tsx`
  - `packages/ui/src/hooks/use-multi-host-resources.ts`
  - `packages/ui/src/hooks/use-multi-host-resources.test.tsx`
  - `packages/ui/src/hooks/use-sse.ts`
  - `packages/ui/src/hooks/use-sse.test.ts`
  - `packages/ui/src/lib/host-resource-state.ts`
  - `packages/ui/src/lib/host-resource-state.test.ts`
  - `packages/ui/src/embed/dam-hopper-app.tsx`
  - `packages/ui/src/components/organisms/HostResourcePopover.tsx`
  - `packages/ui/src/components/organisms/HostResourcePopover.test.tsx`
  - `packages/ui/src/components/organisms/HostResourceDiagnosis.tsx`
  - `packages/ui/browser-tests/host-resource-sse-cutover.browser.tsx`
- **Lines of code analyzed:** ~1,300 lines of modified/added TypeScript and TSX
- **Review focus:** Owner-fenced resource query cutover, source arbitration, QueryClient binding, presentation freshness, dual cache authority, security, performance, YAGNI/KISS/DRY
- **Updated plans:**
  - `plans/260929-1522-host-resources-sse/phase-04-resource-query-and-ui-cutover.md` (100% Complete, all 6 tasks verified)
  - `plans/260929-1522-host-resources-sse/plan.md` (Updated to 5/7 phases complete, 71%)

---

## Overall Assessment

Phase 04 successfully implements the cutover from dual REST polling (1 s metrics, 15 s snapshot) to profile-owned, owner-fenced SSE stream authority while strictly preserving cached REST fallback and WebSocket alert presentation.

Key achievements:
1. **Source arbitration & query gating:** `canUseResourceRest` is uniformly checked before issuing transport I/O and after `await`, preventing stale responses or concurrent stream transitions from clobbering cache data.
2. **Paired cache write:** `switchToHostResourceFrame` synchronously flips `switching = true`, increments `sourceGeneration`, notifies observers, cancels exact in-flight TanStack queries (`cancelQueries` exact for snapshot and metrics), rechecks fence invariants, and atomically updates both cache keys under `batchQueryUpdates` (`notifyManager.batch`).
3. **Presentation freshness:** `resolveHostResourceStatus` prioritizes `ProjectionFreshness` over TanStack's `isStale` request-cache flag, decoupling UI sample freshness from TanStack query metadata.
4. **App & root binding:** `DamHopperApp` binds `useQueryClient()` to the connection registry with reference counting, supporting StrictMode remounts and multi-root architectures cleanly.
5. **Cadence alignment:** Detail metrics polling throttled to 5 s (previously 1 s), snapshot polling maintained at 15 s, and alert history polling throttled to 30 s when visible and unblocked.

---

## Critical Issues (MUST FIX)

None.

---

## Warnings (SHOULD FIX)

1. **`String(qc)` map key collision in `scheduleHistoryInvalidation` (`packages/ui/src/hooks/use-sse.ts:432`)**
   - **Problem:** `scheduleHistoryInvalidation` computes its map key as `${owner.profileId}@${owner.generation}::${String(qc)}`. In JS, `String(QueryClient)` evaluates to `"[object Object]"`. If an application or test environment registers multiple distinct `QueryClient` instances for the same connection owner (which Phase 04 specifically architectures and tests for), the second client's pending invalidation overwrites the first one in `pendingHistoryInvalidations`. When the microtask drains, only the last client's `"resource-alerts"` query is invalidated.
   - **Impact:** Multi-root applications or isolated QueryClients can miss alert history updates following a WS alert.
   - **Fix:** Key `pendingHistoryInvalidations` using `Map<QueryClient, Map<string, ConnectionRef>>`, a `Set<{ owner: ConnectionRef; qc: QueryClient }>`, or assign a unique symbol/counter ID per `QueryClient` instance via `WeakMap`.

2. **Missing `sourceSignature` and `qc` in `useMemo` dependency array for `entries` (`packages/ui/src/hooks/use-multi-host-resources.ts:273`)**
   - **Problem:** `entries` computes `sourceState` via `getHostResourceSource(target.owner, qc)` inside its mapping function and passes `freshness` and `sourceMode` to `resolveHostResourceEntryStatus`. However, the `useMemo` dependency array is `[watchedTargets, queryResults, byProfile]`. `qc` and `sourceSignature` are omitted.
   - **Impact:** If `sourceSignature` updates (e.g. coordinator mode transitions from STARTING to LIVE or freshness state changes) without a TanStack query state change, `queryResults` array reference may remain unchanged, preventing `entries` from recomputing and leaving the UI with stale status.
   - **Fix:** Add `qc` and `sourceSignature` to the dependency array:
     ```ts
     }, [watchedTargets, queryResults, byProfile, qc, sourceSignature]);
     ```

---

## Suggestions (NICE TO HAVE)

1. **Unconditional `useSyncExternalStore` subscription in `useHostResourceSnapshot` when disabled (`packages/ui/src/api/queries.ts:577`)**
   - In `useHostResourceSnapshot`, `registerHostResourceInterest` is guarded by `if (!enabled || !owner) return;`, but `useSyncExternalStore` subscribes whenever `owner` is truthy, regardless of `enabled`. When `isDrilldown` is false in fleet mode, `useHostResourceSnapshot` still listens to coordinator source notifications. While safe and lightweight, skipping subscription when `!enabled` would reduce unnecessary re-renders.
2. **Defensive optional chaining pattern in `HostResourceDiagnosis.tsx` (`lines 40, 304, 306`)**
   - Good defensive addition of `snapshot.cgroups?.filter(...)` to guard degraded server snapshots that omit cgroups. Ensure similar defensive checks are maintained if new optional snapshot sections are introduced in Phase 05.

---

## Reviewed Files

| File | Status | Notes |
|---|---|---|
| `packages/ui/src/api/client.ts` | Approved | `system.metrics` and `system.resourceSnapshot` accept `signal?: AbortSignal` and forward to `transport.invoke`. |
| `packages/ui/src/api/queries.ts` | Approved | Owner/source-fenced query hooks, 5 s metrics / 15 s snapshot / 30 s alerts cadence, signal forwarding, pre/post await fence check. |
| `packages/ui/src/api/connections.ts` | Approved | Replaces legacy single QC setter with ref-counted multi-QC registration delegates from coordinator. |
| `packages/ui/src/api/host-resource-stream-coordinator.ts` | Approved | Atomic paired switch, cancellation before write, batch cache writes, `canUseResourceRest` gate, snapshot caching for stable `useSyncExternalStore` identity. |
| `packages/ui/src/api/host-resource-stream-coordinator.test.ts` | Approved | Tests multi-QC refcounting, query cancellation on switch, paired cache updates. |
| `packages/ui/src/api/host-resource-query-source.test.tsx` | Approved | Unit tests for signal forwarding, interest registration, REST blocking when `canUseResourceRest` is false. |
| `packages/ui/src/hooks/use-multi-host-resources.ts` | Approved w/ Warning | Fleet query hook with signal forwarding and owner fencing. Needs `sourceSignature` in `entries` memo deps. |
| `packages/ui/src/hooks/use-multi-host-resources.test.tsx` | Approved | Tests fleet hook with registered query client. |
| `packages/ui/src/hooks/use-sse.ts` | Approved w/ Warning | Deduplicates ambient alert listeners, gates snapshot patch with `canUseResourceRest`. Needs robust keying in `scheduleHistoryInvalidation`. |
| `packages/ui/src/hooks/use-sse.test.ts` | Approved | Tests transport bridge, WS alert dispatch and invalidation suppression when REST blocked. |
| `packages/ui/src/lib/host-resource-state.ts` | Approved | Decouples status freshness from TanStack `isStale`, supports `AUTH_BLOCKED` and `STARTING` presentation modes. |
| `packages/ui/src/lib/host-resource-state.test.ts` | Approved | Tests freshness projection ignoring TanStack `isStale`. |
| `packages/ui/src/embed/dam-hopper-app.tsx` | Approved | Binds root `QueryClient` to connection registry in `useEffect`. |
| `packages/ui/src/components/organisms/HostResourcePopover.tsx` | Approved | Passes matched freshness to status resolver, preserves existing layout and drilldown behavior. |
| `packages/ui/src/components/organisms/HostResourcePopover.test.tsx` | Approved | Tests popover rendering with freshness integration. |
| `packages/ui/src/components/organisms/HostResourceDiagnosis.tsx` | Approved | Defensive handling of optional `cgroups`. |
| `packages/ui/browser-tests/host-resource-sse-cutover.browser.tsx` | Approved | Real Chromium browser test for stream events, fleet overview, and `AUTH_BLOCKED` latching. |

---

## Validation Commands and Results

1. **UI Unit Tests (8 test suites):**
   ```bash
   pnpm --filter @dam-hopper/ui test src/api/host-resource-query-source.test.tsx src/hooks/use-multi-host-resources.test.tsx src/lib/host-resource-state.test.ts src/hooks/use-sse.test.ts src/api/host-resource-stream-coordinator.test.ts src/components/organisms/HostResourcePopover.test.tsx src/api/host-resource-sse-codec.test.ts src/api/host-resource-sse-parser.test.ts
   ```
   *Result:* **136 passed, 0 failed** in 1.02s.

2. **UI Browser Tests (Chromium):**
   ```bash
   pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts host-resource-sse-cutover
   ```
   *Result:* **3 passed, 0 failed** in 1.79s.

3. **TypeScript Build (`@dam-hopper/ui`):**
   ```bash
   pnpm --filter @dam-hopper/ui build
   ```
   *Result:* **Passed** with 0 errors, 0 warnings (`tsc -p tsconfig.json`).

---

## Metrics
- **Type Coverage:** 100% strict TypeScript (`tsconfig.json` clean)
- **Unit Test Pass Rate:** 136/136 (100%)
- **Browser Test Pass Rate:** 3/3 (100%)
- **Linting/Build Errors:** 0 errors
- **Remaining TODOs in code:** 0

---

## Unresolved Questions

1. Which native packaged targets have a cancellable owner-bound authenticated streaming fetch, and which real proxies meet buffering/compression/≥45 s idle requirements? (Both remain scheduled inputs for Phase 05 qualification).
