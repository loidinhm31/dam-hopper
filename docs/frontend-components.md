# Frontend Components

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
and optional retry delay. See the [Authentication API](./authentication-api.md)
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

See the [Phase 04 plan](../plans/260926-2157-token-rotation-mfa/phase-04-profile-mfa-flow.md)
and the [component detail index](./frontend-components/index.md) for the
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

See the [Git-history search architecture](./architecture/git-history-search.md)
for transport, query, and persistence details and the
[Phase 04 plan](../plans/261001-2003-git-history-search-persistence/phase-04-shared-history-view.md).
Phase 05 Workspace integration is implemented across the desktop IDE dock,
terminal floating panel, and compact Git surface, using the shared controller
and selected-target availability. Phase 06 Standalone Git page integration
persists qualified checkbox selections, fails closed on unavailable projects,
and reuses the shared history controller for single-project view. Phase 07
completes integrated qualification across both surfaces with live loopback server
smoke, latency verification, and Chromium browser tests.
See [Git-history search architecture](./architecture/git-history-search.md)
and the [qualification plan](../plans/261001-2003-git-history-search-persistence/phase-07-qualification-documentation.md).

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

See the [host-resource SSE architecture](./architecture/host-resource-sse.md)
for source arbitration and the [Phase 04 plan](../plans/260929-1522-host-resources-sse/phase-04-resource-query-and-ui-cutover.md) for focused evidence. The earlier [Phase 06 Settings, Usage, and Host Resources guide](./phase-06-preferences-settings-usage-and-host.md) documents the underlying owner boundary.

## Native Advisor Workspace host and provider (Phases 04 and 05)

The Native Evcrate Advisor UI is hosted directly inside Dam-Hopper Workspace as a pure React component subtree (`packages/ui/src/advisor/AdvisorPanel.tsx`), eliminating iframe isolation, MessagePort bridges, and external plugin SDK dependencies.

- **Workspace Integration:** `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx` mounts `AdvisorPanel` across integrated placements (IDE dock right tool, Terminal floating panel, and compact overlay).
- **Owner-Bound Provider:** `NativeAdvisorProvider` implements `AdvisorDataProvider` over the captured owner-bound `ApiClient.advisor`. It manages request IDs, maps them to per-request abort controllers for the eight history/policy/evaluation operations, and discards stale/cancelled responses.
- **Views and Navigation:** Four views are provided: Overview (aggregate metrics and latency), History Records (filters, pagination, and consultation detail), Configuration (current account policy and route groups), and Evaluations (descriptor discovery, revision reads, and comparisons). Panel navigation uses local reducer state and roving keyboard controls; it never accesses `window.location.hash`.
- **Visibility and Gating:** `useAdvisorVisibility` combines connected status, administrator role, and the per-server `server.advisor.enabled` setting. When disabled or unauthorized, Advisor surfaces and launchers are omitted from the UI.
- **Settings Toggle:** `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx` allows administrators to toggle the feature and view detected real-directory status without path-hash configuration or directory registration.

## Unified-profile integration and qualification (Phase 09)

The integrated shell keeps one explicit owner through project aggregation,
commands, ports, media cleanup, host status, and Browser handoff:

- `useAggregatedProjects` binds each connected profile's project query to its
  `ConnectionRef`; disconnected rows use a non-dispatching fallback owner.
- `useCommandSearch` accepts an owner and sends catalog queries through the
  bound API. `usePorts` memoizes target profiles and owner-qualified port/tunnel
  keys, so equal numeric ports remain separate.
- `TopNav`, `DashboardPage`, and `WorkspacePage` use aggregated projects and
  bound clients. Browser artifact creation rechecks owner, target revision, and
  terminal incarnation after each await.
- `ImportDialog` captures its opening owner in state; `HostIdleSuspendStatus`
  and `getActiveSessionCount` handle nullable fleet snapshots without
  fabricating remote state. Settings revocation passes the profile's
  `mediaClientId`; media cleanup remains bounded and best effort.

The browser qualification fixture uses strict port `15173` and one configured
Chromium channel/executable. The live
[`scripts/qualify-phase09-workbench.mjs`](../scripts/qualify-phase09-workbench.mjs)
runner checks S01–S12 against isolated Server A/B roots (`14801`/`14802`) and
four embedded workflow/terminal browser assertions. Phase 09 records 3,504
passing tests (nine skipped/ignored); G2-Web passed. G2-Native remains blocked
pending real Windows S13 runtime, SSH, WebView2/DPAPI, and Browser relay proof.
See the [Phase 09 verification matrix](../plans/260916-2137-unified-profile/verification-matrix.md).

