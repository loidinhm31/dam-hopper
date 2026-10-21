# Workbench and Profile Components

Shared shell, owner selection, Git history, and Settings composition details moved from the [component index](../frontend-components.md).

Architecture and documentation for the shared React UI used by the DamHopper
browser host and Tauri native host.

## Overview

The frontend is split into thin hosts plus a shared React 19 UI package:

- `apps/web` performs fresh browser-state reset and profile migration, reconciles
  runtime configuration, creates an ordinary `QueryClient`, and renders the
  shared shell once.
- `apps/native` performs the same reset/migration, creates an ordinary
  `QueryClient`, mounts native providers, and renders the shared shell once.
- `packages/ui` owns the shared shell, keyed profile runtimes, components,
  hooks, stores, API clients, styles, and tests consumed by both hosts.

Shared runtime libraries:

- **Vite** for bundling hosts
- **Zustand** for client state
- **TanStack Query** for server state
- **Tailwind CSS v4** for styling
- **xterm.js** for terminal rendering

## Unified shell and profile navigation

The workbench removes the single-transport/profile-guard boundary. The shared
`DamHopperApp` mounts routes and shell UI even when no profile is connected.
Connection attempts are independent per profile:

- `server-config.ts` persists normalized `ServerProfile` records, including
  `autoConnect`, and endpoint-bound `ProfileAuthV2` token records.
- `connections.ts` owns one runtime per profile. Every snapshot carries the
  profile ID and generation, with `disconnected`, `connecting`, `connected`,
  `mfa-required`, `login-required`, `offline`, and `unsupported` statuses.
- `ServerProfilesDialog` exposes Connect, Disconnect, Login, Logout, Edit,
  Remove, and Auto-connect actions without changing another profile's runtime.
- `ProjectSwitcher` displays qualified `Profile → Project` targets, and
  `workspace.ts` persists `{ profileId, project }` rather than an unowned
  project name.
- `workbench-selections.ts` keeps preferences, server settings, and Browser
  Debug targets independent; a removed preference source retains its snapshot
  with `source-removed` status.
- `fresh-state-reset.ts` removes only allowlisted legacy browser-resource
  records, preserves profiles/auth/server data, is idempotent, and rejects
  unqualified `project`/`session` deep links.

The top-nav connection button summarizes all profile runtimes. Server
configuration inside Settings reuses the profile/project switcher and is not a
second hierarchy. Browser and Windows native hosts may use approved
cross-origin profiles; non-Windows native hosts require exact same-origin
profiles and do not send traffic for unsupported remotes.

Query state remains memory-only. Host `QueryClient` instances use ordinary
defaults; profile and generation ownership is encoded by
`profileQueryKey(owner, ...)` instead of a global active-profile hash.

## Profile-owned enrollment and MFA UI

**Locations:**

- `packages/ui/src/api/auth-client.ts`, `packages/ui/src/api/auth-types.ts`,
  `packages/ui/src/api/connections.ts`, `packages/ui/src/api/ws-transport.ts`,
  and `packages/ui/src/api/server-config.ts`
- `packages/ui/src/components/molecules/MfaChallengeForm.tsx`
- `packages/ui/src/components/organisms/ServerSettingsDialog.tsx`,
  `ServerProfilesDialog.tsx`, and `TopNav.tsx`
- `packages/ui/src/lib/android-chrome-input-policy.ts`

The typed auth client models password login as a challenge-or-session result
and auth status as authenticated, MFA-required, or login-required. It validates
protocol-v2 responses and preserves machine-readable error code, HTTP status,
and optional retry delay. See the [Authentication API](../api/authentication.md)
for server contracts.

`MfaChallengeForm` serves both enrollment and verification. Enrollment renders
the local QR from the returned `otpauthUri`, issuer/account/period/digit
metadata, and a selectable Base32 key with explicit copy feedback; verification
reuses the code form without setup details. The numeric one-time-code field
filters non-digits while preserving leading zeroes, requires the configured
digit count, and shows inline errors and rate-limit feedback. Setup values and
challenge/password/code drafts remain interaction state, not profile storage.

