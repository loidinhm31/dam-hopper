# Phase 01: Backend VCS Root Discovery

## Context Links

- Parent plan: [plan.md](./plan.md)
- Prior Git semantics: [../260519-0059-intellij-real-git-semantics/plan.md](../260519-0059-intellij-real-git-semantics/plan.md)
- Architecture docs: [../../docs/system-architecture.md](../../docs/system-architecture.md)
- API docs: [../../docs/api-reference.md](../../docs/api-reference.md)

## Overview

Date: 2026-05-20
Priority: P1
Implementation status: Complete
Review status: Pending
Goal: add a resilient Git VCS root discovery layer that does not fail when `.gitmodules` is incomplete.

## Key Insights

- `/mnt/data/ws/sharing/glean-oak` has 7 gitlink entries but only 2 `.gitmodules` mappings.
- `git submodule status --recursive` fails on `embed-app/cham-lang`.
- IntelliJ registers submodules/nested repos as project roots and detects unregistered roots.
- DamHopper should use Git index and filesystem facts before optional `.gitmodules` metadata.

## Requirements

- Detect primary root as `rootId = "."`.
- Detect gitlinks via `git ls-files --stage` mode `160000`.
- Detect nested repositories by finding `.git` directories/files under project root.
- Read `.gitmodules` with `git config -f .gitmodules --get-regexp` only when present and valid.
- Return partial discovery results with per-root warnings instead of failing the whole request.
- Exclude heavy/generated dirs such as `.git`, `node_modules`, `target`, and hidden tool dirs when scanning nested repos.

## Architecture

Add a small discovery module under `server/src/git/`:

- `vcs_roots.rs`: root discovery, root id resolution, mapping-state classification.
- `types.rs`: add serializable `VcsRoot`, `VcsRootKind`, `VcsRootMappingState`, and `SubmoduleGitlinkInfo`.
- `api/git.rs`: expose `GET /api/git/:project/roots`.

Root classification:

- `primary`: project repo itself.
- `submodule`: path exists as gitlink in parent index.
- `nestedRepo`: nested `.git` exists without parent gitlink.
- `mapped`: path has matching `.gitmodules` metadata.
- `unmapped`: gitlink exists but `.gitmodules` has no matching path.
- `missing`: gitlink path missing on disk.
- `uninitialized`: gitlink path exists but no usable nested `.git`.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/types.rs`: add VCS root types.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/git/vcs_roots.rs`: discovery implementation.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/mod.rs`: export new functions/types.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/git.rs`: add roots route handler.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs`: register route.

## Implementation Steps

1. Add `VcsRoot` and related enums in `types.rs`.
2. Implement `discover_vcs_roots(project_path)`.
3. Implement `.gitmodules` parser that returns an empty map on missing file and a warning on parse failure.
4. Implement gitlink discovery using `git ls-files --stage`.
5. Implement nested `.git` scan with pruning.
6. Merge roots by relative path; gitlink metadata wins over plain nested-repo classification.
7. Add `resolve_vcs_root(project_path, root_id)` for later phases.
8. Add `GET /api/git/:project/roots`.

## Todo List

- [x] Add root types.
- [x] Add discovery implementation.
- [x] Add route and transport mapping.
- [x] Add malformed `.gitmodules` regression tests.

## Completion Notes

Completed: 2026-05-20 10:57 Asia/Saigon

## Success Criteria

- `discover_vcs_roots()` returns all `glean-oak` gitlinks even when `.gitmodules` is incomplete.
- Discovery never runs `git submodule status --recursive`.
- API response includes root-local status summary where available.

## Risk Assessment

- Large workspaces can make nested repo scanning expensive. Mitigation: prune known heavy dirs and cap traversal depth for `.git` discovery.
- Windows `.git` files for worktrees/submodules differ from directories. Mitigation: treat both file and directory `.git` as a nested repo signal.

## Security Considerations

- Root IDs are server-derived relative paths.
- Reject absolute paths and traversal when resolving root IDs.
- Do not expose arbitrary Git command execution.

## Next Steps

Use `resolve_vcs_root()` in all root-aware Git operations in Phase 02.