## Host-resource fleet deck and cards (Phase 02)

**Locations:** `packages/ui/src/components/organisms/HostResourceFleetDeck.tsx`,
`HostResourceFleetCard.tsx`, and
`packages/ui/src/lib/host-resource-state.ts`.

`HostResourceFleetDeck` is a layout-only boundary over the Phase 01
`MultiHostResourceEntry[]` read model. It receives `entries`,
`selectedProfileId`, and `onInspect(profileId)`, renders the configured order
as a labelled `section` with a semantic `ul`/`li` list, and reports the watched
profile count. An empty list uses the explicit status message **No connected or
auto-connect profiles to watch.** It does not read stores, queries, APIs, or
connection actions, and it does not sort, aggregate, poll, or create a second
scroll container.

`HostResourceFleetCard` keeps the profile boundary visible in a compact
scan-first article:

- Profile name and endpoint are escaped text with overflow-safe wrapping;
  endpoint text is never a navigation link.
- Connection state and watch reason, status icon/label, unread incident count,
  hostname/OS, and sample age are shown when available.
- Connected cards expose one full-width, keyboard-operable inspection button
  with a 44px minimum target and an accessible name containing the profile and
  status. The callback receives only that profile ID.
- Disconnected, offline, connecting, or otherwise unavailable rows remain
  readable non-interactive articles and say that live inspection requires a
  connection. A cached snapshot is explicitly labelled **Last known**.
- Optional memory and battery facts use the existing finite-value formatters;
  unsupported or missing values are omitted rather than rendered as zero.

The pure `formatSampleAge(sampledAt, now)` helper rejects missing, non-finite,
negative, and zero timestamps, then rounds ages into seconds, minutes, hours,
or days. Cards compute this text during normal renders; they do not install one
timer per card. Focused behavior is covered by
`HostResourceFleetCard.test.tsx`, `HostResourceFleetDeck.test.tsx`, and
`host-resource-state.test.ts`.

## Host-resource alert presentation

**Locations:** `packages/ui/src/components/organisms/HostResourcePopover.tsx`,
`HostResourceDiagnosis.tsx`, `HostResourceDiagnosisRows.tsx`,
`packages/ui/src/hooks/use-sse.ts`, and `use-host-resource-alert-presentation.ts`.

The top-nav popover reads the legacy memory `alert` and additive `currentAlerts`
from the authoritative snapshot, while the diagnosis panel renders the bounded,
mixed alert-history response. Concurrent thermal and disk incidents are tracked
by `incidentId`; a recovery event with `resolvedAt` removes only that target and
the history retains its resolved record. `resolvedAt: 0` is still a recovery.

The transport listener accepts legacy memory events and resource events on the
same `host:alertChanged` channel. It validates owner-qualified resource
payloads and dispatches each event once per transport; a registered owner bridge
suppresses the matching ambient listener. It patches only the owning snapshot
while `canUseResourceRest` permits REST authority, never the metrics key, and
does not patch or invalidate the snapshot while switching or LIVE. History
invalidations are coalesced by owner generation and QueryClient, then drained
only for a current, visible, non-auth-blocked owner. Alert history stays
REST-backed, and REST snapshots reconcile missed events and reconnects. A
current server's explicit empty `currentAlerts` array clears resource
presentation; omission preserves older-server compatibility.

The diagnosis also keeps the legacy `HostMetrics` path for CPU and workspace-disk
summary values, real temperature rows, and an explicit unavailable state when
sensors are absent. Host storage is a local, default-collapsed disclosure that
reveals every server-ordered disk with its name, mount, percentage, and used/total
bytes; it does not add polling or persistence. Deep-snapshot failure uses the
same legacy presentation so cached temperatures and disks remain visible.

The popover presents a compact glance tier before the diagnosis disclosure in a
stable order: memory used, CPU, selected storage, temperatures, and battery or
power when available. Percentage-capable rows include bounded meters; the
memory meter uses `usedBytes / totalBytes`. The diagnosis disclosure contains
the detailed memory, pressure, storage, process/cgroup, alert, and incident
sections. Storage selection is an optional `hostResourcePinnedMount` UI
preference; a missing saved mount remains visibly missing and is never silently
rebound to another filesystem. Updating that preference does not affect
monitoring or alert classification.

