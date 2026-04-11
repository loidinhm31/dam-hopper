---
title: "IDE Font Settings, Workspace Search, Status Bar"
description: "System-wide and editor font sizing with Ctrl+Shift+wheel zoom, workspace-scoped file content search with selection-to-search, and editor status bar with line count"
status: pending
priority: P2
effort: 9h
branch: main
tags: [feature, frontend, backend, ide, settings]
created: 2026-04-11
---

# IDE Font Settings, Workspace Search, Status Bar

## Overview

Three IDE explorer enhancements:
1. System + editor font size settings (persisted in `~/.config/dev-hub/config.toml` `[ui]` section) with Ctrl+Shift+MouseWheel editor zoom.
2. File-content search extended with workspace scope (iterate all projects) and selection-to-search (Ctrl+Shift+F from Monaco prefills with selected text).
3. Editor status bar showing `Ln X, Col Y • N lines • {language}`.

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Backend: global UI config + workspace search scope | done | 2.5h | [phase-01](./phase-01-backend-config-and-search.md) |
| 2 | Frontend: settings store + Appearance UI + font apply | pending | 2.5h | [phase-02](./phase-02-frontend-settings-and-font.md) |
| 3 | Frontend: search panel scope toggle + selection-to-search | pending | 2.5h | [phase-03](./phase-03-frontend-search-enhancements.md) |
| 4 | Frontend: editor status bar | pending | 1.5h | [phase-04](./phase-04-editor-status-bar.md) |

## Dependencies

- No new crates (uses existing `serde`, `tokio::sync::Semaphore`, `ignore`, `regex`).
- No new web deps (Monaco already exposes the APIs needed).

## Architecture Impact

- Extend `GlobalConfig` with optional `UiConfig` (system_font_size, editor_font_size, editor_zoom_wheel_enabled).
- New endpoint `POST /api/global-config/ui` (mirrors `/api/global-config/defaults`).
- Extend `SearchParams` with `scope: Option<"project"|"workspace">`; extend `SearchMatch` with optional `project` field.
- New Zustand stores `stores/settings.ts` and `stores/searchUi.ts`; new components `SettingsAppearanceSection.tsx`, `EditorStatusBar.tsx`; additions to `MonacoHost.tsx`, `SearchPanel.tsx`, `WorkspacePage.tsx`, `EditorTabs.tsx`.

## Key Research Findings

- `GlobalConfig` already derives `Default`; adding `Option<UiConfig>` is fully backward-compatible with existing config files.
- `write_global_config_at` uses `atomic_write` (tempfile + rename) — client-side 500ms debounce is sufficient; no server-side lock needed. Last-writer-wins acceptable.
- `search_files` already uses `ignore` crate (gitignore-aware), runs in `spawn_blocking`. Workspace iteration must use `JoinSet` + `Semaphore(4)` so each project gets its own blocking thread.
- Ctrl+Shift+F already globally bound in `WorkspacePage.tsx:79-86`. Monaco's `editor.addCommand` preempts when editor focused — no conflict.
- Existing pattern is `POST /api/global-config/defaults`; mirror as `POST /api/global-config/ui` (not PATCH) for consistency.
- Monaco font is hardcoded `fontSize: 13` in `MonacoHost.tsx:106`. Built-in `mouseWheelZoom` only handles Ctrl — we need a custom `wheel` listener on `editor.getDomNode()` for Ctrl+Shift.
- No status bar component exists; new `EditorStatusBar.tsx` slots into `EditorTabs` below the editor area.

## Unresolved Questions

- Per-language editor font override? Deferred (YAGNI).
- Stream workspace search via WS for very large workspaces? Follow-up if `/api/fs/search?scope=workspace` benchmarks exceed 1s for typical repos.
- `searchUiStore` as new Zustand slice vs piggyback on `stores/editor.ts`? Leaning toward new small store for separation of concerns (decide in phase 3).
