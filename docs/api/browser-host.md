# Host Browser CDP Streaming API

REST routes, admission security model, single-use capability tickets, and leased input queue semantics for the Host Browser CDP Streaming subsystem (`server/src/browser_host/`, `server/src/api/browser_host.rs`).

For process containment, supervisory death pipes, and binary wire framing (BHJF v1), see the [Host Browser CDP Streaming Architecture](../architecture/host-browser-cdp-streaming.md).

---

## 1. Admission Security Model

Browser management routes require caller admission through `evaluate_browser_admission`. The DevTools asset and WebSocket routes instead redeem a path capability and revalidate the admission captured when it was minted. Admission rejects ambiguous credentials, unapproved origins, and unauthorized roles.

Browser management responses and DevTools HTML responses use `Cache-Control: no-store`; proxied non-HTML DevTools assets use private caching as described below.

### Production Admission Rules

1. **Authentication Requirement & Canonical Claims:** The request must provide a valid bearer token in `Authorization: Bearer <token>` or `damhopper_auth` cookie. Token claims are decoded and verified via `state.auth_service.evaluate_claims(&claims)`.
2. **MFA Enforcement & Deadlines:** MFA verification is evaluated via `crate::auth::compute_mfa_due_at(mfa_verified_at, expires_at)`. If pending, returns HTTP 401 Unauthorized with `kind: "mfaRequired"`. If expired or invalid, returns HTTP 401 with `kind: "sessionExpired"` or `kind: "invalidSession"`.
3. **Enabled Account & Admin Role Check:** Live database lookup verifies that the user account exists, `is_enabled == true`, and holds the enabled `Admin` role (`UserRole::Admin`). Non-admin users (`UserRole::User`) receive HTTP 403 Forbidden with `kind: "adminRequired"`. Disabled accounts receive HTTP 403 with `kind: "accountDisabled"`.
4. **Session Integrity:** If a session ID is present, the session must exist, must not be revoked (`revoked_at.is_none()`), and its `auth_version` and `credential_version` must match both token claims and user database records.
5. **Exact Single Origin Enforcement:** Multiple `Origin` headers (`get_all(ORIGIN).count() > 1`) fail closed with HTTP 403 Forbidden (`kind: "forbiddenOrigin"`). Origins containing `"null"`, ending with a trailing slash (`/`), or containing commas (`,`) fail closed with HTTP 403. Values must match byte-for-byte against configured `server.cors_origins` or `browser.allowed_dev_origins`. Origin-less requests are permitted strictly for clients presenting `Authorization: Bearer <token>`.
6. **Foreign Session Isolation:** Requesting, mutating, or closing a session owned by another principal returns HTTP 404 Not Found with `kind: "sessionNotFound"`, indistinguishable from a non-existent session, preventing cross-tenant existence probing.
7. **Continuous Live Verification:** Active streaming connections and long-lived attachments undergo live verification every 5 seconds (`LIVE_CHECK_INTERVAL`) with a strict 2-second database timeout (`LIVE_CHECK_TIMEOUT`). If an admin is demoted, an account is disabled, or a session is revoked, connections are terminated immediately via `CancellationToken`.
### Development Mode Bypass (`--no-auth`)

When the server runs in `--no-auth` mode (`state.no_auth == true`):
1. **Peer IP Loopback:** The connecting peer IP address must be a loopback address (`127.0.0.1` or `::1`). Non-loopback peers fail closed with HTTP 403 `kind: "devBypassDenied"`.
2. **Forwarded Headers Ignored:** Headers such as `X-Forwarded-For` or `X-Real-IP` are explicitly ignored; only the physical socket address (`ConnectInfo<SocketAddr>`) is evaluated.
3. **Origin Validation:** If an `Origin` header is present, it must match an entry in `server.cors_origins` or the default local Vite dev server (`http://127.0.0.1:5173`, `http://localhost:5173`). Unapproved origins receive HTTP 403 `kind: "devBypassDenied"`.
4. **Native Origin-less Requests:** Loopback requests without an `Origin` header (such as local CLI tools or automated agents) are permitted.
5. **Assigned Principal:** Admitted requests receive principal `"dev-user"` with `is_dev: true`.

### Error Response Schema

All errors return JSON with HTTP status $\ge 400$:

```json
{
  "error": "human-readable description",
  "kind": "errorKindIdentifier"
}
```

| HTTP Status | Error Kind | Description |
| --- | --- | --- |
| 400 Bad Request | `invalidInput` | Missing or malformed parameters; oversized payload |
| 400 Bad Request | `invalidPath` | Malformed or traversal DevTools asset path |
| 400 Bad Request | `policyViolation` | URL violates network policy or contains credentials |
| 400 Bad Request | `purposeMismatch` | Ticket purpose does not match requested attachment endpoint |
| 400 Bad Request | `sequenceViolation` | Input sequence gap or stale sequence counter |
| 400 Bad Request | `invalidCoordinates` | Image fractions $u$ or $v$ outside range `0.0..=1.0` or non-finite |
| 400 Bad Request | `payloadTooLarge` | Insert text exceeds 4096 bytes or find query exceeds 256 characters |
| 401 Unauthorized | `unauthorized` | Missing bearer credentials or user not found |
| 401 Unauthorized | `sessionRevoked` | Session was revoked or auth version was incremented |
| 401 Unauthorized | `sessionExpired` | Session deadline has elapsed |
| 401 Unauthorized | `ticketNotFound` | Capability ticket not found or already consumed (single-use) |
| 401 Unauthorized | `ticketExpired` | Capability ticket 30s TTL expired |
| 401 Unauthorized | `invalidDevToolsToken` | Missing, expired, or revoked target-scoped DevTools capability token |
| 401 Unauthorized | `staleTarget` | Native target ID rotated since the DevTools lease was minted |
| 403 Forbidden | `forbidden` | Session belongs to another principal |
| 403 Forbidden | `adminRequired` | Caller lacks the required Admin role |
| 403 Forbidden | `devBypassDenied` | Non-loopback peer or unapproved Origin in `--no-auth` mode |
| 403 Forbidden | `accountDisabled` | User account is administratively disabled |
| 403 Forbidden | `originMismatch` | Ticket redeemed from an origin different from issuance origin |
| 403 Forbidden | `leaseNotFound` | No active control lease held for this session |
| 403 Forbidden | `leaseExpired` | Control lease has expired (30s TTL elapsed) |
| 403 Forbidden | `notLeaseHolder` | Caller lease token does not match active lease holder |
| 403 Forbidden | `viewerNotAdmitted` | Viewer lacks an active admitted attachment pair matching caller admission |
| 403 Forbidden | `controlAuthorityLost` | DevTools capability control epoch/viewer authority expired or transferred |
| 404 Not Found | `sessionNotFound` | Browser session ID does not exist |
| 404 Not Found | `assetNotFound` | Upstream Chromium DevTools asset returned non-2xx |
| 409 Conflict | `sessionConflict` | Conflicting session operation or state mismatch |
| 409 Conflict | `leaseConflict` | Control lease currently held by another active viewer |
| 409 Conflict | `leaseInUse` | DevTools WebSocket already active for this lease token |
| 409 Conflict | `staleIncarnation` | Browser instance is no longer live or incarnation/profileEpoch mismatch |
| 429 Too Many Requests | `browserBusy` | Principal/global process limit or concurrent agent CDP ceiling (`max_raw_cdp_connections`, cap 8) reached |
| 429 Too Many Requests | `tooManyDevToolsLeases` | DevTools lease limit reached (`8` per principal / `32` global) |
| 429 Too Many Requests | `tooManyConnections` | Concurrent target-scoped DevTools WebSocket ceiling (`4`) reached |
| 429 Too Many Requests | `ticketCapacityExceeded` | Unconsumed ticket limit reached (16 principal / 64 global) |
| 429 Too Many Requests | `queueOverflow` | Input queue limit exceeded (128 records or 256 KiB) |
| 502 Bad Gateway | `nativeCloseUnconfirmed` | Native close unconfirmed; session remains in `closing` status holding target capacity |
| 502 Bad Gateway | `nativeTargetUnavailable` | Session has no bound native target |
| 502 Bad Gateway | `cdpError` | Upstream CDP inspect or screenshot command failed |
| 502 Bad Gateway | `badGateway` | Upstream DevTools asset fetch failed or exceeded 4 MiB ceiling |
| 503 Service Unavailable | `authUnavailable` | Database unavailable during admission check or live check timeout (2s) |
| 503 Service Unavailable | `browserUnavailable` | Browser instance unavailable when resolving DevTools proxy target |
| 503 Service Unavailable | `inputUnavailable` | Viewport geometry not yet available for coordinate mapping |
| 503 Service Unavailable | `publicOriginUnavailable` | Raw CDP discovery requires trusted `DAM_HOPPER_PUBLIC_SERVER_ORIGIN`; request `Host` never reflected |
| 401 Unauthorized | `mfaRequired` / `invalidSession` | MFA verification required or claims version mismatch |
| 403 Forbidden | `forbiddenOrigin` / `leaseHeaderRequired` | Origin disallowed/missing for destructive reset or missing lease header |
| 400 Bad Request | `confirmationRequired` / `invalidOperationId` | Missing `confirmed: true` or malformed `operationId` (`<= 128` `[A-Za-z0-9_-]`) |
| 404 Not Found | `operationNotFound` / `terminalNotFound` | Unknown reset `operationId` or absent target PTY |
| 409 Conflict | `staleViewportEpoch` / `staleEpoch` | Mismatched `viewportEpoch` on input or stale `expectedProfileEpoch` on reset |
| 409 Conflict | `cleanupPending` / `resetFailed` | Active reset tombstone/worker or reset execution error |
| 409 Conflict | `conflict` / `noSelection` / `TERMINAL_INCARNATION_MISMATCH` | Stale revision, missing preview, or changed target PTY incarnation |

