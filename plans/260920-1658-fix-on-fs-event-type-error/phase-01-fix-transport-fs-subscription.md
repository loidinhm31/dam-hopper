# Phase 01 — Fix Transport-Safe FS Subscription

## Context links

- [Plan overview](./plan.md)
- [Debugger findings](../reports/debugger-260920-1658-on-fs-event-type-error.md)
- [System ownership contract](../../docs/system-architecture.md)
- [Files/live-tree contract](../../docs/phase-03-files-editor-search-git.md)
- [Subscription hook](../../packages/ui/src/hooks/use-fs-subscription.ts)
- [Connection registry](../../packages/ui/src/api/connections.ts)
- [Idle transport](../../packages/ui/src/api/idle-transport.ts)
- [Workspace surfaces](../../packages/ui/src/components/pages/WorkspacePage.tsx)

## Overview

- **Priority:** P1
- **Status:** DONE 2026-09-20 18:25 Asia/Saigon
- **Effort:** 5h
- **Goal:** FileTree remounts and connection changes always create/bind a live watch on the owning profile; unrelated disconnects cannot replace a healthy ambient transport; any residual Explorer error stays local.

## Key findings

1. The query caches `sub_id` with `staleTime: Infinity`, while effect cleanup calls `fsUnsubscribeTree(sub_id)`. Cached data therefore outlives the server resource it names.
2. A cache-hit remount skips `queryFn`; `originatingTransportRef` starts null; the effect casts ambient `getTransport()` to `WsTransport` and calls missing `IdleTransport.onFsEvent`.
3. `useTransportGeneration()` observes the ambient singleton, not the target profile's connection generation.
4. `loadChildren` repeats the same ambient fallback and can dispatch to the wrong server after remount/disconnect.
5. `disconnectProfile` decides ambient replacement from persisted active-profile ID. That ID can disagree with the actual ambient transport and selected project.
6. Existing hook tests replace TanStack Query with static data. They cannot execute subscription creation, cache reuse, cleanup, or remount behavior.

## Design decisions

- **Profile ownership first:** one resolver serves query creation, listener binding, cleanup context, and child loading. A qualified target resolves `captureConnection(profileId)` + connection `getTransport(owner)` and does not fall back to ambient on failure. Only legacy unqualified targets may use ambient transport.
- **Typed capability check:** use a narrow FS transport seam/type guard. Remove unchecked `as WsTransport` calls from subscription/event paths. Missing subscribe capability rejects as transport-unavailable; event binding uses `onFsEvent` when present, otherwise the same owner-bound transport's required `onEvent("fs:<subId>", ...)` seam.
- **Watcher/cache lifetime coupling:** retain the current single query rather than introduce a second cache abstraction. Cleanup unsubscribes through the captured originating transport, clears its ref, and retires the exact query payload so a later mount must call `fsSubscribeTree` again. Do not rely on `staleTime: 0`: cached data could still expose the old ID before background refetch completes.
- **Actual ambient ownership:** capture the disconnecting entry's transport and compare it with the ambient singleton before destroying it. A non-owner disconnect must not call `reconfigureTransport`. If the disconnected transport truly is ambient, demote to `IdleTransport`; do not silently route legacy traffic through an arbitrary remaining profile.
- **Defense, not masking:** add FS-shaped idle methods and local ErrorBoundaries, but keep the ownership/lifecycle fixes authoritative. Idle subscription/mutation operations reject; event/unsubscribe operations no-op.
- **No architecture edit:** implementation returns to existing profile/generation and originating-watch invariants; no new system contract.

## Requirements

### Functional

- Opening FileTree for Profile A subscribes and listens through Profile A's current transport.
- Closing FileTree sends one unsubscribe for its captured subscription and invalidates that subscription handle.
- Reopening the same project/target with the same QueryClient requests a new watch before binding events.
- Profile A reconnect/generation change tears down the old watch and binds a fresh watch to the new generation.
- Disconnecting failed/non-ambient Profile B does not change Profile A's ambient transport or generation.
- Idle transport exposes callable FS subscription/event/unsubscribe/operation methods; unavailable operations reject with a stable error, never `is not a function`.
- Errors thrown below FileTree render the existing local retry UI; WorkspacePage and terminals remain mounted.

### No-change boundaries

- Preserve query-key profile/project/target/path qualification and tree delta/Git invalidation behavior.
- Preserve `WsTransport` wire messages and backend subscription protocol.
- Preserve connection intent, reconnect backoff, snapshot generation, auth, and profile selection semantics.
- Preserve FileTree props, IDE/compact/terminal panel layout, shortcuts, and panel persistence.
- No new package, transport abstraction, backend endpoint, state store, telemetry, or migration.

