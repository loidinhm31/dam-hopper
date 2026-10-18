# Scout Report: Worktree Selection Persistence Across Page Refresh

- **Date:** 2026-10-18
- **Target:** Fix worktree resetting to project root after page refresh
- **Scope:** `packages/ui/src/stores/project-target.ts`, `packages/ui/src/lib/fresh-state-reset.ts`, and test suites

## 1. Problem Analysis
Currently, `useProjectTargetStore` in `packages/ui/src/stores/project-target.ts` is an in-memory Zustand store without `persist` middleware. While project selection (`useWorkspaceStore`) is persisted in `localStorage` (`dam-hopper:workspace-state`), `useProjectTargetStore` resets `activeTargetByProject` to `{}` on every page reload. Consequently, `useProjectTarget` defaults to `isRoot: true`, resetting the active worktree to root.

## 2. Proposed Architecture & Solution
1. Wrap `useProjectTargetStore` with Zustand `persist` middleware:
   - Storage key: `dam-hopper:project-target-state` (version 1).
   - Persisted fields: `activeTargetByProject`, `unavailableTargetByProject`, and `unavailableTargetsByProject`.
   - Migration/Validation: Sanitize restored records to ensure clean string key/value pairs and drop malformed data.
2. Maintain Existing Invariants:
   - Non-root worktree selection stores path; selecting root (`null`) deletes key so clean default is root.
   - `projectScopeKey` preserves profile isolation (`profileId::project` tuple or legacy bare string).
   - If a persisted worktree no longer exists when `useWorktrees` resolves, `useWorktreeTargetReconciliation` automatically calls `markTargetUnavailable` and falls back to root with notification.
3. Update `fresh-state-reset.ts`:
   - Recognize `dam-hopper:project-target-state` as a versioned state store so v1 data is preserved during fresh state migrations.

## 3. Acceptance Criteria
- [x] Selecting a worktree persists to `localStorage`.
- [x] Rehydrating / refreshing the page restores the active worktree target.
- [x] Selecting root removes the worktree entry from persisted state.
- [x] Deleted/pruned worktrees are gracefully detected on initial load and demoted to root with unavailable notice.
- [x] Corrupted `localStorage` entries do not throw or crash the workbench.
- [x] All existing project-target and worktree test suites pass.

## 4. Risks & Mitigations
- **Risk:** Stale worktree path after branch/worktree deletion outside app.
  - **Mitigation:** Existing `useWorktreeTargetReconciliation` runs on query fetch and demotes missing targets to root.
- **Risk:** Test interference across test runs due to `localStorage`.
  - **Mitigation:** Ensure store reset clears persisted storage or store state cleanly in `afterEach`.
