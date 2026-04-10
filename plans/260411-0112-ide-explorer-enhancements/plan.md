---
title: "IDE Explorer Enhancements"
description: "Add markdown split-view preview, drag-and-drop file move, and global content search to IDE file explorer"
status: done
priority: P2
effort: 7.5h
branch: main
tags: [feature, frontend, backend, ide]
created: 2026-04-11
completed: 2026-04-11
---

# IDE Explorer Enhancements

## Overview

Three enhancements to the IDE file explorer: split-view markdown preview, drag-and-drop file/folder move, and global file content search (Ctrl+Shift+F style).

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Markdown preview + DnD | Done | 3h | [phase-01](./phase-01-markdown-icons-and-dnd.md) |
| 2 | Backend search API | Done | 2h | [phase-02](./phase-02-backend-search-api.md) |
| 3 | Frontend search panel | Done | 2.5h | [phase-03](./phase-03-frontend-search-panel.md) |

## Dependencies

- react-arborist v3.4.3 (already installed) — DnD built-in
- `react-markdown` + `remark-gfm` — new web dependencies for markdown rendering
- `ignore = "0.4"` crate — .gitignore-aware directory walking for search
- `regex = "1"` — already present in Cargo.toml

## Research

- [Frontend research](./research/researcher-01-frontend-report.md)
- [Backend research](./research/researcher-02-backend-report.md)

## Architecture Impact

- New REST endpoint: `GET /api/fs/search` (gated behind `ide_explorer` feature flag)
- New sidebar tab: "search" added to `SidebarTabSwitcher`
- New components: `MarkdownHost`, `MarkdownPreview`, `SearchPanel`, `useFileSearch` hook
- Existing `EditorTabs.tsx` modified (route .md to MarkdownHost)
- Existing `FileTree.tsx` modified (DnD enablement)

## Validation Summary

**Validated:** 2026-04-11
**Questions asked:** 4

### Confirmed Decisions
- **Markdown display:** Split view (Monaco left + rendered preview right) with Edit/Split/Preview toggle
- **DnD drop-on-file:** Move to parent directory (intuitive behavior)
- **Search mode:** Plain text only for MVP (regex-escape user input server-side)
- **.gitignore:** Respect .gitignore patterns using `ignore` crate (skip node_modules, dist, etc.)

### Action Items
- [x] Phase 01 revised: icon-only → full split-view markdown preview (effort 1.5h → 3h)
- [x] Phase 02 revised: walkdir → ignore crate; regex input → plain text with regex::escape()
- [x] Phase 01 DnD: drop-on-file → parent dir logic added
