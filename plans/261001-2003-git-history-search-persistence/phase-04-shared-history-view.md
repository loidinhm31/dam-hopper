# Phase 04 — shared history controller, branch view and search controls

## Context links

- [Plan](./plan.md); [design contract](./design-contract.md); Phases [02](./phase-02-transport-query-contract.md) and [03](./phase-03-persisted-history-selections.md).
- [Existing frontend architecture](../../docs/frontend-components.md).
- Dependency: integrated transport/query and persisted-store contracts. This phase owns all shared frontend changes before two page workers start.

## Overview

- Date: 2026-10-01. Priority: P2. Implementation: DONE (2026-10-02 00:16 +07:00). Review: Cycle 2 passed (9.4/10, no critical issues); its refresh-state warning was fixed after review and validated with the hook suite (8/8) and `tsc --noEmit` (0 diagnostics). See [Cycle 2 review](../reports/code-review-261002-0012-phase-04-shared-history-view-cycle2.md) and [closeout](../reports/project-manager-261002-0016-phase-04-shared-history-view.md).
- One reusable history-state controller and small toolbar; existing mutation/dialog hook remains separate.

## Key Insights

- Workspace has local branch/root/page/refresh logic; Git page has none of that history scope logic. Copying Workspace into Git page would perpetuate two conventions.
- `GitBranchControl` already supports view versus checkout modes, but uses ambiguous Branch.name option values. Canonical ref values needed only in view mode.
- `GitLogTree` graph follows raw parent hashes; filtering commits can leave unbounded disconnected tracks and imply false adjacency. Search uses list presentation without graph work.

## Requirements

- Share hydration/root/branch discovery, current-owner reconciliation, paging, search debounce, selected commit and guarded refresh on both surfaces.
- Effective scope changes reset transient state synchronously enough to prevent stale rows/dialog actions, including external cross-page preference changes.
- No default HEAD reads while pinned branch discovery unresolved; no persisted pin erased by loading/error/old cache.
- Search accessibility: labeled text input, clear/Escape, IME-aware debounce, disabled/guarded actions while scope unavailable, loading/error/no-match feedback.
- View-mode branch selection never checks out; checkout-mode existing consumers unchanged.

## Architecture

Proposed controller `useGitHistoryView(target: ProjectTargetRef, { available?: boolean })` returns:

- `rootId`, `rootOptions`, `setRootId`, `branchRef`, `branchLabel`, `activeBranch`, `followActive`, `selectBranchRef`, `followCheckedOutBranch`, `isViewingActiveBranch`.
- `searchText`, `setSearchText`, `clearSearch`, composition handlers, `appliedMessageQuery`, `isFiltered`.
- `page`, `offset`, `previousPage`, `nextPage`, `hasPreviousPage`, `hasNextPage`.
- `logs`, `isLoading`, `isFetching`, `error`, `availability`, `notice`, `refresh`, `isRefreshing`.
- `selectedCommit`, `selectCommit`, `clearSelectedCommit`, `effectiveScopeKey` for parent mutation-dialog reset.

Keep return contract exact in implementation report; don't turn it into a framework. Toolbar consumes controlled values/callbacks, not persisted store/server API directly. Root/branch controls may remain in existing surrounding layout; shared toolbar covers repeated search/paging/refresh/follow-active.

`GitBranchControl` view props: `selectedBranchRef?: string`, `onSelectedBranchRefChange?: (ref: string) => void`; checkout branch-name behavior unchanged. Remove old view-only `selectedBranch/onSelectedBranchChange` after caller migration in Phase 05; coordinator stages atomic cutover, not shipped parallel APIs.

`GitLogTree` proposed `presentation?: 'graph' | 'list'` and `emptyMessage?: string`; list omits SVG/graph calculation but keeps refs/hash/author/date, selection keyboard handling and current context-menu safety.

## Related code files

Create:

- `packages/ui/src/hooks/use-git-history-view.ts`; focused behavior tests `use-git-history-view.test.tsx` only for uncertain lifecycle/race/debounce transitions.
- `packages/ui/src/components/molecules/GitHistoryToolbar.tsx`.

Modify:

- `packages/ui/src/components/organisms/GitBranchControl.tsx` and existing `.test.tsx`: canonical view-only identity, no-checkout behavior, selected deletion callback.
- `packages/ui/src/components/organisms/GitLogTree.tsx` and existing `.test.ts`: filtered list without graph calculation; tests protect consumer-visible identity/action behavior, not SVG source wording.
- Existing `packages/ui/browser-tests/consumer-context-menu.browser.tsx`: update only affected branch-control behavior assertions.
- Query/store files belong to prior phases; if interface defect found, coordinator assigns one owner and freezes revised contract before page work.

## Implementation Steps

