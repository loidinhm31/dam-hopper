# Phase 03 - Per-Project-Root Sandbox

## Context links

- Parent plan: [plan](./plan.md)
- Depends on: [phase-02](./phase-02-parser-absolute-paths.md)
- Feeds: [phase-04](./phase-04-api-state-adjustments.md), [phase-06](./phase-06-tests-windows-docs.md)
- Research: [sandbox API research](./research/researcher-02-sandbox-api.md)

## Overview

Date: 2026-07-12
Description: Replace the single workspace-root filesystem boundary with configured project-root boundaries.
Priority: P1
Implementation status: Completed (2026-07-12)
Review status: Approved (9.5/10)
Effort: 4h

## Key Insights

- REST and WS file handlers already receive a `project` and join `state.project_path(project)` with a relative path.
- The blocker is the second check: [server/src/fs/sandbox.rs](../../server/src/fs/sandbox.rs) validates against one root initialized from config parent.
- Workspace-wide search in [server/src/fs/ops.rs](../../server/src/fs/ops.rs) already accepts multiple `(project, root)` pairs, so search should need less work than read/write/watch.

## Requirements

- Every file operation must validate against the selected project's canonical root.
- Unknown projects must fail before any filesystem access.
- A project must not access a sibling configured project unless that sibling is selected by name.
- Symlink escapes and `..` traversal remain rejected.
- Watch subscriptions attach to the selected project root, not the global config directory.

## Architecture

Introduce a multi-root sandbox, either by replacing `WorkspaceSandbox` with `ProjectSandbox` or by extending the existing type cleanly:

```rust
pub struct ProjectSandbox {
    roots: HashMap<String, PathBuf>,
}
```

Core methods:

- `new(projects: Vec<(String, PathBuf)>) -> Result<Self, FsError>` canonicalizes roots with `dunce`.
- `validate(project, proposed) -> Result<PathBuf, FsError>` checks lexical traversal, canonicalizes, then `starts_with(root)`.
- `validate_new_path(project, parent, name) -> Result<PathBuf, FsError>` mirrors current create-path logic.
- `project_root(project) -> Option<PathBuf>` returns cloned canonical roots for watchers.

`FsSubsystem` stores this sandbox and clears subscriptions on reinit.

## Related code files

- [server/src/fs/sandbox.rs](../../server/src/fs/sandbox.rs)
- [server/src/fs/mod.rs](../../server/src/fs/mod.rs)
- [server/src/fs/mutate.rs](../../server/src/fs/mutate.rs)
- [server/src/api/fs.rs](../../server/src/api/fs.rs)
- [server/src/api/ws.rs](../../server/src/api/ws.rs)
- [server/src/state.rs](../../server/src/state.rs)
- [server/src/api/tests.rs](../../server/src/api/tests.rs)

## Implementation Steps

1. Implement `ProjectSandbox` with tests before wiring it into API handlers.
2. Change `FsSubsystem::new` and `reinit_sandbox` to accept project roots derived from config.
3. Update `FsSubsystem::sandbox()` return type and compile-fix callers.
4. Pass `project` into `validate()` and `validate_new_path()` in REST handlers.
5. Pass `project` into WS read/write/upload/encrypted-save/subscribe helpers.
6. Update tree subscription watcher root to the canonical selected project root.
7. Update tests that construct `FsSubsystem::new(workspace_dir)` to pass project roots.

## Todo list

- [x] Add multi-root sandbox type and tests.
- [x] Refactor `FsSubsystem` construction and reinit.
- [x] Update REST file API validation.
- [x] Update WS file API validation and watcher subscription.
- [x] Update test helpers and fixtures.
- [x] Run focused FS/API tests.

## Completion Summary

**Implementation (2026-07-12):** ProjectSandbox multi-root validation added; FsSubsystem now uses project roots; REST/WS file APIs validate with selected project; watcher subscriptions derive root internally. Tests: ProjectSandbox validation, REST cross-project boundary, WS multi-project isolation. Validation: `cargo test -j 1`, `cargo test fs -j 1`, `cargo test --test ws_fs_subscribe -j 1` — all passed. Review: 9.5/10, approved.

## Success Criteria

- File list/read/stat/download work for two configured projects in unrelated directories.
- A request for project A cannot reach project B by relative traversal or symlink.
- `path = "/"` in client terms resolves to the selected project root, not filesystem root.
- Workspace search returns tagged matches from all configured project roots.
- Mutations still reject project root deletion and `.git/` writes unless `force_git` permits.

## Risk Assessment

- High security risk: a bad boundary check can become arbitrary disk access.
- Medium compatibility risk: many tests and constructors assume `FsSubsystem::new(PathBuf)`.
- Medium operational risk: many projects may create many watchers; Phase 06 should document limits or future controls.

## Security Considerations

- Never validate by string prefix before canonicalization.
- Reject parent-dir components before filesystem I/O where possible.
- Treat symlink targets as authoritative after `dunce::canonicalize`; if target escapes, reject.
- Do not add an unrestricted absolute-path escape hatch in this phase.

## Next steps

- Phase 04 updates API status, config reload, and switch semantics after the filesystem boundary is correct.
