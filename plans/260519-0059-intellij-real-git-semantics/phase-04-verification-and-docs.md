# Phase 04: Verification and Docs

## Context Links

- Overview plan: [plan.md](./plan.md)
- Docs: [../../docs/api-reference.md](../../docs/api-reference.md), [../../docs/system-architecture.md](../../docs/system-architecture.md)

## Overview

Priority: P1  
Status: Pending  
Goal: prove the refactor works and document Git operation contracts.

## Key Insights

- Git features are destructive enough that tests are not optional.
- Documentation must specify exact semantics or future changes will regress into ambiguity.
- Manual verification against a running server is still needed for integration behavior.

## Requirements

- Backend tests for every destructive or history-changing operation.
- Frontend tests for mutation state and invalidation scope.
- Docs updated for safe vs rewrite operations.
- Manual test checklist for browser behavior.

## Architecture

Verification layers:

- Rust unit/integration tests for Git repo state.
- Web unit tests for action availability and query invalidation.
- Manual browser test for editor/file-tree behavior.
- Docs as operation contract.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/tests.rs`: backend Git operation matrix.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/*.test.tsx`: UI behavior tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/queries.ts`: testable refresh helpers.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/api-reference.md`: document endpoints and result semantics.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md`: document Git operation architecture.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/CHANGELOG.md`: record behavior change.

## Implementation Steps

1. Add backend test matrix:
   - rollback file
   - rollback hunk
   - drop HEAD commit
   - drop non-HEAD commit
   - block pushed drop
   - revert pushed commit
   - revert selected changes
   - undo last commit
   - active rebase/cherry-pick detection
2. Add frontend tests:
   - local discard invalidates only expected keys
   - history rewrite clears dropped selection only
   - pushed commit shows revert and disabled drop
   - recovery state banner renders actionable copy
3. Run:
   - `cd server && cargo test`
   - `pnpm --filter @dam-hopper/web test`
   - `pnpm lint`
4. Manual verify with running server:
   - modify open file, rollback from Git panel
   - drop selected file from old local commit
   - drop local commit with descendant
   - revert pushed commit in clone/remote test repo
   - confirm no browser reload
5. Update docs after tests pass.

## Todo List

- [ ] Add backend Git operation matrix tests.
- [ ] Add frontend behavior tests.
- [ ] Run Rust tests.
- [ ] Run web tests.
- [ ] Run lint.
- [ ] Update docs and changelog.

## Success Criteria

- All automated checks pass.
- Manual browser verification passes.
- Docs clearly explain safe vs rewrite Git operations.
- No known regression in existing branch/history UI.

## Risk Assessment

- Full `cargo test` may take time. Mitigation: run targeted tests during development, full suite before completion.
- Web tests may need mocks for query client. Mitigation: follow existing test style in `WorkspaceGitPanel.test.ts`.

## Security Considerations

- Confirm tests include path traversal rejection where new selected-file operations are added.
- Confirm API docs do not imply arbitrary command execution.

## Next Steps

After this phase, decide whether to add force-push workflow and IntelliJ-style changelists as separate plans.
