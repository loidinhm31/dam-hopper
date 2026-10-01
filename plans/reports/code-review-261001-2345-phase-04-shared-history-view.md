## Code Review Summary

### Scope
- Files reviewed:
  - `packages/ui/src/hooks/use-git-history-view.ts` (new controller hook, 588 loc)
  - `packages/ui/src/hooks/use-git-history-view.test.tsx` (new focused unit tests, 320 loc)
  - `packages/ui/src/components/molecules/GitHistoryToolbar.tsx` (new toolbar component, 223 loc)
  - `packages/ui/src/components/organisms/GitBranchControl.tsx` (view mode canonical ref support, delete handler, 523 loc)
  - `packages/ui/src/components/organisms/GitBranchControl.test.tsx` (view mode canonical ref unit tests, 415 loc)
  - `packages/ui/src/components/organisms/GitLogTree.tsx` (presentation='list' | 'graph' and emptyMessage support, 503 loc)
  - `packages/ui/src/components/organisms/GitLogTree.test.tsx` (presentation tests, 123 loc)
- Lines of code analyzed: ~2,700 lines
- Review focus: Phase 04 shared history view controller, toolbar, canonical branch control, list presentation mode, and unit tests
- Updated plans:
  - `plans/261001-2003-git-history-search-persistence/phase-04-shared-history-view.md`
  - `plans/261001-2003-git-history-search-persistence/plan.md`

### Overall Assessment
Code quality high. Architecture follows `design-contract.md` and `phase-04-shared-history-view.md`. Strict isolation between view mode and checkout mode prevents accidental checkouts. Canonical refs (`refs/heads/...`, `refs/remotes/...`) strictly enforced. Performance optimizations present: SVG parsing bypassed in list presentation mode; 300 ms debounce with IME composition guards. Comprehensive unit test suite (56 tests passing across 4 files) plus browser test suite passing (10 tests). Minor architecture and robustness improvements identified regarding render-phase scope reset synchronization, connection generation fencing, and unhandled refresh rejection.

**Score: 8.8 / 10**

---

### Critical Issues
None. No security vulnerabilities, credential leaks, or breaking regressions found.

---

### High Priority Findings

1. **Transient State Reset via `useEffect` Lags by One Render on Scope Transition**
   - **File**: `packages/ui/src/hooks/use-git-history-view.ts:265-275`
   - **Problem**: When `effectiveScopeKey` transitions (switching project, root, or branch preference), transient state (`page`, `appliedMessageQuery`, `selectedCommit`, `searchText`) resets inside `useEffect`. React effects execute after render commits to DOM. On the transition render pass, `logQueryOptions` runs with the new target/root/ref but the *old* `offset` (page) and *old* `appliedMessageQuery`. This can dispatch an out-of-bounds or irrelevant log query before the reset triggers a second render pass. Furthermore, any parent component reading `selectedCommit` receives the previous scope's commit for that frame.
   - **Contract Reference**: `phase-04-shared-history-view.md` Risk Assessment: *"React effect sequencing can render old rows before reset: derive effective state by scope key, not effect-only cleanup."*
   - **Fix**: Synchronize state during render using React's state-adjustment pattern or derive effective values:
     ```ts
     const [renderedScopeKey, setRenderedScopeKey] = useState(effectiveScopeKey);
     if (renderedScopeKey !== effectiveScopeKey) {
       setRenderedScopeKey(effectiveScopeKey);
       clearTimeout(debounceTimerRef.current);
       debounceTimerRef.current = undefined;
       setSearchTextState("");
       setAppliedMessageQuery(undefined);
       setPage(0);
       setSelectedCommit(null);
     }
     ```

2. **Connection Generation Missing from `effectiveScopeKey` and Refresh Fence**
   - **File**: `packages/ui/src/hooks/use-git-history-view.ts:251-262, 470-542`
   - **Problem**: `resolveTargetOwner(targetRef.profileId)` yields `{ profileId, generation }`. When a server profile reconnects or endpoint updates, `generation` increments. Currently `effectiveScopeKey` only contains `[profileId, project, worktreePath, effectiveRootId, branchPreference]`. Because `generation` is omitted, `refresh()` cannot detect if connection reconnected during in-flight fetch (`capturedScopeKey !== currentScopeRef.current` evaluates to false), allowing stale data from the previous generation to commit.
   - **Contract Reference**: `phase-04-shared-history-view.md` Step 5: *"Effective UI scope identity includes normalized profile/project/worktree/root, resolved branch identity/preference and owner generation."*
   - **Fix**: Incorporate owner generation into `effectiveScopeKey`:
     ```ts
     const owner = resolveTargetOwner(targetRef.profileId);
     const effectiveScopeKey = useMemo(() => {
       return JSON.stringify([
         targetRef.profileId ?? "",
         owner?.generation ?? 0,
         targetRef.project,
         targetRef.worktreePath ?? "",
         effectiveRootId,
         branchPreference.mode === "pinned"
           ? branchPreference.ref
           : "follow-active",
       ]);
     }, [targetRef, owner?.generation, effectiveRootId, branchPreference]);
     ```

