# Phase 05 — Workspace Git panel integration

## Context links

- [Plan](./plan.md); [contract](./design-contract.md); [shared view](./phase-04-shared-history-view.md).
- [Workspace source](../../packages/ui/src/components/organisms/WorkspaceGitPanel.tsx).
- Dependency: frozen Phase 04 interface; independent of Phase 06 on separate files.

## Overview

- Date: 2026-10-01. Priority: P2. Implementation: pending. Review: pending.
- Integrate search and restored branch/root selection into every existing Workspace Git mount without changing project switcher or push workflows.

## Key Insights

- `WorkspacePage.tsx` mounts target-keyed lazy Git panels at desktop/compact/floating paths. Component-state history selection resets on remount by design today.
- Workspace currently stores page, historyScope, selectedRootId, historyTargetKey, selectedCommit locally and independently hand-builds refresh query keys.
- Rewrite callbacks already disabled when viewing another branch; safe cherry-pick/revert warning and root-relative diff path behavior must survive integration.

## Requirements

- Shared controller provides restored root/branch, search, paging, selection and refresh on all mounts.
- Canonical Workspace project already persists; don't add project state or selector inside panel.
- Remove obsolete local history state and refresh/query convention, not leave fallback/shim code.
- Retain push, separately confirmed force-publish lease, SSH retry, full-message editing/signature consent, details and child-root path mapping.

## Architecture

`WorkspacePage qualified target → WorkspaceGitPanel → useGitHistoryView → persisted selection + owner-bound history query`.

Panel owns current mutation hook/dialogs and root-scoped push. Use effective controller target/root for all history/details actions; `effectiveScopeKey` resets mutation dialogs on scope change. Search toolbar integrates above existing graph; filtered result uses list presentation.

## Related code files

Modify:

- `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`: consume controller/toolbar; remove obsolete historyScope/ref/refresh helpers/local state.
- `packages/ui/src/components/pages/WorkspacePage.tsx`: pass `projectTarget` availability to all three Git mounts; preserve existing target identity and compact/desktop/floating layouts.
- `packages/ui/src/components/organisms/WorkspaceGitPanel.test.ts`: migrate meaningful refresh/selection tests into shared controller coverage as necessary; retain root path/action safety behavior. Delete SSR wording/wiring-only markup assertions rather than repinning new text.
- `packages/ui/browser-tests/project-worktree-target.browser.tsx`: adjust existing hook mock signature only if affected; preserve target-isolation checks.

Read/verify, intentionally unchanged:
- `GitHistoryActions.tsx`, `CommitDetailsPanel.tsx`, leased-push hook: reuse unchanged safety contracts.

## Implementation Steps

1. Read shared Phase 04 report and current Workspace panel/mount paths. Find references for exported old helper symbols before removal; use LSP if configured, otherwise focused references including tests.
2. Replace local root/branch/page/search-related scope state and selectedCommit with controller. Add minimal target `available` prop from authoritative `projectTarget` snapshot to all three Workspace mounts; current mounts pass target but omit availability. Gate history reads and actions while unavailable, never assume a missing worktree is usable or redirect it to primary.
3. Keep root selector layout and warning display, wiring to shared root state. Bind GitBranchControl view canonical-ref props; show active-vs-viewing warning and follow-active control from controller.
4. Add shared search/pagination/refresh toolbar and query status. Show Subject and body hint; failed log query shows error/retry, no-match distinct from no ordinary commits. Draft/applied-query transitions must not leave stale selection actionable.
5. Pass logs/selection/actions into GitLogTree; `presentation='list'` only for applied nonempty query. Wire details and file double-click to effective selected target/root and existing project-relative root mapping.
6. Apply `isViewingActiveBranch` to existing drop/edit/reset/undo callbacks; cherry-pick/revert still apply to checked-out branch and warning remains accurate. Close/reset history dialogs whenever effective scope changes, including preference changes from other mounted surface and owner reconnect.
7. Keep gitPush/leasedPush target and SSH retry flows consistent with restored selected root; restore must not call prepare/publish/checkout. No changes to rewrite engine or lease API.
8. Delete obsolete local `WorkspaceHistoryBranchState`, `resolveWorkspaceHistoryBranchState`, `resolveWorkspaceHistoryRef`, page/target reset effects and `refreshWorkspaceGitPanelQueries` after migrating real behavioral test coverage. Keep `projectRelativePathForRoot`, root-label helpers if still used; do not delete unrelated code.
9. Update tests/mocks; discard tests that merely pin copied key arrays, helper forwarding or SSR text. Keep realistic consumer checks for nonactive-branch action restrictions, root-relative diff path and selection behavior via shared hook.
10. Inspect every Workspace mount path for same prop/interface usage and compact width. Report changes; no worker checks mid-flight.

## Todo list

- [ ] Integrate controller and toolbar across Workspace mounts.
- [ ] Keep scoped details/diffs and mutation guards intact.
- [ ] Preserve root-scoped push/lease/SSH behavior.
- [ ] Remove obsolete local history state/refresh helpers and migrate behavioral coverage.

## Success Criteria

- Select qualified project + nonactive history branch, close/reopen panel, navigate away/back, reload: restore project and branch for current target/root.
- Search finds known matching commit older than 200; filter clear restores ordinary branch graph at page 0.
- Root/worktree/project switches restore their own branch preference, reset search/page/details, and never display another scope's commit actions.
- Viewing nonactive branch keeps rewrite actions disabled; restoring selection alone performs no mutations.
- Actual compact and desktop Git surfaces remain usable; no page shell/terminal unmount from history errors.

## Risk Assessment

- Restored child root changes push scope: always label actual root and retain existing force-publish confirmation.
- Missing target ignored by shared controller would route unexpected reads: preserve availability from authoritative target snapshot.
- Helper deletion can lose legitimate tests: migrate consumer-visible lifecycle coverage before deleting obsolete implementation-specific assertions.

## Security Considerations

Owner/root-qualified requests and details; no ambient refresh. Current branch/signature/CAS/lease safety unchanged. Scope transitions close pending dialogs so old commit confirmation cannot act on new target.

## Next steps

Integrate beside Phase 06; Phase 07 exercises all actual Workspace surfaces. Unresolved questions: none.
