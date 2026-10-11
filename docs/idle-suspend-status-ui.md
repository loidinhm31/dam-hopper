# Protected Idle-Suspend Status and Browser UI

**Status:** Phase 05 UI integration complete (2026-10-11)  
**Implementation scope:** Protected status decoding (`empty-fleet`, `agent-activity`, and `agent-free`), aggregate activity and semantic agent-free presentation, measurement warnings, read-only 3h agent-free quiet timing, always-mounted multi-profile sleep consent UI, and manual force-sleep preservation.

This guide records the browser-facing contract for configured-agent activity and
semantic `agent-free` automatic idle suspend. The server remains authoritative
for policy, measurement validity, semantic agent inventory, public client
presence, consent lifecycle, coordinator state, eligibility, and suspend
admission. The browser presents the protected snapshot and submits explicit
per-socket consent decisions; it does not infer eligibility or replace fleet
authority.

## Protected status boundary

The existing protected endpoint remains the only status authority:

```http
GET /api/system/idle-suspend/v1/status
```

A valid response is version `1`, requires the existing session cookie or Bearer
authentication, and carries `Cache-Control: no-store`. The response always
contains `automaticPolicy` and policy-specific projection fields:

| `automaticPolicy` | `activity` | `agentFree` & `clientPresence` | `consent`        | Meaning                                                                                                        |
| ----------------- | ---------- | ------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `empty-fleet`     | `null`     | `null` / absent                | `null` / absent  | Existing active-to-empty policy; no observer or agent-free facts are invented.                                 |
| `agent-activity`  | Object     | `null` / absent                | `null` / absent  | Aggregate observer state, counts, timestamps, TCP coverage, and optional measurement warning.                  |
| `agent-free`      | `null`     | Objects (required)             | Object or `null` | Semantic agent-free eligibility (`managed-terminals`, >3h threshold), public client presence, and consent flow. |

`enabled` controls automatic execution, not whether an authenticated operator
may use the existing manual force action. Disabled `agent-activity` or
`agent-free` still exposes observation/eligibility state, has no automatic
countdown, and cannot arm or execute automatic suspend.

### Activity object

`activity` uses the following closed values and nullable fields:

- `measurementState`: `initializing`, `available`, or `unavailable`.
- `reasonCode`: `recentInput`, `recentOutput`, `recentNetwork`, `agentChanged`,
  `lifecycleBusy`, `quiet`, `procAccess`, `scanLimit`, `scanTimeout`,
  `socketDiagnostics`, `unsupportedTransport`, `namespaceMismatch`,
  `staleObservation`, `identityUncertain`, `counterOverflow`, `reconciling`,
  or `epochSpent` (or `null`).
- `recognizedAgentCount`, `monitoredTerminalCount`, `sampledAtMs`, and
  `lastActivityAtMs`: nullable facts. `null` means unknown/not available, not
  zero or quiet.
- `networkCoverage`: currently the literal `tcp4-tcp6`.
- `measurementWarning`: `null` when measurement is available; required when
  measurement is initializing or unavailable.

A warning has a closed measurement reason (`procAccess`, `scanLimit`,
`scanTimeout`, `socketDiagnostics`, `unsupportedTransport`,
`namespaceMismatch`, `staleObservation`, `identityUncertain`, `counterOverflow`,
or `reconciling`), non-negative `blockedSinceMs`, a sorted list of at most 32
positive PID records, and `processesTruncated`. Each record contains only
`pid` and a nullable, non-empty `executableIdentity` of at most 256 UTF-8 bytes
without control characters.

The warning projection never contains command arguments, matcher entries,
environment variables, terminal/session/root/start identities, socket
addresses/inodes, terminal bytes, tokens, counters, or raw diagnostics. Logs,
audits, and WebSocket revision hints do not carry warning process details.

### Agent-free, client presence, and consent objects

When `automaticPolicy` is `agent-free`, the status payload includes required
`agentFree` and `clientPresence` objects and an optional `consent` object:

