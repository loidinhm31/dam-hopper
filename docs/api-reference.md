# API Reference

Base URL depends on deployment: Docker/direct legacy defaults to `http://localhost:4800`; systemd production is backend-only on `http://localhost:4801` with the UI hosted separately.

## Authentication

REST requests generally use a Bearer token:

```
Authorization: Bearer {token}
```

The server also accepts an HttpOnly SameSite=Strict authentication cookie. `GET
/api/health` and authentication endpoints have public/flow-specific exceptions;
consult each route group below rather than assuming every request is protected.

Token stored at `~/.config/dam-hopper/server-token`.

### Dev Mode (--no-auth)

The server supports a `--no-auth` authentication bypass mode for development. It
is unsafe on public networks and is rejected when MongoDB is configured or the
runtime environment is production. Public health/auth flow behavior and WS
origin/token policy still apply; do not infer response fields not shown by the
handler.

### Auth Endpoints

**POST /api/auth/login**
Authenticate and receive auth token.

Body (normal mode):

```json
{ "username": "user", "password": "pass" }
```

Body (--no-auth mode):

```json
{}
```

Response:

```json
{
  "ok": true,
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "dev_mode": false
}
```

**GET /api/auth/status**
Check authentication status.

Response (authenticated):

```json
{
  "authenticated": true,
  "user": "username",
  "dev_mode": false
}
```

Response (--no-auth mode):

```json
{
  "authenticated": true,
  "user": "dev-user",
  "dev_mode": true
}
```

**POST /api/auth/logout**
Clear authentication session.

Response: `{ "ok": true }`

## Workflow Tracking Service and REST API (Phase 03)

Workflow routes are protected by the normal `/api/*` authentication layer and
share the configured SQLite session database. The route group covers:

- `GET /api/workflow/overview`
- `GET /api/workflow/events`
- `POST /api/workflow/items`; `PATCH /api/workflow/items/{id}`; `DELETE /api/workflow/items/{id}`
- `POST /api/workflow/sessions`
- `POST /api/workflow/sessions/{id}/end`; `POST /api/workflow/sessions/{id}/abandon`
- `POST /api/workflow/sessions/{id}/links`; `DELETE /api/workflow/sessions/{id}/links`
- `POST /api/workflow/notes`; `DELETE /api/workflow/notes/{id}`
- `DELETE /api/workflow/history`

Requests use strict camelCase DTOs, UUID `requestId` replay keys, and
RFC3339 timestamps. Item and note/link deletes plus item updates use
optimistic `updatedAt` CAS. Terminal links are checked against the live PTY's
project, registered worktree, and incarnation. Agent links accept only the
bounded manual `harnessLabel` (64 characters) and `runId` (128 characters).
See the dedicated [Workflow API reference](./workflow-api.md) for complete
request/response fields, target rules, lifecycle states, retention, and
examples.

Phase 03 lifecycle facts stay on a server-internal bounded observation path:
the PTY manager uses `try_send` into `sync_channel(256)`, and a worker applies
allowlisted link-state updates in SQLite. The payload excludes command lines,
arguments, CWD, environment, prompts, and terminal output. There is no generic
observation-ingestion endpoint. `attached`, `stale`, `exited`, `crashed`, and
`detached` are observed terminal-link states; an observation can suggest an end
time but cannot end or abandon the manual workflow session.

## Frontend Diagnostics Snapshot (Phase 01)

Phase 01 adds a client-side diagnostics ring for local troubleshooting. It is written by the browser host before app render and stored in `localStorage` only.

**Storage key:** `damhopper_diagnostics_frontend_v1`

**Captured signals:**

- shared logger entries delivered through logger sink fanout
- browser `error` events
- browser `unhandledrejection` events
- React error boundary failures
- route changes
- WebSocket transport status changes

**Retention / cap behavior:**

- entries are kept in a bounded ring buffer
- old entries are dropped by age first, then by count
- storage usage is capped at a small fixed budget
- if browser storage is unavailable or full, capture degrades to memory-only best effort

This phase does not expose a backend export endpoint yet.

## Browser Debug Artifacts (Phase 2; Phase 6 hardened)

Authenticated, ephemeral storage for a browser-debug selection and optional screenshot. Artifacts are scoped to a live PTY terminal; no read or list endpoint exists.

**POST /api/browser-debug/artifacts**

Bearer token required. JSON body is limited to 64 KiB and uses camelCase:

```json
{
  "terminalId": "pty-uuid",
  "selection": {
    "version": 1,
    "tag": "button",
    "role": "button",
    "accessibleName": "Save",
    "text": "Save",
    "attributes": { "data-testid": "save" },
    "locator": "button[data-testid=save]",
    "bounds": { "x": 10, "y": 20, "width": 80, "height": 32 }
  }
}
```

`terminalId` must identify a live PTY. Selection structure and bounded fields are validated. Response: `201` with `artifactId`, `terminalId`, `expiresAt`, generated `jsonPath`, `jsonSize`, and `jsonSha256`.

**PUT /api/browser-debug/artifacts/{id}/png**

Bearer token required; `Content-Type: image/png`; body limited to 4 MiB. Structural PNG checks and decoded-image verification must both pass. Response adds generated `pngPath`, `pngSize`, and `pngSha256`. One PNG upload per artifact.

**DELETE /api/browser-debug/artifacts/{id}**

Bearer token required. Deletes files and returns `204 No Content`.

Artifacts expire after 10 minutes, are swept every 60 seconds, and are removed during graceful shutdown. Paths are generated under a temporary browser-debug root; files are not readable through this API.

**POST /api/browser-debug/artifacts/{id}/handoff**

Bearer token required. The artifact must be unexpired, not already claimed,
and its original PTY must still be alive. The server writes one bounded,
control-free reference containing only its generated JSON/PNG paths to that
PTY and returns `{ "inserted": true }`. This endpoint is one-time and does
not append a carriage return or submit the shell command. A failed write
releases the claim for retry; a concurrent or completed handoff returns
`409 Conflict`. Expired, unknown, deleted, or dead-terminal artifacts return
the existing safe not-found response.

### Browser tool host policy (Phase 3)

The UI Browser tool embeds a development target directly and uses the
DamHopper Browser Debug extension for DOM selection; the target app does not
need to install a package or script. The target URL must use HTTP `localhost`,
`127.0.0.1`, or `[::1]`, or an origin belonging to a tunnel whose status is
currently `ready`. Paths, query strings, and hashes are allowed inside that
approved origin; workspace-origin targets, credentials, unready tunnels, and
stale tunnel URLs are rejected before navigation. `X-Frame-Options` or restrictive
`Content-Security-Policy: frame-ancestors` can still prevent embedding.

The host keeps one iframe alive while Browser is moved between IDE, Terminal,
and compact surfaces. Extension messages are accepted only when their source,
exact target origin, nonce, and request ID match the current handshake; a
redirected or opaque-origin frame is rejected. A failed or timed-out handshake
keeps the iframe visible and presents a client-browser extension setup action.
The extension accepts the first handshake only from loopback DamHopper parents
or exact parent origins compiled with
`VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`; the presence marker is not an
authorization signal.

The native Tauri host uses the same Browser UI contract through a labeled child
WebView rather than the browser extension flow. Rust owns its lifecycle and
main-only commands, restricts targets to loopback or ready HTTPS tunnel origins,
and rejects stale relays using the child label, committed origin, navigation
generation, nonce, request ID, bounded schema, and message size. Native profile
storage is isolated below application data using a hash of the opaque server
profile ID; URLs, credentials, tokens, and workspace paths are not used as
storage identifiers. The native path does not require `chrome://extensions`
setup.

Screen capture is optional and remains browser-local until handoff. It requires
an explicit user gesture, accepts only a browser-tab surface, and stops tracks
when Browser closes or selection changes. Permission denial, unsupported capture,
wrong-surface selection, coordinate changes, or crop failure preserve the
semantic selection and offer manual image input instead.

## Backend Diagnostics Export (Phase 04)

Protected local export for backend diagnostics. The endpoint reads from the local JSONL store and does not upload data anywhere. The UI entry point is Settings > Maintenance > Export Diagnostics.

This browser-facing export is separate from the production idle-suspend
diagnostics contract. The canonical server event writer and Phase 03
coordinator emission are internal producer paths; they add no REST/WebSocket
route and are not included in this export. The one-shot `diagnose --json`
collector remains planned in the
[diagnostics plan](../plans/260912-0027-production-idle-suspend-diagnostics/plan.md).

Request and response payloads use camelCase on the wire. The request accepts `frontend` and also the legacy `frontendSnapshot` alias.

**POST /api/diagnostics/export**

Auth: Bearer token required.

Default request body used by the UI:

```json
{
  "windowMinutes": 60,
  "includeTerminalOutput": true,
  "terminalTailBytes": 65536,
  "frontend": {
    "manifest": { "schemaVersion": 1 },
    "logs": [],
    "browserErrors": [],
    "currentRoute": null,
    "profile": null,
    "transportStatus": null
  }
}
```

Request fields:

- `windowMinutes` - requested lookback window; UI defaults to 60 minutes and the server clamps to 60 minutes max
- `includeTerminalOutput` - request terminal data in export; UI defaults to `true`
- `terminalTailBytes` - requested tail size; UI defaults to `65536`
- `terminalIds` - optional terminal session filter; `terminals.sessions` and `terminals.tails` are scoped to these ids when present
- `frontend` - canonical frontend snapshot payload from the browser export path
- `frontendSnapshot` - legacy alias accepted by the server for compatibility

Response schema version: `1`

Top-level response sections:

- `diagnosticSchemaVersion`
- `generatedAt`
- `scope`
- `manifest`
- `frontend`
- `backend`
- `terminals`
- `system`

`scope` fields:

- `windowMinutes`
- `includeTerminalOutput`
- `terminalTailBytes`
- `terminalIds`

`manifest` fields:

- `backendEventCount`
- `terminalSessionCount`
- `retentionMinutes`
- `storage` = `localConfigJsonl`
- `droppedPersistEvents`
- `persistErrorCount`

Notes:

- backend events are redacted before persist and export
- retention is 60 minutes
- storage path is `~/.config/dam-hopper/diagnostics/backend-log.jsonl`
- `terminals.tails` contains capped per-session tails when `includeTerminalOutput=true`
- downloads use the filename pattern `dam-hopper-diagnostics-{timestamp}.json`
- bundles are generated locally and downloaded by the browser; there is no server-side bundle archive
- terminal tails can still contain sensitive local/dev output even after best-effort redaction; review before sharing the exported JSON
- when `terminalIds` is provided, backend events with `sessionId` are scoped to those ids while global events remain included
- **Phase 04:** `system` field contains host metrics sampled from the config directory (`~/.config/dam-hopper/` by default) for host-context only, not project sandboxes

### Host resource snapshot and alerts

Phase 03 exposes the read-only `HostResourceSnapshotV1` contract through
protected routes. Snapshots use camelCase fields and section-level
availability states (`available`, `unsupported`, `permissionDenied`,
`temporarilyUnavailable`, or `stale`) with optional detail codes. Text reads are
bounded by actual bytes (256 KiB per file); cgroup v2 PSI/limits and process
inventory report explicit degradation plus bounded scan/deadline and issue
counters. Cache attribution labels are descriptive and may overlap, so clients
must not add them as an accounting total. The existing `GET /api/system/metrics`
response remains compatible and is served from the monitor's cached projection.

The current UI is monitoring-only. It displays the snapshot, bounded alert
history, and diagnostic evidence; it does not offer remediation controls. REST
responses remain authoritative after reconnect, missed events, profile changes,
or malformed push data. If the deep snapshot is unavailable, the diagnosis
popover retains CPU and disk from the compatible metrics endpoint and labels the
deep data unavailable; it never fabricates a zero value. Cgroup v1 is reported
as unsupported; constrained Linux and containers report per-section
availability and scope rather than host-wide failure.

#### GET /api/system/resources/v1/snapshot

Returns the latest bounded deep host snapshot. Sampling cadence and source roots
are server-owned; incomplete cycles are represented as stale or degraded
availability rather than fabricated values. The legacy memory `alert` object is
unchanged. The additive `currentAlerts` array contains active thermal or disk
incidents and is always present on current servers, including as `[]` when none
are active. Clients interoperating with an older server must tolerate an absent
`currentAlerts` field and must not interpret its absence as recovery.

A resource entry has `kind` (`temperature` or `disk`), `key`, `state`
(`temperatureHigh` or `diskFull`), severity, incident/timing fields, scope,
threshold, next action, and bounded evidence. Temperature evidence has source
and Celsius value (with optional label); disk evidence has mount point and usage
percentage (with optional name). `currentAlerts` is a bounded concurrent set,
not a replacement for the legacy memory alert.

#### GET /api/system/resources/v1/alerts

Returns a bounded mixed history of legacy memory and thermal/disk incidents,
newest first by `updatedAt`. Optional `limit` is clamped by the server (default
50). Memory incidents retain their existing confidence/evidence contract;
resource incidents use the resource shape above and include `resolvedAt` only
after recovery. A zero `resolvedAt` is a valid recovery timestamp. This endpoint
reports evidence only and performs no remediation.

#### `host:alertChanged` transport event

The existing event name and legacy memory payload remain compatible. An additive
thermal/disk payload uses the resource shape above; recovery is represented by
`resolvedAt`. The client accepts either payload only after strictly validating
finite non-negative timestamps, allowed kind/state/severity,
bounded required text, and the exact evidence fields for that kind. Invalid or
unknown evidence is discarded without updating cached resource state.

A valid resource event merges or replaces only its `incidentId` in the cached
`currentAlerts`; an event with `resolvedAt` removes only that incident. The
client then invalidates snapshot and history queries. An explicit
`currentAlerts: []` from the authoritative snapshot clears retained resource
incidents, while an omitted additive field preserves them for old-server
compatibility until REST establishes current state.

### Terminal idle suspend

Server-authoritative, fail-closed terminal idle suspend subsystem with protected
status, bounded authenticated timing settings, an authenticated manual
force-suspend action, and out-of-band push hints. Automatic idle timing and the
manual action remain separate: a manual request does not change the persisted
automatic policy.

### Phase 01 policy/configuration contract

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
selector's private executable entries. Phase 02 adds private PTY root identity,
raw-read, accepted-input, bounded-snapshot, and invalidation evidence. Phase 03
adds private bounded process discovery and retained attribution through
`ProcessSource`; Phase 04 adds private owned TCP byte observation and per-socket
baseline comparison. Phase 05 combines those seams through a dedicated
transactional sampler and manager-locked final admission. See [Configured-Agent
Process Discovery](./agent-activity-process-discovery.md), [Owned TCP Byte
Observation](./tcp-activity-observation.md), and [Agent Activity Automatic
Admission](./agent-activity-automatic-admission.md).

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
and Browser UI](./idle-suspend-status-ui.md) guide for decoder, UI, warning,
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
    "requestId": "req-abc-123",
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

#### Phase 07 qualification boundary

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

The Phase 07 QA record reports **323 backend/PTY/API/integration tests**,
**14/14** boundary checks, **16/16** Chromium tests, and an ignored Linux
observer smoke passing in **0.72s**. Automated tests use fake suspend outcomes
and never invoke the helper, RTC programming, `systemctl suspend`, `sudo`, or
root installation. A real suspend/resume canary remains an Operations gate.

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

#### Phase 01 helper execution contract

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
#### Phase 04 helper audit v2 (internal diagnostics)

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
safe ranges at runtime.

Phase 07 validation covered Rust format/check/tests, vendored server tests, UI
unit/type/browser tests, lint, web/server builds, and a `linux/amd64` Docker
build. The no-tunnel container shutdown measurement is not a claim about active
tunnel teardown. The release owner approved Phase 07 completion with the
still-unobserved Windows CI result, canary-host profiling, staged
monitor/in-app-alert canary, and rollback rehearsal deferred as post-release
work; none of those checks is passed evidence.

## Codex Usage Analytics

Protected, aggregate-only analytics for the local Codex telemetry store. All routes require
the same Bearer token as other `/api/*` routes; raw prompts, responses, commands, tool content,
event rows, bearer tokens, and storage identifiers are never returned. The UI calls these through
`WsTransport` methods
`usage:summary`, `usage:sessions`, `usage:session`, `usage:health`, `usage:settings`,
`usage:setupStatus`, `usage:updateSettings`, `usage:configure`, and `usage:deleteAll`, which map to the
REST routes below.

### GET /api/usage/summary

Returns Codex token totals and bounded UTC time buckets. Query parameters use camelCase:
`from`/`to` (UTC milliseconds) or `window` (`24h`, `7d`, `30d`), `bucket` (`hour` or `day`), and
optional `model`. Explicit ranges must be positive and contain at most 1,000 buckets; hour ranges
are capped at 90 days and day ranges at five years. Removed terminal, project, shell,
capture-quality, category, and agent filters are rejected, including unknown query keys.

The optional `model` filter accepts 1–64 safe ASCII characters, starts and ends with an
alphanumeric character, and may contain `.`, `_`, `-`, `/`, or `:`.

The response contains `range`, nullable `codex` totals, nullable `timeSeries` buckets, and
`health`. Unavailable or paused telemetry is represented by state and nullable projections rather
than fabricated zero-valued usage.

### GET /api/usage/health

Returns telemetry availability, paused state, writer errors, rejected events, the sampling
timestamp, and bounded Codex collector counters. Collector status is reported separately from
usage totals so an unavailable receiver cannot be mistaken for no activity.
The collector counters include the legacy aggregate `dropped` total plus additive
`droppedMissingIdentity`, `droppedInvalidTimestamp`, `droppedPaused`, `droppedQueueFull`, and
`droppedWorkerUnavailable` totals. These are fixed-cardinality in-memory counters, contain no
source values or payload fragments, and reset when the server process restarts.
`droppedMissingIdentity` is retained for compatibility with older collector behavior and remains
zero when the bounded fallback is active.
Codex CLI 0.146.1 token-bearing `response.completed` records without trace/span identity use a
bounded domain-separated HMAC fallback over normalized decoded fields and remain `unverified`.
When a valid trace/span identity is present, it takes precedence over the fallback.
The fallback is stable for replay but may dedupe identical same-millisecond decoded events. Invalid
timestamps still fail closed. The fixed health counters above are the only additive diagnostic
fields; no raw identity, content, or new Codex event/SQLite field is exposed.

