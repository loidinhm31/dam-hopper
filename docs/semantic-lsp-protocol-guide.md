# Semantic LSP Protocol Guide

**Authority:** Server Semantic Subsystem (`server/src/api/semantic_ws.rs`, `server/src/semantic/gateway.rs`, `server/src/semantic/uri.rs`, `server/src/semantic/resources.rs`)  
**Client Implementation:** Shared Monaco Semantic Client (`packages/ui/src/api/semantic-client.ts`, `packages/ui/src/lib/semantic-monaco.ts`, `packages/ui/src/lib/semantic-model-uri.ts`, `packages/ui/src/stores/semantic-navigation.ts`)  
**Status:** Shipped Feature Protocol (Phase 09 & Phase 10 Qualified for Portable-Only Linux x64 Server + Web Host; PR #74 Remediation: Phase 01 Passed, Phases 02 & 03 Accepted with Deferred Issues; Visual Human Review Pending Governance in `review.md`)

---

## 1. Overview and Transport Isolation

DamHopper exposes a dedicated, isolated WebSocket endpoint for TypeScript and JavaScript semantic language server operations:

- **Dedicated Route:** `/ws/semantic/v1`
- **Required Subprotocol:** `dam-hopper.semantic.lsp.v1`
- **Payload Format:** JSON-RPC 2.0 single objects (strictly text UTF-8)

### Subsystem Boundaries

The semantic gateway operates independently of the core multiplexed WebSocket (`/ws`):

1. **Protocol Separation:** Communicates via standard JSON-RPC 2.0 frames (`{ "jsonrpc": "2.0", "id": ..., "method": ..., "params": ... }`). It does not use the core `{ "kind": ... }` envelope.
2. **Resource & Task Independence:** Runs on independent reader and writer Tokio tasks with dedicated byte counters, rate limiters, and in-flight channels. It shares zero buffers or message dispatchers with PTY terminals or filesystem subscriptions.
3. **Strict Framing Rules:** JSON-RPC batch requests (JSON arrays) and binary WebSocket frames are rejected with JSON-RPC error `-32700 Parse error`.
4. **Lifecycle Fencing:** Requests are accepted only in states corresponding to the filtered protocol lifecycle state machine.

```
Client (Web Monaco)
      │
      │ WSS /ws/semantic/v1 (Subprotocol: dam-hopper.semantic.lsp.v1)
      ▼
┌────────────────────────────────────────────────────────┐
│ semantic_ws_handler (Origin, Auth Token, Presence)     │
└────────────────────────────────────────────────────────┘
      │
      ├── Split Tokio Tasks (Reader Loop & Writer Task)
      ├── Live Auth Watcher (5s poll, 2s timeout, cancellation-first)
      ▼
┌────────────────────────────────────────────────────────┐
│ SemanticGateway Actor (JSON-RPC 2.0 Filtered Profile)  │
└────────────────────────────────────────────────────────┘
      │
      ├── UriMediation (Virtual URI <-> file:// Translation)
      ▼
┌────────────────────────────────────────────────────────┐
│ SemanticSupervisor (AppState-owned, portable bounds)   │
└────────────────────────────────────────────────────────┘
      │
      ▼
┌────────────────────────────────────────────────────────┐
│ SemanticSessionActor (Overlays, FIFO stdin, TSLS child)│
└────────────────────────────────────────────────────────┘
```

---

## 2. Handshake, Authentication, and Live Watcher

### Handshake Requirements

1. **Subprotocol Negotiation:**
   The client MUST send the HTTP header:
   ```http
   Sec-WebSocket-Protocol: dam-hopper.semantic.lsp.v1
   ```
   If omitted or mismatched, the server rejects the upgrade with HTTP 400 Bad Request (`INVALID_SUBPROTOCOL` or `SUBPROTOCOL_REQUIRED`).
2. **Origin Allowlist Parity:**
   Handshakes follow core `/ws` origin validation rules:
   - When an `Origin` header is present, it MUST match the allowed origins list (`state.origin_is_allowed(&headers)`). Disallowed browser origins fail with HTTP 403 Forbidden.
   - When the `Origin` header is absent (e.g. CLI tools), a query parameter bearer token (`?token=...`) or explicit server `--no-auth` mode is required. Origin-less cookie-only requests fail with HTTP 403 Forbidden.
3. **Token Extraction & Precedence:**
   Tokens are evaluated from query parameters first (`?token=<jwt>`), falling back to the `dam_hopper_auth` cookie. Tokens are validated against `AuthService.evaluate_claims` within a bounded 2.0-second asynchronous timeout (`AUTH_STORE_LOOKUP_TIMEOUT = 2s`). If claims evaluation times out or the backend is unreachable, the claims-evaluation future is dropped and the handler fails closed immediately with HTTP 503 `AUTH_UNAVAILABLE` *before* presence reservation. (Note: While dropping the evaluation future aborts the async await at the handler, already-started SQLite worker tasks dispatched to `spawn_blocking` cannot be forcibly aborted and run to completion on the threadpool.)
4. **Presence Admission Reservation:**
   Before upgrade, the connection reserves a client presence slot (`reserve_pending_upgrade`). If presence capacity is exhausted, the upgrade fails with HTTP 503 `PRESENCE_UNAVAILABLE`.
5. **Subsystem Master Toggle:**
   The semantic supervisor defaults to disabled (`is_enabled() == false`). Upgrades succeed at the HTTP layer, but initialization attempts return JSON-RPC error `-32000 SEMANTIC_DISABLED` while disabled.

### Live Auth Watcher & Cancellation-First Teardown

Once connected, a background asynchronous watcher continuously monitors credential validity:

- **Cadence & Timeout:** Polls every 5.0 seconds with a 2.0-second store lookup timeout (`AUTH_STORE_LOOKUP_TIMEOUT = 2s`).
- **Inspection Rules:** Verifies active session presence, account enablement (`is_enabled == true`), non-revocation (`session.revoked_at.is_none()`), auth version match, credential version match, and MFA deadline (`now < mfa_due_at`).
- **Fail-Closed on Unavailability:** If the authentication store times out or errors, the watcher fails closed (close code `1013 CLOSE_AUTH_UNAVAILABLE`).
- **Cancellation-First Teardown Sequence:**
  When credential invalidation is detected:
  1. `session_revocation.revoke()` immediately invalidates shared session tokens lock-free (0 awaits).
  2. `state.semantic_supervisor.invalidate_connection(&connection_id).await` reaps the child process tree and cancels session actor tasks out-of-band before socket close frame transmission.
  3. The queued outbound writer task checks the revocation token; any queued non-null success results are dropped or rewritten to `-32005 AUTH_REVOKED`.
  4. Best-effort close frame (`4401 CLOSE_FULL_LOGIN_REQUIRED` or `4403 CLOSE_MFA_REQUIRED`) is transmitted.
  5. Reader and writer tasks abort immediately.

---

## 3. Filtered JSON-RPC 2.0 Protocol Profile

The gateway exposes a strictly fenced subset of the Language Server Protocol. Unknown methods, custom commands, workspace configuration mutations, and dynamic capabilities are rejected.

### Lifecycle State Machine

```
   [ Unattached ]
         │
         │ damHopper/attachTarget
         ▼
    [ Attached ]
         │
         │ initialize
         ▼
   [ Initializing ]
         │
         │ initialized
         ▼
      [ Ready ] <───> (didOpen, didChange, didClose, definition, implementation, $/cancelRequest)
         │
         │ shutdown
         ▼
  [ ShuttingDown ]
         │
         │ exit / disconnect
         ▼
   [ Terminated ]
```

### Supported Method Allowlist

| Method | Direction | Allowed States | Description & Constraints |
| --- | --- | --- | --- |
| `damHopper/attachTarget` | Client → Server | `Unattached` | Binds connection to `{ target: { project, worktreePath? }, descriptor: "typescript" }`. Resolves canonical root and returns target policy (see response schema below). |
| `initialize` | Client → Server | `Attached` | Revalidates target root. Lazily spawns supervisor session actor, starts child language server, and replies with fixed capabilities including `experimental.damHopperAdaptiveSync`. |
| `initialized` | Client → Server | `Initializing` | Signals client readiness; transitions connection to `Ready`. |
| `textDocument/didOpen` | Client → Server | `Ready` | Opens document overlay for language IDs `typescript`, `typescriptreact`, `javascript`, or `javascriptreact`. Initial payload transmits full document text (one-way notification, no RPC ack). |
| `textDocument/didChange` | Client → Server | `Ready` | Updates in-memory document overlay. Transmits incremental edits or full-text replacements depending on the adaptive sync threshold (one-way notification, no RPC ack). |
| `textDocument/didClose` | Client → Server | `Ready` | Closes document overlay and releases in-memory overlay bytes. Closing the last document schedules a 60-second idle eviction timer once the session is otherwise idle (zero open documents, zero pins, zero in-flight requests in `Ready` state). Transport keepalive Pings do not touch session state and do not delay eviction (timing precision qualification tracked for Phase 04). |
| `textDocument/definition` | Client → Server | `Ready` | Requests definition locations. `params` MUST include `damHopperDocumentVersion`. Responses include destination freshness metadata. |
| `textDocument/implementation` | Client → Server | `Ready` | Requests implementation locations. `params` MUST include `damHopperDocumentVersion`. Responses include destination freshness metadata. |
| `$/cancelRequest` | Client → Server | `Ready` | Cancels an in-flight navigation request by client request ID (`{ id: <client-req-id> }`). The gateway marks the logical entry cancelled across both child stages, cancels active child operations, and returns JSON-RPC error `-32800 REQUEST_CANCELLED` echoing the original client request ID. |
| `shutdown` | Client → Server | `Ready`, `Initializing` | Gracefully shuts down child language server. Returns `result: null`. |
| `exit` | Client → Server | Any | Releases session actor and tears down connection. |

_Request ID Rule:_ Requests (`attachTarget`, `initialize`, `definition`, `implementation`, `shutdown`) received without an `id` field are dropped silently without error frames per JSON-RPC notification rules (`gateway.rs:319-323`).

### Attach & Initialize Response Schemas

#### `damHopper/attachTarget` Response Result:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "targetId": "target-a1b2c3d4",
    "descriptor": "typescript",
    "adaptiveSyncThresholdBytes": 65536,
    "maxDocumentBytes": 1048576,
    "maxOpenDocuments": 16,
    "maxSessionOverlayBytes": 4194304,
    "maxInFlightRequests": 8,
    "resourcePolicyVersion": "1.0.0"
  }
}
```
The client validates that `adaptiveSyncThresholdBytes`, `maxDocumentBytes`, `maxOpenDocuments`, and `maxSessionOverlayBytes` match active policy limits before proceeding (`semantic-client.ts:219-285`).

#### `initialize` Response Result:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "capabilities": {
      "textDocumentSync": 2,
      "definitionProvider": true,
      "implementationProvider": true,
      "experimental": {
        "damHopperAdaptiveSync": {
          "version": "1.0.0",
          "thresholdBytes": 65536,
          "maxDocumentBytes": 1048576,
          "maxOpenDocuments": 16,
          "maxSessionOverlayBytes": 4194304,
          "maxInFlightRequests": 8
        }
      }
    }
  }
}
```
### Document Version Extension (`damHopperDocumentVersion`)

