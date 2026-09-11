# Protected Idle-Suspend Status and Browser UI

**Status:** Phase 06 complete (2026-09-11)  
**Scope:** Protected status decoding, aggregate activity presentation, measurement warnings, and manual force-sleep preservation.

This guide records the browser-facing contract for configured-agent activity idle
suspend. The server remains authoritative for policy, measurement validity,
coordinator state, eligibility, and suspend admission. The browser presents the
protected snapshot; it does not infer eligibility or replace fleet authority.

## Protected status boundary

The existing protected endpoint remains the only status authority:

```http
GET /api/system/idle-suspend/v1/status
```

A valid response is version `1`, requires the existing session cookie or Bearer
authentication, and carries `Cache-Control: no-store`. The response always
contains `automaticPolicy` and `activity`:

| `automaticPolicy` | `activity` | Meaning |
| --- | --- | --- |
| `empty-fleet` | `null` | Existing active-to-empty policy; no observer facts are invented. |
| `agent-activity` | Object | Aggregate observer state, counts, timestamps, TCP coverage, and optional measurement warning. |

`enabled` controls automatic execution, not whether an authenticated operator
may use the existing manual force action. Disabled `agent-activity` still
exposes observation state, has no automatic countdown, and cannot arm or execute
automatic suspend.

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

## Client decode and compatibility

`packages/ui/src/api/client.ts` treats transport data as `unknown` at the
`api.system.idleSuspendStatus()` boundary and calls
`decodeIdleSuspendStatusV1` before React Query receives it. The decoder validates
base v1 fields, closed coordinator/policy/activity values, fleet counts and
flags, safe integer/timestamp domains, warning ordering and bounds, UTF-8
identity length, warning nullability, and the policy/activity relationship.

The only old-server normalization is narrow and non-mutating: an otherwise
valid base v1 object with **both** own properties `automaticPolicy` and
`activity` absent becomes a fresh `empty-fleet`/`activity: null` object. Exactly
one missing property, an explicitly `undefined` property, malformed new data,
an unknown enum, an invalid warning, or an inconsistent policy/activity pair is
an error. Transport, authentication, and network rejections propagate without
legacy fallback; decoder errors do not stringify the rejected payload.

This keeps old deployed servers readable without hiding partial deployments,
authentication failures, or corrupt status. No second endpoint, client version,
polling loop, activity mutation, policy editor, matcher editor, or per-terminal
status store is introduced. `host:idleSuspendChanged` remains a revision-only
invalidation hint; the subsequent protected GET is authoritative.

## `HostIdleSuspendStatus` presentation

`packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` keeps the
existing coordinator badge, timing pair, capability, detail, generated-at time,
actual fleet counts, and Force Machine to Sleep action. It adds:

- a visible policy label (`Agent Activity` or `Legacy empty-fleet`);
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

The only countdown is derived from `armDeadlineMs`. A local display clock ticks
at most once per second while either an arm deadline or measurement warning is
present, clamps countdown/elapsed values at zero, and stops when neither is
present or the component unmounts. `sampledAtMs`, `lastActivityAtMs`, and
`blockedSinceMs` are display facts only: wall-clock drift cannot change
eligibility, query state, status revisions, or server scheduling.

Manual force confirmation remains based on
`liveCount + creatingCount + restartPendingCount`. Agent counts, monitored
terminal counts, reason codes, and measurement warnings never reduce the
confirmation requirement. Existing handoff, closing, disposing, pending, 409
refresh/re-confirmation, one-POST/no-retry, wake-choice, and force-flag
behavior remains unchanged.

## Verification record

Phase 06 targeted proof (all passed):

- protected backend API tests: **9/9**;
- decoder, status component, and ForceSleepDialog unit tests: **41/41**;
- Chromium browser tests: **13/13**;
- code review: **9.7/10**, approved.

The suites cover valid new and legacy payloads, malformed/partial payloads,
transport rejection, disabled observation, warning identity/duration/truncation,
countdown rendering, narrow status semantics, keyboard/click force flow, and
privacy-negative serialization checks. Integrated real-observer qualification,
target-host observer fit, and any automatic real-host canary remain Phase 07/08
work; this document does not claim those gates passed.

## Related documentation

- [API Reference — Terminal idle suspend](./api-reference.md#terminal-idle-suspend)
- [Frontend Components](./frontend-components.md)
- [System Architecture](./system-architecture.md#server-authoritative-terminal-idle-suspend-architecture)
- [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md)
- [Agent Activity Automatic Admission](./agent-activity-automatic-admission.md)
- [Phase 06 plan](../plans/260910-1604-agent-activity-idle-suspend/phase-06-api-ui.md)
- [Phase 06 verification report](../plans/reports/tester-260911-1028-phase06-protected-status-browser-ui.md)
