# Terminal Idle Suspend API

Server status, timing, helper, and manual-force contracts moved from the [API reference index](../api-reference.md).
### Terminal idle suspend

Server-authoritative, fail-closed terminal idle suspend subsystem with protected
status, bounded authenticated timing settings, an authenticated manual
force-suspend action, and out-of-band push hints. Automatic idle timing and the
manual action remain separate: a manual request does not change the persisted
automatic policy.

### Policy and configuration contract

The automatic policy and executable matcher list are startup configuration,
not status fields or runtime mutation inputs. The registry stores the block
under `[server.idle_suspend]` with snake_case keys. Config-shaped JSON (for
`GET /api/config` and settings export) uses `server.idleSuspend` and camelCase
field names; snake_case aliases are accepted when decoding this block.

| TOML key               | Config JSON key       | Contract                                    |
| ---------------------- | --------------------- | ------------------------------------------- |
| `enabled`              | `enabled`             | `false` by default; startup-owned           |
| `quiet_period_seconds` | `quietPeriodSeconds`  | bounded automatic timing                    |
| `wake_after_seconds`   | `wakeAfterSeconds`    | bounded automatic timing                    |
| `enrollment_reference` | `enrollmentReference` | optional startup enrollment                 |
| `capability_selection` | `capabilitySelection` | startup capability selector                 |
| `automatic_policy`     | `automaticPolicy`     | `empty-fleet` (default) or `agent-activity` |
| `agent_executables`    | `agentExecutables`    | literal executable matcher list             |

The default executable list is `["codex", "omp", "claude", "agy"]`. Entries
are literal, case-sensitive basenames or absolute paths, not regular
expressions. The list must contain 1–32 unique entries; each entry is 1–256
UTF-8 bytes and may use only ASCII letters, digits, `_`, `-`, `.`, `+`, and
`@` in path components. Whitespace, controls/NUL, disallowed shell/glob/regex
metacharacters, relative slash-containing paths, `.`/`..`, repeated or
trailing `/`, and generic interpreter basenames (`node`, `nodejs`, `bun`, `sh`,
`bash`, `dash`, `zsh`, `ksh`, `fish`, `python`, or `python` followed by an
ASCII digit) are rejected. Validation is lexical: it does not expand
variables, inspect the filesystem, launch a process, or silently
deduplicate/normalize input.

`StartupIdleSuspendPolicy` captures enablement, enrollment, capability
selection, `automaticPolicy`, and the validated executable set once at
startup. Config reload, settings import, and workspace switching reapply those
startup-owned values; only the timing pair remains mutable through the
dedicated timing endpoint. A full-config update rejects a changed idle-suspend
block and preserves it when omitted.
The status endpoint intentionally does not expose the matcher list or policy
selector's private executable entries. Observation uses private PTY root identity,
raw-read, accepted-input, bounded-snapshot, and invalidation evidence, combined with
private bounded process discovery and retained attribution through `ProcessSource`,
private owned TCP byte observation, and per-socket baseline comparison. A dedicated
transactional sampler and manager-locked final admission evaluate these seams. See
[Configured-Agent Process Discovery](../agent-activity-process-discovery.md),
[Owned TCP Byte Observation](../tcp-activity-observation.md), and [Agent Activity
Automatic Admission](../agent-activity-automatic-admission.md).

The public `activity` object is diagnostic status, not a process inventory or
authorization token. It is null for `empty-fleet` and present for
`agent-activity`; unavailable measurement fails closed and cannot arm automatic
suspend.
The browser consumes this DTO through `decodeIdleSuspendStatusV1` in
`packages/ui/src/api/client.ts`, which validates the complete v1 base shape and
the additive policy/activity relationship before the React Query boundary.
An otherwise valid old-server payload is normalized only when both additive
properties are absent; partial omission, malformed values, and rejected
transport/auth requests remain errors. See the [Protected Idle-Suspend Status
and Browser UI](../idle-suspend-status-ui.md) guide for decoder, UI, warning,
countdown, and manual-force semantics.

#### GET /api/system/idle-suspend/v1/status

Returns the immutable authoritative `IdleSuspendStatusV1` snapshot.

