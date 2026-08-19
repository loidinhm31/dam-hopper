# DamHopper Git Worktree Guide

This guide covers the complete DamHopper worktree lifecycle: configure a
project, create a worktree, select it in DamHopper, develop and synchronize the
branch, then remove the worktree safely.

## 1. Worktree model

A worktree is a separate working directory attached to the same Git repository.
The worktrees share Git objects and branch references, but each has its own
checked-out files.

There is no file-copy or folder-link step between a worktree and the parent
checkout. Changes move between them through commits, merges, rebases, pulls, or
cherry-picks.

Example layout:

~~~text
/mnt/data/ws/sharing/dam-hopper                  # configured/main checkout
/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching
                                                    # feature worktree
~~~

## 2. Configure DamHopper once

Register the repository once in the DamHopper registry, normally
~/.config/dam-hopper/dam-hopper.toml:

~~~toml
[[projects]]
name = "dam-hopper"
path = "/mnt/data/ws/sharing/dam-hopper"
type = "pnpm"
~~~

Do not add a separate project entry for every worktree. DamHopper discovers
worktrees registered by Git for the configured repository.

Worktrees created from another clone or another repository are not valid
targets for this project.

## 3. Inspect the repository

Set paths for the current shell. Replace them when working with another
repository or branch:

~~~bash
MAIN_REPO="/mnt/data/ws/sharing/dam-hopper"
WORKTREE_PATH="/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching"
FEATURE_BRANCH="feat/project-worktree-switching"
~~~

Check the repository and existing worktrees:

~~~bash
git -C "$MAIN_REPO" status
git -C "$MAIN_REPO" worktree list --porcelain
~~~

The main/configured checkout cannot be removed as a secondary worktree.

## 4. Create a worktree

### Create a new branch from origin/main

~~~bash
git -C "$MAIN_REPO" fetch origin --prune
git -C "$MAIN_REPO" worktree add -b "$FEATURE_BRANCH" "$WORKTREE_PATH" origin/main
~~~

### Check out an existing local branch

~~~bash
git -C "$MAIN_REPO" worktree add "$WORKTREE_PATH" "$FEATURE_BRANCH"
~~~

### Check out an existing remote branch

~~~bash
git -C "$MAIN_REPO" fetch origin --prune
git -C "$MAIN_REPO" worktree add --track -b "$FEATURE_BRANCH" "$WORKTREE_PATH" "origin/$FEATURE_BRANCH"
~~~

Verify the result:

~~~bash
git -C "$MAIN_REPO" worktree list
git -C "$WORKTREE_PATH" status --short --branch
~~~

A branch cannot normally be checked out in two worktrees at the same time.

## 5. Prepare the worktree

Generated files and dependencies are normally not shared between worktrees.
Install the dependencies needed by the checkout:

~~~bash
cd "$WORKTREE_PATH"
pnpm install
~~~

For DamHopper development:

~~~bash
pnpm dev:server
pnpm dev
~~~

Use the normal configured server/auth startup for shared environments. Use
--no-auth only for local development without production credentials.

Check local configuration and secrets before starting. Do not commit environment
files, tokens, credentials, or generated build output.

## 6. Add a worktree from the DamHopper UI

Instead of running git worktree add, the Project panel can create one:

1. Open the project in DamHopper.
2. Open the Worktrees section in the Project panel.
3. Click Add Worktree.
4. Enter the worktree Path.
5. Enter the Branch name.
6. Enable Create new branch when the branch does not exist.
7. Click Add.

The UI refreshes discovery after a successful add.

## 7. Select the active worktree

In the Project panel:

1. Click Refresh worktrees if the new row is not visible.
2. Select the worktree row for the branch/path.
3. Select Project root to return to the configured checkout.

The selected target is session-scoped. It does not change the project name,
project configuration, or top-bar project identity. A browser restart returns to
the configured project root.

The selected target is used by:

- Explorer and file watchers
- Search and replace
- Git status and Git actions
- Editors and diffs
- Image and video previews
- New terminals
- Build, run, custom-command, and profile sessions

DamHopper validates the target server-side. A directory is selectable only when
it is a currently registered, available worktree of the configured repository.
An arbitrary sibling directory, foreign repository, bare worktree, or prunable
worktree is rejected.

## 8. Work on the branch

From the worktree:

~~~bash
cd "$WORKTREE_PATH"
git status
git diff
git fetch origin --prune
git rebase origin/main
~~~

Run the relevant checks before committing:

~~~bash
pnpm lint
pnpm build
pnpm test
~~~

Commit changes in the worktree:

~~~bash
git add -A
git commit -m "feat: describe the change"
~~~

Keep commits focused and avoid committing secrets or local-only files.

## 9. Push or merge the completed work

### Recommended team workflow: push and open a pull request

Push when the branch needs review, collaboration, CI, backup, or deployment:

~~~bash
git -C "$WORKTREE_PATH" push -u origin "$FEATURE_BRANCH"
~~~

Open a pull request. After it is merged, update the configured checkout:

~~~bash
git -C "$MAIN_REPO" switch main
git -C "$MAIN_REPO" pull --ff-only
~~~

The parent checkout receives the change through the merged remote branch. No
copying or linking is required.

### Local-only workflow: merge from the parent checkout

If the change does not need a remote branch or pull request:

~~~bash
git -C "$MAIN_REPO" switch main
git -C "$MAIN_REPO" pull --ff-only
git -C "$MAIN_REPO" merge --ff-only "$FEATURE_BRANCH"
~~~