Navigation requests (`textDocument/definition`, `textDocument/implementation`) MUST supply:

```json
{
  "textDocument": {
    "uri": "dam-hopper://semantic/<target-id>/<encoded-path>"
  },
  "position": {
    "line": 12,
    "character": 4
  },
  "damHopperDocumentVersion": 3
}
```

**Gateway Version Fencing Rules:**
1. The gateway verifies that `damHopperDocumentVersion` matches the active in-memory overlay version for the specified document.
2. If versions diverge, the request fails immediately with JSON-RPC error `-32003 STALE_VERSION`.
3. Before dispatching the standard LSP request to the child language server, the gateway strips `damHopperDocumentVersion` and any client metadata extensions. The child language server receives strictly standard LSP JSON-RPC.

---

## 4. Document Synchronization and Adaptive Wire Sync

### Single Negotiated Capability

The gateway advertises and negotiates exactly one sync capability during `initialize`:
- `capabilities.textDocumentSync: 2` representing `TextDocumentSyncKind.Incremental`.
- `capabilities.experimental.damHopperAdaptiveSync` advertising the negotiated 64 KiB threshold (`65,536` bytes) and resource policy bounds.

### Frozen 64 KiB Adaptive Wire Sync Threshold

The gateway enforces a single, frozen wire threshold (`ADAPTIVE_SYNC_THRESHOLD_BYTES = 65,536 bytes` / 64 KiB):

