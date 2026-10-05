# Workbench and Profile Components

Shared shell, owner selection, Git history, Settings, and Advisor composition details moved from the [component index](../frontend-components.md).

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

## Unified shell and profile navigation (Phase 02)

Phase 02 removes the old single-transport/profile-guard boundary. The shared
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

## Profile-owned enrollment and MFA UI (Phase 04)

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
and optional retry delay. See the [Authentication API](../authentication-api.md)
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
and creates a new transport generation. `ServerProfilesDialog` and `TopNav`
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
Physical target-browser verification remains Phase 05 qualification.

See the [Phase 04 plan](../../plans/260926-2157-token-rotation-mfa/phase-04-profile-mfa-flow.md)
and the [component detail index](./index.md) for the
implementation boundary and adjacent UI guides.

## Shared Git-history view (search plan Phase 04)

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
for transport, query, and persistence details and the
[Phase 04 plan](../../plans/261001-2003-git-history-search-persistence/phase-04-shared-history-view.md).
Phase 05 Workspace integration is implemented across the desktop IDE dock,
terminal floating panel, and compact Git surface, using the shared controller
and selected-target availability. Phase 06 Standalone Git page integration
persists qualified checkbox selections, fails closed on unavailable projects,
and reuses the shared history controller for single-project view. Phase 07
completes integrated qualification across both surfaces with live loopback server
smoke, latency verification, and Chromium browser tests.
See [Git-history search architecture](../architecture/git-history-search.md)
and the [qualification plan](../../plans/261001-2003-git-history-search-persistence/phase-07-qualification-documentation.md).

## Unified-profile Settings, Usage, and Host ownership (Phase 06)

Phase 06 keeps browser preference state separate from server-targeted work. The
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
for source arbitration and the [Phase 04 plan](../../plans/260929-1522-host-resources-sse/phase-04-resource-query-and-ui-cutover.md) for focused evidence. The earlier [Phase 06 Settings, Usage, and Host Resources guide](../phase-06-preferences-settings-usage-and-host.md) documents the underlying owner boundary.

## Native Advisor Workspace host and provider (Phases 04 and 05)

The Native Evcrate Advisor UI is hosted directly inside Dam-Hopper Workspace as a pure React component subtree (`packages/ui/src/advisor/AdvisorPanel.tsx`), eliminating iframe isolation, MessagePort bridges, and external plugin SDK dependencies.

- **Workspace Integration:** `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx` mounts `AdvisorPanel` across integrated placements (IDE dock right tool, Terminal floating panel, and compact overlay).
- **Owner-Bound Provider:** `NativeAdvisorProvider` implements `AdvisorDataProvider` over the captured owner-bound `ApiClient.advisor`. It manages request IDs, maps them to per-request abort controllers for the eight history/policy/evaluation operations, and discards stale/cancelled responses.
- **Views and Navigation:** Four views are provided: Overview (aggregate metrics and latency), History Records (filters, pagination, and consultation detail), Configuration (current account policy and route groups), and Evaluations (descriptor discovery, revision reads, and comparisons). Panel navigation uses local reducer state and roving keyboard controls; it never accesses `window.location.hash`.
- **Visibility and Gating:** `useAdvisorVisibility` combines connected status, administrator role, and the per-server `server.advisor.enabled` setting. When disabled or unauthorized, Advisor surfaces and launchers are omitted from the UI.
- **Settings Toggle:** `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx` allows administrators to toggle the feature and view detected real-directory status without path-hash configuration or directory registration.
- **Inline Routing Editor:** `PolicySummaryCard.tsx` provides an accessible inline editor for active account-wide routing policy (`$HOME/.evcrate/advisor-routing.json`):
  - Dual `RouteFieldset` components for primary and backup routes.
  - Dynamic harness model discovery (`POST /api/advisor/models`) with built-in fallback catalogs and custom model text input toggle.
  - Real-time client duplicate validation prevents identical primary/backup triples (`ROUTE_BACKUP_IDENTICAL`), allowing differing effort levels.
  - Backend-specific effort options with default suggestions and OMP/Pi provider prefix (`provider/model`) enforcement.
  - Sequence-fenced CAS saves (`PATCH /api/advisor/policy`) with conflict recovery and cancellation resetting pristine state.
  - Keyboard accessible with Tab/Shift+Tab focus traversal, Enter/Escape hotkeys, aria labels, and scoped `.native-advisor` CSS rules.


