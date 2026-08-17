# Frontend target-state research

## Scope

Assess how a session-only worktree selection can route Explorer, Git, editor, search, media, and terminal behavior while the active project identity remains unchanged.

## Existing behavior

- `packages/ui/src/stores/workspace.ts` persists the active project. A worktree choice added to that persisted state would violate the requirement to reset to the configured root after app restart.
- `packages/ui/src/components/organisms/ProjectInfoPanel.tsx` already lists, creates, and removes worktrees, making it the correct selector location.
- `packages/ui/src/api/queries.ts` caches worktrees under `['worktrees', project]`; worktree discovery currently refreshes through mutation invalidation, not continuous runtime detection.
- `packages/ui/src/api/client.ts`, `packages/ui/src/api/transport.ts`, and `packages/ui/src/api/ws-transport.ts` pass project identity through REST and raw WebSocket operations but have no independent target.
- `packages/ui/src/stores/editor.ts` keys tabs as `${project}::${path}` and persists them. Root and worktree files with the same relative path therefore collide.
- `packages/ui/src/hooks/use-terminal-tree.ts` groups and IDs sessions by project. `packages/ui/src/hooks/use-terminal-manager.ts` and `packages/ui/src/lib/terminal-launch-context.ts` derive cwd from the configured project path.
- `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx` and `GitBranchControl` already use `root` for nested repositories. That axis is distinct from the project worktree target and cannot safely be overloaded.
- `WorkspacePage.tsx` composes all root-sensitive panels and is already large; target selection should be exposed through a focused store/context rather than more page-local branching.

## Decision

Create a non-persisted per-project selection store:

```text
activeTargetByProject[project] = root | canonical-worktree-path
```

Expose a derived `ProjectTargetRef` and a stable `targetKey`. The configured root uses a stable sentinel such as `root`; worktrees use a collision-resistant key derived from the canonical path. Components continue receiving the unchanged project identity and add target identity only where root-sensitive behavior requires it.

The target selector lives only in the Project panel. Top-bar project switching remains unchanged. Other top-bar controls, such as the branch control, read the selected target context so their data reflects the active worktree.

## State and cache partitioning

- Add `targetKey` to every target-sensitive React Query key and invalidation: file tree/search, project status, branch/log/diff/conflict data, nested Git roots, and file decorations.
- Keep the existing nested-repository `root` parameter after target identity in Git keys. Target root and nested VCS root are independent axes.
- Extend raw transport payloads, REST client methods, file/search hooks, and image/video preview requests with the target reference.
- Key editor tabs and active tabs by `(project, targetKey, path)`. Persist the target with each tab, while the live target selection itself remains unpersisted.
- Version and migrate persisted editor state: legacy project-only tabs map to the configured-root target.
- Use target-specific deterministic terminal IDs and group sessions beneath project then target. Carry canonical target metadata separately; do not embed raw paths directly in display IDs.

## Discovery and lifecycle

- Refresh the worktree list when the Project panel worktree section opens, on browser focus/reconnect, and after add/remove/prune.
- Poll only while the section remains visible if continuous detection is required; avoid permanent application-wide polling.
- If the selected worktree disappears or becomes prunable, immediately select the configured root for new panel operations.
- Preserve dirty editor tabs from the unavailable target with a visible unavailable/read-only warning and an explicit close/save-as path; never silently discard them.
- Existing terminal sessions keep running with their original cwd and are labelled unavailable/orphaned until closed.
- App-initiated removal is blocked while the target has dirty editor tabs or live terminals. Git's own dirty-worktree protection remains the final disk-safety check.

## UI and accessibility implications

- The Project panel needs a clear root option, one row per selectable worktree, branch/path/status metadata, refresh/loading/error states, and keyboard-accessible selection.
- Unavailable/prunable worktrees remain informative but disabled.
- Selection changes should update all panels coherently; intermediate mixed-target renders should be avoided by deriving one target object per project render.
- Compact/mobile surfaces and floating terminal file panels must consume the same target source, not create independent selection state.

## Implementation surfaces

- Create: focused target store/context/hooks under `packages/ui/src/stores/` and `packages/ui/src/hooks/`.
- Modify: `ProjectInfoPanel.tsx`, `WorkspacePage.tsx`, top-nav Git branch surfaces, worktree queries/types.
- Modify: query keys and hooks in `packages/ui/src/api/queries.ts` plus REST/raw transport contracts.
- Modify: file tree, search, replace, upload, encrypted write, image, and video consumers.
- Modify: `packages/ui/src/stores/editor.ts` and editor/diff tab consumers with a persisted-state migration.
- Modify: terminal tree/manager/launch context and fleet/compact terminal consumers.

## Validation implications

- Unit-test target store reset semantics and target-key stability.
- Test cache isolation for identical paths in root and multiple worktrees.
- Test legacy editor-state migration and dirty unavailable tabs.
- Test terminal IDs/grouping and unchanged cwd across selection changes.
- Add browser coverage that switches targets and verifies Explorer, Git, editor, search, media, and terminal creation all use the chosen root while the project switcher label remains unchanged.

## Open questions

No blocking frontend questions remain. Exact visual styling belongs to implementation review; the location, behavior, lifecycle, and accessibility contract are settled.
