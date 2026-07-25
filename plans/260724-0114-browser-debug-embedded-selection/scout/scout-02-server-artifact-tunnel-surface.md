# Server artifact/tunnel surface scout

## Tunnel/origin model

- `server/src/tunnel/session.rs:4-27` defines `TunnelStatus` (`starting`, `ready`,
  `failed`, `stopped`) and `TunnelSession { id: Uuid, port, label, driver, status,
  url?, error?, started_at, pid? }`. There is no owner, project, PTY/session ID,
  origin type, expiry, or connection identity.
- `server/src/tunnel/manager.rs:27-299` owns in-memory session/driver maps,
  write-locked duplicate-port checks, `create`, `stop`, `stop_by_port`, `list`,
  and `dispose_all`. `create` starts a driver, records pid, broadcasts
  `tunnel:created`, and spawns `watch_events`; watcher handles ready/failed/exited.
  Failed sessions are removed after event delivery. `stop` removes immediately,
  signals the child, and broadcasts stopped. `dispose_all` drains stop senders,
  waits a fixed 3 seconds, then clears sessions.
- `server/src/tunnel/cloudflared.rs:16-121` launches
  `cloudflared tunnel --url http://127.0.0.1:{port}` and accepts only
  `https://[a-z0-9-]+.trycloudflare.com` from stderr. URL discovery times out at
  30 seconds; termination is SIGTERM (2 seconds) then kill.
- `server/src/tunnel/driver.rs:8-31` exposes `DriverHandle { pid, stop_tx }` and
  `TunnelDriverEvent::{UrlReady, Failed, Exited}`. No parsed-origin API or
  requested-origin/port verification exists.
- `server/src/api/tunnel.rs:13-106` validates port nonzero and labels (trim,
  control stripping, non-empty, <=64 chars), maps duplicate to 409 and missing
  binary to 503. GET list and DELETE stop exist.
- Routes are protected by `auth::require_auth` in
  `server/src/api/router.rs:24-38,159-176,260-284`.

## State, router, and WS protocol

- `server/src/state.rs:28-75,103-174` puts one cloneable
  `TunnelSessionManager`, `BroadcastEventSink`, `PtySessionManager`,
  `FsSubsystem`, and `DiagnosticStore` in `AppState`. Constructor wires PTY
  diagnostics via `pty_manager.set_diagnostics(...)`.
- `/ws` auth (`server/src/api/ws.rs:78-106`) only checks token validity; JWT
  `sub` is discarded. Each connection subscribes the shared sink
  (`ws.rs:112-152`) and `pump_pty` forwards raw JSON (`ws.rs:2079-2097`), so
  tunnel events fan out to every authenticated socket; no owner/connection filter.
- `server/src/pty/event_sink.rs:78-97,136-138` encodes broadcasts as
  `{kind:event_type,payload}`. Tunnel payloads: created (full serialized session,
  including pid in the broadcast copy), ready `{id,url}`, failed `{id,error}`,
  stopped `{id}`.
- `server/src/api/ws_protocol.rs:344-363` has flat tunnel `ServerMsg` variants
  and tests at `ws_protocol.rs:575-625`, but manager broadcasts do not use them.
  Frontend transport unwraps `msg.payload ?? msg` at
  `packages/ui/src/api/ws-transport.ts:1644-1647`.
- Inbound terminal messages are `ClientMsg::TermWrite`, `TermResize`,
  `TermAttach` (`server/src/api/ws_protocol.rs:18-34`), handled in
  `server/src/api/ws.rs:271-349`. `terminal:write` records byte count only and
  calls `pty_manager.write(id, data.as_bytes())`; there is no owner check,
  newline/control filtering, or artifact reference type.
- New artifact WS control can extend `ClientMsg`/`ServerMsg`; reuse `req_id` and
  existing binary-frame correlation (`PendingBinary`, `ws.rs:150-215`).

## PTY/session validation and paths

- `server/src/api/terminal.rs:19-112` resolves project/cwd through
  `FsSubsystem::sandbox().validate`. Without a project, cwd is caller-provided
  or `$HOME`/`/tmp` fallback.
- `server/src/pty/manager.rs:236-321` records PTY id/project/command/cwd/restart
  policy. Private `validate_session_id` (`manager.rs:1526-1543`) allows 1-128
  chars consisting of alphanumeric plus `:._-`.
- `PtySessionManager::write`, `resize`, `get_attach_snapshot`, `get_buffer`
  (`manager.rs:418-545`) look up exact live IDs and return
  `AppError::SessionNotFound`; `is_alive`, `list`, `list_detailed` are
  `manager.rs:660-687`. `write` cannot target dead sessions.
- PTY cleanup is `PtySessionManager::dispose` (`manager.rs:687-700`).
  `main.rs:288-315` snapshots buffers and shuts down persistence, but explicitly
  calls only tunnel `dispose_all`; an artifact store needs shutdown wiring.
- Port-forward loss auto-stops tunnels via
  `server/src/port_forward/manager.rs:156-162,249-259`; tunnel-linked artifacts
  must account for this path.

## Tempfile/atomic patterns and dependencies

- `server/src/fs/ops.rs:214-320` uses
  `NamedTempFile::new_in(parent)` (same filesystem), writes/syncs, then
  `persist(&target)` for atomic rename. Similar patterns:
  `server/src/fs/upload.rs:36-75`, `server/src/fs/decrypt.rs:105-108`.