### GET/PATCH /api/usage/settings

Reads or updates `enabled`, `paused`, `detailRetentionDays`, `aggregateRetentionDays`, `collector`,
`codexExporter`, and `retryCollector`. Exporter status is one of `notConfigured`, `managed`, or
`conflict`; bearer material is never returned. Managed files are changed only when their exact
ownership shape matches, and writes are atomic with owner-only (`0600`) secrets.

Runtime transitions and configuration writes are transactional: a failed restart, retention
operation, or registry write restores the prior live state and rejects the update. Collector
changes restart only the loopback listener; managing Codex configuration does not restart Codex.
Removed terminal-correlation and project-exclusion settings are not accepted or serialized.

### GET/PATCH /api/usage/setup

Returns the compact setup status used by Settings > Usage insights: telemetry enabled/paused
state, collector enabled state, runtime/receiver health, and optional local Codex exporter
status. `PATCH` accepts setup fields including `enabled`, `codexExporter`, and `retryCollector`.
It returns status only; bearer material is never returned. The Settings flow uses this route for
live enable/disable, receiver retry, and explicit Codex exporter management.

### GET /api/usage/sessions

Lists flat, aggregate Codex session summaries. Query parameters are `from`, `to`, `model`, `limit`,
and opaque `cursor`. The default range is the most recent 30 days; explicit ranges are capped at
five years. `limit` defaults to 25 and is bounded to 1–100. Cursors are authenticated, opaque,
and scoped to the range and model filter that created them. Removed terminal and lineage filters
are rejected.

The response is `{ range: { from, to }, sessions, nextCursor, paused }`. Each session contains a
derived HMAC `id`, UTC start/end timestamps, an optional model, token components, and bounded model
summaries. No hierarchy, terminal reference, command, or raw event content is exposed.

### GET /api/usage/sessions/{id}

Returns one bounded flat session summary identified by the derived HMAC `id` from the list response.
The response contains `{ session, paused }`; a missing session returns not found. Detail responses
contain only the same Codex token/model projections as the list route.

The shared browser/native Usage page presents these routes as a Sessions tab with list/detail
navigation. It uses `view=sessions`, `session`, and opaque authenticated `cursor` parameters for
deep links. List and detail queries refetch every 15 seconds only while the document is visible;
hidden documents stop polling. Paused collection leaves stored summaries readable and marks
responses as paused; deletion remains an explicit destructive operation.

### Flat Codex session summaries (internal store contract)

Accepted Codex `response.completed` events maintain one flat summary per HMAC session while it is
inside the configured detail-retention window. Summaries are purged with expired detail data; they
are not permanent. Summaries contain safe provider/model/status, nullable token components, and
explicit `delta` or `cumulative` semantics. The session routes above project these summaries into
bounded list/detail responses and never expose the underlying rows.

### DELETE /api/usage

Destructive deletion requires the exact JSON confirmation string
`"delete-usage-data"`. Omitting `from` and `to` deletes all detail, rollups, and health
rows. To delete a range, provide both `from` and `to` as non-negative UTC milliseconds,
strictly increasing and aligned to UTC-day boundaries; ranges are limited to five years.
Capture is paused behind an ordered deletion barrier and the exact live admission state is restored
on success or failure. Full deletion rotates the shared telemetry HMAC key after the rows are
deleted; range deletion keeps it so retained fingerprints remain comparable. The UI must present
an explicit confirmation before calling this route.

## Session Persistence API (Phase 05)

Terminal session buffers and metadata are persisted to SQLite when the configured database can be opened. This supports live cross-device resume and DamHopper server-restart relaunch with recovered scrollback; it does not preserve exact shell/process memory across server or host restart.

### Configuration

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"       # Database path (supports ~)
session_buffer_ttl_hours = 720                       # 30-day retention (default)
```

### How Persistence Works

1. **Automatic**: When session is created, it's recorded to SQLite along with environment
2. **Batched**: Buffer snapshots sent every 16KB during output (throttled)
3. **Final snapshots**: Session exit and graceful server shutdown persist the latest buffer, including output under 16KB
4. **Recoverable**: Up to 1 MB of retained scrollback is replayed on attach
5. **Relaunched**: Sessions alive before DamHopper server shutdown are relaunched on restart

### Affected Endpoints

**GET /api/terminal/list** — Returns:

```json
[
  {
    "id": "uuid",
    "project": "project-name",
    "command": "npm run dev",
    "cwd": "/path",
    "alive": true,
    "exit_code": null,
    "buffer_bytes": 1048576,
    "persisted": true, // Phase 05: new field
    "started_at": 1234567890
  }
]
```

### Storage Details

**Database Schema** (Phase 05):

- `sessions` table — session metadata (id, project, command, env, cols, rows, restart_max_retries, created_at)
- `session_buffers` table — binary buffer data (session_id, data BLOB, total_written, updated_at)

**Storage Efficiency**:

- Batching: Only latest buffer per session written (intermediates discarded)
- Throttling: Every 16KB, not every read (99% fewer allocations)
- Memory: 16MB/sec churn (vs. 256MB/sec unoptimized)

### Worker Thread Architecture

- **Dedicated thread**: `persist-worker` daemon (see logs)
- **Bounded queue**: 256 slots (64MB max capacity)
- **Non-blocking sends**: Failed sends safe to drop (batching semantics)
- **Graceful shutdown**: all pending buffers flushed before process exit

### Monitoring

Track persistence health via logs:

```bash
# Enabled on startup
info: Session persistence enabled (path: ~/.config/dam-hopper/sessions.db)
info: Persist worker thread spawned

# Queue full (rare, indicates slow worker)
warn: Persist queue full, dropping BufferUpdate

# On session exit
info: Flushing session buffer on exit

