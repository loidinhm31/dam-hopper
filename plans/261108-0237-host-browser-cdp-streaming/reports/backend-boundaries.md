# Backend Boundaries: Host Browser, CDP & Streaming Engine

## 1. Executive Summary & Core Invariants
- Architecture requires server-supervised headless Chromium instance with dedicated binary JPEG WebSocket streaming and scoped CDP proxying.
- Invariants: Admin-only production access; dev loopback bypass guarded by peer/listener/Origin checks; single persistent profile per admin principal on host; fail-closed process tree cleanup on Linux and Windows; separate media socket avoiding PTY `/ws` queue head-of-line blocking.

## 2. Server Auth, Role, Peer & Origin Evidence
- **Production Admin Role**: `AuthenticatedActor::role` must be `Some(UserRole::Admin)` (`server/src/auth/model.rs:9-12`). Standard authenticated dev actor (`server/src/api/auth.rs:96-105`) is hardcoded to `UserRole::User`.
- **Development No-Auth Mode**: `state.no_auth` automatically injects `AuthenticatedActor::dev_user()` with `UserRole::User` (`server/src/api/auth.rs:170-179`). A browser-specific bypass must explicitly permit dev-mode browser sessions without elevating global actor role to admin.
- **Production Safety Guards**: Startup fails closed if `no_auth` is set alongside `RUST_ENV=production` or initialized auth store (`server/src/state.rs:285-322`). Local dev commands (`server/src/api/host_actions.rs:227-233`, `server/src/idle_suspend/protocol.rs:173`) explicitly reject calls in `no_auth` (`actionsDisabledNoAuth`, `idleSuspendTimingDisabledNoAuth`).
- **Loopback & Peer Verification**: Reporter WebSocket rejects non-loopback clients (`server/src/agent_status/collector.rs:168-171`). Dev browser host bypass must mirror this: `peer_addr.ip().is_loopback()`, local listener bind, and exact Origin validation.
- **Origin Validation**: `state.origin_is_allowed(&headers)` matches `Origin` against `state.cors_origins` (`server/src/state.rs:547-558`). Used by `/ws` (`server/src/api/ws.rs:152-164, 266-279`) and media endpoints (`server/src/api/router.rs:547-566, 624-636`).

## 3. Session Expiration, Revocation & Live Watcher Mechanics
- **Upgrade Auth**: `/ws` validates JWT claims or dev actor (`server/src/api/ws.rs:165-243`), registers presence via `client_presence.reserve_pending_upgrade` (`server/src/api/ws.rs:245-257`), and promotes it to a live connection guard (`server/src/api/ws.rs:298-306`).
- **Live Revalidation Loop**: `auth_watcher` task polls every 5s (`server/src/api/ws.rs:522-634`) with 2s DB query timeout (`560-564`).
- **Revocation Conditions**: Fails closed if `now >= effective_deadline`, `!user.is_enabled`, `session.revoked_at.is_some()`, `session.auth_version != auth_version`, `user.auth_version != auth_version`, or `session.credential_version != credential_version`.
- **Termination Action**: Emits `WireMsg::CloseAuth` (`server/src/api/ws.rs:549, 575, 601`) with codes 4001 (`CLOSE_FULL_LOGIN_REQUIRED`), 4002 (`CLOSE_MFA_REQUIRED`), or 4003 (`CLOSE_AUTH_UNAVAILABLE`), triggers `cancel_tx.send(true)`, and shuts down writer loop (`server/src/api/ws.rs:323-356`).

