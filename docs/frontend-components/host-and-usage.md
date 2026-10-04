# Host Resources and Usage Components

Host-resource, diagnostics, usage, and terminal status details moved from the [component index](../frontend-components.md).
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
[`scripts/qualify-phase09-workbench.mjs`](../../scripts/qualify-phase09-workbench.mjs)
runner checks S01–S12 against isolated Server A/B roots (`14801`/`14802`) and
four embedded workflow/terminal browser assertions. Phase 09 records 3,504
passing tests (nine skipped/ignored); G2-Web passed. G2-Native remains blocked
pending real Windows S13 runtime, SSH, WebView2/DPAPI, and Browser relay proof.
See the [Phase 09 verification matrix](../../plans/260916-2137-unified-profile/verification-matrix.md).

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
or measurement warnings. See [Protected Idle-Suspend Status and Browser UI](../idle-suspend-status-ui.md).
Phase 07 Chromium qualification covers the rendered agent-activity policy,
available/initializing/unavailable/disabled measurement, warning duration and
safe identity/truncation, countdown, manual force flow, and old-server
compatibility. See [Phase 07 verification report](../../plans/reports/qa-260911-1107-phase07-integrated-qualification.md).

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


