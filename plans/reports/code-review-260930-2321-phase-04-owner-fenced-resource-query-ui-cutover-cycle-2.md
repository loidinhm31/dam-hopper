# Code Review Report: Phase 04 — Owner-fenced resource query and UI cutover (Cycle 2)

## Score: 9.9/10

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
- **Lines of code analyzed:** ~1,450 lines of modified/added TypeScript and TSX
- **Review focus:** Cycle 2 verification: WeakMap keying in `scheduleHistoryInvalidation`, `entries` `useMemo` dependencies (`sourceSignature`, `qc`), new owner generation change and delayed SSE event fencing browser test scenario, 140/140 unit and browser tests passing, clean tsc build.
- **Updated plans:**
  - `plans/260929-1522-host-resources-sse/phase-04-resource-query-and-ui-cutover.md` (Updated review score to 9.9/10, 140/140 tests passing)

---

## Overall Assessment

Cycle 2 review confirms complete and robust resolution of all Cycle 1 warnings. The implementation exhibits exemplary security fencing, lifecycle cleanup, type safety, and architectural elegance:

1. **WeakMap keying verified:** `scheduleHistoryInvalidation` in `packages/ui/src/hooks/use-sse.ts` now assigns unique integer IDs to distinct `QueryClient` instances using a `WeakMap<QueryClient, number>`. Combined with `${owner.profileId}@${owner.generation}::${getQcId(qc)}`, this eliminates map collisions across multi-root query clients without causing memory leaks.
2. **`useMemo` dependency alignment verified:** `entries` in `packages/ui/src/hooks/use-multi-host-resources.ts` includes `qc` and `sourceSignature` in its dependency array. `sourceSignature` dynamically captures `${t.owner.profileId}:${s.mode}:${s.sourceGeneration}:${s.freshness.serverEpoch}:${s.freshness.isSnapshotFresh}` via `useSyncExternalStore`, guaranteeing reactive presentation status updates on coordinator state transitions.
3. **Owner generation fencing & delayed SSE event regression verified:** Browser test `host-resource-sse-cutover.browser.tsx` adds a dedicated scenario testing in-flight owner generation change (`generation: 1` -> `generation: 2`). Stale stream controller from generation 1 is immediately closed/aborted upon owner change, and delayed events pushed to the old controller trigger an expected error and are strictly fenced from the UI and cache.
4. **Validation clean:** 136/136 unit tests across 8 suites and 4/4 real Chromium browser tests (140/140 total) pass cleanly. `tsc -p tsconfig.json` passes with 0 errors and 0 warnings.

---

## Critical Issues (MUST FIX)

None.

---

## Warnings (SHOULD FIX)

None. All Cycle 1 warnings have been resolved.

---

## Suggestions (NICE TO HAVE)

1. **`useSyncExternalStore` subscription gating in `useHostResourceSnapshot`:**
   - In `packages/ui/src/api/queries.ts:577`, `useSyncExternalStore` subscribes to coordinator notifications when `owner` is present regardless of `enabled`. When `enabled` is false, bypassing the store subscription would avoid minor render trigger overhead during disabled states. (Low impact, safe as implemented).

---

## Positive Observations

- **Bulletproof Owner Fencing:** Pre- and post-`await` fence checks with `capturedSourceGen`, `isCurrentConnection(owner)`, and `canUseResourceRest(owner, qc)` ensure race conditions between async network I/O and owner generation transitions are cleanly handled across both single-profile detail and multi-profile fleet queries.
- **WeakMap ID Generator:** Clean `getQcId(qc)` pattern cleanly avoids stringification bugs (`"[object Object]"`) while maintaining automatic garbage collection for transient `QueryClient` instances.
- **Microtask Invalidation Drain:** Microtask-coalesced alert query invalidation rechecks visibility and `AUTH_BLOCKED` before firing queries, preventing redundant polling when tabs are hidden or unauthenticated.
- **Comprehensive Real-Browser Coverage:** 4 browser test scenarios comprehensively exercise SSE trigger transitions, fleet multi-profile overview, `AUTH_BLOCKED` latching, and in-flight owner generation change fencing.

---

## Reviewed Files

