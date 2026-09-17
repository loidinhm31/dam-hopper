# Phase 04 — Terminal continuity, workflow, and owner-directed navigation

**Status:** DONE — 2026-09-17  
**Scope:** Unified Multi-Profile Workbench terminal state, workflow links, notifications, and diagnostics.  
**Evidence:** 42/42 scoped UI tests and a clean UI build are recorded in the Phase 04 plan and [Cycle 3 review](../plans/reports/code-review-260917-1321-phase-04-terminals-and-workflow.md).

This document is the implementation reference for Phase 04. It covers the frontend ownership boundary; server terminal IDs, PTY lifecycle, workflow SQLite history, and configured project/worktree validation remain server-authoritative. No new backend terminal protocol, workspace identifier, or workflow database is introduced.

## 1. Identity and ownership

### 1.1 Durable terminal identity

`packages/ui/src/api/ownership.ts` defines the canonical frontend identity types:

```ts
interface TerminalRef {
  profileId: string;
  id: string;             // server-local terminal/session ID
}

interface TerminalInstanceRef extends TerminalRef {
  incarnation: number;   // concrete PTY process/run
}
```

`TerminalRef` is the durable resource key. Its canonical map/cache encoding is:

```ts
JSON.stringify([profileId, id])
```

`terminalInstanceKey()` appends `incarnation` for lifecycle evidence:
`JSON.stringify([profileId, id, incarnation])`. A connection generation is not part of either durable key. `ConnectionRef { profileId, generation }` fences in-flight work and query state; a reconnect changes generation, not terminal identity.

The tuple encoding is deliberate: delimiter-concatenated strings can collide when profile or session IDs contain the delimiter. `toTerminalKey()` and `parseTerminalKey()` are the only conversion helpers used by the Phase 04 state modules. Raw string inputs remain accepted at compatibility edges, but profile-aware callers pass `TerminalRef`.

### 1.2 Registry and xterm lifetime

`terminal-registry.ts` is an imperative registry, not React state. The canonical entry key is `terminalKey(terminalRef)`. A `TerminalEntry` stores xterm, fit addon, find controller, attachment element, and optional `terminalRef`.

The registry currently keeps a raw-ID alias when it is free and provides a linear `terminalRef.id` fallback for legacy callers. Deletion checks the entry identity before deleting a raw alias; unmounting profile B therefore cannot remove profile A's alias when both servers expose the same ID. New code should use `getTerminal()`, `hasTerminal()`, and `removeTerminal()` rather than reading the exported `Map` directly.

`TerminalKeepAliveHost` renders one hidden, moveable `TerminalPanel` per `TerminalRef`. `PaneContainer`, runtime output, scroll/zoom controls, and terminal tab surfaces reparent or reveal that existing xterm; they do not create a second xterm when the user changes IDE/Terminal mode, traditional/Fleet view, Settings, floating panes, or compact surfaces. Unmounting a display disposes browser resources and detaches listeners. It does **not** kill or remove the remote PTY. Kill and durable remove remain explicit owner-bound actions.

### 1.3 Incarnation and stale-event fences

Public terminal IDs can be reused. `terminal-incarnation-state.ts` therefore keeps the greatest observed incarnation per qualified `TerminalRef` and rejects a push, target-loss, port, exit, buffer, or disposer event with an older incarnation. Port observations use `(TerminalRef, port, incarnation)`; a fresh authoritative port list can clear a retired port marker.

`TerminalPanel` derives an effective `TerminalRef` from its explicit ref or `{ profileId, safeSessionId }`. It uses the same qualified key for registry registration, output activity, latest-incarnation checks, terminal lifecycle callbacks, and transport-generation rebinding. An old incarnation may not erase a replacement incarnation, another profile's state, a pinned tab, or a mounted session.

`terminal-output-activity.ts` stores `streamReady` and a three-second `recentOutput` window by qualified terminal key. Registration has an owner token so a stale panel cannot mark or clear a replacement panel's activity. Activity state is content-free; it is not command history or diagnostics evidence.

## 2. Owner-bound transport and API routing

The profile owner is captured before terminal work crosses an async boundary:

1. `useTerminalManager({ profileId })` passes the selected profile to `useTerminalTree()` and `useTerminalSessions()`.
2. Terminal-session queries use `profileQueryKey(owner, "terminal-sessions")`; the list response records each returned incarnation under the same profile.
3. Launch, rename, close/remove, kill, config update, and query invalidation resolve the target profile's `ConnectionSnapshot`, then call `getApi(snapshot.owner)` or the corresponding bound transport. Input, attach, replay, resize, and history insertion use the transport captured by the panel, not whichever profile is focused later.
4. `createApiClient(owner, transport)` keeps the existing method groups but binds them to one owner and transport. Qualified project targets are checked against `owner.profileId` before projecting to the server wire shape; `profileId` is never spread into server project payloads. Server-local terminal IDs remain payload values on the already-bound client.
5. `WsTransport` retains endpoint, profile, auth token, and generation for its lifetime. REST and WebSocket callbacks are discarded or aborted when that generation is retired. A profile reconnect rebinds subscriptions and reads; it never replays terminal input, resize, create, kill, remove, or rename.