- **Auth**: Protected route (requires valid session cookie or Bearer token).
- **Headers**: `Cache-Control: no-store`.
- **Response**:
  - `version`: integer (always 1)
  - `statusRevision`: integer (monotonic revision)
  - `state`: enum (`"disabled"`, `"watching"`, `"armed"`, `"finalCheck"`, `"handedOff"`, `"suppressed"`, `"failed"`, `"resumed"`)
  - `enabled`: boolean (operator startup policy)
  - `automaticPolicy`: required enum (`"empty-fleet"` or `"agent-activity"`)
  - `activity`: nullable activity status; null for `empty-fleet`, otherwise:
    - `measurementState`: enum (`"initializing"`, `"available"`, or `"unavailable"`)
    - `reasonCode`: optional closed activity reason enum:
      - `"recentInput"`: Accepted terminal input reset quiet globally
      - `"recentOutput"`: Raw bytes arrived in an agent-owned or mixed terminal
      - `"recentNetwork"`: Attributable TCP4/TCP6 socket byte activity observed
      - `"agentChanged"`: Relevant process identity or socket baseline changed
      - `"lifecycleBusy"`: PTY create, restart, dispose, close, or handoff in progress
      - `"quiet"`: Complete heuristic sample, no recent qualifying activity
      - `"procAccess"`: Required proc identity or ownership is inaccessible
      - `"scanLimit"`: A hard observation bound was reached
      - `"scanTimeout"`: Sample preparation exceeded the one-second deadline
      - `"socketDiagnostics"`: TCP socket diagnostics or counters are incomplete
      - `"unsupportedTransport"`: An attributable UDP or QUIC socket was detected
      - `"namespaceMismatch"`: Process/socket ownership crosses the current network namespace
      - `"staleObservation"`: The sample exceeded its accepted age or was invalidated
      - `"identityUncertain"`: PID/incarnation/start_ticks attribution cannot be proven
      - `"counterOverflow"`: A monotonic observation counter saturated
      - `"reconciling"`: Resume or handoff outcome baseline rebuild is in progress
      - `"epochSpent"`: Genuine-activity epoch already attempted; awaits new activity
    - `recognizedAgentCount`: optional integer (nullable; null represents unknown, not zero)
    - `monitoredTerminalCount`: optional integer (nullable; null represents unknown, not zero)
    - `sampledAtMs`: optional epoch ms display timestamp (display-only wall clock; scheduling uses monotonic clocks)
    - `lastActivityAtMs`: optional epoch ms display timestamp (display-only wall clock)
    - `networkCoverage`: string, currently `"tcp4-tcp6"` (names the only measured transport; not proof of complete networking or non-TCP protocols)
    - `measurementWarning`: `null` when `measurementState` is `"available"`; required object when `"initializing"` or `"unavailable"`:
      - `reasonCode`: closed warning reason enum:
        - `"procAccess"`: Required proc identity or ownership inaccessible
        - `"scanLimit"`: Hard bound reached (256 roots, 8,192 scanned procs, 1,024 relevant procs, 4,096 FDs, 8,192 socket inodes)
        - `"scanTimeout"`: Sample preparation exceeded 1-second deadline
        - `"socketDiagnostics"`: Netlink socket diagnostics or counters incomplete
        - `"unsupportedTransport"`: Attributable UDP or QUIC socket detected
        - `"namespaceMismatch"`: Process/socket ownership crosses current network namespace
        - `"staleObservation"`: Sample exceeded accepted age (5s) or invalidated by concurrent PTY write
        - `"identityUncertain"`: PID/incarnation/start_ticks attribution cannot be proven
        - `"counterOverflow"`: Saturating monotonic counters overflowed
        - `"reconciling"`: System resume or handoff outcome baseline rebuild in progress
      - `blockedSinceMs`: non-negative integer (epoch ms display timestamp of the single continuous blocked interval; unchanged across cause/PID changes until full available recovery)
      - `processes`: array of up to 32 current attributable process records sorted in strictly ascending positive PID order:
        - `pid`: positive integer
        - `executableIdentity`: string (up to 256 UTF-8 bytes without controls; safe executable basename or configured path; null if unknown)
      - `processesTruncated`: boolean (true if additional attributable processes exist beyond the 32-entry cap or shared owners were omitted)
    - **Privacy and Data Exclusions**: Protected status GET is the only interface exposing warning PID and safe executable identity. It never exposes command-line arguments, environment variables, full matcher lists, terminal/session/root/start IDs, socket addresses/ports/inodes, terminal output bytes, tokens, or raw kernel diagnostics. Server/helper logs, JSONL audit trails, and WebSocket notifications strictly exclude warning process details.
    - **Client Normalization & Old-Server Fallback**: A client receiving a valid v1 response with both `automaticPolicy` and `activity` absent normalizes them to `automaticPolicy: "empty-fleet"` and `activity: null`. Any partial omission, malformed enum, out-of-domain number, or policy/activity mismatch is rejected as a decode error.
  - `timingMutable`: boolean (`true` when enabled and not currently handed off)
  - `timingMutableReason`: optional string (e.g. `"disabled"`, `"handoffInProgress"`)
  - `capabilityCode`: string (e.g. `"unavailable"`, `"fake"`, `"systemd"`)
  - `currentEpoch`: integer (idle epoch counter)
  - `quietPeriodSeconds`: integer (active quiet period duration)
  - `wakeAfterSeconds`: integer (active scheduled RTC wake timer duration)
  - `minQuietPeriodSeconds`: integer (approved lower bound, 60)
  - `maxQuietPeriodSeconds`: integer (approved upper bound, 86400)
  - `minWakeAfterSeconds`: integer (approved lower bound, 60)
  - `maxWakeAfterSeconds`: integer (approved upper bound, 86400)
  - `fleetSnapshot`: content-free counts (`liveCount`, `creatingCount`, `restartPendingCount`, `generation`, `quiescent`, `disposing`, `handoffActive`)
  - `armDeadlineMs`: optional integer (epoch timestamp when armed grace period expires)
  - `lastOutcome`: optional typed outcome object
  - `detail`: optional string
  - `timestampMs`: integer

