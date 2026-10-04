# System Service APIs

Diagnostics, browser-debug, native forwarding, and host-resource API contracts moved from the [API reference index](../api-reference.md).
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

## Native SSH forwarding IPC (Phase 08)

Native SSH forwarding is a Windows desktop Tauri capability, not a REST or
WebSocket API. The shared UI calls the `SshForwardHost` interface; the Axum
server exposes no forwarding CRUD route or forwarding event authority.

The client opens one desktop context and then addresses each server profile
through an independent scope:

| Operation                           | Input / result boundary                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `openClient(knownScopes)`           | Starts a new client epoch and returns `DesktopClientContext`; globally tears down prior live scopes/resources. |
| `openScope(scopeId)`                | Opens or reuses one UUIDv4 scope; returns `ScopeHandle { ref, snapshot }`.                                     |
| `closeScope(scope)`                 | Accepts the complete `NativeScopeRef`; closes only that scope's live resources.                                |
| `reconcileKnownScopes(knownScopes)` | Updates retention metadata; does not open/close scopes or advance the epoch.                                   |
| `snapshot(scope)` and mutations     | Carry the explicit scope reference and return an authoritative scoped snapshot.                                |
| `purgeScope(scopeId, knownScopes)`  | Purges only an inactive, confirmed-absent scope when known-scope storage is available.                         |

`NativeScopeRef` binds `DesktopClientContext` (`desktopInstanceId`,
`managerSessionId`, `clientEpoch`) to `scopeId`, `scopeGeneration`, and
`activationToken`. Revisions and generations are canonical unsigned decimal
strings; clients and Rust compare their numeric values, reject non-canonical
forms, and fail on overflow. A stale context, token, generation, window, or
scope is rejected rather than routed through an active-profile fallback.

The Windows command surface is exactly:

```text
ssh_forward_open_client
ssh_forward_open_scope
ssh_forward_close_scope
ssh_forward_reconcile_known_scopes
ssh_forward_snapshot
ssh_forward_create_connection
ssh_forward_update_connection
ssh_forward_delete_connection
ssh_forward_create_rule
ssh_forward_update_rule
ssh_forward_delete_rule
ssh_forward_connect
ssh_forward_disconnect
ssh_forward_set_rule_enabled
ssh_forward_list_keys
ssh_forward_load_key
ssh_forward_load_password
ssh_forward_forget_credential
ssh_forward_approve_host
ssh_forward_purge_scope
```

All 21 handlers require the `main` webview label. The `ssh-forward-main`
capability grants the permission only to `main` on Windows; browser, mobile,
and the native `browser-debug` child receive no SSH-forward command. The old
`activateScope` command is not part of this shipping surface.

Snapshots are scoped to one profile and include connection/rule data, runtime
state, revisions, credential status, trust challenges, and the scope identity.
`ssh-forward:changed` events are bounded refetch hints, not patches. The full
native lifecycle, persistence, limits, and security contract is in the
[Phase 08 guide](../phase-08-native-scope-concurrency.md).

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
route and are not included in this export.

### Production diagnostics CLI (Phases 06–07)

Historical idle-suspend incident reconstruction is not exposed via REST or WebSocket endpoints; `/api/system/idle-suspend/v1/status` reports only the latest, ephemeral coordinator state and current host probes. Comprehensive historical diagnosis across coordinator events, audits, systemd lifecycle, journald, and host probes is exclusively provided via the local one-shot CLI:

```bash
dam-hopper diagnose --json
```

`--json` is required; no output path, window, source, unit, URL, command, or
verbosity flag is accepted. The collector writes a bounded camelCase
`DiagnosticBundleV1` (`bundleSchemaVersion: 1`) from fixed role-aware sources:
server event/audit files, helper audit, backend diagnostics, systemd/journal
metadata, the loopback idle-status API, and current host probes. Journal
message text, credentials/tokens, terminal/PTY data, arguments, raw helper
frames, and socket/IP addresses are excluded.