- `agentFree` (`decodeAgentFreeStatus`):
  - `phase`: `blocked`, `tracking`, `awaitingConsent`, `approved`, `finalCheck`,
    `handedOff`, `deferred`, or `reconciling`.
  - `scope`: literal `"managed-terminals"`.
  - `inventoryState`: `uninitialized`, `enumerating`, `consistent`, `stale`, or
    `degraded`.
  - `inventoryRevision` and `semanticRevision`: non-negative safe integers.
  - `idleCount`, `blockedCount`, `workingCount`, `unknownCount`: nullable
    non-negative safe integers (`null` means unknown, never zero).
  - `freeSinceMs`, `eligibleAtMs`, `deferredUntilMs`: nullable epoch-ms
    timestamps.
  - `reasonCode`: `idle`, `blocked`, `working`, `unknown`, `expired`,
    `disconnected`, `unavailable`, `ambiguous`, `reconciling`, `noAgents`,
    `allFree`, `unansweredTimeout`, `clientRefusal`, `lastClientDisconnected`,
    `safetyInvalidation`, or `decisionAlreadySettled` (or `null`).
- `clientPresence` (`decodeClientPresenceStatus`): non-negative safe integers
  `connectionCount`, `pendingUpgradeCount`, and `revision`, plus boolean
  `available`.
- `consent` (`decodeConsentStatus`): non-empty `requestId`, non-negative safe
  integer `requestRevision`, `state` (`pending`, `approved`, `denied`,
  `expired`, or `cancelled`), `requestedAtMs`, `expiresAtMs`, nullable
  `decision` (`approve` or `deny`), and `wakeAfterSeconds`.

Consent decisions are submitted via:

```http
POST /api/system/idle-suspend/v1/consent/decision
```

`api.system.submitConsentDecision()` invokes `system:submitConsentDecision` over
`WsTransport` (using `credentials: "omit"` and Bearer/profile auth) with
`{ requestId, requestRevision, connectionId, decisionCapability, decision }` and
validates the response through `decodeConsentDecisionResponse` (`version: 1`,
non-empty `requestId`, `decision: "approve" | "deny"`, `statusRevision`, and
boolean `settled`).

## Client decode and compatibility

`packages/ui/src/api/client.ts` treats transport data as `unknown` at the
`api.system.idleSuspendStatus()` boundary and calls
`decodeIdleSuspendStatusV1` before React Query receives it. The decoder validates
base v1 fields, closed coordinator/policy/activity/agent-free/consent values,
fleet and presence counts, safe integer/timestamp domains, warning ordering and
bounds, UTF-8 identity length, and strict policy-to-projection invariants:

- `empty-fleet`: requires `activity: null` and rejects non-null `agentFree`,
  `clientPresence`, or `consent`.
- `agent-activity`: requires a valid `activity` object and rejects non-null
  `agentFree`, `clientPresence`, or `consent`.
- `agent-free`: requires `activity` to be `null`/absent, requires valid
  `agentFree` (`decodeAgentFreeStatus`) and `clientPresence`
  (`decodeClientPresenceStatus`) objects, and decodes optional `consent`
  (`decodeConsentStatus`).

The only old-server normalization is narrow and non-mutating: an otherwise
valid base v1 object with **all** additive properties (`automaticPolicy`,
`activity`, `agentFree`, `clientPresence`, and `consent`) absent becomes a fresh
`empty-fleet`/`activity: null` object. Partial additive properties, explicitly
`undefined` properties, malformed data, unknown enums, or inconsistent
policy/projection pairs throw a decode error without echoing the rejected
payload.

`host:idleSuspendChanged` (`packages/ui/src/hooks/use-sse.ts`) remains a
version-1 revision-only invalidation hint. It invalidates both the ambient
`["system", "idle-suspend", "v1", "status"]` key and each connected profile's
owner-qualified `profileQueryKey(owner, "system", "idle-suspend", "v1", "status")`
so the subsequent protected GET remains authoritative.

## `HostIdleSuspendStatus` and `SettingsIdleSuspendTimingSection`

`packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` keeps the
existing coordinator badge, timing pair, capability, detail, generated-at time,
actual fleet counts, and Force Machine to Sleep action. It renders a visible
policy label (`Agent Activity`, `Agent Free (>3h)`, or `Legacy empty-fleet`).

In `agent-activity` mode, it adds:
- independent measurement state/reason rows in agent mode;
- recognized-agent and monitored-terminal counts, rendering `Unknown` for
  nullable values;
- explicit `tcp4-tcp6` coverage;
- a persistent, accessible heuristic notice: silence does not prove agent
  completion, only attributable TCP4/TCP6 is measured, and service-only
  terminals may still be suspended;
- an accessible measurement-blocked alert with reason, elapsed blocked duration,
  safe PID/identity examples, `Identity unavailable` for null identity, and an
  incomplete-list label when `processesTruncated` is true.

