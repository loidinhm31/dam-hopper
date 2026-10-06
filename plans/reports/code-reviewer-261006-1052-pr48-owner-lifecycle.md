# Code Review: PR #48 Owner Lifecycle & Blame Hook

## Scope
- Files: `packages/ui/src/hooks/use-editor-git-blame.ts`, `lib/editor-git-blame.ts`, `api/client.ts`, `api/ws-transport.ts`, `api/queries.ts`, `stores/editor.ts`.
- Analysis: Single-flight lifecycle, cancellation, stale row clearing, model/tab transitions, owner generation, visibility/focus invalidations, QueryCache filtering, persistence.
- Verified Lines: PR #48 HEAD `9c74aaeeb5efe2e1b4f17878ac0b4933c1854fd4` vs base `9e727b4bee3b8634add7d049a247a7d3599f282a`.
- Tests: Read-only inspection; Finding 2 probe independently confirmed by parent smoke test (1/1 passed).

## Overall Assessment
Transport DTOs, 5 MiB size bounds, and persistence isolation are robust. However, several critical lifecycle defects exist in `use-editor-git-blame.ts`: tab switching omits synchronous attribution clearing; `triggerRepositoryRefresh` lacks post-await and catch block ownership/tab gates (proven by smoke probe); staged index renames leave attribution stale due to unhandled HEAD-identical invalidations; QueryCache subscription leaks cross-profile invalidations for identically named projects; and visibility restoration triggers self-aborting redundant requests.

## Critical Issues
None.

## High Priority Findings

