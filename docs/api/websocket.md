# WebSocket API

WebSocket route, protocol, and event contracts moved from the [API reference index](../api-reference.md).

## Core WebSocket Endpoint (/ws)

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
- `{ kind: "terminal:attach", id, from_offset? }` — request buffer replay; server responds with `{ kind: "terminal:buffer", id, data, offset, reset, truncated }`
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

**File Tree Subscription:**

- `{ kind: "fs:subscribe_tree", req_id, project, path, worktreePath?, watchOnly? }` — start watching a validated directory; server responds with `{ kind: "fs:tree_snapshot", sub_id, nodes: [...] }`. `watchOnly: true` skips the unused tree snapshot and uses strict rooted directory validation.
- `{ kind: "fs:unsubscribe_tree", sub_id }` — stop watching.
- `{ kind: "fs:event", sub_id, event: { kind, path, from?, targetRelativePath?, targetRelativeFrom? } }` — server pushes changes (`created|modified|removed|renamed`). `path` and `from` remain absolute. Watch-only subscriptions additionally include target-relative endpoints inside the captured validated project/worktree root; `"."` identifies the root itself, and outside-target endpoints are omitted. Generic subscriptions omit these additional fields.
- The plans client uses relative structural identity to rebind replaced directory/root handles even when the listing DTO is unchanged. Legacy events without relative identity conservatively rebind the emitting subtree.

**File Read:**

- `{ kind: "fs:read", req_id, project, path, offset?, len? }` — read file content with optional range
  - Supports large files via offset+len (range reads)
  - Server responds: `{ kind: "fs:read_result", req_id, ok, binary, mime?, mtime?, size?, data?, code? }`
  - `data` is base64-encoded content (text or binary), max 100MB
  - If `ok=false` and `code="TOO_LARGE"`: file exceeds cap; use range reads (LargeFileViewer)
  - `readMode: "plan-document"` selects a strict bounded Markdown snapshot (64 KiB), rejecting linked traversal and returning conflict when descriptor, named-entry, or ancestor identity changes during the read.

**File Write:**

- `{ kind: "fs:write_begin", req_id, project, path, expected_mtime, size }` — initiate write
  - Server responds: `{ kind: "fs:write_ack", req_id, write_id }`
  - `expected_mtime` (Unix seconds) guards against concurrent modification; server rejects if stale
- `{ kind: "fs:write_chunk", write_id, seq, eof, data }` — send base64 chunk
  - Server acks each: `{ kind: "fs:write_chunk_ack", write_id, seq }`
- `{ kind: "fs:write_commit", write_id }` — finalize write
  - Server responds: `{ kind: "fs:write_result", write_id, ok, new_mtime?, conflict, error? }`
  - `conflict=true` if server detected mtime mismatch; client shows ConflictDialog (overwrite or reload)
  - `new_mtime` sent on success for next save guard

**Tunnel Lifecycle Events:**

