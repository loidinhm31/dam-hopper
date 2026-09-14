# Debugger Report: Locked Agent Worktrees Investigation

**Target**: Root cause analysis for locked worktrees `worktree-agent-a8fb7b7d7c61cf234`, `worktree-agent-aa4e3907d6363c118`, `worktree-agent-af30df5e893bd9374` and why they cannot be deleted.
**Constraint**: Investigation and analysis only. No automated fixes implemented per user instructions.
**Date**: 2026-09-05 13:55
**Status**: Root cause identified. Manual resolution steps provided.

---

## 1. Executive Summary

- Three locked git worktrees exist in repository metadata:
  1. `worktree-agent-a8fb7b7d7c61cf234` (path: `.claude/worktrees/agent-a8fb7b7d7c61cf234`)
  2. `worktree-agent-aa4e3907d6363c118` (path: `.claude/worktrees/agent-aa4e3907d6363c118`)
  3. `worktree-agent-af30df5e893bd9374` (path: `.claude/worktrees/agent-af30df5e893bd9374`)
- **Origin**: Created by Claude Code agent sessions running in worktree isolation mode under parent PID `1977751`.
- **Current State**:
  - Target filesystem directory `/mnt/data/ws/sharing/dam-hopper/.claude/worktrees/` does NOT exist on disk (already deleted or never persisted).
  - Process PID `1977751` is terminated/dead.
  - Branches point to commit `c7fcf29b` (`feat(web): complete terminal workspace docking`) with 0 commits ahead of `develop`.
  - Git administrative lock files remain active in git metadata.
- **Why user cannot delete them**:
  1. **DamHopper Backend/UI Blocker**: `server/src/api/git.rs` lines 359-363 and 405-409 explicitly hard-reject removal requests with `Cannot remove locked worktree` (even if `force` parameter is sent). DamHopper has no `unlock` endpoint or force-unlock override.
  2. **Git CLI Removal Blocker**: Standard `git worktree remove <path>` rejects deletion when worktree is locked: `fatal: '<path>' is locked, reason: claude agent agent-... (pid 1977751)`.
  3. **Git CLI Prune Blocker**: `git worktree prune` ignores locked worktrees by git design specification, even when their directory on disk is missing.
  4. **Git Branch Deletion Blocker**: `git branch -d` / `git branch -D` fails because Git marks branches as checked out in linked worktrees (`+` indicator in `git branch`).

---

## 2. Technical Analysis

### 2.1 Git Porcelain Metadata
Inspection via `git worktree list --porcelain`:

```
worktree /mnt/data/ws/sharing/dam-hopper/.claude/worktrees/agent-a8fb7b7d7c61cf234
HEAD c7fcf29bb0f0de16bc1acb4df29073bfab2911c4
branch refs/heads/worktree-agent-a8fb7b7d7c61cf234
locked claude agent agent-a8fb7b7d7c61cf234 (pid 1977751)

worktree /mnt/data/ws/sharing/dam-hopper/.claude/worktrees/agent-aa4e3907d6363c118
HEAD c7fcf29bb0f0de16bc1acb4df29073bfab2911c4
branch refs/heads/worktree-agent-aa4e3907d6363c118
locked claude agent agent-aa4e3907d6363c118 (pid 1977751)

worktree /mnt/data/ws/sharing/dam-hopper/.claude/worktrees/agent-af30df5e893bd9374
HEAD c7fcf29bb0f0de16bc1acb4df29073bfab2911c4
branch refs/heads/worktree-agent-af30df5e893bd9374
locked claude agent agent-af30df5e893bd9374 (pid 1977751)
```

Key observations:
- Each worktree has `locked <reason>` metadata.
- Lock reason explicitly names `claude agent agent-<id> (pid 1977751)`.
- Branch references: `refs/heads/worktree-agent-<id>`.

### 2.2 Process & Disk Verification
- Process check: `ps -p 1977751` returned non-zero; process is dead.
- Filesystem check: `/mnt/data/ws/sharing/dam-hopper/.claude/worktrees/` does not exist (`ls: cannot access ...: No such file or directory`).
- Branch check: `git branch --list "*worktree-agent*"` outputs:
  ```
  + worktree-agent-a8fb7b7d7c61cf234
  + worktree-agent-aa4e3907d6363c118
  + worktree-agent-af30df5e893bd9374
  ```
  The `+` indicates active checkout in linked worktree.
- Divergence check: `git log develop..worktree-agent-a8fb7b7d7c61cf234` returns empty (0 unmerged commits, identical to parent commit `c7fcf29b`).

### 2.3 Codebase Analysis: DamHopper Worktree Removal Constraints
Inspection of `server/src/api/git.rs`:

1. In `remove_worktree_route` (lines 359-363):
   ```rust
   if worktree.is_locked {
       return Err(ApiError::from_app(crate::error::AppError::InvalidInput(
           "Cannot remove locked worktree".to_string(),
       )));
   }
   ```
2. In stale/unavailable fallback handler (lines 405-409):
   ```rust
   if candidate.is_locked {
       return Err(ApiError::from_app(crate::error::AppError::InvalidInput(
           "Cannot remove locked worktree".to_string(),
       )));
   }
   ```
3. Backend parses `locked` lines from `git worktree list --porcelain` into `is_locked: true` (`server/src/git/cli_fallback.rs:352-353`).
4. Result: DamHopper UI/API unconditionally blocks removal of any worktree with `is_locked == true`. The route never invokes `git worktree remove --force` or `git worktree unlock`.

---

## 3. Root Cause Chain

```
[Claude Code Subagent Spawned]
  │
  ├─> Ran `git worktree add --lock --reason "claude agent ... (pid 1977751)" ...`
  │   └─> Created git metadata with lock file
  │
[Process PID 1977751 Exited / Killed]
  │
  ├─> Subagent directory `.claude/worktrees/` was deleted or unlinked
  │
  ├─> BUT Git worktree lock file in git metadata was NEVER removed (orphan lock)
  │   (Git locks are static files; git does not monitor OS PIDs)
  │
[User attempts deletion]
  │
  ├─> Via DamHopper UI/API:
  │   └─> Blocked by `is_locked` guard in `server/src/api/git.rs` ("Cannot remove locked worktree")
  │
  ├─> Via Git CLI `git worktree remove`:
  │   └─> Blocked by Git's lock protection (`fatal: worktree is locked`) unless `--force` is used
  │
  ├─> Via Git CLI `git worktree prune`:
  │   └─> Skipped by Git (Git prune intentionally ignores locked worktrees)
  │
  └─> Via Git CLI `git branch -d / -D`:
      └─> Blocked because Git considers branch checked out in linked worktree
```

---

## 4. Actionable Recommendations

### 4.1 Manual Cleanup Commands for User (DO NOT RUN AUTOMATICALLY)
To remove the orphaned worktrees and branches manually, user can execute:

#### Option A: Unlock then Prune & Clean Branches (Recommended)
```bash
# 1. Unlock the orphaned worktrees
git worktree unlock worktree-agent-a8fb7b7d7c61cf234
git worktree unlock worktree-agent-aa4e3907d6363c118
git worktree unlock worktree-agent-af30df5e893bd9374

# 2. Prune orphaned worktree registrations (since directories on disk are already gone)
git worktree prune -v

# 3. Delete the orphaned agent branches
git branch -D worktree-agent-a8fb7b7d7c61cf234 worktree-agent-aa4e3907d6363c118 worktree-agent-af30df5e893bd9374
```

#### Option B: Force Remove Directly
```bash
git worktree remove --force worktree-agent-a8fb7b7d7c61cf234
git worktree remove --force worktree-agent-aa4e3907d6363c118
git worktree remove --force worktree-agent-af30df5e893bd9374
git branch -D worktree-agent-a8fb7b7d7c61cf234 worktree-agent-aa4e3907d6363c118 worktree-agent-af30df5e893bd9374
```

### 4.2 Potential DamHopper Codebase Enhancements (Future Consideration)
1. **Allow Force Removal of Locked Worktrees**: In `server/src/api/git.rs`, if `body.force == true`, allow bypassing `worktree.is_locked` and pass `--force` to `remove_worktree`.
2. **Expose Worktree Unlock Endpoint**: Add `POST /api/git/{project}/worktrees/unlock` to allow users to unlock locked worktrees from UI.
3. **Stale Lock Detection**: When listing worktrees, if lock reason contains `(pid <PID>)` and PID no longer exists on system, flag worktree as having an orphaned/stale lock in API response.

---

## 5. Supporting Evidence

- `git worktree list --porcelain`:
  - `worktree /mnt/data/ws/sharing/dam-hopper/.claude/worktrees/agent-a8fb7b7d7c61cf234`
  - `locked claude agent agent-a8fb7b7d7c61cf234 (pid 1977751)`
- Process check: PID `1977751` is dead.
- Filesystem: `/mnt/data/ws/sharing/dam-hopper/.claude/worktrees/` does not exist.
- Code reference: `server/src/api/git.rs:359-363`, `405-409`.

---

## 6. Unresolved Questions

1. Was PID 1977751 killed forcefully (SIGKILL) by user/OS, preventing Claude agent shutdown hooks from running cleanup?
2. Does the user want DamHopper to support unlocking worktrees directly in the web UI in an upcoming release?