1. **Documents below 64 KiB UTF-8 Bytes:**
   Transmitted as range-less full-document replacements:
   ```json
   {
     "textDocument": { "uri": "...", "version": 4 },
     "contentChanges": [
       { "text": "entire file content here..." }
     ]
   }
   ```
2. **Documents at or above 64 KiB UTF-8 Bytes:**
   Transmitted as standard LSP ranged incremental edits:
   ```json
   {
     "textDocument": { "uri": "...", "version": 5 },
     "contentChanges": [
       {
         "range": {
           "start": { "line": 120, "character": 0 },
           "end": { "line": 120, "character": 15 }
         },
         "rangeLength": 15,
         "text": "replacement"
       }
     ]
   }
   ```
3. **Mandatory Full Sync Operations:**
   Regardless of file size, the following operations ALWAYS transmit full document content:
   - Initial document opening (`textDocument/didOpen`).
   - Dirty model replay during reconnection or server restart.
   - Resynchronization following a version divergence (`-32003 STALE_VERSION`).
   - Re-entry resynchronization following an over-cap rejection or unsynchronized state (F6).
   - Clean reload reconciliation synchronization via per-document FIFO queue (F1).
   - Unmappable Monaco model events (such as flush or EOL-only delimiter changes) (F7).
### In-Memory Speculative Overlays

Unsaved edits are tracked in memory by `SessionOverlayMap` in the server backend:
- Edit batches are applied speculatively to a cloned document buffer.
- The batch is committed atomically only if all edit ranges apply cleanly without coordinate inversion or out-of-bounds errors.
- If an edit fails, the previous document version is retained intact, preventing corrupted overlay states.

### UTF-16 Coordinate Mapping

LSP positions are specified in 0-based UTF-16 code units. Non-BMP astral characters (such as emojis `🚀`) occupy 2 UTF-16 code units but 4 UTF-8 bytes. The overlay system maps coordinates accurately to character code units on the same line, guaranteeing cursor alignment.

### Destination Freshness & Unopened File Navigation

1. **Unopened File Navigation:**
   Definition and implementation queries resolve imported symbols residing in unopened on-disk files (`UNOPENED_SYMBOL`) directly through the language server without requiring prior `textDocument/didOpen` notifications.
2. **Destination Content Hash and Range Validation:**
   In-target definition and implementation results carry explicit destination freshness metadata:
   - `damHopperDestinationContentSha256`: SHA-256 digest of the destination file content at resolution.
   - `damHopperDestinationVersion`: active overlay version (`number | null`) if open in memory, or JSON `null` for unopened on-disk files (never numeric `0`).
   - `damHopperDestinationIncarnation`: monotonic incarnation ID (`number | null`) of the target document overlay if open, or JSON `null` for unopened on-disk files.
   For unopened on-disk destinations, the server executes bounded FIFO pin-and-requery (`submit_pinned_navigation`), pinning the destination file content and validating that the resolved coordinate range is strictly contained within destination text bounds (`validate_target_range_in_content`) before emitting virtual URIs. Bounded pin-and-requery is strictly constrained to at most four unopened destinations per navigation request and enforces the canonical document size limit (`MAX_DOCUMENT_BYTES = 1 MiB`), failing closed if destinations exceed bounds. Destination provenance and canonical target containment are verified before virtual URI generation. The client and Monaco manager verify that coordinates fall within destination bounds and match the content hash before executing tab reveal.


## 5. Local Stable Model vs Replaceable Wire Session

The client maintains a clean separation between client-side model identity and server-side wire session bindings:

1. **Stable Local Model Identity:**
   Monaco editor models retain stable, persistent URIs formatted as:
   ```text
   inmemory://dam-hopper/${encodeURIComponent(tabKey)}
   ```
   where `tabKey` is the unique editor tab identifier (`projectTargetKey(targetRef) + ":" + relativePath`). Local model identity, undo/redo history, dirty flags, and tab instances survive network drops and server restarts.
2. **Replaceable Wire Session Bindings:**
   Wire communications use ephemeral session-target virtual URIs (`dam-hopper://semantic/<target-id>/<encoded-path>`).
