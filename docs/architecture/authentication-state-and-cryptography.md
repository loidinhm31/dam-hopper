# Authentication State, Cryptography, and Session Policy

**Authority:** Server Authentication Core (`server/src/auth/`)  
**Status:** Maintained Architecture Specification  

## Scope and Integration Boundary

The authentication subsystem provides backend-abstracted auth-state persistence (MongoDB and implemented SQLite storage adapters), cryptographic helpers, TOTP verification, and a deterministic session-policy evaluator. Challenge-based login, enrollment, verification, status, and logout endpoints are defined in the [Authentication API](../api/authentication.md).

- `AppState` owns an `Arc<AuthService>`; `evaluate_claims` loads current session/user state and invokes the shared policy evaluator.
- Protected REST middleware and WebSocket admission use this evaluator. `AuthenticatedActor` carries non-secret session identity/version and effective deadline; no raw bearer material is retained.
- WebSockets check the local deadline on inbound frames and outbound writes, with a five-second background session/revocation watcher. Image and video media capabilities bind to the auth session and versions, clamp absolute TTL to the effective deadline, and revalidate live streams.

Session issuance and every protected REST admission enforce the 30-day absolute and 10-day MFA freshness deadlines. WebSocket and media streams also enforce deadline and bounded revocation checks.

## Module Map

| Path | Responsibility |
| --- | --- |
| `server/src/auth/model.rs` | User, MFA, session, challenge, V2 claims, and policy decision records |
| `server/src/auth/store.rs` | Shared `AuthStore` facade: backend dispatch (`Backend::{Mongo, Sqlite}`), constructors (`from_mongo`, `open_sqlite`), unified error type (`StoreError`), user insertion, and test qualification hooks |
| `server/src/auth/store/mongo.rs` | Private MongoDB adapter: collections, indexes, account/challenge attempts, session operations, and compare-and-swap (CAS) mutations |
| `server/src/auth/store/sqlite.rs` | Private SQLite adapter: connection lifecycle, `spawn_blocking` execution, atomic CAS operations, attempt throttling, and opportunistic pruning |
| `server/src/auth/store/sqlite/open.rs` | Secure SQLite file preparation (0600 file / 0700 dir, symlink rejection), WAL pragmas, application ID header check, and versioned schema migrations |
| `server/src/auth/store/sqlite/records.rs` | Row-to-model checked mapping, UTC millisecond conversions, and fail-closed `InconsistentState` decoding |
| `server/src/auth/store/migrations/001-auth.sql` | Version 1 SQLite schema: STRICT `auth_users`, `auth_sessions`, and `auth_challenges` tables, indexes, and immutable ID trigger |
| `server/src/auth/store/migrations/002-session-user-agent.sql` | Version 2 SQLite schema: bounded nullable `user_agent TEXT` column and `auth_sessions_inventory` index |
| `server/src/auth/session_inventory.rs` | Session cursor encoding/decoding, pagination boundary (50 rows/page), and bounded user-agent text normalization (<= 512 UTF-8 bytes) |
| `server/src/auth/policy.rs` | Injectable clock, deadline calculation, session decision table, challenge readiness, and throttle constants |
| `server/src/auth/secret.rs` | MFA key-file loading and AES-256-GCM secret encryption/decryption |
| `server/src/auth/totp.rs` | Secret generation/encoding, `otpauth://` URI construction, TOTP verification, and replay check |
| `server/src/auth/mod.rs` | `AuthService`, opaque challenge-token generation/digesting, and state-backed claim evaluation |
| `server/src/auth/config.rs` | Backend selection from Precedence Matrix (`DAM_HOPPER_LITE_MODE`, `MONGODB_URI`, `MONGODB_DATABASE`), SQLite path resolution (default `auth.db` in global config, `~/` and CWD-relative forms), and distinct-database-file check |
| `server/src/state.rs`, `server/src/main.rs` | `AppState` ownership of the selected store via `AuthService`, key loading, production/`--no-auth` guards, and one-time store initialization (`init_auth_store`) |
| `server/src/api/auth.rs` | Password login challenges, full-policy protected-route middleware, status/logout |
| `server/src/api/auth_mfa.rs` | Challenge-gated TOTP enrollment, login verification, and step-up handlers |
| `server/src/api/auth_sessions.rs` | Account-scoped session inventory (`GET /api/auth/sessions`) and bearer-only revocation (`DELETE /api/auth/sessions/{id}`) |
| `server/tests/auth_device_sessions.rs` | Device session listing, keyset pagination, bearer-only DELETE denial matrix, and cookie isolation coverage |
| `server/tests/auth_device_session_failures.rs` | Device session storage error mapping and edge cases |
| `server/tests/auth_device_session_store.rs` | SQLite & MongoDB session inventory query, cursor tie-breaking, and idempotent revocation store tests |
| `server/tests/auth_session_metadata.rs` | User-agent normalization, character-boundary truncation, and control-character filtering tests |
| `server/tests/auth_mfa_api.rs` | HTTP lifecycle coverage for enrollment, login MFA, session step-up/status/logout, and edge cases |
| `server/tests/auth_state_and_policy.rs` | Focused policy, encryption, TOTP/replay, throttle, and MongoDB-store coverage |
| `server/tests/auth_sqlite_store.rs` | Dedicated file-backed SQLite store test suite: migrations, concurrency, CAS semantics, throttling, pruning, and security constraints |
| `server/tests/auth_lite_mode.rs` | File-backed SQLite lite-mode integration: registration, administrator gate, re-authentication, routed disabled-actor denial, storage-failure denial, and startup guards |
| `server/tests/transport_enforcement_phase03.rs` | REST, WebSocket admission/live revocation, logout, and reset integration coverage |