## 4. Media Ticket/Store Patterns & Applicability
- **Store Architecture**: `MediaTicketStore` (`server/src/fs/media_ticket.rs:144-150`) manages in-memory, generation-fenced ticket records (`server/src/fs/media_ticket.rs:79-93`).
- **TTL Fences**: Enforces `MEDIA_TICKET_IDLE_TTL` (15m) and `MEDIA_TICKET_ABSOLUTE_TTL` (8h) bounded by session deadline (`server/src/fs/media_ticket.rs:21-23, 460-482`).
- **Binding**: Bound to `MediaSessionBinding` (actor subject + client ID + auth session ID + auth versions) (`server/src/fs/media_ticket.rs:106-114`).
- **Validation**: `authorize_stream` validates tickets per-request; files revalidated via `open_revalidated`; tampered/stale files immediately revoke ticket (`server/src/api/media_stream_response.rs:42-100`).
- **Revocation Hooks**: Revoked via `state.media_tickets.revoke_by_actor_or_session` on logout (`server/src/api/auth.rs:621-623`) and session delete (`server/src/api/auth_sessions.rs:127`); bulk wiped via `revoke_all()` on workspace/sandbox change (`server/src/api/config.rs:569, 1150`).
- **Browser Media Applicability**: Dedicated browser stream WebSocket should reuse this pattern for short-lived viewer attachment tickets (`/api/browser/stream?ticket=...`), but frame traffic MUST stream over a separate dedicated WebSocket, never terminal `/ws`.

## 5. AppState Lifecycle, Persistence & Process Supervision
- **AppState Composition**: Holds `pty_manager`, `fs`, `media_tickets`, `browser_debug_artifacts`, `cors_origins`, `no_auth` (`server/src/state.rs:36-130`). Must add `browser_host: Arc<BrowserHostManager>`.
- **Startup Sequence**: Monitors and background sweepers spawn in `server/src/main.rs:1198-1205`.
- **Shutdown Cascade**: Handles SIGTERM/SIGINT on Unix (`server/src/main.rs:1233-1258`), Ctrl+C on Windows (`1260-1275`), with 10s force-close watchdog (`1246-1254`). Ordered teardown: events revoked -> coordinator -> monitor -> tunnel processes reaped (`tunnel_manager.dispose_all()`) -> browser debug artifacts cleared (`browser_debug_artifacts.dispose_all()`) -> agent status -> PTYs (`server/src/main.rs:1284-1309`).
- **Process Lifecycle & Tree Termination**:
  - Unix: PTY and tunnel drivers terminate process groups using `killpg(Pid::from_raw(pgid), Signal::SIGKILL)` (`server/src/pty/session.rs:269-287`) or SIGTERM followed by wait (`server/src/tunnel/cloudflared.rs:140-150`).
  - Windows Pitfall: Standard `Child::kill()` terminates only the root process. Chromium child processes (`--type=renderer`, `--type=gpu-process`) become orphaned zombies. Windows release supervisor MUST use Win32 Job Objects (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) or `taskkill /F /T /PID <pid>`.

## 6. Browser Debug Artifacts & Terminal Handoff Boundaries
- **Artifact Creation**: `POST /api/browser-debug/artifacts` validates `terminal_id` and `terminal_incarnation` against `pty_manager.live_incarnation` (`server/src/api/browser_debug.rs:29-51`).
- **Upload Validation**: `PUT .../png` checks `Content-Type: image/png` and bounds bytes via `MAX_PNG_BYTES` (`server/src/api/browser_debug.rs:53-78`, `server/src/api/router.rs:343-345`).
- **Terminal Handoff**: `POST .../handoff` formats terminal reference string and writes directly to PTY via `state.pty_manager.write_if_incarnation` (`server/src/api/browser_debug.rs:94-121`). Fail-closed: release handoff on write failure.
- **Integration Requirement**: Browser selection from host-run Chromium must generate standard `BrowserSelectionV1` structures and consume this existing artifact endpoint/store.

## 7. Auth Logout, Expiry & Profile Reset Implications
- **Explicit User Logout (`POST /api/auth/logout`)**:
  - Clears auth cookie (`server/src/api/auth.rs:626-629`), revokes DB session record (`store.revoke_session`), and revokes media tickets for `(claims.sub, claims.sid)` (`server/src/api/auth.rs:619-623`).
  - **Browser Profile Implication**: Approved specification requires explicit logout/reset to remove saved credentials. Because there is ONE persistent browser profile per admin principal (`~/.config/dam-hopper/browser_profiles/<principal>`), an explicit logout from DamHopper MUST invoke the browser profile reset/teardown hook. This will close all live targets and clear stored browser credentials/cookies for ALL sibling sessions belonging to that principal.