# On shutdown
info: Persist worker stopped
```

The historical Phase 05 persistence design is retained in this document; its source plan is no longer present in this checkout.

## Git API

Git routes are scoped to the configured project name and run inside the resolved
project path.

When a project is not a Git repository, Git routes that require repository
state return HTTP `409` with the standard error body
`{"error":"Git is not initialized for this project","code":"GIT_NOT_INITIALIZED"}`.
The client preserves this as `ApiRequestError(status, code)` and uses the code
to render an actionable unavailable state; callers should not treat it as an
empty branch list.

### Project worktree targets (Phases 1–7)

Root-sensitive operations use a project target reference:

```json
{ "project": "demo", "worktreePath": "/worktrees/demo-feature" }
```

`worktreePath` may be omitted or `null`; both select the configured project
root for backward-compatible behavior. An explicit path must be absolute and
must resolve to a worktree currently registered by Git for that project. The
server canonicalizes and validates membership against a fresh Git snapshot;
an arbitrary path, a path from another repository, or a removed/recreated
directory is not authorized. The configured root is also validated when sent
explicitly.

For a project nested below the repository root, each worktree target projects
the same relative subdirectory into that worktree. Discovery and resolution
use these fields (serialized in camelCase):

| Field                                                      | Meaning                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `path`                                                     | Selectable project-directory target.                                                            |
| `repositoryPath`                                           | Git worktree root used for worktree mutations.                                                  |
| `branch`, `commitHash`                                     | Worktree revision metadata.                                                                     |
| `isMain`, `isLocked`, `isDetached`, `isBare`, `isPrunable` | Git worktree state.                                                                             |
| `isAvailable`                                              | Whether the projected target directory is a usable directory beneath a live, non-bare worktree. |

Resolved targets additionally expose `configuredRoot`, `targetPath`,
`targetKey`, `isRoot`, and `available`; a root target has `isRoot: true` and
no `worktree` metadata. Discovery results are returned by the worktree list
route as the projected worktree objects above.

Target validation errors use stable codes and statuses:

| Code                            | HTTP | Meaning                                                    |
| ------------------------------- | ---: | ---------------------------------------------------------- |
| `WORKSPACE_PROJECT_NOT_FOUND`   |  404 | Project is not registered.                                 |
| `WORKSPACE_TARGET_UNREGISTERED` |  400 | Explicit path is not a registered Git worktree.            |
| `WORKSPACE_TARGET_INVALID_PATH` |  400 | Path is empty, contains a NUL, or is not absolute.         |
| `WORKSPACE_TARGET_UNAVAILABLE`  |  409 | Registered worktree or projected directory is unavailable. |

**POST /api/git/fetch** and **POST /api/git/pull** accept a project list or
explicit target list. Each explicit target is resolved independently so one
missing or unavailable worktree does not discard results for the other targets.
The response is an array of operation results; target-scoped entries include
`worktreePath`, and a failed entry can include `targetUnavailable: true` when
the server confirmed that target disappeared. Generic request-level failures
are not attributed to every requested target.

### Worktrees

**GET /api/git/{project}/worktrees**
Refresh and return projected worktree metadata. For nested projects,
`path` points at the matching subdirectory while `repositoryPath` remains the
worktree root. A plain non-Git project returns `409` with
`GIT_NOT_INITIALIZED`.

**POST /api/git/{project}/worktrees**
Add a worktree from the configured project repository. Body fields are
`branch` (required), optional `path`, optional `createBranch`, and optional
`baseBranch`:

```json
{
  "branch": "feature/demo",
  "path": "../demo-feature",
  "createBranch": true,
  "baseBranch": "main"
}
```

The response is the projected worktree metadata, including both `path` and
`repositoryPath`; discovery is refreshed after the mutation.

**DELETE /api/git/{project}/worktrees**
Remove one registered non-main worktree. Body: `{ "path": "<target path>" }`.
The path is resolved through the target contract, but Git removal operates on
the corresponding `repositoryPath`. The configured/main worktree cannot be
removed. Successful response: `{ "ok": true }`.

The browser re-fetches discovery immediately before this request. It refuses
to start removal when the exact target owns dirty editor tabs or live terminal
sessions, and explains the blockers in the Project panel. Git still enforces
its own dirty/untracked protection; the user must refresh and retry after
closing or saving those resources. A successful removal invalidates discovery
and falls back new operations to the configured root when the removed target
was selected.

If Git reports a registered path as missing or prunable, the row remains
visible as unavailable. New operations fail closed rather than redirecting to
the root, while the UI selects the root for subsequent operations and keeps
existing editor tabs. Live terminal rows whose `project`/`cwd` still identify
the unavailable target are labelled `orphaned` until the session is closed.
The immutable `worktreePath` marker is authoritative for target-scoped
sessions; `project`/`cwd` containment is used only for legacy sessions without
that marker.

**POST /api/git/{project}/worktrees/prune**
Prune stale Git worktree administrative metadata and invalidate the project’s
cached discovery. Body: `{}`. Successful response: `{ "ok": true }`.

### Branches

**GET /api/git/{project}/branches**
Returns local and remote branches.

Optional query: `root=ID` to scope branch data to one VCS root.

If Git is unavailable, this endpoint returns the `GIT_NOT_INITIALIZED` 409
error described above.

```json
[
  {
    "name": "main",
    "isCurrent": true,
    "isRemote": false,
    "trackingBranch": "origin/main",
    "ahead": 0,
    "behind": 0,
    "lastCommit": "abc123..."
  }
]
```

**GET /api/git/{project}/roots**
Discover VCS roots inside the project. Returns the primary repo root, nested repositories, and submodule gitlinks.

An unavailable project returns the same `GIT_NOT_INITIALIZED` 409 response;
usable nested roots are returned as concrete `rootId` values and can be passed
to branch and diff requests.

Response shape:

```json
[
  {
    "rootId": ".",
    "path": ".",
    "absolutePath": "/abs/path/to/project",
    "kind": "primary",
    "status": { "...": "GitStatus" },
    "warnings": []
  },
  {
    "rootId": "modules/child",
    "path": "modules/child",
    "absolutePath": "/abs/path/to/project/modules/child",
    "kind": "submodule",
    "mappingState": "mapped",
    "gitlink": {
      "path": "modules/child",
      "objectId": "abc123...",
      "moduleName": "child",
      "url": "../child.git"
    },
    "status": { "...": "GitStatus" },
    "warnings": []
  }
]
```

Fields:

- `kind` is `primary`, `submodule`, or `nestedRepo`.
- `mappingState` is only present for submodules and can be `mapped`, `unmapped`, `missing`, or `uninitialized`.
- `gitlink` is only present for submodules.
- `warnings` may include invalid `.gitmodules` or missing/uninitialized gitlink notes.
- `status` reflects the root's own Git status snapshot.

**POST /api/git/{project}/branches**
Create a branch. Set `checkout` to switch to it after creation.

```json
{
  "name": "feature/git-flow",
  "startPoint": "main",
  "checkout": true,
  "root": "modules/child"
}
```

**POST /api/git/{project}/branches/checkout**
Checkout an existing branch, or create one when `create` is true. `strategy` is
`normal`, `stash`, or `force`.

```json
{
  "branch": "feature/git-flow",
  "startPoint": "origin/main",
  "create": false,
  "strategy": "normal",
  "root": "modules/child"
}
```

**POST /api/git/{project}/branches/update**
Update a branch from its tracking branch.

```json
{ "branch": "main", "root": "modules/child" }
```

### History Actions

**POST /api/git/{project}/cherry-pick**
Apply a commit to the current branch.

```json
{ "hash": "abc123def456" }
```

**POST /api/git/{project}/reset**
Reset to a commit. `mode` is `soft`, `mixed`, `hard`, or `keep`.

```json
{ "hash": "abc123def456", "mode": "mixed" }
```

**POST /api/git/{project}/commit/{hash}/drop**
Drop a local, unpushed commit from the current branch history. `HEAD` drops use
`git reset --hard <parent>` after preflight checks. Non-HEAD drops use
`git rebase --onto <parent> <hash> <branch>`. Pushed/shared commits are blocked
by default and should use revert. The server refuses to start a rewrite while
a merge, rebase, or cherry-pick is already in progress and returns `recovery`
metadata for the active operation.

**GET /api/git/{project}/commit/{hash}/message**
Return the complete commit message, including its body. Use the optional
`root` query parameter to target a nested VCS root.

```json
{ "message": "Subject\n\nDetailed body" }
```

**POST /api/git/{project}/commit/{hash}/message**
Edit the message of any unpushed commit reachable from the checked-out branch.
The JSON body accepts `message` and optional `root`. Empty messages, dirty
worktrees, detached HEAD, active Git operations, unreachable commits, and
pushed commits are rejected. Editing `HEAD` amends it in place; editing an
older commit, including a root commit, rewrites that commit and replays its
descendants with merge topology preserved.

```json
{ "message": "New subject\n\nNew body", "root": "modules/child" }
```

**POST /api/git/{project}/commit/{hash}/drop-files**
Drop selected file changes from an unpushed commit while preserving other files
from that commit. This is a local-history rewrite and is blocked for pushed
commits by default.

```json
{ "paths": ["src/main.rs"] }
```

**POST /api/git/{project}/commit/{hash}/revert**
Create a new inverse commit with `git revert <hash>`. This is the default safe
operation for pushed or shared history because it preserves existing commits.

**POST /api/git/{project}/commit/{hash}/revert-files**
Apply the inverse patch for selected files to the working tree without rewriting
history. The resulting file changes are left in the worktree for review and
commit.

```json
{ "paths": ["src/main.rs"] }
```

Branch create, branch checkout, cherry-pick, reset, drop, and revert return
`GitActionResult`:

```json
{
  "ok": true,
  "message": "Checked out feature/git-flow",
  "branch": "feature/git-flow",
  "hash": "abc123def456",
  "stashed": false,
  "conflict": false,
  "dirty": false,
  "destructive": false,
  "recovery": null,
  "blockedReason": null,
  "recommendation": null
}
```

Result flags:

| Field            | Meaning                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`             | `true` when the Git action completed; `false` when Git reported a recoverable state.                                                                  |
| `message`        | Human-readable operation summary or recovery hint.                                                                                                    |
| `branch`         | Branch affected by branch create or checkout actions.                                                                                                 |
| `hash`           | Commit hash affected by cherry-pick or reset actions.                                                                                                 |
| `stashed`        | Checkout used `strategy: "stash"` and created a stash before switching branches.                                                                      |
| `conflict`       | Cherry-pick or reset reached a Git conflict state.                                                                                                    |
| `dirty`          | The operation was blocked by local working tree changes.                                                                                              |
| `destructive`    | The selected mode can discard local state, such as force checkout or hard reset.                                                                      |
| `recovery`       | Active operation metadata when recovery commands are available.                                                                                       |
| `blockedReason`  | Machine-readable block reason such as `active-operation`, `dirty-worktree`, `detached-head`, `pushed-commit`, `unreachable-commit`, or `root-commit`. |
| `recommendation` | User-facing next action for blocked or recoverable operations.                                                                                        |

Recoverable dirty checkout example:

```json
{
  "ok": false,
  "message": "Working tree has local changes",
  "branch": "feature/git-flow",
  "stashed": false,
  "conflict": false,
  "dirty": true,
  "destructive": false
}
```

Blocked pushed-history drop example:

```json
{
  "ok": false,
  "message": "commit abc123def456 is already reachable from upstream",
  "hash": "abc123def456",
  "conflict": false,
  "destructive": false,
  "blockedReason": "pushed-commit",
  "recommendation": "use revert for pushed/shared history"
}
```

Recoverable rebase conflict example:

```json
{
  "ok": false,
  "message": "CONFLICT (content): Merge conflict in README.md",
  "hash": "abc123def456",
  "conflict": true,
  "dirty": true,
  "destructive": true,
  "recovery": {
    "operation": "rebase",
    "canAbort": true,
    "canContinue": true
  },
  "recommendation": "resolve rebase conflicts, then continue or abort"
}
```

Branch update returns `BranchUpdateResult`:

```json
{
  "branch": "feature/git-flow",
  "success": true,
  "reason": null
}
```

Checked-out branch update guard example:

```json
{
  "branch": "main",
  "success": false,
  "reason": "checked-out — use pull instead"
}
```

Invalid branch names, relative paths, and commit hashes are rejected before Git
execution. Rewrite operations preflight active merge/rebase/cherry-pick state,
dirty worktree state, commit reachability, root commits, and pushed/shared
history. Safe operations such as revert remain available for shared history,
while blocked or conflicted operations return structured result flags so clients
can show recovery choices instead of treating every non-clean operation as an
unclassified error. Validation failures use the standard API error shape with a
400 status for invalid input:

```json
{ "error": "Invalid input: invalid branch name" }
```

### Git History Safety Contract

DamHopper follows IntelliJ-style Git semantics: safe operations preserve shared
history, while rewrite operations are restricted to local commits that have not
been pushed upstream. Recovery states are surfaced explicitly so the UI can
offer continue/abort guidance instead of hiding active Git porcelain state.
DamHopper does not expose a published-history rewrite override through `drop`,
`drop-files`, `message`, or `undo-last-commit`. The dedicated push flow only
publishes an already-rewritten branch intentionally: `POST /api/git/push` with
`force: true` updates the configured upstream branch, but it does not relax the
pushed/shared history guards on those local rewrite endpoints.

| Operation          | History effect       | Shared-history behavior                                  |
| ------------------ | -------------------- | -------------------------------------------------------- |
| `revert`           | Adds inverse commit  | Allowed and recommended                                  |
| `revert-files`     | Worktree inverse     | Allowed; selected changes stay uncommitted for review    |
| `drop`             | Rewrites branch      | Blocked for pushed/shared commits; use revert instead    |
| `drop-files`       | Rewrites branch      | Blocked for pushed/shared commits; use revert instead    |
| `message`          | Rewrites commit      | Blocked for pushed/shared commits                        |
| `undo-last-commit` | Rewrites local HEAD  | Blocked for pushed/shared commits; use revert instead    |
| `reset --hard`     | Rewrites local state | Allowed only after explicit request and preflight checks |

Manual verification checklist for browser integrations:

- Modify an open file and discard it from the Git panel; the browser must not
  reload, and the affected editor tab should reconcile with disk.
- Drop a selected file change from an old local commit; branch history and the
  affected file diff should refresh without a full app reset.
- Drop a local non-HEAD commit with descendants; descendants should replay or
  produce a recoverable rebase state.
- Revert a pushed commit in a clone/remote test repo; the UI should route users
  to revert instead of enabling drop.
- Start a conflicting rebase or cherry-pick, then attempt a rewrite; the API
  should return `blockedReason: "active-operation"` and recovery metadata.
- Verify the recovery banner copy in the UI by triggering an active-operation
  block; the banner should mention the active operation and tell the user to
  resolve, continue, or abort.

### Commit

**POST /api/git/{project}/commit**
Create a commit from the index. Set `amend` to replace the current `HEAD`
commit.

```json
{ "message": "Update git controls", "amend": false }
```

Response:

```json
{ "ok": true, "hash": "abc123def456" }
```

### Undo Last Commit

**POST /api/git/{project}/undo-last-commit**
Undo the most recent local commit with `git reset --mixed HEAD~1`. The backend
blocks pushed/shared commits and returns a revert recommendation instead of
rewriting public history. Changes from the undone commit remain as unstaged
local changes.

Response shape follows `GitActionResult`:

```json
{
  "ok": true,
  "message": "Undid last commit abc123d",
  "hash": "abc123def456",
  "conflict": false,
  "dirty": true,
  "destructive": true,
  "recommendation": "changes from the undone commit are now unstaged"
}
```

Blocked pushed-history example:

```json
{
  "ok": false,
  "message": "commit abc123def456 is already reachable from upstream",
  "hash": "abc123def456",
  "conflict": false,
  "destructive": false,
  "blockedReason": "pushed-commit",
  "recommendation": "use revert for pushed/shared history"
}
```

## Reconnection Flow (Phase A feature)

**Location:** `packages/ui/src/api/transport.ts`

The `Transport` interface abstracts WebSocket and REST communication. All frontend modules use `getTransport()` to access the singleton instance.

### Core Methods

**invoke<T>(channel: string, data?: unknown): Promise<T>**
Request/response messaging mapped to REST endpoints.

Example:

```ts
const sessions = await transport.invoke<Array<{ id: string }>>("terminal:list");
const newSession = await transport.invoke<SessionInfo>("terminal:create", {
  project: "api-server",
  worktreePath: "/worktrees/api-feature",
  cwd: ".",
  command: "npm run dev",
  cols: 80,
  rows: 24,
});
```

### Terminal Subscriptions

**onTerminalData(id: string, cb: (data: string) => void): () => void**
Subscribe to PTY output stream. Callback receives chunks of terminal data (plain text or ANSI codes).

Returns unsubscribe function.

**onTerminalExit(id: string, cb: (exitCode: number | null) => void): () => void**
Subscribe to basic PTY exit event.

Returns unsubscribe function.

**onTerminalExitEnhanced?(id: string, cb: (exit: {...}) => void): () => void** (Optional, Phase 5+)
Subscribe to enhanced exit event with restart metadata.

Callback receives:

```ts
{
  exitCode: number | null;
  willRestart: boolean;
  restartIn?: number;       // milliseconds
  restartCount?: number;
  incarnation?: number;    // nonnegative safe integer identifying the PTY incarnation
}
```

Returns unsubscribe function.

The optional `incarnation` lets clients distinguish PTYs when a public session ID is
reused: a client may reject a delayed exit event from an older incarnation. Older
clients may ignore this field and continue handling exits by session ID.

**onProcessRestarted?(id: string, cb: (restart: {...}) => void): () => void** (Optional, Phase 5+)
Subscribe to process restart event.

Callback receives:

```ts
{
  restartCount: number;
  previousExitCode: number | null;
}
```

Returns unsubscribe function.

### Session Attachment (Phase 3)

**terminalAttach?(id: string, fromOffset?: number): void** (Optional)
Fire-and-forget message to request buffer replay from server.

- `id` — Session UUID
- `fromOffset` — Optional byte offset for delta sync (omit for full buffer)

Must call `onTerminalBuffer()` listener BEFORE sending attach request to receive response.

Example:

```ts
// Setup listener first
transport.onTerminalBuffer(sessionId, ({ data, offset }) => {
  term.write(data); // Replay buffered content
  storeOffset(offset); // Save offset for next attach
});

// Then send attach
transport.terminalAttach(sessionId, lastKnownOffset);
```

**onTerminalBuffer?(id: string, cb: (buffer: {data: string; offset: number}) => void): () => void** (Optional, Phase 3+)
Subscribe to buffer replay response from `terminal:attach` request.

Callback receives:

```ts
{
  data: string; // Base64-encoded terminal content
  offset: number; // Current byte offset (incremental counter)
}
```

Use case: On reconnect, request buffered terminal output to show user previous session content.

Returns unsubscribe function.

### Terminal Control

**terminalWrite(id: string, data: string): void**
Fire-and-forget message to send input to PTY stdin.

**terminalResize(id: string, cols: number, rows: number): void**
Fire-and-forget message to resize PTY dimensions.

#### PTY, process, TCP, and automatic admission observation (server-internal Phases 02–05)

The REST and WebSocket terminal contracts do not expose activity snapshots,
root identities, raw-output counters, input revisions, watcher revisions,
process evidence, socket ownership, TCP counters, or diagnostic payloads.
`terminalWrite` remains fire-and-forget: nonempty input passes through the
manager's handoff/closing/disposal/session admission gate, while empty input is
a no-op. Rejected input has no acknowledgement or replay path.

Phase 03 `ProcessDiscovery`/`ProcessSource`, Phase 04
`SocketDiagnosticsSource`/`LinuxSocketDiagnostics`, and Phase 05's sampler and
manager admission are private server seams. Phase 05's only public activity
surface is the bounded `activity` member of
`GET /api/system/idle-suspend/v1/status`; it does not expose an endpoint,
WebSocket message, process arguments, socket details, or raw diagnostics.
See [PTY Activity Observation](./pty-activity-observation.md),
[Configured-Agent Process Discovery](./agent-activity-process-discovery.md),
[Owned TCP Byte Observation](./tcp-activity-observation.md), and [Agent Activity
Automatic Admission](./agent-activity-automatic-admission.md).

### Event Subscriptions

**onEvent(channel: string, cb: (payload: unknown) => void): () => void**
Subscribe to push events (git:progress, workspace:changed, etc.).

Returns unsubscribe function.

**onStatusChange?(cb: (status: string) => void): () => void** (Optional)
Subscribe to WebSocket connection status changes.

