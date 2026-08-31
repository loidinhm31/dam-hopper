# Phase 01: Explorer Tree Expansion Store

## Context Links
- Parent Plan: [plan.md](./plan.md)
- Codebase Analysis: [codebase-analysis.md](./reports/codebase-analysis.md)
- Primary Component: [`FileTree.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx)
- Shell Layout: [`IdeShell.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/templates/IdeShell.tsx)

## Overview
- **Priority**: P2
- **Current Status**: Complete
- **Completed**: 2026-08-31
- **Validation**: Passed (Unit tests in `explorer-tree.test.ts` passed; full UI Vitest 213 files / 1,419 tests passed; UI TypeScript build passed)
- **Description**: Create a persistent Zustand store `useExplorerTreeStore` to track expanded directories per target (`${project}::${targetKey}`). Connect `FileTree.tsx` to restore `initialOpenState`, update open states on user interaction, and automatically fetch children for expanded directories upon remounting.

## Key Insights
- `IdeShell` unmounts inactive sidebar tools to save resources, destroying any local `useRef` / `useState` within `FileTree`.
- `react-arborist` supports `initialOpenState: { [id: string]: boolean }` and triggers `onToggle: (id: string) => void`.
- Target Scope Key: `projectTargetCacheKey` alone only returns `"root"` or `"worktree:<path>"`, without project name. To prevent cross-project collisions, the store must use `explorerTreeScopeKey(target)` = `${normalized.project}::${projectTargetCacheKey(normalized)}` (matching `editorTargetScopeKey`).
- When `FileTree` remounts with persisted open state, `useFsSubscription` initially only has root-level nodes. The cascading `loadChildren` in `useEffect` must read from `useExplorerTreeStore` and handle missing/deleted directories gracefully by pruning them if `loadChildren` fails.
- Moving directories (via Drag & Drop) and renaming folders must update paths in `useExplorerTreeStore`.

## Requirements
- **FR-1.1**: Expanded directories in the Explorer panel must remain expanded when switching sidebar tools (Explorer -> Search -> Explorer).
- **FR-1.2**: Expanded directories must remain expanded when collapsing/reopening the sidebar, switching between IDE and Terminal workspace modes, and after page reloads.
- **FR-1.3**: Store state must be scoped per project and target/worktree via `explorerTreeScopeKey`.
- **FR-1.4**: Deleted, renamed, or moved paths must be cleanly pruned or updated in the store.

## Architecture
```
useExplorerTreeStore (Zustand + persist localStorage: 'dam-hopper:explorer-tree-state')
  ├── openMapByTarget: Record<string, Record<string, boolean>>
  ├── setFolderOpen: (scopeKey: string, path: string, isOpen: boolean) => void
  ├── prunePath: (scopeKey: string, path: string) => void
  └── renamePath: (scopeKey: string, oldPath: string, newPath: string) => void
         │
         ▼
FileTree.tsx
  ├── scopeKey = explorerTreeScopeKey(requestTarget)
  ├── initialOpenState={openMapByTarget[scopeKey]}
  ├── onToggle={(id) => setFolderOpen(scopeKey, id, treeRef.current?.isOpen(id) ?? false)}
  ├── handleMove / handleRename -> renamePath(scopeKey, oldPath, newPath)
  ├── handleDelete -> prunePath(scopeKey, path)
  └── useEffect: collectUnloadedExpanded(nodes, openMap) -> loadChildren(id).catch(() => prunePath(scopeKey, id))
```

## Related Code Files
- Modify: [`packages/ui/src/components/organisms/FileTree.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx)
- Create: [`packages/ui/src/stores/explorer-tree.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/explorer-tree.ts)
- Create: [`packages/ui/src/stores/explorer-tree.test.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/explorer-tree.test.ts)

## Implementation Steps
1. Create `packages/ui/src/stores/explorer-tree.ts`:
   - Export helper `explorerTreeScopeKey(target: ProjectTargetInput): string`.
   - Define `ExplorerTreeState` interface with `openMapByTarget: Record<string, Record<string, boolean>>`.
   - Implement `setFolderOpen(scopeKey: string, path: string, isOpen: boolean)`. When `isOpen === false`, delete key to keep storage compact.
   - Implement `prunePath(scopeKey: string, path: string)` (removes `path` and any child paths starting with `path + "/"`).
   - Implement `renamePath(scopeKey: string, oldPath: string, newPath: string)` (renames exact key and updates all descendant keys with `oldPath + "/"` prefix).
   - Add `persist` middleware using `localStorage` key `dam-hopper:explorer-tree-state`.
2. Add comprehensive unit tests in `packages/ui/src/stores/explorer-tree.test.ts` testing open, close, prune, rename, move, and target isolation.
3. Update `FileTree.tsx`:
   - Replace ephemeral `expandedDirsRef` entirely with `useExplorerTreeStore`.
   - Compute `scopeKey = explorerTreeScopeKey(requestTarget)` to retrieve `openMap`.
   - Pass `initialOpenState={openMap}` to `<Tree>`.
   - Add `onToggle` handler to `<Tree>`: read `treeRef.current?.isOpen(id)` and update store; if opening an unloaded node, trigger `loadChildren(id)`.
   - In `handleActivate`, ensure directory toggles trigger child loading on demand.
   - Update `useEffect` for `collectUnloadedExpanded` to read from the store's `openMap` and catch errors with `prunePath(scopeKey, id)`.
   - In `handleDeleteConfirm`, call `prunePath(scopeKey, node.id)`.
   - In `handleRenameSubmit` and `handleMove`, call `renamePath(scopeKey, oldPath, newPath)`.

## Todo List
- [x] Create `packages/ui/src/stores/explorer-tree.ts` with `explorerTreeScopeKey`
- [x] Add unit tests in `packages/ui/src/stores/explorer-tree.test.ts`
- [x] Update `FileTree.tsx` to remove `expandedDirsRef` and bind to `useExplorerTreeStore`
- [x] Hook deletion, renaming, and DnD move to store pruning/renaming
- [x] Verify automatic cascading child loading for persisted open directories

## Success Criteria
- Expanding directories `a/b/c` in Explorer, switching to Search panel, and switching back to Explorer renders `a/b/c` expanded.
- Refreshing browser keeps previously expanded folders open.
- Switching to another project target does not leak expanded state from previous projects.

## Risk Assessment
- **Risk**: Over-persisting invalid paths when files are deleted externally (e.g. via git or terminal).
- **Mitigation**: When `loadChildren` returns an error or empty node for an expanded path that no longer exists on server, remove it from the open map.

## Security Considerations
- Only relative folder paths and boolean flags are stored in localStorage; no credentials or file contents are persisted.

## Next Steps
- Proceed to Phase 02 to implement Editor ViewState and line position persistence.
