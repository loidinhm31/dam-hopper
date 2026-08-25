---
title: "Phase 02: Debounced Git-diff refresh from filesystem events"
status: completed 2026-07-18
priority: P2
created: 2026-07-18
---

# Phase 02: Debounced Git-diff refresh from filesystem events

## Context links

- [Plan overview](./plan.md)
- [FS subscription hook](../../packages/ui/src/hooks/use-fs-subscription.ts)
- [Git queries](../../packages/ui/src/api/queries.ts)
- [FS event DTO](../../packages/ui/src/api/fs-types.ts)
- [Server watcher rationale](../../server/src/fs/watcher.rs)

## Overview

**Date:** 2026-07-18. **Priority:** P2. **Status:** completed 2026-07-18. Coalesce filesystem activity into one project-scoped invalidation so Explorer badges and Changes reuse fresh Git-diff cache state.

## Key insights

- `useFsSubscription` is the sole client consumer of `fs:event`; adding refresh there covers its existing FileTree subscriptions without another WebSocket listener.
- The backend watcher already debounces 150 ms and is intentionally non-recursive for large repositories. Client invalidation still needs its own coalescing because one operation can emit several normalized events and several UI subscriptions can exist.
- App-initiated ChangedFilesList mutations already invalidate Git queries. Keep that path; the scheduler handles out-of-band filesystem changes.

## Requirements

- Centralize a single debounce bucket per `(QueryClient, project)`, not per FileTree instance.
- On an FS event, preserve existing tree delta/refetch behavior, then schedule invalidation for `git-diff` and associated Git file/untracked cache families needed by visible decorations and Changes pagination.
- Use an explicit, tested delay constant. Clear pending timers on execution; do not retain timers for disposed query clients.
- Do not add polling, server watches of `.git`, API endpoints, or a second Git-diff request path.
- Tab activation or mounting must refetch stale data as a no-backend fallback for index-only changes with no working-tree FS event.

## Architecture

Create a small `git-fs-invalidation` utility owning a `WeakMap<QueryClient, Map<project, timer>>`. `useFsSubscription` calls its scheduler after applying every FS delta. The timer invalidates query-key prefixes for that project once, allowing existing observers (`FileTree`, `ChangedFilesList`, editor decorations) to refetch through their current query definitions. Existing mutation invalidators remain unchanged and may coexist safely.

## Related code files

- **Create:** `packages/ui/src/lib/git-fs-invalidation.ts` — project-scoped debounce scheduler and public delay constant/test seam.
- **Create:** `packages/ui/src/lib/git-fs-invalidation.test.ts` — fake-timer coalescing, project isolation, target query-key coverage.
- **Modify:** `packages/ui/src/hooks/use-fs-subscription.ts` — call scheduler after the current cache update/invalidation logic.
- **Create/modify:** `packages/ui/src/hooks/use-fs-subscription.test.ts` — verify an FS event keeps tree delta behavior and schedules Git refresh.
- **Reference only:** `packages/ui/src/api/queries.ts`, `packages/ui/src/components/organisms/ChangedFilesList.tsx`.

## Implementation steps

1. Define the minimal scheduler API with a `QueryClient`-like invalidation dependency suitable for unit tests; keep timer ownership private and keyed per project.
2. Select a short client debounce window after measuring current 150 ms server debounce; document why it avoids request storms without making UI feel stale.
3. In the existing FS event callback, run the exact tree update path first, then schedule Git invalidation regardless of `modify`, `create`, `remove`, or rename outcome.
4. Invalidate prefix keys for `git-diff`, `git-untracked`, and file-diff data for the project only. Do not invalidate other projects or reimplement `ChangedFilesList` mutation logic.
5. Confirm tab mounting/activation requests a current aggregate diff, covering `.git` index changes that cannot generate a watched working-tree event under current server constraints.

## Todo list

- [x] Add central scheduler and fake-timer tests.
- [x] Attach it to the FS event path.
- [x] Verify one project cannot invalidate another.
- [x] Verify known mutation actions still use their existing invalidation path.

## Completion evidence

- Completed 2026-07-18.
- Central scheduler now coalesces FS-triggered Git invalidation per project.
- FS subscription path schedules Git refresh after the tree update flow.
- Tests cover project isolation and preserved mutation invalidation behavior.

## Success criteria

- A burst of FS events produces one Git cache invalidation per project/debounce window.
- Explorer status badges, Changes entries, and editor decorations refresh from shared query data.
- Existing tree modify/remove/create/rename behavior is unchanged.
- No polling, new WebSocket subscription, backend/API, or auth changes are introduced.

## Risk assessment

- **Index-only Git commands:** `.git/index` is outside the non-recursive working-tree watch. Mitigate with fresh fetch on Changes activation and existing action invalidation; do not claim immediate detection for external index-only activity without a backend design change.
- **Query storms:** multiple FileTrees may hear events. Mitigate with module-level per-client/project coalescing.
- **Timer leakage:** `WeakMap` prevents QueryClient retention; delete the project timer entry when it fires.

## Security considerations

Only invalidates local client caches. It sends no path, repository metadata, credential, or token beyond existing Git queries.

## Next steps

Run all targeted tests, then perform terminal-mode manual checks at normal and near-fullscreen panel sizes.
