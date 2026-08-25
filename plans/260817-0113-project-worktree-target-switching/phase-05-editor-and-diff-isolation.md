# Phase 05 — Editor and diff isolation

## Context links

- [Plan](./plan.md)
- [Phase 02](./phase-02-target-aware-fs-ws-media.md)
- [Phase 03](./phase-03-session-selection-and-discovery.md)
- [Frontend research](./research/researcher-02-frontend-target-state.md)

## Overview

- Date: 2026-08-17
- Description: Partition file, diff, conflict, and tab state by target and safely migrate persisted root-only tabs.
- Priority: P2
- Implementation status: complete
- Review status: complete

## Key Insights

- `${project}::${path}` collides when identical relative paths exist in multiple worktrees.
- Selection is session-only, but persisted tabs need durable target identity to reopen correctly.
- External deletion must not discard unsaved text; unavailable tabs need an explicit constrained state.

## Requirements

- Key tabs and active selection by project, target key, content kind, and path/root as appropriate.
- Store target reference with persisted tabs and migrate legacy tabs to configured root.
- Route open/read/write/reload/diff/conflict operations through the tab's immutable target, not the current selector.
- Restore target-specific active tabs when switching among targets.
- Preserve dirty tabs for unavailable targets with warning, disabled unsafe writes, and explicit close/save-as recovery.

## Architecture

Increment the editor persistence schema. Each tab owns a normalized target descriptor and composite key. Views filter by current `(project, targetKey)` while unavailable dirty tabs remain in the store and are reachable through recovery UI. A target switch changes the visible tab set but never rewrites existing tab identities.

## Related code files

- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/stores/editor.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/stores/editor.test.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/EditorTabs.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/molecules/EditorTab.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/DiffViewer.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/MergeConflictEditor.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/FileTree.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/SearchPanel.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/pages/WorkspacePage.tsx`

## Implementation Steps

1. Define composite tab-key helpers and add target metadata to file, diff, conflict, and related tab variants.
2. Version the persisted editor store and migrate every legacy project/path tab to the root target without data loss.
3. Make tab operations use their stored target for read/write/reload/reconcile and Git diff requests.
4. Filter and restore active tabs per target; ensure same-path tabs can coexist independently.
5. Introduce unavailable-target state, warning presentation, write protection, and explicit recovery/close behavior for dirty content.
6. Update file tree/search/Git entry points to open tabs with the selected target and add migration/isolation/disappearance tests.

## Todo list

- [x] Add target-aware tab types and keys.
- [x] Implement persisted-state version migration.
- [x] Route all tab operations by immutable tab target.
- [x] Restore independent visible/active tabs per target.
- [x] Preserve and expose dirty unavailable tabs safely.

## Success Criteria

- Root and multiple worktrees can open the same relative path with independent text, dirty state, and active tab.
- Legacy persisted tabs reopen under the configured root with no content loss.
- Switching targets restores that target's prior tabs without network operations using another target.
- External deletion never silently closes or overwrites a dirty tab.

## Risk Assessment

- Persistence migration errors can hide existing tabs; test representative legacy state fixtures.
- Components may accidentally use current selection for an old tab; operations must take target from tab identity.
- Diff and conflict tabs have additional root/path dimensions that require explicit key tests.

## Security Considerations

- A persisted worktree path remains untrusted and must pass server resolution on reopen.
- Disable write/reload actions after target-unavailable responses rather than falling back to root.
- Avoid rendering unsanitized target/path data as markup.

## Next steps

Phase 05 is complete; editor migration, same-path isolation, and unavailable
recovery tests pass. Terminal identity and lifecycle validation are complete in
Phases 06–07.
