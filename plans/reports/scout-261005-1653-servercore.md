# Codebase Scout Report: Core Server Architecture, Runtime Contracts, and Security Policies

**Date:** 2026-10-05  
**Scout Scope:** `server/Cargo.toml`, `server/src/lib.rs`, `server/src/main.rs`, `server/src/state.rs`, `server/src/api/` (core handlers; excluding workflow, resource_events, idle_suspend, host_actions owned by runtime scout), `server/src/auth/`, `server/src/config/`, `server/src/crypto/`, `server/src/fs/`, `server/src/git/`, `server/src/web_host/`, `server/src/workspace_target.rs`, `server/src/utils/`  
**Docs Inventory Source:** `plans/reports/context-261005-1653-docs-inventory.json`  

---

## 1. Executive Summary & DocsReader4 Question Resolution

### 1.1 Resolution of DocsReader4 Inquiry
- **Credential Admission for `POST /api/auth/mfa/challenge`:**
  - **Verdict:** Accepts **BOTH** `Authorization: Bearer <token>` **AND** the `damhopper-auth` HTTP-only cookie. It is **NOT** Bearer-only.
  - **Exact Code Path & Symbols:**
    - Handler declaration: `server/src/api/auth_mfa.rs:1012-1025` (`pub async fn challenge(State(state): State<AppState>, jar: CookieJar, request: Request) -> Response`).
    - Credential extraction call: `server/src/api/auth_mfa.rs:1024` invokes `extract_token_and_mechanism(&request, &jar)`.
    - Token extractor implementation: `server/src/api/auth.rs:136-146` (`extract_token_and_mechanism(request: &Request, jar: &CookieJar) -> Option<(String, CredentialMechanism)>`).
      - First checks: `extract_bearer_token(request.headers())` (`Authorization: Bearer <token>`).
      - Falls back to: `jar.get(AUTH_COOKIE)` where `AUTH_COOKIE = "damhopper-auth"`.
    - Router registration: `server/src/api/router.rs:75-87` mounts `/api/auth/mfa/challenge` in the unauthenticated `mfa_routes` group (with 16 KiB limit), allowing the handler body to perform credential inspection directly on active sessions requiring step-up.
  - **Authoritative Doc Wording Required:**
    > "Accepts either an `Authorization: Bearer <token>` header or the `damhopper-auth` HTTP-only cookie (falling back to the cookie when the Authorization header is absent). Does not require pre-existing full MFA authentication; it generates a single-use 5-minute step-up challenge for any unexpired, unrevoked session."

### 1.2 Authoritative Port & Host Topology
- **Standalone API Server (`server/src/main.rs:44,48`):**
  - Default Port: `4800` (`DAM_HOPPER_PORT`, `#[arg(long, default_value = "4800")]`).
  - Default Host: `0.0.0.0` (`DAM_HOPPER_HOST`, `#[arg(long, default_value = "0.0.0.0")]`).
- **Production Systemd Managed API Service:**
  - Port: `4801` (`dam-hopper-api.service`).
- **Production Systemd Managed Dedicated Web Host (`dam-hopper-web`):**
  - Port: `4802` (`dam-hopper-web.service`, `DAM_HOPPER_WEB_PORT`).
  - Host: `0.0.0.0` (`DAM_HOPPER_WEB_HOST`).
- **Development Web / Vite Frontend:**
  - Port: `4803` (`vite.config.ts`).

---

## 2. Directory & Symbol Map

### 2.1 Server Entry & Global State (`server/src/`)
- `Cargo.toml`:
  - Crate `dam-hopper-server` v0.10.2 (2021 edition).
  - Binaries: `dam-hopper-server` (`src/main.rs`), `dam-hopper` (`src/bin/dam-hopper.rs`), `dam-hopper-web` (`src/bin/dam-hopper-web.rs`), `dam-hopper-idle-suspend-helper` (`src/bin/dam-hopper-idle-suspend-helper.rs`).
  - Features: `vendored` (`git2/vendored-libgit2`, `git2/vendored-openssl`).
  - Dependencies: Axum 0.8 (ws, json, macros), axum-extra 0.10 (cookie, typed-header), tokio 1 (full), git2 0.19, opaque-ke 4, aes-gcm 0.10, rusqlite 0.31, mongodb 3.5.2, jsonwebtoken 10.3.0, totp-rs 6.0, portable-pty 0.8, tempfile 3, notify 7.
- `lib.rs`:
  - Module roots: `advisor`, `agent_status`, `agent_store`, `api`, `auth`, `browser_debug`, `commands`, `config`, `crypto`, `diagnostics`, `error`, `fs`, `git`, `host_actions`, `http_shutdown`, `idle_suspend`, `linux_release`, `persistence`, `port_forward`, `pty`, `ssh`, `state`, `system`, `telemetry`, `tunnel`, `utils`, `web_host`, `workflow`, `workspace_target`.
  - `probe_inotify_limit()`: Warns on Linux if `/proc/sys/fs/inotify/max_user_watches < 65536`.
- `main.rs`:
  - CLI `Cli`: `--config` (`DAM_HOPPER_CONFIG`), `--workspace` (`DAM_HOPPER_WORKSPACE`), `--port` (4800), `--host` (0.0.0.0), `--new-token`, `--cors-origins` (`DAM_HOPPER_CORS_ORIGINS`), `--no-auth` (`DAM_HOPPER_NO_AUTH`), `--web-dir` (`DAM_HOPPER_WEB_DIR`).
  - Subcommands `Commands::Integration`: Subcommands for `Omp`, `Codex`, `Claude` integration actions (`Install`, `Status`, `Uninstall`, `ReportHook`).
  - Functions: `try_load_env_file`, `explicit_config_path_from_args`, `load_explicit_config_env`, `manage_token`, `generate_token`, `write_token` (0o600 on Unix, stored at `~/.config/dam-hopper/server-token`).
  - Startup flow: Early report hook dispatch -> `dotenvy::dotenv()` -> global `.env` -> explicit config `.env` -> Clap CLI parse -> libgit2 `set_verify_owner_validation(false)` and git config `safe.directory=*` -> Token management -> Config resolution -> Session persistence (`SessionStore`, `PersistWorker`) -> Telemetry runtime -> PTY session manager -> Port forward manager -> Agent status runtime -> Agent store init -> MongoDB connection & index init -> OPAQUE server setup -> AppState -> Idle suspend coordinator enroll -> Axum TCP listener with `ForceCloseListener` (10s drain deadline) -> Graceful shutdown & process reap.
