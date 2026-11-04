# API Reference

Endpoint and client-transport contracts are split by domain to keep each reference maintainable. Start with the current route details in the linked pages; implementation and typed client code remain authoritative.

Base URL depends on deployment. Local development commonly uses `http://127.0.0.1:4803`; systemd production serves the API on `http://localhost:4801`; legacy direct/Docker configurations may use `http://localhost:4800`.

## Current API references

| Page | Coverage |
| --- | --- |
| [Authentication](./api/authentication.md) | Login, MFA, login session inventory and revocation, development-mode behavior |
| [Workflow tracking](./api/workflow.md) | Workflow REST routes |
| [System services](./api/system-services.md) | Diagnostics, browser-debug artifacts, native SSH forwarding, host resources |
| [Terminal idle suspend](./api/idle-suspend.md) | Status, timing, manual force, helper protocol and status events |
| [Agent status and sessions](./api/rest-endpoints.md#agent-status-api) | Agent snapshot and PTY session persistence |
| [Git API](./api/git.md) | Worktrees, branches, history search, commit rewrite/squash, leased publication |
| [Client transport and events](./api/transport-and-events.md) | Reconnection, PTY subscriptions, and client event methods |
| [REST endpoints](./api/rest-endpoints.md) | Global config, projects, terminal, Git conflict/operation routes, SSH credentials |
| [Git operation lifecycle](./api/git-operation-lifecycle.md) | Sequencer state machine, operation continuation/abort, stage role labels, and truthful outcomes |
| [Client-side profiles](./api/client-side-profiles.md) | Profile metadata, connection contracts, and client-side persistence breakdown |
| [Filesystem and media](./api/filesystem-and-media.md) | File explorer/search, media tickets, stream authorization |
| [Workspace and settings](./api/workspace-settings.md) | Agent Store, workspace, settings, health |
| [WebSocket](./api/websocket.md) | WebSocket endpoint and event/message contract |
| [Session changes review](#session-changes-review-api) | Read-only session changes status, files, file diff, and private tool-event capture endpoints |
| [Terminal inventory and termination](#terminal-inventory-and-guarded-termination-api) | Additive inventory headers/fields and guarded termination protocol |

## Authentication

See the [authentication API reference](./api/authentication.md). Covers registration, TOTP MFA enrollment and verification, session status, account-wide device login sessions inventory (`GET /api/auth/sessions`), and bearer-only session revocation (`DELETE /api/auth/sessions/{id}`). `--no-auth` is a development bypass, not a production mode; bind it to loopback only. Privileged idle-suspend mutations and login device sessions remain denied in no-auth mode (`409 DEVICE_SESSIONS_UNAVAILABLE`).

## Terminal idle suspend

See the [idle-suspend API reference](./api/idle-suspend.md). Automatic policy, timing, and manual force are separate contracts; current status is authoritative and does not prove an operation has completed.

## Git API

See the [Git endpoint reference](./api/git.md). Commit rewriting and squash are local CAS-protected operations; publication is a separate exact-OID leased action. For unmerged index summaries, on-demand conflict snapshots, safe resolution contracts (`ResolveOutcome`), `GitMutationCoordinator`, and CUT1 generic stage preflight, see [Git Conflict Discovery, Snapshots & Resolution](./api/rest-endpoints.md#git-conflict-discovery--snapshots). For authoritative active operation inspection, preconditioned continue/abort lifecycle mutations, stage role semantics, and truthful execution outcomes, see the [Git Operation Lifecycle API](./api/git-operation-lifecycle.md) and [REST Endpoints](./api/rest-endpoints.md#git-operation-lifecycle).

## Project Worktree Targets

The [Git API reference](./api/git.md) documents target validation, worktree
discovery, and use of `worktreePath` across Git, terminal, and filesystem
operations.

## Client-Side Profile Management

See the [Client-side profile reference](./api/client-side-profiles.md), [REST endpoint reference](./api/rest-endpoints.md#client-side-profile-management), and [Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md).
## Commit history

The [Git API reference](./api/git.md#commit-history) documents full-message literal filtering and pagination.

## Git Operations

The [REST endpoint reference](./api/rest-endpoints.md#git-operations) documents ordinary fast-forward pushes, explicit leased publication, [Git conflict discovery, snapshots & resolution](./api/rest-endpoints.md#git-conflict-discovery--snapshots), [Git operation lifecycle](./api/rest-endpoints.md#git-operation-lifecycle) (see also [Git Operation Lifecycle API](./api/git-operation-lifecycle.md)), and CUT1 generic stage preflight.
## IDE File Explorer

See [filesystem and media APIs](./api/filesystem-and-media.md).

## Session-Bound Media Capabilities (v2)

See the [filesystem and media API reference](./api/filesystem-and-media.md#session-bound-media-capabilities-v2).

## Agent Store

See [workspace and settings APIs](./api/workspace-settings.md#agent-store).

## Workspace Management

See [workspace and settings APIs](./api/workspace-settings.md#workspace-management).

## Settings & Health

See [workspace and settings APIs](./api/workspace-settings.md#settings-health).

## WebSocket Endpoint

See the [WebSocket API reference](./api/websocket.md).
## Session Changes Review API

### Public Endpoints (`/api/terminal/:tid/session-changes/v1/*`)

All public endpoints require authentication and return `Cache-Control: private, no-store` and `Vary: Authorization, Cookie`.

- `GET /status?terminalIncarnation=&ompSessionId=&rootId=&expectedServerEpoch=`: Query session baseline status, coverage, and change counts (`Status`). If `ompSessionId` is omitted, returns `RetainedSessionList` listing retained session identities for the terminal. Missing baseline returns HTTP 200 with `state: "missing"` or `"unavailable"`, not an empty diff or 404. Projects cached metadata only, performing zero disk reads or diff calculations.
- `POST /refresh`: Request a re-comparison of tracked files against existing baseline originals (`Comparison`). Request body `{ version: 1, terminalIncarnation, ompSessionId, rootId, serverEpoch, baselineId, requestId }`. Recomputes and publishes a new immutable comparison revision. Returns HTTP 409 `busy` if scan permits are saturated (`MAX_BLOCKING_PERMITS = 2`).
- `GET /files?terminalIncarnation=&ompSessionId=&rootId=&expectedServerEpoch=&baselineId=&comparisonRevision=&cursor=&limit=`: Keyset-paginated list of changed files (`FilePage`). First page may omit `comparisonRevision` for lazy viewer bootstrapping (returns revision plus files); cursor pages require exact `comparisonRevision`. Each `FileRow` includes change kinds (`added`, `deleted`, `modified`, `modeOnly`, `unknown`), additions/deletions line counts, and first-touch absence/presence provenance (`absentAtFirstTouch`).
- `GET /files/:fileId?terminalIncarnation=&ompSessionId=&rootId=&expectedServerEpoch=&baselineId=&comparisonRevision=`: Detailed file diff with original and current `ContentSide` bytes (`FileDetail`). Validates `fileId` and requested revision; returns HTTP 409 `refreshRequired` if the working tree has drifted from the requested comparison revision.

*Client Transport:* Web and desktop UI invoke these endpoints through `client.transport.invoke("sessionChanges:*", ...)` in `packages/ui/src/api/session-changes-client.ts`, which maps logical channel requests to authenticated REST HTTP calls with typed DTO decoders and generation-scoped TanStack Query keys.

### Private Endpoints (`/private/session-changes/v1/*`)

Private loopback endpoints used by the managed OMP extension adapter. All endpoints return `Cache-Control: no-store` and enforce `MAX_REQUEST_BODY_BYTES` (16 KiB):

- `POST /register`: Metadata-only registration for a session root (`RegisterRequest` -> `RegisterResponse`). Request body `{ version: 1, ompSessionId, rootId, cwdHint? }` returns `{ serverEpoch, terminalIncarnation, ompSessionId, rootId, baselineId, canonicalRoot }`. Idempotent; performs zero file enumeration or content reads.
- `POST /capture`: Tool-event first-touch file capture before tool execution (`CaptureRequest` -> `CaptureResponse`). Request body `{ version: 1, serverEpoch, terminalIncarnation, ompSessionId, rootId, baselineId, captureId, paths, mode: "preEdit" | "unproven" }`. Pre-edit mode reserves path slots and byte quotas before reading, storing exact original bytes or verified absence (`absentAtFirstTouch`). Unproven mode records post-result-only paths without reading originals. Failures yield `unknown` / `unproven`, never false originals.
- `POST /lookup`: Status inquiry for an active session (`LookupRequest` -> `LookupResult`: `active`, `missing`, `unavailable`). Metadata-only lookup without filesystem reads or capturing new snapshots.
- `POST /settled`: Report completed model tool turn (`SettledRequest` -> `SettledResponse`: `{ version: 1, accepted: true, duplicate: boolean }`). Deduplicates idempotent notifications across 64 recent turn IDs, recording `last_settled_turn_id` and dirty hint. Performs zero background diffing and zero file reads on settled turns.

### Resource Limits and Bounds

Runtime capacity fences protect server memory and concurrency:
- **Retained Sessions:** 32 global retained identities (`MAX_RETAINED_IDENTITIES`).
- **Tracked Paths:** Max 500 tracked paths per session (`MAX_PATHS_PER_SESSION`).
- **File Read Bound:** 2 MiB regular file read limit (`MAX_FILE_RAW_BYTES`).
- **Baseline Storage Cap:** 64 MiB global accounted baseline storage cap across all sessions (`MAX_GLOBAL_STORAGE_BYTES`).
- **Concurrency Permits:** 2 global blocking scan permits (`MAX_BLOCKING_PERMITS`); saturation returns HTTP 409 `busy` without queuing.
- **Request Limit:** 16 KiB maximum request body size (`MAX_REQUEST_BODY_BYTES`).
- **Render Bounds:** 1 MiB / 20,000 lines diff render bounds (`MAX_TEXT_RENDER_BYTES`, `MAX_TEXT_RENDER_LINES`).

### Error Codes and HTTP Status Mapping

Typed error codes returned in `ErrorBody`:
- **400 Bad Request:** `invalidRequest`, `incarnationMismatch`, `sessionMismatch`, `rootMismatch`.
- **401 / 403 Forbidden:** `unauthorized`.
- **404 Not Found:** `terminalMissing`, `fileMissing`, `targetUnavailable` (when missing entity), `baselineMissing`.
- **409 Conflict:** `busy`, `refreshRequired`, `acknowledgmentPending`.
- **410 Gone:** `serverRestarted`, `baselineMissing`, `originalUnavailable`, `registrationExpired`.
- **413 Payload Too Large:** `responseLimit`.
- **429 Too Many Requests:** `capacity`.
- **503 Service Unavailable:** `trackingDisabled`, `targetUnavailable`, `registrationFailed`.
- **504 Gateway Timeout:** `deadline`.
## Terminal Inventory and Guarded Termination API

### Terminal Creation Endpoint

- `POST /api/terminal`

Authenticated endpoint to launch a new terminal process. In addition to returning the created session's `SessionMeta`, responses carry originating lifetime authority headers:
- `X-DamHopper-Termination-Version: 1`
- `X-DamHopper-PTY-Epoch: <uuid>` — Manager-lifetime UUID epoch allocated when the PTY manager is constructed, shared by clones, and never persisted.
- `Cache-Control: no-store`

Clients decode these response headers to capture the originating manager epoch (`serverEpoch`), establishing immutable provenance alongside the originating connection generation and terminal incarnation.

### Terminal Inventory Endpoints

- `GET /api/terminal`
- `GET /api/terminal/detailed`

Authenticated endpoints returning the active terminal session inventory. Both endpoints return the following response headers:
- `X-DamHopper-Termination-Version: 1`
- `X-DamHopper-PTY-Epoch: <uuid>` — Manager-lifetime UUID epoch allocated when the PTY manager is constructed, shared by clones, and never persisted.
- `Cache-Control: no-store`

Response body is a JSON array of session rows with legacy `SessionMeta` properties alongside additive fields:
- `incarnationExact` (`string`): Canonical decimal representation of the positive unsigned 64-bit incarnation integer (up to `"18446744073709551615"`). Canonical eligibility rejects conflicting safe-integer evidence: when a legacy numeric incarnation is safe, it must agree losslessly with `incarnationExact`.
- `terminationState` (`string`): Six-state enum:
  - `"live"`: Active process running; eligible for guarded termination signal.
  - `"terminationRequested"`: Process termination signal has been dispatched.
  - `"restartPending"`: Process is dead but scheduled for restart; eligible for restart cancellation.
  - `"restartCancelled"`: Restart was cancelled; retained on in-memory tombstone until eviction.
  - `"exited"`: Process has completed ordinary exit.
  - `"unavailable"`: Session is in closing, handoff, or unverified state; non-actionable.
- `buffer_bytes` (`number`, detailed endpoint only): Total buffered output bytes. Omitted on `GET /api/terminal`.

### Guarded Termination Endpoint

- `POST /api/terminal/{id}/terminate`

Authenticated endpoint that atomically validates target authority and requests termination for a live terminal session, or cancels a scheduled restart. HTTP 202 signals request dispatch only and does not prove completed process exit. Payload is strictly bounded to a maximum of 512 bytes (`TERMINATION_MAX_BODY_BYTES`).

**Request Body:**
```json
{
  "version": 1,
  "expectedServerEpoch": "<uuid>",
  "expectedIncarnation": "<canonical-positive-u64>"
}
```

**Success Outcomes:**
- **HTTP 202 Accepted** (`outcome: "terminationRequested"`): Live running session received termination signal dispatched to the operating system process.
  ```json
  {
    "version": 1,
    "serverEpoch": "<uuid>",
    "terminalId": "<id>",
    "incarnation": "<canonical-positive-u64>",
    "outcome": "terminationRequested"
  }
  ```
- **HTTP 200 OK** (`outcome: "restartCancelled"`): Dead session scheduled for restart had its delay cleared, restart flag disabled, and fleet pending cancelled atomically. Retains exact cancellation marker on in-memory tombstone.
  ```json
  {
    "version": 1,
    "serverEpoch": "<uuid>",
    "terminalId": "<id>",
    "incarnation": "<canonical-positive-u64>",
    "outcome": "restartCancelled"
  }
  ```

**Error Codes and HTTP Status Mapping:**
- **400 Bad Request:**
  - `TERMINATION_INVALID_REQUEST`: Malformed JSON, non-canonical UUID epoch, non-canonical incarnation, or missing required fields.
  - `TERMINATION_UNSUPPORTED_VERSION`: Version is not `1`.
- **404 Not Found:**
  - `TERMINATION_NOT_FOUND`: Session ID does not exist in active sessions or retained tombstones.
- **409 Conflict:**
  - `TERMINATION_EPOCH_MISMATCH`: `expectedServerEpoch` does not match the PTY manager's current lifetime epoch.
  - `TERMINATION_INCARNATION_MISMATCH`: `expectedIncarnation` does not match the session's current incarnation.
  - `TERMINATION_REPLACEMENT_PENDING`: A replacement session has already been admitted for this terminal ID.
  - `TERMINATION_ALREADY_REQUESTED`: Termination has already been requested or restart already cancelled.
  - `TERMINATION_NOT_LIVE`: Session is not currently live or restart-pending.
  - `TERMINATION_MANAGER_CLOSING`: PTY manager is shutting down.
- **413 Payload Too Large:**
  - `TERMINATION_BODY_TOO_LARGE`: Request payload exceeds 512 bytes limit.
- **500 Internal Server Error:**
  - `TERMINATION_SIGNAL_FAILED`: Failed to dispatch process kill signal to OS.

Legacy `DELETE /api/terminal/{id}` endpoints remain for backwards compatibility with unrelated existing clients; safe web clients never fall back to DELETE.

### Originating Lifetime Provenance Requirements

Ordinary launched terminal views in the UI do not initially possess captured destructive target tuples. In addition to matching the exact terminal session ID (`row.id === effectiveSessionId`) and passing numeric/exact row eligibility (`isTerminalInventoryRowEligible`), clients enforce complete 4-part originating lifetime provenance before resolving an ordinary view to a destructive termination target (`resolveWindowTerminalObservation`):
1. **Originating Connection Generation:** Safe non-negative integer strictly matching observation generation (`obs.owner.generation === winGeneration`).
2. **Originating Profile ID:** Non-empty string strictly matching observation profile (`obs.owner.profileId === winProfileId`).
3. **Originating PTY ServerEpoch:** Canonical UUID strictly matching observation epoch (`obs.termination.serverEpoch === winServerEpoch` and `obs.termination.version === 1`).
4. **Originating Incarnation:** Canonical positive u64 string and/or safe positive integer with mutual consistency, strictly matching `row.incarnationExact`.

If any of these 4 criteria is missing or mismatched, destructive actions ("End Session", "Cancel Restart") remain disabled with an explanatory reason ("End session is unavailable: connection disconnected, legacy headerless server, or unverified session identity"), failing closed without ambient epoch promotion, while preserving safe presentation "Close View".

## Retired plugin API anchors

### Trusted Plugin API

Retired. There are no current plugin routes; historical context is in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md).

### Trusted Plugin Management API

Retired. There are no current plugin-management routes; historical context is in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md).
