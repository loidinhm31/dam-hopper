# Backend target and security research

## Scope

Assess how a configured project can safely address its Git worktrees without mutating the configured project path, and identify the backend protocols and persistence surfaces affected.

## Existing behavior

- `server/src/state.rs` resolves a project name to exactly one configured path through `AppState::project_path`.
- `server/src/fs/sandbox.rs` stores one canonical root per project. `ProjectSandbox` rejects paths outside that root.
- `server/src/fs/mod.rs` initializes that sandbox and binds file watchers to the configured root.
- `server/src/git/cli_fallback.rs` already runs `git worktree list --porcelain`, and supports add, remove, and prune.
- `server/src/git/worktree.rs` exposes the worktree operations used by `server/src/api/git.rs`.
- `server/src/git/types.rs` exposes path, branch, commit, main, and locked state. The parser does not currently represent `prunable` entries, and `is_main` depends on list order rather than equality with the configured project root.
- `server/src/api/ws_protocol.rs` carries `project` but no target in raw file read/write/subscription/upload messages.
- `server/src/api/fs.rs`, `server/src/api/fs_image.rs`, and `server/src/api/fs_video.rs` resolve files against the configured project root. Media tickets bind only project and relative path.
- `server/src/api/terminal.rs` validates terminal cwd against the configured project root and resolves project-relative environment files from that root.
- `server/src/persistence/migrations/001_initial.sql` through `003_persisted_ports.sql`, plus `server/src/persistence/mod.rs`, persist terminal project/cwd but not a worktree target.

## Decision

Introduce an explicit target reference on every root-sensitive operation:

```text
ProjectTargetRef {
  project: string,
  worktreePath?: string  // absent means the configured root
}
```

The server remains authoritative. It canonicalizes the configured root, obtains the registered worktree set from `git worktree list --porcelain`, canonicalizes the requested target when it exists, and accepts it only when it belongs to that configured repository. A client-provided path is never trusted merely because it exists.

The selected target must not be stored as a global server value. Requests, file watchers, media tickets, and terminal metadata can coexist for multiple targets of the same project, so target identity belongs in those resources.

## Security and correctness implications

- Preserve the existing project-name authorization boundary; target selection narrows a request to one registered root and must not create an arbitrary-path API.
- Represent the configured root as the default target even when Git reports it as bare, detached, or not first in output.
- Parse locked and prunable worktree metadata. Missing/prunable entries may be displayed as unavailable but cannot be selected for new operations.
- Extend the sandbox from one root per project to validation by `(project, canonical target root)`. Do not weaken traversal, symlink, upload, or write checks.
- Bind media tickets to target identity and revalidate against that target. Changing the UI selection must not revoke tickets for another still-valid target.
- Include target identity in file watcher subscription keys so simultaneous roots do not overwrite each other.
- Terminal create, session metadata, respawn, persistence, and restore must carry a nullable target path. Null is the backward-compatible configured-root representation.
- Existing terminal processes retain their original cwd if a worktree becomes unavailable. New operations against that target are rejected; the session is surfaced as orphaned until closed.
- Never hold shared state locks while invoking Git or awaiting filesystem work. A short-lived registered-worktree cache may be used, with explicit invalidation after add/remove/prune/list refresh.

## API and implementation surfaces

- Modify: `server/src/git/cli_fallback.rs`, `server/src/git/types.rs`, `server/src/git/worktree.rs`, `server/src/api/git.rs`.
- Create: a shared backend target type/resolver, preferably under `server/src/workspace_target.rs` or an equivalent focused module.
- Modify: `server/src/fs/sandbox.rs`, `server/src/fs/mod.rs`, `server/src/api/fs.rs`, `server/src/api/ws_protocol.rs`, `server/src/api/ws.rs`.
- Modify: `server/src/api/fs_image.rs`, `server/src/api/fs_video.rs` and their ticket stores.
- Modify: `server/src/api/terminal.rs`, PTY session metadata/restore code, `server/src/persistence/mod.rs`.
- Create: a new additive terminal-target migration after `003_persisted_ports.sql`.

## Validation implications

- Unit-test porcelain parsing for normal, detached, locked, prunable, missing, and reordered output.
- Use temporary real Git repositories and worktrees for resolver and sandbox integration tests.
- Prove an arbitrary sibling directory and a worktree from another repository are rejected.
- Test simultaneous watchers and file operations for configured root plus two worktrees.
- Test media tickets cannot be replayed with a different target.
- Test terminal persistence migration, restore, and unavailable-target behavior.

## Open questions

No blocking backend questions remain. Cache duration and exact error codes are implementation-level choices; the plan should require observable invalidation and stable unavailable-target errors.