The source still exposes an ambient compatibility `api` for unqualified callers and uses it when no profile/connection snapshot is available. That path is not a safe substitute for a profile-aware operation. New terminal surfaces must supply `profileId`/`TerminalRef`; an unavailable owner should leave input disabled or report owner unavailability rather than dispatch to another profile.

A focus change A → B → A is navigation only. It does not reconnect, create, kill, remove, or migrate a terminal. Disconnect/logout/profile removal locally retires the generation and detaches the UI; it does not delete remote PTYs. The active profile may change while a background profile's xterm continues receiving its owner-bound output.

## 3. Browser-local continuity schemas

### 3.1 `terminal-layout:v3`

Traditional terminal groups derive their storage key in `traditional-terminal-projects.ts`:

```text
dam-hopper:terminal-layout:v3:<encodeURIComponent(JSON.stringify([profileId, groupId]))>
```

The unqualified compatibility form encodes only `groupId`; owner-aware surfaces always include `profileId`. Generation is intentionally absent so reconnect does not fork a layout.

The value is a `PersistedLayout` with payload version `2`:

```ts
{
  version: 2,
  root: LayoutNode
}
```

`root` is a recursive binary tree. A split has a stable node ID, direction, two percentage sizes, and two children. A pane has a stable pane ID, `sessionIds`, and an `activeSessionId`; pane IDs are not terminal IDs. `useTerminalLayout()` reloads when the actual storage key changes, rejects malformed data, and starts a default pane. Docking, tab reorder, split/close, focus, resize, and dead-session pruning persist atomically from the hook's state transition. Layout persistence does not control PTY lifecycle.

The fresh-state reset removes old `dam-hopper:terminal-layout:*` records unless the key is already in the `v3` family. It never archives, attributes, or restores an old unqualified layout and never performs a remote terminal mutation.

### 3.2 `terminal-pins:v2`

Pins are tab-session UI state in `sessionStorage`, partitioned by profile:

```text
dam-hopper:terminal-pins:v2:<encodeURIComponent(profileId)>
```

The unqualified `dam-hopper:terminal-pins:v2` key remains a compatibility/default form. The payload is IDs-only:

```ts
{ version: 2, sessionIds: string[] }
```

`useTerminalManager()` loads and saves the selected profile's partition. IDs are de-duplicated, empty IDs are discarded, and stale IDs are pruned against live or pending sessions. Invalid storage is ignored. The legacy `dam-hopper:terminal-pins:v1` key is removed; no old pin is assigned to a profile. Pins never reach the server and do not keep a remote PTY alive.

### 3.3 Command history v3

`command-history.ts` stores verified command history under `dam-hopper:command-history`:

```ts
{
  version: 3,
  entries: [{
    id, command, searchText, lastUsedAt, useCount,
    project?, projectUsage, profileId?
  }]
}
```

`command` is the exact text received from a current-generation, server-validated shell lifecycle submission. `searchText` and Unicode token fields are derived search-only data; they never reconstruct or transmit the command. Stable IDs are salted with `profileId`, and recording merges only an identical command in the same profile. Per-project usage remains a map inside that profile-owned entry, not a set of copied commands.

Search accepts an optional profile and ranks exact raw prefixes above normalized token matches, then recency/use count. The enablement preference remains a separate global UI preference. Storage failures and disabled history fail closed. A non-v3 or malformed record is discarded by the loader; fresh-state reset removes invalid/legacy history but preserves valid v3 data. Command history is not included in diagnostics exports.

## 4. Workflow links and owner-directed navigation

Workflow server history remains in the existing per-server/configuration SQLite store. The shared UI does not merge workflow histories or invent backend workspace IDs for frontend profiles.

`workflow-queries.ts` resolves an explicit `ConnectionRef` from `owner` or `profileId`. Owner-aware keys are built from the profile and connection generation:

```text
['profile', profileId, generation, 'workflow', ...]
```

Overview/events queries, mutation variables, request UUIDs, CAS `updatedAt`, replay handling, and success-only invalidation retain the originating owner. A workflow `404` is classified as that profile's workflow feature being unavailable, not as app-wide empty history. Workflow data remains React Query memory state; drafts, selection, filters, and elapsed clocks remain component-local.

Workflow terminal links carry a server-local `externalId` plus optional `incarnation`. `workflow-workspace-integration.ts` derives candidates only from authoritative session/mounted state and intentionally excludes command text, CWD, and output. Reveal is fail-closed when:

- the link has no usable session ID;
- the active/current profile does not match;
- the session is not present in the authoritative map or mounted list; or
- an expected incarnation differs from the actual session incarnation.

