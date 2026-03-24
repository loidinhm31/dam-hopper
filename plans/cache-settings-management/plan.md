---
title: "Cache Revalidation & Settings Import/Export"
description: "Add cache clearing, nuclear reset, and TOML settings import/export to Settings page"
status: done
priority: P2
effort: 3h
branch: main
tags: [electron, settings, cache, ipc]
created: 2026-03-24
---

# Cache Revalidation & Settings Import/Export

## Goal
Add maintenance actions (revalidate cache, nuclear reset) and settings portability (import/export workspace TOML) to the existing Settings page.

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 01 | IPC & Electron Backend | done | 1.5h | [phase-01](./phase-01-ipc-electron-backend.md) |
| 02 | Web API & Settings UI | done | 1.5h | [phase-02](./phase-02-web-api-settings-ui.md) |

## Reports
- [Codebase Analysis](./reports/01-codebase-analysis.md)

## Architecture Overview

```
Renderer (Settings Page)
  ├── "Revalidate" button → useClearCache mutation
  │     → IPC cache:clear → clear electron-store
  │     → onSuccess: queryClient.clear() (renderer-side)
  │
  ├── "Nuclear Reset" button (with confirm dialog) → useResetWorkspace mutation
  │     → IPC workspace:reset → dispose PTY + clear store + null context
  │     → sends workspace:changed(null) → renderer shows WelcomePage
  │
  ├── "Export" button → useExportSettings mutation
  │     → IPC settings:export → showSaveDialog + copy TOML file
  │
  └── "Import" button → useImportSettings mutation
        → IPC settings:import → showOpenDialog + validate + write + reload
        → sends config:changed → renderer refreshes
```

## Key Design Decisions
- electron-store instance passed directly to settings handler (not added to CtxHolder — only settings needs it)
- Nuclear reset nullifies `holder.current` and emits `workspace:changed` with no data — existing App.tsx logic handles showing WelcomePage when `status.ready = false`
- Export reads raw TOML from disk to preserve formatting/comments
- Import uses existing `readConfig()` for Zod validation before overwriting