Authentication work is profile-owned. `ServerSettingsDialog` fences pending
responses to the captured profile/endpoint and request ID; opening a profile
already marked `mfa-required` requests a step-up challenge with that profile's
current token. A successful proof stores only that profile's replacement token
and creates a new transport generation. `ServerSettingsDialog` keeps its header
and footer pinned (`shrink-0`) while scrolling its body region
(`data-dialog-scroll-body="true"`) within `.dialog-viewport-fit`, adjusting
`scrollTop` when an MFA challenge opens, receives focus/input, or resizes via
`visualViewport` so the verification/enrollment action buttons remain reachable
on mobile viewports. `ServerProfilesDialog` and `TopNav`
expose/report each profile's state without turning one stale profile into a
global lockout.
`connections.ts` maps `MFA_REQUIRED` status/REST errors and WebSocket close
`4403` to profile-local `mfa-required`, without the generic reconnect loop. A
live stale transport is retired; the profile token remains available for HTTP
step-up. Full-login-required outcomes stop reconnect, and expired/revoked tokens
are cleared only for that profile.

On Android Chrome, auth controls marked `data-auth-input` or contained by
`data-auth-container` bypass the native-input suppression policy; the policy
also recognizes the explicit `data-dh-allow-native-input="true"` marker.
Login credentials, TOTP, and the server URL are explicitly exempt so Android
Chrome can use native keyboard input without relaxing editor/terminal policy.
Physical target-browser verification remains an operational qualification gate.

See the [Frontend Components index](../frontend-components.md) for the
implementation boundary and adjacent UI guides.

## Shared Git-history view

**Locations:** `packages/ui/src/hooks/use-git-history-view.ts`,
`packages/ui/src/components/molecules/GitHistoryToolbar.tsx`,
`packages/ui/src/components/organisms/GitBranchControl.tsx`, and
`packages/ui/src/components/organisms/GitLogTree.tsx`.

`useGitHistoryView(target: ProjectTargetRef, options?)` is the shared history
controller. It combines persisted root/branch preferences and discovery with
owner-scoped log queries, draft/applied message search, 200-entry paging,
selected-commit state, availability/status, and guarded refresh. Its effective
scope includes profile, project/worktree, root, branch preference, and
connection generation; scope changes clear transient search, page, and
selection state. History queries wait for preference hydration. Missing saved
roots or pins are reconciled only after successful, completed, nonempty
discovery, so loading or offline results do not erase persisted intent.
Follow-active tracks the checked-out branch; every explicit branch choice
pins a canonical local or remote ref. Only **Follow checked-out branch**
resumes tracking.

Search remains responsive while a 300 ms debounce applies the normalized
server query. IME composition defers application; CR/LF/NUL are removed, and
clear or Escape applies an empty query immediately. Query changes reset page
and selected commit. Refresh invalidates matching branch/status/log/detail
queries, resolves the refreshed branch before fetching the current page, and
ignores stale-scope completions when updating selection or notices.

`GitHistoryToolbar` is controlled: it renders labeled search, clear, paging,
displayed-range count, refresh, follow-active, and dismissible notice controls
from parent values and callbacks. It does not read the history store or call
the server. `GitBranchControl` keeps checkout mode as the default. In
`mode="view"`, `selectedBranchRef` and `onSelectedBranchRefChange` use
canonical `refs/heads/...` versus `refs/remotes/...` values, so same-name local
and remote branches remain distinct and choosing a history branch does not
check it out.

`GitLogTree` defaults to `presentation="graph"`; `presentation="list"` skips
ancestry-lane/SVG construction while preserving the same ref/message/author/
date/hash rows, keyboard selection, and commit context-menu actions. Surfaces
can supply `emptyMessage`. History mutations and dialogs remain surface-owned;
the hook exposes `effectiveScopeKey` for parent reset boundaries.

### Consecutive-commit squash

`useGitHistoryView` also owns transient checkbox selection bounded to the loaded
page. `git-squash-selection.ts` checks actual parent continuity and produces
oldest-first exact IDs; filtered gaps are rejected. Selection clears on effective
owner/root/branch/generation, applied-query, or page changes. Rows keep detail
click/Enter and context-menu behavior independent of checkbox click/Space.

`GitHistoryActions` composes `useGitSquash`; both `WorkspaceGitPanel` and `GitPage`
render `GitSquashFlow`. Its modal `GitSquashDialog` loads full-message snapshots,
preserves oldest-first bodies in an editable draft, requires coherent branch/tip
snapshots and explicit signature-removal consent, and blocks dismissal while a
local rewrite is pending. Known failures retain the draft; uncertain outcomes
disable automatic retry and never create a success receipt. Closing restores a
live launcher or surviving toolbar without leaving the app input-locked.