Status values: `"connecting"`, `"connected"`, `"disconnected"`, `"error"`

Returns unsubscribe function.

## REST Endpoints

### Projects

**GET /api/projects**
List all projects in workspace.

Response: `{ projects: [ { name, path, type } ] }`

### Terminals

**POST /api/terminal** (transport channel: `terminal:create`)
Create a new PTY session (idempotent as of Phase 07).

Body: `{ id, project?, cwd?, worktreePath?, command, cols, rows, env? }`

When `worktreePath` is present, the server resolves it as a registered,
available worktree for `project`, resolves relative `cwd` values beneath that
target, rejects cwd values outside it, and persists the canonical target in
session metadata. `worktreePath` requires `project`; omitting it preserves
configured-root or legacy project behavior.

Platform behavior for free terminals differs only where the request omits `cwd`: Windows uses an existing user home directory, then the server's existing current directory; Unix retains the `HOME`-then-`/tmp` fallback. On Windows, an empty command or the exact `bash` selector starts the native interactive `cmd.exe` with no arguments. Other command strings run as `cmd.exe /C <command>`. Unix shell selection and command execution remain unchanged. Windows does not provide Unix shell lifecycle integration, so lifecycle-dependent suggestions and history remain unverified.

Response: the created `SessionInfo`, including `worktreePath` when the session
is target-scoped.

If an automatic restart can no longer validate a target, the server also emits
the generic push event `terminal:target-unavailable` with
`{ project, worktreePath, sessionId, targetUnavailable: true, willRestart: false }`.
The same event may follow a create failure when fresh validation proves the
target disappeared. Ordinary PTY or cwd failures remain ordinary errors. The
browser records that exact target as unavailable, keeps the session metadata
and scrollback as a non-running orphan, and routes later new operations to the
configured root.

**Idempotency Guarantees (Phase 07):**

- Calling create with the same `sessionId` during restart backoff will immediately spawn a fresh session
- Any pending supervisor respawn for that ID is automatically cancelled (killed set flag)
- Dead session tombstones are cleaned up automatically
- No need for client-side alive status filtering—safe to retry without state checks
- Lock released before slow I/O (openpty, spawn), reacquired with TOCTOU guard to detect concurrent creates

**GET /api/pty/:sessionId**
Stream PTY output (Server-Sent Events).

**POST /api/pty/:sessionId/send**
Send input to running PTY.

Body: `{ input: string }`

**GET /api/pty/:sessionId/resize**
Resize terminal.

Body: `{ cols: number, rows: number }`

**POST /api/pty/:sessionId/kill**
Gracefully terminate session (SIGTERM, then SIGKILL if needed).

Response: `{ ok: true }`

**POST /api/pty/:sessionId/remove**
Immediately evict session without restart (cancels pending auto-restart).

Response: `{ ok: true }`

### Git Operations

**GET /api/git/:project/status**
Repository status.

Response: `{ branch, ahead, behind, modified: [], untracked: [] }`

**POST /api/git/:project/clone**
Clone a repository.

Body: `{ url: string, recursive?: bool }`

**POST /api/git/push**
Push commits.

Route: `/api/git/push`

Body: `{ project: string, root?: string, force?: boolean }`

Client behavior:

- Project-level pushes now use a root-aware contract in the UI. The project root still calls `api.git.push(project)`, while a selected child root calls `api.git.push(project, root)`.
- ProjectInfoPanel, WorkspaceGitPanel, and GitPage each expose both `Push` and `Force Push` actions. The destructive button confirms first, then sends the same root-aware payload with `force: true`.
- The shared SSH retry flow normalizes a single Git result or an array of results before checking for auth failures, so push retries follow the same path as fetch and pull.
- Successful push operations now surface a shared status banner as well, so plain push, force push, and push-after-passphrase-retry all confirm completion in the UI.
- Non-auth push failures now surface through the same shared status banner path, so non-fast-forward rejections are visible instead of disappearing behind an HTTP 200 response.
- Successful pushes now invalidate the broader Git cache set on the client: branches, git log, project status, diff, conflicts, file-tree, and project list data refresh together instead of only the push caller.
- The Git page now uses the same root-aware push path for single-project views, so a selected root is preserved consistently across page-level and sidebar-level push actions.
- The SSH passphrase retry dialog can retry immediately or save the passphrase for later when the server and OS keyring support it.
- Retry status messages are rendered through a shared frontend status model, so push/fetch/pull retries report the same wording and state handling.
- The backend push path uses libgit2 `Remote::push(...)` with the same credential callback order as fetch/pull: loaded key, SSH agent, credential helper, then default credentials.
- Push scope is intentionally narrow: the checked-out branch is pushed to its configured upstream only. If `branch.<name>.remote` or `branch.<name>.merge` is missing, the route returns a clear push error instead of inferring a destination. Setting `force: true` changes only the refspec mode; it does not broaden destination inference.
- See `ProjectInfoPanel.test.ts` and `use-git-with-ssh-retry.test.ts` for the root-selection and retry normalization coverage added in this phase.

### SSH Credential APIs

**POST /api/ssh/keys/load**
Load an SSH private key into the current DamHopper server session.

Body: `{ keyPath?: string, passphrase?: string, saveForLater?: bool }`

Response: `{ success: bool, saved: bool, keyPath?: string, error?: string }`

Notes:

- `saveForLater=true` attempts to persist the passphrase in the host OS credential store.
- `saved=true` means a saved credential is available for that workspace/key after the call completes. It can mean the current request persisted it, or that one already existed when the key was loaded session-only.
- Validation happens before persistence, so a wrong passphrase does not create or update a saved credential.
- When persistence is unavailable, the key still loads for the current server session and `error` explains why the save step was skipped.
- Responses never include the passphrase.
- The loaded credential feeds the shared libgit2 fetch/pull/push callback path; it is not passed to a CLI askpass helper.

**GET /api/ssh/credentials**
Return saved-credential metadata for one SSH key.

Query: `keyPath=basename`

Response: `{ saved: bool, keyPath?: string, error?: string }`

**DELETE /api/ssh/credentials**
Forget the saved credential for one SSH key and clear the in-memory session credential when it matches.

Query: `keyPath=basename`

Response: `{ success: bool, forgotten: bool, error?: string }`

**GET /api/git/:project/branches**
List local and remote branches.

**POST /api/git/:project/branches**
Create a branch.

Body: `{ name: string, startPoint?: string, checkout?: bool }`

**POST /api/git/:project/branches/checkout**
Checkout a branch.

Body: `{ branch: string, startPoint?: string, create?: bool, strategy?: "normal"|"stash"|"force" }`

**POST /api/git/:project/branches/update**
Update a branch from its remote tracking branch.

Body: `{ branch?: string }`

**POST /api/git/:project/cherry-pick**
Cherry-pick a commit.

Body: `{ hash: string }`

**POST /api/git/:project/reset**
Reset the current branch to a commit.

Body: `{ hash: string, mode: "soft"|"mixed"|"hard"|"keep" }`

### Git Diff & Change Management (Phase 01)

**GET /api/git/:project/diff**
List changed files (staged + unstaged).

Optional query: `root=ID` to scope results to one VCS root. When no root is
supplied, the backend resolves the deepest matching root for the requested
paths and rejects mixed-root operations.

Use `root=*` for the read-only aggregate local-changes view. Aggregate entries
include `rootId` and `rootPath`; mutation endpoints reject aggregate roots and
must be called with one concrete root.

Response:

```json
{
  "entries": [
    {
      "path": "src/main.rs",
      "status": "modified|added|deleted|renamed|copied|conflicted",
      "staged": false,
      "additions": 5,
      "deletions": 2,
      "oldPath": "src/old.rs",
      "rootId": ".",
      "rootPath": ".",
      "submodule": {
        "path": "modules/child",
        "objectId": "abc123...",
        "moduleName": "child",
        "url": "../child.git"
      }
    }
  ]
}
```

The typed client result is either a normal response with `gitAvailable: true`
or an unavailable result:

```json
{
  "gitAvailable": false,
  "code": "GIT_NOT_INITIALIZED",
  "entries": [],
  "untrackedTruncated": false,
  "untrackedTotal": 0
}
```

This preserves a successful, typed empty state for the local-changes panel
while branch/root requests continue to surface the 409 error for shared
unavailable-state handling.

`rootId`, `rootPath`, and `submodule` are omitted when the entry is not tied to
an explicit VCS root or submodule gitlink.

**GET /api/git/:project/diff/file?path=REL**
File diff content with hunks (HEAD vs working directory).

Optional query: `root=ID` for root-scoped file diff resolution.

Response:

```json
{
  "path": "src/main.rs",
  "original": "...",
  "modified": "...",
  "language": "rust",
  "hunks": [
    {
      "index": 0,
      "oldStart": 10,
      "oldLines": 5,
      "newStart": 10,
      "newLines": 7,
      "header": "@@ -10,5 +10,7 @@"
    }
  ],
  "isBinary": false
}
```