The diagnosis renders an optional `snapshot.battery` section only when the
server reports at least one classified battery, the section is not unsupported,
and at least one field passes the client-side finite/non-negative validation.
It shows the battery count, normalized status, and capacity when present, plus
independent rows labeled **Remaining energy (Wh)** and **Instantaneous power
(W)**. Missing measurements are omitted rather than shown as zero or
`Unknown`; an energy-only response does not create a power row, and vice versa.
Availability text is shown beside retained values, including stale or degraded
states. The field is optional so an older server produces no battery section;
the UI adds no polling, legacy fallback metric, per-device expansion, chart, or
mutation control for this data.

Opening the popover acknowledges the presentation count but does not dismiss an
active resource incident. The popover resolves one effective status from the
legacy alert and unresolved `currentAlerts` entries: the maximum severity wins
(`critical > warning > info`), ties use the generic `Critical`, `Warning`, or
`Advisory` label, and source order cannot change the result. A healthy legacy
alert with no active resource incident is `Healthy`; an absent legacy alert is
`Monitoring`. Recent history, acknowledgement, and unread count are independent
of rank and tone.

Snapshot freshness is a qualifier on retained data. Cached data keeps its
active severity while reporting `refresh failed`, `core data unavailable`,
`resource alert status unavailable` for an omitted older-server field, `stale`,
or `refreshing` as applicable. Without data, the status is `Snapshot
unavailable` or `Sampling host` according to the query state. An explicit empty
`currentAlerts` array is authoritative and means no active resource incidents;
an omitted field is an older-server response and does not invent or clear one.
The badge is decorative and uses the effective tone; its separate screen-reader
text says either `N unread host incidents` or `Active host incident`, never `0
unread`. Opening acknowledges the presentation count only; this read-only UI
does not change query, acknowledgement, bounds, fallback, active incidents, or
dismissal behavior.

## Terminal idle-suspend status (Phases 06–07)

**Locations:** `packages/ui/src/api/client.ts`,
`packages/ui/src/api/queries.ts`, and
`packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx`.

`api.system.idleSuspendStatus()` invokes the strict
`decodeIdleSuspendStatusV1` boundary on an `unknown` transport response. The
decoder accepts the existing version-1 status plus required
`automaticPolicy`/`activity` additive fields, normalizes only a valid old
server that omits both fields, and leaves malformed, partial, authentication,
and transport failures as query errors. It never echoes rejected payloads.

`HostIdleSuspendStatus` keeps coordinator state, actual fleet counts, timing,
capability, detail, generated-at time, and the manual Force Machine to Sleep
action. Agent mode adds independent measurement state/reason, nullable
recognized-agent and monitored-terminal counts (`Unknown` when null),
`tcp4-tcp6` coverage, and a persistent accessible heuristic notice. The notice
states that silence does not prove completion, only attributable TCP4/TCP6 is
measured, and service-only terminals may still be suspended.

Initializing/unavailable observation is never rendered as quiet, zero, or
automatic-ready. Measurement warnings use a persistent `role="alert"` with
reason, elapsed blocked duration, bounded PID/safe identity examples, an
identity-unavailable label, and a truncation/incomplete label. The warning's
process projection excludes command arguments, matcher data, environment,
terminal/session/root/start identities, socket details, bytes, tokens, and raw
diagnostics.

One local display clock serves both the `armDeadlineMs` countdown and warning
elapsed duration, ticks at most once per second, clamps negative values at zero,
and stops when neither display is present. Sample and activity timestamps are
display-only; ticks never refetch, publish a status hint, or affect admission.
Manual confirmation continues to use actual
`liveCount + creatingCount + restartPendingCount`, independent of agent counts
or measurement warnings. See [Protected Idle-Suspend Status and Browser UI](./idle-suspend-status-ui.md).
Phase 07 Chromium qualification covers the rendered agent-activity policy,
available/initializing/unavailable/disabled measurement, warning duration and
safe identity/truncation, countdown, manual force flow, and old-server
compatibility. See [Phase 07 verification report](../plans/reports/qa-260911-1107-phase07-integrated-qualification.md).

## Error Boundary and stale lazy-chunk recovery

**Location:** `packages/ui/src/components/ui/ErrorBoundary.tsx`