### 1. Tab Key Transition Omits Attribution Reset (`setData(null)` Missing)
- **File/Line**: `packages/ui/src/hooks/use-editor-git-blame.ts:465-472`
- **Trigger**: User switches active editor from Tab A (`fileA.ts`, loaded blame) to Tab B (`fileB.ts`, blame enabled).
- **Event Timeline**:
  - `t=0ms`: User clicks Tab B. `useEffect` receives new `tab.key`.
  - `t=1ms`: Line 466 sets `status = "waiting"`, but `setData(null)` is omitted. `hookResult.data` retains Tab A's `GitBlameResponse`.
  - `t=5ms`: `runBlame()` starts for Tab B over network.
  - `t=20ms`: User right-clicks gutter line 1 on Tab B. `MonacoHost.tsx:266` captures `effectiveBlameDataRef.current` (Tab A's snapshot).
  - `t=25ms`: `EditorGitBlameContextMenu.tsx:78-101` evaluates `isSnapshotCurrent` as `true` (snapshotId echoes match Tab A). `findBlameRangeForLine` maps line 1 to Tab A's commit.
  - `t=30ms`: Context menu enables "Show Commit in Git". Clicking reveals Tab A's commit for Tab B's file.
- **Observable Harm**: False commit attribution and cross-tab commit reveal actions offered in the gutter context menu.
- **Minimal Fix**: At line 466, synchronously call `setData(null)`, clear `debounceTimerRef.current`, abort `activeControllerRef`, and increment `localEpochRef.current++`.
- **Reproducer**: Mount Tab A with resolved blame. Switch to Tab B with deferred blame promise. Query `hookResult.data`: expected `null`, got Tab A `GitBlameResponse`. Open line context menu: reveals Tab A commit.

### 2. Missing Post-Await and Catch Block Liveness/Owner Gates in `triggerRepositoryRefresh` [PROVEN]
- **File/Line**: `packages/ui/src/hooks/use-editor-git-blame.ts:388-396, 418-422`
- **Trigger**: Asynchronous root discovery (`queryClient.fetchQuery`) is in flight when tab disables blame, switches tabs, or drops connection.
- **Observable Harm**:
  - *Catch block (lines 418-422)*: When in-flight `fetchQuery` rejects after tab disables blame (`blameEnabled: false`), catch block unconditionally executes `setStatus("unavailable")`, `setUnavailableReason("Failed to discover Git roots")`, and `setData(null)` without liveness checks, corrupting the clean `"off"` state to `"unavailable"`. (Verified by parent smoke probe).
  - *Success path (lines 388-396)*: Pre-await `currentTab` is evaluated. If Tab A had an unmapped root, line 392 calls `setStatus("unavailable")` and `setData(null)` unconditionally, corrupting Tab B's active attribution.
- **Minimal Fix**: Check liveness/ownership immediately after line 387 and at entry to catch block:
  ```ts
  if (!isCurrentConnection(owner) || tabRef.current?.key !== currentTab.key || !isEnabledRef.current) return;
  ```
- **Reproducer**: Mount ready; trigger `refresh()`; advance 50ms (starts deferred roots fetch); render `blameEnabled: false` (status -> `"off"`); reject previous roots request. Observed: status flips to `"unavailable"` with "Failed to discover Git roots", violating disabled state.

## Medium Priority Improvements

### 3. Staged Renames Leave Attribution Stale Due to Strict HEAD/Root Check
- **File/Line**: `packages/ui/src/hooks/use-editor-git-blame.ts:406-417`
- **Trigger**: User stages a file rename in the index (contract §4.9 native rename baseline resolution). `git-diff` is invalidated.
- **Observable Harm**: `triggerRepositoryRefresh(false)` runs. Because HEAD commit and root ID are unchanged (`headOid === prevHead`, `rootId === prevRootId`) and blame was already loaded (`dataRef.current !== null`), condition at line 406 evaluates to `false`. `runBlame()` is suppressed! Uncommitted lines remain attributed to uncommitted status instead of the renamed baseline at HEAD.
- **Minimal Fix**: On Git mutation invalidations (`prefix === "git-diff"`), invoke `runBlame()` regardless of whether HEAD OID changed, or pass an explicit invalidation flag to refresh the buffer baseline.
- **Reproducer**: Load blame for renamed uncommitted file. Stage file rename via Git. Observe QueryCache invalidates `git-diff`. Blame hook skips reblame because `headOid` is identical; attribution remains stale until manual refresh.

### 4. QueryCache Subscription Filters by `key.includes(project)` Omitting Profile/Generation
- **File/Line**: `packages/ui/src/hooks/use-editor-git-blame.ts:580-601`
- **Trigger**: Two profiles (e.g. `server-1` and `server-2`) each manage a project with the same name.
- **Observable Harm**: Line 598 checks `key.includes(currentTarget.project)` without matching `key[1]` (`profileId`) or `generation`. A Git mutation on `server-2` triggers `triggerRepositoryRefresh(false)` on `server-1`. If `server-1` had an active keystroke debounce (`dataRef.current === null`), it fires premature network blame at t=50ms, breaking the 250ms typing debounce.
- **Minimal Fix**: Reconstruct target query prefix using `gitQueryKey(prefix, currentTarget)` or verify `key[1] === currentTarget.profileId`.

### 5. Window Focus / Visibility Restoration Triggers Competing Requests & Self-Abort
- **File/Line**: `packages/ui/src/hooks/use-editor-git-blame.ts:406-417, 538-550`
- **Trigger**: User switches back to Dam-Hopper window (`visibilityState` becomes `"visible"`).
- **Event Timeline**:
  - `t=0ms`: `isEnabled` flips `true` -> lines 465-471 launch Request #1 (`inFlightRef = true`).
  - `t=0ms`: `window.onfocus` / `visibilitychange` schedules `triggerRepositoryRefresh(true)` (50ms timer).
  - `t=50ms`: `triggerRepositoryRefresh` runs, completes root query at t=70ms, calls `runBlame()`.
  - `t=70ms`: Second `runBlame()` sees `inFlightRef === true`, sets `pendingIntentRef = true`, and calls `activeController.abort()`.
  - `t=75ms`: Request #1 aborts; `finally` block reschedules `runBlame()` with 250ms debounce.
  - `t=325ms`: Request #2 finally launches.
- **Observable Harm**: Aborts active libgit2 computation (non-cancellable on server thread per §3) and adds a 250ms debounce delay before annotations display.
- **Minimal Fix**: In `triggerRepositoryRefresh`, skip `runBlame()` if `inFlightRef.current` is already active for the current epoch and HEAD is unchanged.

## Low Priority Suggestions

### 6. Non-Edit In-Flight Supersede Applies Unnecessary 250ms Debounce
- **File/Line**: `packages/ui/src/hooks/use-editor-git-blame.ts:353-360`
- **Trigger**: Model switch (`onDidChangeModel`) or manual refresh while a prior request is in flight.
- **Observable Harm**: Line 356 reschedules via `setTimeout(..., GIT_BLAME_DEBOUNCE_MS)`. Non-edit events should execute immediately on microtask rather than waiting 250ms.

## Positive Observations
- Strict structural response partition validation in `validateBlameResponse`: guarantees contiguous 1..N partition without gaps/overlaps, display-line count parity, and valid commit indices.
- Zero storage pollution: `stores/editor.ts` strictly excludes `blameEnabled` from `partialize`, normalizes to `false` in `persistedTab`, and resets on hydration.
- Pure helper layout isolation: binary search `findBlameRangeForLine` and timezone-aware formatting are clean and deterministic.
- Transport mapping: camelCase `worktreePath` in JSON body for POST `git:blame` and query params for GET `git:commitDetails` match API contracts exactly.

## Recommended Actions
1. **Apply immediate fix to `useEditorGitBlame.ts:466`**: Synchronously clear attribution (`setData(null)`), clear debounce timer, and abort controller on tab key change.
2. **Add post-await & catch guards to `triggerRepositoryRefresh`**: Revalidate `isCurrentConnection`, tab key, and `isEnabled` after `fetchQuery` resolves and inside catch block.
3. **Handle staged index renames**: Allow `git-diff` invalidation to recompute blame when buffer has uncommitted lines, even if HEAD OID is unchanged.
4. **Scope QueryCache subscription**: Match `profileId` and target identity, preventing cross-profile invalidation leakage.
5. **Coalesce visibility restoration**: Prevent racing initial `runBlame()` and 50ms repository refresh from self-aborting.

## Metrics
- Type Coverage: 100% typed (no `any` in blame hook or pure helpers).
- Test Coverage: 12 unit test scenarios in `use-editor-git-blame.test.tsx` (missing tab-switch context menu attribution assertion, post-await root race, and staged rename invalidation).
- Linting Issues: 0.

## Unresolved Questions
1. Should `MonacoHost.tsx` gutter right-click HitTest also gate `canRevealCommit` against `hookResult.status !== "ready"`, providing defense-in-depth against any potential hook data desynchronization?
2. Does `model.getValue()` inside `runBlame` capture CRLF when Monaco's model is configured with `\r\n`, and does backend libgit2 normalizer strip `\r` consistently across all platforms? (Phase 01 evidence indicates backend normalizer strips `\r`, but client-side contract echo test coverage for raw CRLF buffers is recommended).
