---
title: "Explorer HTML File Preview"
description: "Add HTML file preview option in Explorer context menu and an in-editor Edit/Split/Preview host with sandboxed iframe."
status: in_progress
priority: P2
effort: 6h
branch: develop
tags: [feature, frontend, explorer, editor, preview]
created: 2026-09-12
---

# Explorer HTML File Preview

## Outcome

Add an in-editor sandboxed HTML live preview (`HtmlHost`) with Edit | Split | Preview modes (mirroring `MarkdownHost`), and integrate a "Preview" action into the Explorer file tree context menu (`TreeContextMenu`) for `.html` and `.htm` files.

## Preflight Contract

- **Output**: HTML file helper (`html-file.ts`), view mode persistence helper (`html-view-mode-persistence.ts`), sandboxed `HtmlPreview`, split/toggle container `HtmlHost`, `EditorTabs` routing, and `TreeContextMenu` / `FileTree` preview action.
- **Acceptance**:
  - Right-clicking `.html`/`.htm` file in Explorer displays "Preview" with an eye icon.
  - Clicking "Preview" opens the file directly in preview mode in the editor.
  - Editor displays Edit | Split | Preview mode toggle for HTML files.
  - Preview renders live edits debounced (200ms) inside a sandboxed iframe without `allow-same-origin`.
  - User mode selection is persisted to localStorage.
- **In scope**: `packages/ui` helpers, components, stores, and test suites.
- **Out of scope**: Backend static file server, external browser proxy, port forwarding, or relative multi-file asset resolution.
- **Testing**: Vitest unit tests for detection/persistence/context-menu, component tests for `HtmlPreview`/`HtmlHost`, and TypeScript check.

## Decision and Trade-offs

| Option | Decision | Trade-off |
|---|---|---|
| Sandboxed iframe with `srcdoc` + `HtmlHost` | Chosen | Zero backend overhead, live buffer typing feedback, strict origin isolation (`null` origin). |
| Dedicated read-only tab | Rejected | Clutters tab bar with duplicate entries and lacks split-screen editing. |
| Backend static file server | Rejected | Heavyweight, requires port allocation/origin auth, cannot preview unsaved buffer edits. |

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | HTML File Helper, Mode Persistence, and Sandboxed HtmlPreview | Completed (2026-09-12 22:45) | 2h | [phase-01](./phase-01-helpers-and-html-preview.md) |
| 2 | HtmlHost Editor Component and EditorTabs Routing | Pending | 2h | [phase-02](./phase-02-html-host-and-editor-tabs.md) |
| 3 | Explorer Context Menu Integration and Test Coverage | Pending | 2h | [phase-03](./phase-03-explorer-menu-and-tests.md) |

## Side-Effect Review

- [x] Auth/session/permissions: No effect. Sandboxed iframe lacks `allow-same-origin`, preventing credential access.
- [x] API/backend: No backend routes or Rust changes required.
- [x] Data/state: Uses versioned `localStorage` scalar for mode preference.
- [x] Performance: 200ms debounce prevents iframe thrashing during typing.

## Unresolved Questions

- None.
