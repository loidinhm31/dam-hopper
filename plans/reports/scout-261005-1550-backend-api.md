# Technical Report: Backend REST/WS Routing, Authentication, State & Middleware

**Scope**: In-depth analysis of backend REST/WS routing, authentication, server state, and middleware across `server/src/api/`, `server/src/auth/`, `server/src/crypto/`, `server/src/state.rs`, `server/src/main.rs`, and `server/src/lib.rs`.  
**Date**: 2026-10-05  

---

## 1. Module Responsibilities & Architectural Role

### Application Lifecycle & Startup (`server/src/main.rs`, `server/src/lib.rs`)
- **CLI Options & Config Resolution**: Command-line interface via `clap::Parser` (`dam-hopper-server`). Accepts `--config`, `--workspace`, `--port`, `--host`, `--cors-origins`, `--no-auth`, `--web-dir`, `--new-token`, and subcommands for `integration` (hooks for OMP, Codex, Claude).
- **Environment & Git Setup**: Loads `.env` via `dotenvy`, reads global config from `~/.config/dam-hopper/dam-hopper.toml`. Disables libgit2 owner verification (`git2::opts::set_verify_owner_validation(false)`) and configures `safe.directory=*` to ensure multi-user / external filesystem compatibility.
- **Service Orchestration**:
  - Initializes SQLite `SessionStore` (`~/.config/dam-hopper/sessions.db`) and dedicated background `PersistWorker` thread.
  - Spawns `TelemetryRuntime` (Codex OTLP usage collection).
  - Initializes `PtySessionManager` with event broadcast sink (`TOKEN_CAPACITY = 1024`).
  - Initializes `TunnelSessionManager` (Cloudflared driver) and `PortForwardManager` (`/proc/net/tcp` poller loop on Linux).
  - Binds loopback agent status collector on Linux (`127.0.0.1:0`).
  - Probes Linux inotify watch limits (`probe_inotify_limit()` warns if `< 65536`).
  - Establishes MongoDB connection pool if configured (`MONGODB_URI` / `MONGODB_DATABASE`).
  - Loads or generates OPAQUE server keypair (`~/.config/dam-hopper/opaque-server-setup`, mode `0600`).
  - Starts `IdleSuspendCoordinator` using Linux privileged helper socket (`/run/dam-hopper/idle-suspend.sock`) or stub on Windows.
  - Assembles router via `build_router_with_web_dir_and_origins()` and binds Axum server via `ForceCloseListener` with graceful shutdown signal.

### Central Server State (`server/src/state.rs`)
- `AppState` is the shared, cheaply cloneable state container injected into Axum handlers via `State(state)`:
  - **Locks & Synchronization**:
    - `workspace_dir`: `Arc<RwLock<PathBuf>>` (current workspace root).
    - `config`: `Arc<RwLock<DamHopperConfig>>` (active workspace TOML config).
    - `global_config`: `Arc<RwLock<GlobalConfig>>` (known workspaces & global settings).
    - `workspace_context_guard`: `Arc<RwLock<()>>` (serializes sandbox reconfiguration against media ticket issuance).
    - `idle_suspend_timing`: `Arc<RwLock<RuntimeIdleSuspendTiming>>` (dynamic timeouts).
    - `idle_suspend_coordinator`: `Arc<RwLock<Option<Arc<IdleSuspendCoordinator>>>>`.
    - `advisor_settings_lock`: `Arc<tokio::sync::Mutex<()>>` (serializes advisor policy CAS disk updates).
    - `telemetry_coordinator`: `Arc<tokio::sync::Mutex<()>>` (serializes usage deletions and collector reconfigs).
    - `opaque_registrations`: `Arc<RwLock<HashMap<String, ServerRegistration>>>` (ephemeral in-memory PAKE records).
  - **Core Subsystems**:
    - `pty_manager`: `PtySessionManager` (terminal lifecycle, shell spawning, output ring buffer).
    - `fs`: `FsSubsystem` (sandboxed path resolution and inotify tree watching).
    - `media_tickets`, `video_stream_tickets`, `image_stream_tickets`: Memory-only ephemeral capability stores.
    - `host_resource_monitor` & `host_resource_events`: Host metrics collector and SSE admission runtime.
    - `auth_service`: `Arc<AuthService>` (session validation, TOTP verification, challenge management).
    - `advisor_service`: `Arc<AdvisorService>` (native AI routing, evaluation review, history search).
    - `workspace_target_resolver`: Short-lived worktree resolution and cache.
    - `event_sink`: `BroadcastEventSink` (cross-connection PTY and git progress fan-out).