`ErrorBoundary` keeps the existing custom fallback and client diagnostics for
normal render failures. For a conservative set of browser module-load errors—
`ChunkLoadError`, `Loading chunk <n> failed`, `Failed to fetch dynamically
imported module`, or `Importing a module script failed`—it attempts one full
page reload per tab session. The boundary first stores
`dam-hopper:stale-chunk-reload-attempted` in `window.sessionStorage`; an existing
value suppresses another reload. If session storage is unavailable or throws on
read/write, recovery fails closed and the normal fallback remains visible.

The classifier intentionally rejects approximate or unrelated application
errors, so a second stale failure and ordinary render failures follow the same
fallback/diagnostic path. Focused tests in
`packages/ui/src/components/ui/ErrorBoundary.test.tsx` cover these boundaries,
guard ordering, and storage failures.

### Explorer-local transport errors (Phase 01 follow-up)

`WorkspacePage` wraps the desktop IDE Explorer, compact IDE Explorer, and
terminal floating Explorer in separate `ErrorBoundary` instances. Each boundary
is keyed by surface, profile, project, and target, and keeps the existing
`Suspense` fallback inside the boundary. A FileTree render/effect failure
therefore replaces only its Explorer region; it does not remount the workspace
shell, editor, or active terminal hosts. Changing the target clears a latched
boundary error without resetting unrelated workspace state.

## Usage Insights Settings

**Locations:** `packages/ui/src/components/pages/SettingsPage.tsx`,
`packages/ui/src/components/organisms/SettingsUsageInsightsSection.tsx`, and
`packages/ui/src/components/organisms/SettingsUsageInsightsCodexRow.tsx`

The Settings page exposes a **Usage insights** section backed by the authenticated
`usage:setupStatus` and `usage:configure` transport methods. It lets users enable or pause
privacy-safe local terminal capture, retry an unavailable loopback receiver, and explicitly
manage optional Codex token export. Codex setup is reported as `notConfigured`, `managed`, or
`conflict`; conflicts disable management and leave existing Codex configuration untouched.
Managing export does not restart Codex, so the UI indicates that a new/restarted Codex session
is required. When capture is disabled, the Usage page links back to Settings and explains that a
new terminal is required for complete run boundaries.

## Usage Session Audit

**Locations:** `packages/ui/src/components/pages/UsagePage.tsx`,
`packages/ui/src/components/usage/UsageSessionAudit.tsx`, `UsageSessionList.tsx`,
`UsageSessionTree.tsx`, and `UsageSessionTokens.tsx`.

The Usage page has Overview and Sessions tabs. Sessions shows bounded aggregate model/delegation
summaries and a selected session's bounded node tree with lineage, token, and terminal-correlation
status. Opaque URL parameters (`view=sessions`, `session`, and authenticated `cursor`) preserve
selection and pagination deep links. Model values are dynamic provider-qualified display strings.

Primary tokens are input + output + reasoning; cached input is displayed separately and excluded.
Partial or unavailable lineage is surfaced, never inferred. Session and terminal identities are
derived HMAC references; raw commands, prompts, responses, tool content, and storage paths are not
rendered or persisted by the UI. List/detail queries poll every 15 seconds only in a visible
document; hidden tabs stop polling. Browser and native hosts share this behavior. Paused collection
keeps stored summaries readable and marks the view paused; deletion remains explicit and destructive.

## Latest Commit in Terminal

**Locations:** `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`,
`packages/ui/src/components/organisms/TerminalCommitStatusChip.tsx`,
`packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`,
and `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`

Settings > Appearance exposes one **Show latest commit in terminal** toggle. When
enabled, the Runtime terminal header renders a compact status chip containing the
current branch, latest commit message, localized timestamp, and seven-character short
hash. Traditional mode instead renders each named project's branch, projected worktree
path, and latest commit message in three icon-led rows; branch and worktree values may
truncate with a tooltip, while long commit messages wrap instead of being truncated.
Hovering exposes full values, and the complete Runtime details plus all Traditional values
are included in accessible labels. The status is passive and does not add a refresh action
or polling: the shared project-status and worktree queries supply data, and Git mutations
invalidate it when fresh status is needed.
Missing, invalid, non-Git, unavailable project status, or unavailable worktree discovery is
handled fail-closed by hiding the metadata.

## Traditional Terminal Projects

**Locations:** `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`,
`packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`, and
`packages/ui/src/lib/traditional-terminal-projects.ts`

