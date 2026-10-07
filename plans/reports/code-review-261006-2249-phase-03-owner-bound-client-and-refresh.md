# Code Review: Phase 03 — Owner-Bound Client and Refresh

**Review Date:** 2026-10-06  
**Reviewer:** Phase03Reviewer  
**Score:** 9.0/10  
**Status:** Approved with non-blocking warnings  

---

## Scope

### Files Reviewed
- `packages/ui/src/api/project-plans-types.ts` (269 LOC)
- `packages/ui/src/api/project-plans-queries.ts` (333 LOC)
- `packages/ui/src/hooks/use-project-plans.ts` (515 LOC)
- `packages/ui/src/api/client.ts` (+83 lines, -13 lines)
- `packages/ui/src/api/ws-transport.ts` (+60 lines)
- `packages/ui/src/api/project-plans-queries.test.ts` (399 LOC)
- `packages/ui/src/hooks/use-project-plans.test.tsx` (488 LOC)

### Approximate LOC Analyzed
~2,150 LOC

### Review Focus
Security, performance, architecture, YAGNI/KISS/DRY, contract alignment (`contracts.md` & `phase-03-owner-bound-client-and-refresh.md`).

### Updated Plans
- `plans/261006-1653-project-plans-dashboard/phase-03-owner-bound-client-and-refresh.md` (Implementation status: complete; Review status: complete; 5/5 todo items verified `[x]`).

---

## Overall Assessment
Phase 03 implementation is well-architected and aligns with frozen contracts (`contracts.md` §§ 2, 4, 7). Tenant isolation and generational fencing are enforced across both network fetchers and hook lifecycles. Decoders validate shapes runtime-side. React Query keys incorporate full generational and target tuples to avoid cross-tenant cache contamination. Zero regressions introduced; 100% test pass rate across unit, integration, and browser suites. 0 TypeScript compiler errors.

Two non-blocking warnings identified regarding watch set lifecycle teardown during in-session browsing and initial post-attach double fetching.

---

## Critical Issues
None.

---

## Warnings (High / Medium Priority)

### 1. Watch set teardown on navigation circumvents differential "Add before remove" reconciliation
- **File / Lines:** `packages/ui/src/hooks/use-project-plans.ts:436-446`
- **Impact:** Medium-High (Network/WebSocket churn & temporary coverage gap)
- **Description:** `useEffect` stores `activeSubs` in a function-local closure and lists `desiredWatchPaths` (and `normalizedBrowse`) in its dependency array. `desiredWatchPaths` is an array allocated by `useMemo`. Whenever navigation occurs or query responses update `watchPaths`, the effect teardown executes:
  ```ts
  for (const [, sub] of activeSubs) {
    sub.cleanupEvent();
    sub.cleanupOverflow();
    seam.fsUnsubscribeTree?.(sub.subId);
  }
  activeSubs.clear();
  ```
  The newly invoked effect starts with an empty `activeSubs` map. As a result, `reconcileWatches` evaluates `toAdd = targetPaths` and `toRemove = []`. While `toAdd` runs before `toRemove` inside `reconcileWatches`, the effect boundary already executed "Remove ALL before adding ANY" on the underlying transport.
- **Contract Reference:** `contracts.md` § 7: *"Folder navigation changes the watch chain, not all listed child subscriptions. Add before remove; cap registrations at 8, churn passes 3."*
- **Recommendation:** Retain `activeSubs` across browsing navigation using a `useRef` scoped to the current `owner`/`target`/`enabled` session. Reconcile differentially within that session. Only perform full unsubscription when owner, target, plan selection, or enabled status changes. Additionally, stabilize `desiredWatchPaths` dependency with serialized string key (e.g. `desiredWatchPaths.join(";")`).

### 2. Double query fetch on initial component mount
- **File / Lines:** `packages/ui/src/hooks/use-project-plans.ts:412-414`
- **Impact:** Low-Medium (Redundant initial network roundtrip)
- **Description:** On component mount, `usePlanFoldersQuery` or `useSelectedPlanQuery` initiates its initial fetch. Concurrently, `useEffect` mounts and registers the initial watch set (`.` and `plans`). Once registered, `toAdd.length > 0` evaluates to true, triggering `invalidateActiveQueries()`. TanStack Query promptly issues a second fetch while the initial fetch is completing.
- **Recommendation:** Guard post-attach invalidation to skip invalidating queries that were already scheduled or have not yet settled from initial mount, or invalidate only for subsequent additions after initial watch set establishment.

---

## Suggestions (Low Priority)

1. **Replace `window.setTimeout` with `setTimeout` / `globalThis.setTimeout`**
   - **File / Lines:** `packages/ui/src/hooks/use-project-plans.ts:303`
   - **Context:** `window.setTimeout` assumes DOM global `window`. Direct `setTimeout` or `globalThis.setTimeout` avoids potential runtime errors in SSR, worker, or Node testing environments.

2. **Add error barrier around `atob` base64 decoding**
   - **File / Lines:** `packages/ui/src/api/project-plans-queries.ts:130-137`
   - **Context:** `atob` throws generic `DOMException` ("InvalidCharacterError") on malformed base64. Wrapping with try/catch and re-throwing `ApiRequestError` gives clearer debugging telemetry if server document payload is corrupted.

3. **Tighten type guards on `PlanFoldersResponse` and `SelectedPlanResponse`**
   - **File / Lines:** `packages/ui/src/api/project-plans-types.ts:212-255`
   - **Context:** Guards verify object keys but omit string non-emptiness for `plan.id` or `val.kind` union membership (`collection` | `group` | `plan`).

---

## Positive Observations
- **Double-Fenced Generational Ownership:** `assertOwnerActive(owner)` is checked both before initiating network requests and immediately after `await` resolves. Stale generation or disconnected socket throws `ConnectionOwnerError("stale")` before payload decoding.
- **Late Subscription Cancellation:** Disposed effect tracking immediately unsubscribes late-resolving `fsSubscribeTree` promises on originating transport (`seam.fsUnsubscribeTree(subId)`), satisfying Acceptance Criterion A10.
- **Filesystem Churn Clamping:** Rate limiting halts automatic reconciliation after 3 passes (`MAX_CHURN_RECONCILE_PASSES = 3`), setting coverage to `"degraded"` and requiring user manual `refresh()`.
- **Clean Transport Seam Extension:** Narrowly extended `FsTransportSeam` and `WsTransport` with `watchOnly: true` and `mode: "plan-document"` without touching existing IDE file explorer behaviors.
- **Zero Test Regressions:** All 2,347 existing UI unit tests and 258 browser tests continue to pass cleanly.

---

## Validation Commands and Results

| Command | Status | Output / Details |
|---|---|---|
| `pnpm --filter @dam-hopper/ui test src/api/project-plans-queries.test.ts src/hooks/use-project-plans.test.tsx` | PASS | 2 test files, 22 passed, 0 failed (776ms) |
| `pnpm --filter @dam-hopper/ui build` | PASS | `tsc -p tsconfig.json` exit code 0, 0 type errors |
| `pnpm --filter @dam-hopper/ui test` | PASS | 304 test files, 2,347 passed, 0 failed (17.39s) |

---

## Unresolved Questions
None.