### Router & Middleware Stack (`server/src/api/router.rs`)
- **Route Segregation**:
  - `public`: Unauthenticated endpoints (`/api/health`, `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, `/api/auth/mfa/*`, `/ws`).
  - `protected`: Main workbench operations (workspace, projects, config, usage, git, terminals, agent-status, tunnels, ports, system metrics, idle-suspend, agent-store, agent-memory, agent-import, ssh, commands, settings, workflow). Guarded by `auth::require_auth`.
  - `ide_routes`: File explorer and ticket issuance (`/api/fs/*`). Guarded by `auth::require_auth`.
  - `video_stream` & `image_stream`: Media streaming routes (`/api/fs/{video,image}/stream/{ticket}`). Outside bearer middleware; validated via ticket capability and `mark_allowed_media_origin`.
  - `host_resource_stream_routes`: SSE metrics endpoint (`/api/system/resources/v1/events`). Feature-local 5-layer reverse middleware stack.
  - `advisor_routes`: Native advisor routing (`/api/advisor/*`). Double-layered: `auth::require_auth` + `auth::require_admin`.
- **Global Layers**:
  - `DefaultBodyLimit::max(10 * 1024 * 1024)` (10 MB default cap).
  - `RequestBodyLimitLayer` applied locally on sensitive mutation routes (8 KiB, 16 KiB, 32 KiB, 64 KiB, 1 MiB).
  - `build_cors`: Explicit origin allowlist with credentials enabled when origins configured.
  - Static fallback: `ServeDir` + `ServeFile(index.html)` for SPA serving, preserving strict 404s for all `/api`, `/api/`, `/api/{*path}` routes.

---

## 2. Key Endpoints & Data Contracts

### 2.1 Authentication & MFA Lifecycle (`server/src/api/auth.rs`, `server/src/api/auth_mfa.rs`)

| Route | Method | Auth Req | Payload / Contract | Description |
|---|---|---|---|---|
| `/api/auth/login` | POST | Public | `LoginBody { username, password }` | Authenticates credentials; returns dev token in `--no-auth`, or issues 5-min challenge (`mfaRequired` or `enrollmentRequired`). Sets `no-store`. |
| `/api/auth/register` | POST | Public | `LoginBody { username, password }` | Registers user in MongoDB (`is_enabled: false`, `role: user`, `auth_version: 0`). |
| `/api/auth/logout` | POST | Cookie/Bearer | Empty | Revokes MongoDB session at current time, revokes associated media tickets, clears `damhopper-auth` cookie (`Max-Age=0`). |
| `/api/auth/status` | GET | Optional | Empty | Returns session details (`authenticated`, `user`, `role`, `issuedAt`, `expiresAt`, `mfaDueAt`, `authProtocol: 2`). In `--no-auth`, returns synthetic `dev-user`. |
| `/api/auth/mfa/setup` | POST | Public | `MfaSetupRequest { challengeToken }` | Retrieves pending TOTP secret & `otpauth://` provisioning URI for enrollment challenge. |
| `/api/auth/mfa/confirm` | POST | Public | `MfaConfirmRequest { challengeToken, code }` | Verifies initial 6-digit TOTP code, commits AES-256-GCM encrypted secret to user document, creates active session, sets cookie and returns V2 JWT. |
| `/api/auth/mfa/verify` | POST | Public | `MfaVerifyRequest { challengeToken, code }` | Verifies TOTP for `LoginMfa` or `StepUp`. Increments `credentialVersion` on step-up (invalidating prior JWTs), returns refreshed V2 JWT. |
| `/api/auth/mfa/challenge` | POST | Bearer/Cookie | Empty | Issues step-up challenge for active session within 30-day lifetime whose 10-day MFA window lapsed. |

### 2.2 WebSocket Transport Multiplexer (`server/src/api/ws.rs`, `ws_protocol.rs`)
- **Handshake**: `GET /ws?token=<jwt>`. Evaluates V2 JWT claims against `AuthService`. Enforces origin allowlist.
- **Inbound Message Contract (`ClientMsg`, tagged by `"kind"`)**:
  - `terminal:write`: `{ id, data }` (PTY stdin input).
  - `terminal:resize`: `{ id, cols, rows }` (PTY window resize).
  - `terminal:attach`: `{ id, from_offset? }` (attach with offset replay).
  - `fs:subscribe_tree`: `{ req_id, project, worktree_path?, path }` (inotify tree stream).
  - `fs:read`: `{ req_id, project, worktree_path?, path, offset?, len? }` (range read up to 5 MB).
  - `fs:write_begin`, `fs:write_chunk`, `fs:write_commit`: Chunked file write protocol with expected mtime check.
  - `fs:op`: File mutations (`create_file`, `create_dir`, `rename`, `delete`, `move`).
  - `auth:register_start`, `auth:register_finish`: OPAQUE PAKE registration exchange.
  - `auth:login_start`, `auth:login_finish`: OPAQUE PAKE login exchange deriving shared AES key.
  - `fs:put_begin`, `fs:put_chunk`, `fs:put_commit`: Encrypted file upload using OPAQUE-derived AES-256-GCM key.
  - `auth:session_remove`: Evicts intermediate OPAQUE session key.
- **Outbound Message Contract (`ServerMsg`, tagged by `"kind"`)**:
  - `terminal:output`: `{ id, data, offset, truncated, incarnation }`.
  - `terminal:exit`: `{ id, code }`.
  - `fs:event`: File change events with monotonic sequence numbers.
  - `auth:register_start_response`, `auth:login_start_response`, etc.

### 2.3 Host Resource SSE Stream (`server/src/api/resource_events.rs`)
- `GET /api/system/resources/v1/events`: Server-Sent Events stream delivering periodic host metrics snapshots.
- **Middleware Reverse Stack**:
  1. `global_admission_layer`: Global semaphore permit check (max 32 concurrent SSE streams).
  2. `origin_admission_layer`: Origin check if `Origin` header present.
  3. `auth::authenticate_stream_request`: Authenticates actor with strict 2-second timeout.
  4. `bearer_required_layer`: Requires `Authorization: Bearer <token>` (strictly rejects cookie auth to prevent CSRF).
  5. `subject_admission_layer`: Per-subject concurrency cap (max 4 concurrent streams per verified user).
- **Body Lease & Shutdown**: Response body holds `BodyLease` (global permit + subject guard) for entire connection lifetime. Dropped on client disconnect or server shutdown.

### 2.4 Media Capability Streaming (`server/src/api/fs_video.rs`, `fs_image.rs`, `media_stream_response.rs`)
- **Ticket Issuance**:
  - `POST /api/fs/video/tickets`, `POST /api/fs/image/tickets`: Authenticated POST issuing 60-second capability tickets (`VideoTicketPurpose::Playback`, `ImageTicketPurpose::Preview`).
  - Ticket is memory-only, bound to actor username, active session ID, `authVersion`, `credentialVersion`, and session deadline.
- **Streaming Handlers**:
  - `GET /api/fs/video/stream/{ticket}`, `GET /api/fs/image/stream/{ticket}`:
  - Outside bearer middleware; returns `404 Not Found` for invalid or expired tickets.
  - Validates `AllowedMediaOrigin` extension.
  - Re-evaluates session state against `AuthService`: verifies user enabled, session unrevoked, auth/credential versions unchanged, and MFA due date unpassed.
  - Guards chunk stream in-flight against revocation and deadline expiry.

### 2.5 Config & Workspace Management (`server/src/api/config.rs`, `workspace.rs`)
- `GET /api/config`: Reads full parsed configuration.
- `PUT /api/config`: Replaces configuration with atomic write.
  - **Invariants**: Explicitly rejects mutations to `server.telemetry` (must use `/api/usage/settings`) and `server.idle_suspend` (must use `/api/system/idle-suspend/v1/timing`).
- `POST /api/workspace/switch`: Atomic workspace cutover:
  1. Loads target TOML configuration.
  2. Disposes current PTY session manager (`pty_manager.dispose()`).
  3. Acquires `workspace_context_guard.write()`.
  4. Revokes all media tickets (`media_tickets.revoke_all()`).
  5. Re-initializes FS sandbox roots.
  6. Updates `workspace_dir` and `config`.
  7. Broadcasts `workspace:changed` event via `event_sink`.

---

## 3. Security Invariants & Dev-Mode Bypass Behavior

### Strict V2 JWT Auth Claims
- Claims structure (`AuthClaims`):
  ```rust
  pub struct AuthClaims {
      pub v: u32,                  // Must equal 2 (AUTH_PROTOCOL_VERSION)
      pub sub: String,              // Username
      pub sid: String,              // Session UUID matching MongoDB document
      pub auth_version: i64,        // Account authVersion (bumped on password reset)
      pub credential_version: i64,  // Session credentialVersion (bumped on MFA step-up)
      pub iat: usize,               // Issued at (Unix seconds)
      pub exp: usize,               // Matches session expires_at (30 days max)
  }
  ```
- **Zero-Grace Time Evaluation**: `jsonwebtoken::Validation.validate_exp = false` in decoder; expiration is enforced strictly by server-authoritative `evaluate_session_policy()` using the injectable `Clock` trait.
- **Session Lifecycles & Deadlines**:
  - `SESSION_LIFETIME_SECS = 2_592_000` (30 days hard absolute limit).
  - `MFA_VALIDITY_SECS = 864_000` (10 days periodic MFA freshness). Step-up required after 10 days; increments `credential_version`, invalidating previous tokens.
  - `CHALLENGE_LIFETIME_SECS = 300` (5 minutes). Max 5 attempts per challenge (`CHALLENGE_MAX_ATTEMPTS`).
  - Rate Limiting: Max 10 failed attempts within rolling 10-minute window (`ACCOUNT_ATTEMPT_WINDOW_SECS = 600`), enforcing 10-minute cooldown lockout (`ACCOUNT_COOLDOWN_SECS = 600`).
  - Password Reset: Increments user `auth_version`, immediately invalidating all active sessions across all devices.

### Dev-Mode Bypass Behavior (`--no-auth`)
- **Flags & Startup Guards**:
  - Enabled via `--no-auth` or `DAM_HOPPER_NO_AUTH=1`.
  - **Fatal Safety Panics**:
    - Aborts startup if `--no-auth` is enabled while MongoDB is configured (`MONGODB_URI` set).
    - Aborts startup if `--no-auth` is enabled in production (`RUST_ENV=production` or `ENVIRONMENT=production`).
    - Aborts startup if MongoDB is unconfigured in production.
    - Aborts startup if `DAM_HOPPER_MFA_KEY_FILE` is missing in production authenticated mode.
- **Middleware Behavior in `--no-auth`**:
  - `require_auth` injects `AuthenticatedActor::dev_user()` (`subject: "dev-user"`, `role: User`) and `CredentialMechanism::NoAuthDev`.
  - `POST /api/auth/login` returns immediate synthetic dev token with 30-day expiry without password checking.
  - `GET /api/auth/status` returns `{ "authenticated": true, "dev_mode": true, "user": "dev-user", "role": "user" }`.
- **Admin Invariant**:
  - `require_admin` **strictly denies `--no-auth` mode**, returning `403 Forbidden` (`code: "NoAuthForbidden"`). Admin actions (such as native advisor settings/mutations) cannot be performed without genuine authenticated admin identity.

### CORS & Origin Validation
- **Strict Canonical Allowlist (`parse_cors_origins`)**:
  - Wildcards (`*`), empty strings, or fragment identifiers (`#`) are strictly rejected.
  - Requires valid `http` or `https` scheme, explicit host, no path or query.
  - Standard ports (80 for http, 443 for https) are normalized.
  - Duplicate origins cause startup failure.
- **Allowed Headers & Credentials**:
  - Credentials enabled (`allow_credentials(true)`).
  - Explicit allowed headers: `Authorization`, `Content-Type`, `Accept`, `Range`, `If-Range`, `If-None-Match`, `If-Modified-Since`, `Cache-Control`, `Pragma`, `x-expected-sha256`, `x-expected-security-revision`.
  - Exposed headers: `Accept-Ranges`, `Content-Range`, `Content-Length`, `Content-Disposition`, `ETag`, `x-expected-sha256`, `x-expected-security-revision`.
- **Media & WS Origin Enforcement**:
  - Media stream requests require origin matching `state.origin_is_allowed(headers)` or exact same-origin host match.
  - WebSocket handshakes require allowed origin if `Origin` header is present; origin-less clients allowed only if passing bearer query token or `--no-auth`.

### Cryptographic Foundations
- **MFA Secret Encryption (`server/src/auth/secret.rs`)**:
  - AES-256-GCM authenticated encryption for TOTP secrets stored in MongoDB.
  - Loaded from dedicated 32-byte key file (`DAM_HOPPER_MFA_KEY_FILE`).
  - Key file must have strict Unix permissions (owner-only `0600`; checks `fs::Permissions.mode() & 0o077 == 0`).
  - Plaintext secret and key bytes are zeroized in memory (`zeroize::Zeroizing`).
  - Authenticated Associated Data (AAD) binds ciphertext to `dam-hopper:{username}:{purpose}`.
- **TOTP Verification (`server/src/auth/totp.rs`)**:
  - RFC 6238 TOTP (SHA1, 6 digits, 30s step, skew window `[-1, 0, +1]`).
  - Constant-time comparison (`subtle::ConstantTimeEq`).
  - Strict replay fencing: verifies `matched_step > last_accepted_step`. Accepted step persisted in user document.
- **OPAQUE Key Exchange (`server/src/crypto/opaque.rs`)**:
  - Zero-knowledge Password-Authenticated Key Exchange over WebSockets.
  - Suite: `Ristretto255` OPRF, `TripleDh` key exchange with `Sha512`, `Identity` KSF (matches `@serenity-kit/opaque`).
  - Server long-term keypair persisted to `~/.config/dam-hopper/opaque-server-setup` (`0600`).
  - HKDF-SHA256 expands shared session key with info `dam-hopper-aes-256-gcm-v1` into 32-byte AES key for encrypted file uploads (`fs:put_begin`/`fs:put_chunk`/`fs:put_commit`).
  - Per-connection in-flight login sessions capped at 16 to prevent memory exhaustion.

---

## 4. Notable Patterns & Recent Evolutions

### Continuous Access Re-validation
- Long-lived WebSocket connections run a background revocation watcher task (`<=5s` interval, 2s timeout).
- If the session document is revoked, `auth_version` bumped, `credential_version` rotated, or the 10-day MFA freshness window elapses, the watcher closes the WebSocket using custom close codes:
  - `4403`: MFA Required (step-up required).
  - `4401`: Full Login Required (session revoked or expired).
  - `1013`: Auth Backend Unavailable.
- Media stream chunk loop re-validates session expiration and MFA deadlines during active file delivery.
- SSE stream loop checks cancellation tokens and publisher revocation flags before dispatching each frame.

### Native Evcrate Advisor Migration
- Legacy Linux plugin system, SDK, bridge, and runner were completely deleted (`f64764a0`).
- Replaced by native endpoints under `/api/advisor/*` (`status`, `settings`, `history/*`, `policy/*`, `models`, `evaluations/*`).
- Secured by both `auth::require_auth` and `auth::require_admin`.
- Policy updates use atomic Compare-And-Swap (CAS) with SHA-256 revision matching against `$HOME/.evcrate/advisor-routing.json` (mode `0600`, max 16 KiB).
- Validates that `$HOME/.evcrate/advisor-history` is an authentic physical directory (rejects symlinks).

### Git Panel Leased Push & Commit Squashing
- Added endpoints `/api/git/{project}/push/prepare` and `/api/git/{project}/push/publish` implementing lease-guarded git publications to prevent concurrent push conflicts.
- Added `/api/git/{project}/squash` endpoint utilizing libgit2 low-level tree builder and object database manipulation to squash commit ranges cleanly without worktree checkout churn.

### Settings Collapse & Configuration Backup Retention
- UI settings sections collapsed by default (`aa35a91e`).
- Configuration import (`POST /api/settings/import/workspace.toml`) creates rolling timestamped backups (`dam-hopper.toml.bak.<epoch>`) with automatic pruning retaining at most 5 recent backups.

---

## 5. Summary Diagram: Authentication & Middleware Flow

```
                      Incoming Request
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
       Public Route                    Protected Route
    (/api/health, login,               (Workspace, Git, Terminals,
     register, MFA, /ws)                Config, IDE, Advisor)
            │                                 │
            │                          require_auth
            │                                 │
            │                   ┌─────────────┴─────────────┐
            │                   ▼                           ▼
            │               no_auth?                    Valid JWT?
            │             (true: dev_user)                  │
            │                                    evaluate_session_policy
            │                                    (30d exp, 10d MFA freshness,
            │                                     auth_version, cred_version)
            │                                               │
            │                                       ┌───────┴───────┐
            │                                       ▼               ▼
            │                                  Authenticated   MfaRequired / Expired
            │                                       │          (401 Unauthorized)
            │                                       │
            │                         ┌─────────────┴─────────────┐
            │                         ▼                           ▼
            │                   Standard API               require_admin
            │                   (Executes Handler)         (/api/advisor/*)
            │                                                     │
            │                                           ┌─────────┴─────────┐
            │                                           ▼                   ▼
            │                                       no_auth?          role == Admin?
            │                                       (403 NoAuth)      (Passes to Handler)
            ▼                                           ▼                   ▼
     Executes Handler                              403 Forbidden      403 Forbidden
```

---

## 6. Unresolved Questions

1. *None.* All REST/WS routes, handlers, error conversions, OPAQUE encryption flows, MFA lifecycles, and security invariants are fully implemented, verified directly from codebase declarations, and aligned with recent git commits.
