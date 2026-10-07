# Research Report: PR #49 Client Lifecycle, Query Cache & Markdown Safety

**Date**: 2026-10-07 | **Context**: PR #49 Native Read-Only Project Plans Dashboard
**Target Files**: `packages/ui/src/hooks/use-project-plans.ts`, `packages/ui/src/api/project-plans-queries.ts`, `packages/ui/src/components/organisms/MarkdownPreview.tsx`

---

## 1. External Primary Sources & Citations

1. **TanStack Query v5 — Disabling Queries**
   - *Citation*: https://tanstack.com/query/v5/docs/framework/react/guides/disabling-queries
   - *Invariants*: `enabled: false` queries ignore `invalidateQueries` and `refetchQueries` active background passes. Disabled queries initialize to idle/pending or cached success without automatic fetch on mount. Toggling query keys between disabled sentinels (`["*-disabled"]`) and real target keys splits cache identity and leaves orphaned entries.

2. **TanStack Query v5 — QueryClient API Reference**
   - *Citation*: https://tanstack.com/query/v5/docs/reference/QueryClient
   - *Invariants*: `queryClient.invalidateQueries(filters)` marks matched queries stale and refetches active observers by default (`refetchType: 'active'`). Exact key invalidations only affect the targeted observer; unmatched keys remain untouched in cache.

3. **React Core — Synchronizing with Effects**
   - *Citation*: https://react.dev/learn/synchronizing-with-effects
   - *Invariants*: Effects must synchronize external systems symmetrically (every subscribe requires matching unsubscribe on the originating connection). Dependency arrays require value-stable inputs; re-created array or object references force teardown and re-subscription cycles. In-flight async setup must ignore results and release resources cleanly if dependencies change or unmount occurs before settlement.

---

## 2. Repository Review Hypotheses

### A. `packages/ui/src/hooks/use-project-plans.ts`
- **Cumulative Churn Latch Freeze**: `churnPassesRef` monotonically increments on each FS event pass (capped at `MAX_CHURN_RECONCILE_PASSES = 3`) and only resets in manual `refresh()`. It never decays or resets on quiescence. After 3 lifetime FS events across the entire session, auto-reconcile is permanently locked in `status: "degraded"`.
- **False Coverage Recovery**: `refresh()` runs `qc.refetchQueries()` and resets `churnPassesRef`, but never invokes `reconcileWatches()` or repairs broken transport subscriptions (`failedWatchPaths`, dropped overflow handles). It unconditionally sets `coverage: "live"`, falsely reporting healthy coverage while watches remain broken.
- **Dropped Watch Registrations Lack Healing**: When `registerWatch` fails (line 368), coverage enters `status: "degraded"` with `failedWatchPaths: [path]`. No automatic retry mechanism re-attempts subscription for dropped paths, leaving coverage degraded indefinitely until hook remount.
- **Watch Set Effect Churn**: `desiredWatchPaths` in `useEffect` dependencies causes full teardown (`fsUnsubscribeTree`) and batch re-registration whenever watch paths mutate. While TanStack Query's structural sharing stabilizes identical responses, changing watch sets creates avoidable subscription RPC storms.
- **Truncation Drops Critical Parents**: At line 221, `slice(0, MAX_ACTIVE_WATCH_PATHS)` truncates at 33 paths, risking silent omission of the document parent or evidence directories added at tail.
- **Directory Replacement Missing Rebind**: Inode/directory recreation on disk with identical DTO paths is not detected as a rebind trigger if paths already exist in `activeSubs`.

### B. Query and Markdown Review Calibration
- Inactive caches are not independently a bug: successful watch registration invalidates the newly active query at `use-project-plans.ts:409-414`.
- Disabled sentinel keys contain no fetched project data; no consumer-visible defect established from their existence.
- `react-markdown` applies its default URL transform before custom renderers. The fallback anchor alone does not establish an unsafe-scheme vulnerability.
- Local URI decoding, cross-document fragments, and same-path Retry require behavioral probes; parent review reproduced the encoded-filename and Retry failures.

---

## 3. Concrete Review Checklist

- [ ] **Churn Recovery**: Does `scheduleCoalescedInvalidation` decay `churnPassesRef` after a quiet period, or reset on clean reconciliation passes, instead of only on manual `refresh()`?
- [ ] **Subscription Healing in Refresh**: Does `refresh()` trigger subscription reconciliation/recovery before declaring `coverage: "live"`?
- [ ] **Failed Watch Healing**: Does user-triggered reconciliation retry failed paths without requiring a full remount?
- [ ] **Watch Paths Memoization**: Is `desiredWatchPaths` memoized by value (e.g., joined string key or shallow set comparison) so `useEffect` does not cycle on new array references?
- [ ] **Truncation Safety**: Does `MAX_ACTIVE_WATCH_PATHS` truncation prioritize root and immediate document/evidence parents before truncating arbitrary subtrees?
- [ ] **Local URI Resolution**: Does the filesystem path use the decoded URI pathname, preserving fragment separation?
- [ ] **Document Retry**: Does Retry actually request the failed document again?

---

## 4. Unresolved Questions

- None requiring user input. Late registration completion is explicitly unsubscribed at `use-project-plans.ts:343-346`.
- Optional `linkPolicy` preserves existing general Markdown consumers; making it mandatory is outside this review.
- Prefer explicit user-triggered watch recovery; automatic retry/backoff is not required to fix the demonstrated recovery defect.
