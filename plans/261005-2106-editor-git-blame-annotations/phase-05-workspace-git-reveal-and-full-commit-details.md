# Phase 05 — Workspace Git reveal and full commit details

## Context links

- [Parent plan](./plan.md); [contracts §§2,7](./contracts.md); [Phase 02](./phase-02-native-blame-and-read-only-git-api.md); [Phase 03](./phase-03-owner-bound-client-and-buffer-lifecycle.md).
- [Frontend research](./research/frontend-lifecycle-navigation.md), [Git history architecture](../../docs/architecture/git-history-search.md).
- Dependencies: exact commit-details API/types from02/03. Independent of Phase04 rendering behind frozen reveal callback.

## Overview

- Date: 2026-10-05. Priority: P2.
- Implementation status: pending. Review status: pending.
- Reveal correct Workspace Git panel/root by full OID; show body/files without walking history or weakening mutations.

## Key Insights

- IDE `ActivateToolRequest.exclusiveTarget` invokes shortcut toggle logic; omit it for explicit Git reveal.
- Terminal panel resolver always toggles currently selected target; add explicit reveal intent while preserving shortcut toggles.
- Compact layout uses `setRequestedCompactSurface("git")`; existing shortcut helper returns early and cannot handle this action.
- `useGitHistoryView.selectedCommit` resets on scope/search/page/refresh. Blame inspection cannot pretend to be a currently loaded log selection.
- Full message edit-snapshot endpoint requires local branch/reachability and is unsuitable for detached/general reads.

## Requirements

- Typed owner/target/root/hash/nonce reveal request; current-generation only.
- Already-open Git panel stays open; all IDE/terminal/compact layouts use same source ownership.
- Old/filter-excluded/unmerged/detached commit details readable via exact endpoint, full body displayed as text.
- Preserve editor dirty bytes, tab and relevant history preferences; no project/root/branch fallback.
- Existing history-row mutations retain canonical entries and safety gates. New annotation inspection is read-only; no synthetic isPushed/branch metadata.

## Architecture

```text
current annotation -> GitCommitRevealRequest(owner,target,root,hash,nonce)
  -> WorkspacePage validates owner/target -> ensure Git surface open
  -> WorkspaceGitPanel activates validated root, consumes matching nonce
  -> inspection selection (target/root/generation scoped)
  -> commitDetails exact OID + existing commitFiles
  -> full message/files; historical diff on double click
```

Keep inspection selection local to WorkspaceGitPanel, separate from normal shared history hook selection. No new persisted commit-selection store or router page transition.

## Related code files

Modify existing:

- `packages/ui/src/components/pages/WorkspacePage.tsx`: reveal state, owner validation and layout-specific ensure-open path.
- `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`: typed reveal prop, root readiness/consumption and independent inspection selection.
- `packages/ui/src/components/organisms/CommitDetailsPanel.tsx`: explicit history/inspect props, canonical full-message rendering and read-only inspection mode.
- `packages/ui/src/components/pages/GitPage.tsx`: migrate shared details-panel history props if changed; retain existing page behavior, no new blame navigation here.
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`: reveal intent handling and panel foregrounding.
- `packages/ui/src/lib/terminal-workspace-panel.ts`: required intent discriminator `toggle | reveal`; migrate every constructor/caller rather than legacy alias.
- `packages/ui/src/api/queries.ts`: owner-qualified `useGitCommitDetails(target,hash,root,enabled)` and exact read-only details invalidation.
- `packages/ui/src/hooks/use-git-history-view.ts`: prefer reuse unchanged; adjust only a necessary selection seam, not entire history controller.
- `packages/ui/src/components/templates/IdeShell.tsx`, `MobileWorkspaceShell.tsx`: reuse current activation paths; modifications only if visibility/focus gate needs a narrow seam.

Create proposed:

- `packages/ui/src/lib/git-commit-reveal.ts`: shared request type/minimal identity validator only if two owners need it; not a global event bus.
- `packages/ui/src/components/organisms/WorkspaceGitPanel.blame.test.tsx`: inspection vs history selection, root/generation races.

Extend existing `TerminalWorkspaceShell.test.tsx`, `WorkspacePage.test.tsx`, `WorkspaceGitPanel.test.ts`, `terminal-workspace-panel` and details-panel tests where actual behaviors change. Inventory exported prop/type callers with LSP before implementation when available.

## Implementation Steps

1. Freeze `GitCommitRevealRequest` from contracts. Callback carries current captured owner, original editor target, server root and full OID; never build from active ambient profile/project.
2. Add WorkspacePage ensure-open handler. Validate current connected generation/target; if source target is no longer current/available, report cancellation rather than selecting by unqualified project name.
3. IDE: issue bottom Git tool activation without `exclusiveTarget`; retain source editor/layout. Terminal: add `intent: "reveal"` request/resolver outcome sets Git panel and foregrounds it regardless of current active panel. Migrate existing shortcut calls to `intent: "toggle"` so their current behavior is unchanged.
4. Compact: directly select registered `git` compact surface for either workspace mode. Do not route through helper that returns early. Keep editor tab mounted/store content intact for return navigation.
5. Pass reveal request to correct target-keyed WorkspaceGitPanel. Wait for available root discovery; request root must exist. Set root, then consume request only when matching root/generation scope is rendered. A late previous request cannot override a newer nonce/root.
6. Add local inspection selection `{owner,targetKey,rootId,hash,nonce}` independent of hook-local normal history selection. On external reveal clear normal selection once; on real log-row selection exit inspection and invoke unchanged history selection. Close clears current mode; target/root/generation changes retire inspection.
7. Preserve filter/page/branch preference rather than searching or resetting history. If inspected hash absent from visible logs, display a concise outside-view notice. Filter/page changes may retain inspection; root/owner changes must clear it.
8. Add canonical details query using existing profile/generation/target/root/hash key convention. Fetch only while selected. Register details invalidation for relevant Git operations without changing existing edit-snapshot query semantics.
9. Make CommitDetailsPanel props discriminated: history mode has real GitLogEntry and existing action callbacks; inspect mode has exact hash and no mutation callbacks. Normalize display data from `GitCommitDetails`, not fabricated GitLogEntry. Migrate all shared callers, including GitPage and tests; no compatibility shim.
10. Render readable full subject/body region with wrapping/scroll, author/timestamp/offset and full hash affordance; keep file list and existing diff-opening action. History mode continues using real canonical entry for cherry-pick/revert/drop eligibility.
11. Bind file/diff lookup and project-relative reconstruction to selected request root, not whatever root changed after click. Preserve original editor when opening historical diff; no autosave.
12. Add explicit missing/pruned commit, invalid root, disconnect and old-generation loading/error states; do not navigate to another hash or primary root.
13. Add regressions: Git already open stays open, terminal toggle still toggles, compact reveal works, root-reset doesn't erase intended inspection, out-of-page/filter commit selected, stale nonce/profile response ignored, history actions remain unchanged and inspect mode cannot expose drop/edit/reset.
14. After shared UI edits settle, run relevant tests once. Smoke actual app navigation with a repository whose line references a commit older than200 entries, multiline body and detached worktree; exercise IDE, terminal and compact reveal and inspect dirty editor state on return.

## Todo list

- [ ] Typed owner-qualified ensure-open request implemented across layouts.
- [ ] Terminal toggle/reveal callers migrated without shortcut regression.
- [ ] Root-ready nonce consumption and independent inspection state implemented.
- [ ] Exact details/full-body/files read integrated.
- [ ] Shared details-panel callers migrated; mutation gates preserved.
- [ ] Out-of-view, already-open and stale-owner regressions pass.
- [ ] Actual app reveal smoke passes.

## Success Criteria

- Annotation action opens correct project/worktree/root details even when hash isn't in loaded200 rows or current filter/branch.
- Full fixture body visible; exact requested hash selected; no auto history scan, checkout or branch pin change.
- Already-open surface never closes; shortcut toggle still behaves as before.
- Root activation cannot clear requested inspection; wrong-generation request cannot replace current selection.
- Editor dirty content/tab/cursor persists; annotation inspection is strictly read-only (full message/files/historical diffs, no mutation actions). Selecting a real history row exits inspection and restores existing eligible actions from canonical metadata; no fabricated eligibility or weakened gates.

## Risk Assessment

- Multiple independent selectors (profile/project/worktree/root): one captured request, explicit checks at every transition.
- Hook resets wipe inspection: panel-local separate inspection scope and delayed root-ready consumption.
- Shared panel prop migration breaks GitPage: complete callsite migration and existing behavior regressions.
- Mutation safety weakened by fake flags: discriminated modes and existing canonical history entry only.

## Security Considerations

- Commit hashes/subjects/body untrusted: exact lookup and text rendering; never interpolate hashes into shell commands or HTML.
- No elevated permissions for inspection; existing read authentication applies.
- Read-only details endpoint does not relax rewrite/lease APIs.

## Next steps

- Phase06 connects real annotation actions through EditorTabs/Markdown/HTML to workspace reveal.
- Unresolved questions: none; any unsupported host/browser proof must be reported rather than claimed.
