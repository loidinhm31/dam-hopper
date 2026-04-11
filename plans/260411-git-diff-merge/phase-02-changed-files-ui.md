# Phase 02: Changed Files List UI

## Context
- Parent: [plan.md](./plan.md)
- Depends on: Phase 01
- **Completed:** 2026-04-11

## Overview
- **Priority:** P1
- **Status:** DONE
- **Effort:** 1d

Build the changed files panel showing staged/unstaged files with status badges and stage/unstage/discard actions.

## Key Insights

- IntelliJ groups files into "Staged" and "Unstaged" sections
- Each file shows status icon (M=modified, A=added, D=deleted, R=renamed, C=conflicted)
- Right-click context menu for stage/unstage/discard/rollback
- Click to open diff viewer

## Requirements

- Fetch changed files list from Phase 01 API
- Group by staged/unstaged sections
- Show file path, status badge, +/- stats
- Stage/unstage individual files or all
- Discard changes (with confirmation)
- Click file → open in DiffViewer (Phase 03)
- Auto-refresh on git operations or file changes

## Architecture

New components:
- `organisms/ChangedFilesList.tsx` — main panel with staged/unstaged sections
- `molecules/ChangedFileEntry.tsx` — single file row with actions
- `atoms/GitStatusBadge.tsx` — M/A/D/R/C colored badge

Integration: Add "Changes" tab to WorkspacePage sidebar (alongside Files/Terminals tabs).

## Related Code Files

| File | Action |
|------|--------|
| `packages/web/src/components/organisms/ChangedFilesList.tsx` | Create |
| `packages/web/src/components/molecules/ChangedFileEntry.tsx` | Create |
| `packages/web/src/components/atoms/GitStatusBadge.tsx` | Create |
| `packages/web/src/components/pages/WorkspacePage.tsx` | Add "Changes" tab |
| `packages/web/src/api/queries.ts` | Add `useDiffFiles` hook |

## Implementation Steps

1. Create `useDiffFiles(project)` query hook — polls every 3s or invalidates on git ops
2. Create `GitStatusBadge` atom
3. Create `ChangedFileEntry` molecule — file name, badge, +/- counts, action buttons (stage/unstage/discard)
4. Create `ChangedFilesList` organism — collapsible Staged/Unstaged sections
5. Add "Changes" tab to WorkspacePage sidebar
6. Wire stage/unstage/discard mutations with optimistic updates
7. Add confirmation dialog for discard

## Todo

- [ ] Query hook
- [ ] GitStatusBadge
- [ ] ChangedFileEntry
- [ ] ChangedFilesList
- [ ] WorkspacePage integration
- [ ] Mutations + optimistic updates
- [ ] Discard confirmation

## Success Criteria

- Changed files list matches `git status` output
- Stage/unstage/discard work correctly with immediate UI feedback
- Clicking file triggers diff viewer (Phase 03)
- List auto-refreshes after operations
