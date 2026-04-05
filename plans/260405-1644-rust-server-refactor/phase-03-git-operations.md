# Phase 03: Git Operations

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-rust-scaffold-config.md)

## Overview
- **Priority**: P1
- **Status**: Pending
- **Effort**: 12h

Port git operations from `simple-git` to `git2` (libgit2) + CLI fallback. Includes single-project and bulk operations.

## Key Insights

- Current core uses `simple-git` — thin wrapper over git CLI
- git2 provides native bindings but some operations (push with credentials) may need CLI fallback
- `BulkGitService` uses `p-limit` (concurrency 4) → tokio Semaphore in Rust
- Git progress events emitted via EventEmitter3 → broadcast channel in Rust
- Worktree management is used for multi-branch workflows

## Requirements

### Single Project Operations
- Status (working tree changes, staged, untracked)
- Fetch (all remotes)
- Pull (current branch)
- Push (current branch)
- Branch listing (local + remote)
- Branch checkout/create
- Worktree list/add/remove

### Bulk Operations
- Fetch all projects (concurrent, max 4)
- Pull all projects (concurrent, max 4)
- Progress reporting per project

## Architecture

```
src/git/
├── mod.rs
├── repository.rs       # Single repo operations (git2)
├── bulk.rs             # BulkGitService (Semaphore-limited)
├── worktree.rs         # Worktree management
├── progress.rs         # Progress event types + broadcasting
└── cli_fallback.rs     # Shell out to git for unsupported ops
```

## Related Code Files (current Node)

| File | Action | Notes |
|------|--------|-------|
| `packages/core/src/git/repository.ts` | Port to Rust | Main git ops |
| `packages/core/src/git/bulk.ts` | Port to Rust | p-limit concurrent ops |
| `packages/core/src/git/worktree.ts` | Port to Rust | Worktree CRUD |
| `packages/core/src/git/types.ts` | Port to Rust | Status/branch types |

## Implementation Steps

1. Define types: `GitStatus`, `BranchInfo`, `WorktreeInfo`, `GitProgressEvent`
2. Implement `Repository` struct wrapping `git2::Repository`
3. Status: `git2::Repository::statuses()` → map to `GitStatus`
4. Fetch: `git2` remote fetch with progress callback
5. Pull: fetch + fast-forward merge (or CLI fallback for complex merges)
6. Push: attempt `git2` push, fall back to `git push` CLI if credential issues
7. Branches: `git2::Repository::branches()` → local + remote listing
8. Branch update: checkout via `git2`
9. Worktrees: `git2::Repository::worktrees()`, add/remove
10. Implement `BulkGitService` with `tokio::sync::Semaphore(4)`
11. Progress broadcasting via `tokio::sync::broadcast` channel
12. CLI fallback module: `tokio::process::Command` for git CLI when git2 insufficient
13. Unit tests with temp git repos, integration tests with real clones

## Todo

- [ ] Git type definitions
- [ ] Single repo: status
- [ ] Single repo: fetch with progress
- [ ] Single repo: pull (ff + fallback)
- [ ] Single repo: push (git2 + CLI fallback)
- [ ] Branch operations
- [ ] Worktree operations
- [ ] BulkGitService with Semaphore
- [ ] Progress event broadcasting
- [ ] Tests

## Success Criteria

- All git operations produce identical results to current Node implementation
- Bulk operations respect concurrency limit
- Progress events stream during fetch/pull
- Worktree add/remove/list works correctly

## Risk Assessment

- **git2 push with SSH keys**: May need to configure `git2::RemoteCallbacks` for SSH agent. If problematic, CLI fallback.
- **Credential handling**: git2 credential callback chain is tricky. Test with both HTTPS and SSH remotes.
- **Progress granularity**: git2 progress callbacks may differ from `simple-git` output parsing.

## Security Considerations

- Never log credentials or tokens
- SSH key passphrase handling: delegate to system SSH agent
- Validate remote URLs (prevent SSRF via crafted git remotes)

## Next Steps

→ Phase 04: Agent store + commands (independent, can be parallel with this)
