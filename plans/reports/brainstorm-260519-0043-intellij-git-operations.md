# Brainstorm: IntelliJ-grade Git operations for DamHopper

Date: 2026-05-19

## Problem

User wants Git behavior closer to IntelliJ IDEA because current DamHopper Git operations are unreliable:

- Discarding or dropping a selected file can make the app feel like it reloads too much state.
- Dropping a commit does not work reliably.
- Desired outcome: IntelliJ IDEA style Git functions inside DamHopper without broken state, unexpected reloads, or confusing destructive behavior.

## Reference behavior from IntelliJ IDEA

Sources:

- JetBrains IntelliJ IDEA Help, "Undo changes in Git repository": https://www.jetbrains.com/help/idea/undo-changes.html
- JetBrains IntelliJ IDEA Help, "Log tab": https://www.jetbrains.com/help/idea/log-tab.html
- JetBrains intellij-community repository: https://github.com/JetBrains/intellij-community
- JetBrains Platform Blog, "Speeding up interactive rebase in JetBrains IDEs": https://blog.jetbrains.com/zh-hans/platform/2026/04/speeding-up-interactive-rebase-in-jetbrains-ides/

Key IntelliJ semantics:

- Local uncommitted file rollback is a Commit tool window action with a confirmation file list. Added-file deletion is explicit.
- Pushed commit revert creates a new reversing commit and preserves history.
- Drop commit rewrites local branch history and is blocked or constrained for protected branches because it requires force push.
- Drop selected changes from a commit removes only selected file changes from a commit. For pushed commits, IntelliJ exposes force-push or sync/merge consequences instead of silently treating it as a normal local edit.
- Git Log is a full operation surface: branches pane, commits pane, changed files pane, commit details pane, filters, refresh, cherry-pick, reset, compare, branch update, branch delete/rename, worktree, merge, rebase.
- JetBrains states their low-level Git principle is to run porcelain Git commands and avoid doing anything Git itself would not do. This is relevant for DamHopper: git2 is useful for reading status/diff, but history rewrite should follow Git CLI semantics.

## Current DamHopper state

Existing backend:

- `server/src/git/diff.rs`: status/diff, stage, unstage, discard file, discard hunk, commit, commit file listing/diff.
- `server/src/git/commit_file_ops.rs`: cherry-pick selected commit files and drop selected commit files.
- `server/src/api/git.rs`: branch, log, cherry-pick, reset, commit-file action routes.
- `server/src/api/git_diff.rs`: diff/stage/unstage/discard/commit routes.
- API docs already list branch checkout/create/update, cherry-pick, reset, and commit amend.

Existing frontend:

- `packages/web/src/components/organisms/GitLocalChanges.tsx`: local staged/unstaged changes and commit box.
- `packages/web/src/components/organisms/WorkspaceGitPanel.tsx`: branch control, log graph, commit details, history dialogs.
- `packages/web/src/components/organisms/CommitDetailsPanel.tsx`: changed files panel with cherry-pick selected changes and drop selected changes.
- `packages/web/src/components/organisms/GitHistoryActions.tsx`: orchestration for reset, cherry-pick, drop commit, and selected-file commit actions.
- `packages/web/src/api/queries.ts`: invalidates broad project, log, diff, conflict, file-tree state after many mutations.

Important observation:

DamHopper already has more Git commands than a minimal Git UI. The missing part is not "add more Git features first". The missing part is a stable operation model: exact preconditions, confirmation flow, mutation result handling, and targeted UI cache/editor refresh.

## Likely root causes

### Drop selected file makes the app feel like full reload

The frontend invalidates broad cache groups after history mutations, including `fs-tree`, `git-log`, `git-diff`, `projects`, and project status. This is correct for branch checkout/reset, but too broad for simple local file discard and selected-file drop. If an edited tab is open, the file tree and diff panes can refetch while editor state is stale.

Recommended root cause investigation:

- Reproduce with one modified file open in editor, Git panel open, and file tree expanded.
- Confirm whether actual `window.location.reload()` happens. Current code only shows reload calls in server settings/profile dialogs, not Git operations.
- If it is not a true browser reload, classify it as query invalidation/editor state churn.

### Drop commit did not work

Current `drop_commit_files()` uses this flow:

- Require clean working tree.
- Reject commit already reachable from upstream.
- Checkout detached at target commit.
- Reverse-apply patch for selected files with `git apply --reverse --index`.
- Amend target commit.
- Move branch or rebase later commits onto the amended base.

Risks in this algorithm:

- It rejects pushed commits, while IntelliJ documents that drop is possible with force-push/protected-branch consequences.
- It only tests HEAD commit drop locally. There is no test for dropping a non-HEAD commit with descendants.
- On rebase conflict, it returns a result but likely leaves the repo in rebase state. UI may not expose recovery actions.
- It uses selected-file flow for whole commit drop. That is pragmatic, but full commit drop should use `git rebase --onto <parent> <hash> <branch>` or interactive-rebase equivalent, not patch/amend indirection.
- It does not model protected branches explicitly.

## Evaluated approaches

### Approach A: Quick fixes only

Fix reported symptoms:

- Targeted invalidation after file discard.
- Add missing tests for non-HEAD drop commit.
- Improve error display for drop failures.