- `server/src/utils/fs.rs:5-44` writes UUID sibling temp files with Unix mode
  `0600`, renames, and removes on failure.
- `server/src/diagnostics/store.rs:173-280` writes mode `0600` JSONL and
  compacts via sibling temp + rename.
- `server/Cargo.toml:75,107,128,134` already includes `mime_guess`, `tempfile`,
  `sha2`, and `tokio-util`; no obvious new dependency is required for bounded
  files, MIME, hashing, or streaming.
- No runtime/cache artifact helper exists. Config/diagnostic data uses
  `dirs::config_dir()/dam-hopper`; browser artifacts should use a separate
  per-session cache/runtime directory, never project roots, `.claude`, or
  diagnostics JSONL.

## Diagnostics/audit/redaction

- `server/src/diagnostics/store.rs:26-162` stores bounded JSONL/ring events and
  always applies redaction before memory/persistence.
- `server/src/diagnostics/redaction.rs:7-60` redacts Authorization/Cookie,
  bearer, token/password/passphrase/api-key/secret/credential values. Artifact
  IDs/paths are not special; log only event kind, size, hash, outcome, and opaque
  IDs (or add an explicit sensitive-ephemeral rule).
- `server/src/api/diagnostics.rs:11-119` exports backend events, PTY metadata,
  and bounded/redacted terminal tails. It accepts arbitrary frontend JSON and
  has no artifact section; screenshot/HTML/DOM payloads should stay excluded.
- `server/src/fs/audit.rs:1-22` is an `audit.fs` tracing macro for FS mutations,
  not an artifact store. WS parse errors deliberately log parse error only,
  never raw text (`server/src/api/ws.rs:250-288`).

## Likely create/modify files

1. Create `server/src/artifacts/{mod.rs,store.rs,error.rs}` (or equivalent):
   UUID IDs, per-session directory, create-new/0600 files, size/MIME caps,
   SHA-256 metadata, TTL, one-shot/bounded retrieval, revoke, sweep, disconnect
   cleanup, and shutdown disposal.
2. Add `pub mod artifacts` (`server/src/lib.rs`), `ArtifactStore` to
   `AppState`/constructor (`server/src/state.rs`, `server/src/main.rs`).
3. Create `server/src/api/artifacts.rs` and mount authenticated GET/delete/revoke
   (and creation/handoff if needed) in `server/src/api/router.rs`. Use opaque IDs,
   no filesystem paths or long-lived bearer tokens in URLs; return inline content
   with `X-Content-Type-Options: nosniff` and strict Accept/MIME checks.
4. Extend `server/src/api/ws_protocol.rs`/`ws.rs` only for WS handoff/ready/revoke.
5. Add ready lookup/port match and parsed-origin validation to tunnel manager
   (`manager.rs`, `session.rs`, or a new origin type); add ownership if needed.
6. Wire artifact disposal into `main.rs` shutdown beside tunnel/PTY persistence.
7. Keep diagnostics metadata-only; do not export binary/HTML/DOM contents.

## Tests to add/extend

- Tunnel tests (`server/src/tunnel/tests.rs:19-131`) currently cover only status/
  error/session serialization, empty list, and installer PATH lookup. Add
  duplicate-port, ready/failed/exited watcher, stop/dispose, URL/port mismatch,
  child command, and shutdown tests.
- WS tunnel serialization tests are at `server/src/api/ws_protocol.rs:575-625`;
  auth/pump tests at `server/src/api/ws.rs:2240-2278`. Add nested event-envelope
  and malformed handoff tests.
- REST state/helpers are in `server/src/api/tests.rs:18-125`; diagnostic export
  tests begin at `api/tests.rs:341`. Add route auth, owner, expiry, MIME/size,
  one-shot/download, and cleanup tests.
- Real-temp integration patterns are in `server/tests/common/mod.rs`,
  `fs_upload.rs`, `fs_write_streaming.rs`, and `fs_mutate.rs`.
- PTY diagnostic/lifecycle tests around `server/src/pty/tests.rs:1341-1571` are
  suitable for redaction and terminal handoff behavior.

## Unresolved questions

- Ownership is undefined: REST/WS auth discards JWT `sub`, and tunnel/PTY sessions
  have no owner. Decide user, WS connection, or PTY ownership and reconnect rules.
- Decide one-shot vs bounded-count vs refreshable retrieval, TTL, and max PNG/
  text/DOM/JSON sizes.
- Does handoff consume a ready Cloudflare URL, loopback origin, or both? Existing
  driver only accepts HTTPS trycloudflare URLs; never trust client destination.
- Can target app expose CSP/`frame-ancestors`-compatible debug route? Backend does
  not proxy or alter target headers.
- Prefer PTY handoff as an opaque artifact reference. If text is required, enforce
  single-line/no-CRLF/no-ANSI/control-byte validation and never append Enter.
- `TunnelSessionManager::create` updates pid in map/broadcast but returns the
  pre-pid session (`manager.rs:136-166`); decide whether handoff normalizes this.
- `dispose_all` uses fixed 3 seconds without cancellation; decide whether artifact
  cleanup must be synchronous or best-effort.