Traditional mode groups open terminal tabs by their mounted session project and
keeps stopped tabs in their project row until the user explicitly closes them. The
project activity dot is green only when at least one grouped tab is receiving output
in the shared browser-local activity state. Quiet, unavailable, and stopped tabs
keep the project row visible but make it non-green; backend `SessionInfo.alive`
remains the separate process-liveness value. The navigator and selected pane `+`
normally target the selected terminal project (or create a free terminal for the
synthetic Free terminals group). If the global workspace project
changes while the active Traditional terminal remains in another project, those
`+` actions target the newly selected workspace project; explicitly selecting a
different terminal project updates the target again. The workspace header keeps its
`+` available in that mismatch state as an additional current-project launch action.
Desktop uses a persisted, keyboard- and mouse-resizable project rail bounded to
220–520 pixels. Its named vertical separator supports Arrow keys in 16-pixel steps,
Shift+Arrow keys in 32-pixel steps, and Home/End for the minimum/maximum width.
Compact layouts expose the same navigator in a bottom sheet without the desktop rail
resize handle.

## Shared File Decorations

**Location:** `packages/ui/src/lib/file-decoration.ts`

**Purpose:** Central source of truth for file icons, badge text, display language, and Monaco language.

**Visible consumers:**

- `FileTree`
- `EditorTab`
- `SearchPanel`
- `FilePathLabel`

**Notes:**

- Exact filename lookup takes priority, then extension, then MIME, then neutral fallback.
- `file-decoration-icon.tsx` only renders the shared lookup result.
- Git change rows can reuse the same lookup for file identity while keeping VCS badges separate.

### Explorer Image Preview

**Locations:** `packages/ui/src/components/organisms/ImagePreview.tsx`,
`packages/ui/src/components/organisms/EditorTabs.tsx`,
`packages/ui/src/api/image-tickets.ts`, and `packages/ui/src/lib/image-file.ts`

The Explorer and editor route final, case-insensitive `png`, `jpg`, `jpeg`, `gif`,
and `webp` files to the native image preview tier before generic binary or large
file handling. SVG, AVIF, BMP, TIFF, dotfiles, diff tabs, and video tabs remain
outside this route; the dedicated diff viewer and video preview keep precedence.

`ImagePreview` issues a protected, preview-only capability using the captured
profile/generation owner and its UUIDv4 media client namespace. It assigns the
opaque stream URL directly to one native `<img>` with
`alt="Image preview: {fileName}"` after a credentialed `HEAD` probe and
`crossOrigin="use-credentials"`.
It does not call `fsRead`, `Response.blob()`, `URL.createObjectURL`, canvas APIs,
or a download action. Loading, ready, error, retry, stale-ticket, profile-change,
and unmount cleanup are visible lifecycle states. Cleanup removes the image
source before best-effort `RemoteCleanupHandle` revocation; stale async results
use the original owner/ticket handle rather than the current profile.

### Explorer Video Preview and Direct Download

**Locations:** `packages/ui/src/components/organisms/VideoPreview.tsx`,
`packages/ui/src/api/video-tickets.ts`, and
`packages/ui/src/lib/start-video-download.ts`

`VideoPreview` issues a playback-only media ticket for the captured
profile/generation owner and assigns its opaque URL directly to one native
`<video>` after a credentialed `HEAD` probe. It sets
`crossOrigin="use-credentials"` before assigning `src`; it does not read bytes
through `fsRead`, `Blob`, or `URL.createObjectURL`.

Playback and download are separate capabilities. The download action requests a
fresh `purpose: "download"` ticket, clicks a temporary hidden anchor, and
removes the anchor. It does not immediately revoke that ticket because the
browser owns the download lifecycle; normal ticket/session TTL and explicit
logout cleanup remain the safety boundary.

On teardown or profile/connection replacement, playback pauses, removes `src`,
calls `load()` to cancel the native request, and then invokes its captured
`RemoteCleanupHandle`. Concurrent cleanup is bounded and deduplicated; stale
async playback results are revoked through the owner that issued them. Browser
coverage exercises profile isolation, mount/unmount, delayed stale streams, and
direct playback/download behavior.

Editor open, hydration, save, force-overwrite, reload, and Git reconciliation
preserve image tabs as preview-only. Legacy persisted image tabs are normalized
before they can enter a text/binary read path, and status overlays report
capability or stream failures without materializing image bytes.

### Explorer HTML Preview

