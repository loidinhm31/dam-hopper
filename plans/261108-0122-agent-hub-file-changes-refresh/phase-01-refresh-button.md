# Phase 01 — Refresh button and component coverage

## Overview
- Priority: P2. Status: DONE (2026-11-08 02:16:51 +07:00). Effort: 2h.
- One integration owner implements the button, adds tests, then hands coherent changes to main for verification.
- Dependencies: existing host QueryClient provider; current selected-group model and child `useGitDiff` query.
- No API, dependency, store, terminal, navigator, mobile-layout, or child-component changes.

## Context and key insights
- [Canonical plan](./plan.md), [scout](../reports/scout-261108-0123-agent-hub-file-changes-refresh.md), [standards](../../docs/code-standards.md), [architecture](../../docs/system-architecture.md).
- `TraditionalTerminalProjectsDisplay.tsx:272` exposes `selectedGroup`; put hooks after this derivation and before the compact-layout early return at current line 554.
- Current lines 775–786 contain the header and mounted `TraditionalProjectFileChanges`.
- `TraditionalProjectFileChanges.tsx:62–76` normalizes object references preferentially, otherwise project name/profile, then calls `useGitDiff(targetRef, "*")`.
- `queries.ts:166–188` builds profile/generation-qualified target keys; `1354–1381` adds the root suffix. Use the actual helper, not the scout's illustrative literal profile key.
- Existing colocated tests use `// @vitest-environment jsdom`, Vitest, React `act`, and `createRoot`; follow that convention, not a new testing dependency.

## Exact file actions
Workspace root: `/home/loidinh/WS/dam-hopper`.
1. **Modify** `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` — imports, target/query state, refresh handler, header action.
2. **Create** `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.test.tsx` — component tests.
3. Delete nothing. Read but do not modify `TraditionalProjectFileChanges.tsx`, `api/client.ts`, or `api/queries.ts`. Plan artifacts document the intended UI change; no out-of-scope product documentation edits.

## Task: add-file-changes-refresh
### 1. Imports
- Extend `lucide-react` import with `RefreshCw`.
- Import `useQueryClient` and `useIsFetching` from `@tanstack/react-query`.
- Import `normalizeProjectTarget` from `@/api/client.js` and `gitQueryKey` from `@/api/queries.js`.
- Reuse existing `useMemo`, `useState`, and `cn`; no additional React hook required.

### 2. Normalize exactly the child's target
Immediately after `const { selectedGroup, activeSessionForGroup } = selection`, derive a memoized `targetRef`. Equivalent construction:

```tsx
const targetRef = useMemo(() => {
  const ref = selectedGroup?.projectRef;
  return normalizeProjectTarget(
    ref
      ? { ...ref, profileId: ref.profileId ?? selectedGroup?.profileId }
      : {
          project: selectedGroup?.projectName ?? "",
          profileId: selectedGroup?.profileId,
        },
  );
}, [selectedGroup?.projectRef, selectedGroup?.projectName, selectedGroup?.profileId]);
```

- `projectRef.project` wins over display name; explicit reference profile wins over group profile, matching the child.
- Spreading the reference preserves any supplied `worktreePath`; `normalizeProjectTarget` canonicalizes it and removes empty paths. Current group type declares `ProjectRef`; do not expand that public model or follow the global project-target selection store for this button.
- No selection means an empty project, not another profile/project fallback. Keep refresh handler guarded.
- Keep existing child props unchanged; both target derivations must stay semantically identical.

### 3. Query subscription and local trigger state
- `const queryClient = useQueryClient()`.
- Compute `const diffQueryKey = gitQueryKey("git-diff", targetRef)` each render so current connection generation participates. Do not memoize by target alone and accidentally retain an old generation.
- `const fetchingCount = useIsFetching({ queryKey: diffQueryKey })`; `const isFetching = Boolean(targetRef.project) && fetchingCount > 0`.
- `const [manualRefreshPending, setManualRefreshPending] = useState(false)`.
- `const isRefreshing = manualRefreshPending || isFetching`.
- All hooks run unconditionally, including when sidebar/compact layout hides the button. `useIsFetching` observes cache activity only; do not add another `useGitDiff` observer/request in the parent.
- The empty-project key is a narrow harmless subscription, never an unfiltered all-query subscription.

### 4. Refresh handler
Define `async function handleRefreshFileChanges()` in the component:
1. Return if `!targetRef.project || isRefreshing`.
2. Capture `const queryKey = diffQueryKey`; set manual pending before awaiting.
3. `try { await queryClient.invalidateQueries({ queryKey }); } finally { setManualRefreshPending(false); }`.
4. Invoke from JSX as `onClick={() => void handleRefreshFileChanges()}`.

Use TanStack's default non-throwing refetch-error behavior; keep failed-query data/error presentation in the existing child. Do not add `throwOnError`, blanket `catch`, synthetic success, toast, retries, or a second fetch path. Prefix matching must remain enabled: the child key appends `"*"`; `exact: true` would miss it. Awaiting invalidation keeps manual feedback until active refetch settles, while `finally` prevents a stuck button even if invalidation rejects. Capture the key before await; never retarget work after selection/profile changes. Manual state is local to the display and conservatively remains busy until that click settles; only current-target background fetches contribute through `useIsFetching`.

