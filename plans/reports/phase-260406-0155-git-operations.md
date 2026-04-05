# Phase 03 Completion Report: Git Operations

**Date**: 2026-04-06 | **Plan**: [260405-1644-rust-server-refactor](../260405-1644-rust-server-refactor/plan.md)

## Summary

Ported git operations from Node.js `simple-git` to Rust `git2` (libgit2) + CLI fallback. Full lifecycle: status, fetch (with progress), pull (ff-merge + CLI fallback), push (CLI), branch listing/update, worktree CRUD, bulk concurrent ops with Semaphore(4), broadcast progress channel.

## Files Created

| File | Purpose |
|------|---------|
| `server/src/git/types.rs` | `GitStatus`, `BranchInfo`, `Worktree`, `GitOperationResult`, `GitProgressEvent` |
| `server/src/git/progress.rs` | `ProgressSender/Receiver` (tokio broadcast, cap=64) + emit helpers |
| `server/src/git/cli_fallback.rs` | CLI ops: push, pull --ff-only, worktree add/remove/prune/list, porcelain parser |
| `server/src/git/repository.rs` | git2: status, fetch (SSH agent + cred helper), pull (ff-merge), branch list/update |
| `server/src/git/worktree.rs` | Thin wrapper delegating to cli_fallback |
| `server/src/git/bulk.rs` | `BulkGitService` — fetch_all, pull_all, status_all, update_all_branches |
| `server/src/git/mod.rs` | Module root, public re-exports |
| `server/src/git/tests.rs` | 28 tests (status, branches, worktrees, bulk, progress) |

## Files Modified

| File | Change |
|------|--------|
| `server/Cargo.toml` | Added `git2 = "0.19"`, `chrono = "0.4"` |
| `server/src/error.rs` | Added `Git(String)`, `GitNotFound(String)` variants |
| `server/src/lib.rs` | Added `pub mod git` |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| git2 for status/branches/fetch | No credentials needed; git2 has rich APIs and progress callbacks |
| CLI for push | SSH/HTTPS credential chains fragile in git2; git CLI uses system credential store reliably |
| CLI for pull fallback | ff-only merge attempted in git2 first; CLI catches diverged branches |
| CLI for worktrees | git2 worktree API lacks add/remove in stable; CLI is complete |
| AtomicUsize for stash count | No lock needed in sync stash_foreach; cleaner than Arc<Mutex> |
| Semaphore(4) for bulk | Matches Node's p-limit(4); empirical balance of I/O concurrency |
| spawn_blocking for git2 | git2 is synchronous; keeps Tokio executor free |
| No Arc<Mutex<Repository>> | git2::Repository is !Sync; open per-operation |

## Tests: 67/67 Passing

- 22 config tests (existing)
- 19 PTY tests (existing)
- 26 git tests (new): status clean/dirty/missing/stash, branches single/multi, worktree list/add/remove/create-branch, bulk status_all/missing/concurrency, progress channel emit/no-receiver
- Inline: 9 cli_fallback unit tests (porcelain parser, branch validation)

## Code Review Fixes

- `Arc<Mutex<usize>>` → `AtomicUsize` in `count_stash` (simpler, no lock needed)
- Branch validation strengthened: `~`, `^`, `:`, `@{`, `\`, `*`, space/tab, leading/trailing `.`/`/`, `.lock` suffix, empty string
- `BULK` sentinel constant for bulk-level progress events (replaces empty string)
- 2 additional branch validation tests

## Next Step

→ Phase 04: Agent store + commands (independent, can run parallel with phase 05 planning)
