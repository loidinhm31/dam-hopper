# Progress: Fix Git History Store Hydration TDZ ReferenceError

## Status: Completed (2026-10-03)

### Investigation & Root Cause
- **File**: `packages/ui/src/stores/git-history.ts`
- **Root cause**: `onRehydrateStorage: () => () => { useGitHistoryStore.getState().markHydrated(); }` called `useGitHistoryStore` synchronously during Zustand store creation while the variable was in the Temporal Dead Zone (TDZ).
- **Impact**: `ReferenceError: Cannot access 'useGitHistoryStore' before initialization` caught internally by Zustand; `isHydrated` remained `false`.
- **Symptom**: `useGitHistoryView` computed `availability = { isAvailable: false, reason: "Restoring history preferences..." }`. `WorkspaceGitPanel` rendered the fallback banner across IDE and TERMINAL modes and disabled `gitLogQueryOptions`, preventing all Git API calls.

### Changes Delivered
1. `packages/ui/src/stores/git-history.ts`:
   - Updated `onRehydrateStorage` callback to receive `(state)` parameter and invoke `state?.markHydrated()` directly without module-scope variable closure.
2. `packages/ui/src/stores/git-history.test.ts`:
   - Added unit test suite `Store hydration lifecycle and readiness` verifying `isHydrated: true` readiness, idempotency of `markHydrated()`, and settlement under empty, corrupt, or storage-denied conditions.
3. `packages/ui/src/hooks/use-git-history-view.test.tsx`:
   - Added test validating availability gating and clean transition when `isHydrated` toggles.

### Verification Results
- `tsc -p tsconfig.json`: PASS (0 diagnostics)
- `npx vitest run src/stores/git-history.test.ts`: PASS (29/29 passed)
- `npx vitest run src/hooks/use-git-history-view.test.tsx`: PASS (9/9 passed)
- `npx vitest run src/components/organisms/WorkspaceGitPanel.test.ts src/components/pages/GitPage.test.tsx`: PASS (24/24 passed)
- Full package test suite: PASS (293 test files, 2,210 tests passed)
- Chromium browser test suite: PASS (git-history-search-persistence, git-history-dialog, project-worktree-target)