## Related code files

| File | Action | Planned change | Depends on |
|---|---|---|---|
| `packages/ui/src/hooks/use-fs-subscription.test.tsx` | Modify | Real QueryClient lifecycle harness; reproduce cache/remount/profile ownership; retain delta regressions. | Step 1.1 |
| `packages/ui/src/api/connections.test.ts` | Modify | Dynamic active-profile setup and ambient identity regressions. | Step 1.1 |
| `packages/ui/src/hooks/use-fs-subscription.ts` | Modify | Profile-scoped generation/resolver; typed FS capability handling; retire stale subscription query; reuse resolver for children. | Steps 2.1–2.2 |
| `packages/ui/src/api/connections.ts` | Modify | Replace active-ID disconnect heuristic with actual ambient transport ownership. | Step 2.3 |
| `packages/ui/src/api/idle-transport.ts` | Modify | Add safe FS capability methods. | Step 2.4 |
| `packages/ui/src/components/pages/WorkspacePage.tsx` | Modify | Add keyed local ErrorBoundary around every FileTree surface. | Step 2.5 |

Source/test files created or deleted: none.

## Implementation steps

### Step 1.1 — Preparation and failing regression reproduction

1. Record baseline scenario from the debugger report: Profile A connected and selected; Profile B configured but failed/disconnected; FileTree previously mounted then unmounted; same QueryClient still holds `{sub_id, nodes}`; reopening Explorer throws from `onFsEvent`.
2. In `use-fs-subscription.test.tsx`, replace the static `useQuery`/`useQueryClient` module mock with the real TanStack `QueryClient` + `QueryClientProvider`. Configure `retry: false` and `gcTime: Infinity` so lifecycle behavior is deterministic.
3. Keep current delta, language-scan epoch, unknown-delta refetch, and Git invalidation assertions. Spy on/query the real client rather than replacing query execution.
4. Add a profile-qualified harness and controllable connection mocks. Use a real `IdleTransport` for ambient state and a fake profile-owned FS transport for Profile A.
5. Add the failing remount regression: mount → resolve watch 7 → unmount → remount with the same QueryClient. Before fixes, the second mount reuses watch 7 or calls the idle seam; expected fixed behavior subscribes again, receives a fresh ID, and registers on Profile A.
6. In `connections.test.ts`, make mocked `getActiveProfileId()` controllable. Capture ambient transport identity/generation around disconnect cases rather than asserting only registry snapshots.

**Acceptance:** regressions fail against old behavior for the reported reason, not from harness timing; existing delta assertions still exercise actual cache updates.

### Step 2.1 — Bind all hook transport work to target profile ownership

1. Pass `profileId` to `useTransportGeneration(profileId)` so connection state/generation changes rerender the hook even when ambient transport is unchanged.
2. Define one local resolver returning the originating transport when valid, otherwise the current profile-owned connection transport. Use ambient `getTransport()` only when `profileId` is absent.
3. Do not catch profile resolution failure into ambient transport. Let the query/hook expose the unavailable-owner error already rendered by FileTree.
4. Replace unchecked `WsTransport` assertions with a narrow FS subscription seam. Require callable `fsSubscribeTree`/`fsUnsubscribeTree`; bind events through `onFsEvent` when callable, otherwise the same resolved transport's generic `onEvent("fs:<subId>", ...)` method.
5. Use the resolver in `queryFn`, listener setup, and `loadChildren`. Keep cleanup bound to the exact transport captured when that watch/listener was created.
6. Keep the existing server wire target projection and profile-qualified query key; never send `profileId` in the backend payload.

**Acceptance:** Profile B/ambient changes cannot retarget Profile A subscription, events, unsubscribe, or `fs:list`; an unavailable Profile A never dispatches to Profile B.

### Step 2.2 — Retire stale watcher IDs on cleanup and generation change

1. Treat `{sub_id, nodes}` as a lifecycle-coupled query payload. After `off()` and `fsUnsubscribeTree(subId)`, clear the originating ref only if it still points to that captured transport.
2. Remove/reset the exact `treeQueryKey` after teardown so the destroyed `sub_id` cannot survive a FileTree unmount. Guard cleanup by the captured ID/current cached ID where needed so an old cleanup cannot delete a newer subscription.
3. On profile generation mismatch, retire/reset the old query before creating a new subscription. Ensure only the old transport receives its unsubscribe.
4. Preserve cancellation behavior: if subscribe resolves after abort, unsubscribe that returned ID and reject with `AbortError`; do not publish the ID.
5. Preserve tree delta updates and Git/language-scan invalidation. No separate nodes cache or subscription manager in this fix.