**POST /api/git/:project/stage**
Stage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/unstage**
Unstage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/discard**
Discard changes to file.

Body: `{ path: string, root?: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number, root?: string }`

**GET /api/git/:project/conflicts**
List conflicted files with 3-way merge content.

Optional query: `root=ID` for root-scoped conflict discovery.

**POST /api/git/:project/resolve**
Resolve merge conflict.

Body: `{ path: string, content: string, root?: string }`

**POST /api/git/:project/commit**
Create a commit from staged files.

Body: `{ message: string, amend?: bool, root?: string }`

## Client-Side Profile Management (Phase 2)

Profile management lives entirely in the browser via **localStorage** — no server endpoints required.

### Data Model

```typescript
export interface ServerProfile {
  id: string; // UUID v4
  name: string; // "Local Dev", "Production", etc.
  url: string; // "http://localhost:4800"
  authType: "basic" | "none"; // Authentication method
  username?: string; // For basic auth display (password never stored)
  createdAt: number; // Unix timestamp
}
```

### API Functions

All functions in `packages/ui/src/api/server-config.ts`.

**Profile Getters:**

- `getProfiles(): ServerProfile[]` — fetch all profiles
- `getActiveProfileId(): string | null` — currently selected profile ID
- `getActiveProfile(): ServerProfile | null` — currently selected profile object

**Profile Management:**

- `createProfile(data: Omit<ServerProfile, "id" | "createdAt">): ServerProfile` — add new profile, auto-generates UUID and timestamp
- `updateProfile(id: string, data: Partial<...>): void` — modify profile fields
- `deleteProfile(id: string): void` — remove profile (clears active if deleted)
- `setActiveProfile(id: string): void` — switch active profile

**Persistence:**

- `getProfiles() / saveProfiles(profiles: ServerProfile[]): void` — localStorage key: `damhopper_server_profiles`
- Active profile ID stored in `damhopper_active_profile_id`

**Migration:**

- `migrateToProfiles(): void` — (called in `App.tsx`) converts legacy single-server config to profile system on first app load
  - restores a valid active profile when the stored selection is missing
  - migrates the legacy URL, username, and token only when the legacy URL matches the destination profile

### Storage Breakdown

| Key                           | Storage        | Scope             | Persistence            |
| ----------------------------- | -------------- | ----------------- | ---------------------- |
| `damhopper_server_profiles`   | localStorage   | Shared (all tabs) | Survives browser close |
| `damhopper_active_profile_id` | localStorage   | Shared (all tabs) | Survives browser close |
| `damhopper_auth_token_<id>`   | localStorage   | Per-profile       | Survives browser close |
| `damhopper_auth_username`     | sessionStorage | Per-tab           | Cleared on tab close   |

Bearer tokens are persisted locally per profile to support Android/browser recreation. They are readable by JavaScript; deploy trusted HTTPS frontend assets and never store passwords.
Changing a normalized profile URL clears its token and requires login again; trailing-slash-only formatting changes preserve it.

**POST /api/git/:project/stage**
Stage files for commit.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/unstage**
Unstage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/discard**
Discard changes to file (restore from HEAD).

Body: `{ path: string, root?: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number, root?: string }`

**GET /api/git/:project/conflicts**
List conflicted files with 3-way merge content.

Optional query: `root=ID`.

Response:

```json
{
  "conflicts": [
    {
      "path": "src/conflict.rs",
      "ancestor": "...",
      "ours": "...",
      "theirs": "..."
    }
  ]
}
```

**POST /api/git/:project/resolve**
Resolve merge conflict.

Body: `{ path: string, content: string, root?: string }`

### IDE File Explorer

**GET /api/fs/list?project=NAME&path=REL**
List directory contents.

Response:

```json
{
  "entries": [
    {
      "name": "file.ts",
      "kind": "file",
      "size": 1024,
      "mtime": 1712577600,
      "isSymlink": false
    }
  ]
}
```

**GET /api/fs/read?project=NAME&path=REL[&offset=N&len=M]**
Read file content (text or binary detection).

- Text: returns body with Content-Type: text/\*
- Binary: returns `{ binary: true, mime: "..." }`
- Max 10MB per read

**GET /api/fs/stat?project=NAME&path=REL**
File metadata.

Response:

```json
{
  "kind": "file",
  "size": 1024,
  "mtime": 1712577600,
  "mime": "text/typescript",
  "isBinary": false
}
```

### Session-Bound Media Capabilities

Video playback/download and image preview use opaque ticket URLs and a
server-issued media-session cookie when the browser can send it. Ticket issue
requests require Bearer authentication and set `damhopper-media-session`.
Same-origin streams use the matching cookie; allowlisted cross-origin native
media uses the short-lived ticket capability because `SameSite=Lax` cookies are
not sent cross-site. Tickets remain bound to the authenticated actor/session,
purpose, workspace generation, and revalidated file identity; expiry and logout
revocation still apply. Do not put a Bearer token in a media URL. Bearer remains
required on issue/revoke/session-revoke routes.

The media cookie is host-only `HttpOnly; SameSite=Lax; Path=/api/fs` and
non-`Secure` for HTTP compatibility. The auth fallback cookie is host-only
`HttpOnly; SameSite=Strict; Path=/`, also non-`Secure`. Each successful image or
video issuance creates or reuses that actor's media session, returns the opaque
ticket response, and sets or refreshes the media cookie. Ticket idle lifetime is
15 minutes; media-session idle lifetime is 30 minutes; both have an eight-hour
absolute lifetime. Successful issuance and fully validated stream responses can
refresh idle lifetime but never the absolute deadline. Context changes, expiry,
and explicit revocation remove affected tickets.

**DELETE /api/fs/media-session**

Bearer authentication is required. Send credentials so the browser includes the
media cookie:

```http
DELETE /api/fs/media-session
Authorization: Bearer {token}
```

The endpoint returns `204 No Content`, clears the media cookie, and revokes the
presented session's tickets only when the session belongs to the authenticated
actor. It is safe to call when no usable media cookie exists; no ticket or
session state is disclosed.

The UI uses this endpoint during profile switching/deletion, profile credential
replacement, and before logout, including when an open settings dialog outlives
a concurrently deleted profile. Remote revocation is bounded to five seconds;
an unreachable server does
not block local cleanup/logout, so the old cookie and tickets can remain usable
until their 15-minute ticket or 30-minute session idle expiry, or eight-hour
absolute expiry. Conversely, if remote
revocation succeeds but local token persistence or removal then fails, the UI
intentionally does **not** recreate the remote session. Any restored or retained
local credential must issue fresh media tickets (and a new media session) before
streaming again. The shared revoke helper sends the Bearer token to valid HTTP and
HTTPS origins; HTTP is supported but exposes credentials and media traffic to interception.

The browser client accepts only `authorizationMode: "session-cookie-v1"`, resolves
only an opaque stream path on the configured server origin, performs a credentialed
`HEAD`, and exposes
the URL to a native image/video element or download anchor only after a 2xx probe.
Native elements use `crossOrigin="use-credentials"`. Probe failures expose fixed,
redacted compatibility guidance and never trigger a media-body or Blob fallback.
Installed Chromium 151 passed the 116-test full browser suite, including 11
media-specific tests. The broader gate also passed 1,018 UI tests and 691 Rust tests
(one ignored performance test);
`pnpm build` and `pnpm lint` were clean. The same-origin browser fixture does not
qualify real cross-site CHIPS behavior. Edge, Tauri/WebView, Safari, and Firefox
remain unqualified and must not be advertised as supported. Session and ticket state
is process-local, so multi-instance deployments require sticky routing to the
issuing process until a shared store exists.

### Native Image Preview Capabilities

Image preview is a protected, preview-only session-bound capability contract. It
does not replace the general file-read API and does not provide image downloads.

**POST /api/fs/image/tickets**

Bearer authentication is required. The JSON body is:

```json
{ "project": "NAME", "path": "assets/cover.webp" }
```

Only final, case-insensitive `png`, `jpg`, `jpeg`, `gif`, and `webp` extensions
are accepted. The server resolves the path inside the project sandbox, rejects
traversal/symlink components and non-regular files, records the file
identity/version, and returns a fixed-purpose capability:

```json
{
  "ticket": "opaque-random-token",
  "streamPath": "/api/fs/image/stream/opaque-random-token",
  "expiresAt": 1800000000000,
  "purpose": "preview",
  "authorizationMode": "session-cookie-v1"
}
```

Success is `201 Created` with `Cache-Control: no-store` and a `Set-Cookie`
header for the created or reused media session. Authentication failure is `401`;
unsupported input is `400`; sandbox escape is `403`; missing or
non-regular resources are `404`. Response bodies do not include the project
path, absolute filename, or bearer token.

**DELETE /api/fs/image/tickets**

Bearer authentication is required. Revoke with `{ "ticket": "opaque-token" }`
and include credentials so the matching media-session cookie is sent. The server
removes the ticket only when that cookie's session and the authenticated actor
match its binding. Revocation is idempotent and returns `204 No Content`; missing,
foreign, unknown, or already revoked tickets do not reveal their prior state.