Target selection separately rejects an unknown project or unavailable worktree. A rejected/orphan link never redirects to profile B merely because B exposes the same server-local ID. A compact workspace may request the Terminal surface only after these owner and incarnation checks pass.

## 5. Notifications and diagnostics

Terminal notification events carry `profileId` and, when available, a `TerminalRef`. Notification metadata is safe display data and opaque IDs; it must not contain bearer credentials, endpoint credentials, CWD, environment, or command text. `terminal-notification-navigation.ts` validates that the target is mounted/alive or registered before revealing the terminal, then focuses the existing surface and xterm. Closed sessions are ignored. The helper retains raw-ID compatibility for older event producers; profile-aware producers should dispatch the qualified ref.

Frontend diagnostics are redacted at record time by `diagnostics-client.ts` and retained only locally (default: 60 minutes, 1,000 entries, 512 KiB). `diagnostics-export.ts` supports an explicit `profileId`, frontend scope list, and terminal ID list. It filters the selected time window and scope, excludes entries whose metadata names another profile, and preserves global browser/route errors as global evidence. The export request carries `terminalIds`, `includeTerminalOutput`, and a bounded `terminalTailBytes` (workspace terminal export defaults to 65,536 bytes). Backend redaction remains authoritative.

An owner-directed export therefore follows this order:

1. Select the profile/owner that originated the diagnostic surface.
2. Filter frontend logs with that profile and feature scope.
3. Send the request through that profile's bound diagnostics API/transport and restrict backend terminal tails to explicit IDs.
4. Download a profile-labelled file when `profileId` is supplied.

There is no implicit merged multi-profile bundle. A deliberate multi-profile export must issue one labelled request per owner and surface partial failures. Command history is never exported. Existing review-before-sharing guidance still applies because opted-in terminal tails can contain local development output.

The compatibility `useExportDiagnostics()` hook still delegates through the
ambient `api` for unqualified callers. An owner-aware surface must supply the
bound exporter and `profileId` to preserve this scope; the filtering and
terminal-ID limits remain enforced by `diagnostics-export.ts`.

## 6. Fresh-state and lifecycle boundaries

`performFreshStateReset()` is an allowlisted, idempotent browser-resource reset. It removes old unqualified project/editor/tree/search/terminal layout/pin/history/browser-history records and quarantine backups while preserving profiles, endpoint-bound auth-v2 records, native state, presentation preferences, and server data. It does not call `localStorage.clear()` and performs no terminal create/kill/remove. New qualified layout, pin, and history schemas survive subsequent reset runs.

A terminal display may be hidden, reparented, or disposed while its remote session remains alive. Reconnect re-queries authoritative sessions and reattaches only a matching owner and incarnation; a missing session is not recreated solely because a layout still mentions its ID. Worktree disappearance leaves an unavailable/orphaned terminal visible with buffered output and disabled input rather than silently changing its target.

## 7. Source map and status

| Concern | Implementation boundary |
| --- | --- |
| Canonical refs and tuple keys | `packages/ui/src/api/ownership.ts` |
| Owner-bound API/queries | `packages/ui/src/api/client.ts`, `connections.ts`, `queries.ts`, `workflow-queries.ts` |
| Qualified xterm registry | `packages/ui/src/lib/terminal-registry.ts`, `TerminalKeepAliveHost.tsx` |
| Incarnation/activity fencing | `terminal-incarnation-state.ts`, `terminal-output-activity.ts`, `TerminalPanel.tsx` |
| Tabs, mounted sessions, and pruning | `use-terminal-manager.ts`, `terminal-mounted-sessions.ts`, `terminal-auto-attach.ts`, `use-terminal-tree.ts` |
| Layout and pins | `terminal-layout-tree.ts`, `use-terminal-layout.ts`, `traditional-terminal-projects.ts`, `terminal-pin-persistence.ts` |
| History and suggestions | `command-history.ts`, `TerminalPanel.tsx` |
| Workflow reveal/target checks | `workflow-workspace-integration.ts`, `workflow-queries.ts` |
| Notification selection | `terminal-notification-navigation.ts`, `terminal-notifications.ts` |
| Diagnostic capture/export | `diagnostics-client.ts`, `diagnostics-export.ts`, `WorkspacePage.tsx` |
| Fresh reset | `fresh-state-reset.ts` |
| Focused contract proof | `terminal-continuity-unified-profile.test.ts` |

The Phase 04 focused test file proves colliding profile IDs, qualified registry/activity/incarnation behavior, profile-scoped history, workflow/notification navigation, and owner-filtered diagnostics. The latest review reports 42/42 scoped tests and a clean TypeScript build. Review warnings remain around split-pane activity prop forwarding, late qualified notification registration, and whether the raw registry export should be deprecated; these are follow-up hardening items, not new ownership contracts.

## Unresolved questions

1. Should a notification click for a background profile automatically switch the visible profile, or show an explicit cross-profile prompt/badge before reveal?
2. Should `terminalRegistry` stop exporting its mutable `Map` and expose only helper methods?
