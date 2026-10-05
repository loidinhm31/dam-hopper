# Terminal Continuity, Workflow, and Owner-Directed Navigation Architecture

**Authority:** Workbench Terminal Subsystem (`packages/ui/src/`, `server/src/pty/`, `server/src/workflow/`)  
**Status:** Maintained Architecture Specification  

This specification defines the frontend ownership boundary, terminal continuity, and workflow navigation across the multi-profile workbench. Server terminal IDs, PTY lifecycle, workflow SQLite persistence, and configured project/worktree validation remain server-authoritative.

## 1. Identity and Ownership

### 1.1 Durable Terminal Identity

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

`terminalInstanceKey()` appends `incarnation` for lifecycle evidence: `JSON.stringify([profileId, id, incarnation])`. A connection generation is not part of either durable key. `ConnectionRef { profileId, generation }` fences in-flight work and query state; a reconnect changes generation, not terminal identity.

The tuple encoding is deliberate: delimiter-concatenated strings can collide when profile or session IDs contain the delimiter. `toTerminalKey()` and `parseTerminalKey()` are the conversion helpers used across state modules.

### 1.2 Registry and xterm Lifetime

`terminal-registry.ts` is an imperative registry, not React state. The canonical entry key is `terminalKey(terminalRef)`. A `TerminalEntry` stores xterm, fit addon, find controller, attachment element, and optional `terminalRef`.

`TerminalKeepAliveHost` renders one hidden, moveable `TerminalPanel` per `TerminalRef`. `PaneContainer`, runtime output, scroll/zoom controls, and terminal tab surfaces reparent or reveal that existing xterm; they do not create a second xterm when the user changes IDE/Terminal mode, traditional/Fleet view, Settings, floating panes, or compact surfaces. Unmounting a display disposes browser resources and detaches listeners. It does **not** kill or remove the remote PTY. Kill and durable remove remain explicit owner-bound actions.

### 1.3 Incarnation and Stale-Event Fences

Public terminal IDs can be reused. `terminal-incarnation-state.ts` keeps the greatest observed incarnation per qualified `TerminalRef` and rejects a push, target-loss, port, exit, buffer, or disposer event with an older incarnation. Port observations use `(TerminalRef, port, incarnation)`; a fresh authoritative port list can clear a retired port marker.

`TerminalPanel` derives an effective `TerminalRef` from its explicit ref or `{ profileId, safeSessionId }`. It uses the same qualified key for registry registration, output activity, latest-incarnation checks, terminal lifecycle callbacks, and transport-generation rebinding. An old incarnation may not erase a replacement incarnation, another profile's state, a pinned tab, or a mounted session.

`terminal-output-activity.ts` stores `streamReady` and a three-second `recentOutput` window by qualified terminal key. Registration has an owner token so a stale panel cannot mark or clear a replacement panel's activity. Activity state is content-free; it is not command history or diagnostics evidence.

## 2. Owner-Bound Transport and API Routing

The profile owner is captured before terminal work crosses an async boundary:

1. `useTerminalManager({ profileId })` passes the selected profile to `useTerminalTree()` and `useTerminalSessions()`.
2. Terminal-session queries use `profileQueryKey(owner, "terminal-sessions")`; the list response records each returned incarnation under the same profile.
3. Launch, rename, close/remove, kill, config update, and query invalidation resolve the target profile's `ConnectionSnapshot`, then call `getApi(snapshot.owner)` or the corresponding bound transport. Input, attach, replay, resize, and history insertion use the transport captured by the panel, not whichever profile is focused later.
4. `createApiClient(owner, transport)` keeps the existing method groups but binds them to one owner and transport. Qualified project targets are checked against `owner.profileId` before projecting to the server wire shape; `profileId` is never spread into server project payloads. Server-local terminal IDs remain payload values on the already-bound client.
5. `WsTransport` retains endpoint, profile, auth token, and generation for its lifetime. REST and WebSocket callbacks are discarded or aborted when that generation is retired. A profile reconnect rebinds subscriptions and reads; it never replays terminal input, resize, create, kill, remove, or rename.

A focus change A → B → A is navigation only. It does not reconnect, create, kill, remove, or migrate a terminal. Disconnect/logout/profile removal locally retires the generation and detaches the UI; it does not delete remote PTYs. The active profile may change while a background profile's xterm continues receiving its owner-bound output.

## 3. Browser-Local Continuity Schemas