**Locations:** `packages/ui/src/components/organisms/HtmlHost.tsx`,
`packages/ui/src/components/organisms/HtmlPreview.tsx`,
`packages/ui/src/components/organisms/EditorTabs.tsx`,
`packages/ui/src/components/organisms/TreeContextMenu.tsx`,
`packages/ui/src/components/organisms/FileTree.tsx`,
`packages/ui/src/lib/html-file.ts`,
`packages/ui/src/lib/html-preview-transform.ts`, and
`packages/ui/src/lib/html-view-mode-persistence.ts`.

Provides file detection, presentation persistence, editor host routing, context menu preview actions, and sandboxed preview rendering for HTML documents:

- **Detection (`html-file.ts`):** Identifies `.html`, `.htm`, and `.xhtml` case-insensitively, maps to standard HTML/XHTML MIME types (`text/html`, `application/xhtml+xml`), and checks preview candidate suitability (excluding diff, large, and binary tabs). Dotfiles without a base name (e.g. `.html`) are excluded.
- **View Mode Persistence (`html-view-mode-persistence.ts`):** Manages user view mode selection (`"edit" | "split" | "preview"`) via browser `localStorage` key `dam-hopper:html-view-mode:v1`, defaulting to `"edit"`. Storage access is safe and resilient to exceptions or unavailable storage environments. Dispatches the `dam-hopper:html-view-mode-changed` (`HTML_VIEW_MODE_CHANGED_EVENT`) window event on save, enabling live synchronization across mounted tabs without requiring a remount or page reload.
- **Sandboxed Rendering (`HtmlPreview.tsx` & `html-preview-transform.ts`):**
  Renders HTML content inside a sandboxed `<iframe>` with
  `sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"`.
  Omission of `allow-same-origin` gives the document an opaque origin (`"null"`),
  preventing access to parent cookies and storage; network requests remain
  subject to browser/CORS policy. Updates to editor content are debounced by
  200ms to avoid DOM thrashing, and an explicit reload control enables forced
  remounting of the iframe. To ensure embedded `<script>` tags and standard
  interactions work reliably in the sandboxed preview without fatal security
  exceptions, `prepareHtmlPreviewContent` injects non-invasive shims:
  - **In-Memory Storage Shim:** Provides an in-memory `localStorage` and
    `sessionStorage` fallback when native access throws `SecurityError` under
    the `null` origin, allowing scripts with storage calls to execute smoothly.
  - **In-Frame Visual Alert Modal:** Intercepts `window.alert()` to render an
    in-frame visual dismissible modal dialog, overcoming modern browser
    suppression of native dialogs in cross-origin sandboxed frames.
- **Editor Host (`HtmlHost.tsx`):** Split-view HTML editor component offering an **Edit | Split | Preview** top toggle bar. Lazily imports `MonacoHost` to keep initial bundle size lean. Listens to `HTML_VIEW_MODE_CHANGED_EVENT` to react dynamically to external mode changes, while supporting an optional `initialMode` prop override (e.g., when launched into preview mode from an Explorer context menu action) and defaulting to user preference loaded from `dam-hopper:html-view-mode:v1`.
  - **Edit Mode:** 100% width Monaco code editor.
  - **Split Mode:** 50% left Monaco editor with divider border, 50% right `HtmlPreview`.
  - **Preview Mode:** 100% width sandboxed `HtmlPreview`.
  - Seamlessly forwards editor lifecycle properties (`tabKey`, `path`, `content`, `tier`, `mime`, `viewState`, `readOnly`, `onChange`, `onSave`, `onViewStateChange`, `lineChanges`, `onGitIndicatorClick`).
- **EditorTabs Routing (`EditorTabs.tsx`):** Detects HTML files via `isHtmlFile(activeTab.name)` before fallback MonacoHost, dynamically loading `HtmlHost` inside a `Suspense` boundary with a centered loading spinner fallback.
- **Explorer Context Menu Integration (`TreeContextMenu.tsx` & `FileTree.tsx`):** Exposes a dedicated "Preview" action with an `Eye` icon in the right-click context menu for HTML files.
  - **5 MiB Size Threshold:** Restricted strictly to files smaller than 5 MiB
    (`node.size < 5 * 1024 * 1024`). Files at or above 5 MiB, directories, and
    non-HTML files omit the preview item to avoid memory and performance
    degradation in the iframe.
  - **Action Flow:** Clicking "Preview" calls `saveHtmlViewMode("preview")`, which emits `HTML_VIEW_MODE_CHANGED_EVENT` and invokes `onFileOpen(node)`, opening the document directly into Preview mode or live-switching an existing active tab.

## Cognito Privacy Mode (Phases 02–04)