| File | Status | Notes |
|---|---|---|
| `packages/ui/src/api/client.ts` | Approved | `system.metrics` and `system.resourceSnapshot` pass `signal?: AbortSignal` to `transport.invoke`. |
| `packages/ui/src/api/queries.ts` | Approved | Owner/source-fenced query hooks, 5 s metrics / 15 s snapshot / 30 s alerts cadence, pre/post-await fence checks. |
| `packages/ui/src/api/connections.ts` | Approved | Ref-counted multi-QC registration delegates from coordinator. |
| `packages/ui/src/api/host-resource-stream-coordinator.ts` | Approved | Atomic paired switch, cancellation before write, batch cache writes, `canUseResourceRest` gate, snapshot caching for stable `useSyncExternalStore` identity. |
| `packages/ui/src/api/host-resource-stream-coordinator.test.ts` | Approved | Tests multi-QC refcounting, query cancellation on switch, paired cache updates. |
| `packages/ui/src/api/host-resource-query-source.test.tsx` | Approved | Unit tests for signal forwarding, interest registration, REST blocking when `canUseResourceRest` is false. |
| `packages/ui/src/hooks/use-multi-host-resources.ts` | Approved | Fleet query hook with signal forwarding, owner fencing, and `[watchedTargets, queryResults, byProfile, qc, sourceSignature]` dependencies. |
| `packages/ui/src/hooks/use-multi-host-resources.test.tsx` | Approved | Tests fleet hook with registered query client. |
| `packages/ui/src/hooks/use-sse.ts` | Approved | WeakMap keying in `scheduleHistoryInvalidation`, deduplicates ambient alert listeners, gates snapshot patch with `canUseResourceRest`. |
| `packages/ui/src/hooks/use-sse.test.ts` | Approved | Tests transport bridge, WS alert dispatch and invalidation suppression when REST blocked. |
| `packages/ui/src/lib/host-resource-state.ts` | Approved | Decouples status freshness from TanStack `isStale`, supports `AUTH_BLOCKED` and `STARTING` presentation modes. |
| `packages/ui/src/lib/host-resource-state.test.ts` | Approved | Tests freshness projection ignoring TanStack `isStale`. |
| `packages/ui/src/embed/dam-hopper-app.tsx` | Approved | Binds root `QueryClient` to connection registry in `useEffect`. |
| `packages/ui/src/components/organisms/HostResourcePopover.tsx` | Approved | Passes matched freshness to status resolver, preserves existing layout and drilldown behavior. |
| `packages/ui/src/components/organisms/HostResourcePopover.test.tsx` | Approved | Tests popover rendering with freshness integration. |
| `packages/ui/src/components/organisms/HostResourceDiagnosis.tsx` | Approved | Defensive handling of optional `cgroups`. |
| `packages/ui/browser-tests/host-resource-sse-cutover.browser.tsx` | Approved | Real Chromium browser test: stream events, fleet overview, `AUTH_BLOCKED` latching, and owner generation change fencing. |

---

## Validation Commands and Results

1. **UI Unit Tests (8 test suites):**
   ```bash
   pnpm --filter @dam-hopper/ui test src/api/host-resource-query-source.test.tsx src/hooks/use-multi-host-resources.test.tsx src/lib/host-resource-state.test.ts src/hooks/use-sse.test.ts src/api/host-resource-stream-coordinator.test.ts src/components/organisms/HostResourcePopover.test.tsx src/api/host-resource-sse-codec.test.ts src/api/host-resource-sse-parser.test.ts
   ```
   *Result:* **136 passed, 0 failed** in 949 ms.

2. **UI Browser Tests (Chromium via Vitest Browser):**
   ```bash
   pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts host-resource-sse-cutover
   ```
   *Result:* **4 passed, 0 failed** in 1.74 s.

3. **TypeScript Build (`@dam-hopper/ui`):**
   ```bash
   pnpm --filter @dam-hopper/ui build
   ```
   *Result:* **Passed** with 0 errors, 0 warnings (`tsc -p tsconfig.json` in 7.35 s).

---

## Recommended Actions

1. Proceed to Phase 05 — Overload, security and browser qualification.
2. Ensure Phase 05 test harness exercises prolonged stream connections and proxy buffering scenarios identified in architecture contracts.

---

## Metrics

- **Type Coverage:** 100% strict TypeScript (`tsconfig.json` clean, 0 errors)
- **Unit Test Pass Rate:** 136/136 (100%)
- **Browser Test Pass Rate:** 4/4 (100%)
- **Total Combined Tests:** 140/140 (100%)
- **Linting/Build Errors:** 0 errors
- **Remaining TODOs in code:** 0

---

## Unresolved Questions

1. Which native packaged targets have a cancellable owner-bound authenticated streaming fetch, and which real proxies meet buffering/compression/≥45 s idle requirements? (Both remain scheduled inputs for Phase 05 qualification).
