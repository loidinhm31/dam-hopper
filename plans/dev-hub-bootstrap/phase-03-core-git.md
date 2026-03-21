# Phase 03 — Core: Git Operations

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Previous phase**: [phase-02-core-config.md](./phase-02-core-config.md)
- **Next phases**: [phase-05-cli.md](./phase-05-cli.md), [phase-06-server-api.md](./phase-06-server-api.md)
- **Depends on**: Phase 02 (ProjectConfig types, workspace config)
- **Parallel with**: [phase-04-core-build-run.md](./phase-04-core-build-run.md)

## Overview

- **Date**: 2026-03-21
- **Priority**: High
- **Status**: `pending`

Implement all git operations in `@dev-hub/core`: status queries, fetch/pull/push, branch management, worktree management, and bulk operations across all workspace projects. All operations emit progress events consumable by both CLI (Ink) and server (SSE).

## Key Insights

- `simple-git` provides a good Promise-based API but progress reporting requires parsing stderr output. We will use its built-in progress handler for fetch/pull/push.
- Bulk operations need concurrency control — `p-limit` caps parallel git operations to avoid hammering the network and hitting SSH connection limits.
- Worktrees are the key productivity feature: developers often work on multiple branches simultaneously, and worktrees avoid the stash-switch-pop dance.
- The `git fetch origin branch:branch` pattern updates a local branch ref without checking it out — essential for updating branches you are not currently on.
- EventEmitter3 is used for progress reporting; events are typed with TypeScript generics.

## Requirements

- Query git status for a single project (branch, clean/dirty, ahead/behind, untracked count).
- Fetch, pull, push for a single project.
- Bulk fetch/pull across all projects with configurable concurrency (default: 4).
- List, add, remove worktrees for a project.
- List branches (local + remote) for a project.
- Update a specific local branch from remote without checkout.
- Update all local tracking branches from remote.
- All operations emit typed progress events.
- All operations return structured results (not raw git output).
- Errors are classified into categories for appropriate user messaging.

## Architecture

### Module Structure

```
packages/core/src/
  git/
    index.ts                      # re-exports
    types.ts                      # all git-related types and event interfaces
    status.ts                     # GitStatusService — query repo state
    operations.ts                 # GitOperationService — fetch, pull, push
    worktree.ts                   # WorktreeService — add, list, remove, prune
    branch.ts                     # BranchService — list, update, bulk update
    bulk.ts                       # BulkGitService — parallel operations across projects
    errors.ts                     # GitError classes with classification
    progress.ts                   # typed EventEmitter for git progress
```

### Type Definitions

```typescript
// --- Status ---
interface GitStatus {
  projectName: string;
  branch: string;
  isClean: boolean;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  hasStash: boolean;
  lastCommit: { hash: string; message: string; date: string };
}

// --- Operations ---
interface GitOperationResult {
  projectName: string;
  operation: "fetch" | "pull" | "push";
  success: boolean;
  summary?: string;              // e.g., "3 commits pulled"
  error?: GitError;
  durationMs: number;
}

// --- Worktree ---
interface Worktree {
  path: string;
  branch: string;
  commitHash: string;
  isMain: boolean;               // is this the main worktree (not a linked one)
  isLocked: boolean;
}

interface WorktreeAddOptions {
  branch: string;
  path?: string;                 // default: ../{project}-{branch}
  createBranch?: boolean;        // -b flag
  baseBranch?: string;           // base for new branch
}

// --- Branch ---
interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  trackingBranch?: string;
  ahead: number;
  behind: number;
  lastCommit: string;
}

interface BranchUpdateResult {
  branch: string;
  success: boolean;
  reason?: string;               // e.g., "non-fast-forward", "not-tracking"
}

// --- Progress Events ---
interface GitProgressEvent {
  projectName: string;
  operation: string;
  phase: "started" | "progress" | "completed" | "failed";
  message: string;
  percent?: number;              // 0-100 for fetch/pull progress
}

// --- Errors ---
type GitErrorCategory = "network" | "auth" | "conflict" | "lock" | "not_repo" | "unknown";

class GitError extends Error {
  category: GitErrorCategory;
  projectName: string;
}
```

### Event Flow

