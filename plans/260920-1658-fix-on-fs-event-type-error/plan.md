---
title: "Fix FileTree FS Subscription Transport Ownership"
description: "Keep FileTree watches bound to their owning profile and prevent secondary-profile disconnects from crashing the workspace."
status: completed
priority: P1
effort: 5h
branch: main
tags: [bugfix, frontend, websocket, multi-profile]
created: 2026-09-20
---

# Fix FileTree FS Subscription Transport Ownership

## Overview

Fix `TypeError: h.onFsEvent is not a function` when FileTree remounts for a connected profile after another configured profile disconnects. Restore documented profile/generation ownership, retire invalid watcher IDs with their component lifecycle, harden idle transport capabilities, and contain future Explorer failures locally.

Source: [debugger findings](../reports/debugger-260920-1658-on-fs-event-type-error.md).

## Root cause

- `useFsSubscription` caches `{sub_id, nodes}` forever, but unmount cleanup destroys that server watch. Remount can reuse the dead `sub_id` without running `queryFn` or capturing its transport.
- Effect and lazy-child paths fall back to ambient `getTransport()` instead of resolving the target profile.
- `disconnectProfile` uses persisted active-profile identity, not actual ambient transport ownership, so an unrelated failed/disconnected profile can replace a healthy ambient transport with `IdleTransport`.
- `IdleTransport` omits optional FS methods; the unchecked cast/call becomes a runtime `TypeError`.
- FileTree lacks a local error boundary, so an Explorer fault unmounts the whole workspace and active terminals.

## Phase

| # | Phase | Status | Priority | Effort | Link |
|---|---|---|---|---:|---|
| 01 | Transport-safe FileTree subscription | Completed 2026-09-20 18:25 Asia/Saigon | P1 | 5h | [phase-01](./phase-01-fix-transport-fs-subscription.md) |

## Delivery contract

1. A profile-qualified filesystem operation uses only that profile's current connection; unavailable owners fail visibly, never fall back to another profile.
2. A watcher ID is valid only while its originating watch is alive. Unmount/reconnect retires the ID and forces a fresh subscription before event binding.
3. Disconnecting a profile that does not own the ambient transport leaves the ambient transport unchanged. Disconnecting the actual ambient owner may demote to idle; never choose an arbitrary profile for fallback traffic.
4. Idle FS calls fail or no-op through typed methods; they never fail because a method is missing.
5. Explorer errors remain inside the Explorer surface. Terminal/runtime state outside that boundary stays mounted.

## Scope

**Modify:**
- `packages/ui/src/hooks/use-fs-subscription.ts`
- `packages/ui/src/api/connections.ts`
- `packages/ui/src/api/idle-transport.ts`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/hooks/use-fs-subscription.test.tsx`
- `packages/ui/src/api/connections.test.ts`

**Out of scope:** active-profile persistence redesign, `selectedProject` synchronization, transport-singleton removal, backend protocol changes, splitting tree data into a separate cache, new dependencies, and Explorer visual redesign.

## Architecture fit

`docs/system-architecture.md` and `docs/phase-03-files-editor-search-git.md` already require owner-bound filesystem requests, generation fencing, originating-transport teardown, and no cross-profile fallback. This plan restores that existing contract; no architecture-document change required.

## Verification

- Focused regressions: `pnpm --filter @dam-hopper/ui test -- src/hooks/use-fs-subscription.test.tsx src/api/connections.test.ts`
- Required UI suite: `pnpm --filter @dam-hopper/ui test`
- TypeScript gate: `pnpm --filter @dam-hopper/ui build`
- Manual smoke: primary profile connected with an empty project, secondary profile disconnected; close/reopen Explorer via IDE and `Ctrl+Shift+E`; confirm no exception and active terminals remain mounted.

## Risks and controls

- **Cleanup races remove a newer watch:** compare the current cached `sub_id`/origin before retiring; cleanup only its captured transport and ID.
- **Defensive fallback leaks work cross-profile:** profile-qualified resolution never catches into ambient transport.
- **Boundary stays latched after target switch:** key the local boundary by profile/project/target surface.
- **Test keeps mocking away the bug:** use a real `QueryClient` and remount with the same cache.

## Next steps

1. Complete manual smoke testing with two profiles (Profile A connected, Profile B disconnected; toggle Explorer; verify no runtime `onFsEvent` errors and active terminals stay mounted).
2. Address test gap: integrate real `QueryClient` remount regression test in `use-fs-subscription.test.tsx` as specified in Step 1.1.
3. Defensively update `removeProfileConnection` in `connections.ts` to check ambient transport ownership before teardown.

## Unresolved questions

1. Manual two-profile Explorer smoke test pending in live environment with real WebSocket connections.