The command prints only the absolute final bundle path after an atomic
same-directory write. Root output is
`/var/lib/dam-hopper-manager/diagnostics`; non-root output is
`$XDG_STATE_HOME/dam-hopper/diagnostics`, or `$HOME/.local/state/dam-hopper/diagnostics`
when the former is unset. Directories are `0700` and final files `0600`.
Non-root collection never escalates; an applicable helper audit is
`permissionDenied` and can make the historical result partial.

| Exit | Meaning                                                     |
| ---: | ----------------------------------------------------------- |
|  `0` | Complete applicable historical evidence; bundle written.    |
|  `2` | Partial historical evidence; valid bundle written.          |
|  `1` | Serialization or secure-output failure; no path is printed. |

See [Linux Release Manager — Production diagnostics](../linux-release-manager.md#production-diagnostics-phase-06)
for source paths, role applicability, fixed adapter limits, and output details.

#### Phase 07 qualification (production diagnostics, 2026-09-14)

The dedicated verification artifacts are:

- `server/tests/idle_suspend_phase07.rs`: 2/2 deterministic cross-layer tests
  covering automatic quiet admission/cancellation plus manual admission,
  rejection, UUID propagation, and server-audit correlation.
- `server/tests/idle_suspend_diagnostics.rs`: 8/8 deterministic diagnostics
  tests through six focused modules for malformed/unknown/gapped records,
  redaction, fixed bounds, role/EUID and local API faults, and atomic output.
- `server/tests/idle_suspend_diagnostics_linux_smoke.rs`: 1/1 explicitly
  ignored Linux read-only smoke using production read adapters and temporary
  output; host/configuration/audit files, RTC wakealarm content, and API/helper
  unit snapshots remain unchanged.

The five-command focused gate recorded 223/223 aggregate executed tests with
zero failures; this count is not unique-test coverage and no percentage is
claimed. Cycle-2 code review approved the delivered scope at 10.0/10. These
checks do not constitute a real suspend/resume canary.
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

The resource monitoring and diagnosis UI is read-only for generic host
remediation. The top-nav popover may also display the separate authenticated
idle-suspend status and existing manual force-suspend action; that action is
governed by the idle-suspend contract and does not mutate resource-monitor
state. While the paired SSE stream is LIVE, its snapshot and metrics frame is
authoritative as one observation. After stream loss, missed or malformed
frames, profile changes, or reconnect, the UI may use only exact-owner REST
fallback where its gate permits; stale profile or connection responses cannot
become authoritative. If the deep snapshot is unavailable, the diagnosis popover
retains CPU and disk from the compatible metrics endpoint and labels the deep
data unavailable; it never fabricates a zero value. Cgroup v1 is reported as
unsupported; constrained Linux and containers report per-section availability
and scope rather than host-wide failure.

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

#### GET /api/system/resources/v1/events

Authenticated Server-Sent Events (SSE) delivery of complete paired host-resource snapshots and metrics for an eligible, connected, visible profile owner. REST remains the fallback; SSE changes no host sampling or alert authority.

- **Transport:** HTTP GET streaming via profile-owned browser `fetch()` with reader-stream processing (`credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`, `Accept: text/event-stream`). Requires `Authorization: Bearer <token>` except explicit development `--no-auth`; cookies, query tokens, native `EventSource`, and browser-only `profileId` in the wire route are not supported.
- **Origin and headers:** A supplied `Origin` must match configured CORS origins; malformed, multiple, or disallowed values return `403` before auth-store/database work. A missing `Origin` does not bypass bearer authentication. `OPTIONS` never consumes SSE permits or auth; configured CORS handles allowed preflight, otherwise the ordinary GET-only route may return `405`. Allowed preflight request headers include standard request headers plus `Authorization`, `Cache-Control`, and `Pragma`. Return `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: private, no-store, no-transform`, `X-Accel-Buffering: no`; disable buffering and compression at every proxy hop.
- **Admission & limits:** At most 32 live response-body leases per server process and 4 per authenticated subject. Rejections are HTTP `429 Too Many Requests`, JSON `{ "code": "HOST_RESOURCE_STREAM_LIMIT", "error": "Global host resource stream limit reached" }` or `{ "code": "HOST_RESOURCE_STREAM_LIMIT", "error": "Per-subject host resource stream limit reached" }`, with `Retry-After: 30`. Admission auth has a 2-second timeout; timeout or auth-store failure returns HTTP `503` `{ "code": "AUTH_UNAVAILABLE", "error": "Authentication backend unavailable" }`.
- **`host-resources-status` control:** Exact JSON fields are `{ "serverEpoch": "<UUID>", "revision": "<decimal u64>", "snapshotAgeMs": <number|null>, "metricsAgeMs": <number|null>, "freshnessTtlMs": <number> }`. Send an initial status, a matching status immediately before every data frame, and periodic status at least every 15 seconds; use a small `: keepalive` comment within 15 seconds if no other bytes are sent. Ages are nonnegative monotonic milliseconds since each projection's last successful observation, remain unchanged by degraded timestamps/heartbeats, and are `null` before its first success. `freshnessTtlMs` is `2 × (lightSampleMs + snapshotDeadlineMs + jitterMs)` using clamped server settings (11,500 ms at defaults); status alone does not assert a fresh sample.
- **`host-resources` data event:** Exact top-level fields are `{ "schemaVersion": 1, "serverEpoch": "<UUID>", "revision": "<decimal u64>", "snapshot": <HostResourceSnapshotV1>, "metrics": <HostMetrics>, "lightSampleMs": <number> }`. Each event is a complete pair; revisions may be skipped. No profile ID, SSE `id:`, delta, replay buffer, or `Last-Event-ID` dependency. The entire framed data event is capped at 262,144 bytes; the entire framed status/error control is capped at 4,096 bytes.
- **Errors:** A post-header `host-resources-error` control uses `{ "code": "MFA_REQUIRED" | "AUTH_REQUIRED" | "AUTH_UNAVAILABLE" | "FRAME_TOO_LARGE", "error": "<safe reason>" }`; delivery and EOF are best effort under backpressure. Pre-header oversize returns HTTP `503` JSON `{ "code": "FRAME_TOO_LARGE", "error": "<safe reason>" }`, distinct from `AUTH_UNAVAILABLE`.
- **Supervision & shutdown:** Live streams revalidate signed claims every 5 seconds against persisted sessions/users (2 DB reads/check) with a 2-second timeout; auth failures stop new emission. On OS signal, feature cleanup is bounded to ≤2 seconds and `ForceCloseListener` cancels accepted HTTP/WS I/O at signal+10 seconds. This bounds HTTP drain, not total process exit under a blocked collector syscall; active backpressured HTTP/WS shutdown remains unqualified.
- **Client coordination & fallback:** While LIVE, a paired SSE frame is authority for both resource query keys and suppresses snapshot/metrics REST. Only the current connected owner with visible interest may use REST fallback: snapshot every 15 seconds and visible detail metrics every 5 seconds during `STARTING`, retry/error, or 404/405/unsupported transport. Hidden, disconnected, switching, or `AUTH_BLOCKED` owners start no resource REST work; cached values may remain visible with their last-known age. `AUTH_UNAVAILABLE` blocks resource REST until a valid authenticated pair or a new connection generation.
- **WebSocket behavior:** Host-alert unread state remains profile/incident-scoped; visible REST alert history refresh is coalesced at 30 seconds. WS snapshot patches run only when REST has authority and never roll back a LIVE or switching SSE pair. Non-resource WS events remain on their existing owner-bound bridge.

#### `host:alertChanged` transport event

The existing event name and legacy memory payload remain compatible. An additive
thermal/disk payload uses the resource shape above; recovery is represented by
`resolvedAt`. The client accepts either payload only after strictly validating
finite non-negative timestamps, allowed kind/state/severity,
bounded required text, and the exact evidence fields for that kind. Invalid or
unknown evidence is discarded without updating cached resource state.

A valid event updates only its `incidentId` in the owner's snapshot when REST has
source authority; `resolvedAt` removes only that incident. While switching or
LIVE, WS cannot patch/invalidate the snapshot; the paired SSE frame is authority.
The owner bridge dispatches once per transport and suppresses the matching
ambient listener; it coalesces owner/QueryClient history invalidations.
`currentAlerts: []` clears active incidents; omission preserves older-server compatibility.


