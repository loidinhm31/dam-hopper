# Phase 02 — Client Blame Query Cache and Shared Invalidation

## Overview
- Priority P2; status complete; effort 6h; independent of Phase 01 under unchanged wire DTOs.
- Goal: remount/reopen/toggle reuses current attribution immediately; dirty edits, repository mutations and owner changes never reuse stale attribution.
- Phase 03 owns existing hook/API/event regression suites and browser/E2E tests. This phase authors focused cache-helper tests only; main executes after integration.

## Context and researched constraints
- `use-editor-git-blame.ts:128,161,206-230,601-620`: QueryClient is available but attribution is local state, cleared on identity/enable changes; mount issues direct blame POST.
- `use-editor-git-blame.ts:308-348`: response acceptance fences owner/tab/model/version/local epoch/repository epoch, validates echoed snapshot/model and range partition.
- `use-editor-git-blame.ts:633-655`: synchronous dirty clearing followed by 250 ms debounce. `:682-754` subscribes to invalidation only while hook is enabled/mounted; not sufficient for reusable entries after unmount.
- `queries.ts:172-186`: existing key shape is `["profile", profileId, generation, "git", prefix, project, projectTargetCacheKey(target), ...parts]`. Do not substitute `profileGitQueryKey`'s different ordering, ambient profile keys or dynamically recaptured owner after await.
- `queries.ts:331-443`: shared mutation invalidators; `use-sse.ts:509-585`: always-owner-bound transport cache bridge. Existing status key `["git", projectName, null]` does not match `gitQueryKey`'s prefix-first layout; use a precise new blame helper, not broad unrelated key cleanup.
- `connections.ts:151-165` exports `onConnectionInvalidated` for exact-generation retirement. Existing QueryClient, not a new host/global singleton, owns reusable server state.
- [Upstream TanStack query state](https://github.com/TanStack/query/blob/main/packages/query-core/src/query.ts) explicitly contains `isInvalidated`; `getQueryData()` alone is not hit eligibility. [QueryClient reference](https://tanstack.com/query/v5/docs/reference/QueryClient). Use installed v5 types as API authority during implementation.
- [SHA library](https://github.com/paulmillr/noble-hashes): small synchronous SHA-256 submodule avoids asynchronous hashing delaying immediate reuse or HTTPS-only `crypto.subtle` availability. Select a stable release/import compatible with current Node >=20 baseline; do not silently raise repository Node minimum.

## Exclusive ownership
Modify: `packages/ui/src/hooks/use-editor-git-blame.ts`, `packages/ui/src/api/queries.ts`, `packages/ui/src/hooks/use-sse.ts`, `packages/ui/src/lib/editor-git-blame.ts`, `packages/ui/package.json`, `pnpm-lock.yaml`.
Create: `packages/ui/src/lib/editor-git-blame-cache.ts` and `editor-git-blame-cache.test.ts`.
Delete: only local request/cache code made obsolete by replacement, not lifecycle guards.
No component, connection-registry implementation, transport DTO or store changes. Existing per-tab `blameEnabled` and its persistence exclusion stay unchanged. No edits to Phase 03 test files.

## Architecture: cache value, identity and hit eligibility
### Reuse the existing QueryClient
Use a small TanStack Query-backed completed-result cache integrated into the existing direct request runner; no automatic query observers/refetch policy and no second network scheduler. This preserves existing single-flight, AbortController and error semantics without a broad `useQuery` rewrite.

```text
profileQueryKey(capturedOwner,
  "git", "git-blame", project, canonicalWorktreeKey,
  owningRootId, verifiedHeadOidOrKnownUnbornNull,
  repositoryEpoch, path, sha256ExactBufferBytes)

CachedAttribution = Omit<GitBlameResponse, "snapshotId" | "modelVersion">
```

- Include both content fingerprint AND HEAD; either alone is insufficient. `undefined` means unobserved root/HEAD; `null` means a verified unborn HEAD, not a wildcard.
- Root ID handles nested repositories/submodules. Existing `projectTargetCacheKey` handles canonical root versus linked-worktree identity. Cache key excludes tab key, model URI/version, snapshot UUID and active ambient profile.
- Compute SHA-256 from exact UTF-8 buffer bytes; do not put content itself in query keys/logs. Memoize only by live model object and version in `WeakMap` so repeated renders avoid copying/hashing; do not retain model/editor in cache entries. No weak/small hash fallback. Hash after edit debounce, except one fingerprint needed to qualify a newly mounted model.
- Store only structurally validated successful payloads. No busy/error/aborted/malformed/stale failures cached; current network error remains normal hook state.
- A hit requires connected captured owner, matching server URL binding, eligible tab and current model, successful non-invalidated query state, same current target epoch, trusted owning root/HEAD and exact fingerprint/line count. Freshness is not inferred from `getQueryData` existence.
- Cache payload is validated before insertion against the actual HTTP snapshot/model. A hit creates a new envelope using current model version and a fresh local snapshot correlation, then validates again. Do not mutate shared cached objects to update model identity. All commit reveal version/root guards remain valid.

### Trusted revision and shared repository epochs
- Cache-helper state lives per QueryClient (`WeakMap<QueryClient, State>`), never per hook. Register target state before each pending request, so invalidation also fences requests whose completed entry does not yet exist. Register a small owner-qualified, uniquely keyed pending lease marker via public QueryClient APIs; QueryCache marker removal revokes that token. This makes `QueryClient.clear()` observable even on the first request with no completed entries. Markers contain no buffer/model references and are removed on settle.
- Target state tracks captured owner/target, monotonic repository epoch, and last authoritative root mapping/revision observed by successful blame/root discovery. Trust is valid only in the same epoch and while corresponding root query state is not invalidated. Root discovery missing/unavailable or workspace remapping revokes trust.
- Initial cache miss can keep current direct POST; response supplies authoritative root/HEAD. Unknown or revoked root knowledge must be rediscovered before reusing an old completed entry. If discovery confirms unchanged root/HEAD, lookup may then avoid POST; no promise of instantaneous cache display when freshness is unknown.
Focus/visibility still performs existing root discovery without polling. Beginning discovery temporarily suspends new cache-hit eligibility for that target; already-mounted unchanged attribution may remain visible while checking, but a new/remounted consumer waits rather than publishing unverified data. Capture a discovery token plus repository epoch; a late discovery result after newer mutation/clear cannot restore root trust. If root/HEAD unchanged and no same-HEAD index invalidation, retain cache; if changed, clear visible attribution and revoke affected reuse before replacement request. Zero-loading-frame guarantee applies only to eligible hits when no discovery is pending.

### Epoch Separation: Local Edit Fence vs Shared Repository Epoch
- **Local Edit Epoch (`localEpochRef`)**: Advanced strictly on editor keystrokes and buffer content changes. Clears visible annotations and fences pending in-flight requests. Does NOT advance the shared target epoch. This preserves cache entries across typing, enabling undo back to previously cached identical content to hit the cache immediately.
- **Shared Target Repository Epoch**: Advanced strictly on external Git mutations (commits, branch changes, pulls, rebase, resets, staged renames) and SSE repository status events. Invalidation of this epoch revokes all cached attribution entries for that target.

Shared repository epoch advances synchronously BEFORE invalidation/cancellation/await on matching Git mutations and push events. Pending requests capture epoch; acceptance and cache insertion both reject epoch mismatch. Removing/invalidation alone is insufficient: a late success must not repopulate a reusable entry.
- Shared mutation helpers cover file/index changes and all branch/history operations while blame hooks are absent. Known target: invalidate its exact owner/project/worktree. Status events carry project but not reliable worktree/root: invalidate all blame targets for that owner's matching project; missing project name conservatively invalidate that owner, never another profile.
- Current staged-rename origin is mutable at the same HEAD; same-HEAD diff/status invalidation revokes cached attribution. Do not optimize it away just because HEAD did not change.
- `onConnectionInvalidated(owner, ...)` removes that generation's reusable entries and cancels/revokes its pending request and discovery tokens. Release callback when the last cached/pending target disappears. QueryCache removal/GC and `QueryClient.clear()` must release bookkeeping/subscriptions too; clear revokes lease markers BEFORE any deferred old response can publish or recreate data, even if abort is ignored.

### Bounds and memory lifecycle
- Retained completed attribution budget: 64 entries and 32 MiB globally per QueryClient across profiles, with five-minute inactive query GC. GC is cleanup, not the hard cap.
- Account strings conservatively at two bytes per JS UTF-16 code unit, numeric fields/vector/object overhead with documented deterministic estimates, and key/registry strings. Do not claim exact browser heap cap from serialized JSON size. Oversized result is returned to current hook but never retained.
- Track access recency in helper and evict least-recent completed entries using `removeQueries({ exact: true })`. Existing direct runner holds its accepted response locally, so reusable-entry eviction never cancels an active observer or blanks a mounted gutter. In-flight request registry is separate and not evicted as completed data.
- Cap epoch/root bookkeeping to targets with retained entries or admitted pending work; remove empty target state after all pending work settles. Even after state retirement, a request's captured lease/token cannot become valid by recreating a zero epoch.
- Configure five-minute GC for this namespace using existing TanStack APIs before `setQueryData`, independent of host defaults. Dispose query-cache/owner listeners when no entries or pending leases remain. No timers per model, storage persistence, Monaco references, raw content retained after request settle, or global cache across QueryClients.

## Implementation steps
1. Implement typed helper/key builder and immutable attribution envelope bind/validate operations. Expose a narrow API: begin/end request lease, read completed hit, commit validated payload, touch/evict, invalidate exact target or owner/project scope, and retire owner. Keep module dependencies cycle-safe: `queries.ts` and `use-sse.ts` may import helper; helper must not import either. Pass captured owner and canonical target explicitly, using `profileQueryKey` and type-only imports.
2. Add compatible SHA-256 dependency only if no existing direct utility is available; lockfile belongs solely to this phase. Memoize fingerprints by weak model/version identity; no secure-context-only implementation.
3. Derive eligible warm data synchronously in hook render/initialization once model exists, then touch recency in effect. `waiting` ALSO renders `Loading blame…` in current gutter; replacing `loading` alone is insufficient. Warm remount must present `ready` without any waiting/loading frame, not hydrate only after a POST/effect. Ensure existing mount/enable effects do not unconditionally overwrite synchronously restored `ready` state with `waiting`.
4. In `runBlame`, reuse valid entry before setting loading/creating request. Cache miss retains exact direct API request shape, timeout, abort and busy/stale taxonomy. Preserve model/tab/liveness/owner/epoch checks before BOTH local publish and cache commit.
5. Content changes immediately clear local data and warm-hit eligibility, increment local edit epoch and preserve 250 ms debounce; old fingerprint cannot render during typing. After debounce, use latest fingerprint; undo to cached identical content in unchanged repository epoch may reuse it. Model changes capture new identity even when model version repeats.
6. Manual `refresh()` advances target epoch and deliberately bypasses client cache once; a successful forced request replaces/reseeds attribution. No implicit retry on busy or stale failure. Toggle-off releases local listeners/requests but leaves bounded successful entry for later toggle-on; reconnect never uses old generation.
7. Extend all existing shared Git mutation helpers (`invalidateGitFileOperation`, `invalidateGitHistoryOperation`, `invalidateGitBranchOperation`, `invalidateGitProjectQueries`) with synchronous blame-scope invalidation before their async reconciliation. Ensure hook sees its own blame invalidation and clears visible data without invalidation recursion. Do not add `git-blame` indiscriminately to mutation-key matching and create self-triggering re-fetch loops.
8. Extend `installTransportBridge` status/worktree/config/workspace branches to revoke relevant cached targets while editors are unmounted. Workspace resets clear root trust. Keep existing project/worktree query behavior otherwise unchanged; owner-scoped events never affect equal-name targets on another generation/profile.
9. Preserve existing focus/visibility root refresh coalescing. Share invalidation epoch with hook's refresh coordinator so status push + mutation invalidation in one operation do not produce duplicate POSTs; recheck trusted root and dirty debounce before dispatch.
10. Author helper tests for key identity, binding, invalidation/late commit, bounds, owner retirement and listener cleanup. Give Phase 03 actual helper signatures so integration tests use public production paths rather than test-only copies.

## Success criteria / test strategy
- Same owner/target/root/HEAD/exact content across fresh models with different versions/UUIDs: immediate ready, correct rebound `modelVersion`, zero extra blame POSTs. Close/reopen requires re-enabling per-tab annotation; no new automatic enable policy.
- Two equal files on different profiles/generations/worktrees/roots never share payload; disconnected/binding mismatch never reveals old attribution.
- Dirty event invalidates synchronously; typing burst makes at most one new request after 250 ms; cancelled response never renders or enters reusable cache.
- Same-HEAD staged rename/index mutation while hook unmounted causes miss on return. Commit/branch/reset/rewrite/HEAD transition and root remap cause fresh attribution; unborn → first commit is not mistaken for unknown → same revision.
- Manual Refresh performs one actual blame call even with a warm client entry; unchanged focus/visibility performs root check but no blame call. Unknown/stale root state is not used as an instant hit.
- Entry/count and conservative weight stay below policy limits after churn, GC/clear/owner retirement release leases/listeners, oversized result remains usable without retention. Different QueryClients are independent.
- Requests remain local-runner single-flight, not cross-hook deduplicated. Concurrent fresh hooks may send separate requests; sequential warm reuse is the acceptance target.
- Main runs cache unit suite plus Phase 03 hook/event/mutation and browser suites; no tests run by this implementer mid-flight.

## Risks, security, handoff
- Render-time read must be side-effect-free; recency updates belong in effect. Immediate eligibility must use current model/epoch, not stale `dataRef` or tab's saved disk content.
- Event-driven freshness cannot prove arbitrary undelivered remote changes. Preserve focus/visibility discovery; no false claim of transactional client HEAD knowledge or offline authoritative results.
- Avoid import cycles through `connections.ts` → `use-sse.ts`; use existing owner invalidation API without calling it during module initialization, and pass dependencies into helper if necessary.
- Cache retains commit author metadata only in session memory, not browser persistence/logs. Excluding full content from keys does not relax owner gating.
- Handoff includes helper API, precise invalidation scopes, dependency version, actual budgets and authored tests. Unresolved questions: none blocking; freshness boundaries deliberately distinguish warm-known from unknown/stale revision.