## Persisted State and Policy

Collections and tables persist user, session, and challenge records. JWT claims use the explicit V2 fields `v`, `sub`, `sid`, `authVersion`, `credentialVersion`, `iat`, and `exp`.

| State | Contract |
| --- | --- |
| User | Retains username, password hash, enablement, and role. `authVersion` defaults to `0` when absent in legacy documents; optional `mfa` stores the confirmed encrypted factor and last accepted TOTP step. Failed-attempt window/count/cooldown are account fields. |
| Session | Binds one username to `authVersion`, `credentialVersion`, issue time, absolute expiry, most recent MFA time, optional revocation time, and optional `user_agent` hint (bounded to <= 512 UTF-8 bytes; null for legacy sessions). |
| Challenge | Stores the SHA-256 digest of the client-facing random token as its ID, account/version, purpose (`enroll`, `loginMfa`, or `stepUp`), issue/expiry times, attempts/consumption state, and purpose-specific encrypted enrollment or session binding data. |
| Session decision | Requires enabled account, V2 claims, matching account/session/claim identity and versions, non-revoked session, and exact JWT/session expiry agreement. At `now >= expiresAt`, full login is required; before expiry, at `now >= mfaDueAt`, MFA step-up is required; otherwise access is allowed. |

Policy bounds are fixed in `policy.rs`:

| Bound | Value |
| --- | --- |
| Absolute session lifetime | 30 days; no expiry grace |
| MFA freshness | 10 days per session, clamped to absolute session expiry |
| Challenge lifetime | 5 minutes |
| Challenge verification attempts | 5 maximum |
| Account failed attempts | 10 within a 10-minute window, then a 10-minute cooldown |
| Auth protocol | V2 |

`AuthDecision` distinguishes full access, MFA-required step-up, full-login-required, and unavailable state. Request-time policy checks enforce expiries independently of background deletion or pruning.

`AuthStore` is a facade over private backend adapters (`Backend::Mongo` and `Backend::Sqlite`); no raw database handle is exposed through it. `StoreError` unifies backend error variants (`Mongo`, `Bson`, `Sqlite`, `Io`, `Unavailable`, `DuplicateUsername`, `InconsistentState`). The store provides user insertion, conditional enrollment confirmation, monotonic accepted-step advancement, one-time challenge consumption, session MFA revision advancement, and session revocation. `create_user` is a plain insert that generates the immutable `_id` when absent and reports a username conflict as `StoreError::DuplicateUsername`; other write failures stay storage errors.

### MongoDB Storage Adapter

- Constructed via `AuthStore::from_mongo(db)`.
- Collections: `users`, `authSessions`, and `authChallenges` with camelCase BSON documents.
- Index setup: `init_indexes()` checks for duplicate usernames before requesting a unique username index, and requests username lookup plus expiry TTL indexes for sessions and challenges.
- Cleanup: MongoDB TTL background indexes garbage-collect expired documents; request-time policy checks remain authoritative.

### SQLite Storage Adapter (Implemented)

The SQLite adapter (`server/src/auth/store/sqlite.rs`) is fully implemented and tested at the storage layer:

- **Construction and Migration:** Opened asynchronously via `AuthStore::open_sqlite(path)`. Schema migrations run synchronously during open; `init_indexes()` is an intentional no-op.
- **Tables and Schema (`001-auth.sql`):** Dedicated authentication database with STRICT tables and UTC timestamps stored as integer milliseconds (`_ms`):
  - `auth_users`: Primary key `id` (24-hex lowercase ObjectId, protected against modification by `auth_users_id_immutable` trigger); `username` (`TEXT NOT NULL UNIQUE COLLATE BINARY`); `password_hash`; `is_enabled` (0 or 1); `role` (`user` or `admin`); `auth_version` (`>= 0`); MFA columns (`mfa_secret_ciphertext`, `mfa_nonce`, `mfa_key_id`, `mfa_enrolled_at_ms`, `mfa_last_accepted_step`) enforced all NULL or all non-NULL by a table `CHECK` constraint; attempt throttling columns (`mfa_attempt_window_started_at_ms`, `mfa_attempt_count`, `mfa_blocked_until_ms`).
  - `auth_sessions`: Primary key `id`; `username`; `auth_version`; `credential_version`; `issued_at_ms`; `expires_at_ms`; `mfa_verified_at_ms`; nullable `revoked_at_ms`. Migration `002-session-user-agent.sql` adds nullable `user_agent` (`CHECK (user_agent IS NULL OR (length(CAST(user_agent AS BLOB)) BETWEEN 1 AND 512))`). Indexed on `username`, `expires_at_ms`, and compound index `auth_sessions_inventory` on `(username, auth_version, issued_at_ms DESC, id DESC)`.
  - `auth_challenges`: Primary key `id` (hex SHA-256 digest of client token); `username`; `auth_version`; `purpose` (`enroll`, `loginMfa`, `stepUp`); `created_at_ms`; `expires_at_ms`; `attempts` (`0..u32::MAX`); nullable `consumed_at_ms`; purpose payload columns (`pending_secret_ciphertext`, `pending_secret_nonce`, `pending_secret_key_id`, `session_id`, `credential_version`). Indexes on `username` and `expires_at_ms`.
- **File Security and Open Invariants (`sqlite/open.rs`):**
  - Unix parent directory created with mode `0700`; existing parent directories writable by group or others (`mode & 0o022 != 0`) are rejected.
  - Database file opened/created with mode `0600`, `O_NOFOLLOW`, and `SQLITE_OPEN_NOFOLLOW`; existing files with any group or other bits (`mode & 0o077 != 0`) or symlinks are rejected. Sidecars (`-wal`, `-shm`) inherit `0600` permissions.
  - Pragmas: WAL journaling (`PRAGMA journal_mode = WAL`), full durability (`PRAGMA synchronous = FULL` ensuring power-loss durability for revocations and consumptions), 2-second busy timeout (`PRAGMA busy_timeout = 2000`), and foreign key enforcement (`PRAGMA foreign_keys = ON`).
  - Header & Version Gate: Validates `PRAGMA application_id = 0x44484155` ("DHAU") and `PRAGMA user_version`. Schema migration runs atomically in an `IMMEDIATE` transaction: a brand-new database initializes schema versions 0 to 2 sequentially applying `001-auth.sql` and `002-session-user-agent.sql`, while an existing version 1 database upgrades 1 to 2 upon applying `002-session-user-agent.sql`. A foreign database or newer schema version fails with `StoreError::Unavailable` before any mutation, and an unreadable/corrupt file fails open with a SQLite error. A failed open never selects another backend.
