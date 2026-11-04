# Preflight & Research: Workspace File Tree and Marked Projects

**Date:** 2026-11-03 | **Status:** Complete | **Scope:** Web OS & Server Contracts

## 1. Executive Summary

Transition DamHopper from project-required file access to workspace-wide filesystem access with explicit project marking and project-gated Git. Files opens at authorized workspace root even with zero configured projects. Projects mode filters to marked roots. Unmarked repositories cannot use Git until marked.

## 2. Codebase Touchpoints & Architecture

| Layer | Files | Current State | Required Changes |
|---|---|---|---|
| **Root & Config** | `server/src/config/schema.rs`<br>`server/src/config/parser.rs`<br>`server/src/api/config.rs`<br>`server/src/state.rs` | `workspace_dir` is config parent; `ProjectSandbox` tracks projects; `PUT /api/config` and `PATCH /api/config/projects/:name` exist | Authoritative browse root resolution (`workspace.root`); add `POST /api/config/projects` (mark) and `DELETE /api/config/projects/:name` (unmark); integrate `WorkspaceSandbox` as first-class authority |
| **FS Targets & WS** | `server/src/workspace_target.rs`<br>`server/src/fs/sandbox.rs`<br>`server/src/fs/mod.rs`<br>`server/src/api/fs.rs`<br>`server/src/api/ws.rs`<br>`server/src/api/ws_protocol.rs` | All FS ops require `project`; WS subscriptions keyed by project; workspace search federates projects | Discriminated filesystem target: `Workspace` vs `Project(ProjectTargetRef)`; support workspace target across list/read/stat/write/watch/search/upload; search workspace root directly |
| **Terminal & Git** | `server/src/api/terminal.rs`<br>`server/src/api/git.rs` | Untargeted terminal falls back to `$HOME`; Git already requires valid project | Validate workspace folder terminal CWD against workspace sandbox; keep Git strictly gated on marked projects; return informative error for unmarked repo |
| **Client Core** | `packages/ui/src/api/ownership.ts`<br>`packages/ui/src/api/client.ts`<br>`packages/ui/src/api/fs-types.ts`<br>`packages/ui/src/hooks/use-fs-subscription.ts`<br>`packages/ui/src/stores/editor.ts` | Targets assume project; editor keys include project name | Add discriminated `FsTargetRef` (`{ kind: "workspace" }` vs `{ kind: "project", ... }`); canonical editor tab key based on canonical path/identity across routes |
| **OS Files & UI** | `packages/ui/src/os/apps/FilesApp.tsx`<br>`packages/ui/src/components/organisms/FileTree.tsx`<br>`packages/ui/src/os/persistence.ts`<br>`packages/ui/src/os/apps/SearchApp.tsx` | Blocks on zero projects; forces project dropdown; only persists `selectedPath` | Dual modes: Workspace (default) & Projects; project badges on folders; context menu "Mark as Project" / "Unmark Project"; persist `mode` & `projectFilter` in window appState |

## 3. Scope Boundary

- **In Scope:**
  - Server browse root resolution & validation (`dam-hopper.toml` `[workspace]` root).
  - Server target discrimination (`Workspace` vs `Project`) across REST (`/api/fs/*`) and WebSocket protocol (`fs:*`).
  - Server project mark (`POST /api/config/projects`) and unmark (`DELETE /api/config/projects/:name`) with atomic config update and cache/watcher invalidation.
  - Folder terminal launch validated against workspace root when project is omitted.
  - Client discriminated filesystem target types and transports.
  - `FilesApp` and `FileTree` dual modes (Workspace / Projects), project badges, Mark/Unmark context actions.
  - Editor shared canonical identity across workspace and project routes.
  - Search workspace targeting direct root.
  - Document breaking changes for Android.
- **Out of Scope:**
  - Android client changes or compatibility shims.
  - Auto-discovery / scanning for projects or Git repositories.
  - Unregistered Git operations or automatic `git init`.
  - Multi-workspace server hosting or desktop sync.

## 4. Key Side-Effect Risks & Mitigations

1. **Root Exposure Risk:** Defaulting to config parent could leak `~/.config/dam-hopper/` credentials (`server-token`, `auth.db`).
   - *Mitigation:* Explicit canonical root validation; reject browse root if it resolves to or contains sensitive server config directory without explicit confirmation.
2. **Editor Buffer Divergence:** Opening `src/main.rs` via Workspace vs Projects creating two Monaco models / dirty buffers.
   - *Mitigation:* Unify editor file tab key by canonical server path or workspace-relative path on that server profile.
3. **Concurrent Config Corruption:** Marking/unmarking projects overwriting concurrent config edits.
   - *Mitigation:* Re-read latest config with lock, apply mutation, validate through schema, atomic write, then trigger `reconcile_and_publish_config_locked`.
4. **Watcher Resource Exhaustion:** Watching whole workspace recursively.
   - *Mitigation:* Keep existing lazy Arborist model: watch only expanded directories / target roots.

## 5. Testing & Verification Strategy

- **Server Tests (`cargo test`):**
  - Unit tests for browse root resolution and `WorkspaceSandbox`.
  - REST FS tests for workspace-targeted list, read, write, stat, search.
  - WS tests for workspace-targeted subscriptions and mutations.
  - Config API tests for `POST /api/config/projects` and `DELETE /api/config/projects/:name`.
  - Terminal CWD validation tests under workspace root.
- **UI Tests (`vitest`):**
  - Unit tests for target normalization, canonical editor keying, and persistence sanitization.
  - Component tests for `FileTree` (badges, Workspace mode, Projects mode, Mark/Unmark dialogs).
  - Integration tests for `FilesApp` with 0 projects (opens workspace tree, no blocking error screen).