### 3.1 `terminal-layout:v3`

Traditional terminal groups derive their storage key in `traditional-terminal-projects.ts`:

```text
dam-hopper:terminal-layout:v3:<encodeURIComponent(JSON.stringify([profileId, groupId]))>
```

Owner-aware surfaces always include `profileId`. Generation is intentionally absent so reconnect does not fork a layout.

The value is a `PersistedLayout` with payload version `2`:

```ts
{
  version: 2,
  root: LayoutNode
}
```

`root` is a recursive binary tree. A split has a stable node ID, direction, two percentage sizes, and two children. A pane has a stable pane ID, `sessionIds`, and an `activeSessionId`; pane IDs are not terminal IDs. `useTerminalLayout()` reloads when the actual storage key changes, rejects malformed data, and starts a default pane. Docking, tab reorder, split/close, focus, resize, and dead-session pruning persist atomically from the hook's state transition. Layout persistence does not control PTY lifecycle.

The fresh-state reset removes old `dam-hopper:terminal-layout:*` records unless the key is already in the `v3` family.

### 3.2 `terminal-pins:v2`

Pins are tab-session UI state in `sessionStorage`, partitioned by profile:

```text
dam-hopper:terminal-pins:v2:<encodeURIComponent(profileId)>
```

The payload is IDs-only:

```ts
{ version: 2, sessionIds: string[] }
```

`useTerminalManager()` loads and saves the selected profile's partition. IDs are de-duplicated, empty IDs are discarded, and stale IDs are pruned against live or pending sessions. Invalid storage is ignored. The legacy `dam-hopper:terminal-pins:v1` key is removed; no old pin is assigned to a profile. Pins never reach the server and do not keep a remote PTY alive.

### 3.3 Command History v3

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

Search accepts an optional profile and ranks exact raw prefixes above normalized token matches, then recency/use count. Command history is not included in diagnostics exports.

## 4. Workflow Links and Owner-Directed Navigation

Workflow server history remains in the per-server/configuration SQLite store. The shared UI does not merge workflow histories or invent backend workspace IDs for frontend profiles.

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

Target selection separately rejects an unknown project or unavailable worktree. A rejected/orphan link never redirects to profile B merely because B exposes the same server-local ID.

## 5. Notifications and Diagnostics

Terminal notification events carry `profileId` and, when available, a `TerminalRef`. Notification metadata is safe display data and opaque IDs; it must not contain bearer credentials, endpoint credentials, CWD, environment, or command text. `terminal-notification-navigation.ts` validates that the target is mounted/alive or registered before revealing the terminal, then focuses the existing surface and xterm. Closed sessions are ignored.

Frontend diagnostics are redacted at record time by `diagnostics-client.ts` and retained only locally (default: 60 minutes, 1,000 entries, 512 KiB). `diagnostics-export.ts` supports an explicit `profileId`, frontend scope list, and terminal ID list. It filters the selected time window and scope, excludes entries whose metadata names another profile, and preserves global browser/route errors as global evidence. The export request carries `terminalIds`, `includeTerminalOutput`, and a bounded `terminalTailBytes` (workspace terminal export defaults to 65,536 bytes). Backend redaction remains authoritative.

An owner-directed export follows this order:

1. Select the profile/owner that originated the diagnostic surface.
2. Filter frontend logs with that profile and feature scope.
3. Send the request through that profile's bound diagnostics API/transport and restrict backend terminal tails to explicit IDs.
4. Download a profile-labelled file when `profileId` is supplied.

There is no implicit merged multi-profile bundle. A deliberate multi-profile export must issue one labelled request per owner and surface partial failures. Command history is never exported.

## 6. Fresh-State and Lifecycle Boundaries

`performFreshStateReset()` is an allowlisted, idempotent browser-resource reset. It removes old unqualified project/editor/tree/search/terminal layout/pin/history/browser-history records and quarantine backups while preserving profiles, endpoint-bound auth-v2 records, native state, presentation preferences, and server data. It does not call `localStorage.clear()` and performs no terminal create/kill/remove.

A terminal display may be hidden, reparented, or disposed while its remote session remains alive. Reconnect re-queries authoritative sessions and reattaches only a matching owner and incarnation; a missing session is not recreated solely because a layout still mentions its ID. Worktree disappearance leaves an unavailable/orphaned terminal visible with buffered output and disabled input rather than silently changing its target.

## 7. Source Map

| Concern | Implementation Boundary |
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