**GET|HEAD /api/fs/image/stream/{ticket}**

The URL contains only the opaque capability. The capability is bound to the
authenticated actor/session that issued it; a matching media-session cookie is
used when available, while the bound ticket itself authorizes cross-origin native
media requests. The stream is inline and uses the MIME captured at issuance.
`GET` returns `200` for the full representation or
`206` for one valid byte range; malformed, multi-range, or unsatisfiable ranges
return `416` with `Content-Range: bytes */size`. `HEAD` returns metadata with an
empty body and ignores range selection. Unknown/revoked capabilities return
`404`; a file identity/version change revokes the capability and returns `410`.

Responses include `Accept-Ranges`, `Content-Length`, `Content-Type`, `ETag`,
`Last-Modified`, and `Cache-Control: private, no-store`. Cross-origin responses
require the request origin to be in the server's exact `DAM_HOPPER_CORS_ORIGINS`
allowlist. Image
disposition is always `inline`; no image ticket
can be upgraded to video playback or download behavior. Workspace, config, and
settings context changes invalidate shared image and video capabilities.

### Video Playback and Download Capabilities

**POST /api/fs/video/tickets** requires Bearer authentication and accepts:

```json
{ "project": "NAME", "path": "media/clip.webm", "purpose": "playback" }
```

`purpose` is the closed `playback | download` enum. A successful `201 Created`
response has the same `ticket`, `streamPath`, `expiresAt`, and
`authorizationMode: "session-cookie-v1"` fields as image issuance, plus the
selected `purpose`, and sets or refreshes the media-session cookie. The server
accepts final, case-insensitive `mp4`, `m4v`, `webm`, `ogv`, `ogg`, and `mov`
extensions after sandbox and regular-file validation.

**DELETE /api/fs/video/tickets** requires Bearer authentication and JSON
`{ "ticket": "opaque-token" }`; include credentials so the matching
media-session cookie is sent. It removes only a ticket bound to the presented
actor and media session, returns `204 No Content`, and does not reveal whether
the ticket was valid.

**GET|HEAD /api/fs/video/stream/{ticket}** requires the opaque ticket to remain
bound to a live authenticated actor/session. It uses the matching media-session
cookie when available and otherwise authorizes the bound ticket for cross-origin
native media. It supports the same range, validator, revalidation, private
no-store, and indistinguishable `404` behavior as image streams.
Playback uses inline disposition; download uses a sanitized attachment filename.

**GET /api/fs/language-files?project=NAME**
Scan the configured project root for supported language files. The endpoint is
authenticated and project-scoped; it does not accept a caller-supplied root or
scan limit. The walk honors Git ignore/global-ignore/repository-exclude rules,
includes hidden paths, excludes `.git` metadata, and returns regular files only
(symlinks are not followed or returned).

Supported extensions are `.rs` (`rust`), `.js`, `.jsx`, `.ts`, and `.tsx`
(`javascript-typescript`), plus `.java` (`java`), matched case-insensitively.
Paths are relative to the project root and use forward slashes where the host
platform requires normalization. Results are sorted by path and capped at
20,000 files or 200,000 visited entries; `truncated` is true when either cap is
reached.

Response:

```json
{
  "files": [
    {
      "path": "src/main.rs",
      "size": 1024,
      "mtime": 1712577600,
      "language": "rust"
    }
  ],
  "truncated": false,
  "limit": 20000
}
```

**Error Responses:**

- 400: Invalid path (outside sandbox)
- 404: Project/path not found

### Agent Store

**GET /api/agent-store/distribution**
Shows which projects have which skills/commands.

**POST /api/agent-store/import**
Import `.claude/` items from remote repo.

Body: `{ repoUrl: string }`

**POST /api/agent-store/ship**
Create symlinks to distribute items.

Body: `{ items: string[], projects: string[] }`

### Workspace Management

**GET /api/workspace/status**
Current workspace status. Returns `configPath` (authoritative registry file location) and `path` (legacy config directory).

Response:

```json
{
  "ready": true,
  "path": "/home/user/.config/dam-hopper",
  "configPath": "/home/user/.config/dam-hopper/dam-hopper.toml",
  "name": "my-workspace",
  "projectCount": 5
}
```

**GET /api/workspace**
Detailed workspace info. Returns both `root` (legacy display field) and `configPath` (authoritative registry location).

Response:

```json
{
  "name": "my-workspace",
  "root": "/home/user/.config/dam-hopper",
  "configPath": "/home/user/.config/dam-hopper/dam-hopper.toml",
  "projectCount": 5
}
```

**POST /api/workspace/switch**
Change active workspace. Accepts either a directory path or a direct path to a `dam-hopper.toml` file.

Request body:

```json
{ "path": "/path/to/workspace-dir-or-config.toml" }
```

On switch:

- Configuration is reloaded from the specified path
- File API sandbox is reinitialized from project roots in the new config
- All PTY sessions are disposed
- Event: `workspace:changed` is broadcast to all clients

Response: `{ "ok": true }`

**POST /api/workspace/init**
Initialize a workspace in a directory. Discovers projects or creates an empty config.

Request body:

```json
{ "path": "/path/to/new-workspace" }
```

Response: `{ "ok": true }`

### Settings & Health

**GET /api/health** (public, no auth required)
Server health + feature flags.

Response:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "features": {}
}
```

## WebSocket Endpoint

**WebSocket /ws**

Auth: append `?token={bearer_token}` to URL.

Protocol: JSON frames. Client sends commands via `{kind:}` envelope, server broadcasts events.

**Message Format (all client→server or server→client):**

```json
{ "kind": "terminal:write", "id": "uuid", "data": "..." }
```

**Legacy WebSocket Terminal Messages (historical; new creation uses REST):**

- `{ kind: "terminal:spawn", project, profile, env_overrides? }` → server responds with `{ kind: "terminal:spawned", id, ... }`
- `{ kind: "terminal:write", id, data }` — send input
- `{ kind: "terminal:attach", id, from_offset? }` — request buffer replay (Phase 02+); server responds with `{ kind: "terminal:buffer", id, data, offset, reset, truncated }`
  - `from_offset` (optional) — client's last received byte offset for delta sync
  - Server sends full buffer with `reset=true` if `from_offset` is omitted
  - Server sends full buffer with `reset=true` and `truncated=true` if `from_offset` is too old (evicted)
  - Server sends a delta with `reset=false` when the requested offset is retained
  - Server sends empty `data` if `from_offset` equals current offset (no new content)
  - Error case: session not found → no response; client should timeout and create new session
- `{ kind: "terminal:kill", id }` — terminate session
- `{ kind: "terminal:output", id, chunk }` — server pushes PTY output
- `{ kind: "terminal:buffer", id, data, offset, reset, truncated }` — server response to `terminal:attach` with buffer content, current offset, and replay instructions
- `{ kind: "terminal:exited", id, code }` — session ended

The current browser terminal creation path is the REST `terminal:create`
channel documented above. Target-scoped command and profile IDs use stable
opaque target discriminators; target routing itself is server-validated and
represented by `worktreePath` session metadata.

**File Tree Subscription (Phase 03):**

- `{ kind: "fs:subscribe_tree", req_id, project, path }` — start watching directory tree; server responds with `{ kind: "fs:tree_snapshot", sub_id, nodes: [...] }`
- `{ kind: "fs:unsubscribe_tree", sub_id }` — stop watching
- `{ kind: "fs:event", sub_id, event: { kind, path, from? } }` — server pushes FS changes (created|modified|deleted|renamed)

**File Read (Phase 04):**

- `{ kind: "fs:read", req_id, project, path, offset?, len? }` — read file content with optional range
  - Supports large files via offset+len (range reads)
  - Server responds: `{ kind: "fs:read_result", req_id, ok, binary, mime?, mtime?, size?, data?, code? }`
  - `data` is base64-encoded content (text or binary), max 100MB
  - If `ok=false` and `code="TOO_LARGE"`: file exceeds cap; use range reads (LargeFileViewer)

**File Write (Phase 04):**

- `{ kind: "fs:write_begin", req_id, project, path, expected_mtime, size }` — initiate write
  - Server responds: `{ kind: "fs:write_ack", req_id, write_id }`
  - `expected_mtime` (Unix seconds) guards against concurrent modification; server rejects if stale
- `{ kind: "fs:write_chunk", write_id, seq, eof, data }` — send base64 chunk
  - Server acks each: `{ kind: "fs:write_chunk_ack", write_id, seq }`
- `{ kind: "fs:write_commit", write_id }` — finalize write
  - Server responds: `{ kind: "fs:write_result", write_id, ok, new_mtime?, conflict, error? }`
  - `conflict=true` if server detected mtime mismatch; client shows ConflictDialog (overwrite or reload)
  - `new_mtime` sent on success for next save guard

**Git Events:**

- Server broadcasts `{ kind: "git:progress", project, step, percent }` during clone/push/pull

All responses include context fields matching the request (e.g., `req_id` echoed back for fs:subscribe_tree).