### 5. Header action at current lines 776–778
Leave the current `justify-between` header and `<span>file changes</span>` intact; append:

```tsx
<button
  type="button"
  onClick={() => void handleRefreshFileChanges()}
  disabled={isRefreshing}
  aria-label="Refresh file changes"
  title="Refresh file changes"
  className="rounded p-0.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
>
  <RefreshCw
    className={cn("h-3 w-3", isRefreshing && "animate-spin")}
    aria-hidden="true"
  />
</button>
```

Preserve native keyboard/focus behavior; do not suppress focus outlines. Native `title` satisfies the requested tooltip without adding a Tooltip component. Do not move the control to the generic Files header, child list, or compact projects sheet.

## Task: test-file-changes-refresh
### Harness
- New `.test.tsx` uses jsdom, `createRoot`, and awaited `act` around render/click/query settlement. Unmount roots, clear QueryClients, restore spies and fixture state after every case.
- Mount the real display with a fresh real `QueryClientProvider`; queries use `retry: false` and deterministic freshness. Use actual `useQueryClient`, `useIsFetching`, `normalizeProjectTarget`, and `gitQueryKey`.
- Stub expensive unrelated terminal/navigator/tree children and narrowly control selection/profile/connection hooks with a selected-group fixture. Supply required display props, `isCompact={false}`, and `onToggleFileTree={vi.fn()}`. The normal sidebar render guard must remain real.
- Spy on `queryClient.invalidateQueries`; by default call through. Do not replace the key helper with a fixed key or assert only that a mocked click handler ran.
- For active-refetch cases, a small replacement changed-files child may mount a real `useQuery` keyed by `gitQueryKey("git-diff", normalizedFixtureTarget, "*")` with a controlled query function. Assert the child receives the original target props. This tests actual parent invalidation/subscription without network calls; existing child tests retain diff-rendering coverage.

### Required cases
1. **Rendering/accessibility:** within the real right-sidebar/header, find exactly one `button[aria-label="Refresh file changes"]`; assert `type`, `title`, decorative SVG, enabled idle state, no `animate-spin`, and existing section text remains.
2. **Click and dispatch:** use a real button `.click()` in `act`; assert one invalidation with `{ queryKey: gitQueryKey("git-diff", expectedTarget) }` and no `exact: true`. Active aggregate query function runs again; changed test data becomes visible after settlement.
3. **Target normalization:** parameterize a reference-bearing group and name/profile fallback. Assert reference project/profile precedence and root normalization. Include a worktree-bearing structural fixture (no production type expansion) to prove worktree normalization/preservation matches the child.
4. **Isolation:** mount/seed root and alternate-target queries (same project on another profile, another project, another worktree). Mark controls fresh and observe their query-function counts. Refresh refetches the selected target only; do not hardcode profile/generation key arrays.
5. **Manual busy path:** with no matching active fetch, temporarily have the invalidate spy return a deferred promise. Click and assert disabled plus `svg.animate-spin` while actual `useIsFetching` stays zero. A second native click does not dispatch again. Resolve and assert enabled/no spin. Restore call-through afterward.
6. **Fetching busy path:** start a real matching query refetch independently and defer its result. Without a manual click, assert disabled/spinning until settlement; another target's pending fetch must not spin this button.
7. **Failure recovery:** reject a controlled active query refetch with retries disabled. Assert busy clears, button becomes usable again, and real QueryClient retains the query error. Existing child error rendering remains covered by its existing tests; do not add fake success/error suppression.
8. **Visibility/regression:** no refresh control with `fileTreeHidden`, missing selected project, absent `onToggleFileTree`, or compact layout. No extra query is issued merely to render the parent/header.

## Task: verify-file-changes-refresh
After implementation/tests land, main/test owner runs once from workspace root:

```sh
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui build
```

