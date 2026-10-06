# Phase 03 — Owner-bound client and buffer lifecycle

## Context links

- [Parent](./plan.md); [contracts §§2,5](./contracts.md); [Phase 02](./phase-02-native-blame-and-read-only-git-api.md); [frontend research](./research/frontend-lifecycle-navigation.md).
- [Ownership architecture](../../docs/architecture/workbench-files-editor-and-git.md); [code standards](../../docs/code-standards.md).
- Dependencies: Phase 01 contracts fixed; Phase 02 endpoint required for runtime proof.

## Overview

- Date: 2026-10-05. Priority: P2.
- Implementation status: pending. Review status: pending.
- Deliver typed transport operations, ephemeral tab toggle and latest-buffer-only request lifecycle. No geometry/UI feature claims yet.

## Key Insights

- `createApiClient` and `TransportInvokeOptions.signal/timeoutMs` already provide request seams.
- `resolveTargetOwner` can synthesize generation 1 for absent snapshots; new blame path must require a live captured connected owner, not that fallback.
- `editor.ts` persists a whitelist. Add ephemeral toggle without extending the whitelist or bumping persistence version.
- FS freshness only checks mtime; HEAD-only changes need separate invalidation.
- `status:changed` channel exists client-side but no producer was established by inspected server search. Do not rely exclusively on it or mismatched generic Git invalidation keys.

## Requirements

- Typed methods/DTOs for `git:blame` and `git:commitDetails`; REST map preserves project/worktree/root semantics.
- At most one active request plus latest pending intent per mounted source editor. 250ms debounce; clear old attribution immediately.
- Suppress network while off/inactive/preview-only/hidden/disconnected/unsupported/stale resource binding.
- Reject every late result on owner generation, model/tab identity/version, request epoch or repository refresh mismatch.
- Event-driven root/HEAD refresh on window focus/visibility restoration, source activation, explicit Refresh Annotations and relevant FS/in-app Git signals. No feature-added periodic polling, source cache churn or automatic retry loop.

## Architecture

```text
Tab.blameEnabled (session only)
  + current owner + active source/model
  -> useEditorGitBlame: invalidate -> debounce -> snapshot -> owner-bound request
  -> publish iff identity still current
scoped FS/Git invalidation / window focus / visibility / source activation / manual Refresh
  -> refresh epoch -> same latest-snapshot path
```

Use one hook-local state machine, not a new global cache/store. Root discovery/status shares existing TanStack owner-qualified cache. Source bytes never enter keys/persistent caches.

## Related code files

Modify existing:

- `packages/ui/src/api/client.ts`: DTOs, `ApiClient` signatures and `createApiClient.git` implementation.
- `packages/ui/src/api/ws-transport.ts`: `git:blame` POST and `git:commitDetails` GET maps; preserve auth/abort/error mapping.
- `packages/ui/src/api/queries.ts`: canonical details query and owner-bound root refetch/invalidation integration using existing `useGitRoots`; no polling options or interval.
- `packages/ui/src/stores/editor.ts`: ephemeral toggle action/property; defaults on open/hydration and no storage inclusion.
- `packages/ui/src/hooks/use-sse.ts`: reuse profile-qualified subscriptions, only minimal invalidation bridge changes if needed.
- `packages/ui/src/hooks/use-fs-subscription.ts`, `lib/git-fs-invalidation.ts`: reuse existing scoped event/invalidation seams; no independent watcher.
- `packages/ui/src/api/connections.ts`, `api/ownership.ts`: reuse, do not establish a second ownership convention.

Create proposed:

- `packages/ui/src/hooks/use-editor-git-blame.ts`: requests/epochs/listeners/result state.
- `packages/ui/src/lib/editor-git-blame.ts`: small pure range validation/lookup and model-line normalization helpers only where reusable; avoid generic request-controller framework.
- `packages/ui/src/hooks/use-editor-git-blame.test.tsx`: race/state behavior with controlled deferred promises.
- `packages/ui/src/lib/editor-git-blame.test.ts`: invalid-range and line-boundary consumer behavior.

Extend existing editor/client/query/transport tests only where behavior changes. No tests of source strings/copied DTOs/mock call forwarding.

## Implementation Steps

