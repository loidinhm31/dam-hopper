# Android Contract Impacts: Workspace File Tree and Marked Projects

**Date:** 2026-11-03
**Status:** Invariant Documentation (Android changes explicitly excluded from current scope)
**Reference:** `plans/reports/brainstorm-261103-1552-workspace-file-tree-project-marks.md`

## 1. Overview

The Web OS workspace file tree redesign decouples whole-workspace filesystem access from configured project registration. Per project directive, Android implementation, compatibility adapters solely for Android, and Android qualification were excluded from this implementation.

This document serves as the authoritative record of the breaking REST and WebSocket contract deltas that the companion Android client (`native/android-app`) must adopt during its subsequent redesign.

---

## 2. Breaking Wire Contracts

### 2.1. Filesystem Target Discrimination (REST)

Prior to this redesign, all REST filesystem endpoints (`/api/fs/*`) strictly required a `project` query parameter.

**New Contract:**
All `/api/fs/*` endpoints now support an explicit target discriminator:
- **Workspace Target:** `targetType=workspace`. The `project` parameter MUST NOT be passed.
- **Project Target:** `targetType=project&project=<name>[&worktreePath=<path>]`. (For backward compatibility, omitting `targetType` when `project` is present is treated as a project target).
- **Mutual Exclusion & Rejection:** Passing both `targetType=workspace` and `project` returns HTTP 400 `INVALID_FS_TARGET`. Omitting both `targetType` and `project` returns HTTP 400 `INVALID_FS_TARGET`.

Affected endpoints:
- `GET /api/fs/list`
- `GET /api/fs/read`
- `GET /api/fs/stat`
- `POST /api/fs/create-file`
- `POST /api/fs/create-dir`
- `POST /api/fs/rename`
- `POST /api/fs/move`
- `POST /api/fs/delete`
- `GET /api/fs/download`
- `POST /api/fs/upload`

### 2.2. Canonical File Identity Header & DTO

- `GET /api/fs/read` now returns a mandatory `x-file-identity` HTTP response header containing serialized JSON:
  ```json
  {
    "workspaceId": "ws-uuid-or-name",
    "workspaceEpoch": 1,
    "canonicalPath": "/canonical/path/to/file.ext"
  }
  ```
- `GET /api/fs/stat` returns `fileIdentity: { workspaceId, workspaceEpoch, canonicalPath }` in the response JSON.
- `GET /api/fs/list` entries include `fileIdentity`.

Android clients must scope document model keys by `["file", profileId, workspaceId, workspaceEpoch, canonicalPath]` rather than project-relative path strings to avoid duplicate edit buffers when a file is opened through multiple navigation routes or across reconnects and profile switches.

### 2.3. WebSocket FS Protocol Envelope

WebSocket filesystem commands (`fs:*`) previously used top-level `project` and `worktree_path` fields.

**New Contract:**
Messages now accept an explicit nested `target` object:
```json
// Workspace target:
{
  "kind": "fs:subscribe_tree",
  "req_id": 12,
  "target": { "type": "workspace" },
  "path": ""
}

// Project target:
{
  "kind": "fs:subscribe_tree",
  "req_id": 13,
  "target": {
    "type": "project",
    "project": "my-app",
    "worktreePath": "/optional/worktree"
  },
  "path": "src"
}
```

Affected WebSocket messages:
- `fs:subscribe_tree`
- `fs:read`
- `fs:write_begin`
- `fs:op`
- `fs:upload_begin`
- `fs:put_begin`
- `fs:put_save`

Responses (`fs:read_result`, `fs:put_save_result`) now include `file_identity: { workspaceId, workspaceEpoch, canonicalPath }`.

### 2.4. Project Marking REST Endpoints

Two new REST endpoints govern the dynamic project metadata lifecycle:
- **`POST /api/config/projects`**:
  ```json
  {
    "name": "services-api",
    "target": { "type": "workspace" },
    "path": "services/api",
    "projectType": "custom",
    "tags": ["backend"]
  }
  ```
  Returns `{ "ok": true, "name": "...", "path": "..." }`. Fails with HTTP 409 `DUPLICATE_PROJECT_NAME` or `DUPLICATE_PROJECT_ROOT` if conflicting.
- **`DELETE /api/config/projects/{name}`**:
  Unmarks a project from `config.toml` without deleting filesystem contents or killing processes.

### 2.5. Folder Terminal Launch

`POST /api/terminal` (and WS `terminal:create`):
- Now accepts optional `target: { "type": "workspace" }`.
- When targeting a workspace folder, `project` and `worktreePath` must NOT be provided.
- `cwd` is strictly validated to be canonically contained within the authorized workspace root.
- Traversal escapes outside the workspace root fail closed with HTTP 400 `INVALID_FS_TARGET` without falling back to `$HOME`.

### 2.6. Search Scope Changes

`GET /api/fs/search` and `GET /api/fs/search-paths`:
- When `targetType=workspace` (or `scope=workspace`), searches the entire authorized workspace directory directly.
- The server no longer federates through configured projects when workspace search is requested.

### 2.7. Project-Gated Git Enforcement

All Git operations (`/api/git/*`) strictly require a marked project:
- Supplying a workspace target or an unconfigured directory returns HTTP 404 `UNKNOWN_PROJECT`.
- Android UI must gate Git views on configured projects and show "Mark as project to use Git" for unmarked directories.

---

## 3. Required Android Client Actions (Future Scope)

When the Android client is updated to consume these contracts:
1. Update `KMP Shared Core` (`native/android-app/shared`) models:
   - Introduce `FsTargetRef` sealed class (`Workspace` vs `Project`).
   - Add `FileIdentity` data class.
   - Update `WsConnection` serialization for nested `target`.
2. Update Android API client:
   - Add `POST /api/config/projects` and `DELETE /api/config/projects/{name}`.
   - Update `fsList`, `fsRead`, `fsStat`, `fsSearch` to pass `targetType`.
3. Update Jetpack Compose UI:
   - Add dual navigation modes (Workspace / Projects).
   - Show `[Project]` badges on folders matching marked project roots.
   - Add context menu actions to mark/unmark projects.
   - Gate Git screen on marked project selection.