---

## 2. Browser Host REST Endpoints

All endpoints are prefixed with `/api/browser`. Request bodies are capped at 64 KiB.

### GET /api/browser/capabilities

Returns the browser host capability summary for the calling principal.

**Response (200 OK):**
```json
{
  "available": true,
  "reason": null,
  "processBudget": {
    "maxProcesses": 1,
    "maxTargetsPerProcess": 2,
    "maxViewersPerTarget": 4,
    "maxRawCdpConnections": 2,
    "memoryCeilingBytes": 1073741824
  },
  "profileEpoch": "1",
  "browserIncarnation": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "allowedTargetOrigins": ["http://127.0.0.1:5173", "http://localhost:5173"],
  "deniedDestinations": ["169.254.169.254", "metadata.google.internal"]
}
```

### GET /api/browser/sessions

Lists all active and transitioning browser sessions (`initializing`, `running`, `closing`, `lost`) owned by the authenticated principal. `closing` sessions hold target capacity until native absence is proven; `lost` reflects unexpected native page destruction.

**Response (200 OK):** Array of `BrowserSessionDto` objects.

### POST /api/browser/sessions

Creates or recovers a browser session. Requires an idempotent `creationKey`.

**Request Body:**
```json
{
  "creationKey": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "url": "http://127.0.0.1:5173",
  "viewport": {
    "width": 1280,
    "height": 720,
    "dpr": 1.0
  }
}
```

- `creationKey`: Non-empty client-provided UUID or idempotency string. Idempotency records are cached in-memory per principal up to 128 records for 10 minutes (`IDEMPOTENCY_TTL`). Retrying with the same key returns the existing session with HTTP 200 OK.
- `url`: Validated against network policy (see Section 5).
- `viewport`: Clamped to `width` $\in [64, 1920]$, `height` $\in [64, 1080]$, `dpr` $\in [1.0, 3.0]$.
- Target Capacity: Capped at configured `max_targets` (default 2), shared across REST sessions, raw CDP instances, and popups. Excess creates return HTTP 429 `kind: "browserBusy"`.

**Response (201 Created or 200 OK):** `BrowserSessionDto`.

### GET /api/browser/sessions/{id}

Retrieves current metadata, viewport epoch, navigation revision, active lease, active dialog, and optional current-revision `selection` summary (`{ active, selectionRevision, navigationRevision, preview? }`) for session `{id}`.

**Response (200 OK):**
```json
{
  "browserSessionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "browserIncarnation": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "profileEpoch": "1",
  "navigationRevision": "1",
  "viewportEpoch": "1",
  "url": "http://127.0.0.1:5173/",
  "title": "DamHopper",
  "status": "running",
  "geometry": {
    "cssWidth": 1280.0,
    "cssHeight": 720.0,
    "dpr": 1.0,
    "scale": 1.0,
    "offsetTop": 0.0,
    "scrollOffsetX": 0.0,
    "scrollOffsetY": 0.0
  },
  "inputAvailable": true,
  "unavailableReason": null,
  "dialog": null,
  "lease": {
    "viewerId": "viewer-uuid-1",
    "holderKind": "human",
    "expiresAtUnixMs": 1794142800000
  },
  "popupBlocked": false,
  "activePopupSessionId": "a1b2c3d4-0000-4000-8000-000000000001",
  "parentSessionId": null
}
```

- `activePopupSessionId` *(optional)*: Present when an admitted popup child session opened by this session is currently `running`. Automatically cleared and published via `sessionUpdated` when the popup session closes or is lost.
- `parentSessionId` *(optional)*: Present on admitted popup sessions, identifying the opener `browserSessionId` so the Browser App can display the popup session and restore the opener when OAuth sign-in completes (`window.close()`) or when the user clicks **Return to Page**.
- `lastDownload` *(optional `BrowserDownloadSummaryDto`)*: Present once a native host download begins on the session (`{ "guid": "...", "suggestedFilename": "...", "state": "inProgress" | "completed" | "canceled", "receivedBytes": 0, "totalBytes": 0, "filePath": "/path/to/file" }`; `filePath` omitted when absent). Updated from CDP `Browser/Page.downloadWillBegin` and `Browser/Page.downloadProgress` events and broadcast via `sessionUpdated`.

The summary reports the latest download for the session, not a download history. `filePath` is optional even on completion and refers to the server host, not the viewer device. The exact-path assertion in the real-Chromium qualification test applies when Linux Chromium is installed; other platforms must tolerate omission.

### DELETE /api/browser/sessions/{id}

Closes session `{id}`. Cleans up selection/watcher state, stops screencast producer, revokes session capability tickets, releases held leases, and proves native page destruction.

- **Response (200 OK):** `{ "status": "closed", "browserSessionId": "<id>" }` when native absence is confirmed.
- **Response (502 Bad Gateway):** `{ "error": "<msg>", "kind": "nativeCloseUnconfirmed", "status": "closing", "browserSessionId": "<id>" }` when native close could not be confirmed; session stays in `closing` state and continues to hold target capacity.

### POST /api/browser/sessions/{id}/navigate

Navigates the session to a new URL.

**Request Body:**
```json
{
  "url": "http://127.0.0.1:5173/dashboard",
  "navigationRevision": 1
}
```

- Clears the session's selected-text buffer.
- Increments `navigationRevision`.
- Evaluates destination URL against network policy.

**Response (200 OK):** Updated `BrowserSessionDto`.

### POST /api/browser/sessions/{id}/history

Navigates back or forward in history.

**Request Body:**
```json
{
  "direction": "back",
  "navigationRevision": 2
}
```

- `direction`: `"back"` or `"forward"`.
- Increments `navigationRevision`.

**Response (200 OK):** Updated `BrowserSessionDto`.

### POST /api/browser/sessions/{id}/reload

Reloads the current target.

**Request Body:**
```json
{
  "navigationRevision": 3
}
```

**Response (200 OK):** Updated `BrowserSessionDto`.

### PUT /api/browser/sessions/{id}/viewport

Mutates target viewport dimensions and device pixel ratio.

**Request Body:**
```json
{
  "leaseToken": "lease-token-uuid",
  "viewportEpoch": 1,
  "width": 1440,
  "height": 900,
  "dpr": 2.0
}
```

- If a control lease is active, the caller must supply a valid `leaseToken` matching the active lease holder.
- Increments `viewportEpoch`.