1. Implement types and client operations from contracts. Forward `TransportInvokeOptions` for new methods; route via owner-bound target projection, not ambient `api`.
2. Map `git:blame` to protected POST with content in JSON body, not query string. Map `git:commitDetails` to exact full-OID/root/worktree GET. Preserve error codes and abort handling.
3. Add session toggle using existing editor state: new optional `Tab.blameEnabled` and `setBlameEnabled(key, enabled)`, default false. Normalize hydration to false even if an unexpected older storage payload supplies the field. Keep persistence schema/version unchanged.
4. Model identity combines current tab key, editor/model ID and positive model version. Listen to model changes/content synchronously; never infer version solely from React effect timing or dirty flag.
5. Capture live owner from connection snapshot; require connected state and resource binding. After every await, check current owner plus tab/model/version/refresh epoch/enabled/source-visible state before publication.
6. Implement state machine: off → waiting/loading → ready/unavailable/error. On any edit immediately clear ready annotation/commit actions, increment epoch, schedule debounce. Snapshot `getValue` only after debounce, not repeatedly copying full buffer on every geometry/event tick.
7. Coalesce edits during pending request into one latest intent. Retire superseded requests locally and use AbortSignal when supported; avoid launching replacements in a tight abort loop. Busy/native timeout is explicit state until new relevant trigger/manual Refresh.
8. Retire on model replacement/tab close/reopen/disabled/source hiding and disconnect. Paused tab toggle remains in editor store; data/result/disposables do not remain attached to remounted wrong model.
9. Observe FS/editor save/reload events, target-scoped Git invalidations and owner-bound `status:changed`/`workspace:changed` events with generation filtering. Coalesce duplicate notifications. Never fix generic legacy invalidation by adding an unqualified blame key.
10. Reuse `useGitRoots` with its existing owner-qualified query key; add only active/source-enabled controls if required, never periodic refetch options. A relevant repository signal, window focus/visibility restoration, source activation or manual Refresh invalidates the epoch, refreshes scoped root discovery without a stale-cache shortcut, then requests current buffer. Compare owning-root identity/full HEAD to retire changed mappings; missing/error roots fail closed. Unchanged HEAD/mtime must not suppress focus/manual refresh. Coalesce the initiating event and its query completion; unrelated cache updates do not trigger blame.
11. Expose a controller refresh action for Phase04's enabled line-number menu, including busy/error state; unavailable source/owner explains why it is disabled. Coalesce window focus/document visibility/source-restoration signals, not every Monaco widget/menu focus event. Document that continuously focused external changes can remain stale until a relevant event or focus/manual refresh; no detection interval, watcher or new server event/revision endpoint.
12. Validate response snapshot echo, range partition/bounds/indexes and owner/path context before drawing. Malformed data produces unavailable/error, not wrong attribution. Refreshes preserve dirty editor content; only annotation state changes.
13. Add deterministic races: old reply after insert/delete, A→B tab switch, close/reopen same key, same-named two profiles, reconnect generations, hidden source, root/HEAD change, busy and limit states. Fake timers only for debounce and no-periodic-work assertions; deferred promises for ordering. With an external HEAD change and unchanged mtime, prove focus and manual refresh each obtain fresh root/buffer attribution; a focused idle interval without relevant events adds no requests. Also prove edit/in-app Git triggers still work and own query completion does not loop.
14. After edits settle, run new hook/helper regressions plus existing editor/transport suites once. Smoke bound client against Phase 02 HTTP endpoint with two registered loopback profiles; observe correct output and stale old generation discarded. This is pre-visual smoke, not full UI qualification.

## Todo list

- [ ] Typed owner-bound REST operations implemented.
- [ ] Session toggle excluded from hydration/storage persistence.
- [ ] Model/owner/request identity and immediate invalidation implemented.
- [ ] Coalesced debounce/request lifecycle with exact cleanup implemented.
- [ ] FS/Git/window-focus/visibility/source/manual refresh integrated without feature-added polling.
- [ ] Deterministic stale-response and isolation regressions pass.
- [ ] Bound-client runtime smoke exercises real API.

## Success Criteria

- Late reply cannot paint authors/link into a newer buffer or different profile/model.
- Off/hidden/inactive/preview/disconnected source produces zero blame requests; no feature-added periodic requests even while active/focused. Leave unrelated preexisting observers unchanged.
- Rapid typing retains one pending latest intent, no per-version query cache or source-byte key.
- Tab toggle survives source remount but resets on reload/close/reopen; localStorage contains no toggle/result/new buffer bytes.
- External root/HEAD changes with unchanged mtime refresh on focus/manual/relevant events; unchanged HEAD still permits explicit refresh. Continuous focus without events has no detection deadline. Dirty bytes remain intact and duplicate restoration/query events yield one coalesced intent.
- File writes/dirty state unchanged by annotation requests.

## Risk Assessment

- React model/props sequencing: synchronous Monaco invalidation guards plus publication identity, not useEffect-only invalidation.
- Reconnect causes valid new-generation request to use stale tab binding: gate resource binding and preserve existing unavailable recovery.
- Cache subscriptions can loop on their own updates: observe relevant invalidation/root-signature changes only; no global invalidate-everything cycle.
- Stale root cache or self-observed refetch can miss a change or loop: force scoped discovery for relevant refresh intents, coalesce query completion, and never turn generic cache activity into periodic blame.

## Security Considerations

- Unsaved content confined to authenticated request body and existing editor memory; no logs/storage/query keys.
- Every subscription uses source owner/generation; no ambient transport cleanup.
- Invalid ranges/hash indices never become links to another commit.

## Next steps

- Phase 04 renderer and Phase 05 workspace navigation can proceed independently once interfaces freeze. Shared `client.ts`/`queries.ts` edits need one integration owner.
- Unresolved questions: none; native line conversion depends on Phase 01 proof.