- **Concurrency and Execution Model:** Uses an `Arc<Mutex<rusqlite::Connection>>`. All operations execute inside `tokio::task::spawn_blocking`, holding the lock only synchronously for the duration of the closure and never across an async `.await`.
- **Compare-And-Swap (CAS) & Mutation Semantics:**
  - Exact parameterized queries prevent injection and ambiguity.
  - `create_user` is INSERT-only; SQLite `UNIQUE` conflict on `auth_users.username` maps exclusively to `StoreError::DuplicateUsername`.
  - Atomic CAS mutations use single conditional `UPDATE` statements: `confirm_enrollment` (requires matching `auth_version` and NULL factor), `advance_totp_step` (requires enrolled factor and strictly greater step), `consume_challenge`, `advance_session_mfa`, and `revoke_*`.
  - `revoke_owned_session` executes `UPDATE auth_sessions SET revoked_at_ms = COALESCE(revoked_at_ms, ?) WHERE username = ? AND id = ?`, returning `Ok(true)` if the session exists for that user and `Ok(false)` if missing or foreign. The operation is idempotent and preserves the initial `revoked_at_ms` timestamp on subsequent calls when requested by a surviving active session. Repeating a self-revocation request with the now-revoked token fails authentication at the middleware layer (`401 Unauthorized`) before reaching the handler.
  - `list_active_sessions` queries `auth_sessions` filtering by `username = ? AND auth_version = ? AND revoked_at_ms IS NULL AND expires_at_ms > ?`, ordering by `issued_at_ms DESC, id DESC` with a limit of 51 rows. A stable keyset cursor encodes `(issued_at_ms, id)` to avoid offset-pagination drift using a deterministic keyset boundary.
  - Authentication and rejection ordering: `require_auth` validates credentials first. Invalid or expired explicit Bearer credentials return `401 Unauthorized` without cookie fallback. Cookie-authenticated requests (including fallback from a non-Bearer header) are rejected by the revocation handler with `403 Forbidden` (`BearerRequired`) before any revocation write; authentication may already have read account/session state. DELETE never emits `Set-Cookie`.
  - Revoking a session immediately triggers `media_tickets.revoke_by_actor_or_session`, terminating all active media capability tickets bound to that session while leaving sibling active sessions' media tickets unaffected.
  - Account throttling (`record_failed_attempt`) runs in an `IMMEDIATE` transaction sharing policy constants (10 attempts, 600s window, 600s cooldown), so concurrent failures never lose an increment. `clear_failed_attempts` resets attempt state; `increment_challenge_attempt` is a single `UPDATE ... RETURNING`.
- **Opportunistic Pruning:** `create_session` and `create_challenge` prune up to 256 expired rows (`expires_at_ms <= issue_time`) in the same transaction as row creation. No background sweeper thread is used; request-time policy checks remain authoritative.
- **Fail-Closed Decoding (`sqlite/records.rs`):** Row decoding validates constraints strictly; unknown roles, unknown challenge purposes, out-of-range counters, partial MFA factor tuples, or malformed ObjectIds map directly to `StoreError::InconsistentState`, failing closed to deny access.

## Cryptography and TOTP

`DAM_HOPPER_MFA_KEY_FILE` selects the dedicated 32-byte MFA encryption key. The file loader accepts 32 raw bytes, 64 hexadecimal characters, or 44 Base64 characters; it rejects symlinks and non-regular files, and on Unix rejects any group/world permission bits (`mode & 0o077 != 0`, enforcing owner-only access; `chmod 0600` recommended). The key is held in zeroizing memory (`Zeroizing<[u8; 32]>`). When configured, malformed or unreadable key material fails startup. Production authenticated startup requires the key; non-production development may construct the service without it.

MFA secrets are encrypted with AES-256-GCM using a random 12-byte nonce. Authenticated associated data binds the key ID, username, and purpose; ciphertext and nonce are Base64 encoded. Decryption requires the matching key ID and AAD and returns a zeroizing buffer. The key ID uses the configured file's UTF-8 stem, or `mfa-key-v1` when unavailable. Provision and back up this key separately from MongoDB or SQLite; the runtime does not create or rotate it automatically.

TOTP uses a CSPRNG-generated 20-byte secret, Base32 provisioning, SHA-1, six decimal digits, a 30-second step, and a ±1-step window. Verification uses constant-time code comparisons and returns the greatest matching step. A step is eligible only if it is newer than `lastAcceptedStep`; the store CAS makes persisted advancement monotonic under concurrent use. Keep leading zeroes in submitted codes.

Challenge handles are generated from 32 random bytes and returned as hex; only their SHA-256 digest is persisted. Challenge checks validate purpose, consumption, expiration, and attempt limit. Account failure tracking is persisted so issuing a new challenge does not reset the account window.

## Startup and Operational Boundary