#### PATCH /api/system/idle-suspend/v1/timing

Protected, atomic timing pair mutation endpoint. Accepts only the complete bounded quiet/wake pair from an authenticated, enabled operator account with database authentication.

- **Auth**: Requires valid session cookie or Bearer token; rejected under `--no-auth` (`403 idleSuspendTimingDisabledNoAuth`) and without database authentication (`503 authenticationUnavailable`).
- **Guards**: Requires `Content-Type: application/json` (`415 invalidContentType`); cookie-only requests enforce origin allowlist / same-origin check (`403 invalidOrigin`). Requests presenting `Authorization: Bearer` are exempt from cookie CSRF constraints even when ambient cookies are present. Request body limited to 16 KB.
- **Body**:
  ```json
  {
    "quietPeriodSeconds": 300,
    "wakeAfterSeconds": 600
  }
  ```
- **Responses**:
  - `200 OK`: Returns `IdleSuspendTimingPatchResponse` (`{ "version": 1, "changed": bool, "statusRevision": int, "quietPeriodSeconds": int, "wakeAfterSeconds": int }`).
  - `400 Bad Request`: Validation failure (`invalidIdleSuspendTiming`).
  - `409 Conflict`: Returned when helper handoff is actively in progress (`idleSuspendHandoffInProgress`). Performs zero memory or disk mutation; clients and UI do NOT auto-retry until resume/failure reconciliation.
  - `503 Service Unavailable`: Subsystem, authentication, or persistence unavailable (`authenticationUnavailable`, `idleSuspendTimingUnavailable`, `idleSuspendTimingAuditUnavailable`, `idleSuspendTimingPersistenceUnavailable`).

#### POST `/api/system/idle-suspend/v1/force-suspend`

Initiates one authenticated manual force-suspend handoff. The endpoint admits
the request to the coordinator; it does not wait for the host to suspend or
resume.

- **Auth**: Protected route. Requires a valid session cookie or Bearer token,
  database-backed authentication, and an enabled actor account. Requests are
  rejected under `--no-auth` (`403 idleSuspendDisabledNoAuth`) or when
  authentication is unavailable (`503 authenticationUnavailable`).
- **Guards**: Requires `Content-Type: application/json` (`415
invalidContentType`) and a request body no larger than 16 KiB. Cookie-only
  requests must contain exactly one parseable `Origin`, matching either an
  exact configured CORS origin (`DAM_HOPPER_CORS_ORIGINS`) or strict
  same-origin (`http(s)://Host`); missing, duplicate, malformed, foreign,
  path-bearing, query-bearing, or userinfo-bearing origins return `403
invalidOrigin`. Callers presenting a valid `Authorization: Bearer` token
  are exempt from cookie CSRF origin checks even when ambient cookies are
  attached.