- `{ kind: "tunnel:created", payload: <tunnel snapshot> }` — includes required `reminderDue: false`; no PTY ownership fields. See [Quick Tunnel REST contract](system-services.md#cloudflared-quick-tunnels).
- `{ kind: "tunnel:ready", payload: { id, url } }`.
- `{ kind: "tunnel:failed", payload: { id, error } }`.
- `{ kind: "tunnel:stopped", payload: { id } }`.
- `{ kind: "tunnel:reminder", payload: { id } }` — once when an active ready tunnel reaches three hours from creation. Does not stop or expire the tunnel.

The server retains `reminderDue: true` in `GET /api/tunnels` for reconnect/reload catch-up. Client subscriptions/cache changes use the emitting connection's profile and generation; delayed events cannot target its replacement. Quick tunnels persist through origin/terminal loss but not Cloudflared or DamHopper termination.

**Git Events:**

- Server broadcasts `{ kind: "git:progress", project, step, percent }` during clone/push/pull

All responses include context fields matching the request (e.g., `req_id` echoed back for fs:subscribe_tree).

---

## Semantic WebSocket Gateway (/ws/semantic/v1)

Dedicated, isolated endpoint for TypeScript and JavaScript semantic language server operations. Unlike `/ws`, this endpoint uses standard JSON-RPC 2.0 frames with the `dam-hopper.semantic.lsp.v1` subprotocol rather than the `{ kind: ... }` envelope, maintaining independent task loops, rate limits, and buffers.

Detailed wire semantics, lifecycle state transitions, adaptive sync threshold behaviors, and error taxonomies are documented in the authoritative [Semantic LSP Protocol Guide](../semantic-lsp-protocol-guide.md). Architectural specifications and containment invariants are in [Semantic WebSocket Gateway Architecture](../architecture/semantic-websocket-gateway.md).
### Handshake Requirements

- **Endpoint URL:** `/ws/semantic/v1` (append `?token={bearer_token}` for query authentication)
- **Required Subprotocol Header:** `Sec-WebSocket-Protocol: dam-hopper.semantic.lsp.v1` (400 `INVALID_SUBPROTOCOL` or `SUBPROTOCOL_REQUIRED` on mismatch)
- **Origin Allowlist:** Follows core `/ws` parity. Browsers MUST supply an allowed `Origin` (rejected with 403 `Origin not allowed` otherwise). Origin-less clients require a bearer query token or explicit server `--no-auth`; origin-less cookie-only requests are rejected with 403 Forbidden.
- **Token Precedence:** Query parameter `?token=...` takes precedence over the `dam_hopper_auth` cookie.
- **Presence Admission:** Reserves a client presence slot before upgrade (returns 503 `PRESENCE_UNAVAILABLE` on capacity failure); promoted upon successful socket connection.
- **Subsystem State:** Defaults to disabled (`is_enabled() == false`). Server administrators can hot-toggle the subsystem dynamically at runtime via `PATCH /api/semantic/settings` without daemon restart. Upgrades succeed at the HTTP layer, but `initialize` returns JSON-RPC error `-32000 SEMANTIC_DISABLED` when the subsystem is disabled.

### Message Format & Rate Limits

- **Protocol:** JSON-RPC 2.0 single objects (JSON arrays and binary frames are rejected with `-32700 Parse error`).
- **Frame & Message Cap:** 4 MiB maximum (`MAX_FRAME_BODY_BYTES = 4,194,304 bytes`).
- **Token Bucket Rate Limiter:** Refill rate of 40 tokens/second (`MESSAGE_RATE_PER_SEC`), maximum burst capacity of 80 tokens (`MESSAGE_RATE_BURST`). Each message consumes 1 token; excess messages are dropped with JSON-RPC error `-32004 RATE_LIMIT_EXCEEDED`.
- **In-Flight Navigation Bound:** Maximum 8 concurrent navigation requests (`MAX_IN_FLIGHT_REQUESTS`).
- **Inactivity & Outbound Channel Termination:** 60-second read timeout on inactive sockets. The reader loop monitors writer channel status (`outbound_tx.closed()`) and terminates cleanly when the outbound writer drops.

### Filtered Protocol Methods

| Method                        | Direction        | State          | Description                                                                                                                                                                                          |
| ----------------------------- | ---------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `damHopper/attachTarget`      | Client -> Server | `Unattached`   | Attach connection to `{ target: { project, worktreePath? }, descriptor: "typescript" }`. Pins canonical root and identity.                                                                           |
| `initialize`                  | Client -> Server | `Attached`     | Revalidates target identity and admission epoch. Lazily starts TSLS child session. Replies with `{ capabilities: { textDocumentSync: 2, definitionProvider: true, implementationProvider: true } }`. |
| `initialized`                 | Client -> Server | `Initializing` | Signals client readiness; transitions session to `Ready`.                                                                                                                                            |
| `textDocument/didOpen`        | Client -> Server | `Ready`        | Open document overlay for supported language IDs (`typescript`, `typescriptreact`, `javascript`, `javascriptreact`).                                                                                 |
| `textDocument/didChange`      | Client -> Server | `Ready`        | Submit incremental text changes to session overlay actor.                                                                                                                                            |
| `textDocument/didClose`       | Client -> Server | `Ready`        | Close document overlay. Starts 60-second idle eviction timer if no open documents remain.                                                                                                            |
| `textDocument/definition`     | Client -> Server | `Ready`        | Request definition locations. Requires `damHopperDocumentVersion` extension in `params`.                                                                                                             |
| `textDocument/implementation` | Client -> Server | `Ready`        | Request implementation locations. Requires `damHopperDocumentVersion` extension in `params`.                                                                                                         |
| `$/cancelRequest`             | Client -> Server | `Ready`        | Cancel in-flight navigation request by client request ID.                                                                                                                                            |
| `shutdown`                    | Client -> Server | `Ready`        | Gracefully terminate child language server session (`result: null`).                                                                                                                                 |
| `exit`                        | Client -> Server | Any            | Tear down gateway connection and supervisor registrations.                                                                                                                                           |

_Known JSON-RPC Protocol Deviations & Handling Notes:_

- Cancelled requests (`$/cancelRequest`) echo the client's original request ID and return standard JSON-RPC error `-32800 REQUEST_CANCELLED`.
- Invalid request ID types return error frames with `{ id: null }` (tracked W-C).
- Malformed `contentChange` items in `textDocument/didChange` trigger document closure (`did_close`) on the language server session to prevent desynchronization between client and language server state.

### Virtual URI Grammar & Path Containment

All document interactions use canonical virtual URIs:

```text
dam-hopper://semantic/<target-id>/<encoded-relative-path>
```

- **Containment:** Canonicalized relative path cannot escape the target root via `..`, symlinks, drive specifiers, or encoded separators.
- **Encoding:** Segments are percent-encoded once. RFC 3986 unreserved characters (`a-z`, `A-Z`, `0-9`, `-`, `.`, `_`, `~`) must not be percent-encoded.
- **Result Sanitization:** Containment is checked against canonical target root. Results resolving outside target root (e.g. external package directories, standard libraries, or symlink targets outside root) return `{ "outsideTarget": true }`, preventing disclosure of internal host filesystem paths. Malformed child location objects fold into this count in current builds.

### Invalidation, Lifecycle Boundaries & Error Codes

Semantic WebSocket sessions participate in distinct invalidation mechanisms depending on the triggering event:

- **Live Auth Invalidation:** A background watcher rechecks session validity every 5 seconds (2-second bounded lookup). On credential revocation, expiry, or user disablement, it executes **cancellation-first teardown**: supervisor admission is revoked and the child process tree is reaped _before_ socket closure (close code `4401 CLOSE_FULL_LOGIN_REQUIRED`).
- **Two-Phase Lifecycle Invalidation:** Workspace switches (`switch_workspace`), config reloads (`reload_config_locked`), and settings cache clears (`clear_cache`) execute **two-phase scoped invalidation**: Phase 1 synchronously detaches sessions from the supervisor registry and enqueues actor invalidation under `workspace_context_guard.write()`; Phase 2 reaps child process groups asynchronously outside the lock (`spawn_reap_sessions` or `reap_sessions` via `join_all`). Config reloads diff project sets, invalidating only removed project roots while preserving unaffected project sessions.
- **Early Shutdown Cutoff:** The daemon signal handler calls `revoke_admission()` in the SIGINT/SIGTERM handler, cutting off new WebSocket admissions before socket listeners drain or services stop.
- **Client Fault Recovery:**
  - `-32003` (`STALE_VERSION`): Document version divergence triggers client full `didChange` resynchronization (range-less full-content `didChange` under the negotiated Incremental sync kind), restoring overlay alignment without restarting the session. The failed query returns an empty location set without automatic retry.
  - `-32005` (`AUTH_REVOKED`): Admission revocation triggers client transition to `disconnected` and schedules auto-reconnection after 1,000 ms; reconnect re-binds to the new wire session generation and enforces strict model-registration provenance matching (endpoint `serverUrl`, `configuredRoot`, authenticated `actor` hash, `profileId`, `project`, and `targetRef`) before dirty model text replay. Terminal failures (removed project `-32002`, disabled service `-32000`, revoked auth) fail closed.
  - `-32800` (`REQUEST_CANCELLED`): Returned when in-flight navigation requests are cancelled via `$/cancelRequest` or session interruption.
See [Semantic WebSocket Gateway Architecture](../architecture/semantic-websocket-gateway.md#lifecycle-invalidation-and-client-recovery-phase-08) for authoritative trigger and recovery matrices.

- Close Codes: `1000` (Normal), `1008` (Policy Violation), `1011` (Internal Error), `1013` (Auth Unavailable), `4401` (Full Login Required / Revoked / Expired), `4403` (MFA Required).
- JSON-RPC Error Codes: `-32700` (Parse error), `-32600` (Invalid request), `-32601` (Method not found), `-32602` (Invalid params), `-32603` (Internal error), `-32000` (`SEMANTIC_DISABLED`), `-32001` (`UNSUPPORTED_DESCRIPTOR`), `-32002` (`TARGET_NOT_FOUND`), `-32003` (`STALE_VERSION`), `-32004` (`IN_FLIGHT_FULL` / `RATE_LIMIT_EXCEEDED` / `CONNECTION_TREE_LIMIT` / `GLOBAL_TREE_LIMIT`), `-32005` (`AUTH_REVOKED`), `-32800` (`REQUEST_CANCELLED`).