```
BulkGitService
  ├── emits: "progress" (GitProgressEvent)  ──>  CLI (Ink renders progress bars)
  ├── emits: "progress" (GitProgressEvent)  ──>  Server (SSE streams to web dashboard)
  └── returns: GitOperationResult[]
```

## Related Code Files

- `packages/core/src/git/*.ts` — all new
- `packages/core/src/index.ts` — update to re-export git module
- `packages/core/src/config/schema.ts` — uses `ProjectConfig` type (from Phase 02)

## Implementation Steps

1. **Define types in `git/types.ts`**
   - All interfaces listed in Architecture section above.
   - Export `GitProgressEvent`, `GitStatus`, `GitOperationResult`, `Worktree`, `WorktreeAddOptions`, `BranchInfo`, `BranchUpdateResult`.

2. **Implement `git/errors.ts`**
   - `GitError` extends `Error` with `category: GitErrorCategory` and `projectName: string`.
   - `classifyGitError(err: Error): GitErrorCategory` — pattern-match on error message:
     - "Could not resolve host" / "Connection refused" -> `network`
     - "Permission denied" / "Authentication failed" -> `auth`
     - "CONFLICT" / "not possible because you have unmerged" -> `conflict`
     - "Unable to create" / ".lock" -> `lock`
     - "not a git repository" -> `not_repo`
     - Everything else -> `unknown`

3. **Implement `git/progress.ts`**
   - `GitProgressEmitter` class extending `EventEmitter3` with typed events.
   - Factory function: `createProgressEmitter(): GitProgressEmitter`.
   - Helper: `emitProgress(emitter, projectName, operation, phase, message, percent?)`.

4. **Implement `git/status.ts`**
   - `getStatus(projectPath: string, projectName: string): Promise<GitStatus>`
   - Use `simpleGit(projectPath)` instance.
   - Call `.status()` for branch, staged, modified, untracked, ahead, behind.
   - Call `.stashList()` to check `hasStash`.
   - Call `.log(["-1"])` for last commit info.
   - Wrap errors with `classifyGitError`.

5. **Implement `git/operations.ts`**
   - `gitFetch(projectPath, projectName, emitter?): Promise<GitOperationResult>`
     - Configure progress handler on simple-git to emit `GitProgressEvent` during fetch.
     - Call `.fetch(["--all", "--prune"])`.
     - Measure duration with `performance.now()`.
   - `gitPull(projectPath, projectName, emitter?): Promise<GitOperationResult>`
     - Call `.pull(["--ff-only"])` — safe default, no merge commits.
     - If fails due to diverged, return error with `conflict` category.
   - `gitPush(projectPath, projectName, emitter?): Promise<GitOperationResult>`
     - Call `.push()`.

6. **Implement `git/worktree.ts`**
   - `listWorktrees(projectPath): Promise<Worktree[]>`
     - Call `git.raw(["worktree", "list", "--porcelain"])`.
     - Parse porcelain output: blocks separated by empty lines, fields: `worktree <path>`, `HEAD <hash>`, `branch refs/heads/<name>`, optional `locked`.
   - `addWorktree(projectPath, options: WorktreeAddOptions): Promise<Worktree>`
     - Build args: `["worktree", "add"]`.
     - If `createBranch`: add `["-b", options.branch]`.
     - Add path (default: `../${basename(projectPath)}-${options.branch}`).
     - If not `createBranch`: add branch name.
     - If `baseBranch`: add `options.baseBranch` to args.
     - Execute and return the new worktree info.
   - `removeWorktree(projectPath, worktreePath): Promise<void>`
     - Call `git.raw(["worktree", "remove", worktreePath])`.
   - `pruneWorktrees(projectPath): Promise<void>`
     - Call `git.raw(["worktree", "prune"])`.

