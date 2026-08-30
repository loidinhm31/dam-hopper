# Phase 04 — Review, Docs, and Safe Branch Adoption

## Context links

- [Parent plan](./plan.md)
- [Reconciliation phase](./phase-02-merge-and-reconcile-terminal-contracts.md)
- [Validation phase](./phase-03-compile-and-behavior-validation.md)
- [Frontend components](../../docs/frontend-components.md)
- [System architecture](../../docs/system-architecture.md)
- [Changelog](../../docs/CHANGELOG.md)
- [Roadmap](../../docs/project-roadmap.md)

## Overview

- Date: 2026-08-30
- Priority: P1
- Implementation status: Pending
- Review status: Pending
- Description: Review against both parents, document both numbering systems and activity lifecycle, then fast-forward the named feature branch without losing its original dirty worktree.

## Key insights

- A green build cannot prove both parent behaviors or complete ancestry.
- Docs must distinguish visible per-project title ordinals from pre-existing global notification numbering.
- The original dirty tree can be preserved on a local-only branch before the validated integration result advances the named feature branch.

## Requirements

- Independent review uses both parent diffs plus Phase 3 terminal evidence.
- No unresolved P1/P2 correctness finding.
- Never delete the preservation branch until every unique user-owned delta is classified.
- Never push unverified preservation commits or secret-bearing content.

## Architecture

```text
validated integration branch (feature HEAD + merge develop + reconciliation)
  -> reviewed merge commit
  -> feature branch fast-forward

original dirty tree
  -> local preservation branch/commit(s)
  -> classify unique deltas against validated feature result
  -> intentionally reapply only owner-approved unique work
```

## Related code files

### Review emphasis

- All Phase 2 add/reconcile/preserve paths.
- All Phase 3 tests.
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx`
- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- Browser notification formatter/service call chain using `terminalOrder`.

### Documentation updates

- Modify `docs/frontend-components.md`: visible per-project title projection/rendering and sibling activity indicators.
- Modify `docs/system-architecture.md`: independent title/activity/global-notification data flows; replay/restart invariants unchanged.
- Modify `docs/CHANGELOG.md`: merged user-visible behavior and validation actually run.
- Modify `docs/project-roadmap.md` only if this merge changes a tracked milestone status; otherwise leave unchanged.
- No new documentation file.

## Implementation steps

1. Verify merge graph and parents:
   ```bash
   git merge-base --is-ancestor develop HEAD
   git show --no-patch --format='%H%n%P%n%s' HEAD
   git log --oneline --decorate --graph --boundary 964506ba..HEAD
   ```
   If refs drifted, substitute the recorded Phase 1 feature parent.
2. Compare the result against both pre-merge parents. Against feature parent, ensure no Traditional/activity deletion. Against develop parent, ensure no title/mobile/browser-debug/Windows PTY deletion. Review every conflict resolution and every current original-worktree delta touching those paths; never copy it blindly.
3. Review title correctness/accessibility: one `sr-only` full title, visible base truncation, shrink-0 suffix, ordinals recomputed from ordered tabs, explicit project grouping, readable mounted-only fallback, and no title-derived identity.
4. Review activity correctness: shared status precedence, session-scoped ownership/cleanup, replay exclusion, restart reopening, fresh-output activation, aggregate project status, and no duplicate liveness dot.
5. Review global Bash notification behavior: global 1-based `openTabs` order flows through `TerminalKeepAliveHost`/`TerminalPanel`; invalid order is omitted; visible per-project `title.ordinal` never enters notification context.
6. Update docs only after code/tests are final. Preserve both branches' unrelated doc changes. Record only commands actually run and Linux limitations; do not claim Windows runtime verification.
7. Run final lint once and repeat hygiene:
   ```bash
   pnpm lint
   git diff --check
   git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- .
   ```
8. Conduct independent code review with Phase 3 evidence and both-parent diffs. Fix correctness findings, rerun the affected gate, then rerun all Phase 3 gates and final lint once. Commit the reviewed integration result on `integration/terminal-title-activity-260830`.
9. Preserve the original dirty worktree before advancing its checked-out branch:
   - Re-record `git status --short --branch` and inspect staged, unstaged, and untracked content for secrets.
   - In the original worktree, create `preserve/pre-title-activity-integration-260830` from the current feature ref without discarding changes.
   - Commit path-coherent local preservation commits only after review; include all intended staged/unstaged/untracked files. Keep branch local and clearly mark it unverified.
   - If any file cannot safely be committed, stop adoption and leave the original tree untouched; do not stash/reset/clean it.
10. After preservation succeeds, switch the original worktree back to `feat/terminal-traditional-projects-panel` and advance only by:
    ```bash
    git merge --ff-only integration/terminal-title-activity-260830
    ```
11. Compare the preservation branch against the updated feature branch. Reapply only unique, owner-approved deltas in separate focused commits; do not reapply duplicate develop/title integration wholesale. Keep the preservation branch and sibling worktree until classification completes.

## Todo list

- [ ] Develop is ancestor; merge parents verified
- [ ] Both-parent diffs reviewed
- [ ] Title/activity/notification invariants reviewed
- [ ] Docs updated accurately
- [ ] Final lint and hygiene pass
- [ ] Independent review clean
- [ ] Original dirty tree preserved locally
- [ ] Named feature branch fast-forwarded safely
- [ ] Unique preserved deltas classified

## Success criteria

- `feat/terminal-traditional-projects-panel` contains the real local-develop merge and reviewed reconciliation.
- Traditional project panels, project-scoped visible ordinals, unified activity/restart behavior, and global notification order all remain.
- Original user-owned work remains recoverable and no unrelated delta was overwritten.
- Docs and recorded validation match observed evidence.

## Risk assessment

- **Review only final diff:** misses dropped parent behavior. Mitigation: compare both parents.
- **Preservation commit contains secrets:** inspect before staging/commit; never push it.
- **Duplicate reapplication:** classify preservation delta against final branch before any reapply.
- **Premature cleanup:** retain branch/worktree until owner reconciliation is complete.

## Security considerations

- Keep preservation commits local and credential-free.
- Review browser-debug permissions and Windows shell validation as security-sensitive develop changes.
- Title/activity docs and diagnostics must not expose session IDs or terminal output content.

## Next steps

Report merge parents, changed paths, exact command exits, browser observations, review findings, docs changed, and preservation/adoption status. No push without separate instruction.
