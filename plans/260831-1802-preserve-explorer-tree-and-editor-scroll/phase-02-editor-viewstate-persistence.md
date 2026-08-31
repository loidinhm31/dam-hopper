# Phase 02: Editor ViewState Persistence

## Context Links
- Parent Plan: [plan.md](./plan.md)
- Codebase Analysis: [codebase-analysis.md](./reports/codebase-analysis.md)
- Editor Store: [`editor.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts)
- Monaco Host Component: [`MonacoHost.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MonacoHost.tsx)
- Tab Host Component: [`EditorTabs.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx)

## Overview
- **Priority**: P2
- **Current Status**: Pending
- **Description**: Ensure editor tabs persist their Monaco `viewState` (cursor line, column, scroll position, and code folds) to `localStorage` and restore it during tab hydration, tab switching, and component unmount/remount cycles without tab-switch race conditions.

## Key Insights
- `MonacoHost.tsx` currently only invokes `onViewStateChange` within `editor.onDidBlurEditorWidget`. If a user is actively typing or viewing a line and switches panels or closes the window without triggering blur, the latest position is not committed to the store.
- **Tab-Switch Race Condition**: When switching between tabs in `EditorTabs.tsx`, `activeTab` changes immediately on render. If `MonacoHost` saves the previous editor's viewState during the `tabKey` transition effect and calls `onViewStateChange(vs)`, `EditorTabs` would write the previous tab's viewState into the *new active tab's key*. To prevent this, `onViewStateChange` must accept an optional `tabKey` argument: `(vs: unknown, targetKey?: string) => void`.
- In `packages/ui/src/stores/editor.ts`, the `partialize` configuration explicitly excludes `viewState`. When the page reloads, `persistedTab` constructs tab objects without `viewState`, resetting the editor view to line 1.
- Monaco's `ICodeEditorViewState` is a lightweight JSON-serializable object containing cursor positions and scroll offsets.

## Requirements
- **FR-2.1**: Opening a file, scrolling down or navigating to a specific line, and switching tabs or sidebar panels must preserve that exact line position when returning to the file.
- **FR-2.2**: `viewState` must be persisted in `localStorage` under `dam-hopper:editor-state` so page reloads restore the exact cursor line and scroll position.
- **FR-2.3**: `MonacoHost` must reliably commit the active `viewState` prior to unmounting or switching the active tab key, scoped to the correct originating tab key.

## Architecture
```
User edits at Line 120 in Monaco
         │
         ├── onDidBlurEditorWidget
         ├── beforeUnmount (with key = prevTabKeyRef.current)
         └── tabKey change effect in MonacoHost (with key = prevTabKeyRef.current)
         │
         ▼
useEditorStore.saveViewState(tabKey, vs)
         │
         ▼
localStorage ('dam-hopper:editor-state')
  └── tabs: [{ key, path, ..., viewState: { cursorState, viewState, ... } }]
         │
         ▼ (Page reload / Tab hydration)
persistedTab(raw) -> restores { ...tab, viewState: raw.viewState }
         │
         ▼
MonacoHost mount / tabKey effect -> editor.restoreViewState(viewState)
```

## Related Code Files
- Modify: [`packages/ui/src/stores/editor.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts)
- Modify: [`packages/ui/src/stores/editor.test.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.test.ts)
- Modify: [`packages/ui/src/components/organisms/MonacoHost.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MonacoHost.tsx)
- Modify: [`packages/ui/src/components/organisms/EditorTabs.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx)
- Modify: [`packages/ui/src/components/organisms/MarkdownHost.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MarkdownHost.tsx)

## Implementation Steps
1. Update `packages/ui/src/stores/editor.ts`:
   - In `partialize` (around line 1382), add `viewState: t.viewState` to the persisted tab payload.
   - In `persistedTab` (around line 279), extract `viewState: asRecord(raw.viewState) ?? undefined` and assign it to the hydrated tab.
   - In `migrateEditorState` (around line 340), ensure `viewState` passes through to migrated tabs.
2. Update `packages/ui/src/components/organisms/MonacoHost.tsx`:
   - Update `MonacoHostProps` so `onViewStateChange: (vs: unknown, targetKey?: string) => void`.
   - Maintain `prevTabKeyRef = useRef(tabKey)` and `onViewStateChangeRef = useRef(onViewStateChange)`.
   - On `tabKey` changes, if `prevTabKeyRef.current !== tabKey`, call `editor.saveViewState()` and commit it with `prevTabKeyRef.current` before updating `prevTabKeyRef.current = tabKey`.
   - On unmount, call `editor.saveViewState()` and commit it with `prevTabKeyRef.current`.
3. Update `packages/ui/src/components/organisms/EditorTabs.tsx` and `MarkdownHost.tsx`:
   - In `EditorTabs.tsx`, pass `onViewStateChange={(vs, key) => saveViewState(key ?? activeTab.key, vs)}`.
   - Forward the extended signature through `MarkdownHost.tsx`.
4. Update `packages/ui/src/stores/editor.test.ts`:
   - Add tests verifying that `saveViewState` persists `viewState` through `partialize` and that `migrateEditorState` / `persistedTab` correctly preserves it during hydration.

## Todo List
- [ ] Update `partialize` in `editor.ts` to include `viewState`
- [ ] Update `persistedTab` in `editor.ts` to restore `viewState`
- [ ] Update `onViewStateChange` signature in `EditorTabs.tsx` and `MarkdownHost.tsx`
- [ ] Add unmount / pre-tab-switch key-scoped view state save in `MonacoHost.tsx`
- [ ] Add unit tests in `editor.test.ts` for view state persistence and hydration

## Success Criteria
- Opening a file, scrolling to line 200, placing cursor, and refreshing the browser leaves the file positioned at line 200 with cursor in place.
- Rapid switching between tabs and sidebar tools preserves line and scroll positions across all open tabs without state cross-contamination.

## Risk Assessment
- **Risk**: Stale view state if file content changes significantly on disk while tab is closed.
- **Mitigation**: Monaco's `restoreViewState` gracefully handles lines beyond model length by clamping to file line bounds without crashing.

## Security Considerations
- ViewState contains only UI coordinates (line, column, scroll offsets). No sensitive keys or credentials are stored.

## Next Steps
- Proceed to Phase 03 to verify both Explorer tree expansion and Editor view line position together.