Pros:

- Fastest.
- Low risk.
- Keeps existing architecture.

Cons:

- Still leaves ambiguous semantics around revert vs drop vs selected drop.
- Users can still hit edge cases with pushed commits, dirty worktrees, and rebase conflicts.
- Does not move DamHopper closer to IntelliJ-grade UX.

### Approach B: IntelliJ-compatible Git operation layer

Create one explicit operation layer in backend and UI:

- Local changes: stage, unstage, rollback file, rollback hunk, delete untracked, commit, amend.
- History safe actions: revert commit and revert selected files create new commit or staged inverse changes.
- History rewrite actions: undo last commit, drop commit, drop selected changes, reset branch.
- Branch actions: checkout, create, rename, delete, merge, rebase, update, compare, worktree.
- Every operation declares preconditions, destructive level, expected repo state after success/failure, and cache/editor refresh scope.

Pros:

- Matches IntelliJ mental model.
- Reduces "operation worked but app state broke" bugs.
- Easier to test because each Git action has a contract.
- Fits current Rust+React structure.

Cons:

- More work than quick fixes.
- Requires careful UI copy and tests.
- Needs Git conflict/rebase recovery UX.

### Approach C: Embed or port IntelliJ Git implementation ideas directly

Try to mirror IntelliJ git4idea source internals.

Pros:

- Strong reference implementation.

Cons:

- Not practical. IntelliJ Git UI is deeply coupled to IntelliJ Platform VCS abstractions, changelists, virtual file system, and action system.
- DamHopper is Rust backend + React SPA, so direct porting would add complexity without guaranteed stability.
- YAGNI violation.

## Recommendation

Use Approach B, with an immediate stabilization slice first.

Do not try to copy IntelliJ source directly. Copy the semantics and UX contracts:

- Separate "revert" from "drop".
- Separate "working tree local changes" from "committed history".
- Use Git porcelain CLI for history rewrite and recovery paths.
- Keep git2 for read-heavy status/diff where it is reliable.
- Treat UI refresh as part of each operation contract, not a generic invalidate-everything after every mutation.

## Immediate stabilization plan

### Phase 1: Fix reported operations

- Add backend tests for `drop_commit_files()` on non-HEAD commits with later descendants.
- Add backend tests for full commit drop vs selected-file drop.
- Add dirty-worktree, pushed-commit, protected-branch, and conflict-state tests.
- Change full commit drop to direct Git semantics:
  - HEAD commit: `git reset --hard HEAD~1` only after explicit confirmation, or safer equivalent.
  - Non-HEAD local commit: `git rebase --onto <hash>^ <hash> <branch>`.
  - Pushed/protected commits: block by default unless force-push policy is explicitly enabled.
- Add recovery detection for active rebase/cherry-pick/merge states and surface "continue/abort" actions before allowing more history mutations.

### Phase 2: Fix UI state churn

- For local file discard, invalidate only `git-diff`, selected `git-file-diff`, and file tree parent path.
- If the discarded file is open in editor, update or mark that tab stale instead of letting background refetch surprise the user.
- For selected-file drop, invalidate log, selected commit files, affected file-tree parents, and project status. Avoid global query invalidation.
- Show operation progress and result in a persistent Git status banner. Do not rely on disappearing dialogs.

### Phase 3: Add IntelliJ semantic actions

- Add "Revert Commit" for pushed commits, creating inverse changes/commit instead of rewriting history.
- Add "Revert Selected Changes" from a commit, separate from "Drop Selected Changes".
- Add "Undo Last Commit" that moves changes into local changes, similar to IntelliJ's changelist outcome.
- Add branch delete/rename/merge/rebase/compare actions only after the core destructive actions are stable.

## Success metrics

- File discard never causes browser `window.location.reload()` and does not collapse unrelated workspace UI state.
- Open editor tabs remain coherent after discard/drop: either updated, closed with confirmation, or marked stale.
- Drop commit works for HEAD and non-HEAD unpushed commits with descendants.
- Pushed commits route user to revert/force-push choices instead of generic failure.
- Rebase/cherry-pick conflicts produce recoverable UI state with abort/continue guidance.
- Backend tests cover every destructive Git operation.
- Frontend tests cover query invalidation scope for file discard, selected-file drop, and drop commit.

## Risks

- Git history rewrite is inherently destructive. The UI must prefer safe defaults and block ambiguous states.
- Pushed commit handling requires policy: protected branches and force-push allowance should be explicit app settings.
- Multi-project workspaces may include nested repos/submodules. IntelliJ handles multi-root VCS; DamHopper currently operates per configured project.
- Rebase recovery UI can expand scope. Keep it minimal: detect state, show status, offer abort/continue where Git supports it.

## Final direction

Build an IntelliJ-compatible Git semantics layer, not an IntelliJ source port.

First fix the two broken flows with tests. Then add safe/rewrite action separation. Only after that expand branch and log actions.

## Unresolved questions

- Should DamHopper allow force-push workflows for dropped pushed commits, or block pushed commit drops and recommend revert?
- Should open editor tabs auto-update after Git rollback/drop, or should they show a stale-file confirmation?
- Should DamHopper support IntelliJ-style changelists, or keep standard Git staging only?