Squash requires an available connected target on a local branch (`refs/heads/*`), active or inactive (`isViewingLocalBranch`), and rejects selected or rewritten-descendant merges. The success receipt captures the target branch and offers **Publish rewritten branch** through a separate leased confirmation bound to `receipt.branch`. Publication uses the same history owner/root and verified new branch tip—not Git-page bulk root selection or ambient HEAD. Nothing pushes automatically. Scope/generation changes fence late preparation, rewrite, publication, and SSH-retry completions.

See the [Git-history search architecture](../architecture/git-history-search.md)
for transport, query, and persistence details. Workspace integration is
implemented across the desktop IDE dock, terminal floating panel, and compact
Git surface, using the shared controller and selected-target availability.
Standalone Git page integration persists qualified checkbox selections, fails
closed on unavailable projects, and reuses the shared history controller for
single-project view. Integrated qualification across both surfaces verified
live loopback server smoke, latency benchmarks, and Chromium browser tests.

## Unified-profile Settings, Usage, and Host ownership

The workbench keeps browser preference state separate from server-targeted work. The
Settings page exposes `preferencesProfileId` (shared UI preference source) and
`settingsProfileId` (configuration, maintenance, usage, and host target) as
independent selectors. Project focus does not change either selector.

`useSettingsStore.saveDebounced` captures the bound `ConnectionRef`, API client,
and edit revision before its 500 ms coalescing timer. Source changes cancel
undispatched patches; already-dispatched writes finish only against their
captured profile. Last-known allowlisted preferences remain usable offline,
while a removed source is marked `source-removed`.

Settings config, TOML import/export, maintenance, Usage insights, and idle
suspend timing all receive the selected owner. Import captures owner and
generation before confirmation and `file.text()`, rejects drift before
dispatch, and leaves server validation/backup/rollback authoritative. Usage
summary, sessions, health, setup, and destructive operations use
`profileQueryKey(owner, ...)`; session audit polling stops in hidden documents.

`HostResourcePopover` keeps explicit-owner compatibility for one configured
profile or an explicit `owner`: snapshot, incidents, compatibility metrics,
idle-suspend state, and `hostResourcePinnedMount` stay owner-local. With no
`owner` and more than one configured profile, it opens in Fleet mode on
`HostResourceFleetDeck`; a labelled toolbar provides a Fleet toggle and one
profile pill per watched entry. Connected pills enter a profile drilldown;
disconnected pills remain status-only.

The shared drilldown binds reads and actions to the selected `ConnectionRef`.
Fleet opening marks no profile read; inspection marks only the selected profile.
`DamHopperApp` registers the real `QueryClient` with the connection registry;
stream coordinators are keyed by that client identity and exact connection
owner. Distinct QueryClients never share cache authority, and roots sharing one
client reuse its coordinator.

Fleet and detail use the owner's canonical snapshot key. The coordinator
arbitrates it and the metrics key against REST: snapshot fallback is 15 seconds,
and compatibility metrics fallback is 5 seconds only for visible connected
detail. REST requests carry an abort signal and source-generation fence; entering
LIVE cancels exact owner queries and writes the paired snapshot/metrics frame
atomically. Removing or disconnecting the selection returns to Fleet rather
than falling back to Settings or the active profile.

The WS bridge validates an owner-qualified alert once per transport and avoids
a second ambient alert delivery. Incident/unread presentation is profile- and
incident-ID-scoped; history invalidations are coalesced, and WS resource cache
patches are allowed only while REST has authority. They cannot overwrite a
switching or LIVE SSE pair. Fleet and detail status use the matched stream
observation ages plus monotonic elapsed time and TTL; TanStack `isStale` is
only request-cache metadata. The Force Machine to Sleep dialog still captures
endpoint, generation, fleet snapshot, status revision, and request ID; stale
conflicts require fresh confirmation and ambiguous requests are not retried.

### Host-resource delivery modes and UI presentation

The UI coordinates host resource streams across seven distinct operational modes per profile:

