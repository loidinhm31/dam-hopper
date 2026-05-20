# Phase 02: Root-Aware Git Operations

## Context Links

- Parent plan: [plan.md](./plan.md)
- Discovery phase: [phase-01](./phase-01-backend-vcs-root-discovery.md)
- Prior backend semantics: [../260519-0059-intellij-real-git-semantics/phase-01-backend-real-git-semantics.md](../260519-0059-intellij-real-git-semantics/phase-01-backend-real-git-semantics.md)

## Overview

Date: 2026-05-20
Priority: P1
Implementation status: Pending
Review status: Pending
Goal: make existing Git APIs operate against a selected VCS root without breaking callers that omit root.

## Key Insights

- Parent gitlink changes and child repo file changes are separate Git states.
- Current path operations assume one repository root per DamHopper project.
- Backward compatibility is easy if omitted `root` defaults to `"."`.

## Requirements

- Add optional `root` to diff/status/history/branch/mutation requests.
- Default `root` to `"."`.
- Validate root via Phase 01 discovery before running Git.
- For path operations, prefer the deepest matching VCS root when no explicit root is supplied.
- Block mixed-root commit in v1.
- Preserve pushed/shared-history protections and active-operation recovery behavior.

## Architecture

API behavior:

- `GET /api/git/:project/diff?root=.` returns parent root changes.
- `GET /api/git/:project/diff?root=<child>` returns child root changes.
- `GET /api/git/:project/diff?root=*` returns aggregate grouped entries for read-only UI.
- Mutation bodies accept `root?: string`.
- Commit accepts only one root; mixed-root staged state returns a structured block.

Backend behavior:

- Existing `repository.rs`, `diff.rs`, and `commit_file_ops.rs` keep their core logic.
- API handlers resolve project path + root id to `effective_repo_path`.
- Diff entry paths remain root-relative inside root-specific calls.
- Aggregate diff prepends metadata, not path hacks.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/git.rs`: root-aware history/branch handlers.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/git_diff.rs`: root-aware diff/stage/unstage/discard/commit handlers.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/diff.rs`: support submodule entry metadata.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/types.rs`: extend `DiffFileEntry`, add mixed-root block reason if needed.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/client.ts`: mirror request/response types.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/ws-transport.ts`: pass root query/body fields.

## Implementation Steps

1. Add helper `resolve_git_request_root(project_path, requested_root)`.
2. Update read handlers to accept `RootQuery { root: Option<String> }`.
3. Update mutation body structs to include `root: Option<String>`.
4. Extend `DiffFileEntry` with optional root and submodule metadata.
5. Implement aggregate diff by iterating discovered roots and collecting per-root results.
6. Add parent gitlink diff support using `git diff --submodule=short -- <path>` or equivalent parsing.
7. Update commit handler to reject mixed-root staged state.
8. Keep all mutation command construction as `Command::new("git").args(...)`.

## Todo List

- [ ] Add root query/body structs.
- [ ] Resolve root before all Git operations.
- [ ] Add aggregate diff read mode.
- [ ] Add parent submodule gitlink diff entries.
- [ ] Add backend tests for parent vs child mutation isolation.

## Success Criteria

- Stage/discard inside `embed-app/code-notes` runs in that child repo.
- Parent repo status still shows gitlink commit/dirty state.
- Branch checkout on a child root does not change parent or sibling roots.
- Existing no-root Git API tests still pass.

## Risk Assessment

- Aggregate diff may be slow on many dirty roots. Mitigation: initial implementation runs serially or with low bounded concurrency and can be optimized later.
- Root-relative vs project-relative paths can confuse callers. Mitigation: response includes `rootId` and `rootPath`; UI renders grouped labels.

## Security Considerations

- Never concatenate user root into shell commands.
- Reject root IDs not returned by discovery.
- Keep path validation inside selected root.

## Next Steps

Expose root selection and grouped status in the frontend in Phase 03.