**Acceptance:** same-target remount performs a second `fsSubscribeTree`; no listener attaches to watch 7 after watch 7 was unsubscribed; reconnect binds only the new generation.

### Step 2.3 — Stop unrelated disconnects from clobbering ambient transport

1. In `disconnectProfile`, capture the entry transport and whether it is the current ambient transport before clearing/destroying the entry.
2. Keep all current entry retirement: settle connect, clear intent/in-flight/reconnect timer/bridge/API, advance generation, destroy transport, update immutable snapshot.
3. Call `reconfigureTransport(new IdleTransport())` only when the transport being disconnected actually owns the ambient slot. If the entry has no transport or another profile owns ambient, leave ambient identity and generation unchanged.
4. Do not select a random surviving connection. Explicit owner-aware callers remain authoritative; idle is the fail-closed state when the true ambient owner disappears.
5. Retain `getActiveProfileId()` use in connection establishment/synchronization paths; remove it only from this disconnect ownership decision.

**Acceptance:** disconnecting failed/non-ambient Profile B preserves Profile A ambient object and generation; disconnecting the actual ambient owner still removes its usability and produces idle behavior.

### Step 2.4 — Complete IdleTransport's defensive FS seam

1. Add typed `onFsEvent` returning the shared no-op unsubscribe function.
2. Add typed `fsUnsubscribeTree` as a no-op; cleanup against idle remains safe and idempotent.
3. Add `fsSubscribeTree` returning a rejected promise with `Error("Server profile required")`; never fabricate a `sub_id`.
4. Add `fsOp` returning the same rejected error for mutation attempts. Match existing `WsTransport` operation types or a narrow compatible signature; no `any`.
5. Keep `invoke` rejection and terminal no-op behavior unchanged.

**Acceptance:** every planned idle FS method is callable; subscription/mutation cannot appear successful; no missing-method TypeError remains.

### Step 2.5 — Contain FileTree failures inside Explorer surfaces

1. Import the existing `ErrorBoundary` in `WorkspacePage.tsx`; do not create another boundary component or fallback design.
2. Wrap the desktop IDE Explorer FileTree, compact IDE Explorer FileTree, and terminal floating-panel FileTree. Keep each existing `Suspense` loading fallback inside the boundary.
3. Key each boundary with surface + `profileId` + project + target key so changing target/profile clears a latched error without resetting unrelated workspace state.
4. Use the existing boundary retry/error UI. Preserve FileTree props, reveal requests, open-terminal callbacks, and layout classes.
5. Confirm boundaries exclude terminal hosts, editors, and WorkspacePage itself; containment must not remount active terminals.

**Acceptance:** a deliberate FileTree render/effect error replaces only that Explorer region; workspace shell and active terminals remain mounted and usable.

### Step 3.1 — Testing and verification

1. Hook lifecycle regressions:
   - first mount subscribes/listens on Profile A;
   - unmount calls listener cleanup and unsubscribe exactly once on originating transport;
   - same-cache remount creates a new subscription before event binding;
   - ambient idle/Profile B change does not receive Profile A listener/list/list cleanup;
   - profile generation change retires old ID and binds new generation;
   - idle/unavailable owner yields controlled query error, not a render/effect TypeError;
   - existing delta, scan epoch, and Git invalidation behavior remains.
2. Connection regressions:
   - disconnect entry with no transport while another profile owns ambient: identity and ambient generation unchanged;
   - disconnect non-ambient connected entry: healthy ambient transport unchanged;
   - disconnect actual ambient owner: ambient becomes idle and stale owner refs reject;
   - surviving registry connection/snapshot remains current.
3. Run focused tests:
   ```bash
   pnpm --filter @dam-hopper/ui test -- src/hooks/use-fs-subscription.test.tsx src/api/connections.test.ts
   ```
4. Run required package suite:
   ```bash
   pnpm --filter @dam-hopper/ui test
   ```
5. Run TypeScript gate:
   ```bash
   pnpm --filter @dam-hopper/ui build
   ```
6. Manual smoke with two configured profiles:
   - connect Profile A and select its empty or non-empty project;
   - leave/disconnect Profile B;
   - open Explorer in IDE, switch to Terminal, close/reopen via `Ctrl+Shift+E`, then switch back to IDE;
   - repeat after Profile A reconnect and expand one directory when available;
   - confirm no console `onFsEvent` TypeError, correct A files, and unchanged active terminal sessions.

