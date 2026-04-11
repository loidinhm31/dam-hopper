# Phase 01 — Backend: Global UI Config + Workspace Search Scope

## Context links
- Plan: ../plan.md
- Prior search work: ../../260411-0112-ide-explorer-enhancements/phase-02-backend-search-api.md

## Overview
- Date: 2026-04-11
- Description: Add `[ui]` section to global config with validated font sizes; extend `/api/fs/search` with a `scope` parameter that, when set to `workspace`, iterates all configured projects with bounded concurrency and merges results tagged by project.
- Priority: P2
- Implementation status: done
- Review status: done
- Completed: 2026-04-11

## Key Insights
- `GlobalConfig` already derives `Default`; adding `Option<UiConfig>` is fully back-compat — older config files parse without changes.
- `write_global_config_at` already uses `atomic_write` (tempfile + rename). No additional locking needed; client-side debounce (500ms) is sufficient. Last-writer-wins acceptable for font preferences.
- `search_files` already runs in `spawn_blocking`. Workspace iteration must use `JoinSet` + `Semaphore(4)` so each project gets its own blocking thread.
- Existing `/api/global-config/defaults` uses POST not PATCH; mirror that pattern for `/api/global-config/ui` for consistency.

## Requirements
- New `UiConfig { system_font_size: u16, editor_font_size: u16, editor_zoom_wheel_enabled: bool }` with serde defaults (14, 14, true).
- Server validates font sizes in `[10, 32]` on write; rejects with 400 + structured error.
- `SearchParams` gains `scope: Option<String>` (parses to `project`/`workspace`, defaults to `project`).
- `SearchMatch` gains `#[serde(skip_serializing_if = "Option::is_none")] project: Option<String>`.
- Workspace scope merges results from all `state.config.projects`, capped at 500 total (smaller than per-project 1000).
- Per-project elapsed time logged at `tracing::debug` for benchmark visibility.

## Architecture
```
POST /api/global-config/ui  { ui: { system_font_size, editor_font_size, editor_zoom_wheel_enabled } }
   ↓ validate range → write_global_config_at → reload state.global_config
GET  /api/fs/search?project=X&q=Y&scope=project       (existing path, default)
GET  /api/fs/search?q=Y&scope=workspace                (new — project optional in workspace mode)
   ↓ collect projects → JoinSet + Semaphore(4) → search_files per project
   ↓ tag matches with project name → merge → cap 500
```

## Related code files
- server/src/config/schema.rs
- server/src/config/global.rs
- server/src/api/config.rs
- server/src/api/fs.rs
- server/src/api/router.rs
- server/src/fs/ops.rs

## Implementation Steps
1. **Schema:** Add `UiConfig` struct (Default with `system_font_size=14`, `editor_font_size=14`, `editor_zoom_wheel_enabled=true`). Add `pub ui: Option<UiConfig>` to `GlobalConfig`.
2. **Validation helper:** Free function `validate_font_size(u16) -> Result<(), AppError::InvalidInput>` enforcing [10, 32].
3. **Handler:** `update_global_ui` in `api/config.rs` mirroring `update_global_defaults`. Validate each provided field, merge into existing `gc.ui.unwrap_or_default()`, write, swap state.
4. **Route:** `.route("/api/global-config/ui", post(config::update_global_ui))` in router.
5. **Search params:** Add `scope: Option<String>` to `SearchParams`. Make `project` optional when scope=workspace.
6. **SearchMatch:** Add `pub project: Option<String>` (serde skip if None).
7. **Workspace search fn:** New `search_workspace(state: &AppState, q: &str, case: bool, max_per_project: usize, max_total: usize) -> (Vec<SearchMatch>, bool)`. Uses `JoinSet` + `Semaphore::new(4)`. Each task: acquires permit, calls `search_files(project_root, q, case, max_per_project)`, tags each match with `project_name`, returns. Outer loop drains JoinSet, appends until cap, sets `truncated=true` if cap hit.
8. **Search handler:** Branch on `scope`. Project mode unchanged. Workspace mode calls `search_workspace` with `max_per_project=200`, `max_total=500`.
9. **Tests:** unit tests for `validate_font_size`, `UiConfig` default round-trip serde, integration test for `search_workspace` against a temp workspace with two projects.

## Todo list
- [ ] Add `UiConfig` + `validate_font_size`
- [ ] Add `update_global_ui` handler + route
- [ ] Add `scope` param + optional `project` field to `SearchMatch`
- [ ] Implement `search_workspace` with JoinSet + Semaphore
- [ ] Branch search handler on scope
- [ ] Add Rust tests (3 unit + 1 integration)
- [ ] Run `cargo test` — all green

## Success Criteria
- `cargo test` passes including new tests.
- Manual: `curl POST /api/global-config/ui` with valid + invalid sizes returns 200/400 correctly.
- Manual: `curl GET /api/fs/search?q=use&scope=workspace` returns merged results with `project` tags.
- Older `~/.config/dev-hub/config.toml` (no `[ui]`) continues to load without errors.

## Risk Assessment
- **Race on rapid wheel-zoom writes:** atomic_write + 500ms client debounce mitigates; last-writer-wins acceptable.
- **JoinSet panic on a single project:** try_join semantics — log + skip failed projects, continue with the rest.
- **Workspace-mode result cap too low:** 500 chosen as v1 cap; defer streaming to follow-up.

## Security Considerations
- Validate font sizes server-side (reject out-of-range).
- Project names in tagged results come from trusted server config — no sanitization needed for transit, but frontend should still escape on render.
- Search query is regex-escaped before compilation (already handled in `search_files`).

## Next steps
Phase 02 wires the frontend settings UI to the new `/api/global-config/ui` endpoint.