3. **Reconnection Replay Barrier & Provenance Matching:**
   When a connection drops and reconnects:
   - The client establishes a new WebSocket connection to `/ws/semantic/v1`.
   - It performs handshake, `damHopper/attachTarget`, and `initialize`.
   - **Replay Provenance Matching & Ordering:** Before reading model text (`model.getValue()`) or servicing new navigation queries, the client validates replay provenance (`canAccessModel` and `shouldReplayModel`) across all registered open models.
   - **Authoritative Provenance Contract:** Replay strictly enforces that the model's captured provenance matches live session provenance across:
     - `serverUrl`: normalized endpoint URL.
     - `configuredRoot`: authoritative target root path.
     - `actor`: authenticated actor credential (`credential:<SHA-256 of token>` or `no-auth`).
     - `profileId`: client workbench profile identifier.
     - `project`: target project name.
     - `targetRef`: target workspace descriptor.
     Missing provenance fails closed immediately. Foreign-session, cross-root, or cross-actor models are strictly excluded from replay, preventing dirty buffer leakage across logins or server changes.
   - **Replaceable Wire Generations vs Immutable Provenance:** Wire session generations are ephemeral and replaceable per connection attempt, while model provenance is captured immutably at model registration. Matching reconnects re-bind to the new wire generation while strictly upholding provenance identity.
   - Replay transmits full-text `didOpen` frames sequentially into the child process stdin FIFO queue. Note that LSP `didOpen` is a one-way notification without return acknowledgments; synchronization is maintained via strict FIFO stdio sequencing, ordering user queries behind prior edit notifications.
4. **Dynamic Client Resolution:**
   To prevent stale closure bugs across editor tab switches, editor components resolve active client references dynamically at call time (`findClientForTab(tabKey)`).
---

## 6. Virtual URI Grammar & Path Containment

Clients communicate exclusively using virtual URIs. Host filesystem paths are never transmitted across the wire.

### Canonical Virtual URI Format

```text
dam-hopper://semantic/<target-id>/<encoded-relative-path>
```

- **Scheme:** Literal `dam-hopper`.
- **Authority:** Literal `semantic`.
- **Target ID:** Opaque target identifier generated during target resolution.
- **Relative Path:** Slash-separated path segments relative to the target root. Each segment is percent-encoded per RFC 3986.

### Strict Parsing and Validation Rules

1. **Pre-Decode Splitting:** URI paths are split on `/` *before* percent-decoding to prevent `%2F` or `%5C` from crossing segment boundaries.
2. **Single Decode:** Segments are percent-decoded exactly once.
3. **Unreserved Character Rule:** RFC 3986 unreserved characters (`a-z`, `A-Z`, `0-9`, `-`, `.`, `_`, `~`) MUST NOT be percent-encoded (e.g. `%61` is rejected).
4. **Traversal & Special Characters:** Segments matching `.`, `..`, containing null bytes `\0`, or containing Windows drive specifiers (`C:`) fail closed immediately.
5. **No Query or Fragment:** Presence of `?` or `#` produces `QueryOrFragmentForbidden`.

### Result Sanitization & `outsideTarget` Filtering

When the child language server returns locations:
- Locations resolving within the canonical target root are converted to virtual URIs and validated for valid, non-inverted coordinates (`start <= end`).
- Locations resolving outside the target root (e.g. system headers, global package stores, external TypeScript definitions) are stripped.
- If all resolved locations are outside the target root, the gateway returns:
  ```json
  {
    "outsideTarget": true
  }
  ```
  This signals to the UI that definitions exist in external libraries without disclosing internal host paths.

---

## 7. Resource Bounds and Portable Execution Policy

### Production Limits Centralized in `ResourcePolicy`

| Parameter | Limit | Enforcement Location / Constant |
| --- | --- | --- |
| Adaptive Wire Sync Threshold | 64 KiB (65,536 bytes) | `ADAPTIVE_SYNC_THRESHOLD_BYTES` in `resources.rs` |
| Max Document Size | 1 MiB (1,048,576 bytes) | `MAX_DOCUMENT_BYTES` in `resources.rs` |
| Max Session Overlay Budget | 4 MiB (4,194,304 bytes) | `MAX_SESSION_OVERLAY_BYTES` in `resources.rs` |
| Max Global Overlay Budget | 8 MiB (8,388,608 bytes) | `MAX_GLOBAL_OVERLAY_BYTES` in `resources.rs` |
| Max Open Documents Per Session | 16 documents | `MAX_OPEN_DOCUMENTS_PER_SESSION` in `resources.rs` |
| Max WebSocket Frame / Message | 4 MiB (4,194,304 bytes) | `MAX_FRAME_BODY_BYTES` in `resources.rs` |
| Max Stdio Header Size | 8 KiB (8,192 bytes) | `MAX_HEADER_SIZE` in `framing.rs` |
| Max Stderr Ring Buffer | 64 KiB (65,536 bytes) | `MAX_STDERR_RING_BYTES` in `types.rs` |
| Token Bucket Refill Rate | 40 tokens / sec | `MESSAGE_RATE_PER_SEC` in `resources.rs` |
| Token Bucket Burst Capacity | 80 tokens | `MESSAGE_RATE_BURST` in `resources.rs` |
| Max In-Flight Navigation Requests | 8 concurrent | `MAX_IN_FLIGHT_REQUESTS` in `resources.rs` |
| Max Global Semantic Process Trees | 2 trees | `MAX_GLOBAL_SEMANTIC_TREES` in `resources.rs` |
| Max Trees Per Connection | 1 tree | `MAX_TREES_PER_CONNECTION` in `resources.rs` |
| Max Processes Per Tree | 8 processes | Procfs monitoring limit in `reaper.rs` |
| V8 Heap Memory Cap | 256 MiB | `--max-old-space-size=256` in `launch.rs` |
| Live Auth Store Lookup Timeout | 2.0 seconds | `AUTH_STORE_LOOKUP_TIMEOUT` in `resources.rs` |
| Socket Write Timeout | 2.0 seconds | `SOCKET_SEND_TIMEOUT` in `resources.rs` |
| Socket Inactivity Timeout | 60.0 seconds | Read stream timeout in `semantic_ws.rs` |
| Total Teardown Budget | 5.0 seconds | `TOTAL_TEARDOWN_BUDGET` in `resources.rs` |

### Qualified Portable-Only Status

