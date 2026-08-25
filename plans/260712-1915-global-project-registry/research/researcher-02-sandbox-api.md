# Researcher 02 - Sandbox API

Date: 2026-07-12
Scope: filesystem sandbox, file APIs, search/watch/upload/save, terminal project behavior
Status: complete

## Findings

- `server/src/fs/sandbox.rs` has one `WorkspaceSandbox { root }`; `validate()` canonicalizes proposed paths and checks `starts_with(root)`.
- `server/src/fs/mod.rs` stores `Option<WorkspaceSandbox>` and reinitializes it with one root on workspace switch.
- REST file APIs in `server/src/api/fs.rs` already require or accept `project` and join `state.project_path(project)` with request-relative paths.
- WS file helpers in `server/src/api/ws.rs` also receive project names for read, write, upload, encrypted put, and tree subscribe flows.
- The current failure mode is the second validation step: joined project paths still must sit under one workspace/config-parent root.
- Workspace-scope search in `server/src/fs/ops.rs` already accepts `Vec<(String, PathBuf)>` and tags matches with project names.
- `server/src/api/terminal.rs` already accepts `project` and `cwd`; plan should verify default cwd semantics instead of inventing a new terminal API.
- `packages/ui/src/api/ws-transport.ts` already sends project params for file list/search/searchPaths.

## Constraints

- File APIs must never accept arbitrary absolute client paths.
- Project roots should be canonicalized once and selected by project name at request time.
- Watchers need per-project roots, not the global registry parent.
- Mutations must keep rejecting project-root deletion and `.git/` writes unless explicitly forced.

## Plan Implications

- Phase 03 is security-critical and should be implemented with focused tests before broader API changes.
- Phase 04 should mainly update state semantics, reload/switch flows, and status contracts.
- Frontend changes may be smaller than expected because project-scoped file transport already exists.

## Unresolved Questions

- Whether to keep the existing `WorkspaceSandbox` name or rename to `ProjectSandbox`.
- How many project watchers should be allowed before warning or throttling.
- Whether SSH credential keying should use registry path, project root, or another stable scope after `workspace_dir` loses its old meaning.