---

### Medium Priority Improvements

1. **Unhandled Promise Rejection in `refresh()`**
   - **File**: `packages/ui/src/hooks/use-git-history-view.ts:470-542`
   - **Problem**: In `refresh()`, network or server failures in `queryClient.fetchQuery` are not caught. Because `GitHistoryToolbar` binds `onClick={onRefresh}`, this unhandled rejection surfaces to the window runtime (`unhandledrejection`).
   - **Fix**: Add a `try/catch` block inside `refresh()` to swallow or report the error (e.g., setting a user notice `Failed to refresh git history`) rather than bubbling an unhandled rejection.

2. **VCS Root Reconciliation Should Check `!isRootsFetching`**
   - **File**: `packages/ui/src/hooks/use-git-history-view.ts:165-177`
   - **Problem**: Branch reconciliation checks `isBranchesSuccess && !isBranchesFetching && branches.length > 0` before declaring a branch missing. Root reconciliation checks `isRootsSuccess && rootsData.length > 0`, but omits `!isRootsFetching`. During a background refetch, cached roots may be momentarily stale while new roots are loading.
   - **Fix**: Add `!isRootsFetching` to root reconciliation guard to match branch reconciliation behavior.

3. **Duplicated Row Template Markup in `GitLogTree.tsx`**
   - **File**: `packages/ui/src/components/organisms/GitLogTree.tsx:283-365, 366-498`
   - **Problem**: List mode and graph mode duplicate ~80 lines of table row markup (including context menu bindings, click/keyboard handlers, row styling, author column, date formatting, and commit hash cells).
   - **Fix**: Extract a small `GitLogRow` component or render the graph cell conditionally `{presentation === "graph" ? (...) : null}` to eliminate duplication and keep context menu bindings in one place.

---

### Low Priority Suggestions

1. **Memoize Target Reference by Value in `useGitHistoryView`**
   - **File**: `packages/ui/src/hooks/use-git-history-view.ts:90`
   - **Problem**: `useMemo(() => normalizeProjectTarget(target), [target])` recomputes when `target` object identity changes, even if `{ profileId, project, worktreePath }` have identical scalar values.
   - **Fix**: Memoize against `target.profileId`, `target.project`, `target.worktreePath` or JSON string representation.

---

### Positive Observations
- **Strict View Isolation**: `GitBranchControl` completely disables checkout actions in view mode, emits canonical refs (`refs/heads/...`, `refs/remotes/...`), and handles branch deletion safely via `onSelectedBranchDeleted` without synthesizing a fallback selection.
- **Performance Aware**: In list mode, `GitLogTree` returns `[]` from `useMemo` for `parsedGraph`, bypassing track calculations and SVG rendering entirely.
- **Accessible & Robust Toolbar**: `GitHistoryToolbar` provides proper `aria-label` attributes, keyboard Escape handling, clear action, IME composition support, and displayed range indicators (`1–200 commits`) without claiming total match counts.
- **Sanitized Search Input**: `setSearchText` strips `\r`, `\n`, `\0` immediately on keystroke input to prevent malformed request injections.
- **Strong Unit Test Suite**: 56 unit tests across 4 test files verify debounce timing, IME composition, canonical ref resolution, view mode checkout absence, and presentation modes.

---

### Recommended Actions
1. Apply the state-adjustment pattern in `useGitHistoryView` to reset `page`, `appliedMessageQuery`, and `selectedCommit` synchronously during the render pass where `effectiveScopeKey` transitions.
2. Add `owner?.generation ?? 0` into `effectiveScopeKey` to ensure proper fencing on connection reconnections.
3. Wrap `refresh()` fetch operations in a `try/catch` to gracefully catch network errors and prevent unhandled promise rejections.
4. Add `!isRootsFetching` to root reconciliation guard.

---

### Metrics
- Type Coverage: 100% (TypeScript check `@dam-hopper/ui` passed with 0 diagnostics)
- Test Coverage: 56/56 unit tests passed; 10/10 browser tests passed
- Linting / Diagnostic Issues: 0 errors

### Unresolved Questions
None.