- **Body**: Strict camelCase JSON; both fields are required and unknown fields
  are rejected:
  ```json
  {
    "wakeAfterSeconds": 0,
    "force": false
  }
  ```
  `wakeAfterSeconds` is exactly `0` (indefinite sleep) or an integer in
  `60..=86400` seconds. `force` is boolean. The `force` flag bypasses only
  active-fleet quiescence confirmation; it does not bypass authentication,
  generation, handoff, audit, capability, inhibitor, peer, or RTC checks.
- **`202 Accepted`**: Returned after the coordinator accepts the audited
  handoff admission:
  ```json
  {
    "version": 1,
    "requestId": "123e4567-e89b-42d3-a456-426614174000",
    "statusRevision": 10,
    "state": "handedOff",
    "wakeAfterSeconds": 0,
    "forced": false,
    "fleetSnapshot": {
      "generation": 42,
      "liveCount": 0,
      "creatingCount": 0,
      "restartPendingCount": 0,
      "disposing": false,
      "closing": false,
      "handoffActive": true
    }
  }
  ```
  `requestId` and `statusRevision` identify the accepted handoff. The
  response is not proof that suspend or resume completed.
- **`409 Conflict`**: Every conflict uses `Cache-Control: no-store`.
  - `idleSuspendActiveFleetConfirmationRequired`: `force` was `false` while
    the authoritative fleet was active. The body includes
    `activeSessionCount` and a content-free `fleetSnapshot`.
  - `idleSuspendFleetChanged`: the reviewed fleet generation changed before
    claim. The body includes the latest `activeSessionCount` and
    `fleetSnapshot`; the client must require a new explicit confirmation.
  - `idleSuspendHandoffInProgress`: another automatic or manual handoff is
    active. This uses the standard `{ "error", "code" }` error shape.
- **Other errors**: Closed `{ "error", "code" }` responses cover invalid
  payloads (`400 invalidForceSuspendPayload`), missing/disabled authentication
  (`401 unauthorized`, `403 actorDisabled`), coordinator/audit/capability
  failures (`503`), and shutdown/disabled states. Error text is sanitized and
  never includes helper, host, terminal, or credential details.
- **Caching and retry**: Accepted and error responses always set
  `Cache-Control: no-store`; the endpoint does not emit `Retry-After`. Clients
  must not retry an ambiguous POST. Reconcile accepted, conflict, and
  post-resume outcomes through the authoritative status GET and
  `host:idleSuspendChanged` revision hint.

The route is registered only under the protected API router; there is no
unauthenticated WebSocket or native bypass.

#### Configured-agent activity qualification boundary (2026-09-11)

The idle-suspend route contract is qualified at three consumer boundaries:

- `server/tests/idle_suspend.rs` covers public-coordinator lifecycle, service-only
  PTY output, accepted-input invalidation, manual/final-check ordering, disabled
  observation, clean shutdown, and the explicit Linux PTY/TCP smoke.
- `server/src/api/tests.rs` covers protected status authentication,
  `Cache-Control: no-store`, policy/activity nullability, initializing and
  disabled warnings, available `measurementWarning: null`, warning bounds, and
  privacy omissions.
- `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` covers
  rendered policy/counts, heuristic notice, warning duration and safe identity,
  truncation, countdown, manual force, and old-server compatibility in Chromium.

The configured-agent activity QA record reports **323 backend/PTY/API
integration tests**, **14/14** boundary checks, **16/16** Chromium tests, and
an ignored Linux observer smoke passing in **0.72s**. Automated tests use fake
suspend outcomes and never invoke the helper, RTC programming, `systemctl
suspend`, `sudo`, or root installation. A real suspend/resume canary remains an
Operations gate.

#### `host:idleSuspendChanged` transport event

Out-of-band revision-only push hint broadcast over a dedicated event channel isolated from terminal output pressure.

- **Payload**:
  ```json
  {
    "version": 1,
    "revision": 42
  }
  ```
- **Behavior**: Client validates `version: 1` and integer `revision`, then invalidates `['system', 'idle-suspend', 'v1', 'status']` query cache. Reconnects and broadcast lag reconcile automatically via REST status GET.
- **Post-Resume Reconciliation**: Following a suspend/resume cycle or execution failure, the coordinator refreshes capabilities and authoritative status revision, publishes `host:idleSuspendChanged`, and releases the handoff lock. Clients recover authoritative state on next fetch with no duplicate suspend attempt while the fleet remains empty.