**Response (200 OK):** Updated `BrowserSessionDto`.

### POST /api/browser/sessions/{id}/control/acquire

Acquires exclusive cooperative control of the session for input dispatch and viewport modification.

**Request Body:**
```json
{
  "viewerId": "viewer-uuid-1",
  "holderKind": "human"
}
```

- `holderKind`: `"human"` or `"agent"`.
- Lease duration: 30 seconds (`LEASE_TTL`).
- If another viewer holds an active non-expired lease, returns HTTP 409 Conflict with `kind: "leaseConflict"`.

**Response (200 OK):**
```json
{
  "leaseToken": "uuid-v4-lease-token",
  "expiresAtUnixMs": 1794142830000
}
```

### POST /api/browser/sessions/{id}/control/renew

Renews an active control lease held by the caller before expiry.

**Request Body:**
```json
{
  "leaseToken": "uuid-v4-lease-token"
}
```

- Extends expiry by 30 seconds, clipped by the caller's auth session deadline.

**Response (200 OK):**
```json
{
  "leaseToken": "uuid-v4-lease-token",
  "expiresAtUnixMs": 1794142860000
}
```

### POST /api/browser/sessions/{id}/control/release

Explicitly surrenders the control lease.

**Request Body:**
```json
{
  "leaseToken": "uuid-v4-lease-token"
}
```

- Generates synthetic release events for any currently held mouse buttons and keyboard keys to prevent stuck state in Chromium.
- Revokes the lease in the input manager and session registry.

**Response:** 204 No Content.

### POST /api/browser/sessions/{id}/dialog

Handles a JavaScript modal dialog (`alert`, `confirm`, `prompt`, `beforeunload`).

**Request Body:**
```json
{
  "leaseToken": "uuid-v4-lease-token",
  "dialogId": "dialog-uuid",
  "accept": true,
  "promptText": "optional user input"
}
```

- Validates that caller holds the active control lease.

**Response (200 OK):**
```json
{
  "dialogId": "dialog-uuid",
  "status": "handled"
}
```

### POST /api/browser/sessions/{id}/selection/start

Enables CDP `Overlay` inspect mode (`mode: "searchForNode"`) or executes one-shot point inspection when `inspectPoint` is supplied (`deny_unknown_fields`, renews active control lease). Returns HTTP `409 Conflict` (`kind: "conflict"`) on `navigationRevision` mismatch or non-`running` session.

**Request Body:** `{ "leaseToken": "uuid-v4-lease-token", "navigationRevision": 1, "inspectPoint": { "x": 120, "y": 240 } }` (`navigationRevision` accepts `u64` or decimal string; `inspectPoint` optional).  
**Response (200 OK):** `{ "selectionActive": true, "navigationRevision": 1, "selectionRevision": 1, "preview": null }` (`preview` is `BrowserSelectionV1` when `inspectPoint` matches a node; omits form values, passwords, raw HTML, and control bytes).

### POST /api/browser/sessions/{id}/selection/cancel

Cancels active CDP `Overlay` inspect mode, clears any recorded preview, and force-invalidates unclaimed pending selection artifacts (`deny_unknown_fields`, renews active control lease). Returns HTTP `409` on stale `navigationRevision`.

**Request Body:** `{ "leaseToken": "uuid-v4-lease-token", "navigationRevision": 1 }`  
**Response (200 OK):** `{ "selectionActive": false, "navigationRevision": 1, "selectionRevision": 1 }`.

### POST /api/browser/sessions/{id}/selection/artifacts

Creates an actor-bound `ManagedBrowser` artifact from the live selection preview and optionally captures a cropped CDP PNG (`<= 4 MiB` at `1.0x` or `0.5x` clip scale; skipped gracefully unless `includePng: true`). Revalidates session status, `navigationRevision`, `selectionRevision`, live Admin admission, and exact `terminalIncarnation` before and after PNG upload (`deny_unknown_fields`).

**Request Body:** `{ "selectionRevision": 1, "terminalId": "terminal-uuid", "terminalIncarnation": "1", "navigationRevision": 1, "includePng": true }` (`navigationRevision` and `includePng` optional; defaults to attempting PNG capture).  
**Response (201 Created):** Flattened `BrowserDebugArtifactResponse` (`artifactId`, `terminalId`, `terminalIncarnation`, `expiresAt`, `jsonPath`, `jsonSize`, `jsonSha256`, optional `pngPath`, `pngSize`, `pngSha256`) plus `selectionRevision`, `navigationRevision`, and `selection` (`BrowserSelectionV1`). Note: `GET /api/browser/sessions/{id}` exposes `selection` once recorded, and navigation watchers invalidate selections/pending artifacts on main-frame or same-document CDP navigation.

### POST /api/browser/sessions/{id}/find

Searches for text in the page.

**Request Body:**
```json
{
  "leaseToken": "uuid-v4-lease-token",
  "query": "search query",
  "forward": true
}
```

- Query length is capped at 256 characters (`MAX_FIND_QUERY_CHARS`). Oversized queries return HTTP 400 `kind: "payloadTooLarge"`.

**Response (200 OK):**
```json
{
  "query": "search query",
  "matchCount": 1
}
```

### GET /api/browser/sessions/{id}/selected-text

Reads the current page selection via a 1s-bounded CDP `Runtime.evaluate` when an active page session is present (excluding `input[type=password]`, bounded to 64 KiB / valid UTF-8, falling back to the cached value if CDP evaluation fails). Revalidates session authority (`navigationRevision`, `browserIncarnation`, `profileEpoch`) and lease validity after evaluation before caching or returning text.

- **Required Header:** `X-Browser-Lease: <lease-token>`.
- The `X-Browser-Lease` header is explicitly exposed in server CORS configurations for approved origins.
- Returns HTTP 403 (`leaseHeaderRequired`, `leaseNotFound`, `leaseExpired`, or `notLeaseHolder`) if the header is missing or the lease is invalid/expired, and HTTP 409 (`sessionConflict`) if session authority changes during evaluation.

**Response (200 OK):**
```json
{
  "text": "Selected text string"
}
```

### POST /api/browser/attachments

Issues a cryptographically secure, single-use capability ticket for WebSocket streaming attachment.

**Request Body:**
```json
{
  "purpose": "media",
  "browserSessionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "viewerId": "viewer-uuid-1",
  "subscriptionEpoch": "1",
  "browserIncarnation": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "profileEpoch": 1
}
```

- `purpose`: `"media"`, `"control"`, or `"agentCdp"`.
- For `"media"` and `"control"`, `browserSessionId`, `viewerId`, and `subscriptionEpoch` are strictly required.
- Single-use capability tickets expire after 30 seconds (`TICKET_TTL = 30s`), clipped to the caller's auth session deadline.
- Unconsumed tickets are capped at 16 per principal and 64 globally.

**Response (200 OK):**
```json
{
  "ticket": "43-character-url-safe-base64-random-token",
  "expiresAtUnixMs": 1794142830000
}
```

### POST /api/browser/profile/reset

Triggers a durable, idempotent profile reset (`deny_unknown_fields`). Enforces live Admin admission, CSRF/Origin validation (`validate_destructive_browser_csrf`: single allowed Origin or explicit Bearer auth), `confirmed: true`, valid `operationId` (`<= 128` `[A-Za-z0-9_-]`), and matching `expectedProfileEpoch`, then rechecks live Admin role under the principal lock before writing `reset.json` and advancing `profileEpoch`.

- Synchronously fences attachments, sessions, input managers, selection state, and `ManagedBrowser` artifacts, then runs bounded async artifact deletion + CDP/process teardown (10s terminate + 10s `user-data/` delete) inside a manager-owned worker; awaits up to 2s (`DEFAULT_RESET_WAIT_TIMEOUT`) before returning `202 Accepted` `cleanupPending`.
- Keeps current login active; returns `409` (`staleEpoch`, `cleanupPending` with active `operationId`, or `resetFailed`).

**Request Body:** `{ "operationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "expectedProfileEpoch": 1, "confirmed": true }`  
**Response (200 OK or 202 Accepted):** `{ "operationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "status": "completed" | "cleanupPending", "profileEpoch": 2, "newProfileEpoch": 2 }` (`newProfileEpoch` when `"completed"`, `reason` when `"cleanupPending"`).