- **Targeted Remote Revocation (`DELETE /api/auth/sessions/{id}`)**:
  - Requires bearer credential (`server/src/api/auth_sessions.rs:116-119`). Marks targeted session revoked in DB and revokes that session's media tickets (`127`).
  - Active WebSocket watcher detects revocation on next 5s tick (`server/src/api/ws.rs:569-580`). Sibling sessions and the shared host browser instance remain active.
- **Session Expiry (Passive Timeout / Deadline)**:
  - `effective_deadline` or JWT expiration terminates active WebSocket / media connections (`server/src/api/ws.rs:542-555`).
  - Browser profile data is **NOT** destroyed on passive expiry; persistent disk profile retains cookies/session storage across server restarts and reconnection.
- **Explicit Profile Reset Endpoint (`POST /api/browser/profile/reset`)**:
  - Dedicated admin-authenticated endpoint to close all targets, terminate Chromium, release directory locks, and recursively delete `user-data-dir`.

## 8. Recommended File Map & Architecture
- `server/src/browser_host/mod.rs`: Public interface, capability checks, configuration.
- `server/src/browser_host/manager.rs`: `BrowserHostManager` lifecycle supervisor, process spawn, profile locking (`flock`/`LockFileEx`), Win32 Job Object assignment, clean shutdown (`dispose_all`).
- `server/src/browser_host/session.rs`: Target tracking, `browserSessionId` <-> target ID map, viewport epoch, cooperative input lease.
- `server/src/browser_host/screencast.rs`: Screencast producer, CDP `Page.startScreencast`, base64 decode to binary JPEG, ACK credit flow, viewer broadcast.
- `server/src/browser_host/cdp_gateway.rs`: Authenticated loopback CDP WebSocket proxy for agents, scoped target filtering.
- `server/src/browser_host/input.rs`: Viewport CSS-to-target coordinate translation, input coalescing, CDP dispatch.
- `server/src/api/browser_host.rs`: REST routes (`/api/browser/sessions*`), media stream WS (`/api/browser/stream`), agent CDP WS (`/api/browser/cdp`). Mounted in `server/src/api/router.rs`.

## 9. Rust Dependencies, Pitfalls & Test Verification
- **Cargo Dependencies**:
  - `axum = { version = "0.8", features = ["ws", "json", "macros"] }`, `tokio = "1"`, `base64 = "0.22"` (`server/Cargo.toml:41-43, 137`).
  - `tokio-tungstenite = "0.26"` is currently in `[dev-dependencies]` (`server/Cargo.toml:186`); must be promoted to runtime `[dependencies]` or adopt `chromiumoxide = "0.9.1"`.
  - `windows-sys = "0.61.2"` currently has only `Win32_Storage_FileSystem` (`server/Cargo.toml:179`); must add `Win32_System_JobObjects` and `Win32_System_Threading` for Windows descendant cleanup.
- **Discovered Test Commands (Not Run)**:
  - `cargo test --bin dam-hopper-server`
  - `cargo test --test auth_no_auth`
  - `cargo test --test auth_device_sessions`
  - `cargo test --test browser_debug_artifacts`
  - `cargo test --test ws_client_presence`
  - Root command: `pnpm test` (invokes `cd server && cargo test`)

## 10. Unresolved Questions
1. Should `POST /api/auth/logout` immediately wipe the principal's entire browser `user-data-dir`, or close browser targets and clear cookies/storage via CDP `Network.clearBrowserCookies` / `Storage.clearDataForOrigin` to avoid cold-start directory corruption?
2. Does `chromiumoxide 0.9.1` bundle its own process launcher with Windows Job Object termination, or does `BrowserHostManager` need custom child process wrapping?