- **Status:** `PASS_PORTABLE_ONLY` on Linux x64 server + web client.
- **Degradation:** Linux cgroup v2 controller mode is explicitly unqualified (`status: "NOT_SELECTED"`). The supervisor enforces portable application limits (memory accounting, document caps, tree limits) and periodic sampled procfs RSS monitoring.
- **No Hard OS Guarantees:** Portable caps are application-level limits and sampled termination thresholds; they do NOT constitute hard kernel RSS memory ceilings or an OS filesystem sandbox.
- **Trusted Workspaces Only:** The child language server runs under the server daemon's OS user account and retains that account's filesystem authority. Hostile or untrusted repositories must not be opened.

### Adversarial Code Loading Denial

The pinned toolchain launches in a sanitized environment to prevent code execution via workspace hooks:
- Environment sanitized: `PATH=/usr/bin:/bin`, `NODE_ENV=production`, `NODE_OPTIONS` stripped, `NODE_PATH` stripped; descendant `NODE_PATH` set strictly to bundled `node_modules`.
- Arguments enforced: `--disableAutomaticTypingAcquisition`, no `--allowLocalPluginLoads`, no `--globalPlugins`, no `--pluginProbeLocations`.
- Verified denial: 0 canary executions across tsconfig plugins (V1), workspace SDK decoys (V2), preload/import hooks (V3), and automatic typing acquisition shims (V4).

---

## 8. Close Code & Error Code Taxonomy

### WebSocket Close Codes

| Code | Identifier | Trigger Condition |
| --- | --- | --- |
| `1000` | Normal Closure | Normal client or server initiated disconnect. |
| `1008` | `CLOSE_POLICY_VIOLATION` | Protocol violation or policy breach. |
| `1011` | `CLOSE_INTERNAL_ERROR` | Internal server or task failure. |
| `1013` | `CLOSE_AUTH_UNAVAILABLE` | Auth store error or timeout during live recheck. |
| `4401` | `CLOSE_FULL_LOGIN_REQUIRED` | Live watcher detected revoked session, disabled account, or expired token. |
| `4403` | `CLOSE_MFA_REQUIRED` | Live watcher detected MFA verification deadline elapsed. |

### JSON-RPC Error Codes

| Code | DamHopper Identifier | Description | Client Recovery Action |
| --- | --- | --- | --- |
| `-32700` | `Parse error` | Invalid JSON syntax or binary frame received. | Fix payload formatting; client disconnects on persistent failure. |
| `-32600` | `Invalid Request` | Missing `method`, or lifecycle state violation. (Requests without IDs are dropped silently per JSON-RPC). | Adhere to lifecycle sequence (`attachTarget` → `initialize` → `initialized`). |
| `-32601` | `Method not found` | Method not in filtered allowlist. | Use only supported filtered LSP methods. |
| `-32602` | `Invalid params` | Missing required parameters or malformed coordinates. | Validate parameter schemas before dispatch. |
| `-32603` | `Internal error` | Child process failure or unexpected server error. | Log diagnostic; retry or await server recovery. |
| `-32000` | `SEMANTIC_DISABLED` | Subsystem disabled server-wide (`is_enabled() == false`). | Present disabled status; do not reconnect until enabled by Admin. |
| `-32001` | `UNSUPPORTED_DESCRIPTOR` | Requested language descriptor other than `"typescript"`. | Non-retryable; fallback to local syntax mode. |
| `-32002` | `TARGET_NOT_FOUND` | Target project unavailable or inaccessible. | Check project existence; fail closed. |
| `-32003` | `STALE_VERSION` | Document version divergence, source/destination closed/modified in flight, or pin/requery freshness failure. | **Automatic resync:** client increments wire version, schedules full `didChange`, and returns `{ locations: [] }` (no automatic query retry). |
| `-32004` | `RATE_LIMIT_EXCEEDED` / `IN_FLIGHT_FULL` / `CONNECTION_TREE_LIMIT` / `GLOBAL_TREE_LIMIT` | Token-bucket exhausted, 8 concurrent in-flight navigation requests exceeded, or per-connection/global tree limit reached. | Apply backoff; throttle client request dispatch. |
| `-32005` | `AUTH_REVOKED` | Admission epoch invalidated during execution. | **Automatic reconnect:** reset socket, transition to `disconnected`, and schedule single reconnect after 1,000 ms. |
| `-32800` | `REQUEST_CANCELLED` | Request cancelled via `$/cancelRequest` or session interruption. | Clean up local request state; no error displayed to user. |

---

## 9. Client Fault Recovery Contract

When interacting with `/ws/semantic/v1`, the client implements specific recovery strategies based on the received error code:

### 1. Version Divergence Recovery (`-32003 STALE_VERSION`)

If a navigation request returns `-32003` (due to document version mismatch, modification while in flight, or destination freshness failure):
1. The client intercepts the error.
2. It increments the document's wire version.
3. It emits a full-text `textDocument/didChange` notification (range-less full-content `didChange` under the negotiated Incremental sync kind; resync does not renegotiate capability `2`) containing the entire current Monaco model buffer to realign server overlays.
4. It returns `{ locations: [] }` for the failed query without automatic retry, allowing subsequent user interactions to benefit from the resynchronized state.
5. The session remains open; no socket reconnection is triggered.

### 2. Admission Revocation Recovery (`-32005 AUTH_REVOKED`)

If the gateway returns `-32005` (e.g. following a workspace switch, config reload, or temporary admission reset):
1. The client marks its connection state as `disconnected`.
2. It closes the underlying WebSocket cleanly.
3. It schedules a single auto-reconnection attempt after 1,000 ms (`reconnectTimer = setTimeout(..., 1000)`).
4. Upon reconnecting, it completes handshake, target attachment, initialization, and full dirty model replay (with strict provenance checks) before servicing new queries.
5. If the revocation was permanent (e.g. project deleted or auth revoked), reconnect attempts fail closed.
### 3. Request Cancellation (`$/cancelRequest`)