### GET /api/browser/profile/reset/{operationId}

Queries status of an active, pending-tombstone, or completed reset operation without creating metadata (`200 OK` with `"completed"` or `"cleanupPending"` payload; `404` `operationNotFound`).

### Actor-Bound Debug Artifacts (`/api/browser-debug/artifacts`)

Selection artifacts created via `/api/browser/sessions/{id}/selection/artifacts` are tagged internally with immutable owner subject and `ArtifactSource::ManagedBrowser { principal, profile_epoch, browser_incarnation }`, while public `POST /api/browser-debug/artifacts` (`deny_unknown_fields`) always assigns `ArtifactSource::Cooperative` (see [System Services API](./system-services.md#browser-debug-artifacts) for base payloads).
- **Live Admission & Demotion:** Every `ManagedBrowser` upload, delete, and `/handoff` checks `BrowserAdmissionAuthority` (enabled Admin or `--no-auth` dev, matching `profileEpoch`, and no active reset tombstone); same-subject Admin demotion or foreign access returns indistinguishable `404`.
- **Quota & Atomic Handoff:** Bounded to 64 records / 64 MiB globally with cancellation-safe guards (`QuotaReservationGuard`, `UploadReservationGuard`, `PublishedPathCleanupGuard`); `/handoff` holds `acquire_managed_selection_fence` and executes atomic `write_if_incarnation` (reference paths only, never page content) and `revoke_managed_by_principal` purges artifacts on profile reset.

### GET /api/browser/cdp/json/version

Returns browser DevTools version metadata for the calling principal. Automatically launches or attaches to the principal's browser process via `ensure_running`.

- **Rewritten Debugger URL:** `webSocketDebuggerUrl` rewrites internal DevTools loopback IP/port (`127.0.0.1:{chrome_port}`) to `{gateway_ws_base}/api/browser/cdp/ws`. `{gateway_ws_base}` is derived strictly from `DAM_HOPPER_PUBLIC_SERVER_ORIGIN` (mapping `http` to `ws` and `https` to `wss`) or loopback listener in dev mode; request `Host` is never reflected. Unconfigured origin returns HTTP 503 `kind: "publicOriginUnavailable"`.
- **Origin Validation:** Enforces single approved Origin byte-for-byte; unauthenticated requests fail with HTTP 401 first to prevent Origin probing (`dev_fallback` restricted to `--no-auth`).
- **Payload Bounds:** Chunk-bounded response reading up to 64 KiB ceiling via `read_bounded_bytes`.
**Response (200 OK):**
```json
{
  "Browser": "Chrome/157.0.8103.38",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 ...",
  "V8-Version": "12.0.0.0",
  "WebKit-Version": "537.36 ...",
  "webSocketDebuggerUrl": "ws://127.0.0.1:4801/api/browser/cdp/ws"
}
```

### GET /api/browser/cdp/json/list (and /api/browser/cdp/json)

Lists all active DevTools targets for the calling principal's browser instance.

- **URL Rewriting:** `webSocketDebuggerUrl` rewrites internal DevTools loopback IP/port to `{gateway_ws_base}/api/browser/cdp/ws/{target_id}` using `DAM_HOPPER_PUBLIC_SERVER_ORIGIN` (returns 503 `publicOriginUnavailable` if unconfigured).
- **Frontend Sanitization:** `devtoolsFrontendUrl` loopback DevTools ports are replaced with the sanitized public gateway host.
- **Payload Bounds:** Chunk-bounded response reading up to 256 KiB ceiling via `read_bounded_bytes`.
**Response (200 OK):**
```json
[
  {
    "description": "",
    "devtoolsFrontendUrl": "/devtools/inspector.html?ws=127.0.0.1:4801/api/browser/cdp/ws/PAGE-UUID",
    "id": "PAGE-UUID",
    "title": "DamHopper",
    "type": "page",
    "url": "http://127.0.0.1:5173/",
    "webSocketDebuggerUrl": "ws://127.0.0.1:4801/api/browser/cdp/ws/PAGE-UUID"
  }
]
```

### GET /api/browser/cdp/ws (and /api/browser/cdp)

WebSocket upgrade route for raw CDP access to the browser instance root DevTools target.

- **Authentication:** Evaluates Bearer token in `Authorization` header, auth cookie, or single-use capability ticket in `Sec-WebSocket-Protocol: damhopper.ticket.<base64url>`.
- **Subprotocol:** Client may optionally request subprotocol `damhopper.browser.cdp.v1`.
- **Concurrency Limit:** Governed by `budgets.max_raw_cdp_connections` (defaults to 2, hard capacity ceiling `MAX_AGENT_CDP_CAPACITY = 8`). Excess connections return HTTP 429 `kind: "browserBusy"`.

### GET /api/browser/cdp/ws/{target_id}

WebSocket upgrade route for raw CDP access to a specific target `{target_id}` (`1..128` ASCII alphanumeric, `-`, `_`).

- Connects dedicated upstream WebSocket to `ws://127.0.0.1:{chrome_port}/devtools/page/{target_id}`.

### POST /api/browser/sessions/{id}/devtools

Mints a target-scoped Chromium DevTools capability lease for an owned `running` browser session whose `browserIncarnation` is live.

- **Token & Storage:** 256-bit `OsRng` token encoded as URL-safe unpadded Base64; server stores only its SHA-256 hash (`DevToolsLeaseManager`).
- **TTL & Capacity:** `300` seconds (`DEVTOOLS_LEASE_TTL`), clipped to caller auth `effective_deadline`. Capped at `8` active leases per principal (`MAX_LEASES_PER_PRINCIPAL`) and `32` globally (`MAX_LEASES_GLOBAL`); excess returns HTTP 429 `kind: "tooManyDevToolsLeases"`.
- **Errors:** Foreign session returns HTTP 404 `sessionNotFound`; non-running session returns HTTP 409 `sessionConflict`; stale browser incarnation returns HTTP 409 `staleIncarnation`.

**Request Body (`CreateDevToolsLeaseRequest`, `deny_unknown_fields`):** `{ "viewerId": "...", "leaseToken": "..." }` (bounded non-empty identifiers: `viewerId <= 128`, `leaseToken <= 256`). Validates existing `SessionInputManager` control authority (`verify_control_authority_for_mint` with `subtle::ConstantTimeEq`, returning `403 leaseNotFound` if absent or `503 inputUnavailable` during recovery/uncertain state), `has_admitted_viewer_pair` (`403 viewerNotAdmitted`), links `DevToolsLease::cancel` to epoch cancellation, and rechecks post-insert. Stores only SHA-256 hash + `(viewer_id, control_epoch)`, never `leaseToken`.

**Response (200 OK, `Cache-Control: no-store`):**
```json
{
  "token": "43-character-url-safe-base64-token",
  "expiresAtUnixMs": 1794143100000,
  "browserSessionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "viewerId": "viewer-uuid-or-id",
  "controlEpoch": "1",
  "browserIncarnation": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "profileEpoch": "1"
}
```

### DELETE /api/browser/sessions/{id}/devtools/{token}

Revokes a DevTools capability lease owned by the calling principal for session `{id}` and cancels any active DevTools WebSocket bound to it. Foreign sessions return HTTP 404 `sessionNotFound`.

**Response (200 OK, `Cache-Control: no-store`):**
```json
{
  "revoked": true
}
```

### GET /api/browser/devtools/{token}/{*path}

Proxies Chromium's bundled DevTools frontend assets from `http://127.0.0.1:{chrome_port}/devtools/{path}` using the minted capability `{token}` (path token acts as capability credential; no `Authorization` header required).

- **Path Validation (`validate_devtools_asset_path`):** Rejects empty paths, leading/trailing `/`, `\`, `..`, `?`, `#`, empty/dot segments, or characters outside `[A-Za-z0-9._/-]` with HTTP 400 `invalidPath`.
- **Authority & TTL Refresh:** Validates token, live auth (`verify_live_admission`), live control authority (`is_control_authority_live` -> `403 controlAuthorityLost`), live admitted viewer pair (`has_admitted_viewer_pair` -> `403 viewerNotAdmitted`), live incarnation/epoch, and matching `native_target_id` (stale/revoked/expired returns HTTP 401 `invalidDevToolsToken`, `invalidSession`, `staleIncarnation`, or `staleTarget`; failures revoke the lease), refreshing the 300s sliding TTL clipped to auth deadline.
- **Bounds & Headers:** 2s upstream timeout (`DEVTOOLS_ASSET_TIMEOUT`), redirects disabled, 4 MiB ceiling (`MAX_DEVTOOLS_ASSET_BYTES`). `text/html*` responses rewrite `ws://127.0.0.1:*` in CSP to `'self' ws: wss: ws://127.0.0.1:*` with `Cache-Control: no-store`; non-HTML assets return `Cache-Control: private, max-age=300`. All responses set `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.

### GET /api/browser/devtools/{token}/ws

Target-scoped WebSocket relay connecting to `ws://127.0.0.1:{chrome_port}/devtools/page/{native_target_id}` (`UPSTREAM_CONNECT_TIMEOUT = 5s`, `MAX_WS_MESSAGE_BYTES = 4 MiB`).

- **Single Claim & Concurrency:** Each lease token admits at most one active WebSocket (`ws_active = true`; duplicate upgrade returns HTTP 409 `leaseInUse`), rechecks control authority & viewer pair post-upstream-connect, and caps global concurrent DevTools WebSockets at `4` (`MAX_DEVTOOLS_CONNECTIONS` -> `429 tooManyConnections`).
- **Live Auth & Revocation:** Runs 5s periodic `verify_live_admission`, `refresh_ws`, `is_control_authority_live`, and `has_admitted_viewer_pair` checks, global payload reservation (`global_memory_controller`), and `write_with_cancel(..., Some(&lease.cancel))` (raw CDP gateway retains `None`). Auth session revocation, control transfer/reacquire (`revoke_by_control_epoch`), viewer revocation (`revoke_by_viewer`), principal fencing, and session retirement cancel active sockets immediately.
- **Client->Upstream Filter & Shared `Input.*` Ledger (`classify_devtools_client_message`):** Rejects batch arrays, `Browser.*`, cross-target `Target.*`, forbidden `Network.*`/`ServiceWorker.*`/`BackgroundService.*`/`Storage.*`, `Page.setDownloadBehavior`, and viewport-mutating `Emulation.*` with `-32601`. Admits `Input.dispatchKeyEvent` (`keyDown`/`rawKeyDown`/`keyUp`/`char`), `Input.dispatchMouseEvent` (`mousePressed`/`mouseReleased`/`mouseMoved`/`mouseWheel`, `pointerType: "mouse"`), and `Input.insertText` (`<= 4096` bytes) under `MAX_INFLIGHT_DEVTOOLS_OPS = 64` into shared `HeldInputState` (`prepare_cdp_input_op` -> `confirm`/`reject`/`mark_ambiguous`); touch/drag/gesture/IME/`setIgnoreInputEvents`/unknown `Input.*` return `-32601`. Unresolved DevTools WS close triggers `fence_devtools_authority` and releases held inputs via `DevToolsProxyReleaseRoute` / `NativeInputTarget`.
- **Upstream->Client Filter (`DevToolsUpstreamFilter`):** Suppresses `Target.targetCreated` and `Target.targetInfoChanged` for foreign `page` / `browser_ui` targets (tracking up to `256` foreign IDs) and their matching `Target.targetDestroyed` events, while forwarding worker/child targets.

---

## 3. Single-Use Capability Tickets (`AttachmentManager`)

WebSocket attachments for media frames, control channels, and agent CDP debugging connect using short-lived capability tickets rather than long-lived tokens:

```mermaid
flowchart TD
    Client["Client / Viewer"] -->|POST /api/browser/attachments| API["Browser Host API"]
    API -->|Generate 256-bit OsRng| Token["Random Ticket Token"]
    API -->|Store SHA-256 Hash| Store["Memory Ticket Store"]
    API -->|Return Token| Client
    Client -->|WS Connect ?ticket=...| WS["WebSocket Upgrade Handler"]
    WS -->|Atomic remove by SHA-256| Store
    Store -- Success --> Upgrade["Admit Connection & Pair Sockets"]
    Store -- Missing/Consumed --> Deny["Close 4401 ticketNotFound"]
```

### Ticket Invariants

1. **Entropy & Encoding:** Tickets are 256-bit (32-byte) random values from `rand::rngs::OsRng`, URL-safe unpadded Base64 encoded (`URL_SAFE_NO_PAD`).
2. **SHA-256 Hash Storage:** The server computes `sha256(raw_bytes)` and stores only the 32-byte hash in memory. Raw ticket tokens are never stored, logged, or serialized.
3. **Atomic Single-Use Consumption:** During WebSocket upgrade, `consume_ticket` atomically removes the ticket hash from the in-memory map. Replay attempts fail immediately with HTTP 401 `ticketNotFound`.
4. **Binding Constraints:** The ticket strictly binds:
   - Purpose (`media`, `control`, `agentCdp`)
   - Principal and `is_dev` mode
   - Auth session ID, `auth_version`, `credential_version`, and `effective_deadline`
   - `profileEpoch` and `browserIncarnation`
   - `browserSessionId`, `viewerId`, and `subscriptionEpoch`
   - Issuing `Origin` header (must match redeeming request origin)
5. **Media & Control Pairing (`PairedSlot`):**
   - Media and Control connections must be issued with matching `viewerId` and `subscriptionEpoch`.
   - The first arriving socket enters a `PairedSlot` waiting for its matching partner.
   - If the second socket does not connect within 15 seconds (`PAIR_WAIT_TIMEOUT`), the slot is evicted and both sockets are cancelled.
6. **Live Cancellation Supervisor:**
   - Active attachments share a `CancellationToken`.
   - The auth supervisor runs every 5 seconds with a 2-second timeout.
   - On account disable, Admin demotion, session revocation, or credential version increment, the cancellation token triggers immediate socket abort.

---

## 4. Leased Input Queue & Coordinate Transformation (`SessionInputManager`)

User input is routed exclusively through the active control lease holder:

### Cooperative Lease Semantics

- **Lease Duration:** 30 seconds (`LEASE_TTL = Duration::from_secs(30)`).
- **Renewal Window:** 5 seconds (`LEASE_RENEWAL_WINDOW = Duration::from_secs(5)`).
- **Single Active Holder:** Only one viewer (`holderKind: "human" | "agent"`) may hold control per session.
- **Fail-Safe Release & Ordered Transitions:** Control lease transitions (`acquire_lease`, `end_lease_owned`, `suspend_for_recovery_owned`, `fail_native_dispatch_owned`) fence old authority & revoke epoch DevTools capabilities, drain bounded DevTools ops (`DEVTOOLS_OP_DRAIN_TIMEOUT = 5s`), release pending + confirmed holds in shared `HeldInputState` (`CapturedNativeIdentity`), run `lease_end_hook`, and confirm before publishing a successor (`BrowserApp` / `BrowserDevToolsDock` show `browser-devtools-control-required` without auto-stealing).

### Reliable Input Queue

- **Capacity Bounds:** Max 128 reliable records (`MAX_RELIABLE_RECORDS`), max 256 KiB payload bytes (`MAX_RELIABLE_BYTES`).
- **Contiguous Input Sequence (`inputSeq`):** Decimal `u64` sequence string. The manager validates `inputSeq == last_processed_seq + 1`:
  - Sequence gap (`inputSeq > expected`): Returns HTTP 400 `sequenceViolation`, flushes queue, releases held inputs, and revokes lease.
  - Stale sequence (`inputSeq <= last_processed_seq`): Dropped as stale with HTTP 400 `sequenceViolation`.
- **Event Coalescing:** Consecutive `PointerMove` and `Wheel` events are coalesced between ordering barriers (`PointerDown`, `PointerUp`, `KeyDown`, `KeyUp`, `InsertText`).

### Coordinate Transformation (`map_fraction_to_css_coords`)

Input coordinates are received as aspect-fit normalized image fractions:
- $u \in [0.0, 1.0]$: Horizontal position fraction.
- $v \in [0.0, 1.0]$: Vertical position fraction.

Transformation formula:
$$\begin{aligned}
x &= u \times \text{css\_width} \\
y &= v \times \text{css\_height} + \text{offset\_top}
\end{aligned}$$

- **Strict Invariants:**
  - $u$ and $v$ must be finite and within `0.0..=1.0`; violations return `InputError::InvalidFraction`.
  - Missing geometry or dimensions $\le 0$ return `InputError::GeometryUnavailable` (HTTP 503 `inputUnavailable`).
  - Viewport scroll offsets (`scrollOffsetX`, `scrollOffsetY`) are metadata and are **not** added to mouse coordinates.
  - Device pixel ratio (`dpr`) rescales screencast images only; layout coordinates operate directly in CSS pixels and are never multiplied twice.
### Viewport Epoch Fencing & Geometry Invalidation

When native CDP commands (such as `Emulation.setDeviceMetricsOverride`) alter viewport dimensions, the session registry advances layout state via `fence_geometry_and_advance_epoch`:
- **Epoch Advance:** Session layout dimensions are updated and `viewport_epoch` is incremented.
- **Input Manager Synchronization:** The session's `SessionInputManager` records the new expected epoch via `set_expected_viewport_epoch`.
- **Stale Input Rejection:** `dispatch_reliable_input` strictly validates `msg.viewport_epoch == expected_epoch`. Any input dispatched with a mismatched or stale epoch fails closed with `InputError::StaleViewportEpoch` (mapped to HTTP 409 Conflict `kind: "staleViewportEpoch"`), immediately clears held keys/buttons, and flushes queued input.


---

## 5. Navigation, Network Policy & Native Downloads (`network_policy.rs`, `selection.rs`)

URLs submitted to `POST /api/browser/sessions` and `POST /api/browser/sessions/{id}/navigate` (`validate_navigation_url`) and browser-initiated requests intercepted by CDP Fetch (`NetworkPolicy::check_request`) undergo strict policy validation:

- **Length Bounds:** Maximum URL length 4096 bytes (`MAX_URL_BYTES`); maximum page title 512 bytes (`MAX_TITLE_BYTES`).
- **REST Navigation Schemes (`validate_navigation_url`):** Strictly `http`, `https`, and `about:blank`. All other schemes (`file:`, `javascript:`, `chrome:`, `data:`, `blob:`) are rejected.
- **CDP Fetch Interceptor Schemes (`NetworkPolicy::check_request`):**
  - `http` / `https`: Evaluated against `evaluate_network_url` (`Navigation` vs `Subresource`).
  - `data:`: Allowed for subresources and navigation/download fetches (such as `<a download>` document triggers).
  - `blob:`: Allowed unconditionally for subresources; for `RequestKind::Navigation`, parses the embedded inner URL and requires an `http` or `https` inner scheme passing `evaluate_network_url(..., RequestKind::Navigation)` (denying `blob:null/...`, `blob:file:///...`, and metadata/denied origins).
  - `about:`: Allowed for `about:blank` and `about:srcdoc` (and any `about:` subresource).
  - All other schemes (`file:`, `ftp:`, `javascript:`, `chrome:`, extension schemes) are denied.
- **Credentials Forbidden:** URLs containing embedded username or password fields (e.g. `https://actor:token@domain.example`) are rejected.
- **Loopback Access:** HTTP(S) destinations on `localhost`, `.localhost`, IPv4 loopback (`127.0.0.0/8`), and IPv6 loopback (`::1`, including mapped IPv4) are allowed on any port without an origin entry, in both production and development. Loopback refers to the server-hosted browser's network namespace, not necessarily the user's device. Navigations and subresources are subject to explicit `denied_destinations` entries.
- **Private & Metadata Blocking:** Other private, link-local, broadcast, unspecified, and documentation IP ranges require an explicitly allowed target origin (or asset origin for subresources). Cloud metadata destinations remain denied even when explicitly allowed. Configured destination denies take precedence over all allowances.
- **Security:** Any page opened in the hosted browser may attempt requests to server-loopback services. Protect sensitive local services with authentication and origin checks; loopback binding alone is not an access-control boundary. Browser network policy is not a complete egress sandbox and does not cover DNS resolution, WebSocket, or WebRTC.
- **Public Internet:** HTTP(S) public destinations are permitted in both production and development.
- **Native Host Downloads (`Browser.setDownloadBehavior`):** `install_navigation_watcher` (`selection.rs`) enables native Chromium downloads (`behavior: "allow"`, `eventsEnabled: true`) into `resolve_host_downloads_dir()` (`XDG_DOWNLOAD_DIR` if absolute, else `$HOME`/`$USERPROFILE/Downloads`, fallback `$TMPDIR/dam-hopper-downloads`). `Browser/Page.downloadWillBegin` and `downloadProgress` CDP events update `BrowserSessionDto.lastDownload` and emit `sessionUpdated`.

---

## 6. Authenticated Agent CDP Gateway (`cdp_gateway.rs`)

The raw CDP gateway provides direct, authenticated Chrome DevTools Protocol access for automation agents (such as Playwright):

### Upstream Relay Bounds

- **Dedicated Connection:** Each agent connection establishes a dedicated, unshared upstream WebSocket client to Chromium's DevTools loopback port with a 5-second connection deadline (`UPSTREAM_CONNECT_TIMEOUT = 5s`).
- **Message & Frame Limits:** Max 4 MiB per message and frame (`MAX_WS_MESSAGE_BYTES = 4_194_304`).
- **Write Deadline:** 5-second timeout per message write (`WRITE_DEADLINE = 5s`).
- **Concurrency:** Governed dynamically by `config.browser.budgets.max_raw_cdp_connections` (default 2, hard capacity ceiling `MAX_AGENT_CDP_CAPACITY = 8`). Returns HTTP 429 `kind: "browserBusy"` on saturation.
- **Target Registration:** Gateway monitors upstream target events (`Target.targetCreated`, `Target.targetDestroyed`, `Target.targetInfoChanged`), updating `BrowserHostManager` active targets (bounded to 64 targets, ID $\le 64$ bytes, URL $\le 2048$ bytes).

### Live Auth Cancellation Racing with Socket Writes

1. **Live Supervisor:** An independent task runs every 5 seconds (`LIVE_CHECK_INTERVAL`) with a 2-second database timeout (`LIVE_CHECK_TIMEOUT`) calling `verify_live_admission`.
2. **Revocation & Demotion:** If the user account is disabled, the user is demoted from `Admin`, the session is revoked, or the auth deadline is reached, the supervisor signals an abort channel.
3. **Racing with In-Flight Writes (`write_with_cancel`):** Outgoing socket writes wrap send operations with `write_with_cancel`, racing the write future against both the auth abort channel and a pinned absolute deadline timer (`tokio::time::sleep_until`). If auth is revoked or the deadline expires while a write is stalled, the write is aborted immediately without blocking for the 5-second deadline.
4. **Fast Teardown & Sibling Isolation:** When aborted due to auth failure (`aborted_by_auth == true`), the relay skips the standard 500ms cooperative WebSocket close frame exchange and drops both client and upstream sockets immediately. Revoking one agent credential closes only its connection; sibling logins and independent native screencast sessions remain intact.

### Instance Authority & Lease Bypass Warning

Raw CDP operates at instance-level authority:
- Agents attached to the raw CDP gateway bypass cooperative input leases and target fences.
- An agent can inspect all pages, manipulate browser settings, and access host resources accessible to Chromium.
- Upon connection, the gateway registers the connection with `state.browser_host.register_agent_cdp` and logs an authoritative security warning.

---

## 7. Binary Media Streaming WebSocket Protocol (`GET /api/browser/media`)

Upgrades an authenticated WebSocket connection for binary BHJF screencast delivery:

### Connection Handshake

- **Route:** `GET /api/browser/media`
- **Subprotocol:** `Sec-WebSocket-Protocol: damhopper.browser.media.v1, damhopper.ticket.<base64url>`
- **Ticket Purpose:** Requires single-use capability ticket minted with `purpose: "media"`.
- **Capacity:** Capped at the configured `budgets.max_viewers` (clamped `1..=16`, default 2; `MAX_GLOBAL_VIEWERS = 2` is the fallback); returns HTTP 429 `browserBusy` on saturation.
- **Message & Frame Limits:** Max 1024 bytes per message and frame (`MAX_MEDIA_CONTROL_BYTES = 1024`).
- **Pairing deadline (observed):** A media socket must be paired with its control socket (same `viewerId` and `subscriptionEpoch`) within 15 s (`PAIR_WAIT_TIMEOUT`). A media-only client with no control socket works for about 15 s, then the server resets the connection without a close handshake, which drops that viewer's demand (and stops the screencast if it was the only viewer).

### Downstream Media Messages (Server -> Client)

The media WebSocket delivers binary video frames and interleaved UTF-8 JSON text messages:

- **Binary Screencast Frames (`BHJF` v1):** 16-byte atomic prefix (`BHJF`, `version: 1`), JSON target frame header (`browserSessionId`, `browserIncarnation`, `profileEpoch`, video `producerRun`, `viewportEpoch`, `frameSeq`, `width`, `height`, `captureTimeUnixMs`, `geometry`, `inputTrusted`), and raw JPEG binary stream validated against SOF markers. Frames captured below scale 1.0 (Low/Constrained) carry `inputTrusted: false` in production and are display-only for every input kind, not only pointer (the viewer drops pointer, wheel, key and text input and releases held input); only scale-1.0 frames are input-trusted. JPEG size is the CSS size times the capture scale at any DPR.
- **Audio Text Frames (`audioChunk`):** 12-key JSON text (`<= 8192` B, 24 kHz mono `pcm16le` base64). Uses dedicated `audioRun` UUID (replaces `producerRun` for audio source continuity across video capture restarts), `subscriptionEpoch`, `profileEpoch`, `docEpoch`, monotonic `audioSeq`, `data`. Subscriptions default audio-suppressed until first explicit `muteState`. A navigation never closes the socket: a chunk already being written completes under its old `docEpoch` (the viewer drops it once it has advanced), later queued chunks are dropped before the write.
- **Stream Quality Frames (`streamQuality`):** Authoritative 15-key JSON status (`kind`, `subscriptionEpoch`, `preference`, `producerRun`, `captureVersion`, `sharedTier`, `viewerTier`, `fps`, `jpegQuality`, `scale`, `imageWidth`, `imageHeight`, `audioSuppressed`, `audioReason`, `status`). Emitted on attach and state changes; `preference` echoes server-acked client preference; `warming`/`unavailable` are non-applied placeholders; `effective`/`switching` reflects one proven snapshot; `captureVersion` is monotonic decimal u64 per run; `audioReason` distinguishes `muted`, `bandwidth`, `hidden`, `stalled`. Observed behavior (Linux, Chromium 156.0.8078.79):
  - `sharedTier` is the tier of the last proven snapshot and lags FPS-only steps (stage 1 -> 0, 3 -> 2 start no new capture run): `viewerTier` and `fps` change but `sharedTier` keeps its old label, so a consumer cannot observe `sharedTier: "high"` after an FPS-only recovery.
  - Tier labels follow the ladder position (0 High, 1-2 Medium, 3-5 Low, 6-8 Constrained). The `Constrained` label and `audioReason: "bandwidth"` begin at the 750-scale 2 fps rung (stage 6), not only at scale 0.5.
  - A stalled viewer still receives about 6 s of audio (5.9-7.0 s, about 120 chunks) before `audioReason: "stalled"`; after the reason is published no chunk follows. `muted` is effective within about 10 ms, `hidden` within about 1 s (one controller tick, no chunk after the heartbeat), `bandwidth` after the viewer reaches the 2 fps rung (12-14 s of sustained lag in the live test).
  - If the only viewer with visible demand is hidden, the server stops producing audio entirely (audio production needs at least one visible viewer). A viewer whose heartbeats stop for 15 s is dropped from the adaptive controller while its socket stays open; it then gets a `muted` quality event and no audio or policy until it reconnects (the client heartbeat every 5 s is mandatory).
  - A fresh unmute replays no backlog: the first chunk is newer than the broadcast at the request (muted: about 25-40 ms; hidden/stalled: about 0.5 s, 9-10 chunks skipped).
  - Measurement limits: the server exposes no per-frame service p95, only a baseline and EWMA, and a viewer's controller stage is not exported (use `viewerTier`/`fps`). These behaviors were measured on one Linux host; they are not deployed-engine guarantees.

### Client Control Messages (Client -> Server)

Client sends JSON text messages ($\le 1024$ bytes) to manage credit flow, visibility, fidelity preference, and audio gating:

| Kind | Required Fields | Semantics |
| --- | --- | --- |
| `frameAck` | `subscriptionEpoch`, `producerRun`, `viewportEpoch`, `frameSeq`, optional `decodeMs`, `reason` | Returns credit for admitted frame. Flushes pending buffer if rate governor permits. |
| `frameDiscarded` | `subscriptionEpoch`, `producerRun`, `viewportEpoch`, `frameSeq`, optional `reason` (`replaced`, `obsolete`, `hidden`, `decodeFailed`, `ownerChanged`) | Discards frame and returns credit without display. |
| `pause` | `subscriptionEpoch` | Pauses delivery and detaches demand. Resuming requires a fresh media socket and ticket. |
| `heartbeat` | `subscriptionEpoch`, `visible: bool`, optional `telemetry` | Renews viewer visibility demand (5s cadence; expires after 15s). |
| `qualityPreference` | `subscriptionEpoch`, `preference: "auto"\|"high"\|"medium"\|"low"` | Sets requested fidelity ceiling (coalesced $\le 4$/s; view-only permitted without lease). |
| `muteState` | `subscriptionEpoch`, `muted: bool` | Updates audio delivery gate (coalesced $\le 4$/s; `muted=true` applies immediate local silence). |

*Invariants & Deployment:* Controls bind strictly to socket `subscriptionEpoch`; foreign or stale controls are rejected. Phase 03+04 must deploy as a matched backend/UI pair (`audioRun` cutover); the previous matched backend/UI pair (static capture policy) is the rollback. Calibration outcome, limitations (downscaled frames input-untrusted, text shrinking on 300 ms paths, slow 10 Mbps/40 ms ramp) and remaining release prerequisites: [`calibration-qualification.md`](../../plans/261112-1205-browser-adaptive-stream-quality-and-performance/reports/calibration-qualification.md).
---

## 8. Control & Event Streaming WebSocket Protocol (`GET /api/browser/control`)

Upgrades an authenticated WebSocket connection for ordered user input and session events:

### Connection Handshake

- **Route:** `GET /api/browser/control`
- **Subprotocol:** `Sec-WebSocket-Protocol: damhopper.browser.control.v1, damhopper.ticket.<base64url>`
- **Ticket Purpose:** Requires single-use capability ticket minted with `purpose: "control"`.
- **Socket Pairing:** Paired with the media connection via `AttachmentManager` matching `viewerId` and `subscriptionEpoch` (15s timeout).
- **Message & Frame Limits:** Max 16 KiB per message and frame (`MAX_CONTROL_MESSAGE_BYTES = 16384`).
- **Rate Limits:** Max 100 sustained messages/s, burst 200 (`MAX_CONTROL_BURST = 200`, `MAX_CONTROL_SUSTAINED_PER_SEC = 100`).

### Client Input Dispatch (Client -> Server)

Client sends JSON `InputMessage` records carrying ordered user interactions:

```json
{
  "browserSessionId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "browserIncarnation": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "profileEpoch": "1",
  "subscriptionEpoch": "4fa85f64-5717-4562-b3fc-2c963f66afa6",
  "leaseToken": "5fa85f64-5717-4562-b3fc-2c963f66afa6",
  "inputSeq": "1",
  "viewportEpoch": "1",
  "event": {
    "kind": "pointerDown",
    "button": "left",
    "u": 0.5,
    "v": 0.5,
    "modifiers": 0
  }
}
```

Supported `event.kind` variants: `pointerDown`, `pointerUp`, `pointerMove` (`u`, `v`, `modifiers`, plus `button` on down/up), `pointerCancel`, `wheel` (`u`, `v`, `delta_x`, `delta_y`, `modifiers` — canonical snake_case CSS px deltas clamped to `±4096`), `keyDown` (`key`, `code`, `modifiers`), `keyUp` (`key`, `code`, `modifiers`), `insertText` (`text`).

### Server Control Events (Server -> Client)

Server pushes JSON text notifications for modal interactions and session state:

| Event Kind | Payload Fields | Description |
| --- | --- | --- |
| `status` | `inputAvailable: bool`, optional `unavailableReason` | Emitted on connection and geometry availability changes. |
| `dialogOpened` | `dialogId`, `message`, `dialogType` (`alert`, `confirm`, `prompt`, `beforeunload`) | Native JavaScript dialog opened by page. |
| `dialogClosed` | `dialogId` | Dialog dismissed or handled. |
| `leaseRevoked` | `reason` | Input control lease expired, revoked, or preempted. |
| `error` | `message` | Processing or rate-limit error. |

---

## 9. Viewer Client SDK (`@dam-hopper/ui`)

Frontend client API and stream controller exports (`packages/ui/src/api/browser-host-client.ts`, `packages/ui/src/browser-host/`):

### REST & Ticket Client Functions

- `getBrowserCapabilities(owner, signal?)`: Fetches capabilities, bounds, engine qualification, and profile epoch.
- `listBrowserSessions(owner, signal?)` / `getBrowserSession(owner, sessionId, signal?)`: Queries active sessions.
- `createBrowserSession(owner, req, signal?)`: Creates new browser session with idempotent `creationKey`.
- `closeBrowserSession(owner, sessionId, signal?)`: Closes and unregisters browser session.
- `navigateBrowser(owner, sessionId, req)` / `historyBrowser(...)` / `reloadBrowser(...)`: Controls navigation state.
- `setBrowserViewport(owner, sessionId, req)`: Sets CSS layout viewport and DPR under lease.
- `acquireBrowserControl(owner, sessionId, req)` / `renewBrowserControl(...)` / `releaseBrowserControl(...)`: Manages 30s cooperative input lease.
- `createBrowserDevToolsLease(owner, sessionId, req: CreateDevToolsLeaseRequest, signal?)` / `revokeBrowserDevToolsLease(...)` / `buildBrowserDevToolsUrl(...)`: Mints control-bound DevTools lease (`viewerId`, `leaseToken`, `controlEpoch`), revokes cleanly, and builds asset/WS URLs (`BrowserApp` / `BrowserDevToolsDock` require active control without auto-steal).
- `respondBrowserDialog(owner, sessionId, req)`: Dismisses or confirms native JavaScript dialog.
- `findInBrowserPage(owner, sessionId, req)`: Searches text in page ($\le 256$ chars).
- `getBrowserSelectedText(owner, sessionId, leaseToken, signal?)`: Retrieves currently selected text ($\le 64$ KiB).
- `issueAttachmentTicket(owner, req, signal?)`: Mints single-use capability ticket.
- `resetBrowserProfile(owner, req, signal?)` / `getBrowserProfileResetStatus(owner, operationId, signal?)` (+ `*ForOrigin` and `preflightBrowserCapabilitiesForOrigin` helpers): Confirmed profile wipe and pending cleanup status polling.
- `mintViewerAttachmentTickets(owner, sessionId, incarnation, profileEpoch)`: Atomically mints matching media and control capability tickets and formats WebSocket URLs with ticket subprotocols.
- `useHostBrowserSelection` (`packages/ui/src/browser-host/selection-controller.ts`), `startHostBrowserSelection`, `cancelHostBrowserSelection`, `createHostSelectionArtifacts`, `handoffHostSelectionArtifact`, `deleteHostSelectionArtifact`, `collectHostTerminalCandidates`: Managed CDP selection preview, 409 nav-sync recovery, and incarnation-checked terminal handoff.

### Frame Parser & Controllers

- `unpackBhjfFrame(buffer)`: Validates 16-byte `BHJF` prefix, JSON header, and JPEG SOF0 dimensions ($\le 1920 \times 1080$).
- `BrowserStreamController`: Persistent canvas controller governing 1-active-decode + 1-pending-frame, captured-socket ACKs, synchronous privacy blackening (`setPrivacyMode`), visibility detachment (`setVisibility`), `streamQualityActive` latch, and per-run monotonic `appliedCaptureVersionsByRun` map (rejecting same-run rollback across runs while ignoring placeholders).
- `browser-stream-quality.ts`: Ephemeral in-memory preference and diagnostics store keyed by `(profileId, generation, windowId, tabId)`, default Auto; survives placement/reconnect, cleared on close/retire, zero web storage persistence.
- `BrowserTools`: Accessible controlled selector (Auto/High/Medium/Low, `value={qualityPreference}`), shared effective tier, scale, quality, viewer FPS, and audio suppression reason (`Muted` vs `Bandwidth constrained`).
- `BrowserInputController`: Letterbox coordinate mapping to $[0.0, 1.0]$, microtask move coalescing, CSS-pixel wheel normalization (`x1` pixel, `x16` line, `x cssWidth/cssHeight` page, `±4096` clamp, canonical `delta_x`/`delta_y`), bounded 16 KiB UTF-8 plain-text paste (`handlePasteText`, surrogate normalization, escape-aware `insertText` chunking $\le 4096$ raw / $\le 16384$ serialized bytes, atomic preflight), and held-input auto-release. Display-only while the last drawn frame is `inputTrusted: false`: pointer, wheel, key and text/composition/paste input are all dropped and held input is released once (paired keyUp/pointerCancel).
- `TextInputProxy` & `CanvasView`: `TextInputProxy` manages virtual keyboard focus, multi-stage IME composition deduplication, and paste rejection/success callbacks (`onPasteError`, `onPasteSuccess`); `CanvasView` forwards `onCanvasLostPointerCapture` for accepted-gesture pointer capture cleanup in `BrowserStreamKeepAliveHost`.

---

## 10. Integrated Test Fixtures & Qualification Specs

The Host Browser API and streaming transport are qualified by integrated test harnesses (`server/tests/` and `packages/ui/e2e/`):

- **Real App Test Fixture (`packages/ui/e2e/fixtures/host-browser-app.ts`):** Spawns an authenticated production server instance with dynamically allocated ports, synthetic `admin`, `ordinary`, and `foreign` principals, and automated cleanup.
- **Same-Target Coexistence (`packages/ui/e2e/os-host-browser/same-target.spec.ts`):** Verifies that external automation clients connecting over `/api/browser/cdp` do not terminate production screencasts when executing `Page.disable` or `Page.stopScreencast`.
- **Tuning Grid & Zero-Polling (`packages/ui/e2e/os-host-browser/performance.spec.ts`):** Evaluates 12 candidate configurations against protocol safety caps; release profile requires `everyNthFrame = 1` (setting #7 q65 1280x900 default); static pages emit zero periodic `Page.captureScreenshot` calls.
- **Security Matrix Integration (`server/tests/browser_host_security.rs`):** Validates role denial, single-use ticket replay/purpose/Origin fencing, `--no-auth` loopback socket enforcement, URL network policy, multi-target/multi-viewer concurrency limits, and live role demotion termination.
- **Platform Containment & Reset (`server/tests/browser_host_platform.rs`):** Validates Chromium launch argument security allowlisting, Unix supervisor death-pipe architecture, advisory OS locking (`flock`), and `reset.json` restart fencing.
- **Target-Scoped DevTools & Native Downloads (`server/tests/browser_host_devtools.rs`):** Validates DevTools lease capacity/revocation, asset proxy CSP rewriting & path traversal rejection, WS single-claim/concurrency cap (`4`), client/upstream CDP filtering, per-auth-session revocation, and real-Chromium `data:`/`http:`/`blob:` native host downloads into `XDG_DOWNLOAD_DIR` updating `lastDownload`.