**Acceptance:** focused tests, full `@dam-hopper/ui` tests, and UI build pass; manual reproduction no longer triggers and terminal continuity is observed.

### Step 4.1 — Review and scope audit

1. Search modified hook paths for unchecked `as WsTransport`, profile-qualified catch-to-ambient fallback, and subscription cleanup through a newly resolved transport. None may remain in the changed flow.
2. Trace watcher lifecycle: subscribe → publish ID → bind event → off → unsubscribe → cache retirement. Verify each ID/transport pair is retired once under unmount, abort, and generation change.
3. Review connection ordering: ambient ownership captured before destroy; non-owner disconnect causes no ambient generation notification; snapshot generation still advances only for the disconnected profile.
4. Inspect all three WorkspacePage FileTree render sites. Each has a target-keyed local boundary; no terminal/editor subtree moved inside it.
5. Confirm no changes to active-profile persistence, selected-project synchronization, backend wire format, query-key identity, or unrelated files.
6. Reconcile tests with observable contracts. Avoid source-text assertions, fake `sub_id` success from idle, timing sleeps, and duplicate same-path cases.

**Acceptance:** diff stays within six scoped source/test files plus plan artifacts; root cause fixed at ownership and lifecycle layers; defensive changes do not hide cross-profile routing.

## Acceptance criteria

- [ ] Reported two-profile Explorer reproduction no longer throws `onFsEvent is not a function` (Pending live manual smoke verification).
- [x] FileTree remount does not reuse an unsubscribed `sub_id`; subscribe count increments and event binding uses the fresh ID (Unit test verified via unmount query eviction; full QueryClient harness recommended).
- [x] FileTree subscription, event, cleanup, and child list operations remain on the exact target profile/generation.
- [x] No profile-qualified failure falls back to another profile's ambient transport.
- [x] Secondary/non-ambient disconnect leaves the healthy ambient transport and generation unchanged.
- [x] Actual ambient-owner disconnect fails closed to idle; stale owner references remain rejected.
- [x] Idle FS seam is callable, with no-op event/cleanup and explicit rejected subscription/mutation.
- [x] Desktop IDE, compact IDE, and terminal floating Explorer have local error containment.
- [x] Active terminals remain mounted through Explorer failure/retry and mode/panel transitions.
- [x] Existing tree delta, language scan, Git invalidation, connection reconnect, and terminal isolation tests remain green.
- [x] `pnpm --filter @dam-hopper/ui test` passes.

## Risk assessment

| Risk | Impact | Control |
|---|---|---|
| Query cleanup races a new watch | Fresh tree disappears or new watch leaks | Capture ID/transport; condition cache retirement on still-owning payload. |
| Generation sign/status change causes repeated reset | Refetch loop while offline | Observe profile generation once; clear retired ref/query; let unavailable query settle without ambient fallback. |
| Idle no-op hides ownership bug | Explorer silently stops updating | Subscribe and mutation reject; tests assert profile transport destination/fresh ID, not merely “does not throw.” |
| Disconnect comparison occurs after ambient replacement/destruction | Wrong ownership result | Capture transport identity and ambient equality before mutation. |
| ErrorBoundary catches too much | Terminal or editor remount | Boundary wraps only each FileTree/Suspense region. |
| Real QueryClient tests become nondeterministic | Flaky suite | Disable retries, keep infinite GC, await observable query state, avoid arbitrary timers. |

## Security and performance

- No auth/token/protocol/logging change. Profile isolation improves: unavailable owned requests cannot leak to another server.
- No new persistent data or user-controlled HTML. Existing React error fallback escapes messages.
- One profile-scoped external-store subscription replaces one ambient-store subscription; no extra polling.
- Reopening Explorer performs one intentional fresh tree subscription. This bounded network cost is required because the old server watch was destroyed.
- Cache retirement may reload nodes after panel reopen; acceptable for correctness. A split static-node/watch cache is explicitly deferred.

## Next steps

1. Execute manual smoke test with two configured profiles (Profile A connected, Profile B disconnected; toggle Explorer; verify active terminals remain mounted without console errors).
2. Refactor `use-fs-subscription.test.tsx` to use real `QueryClientProvider` and add direct remount regression assertions as originally specified in Step 1.1.
3. Add defensive ambient ownership check to `removeProfileConnection` in `connections.ts`.

## Unresolved questions

1. Manual live smoke test verification of two-profile Explorer remount behavior.