#### Helper execution contract

The enrolled Unix-socket helper accepts protocol version `1` frames with a
required camelCase `requestId` and `wakeAfterSeconds` field. Frames use a
4-byte length prefix and are capped at 4 KiB; unknown JSON fields are rejected.
The execution domain accepts exactly `0` or `60..=86400` seconds. The `0`
sentinel means indefinite sleep and is not valid in the automatic timing pair
returned by status or accepted by `PATCH /api/system/idle-suspend/v1/timing`.

For `wakeAfterSeconds: 0`, the helper converts the value to clear-only mode:
it clears `/sys/class/rtc/rtc0/wakealarm`, reads back the clear, and skips
target-epoch arithmetic and writes. A nonzero request clears and verifies,
computes a checked `now + seconds`, writes the target epoch, and verifies the
readback. The helper rejects any unexpected non-empty pre-existing alarm as
`RtcAlarmBusy`; clear/readback/write, capability, inhibitor, peer, dedupe, and
audit-intent failures return a typed failure and do not invoke suspend.

The helper records `wakeAfterSeconds: 0` in both intent and completion audit
records. These details are internal to the enrolled helper and are not exposed
as a browser-selectable path, device, command, suspend mode, or absolute time.

#### Helper audit v2 (internal diagnostics)

The helper keeps one audit file at
`/var/log/dam-hopper/idle-suspend-helper.jsonl`; this is not a REST, WebSocket,
or browser payload. `HELPER_AUDIT_SCHEMA_VERSION` is independently `2`.
Existing `acceptedIntent`, `executionCompleted`, and `executionRejected`
records retain their established fields, while legacy lines without an
explicit version remain readable as v1.

Newly emitted lines carry `auditSchemaVersion`, `timestampMs`, boot and
producer identity, checked `producerSequence`, safely available UUID
`correlationId`, numeric peer PID/UID, applicable wake seconds, and closed
`reasonCode`/`outcomeCode` values. Additive record types are
`requestRejected`, `capabilityResult`, `preflightResult`,
`rtcProgrammingResult`, and `suspendInvoked`. Capability probes and
authentication/frame failures have null correlation when no validated action
request ID exists; no request ID is fabricated. Restricted legacy `detail` is
source-only and is not copied into diagnostic bundles.

For an accepted request whose RTC programming succeeds, the ordered evidence is
preflight, synchronized `acceptedIntent`, RTC programming result,
`suspendInvoked`, and actual `executionCompleted` outcome. A failed RTC
programming path has the RTC result and completion but no suspend invocation.
Only `acceptedIntent` sync failure blocks RTC or suspend; later milestone write
failures are evidence gaps and cannot replace the backend result. The helper
audit is capped at 10,000 records. Overflow
pruning retains the newest half via an exclusive mode-`0600` no-follow
temporary file, syncs file and parent directory before atomic replacement, and
removes the temporary file on failure.

### Deferred remediation backlog

General host remediation (re-authenticated cache dropping, process control,
generic privileged actions, and their future APIs) is not part of this release.
The fixed idle-suspend helper is a separate enrolled boundary documented above;
it does not make generic host mutation available. Inert fail-closed scaffolding
must not be treated as a client contract.

Server tuning is configured in TOML under `[server.host_resources]` using
snake_case keys: `light_sample_seconds` (5), `process_sample_seconds` (15),
`pss_sample_seconds` (60), `jitter_millis` (250),
`process_deadline_millis` (150), `snapshot_deadline_millis` (500),
`ring_capacity` (144), `max_alert_incidents` (50),
`reclaimable_cache_percent` (25), `available_warning_percent` (15),
`available_critical_percent` (10), `available_oom_percent` (5),
`psi_some_percent` (10), and `psi_full_percent` (1). Values are clamped to
safe ranges at runtime. The 500 ms `snapshot_deadline_millis` is a wait
deadline, not a blocking syscall or CPU bound; process deadline defaults to
150 ms.
Automated validation covered Rust format/check/tests, vendored server tests, UI
unit/type/browser tests, lint, web/server builds, and a `linux/amd64` Docker
build. The no-tunnel container shutdown measurement is not a claim about active
tunnel teardown. Windows CI, canary-host profiling, staged
monitor/in-app-alert canary, and rollback rehearsal remain deferred post-release
items; none of those checks is passed evidence.