Expected outcomes: new tests and full UI suite pass; TypeScript package build passes. Preserve complete failing command/exit/error evidence; do not label focused success as full-suite success. Manual UI smoke: open Agent Hub, show files sidebar, select project, click refresh and observe disabled spinning icon followed by updated changes/idle state; confirm sidebar close and file opening still work. Record smoke separately from unit/build results. This planning assignment executes none of these checks.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "add-file-changes-refresh",
    "title": "Add the target-scoped file changes refresh action",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx"],
    "constraints": ["Keep product changes inside packages/ui; preserve child query, existing sidebar gates, and terminal lifecycle.", "Use the existing target normalizer and gitQueryKey; no literal cache-key arrays, second query observer, extra dependencies, or exact: true query matching."],
    "acceptance": ["Header contains one accessible RefreshCw button with the required type, label and title.", "Click invalidates the normalized selected diff-query prefix; manual or matching background fetching disables and spins until settlement."],
    "verification": ["After test authoring, main verifies with pnpm --filter @dam-hopper/ui test and pnpm --filter @dam-hopper/ui build; inspect manual Agent Hub refresh smoke behavior."]
  },
  {
    "id": "test-file-changes-refresh",
    "title": "Cover refresh rendering, invalidation and busy-state behavior",
    "blocked_by": ["add-file-changes-refresh"],
    "allowed_files": ["packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.test.tsx"],
    "constraints": ["Use existing Vitest/jsdom and React act/createRoot patterns; no new test dependency.", "Keep real query subscription/key/invalidation behavior under test; isolate only unrelated UI and network boundaries."],
    "acceptance": ["Tests exercise a real button click, correct normalized invalidation, aggregate-query refetch, and profile/project/worktree isolation.", "Tests cover manual pending, actual matching fetch activity, duplicate-click disabling, failure recovery, accessibility and existing visibility gates."],
    "verification": ["Main runs pnpm --filter @dam-hopper/ui test and records the actual component/full-suite outcome after all edits land."]
  },
  {
    "id": "verify-file-changes-refresh",
    "title": "Verify integrated UI behavior and build",
    "blocked_by": ["test-file-changes-refresh"],
    "allowed_files": [],
    "constraints": ["Verification-only task; do not edit product files or hide failures.", "Main owns the integrated test/build/smoke run; plan author does not execute implementation checks."],
    "acceptance": ["Required UI test and build commands pass with recorded evidence; any failed required check blocks completion.", "Manual Agent Hub refresh smoke confirms visible feedback, updated changes and preserved sidebar/file-opening behavior."],
    "verification": ["pnpm --filter @dam-hopper/ui test", "pnpm --filter @dam-hopper/ui build", "Record manual Agent Hub sidebar refresh smoke observations separately."]
  }
]
```

- [x] <!-- evcrate-task:add-file-changes-refresh --> Add the refresh action
- [x] <!-- evcrate-task:test-file-changes-refresh --> Add component coverage
- [x] <!-- evcrate-task:verify-file-changes-refresh --> Verify integrated behavior (administratively closed per user approval; integrated suite and smoke checks outstanding)

## Verification Record — Phase 01 Completion (2026-11-08 02:16:51 +07:00)
- **Status:** Phase 01 marked **DONE per user approval (2026-11-08 02:16:51 +07:00)**; technical acceptance incomplete per Cycle 3 review carryovers.
- **Task Dispositions:**
  - `add-file-changes-refresh`: **DONE**. Added accessible `RefreshCw` button in file changes sidebar header in `TraditionalTerminalProjectsDisplay.tsx` with target normalization via `normalizeProjectTarget`, diff query invalidation via `gitQueryKey("git-diff", targetRef)`, and dual-source `isRefreshing` (`manualRefreshPending || isFetching`).
  - `test-file-changes-refresh`: **DONE**. Added 521 lines of colocated component tests in `TraditionalTerminalProjectsDisplay.test.tsx` covering rendering, accessibility, click invalidation, target normalization, isolation, manual busy state, fetching busy state, failure recovery, and sidebar visibility gates.
  - `verify-file-changes-refresh`: **Administratively closed per user approval**. TypeScript build passed cleanly (`pnpm --filter @dam-hopper/ui build`, 0 errors). Automated component test suite showed intermittent act flush failure in initial QA run before reported 15/15 handoff; full UI test suite and manual Agent Hub smoke check remain outstanding.
- **Review & Approval:**
  - Cycle 3 Code Review (`plans/reports/code-review-261108-0157-agent-hub-file-changes-refresh-cycle-3.md`): Score 8/10, 0 critical issues. User reviewed and approved.
- **Open Carryovers & Warnings:**
  - Cycle 3 W1: Normalization test does not test conflicting reference/display precedence or structural worktree fixtures.
  - Cycle 3 W2: Isolation coverage does not test same-project/other-profile or root/other-worktree controls, or alternate-only pending fetch state.
  - Full UI test suite run (`pnpm --filter @dam-hopper/ui test`) and manual Agent Hub sidebar smoke verification.
## Risks, security, rollback and next steps
- Wrong normalization/key would refresh a different target: mirror child semantics and test actual helper/isolation. Preserve owner/generation qualification; no ambient fallback or post-await data publication.
- Feedback gaps: manual flag bridges invalidation dispatch; `useIsFetching` captures background work. No new polling/network observer/all-query invalidation.
- Existing read-only Git API/auth and error states remain authoritative; no Git mutations, secrets, logging, storage, or additional permissions.
- Rollback: revert only this button/import/state change and its new tests, preserving unrelated user edits. No data migration or cache-schema rollback.
- Main owns related-plan conflict resolution and review/validation disposition before implementation handoff. No execution state is hydrated by this phase.

## Unresolved questions
None requiring design decisions. Open technical carryovers: Cycle 3 review warnings W1 & W2, full UI test suite execution, and manual Agent Hub sidebar smoke verification.