- `state.rs`:
  - `AppState`: Central Arc-shared struct containing `workspace_dir`, `config`, `global_config`, `pty_manager`, `agent_store`, `command_registry`, `event_sink`, `jwt_secret`, `ssh_creds`, `fs`, `media_tickets`, `video_stream_tickets`, `image_stream_tickets`, `workspace_context_guard`, `db`, `no_auth`, `cors_origins`, `tunnel_manager`, `port_forward_manager`, `opaque_server_setup`, `opaque_registrations`, `host_resource_monitor`, `host_resource_events`, `host_actions`, `diagnostics`, `browser_debug_artifacts`, `telemetry`, `telemetry_runtime`, `codex_exporter`, `telemetry_coordinator`, `workflow`, `workspace_target_resolver`, `idle_suspend_*`, `auth_service`, `agent_status`, `advisor_service`, `advisor_settings_lock`.
  - `AppState::new(...)`:
    - Validates no-auth mode: Fails if `no_auth` is enabled while `db.is_some()` (MongoDB configured).
    - Fails if `no_auth` is enabled in production (`RUST_ENV == "production"` or `ENVIRONMENT == "production"`).
    - Fails if `db.is_none()` in production environment.
    - Requires `DAM_HOPPER_MFA_KEY_FILE` in authenticated production environment.
  - `origin_is_allowed(&self, headers: &HeaderMap) -> bool`: Validates request `Origin` against `cors_origins` allowlist or exact match against `Host` authority.

### 2.2 Configuration Subsystem (`server/src/config/`)
- `resolve.rs`:
  - `ConfigSource`: `ExplicitConfig`, `Workspace`, `GlobalRegistry`, `GlobalDefaultWorkspace`, `CurrentDirectory`, `EmptyFallback`.
  - `resolve_startup_config(input: ConfigResolutionInput) -> Result<ConfigResolution, AppError>`:
    1. `explicit_config` (`--config` / `DAM_HOPPER_CONFIG`).
    2. `workspace_dir` (`--workspace` / `DAM_HOPPER_WORKSPACE`).
    3. `registry_path` (`~/.config/dam-hopper/dam-hopper.toml`).
    4. `global_default_workspace` (`global_config.defaults.workspace`).
    5. `current_dir` (`./dam-hopper.toml` legacy discovery).
    6. `empty_resolution` (Fallback with empty workspace).
- `global.rs`:
  - Paths: `dam_hopper_config_dir()` (`$XDG_CONFIG_HOME/dam-hopper` or `~/.config/dam-hopper`), `global_config_path()` (`config.toml`), `global_registry_path()` (`dam-hopper.toml`), `global_env_path()` (`.env`).
  - `read_global_config_at(path: &Path) -> Result<Option<GlobalConfig>, AppError>`: Performs migration of legacy terminal agent notifications keys (`migrate_terminal_agent_notifications`).
  - `write_global_config_at(path: &Path, config: &GlobalConfig)`: Atomic write.
- `schema.rs`:
  - `DamHopperConfig`: Workspace config containing `workspace: WorkspaceInfo`, `agent_store: Option<AgentStoreConfig>`, `server: ServerConfig`, `projects: Vec<ProjectConfig>`, `features: FeaturesConfig`, `config_path: PathBuf`.
  - `ServerConfig`: `session_db_path` (default `~/.config/dam-hopper/sessions.db`), `session_buffer_ttl_hours` (default 24), `telemetry: TelemetryConfig`, `host_resources: HostResourceMonitorConfig`, `workflow_event_retention_days` (default 90), `workflow_deleted_note_retention_days` (default 7), `workflow_stale_after_hours` (default 24), `idle_suspend: IdleSuspendConfig`, `advisor: AdvisorConfig`.
  - `GlobalConfig`: `defaults: Option<GlobalDefaults>`, `workspaces: Option<Vec<KnownWorkspace>>`, `ui: Option<UiConfig>`, `server: ServerConfig`.
  - `UiConfig`: Desktop font sizes (`system_font_size`, `editor_font_size`, `terminal_font_size` constrained to [10, 32]), shortcuts, `terminal_agent_notifications: TerminalAgentNotifications` (version 2 with codex, omp, claude policies), `cognito_mode_style` (`HeavyBlur`, `BlackScreen`), `mobile_custom_keyboard_*`.
  - `IdleSuspendConfig`: `enabled`, `quiet_period_seconds` ([60, 86400], default 900), `wake_after_seconds` ([60, 86400], default 600), `capability_selection` (`auto`, `systemd-logind`, `rtcwake`), `automatic_policy` (`empty-fleet`, `agent-activity`), `agent_executables` (1 to 32 entries, max 256 bytes, no generic interpreter baselines).
  - `TelemetryConfig`: `enabled`, `paused`, `db_path` (default `~/.config/dam-hopper/telemetry.db`), `detail_retention_days` ([1, 3650], default 90), `aggregate_retention_days`, `collector: TelemetryCollectorConfig` (port non-zero, loopback host).
- `replacement.rs`: `validate_protected_config_replacement`: Enforces safe workspace switching and configuration reload guards.

### 2.3 Authentication Subsystem (`server/src/auth/`)
- `policy.rs`:
  - `SESSION_LIFETIME_SECS = 2_592_000` (Hard 30-day absolute session lifetime).
  - `MFA_VALIDITY_SECS = 864_000` (Periodic 10-day MFA freshness window).
  - `CHALLENGE_LIFETIME_SECS = 300` (Fixed 5-minute challenge lifetime).
  - `CHALLENGE_MAX_ATTEMPTS = 5` (Max attempts per challenge).
  - `ACCOUNT_MAX_FAILED_ATTEMPTS = 10` (Max account failed attempts).
  - `ACCOUNT_ATTEMPT_WINDOW_SECS = 600` (10-minute sliding attempt window).
  - `ACCOUNT_COOLDOWN_SECS = 600` (10-minute account lockout cooldown).
  - `AUTH_PROTOCOL_VERSION = 2`.
  - `evaluate_session_policy(session: &AuthSession, user: &UserRecord, claims: &AuthClaims, now: DateTime<Utc>) -> AuthDecision`: Checks `user.is_enabled`, `claims.v == 2`, subject & session ID match, `auth_version` equality (invalidates on recovery reset), `credential_version` equality (invalidates on periodic MFA step-up), `revoked_at.is_none()`, absolute expiration (`now < expires_at`), and MFA deadline (`now < mfa_due_at`).
