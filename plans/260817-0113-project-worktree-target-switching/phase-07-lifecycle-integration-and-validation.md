# Phase 07 — Lifecycle integration and release validation

## Context links

- [Plan](./plan.md)
- [Architecture](../../docs/system-architecture.md#project-worktree-targets-planned)
- [Brainstorm](../reports/brainstorm-260817-0113-project-worktree-target-switching.md)
- [Phases 01–06](./phase-01-target-contract-and-resolution.md)

## Overview

- Date: 2026-08-17
- Description: Integrate removal/disappearance safeguards, prove all panels switch coherently, and complete release documentation and quality gates.
- Priority: P2
- Implementation status: pending
- Review status: pending

## Key Insights

- Deletion safety depends on editor and terminal ownership information established in earlier phases.
- External disappearance is not equivalent to app-initiated removal and must preserve live/dirty resources.
- A browser-level scenario is necessary because isolated unit tests cannot prove all panels share one target.

## Requirements

- Block app-initiated remove when the target has dirty tabs or live terminal sessions and explain each blocker.
- Retain Git's dirty/untracked protection and require explicit refresh before retrying removal.
- Detect external removal/prunable state, fall back selection to root, disable new operations, preserve dirty tabs, and label live sessions orphaned.
- Verify Explorer, search, replace, Git, editor/diff, media, and terminal creation all use one selected target.
- Update API/protocol/user/architecture documentation and changelog.

## Architecture

The Project panel consults editor and terminal selectors before invoking remove. Runtime discovery drives a single unavailable-target event into the target store; each resource subsystem applies its documented policy instead of being globally destroyed. Integration tests use real repositories/worktrees at the backend boundary and a deterministic mocked transport in browser UI coverage.

## Related code files

- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/ProjectInfoPanel.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/stores/project-target.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/stores/editor.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-terminal-tree.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/pages/WorkspacePage.tsx`
- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/browser-tests/project-worktree-target.browser.tsx`
- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/tests/project_worktree_lifecycle.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/docs/api-reference.md`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/docs/ws-protocol-guide.md`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/docs/frontend-components.md`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/docs/system-architecture.md`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/docs/CHANGELOG.md`

## Implementation Steps

1. Add selectors that count dirty tabs and live sessions by exact project/target and surface removal blockers in the Project panel.
2. Re-fetch worktree state immediately before removal, invoke the configured-root worktree API, and reconcile selection/cache state only after success.
3. Connect unavailable discovery to root fallback plus editor/terminal resource warnings; ensure target operations fail rather than redirect.
4. Add backend lifecycle tests for add/list/select/remove, dirty rejection, external deletion/prune, foreign target rejection, and concurrent roots.
5. Add browser coverage that selects a worktree and proves every panel/operation carries its target while project identity is unchanged.
6. Test reload defaults, legacy editor/terminal migrations, compact/mobile/floating surfaces, focus/reconnect discovery, and accessibility.
7. Update public contracts and user guidance, then run format, lint, type-check, Rust/UI/browser tests, and production builds.

## Todo list

- [ ] Implement removal blocker aggregation and messaging.
- [ ] Implement external-disappearance reconciliation across resources.
- [ ] Add real-repository backend lifecycle tests.
- [ ] Add end-to-end browser target-switching coverage.
- [ ] Update docs and complete all quality gates.

## Success Criteria

- Removal cannot discard dirty editor work or terminate live sessions through the app.
- External deletion returns new workspace operations to root while preserving and labelling owned resources.
- One browser scenario proves coherent target routing across all requested panels and unchanged project identity.
- `pnpm lint`, `pnpm type-check`, `pnpm test`, UI unit/browser tests, and `pnpm build` pass.

## Risk Assessment

- Cross-store ordering can briefly mix targets; derive and apply one target snapshot per render/event.
- Browser mocks may miss protocol drift; pair them with backend contract/lifecycle tests.
- Full-suite runtime is significant; run focused phase tests first, then required repository gates.

## Security Considerations

- Revalidate target membership at removal and every new operation; stale UI state grants no authority.
- Never force-delete worktrees as part of this feature.
- Preserve authentication, media-ticket binding, sandbox containment, and terminal env protections in release tests.

## Next steps

Request plan/code review, resolve findings, then begin implementation with Phase 01 only after explicit approval.