Initializing and unavailable measurement never renders quiet, zero counts, or an
automatic-ready claim. Available `quiet` is a candidate state awaiting the
server's final fresh sample and manager-locked admission; it is not proof that
work is complete. Empty-fleet and normalized old-server responses do not show
an observer failure or fabricated activity counts.

In `agent-free` mode (`automaticPolicy === "agent-free"`), `HostIdleSuspendStatus`
renders the **Semantic Agent-Free Eligibility** section:

- phase and `inventoryState` badge (`Blocked`, `Tracking (>3h)`,
  `Awaiting consent`, `Approved`, `Final check`, `Handed off`, `Deferred`, or
  `Reconciling`);
- `Idle / Blocked` and `Working / Unknown` agent counts (`Unknown` when null);
- `Public clients` presence (`<N> live (+<M> pending)` when available, or
  `Unavailable (blocking)` when `clientPresence.available` is false);
- fixed `>10,800s (3h)` eligibility threshold, mapped reason label, and
  `managed-terminals` scope;
- live countdown rows (when `enabled` is true) for `eligibleAtMs` in `tracking`
  phase, `deferredUntilMs` in `deferred` phase, and `consent.expiresAtMs` while
  consent is `pending`;
- a compact consent status box showing `consent.state`, settled `decision`, and
  `wakeAfterSeconds`;
- a persistent scope notice stating that tracking covers DamHopper terminals
  only (external work does not block sleep), `Free = Idle + Blocked` (waiting
  for input/approval, not task completion), and `Working` or `Unknown` blocks
  automatic sleep.

`packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.tsx`
respects `automaticPolicy === "agent-free"` by locking the **Quiet Period**
input to `10800` seconds (3 hours) as `readOnly` and `disabled`, explaining that
the 3-hour continuous free threshold is fixed under `agent-free` policy.
**Wake Duration** (`wakeAfterSeconds`) remains editable within server bounds
whenever `timingMutable` is true and the coordinator is not `handedOff`.

A single local display clock ticks at most once per second while an arm
deadline (`armDeadlineMs`), measurement warning (`blockedSinceMs`), or enabled
`agent-free` deadline (`eligibleAtMs`, `deferredUntilMs`, or pending
`consent.expiresAtMs`) is present, clamps countdown/elapsed values at zero, and
stops when none is present or the component unmounts. `sampledAtMs`,
`lastActivityAtMs`, `freeSinceMs`, and `blockedSinceMs` are display facts only:
wall-clock drift cannot change eligibility, query state, status revisions, or
server scheduling.

Manual force confirmation remains based on
`liveCount + creatingCount + restartPendingCount`. Agent counts, monitored
terminal counts, reason codes, and measurement warnings never reduce the
confirmation requirement. Existing handoff, closing, disposing, pending, 409
refresh/re-confirmation, one-POST/no-retry, wake-choice, and force-flag
behavior remains unchanged.

## Always-mounted consent flow (`HostSleepConsentHost` and `HostSleepConsentDialog`)

**Locations:** `packages/ui/src/components/organisms/HostSleepConsentHost.tsx`,
`packages/ui/src/components/organisms/HostSleepConsentDialog.tsx`,
`packages/ui/src/hooks/use-host-sleep-consent.ts`, and
`packages/ui/src/embed/dam-hopper-app.tsx`.

`HostSleepConsentHost` is mounted once near the top of `DamHopperApp` so consent
prompts remain active across Dashboard, Workspace (IDE, Traditional, and compact
layouts), Git, Settings, Agent Store, Usage, and SSH Forwarding without
duplicating listeners inside popovers or terminal panes.

### Multi-profile observation, queueing, and alias deduplication

`useHostSleepConsent` subscribes to saved profiles, connection snapshots,
per-socket `host:uiConnection` receipts (`connectionId` and
`decisionCapability`), and host-resource freshness (`serverEpoch`). It runs
owner-qualified `idleSuspendStatus` queries across all currently connected
profiles and invalidates a profile's status query whenever its per-socket
`connectionId` receipt arrives or changes.

Active consent items (`consent.state === "pending"` or live approved handoff)
are queued in deterministic order (`requestedAtMs`, `profileId`, `generation`,
`requestId`). When multiple connected profiles point to the same physical server
instance and expose both a fresh `serverEpoch` (from host-resource freshness or
ready agent status) and a UUID `requestId`, they deduplicate under
`server-instance:${serverEpoch}:${requestId}` (falling back to
`owner:${connectionKey}:${requestId}` when epoch or UUID is absent). Merged
profile labels appear under `Aliases:` in the dialog header, and multi-host
queues display `Host 1 of N (<M> other pending host requests queued)`.

