# Phase 04: Merge Conflict Resolution UI

## Context
- Parent: [plan.md](./plan.md)
- Depends on: Phase 01, Phase 03

## Overview
- **Priority:** P2
- **Status:** DONE
- **Effort:** 1.5d

Build IntelliJ-style 3-panel merge conflict resolution editor.

## Key Insights

- IntelliJ shows: Left (Theirs) | Center (Result, editable) | Right (Ours)
- Each conflict block has "Accept Left", "Accept Right", "Accept Both" buttons
- Result panel starts as the ancestor (base) version
- Conflict blocks highlighted with distinct colors (green=ours, blue=theirs, red=conflict)
- Monaco DiffEditor doesn't support 3-way — need custom layout with 3 editors

## Requirements

- Detect conflicted files from Phase 01 conflicts API
- Show 3-panel merge view: theirs | result | ours
- Per-conflict-block accept/reject buttons inline
- Result panel is editable — user can manually resolve
- "Accept All from Left/Right" bulk actions
- Mark as resolved → writes content + stages file
- Synchronized scrolling across all 3 panels
- Visual markers for conflict regions

## Architecture

### Component: `organisms/MergeConflictEditor.tsx`

Layout: 3 Monaco editors in a horizontal flex container with headers.

```
┌──────────────┬──────────────┬──────────────┐
│  Theirs      │   Result     │   Ours       │
│  (readonly)  │  (editable)  │  (readonly)  │
│              │              │              │
│  [Accept →]  │              │  [← Accept]  │
│              │              │              │
└──────────────┴──────────────┴──────────────┘
        [ Accept All Theirs | Accept All Ours | Mark Resolved ]
```

### Conflict Block Detection

Parse the ancestor, ours, theirs content. Use a diff algorithm (or git2's merge file analysis) to identify conflict regions. Each conflict region gets:
- Line range in ancestor
- Corresponding content from ours/theirs
- Action buttons rendered as Monaco decorations/widgets

### Synchronized Scrolling
```ts
editor1.onDidScrollChange(e => {
  editor2.setScrollTop(e.scrollTop);
  editor3.setScrollTop(e.scrollTop);
});
```

### Resolution Flow
1. User opens conflicted file → 3-panel view
2. For each conflict: accept theirs, accept ours, or manually edit result
3. Click "Mark Resolved" → `POST /api/git/:project/resolve` with result content
4. File staged, conflict cleared, returns to changed files list

## Related Code Files

| File | Action |
|------|--------|
| `packages/web/src/components/organisms/MergeConflictEditor.tsx` | Create |
| `packages/web/src/lib/conflictParser.ts` | Create — diff ancestor vs ours/theirs to find conflicts |
| `packages/web/src/components/molecules/ConflictBlock.tsx` | Create — accept/reject widget |
| `packages/web/src/api/queries.ts` | Add `useConflicts`, `useResolveConflict` |

## Implementation Steps

1. Create `useConflicts(project)` + `useResolveConflict()` hooks
2. Create `conflictParser.ts` — given ancestor/ours/theirs, compute conflict regions
   - Option A: Use `diff` npm package to diff ancestor↔ours and ancestor↔theirs, find overlapping regions
   - Option B: Parse conflict markers from workdir file if merge left markers
   - Recommendation: Option B is simpler — parse `<<<<<<<`, `=======`, `>>>>>>>` markers from the workdir file to identify conflict regions, use ancestor/ours/theirs from API for the 3-panel display
3. Create `MergeConflictEditor` — 3 Monaco editors with sync scroll
4. Create conflict region decorations (colored backgrounds, inline widgets)
5. Implement accept/reject per conflict block — modifies result editor model
6. Implement "Mark Resolved" — POST resolve API
7. Wire into WorkspacePage — conflicted files in ChangedFilesList open MergeConflictEditor
8. Add bulk actions (accept all theirs / all ours)

## Todo

- [ ] Conflict parser
- [ ] MergeConflictEditor layout
- [ ] Synchronized scrolling
- [ ] Per-conflict accept/reject widgets
- [ ] Resolve API integration
- [ ] WorkspacePage routing (conflict vs normal diff)
- [ ] Bulk accept actions

## Success Criteria

- Conflicted files detected and shown with "C" badge
- 3-panel view renders with correct content per side
- Per-block accept/reject works, updates result in real-time
- Manual editing in result panel works
- "Mark Resolved" writes content and stages file
- Scrolling synchronized across panels

## Risk Assessment

| Risk | L | I | Mitigation |
|------|---|---|------------|
| Complex conflict region computation | M | H | Start with conflict marker parsing (simpler); upgrade to diff-based later |
| 3 Monaco editors = heavy rendering | M | M | Lazy-mount; reuse models; consider showing 2-panel with toggleable sides |
| Edge cases (binary conflicts, rename+modify) | L | M | Show "cannot resolve in UI" message, link to terminal |

## Security Considerations

- Resolve endpoint writes arbitrary content — scoped to sandbox, same as existing `fs:write`
- No new auth requirements beyond existing bearer token
