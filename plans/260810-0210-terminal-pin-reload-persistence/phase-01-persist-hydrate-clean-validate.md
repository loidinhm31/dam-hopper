# Phase 01 — Persist, Hydrate, Clean, Validate

## Context Links

- Parent: [plan.md](./plan.md)
- Prior pin contract: [prior plan](../260808-1626-terminal-pin-runtime-contrast/plan.md)
- Manager: [use-terminal-manager.ts](../../packages/ui/src/hooks/use-terminal-manager.ts)
- Reconciliation: [terminal-auto-attach.ts](../../packages/ui/src/lib/terminal-auto-attach.ts)
- Close guard: [terminal-tab-state.ts](../../packages/ui/src/lib/terminal-tab-state.ts)
- Current docs: [frontend-components.md](../../docs/frontend-components.md)

## Overview

| Field | Value |
|---|---|
| Date | 2026-08-10 |
| Priority | P2 |
| Implementation status | Completed |
| Review status | Completed |
| Description | Add guarded browser-tab persistence, restore it during live-session reconciliation, clean stale IDs, and verify both terminal surfaces. |

## Preflight Contract

- **Output:** pin and unpin state survives a full reload for the same active terminal session.
- **Acceptance:** both terminal surfaces restore UI/close protection; stale or corrupt storage is harmless and cleaned.
- **Boundary:** client Terminal panel only; no backend, config, cross-device sync, or PTY lifecycle redesign.
- **Affected systems:** manager state, auto-attach reconciliation, pure storage helper, focused tests, current frontend docs.
- **Test gate:** unit + Chromium browser-facing + UI build + manual actual reload.
- **Open questions:** none.

## Key Insights

- `openTabs` starts empty in `useTerminalManager`; current `isPinned` exists only in React state.
- `deriveTerminalAutoAttachState` creates tabs from live `SessionInfo` and already preserves pin metadata on refresh.
- An initial `sessions=[]` is not authoritative while the query loads. Writing/pruning then would destroy valid reload state.
- A full reload in the same tab retains `sessionStorage`; closing the tab ends this persistence boundary.
- Traditional and Runtime UI already consume the same `TabEntry.isPinned`; persistence belongs at manager/reconciliation level, not either component.
- Pin is safety UX, not authorization or a guarantee against process exit, explicit removal, transport loss, or host administration.

## Requirements

### Functional

1. Store only a versioned, deduplicated list of pinned session IDs under a namespaced `sessionStorage` key.
2. On manager creation, defensively read valid IDs without touching terminal/network state.
3. When the terminal-session query has an authoritative successful result, apply stored pins only to matching live sessions during auto-attach.
4. Never let the initial loading/empty render prune or overwrite stored pins.
5. Pin and unpin update storage immediately. Unknown IDs remain no-ops.
6. After authoritative reconciliation, remove IDs for sessions no longer live/pending. An empty set removes the key.
7. Existing close guard remains the enforcement point: restored pin blocks close before kill/UI side effects; restored unpin allows current close behavior.
8. Explicit UI/session removal paths forget the pin ID. Do not broaden which lifecycle actions pin protects.
9. Malformed JSON, wrong version/shape, non-string entries, unavailable storage, and quota/write/remove failures degrade to unpinned in-memory behavior without throwing.
10. Update current frontend docs from manager-mount-only wording to same-browser-tab reload persistence. Do not rewrite completed historical plans/roadmap entries.

### Non-functional

- No backend, protocol, API payload, config, database, dependency, telemetry, or cross-tab listener.
- No persisted labels, commands, output, project names, paths, active tab, or terminal metadata.
- Keep parser/writer pure and storage-injected for deterministic tests.
- Prefer one small helper module and existing manager/auto-attach flow; no new store/context/reducer.

## Architecture

### Chosen data flow

```text
reload -> guarded read(sessionStorage) -> candidate pinned IDs
terminal query success -> auto-attach live tabs + matching pin bits
pin/unpin -> manager state + guarded write-through
session reconciliation/removal -> intersect candidates with live/pending IDs -> rewrite/remove key
restored TabEntry.isPinned -> existing TabBar/Runtime UI + existing close guard
```

### Ordering invariant

Storage cleanup may run only after `useTerminalSessions()` reports success, not merely because `data` defaults to `[]`. A cached successful empty list is authoritative and may clear stale pins. Pending just-launched sessions remain eligible until the existing pending lifecycle resolves.

### Storage contract

- Suggested key: `dam-hopper:terminal-pins:v1`.
- Suggested payload: `{ "version": 1, "sessionIds": ["free:..."] }`.
- Normalize to unique non-empty strings; invalid top-level/version/array means discard key best-effort and return empty.
- Catch reads, parse, writes, and removals independently. Storage failure must never alter terminal API calls or throw from render/effects.

## Related Code Files

### Create

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-pin-persistence.ts` — storage key, schema validation, guarded load/save/prune helpers.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-pin-persistence.test.ts` — valid round-trip, malformed/wrong-version, dedupe, empty cleanup, and throwing-storage coverage.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/terminal-pin-persistence.browser.tsx` — real `sessionStorage` + unmount/remount hydration smoke covering pin and unpin.

### Modify

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-terminal-manager.ts` — query-success gate, restore candidates, write-through toggle, reconciliation/removal cleanup.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-auto-attach.ts` — accept candidate pinned IDs and mark only matching newly attached live tabs; preserve existing explicit tab state.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-auto-attach.test.ts` — live restore, absent/stale exclusion, existing-unpinned precedence, and pending ordering cases.
- `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md` — document key, tab lifetime, cleanup, and UI-only semantics.