**Locations:** `packages/ui/src/stores/cognito-mode.ts`,
`components/organisms/CognitoModeOverlay.tsx`,
`hooks/use-cognito-mode-input-guard.ts`, `lib/cognito-mode-events.ts`,
`lib/shortcuts.ts`, `lib/terminal-keyboard-shortcuts.ts`,
`components/organisms/TerminalPanel.tsx`, `embed/dam-hopper-app.tsx`,
`index.css`, `TerminalNotificationToastViewport.tsx`,
`BrowserDebugKeepAliveHost.tsx`,
`components/organisms/SettingsKeyboardShortcutsSection.tsx`, and
`components/organisms/SettingsAppearanceSection.tsx`.

`useCognitoModeStore` is memory-only UI state: it starts inactive, and
`toggle(shortcut)` activates with that chord captured for dismissal. Toggling
again clears the active state and chord; `reset()` is lifecycle cleanup, not a
user dismissal control. The shortcut and style remain persisted preferences;
activation state is never stored.

In Settings > Keyboard Shortcuts, capture/reset Cognito's shortcut; Settings > Appearance offers **Heavy Blur** and **Black Screen**. Preferences persist, but activation is memory-only and reload starts inactive. Only the same chord that activated the mask dismisses it; notifications and audio continue while masked.

`CognitoModeOverlay` portals a focusable, labelled region to `document.body`
only while active. Its full-viewport fixed layer uses the app viewport
dimensions and `z-index: 10000`. `black-screen` is opaque black; `heavy-blur`
uses a 40px backdrop blur and dark tint, with an opaque-black fallback when
backdrop filtering is unsupported. The accessible description includes the
captured dismissal chord, and activation moves focus to the overlay.

`useCognitoModeInputGuard` owns window-capture input isolation. It registers
non-passive capture listeners for pointer, mouse, touch, click/context, wheel,
drag, clipboard, input, composition, focus, and keyboard events. While active it
cancels cancelable input and stops immediate propagation; gesture tracking also
consumes a trailing release/click after dismissal. It redirects focus to the
overlay and restores the previous target only if it remains connected and
non-inert. The pointer-event list is defined in `cognito-mode-events.ts`.

`DamHopperApp` mounts this guard first, before the browser shortcut and context
menu guards. A fresh, matching nonrepeat/noncomposing keydown toggles the mask;
IME input (including legacy key code `229`) and repeats never toggle it. While
active, only a fresh keydown matching the frozen activation chord dismisses;
all keyboard events are consumed, including repeats and the physical key
sequence through release. The guard tracks intercepted physical keys and clears
that tracking on window blur without dismissing the mask. The
`data-shortcut-capture="true"` path passes through only while inactive.

`TerminalPanel` performs a defensive Cognito check before Backspace handling,
suggestion acceptance/history, or selection copying. Its shared shortcut helper
checks again before font, find, panel, and new-terminal actions. These terminal
checks only consume input; the root capture guard is the sole toggle owner.
Ordinary terminal behavior resumes after dismissal; PTY write/transport APIs
are unchanged.

The app root mounts the overlay outside the routed content and keeps global
shortcut services and the notification viewport mounted. A neutral content
wrapper receives `inert` and `aria-hidden` while masked rather than unmounting
productive routes. The terminal toast viewport remains visible above the mask
(z-index `10001` while active), but capture listeners prevent pointer
interaction; toast lifetime and other notification delivery are unchanged.
`BrowserDebugKeepAliveHost` separately hides the requested viewport: native
hosts receive a null viewport and the iframe fallback receives
`isViewportVisible={false}`. Dismissal restores the measured viewport without
replacing the Browser target or host.

The shortcut is scoped to events in DamHopper's app document; this is not an
OS-wide hotkey and does not capture keys from foreign iframes or native child
surfaces. Phase 05 still owns real-browser, xterm, visual, and native-shell
qualification; component and unit coverage alone do not prove those runtime
boundaries.

## Terminal Agent Notifications

**Primary locations:**

- `packages/ui/src/components/organisms/AgentStatusBridge.tsx`
- `packages/ui/src/hooks/use-agent-status-connections.ts`
- `packages/ui/src/stores/agent-status.ts`
- `packages/ui/src/lib/terminal-agent-notification-integration.ts`
- `packages/ui/src/components/organisms/AgentSettings.tsx`
- `packages/ui/src/components/atoms/AgentStatusBadge.tsx`
- `packages/ui/src/stores/terminal-notifications.ts`
- `packages/ui/src/components/organisms/TerminalNotificationCenter.tsx`
- `packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx`
- `packages/ui/src/lib/terminal-notification-sound.ts`
- `packages/ui/src/lib/browser-notification-service.ts`
- `packages/ui/src/lib/terminal-notification-navigation.ts`

