# Phase 06 — Terminal target identity and persistence

## Context links

- [Plan](./plan.md)
- [Phase 01](./phase-01-target-contract-and-resolution.md)
- [Phase 03](./phase-03-session-selection-and-discovery.md)
- [Backend research](./research/researcher-01-backend-target-security.md)

## Overview

- Date: 2026-08-17
- Description: Give each root/worktree independent terminal sessions, validated cwd/env resolution, grouping, respawn, persistence, and restore behavior.
- Priority: P2
- Implementation status: completed
- Review status: completed (follow-up fixes verified; final independent review approved)

## Key Insights

- Running processes cannot follow selection changes; target identity is immutable session metadata.
- Existing deterministic IDs collide across worktrees and must gain a compact stable target discriminator.
- Backend persistence needs target metadata because sessions restore independently of frontend session selection.

## Requirements

- Include an optional worktree target in terminal creation, session info, respawn metadata, and persisted rows.
- Resolve cwd and project-relative environment files inside the requested target.
- Generate independent build/run/custom/profile IDs for root and every worktree without embedding raw paths.
- Group sessions by project then target across normal, compact, fleet, and floating-file surfaces.
- Keep existing sessions and cwd unchanged on target switch or external disappearance.
- Migrate legacy rows to null target (configured root) and define unavailable-target restore behavior.

## Architecture

Terminal creation resolves a target once, validates cwd/env, and stores canonical target metadata with the PTY session. A deterministic target token participates in client IDs; structured canonical path remains in `SessionInfo` and SQLite. Restore validates target availability before respawning; unavailable sessions retain recoverable metadata/status but do not spawn into an unintended root.

## Related code files

- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/terminal.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/pty/manager.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/pty/session.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/persistence/mod.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/persistence/worker.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/persistence/restore.rs`
- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/persistence/migrations/004_worktree_path.sql`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/client.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/lib/terminal-launch-context.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-terminal-manager.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-terminal-tree.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/lib/terminal-runtime-tree.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/pages/WorkspacePage.tsx`

## Implementation Steps

1. Extend terminal request/response, PTY create/respawn/session metadata, and persistence models with nullable target path/key.
2. Add the additive SQLite migration and update insert/load/update/restore queries with root-compatible defaults.
3. Resolve target before cwd and env-file validation; reject cross-target cwd and never silently substitute configured root.
4. Add a shared compact target token to build/run/custom/profile IDs and update terminal tree/group labels.
5. Route new terminal creation through current selection while attach/send/resize/kill continue using immutable session identity.
6. Define restore and runtime unavailable states: no unsafe respawn, no auto-kill, clear orphan label, explicit close/retry when target returns.
7. Add migration, resolver, ID collision, grouping, restart, selection-switch, and disappearance tests.

## Todo list

- [x] Extend terminal and PTY target metadata.
- [x] Add and test SQLite migrations 004–007.
- [x] Validate target-relative cwd and env files.
- [x] Partition terminal IDs and trees by target.
- [x] Implement restore/orphan lifecycle without cwd mutation, including pre-reader buffer hydration, replay, retry, and stale-incarnation guards.

## Success Criteria

- Root and each worktree own independent sessions with no ID collisions.
- Switching selection affects only newly created terminals; existing cwd/processes remain unchanged.
- Server restart restores valid target sessions to the same target and never respawns an unavailable worktree session at root.
- Legacy persisted sessions continue to restore as configured-root sessions.

## Risk Assessment

- ID format changes can affect pins/layout/selection; migrate or normalize all dependent state helpers.
- Persisted absolute paths may become stale after worktree movement; availability is revalidated at restore.
- Restore behavior must distinguish unavailable metadata from a running orphan process.

## Security Considerations

- Server-derived canonical target metadata overrides client labels/tokens.
- Validate cwd and env files inside the resolved target before PTY spawn.
- Do not leak environment-file contents or credentials in unavailable-target diagnostics.

## Next steps

Phase 06 is complete. Migration, restart/orphan, replay, retry, and target-identity tests pass; lifecycle integration and release validation are complete in Phase 07.
