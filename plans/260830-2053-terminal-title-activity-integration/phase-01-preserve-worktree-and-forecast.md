# Phase 01 — Preserve Worktree and Forecast Merge

## Context links

- [Parent plan](./plan.md)
- [README](../../README.md)
- [Code standards](../../docs/code-standards.md)
- [Terminal architecture](../../docs/system-architecture.md)
- Research: `agent://DevelopTitleResearch`, `agent://ActivityIndicatorResearch`

## Overview

- Date: 2026-08-30
- Priority: P1
- Implementation status: Pending
- Review status: Pending
- Description: Freeze refs and reconcile in a clean sibling worktree without changing the original staged, unstaged, or untracked content.

## Key insights

- The original worktree is not a valid merge boundary: 121 staged, 7 unstaged, 1 untracked path group at inspection.
- A sibling worktree from committed feature HEAD isolates the merge while preserving every original byte and index entry.
- Local `develop`, not a fetched remote, is the requested second parent.

## Requirements

- Never run `reset`, `clean`, `stash`, `checkout -- .`, `restore`, or broad ours/theirs commands in the original worktree.
- Never stage, commit, or modify original dirty paths during reconciliation.
- Recompute refs/conflicts if any SHA differs from the researched baseline.

## Architecture

```text
original dirty worktree (untouched, feat branch)
  └─ committed feature HEAD -> sibling clean integration worktree/branch
                                  └─ merge local develop + reconcile + validate
```

## Related code files

- Modify/create/delete: none.
- Inspect: original status; both divergent path sets; predicted conflict paths.

## Implementation steps

1. In the original worktree, record without mutation:
   ```bash
   git status --short --branch
   git rev-parse HEAD
   git rev-parse develop
   git merge-base HEAD develop
   git log --oneline --decorate --graph --boundary HEAD...develop
   ```
2. Record divergent paths and forecast conflicts:
   ```bash
   git diff --name-status 68d9a609..HEAD
   git diff --name-status 68d9a609..develop
   git merge-tree --write-tree --name-only HEAD develop
   ```
3. Expect 14 researched conflicts under `packages/ui`: `ActiveTerminalRuntimeDisplay.{tsx,test.tsx}`, `MultiTerminalDisplay.tsx`, `PaneContainer.tsx`, `SplitLayout.tsx`, `TabBar.tsx`, `TerminalRuntimeNavigatorItem.{tsx,test.tsx}`, `TerminalTabBar.tsx`, `WorkspacePage.tsx`, `use-terminal-manager.{ts,test.ts}`, and `terminal-auto-attach.{ts,test.ts}`. New output wins if refs drift.
4. Create the isolated branch/worktree from committed feature HEAD:
   ```bash
   git worktree add -b integration/terminal-title-activity-260830 ../dam-hopper-terminal-title-activity-integration HEAD
   ```
5. In the sibling worktree, require `git status --short` to be empty and record its HEAD. Do not copy the original index or working-tree files into it. Use the original dirty versions only as read-only reconciliation evidence.

## Todo list

- [ ] Original dirty inventory captured
- [ ] Refs and merge base captured
- [ ] Divergent paths/conflict forecast captured
- [ ] Clean sibling worktree created
- [ ] Original worktree confirmed untouched

## Success criteria

- Clean integration branch starts exactly at feature HEAD.
- Original staged/unstaged/untracked state remains intact.
- Conflict checklist matches current refs.

## Risk assessment

- **Ref drift:** repeat comparisons; do not trust stale SHAs.
- **Sibling path collision:** choose another sibling path; never clean the original.
- **Unverified dirty integration work lost:** keep original worktree and later preservation branch until owner reconciliation finishes.

## Security considerations

- Do not copy `.env`, credentials, browser artifacts, or registry data into the sibling worktree.
- Local integration/WIP branches must not be pushed until reviewed for secrets.

## Next steps

Run Phase 2 only inside the clean sibling worktree.
