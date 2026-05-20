# Phase 04: Tests Docs Validation

## Context Links

- Parent plan: [plan.md](./plan.md)
- Backend discovery: [phase-01](./phase-01-backend-vcs-root-discovery.md)
- Root-aware operations: [phase-02](./phase-02-root-aware-git-operations.md)
- Frontend UI: [phase-03](./phase-03-frontend-vcs-root-ui.md)

## Overview

Date: 2026-05-20
Priority: P1
Implementation status: Complete
Review status: Complete
Completed: 2026-05-20
Goal: prove multi-root Git behavior with tests and document the new contracts.

## Key Insights

- Submodule Git handling is destructive enough that real-repo tests are required.
- The main regression is graceful behavior with incomplete `.gitmodules`.
- Manual validation against `glean-oak` is mandatory because it reproduces the real failure mode.

## Requirements

- [x] Add backend tests using real temp Git repositories, no mocks.
- [x] Add frontend tests for root selector, grouped changes, and root-scoped mutations.
- [x] Update API and architecture docs.
- [x] Run Rust and web test suites.
- [x] Manually verify `/mnt/data/ws/sharing/glean-oak`.

## Architecture

Testing layers:

- Unit/integration tests in `server/src/git/tests.rs` for discovery and mutation isolation.
- Web tests in existing organism test files for query key and UI behavior.
- Manual validation checklist in docs for future regressions.

Documentation:

- `docs/system-architecture.md`: add VCS root discovery and root-scoped Git operation flow.
- `docs/api-reference.md`: document `GET /api/git/:project/roots` and root parameters.
- `docs/frontend-components.md`: describe root selector and grouped local changes.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/tests.rs`: backend regression matrix.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/WorkspaceGitPanel.test.ts`: root selector tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitHistoryActions.test.ts`: root mutation tests if needed.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md`: architecture update.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/api-reference.md`: API update.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md`: UI documentation.

## Implementation Steps

1. Add temp repo fixture:
   - parent repo
   - several gitlinks
   - incomplete `.gitmodules`
   - nested `.git` repos with dirty child state
2. Test discovery returns all roots and warning metadata.
3. Test parent diff shows gitlink entries.
4. Test child diff shows normal file entries.
5. Test child stage/discard/commit does not mutate sibling roots.
6. Test selected-root branch checkout affects one root only.
7. Add frontend tests for selector and grouped local changes.
8. Update docs.
9. Run validation commands.

## Todo List

- [ ] Add backend VCS root tests.
- [ ] Add frontend root selector tests.
- [ ] Update architecture docs.
- [ ] Update API docs.
- [ ] Update frontend docs.
- [ ] Run Rust tests.
- [ ] Run web tests.
- [ ] Manually validate `glean-oak`.

## Success Criteria

- `cd server && cargo test git::tests::submodule` passes.
- `cd server && cargo test git::tests::vcs_root` passes if test names are split.
- `pnpm --filter @dam-hopper/web test` passes.
- `glean-oak` Git panel loads and shows parent + child root states clearly.
- Validation summary: Rust suite 286 unit tests plus integration binaries `auth_no_auth` 11, `fs_mutate` 9, `fs_sandbox` 13, `fs_upload` 6, `fs_write_streaming` 5, `ws_fs_subscribe` 5; web Vitest 28 files / 144 tests; focused `vcs_root`, `child_root`, `submodule` filters passed.
- Review: 8.5/10, no critical/high issues, approved.

## Risk Assessment

- Test naming may not match exact module names. Mitigation: run full `cd server && cargo test` before completion.
- Manual repo has user changes. Mitigation: inspect only; do not mutate `glean-oak` unless explicitly approved.

## Security Considerations

- Test malformed paths and traversal root IDs.
- Verify root-scoped operations reject arbitrary client-supplied paths.

## Next Steps

After validation, mark phases complete and update changelog if implementation follows this plan.