### Validate unchanged behavior

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-tab-state.test.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TabBar.test.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx`

### Delete

- None.

## Implementation Steps

1. Add storage module with injectable `Pick<Storage, "getItem" | "setItem" | "removeItem">`; resolve `globalThis.sessionStorage` only inside guarded access.
2. Parse a strict versioned object. Return a `Set<string>`; deduplicate and reject invalid shape. Best-effort remove corrupt payload.
3. Save normalized IDs; remove key for empty state. Swallow access/quota errors and return a success indicator only if useful to tests—UI behavior must not branch on persistence success.
4. Destructure terminal query readiness (`isSuccess` or equivalent) in `useTerminalManager`. Load candidate IDs once per manager mount via lazy ref/state initialization.
5. Extend auto-attach input with candidate pinned IDs. For newly generated live tabs, set `isPinned` from membership. For existing tabs, retain their current boolean so a user unpin cannot be reasserted by a later refresh.
6. In toggle handling, update the candidate/ref set and storage in the same user action as `openTabs`; unknown IDs do nothing. Avoid a generic initial `openTabs=[]` persistence effect.
7. After each authoritative reconciliation, intersect persisted IDs with live sessions plus existing pending IDs, then persist/remove. Ensure absent IDs never create tabs or protect unrelated/reused IDs.
8. Centralize best-effort pin removal in existing UI/session removal helpers. Keep `handleCloseTab` guard order and unpinned kill/removal semantics unchanged.
9. Add pure helper and auto-attach unit cases. Re-run existing Traditional, Runtime, and close-guard tests to prove hydrated `isPinned` still drives both surfaces.
10. Add Chromium browser-facing test using actual `sessionStorage`: persist pin, unmount/remount the fixture as the application reload boundary, confirm Unpin is pressed and Close absent; unpin, remount, confirm Pin and Close return. Do not call `location.reload()` inside the Vitest runner.
11. Manually validate one real full reload against a live terminal session, then stale cleanup after session termination/removal. Update current docs.

## Todo

- [x] Add strict guarded storage adapter and tests.
- [x] Gate hydration/cleanup on authoritative session-query success.
- [x] Restore pins through auto-attach without overriding later unpin.
- [x] Write through toggle and clean all removal/reconciliation paths.
- [x] Add Chromium remount/storage regression.
- [x] Run focused unit, browser, build, and manual reload gates.
- [x] Update current frontend contract.

## Completion Record

- **Completed:** 2026-08-10 02:55 +07:00
- **Validation:** Focused UI Vitest passed — 5 files, 37 tests.
- **Scope check:** Client-only persistence/docs changes; no backend, API, config, database, or PTY lifecycle changes.

## Success Criteria

- Pin a live terminal, fully reload same browser tab: same terminal shows Unpin selected, Close absent, direct manager close remains blocked.
- Unpin, fully reload: terminal shows Pin, Close returns, existing close/kill flow works.
- Dead, removed, unknown, or stale session IDs are not restored and are removed after authoritative reconciliation.
- Loading `sessions=[]` cannot erase a valid persisted pin; successful empty sessions can.
- Malformed/wrong-version/throwing storage produces a usable unpinned terminal UI and no uncaught error.
- Traditional and Runtime tests pass without separate persistence logic.
- No backend/API/config/database diff.

## Validation Commands

```bash
pnpm --filter @dam-hopper/ui exec vitest run \
  src/lib/terminal-pin-persistence.test.ts \
  src/lib/terminal-auto-attach.test.ts \
  src/lib/terminal-tab-state.test.ts \
  src/components/organisms/TabBar.test.ts \
  src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts \
  browser-tests/terminal-pin-persistence.browser.tsx
pnpm --filter @dam-hopper/ui build
```

Manual: create/open live terminal -> pin -> browser reload -> verify same session and close protection -> unpin -> reload -> verify close restored -> terminate/remove session -> confirm storage key absent or excludes its ID.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Initial empty query wipes pins | Reload silently loses state | Gate all reconciliation cleanup on query success; test loading vs successful empty |
| Stored ID outlives PTY | Wrong/stale protection | Intersect with authoritative live/pending IDs and remove empty key |
| Auto-attach reasserts an unpinned value | Unpin fails after refresh | Existing tab state wins; write-through deletes candidate before next derivation |
| Storage unavailable/corrupt/full | Terminal panel crashes | Strict parser + independent try/catch + in-memory fallback |
| Session ID reuse | Old pin applies to new process | Clean promptly; restore only current live IDs. Accept same-ID reuse inside one tab as existing identity contract |
| Explicit removal routes through close guard | Stale pinned UI/storage | Cleanup in removal owner; keep pin protection scoped to close action only |

## Security Considerations

- Session IDs are browser-readable identifiers already present in UI; still store no terminal contents or credentials.
- `sessionStorage` is accessible to same-origin JavaScript. Treat pin as UX state, never a trust boundary.
- Invalid storage is untrusted input: strict schema, no dynamic property execution, no logging of payload.
- No auth, permission, role, CSRF, transport, secret, or server-side authorization changes.

## Side-Effect Review Checklist

- [x] Auth/session/permissions unchanged; browser tab session explicitly documented.
- [x] API/protocol/client compatibility unchanged.
- [x] Database/schema/migrations/config unchanged.
- [x] Close-protection meaning unchanged; only lifetime extended across reload.
- [x] Privacy: IDs-only, tab-scoped, no payload logging.
- [x] Performance: bounded tiny set; writes only on toggle/reconciliation/removal.
- [x] Concurrency: no `storage` listener or cross-tab synchronization.
- [x] Docs updated; no onboarding/deploy/rollback requirement beyond removing the client key/code.

## Next Steps

Hand to `/code` for this single phase. After implementation, inspect diff for any server/config or lifecycle expansion, run commands above, then complete the real reload manual gate.

## Unresolved Questions

- None.