If fast-forward merging is not possible, inspect the divergence before using a
normal merge or rebase.

### Keep the worktree for later

Commit the branch and leave the worktree in place. There is no need to push it
just to make it visible to the parent checkout; both worktrees already share
the local repository. Push it when remote backup or collaboration is useful.

## 10. Optional worktree maintenance

### List worktrees

~~~bash
git -C "$MAIN_REPO" worktree list --porcelain
~~~

### Lock a worktree

Lock a worktree that must not be pruned while it is temporarily offline:

~~~bash
git -C "$MAIN_REPO" worktree lock "$WORKTREE_PATH" --reason "temporary archive"
~~~

Unlock it when it is active again:

~~~bash
git -C "$MAIN_REPO" worktree unlock "$WORKTREE_PATH"
~~~

### Move a worktree

Use Git to move it so its administrative metadata stays correct:

~~~bash
git -C "$MAIN_REPO" worktree move "$WORKTREE_PATH" "/new/path/dam-hopper-feature"
~~~

If the directory was moved manually, try to repair it:

~~~bash
git -C "$MAIN_REPO" worktree repair "/new/path/dam-hopper-feature"
~~~

Refresh worktree discovery in DamHopper after moving or repairing a worktree.

## 11. Remove a worktree safely

Before removing a worktree:

1. Save or commit important changes.
2. Close terminals running in that target.
3. Save and close dirty editor tabs.
4. Switch DamHopper back to Project root, if practical.
5. Confirm the target path and branch with git worktree list.

Check for uncommitted files:

~~~bash
git -C "$WORKTREE_PATH" status --short
~~~

If the changes must be preserved but are not ready to commit, stash tracked and
untracked files:

~~~bash
git -C "$WORKTREE_PATH" stash push -u -m "temporary save before removing worktree"
~~~

### Remove from DamHopper

Use the worktree row's Remove action. DamHopper refreshes discovery before
removal and blocks the operation when the exact target owns dirty editor tabs
or live terminal sessions. Git's own dirty/untracked protection remains the
final safety check.

When the selected target is removed successfully, DamHopper routes new
operations to the configured project root. Existing target-specific tabs and
running sessions are preserved as unavailable/orphaned resources until closed.

### Remove with Git

~~~bash
git -C "$MAIN_REPO" worktree remove "$WORKTREE_PATH"
~~~

Do not manually delete the directory first. Do not use --force unless losing
uncommitted files is intentional:

~~~bash
git -C "$MAIN_REPO" worktree remove --force "$WORKTREE_PATH"
~~~

If the directory was already deleted, inspect stale metadata first:

~~~bash
git -C "$MAIN_REPO" worktree prune --dry-run
git -C "$MAIN_REPO" worktree prune
~~~

### Delete the local branch after removal

Only delete the branch after the work is merged or no longer needed:

~~~bash
git -C "$MAIN_REPO" branch -d "$FEATURE_BRANCH"
~~~

After a merged pull request, delete the remote branch only if the repository
policy allows it:

~~~bash
git -C "$MAIN_REPO" push origin --delete "$FEATURE_BRANCH"
git -C "$MAIN_REPO" fetch origin --prune
~~~

## 12. DamHopper API actions

The UI uses these project-scoped endpoints:

~~~text
GET  /api/git/{project}/worktrees
POST /api/git/{project}/worktrees
DELETE /api/git/{project}/worktrees
POST /api/git/{project}/worktrees/prune
~~~

Add request example:

~~~json
{
  "branch": "feature/demo",
  "path": "/home/user/worktrees/demo-feature",
  "createBranch": true,
  "baseBranch": "main"
}
~~~

Remove request example:

~~~json
{
  "path": "/home/user/worktrees/demo-feature"
}
~~~

The configured/main worktree cannot be removed through the API. An explicit
target path must belong to the configured repository's Git worktree list.

## 13. Troubleshooting

### The worktree is not shown

Run:

~~~bash
git -C "$MAIN_REPO" worktree list --porcelain
~~~

Then confirm that:

- DamHopper's project path points to the expected repository.
- The worktree was created from that repository, not another clone.
- The worktree directory exists and is a directory.
- The Project panel was refreshed.

### The row is unavailable or prunable

The directory may have been deleted, moved, or become invalid. If it was moved,
try git worktree repair. If it was intentionally deleted, remove stale
metadata with git worktree prune.

DamHopper fails closed for unavailable targets. New operations use the project
root only after the unavailable state is recorded; it does not silently send a
request to another worktree.

### Removal is blocked

Save or close dirty editor tabs and live terminals for that exact worktree.
Then refresh discovery and retry. Git may also block removal when untracked or
modified files remain.

### A branch cannot be checked out

The branch is probably already checked out in another worktree:

~~~bash
git -C "$MAIN_REPO" worktree list
~~~

Switch that worktree to another branch or remove it before checking out the
branch elsewhere.

## 14. Completion checklist

- [ ] Project is registered once in DamHopper.
- [ ] Worktree was created from the configured repository.
- [ ] Dependencies and local environment are prepared.
- [ ] Worktree is selected and target-sensitive panels were verified.
- [ ] Changes are tested and committed.
- [ ] Branch was pushed/merged according to the project workflow.
- [ ] Dirty tabs and live terminals are closed before removal.
- [ ] Worktree was removed with Git or DamHopper.
- [ ] Local and remote branches were cleaned up when appropriate.