- `secret.rs`:
  - `MfaEncryptionKey`: Dedicated 32-byte AES-256-GCM key (`Zeroizing<[u8; 32]>`).
  - `MfaEncryptionKey::from_file(path)`: Rejects symlinks and non-regular files; strictly requires mode `0o600` on Unix (`mode & 0o077 != 0` rejected).
  - `encrypt_secret(&self, plaintext, user_id)` / `decrypt_secret(&self, ciphertext, user_id)`: Uses `user_id` as Additional Authenticated Data (AAD).
- `store.rs`:
  - `AuthStore`: Backed by MongoDB collections `users`, `authSessions`, `authChallenges`.
  - `init_indexes()`: Unique index on `users.username`, TTL index on `authSessions.expiresAt`, compound index on `authSessions.(username, expiresAt)`, TTL index on `authChallenges.expiresAt`, unique index on `authChallenges.tokenDigest`.
- `model.rs`:
  - `UserRecord`: `username`, `password_hash`, `role` (`User`, `Admin`), `auth_version`, `mfa: Option<MfaConfirmed>`, `mfa_blocked_until`, `mfa_attempt_count`.
  - `AuthSession`: `id`, `username`, `auth_version`, `credential_version`, `expires_at`, `mfa_verified_at`, `revoked_at`.
  - `AuthChallenge`: `token_digest`, `username`, `purpose` (`Enrollment`, `LoginMfa`, `StepUp`), `attempts`, `expires_at`, `consumed_at`.
  - `AuthClaims`: `sub`, `sid`, `v: 2`, `auth_version`, `credential_version`, `iat`, `exp`. Signs/decodes via HMAC-SHA256 with `jwt_secret`.
- `totp.rs`: `TotpEngine`: TOTP validation with SHA-1, 6 digits, 30s period, +/-1 skew step.

### 2.4 Cryptography & OPAQUE Subsystem (`server/src/crypto/`)
- `opaque.rs`:
  - `DamHopperOpaqueSuite`: Cipher suite using Ristretto255 OPRF, TripleDH key exchange with SHA-512, and Identity KSF (no server key stretching, fast in-transit authentication).
  - `OpaqueRegistrations`: `Arc<RwLock<HashMap<String, ServerRegistration>>>` (in-memory; lost on restart by design).
  - `load_or_create_server_setup()`: Loads or creates `ServerSetup`, persisted to `~/.config/dam-hopper/opaque-server-setup` (mode `0o600`).
  - `handle_register_start` / `handle_register_finish`: Stateless Phase 1 and 2 registration.
  - `handle_login_start` / `handle_login_finish`: Two-phase login; derives domain-separated 32-byte AES-256-GCM key from OPAQUE `session_key` via HKDF-SHA256 (`dam-hopper-aes-256-gcm-v1`).
  - `validate_identifier(id)`: Alphanumeric, hyphens, underscores, max 128 characters.