**Purpose:** Shared notification UI for server-reported semantic agent attention. The app-root status bridge owns profile subscriptions; terminal output is not parsed as Codex status, and DamHopper's Codex OSC 9 notification integration has been removed.

**Flow:**

1. `AgentStatusBridge` keeps per-profile snapshots and authenticated WebSocket subscriptions active outside `TerminalPanel`.
2. The agent status store fences rows and attention by profile connection generation, server epoch, terminal incarnation, and attention revision; baseline snapshots do not replay historical alerts.
3. `terminal-agent-notification-integration.ts` accepts only matching current owner/status/attention identities, then selects the policy by agent.
4. When an enabled policy accepts attention, history is recorded; `toast`, `sound`, and `browser` independently control transient, audio, and browser delivery.
5. Version-2 policies route OMP turn-ended and needs-attention events, Claude qualified needs-attention only, and no Codex alerts.
6. `TerminalNotificationCenter` renders the bell, unread count, bounded history, mark-read/all, and clear actions. In-app selection uses the event's profile and terminal identity.
7. `TerminalNotificationToastViewport` renders up to three live top-right alerts with a six-second timeout. `BrowserNotificationService` gates popup delivery by permission, rate limit, and support.

**Behavior notes:**

- Codex hooks provide status only: no turn-ended alert or needs-attention notification. Claude alerts are attention-only for qualified approval, question, or error states; normal turn-ended alerts are suppressed. OMP retains both turn-ended and needs-attention alerts.
- All policy masters default off. Version-1 and legacy Codex settings normalize into version 2 while preserving Codex/OMP channel preferences; Claude defaults off. Status badges do not depend on notification policy.
- Agent Settings is under Agent Store. OMP enablement requires matching install/runtime paths and a current managed extension; Claude requires matching paths and ready hooks; Codex notification activation is disabled.
- Agent status badges show the agent and human-readable state, distinguish Unknown, and identify lifecycle versus hook observations with limited-coverage context in the tooltip.
- There is no Codex OSC 9 parser, notification handler, or terminal attach callback, and settings no longer write Codex TUI notification configuration. Status and attention use the server agent-status protocol.
- History is memory-only and capped at 50 records; toast IDs are capped at three. Sound uses the existing synthesized in-app chimes and does not control native browser popup sound.
- Semantic notification selection retains profile and terminal incarnation identity; stale or closed targets are ignored. Browser permission is runtime-only and requested only by the explicit **Request permission** action.

## Terminal Title Ordinals

Open terminal titles derive a current 1-based ordinal from the global `openTabs`
order within each exact project group. Interleaved tabs from projects A and B
therefore display `A #1`, `B #1`, `A #2`, `B #2`; the global array order itself
never changes. The display projection is ephemeral: base `TabEntry.label` remains
unsuffixed, while `DisplayTabEntry.title` carries
`{ baseLabel, ordinal, fullText }`. `TerminalTitleText` renders the base in a
shrinkable/truncating region and the `#N` suffix in a non-shrinking region,
exposing `fullText` exactly once to assistive technology. Reordering, opening,
closing, and hydrating tabs recalculate each project's sequence.

Project grouping uses explicit frontend/session project metadata, never labels.
Free or projectless tabs share one internal projectless group; their
`Terminal X`/`Terminal (starting…)` labels are not grouping keys. Mounted-only
runtime or browser-handoff entries are outside the open-title contract, so they
retain readable unsuffixed fallbacks. Open browser targets carry both the
structured title and its complete `fullText` label.

Title ordinals are separate from notification context: `TerminalKeepAliveHost`
continues to calculate `terminalOrder` as the tab's global 1-based `openTabs`
position. `sessionId` remains the identity for keys, selection, close/pin/
diagnostics, PTY attachment, notifications, and browser artifacts. No title or
fallback exposes opaque session IDs or PTY incarnations.

## Component detail index

See the [Frontend Component Details index](./frontend-components/index.md) for
the terminal/IDE and platform integration guides. Workflow-specific architecture
is documented in the [Workflow Context Surface](./workflow-context-surface.md).
