# Phase 01 — Git-unavailable state

## Context links

- Parent: [plan](./plan.md)
- Research: [Git UI](./research/researcher-01-git-unavailable-ui.md)

## Parallelization info

Independent of Phase 02. Phase 03 waits for it.

## Overview

Priority P1. Status **DONE — 2026-08-01 13:11 +07:00**. Make a configured directory without `.git` an explicit Git-unavailable outcome rather than an empty Changes list.

## Key insights

- `GET /api/git/{project}/branches` currently resolves `.` then reports `InvalidInput` / HTTP 400 if no Git marker exists.
- The UI currently treats failed diff data as an empty collection.

## Requirements

- A non-Git project must show an actionable unavailable state and suppress Git mutations.
- Valid roots, submodules, nested repos, permissions failures, and unrelated API failures retain current semantics.
- No repository creation or config mutation.

## Architecture

Map the backend's known "not initialized" condition to a stable, typed client outcome. The diff/branches consumers render that outcome distinctly; generic error paths stay generic.

## Related code files

- Modify: `server/src/error.rs`, `server/src/api/error.rs`, `server/src/api/git.rs`
- Modify: `server/src/api/tests.rs`, `server/src/git/tests.rs`
- Modify: `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/api/queries.ts`
- Modify: `packages/ui/src/components/organisms/ChangedFilesList.tsx` and its focused tests

## File ownership

Phase 01 exclusively owns every file above.

## Implementation steps

1. Define the narrow non-repository error contract at the backend boundary; do not classify arbitrary Git failures.
2. Return a stable status/code that can be distinguished from invalid client input.
3. Extend transport/client typing and queries to carry the unavailable result.
4. Render a clear non-Git explanation in Changes and disable commit/stage/discard controls.
5. Add real-temp-filesystem API tests for registered plain directories and preserve initialized-repo coverage.
6. Add UI tests for unavailable, normal empty, and generic error states.

## Todo list

- [x] Backend contract and tests
- [x] Typed client mapping
- [x] Changes UI state and tests

## Success criteria

- A plain configured directory is never rendered as “No local changes.”
- A real repository still lists branches and changes.
- No action is enabled against an unavailable Git root.

## Conflict prevention

Do not edit `ErrorBoundary` files owned by Phase 02. Keep release validation changes out of this phase.

## Risk assessment

Misclassifying a real Git failure as non-Git could hide remediation. Limit classification to the explicit no-Git marker condition.

## Security considerations

Preserve project-root validation and avoid filesystem disclosure beyond the configured project.

## Next steps

Phase 03 validates integration after Phase 01 and 02 complete.
