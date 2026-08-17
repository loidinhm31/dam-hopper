# Phase 03 — Session selection and live discovery

## Context links

- [Plan](./plan.md)
- [Phase 01](./phase-01-target-contract-and-resolution.md)
- [Frontend research](./research/researcher-02-frontend-target-state.md)
- [Architecture](../../docs/system-architecture.md#project-worktree-targets-phase-3-complete)

## Overview

- Date: 2026-08-17
- Description: Add non-persisted per-project target selection and accessible live worktree discovery in the Project panel.
- Priority: P2
- Implementation status: completed
- Review status: completed

## Key Insights

- Selection is UI session state, while editor and terminal resources have their own longer-lived target identities.
- The project switcher must remain unchanged even though every target-sensitive panel re-renders.
- Runtime discovery should be event/focus driven with polling only while the worktree section is visible.

## Requirements

- Store one active target per project in memory only; absent selection means configured root.
- Expose a stable `targetKey`, target label, availability, and target reference through focused hooks/context.
- Add a root option and selectable registered worktrees to the existing Project panel.
- Refresh on section open, browser focus/reconnect, and worktree mutations; optionally poll only while visible.
- Fall back to root when the selected worktree becomes unavailable, with an explicit notice.
- Keep active project/top-bar project identity unchanged.

## Architecture

A dedicated Zustand store or equivalent focused context owns `activeTargetByProject` without persistence middleware. `WorkspacePage` derives one target snapshot for its child panels. Worktree query data supplies availability and labels, while target selection uses the server's canonical path value and a deterministic key helper.

## Related code files

- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/stores/project-target.ts`
- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/stores/project-target.test.ts`
- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-project-target.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/stores/workspace.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/queries.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/ProjectInfoPanel.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/ProjectInfoPanel.test.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/pages/WorkspacePage.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/pages/WorkspacePage.test.tsx`

## Implementation Steps

1. Implement root/worktree target helpers and a non-persisted store with per-project get/select/reset/unavailable actions.
2. Ensure the existing persisted workspace store contains no target selection and app bootstrap always begins at root.
3. Enhance the worktree query with explicit refresh, focus/reconnect behavior, and visibility-scoped polling.
4. Add an accessible selector to `WorktreesSection` with root, branch/path/status text, disabled unavailable rows, loading/error/refresh states, and selection feedback.
5. Feed the selected target from `WorkspacePage` into root-sensitive panels without changing project switcher state or route identity.
6. Add unit/component tests for reset semantics, multiple projects, keyboard selection, refresh triggers, and unavailable fallback.

## Todo list

- [x] Add target-key helpers and non-persisted store.
- [x] Add target hook/context integration.
- [x] Implement live discovery refresh policy.
- [x] Add the Project panel selector and unavailable states.
- [x] Verify project identity and restart defaults remain unchanged.

## Validation

- Focused UI validation: `pnpm --filter @dam-hopper/ui test -- src/stores/project-target.test.ts src/components/organisms/ProjectTargetSelector.test.tsx src/api/queries-worktrees.test.ts src/components/pages/WorkspacePage.test.tsx src/components/organisms/ProjectWorktreesSection.test.tsx` — 176 files, 1,116 tests passed.
- Phase validation report: Rust format/check/tests, UI build, lint, and `git diff --check` passed; no failed tests or blocking issues.
- Coverage was not generated; no coverage command is configured in the reviewed scripts.

## Success Criteria

- Each project remembers its target only for the current browser session.
- Reload/restart begins at configured root; switching projects does not lose other in-session selections.
- Externally added/removed worktrees appear while using the Project panel without server restart.
- The project switcher label and configured project path never change.

## Risk Assessment

- Accidental use of persistence middleware would violate a core requirement; test serialized workspace state.
- Aggressive polling could invoke Git continuously; bind polling to section visibility and focus.
- Large `WorkspacePage` prop changes can become brittle; prefer a focused hook/context boundary.

## Security Considerations

- UI availability is advisory; the server resolver remains authoritative for every operation.
- Display canonical paths as text only and avoid interpolating them into unsafe DOM or command content.
- Do not cache a rejected client-supplied target as trusted state.

## Next steps

Proceed to Phases 04–06 after selection provides a stable target reference to consumers.
