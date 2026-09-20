# Code Review Summary: Phase 01 Transport-Safe FS Subscription

**Score:** 8.5/10  
**Status:** In Review (Automated tests & build passed; manual two-profile smoke pending)  
**Plan:** `plans/260920-1658-fix-on-fs-event-type-error/plan.md`  
**Phase:** `plans/260920-1658-fix-on-fs-event-type-error/phase-01-fix-transport-fs-subscription.md`  
**Date:** 2026-09-20  

---

### Scope
- **Files reviewed (8 files, ~371 LOC modified/added):**
  1. `packages/ui/src/hooks/use-fs-subscription.ts` (97 lines modified)
  2. `packages/ui/src/api/connections.ts` (13 lines modified)
  3. `packages/ui/src/api/idle-transport.ts` (15 lines modified)
  4. `packages/ui/src/components/pages/WorkspacePage.tsx` (127 lines modified)
  5. `packages/ui/src/hooks/use-fs-subscription.test.tsx` (52 lines modified)
  6. `packages/ui/src/api/connections.test.ts` (29 lines modified)
  7. `packages/ui/src/api/idle-transport.test.ts` (24 lines added)
  8. `packages/ui/src/components/pages/WorkspacePage.test.tsx` (14 lines modified)
- **Updated plans:**
  - `plans/260920-1658-fix-on-fs-event-type-error/plan.md`
  - `plans/260920-1658-fix-on-fs-event-type-error/phase-01-fix-transport-fs-subscription.md`

---

### Overall Assessment
Well-architected, minimal, high-impact fix addressing the root cause of `TypeError: h.onFsEvent is not a function`.
1. Enforces strict profile transport resolution (`resolveSubscriptionTransport`), eliminating cross-profile fallback to ambient transport.
2. Coupler between watch handle and component lifecycle safely invalidates TanStack Query cache (`removeQueries`) upon unmount, preventing stale `sub_id` reuse on remount.
3. Fixes disconnect logic in `connections.ts` to demote to `IdleTransport` only when the disconnecting profile actually owns the ambient transport.
4. Hardens `IdleTransport` with defensive FS stubs (`onFsEvent`, `fsSubscribeTree`, `fsUnsubscribeTree`, `fsOp`), failing predictably with stable rejections rather than missing-method exceptions.
5. Isolates FileTree render faults using surface- and target-keyed `ErrorBoundary` wrappers in desktop IDE, compact IDE, and terminal floating panel, guaranteeing terminal session continuity.

---

### Critical Issues
None. No security vulnerabilities, memory leaks, or breaking API changes detected.

---

### Warnings
1. **`use-fs-subscription.test.tsx` Mocking Gap vs Plan Step 1.1:**
   - *Problem:* `use-fs-subscription.test.tsx` retains a static mock for `@tanstack/react-query` (`useQuery: () => ({ data: { sub_id: 7, nodes: [...] } })`).
   - *Impact:* `queryFn` (which runs `resolveSubscriptionTransport`, `fsSubscribeTree`, sets `originatingTransportRef.current = t`, and handles abort signals) is never executed in the hook unit tests. The remount lifecycle with cache clearance and re-subscription was tested by asserting `removeQueries` call rather than end-to-end via a real `QueryClientProvider`.
   - *Recommendation:* Upgrade `use-fs-subscription.test.tsx` to mount with `QueryClientProvider` and verify actual `fsSubscribeTree` execution on initial mount and remount.
2. **`removeProfileConnection` Ambient Demotion Asymmetry in `connections.ts`:**
   - *Problem:* `disconnectProfile` checks `entry.transport === currentAmbient` before calling `reconfigureTransport(new IdleTransport())`. However, `removeProfileConnection` destroys `entry.transport` without verifying ambient ownership or calling `reconfigureTransport`.
   - *Impact:* While `ServerProfilesDialog` calls `disconnectProfile` prior to `removeProfileConnection`, direct programmatic calls to `removeProfileConnection` on an ambient owner would leave ambient transport referencing a destroyed transport.
   - *Recommendation:* Add the same `ownsAmbient` check and `reconfigureTransport(new IdleTransport())` inside `removeProfileConnection`.

---

### Suggestions
1. **ErrorBoundary Fault-Isolation Test in `WorkspacePage.test.tsx`:**
   - `WorkspacePage.test.tsx` updated JSX depth traversal for existing props assertions. Adding a test verifying that an error thrown inside FileTree renders the ErrorBoundary fallback while keeping terminals mounted will guard against regressions.
2. **Prune Redundant Cache Update in `loadChildren`:**
   - Lines 268-279 in `use-fs-subscription.ts` update `["fs-tree", project, targetKey, path]` alongside `treeQueryKey`. Since `useFsSubscription` only observes `treeQueryKey` (which includes `profileId`), the unqualified cache update is redundant.
3. **Formalize FS Transport Capability Interface:**
   - `FsSubscriptionTransportSeam` is cast via `t as unknown as FsSubscriptionTransportSeam`. Moving this interface to `transport.ts` as an optional seam interface avoids the double type assertion.

---

### Positive Observations
- **KISS & DRY:** Kept the solution direct and modular without adding redundant stores or secondary caching layers.
- **Strict Profile Isolation:** Failing closed with `ConnectionOwnerError` rather than silently catching into ambient transport prevents cross-profile data leakage.
- **Graceful Error Containment:** ErrorBoundary keys dynamically incorporate `surface + profileId + projectName + targetKey`, automatically clearing latched errors when switching targets.
- **Defensive Idle Seam:** `IdleTransport` returns safe no-op unsubscribe functions and rejects async calls with descriptive errors.
- **Fast Execution & Zero Regressions:** 46 targeted tests run in 1.02s; full UI test suite (1,843 tests) passes cleanly in ~12s; TypeScript build compiles cleanly with zero diagnostics.

---

### Validation Commands and Results
1. **Targeted Vitest Suite:**
   - Command: `pnpm --filter @dam-hopper/ui exec vitest run src/hooks/use-fs-subscription.test.tsx src/api/connections.test.ts src/api/idle-transport.test.ts src/components/pages/WorkspacePage.test.tsx`
   - Result: PASS (4 test files, 46 passed, 0 failed, duration: 1.02s).
2. **Full UI Test Suite:**
   - Command: `pnpm --filter @dam-hopper/ui test`
   - Result: PASS (263 test files, 1,843 passed, 0 failed, duration: 11.83s).
3. **TypeScript Compilation:**
   - Command: `pnpm --filter @dam-hopper/ui build`
   - Result: PASS (`tsc -p tsconfig.json` exit code 0, duration: 6.51s).

---

### Unresolved Questions
1. Manual smoke verification with two configured profiles (Profile A connected, Profile B disconnected, FileTree unmount/remount via Explorer toggle) remains to be performed in a live running browser environment to visually verify terminal continuity and lack of console errors.
