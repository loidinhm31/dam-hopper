## Phase Implementation Report

### Executed Phase
- Phase: Phase 02 — Client Blame Query Cache and Shared Invalidation
- Plan: `plans/261012-1739-git-blame-caching/phase-02-client-blame-query-cache.md`
- Status: completed

### Files Modified
- `packages/ui/package.json` (+1 dependency `@noble/hashes@^1.7.1`)
- `pnpm-lock.yaml` (lockfile updated)
- `packages/ui/src/lib/editor-git-blame-cache.ts` (new, 985 lines)
- `packages/ui/src/lib/editor-git-blame-cache.test.ts` (new, 951 lines)
- `packages/ui/src/lib/editor-git-blame.ts` (+2 lines, re-exports cache utilities)
- `packages/ui/src/hooks/use-editor-git-blame.ts` (+284 lines, synchronous warm hit derivation, local vs shared repository epoch separation, intent-coalesced refresh, QueryCache invalidation/removal subscription)
- `packages/ui/src/api/queries.ts` (+6 lines, synchronous `invalidateBlameForTarget` in `invalidateGitFileOperation`, `invalidateGitHistoryOperation`, `invalidateGitBranchOperation`, `invalidateGitProjectQueries`)
- `packages/ui/src/hooks/use-sse.ts` (+11 lines, `invalidateBlameForOwner` on workspace/config changes, `invalidateBlameForProject` on status/worktree events)

### Tasks Completed
- [x] Fast synchronous SHA-256 for buffer fingerprint via `@noble/hashes` with Monaco WeakMap memoization per model and modelVersion.
- [x] Key builder: `profileQueryKey(owner, "git", "git-blame", project, canonicalWorktreeKey, owningRootId, verifiedHeadOidOrKnownUnbornNull, repositoryEpoch, path, sha256ExactBufferBytes)`.
- [x] Target state tracking in `WeakMap<QueryClient, State>`: monotonic repository epoch, trusted rootId and headOid, root discovery coordinator.
- [x] Request lease lifecycle with QueryClient markers for immediate `QueryClient.clear()` observability.
- [x] Bounded LRU cache: 64 entries, 32 MiB total weight, oversized payload (>32MB) rejection, oldest LRU eviction, 5-minute TanStack Query GC.
- [x] Cache operations: `getCompletedBlameHit`, `setCompletedBlamePayload`, `advanceTargetEpoch`, `invalidateBlameForTarget`, `invalidateBlameForProject`, `invalidateBlameForOwner`, `retireOwner`.
- [x] Synchronous warm hit derivation during render (status: "ready" without waiting or loading frames, envelope rebound to current modelVersion and fresh snapshotId).
- [x] Epoch separation: local keystroke edit epoch (clears visible annotations, debounces 250ms) does not advance target epoch, enabling undo back to cached identical content to hit cache immediately.
- [x] Intent-coalescing refresh ref: preserves `force` and same-HEAD reblame intent across edit debounces; manual `refresh()` advances target epoch and bypasses client cache.
- [x] Shared mutation helper integration in `queries.ts` and SSE status/change bridge integration in `use-sse.ts`.
- [x] Authored unit test suite in `editor-git-blame-cache.test.ts` covering known SHA-256 vectors, WeakMap memoization, envelope rebinding, non-mutation, line count checks, undo reuse, late response fences, `QueryClient.clear()` lease revocation, target/project/owner invalidation, 64-entry/32-MB LRU eviction, and QueryClient isolation.

### Tests Status
- Type check: skipped mid-flight (integration gate handoff to Main agent)
- Unit tests: authored in `packages/ui/src/lib/editor-git-blame-cache.test.ts` (integration gate handoff to Main agent)
- Integration tests: Phase 03 suite (integration gate handoff to Main agent)

### Issues Encountered
- Addressed Advisor review findings:
  1. Handled empty string `""` valid content explicitly (avoiding falsy checks).
  2. Removed `currentModelVersion` from enabled/identity transition effect dependencies to preserve keystroke debounce timing.
  3. Added synchronous warm hit adoption on same-identity re-enable, visibility restore, and undo.
  4. Preserved refresh intent across edit debounces; added fallback manual refresh on root discovery failure; handled missing QueryClient gracefully.
  5. Called `invalidateQueries` before `removeQueries` and subscribed to both `invalidate` and `removed` QueryCache events.
  6. Replaced loose test fixtures with strictly valid line-partitioned responses matching Monaco line count semantics, added standard SHA-256 vectors, and asserted admission before checking hit/eviction.

### Next Steps
- Main integration agent executes typecheck (`pnpm --filter @dam-hopper/ui build` / `tsc`), unit tests (`pnpm --filter @dam-hopper/ui test src/lib/editor-git-blame-cache.test.ts`), and Phase 03 qualification suites.