Server startup resolves the authentication backend after every `.env` file has loaded: `AuthBackendConfig::from_env` (`server/src/auth/config.rs`) evaluates the environment Precedence Matrix: unconfigured startup defaults to SQLite (`auth.db`), while configuring both `MONGODB_URI` and `MONGODB_DATABASE` selects MongoDB. Then `init_auth_store` in `main.rs` opens the selected store exactly once. When MongoDB is selected, startup executes a bounded connectivity ping (`ping: 1`); an unreachable server fails startup loudly within connection timeout without SQLite fallback. Subsequent index initialization errors retain existing warn-and-continue policy. When SQLite is selected, any open/migration failure aborts startup and never falls back to MongoDB. `--no-auth` skips store selection entirely. `AppState::new` takes the optional store, builds the shared `AuthService` from it (there is no raw database handle on `AppState`) and loads `DAM_HOPPER_MFA_KEY_FILE` when configured. With no store the service reports authentication unavailable; there is no implicit test account. Production mode is identified by `RUST_ENV=production` or `ENVIRONMENT=production`; production startup requires a selected authentication store and the MFA key, and rejects the development bypass (`--no-auth`). `--no-auth` together with an active store (either backend) is rejected.

Registration, administrator-role lookup, enabled-account checks, same-subject re-authentication, host-action availability and idle-suspend actor checks all go through the selected `AuthStore`; storage failure denies and never consults a mock.

The MFA key is encryption material, not the JWT signing secret. Do not put it in MongoDB or SQLite, expose it to the browser, or log its contents. Missing database state or failed session/user lookups result in an unavailable policy decision rather than an allow decision.

## SQLite Lite Mode Shipped Architecture and Invariants

SQLite Lite Mode provides a zero-external-dependency authentication store within the same DamHopper server binary. It is fully qualified and shipped with complete security parity to MongoDB.

### Architecture and Invariants

- **Zero External Services Default**: Unconfigured startup defaults to SQLite for all authentication operations. Setting `DAM_HOPPER_LITE_MODE=true` (or `1`, `TRUE`) forces SQLite even if MongoDB variables are present. Setting `DAM_HOPPER_LITE_MODE=false/0` enforces MongoDB, and configuring both `MONGODB_URI` and `MONGODB_DATABASE` selects MongoDB automatically. Malformed, partial, or invalid selectors abort startup immediately.
- **Single Store Lifecycle**: The selected `AuthStore` is instantiated once during startup in `server/src/main.rs`. Raw database handles are removed from `AppState`; all authentication, session, challenge, role, and re-authentication queries dispatch through the shared `AuthStore` interface.
- **Storage Isolation and Path Resolution**: `DAM_HOPPER_AUTH_SQLITE_PATH` selects the database file path. When omitted or empty, it defaults to `auth.db` in the global DamHopper configuration directory (`~/.config/dam-hopper/auth.db` on Linux). Startup checks enforce that `auth.db` does not collide with PTY/IDE session state (`sessions.db`) or telemetry state (`telemetry.db`).
- **Independent State**: Switching between MongoDB and SQLite uses fresh, independent datastores. No data migration is performed; existing accounts in MongoDB remain intact if the operator reverts to MongoDB.
- **Strict Security Parity**:
  - Password hashes use the existing bcrypt implementation in both stores; storage backend selection does not alter password verification.
  - MFA secrets encrypted at rest via AES-256-GCM using `DAM_HOPPER_MFA_KEY_FILE` (mandatory in production).
  - Monotonic TOTP step verification and atomic replay protection via single conditional SQL updates.
  - Account failure throttling enforced within serialized `IMMEDIATE` transactions (10 failed attempts trigger a 10-minute lockout).
  - Session lifetimes (30 days absolute, 10 days MFA freshness) evaluated by the shared deterministic policy evaluator.
  - Disabled-by-default registration: new users are created with `is_enabled = 0`. Login returns `HTTP 401 {"code": "ACCOUNT_DISABLED"}` until approved by local operator SQL.
- **Deployment Constraint**: Exactly **one server process per local auth file** on local persistent storage. Concurrent asynchronous tasks within the single server process safely access SQLite under WAL mode. Network filesystems (NFS, SMB, CIFS) and multi-server clusters sharing an auth file are not supported.
- **Platform Qualification**: Fully qualified on Linux x86_64. On Windows hosts, standard OS single-process file locking semantics apply to the database and key files.
## Related Documentation

- [Authentication API](../api/authentication.md) — Route contract, MFA challenge credential admission, and JSON examples
- [API Reference](../api-reference.md#authentication) — Server-wide route index
- [Server Configuration](../configuration/server-configuration.md#environment-variables) — Environment-variable index
- [System Architecture](../system-architecture.md) — Server-wide subsystem architecture
