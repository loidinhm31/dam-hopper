# Phase 03: Integration and Verification

## Context Links
- Parent Plan: [plan.md](./plan.md)
- Phase 01: [phase-01-explorer-tree-expansion-store.md](./phase-01-explorer-tree-expansion-store.md)
- Phase 02: [phase-02-editor-viewstate-persistence.md](./phase-02-editor-viewstate-persistence.md)
- Main Page: [`WorkspacePage.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx)

## Overview
- **Priority**: P2
- **Current Status**: Pending
- **Description**: End-to-end integration testing and regression validation across IDE workspace, compact mobile layout, and floating terminal panels to verify tree expansion preservation and editor line position retention.

## Key Insights
- FileTree is used in three places:
  1. Main IDE Left Sidebar ([`WorkspacePage.tsx:1865`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx#L1865))
  2. Mobile / Compact workspace surface ([`WorkspacePage.tsx:2031`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx#L2031))
  3. Floating terminal file panel ([`WorkspacePage.tsx:2174`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx#L2174))
- All three surfaces benefit automatically from `useExplorerTreeStore` when keyed by target.

## Requirements
- **FR-3.1**: Verify Explorer expanded folders stay open across all three shell surfaces (IDE sidebar, mobile surface, and terminal file panel).
- **FR-3.2**: Verify that reopening Explorer leaves previously expanded folders open without unexpected tree jumps.
- **FR-3.3**: Verify that opening/reopening files in the editor view preserves the line and scroll position without resetting to line 1.
- **FR-3.4**: All TypeScript checks, unit tests, and lint checks must pass cleanly.

## Architecture & Test Matrix
```
Testing Matrix:
  ├── Unit Tests:
  │     ├── explorer-tree.test.ts
  │     ├── editor.test.ts
  │     └── FileTree / MonacoHost tests
  ├── Integration Tests:
  │     ├── Tree toggle -> switch tool -> switch back -> verify tree state
  │     ├── Open file -> scroll to line X -> switch tabs -> verify line X
  │     └── Page reload -> verify both tree and editor restore state
  └── Quality Gates:
        ├── pnpm lint
        ├── pnpm check
        └── pnpm --filter @dam-hopper/ui test
```

## Related Code Files
- Test files:
  - [`packages/ui/src/stores/explorer-tree.test.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/explorer-tree.test.ts)
  - [`packages/ui/src/stores/editor.test.ts`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.test.ts)
  - [`packages/ui/src/components/organisms/FileTree.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx)
  - [`packages/ui/src/components/organisms/MonacoHost.tsx`](file:///mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MonacoHost.tsx)

## Implementation Steps
1. Run UI unit tests (`pnpm --filter @dam-hopper/ui test`).
2. Run full test suite and verify no regressions in file tree reveal, context menu, or tab switching.
3. Validate browser tests if applicable (`pnpm --filter @dam-hopper/ui test:browser`).
4. Run ESLint (`pnpm lint`) and TypeScript checks (`pnpm check`).

## Todo List
- [ ] Execute store and organism unit tests
- [ ] Verify IDE shell tree expansion across tool switching
- [ ] Verify terminal floating panel tree expansion
- [ ] Verify editor line position across tab switches and page reload
- [ ] Run `pnpm lint` and `pnpm check`

## Success Criteria
- Zero test regressions.
- No linter or type errors.
- Both requirements (preserved Explorer tree structure and preserved editor line/scroll position) verified and working.

## Risk Assessment
- **Risk**: Concurrent test runs interfering with localStorage.
- **Mitigation**: Clear localStorage in `beforeEach` in test suites.

## Security Considerations
- No sensitive data persisted in localStorage.

## Next Steps
- Present plan to user for approval before starting implementation.