1. **`UNSUPPORTED`**: The server returns 404/405 or a native runtime lacks owner-bound streaming. A current connected, visible owner uses exact-owner REST fallback (15 s snapshot; 5 s visible detail metrics).
2. **`STARTING`**: SSE is opening; cached readings may remain visible with their observation ages until a valid paired frame arrives.
3. **`LIVE`**: A paired SSE frame updates snapshot and metrics atomically and suppresses both resource REST pollers. Freshness uses server monotonic observation ages and the clamped TTL; a live socket does not make a stale/degraded section fresh.
4. **`SWITCHING`**: A synchronous local fence advances the owner/source generation before query cancellation. From fence onset through paired commit, snapshot and metrics REST starts/completions and WS resource cache writes are blocked.
5. **`ERROR`**: Transport, network, or framing failure schedules bounded retries. REST fallback is allowed only for the current connected owner with visible interest; offline, hidden, auth-blocked, or retired owners make no resource request.
6. **`AUTH_BLOCKED`**: `AUTH_REQUIRED`, `MFA_REQUIRED`, or `503 AUTH_UNAVAILABLE` cancels/fences snapshot and metrics REST, including requests already in flight. MFA/session errors require the selected profile's auth flow; `AUTH_UNAVAILABLE` means the server cannot verify auth, not that credentials are invalid. The state persists through retries and hidden periods; it clears only on a valid authenticated paired frame or a new connection generation.
7. **`HIDDEN`**: A hidden document pauses/disposes the stream, and closing the popover removes its interest. No resource REST polling runs while hidden; visible cached values retain their age and are not presented as live.

**Key presentation behaviors:**

- **Fresh equal-revision reconnect baseline:** A current new attempt may accept the same epoch/revision only with an immediately preceding matching status and complete paired frame. This re-establishes freshness metadata; it does not mean the host was sampled again.
- **Per-section stale indicators:** A stalled/degraded sensor (for example, a process-scan timeout) marks its section stale/unavailable even while the SSE connection is live; never fabricate zero values or label carried-forward data as newly observed.
- **WebSocket notifications without cache rollback:** WS alerts update profile/incident unread state and coalesce visible REST history refreshes at 30 s, but cannot overwrite the LIVE/switching SSE pair. The owner bridge's non-resource events (PTY, terminal, git, workspace) remain available across QueryClient changes.
- **No new setting:** Users do not need to enable SSE; no SSE preference or host-resource polling control is added.
- **Privileged actions:** Force Machine to Sleep and idle-suspend remain manual, separately authenticated actions; telemetry never triggers them.

See the [host-resource SSE architecture](../architecture/host-resource-sse.md)
for source arbitration. The [Preferences, Settings, and Host Resources architecture](../architecture/preferences-settings-and-host-resources.md) documents the underlying owner boundary.

## Floating Git Conflict Resolver Panel

**Locations:**

- `packages/ui/src/components/organisms/ConflictResolverPanel.tsx`
- `packages/ui/src/components/organisms/ConflictResolverToolbar.tsx`
- `packages/ui/src/components/organisms/ConflictRegionNav.tsx`
- `packages/ui/src/components/organisms/MergeConflictEditor.tsx`
- `packages/ui/src/hooks/use-floating-panel-geometry.ts`
- `packages/ui/src/lib/terminal-workspace-panel.ts`
- `packages/ui/src/lib/conflict-resolver-panel-state.ts`
- `packages/ui/src/lib/conflict-editor-decorations.ts`

The floating Git conflict resolver provides a cross-shell resolution workbench mounted directly in `WorkspacePage` above `IdeShell`, `TerminalWorkspaceShell`, and `MobileWorkspaceShell`.

### Component Roles & Host Integration

- **`ConflictResolverPanel`:** Root floating frame container rendered inside an overlay boundary (`fixed inset-0 z-40`). Receives controlled `open`, `zIndex`, `isTopmost`, `onActivate`, and `onHide` props. Does not own or dispose draft models on close: hiding the panel toggles visibility while retaining active draft text and decision states in memory (while integrated Monaco command undo/redo remains an open Phase 08 integration gate).
- **Floating Conflict Indicator Pill:** When unmerged conflicts exist while the panel is hidden, `WorkspacePage` displays a bottom-docked pill (`fixed bottom-4 right-4 z-40`) showing an animated `GitMerge` icon and conflict count. Clicking the pill reopens the resolver panel without refetching or discarding edits.
- **`ConflictResolverToolbar`:** Provides title bar drag handling (`onMouseDown={onDragStart}`), active Git operation indicator badge (e.g. `MERGE`, `REBASE`, `CHERRY-PICK`, `REVERT`), project label, file selection dropdown for multi-file conflict lists, maximize/restore toggle, and close/hide control.
- **`MergeConflictEditor`:** 3-panel merge editor consuming the Phase 06 `ConflictMergeModel`, `useConflictResolver`, `useGitConflictFile`, and `useGitFileDiff`. Renders read-only source editors for Theirs and Ours (plus optional Base) alongside the editable Result editor.
- **`ConflictRegionNav`:** Chunk navigation bar rendering conflict chips, prev/next navigation (`ChevronUp` / `ChevronDown`), and decision actions (`Accept Ours`, `Accept Theirs`, `Accept Both`, `Ignore`, `Mark Reviewed`) keyed strictly to stable `region.id` identifiers.