7. **Implement `git/branch.ts`**
   - `listBranches(projectPath): Promise<BranchInfo[]>`
     - Call `.branch(["-a", "-vv"])` to get all branches with tracking info.
     - Parse into `BranchInfo` objects.
   - `updateBranch(projectPath, branch: string, remote?: string): Promise<BranchUpdateResult>`
     - The key pattern: `git fetch origin branch:branch` updates the local ref directly.
     - Call `git.raw(["fetch", remote || "origin", `${branch}:${branch}`])`.
     - If current branch matches, skip (cannot update checked-out branch this way — user should pull instead).
     - Return result with success/failure reason.
   - `updateAllBranches(projectPath, emitter?): Promise<BranchUpdateResult[]>`
     - List all local branches with tracking remotes.
     - For each non-current branch, call `updateBranch`.
     - Emit progress for each branch.
     - Return array of results.

8. **Implement `git/bulk.ts`**
   - `BulkGitService` class:
     ```typescript
     class BulkGitService {
       private concurrency: number;
       readonly emitter: GitProgressEmitter;

       constructor(options?: { concurrency?: number });

       async fetchAll(projects: ProjectConfig[]): Promise<GitOperationResult[]>;
       async pullAll(projects: ProjectConfig[]): Promise<GitOperationResult[]>;
       async statusAll(projects: ProjectConfig[]): Promise<GitStatus[]>;
       async updateAllBranches(projects: ProjectConfig[]): Promise<Map<string, BranchUpdateResult[]>>;
     }
     ```
   - Use `p-limit(this.concurrency)` to throttle parallel operations.
   - Each method maps over projects, wraps each call in the limiter.
   - Emit per-project progress events and an overall "completed X/Y" event.

9. **Implement `git/index.ts`**
   - Re-export all types, services, error utilities.

10. **Update `packages/core/src/index.ts`**
    - Add `export * from "./git/index.js";`

11. **Write unit tests**
    - Test `classifyGitError` with various error messages.
    - Test worktree porcelain output parsing.
    - Test branch listing parsing.
    - Integration tests (require actual git repos):
      - Create temp git repo, make commits, test `getStatus`.
      - Create bare remote + clone, test `gitFetch` / `gitPull`.
      - Test `addWorktree` / `listWorktrees` / `removeWorktree`.
      - Test `updateBranch` with `fetch origin branch:branch`.

## Todo List

- [ ] Define all git types and interfaces in `git/types.ts`
- [ ] Implement error classification in `git/errors.ts`
- [ ] Implement typed progress emitter in `git/progress.ts`
- [ ] Implement `getStatus()` in `git/status.ts`
- [ ] Implement `gitFetch()`, `gitPull()`, `gitPush()` in `git/operations.ts`
- [ ] Implement worktree operations in `git/worktree.ts` (list, add, remove, prune)
- [ ] Implement branch operations in `git/branch.ts` (list, update single, update all)
- [ ] Implement `BulkGitService` in `git/bulk.ts` with p-limit concurrency
- [ ] Wire up re-exports
- [ ] Write unit tests for error classification
- [ ] Write unit tests for worktree/branch output parsing
- [ ] Write integration tests with temp git repos
- [ ] Verify `pnpm build` passes

## Success Criteria

1. `getStatus()` returns accurate branch, ahead/behind, and file counts for a real git repo.
2. `gitFetch()` emits progress events and returns a structured result.
3. `gitPull()` with `--ff-only` succeeds on fast-forwardable branches and fails gracefully on diverged ones.
4. Worktree add/list/remove works correctly, and list parses porcelain output accurately.
5. `updateBranch("main")` updates the local main ref from remote without checkout.
6. `BulkGitService.fetchAll()` processes 10 projects with concurrency 4, completing in roughly 3 batches, with progress events for each.
7. All error categories are correctly classified.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| simple-git progress handler is unreliable for some operations | Medium | Medium | Fall back to start/complete events without percent for operations that don't report progress |
| SSH agent not forwarded, auth errors in bulk ops | Medium | Low | Classify as auth error, suggest SSH_AUTH_SOCK in error message |
| `git fetch origin branch:branch` fails on diverged branches | Expected | Low | Catch error, report as "non-fast-forward", suggest manual resolution |
| Worktree operations fail if worktree path has spaces | Low | Low | Always quote paths in git commands |

## Next Steps

This module is consumed by:
- [Phase 05 — CLI](./phase-05-cli.md) — CLI commands wrap these services with Ink UI
- [Phase 06 — Server API](./phase-06-server-api.md) — REST endpoints delegate to these services, progress events become SSE