1. If the user navigates away, closes a tab, or unmounts the editor while a navigation query is pending, the client transmits `$/cancelRequest` carrying `{ "id": <client-req-id> }`.
2. The gateway correlates the client request ID through its `LogicalNavigationEntry` across both child stages (initial query and pin-and-requery) and inter-stage pin acquisition. If an active child process request is running, the gateway dispatches `cancel_request` to the child language server.
3. The eventual terminal completion frame returns JSON-RPC error `-32800 REQUEST_CANCELLED` echoing the client's original request ID. (Cancellation notifications themselves do not produce responses).
4. The client suppresses user-facing error notifications for cancelled requests.
---

## 10. PR74 Remediation Protocol Contracts (Phases 01–03 Implemented; Phase 04 Proposed Design)

> **Notice:** The following protocol contracts document enhancements resolving findings F1–F13 (PR #74 review remediation). Phase 01–03 protocol contracts (F1, F3, F5, F6, F7, F8, F9, F10, F11, F13) are implemented in client and server source code with unit and integration test coverage, with remaining integration qualification gaps tracked for Phase 04 under active release hold. Phase 04 specifications represent proposed designs undergoing implementation.

### 1. Clean Reload Reconciliation & Wire Synchronization (Phase 01 Implemented: F1)
- **Tab-Keyed Host Mounting:** `EditorTabs` renders `MonacoHost` keyed by active tab (`key={activeTab.key}`), ensuring remounts isolate state and prevent cross-tab clean model overwriting.
- **Accepted-Revision Monotonic Counter:** `Tab` records a session-only `acceptedRevision?: number` (incremented on clean load or reload), strictly separate from filesystem `mtime` and Monaco model versions.
- **Readiness Barrier & Reconciliation:** On mount or when `acceptedRevision` changes on an open clean tab, `MonacoHost` runs `reconcileModelWithStore(editor, isMount)`:
  - Gated by clean status: tabs with `isDirty === true` skip reconciliation, strictly preserving dirty model identity, undo stack, user edits racing reload, and mtime conflict semantics.
  - When clean and revision advanced: suppresses synthetic `onChange` dirtying via `isReconcilingRef.current = true`, updates the model via `model.setValue(...)`, and updates `reconciledRevisionRef`.
  - Wire synchronization: If the semantic client is bound and ready, reconciliation transmits a range-less full-content `textDocument/didChange` at a fresh monotonic `wireVersion` (or `textDocument/didOpen` if unbound) through the per-document FIFO queue before user editing begins.
  - Model text lookup: `EditorTabs` implements `getModelText(tabKey)` preferring active non-disposed Monaco model content projected via `projectSemanticText(model.getValue())`, falling back to accepted store text materialized and projected via `projectMaterializedText(currentTab.content)`.
  - Semantics OFF containment: F1 is implemented within core editor and tab components (`editor.ts`, `EditorTabs.tsx`, `MonacoHost.tsx`); it operates identically and protects clean model integrity even when semantic navigation is disabled (`semantics OFF`). Semantics OFF does NOT mitigate F1; the core editor fix must operate independently.

### 2. Unified Semantic Representation & Server Pinning (Phase 01 Implemented: F7)
- **Disk-to-Model Intake Pipeline:** Disk bytes → `TextDecoder` (drops one leading UTF-8 BOM `U+FEFF`) → Monaco `PieceTreeTextBufferBuilder` (extracts second leading BOM if present, normalizes EOL to dominant) → `model.getValue(preserveBOM=false)`.
- **Double-Stripping STOP/GO Outcome:** Pinned Monaco double-stripping of 2-BOM disk files is preserved; semantic projection follows model text (`projectSemanticText`).
- **Literal Editor `U+FEFF` Preservation:** Literal `U+FEFF` typed or inserted in the editor is preserved as character data; it is an intended invariant that it is never stripped during semantic projection or incremental change sync.
- **Server Destination Freshness Pin Intake:** `server/src/semantic/uri.rs` provides `project_disk_text_for_pin(disk_text: &str) -> Cow<'a, str>`. It matches client `TextDecoder` + Monaco buffer builder behavior:
  - Strips up to two leading BOMs (`\u{feff}`) from disk file metadata.
  - Converts EOL delimiters (`\r\n` and lone `\r`) to canonical `\n` via `project_semantic_text`.
  - Returns `Cow::Borrowed` when no `\r` is present, avoiding unnecessary String allocation.
  - Consumed by `server/src/semantic/gateway.rs` when pinning unopened destination files for destination content freshness proofs (G5) before emitting `textDocument/didOpen`.
- **Projection Helpers:**
  - `projectSemanticText(text: string): string`: Converts `\r\n` and lone `\r` to canonical LF (`\n`). Returns original string reference if no `\r` exists. Preserves all other characters (including literal `U+FEFF`).
  - `projectMaterializedText(text: string): string`: Used exclusively at raw store content fallback boundaries; extracts leading `U+FEFF` (representing the 2nd BOM from disk) and converts EOL to canonical LF.
- **Content Digest & Coordinate Validation:** Exact UTF-8 byte SHA-256 is computed over projected semantic text. Coordinates and ranges are resolved against canonical projected text. Incremental model changes are projected; flush and EOL-only events fallback to bounded full replacement; raw `rangeLength` is omitted when unmappable.

### 3. Over-Cap Fencing & Resync Protocol (Phase 01 Implemented: F6)
- **Cap Enforcement & Invalidation Fencing:** When document (1 MiB default) or session aggregate (4 MiB default) overlay caps are exceeded, the change is rejected locally without sending wire messages. The binding is immediately marked `unsynchronized = true`, its invalidation generation is incremented (`invalidationGen`), and `onSyncInvalidated` clears active reveal intents in the UI store.
- **Source Query Suppression:** Navigation requests (`textDocument/definition`, `textDocument/implementation`) await any active per-document queue, and then check `unsynchronized === true` or wire version / invalidation generation mismatches. If unsynchronized, queries are suppressed and return `{ locations: [] }` immediately without sending wire requests to the server.
- **Local Admission Reservation Lifecycle:** Reservations represent *local client admission accounting* (since `didChange` is an unacknowledged LSP notification), not server acknowledgments:
  - *Admitted operations:* An admitted change registers an `activeReservation` (`reservationId`, `tabKey`, `bytes`) in `attempt.activeReservations`.
  - *Rejected operations:* Over-cap rejected operations do NOT create a reservation; older runnable reservations from prior admitted queued edits MUST survive and remain active.
  - *In-flight retention & release:* Reservations are held while queued and during transmission. Upon send completion, accounted bytes are committed to `attempt.openDocumentBytes.set(tabKey, byteLength)` and the reservation entry is deleted in `finally`.
  - *Send failure fallback:* If send throws and triggers catch/fallback full-resync, the fallback's reservation is retained through its full `didChange` transmission, committing to server bytes before release in `finally`.
  - *Document close & attempt retirement:* Closing a document (`notifyDidClose`) removes all active reservations for that `tabKey`. Retiring a socket attempt clears all its active reservations.
  - *Session aggregate calculation:* `calculateSessionBytes(attempt, excludeTabKey)` computes session overlay usage by taking `Math.max(serverBytes, maxPending)` across all other tabs, ensuring concurrent queued operations never exceed the session budget.
- **Bounded Re-entry Protocol:** Re-entry from an unsynchronized state requires transmitting a range-less full-content `textDocument/didChange` at a fresh monotonic version once within caps. Even if the content exceeds the 64 KiB adaptive threshold, an unsynchronized binding forces full text resync (`wasUnsynchronized`). Once the full replacement send completes and matches `lastQueuedVersion` and current `invalidationGen`, `unsynchronized` is cleared (`false`).

### 4. Owner-Current Transport Loss Recovery (Phase 01 Implemented: F5)
- **Single Owner-Fenced Scheduler:** Unexpected socket disconnects trigger a single owner-fenced reconnect timer with a fixed 1,000 ms backoff (`this.reconnectTimer`).
- **Active Gating Guards:** Reconnect is strictly fenced before connection:
  - Client status must be `disconnected`.
  - Profile enablement: `isProfileEnabled()` must return true (connected to `useSemanticNavigationStore.isSemanticEnabledForProfile(profileId)`).
  - Active mount refcount: `hasActiveRef()` must return true (tracking mounted tab instances in `clientRefCounts`).
  - Target provenance: Connection handshake (`performHandshake`) and dirty replay validate that the active target matches the authorized server endpoint and project root.
- **Terminal Code Classification:** Disconnect codes `1008` (Policy Violation), `4401` (Unauthorized), `4403` (Forbidden), and `1000` (Normal Closure) are classified as terminal. They cancel reconnection timers and never auto-retry. Codes `4401`/`4403` transition the client to `error` status with descriptive error text.
- **Error-to-Close Pipeline:** `ws.onerror` captures `attempt.lastError` without prematurely retiring the attempt. The subsequent `ws.onclose` consumes `attempt.lastError` for diagnostic reporting and correctly routes terminal vs retryable scheduling.
- **Admissible Dirty Buffer Replay:** Prior to declaring `ready`, the client re-attaches the target, initializes the session, and replays all admissible dirty buffers matching provenance via `replayMatchingModels()`. Over-cap models remain blocked.

### 5. Coordinate Proofs, Lossless CR Spans & Logical Cancellation (Phase 02 Implemented: F3, F8, F9)
- **Borrowed Lossless Line-Span Iteration (F8):** `server/src/semantic/overlay.rs` provides `lossless_line_spans` yielding borrowed `LineSpan` structures without per-line string allocations. Recognizes CRLF (`\r\n`), LF (`\n`), and lone CR (`\r`), and preserves trailing empty lines. Direct-client text is never mutated to LF in storage or memory; `position_to_byte_offset` and destination range validation consume borrowed spans directly, ensuring byte offsets and UTF-16 code units match unrewritten documents.
- **Immutable Query Snapshot Coordinate Proof (F3):** Session actors return internal coordinate proofs (`_damHopperProvenSnapshots`) containing `{ text, contentSha256, version, openIncarnation }` in response to pinned navigation requeries. The gateway validates destination coordinates against this exact proof, separates actor incarnation checks (`open_dest_actor_identities`) from gateway state checks (`open_docs_at_submit`), and deletes `_damHopperProvenSnapshots` prior to outbound serialization. Wire Location and LocationLink objects append `damHopperDestinationContentSha256`, `damHopperDestinationVersion`, and `damHopperDestinationIncarnation`.
- **Unified Logical Navigation Cancellation (F9):** The gateway maintains `LogicalNavigationEntry` in `client_to_logical` spanning stage 1, disk reads, pin acquisition, stage 2, and outbound frame publication under in-flight concurrency caps. Re-using active client request IDs before terminal completion is rejected with `-32600`. Cancellation via `$/cancelRequest` cancels active child requests and returns `-32800 REQUEST_CANCELLED` echoing the original client request ID. Outbound channel failure revokes the session token (with saturated-outbound cancellation/deadline races [W3], deadline coverage across disk/cancel awaits [W4], and direct transport termination [W8] tracked as deferred issues for Phase 04).
- **Test Feature Gate & Phase 04 Deferred Items:** Integration tests utilizing barrier synchronization (`tests/semantic_websocket.rs`) require `--features test-support` in `server/Cargo.toml`. Seven review warnings (W1 CI test-support wiring & global barriers, W3 outbound admission cancellation/deadline race, W4 navigation deadline coverage of disk/cancel awaits, W5 F3/F9 test coverage fidelity, W7 baseline diff header repair, W8 transport termination on enqueue failure, W9 bounded off-thread snapshot reader and worker lifetime) are tracked for Phase 04 integrated qualification linking to [Cycle 3 Code Review Report](../plans/reports/code-review-261026-0709-phase02-gateway-coordinate-proofs-cycle3.md).
### 6. Session Lifecycle & Idle Management (Phase 03 Implemented: F10, F11, F13)
- **First-Start Lazy Startup Fence & Budgeted Child Replay (F10):**
  - *Lazy Startup & Fence (`initial_start_completed`):* Sessions initialize in `SemanticState::Idle` with zero child processes. Child spawn is deferred until the first explicit `initialize` or `didOpen`. The `initial_start_completed` fence flag is set before initiating the first child spawn; once set, subsequent `initialize` or `didOpen` calls cannot retry a failed initial launch or revive a crashed child, preventing bypass of supervisor crash recovery.
  - *Bounded Crash Restart Budget:* Unexpected child termination drains active requests with `SessionError::ChildCrashed` and enters `SemanticState::Crashed`. Restarts are bounded to a maximum of 2 within a rolling 60-second window (`RESTART_WINDOW = 60s`, `MAX_RESTARTS_PER_WINDOW = 2`) with cancellation-aware backoff (100 ms then 500 ms) selecting against session revocation (`revocation.cancelled()`).
  - *FIFO Overlay Replay Ordered by Open Incarnation:* On restart, overlays are replayed in strict ascending order of `open_incarnation` (`ordered_document_uris()`). Frames are enqueued into replacement child stdin with backpressure retry (`send_child_json_with_backpressure`, 5 ms intervals, 5-second deadline).
  - *Transition to `Ready`:* The actor transitions to `Ready` once all overlays are successfully enqueued; child processes them asynchronously via FIFO stdio sequencing (unacknowledged notifications).
  - *Terminal `Crashed` State:* If restart budget is exhausted or replacement launch/replay fails, the actor enters terminal `SemanticState::Crashed`, reaps the child tree, and does not revive on subsequent requests or rolling-window expiry.
- **Server-Authoritative Idle Session Eviction (F11):**
  - *60-Second Eviction Deadline:* When a session has zero open documents, zero temporary disk pins, and zero in-flight requests, it schedules a 60-second idle eviction deadline (`IDLE_SHUTDOWN_TIMEOUT = 60s`).
  - *Empty Transition Evaluation:* Evaluated deterministically on empty transitions: initial empty `initialize`, `didClose` to 0 documents, in-flight request completion, rejected `didOpen` rearming, and crash restart replaying 0 documents.
  - *Monotonic Token Cancellation:* Each scheduling increments `idle_timer_token` (`AtomicU64`) and sets `idle_timer_scheduled = true`. Opening documents or new work immediately cancels the timer (`cancel_idle_timer()`), clearing the scheduled flag and bumping the token to invalidate pending callbacks.
  - *Actor-Serialized `RetireIfIdle` Verification:* On timer expiry, supervisor validates generation and sends `RetireIfIdle { idle_token }`. The actor confirms in its serialized message loop that state is `Ready`, documents == 0, pins == 0, in-flight == 0, and the token matches before retiring.
  - *Atomic Invalidation Cutoff:* Verified idle actors execute `apply_invalidation()`, revoking admission tokens lock-free, setting state to `Invalidated`, and reaping the child tree. Concurrent/subsequent operations fail closed with `SessionError::Invalidated`. Supervisor removes the handle via `close_session_if_generation`.
  - *Transport Ping Independence:* WebSocket Ping/Pong frames are handled exclusively at the transport layer (`semantic_ws.rs`) and never reach the session actor. Active keepalive pings do NOT prevent idle session eviction.
- **Pre-Upgrade Authentication Bound & Fail-Closed Behavior (F13):**
  - *Two-Second Timeout Bound:* Pre-upgrade JWT claims evaluation in `semantic_ws_handler` is bounded by `tokio::time::timeout(AUTH_STORE_LOOKUP_TIMEOUT, state.auth_service.evaluate_claims(&claims))` (2.0 seconds).
  - *Fail-Closed Before Presence Reservation:* Timed-out or unavailable store evaluations immediately fail closed with HTTP 503 `AUTH_UNAVAILABLE` *strictly prior* to client presence slot reservation (`reserve_pending_upgrade`), preventing slow auth backends from consuming presence capacity.
  - *Async Timeout vs SQLite Worker Threads:* On timeout, the claims-evaluation future is dropped and the handler returns HTTP 503 `AUTH_UNAVAILABLE`. Two seconds is the configured asynchronous timeout deadline, subject to Tokio scheduling jitter. Already-started SQLite database queries dispatched to Tokio's blocking threadpool (`spawn_blocking`) cannot be preemptively aborted and will execute to completion on the worker thread.
- **Phase 04 Deferred Items:** Three review warnings from Phase 03 Cycle 3 code review (Phase 03 W1 replay backpressure retry efficiency, Phase 03 W2 multi-document stdin stress testing, Phase 03 W3 ping keepalive precision) are tracked for Phase 04 integrated qualification, alongside Phase 02 deferred warnings (Phase 02 W1, W3, W4, W5, W7, W8, W9), under active subsystem release hold.
### 7. Release Packaging & Configuration Boundaries (Phase 04 Proposed: F2, F4, F12)
- **Bundled Toolchain Packaging (F2):** Packaging pipeline bundles and verifies the exact pinned engine tuple (Node 24.16.0, TypeScript 5.9.3, TSLS 6.0.2) with cryptographic manifest validation.
- **Canonical Git Protected Configuration (F4):** Canonical config guards protect configuration paths across reachable Git mutations; semantics OFF does not contain F4.
- **Hot Toggle Error Refresh (F12):** Failed administrative toggle-OFF operations refresh captured owner status and surface descriptive error diagnostics to operators.