### Unified Panel Stacking (`terminal-workspace-panel.ts`)

Floating surfaces across the workbench share a single stacking model:

- **Identifier Union:** `TerminalFloatingPanelId` is defined as `"files" | "tool" | "resolver"`.
- **Ordered Stack Management:** `updateFloatingPanelStack(stack, panelId, action)` manages an array of panel IDs where the last item is topmost.
- **Deterministic Z-Index Resolution:** `resolveFloatingPanelStackZIndex(panelId, stack)` maps the panel's position in the stack to a CSS z-index (`TERMINAL_FLOATING_PANEL_BASE_Z_INDEX = 20`, +2 per stack depth), coordinating logical stack ordering across `WorkspacePage` and `TerminalWorkspaceShell`, provided compatible ancestor CSS stacking contexts are maintained.

### Scoped Keyboard Arbitration & Escape Priority

Keyboard shortcut arbitration in `handleResolverPanelKeyDown` enforces strict safety boundaries:

1. **Topmost Ownership:** Escape only triggers `onHide` if `isTopmost === true`.
2. **DOM Focus Containment:** Only handles Escape if document focus is inside the panel element or at document body.
3. **Monaco Widget Consumption Priority:** If any Monaco overlay widget is active (`.suggest-widget.visible`, `.find-widget.visible`, `.monaco-menu-container`), Escape is consumed by Monaco first, preventing premature panel closure while dismissing autocompletion or find widgets.
4. **Terminal Key Isolation:** Unconsumed Escape events call `stopImmediatePropagation()`, `stopPropagation()`, and `preventDefault()`, preventing keystrokes from leaking into background terminal PTY sessions.

### Responsive Narrow Mode (768px Container Breakpoint)

`MergeConflictEditor` adapts responsively based on its container element width:

- **Container Resize Observation:** Uses a `ResizeObserver` observing the editor's container element (`containerNode`). When container width is $< 768\text{px}$, the editor switches to `isNarrow = true`.
- **Wide Layout ($\ge 768\text{px}$):** Multi-column split grid displaying `Theirs (readonly)`, `Result (editable)`, `Ours (readonly)`, and an optional 4th column for `Base` (`showBaseInWide`).
- **Narrow Layout ($< 768\text{px}$):** Replaces the multi-column grid with an accessible tablist (`role="tablist"`):
  - **Theirs Tab:** Read-only view with stage 3 blob content and short OID.
  - **Result Tab:** Editable view with dirty indicator (`Result *` or `Result ✓` when all conflicts resolved).
  - **Ours Tab:** Read-only view with stage 2 blob content and short OID.
  - **Base Tab:** Read-only view with stage 1 base blob content (rendered only when stage 1 exists in the snapshot).
- **State Invariance:** Switching narrow tabs switches the active Monaco editor view without unmounting or resetting the underlying draft model or in-progress text edits.

### In-Memory Monaco Models & Public Decorations

- **Model URI Isolation & Target Scoping Gap:** Monaco editor instances mount to deterministic URIs (`inmemory://${project}/${filePath}/theirs`, `/result`, `/ours`, `/base`) with `keepCurrentModel: true`. Note: Current URIs do not encode profile ID, connection generation, or worktree path, leaving full owner-qualified URI scoping as an open isolation gate for multi-target environments.
- **Public Decorations:** `buildResultDecorations` and `buildSourceDecorations` apply public Monaco delta decorations (`.mc-conflict-marker`, `.mc-conflict-ours`, `.mc-conflict-theirs`, `.mc-conflict-base`, `.mc-conflict-sep`, `.mc-conflict-resolved`) using styles injected once into document head via `injectConflictStylesOnce()`.
- **Input Policy Enforcement:** Respects `isAndroidChromeNativeInputSuppressed` from `useAndroidChromeInputPolicy()` by enforcing `readOnly: true` on the Result editor when Android Chrome native input suppression is active.

