# Phase 03: Monaco Diff Viewer

## Context
- Parent: [plan.md](./plan.md)
- Depends on: Phase 01, Phase 02

## Overview
- **Priority:** P1
- **Status:** DONE
- **Effort:** 1d

Integrate Monaco DiffEditor for viewing file diffs with side-by-side/inline toggle and built-in hunk rollback.

## Key Insights

- Monaco `createDiffEditor()` handles all diff rendering — no need for custom diff parsing
- `renderMarginRevertIcon: true` gives per-hunk revert buttons for free
- `hideUnchangedRegions.enabled: true` collapses unchanged code like IntelliJ
- Modified side is editable by default — user can edit changes directly
- Need to save edits back via existing `fs:write` or new API

## Requirements

- Show side-by-side diff for selected file
- Toggle between side-by-side and inline view
- Per-hunk rollback via gutter revert icons
- Edit modified content and save
- Navigate between hunks (prev/next)
- Show diff stats (additions/deletions) in header
- Handle new/deleted files gracefully

## Architecture

New component: `organisms/DiffViewer.tsx`

Props:
```ts
interface DiffViewerProps {
  project: string;
  filePath: string;
  onClose: () => void;
}
```

Uses `useFileDiff(project, path)` hook → returns `{ original, modified, language, hunks }`.

Creates Monaco DiffEditor with:
```ts
{
  renderSideBySide: true,       // togglable
  originalEditable: false,
  renderMarginRevertIcon: true,  // built-in hunk revert
  hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
  diffAlgorithm: "advanced",
}
```

### Hunk Revert Handling
Monaco's built-in revert icon modifies the `modified` model in-memory. After user reverts a hunk, provide "Save" button to write modified content back to disk via `POST /api/git/:project/discard-hunk` or direct file write.

Alternative: Intercept `onDidUpdateDiff` event, detect reverted hunks, call discard API.

Simpler approach: Let user revert hunks in Monaco (in-memory), then "Save" writes the modified model content to disk via existing `fs:write` endpoint.

## Related Code Files

| File | Action |
|------|--------|
| `packages/web/src/components/organisms/DiffViewer.tsx` | Create |
| `packages/web/src/components/organisms/MonacoHost.tsx` | Reference (reuse monacoSetup) |
| `packages/web/src/lib/monacoSetup.ts` | Reuse language detection |
| `packages/web/src/api/queries.ts` | Add `useFileDiff` hook |

## Implementation Steps

1. Create `useFileDiff(project, path)` query hook
2. Create `DiffViewer` organism:
   - Monaco DiffEditor with options above
   - Toolbar: side-by-side/inline toggle, prev/next hunk, save button
   - Diff stats display
3. Handle new files (original = empty string) and deleted files (modified = empty)
4. Add "Save" action — writes modified model content to disk
5. Wire into WorkspacePage — clicking file in ChangedFilesList opens DiffViewer in editor area
6. Add keyboard shortcuts: `Alt+←/→` for prev/next hunk

## Todo

- [x] useFileDiff hook
- [x] DiffViewer component
- [x] Toolbar controls
- [x] Save modified content
- [x] WorkspacePage integration
- [x] Keyboard shortcuts

## Success Criteria

- Diff renders correctly for modified/added/deleted files
- Hunk revert icons work and changes can be saved to disk
- Side-by-side / inline toggle works
- Unchanged regions collapsed by default
- Language detection works (syntax highlighting)

## Risk Assessment

| Risk | L | I | Mitigation |
|------|---|---|------------|
| Monaco DiffEditor bundle size | L | M | Already code-split in MonacoHost |
| Large file diff performance | L | M | `maxFileSize` option; fall back to stats-only view |
