# Research: Git Operation Semantics

Date: 2026-05-16

## Reset Modes

Use standard Git reset modes:

- `--soft <hash>`: move HEAD only. Index and working tree keep differences, so changes are staged for commit.
- `--mixed <hash>`: move HEAD and reset index. Working tree keeps differences, unstaged.
- `--hard <hash>`: move HEAD, index, and working tree. Local changes are lost.
- `--keep <hash>`: move HEAD and update files that differ between target and HEAD, while preserving local changes where possible. Git fails if local changes would be overwritten.

UI copy requested by user:

- Soft: files won't change, differences will be staged for commit.
- Mixed: files won't change, differences won't be staged.
- Hard: files will be reverted to selected commit. Warning: any local changes will lost.
- Keep: files will be reverted to selected commit, but local changes will be kept intact.

## Checkout Dirty Strategy

Use a two-step flow:

1. Attempt normal checkout.
2. If Git blocks due dirty worktree, show a checkout dialog with:
   - Normal
   - Stash then checkout
   - Force checkout
   - Cancel

Recommended backend strategies:

- `normal`: `git checkout <branch>`
- `stash`: `git stash push -u -m "dam-hopper checkout <branch> <timestamp>"` then checkout
- `force`: `git checkout --force <branch>`

Do not auto-pop the stash. Auto-pop introduces conflict risk and hides recovery state.

## Cherry-pick

Use `git cherry-pick <hash>`.

Return conflict state as a normal action result when Git exits non-zero and output indicates conflict. The UI should invalidate conflicts and local changes so existing conflict editor can take over.

## Safety Notes

- Validate branch names using existing git ref rules.
- Validate commit hashes with `git2::Oid::from_str` or `git rev-parse --verify`.
- Avoid shell strings entirely.
- Force checkout and hard reset require explicit UI confirmation.

## Unresolved Questions

None.