1. Read current Workspace selection/ref/refresh helpers, GitPage selection, branch control, GitLogTree and prior-phase reports. Use repository hooks/imports/Tailwind patterns; no MUI/router/data-fetch migration.
2. Implement target-qualified store selectors and root discovery. Keep default root provisional only until successful current-owner discovery; history reads gated by target availability, hydration and usable root. Never adopt previous target's root/branch response.
3. Resolve preference: default/follow-active → current local branch/HEAD; pinned canonical ref → matching Branch name/kind and latest `lastCommit`. Every explicit branch pick pins, including the current branch. Only explicit Follow checked-out branch returns to tracking. Compare active canonical ref for mutation eligibility independently of preference mode. Keep pinned branch independent of checkout changes.
4. Reconcile missing root/pin only after successful completed current-owner discovery, not `data=[]`, stale cached success while refetching, network error or removed generation. Emit a visible fallback notice. Respect existing missing/prunable-worktree fail-closed boundary.
5. Effective UI scope identity includes normalized profile/project/worktree/root, resolved branch identity/preference and owner generation. On scope change reset draft/applied query, page, selection and pending timer before exposing new rows. Tip SHA changes for same branch trigger query refresh but must not erase user search on every commit/fetch.
6. Implement 300 ms single-line draft-to-applied query debounce; preserve input responsiveness, cancel timer on unmount/scope change, defer during IME composition; clear/Escape applies empty immediately. When applied query changes set page=0 and clear selected commit atomically. Disable row actions when draft/current query transition makes displayed results stale.
7. Get log via Phase 02 shared options/hook using `offset=page*200`, resolved ref/root and applied term. Do not use keepPreviousData across owner/scope/query changes. Render actual query errors distinct from no matches.
8. Page changes clear selected commit and preserve term/branch. Full-page next heuristic stays; empty next page shows clear Previous recovery. Counts describe displayed matching range, not total.
9. Guard refresh: capture owner generation and effective view identity/query/page; refresh branches first when branch tip can change, resolve updated ref then fetch active log using same options. Invalidate/refetch only matching branches/status/details prefixes. Before setting selection/notice verify captured scope still current; ignore stale completions. Concurrent refresh button disabled; no new retry layer.
10. Reconcile selected commit only against current successful result; on filter/page/scope changes clear immediately, on same-page refresh retain iff returned row still exists; not temporary undefined arrays during background fetch.
11. Add canonical refs to view options/callback; preserve labels and checkout mutation names. Allow explicit selection of the already displayed active branch to pin it: do not discard same-value events in view mode as checkout mode does. If the Select primitive doesn't emit reselection, provide an explicit Keep this history branch action that pins the displayed ref. Deleting a selected branch triggers authoritative missing-pin reconciliation to follow-active with notice, not a synthetic branch pick that pins the fallback. View selection tests prove no checkout and correct local/remote history resolution.
12. Add toolbar with labels/aria names, existing controls/styling, busy states, Subject and body hint, keyboard Escape/clear and follow-active action. Maintain minimum usable width/wrapping for compact Workspace.
13. Add filtered presentation to GitLogTree: bypass lane parsing and omit graph column content/edges; render same selectable/context-menu rows. No additional table component or fake parent rewriting. Empty error/no-result differentiation belongs to controller/parent.
14. Add targeted regressions for pin restore before query, explicit active-branch pin surviving checkout changes, explicit follow-active tracking, authoritative vs offline deletion, timer cancellation on target switch, page/query transition, stale refresh completion and selected-commit reconciliation. Real browser acceptance comes in Phase 07; no permanent mocked response echoes or incidental labels.
15. Return exact stable controller/toolbar/view-prop contract to page workers. Do not run checks mid-flight; coordinator integrates Phase 04 and current callers atomically before validation.

## Todo list

- [x] Shared qualified history controller and discovery reconciliation.
- [x] Transient IME-aware debounced query/paging/selection transitions.
- [x] Owned current-scope refresh and stale completion fence.
- [x] Canonical view-mode branch identity without checkout changes.
- [x] Accessible controls and filtered list presentation.
- [x] Consumer-visible race/identity regressions and frozen page-worker interface.

## Success Criteria

- Both page workers can consume one controller without duplicating branch/ref/page/refresh rules.
- Saved pin never flashes actionable HEAD results, and offline discovery never overwrites it.
- Changing scope/query/page cannot leave old commit actions active; refresh completion cannot set state for another scope.
- Filtered rows omit ancestry edges; normal graph unchanged; no extra graph work for filtered mode.
- View local/remote collisions remain distinct; selecting a branch produces no checkout.

## Risk Assessment

- Overextraction could couple bulk/local changes/push to history: keep them in pages.
- React effect sequencing can render old rows before reset: derive effective state by scope key, not effect-only cleanup.
- Frequent branch tip updates should refetch search, not erase draft; distinguish stable branch identity from resolved revision SHA.
- Phase 04 branch-control API cutover overlaps caller edits: coordinator owns final migration integration; Phase 05 removes obsolete Workspace props/helpers.

## Security Considerations

Requests owner-bound; generations transient. Hydrated preferences are untrusted read-only intent. Never mutate checkout on restore; retain all mutation backend guards and avoid stale dialog confirmations.

## Next steps

Phase 04 is DONE (2026-10-02 00:16 +07:00). The controller, toolbar, canonical-ref branch view, and filtered-list presentation are frozen for Phases 05–06. Cycle 2 scoped validation passed 66/66 tests, UI build, and web typecheck; the post-review refresh-state fix passed the hook tests (8/8) and `tsc --noEmit` (0 diagnostics). Review scored 9.4/10 with no critical issues. See the [Cycle 2 tester report](../reports/tester-261002-0006-phase-04-shared-history-view-cycle2.md), [review](../reports/code-review-261002-0012-phase-04-shared-history-view-cycle2.md), and [closeout](../reports/project-manager-261002-0016-phase-04-shared-history-view.md). Unresolved questions: none.
