# Phase 03: Verification And Documentation

## Context Links

- Parent plan: `./plan.md`
- Backend phase: `./phase-01-backend-git-operations.md`
- Frontend phase: `./phase-02-frontend-branch-and-history-ui.md`
- Docs: `docs/api-reference.md`, `docs/frontend-components.md`, `docs/CHANGELOG.md`

## Overview

- Date: 2026-05-16
- Priority: P2
- Implementation status: pending
- Review status: pending
- Description: Verify the completed Git management feature and update docs where public behavior changes.

## Key Insights

- Backend Git tests should use real temp repositories.
- Web unit coverage is limited but build/type validation catches most contract drift.
- Manual verification is required because branch checkout/reset affects local repo state and Explorer refresh behavior.

## Requirements

- Run focused backend tests.
- Run web unit tests.
- Run web build.
- Run full project test command before final completion.
- Update API/component docs if endpoints or UI behavior changed.
- Record any intentionally deferred work.

## Architecture

- No new architecture required in this phase.
- Documentation updates should be limited to public API and UI behavior touched by implementation.

## Related Code Files

- Modify docs only if implementation changes public API or user-facing behavior:
  - `docs/api-reference.md`
  - `docs/frontend-components.md`
  - `docs/CHANGELOG.md`

## Implementation Steps

1. Run `cd server && cargo test git::tests`.
2. Run `pnpm --filter @dam-hopper/web test`.
3. Run `pnpm build`.
4. Run `pnpm test`.
5. Manually verify on a disposable repo:
   - create branch
   - checkout branch from Git panel
   - checkout branch from Explorer
   - dirty checkout options
   - cherry-pick success
   - reset soft/mixed/hard/keep
6. Update docs/changelog if endpoint contracts changed.
7. Capture residual risks in final implementation report.

## Todo List

- [ ] Run backend Git tests
- [ ] Run web tests
- [ ] Run web build
- [ ] Run full test command
- [ ] Manual disposable-repo verification
- [ ] Update docs if needed

## Success Criteria

- Focused backend and web checks pass.
- Full project test command passes or any unrelated failure is documented with evidence.
- Docs reflect new API endpoints and UI behavior.
- No repo state from manual destructive Git testing is left in the working tree.

## Risk Assessment

- Manual reset testing can damage the main repo if run in the project checkout. Use a disposable temp repo only.
- Full test suite can be slow. Focused failures must still be investigated, not ignored.

## Security Considerations

- Confirm destructive UI paths require explicit user confirmation.
- Confirm backend does not allow shell injection or path escape.

## Next Steps

- After this phase passes, implementation can be reviewed and committed with a focused conventional commit.
