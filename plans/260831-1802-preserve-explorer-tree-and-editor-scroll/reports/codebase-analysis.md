# Codebase Analysis Report: Explorer Tree & Editor View Position Preservation

## 1. Problem Overview
- **Explorer Tree Collapsing**: Expanding directories in the Explorer panel loses all expansion state whenever the user switches sidebar tools (e.g. Explorer -> Search), collapses the sidebar, toggles workspace mode (IDE <-> Terminal), or reloads the page. This forces the user to manually expand parent directories from the root every time.
- **Editor Scroll / Line Position**: When files are edited and reopened or hydrated after page reload, Monaco editor view state (scroll position, cursor line, folding) can be lost because `editor.ts` excludes `viewState` from its `partialize` configuration and `MonacoHost.tsx` only triggers `saveViewState` on widget blur.

## 2. Codebase Surface Analysis

### Explorer Panel Surface
- [`FileTree.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx):
  - Uses `react-arborist` `<Tree>` component.
  - Currently initializes `expandedDirsRef = useRef<Set<string>>(new Set())` locally.
  - Does not pass `initialOpenState` to `<Tree>`.
  - When unmounted by [`IdeShell.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/templates/IdeShell.tsx), the local ref is destroyed.
  - On remount, `react-arborist` resets its internal `openState` to empty map (`{}`), collapsing all nodes.

### Editor Store Surface
- [`editor.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts):
  - Manages editor tabs and active tab keys.
  - Persists state with `zustand/middleware` under key `dam-hopper:editor-state`.
  - `partialize` explicitly omits `viewState` (lines 1381–1408).
  - `persistedTab` / `migrateEditorState` does not restore `viewState` (lines 279–337).
- [`MonacoHost.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MonacoHost.tsx):
  - `editor.onDidBlurEditorWidget` saves `viewState`.
  - Missing unmount / tab change lifecycle saves, meaning fast tab switches or panel closures before blur can lose the most recent scroll line.

## 3. Selected Architecture
1. **Persistent Zustand Store (`useExplorerTreeStore`)**:
   - Persisted via `localStorage` under `dam-hopper:explorer-tree-state`.
   - Keyed by `projectTargetKey` (`${project}::${worktreePath ?? "root"}`).
   - Manages a map of open directory IDs: `Record<string, boolean>`.
   - Passes `initialOpenState` to react-arborist `<Tree>` and synchronizes changes on `onToggle`.
   - Automatically loads missing children for open directories upon mounting or refetching.
2. **Editor ViewState Persistence**:
   - Include `viewState` in `partialize` and `persistedTab` in `editor.ts`.
   - Capture `editor.saveViewState()` on unmount and before `tabKey` changes in `MonacoHost.tsx`.