### Decision submission, dismissal semantics, and conflict reconciliation

- **First valid answer wins & immediate final checks:** The dialog displays the
  target profile and endpoint, `Idle / Blocked` and `Working / Unknown` counts,
  connected clients, scheduled wake duration, unanswered countdown, and scope
  notices (DamHopper terminals only; external SSH/tmux/OS work excluded;
  `Blocked` means waiting for input/approval; first valid server-accepted
  decision wins host-wide). **Allow sleep** (`approve`) immediately starts final
  safety checks and cannot be undone by another client; **Do not sleep**
  (`deny`) or unanswered timeout defers automatic sleep for 3 hours.
- **Per-socket capability gating:** Action buttons stay disabled until the
  owning WebSocket receives its `host:uiConnection` capability receipt. If the
  socket receipt is missing or changes before submission, the hook surfaces a
  reconciliation message and invalidates the status query without POSTing.
- **Pending Escape/X deny vs settled dismissal:** Dismissing a `pending` dialog
  via Escape, outside click, or the close button submits an explicit `deny`
  decision (`source: "dismiss"`) and hides the item only after the server
  accepts `deny`. Once an item is settled (`approved`, `denied`, `expired`, or
  `cancelled`), clicking **Close** or dismissing hides the dialog locally
  without sending another POST.
- **409 and 503/network reconciliation:** A `409` `ApiRequestError`
  (`decisionAlreadySettled`, `consentExpired`, `consentCancelled`,
  `consentUnavailable`, or `idleSuspendHandoffInProgress`) transitions the item
  to the corresponding settled state, shows the server conflict message, and
  refetches authoritative status. `503`/`504`/`408`, `presenceUnavailable`,
  `consentUnavailable`, or transport failures keep the item visible with an
  outcome-uncertain alert and trigger an authoritative status refetch without
  blind retries.
- **Cognito Mode isolation:** When `useCognitoModeStore` is active,
  `HostSleepConsentHost` and `HostSleepConsentDialog` return `null`, countdown
  timers stop, and `approve`/`deny`/`dismiss` become no-ops so interactions
  while the privacy mask is active never dispatch consent mutations.

## Verification record

Status decoder targeted proof (all passed):

- protected backend API tests: **9/9**;
- decoder, status component, and ForceSleepDialog unit tests: **41/41**;
- Chromium browser tests: **13/13**;
- code review: **9.7/10**, approved.

Integrated qualification (all passed):

| Surface                           | Evidence                                                              |
| --------------------------------- | --------------------------------------------------------------------- |
| Activity unit module              | `cargo test --lib idle_suspend::activity`: **66/66**                  |
| PTY unit module                   | `cargo test --lib pty::`: **166/166**, one pre-existing ignored test  |
| Protected API idle-suspend filter | `cargo test --lib api::tests::idle_suspend`: **11/11**                |
| Cross-module integration          | `cargo test --test idle_suspend`: **19/19**, two ignored tests        |
| Linux observer smoke              | `activity_live_linux_pty_tcp_smoke`: **1/1** ignored smoke, **0.72s** |
| Chromium status/settings surface  | **16/16**                                                             |
| Static security boundary          | `verify-idle-suspend-boundary.sh`: **14/14**                          |

The QA report records **323 backend/PTY/API/integration tests**, **14/14
boundary checks**, and **16/16 Chromium tests**, with code review approved at
**9.4/10**. The integration cases cover service-only PTYs, accepted-input
invalidation, manual/final-check ordering, disabled observation, protected
warning serialization, and clean sampler shutdown. Chromium covers available,
initializing, unavailable, disabled-observer, truncation, elapsed-warning,
countdown, manual-action, and old-server payload behavior.

The Linux smoke is explicitly ignored and selected by an operator on a Linux
qualification host. It uses a test-owned managed PTY, the current integration
test binary as child, a loopback TCP echo, production proc/netlink observation,
and a panic executor. Automated qualification never invokes the enrolled
helper, `systemctl suspend`, RTC programming, `sudo`, root installation, or
external model/network services. A passing smoke does not authorize a real
automatic suspend canary; that remains an Operations gate.

## Related documentation

- [API Reference — Terminal idle suspend](./api-reference.md#terminal-idle-suspend)
- [Frontend Components](./frontend-components.md)
- [System Architecture](./system-architecture.md#server-authoritative-terminal-idle-suspend-architecture)
- [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md)
- [Agent Activity Automatic Admission](./agent-activity-automatic-admission.md)
