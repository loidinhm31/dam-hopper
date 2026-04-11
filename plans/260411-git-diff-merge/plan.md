---
title: "Git Diff Viewer & Merge Conflict Resolution"
description: "IntelliJ-style diff viewer with interactive hunk rollback, file staging, and 3-way merge conflict resolution UI"
status: pending
priority: P2
effort: 5d
branch: main
tags: [git, diff, merge, monaco, frontend, backend]
created: 2026-04-11
---

# Git Diff Viewer & Merge Conflict Resolution

## Goal

Add IntelliJ-style git change management to the existing GitPage (or new tab in WorkspacePage): view file diffs with syntax highlighting, interactively rollback/stage individual files or hunks, edit changed content, and resolve merge conflicts via a 3-panel merge UI.

## Scope

**In:** Backend diff/conflict APIs, changed files list panel, Monaco DiffEditor integration, per-file and per-hunk rollback, stage/unstage, merge conflict detection, 3-way merge resolution UI, conflict marker parsing.

**Out:** Commit UI (separate feature), rebase interactive, stash management, blame/history view, multi-repo simultaneous diff.

## Architecture

### Backend (new endpoints in `server/src/api/git.rs`)
- `GET /api/git/:project/diff` — list changed files with status + diff stats
- `GET /api/git/:project/diff/:path` — file-level diff (original + modified content)
- `POST /api/git/:project/stage` — stage file(s)
- `POST /api/git/:project/unstage` — unstage file(s)
- `POST /api/git/:project/discard` — discard file changes (checkout HEAD)
- `POST /api/git/:project/discard-hunk` — discard specific hunk (content manipulation)
- `GET /api/git/:project/conflicts` — list conflicted files with 3-way content
- `POST /api/git/:project/resolve` — write resolved content + stage

### Frontend
- **ChangedFilesList** — tree/list of modified files with status badges (M/A/D/R), grouped by staged/unstaged
- **DiffViewer** — Monaco DiffEditor wrapper, side-by-side + inline toggle, `renderMarginRevertIcon` for hunk rollback
- **MergeConflictEditor** — 3-panel view (theirs | result | ours) with accept/reject per conflict block
- Integration point: new "Changes" tab in WorkspacePage sidebar, or enhance GitPage

### Data Flow
```
ChangedFilesList → select file → fetch diff content → DiffViewer (Monaco DiffEditor)
                                                    → if conflict → MergeConflictEditor
User action (rollback/stage/discard) → POST API → re-fetch diff list
```

## Phase Index

| # | File | Status | Effort | Summary |
|---|------|--------|--------|---------|
| 01 | phase-01-backend-diff-api.md | DONE | 1.5d | Diff endpoints, stage/unstage/discard APIs |
| 02 | phase-02-changed-files-ui.md | DONE | 1d | Changed files list with status, stage/unstage actions |
| 03 | phase-03-diff-viewer.md | pending | 1d | Monaco DiffEditor integration with hunk rollback |
| 04 | phase-04-merge-conflict-ui.md | pending | 1.5d | 3-way merge conflict resolution editor |

## Key Decisions

- **Monaco DiffEditor** over custom diff rendering — built-in hunk revert, syntax highlighting, proven UX
- **Content manipulation** for hunk-level discard — simpler than reverse-patch application
- **3-panel merge UI** over conflict-marker parsing — better UX, matches IntelliJ model
- **Enhance existing GitPage** rather than new route — consolidate git operations
- **git2 for diff generation** — already a dependency, avoids CLI overhead

## Research

- [Monaco Diff Capabilities](./research/researcher-01-monaco-diff.md)
- [git2 Diff & Merge APIs](./research/researcher-02-git2-diff-merge.md)