### 2.5 File System & Media Subsystem (`server/src/fs/`)
- `sandbox.rs`:
  - `WorkspaceSandbox` & `ProjectSandbox`: Enforces canonical path containment via `dunce::canonicalize` (strips Windows `\\?\` prefixes). Rejects lexical path escapes (`..`), validates against registered project roots or target roots.
- `secure_path.rs`:
  - `DirectoryIdentity`: Platform identity struct (`device` + `inode` on Unix; `volume_serial` + `file_index` on Windows).
  - Unix helpers: Uses `openat`, `libc::O_NOFOLLOW | libc::O_DIRECTORY`, and `fstat` to prevent symlink TOCTOU races during delayed writes and renames.
- `ops.rs`:
  - Limits: `MAX_READ_BYTES = 5 * 1024 * 1024` (5 MiB for full read; larger files require offset/len), `MAX_WORKSPACE_SEARCH_RESULTS = 500`.
  - Functions: `read_file`, `stat_file`, `list_directory`, `search_content`, `search_paths`, `get_language_files`.
- `mutate.rs`: Mutating ops: `create_file`, `create_dir`, `rename_path`, `delete_path`, `move_path`. Rejects modifications inside `.git/` unless `force_git: true` on delete.
- `upload.rs` & `enc_upload.rs`: Chunked in-flight uploads with monotonic sequence checks and temporary file buffering.
- `decrypt.rs`: `decrypt_blob` & `decrypt_and_write`: Decrypts AES-256-GCM ciphertext using derived OPAQUE session key (12-byte nonce prepended).
- `media_ticket.rs` & `media_session.rs`:
  - Limits: `MEDIA_TICKET_IDLE_TTL = 15 minutes`, `MEDIA_TICKET_ABSOLUTE_TTL = 8 hours`. `MEDIA_SESSION_IDLE_TTL = 30 minutes`, `MEDIA_SESSION_ABSOLUTE_TTL = 8 hours`.
  - `MediaTicketStore`: Memory-only generation and expiry lifecycle.
  - `MediaFileVersion`: Inode/device (Unix) or volume/file_index (Windows), file size, mtime, and random validator token.
  - Cookie format: Namespaced host-only cookie `damhopper-media-session-<canonical-lowercase-uuidv4>` (`HttpOnly; SameSite=Lax; Path=/api/fs; Max-Age=28800`).

### 2.6 Git Subsystem (`server/src/git/`)
- `commit_message_rewrite.rs`:
  - Direct Git ODB object manipulation (`git2::OdbObject`, raw headers, parents, trees).
  - `get_commit_message`: Returns `{ message, branch, headOid }`. Rejects non-UTF-8 messages or encodings.
  - `edit_commit_message`: Rewrites commit message on active or inactive local branch:
    - Verifies branch and tip agree with GET snapshot (`stale-ref` guard).
    - Checks reachability from captured tip.
    - Guards against active git operations (rebase, merge, cherry-pick) and worktree checkout collisions (`checked-out-branch`).
    - Validates commit signature invalidation; requires `allowSignatureRemoval = true` if signatures exist.
    - Rewrites raw commit objects in ODB and updates ref atomically via compare-and-swap.
- `squash_commits.rs`:
  - `squash_commits`: Collapses parent-contiguous linear range (oldest-first) into a single commit:
    - Enforces unique full 40-hex OIDs.
    - Rejects ranges with merge commits (must have at most one parent).
    - Preserves oldest commit author and uses current configured committer.
    - Remaps descendant commit parents and verifies final tree matches captured tip.
- `leased_push.rs`:
  - Two-phase compare-and-swap publication protocol:
    1. `prepare_leased_push`: Checks branch upstream configuration (`branch.<name>.remote`, `branch.<name>.merge`). Rejects mirror remotes, multiple push refspecs, wildcard refspecs, multiple push URLs. Connects to remote with credentials and discovers remote destination ref OID. Emits `PublishPreview` with `PublishSnapshot`.
    2. `publish_leased_push`: Validates snapshot against current local and remote state (verifies local head OID, repo identity, remote identity, and that remote ref still equals `expected_remote_oid`). Performs atomic push update (`+<source_oid>:<destination_ref>`).
- `worktree.rs`: Git worktree management (`list`, `add`, `remove`, `prune`).
- `vcs_roots.rs`: Nested VCS root and submodule discovery (`discover_vcs_roots`, `resolve_git_request_root`).

### 2.7 Web Hosting & Utilities (`server/src/web_host/`, `server/src/utils/`, `server/src/workspace_target.rs`)
- `web_host/`:
  - `run_web_host(options: WebHostOptions)`: Dedicated static host (`dam-hopper-web` binary). Validates root directory (must exist, must be directory, symlinks forbidden). Validates release version (SemVer).
  - `router.rs`:
    - `GET /__dam-hopper/health`: Emits `WebHealthResponse` (`Cache-Control: no-store`).
    - `GET /__dam-hopper/runtime-config.json`: Emits public `WebRuntimeConfig` (capped at 4 KiB, `Cache-Control: no-store`).
    - `static_fallback_handler`: Serves static files with MIME detection or falls back to SPA `index.html` for GET/HEAD requests.
  - `cache_policy.rs`: Immutable (1 year) for hashed Vite assets (`/assets/*`), `no-cache` for `index.html` and config, 1 hour bounded cache for other static files.
- `workspace_target.rs`:
  - `ProjectTargetRef`: `{ project: String, worktreePath: Option<String> }`.
  - `ResolvedProjectTarget`: Authoritative server resolution of project roots and registered Git worktrees. Cached with 2s TTL, max 32 projects.
- `utils/fs.rs`:
  - `atomic_write(target: &Path, content: &str)` / `atomic_write_bytes`: Writes to `.dam-hopper-tmp-*.tmp` in parent directory, sets mode `0o600` on Unix, and atomically renames.
  - `windows_file_identity(path)`: Retrieves volume serial number and file index via Windows API `GetFileInformationByHandle`.

### 2.8 API Routers & Handlers (`server/src/api/`)
- `router.rs`:
  - `build_router_with_web_dir_and_origins(state, allowed_origins, web_dir)`:
    - Request body cap: `MAX_BODY_BYTES = 10 MiB`.
    - Merges route groups: `public`, `protected`, `ide_routes`, `video_stream`, `image_stream`, `host_resource_stream_routes`, `advisor_routes`.
    - Handles `--web-dir` SPA fallback via `ServeDir` while explicitly preserving `/api/*` 404 responses.
    - Builds strict CORS layer (`build_cors`) enforcing explicit origins, methods, and exposed headers.
- `ws_protocol.rs`:
  - `ClientMsg` enum (tagged `kind`): `terminal:write`, `terminal:resize`, `terminal:attach`, `fs:subscribe_tree`, `fs:unsubscribe_tree`, `fs:read`, `fs:write_begin`, `fs:write_chunk`, `fs:write_chunk_binary`, `fs:write_commit`, `fs:op`, `fs:upload_begin`, `fs:upload_chunk`, `fs:upload_commit`, `auth:register_start`, `auth:register_finish`, `auth:login_start`, `auth:login_finish`, `fs:put_begin`, `fs:put_chunk`, `fs:put_commit`, `fs:put_save`, `auth:session_remove`.
  - `ServerMsg` enum (tagged `kind`): `terminal:output` (with `data`, `offset`, `incarnation`), `terminal:buffer` (with `data`, `offset`, `reset`, `truncated`, `incarnation`), `terminal:lifecycle`, `terminal:exit` (with `exitCode`, `willRestart`, `restartIn`, `restartCount`, `incarnation`), `terminal:lagged`, `terminal:agentStatusChanged`, `terminal:agentStatusRemoved`, `terminal:agentStatusInvalidated`, `process:restarted`, `fs:tree_snapshot`, `fs:event`, `fs:error`, `fs:overflow`, `fs:read_result`, `fs:write_ack`, `fs:write_chunk_ack`, `fs:write_result`, `fs:op_result`, `tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`, `fs:upload_begin_ok`, `fs:upload_chunk_ack`, `fs:upload_result`, `auth:register_start_response`, `auth:register_finish_response`, `auth:login_start_response`, `auth:login_finish_response`, `fs:put_begin_ok`, `fs:put_chunk_ack`, `fs:put_result`, `fs:put_save_result`, `port:discovered`, `port:lost`.
  - `WireMsg`: `Text`, `Binary`, `CloseOverflow`, `CloseAuth`.
- `ws.rs`:
  - Handshake: Validates query parameter `token` or cookie `damhopper-auth`. Origin check via `websocket_origin_allowed`.
  - Channel architecture:
    - PTY queue: bounded capacity 512, uses backpressure (`.await`).
    - FS queue: bounded capacity 512, uses `try_send` (overflow drops subscription only via `FsOverflow`).
    - Alert queue: bounded capacity 32, priority channel.
  - Connection auth monitoring: Checks session validity every 5s against database. Terminates with close codes:
    - `4403`: `MFA_REQUIRED` (10-day periodic MFA elapsed).
    - `4401`: `SESSION_EXPIRED` or `SESSION_REVOKED`.
    - `1013`: `AUTH_UNAVAILABLE`.
    - `4001`: `CLOSE_OVERFLOW`.

---

## 3. Runtime & Data Flow

### 3.1 Startup & Lifecycle Sequence
```
[Process Start]
       │
       ▼
1. Early Hook Reporting (`maybe_dispatch_early_report_hook`) -> fast exit if integration command
       │
       ▼
2. Load .env: CWD `.env` -> Global `.env` (`~/.config/dam-hopper/.env`) -> Explicit config parent `.env`
       │
       ▼
3. Clap CLI Parsing (`Cli::parse()`) -> if `Commands::Integration`, dispatch & exit
       │
       ▼
4. libgit2 Safety Setup (`set_verify_owner_validation(false)`, GIT_CONFIG safe.directory="*")
       │
       ▼
5. Token Management: Read or generate `~/.config/dam-hopper/server-token` (0o600). Exit if `--new-token`.
       │
       ▼
6. Config Resolution (`resolve_startup_config`): CLI -> Workspace -> Global Registry -> Global Default -> CWD -> Empty
       │
       ▼
7. Service Bootstrap:
   - SessionStore & PersistWorker (`~/.config/dam-hopper/sessions.db`)
   - TelemetryRuntime (`~/.config/dam-hopper/telemetry.db`)
   - PtySessionManager (bounded broadcast sink, cleanup task)
   - TunnelSessionManager (`cloudflared`) & PortForwardManager (`/proc/net/tcp` poller on Linux)
   - AgentStatusRuntime & Private Loopback Collector (127.0.0.1:random on Linux)
   - AgentStoreService (`.dam-hopper/agent-store`)
   - MongoDB Client & AuthStore index verification (if configured)
   - OPAQUE ServerSetup (`~/.config/dam-hopper/opaque-server-setup`)
   - AppState creation & No-Auth safety verification
   - IdleSuspendCoordinator enrollment (`/run/dam-hopper/idle-suspend.sock` on Linux)
       │
       ▼
8. Persistence Restore: Relaunch live sessions, seed port candidates, reconcile workflow links
       │
       ▼
9. Axum Server: Bind TcpListener with ForceCloseListener & graceful shutdown signal (SIGTERM / Ctrl+C)
       │
       ▼
[Shutdown Signal Received] -> 10s HTTP drain deadline -> snapshot PTY buffers -> stop readers -> send PersistCmd::Shutdown -> reap child processes (tunnels, telemetry, agent status) -> exit 0
```

### 3.2 Authentication & Policy Enforcement Flow
```
Incoming HTTP / WS Request
       │
       ├─► Route is Public (/api/health, /api/auth/login, /api/auth/register, /api/auth/mfa/*)
       │         │
       │         └─► Execute handler directly (MFA challenge handler extracts token/cookie internally)
       │
       └─► Route is Protected (requires auth middleware)
                 │
                 ▼
       State.no_auth == true?
            ├── YES ──► Inject AuthenticatedActor::dev_user(), Mechanism::NoAuthDev -> Next
            └── NO  ──► Extract Bearer header -> fallback to `damhopper-auth` cookie
                             │
                             ├─► Missing token ──► 401 UNAUTHORIZED (AUTH_REQUIRED)
                             │
                             ▼
                        Decode JWT claims with state.jwt_secret
                             │
                             ├─► Invalid / malformed ──► 401 UNAUTHORIZED (AUTH_REQUIRED)
                             │
                             ▼
                        Evaluate session policy (`state.auth_service.evaluate_claims`):
                             ├─► User disabled ──► 401 UNAUTHORIZED (ACCOUNT_DISABLED)
                             ├─► Protocol version != 2 ──► 401 UNAUTHORIZED (AUTH_REQUIRED)
                             ├─► Subject / SID mismatch ──► 401 UNAUTHORIZED (AUTH_REQUIRED)
                             ├─► auth_version mismatch ──► 401 UNAUTHORIZED (SESSION_REVOKED)
                             ├─► credential_version mismatch ──► 401 UNAUTHORIZED (SESSION_REVOKED)
                             ├─► revoked_at is some ──► 401 UNAUTHORIZED (SESSION_REVOKED)
                             ├─► now >= expires_at (30 days) ──► 401 UNAUTHORIZED (SESSION_EXPIRED)
                             ├─► now >= mfa_due_at (10 days) ──► 401 UNAUTHORIZED (MFA_REQUIRED)
                             └─► Valid ──► Inject AuthenticatedActor with session metadata -> Next
```

### 3.3 File System Write & Encrypted Put Flow
- **Standard Chunked Write Protocol (`fs:write_*`):**
  1. `fs:write_begin`: Client sends `project`, `path`, `expected_mtime`, `size` (<= 100 MiB). Server resolves `ProjectTargetRef`, validates canonical sandbox path, creates `NamedTempFile` adjacent to target, stores in-flight `WriteInFlight`.
  2. `fs:write_chunk` / `fs:write_chunk_binary`: Sends sequence-validated data chunks. Bytes written to temp file.
  3. `fs:write_commit`: Re-resolves target via `DirectoryIdentity` (`openat`, `O_NOFOLLOW`). Compares current target mtime against `expected_mtime`. If changed, returns `conflict: true`. Otherwise atomically renames temp file over destination and syncs.
- **OPAQUE Encrypted Put Protocol (`fs:put_*`):**
  1. Client establishes shared session key via OPAQUE PAKE (`auth:login_start` / `auth:login_finish`). Server derives AES-256-GCM key.
  2. `fs:put_begin`: Client initiates encrypted upload with `session_id`, `dir`, `filename`, `expected_mtime`.
  3. `fs:put_chunk`: Client streams encrypted binary chunks to temp file.
  4. `fs:put_commit`: Server decrypts blob using derived session key, validates mtime, and atomically commits via `secure_path`.

### 3.4 Git History Rewrite & Leased Push Flow
- **Commit Message Editing (`edit_commit_message`):**
  - Lock-free GET returns message snapshot with `{ branch, headOid }`.
  - POST requires `expectedBranch` and `expectedHeadOid`. Preflight verifies tip has not moved (`stale-ref` error if moved).
  - Checks if branch is checked out in another linked worktree (`checked-out-branch` error).
  - Reconstructs ODB commit objects for target and all descendants, maintaining topology and trees. Verifies new tip tree matches captured tip tree. Updates ref transactionally.
- **Commit Squashing (`squash_commits`):**
  - Verifies selected commits are parent-contiguous, unique, oldest-first, and reachable from tip.
  - Verifies none of the selected commits or rewritten descendants are merge commits (parents <= 1).
  - Collapses tree to newest selection, author to oldest selection, committer to current repository user.
  - Remaps descendant parent pointers in ODB and commits atomic ref update.
- **Leased Push (`prepare_leased_push` & `publish_leased_push`):**
  - `prepare_leased_push`: Checks remote configuration (rejects mirror remotes, multiple push URLs, wildcard refspecs). Contacts remote, finds current destination ref OID. Emits `PublishPreview` with `PublishSnapshot`.
  - `publish_leased_push`: Rechecks repository identity and remote identity. Atomically compares current remote ref OID with `expected_remote_oid`. If equal, executes push. If remote has moved, fails with `stale-lease`.

---

## 4. Authoritative Commands, Config & Contracts

### 4.1 CLI Commands & Binaries
| Binary | Command / Flag | Purpose |
| --- | --- | --- |
| `dam-hopper-server` | `--port <PORT>` | API listen port (default `4800`, env `DAM_HOPPER_PORT`). |
| `dam-hopper-server` | `--host <HOST>` | API bind IP (default `0.0.0.0`, env `DAM_HOPPER_HOST`). |
| `dam-hopper-server` | `--config <PATH>` | Explicit path to `dam-hopper.toml` (env `DAM_HOPPER_CONFIG`). |
| `dam-hopper-server` | `--workspace <PATH>` | Workspace directory containing config (env `DAM_HOPPER_WORKSPACE`). |
| `dam-hopper-server` | `--new-token` | Generate new JWT signing secret to `~/.config/dam-hopper/server-token` and exit. |
| `dam-hopper-server` | `--no-auth` | Development-only auth bypass (env `DAM_HOPPER_NO_AUTH`). Forbidden in production or with MongoDB. |
| `dam-hopper-server` | `--cors-origins <ORIGINS>` | Comma-separated exact HTTP(S) origins (env `DAM_HOPPER_CORS_ORIGINS`). |
| `dam-hopper-server` | `--web-dir <PATH>` | Combined mode static root (env `DAM_HOPPER_WEB_DIR`). |
| `dam-hopper-server` | `integration <agent> <action>` | Subcommands: `omp`, `codex`, `claude` with actions `install`, `status`, `uninstall`, `report-hook`. |
| `dam-hopper-web` | `--root <PATH>` | Root static files directory (mandatory, env `DAM_HOPPER_WEB_ROOT`). |
| `dam-hopper-web` | `--port <PORT>` | Listen port (default `4802`, env `DAM_HOPPER_WEB_PORT`). |
| `dam-hopper-web` | `--host <HOST>` | Bind IP (default `0.0.0.0`, env `DAM_HOPPER_WEB_HOST`). |
| `dam-hopper-web` | `--runtime-config <PATH>` | Optional public runtime configuration JSON (env `DAM_HOPPER_WEB_RUNTIME_CONFIG`). |
| `dam-hopper-web` | `--release-version <VER>` | Optional release version override (env `DAM_HOPPER_WEB_RELEASE_VERSION`). |

### 4.2 Configuration Precedence
1. **Startup Config File Priority (`resolve_startup_config`):**
   - 1. `--config` CLI option / `DAM_HOPPER_CONFIG` env var.
   - 2. `--workspace` CLI option / `DAM_HOPPER_WORKSPACE` env var (looks for `dam-hopper.toml` in that directory).
   - 3. Global user registry: `~/.config/dam-hopper/dam-hopper.toml`.
   - 4. Global default workspace: `global_config.defaults.workspace` in `~/.config/dam-hopper/config.toml`.
   - 5. Current working directory legacy discovery (`./dam-hopper.toml`).
   - 6. Empty workspace fallback (`ConfigSource::EmptyFallback`).
2. **Environment Variable Loading Order:**
   - 1. Process environment.
   - 2. CWD `.env` (`dotenvy::dotenv().ok()`).
   - 3. Global config `.env` (`~/.config/dam-hopper/.env`).
   - 4. Explicit config directory `.env` (`<parent_of_explicit_config>/.env`).
   - 5. Resolved config directory `.env` (`<parent_of_resolved_config>/.env`, if explicit config was not set).

### 4.3 Authoritative Config Keys (`dam-hopper.toml` & `config.toml`)
- `[workspace]`: `name: string`, `root: string` (default `"."`).
- `[agent_store]`: `path: string` (default `".dam-hopper/agent-store"`).
- `[server]`:
  - `session_db_path`: string (default `"~/.config/dam-hopper/sessions.db"`).
  - `session_buffer_ttl_hours`: u64 (default `24`).
  - `workflow_event_retention_days`: u32 ([1, 3650], default `90`).
  - `workflow_deleted_note_retention_days`: u32 ([1, 3650], default `7`).
  - `workflow_stale_after_hours`: u32 ([1, 8760], default `24`).
- `[server.telemetry]`:
  - `enabled`: bool (default `false`).
  - `paused`: bool (default `false`).
  - `db_path`: string (default `"~/.config/dam-hopper/telemetry.db"`).
  - `detail_retention_days`: u16 ([1, 3650], default `90`).
  - `aggregate_retention_days`: Option<u32> (must be positive if set).
  - `[server.telemetry.collector]`: `enabled: bool`, `host: string` (must be loopback, default `"127.0.0.1"`), `port: u16` (non-zero, default `4811`).
- `[server.idle_suspend]`:
  - `enabled`: bool (default `false`).
  - `quiet_period_seconds`: u64 ([60, 86400], default `900`).
  - `wake_after_seconds`: u64 ([60, 86400], default `600`).
  - `enrollment_reference`: Option<string> (max 256 bytes).
  - `capability_selection`: `"auto"` | `"systemd-logind"` | `"rtcwake"`.
  - `automatic_policy`: `"empty-fleet"` | `"agent-activity"`.
  - `agent_executables`: array of strings (1 to 32 items, max 256 bytes per entry, no generic interpreter names).
- `[server.advisor]`: `enabled: bool` (default `false`).
- `[projects]`: Array of project definitions:
  - `name`: string.
  - `path`: string (relative on disk, resolved to absolute in memory).
  - `type`: `"maven"` | `"gradle"` | `"npm"` | `"pnpm"` | `"cargo"` | `"custom"`.
  - `restart`: `"never"` | `"on-failure"` | `"always"`.
  - `restart_max_retries`: u32 (default `5`).
  - `services`: array of `{ name, buildCommand, runCommand }`.
  - `terminals`: array of `{ name, command, cwd }`.
  - `commands`: map of custom named commands.
  - `agents`: assignments for `claude` and `gemini` (`skills`, `commands`, `hooks`, `mcp_servers`, `subagents`, `distribution`, `memory_template`).
- Global UI Configuration (`config.toml` `[ui]`):
  - Desktop font sizes: `systemFontSize`, `editorFontSize`, `terminalFontSize` ([10, 32]).
  - Mobile custom keyboard: `mobileCustomKeyboardEnabled`, `mobileCustomKeyboardFontSize` ([9, 18]), `mobileCustomKeyboardPadding` ([2, 14]), `mobileCustomKeyboardRowGap` ([2, 12]).
  - Notifications: `terminalAgentNotifications` (version `2`, per-agent policies for `codex`, `omp`, `claude` with volume [0, 100], `toast`, `browser`, `sound`, `pattern`).
  - Cognito Privacy: `cognitoModeStyle` (`"heavy-blur"` | `"black-screen"`), `cognitoModeShortcut` (default `"Mod+Alt+KeyB"`).

---

## 5. Product Capabilities & Hard Architectural Limits

### 5.1 Request Body & Payload Limits
- Global Axum Body Limit: `10 MiB` (`MAX_BODY_BYTES` in `server/src/api/router.rs:24`).
- Route-Specific Payload Limits (`RequestBodyLimitLayer`):
  - Auth MFA routes: `16 KiB` (`router.rs:56`).
  - Workflow routes: `32 KiB` (`router.rs:80`).
  - Advisor policy update & models list: `16 KiB` (`router.rs:608,614`).
  - Advisor history, settings, and evaluations: `64 KiB` (`router.rs:578-602,620-632`).
  - Host action intents & executions: `8 KiB` (`router.rs:341,363`).
  - Idle suspend timing & force suspend: `16 KiB` (`router.rs:379,383`).
  - Settings workspace import: `1 MiB` (`router.rs:467`).
  - Browser debug selection JSON: `256 KiB` (`MAX_SELECTION_JSON_BYTES`).
  - Browser debug screenshot PNG: `10 MiB` (`MAX_PNG_BYTES`).
- WebSocket & File System Caps:
  - Unrestricted WebSocket file read: `5 MiB` (`FS_WS_READ_MAX` in `ws.rs:57`; larger reads require `offset` and `len` range parameters).
  - WebSocket chunked file write: `100 MiB` (`FS_WRITE_MAX` in `ws.rs:60`).
  - File upload cap: `100 MiB` (`MAX_UPLOAD_BYTES`).
  - Workspace file content search results: `500` matches (`MAX_WORKSPACE_SEARCH_RESULTS`).
  - Target resolution cache: `32` projects, `2 seconds` TTL (`workspace_target.rs:20-21`).

### 5.2 Concurrency & Queue Capacities
- Outbound WebSocket split channels (`server/src/api/ws.rs:48-50`):
  - PTY Output Channel: `512` messages (backpressured via `.await`).
  - File System Event Channel: `512` messages (uses `try_send`; overflow drops subscription with `FsOverflow`).
  - Host Alert Channel: `32` messages (priority biased queue).
- Broadcast Event Sink: `512` messages capacity (`TOKEN_CAPACITY` in `main.rs:238`).
- Session Persistence Command Channel: `256` commands (`main.rs:624`).

### 5.3 Authentication Policy Limits & Deadlines
- Absolute Session Lifetime: `30 days` (`SESSION_LIFETIME_SECS = 2_592_000`), zero grace period.
- Periodic MFA Freshness: `10 days` (`MFA_VALIDITY_SECS = 864_000`).
- Challenge Lifetime: `5 minutes` (`CHALLENGE_LIFETIME_SECS = 300`).
- Max Verification Attempts per Challenge: `5` attempts (`CHALLENGE_MAX_ATTEMPTS = 5`).
- Account Failed MFA Lockout: `10` attempts within a `10-minute` sliding window triggers a `10-minute` cooldown lockout (`ACCOUNT_COOLDOWN_SECS = 600`).
- Media Ticket Lifetimes: Idle TTL `15 minutes`, absolute TTL `8 hours`.
- Media Session Cookie Lifetime: Idle TTL `30 minutes`, absolute TTL `8 hours` (`Max-Age = 28800`).

---

## 6. Stale Documentation Claims & Evidence-Based Updates Needed

### 6.1 Critical Doc Discrepancies Identified
1. **WebSocket Terminal Lifecycle Messages (`docs/api/websocket.md:18-33`):**
   - *Stale Claim:* Documents `{ kind: "terminal:spawn" }`, `{ kind: "terminal:kill" }`, `{ kind: "terminal:exited", id, code }`, and output payload `{ kind: "terminal:output", id, chunk }`.
   - *Source Reality:* `server/src/api/ws_protocol.rs:18-35,225-275`. Inbound `terminal:spawn` and `terminal:kill` do **NOT** exist in `ClientMsg`. Terminal sessions are created via REST `POST /api/terminal` and deleted via REST `DELETE /api/terminal/{id}`. WebSocket handles `terminal:write`, `terminal:resize`, and `terminal:attach`. In outbound messages, exit is `terminal:exit` (carrying `exitCode`, `willRestart`, `restartIn`, `restartCount`, `incarnation`), and output carries `data`, `offset`, `incarnation` (not `chunk`).
   - *Doc Fix Required:* Remove legacy spawn/kill from active WebSocket command lists; document REST creation requirement; update exit and output event schemas to include `offset` and `incarnation`.

2. **Credential Admission for `POST /api/auth/mfa/challenge` (`docs/authentication-api.md:18, docs/api/authentication.md`):**
   - *Stale Claim:* Some documentation sections implied step-up challenges require Bearer-only authentication.
   - *Source Reality:* `server/src/api/auth_mfa.rs:1024` calls `extract_token_and_mechanism(&request, &jar)` which explicitly inspects `Authorization: Bearer` and falls back to `jar.get("damhopper-auth")`.
   - *Doc Fix Required:* Clarify that either Bearer or `damhopper-auth` cookie is admitted.

3. **Standalone vs Release Port Documentation (`docs/configuration/server-environment-auth.md:29`):**
   - *Stale Claim:* Ambiguity exists across guides where `4800`, `4801`, `4802`, and `4803` are occasionally referenced interchangeably.
   - *Source Reality:* `server/src/main.rs:44` default is `4800` (host `0.0.0.0`). Systemd sets `4801` for API and `4802` for `dam-hopper-web`. Frontend Vite uses `4803`.
   - *Doc Fix Required:* Standardize the port map matrix in `docs/configuration/server-deployment.md` and `docs/configuration/server-environment-auth.md`.

4. **Config Update API Restrictions (`docs/api/workspace-settings.md`):**
   - *Stale Claim:* Generic description of `PUT /api/config` updating any server config.
   - *Source Reality:* `server/src/api/config.rs:45-120` (`preserve_and_reject_telemetry_mutation` and `preserve_and_reject_idle_suspend_mutation`) explicitly rejects updates to `server.telemetry` (must use `/api/usage/settings`) and `server.idle_suspend` (must use `PATCH /api/system/idle-suspend/v1/timing`).
   - *Doc Fix Required:* Explicitly document that `PUT /api/config` returns `400 Bad Request` if telemetry or idle-suspend fields differ from current active state.

5. **Legacy Plugin Platform Allowlist Context (`docs/configuration/server-environment-auth.md:120-146`):**
   - *Stale Claim:* Documents `DAM_HOPPER_PLUGIN_ADMINS_FILE`, `/etc/dam-hopper/plugin-admins.json`, and plugin runner rules.
   - *Source Reality:* The plugin platform has been completely deleted from the Rust server and codebase.
   - *Doc Fix Required:* Ensure this entire section remains clearly flagged as historical archival material or relocate it to an archive file so operators do not attempt to configure it.

6. **Media Capability Cookie Format (`docs/api/filesystem-and-media.md:58-75`):**
   - *Verified Active:* Uses v2 namespaced cookie `damhopper-media-session-<canonical-lowercase-uuidv4>`. Confirm that all references to old v1 static cookie `damhopper-media-session` are purged.

---

## 7. Retired Versus Active Functionality

| Subsystem / Feature | Status | Implementation Details / Replacement |
| --- | --- | --- |
| **Plugin Platform Runner** | **RETIRED** | Legacy Node.js runner (`dam-hopper-plugin-runner`), UDS `/run/dam-hopper/plugin-runner.sock`, and `DAM_HOPPER_PLUGIN_ADMINS_FILE` removed. Replaced by Native Advisor (`server/src/advisor/`). |
| **WebSocket `terminal:spawn` / `terminal:kill`** | **RETIRED** | Inbound WS commands removed from `ClientMsg`. Sessions must be created via REST `POST /api/terminal` and killed via REST `DELETE /api/terminal/{id}`. |
| **WebSocket `terminal:exited` & `chunk` output** | **RETIRED** | Replaced by `terminal:exit` (with restart metadata & incarnation) and `terminal:output` (with `data`, `offset`, `incarnation`). |
| **WebSocket Envelope Tag `type`** | **RETIRED** | Old `{"type": "..."}` envelope completely replaced by `{"kind": "..."}` hard cut in `ws_protocol.rs`. |
| **Legacy Format-2 Linux Releases** | **RETIRED** | Replaced by schema v2 `release-manifest.json` and manager state schema v3 with atomic side-staged migrations. |
| **V1 Media Session Cookie** | **RETIRED** | Replaced by v2 client-bound namespaced cookie `damhopper-media-session-<uuidv4>`. |
| **Deferred Host Actions** | **INERT / FAIL-CLOSED** | REST scaffolding exists in `server/src/api/host_actions.rs` (`/api/system/actions/v1/*`), but routes fail-closed and are deferred out of active production scope. |
| **Standalone Server Entry** | **ACTIVE** | `dam-hopper-server` binary (`src/main.rs`) running on port `4800` (host `0.0.0.0`). |
| **Dedicated Static Web Host** | **ACTIVE** | `dam-hopper-web` binary (`src/web_host/`) running on port `4802` with non-writing SPA fallback and health check. |
| **Multi-Stage Config Resolution** | **ACTIVE** | 6-priority resolution in `server/src/config/resolve.rs` with atomic writes. |
| **Session Persistence** | **ACTIVE** | SQLite store at `~/.config/dam-hopper/sessions.db` with background `PersistWorker`. |
| **Auth & MFA Engine** | **ACTIVE** | MongoDB store with 30-day session / 10-day MFA freshness, 5-minute challenges, strict `0o600` key file, and versioned JWT claims (`auth_version`, `credential_version`). |
| **OPAQUE Encrypt-In-Transit** | **ACTIVE** | OPAQUE PAKE using Ristretto255/TripleDH, HKDF domain-separated AES-256-GCM write protocol (`fs:put_*`). |
| **Git ODB Rewrites & Leased Push** | **ACTIVE** | Raw commit object manipulation for message editing and squashing; CAS leased push publication with remote OID leasing. |
| **Secure Path & Sandboxing** | **ACTIVE** | `openat` / `O_NOFOLLOW` with inode/device validation eliminating symlink TOCTOU races. |

---

## 8. Unresolved Questions

1. **Agent Store Path Switching on Workspace Switch:**
   - In `server/src/state.rs:55`, a code comment notes: `"NOTE: store path is not updated on workspace:switch — requires server restart to pick up new workspace's agent store. Phase 06 or follow-up refactor to address."` Does documentation currently reflect that dynamic workspace switching does not reload the active agent store path without a server restart?
2. **MongoDB Connection in Development Mode without `--no-auth`:**
   - If `MONGODB_URI` is unset and `RUST_ENV` is development, the server logs a warning and initializes `AuthService::new_mock_default()`. Are the mock session credentials (`test-user` / `test-session`) intended solely for automated test suites, or is this considered an interactive developer fallback that requires documentation?
3. **Telemetry Exporter Conflict Handling:**
   - When managing the local Codex exporter (`codexExporter: true`), foreign configurations report `"conflict"` and are not overwritten. Should the settings UI guide operators on how to resolve conflicting `~/.codex/config.toml` configurations manually?

---
*Report compiled by Codebase Scout for DamHopper documentation consolidation.*
